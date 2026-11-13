// Task studio-bb-production-20261112-234540-01 (lane ACTOR): BB's RUNTIME PROCEDURAL CLIPS. The four BB bodies (enemy-bb-*.glb) carry
// no baked animation: each is one skinned mesh in a STANDING bind pose on the shared 18-joint skeleton with identity rest rotations
// (tools/asset-pipeline/zombie/lib/skeleton.mjs JOINTS). Every pose the game shows is authored here, at load time, from that body's
// OWN bind joint positions — the ai/sprintGait.ts precedent (hand-authored periodic functions + analytic IK; no motion capture, no
// generation, no new asset), extended to a whole clip set:
//
//   Idle     settled on all fours, breathing, the head drifting                                    (loop)
//   Crawl    the slow gear: a diagonal-pair crawl (L hand + R knee, then R hand + L knee), one pair always down   (loop, by phase)
//   Scuttle  the fast gear: the same diagonal pairs with a short hop between them                  (loop, by phase)
//   Windup   the pounce tell: rocks back onto its haunches, chest low, a wiggle, head up           (BB_POUNCE.windupS)
//   Pounce   airborne: arms thrown forward and apart, legs trailing                                (held while it flies)
//   Fall     airborne without a leap: limbs splayed and flailing                                   (loop)
//   Land     a sprawl, then it gathers itself back onto all fours                                  (BB_POUNCE.landS; driven by phaseT)
//   Hit      a flinch                                                                              (one shot)
//   Death    curls onto its side (only shown when the ragdoll is unavailable)                      (one shot)
//
// PROPORTION-AGNOSTIC: nothing here is tuned to one body. Segment lengths, joint offsets and the contact points (palm, knee front, toe:
// the GLB's `enemyBb` extras, else ratios of the bind) drive every height, reach and stride. The all-fours poses are SOLVED, not keyed:
// the pelvis height from the planted knee (the thigh is one bone from the hip to the knee on the floor), the trunk bend from the height
// the arms can hold the shoulders at, the arms by 2-bone IK onto the planted palms, the head from the direction the face looks — so the
// palms and knees of a short-limbed big-headed baby and of a 2 m adult rig both land on the surface plane y = 0 (root space) and the body
// centre stays over the root origin (the BbPose contract: the root is the point ON the surface under the body centre).
//
// NO FOOT SLIDE: a planted palm / knee travels back exactly as far as the body moves forward. The stance stroke comes from the thigh
// (BB_GAIT.thighSwingDeg each way about vertical), so one cycle covers `cycleM` metres on a scale-1 body (Crawl: 2 strokes, Scuttle:
// 4 — its limbs are down a quarter of the cycle); the actor plays the cycle at speed / (cycleM x scale) cycles per second and shifts
// gear by the speed, so the limbs neither slide nor blur at 1.3 .. 4.8 m/s.
//
// The poses stay inside the asset contract's audited envelope (reference BB-ASSET-CONTRACT poseEnvelope: hip flexion -25..110, knee
// 0..135, shoulder flexion -30..170 / abduction 0..110, elbow 0..125, trunk bend -25..35, neck + head extension -30..75) —
// game/tests/bb-clips.test.ts measures every frame of every clip on several rigs. RNG-free: never draws from any stream.
//
// The clips are sampled once per body model into flat tables (BbClipSet: 17 joint quaternions + the Hips position per frame); the
// actor (ai/bbActor.ts) samples them without allocating. The same tables give THREE.AnimationClips on demand (bbAnimationClip).

import * as THREE from 'three';
import {BB_ASSET, BB_BODY, BB_POUNCE} from './bb';

export type V3 = [number, number, number];
export type Q = [number, number, number, number];
type Side = 'L' | 'R';
const SIDES: readonly Side[] = ['L', 'R'];
const sgn = (s: Side): number => (s === 'L' ? 1 : -1);

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
export const BB_CLIP_NAMES = ['Idle', 'Crawl', 'Scuttle', 'Windup', 'Pounce', 'Fall', 'Land', 'Hit', 'Death'] as const;
export type BbClipName = (typeof BB_CLIP_NAMES)[number];

/**
 * Seconds, looping and table frames of each clip. Crawl / Scuttle are driven by PHASE (0..1 of a cycle), not time: their `duration` is
 * the cycle at the reference pace `cycleM / duration` (m/s, scale 1) and only matters to bbAnimationClip.
 */
export const BB_CLIPS: Readonly<Record<BbClipName, {duration: number; loop: boolean; frames: number}>> = {
  Idle: {duration: 3.2, loop: true, frames: 48},
  Crawl: {duration: 0.3, loop: true, frames: 32},
  Scuttle: {duration: 0.2, loop: true, frames: 32},
  Windup: {duration: BB_POUNCE.windupS, loop: false, frames: 22},
  Pounce: {duration: 0.3, loop: false, frames: 12},
  Fall: {duration: 0.56, loop: true, frames: 16},
  Land: {duration: BB_POUNCE.landS, loop: false, frames: 30},
  Hit: {duration: 0.4, loop: false, frames: 16},
  Death: {duration: 0.9, loop: false, frames: 18},
};

/** The gait numbers (degrees / shares of a cycle); lengths come from the body. */
export const BB_GAIT = {
  /** The planted thigh swings this far each way about vertical: the stance stroke = 2 x thigh x sin. */
  thighSwingDeg: 40,
  /** Pelvis pitch from upright on all fours (hip flexion = this + the thigh's forward swing: 108 at most, the envelope is 110). */
  pelvisPitchDeg: 68,
  /** Stance share of a cycle per limb. Crawl: one diagonal pair is always down. Scuttle: a hop between the pairs. */
  crawlDuty: 0.5,
  scuttleDuty: 0.25,
  /** A hand lands this share of a cycle before its diagonal knee. */
  handLead: 0.05,
  /** The neck + head may extend this far from the chest (the audited envelope), and flex this far. */
  maxHeadExtDeg: 75,
  maxHeadFlexDeg: 30,
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

// ---------------------------------------------------------------- the body's rig
/** What the clips need of a body (model metres, bind pose). Per side where the body may differ left to right. */
export interface BbRig {
  /** Bind joint positions (model space) and rest translations (parent space). */
  bind: Record<string, V3>;
  local: Record<string, V3>;
  thigh: Record<Side, number>;
  shin: Record<Side, number>;
  upper: Record<Side, number>;
  fore: Record<Side, number>;
  /** Standing height (floor -> the top of the head). */
  heightM: number;
  /** heightM / BB_ASSET.heightM: the size of this body next to the contract's 0.85 m (1 on a real BB). */
  sizeK: number;
  /** Knee joint centre -> the skin in front of the knee (the knee joint rides this far above the surface). */
  kneeR: Record<Side, number>;
  /** Wrist -> the palm's skin centre / the fingertip, bind axes; the unit direction the palm faces. */
  palm: Record<Side, V3>;
  fingers: Record<Side, V3>;
  palmN: Record<Side, V3>;
  /** Ankle -> toe tip, bind axes. */
  toe: Record<Side, V3>;
  /** The skull: centre relative to the Head joint (bind axes) and its radius. */
  head: {centre: V3; radius: number};
  /** Gameplay hit radii (extras, else BB_ASSET x sizeK). */
  hit: {torso: number; arm: number; leg: number};
  /** The solved all-fours geometry every clip shares. */
  m: BbMetrics;
}

/** The all-fours geometry of a body (root space: +Y off the surface, +Z forward, the surface is y = 0). */
export interface BbMetrics {
  thigh: number; reach: number;
  /** A planted palm / knee travels this far back per stance (m). */
  stroke: number;
  /** Ground covered per cycle (m, scale 1): Crawl and Scuttle. */
  crawlM: number;
  scuttleM: number;
  /** Hips joint: neutral z, and y with the thighs vertical. */
  hipsZ: number; hipsY: number;
  /** |x| and neutral z of the knee contacts; |x| and stroke-centre z of the palm contacts. */
  kneeX: number; kneeZ: number;
  palmX: number; palmZ: number;
  /** Shoulder-line height the arms hold on all fours. */
  shoulderY: number;
  /** Trunk centre height in the air (the brain's BB_BODY.centreUp at this body's size). */
  centreY: number;
  /** Face elevation (deg) of the neutral crawl. */
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
  const per = (f: (s: Side) => number): Record<Side, number> => ({L: f('L'), R: f('R')});
  const thigh = per(s => seg(`${s}_Thigh`, `${s}_Shin`)), shin = per(s => seg(`${s}_Shin`, `${s}_Foot`));
  const upper = per(s => seg(`${s}_UpperArm`, `${s}_Forearm`)), fore = per(s => seg(`${s}_Forearm`, `${s}_Hand`));
  if (SIDES.some(s => thigh[s] < 1e-3 || shin[s] < 1e-3 || upper[s] < 1e-3 || fore[s] < 1e-3)) return null;
  const heightM = num(extras.heightM) ?? bind.Head[1] * 1.3;
  if (!(heightM > 0.05)) return null;
  const sizeK = heightM / BB_ASSET.heightM;
  const H = extras.hitRadii ?? {}, D = BB_ASSET.hitRadii;
  const hit = {torso: num(H.torso) ?? D.torso * sizeK, arm: num(H.arm) ?? D.arm * sizeK, leg: num(H.leg) ?? D.leg * sizeK};
  const radius = num(extras.head?.radius) ?? BB_ASSET.headRadius * sizeK;
  const hc = v3(extras.head?.centre);
  const head = {centre: hc ? sub(hc, bind.Head) : [0, Math.max(0.3 * radius, heightM - bind.Head[1] - radius), 0.15 * radius] as V3, radius};
  const palm = {} as Record<Side, V3>, fingers = {} as Record<Side, V3>, palmN = {} as Record<Side, V3>, toe = {} as Record<Side, V3>, kneeR = {} as Record<Side, number>;
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
  const rig: BbRig = {bind, local, thigh, shin, upper, fore, heightM, sizeK, kneeR, palm, fingers, palmN, toe, head, hit, m: null as unknown as BbMetrics};
  rig.m = metricsOf(rig);
  return Number.isFinite(rig.m.hipsY + rig.m.shoulderY + rig.m.hipsZ + rig.m.stroke) ? rig : null;
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
export function bbContacts(rig: BbRig, f: BbFrame): {palm: Record<Side, V3>; knee: Record<Side, V3>; toe: Record<Side, V3>; head: {c: V3; r: number}} {
  const w = bbWorld(rig, f);
  const side = (fn: (s: Side) => V3): Record<Side, V3> => ({L: fn('L'), R: fn('R')});
  return {
    palm: side(s => add(w.pos[`${s}_Hand`], qRot(w.rot[`${s}_Hand`], rig.palm[s]))),
    knee: side(s => add(w.pos[`${s}_Shin`], [0, -rig.kneeR[s], 0])),
    toe: side(s => add(w.pos[`${s}_Foot`], qRot(w.rot[`${s}_Foot`], rig.toe[s]))),
    head: {c: add(w.pos.Head, qRot(w.rot.Head, rig.head.centre)), r: rig.head.radius},
  };
}

/** The joint angles of a frame in the asset contract's terms (degrees from the bind; the envelope the skins were audited over). */
export interface BbAngles {
  hipFlexion: Record<Side, number>; hipAbduction: Record<Side, number>; kneeFlexion: Record<Side, number>;
  shoulderFlexion: Record<Side, number>; shoulderAbduction: Record<Side, number>; elbowFlexion: Record<Side, number>;
  /** Chest against pelvis: forward bend (+), and the angle of what is left (twist + side bend together). */
  trunkBend: number; trunkTurn: number;
  /** Head against chest: extension (+ = tipped back), and how far the face is turned off the chest's mid-plane. */
  headExtension: number; headTurn: number;
}
export function bbAngles(rig: BbRig, f: BbFrame): BbAngles {
  const w = bbWorld(rig, f);
  const dir = (a: string, b: string): V3 => norm(sub(w.pos[b], w.pos[a]));
  const per = (fn: (s: Side) => number): Record<Side, number> => ({L: fn('L'), R: fn('R')});
  const inFrame = (q: Q, d: V3): V3 => qRot(qInv(q), d);
  const bindDir = (a: string, b: string): V3 => norm(sub(rig.bind[b], rig.bind[a]));
  // a limb's swing from where it hangs in the bind, in its parent's frame: flexion in the sagittal plane, abduction out of it
  const swing = (parent: string, a: string, b: string, s: Side): [number, number] => {
    const d = inFrame(w.rot[parent], dir(a, b)), d0 = bindDir(a, b);
    const flex = (Math.atan2(d[2], -d[1]) - Math.atan2(d0[2], -d0[1])) * R2D;
    return [((flex + 540) % 360) - 180, Math.asin(clamp(sgn(s) * d[0], -1, 1)) * R2D];
  };
  const bend = (a: string, b: string, c: string): number => Math.acos(clamp(dot(dir(a, b), dir(b, c)), -1, 1)) * R2D - Math.acos(clamp(dot(bindDir(a, b), bindDir(b, c)), -1, 1)) * R2D;
  const rel = qMul(qInv(w.rot.Hips), w.rot.Chest), up = qRot(rel, Y);
  const trunkBend = Math.atan2(up[2], up[1]) * R2D;
  const rest = qMul(qInv(qAxis(X, trunkBend)), rel);
  const face = qRot(qMul(qInv(w.rot.Chest), w.rot.Head), Z);
  return {
    hipFlexion: per(s => swing('Hips', `${s}_Thigh`, `${s}_Shin`, s)[0]),
    hipAbduction: per(s => swing('Hips', `${s}_Thigh`, `${s}_Shin`, s)[1]),
    kneeFlexion: per(s => bend(`${s}_Thigh`, `${s}_Shin`, `${s}_Foot`)),
    shoulderFlexion: per(s => { const d = inFrame(w.rot.Chest, dir(`${s}_UpperArm`, `${s}_Forearm`)); return Math.atan2(d[2], -d[1]) * R2D; }),
    shoulderAbduction: per(s => Math.asin(clamp(sgn(s) * inFrame(w.rot.Chest, dir(`${s}_UpperArm`, `${s}_Forearm`))[0], -1, 1)) * R2D),
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
interface Fours {
  hipsX: number; hipsZ: number;
  /** Hips height: given, or solved so that side's knee (or both) rests on its contact. */
  hipsY: number | Side | 'both';
  /** Pelvis in root space: pitch from upright, yaw, roll (deg). */
  pelvis: [number, number, number];
  /** The chest's yaw / roll in root space; its pitch is solved from shoulderY. */
  chestYaw: number; chestRoll: number;
  /** Height the shoulder line is held at. */
  shoulderY: number;
  knee: Record<Side, Contact>;
  /** Palms; `yaw` turns the fingers outward (deg), `tilt` lifts the fingertips (deg, a lifted hand). */
  palm: Record<Side, Contact & {yaw?: number; tilt?: number}>;
  /** Elbows point out and this far back (deg from straight out). */
  elbowBack?: number;
  /** The face in root space: elevation (+ up), yaw, roll (deg). */
  head: [number, number, number];
  /** Extra ankle height per side (a kicked-up shin). */
  ankleLift?: Record<Side, number>;
}

function trunkPoints(rig: BbRig, hips: V3, qP: Q, qC: Q): {qS: Q; chest: V3; shoulder: Record<Side, V3>} {
  const qS = qSlerp(qP, qC, 0.5);
  const chest = add(add(hips, qRot(qP, rig.local.Spine)), qRot(qS, rig.local.Chest));
  return {qS, chest, shoulder: {L: add(chest, qRot(qC, rig.local.L_UpperArm)), R: add(chest, qRot(qC, rig.local.R_UpperArm))}};
}

/** Hips height that puts side `s`'s knee joint on its contact (the thigh is one bone from the hip joint to the knee). */
function hipsYFor(rig: BbRig, qP: Q, hx: number, hz: number, s: Side, c: Contact): number {
  const o = qRot(qP, rig.local[`${s}_Thigh`]);
  const dx = hx + o[0] - c.x, dz = hz + o[2] - c.z, t = rig.thigh[s];
  return rig.kneeR[s] + c.lift - o[1] + Math.sqrt(Math.max(0, t * t - dx * dx - dz * dz));
}

/** Neck + Head local rotations putting the face at (elevation, yaw, roll) in root space, inside the neck's envelope against the chest. */
function headRot(qChestW: Q, pitch: number, yaw: number, roll: number): {Neck: Q; Head: Q} {
  let rel = qMul(qInv(qChestW), qMul(qAxis(Y, yaw), qMul(qAxis(X, -pitch), qAxis(Z, roll))));
  const face = qRot(rel, Z), ext = Math.atan2(face[1], face[2]) * R2D;
  // (rotation about the chest's +X by +a tips the face forward / down: back inside the envelope)
  if (ext > BB_GAIT.maxHeadExtDeg) rel = qMul(qAxis(X, ext - BB_GAIT.maxHeadExtDeg), rel);
  else if (ext < -BB_GAIT.maxHeadFlexDeg) rel = qMul(qAxis(X, ext + BB_GAIT.maxHeadFlexDeg), rel);
  const neck = qSlerp(qId(), rel, 0.42);
  return {Neck: neck, Head: qMul(qInv(neck), rel)};
}

/** A leg from its thigh direction and shin direction (root space), bent about `hinge`; the foot pointed by `footDeg`. */
function setLeg(rig: BbRig, rot: Record<string, Q>, qP: Q, s: Side, dT: V3, dS: V3, hinge: V3, footDeg: number): void {
  const b = rig.bind;
  const dT0 = norm(sub(b[`${s}_Shin`], b[`${s}_Thigh`])), dS0 = norm(sub(b[`${s}_Foot`], b[`${s}_Shin`]));
  const Rt = frameRot(dT0, X, dT, hinge), Rs = frameRot(dS0, X, dS, hinge);
  rot[`${s}_Thigh`] = qMul(qInv(qP), Rt);
  rot[`${s}_Shin`] = qMul(qInv(Rt), Rs);
  rot[`${s}_Foot`] = qAxis(X, footDeg);
}

/** An arm from its upper-arm and forearm directions (root space; the elbow's hinge is their normal); the hand's world rotation or none. */
function setArm(rig: BbRig, rot: Record<string, Q>, qC: Q, s: Side, dU: V3, dF: V3, hinge: V3, hand: Q | null): void {
  const b = rig.bind;
  const dU0 = norm(sub(b[`${s}_Forearm`], b[`${s}_UpperArm`])), dF0 = norm(sub(b[`${s}_Hand`], b[`${s}_Forearm`]));
  const hU0 = perp(cross(dU0, Z), dU0, X), hF0 = perp(cross(dF0, Z), dF0, X);
  const Ru = frameRot(dU0, hU0, dU, hinge), Rf = frameRot(dF0, hF0, dF, hinge);
  rot[`${s}_UpperArm`] = qMul(qInv(qC), Ru);
  rot[`${s}_Forearm`] = qMul(qInv(Ru), Rf);
  rot[`${s}_Hand`] = hand ? qMul(qInv(Rf), hand) : qId();
}

/**
 * All fours from its contacts: the pelvis over the planted knee(s), the trunk bent until the shoulders sit where the arms can hold
 * them, each arm by 2-bone IK onto its palm (elbows out, so the flat hand needs no wrist twist), each thigh aimed at its knee with the
 * shin lying back along the surface, the head turned to where the face looks.
 */
function solveFours(rig: BbRig, o: Fours): BbFrame {
  const rot: Record<string, Q> = {};
  const qP = tq(o.pelvis[0], o.pelvis[1], o.pelvis[2]);
  const hy = typeof o.hipsY === 'number' ? o.hipsY
    : o.hipsY === 'both' ? (hipsYFor(rig, qP, o.hipsX, o.hipsZ, 'L', o.knee.L) + hipsYFor(rig, qP, o.hipsX, o.hipsZ, 'R', o.knee.R)) / 2
      : hipsYFor(rig, qP, o.hipsX, o.hipsZ, o.hipsY, o.knee[o.hipsY]);
  const hips: V3 = [o.hipsX, hy, o.hipsZ];
  // the trunk: bend the chest against the pelvis until the shoulder line is at its height (more bend = lower), inside the envelope
  const shoulderAt = (bend: number): number => { const t = trunkPoints(rig, hips, qP, tq(o.pelvis[0] + bend, o.chestYaw, o.chestRoll)); return (t.shoulder.L[1] + t.shoulder.R[1]) / 2; };
  let lo = -24, hi = 34;
  if (shoulderAt(lo) <= o.shoulderY) hi = lo;
  else if (shoulderAt(hi) >= o.shoulderY) lo = hi;
  else for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (shoulderAt(mid) > o.shoulderY) lo = mid; else hi = mid; }
  const qC = tq(o.pelvis[0] + (lo + hi) / 2, o.chestYaw, o.chestRoll);
  const T = trunkPoints(rig, hips, qP, qC);
  rot.Hips = qP;
  rot.Spine = qMul(qInv(qP), T.qS);
  rot.Chest = qMul(qInv(T.qS), qC);
  Object.assign(rot, headRot(qC, o.head[0], o.head[1], o.head[2]));
  for (const s of SIDES) {
    const sg = sgn(s);
    // --- the leg: the thigh from the hip joint to the knee joint over its contact; the shin back along the surface
    const hj = add(hips, qRot(qP, rig.local[`${s}_Thigh`])), kc = o.knee[s];
    const dT = norm(sub([kc.x, rig.kneeR[s] + kc.lift, kc.z], hj));
    const knee = add(hj, mul(dT, rig.thigh[s]));
    const ankleY = Math.min(knee[1], 0.6 * rig.kneeR[s] + kc.lift * 0.5 + (o.ankleLift?.[s] ?? 0));
    const run = Math.sqrt(Math.max(1e-8, rig.shin[s] ** 2 - (knee[1] - ankleY) ** 2));
    const dS = norm(sub([knee[0], ankleY, knee[2] - run], knee));
    setLeg(rig, rot, qP, s, dT, dS, perp(cross(dT, dS), dT, X), 62);
    // --- the arm: the flat hand on its contact (fingers forward, a little out), the wrist above it, the elbow out and back
    const pc = o.palm[s], yaw = (pc.yaw ?? 14) * D2R * sg, tilt = (pc.tilt ?? 0) * D2R;
    const fwd: V3 = [Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)];
    const Rh = frameRot(norm(rig.fingers[s]), rig.palmN[s], fwd, [0, -1, 0]);
    const S = T.shoulder[s], a = rig.upper[s], c = rig.fore[s];
    let wrist = sub([pc.x, pc.lift, pc.z], qRot(Rh, rig.palm[s]));
    let d = len(sub(wrist, S));
    const u = norm(sub(wrist, S));
    const dc = clamp(d, Math.abs(a - c) + 1e-4, (a + c) * 0.999);
    if (dc !== d) { d = dc; wrist = add(S, mul(u, d)); }
    const eb = (o.elbowBack ?? 24) * D2R;
    const v = perp([sg * Math.cos(eb), 0.1, -Math.sin(eb)], u, [sg, 0, 0]);
    const cosA = clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = add(S, add(mul(u, a * cosA), mul(v, a * sinA)));
    setArm(rig, rot, qC, s, norm(sub(elbow, S)), norm(sub(wrist, elbow)), norm(cross(v, u)), Rh);
  }
  return {hips, rot};
}

// ---------------------------------------------------------------- free (airborne / lying) poses
interface ArmFk { flex: number; abd: number; elbow: number; /** The elbow folds toward this chest-frame direction. */ toward?: V3 }
interface LegFk { flex: number; abd: number; knee: number; foot?: number }
interface Free {
  hips: V3;
  pelvis: [number, number, number];
  /** Chest against pelvis: forward bend; and its yaw / roll in root space. */
  bend: number; chestYaw?: number; chestRoll?: number;
  head: [number, number, number];
  arm: Record<Side, ArmFk>;
  leg: Record<Side, LegFk>;
}
/** A limb direction from where it hangs: `flex` forward in the sagittal plane, `abd` out to its side (deg), in its parent's frame. */
const hang = (sg: number, flex: number, abd: number): V3 => [sg * Math.sin(abd * D2R), -Math.cos(abd * D2R) * Math.cos(flex * D2R), Math.cos(abd * D2R) * Math.sin(flex * D2R)];

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
    const sg = sgn(s), L = o.leg[s], A = o.arm[s];
    const dT = qRot(qP, hang(sg, L.flex, L.abd));
    const hx = perp(qRot(qP, X), dT, X), k = L.knee * D2R;
    const dS = add(mul(dT, Math.cos(k)), mul(cross(hx, dT), Math.sin(k)));
    setLeg(rig, rot, qP, s, dT, norm(dS), hx, L.foot ?? 30);
    const dU = qRot(qC, hang(sg, A.flex, A.abd));
    const v = perp(qRot(qC, A.toward ?? [-0.3 * sg, 0.2, 1]), dU, qRot(qC, Z)), e = A.elbow * D2R;
    setArm(rig, rot, qC, s, dU, norm(add(mul(dU, Math.cos(e)), mul(v, Math.sin(e)))), norm(cross(dU, v)), null);
  }
  return {hips: o.hips, rot};
}

/** Joint-wise blend of two frames (shortest arc). */
function mixFrames(a: BbFrame, b: BbFrame, t: number): BbFrame {
  const rot: Record<string, Q> = {};
  for (const n of BB_ANIMATED) rot[n] = qSlerp(a.rot[n] ?? qId(), b.rot[n] ?? qId(), t);
  return {hips: [lerp(a.hips[0], b.hips[0], t), lerp(a.hips[1], b.hips[1], t), lerp(a.hips[2], b.hips[2], t)], rot};
}

// ---------------------------------------------------------------- the body's all-fours geometry
function metricsOf(rig: BbRig): BbMetrics {
  const avg = (r: Record<Side, number>): number => (r.L + r.R) / 2;
  const thigh = avg(rig.thigh), reach = avg(rig.upper) + avg(rig.fore), kneeR = avg(rig.kneeR);
  const stroke = 2 * thigh * Math.sin(BB_GAIT.thighSwingDeg * D2R);
  const qP = tq(BB_GAIT.pelvisPitchDeg);
  const hipJ = qRot(qP, rig.local.L_Thigh), hipHalf = Math.abs(rig.local.L_Thigh[0] - rig.local.R_Thigh[0]) / 2;
  const shoulderHalf = Math.abs(rig.bind.L_UpperArm[0] - rig.bind.R_UpperArm[0]) / 2;
  // thighs vertical: the hip joints one thigh above the knee joints
  const hipsY = kneeR + thigh - hipJ[1];
  // the flat hand: how far the wrist rides above the palm's contact
  const yaw = 14 * D2R, Rh = frameRot(norm(rig.fingers.L), rig.palmN.L, [Math.sin(yaw), 0, Math.cos(yaw)], [0, -1, 0]);
  const wristUp = -qRot(Rh, rig.palm.L)[1];
  // the shoulders as high as the arms can hold them over the whole hand stroke (centred a little ahead of the shoulder), elbows soft
  const bias = 0.12 * stroke, palmOut = 0.1 * avg(rig.upper);
  const far = stroke / 2 + bias;
  const shoulderY = wristUp + Math.sqrt(Math.max((0.45 * reach) ** 2, (0.95 * reach) ** 2 - far * far - palmOut * palmOut));
  const m: BbMetrics = {
    thigh, reach, stroke, crawlM: stroke / BB_GAIT.crawlDuty, scuttleM: stroke / BB_GAIT.scuttleDuty,
    hipsZ: 0, hipsY, kneeX: hipHalf * 1.2 + 0.25 * kneeR, kneeZ: 0, palmX: shoulderHalf + palmOut, palmZ: 0, shoulderY,
    centreY: BB_BODY.centreUp * rig.sizeK, headPitch: 0,
  };
  rig.m = m;
  // the neutral stance with the Hips over the origin, then shifted so that the trunk's middle is: hips z, knees under the hip joints,
  // the palm stroke centred ahead of the shoulders
  const probe = solveFours(rig, {
    hipsX: 0, hipsZ: 0, hipsY, pelvis: [BB_GAIT.pelvisPitchDeg, 0, 0], chestYaw: 0, chestRoll: 0, shoulderY,
    knee: {L: {x: m.kneeX, z: hipJ[2], lift: 0}, R: {x: -m.kneeX, z: hipJ[2], lift: 0}},
    palm: {L: {x: m.palmX, z: 0.3, lift: 0}, R: {x: -m.palmX, z: 0.3, lift: 0}}, head: [0, 0, 0],
  });
  const w = bbWorld(rig, probe), zs = (w.pos.L_UpperArm[2] + w.pos.R_UpperArm[2]) / 2, zh = hipJ[2];
  m.hipsZ = -(zs + zh) / 2;
  m.kneeZ = zh + m.hipsZ;
  m.palmZ = zs + m.hipsZ + bias;
  // the face as far up as the neck allows over a level chest, a little under the horizon at most (eyes on what is ahead)
  const chestUp = qRot(w.rot.Chest, Y);
  m.headPitch = Math.min(4, Math.atan2(chestUp[1], chestUp[2]) * R2D - 90 + BB_GAIT.maxHeadExtDeg - 2);
  return m;
}

// ---------------------------------------------------------------- the gaits
/**
 * One limb of a gait at its own phase `p` (0 = it lands): down for the first `duty` of the cycle, travelling back `stroke` from
 * `front`; then lifted (`lift` at its highest, early: it is dragged off the surface) and carried forward, arriving a little early and
 * hanging over its mark before it lands (the reach).
 */
function gaitContact(p: number, duty: number, front: number, stroke: number, lift: number, x: number): Contact & {down: boolean} {
  const ph = frac(p);
  if (ph < duty) return {x, z: front - stroke * (ph / duty), lift: 0, down: true};
  const u = (ph - duty) / (1 - duty);
  return {x, z: front - stroke + stroke * ss(0.04, 0.86, u), lift: lift * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.8), down: false};
}

/**
 * The crawl at cycle phase `phi` (0..1). Pair A = the LEFT hand + the RIGHT knee lands at 0, pair B = the right hand + the left knee
 * at 0.5; `fast` = the Scuttle (each limb down a quarter of the cycle, a hop between the pairs). The pelvis yaws with the stepping
 * knee and the shoulders against it (the spine sways side to side), the hips rock toward the lifted knee, the head stays on its line
 * and nods with each plant.
 */
function gaitFrame(rig: BbRig, phi: number, fast: boolean): BbFrame {
  const m = rig.m, duty = fast ? BB_GAIT.scuttleDuty : BB_GAIT.crawlDuty, S = m.stroke, lead = BB_GAIT.handLead;
  const w = TAU * phi, c = Math.cos(w), s = Math.sin(w);
  const kneeLift = (fast ? 0.2 : 0.11) * m.thigh, palmLift = (fast ? 0.3 : 0.2) * m.reach * 0.5;
  const kR = gaitContact(phi, duty, m.kneeZ + S / 2, S, kneeLift, -m.kneeX), kL = gaitContact(phi + 0.5, duty, m.kneeZ + S / 2, S, kneeLift, m.kneeX);
  const pL = gaitContact(phi + lead, duty, m.palmZ + S / 2, S, palmLift, m.palmX), pR = gaitContact(phi + lead + 0.5, duty, m.palmZ + S / 2, S, palmLift, -m.palmX);
  // the right hip is forward while the right knee is planted ahead (yaw about the root's up: + turns the left side back)
  const yawP = (fast ? 6 : 9) * Math.cos(w - (fast ? 0.5 : 0)), yawC = -(fast ? 5 : 8) * Math.cos(w + TAU * lead);
  const pelvis: [number, number, number] = [BB_GAIT.pelvisPitchDeg + (fast ? 2.5 : 1.5) * Math.cos(2 * w), yawP, -(fast ? 2.5 : 4) * s];
  const hipsX = -0.12 * m.kneeX * s;
  const qP = tq(pelvis[0], pelvis[1], pelvis[2]);
  let hipsY: number;
  if (kR.down) hipsY = hipsYFor(rig, qP, hipsX, m.hipsZ, 'R', kR);
  else if (kL.down) hipsY = hipsYFor(rig, qP, hipsX, m.hipsZ, 'L', kL);
  else {
    // the hop: from where the last knee left the surface to where the next one meets it, a small arc between
    const ph = frac(phi), half = ph < 0.5, u = ((half ? ph : ph - 0.5) - duty) / (0.5 - duty);
    const end: Contact = {x: half ? -m.kneeX : m.kneeX, z: m.kneeZ - S / 2, lift: 0}, start: Contact = {x: half ? m.kneeX : -m.kneeX, z: m.kneeZ + S / 2, lift: 0};
    hipsY = lerp(hipsYFor(rig, qP, hipsX, m.hipsZ, half ? 'R' : 'L', end), hipsYFor(rig, qP, hipsX, m.hipsZ, half ? 'L' : 'R', start), ss(0, 1, u)) + 0.05 * m.thigh * 4 * u * (1 - u);
  }
  return solveFours(rig, {
    hipsX, hipsZ: m.hipsZ, hipsY, pelvis, chestYaw: yawC, chestRoll: (fast ? 2 : 3) * s,
    shoulderY: m.shoulderY * (1 + (fast ? 0.035 : 0.02) * Math.cos(2 * (w + TAU * lead))),
    knee: {L: kL, R: kR}, palm: {L: {...pL, tilt: pL.down ? 0 : 22 * Math.min(1, pL.lift / palmLift)}, R: {...pR, tilt: pR.down ? 0 : 22 * Math.min(1, pR.lift / palmLift)}},
    head: [m.headPitch + (fast ? 3 : 2) * Math.cos(2 * w + 0.6), -0.25 * yawC, 3 * c],
    ankleLift: {L: kL.down ? 0 : 0.25 * rig.shin.L * Math.min(1, kL.lift / kneeLift), R: kR.down ? 0 : 0.25 * rig.shin.R * Math.min(1, kR.lift / kneeLift)},
  });
}

/** The settled stance: all four down, hips a little back of the knees. */
function stance(rig: BbRig, o: Partial<Fours> = {}): Fours {
  const m = rig.m;
  return {
    hipsX: 0, hipsZ: m.hipsZ - 0.1 * m.stroke, hipsY: 'both', pelvis: [BB_GAIT.pelvisPitchDeg, 0, 0], chestYaw: 0, chestRoll: 0, shoulderY: m.shoulderY,
    knee: {L: {x: m.kneeX, z: m.kneeZ, lift: 0}, R: {x: -m.kneeX, z: m.kneeZ, lift: 0}},
    palm: {L: {x: m.palmX, z: m.palmZ, lift: 0}, R: {x: -m.palmX, z: m.palmZ, lift: 0}},
    head: [m.headPitch, 0, 0], ...o,
  };
}

function idleFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, w = TAU * t / BB_CLIPS.Idle.duration;
  const breath = Math.sin(2 * w), sway = Math.sin(w);
  return solveFours(rig, stance(rig, {
    hipsX: 0.04 * m.kneeX * sway, shoulderY: m.shoulderY * (1 + 0.018 * breath), pelvis: [BB_GAIT.pelvisPitchDeg + 0.8 * breath, 1.5 * sway, 0],
    chestYaw: -2 * sway, chestRoll: 1.2 * Math.sin(w + 1),
    head: [m.headPitch - 3 + 3 * Math.sin(w + 0.7), 14 * Math.sin(w + 2.1) + 5 * Math.sin(3 * w), 5 * Math.sin(2 * w + 0.4)],
  }));
}

/**
 * The pounce tell. It rocks back onto its haunches (the hips sink behind the planted knees: hip ~108, knee ~135), the chest drops
 * between the planted hands (elbows out), the head comes up; then it holds, wiggling its hindquarters, and coils a last time.
 */
function windupFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, u = clamp(t / BB_CLIPS.Windup.duration, 0, 1);
  const rock = 1 - Math.pow(1 - Math.min(1, u / 0.5), 3), coil = ss(0.86, 1, u);
  const wig = Math.sin(TAU * 9 * t) * ss(0.3, 0.5, u) * (1 - ss(0.85, 0.95, u));
  const back = m.thigh * Math.sin(50 * D2R) * rock * (1 - 0.12 * coil);
  return solveFours(rig, stance(rig, {
    hipsX: 0.1 * m.kneeX * wig, hipsZ: m.hipsZ - 0.1 * m.stroke - back, hipsY: 'both',
    pelvis: [lerp(BB_GAIT.pelvisPitchDeg, 58, rock), 5 * wig, 2 * wig], chestYaw: -2 * wig, chestRoll: 0,
    shoulderY: m.shoulderY * lerp(1, 0.58, rock) * (1 - 0.06 * coil),
    knee: {L: {x: m.kneeX * 1.15, z: m.kneeZ, lift: 0}, R: {x: -m.kneeX * 1.15, z: m.kneeZ, lift: 0}},
    palm: {L: {x: m.palmX * 1.1, z: m.palmZ + 0.05 * m.reach, lift: 0, yaw: 22}, R: {x: -m.palmX * 1.1, z: m.palmZ + 0.05 * m.reach, lift: 0, yaw: 22}},
    elbowBack: 34,
    head: [lerp(m.headPitch, 28, ss(0, 0.3, u)), 0, 4 * wig],
  }));
}

/** The airborne trunk: prone over the root, its middle at the brain's body-centre height. */
function airHips(rig: BbRig, pitch: number, bend: number): V3 {
  const qP = tq(pitch), qC = tq(pitch + bend);
  const T = trunkPoints(rig, [0, 0, 0], qP, qC), hj = qRot(qP, rig.local.L_Thigh);
  const mid: V3 = [0, ((T.shoulder.L[1] + T.shoulder.R[1]) / 2 + hj[1]) / 2, ((T.shoulder.L[2] + T.shoulder.R[2]) / 2 + hj[2]) / 2];
  return [0, rig.m.centreY - mid[1], -mid[2]];
}

/** The leap: out of the coil into a full stretch — arms thrown forward and apart, legs trailing, head up — then held, the limbs fluttering. */
function pounceFrame(rig: BbRig, t: number): BbFrame {
  const k = 1 - Math.pow(1 - clamp(t / 0.13, 0, 1), 2), fl = Math.sin(TAU * 7 * t) * ss(0.12, 0.2, t);
  const pitch = lerp(66, 80, k), bend = lerp(20, -10, k);
  return solveFree(rig, {
    hips: airHips(rig, pitch, bend), pelvis: [pitch, 0, 0], bend, head: [lerp(10, 24, k), 0, 0],
    arm: {
      L: {flex: lerp(70, 150, k) + 3 * fl, abd: lerp(20, 35, k), elbow: lerp(85, 20, k)},
      R: {flex: lerp(70, 150, k) - 3 * fl, abd: lerp(20, 35, k), elbow: lerp(85, 20, k)},
    },
    leg: {
      L: {flex: lerp(95, -15, k) + 4 * fl, abd: lerp(18, 12, k), knee: lerp(125, 45, k), foot: 45},
      R: {flex: lerp(95, -15, k) - 4 * fl, abd: lerp(18, 12, k), knee: lerp(125, 45, k), foot: 45},
    },
  });
}

/** Falling: belly down, limbs splayed and flailing against each other, the trunk rocking. */
function fallFrame(rig: BbRig, t: number): BbFrame {
  const w = TAU * t / BB_CLIPS.Fall.duration, s = Math.sin(w), c = Math.cos(w);
  const pitch = 80 + 4 * c;
  return solveFree(rig, {
    hips: airHips(rig, pitch, -6), pelvis: [pitch, 5 * s, 7 * s], bend: -6, chestYaw: -6 * s, chestRoll: -5 * s, head: [14 + 6 * c, 10 * s, 0],
    arm: {
      L: {flex: 95 + 30 * s, abd: 55 + 12 * c, elbow: 50 + 22 * c, toward: [-0.2, 1, 0.4]},
      R: {flex: 95 - 30 * s, abd: 55 - 12 * c, elbow: 50 - 22 * c, toward: [0.2, 1, 0.4]},
    },
    leg: {
      L: {flex: 22 - 26 * s, abd: 24 + 6 * c, knee: 62 + 26 * c, foot: 40},
      R: {flex: 22 + 26 * s, abd: 24 - 6 * c, knee: 62 - 26 * c, foot: 40},
    },
  });
}

/**
 * Landing, driven by the time since it touched down (the phase may end early: a short drop cuts to the crawl from wherever this is).
 * Flat out first — belly and chest on the surface, arms folded out beside the head, legs trailing spread — a bounce, then the arms
 * push the chest up, the knees are drawn under one after the other, and it settles on all fours with a shake of the head.
 */
function landFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, T = BB_CLIPS.Land.duration, u = clamp(t / T, 0, 1);
  const belly = rig.hit.torso * 0.92;
  const flat = 1 - ss(0.2, 0.62, u), arms = ss(0.2, 0.55, u), bounce = Math.exp(-t / 0.05) * Math.cos(TAU * t / 0.16);
  // spread-eagle: the knees behind and outside the hips, far enough that the hip joints sit at belly height
  const drop = clamp((belly - rig.kneeR.L) / m.thigh, 0.05, 0.9), runK = Math.sqrt(1 - drop * drop) * m.thigh;
  const kneeAt = (sg: number, g: number): Contact => ({
    x: sg * lerp(m.kneeX + 0.5 * runK, m.kneeX, g), z: lerp(m.kneeZ - 0.84 * runK, m.kneeZ, g), lift: 0.1 * m.thigh * Math.sin(Math.PI * g),
  });
  const gL = ss(0.26, 0.52, u), gR = ss(0.38, 0.66, u);
  const palmAt = (sg: number, g: number): Contact & {yaw: number} => ({
    x: sg * lerp(m.palmX + 0.75 * rig.upper.L, m.palmX, g), z: lerp(m.palmZ + 0.35 * rig.fore.L, m.palmZ, g), lift: 0.12 * m.reach * Math.sin(Math.PI * g), yaw: lerp(34, 14, g),
  });
  const shake = Math.sin(TAU * 6 * t) * ss(0.62, 0.72, u) * (1 - ss(0.86, 1, u));
  return solveFours(rig, stance(rig, {
    hipsX: 0, hipsZ: lerp(m.hipsZ, m.hipsZ - 0.1 * m.stroke, 1 - flat), hipsY: 'both',
    pelvis: [lerp(BB_GAIT.pelvisPitchDeg, 84, flat), 0, 3 * (gL - gR)], chestYaw: 0, chestRoll: -2 * (gL - gR),
    shoulderY: lerp(belly * 1.05, m.shoulderY, arms) * (1 - 0.1 * bounce * flat),
    knee: {L: kneeAt(1, gL), R: kneeAt(-1, gR)},
    palm: {L: palmAt(1, ss(0.16, 0.36, u)), R: palmAt(-1, ss(0.22, 0.44, u))}, elbowBack: lerp(8, 24, arms),
    head: [lerp(m.headPitch - 14, m.headPitch, ss(0.05, 0.3, u)) - 10 * bounce * flat, 16 * shake, 8 * shake],
  }));
}

/** The flinch: jolted back off one hand, the head snapped away, then down again. */
function hitFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, T = BB_CLIPS.Hit.duration, e = ss(0, 0.07, t) * (1 - ss(0.2, T, t)), late = ss(0.05, 0.16, t) * (1 - ss(0.22, T, t));
  return solveFours(rig, stance(rig, {
    hipsZ: m.hipsZ - 0.1 * m.stroke - 0.12 * m.thigh * e, pelvis: [BB_GAIT.pelvisPitchDeg - 5 * e, 6 * e, 3 * e], chestYaw: 10 * e, chestRoll: 5 * e,
    shoulderY: m.shoulderY * (1 + 0.05 * e),
    palm: {L: {x: m.palmX, z: m.palmZ, lift: 0}, R: {x: -m.palmX * (1 + 0.3 * late), z: m.palmZ - 0.12 * m.reach * late, lift: 0.3 * m.reach * late, tilt: 30 * late}},
    head: [m.headPitch + 16 * e, 34 * e, 14 * e],
  }));
}

/** The fallback death (no ragdoll): it sags and rolls onto its left side, limbs curling in. */
function deathFrame(rig: BbRig, t: number): BbFrame {
  const m = rig.m, u = clamp(t / BB_CLIPS.Death.duration, 0, 1), k = ss(0.05, 0.75, u);
  const from = solveFours(rig, stance(rig));
  const roll = 84, pitch = 80;
  const qP = tq(pitch, 0, roll), side = Math.abs(rig.local.L_Thigh[0]) + rig.hit.leg;
  // lying on the left side: the left hip joint one leg-radius off the surface
  const hj = qRot(qP, rig.local.L_Thigh);
  const lying = solveFree(rig, {
    hips: [0.2 * side, rig.hit.leg * 1.1 - hj[1], m.hipsZ], pelvis: [pitch, 0, roll], bend: 22, head: [-20, 0, roll * 0.8],
    arm: {L: {flex: 62, abd: 4, elbow: 78}, R: {flex: 48, abd: 8, elbow: 95}},
    leg: {L: {flex: 78, abd: 2, knee: 92, foot: 30}, R: {flex: 62, abd: 6, knee: 104, foot: 30}},
  });
  // (the head is laid down by the chest roll it inherits: keep its own rotation neutral so it does not fight the envelope)
  lying.rot.Neck = qAxis(X, -8);
  lying.rot.Head = qAxis(X, -10);
  return mixFrames(from, lying, k);
}

/** The pose of `clip` at time `t` (s; Crawl / Scuttle: `t / duration` is the cycle phase): the tables' frames, and the tests' oracle. */
export function bbPoseAt(rig: BbRig, clip: BbClipName, t: number): BbFrame {
  switch (clip) {
    case 'Idle': return idleFrame(rig, t);
    case 'Crawl': return gaitFrame(rig, t / BB_CLIPS.Crawl.duration, false);
    case 'Scuttle': return gaitFrame(rig, t / BB_CLIPS.Scuttle.duration, true);
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
  return gaitFrame(rig, frac(phi), fast);
}

/** Metres one cycle of a gait covers on a scale-1 body. */
export function bbCycleM(rig: BbRig, fast: boolean): number {
  return fast ? rig.m.scuttleM : rig.m.crawlM;
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
  /** Metres per cycle (scale 1). */
  crawlM: number;
  scuttleM: number;
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
  return {rig, tables, crawlM: rig.m.crawlM, scuttleM: rig.m.scuttleM};
}

/**
 * The pose of a table at `u` (0..1 of the clip; a loop wraps, a one-shot holds its ends) into `out` (BB_FRAME_FLOATS: quaternions
 * normalised). Allocation-free.
 */
export function sampleBbClip(t: BbClipTable, u: number, out: Float32Array): void {
  const n = t.frames, x = (t.loop ? u - Math.floor(u) : u < 0 ? 0 : u > 1 ? 1 : u) * n;
  const i = Math.min(n - 1, Math.floor(x)), k = x - i, a = i * BB_FRAME_FLOATS, b = a + BB_FRAME_FLOATS, d = t.data;
  for (let j = 0; j < NJ; j++) {
    const o = j * 4;
    const qx = d[a + o] + (d[b + o] - d[a + o]) * k, qy = d[a + o + 1] + (d[b + o + 1] - d[a + o + 1]) * k;
    const qz = d[a + o + 2] + (d[b + o + 2] - d[a + o + 2]) * k, qw = d[a + o + 3] + (d[b + o + 3] - d[a + o + 3]) * k;
    const l = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
    out[o] = qx * l; out[o + 1] = qy * l; out[o + 2] = qz * l; out[o + 3] = qw * l;
  }
  for (let c = NJ * 4; c < BB_FRAME_FLOATS; c++) out[c] = d[a + c] + (d[b + c] - d[a + c]) * k;
}

/** A sampled table row set as a frame (tests / the CPU renders). */
export function frameOfSample(row: Float32Array): BbFrame {
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
