// Task studio-bb-production-20261112-234540-01 (lane ACTOR): the rendered BB — a skinned clone of one of the four look GLBs
// (enemy-bb-lullaby / -binky / -teddy / -changeling.glb: one skinned body on the SHARED 18-joint skeleton, standing bind, no baked
// clips, scene extras `enemyBb`; tools/asset-pipeline/enemy/build-bb.mjs). The same actor surface as ai/screacherActor.ts
// (EnemyActor: brain, hit volumes, skinned meshes, ragdoll target), with what a small crawler that clings to walls and ceilings changes:
//   * PLACEMENT: the root is put and turned by the brain's BbPose alone (ai/bb.ts: the point ON the support surface under the body
//     centre; X = up x forward, Y = up, Z = forward) — `placesRoot`, so the game leaves root.position.y alone. Every pose below is
//     authored in that root frame, so it is the same on a floor, a wall, a ceiling and in the air;
//   * CLIPS: none in the GLB. The pose is sampled from the body model's runtime tables (ai/bbClips.ts: solved from this body's own
//     bind, one set per GLB) by a small sampler of its own — no AnimationMixer, so the overlays below never accumulate on the bones.
//     The clip follows `pose.phase` (the `anim` argument only tells a death the pose has not caught up with): idle -> Idle, crawl ->
//     Crawl / Scuttle at speed / (metres per cycle x scale) cycles a second (planted palms and knees do not slide), freeze -> Poise
//     (stopped mid-stride, mirrored for the pair that led), windup / pounce / land / stagger -> Windup / Pounce / Land / Hit driven by
//     `pose.phaseT`, fall -> Fall, dead -> Death (only shown when the ragdoll is unavailable);
//   * OVERLAYS, all in the root's frame: the CACKLE (pose.cackleSeq: on a still body the Cackle clip — up on its haunches, hands off
//     the surface, head thrown back, shaking, held back on a wall / ceiling; on a moving one a head / chest bob over the gait), the head TWITCH of a freeze
//     (pose.twitchSeq: a snap of the head, now and then a lifted paw) and the head LOOK-AT (Neck + Head toward pose.look, inside the
//     neck's audited range, smoothed; relaxed when there is nothing to look at);
//   * HIT VOLUMES from the animated bones: ONE 'head' sphere (the extras' skull, riding the Head joint — the big head is a fair
//     target), a Hips -> Neck torso capsule and two capsules per arm and leg, all x scale, right in every orientation;
//   * NON-GRAPHIC (`nonGraphic`): damage/system.ts shows no wound, blood, flesh piece or tear on it, alive or dead; the hit flash here
//     is a neutral pale blink, not the red one;
//   * RAGDOLL: its own small rig (bbRagdollRig: this body's radii, ~9 kg) and prepareRagdoll(), which lifts the body just clear of
//     the surface it clings to before the bodies are built and takes the killing shot as a light body on a surface can (nothing of
//     it into that surface, no launch, a bounded throw). It is not carriable (ai/corpseTrait.ts CORPSE_TRAITS.bb).
// The four looks are one enemy: the same class, stats and clips; only the GLB (and so the solved proportions) differs.
// No model -> createEnemyActor's counted zombie stand-in. A GLB whose skeleton is not the shared rig shows its bind pose (hasRig false).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type {AnimName} from './brain';
import {BB_ASSET, BB_BODY, BB_SCALE, BbBrain, bbVariantOf, type BbPhase, type BbPose, type BbVariantId} from './bb';
import {BB_ANIMATED, BB_CLIPS, BB_FRAME_FLOATS, BB_GAIT, BB_JOINT_INDEX, bbAnimationClip, bbArmLocal, bbClipSetFor, sampleBbClip,
  type BbClipName, type BbClipSet, type BbExtras, type BbRig, type BbSide, type Q} from './bbClips';
import type {BallSpec, HingeSpec, KillImpulse, RagdollPartSpec, RagdollRig} from '../physics/ragdoll';
import type {ZombieSpawn} from '../gen/station';
import type {Vec3} from '../combat/hitscan';
import type {HitPart, HitVolume} from './zombieActor';
import type {MeshSlot} from './wardrobe';

export type {BbExtras} from './bbClips';

/** The actor's own numbers (seconds / degrees / model metres). */
export const BB_ACTOR = {
  /** Cross-fade into each clip (s): impacts cut in, settling eases. */
  fade: {Idle: 0.25, Crawl: 0.09, Scuttle: 0.09, Poise: 0.07, Cackle: 0.1, Windup: 0.08, Pounce: 0.05, Fall: 0.14, Land: 0.04, Hit: 0.04, Death: 0.14} as Readonly<Record<BbClipName, number>>,
  /** A phase-timed clip whose time jumps back (the same phase began again) is faded into over this long. */
  restartFadeS: 0.06,
  /** Below this pace (m/s) a "crawl" is shown as the freeze: no gait frame is ever held mid-hop. */
  stillMps: 0.05,
  /**
   * The cackle on a body that is NOT still (the still one plays the Cackle clip): the chest bobs and the head nods with each "ha",
   * over whatever the gait is doing. `stillMps`: at or above this pace it counts as moving.
   */
  cackle: {stillMps: 0.3, bobDeg: 5, nodDeg: 10, rollDeg: 7, attackS: 0.14, releaseS: 0.3, lookK: 0.35,
    /**
     * On a WALL or under a CEILING the still cackle is only this share of the Cackle clip (the rest: its settled stance): it pushes
     * its chest off the surface and shakes, rather than standing out of the wall / hanging straight down by its shins.
     */
    wallK: 0.55},
  /** The freeze's head twitch: snapped to a yaw / roll, held, released; every `pawEvery`-th one lifts a hand as well. */
  twitch: {durationS: 0.34, snapS: 0.045, releaseS: 0.12, yawDeg: [26, 56], rollDeg: 20, pawEvery: 3, paw: {flex: 112, abd: 14, elbow: 62}},
  /**
   * The look-at: the face's yaw off the body's heading and the head's extension against the chest stay inside the neck's audited
   * range (yaw +-70, extension -30 .. +75: BB-ASSET-CONTRACT poseEnvelope); the aim follows with time constant `followS`, and the
   * whole overlay eases in / out over `blendS`. The Neck takes `neckShare` of the turn.
   */
  look: {yawDeg: 70, upDeg: 75, downDeg: 30, followS: 0.09, blendS: 0.16, neckShare: 0.42,
    /** A target steeper than `steepDeg[0]` over / under the body turns the head less and less to the side, at `steepDeg[1]` not at all (its bearing means nothing there). */
    steepDeg: [50, 80]},
  /** The trunk capsule ends this share of its radius short of the Neck joint: its round end covers the shoulders, not the back of the skull. */
  torsoPullK: 0.7,
  /** Overlays (cackle bob, twitch) fade out over this long when the body starts a wind-up / leap / landing / flinch. */
  calmS: 0.08,
  /** Hit flash: a neutral pale blink (emissive at full flash), not the red one of the bleeding enemies. */
  flash: [0.34, 0.34, 0.31],
  /** Culling sphere (root space, model metres): covers the standing bind, the stretched leap and every all-fours pose, in any orientation. */
  cull: {centre: [0, 0.3, 0], radius: 0.95},
  /** prepareRagdoll lifts the body at most this far (model metres x scale) off the surface it clings to. */
  ragdollLiftM: 0.09,
  /**
   * The killing shot throws the whole body at most this fast (m/s). The impulse every enemy gets (physics/world.ts killImpulseStrength:
   * 38 N s a rifle round, up to 107 a full load of buckshot) is sized for an adult; on ~9 kg the buckshot would fire it off at 12 m/s
   * and its trunk at 25 — 0.2 .. 0.4 m per physics step, further than a storey slab (0.3 m) or its own trunk is thick, and the solver
   * has no continuous collision (measured: joints 24 cm into a 50 cm wall, 21 cm into a 40 cm slab). 6 m/s = 0.1 m per fixed step:
   * a rifle round (~4.3 m/s on this body) is untouched, buckshot throws it about half as hard again.
   */
  ragdollMaxShoveMps: 6,
  /** ... and its vertical share stays in physics/ragdoll.ts applyShot's own band, here measured against the horizontal part: [down, up]. */
  ragdollShoveY: [-0.3, 0.15],
} as const;

/** The clip each phase shows (crawl: Crawl below the gear shift, Scuttle above it; idle / freeze: Cackle while a cackle runs). */
export const BB_PHASE_CLIP: Readonly<Record<BbPhase, BbClipName>> = {
  idle: 'Idle', crawl: 'Crawl', freeze: 'Poise', windup: 'Windup', pounce: 'Pounce', fall: 'Fall', land: 'Land', stagger: 'Hit', dead: 'Death',
};

const D2R = Math.PI / 180, TAU = Math.PI * 2;
const SIDES: readonly BbSide[] = ['L', 'R'];
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const frac = (x: number): number => x - Math.floor(x);
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const NQ = BB_ANIMATED.length * 4;

/** `out` = the joint-wise blend of two table rows (shortest arc, normalised; the Hips position linear). */
function mixRows(a: Float32Array, b: Float32Array, k: number, out: Float32Array): void {
  for (let i = 0; i < NQ; i += 4) {
    const s = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3] < 0 ? -1 : 1;
    const x = a[i] + (s * b[i] - a[i]) * k, y = a[i + 1] + (s * b[i + 1] - a[i + 1]) * k, z = a[i + 2] + (s * b[i + 2] - a[i + 2]) * k, w = a[i + 3] + (s * b[i + 3] - a[i + 3]) * k;
    const l = 1 / (Math.hypot(x, y, z, w) || 1);
    out[i] = x * l; out[i + 1] = y * l; out[i + 2] = z * l; out[i + 3] = w * l;
  }
  for (let i = NQ; i < BB_FRAME_FLOATS; i++) out[i] = a[i] + (b[i] - a[i]) * k;
}

/** The arm poses the overlays lay over a clip (local rotations: the same on every trunk pose), per body model. */
interface ArmPose { upper: THREE.Quaternion; fore: THREE.Quaternion; hand: THREE.Quaternion }
const PAWS = new WeakMap<BbClipSet, Record<BbSide, ArmPose>>();
function pawsOf(set: BbClipSet): Record<BbSide, ArmPose> {
  let p = PAWS.get(set);
  if (!p) {
    const q = (v: Q): THREE.Quaternion => new THREE.Quaternion(v[0], v[1], v[2], v[3]);
    const one = (s: BbSide): ArmPose => { const P = BB_ACTOR.twitch.paw, a = bbArmLocal(set.rig, s, P.flex, P.abd, P.elbow); return {upper: q(a.upper), fore: q(a.fore), hand: q(a.hand)}; };
    PAWS.set(set, (p = {L: one('L'), R: one('R')}));
  }
  return p;
}

/**
 * BB's ragdoll: the shared joint names, a small body's parts — sphere radii from this body's own measured hit radii and skull (the
 * extras; BB_ASSET without a rig), masses of a ~9 kg body (ai/corpseTrait.ts CORPSE_TRAITS.bb.massKg), a toddler's loose hips. The
 * root part is named 'pelvis' (physics/ragdoll.ts writes the root translation by that name). No girth / coat padding.
 * The limbs carry a little more of the 9 kg than an infant's do (arms 0.7 kg each, legs 1.05): under a trunk landing from a ceiling
 * the solver presses a lighter hand well into the floor for a moment (tests/bb-ragdoll.test.ts has the measured bounds). Their spin
 * dies quickly (LIMB_DAMP): thumb-sized limbs do not whirl.
 */
export function bbRagdollRig(rig: BbRig | null): RagdollRig {
  const D = BB_ASSET.hitRadii, k = rig?.sizeK ?? 1;
  // (no limb sphere under 3 cm, however thin the look's arms: a smaller one is driven into the floor under the landing trunk)
  const T = rig?.hit.torso ?? D.torso, A = Math.max(0.03 * k, rig?.hit.arm ?? D.arm), L = Math.max(0.03 * k, rig?.hit.leg ?? D.leg);
  const HR = rig?.head.radius ?? BB_ASSET.headRadius, hc = rig?.head.centre ?? [0, 0.6 * BB_ASSET.headRadius, 0.02];
  const neck = rig?.local.Neck ?? [0, 0.08, 0];
  const part = (name: string, bone: string, child: string, parent: string | null, mass: number, spheres: RagdollPartSpec['spheres'], damp: [number, number] = [0.08, 0.5]): RagdollPartSpec =>
    ({name, bone, child, parent, mass, coat: 1, damp, girth: 'none', spheres});
  const LIMB_DAMP: [number, number] = [0.08, 0.9];
  const parts: RagdollPartSpec[] = [
    part('pelvis', 'Hips', 'Spine', null, 1.5, [{at: [0, 0, 0], r: 0.82 * T}, {seg: 'Spine', t: 0.8, r: 0.8 * T}], [0.06, 0.4]),
    part('torso', 'Spine', 'Chest', 'pelvis', 2.2, [{at: [0, 0, 0], bone: 'Chest', r: 0.88 * T}, {at: [neck[0] * 0.6, neck[1] * 0.6, neck[2] * 0.6], bone: 'Chest', r: 0.8 * T}], [0.06, 0.4]),
    part('head', 'Neck', 'Head', 'torso', 1.8, [{at: [hc[0], hc[1], hc[2]], bone: 'Head', r: HR}], [0.08, 0.6]),
  ];
  for (const s of SIDES) {
    const f = rig?.fingers[s] ?? [0, -0.06, 0], toe = rig?.toe[s] ?? [0, -0.03, 0.09];
    parts.push(
      part(`upperArm${s}`, `${s}_UpperArm`, `${s}_Forearm`, 'torso', 0.35, [{seg: `${s}_Forearm`, t: 0.3, r: A}, {seg: `${s}_Forearm`, t: 0.85, r: A}], LIMB_DAMP),
      part(`forearm${s}`, `${s}_Forearm`, `${s}_Hand`, `upperArm${s}`, 0.35, [{seg: `${s}_Hand`, t: 0.4, r: A}, {seg: `${s}_Hand`, t: 1, r: 0.95 * A}, {at: [f[0] * 0.55, f[1] * 0.55, f[2] * 0.55], bone: `${s}_Hand`, r: 0.9 * A}], LIMB_DAMP),
      part(`thigh${s}`, `${s}_Thigh`, `${s}_Shin`, 'pelvis', 0.6, [{seg: `${s}_Shin`, t: 0.2, r: L}, {seg: `${s}_Shin`, t: 0.8, r: 0.95 * L}], LIMB_DAMP),
      part(`shin${s}`, `${s}_Shin`, `${s}_Foot`, `thigh${s}`, 0.45, [{seg: `${s}_Foot`, t: 0.05, r: 0.9 * L}, {seg: `${s}_Foot`, t: 0.5, r: 0.9 * L}, {seg: `${s}_Foot`, t: 0.95, r: 0.85 * L},
        {at: [toe[0] * 0.6, toe[1] * 0.6, toe[2] * 0.6], bone: `${s}_Foot`, r: 0.75 * L}], LIMB_DAMP),
    );
  }
  const ball = (cone: [number, number, number], coneAngle: number, twist: number): BallSpec => ({kind: 'ball', cone, coneAngle, twistRef: [1, 0, 0], twist});
  const joints: RagdollRig['joints'] = {
    torso: ball([0, 1, 0.18], 0.42, 0.35),   // lower spine: forward ~34 deg, back ~14 deg
    head: ball([0, 1, 0.15], 0.75, 0.7),     // a heavy head on a short neck
  };
  for (const s of SIDES) {
    joints[`upperArm${s}`] = ball([0.55, -0.6, 0.35], 1.2, 0.9);
    joints[`forearm${s}`] = {kind: 'hinge', axis: 'elbow', min: 0, max: 2.3} satisfies HingeSpec;
    joints[`thigh${s}`] = ball([0.2, -0.55, 0.8], 1.1, 0.8); // a crawler's hip: flexed past a right angle as easily as straight
    joints[`shin${s}`] = {kind: 'hinge', axis: 'x', min: 0, max: 2.3} satisfies HingeSpec;
  }
  // the shot's shove is shared by EVERY part by its mass (the trunk first: the default hit part): the whole body leaves at one speed.
  // On the trunk alone (the adult rig's 60 / 40) a 4 kg trunk would start at twice the body's speed and whip the limbs after it.
  const total = parts.reduce((m, p) => m + p.mass, 0);
  const core = ['torso', 'pelvis', ...parts.map(p => p.name).filter(n => n !== 'torso' && n !== 'pelvis')].map((n): [string, number] => [n, parts.find(p => p.name === n)!.mass / total]);
  return {parts, joints, root: 'pelvis', core, head: 'head', fall: ['pelvis', 'torso'], mirrorPrefix: 'R_', rootBone: 'Root'};
}

export class BbActor {
  readonly archetype = 'bb' as const;
  /** Which approved look this one wears (spawn.variant; the same enemy either way). */
  readonly variant: BbVariantId;
  readonly root: THREE.Object3D;
  readonly brain: BbBrain;
  readonly meshes: THREE.SkinnedMesh[] = [];
  readonly scale: number;
  readonly look = null;
  /** The brain's BbPose places the whole root (syncTransform): the game must not put root.position.y at the feet height. */
  readonly placesRoot = true;
  /** No wounds, blood, flesh pieces or tears on this body, alive or dead (damage/system.ts). */
  readonly nonGraphic = true;
  readonly coated = false;
  readonly extras: BbExtras;
  /** The small ragdoll (bbRagdollRig). */
  readonly ragdollRig: RagdollRig;
  hitFlash = 0;
  groanT: number;
  deadT = 0;
  ragdolled = false;
  private readonly set: BbClipSet | null;
  /** The driven bones, in table order (BB_ANIMATED); empty without a rig. */
  private readonly joints: THREE.Object3D[] = [];
  private readonly allBones = new Map<string, THREE.Object3D>();
  private readonly boneList: THREE.Object3D[] = [];
  private readonly skinned: THREE.SkinnedMesh[] = [];
  private readonly ownMaterials = new Set<THREE.Material>();
  // --- the clip being shown
  private clipName: BbClipName | null = null;
  /** Its own clock (the clips no phase times) and the clip parameter last sampled (0..1 of the clip; the cycle phase of a gait). */
  private clipT = 0;
  private u = 0;
  private mirror = false;
  /** Gait: the cycle phase (pair A = left hand + right knee lands at 0) and the gear. */
  private phi = 0;
  private fast = false;
  private staggers = 0;
  private readonly cur = new Float32Array(BB_FRAME_FLOATS);
  private readonly from = new Float32Array(BB_FRAME_FLOATS);
  private readonly tgt = new Float32Array(BB_FRAME_FLOATS);
  private readonly aux = new Float32Array(BB_FRAME_FLOATS);
  private fadeT = 0;
  private fadeS = 0;
  // --- overlays
  private seenCackle: number;
  private seenTwitch: number;
  private cackleT = Infinity;
  private twitchT = Infinity;
  private twitchYaw = 0;
  private twitchRoll = 0;
  private twitchPaw: BbSide | null = null;
  private calmW = 1;
  private lookW = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  /** Per-actor constants off the two spawn draws (no further RNG: overlays are a hash of these and the brain's counters). */
  private readonly seed: number;
  // --- bone history (ragdoll hand-over velocities)
  private histCur = new Float32Array(0);
  private histPrev = new Float32Array(0);
  private histFrames = 0;
  private histDt = 0;
  private lastDt = 0;
  private volumes: HitVolume[] = [];
  private readonly vx = new THREE.Vector3();
  private readonly vy = new THREE.Vector3();
  private readonly vz = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly tmpInv = new THREE.Matrix4();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly clips = new Map<string, THREE.AnimationClip>();

  constructor(gltf: GLTF, spawn: ZombieSpawn, rand: () => number) {
    this.extras = (gltf.scene.userData.enemyBb ?? {}) as BbExtras;
    this.variant = bbVariantOf(spawn);
    this.root = SkeletonUtils.clone(gltf.scene);
    this.root.name = `enemy-bb-${this.variant}`;
    this.brain = new BbBrain(spawn.x, spawn.z, spawn.yaw);
    // (two draws, as ever: the size, then the first giggle; everything else per actor is a hash of the two)
    const r0 = rand(), r1 = rand();
    this.scale = BB_SCALE.min + r0 * (BB_SCALE.max - BB_SCALE.min);
    this.groanT = 2 + r1 * 5;
    this.seed = frac(r0 * 7919.13 + r1 * 104.729);
    this.root.scale.setScalar(this.scale);
    this.root.traverse(o => {
      if ((o as THREE.Bone).isBone && !this.allBones.has(o.name)) { this.allBones.set(o.name, o); this.boneList.push(o); }
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        // (skinned bounds do not follow the pose: one sphere about the root for every pose and orientation)
        const C = BB_ACTOR.cull;
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(C.centre[0], C.centre[1], C.centre[2]), C.radius);
        this.skinned.push(m);
        m.userData = {...m.userData, slot: 'body', wearable: null, archetype: 'bb'};
        if (m.visible) this.meshes.push(m);
      }
      // per-actor clones: one BB's hit blink never lights another sharing the GLB template (the Meshy maps as they are)
      const clone = (src: THREE.Material): THREE.Material => {
        const mat = src.clone();
        if ((mat as THREE.MeshStandardMaterial).emissive) (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        this.ownMaterials.add(mat);
        return mat;
      };
      m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    });
    this.histCur = new Float32Array(this.boneList.length * 3);
    this.histPrev = new Float32Array(this.boneList.length * 3);
    // (the clone is still in its rest pose here: the body model's rig and clips are read from it, once per GLB)
    this.set = bbClipSetFor(gltf.scene, this.root, this.extras);
    if (this.set) for (const n of BB_ANIMATED) this.joints.push(this.allBones.get(n)!);
    this.ragdollRig = bbRagdollRig(this.set?.rig ?? null);
    const P = this.brain.pose;
    this.seenCackle = P.cackleSeq;
    this.seenTwitch = P.twitchSeq;
    this.syncTransform();
    this.animate(0, 'Idle', 0);
  }

  /** The runtime clip `name` as a THREE.AnimationClip (QA / the corpse poser's Death look-up); null for a name it has none of. */
  authoredClip(name: string): THREE.AnimationClip | null {
    if (!this.set || !Object.hasOwn(this.set.tables, name)) return null;
    let c = this.clips.get(name);
    if (!c) this.clips.set(name, (c = bbAnimationClip(this.set, name as BbClipName)));
    return c;
  }

  /** True with the shared skeleton at rest as the clips assume (ai/bbClips.ts bbRigOf); else the body stays in its bind pose. */
  get hasRig(): boolean {
    return this.set !== null;
  }

  /** The clip being shown (QA / tests). */
  get clip(): BbClipName | null {
    return this.clipName;
  }

  /** Gait cycle phase 0..1 (pair A = left hand + right knee lands at 0) and whether the fast gear is in (QA / tests). */
  get gait(): {phase: number; fast: boolean} {
    return {phase: this.phi, fast: this.fast};
  }

  /** This body model's solved rig (proportions, contacts, metres per cycle); null without one. */
  get rig(): BbRig | null {
    return this.set?.rig ?? null;
  }

  slotOf(mesh: THREE.Object3D): MeshSlot | null {
    return this.meshes.includes(mesh as THREE.SkinnedMesh) ? 'body' : null;
  }

  private forEachMaterial(fn: (m: THREE.Material) => void): void {
    for (const mesh of this.skinned) { const mat = mesh.material; if (Array.isArray(mat)) mat.forEach(fn); else fn(mat); }
  }

  /**
   * The root on the brain's pose: at the pose point, its axes X = up x forward, Y = up, Z = forward (the brain keeps the basis
   * orthonormal and continuous — it is re-orthogonalised here only against rounding; a degenerate one keeps the last orientation).
   */
  syncTransform(): void {
    if (this.ragdolled) return;
    const P = this.brain.pose;
    if (!Number.isFinite(P.x + P.y + P.z)) return;
    this.root.position.set(P.x, P.y, P.z);
    const y = this.vy.set(P.ux, P.uy, P.uz), z = this.vz.set(P.fx, P.fy, P.fz);
    if (!(y.lengthSq() > 1e-8) || !(z.lengthSq() > 1e-8)) return;
    y.normalize();
    z.addScaledVector(y, -z.dot(y));
    if (!(z.lengthSq() > 1e-8)) return;
    z.normalize();
    this.root.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.vx.crossVectors(y, z), y, z));
  }

  animate(dt: number, anim: AnimName, _speed: number): void {
    this.lastDt = dt;
    this.fadeFlash(dt);
    const set = this.set;
    if (this.ragdolled || !set) return;
    const P = this.brain.pose;
    let phase: BbPhase = anim === 'Death' || !this.brain.alive ? 'dead' : P.phase;
    if (phase === 'crawl' && !(P.speed > BB_ACTOR.stillMps)) phase = 'freeze';
    // the brain's counters, each reacted to once
    if (P.cackleSeq !== this.seenCackle) { this.seenCackle = P.cackleSeq; this.cackleT = 0; }
    if (P.twitchSeq !== this.seenTwitch) { this.seenTwitch = P.twitchSeq; this.startTwitch(P.twitchSeq); }
    this.choose(set, phase, P, dt);
    this.pose(set, dt);
    this.overlay(set, phase, P, dt);
  }

  /** Pick the clip of this frame and its parameter; a new clip is cross-faded into from the pose last shown. */
  private choose(set: BbClipSet, phase: BbPhase, P: BbPose, dt: number): void {
    const prev = this.clipName;
    let name = BB_PHASE_CLIP[phase], mirror = false;
    if (phase === 'crawl') {
      // the gear by the pace (with a dead band), the cycle by the distance covered: planted limbs do not slide
      const k = set.rig.sizeK * this.scale, v = P.speed;
      if (this.fast ? v < BB_GAIT.shiftDownMps * k : v > BB_GAIT.shiftUpMps * k) this.fast = !this.fast;
      name = this.fast ? 'Scuttle' : 'Crawl';
      // out of a freeze the stride resumes with the pair that was planted ahead early in its stance
      if (prev === 'Poise') this.phi = (this.mirror ? 0.5 : 0) + 0.3 * (this.fast ? set.scuttleDuty : set.crawlDuty);
      this.phi = frac(this.phi + dt * v / ((this.fast ? set.scuttleM : set.crawlM) * this.scale));
    } else if (phase === 'idle' || phase === 'freeze') {
      // a still body cackles with its whole body (the Cackle clip); the freeze holds the stride of the pair that led
      if (this.cackleT < BB_CLIPS.Cackle.duration) name = 'Cackle';
      else if (phase === 'freeze') mirror = prev === 'Poise' ? this.mirror : frac(this.phi + 0.25) >= 0.5;
    } else if (phase === 'stagger') mirror = prev === 'Hit' ? this.mirror : (this.staggers++ & 1) === 1;
    if (name !== prev || mirror !== this.mirror) {
      this.from.set(this.cur);
      this.fadeS = prev === null ? 0 : BB_ACTOR.fade[name];
      this.fadeT = 0;
      this.clipT = name === 'Idle' ? this.seed * BB_CLIPS.Idle.duration : 0; // (two idling side by side do not breathe in step)
      this.clipName = name;
      this.mirror = mirror;
      this.u = 0;
    }
    const C = BB_CLIPS[name];
    let u: number;
    if (name === 'Crawl' || name === 'Scuttle') u = this.phi;
    else if (name === 'Cackle') u = this.cackleT / C.duration;
    else if (name === 'Windup' || name === 'Pounce' || name === 'Land' || name === 'Hit') {
      u = (Number.isFinite(P.phaseT) ? Math.max(0, P.phaseT) : 0) / C.duration;
      // the same phase began again (a second wind-up, a flinch during a flinch): ease into its start
      if (u < this.u - 0.12) { this.from.set(this.cur); this.fadeS = BB_ACTOR.restartFadeS; this.fadeT = 0; }
    } else { this.clipT += dt; u = this.clipT / C.duration; }
    this.u = u;
  }

  /** Sample the clip (through the cross-fade) and write the bones. */
  private pose(set: BbClipSet, dt: number): void {
    const cur = this.cur, J = this.joints;
    // (the mirrored freeze / flinch: its own table, solved for this body — a real body is not symmetric enough to swap the angles)
    const flipped = this.mirror ? set.mirrored[this.clipName!] : undefined;
    sampleBbClip(flipped ?? set.tables[this.clipName!], this.u, this.tgt, this.mirror && !flipped);
    if (this.clipName === 'Cackle' && (this.brain.pose.surface === 'wall' || this.brain.pose.surface === 'ceiling')) {
      // (the clip begins in its settled stance: only part of the way up from it)
      sampleBbClip(set.tables.Cackle, 0, this.aux);
      mixRows(this.aux, this.tgt, BB_ACTOR.cackle.wallK, this.tgt);
    }
    if (this.fadeT < this.fadeS) {
      this.fadeT += dt;
      mixRows(this.from, this.tgt, smooth(this.fadeT / this.fadeS), cur);
    } else cur.set(this.tgt);
    for (let j = 0, i = 0; j < J.length; j++, i += 4) J[j].quaternion.set(cur[i], cur[i + 1], cur[i + 2], cur[i + 3]);
    J[BB_JOINT_INDEX.Hips].position.set(cur[NQ], cur[NQ + 1], cur[NQ + 2]);
  }

  private startTwitch(seq: number): void {
    const T = BB_ACTOR.twitch;
    const h = (k: number): number => frac(Math.sin((seq + 1) * 12.9898 + this.seed * 78.233 + k * 37.719) * 43758.5453);
    const side = h(0) < 0.5 ? -1 : 1;
    this.twitchT = 0;
    this.twitchYaw = side * (T.yawDeg[0] + (T.yawDeg[1] - T.yawDeg[0]) * h(1));
    this.twitchRoll = (h(2) * 2 - 1) * T.rollDeg;
    // (the hand on the side it looks away from comes up: the weight is on the other one)
    this.twitchPaw = seq % T.pawEvery === 0 ? (side > 0 ? 'R' : 'L') : null;
  }

  /** The overlays on the bones just written: the moving cackle's bob, the twitch, the look-at. Nothing here outlives the frame. */
  private overlay(set: BbClipSet, phase: BbPhase, P: BbPose, dt: number): void {
    const B = BB_ACTOR, J = this.joints, I = BB_JOINT_INDEX, q = this.q1;
    const calm = phase === 'idle' || phase === 'freeze' || phase === 'crawl';
    this.calmW = clamp(this.calmW + (calm ? dt : -dt) / B.calmS, 0, 1);
    let headYaw = 0, headRoll = 0, headNod = 0, lookK = 1;
    // --- the cackle: the Cackle clip carries a still body's; a moving one bobs its chest and nods over the gait
    const D = BB_CLIPS.Cackle.duration;
    if (this.cackleT < D) {
      const t = this.cackleT, C = B.cackle;
      this.cackleT += dt;
      if (!calm) this.cackleT = Infinity; // (a wind-up / leap / flinch ends it)
      else if (this.clipName === 'Cackle') lookK = C.lookK;
      else {
        // (eased in with a cross-fade under way: the Cackle clip it may be leaving has the shake in it already)
        const env = smooth(t / C.attackS) * (1 - smooth((t - (D - C.releaseS)) / C.releaseS)) * this.calmW * (this.fadeT < this.fadeS ? this.fadeT / this.fadeS : 1);
        const w = TAU * BB_GAIT.cackle.hz * t;
        J[I.Chest].quaternion.multiply(q.setFromAxisAngle(AX, -C.bobDeg * Math.sin(w) * env * D2R));
        headNod = C.nodDeg * (0.5 - 0.5 * Math.cos(w)) * env;
        headRoll += C.rollDeg * Math.sin(w / 2) * env;
      }
    }
    // --- the twitch: the head snaps aside (and tilts), holds, lets go; now and then a hand comes off the surface with it
    if (this.twitchT < B.twitch.durationS) {
      const T = B.twitch, t = this.twitchT;
      this.twitchT += dt;
      const e = smooth(t / T.snapS) * (1 - smooth((t - (T.durationS - T.releaseS)) / T.releaseS)) * this.calmW;
      headYaw += this.twitchYaw * e;
      headRoll += this.twitchRoll * e;
      const s = this.twitchPaw;
      if (s && this.clipName === 'Poise' && e > 0) {
        const paw = pawsOf(set)[s];
        J[I[`${s}_UpperArm`]].quaternion.slerp(paw.upper, e);
        J[I[`${s}_Forearm`]].quaternion.slerp(paw.fore, e);
        J[I[`${s}_Hand`]].quaternion.slerp(paw.hand, e);
      }
    }
    // --- the look-at: where the target is in the root's frame, from the head
    const L = B.look, wantLook = P.look !== null && (phase === 'idle' || phase === 'freeze' || phase === 'crawl' || phase === 'windup' || phase === 'pounce');
    this.lookW += ((wantLook ? lookK : 0) - this.lookW) * (1 - Math.exp(-dt / L.blendS));
    const hips = J[I.Hips], qChest = this.q2.copy(hips.quaternion).multiply(J[I.Spine].quaternion).multiply(J[I.Chest].quaternion);
    if (wantLook && P.look) {
      const R = set.rig.local, v = this.tmp, o = this.tmp2;
      // the Head joint in root space (the Neck's own turn left out: a few millimetres)
      o.set(R.Spine[0], R.Spine[1], R.Spine[2]).applyQuaternion(hips.quaternion).add(hips.position);
      o.add(v.set(R.Chest[0], R.Chest[1], R.Chest[2]).applyQuaternion(q.copy(hips.quaternion).multiply(J[I.Spine].quaternion)));
      o.add(v.set(R.Neck[0] + R.Head[0], R.Neck[1] + R.Head[1], R.Neck[2] + R.Head[2]).applyQuaternion(qChest));
      v.set(P.look.x, P.look.y, P.look.z).sub(this.root.position).applyQuaternion(q.copy(this.root.quaternion).invert()).divideScalar(this.scale).sub(o);
      const flat = Math.hypot(v.x, v.z);
      if (flat + Math.abs(v.y) > 1e-4) {
        let yaw = Math.atan2(v.x, v.z) / D2R;
        const steep = Math.atan2(v.y, flat) / D2R, pitch = clamp(steep, -L.downDeg, L.upDeg);
        // (a target behind it: the head stays turned to the side it was on, never snapping across the back)
        if (Math.abs(yaw) > 140 && this.lookYaw !== 0) yaw = Math.sign(this.lookYaw) * L.yawDeg;
        yaw = clamp(yaw, -L.yawDeg, L.yawDeg) * (1 - smooth((Math.abs(steep) - L.steepDeg[0]) / (L.steepDeg[1] - L.steepDeg[0])));
        const k = dt > 0 ? 1 - Math.exp(-dt / L.followS) : 1;
        this.lookYaw += (yaw - this.lookYaw) * k;
        this.lookPitch += (pitch - this.lookPitch) * k;
      }
    }
    if (this.lookW < 1e-3 && headYaw === 0 && headRoll === 0 && headNod === 0) return;
    // --- the head: the clip's own turn against the chest, blended toward the look, the twitch / nod on top, kept in the neck's range
    const neck = J[I.Neck], head = J[I.Head], rel = this.q3.copy(neck.quaternion).multiply(head.quaternion);
    if (this.lookW >= 1e-3) {
      q.setFromAxisAngle(AY, this.lookYaw * D2R).multiply(this.tmpQ.setFromAxisAngle(AX, -this.lookPitch * D2R)).premultiply(this.tmpQ.copy(qChest).invert());
      // (limited BEFORE the blend: the head goes the short way to a place it can reach, never round through its own chest)
      this.limitHead(q);
      rel.slerp(q, Math.min(1, this.lookW));
    }
    if (headYaw !== 0) rel.multiply(q.setFromAxisAngle(AY, headYaw * D2R));
    if (headRoll !== 0) rel.multiply(q.setFromAxisAngle(AZ, headRoll * D2R));
    if (headNod !== 0) rel.multiply(q.setFromAxisAngle(AX, headNod * D2R));
    this.limitHead(rel);
    neck.quaternion.identity().slerp(rel, L.neckShare);
    head.quaternion.copy(neck.quaternion).invert().multiply(rel);
  }

  /** Bring a head-against-chest rotation inside the neck's range: the face's turn off the chest's mid-plane, then its extension. */
  private limitHead(rel: THREE.Quaternion): void {
    const L = BB_ACTOR.look, q = this.tmpQ, face = this.tmp.copy(AZ).applyQuaternion(rel), maxTurn = Math.sin(L.yawDeg * D2R);
    if (Math.abs(face.x) > maxTurn) {
      // turned past the neck's range off the chest's mid-plane: swing the face back toward it
      const sx = Math.sign(face.x), axis = this.tmp2.set(sx, 0, 0).cross(face);
      if (axis.lengthSq() > 1e-10) { rel.premultiply(q.setFromAxisAngle(axis.normalize(), Math.asin(Math.min(1, Math.abs(face.x))) - L.yawDeg * D2R)); face.copy(AZ).applyQuaternion(rel); }
    }
    let ext = Math.atan2(face.y, face.z) / D2R;
    // (a face turned right over toward its own back reads as nearly -180: that is past the EXTENSION limit — the long way round from
    // the flexion one, which would tuck the chin and drive the skull into the surface)
    if (ext < (L.upDeg - L.downDeg) / 2 - 180) ext += 360;
    // (a turn about the chest's +X by +a tips the face forward: back inside the extension range)
    if (ext > L.upDeg) rel.premultiply(q.setFromAxisAngle(AX, (ext - L.upDeg) * D2R));
    else if (ext < -L.downDeg) rel.premultiply(q.setFromAxisAngle(AX, (ext + L.downDeg) * D2R));
  }

  private fadeFlash(dt: number): void {
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      const f = this.hitFlash, F = BB_ACTOR.flash;
      this.forEachMaterial(m => { (m as THREE.MeshStandardMaterial).emissive?.setRGB(f * F[0], f * F[1], f * F[2]); });
    }
  }

  /** World position of a bone (optionally + a bone-local offset in model metres; matrixWorld must be fresh). */
  private at(bone: string, local?: readonly number[] | null): Vec3 {
    const b = this.allBones.get(bone);
    if (!b) { const P = this.brain.pose, up = BB_BODY.centreUp * this.scale; return {x: P.x + P.ux * up, y: P.y + P.uy * up, z: P.z + P.uz * up}; }
    if (local) this.tmp.set(local[0], local[1], local[2]).applyMatrix4(b.matrixWorld);
    else this.tmp.setFromMatrixPosition(b.matrixWorld);
    return {x: this.tmp.x, y: this.tmp.y, z: this.tmp.z};
  }

  /**
   * The volumes of the current pose (matrixWorld fresh): the skull sphere FIRST (the nearest hit wins; on a tie the head), the
   * Hips -> Neck trunk, then each limb as its two bones. Without a rig: one trunk sphere at the body centre.
   */
  private computeVolumes(): HitVolume[] {
    const s = this.scale, rig = this.set?.rig;
    const v = (part: HitPart, a: Vec3, b: Vec3 | null, r: number): HitVolume => ({part, a, b, r: r * s});
    if (!rig) return [v('torso', this.at(''), null, BB_ASSET.hitRadii.torso * 1.6)];
    const H = rig.hit, hips = this.at('Hips'), top = this.at('Neck');
    const dx = top.x - hips.x, dy = top.y - hips.y, dz = top.z - hips.z, len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const k = Math.max(0.3, 1 - BB_ACTOR.torsoPullK * H.torso * s / len);
      top.x = hips.x + dx * k; top.y = hips.y + dy * k; top.z = hips.z + dz * k;
    }
    const out: HitVolume[] = [v('head', this.at('Head', rig.head.centre), null, rig.head.radius), v('torso', hips, top, H.torso)];
    for (const side of SIDES) {
      out.push(v('limb', this.at(`${side}_UpperArm`), this.at(`${side}_Forearm`), H.arm), v('limb', this.at(`${side}_Forearm`), this.at(`${side}_Hand`, rig.palm[side]), H.arm));
      out.push(v('limb', this.at(`${side}_Thigh`), this.at(`${side}_Shin`), H.leg), v('limb', this.at(`${side}_Shin`), this.at(`${side}_Foot`), H.leg));
    }
    return out;
  }

  /** Refresh hit volumes from the current pose (call after animate + syncTransform). */
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

  /** Corpse volumes: its own small ones (damage/system.ts would otherwise size an adult's around these bones). */
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

  /**
   * Just before the ragdoll's bodies are built from this pose (physics/ragdoll.ts), with the killing shot.
   *  - On a surface, the body is lifted along the surface normal until none of the ragdoll's spheres starts inside it (palms, knees
   *    and toes are planted ON the surface, so the spheres about them would start a few centimetres in it and be thrown out) — by
   *    BB_ACTOR.ragdollLiftM at most. In the air: nothing.
   *  - The shot's shove, as this body takes it (returned; the given object is not changed): a surface takes what is fired INTO it
   *    (a BB shot off a ceiling from below drops, it is not driven up through the slab), the throw is never a launch
   *    (ragdollShoveY: shot from straight below in mid-drop it falls at the shooter's feet, not through the ceiling), and the whole
   *    body leaves at ragdollMaxShoveMps at most.
   */
  prepareRagdoll(impulse: KillImpulse | null = null): KillImpulse | null {
    const P = this.brain.pose;
    if (this.ragdolled) return impulse;
    const s = this.scale, up = this.vy.set(P.ux, P.uy, P.uz), clings = P.surface !== 'air' && up.lengthSq() > 1e-8;
    if (clings) up.normalize();
    if (clings && this.set) {
      this.root.updateMatrixWorld(true);
      const o = this.root.position;
      let need = 0;
      for (const part of this.ragdollRig.parts) {
        const r = part.spheres.reduce((m, sp) => Math.max(m, sp.r), 0) * s;
        for (const n of [part.bone, part.child]) {
          const b = this.allBones.get(n);
          if (!b) continue;
          need = Math.max(need, r - this.tmp.setFromMatrixPosition(b.matrixWorld).sub(o).dot(up));
        }
      }
      const lift = Math.min(need + 0.004, BB_ACTOR.ragdollLiftM * s);
      if (lift > 0) { this.root.position.addScaledVector(up, lift); this.root.updateMatrixWorld(true); }
    }
    if (!impulse || !(impulse.strength > 0)) return impulse;
    const d = this.tmp.set(impulse.dir.x, impulse.dir.y, impulse.dir.z);
    if (!(d.lengthSq() > 1e-12)) return impulse;
    d.normalize();
    if (clings) { const into = d.dot(up); if (into < 0) d.addScaledVector(up, -into); }
    const flat = Math.hypot(d.x, d.z), Y = BB_ACTOR.ragdollShoveY;
    d.y = clamp(d.y, Y[0] * flat, Y[1] * flat);
    // (what is left of the unit shot: the share of its momentum that throws the body)
    const share = d.length();
    if (share < 1e-3) return null;
    const mass = this.ragdollRig.parts.reduce((m, p) => m + p.mass, 0) * s ** 3;
    return {...impulse, dir: {x: d.x, y: d.y, z: d.z}, strength: Math.min(impulse.strength * share, BB_ACTOR.ragdollMaxShoveMps * mass)};
  }

  beginRagdoll(): void {
    this.ragdolled = true;
  }

  setCullSphere(center: THREE.Vector3, radius: number): void {
    for (const m of this.skinned) {
      m.updateWorldMatrix(true, false);
      const s = m.matrixWorld.getMaxScaleOnAxis() || 1;
      m.boundingSphere!.center.copy(center).applyMatrix4(this.tmpInv.copy(m.matrixWorld).invert());
      m.boundingSphere!.radius = Math.max(0.6, radius) / s;
    }
  }

  ragdollMoved(x: number, z: number): void {
    this.brain.x = x;
    this.brain.z = z;
  }

  dispose(): void {
    this.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) m.skeleton.dispose(); });
    const all = new Set<THREE.Material>(this.ownMaterials);
    this.forEachMaterial(m => all.add(m));
    for (const m of all) m.dispose();
    this.ownMaterials.clear();
    this.clips.clear();
  }
}
