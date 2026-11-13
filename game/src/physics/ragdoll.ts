// Articulated ragdoll for the rigged zombie derivative (18-joint skeleton, see
// public/assets/derivatives/zombie-rigged.json). At death the CURRENT animated pose is snapshotted,
// 11 cannon-es rigid bodies are created to match it (sphere compounds sized from the bone
// segments), joined by point-to-point joints with anatomical swing/twist or hinge limits, and each
// frame the body transforms are written back into the skinned skeleton's bones (parent-space
// conversion; only the pelvis writes a translation, so joint drift can never stretch limbs).
//
// Rig facts used here: every bind-pose local rotation is identity, so each bone frame is aligned
// with model space in the bind pose (+Y up, +Z forward, +X = character LEFT). Joint axes below are
// therefore written once in bind/model coordinates and mirrored on X for the right side.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type {StaticQuery} from './staticQuery';

/** What the ragdoll needs from a zombie (ZombieActor implements it; tests use a bare skeleton). */
export interface RagdollTarget {
  readonly root: THREE.Object3D;
  readonly scale: number;
  readonly coated: boolean;
  /** Optional per-body girth multipliers vs the reference (Last-shift) rig (body x outfit registry). */
  readonly girth?: {torso: number; arm: number; leg: number};
  bone(name: string): THREE.Object3D | undefined;
  /** World-space velocity (m/s) of a bone origin from the last animated frames. */
  boneVelocity(name: string, out: THREE.Vector3): THREE.Vector3;
  /** Stop the animation mixer, keeping the current pose; animation/sync stop touching the bones. */
  beginRagdoll(): void;
  /** Frustum-cull sphere in world space (the skinned bounds no longer follow a clip). */
  setCullSphere(center: THREE.Vector3, radius: number): void;
  /** The body moved (pelvis ground position) — lets game logic/QA follow the corpse. */
  ragdollMoved?(x: number, z: number): void;
  /**
   * Iteration 07 (Lane K, generic hook for non-humanoid actors, e.g. Lane Q's quadruped): the
   * articulated rig to build (parts, joints, root/core parts). Omitted = the humanoid zombie rig
   * (HUMANOID_RIG). Sphere offsets are in each named bone's local frame (unscaled model metres).
   */
  readonly ragdollRig?: RagdollRig;
  /**
   * Task studio-bb-production-20261112-234540-01 (lane ACTOR): called once, first thing, before the bodies are built from the pose —
   * the target may put its root where the ragdoll should start (BB: lifted just clear of the wall / ceiling / floor it clings to, so
   * no sphere starts inside it). Omitted = nothing (every other enemy).
   */
  prepareRagdoll?(): void;
}

export interface KillImpulse {
  /** Shot direction (need not be unit). */
  dir: {x: number; y: number; z: number};
  /** World hit point of the killing shot. */
  point: {x: number; y: number; z: number};
  /** Impulse magnitude in N·s (see killImpulseStrength). */
  strength: number;
  /** Optional part hint ('head' for head shots); otherwise the part nearest the point is hit. */
  bone?: string;
}

export type PartName = 'pelvis' | 'torso' | 'head' | 'upperArmL' | 'forearmL' | 'upperArmR' | 'forearmR' | 'thighL' | 'shinL' | 'thighR' | 'shinR';

export const GROUP_STATIC = 1;
export const GROUP_RAGDOLL = 2;
/** Iteration 07 (Lane K): activate-on-hit items / light props and physical chunks (physics/dynamicItems.ts, chunks.ts). */
export const GROUP_ITEM = 4;
export const GROUP_CHUNK = 8;

type V3 = [number, number, number];
export type SphereSpec = {seg: string; t: number; r: number} | {at: V3; bone?: string; r: number} | {tip: number; bone: string; r: number};

export interface RagdollPartSpec {
  name: string;
  bone: string;
  /** Child bone defining the segment direction (bone axis d0). */
  child: string;
  parent: string | null;
  mass: number;
  /** Radius multiplier for the long-coat variant (coat panels add bulk). */
  coat: number;
  spheres: SphereSpec[];
  /** Linear/angular damping. */
  damp: [number, number];
  /** Which RagdollTarget.girth multiplier scales this part's spheres (default from the humanoid part name). */
  girth?: 'torso' | 'arm' | 'leg' | 'none';
}
type PartSpec = RagdollPartSpec;

export interface BallSpec { kind: 'ball'; cone: V3; coneAngle: number; twistRef: V3; twist: number }
/** Hinge about the bind-frame X axis ('x') or about (child axis x forward) ('elbow'), flexion min..max (rad). */
export interface HingeSpec { kind: 'hinge'; axis: 'x' | 'elbow'; min: number; max: number }

/**
 * A ragdoll rig (iteration 07 generic hook; the humanoid zombie rig is HUMANOID_RIG). Joint axes are
 * written in bind/model coordinates for the LEFT side; parts whose bone starts with `mirrorPrefix`
 * mirror the cone's X component.
 */
export interface RagdollRig {
  parts: RagdollPartSpec[];
  /** Joint limits per CHILD part name (every part except the root needs one). */
  joints: Record<string, BallSpec | HingeSpec>;
  /** Root part (writes the root translation; `Ragdoll.pelvis`). */
  root: string;
  /** Parts sharing the shot impulse a light hit part cannot take, with fractions summing to 1. */
  core: [string, number][];
  /** Part hit by head shots (KillImpulse.bone === 'head'). */
  head?: string;
  /** Parts whose first contact plays the body-fall cue. Default [root, core[0]]. */
  fall?: string[];
  /** Bone name prefix of right-side parts (default 'R_'). */
  mirrorPrefix?: string;
  /** Root bone of the skeleton (default 'Root', else the root part bone's parent). */
  rootBone?: string;
}

// Masses sum to ~72.6 kg at scale 1 (scaled by scale^3). Sphere offsets are in the named bone's
// local (bind-aligned) frame, in unscaled model metres.
function partSpecs(): PartSpec[] {
  const side = (s: 'L' | 'R'): PartSpec[] => {
    const P = (n: string) => `${s}_${n}`;
    return [
      {name: `upperArm${s}` as PartName, bone: P('UpperArm'), child: P('Forearm'), parent: 'torso', mass: 2.3, coat: 1.25, damp: [0.08, 0.55],
        spheres: [{seg: P('Forearm'), t: 0.2, r: 0.055}, {seg: P('Forearm'), t: 0.82, r: 0.05}]},
      {name: `forearm${s}` as PartName, bone: P('Forearm'), child: P('Hand'), parent: `upperArm${s}` as PartName, mass: 1.8, coat: 1.2, damp: [0.08, 0.6],
        spheres: [{seg: P('Hand'), t: 0.3, r: 0.045}, {seg: P('Hand'), t: 1.0, r: 0.042}, {tip: 0.075, bone: P('Hand'), r: 0.045}]},
      {name: `thigh${s}` as PartName, bone: P('Thigh'), child: P('Shin'), parent: 'pelvis', mass: 8.0, coat: 1.1, damp: [0.08, 0.5],
        spheres: [{seg: P('Shin'), t: 0.2, r: 0.078}, {seg: P('Shin'), t: 0.75, r: 0.068}]},
      {name: `shin${s}` as PartName, bone: P('Shin'), child: P('Foot'), parent: `thigh${s}` as PartName, mass: 4.2, coat: 1.0, damp: [0.08, 0.55],
        spheres: [{seg: P('Foot'), t: 0.02, r: 0.055}, {seg: P('Foot'), t: 0.4, r: 0.058}, {seg: P('Foot'), t: 0.85, r: 0.052}, {at: [0, -0.06, 0.075], bone: P('Foot'), r: 0.052}]},
    ];
  };
  return [
    {name: 'pelvis', bone: 'Hips', child: 'Spine', parent: null, mass: 11, coat: 1.12, damp: [0.06, 0.4],
      spheres: [{at: [0.085, 0.02, -0.005], r: 0.1}, {at: [-0.085, 0.02, -0.005], r: 0.1}, {at: [0, 0.1, -0.01], r: 0.1}]},
    {name: 'torso', bone: 'Spine', child: 'Chest', parent: 'pelvis', mass: 24, coat: 1.12, damp: [0.06, 0.4],
      spheres: [{at: [0.075, 0.06, 0.0], r: 0.105}, {at: [-0.075, 0.06, 0.0], r: 0.105}, {at: [0.1, 0.12, 0.0], bone: 'Chest', r: 0.112}, {at: [-0.1, 0.12, 0.0], bone: 'Chest', r: 0.112}]},
    {name: 'head', bone: 'Neck', child: 'Head', parent: 'torso', mass: 5, coat: 1.0, damp: [0.08, 0.6],
      spheres: [{at: [0, 0.075, 0.02], bone: 'Head', r: 0.1}]},
    ...side('L'), ...side('R'),
  ];
}

/** Joint limits per child part (left side; right mirrors X). Angles in radians. */
const JOINTS: Record<Exclude<PartName, 'pelvis'>, BallSpec | HingeSpec> & Record<string, BallSpec | HingeSpec> = {
  // lower spine: flex forward ~34 deg, back ~14 deg; side bend + axial twist ~20 deg
  torso: {kind: 'ball', cone: [0, 1, 0.18], coneAngle: 0.42, twistRef: [1, 0, 0], twist: 0.35},
  // neck: forward ~49 deg, back ~31 deg (a supine head can reach the floor); turn/tilt ~40 deg
  head: {kind: 'ball', cone: [0, 1, 0.15], coneAngle: 0.7, twistRef: [1, 0, 0], twist: 0.7},
  // shoulder: 69 deg cone around out-down-forward, loose twist ~52 deg
  upperArmL: {kind: 'ball', cone: [0.55, -0.6, 0.35], coneAngle: 1.2, twistRef: [1, 0, 0], twist: 0.9},
  upperArmR: {kind: 'ball', cone: [0.55, -0.6, 0.35], coneAngle: 1.2, twistRef: [1, 0, 0], twist: 0.9},
  // hip: flex forward ~82 deg, extend back ~26 deg, abduct/twist limited ~46 deg by the twist ref
  thighL: {kind: 'ball', cone: [0.12, -0.85, 0.42], coneAngle: 0.95, twistRef: [1, 0, 0], twist: 0.8},
  thighR: {kind: 'ball', cone: [0.12, -0.85, 0.42], coneAngle: 0.95, twistRef: [1, 0, 0], twist: 0.8},
  // elbow: hinge about (forearm x forward), 0..140 deg flexion
  forearmL: {kind: 'hinge', axis: 'elbow', min: 0, max: 2.45},
  forearmR: {kind: 'hinge', axis: 'elbow', min: 0, max: 2.45},
  // knee: hinge about the lateral axis, 0..132 deg flexion (shin swings backward)
  shinL: {kind: 'hinge', axis: 'x', min: 0, max: 2.3},
  shinR: {kind: 'hinge', axis: 'x', min: 0, max: 2.3},
};

/** The humanoid zombie rig (iteration 03; 11 parts, 10 joints). */
export const HUMANOID_RIG: RagdollRig = {
  parts: partSpecs(), joints: JOINTS, root: 'pelvis', core: [['torso', 0.6], ['pelvis', 0.4]], head: 'head', fall: ['pelvis', 'torso'], mirrorPrefix: 'R_', rootBone: 'Root',
};

/** Sphere radius multiplier for a part from the target's girth (clamped; 1 without girth data). */
function girthOf(g: RagdollTarget['girth'], spec: PartSpec): number {
  if (!g) return 1;
  const part = spec.name;
  const group = spec.girth ?? (part === 'pelvis' || part === 'torso' ? 'torso' : part.startsWith('upperArm') || part.startsWith('forearm') ? 'arm' : part.startsWith('thigh') || part.startsWith('shin') ? 'leg' : 'none');
  const k = group === 'none' ? 1 : g[group];
  return Math.min(1.45, Math.max(0.75, k));
}

/** Solver tuning (exported for tests/QA experiments). */
export const RAGDOLL_TUNING = {limitStiffness: 1e6, limitRelax: 6, jointDamping: 5, settleStart: 1.8, settleRamp: 2.5, settleRate: 5};
const _a = new CANNON.Vec3(), _b = new CANNON.Vec3(), _t1 = new CANNON.Vec3(), _t2 = new CANNON.Vec3();

/**
 * Point-to-point joint plus unilateral angle limits (each limit keeps the angle between a vector
 * fixed in A and a vector fixed in B below a maximum — the same equation cannon's ConeTwist uses)
 * and an optional hinge (two bilateral equations keeping the hinge axes parallel). Unlike
 * ConeTwistConstraint this normalises the twist reference vectors and supports an off-axis cone
 * centre, so limits stay correct for oblique limb axes. Limits that the start pose already exceeds
 * begin at the current angle and relax to the anatomical value over ~0.5 s (no start-up kick).
 */
export class RagdollJoint extends CANNON.PointToPointConstraint {
  private readonly limits: {eq: CANNON.RotationalEquation; a: CANNON.Vec3; b: CANNON.Vec3; target: number}[] = [];
  private hinge: {r1: CANNON.RotationalEquation; r2: CANNON.RotationalEquation; a: CANNON.Vec3; b: CANNON.Vec3} | null = null;

  constructor(bodyA: CANNON.Body, pivotA: CANNON.Vec3, bodyB: CANNON.Body, pivotB: CANNON.Vec3) {
    super(bodyA, pivotA, bodyB, pivotB, 1e6);
    this.collideConnected = false;
  }

  /** Current angle between local vectors a (in A) and b (in B). */
  angleBetween(a: CANNON.Vec3, b: CANNON.Vec3): number {
    this.bodyA.vectorToWorldFrame(a, _a);
    this.bodyB.vectorToWorldFrame(b, _b);
    return Math.acos(Math.max(-1, Math.min(1, _a.dot(_b) / (_a.length() * _b.length() || 1))));
  }

  addLimit(a: CANNON.Vec3, b: CANNON.Vec3, angle: number): void {
    const eq = new CANNON.RotationalEquation(this.bodyA, this.bodyB, {maxForce: 1e6});
    eq.maxForce = 0;
    eq.minForce = -1e6;
    // softer than contacts (stiffness 1e7): a limit never fights a floor contact into a limit cycle
    eq.setSpookParams(RAGDOLL_TUNING.limitStiffness, RAGDOLL_TUNING.limitRelax, 1 / 60);
    const ua = a.unit(), ub = b.unit();
    eq.maxAngle = Math.min(Math.PI, Math.max(angle, this.angleBetween(ua, ub) + 0.06));
    this.limits.push({eq, a: ua, b: ub, target: angle});
    this.equations.push(eq);
  }

  setHinge(a: CANNON.Vec3, b: CANNON.Vec3): void {
    const r1 = new CANNON.RotationalEquation(this.bodyA, this.bodyB, {maxForce: 1e6});
    const r2 = new CANNON.RotationalEquation(this.bodyA, this.bodyB, {maxForce: 1e6});
    this.hinge = {r1, r2, a: a.unit(), b: b.unit()};
    this.equations.push(r1, r2);
  }

  override update(): void {
    super.update();
    for (const l of this.limits) {
      this.bodyA.vectorToWorldFrame(l.a, l.eq.axisA);
      this.bodyB.vectorToWorldFrame(l.b, l.eq.axisB);
    }
    const h = this.hinge;
    if (h) {
      this.bodyA.vectorToWorldFrame(h.a, _a);
      _a.tangents(_t1, _t2);
      _t1.normalize();
      _t2.normalize();
      h.r1.axisA.copy(_t1);
      h.r2.axisA.copy(_t2);
      this.bodyB.vectorToWorldFrame(h.b, h.r1.axisB);
      h.r2.axisB.copy(h.r1.axisB);
    }
  }

  relax(dt: number): void {
    for (const l of this.limits) if (l.eq.maxAngle > l.target) l.eq.maxAngle = Math.max(l.target, l.eq.maxAngle - 0.9 * dt);
  }

  /**
   * Joint friction (dead tissue): bleed the bodies' RELATIVE angular velocity at `k` per second,
   * split by mass. Without it a limb resting against a limit can keep swinging along the limit
   * boundary (a solver limit cycle) instead of settling.
   */
  damp(dt: number, k: number): void {
    const A = this.bodyA, B = this.bodyB;
    const f = 1 - Math.exp(-k * dt);
    B.angularVelocity.vsub(A.angularVelocity, _a);
    const ma = A.mass, mb = B.mass, sum = ma + mb || 1;
    _a.scale(f * mb / sum, _b);
    if (A.sleepState !== CANNON.Body.SLEEPING) A.angularVelocity.vadd(_b, A.angularVelocity);
    _a.scale(f * ma / sum, _b);
    if (B.sleepState !== CANNON.Body.SLEEPING) B.angularVelocity.vsub(_b, B.angularVelocity);
  }
}

interface Part {
  spec: PartSpec;
  bone: THREE.Object3D;
  body: CANNON.Body;
  /** Bone origin relative to the body centre, in the body frame (constant). */
  boneOffset: CANNON.Vec3;
  /** Sphere centres in the body frame (for overlap checks). */
  local: {c: CANNON.Vec3; r: number}[];
  ghostT: number;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), ts = new THREE.Vector3();
const cv = new CANNON.Vec3(), cv2 = new CANNON.Vec3();

const toC = (v: THREE.Vector3, out = new CANNON.Vec3()) => out.set(v.x, v.y, v.z);
const toCq = (q: THREE.Quaternion, out = new CANNON.Quaternion()) => out.set(q.x, q.y, q.z, q.w);

export interface RagdollOptions {
  world: CANNON.World;
  material: CANNON.Material;
  statics: StaticQuery | null;
  /** Called once when the pelvis or torso first lands (strength 0..1). */
  onFall?: (x: number, y: number, z: number, strength: number) => void;
}

export class Ragdoll {
  readonly parts: Part[] = [];
  readonly joints: RagdollJoint[] = [];
  private readonly byName = new Map<string, Part>();
  /** The rig this ragdoll was built from (target.ragdollRig or HUMANOID_RIG). */
  readonly rig: RagdollRig;
  /** Bones in hierarchy order with their (frozen-unless-driven) local rotations. */
  private readonly order: {bone: THREE.Object3D; part: Part | null; parentIdx: number}[] = [];
  private readonly worldQ: THREE.Quaternion[] = [];
  private readonly baseQ = new THREE.Quaternion();
  private readonly rootBoneInv = new THREE.Matrix4();
  age = 0;
  private simT = 0;
  frozen = false;
  failed = false;
  private calmT = 0;
  private fell = false;
  readonly startedAt: number;

  constructor(readonly target: RagdollTarget, impulse: KillImpulse | null, private readonly opts: RagdollOptions, now = 0) {
    this.startedAt = now;
    target.prepareRagdoll?.(); // (BB: off the surface it clings to)
    const rig = (this.rig = target.ragdollRig ?? HUMANOID_RIG);
    const root = target.root;
    root.updateMatrixWorld(true);
    const rootPart = rig.parts.find(p => p.name === rig.root);
    if (!rootPart) throw new Error(`ragdoll: rig root part ${rig.root} missing`);
    const rootBone = target.bone(rig.rootBone ?? 'Root') ?? target.bone(rootPart.bone)?.parent;
    if (!rootBone) throw new Error('ragdoll: no root bone');
    rootBone.updateWorldMatrix(true, false);
    this.rootBoneInv.copy(rootBone.matrixWorld).invert();
    (rootBone.parent ?? root).getWorldQuaternion(this.baseQ);
    const s = target.scale;
    const coatK = target.coated;

    for (const spec of rig.parts) {
      const bone = target.bone(spec.bone);
      const child = target.bone(spec.child);
      if (!bone || !child) throw new Error(`ragdoll: missing bone ${spec.bone}/${spec.child}`);
      bone.matrixWorld.decompose(tv, tq, ts);
      const boneOrigin = tv.clone();
      const qb = tq.clone();
      // sphere centres in world space
      const centres: {p: THREE.Vector3; r: number}[] = [];
      for (const sp of spec.spheres) {
        let p: THREE.Vector3;
        if ('seg' in sp) p = bone.localToWorld(target.bone(sp.seg)!.position.clone().multiplyScalar(sp.t));
        else if ('tip' in sp) { const b = target.bone(sp.bone)!; p = b.localToWorld(b.position.clone().normalize().multiplyScalar(sp.tip)); }
        else p = (sp.bone ? target.bone(sp.bone)! : bone).localToWorld(new THREE.Vector3(...sp.at));
        centres.push({p, r: sp.r * s * (coatK ? spec.coat : 1) * girthOf(target.girth, spec)});
      }
      const com = new THREE.Vector3();
      let wsum = 0;
      for (const c of centres) { const w = c.r ** 3; com.addScaledVector(c.p, w); wsum += w; }
      com.divideScalar(wsum);
      const inv = qb.clone().invert();
      const body = new CANNON.Body({mass: spec.mass * s ** 3, material: opts.material, linearDamping: spec.damp[0], angularDamping: spec.damp[1],
        collisionFilterGroup: GROUP_RAGDOLL, collisionFilterMask: GROUP_STATIC, allowSleep: false});
      body.position.set(com.x, com.y, com.z);
      const local: Part['local'] = [];
      for (const c of centres) {
        const off = c.p.clone().sub(com).applyQuaternion(inv);
        const lc = toC(off);
        body.addShape(new CANNON.Sphere(c.r), lc); // inertia from the body-frame AABB (quaternion still identity)
        local.push({c: lc, r: c.r});
      }
      toCq(qb, body.quaternion);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.aabbNeedsUpdate = true;
      // carry over the animated motion: mean of the segment's two joint velocities, capped
      target.boneVelocity(spec.bone, tv).add(target.boneVelocity(spec.child, tv2)).multiplyScalar(0.5);
      if (tv.length() > 5) tv.setLength(5);
      body.velocity.set(tv.x, tv.y, tv.z);
      const boneOffset = toC(boneOrigin.sub(com).applyQuaternion(inv));
      const part: Part = {spec, bone, body, boneOffset, local, ghostT: 0};
      this.parts.push(part);
      this.byName.set(spec.name, part);
    }

    // joints, pivot at the child bone origin
    for (const part of this.parts) {
      const spec = part.spec;
      if (!spec.parent) continue;
      const parent = this.byName.get(spec.parent)!;
      const A = parent.body, B = part.body;
      part.bone.getWorldPosition(tv);
      const J = toC(tv);
      const pivotA = A.pointToLocalFrame(J, new CANNON.Vec3());
      const pivotB = B.pointToLocalFrame(J, new CANNON.Vec3());
      const joint = new RagdollJoint(A, pivotA, B, pivotB);
      const mirror = spec.bone.startsWith(rig.mirrorPrefix ?? 'R_') ? -1 : 1;
      // rotation taking bind-frame vectors of the child's real parent bone into the parent body frame
      parent.bone.getWorldQuaternion(tq);
      part.bone.parent!.getWorldQuaternion(tq2);
      const qRel = tq.invert().multiply(tq2);
      const toA = (v: THREE.Vector3) => toC(v.clone().applyQuaternion(qRel).normalize());
      const d0 = this.target.bone(spec.child)!.position.clone().normalize(); // child bone axis (child frame == bind)
      const js = rig.joints[spec.name];
      if (!js) throw new Error(`ragdoll: no joint spec for part ${spec.name}`);
      if (js.kind === 'ball') {
        const cone = new THREE.Vector3(js.cone[0] * mirror, js.cone[1], js.cone[2]).normalize();
        joint.addLimit(toA(cone), toC(d0), js.coneAngle);
        const r = new THREE.Vector3(...js.twistRef);
        r.addScaledVector(d0, -r.dot(d0)).normalize();
        joint.addLimit(toA(r), toC(r), js.twist);
      } else {
        const k = js.axis === 'x' ? new THREE.Vector3(1, 0, 0) : d0.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
        // hinge axis in A taken from the CURRENT pose so the joint starts satisfied (no snap)
        B.vectorToWorldFrame(toC(k), cv);
        const kA = A.vectorToLocalFrame(cv, new CANNON.Vec3()).unit();
        joint.setHinge(kA, toC(k));
        // flexion range: cone around the mid-range direction, swept about the hinge axis
        const kAt = new THREE.Vector3(kA.x, kA.y, kA.z);
        const dA = d0.clone().applyQuaternion(qRel);
        dA.addScaledVector(kAt, -dA.dot(kAt)).normalize();
        const mid = (js.min + js.max) / 2, half = (js.max - js.min) / 2 + 0.03;
        const centre = dA.applyAxisAngle(kAt, mid);
        joint.addLimit(toC(centre), toC(d0), half);
      }
      this.joints.push(joint);
    }

    // hierarchy order for write-back
    const index = new Map<THREE.Object3D, number>();
    rootBone.traverse(o => {
      if (!(o as THREE.Bone).isBone && o !== rootBone) return;
      const part = this.parts.find(p => p.bone === o) ?? null;
      index.set(o, this.order.length);
      this.order.push({bone: o, part, parentIdx: o === rootBone ? -1 : index.get(o.parent!) ?? -1});
      this.worldQ.push(new THREE.Quaternion());
    });

    // the killing shot
    if (impulse && impulse.strength > 0) this.applyShot(impulse);

    // bodies whose spheres start inside walls/props do not collide until they are clear (prevents
    // the solver from popping an arm through a wall it was animated into)
    for (const p of this.parts) if (this.insideStatic(p)) { p.ghostT = 0.7; p.body.collisionFilterMask = 0; }

    const fallParts = rig.fall ?? [rig.root, rig.core[0]?.[0] ?? rig.root];
    for (const p of this.parts) {
      if (fallParts.includes(p.spec.name)) {
        p.body.addEventListener('collide', (e: {contact: CANNON.ContactEquation}) => {
          if (this.fell) return;
          this.fell = true;
          const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
          const b = p.body.position;
          this.opts.onFall?.(b.x, b.y, b.z, Math.min(1, v / 4));
        });
      }
    }
    for (const p of this.parts) opts.world.addBody(p.body);
    for (const j of this.joints) opts.world.addConstraint(j);
    target.beginRagdoll();
    this.sync(false);
  }

  part(name: PartName | string): Part | undefined {
    return this.byName.get(name);
  }

  get pelvis(): CANNON.Body {
    return this.byName.get(this.rig.root)!.body;
  }

  private applyShot(imp: KillImpulse): void {
    const dir = new THREE.Vector3(imp.dir.x, imp.dir.y, imp.dir.z);
    if (dir.lengthSq() < 1e-9) return;
    dir.normalize();
    dir.y = Math.max(-0.3, Math.min(0.15, dir.y)); // shots from eye height should shove, not launch or pin
    dir.normalize();
    const point = new CANNON.Vec3(imp.point.x, imp.point.y, imp.point.z);
    const rig = this.rig;
    let hit: Part = this.byName.get(rig.core[0]?.[0] ?? rig.root)!;
    const headPart = rig.head ? this.byName.get(rig.head) : undefined;
    if (imp.bone === 'head' && headPart) hit = headPart;
    else {
      let best = Infinity;
      for (const p of this.parts) {
        for (const l of p.local) {
          p.body.pointToWorldFrame(l.c, cv);
          const d = cv.distanceTo(point) - l.r;
          if (d < best) { best = d; hit = p; }
        }
      }
    }
    // The hit part takes what it can without exceeding ~6.5 m/s; the rest goes to the core so the
    // whole body is shoved (avoids a 2 kg forearm being fired off at 20 m/s).
    const J = imp.strength;
    const local = Math.min(J, 6.5 * hit.body.mass);
    const rest = J - local;
    cv.set(dir.x * local, dir.y * local, dir.z * local);
    point.vsub(hit.body.position, cv2);
    if (cv2.length() > 0.4) cv2.scale(0.4 / cv2.length(), cv2);
    hit.body.applyImpulse(cv, cv2);
    if (rest > 0) {
      for (const [n, k] of rig.core) {
        const b = this.byName.get(n)?.body;
        if (!b) continue;
        cv.set(dir.x * rest * k, dir.y * rest * k, dir.z * rest * k);
        b.applyImpulse(cv, new CANNON.Vec3());
      }
    }
  }

  private insideStatic(p: Part): boolean {
    const q = this.opts.statics;
    if (!q) return false;
    for (const l of p.local) {
      p.body.pointToWorldFrame(l.c, cv);
      if (q.insideSolid(cv.x, cv.y, cv.z)) return true;
    }
    return false;
  }

  /**
   * Before each fixed step: discrete contacts let a fast-falling sphere sink up to v*dt (~8 cm at
   * 5 m/s) into the floor for a frame. Limit the downward speed of falling parts so no sphere can
   * end the step more than 30% of its radius below the ground/prop top under it (CCD-lite).
   */
  preStep(h: number): void {
    const q = this.opts.statics;
    if (!q) return;
    for (const p of this.parts) {
      const b = p.body;
      if (p.ghostT > 0) continue;
      for (const l of p.local) {
        b.pointToWorldFrame(l.c, cv);
        // point velocity of the sphere centre: v + w x r (whipping limbs are fast at their ends)
        cv.vsub(b.position, cv2);
        const pvy = b.velocity.y + (b.angularVelocity.z * cv2.x - b.angularVelocity.x * cv2.z);
        if (pvy > -1.5) continue;
        const ground = q.surfaceBelow(cv.x, cv.z, cv.y);
        if (!Number.isFinite(ground)) continue;
        const room = cv.y - l.r - ground + 0.3 * l.r;
        if (room > 0 && pvy * h < -room) {
          const f = room / (-pvy * h);
          b.velocity.scale(f, b.velocity);
          b.angularVelocity.scale(f, b.angularVelocity);
        }
      }
    }
  }

  /** Per fixed step: relax start-up limits, clamp runaway velocity, release ghosted parts. */
  postStep(h: number): void {
    this.simT += h;
    for (const j of this.joints) { j.relax(h); j.damp(h, RAGDOLL_TUNING.jointDamping); }
    // Settle assist: after the fall, progressively bleed spin and horizontal drift (not vertical
    // speed, so a late drop off a platform edge still falls normally). Per-body cannon sleeping is
    // off on purpose: a sleeping (static-to-the-solver) neighbour fighting a floor contact through a
    // joint causes endless jitter; the whole ragdoll is frozen at once instead.
    const T = RAGDOLL_TUNING;
    const settle = Math.min(1, Math.max(0, (this.simT - T.settleStart) / T.settleRamp));
    const sk = settle > 0 ? Math.exp(-settle * T.settleRate * h) : 1;
    for (const p of this.parts) {
      const b = p.body;
      if (sk < 1) { b.angularVelocity.scale(sk, b.angularVelocity); b.velocity.x *= sk; b.velocity.z *= sk; }
      const v = b.velocity.length();
      if (v > 14) b.velocity.scale(14 / v, b.velocity);
      const w = b.angularVelocity.length();
      if (w > 30) b.angularVelocity.scale(30 / w, b.angularVelocity);
      if (p.ghostT > 0) {
        p.ghostT -= h;
        if (p.ghostT <= 0 || !this.insideStatic(p)) { p.ghostT = 0; b.collisionFilterMask = GROUP_STATIC; }
      }
    }
  }

  /** Per frame (after stepping): settle detection. Returns true when it should freeze now. */
  update(dt: number): boolean {
    this.age += dt;
    let maxV = 0, maxW = 0, finite = true;
    for (const p of this.parts) {
      const b = p.body;
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w)) finite = false;
      maxV = Math.max(maxV, b.velocity.length());
      maxW = Math.max(maxW, b.angularVelocity.length());
    }
    if (!finite) { this.failed = true; return true; }
    if (maxV < 0.12 && maxW < 0.7) this.calmT += dt; else this.calmT = 0;
    if (this.calmT > 0.4 && this.age > 1.0) return true;
    return this.age > 8; // hard cap: never simulate a corpse forever
  }

  /** Write body transforms into the bones. `interp` uses cannon's interpolated transforms. */
  sync(interp = true): void {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      const o = this.order[i];
      const wq = this.worldQ[i];
      const parentQ = o.parentIdx >= 0 ? this.worldQ[o.parentIdx] : this.baseQ;
      if (!o.part) {
        wq.multiplyQuaternions(parentQ, o.bone.quaternion);
        continue;
      }
      const b = o.part.body;
      const q = interp ? b.interpolatedQuaternion : b.quaternion;
      const p = interp ? b.interpolatedPosition : b.position;
      wq.set(q.x, q.y, q.z, q.w);
      o.bone.quaternion.copy(tq.copy(parentQ).invert().multiply(wq));
      if (o.part.spec.name === 'pelvis') {
        q.vmult(o.part.boneOffset, cv);
        tv.set(p.x + cv.x, p.y + cv.y, p.z + cv.z).applyMatrix4(this.rootBoneInv);
        o.bone.position.copy(tv);
      }
    }
    const pel = this.pelvis.position;
    tv.set(pel.x, pel.y, pel.z);
    this.target.setCullSphere(tv, 1.35 * this.target.scale);
    this.target.ragdollMoved?.(pel.x, pel.z);
  }

  /** Remove bodies/joints from the world; the bones keep the last written pose (corpse stays). */
  freeze(): void {
    if (this.frozen) return;
    if (!this.failed) this.sync(false);
    for (const j of this.joints) this.opts.world.removeConstraint(j);
    for (const p of this.parts) this.opts.world.removeBody(p.body);
    this.frozen = true;
  }
}
