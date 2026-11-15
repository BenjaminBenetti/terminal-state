// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane BOUNCE): the LIVE FLASHLIGHT BOUNCE — the light the flashlight's beam
// sends back off the surface it lands on, every frame, on the GPU.
// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane BOUNCE): rebuilt so that a virtual light only ever stands ON a surface the
// beam really lands on (props and characters stop the beam; nothing is interpolated through the air) and is as large as its patch.
//
// Most of a base Subway station is dark and lit by the flashlight alone, so the baked light field changes nothing there. With this the
// beam lights its surroundings softly with the colour of what it falls on: a red tile wall throws warm light on the floor and ceiling
// near it, a white wall fills a dark room.
//  - CPU, each frame (FlashBounce.update): FLASH_RAYS rays of EQUAL FLUX inside the beam's cone are cast, in FLASH_SECTORS compact
//    sectors (a cap round the axis and five wedges). A ray lands on the nearest of
//      * the station's FIXED ARCHITECTURE (world/lightScene.ts BandScene, exact), with the finish the builder drew there
//        (world/surfaceAlbedo.ts, read exactly as the enhanced bake's gather reads it);
//      * a PROP BOX of the station's live list (FlashOccluders: the boxes bullets and the beam's own spot hit; glass passes; a box
//        the ray starts in is left out), with a colour per prop kind;
//      * a CHARACTER (an upright cylinder).
//    Inside a sector the hits are grouped by PLANE; the sector's VIRTUAL LIGHT stands on its dominant plane, at the centroid of that
//    plane's hits, with that plane's normal: a Lambert emitter with the colour and the flux the game's own spot light puts on those
//    rays' parts of the surface, and a patch size from their footprints. A ray on another plane gives its flux to the nearest light
//    of another sector on THAT plane, or to none: flux never moves to a plane it did not land on.
//  - Time: a light glides only WITHIN its plane (position, colour and patch size, exponential, frame-rate independent). When a
//    sector's plane changes, its light is handed to one of the two FADING slots, where it stays put and fades out, and the sector's
//    light starts on the new plane from nothing. Nothing is ever interpolated between two planes.
//  - GPU, per fragment (flashBounceIrradiance): the sum of the FLASH_VPLS emitters as irradiance, in the light field's convention
//    (three shows a Lambert surface as albedo x E / pi): pure arithmetic on plain render-group uniforms — no texture, no array, no
//    uniform buffer of its own (the fog march's fragment stage is at WebGPU's 12 uniform buffers; every uniformArray would be one more).
//  - sampleFlashBounce is the CPU mirror of that sum.
//
// Flux. The cone is cut into FLASH_RAYS cells of EQUAL FLUX (RAY_PATTERN), so each ray stands for the solid angle
//   w = OMEGA / FLASH_RAYS,   OMEGA = integral of three's cone profile over the sphere = 2 pi (1 - (cos a + cos(a (1 - penumbra))) / 2)
// (exact: the profile is a smoothstep in the cosine). Landing at distance d on a surface tilted by t, its footprint has the area
// d^2 w / cos t and the game draws the irradiance I atten(d) cos t on it, so a surface of albedo rho sends back the flux
//   phi = rho * I * atten(d) * d^2 * w            (the tilt cancels)
// With a physical falloff (decay 2, no cutoff: atten = 1 / d^2) that is rho * I * w, and the lights together carry rho x the beam's
// flux I * OMEGA whatever the distance. With the game's own falloff (decay 1.2, a 30 m cutoff window) it is rho * I * w * d^0.8 *
// window(d): the patch is exactly as bright as the game draws it, and so is what it sends back.
// A Lambert patch of flux phi has the radiant intensity phi / pi along its normal, so a point p with normal n receives
//   E(p, n) = gain * sum_i  J_i * max(0, n.L_i) * max(0, -L_i.n_i) / (r_i^2 + r0_i^2) * window(r_i),   J_i = phi_i / pi
// (L_i: unit direction from p to light i, r_i its distance; window = saturate(1 - (r / range)^4)^2).
// r0_i is the size of light i's OWN patch: r0_i^2 = max(soft * A_i / pi, r0min^2), A_i the sum of its rays' footprints
// (d^2 w / max(cos t, 0.25) each). Far from the patch that is the point light J / r^2; next to it the sum stays near J / r0^2 =
// (the patch's radiosity) / soft, at any distance of the patch from the flashlight — a far wall is a wide dim glow, never a hot point.
//
// LIMITS (by design, stated to the player-facing docs):
//  1. Virtual lights cast NO SHADOWS: their light is not stopped by walls, slabs or props between them and a surface. Only the
//     emitter's own normal term cuts: nothing reaches the back of the lit surface or the surface's own plane; the range window and
//     the distance do the rest.
//  2. The beam's rays stop on fixed architecture, a prop's BOX and a character's cylinder — nothing finer: a prop is its box (thin model
//     detail inside the box, a gap between a table's legs do not exist for the rays); loose physics bodies, pickups, a prop gone loose
//     and whatever else is in neither list do not stop them.
//  3. A sector has one light: of a sector's rays on several planes only the dominant plane's are sure to be carried (the others when
//     another sector's light stands on their plane). In clutter the bounce is dimmer than the beam's flux, never misplaced.
// Deterministic: no random number, no clock (the caller's dt only), nothing of the save / layout is written.

import * as THREE from 'three';
import type {Node} from 'three/webgpu';
import {clamp, dot, float, max, renderGroup, uniform} from 'three/tsl';
import {CELL} from '../gen/grid';
import {HIT_CEIL, HIT_FLOOR, type BandScene} from './lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, type SurfaceAlbedo} from './surfaceAlbedo';

/** Rays cast inside the cone, each of the same flux. */
export const FLASH_RAYS = 30;
/** Sectors of the cone (a cap round the axis + five wedges), FLASH_RAYS / FLASH_SECTORS rays each: one virtual light per sector. */
export const FLASH_SECTORS = 6;
/** Virtual lights: one per sector and two fading ones (a sector's light on the plane it just left). */
export const FLASH_VPLS = 8;
const SECTOR_RAYS = FLASH_RAYS / FLASH_SECTORS;
/** Time constant (s) of the smoothing of a light's position, colour and patch size, and of a fade. */
export const FLASH_BOUNCE_TAU = 0.07;
/** A virtual light stands this far (m) off its surface, along the normal. */
export const FLASH_BOUNCE_LIFT = 0.05;
/** A light dimmer than this share of what it is about to be appears at its new place at once (nothing visible moves). */
export const FLASH_BOUNCE_REVIVE = 0.1;
/** Ray length (m) for a spot light without a cutoff distance. */
export const FLASH_BOUNCE_REACH = 60;
/**
 * FB.params at start: gain, r0min (m: the smallest patch a light is given), range (m: where a light's reach ends). A gain of 1 is one
 * physical bounce; the game draws it stronger — a stylised choice, like the strength of the baked bounce: on real finishes (concrete
 * ~0.15, floors ~0.26) one physical bounce of a hand lamp is hardly seen.
 */
export const FLASH_BOUNCE_DEFAULTS = {gain: 2, r0min: 0.35, range: 11} as const;
/**
 * Tuned at run time (read at every update; QA sets them on pictures):
 *  - soft: a light's patch area is `soft` x the footprints of its rays (r0^2 = soft * A / pi): next to a patch the bounce is about
 *    (the patch's radiosity) / soft; 1 = the bare footprints.
 *  - planeAngle (degrees) / planeGap (m): two hits lie on the same plane when their normals are within the angle and each lies
 *    within the gap of the other's plane.
 *  - keep: the plane a sector's light is on stays its dominant plane while it holds at least this share of the strongest plane's flux.
 */
export const FLASH_BOUNCE_TUNING = {soft: 2, planeAngle: 25, planeGap: 0.25, keep: 0.8};

/**
 * The rays in the cone: per ray the share of the beam's flux that lies nearer the axis than the ray (0 = the axis, 1 = the cone's
 * edge), and its angle round the axis (radians, from the light's first axis across the beam toward the second).
 * A STRATIFIED pattern: every ray sits in its own cell of equal flux — the cap (flux share 0 .. 1/6) holds the axis ray (0 .. 1/30)
 * and four quarter cells round it; each of the five wedges (72 degrees, 1/6 .. 1) holds two cells of its inner ring (1/6 .. 1/2,
 * 36 degrees each) and three of its outer ring (1/2 .. 1, 24 degrees each). Sector s is rays 5 s .. 5 s + 4.
 * Where a ray sits inside its cell was found once, by a search, for the game's own cone (angle 0.58, penumbra 0.7): seen along either
 * of the light's two axes across the beam the thirty rays are evenly loaded — every strip across the beam holds its share of the
 * flux in rays to within about one ray (rings of rays would put up to seven in a strip owed two). So a pole, a column or the edge of
 * a wall crossing the beam takes the rays one at a time and never more than its share (tests/flash-bounce.test.ts pins both).
 */
export const RAY_PATTERN: readonly number[] = [
  0, 0, 0.0986, 0.913, 0.1287, 2.1293, 0.069, 4.3953, 0.0985, 5.6271,
  0.3316, 0.3328, 0.4142, 0.9884, 0.5833, 0.1013, 0.6442, 0.6031, 0.7, 1.0857,
  0.3938, 1.7838, 0.3491, 2.3568, 0.7213, 1.4243, 0.9018, 1.7897, 0.7366, 2.2954,
  0.2523, 2.8677, 0.3076, 3.2899, 0.7778, 2.7647, 0.8833, 3.1661, 0.6951, 3.627,
  0.2606, 3.9274, 0.3759, 4.668, 0.7893, 3.9294, 0.9064, 4.4434, 0.7168, 4.8011,
  0.3214, 5.2712, 0.4549, 5.831, 0.7281, 5.2589, 0.8526, 5.7393, 0.8934, 6.162,
];

/** What the bounce is cast over: a station's ray scene and its surface colours (world/enhancedLightingRuntime.ts builds both). */
export interface FlashBounceSource { scene: BandScene; albedo: SurfaceAlbedo }

/** A box that can stop the beam: world centre x / z, base height y, half extents hx / hz, height h; `round` = an upright cylinder of radius hx. */
export interface FlashBox { x: number; y: number; z: number; hx: number; hz: number; h: number; round?: boolean }

/**
 * What stops the beam besides the fixed architecture (world/flashOccluders.ts makes it for a station). Everything is read at every
 * update and nothing is kept between two: the list may be pushed to, spliced and its boxes edited in place at any time.
 * Nothing here may allocate when called.
 */
export interface FlashOccluders {
  /** The station's LIVE prop boxes. A box no higher than 0.02 m is gone. */
  readonly props: readonly FlashBox[];
  /**
   * Does `box` stop the beam (false: glass — the beam passes)? When it does, `solidH` holds the height (m, from the box's base) up
   * to which it does: the box's own height, or less for glazing that stands on a solid base.
   */
  stops(box: FlashBox): boolean;
  solidH: number;
  /** The linear albedo (r, g, b) `box` sends the beam back with. */
  albedo(box: FlashBox): ArrayLike<number>;
  /** Characters as upright cylinders: x, z, radius, y0, y1 each — `bodyCount` of them; and the albedo of one. */
  readonly bodies: ArrayLike<number>;
  bodyCount: number;
  readonly bodyAlbedo: ArrayLike<number>;
}

/** One virtual light. */
export interface FlashVpl {
  /** World position: on its plane, FLASH_BOUNCE_LIFT off the surface. */
  x: number; y: number; z: number;
  /** The plane's unit normal (into the free space). */
  nx: number; ny: number; nz: number;
  /** Radiant intensity along the normal, linear rgb: the flux the patch sends back / pi. */
  r: number; g: number; b: number;
  /** The square of its patch's size r0 (m^2). */
  r0sq: number;
}

/** A ray of the last update (QA / tests). */
export interface FlashRayDebug {
  sector: number;
  /** What it landed on. */
  on: 'none' | 'architecture' | 'prop' | 'body';
  /** Distance along the ray, the surface point and the surface's normal there (zeros when it landed nowhere). */
  t: number; x: number; y: number; z: number; nx: number; ny: number; nz: number;
  /** The share of the light's intensity it sends back / pi, per channel (albedo x d^2 atten(d) x w / pi), and its footprint (m^2). */
  transfer: [number, number, number]; area: number;
  /** The light (0 .. FLASH_SECTORS - 1) that carries its flux; -1: none (it landed nowhere, or on a plane no light stands on). */
  light: number;
}

export interface FlashBounceDebug {
  /** A station is bound; the light was on at the last update; occluders are set. */
  bound: boolean; lit: boolean; occluded: boolean;
  /** Rays that landed at the last update (of FLASH_RAYS), and how many of them on a prop box / on a character. */
  hits: number; onProps: number; onBodies: number;
  /** Prop boxes and characters inside the beam that the rays were tested against at the last update. */
  candidates: number;
  /** Where the rays started: the light, its parent (the light itself sat inside the architecture), or nowhere in free space. */
  origin: 'light' | 'parent' | 'none';
  /** The cone as sampled: its profile-weighted solid angle (sr; the beam's flux = intensity x it), one ray's share, the outermost ray's angle off the axis (rad). */
  solidAngle: number; weight: number; ringAngle: number;
  /** Lights carrying light now: the sectors' and the fading ones. */
  lights: number; fading: number;
  /** The share of the landed rays' reflected flux that no light carries (the last update's targets, before smoothing). */
  dropped: number;
  /** The flux the lights carry now (linear rgb; pi x the sum of their radiant intensities). */
  flux: [number, number, number];
  /** update() calls so far. */
  updates: number;
}

const vec4s = (name: string) => Array.from({length: FLASH_VPLS}, (_, i) => uniform(new THREE.Vector4(0, 0, 0, 0)).setGroup(renderGroup).setName(`${name}${i}`));

/**
 * The global nodes of the bounce: plain render-group uniforms only (they live in the buffer every lit material already binds).
 * Per light i: pos[i].xyz world position, pos[i].w the square of its patch size (m^2); nrm[i].xyz unit normal; col[i].rgb radiant
 * intensity (linear); the other w are 0. Lights 0 .. FLASH_SECTORS - 1 are the sectors', the rest the fading ones.
 * params: x = gain, y = r0min (m; read by update, not by the shader), z = range (m), w unused — tune here.
 */
export const FB = {
  pos: vec4s('fbPos'),
  nrm: vec4s('fbNrm'),
  col: vec4s('fbCol'),
  params: uniform(new THREE.Vector4(FLASH_BOUNCE_DEFAULTS.gain, FLASH_BOUNCE_DEFAULTS.r0min, FLASH_BOUNCE_DEFAULTS.range, 0)).setGroup(renderGroup).setName('fbParams'),
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

// a light's state: position, the plane's unit normal, transfer (what it sends back per unit of the light's intensity, rgb / pi), r0^2
const SS = 10;
// a ray of this update: t (< 0: it landed nowhere), the surface point, the normal, transfer rgb (the albedo until the flux is known),
// its footprint, its weight (its reflected flux, never quite zero)
const RS = 12;
// a sector's target: 0 set, 1..3 its own hits' centroid on the plane, 4..6 normal, 7 the plane's offset along it, 8..10 transfer,
// 11 footprints, 12 weight, 13..15 weight x point (own and given rays)
const TS = 16;
// an occluder in the beam: 0 = box (x0, y0, z0, x1, y1, z1), 1 = upright cylinder (x, z, radius, y0, y1)
const CS = 7;
const RAY_NONE = 0, RAY_ARCH = 1, RAY_PROP = 2, RAY_BODY = 3;
const NEVER = Number.POSITIVE_INFINITY;
/** A ray starts this far (m) clear of a box it could otherwise be said to start on. */
const T_MIN = 1e-4;
/** A fading or unfed light below this (sum of its transfer) is off. */
const DARK = 1e-9;

export class FlashBounce {
  /** The virtual lights as last uploaded (FB holds the same numbers as floats): the sectors' lights, then the fading ones. */
  readonly vpls: readonly FlashVpl[];
  private readonly out: FlashVpl[];
  private src: FlashBounceSource | null = null;
  private occ: FlashOccluders | null = null;
  private readonly state = new Float64Array(FLASH_VPLS * SS);
  /** The light was on at the last update (off -> on: every light appears at its place at once). */
  private lit = false;
  // the cone as sampled, for the angle / penumbra it was made for: per ray the direction's part along the axis and along the two
  // axes across it; one ray's solid angle; the cone that holds every ray (cosine / sine of its half angle)
  private coneAngle = NaN;
  private conePenumbra = NaN;
  private readonly cone = new Float64Array(FLASH_RAYS * 3);
  private weight = 0;
  private cullCos = 1;
  private cullSin = 0;
  // this update's rays, sectors and occluders (scratch, reused)
  private readonly ray = new Float64Array(FLASH_RAYS * RS);
  private readonly dir = new Float64Array(FLASH_RAYS * 3);
  private readonly rayKind = new Int8Array(FLASH_RAYS);
  /** Per ray: its group inside its sector while the sectors are made, then the light that carries it (-1: none). */
  private readonly rayLight = new Int8Array(FLASH_RAYS);
  private readonly target = new Float64Array(FLASH_SECTORS * TS);
  private readonly cur = new Float64Array(SS);
  private readonly gSeed = new Int32Array(SECTOR_RAYS);
  private readonly gFlux = new Float64Array(SECTOR_RAYS);
  private cand = new Float64Array(32 * CS);
  private candRef = new Int32Array(32);
  private candidates = 0;
  private hits = 0;
  private dropped = 0;
  private origin = 2;
  private updates = 0;

  constructor() {
    this.out = Array.from({length: FLASH_VPLS}, () => ({x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, r: 0, g: 0, b: 0, r0sq: 0}));
    this.vpls = this.out;
    this.zero();
  }

  /** The station the beam is cast over (null: none — a station swap, the transit gap, plain shading: everything is zero). */
  bind(src: FlashBounceSource | null): void {
    this.src = src;
    this.zero();
  }

  /**
   * What stops the beam besides the fixed architecture, from now on (null: nothing — the rays see the architecture alone). Kept
   * through bind(): the game sets it with a station's layout and clears it when the station goes.
   */
  occlude(occ: FlashOccluders | null): void {
    this.occ = occ;
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
    const wRay = this.weight, share = wRay / Math.PI;
    const ray = this.ray, dir = this.dir, cone = this.cone, kinds = this.rayKind, carrier = this.rayLight;

    // 1. every ray over the fixed architecture (the surface's colour waits in the transfer's place)
    let far = 0;
    for (let j = 0; j < FLASH_RAYS; j++) {
      const o = j * RS, ca = cone[j * 3], cu = cone[j * 3 + 1], cv = cone[j * 3 + 2];
      const dx = ax * ca + ux * cu + vx * cv, dy = ay * ca + uy * cu + vy * cv, dz = az * ca + uz * cu + vz * cv;
      dir[j * 3] = dx; dir[j * 3 + 1] = dy; dir[j * 3 + 2] = dz;
      let t = -1;
      kinds[j] = RAY_NONE;
      if (origin !== 2 && scene.trace(ox, oy, oz, dx, dy, dz, reach)) {
        t = scene.hitT;
        const kind = scene.hitKind;
        let px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t, nx = 0, ny = 0, nz = 0, off = ALB_WALL;
        // (the point exactly on its surface: a floor's / ceiling's own height, a wall face's cell line)
        if (kind === HIT_FLOOR) { ny = 1; off = ALB_FLOOR; py = scene.hitY; } else if (kind === HIT_CEIL) { ny = -1; off = ALB_CEIL; py = scene.hitY; } else {
          nx = scene.hitNx; nz = scene.hitNz;
          if (nx !== 0) px = Math.round(px / CELL) * CELL; else pz = Math.round(pz / CELL) * CELL;
        }
        // the surface's colour, as the enhanced bake's gather reads it: the level slot of the hit band, the hit column, the hit kind
        const A = slots[scene.slot[scene.hitBand]], a0 = scene.hitCol * ALBEDO_STRIDE + off;
        ray[o + 1] = px; ray[o + 2] = py; ray[o + 3] = pz; ray[o + 4] = nx; ray[o + 5] = ny; ray[o + 6] = nz;
        ray[o + 7] = A ? ALBEDO_LUT[A[a0]] : 0; ray[o + 8] = A ? ALBEDO_LUT[A[a0 + 1]] : 0; ray[o + 9] = A ? ALBEDO_LUT[A[a0 + 2]] : 0;
        kinds[j] = RAY_ARCH;
      }
      ray[o] = t;
      const lim = t >= 0 ? t : reach;
      if (lim > far) far = lim;
    }

    // 2. the prop boxes and characters inside the beam, nearer than the farthest of those hits: ONE pass over the live list
    const occ = origin !== 2 ? this.occ : null;
    let nc = 0;
    if (occ) {
      const props = occ.props, cc = this.cullCos, cs = this.cullSin;
      for (let i = 0, n = props.length; i < n; i++) {
        const p = props[i], h = p.h;
        if (!(h > 0.02)) continue;
        const hx = p.hx, hz = p.hz, ex = p.x - ox, ez = p.z - oz, r2 = far + hx + hz;
        if (ex * ex + ez * ez > r2 * r2) continue;
        const y0 = p.y;
        if (!occ.stops(p)) continue;
        const top = occ.solidH < h ? occ.solidH : h;
        if (!(top > 0.02)) continue;
        // its bounding sphere against the cone that holds the rays
        const ey = y0 + top / 2 - oy, rad = Math.sqrt(hx * hx + hz * hz + top * top / 4), along = ex * ax + ey * ay + ez * az;
        if (along < -rad) continue;
        const perp2 = ex * ex + ey * ey + ez * ez - along * along;
        if ((perp2 > 0 ? Math.sqrt(perp2) : 0) * cc - along * cs > rad) continue;
        const round = p.round === true;
        // a box the rays start in is not there for them (the player inside the train's shell box, or hugging furniture)
        if (oy >= y0 && oy <= y0 + top && (round ? ex * ex + ez * ez <= hx * hx : ex >= -hx && ex <= hx && ez >= -hz && ez <= hz)) continue;
        if (nc === this.candRef.length) this.growCandidates();
        const c = this.cand, q = nc * CS;
        if (round) { c[q] = 1; c[q + 1] = p.x; c[q + 2] = p.z; c[q + 3] = hx; c[q + 4] = y0; c[q + 5] = y0 + top; c[q + 6] = 0; } else { c[q] = 0; c[q + 1] = p.x - hx; c[q + 2] = y0; c[q + 3] = p.z - hz; c[q + 4] = p.x + hx; c[q + 5] = y0 + top; c[q + 6] = p.z + hz; }
        this.candRef[nc++] = i;
      }
      const bodies = occ.bodies;
      for (let i = 0, n = occ.bodyCount; i < n; i++) {
        const bx = bodies[i * 5], bz = bodies[i * 5 + 1], br = bodies[i * 5 + 2], y0 = bodies[i * 5 + 3], y1 = bodies[i * 5 + 4];
        if (!(br > 0) || !(y1 > y0)) continue;
        const ex = bx - ox, ez = bz - oz, r2 = far + br;
        if (ex * ex + ez * ez > r2 * r2) continue;
        const ey = (y0 + y1) / 2 - oy, rad = Math.sqrt(br * br + (y1 - y0) * (y1 - y0) / 4), along = ex * ax + ey * ay + ez * az;
        if (along < -rad) continue;
        const perp2 = ex * ex + ey * ey + ez * ez - along * along;
        if ((perp2 > 0 ? Math.sqrt(perp2) : 0) * cc - along * cs > rad) continue;
        if (oy >= y0 && oy <= y1 && ex * ex + ez * ez <= br * br) continue;
        if (nc === this.candRef.length) this.growCandidates();
        const c = this.cand, q = nc * CS;
        c[q] = 1; c[q + 1] = bx; c[q + 2] = bz; c[q + 3] = br; c[q + 4] = y0; c[q + 5] = y1; c[q + 6] = 0;
        this.candRef[nc++] = -1;
      }
    }
    this.candidates = nc;

    // 3. per ray the nearest of them before the architecture; 4. what the game's light puts on the ray's part of the surface
    const cand = this.cand, candRef = this.candRef;
    let hits = 0;
    for (let j = 0; j < FLASH_RAYS; j++) {
      const o = j * RS;
      if (nc) {
        const dx = dir[j * 3], dy = dir[j * 3 + 1], dz = dir[j * 3 + 2];
        const ix = dx > 1e-12 || dx < -1e-12 ? 1 / dx : 0, iy = dy > 1e-12 || dy < -1e-12 ? 1 / dy : 0, iz = dz > 1e-12 || dz < -1e-12 ? 1 / dz : 0;
        let best = ray[o] >= 0 ? ray[o] : reach, won = -1, wnx = 0, wny = 0, wnz = 0, wpx = 0, wpy = 0, wpz = 0;
        for (let c = 0; c < nc; c++) {
          const q = c * CS;
          let tn = -NEVER, tf = NEVER, nx = 0, ny = 0, nz = 0, fx = 0, fy = 0, fz = 0, face = 0;
          if (cand[q] === 0) {
            const x0 = cand[q + 1], y0 = cand[q + 2], z0 = cand[q + 3], x1 = cand[q + 4], y1 = cand[q + 5], z1 = cand[q + 6];
            if (ix !== 0) {
              let t1 = (x0 - ox) * ix, t2 = (x1 - ox) * ix, s = -1, f = x0;
              if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; f = x1; }
              if (t1 > tn) { tn = t1; nx = s; ny = 0; nz = 0; face = 1; fx = f; }
              if (t2 < tf) tf = t2;
            } else if (ox < x0 || ox > x1) continue;
            if (iy !== 0) {
              let t1 = (y0 - oy) * iy, t2 = (y1 - oy) * iy, s = -1, f = y0;
              if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; f = y1; }
              if (t1 > tn) { tn = t1; nx = 0; ny = s; nz = 0; face = 2; fy = f; }
              if (t2 < tf) tf = t2;
            } else if (oy < y0 || oy > y1) continue;
            if (iz !== 0) {
              let t1 = (z0 - oz) * iz, t2 = (z1 - oz) * iz, s = -1, f = z0;
              if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; f = z1; }
              if (t1 > tn) { tn = t1; nx = 0; ny = 0; nz = s; face = 3; fz = f; }
              if (t2 < tf) tf = t2;
            } else if (oz < z0 || oz > z1) continue;
            if (tn > tf || !(tn > T_MIN) || tn >= best) continue;
          } else {
            const cx = ox - cand[q + 1], cz = oz - cand[q + 2], rr = cand[q + 3], y0 = cand[q + 4], y1 = cand[q + 5];
            const a = dx * dx + dz * dz, b = cx * dx + cz * dz, cq = cx * cx + cz * cz - rr * rr;
            if (a < 1e-12) { if (cq > 0) continue; } else {
              const disc = b * b - a * cq;
              if (disc < 0) continue;
              const sq = Math.sqrt(disc);
              tn = (-b - sq) / a; tf = (-b + sq) / a;
              nx = (cx + dx * tn) / rr; nz = (cz + dz * tn) / rr; ny = 0;
            }
            if (iy !== 0) {
              let t1 = (y0 - oy) * iy, t2 = (y1 - oy) * iy, s = -1, f = y0;
              if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; f = y1; }
              if (t1 > tn) { tn = t1; nx = 0; ny = s; nz = 0; face = 2; fy = f; }
              if (t2 < tf) tf = t2;
            } else if (oy < y0 || oy > y1) continue;
            if (tn > tf || !(tn > T_MIN) || tn >= best) continue;
          }
          best = tn; won = c; wnx = nx; wny = ny; wnz = nz;
          // (the point exactly on the face it entered by)
          wpx = face === 1 ? fx : ox + dx * tn; wpy = face === 2 ? fy : oy + dy * tn; wpz = face === 3 ? fz : oz + dz * tn;
        }
        if (won >= 0) {
          const ref = candRef[won], A = ref >= 0 ? occ!.albedo(occ!.props[ref]) : occ!.bodyAlbedo;
          ray[o] = best; ray[o + 1] = wpx; ray[o + 2] = wpy; ray[o + 3] = wpz; ray[o + 4] = wnx; ray[o + 5] = wny; ray[o + 6] = wnz;
          ray[o + 7] = A[0]; ray[o + 8] = A[1]; ray[o + 9] = A[2];
          kinds[j] = ref >= 0 ? RAY_PROP : RAY_BODY;
        }
      }
      if (!(ray[o] >= 0)) continue;
      hits++;
      // three's own falloff at the distance from the light, on the ray's solid angle; the footprint that solid angle has there
      const ex = ray[o + 1] - lx, ey = ray[o + 2] - ly, ez = ray[o + 3] - lz, d2 = ex * ex + ey * ey + ez * ez, d = Math.sqrt(d2);
      let g = d2 / Math.max(Math.pow(d, decay), 0.01);
      if (cutoff > 0) { const q = d / cutoff, q2 = q * q, w = clamp01(1 - q2 * q2); g *= w * w; }
      g *= share;
      const tilt = d > 1e-9 ? -(ex * ray[o + 4] + ey * ray[o + 5] + ez * ray[o + 6]) / d : 1;
      const tr = ray[o + 7] * g, tg = ray[o + 8] * g, tb = ray[o + 9] * g;
      ray[o + 7] = tr; ray[o + 8] = tg; ray[o + 9] = tb;
      ray[o + 10] = d2 * wRay / (tilt > 0.25 ? tilt : 0.25);
      ray[o + 11] = tr + tg + tb + 1e-9 * g + 1e-30;
    }
    this.hits = hits;

    // 5. per sector: its hits by plane, the dominant plane, the light that stands on it
    const T = FLASH_BOUNCE_TUNING, gap = T.planeGap, pcos = Math.cos(T.planeAngle * Math.PI / 180), keep = T.keep;
    const st = this.state, tg = this.target, gSeed = this.gSeed, gFlux = this.gFlux, snap = !this.lit;
    for (let s = 0; s < FLASH_SECTORS; s++) {
      const j0 = s * SECTOR_RAYS, G = s * TS;
      let ng = 0;
      for (let q = 0; q < SECTOR_RAYS; q++) {
        const j = j0 + q, o = j * RS;
        carrier[j] = -1;
        if (!(ray[o] >= 0)) continue;
        let g = -1;
        for (let c = 0; c < ng && g < 0; c++) {
          const e = gSeed[c] * RS;
          if (ray[o + 4] * ray[e + 4] + ray[o + 5] * ray[e + 5] + ray[o + 6] * ray[e + 6] < pcos) continue;
          const ex = ray[o + 1] - ray[e + 1], ey = ray[o + 2] - ray[e + 2], ez = ray[o + 3] - ray[e + 3];
          const a = ray[e + 4] * ex + ray[e + 5] * ey + ray[e + 6] * ez, b = ray[o + 4] * ex + ray[o + 5] * ey + ray[o + 6] * ez;
          if (a <= gap && a >= -gap && b <= gap && b >= -gap) g = c;
        }
        if (g < 0) { g = ng++; gSeed[g] = j; gFlux[g] = 0; }
        gFlux[g] += ray[o + 11];
        carrier[j] = g;
      }
      tg[G] = 0;
      if (!ng) continue;
      let dom = 0;
      for (let c = 1; c < ng; c++) if (gFlux[c] > gFlux[dom]) dom = c;
      // a tie, or nearly one, keeps the plane the sector's light is on
      const S = s * SS;
      if (ng > 1 && !snap && st[S + 6] + st[S + 7] + st[S + 8] > 0) {
        for (let c = 0; c < ng; c++) {
          if (c === dom || gFlux[c] < keep * gFlux[dom]) continue;
          const e = gSeed[c] * RS;
          if (ray[e + 4] * st[S + 3] + ray[e + 5] * st[S + 4] + ray[e + 6] * st[S + 5] < pcos) continue;
          // (the light stands FLASH_BOUNCE_LIFT off its surface)
          const ex = ray[e + 1] + ray[e + 4] * FLASH_BOUNCE_LIFT - st[S], ey = ray[e + 2] + ray[e + 5] * FLASH_BOUNCE_LIFT - st[S + 1], ez = ray[e + 3] + ray[e + 6] * FLASH_BOUNCE_LIFT - st[S + 2];
          const a = st[S + 3] * ex + st[S + 4] * ey + st[S + 5] * ez, b = ray[e + 4] * ex + ray[e + 5] * ey + ray[e + 6] * ez;
          if (a <= gap && a >= -gap && b <= gap && b >= -gap) { dom = c; break; }
        }
      }
      let W = 0, cx = 0, cy = 0, cz = 0, mx = 0, my = 0, mz = 0, cr = 0, cg = 0, cb = 0, area = 0;
      for (let q = 0; q < SECTOR_RAYS; q++) {
        const j = j0 + q, o = j * RS;
        if (carrier[j] !== dom) { carrier[j] = -1; continue; }
        carrier[j] = s;
        const w = ray[o + 11];
        W += w; cx += w * ray[o + 1]; cy += w * ray[o + 2]; cz += w * ray[o + 3];
        mx += w * ray[o + 4]; my += w * ray[o + 5]; mz += w * ray[o + 6];
        cr += ray[o + 7]; cg += ray[o + 8]; cb += ray[o + 9]; area += ray[o + 10];
      }
      // the plane: the hits' mean normal, through the one of them that stands farthest out along it (a light is never inside its surface)
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      mx /= ml; my /= ml; mz /= ml;
      let off = -NEVER;
      for (let q = 0; q < SECTOR_RAYS; q++) {
        const j = j0 + q, o = j * RS;
        if (carrier[j] !== s) continue;
        const v = mx * ray[o + 1] + my * ray[o + 2] + mz * ray[o + 3];
        if (v > off) off = v;
      }
      const px = cx / W, py = cy / W, pz = cz / W, lift = off - (mx * px + my * py + mz * pz);
      tg[G] = 1; tg[G + 1] = px + mx * lift; tg[G + 2] = py + my * lift; tg[G + 3] = pz + mz * lift;
      tg[G + 4] = mx; tg[G + 5] = my; tg[G + 6] = mz; tg[G + 7] = off;
      tg[G + 8] = cr; tg[G + 9] = cg; tg[G + 10] = cb; tg[G + 11] = area; tg[G + 12] = W; tg[G + 13] = cx; tg[G + 14] = cy; tg[G + 15] = cz;
    }

    // 6. a ray off its sector's plane gives its flux to the nearest light of another sector that stands on the ray's plane, or to none
    let lost = 0, landed = 0;
    for (let j = 0; j < FLASH_RAYS; j++) {
      const o = j * RS;
      if (!(ray[o] >= 0)) continue;
      const w = ray[o + 11];
      landed += w;
      if (carrier[j] >= 0) continue;
      let to = -1, least = NEVER;
      for (let s = 0; s < FLASH_SECTORS; s++) {
        const G = s * TS;
        if (!tg[G] || ray[o + 4] * tg[G + 4] + ray[o + 5] * tg[G + 5] + ray[o + 6] * tg[G + 6] < pcos) continue;
        const ex = ray[o + 1] - tg[G + 1], ey = ray[o + 2] - tg[G + 2], ez = ray[o + 3] - tg[G + 3];
        const a = tg[G + 4] * ex + tg[G + 5] * ey + tg[G + 6] * ez, b = ray[o + 4] * ex + ray[o + 5] * ey + ray[o + 6] * ez;
        if (!(a <= gap && a >= -gap && b <= gap && b >= -gap)) continue;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < least) { least = d2; to = s; }
      }
      if (to < 0) { lost += w; continue; }
      const G = to * TS;
      carrier[j] = to;
      tg[G + 8] += ray[o + 7]; tg[G + 9] += ray[o + 8]; tg[G + 10] += ray[o + 9]; tg[G + 11] += ray[o + 10];
      tg[G + 12] += w; tg[G + 13] += w * ray[o + 1]; tg[G + 14] += w * ray[o + 2]; tg[G + 15] += w * ray[o + 3];
    }
    this.dropped = landed > 0 ? lost / landed : 0;

    // 7. time: a light glides within its plane; a sector on a new plane hands its light to a fading slot and starts there from nothing
    const a = dt > 0 ? 1 - Math.exp(-dt / FLASH_BOUNCE_TAU) : 0;
    const soft = T.soft / Math.PI, r0min = FB.params.value.y, r0minSq = r0min * r0min, cur = this.cur;
    for (let s = 0; s < FLASH_SECTORS; s++) {
      const S = s * SS, G = s * TS;
      if (!tg[G]) {
        // no ray of the sector landed: its light fades out where it stood
        if (snap) st[S + 6] = st[S + 7] = st[S + 8] = 0;
        else {
          st[S + 6] -= st[S + 6] * a; st[S + 7] -= st[S + 7] * a; st[S + 8] -= st[S + 8] * a;
          if (st[S + 6] + st[S + 7] + st[S + 8] < DARK) st[S + 6] = st[S + 7] = st[S + 8] = 0;
        }
        continue;
      }
      // where the light is to stand: the centroid of the hits it carries, on the plane, FLASH_BOUNCE_LIFT off it
      const nx = tg[G + 4], ny = tg[G + 5], nz = tg[G + 6], W = tg[G + 12];
      const px = tg[G + 13] / W, py = tg[G + 14] / W, pz = tg[G + 15] / W, lift = tg[G + 7] - (nx * px + ny * py + nz * pz) + FLASH_BOUNCE_LIFT;
      const r0 = soft * tg[G + 11];
      cur[0] = px + nx * lift; cur[1] = py + ny * lift; cur[2] = pz + nz * lift; cur[3] = nx; cur[4] = ny; cur[5] = nz;
      cur[6] = tg[G + 8]; cur[7] = tg[G + 9]; cur[8] = tg[G + 10]; cur[9] = r0 > r0minSq ? r0 : r0minSq;
      if (snap) { for (let q = 0; q < SS; q++) st[S + q] = cur[q]; continue; }
      let have = st[S + 6] + st[S + 7] + st[S + 8];
      if (have > 0 && !this.onPlane(S)) {
        // a fading light that stands on the new plane at this place comes back (the two change places: a sector whose rays straddle
        // an edge can flip as often as it likes); else the sector's light goes to a fading slot — a dark one, else the dimmest
        let slot = -1;
        for (let f = FLASH_SECTORS; f < FLASH_VPLS && slot < 0; f++) {
          const F = f * SS;
          if (!(st[F + 6] + st[F + 7] + st[F + 8] > 0) || !this.onPlane(F)) continue;
          const ex = st[F] - cur[0], ey = st[F + 1] - cur[1], ez = st[F + 2] - cur[2];
          if (ex * ex + ey * ey + ez * ez <= 4 * (st[F + 9] > cur[9] ? st[F + 9] : cur[9])) slot = f;
        }
        if (slot >= 0) {
          const F = slot * SS;
          for (let q = 0; q < SS; q++) { const v = st[S + q]; st[S + q] = st[F + q]; st[F + q] = v; }
          have = st[S + 6] + st[S + 7] + st[S + 8];
        } else {
          let least = NEVER;
          for (let f = FLASH_SECTORS; f < FLASH_VPLS; f++) { const v = st[f * SS + 6] + st[f * SS + 7] + st[f * SS + 8]; if (v < least) { least = v; slot = f; } }
          const F = slot * SS;
          for (let q = 0; q < SS; q++) st[F + q] = st[S + q];
          st[S + 6] = st[S + 7] = st[S + 8] = 0;
          have = 0;
        }
      }
      if (have > FLASH_BOUNCE_REVIVE * (cur[6] + cur[7] + cur[8])) {
        st[S] += (cur[0] - st[S]) * a; st[S + 1] += (cur[1] - st[S + 1]) * a; st[S + 2] += (cur[2] - st[S + 2]) * a;
        // (and exactly on the plane as it is now: the glide is along it)
        const e = nx * (cur[0] - st[S]) + ny * (cur[1] - st[S + 1]) + nz * (cur[2] - st[S + 2]);
        st[S] += nx * e; st[S + 1] += ny * e; st[S + 2] += nz * e;
        st[S + 9] += (cur[9] - st[S + 9]) * a;
      } else {
        // it is off, or as good as: it stands at its place at once and fades in there
        st[S] = cur[0]; st[S + 1] = cur[1]; st[S + 2] = cur[2]; st[S + 9] = cur[9];
      }
      st[S + 3] = nx; st[S + 4] = ny; st[S + 5] = nz;
      st[S + 6] += (cur[6] - st[S + 6]) * a; st[S + 7] += (cur[7] - st[S + 7]) * a; st[S + 8] += (cur[8] - st[S + 8]) * a;
    }
    // the fading lights (one handed over in this very update too: it fades as it would have changed)
    if (!snap) {
      for (let f = FLASH_SECTORS; f < FLASH_VPLS; f++) {
        const F = f * SS;
        st[F + 6] -= st[F + 6] * a; st[F + 7] -= st[F + 7] * a; st[F + 8] -= st[F + 8] * a;
        if (st[F + 6] + st[F + 7] + st[F + 8] < DARK) st[F + 6] = st[F + 7] = st[F + 8] = 0;
      }
    }

    // 8. the lights as shown: the state times the light's own intensity and colour (never smoothed: a battery dip dims them at once)
    const ir = spot.color.r * intensity, ig = spot.color.g * intensity, ib = spot.color.b * intensity, out = this.out;
    for (let i = 0; i < FLASH_VPLS; i++) {
      const S = i * SS, v = out[i];
      v.x = st[S]; v.y = st[S + 1]; v.z = st[S + 2];
      v.nx = st[S + 3]; v.ny = st[S + 4]; v.nz = st[S + 5];
      v.r = st[S + 6] * ir; v.g = st[S + 7] * ig; v.b = st[S + 8] * ib;
      v.r0sq = st[S + 9];
      FB.pos[i].value.set(v.x, v.y, v.z, v.r0sq);
      FB.nrm[i].value.set(v.nx, v.ny, v.nz, 0);
      FB.col[i].value.set(v.r, v.g, v.b, 0);
    }
    this.lit = true;
  }

  /** The rays of the last update (QA / tests; allocates its answer). */
  rays(): FlashRayDebug[] {
    const ray = this.ray, names = ['none', 'architecture', 'prop', 'body'] as const;
    return Array.from({length: FLASH_RAYS}, (_, j) => {
      const o = j * RS, hit = this.lit && ray[o] >= 0;
      return {
        sector: Math.floor(j / SECTOR_RAYS), on: names[hit ? this.rayKind[j] : RAY_NONE], t: hit ? ray[o] : 0,
        x: hit ? ray[o + 1] : 0, y: hit ? ray[o + 2] : 0, z: hit ? ray[o + 3] : 0, nx: hit ? ray[o + 4] : 0, ny: hit ? ray[o + 5] : 0, nz: hit ? ray[o + 6] : 0,
        transfer: hit ? [ray[o + 7], ray[o + 8], ray[o + 9]] : [0, 0, 0], area: hit ? ray[o + 10] : 0, light: hit ? this.rayLight[j] : -1,
      };
    });
  }

  /** What the bounce is doing (QA / tests; allocates its answer). */
  debug(): FlashBounceDebug {
    let r = 0, g = 0, b = 0, lights = 0, fading = 0, onProps = 0, onBodies = 0, cmin = 1;
    this.out.forEach((v, i) => { r += v.r; g += v.g; b += v.b; if (v.r + v.g + v.b > 0) { if (i < FLASH_SECTORS) lights++; else fading++; } });
    if (this.lit) for (let j = 0; j < FLASH_RAYS; j++) { if (!(this.ray[j * RS] >= 0)) continue; if (this.rayKind[j] === RAY_PROP) onProps++; else if (this.rayKind[j] === RAY_BODY) onBodies++; }
    for (let j = 0; j < FLASH_RAYS; j++) cmin = Math.min(cmin, Number.isFinite(this.coneAngle) ? this.cone[j * 3] : 1);
    return {
      bound: this.src !== null, lit: this.lit, occluded: this.occ !== null, hits: this.hits, onProps, onBodies, candidates: this.candidates,
      origin: this.origin === 0 ? 'light' : this.origin === 1 ? 'parent' : 'none',
      solidAngle: this.weight * FLASH_RAYS, weight: this.weight, ringAngle: Math.acos(cmin), lights, fading, dropped: this.dropped,
      flux: [r * Math.PI, g * Math.PI, b * Math.PI], updates: this.updates,
    };
  }

  /** Light `S` (its state's offset) stands on the plane of `cur` (the light a sector is to be): the normals agree and each stands on the other's plane. */
  private onPlane(S: number): boolean {
    const st = this.state, c = this.cur, T = FLASH_BOUNCE_TUNING, gap = T.planeGap;
    if (st[S + 3] * c[3] + st[S + 4] * c[4] + st[S + 5] * c[5] < Math.cos(T.planeAngle * Math.PI / 180)) return false;
    const ex = st[S] - c[0], ey = st[S + 1] - c[1], ez = st[S + 2] - c[2];
    const a = c[3] * ex + c[4] * ey + c[5] * ez, b = st[S + 3] * ex + st[S + 4] * ey + st[S + 5] * ez;
    return a <= gap && a >= -gap && b <= gap && b >= -gap;
  }

  /** Room for more occluders in the beam (rare: the buffers double and stay). */
  private growCandidates(): void {
    const cand = new Float64Array(this.cand.length * 2), ref = new Int32Array(this.candRef.length * 2);
    cand.set(this.cand); ref.set(this.candRef);
    this.cand = cand; this.candRef = ref;
  }

  /** Everything zero: the state, the lights and the uniforms (the shader's sum is then exactly zero). */
  private zero(): void {
    this.state.fill(0);
    this.lit = false;
    this.hits = 0;
    this.candidates = 0;
    this.dropped = 0;
    this.origin = 2;
    for (let i = 0; i < FLASH_VPLS; i++) {
      const v = this.out[i];
      v.x = v.y = v.z = v.nx = v.ny = v.nz = v.r = v.g = v.b = v.r0sq = 0;
      FB.pos[i].value.set(0, 0, 0, 0);
      FB.nrm[i].value.set(0, 0, 0, 0);
      FB.col[i].value.set(0, 0, 0, 0);
    }
  }

  /**
   * The rays of a cone (only when the light's angle or penumbra changed). In the cosine u of the angle off the axis the cone factor
   * s is 1 from cos(angle (1 - penumbra)) = c1 up to 1 and a smoothstep from cos(angle) = c0 to c1, and the solid angle is 2 pi du:
   * the flux beyond u, F(u) = integral of s from u to 1, is 1 - u in the core and (1 - c1) + (c1 - c0)(1/2 - t^3 + t^4 / 2) in
   * the penumbra (t = (u - c0) / (c1 - c0)). A ray of RAY_PATTERN stands where its share of the whole flux lies nearer the axis.
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
    this.weight = 2 * Math.PI * total / FLASH_RAYS;
    const cone = this.cone;
    let cmin = 1;
    // (the second axis across the beam is the camera's down for the game's light: the pattern keeps its place in the view)
    for (let j = 0; j < FLASH_RAYS; j++) {
      const c = Math.min(1, cosAt(RAY_PATTERN[j * 2])), s = Math.sqrt(Math.max(0, 1 - c * c)), phi = RAY_PATTERN[j * 2 + 1];
      cone[j * 3] = c; cone[j * 3 + 1] = s * Math.cos(phi); cone[j * 3 + 2] = s * Math.sin(phi);
      if (c < cmin) cmin = c;
    }
    // the cone that holds every ray, a little wider: what an occluder must touch to be tested
    const wide = Math.min(Math.PI / 2, Math.acos(cmin) + 2e-3);
    this.cullCos = Math.cos(wide); this.cullSin = Math.sin(wide);
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
  const invR2 = float(1).div(max(n(prm.z).mul(prm.z), 1e-6));
  let sum: N = null;
  for (let i = 0; i < FLASH_VPLS; i++) {
    const d = n(n(FB.pos[i]).xyz).sub(P);
    const r2 = max(dot(d, d), 1e-6);
    // n.L * (-L.n_i) / r^2 = (n.d) (-n_i.d) / r^4, d = the light - p (so one r^2 joins the falloff's, with the light's own patch size)
    const cr = max(dot(Nw, d), 0), ce = max(n(dot(n(FB.nrm[i]).xyz, d)).negate(), 0);
    const q = n(r2).mul(invR2);
    const w = clamp(float(1).sub(n(q).mul(q)), 0, 1);
    const term = n(n(FB.col[i]).xyz).mul(n(cr).mul(ce).mul(w).mul(w).div(n(r2).mul(n(r2).add(n(FB.pos[i]).w))));
    sum = sum ? sum.add(term) : term;
  }
  return n(sum).mul(prm.x);
}

/**
 * CPU mirror of flashBounceIrradiance: the irradiance (linear rgb, into `out`) the lights `vpls` give world point `p` on a surface
 * with unit normal `n`. `params` = FB.params' value (x gain, z range) unless given; each light brings its own patch size.
 */
export function sampleFlashBounce<T extends {[i: number]: number}>(
  vpls: readonly FlashVpl[], p: ArrayLike<number>, n: ArrayLike<number>, out: T, params: {x: number; z: number} = FB.params.value,
): T {
  const invR2 = 1 / Math.max(params.z * params.z, 1e-6);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < vpls.length; i++) {
    const v = vpls[i];
    const dx = v.x - p[0], dy = v.y - p[1], dz = v.z - p[2];
    const r2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-6);
    const cr = Math.max(n[0] * dx + n[1] * dy + n[2] * dz, 0), ce = Math.max(-(v.nx * dx + v.ny * dy + v.nz * dz), 0);
    const q = r2 * invR2, w = clamp01(1 - q * q);
    const f = cr * ce * w * w / (r2 * (r2 + v.r0sq));
    r += v.r * f; g += v.g * f; b += v.b * f;
  }
  out[0] = r * params.x; out[1] = g * params.x; out[2] = b * params.x;
  return out;
}
