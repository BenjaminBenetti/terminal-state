// Task studio-screacher-production-20261110-221858-01: the rendered SCREACHER — a skinned clone of one of the four variant GLBs
// (enemy-screacher-sc01..sc04.glb: one skinned body on the SHARED 18-joint humanoid skeleton, its own clips Idle / Walk / Run / Attack /
// Hit / Death + Scream, scene extras `enemyScreacher`; tools/asset-pipeline/enemy/build-screacher.mjs). The same actor surface as
// ai/strainerActor.ts (EnemyActor: brain, hit volumes, skinned meshes, ragdoll target, wounds), with what a HEADLESS body changes:
//   * NO head hit volume — live or as a corpse: a Hips -> Neck torso capsule (Neck = the base of the stump) and arm / leg capsules
//     only, so a shot at the empty air above the shoulders hits nothing and no hit is ever a 'head' hit (no head multiplier, no
//     skull-crack confirm, no headshot statistic). The rig keeps its technical Neck / Head joints (shared skeleton, clips, ragdoll
//     look-ups); they render nothing and are never a target;
//   * ragdoll: the humanoid rig WITHOUT its head part (headlessRagdollRig) — no invisible head sphere on the corpse;
//   * the Scream clip: played while the brain screams (ScreacherBrain.screaming), restarted per scream (screamSeq);
//   * brain: ScreacherBrain (ai/screacher.ts — blind, sound-driven); root scale SCREACHER_SCALE 0.97..1.03 (stump top ~2.0 m).
// The four variants are one enemy: the same class, stats and clip contract; only the GLB differs (spawn.variant).
// No model -> createEnemyActor's counted zombie stand-in (never a T-pose / box). It is never part of the zombie wardrobe.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import {SCREACHER_ASSET, SCREACHER_SCALE, ScreacherBrain, screacherVariantOf, type ScreacherVariantId} from './screacher';
import {HUMANOID_RIG, type RagdollRig} from '../physics/ragdoll';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitPart, HitVolume} from './zombieActor';
import type {MeshSlot} from './wardrobe';

/** GLB extras `enemyScreacher` (the asset contract). Every field is optional at runtime (SCREACHER_ASSET defaults). */
export interface ScreacherExtras {
  variant?: string;
  name?: string;
  heightM?: number;
  /** The centre of the neck stump's top, BIND pose, model metres (QA / voice; NOT a hit volume). */
  stump?: {top?: [number, number, number]};
  /** Horizontal reach (m) of the striking hand from the feet origin at the Attack hit frame. */
  reachM?: number;
  /** Seconds into the Attack clip when the hand lands. */
  attackHitTime?: number;
  /** Seconds into the Scream clip of the cry's peak (the echo scan). */
  screamCueTime?: number;
  clips?: Record<string, {duration?: number; loop?: boolean; groundSpeed?: number; impactTime?: number; cueTime?: number}>;
  /** Gameplay hit radii (model metres). */
  hitRadii?: {torso?: number; arm?: number; leg?: number};
  radius?: number;
}

/** The clips beyond the shared AnimName set. */
export type ScreacherClip = AnimName | 'Scream';

/** The skeleton joints the hit volumes read (shared 18-joint humanoid names; no Head: there is none to hit). */
export const SCREACHER_BONES = ['Hips', 'Neck', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;
/** The clips the asset contract promises (hasRig needs every one). */
export const SCREACHER_CLIPS: readonly ScreacherClip[] = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death', 'Scream'];

/** The humanoid ragdoll rig without its head part / joint (the stump rides the chest): no head sphere on a headless corpse. */
export function headlessRagdollRig(): RagdollRig {
  const {head: _head, ...joints} = HUMANOID_RIG.joints as Record<string, RagdollRig['joints'][string]>;
  void _head;
  return {...HUMANOID_RIG, parts: HUMANOID_RIG.parts.filter(p => p.name !== 'head').map(p => ({...p, spheres: [...p.spheres]})), joints, head: undefined};
}

/** Gameplay hit radii (model metres) from the extras, else SCREACHER_ASSET. No head. */
export function screacherHitRadii(e: ScreacherExtras): {torso: number; arm: number; leg: number} {
  const R = e.hitRadii ?? {}, D = SCREACHER_ASSET.hitRadii;
  return {torso: R.torso ?? D.torso, arm: R.arm ?? D.arm, leg: R.leg ?? D.leg};
}

export class ScreacherActor {
  readonly archetype = 'screacher' as const;
  /** Which approved body this one wears (spawn.variant; the same enemy either way). */
  readonly variant: ScreacherVariantId;
  readonly root: THREE.Object3D;
  readonly brain: ScreacherBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  /** Ragdoll sphere multipliers vs the reference rig (lanky; the registry clamp keeps them within 0.75..1.45). */
  readonly girth = {torso: 0.85, arm: 0.8, leg: 0.8};
  /** The headless ragdoll (no head part). */
  readonly ragdollRig: RagdollRig = headlessRagdollRig();
  readonly extras: ScreacherExtras;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: ScreacherClip | null = null;
  private lastAttackSeq = 0;
  private lastScreamSeq = 0;
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
  private readonly hit: {torso: number; arm: number; leg: number};
  /** How far (model m) below the Neck joint the torso capsule ends, so its round cap just reaches the stump's top and never the air above it. */
  private readonly torsoPull: number;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpInv = new THREE.Matrix4();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.extras = (gltf.scene.userData.enemyScreacher ?? {}) as ScreacherExtras;
    this.variant = screacherVariantOf(spawn);
    this.hit = screacherHitRadii(this.extras);
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = `enemy-screacher-${this.variant}`;
    this.brain = new ScreacherBrain(spawn.x, spawn.z, spawn.yaw);
    this.scale = SCREACHER_SCALE.min + rand() * (SCREACHER_SCALE.max - SCREACHER_SCALE.min);
    this.root.scale.setScalar(this.scale);
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // covers standing, reaching and lying poses of the tall body (skinned bounds do not follow the animation)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.1);
        this.skinned.push(m);
        m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'screacher'};
        if (m.visible) this.meshes.push(m);
      }
      // per-actor clones: hitting / wounding one Screacher never marks another sharing the GLB template (the Meshy maps as they are)
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    for (const n of SCREACHER_BONES) { const b = this.root.getObjectByName(n); if (b) this.bones.set(n, b); }
    this.root.traverse(o => { if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) { this.allBones.set(o.name, o); this.boneList.push(o); } });
    this.histCur = new Float32Array(this.boneList.length * 3);
    this.histPrev = new Float32Array(this.boneList.length * 3);
    // (the clone is still in its rest pose here, at the origin: the Neck joint's own height under the stump's top)
    this.root.updateMatrixWorld(true);
    const neck = this.allBones.get('Neck');
    const gap = neck ? Math.max(0, (this.extras.stump?.top?.[1] ?? SCREACHER_ASSET.heightM) - this.tmp.setFromMatrixPosition(neck.matrixWorld).y / this.scale) : this.hit.torso;
    this.torsoPull = Math.max(0, this.hit.torso - gap);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'Attack' || clip.name === 'Hit' || clip.name === 'Death' || clip.name === 'Scream') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(clip.name, a);
    }
    this.groanT = 2 + rand() * 6;
    this.play('Idle', 0);
    const idle = this.actions.get('Idle');
    if (idle) idle.time = rand() * idle.getClip().duration;
    this.syncTransform();
  }

  /** Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): an authored clip by name (a carried body's resting pose: the Death clip's end frame). */
  authoredClip(name: string): THREE.AnimationClip | null {
    return this.actions.get(name)?.getClip() ?? null;
  }

  get hasRig(): boolean {
    return this.bones.size === SCREACHER_BONES.length && SCREACHER_CLIPS.every(c => this.actions.has(c));
  }

  /** Lanky body: no coat padding on the ragdoll. */
  get coated(): boolean {
    return false;
  }

  /** Ground speed (m/s) a locomotion clip was authored for at timeScale 1 (extras, else SCREACHER_ASSET). */
  clipSpeed(name: 'Walk' | 'Run'): number {
    return this.extras.clips?.[name]?.groundSpeed || (name === 'Walk' ? SCREACHER_ASSET.walkGroundSpeed : SCREACHER_ASSET.runGroundSpeed);
  }

  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? 'body' : null;
  }

  private forEachMaterial(fn: (m: THREE.Material) => void): void {
    for (const mesh of this.skinned) { const mat = mesh.material; if (Array.isArray(mat)) mat.forEach(fn); else fn(mat); }
  }

  play(name: ScreacherClip, fade = 0.2): void {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (this.current === name && name !== 'Attack' && name !== 'Scream') return;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  /** Current clip (QA). */
  get clip(): ScreacherClip | null {
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
    const B = this.brain;
    if (B.alive && B.screaming) {
      // the echolocation scream: one play per scream (the clip clamps on its last frame until the brain moves on)
      if (B.screamSeq !== this.lastScreamSeq) { this.lastScreamSeq = B.screamSeq; this.current = null; this.play('Scream', 0.12); }
      else if (this.current !== 'Scream') this.play('Scream', 0.12);
    } else if (anim === 'Attack' && this.brain.attackSeq !== this.lastAttackSeq) {
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

  /**
   * Hips -> Neck torso (Neck = the base of the stump), arms, legs from the current pose (matrixWorld fresh). NO head volume: the
   * torso capsule stops short of the Neck joint by torsoPull, so its cap ends at the stump's top — a shot over the stump hits nothing.
   */
  private computeVolumes(): HitVolume[] {
    const s = this.scale, H = this.hit;
    const v = (part: HitPart, a: Vec3, b: Vec3 | null, r: number): HitVolume => ({part, a, b, r: r * s});
    const hips = this.at('Hips'), top = this.at('Neck');
    const dx = top.x - hips.x, dy = top.y - hips.y, dz = top.z - hips.z, len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const k = Math.max(0, 1 - this.torsoPull * s / len);
      top.x = hips.x + dx * k; top.y = hips.y + dy * k; top.z = hips.z + dz * k;
    }
    return [
      v('torso', hips, top, H.torso),
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

  /** Corpse volumes (damage/system.ts reads this instead of the humanoid defaults, which would add a head sphere at the Head joint). */
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
