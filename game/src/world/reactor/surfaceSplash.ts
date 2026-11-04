// Task studio-alpha-reactor-ending-polish-20261104-034806-01 (lane SPLASH): RAIN IMPACT SPLASHES on the Reactor's surface — user: "rain
// drops are not producing splashes when hitting the ground outside, they should!". Code-driven dynamic effect (root CLAUDE.md texture
// rule: rain / wet effects are exempt): no texture, no model, no generation.
//
// Where the rain lands, a brief water impact: a small ring that expands and fades on the surface, a bright dimple at the instant of
// impact and a tiny crown of droplets thrown up and out (falling back under gravity). ONE draw: a fixed batch of SLOTS (quads: one
// flat ring + SURFACE_SPLASH.sparks camera-facing droplets per slot) whose whole life runs in the vertex shader — each slot fires on
// its own seeded cycle (time + per-slot hashes, surfaceNodes.ts wmHash; CPU mirror splashAt), at a fresh WORLD-ANCHORED point each
// cycle (wrapped into a box round the eye, so walking never drags a splash along), denser near the eye:
//  - NEAR slots: a box +-near m round the eye; FAR slots: +-far m (both fading out toward their edge);
//  - LEDGE slots: the exposed tops the deck's eye sees — the plaza parapet, the compound wall's piers, the vent towers' plinths
//    (splashLedges: oriented rects in a small RGBA32F texture, read with textureLoad).
// WHERE (the rain's own floor map, surfaceRain.ts buildRainFloor, the same texture the drops stop at): a ground slot lands only on a
// texel at the walkable deck's / the city ground's height (never on a building, a plant structure, under the head house's roof or a
// shelter, over the aperture — its disc + the railing ring are cut exactly — or off the map), at that texel's height + a lift over the
// wet film / the collar; a ledge slot only where nothing stands over the ledge. GATES: drawn only with the near rain (the eye outside,
// rain > 0: surface.ts), density = the rain 0..1 (a slot fires when its hash is under it), the clock advances only in frame hooks (the
// game's pause stops it), disposed with the view. Plain uniforms + 2 textures (no uniformArray), additive, no depth write, no shadows.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, abs, attribute, clamp, cos, cross, float, floor, fract, int, ivec2, length, max, min, mix, normalize, pow, sin, smoothstep, sqrt, texture, uniform, varying, vec2, vec3, vec4} from 'three/tsl';
import {wmHash, wmHashCpu} from '../surfaceNodes';
import type {RainFloorMap} from './surfaceRain';
import type {SurfacePlantPlan} from './surfacePlantPlan';
import type {SurfaceSite} from './surfaceSite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** Splash tunables (m, s, linear colours). */
export const SURFACE_SPLASH = {
  /** Slots per kind (one ring + `sparks` droplets each). */
  slots: {near: 330, far: 150, ledge: 60},
  /** Box half sizes round the eye (m): the near slots', the far slots'; the ledge slots fade out by `ledgeR`. */
  near: 11, far: 30, ledgeR: 22,
  /** A splash's life (s: the ring's; the crown's is shorter); each cycle = life + a seeded rest in this range. */
  life: 0.38, crownS: 0.3, rest: [0.14, 1.0] as readonly [number, number],
  /** Ring: final radius range (m), line width near the eye (m); it fades out between these distances (sub-pixel lines far off). */
  ringR: [0.07, 0.17] as readonly [number, number], ringW: 0.014, ringFade: [8, 15] as readonly [number, number],
  /** Crown droplets per splash, their size near the eye (m), launch speed (m/s: outward, upward), gravity (m/s^2). */
  sparks: 4, sparkSize: 0.009, sparkOut: [0.3, 0.85] as readonly [number, number], sparkUp: [0.8, 1.6] as readonly [number, number], gravity: 9.81,
  /** Height over the surface (m): over the deck's wet film (+0.012) and the collar's overlay (<= +0.02); over a ledge's top. */
  lift: 0.024, ledgeLift: 0.008,
  /** A ground texel is open ground within this of the deck / the city ground; the aperture's cut beyond the railing ring (m). */
  tol: 0.012, holePad: 0.1,
  /** Colour (the overcast sky caught in the water), opacities, the beam's blue near its axis. */
  colour: [0.62, 0.67, 0.74] as readonly [number, number, number], ringAlpha: 0.5, sparkAlpha: 0.75, beamGain: 1.6, beamR: 7,
  /** Ledge rects are split into tiles about this long (an even pick per tile ~ per area). */
  ledgeTile: 2.2,
  /** The clock wraps after this long (s). */
  period: 600,
} as const;

/** Slot kinds (the `position.z` attribute). */
export const SPLASH_KIND = {near: 0, far: 1, ledge: 2} as const;

/** An exposed flat top a splash may land on: an oriented rect (three.js yaw: local x -> world (cos, -sin)) at height y. */
export interface SplashLedge { x: number; z: number; yaw: number; hw: number; hd: number; y: number; kind: 'parapet' | 'pier' | 'plinth' }

/** Split an oriented rect into tiles no longer than `tile` m (each a ledge). */
function tiles(r: Omit<SplashLedge, 'kind'>, kind: SplashLedge['kind'], tile: number, keep: (x: number, z: number) => boolean = () => true): SplashLedge[] {
  const out: SplashLedge[] = [], c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const nx = Math.max(1, Math.ceil((2 * r.hw) / tile)), nz = Math.max(1, Math.ceil((2 * r.hd) / tile));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = -r.hw + ((i + 0.5) * 2 * r.hw) / nx, lz = -r.hd + ((j + 0.5) * 2 * r.hd) / nz;
    const x = r.x + lx * c + lz * s, z = r.z - lx * s + lz * c;
    if (keep(x, z)) out.push({x, z, yaw: r.yaw, hw: r.hw / nx, hd: r.hd / nz, y: r.y, kind});
  }
  return out;
}

/**
 * The ledges: the plaza parapet's top (lane SURFACE's wall on the outer side of every boundary edge, surfaceCity.ts parapetGeometry), the
 * piers' tops and the vent towers' plinths (lane PLANT, surfacePlantPlan.ts) round the stack (a tile inside the stack is dropped).
 * Each inset a few cm from its edges.
 */
export function splashLedges(site: SurfaceSite, plant: Pick<SurfacePlantPlan, 'towers' | 'parts'> | null | undefined, parapetT: number): SplashLedge[] {
  const S = SURFACE_SPLASH, out: SplashLedge[] = [];
  if (site.parapetY - site.y > 0.2) for (const e of site.edges) {
    const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    if (L < 0.4) continue;
    const ux = (e.x1 - e.x0) / L, uz = (e.z1 - e.z0) / L;
    out.push(...tiles({x: (e.x0 + e.x1) / 2 + (e.nx * parapetT) / 2, z: (e.z0 + e.z1) / 2 + (e.nz * parapetT) / 2, yaw: Math.atan2(-uz, ux), hw: L / 2 - 0.05, hd: parapetT / 2 - 0.03, y: site.parapetY}, 'parapet', S.ledgeTile));
  }
  for (const q of plant?.parts ?? []) if (q.kind === 'pier') out.push({x: q.x, z: q.z, yaw: q.yaw, hw: q.hw - 0.03, hd: q.hd - 0.03, y: q.y1, kind: 'pier'});
  for (const t of plant?.towers ?? []) {
    const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    const inStack = (x: number, z: number) => { const X = x - t.x, Z = z - t.z; return Math.abs(X * c - Z * s) < t.hw - 0.2 && Math.abs(X * s + Z * c) < t.hd - 0.2; };
    out.push(...tiles({x: t.x, z: t.z, yaw: t.yaw, hw: t.plinth.hw - 0.05, hd: t.plinth.hd - 0.05, y: t.y + t.plinth.h}, 'plinth', S.ledgeTile, (x, z) => !inStack(x, z)));
  }
  return out;
}

/** The ledges as an RGBA32F texture (width = count, 2 rows): (x, z, cos yaw, sin yaw), (hw, hd, y, 0). textureLoad only. */
export function ledgeTexture(ledges: readonly SplashLedge[]): THREE.DataTexture {
  const w = Math.max(1, ledges.length), d = new Float32Array(w * 2 * 4);
  ledges.forEach((l, i) => {
    d.set([l.x, l.z, Math.cos(l.yaw), Math.sin(l.yaw)], i * 4);
    d.set([l.hw, l.hd, l.y, 0], (w + i) * 4);
  });
  const t = new THREE.DataTexture(d, w, 2, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'reactor-surface-splash-ledges';
  return t;
}

/** The slot batch: per slot one ring quad (part 0) + `sparks` droplet quads; position = (seed 0, seed 1, kind), splashAux = (part, corner x, corner y, part seed). */
export function splashGeometry(slots: {near: number; far: number; ledge: number}, seed: number): THREE.BufferGeometry {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const parts = 1 + SURFACE_SPLASH.sparks, total = slots.near + slots.far + slots.ledge, quads = total * parts;
  const pos = new Float32Array(quads * 12), aux = new Float32Array(quads * 16), idx = new Uint32Array(quads * 6);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  let q = 0;
  for (let k = 0; k < total; k++) {
    const kind = k < slots.near ? SPLASH_KIND.near : k < slots.near + slots.far ? SPLASH_KIND.far : SPLASH_KIND.ledge;
    const s0 = rnd(), s1 = rnd();
    for (let p = 0; p < parts; p++, q++) {
      const ps = rnd();
      for (let c = 0; c < 4; c++) {
        const v = q * 4 + c;
        pos.set([s0, s1, kind], v * 3);
        aux.set([p, corners[c][0], corners[c][1], ps], v * 4);
      }
      const v = q * 4, o = q * 6;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], o);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('splashAux', new THREE.BufferAttribute(aux, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // (placed in the vertex shader round the eye: an honest huge bound, never frustum-culled)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

/** Per-layer uniforms (the runtime writes eye / t / on / px / beam each frame while drawn). */
export interface SplashUniforms {
  eye: {value: THREE.Vector3}; t: {value: number}; on: {value: number}; px: {value: number};
  /** The aperture's cut (x, z, radius: the railing ring + holePad, unused). */
  hole: {value: THREE.Vector4};
  /** Open ground: a floor texel within [x, y] (the city ground - tol .. the deck + tol). */
  band: {value: THREE.Vector2};
  /** The beam (x, z, on, unused). */
  beam: {value: THREE.Vector4};
}

function splashUniforms(): SplashUniforms {
  return {
    eye: uniform(new THREE.Vector3()), t: uniform(0), on: uniform(0), px: uniform(0.0014), hole: uniform(new THREE.Vector4(0, 0, 0, 0)),
    band: uniform(new THREE.Vector2(0, 0)), beam: uniform(new THREE.Vector4(0, 0, 0, 0)),
  } as unknown as SplashUniforms;
}

/** World-space wrap of v into [lo, lo + size) (floor-based, as surfaceRain.ts). */
const wrap = (v: N, lo: N, size: N): N => n(v).sub(lo).sub(n(size).mul(floor(n(v).sub(lo).div(size)))).add(lo);
const H = (k: N, o: readonly [number, number, number]): N => n(wmHash(n(k).add(vec3(o[0], o[1], o[2]))));
/** The per-cycle hash offsets (shared with the CPU mirror). */
const HO = {a: [0, 0, 0], b: [3.7, 19.1, 5.3], c: [11.3, 2.9, 23.7], d: [29.1, 13.3, 7.9], e: [5.9, 31.7, 17.1]} as const;
const SPARK_HO = (p: number, k: 0 | 1): [number, number, number] => [7.3 * p + 1.1 + k * 13.7, 3.1 * p + k * 5.9, 2.3 * p + 9.7];

function splashMaterial(u: SplashUniforms, floorTex: THREE.DataTexture, m: RainFloorMap, ledgeTex: THREE.DataTexture, ledges: number): MeshBasicNodeMaterial {
  const S = SURFACE_SPLASH;
  const mat = new MeshBasicNodeMaterial({name: 'reactor-surface-splash', transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending});
  mat.forceSinglePass = true; // one draw
  const seedP = n(attribute('position', 'vec3')), aux = n(attribute('splashAux', 'vec4'));
  const s0 = n(seedP.x), s1 = n(seedP.y), kind = n(seedP.z);
  const isLedge = n(kind.greaterThan(1.5)), isFar = n(kind.greaterThan(0.5).and(kind.lessThan(1.5)));
  // --- the slot's cycle: which firing (cyc) and how far into it (tau, s) ---
  const P = n(float(S.life).add(mix(float(S.rest[0]), float(S.rest[1]), s0)));
  const uu = n(n(u.t).div(P).add(s1));
  const cyc = n(floor(uu)), tau = n(fract(uu).mul(P)).toVar('spTau');
  const key = n(vec3(cyc, s0.mul(113).add(kind.mul(7)), s1.mul(71))).toVar('spKey');
  const hA = H(key, HO.a), hB = H(key, HO.b), hC = H(key, HO.c), hD = H(key, HO.d), hE = H(key, HO.e);
  // --- where: a world-anchored point in the box round the eye (ground), or a point on a ledge ---
  const eye = n(u.eye), half = n(isFar.select(float(S.far), float(S.near))), B = n(half.mul(2));
  const gx = n(wrap(n(hA).mul(B).add(s0.mul(997)), n(eye.x).sub(half), B)), gz = n(wrap(n(hB).mul(B).add(s1.mul(997)), n(eye.z).sub(half), B));
  const li = n(clamp(floor(n(hA).mul(ledges)), 0, Math.max(0, ledges - 1)));
  const L0 = n(texture(ledgeTex).load(ivec2(int(li), int(0)))), L1 = n(texture(ledgeTex).load(ivec2(int(li), int(1))));
  const lx = n(n(hB).mul(2).sub(1).mul(L1.x)), lz = n(n(hC).mul(2).sub(1).mul(L1.y));
  const ledgeX = n(n(L0.x).add(lx.mul(L0.z)).add(lz.mul(L0.w))), ledgeZ = n(n(L0.y).sub(lx.mul(L0.w)).add(lz.mul(L0.z)));
  const px0 = n(isLedge.select(ledgeX, gx)).toVar('spX'), pz0 = n(isLedge.select(ledgeZ, gz)).toVar('spZ');
  // --- the rain floor there (nearest texel) and the validity of the landing ---
  const fx = n(floor(n(px0).sub(m.x0).div(m.cell))), fz = n(floor(n(pz0).sub(m.z0).div(m.cell)));
  const inMap = n(fx.greaterThanEqual(1).and(fx.lessThanEqual(m.w - 2)).and(fz.greaterThanEqual(1)).and(fz.lessThanEqual(m.h - 2)));
  const floorY = n(texture(floorTex).load(ivec2(int(clamp(fx, 0, m.w - 1)), int(clamp(fz, 0, m.h - 1))))).r;
  const holeD = n(length(vec2(px0, pz0).sub(n(u.hole).xy)));
  const groundOk = n(floorY.greaterThanEqual(n(u.band).x).and(floorY.lessThanEqual(n(u.band).y)).and(holeD.greaterThan(n(u.hole).z)));
  const ledgeOk = n(floorY.lessThanEqual(n(L1.z).add(0.05)).and(float(ledges).greaterThan(0.5)));
  const valid = n(inMap.and(isLedge.select(ledgeOk, groundOk)));
  const y0 = n(isLedge.select(n(L1.z).add(S.ledgeLift), floorY.add(S.lift))).toVar('spY');
  // --- gates: fired this cycle (under the rain), alive (inside its life), faded toward its box's edge ---
  const dh = n(length(vec2(px0, pz0).sub(vec2(eye.x, eye.z))));
  const reachR = n(isLedge.select(float(S.ledgeR), half));
  const fade = n(float(1).sub(smoothstep(reachR.mul(0.6), reachR, dh)));
  const fired = n(n(hD).lessThan(u.on).and(valid).and(tau.lessThan(S.life)));
  const vis = n(fired.select(fade, float(0))).toVar('spVis');
  // --- the part: the ring (flat, expanding) or a crown droplet (ballistic, camera-facing) ---
  const part = n(aux.x), cxy = n(vec2(aux.y, aux.z)), ps = n(aux.w);
  const isRing = n(part.lessThan(0.5));
  const base = n(vec3(px0, y0, pz0));
  const dist = n(max(length(base.sub(eye)), 0.05)).toVar('spDist');
  // ring: radius eases out to its max; the line widened with distance / the grazing view (energy kept), faded far off
  const tr = n(clamp(tau.div(S.life), 0, 1));
  const rMax = n(mix(float(S.ringR[0]), float(S.ringR[1]), hE));
  const rr = n(rMax.mul(float(1).sub(float(1).sub(tr).mul(float(1).sub(tr)))));
  const sinE = n(max(abs(n(eye.y).sub(y0)).div(dist), 0.1));
  const wEff = n(max(float(S.ringW), dist.mul(u.px).mul(1.2).div(sinE))).toVar('spW');
  const Q = n(rMax.add(wEff.mul(1.5)));
  const ringA = n(vis.mul(float(S.ringW).div(wEff)).mul(float(1).sub(smoothstep(S.ringFade[0], S.ringFade[1], dist))));
  // droplet: launched from the impact (an angle per droplet round the crown), up and out, falling back; >= 1 px (energy kept)
  const ang = n(part.sub(1).add(0.25).add(ps.mul(0.5)).div(S.sparks).mul(Math.PI * 2).add(n(hA).mul(Math.PI * 2)));
  const vOut = n(mix(float(S.sparkOut[0]), float(S.sparkOut[1]), H(key, SPARK_HO(1, 0)).mul(0.5).add(ps.mul(0.5))));
  const vUp = n(mix(float(S.sparkUp[0]), float(S.sparkUp[1]), H(key, SPARK_HO(1, 1)).mul(0.5).add(fract(ps.mul(7.31)).mul(0.5))));
  const ts = tau;
  const hv = n(vUp.mul(ts).sub(ts.mul(ts).mul(S.gravity * 0.5)));
  const sparkLive = n(ts.lessThan(S.crownS).and(hv.greaterThan(-0.002)));
  const sp = n(base.add(vec3(n(cos(ang)).mul(vOut).mul(ts), n(max(hv, 0)), n(sin(ang)).mul(vOut).mul(ts)))).toVar('spP');
  const sDist = n(max(length(sp.sub(eye)), 0.05));
  const size = n(max(float(S.sparkSize), sDist.mul(u.px).mul(0.9)));
  const sparkA = n(vis.mul(sparkLive.select(float(1), float(0))).mul(pow(float(S.sparkSize).div(size), 2)).mul(sqrt(max(float(1).sub(ts.div(S.crownS)), 0))));
  const toE = n(normalize(eye.sub(sp)));
  const right = n(normalize(cross(vec3(0, 1, 0), toE).add(vec3(1e-4, 0, 0))));
  const upv = n(cross(toE, right));
  const a = n(isRing.select(ringA, sparkA)).toVar('spA');
  // a dead part collapses to a zero-area quad at its centre (no fragments)
  const live = n(a.greaterThan(0.001).select(float(1), float(0)));
  const ringP = n(base.add(vec3(n(cxy.x).mul(Q), 0, n(cxy.y).mul(Q)).mul(live)));
  const sparkP = n(sp.add(n(right).mul(n(cxy.x).mul(size).mul(live))).add(n(upv).mul(n(cxy.y).mul(size).mul(live))));
  mat.positionNode = isRing.select(ringP, sparkP);
  // --- the look ---
  const vKind = n(varying(isRing.select(float(0), float(1)), 'vSpKind'));
  const vLocal = n(varying(isRing.select(cxy.mul(Q), cxy), 'vSpLocal'));
  const vRing = n(varying(vec3(rr, wEff, tr), 'vSpRing'));
  const vA = n(varying(a, 'vSpA'));
  const bd = n(length(vec2(px0, pz0).sub(n(u.beam).xy)));
  const vBeam = n(varying(n(u.beam).z.mul(float(1).div(float(1).add(bd.div(S.beamR).mul(bd.div(S.beamR))))), 'vSpBeam'));
  mat.colorNode = Fn(() => vec4(n(vec3(S.colour[0], S.colour[1], S.colour[2])).add(n(vec3(0.32, 0.6, 1)).mul(vBeam).mul(S.beamGain)), 1))();
  mat.opacityNode = Fn(() => {
    const d = n(length(vLocal));
    // the ring line (fading as it spreads) + the bright dimple of the impact's first instant; a droplet: a soft dot
    const line = n(float(1).sub(smoothstep(0, n(vRing).y, abs(d.sub(n(vRing).x))))).mul(pow(float(1).sub(n(vRing).z), 1.5));
    const dimple = n(float(1).sub(smoothstep(0, max(n(vRing).x.mul(0.6), 0.02), d))).mul(float(1).sub(smoothstep(0, 0.25, n(vRing).z))).mul(0.6);
    const ring = n(min(line.add(dimple), 1)).mul(S.ringAlpha);
    const dot = n(float(1).sub(smoothstep(0.35, 1, d))).mul(S.sparkAlpha);
    return n(vKind.lessThan(0.5).select(ring, dot)).mul(vA);
  })();
  return mat;
}

export interface SplashStats { slots: number; quads: number; triangles: number; ledges: number; visible: boolean }

/** The splash layer: ONE mesh (one draw) of a fixed slot batch round the eye. */
export class SplashLayer {
  readonly u = splashUniforms();
  readonly mesh: THREE.Mesh;
  readonly ledgeTex: THREE.DataTexture;
  readonly slots: number;
  private clock = 0;

  constructor(readonly name: string, floorTex: THREE.DataTexture, readonly floor: RainFloorMap, site: SurfaceSite, readonly ledges: readonly SplashLedge[], seed: number) {
    const S = SURFACE_SPLASH;
    this.slots = S.slots.near + S.slots.far + S.slots.ledge;
    this.ledgeTex = ledgeTexture(ledges);
    this.mesh = new THREE.Mesh(splashGeometry(S.slots, seed), splashMaterial(this.u, floorTex, floor, this.ledgeTex, ledges.length));
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3; // over the wet film (1), before the falling streaks (4)
    this.mesh.visible = false;
    this.u.hole.value.set(site.hole.x, site.hole.z, splashHoleR(site), 0);
    this.u.band.value.set(floor.low - S.tol, floor.ground + S.tol);
  }

  /** Per frame while drawn: the clock (s), the eye, the rain 0..1, the camera's pixel angle, the beam's brightness. */
  tick(dt: number, eye: THREE.Vector3, rain: number, px: number, beam: number): void {
    this.clock = (this.clock + dt) % SURFACE_SPLASH.period;
    this.u.t.value = this.clock;
    this.u.eye.value.copy(eye);
    this.u.on.value = rain;
    this.u.px.value = px;
    this.u.beam.value.z = beam;
  }

  stats(): SplashStats {
    const quads = this.slots * (1 + SURFACE_SPLASH.sparks);
    return {slots: this.slots, quads, triangles: quads * 2, ledges: this.ledges.length, visible: this.mesh.visible};
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.ledgeTex.dispose();
  }
}

/** The aperture's cut for splashes: beyond the opening's disc and the railing ring round it. */
export const splashHoleR = (site: Pick<SurfaceSite, 'hole'>): number => Math.max(site.hole.r, site.hole.ringR1) + SURFACE_SPLASH.holePad;

// ---------------------------------------------------------------------------------------------------------------------------
// CPU mirror (tests / QA): the shader's placement and gates for one slot at clock t

/** One slot's state at clock t seen from `eye` with rain `on` (the shader's math; float64 here). */
export interface SplashCpu { fired: boolean; vis: number; x: number; y: number; z: number; tau: number; kind: number; ledge: number; floorY: number }

const fr = (v: number) => v - Math.floor(v);
const wrapJs = (v: number, lo: number, size: number) => v - lo - size * Math.floor((v - lo) / size) + lo;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The CPU mirror of the vertex shader's slot placement (ring part). `slot`: (s0, s1, kind) as the geometry's position attribute. */
export function splashAt(slot: readonly [number, number, number], t: number, eye: {x: number; y: number; z: number}, on: number, m: RainFloorMap, ledges: readonly SplashLedge[], holeR: {x: number; z: number; r: number}): SplashCpu {
  const S = SURFACE_SPLASH, [s0, s1, kind] = slot;
  const P = S.life + S.rest[0] + (S.rest[1] - S.rest[0]) * s0, uu = t / P + s1, cyc = Math.floor(uu), tau = fr(uu) * P;
  const key = [cyc, s0 * 113 + kind * 7, s1 * 71];
  const h = (o: readonly [number, number, number]) => wmHashCpu(key[0] + o[0], key[1] + o[1], key[2] + o[2]);
  const hA = h(HO.a), hB = h(HO.b), hC = h(HO.c), hD = h(HO.d);
  const isLedge = kind > 1.5, half = kind > 0.5 && kind < 1.5 ? S.far : S.near, B = half * 2;
  let x = wrapJs(hA * B + s0 * 997, eye.x - half, B), z = wrapJs(hB * B + s1 * 997, eye.z - half, B), li = -1, ly = 0;
  if (isLedge) {
    li = Math.min(Math.max(0, ledges.length - 1), Math.max(0, Math.floor(hA * ledges.length)));
    const L = ledges[li];
    if (L) {
      const c = Math.cos(L.yaw), s = Math.sin(L.yaw), lx = (hB * 2 - 1) * L.hw, lz = (hC * 2 - 1) * L.hd;
      x = L.x + lx * c + lz * s; z = L.z - lx * s + lz * c; ly = L.y;
    }
  }
  const fx = Math.floor((x - m.x0) / m.cell), fz = Math.floor((z - m.z0) / m.cell);
  const inMap = fx >= 1 && fx <= m.w - 2 && fz >= 1 && fz <= m.h - 2;
  const floorY = m.data[Math.min(m.h - 1, Math.max(0, fz)) * m.w + Math.min(m.w - 1, Math.max(0, fx))];
  const groundOk = floorY >= m.low - S.tol && floorY <= m.ground + S.tol && Math.hypot(x - holeR.x, z - holeR.z) > holeR.r;
  const ledgeOk = ledges.length > 0 && floorY <= ly + 0.05;
  const valid = inMap && (isLedge ? ledgeOk : groundOk);
  const y = isLedge ? ly + S.ledgeLift : floorY + S.lift;
  const reach = isLedge ? S.ledgeR : half, dh = Math.hypot(x - eye.x, z - eye.z);
  const fired = hD < on && valid && tau < S.life;
  return {fired, vis: fired ? 1 - sstep(reach * 0.6, reach, dh) : 0, x, y, z, tau, kind, ledge: li, floorY};
}

/** The geometry's slot seeds (s0, s1, kind) per slot (the CPU mirror's inputs: one per slot, read from the ring quads). */
export function splashSlots(g: THREE.BufferGeometry): [number, number, number][] {
  const p = g.getAttribute('position'), parts = 1 + SURFACE_SPLASH.sparks, out: [number, number, number][] = [];
  for (let v = 0; v < p.count; v += 4 * parts) out.push([p.getX(v), p.getY(v), p.getZ(v)]);
  return out;
}
