// Pose math for hand-authored procedural clips: quaternions, FK, 2-bone leg IK with foot roll,
// and arm aiming by (bone direction, elbow hinge axis) frames. Bind orientations are identity
// (joint frames are world-aligned at bind), so local rotations read in world-like axes:
//   +X rotation pitches +Y toward +Z (forward bend), +Y yaws, +Z rolls +Y toward -X (char right).
import {JOINTS} from './skeleton.mjs';

export const D2R = Math.PI / 180;
export const qId = () => [0, 0, 0, 1];
export function qAxis(axis, deg) {
  const l = Math.hypot(...axis) || 1, h = deg * D2R / 2, s = Math.sin(h) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}
export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const qInv = q => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
export function qNorm(q) { const l = Math.hypot(...q) || 1; return q.map(v => v / l); }
/** Euler (degrees), applied yaw(Y) * pitch(X) * roll(Z). */
export function euler(x = 0, y = 0, z = 0) { return qMul(qAxis([0, 1, 0], y), qMul(qAxis([1, 0, 0], x), qAxis([0, 0, 1], z))); }
export function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map(v => -v) : b; d = Math.abs(d);
  if (d > 0.9995) return qNorm(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + bb[i] * Math.sin(t * th)) / s);
}
function qFromMat(m) { // m row-major 3x3 [m00,m01,m02,m10,...]
  const [a, b, c, d, e, f, g, h, i] = m, tr = a + e + i;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s]; }
  return qNorm(q);
}
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export {V};
/** Rotation taking frame (d0,h0) to (d1,h1); h is orthogonalized against d. */
export function frameRot(d0, h0, d1, h1) {
  const f = (d, h) => { const e1 = V.norm(d); const e2 = V.norm(V.sub(h, V.mul(e1, V.dot(h, e1)))); return [e1, e2, V.cross(e1, e2)]; };
  const A = f(d0, h0), B = f(d1, h1);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = B[0][r] * A[0][c] + B[1][r] * A[1][c] + B[2][r] * A[2][c];
  return qFromMat(m);
}

export class Rig {
  constructor(skel) {
    this.names = JOINTS.map(j => j[0]);
    this.parent = Object.fromEntries(JOINTS);
    this.bind = skel.joints;
    this.ends = skel.ends;
    this.heelZ = skel.heelZ;
    const b = this.bind;
    this.thighLen = V.len(V.sub(b.L_Shin, b.L_Thigh));
    this.shinLen = V.len(V.sub(b.L_Foot, b.L_Shin));
  }
  /** FK: local rotations {name: quat} + hips offset -> world {pos, rot} per joint. */
  fk(pose) {
    const out = {};
    for (const n of this.names) {
      const p = this.parent[n];
      const lr = pose.rot[n] || qId();
      if (!p) { out[n] = {pos: [0, 0, 0], rot: lr}; continue; }
      let off = V.sub(this.bind[n], this.bind[p]);
      if (n === 'Hips' && pose.hips) off = V.add(off, pose.hips);
      const P = out[p];
      out[n] = {pos: V.add(P.pos, qRot(P.rot, off)), rot: qMul(P.rot, lr)};
    }
    return out;
  }
  /** World rotation of Hips for a partial pose (Root is identity). */
  hipsWorld(pose) { return {rot: pose.rot.Hips || qId(), pos: V.add(this.bind.Hips, pose.hips || [0, 0, 0])}; }

  /**
   * Leg IK. foot = {z, x (lateral offset), lift, pitch (deg, +toes down/heel up pivoting at ball,
   * -toes up pivoting at heel), yaw (deg)}. Fills Thigh/Shin/Foot local rotations in pose.rot.
   */
  legIK(pose, side, foot) {
    const b = this.bind, sg = side === 'L' ? 1 : -1;
    const H = this.hipsWorld(pose);
    const hip = V.add(H.pos, qRot(H.rot, V.sub(b[side + '_Thigh'], b.Hips)));
    const A0 = b[side + '_Foot'];
    const toe = this.ends[side + '_Foot'];
    const ballZ = toe[2], heelZ = this.heelZ; // rigid boot: heel-up pivots at the toe tip so nothing dips below the floor
    const pitch = foot.pitch || 0, yaw = foot.yaw || 0;
    const qf = qMul(qAxis([0, 1, 0], yaw), qAxis([1, 0, 0], pitch));
    const pivot0 = [A0[0], 0, pitch >= 0 ? ballZ : heelZ];
    const ground = [A0[0] + (foot.x || 0) * sg, foot.lift || 0, (foot.z || 0) + pivot0[2]];
    const ankle = V.add(ground, qRot(qf, V.sub(A0, pivot0)));
    const a = this.thighLen, c = this.shinLen;
    let d = V.len(V.sub(ankle, hip));
    const u = V.norm(V.sub(ankle, hip));
    d = Math.min(Math.max(d, Math.abs(a - c) + 1e-3), (a + c) * 0.9995);
    const fwd = qRot(H.rot, V.norm([0.08 * sg, 0, 1]));
    const v = V.norm(V.sub(fwd, V.mul(u, V.dot(fwd, u))));
    const cosA = (a * a + d * d - c * c) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const knee = V.add(hip, V.add(V.mul(u, a * cosA), V.mul(v, a * sinA)));
    const ankleT = V.add(hip, V.mul(u, d));
    const dT = V.norm(V.sub(knee, hip)), dS = V.norm(V.sub(ankleT, knee));
    const hinge = V.norm(V.cross(v, u));
    const dT0 = V.norm(V.sub(b[side + '_Shin'], b[side + '_Thigh'])), dS0 = V.norm(V.sub(A0, b[side + '_Shin']));
    const Rt = frameRot(dT0, [1, 0, 0], dT, hinge);
    const Rs = frameRot(dS0, [1, 0, 0], dS, hinge);
    pose.rot[side + '_Thigh'] = qMul(qInv(H.rot), Rt);
    pose.rot[side + '_Shin'] = qMul(qInv(Rt), Rs);
    pose.rot[side + '_Foot'] = qMul(qInv(Rs), qf);
    return {ankle: ankleT, reach: V.len(V.sub(ankle, hip)) / (a + c)};
  }

  /**
   * Arm aim in the Chest frame. dir: upper-arm direction; hinge: elbow hinge axis (palm normal is
   * -(dir x hinge)); flex: elbow flexion (deg, + bends toward the hinge-rotation side); wrist (deg);
   * twist: hand twist about the forearm axis (deg).
   */
  armAim(pose, side, {dir, hinge, flex = 0, wrist = 0, twist = 0, wristSide = 0}) {
    const b = this.bind;
    const dU0 = V.norm(V.sub(b[side + '_Forearm'], b[side + '_UpperArm']));
    const dF0 = V.norm(V.sub(b[side + '_Hand'], b[side + '_Forearm']));
    const hU0 = V.norm(V.cross(dU0, [0, 0, 1]));
    const hF0 = V.norm(V.cross(dF0, [0, 0, 1]));
    pose.rot[side + '_UpperArm'] = frameRot(dU0, hU0, dir, hinge);
    pose.rot[side + '_Forearm'] = qAxis(hF0, flex);
    const dH0 = V.norm(V.sub(this.ends[side + '_Hand'], b[side + '_Hand']));
    const side0 = V.norm(V.cross(dH0, hF0));
    pose.rot[side + '_Hand'] = qMul(qAxis(dF0, twist), qMul(qAxis(hF0, wrist), qAxis(side0, wristSide)));
  }
}
