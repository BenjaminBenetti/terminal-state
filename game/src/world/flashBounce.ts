// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane BOUNCE): the LIVE FLASHLIGHT BOUNCE — the light the flashlight's beam
// sends back off the surface it lands on, every frame, on the GPU.
//
// Most of a base Subway station is dark and lit by the flashlight alone, so the baked light field changes nothing there. With this the
// beam lights its surroundings softly with the colour of what it falls on: a red tile wall throws warm light on the floor and ceiling
// near it, a white wall fills a dark room.
//  - CPU, each frame (FlashBounce.update): the beam's axis and a ring of rays inside its cone are cast over the station's FIXED
//    ARCHITECTURE (world/lightScene.ts BandScene, exact and allocation-free). Where a ray lands stands a VIRTUAL LIGHT: a small Lambert
//    emitter on the surface with the surface's colour (world/surfaceAlbedo.ts: the finish the builder drew there, read exactly as the
//    enhanced bake's gather reads it) and the flux the game's own spot light puts on that part of the surface. Position, normal and
//    colour are smoothed in time (exponential, frame-rate independent); a ray that lands nowhere fades its light out.
//  - GPU, per fragment (flashBounceIrradiance): the sum of the FLASH_VPLS emitters as irradiance, in the light field's convention
//    (three shows a Lambert surface as albedo x E / pi): pure arithmetic on plain render-group uniforms — no texture, no array, no
//    uniform buffer of its own (the fog march's fragment stage is at WebGPU's 12 uniform buffers; every uniformArray would be one more).
//  - sampleFlashBounce is the CPU mirror of that sum.
//
// Flux. The cone is cut into FLASH_VPLS parts of EQUAL FLUX: a cap round the axis (the axis ray) and FLASH_VPLS - 1 sectors of the
// annulus round it (the ring rays, at the angle that halves the annulus's flux). Each ray so stands for the solid angle
//   w = OMEGA / FLASH_VPLS,   OMEGA = integral of three's cone profile over the sphere = 2 pi (1 - (cos a + cos(a (1 - penumbra))) / 2)
// (exact: the profile is a smoothstep in the cosine). Landing at distance d on a surface tilted by t, its footprint has the area
// d^2 w / cos t and the game draws the irradiance I atten(d) cos t on it, so a surface of albedo rho sends back the flux
//   phi = rho * I * atten(d) * d^2 * w            (the tilt cancels)
// With a physical falloff (decay 2, no cutoff: atten = 1 / d^2) that is rho * I * w, and the lights together carry rho x the beam's
// flux I * OMEGA whatever the distance. With the game's own falloff (decay 1.2, a 30 m cutoff window) it is rho * I * w * d^0.8 *
// window(d): the patch is exactly as bright as the game draws it, and so is what it sends back.
// A Lambert patch of flux phi has the radiant intensity phi / pi along its normal, so a point p with normal n receives
//   E(p, n) = gain * sum_i  J_i * max(0, n.L_i) * max(0, -L_i.n_i) / (r_i^2 + r0^2) * window(r_i),   J_i = phi_i / pi
// (L_i: unit direction from p to light i, r_i its distance; r0: the patch is not a point; window = saturate(1 - (r / range)^4)^2).
//
// LIMITS (by design, both stated to the player-facing docs by the lead):
//  1. The beam passes through everything that is not fixed architecture: glass, props, door leaves, characters, the train. Its virtual
//     lights stand on the wall, floor or ceiling BEHIND such a thing (the ray scene holds nothing movable).
//  2. Virtual lights cast NO SHADOWS: their light is not stopped by walls, slabs or props between them and a surface. Only the
//     emitter's own normal term cuts: nothing reaches the back of the lit surface or the surface's own plane; the range window and
//     the distance do the rest.
// Not wired here: the lead adds flashBounceIrradiance to the enhanced light node and calls update from the game.
// Deterministic: no random number, no clock (the caller's dt only), nothing of the save / layout is read or written.

import * as THREE from 'three';
import type {Node} from 'three/webgpu';
import {clamp, dot, float, max, renderGroup, uniform} from 'three/tsl';
import {HIT_CEIL, HIT_FLOOR, type BandScene} from './lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, type SurfaceAlbedo} from './surfaceAlbedo';

/** Virtual lights (= rays: the beam axis + a ring of FLASH_VPLS - 1). */
export const FLASH_VPLS = 6;
/** Time constant (s) of the smoothing of a light's position, normal and colour. */
export const FLASH_BOUNCE_TAU = 0.07;
/** A virtual light stands this far (m) off its surface, along the normal. */
export const FLASH_BOUNCE_LIFT = 0.05;
/** A light dimmer than this share of what it is about to be appears at its new place at once (nothing visible moves). */
export const FLASH_BOUNCE_REVIVE = 0.1;
/** Ray length (m) for a spot light without a cutoff distance. */
export const FLASH_BOUNCE_REACH = 60;
/**
 * FB.params at start: gain, r0 (m: the size of a patch), range (m: where a light's reach ends). A gain of 1 is one physical bounce;
 * the game draws it stronger, like the baked bounce (world/lightFieldGather.ts GATHER_GAIN): a stylised choice, on real finishes
 * (concrete ~0.15, floors ~0.26) one physical bounce of a hand lamp is hardly seen.
 */
export const FLASH_BOUNCE_DEFAULTS = {gain: 2, r0: 0.5, range: 11} as const;

/** What the bounce is cast over: a station's ray scene and its surface colours (world/enhancedLightingRuntime.ts builds both). */
export interface FlashBounceSource { scene: BandScene; albedo: SurfaceAlbedo }

/** One virtual light. */
export interface FlashVpl {
  /** World position: where the ray landed, FLASH_BOUNCE_LIFT off the surface. */
  x: number; y: number; z: number;
  /** The surface's unit normal (into the free space). */
  nx: number; ny: number; nz: number;
  /** Radiant intensity along the normal, linear rgb: the flux the patch sends back / pi. */
  r: number; g: number; b: number;
}

export interface FlashBounceDebug {
  /** A station is bound; the light was on at the last update. */
  bound: boolean; lit: boolean;
  /** Rays that landed at the last update (of FLASH_VPLS). */
  hits: number;
  /** Where the rays started: the light, its parent (the light itself sat inside the architecture), or nowhere in free space. */
  origin: 'light' | 'parent' | 'none';
  /** The cone as sampled: its profile-weighted solid angle (sr; the beam's flux = intensity x it), one ray's share, the ring's angle off the axis (rad). */
  solidAngle: number; weight: number; ringAngle: number;
  /** The flux the lights carry now (linear rgb; pi x the sum of their radiant intensities). */
  flux: [number, number, number];
  /** update() calls so far. */
  updates: number;
}

const vec4s = (name: string) => Array.from({length: FLASH_VPLS}, (_, i) => uniform(new THREE.Vector4(0, 0, 0, 0)).setGroup(renderGroup).setName(`${name}${i}`));

/**
 * The global nodes of the bounce: plain render-group uniforms only (they live in the buffer every lit material already binds).
 * Per light i: pos[i].xyz world position, nrm[i].xyz unit normal, col[i].rgb radiant intensity (linear); every w is 0.
 * params: x = gain, y = r0 (m), z = range (m), w unused — tune here, the shader and sampleFlashBounce read it.
 */
export const FB = {
  pos: vec4s('fbPos'),
  nrm: vec4s('fbNrm'),
  col: vec4s('fbCol'),
  params: uniform(new THREE.Vector4(FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.r0, FLASH_BOUNCE_DEFAULTS.range, 0)).setGroup(renderGroup).setName('fbParams'),
};

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
const coneCosines = (angle: number, penumbra: number): [number, number] => {
  const a = Math.min(Math.PI / 2, Math.max(0, angle)), p = clamp01(penumbra);
  return [Math.cos(a), Math.cos(a * (1 - p))];
};

/** three r186 SpotLightNode's cone factor at the cosine of the angle off the axis: smoothstep(cos(angle), cos(angle (1 - penumbra)), cos). */
export function spotConeAttenuation(cosTheta: number, angle: number, penumbra: number): number {
  const [c0, c1] = coneCosines(angle, penumbra);
  if (c1 - c0 < 1e-12) return cosTheta > c0 ? 1 : 0;
  const t = clamp01((cosTheta - c0) / (c1 - c0));
  return t * t * (3 - 2 * t);
}

/** three r186 getDistanceAttenuation: 1 / max(d^decay, 0.01), times saturate(1 - (d / distance)^4)^2 when the light has a cutoff. */
export function spotDistanceAttenuation(d: number, distance: number, decay: number): number {
  const fall = 1 / Math.max(Math.pow(d, decay), 0.01);
  if (!(distance > 0)) return fall;
  const q = d / distance, q2 = q * q, w = clamp01(1 - q2 * q2);
  return fall * w * w;
}

/** The integral of the cone factor over the sphere (sr): a spot light's flux is its intensity times this. */
export function spotConeSolidAngle(angle: number, penumbra: number): number {
  const [c0, c1] = coneCosines(angle, penumbra);
  return 2 * Math.PI * (1 - (c0 + c1) / 2);
}

// state per light: position, raw (unnormalised) normal, transfer (what it sends back per unit of the light's intensity, rgb / pi)
const STRIDE = 9;

export class FlashBounce {
  /** The virtual lights as last uploaded (FB holds the same numbers as floats). */
  readonly vpls: readonly FlashVpl[];
  private readonly out: FlashVpl[];
  private src: FlashBounceSource | null = null;
  private readonly state = new Float64Array(FLASH_VPLS * STRIDE);
  /** The light was on at the last update (off -> on: every light appears at its place at once). */
  private lit = false;
  // the cone as sampled, for the angle / penumbra it was made for: per ray the direction's part along the axis and along the two
  // axes across it; one ray's solid angle
  private coneAngle = NaN;
  private conePenumbra = NaN;
  private readonly cone = new Float64Array(FLASH_VPLS * 3);
  private weight = 0;
  private hits = 0;
  private origin = 2;
  private updates = 0;

  constructor() {
    this.out = Array.from({length: FLASH_VPLS}, () => ({x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, r: 0, g: 0, b: 0}));
    this.vpls = this.out;
    this.zero();
  }

  /** The station the beam is cast over (null: none — a station swap, the transit gap, plain shading: everything is zero). */
  bind(src: FlashBounceSource | null): void {
    this.src = src;
    this.zero();
  }

  /**
   * Every frame, after the player light moved: `dt` seconds since the last call; `spot` is read as three shades it (its world
   * position, its target's, intensity — 0 = off —, colour, angle, penumbra, distance, decay). Allocation-free.
   */
  update(dt: number, spot: THREE.SpotLight): void {
    this.updates++;
    const src = this.src, intensity = spot.intensity;
    if (!src || !(intensity > 0) || !spot.visible) { this.zero(); return; }
    spot.updateWorldMatrix(true, false);
    spot.target.updateWorldMatrix(true, false);
    const m = spot.matrixWorld.elements, tm = spot.target.matrixWorld.elements;
    const lx = m[12], ly = m[13], lz = m[14];
    let ax = tm[12] - lx, ay = tm[13] - ly, az = tm[14] - lz;
    const al = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(al > 1e-9)) { this.zero(); return; }
    ax /= al; ay /= al; az /= al;
    // two axes across the beam: from the light's own world x (the camera's right for the game's light: it turns smoothly however
    // the player looks, also straight up or down); its y when the beam runs along that
    let ux = m[0], uy = m[1], uz = m[2];
    let k = ax * ux + ay * uy + az * uz;
    ux -= ax * k; uy -= ay * k; uz -= az * k;
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (!(ul > 1e-4 * Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]))) {
      ux = m[4]; uy = m[5]; uz = m[6];
      k = ax * ux + ay * uy + az * uz;
      ux -= ax * k; uy -= ay * k; uz -= az * k;
      ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (!(ul > 0)) { this.zero(); return; }
    }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    if (spot.angle !== this.coneAngle || spot.penumbra !== this.conePenumbra) this.sampleCone(spot.angle, spot.penumbra);

    // the rays start at the light; when that sits inside the architecture (the game's is a hand's width beside the eye), at its parent
    const scene = src.scene, slots = src.albedo.slots;
    let ox = lx, oy = ly, oz = lz, origin = 0;
    if (scene.bandAtPoint(ox, oy, oz) < 0) {
      origin = 2;
      const pm = spot.parent ? spot.parent.matrixWorld.elements : null;
      if (pm && scene.bandAtPoint(pm[12], pm[13], pm[14]) >= 0) { ox = pm[12]; oy = pm[13]; oz = pm[14]; origin = 1; }
    }
    this.origin = origin;
    const cutoff = spot.distance, decay = spot.decay, reach = cutoff > 0 ? cutoff : FLASH_BOUNCE_REACH;
    const share = this.weight / Math.PI;
    const a = dt > 0 ? 1 - Math.exp(-dt / FLASH_BOUNCE_TAU) : 0, snap = !this.lit;
    const ir = spot.color.r * intensity, ig = spot.color.g * intensity, ib = spot.color.b * intensity;
    const st = this.state, cone = this.cone, out = this.out;
    let hits = 0;
    for (let i = 0; i < FLASH_VPLS; i++) {
      const o = i * STRIDE, ca = cone[i * 3], cu = cone[i * 3 + 1], cv = cone[i * 3 + 2];
      const dx = ax * ca + ux * cu + vx * cv, dy = ay * ca + uy * cu + vy * cv, dz = az * ca + uz * cu + vz * cv;
      let nx = 0, ny = 0, nz = 0;
      const hit = origin !== 2 && scene.trace(ox, oy, oz, dx, dy, dz, reach);
      if (hit) {
        hits++;
        const t = scene.hitT, kind = scene.hitKind;
        let off = ALB_WALL;
        if (kind === HIT_FLOOR) { ny = 1; off = ALB_FLOOR; } else if (kind === HIT_CEIL) { ny = -1; off = ALB_CEIL; } else { nx = scene.hitNx; nz = scene.hitNz; }
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        // the surface's colour, as the enhanced bake's gather reads it: the level slot of the hit band, the hit column, the hit kind
        const A = slots[scene.slot[scene.hitBand]], a0 = scene.hitCol * ALBEDO_STRIDE + off;
        // what the game's light puts on the ray's part of the surface: three's own falloff at the distance from the light
        const ex = hx - lx, ey = hy - ly, ez = hz - lz, d2 = ex * ex + ey * ey + ez * ez, d = Math.sqrt(d2);
        let g = d2 / Math.max(Math.pow(d, decay), 0.01);
        if (cutoff > 0) { const q = d / cutoff, q2 = q * q, w = clamp01(1 - q2 * q2); g *= w * w; }
        g *= share;
        const tr = A ? ALBEDO_LUT[A[a0]] * g : 0, tg = A ? ALBEDO_LUT[A[a0 + 1]] * g : 0, tb = A ? ALBEDO_LUT[A[a0 + 2]] * g : 0;
        const px = hx + nx * FLASH_BOUNCE_LIFT, py = hy + ny * FLASH_BOUNCE_LIFT, pz = hz + nz * FLASH_BOUNCE_LIFT;
        if (snap || st[o + 6] + st[o + 7] + st[o + 8] <= FLASH_BOUNCE_REVIVE * (tr + tg + tb)) {
          // it was off, or as good as: it stands at its place at once (and fades in there, unless the whole light just came on)
          st[o] = px; st[o + 1] = py; st[o + 2] = pz; st[o + 3] = nx; st[o + 4] = ny; st[o + 5] = nz;
          if (snap) { st[o + 6] = tr; st[o + 7] = tg; st[o + 8] = tb; }
        } else {
          st[o] += (px - st[o]) * a; st[o + 1] += (py - st[o + 1]) * a; st[o + 2] += (pz - st[o + 2]) * a;
          st[o + 3] += (nx - st[o + 3]) * a; st[o + 4] += (ny - st[o + 4]) * a; st[o + 5] += (nz - st[o + 5]) * a;
        }
        if (!snap) { st[o + 6] += (tr - st[o + 6]) * a; st[o + 7] += (tg - st[o + 7]) * a; st[o + 8] += (tb - st[o + 8]) * a; }
      } else if (snap) {
        st[o + 6] = st[o + 7] = st[o + 8] = 0;
      } else {
        // the ray lands nowhere: its light fades out where it stood
        st[o + 6] -= st[o + 6] * a; st[o + 7] -= st[o + 7] * a; st[o + 8] -= st[o + 8] * a;
        if (st[o + 6] + st[o + 7] + st[o + 8] < 1e-9) st[o + 6] = st[o + 7] = st[o + 8] = 0;
      }
      // the normal as shown: unit (between two surfaces it turns from one to the other)
      let sx = st[o + 3], sy = st[o + 4], sz = st[o + 5];
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl > 1e-6) { sx /= sl; sy /= sl; sz /= sl; } else if (hit) { sx = nx; sy = ny; sz = nz; } else { sx = 0; sy = 1; sz = 0; }
      const v = out[i];
      v.x = st[o]; v.y = st[o + 1]; v.z = st[o + 2];
      v.nx = sx; v.ny = sy; v.nz = sz;
      v.r = st[o + 6] * ir; v.g = st[o + 7] * ig; v.b = st[o + 8] * ib;
      FB.pos[i].value.set(v.x, v.y, v.z, 0);
      FB.nrm[i].value.set(sx, sy, sz, 0);
      FB.col[i].value.set(v.r, v.g, v.b, 0);
    }
    this.hits = hits;
    this.lit = true;
  }

  /** What the bounce is doing (QA / tests; allocates its answer). */
  debug(): FlashBounceDebug {
    let r = 0, g = 0, b = 0;
    for (const v of this.out) { r += v.r; g += v.g; b += v.b; }
    return {
      bound: this.src !== null, lit: this.lit, hits: this.hits, origin: this.origin === 0 ? 'light' : this.origin === 1 ? 'parent' : 'none',
      solidAngle: this.weight * FLASH_VPLS, weight: this.weight, ringAngle: Math.acos(Math.min(1, this.cone[3] || 1)),
      flux: [r * Math.PI, g * Math.PI, b * Math.PI], updates: this.updates,
    };
  }

  /** Everything zero: the state, the lights and the uniforms (the shader's sum is then exactly zero). */
  private zero(): void {
    this.state.fill(0);
    this.lit = false;
    this.hits = 0;
    this.origin = 2;
    for (let i = 0; i < FLASH_VPLS; i++) {
      const v = this.out[i];
      v.x = v.y = v.z = v.nx = v.ny = v.nz = v.r = v.g = v.b = 0;
      FB.pos[i].value.set(0, 0, 0, 0);
      FB.nrm[i].value.set(0, 0, 0, 0);
      FB.col[i].value.set(0, 0, 0, 0);
    }
  }

  /**
   * The rays of a cone (only when the light's angle or penumbra changed). In the cosine u of the angle off the axis the cone factor
   * s is 1 from cos(angle (1 - penumbra)) = c1 up to 1 and a smoothstep from cos(angle) = c0 to c1, and the solid angle is 2 pi du:
   * the flux beyond u, F(u) = integral of s from u to 1, is 1 - u in the core and (1 - c1) + (c1 - c0)(1/2 - t^3 + t^4 / 2) in
   * the penumbra (t = (u - c0) / (c1 - c0)). The axis ray stands for the cap holding 1 / N of F(c0); the ring rays share the rest
   * and sit where F is the cap plus half of the rest.
   */
  private sampleCone(angle: number, penumbra: number): void {
    this.coneAngle = angle;
    this.conePenumbra = penumbra;
    const [c0, c1] = coneCosines(angle, penumbra);
    const core = 1 - c1, w = c1 - c0, total = core + w / 2;
    const cosAt = (share: number): number => {
      const f = share * total;
      if (f <= core || w < 1e-12) return 1 - f;
      const y = (f - core) / w;
      let lo = 0, hi = 1;
      for (let q = 0; q < 48; q++) { const t = (lo + hi) / 2; if (0.5 - t * t * t + 0.5 * t * t * t * t > y) lo = t; else hi = t; }
      return c0 + (lo + hi) / 2 * w;
    };
    const ring = FLASH_VPLS - 1;
    const cr = cosAt((FLASH_VPLS + 1) / (2 * FLASH_VPLS)), sr = Math.sqrt(Math.max(0, 1 - cr * cr));
    this.weight = 2 * Math.PI * total / FLASH_VPLS;
    const cone = this.cone;
    cone[0] = 1; cone[1] = 0; cone[2] = 0;
    // (the first ring ray points down for the game's light: its second axis across the beam is the camera's down)
    for (let j = 0; j < ring; j++) {
      const phi = Math.PI / 2 + 2 * Math.PI * j / ring;
      cone[(j + 1) * 3] = cr; cone[(j + 1) * 3 + 1] = sr * Math.cos(phi); cone[(j + 1) * 3 + 2] = sr * Math.sin(phi);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The sum: TSL and its CPU mirror

// TSL nodes are chained untyped here (three's TSL typings reject most mixed-type chains).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;

/**
 * The bounce at world point `p` on a surface with unit world normal `normal`: irradiance (vec3), to be added to the lighting
 * context's irradiance beside the light field's. Arithmetic only: FLASH_VPLS x (three dot products, one division). Exactly zero
 * while the lights are zero (flashlight off, nothing bound).
 */
export function flashBounceIrradiance(p: Node, normal: Node): Node {
  const P = n(p), Nw = n(normal), prm = n(FB.params);
  const r0sq = n(prm.y).mul(prm.y);
  const invR2 = float(1).div(max(n(prm.z).mul(prm.z), 1e-6));
  let sum: N = null;
  for (let i = 0; i < FLASH_VPLS; i++) {
    const d = n(n(FB.pos[i]).xyz).sub(P);
    const r2 = max(dot(d, d), 1e-6);
    // n.L * (-L.n_i) / r^2 = (n.d) (-n_i.d) / r^4, d = the light - p (so one r^2 joins the falloff's)
    const cr = max(dot(Nw, d), 0), ce = max(n(dot(n(FB.nrm[i]).xyz, d)).negate(), 0);
    const q = n(r2).mul(invR2);
    const w = clamp(float(1).sub(n(q).mul(q)), 0, 1);
    const term = n(n(FB.col[i]).xyz).mul(n(cr).mul(ce).mul(w).mul(w).div(n(r2).mul(n(r2).add(r0sq))));
    sum = sum ? sum.add(term) : term;
  }
  return n(sum).mul(prm.x);
}

/**
 * CPU mirror of flashBounceIrradiance: the irradiance (linear rgb, into `out`) the lights `vpls` give world point `p` on a surface
 * with unit normal `n`. `params` = FB.params' value (x gain, y r0, z range) unless given.
 */
export function sampleFlashBounce<T extends {[i: number]: number}>(
  vpls: readonly FlashVpl[], p: ArrayLike<number>, n: ArrayLike<number>, out: T, params: {x: number; y: number; z: number} = FB.params.value,
): T {
  const r0sq = params.y * params.y, invR2 = 1 / Math.max(params.z * params.z, 1e-6);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < vpls.length; i++) {
    const v = vpls[i];
    const dx = v.x - p[0], dy = v.y - p[1], dz = v.z - p[2];
    const r2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-6);
    const cr = Math.max(n[0] * dx + n[1] * dy + n[2] * dz, 0), ce = Math.max(-(v.nx * dx + v.ny * dy + v.nz * dz), 0);
    const q = r2 * invR2, w = clamp01(1 - q * q);
    const f = cr * ce * w * w / (r2 * (r2 + r0sq));
    r += v.r * f; g += v.g * f; b += v.b * f;
  }
  out[0] = r * params.x; out[1] = g * params.x; out[2] = b * params.x;
  return out;
}
