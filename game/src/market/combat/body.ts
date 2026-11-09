// Task studio-market-rework-20261108-074144-01 (lane COMBAT): a market person AS A TARGET / SHOOTER — wraps its HumanActor (which stays a
// plain animated human, never an enemy):
//  - bone-attached hit volumes like a zombie's (ai/zombieActor.ts updateVolumes: a head sphere, a hips-neck torso capsule, four limb
//    capsules) with an ordinary zombie's gameplay radii (ai/wardrobe.ts REFERENCE_HIT x HIT_CALIBRATION: torso 0.20, arms 0.075, legs
//    0.10 m) and a head sphere placed on the human skull (the zombie formula sits on a hunched head), scaled by the person's stature;
//  - the physics ragdoll's target (physics/ragdoll.ts RagdollTarget: the shared 18-joint skeleton, identity bind rotations, so the
//    humanoid rig maps by joint name with the body's prefix);
//  - its gun: a clone of the player's own gun model (shared geometry / materials) in the right hand at the body's calibrated grip
//    (combatClips gripFor), hidden until drawn; the muzzle's world point for the flash and the round's origin;
//  - the aim's pitch on top of the clip (the chest turns about the model's left axis: arms and gun follow).
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {RayVolume} from '../../combat/enemyRay';
import type {RagdollTarget} from '../../physics/ragdoll';
import type {HumanActor} from '../humanActor';
import {GUN_MARKERS, type GunGrip} from './combatClips';
import type {MarketGunId} from './record';

/** Gameplay hit radii (model metres, x stature): an ordinary zombie's torso / limbs, a human head. */
export const HUMAN_HIT = {head: 0.125, torso: 0.2, arm: 0.075, leg: 0.1} as const;
const VOLUME_BONES = ['Hips', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;

export class HumanCombatBody implements RagdollTarget {
  readonly root: THREE.Object3D;
  readonly scale: number;
  readonly coated = false;
  /** The gun holder in the right hand (null: no gun model loaded). */
  gunHolder: THREE.Object3D | null = null;
  private muzzleLocal = new THREE.Vector3();
  private volumes: RayVolume[] = [];
  private stamp = -1;
  /** The pose (feet, yaw) the volumes were read at. */
  private readonly at = [NaN, NaN, NaN, NaN];
  /** Aim pitch (rad, + = up) applied on top of the clip, and its smoothing. */
  aimPitch = 0;
  private shownPitch = 0;
  /** Bone world positions of the last two animated frames (the ragdoll carries the motion on). */
  private readonly hist = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  private histDt = 0;
  /** The ragdoll moved the body (pelvis ground position). */
  onMoved: ((x: number, z: number) => void) | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(readonly actor: HumanActor) {
    this.root = actor.root;
    this.scale = actor.scale;
    actor.postPose = () => this.applyAim();
  }

  bone(name: string): THREE.Object3D | undefined { return this.actor.bone(name); }

  // ------------------------------------------------------------------------------------------------------------- hit volumes

  /** The volumes of the current pose (recomputed at most once per `frame` stamp). Dead / ragdolled: none. */
  hitVolumes(frame: number, alive: boolean): readonly RayVolume[] {
    if (!alive || this.actor.frozen) return (this.volumes = []);
    // (task studio-market-bar-20261108-225231-01, lane PEOPLE: also re-read when the body moved since — a shove / a placement within
    // one frame left a later ray testing where it had stood)
    const a = this.actor, at = this.at;
    if (frame === this.stamp && this.volumes.length && at[0] === a.x && at[1] === a.y && at[2] === a.z && at[3] === a.yaw) return this.volumes;
    this.stamp = frame;
    at[0] = a.x; at[1] = a.y; at[2] = a.z; at[3] = a.yaw;
    this.root.updateMatrixWorld(true);
    const p = (n: string) => { const b = this.actor.bone(n); return b ? this.tmp.setFromMatrixPosition(b.matrixWorld).clone() : new THREE.Vector3(this.actor.x, this.actor.y + 1, this.actor.z); };
    const s = this.scale, H = HUMAN_HIT;
    const head = p('Head'), neck = p('Neck');
    const up = head.clone().sub(neck).normalize();
    const hc = head.addScaledVector(up, 0.075 * s);
    const v = (a: THREE.Vector3) => ({x: a.x, y: a.y, z: a.z});
    this.volumes = [
      {part: 'head', a: v(hc), b: null, r: H.head * s},
      {part: 'torso', a: v(p('Hips')), b: v(neck), r: H.torso * s},
      {part: 'limb', a: v(p('L_UpperArm')), b: v(p('L_Hand')), r: H.arm * s},
      {part: 'limb', a: v(p('R_UpperArm')), b: v(p('R_Hand')), r: H.arm * s},
      {part: 'limb', a: v(p('L_Thigh')), b: v(p('L_Foot')), r: H.leg * s},
      {part: 'limb', a: v(p('R_Thigh')), b: v(p('R_Foot')), r: H.leg * s},
    ];
    return this.volumes;
  }

  // ------------------------------------------------------------------------------------------------------------- the gun

  /** Put a clone of `gltf` (the player's gun model) in the right hand at `grip`; hidden until drawn. */
  attachGun(gltf: GLTF, gun: MarketGunId, grip: GunGrip): THREE.Object3D | null {
    const hand = this.actor.bone('R_Hand');
    if (!hand) return null;
    const M = GUN_MARKERS[gun];
    const model = gltf.scene.clone(true);
    model.position.set(-M.grip[0], -M.grip[1], -M.grip[2]); // the Grip marker at the holder's origin
    const holder = new THREE.Group();
    holder.name = `market-gun-${gun}`;
    holder.add(model);
    holder.quaternion.copy(grip.rot);
    holder.position.copy(grip.pos);
    holder.visible = false;
    holder.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    hand.add(holder);
    this.gunHolder = holder;
    this.muzzleLocal.set(M.muzzle[0] - M.grip[0], M.muzzle[1] - M.grip[1], M.muzzle[2] - M.grip[2]);
    return holder;
  }

  set gunShown(v: boolean) { if (this.gunHolder) this.gunHolder.visible = v; }
  get gunShown(): boolean { return !!this.gunHolder?.visible; }

  /** The muzzle's world point (the root's matrices must be fresh: call after the frame's animate + sync). */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.gunHolder) return this.eyeWorld(out);
    this.root.updateMatrixWorld(true);
    return out.copy(this.muzzleLocal).applyMatrix4(this.gunHolder.matrixWorld);
  }

  /** Roughly the eyes (head joint + a little up / forward), world. */
  eyeWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.actor;
    return out.set(a.x + Math.sin(a.yaw) * 0.08, a.y + a.heightM - 0.11, a.z + Math.cos(a.yaw) * 0.08);
  }

  // ------------------------------------------------------------------------------------------------------------- aim pitch

  /** After each mixer step: the chest pitched by the (smoothed) aim angle about the model's left axis. */
  private applyAim(): void {
    this.shownPitch += (this.aimPitch - this.shownPitch) * 0.5;
    if (Math.abs(this.shownPitch) < 1e-3) return;
    const hips = this.actor.bone('Hips'), spine = this.actor.bone('Spine'), chest = this.actor.bone('Chest');
    if (!hips || !spine || !chest) return;
    const ws = this.qa.copy(hips.quaternion).multiply(spine.quaternion); // the spine's rotation in the model frame (Root is identity)
    const r = this.qb.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.shownPitch);
    // q' = Ws^-1 R Ws q
    const wsInv = ws.clone().invert();
    chest.quaternion.premultiply(wsInv.multiply(r).multiply(ws));
  }

  // ------------------------------------------------------------------------------------------------------------- ragdoll target

  /** Bone world positions of this frame (call after animate + sync for a moving person). */
  recordPose(dt: number): void {
    if (this.actor.frozen) return;
    this.root.updateMatrixWorld(true);
    for (const n of ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot']) {
      const b = this.actor.bone(n);
      if (!b) continue;
      let h = this.hist.get(n);
      if (!h) this.hist.set(n, (h = [new THREE.Vector3().setFromMatrixPosition(b.matrixWorld), new THREE.Vector3()]));
      h[1].copy(h[0]);
      h[0].setFromMatrixPosition(b.matrixWorld);
    }
    this.histDt = dt;
  }

  boneVelocity(name: string, out: THREE.Vector3): THREE.Vector3 {
    const h = this.hist.get(name);
    if (!h || this.histDt <= 1e-4) return out.set(0, 0, 0);
    return out.copy(h[0]).sub(h[1]).multiplyScalar(1 / this.histDt);
  }

  beginRagdoll(): void { this.actor.freezePose(); }

  setCullSphere(center: THREE.Vector3, radius: number): void {
    const inv = new THREE.Matrix4();
    for (const m of this.actor.meshes) {
      m.updateWorldMatrix(true, false);
      const s = m.matrixWorld.getMaxScaleOnAxis() || 1;
      m.boundingSphere = new THREE.Sphere(center.clone().applyMatrix4(inv.copy(m.matrixWorld).invert()), radius / s);
    }
  }

  ragdollMoved(x: number, z: number): void { this.onMoved?.(x, z); }
}

export const VOLUME_BONE_NAMES = VOLUME_BONES;
