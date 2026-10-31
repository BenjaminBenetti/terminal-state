// Task track1-siren-blightbelly-20261031 (lane BLIGHT): the rendered Blightbelly — a skinned clone of lane RIGB's derivative
// enemy-blightbelly.glb (shared 18-joint humanoid skeleton, its own heavy clips Idle / Walk / Run / Attack / Hit / Death and
// the GLB extras `enemyBlightbelly`: clip contract, hit radii, collider radius, pustule burst points). Structurally the same
// actor surface as ai/zombieActor.ts (EnemyActor: brain, hit volumes, skinned meshes, ragdoll target, wounds), with:
//   * brain: BlightbellyBrain (ai/blightbelly.ts — the ordinary zombie brain, Blightbelly stats, the once-only death report);
//   * locomotion clips time-scaled by THEIR authored ground speeds (extras clips.*.groundSpeed), not the zombie's;
//   * hit volumes: head sphere, Hips -> Neck torso capsule, a BELLY sphere in front of the spine (the target everybody aims
//     at), arm / leg capsules — radii from the extras `hitRadii` (model metres x actor scale);
//   * ragdoll: an OBESE humanoid rig (HUMANOID_RIG's joints with heavier, fatter pelvis / torso parts incl. the belly) so the
//     corpse rests on its belly / back instead of sinking the belly into the floor; corpse volumes from the same radii;
//   * pustules: the separate pustule skinned mesh (RIGB: domes sharing the skin) is hidden when they pop (popPustules, once);
//     `pustulePoints()` = the world burst points (bone + offset) for the burst VFX.
// It is never part of the zombie wardrobe (ai/outfits.ts): ordinary zombies never pick this body.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import {BlightbellyBrain} from './blightbelly';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitPart, HitVolume} from './zombieActor';
import {HUMANOID_RIG, type RagdollPartSpec, type RagdollRig} from '../physics/ragdoll';
import {HIT_CALIBRATION, type MeshSlot} from './wardrobe';

/** Belly sphere: centre relative to a bone (bind frame = model frame, model metres) and radius. */
export interface BellySpec { bone?: string; offset?: [number, number, number]; r?: number }

/** GLB extras `enemyBlightbelly` (lane RIGB). Every field is optional at runtime (defaults below). */
export interface BlightbellyExtras {
  clips?: Record<string, {duration?: number; loop?: boolean; groundSpeed?: number; impactTime?: number; burstTime?: number}>;
  /** Measured radii (model metres; RIGB: torso = 75th pct to the spine chain, torsoP90, belly = front-torso sphere, limbs x1.35 / x1.4). */
  hitRadii?: {head?: number; torso?: number; torsoP90?: number; arm?: number; leg?: number; belly?: number | BellySpec};
  radius?: number;
  heightM?: number;
  bodyMesh?: string;
  pustuleMesh?: string;
  pustules?: {bone: string; offset: [number, number, number]; r: number; normal?: [number, number, number]}[];
  /** Measured body footprint (bind, model metres): the belly front / back (RIGB). */
  footprint?: {torsoFrontZ?: number; torsoBackZ?: number};
}

/** Defaults (model metres) used only when the extras omit a value (RIGB's measured values, enemy-blightbelly.glb v1). */
export const BLIGHT_HIT_DEFAULTS = {head: 0.1066, torso: 0.352, belly: 0.356, arm: 0.1036, leg: 0.1638} as const;
const BELLY_DEFAULT = {bone: 'Spine', offset: [0.015, -0.046, 0.156] as [number, number, number]};
/**
 * Gameplay hit radii from the measured ones: head / arms / legs through the SAME measured -> gameplay calibration as every
 * zombie body (ai/wardrobe.ts HIT_CALIBRATION; RIGB measured them with the zombie pipeline's method); the torso capsule uses
 * the measured 90th percentile (the body is already wide — the zombie torso calibration would push the capsule past the
 * back / shoulders); the belly sphere its measured radius, clamped by the actor so it never pokes out of the belly front.
 */
export function blightHitRadii(e: BlightbellyExtras): {head: number; torso: number; belly: number; arm: number; leg: number} {
  const R = e.hitRadii ?? {}, K = HIT_CALIBRATION;
  const bellyR = typeof R.belly === 'number' ? R.belly : R.belly?.r;
  return {head: (R.head ?? BLIGHT_HIT_DEFAULTS.head) * K.head, torso: Math.max(R.torsoP90 ?? 0, R.torso ?? 0) || BLIGHT_HIT_DEFAULTS.torso,
    belly: bellyR ?? BLIGHT_HIT_DEFAULTS.belly, arm: (R.arm ?? BLIGHT_HIT_DEFAULTS.arm) * K.arm, leg: (R.leg ?? BLIGHT_HIT_DEFAULTS.leg) * K.leg};
}

const TORSO_FWD = [0, 0, 0.06] as const, CHEST_FWD = [0, 0.02, 0.06] as const;
const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;
const CLIPS: readonly AnimName[] = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];

/**
 * The obese ragdoll: HUMANOID_RIG's 11 parts / joints, the pelvis and torso fattened (two hip / flank spheres + a forward
 * belly sphere each; girth 'none' so the registry clamp does not shrink them) and heavier (pelvis 24 kg, torso 44 kg; limbs
 * keep the humanoid specs, thickened by the actor's girth). Offsets: bind-aligned bone frames, unscaled model metres.
 */
export function obeseRagdollRig(): RagdollRig {
  const parts: RagdollPartSpec[] = HUMANOID_RIG.parts.map(p => {
    // RIGB's bind skeleton: Hips y 0.69 / z -0.11, Spine 0.97 / -0.06, Chest 1.30 / -0.11; the body spans z -0.35 .. +0.30
    if (p.name === 'pelvis') return {...p, mass: 24, girth: 'none', coat: 1,
      spheres: [{at: [0.14, 0.02, 0.02], r: 0.17}, {at: [-0.14, 0.02, 0.02], r: 0.17}, {at: [0, 0.12, 0.18], r: 0.2}]};
    if (p.name === 'torso') return {...p, mass: 44, girth: 'none', coat: 1,
      spheres: [{at: [0.13, 0.05, 0.0], r: 0.2}, {at: [-0.13, 0.05, 0.0], r: 0.2}, {at: [0, -0.02, 0.16], r: 0.22},
        {at: [0.13, 0.08, 0.04], bone: 'Chest', r: 0.16}, {at: [-0.13, 0.08, 0.04], bone: 'Chest', r: 0.16}]};
    return {...p, spheres: [...p.spheres]};
  });
  return {...HUMANOID_RIG, parts};
}

export class BlightbellyActor {
  readonly archetype = 'blightbelly' as const;
  readonly root: THREE.Object3D;
  readonly brain: BlightbellyBrain;
  /** Visible body skinned meshes (wounds / hit flash); the pustule mesh is separate (`pustuleMeshes`). */
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly pustuleMeshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  readonly ragdollRig: RagdollRig = obeseRagdollRig();
  /** Limb thickness vs the reference rig (the registry clamp keeps it within 0.75..1.45). */
  readonly girth = {torso: 1, arm: 1.3, leg: 1.4};
  readonly extras: BlightbellyExtras;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  /** The pustules popped (hidden) — once. */
  popped = false;
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
  private readonly hit: {head: number; torso: number; belly: number; arm: number; leg: number};
  private readonly belly: {bone: string; offset: [number, number, number]};
  private readonly tmp = new THREE.Vector3();
  private readonly tmpInv = new THREE.Matrix4();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.extras = (gltf.scene.userData.enemyBlightbelly ?? {}) as BlightbellyExtras;
    const bb = this.extras.hitRadii?.belly;
    this.belly = {bone: (typeof bb === 'object' ? bb.bone : undefined) ?? BELLY_DEFAULT.bone, offset: (typeof bb === 'object' ? bb.offset : undefined) ?? BELLY_DEFAULT.offset};
    const hit = blightHitRadii(this.extras);
    // the belly sphere never reaches past the measured belly front (bind frame: bone position + offset; CPU-render evidence
    // evidence/BLIGHT/hit-volumes.png showed the raw 85th-pct radius poking ~0.15 m out in front)
    const bellyBone = gltf.scene.getObjectByName(this.belly.bone);
    if (bellyBone) {
      gltf.scene.updateMatrixWorld(true);
      const cz = new THREE.Vector3().setFromMatrixPosition(bellyBone.matrixWorld).z + this.belly.offset[2];
      hit.belly = Math.max(0.12, Math.min(hit.belly, (this.extras.footprint?.torsoFrontZ ?? 0.3) - cz));
    }
    this.hit = hit;
    const pustuleName = this.extras.pustuleMesh ?? 'BlightbellyPustules';
    this.root.name = 'enemy-blightbelly';
    this.brain = new BlightbellyBrain(spawn.x, spawn.z, spawn.yaw);
    // the same 0.95..1.05 runtime spread as every zombie (never a rescale to "look right")
    this.scale = 0.95 + rand() * 0.1;
    this.root.scale.setScalar(this.scale);
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // covers standing, slamming and lying poses (skinned bounds do not follow the animation)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.0);
        this.skinned.push(m);
        if (m.name === pustuleName || /pustule/i.test(m.name)) this.pustuleMeshes.push(m);
        else {
          m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'blightbelly'};
          if (m.visible) this.meshes.push(m);
        }
      }
      // per-actor clones: hitting / wounding one Blightbelly never marks another sharing the GLB template
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    for (const n of BONES) { const b = this.root.getObjectByName(n); if (b) this.bones.set(n, b); }
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
    return this.bones.size === BONES.length && CLIPS.every(c => this.actions.has(c));
  }

  /** Heavy body: the ragdoll's coat padding stays off (the obese rig carries its own bulk). */
  get coated(): boolean {
    return false;
  }

  /** Ground speed (m/s) a locomotion clip was authored for at timeScale 1 (extras; RIGB contract Walk 0.4 / Run 1.5). */
  clipSpeed(name: 'Walk' | 'Run'): number {
    return this.extras.clips?.[name]?.groundSpeed || (name === 'Walk' ? 0.4 : 1.5);
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
      this.play('Attack', 0.14);
    } else if (anim !== 'Attack' || this.current !== 'Attack') {
      this.play(anim, anim === 'Death' ? 0.12 : 0.25);
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

  /** World position of a bone (optionally + a bind-frame offset in model metres; matrixWorld must be fresh). */
  private at(bone: string, local?: readonly number[]): Vec3 {
    const b = this.allBones.get(bone);
    if (!b) return {x: this.brain.x, y: this.brain.y + 1, z: this.brain.z};
    if (local) this.tmp.set(local[0], local[1], local[2]).applyMatrix4(b.matrixWorld);
    else this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /**
   * Head, torso, belly, arms, legs from the current pose (matrixWorld fresh). The fat torso capsule runs from 40 % up the
   * Hips -> Spine segment to the Chest joint, pushed 0.06 m forward (the body's depth is centred ahead of the spine chain:
   * belly front +0.30, back -0.35 m), so its top (~1.69 m) stays below the head sphere (~1.74 m) — a head shot is a head shot —
   * and it does not swallow the thighs.
   */
  private computeVolumes(): HitVolume[] {
    const s = this.scale, H = this.hit;
    const v = (part: HitPart, a: Vec3, b: Vec3 | null, r: number): HitVolume => ({part, a, b, r: r * s});
    const head = this.at('Head'), neck = this.at('Neck');
    const up = {x: head.x + (head.x - neck.x) * 0.6, y: head.y + 0.09 * s, z: head.z + (head.z - neck.z) * 0.6};
    const lo = this.at('Hips', TORSO_FWD), sp = this.at('Spine', TORSO_FWD), lerp = (k: keyof Vec3) => lo[k] + (sp[k] - lo[k]) * 0.4;
    return [
      v('head', up, null, H.head),
      v('torso', {x: lerp('x'), y: lerp('y'), z: lerp('z')}, this.at('Chest', CHEST_FWD), H.torso),
      v('torso', this.at(this.belly.bone, this.belly.offset), null, H.belly),
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

  /**
   * World burst points of the pustule clusters (extras `pustules`: bone + bind-frame offset), largest first, at most `max`.
   * Falls back to the belly / chest when the extras carry none.
   */
  pustulePoints(max: number): {p: THREE.Vector3; n: THREE.Vector3; r: number}[] {
    this.root.updateMatrixWorld(true);
    const list = [...(this.extras.pustules ?? [])].sort((a, b) => b.r - a.r).slice(0, Math.max(0, max));
    const out: {p: THREE.Vector3; n: THREE.Vector3; r: number}[] = [];
    for (const q of list) {
      const b = this.allBones.get(q.bone);
      if (!b) continue;
      const p = new THREE.Vector3(q.offset[0], q.offset[1], q.offset[2]).applyMatrix4(b.matrixWorld);
      const n = q.normal ? new THREE.Vector3(q.normal[0], q.normal[1], q.normal[2]).transformDirection(b.matrixWorld) : p.clone().sub(this.tmp.setFromMatrixPosition(b.matrixWorld)).normalize();
      out.push({p, n, r: q.r * this.scale});
    }
    if (!out.length) {
      const c = this.at(this.belly.bone, this.belly.offset);
      out.push({p: new THREE.Vector3(c.x, c.y, c.z), n: new THREE.Vector3(Math.sin(this.brain.yaw), 0.3, Math.cos(this.brain.yaw)).normalize(), r: 0.12 * this.scale});
    }
    return out;
  }

  /** The pustules popped: hide the pustule domes (once). Returns false when already popped. */
  popPustules(): boolean {
    if (this.popped) return false;
    this.popped = true;
    for (const m of this.pustuleMeshes) m.visible = false;
    return true;
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
