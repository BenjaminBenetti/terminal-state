// Task studio-bb-models-20261112-234540-01: the BB skin-audit poses on the shared 18-joint rig (zombie/lib/pose.mjs Rig: identity
// rest rotations, so a joint's local axes are the bind / model axes: +X the character's left, +Y up, +Z forward). The poses are
// the implementation lead's contract (BB-ASSET-CONTRACT v1 `poseEnvelope`): every range end of the envelope, one degree of
// freedom at a time from the bind, and the four KEY poses (CRAWL, WINDUP, POUNCE, TWITCH). They exist to audit and render the
// skin; the game builds its own clips at runtime from the bind joints.
//
// Angle conventions (degrees): trunkPitch = Hips pitched forward (the whole body tips toward +Z); spine bend + = forward, twist
// about +Y, side bend about +Z (split over Spine / Chest); neck ext + = the face turns up (split Neck 0.4 / Head 0.6), yaw about
// +Y, roll about +Z; legs: flex + = the thigh swings forward (extension negative), abd + = outward, knee + = the shin folds
// back, ankle + = toes down; arms are measured FROM HANGING at the side (the contract's reference, not the A-pose bind): flex +
// = forward / up in the chest frame, abd + = outward, elbow + = the forearm folds forward / up; `hand: 'flat'` lays the palm on
// the floor (world palm normal -Y, fingers forward), else the hand follows the forearm (+ wrist / twist).
import {qAxis, qMul, qInv, qRot, frameRot, V} from '../../zombie/lib/pose.mjs';

const X = [1, 0, 0], Y = [0, 1, 0];
const rx = (deg, v) => qRot(qAxis(X, deg), v);
const rz = (deg, v) => qRot(qAxis([0, 0, 1], deg), v);

/** Anatomical spec -> {hips, rot} for rig.fk. `skel` = detectBbSkeleton result (palm contacts for flat hands). */
export function bbPose(rig, skel, spec = {}) {
  const pose = {hips: [0, 0, 0], rot: {}};
  const s = spec.spine || {}, nk = spec.neck || {};
  pose.rot.Hips = qAxis(X, spec.trunkPitch || 0);
  const trunk = f => qMul(qAxis(Y, (s.twist || 0) * f), qMul(qAxis(X, (s.bend || 0) * f), qAxis([0, 0, 1], (s.side || 0) * f)));
  pose.rot.Spine = trunk(0.5); pose.rot.Chest = trunk(0.5);
  const neck = f => qMul(qAxis(Y, (nk.yaw || 0) * f), qMul(qAxis(X, -(nk.ext || 0) * f), qAxis([0, 0, 1], (nk.roll || 0) * f)));
  pose.rot.Neck = neck(0.4); pose.rot.Head = neck(0.6);
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, lg = (spec.legs || {})[side] || {};
    pose.rot[side + '_Thigh'] = qMul(qAxis([0, 0, 1], sg * (lg.abd || 0)), qAxis(X, -(lg.flex || 0)));
    pose.rot[side + '_Shin'] = qAxis(X, lg.knee || 0);
    pose.rot[side + '_Foot'] = qAxis(X, lg.ankle || 0);
  }
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, am = (spec.arms || {})[side];
    if (!am) continue; // the bind arm
    const dir = rx(-(am.flex || 0), rz(sg * (am.abd || 0), [0, -1, 0]));
    const hinge = rx(-(am.flex || 0), rz(sg * (am.abd || 0), [-1, 0, 0]));
    rig.armAim(pose, side, {dir, hinge, flex: am.elbow || 0, wrist: am.wrist || 0, twist: am.twist || 0});
    if (am.hand === 'flat') {
      // world target: fingers forward (slightly out), palm down; the Hand's local rotation = inv(Forearm world) * target
      const w = rig.fk(pose);
      const b = rig.bind, dH0 = V.norm(V.sub(rig.ends[side + '_Hand'], b[side + '_Hand']));
      const pc = skel.contact.palm[side];
      const palm0 = V.norm(V.sub(pc, V.mul(dH0, V.dot(pc, dH0))));
      const handW = frameRot(dH0, palm0, V.norm([sg * 0.25, 0, 1]), [0, -1, 0]);
      pose.rot[side + '_Hand'] = qMul(qInv(w[side + '_Forearm'].rot), handW);
    }
  }
  return pose;
}

/** The contract's four key poses (spec form). */
export const KEY_POSES = {
  CRAWL: {trunkPitch: 65, spine: {bend: -5}, neck: {ext: 60},
    legs: {L: {flex: 80, abd: 8, knee: 100, ankle: 60}, R: {flex: 80, abd: 8, knee: 100, ankle: 60}},
    arms: {L: {flex: 65, abd: 10, elbow: 5, hand: 'flat'}, R: {flex: 65, abd: 10, elbow: 5, hand: 'flat'}}},
  WINDUP: {trunkPitch: 80, neck: {ext: 70},
    legs: {L: {flex: 110, abd: 10, knee: 135, ankle: 30}, R: {flex: 110, abd: 10, knee: 135, ankle: 30}},
    arms: {L: {flex: 50, abd: 15, elbow: 70, hand: 'flat'}, R: {flex: 50, abd: 15, elbow: 70, hand: 'flat'}}},
  POUNCE: {trunkPitch: 70, neck: {ext: 40},
    legs: {L: {flex: -15, abd: 10, knee: 45, ankle: 20}, R: {flex: -15, abd: 10, knee: 45, ankle: 20}},
    arms: {L: {flex: 150, abd: 35, elbow: 20}, R: {flex: 150, abd: 35, elbow: 20}}},
  TWITCH: {trunkPitch: 65, spine: {bend: -5}, neck: {ext: 60, yaw: 60, roll: 20},
    legs: {L: {flex: 80, abd: 8, knee: 100, ankle: 60}, R: {flex: 80, abd: 8, knee: 100, ankle: 60}},
    arms: {L: {flex: 110, abd: 15, elbow: 60}, R: {flex: 65, abd: 10, elbow: 5, hand: 'flat'}}},
};

/** The contract's envelope ranges (degrees from the bind; arms from hanging). */
export const ENVELOPE = {
  hipFlexion: [-25, 110], hipAbduction: [0, 40], kneeFlexion: [0, 135],
  shoulderFlexionFromHanging: [-30, 170], shoulderAbductionFromHanging: [0, 110], elbowFlexion: [0, 125],
  trunkForwardBend: [-25, 35], trunkTwist: [-25, 25], trunkSideBend: [-20, 20],
  neckPlusHeadExtension: [-30, 75], headYaw: [-70, 70], headRoll: [-25, 25],
};

/** Every envelope range end as a spec (one DOF at a time; legs / arms both sides; arm DOFs on otherwise hanging arms). */
export function envelopePoses() {
  const both = f => ({L: f('L'), R: f('R')});
  const out = [];
  for (const [k, [a, b]] of Object.entries(ENVELOPE)) for (const v of [a, b]) {
    let spec;
    switch (k) {
      case 'hipFlexion': spec = {legs: both(() => ({flex: v}))}; break;
      case 'hipAbduction': spec = {legs: both(() => ({abd: v}))}; break;
      // the knee folded with the thigh forward (the crawl / crouch case; a standing 135 deg fold is the same skin deformation)
      case 'kneeFlexion': spec = {legs: both(() => ({flex: 90, knee: v}))}; break;
      case 'shoulderFlexionFromHanging': spec = {arms: both(() => ({flex: v, abd: 10}))}; break;
      case 'shoulderAbductionFromHanging': spec = {arms: both(() => ({abd: v}))}; break;
      case 'elbowFlexion': spec = {arms: both(() => ({flex: 20, abd: 15, elbow: v}))}; break;
      case 'trunkForwardBend': spec = {spine: {bend: v}}; break;
      case 'trunkTwist': spec = {spine: {twist: v}}; break;
      case 'trunkSideBend': spec = {spine: {side: v}}; break;
      case 'neckPlusHeadExtension': spec = {neck: {ext: v}}; break;
      case 'headYaw': spec = {neck: {yaw: v}}; break;
      case 'headRoll': spec = {neck: {roll: v}}; break;
    }
    out.push({name: `${k} ${v}`, spec});
  }
  return out;
}
