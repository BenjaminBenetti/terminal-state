// Task studio-bb-production-20261112-234540-01 (lane ACTOR): BB's RUNTIME PROCEDURAL CLIPS. The four BB bodies (enemy-bb-*.glb) carry
// no baked animation: each is one skinned mesh in a STANDING bind pose on the shared 18-joint skeleton with identity rest rotations
// (tools/asset-pipeline/zombie/lib/skeleton.mjs JOINTS). Every pose the game shows is authored here, at load time, from that body's
// OWN bind joint positions — the ai/sprintGait.ts precedent (hand-authored periodic functions + analytic IK; no motion capture, no
// generation, no new asset), extended to a whole clip set:
//
//   Idle     settled on all fours, sitting back a little, breathing, the head drifting           (loop)
//   Crawl    the slow gear: diagonal pairs (L hand + R knee, then R hand + L knee)               (loop, driven by phase)
//   Scuttle  the fast gear: the same pairs, a longer hop between them                            (loop, driven by phase)
//   Poise    stopped dead mid-stride: all four planted, staggered (the freeze between two bursts; mirrored for the other pair)
//   Cackle   the "it has seen you" tell: it sits up on its haunches, hands off the surface, head thrown back, shaking with laughter
//   Windup   the pounce tell: the chest dips and wiggles, then it sinks onto its haunches, hands off the floor, head up
//   Pounce   airborne: arms thrown forward and apart, legs trailing                              (held while it flies)
//   Fall     airborne without a leap: limbs splayed and flailing                                 (loop)
//   Land     a sprawl, a scramble back onto all fours, then it shakes it off                     (driven by the time since touchdown)
//   Hit      a flinch                                                                            (one shot)
//   Death    curls onto its side (only shown when the ragdoll is unavailable)                    (one shot)
//
// PROPORTION-AGNOSTIC: nothing here is tuned to one body. Segment lengths, joint offsets and the contact points (palm, knee front, toe:
// the GLB's `enemyBb` extras, else ratios of the bind) drive every height, reach and stride. The all-fours poses are SOLVED, not keyed:
// the pelvis height from the planted knee (the thigh is one bone from the hip to the knee on the surface), the trunk's pitch from the
// height the arms can hold the shoulders at, the arms by 2-bone IK onto the planted palms, the head from where the face looks — so the
// palms and knees of a short-armed, big-headed baby and of a 2 m adult rig both land on the surface plane y = 0 (root space) and the
// body centre stays over the root origin (the BbPose contract: the root is the point ON the surface under the body centre).
//
// NO SLIDING: a planted palm / knee travels back exactly as far as the body moves forward. The stance stroke comes from the thigh's
// swing (as far ahead of the hip as the hip may flex, BB_GAIT.thighBackDeg behind it); a cycle covers `crawlM` / `scuttleM` metres on
// a scale-1 body — the stroke over the share of the cycle a limb is down. A baby's 12-16 cm thigh covers 1.3 .. 4.8 m/s only as a
// run: each gear's hop length is set so its cadence stays readable (BB_GAIT.crawl / .scuttle), and the actor plays the cycle at
// speed / (cycleM x scale) cycles per second.
//
// The poses stay inside the asset contract's audited envelope (reference BB-ASSET-CONTRACT poseEnvelope: hip flexion -25..110, knee
// 0..135, shoulder flexion -30..170 / abduction 0..110, elbow 0..125, trunk bend -25..35, neck + head extension -30..75) —
// game/tests/bb-clips.test.ts measures every frame of every clip on every body. RNG-free: never draws from any stream.
//
// The clips are sampled once per body model into flat tables (BbClipSet: 17 joint quaternions + the Hips position per frame); the
// actor (ai/bbActor.ts) samples them without allocating. The same tables give THREE.AnimationClips on demand (bbAnimationClip).

import * as THREE from 'three';
import {BB_ASSET, BB_BODY, BB_POUNCE} from './bb';

export type V3 = [number, number, number];
export type Q = [number, number, number, number];
export type BbSide = 'L' | 'R';
const SIDES: readonly BbSide[] = ['L', 'R'];
const sgn = (s: BbSide): number => (s === 'L' ? 1 : -1);

/** The shared skeleton (lib/skeleton.mjs JOINTS): [joint, parent], parents first. */
export const BB_JOINTS: readonly (readonly [string, string | null])[] = [
  ['Root', null], ['Hips', 'Root'], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'],
  ['L_UpperArm', 'Chest'], ['L_Forearm', 'L_UpperArm'], ['L_Hand', 'L_Forearm'],
  ['R_UpperArm', 'Chest'], ['R_Forearm', 'R_UpperArm'], ['R_Hand', 'R_Forearm'],
  ['L_Thigh', 'Hips'], ['L_Shin', 'L_Thigh'], ['L_Foot', 'L_Shin'],
  ['R_Thigh', 'Hips'], ['R_Shin', 'R_Thigh'], ['R_Foot', 'R_Shin'],
];
/** The joints a clip drives, in table order (every joint but Root). */
export const BB_ANIMATED: readonly string[] = BB_JOINTS.map(j => j[0]).filter(n => n !== 'Root');
/** Table column of a driven joint. */
export const BB_JOINT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(BB_ANIMATED.map((n, i) => [n, i]));
/** Table column of each driven joint's left <-> right counterpart (itself on the midline). */
const MIRROR_INDEX: readonly number[] = BB_ANIMATED.map(n => BB_JOINT_INDEX[n.startsWith('L_') ? `R_${n.slice(2)}` : n.startsWith('R_') ? `L_${n.slice(2)}` : n]);

/** GLB extras `enemyBb` (the asset contract, reference BB-ASSET-CONTRACT v1). Every field is optional at runtime (BB_ASSET / bind defaults). */
export interface BbExtras {
  variant?: string;
  name?: string;
  bindPose?: string;
  heightM?: number;
  /** The skull: centre in MODEL space (bind) and a covering radius. */
  head?: {centre?: number[]; radius?: number};
  hitRadii?: {torso?: number; arm?: number; leg?: number};
  /** palm / toe / heel: a point relative to the Hand (wrist) / Foot (ankle) joint, bind axes; kneeFront: knee joint centre -> the skin in front of it (m). */
  contact?: {palm?: {L?: number[]; R?: number[]}; kneeFront?: {L?: number; R?: number}; toe?: {L?: number[]; R?: number[]}; heel?: {L?: number[]; R?: number[]}};
  /** Head: the crown relative to the Head joint; L_Hand / R_Hand: the fingertip relative to the wrist. */
  ends?: {Head?: number[]; L_Hand?: number[]; R_Hand?: number[]};
  radius?: number;
  skinAudit?: unknown;
}

// ---------------------------------------------------------------- the clip set
export const BB_CLIP_NAMES = ['Idle', 'Crawl', 'Scuttle', 'Poise', 'Cackle', 'Windup', 'Pounce', 'Fall', 'Land', 'Hit', 'Death'] as const;
export type BbClipName = (typeof BB_CLIP_NAMES)[number];

/**
 * Seconds, looping and table frames of each clip. Crawl / Scuttle are driven by PHASE (0..1 of a cycle), not time: their `duration` is
 * only the cycle time bbAnimationClip writes. Land is driven by the seconds since touchdown (a short landing simply ends early).
 */
export const BB_CLIPS: Readonly<Record<BbClipName, {duration: number; loop: boolean; frames: number}>> = {
  Idle: {duration: 3.2, loop: true, frames: 48},
  Crawl: {duration: 0.25, loop: true, frames: 40},
  Scuttle: {duration: 0.2, loop: true, frames: 40},
  Poise: {duration: 1.4, loop: true, frames: 14},
  Cackle: {duration: 1.2, loop: false, frames: 72},
  Windup: {duration: BB_POUNCE.windupS, loop: false, frames: 26},
  Pounce: {duration: 1.1, loop: false, frames: 40},
  Fall: {duration: 0.56, loop: true, frames: 16},
  Land: {duration: BB_POUNCE.landS, loop: false, frames: 32},
  Hit: {duration: 0.4, loop: false, frames: 16},
  Death: {duration: 0.9, loop: false, frames: 18},
};

/** The gait numbers (degrees / shares of a cycle / cadences); lengths come from the body. */
export const BB_GAIT = {
  /** Chest against pelvis on all fours (deg; negative = the back a little hollow). */
  bendDeg: -10,
  /** Hip flexion never passes this (the audited envelope ends at 110): it caps how far ahead of the hip a knee may be planted. */
  maxHipFlexDeg: 100,
  /** A planted thigh swings at most this far ahead of / behind vertical. */
  thighFwdDeg: 36,
  thighBackDeg: 34,
  /**
   * The knees are planted apart: at least / at most this far out from under the hip joints (thigh abduction, deg) — as wide as it
   * takes to bring a short-armed body's hips down level with its shoulders. A knee nearer its hip than the thigh is long swings out
   * to the side instead of through the surface, to maxAbdDeg at most (the audited envelope ends at 40).
   */
  splayDeg: [12, 26],
  maxAbdDeg: 31,
  /** Elbows fold no further than this from the bind (the audited envelope ends at 125). */
  maxElbowDeg: 120,
  /**
   * Cadence targets: cycles per second at a pace (m/s) on a contract-size (0.85 m) body. They set each gear's hop: a cycle covers
   * pace / hz metres, of which a limb is planted for one stroke.
   */
  crawl: {hz: 4.0, mps: 1.4},
  scuttle: {hz: 5.2, mps: 4.8},
  /** A limb is down at most half a cycle (one diagonal pair always planted) and never less than this share. */
  maxDuty: 0.5,
  minDuty: 0.12,
  /** The actor shifts up to the Scuttle above / back down below these paces (m/s on a contract-size body, x its size). */
  shiftUpMps: 2.3,
  shiftDownMps: 1.9,
  /** A hand lands this share of a cycle before its diagonal knee. */
  handLead: 0.05,
  /** The neck + head may extend this far from the chest (the audited envelope), and flex this far. */
  maxHeadExtDeg: 75,
  maxHeadFlexDeg: 30,
  /**
   * A flat palm under a vertical forearm needs a quarter turn somewhere along the arm. It is shared out: the fingers point this far
   * outward, the elbows this far out from straight back, the wrist takes the rest (no joint is wrung like a sweet wrapper).
   */
  fingersOutDeg: 30,
  elbowOutDeg: 32,
  /** The wind-up sinks the hips this far behind the knees (thigh angle ahead of vertical, deg), as the hip allows. */
  haunchDeg: 42,
  /** The cackle: how far it sits back, the pitch its trunk rears to (deg from upright) and the laugh's shakes per second. */
  cackle: {haunchDeg: 34, pitchDeg: 44, hz: 6.5},
} as const;

// ---------------------------------------------------------------- pose maths (lib/pose.mjs, as ported by ai/sprintGait.ts)
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
const qId = (): Q => [0, 0, 0, 1];
export function qAxis(a: V3, deg: number): Q {
  const l = Math.hypot(a[0], a[1], a[2]) || 1, h = deg * D2R / 2, s = Math.sin(h) / l;
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}
export function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qInv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q: Q, v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function qNorm(q: Q): Q { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
function qSlerp(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d);
  if (d > 0.9995) return qNorm([a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t, a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t]);
  const th = Math.acos(d), k = 1 / Math.sin(th), ka = Math.sin((1 - t) * th) * k, kb = Math.sin(t * th) * k * s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}
function qFromMat(m: number[]): Q { // row-major 3x3
  const [a, b, c, d, e, f, g, h, i] = m, tr = a + e + i;
  let q: Q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s]; }
  return qNorm(q);
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** `v` without its component along the unit `d`, normalised (`fallback` when nothing is left). */
function perp(v: V3, d: V3, fallback: V3): V3 {
  const p = sub(v, mul(d, dot(v, d)));
  return len(p) > 1e-5 ? norm(p) : fallback;
}
/** Rotation taking frame (d0, h0) to (d1, h1); h is orthogonalised against d. */
function frameRot(d0: V3, h0: V3, d1: V3, h1: V3): Q {
  const f = (d: V3, h: V3): [V3, V3, V3] => { const e1 = norm(d); const e2 = norm(sub(h, mul(e1, dot(h, e1)))); return [e1, e2, cross(e1, e2)]; };
  const A = f(d0, h0), B = f(d1, h1), m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = B[0][r] * A[0][c] + B[1][r] * A[1][c] + B[2][r] * A[2][c];
  return qFromMat(m);
}
/** A trunk orientation in ROOT space: pitched forward by `pitch` (deg from upright), then rolled about the root's forward axis, then yawed about its up axis. */
const tq = (pitch: number, yaw = 0, roll = 0): Q => qMul(qAxis(Y, yaw), qMul(qAxis(Z, roll), qAxis(X, pitch)));
const ss = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const frac = (x: number): number => ((x % 1) + 1) % 1;
const v3 = (a: unknown): V3 | null => (Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n)) ? [a[0], a[1], a[2]] : null);
const num = (a: unknown): number | null => (typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : null);
/** Root of a DECREASING function on [lo, hi] (the nearer end when it has none there). */
function fall(f: (x: number) => number, target: number, lo: number, hi: number): number {
  if (f(lo) <= target) return lo;
  if (f(hi) >= target) return hi;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (f(mid) > target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- the body's rig
/** What the clips need of a body (model metres, bind pose). Per side where the body may differ left to right. */
export interface BbRig {
  /** Bind joint positions (model space) and rest translations (parent space). */
  bind: Record<string, V3>;
  local: Record<string, V3>;
  thigh: Record<BbSide, number>;
  shin: Record<BbSide, number>;
  upper: Record<BbSide, number>;
  fore: Record<BbSide, number>;
  /** The bend the bind already has at the elbow / knee (rad): the audited ranges count from it. */
  elbow0: Record<BbSide, number>;
  knee0: Record<BbSide, number>;
  /** Standing height (floor -> the top of the head). */
  heightM: number;
  /** heightM / BB_ASSET.heightM: the size of this body next to the contract's 0.85 m (1 on a real BB). */
  sizeK: number;
  /** Knee joint centre -> the skin in front of the knee (the knee joint rides this far above the surface). */
  kneeR: Record<BbSide, number>;
  /** Wrist -> the palm's skin centre / the fingertip, bind axes; the unit direction the palm faces. */
  palm: Record<BbSide, V3>;
  fingers: Record<BbSide, V3>;
  palmN: Record<BbSide, V3>;
  /** Ankle -> toe tip, bind axes. */
  toe: Record<BbSide, V3>;
  /** The skull: centre relative to the Head joint (bind axes) and its radius; the crown relative to the Head joint. */
  head: {centre: V3; radius: number; crown: V3};
  /** Gameplay hit radii (extras, else BB_ASSET x sizeK). */
  hit: {torso: number; arm: number; leg: number};
  /** The solved all-fours geometry every clip shares. */
  m: BbMetrics;
}

/** The all-fours geometry of a body (root space: +Y off the surface, +Z forward, the surface is y = 0). */
export interface BbMetrics {
  thigh: number; reach: number;
  /** Pelvis pitch from upright (deg) and the chest's bend against it in the neutral stance. */
  pitch: number; bend: number;
  /** A planted thigh starts this far ahead of vertical and ends this far behind it (deg). */
  fwdDeg: number; backDeg: number;
  /** A planted palm / knee travels this far back per stance (m). */
  stroke: number;
  /** Ground covered per cycle (m, scale 1) and the share of a cycle a limb is down: Crawl and Scuttle. */
  crawlM: number; scuttleM: number;
  crawlDuty: number; scuttleDuty: number;
  /** Hips joint: neutral z, and y with the thighs vertical. */
  hipsZ: number; hipsY: number;
  /** Knee contacts: |x|, z under the hip joints, z where a knee is planted. */
  kneeX: number; kneeMid: number; kneeFront: number;
  /** Palm contacts: |x|, z under the shoulders, the middle of the stroke, z where a palm is planted. */
  palmX: number; palmUnder: number; palmMid: number; palmFront: number;
  /** Shoulder-line height the arms hold through a stroke, and with the arms all but straight. */
  shoulderY: number; shoulderTop: number;
  /** How far the settled stance sits back (m): the knees ahead of the hip joints. */
  sitM: number;
  /** Trunk centre height in the air (the brain's BB_BODY.centreUp at this body's size). */
  centreY: number;
  /** Face elevation (deg) of the neutral crawl: as far up as the neck reaches over a level back, the horizon at most. */
  headPitch: number;
}

/**
 * The rig of a body from its bind joint positions (model space) and its `enemyBb` extras; null when a joint is missing or the
 * proportions are degenerate. Pure: tests build synthetic skeletons with it.
 */
export function bbRigFromBind(bind: Record<string, V3>, extras: BbExtras = {}): BbRig | null {
  const local: Record<string, V3> = {};
  for (const [n, p] of BB_JOINTS) {
    if (!bind[n] || !bind[n].every(Number.isFinite)) return null;
    local[n] = p ? sub(bind[n], bind[p]) : [0, 0, 0];
  }
  const seg = (a: string, b: string): number => len(sub(bind[b], bind[a]));
  const per = (f: (s: BbSide) => number): Record<BbSide, number> => ({L: f('L'), R: f('R')});
  const thigh = per(s => seg(`${s}_Thigh`, `${s}_Shin`)), shin = per(s => seg(`${s}_Shin`, `${s}_Foot`));
  const upper = per(s => seg(`${s}_UpperArm`, `${s}_Forearm`)), fore = per(s => seg(`${s}_Forearm`, `${s}_Hand`));
  if (SIDES.some(s => thigh[s] < 1e-3 || shin[s] < 1e-3 || upper[s] < 1e-3 || fore[s] < 1e-3)) return null;
  const turn = (a: string, b: string, c: string): number => Math.acos(clamp(dot(norm(sub(bind[b], bind[a])), norm(sub(bind[c], bind[b]))), -1, 1));
  const elbow0 = per(s => turn(`${s}_UpperArm`, `${s}_Forearm`, `${s}_Hand`)), knee0 = per(s => turn(`${s}_Thigh`, `${s}_Shin`, `${s}_Foot`));
  const heightM = num(extras.heightM) ?? bind.Head[1] * 1.3;
  if (!(heightM > 0.05)) return null;
  const sizeK = heightM / BB_ASSET.heightM;
  const H = extras.hitRadii ?? {}, D = BB_ASSET.hitRadii;
  const hit = {torso: num(H.torso) ?? D.torso * sizeK, arm: num(H.arm) ?? D.arm * sizeK, leg: num(H.leg) ?? D.leg * sizeK};
  const radius = num(extras.head?.radius) ?? BB_ASSET.headRadius * sizeK;
  const hc = v3(extras.head?.centre);
  const centre: V3 = hc ? sub(hc, bind.Head) : [0, Math.max(0.3 * radius, heightM - bind.Head[1] - radius), 0.15 * radius];
  const head = {centre, radius, crown: v3(extras.ends?.Head) ?? [centre[0], centre[1] + radius, centre[2]] as V3};
  const palm = {} as Record<BbSide, V3>, fingers = {} as Record<BbSide, V3>, palmN = {} as Record<BbSide, V3>, toe = {} as Record<BbSide, V3>, kneeR = {} as Record<BbSide, number>;
  for (const s of SIDES) {
    const sg = sgn(s), dF0 = norm(sub(bind[`${s}_Hand`], bind[`${s}_Forearm`])), handLen = 0.26 * (upper[s] + fore[s]);
    const tip = v3(extras.ends?.[`${s}_Hand`]);
    fingers[s] = tip && len(tip) > 1e-3 ? tip : mul(dF0, handLen);
    const f0 = norm(fingers[s]);
    // the palm faces down on a T-pose arm and toward the body on a hanging one ("palms down / in"): the measured palm point decides
    // when it is clearly off the finger axis, else that rule
    const pc = v3(extras.contact?.palm?.[s]);
    const off = pc ? sub(pc, mul(f0, dot(pc, f0))) : null;
    palmN[s] = off && len(off) > 0.12 * len(fingers[s]) ? norm(off) : perp([-0.6 * sg, -1, 0], f0, perp([-sg, 0, 0], f0, [0, 0, -1]));
    palm[s] = pc ?? add(mul(f0, 0.5 * len(fingers[s])), mul(palmN[s], 0.1 * len(fingers[s])));
    kneeR[s] = num(extras.contact?.kneeFront?.[s]) ?? Math.min(hit.leg, 0.2 * thigh[s]);
    toe[s] = v3(extras.contact?.toe?.[s]) ?? [0, -0.85 * Math.max(0, bind[`${s}_Foot`][1]), 0.11 * heightM];
  }
  const rig: BbRig = {bind, local, thigh, shin, upper, fore, elbow0, knee0, heightM, sizeK, kneeR, palm, fingers, palmN, toe, head, hit, m: null as unknown as BbMetrics};
  rig.m = metricsOf(rig);
  return Number.isFinite(rig.m.hipsY + rig.m.shoulderY + rig.m.hipsZ + rig.m.stroke + rig.m.pitch) && rig.m.stroke > 1e-4 ? rig : null;
}

/**
 * The rig of a freshly cloned body `root` (its bones still at rest): null unless every BB_JOINTS bone is there with its parent, an
 * identity rest rotation and unit scale (the convention the pose maths assumes) — the caller then shows the bind pose.
 */
export function bbRigOf(root: THREE.Object3D, extras: BbExtras = {}): BbRig | null {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse(o => { if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o); });
  const bind: Record<string, V3> = {};
  for (const [n, p] of BB_JOINTS) {
    const b = bones.get(n);
    if (!b || (p && b.parent?.name !== p)) return null;
    const q = b.quaternion, s = b.scale;
    if (Math.abs(q.w) < 0.99999 || Math.abs(s.x - 1) > 1e-4 || Math.abs(s.y - 1) > 1e-4 || Math.abs(s.z - 1) > 1e-4) return null;
    const l: V3 = [b.position.x, b.position.y, b.position.z];
    bind[n] = p ? add(bind[p], l) : [0, 0, 0];
  }
  return bbRigFromBind(bind, extras);
}

// ---------------------------------------------------------------- frames
/** One pose: the Hips joint position (root space) and every driven joint's local rotation. */
export interface BbFrame { hips: V3; rot: Record<string, Q> }

/** Root-space position and orientation of every joint of a frame (forward kinematics). */
export function bbWorld(rig: BbRig, f: BbFrame): {pos: Record<string, V3>; rot: Record<string, Q>} {
  const pos: Record<string, V3> = {}, rot: Record<string, Q> = {};
  for (const [n, p] of BB_JOINTS) {
    if (!p) { pos[n] = [0, 0, 0]; rot[n] = qId(); continue; }
    pos[n] = n === 'Hips' ? [f.hips[0], f.hips[1], f.hips[2]] : add(pos[p], qRot(rot[p], rig.local[n]));
    rot[n] = qMul(rot[p], f.rot[n] ?? qId());
  }
  return {pos, rot};
}

/** The same pose seen in a mirror (left <-> right): what the other half of a symmetric cycle must equal. */
export function mirrorFrame(f: BbFrame): BbFrame {
  const rot: Record<string, Q> = {};
  for (const n of BB_ANIMATED) {
    const src = n.startsWith('L_') ? `R_${n.slice(2)}` : n.startsWith('R_') ? `L_${n.slice(2)}` : n;
    const q = f.rot[src] ?? qId();
    rot[n] = [q[0], -q[1], -q[2], q[3]];
  }
  return {hips: [-f.hips[0], f.hips[1], f.hips[2]], rot};
}

/** Where a frame touches the surface (root space): palm skin centres, the lowest point of each knee, toe tips; and the skull sphere. */
export function bbContacts(rig: BbRig, f: BbFrame): {palm: Record<BbSide, V3>; knee: Record<BbSide, V3>; toe: Record<BbSide, V3>; head: {c: V3; r: number}} {
  const w = bbWorld(rig, f);
  const side = (fn: (s: BbSide) => V3): Record<BbSide, V3> => ({L: fn('L'), R: fn('R')});
  return {
    palm: side(s => add(w.pos[`${s}_Hand`], qRot(w.rot[`${s}_Hand`], rig.palm[s]))),
    knee: side(s => add(w.pos[`${s}_Shin`], [0, -rig.kneeR[s], 0])),
    toe: side(s => add(w.pos[`${s}_Foot`], qRot(w.rot[`${s}_Foot`], rig.toe[s]))),
    head: {c: add(w.pos.Head, qRot(w.rot.Head, rig.head.centre)), r: rig.head.radius},
  };
}

/** The joint angles of a frame in the asset contract's terms (degrees; arms from hanging at the side, the rest from the bind). */
export interface BbAngles {
  hipFlexion: Record<BbSide, number>; hipAbduction: Record<BbSide, number>; kneeFlexion: Record<BbSide, number>;
  /**
   * The upper arm against the chest: how far it is raised from hanging (0 = at the side, 180 = overhead: flexion and abduction in
   * one), how far it points behind the chest's frontal plane (shoulder extension), and how far out to its own side.
   */
  shoulderRaise: Record<BbSide, number>; shoulderBack: Record<BbSide, number>; shoulderAbduction: Record<BbSide, number>;
  elbowFlexion: Record<BbSide, number>;
  /** Chest against pelvis: forward bend (+), and the angle of what is left (twist + side bend together). */
  trunkBend: number; trunkTurn: number;
  /** Head against chest: extension (+ = tipped back), and how far the face is turned off the chest's mid-plane. */
  headExtension: number; headTurn: number;
}
export function bbAngles(rig: BbRig, f: BbFrame): BbAngles {
  const w = bbWorld(rig, f);
  const dir = (a: string, b: string): V3 => norm(sub(w.pos[b], w.pos[a]));
  const per = (fn: (s: BbSide) => number): Record<BbSide, number> => ({L: fn('L'), R: fn('R')});
  const inFrame = (q: Q, d: V3): V3 => qRot(qInv(q), d);
  const bindDir = (a: string, b: string): V3 => norm(sub(rig.bind[b], rig.bind[a]));
  const wrap = (deg: number): number => ((deg + 540) % 360) - 180;
  // a thigh's swing from where it hangs in the bind, in the pelvis' frame: flexion in the sagittal plane, abduction out of it
  const hip = (s: BbSide): [number, number] => {
    const d = inFrame(w.rot.Hips, dir(`${s}_Thigh`, `${s}_Shin`)), d0 = bindDir(`${s}_Thigh`, `${s}_Shin`);
    return [wrap((Math.atan2(d[2], -d[1]) - Math.atan2(d0[2], -d0[1])) * R2D), (Math.asin(clamp(sgn(s) * d[0], -1, 1)) - Math.asin(clamp(sgn(s) * d0[0], -1, 1))) * R2D];
  };
  const bend = (a: string, b: string, c: string): number => Math.acos(clamp(dot(dir(a, b), dir(b, c)), -1, 1)) * R2D - Math.acos(clamp(dot(bindDir(a, b), bindDir(b, c)), -1, 1)) * R2D;
  const arm = (s: BbSide): V3 => inFrame(w.rot.Chest, dir(`${s}_UpperArm`, `${s}_Forearm`));
  const rel = qMul(qInv(w.rot.Hips), w.rot.Chest), up = qRot(rel, Y);
  const trunkBend = Math.atan2(up[2], up[1]) * R2D;
  const rest = qMul(qInv(qAxis(X, trunkBend)), rel);
  const face = qRot(qMul(qInv(w.rot.Chest), w.rot.Head), Z);
  return {
    hipFlexion: per(s => hip(s)[0]),
    hipAbduction: per(s => hip(s)[1]),
    kneeFlexion: per(s => bend(`${s}_Thigh`, `${s}_Shin`, `${s}_Foot`)),
    shoulderRaise: per(s => Math.acos(clamp(-arm(s)[1], -1, 1)) * R2D),
    shoulderBack: per(s => Math.asin(clamp(-arm(s)[2], -1, 1)) * R2D),
    shoulderAbduction: per(s => Math.asin(clamp(sgn(s) * arm(s)[0], -1, 1)) * R2D),
    elbowFlexion: per(s => bend(`${s}_UpperArm`, `${s}_Forearm`, `${s}_Hand`)),
    trunkBend,
    trunkTurn: 2 * Math.acos(clamp(Math.abs(rest[3]), 0, 1)) * R2D,
    headExtension: Math.atan2(face[1], face[2]) * R2D,
    headTurn: Math.asin(clamp(Math.abs(face[0]), 0, 1)) * R2D,
  };
}

// ---------------------------------------------------------------- the all-fours solver
/** A palm / knee contact: where on the surface (root x, z) and how far it is lifted off it. */
interface Contact { x: number; z: number; lift: number }
/** A free arm, from hanging at the side in the chest's frame (deg): swung forward, out, the elbow folded. */
interface ArmFk { flex: number; abd: number; elbow: number; /** The elbow folds the forearm toward this chest-frame direction. */ toward?: V3 }
/** A free leg in the pelvis' frame (deg). */
interface LegFk { flex: number; abd: number; knee: number; foot?: number }
interface Fours {
  hipsX: number; hipsZ: number;
  /** Hips height: given, or just high enough for a planted knee ('L' / 'R': that side's; 'max': whichever needs more). */
  hipsY: number | BbSide | 'max';
  /** Pelvis pitch from upright (deg) — or 'fit': solved so the shoulder line is held at `shoulderY`. */
  pitch: number | 'fit';
  /** Pelvis yaw / roll in root space (deg). */
  yaw: number; roll: number;
  /** Chest against pelvis, forward (deg) — or 'fit' (with a given pitch): solved for `shoulderY`, inside the envelope. */
  bend: number | 'fit';
  /** The chest's yaw / roll in root space (deg). */
  chestYaw: number; chestRoll: number;
  /** Height the shoulder line is held at (what a 'fit' solves for). */
  shoulderY: number;
  knee: Record<BbSide, Contact>;
  /** Palms; `yaw` turns the fingers outward (deg), `tilt` lifts the fingertips (deg, a lifted hand). */
  palm: Record<BbSide, Contact & {yaw?: number; tilt?: number}>;
  /** Elbows point back and this far out (deg). */
  elbowOut?: number;
  /** Arms taken off the surface: the free pose and how much of it (0 = planted, 1 = free). */
  free?: Partial<Record<BbSide, ArmFk & {k: number}>>;
  /** The face in root space: elevation (+ up), yaw, roll (deg). */
  head: [number, number, number];
  /** Extra ankle height per side (a kicked-up shin). */
  ankleLift?: Record<BbSide, number>;
}

function trunkPoints(rig: BbRig, hips: V3, qP: Q, qC: Q): {qS: Q; chest: V3; shoulder: Record<BbSide, V3>} {
  const qS = qSlerp(qP, qC, 0.5);
  const chest = add(add(hips, qRot(qP, rig.local.Spine)), qRot(qS, rig.local.Chest));
  return {qS, chest, shoulder: {L: add(chest, qRot(qC, rig.local.L_UpperArm)), R: add(chest, qRot(qC, rig.local.R_UpperArm))}};
}

/** Hips height that puts side `s`'s knee joint on its contact (the thigh is one bone from the hip joint to the knee). */
function hipsYFor(rig: BbRig, qP: Q, hx: number, hz: number, s: BbSide, c: Contact): number {
  const o = qRot(qP, rig.local[`${s}_Thigh`]);
  const dx = hx + o[0] - c.x, dz = hz + o[2] - c.z, t = rig.thigh[s];
  return rig.kneeR[s] + c.lift - o[1] + Math.sqrt(Math.max(0, t * t - dx * dx - dz * dz));
}

/**
 * The lowest the Hips may ride over side `s`'s knee at `c`: with the thigh swung out as far as the hip abducts, the knee just clears
 * the surface (a knee nearer its hip than the thigh is long goes out to the side, never through the floor: solveFours).
 */
function hipsFloor(rig: BbRig, qP: Q, hx: number, hz: number, s: BbSide, c: Contact): number {
  const o = qRot(qP, rig.local[`${s}_Thigh`]);
  const t = rig.thigh[s], dx = Math.max(Math.abs(hx + o[0] - c.x), t * Math.sin(BB_GAIT.maxAbdDeg * D2R)), dz = hz + o[2] - c.z;
  return rig.kneeR[s] - o[1] + Math.sqrt(Math.max(0, t * t - dx * dx - dz * dz));
}

/** The trunk of an all-fours pose: the Hips position, the pelvis pitch and the chest bend (given or solved). */
function foursTrunk(rig: BbRig, o: Fours): {hips: V3; pitch: number; bend: number} {
  const hipsAt = (p: number): V3 => {
    const q = tq(p, o.yaw, o.roll);
    const y = typeof o.hipsY === 'number' ? o.hipsY
      : o.hipsY === 'max' ? Math.max(hipsYFor(rig, q, o.hipsX, o.hipsZ, 'L', o.knee.L), hipsYFor(rig, q, o.hipsX, o.hipsZ, 'R', o.knee.R))
        : hipsYFor(rig, q, o.hipsX, o.hipsZ, o.hipsY, o.knee[o.hipsY]);
    return [o.hipsX, Math.max(y, hipsFloor(rig, q, o.hipsX, o.hipsZ, 'L', o.knee.L), hipsFloor(rig, q, o.hipsX, o.hipsZ, 'R', o.knee.R)), o.hipsZ];
  };
  const shoulderAt = (p: number, b: number): number => {
    const T = trunkPoints(rig, hipsAt(p), tq(p, o.yaw, o.roll), tq(p + b, o.chestYaw, o.chestRoll));
    return (T.shoulder.L[1] + T.shoulder.R[1]) / 2;
  };
  let pitch: number, bend: number;
  if (o.pitch === 'fit') {
    const b = bend = o.bend === 'fit' ? BB_GAIT.bendDeg : o.bend;
    pitch = fall(p => shoulderAt(p, b), o.shoulderY, 36, 104);
  } else {
    const p = pitch = o.pitch;
    bend = o.bend === 'fit' ? fall(b => shoulderAt(p, b), o.shoulderY, -24, 34) : o.bend;
  }
  return {hips: hipsAt(pitch), pitch, bend};
}

/** Neck + Head local rotations putting the face at (elevation, yaw, roll) in root space, inside the neck's envelope against the chest. */
function headRot(qChestW: Q, pitch: number, yaw: number, roll: number): {Neck: Q; Head: Q} {
  let rel = qMul(qInv(qChestW), qMul(qAxis(Y, yaw), qMul(qAxis(X, -pitch), qAxis(Z, roll))));
  const face = qRot(rel, Z), ext = Math.atan2(face[1], face[2]) * R2D;
  // (a turn about the chest's +X by +a tips the face forward / down: back inside the envelope)
  if (ext > BB_GAIT.maxHeadExtDeg) rel = qMul(qAxis(X, ext - BB_GAIT.maxHeadExtDeg), rel);
  else if (ext < -BB_GAIT.maxHeadFlexDeg) rel = qMul(qAxis(X, ext + BB_GAIT.maxHeadFlexDeg), rel);
  const neck = qSlerp(qId(), rel, 0.42);
  return {Neck: neck, Head: qMul(qInv(neck), rel)};
}

/**
 * A leg from its thigh direction and shin direction (root space), bent about `hinge`. The foot is pointed by `footDeg` — or, given the
 * ankle's height over the surface, as far as it takes (from `footDeg` on) to keep the toes off it: lying back, the instep goes down.
 */
function setLeg(rig: BbRig, rot: Record<string, Q>, qP: Q, s: BbSide, dT: V3, dS: V3, hinge: V3, footDeg: number, ankleY?: number): void {
  const b = rig.bind;
  const dT0 = norm(sub(b[`${s}_Shin`], b[`${s}_Thigh`])), dS0 = norm(sub(b[`${s}_Foot`], b[`${s}_Shin`]));
  const Rt = frameRot(dT0, X, dT, hinge), Rs = frameRot(dS0, X, dS, hinge);
  rot[`${s}_Thigh`] = qMul(qInv(qP), Rt);
  rot[`${s}_Shin`] = qMul(qInv(Rt), Rs);
  let foot = footDeg;
  if (ankleY !== undefined) {
    let best = -Infinity;
    for (let a = footDeg; a <= 125; a += 5) {
      const y = ankleY + qRot(qMul(Rs, qAxis(X, a)), rig.toe[s])[1];
      if (y > best) { best = y; foot = a; }
      if (y >= 0.004 * rig.sizeK) break;
    }
  }
  rot[`${s}_Foot`] = qAxis(X, foot);
}

/** An arm from its upper-arm and forearm directions (root space; the elbow's hinge is their normal); the hand's world rotation or none. */
function setArm(rig: BbRig, rot: Record<string, Q>, qC: Q, s: BbSide, dU: V3, dF: V3, hinge: V3, hand: Q | null): void {
  const b = rig.bind;
  const dU0 = norm(sub(b[`${s}_Forearm`], b[`${s}_UpperArm`])), dF0 = norm(sub(b[`${s}_Hand`], b[`${s}_Forearm`]));
  const hU0 = perp(cross(dU0, Z), dU0, X), hF0 = perp(cross(dF0, Z), dF0, X);
  const Ru = frameRot(dU0, hU0, dU, hinge), Rf = frameRot(dF0, hF0, dF, hinge);
  rot[`${s}_UpperArm`] = qMul(qInv(qC), Ru);
  rot[`${s}_Forearm`] = qMul(qInv(Ru), Rf);
  rot[`${s}_Hand`] = hand ? qMul(qInv(Rf), hand) : qId();
}

/** A limb direction from where it hangs: `flex` forward in the sagittal plane, `abd` out to its side (deg), in its parent's frame. */
const hang = (sg: number, flex: number, abd: number): V3 => [sg * Math.sin(abd * D2R), -Math.cos(abd * D2R) * Math.cos(flex * D2R), Math.cos(abd * D2R) * Math.sin(flex * D2R)];

/** A free arm under the chest `qC` (root space); the elbow's fold counts from the bind's. */
function armFk(rig: BbRig, rot: Record<string, Q>, qC: Q, s: BbSide, A: ArmFk): void {
  const sg = sgn(s), dU = qRot(qC, hang(sg, A.flex, A.abd));
  const v = perp(qRot(qC, A.toward ?? [-0.3 * sg, 0.2, 1]), dU, qRot(qC, Z)), e = Math.max(0, A.elbow) * D2R + rig.elbow0[s];
  setArm(rig, rot, qC, s, dU, norm(add(mul(dU, Math.cos(e)), mul(v, Math.sin(e)))), norm(cross(dU, v)), null);
}

/**
 * All fours from its contacts: the pelvis over the planted knee(s), the trunk pitched (or bent) until the shoulders sit where the arms
 * can hold them, each arm by 2-bone IK onto its palm, each thigh aimed at its knee with the shin lying back along the surface, the
 * head turned to where the face looks.
 */
function solveFours(rig: BbRig, o: Fours): BbFrame {
  const rot: Record<string, Q> = {};
  const {hips, pitch, bend} = foursTrunk(rig, o);
  const qP = tq(pitch, o.yaw, o.roll), qC = tq(pitch + bend, o.chestYaw, o.chestRoll);
  const T = trunkPoints(rig, hips, qP, qC);
  rot.Hips = qP;
  rot.Spine = qMul(qInv(qP), T.qS);
  rot.Chest = qMul(qInv(T.qS), qC);
  Object.assign(rot, headRot(qC, o.head[0], o.head[1], o.head[2]));
  for (const s of SIDES) {
    const sg = sgn(s);
    // --- the leg: the thigh from the hip joint to the knee joint over its contact; the shin back along the surface. A contact out
    // of the thigh's reach is aimed at; one nearer than the thigh is long sends the knee out to the side (not through the surface).
    const hj = add(hips, qRot(qP, rig.local[`${s}_Thigh`])), kc = o.knee[s], t = rig.thigh[s];
    const want = sub([kc.x, rig.kneeR[s] + kc.lift, kc.z], hj);
    let dT = norm(want);
    if (len(want) < t) {
      const out = clamp(Math.sqrt(Math.max(0, t * t - want[1] * want[1] - want[2] * want[2])), Math.max(0, sg * want[0]), Math.max(sg * want[0], t * Math.sin(BB_GAIT.maxAbdDeg * D2R)));
      dT = norm([sg * out, -Math.sqrt(Math.max(0, t * t - out * out - want[2] * want[2])), want[2]]);
    }
    const knee = add(hj, mul(dT, t));
    const ankleY = Math.min(knee[1], Math.max(0.6 * rig.kneeR[s], -0.9 * rig.toe[s][1]) + kc.lift * 0.5 + (o.ankleLift?.[s] ?? 0));
    const run = Math.sqrt(Math.max(1e-8, rig.shin[s] ** 2 - (knee[1] - ankleY) ** 2));
    const dS = norm(sub([knee[0], ankleY, knee[2] - run], knee));
    setLeg(rig, rot, qP, s, dT, dS, perp(cross(dT, dS), dT, X), 62, ankleY);
    // --- the arm: the flat hand on its contact (fingers forward and a little out), the wrist above it, the elbow back and a little out
    const fr = o.free?.[s], pc = o.palm[s], yaw = (pc.yaw ?? BB_GAIT.fingersOutDeg) * D2R * sg, tilt = (pc.tilt ?? 0) * D2R;
    const fwd: V3 = [Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)];
    const Rh = frameRot(norm(rig.fingers[s]), rig.palmN[s], fwd, [0, -1, 0]);
    const S = T.shoulder[s], a = rig.upper[s], c = rig.fore[s];
    // (a hand on its way to a free pose is picked up first: the blend never drags it through the surface)
    let wrist = sub([pc.x, pc.lift + (fr ? 0.3 * (a + c) * ss(0, 0.5, fr.k) : 0), pc.z], qRot(Rh, rig.palm[s]));
    let d = len(sub(wrist, S));
    const u = norm(sub(wrist, S));
    // the elbow neither straightens past the bind's own bend nor folds past its limit
    const reach = (fold: number): number => Math.sqrt(a * a + c * c + 2 * a * c * Math.cos(fold));
    const dc = clamp(d, reach(BB_GAIT.maxElbowDeg * D2R + rig.elbow0[s]), reach(rig.elbow0[s]) * 0.9995);
    if (dc !== d) { d = dc; wrist = add(S, mul(u, d)); }
    const eo = (o.elbowOut ?? BB_GAIT.elbowOutDeg) * D2R;
    const v = perp([sg * Math.sin(eo), 0.1, -Math.cos(eo)], u, [0, 0, -1]);
    const cosA = clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = add(S, add(mul(u, a * cosA), mul(v, a * sinA)));
    setArm(rig, rot, qC, s, norm(sub(elbow, S)), norm(sub(wrist, elbow)), norm(cross(v, u)), Rh);
    if (fr && fr.k > 0) {
      const f: Record<string, Q> = {};
      armFk(rig, f, qC, s, fr);
      for (const j of ['UpperArm', 'Forearm', 'Hand']) rot[`${s}_${j}`] = qSlerp(rot[`${s}_${j}`], f[`${s}_${j}`], fr.k);
    }
  }
  return {hips, rot};
}

// ---------------------------------------------------------------- free (airborne / lying) poses
interface Free {
  hips: V3;
  /** Pelvis pitch / yaw / roll in root space (deg). */
  pelvis: [number, number, number];
  /** Chest against pelvis: forward bend; and its yaw / roll in root space. */
  bend: number; chestYaw?: number; chestRoll?: number;
  head: [number, number, number];
  arm: Record<BbSide, ArmFk>;
  leg: Record<BbSide, LegFk>;
}

function solveFree(rig: BbRig, o: Free): BbFrame {
  const rot: Record<string, Q> = {};
  const qP = tq(o.pelvis[0], o.pelvis[1], o.pelvis[2]);
  const qC = tq(o.pelvis[0] + o.bend, o.chestYaw ?? o.pelvis[1], o.chestRoll ?? o.pelvis[2]);
  const qS = qSlerp(qP, qC, 0.5);
  rot.Hips = qP;
  rot.Spine = qMul(qInv(qP), qS);
  rot.Chest = qMul(qInv(qS), qC);
  Object.assign(rot, headRot(qC, o.head[0], o.head[1], o.head[2]));
  for (const s of SIDES) {
    const sg = sgn(s), L = o.leg[s];
    const dT = qRot(qP, hang(sg, L.flex, L.abd));
    const hx = perp(qRot(qP, X), dT, X), k = Math.max(0, L.knee) * D2R + rig.knee0[s];
    setLeg(rig, rot, qP, s, dT, norm(add(mul(dT, Math.cos(k)), mul(cross(hx, dT), Math.sin(k)))), hx, L.foot ?? 30);
    armFk(rig, rot, qC, s, o.arm[s]);
  }
  return {hips: o.hips, rot};
}

/**
 * How far below the surface (negative) or above it the lowest part of a free pose is: the contact points and a sphere about every
 * limb joint, the trunk's ends and the skull. Free poses are stood on / lifted clear of the surface by it.
 */
function lowest(rig: BbRig, f: BbFrame): number {
  const w = bbWorld(rig, f), C = bbContacts(rig, f);
  let lo = Math.min(C.head.c[1] - C.head.r, w.pos.Hips[1] - rig.hit.torso, w.pos.Chest[1] - rig.hit.torso);
  for (const s of SIDES) {
    lo = Math.min(lo, C.palm[s][1], C.toe[s][1], w.pos[`${s}_Hand`][1] + qRot(w.rot[`${s}_Hand`], rig.fingers[s])[1],
      w.pos[`${s}_UpperArm`][1] - rig.hit.arm, w.pos[`${s}_Forearm`][1] - rig.hit.arm, w.pos[`${s}_Hand`][1] - rig.hit.arm,
      w.pos[`${s}_Thigh`][1] - rig.hit.leg, w.pos[`${s}_Shin`][1] - rig.kneeR[s], w.pos[`${s}_Foot`][1] - 0.8 * rig.hit.leg);
  }
  return lo;
}
/** The pose lifted until nothing of it is under the surface (never lowered). */
function clear(rig: BbRig, f: BbFrame): BbFrame {
  const lo = lowest(rig, f);
  if (lo < 0) f.hips[1] -= lo;
  return f;
}

/** Joint-wise blend of two frames (shortest arc). */
function mixFrames(a: BbFrame, b: BbFrame, t: number): BbFrame {
  const rot: Record<string, Q> = {};
  for (const n of BB_ANIMATED) rot[n] = qSlerp(a.rot[n] ?? qId(), b.rot[n] ?? qId(), t);
  return {hips: [lerp(a.hips[0], b.hips[0], t), lerp(a.hips[1], b.hips[1], t), lerp(a.hips[2], b.hips[2], t)], rot};
}

/**
 * An arm pose as LOCAL rotations (UpperArm against the chest, Forearm, Hand): the same on every trunk pose, so the actor can lay it
 * over any clip (a lifted hand in a twitch, the arms of a cackle). Angles from hanging at the side, as the asset contract counts them.
 */
export function bbArmLocal(rig: BbRig, s: BbSide, flex: number, abd: number, elbow: number): {upper: Q; fore: Q; hand: Q} {
  const rot: Record<string, Q> = {};
  armFk(rig, rot, qId(), s, {flex, abd, elbow});
  return {upper: rot[`${s}_UpperArm`], fore: rot[`${s}_Forearm`], hand: rot[`${s}_Hand`]};
}

// ---------------------------------------------------------------- the body's all-fours geometry
function metricsOf(rig: BbRig): BbMetrics {
  const avg = (r: Record<BbSide, number>): number => (r.L + r.R) / 2;
  const thigh = avg(rig.thigh), reach = avg(rig.upper) + avg(rig.fore), kneeR = avg(rig.kneeR), bend = BB_GAIT.bendDeg;
  const hipHalf = Math.abs(rig.local.L_Thigh[0] - rig.local.R_Thigh[0]) / 2;
  const shoulderHalf = Math.abs(rig.bind.L_UpperArm[0] - rig.bind.R_UpperArm[0]) / 2;
  const palmOut = 0.12 * avg(rig.upper), palmX = shoulderHalf + palmOut;
  // the flat hand: how far the wrist rides above the palm's contact
  const yaw = BB_GAIT.fingersOutDeg * D2R, Rh = frameRot(norm(rig.fingers.L), rig.palmN.L, [Math.sin(yaw), 0, Math.cos(yaw)], [0, -1, 0]);
  const wristUp = -qRot(Rh, rig.palm.L)[1];
  let kneeX = hipHalf;
  const hipsFor = (p: number): V3 => { const q = tq(p); return [0, hipsYFor(rig, q, 0, 0, 'L', {x: kneeX, z: qRot(q, rig.local.L_Thigh)[2], lift: 0}), 0]; };
  const shoulderOf = (p: number): number => { const T = trunkPoints(rig, hipsFor(p), tq(p), tq(p + bend)); return (T.shoulder.L[1] + T.shoulder.R[1]) / 2; };
  // the stroke, the height the arms hold the shoulders at through it, the knees' splay and the pitch that puts the trunk between hips
  // and shoulders depend on each other: a few damped rounds settle them
  let stroke = thigh, pitch = 80, fwd = 20, back: number = BB_GAIT.thighBackDeg, shoulderY = 0;
  for (let i = 0; i < 12; i++) {
    const far = 0.6 * stroke; // half the stroke + its centre's lead ahead of the shoulder
    shoulderY = wristUp + Math.sqrt(Math.max((0.5 * reach) ** 2, (0.96 * reach) ** 2 - far * far - palmOut * palmOut));
    // knees apart: as wide as brings the hips down to just under the shoulder line (a short-armed body's back stays level)
    const splay = clamp(Math.acos(clamp((shoulderY - 0.012 * rig.sizeK - kneeR) / thigh, 0, 1)) * R2D, BB_GAIT.splayDeg[0], BB_GAIT.splayDeg[1]);
    kneeX = hipHalf + thigh * Math.sin(splay * D2R);
    pitch = fall(shoulderOf, shoulderY, 36, 104);
    fwd = clamp(BB_GAIT.maxHipFlexDeg - pitch, 4, BB_GAIT.thighFwdDeg);
    back = clamp(pitch + 15, 8, BB_GAIT.thighBackDeg);
    stroke = lerp(stroke, thigh * (Math.sin(fwd * D2R) + Math.sin(back * D2R)), 0.6);
  }
  const hips = hipsFor(pitch), hipJ = qRot(tq(pitch), rig.local.L_Thigh);
  const T = trunkPoints(rig, hips, tq(pitch), tq(pitch + bend)), zs = (T.shoulder.L[2] + T.shoulder.R[2]) / 2;
  // the body's middle (between the hip joints and the shoulders) over the root origin
  const hipsZ = -(zs + hipJ[2]) / 2, kneeMid = hipsZ + hipJ[2], palmUnder = hipsZ + zs, palmMid = palmUnder + 0.1 * stroke;
  const crawlM = Math.max(stroke / BB_GAIT.maxDuty, BB_GAIT.crawl.mps / BB_GAIT.crawl.hz * rig.sizeK);
  const scuttleM = Math.min(stroke / BB_GAIT.minDuty, Math.max(1.6 * crawlM, BB_GAIT.scuttle.mps / BB_GAIT.scuttle.hz * rig.sizeK));
  const chestUp = qRot(tq(pitch + bend), Y);
  return {
    thigh, reach, pitch, bend, fwdDeg: fwd, backDeg: back, stroke, crawlM, scuttleM, crawlDuty: stroke / crawlM, scuttleDuty: stroke / scuttleM,
    hipsZ, hipsY: hips[1], kneeX, kneeMid, kneeFront: kneeMid + thigh * Math.sin(fwd * D2R),
    palmX, palmUnder, palmMid, palmFront: palmMid + stroke / 2,
    shoulderY, shoulderTop: wristUp + Math.sqrt(Math.max(0, (0.975 * reach) ** 2 - palmOut * palmOut)),
    sitM: thigh * Math.sin(clamp(BB_GAIT.maxHipFlexDeg - pitch - 4, 0, 16) * D2R),
    centreY: BB_BODY.centreUp * rig.sizeK,
    headPitch: Math.min(0, BB_GAIT.maxHeadExtDeg - 2 - (90 - Math.atan2(chestUp[1], chestUp[2]) * R2D)),
  };
}

// ---------------------------------------------------------------- the gaits
/**
 * One limb of a gait at its own phase `p` (0 = it lands): down for the first `duty` of the cycle, travelling back `stroke` from
 * `front`; then lifted (highest early: it is picked up, carried forward and reaches) and set down on its mark.
 */
function gaitContact(p: number, duty: number, front: number, stroke: number, lift: number, x: number): Contact & {down: boolean} {
  const ph = frac(p);
  if (ph < duty) return {x, z: front - stroke * (ph / duty), lift: 0, down: true};
  const u = (ph - duty) / (1 - duty);
  return {x, z: front - stroke + stroke * ss(0.04, 0.88, u), lift: lift * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.8), down: false};
}

/**
 * The crawl at cycle phase `phi` (0..1). Pair A = the LEFT hand + the RIGHT knee lands at 0, pair B = the right hand + the left knee
 * at 0.5; each limb is down for `duty` of the cycle, so below 0.5 the body hops between the pairs. The pelvis yaws with the stepping
 * knee and the shoulders against it (the spine sways side to side), the hips rock, the head stays on its line and nods with each plant.
 */
function gaitFrame(rig: BbRig, phi: number, fast: boolean): BbFrame {
  const m = rig.m, duty = fast ? m.scuttleDuty : m.crawlDuty, S = m.stroke, lead = BB_GAIT.handLead, ph = frac(phi);
  const w = TAU * ph, c = Math.cos(w), s = Math.sin(w);
  const kneeLift = (fast ? 0.3 : 0.16) * m.thigh, palmLift = (fast ? 0.2 : 0.13) * m.reach;
  const kR = gaitContact(ph, duty, m.kneeFront, S, kneeLift, -m.kneeX), kL = gaitContact(ph + 0.5, duty, m.kneeFront, S, kneeLift, m.kneeX);
  const pL = gaitContact(ph + lead, duty, m.palmFront, S, palmLift, m.palmX), pR = gaitContact(ph + lead + 0.5, duty, m.palmFront, S, palmLift, -m.palmX);
  // the right hip leads while the right knee is planted ahead (a yaw about the root's up: + turns the left side back)
  // (the pelvis tips up on the side of the swinging knee — a hip hike: + raises the left side — and shifts over the planted one)
  const yaw = (fast ? 5 : 7) * Math.cos(w - 0.3), hipsX = -0.1 * m.kneeX * s;
  let roll = (fast ? 3 : 4) * s;
  // the hips ride the planted knee; between two stances (a hop, or the hand-over of a hop-less crawl) they ease from where one knee
  // left them to where the next takes them, never lower than a knee still planted needs
  const o: Fours = {
    hipsX, hipsZ: m.hipsZ, hipsY: 0, pitch: 'fit', yaw, roll, bend: m.bend + (fast ? 3 : 2) * Math.cos(2 * w + 0.4), chestYaw: -(fast ? 4 : 6) * Math.cos(w + TAU * lead), chestRoll: (fast ? 2 : 3) * s,
    shoulderY: m.shoulderY * (1 + (fast ? 0.03 : 0.02) * Math.cos(2 * (w + TAU * lead))),
    knee: {L: kL, R: kR},
    palm: {L: {...pL, tilt: 24 * Math.min(1, pL.lift / palmLift)}, R: {...pR, tilt: 24 * Math.min(1, pR.lift / palmLift)}},
    head: [m.headPitch + (fast ? 2.5 : 2) * Math.cos(2 * w + 0.6), 1.5 * c, 3 * c],
    ankleLift: {L: 0.3 * rig.shin.L * Math.min(1, kL.lift / kneeLift), R: 0.3 * rig.shin.R * Math.min(1, kR.lift / kneeLift)},
  };
  const need = (side: BbSide, k: Contact): number => foursTrunk(rig, {...o, hipsY: side, knee: {...o.knee, [side]: k}}).hips[1];
  const half = ph < 0.5, hp = half ? ph : ph - 0.5, cur: BbSide = half ? 'R' : 'L', next: BbSide = half ? 'L' : 'R';
  const curK = half ? kR : kL, sx = (side: BbSide): number => (side === 'L' ? m.kneeX : -m.kneeX);
  const blendW = Math.max(0.5 - duty, 0.1), u = (hp - (0.5 - blendW)) / blendW;
  const heldK: Contact = curK.down ? curK : {x: sx(cur), z: m.kneeFront - S, lift: 0};
  // late in a stance the planted thigh lies far back (the hips want to be low) just as the other knee passes under its own hip joint
  // (which wants them high): the hike grows by what it takes to keep the planted knee ON the surface, and eases off with the hop
  const short = (r: number): number => {
    const T = foursTrunk(rig, {...o, roll: r, hipsY: cur, knee: {...o.knee, [cur]: heldK}});
    return T.hips[1] - hipsYFor(rig, tq(T.pitch, yaw, r), hipsX, m.hipsZ, cur, heldK);
  };
  if (short(roll) > 1e-5) {
    const sg = cur === 'R' ? 1 : -1;
    let lo = 0, hi = 12;
    if (short(roll + sg * hi) > 1e-5) lo = hi;
    else for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (short(roll + sg * mid) > 1e-5) lo = mid; else hi = mid; }
    roll += sg * hi * (u > 0 ? 1 - ss(0, 1, u) : 1);
    o.roll = roll;
  }
  const held = need(cur, heldK);
  let hipsY = held;
  if (u > 0) {
    const hop = clamp((hp - duty) / Math.max(1e-6, 0.5 - duty), 0, 1);
    hipsY = lerp(held, need(next, {x: sx(next), z: m.kneeFront, lift: 0}), ss(0, 1, u)) + (fast ? 0.07 : 0.04) * m.thigh * 4 * hop * (1 - hop);
    if (curK.down) hipsY = Math.max(hipsY, held);
  }
  return solveFours(rig, {...o, hipsY});
}

/** The settled stance: all four down under the body. */
function stance(rig: BbRig, o: Partial<Fours> = {}): Fours {
  const m = rig.m;
  return {
    hipsX: 0, hipsZ: m.hipsZ, hipsY: 'max', pitch: 'fit', yaw: 0, roll: 0, bend: m.bend, chestYaw: 0, chestRoll: 0, shoulderY: m.shoulderY,
    knee: {L: {x: m.kneeX, z: m.kneeMid, lift: 0}, R: {x: -m.kneeX, z: m.kneeMid, lift: 0}},
    palm: {L: {x: m.palmX, z: m.palmUnder, lift: 0}, R: {x: -m.palmX, z: m.palmUnder, lift: 0}},
    head: [m.headPitch, 0, 0], ...o,
  };
}

/** Settled: sitting back a little on straighter arms (the head rides higher), breathing, the head drifting about. */
function idleFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, w = TAU * t / BB_CLIPS.Idle.duration, breath = Math.sin(2 * w), sway = Math.sin(w);
  return solveFours(rig, stance(rig, {
    hipsX: 0.04 * m.kneeX * sway, shoulderY: lerp(m.shoulderY, m.shoulderTop, 0.75) * (1 + 0.012 * breath), yaw: 1.5 * sway, chestYaw: -2 * sway, chestRoll: 1.2 * Math.sin(w + 1),
    knee: {L: {x: m.kneeX, z: m.kneeMid + m.sitM, lift: 0}, R: {x: -m.kneeX, z: m.kneeMid + m.sitM, lift: 0}},
    head: [m.headPitch + 6 + 3 * Math.sin(w + 0.7), 14 * Math.sin(w + 2.1) + 5 * Math.sin(3 * w), 5 * Math.sin(2 * w + 0.4)],
  }));
}

/**
 * Stopped dead mid-stride: pair A (the left hand + the right knee) planted ahead, pair B behind, all four down, the body tense and
 * trembling. The freeze between two bursts; the actor mirrors it when pair B led.
 */
function poiseFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, w = TAU * t / BB_CLIPS.Poise.duration, g = 0.3 * m.stroke, tremble = Math.sin(5 * w);
  return solveFours(rig, stance(rig, {
    yaw: 5, roll: -1.5, chestYaw: -5, chestRoll: 1.5 + 0.4 * tremble, shoulderY: m.shoulderY * (1 + 0.006 * tremble),
    knee: {L: {x: m.kneeX, z: m.kneeFront - m.stroke / 2 - g, lift: 0}, R: {x: -m.kneeX, z: m.kneeFront - m.stroke / 2 + g, lift: 0}},
    palm: {L: {x: m.palmX, z: m.palmMid + g, lift: 0}, R: {x: -m.palmX, z: m.palmMid - g, lift: 0}},
    head: [m.headPitch + 2 + 0.8 * Math.sin(w), 0, 0],
  }));
}

/**
 * An all-fours pose with the hips sat back behind the knees by `want` degrees of thigh lean — or as far as the hip's flexion allows
 * under the pelvis' pitch (which the sitting itself changes a little: a few rounds settle it).
 */
function sitBack(rig: BbRig, o: Fours, pitchOf: (o: Fours) => number, want: number): Fours {
  const m = rig.m;
  let a = want;
  for (let i = 0; i < 3; i++) a = clamp(Math.min(want, BB_GAIT.maxHipFlexDeg - 4 - pitchOf({...o, hipsZ: m.hipsZ - m.thigh * Math.sin(a * D2R)})), 0, want);
  return {...o, hipsZ: m.hipsZ - m.thigh * Math.sin(a * D2R)};
}

/**
 * The pounce tell, in two beats. First the chest dips between the elbows and the hindquarters wiggle (as far back as the hip lets the
 * knees fold under a low chest); then it sinks onto its haunches — hips flexed to their limit, knees folded under — as the trunk rears,
 * the hands come off the floor cocked by the chest and the head snaps up at its target.
 */
function windupFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, u = clamp(t / BB_CLIPS.Windup.duration, 0, 1);
  const dip = 1 - Math.pow(1 - Math.min(1, u / 0.36), 3), rear = ss(0.46, 0.9, u);
  const wig = Math.sin(TAU * 8 * t) * ss(0.12, 0.3, u) * (1 - ss(0.62, 0.82, u));
  const low: Fours = stance(rig, {
    hipsX: 0.14 * m.kneeX * wig, yaw: 6 * wig, roll: 3 * wig, chestYaw: -3 * wig, bend: lerp(m.bend, 14, dip), shoulderY: m.shoulderY * lerp(1, 0.78, dip),
    palm: {L: {x: m.palmX * 1.08, z: m.palmUnder + 0.3 * m.stroke * dip, lift: 0}, R: {x: -m.palmX * 1.08, z: m.palmUnder + 0.3 * m.stroke * dip, lift: 0}},
    elbowOut: lerp(BB_GAIT.elbowOutDeg, 55, dip), head: [lerp(m.headPitch, 34, ss(0.02, 0.3, u)), 0, 5 * wig],
  });
  const lowSat = sitBack(rig, low, o => foursTrunk(rig, o).pitch, BB_GAIT.haunchDeg * dip);
  if (rear <= 0) return solveFours(rig, lowSat);
  const T = foursTrunk(rig, lowSat), pitch = lerp(T.pitch, Math.min(T.pitch, 62), rear), k = ss(0, 0.4, rear);
  const cocked = {flex: 52, abd: 24, elbow: 96, k};
  return solveFours(rig, sitBack(rig, {...low, pitch, bend: lerp(T.bend, -4, rear), free: {L: cocked, R: cocked}}, () => pitch, BB_GAIT.haunchDeg * Math.max(dip, rear)));
}

/**
 * The cackle. It sits up on its haunches — the trunk reared, the hands off the surface and flapping at its sides, the head thrown
 * back as far as the neck goes — and the whole upper body shakes with every "ha"; then it drops back onto its hands. Big enough to
 * read from across a room; nothing like the wind-up's low coil.
 */
function cackleFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, C = BB_GAIT.cackle, D = BB_CLIPS.Cackle.duration;
  const up = ss(0, 0.2, t) * (1 - ss(D - 0.3, D, t)), w = TAU * C.hz * t;
  const shake = ss(0.1, 0.24, t) * (1 - ss(D - 0.36, D - 0.12, t)), ha = Math.sin(w) * shake, beat = (0.5 - 0.5 * Math.cos(w)) * shake;
  const base = stance(rig), T = foursTrunk(rig, base);
  const pitch = lerp(T.pitch, Math.min(T.pitch, C.pitchDeg), up) + 3 * ha;
  const arm = (sg: number): ArmFk & {k: number} => ({flex: 30 + 12 * ha, abd: 40 + 9 * sg * Math.sin(w / 2) * shake + 6 * beat, elbow: 74 - 14 * ha, k: ss(0, 0.45, up)});
  return solveFours(rig, sitBack(rig, {
    ...base, hipsX: 0.06 * m.kneeX * Math.sin(w / 2) * shake, pitch, roll: 2.5 * Math.sin(w / 2) * shake, bend: lerp(T.bend, -6, up) + 4 * ha, chestRoll: -3 * Math.sin(w / 2) * shake,
    free: {L: arm(1), R: arm(-1)},
    head: [lerp(m.headPitch, 40, up) - 9 * beat, 0, 7 * Math.sin(w / 2) * shake],
  }, () => pitch, C.haunchDeg * up));
}

/** The airborne trunk: its middle over the root at the brain's body-centre height. */
function airHips(rig: BbRig, pitch: number, bend: number): V3 {
  const qP = tq(pitch), qC = tq(pitch + bend);
  const T = trunkPoints(rig, [0, 0, 0], qP, qC), hj = qRot(qP, rig.local.L_Thigh);
  return [0, rig.m.centreY - ((T.shoulder.L[1] + T.shoulder.R[1]) / 2 + hj[1]) / 2, -((T.shoulder.L[2] + T.shoulder.R[2]) / 2 + hj[2]) / 2];
}

/** The leap: out of the coil into a full stretch — arms thrown forward and apart, legs trailing, head up — then held, the limbs fluttering. */
function pounceFrame(rig: BbRig, t: number): BbFrame {
  const k = 1 - Math.pow(1 - clamp(t / 0.13, 0, 1), 2), fl = Math.sin(TAU * 6 * t) * ss(0.12, 0.22, t);
  const pitch = lerp(62, 58, k), bend = lerp(-4, -10, k);
  return clear(rig, solveFree(rig, {
    hips: airHips(rig, pitch, bend), pelvis: [pitch, 0, 0], bend, head: [lerp(20, 12, k), 0, 0],
    arm: {
      L: {flex: lerp(52, 150, k) + 3 * fl, abd: lerp(24, 35, k), elbow: lerp(96, 20, k) + 4 * fl},
      R: {flex: lerp(52, 150, k) - 3 * fl, abd: lerp(24, 35, k), elbow: lerp(96, 20, k) - 4 * fl},
    },
    leg: {
      L: {flex: lerp(100, -15, k) + 5 * fl, abd: lerp(14, 12, k), knee: lerp(124, 45, k) - 8 * fl, foot: 45},
      R: {flex: lerp(100, -15, k) - 5 * fl, abd: lerp(14, 12, k), knee: lerp(124, 45, k) + 8 * fl, foot: 45},
    },
  }));
}

/** Falling: belly down, limbs splayed and flailing against each other, the trunk rocking. */
function fallFrame(rig: BbRig, t: number): BbFrame {
  const w = TAU * t / BB_CLIPS.Fall.duration, s = Math.sin(w), c = Math.cos(w);
  const pitch = 80 + 4 * c;
  return clear(rig, solveFree(rig, {
    hips: airHips(rig, pitch, -6), pelvis: [pitch, 5 * s, 7 * s], bend: -6, chestYaw: -6 * s, chestRoll: -5 * s, head: [8 + 5 * c, 10 * s, 0],
    arm: {
      L: {flex: 95 + 30 * s, abd: 55 + 12 * c, elbow: 50 + 22 * c, toward: [-0.2, 1, 0.4]},
      R: {flex: 95 - 30 * s, abd: 55 - 12 * c, elbow: 50 - 22 * c, toward: [0.2, 1, 0.4]},
    },
    leg: {
      L: {flex: 22 - 26 * s, abd: 24 + 6 * c, knee: 62 + 26 * c, foot: 40},
      R: {flex: 22 + 26 * s, abd: 24 - 6 * c, knee: 62 - 26 * c, foot: 40},
    },
  }));
}

/**
 * Landing, driven by the seconds since it touched down (the phase may end early: a short drop cuts to the crawl from wherever this
 * is, so the scramble is front-loaded). Flat out first — belly and chest down, arms folded out beside the head, legs trailing spread —
 * a bounce; by 0.3 s the arms have pushed the chest up and the knees are drawn under, one after the other; then it stays low, shakes
 * its head and rises.
 */
function landFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, belly = rig.hit.torso * 0.95;
  const up = ss(0.08, 0.3, t), rise = ss(0.3, 0.7, t), bounce = Math.exp(-t / 0.045) * Math.cos(TAU * t / 0.15);
  // spread-eagle: the knees behind and outside the hips, far enough that the hip joints sit at belly height
  const lean = clamp((belly - (rig.kneeR.L + rig.kneeR.R) / 2) / m.thigh, 0.05, 0.9), run = Math.sqrt(1 - lean * lean) * m.thigh;
  const kneeAt = (sg: number, g: number): Contact => ({x: sg * lerp(m.kneeX + 0.12 * run, m.kneeX, g), z: lerp(m.kneeMid - 0.92 * run, m.kneeMid, g), lift: 0.14 * m.thigh * Math.sin(Math.PI * g)});
  const palmAt = (sg: number, g: number): Contact & {yaw: number} => ({
    x: sg * lerp(m.palmX + 0.7 * rig.upper.L, m.palmX, g), z: lerp(m.palmUnder + 1.0 * rig.fore.L, m.palmUnder, g), lift: 0.1 * m.reach * Math.sin(Math.PI * g), yaw: lerp(48, BB_GAIT.fingersOutDeg, g),
  });
  const gL = ss(0.1, 0.26, t), gR = ss(0.16, 0.34, t);
  const shake = Math.sin(TAU * 5.5 * t) * ss(0.34, 0.42, t) * (1 - ss(0.58, 0.72, t));
  return solveFours(rig, stance(rig, {
    roll: 4 * (gL - gR), chestRoll: -2 * (gL - gR), bend: lerp(0, m.bend, up),
    shoulderY: lerp(belly, m.shoulderY * lerp(0.82, 1, rise), up) * (1 - 0.12 * bounce * (1 - up)),
    knee: {L: kneeAt(1, gL), R: kneeAt(-1, gR)},
    palm: {L: palmAt(1, ss(0.06, 0.2, t)), R: palmAt(-1, ss(0.1, 0.26, t))}, elbowOut: lerp(80, BB_GAIT.elbowOutDeg, up),
    head: [lerp(m.headPitch - 18, m.headPitch, ss(0.04, 0.28, t)) - 10 * bounce * (1 - up), 18 * shake, 9 * shake],
  }));
}

/** The flinch: jolted back off one hand, the head snapped away, then down again. */
function hitFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, T = BB_CLIPS.Hit.duration, e = ss(0, 0.07, t) * (1 - ss(0.2, T, t)), late = ss(0.04, 0.14, t) * (1 - ss(0.2, T - 0.04, t));
  return solveFours(rig, stance(rig, {
    yaw: 4 * e, roll: 3 * e, chestYaw: 6 * e, chestRoll: 4 * e, shoulderY: m.shoulderY * (1 + 0.03 * e),
    knee: {L: {x: m.kneeX, z: m.kneeMid + 0.5 * m.sitM * e, lift: 0}, R: {x: -m.kneeX, z: m.kneeMid + 0.5 * m.sitM * e, lift: 0}},
    palm: {L: {x: m.palmX * 1.12, z: m.palmUnder, lift: 0}, R: {x: -m.palmX, z: m.palmUnder, lift: 0}},
    free: {R: {flex: 64, abd: 30, elbow: 80, k: late}},
    head: [m.headPitch - 6 * e, 30 * e, 12 * e],
  }));
}

/** The fallback death (no ragdoll): it sags and rolls onto its right side, limbs curling in. */
function deathFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, u = clamp(t / BB_CLIPS.Death.duration, 0, 1), k = ss(0.05, 0.75, u);
  const from = solveFours(rig, stance(rig));
  // lying on its right side (rolled about the root's forward axis), the trunk's middle over the root, resting on whatever is lowest
  const lying = solveFree(rig, {
    hips: [0, 0, m.hipsZ], pelvis: [86, 0, 82], bend: 22, head: [0, 0, 0],
    arm: {L: {flex: 48, abd: 6, elbow: 95}, R: {flex: 62, abd: 2, elbow: 78}},
    leg: {L: {flex: 62, abd: 4, knee: 104, foot: 30}, R: {flex: 78, abd: 1, knee: 92, foot: 30}},
  });
  // (the head is laid down by the trunk's roll: its own joints stay near neutral, the chin a little tucked)
  lying.rot.Neck = qAxis(X, 6);
  lying.rot.Head = qAxis(X, 8);
  lying.hips[1] -= lowest(rig, lying);
  return clear(rig, mixFrames(from, lying, k));
}

/** The pose of `clip` at time `t` (s; Crawl / Scuttle: `t / duration` is the cycle phase): the tables' frames, and the tests' oracle. */
export function bbPoseAt(rig: BbRig, clip: BbClipName, t: number): BbFrame {
  switch (clip) {
    case 'Idle': return idleFrame(rig, t);
    case 'Crawl': return gaitFrame(rig, t / BB_CLIPS.Crawl.duration, false);
    case 'Scuttle': return gaitFrame(rig, t / BB_CLIPS.Scuttle.duration, true);
    case 'Poise': return poiseFrame(rig, t);
    case 'Cackle': return cackleFrame(rig, t);
    case 'Windup': return windupFrame(rig, t);
    case 'Pounce': return pounceFrame(rig, t);
    case 'Fall': return fallFrame(rig, t);
    case 'Land': return landFrame(rig, t);
    case 'Hit': return hitFrame(rig, t);
    case 'Death': return deathFrame(rig, t);
  }
}

/** The gait pose at cycle phase `phi` (0..1): pair A (left hand + right knee) lands at 0, pair B at 0.5. */
export function bbGaitAt(rig: BbRig, phi: number, fast: boolean): BbFrame {
  return gaitFrame(rig, phi, fast);
}

/** Which limbs a gait has planted at cycle phase `phi`. */
export function bbGaitDown(rig: BbRig, phi: number, fast: boolean): {palm: Record<BbSide, boolean>; knee: Record<BbSide, boolean>} {
  const duty = fast ? rig.m.scuttleDuty : rig.m.crawlDuty, lead = BB_GAIT.handLead;
  return {palm: {L: frac(phi + lead) < duty, R: frac(phi + lead + 0.5) < duty}, knee: {R: frac(phi) < duty, L: frac(phi + 0.5) < duty}};
}

// ---------------------------------------------------------------- tables
const NJ = BB_ANIMATED.length;
/** Floats per table frame: every driven joint's quaternion, then the Hips position. */
export const BB_FRAME_FLOATS = NJ * 4 + 3;

/** One clip sampled evenly: `frames` + 1 rows (the last = the clip's end; a loop's last row equals its first). */
export interface BbClipTable { name: BbClipName; duration: number; loop: boolean; frames: number; data: Float32Array }

/** Every clip of one body model, and the numbers the actor plays them by. */
export interface BbClipSet {
  rig: BbRig;
  tables: Record<BbClipName, BbClipTable>;
  /** Metres per cycle (scale 1) and the stance share of each gear. */
  crawlM: number; scuttleM: number;
  crawlDuty: number; scuttleDuty: number;
}

function tableOf(rig: BbRig, name: BbClipName): BbClipTable {
  const C = BB_CLIPS[name], n = C.frames, data = new Float32Array((n + 1) * BB_FRAME_FLOATS);
  const prev: Q[] = [];
  for (let f = 0; f <= n; f++) {
    const p = bbPoseAt(rig, name, C.loop && f === n ? 0 : C.duration * f / n), at = f * BB_FRAME_FLOATS;
    for (let j = 0; j < NJ; j++) {
      let q = p.rot[BB_ANIMATED[j]] ?? qId();
      const pq = prev[j];
      if (pq && pq[0] * q[0] + pq[1] * q[1] + pq[2] * q[2] + pq[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      prev[j] = q;
      data.set(q, at + j * 4);
    }
    data.set(p.hips, at + NJ * 4);
  }
  return {name, duration: C.duration, loop: C.loop, frames: n, data};
}

/** Sample every clip of a rig (once per body model). */
export function buildBbClipSet(rig: BbRig): BbClipSet {
  const tables = {} as Record<BbClipName, BbClipTable>;
  for (const n of BB_CLIP_NAMES) tables[n] = tableOf(rig, n);
  return {rig, tables, crawlM: rig.m.crawlM, scuttleM: rig.m.scuttleM, crawlDuty: rig.m.crawlDuty, scuttleDuty: rig.m.scuttleDuty};
}

/**
 * The pose of a table at `u` (0..1 of the clip; a loop wraps, a one-shot holds its ends) into `out` (BB_FRAME_FLOATS: quaternions
 * normalised); `mirror` gives the same pose left <-> right. Allocation-free.
 */
export function sampleBbClip(t: BbClipTable, u: number, out: Float32Array, mirror = false): void {
  const n = t.frames, x = (t.loop ? u - Math.floor(u) : u < 0 ? 0 : u > 1 ? 1 : u) * n;
  const i = Math.min(n - 1, Math.floor(x)), k = x - i, a = i * BB_FRAME_FLOATS, b = a + BB_FRAME_FLOATS, d = t.data, m = mirror ? -1 : 1;
  for (let j = 0; j < NJ; j++) {
    const o = (mirror ? MIRROR_INDEX[j] : j) * 4, w = j * 4;
    // (the two rows' quaternions are sign-aligned when the table is built)
    const qx = d[a + o] + (d[b + o] - d[a + o]) * k, qy = d[a + o + 1] + (d[b + o + 1] - d[a + o + 1]) * k;
    const qz = d[a + o + 2] + (d[b + o + 2] - d[a + o + 2]) * k, qw = d[a + o + 3] + (d[b + o + 3] - d[a + o + 3]) * k;
    const l = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
    out[w] = qx * l; out[w + 1] = qy * l * m; out[w + 2] = qz * l * m; out[w + 3] = qw * l;
  }
  const h = NJ * 4;
  out[h] = (d[a + h] + (d[b + h] - d[a + h]) * k) * m;
  out[h + 1] = d[a + h + 1] + (d[b + h + 1] - d[a + h + 1]) * k;
  out[h + 2] = d[a + h + 2] + (d[b + h + 2] - d[a + h + 2]) * k;
}

/** A sampled table row as a frame (tests / the CPU renders). */
export function frameOfSample(row: ArrayLike<number>): BbFrame {
  const rot: Record<string, Q> = {};
  for (let j = 0; j < NJ; j++) rot[BB_ANIMATED[j]] = [row[j * 4], row[j * 4 + 1], row[j * 4 + 2], row[j * 4 + 3]];
  return {hips: [row[NJ * 4], row[NJ * 4 + 1], row[NJ * 4 + 2]], rot};
}

/** A table as a THREE.AnimationClip (every joint's quaternion track + the Hips translation, linear like the GLB clips). */
export function bbAnimationClip(set: BbClipSet, name: BbClipName): THREE.AnimationClip {
  const t = set.tables[name], n = t.frames + 1;
  const times = new Float32Array(n);
  for (let f = 0; f < n; f++) times[f] = t.duration * f / t.frames;
  const tracks: THREE.KeyframeTrack[] = BB_ANIMATED.map((joint, j) => {
    const v = new Float32Array(n * 4);
    for (let f = 0; f < n; f++) v.set(t.data.subarray(f * BB_FRAME_FLOATS + j * 4, f * BB_FRAME_FLOATS + j * 4 + 4), f * 4);
    return new THREE.QuaternionKeyframeTrack(`${joint}.quaternion`, times, v);
  });
  const hips = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) hips.set(t.data.subarray(f * BB_FRAME_FLOATS + NJ * 4, (f + 1) * BB_FRAME_FLOATS), f * 3);
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
  return new THREE.AnimationClip(name, t.duration, tracks);
}

/** One clip set per body model (keyed by its glTF scene: every actor of a body GLB clones that scene). */
const SETS = new WeakMap<object, BbClipSet | null>();

/**
 * The clip set of the body model whose template scene is `template`, read from a freshly built clone `root` (its bones still at
 * rest); built once per model, null when the rig does not match (the caller shows the bind pose). RNG-free.
 */
export function bbClipSetFor(template: object, root: THREE.Object3D, extras: BbExtras = {}): BbClipSet | null {
  let set = SETS.get(template);
  if (set === undefined) {
    const rig = bbRigOf(root, extras);
    set = rig ? buildBbClipSet(rig) : null;
    SETS.set(template, set);
  }
  return set;
}
