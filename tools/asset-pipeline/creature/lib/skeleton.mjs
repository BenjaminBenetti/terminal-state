// NEW quadruped skeleton (the master had none). Joint frames have identity bind rotations (bone
// frames aligned with model space in the bind pose: +Y up, +Z forward, +X = creature LEFT), like the
// zombie rigs, so the runtime ragdoll's bind-frame axes apply unchanged.
//
//   Root ─ Hips ─ Spine1 ─ Spine2 ─ Chest ─ Neck ─ Head ─ Jaw
//           │                         ├─ L/R_FrontUpper ─ FrontLower ─ FrontFoot   (shoulder, elbow, carpus)
//           ├─ L/R_HindUpper ─ HindLower ─ HindFoot                               (hip, stifle, hock)
//           └─ Tail1 ─ Tail2 ─ Tail3 ─ Tail4 ─ Tail5
export const JOINTS = [
  ['Root', null], ['Hips', 'Root'], ['Spine1', 'Hips'], ['Spine2', 'Spine1'], ['Chest', 'Spine2'], ['Neck', 'Chest'], ['Head', 'Neck'], ['Jaw', 'Head'],
  ['Tail1', 'Hips'], ['Tail2', 'Tail1'], ['Tail3', 'Tail2'], ['Tail4', 'Tail3'], ['Tail5', 'Tail4'],
  ['L_FrontUpper', 'Chest'], ['L_FrontLower', 'L_FrontUpper'], ['L_FrontFoot', 'L_FrontLower'],
  ['R_FrontUpper', 'Chest'], ['R_FrontLower', 'R_FrontUpper'], ['R_FrontFoot', 'R_FrontLower'],
  ['L_HindUpper', 'Hips'], ['L_HindLower', 'L_HindUpper'], ['L_HindFoot', 'L_HindLower'],
  ['R_HindUpper', 'Hips'], ['R_HindLower', 'R_HindUpper'], ['R_HindFoot', 'R_HindLower'],
];
export const JOINT_NAMES = JOINTS.map(j => j[0]);
export const PARENT = Object.fromEntries(JOINTS);
export const CHILDREN = Object.fromEntries(JOINT_NAMES.map(n => [n, JOINTS.filter(j => j[1] === n).map(j => j[0])]));

/** Bone segments for skin weights: bone -> [start joint, end point] (end = main child joint or a measured end). */
export function boneSegments(skel) {
  const J = skel.joints, E = skel.ends;
  const seg = {};
  const main = {Hips: 'Spine1', Spine1: 'Spine2', Spine2: 'Chest', Chest: 'Neck', Neck: 'Head', Tail1: 'Tail2', Tail2: 'Tail3', Tail3: 'Tail4', Tail4: 'Tail5'};
  for (const [n] of JOINTS) {
    if (n === 'Root') continue;
    let end;
    if (main[n]) end = J[main[n]];
    else if (n === 'Head') end = E.Head; // skull base -> nose tip (the jaw has its own segment)
    else if (CHILDREN[n].length === 1) end = J[CHILDREN[n][0]];
    else end = E[n];
    if (!end) throw new Error('no segment end for ' + n);
    seg[n] = [J[n], end];
  }
  return seg;
}
