// A rendered zombie: skinned clone of the rigged derivative, animation mixer driven by the brain,
// and simple bone-attached hit volumes (spheres/capsules; not per-triangle). At death the physics
// module (physics/ragdoll.ts) can take over the bones as an articulated ragdoll (RagdollTarget).
// Iteration 06: `meshes` lists the body + every worn wearable (userData.slot / userData.wearable)
// for per-actor material work (damage wounds); materials are cloned per actor at construction and
// never cached afterwards (another system may replace them), so the hit flash always edits the
// meshes' CURRENT materials.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {ZombieBrain, type AnimName} from './brain';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {RagdollTarget} from '../physics/ragdoll';
import {lookKey, type HitRadii, type MeshSlot, type ZombieAppearance, type ZombieLook} from './wardrobe';

export type HitPart = 'head' | 'torso' | 'limb';
export interface HitVolume { part: HitPart; a: Vec3; b: Vec3 | null; r: number }

/** Ground speed (m/s) each in-place locomotion clip was authored for at timeScale 1. */
export const CLIP_GROUND_SPEED: Record<string, number> = {Walk: 0.55, Run: 2.3}; // from derivatives/zombie-rigged.json

/** Iteration 01-04 volumes (single Last-shift body; coat on/off) for the legacy template path. */
const LEGACY_HIT = {plain: {head: 0.135, torso: 0.2, arm: 0.075, leg: 0.1}, coated: {head: 0.135, torso: 0.24, arm: 0.09, leg: 0.1}} as const;

const BONES = ['Hips', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;

export class ZombieActor implements RagdollTarget {
  readonly root: THREE.Object3D;
  readonly brain: ZombieBrain;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private lastAttackSeq = 0;
  private readonly bones = new Map<string, THREE.Object3D>();
  /** Material clones made for this actor at construction (disposed with the actor even if replaced since). */
  private readonly ownMaterials = new Set<THREE.Material>();
  /** Body + every worn wearable (visible skinned meshes), each tagged userData.slot ('body' | wardrobe slot) and userData.wearable. */
  readonly meshes: THREE.SkinnedMesh[] = [];
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  readonly scale: number;
  private readonly tmp = new THREE.Vector3();
  private volumes: HitVolume[] = [];
  /** Every skeleton bone by name (ragdoll mapping) and the skinned meshes (cull bounds). */
  private readonly allBones = new Map<string, THREE.Object3D>();
  private readonly skinned: THREE.SkinnedMesh[] = [];
  /** Bone world positions of the last two animated frames (ragdoll velocity carry-over). */
  private readonly boneList: THREE.Object3D[] = [];
  private histCur = new Float32Array(0);
  private histPrev = new Float32Array(0);
  private histFrames = 0;
  private histDt = 0;
  private lastDt = 0;
  /** True once a physics ragdoll owns the bones: no mixer updates, no root re-sync. */
  ragdolled = false;
  /** Body + worn wearables per slot (null for the legacy single-template path). */
  readonly look: ZombieLook | null;
  /** Hit-volume radii in model metres (scaled by `scale`). */
  private readonly hit: HitRadii;
  /** Ragdoll sphere multipliers relative to the reference rig (RagdollTarget). */
  readonly girth: {torso: number; arm: number; leg: number} | undefined;
  private readonly heavy: boolean;

  /**
   * @param source an assembled body+outfit appearance (ZombieLookLibrary.build), or — legacy —
   * the iteration-01 zombie-rigged.glb template (ZombieCoat shown for the 'coated' type).
   */
  constructor(source: GLTF | ZombieAppearance, spawn: ZombieSpawn, rand: () => number) {
    const app = 'look' in source ? source : null;
    this.root = app ? app.root : SkeletonUtils.clone((source as GLTF).scene);
    this.look = app ? app.look : null;
    this.heavy = app ? app.heavy : spawn.type === 'coated';
    this.hit = app ? app.hit : LEGACY_HIT[spawn.type === 'coated' ? 'coated' : 'plain'];
    this.girth = app?.girth;
    this.root.name = app ? `zombie-${spawn.type}-${lookKey(app.look)}` : `zombie-${spawn.type}`;
    this.brain = new ZombieBrain(spawn.type, spawn.x, spawn.z, spawn.yaw);
    this.scale = 0.95 + rand() * 0.1;
    this.root.scale.setScalar(this.scale);
    const coat = app ? null : this.root.getObjectByName('ZombieCoat');
    if (coat) coat.visible = spawn.type === 'coated';
    if (!app) {
      // legacy template: tag the body / coat like the wardrobe meshes
      const body = this.root.getObjectByName('ZombieBody');
      if (body) body.userData = {...body.userData, slot: 'body', wearable: null};
      if (coat) coat.userData = {...coat.userData, slot: 'upper', wearable: 'legacyCoat'};
    }
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      // Skinned bounds do not follow the animation: use a sphere that covers every clip pose
      // (standing, lunging and lying down), so off-screen zombies are still culled.
      if (m.isSkinnedMesh) {
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.9);
        this.skinned.push(m);
        if (m.visible) this.meshes.push(m);
      }
      // per-actor clones: hitting / wounding one zombie never marks another sharing the GLB template
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    for (const n of BONES) {
      const b = this.root.getObjectByName(n);
      if (b) this.bones.set(n, b);
    }
    this.root.traverse(o => { if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) { this.allBones.set(o.name, o); this.boneList.push(o); } });
    this.histCur = new Float32Array(this.boneList.length * 3);
    this.histPrev = new Float32Array(this.boneList.length * 3);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of app ? app.animations : (source as GLTF).animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'Attack' || clip.name === 'Hit' || clip.name === 'Death') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(clip.name, a);
    }
    this.groanT = 2 + rand() * 6;
    this.play('Idle', 0);
    // desync idle cycles
    const idle = this.actions.get('Idle');
    if (idle) idle.time = rand() * idle.getClip().duration;
    this.syncTransform();
  }

  /** Wardrobe slot of one of this actor's meshes ('body' | 'upper' | 'lower' | 'head' | 'face'), or null. */
  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? ((mesh.userData.slot as MeshSlot | undefined) ?? null) : null;
  }

  /** The meshes' CURRENT materials (they may have been replaced after construction). */
  private forEachMaterial(fn: (m: THREE.Material) => void): void {
    for (const mesh of this.skinned) {
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(fn); else fn(mat);
    }
  }

  /** Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): an authored clip by name (a carried body's resting pose: the Death clip's end frame). */
  authoredClip(name: string): THREE.AnimationClip | null {
    return this.actions.get(name)?.getClip() ?? null;
  }

  get hasRig(): boolean {
    return this.bones.size === BONES.length && this.actions.size >= 6;
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

  syncTransform(): void {
    if (this.ragdolled) return; // the corpse's root stays where it died; bodies move the bones
    this.root.position.set(this.brain.x, 0, this.brain.z);
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
      a.setEffectiveTimeScale(Math.max(0.35, Math.min(1.8, speed / (CLIP_GROUND_SPEED[this.current] * this.scale))) || 1);
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

  private bonePos(name: string): Vec3 {
    const b = this.bones.get(name);
    if (!b) return {x: this.brain.x, y: 1, z: this.brain.z};
    // Perf (iteration 09): only called from updateVolumes right after root.updateMatrixWorld(true), so the bone's
    // matrixWorld is fresh; getWorldPosition would re-walk and recompose its whole parent chain per bone (11 per zombie).
    this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /** Refresh hit volumes from the current pose (call after animate + world matrix update). */
  updateVolumes(): HitVolume[] {
    if (!this.brain.alive) { this.volumes = []; return this.volumes; }
    this.root.updateMatrixWorld(true);
    this.recordPose();
    const s = this.scale, H = this.hit;
    const head = this.bonePos('Head'), neck = this.bonePos('Neck'), hips = this.bonePos('Hips');
    const up = {x: head.x + (head.x - neck.x) * 0.6, y: head.y + 0.09 * s, z: head.z + (head.z - neck.z) * 0.6};
    this.volumes = [
      {part: 'head', a: up, b: null, r: H.head * s},
      {part: 'torso', a: hips, b: neck, r: H.torso * s},
      {part: 'limb', a: this.bonePos('L_UpperArm'), b: this.bonePos('L_Hand'), r: H.arm * s},
      {part: 'limb', a: this.bonePos('R_UpperArm'), b: this.bonePos('R_Hand'), r: H.arm * s},
      {part: 'limb', a: this.bonePos('L_Thigh'), b: this.bonePos('L_Foot'), r: H.leg * s},
      {part: 'limb', a: this.bonePos('R_Thigh'), b: this.bonePos('R_Foot'), r: H.leg * s},
    ];
    return this.volumes;
  }

  get hitVolumes(): HitVolume[] {
    return this.volumes;
  }

  // --- RagdollTarget ---------------------------------------------------------------------------
  /** Long/heavy outfit (ragdoll coat padding); the legacy path follows the 'coated' type. */
  get coated(): boolean {
    return this.heavy;
  }

  bone(name: string): THREE.Object3D | undefined {
    return this.allBones.get(name);
  }

  /** Store bone world positions (matrixWorld is fresh: called right after updateMatrixWorld). */
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

  /** Stop the mixer without letting it restore the bind pose (stopping actions resets bindings). */
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
      m.boundingSphere!.radius = radius / s;
    }
  }
  private readonly tmpInv = new THREE.Matrix4();

  ragdollMoved(x: number, z: number): void {
    this.brain.x = x;
    this.brain.z = z;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) m.skeleton.dispose();
    });
    const all = new Set<THREE.Material>(this.ownMaterials);
    this.forEachMaterial(m => all.add(m));
    for (const m of all) m.dispose();
    this.ownMaterials.clear();
  }
}
