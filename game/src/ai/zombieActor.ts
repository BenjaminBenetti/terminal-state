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
import {ZombieBrain, spawnStats, type AnimName, type ZombieStats} from './brain';
import {isSprinter} from './sprinter';
import {SPRINT_CLIP, sprintClipFor} from './sprintGait'; // task studio-sprinter-gait-20261112-063646-01
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {RagdollTarget} from '../physics/ragdoll';
import {lookKey, type HitRadii, type MeshSlot, type ZombieAppearance, type ZombieLook} from './wardrobe';

export type HitPart = 'head' | 'torso' | 'limb';
export interface HitVolume { part: HitPart; a: Vec3; b: Vec3 | null; r: number }

/** Fill a pooled hit volume (ZombieActor.updateVolumes). */
function setVolume(v: HitVolume, part: HitPart, a: Vec3, b: Vec3 | null, r: number): void {
  v.part = part; v.a = a; v.b = b; v.r = r;
}

/** Ground speed (m/s) each in-place locomotion clip was authored for at timeScale 1. */
export const CLIP_GROUND_SPEED: Record<string, number> = {Walk: 0.55, Run: 2.3, Sprint: SPRINT_CLIP.groundSpeed}; // from derivatives/zombie-rigged.json (Sprint: ai/sprintGait.ts)

/** Playback range of a locomotion clip (x its authored rate). */
export const GAIT_TIME_SCALE = {min: 0.35, max: 1.8} as const;

/**
 * Task studio-sprinter-gait-20261112-063646-01: the Sprint clip's playback floor. A sprinter slowed by a sharp turn (motor.ts: down to
 * a quarter of its pace) brakes to half the sprint cadence instead of the usual 0.35x slow motion.
 */
export const SPRINT_MIN_TIME_SCALE = 0.5;

/** A locomotion clip of the zombie actor: the body GLB's Walk / Run, or a sprinter's own Sprint (ai/sprintGait.ts). */
export type GaitClip = 'Walk' | 'Run' | 'Sprint';

/**
 * The time scale of locomotion clip `clip` for a body of `scale` moving at `speed` m/s: the ground speed the clip covers matches the
 * real one, within GAIT_TIME_SCALE. Task studio-sprinter-zombies-20261112-033210-01: the Run clip's ceiling also reaches the body's own
 * chase pace, so a sprinter whose rig has no Sprint clip (the fallback) runs without sliding; for every other zombie that is below the
 * usual 1.8 (shambler 2.55 m/s: <= 1.17x, coated 1.75: <= 0.8x), so its playback is unchanged. Task
 * studio-sprinter-gait-20261112-063646-01: the Sprint clip is authored at the sprint pace, so at 4.3 m/s it plays at 1 / scale
 * (0.95-1.05x), floored at SPRINT_MIN_TIME_SCALE.
 */
export function gaitTimeScale(clip: GaitClip, speed: number, scale: number, stats: Pick<ZombieStats, 'chaseSpeed'>): number {
  const ground = CLIP_GROUND_SPEED[clip] * scale;
  const min = clip === 'Sprint' ? SPRINT_MIN_TIME_SCALE : GAIT_TIME_SCALE.min;
  const max = clip === 'Run' ? Math.max(GAIT_TIME_SCALE.max, stats.chaseSpeed / ground) : GAIT_TIME_SCALE.max;
  return Math.max(min, Math.min(max, speed / ground)) || 1;
}

/** A clip the actor plays: the brain's animation, or the Sprint a sprinter plays for the brain's 'Run'. */
type ActorClip = AnimName | 'Sprint';

/** Iteration 01-04 volumes (single Last-shift body; coat on/off) for the legacy template path. */
const LEGACY_HIT = {plain: {head: 0.135, torso: 0.2, arm: 0.075, leg: 0.1}, coated: {head: 0.135, torso: 0.24, arm: 0.09, leg: 0.1}} as const;

const BONES = ['Hips', 'Neck', 'Head', 'L_UpperArm', 'L_Hand', 'R_UpperArm', 'R_Hand', 'L_Thigh', 'L_Foot', 'R_Thigh', 'R_Foot'] as const;

export class ZombieActor implements RagdollTarget {
  readonly root: THREE.Object3D;
  readonly brain: ZombieBrain;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: ActorClip | null = null;
  /**
   * Task studio-sprinter-gait-20261112-063646-01: a sprinter spawn's own Sprint clip plays whenever its brain asks for 'Run' (its pursuit;
   * idle / roaming / attack keep the ordinary clips). False for every other zombie, and for a rig without one (it keeps the Run).
   */
  readonly sprints: boolean;
  /** Foot strikes the Sprint clip passed since sprintFootfalls() last took them. */
  private footfalls = 0;
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
    // (task studio-sprinter-zombies-20261112-033210-01: a sprinter spawn's faster pursuit — ai/sprinter.ts; every other spawn its type's stats)
    this.brain = new ZombieBrain(spawn.type, spawn.x, spawn.z, spawn.yaw, spawnStats(spawn));
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
    // (built once per body model from its rest pose, RNG-free: the caller's stream and every other actor are untouched)
    const sprint = isSprinter(spawn) ? sprintClipFor(this.root, app ? app.animations : (source as GLTF).animations) : null;
    if (sprint) this.actions.set(SPRINT_CLIP.name, this.mixer.clipAction(sprint));
    this.sprints = !!sprint;
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
    return this.bones.size === BONES.length && this.actions.size - (this.sprints ? 1 : 0) >= 6; // (the body's own clips: not the built Sprint)
  }

  play(name: ActorClip, fade = 0.2): void {
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
      // (task studio-sprinter-gait-20261112-063646-01: a sprinter's swing starts clean — its Sprint fades out under the Attack instead of
      // running on beneath it, so it never swipes with half a sprint pose and its legs pumping in place; every other zombie as before)
      const sprint = this.current === 'Sprint' ? this.actions.get('Sprint') : undefined;
      this.current = null;
      this.play('Attack', 0.12);
      sprint?.fadeOut(0.12);
    } else if (anim !== 'Attack' || this.current !== 'Attack') {
      this.play(anim === 'Run' && this.sprints ? 'Sprint' : anim, anim === 'Death' ? 0.12 : 0.22);
    }
    const a = this.current ? this.actions.get(this.current) : null;
    if (a && (this.current === 'Walk' || this.current === 'Run' || this.current === 'Sprint')) {
      a.setEffectiveTimeScale(gaitTimeScale(this.current, speed, this.scale, this.brain.stats));
    }
    const t0 = this.current === 'Sprint' && a ? a.time : -1;
    this.mixer.update(dt);
    if (t0 >= 0) this.countFootfalls(t0, a!.time, a!.getClip().duration);
    this.fadeFlash(dt);
  }

  /** The Sprint clip's foot strikes (SPRINT_CLIP.contacts: every half cycle) between clip times t0 and t1 (a loop wrap included). */
  private countFootfalls(t0: number, t1: number, T: number): void {
    const half = T / 2;
    if (t1 < t0) t1 += T;
    this.footfalls += Math.max(0, Math.floor(t1 / half) - Math.floor(t0 / half));
  }

  /**
   * Task studio-sprinter-gait-20261112-063646-01: footfalls of the Sprint clip since the last call (ai/creatureArchetypes.ts ZOMBIE_CUES
   * plays one on each foot strike, so the steps follow the visible stride at any body scale and playback rate); null while this actor is
   * not sprinting — the ordinary distance-based footsteps then.
   */
  sprintFootfalls(): number | null {
    const n = this.footfalls;
    this.footfalls = 0;
    return this.current === 'Sprint' ? n : null;
  }

  private fadeFlash(dt: number): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      const f = this.hitFlash;
      this.forEachMaterial(m => { (m as THREE.MeshStandardMaterial).emissive?.setRGB(f * 0.45, f * 0.12, f * 0.08); });
    }
  }

  /** The world position of bone `name` into `out` (a missing bone: the feet column at 1 m). */
  private bonePos(name: string, out: Vec3): Vec3 {
    const b = this.bones.get(name) ?? this.allBones.get(name);
    if (!b) { out.x = this.brain.x; out.y = 1; out.z = this.brain.z; return out; }
    // Perf (iteration 09): only called from updateVolumes right after root.updateMatrixWorld(true), so the bone's
    // matrixWorld is fresh; getWorldPosition would re-walk and recompose its whole parent chain per bone (11 per zombie).
    this.tmp.setFromMatrixPosition(b.matrixWorld);
    out.x = this.tmp.x; out.y = this.tmp.y; out.z = this.tmp.z;
    return out;
  }

  /**
   * The actor's own hit-volume points, volumes and the two lists updateVolumes hands out (task
   * studio-skywalk-loot-performance-20261116-022934-01: refreshed in place — no ~17 new objects per enemy a frame; every reader takes
   * the volumes of the current pose at once: hit tests, melee, fire, the turret).
   */
  private readonly volPts = Array.from({length: 14}, (): Vec3 => ({x: 0, y: 0, z: 0}));
  private readonly vols = Array.from({length: 8}, (): HitVolume => ({part: 'limb', a: {x: 0, y: 0, z: 0}, b: null, r: 0}));
  private readonly chordVols: HitVolume[] = [0, 1, 2, 3, 6, 7].map(i => this.vols[i]);
  private readonly sprintVols: HitVolume[] = [...this.vols];

  /** Refresh hit volumes from the current pose (call after animate + world matrix update). */
  updateVolumes(): HitVolume[] {
    if (!this.brain.alive) { this.volumes = []; return this.volumes; }
    this.root.updateMatrixWorld(true);
    this.recordPose();
    const s = this.scale, H = this.hit, P = this.volPts, V = this.vols;
    const head = this.bonePos('Head', P[0]), neck = this.bonePos('Neck', P[1]), hips = this.bonePos('Hips', P[2]);
    const up = P[3];
    up.x = head.x + (head.x - neck.x) * 0.6; up.y = head.y + 0.09 * s; up.z = head.z + (head.z - neck.z) * 0.6;
    setVolume(V[0], 'head', up, null, H.head * s);
    setVolume(V[1], 'torso', hips, neck, H.torso * s);
    setVolume(V[6], 'limb', this.bonePos('L_Thigh', P[8]), this.bonePos('L_Foot', P[9]), H.leg * s);
    setVolume(V[7], 'limb', this.bonePos('R_Thigh', P[10]), this.bonePos('R_Foot', P[11]), H.leg * s);
    const lu = this.bonePos('L_UpperArm', P[4]), lh = this.bonePos('L_Hand', P[5]), ru = this.bonePos('R_UpperArm', P[6]), rh = this.bonePos('R_Hand', P[7]);
    if (this.current === 'Sprint') {
      // task studio-sprinter-gait-20261112-063646-01: the Sprint's pumping arms bend ~55-100 deg at the elbow, far off the shoulder-hand
      // chord: while it plays, one capsule per arm segment so shots land on the arm the player sees (every other clip: the chord as before)
      const le = this.bonePos('L_Forearm', P[12]), re = this.bonePos('R_Forearm', P[13]);
      setVolume(V[2], 'limb', lu, le, H.arm * s); setVolume(V[3], 'limb', le, lh, H.arm * s);
      setVolume(V[4], 'limb', ru, re, H.arm * s); setVolume(V[5], 'limb', re, rh, H.arm * s);
      this.volumes = this.sprintVols;
    } else {
      setVolume(V[2], 'limb', lu, lh, H.arm * s);
      setVolume(V[3], 'limb', ru, rh, H.arm * s);
      this.volumes = this.chordVols;
    }
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
