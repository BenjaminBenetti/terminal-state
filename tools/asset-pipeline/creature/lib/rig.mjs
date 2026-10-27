// Quadruped pose math: FK over the creature skeleton and a paw-planting leg IK (girdle joint ->
// lower joint -> foot joint solved as a 2-bone chain bending like the bind pose — elbows back,
// stifles forward — with the paw orientation given by a pitch about the toe tip).
// Quaternion helpers are the zombie pipeline's (identity bind rotations; +X rotation pitches +Y
// toward +Z, i.e. a forward-pointing bone tips DOWN).
import {qId, qAxis, qMul, qInv, qRot, frameRot, V} from '../../zombie/lib/pose.mjs';
import {JOINTS} from './skeleton.mjs';

export {qId, qAxis, qMul, qInv, qRot, V};
export const LEGS = ['L_Front', 'R_Front', 'L_Hind', 'R_Hind'];

export class QRig {
  constructor(skel) {
    this.names = JOINTS.map(j => j[0]);
    this.parent = Object.fromEntries(JOINTS);
    this.bind = skel.joints;
    this.ends = skel.ends;
    this.leg = {};
    for (const L of LEGS) {
      const b = this.bind, up = b[L + 'Upper'], lo = b[L + 'Lower'], ft = b[L + 'Foot'], toe = this.ends[L + 'Foot'];
      const a = V.len(V.sub(lo, up)), c = V.len(V.sub(ft, lo));
      const u0 = V.norm(V.sub(ft, up));
      // bind bend direction (pole): the lower joint's offset from the girdle->foot line
      const k0 = V.sub(lo, up);
      const pole0 = V.norm(V.sub(k0, V.mul(u0, V.dot(k0, u0))));
      this.leg[L] = {a, c, pole0, girdle: L.includes('Front') ? 'Chest' : 'Hips', toe, side: L[0] === 'L' ? 1 : -1,
        reachBind: V.len(V.sub(ft, up)) / (a + c)};
    }
  }

  /** FK: local rotations {name: quat} + hips offset (model space) -> world {pos, rot}. */
  fk(pose) {
    const out = {};
    for (const n of this.names) {
      const p = this.parent[n];
      const lr = (pose.rot && pose.rot[n]) || qId();
      if (!p) { out[n] = {pos: [0, 0, 0], rot: (pose.rot && pose.rot.Root) || qId()}; continue; }
      let off = V.sub(this.bind[n], this.bind[p]);
      if (n === 'Hips' && pose.hips) off = V.add(off, pose.hips);
      const P = out[p];
      out[n] = {pos: V.add(P.pos, qRot(P.rot, off)), rot: qMul(P.rot, lr)};
    }
    return out;
  }

  /**
   * Plant a paw. foot = {dz, dx (outward), lift, pitch (deg; + = heel up / toes folding back, pivot at
   * the toe tip)} relative to the bind toe tip on the floor (y = toe sole height). Fills
   * Upper/Lower/Foot local rotations. Returns {reach (0..1 of the chain), clamped}.
   */
  legIK(pose, L, foot) {
    const b = this.bind, info = this.leg[L];
    const W = this.fk(pose);
    const G = W[info.girdle];
    const upW = V.add(G.pos, qRot(G.rot, V.sub(b[L + 'Upper'], b[info.girdle])));
    const toe0 = info.toe;
    const toeT = [toe0[0] + (foot.dx || 0) * info.side, (foot.y ?? toe0[1]) + (foot.lift || 0), toe0[2] + (foot.dz || 0)];
    const qf = qMul(qAxis([0, 1, 0], foot.yaw || 0), qAxis([1, 0, 0], foot.pitch || 0));
    const footT = V.add(toeT, qRot(qf, V.sub(b[L + 'Foot'], toe0)));
    const {a, c} = info;
    let d = V.len(V.sub(footT, upW));
    const u = V.norm(V.sub(footT, upW));
    const clamped = d > (a + c) * 0.999;
    d = Math.min(Math.max(d, Math.abs(a - c) + 1e-3), (a + c) * 0.999);
    // pole follows the girdle's rotation
    const pole = qRot(G.rot, info.pole0);
    const v = V.norm(V.sub(pole, V.mul(u, V.dot(pole, u))));
    const cosA = (a * a + d * d - c * c) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const knee = V.add(upW, V.add(V.mul(u, a * cosA), V.mul(v, a * sinA)));
    const footReached = V.add(upW, V.mul(u, d));
    const dT = V.norm(V.sub(knee, upW)), dS = V.norm(V.sub(footReached, knee));
    const hinge = V.norm(V.cross(v, u));
    const dT0 = V.norm(V.sub(b[L + 'Lower'], b[L + 'Upper'])), dS0 = V.norm(V.sub(b[L + 'Foot'], b[L + 'Lower']));
    const u0 = V.norm(V.sub(b[L + 'Foot'], b[L + 'Upper']));
    const hinge0 = V.norm(V.cross(info.pole0, u0));
    const Rt = frameRot(dT0, hinge0, dT, hinge);
    const Rs = frameRot(dS0, hinge0, dS, hinge);
    pose.rot[L + 'Upper'] = qMul(qInv(G.rot), Rt);
    pose.rot[L + 'Lower'] = qMul(qInv(Rt), Rs);
    pose.rot[L + 'Foot'] = qMul(qInv(Rs), qf);
    return {reach: V.len(V.sub(footT, upW)) / (a + c), clamped};
  }
}
