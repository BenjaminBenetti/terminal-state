// Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren as an enemy actor (ai/creatureArchetypes.ts EnemyActor surface).
//
// Rendered from lane RIGS's rigged runtime derivative `enemy_siren` (game/public/assets/models/enemy-siren.glb: the user's supplied
// Pale Apparition body + Ghost Dress, APPEARANCE LOCKED — this actor never edits geometry, textures, colours or emissive; it clones
// the scene like every enemy, gives her own exact material copies for the shared hit flash (added on top of, and returning to, the
// supplied emissive) / wound feedback, and plays the clips; no per-instance scale jitter).
// Skeleton: the shared 18-joint humanoid names (tools/asset-pipeline/zombie/lib/skeleton.mjs), so the humanoid ragdoll (physics
// HUMANOID_RIG) and the humanoid corpse volumes apply. Extras (`scene.userData.enemySiren`, all optional): clips {name: {duration,
// loop, impact, groundSpeed}}, hit {head, torso, arm, leg} radii (model m), girth {torso, arm, leg} ragdoll multipliers.
//
// Clips (contract): Dormant (floor-hunched breathing loop), Rise (once), Run, Attack (claw swipe), Hit, Death. The brain's states map
// onto them: dormant -> Dormant, rise -> Rise (timed to SirenBrain.riseS), 'Attack' -> Attack timed to SIREN_STATS.attackDuration,
// 'Run' -> Run (time-scaled to the ground speed). Without Idle / Walk clips: 'Idle' holds Rise's last (standing) frame, 'Walk'
// plays Run slowed to the walking speed (both used when the GLB ships them).
//
// The model is LEVEL-SPECIFIC: it is not in the boot preload (assets/manifest.ts MODEL_FILES) but in lane BLIGHT's generic lazy enemy
// model table (ai/enemyModels.ts ENEMY_MODEL_FILES / enemyModelKeysFor: ENEMY_ARCHETYPES.siren.model), fetched only for sections
// whose layout places a Siren. Without it the Siren spawn is skipped (ai/sirenSystem.ts), never shown as a zombie.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitVolume} from './zombieActor';
import type {MeshSlot} from './wardrobe';
import {SIREN_WAKE, SirenBrain} from './siren';
import {firstHumDelay} from './sirenCues';

/** Model key (ENEMY_ARCHETYPES.siren.model; lazy: ai/enemyModels.ts ENEMY_MODEL_FILES). */
export const SIREN_MODEL_KEY = 'enemy_siren';

/** The clips the Siren contract requires (lane RIGS). */
export const SIREN_CLIPS = ['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'] as const;
const ONCE = new Set(['Rise', 'Attack', 'Hit', 'Death', 'Stand']);
const BONES = ['Hips', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;
/** Hit radii (model m) when the extras give none: a slender figure (a zombie body is ~0.135 / 0.2 / 0.075 / 0.1). */
export const SIREN_HIT_DEFAULT = {head: 0.12, torso: 0.17, arm: 0.065, leg: 0.085} as const;

export interface SirenExtras {
  clips?: Record<string, {duration?: number; loop?: boolean; impact?: number | null; groundSpeed?: number}>;
  hit?: Partial<typeof SIREN_HIT_DEFAULT>;
  girth?: {torso: number; arm: number; leg: number};
}

type ClipKey = typeof SIREN_CLIPS[number] | 'Idle' | 'Walk' | 'Stand';

export class SirenActor {
  readonly archetype = 'siren' as const;
  readonly root: THREE.Object3D;
  readonly brain: SirenBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  /** Uniform runtime scale: 1 — her unit fit is the rig's (appearance locked; no per-instance size jitter). */
  readonly scale = 1;
  readonly look = null;
  readonly girth: {torso: number; arm: number; leg: number} | undefined;
  /** Hit-volume radii (model m); damage/system.ts corpse volumes read `hit` too. */
  readonly hit: {head: number; torso: number; arm: number; leg: number};
  hitFlash = 0;
  /** Hum phrase timer (the EnemyCues `groanT` slot: she never groans). */
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: ClipKey | null = null;
  private lastAttackSeq = 0;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly allBones = new Map<string, THREE.Object3D>();
  private readonly boneList: THREE.Object3D[] = [];
  private readonly skinned: THREE.SkinnedMesh[] = [];
  private readonly ownMaterials = new Set<THREE.Material>();
  private readonly extras: SirenExtras;
  private histCur = new Float32Array(0);
  private histPrev = new Float32Array(0);
  private histFrames = 0;
  private histDt = 0;
  private lastDt = 0;
  private volumes: HitVolume[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmpInv = new THREE.Matrix4();

  /** `dormant` = first placement (false: an awake Siren — QA / tests; a revisit restores through the brain). */
  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number, dormant = true) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = 'enemy-siren';
    this.extras = (gltf.scene.userData.enemySiren ?? {}) as SirenExtras;
    this.hit = {...SIREN_HIT_DEFAULT, ...(this.extras.hit ?? {})};
    this.girth = this.extras.girth;
    this.brain = new SirenBrain(spawn.x, spawn.z, spawn.yaw, undefined, dormant);
    this.brain.bodyScale = this.scale;
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // covers the floor-hunched, standing, lunging and lying poses (skinned bounds do not follow the animation)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.9);
        const dress = m.userData.sirenPart === 'dress' || /dress/i.test(m.name);
        m.userData = {...m.userData, slot: dress ? 'upper' : 'body', wearable: dress ? 'sirenDress' : null, archetype: 'siren'};
        this.skinned.push(m);
        if (m.visible) this.meshes.push(m);
      }
      // per-actor copies for the shared hit flash / wound feedback; EVERYTHING as supplied (colour, maps, emissive — the flash is
      // added on top of the supplied emissive and returns to it exactly)
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
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
    for (const clip of gltf.animations) this.addAction(clip.name as ClipKey, clip);
    const rise = gltf.animations.find(c => c.name === 'Rise');
    if (rise) { const stand = rise.clone(); stand.name = 'Stand'; this.addAction('Stand', stand); }
    if (rise) this.brain.riseS = Math.min(SIREN_WAKE.riseMax, Math.max(SIREN_WAKE.riseMin, this.extras.clips?.Rise?.duration ?? rise.duration));
    // three rolls, as a zombie actor draws (scale, groan timer, idle phase): the game's rand stream stays aligned
    this.groanT = firstHumDelay(rand());
    const phase = rand();
    rand();
    this.play(dormant ? 'Dormant' : 'Stand', 0);
    const a = this.current ? this.actions.get(this.current) : null;
    if (a && dormant) a.time = phase * a.getClip().duration;
    this.syncTransform();
  }

  private addAction(name: ClipKey, clip: THREE.AnimationClip): void {
    const a = this.mixer.clipAction(clip);
    if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    this.actions.set(name, a);
  }

  /** Every contract bone and clip is present. */
  get hasRig(): boolean {
    return this.bones.size === BONES.length && SIREN_CLIPS.every(c => this.actions.has(c));
  }

  /** Long / heavy outfit padding for the ragdoll: the dress is light cloth. */
  get coated(): boolean {
    return false;
  }

  /** Current clip (QA). */
  get clip(): string | null {
    return this.current;
  }

  /** Ground speed (m/s) of a locomotion clip at timeScale 1 (extras; else the zombie values). */
  clipSpeed(name: 'Walk' | 'Run'): number {
    return this.extras.clips?.[name]?.groundSpeed || (name === 'Walk' ? 0.55 : 2.3);
  }

  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? ((mesh.userData.slot as MeshSlot | undefined) ?? null) : null;
  }

  private forEachMaterial(fn: (m: THREE.Material) => void): void {
    for (const mesh of this.skinned) { const mat = mesh.material; if (Array.isArray(mat)) mat.forEach(fn); else fn(mat); }
  }

  private play(name: ClipKey, fade = 0.2): void {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === name && name !== 'Attack') return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (name === 'Stand') next.time = next.getClip().duration; // hold the risen (standing) frame
    next.play();
    if (prev && prev !== next && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev && prev !== next) prev.stop();
    this.current = name;
  }

  syncTransform(): void {
    if (this.ragdolled) return;
    this.root.position.set(this.brain.x, this.root.position.y, this.brain.z);
    this.root.rotation.y = this.brain.yaw;
  }

  animate(dt: number, anim: AnimName, speed: number): void {
    this.lastDt = dt;
    if (this.ragdolled) { this.fadeFlash(dt); return; }
    const st = this.brain.state;
    if (st === 'dormant') this.play('Dormant', 0.3);
    else if (st === 'rise') {
      this.play('Rise', 0.25);
      const a = this.actions.get('Rise');
      if (a) a.setEffectiveTimeScale(a.getClip().duration / Math.max(0.05, this.brain.riseS));
    } else if (anim === 'Attack' && this.brain.attackSeq !== this.lastAttackSeq) {
      this.lastAttackSeq = this.brain.attackSeq;
      this.current = null;
      this.play('Attack', 0.08);
      const a = this.actions.get('Attack');
      if (a) a.setEffectiveTimeScale(a.getClip().duration / Math.max(0.05, this.brain.stats.attackDuration));
    } else if (anim !== 'Attack' || this.current !== 'Attack') {
      const pick: ClipKey = anim === 'Idle' ? (this.actions.has('Idle') ? 'Idle' : 'Stand') : anim === 'Walk' ? (this.actions.has('Walk') ? 'Walk' : 'Run') : anim;
      this.play(pick, pick === 'Death' ? 0.1 : 0.18);
    }
    const a = this.current ? this.actions.get(this.current) : null;
    if (a && (this.current === 'Walk' || this.current === 'Run')) {
      const lo = this.current === 'Run' && anim === 'Walk' ? 0.3 : 0.45;
      a.setEffectiveTimeScale(Math.max(lo, Math.min(1.8, speed / (this.clipSpeed(this.current) * this.scale))) || 1);
    }
    this.mixer.update(dt);
    this.fadeFlash(dt);
  }

  private fadeFlash(dt: number): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      const f = this.hitFlash;
      this.forEachMaterial(m => {
        const e = (m as THREE.MeshStandardMaterial).emissive;
        if (!e) return;
        // the material's own (supplied) emissive, recorded before its first flash (wound clones copy it from the source)
        let base = this.baseEmissive.get(m);
        if (!base) this.baseEmissive.set(m, (base = e.clone()));
        e.setRGB(base.r + f * 0.45, base.g + f * 0.12, base.b + f * 0.08);
      });
    }
  }
  private readonly baseEmissive = new WeakMap<THREE.Material, THREE.Color>();

  private bonePos(name: string): Vec3 {
    const b = this.bones.get(name);
    if (!b) return {x: this.brain.x, y: this.brain.y + 0.5, z: this.brain.z};
    this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /** Humanoid volumes from the current pose (the floor-hunched Dormant pose included). */
  updateVolumes(): HitVolume[] {
    if (!this.brain.alive) { this.volumes = []; return this.volumes; }
    this.root.updateMatrixWorld(true);
    this.recordPose();
    const s = this.scale, H = this.hit;
    const head = this.bonePos('Head'), neck = this.bonePos('Neck'), hips = this.bonePos('Hips');
    const up = {x: head.x + (head.x - neck.x) * 0.6, y: head.y + (head.y - neck.y) * 0.6, z: head.z + (head.z - neck.z) * 0.6};
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
      m.boundingSphere!.radius = radius / s;
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
