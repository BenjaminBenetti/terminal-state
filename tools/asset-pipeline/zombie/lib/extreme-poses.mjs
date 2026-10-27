// Iteration 07 (Lane W): ragdoll-like extreme poses for fit validation, kept inside the runtime ragdoll
// joint limits (game/src/physics/ragdoll.ts: shoulder cone ~69 deg, hip flex ~82 deg / abduction ~46 deg,
// lower spine ~34 deg, neck ~40 deg) - the kind of pose a corpse can end up in. Local joint rotations in
// the rig convention (bind rotations identity; Euler degrees applied yaw(Y) * pitch(X) * roll(Z);
// +X pitches +Y toward +Z).
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (ax, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
export const euler = (x = 0, y = 0, z = 0) => qmul(qaxis([0, 1, 0], y), qmul(qaxis([1, 0, 0], x), qaxis([0, 0, 1], z)));

export const EXTREME_POSES = {
  'ragdoll-sprawl': {Spine: euler(-10, 0, 6), Chest: euler(-6, 8, 0), Neck: euler(-20, 25, 0), Head: euler(-15, 25, 10),
    L_UpperArm: euler(0, 0, 62), R_UpperArm: euler(-35, 0, -55), L_Forearm: euler(-40, 0, 0), R_Forearm: euler(-15, 0, 0),
    L_Thigh: euler(-70, 0, 10), L_Shin: euler(85, 0, 0), R_Thigh: euler(0, 0, -35), R_Shin: euler(20, 0, 0)},
  'ragdoll-crumple': {Spine: euler(25, 0, 0), Chest: euler(18, 0, 0), Neck: euler(25, 0, 0), Head: euler(20, -15, 0),
    L_UpperArm: euler(-55, 0, -25), R_UpperArm: euler(-55, 0, 25), L_Forearm: euler(-80, 0, 0), R_Forearm: euler(-80, 0, 0),
    L_Thigh: euler(-80, 0, 0), L_Shin: euler(110, 0, 0), R_Thigh: euler(-75, 0, 0), R_Shin: euler(115, 0, 0)},
  'ragdoll-twist': {Spine: euler(5, 15, 12), Chest: euler(5, 12, 10), Neck: euler(10, -30, 0), Head: euler(-10, -25, -10),
    L_UpperArm: euler(-70, 0, 20), R_UpperArm: euler(45, 0, -15), L_Forearm: euler(-60, 0, 0), R_Forearm: euler(-30, 0, 0),
    L_Thigh: euler(-55, 0, 0), L_Shin: euler(60, 0, 0), R_Thigh: euler(25, 0, -20), R_Shin: euler(35, 0, 0)},
};
