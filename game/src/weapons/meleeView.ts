// Lane KNIFE (knife-melee-20261030) / lane FEEL (knife-windup-20261030): procedural first-person melee motion. The knife model
// is static (no rig), so like the guns' recoil / reload choreography its motion is a camera-space pose of the viewmodel pivot
// (the Grip = the hand). Lane FEEL (user: "the way you hold it seems awkward ... you sorta hold it sideways ... more up and
// down, more of a neutral position as you carry it, and then you should click, and that holds it up behind your head, and
// then ... it swings"): absolute key poses per melee model, driven by the WeaponController melee stage (weapons.ts MeleeSpec):
//   carry (upright, relaxed: blade up, edge forward) -> WINDUP raise -> READY (raised beside the head, cocked back over the
//   right shoulder, held while the button is down; a slight breathing sway) -> release: SWING (accelerating down-left so
//   the tip crosses the crosshair exactly at contact, then the follow-through low left) -> RECOVERY back to the carry.
// The swing keys (contact / through) are the previous slash the user liked ("the swiping is fine"). Pure math (no THREE):
// unit tests and the offline pose renderer read the same numbers the game uses.

import type {MeleeSpec, MeleeStage} from './weapons';
import {VARIETY_MELEE_IDS, type VarietyMeleeId} from './varietyIds'; // lane MELEE (weapon variety)
import {WEAPON_VARIETY_MODELS} from '../assets/weaponVarietyModels.generated'; // lane MELEE: the delivered models' lengths / Tip markers

/** Additive camera-space offset: position (m; x right, y up, z toward the eye) and Euler XYZ angles (rad). */
export interface PoseOffset { x: number; y: number; z: number; rx: number; ry: number; rz: number }

/** An absolute held pose in viewmodel camera space: Grip position (m) and Euler XYZ rotation (rad) of the model. */
export interface HeldPose { pos: readonly [number, number, number]; rot: readonly [number, number, number] }

/** Key poses of one melee weapon (absolute; the viewmodel adds offset = key - carry to its carry pose). */
export interface MeleePoses {
  /** Normal carry (WeaponDef.view hip / hipPitch / hipYaw / hipRoll come from it). */
  carry: HeldPose;
  /** Wound up: the end of the windup and the pose held while the button stays down. */
  raised: HeldPose;
  /** Blade contact (`strike` s after the release): the tip on the crosshair. */
  contact: HeldPose;
  /** End of the sweep / follow-through (`sweep` s after the release). */
  through: HeldPose;
  /**
   * Lane MELEE (weapon variety): a CHARGE weapon's fully charged hold — drawn back further than `raised`. The ready pose moves from
   * `raised` toward it as the charge builds, and the swing starts from the pose the release left (absent: no charge pose).
   */
  charged?: HeldPose;
}

/**
 * The user's knife (knife-user.glb: tip -Z, spine +Y, edge -Y, Grip at the origin). Tuned offline with CPU perspective renders
 * through the 54 deg viewmodel camera (reference/tasks/knife-windup-20261030/evidence):
 *  - carry: the hand low right (grip running out of the bottom edge, the guard ~80 % down the screen), the blade standing
 *    up with a slight forward / inward lean (tip ~ NDC +0.26, +0.05), edge forward-left, the flat half turned to the eye;
 *  - raised: the hand up at the right edge beside the head, the blade cocked back over the shoulder and tipped in over the
 *    head (tip ~ NDC +0.62, +0.81 — still on screen), edge toward the coming slash (down-left);
 *  - contact / through: the previous slash — the tip on the crosshair (~ -0.06, 0.00), then low left (~ -0.81, -0.86).
 */
export const KNIFE_POSES: MeleePoses = {
  carry: {pos: [0.16, -0.19, -0.36], rot: [0.915, 0.181, -0.753]},
  raised: {pos: [0.30, -0.08, -0.33], rot: [1.976, 0.707, -1.044]},
  contact: {pos: [0.095, -0.14, -0.285], rot: [0.65, 0.51, -0.97]},
  through: {pos: [-0.03, -0.19, -0.34], rot: [0.425, 1.41, -1.27]},
};

// ---- Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): the six new melee weapons' key poses -----------------------
// The models are static like the knife (tip / head -Z, Grip = the main hand at the origin, +Y = the top of the approved side view: the
// axe's spike / machete's spine up, the axe edge / crowbar claw down, the shovel blade's flat face along X; COOK lane,
// assets/weaponVarietyModels.generated.ts). Their key poses are AIMED rather than typed as angles: the Grip at a camera-space point,
// the model's Tip landing on a chosen screen point, its +Y turned toward a camera-space direction — and solved for the model's REAL
// length (its Tip marker when delivered, else the approved length), so a 1.25 m shovel and a 0.62 m machete both put their head where
// the swing needs it (the contact on the crosshair). Swing styles: an OVERHEAD CHOP for the axe / sledgehammer (raised over the right
// shoulder, down through the crosshair, low follow-through), a HORIZONTAL SWEEP right -> left for the machete / shovel / bat, a MID
// diagonal strike for the crowbar; the two-handed ones (axe, sledgehammer, bat, shovel) carry diagonally across the body.

/** The viewmodel camera's vertical field of view (deg; weapons/viewmodel.ts Viewmodel.camera) and the aspect the aims are designed at. */
export const VIEW_FOV_DEG = 54;
export const DESIGN_ASPECT = 16 / 9;

/** One key pose described by where it is aimed (weapon variety). */
export interface MeleeAim {
  /** The Grip (main hand = the model origin) in viewmodel camera space (m; x right, y up, z toward the eye). */
  grip: readonly [number, number, number];
  /** Where the model's Tip lands on screen: NDC at DESIGN_ASPECT (|v| > 1 = beyond the frame edge). */
  tip: readonly [number, number];
  /** Camera-space direction the model's +Y (the top of its side view) is turned toward (orthogonalised against the shaft). */
  up: readonly [number, number, number];
}
export interface MeleeAims { carry: MeleeAim; raised: MeleeAim; contact: MeleeAim; through: MeleeAim; charged?: MeleeAim }

type V3 = readonly [number, number, number];
const norm = (v: V3): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** `u` made perpendicular to unit `a` (fallback `alt` when parallel), unit length. */
function ortho(u: V3, a: V3, alt: V3): [number, number, number] {
  const k = dot(u, a), p: V3 = [u[0] - a[0] * k, u[1] - a[1] * k, u[2] - a[2] * k];
  return Math.hypot(...p) > 1e-6 ? norm(p) : ortho(alt, a, [1, 0, 0]);
}
const TAU = Math.PI * 2;
const near = (v: number, ref: number) => v + TAU * Math.round((ref - v) / TAU);

/**
 * The absolute held pose of an aim: the tip depth along its screen ray is solved so that |Tip - Grip| is the model's tip distance
 * (the model is not stretched; an aim the length cannot reach points the shaft at the closest point of that ray), the rotation turns
 * the model's tip direction onto the aim and its +Y toward `up`, as Euler XYZ (three.js order, as the viewmodel applies it) — the
 * equivalent angle set nearest `ref` (the previous key), so the viewmodel's per-angle interpolation between keys takes the short way.
 */
export function aimPose(a: MeleeAim, tipModel: V3, ref: V3 = [0, 0, 0]): HeldPose {
  const B = Math.tan(VIEW_FOV_DEG / 2 * Math.PI / 180), A = B * DESIGN_ASPECT;
  const [gx, gy, gz] = a.grip, L = Math.hypot(...tipModel);
  const ux = a.tip[0] * A, uy = a.tip[1] * B; // the tip ray: (ux z, uy z, -z), z = depth
  const qa = ux * ux + uy * uy + 1, qb = -2 * (ux * gx + uy * gy - gz), qc = gx * gx + gy * gy + gz * gz - L * L;
  const disc = qb * qb - 4 * qa * qc;
  const z = disc >= 0 ? (-qb + Math.sqrt(disc)) / (2 * qa) : -qb / (2 * qa);
  const dc = norm([ux * z - gx, uy * z - gy, -z - gz]);
  const am = norm(tipModel), bm = ortho([0, 1, 0], am, [0, 0, 1]), cm = cross(am, bm);
  const bc = ortho(a.up, dc, [0, 1, 0]), cc = cross(dc, bc);
  // R = [dc bc cc] [am bm cm]^T: model tip -> dc, model +Y (orthogonalised) -> bc
  const R = (i: number, j: number) => dc[i] * am[j] + bc[i] * bm[j] + cc[i] * cm[j];
  const m13 = Math.max(-1, Math.min(1, R(0, 2)));
  let x: number, y = Math.asin(m13), zr: number;
  if (Math.abs(m13) < 0.9999999) { x = Math.atan2(-R(1, 2), R(2, 2)); zr = Math.atan2(-R(0, 1), R(0, 0)); } else { x = Math.atan2(R(2, 1), R(1, 1)); zr = 0; }
  const cands: [number, number, number][] = [[x, y, zr], [x + Math.PI, Math.PI - y, zr + Math.PI]]
    .map(([p, q, r]) => [near(p, ref[0]), near(q, ref[1]), near(r, ref[2])]);
  const d2 = (c: V3) => (c[0] - ref[0]) ** 2 + (c[1] - ref[1]) ** 2 + (c[2] - ref[2]) ** 2;
  const rot = d2(cands[0]) <= d2(cands[1]) ? cands[0] : cands[1];
  return {pos: [gx, gy, gz], rot};
}

/** Key poses of a set of aims for a model tip (each key's angles continue from the previous one: carry -> raised -> charged -> contact -> through). */
export function aimPoses(aims: MeleeAims, tipModel: V3): MeleePoses {
  const carry = aimPose(aims.carry, tipModel);
  const raised = aimPose(aims.raised, tipModel, carry.rot);
  const charged = aims.charged ? aimPose(aims.charged, tipModel, raised.rot) : undefined;
  const contact = aimPose(aims.contact, tipModel, raised.rot);
  const through = aimPose(aims.through, tipModel, contact.rot);
  return charged ? {carry, raised, contact, through, charged} : {carry, raised, contact, through};
}

/** The approved real lengths (m; PLAN: M01..M06) — the tip distance until the delivered model's Tip marker replaces it. */
export const VARIETY_MELEE_LENGTHS: Readonly<Record<VarietyMeleeId, number>> = {
  fire_axe: 0.90, machete: 0.62, sledgehammer: 0.92, crowbar: 0.76, slugger: 0.84, track_shovel: 1.25,
};

/** The model's Tip relative to its Grip (the delivered registry markers), else straight down -Z at the approved length. */
export function varietyTip(id: VarietyMeleeId): V3 {
  const mk = WEAPON_VARIETY_MODELS[id]?.markers;
  const tip = mk?.Tip, grip = mk?.Grip ?? [0, 0, 0];
  if (tip && Math.hypot(tip[0] - grip[0], tip[1] - grip[1], tip[2] - grip[2]) > 0.05) return [tip[0] - grip[0], tip[1] - grip[1], tip[2] - grip[2]];
  return [0, 0, -(WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_MELEE_LENGTHS[id])];
}

/** The model length for WeaponDef.view.length (delivered registry length, else the approved one). */
export function varietyLength(id: VarietyMeleeId): number {
  return WEAPON_VARIETY_MODELS[id]?.length ?? VARIETY_MELEE_LENGTHS[id];
}

/**
 * The aims of the six weapons. Screen notes (16:9, 54 deg viewmodel camera): the carry keeps the head in the upper right with the shaft
 * running out of the bottom edge (two-handed: more central, the haft diagonal across the body); every swing puts the Tip ON the
 * crosshair at contact (`tip: [0, 0]`).
 */
export const VARIETY_MELEE_AIMS: Readonly<Record<VarietyMeleeId, MeleeAims>> = {
  // OVERHEAD CHOP, two-handed: haft across the body, head up right (edge forward) -> raised over the right shoulder (head up behind,
  // edge up / forward) -> down through the crosshair (edge leading, down) -> low centre-left follow-through
  fire_axe: {
    carry: {grip: [0.10, -0.42, -0.40], tip: [0.42, 0.42], up: [-0.2, 0.15, 0.95]},
    raised: {grip: [0.16, -0.10, -0.34], tip: [0.55, 1.9], up: [0, -0.35, 1]},
    contact: {grip: [0.04, -0.30, -0.46], tip: [0, 0], up: [0, 1, 0.2]},
    through: {grip: [-0.02, -0.40, -0.36], tip: [-0.25, -1.1], up: [0, 0.3, -1]},
  },
  // the same chop, heavier: lower carry (the head rests out at the right), a higher draw back
  sledgehammer: {
    carry: {grip: [0.12, -0.45, -0.40], tip: [0.50, 0.30], up: [-0.3, 0.1, 0.95]},
    raised: {grip: [0.17, -0.06, -0.32], tip: [0.50, 2.2], up: [0, -0.35, 1]},
    contact: {grip: [0.04, -0.32, -0.48], tip: [0, 0], up: [0, 1, 0.2]},
    through: {grip: [-0.02, -0.42, -0.36], tip: [-0.20, -1.2], up: [0, 0.3, -1]},
  },
  // HORIZONTAL SWEEP, one-handed (a long knife): blade up right, edge forward -> drawn back to the right at shoulder height (edge
  // toward the coming slash, left) -> flat through the crosshair -> far left
  machete: {
    carry: {grip: [0.18, -0.24, -0.38], tip: [0.32, 0.50], up: [0.25, -0.15, 1]},
    raised: {grip: [0.30, -0.10, -0.30], tip: [0.95, 0.45], up: [0.1, 0.9, 0.5]},
    contact: {grip: [0.12, -0.12, -0.34], tip: [0, 0], up: [0, 1, 0.1]},
    through: {grip: [-0.08, -0.16, -0.36], tip: [-0.95, -0.15], up: [0, 1, 0.3]},
  },
  // MID STRIKE, one-handed: bar up right -> raised up beside the head -> diagonal down-left through the crosshair -> low left
  crowbar: {
    carry: {grip: [0.18, -0.26, -0.38], tip: [0.36, 0.52], up: [0.6, 0, 1]},
    raised: {grip: [0.28, -0.04, -0.30], tip: [0.75, 1.25], up: [-0.4, 0.2, 1]},
    contact: {grip: [0.10, -0.16, -0.36], tip: [0, 0], up: [0.6, 0.7, 0.2]},
    through: {grip: [-0.06, -0.26, -0.34], tip: [-0.80, -0.75], up: [0.5, 0.4, 0.6]},
  },
  // HORIZONTAL SWEEP with a CHARGE, two-handed: the bat up over the right shoulder -> cocked back right; the CHARGE pulls it further
  // back and up (visible charge) -> level through the crosshair -> wrapped round to the left
  slugger: {
    carry: {grip: [0.12, -0.38, -0.38], tip: [0.45, 0.55], up: [0, 0, 1]},
    raised: {grip: [0.26, -0.18, -0.30], tip: [1.05, 0.70], up: [0, 1, 0]},
    charged: {grip: [0.32, -0.12, -0.24], tip: [1.45, 1.10], up: [0, 1, 0]},
    contact: {grip: [0.08, -0.22, -0.40], tip: [0, 0], up: [0, 1, 0]},
    through: {grip: [-0.10, -0.24, -0.34], tip: [-1.10, 0.10], up: [0, 1, 0]},
  },
  // WIDE FLAT SWEEP, two-handed: the long haft low across the body, blade forward-right (face along the sweep) -> drawn back right ->
  // flat through the crosshair (the blade's face leading) -> far left
  track_shovel: {
    carry: {grip: [0.06, -0.40, -0.36], tip: [0.40, -0.05], up: [0, 1, 0]},
    raised: {grip: [0.22, -0.26, -0.28], tip: [1.15, 0.05], up: [0, 1, 0]},
    contact: {grip: [0.06, -0.30, -0.38], tip: [0, 0], up: [0, 1, 0]},
    through: {grip: [-0.10, -0.32, -0.32], tip: [-1.10, -0.05], up: [0, 1, 0]},
  },
};

/** The six weapons' key poses, solved for each model's length / Tip at load (weapon variety). */
export const VARIETY_MELEE_POSES: Readonly<Record<VarietyMeleeId, MeleePoses>> = Object.fromEntries(
  VARIETY_MELEE_IDS.map(id => [id, aimPoses(VARIETY_MELEE_AIMS[id], varietyTip(id))])) as Record<VarietyMeleeId, MeleePoses>;

/** Key poses per held melee model (WeaponDef.view.model); a future club / crowbar adds its own entry. */
export const MELEE_POSES: Record<string, MeleePoses> = {knife: KNIFE_POSES, ...VARIETY_MELEE_POSES};

/** WeaponDef.view fields (hip / aim / hipPitch / hipYaw / hipRoll) of a carry pose (melee: no ADS, aim = hip). */
export function carryView(p: HeldPose): {hip: [number, number, number]; aim: [number, number, number]; hipPitch: number; hipYaw: number; hipRoll: number} {
  return {hip: [...p.pos], aim: [...p.pos], hipPitch: p.rot[0], hipYaw: p.rot[1], hipRoll: p.rot[2]};
}

/** Ready-pose breathing while the windup is held: amplitude (m / rad) and frequency (Hz). Small: it only shows it is alive. */
export const READY_SWAY = {pos: 0.0025, rot: 0.012, hz: 0.9} as const;
/** Recovery dip (m / rad, sin-shaped, zero at both ends): the hand comes back low, so the blade does not wave across the aim point. */
export const RECOVER_DIP = {pos: 0.03, rot: 0.25} as const;
/** Lane MELEE (weapon variety): the strained tremble of a FULLY charged hold (m / rad, Hz) — the charge cue on the weapon itself. */
export const CHARGE_TREMBLE = {pos: 0.0025, rot: 0.02, hz: 9} as const;

const ZERO: PoseOffset = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const easeIn = (t: number) => { const u = clamp01(t); return u * u; };
const easeOut = (t: number) => { const u = clamp01(t); return 1 - (1 - u) * (1 - u); };

/** Offset of key `p` from the carry. */
function rel(p: HeldPose, carry: HeldPose, out: PoseOffset): PoseOffset {
  out.x = p.pos[0] - carry.pos[0]; out.y = p.pos[1] - carry.pos[1]; out.z = p.pos[2] - carry.pos[2];
  out.rx = p.rot[0] - carry.rot[0]; out.ry = p.rot[1] - carry.rot[1]; out.rz = p.rot[2] - carry.rot[2];
  return out;
}
function mix(a: PoseOffset, b: PoseOffset, k: number, out: PoseOffset): PoseOffset {
  out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
  out.rx = a.rx + (b.rx - a.rx) * k; out.ry = a.ry + (b.ry - a.ry) * k; out.rz = a.rz + (b.rz - a.rz) * k;
  return out;
}
const tmpA: PoseOffset = {...ZERO}, tmpB: PoseOffset = {...ZERO};

/**
 * Offset from the carry pose for a melee stage (WeaponController.meleePose): `t` = seconds into that stage. null stage = the
 * carry (zero). Windup: smooth raise over `windup` s; ready: the raised pose plus a slight breathing sway; swing: raised ->
 * contact accelerating over `strike` s (the tip reaches the crosshair exactly at contact), contact -> through decelerating
 * until `sweep` s; recover: through -> carry over `recovery` s with a low dip (ends exactly at zero: no pop into the carry).
 */
export function meleePoseOffset(stage: MeleeStage | null, t: number, m: Pick<MeleeSpec, 'windup' | 'strike' | 'sweep' | 'recovery'>,
  poses: MeleePoses = KNIFE_POSES, out: PoseOffset = {...ZERO}, charge = 0): PoseOffset {
  const c = poses.carry;
  // lane MELEE (weapon variety): `charge` 0..1 (WeaponController.meleePose) draws a CHARGE weapon's ready pose from `raised` toward
  // `charged`, and its swing starts from wherever the release left it; without a `charged` pose (the knife) it changes nothing
  const ck = poses.charged ? easeOut(charge) : 0;
  if (stage === 'windup') return mix(ZERO, rel(poses.raised, c, tmpA), smooth(t / m.windup), out);
  if (stage === 'ready') {
    rel(poses.raised, c, out);
    if (ck > 0) mix(out, rel(poses.charged!, c, tmpB), ck, out);
    const s = Math.sin(t * Math.PI * 2 * READY_SWAY.hz);
    out.y += s * READY_SWAY.pos; out.rx += s * READY_SWAY.rot;
    if (ck >= 1) { const q = Math.sin(t * Math.PI * 2 * CHARGE_TREMBLE.hz); out.x += q * CHARGE_TREMBLE.pos; out.rz += q * CHARGE_TREMBLE.rot; } // full: a strained tremble
    return out;
  }
  if (stage === 'swing') {
    if (t < m.strike) {
      const start = ck > 0 ? mix(rel(poses.raised, c, tmpA), rel(poses.charged!, c, tmpB), ck, tmpA) : rel(poses.raised, c, tmpA);
      return mix(start, rel(poses.contact, c, tmpB), easeIn(t / m.strike), out);
    }
    return mix(rel(poses.contact, c, tmpA), rel(poses.through, c, tmpB), easeOut((t - m.strike) / Math.max(1e-6, m.sweep - m.strike)), out);
  }
  if (stage === 'recover') {
    mix(rel(poses.through, c, tmpA), ZERO, smooth(t / m.recovery), out);
    const dip = Math.sin(Math.PI * clamp01(t / m.recovery));
    out.y -= dip * RECOVER_DIP.pos; out.rx -= dip * RECOVER_DIP.rot;
    return out;
  }
  return mix(ZERO, ZERO, 0, out);
}
