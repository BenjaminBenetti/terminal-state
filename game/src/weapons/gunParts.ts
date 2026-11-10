// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): visible reloads on the held gun's MOVABLE PARTS.
// The weapon-variety models (assets/weaponVarietyModels.generated.ts `parts`) keep their movable pieces as separate named
// nodes: 'Magazine' on the box-magazine guns, and the coach gun's 'Barrels' turning about its 'Hinge' marker. The viewmodel
// (weapons/viewmodel.ts) finds them once per held model and poses them every frame from the WeaponController state:
//  - a MAGAZINE reload pulls the magazine out (down, out of the well), it is gone while the hand fetches the next one, then
//    the new one rises and seats (on the whole-model "seat" jolt at 60 %); magazinePartPose(progress);
//  - a BREAK reload turns the barrels down about the hinge as the action opens (shells go in while it is open) and back up as
//    it closes; barrelsAngle(WeaponController.actionOpen).
// A model without such nodes (the baseline pistol / rifle / shotgun / knife) gets no GunParts at all: nothing changes for it.
// Pure pose functions + a tiny node binder; no allocation per frame.

import * as THREE from 'three';

/** Magazine motion over the reload progress p (0..1): out, gone, in. Distances in model metres. */
export const MAG_PART = {
  /** How far (m, model -Y) the magazine travels out of the well before it is gone. */
  drop: 0.2,
  /** Progress window of the pull-out, the moment it is gone, and the window of the new magazine rising into the well. */
  out: [0.1, 0.3] as const,
  in: [0.42, 0.62] as const,
};

/** The coach gun's barrels drop this far (rad) about the hinge when fully open. */
export const BREAK_ANGLE = 0.62;

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Magazine pose at reload progress `p` (null = not reloading): `out` 0 = seated .. 1 = fully pulled out (MAG_PART.drop m
 * down); `visible` false while the hand fetches the next magazine (between the pull-out and the new one rising).
 */
export function magazinePartPose(p: number | null): {out: number; visible: boolean} {
  if (p === null) return {out: 0, visible: true};
  const [o0, o1] = MAG_PART.out, [i0, i1] = MAG_PART.in;
  if (p < o0) return {out: 0, visible: true};
  if (p < o1) return {out: ease((p - o0) / (o1 - o0)), visible: true};
  if (p < i0) return {out: 1, visible: false};
  if (p < i1) return {out: 1 - ease((p - i0) / (i1 - i0)), visible: true};
  return {out: 0, visible: true};
}

/** Barrel turn (rad about the model +X axis through the hinge; negative = the muzzle drops) for a break action `open` 0..1. */
export function barrelsAngle(open: number): number {
  return -BREAK_ANGLE * ease(clamp01(open));
}

interface PartBinding {
  node: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  /** Magazine: the fully-out offset; Barrels: the hinge point — both in the node's PARENT frame. */
  vec: THREE.Vector3;
  /** Barrels: the turn axis (model +X) in the node's parent frame. */
  axis?: THREE.Vector3;
}

/** The movable parts of one held model (viewmodel clone), bound once; `apply` poses them. */
export class GunParts {
  private constructor(readonly magazine: PartBinding | null, readonly barrels: PartBinding | null) {}
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();

  /**
   * Bind the 'Magazine' / 'Barrels' (+ 'Hinge' marker) nodes of `root` (the model, matrices current, BEFORE any held-pose
   * shift). Model-frame directions / points are converted into each part's parent frame, so a nested or scaled parent still
   * moves the part in model metres. Null when the model has neither part.
   */
  static find(root: THREE.Object3D): GunParts | null {
    root.updateMatrixWorld(true);
    const toParent = (node: THREE.Object3D) => {
      const m = new THREE.Matrix4().copy(root.matrixWorld);
      return node.parent ? new THREE.Matrix4().copy(node.parent.matrixWorld).invert().multiply(m) : m;
    };
    const bind = (node: THREE.Object3D, vec: THREE.Vector3, axis?: THREE.Vector3): PartBinding =>
      ({node, restPos: node.position.clone(), restQuat: node.quaternion.clone(), vec, axis});
    let magazine: PartBinding | null = null, barrels: PartBinding | null = null;
    const mag = root.getObjectByName('Magazine');
    if (mag && mag !== root) {
      const M = toParent(mag);
      // the fully-out offset = model (0, -drop, 0) expressed in the parent frame (difference of two transformed points)
      const out = new THREE.Vector3(0, -MAG_PART.drop, 0).applyMatrix4(M).sub(new THREE.Vector3().applyMatrix4(M));
      magazine = bind(mag, out);
    }
    const bar = root.getObjectByName('Barrels');
    if (bar && bar !== root) {
      const M = toParent(bar);
      const hingeObj = root.getObjectByName('Hinge');
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      let hingeModel: THREE.Vector3;
      if (hingeObj) hingeModel = hingeObj.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      else { // no marker: the rear-bottom of the barrels (where a break action's hinge pin sits)
        const box = new THREE.Box3().setFromObject(bar).applyMatrix4(inv);
        hingeModel = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, box.max.z);
      }
      const hinge = hingeModel.applyMatrix4(M);
      const axis = new THREE.Vector3(1, 0, 0).applyMatrix4(M).sub(new THREE.Vector3().applyMatrix4(M)).normalize();
      barrels = bind(bar, hinge, axis);
    }
    return magazine || barrels ? new GunParts(magazine, barrels) : null;
  }

  /**
   * Pose the parts: `magProgress` = the running magazine reload's progress (null = none: seated), `open` = the break
   * action's opening 0..1 (WeaponController.actionOpen).
   */
  apply(magProgress: number | null, open: number): void {
    const m = this.magazine;
    if (m) {
      const pose = magazinePartPose(magProgress);
      m.node.position.copy(m.restPos).addScaledVector(m.vec, pose.out);
      m.node.visible = pose.visible;
    }
    const b = this.barrels;
    if (b) {
      const a = barrelsAngle(open);
      this.q.setFromAxisAngle(b.axis!, a);
      b.node.quaternion.copy(this.q).multiply(b.restQuat);
      b.node.position.copy(this.v.copy(b.restPos).sub(b.vec).applyQuaternion(this.q).add(b.vec));
    }
  }
}
