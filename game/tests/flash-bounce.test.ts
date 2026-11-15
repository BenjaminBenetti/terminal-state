// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane BOUNCE): the live flashlight bounce (world/flashBounce.ts) — virtual
// lights where the beam lands, summed per fragment on the GPU.
// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane BOUNCE): thirty rays of equal flux in six sectors; prop boxes and
// characters stop the beam; a light stands on the plane its rays land on, as large as their footprints, and never between two planes.
// - the spot light is read as three r186 shades it (cone factor, distance falloff: pinned on three's own source);
// - THE RAYS: each in its own cell of equal flux, evenly loaded across the beam along both of its axes, tied to the light's axes;
// - ENERGY: the lights together carry rho x the beam's flux off a flat wall — whatever the distance and the tilt with a physical
//   falloff; with the game's own falloff (decay 1.2, a 30 m cutoff) it is rho x the flux the game really draws on the wall
//   (x d^0.8 x the cutoff window), checked against a brute-force integral; each light is as large as its rays' footprints;
// - COLOUR: a red wall sends red light, the light's own colour times the surface's; DIRECTION: the floor and ceiling in front of the
//   lit wall get light, the wall's own plane and everything behind it get exactly none;
// - WHAT STOPS THE BEAM: a prop box, a round prop, a character — the lights stand on IT, none beyond it; a box that is gone and glass
//   pass it; the live list is read at every update; a box the rays start in is not there; every ray against the test's own
//   intersection of the whole list; a thin pole takes its share of the rays and no more;
// - ON A SURFACE, ALWAYS: over aim sweeps across a wall / floor edge and past a column every lit light lies on a traced surface
//   with that surface's normal, and the flux has no step; after a sudden turn the bounce is at the new place within a quarter second;
// - NEAR AND FAR: next to a lit wall the bounce is never above the wall's own radiosity x the gain, at 2.5 m, 8 m and 20 m (the six
//   point lights it replaces were far above it at 8 m and 20 m); far from the wall it is what those six gave;
// - off (intensity 0, nothing bound) is exactly zero, in the lights, the uniforms and the sum; back on, the lights stand at their
//   places at once; a battery dip dims the bounce in the same frame;
// - the smoothing is frame-rate independent (30 / 60 / 144 Hz and uneven steps: the same state); the same inputs give the same
//   bits; and updates with props and characters bound allocate nothing of their own;
// - the CPU mirror is the documented formula, and the GENERATED shader (GLSL, evaluated here) gives the mirror's numbers;
// - in a lit material's WGSL / GLSL the bounce adds no uniform buffer, no array and no texture;
// - on the real generated base Subway with the finishes the builder drew and its real prop boxes: every ray lands on the nearest
//   thing, every light is the sum of its rays on their plane, no light is a hot point; along a walk with the head turning the
//   flux never jumps up and what a light given up lets go at once is bounded; what an update costs.
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshBasicNodeMaterial, MeshStandardNodeMaterial, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer, type NodeBuilder} from 'three/webgpu';
import {normalWorld, positionWorld, uniform, vec4} from 'three/tsl';
import {layoutFor, materialsFor, modelsFor} from './helpers/pacedBuildFixture';
import {mainBody, runFlow, type Env} from './helpers/glslEval';
import {raycastWorld} from '../src/combat/hitscan';
import {drainSync} from '../src/core/pacedBuild';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {levelsOf, type Level} from '../src/gen/levels';
import type {PropPlacement} from '../src/gen/props';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import type {StationLayout} from '../src/gen/stationTypes';
import {STAND_EYE} from '../src/player/player';
import {buildWorldSteps} from '../src/world/builder';
import {stationLevels} from '../src/world/levelGeometry';
import {levelGeometries, type FieldSource} from '../src/world/lightField';
import {LightFieldLight, LightFieldNode, installLightFieldNode, type LightFieldSampleNodes} from '../src/world/lightFieldNode';
import {BandScene, HIT_CEIL, HIT_FLOOR} from '../src/world/lightScene';
import {stationFieldSource} from '../src/world/lights';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import {
  FB, FLASH_BOUNCE_DEFAULTS, FLASH_BOUNCE_LIFT, FLASH_BOUNCE_REVIVE, FLASH_BOUNCE_TAU, FLASH_BOUNCE_TUNING, FLASH_EXTRA, FLASH_RAYS, FLASH_SECTORS, FLASH_VPLS, FlashBounce, RAY_PATTERN,
  flashBounceIrradiance, sampleFlashBounce, spotConeAttenuation, spotConeSolidAngle, spotDistanceAttenuation,
  type FlashBounceSource, type FlashBox, type FlashOccluders, type FlashRayDebug, type FlashVpl,
} from '../src/world/flashBounce';
import {FLASH_BODIES_MAX, FLASH_GLAZING, StationFlashOccluders, flashOccluders, flashPropAlbedo, type FlashBodyActor} from '../src/world/flashOccluders';

type V3 = [number, number, number];
const lum = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: ArrayLike<number>): number => Math.sqrt(dot(a, a));
const unit = (a: ArrayLike<number>): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const posOf = (v: FlashVpl): V3 => [v.x, v.y, v.z];
const nrmOf = (v: FlashVpl): V3 => [v.nx, v.ny, v.nz];
const rgbOf = (v: FlashVpl): V3 => [v.r, v.g, v.b];
const isOn = (v: FlashVpl): boolean => v.r + v.g + v.b > 0;
const litOf = (fb: FlashBounce): FlashVpl[] => fb.vpls.filter(isOn);
const copy = (fb: FlashBounce): FlashVpl[] => fb.vpls.map(v => ({...v}));
const SECTOR_RAYS = FLASH_RAYS / FLASH_SECTORS;
const LIFT = FLASH_BOUNCE_LIFT;

// ---------------------------------------------------------------------------------------------
// Hand-built halls

/** w x h cells, a solid border, an open floor at y 0 under a ceiling at `ceil`. */
function hall(w: number, h: number, ceil = 4.4): Grid {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.set(x, y, FLOOR); g.ceil[y * w + x] = ceil; g.area[y * w + x] = 0; }
  return g;
}
interface Rig { grid: Grid; scene: BandScene; albedo: SurfaceAlbedo; src: FlashBounceSource }
function rig(grid: Grid): Rig {
  const fs: FieldSource = {grid, lights: [], trenchFloorY: -1.15};
  const levels: Level[] = [{id: 0, role: 'main', grid, baseY: 0}];
  const geos = levelGeometries(fs);
  const scene = new BandScene(grid.w, grid.h, geos), albedo = surfaceAlbedo(grid.w, grid.h, levels, geos, null);
  return {grid, scene, albedo, src: {scene, albedo}};
}
/** Paint one kind of surface (ALB_FLOOR / ALB_CEIL / ALB_WALL) of every cell; the linear colour the bytes really hold. */
function paint(a: SurfaceAlbedo, off: number, rgb: V3): V3 {
  const q = rgb.map(v => Math.round(Math.sqrt(v) * 255));
  for (const s of a.slots) for (let o = 0; o < s.length; o += ALBEDO_STRIDE) { s[o + off] = q[0]; s[o + off + 1] = q[1]; s[o + off + 2] = q[2]; }
  return [ALBEDO_LUT[q[0]], ALBEDO_LUT[q[1]], ALBEDO_LUT[q[2]]];
}

/** The game's flashlight (game.ts: SpotLight(0xfff4e2, 0, 30, 0.58, 0.7, 1.2), MOOD.flashlight = 34 cd at full battery). */
const GAME = {color: 0xfff4e2, intensity: 34, distance: 30, angle: 0.58, penumbra: 0.7, decay: 1.2} as const;
/** A white light with the game's cone and a PHYSICAL falloff (inverse square, no cutoff). */
const PHYSICAL = {color: 0xffffff, intensity: 10, distance: 0, angle: 0.58, penumbra: 0.7, decay: 2} as const;
type SpotSpec = {color: number; intensity: number; distance: number; angle: number; penumbra: number; decay: number};
const spot = (o: SpotSpec = GAME): THREE.SpotLight => new THREE.SpotLight(o.color, o.intensity, o.distance, o.angle, o.penumbra, o.decay);
const aim = (s: THREE.SpotLight, from: V3, to: V3): THREE.SpotLight => { s.position.set(...from); s.target.position.set(...to); return s; };
/** The flashlight as the game mounts it: on the camera, a hand's width right of and below the eye. */
function gameRig(): {camera: THREE.PerspectiveCamera; light: THREE.SpotLight; pose(x: number, y: number, z: number, yaw: number, pitch?: number): void} {
  const camera = new THREE.PerspectiveCamera(), light = spot(GAME);
  camera.rotation.order = 'YXZ';
  light.position.set(0.2, -0.15, 0.1);
  light.target.position.set(0.04, -0.12, -6);
  camera.add(light, light.target);
  return {camera, light, pose(x, y, z, yaw, pitch = 0) { camera.position.set(x, y, z); camera.rotation.set(pitch, yaw, 0); }};
}

/** The flux the lights carry (linear rgb): pi x their radiant intensities. */
const flux = (fb: FlashBounce): V3 => { const s: V3 = [0, 0, 0]; for (const v of fb.vpls) { s[0] += v.r * Math.PI; s[1] += v.g * Math.PI; s[2] += v.b * Math.PI; } return s; };
const fluxOf = (vs: readonly FlashVpl[]): number => vs.reduce((s, v) => s + lum(rgbOf(v)) * Math.PI, 0);
/** The flux of the rays the lights carry now (what the lights are on their way to): pi x the rays' transfer x the light. */
const carriedFlux = (fb: FlashBounce, s: THREE.SpotLight): number =>
  fb.rays().reduce((t, r) => t + (r.light >= 0 ? lum([r.transfer[0] * s.color.r, r.transfer[1] * s.color.g, r.transfer[2] * s.color.b]) * s.intensity * Math.PI : 0), 0);
const E = (fb: FlashBounce, p: V3, n: V3): V3 => sampleFlashBounce(fb.vpls, p, n, [0, 0, 0] as V3);
const uniformsOf = (): number[] => [...FB.pos, ...FB.nrm, ...FB.col].flatMap(u => u.value.toArray());

// the test's own reading of three's spot light
const smoothstep = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const coneOf = (cosT: number, o: SpotSpec): number => smoothstep(Math.cos(o.angle), Math.cos(o.angle * (1 - o.penumbra)), cosT);
const attenOf = (d: number, o: SpotSpec): number => 1 / Math.max(d ** o.decay, 0.01) * (o.distance > 0 ? Math.min(1, Math.max(0, 1 - (d / o.distance) ** 4)) ** 2 : 1);
/** The integral over the cone of the cone factor x f(angle off the axis) (midpoint rule). */
function coneIntegral(o: SpotSpec, f: (theta: number) => number, steps = 40000): number {
  let s = 0;
  const h = o.angle / steps;
  for (let i = 0; i < steps; i++) { const th = (i + 0.5) * h; s += coneOf(Math.cos(th), o) * f(th) * 2 * Math.PI * Math.sin(th) * h; }
  return s;
}
/** The angle off the axis inside which a share of the cone's flux lies: the test's own table of its own integral, read backwards. */
const fluxAngles = new Map<string, (share: number) => number>();
function fluxAngle(o: SpotSpec): (share: number) => number {
  const key = `${o.angle}/${o.penumbra}`;
  let f = fluxAngles.get(key);
  if (f) return f;
  const steps = 400000, h = o.angle / steps, cum = new Float64Array(steps + 1);
  for (let i = 0; i < steps; i++) { const th = (i + 0.5) * h; cum[i + 1] = cum[i] + coneOf(Math.cos(th), o) * Math.sin(th) * h; }
  f = share => {
    const want = share * cum[steps];
    let lo = 0, hi = steps;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= want) lo = m; else hi = m; }
    return (lo + (want - cum[lo]) / Math.max(cum[hi] - cum[lo], 1e-300)) * h;
  };
  fluxAngles.set(key, f);
  return f;
}
/**
 * The share of a cone's flux that lies left of a tangent x along one axis across the beam (the beam is round: either axis), from the
 * flux on the plane one unit ahead: cone factor / (1 + x^2 + y^2)^(3/2) per area.
 */
function fluxLeftOf(o: SpotSpec): (x: number) => number {
  const lim = Math.tan(o.angle), G = 800, cell = 2 * lim / G, cdf = new Float64Array(G + 1);
  for (let i = 0; i < G; i++) {
    let col = 0;
    for (let j = 0; j < G; j++) { const x = -lim + (i + 0.5) * cell, y = -lim + (j + 0.5) * cell, r2 = 1 + x * x + y * y; col += coneOf(1 / Math.sqrt(r2), o) / (r2 * Math.sqrt(r2)); }
    cdf[i + 1] = cdf[i] + col;
  }
  return x => { const u = (x + lim) / cell; if (u <= 0) return 0; if (u >= G) return 1; const i = Math.floor(u); return (cdf[i] + (cdf[i + 1] - cdf[i]) * (u - i)) / cdf[G]; };
}

// --- props, and the test's own intersection of a ray with all of them ----------------------------------------------------------------
/** A prop box as the generators place it (the fields the beam reads: kind, place, half extents, height; `round` = its cylinder). */
const prop = (kind: string, x: number, z: number, hx: number, hz: number, h: number, y = 0, more: Partial<PropPlacement> = {}): PropPlacement =>
  ({kind, x, z, y, rot: 0, area: 0, hx, hz, h, blocksSight: true, variant: 0, ...more}) as PropPlacement;
/** Occluders of one colour, every box solid over its whole height (no glass rule). */
const literal = (props: FlashBox[], albedo: V3): FlashOccluders =>
  ({props, stops(b: FlashBox) { this.solidH = b.h; return true; }, solidH: 0, albedo: () => albedo, bodies: new Float32Array(0), bodyCount: 0, bodyAlbedo: [0, 0, 0]});
type Hit = {t: number; n: V3} | null;
/** A box, face by face: the nearest face that is seen from its front and crossed inside its rectangle. */
function boxHit(o: V3, d: V3, lo: V3, hi: V3): Hit {
  let best: Hit = null;
  for (let a = 0; a < 3; a++) for (const side of [0, 1]) {
    const face = side ? hi[a] : lo[a], out = side ? 1 : -1;
    if (d[a] * out >= 0) continue;
    const t = (face - o[a]) / d[a], b = (a + 1) % 3, c = (a + 2) % 3;
    if (!(t > 1e-4)) continue;
    const pb = o[b] + d[b] * t, pc = o[c] + d[c] * t;
    if (pb < lo[b] - 1e-12 || pb > hi[b] + 1e-12 || pc < lo[c] - 1e-12 || pc > hi[c] + 1e-12) continue;
    if (!best || t < best.t) { const n: V3 = [0, 0, 0]; n[a] = out; best = {t, n}; }
  }
  return best;
}
/** An upright cylinder: its side between its two heights, and its two caps inside their circle. */
function cylinderHit(o: V3, d: V3, cx: number, cz: number, r: number, y0: number, y1: number): Hit {
  let best: Hit = null;
  const ox = o[0] - cx, oz = o[2] - cz, A = d[0] * d[0] + d[2] * d[2], B = ox * d[0] + oz * d[2], C = ox * ox + oz * oz - r * r;
  if (A > 1e-12 && B * B - A * C >= 0) {
    const t = (-B - Math.sqrt(B * B - A * C)) / A, y = o[1] + d[1] * t;
    if (t > 1e-4 && y >= y0 - 1e-12 && y <= y1 + 1e-12) best = {t, n: [(ox + d[0] * t) / r, 0, (oz + d[2] * t) / r]};
  }
  for (const [face, out] of [[y1, 1], [y0, -1]]) {
    if (d[1] * out >= 0) continue;
    const t = (face - o[1]) / d[1], px = ox + d[0] * t, pz = oz + d[2] * t;
    if (!(t > 1e-4) || px * px + pz * pz > r * r + 1e-12) continue;
    if (!best || t < best.t) best = {t, n: [0, out, 0]};
  }
  return best;
}
/** The height up to which a prop stops the beam, as the docs state the glass rule: gone at 0.02 m, shop glazing is a pane, the rink's boards are solid to 1.1 m. */
const solidTop = (p: PropPlacement): number => (p.h <= 0.02 || p.kind === 'shopGlazing' ? 0 : p.kind === 'hkRinkBoard' ? Math.min(p.h, 1.1) : p.h);
/** The nearest thing along a ray: the architecture, a prop's solid part, a character (x, z, radius, y0, y1). A thing the ray starts in is left out. */
function nearest(scene: BandScene, props: readonly PropPlacement[], bodies: readonly number[][], o: V3, d: V3, max: number): {t: number; n: V3; on: FlashRayDebug['on']} {
  let best: {t: number; n: V3; on: FlashRayDebug['on']} = {t: max, n: [0, 0, 0], on: 'none'};
  if (scene.trace(o[0], o[1], o[2], d[0], d[1], d[2], max)) best = {t: scene.hitT, n: scene.hitKind === HIT_FLOOR ? [0, 1, 0] : scene.hitKind === HIT_CEIL ? [0, -1, 0] : [scene.hitNx, 0, scene.hitNz], on: 'architecture'};
  for (const p of props) {
    const top = solidTop(p);
    if (!(top > 0.02)) continue;
    const inY = o[1] >= p.y && o[1] <= p.y + top, ex = p.x - o[0], ez = p.z - o[2];
    if (inY && (p.round ? ex * ex + ez * ez <= p.hx * p.hx : Math.abs(ex) <= p.hx && Math.abs(ez) <= p.hz)) continue;
    const h = p.round ? cylinderHit(o, d, p.x, p.z, p.hx, p.y, p.y + top) : boxHit(o, d, [p.x - p.hx, p.y, p.z - p.hz], [p.x + p.hx, p.y + top, p.z + p.hz]);
    if (h && h.t < best.t) best = {...h, on: 'prop'};
  }
  for (const b of bodies) {
    if (o[1] >= b[3] && o[1] <= b[4] && (b[0] - o[0]) ** 2 + (b[1] - o[2]) ** 2 <= b[2] * b[2]) continue;
    const h = cylinderHit(o, d, b[0], b[1], b[2], b[3], b[4]);
    if (h && h.t < best.t) best = {...h, on: 'body'};
  }
  return best;
}
const bodiesOf = (occ: StationFlashOccluders): number[][] => Array.from({length: occ.bodyCount}, (_, i) => Array.from(occ.bodies.subarray(i * 5, i * 5 + 5)));

/**
 * At a fresh start (the lights stand at their places at full strength): the lights are what the rays say. Every ray that landed is
 * carried by a light on ITS plane or by none; every light — a sector's or an extra one — is the sum of the rays it carries times the
 * light, and a light that carries none is off; `dropped` is the share no light carries.
 *
 * "On its plane", as the planes are made (hits go together when their normals are within the planes' angle of the plane's first
 * hit and each lies within the planes' gap of the other's plane; the light takes their mean normal and the plane through the
 * FOREMOST of them, the lift off it):
 *  - on flat things (the light's normal is every one of its rays' own normal): the light's plane is never more than the gap behind
 *    a hit (a ray another sector gave it) and never more than twice the gap in front of one;
 *  - on round things the normals agree to twice the angle, and the chord adds to both: the sine of the angle times the distance
 *    of the hits from the first (no more than twice the light's hits lie apart).
 */
function expectLightsAreTheirRays(fb: FlashBounce, s: THREE.SpotLight, label = ''): {carried: number; lost: number} {
  const rays = fb.rays(), sum = Array.from({length: FLASH_VPLS}, (): V3 => [0, 0, 0]), T = FLASH_BOUNCE_TUNING;
  const angle = T.planeAngle * Math.PI / 180, flat = new Array<boolean>(FLASH_VPLS).fill(true), apart = new Array<number>(FLASH_VPLS).fill(0);
  rays.forEach((r, j) => {
    if (r.on === 'none' || r.light < 0) return;
    if (dot(nrmOf(fb.vpls[r.light]), [r.nx, r.ny, r.nz]) < 1 - 1e-12) flat[r.light] = false;
    for (let k = 0; k < j; k++) if (rays[k].on !== 'none' && rays[k].light === r.light) apart[r.light] = Math.max(apart[r.light], len(sub([r.x, r.y, r.z], [rays[k].x, rays[k].y, rays[k].z])));
  });
  let landed = 0, lost = 0;
  rays.forEach((r, j) => {
    expect(r.sector).toBe(Math.floor(j / SECTOR_RAYS));
    if (r.on === 'none') { expect(r.light, `${label} ray ${j}`).toBe(-1); return; }
    const w = r.transfer[0] + r.transfer[1] + r.transfer[2];
    landed += w;
    if (r.light < 0) { lost += w; return; }
    const v = fb.vpls[r.light], chord = flat[r.light] ? 0 : Math.sin(angle) * 2 * apart[r.light];
    expect(dot(nrmOf(v), [r.nx, r.ny, r.nz]), `${label} ray ${j}: its light's normal`).toBeGreaterThanOrEqual(flat[r.light] ? 1 - 1e-12 : Math.cos(2 * angle) - 1e-9);
    // how far the light's plane lies in front of the ray's hit, along the light's normal
    const front = dot(nrmOf(v), sub(posOf(v), [r.x, r.y, r.z])) - LIFT;
    expect(front, `${label} ray ${j}: its light's plane, behind the hit`).toBeGreaterThanOrEqual(-T.planeGap - chord - 1e-9);
    expect(front, `${label} ray ${j}: its light's plane, in front of the hit`).toBeLessThanOrEqual(2 * T.planeGap + chord + 1e-9);
    for (let c = 0; c < 3; c++) sum[r.light][c] += r.transfer[c];
  });
  const k: V3 = [s.color.r * s.intensity, s.color.g * s.intensity, s.color.b * s.intensity];
  fb.vpls.forEach((v, i) => {
    rgbOf(v).forEach((c, q) => expect(c, `${label} light ${i} channel ${q}`).toBeCloseTo(sum[i][q] * k[q], 9));
    if (isOn(v)) expect(len(nrmOf(v)), `${label} light ${i}: a unit normal`).toBeCloseTo(1, 12);
  });
  expect(fb.debug().dropped, `${label} dropped`).toBeCloseTo(landed > 0 ? lost / landed : 0, 6);
  return {carried: landed - lost, lost};
}

// --- shader builds (three's own builders on an uninitialised renderer: no GPU) ---------------------------------------------------
/** The wiring the lead adds to the enhanced light node, here on a test light: the field's light plus the bounce. */
class BounceLight extends LightFieldLight {}
class BounceNode extends LightFieldNode {
  static get type(): string { return 'FlashBounceTestNode'; }
  protected shade(builder: NodeBuilder): LightFieldSampleNodes | null {
    const s = super.shade(builder);
    if (s) (builder as unknown as {context: {irradiance: {addAssign(x: unknown): void}}}).context.irradiance.addAssign(flashBounceIrradiance(positionWorld, normalWorld));
    return s;
  }
}
type Backend = 'glsl' | 'wgsl';
const renderers = new Map<Backend, WebGPURenderer>();
function headless(backend: Backend): WebGPURenderer {
  let r = renderers.get(backend);
  if (r) return r;
  const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
  r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
  (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
  (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
  (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
  expect(installLightFieldNode(r)).toBe(true);
  (r as unknown as {library: {addLight(node: unknown, light: unknown): void}}).library.addLight(BounceNode, BounceLight);
  renderers.set(backend, r);
  return r;
}
function compile(backend: Backend, material: THREE.Material, lights: THREE.Light[]): string {
  const r = headless(backend), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const scene = new THREE.Scene();
  scene.add(mesh, ...lights);
  const errors: string[] = [];
  const oe = console.error, ow = console.warn;
  console.error = console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  try {
    const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
    const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
    b.scene = scene;
    b.camera = new THREE.PerspectiveCamera();
    b.material = material;
    b.context.material = material;
    b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
    b.build();
    expect(errors, `${backend}: a clean build`).toEqual([]);
    return b.fragmentShader;
  } finally {
    console.error = oe; console.warn = ow;
  }
}
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
/** Sampled textures, samplers and uniform buffers a fragment shader declares. */
function bindings(backend: Backend, frag: string): {textures: number; samplers: number; ubos: number} {
  if (backend === 'wgsl') return {textures: count(frag, /var\s+\w+\s*:\s*texture_\w+(<\w+>)?\s*;/g), samplers: count(frag, /var\s+\w+\s*:\s*sampler(_comparison)?\s*;/g), ubos: count(frag, /var<uniform>/g)};
  return {textures: count(frag, /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+;/g), samplers: 0, ubos: count(frag, /layout\s*\(\s*std140\s*\)\s*uniform/g)};
}

// ---------------------------------------------------------------------------------------------
describe('the spot light, read as three shades it', () => {
  it('cone factor and distance falloff are three r186\'s (its source lines), and the cone\'s solid angle is their integral', () => {
    const three = (p: string) => readFileSync(new URL(`../../node_modules/three/src/nodes/lighting/${p}`, import.meta.url), 'utf8');
    expect(three('SpotLightNode.js')).toMatch(/this\.coneCosNode\.value = Math\.cos\( light\.angle \);\s+this\.penumbraCosNode\.value = Math\.cos\( light\.angle \* \( 1 - light\.penumbra \) \);/);
    expect(three('SpotLightNode.js')).toMatch(/return smoothstep\( coneCosNode, penumbraCosNode, angleCosine \);/);
    expect(three('LightUtils.js')).toMatch(/const distanceFalloff = lightDistance\.pow\( decayExponent \)\.max\( 0\.01 \)\.reciprocal\(\);/);
    expect(three('LightUtils.js')).toMatch(/distanceFalloff\.mul\( lightDistance\.div\( cutoffDistance \)\.pow4\(\)\.oneMinus\(\)\.clamp\(\)\.pow2\(\) \)/);
    for (const o of [GAME, PHYSICAL, {...GAME, penumbra: 0.2, angle: 0.9}, {...GAME, penumbra: 1, angle: 0.3}] as SpotSpec[]) {
      for (const c of [1, 0.99, 0.95, 0.9, 0.85, 0.8, 0.5]) expect(spotConeAttenuation(c, o.angle, o.penumbra)).toBeCloseTo(coneOf(c, o), 12);
      for (const d of [0.05, 0.3, 1, 3, 12, 25, 29.9, 30, 40]) expect(spotDistanceAttenuation(d, o.distance, o.decay)).toBeCloseTo(attenOf(d, o), 12);
      const omega = coneIntegral(o, () => 1);
      expect(spotConeSolidAngle(o.angle, o.penumbra) / omega).toBeCloseTo(1, 6);
    }
    // a hard-edged cone (no penumbra): the plain cap
    expect(spotConeSolidAngle(0.5, 0)).toBeCloseTo(2 * Math.PI * (1 - Math.cos(0.5)), 12);
    expect([spotConeAttenuation(Math.cos(0.49), 0.5, 0), spotConeAttenuation(Math.cos(0.51), 0.5, 0)]).toEqual([1, 0]);
    // the game's beam: 0.561 sr of cone, 19.1 units of flux at 34 cd
    expect(spotConeSolidAngle(GAME.angle, GAME.penumbra)).toBeCloseTo(0.561, 3);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the rays: thirty of equal flux, in six sectors', () => {
  const TURN = 2 * Math.PI;
  // the cells, as [flux share from, to, turn round the axis from, to]: the axis ray's cap, four quarters round it, and per wedge (a
  // fifth of a turn) two cells of the inner ring and three of the outer one
  const cells: number[][] = [[0, 1 / 30, 0, 1]];
  for (let j = 0; j < 4; j++) cells.push([1 / 30, 1 / 6, j / 4, (j + 1) / 4]);
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j < 2; j++) cells.push([1 / 6, 1 / 2, (2 * k + j) / 10, (2 * k + j + 1) / 10]);
    for (let j = 0; j < 3; j++) cells.push([1 / 2, 1, (3 * k + j) / 15, (3 * k + j + 1) / 15]);
  }

  it('RAY_PATTERN: every ray in its own cell of a thirtieth of the flux — a cap of five round the axis and five wedges of five', () => {
    expect([FLASH_RAYS, FLASH_SECTORS, FLASH_EXTRA, FLASH_VPLS, RAY_PATTERN.length, cells.length]).toEqual([30, 6, 4, 10, 60, 30]);
    expect(SECTOR_RAYS).toBe(5);
    cells.forEach((c, j) => {
      // equal flux: (the share of the flux between its two rings) x (its part of the turn)
      expect((c[1] - c[0]) * (c[3] - c[2]), `cell ${j}`).toBeCloseTo(1 / FLASH_RAYS, 12);
      const share = RAY_PATTERN[j * 2], turn = RAY_PATTERN[j * 2 + 1] / TURN;
      expect(share >= c[0] && share <= c[1], `ray ${j}: share ${share} in ${c[0]} .. ${c[1]}`).toBe(true);
      if (j > 0) expect(turn > c[2] && turn < c[3], `ray ${j}: turn ${turn} in ${c[2]} .. ${c[3]}`).toBe(true);
      // a sector is compact: the cap is the inner sixth of the flux, wedge k the k-th fifth of the turn outside it
      const sector = Math.floor(j / SECTOR_RAYS);
      if (sector === 0) expect(share).toBeLessThanOrEqual(1 / 6);
      else { expect(share).toBeGreaterThanOrEqual(1 / 6); expect(Math.floor(turn * 5)).toBe(sector - 1); }
    });
    expect([RAY_PATTERN[0], RAY_PATTERN[1]]).toEqual([0, 0]); // the axis itself
    // no two rays close together: in the disc where equal areas hold equal flux (radius sqrt(share)) a cell is about 0.32 wide
    let least = Infinity;
    const at = (j: number): [number, number] => [Math.sqrt(RAY_PATTERN[j * 2]) * Math.cos(RAY_PATTERN[j * 2 + 1]), Math.sqrt(RAY_PATTERN[j * 2]) * Math.sin(RAY_PATTERN[j * 2 + 1])];
    for (let i = 0; i < FLASH_RAYS; i++) for (let j = i + 1; j < FLASH_RAYS; j++) least = Math.min(least, Math.hypot(at(i)[0] - at(j)[0], at(i)[1] - at(j)[1]));
    expect(least).toBeGreaterThan(0.2);
  });

  it('seen along either axis across the beam the rays are evenly loaded: every strip holds its share of the flux in rays, to about a ray', () => {
    const left = fluxLeftOf(GAME), angle = fluxAngle(GAME), lim = Math.tan(GAME.angle);
    const pts = Array.from({length: FLASH_RAYS}, (_, j) => { const t = Math.tan(angle(RAY_PATTERN[j * 2])), phi = RAY_PATTERN[j * 2 + 1]; return [t * Math.cos(phi), t * Math.sin(phi)]; });
    const rows: string[] = [];
    let over = 0, under = 0;
    for (const width of [0.035, 0.05, 0.1, 0.17, 0.3]) {
      let o = 0, u = 0, most = 0;
      for (const ax of [0, 1]) for (let a = -lim; a < lim; a += 0.002) {
        const n = pts.filter(p => p[ax] >= a && p[ax] < a + width).length, owed = (left(a + width) - left(a)) * FLASH_RAYS;
        o = Math.max(o, n - owed); u = Math.max(u, owed - n); most = Math.max(most, n);
      }
      rows.push(`${width}: at most ${most} rays, +${o.toFixed(2)} / -${u.toFixed(2)}`);
      over = Math.max(over, o); under = Math.max(under, u);
    }
    // (rings of rays — an axis ray and rings of 5, 10 and 14 — put up to 7 rays in a strip owed 2)
    console.log(`flash bounce, rays in a strip across the game's beam against the strip's share of the flux x ${FLASH_RAYS}, by the strip's width (tangent of the angle): ${rows.join('; ')}`);
    expect(over).toBeLessThan(1.1);
    expect(under).toBeLessThan(1.5);
  });

  it('the rays as cast: each at the angle its share of the flux says, turned round the axis from the light\'s own right toward its down', () => {
    const R = rig(hall(80, 80, 30));
    const fb = new FlashBounce(), G = gameRig(), angle = fluxAngle(GAME);
    fb.bind(R.src);
    G.pose(CELL + 4, 15, 20, Math.PI / 2, 0.2); // looking along -x, a little up
    fb.update(1 / 60, G.light);
    const e = G.camera.matrixWorld.elements, right: V3 = [e[0], e[1], e[2]], down: V3 = [-e[4], -e[5], -e[6]];
    const L = new THREE.Vector3().setFromMatrixPosition(G.light.matrixWorld), to = new THREE.Vector3().setFromMatrixPosition(G.light.target.matrixWorld);
    const a = unit(sub([to.x, to.y, to.z], [L.x, L.y, L.z]));
    const u = unit(sub(right, a.map(c => c * dot(a, right)))), v = cross(a, u);
    // (the beam is toed in a little: its second axis is the camera's down to a few thousandths)
    expect(dot(v, down)).toBeGreaterThan(0.999);
    const rays = fb.rays();
    expect(rays).toHaveLength(FLASH_RAYS);
    let widest = 0;
    rays.forEach((r, j) => {
      expect(r.on, `ray ${j}`).toBe('architecture');
      const th = angle(RAY_PATTERN[j * 2]), phi = RAY_PATTERN[j * 2 + 1];
      const want = [0, 1, 2].map(c => a[c] * Math.cos(th) + (u[c] * Math.cos(phi) + v[c] * Math.sin(phi)) * Math.sin(th));
      unit(sub([r.x, r.y, r.z], [L.x, L.y, L.z])).forEach((c, q) => expect(c, `ray ${j} axis ${q}`).toBeCloseTo(want[q], 6));
      widest = Math.max(widest, th);
    });
    const d = fb.debug(), omega = spotConeSolidAngle(GAME.angle, GAME.penumbra);
    expect(d.ringAngle).toBeCloseTo(widest, 6);
    expect(d.ringAngle).toBeLessThan(GAME.angle);
    expect(d.solidAngle).toBeCloseTo(omega, 12);
    expect(d.weight).toBeCloseTo(omega / FLASH_RAYS, 12);
    // a beam along the light's own x axis (a bare spot light aimed along x): the pattern turns from the light's y instead
    const bare = aim(spot(GAME), [CELL + 4, 15, 20], [CELL, 15, 20]);
    fb.bind(R.src);
    fb.update(1 / 60, bare);
    fb.rays().forEach((r, j) => {
      const th = angle(RAY_PATTERN[j * 2]), phi = RAY_PATTERN[j * 2 + 1];
      const want = [-Math.cos(th), Math.sin(th) * Math.cos(phi), -Math.sin(th) * Math.sin(phi)]; // axis -x, first axis +y, second -x cross y = -z
      unit(sub([r.x, r.y, r.z], [CELL + 4, 15, 20])).forEach((c, q) => expect(c, `bare ray ${j} axis ${q}`).toBeCloseTo(want[q], 6));
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('energy: the lights carry what the beam puts on the surface, times its colour', () => {
  // a 40 m x 40 m hall, 30 m high: the whole cone lands on the one wall at x = 0.5 m
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.32, 0.18]);
  const WALL_X = CELL;
  const onWall = (fb: FlashBounce) => litOf(fb).length === FLASH_SECTORS && litOf(fb).every(v => Math.abs(v.x - (WALL_X + LIFT)) < 1e-9 && v.nx === 1 && v.ny === 0 && v.nz === 0);

  it('physical falloff: the sum of the lights\' flux is rho x the beam\'s flux at every distance and tilt, a sixth in each sector\'s light; each as large as its rays\' footprints', () => {
    const fb = new FlashBounce();
    const s = spot(PHYSICAL), omega = spotConeSolidAngle(PHYSICAL.angle, PHYSICAL.penumbra);
    let floored = 0, clamped = 0;
    for (const [D, dz] of [[1, 0], [2.5, 0], [5, 0], [9, 0], [3, 3], [2, 2.7]]) {
      const from: V3 = [WALL_X + D, 15, 20];
      fb.bind(R.src); // (a new place: the lights appear there at once)
      fb.update(1 / 60, aim(s, from, [WALL_X, 15, 20 + dz]));
      expect(fb.debug()).toMatchObject({bound: true, lit: true, occluded: false, hits: FLASH_RAYS, onProps: 0, onBodies: 0, origin: 'light', lights: FLASH_SECTORS, extra: 0, fading: 0, fadingFlux: 0, planes: 0, dropped: 0});
      expect(onWall(fb), `D ${D} dz ${dz}`).toBe(true);
      const f = flux(fb);
      for (let c = 0; c < 3; c++) expect(f[c] / (rho[c] * PHYSICAL.intensity * omega), `D ${D} dz ${dz} channel ${c}`).toBeCloseTo(1, 9);
      // equal shares: the cone is cut into rays of equal flux, five to a sector; the two fading lights are off
      fb.vpls.forEach((v, i) => expect(v.r * Math.PI / (rho[0] * PHYSICAL.intensity * omega / FLASH_SECTORS), `light ${i}`).toBeCloseTo(i < FLASH_SECTORS ? 1 : 0, 9));
      fb.debug().flux.forEach((v, c) => expect(v).toBeCloseTo(f[c], 9));
      // a ray's footprint: its solid angle at its distance, over the cosine of its tilt (no flatter than a quarter); a light's patch
      const rays = fb.rays();
      for (let i = 0; i < FLASH_SECTORS; i++) {
        let area = 0;
        for (const r of rays.filter(q => q.sector === i)) {
          const d = len(sub([r.x, r.y, r.z], from)), a = d * d * (omega / FLASH_RAYS) / Math.max(D / d, 0.25);
          expect(r.area, `D ${D} dz ${dz} ray`).toBeCloseTo(a, 9);
          expect(r.light).toBe(i);
          if (D / d < 0.25) clamped++;
          area += a;
        }
        const want = Math.max(FLASH_BOUNCE_TUNING.soft * area / Math.PI, FLASH_BOUNCE_DEFAULTS.r0min ** 2);
        if (want === FLASH_BOUNCE_DEFAULTS.r0min ** 2) floored++;
        expect(fb.vpls[i].r0sq, `D ${D} dz ${dz} light ${i}`).toBeCloseTo(want, 9);
      }
      expectLightsAreTheirRays(fb, s, `D ${D} dz ${dz}`);
    }
    // (both ends were met: the smallest patch at 1 m, a grazing ray's flattest footprint)
    expect(floored).toBeGreaterThan(0);
    expect(clamped).toBeGreaterThan(0);
    expect(fb.debug().solidAngle).toBeCloseTo(omega, 12);
    expect(fb.debug().weight).toBeCloseTo(omega / FLASH_RAYS, 12);
  });

  it('the patch size follows its tunables, read at every update: FLASH_BOUNCE_TUNING.soft scales it, FB.params.y (r0min) is its floor', () => {
    const tuning = {...FLASH_BOUNCE_TUNING}, params = FB.params.value.clone();
    const at = (D: number): FlashVpl[] => { const fb = new FlashBounce(); fb.bind(R.src); fb.update(1 / 60, aim(spot(GAME), [WALL_X + D, 15, 20], [WALL_X, 15, 20])); return copy(fb).slice(0, FLASH_SECTORS); };
    try {
      expect([FB.params.value.x, FB.params.value.y, FB.params.value.z]).toEqual([FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.r0min, FLASH_BOUNCE_DEFAULTS.range]);
      expect(FLASH_BOUNCE_TUNING).toEqual({soft: 1, planeAngle: 25, planeGap: 0.25, keep: 0.8});
      const base = at(8);
      FLASH_BOUNCE_TUNING.soft = 2;
      at(8).forEach((v, i) => { expect(v.r0sq).toBeCloseTo(base[i].r0sq * 2, 9); expect({...v, r0sq: 0}).toEqual({...base[i], r0sq: 0}); });
      FLASH_BOUNCE_TUNING.soft = tuning.soft;
      FB.params.value.y = 3;
      for (const v of at(8)) expect(v.r0sq).toBe(9);
      FB.params.value.y = 0;
      for (const v of at(1)) { expect(v.r0sq).toBeGreaterThan(0.01); expect(v.r0sq).toBeLessThan(FLASH_BOUNCE_DEFAULTS.r0min ** 2); }
      // the wall from 2.5 m, 8 m and 20 m: the patches grow with the distance (about 0.45 m, 1.5 m and 3.7 m)
      FB.params.value.copy(params);
      const sizes = [2.5, 8, 20].map(D => at(D).map(v => Math.sqrt(v.r0sq)));
      console.log(`flash bounce, patch sizes r0 of the six lights on a square wall: ${[2.5, 8, 20].map((D, i) => `${D} m: ${sizes[i].map(v => v.toFixed(2)).join(' ')}`).join('; ')}`);
      sizes.forEach((row, i) => row.forEach(r0 => { expect(r0 / [2.5, 8, 20][i]).toBeGreaterThan(0.16); expect(r0 / [2.5, 8, 20][i]).toBeLessThan(0.2); }));
    } finally {
      Object.assign(FLASH_BOUNCE_TUNING, tuning);
      FB.params.value.copy(params);
    }
  });

  it('the game\'s falloff: rho x the flux the game draws on the wall (x d^0.8 x the cutoff window), within 1 % of the integral', () => {
    const fb = new FlashBounce();
    const s = spot(GAME), omega = spotConeSolidAngle(GAME.angle, GAME.penumbra);
    const c = new THREE.Color(GAME.color);
    const rows: string[] = [];
    for (const D of [1, 2, 3, 5, 8, 12, 20, 26]) {
      fb.bind(R.src);
      fb.update(1 / 60, aim(s, [WALL_X + D, 15, 20], [WALL_X, 15, 20]));
      expect(onWall(fb), `D ${D}`).toBe(true);
      // the flux three's light puts on the wall: I x cone x falloff(d) x d^2 over the cone, d = D / cos (a wall square to the beam)
      const drawn = GAME.intensity * coneIntegral(GAME, th => { const d = D / Math.cos(th); return attenOf(d, GAME) * d * d; });
      const f = flux(fb), ratio = f[0] / (rho[0] * c.r * drawn);
      rows.push(`${D} m: ${(f[0] / (rho[0] * c.r * GAME.intensity * omega)).toFixed(2)}x (integral ${(drawn / (GAME.intensity * omega)).toFixed(2)}x, ${((ratio - 1) * 100).toFixed(2)} %)`);
      // (thirty rays against a window that closes across the cone: looser in the last metres before the cutoff, where little is left)
      expect(Math.abs(ratio - 1), `D ${D}`).toBeLessThan(D <= 20 ? 0.01 : 0.04);
      expect(f[1] / f[0]).toBeCloseTo(rho[1] * c.g / (rho[0] * c.r), 9);
      expect(f[2] / f[0]).toBeCloseTo(rho[2] * c.b / (rho[0] * c.r), 9);
    }
    // not physical, on purpose: against rho x I x OMEGA (what an inverse-square beam would send back at any distance) the game's beam
    // grows as d^0.8 and its 30 m cutoff window then takes it to nothing
    console.log(`flash bounce, reflected flux of the game's beam off a square wall / (rho x 34 cd x ${omega.toFixed(3)} sr): ${rows.join(', ')}`);
    fb.bind(R.src);
    fb.update(1 / 60, aim(s, [WALL_X + 29.99, 15, 20], [WALL_X, 15, 20]));
    expect(lum(flux(fb))).toBeLessThan(1e-4 * lum(rho) * GAME.intensity * omega);
    // past the cutoff no ray lands at all
    fb.bind(R.src);
    fb.update(1 / 60, aim(s, [WALL_X + 31, 15, 20], [WALL_X, 15, 20]));
    expect(fb.debug().hits).toBe(0);
    expect(flux(fb)).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('colour and direction', () => {
  // two rooms, 4.4 m high, either side of a wall half a metre thick (x 15 .. 15.5); the light stands in room A (x < 15)
  const g = hall(62, 40);
  for (let z = 0; z < g.h; z++) g.set(30, z, SOLID);
  const R = rig(g);
  const FACE_A = 15, FACE_B = 15.5;
  const lit = (wall: V3, o: SpotSpec = GAME): FlashBounce => {
    paint(R.albedo, ALB_WALL, wall);
    paint(R.albedo, ALB_FLOOR, [0.3, 0.3, 0.3]);
    paint(R.albedo, ALB_CEIL, [0.3, 0.3, 0.3]);
    const fb = new FlashBounce();
    fb.bind(R.src);
    fb.update(1 / 60, aim(spot(o), [12, 1.6, 10], [FACE_A, 1.6, 10]));
    return fb;
  };

  it('every light stands just off the lit wall with the wall\'s normal: the cap\'s at the beam\'s centre, the wedges\' round it', () => {
    const fb = lit([0.5, 0.5, 0.5]);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, lights: FLASH_SECTORS, fading: 0});
    for (const v of litOf(fb)) {
      expect(v.x).toBeCloseTo(FACE_A - LIFT, 12);
      expect(nrmOf(v)).toEqual([-1, 0, 0]);
      expect(R.scene.bandAtPoint(v.x, v.y, v.z)).toBeGreaterThanOrEqual(0);
    }
    const off = fb.vpls.slice(0, FLASH_SECTORS).map(v => Math.hypot(v.y - 1.6, v.z - 10));
    expect(off[0]).toBeLessThan(0.15);
    for (let i = 1; i < FLASH_SECTORS; i++) { expect(off[i]).toBeGreaterThan(0.6); expect(off[i]).toBeLessThan(1.2); }
  });

  it('a red wall throws red light on the floor and ceiling near it; the light\'s colour times the wall\'s; a white wall fills more', () => {
    const red = paint(R.albedo, ALB_WALL, [0.6, 0.08, 0.06]);
    const fb = lit([0.6, 0.08, 0.06]);
    const c = new THREE.Color(GAME.color);
    for (const v of litOf(fb)) {
      expect(v.g / v.r).toBeCloseTo(red[1] * c.g / (red[0] * c.r), 9);
      expect(v.b / v.r).toBeCloseTo(red[2] * c.b / (red[0] * c.r), 9);
    }
    const floor = E(fb, [14.2, 0, 10], [0, 1, 0]), ceil = E(fb, [14.2, 4.4, 10], [0, -1, 0]);
    for (const e of [floor, ceil]) {
      expect(e[0]).toBeGreaterThan(0.05);
      expect(e[1] / e[0]).toBeCloseTo(red[1] * c.g / (red[0] * c.r), 9);
      expect(e[0]).toBeGreaterThan(5 * e[1]);
    }
    // the same beam on a white wall and on a dark one: the bounce is the wall's albedo
    const white = lum(E(lit([0.8, 0.8, 0.8]), [14.2, 0, 10], [0, 1, 0])), dark = lum(E(lit([0.05, 0.05, 0.05]), [14.2, 0, 10], [0, 1, 0]));
    const w = paint(R.albedo, ALB_WALL, [0.8, 0.8, 0.8])[0], d = paint(R.albedo, ALB_WALL, [0.05, 0.05, 0.05])[0];
    expect(white / dark).toBeCloseTo(w / d, 6);
    console.log(`flash bounce, the game's beam square on a wall 3 m away (albedo ${w.toFixed(2)}): irradiance on the floor 0.8 m in front of it ${white.toFixed(3)}, ` +
      `direct light at the beam's centre ${(GAME.intensity * attenOf(3, GAME)).toFixed(2)} (the bounce is ${(white / (GAME.intensity * attenOf(3, GAME)) * 100).toFixed(1)} % of it)`);
  });

  it('in front of the lit wall there is light; on the wall\'s own plane, behind it and past the range there is exactly none', () => {
    const fb = lit([0.6, 0.6, 0.6]);
    // room A: the floor at the wall's foot, under the player, the ceiling, a side of a thing facing the wall
    for (const [p, n] of [[[14.5, 0, 10], [0, 1, 0]], [[12, 0, 10], [0, 1, 0]], [[13.5, 4.4, 10.5], [0, -1, 0]], [[13, 1, 10], [1, 0, 0]], [[14, 1.2, 8], [0, 0, 1]]] as [V3, V3][]) {
      expect(lum(E(fb, p, n)), `${p}`).toBeGreaterThan(0.01);
    }
    // nearer the wall's foot is brighter than under the player
    expect(lum(E(fb, [14.5, 0, 10], [0, 1, 0]))).toBeGreaterThan(2 * lum(E(fb, [12, 0, 10], [0, 1, 0])));
    // a surface facing away from the lights
    expect(E(fb, [13, 1, 10], [-1, 0, 0])).toEqual([0, 0, 0]);
    // the lit wall itself (the lights stand a few centimetres in front of it: a flat patch does not light its own plane)
    for (const z of [10, 10.4, 11.5, 14]) expect(E(fb, [FACE_A, 1.6, z], [-1, 0, 0])).toEqual([0, 0, 0]);
    // behind the wall: its other face, room B's floor, ceiling and things
    for (const [p, n] of [[[FACE_B, 1.6, 10], [1, 0, 0]], [[16, 0, 10], [0, 1, 0]], [[15.6, 0, 10], [0, 1, 0]], [[17, 4.4, 10], [0, -1, 0]], [[18, 1, 10], [-1, 0, 0]], [[18, 1, 10], [0, 0, 1]]] as [V3, V3][]) {
      expect(E(fb, p, n), `${p}`).toEqual([0, 0, 0]);
    }
    // the range window: nothing past FB.params.z, and it closes smoothly
    const R0 = FLASH_BOUNCE_DEFAULTS.range;
    expect(E(fb, [FACE_A - R0 - 1.2, 1.6, 10], [1, 0, 0])).toEqual([0, 0, 0]);
    const near = lum(E(fb, [FACE_A - R0 + 1.2, 1.6, 10], [1, 0, 0])), nearer = lum(E(fb, [FACE_A - R0 + 2.4, 1.6, 10], [1, 0, 0]));
    expect(near).toBeGreaterThan(0);
    expect(nearer).toBeGreaterThan(3 * near);
  });

  it('LIMIT 1, as stated: the lights cast no shadows; and what stops the beam is the prop BOXES handed in, never the grid\'s prop flags', () => {
    const fb = lit([0.6, 0.6, 0.6]);
    const other = (change: (g2: Grid) => void): {fb: FlashBounce; R2: Rig} => {
      const g2 = hall(62, 40);
      for (let z = 0; z < g2.h; z++) g2.set(30, z, SOLID);
      change(g2);
      const R2 = rig(g2);
      paint(R2.albedo, ALB_WALL, [0.6, 0.6, 0.6]); paint(R2.albedo, ALB_FLOOR, [0.3, 0.3, 0.3]); paint(R2.albedo, ALB_CEIL, [0.3, 0.3, 0.3]);
      const fb2 = new FlashBounce();
      fb2.bind(R2.src);
      fb2.update(1 / 60, aim(spot(GAME), [12, 1.6, 10], [FACE_A, 1.6, 10]));
      return {fb: fb2, R2};
    };
    // a cell flagged as holding a sight-blocking prop on the beam's way (x 13 m, z 10 m), with no box handed in: the rays pass (the
    // ray scene holds the fixed architecture alone; the boxes are the occluders — the next block)
    const flagged = other(g2 => { g2.sightBlocked[20 * g2.w + 26] = 1; g2.blocked[20 * g2.w + 26] = 1; });
    expect(flagged.fb.vpls).toEqual(fb.vpls);
    // a pier (x 13.5 .. 14.5, z 12 .. 13, floor to ceiling) beside the beam: no ray lands on it, and the floor in its shadow
    // (the straight line from every light to that point runs through the pier) is lit as if it were not there
    const pier = other(g2 => { for (const cx of [27, 28]) for (const cz of [24, 25]) g2.set(cx, cz, SOLID); });
    expect(pier.fb.vpls).toEqual(fb.vpls);
    const shadowed: V3 = [14.2, 0, 13.5];
    expect(litOf(pier.fb)).toHaveLength(FLASH_SECTORS);
    for (const v of litOf(pier.fb)) {
      const d = sub(shadowed, posOf(v)), dir = unit(d);
      expect(pier.R2.scene.trace(v.x, v.y, v.z, dir[0], dir[1], dir[2], len(d) - 1e-3), 'the pier is in the way').toBe(true);
      expect(R.scene.trace(v.x, v.y, v.z, dir[0], dir[1], dir[2], len(d) - 1e-3)).toBe(false);
    }
    expect(lum(E(pier.fb, shadowed, [0, 1, 0]))).toBeGreaterThan(0.005);
    expect(E(pier.fb, shadowed, [0, 1, 0])).toEqual(E(fb, shadowed, [0, 1, 0]));
  });
});

// ---------------------------------------------------------------------------------------------
describe('what stops the beam: prop boxes and characters; glass passes', () => {
  // the tall hall: with nothing in the way the whole cone lands on the wall at x = 0.5 m
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.5, 0.5]);
  const WALL_X = CELL, FROM: V3 = [6.5, 15, 20], TO: V3 = [WALL_X, 15, 20];
  // a 12 m room, 4.4 m high (a character, the rink board, the random things)
  const M = rig(hall(24, 24));
  paint(M.albedo, ALB_WALL, [0.5, 0.5, 0.5]); paint(M.albedo, ALB_FLOOR, [0.3, 0.3, 0.3]); paint(M.albedo, ALB_CEIL, [0.6, 0.6, 0.6]);
  /** A slab standing in front of the whole beam: its face at x = 4 m. */
  const slab = (more: Partial<PropPlacement> = {}): PropPlacement => prop('column', 3.5, 20, 0.5, 10, 20, 5, more);
  const cast = (occ: FlashOccluders | null, o: SpotSpec = PHYSICAL, from: V3 = FROM, to: V3 = TO): FlashBounce => {
    const fb = new FlashBounce();
    fb.bind(R.src);
    fb.occlude(occ);
    fb.update(1 / 60, aim(spot(o), from, to));
    return fb;
  };
  const omega = spotConeSolidAngle(PHYSICAL.angle, PHYSICAL.penumbra);
  /**
   * A light on an upright cylinder (its axis at ax, az; its radius; its top): on its top inside its circle; on its side no farther
   * from the axis than the lift off its skin along the light's own normal, and beside the axis by less than the planes' angle lets
   * the centre of its hits lie (their normals agree with the light's to twice the angle) — over the cylinder, not past it.
   */
  const expectOnCylinder = (v: FlashVpl, ax: number, az: number, rad: number, top: number): void => {
    const e: V3 = [v.x - ax, 0, v.z - az], n = nrmOf(v);
    // (a character's place and radius are kept in single precision: a millionth of a metre)
    if (n[1] === 1) { expect(v.y).toBeCloseTo(top + LIFT, 6); expect(len(e)).toBeLessThanOrEqual(rad + 1e-6); return; }
    expect(n[1]).toBe(0);
    const along = dot(n, e), beside = len(sub(e, [n[0] * along, 0, n[2] * along]));
    expect(along, `a light at ${posOf(v)} facing ${n}`).toBeLessThanOrEqual(rad + LIFT + 1e-6);
    expect(along, `a light at ${posOf(v)} facing ${n}`).toBeGreaterThan(rad * Math.cos(2 * FLASH_BOUNCE_TUNING.planeAngle * Math.PI / 180));
    expect(beside, `a light at ${posOf(v)} facing ${n}`).toBeLessThanOrEqual(rad * Math.sin(2 * FLASH_BOUNCE_TUNING.planeAngle * Math.PI / 180));
    expect(v.y > 0 && v.y < top).toBe(true);
  };

  it('a prop box in front of the wall: every light stands on IT with its colour, none beyond it', () => {
    const fb = cast(flashOccluders({props: [slab()]}));
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: FLASH_RAYS, onBodies: 0, candidates: 1, occluded: true, lights: FLASH_SECTORS, fading: 0, dropped: 0});
    for (const r of fb.rays()) {
      expect(r.on).toBe('prop');
      expect(r.x).toBe(4);
      expect([r.nx, r.ny, r.nz]).toEqual([1, 0, 0]);
      expect(r.t).toBeCloseTo(len(sub([r.x, r.y, r.z], FROM)), 12);
    }
    for (const v of litOf(fb)) { expect(v.x).toBeCloseTo(4 + LIFT, 12); expect(nrmOf(v)).toEqual([1, 0, 0]); }
    // the box's colour (its kind's), and all of the beam's flux
    const a = flashPropAlbedo('column'), f = flux(fb);
    for (let c = 0; c < 3; c++) expect(f[c] / (a[c] * PHYSICAL.intensity * omega), `channel ${c}`).toBeCloseTo(1, 9);
    expectLightsAreTheirRays(fb, spot(PHYSICAL));
    // without it: the wall, 3.5 m further
    const bare = cast(null);
    expect(bare.debug()).toMatchObject({onProps: 0, candidates: 0, occluded: false});
    for (const v of litOf(bare)) expect(v.x).toBeCloseTo(WALL_X + LIFT, 12);
    expect(flux(bare)[0] / (rho[0] * PHYSICAL.intensity * omega)).toBeCloseTo(1, 9);
  });

  it('a box in part of the beam: its rays stay on it, the others land on the wall behind — every light on one of the two, each the sum of the rays it carries', () => {
    const half = prop('column', 3.5, 25.125, 0.5, 4.875, 20, 5); // from z = 20.25 on: its face at x = 4, its side at z = 20.25
    const fb = cast(flashOccluders({props: [half]}), GAME), d = fb.debug();
    expect(d.onProps).toBeGreaterThan(8);
    expect(d.hits - d.onProps).toBeGreaterThan(8);
    for (const r of fb.rays()) {
      // where the ray's line crosses the box's front and back planes
      const at = (x: number): number => FROM[2] + (r.z - FROM[2]) * (FROM[0] - x) / (FROM[0] - r.x);
      if (r.on === 'prop') {
        expect(r.x === 4 ? r.z >= 20.25 && r.nx === 1 : r.z === 20.25 && r.nz === -1 && r.x > 3 && r.x < 4).toBe(true);
      } else {
        expect(r.on).toBe('architecture');
        expect(r.x).toBe(WALL_X);
        expect(Math.max(at(4), at(3))).toBeLessThan(20.25);
      }
    }
    const on = {box: 0, side: 0, wall: 0};
    for (const v of litOf(fb)) {
      const box = Math.abs(v.x - (4 + LIFT)) < 1e-9 && v.nx === 1 && v.z >= 20.25, side = Math.abs(v.z - (20.25 - LIFT)) < 1e-9 && v.nz === -1 && v.x >= 3 && v.x <= 4;
      const wall = Math.abs(v.x - (WALL_X + LIFT)) < 1e-9 && v.nx === 1;
      expect(box || side || wall, `a light at ${posOf(v)}`).toBe(true);
      if (box) on.box++; else if (side) on.side++; else on.wall++;
    }
    expect(on.box).toBeGreaterThan(0);
    expect(on.wall).toBeGreaterThan(0);
    expectLightsAreTheirRays(fb, spot(GAME));
  });

  it('a round prop is its upright cylinder: the lights stand on the curve and face out of it', () => {
    const RAD = 2.5, CX = 3.5, CZ = 20, from: V3 = [8.5, 15, 20];
    const fb = cast(flashOccluders({props: [prop('column', CX, CZ, RAD, RAD, 20, 5, {round: true})]}), GAME, from);
    // (5 m from its axis the cylinder is wider than the cone that holds the rays)
    expect(fb.debug().ringAngle).toBeLessThan(Math.asin(RAD / 5));
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: FLASH_RAYS, candidates: 1});
    for (const r of fb.rays()) {
      const out: V3 = [(r.x - CX) / RAD, 0, (r.z - CZ) / RAD];
      expect(len(out)).toBeCloseTo(1, 9);
      [r.nx, r.ny, r.nz].forEach((c, q) => expect(c).toBeCloseTo(out[q], 9));
    }
    const facing = new Set<string>();
    for (const v of litOf(fb)) {
      const q = Math.hypot(v.x - CX, v.z - CZ), out: V3 = [(v.x - CX) / q, 0, (v.z - CZ) / q];
      expect(Math.abs(q - RAD), 'on the curve, to the planes\' gap').toBeLessThanOrEqual(FLASH_BOUNCE_TUNING.planeGap);
      expect(dot(nrmOf(v), out), 'facing out').toBeGreaterThanOrEqual(Math.cos(FLASH_BOUNCE_TUNING.planeAngle * Math.PI / 180) - 1e-9);
      expect(len(nrmOf(v))).toBeCloseTo(1, 12);
      expect(v.x).toBeGreaterThan(CX + 1.5); // the lit side; nothing at the wall behind
      facing.add(nrmOf(v).map(c => c.toFixed(2)).join());
    }
    expect(litOf(fb).length).toBeGreaterThanOrEqual(4);
    expect(facing.size).toBeGreaterThanOrEqual(3);
    expectLightsAreTheirRays(fb, spot(GAME));
  });

  it('a character is an upright cylinder of dark cloth: the rays it takes stay on it, the rest pass; the dead, the fallen and wall crawlers are no cylinder', () => {
    const actor = (brain: Partial<FlashBodyActor['brain']> = {}, more: Partial<FlashBodyActor> = {}): FlashBodyActor => ({brain: {x: 4.8, y: 0, z: 6, alive: true, stats: {radius: 0.35}, ...brain}, ragdolled: false, ...more});
    const run = (actors: FlashBodyActor[]): {fb: FlashBounce; occ: StationFlashOccluders} => {
      const fb = new FlashBounce(), occ = flashOccluders({props: []});
      fb.bind(M.src);
      fb.occlude(occ);
      occ.setBodies(actors, {x: 6, z: 6});
      fb.update(1 / 60, aim(spot(GAME), [6, 1.5, 6], [0.5, 1.5, 6]));
      return {fb, occ};
    };
    const {fb, occ} = run([actor()]), d = fb.debug();
    expect(d).toMatchObject({hits: FLASH_RAYS, onProps: 0, candidates: 1});
    expect(d.onBodies).toBeGreaterThanOrEqual(8);
    expect(d.hits - d.onBodies).toBeGreaterThanOrEqual(8);
    // on its side (0.35 m from its axis, no higher than 1.7 m: a body with no height of its own), or on its top
    for (const r of fb.rays()) if (r.on === 'body') {
      const q = Math.hypot(r.x - 4.8, r.z - 6);
      if (r.ny === 1) { expect(r.y).toBeCloseTo(1.7, 6); expect(q).toBeLessThanOrEqual(0.35 + 1e-6); } else { expect(q).toBeCloseTo(0.35, 6); expect(r.y).toBeLessThanOrEqual(1.7 + 1e-6); }
    }
    // the lights that carry its rays carry nothing else: the cloth's colour times the light's
    const c = new THREE.Color(GAME.color), cloth = occ.bodyAlbedo;
    const carriers = new Set(fb.rays().filter(r => r.on === 'body' && r.light >= 0).map(r => r.light));
    expect(carriers.size).toBeGreaterThan(0);
    expect(lum(cloth)).toBeLessThan(0.12);
    for (const i of carriers) {
      const v = fb.vpls[i];
      expect(v.g / v.r).toBeCloseTo(cloth[1] * c.g / (cloth[0] * c.r), 9);
      expect(v.b / v.r).toBeCloseTo(cloth[2] * c.b / (cloth[0] * c.r), 9);
      expectOnCylinder(v, 4.8, 6, 0.35, 1.7);
    }
    expectLightsAreTheirRays(fb, spot(GAME));
    // no character: the same as none listed
    const none = copy(run([]).fb);
    expect(run([]).fb.debug()).toMatchObject({onBodies: 0, candidates: 0});
    for (const a of [actor({alive: false}), actor({}, {ragdolled: true}), actor({climbing: true}, {placesRoot: true}), actor({x: 40})]) expect(run([a]).fb.vpls).toEqual(none);
    // (a creature that places its own root and is on the floor is a cylinder like any other)
    expect(run([actor({climbing: false}, {placesRoot: true})]).fb.debug().onBodies).toBe(d.onBodies);
  });

  it('a character close up takes the whole beam: every light stands on it, none on the wall 5 m behind it; a thin prop close up likewise', () => {
    // the light 0.6 m from its axis (0.25 m from its chest), chest high: it is wider than the cone that holds the rays
    const from: V3 = [6, 1.3, 6], to: V3 = [0.5, 1.3, 6], AX = 5.4, RAD = 0.35;
    const fb = new FlashBounce(), occ = flashOccluders({props: []}), s = aim(spot(GAME), from, to);
    fb.bind(M.src);
    fb.occlude(occ);
    occ.setBodies([{brain: {x: AX, y: 0, z: 6, alive: true, stats: {radius: RAD}}, ragdolled: false}], {x: from[0], z: from[2]});
    fb.update(1 / 60, s);
    const d = fb.debug();
    expect(d.ringAngle).toBeLessThan(Math.asin(RAD / (from[0] - AX)));
    expect(d).toMatchObject({hits: FLASH_RAYS, onBodies: FLASH_RAYS, onProps: 0, candidates: 1});
    for (const r of fb.rays()) { expect(r.on).toBe('body'); expect(Math.hypot(r.x - AX, r.z - 6)).toBeCloseTo(RAD, 6); expect(r.t).toBeLessThan(from[0] - AX); }
    let farthest = 0;
    for (const v of litOf(fb)) {
      farthest = Math.max(farthest, Math.hypot(v.x - AX, v.z - 6));
      // on its lit side, between its feet and its head, the lift off its skin at the most
      expectOnCylinder(v, AX, 6, RAD, 1.7);
      expect(v.x).toBeGreaterThan(AX);
    }
    // (5 m and more in front of the wall behind it)
    expect(farthest).toBeLessThan(RAD + 2 * LIFT);
    const sums = expectLightsAreTheirRays(fb, s);
    console.log(`flash bounce, a character 0.25 m in front of the light: ${d.onBodies} of ${FLASH_RAYS} rays on it, ${litOf(fb).length} lights lit (${d.extra} extra), none farther than ${farthest.toFixed(3)} m from its axis ` +
      `(its radius ${RAD} m + the lift ${LIFT} m); ${(d.dropped * 100).toFixed(1)} % of its flux on a facet no light stands on`);
    expect(litOf(fb).length).toBeGreaterThanOrEqual(3);
    expect(sums.lost / (sums.lost + sums.carried)).toBeLessThan(0.05);
    // the flux: the dark cloth's, of every ray that stands on a light
    const cloth = occ.bodyAlbedo, c = new THREE.Color(GAME.color);
    for (const v of litOf(fb)) { expect(v.g / v.r).toBeCloseTo(cloth[1] * c.g / (cloth[0] * c.r), 9); expect(v.b / v.r).toBeCloseTo(cloth[2] * c.b / (cloth[0] * c.r), 9); }
    // the character gone: the lights are on the wall, 5.5 m from the light
    occ.setBodies([], {x: from[0], z: from[2]});
    fb.bind(M.src);
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onBodies: 0, candidates: 0});
    expect(litOf(fb).some(v => Math.abs(v.x - (0.5 + LIFT)) < 1e-9 && v.nx === 1)).toBe(true);
    // a signpost close up (a prop box 0.4 m wide and 0.1 m thick, its face 0.25 m from the light): the same — nothing beyond it
    const post = prop('column', 5.7, 6, 0.05, 0.2, 2.2);
    fb.occlude(flashOccluders({props: [post]}));
    fb.bind(M.src);
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: FLASH_RAYS, candidates: 1, dropped: 0});
    for (const v of litOf(fb)) { expect(v.x).toBeCloseTo(5.75 + LIFT, 12); expect(nrmOf(v)).toEqual([1, 0, 0]); expect(Math.abs(v.z - 6)).toBeLessThan(0.2); }
  });

  it('gone and glass: a box no higher than 0.02 m, shop glazing, a pane by the caller\'s word — the beam passes as if nothing stood there', () => {
    const bare = copy(cast(null));
    const pane = slab();
    const cases: Record<string, FlashBounce> = {
      'h = 0 (carried off, melted, loose)': cast(flashOccluders({props: [slab({h: 0})]})),
      'h = 0.02 (broken down)': cast(flashOccluders({props: [slab({h: 0.02})]})),
      'shop glazing': cast(flashOccluders({props: [slab({kind: 'shopGlazing'})]})),
      'a pane by the caller\'s word (the train\'s windows)': cast(flashOccluders({props: [pane]}, b => b === pane)),
    };
    for (const [name, fb] of Object.entries(cases)) {
      expect(fb.vpls, name).toEqual(bare);
      expect(fb.debug(), name).toMatchObject({hits: FLASH_RAYS, onProps: 0, candidates: 0, occluded: true});
    }
    // the same box, not glass to the caller: it stops everything
    expect(cast(flashOccluders({props: [pane]}, () => false)).debug().onProps).toBe(FLASH_RAYS);
  });

  it('glazing on a solid base (the rink\'s dasher boards): the boards stop the beam, the glass above them passes it', () => {
    const top = FLASH_GLAZING.get('hkRinkBoard')!;
    expect(top).toBe(1.1);
    const board = prop('hkRinkBoard', 4, 6, 0.0625, 5.5, 1.875), from: V3 = [6, 1.5, 6];
    const fb = new FlashBounce();
    fb.bind(M.src);
    fb.occlude(flashOccluders({props: [board]}));
    fb.update(1 / 60, aim(spot(GAME), from, [0.5, 1.5, 6]));
    let stopped = 0, passed = 0, onTop = 0;
    for (const r of fb.rays()) {
      // where the ray's line is when it crosses the board's near face and its far face
      const d = unit(sub([r.x, r.y, r.z], from)), yNear = from[1] + d[1] * (4.0625 - from[0]) / d[0], yFar = from[1] + d[1] * (3.9375 - from[0]) / d[0];
      if (r.on === 'prop') {
        stopped++;
        if (r.x === 4.0625) { expect(yNear).toBeLessThanOrEqual(top + 1e-9); expect([r.nx, r.ny, r.nz]).toEqual([-1 + 2, 0, 0]); } else {
          onTop++;
          expect(r.y).toBe(top);
          expect([r.nx, r.ny, r.nz]).toEqual([0, 1, 0]);
          expect(yNear > top && yFar < top).toBe(true);
        }
      } else {
        passed++;
        expect(Math.min(yNear, yFar), 'over the boards').toBeGreaterThan(top);
        expect(r.x).toBeLessThan(3.9);
      }
    }
    // the boards' share of the beam: what lies under the line from the light over the far edge of their top (to the rays' own graining)
    const owed = fluxLeftOf(GAME)((top - from[1]) / (from[0] - 3.9375)) * FLASH_RAYS;
    console.log(`flash bounce, a rink board 2 m ahead: ${stopped} rays on the boards (${onTop} on their top edge) of ${owed.toFixed(2)} owed, ${passed} through the glass`);
    expect(Math.abs(stopped - owed)).toBeLessThan(1.5);
    expect(passed).toBe(FLASH_RAYS - stopped);
    expect(Math.min(stopped, passed)).toBeGreaterThanOrEqual(5);
    expectLightsAreTheirRays(fb, spot(GAME));
  });

  it('the list is LIVE: a box pushed in or spliced out between two updates is seen by the next one; a list the layout swaps for another is followed', () => {
    const layout = {props: [] as PropPlacement[]};
    const fb = new FlashBounce(), s = aim(spot(PHYSICAL), FROM, TO), a = 1 - Math.exp(-(1 / 60) / FLASH_BOUNCE_TAU);
    fb.bind(R.src);
    fb.occlude(flashOccluders(layout));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: 0, candidates: 0, occluded: true});
    const wall = copy(fb).slice(0, FLASH_SECTORS), box = copy(cast(flashOccluders({props: [slab()]}))).slice(0, FLASH_SECTORS);
    // pushed: every ray is on it at once; the sectors' lights start on it from nothing, the wall's light stays behind as ONE fading light
    layout.props.push(slab());
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: FLASH_RAYS, candidates: 1, lights: FLASH_SECTORS, fading: 1});
    fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => {
      expect([posOf(v), nrmOf(v), v.r0sq]).toEqual([posOf(box[i]), nrmOf(box[i]), box[i].r0sq]);
      rgbOf(v).forEach((c, q) => expect(c).toBeCloseTo(rgbOf(box[i])[q] * a, 12));
    });
    const W = wall.reduce((t, v) => t + v.r + v.g + v.b, 0), centre = [0, 1, 2].map(q => wall.reduce((t, v) => t + (v.r + v.g + v.b) * posOf(v)[q], 0) / W);
    const spread = wall.reduce((t, v) => t + (v.r + v.g + v.b) * len(sub(posOf(v), centre)) ** 2, 0) / W, sizes = wall.reduce((t, v) => t + v.r0sq, 0);
    const gone = fb.vpls[FLASH_SECTORS];
    posOf(gone).forEach((c, q) => expect(c).toBeCloseTo(centre[q], 9));
    expect(nrmOf(gone)).toEqual([1, 0, 0]);
    expect(gone.x).toBeCloseTo(WALL_X + LIFT, 12);
    expect(gone.r).toBeCloseTo(wall.reduce((t, v) => t + v.r, 0) * (1 - a), 9);
    // (as large as the six patches and their spread; joined one by one, a little more than their common spread)
    expect(gone.r0sq).toBeGreaterThanOrEqual(sizes + spread - 1e-9);
    expect(gone.r0sq).toBeLessThanOrEqual(sizes + 2 * spread);
    expect(isOn(fb.vpls[FLASH_SECTORS + 1])).toBe(false);
    // 0.3 s on: the wall's light is all but gone, the box's lights are there
    for (let k = 0; k < 18; k++) fb.update(1 / 60, s);
    expect(fluxOf(fb.vpls.slice(FLASH_SECTORS)) / fluxOf(wall)).toBeLessThan(0.05);
    expect(fluxOf(fb.vpls.slice(0, FLASH_SECTORS)) / fluxOf(box)).toBeGreaterThan(0.95);
    for (let k = 0; k < 300; k++) fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({lights: FLASH_SECTORS, fading: 0});
    // (a fading light that is out is all zero)
    for (const v of fb.vpls.slice(FLASH_SECTORS)) expect(Object.values(v)).toEqual(new Array(10).fill(0));
    // spliced out: the rays are back on the wall in the next update, and the box's light stays behind as the fading one
    layout.props.splice(0, 1);
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: 0, candidates: 0, lights: FLASH_SECTORS, fading: 1});
    fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => {
      expect([posOf(v), nrmOf(v)]).toEqual([posOf(wall[i]), nrmOf(wall[i])]);
      expect(v.r).toBeCloseTo(wall[i].r * a, 12);
    });
    expect(fb.vpls[FLASH_SECTORS].x).toBeCloseTo(4 + LIFT, 12);
    expect(fb.vpls[FLASH_SECTORS].r).toBeCloseTo(box.reduce((t, v) => t + v.r, 0) * (1 - a), 9);
    // the layout's list swapped for another (the game drops unloaded props that way before a station is built)
    layout.props = [prop('column', 2.5, 20, 0.5, 10, 20, 5)];
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: FLASH_RAYS, candidates: 1});
    for (const r of fb.rays()) expect(r.x).toBe(3);
  });

  it('a box the rays start in is not there for them (the player inside the train\'s shell box, or hugging furniture); the others still are', () => {
    const bare = copy(cast(null));
    const shell = prop('column', 6.5, 20, 1.5, 1.5, 4, 13), drum = prop('column', 6.5, 20, 1.5, 1.5, 4, 13, {round: true});
    for (const inside of [shell, drum]) {
      const fb = cast(flashOccluders({props: [inside]}));
      expect(fb.vpls).toEqual(bare);
      expect(fb.debug()).toMatchObject({candidates: 0, onProps: 0});
    }
    const body = flashOccluders({props: []});
    body.setBodies([{brain: {x: 6.5, y: 14, z: 20, alive: true, stats: {radius: 0.4, height: 2}}, ragdolled: false}], {x: 6.5, z: 20});
    expect(body.bodyCount).toBe(1);
    expect(cast(body).vpls).toEqual(bare);
    expect(cast(flashOccluders({props: [shell, slab()]})).debug()).toMatchObject({candidates: 1, onProps: FLASH_RAYS});
    // from just under the same box, looking up: its underside stops every ray
    const under = cast(flashOccluders({props: [shell]}), PHYSICAL, [6.5, 12, 20], [6.5, 30, 20]);
    expect(under.debug()).toMatchObject({candidates: 1, onProps: FLASH_RAYS});
    for (const r of under.rays()) { expect(r.y).toBe(13); expect([r.nx, r.ny, r.nz]).toEqual([0, -1, 0]); }
    for (const v of litOf(under)) { expect(v.y).toBeCloseTo(13 - LIFT, 12); expect(nrmOf(v)).toEqual([0, -1, 0]); }
  });

  it('every ray lands on the nearest of the architecture, a box\'s solid part, a cylinder and a character: ray by ray against the test\'s own intersection of the whole list', () => {
    let seed = 0x9e3779b1;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const kinds = ['column', 'crate', 'bench', 'vending', 'shopGlazing', 'hkRinkBoard'];
    const props = Array.from({length: 70}, () => {
      const round = rnd() < 0.2, hx = 0.05 + rnd() * 0.55, hz = round ? hx : 0.05 + rnd() * 0.55, h = rnd() < 0.1 ? (rnd() < 0.5 ? 0 : 0.02) : 0.3 + rnd() * 2.4;
      return prop(kinds[Math.floor(rnd() * kinds.length)], 1.5 + rnd() * 9, 1.5 + rnd() * 9, hx, hz, h, rnd() < 0.25 ? 0.4 + rnd() * 2 : 0, round ? {round: true} : {});
    });
    const actors: FlashBodyActor[] = Array.from({length: 12}, () => ({brain: {x: 1.5 + rnd() * 9, y: 0, z: 1.5 + rnd() * 9, alive: true, stats: {radius: 0.3 + rnd() * 0.1, ...(rnd() < 0.5 ? {height: 1.2 + rnd()} : {})}}, ragdolled: false}));
    const occ = flashOccluders({props}), fb = new FlashBounce(), s = spot(GAME);
    fb.occlude(occ);
    const tally = {architecture: 0, prop: 0, body: 0, none: 0};
    let inside = 0, most = 0;
    for (let k = 0; k < 80; k++) {
      const from: V3 = [1 + rnd() * 10, 0.3 + rnd() * 3.5, 1 + rnd() * 10], to: V3 = [rnd() * 12, rnd() * 4.4, rnd() * 12];
      occ.setBodies(actors, {x: from[0], z: from[2]});
      const bodies = bodiesOf(occ);
      expect(bodies).toHaveLength(actors.length);
      if (props.some(p => solidTop(p) > 0.02 && from[1] >= p.y && from[1] <= p.y + solidTop(p) && Math.abs(p.x - from[0]) <= p.hx && Math.abs(p.z - from[2]) <= p.hz)) inside++;
      fb.bind(M.src);
      fb.update(1 / 60, aim(s, from, to));
      most = Math.max(most, fb.debug().candidates);
      fb.rays().forEach((r, j) => {
        tally[r.on]++;
        if (r.on === 'none') return;
        const want = nearest(M.scene, props, bodies, from, unit(sub([r.x, r.y, r.z], from)), GAME.distance);
        expect(want.on, `pose ${k} ray ${j}`).toBe(r.on);
        expect(want.t, `pose ${k} ray ${j}`).toBeCloseTo(r.t, 9);
        [r.nx, r.ny, r.nz].forEach((c, q) => expect(c, `pose ${k} ray ${j} normal ${q}`).toBeCloseTo(want.n[q], 9));
      });
      expectLightsAreTheirRays(fb, s, `pose ${k}`);
    }
    console.log(`flash bounce, 80 poses among 70 boxes / cylinders and 12 characters in a room: ${tally.prop} rays on props, ${tally.body} on characters, ${tally.architecture} on the room, ` +
      `${tally.none} nowhere; at most ${most} things in the beam at once; the light stood inside a box at ${inside} poses`);
    expect(tally.none).toBe(0);
    expect(Math.min(tally.prop, tally.body, tally.architecture)).toBeGreaterThan(150);
    expect(inside).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('a thin thing in the beam takes its share of the rays and no more', () => {
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.5, 0.5]);
  const WALL_X = CELL, FROM: V3 = [WALL_X + 6, 15, 20], TO: V3 = [WALL_X, 15, 20];
  const left = fluxLeftOf(GAME);
  // 2 m in front of the light: a pole 0.1 m square from floor to ceiling, `s` m to the side; a bar 0.1 m thick right across, `s` m up
  const pole = (s: number): PropPlacement => prop('column', WALL_X + 4, 20 + s, 0.05, 0.05, 30);
  const bar = (s: number): PropPlacement => prop('column', WALL_X + 4, 20, 0.05, 15, 0.1, 15 + s - 0.05);
  /** Its outline seen from the light: the tangents (of the angle off the axis) between which it stands. */
  const outline = (s: number): [number, number] => { const t = [s - 0.05, s + 0.05].flatMap(v => [v / 1.95, v / 2.05]); return [Math.min(...t), Math.max(...t)]; };
  const cast = (occ: FlashOccluders | null, o: SpotSpec): FlashBounce => { const fb = new FlashBounce(); fb.bind(R.src); fb.occlude(occ); fb.update(1 / 60, aim(spot(o), FROM, TO)); return fb; };
  const SLIDE = Array.from({length: 261}, (_, i) => (i - 130) / 100); // 1 cm at a time, from 1.3 m on one side to 1.3 m on the other

  it('a black pole 0.1 m wide at 2 m: in the middle and all the way across it holds its share of the rays to one ray, and the wall keeps every other ray', () => {
    const omega = spotConeSolidAngle(PHYSICAL.angle, PHYSICAL.penumbra);
    for (const [name, thing] of [['pole', pole], ['bar', bar]] as const) {
      let most = 0, over = -Infinity, under = -Infinity, step = 0, last = -1, middle = 0;
      for (const s of SLIDE) {
        const fb = cast(literal([thing(s)], [0, 0, 0]), PHYSICAL), k = fb.debug().onProps, [lo, hi] = outline(s), owed = (left(hi) - left(lo)) * FLASH_RAYS;
        most = Math.max(most, k); over = Math.max(over, k - owed); under = Math.max(under, owed - k);
        if (last >= 0) step = Math.max(step, Math.abs(k - last));
        last = k;
        if (s === 0) middle = k;
        // the wall's light: the rays that pass, exactly — (30 - k) thirtieths of rho x the beam's flux — and no light anywhere else
        expect(flux(fb)[0] / (rho[0] * PHYSICAL.intensity * omega), `${name} at ${s}`).toBeCloseTo((FLASH_RAYS - k) / FLASH_RAYS, 9);
        for (const v of litOf(fb)) expect(v.x, `${name} at ${s}`).toBeCloseTo(WALL_X + LIFT, 12);
      }
      const owed0 = (left(outline(0)[1]) - left(outline(0)[0])) * FLASH_RAYS;
      console.log(`flash bounce, a ${name} 0.1 m wide 2 m ahead: in the beam's middle it is owed ${owed0.toFixed(2)} of ${FLASH_RAYS} rays and takes ${middle}; slid across in 1 cm steps it takes at most ${most}, ` +
        `at most ${over.toFixed(2)} rays over and ${under.toFixed(2)} under its share, and at most ${step} rays change in a step`);
      expect(middle, name).toBeLessThanOrEqual(owed0 + 1);
      expect(over, name).toBeLessThan(1.1);
      expect(under, name).toBeLessThan(1.5);
      expect(step, name).toBeLessThanOrEqual(2);
    }
  });

  it('the game\'s light past a steel pole: sliding it across the beam never steps the bounce by more than two rays\' worth', () => {
    const bare = cast(null, GAME), c = new THREE.Color(GAME.color);
    // a ray's worth: what the brightest single ray sends back off the wall (a ray at the cone's edge lands farther and carries a little more)
    const worth = Math.max(...bare.rays().map(r => lum([r.transfer[0] * c.r, r.transfer[1] * c.g, r.transfer[2] * c.b]) * GAME.intensity * Math.PI));
    expect(worth / (fluxOf(bare.vpls) / FLASH_RAYS)).toBeLessThan(1.15);
    for (const [name, thing] of [['pole', pole], ['bar', bar]] as const) {
      let step = 0, last = NaN, least = Infinity;
      for (const s of SLIDE) {
        const fb = cast(flashOccluders({props: [thing(s)]}), GAME), f = fluxOf(fb.vpls);
        if (!Number.isNaN(last)) step = Math.max(step, Math.abs(f - last));
        last = f; least = Math.min(least, f);
        for (const v of litOf(fb)) expect(Math.abs(v.x - (WALL_X + LIFT)) < 1e-9 || Math.abs(v.x - (WALL_X + 4.05 + LIFT)) < 1e-9 || v.nx === 0, `${name} at ${s}: a light at ${posOf(v)}`).toBe(true);
      }
      console.log(`flash bounce, the game's beam past a steel ${name} 0.1 m wide: the bounce is ${(least / fluxOf(bare.vpls) * 100).toFixed(1)} % of the open beam's at the least; the largest change in a 1 cm step is ${(step / worth).toFixed(2)} rays' worth`);
      expect(step, name).toBeLessThanOrEqual(2 * worth);
      expect(least / fluxOf(bare.vpls), name).toBeGreaterThan(1 - 4.5 / FLASH_RAYS);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('on a surface, always: aim sweeps and a sudden turn', () => {
  // a 12 m room, 4.4 m high, and a column (a prop box 0.6 m square, floor to ceiling) 4.7 m in front of the player
  const R = rig(hall(24, 24));
  paint(R.albedo, ALB_WALL, [0.5, 0.4, 0.3]); paint(R.albedo, ALB_FLOOR, [0.3, 0.3, 0.3]); paint(R.albedo, ALB_CEIL, [0.6, 0.6, 0.6]);
  const column = prop('column', 3.25, 6, 0.25, 0.25, 4.4);
  const AXES = ['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1'];
  /** What a light stands on: the architecture a ray cast back along its normal finds at exactly the lift, with that very normal; or a face of the column. */
  const standsOn = (v: FlashVpl): 'architecture' | 'prop' | null => {
    const n = nrmOf(v);
    if (R.scene.trace(v.x, v.y, v.z, -n[0], -n[1], -n[2], 4 * LIFT) && Math.abs(R.scene.hitT - LIFT) < 1e-9) {
      const hn = R.scene.hitKind === HIT_FLOOR ? [0, 1, 0] : R.scene.hitKind === HIT_CEIL ? [0, -1, 0] : [R.scene.hitNx, 0, R.scene.hitNz];
      if (hn[0] === n[0] && hn[1] === n[1] && hn[2] === n[2]) return 'architecture';
    }
    const q = [v.x - n[0] * LIFT, v.y - n[1] * LIFT, v.z - n[2] * LIFT], lo = [column.x - column.hx, 0, column.z - column.hz], hi = [column.x + column.hx, column.h, column.z + column.hz];
    for (let a = 0; a < 3; a++) {
      if (n[a] === 0) continue;
      const b = (a + 1) % 3, c = (a + 2) % 3;
      if (Math.abs(q[a] - (n[a] > 0 ? hi[a] : lo[a])) < 1e-9 && q[b] >= lo[b] - 1e-9 && q[b] <= hi[b] + 1e-9 && q[c] >= lo[c] - 1e-9 && q[c] <= hi[c] + 1e-9) return 'prop';
    }
    return null;
  };
  interface Sweep { name: string; seconds: number; at(t: number): [number, number] }
  const SWEEPS: Sweep[] = [
    {name: 'down the wall, across the wall / floor edge, onto the floor', seconds: 1, at: t => [Math.PI / 2 + 0.45, 0.35 - 1.6 * t]},
    {name: 'along the wall past the column', seconds: 1.2, at: t => [Math.PI / 2 - 0.9 + 1.5 * t, -0.12]},
    {name: 'up over the column to the ceiling and round', seconds: 1.5, at: t => [Math.PI / 2 - 0.5 + 0.9 * t, -0.5 + 1.4 * t]},
  ];

  interface SweepRow { hz: number; name: string; frames: number; room: number; column: number; ways: number; fading: number; dropped: number; lo: number; hi: number; step: number; gone: number }
  /**
   * One sweep at one frame rate with the game's light. At every frame every lit light is checked: it lies on a traced surface with
   * that surface's own normal. And the lights' flux is followed: against the SETTLED flux of each pose (a bounce switched on there),
   * and against what it is due to be — last frame's, drawn 1 - exp(-dt / tau) of the way to the flux of the rays the lights carry
   * (every light takes up that share of what changed, a fading light loses it, whatever planes the lights changed between). It is
   * never above that; it is under it by what a light given up in that frame let go.
   */
  const gameSweep = (hz: number, sweep: Sweep): SweepRow => {
    const fb = new FlashBounce(), there = new FlashBounce(), G = gameRig(), occ = flashOccluders({props: [column]});
    fb.bind(R.src);
    fb.occlude(occ);
    there.occlude(occ);
    const planes = new Set<string>(), a = 1 - Math.exp(-(1 / hz) / FLASH_BOUNCE_TAU), n = Math.round(sweep.seconds * hz);
    const row: SweepRow = {hz, name: sweep.name, frames: n + 1, room: 0, column: 0, ways: 0, fading: 0, dropped: 0, lo: Infinity, hi: 0, step: 0, gone: 0};
    let last = NaN, top = 0;
    for (let k = 0; k <= n; k++) {
      const [yaw, pitch] = sweep.at(k / hz);
      G.pose(8, 1.62, 6, yaw, pitch);
      fb.update(1 / hz, G.light);
      const d = fb.debug();
      expect(d.hits, `${sweep.name} step ${k}`).toBe(FLASH_RAYS);
      row.fading = Math.max(row.fading, d.fading);
      row.dropped = Math.max(row.dropped, d.dropped);
      for (const v of litOf(fb)) {
        expect(AXES, `${sweep.name} @ ${hz} Hz step ${k}: a light's normal ${nrmOf(v)}`).toContain(nrmOf(v).join());
        const what = standsOn(v);
        expect(what, `${sweep.name} @ ${hz} Hz step ${k}: a light at ${posOf(v)} facing ${nrmOf(v)}`).not.toBeNull();
        if (what === 'prop') row.column++; else row.room++;
        planes.add(nrmOf(v).join());
      }
      there.bind(R.src);
      there.update(1 / hz, G.light);
      expect(there.debug().dropped).toBe(0);
      const f = fluxOf(fb.vpls), settled = fluxOf(there.vpls);
      top = Math.max(top, f);
      row.lo = Math.min(row.lo, f / settled); row.hi = Math.max(row.hi, f / settled);
      if (k > 0) {
        row.step = Math.max(row.step, Math.abs(f - last));
        const due = last + a * (carriedFlux(fb, G.light) - last);
        expect(f, `${sweep.name} @ ${hz} Hz step ${k}: the flux never jumps up`).toBeLessThanOrEqual(due * (1 + 1e-9));
        row.gone = Math.max(row.gone, due - f);
      }
      last = f;
    }
    row.ways = planes.size; row.step /= top; row.gone /= top;
    return row;
  };
  /**
   * Stated bounds (measured over the three sweeps at the three frame rates, with a margin):
   *  STEP — the largest change of the lights' flux in one frame, of its peak over the sweep (measured: 5.5 % at 30 Hz, 3.2 % at
   *         60 Hz, 1.6 % at 144 Hz — the frame's share of the way to where the beam now is, nothing sudden);
   *  BAND — the lights' flux against the settled flux of the frame's pose (measured: 88 % to 123 %: the lights trail the beam by the
   *         time constant, so sweeping fast onto a darker or nearer surface they are over it for a moment, onto a brighter one under);
   *  LOST — the share of the landed flux on a plane no light is free for (`dropped`; measured: 1.1 % at the most), and what a light
   *         given up for a new plane lets go at once in a frame, of the peak (measured: 0.7 % at the most; none in three sweeps).
   */
  const STEP: Record<number, number> = {30: 0.07, 60: 0.04, 144: 0.02}, BAND: [number, number] = [0.85, 1.3], LOST = 0.02;

  it('every lit light, at every step of the sweeps, lies on a traced surface with that surface\'s own normal — never between two; the flux follows the pose\'s settled flux with the time constant and has no pop (30, 60 and 144 Hz)', () => {
    const rows = [30, 60, 144].flatMap(hz => SWEEPS.map(sweep => gameSweep(hz, sweep)));
    for (const r of rows) {
      console.log(`flash bounce, aim sweep "${r.name}" at ${r.hz} Hz (${r.frames} frames): lights on the room ${r.room}, on the column ${r.column}, facing ${r.ways} ways, up to ${r.fading} fading, at most ${(r.dropped * 100).toFixed(2)} % dropped; ` +
        `the flux is ${(r.lo * 100).toFixed(1)} % .. ${(r.hi * 100).toFixed(1)} % of the pose's settled flux; its largest change in a frame is ${(r.step * 100).toFixed(2)} % of its peak; ` +
        `a light given up lets go at most ${(r.gone * 100).toFixed(3)} % of its peak in a frame`);
    }
    for (const r of rows) {
      const label = `${r.name} @ ${r.hz} Hz`;
      expect(r.ways, label).toBeGreaterThanOrEqual(2);
      expect(r.fading, label).toBeGreaterThanOrEqual(1);
      expect(r.step, label).toBeLessThan(STEP[r.hz]);
      expect(r.lo, label).toBeGreaterThan(BAND[0]);
      expect(r.hi, label).toBeLessThan(BAND[1]);
      expect(r.dropped, label).toBeLessThan(LOST);
      expect(r.gone, label).toBeLessThan(LOST);
    }
    // in some sweeps no light is ever given up: there the flux is exactly what it is due to be at every frame
    expect(rows.filter(r => r.gone < 1e-6).length).toBeGreaterThanOrEqual(3);
  });

  it('with a physical falloff and one colour on everything the lights\' flux is the beam\'s through every plane change of every sweep — never above it, and under it only by a faintest light given up', () => {
    const U = rig(hall(24, 24)), grey: V3 = [0.4, 0.4, 0.4];
    const rho = paint(U.albedo, ALB_WALL, grey);
    expect(paint(U.albedo, ALB_FLOOR, grey)).toEqual(rho);
    expect(paint(U.albedo, ALB_CEIL, grey)).toEqual(rho);
    const whole = lum(rho) * PHYSICAL.intensity * spotConeSolidAngle(PHYSICAL.angle, PHYSICAL.penumbra);
    const rows: {hz: number; name: string; lo: number; hi: number; drop: number; changes: number; fading: number; exact: number; frames: number}[] = [];
    for (const hz of [30, 60, 144]) for (const sweep of SWEEPS) {
      const fb = new FlashBounce(), G = gameRig();
      G.light.color.set(PHYSICAL.color); G.light.intensity = PHYSICAL.intensity; G.light.distance = PHYSICAL.distance; G.light.decay = PHYSICAL.decay;
      fb.bind(U.src);
      fb.occlude(literal([column], rho));
      const n = Math.round(sweep.seconds * hz), row = {hz, name: sweep.name, lo: Infinity, hi: 0, drop: 0, changes: 0, fading: 0, exact: 0, frames: n + 1};
      let was = '', last = 1;
      for (let k = 0; k <= n; k++) {
        const [yaw, pitch] = sweep.at(k / hz);
        G.pose(8, 1.62, 6, yaw, pitch);
        fb.update(1 / hz, G.light);
        const d = fb.debug(), f = fluxOf(fb.vpls) / whole;
        expect(d.hits).toBe(FLASH_RAYS);
        row.fading = Math.max(row.fading, d.fading);
        const planes = fb.vpls.slice(0, FLASH_SECTORS).map(v => nrmOf(v).join()).join(' ');
        if (k > 0 && planes !== was) row.changes++;
        was = planes;
        row.lo = Math.min(row.lo, f); row.hi = Math.max(row.hi, f);
        row.drop = Math.max(row.drop, last - f);
        if (Math.abs(f - 1) < 1e-9) row.exact++;
        last = f;
      }
      rows.push(row);
    }
    for (const r of rows) {
      console.log(`flash bounce, a physical light of one colour on everything, sweep "${r.name}" at ${r.hz} Hz: the lights' flux / the beam's reflected flux ${r.lo.toFixed(6)} .. ${r.hi.toFixed(12)} over ${r.frames} frames ` +
        `(exactly the beam's in ${r.exact} of them; the largest fall in one frame ${(r.drop * 100).toFixed(3)} %; ${r.changes} frames in which a sector's light changed its plane, up to ${r.fading} lights fading)`);
    }
    for (const r of rows) {
      const label = `${r.name} @ ${r.hz} Hz`;
      expect(r.changes, label).toBeGreaterThanOrEqual(2);
      expect(r.fading, label).toBeGreaterThanOrEqual(1);
      expect(r.hi, label).toBeLessThan(1 + 1e-9);
      // (measured: never under 96.1 % of the beam's flux, and no more than 2.4 % of it let go in one frame — a faint fading light
      // whose place a new plane needs; in most frames of most sweeps it is the beam's flux exactly)
      expect(r.lo, label).toBeGreaterThan(0.95);
      expect(r.drop, label).toBeLessThan(0.03);
    }
    expect(rows.filter(r => r.exact >= r.frames / 3).length).toBeGreaterThanOrEqual(5);
  });

  it('a sudden quarter turn: nine tenths of the bounce stand at the new place within 0.25 s, and under a twentieth is left at the old after 0.3 s', () => {
    const fb = new FlashBounce(), s = spot(GAME), from: V3 = [6, 2.2, 6];
    const settled = (to: V3): FlashVpl[] => { const f2 = new FlashBounce(); f2.bind(R.src); f2.update(1 / 60, aim(spot(GAME), from, to)); return litOf(f2).map(v => ({...v})); };
    const before = settled([0.5, 2.2, 6]), after = settled([6, 2.2, 11.5]);
    /** The flux of the lights that stand at one of `places` (on its plane, within 0.5 m of it). */
    const at = (places: FlashVpl[]): number => fluxOf(litOf(fb).filter(v => places.some(p => dot(nrmOf(p), nrmOf(v)) > 0.999 && len(sub(posOf(p), posOf(v))) < 0.5)));
    fb.bind(R.src);
    fb.update(1 / 60, aim(s, from, [0.5, 2.2, 6]));
    expect(at(before)).toBeCloseTo(fluxOf(before), 9);
    expect(at(after)).toBe(0);
    aim(s, from, [6, 2.2, 11.5]);
    const rows: string[] = [];
    let least = Infinity;
    for (let k = 1; k <= 30; k++) {
      fb.update(1 / 60, s);
      for (const v of litOf(fb)) expect(AXES).toContain(nrmOf(v).join());
      least = Math.min(least, fluxOf(fb.vpls));
      if (k === 15) { rows.push(`after 0.25 s ${(at(after) / fluxOf(after) * 100).toFixed(1)} % of the settled bounce stands at the new place`); expect(at(after) / fluxOf(after)).toBeGreaterThanOrEqual(0.9); }
      if (k === 18) { rows.push(`after 0.3 s ${(at(before) / fluxOf(before) * 100).toFixed(1)} % of the old is left at the old place`); expect(at(before) / fluxOf(before)).toBeLessThan(0.05); }
    }
    // and on the way the bounce never dips: the old lights fade as the new ones come
    console.log(`flash bounce, a sudden quarter turn in a room: ${rows.join('; ')}; the flux on the way is never under ${(least / Math.min(fluxOf(before), fluxOf(after)) * 100).toFixed(1)} % of the lesser of the two`);
    expect(least / Math.min(fluxOf(before), fluxOf(after))).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('near field and far field: a lit wall is a patch as large as the beam on it, at any distance', () => {
  // the tall hall: the whole cone lands on the wall at x = 0.5 m, square on, from 2.5 m, 8 m and 20 m
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.5, 0.5]);
  const WALL_X = CELL, c = new THREE.Color(GAME.color), omega = coneIntegral(GAME, () => 1);
  const now = (D: number): FlashVpl[] => { const fb = new FlashBounce(); fb.bind(R.src); fb.update(1 / 60, aim(spot(GAME), [WALL_X + D, 15, 20], [WALL_X, 15, 20])); return copy(fb); };
  /**
   * The bounce as it was before this task, from its description: six rays — the axis and a ring of five at the angle inside which
   * 7/12 of the flux lies —, each a point light where it lands with a sixth of the beam's flux at its distance, and one patch size
   * of 0.5 m for all of them.
   */
  const six = (D: number): FlashVpl[] => {
    const ring = fluxAngle(GAME)(7 / 12);
    return [[0, 0], ...[0, 1, 2, 3, 4].map(k => [ring, k * 2 * Math.PI / 5])].map(([th, phi]) => {
      const d = D / Math.cos(th), j = GAME.intensity * attenOf(d, GAME) * d * d * (omega / 6) / Math.PI;
      return {x: WALL_X + LIFT, y: 15 - D * Math.tan(th) * Math.cos(phi), z: 20 + D * Math.tan(th) * Math.sin(phi), nx: 1, ny: 0, nz: 0, r: rho[0] * c.r * j, g: rho[1] * c.g * j, b: rho[2] * c.b * j, r0sq: 0.25};
    });
  };
  const at = (vpls: readonly FlashVpl[], p: V3, n: V3): number => lum(sampleFlashBounce(vpls, p, n, [0, 0, 0]));
  /** The wall's own radiosity at the beam's centre: albedo x the irradiance the beam draws there. */
  const radiosity = (D: number): number => lum([rho[0] * c.r, rho[1] * c.g, rho[2] * c.b]) * GAME.intensity * attenOf(D, GAME);

  it('next to the wall the bounce is nowhere above gain x the wall\'s own radiosity — on a floor, a ceiling, a side wall or a thing turned to it; the six point lights were, far above, at 8 m and 20 m', () => {
    const gain = FLASH_BOUNCE_DEFAULTS.gain, rows: string[] = [];
    const worst = (vpls: readonly FlashVpl[], D: number): number => {
      // in front of the wall, from 2 cm to 3 m off it, across the whole lit patch and a fifth beyond; facing up, down, either way along
      // the wall (floors, ceilings, side walls) and straight at the wall (the side of a thing standing there)
      const span = 1.2 * D * Math.tan(GAME.angle);
      let most = 0;
      for (const off of [0.02, 0.06, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3]) for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
        const p: V3 = [WALL_X + off, 15 + span * (i / 30 - 1), 20 + span * (j / 30 - 1)];
        for (const n of [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [-1, 0, 0]] as V3[]) most = Math.max(most, at(vpls, p, n));
      }
      return most;
    };
    const was: number[] = [], is: number[] = [];
    for (const D of [2.5, 8, 20]) {
      const B = radiosity(D);
      was.push(worst(six(D), D) / (gain * B));
      is.push(worst(now(D), D) / (gain * B));
      rows.push(`${D} m: ${is[is.length - 1].toFixed(2)} (the six point lights: ${was[was.length - 1].toFixed(2)})`);
    }
    console.log(`flash bounce, the brightest bounce next to a wall lit square on / (gain x the wall's radiosity at the beam's centre): ${rows.join('; ')}`);
    for (const v of is) expect(v).toBeLessThan(1);
    // (a patch as large as its rays' footprints: right in front of it a little under its own radiosity, whatever the distance — 0.83
    // to 0.85 here; with soft = 2 it was 0.48)
    for (const v of is) expect(v).toBeGreaterThan(0.7);
    expect(was[1]).toBeGreaterThan(5);
    expect(was[2]).toBeGreaterThan(30);
  });

  it('room-scale fill is what the six point lights gave: on the floor, the ceiling and the side walls of a room 5 m wide and 3 m high and on the wall behind the player, with a plain wall 2 m to 8 m ahead', () => {
    const rows: string[] = [], table: {D: number; floor: number; ceil: number; side: number; back: number}[] = [];
    for (const D of [2, 3, 4, 5, 8]) {
      const mine = now(D), old = six(D), sum = {floor: [0, 0], ceil: [0, 0], side: [0, 0], back: [0, 0]};
      const add = (k: keyof typeof sum, p: V3, n: V3): void => { sum[k][0] += at(mine, p, n); sum[k][1] += at(old, p, n); };
      // the room round the beam: its floor 1.62 m under the light and its ceiling 1.4 m over it, from the lit wall to 1 m behind the
      // player; its side walls 2.5 m either side; the wall 2 m behind the player
      for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
        const x = WALL_X + 0.1 + (D + 0.9) * i / 40, z = 17.5 + 5 * j / 40, y = 15 - 1.62 + 3.02 * j / 40;
        add('floor', [x, 15 - 1.62, z], [0, 1, 0]);
        add('ceil', [x, 15 + 1.4, z], [0, -1, 0]);
        add('side', [x, y, 17.5], [0, 0, 1]);
        add('side', [x, y, 22.5], [0, 0, -1]);
        add('back', [WALL_X + D + 2, y, z], [-1, 0, 0]);
      }
      const row = {D, floor: sum.floor[0] / sum.floor[1], ceil: sum.ceil[0] / sum.ceil[1], side: sum.side[0] / sum.side[1], back: sum.back[0] / sum.back[1]};
      table.push(row);
      rows.push(`${D} m: floor ${row.floor.toFixed(3)}, ceiling ${row.ceil.toFixed(3)}, side walls ${row.side.toFixed(3)}, behind ${row.back.toFixed(3)}`);
    }
    // the player's own surroundings with a wall 3 m ahead: the floor at the wall's foot and under the player
    const mine = now(3), old = six(3);
    const foot: V3 = [WALL_X + 0.8, 15 - 1.6, 20], under: V3 = [WALL_X + 3, 15 - 1.6, 20], up: V3 = [0, 1, 0];
    rows.push(`wall at 3 m: the floor 0.8 m off it ${((at(mine, foot, up) / at(old, foot, up) - 1) * 100).toFixed(1)} %, the floor under the player ${((at(mine, under, up) / at(old, under, up) - 1) * 100).toFixed(1)} %`);
    console.log(`flash bounce against the six point lights it replaces, the light a room receives (this / the six), by the distance of the lit wall: ${rows.join('; ')}`);
    for (const r of table) {
      // behind the player — the far field proper — it is the same light
      expect(Math.abs(r.back - 1), `${r.D} m, behind`).toBeLessThan(0.04);
      // beside the lit wall: the same at 2 m and 3 m; from 4 m on the six points overshot next to the wall (the test above), and
      // patches as large as the beam on it give a little less there
      const [lo, hi] = r.D <= 3 ? [0.94, 1.06] : r.D <= 5 ? [0.85, 1.1] : [0.74, 1.05];
      for (const k of ['floor', 'ceil', 'side'] as const) { expect(r[k], `${r.D} m, ${k}`).toBeGreaterThan(lo); expect(r[k], `${r.D} m, ${k}`).toBeLessThan(hi); }
    }
    expect(Math.abs(at(mine, under, up) / at(old, under, up) - 1)).toBeLessThan(0.08);
    expect(Math.abs(at(mine, foot, up) / at(old, foot, up) - 1)).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------------------------
describe('off, unbound, and back on', () => {
  const R = rig(hall(24, 24));
  paint(R.albedo, ALB_WALL, [0.5, 0.5, 0.5]);
  const A: [V3, V3] = [[6, 2.2, 6], [0.5, 2.2, 6]];
  const zeros = new Array(FLASH_VPLS * 12).fill(0);
  const allZero = (fb: FlashBounce) => {
    expect(uniformsOf()).toEqual(zeros);
    for (const v of fb.vpls) expect(Object.values(v)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const [p, n] of [[[5, 0, 6], [0, 1, 0]], [[1, 2.2, 6], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]]] as [V3, V3][]) expect(E(fb, p, n)).toEqual([0, 0, 0]);
    expect(fb.debug()).toMatchObject({lit: false, hits: 0, onProps: 0, onBodies: 0, candidates: 0, lights: 0, extra: 0, fading: 0, fadingFlux: 0, planes: 0, dropped: 0, flux: [0, 0, 0]});
    expect(fb.rays().every(r => r.on === 'none' && r.light === -1 && r.t === 0)).toBe(true);
  };

  it('intensity 0, a negative or broken intensity, nothing bound, bind(null): everything is exactly zero', () => {
    const fb = new FlashBounce(), s = aim(spot(GAME), ...A);
    expect(fb.vpls).toHaveLength(FLASH_VPLS);
    allZero(fb);
    fb.update(1 / 60, s); // nothing bound
    allZero(fb);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    expect(lum(flux(fb))).toBeGreaterThan(1);
    // the uniforms hold the lights: place and patch size, normal, radiant intensity
    expect(uniformsOf()).toEqual([...fb.vpls.flatMap(v => [v.x, v.y, v.z, v.r0sq]), ...fb.vpls.flatMap(v => [v.nx, v.ny, v.nz, 0]), ...fb.vpls.flatMap(v => [v.r, v.g, v.b, 0])]);
    for (const off of [0, -3, NaN]) {
      s.intensity = GAME.intensity;
      fb.update(1 / 60, s);
      expect(fb.debug().lit).toBe(true);
      s.intensity = off;
      fb.update(1 / 60, s);
      allZero(fb);
    }
    s.intensity = GAME.intensity;
    fb.update(1 / 60, s);
    fb.bind(null);
    allZero(fb);
    expect(fb.debug().bound).toBe(false);
    fb.update(1 / 60, s);
    allZero(fb);
    // a light with no direction (its target at its own place) is no beam
    fb.bind(R.src);
    fb.update(1 / 60, aim(spot(GAME), A[0], A[0]));
    allZero(fb);
    // a hidden light is off
    s.visible = false;
    fb.update(1 / 60, s);
    allZero(fb);
    // occluders are kept through all of it (the game sets them with the station's layout, not with its lighting)
    fb.occlude(literal([], [0, 0, 0]));
    fb.bind(null);
    fb.bind(R.src);
    expect(fb.debug().occluded).toBe(true);
    fb.occlude(null);
    expect(fb.debug().occluded).toBe(false);
  });

  it('switched on, the lights stand at their places at once at full strength (no glide from where they were, no fade-in, nothing left fading)', () => {
    const fresh = new FlashBounce(), s = aim(spot(GAME), ...A);
    fresh.bind(R.src);
    fresh.update(1 / 60, s);
    const want = copy(fresh);
    expect(fresh.debug().fading).toBe(0);
    const fb = new FlashBounce();
    fb.bind(R.src);
    fb.update(1 / 60, aim(spot(GAME), [6, 2.2, 6], [6, 2.2, 11.5])); // lit, elsewhere
    const off = aim(spot({...GAME, intensity: 0}), ...A);
    fb.update(1 / 60, off);
    fb.update(0.5, off);
    fb.update(1 / 60, s);
    expect(fb.vpls).toEqual(want);
    expect(uniformsOf().slice(0, 4)).toEqual([want[0].x, want[0].y, want[0].z, want[0].r0sq]);
    // ... also with no time passed in the frame it came on
    fb.update(1 / 60, off);
    fb.update(0, s);
    expect(fb.vpls).toEqual(want);
    // ... and when a station is bound while the light is on
    fb.update(1 / 60, aim(spot(GAME), [6, 2.2, 6], [6, 2.2, 11.5]));
    fb.bind(R.src);
    fb.update(1 / 60, s);
    expect(fb.vpls).toEqual(want);
  });

  it('a battery dip dims the bounce in the same frame: the light\'s intensity and colour are never smoothed', () => {
    const fb = new FlashBounce(), s = aim(spot(GAME), ...A);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    const full = copy(fb);
    s.intensity = GAME.intensity * 0.35;
    s.color.setRGB(0.2, 0.9, 0.4);
    fb.update(1 / 144, s);
    const c0 = new THREE.Color(GAME.color);
    // (the wall's six lights, and the floor's and the ceiling's extra ones)
    expect(litOf(fb).length).toBeGreaterThan(FLASH_SECTORS);
    expect(fb.vpls.map(isOn)).toEqual(full.map(isOn));
    fb.vpls.forEach((v, i) => {
      if (!isOn(v)) return;
      expect(posOf(v)).toEqual(posOf(full[i]));
      expect(v.r0sq).toBe(full[i].r0sq);
      expect(v.r / full[i].r).toBeCloseTo(0.35 * 0.2 / c0.r, 9);
      expect(v.g / full[i].g).toBeCloseTo(0.35 * 0.9 / c0.g, 9);
      expect(v.b / full[i].b).toBeCloseTo(0.35 * 0.4 / c0.b, 9);
    });
  });

  it('the light inside the architecture (a hand\'s width beside the eye, in a wall): the rays start at its parent, the eye', () => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(R.src);
    // the eye 12 cm from the wall on its right (the +z wall's face at z 11.5), looking along +x: the light itself is inside the wall
    G.pose(6, 1.62, 11.38, -Math.PI / 2);
    fb.update(1 / 60, G.light);
    G.light.updateWorldMatrix(true, false);
    const at = new THREE.Vector3().setFromMatrixPosition(G.light.matrixWorld);
    expect(R.scene.bandAtPoint(at.x, at.y, at.z)).toBe(-1);
    expect(fb.debug()).toMatchObject({origin: 'parent', lit: true});
    expect(fb.debug().hits).toBeGreaterThan(0);
    expect(lum(flux(fb))).toBeGreaterThan(0.5);
    // with the eye in the solid too there is no free space to start from: the lights fade out, they do not jump or blow up
    const before = lum(flux(fb));
    G.pose(6, 1.62, 11.7, -Math.PI / 2);
    fb.update(FLASH_BOUNCE_TAU, G.light);
    expect(fb.debug()).toMatchObject({origin: 'none', hits: 0, lit: true});
    expect(lum(flux(fb)) / before).toBeCloseTo(Math.exp(-1), 9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('smoothing in time', () => {
  // a 40 m hall, 30 m high: from (10, 15, 10) the whole cone lands on the west wall or — turned — on the north wall, 9.5 m away each
  const R = rig(hall(80, 80, 30));
  paint(R.albedo, ALB_WALL, [0.5, 0.4, 0.3]);
  const FROM: V3 = [10, 15, 10];
  const WEST: V3 = [0.5, 15, 10], NORTH: V3 = [10, 15, 0.5];
  const settled = (from: V3, to: V3, o: SpotSpec = GAME): FlashVpl[] => { const fb = new FlashBounce(); fb.bind(R.src); fb.update(1 / 60, aim(spot(o), from, to)); return copy(fb); };
  /** `steps` of time after the lights settled on the west wall and the beam turned to the north wall. */
  const turned = (steps: readonly number[]): FlashVpl[] => {
    const fb = new FlashBounce(), s = spot(GAME);
    fb.bind(R.src);
    fb.update(1 / 60, aim(s, FROM, WEST));
    aim(s, FROM, NORTH);
    for (const dt of steps) fb.update(dt, s);
    return copy(fb);
  };
  const even = (hz: number, T: number): number[] => { const n = Math.floor(T * hz + 1e-9), out = new Array<number>(n).fill(1 / hz); if (T - n / hz > 1e-12) out.push(T - n / hz); return out; };
  const close = (a: FlashVpl[], b: FlashVpl[], digits: number) => a.forEach((v, i) => (Object.keys(v) as (keyof FlashVpl)[]).forEach(k => expect(v[k], `light ${i} ${k}`).toBeCloseTo(b[i][k], digits)));
  const start = settled(FROM, WEST), end = settled(FROM, NORTH);

  it('the same state after 0.2 s at 30, 60 and 144 Hz and with uneven frames: the new wall\'s lights at their places, risen by 1 - exp(-t / tau); the old wall\'s as ONE light where they stood, faded by the rest', () => {
    const T = 0.2;
    const at30 = turned(even(30, T)), at60 = turned(even(60, T)), at144 = turned(even(144, T));
    const uneven = turned([0.004, 0.05, 0.011, 0.033, 0.002, 0.1]);
    expect(even(30, T)).toHaveLength(6);
    expect(even(144, T)).toHaveLength(29);
    close(at60, at30, 9);
    close(at144, at30, 9);
    close(uneven, at30, 9);
    // what that state is
    const k = Math.exp(-T / FLASH_BOUNCE_TAU);
    expect(start.slice(0, FLASH_SECTORS).every(v => v.nx === 1 && v.nz === 0) && end.slice(0, FLASH_SECTORS).every(v => v.nz === 1 && v.nx === 0)).toBe(true);
    at30.slice(0, FLASH_SECTORS).forEach((v, i) => {
      // the sector's light stands on the NEW wall at its place from the first frame on — never between the two walls, never with a turning normal
      expect([posOf(v), nrmOf(v), v.r0sq], `light ${i}`).toEqual([posOf(end[i]), nrmOf(end[i]), end[i].r0sq]);
      for (const q of ['r', 'g', 'b'] as const) expect(v[q], `light ${i} ${q}`).toBeCloseTo(end[i][q] * (1 - k), 9);
    });
    const W = start.reduce((t, v) => t + v.r + v.g + v.b, 0), old = at30[FLASH_SECTORS];
    expect(nrmOf(old)).toEqual([1, 0, 0]);
    posOf(old).forEach((c, q) => expect(c).toBeCloseTo(start.reduce((t, v) => t + (v.r + v.g + v.b) * posOf(v)[q], 0) / W, 9));
    for (const q of ['r', 'g', 'b'] as const) expect(old[q]).toBeCloseTo(start.reduce((t, v) => t + v[q], 0) * k, 9);
    expect(isOn(at30[FLASH_SECTORS + 1])).toBe(false);
    // so the flux crosses over without a dip
    expect(fluxOf(at30)).toBeCloseTo(fluxOf(end) * (1 - k) + fluxOf(start) * k, 9);
    expect(FLASH_BOUNCE_TAU).toBeGreaterThanOrEqual(0.06);
    expect(FLASH_BOUNCE_TAU).toBeLessThanOrEqual(0.09);
  });

  it('a paused frame (dt 0) changes no light\'s strength; a long one arrives', () => {
    // (the beam has turned while paused: the hand-over happens, at full strength on the old wall and none yet on the new)
    const paused = turned([0]);
    expect(fluxOf(paused)).toBeCloseTo(fluxOf(start), 9);
    expect(fluxOf(paused.slice(0, FLASH_SECTORS))).toBe(0);
    close(turned([0, 0, 0]), paused, 12);
    close(turned([-1, NaN]), paused, 12);
    // a beam that has not moved: nothing changes at all
    const fb = new FlashBounce(), s = aim(spot(GAME), FROM, WEST);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    for (const dt of [0, -1, NaN, 0]) fb.update(dt, s);
    expect(fb.vpls).toEqual(start);
    close(turned([30]), end, 9);
    close(turned([Infinity]), end, 12);
  });

  it('a steady sweep along one wall: at every frame every light is last frame\'s drawn 1 - exp(-dt / tau) of the way to its place — so the lights trail the beam by about its speed x tau at every frame rate (less half a frame\'s travel)', () => {
    // the beam's centre crosses the west wall at 8 m/s for 0.4 s
    const V = 8, T = 0.4;
    const lag = (hz: number): number[] => {
      const fb = new FlashBounce(), s = spot(GAME), a = 1 - Math.exp(-(1 / hz) / FLASH_BOUNCE_TAU);
      fb.bind(R.src);
      fb.update(1 / hz, aim(s, FROM, [0.5, 15, 8.4]));
      const n = Math.round(T * hz);
      for (let k = 1; k <= n; k++) {
        const to: V3 = [0.5, 15, 8.4 + V * k / hz], was = copy(fb), there = settled(FROM, to);
        fb.update(1 / hz, aim(s, FROM, to));
        fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => {
          for (const q of ['y', 'z', 'r0sq', 'r', 'g', 'b'] as const) expect(v[q], `${hz} Hz frame ${k} light ${i} ${q}`).toBeCloseTo(was[i][q] + (there[i][q] - was[i][q]) * a, 9);
        });
      }
      // every light glides on the wall's plane, and only there
      for (const v of litOf(fb)) { expect(v.x).toBeCloseTo(0.5 + LIFT, 12); expect(nrmOf(v)).toEqual([1, 0, 0]); }
      expect(fb.debug()).toMatchObject({fading: 0, extra: 0, dropped: 0});
      const there = settled(FROM, [0.5, 15, 8.4 + V * T]);
      return there.slice(0, FLASH_SECTORS).map((v, i) => v.z - fb.vpls[i].z);
    };
    const l30 = lag(30), l60 = lag(60), l144 = lag(144);
    console.log(`flash bounce, a steady sweep along a wall at ${V} m/s: the six lights trail their places by ${([[30, l30], [60, l60], [144, l144]] as const).map(([hz, l]) => `${l.map(v => v.toFixed(2)).join(' ')} m at ${hz} Hz`).join('; ')} ` +
      `(speed x tau = ${(V * FLASH_BOUNCE_TAU).toFixed(2)} m)`);
    // on the wall a ray off the beam's axis travels faster than its centre: at the sweep's end (the centre 9.6 degrees past square on)
    // the cone's leading edge is at 42.8 degrees — cos^2 9.6 / cos^2 42.8 = 1.81 times as fast; nothing is slower than square on (0.97)
    const end = Math.atan(V * T / 2 / 9.5), fastest = Math.cos(end) ** 2 / Math.cos(end + GAME.angle) ** 2;
    expect(fastest).toBeGreaterThan(1.7);
    expect(fastest).toBeLessThan(1.9);
    for (const [hz, l] of [[30, l30], [60, l60], [144, l144]] as const) {
      // (the cap's light is the beam's centre)
      expect(l[0], `${hz} Hz`).toBeGreaterThan(V * (FLASH_BOUNCE_TAU - 0.5 / hz) * 0.93);
      expect(l[0], `${hz} Hz`).toBeLessThan(V * FLASH_BOUNCE_TAU * 1.02);
      // (a wedge's light is the flux-weighted centre of its rays, and the game's falloff shifts the weights as the beam turns: its
      // place travels slower or faster than any one ray. Every light trails, none leads, none by more than the fastest ray would)
      for (const li of l) { expect(li, `${hz} Hz`).toBeGreaterThan(0); expect(li, `${hz} Hz`).toBeLessThan(V * FLASH_BOUNCE_TAU * fastest); }
    }
    expect(Math.abs(l60[0] - l144[0])).toBeLessThan(0.05);
    expect(Math.abs(l30[0] - l144[0])).toBeLessThan(0.12);
  });

  it('rays that land nowhere fade their light out where it stood; back early it glides on, back late it reappears at its place', () => {
    // a 4.5 m beam: the wall is in reach from 3.5 m, out of reach from 5.5 m
    const SHORT = {...GAME, distance: 4.5};
    const near: [V3, V3] = [[4, 15, 10], WEST], far: [V3, V3] = [[6, 15, 10], WEST], other: [V3, V3] = [[4, 15, 8], [0.5, 15, 8]];
    const run = (steps: readonly number[]): {fb: FlashBounce; s: THREE.SpotLight; lit: FlashVpl[]} => {
      const fb = new FlashBounce(), s = spot(SHORT);
      fb.bind(R.src);
      fb.update(1 / 60, aim(s, ...near));
      expect(fb.debug().hits).toBe(FLASH_RAYS);
      const lit = copy(fb);
      aim(s, ...far);
      for (const dt of steps) fb.update(dt, s);
      return {fb, s, lit};
    };
    for (const steps of [even(30, 0.1), even(144, 0.1), [0.1]]) {
      const {fb, lit} = run(steps);
      expect(fb.debug()).toMatchObject({hits: 0, lit: true, lights: FLASH_SECTORS, fading: 0});
      fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => {
        expect(posOf(v)).toEqual(posOf(lit[i]));
        expect(nrmOf(v)).toEqual(nrmOf(lit[i]));
        expect(v.r0sq).toBe(lit[i].r0sq);
        for (const q of ['r', 'g', 'b'] as const) expect(v[q] / lit[i][q]).toBeCloseTo(Math.exp(-0.1 / FLASH_BOUNCE_TAU), 9);
      });
    }
    // gone for good: exactly zero in the end (no endless tail of tiny numbers)
    expect(flux(run([5]).fb)).toEqual([0, 0, 0]);
    // back after 0.05 s (half of it left): it glides from where it stood to its new place, 2 m along the same wall
    const early = run([0.05]);
    early.fb.update(1 / 60, aim(early.s, ...other));
    const a = 1 - Math.exp(-1 / 60 / FLASH_BOUNCE_TAU);
    early.fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => {
      expect(v.z).toBeCloseTo(early.lit[i].z - 2 * a, 9);
      expect([v.x, v.y]).toEqual([early.lit[i].x, early.lit[i].y]);
    });
    // back after 0.25 s (under FLASH_BOUNCE_REVIVE of it left): it stands at its new place at once and fades in there
    const late = run([0.25]);
    expect(Math.exp(-0.25 / FLASH_BOUNCE_TAU)).toBeLessThan(FLASH_BOUNCE_REVIVE);
    const left = late.fb.vpls[0].r;
    late.fb.update(1 / 60, aim(late.s, ...other));
    late.fb.vpls.slice(0, FLASH_SECTORS).forEach((v, i) => expect(v.z).toBeCloseTo(late.lit[i].z - 2, 12));
    expect(late.fb.vpls[0].r).toBeCloseTo(left + (late.lit[0].r - left) * a, 9);
  });

});

// ---------------------------------------------------------------------------------------------
describe('the extra lights: a plane the beam lands on that no sector\'s light stands on has one of its own', () => {
  // the tall hall: with nothing in the way the whole cone lands on the wall at x = 0.5 m, 6 m from the light
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.5, 0.5]);
  const L: V3 = [6.5, 15, 20], TO: V3 = [CELL, 15, 20], WALL = CELL + LIFT;
  let cached: V3[] | null = null;
  /** Where the rays go with nothing in the way: per ray its unit direction from the light. */
  const dirs = (): V3[] => {
    if (!cached) { const fb = new FlashBounce(); fb.bind(R.src); fb.update(1 / 60, aim(spot(PHYSICAL), L, TO)); cached = fb.rays().map(r => unit(sub([r.x, r.y, r.z], L))); }
    return cached;
  };
  /** A small box in ray j's way, its face toward the light at x = `face`: the ray lands in the face's middle and no other ray touches the box. */
  const boxOn = (j: number, face: number): FlashBox => {
    const d = dirs()[j], t = (face - L[0]) / d[0];
    return {x: face - 0.05, y: L[1] + d[1] * t - 0.03, z: L[2] + d[2] * t, hx: 0.05, hz: 0.03, h: 0.06};
  };
  const a = 1 - Math.exp(-(1 / 60) / FLASH_BOUNCE_TAU);
  const onPlane = (fb: FlashBounce, x: number): FlashVpl[] => litOf(fb).filter(v => Math.abs(v.x - x) < 1e-9 && v.nx === 1);

  it('it stands where that plane\'s rays land, with their flux; it comes from nothing and goes to nothing where it stands, and the beam\'s flux is whole at every frame', () => {
    const boxes: FlashBox[] = [], fb = new FlashBounce(), s = aim(spot(PHYSICAL), L, TO);
    fb.bind(R.src);
    fb.occlude(literal(boxes, rho)); // (boxes of the wall's own colour: with the physical falloff every ray sends back the same flux)
    fb.update(1 / 60, s);
    const bare = copy(fb), full = fluxOf(bare), one = full / FLASH_RAYS;
    // a small box 2 m ahead in the way of ONE of the cap's five rays: the wall keeps the cap's light, the box's face is an orphan plane
    boxes.push(boxOn(1, 4.5));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: 1, lights: FLASH_SECTORS, planes: 1, extra: 1, fading: 0, dropped: 0});
    const r1 = fb.rays()[1], e = fb.vpls[FLASH_SECTORS];
    expect([r1.on, r1.light, r1.x, r1.nx]).toEqual(['prop', FLASH_SECTORS, 4.5, 1]);
    expect(fb.rays().filter(r => r.on === 'prop')).toHaveLength(1);
    [4.5 + LIFT, r1.y, r1.z].forEach((c, q) => expect(posOf(e)[q]).toBeCloseTo(c, 12));
    expect(nrmOf(e)).toEqual([1, 0, 0]);
    // (one ray's footprint 2 m ahead is small: the smallest patch)
    expect(e.r0sq).toBe(Math.max(FLASH_BOUNCE_TUNING.soft * r1.area / Math.PI, FLASH_BOUNCE_DEFAULTS.r0min ** 2));
    expect(e.r0sq).toBe(FLASH_BOUNCE_DEFAULTS.r0min ** 2);
    // it starts from nothing, and the cap's light gives the ray up as slowly: the sum is the beam's
    expect(fluxOf([e]) / one).toBeCloseTo(a, 9);
    expect(fluxOf([fb.vpls[0]]) / one).toBeCloseTo(SECTOR_RAYS - a, 9);
    expect(fluxOf(fb.vpls) / full).toBeCloseTo(1, 12);
    for (let k = 2; k <= 30; k++) { fb.update(1 / 60, s); expect(fluxOf(fb.vpls) / full).toBeCloseTo(1, 12); }
    expect(fluxOf([e]) / one).toBeCloseTo(1 - Math.exp(-0.5 / FLASH_BOUNCE_TAU), 9);
    // the box goes: its light fades where it stands while the cap's light takes the ray back; then the extra light is nobody's
    boxes.length = 0;
    const had = fluxOf([e]), at = posOf(e);
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: 0, planes: 0, extra: 0, fading: 1, dropped: 0});
    expect(posOf(e)).toEqual(at);
    expect(fluxOf([e]) / had).toBeCloseTo(1 - a, 9);
    expect(fb.debug().fadingFlux).toBeCloseTo(fluxOf([e]) / full, 9);
    expect(fluxOf(fb.vpls) / full).toBeCloseTo(1, 12);
    for (let k = 0; k < 400; k++) fb.update(1 / 60, s);
    expect(Object.values(e)).toEqual(new Array(10).fill(0));
    expect(fb.debug()).toMatchObject({extra: 0, fading: 0, fadingFlux: 0});
    fb.vpls.forEach((v, i) => (Object.keys(v) as (keyof FlashVpl)[]).forEach(k => expect(v[k], `light ${i} ${k}`).toBeCloseTo(bare[i][k], 9)));
  });

  it('rays of several sectors on one plane share one extra light: at their centroid, as large as their footprints and their spread', () => {
    // one ray each of two sectors — the two that land farthest apart 2 m ahead —, on two small boxes whose faces lie in one plane
    const landing = dirs().map(d => { const t = (4.5 - L[0]) / d[0]; return [4.5, L[1] + d[1] * t, L[2] + d[2] * t] as V3; });
    let I = 0, J = 0;
    for (let i = 0; i < FLASH_RAYS; i++) for (let j = i + 1; j < FLASH_RAYS; j++) {
      if (Math.floor(i / SECTOR_RAYS) !== Math.floor(j / SECTOR_RAYS) && len(sub(landing[i], landing[j])) > len(sub(landing[I], landing[J]))) { I = i; J = j; }
    }
    const boxes = [boxOn(I, 4.5), boxOn(J, 4.5)], fb = new FlashBounce(), s = aim(spot(GAME), L, TO);
    fb.bind(R.src);
    fb.occlude(literal(boxes, [0.3, 0.2, 0.1]));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: 2, planes: 1, extra: 1, fading: 0, dropped: 0});
    const rays = fb.rays(), p = rays[I], q = rays[J], e = fb.vpls[FLASH_SECTORS];
    expect([p.light, q.light]).toEqual([FLASH_SECTORS, FLASH_SECTORS]);
    const wp = p.transfer[0] + p.transfer[1] + p.transfer[2], wq = q.transfer[0] + q.transfer[1] + q.transfer[2], t = wq / (wp + wq);
    [4.5 + LIFT, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t].forEach((c, k) => expect(posOf(e)[k]).toBeCloseTo(c, 9));
    const apart = len(sub([p.x, p.y, p.z], [q.x, q.y, q.z]));
    expect(apart).toBeGreaterThan(1);
    expect(e.r0sq).toBeCloseTo(Math.max(FLASH_BOUNCE_TUNING.soft * (p.area + q.area) / Math.PI + t * (1 - t) * apart * apart, FLASH_BOUNCE_DEFAULTS.r0min ** 2), 9);
    expect(e.r0sq).toBeGreaterThan(FLASH_BOUNCE_DEFAULTS.r0min ** 2);
    // the boxes' colour times the light's
    const c = new THREE.Color(GAME.color);
    expect(e.g / e.r).toBeCloseTo(0.2 * c.g / (0.3 * c.r), 6);
    expectLightsAreTheirRays(fb, s);
  });

  it('more orphan planes than extra lights: the planes with the most flux have them and `dropped` is the rest; a plane takes a fading light\'s place once it clearly outweighs what is left of it', () => {
    // six small boxes, each in the way of one ray of another sector, at six depths: six planes. With the game's falloff a box
    // sends back more the farther it is from the light
    const faces = [5.5, 5, 4.5, 4, 3.5, 3], on = [1, 5, 10, 15, 20, 25];
    const boxes = on.map((j, k) => boxOn(j, faces[k])), fb = new FlashBounce(), s = aim(spot(GAME), L, TO);
    fb.bind(R.src);
    fb.occlude(literal(boxes, rho));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: 6, lights: FLASH_SECTORS, planes: 6, extra: FLASH_EXTRA, fading: 0});
    const weight = (r: FlashRayDebug): number => r.transfer[0] + r.transfer[1] + r.transfer[2];
    let rays = fb.rays();
    const w = on.map(j => weight(rays[j]));
    on.forEach((j, k) => { expect(rays[j].on).toBe('prop'); expect(rays[j].x).toBe(faces[k]); if (k) expect(w[k]).toBeGreaterThan(w[k - 1] * 1.1); });
    // the four farthest boxes have the lights, each where its ray lands
    on.forEach((j, k) => {
      expect(rays[j].light >= FLASH_SECTORS, `box ${k}`).toBe(k >= 2);
      if (k >= 2) [faces[k] + LIFT, rays[j].y, rays[j].z].forEach((c, q) => expect(posOf(fb.vpls[rays[j].light])[q]).toBeCloseTo(c, 12));
    });
    expect(new Set(on.slice(2).map(j => rays[j].light)).size).toBe(FLASH_EXTRA);
    const landed = rays.reduce((t, r) => t + weight(r), 0);
    expect(fb.debug().dropped).toBeCloseTo((w[0] + w[1]) / landed, 6);
    expectLightsAreTheirRays(fb, s);
    // the brightest box goes: its light fades where it stands; the next plane in line (box 1) takes that light's place in the first
    // frame in which keep x its flux is more than what is left there — not before, and no other light gives way
    const slot = rays[on[5]].light, keep = FLASH_BOUNCE_TUNING.keep;
    const first = 1 + Math.ceil(Math.log(w[5] / (keep * w[1])) * FLASH_BOUNCE_TAU * 60);
    expect(first).toBeGreaterThan(2);
    // (box 1's flux, as a light's: its ray's transfer times the light)
    const coming = Math.PI * s.intensity * lum([rays[on[1]].transfer[0] * s.color.r, rays[on[1]].transfer[1] * s.color.g, rays[on[1]].transfer[2] * s.color.b]);
    boxes[5].h = 0;
    for (let k = 1; k <= first + 3; k++) {
      const left = fluxOf([fb.vpls[slot]]);
      fb.update(1 / 60, s);
      rays = fb.rays();
      expect(rays[on[5]].on).toBe('architecture');
      expect(rays[on[0]].light, `frame ${k}`).toBe(-1);
      for (const q of [2, 3, 4]) { expect(rays[on[q]].light, `frame ${k}`).toBeGreaterThanOrEqual(FLASH_SECTORS); expect(rays[on[q]].light, `frame ${k}`).not.toBe(slot); }
      if (k < first) {
        expect(left, `frame ${k}`).toBeGreaterThanOrEqual(keep * coming);
        expect(rays[on[1]].light, `frame ${k}`).toBe(-1);
        expect(fb.debug()).toMatchObject({planes: 5, extra: FLASH_EXTRA - 1, fading: 1});
        expect(fb.vpls[slot].x).toBeCloseTo(faces[5] + LIFT, 12);
        expect(fluxOf([fb.vpls[slot]]) / left).toBeCloseTo(1 - a, 9);
      } else {
        // (in the frame it comes, what goes dark at once is less than the plane that comes)
        if (k === first) expect(left).toBeLessThan(keep * coming);
        expect(rays[on[1]].light, `frame ${k}`).toBe(slot);
        expect(fb.debug()).toMatchObject({planes: 5, extra: FLASH_EXTRA, fading: 0});
        expect(fb.vpls[slot].x).toBeCloseTo(faces[1] + LIFT, 12);
        expect(fluxOf([fb.vpls[slot]]) / coming).toBeCloseTo(1 - (1 - a) ** (k - first + 1), 9);
      }
    }
  });

  it('a sector\'s plane flips: its light and that plane\'s extra light change places — each plane\'s light stays where it is, nothing starts from nothing, the beam\'s flux is whole', () => {
    // the cap's five rays: small boxes with their faces in one plane 2 m ahead take two of them (the wall keeps three and the cap's
    // light), then four (the wall keeps one), then two again — soon after, and long after
    const two = [boxOn(1, 4.5), boxOn(2, 4.5)], more = [boxOn(3, 4.5), boxOn(4, 4.5)], boxes = [...two];
    const fb = new FlashBounce(), s = aim(spot(PHYSICAL), L, TO);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    const full = fluxOf(fb.vpls), one = full / FLASH_RAYS, BOX = 4.5 + LIFT;
    // (a fading light whose transfer is under a billionth goes out at once: all the flux that is ever let go)
    const gone = FLASH_EXTRA * 1e-9 / fb.rays().reduce((t, r) => t + r.transfer[0] + r.transfer[1] + r.transfer[2], 0);
    expect(gone).toBeLessThan(2e-8);
    fb.bind(R.src);
    fb.occlude(literal(boxes, rho));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({onProps: 2, planes: 1, extra: 1, fading: 0, dropped: 0});
    expect(fb.vpls[0].x).toBeCloseTo(WALL, 12);
    expect(fb.vpls[FLASH_SECTORS].x).toBeCloseTo(BOX, 12);
    expect([fluxOf(onPlane(fb, BOX)) / one, fluxOf(onPlane(fb, WALL)) / one].map(v => +v.toFixed(9))).toEqual([2, 28]);
    const boxAt = posOf(fb.vpls[FLASH_SECTORS]), wallAt = posOf(fb.vpls[0]);
    let frames = 0;
    /** `n` frames: the beam's flux is whole and every lit light stands on the wall or on the boxes' plane, at each of them. */
    const run = (n: number): void => {
      for (let k = 0; k < n; k++) {
        fb.update(1 / 60, s);
        frames++;
        expect(Math.abs(fluxOf(fb.vpls) / full - 1), `frame ${frames}`).toBeLessThan(gone + 1e-12);
        expect(fb.debug().dropped, `frame ${frames}`).toBe(0);
        for (const v of litOf(fb)) { expect(nrmOf(v)).toEqual([1, 0, 0]); expect(Math.min(Math.abs(v.x - WALL), Math.abs(v.x - BOX)), `frame ${frames}`).toBeLessThan(1e-9); }
      }
    };
    // four of the cap's rays on the boxes: the cap's light is now the one that stood on the boxes' plane — where it stood, with
    // what it had, on its way to the four rays' — and the wall keeps the cap's old light where it stood, fading
    boxes.push(...more);
    run(1);
    expect(fb.debug()).toMatchObject({onProps: 4, planes: 0, extra: 0, fading: 1});
    expect(fb.vpls[0].x).toBeCloseTo(BOX, 12);
    expect(fluxOf([fb.vpls[0]]) / one).toBeCloseTo(2 + 2 * a, 9);
    const target = fb.rays().filter(r => r.on === 'prop').reduce((t, r) => [t[0] + r.y / 4, t[1] + r.z / 4], [0, 0]);
    expect(fb.vpls[0].y).toBeCloseTo(boxAt[1] + (target[0] - boxAt[1]) * a, 9);
    expect(fb.vpls[0].z).toBeCloseTo(boxAt[2] + (target[1] - boxAt[2]) * a, 9);
    expect(posOf(fb.vpls[FLASH_SECTORS])).toEqual(wallAt);
    expect(fluxOf([fb.vpls[FLASH_SECTORS]]) / one).toBeCloseTo(3 * (1 - a), 9);
    expect(fluxOf(onPlane(fb, BOX)) / one).toBeCloseTo(2 + 2 * a, 9);
    run(2);
    // back to two, three frames later: they change places again (the wall's fading light is the cap's once more)
    boxes.length = 2;
    const wallHad = fluxOf([fb.vpls[FLASH_SECTORS]]), boxHad = fluxOf([fb.vpls[0]]);
    run(1);
    expect(fb.debug()).toMatchObject({onProps: 2, planes: 1, extra: 1, fading: 0});
    expect(fb.vpls[0].x).toBeCloseTo(WALL, 12);
    expect(fb.vpls[FLASH_SECTORS].x).toBeCloseTo(BOX, 12);
    expect(fluxOf([fb.vpls[0]]) / one).toBeCloseTo(wallHad / one + (3 - wallHad / one) * a, 9);
    expect(fluxOf([fb.vpls[FLASH_SECTORS]]) / one).toBeCloseTo(boxHad / one + (2 - boxHad / one) * a, 9);
    run(600);
    expect([fluxOf(onPlane(fb, BOX)) / one, fluxOf(onPlane(fb, WALL)) / one].map(v => +v.toFixed(6))).toEqual([2, 28]);
    // to four and, long after (the wall's fading light is gone), back to two: the cap's light is handed to an extra light on the
    // boxes' plane — the light of the two rays still there — and the cap starts on the wall from nothing
    boxes.push(...more);
    run(600);
    expect(fb.debug()).toMatchObject({planes: 0, extra: 0, fading: 0});
    expect([fluxOf(onPlane(fb, BOX)) / one, fluxOf(onPlane(fb, WALL)) / one].map(v => +v.toFixed(6))).toEqual([4, 26]);
    boxes.length = 2;
    run(1);
    expect(fb.debug()).toMatchObject({planes: 1, extra: 1, fading: 0});
    expect(fb.vpls[0].x).toBeCloseTo(WALL, 12);
    expect(fluxOf([fb.vpls[0]]) / one).toBeCloseTo(3 * a, 9);
    expect(fluxOf(onPlane(fb, BOX)) / one).toBeCloseTo(4 - 2 * a, 9);
    run(600);
    expect([fluxOf(onPlane(fb, BOX)) / one, fluxOf(onPlane(fb, WALL)) / one].map(v => +v.toFixed(6))).toEqual([2, 28]);
  });

  it('the whole beam leaves a wall while every extra light is taken: the wall\'s lights go as ONE, in the place of the least — what goes dark at once is the least there is', () => {
    // four planes of two small bright boxes each (two rays of two sectors: no sector's light stands on them), each plane brighter
    // than any one sector's light on the wall; then a slab stands in front of everything, 0.75 m from the light
    const pairs: [number, number, number][] = [[1, 5, 5], [6, 10, 4.5], [15, 20, 4], [21, 25, 3.5]];
    const boxes = pairs.flatMap(([i, j, face]) => [boxOn(i, face), boxOn(j, face)]), bright: V3 = [0.9, 0.9, 0.9];
    const fb = new FlashBounce(), s = aim(spot(PHYSICAL), L, TO);
    fb.bind(R.src);
    fb.occlude(literal(boxes, bright));
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: 8, lights: FLASH_SECTORS, planes: 4, extra: FLASH_EXTRA, dropped: 0});
    const was = copy(fb), sum = (v: FlashVpl): number => v.r + v.g + v.b;
    const sectors = was.slice(0, FLASH_SECTORS), extras = was.slice(FLASH_SECTORS), wall = sectors.reduce((t, v) => t + sum(v), 0);
    for (const v of sectors) expect(v.x).toBeCloseTo(WALL, 12);
    // every extra light holds more than any one sector's light, and less than the wall's lights together
    const keep = FLASH_BOUNCE_TUNING.keep;
    for (const e of extras) { for (const v of sectors) expect(sum(v) * keep).toBeLessThan(sum(e)); expect(wall * keep).toBeGreaterThan(sum(e)); }
    boxes.push({x: 5.7, y: 5, z: 20, hx: 0.05, hz: 10, h: 20});
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, onProps: FLASH_RAYS, lights: FLASH_SECTORS, planes: 0, extra: 0, fading: FLASH_EXTRA});
    for (const v of fb.vpls.slice(0, FLASH_SECTORS)) { expect(nrmOf(v)).toEqual([1, 0, 0]); expect(v.x).toBeCloseTo(5.75 + LIFT, 12); }
    const now = fb.vpls.slice(FLASH_SECTORS), onWall = now.filter(v => Math.abs(v.x - WALL) < 1e-9);
    // one light on the wall with all six lights' flux, at their centre; three of the four box lights where they stood
    expect(onWall).toHaveLength(1);
    expect(sum(onWall[0])).toBeCloseTo(wall * (1 - a), 9);
    [1, 2].forEach(q => expect(posOf(onWall[0])[q]).toBeCloseTo(sectors.reduce((t, v) => t + sum(v) * posOf(v)[q], 0) / wall, 9));
    const kept = now.filter(v => v !== onWall[0]);
    for (const v of kept) { const e = extras.find(x => Math.abs(x.x - v.x) < 1e-9)!; expect(posOf(v)).toEqual(posOf(e)); expect(sum(v)).toBeCloseTo(sum(e) * (1 - a), 9); }
    expect(new Set(kept.map(v => v.x)).size).toBe(FLASH_EXTRA - 1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('determinism', () => {
  it('the same frames give the same lights, bit for bit: a walking, turning, flickering beam among props that come and go and characters that move', () => {
    const R = rig(hall(48, 32));
    paint(R.albedo, ALB_WALL, [0.5, 0.4, 0.3]); paint(R.albedo, ALB_FLOOR, [0.3, 0.3, 0.3]); paint(R.albedo, ALB_CEIL, [0.6, 0.6, 0.6]);
    const run = (): {values: number[]; lit: number; onProps: number; onBodies: number; extra: number; fading: number; dropped: number} => {
      let seed = 0x1234567;
      const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const layout = {props: Array.from({length: 60}, () => prop(rnd() < 0.2 ? 'shopGlazing' : 'crate', 2 + rnd() * 20, 2 + rnd() * 12, 0.1 + rnd() * 0.5, 0.1 + rnd() * 0.5, 0.4 + rnd() * 2, 0, rnd() < 0.2 ? {round: true} : {}))};
      const actors: FlashBodyActor[] = Array.from({length: 10}, () => ({brain: {x: 2 + rnd() * 20, y: 0, z: 2 + rnd() * 12, alive: true, stats: {radius: 0.35}}, ragdolled: false}));
      const fb = new FlashBounce(), G = gameRig(), occ = flashOccluders(layout), extra = prop('column', 12, 8, 0.4, 0.4, 3);
      fb.bind(R.src);
      fb.occlude(occ);
      const out = {values: [] as number[], lit: 0, onProps: 0, onBodies: 0, extra: 0, fading: 0, dropped: 0};
      for (let k = 0; k < 600; k++) {
        const x = 12 + 6 * Math.sin(k * 0.013), z = 8 + 4 * Math.cos(k * 0.007);
        G.pose(x, 1.62, z, k * 0.021, 0.5 * Math.sin(k * 0.05));
        G.light.intensity = k % 97 === 0 ? 0 : 34 * (0.6 + 0.4 * Math.sin(k * 0.3));
        actors.forEach((a, i) => { a.brain.x += 0.02 * Math.sin(k * 0.1 + i); a.brain.z += 0.02 * Math.cos(k * 0.07 + i); });
        if (k === 150) layout.props.push(extra);
        if (k === 300) layout.props.splice(layout.props.indexOf(extra), 1);
        if (k === 400) layout.props[3].h = 0;
        occ.setBodies(actors, {x, z});
        fb.update(k % 2 ? 1 / 60 : 1 / 144, G.light);
        for (const v of fb.vpls) out.values.push(v.x, v.y, v.z, v.nx, v.ny, v.nz, v.r, v.g, v.b, v.r0sq);
        const d = fb.debug();
        out.lit += d.lights; out.onProps += d.onProps; out.onBodies += d.onBodies; out.extra += d.extra; out.fading += d.fading; out.dropped += d.dropped;
      }
      return out;
    };
    const a = run(), b = run();
    expect(a.values).toHaveLength(600 * FLASH_VPLS * 10);
    let same = 0;
    for (let i = 0; i < a.values.length; i++) if (Object.is(a.values[i], b.values[i])) same++;
    expect(same).toBe(a.values.length);
    expect(a.values.every(Number.isFinite)).toBe(true);
    expect({...a, values: 0}).toEqual({...b, values: 0});
    // (the run meets everything: lit lights, rays on props and on characters, extra lights with a plane of their own, lights fading)
    expect(Math.min(a.lit, a.onProps, a.onBodies, a.extra, a.fading)).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------------------------
describe('no allocation', () => {
  it('updates of a moving, flickering beam with a station\'s props and characters bound leave the heap where it was', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const R = rig(hall(48, 32));
    let seed = 0x51ed270b;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const kinds = ['column', 'crate', 'bench', 'vending', 'shopGlazing', 'hkRinkBoard'];
    const layout = {props: Array.from({length: 240}, () => prop(kinds[Math.floor(rnd() * kinds.length)], 1.5 + rnd() * 21, 1.5 + rnd() * 13, 0.1 + rnd() * 0.5, 0.1 + rnd() * 0.5, 0.4 + rnd() * 2, 0, rnd() < 0.15 ? {round: true} : {}))};
    const actors: FlashBodyActor[] = Array.from({length: 24}, () => ({brain: {x: 2 + rnd() * 20, y: 0, z: 2 + rnd() * 12, alive: true, stats: {radius: 0.35}}, ragdolled: false}));
    const fb = new FlashBounce(), G = gameRig(), occ = flashOccluders(layout), eye = {x: 0, z: 0};
    fb.bind(R.src);
    fb.occlude(occ);
    let onProps = 0, onBodies = 0, most = 0;
    const frame = (k: number): void => {
      eye.x = 12 + 6 * Math.sin(k * 0.013); eye.z = 8 + 4 * Math.cos(k * 0.007);
      G.pose(eye.x, 1.62, eye.z, k * 0.021, 0.5 * Math.sin(k * 0.05));
      G.light.intensity = k % 97 === 0 ? 0 : 34 * (0.6 + 0.4 * Math.sin(k * 0.3));
      for (let i = 0; i < actors.length; i++) { const b = actors[i].brain; b.x += 0.02 * Math.sin(k * 0.1 + i); b.z += 0.02 * Math.cos(k * 0.07 + i); }
      // (boxes edited in place, as the game does: one goes, one comes back)
      layout.props[k % 240].h = k % 480 < 240 ? 0 : 1.5;
      occ.setBodies(actors, eye);
      fb.update(k % 2 ? 1 / 60 : 1 / 144, G.light);
    };
    const census = (k: number): void => { frame(k); const d = fb.debug(); onProps += d.onProps; onBodies += d.onBodies; most = Math.max(most, d.candidates); };
    for (let k = 0; k < 3000; k++) census(k); // warm (the optimiser's own allocations), and what the beam meets
    expect(onProps / 3000).toBeGreaterThan(3);
    expect(onBodies / 3000).toBeGreaterThan(0.5);
    const used = (): number => { gc(); gc(); return process.memoryUsage().heapUsed; };
    // nothing is kept: the heap after a collection is where it was (the least of a few rounds: the test runner's own objects come and go)
    used();
    let kept = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 4; round++) {
      const h0 = used();
      for (let k = 0; k < 5000; k++) frame(3000 + round * 5000 + k);
      kept = Math.min(kept, used() - h0);
    }
    expect(kept).toBeLessThan(4096);
    // and what passes through the heap between collections: update() and setBodies() make no object of their own. V8 boxes the seven
    // numbers of a ray as the arguments of BandScene.trace (30 rays x 7 x 16 bytes = 3360 bytes of short-lived numbers an update) —
    // that is all; one small object more per update would be 16 000 to 32 000 bytes more per 1000
    let least = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 5; round++) {
      gc();
      const a = process.memoryUsage().heapUsed;
      for (let k = 0; k < 1000; k++) frame(23000 + round * 1000 + k);
      least = Math.min(least, process.memoryUsage().heapUsed - a);
    }
    console.log(`flash bounce, heap traffic of setBodies + update with ${layout.props.length} props and ${actors.length} characters bound (${(onProps / 3000).toFixed(1)} rays on props, ${(onBodies / 3000).toFixed(1)} on characters a frame, ` +
      `up to ${most} things in the beam): ${(least / 1000).toFixed(0)} bytes a call (the boxed arguments of ${FLASH_RAYS} ray casts: ${FLASH_RAYS * 7 * 16})`);
    expect(least / 1000).toBeLessThan(FLASH_RAYS * 7 * 16 + 96);
    expect(fb.debug().updates).toBe(3000 + 20000 + 5000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the sum: CPU mirror and shader', () => {
  const R = rig(hall(24, 24, 2.6));
  paint(R.albedo, ALB_WALL, [0.6, 0.3, 0.2]); paint(R.albedo, ALB_FLOOR, [0.2, 0.4, 0.3]); paint(R.albedo, ALB_CEIL, [0.3, 0.3, 0.5]);
  /**
   * Lights on walls, the floor and the ceiling, of different patch sizes, and a fading one (the game's rig under a low ceiling,
   * looking down the room past a side wall, a frame after it looked at the side wall).
   */
  const scattered = (): FlashBounce => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(R.src);
    G.pose(1.6, 1.62, 9, Math.PI / 2);
    fb.update(1 / 60, G.light);
    G.pose(1.6, 1.62, 9, 0.1);
    fb.update(1 / 60, G.light);
    return fb;
  };
  /** Deterministic sample points and unit normals in and round the room. */
  const samples = (count: number): [V3, V3][] => {
    let seed = 0x2545f491;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    return Array.from({length: count}, () => [[rnd() * 14 - 1, rnd() * 5 - 0.3, rnd() * 14 - 1] as V3, unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5])]);
  };
  /** The documented formula, written out with the unit direction and the distance; every light with its own patch size. */
  const documented = (vpls: readonly FlashVpl[], p: V3, n: V3, gain: number, range: number): V3 => {
    const out: V3 = [0, 0, 0];
    for (const v of vpls) {
      const d = sub(posOf(v), p), r = Math.max(len(d), 1e-3), L: V3 = [d[0] / r, d[1] / r, d[2] / r];
      const window = Math.min(1, Math.max(0, 1 - (r / range) ** 4)) ** 2;
      const f = Math.max(0, dot(n, L)) * Math.max(0, -dot(L, nrmOf(v))) / (r * r + v.r0sq) * window;
      out[0] += v.r * f; out[1] += v.g * f; out[2] += v.b * f;
    }
    return [out[0] * gain, out[1] * gain, out[2] * gain];
  };

  it('sampleFlashBounce is the documented sum: J x max(0, n.L) x max(0, -L.n_i) / (r^2 + r0_i^2) x window, times the gain', () => {
    const fb = scattered();
    const kinds = new Set(litOf(fb).map(v => nrmOf(v).join()));
    expect(kinds.size).toBeGreaterThanOrEqual(3); // wall, floor, ceiling
    expect(fb.debug().extra + fb.debug().fading).toBeGreaterThanOrEqual(1);
    // the lights differ in patch size (what the sum must take from each)
    const sizes = litOf(fb).map(v => v.r0sq);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1.5);
    let lit = 0;
    for (const prm of [{x: 1, z: 11}, {x: 2.5, z: 6}, {x: 0.3, z: 30}]) {
      for (const [p, n] of samples(400)) {
        const got = sampleFlashBounce(fb.vpls, p, n, [0, 0, 0], prm), want = documented(fb.vpls, p, n, prm.x, prm.z);
        for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(want[c], 9);
        if (lum(got) > 1e-4) lit++;
      }
    }
    expect(lit).toBeGreaterThan(300);
    // the default parameters are FB.params' (the lead tunes there); it writes into what it is given
    const out = new Float32Array(3);
    expect(sampleFlashBounce(fb.vpls, [3, 0, 3], [0, 1, 0], out)).toBe(out);
    expect(out[0]).toBeCloseTo(documented(fb.vpls, [3, 0, 3], [0, 1, 0], FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.range)[0], 5);
    // at a light's own place (r = 0), also for a light with no patch size at all, nothing blows up
    for (const v of litOf(fb)) for (const r0sq of [v.r0sq, 0]) {
      const e = sampleFlashBounce(fb.vpls.map(q => ({...q, r0sq})), posOf(v), [0, 1, 0], [0, 0, 0], {x: 1, z: 11});
      expect(e.every(Number.isFinite)).toBe(true);
    }
  });

  /** flashBounceIrradiance compiled to GLSL (three's WebGL2 builder) and evaluated on the CPU with FB's current values. */
  function shaderSum(): (p: V3, n: V3) => number[] {
    const P = uniform(new THREE.Vector3()), Nn = uniform(new THREE.Vector3());
    const m = new NodeMaterial();
    m.fragmentNode = vec4(flashBounceIrradiance(P as never, Nn as never) as never, 1).toVar('fbProbe') as never;
    const B = new (GLSLNodeBuilder as unknown as new (o: unknown, r: unknown) => {
      scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; fragmentShader: string;
      uniforms: {fragment: {name: string; type: string; node: unknown}[]};
    })(new QuadMesh(m), headless('glsl'));
    B.scene = new THREE.Scene(); B.camera = new THREE.OrthographicCamera(); B.material = m;
    B.build();
    const code = mainBody(B.fragmentShader), unis = B.uniforms.fragment;
    const mine = new Set<unknown>([...FB.pos, ...FB.nrm, ...FB.col, FB.params]);
    expect(unis.filter(u => mine.has(u.node))).toHaveLength(FLASH_VPLS * 3 + 1);
    return (p, n) => {
      const env: Env = new Map();
      for (const u of unis) {
        if (u.node === P) env.set(u.name, [...p]);
        else if (u.node === Nn) env.set(u.name, [...n]);
        else if (mine.has(u.node)) env.set(u.name, (u.node as {value: THREE.Vector4}).value.toArray());
        else env.set(u.name, 0);
      }
      return runFlow(code, env, {}, 'fbProbe') as number[];
    };
  }

  it('the generated shader gives the mirror\'s numbers with every light\'s own patch size, follows FB.params, and is exactly zero when off', () => {
    const fb = scattered(), run = shaderSum();
    const saved = FB.params.value.clone();
    try {
      for (const prm of [[1, 0.5, 11], [2.5, 0.2, 6]]) {
        FB.params.value.set(prm[0], prm[1], prm[2], 0);
        let lit = 0;
        for (const [p, n] of samples(150)) {
          const got = run(p, n), want = sampleFlashBounce(fb.vpls, p, n, [0, 0, 0]);
          for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(want[c], 9);
          if (lum(want) > 1e-4) lit++;
        }
        expect(lit).toBeGreaterThan(30);
      }
      // the patch size is read from the light's own uniform (the w of its position), not from the parameters: a light made larger there alone
      FB.params.value.copy(saved);
      const one = fb.vpls.findIndex(isOn), p: V3 = [fb.vpls[one].x + fb.vpls[one].nx * 0.3, fb.vpls[one].y + fb.vpls[one].ny * 0.3, fb.vpls[one].z + fb.vpls[one].nz * 0.3], n = nrmOf(fb.vpls[one]).map(c => -c) as V3;
      const before = run(p, n);
      FB.pos[one].value.w = 25;
      const larger = sampleFlashBounce(fb.vpls.map((v, i) => (i === one ? {...v, r0sq: 25} : v)), p, n, [0, 0, 0]), after = run(p, n);
      for (let c = 0; c < 3; c++) expect(after[c]).toBeCloseTo(larger[c], 9);
      expect(lum(after)).toBeLessThan(0.8 * lum(before));
      fb.bind(null);
      for (const [q, m] of samples(20)) expect(run(q, m).slice(0, 3)).toEqual([0, 0, 0]);
    } finally {
      FB.params.value.copy(saved);
    }
  });

  it('in a lit material the bounce adds no uniform buffer, no array, no texture: thirty-one vec4 in the render group\'s buffer', () => {
    expect(FLASH_VPLS * 3 + 1).toBe(31);
    for (const backend of ['wgsl', 'glsl'] as const) {
      const std = () => new MeshStandardNodeMaterial({color: 0x808080, roughness: 0.7});
      const plain = compile(backend, std(), [new LightFieldLight()]);
      const bounce = compile(backend, std(), [new BounceLight()]);
      expect(bounce).not.toBe(plain);
      expect(bindings(backend, bounce), backend).toEqual(bindings(backend, plain));
      expect(bindings(backend, plain).ubos).toBeGreaterThan(0);
      const arrays = (s: string) => (s.match(backend === 'wgsl' ? /array\s*</g : /\w+\s*\[\s*\d+\s*\]\s*;/g) ?? []).length;
      expect(arrays(bounce), backend).toBe(arrays(plain));
      // the thirty-one uniforms, as plain members of the render group's block
      const member = (name: string) => (backend === 'wgsl' ? new RegExp(`\\b${name} : vec4<f32>`) : new RegExp(`\\bvec4 ${name};`));
      for (const name of ['fbParams', ...['fbPos', 'fbNrm', 'fbCol'].flatMap(k => Array.from({length: FLASH_VPLS}, (_, i) => `${k}${i}`))]) {
        expect(bounce, `${backend} ${name}`).toMatch(member(name));
        expect(plain).not.toMatch(member(name));
      }
      if (backend === 'wgsl') {
        const block = /struct renderStruct \{([^}]*)\}/.exec(bounce)![1];
        expect((block.match(/\bfb\w+ : vec4<f32>/g) ?? [])).toHaveLength(FLASH_VPLS * 3 + 1);
        expect(bounce).toMatch(/render\.fbCol9\.xyz/);
        // every light's patch size is read from its own position uniform
        for (let i = 0; i < FLASH_VPLS; i++) expect(bounce).toMatch(new RegExp(`render\\.fbPos${i}\\.w\\b`));
      }
      // an unlit material under the same light: no bounce code at all (as the field itself: surface lighting models only)
      const basic = compile(backend, new MeshBasicNodeMaterial(), [new BounceLight()]);
      expect(basic).not.toMatch(/fbPos0/);
    }
  });

  it('the modules: plain render-group uniforms only, no texture, no random number, no clock, nothing of the save', () => {
    const read = (f: string) => readFileSync(new URL(`../src/world/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const code = read('flashBounce.ts'), occluders = read('flashOccluders.ts');
    expect(code).not.toMatch(/uniformArray|texture|\.load\(|\.sample\(/);
    for (const src of [code, occluders]) {
      expect(src).not.toMatch(/Math\.random|mulberry32|\brng\b|Date\.now|new Date|performance\.now/);
      expect(src).not.toMatch(/from '\.\.\/(run|campaign|items|save)\//);
      expect(src).not.toMatch(/localStorage|sessionStorage|navigator/);
    }
    // the bounce itself knows nothing of the game: the ray scene, the surface colours, the grid's cell size
    expect([...code.matchAll(/from '([^']+)'/g)].map(m => m[1]).sort()).toEqual(['../gen/grid', './lightScene', './surfaceAlbedo', 'three', 'three/tsl', 'three/webgpu']);
    expect(code.match(/uniform\(/g)).toHaveLength(2); // the per-light vec4 factory and params
    expect(code.match(/\.setGroup\(renderGroup\)/g)).toHaveLength(2);
    expect(FB.pos.length + FB.nrm.length + FB.col.length).toBe(FLASH_VPLS * 3);
    // one light per sector and the extra ones: 31 vec4 beside the render group's own (the fog march's fragment stage is at WebGPU's
    // twelve uniform buffers: nothing here may become one)
    expect(FLASH_VPLS).toBe(FLASH_SECTORS + FLASH_EXTRA);
    expect(FLASH_RAYS % FLASH_SECTORS).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the real base Subway, with the finishes the builder drew and its prop boxes', () => {
  const SEED = 93;
  let layout: StationLayout, scene: BandScene, albedo: SurfaceAlbedo, src: FlashBounceSource, spawn: {x: number; z: number; yaw: number}, open: number[], W = 0;
  beforeAll(async () => {
    layout = layoutFor('subway', SEED);
    const models = await modelsFor('subway', layout);
    dropUnloadedP7(layout, new Set(p7ModelKeysFor(layout).filter(k => models.lazy[k])));
    const world = drainSync(buildWorldSteps(layout, materialsFor(models), models.all));
    expect(world.drawn!.faces.length).toBeGreaterThan(0);
    // the ray scene and the surface colours, as world/enhancedLightingRuntime.ts makes them for the bake
    const fs = stationFieldSource(layout), geos = levelGeometries(fs);
    W = layout.grid.w;
    scene = new BandScene(W, layout.grid.h, geos);
    albedo = surfaceAlbedo(W, layout.grid.h, stationLevels(layout), geos, world.drawn);
    src = {scene, albedo};
    spawn = layout.playerSpawn;
    // standing places: the main level's walkable cells with headroom (every 7th)
    open = [];
    for (let i = 0; i < W * layout.grid.h; i++) if (layout.grid.cells[i] === FLOOR && geos[0].open[i] === 1 && geos[0].ceilH[i] - geos[0].floorH[i] > 2.2 && Math.abs(geos[0].floorH[i]) < 0.01) open.push(i);
    open = open.filter((_, k) => k % 7 === 0);
    expect(open.length).toBeGreaterThan(2000);
  }, 120000);

  const rhoAt = (slot: number, cell: number, off: number): V3 => { const A = albedo.slots[slot], o = cell * ALBEDO_STRIDE + off; return [ALBEDO_LUT[A[o]], ALBEDO_LUT[A[o + 1]], ALBEDO_LUT[A[o + 2]]]; };

  it('the architecture alone: every ray lands where an independent ray finds the surface, with that finish\'s colour and the game\'s flux; every light is the sum of its rays on their plane', () => {
    const fb = new FlashBounce(), G = gameRig();
    const c = new THREE.Color(GAME.color), at = new THREE.Vector3();
    let lights = 0, checked = 0, landed = 0, total = 0, walls = 0, floors = 0, ceils = 0, parents = 0, sumFlux = 0, lostFlux = 0, allFlux = 0, inSolid = 0;
    const colours = new Set<string>();
    for (let k = 0; k < open.length; k++) {
      const i = open[k], x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
      G.pose(x, STAND_EYE, z, k * 2.399963, 0.45 * Math.sin(k * 0.7));
      fb.bind(src); // (each pose on its own: the lights stand at their places)
      fb.update(1 / 60, G.light);
      const dbg = fb.debug();
      if (dbg.origin === 'parent') parents++;
      if (dbg.origin !== 'light') continue;
      at.setFromMatrixPosition(G.light.matrixWorld);
      const L: V3 = [at.x, at.y, at.z];
      total += FLASH_RAYS;
      landed += dbg.hits;
      sumFlux += lum(dbg.flux);
      for (const r of fb.rays()) {
        if (r.on === 'none') continue;
        expect(r.on).toBe('architecture');
        const hit: V3 = [r.x, r.y, r.z], d = len(sub(hit, L)), dir = unit(sub(hit, L));
        if (!scene.trace(L[0], L[1], L[2], dir[0], dir[1], dir[2], GAME.distance) || Math.abs(scene.hitT - d) > 1e-6) continue; // (an edge: the re-cast ray grazes past)
        const kind = scene.hitKind, n: V3 = kind === HIT_FLOOR ? [0, 1, 0] : kind === HIT_CEIL ? [0, -1, 0] : [scene.hitNx, 0, scene.hitNz];
        if (dot(n, [r.nx, r.ny, r.nz]) < 0.999) continue;
        checked++;
        if (kind === HIT_FLOOR) floors++; else if (kind === HIT_CEIL) ceils++; else walls++;
        const rho = rhoAt(scene.slot[scene.hitBand], scene.hitCol, kind === HIT_FLOOR ? ALB_FLOOR : kind === HIT_CEIL ? ALB_CEIL : ALB_WALL);
        colours.add(rho.map(u => u.toFixed(2)).join('/'));
        // what the ray sends back / pi, per unit of the light: albedo x the game's falloff at its distance x d^2 x its solid angle
        const j = dbg.weight * attenOf(d, GAME) * d * d / Math.PI;
        for (let q = 0; q < 3; q++) expect(r.transfer[q], `pose ${k} channel ${q}`).toBeCloseTo(rho[q] * j, 9);
      }
      const sums = expectLightsAreTheirRays(fb, G.light, `pose ${k}`);
      lostFlux += sums.lost; allFlux += sums.lost + sums.carried;
      for (const v of litOf(fb)) {
        lights++;
        expect(Object.values(v).every(Number.isFinite)).toBe(true);
        // (a light stands on its plane at the centre of its hits: with hits either side of a pier that can be under the pier)
        if (scene.bandAtPoint(v.x, v.y, v.z) < 0) inSolid++;
        // no light is a hot point: in front of it the bounce is at most gain / soft x the brightest radiosity the beam draws on its rays
        let brightest = 0;
        fb.rays().forEach(r => { if (fb.vpls[r.light] === v) brightest = Math.max(brightest, lum([r.transfer[0] * c.r, r.transfer[1] * c.g, r.transfer[2] * c.b]) * Math.PI / r.area); });
        expect(lum(rgbOf(v)) / v.r0sq, `pose ${k}: a light's peak`).toBeLessThanOrEqual(brightest * GAME.intensity / FLASH_BOUNCE_TUNING.soft * (1 + 1e-9));
      }
    }
    console.log(`flash bounce, Subway seed ${SEED}, the architecture alone: ${open.length} poses, ${landed} of ${total} rays landed (${(landed / total * 100).toFixed(1)} %), ${checked} re-cast and verified ` +
      `(${walls} on walls, ${floors} on floors, ${ceils} on ceilings; ${colours.size} finish colours: ${[...colours].sort().join(' ')}); ${lights} lights lit, ${inSolid} of them inside the solid; ` +
      `${(lostFlux / allFlux * 100).toFixed(1)} % of the reflected flux on a plane no light stands on; the light sat inside a wall at ${parents} poses (rays from the eye); ` +
      `mean reflected flux ${(sumFlux / (total / FLASH_RAYS)).toFixed(2)} of ${(GAME.intensity * spotConeSolidAngle(GAME.angle, GAME.penumbra)).toFixed(1)} emitted (x d^0.8: the game's falloff)`);
    expect(landed / total).toBeGreaterThan(0.9);
    expect(checked / landed).toBeGreaterThan(0.98);
    expect(Math.min(walls, floors, ceils)).toBeGreaterThan(1000);
    expect(colours.size).toBeGreaterThanOrEqual(5);
    // (measured: 0.1 % of the flux on a plane no light stands on; 35 of 27 139 lights under a pier or a lintel)
    expect(lostFlux / allFlux).toBeLessThan(0.01);
    expect(inSolid / lights).toBeLessThan(0.005);
  });

  it('with the station\'s prop boxes: every ray lands on the nearest of the architecture and the solid part of a box, as the test\'s own intersection of the whole list finds it — and where the game\'s own ray lands', () => {
    const fb = new FlashBounce(), G = gameRig(), occ = flashOccluders(layout), at = new THREE.Vector3();
    fb.occlude(occ);
    const props = layout.props, levels = levelsOf(layout), before = JSON.stringify(props);
    const tally = {architecture: 0, prop: 0, body: 0, none: 0};
    let most = 0, poses = 0, game = 0, agreed = 0, glassFirst = 0, startsInside = 0, lostFlux = 0, allFlux = 0;
    for (let k = 0; k < open.length; k += 2) {
      const i = open[k], x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
      G.pose(x, STAND_EYE, z, k * 2.399963, 0.45 * Math.sin(k * 0.7));
      fb.bind(src);
      fb.update(1 / 60, G.light);
      const dbg = fb.debug();
      if (dbg.origin !== 'light') continue;
      poses++;
      most = Math.max(most, dbg.candidates);
      at.setFromMatrixPosition(G.light.matrixWorld);
      const L: V3 = [at.x, at.y, at.z];
      fb.rays().forEach((r, j) => {
        tally[r.on]++;
        if (r.on === 'none') return;
        const dir = unit(sub([r.x, r.y, r.z], L)), want = nearest(scene, props, [], L, dir, GAME.distance);
        // (an edge of the architecture: the re-cast ray grazes past, as above)
        if (r.on === 'architecture' && want.on === 'architecture' && Math.abs(want.t - r.t) > 1e-6) return;
        expect(want.on, `pose ${k} ray ${j}`).toBe(r.on);
        expect(want.t, `pose ${k} ray ${j}`).toBeCloseTo(r.t, 6);
        if (r.on !== 'prop') return;
        [r.nx, r.ny, r.nz].forEach((c, q) => expect(c, `pose ${k} ray ${j} normal ${q}`).toBeCloseTo(want.n[q], 9));
        // the game's own ray (bullets): the same box at the same distance — but for the two things the beam's ray does on purpose:
        // it passes glass (a bullet stops on the glazing in front), and a box the light stands in is not there (a bullet fired
        // inside a box hits it at once)
        const own = raycastWorld(levels, props, {x: L[0], y: L[1], z: L[2]}, {x: dir[0], y: dir[1], z: dir[2]}, GAME.distance, layout.trench.floorY);
        game++;
        if (own.kind === 'prop' && Math.abs(own.t - r.t) < 1e-6) agreed++;
        else if (own.kind === 'prop' && own.t < 1e-6) startsInside++;
        else if (own.kind === 'prop' && own.t < r.t && !occ.stops(props[own.prop!])) glassFirst++;
        else expect.fail(`pose ${k} ray ${j}: the beam stands on a prop ${r.t} m off, the game's own ray on ${own.kind} ${own.t} m off`);
      });
      const sums = expectLightsAreTheirRays(fb, G.light, `pose ${k}`);
      lostFlux += sums.lost; allFlux += sums.lost + sums.carried;
    }
    const glazing = props.filter(p => !occ.stops(p)).length;
    console.log(`flash bounce, Subway seed ${SEED} with its ${props.length} prop boxes (${glazing} of them glass): ${poses} poses, ${tally.prop} rays on props (${(tally.prop / (poses * FLASH_RAYS) * 100).toFixed(1)} %), ` +
      `${tally.architecture} on the architecture, ${tally.none} nowhere; at most ${most} boxes in the beam at once; the game's own ray lands on a prop at the same distance for ${agreed} of ${game} of them ` +
      `(of the rest ${glassFirst} stop on glazing the beam passes, ${startsInside} start inside a box); ` +
      `${(lostFlux / allFlux * 100).toFixed(1)} % of the reflected flux on a plane no light stands on`);
    expect(tally.prop / (poses * FLASH_RAYS)).toBeGreaterThan(0.05);
    expect(tally.body).toBe(0);
    expect(glazing).toBeGreaterThan(0);
    expect(agreed + glassFirst + startsInside).toBe(game);
    expect(agreed / game).toBeGreaterThan(0.97);
    expect(Math.min(glassFirst, startsInside)).toBeGreaterThan(0);
    // (measured: 0.4 %)
    expect(lostFlux / allFlux).toBeLessThan(0.02);
    // the bounce reads the boxes and writes nothing: the layout's list is what it was (what a save holds of a station is untouched)
    expect(JSON.stringify(props)).toBe(before);
  });

  it('at the spawn the beam lights its surroundings; a red quarry-tile floor sends red light up to the ceiling over it', () => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(src);
    G.pose(spawn.x, STAND_EYE, spawn.z, spawn.yaw);
    fb.update(1 / 60, G.light);
    expect(fb.debug().hits).toBeGreaterThanOrEqual(FLASH_RAYS / 2);
    console.log(`flash bounce at the Subway spawn (seed ${SEED}): ${fb.debug().hits} rays landed, flux ${fb.debug().flux.map(v => v.toFixed(2)).join(' / ')}; ` +
      `lights ${litOf(fb).map(v => `[${posOf(v).map(u => u.toFixed(1)).join(' ')} | n ${nrmOf(v).map(u => u.toFixed(0)).join(' ')} | J ${lum(rgbOf(v)).toFixed(3)} | r0 ${Math.sqrt(v.r0sq).toFixed(2)}]`).join(' ')}`);
    expect(lum(fb.debug().flux)).toBeGreaterThan(0.2);
    // a quarry-tile cell (the builder's red shop floor), the beam straight down on it from standing height
    let cell = -1;
    const A = albedo.slots[0];
    for (let i = 0; i < A.length / ALBEDO_STRIDE && cell < 0; i++) {
      const [r, g2] = rhoAt(0, i, ALB_FLOOR);
      if (r > 0.2 && r > 3 * g2 && scene.of[i] >= 0 && Math.abs(scene.f[scene.of[i]]) < 0.01) {
        // ... with tile all round it (the whole cone lands on tile)
        let all = true;
        for (let dz = -3; dz <= 3 && all; dz++) for (let dx = -3; dx <= 3 && all; dx++) { const [r2, g3] = rhoAt(0, i + dz * W + dx, ALB_FLOOR); all = r2 > 3 * g3 && scene.of[i + dz * W + dx] >= 0; }
        if (all) cell = i;
      }
    }
    expect(cell).toBeGreaterThanOrEqual(0);
    const x = (cell % W + 0.5) * CELL, z = (Math.floor(cell / W) + 0.5) * CELL, tile = rhoAt(0, cell, ALB_FLOOR);
    const s = aim(spot(GAME), [x, STAND_EYE, z], [x + 0.01, 0, z]);
    fb.bind(src);
    fb.update(1 / 60, s);
    expect(fb.debug()).toMatchObject({hits: FLASH_RAYS, lights: FLASH_SECTORS});
    for (const v of litOf(fb)) { expect(nrmOf(v)).toEqual([0, 1, 0]); expect(v.y).toBeCloseTo(LIFT, 9); }
    const ceilY = scene.c[scene.of[cell]], up = E(fb, [x + 0.6, ceilY, z], [0, -1, 0]), wallSide = E(fb, [x + 1, 1.2, z], [-1, 0, 0]);
    const c = new THREE.Color(GAME.color);
    for (const e of [up, wallSide]) {
      expect(e[0]).toBeGreaterThan(0.01);
      expect(e[1] / e[0]).toBeCloseTo(tile[1] * c.g / (tile[0] * c.r), 6);
      expect(e[0]).toBeGreaterThan(3 * e[1]);
    }
    // the tile's own plane gets nothing from its own bounce
    expect(E(fb, [x + 0.7, 0, z], [0, 1, 0])).toEqual([0, 0, 0]);
    console.log(`flash bounce, the beam straight down on quarry tile (albedo ${tile.map(v => v.toFixed(2)).join(' / ')}): irradiance on the ceiling ${ceilY.toFixed(1)} m up ${up.map(v => v.toFixed(4)).join(' / ')}, ` +
      `on a thing's side 1 m away ${wallSide.map(v => v.toFixed(4)).join(' / ')}`);
  });

  /** A walk from the spawn along the platform, wherever there is standing room; the view sweeps and nods: x, z, yaw, pitch per 1/60 s. */
  const walk = (count: number): [number, number, number, number][] => {
    const poses: [number, number, number, number][] = [];
    let x = spawn.x, dir = 1;
    for (let k = 0; poses.length < count; k++) {
      const nx = x + dir * 0.05;
      if (scene.bandAtPoint(nx, STAND_EYE, spawn.z) >= 0 && scene.bandAtPoint(nx + dir * 0.4, STAND_EYE, spawn.z) >= 0) x = nx; else dir = -dir;
      poses.push([x, spawn.z, spawn.yaw + 1.2 * Math.sin(k * 0.021) + k * 0.004, 0.3 * Math.sin(k * 0.013)]);
      if (k > 100000) break;
    }
    return poses;
  };

  it('along a walk through the station with its prop boxes and a crowd bound, at 60 Hz and at 30 Hz: the bounce\'s flux never jumps up, and falls at once only by what a light given up lets go', () => {
    const poses = walk(2500), rows: {hz: number; frames: number; share: number; over: number; p99: number; most: number; dropped: number; mean: number; fading: number}[] = [];
    // sixteen characters in two rows the walk passes between
    const actors: FlashBodyActor[] = Array.from({length: 16}, (_, i) => ({brain: {x: spawn.x + (i % 8 - 3.5) * 1.7, y: 0, z: spawn.z + (i < 8 ? 2.5 : -3.5), alive: true, stats: {radius: 0.35}}, ragdolled: false}));
    for (const hz of [60, 30]) {
      const fb = new FlashBounce(), G = gameRig(), occ = flashOccluders(layout), eye = {x: 0, z: 0}, a = 1 - Math.exp(-(1 / hz) / FLASH_BOUNCE_TAU);
      fb.bind(src);
      fb.occlude(occ);
      const gone: number[] = [];
      let last = NaN, dropped = 0, mean = 0, fading = 0, onBodies = 0, onProps = 0;
      for (let k = 0; k < poses.length; k += 60 / hz) {
        const p = poses[k];
        eye.x = p[0]; eye.z = p[1];
        G.pose(p[0], STAND_EYE, p[1], p[2], p[3]);
        occ.setBodies(actors, eye);
        fb.update(1 / hz, G.light);
        const d = fb.debug(), f = fluxOf(fb.vpls);
        dropped = Math.max(dropped, d.dropped);
        mean += d.dropped;
        if (d.fading > 0) fading++;
        onBodies += d.onBodies; onProps += d.onProps;
        if (!Number.isNaN(last)) {
          // what the flux is due to be: last frame's, drawn 1 - exp(-dt / tau) of the way to the flux of the rays the lights carry
          const due = last + a * (carriedFlux(fb, G.light) - last);
          expect(f, `${hz} Hz frame ${k}: the flux never jumps up`).toBeLessThanOrEqual(due * (1 + 1e-9) + 1e-12);
          gone.push(due > 0 ? (due - f) / due : 0);
        }
        last = f;
      }
      expect(Math.min(onBodies, onProps)).toBeGreaterThan(100);
      gone.sort((x, y) => x - y);
      rows.push({
        hz, frames: gone.length, share: gone.filter(v => v > 1e-6).length / gone.length, over: gone.filter(v => v > 0.02).length / gone.length, p99: gone[Math.floor(gone.length * 0.99)],
        most: gone[gone.length - 1], dropped, mean: mean / (gone.length + 1), fading: fading / gone.length,
      });
    }
    console.log(`flash bounce, a walk through Subway seed ${SEED} with its prop boxes and 16 characters: ${rows.map(r => `at ${r.hz} Hz (${r.frames} frames, a light fading in ${(r.fading * 100).toFixed(0)} % of them): ` +
      `a light is given up in ${(r.share * 100).toFixed(1)} % of the frames; it lets go more than 2 % of the frame's flux in ${(r.over * 100).toFixed(1)} % of them, ${(r.p99 * 100).toFixed(2)} % at the 99th percentile ` +
      `and ${(r.most * 100).toFixed(2)} % at the most; ${(r.mean * 100).toFixed(2)} % of the landed flux on a plane no light is free for on average, ${(r.dropped * 100).toFixed(1)} % at the most`).join('; ')}`);
    // The beam here lands on more planes than there are lights for much of the time (limit 3): the plane with the least flux then
    // has none, and a light that is fading out gives its place to a plane that needs one. What that lets go at once is stated here.
    // (measured at 60 Hz / 30 Hz: a light fading in 77 % / 81 % of the frames; more than 2 % let go in 8.4 % / 8.7 % of them,
    // 4.28 % / 3.77 % at the 99th percentile, 8.86 % / 4.59 % at the most; 2.2 % / 2.4 % of the landed flux without a light on
    // average, 20.1 % / 19.4 % at the most)
    for (const r of rows) {
      expect(r.fading, `${r.hz} Hz`).toBeGreaterThan(0.5);
      expect(r.most, `${r.hz} Hz`).toBeLessThan(0.15);
      expect(r.p99, `${r.hz} Hz`).toBeLessThan(0.07);
      expect(r.over, `${r.hz} Hz`).toBeLessThan(0.15);
      expect(r.mean, `${r.hz} Hz`).toBeLessThan(0.05);
      expect(r.dropped, `${r.hz} Hz`).toBeLessThan(0.3);
    }
  });

  it('what a frame costs: the characters listed and the update, with the station\'s prop boxes bound — no character, a crowd of sixteen, and the worst case of more characters in reach than are kept (median over 2000 frames along a walk with the head turning)', () => {
    const poses = walk(3500);
    /** `count` characters that keep their places round the player (2 m to 8 m off, all round): each frame as many as that are in reach. */
    const measure = (name: string, count: number): {median: number; kept: number; onBodies: number; onProps: number; landed: number} => {
      const fb = new FlashBounce(), G = gameRig(), occ = flashOccluders(layout), eye = {x: 0, z: 0};
      fb.bind(src);
      fb.occlude(occ);
      const actors: FlashBodyActor[] = Array.from({length: count}, () => ({brain: {x: 0, y: 0, z: 0, alive: true, stats: {radius: 0.35}}, ragdolled: false}));
      const step = (k: number): void => {
        const p = poses[k];
        eye.x = p[0]; eye.z = p[1];
        for (let i = 0; i < count; i++) { const b = actors[i].brain, q = 2 + (i % 6) * 1.2, th = i * 2.399963; b.x = p[0] + q * Math.cos(th); b.z = p[1] + q * Math.sin(th); }
        G.pose(p[0], STAND_EYE, p[1], p[2], p[3]);
        occ.setBodies(actors, eye);
        fb.update(1 / 60, G.light);
      };
      for (let k = 0; k < 1500; k++) step(k); // warm
      const times = new Float64Array(2000);
      let landed = 0, onProps = 0, onBodies = 0, things = 0, kept = 0;
      for (let k = 0; k < 2000; k++) {
        const t0 = performance.now();
        step(1500 + k);
        times[k] = performance.now() - t0;
        const d = fb.debug();
        landed += d.hits; onProps += d.onProps; onBodies += d.onBodies; things += d.candidates; kept = Math.max(kept, occ.bodyCount);
      }
      const sorted = Array.from(times).sort((a, b) => a - b), median = sorted[1000] * 1000, p95 = sorted[1900] * 1000, mean = sorted.reduce((s, v) => s + v, 0) / 2000 * 1000;
      console.log(`flash bounce frame on Subway seed ${SEED} (${scene.W} x ${scene.H} cells, ${scene.f.length} bands, ${layout.props.length} prop boxes), ${name} (${count} characters, ${kept} kept): median ${median.toFixed(2)} us, mean ${mean.toFixed(2)} us, ` +
        `p95 ${p95.toFixed(2)} us over 2000 frames (${FLASH_RAYS} rays each, ${(landed / 2000).toFixed(2)} landed on average, ${(onProps / 2000).toFixed(2)} on props, ${(onBodies / 2000).toFixed(2)} on characters; ${(things / 2000).toFixed(1)} things in the beam)`);
      return {median, kept, onBodies: onBodies / 2000, onProps: onProps / 2000, landed: landed / 2000};
    };
    const alone = measure('no character', 0), crowd = measure('a crowd by the game\'s measure', 16), horde = measure('the worst case', FLASH_BODIES_MAX + 16);
    expect(alone.landed).toBeGreaterThan(FLASH_RAYS * 0.8);
    expect(alone.onProps).toBeGreaterThan(0);
    expect(crowd.kept).toBe(16);
    expect(horde.kept).toBe(FLASH_BODIES_MAX);
    expect(horde.onBodies).toBeGreaterThan(crowd.onBodies);
    expect(crowd.onBodies).toBeGreaterThan(1);
    // a generous bound (shared CI runners): a frame has 6944 us at 144 Hz
    for (const m of [alone, crowd, horde]) expect(m.median).toBeLessThan(500);
  });
});
