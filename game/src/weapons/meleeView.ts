// Lane KNIFE (knife-melee-20261030): procedural first-person knife motion. The knife model is static (no rig), so like the
// guns' recoil / reload choreography the swing is a camera-space offset of the viewmodel pivot (the Grip = the hand):
//   windup (cock back up and out to the right) -> contact (the blade crosses the screen centre, sweeping right to left,
//   at exactly `windup` s — when combat/melee.ts resolves the hit) -> follow-through (low left) -> recovery to the carry.
// Pure math (no THREE): unit tests and the offline pose renderer read the same numbers the game uses.

/** Additive camera-space offset: position (m; x right, y up, z toward the eye) and Euler XYZ angles (rad). */
export interface PoseOffset { x: number; y: number; z: number; rx: number; ry: number; rz: number }

/**
 * Key poses of the slash relative to the carry pose (weapons.ts knife view.hip / hipYaw / hipPitch / hipRoll). Tuned offline
 * (CPU perspective renders of knife-user.glb through the 54 deg viewmodel camera): the Tip marker runs from the upper right
 * (NDC ~ +0.95, +0.49) to the lower left (~ -0.81, -0.86) and is on the crosshair (~ -0.06, 0.00) at contact.
 */
export const KNIFE_SWING_KEYS = {
  /** Drawn back: hand up and out to the right, tip turned outward and up, blade canted. */
  cocked: {x: 0.08, y: 0.06, z: 0.05, rx: 0.3, ry: -0.8, rz: 0.35},
  /** Follow-through: hand low left and forward, tip swept past the centre to the left (blade level), wrist rolled. */
  through: {x: -0.17, y: -0.04, z: -0.06, rx: -0.15, ry: 1.0, rz: -0.25},
} as const;

const ZERO: PoseOffset = {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
function mix(a: PoseOffset, b: PoseOffset, k: number, out: PoseOffset): PoseOffset {
  out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
  out.rx = a.rx + (b.rx - a.rx) * k; out.ry = a.ry + (b.ry - a.ry) * k; out.rz = a.rz + (b.rz - a.rz) * k;
  return out;
}

/**
 * Timing of one swing (s from the click): cock until `cockEnd`, one continuous sweep cocked -> through over
 * [cockEnd, sweepEnd] that passes mid-arc at the contact time `windup`, then an eased return until `interval`.
 */
export function knifeSwingTimes(windup: number, interval: number): {cockEnd: number; contact: number; sweepEnd: number; end: number} {
  const cockEnd = windup * 0.55;
  const sweepEnd = Math.min(interval * 0.6, windup + (windup - cockEnd));
  return {cockEnd, contact: windup, sweepEnd, end: interval};
}

/** Offset `t` s into a swing (t < 0 or >= interval: none). */
export function knifeSwingOffset(t: number, windup: number, interval: number, out: PoseOffset = {...ZERO}): PoseOffset {
  const {cockEnd, sweepEnd, end} = knifeSwingTimes(windup, interval);
  if (!(t >= 0) || t >= end) return mix(ZERO, ZERO, 0, out);
  const {cocked, through} = KNIFE_SWING_KEYS;
  if (t < cockEnd) return mix(ZERO, cocked, smooth(t / cockEnd), out);
  if (t < sweepEnd) return mix(cocked, through, smooth((t - cockEnd) / (sweepEnd - cockEnd)), out);
  return mix(through, ZERO, smooth((t - sweepEnd) / (end - sweepEnd)), out);
}
