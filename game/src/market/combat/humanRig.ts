// Task studio-market-rework-20261108-074144-01 (lane COMBAT): a RUNTIME pose solver for the market humans' shared 18-joint skeleton
// (tools/asset-pipeline/zombie/lib/skeleton.mjs JOINTS, prefixed '<body>_' in market-human-cast.glb) — the combat clips
// (market/combat/combatClips.ts) are authored with it at runtime instead of rebuilding the cast file (a rebuild re-fits and re-gates every
// garment against new validation poses and could change the seeded looks).
//
// Rig facts (tools/asset-pipeline/humans/lib/glb.mjs): every bind rotation is IDENTITY, so a joint's frame in the bind pose is the model
// frame (+Y up, +Z forward, +X = the character's LEFT) and a clip's local quaternion IS the joint's rotation relative to its parent; bind
// translations are each body's own. The trunk is forward kinematics (Euler degrees); arms / legs are FK or an analytic two-bone IK
// (wrist / ankle target + the direction the elbow / knee points), the upper bone's twist fixed by the joint's bind flexion direction (the
// forearm folds forward, the shin backward), so elbows and knees bend as hinges. Pure three.js math: Node tests sample it.
import * as THREE from 'three';

export const HUMAN_JOINTS = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot'] as const;
export type HumanJoint = typeof HUMAN_JOINTS[number];
export const HUMAN_PARENT: Readonly<Record<HumanJoint, HumanJoint | null>> = {
  Root: null, Hips: 'Root', Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  L_UpperArm: 'Chest', L_Forearm: 'L_UpperArm', L_Hand: 'L_Forearm', R_UpperArm: 'Chest', R_Forearm: 'R_UpperArm', R_Hand: 'R_Forearm',
  L_Thigh: 'Hips', L_Shin: 'L_Thigh', L_Foot: 'L_Shin', R_Thigh: 'Hips', R_Shin: 'R_Thigh', R_Foot: 'R_Shin',
};

/** Euler degrees [pitch about +X (+ tips the top FORWARD / swings a hanging limb BACK), yaw about +Y (+ turns LEFT), roll about +Z (+ lifts the left side)], order YXZ. */
export type Deg3 = readonly [number, number, number];
const DEG = Math.PI / 180;
export const eulerQ = (e: Deg3): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * DEG, e[1] * DEG, e[2] * DEG, 'YXZ'));
export const ZERO3: Deg3 = [0, 0, 0];

export interface LimbIK { kind: 'ik'; target: THREE.Vector3; pole: THREE.Vector3; end?: THREE.Quaternion }
export interface LimbFK { kind: 'fk'; upper: Deg3; lower: Deg3; end?: Deg3 }
export type Limb = LimbIK | LimbFK;

/** The posed trunk (model frame), handed to the limb functions: joint positions and world rotations. */
export interface Trunk { pos: Record<string, THREE.Vector3>; rot: Record<string, THREE.Quaternion> }

export interface HumanPose {
  /** Hips joint position (model frame). */
  hips: THREE.Vector3;
  hipsRot: Deg3;
  spine: Deg3; chest: Deg3; neck: Deg3; head: Deg3;
  armL(t: Trunk): Limb; armR(t: Trunk): Limb;
  legL(t: Trunk): Limb; legR(t: Trunk): Limb;
}

export interface SolvedPose {
  /** Local rotation of every joint (Root identity). */
  local: Record<HumanJoint, THREE.Quaternion>;
  /** Hips local position (= model frame: Root sits at the origin). */
  hips: THREE.Vector3;
  /** Model-frame joint positions / rotations. */
  pos: Record<HumanJoint, THREE.Vector3>;
  rot: Record<HumanJoint, THREE.Quaternion>;
}

const LIMBS = {
  L_arm: ['L_UpperArm', 'L_Forearm', 'L_Hand'], R_arm: ['R_UpperArm', 'R_Forearm', 'R_Hand'],
  L_leg: ['L_Thigh', 'L_Shin', 'L_Foot'], R_leg: ['R_Thigh', 'R_Shin', 'R_Foot'],
} as const satisfies Record<string, readonly [HumanJoint, HumanJoint, HumanJoint]>;

/** Rotation taking the orthonormalised frame (a0, b0) onto (a1, b1). */
function alignTwo(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3): THREE.Quaternion {
  const frame = (a: THREE.Vector3, b: THREE.Vector3) => {
    const x = a.clone().normalize();
    const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const m0 = frame(a0, b0), m1 = frame(a1, b1);
  return new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
}

/** A vector's part perpendicular to unit `axis`, normalised (null when degenerate). */
function perp(v: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 | null {
  const p = v.clone().addScaledVector(axis, -v.dot(axis));
  const l = p.length();
  return l > 1e-5 ? p.multiplyScalar(1 / l) : null;
}

export class HumanRig {
  /** Bind local translations (each body's own) and model-frame bind positions. */
  readonly bindLocal: Record<HumanJoint, THREE.Vector3>;
  readonly bind: Record<HumanJoint, THREE.Vector3>;
  /** Upper / lower bone lengths of each limb. */
  readonly len: Record<keyof typeof LIMBS, [number, number]>;

  constructor(bindLocal: Record<HumanJoint, THREE.Vector3>) {
    this.bindLocal = bindLocal;
    const bind = {} as Record<HumanJoint, THREE.Vector3>;
    for (const j of HUMAN_JOINTS) { const p = HUMAN_PARENT[j]; bind[j] = (p ? bind[p].clone() : new THREE.Vector3()).add(bindLocal[j]); }
    this.bind = bind;
    const len = {} as Record<keyof typeof LIMBS, [number, number]>;
    for (const [k, [, b, c]] of Object.entries(LIMBS) as [keyof typeof LIMBS, readonly HumanJoint[]][]) len[k] = [bindLocal[b].length(), bindLocal[c].length()];
    this.len = len;
  }

  /** From a body's skeleton bones (bind translations: the bones' positions before any clip, or the GLB nodes). */
  static fromBones(bone: (j: HumanJoint) => THREE.Object3D | undefined): HumanRig {
    const local = {} as Record<HumanJoint, THREE.Vector3>;
    for (const j of HUMAN_JOINTS) { const b = bone(j); if (!b) throw new Error(`human rig: no joint ${j}`); local[j] = b.position.clone(); }
    return new HumanRig(local);
  }

  /** Total reach of an arm / leg (m). */
  reach(limb: keyof typeof LIMBS): number { const [a, b] = this.len[limb]; return a + b; }

  solve(pose: HumanPose): SolvedPose {
    const L = this.bindLocal;
    const local = {} as Record<HumanJoint, THREE.Quaternion>;
    const pos = {} as Record<HumanJoint, THREE.Vector3>;
    const rot = {} as Record<HumanJoint, THREE.Quaternion>;
    local.Root = new THREE.Quaternion(); pos.Root = new THREE.Vector3(); rot.Root = new THREE.Quaternion();
    local.Hips = eulerQ(pose.hipsRot); pos.Hips = pose.hips.clone(); rot.Hips = local.Hips.clone();
    const chain = (j: HumanJoint, e: Deg3) => {
      const p = HUMAN_PARENT[j]!;
      local[j] = eulerQ(e);
      pos[j] = pos[p].clone().add(L[j].clone().applyQuaternion(rot[p]));
      rot[j] = rot[p].clone().multiply(local[j]);
    };
    chain('Spine', pose.spine); chain('Chest', pose.chest); chain('Neck', pose.neck); chain('Head', pose.head);
    // limb roots ride on the trunk
    for (const j of ['L_UpperArm', 'R_UpperArm', 'L_Thigh', 'R_Thigh'] as const) {
      const p = HUMAN_PARENT[j]!;
      pos[j] = pos[p].clone().add(L[j].clone().applyQuaternion(rot[p]));
    }
    const trunk: Trunk = {pos, rot};
    this.limb('L_arm', pose.armL(trunk), local, pos, rot, new THREE.Vector3(0, 0, 1));
    this.limb('R_arm', pose.armR(trunk), local, pos, rot, new THREE.Vector3(0, 0, 1));
    this.limb('L_leg', pose.legL(trunk), local, pos, rot, new THREE.Vector3(0, 0, -1));
    this.limb('R_leg', pose.legR(trunk), local, pos, rot, new THREE.Vector3(0, 0, -1));
    return {local, hips: pose.hips.clone(), pos, rot};
  }

  /**
   * One limb. FK: local Eulers. IK: the end joint at `target` (clamped into reach), the middle joint toward `pole`; `flex0` = the bind
   * direction the lower bone folds toward (arms forward, legs back) fixes the upper bone's twist; `end` = the end bone's model-frame
   * rotation (default: straight on the lower bone).
   */
  private limb(k: keyof typeof LIMBS, spec: Limb, local: Record<HumanJoint, THREE.Quaternion>, pos: Record<HumanJoint, THREE.Vector3>, rot: Record<HumanJoint, THREE.Quaternion>, flex0: THREE.Vector3): void {
    const [ja, jb, jc] = LIMBS[k], L = this.bindLocal, parent = HUMAN_PARENT[ja]!;
    const S = pos[ja];
    if (spec.kind === 'fk') {
      local[ja] = eulerQ(spec.upper); rot[ja] = rot[parent].clone().multiply(local[ja]);
      pos[jb] = S.clone().add(L[jb].clone().applyQuaternion(rot[ja]));
      local[jb] = eulerQ(spec.lower); rot[jb] = rot[ja].clone().multiply(local[jb]);
      pos[jc] = pos[jb].clone().add(L[jc].clone().applyQuaternion(rot[jb]));
      local[jc] = eulerQ(spec.end ?? ZERO3); rot[jc] = rot[jb].clone().multiply(local[jc]);
      return;
    }
    const [a, b] = this.len[k];
    const toT = spec.target.clone().sub(S);
    const d0 = toT.length();
    const u = d0 > 1e-6 ? toT.clone().multiplyScalar(1 / d0) : new THREE.Vector3(0, -1, 0);
    const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-4, d0));
    const T = S.clone().addScaledVector(u, d);
    const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
    const v = perp(spec.pole, u) ?? perp(new THREE.Vector3(0, 0, k.endsWith('leg') ? 1 : -1), u) ?? new THREE.Vector3(1, 0, 0);
    const E = S.clone().addScaledVector(u, a * cosA).addScaledVector(v, a * Math.sqrt(1 - cosA * cosA));
    const s1 = E.clone().sub(S).normalize(), w1 = T.clone().sub(E).normalize();
    // the lower bone folds toward the target side of the upper bone's line (straight limb: away from the pole)
    const f1 = perp(T.clone().sub(S), s1) ?? perp(spec.pole.clone().negate(), s1) ?? new THREE.Vector3(0, 0, 1);
    const s0 = L[jb].clone().normalize();
    const f0 = perp(flex0, s0) ?? new THREE.Vector3(0, 0, 1);
    const Ra = alignTwo(s0, f0, s1, f1);
    const w0 = L[jc].clone().normalize().applyQuaternion(Ra);
    const Rb = new THREE.Quaternion().setFromUnitVectors(w0, w1).multiply(Ra);
    const Rc = spec.end ? spec.end.clone() : Rb.clone();
    rot[ja] = Ra; rot[jb] = Rb; rot[jc] = Rc;
    local[ja] = rot[parent].clone().invert().multiply(Ra);
    local[jb] = Ra.clone().invert().multiply(Rb);
    local[jc] = Rb.clone().invert().multiply(Rc);
    pos[jb] = S.clone().add(L[jb].clone().applyQuaternion(Ra));
    pos[jc] = pos[jb].clone().add(L[jc].clone().applyQuaternion(Rb));
  }
}

/**
 * Sample a pose function into an AnimationClip: one quaternion track per joint (Root excluded, as the cast's own clips) + the Hips
 * position track, named '<prefix><joint>.quaternion' / '.position'. `fps` 30 like the cast's clips; a loop's last key equals its first.
 */
export function sampleClip(name: string, duration: number, rig: HumanRig, prefix: string, at: (t: number) => HumanPose, fps = 30): THREE.AnimationClip {
  const n = Math.max(1, Math.round(duration * fps));
  const times = new Float32Array(n + 1);
  const joints = HUMAN_JOINTS.filter(j => j !== 'Root');
  const q = joints.map(() => new Float32Array((n + 1) * 4));
  const hp = new Float32Array((n + 1) * 3);
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * duration;
    times[k] = t;
    const s = rig.solve(at(t));
    joints.forEach((j, i) => {
      const v = s.local[j], a = q[i];
      // keep successive keys on the same hemisphere (no 360-degree spins between keys)
      const flip = k > 0 && a[(k - 1) * 4] * v.x + a[(k - 1) * 4 + 1] * v.y + a[(k - 1) * 4 + 2] * v.z + a[(k - 1) * 4 + 3] * v.w < 0 ? -1 : 1;
      a.set([v.x * flip, v.y * flip, v.z * flip, v.w * flip], k * 4);
    });
    hp.set([s.hips.x, s.hips.y, s.hips.z], k * 3);
  }
  const tracks: THREE.KeyframeTrack[] = joints.map((j, i) => new THREE.QuaternionKeyframeTrack(`${prefix}${j}.quaternion`, times, q[i]));
  tracks.push(new THREE.VectorKeyframeTrack(`${prefix}Hips.position`, times, hp));
  return new THREE.AnimationClip(name, duration, tracks);
}
