// Task skyways-vehicle-20261107 (lane VIS): the prize car's steering wheel separated from the Meshy dash (world/skywaysCarWheel.ts
// splitWheel on the cooked skyways-car-dash.glb) and turned in the view (world/skywaysCarModel.ts): the partition is deterministic and
// exact (dash + wheel = the original triangle list), the wheel set is the rim all round + the spokes + the hub inside the measured
// cylinder slab (the gauges / hood / column stay the dash's), WHEEL_RIM is the fitted rim axis, the dash keeps a surface right behind
// the wheel (no hole where it was); in the view the wheel hangs on a pivot turning about that axis, at turn 0 exactly where it was baked,
// turning only its own subtree (the dash's matrices never change), the split cached once per GLB (shared geometry for every view,
// disposed with the model), the wheel following the steering through a light ease.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {CAR_SPEC} from '../src/world/skywaysCarSpec';
import {COCKPIT_URLS, DASH_MODEL, cockpitLayout, posePoint} from '../src/world/skywaysCarCockpit';
import {WHEEL_RIM, WHEEL_SPLIT, fitRimCrest, ringNormal, splitWheel} from '../src/world/skywaysCarWheel';
import {WHEEL_EASE, WHEEL_RATIO, WHEEL_SPLIT_SANITY, buildCarView, dashWheel, releaseSkywaysCarModel, setSkywaysCarModelsForTests, setWheel} from '../src/world/skywaysCarModel';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
interface Prim { name: string; P: Float32Array; N: Float32Array; UV: Float32Array | null; I: Uint16Array | Uint32Array }
async function prims(url: string): Promise<Prim[]> {
  const root = (await new NodeIO().readBinary(new Uint8Array(readFileSync(pub(url))))).getRoot();
  return root.listNodes().filter(n => n.getMesh()).map(n => {
    const p = n.getMesh()!.listPrimitives()[0];
    return {name: n.getName(), P: p.getAttribute('POSITION')!.getArray() as Float32Array, N: p.getAttribute('NORMAL')!.getArray() as Float32Array,
      UV: (p.getAttribute('TEXCOORD_0')?.getArray() ?? null) as Float32Array | null, I: p.getIndices()!.getArray() as Uint16Array | Uint32Array};
  });
}
/** A GLTF-like scene from the cooked GLB's arrays (what GLTFLoader builds: one mesh per node, a textured standard material). */
function gltfOf(ps: Prim[]): GLTF {
  const scene = new THREE.Group();
  for (const p of ps) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.N, 3));
    if (p.UV) g.setAttribute('uv', new THREE.BufferAttribute(p.UV, 2));
    g.setIndex(new THREE.BufferAttribute(p.I, 1));
    const mat = new THREE.MeshStandardMaterial({map: new THREE.Texture(), side: THREE.DoubleSide});
    mat.name = p.name;
    const m = new THREE.Mesh(g, mat);
    m.name = p.name;
    scene.add(m);
  }
  return {scene} as unknown as GLTF;
}

const [dash] = await prims(COCKPIT_URLS.dash);
const seat = await prims(COCKPIT_URLS.seat);
const split = splitWheel(dash.P, dash.I, WHEEL_RIM);
const [NX, NY, NZ] = ringNormal(WHEEL_RIM);
/** A model point in the WHEEL_RIM frame: d along the axis, r from it. */
const dr = (x: number, y: number, z: number) => {
  const qx = x - WHEEL_RIM.x, qy = y - WHEEL_RIM.y, qz = z - WHEEL_RIM.z, d = qx * NX + qy * NY + qz * NZ;
  return {d, r: Math.sqrt(Math.max(0, qx * qx + qy * qy + qz * qz - d * d))};
};

describe('skyways car wheel: the split of the cooked dash', () => {
  it('is deterministic and exact: every original triangle in exactly one part, in order; the counts plausible', () => {
    const again = splitWheel(dash.P, dash.I, WHEEL_RIM);
    expect(again.wheel).toEqual(split.wheel);
    expect(again.dash).toEqual(split.dash);
    const s = split.stats, nt = dash.I.length / 3;
    expect(s.tris).toBe(nt);
    expect(s.wheel + s.dash).toBe(nt);
    expect(split.wheel.length + split.dash.length).toBe(dash.I.length);
    // a two-pointer walk: both parts keep the original order, so each original triangle is the next one of exactly one part
    let iw = 0, id = 0;
    const same = (L: Uint32Array, j: number, t: number) => j + 2 < L.length && L[j] === dash.I[3 * t] && L[j + 1] === dash.I[3 * t + 1] && L[j + 2] === dash.I[3 * t + 2];
    for (let t = 0; t < nt; t++) {
      if (same(split.wheel, iw, t)) iw += 3;
      else if (same(split.dash, id, t)) id += 3;
      else throw new Error(`triangle ${t} in neither part`);
    }
    expect(iw).toBe(split.wheel.length);
    expect(id).toBe(split.dash.length);
    // (measured: 3567 of 20715) a real wheel, not a sliver and not the dash
    expect(s.wheel).toBeGreaterThan(2500);
    expect(s.wheel).toBeLessThan(5000);
    expect(s.wheel).toBeGreaterThan(WHEEL_SPLIT_SANITY.minTris);
    expect(s.wheel / s.tris).toBeLessThan(WHEEL_SPLIT_SANITY.maxShare);
  });

  it('the wheel set lies inside the cylinder slab and is the whole wheel: the rim all round, the spokes, the hub', () => {
    const sectors = new Set<number>();
    let hub = 0, maxR = 0;
    for (let k = 0; k < split.wheel.length; k += 3) {
      let cd = 0;
      for (let j = 0; j < 3; j++) {
        const i = split.wheel[k + j], q = dr(dash.P[3 * i], dash.P[3 * i + 1], dash.P[3 * i + 2]);
        expect(q.r).toBeLessThanOrEqual(WHEEL_SPLIT.rMax + 1e-9);
        maxR = Math.max(maxR, q.r);
        cd += q.d / 3;
        if (q.r < 0.05) hub++;
      }
      expect(cd).toBeGreaterThanOrEqual(WHEEL_SPLIT.dBack - 1e-9);
      expect(cd).toBeLessThanOrEqual(WHEEL_SPLIT.dFront + 1e-9);
    }
    // the rim: wheel vertices at the crest radius in every 10 deg sector round the axis
    const u0 = [1 - NX * NX, -NX * NY, -NX * NZ], lu = Math.hypot(...u0), U = u0.map(v => v / lu), V = [NY * U[2] - NZ * U[1], NZ * U[0] - NX * U[2], NX * U[1] - NY * U[0]];
    for (const i of split.wheel) {
      const qx = dash.P[3 * i] - WHEEL_RIM.x, qy = dash.P[3 * i + 1] - WHEEL_RIM.y, qz = dash.P[3 * i + 2] - WHEEL_RIM.z;
      const a = qx * U[0] + qy * U[1] + qz * U[2], b = qx * V[0] + qy * V[1] + qz * V[2];
      if (Math.abs(Math.hypot(a, b) - WHEEL_RIM.r) < 0.02) sectors.add(Math.floor(((Math.atan2(b, a) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 18)));
    }
    expect(sectors.size).toBe(36);
    expect(hub).toBeGreaterThan(30); // the hub face round the axis
    expect(maxR).toBeGreaterThan(WHEEL_RIM.rimOuter - 0.015); // the rim's outer edge
    expect(maxR).toBeLessThan(WHEEL_SPLIT.rMax + 1e-9);
  });

  it('the gauges, the cluster hood and the column stay the dash\'s: nothing of the wheel behind dBack; the dash still owns the rest', () => {
    let behind = 0, beyond = 0;
    for (const i of split.dash) {
      const q = dr(dash.P[3 * i], dash.P[3 * i + 1], dash.P[3 * i + 2]);
      if (q.d < WHEEL_SPLIT.dBack - 0.05 && q.r < 0.25) behind++; // the gauges / column / cluster behind the wheel
      if (q.r > 0.4) beyond++; // the dash's body
    }
    expect(behind).toBeGreaterThan(1000);
    expect(beyond).toBeGreaterThan(20000);
  });

  it('WHEEL_RIM is the rim\'s fitted axis (crest circle + plane from DASH_MODEL.ring), not the coarser placement anchor', () => {
    const f = fitRimCrest(dash.P, DASH_MODEL.ring);
    const n = ringNormal(WHEEL_RIM), dot = f.nx * n[0] + f.ny * n[1] + f.nz * n[2];
    expect((Math.acos(Math.min(1, dot)) * 180) / Math.PI).toBeLessThan(0.3);
    expect(Math.hypot(f.x - WHEEL_RIM.x, f.y - WHEEL_RIM.y, f.z - WHEEL_RIM.z)).toBeLessThan(0.003);
    expect(f.r).toBeCloseTo(WHEEL_RIM.r, 2);
    expect(f.rms).toBeLessThan(0.01);
    expect(f.sectors).toBeGreaterThan(45);
    // (the placement anchor's normal is ~6.5 deg off: turning about it would wobble the rim by centimetres)
    const a = ringNormal(DASH_MODEL.ring), off = (Math.acos(a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) * 180) / Math.PI;
    expect(off).toBeGreaterThan(4);
  });

  it('no hole where the wheel was, seen from the driver\'s eye at any turn: behind the upper rim the dash, behind the hub the hub itself', () => {
    // The Meshy dash has NO surface of its own behind the hub face (the column shroud is open: the hub was its lid), so the check is the
    // view the player gets: with the wheel turned 0 / 90 / 180 / 270 deg, every ray from the seated eye through the hub and the upper half
    // of the rim meets the turned wheel or the dash right there (never the far firewall / the shell, never nothing).
    const lay = cockpitLayout(CAR_SPEC), E = CAR_SPEC.eye;
    const place = (src: ArrayLike<number>) => {
      const P = new Float64Array(src.length);
      for (let i = 0; i < P.length; i += 3) { const q = posePoint(lay.dash, src[i], src[i + 1], src[i + 2]); P[i] = q.x; P[i + 1] = q.y; P[i + 2] = q.z; }
      return P;
    };
    const turned = (ang: number) => { // the wheel's vertices turned about WHEEL_RIM's axis (model space), then placed
      const c = Math.cos(ang), s = Math.sin(ang), out = Float64Array.from(dash.P);
      for (const i of new Set(split.wheel)) {
        const x = dash.P[3 * i] - WHEEL_RIM.x, y = dash.P[3 * i + 1] - WHEEL_RIM.y, z = dash.P[3 * i + 2] - WHEEL_RIM.z, k = NX * x + NY * y + NZ * z;
        out[3 * i] = WHEEL_RIM.x + x * c + (NY * z - NZ * y) * s + NX * k * (1 - c);
        out[3 * i + 1] = WHEEL_RIM.y + y * c + (NZ * x - NX * z) * s + NY * k * (1 - c);
        out[3 * i + 2] = WHEEL_RIM.z + z * c + (NX * y - NY * x) * s + NZ * k * (1 - c);
      }
      return place(out);
    };
    const P0 = place(dash.P);
    const hitIn = (P: Float64Array, I: Uint32Array, o: number[], d: number[]): number => { // nearest triangle (both sides)
      let best = Infinity;
      for (let k = 0; k < I.length; k += 3) {
        const a = 3 * I[k], b = 3 * I[k + 1], c = 3 * I[k + 2];
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det, sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2], u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-4 && t < best) best = t;
      }
      return best;
    };
    // (1) the wheel taken away: rays toward its own vertices (every 7th) on the upper half outside the hub meet the dash itself right
    // there (the cluster / hood behind the rim); (2) the hub FACE (a disc in the crest plane, r <= 0.06) is met at every turn: behind it the
    // model has no surface (the column shroud is open: the hub face was its lid), but the round face, turning about its own centre,
    // always covers it. Below the hub the model has no column cover at all: between the lower spokes the footwell shows already at turn
    // 0 — open space under the dash's lower edge, not a hole in it (the CPU QA renders show it: qa-artifacts, never committed).
    const upper: {d: number[]; L: number}[] = [], hub: {d: number[]; L: number}[] = [];
    for (let k = 0; k < split.wheel.length; k += 21) {
      const i = split.wheel[k], q = dr(dash.P[3 * i], dash.P[3 * i + 1], dash.P[3 * i + 2]);
      if (!(dash.P[3 * i + 1] > WHEEL_RIM.y + 0.05 && q.r >= 0.12)) continue;
      const d = [P0[3 * i] - E.x, P0[3 * i + 1] - E.y, P0[3 * i + 2] - E.z], L = Math.hypot(d[0], d[1], d[2]);
      upper.push({d: d.map(v => v / L), L});
    }
    const u0 = [1 - NX * NX, -NX * NY, -NX * NZ], lu = Math.hypot(...u0), U = u0.map(v => v / lu), V = [NY * U[2] - NZ * U[1], NZ * U[0] - NX * U[2], NX * U[1] - NY * U[0]];
    for (const r of [0, 0.02, 0.04, 0.06]) for (let a = 0; a < 12; a++) {
      const ca = Math.cos((a * Math.PI) / 6) * r, sa = Math.sin((a * Math.PI) / 6) * r;
      const m = [0, 1, 2].map(j => [WHEEL_RIM.x, WHEEL_RIM.y, WHEEL_RIM.z][j] + ca * U[j] + sa * V[j] + 0.01 * [NX, NY, NZ][j]);
      const w = posePoint(lay.dash, m[0], m[1], m[2]), d = [w.x - E.x, w.y - E.y, w.z - E.z], L = Math.hypot(d[0], d[1], d[2]);
      hub.push({d: d.map(v => v / L), L});
    }
    expect(upper.length).toBeGreaterThan(40);
    const o = [E.x, E.y, E.z], holes: string[] = [];
    for (const {d, L} of upper) { // the wheel taken away: the dash itself right behind the upper rim
      const t = hitIn(P0, split.dash, o, d);
      if (!(t < L + 0.3)) holes.push(`dash only: dir ${d.map(v => v.toFixed(3)).join(',')} first hit ${t.toFixed(3)} (wheel at ${L.toFixed(3)})`);
    }
    for (const ang of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
      const PW = turned(ang);
      for (const {d, L} of hub) {
        const t = hitIn(PW, split.wheel, o, d);
        if (!(Math.abs(t - L) < 0.04)) holes.push(`turn ${((ang * 180) / Math.PI).toFixed(0)}: hub dir ${d.map(v => v.toFixed(3)).join(',')} hit ${t.toFixed(3)} (hub at ${L.toFixed(3)})`);
      }
    }
    expect(holes).toEqual([]);
  });
});

describe('skyways car wheel: the view', () => {
  const models = () => ({car: null, dash: gltfOf([dash]), seat: gltfOf(seat)});

  it('the dash draws the split dash; the wheel hangs on a pivot at WHEEL_RIM (local +Z = the axis), in the dash\'s own material, exactly where it was baked', () => {
    const m = models();
    setSkywaysCarModelsForTests(m);
    try {
      const v = buildCarView(CAR_SPEC);
      expect(v.wheel).not.toBeNull();
      expect(v.wheel!.name).toBe('skyways-car-wheel-spin');
      const dashO = v.cockpit.getObjectByName('skyways-car-dash-model')!, dashMesh = dashO.children.find(o => (o as THREE.Mesh).isMesh) as THREE.Mesh;
      const w = v.cockpit.getObjectByName('skyways-car-wheel') as THREE.Mesh, pivot = v.cockpit.getObjectByName('skyways-car-wheel-pivot')!;
      const sp = dashWheel(m.dash)!;
      expect(dashMesh.geometry).toBe(sp.dash);
      expect(w.geometry).toBe(sp.wheel);
      expect(w.material).toBe(dashMesh.material); // (one program: the Meshy maps)
      expect(w.geometry.getAttribute('position')).toBe(dashMesh.geometry.getAttribute('position')); // the vertices shared, not copied
      expect(w.geometry.getAttribute('uv')).toBe(dashMesh.geometry.getAttribute('uv'));
      expect(Array.from(w.geometry.index!.array)).toEqual(Array.from(split.wheel));
      expect(Array.from(dashMesh.geometry.index!.array)).toEqual(Array.from(split.dash));
      expect(pivot.parent).toBe(dashMesh);
      expect(pivot.position.toArray()).toEqual([WHEEL_RIM.x, WHEEL_RIM.y, WHEEL_RIM.z]);
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.quaternion), n = ringNormal(WHEEL_RIM);
      expect(z.x).toBeCloseTo(n[0], 9); expect(z.y).toBeCloseTo(n[1], 9); expect(z.z).toBeCloseTo(n[2], 9);
      // at turn 0 the wheel's transform relative to the dash mesh is the identity (it sits where it was baked)
      v.group.updateMatrixWorld(true);
      const rel = new THREE.Matrix4().copy(dashMesh.matrixWorld).invert().multiply(w.matrixWorld), id = new THREE.Matrix4();
      rel.elements.forEach((e, k) => expect(e).toBeCloseTo(id.elements[k], 9));
      // shared by every view: one split per GLB
      const v2 = buildCarView(CAR_SPEC);
      expect((v2.cockpit.getObjectByName('skyways-car-wheel') as THREE.Mesh).geometry).toBe(sp.wheel);
      expect(dashWheel(m.dash)).toBe(sp);
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });

  it('setWheel turns only the wheel\'s subtree, about the axis (CCW seen by the driver for a left turn); the dash\'s matrices never change', () => {
    setSkywaysCarModelsForTests(models());
    try {
      const v = buildCarView(CAR_SPEC);
      v.group.position.set(3, 0.1, -4);
      v.group.rotation.y = 0.7;
      v.group.updateMatrixWorld(true);
      const spin = v.wheel!, inWheel = new Set<THREE.Object3D>();
      spin.traverse(o => inWheel.add(o));
      const before = new Map<THREE.Object3D, number[]>();
      v.group.traverse(o => { if (!inWheel.has(o)) before.set(o, [...o.matrixWorld.elements]); });
      const w = v.cockpit.getObjectByName('skyways-car-wheel') as THREE.Mesh, dashMesh = v.cockpit.getObjectByName('skyways-car-dash-model')!.children[0] as THREE.Mesh;
      // a rim point (model space) at the crest, on the wheel plane's "right" (u) direction, and a point on the axis
      const n = new THREE.Vector3(...ringNormal(WHEEL_RIM)), c = new THREE.Vector3(WHEEL_RIM.x, WHEEL_RIM.y, WHEEL_RIM.z);
      const u = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), rim = c.clone().addScaledVector(u, WHEEL_RIM.r), onAxis = c.clone().addScaledVector(n, 0.05);
      const worldOf = (p: THREE.Vector3) => p.clone().applyMatrix4(w.matrixWorld); // (the wheel mesh's local space = the dash model space)
      const dashWorld = (p: THREE.Vector3) => p.clone().applyMatrix4(dashMesh.matrixWorld);
      setWheel(v, 0.3);
      expect(spin.rotation.z).toBeCloseTo(0.3 * WHEEL_RATIO, 9);
      setWheel(v, Math.PI / 2 / WHEEL_RATIO); // a quarter turn
      v.group.updateMatrixWorld(true);
      for (const [o, m] of before) o.matrixWorld.elements.forEach((e, k) => expect(e, o.name).toBeCloseTo(m[k], 12));
      // the wheel point that was at rim moves to c + (n x u) r: a +90 deg turn about the axis toward the driver
      const expectRim = c.clone().addScaledVector(new THREE.Vector3().crossVectors(n, u), WHEEL_RIM.r);
      expect(worldOf(rim).distanceTo(dashWorld(expectRim))).toBeLessThan(1e-6);
      expect(worldOf(onAxis).distanceTo(dashWorld(onAxis))).toBeLessThan(1e-6); // the axis stays put
      // seen from the driver (looking along -n), +turn is counter-clockwise: u (right) -> up-ish
      expect(new THREE.Vector3().crossVectors(n, u).y).toBeGreaterThan(0.9);
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });

  it('the wheel follows the steering through a light ease (at most ~0.1 s behind) and comes back to centre', () => {
    setSkywaysCarModelsForTests(models());
    try {
      const v = buildCarView(CAR_SPEC), dt = 1 / 60, to = 0.5 * WHEEL_RATIO;
      setWheel(v, 0.5, dt);
      expect(v.wheelAngle).toBeGreaterThan(0);
      expect(v.wheelAngle).toBeLessThan(to);
      let t = dt;
      while (to - v.wheelAngle > 0.05 * to) { setWheel(v, 0.5, dt); t += dt; }
      expect(t).toBeLessThanOrEqual(3 * WHEEL_EASE + dt + 1e-9); // 95 % of a step within 3 time constants (0.12 s)
      // a ramp (the physics' eased steering): the lag stays about one time constant
      let s = 0;
      for (let i = 0; i < 60; i++) { s = Math.min(0.55, s + 2.6 * dt); setWheel(v, s, dt); }
      for (let i = 0; i < 6; i++) { s = Math.max(0, s - 2.6 * dt); setWheel(v, s, dt); }
      expect(Math.abs(v.wheelAngle - s * WHEEL_RATIO)).toBeLessThan(2.6 * WHEEL_RATIO * 0.1);
      for (let i = 0; i < 60; i++) setWheel(v, 0, dt);
      expect(Math.abs(v.wheelAngle)).toBeLessThan(1e-3);
      expect(v.wheel!.rotation.z).toBe(v.wheelAngle);
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });

  it('the split is disposed with the model (and recomputed for a new GLB); a dash without a wheel at WHEEL_RIM keeps it still', () => {
    const m = models();
    setSkywaysCarModelsForTests(m);
    const sp = dashWheel(m.dash)!;
    const gone: string[] = [];
    sp.dash.addEventListener('dispose', () => gone.push('dash'));
    sp.wheel.addEventListener('dispose', () => gone.push('wheel'));
    expect(releaseSkywaysCarModel()).toBe(true);
    expect(gone.sort()).toEqual(['dash', 'wheel']);
    // a box "dash" (no wheel there): no split, the dash whole, no wheel pivot
    const box = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.76, 1.09).translate(0, 0.38, 0), new THREE.MeshStandardMaterial());
    box.add(mesh);
    const fake = {scene: box} as unknown as GLTF;
    setSkywaysCarModelsForTests({car: null, dash: fake, seat: gltfOf(seat)});
    try {
      expect(dashWheel(fake)).toBeNull();
      const v = buildCarView(CAR_SPEC);
      expect(v.wheel).toBeNull();
      expect(v.cockpit.getObjectByName('skyways-car-wheel-pivot')).toBeUndefined();
      expect(() => setWheel(v, 0.3, 1 / 60)).not.toThrow();
    } finally { setSkywaysCarModelsForTests({car: null, dash: null, seat: null}); }
  });
});
