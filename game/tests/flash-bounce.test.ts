// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane BOUNCE): the live flashlight bounce (world/flashBounce.ts) — virtual
// lights where the beam lands on the station's fixed architecture, summed per fragment on the GPU.
// - the spot light is read as three r186 shades it (cone factor, distance falloff: pinned on three's own source);
// - ENERGY: the lights together carry rho x the beam's flux off a flat wall — whatever the distance and the tilt with a physical
//   falloff; with the game's own falloff (decay 1.2, a 30 m cutoff) it is rho x the flux the game really draws on the wall
//   (x d^0.8 x the cutoff window), checked against a brute-force integral;
// - COLOUR: a red wall sends red light, the light's own colour times the surface's; DIRECTION: the floor and ceiling in front of the
//   lit wall get light, the wall's own plane and everything behind it get exactly none;
// - off (intensity 0, nothing bound) is exactly zero, in the lights, the uniforms and the sum; back on, the lights stand at their
//   places at once; a battery dip dims the bounce in the same frame;
// - the smoothing is frame-rate independent (30 / 60 / 144 Hz and uneven steps: the same state), a ray that lands nowhere fades
//   its light out, and 1000 updates allocate nothing;
// - the CPU mirror is the documented formula, and the GENERATED shader (GLSL, evaluated here) gives the mirror's numbers;
// - in a lit material's WGSL / GLSL the bounce adds no uniform buffer, no array and no texture;
// - on the real generated base Subway with the finishes the builder drew: every light stands in free space on the surface an
//   independent ray finds, with that finish's colour; what an update costs.
import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshBasicNodeMaterial, MeshStandardNodeMaterial, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer, type NodeBuilder} from 'three/webgpu';
import {normalWorld, positionWorld, uniform, vec4} from 'three/tsl';
import {layoutFor, materialsFor, modelsFor} from './helpers/pacedBuildFixture';
import {mainBody, runFlow, type Env} from './helpers/glslEval';
import {drainSync} from '../src/core/pacedBuild';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {STAND_EYE} from '../src/player/player';
import {buildWorldSteps} from '../src/world/builder';
import {stationLevels} from '../src/world/levelGeometry';
import {levelGeometries, type FieldSource} from '../src/world/lightField';
import {LightFieldLight, LightFieldNode, installLightFieldNode, type LightFieldSampleNodes} from '../src/world/lightFieldNode';
import {BandScene, HIT_CEIL, HIT_FLOOR} from '../src/world/lightScene';
import {stationFieldSource} from '../src/world/lights';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, surfaceAlbedo, type SurfaceAlbedo} from '../src/world/surfaceAlbedo';
import {
  FB, FLASH_BOUNCE_DEFAULTS, FLASH_BOUNCE_LIFT, FLASH_BOUNCE_REVIVE, FLASH_BOUNCE_TAU, FLASH_VPLS, FlashBounce, flashBounceIrradiance, sampleFlashBounce,
  spotConeAttenuation, spotConeSolidAngle, spotDistanceAttenuation, type FlashBounceSource, type FlashVpl,
} from '../src/world/flashBounce';

type V3 = [number, number, number];
const lum = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: ArrayLike<number>): number => Math.sqrt(dot(a, a));
const unit = (a: ArrayLike<number>): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const posOf = (v: FlashVpl): V3 => [v.x, v.y, v.z];
const nrmOf = (v: FlashVpl): V3 => [v.nx, v.ny, v.nz];
const rgbOf = (v: FlashVpl): V3 => [v.r, v.g, v.b];

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
describe('energy: the lights carry what the beam puts on the surface, times its colour', () => {
  // a 40 m x 40 m hall, 30 m high: the whole cone lands on the one wall at x = 0.5 m
  const R = rig(hall(80, 80, 30));
  const rho = paint(R.albedo, ALB_WALL, [0.5, 0.32, 0.18]);
  const WALL_X = CELL;
  const onWall = (fb: FlashBounce) => fb.vpls.every(v => Math.abs(v.x - (WALL_X + FLASH_BOUNCE_LIFT)) < 1e-9 && v.nx === 1 && v.ny === 0 && v.nz === 0);

  it('physical falloff: the sum of the lights\' flux is rho x the beam\'s flux at every distance and tilt, a sixth in each', () => {
    const fb = new FlashBounce();
    fb.bind(R.src);
    const s = spot(PHYSICAL), omega = spotConeSolidAngle(PHYSICAL.angle, PHYSICAL.penumbra);
    for (const [D, dz] of [[1, 0], [2.5, 0], [5, 0], [9, 0], [3, 3], [4, -6]]) {
      fb.bind(R.src); // (a new place: the lights appear there at once)
      fb.update(1 / 60, aim(s, [WALL_X + D, 15, 20], [WALL_X, 15, 20 + dz]));
      expect(fb.debug()).toMatchObject({bound: true, lit: true, hits: FLASH_VPLS, origin: 'light'});
      expect(onWall(fb), `D ${D} dz ${dz}`).toBe(true);
      const f = flux(fb);
      for (let c = 0; c < 3; c++) expect(f[c] / (rho[c] * PHYSICAL.intensity * omega), `D ${D} dz ${dz} channel ${c}`).toBeCloseTo(1, 9);
      // equal shares: the cone is cut into parts of equal flux
      for (const v of fb.vpls) expect(v.r * Math.PI / (rho[0] * PHYSICAL.intensity * omega / FLASH_VPLS)).toBeCloseTo(1, 9);
      fb.debug().flux.forEach((v, c) => expect(v).toBeCloseTo(f[c], 9));
    }
    expect(fb.debug().solidAngle).toBeCloseTo(omega, 12);
    expect(fb.debug().weight).toBeCloseTo(omega / FLASH_VPLS, 12);
  });

  it('the rays: the axis and a ring at the angle that halves the flux round the axis ray\'s cap', () => {
    const fb = new FlashBounce();
    fb.bind(R.src);
    const from: V3 = [WALL_X + 4, 15, 20];
    fb.update(1 / 60, aim(spot(PHYSICAL), from, [WALL_X, 15, 20]));
    const dirs = fb.vpls.map(v => unit(sub([v.x - FLASH_BOUNCE_LIFT, v.y, v.z], from)));
    expect(dirs[0][0]).toBeCloseTo(-1, 12);
    const ring = fb.debug().ringAngle;
    for (let i = 1; i < FLASH_VPLS; i++) expect(Math.acos(-dirs[i][0])).toBeCloseTo(ring, 9);
    // neighbours on the ring are a fifth of a turn apart
    for (let i = 1; i < FLASH_VPLS; i++) {
      const a = dirs[i], b = dirs[1 + i % (FLASH_VPLS - 1)];
      const ca = (a[1] * b[1] + a[2] * b[2]) / (Math.hypot(a[1], a[2]) * Math.hypot(b[1], b[2]));
      expect(ca).toBeCloseTo(Math.cos(2 * Math.PI / (FLASH_VPLS - 1)), 9);
    }
    // the flux inside the ring's angle: the cap's sixth plus half of the other five sixths
    const omega = coneIntegral(PHYSICAL, () => 1), inside = coneIntegral(PHYSICAL, th => (th <= ring ? 1 : 0));
    expect(inside / omega).toBeCloseTo((FLASH_VPLS + 1) / (2 * FLASH_VPLS), 3);
    expect(ring).toBeGreaterThan(PHYSICAL.angle * (1 - PHYSICAL.penumbra));
    expect(ring).toBeLessThan(PHYSICAL.angle);
    // on the game's camera the ring keeps its place in the view: its first ray is the lowest, the others mirror each other left / right
    const G = gameRig();
    G.pose(WALL_X + 4, 15, 20, Math.PI / 2); // looking along -x
    fb.bind(R.src);
    fb.update(1 / 60, G.light);
    const ys = fb.vpls.map(v => v.y), zs = fb.vpls.map(v => v.z);
    // (to a few centimetres: the game's light sits beside the eye and its beam is toed in a little)
    expect(Math.min(...ys)).toBe(ys[1]);
    expect(Math.abs(ys[2] - ys[5])).toBeLessThan(0.05);
    expect(Math.abs(ys[3] - ys[4])).toBeLessThan(0.05);
    expect(ys[3]).toBeGreaterThan(ys[2] + 1);
    expect(Math.abs(zs[2] + zs[5] - 2 * zs[1])).toBeLessThan(0.05);
    expect(Math.abs(zs[3] + zs[4] - 2 * zs[1])).toBeLessThan(0.05);
    expect(Math.abs(zs[2] - zs[5])).toBeGreaterThan(2);
  });

  it('the game\'s falloff: rho x the flux the game draws on the wall (x d^0.8 x the cutoff window), within 2 % of the integral', () => {
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
      rows.push(`${D} m: ${(f[0] / (rho[0] * c.r * GAME.intensity * omega)).toFixed(2)}x (integral ${(drawn / (GAME.intensity * omega)).toFixed(2)}x, ${((ratio - 1) * 100).toFixed(1)} %)`);
      // (six rays against a window that closes across the cone: looser in the last metres before the cutoff, where little is left)
      expect(Math.abs(ratio - 1), `D ${D}`).toBeLessThan(D <= 20 ? 0.02 : 0.08);
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

  it('every light stands just off the lit wall with the wall\'s normal', () => {
    const fb = lit([0.5, 0.5, 0.5]);
    expect(fb.debug().hits).toBe(FLASH_VPLS);
    for (const v of fb.vpls) {
      expect(v.x).toBeCloseTo(FACE_A - FLASH_BOUNCE_LIFT, 12);
      expect(nrmOf(v)).toEqual([-1, 0, 0]);
      expect(R.scene.bandAtPoint(v.x, v.y, v.z)).toBeGreaterThanOrEqual(0);
    }
    expect([fb.vpls[0].y, fb.vpls[0].z]).toEqual([1.6, 10]);
  });

  it('a red wall throws red light on the floor and ceiling near it; the light\'s colour times the wall\'s; a white wall fills more', () => {
    const red = paint(R.albedo, ALB_WALL, [0.6, 0.08, 0.06]);
    const fb = lit([0.6, 0.08, 0.06]);
    const c = new THREE.Color(GAME.color);
    for (const v of fb.vpls) {
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

  it('the two LIMITS, as stated: the beam passes what is not fixed architecture, and the lights cast no shadows', () => {
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
    // 1. a prop's cell on the beam's way (x 13 m, z 10 m: sight-blocking, as a cabinet or a closed door leaf): the lights stand on the
    //    wall behind it all the same — the ray scene holds nothing movable
    const prop = other(g2 => { g2.sightBlocked[20 * g2.w + 26] = 1; g2.blocked[20 * g2.w + 26] = 1; });
    expect(prop.fb.vpls).toEqual(fb.vpls);
    // 2. a pier (x 13.5 .. 14.5, z 12 .. 13, floor to ceiling) beside the beam: no ray lands on it, and the floor in its shadow
    //    (the straight line from every light to that point runs through the pier) is lit as if it were not there
    const pier = other(g2 => { for (const cx of [27, 28]) for (const cz of [24, 25]) g2.set(cx, cz, SOLID); });
    expect(pier.fb.vpls).toEqual(fb.vpls);
    const shadowed: V3 = [14.2, 0, 13.5];
    for (const v of pier.fb.vpls) {
      const d = sub(shadowed, posOf(v)), dir = unit(d);
      expect(pier.R2.scene.trace(v.x, v.y, v.z, dir[0], dir[1], dir[2], len(d) - 1e-3), 'the pier is in the way').toBe(true);
      expect(R.scene.trace(v.x, v.y, v.z, dir[0], dir[1], dir[2], len(d) - 1e-3)).toBe(false);
    }
    expect(lum(E(pier.fb, shadowed, [0, 1, 0]))).toBeGreaterThan(0.005);
    expect(E(pier.fb, shadowed, [0, 1, 0])).toEqual(E(fb, shadowed, [0, 1, 0]));
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
    for (const v of fb.vpls) expect(Object.values(v)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const [p, n] of [[[5, 0, 6], [0, 1, 0]], [[1, 2.2, 6], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]]] as [V3, V3][]) expect(E(fb, p, n)).toEqual([0, 0, 0]);
    expect(fb.debug()).toMatchObject({lit: false, hits: 0, flux: [0, 0, 0]});
  };

  it('intensity 0, a negative or broken intensity, nothing bound, bind(null): everything is exactly zero', () => {
    const fb = new FlashBounce(), s = aim(spot(GAME), ...A);
    allZero(fb);
    fb.update(1 / 60, s); // nothing bound
    allZero(fb);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    expect(lum(flux(fb))).toBeGreaterThan(1);
    expect(uniformsOf().some(v => v !== 0)).toBe(true);
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
  });

  it('switched on, the lights stand at their places at once (no glide from where they were, no fade-in)', () => {
    const fresh = new FlashBounce(), s = aim(spot(GAME), ...A);
    fresh.bind(R.src);
    fresh.update(1 / 60, s);
    const want = fresh.vpls.map(v => ({...v}));
    const fb = new FlashBounce();
    fb.bind(R.src);
    fb.update(1 / 60, aim(spot(GAME), [6, 2.2, 6], [6, 2.2, 11.5])); // lit, elsewhere
    const off = aim(spot({...GAME, intensity: 0}), ...A);
    fb.update(1 / 60, off);
    fb.update(0.5, off);
    fb.update(1 / 60, s);
    expect(fb.vpls).toEqual(want);
    expect(uniformsOf().slice(0, 3)).toEqual([want[0].x, want[0].y, want[0].z]);
    // ... also with no time passed in the frame it came on
    fb.update(1 / 60, off);
    fb.update(0, s);
    expect(fb.vpls).toEqual(want);
  });

  it('a battery dip dims the bounce in the same frame: the light\'s intensity and colour are never smoothed', () => {
    const fb = new FlashBounce(), s = aim(spot(GAME), ...A);
    fb.bind(R.src);
    fb.update(1 / 60, s);
    const full = fb.vpls.map(v => ({...v}));
    s.intensity = GAME.intensity * 0.35;
    s.color.setRGB(0.2, 0.9, 0.4);
    fb.update(1 / 144, s);
    const c0 = new THREE.Color(GAME.color);
    fb.vpls.forEach((v, i) => {
      expect(posOf(v)).toEqual(posOf(full[i]));
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
  // a 12 m room: from its middle the whole cone lands on one wall (5.5 m away)
  const R = rig(hall(24, 24));
  paint(R.albedo, ALB_WALL, [0.5, 0.4, 0.3]);
  const FROM: V3 = [6, 2.2, 6];
  const WEST: V3 = [0.5, 2.2, 6], SOUTH: V3 = [6, 2.2, 11.5];
  /** `steps` of time after the lights settled on the west wall and the beam turned to the south wall. */
  const turned = (steps: readonly number[]): FlashVpl[] => {
    const fb = new FlashBounce(), s = spot(GAME);
    fb.bind(R.src);
    fb.update(1 / 60, aim(s, FROM, WEST));
    aim(s, FROM, SOUTH);
    for (const dt of steps) fb.update(dt, s);
    return fb.vpls.map(v => ({...v}));
  };
  const even = (hz: number, T: number): number[] => { const n = Math.floor(T * hz + 1e-9), out = new Array<number>(n).fill(1 / hz); if (T - n / hz > 1e-12) out.push(T - n / hz); return out; };
  const close = (a: FlashVpl[], b: FlashVpl[], digits: number) => a.forEach((v, i) => (Object.keys(v) as (keyof FlashVpl)[]).forEach(k => expect(v[k], `light ${i} ${k}`).toBeCloseTo(b[i][k], digits)));

  it('the same state after 0.2 s at 30, 60 and 144 Hz and with uneven frames: the exponential blend between the two places', () => {
    const T = 0.2;
    const at30 = turned(even(30, T)), at60 = turned(even(60, T)), at144 = turned(even(144, T));
    const uneven = turned([0.004, 0.05, 0.011, 0.033, 0.002, 0.1]);
    expect(even(30, T)).toHaveLength(6);
    expect(even(144, T)).toHaveLength(29);
    close(at60, at30, 9);
    close(at144, at30, 9);
    close(uneven, at30, 9);
    // what that state is: start -> end by 1 - exp(-T / tau)
    const start = turned([]), end = turned([1e9]), k = Math.exp(-T / FLASH_BOUNCE_TAU);
    expect(start.every(v => v.nx === 1 && v.nz === 0) && end.every(v => v.nz === -1 && v.nx === 0)).toBe(true);
    at30.forEach((v, i) => {
      const a = start[i], b = end[i];
      for (const q of ['x', 'y', 'z', 'r', 'g', 'b'] as const) expect(v[q], `light ${i} ${q}`).toBeCloseTo(b[q] + (a[q] - b[q]) * k, 9);
      // the normal turns from one wall's to the other's, and is a unit vector on the way
      const raw = unit([b.nx + (a.nx - b.nx) * k, b.ny + (a.ny - b.ny) * k, b.nz + (a.nz - b.nz) * k]);
      nrmOf(v).forEach((c, q) => expect(c, `light ${i} normal ${q}`).toBeCloseTo(raw[q], 9));
      expect(len(nrmOf(v))).toBeCloseTo(1, 12);
    });
    expect(FLASH_BOUNCE_TAU).toBeGreaterThanOrEqual(0.06);
    expect(FLASH_BOUNCE_TAU).toBeLessThanOrEqual(0.09);
  });

  it('a paused frame (dt 0) moves nothing; a long one arrives', () => {
    const start = turned([]);
    close(turned([0, 0, 0]), start, 12);
    close(turned([-1, NaN]), start, 12);
    const end = turned([1e9]);
    close(turned([30]), end, 9);
    close(turned([Infinity]), end, 12);
  });

  it('a steady sweep: the lights trail the beam by about its speed x tau at every frame rate (less half a frame\'s travel)', () => {
    // the beam's centre crosses the west wall at 8 m/s for 0.4 s
    const V = 8, T = 0.4;
    const lag = (hz: number): number => {
      const fb = new FlashBounce(), s = spot(GAME);
      fb.bind(R.src);
      fb.update(1 / hz, aim(s, FROM, [0.5, 2.2, 4.4]));
      const n = Math.round(T * hz);
      for (let k = 1; k <= n; k++) fb.update(1 / hz, aim(s, FROM, [0.5, 2.2, 4.4 + V * k / hz]));
      return 4.4 + V * T - fb.vpls[0].z;
    };
    const l30 = lag(30), l60 = lag(60), l144 = lag(144);
    for (const [hz, l] of [[30, l30], [60, l60], [144, l144]]) {
      expect(l, `${hz} Hz`).toBeGreaterThan(V * (FLASH_BOUNCE_TAU - 0.5 / hz) * 0.93);
      expect(l, `${hz} Hz`).toBeLessThan(V * FLASH_BOUNCE_TAU * 1.02);
    }
    expect(Math.abs(l60 - l144)).toBeLessThan(0.05);
    expect(Math.abs(l30 - l144)).toBeLessThan(0.12);
  });

  it('a ray that lands nowhere fades its light out where it stood; back early it glides on, back late it reappears at its place', () => {
    // a 5 m beam: the wall is in reach from 3.5 m, out of reach from 5.5 m
    const SHORT = {...GAME, distance: 5};
    const near: [V3, V3] = [[4, 2.2, 6], WEST], far: [V3, V3] = [[6, 2.2, 6], WEST], other: [V3, V3] = [[4, 2.2, 4], [0.5, 2.2, 4]];
    const run = (steps: readonly number[]): {fb: FlashBounce; s: THREE.SpotLight; lit: FlashVpl[]} => {
      const fb = new FlashBounce(), s = spot(SHORT);
      fb.bind(R.src);
      fb.update(1 / 60, aim(s, ...near));
      const lit = fb.vpls.map(v => ({...v}));
      aim(s, ...far);
      for (const dt of steps) fb.update(dt, s);
      return {fb, s, lit};
    };
    for (const steps of [even(30, 0.1), even(144, 0.1), [0.1]]) {
      const {fb, lit} = run(steps);
      expect(fb.debug()).toMatchObject({hits: 0, lit: true});
      fb.vpls.forEach((v, i) => {
        expect(posOf(v)).toEqual(posOf(lit[i]));
        expect(nrmOf(v)).toEqual(nrmOf(lit[i]));
        for (const q of ['r', 'g', 'b'] as const) expect(v[q] / lit[i][q]).toBeCloseTo(Math.exp(-0.1 / FLASH_BOUNCE_TAU), 9);
      });
    }
    // gone for good: exactly zero in the end (no endless tail of tiny numbers)
    expect(flux(run([5]).fb)).toEqual([0, 0, 0]);
    // back after 0.05 s (half of it left): it glides from where it stood to its new place
    const early = run([0.05]);
    early.fb.update(1 / 60, aim(early.s, ...other));
    const a = 1 - Math.exp(-1 / 60 / FLASH_BOUNCE_TAU);
    expect(early.fb.vpls[0].z).toBeCloseTo(6 + (4 - 6) * a, 9);
    // back after 0.25 s (under FLASH_BOUNCE_REVIVE of it left): it stands at its new place at once and fades in there
    const late = run([0.25]);
    expect(Math.exp(-0.25 / FLASH_BOUNCE_TAU)).toBeLessThan(FLASH_BOUNCE_REVIVE);
    const left = late.fb.vpls[0].r;
    late.fb.update(1 / 60, aim(late.s, ...other));
    expect(late.fb.vpls[0].z).toBe(4);
    expect(late.fb.vpls[0].r).toBeCloseTo(left + (late.lit[0].r - left) * a, 9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('no allocation', () => {
  it('1000 updates of a moving, flickering beam leave the heap where it was', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const R = rig(hall(48, 32));
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(R.src);
    const frame = (k: number): void => {
      G.pose(12 + 6 * Math.sin(k * 0.013), 1.62, 8 + 4 * Math.cos(k * 0.007), k * 0.021, 0.5 * Math.sin(k * 0.05));
      G.light.intensity = k % 97 === 0 ? 0 : 34 * (0.6 + 0.4 * Math.sin(k * 0.3));
      fb.update(k % 2 ? 1 / 60 : 1 / 144, G.light);
    };
    for (let k = 0; k < 3000; k++) frame(k); // warm (the optimiser's own allocations)
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
    // and what passes through the heap between collections: update() makes no object of its own. V8 boxes the seven numbers of a
    // ray as the arguments of BandScene.trace (6 rays x 7 x 16 bytes = 672 bytes of short-lived numbers an update) — that is all;
    // one small object more per update would be 16 000 to 32 000 bytes more per 1000
    let least = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 5; round++) {
      gc();
      const a = process.memoryUsage().heapUsed;
      for (let k = 0; k < 1000; k++) frame(4000 + round * 1000 + k);
      least = Math.min(least, process.memoryUsage().heapUsed - a);
    }
    console.log(`flash bounce, heap traffic of update: ${(least / 1000).toFixed(0)} bytes a call (the boxed arguments of ${FLASH_VPLS} ray casts: ${FLASH_VPLS * 7 * 16})`);
    expect(least / 1000).toBeLessThan(FLASH_VPLS * 7 * 16 + 96);
    expect(fb.debug().updates).toBe(3000 + 20000 + 5000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the sum: CPU mirror and shader', () => {
  const R = rig(hall(24, 24, 2.6));
  paint(R.albedo, ALB_WALL, [0.6, 0.3, 0.2]); paint(R.albedo, ALB_FLOOR, [0.2, 0.4, 0.3]); paint(R.albedo, ALB_CEIL, [0.3, 0.3, 0.5]);
  /** Lights on walls, the floor and the ceiling (the game's rig under a low ceiling, looking down the room past a side wall). */
  const scattered = (): FlashBounce => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(R.src);
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
  /** The documented formula, written out with the unit direction and the distance. */
  const documented = (vpls: readonly FlashVpl[], p: V3, n: V3, gain: number, r0: number, range: number): V3 => {
    const out: V3 = [0, 0, 0];
    for (const v of vpls) {
      const d = sub(posOf(v), p), r = Math.max(len(d), 1e-3), L: V3 = [d[0] / r, d[1] / r, d[2] / r];
      const window = Math.min(1, Math.max(0, 1 - (r / range) ** 4)) ** 2;
      const f = Math.max(0, dot(n, L)) * Math.max(0, -dot(L, nrmOf(v))) / (r * r + r0 * r0) * window;
      out[0] += v.r * f; out[1] += v.g * f; out[2] += v.b * f;
    }
    return [out[0] * gain, out[1] * gain, out[2] * gain];
  };

  it('sampleFlashBounce is the documented sum: J x max(0, n.L) x max(0, -L.n_i) / (r^2 + r0^2) x window, times the gain', () => {
    const fb = scattered();
    const kinds = new Set(fb.vpls.map(v => nrmOf(v).join()));
    expect(kinds.size).toBeGreaterThanOrEqual(3); // wall, floor, ceiling
    expect([FB.params.value.x, FB.params.value.y, FB.params.value.z]).toEqual([FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.r0, FLASH_BOUNCE_DEFAULTS.range]);
    let lit = 0;
    for (const prm of [{x: 1, y: 0.5, z: 11}, {x: 2.5, y: 0.2, z: 6}, {x: 0.3, y: 1.5, z: 30}]) {
      for (const [p, n] of samples(400)) {
        const got = sampleFlashBounce(fb.vpls, p, n, [0, 0, 0], prm), want = documented(fb.vpls, p, n, prm.x, prm.y, prm.z);
        for (let c = 0; c < 3; c++) expect(got[c]).toBeCloseTo(want[c], 9);
        if (lum(got) > 1e-4) lit++;
      }
    }
    expect(lit).toBeGreaterThan(300);
    // the default parameters are FB.params' (the lead tunes there); it writes into what it is given
    const out = new Float32Array(3);
    expect(sampleFlashBounce(fb.vpls, [3, 0, 3], [0, 1, 0], out)).toBe(out);
    expect(out[0]).toBeCloseTo(documented(fb.vpls, [3, 0, 3], [0, 1, 0], FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.r0, FLASH_BOUNCE_DEFAULTS.range)[0], 5);
    // at a light's own place (r = 0) and with r0 = 0 nothing blows up
    for (const v of fb.vpls) for (const r0 of [0.5, 0]) {
      const e = sampleFlashBounce(fb.vpls, posOf(v), [0, 1, 0], [0, 0, 0], {x: 1, y: r0, z: 11});
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

  it('the generated shader gives the mirror\'s numbers, follows FB.params, and is exactly zero when off', () => {
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
      FB.params.value.copy(saved);
      fb.bind(null);
      for (const [p, n] of samples(20)) expect(run(p, n).slice(0, 3)).toEqual([0, 0, 0]);
    } finally {
      FB.params.value.copy(saved);
    }
  });

  it('in a lit material the bounce adds no uniform buffer, no array, no texture: nineteen vec4 in the render group\'s buffer', () => {
    for (const backend of ['wgsl', 'glsl'] as const) {
      const std = () => new MeshStandardNodeMaterial({color: 0x808080, roughness: 0.7});
      const plain = compile(backend, std(), [new LightFieldLight()]);
      const bounce = compile(backend, std(), [new BounceLight()]);
      expect(bounce).not.toBe(plain);
      expect(bindings(backend, bounce), backend).toEqual(bindings(backend, plain));
      expect(bindings(backend, plain).ubos).toBeGreaterThan(0);
      const arrays = (s: string) => (s.match(backend === 'wgsl' ? /array\s*</g : /\w+\s*\[\s*\d+\s*\]\s*;/g) ?? []).length;
      expect(arrays(bounce), backend).toBe(arrays(plain));
      // the nineteen uniforms, as plain members of the render group's block
      const member = (name: string) => (backend === 'wgsl' ? new RegExp(`\\b${name} : vec4<f32>`) : new RegExp(`\\bvec4 ${name};`));
      for (const name of ['fbParams', ...['fbPos', 'fbNrm', 'fbCol'].flatMap(k => Array.from({length: FLASH_VPLS}, (_, i) => `${k}${i}`))]) {
        expect(bounce, `${backend} ${name}`).toMatch(member(name));
        expect(plain).not.toMatch(member(name));
      }
      if (backend === 'wgsl') {
        const block = /struct renderStruct \{([^}]*)\}/.exec(bounce)![1];
        expect((block.match(/\bfb\w+ : vec4<f32>/g) ?? [])).toHaveLength(FLASH_VPLS * 3 + 1);
        expect(bounce).toMatch(/render\.fbCol5\.xyz/);
      }
      // an unlit material under the same light: no bounce code at all (as the field itself: surface lighting models only)
      const basic = compile(backend, new MeshBasicNodeMaterial(), [new BounceLight()]);
      expect(basic).not.toMatch(/fbPos0/);
    }
  });

  it('the module: plain render-group uniforms only, no texture, no random number, no clock, nothing of the save', () => {
    const code = readFileSync(new URL('../src/world/flashBounce.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/uniformArray|texture|\.load\(|\.sample\(/);
    expect(code).not.toMatch(/Math\.random|mulberry32|\brng\b|Date\.now|new Date|performance\.now/);
    expect(code).not.toMatch(/from '\.\.\/(run|campaign|items|save)\//);
    expect(code).not.toMatch(/localStorage|sessionStorage|navigator/);
    expect(code.match(/uniform\(/g)).toHaveLength(2); // the per-light vec4 factory and params
    expect(code.match(/\.setGroup\(renderGroup\)/g)).toHaveLength(2);
    expect(FB.pos.length + FB.nrm.length + FB.col.length).toBe(FLASH_VPLS * 3);
    expect(FLASH_VPLS).toBeGreaterThanOrEqual(5);
    expect(FLASH_VPLS).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the real base Subway, with the finishes the builder drew', () => {
  const SEED = 93;
  let scene: BandScene, albedo: SurfaceAlbedo, src: FlashBounceSource, spawn: {x: number; z: number; yaw: number}, open: number[], W = 0;
  beforeAll(async () => {
    const layout = layoutFor('subway', SEED);
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

  it('every light stands in free space on the surface an independent ray finds there, with that finish\'s colour and the game\'s flux', () => {
    const fb = new FlashBounce(), G = gameRig();
    const c = new THREE.Color(GAME.color), at = new THREE.Vector3(), to = new THREE.Vector3();
    let lights = 0, checked = 0, landed = 0, total = 0, walls = 0, floors = 0, ceils = 0, parents = 0, sumFlux = 0;
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
      to.setFromMatrixPosition(G.light.target.matrixWorld);
      const L: V3 = [at.x, at.y, at.z], axis = unit(sub([to.x, to.y, to.z], L));
      total += FLASH_VPLS;
      landed += dbg.hits;
      sumFlux += lum(dbg.flux);
      fb.vpls.forEach((v, q) => {
        expect(Object.values(v).every(Number.isFinite)).toBe(true);
        if (v.r + v.g + v.b <= 0) return;
        lights++;
        expect(len(nrmOf(v))).toBeCloseTo(1, 12);
        expect(scene.bandAtPoint(v.x, v.y, v.z), `pose ${k} light ${q}`).toBeGreaterThanOrEqual(0);
        // the surface point, and the ray from the light to it
        const hit: V3 = [v.x - v.nx * FLASH_BOUNCE_LIFT, v.y - v.ny * FLASH_BOUNCE_LIFT, v.z - v.nz * FLASH_BOUNCE_LIFT];
        const d = len(sub(hit, L)), dir = unit(sub(hit, L));
        expect(Math.acos(Math.min(1, dot(dir, axis)))).toBeCloseTo(q === 0 ? 0 : dbg.ringAngle, 6);
        if (!scene.trace(L[0], L[1], L[2], dir[0], dir[1], dir[2], GAME.distance) || Math.abs(scene.hitT - d) > 1e-6) return; // (an edge: the re-cast ray grazes past)
        const kind = scene.hitKind, n: V3 = kind === HIT_FLOOR ? [0, 1, 0] : kind === HIT_CEIL ? [0, -1, 0] : [scene.hitNx, 0, scene.hitNz];
        if (dot(n, nrmOf(v)) < 0.999) return;
        checked++;
        if (kind === HIT_FLOOR) floors++; else if (kind === HIT_CEIL) ceils++; else walls++;
        const rho = rhoAt(scene.slot[scene.hitBand], scene.hitCol, kind === HIT_FLOOR ? ALB_FLOOR : kind === HIT_CEIL ? ALB_CEIL : ALB_WALL);
        colours.add(rho.map(u => u.toFixed(2)).join('/'));
        const j = GAME.intensity * dbg.weight * attenOf(d, GAME) * d * d / Math.PI;
        expect(v.r, `pose ${k} light ${q} r`).toBeCloseTo(rho[0] * c.r * j, 9);
        expect(v.g, `pose ${k} light ${q} g`).toBeCloseTo(rho[1] * c.g * j, 9);
        expect(v.b, `pose ${k} light ${q} b`).toBeCloseTo(rho[2] * c.b * j, 9);
      });
    }
    console.log(`flash bounce, Subway seed ${SEED}: ${open.length} poses, ${landed} of ${total} rays landed (${(landed / total * 100).toFixed(1)} %), ${lights} lights lit, ${checked} re-cast and verified ` +
      `(${walls} on walls, ${floors} on floors, ${ceils} on ceilings; ${colours.size} finish colours: ${[...colours].sort().join(' ')}); the light sat inside a wall at ${parents} poses (rays from the eye); ` +
      `mean reflected flux ${(sumFlux / (total / FLASH_VPLS)).toFixed(2)} of ${(GAME.intensity * spotConeSolidAngle(GAME.angle, GAME.penumbra)).toFixed(1)} emitted (x d^0.8: the game's falloff)`);
    expect(landed / total).toBeGreaterThan(0.9);
    expect(checked / lights).toBeGreaterThan(0.98);
    expect(Math.min(walls, floors, ceils)).toBeGreaterThan(200);
    expect(colours.size).toBeGreaterThanOrEqual(5);
  });

  it('at the spawn the beam lights its surroundings; a red quarry-tile floor sends red light up to the ceiling over it', () => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(src);
    G.pose(spawn.x, STAND_EYE, spawn.z, spawn.yaw);
    fb.update(1 / 60, G.light);
    expect(fb.debug().hits).toBeGreaterThanOrEqual(3);
    console.log(`flash bounce at the Subway spawn (seed ${SEED}): ${fb.debug().hits} rays landed, flux ${fb.debug().flux.map(v => v.toFixed(2)).join(' / ')}; ` +
      `lights ${fb.vpls.map(v => `[${posOf(v).map(u => u.toFixed(1)).join(' ')} | n ${nrmOf(v).join(' ')} | J ${lum(rgbOf(v)).toFixed(3)}]`).join(' ')}`);
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
    expect(fb.debug().hits).toBe(FLASH_VPLS);
    for (const v of fb.vpls) { expect(nrmOf(v)).toEqual([0, 1, 0]); expect(v.y).toBeCloseTo(FLASH_BOUNCE_LIFT, 9); }
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

  it('what an update costs (median over 2000 calls along a walk with the head turning)', () => {
    const fb = new FlashBounce(), G = gameRig();
    fb.bind(src);
    // a walk from the spawn along the platform, wherever there is standing room; the view sweeps and nods
    const poses: [number, number, number, number][] = [];
    let x = spawn.x, z = spawn.z, dir = 1;
    for (let k = 0; poses.length < 2500; k++) {
      const nx = x + dir * 0.05;
      if (scene.bandAtPoint(nx, STAND_EYE, z) >= 0 && scene.bandAtPoint(nx + dir * 0.4, STAND_EYE, z) >= 0) x = nx; else dir = -dir;
      poses.push([x, z, spawn.yaw + 1.2 * Math.sin(k * 0.021) + k * 0.004, 0.3 * Math.sin(k * 0.013)]);
      if (k > 100000) break;
    }
    const step = (k: number): void => { const p = poses[k]; G.pose(p[0], STAND_EYE, p[1], p[2], p[3]); fb.update(1 / 60, G.light); };
    for (let k = 0; k < 500; k++) step(k); // warm
    const times = new Float64Array(2000);
    let landed = 0;
    for (let k = 0; k < 2000; k++) { const t0 = performance.now(); step(500 + k); times[k] = performance.now() - t0; landed += fb.debug().hits; }
    const sorted = Array.from(times).sort((a, b) => a - b), median = sorted[1000] * 1000, p95 = sorted[1900] * 1000, mean = sorted.reduce((s, v) => s + v, 0) / 2000 * 1000;
    console.log(`flash bounce update on Subway seed ${SEED} (${scene.W} x ${scene.H} cells, ${scene.f.length} bands): median ${median.toFixed(2)} us, mean ${mean.toFixed(2)} us, p95 ${p95.toFixed(2)} us ` +
      `over 2000 calls (${FLASH_VPLS} rays each, ${(landed / 2000).toFixed(2)} landed on average)`);
    expect(landed / 2000).toBeGreaterThan(FLASH_VPLS * 0.8);
    // a generous bound (shared CI runners): a frame has 6944 us at 144 Hz
    expect(median).toBeLessThan(500);
  });
});
