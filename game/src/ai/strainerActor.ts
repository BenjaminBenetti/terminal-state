// Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): the rendered STRAINER — a skinned clone of lane ASSET's
// enemy-strainer.glb (one skinned body on the SHARED 18-joint humanoid skeleton, its own clips Idle / Walk / Run / Attack / Hit /
// Death, scene extras `enemyStrainer`). The same actor surface as ai/zombieActor.ts / ai/blightbellyActor.ts (EnemyActor: brain, hit
// volumes, skinned meshes, ragdoll target, wounds) — the Blightbelly actor minus its belly / pustules / burst:
//   * brain: StrainerBrain (ai/strainer.ts — the ordinary zombie brain, Strainer stats, no ladder links); claw contact = the brain's
//     attackImpact = the Attack clip's attackHitTime (STRAINER_ASSET, = the GLB's extras once it lands);
//   * root scale: its OWN narrow jitter STRAINER_SCALE 0.97..1.03 (crown under ~2.25 m; annex doors are 2.3 m);
//   * locomotion clips time-scaled by THEIR authored ground speeds (extras clips.*.groundSpeed, else STRAINER_ASSET);
//   * hit volumes: a HEAD sphere at the extras headCenter / headRadius (the head is hunched FORWARD of the body; the bind-pose centre
//     is carried in the Head bone's frame so it follows every clip; x the actor scale), a Hips -> Neck torso capsule and arm / leg
//     capsules — ordinary body hits elsewhere; corpse volumes from the same radii;
//   * ragdoll: the humanoid rig (HUMANOID_RIG: the shared skeleton's names) with a lanky girth; death / corpse through the existing
//     contracts (damage system, physics ragdoll, run memory).
// No model -> createEnemyActor's counted zombie stand-in (never a T-pose / slide). It is never part of the zombie wardrobe.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import {STRAINER_ASSET, STRAINER_SCALE, StrainerBrain} from './strainer';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitPart, HitVolume} from './zombieActor';
import type {MeshSlot} from './wardrobe';

/** GLB extras `enemyStrainer` (lane ASSET contract). Every field is optional at runtime (STRAINER_ASSET defaults). */
export interface StrainerExtras {
  heightM?: number;
  /** Head hit-sphere centre, BIND pose, model metres (+Z forward). */
  headCenter?: [number, number, number];
  headRadius?: number;
  /** Horizontal claw reach (m) from the feet origin at the Attack hit frame. */
  reachM?: number;
  /** Seconds into the Attack clip when the claws land. */
  attackHitTime?: number;
  clips?: Record<string, {duration?: number; loop?: boolean; groundSpeed?: number}>;
  /** Optional gameplay hit radii (model metres). */
  hitRadii?: {torso?: number; arm?: number; leg?: number};
  radius?: number;
}

/** The skeleton joints the hit volumes read (shared 18-joint humanoid names). */
export const STRAINER_BONES = ['Hips', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;
/** The clips the asset contract promises (hasRig needs every one). */
export const STRAINER_CLIPS: readonly AnimName[] = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];

/** Gameplay hit radii (model metres) from the extras, else STRAINER_ASSET. */
export function strainerHitRadii(e: StrainerExtras): {head: number; torso: number; arm: number; leg: number} {
  const R = e.hitRadii ?? {}, D = STRAINER_ASSET.hitRadii;
  return {head: e.headRadius ?? STRAINER_ASSET.headRadius, torso: R.torso ?? D.torso, arm: R.arm ?? D.arm, leg: R.leg ?? D.leg};
}

export class StrainerActor {
  readonly archetype = 'strainer' as const;
  readonly root: THREE.Object3D;
  readonly brain: StrainerBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  /** Ragdoll sphere multipliers vs the reference rig (lanky; the registry clamp keeps them within 0.75..1.45). */
  readonly girth = {torso: 0.9, arm: 0.85, leg: 0.9};
  readonly extras: StrainerExtras;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private lastAttackSeq = 0;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly allBones = new Map<string, THREE.Object3D>();
  private readonly boneList: THREE.Object3D[] = [];
  private readonly skinned: THREE.SkinnedMesh[] = [];
  private readonly ownMaterials = new Set<THREE.Material>();
  private histCur = new Float32Array(0);
  private histPrev = new Float32Array(0);
  private histFrames = 0;
  private histDt = 0;
  private lastDt = 0;
  private volumes: HitVolume[] = [];
  private readonly hit: {head: number; torso: number; arm: number; leg: number};
  /** The bind-pose head centre in the Head bone's local frame (null: no Head bone — the zombie's head rule). */
  private readonly headLocal: readonly [number, number, number] | null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpInv = new THREE.Matrix4();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.extras = (gltf.scene.userData.enemyStrainer ?? {}) as StrainerExtras;
    this.hit = strainerHitRadii(this.extras);
    // the head centre (bind pose, model metres) -> the Head bone's local frame, measured on the template at scale 1 before cloning
    const headBone = gltf.scene.getObjectByName('Head');
    if (headBone) {
      gltf.scene.updateMatrixWorld(true);
      const c = this.extras.headCenter ?? STRAINER_ASSET.headCenter;
      const p = new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(new THREE.Matrix4().copy(headBone.matrixWorld).invert());
      this.headLocal = [p.x, p.y, p.z];
    } else this.headLocal = null;
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = 'enemy-strainer';
    this.brain = new StrainerBrain(spawn.x, spawn.z, spawn.yaw);
    this.scale = STRAINER_SCALE.min + rand() * (STRAINER_SCALE.max - STRAINER_SCALE.min);
    this.root.scale.setScalar(this.scale);
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // covers standing, reaching and lying poses of the tall body (skinned bounds do not follow the animation)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.2);
        this.skinned.push(m);
        m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'strainer'};
        if (m.visible) this.meshes.push(m);
      }
      // per-actor clones: hitting / wounding one Strainer never marks another sharing the GLB template
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    for (const n of STRAINER_BONES) { const b = this.root.getObjectByName(n); if (b) this.bones.set(n, b); }
    this.root.traverse(o => { if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) { this.allBones.set(o.name, o); this.boneList.push(o); } });
    this.histCur = new Float32Array(this.boneList.length * 3);
    this.histPrev = new Float32Array(this.boneList.length * 3);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'Attack' || clip.name === 'Hit' || clip.name === 'Death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(clip.name, a);
    }
    this.groanT = 2 + rand() * 6;
    this.play('Idle', 0);
    const idle = this.actions.get('Idle');
    if (idle) idle.time = rand() * idle.getClip().duration;
    this.syncTransform();
  }

  get hasRig(): boolean {
    return this.bones.size === STRAINER_BONES.length && STRAINER_CLIPS.every(c => this.actions.has(c));
  }

  /** Lanky body: no coat padding on the ragdoll. */
  get coated(): boolean {
    return false;
  }

  /** Ground speed (m/s) a locomotion clip was authored for at timeScale 1 (extras, else STRAINER_ASSET). */
  clipSpeed(name: 'Walk' | 'Run'): number {
    return this.extras.clips?.[name]?.groundSpeed || (name === 'Walk' ? STRAINER_ASSET.walkGroundSpeed : STRAINER_ASSET.runGroundSpeed);
  }

  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? 'body' : null;
  }

  private forEachMaterial(fn: (m: THREE.Material) => void): void {
    for (const mesh of this.skinned) { const mat = mesh.material; if (Array.isArray(mat)) mat.forEach(fn); else fn(mat); }
  }

  play(name: AnimName, fade = 0.2): void {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (this.current === name && name !== 'Attack') return;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  /** Current clip (QA). */
  get clip(): AnimName | null {
    return this.current;
  }

  syncTransform(): void {
    if (this.ragdolled) return;
    this.root.position.set(this.brain.x, this.root.position.y, this.brain.z);
    this.root.rotation.y = this.brain.yaw;
  }

  animate(dt: number, anim: AnimName, speed: number): void {
    this.lastDt = dt;
    if (this.ragdolled) { this.fadeFlash(dt); return; }
    if (anim === 'Attack' && this.brain.attackSeq !== this.lastAttackSeq) {
      this.lastAttackSeq = this.brain.attackSeq;
      this.current = null;
      this.play('Attack', 0.12);
    } else if (anim !== 'Attack' || this.current !== 'Attack') {
      this.play(anim, anim === 'Death' ? 0.12 : 0.22);
    }
    const a = this.current ? this.actions.get(this.current) : null;
    if (a && (this.current === 'Walk' || this.current === 'Run')) {
      a.setEffectiveTimeScale(Math.max(0.35, Math.min(1.8, speed / (this.clipSpeed(this.current) * this.scale))) || 1);
    }
    this.mixer.update(dt);
    this.fadeFlash(dt);
  }

  private fadeFlash(dt: number): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      const f = this.hitFlash;
      this.forEachMaterial(m => { (m as THREE.MeshStandardMaterial).emissive?.setRGB(f * 0.45, f * 0.12, f * 0.08); });
    }
  }

  /** World position of a bone (optionally + a bone-local offset in model metres; matrixWorld must be fresh). */
  private at(bone: string, local?: readonly number[] | null): Vec3 {
    const b = this.allBones.get(bone);
    if (!b) return {x: this.brain.x, y: this.brain.y + 1.2, z: this.brain.z};
    if (local) this.tmp.set(local[0], local[1], local[2]).applyMatrix4(b.matrixWorld);
    else this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /** Head (the contract's hunched-forward sphere), Hips -> Neck torso, arms, legs from the current pose (matrixWorld fresh). */
  private computeVolumes(): HitVolume[] {
    const s = this.scale, H = this.hit;
    const v = (part: HitPart, a: Vec3, b: Vec3 | null, r: number): HitVolume => ({part, a, b, r: r * s});
    let head: Vec3;
    if (this.headLocal) head = this.at('Head', this.headLocal);
    else {
      // no Head bone (never with the contract GLB): the zombie's rule (beyond the head joint, away from the neck)
      const h = this.at('Head'), n = this.at('Neck');
      head = {x: h.x + (h.x - n.x) * 0.6, y: h.y + 0.09 * s, z: h.z + (h.z - n.z) * 0.6};
    }
    return [
      v('head', head, null, H.head),
      v('torso', this.at('Hips'), this.at('Neck'), H.torso),
      v('limb', this.at('L_UpperArm'), this.at('L_Hand'), H.arm),
      v('limb', this.at('R_UpperArm'), this.at('R_Hand'), H.arm),
      v('limb', this.at('L_Thigh'), this.at('L_Foot'), H.leg),
      v('limb', this.at('R_Thigh'), this.at('R_Foot'), H.leg),
    ];
  }

  /** Refresh hit volumes from the current pose (call after animate + world matrix update). */
  updateVolumes(): HitVolume[] {
    if (!this.brain.alive) { this.volumes = []; return this.volumes; }
    this.root.updateMatrixWorld(true);
    this.recordPose();
    this.volumes = this.computeVolumes();
    return this.volumes;
  }

  get hitVolumes(): HitVolume[] {
    return this.volumes;
  }

  /** Corpse volumes (damage/system.ts reads this instead of the thin humanoid defaults). */
  corpseVolumes(): HitVolume[] {
    this.root.updateMatrixWorld(true);
    return this.computeVolumes();
  }

  // --- RagdollTarget -------------------------------------------------------------------------
  bone(name: string): THREE.Object3D | undefined {
    return this.allBones.get(name);
  }

  private recordPose(): void {
    const t = this.histPrev;
    this.histPrev = this.histCur;
    this.histCur = t;
    const e = this.histCur;
    for (let i = 0; i < this.boneList.length; i++) {
      const m = this.boneList[i].matrixWorld.elements;
      e[i * 3] = m[12]; e[i * 3 + 1] = m[13]; e[i * 3 + 2] = m[14];
    }
    this.histDt = this.lastDt;
    this.histFrames++;
  }

  boneVelocity(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.allBones.get(name);
    const i = b ? this.boneList.indexOf(b) : -1;
    if (i < 0 || this.histFrames < 2 || this.histDt <= 1e-4) return out.set(0, 0, 0);
    const c = this.histCur, p = this.histPrev, k = 1 / this.histDt;
    return out.set((c[i * 3] - p[i * 3]) * k, (c[i * 3 + 1] - p[i * 3 + 1]) * k, (c[i * 3 + 2] - p[i * 3 + 2]) * k);
  }

  beginRagdoll(): void {
    if (this.ragdolled) return;
    const saved = this.boneList.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    this.mixer.stopAllAction();
    this.boneList.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
    this.current = null;
    this.ragdolled = true;
  }

  setCullSphere(center: THREE.Vector3, radius: number): void {
    for (const m of this.skinned) {
      m.updateWorldMatrix(true, false);
      const s = m.matrixWorld.getMaxScaleOnAxis() || 1;
      m.boundingSphere!.center.copy(center).applyMatrix4(this.tmpInv.copy(m.matrixWorld).invert());
      m.boundingSphere!.radius = Math.max(1.0, radius) / s;
    }
  }

  ragdollMoved(x: number, z: number): void {
    this.brain.x = x;
    this.brain.z = z;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.dispose(); });
    const all = new Set<THREE.Material>(this.ownMaterials);
    this.forEachMaterial(m => all.add(m));
    for (const m of all) m.dispose();
    this.ownMaterials.clear();
  }
}
