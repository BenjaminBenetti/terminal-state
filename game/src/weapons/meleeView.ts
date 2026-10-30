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

/** Key poses per held melee model (WeaponDef.view.model); a future club / crowbar adds its own entry. */
export const MELEE_POSES: Record<string, MeleePoses> = {knife: KNIFE_POSES};

/** WeaponDef.view fields (hip / aim / hipPitch / hipYaw / hipRoll) of a carry pose (melee: no ADS, aim = hip). */
export function carryView(p: HeldPose): {hip: [number, number, number]; aim: [number, number, number]; hipPitch: number; hipYaw: number; hipRoll: number} {
  return {hip: [...p.pos], aim: [...p.pos], hipPitch: p.rot[0], hipYaw: p.rot[1], hipRoll: p.rot[2]};
}

/** Ready-pose breathing while the windup is held: amplitude (m / rad) and frequency (Hz). Small: it only shows it is alive. */
export const READY_SWAY = {pos: 0.0025, rot: 0.012, hz: 0.9} as const;
/** Recovery dip (m / rad, sin-shaped, zero at both ends): the hand comes back low, so the blade does not wave across the aim point. */
export const RECOVER_DIP = {pos: 0.03, rot: 0.25} as const;

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
  poses: MeleePoses = KNIFE_POSES, out: PoseOffset = {...ZERO}): PoseOffset {
  const c = poses.carry;
  if (stage === 'windup') return mix(ZERO, rel(poses.raised, c, tmpA), smooth(t / m.windup), out);
  if (stage === 'ready') {
    rel(poses.raised, c, out);
    const s = Math.sin(t * Math.PI * 2 * READY_SWAY.hz);
    out.y += s * READY_SWAY.pos; out.rx += s * READY_SWAY.rot;
    return out;
  }
  if (stage === 'swing') {
    if (t < m.strike) return mix(rel(poses.raised, c, tmpA), rel(poses.contact, c, tmpB), easeIn(t / m.strike), out);
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
