// Task studio-rt-flashlight-compute-20261115-233136-01: the RT FLASHLIGHT's estimator, on the CPU mirror of its kernels
// (tests/helpers/rtEstimator.ts over render/rt/rtTrace.ts and a real render/rt/rtScene.ts BVH), against the standard bounce
// (world/flashBounce.ts) in the same hall: the same reflected flux, its light where the standard one puts it, but shadowed by what
// stands in the way, smooth (no circle of point emitters), and steady while the beam sweeps. The GPU kernels were run against this
// mirror on a real WebGPU device (the task report: VPLs, receivers and the unshadowed sum agree to float precision).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR, Grid} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {FB, FlashBounce, sampleFlashBounce, spotConeSolidAngle, type FlashBounceSource} from '../src/world/flashBounce';
import {levelGeometries, type FieldSource} from '../src/world/lightField';
import {BandScene} from '../src/world/lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import {RtScene} from '../src/render/rt/rtScene';
import {newRtHit, traceAny, traceClosest} from '../src/render/rt/rtTrace';
import {gatherExact, gatherStochastic, lightOf, lightVpls, type Tracer, type V3, type Vpl} from './helpers/rtEstimator';

const GAME = {color: 0xfff4e2, intensity: 34, distance: 30, angle: 0.58, penumbra: 0.7, decay: 1.2} as const;
const spot = (): THREE.SpotLight => new THREE.SpotLight(GAME.color, GAME.intensity, GAME.distance, GAME.angle, GAME.penumbra, GAME.decay);
const aim = (s: THREE.SpotLight, from: V3, to: V3): THREE.SpotLight => { s.position.set(...from); s.target.position.set(...to); s.updateMatrixWorld(true); s.target.updateMatrixWorld(true); return s; };
const lum = (c: ArrayLike<number>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** A hall of w x h cells (a solid border, open floor at y 0, ceiling at `ceil`) for the standard bounce, and the same hall as meshes. */
function hall(w: number, h: number, ceil: number, rgb: {wall: V3; floor: V3; ceil: V3}) {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  const fs: FieldSource = {grid: g, lights: [], trenchFloorY: -1.15};
  const levels: Level[] = [{id: 0, role: 'main', grid: g, baseY: 0}];
  const geos = levelGeometries(fs);
  const scene = new BandScene(g.w, g.h, geos), albedo = surfaceAlbedo(g.w, g.h, levels, geos, null);
  const held = {wall: paint(albedo, ALB_WALL, rgb.wall), floor: paint(albedo, ALB_FLOOR, rgb.floor), ceil: paint(albedo, ALB_CEIL, rgb.ceil)};
  const src: FlashBounceSource = {scene, albedo};
  // the same room as meshes, in the linear colours the standard bounce's bytes really hold
  const x0 = CELL, x1 = (w - 1) * CELL, z0 = CELL, z1 = (h - 1) * CELL;
  const root = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, ceil, z1 - z0), [held.wall, held.wall, held.ceil, held.floor, held.wall, held.wall].map(c => mat(c, THREE.BackSide)));
  box.position.set((x0 + x1) / 2, ceil / 2, (z0 + z1) / 2);
  root.add(box);
  return {src, held, root, x0, x1, z0, z1};
}
function paint(a: SurfaceAlbedo, off: number, rgb: V3): V3 {
  const q = rgb.map(v => Math.round(Math.sqrt(v) * 255));
  for (const s of a.slots) for (let o = 0; o < s.length; o += ALBEDO_STRIDE) { s[o + off] = q[0]; s[o + off + 1] = q[1]; s[o + off + 2] = q[2]; }
  return [ALBEDO_LUT[q[0]], ALBEDO_LUT[q[1]], ALBEDO_LUT[q[2]]];
}
const mat = (rgb: V3, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace), roughness: 0.9, metalness: 0, side});

function tracerOf(root: THREE.Object3D): {tr: Tracer; scene: RtScene} {
  root.updateMatrixWorld(true);
  const scene = new RtScene();
  scene.prepare([root]);
  const B = scene.buffers, hit = newRtHit();
  return {scene, tr: {
    closest: (o, d, tmin, tmax) => { const h = traceClosest(B, {x: o[0], y: o[1], z: o[2]}, {x: d[0], y: d[1], z: d[2]}, tmin, tmax, hit); return h ? {t: h.t, n: [h.nx, h.ny, h.nz], albedo: [h.r, h.g, h.b]} : null; },
    any: (o, d, tmin, tmax) => traceAny(B, {x: o[0], y: o[1], z: o[2]}, {x: d[0], y: d[1], z: d[2]}, tmin, tmax),
  }};
}
const fluxOf = (vpls: readonly (Vpl | null)[]): V3 => vpls.reduce<V3>((s, v) => (v ? [s[0] + v.f[0] * Math.PI, s[1] + v.f[1] * Math.PI, s[2] + v.f[2] * Math.PI] : s), [0, 0, 0]);
const fbFlux = (fb: FlashBounce): V3 => fb.vpls.reduce<V3>((s, v) => [s[0] + v.r * Math.PI, s[1] + v.g * Math.PI, s[2] + v.b * Math.PI], [0, 0, 0]);
const E_fb = (fb: FlashBounce, p: V3, n: V3): V3 => sampleFlashBounce(fb.vpls, p, n, [0, 0, 0] as V3);

describe('energy: the traced light rays carry what the standard bounce\'s carry', () => {
  // a 40 m x 40 m hall, 30 m high: the whole cone lands on the one wall at x = 0.5 m
  const H = hall(80, 80, 30, {wall: [0.5, 0.32, 0.18], floor: [0.3, 0.3, 0.3], ceil: [0.3, 0.3, 0.3]});
  const {tr} = tracerOf(H.root);

  it('the reflected flux off a wall square to the beam, at every distance: the standard bounce\'s, within 1 %', () => {
    const rows: string[] = [];
    for (const D of [1, 2, 3, 5, 8, 12, 20]) {
      const s = aim(spot(), [H.x0 + D, 15, 20], [H.x0, 15, 20]);
      const vpls = lightVpls(tr, lightOf(s));
      expect(vpls.every(v => v !== null && Math.abs(v.p[0] - (H.x0 + 0.05)) < 1e-4 && v.n[0] > 0.9999), `D ${D}: every ray on the wall`).toBe(true);
      const fb = new FlashBounce();
      fb.bind(H.src);
      fb.update(1 / 60, s);
      const a = fluxOf(vpls), b = fbFlux(fb);
      rows.push(`${D} m: ${(a[0] / b[0]).toFixed(4)}`);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] / b[c] - 1), `D ${D} channel ${c}`).toBeLessThan(0.01);
    }
    console.log(`rt flashlight: traced / standard reflected flux, wall square to the beam: ${rows.join(', ')}`);
  });

  it('past the light\'s cutoff nothing lands; a beam into empty space sends nothing back', () => {
    const far = lightVpls(tr, lightOf(aim(spot(), [H.x0 + 31, 15, 20], [H.x0, 15, 20])));
    expect(far.every(v => v === null)).toBe(true);
    const into = lightVpls({closest: () => null, any: () => false}, lightOf(aim(spot(), [5, 1.6, 5], [5, 1.6, -5])));
    expect(fluxOf(into)).toEqual([0, 0, 0]);
    expect(spotConeSolidAngle(GAME.angle, GAME.penumbra)).toBeCloseTo(0.561, 3);
  });
});

describe('where the light goes: the standard bounce\'s place and strength, shadowed, smooth', () => {
  // a 20 m x 12 m hall, 4.4 m high; the beam on the far wall (x = 0.5) from 4 m, at eye height
  const H = hall(40, 24, 4.4, {wall: [0.45, 0.45, 0.45], floor: [0.3, 0.3, 0.3], ceil: [0.3, 0.3, 0.3]});
  const eye: V3 = [H.x0 + 4.2, 1.6, 6];
  const s = aim(spot(), [H.x0 + 4, 1.45, 6.1], [H.x0, 1.4, 6]);
  const {tr} = tracerOf(H.root);
  const vpls = lightVpls(tr, lightOf(s));
  const fb = new FlashBounce();
  fb.bind(H.src);
  fb.update(1 / 60, s);
  const up: V3 = [0, 1, 0];

  it('in front of the lit wall: the standard bounce\'s strength away from it, more at its foot (where the standard one is too dim)', () => {
    const rows: string[] = [];
    for (const d of [0.4, 0.8, 1.5, 2.5, 3.5]) {
      for (const [y, n] of [[0, up], [4.4, [0, -1, 0] as V3]] as const) {
        const p: V3 = [H.x0 + d, y, 6];
        const a = lum(gatherExact(tr, vpls, p, n, eye).E), b = lum(E_fb(fb, p, n));
        rows.push(`${y ? 'ceil' : 'floor'} ${d} m ${(a / b).toFixed(2)}`);
        // (world/flashBounce.ts limit 3: its fourteen lights make the foot of a large lit surface dimmer than it should be; the
        // traced bounce has a light per ray, so it is the brighter one there)
        expect(a / b, `${y ? 'ceiling' : 'floor'} ${d} m from the wall`).toBeGreaterThan(d < 1.5 ? 0.9 : 0.7);
        expect(a / b, `${y ? 'ceiling' : 'floor'} ${d} m from the wall`).toBeLessThan(d < 1.5 ? 2.5 : 1.4);
      }
    }
    console.log(`rt flashlight: traced / standard irradiance in front of a lit wall: ${rows.join(', ')}`);
  });

  it('no circle of point emitters: along the floor beside the wall the bounce rises and falls once, smoothly', () => {
    const at = (z: number): number => lum(gatherExact(null, vpls, [H.x0 + 0.3, 0, z], up, eye).U);
    const xs: number[] = [];
    for (let z = 3; z <= 9.0001; z += 0.02) xs.push(at(z));
    let maxima = 0, worst = 0;
    const peak = Math.max(...xs);
    for (let i = 1; i < xs.length - 1; i++) {
      if (xs[i] > xs[i - 1] && xs[i] > xs[i + 1]) maxima++;
      worst = Math.max(worst, Math.abs(xs[i + 1] - 2 * xs[i] + xs[i - 1]) / peak);
    }
    expect(maxima).toBe(1);
    expect(worst, 'the largest 2 cm second difference / the peak').toBeLessThan(0.01);
    // the standard bounce's fourteen lights along the same line, for the report
    const ys: number[] = [];
    for (let z = 3; z <= 9.0001; z += 0.02) ys.push(lum(E_fb(fb, [H.x0 + 0.3, 0, z], up)));
    let fbMax = 0;
    for (let i = 1; i < ys.length - 1; i++) if (ys[i] > ys[i - 1] && ys[i] > ys[i + 1]) fbMax++;
    console.log(`rt flashlight: floor line beside the lit wall: traced ${maxima} maximum (worst 2nd difference ${(worst * 100).toFixed(2)} % of the peak), standard ${fbMax} maxima`);
  });

  it('a wall stub between the lit patch and a floor point shades it; the standard bounce does not; the two-ray estimate converges', () => {
    // the stub stands square to the lit wall beyond the beam's patch (it spans z 3.4 .. 8.6 from 4 m); the point is behind it
    const stub = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), mat([0.4, 0.4, 0.4]));
    stub.position.set(H.x0 + 1, 1.5, 9.3);
    const root = new THREE.Group();
    root.add(H.root.clone(), stub);
    const {tr: tp} = tracerOf(root);
    const lit = lightVpls(tp, lightOf(s));
    const behind: V3 = [H.x0 + 0.8, 0, 11];
    const shaded = gatherExact(tp, lit, behind, up, eye), clear = gatherExact(tr, vpls, behind, up, eye);
    expect(shaded.v).toBeLessThan(0.35);
    expect(clear.v).toBeGreaterThan(0.99);
    // the standard bounce lights the point as if the stub were not there
    expect(lum(shaded.E)).toBeLessThan(0.4 * lum(E_fb(fb, behind, up)));
    // the kernel's estimate: two reservoir-picked shadow rays a frame; their mean over 64 frames is the exact visible share
    let v = 0;
    for (let f = 0; f < 64; f++) v += gatherStochastic(tp, lit, behind, up, eye, 17, 9, f).v;
    expect(Math.abs(v / 64 - shaded.v)).toBeLessThan(0.08);
    console.log(`rt flashlight: floor behind a wall stub: visible share ${shaded.v.toFixed(3)} (two-ray mean of 64 frames ${(v / 64).toFixed(3)}), traced ${lum(shaded.E).toFixed(4)} vs standard ${lum(E_fb(fb, behind, up)).toFixed(4)} (without the stub, traced ${lum(clear.E).toFixed(4)})`);
  });
});

describe('in time: a sweep of the beam changes the bounce a little a frame', () => {
  // the beam swept along a wall with a doorway (the beam crosses the jamb): 0.5 degree a frame
  const H = hall(40, 24, 4.4, {wall: [0.45, 0.45, 0.45], floor: [0.3, 0.3, 0.3], ceil: [0.3, 0.3, 0.3]});
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.4, 4), mat([0.45, 0.45, 0.45]));
  door.position.set(H.x0 + 2, 2.2, 3);
  const root = new THREE.Group();
  root.add(H.root, door);
  const {tr} = tracerOf(root);

  it('per 0.5 degree step the receivers in view change by a few percent at most; never a jump', () => {
    const from: V3 = [H.x0 + 5, 1.5, 6], eye: V3 = [H.x0 + 5.2, 1.6, 6];
    const points: [V3, V3][] = [];
    for (let z = 2; z <= 10; z += 1) points.push([[H.x0 + 0.6, 0, z], [0, 1, 0]], [[H.x0 + 1.2, 4.4, z], [0, -1, 0]]);
    let prev: number[] | null = null, worst = 0;
    for (let k = 0; k <= 60; k++) {
      const a = (-15 + k * 0.5) * Math.PI / 180;
      const s = aim(spot(), from, [from[0] - Math.cos(a) * 5, 1.4, from[2] + Math.sin(a) * 5]);
      const vpls = lightVpls(tr, lightOf(s));
      const now = points.map(([p, n]) => lum(gatherExact(tr, vpls, p, n, eye).E));
      const total = now.reduce((x, y) => x + y, 0);
      if (prev) for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.abs(now[i] - prev[i]) / (total / now.length));
      prev = now;
    }
    expect(worst, 'the largest change of one receiver per step / the mean').toBeLessThan(0.1);
    console.log(`rt flashlight: 0.5 deg aim sweep past a door jamb: worst per-step change of a receiver ${(worst * 100).toFixed(2)} % of the mean`);
  });
});

describe('the gain and the range window are the standard bounce\'s (FB.params)', () => {
  it('reads FB.params live: gain scales the result, beyond the range nothing', () => {
    const H = hall(40, 24, 4.4, {wall: [0.45, 0.45, 0.45], floor: [0.3, 0.3, 0.3], ceil: [0.3, 0.3, 0.3]});
    const {tr} = tracerOf(H.root);
    const s = aim(spot(), [H.x0 + 4, 1.45, 6.1], [H.x0, 1.4, 6]);
    const vpls = lightVpls(tr, lightOf(s));
    const p: V3 = [H.x0 + 1, 0, 6], eye: V3 = [H.x0 + 4.2, 1.6, 6];
    const base = lum(gatherExact(tr, vpls, p, [0, 1, 0], eye).E);
    const saved = FB.params.value.clone();
    try {
      FB.params.value.x *= 2;
      expect(lum(gatherExact(tr, vpls, p, [0, 1, 0], eye).E) / base).toBeCloseTo(2, 9);
      FB.params.value.copy(saved);
      expect(lum(gatherExact(tr, vpls, [H.x0 + 12, 0, 6], [0, 1, 0], eye).E)).toBe(0); // (11 m range)
    } finally { FB.params.value.copy(saved); }
  });
});
