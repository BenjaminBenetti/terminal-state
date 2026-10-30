// Iteration 07 (Lane Q): the field-notes rat/dog ("Tunnel scavenger", core asset quadruped-02) as an
// enemy actor. Rendered from the NEW rigged derivative creature-ratdog.glb (the Field Notes master is
// an unrigged static reconstruction; skeleton, skin and clips are derivative work — see
// public/assets/derivatives/creature-ratdog.json). It exposes the same actor-facing surface as the
// zombie (hit volumes, skinned meshes, brain, ragdoll bones; ai/creatureArchetypes.ts EnemyActor)
// through quadruped data — it is not a humanoid turned sideways:
//   * brain: the zombie brain's perception / chase / search / attack logic with quadruped stats
//     (fast, low HP, short bite reach), a lunge during the bite and NO ladder links (it never climbs;
//     it can still drop off the platform edge into the track bed while chasing);
//   * hit volumes: skull + muzzle spheres, back and neck capsules, eight leg segments and the tail;
//   * ragdoll: a 12-part quadruped rig for physics/ragdoll.ts (Lane K's generic `ragdollRig` hook);
//   * corpses: quadruped corpse volumes for the damage system (Lane K reads `corpseVolumes()`).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {ZombieBrain, type AnimName, type BrainOutput, type BrainWorld, type ZombieStats} from './brain';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitPart, HitVolume} from './zombieActor';
import type {RagdollRig, RagdollPartSpec, BallSpec, HingeSpec} from '../physics/ragdoll';
import type {MeshSlot} from './wardrobe';

/**
 * Quadruped stats (brain.ts ZombieStats). Attack timing matches the Attack clip of
 * creature-ratdog.glb (0.9 s, jaws snap shut at 0.42 s). HP 44: two rifle body hits or one head
 * hit; chase 4.4 m/s — faster than a walking player (3.4), slower than a sprint (5.8).
 */
export const RATDOG_STATS: ZombieStats = {
  hp: 44, wanderSpeed: 0.75, chaseSpeed: 4.4, attackRange: 1.05, attackDamage: 7, attackDuration: 0.9, attackImpact: 0.42,
  sightRange: 20, radius: 0.27, chaseAnim: 'Run', turnRate: 9,
};
/** Lunge during the bite: forward speed (m/s) between these clip times, while farther than LUNGE_STOP from the player. */
export const LUNGE = {from: 0.18, to: 0.42, speed: 3.2, stop: 0.7};

/** Zombie brain with quadruped stats, a lunging bite and no ladder links. */
export class CreatureBrain extends ZombieBrain {
  readonly archetype = 'ratdog' as const;
  private seenSeq = 0;
  private attackT0 = -1;

  constructor(x: number, z: number, yaw: number, stats: ZombieStats = RATDOG_STATS) {
    super('shambler', x, z, yaw, stats);
  }

  override update(dt: number, w: BrainWorld): BrainOutput {
    // every path request ignores rescue-ladder nav links: the quadruped cannot climb
    const cw: BrainWorld = {...w, findPath: (ax, az, bx, bz, opts) => w.findPath(ax, az, bx, bz, {...opts, noLinks: true})};
    const out = super.update(dt, cw);
    if (this.attackSeq !== this.seenSeq) { this.seenSeq = this.attackSeq; this.attackT0 = this.t; }
    if (this.state === 'attack' && w.playerAlive) {
      const e = this.t - this.attackT0;
      const dx = w.px - this.x, dz = w.pz - this.z, d = Math.hypot(dx, dz);
      if (e >= LUNGE.from && e <= LUNGE.to && d > LUNGE.stop) { out.dirX = dx / d; out.dirZ = dz / d; out.speed = LUNGE.speed; out.face = Math.atan2(dx, dz); }
    }
    return out;
  }

  /** Seconds into the current attack (lunge / bite timing for QA). */
  get attackElapsed(): number {
    return this.state === 'attack' ? this.t - this.attackT0 : -1;
  }
}

interface CreatureExtras {
  clips: Record<string, {duration: number; loop: boolean; groundSpeed: number; impact: number | null}>;
  radii: {torso: number; neck: number; head: number; frontLeg: number; hindLeg: number; tail: number};
  /** End points (nose, chin, toe tips, tail tip) relative to their bone, bind frame, model metres. */
  ends: Record<string, [number, number, number]>;
}

const LEGS = ['L_Front', 'R_Front', 'L_Hind', 'R_Hind'] as const;
const KEY_BONES = ['Root', 'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck', 'Head', 'Jaw', 'Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5',
  ...LEGS.flatMap(l => [`${l}Upper`, `${l}Lower`, `${l}Foot`])];

/**
 * Quadruped ragdoll for physics/ragdoll.ts (bind rotations are identity, so cones are bind/model
 * vectors for the LEFT side; 'R_' parts mirror X). 12 bodies, ~38 kg at scale 1.
 */
export function quadrupedRagdollRig(ends: CreatureExtras['ends']): RagdollRig {
  const v = (k: string, f = 1, add: [number, number, number] = [0, 0, 0]): [number, number, number] => {
    const e = ends[k] ?? [0, 0, 0.1];
    return [e[0] * f + add[0], e[1] * f + add[1], e[2] * f + add[2]];
  };
  const part = (name: string, bone: string, child: string, parent: string | null, mass: number, spheres: RagdollPartSpec['spheres'], damp: [number, number] = [0.08, 0.5]): RagdollPartSpec =>
    ({name, bone, child, parent, mass, coat: 1, damp, girth: 'none', spheres});
  const parts: RagdollPartSpec[] = [
    part('pelvis', 'Hips', 'Spine1', null, 7, [{at: [0, 0, 0], r: 0.1}, {at: [0, -0.02, -0.09], r: 0.09}, {seg: 'Spine1', t: 0.55, r: 0.105}], [0.06, 0.4]),
    part('torso', 'Spine1', 'Spine2', 'pelvis', 13, [{at: [0, 0, 0], r: 0.115}, {at: [0, -0.01, 0], bone: 'Spine2', r: 0.125}, {at: [0, -0.03, 0], bone: 'Chest', r: 0.125}, {at: [0, -0.1, 0.04], bone: 'Chest', r: 0.1}], [0.06, 0.4]),
    part('head', 'Neck', 'Head', 'torso', 3.5, [{seg: 'Head', t: 0.45, r: 0.085}, {at: v('Head', 0.3), bone: 'Head', r: 0.085}, {at: v('Head', 0.75), bone: 'Head', r: 0.058}], [0.08, 0.6]),
    part('tail', 'Tail1', 'Tail2', 'pelvis', 0.5, [{seg: 'Tail2', t: 0.6, r: 0.035}, {at: [0, 0, 0], bone: 'Tail3', r: 0.032}, {at: [0, 0, 0], bone: 'Tail4', r: 0.03}, {at: [0, 0, 0], bone: 'Tail5', r: 0.028}, {at: v('Tail5', 0.8), bone: 'Tail5', r: 0.025}], [0.1, 0.7]),
  ];
  for (const s of ['L', 'R'] as const) {
    parts.push(
      part(`frontUpper${s}`, `${s}_FrontUpper`, `${s}_FrontLower`, 'torso', 2, [{seg: `${s}_FrontLower`, t: 0.35, r: 0.068}, {seg: `${s}_FrontLower`, t: 0.82, r: 0.058}]),
      part(`frontLower${s}`, `${s}_FrontLower`, `${s}_FrontFoot`, `frontUpper${s}`, 1.1, [{seg: `${s}_FrontFoot`, t: 0.3, r: 0.045}, {seg: `${s}_FrontFoot`, t: 0.85, r: 0.042}, {at: v(`${s}_FrontFoot`, 0.55), bone: `${s}_FrontFoot`, r: 0.045}]),
      part(`hindUpper${s}`, `${s}_HindUpper`, `${s}_HindLower`, 'pelvis', 2.6, [{seg: `${s}_HindLower`, t: 0.3, r: 0.075}, {seg: `${s}_HindLower`, t: 0.8, r: 0.06}]),
      part(`hindLower${s}`, `${s}_HindLower`, `${s}_HindFoot`, `hindUpper${s}`, 1.1, [{seg: `${s}_HindFoot`, t: 0.4, r: 0.042}, {seg: `${s}_HindFoot`, t: 1, r: 0.04}, {at: v(`${s}_HindFoot`, 0.55), bone: `${s}_HindFoot`, r: 0.045}]),
    );
  }
  const ball = (cone: [number, number, number], coneAngle: number, twist: number): BallSpec => ({kind: 'ball', cone, coneAngle, twistRef: [1, 0, 0], twist});
  const hinge = (min: number, max: number): HingeSpec => ({kind: 'hinge', axis: 'x', min, max});
  const joints: RagdollRig['joints'] = {
    torso: ball([0, 0, 1], 0.38, 0.3),          // spine flex / extension / side bend ~22 deg
    head: ball([0, -0.2, 1], 0.85, 0.6),        // neck: ~49 deg around slightly-down-forward
    tail: ball([0, 0.2, -1], 1.25, 0.8),        // floppy tail
  };
  for (const s of ['L', 'R']) {
    joints[`frontUpper${s}`] = ball([0.15, -1, 0], 0.9, 0.5);   // scapula + humerus swing ~52 deg
    joints[`frontLower${s}`] = hinge(-1.9, 0.25);              // elbow: forearm flexes FORWARD (negative about +X)
    joints[`hindUpper${s}`] = ball([0.2, -0.8, 0.45], 0.9, 0.5); // hip
    joints[`hindLower${s}`] = hinge(-0.25, 1.9);               // stifle: shank flexes BACKWARD
  }
  return {parts, joints, root: 'pelvis', core: [['torso', 0.6], ['pelvis', 0.4]], head: 'head', fall: ['pelvis', 'torso'], mirrorPrefix: 'R_', rootBone: 'Root'};
}

export class CreatureActor {
  readonly archetype = 'ratdog' as const;
  readonly root: THREE.Object3D;
  readonly brain: CreatureBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  readonly girth = undefined;
  readonly ragdollRig: RagdollRig;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: AnimName | null = null;
  private lastAttackSeq = 0;
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
  private readonly extras: CreatureExtras;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpInv = new THREE.Matrix4();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.root = SkeletonUtils.clone(gltf.scene);
    this.extras = (gltf.scene.userData.creatureRatdog ?? {}) as CreatureExtras;
    if (!this.extras.clips || !this.extras.ends) throw new Error('creature-ratdog-t25.glb: missing creatureRatdog extras');
    this.root.name = 'creature-ratdog';
    this.brain = new CreatureBrain(spawn.x, spawn.z, spawn.yaw);
    this.scale = 0.94 + rand() * 0.12;
    this.root.scale.setScalar(this.scale);
    this.ragdollRig = quadrupedRagdollRig(this.extras.ends);
    this.root.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // covers standing, lunging and lying poses (skinned bounds do not follow the animation)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, -0.05), 0.95);
        m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'ratdog'};
        this.skinned.push(m);
        this.meshes.push(m);
      }
      const clone = (src: THREE.Material) => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    this.root.traverse(o => { if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) { this.allBones.set(o.name, o); this.boneList.push(o); } });
    this.histCur = new Float32Array(this.boneList.length * 3);
    this.histPrev = new Float32Array(this.boneList.length * 3);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'Attack' || clip.name === 'Hit' || clip.name === 'Death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(clip.name, a);
    }
    this.groanT = 1.5 + rand() * 5;
    this.play('Idle', 0);
    const idle = this.actions.get('Idle');
    if (idle) idle.time = rand() * idle.getClip().duration;
    this.syncTransform();
  }

  get hasRig(): boolean {
    return KEY_BONES.every(b => this.allBones.has(b)) && ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].every(c => this.actions.has(c));
  }

  /** Quadruped has no heavy outfit (ragdoll padding off). */
  get coated(): boolean {
    return false;
  }

  /** Ground speed (m/s) a locomotion clip was authored for at timeScale 1 (from the GLB extras). */
  clipSpeed(name: 'Walk' | 'Run'): number {
    return this.extras.clips[name]?.groundSpeed || (name === 'Walk' ? 0.6 : 2.5);
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
      this.play('Attack', 0.08);
    } else if (anim !== 'Attack' || this.current !== 'Attack') {
      // quick creature: short blends; a fast wander still gallops
      const pick: AnimName = anim === 'Walk' && speed > 1.6 ? 'Run' : anim;
      this.play(pick, pick === 'Death' ? 0.1 : 0.15);
    }
    const a = this.current ? this.actions.get(this.current) : null;
    if (a && (this.current === 'Walk' || this.current === 'Run')) {
      a.setEffectiveTimeScale(Math.max(0.4, Math.min(2.0, speed / (this.clipSpeed(this.current) * this.scale))) || 1);
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

  private at(bone: string, local?: readonly number[], f = 1): Vec3 {
    const b = this.allBones.get(bone);
    if (!b) return {x: this.brain.x, y: this.brain.y + 0.35, z: this.brain.z};
    if (local) this.tmp.set(local[0] * f, local[1] * f, local[2] * f).applyMatrix4(b.matrixWorld);
    else this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /** Quadruped volumes from the current pose (bone frames are bind-aligned: offsets are model metres). */
  private computeVolumes(): HitVolume[] {
    const s = this.scale, R = this.extras.radii, E = this.extras.ends;
    const v = (part: HitPart, a: Vec3, b: Vec3 | null, r: number): HitVolume => ({part, a, b, r: r * s});
    const out: HitVolume[] = [
      v('head', this.at('Head', E.Head, 0.32), null, R.head * 0.92),
      v('head', this.at('Head', E.Head, 0.78), null, R.head * 0.58),
      v('torso', this.at('Hips', [0, 0, -0.06]), this.at('Chest'), R.torso * 0.85),
      v('torso', this.at('Chest', [0, -0.02, 0.03]), this.at('Head'), R.neck * 0.82),
      v('limb', this.at('Tail1'), this.at('Tail4'), R.tail * 0.9),
    ];
    for (const l of LEGS) {
      const r = (l.includes('Front') ? R.frontLeg : R.hindLeg) * 0.85;
      out.push(v('limb', this.at(`${l}Upper`, [0, -0.06, 0]), this.at(`${l}Lower`), r * 1.15));
      out.push(v('limb', this.at(`${l}Lower`), this.at(`${l}Foot`, E[`${l}Foot`], 0.5), r));
    }
    return out;
  }

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

  /** Corpse volumes (Lane K's damage system reads this instead of the humanoid bone names). */
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
      m.boundingSphere!.radius = Math.max(0.9, radius) / s;
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
