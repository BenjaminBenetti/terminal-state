// Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): visible reloads on the held gun's MOVABLE PARTS.
// The weapon-variety models (assets/weaponVarietyModels.generated.ts `parts`) keep their movable pieces as separate named
// nodes: 'Magazine' on the box-magazine guns, and the coach gun's 'Barrels' turning about its 'Hinge' marker. The viewmodel
// (weapons/viewmodel.ts) finds them once per held model and poses them every frame from the WeaponController state:
//  - a MAGAZINE reload pulls the magazine out (down, out of the well), it is gone while the hand fetches the next one, then
//    the new one rises and seats (on the whole-model "seat" jolt at 60 %); magazinePartPose(progress);
//  - a BREAK reload turns the barrels down about the hinge as the action opens (shells go in while it is open) and back up as
//    it closes; barrelsAngle(WeaponController.actionOpen);
//  - (task studio-turnstile-cylinder-rotation-20261112-034833-01, the user: "I want it to rotate as you shoot!") a revolver's
//    'Cylinder' (the Turnstile's: a child of its 'Barrels', so it breaks open with them) turns about its own axis one chamber per
//    actual shot (Viewmodel.fire -> index(); cylinderTurn). (task studio-turnstile-reload-visuals-20261112-063646-01: chamberIndex = the chamber
//    under the barrel, where weapons/cylinderRounds.ts lays out the live rounds and fired hulls.)
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

/**
 * A revolver cylinder's index per shot: one chamber = a 1 / chambers turn (the gun's magazine: the Turnstile's six shells -> 60 deg),
 * clockwise seen from behind, eased over `time` s starting `delay` s after the shot. The delay: the Viewmodel's visual kick throws the
 * gun ~30 deg muzzle-up for the first ~0.2 s, so the turn runs as it comes back down (seen at the hip and through the sights) and is done
 * by 0.37 s, before the Turnstile's next shot can come (0.55 s). Visual only.
 */
export const CYLINDER_INDEX = {delay: 0.15, time: 0.22};

/** The cylinder's turn (rad, applied clockwise seen from behind) `t` s after the shot of an index from `from` to `to`. */
export function cylinderTurn(from: number, to: number, t: number): number {
  return from + (to - from) * ease(clamp01((t - CYLINDER_INDEX.delay) / CYLINDER_INDEX.time));
}

interface PartBinding {
  node: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  /** Magazine: the fully-out offset; Barrels: the hinge point; Cylinder: its pivot (= its rest position) — all in the node's PARENT frame. */
  vec: THREE.Vector3;
  /** Barrels: the turn axis (model +X) in the node's parent frame; Cylinder: its own axis (model +Z). */
  axis?: THREE.Vector3;
}

/** The movable parts of one held model (viewmodel clone), bound once; `apply` poses them. */
export class GunParts {
  private constructor(readonly magazine: PartBinding | null, readonly barrels: PartBinding | null, readonly cylinder: PartBinding | null, private readonly chambers: number) {
    this.step = 2 * Math.PI / chambers;
  }
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  /** Cylinder: one chamber's turn (rad), the index running from `from` to `to` (rad), `t` s after its shot. */
  private readonly step: number;
  private from = 0;
  private to = 0;
  private t = CYLINDER_INDEX.delay + CYLINDER_INDEX.time;

  /**
   * Bind the 'Magazine' / 'Barrels' (+ 'Hinge' marker) / 'Cylinder' nodes of `root` (the model, matrices current, BEFORE any
   * held-pose shift). Model-frame directions / points are converted into each part's parent frame, so a nested or scaled parent
   * still moves the part in model metres. A Cylinder turns about model +Z through its node's origin (the cook puts it on the
   * cylinder's own axis), `chambers` (the gun's magazine) per turn. Null when the model has none of these parts.
   */
  static find(root: THREE.Object3D, chambers = 6): GunParts | null {
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
    let cylinder: PartBinding | null = null;
    const cyl = root.getObjectByName('Cylinder');
    if (cyl && cyl !== root) {
      const M = toParent(cyl);
      const axis = new THREE.Vector3(0, 0, 1).applyMatrix4(M).sub(new THREE.Vector3().applyMatrix4(M)).normalize();
      cylinder = bind(cyl, cyl.position.clone(), axis);
    }
    return magazine || barrels || cylinder ? new GunParts(magazine, barrels, cylinder, Math.max(1, chambers)) : null;
  }

  /**
   * One actual shot (Viewmodel.fire): the cylinder, if any, starts turning to the next chamber from where it is now (a shot
   * during an unfinished index carries on from there). Nothing else moves.
   */
  index(): void {
    if (!this.cylinder) return;
    this.from = cylinderTurn(this.from, this.to, this.t);
    this.to += this.step;
    this.t = 0;
    if (this.to >= 2 * Math.PI - 1e-9) { this.from -= 2 * Math.PI; this.to -= 2 * Math.PI; } // a full turn is the start again
  }

  /** The cylinder's current turn (rad, clockwise seen from behind; 0 without a cylinder). */
  get cylinderAngle(): number {
    return this.cylinder ? cylinderTurn(this.from, this.to, this.t) : 0;
  }

  /**
   * (task studio-turnstile-reload-visuals-20261112-063646-01) The chamber under the barrel (0 .. chambers - 1; the cylinder's own chamber 0
   * at rest): the one the last index turns to — at once on a shot, while the turn still runs. 0 without a cylinder.
   */
  get chamberIndex(): number {
    const n = this.chambers;
    return this.cylinder ? ((Math.round(this.to / this.step) % n) + n) % n : 0; // (a full turn wraps `to` to ~0, maybe -0: always 0 .. n - 1)
  }

  /**
   * Pose the parts: `magProgress` = the running magazine reload's progress (null = none: seated), `open` = the break
   * action's opening 0..1 (WeaponController.actionOpen); `dt` (s) advances a running cylinder index.
   */
  apply(magProgress: number | null, open: number, dt = 0): void {
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
    const c = this.cylinder;
    if (c) {
      this.t = Math.min(CYLINDER_INDEX.delay + CYLINDER_INDEX.time, this.t + dt);
      // about the node's own origin (its rest position, on the axis): only the orientation changes
      c.node.quaternion.copy(this.q.setFromAxisAngle(c.axis!, -this.cylinderAngle)).multiply(c.restQuat);
    }
  }
}
