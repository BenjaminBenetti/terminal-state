// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CORPSE): the two FIXED poses a handled body takes, set directly on its bones
// (no animation mixer, no ragdoll simulation: world/corpses.ts stops both first with EnemyActor.beginRagdoll()).
//  - 'lying' (the record's BODY_POSES rest pose): the END FRAME of the actor's own Death clip — every humanoid enemy derivative ends it
//    supine on the floor with its root (the model origin) at floor height, and each asset's verification pins that lowest point at the
//    floor (zombie-rigged.json Death finalPose.lowestPointPerRegionM; the Blightbelly / Siren / Strainer cpuSkinningFloor checks); the
//    corpse system still measures each look's lowest skinned vertex once (restingLift: a garment may hang lower) and puts exactly that on
//    the floor — never floating, never sunk. Without a Death clip: a supine bind pose.
//  - 'carry' (a body over the shoulder): the pelvis face-down on the carrier's shoulder, the torso and arms hanging down the back, the
//    thighs down the front (hip flexion ~75 deg, knees a little bent). Rotations are relative to the BIND pose (every bind-pose local rotation
//    of the shared 18-joint rig is identity: bone frames are model-aligned, +Y up, +Z forward, +X the character's left), applied on top of
//    the bind-local transforms recovered from the skin's inverse bind matrices — exact for any body of the rig, whatever the bones held.

import * as THREE from 'three';

/** Carry-pose rotations (Euler XYZ, radians) on top of the bind pose, by bone name; the right side mirrors X (rotations about X: same). */
export const CARRY_POSE: Readonly<Record<string, readonly [number, number, number]>> = {
  Hips: [Math.PI / 2, 0, 0], // face down, the head side toward the root's +Z
  Spine: [0.6, 0, 0], Chest: [0.6, 0, 0], Neck: [0.35, 0, 0], Head: [0.2, 0, 0], // the torso curls down the carrier's back
  L_UpperArm: [-2.6, 0, 0], R_UpperArm: [-2.6, 0, 0], // the arms hang down past the head
  L_Forearm: [-0.25, 0, 0], R_Forearm: [-0.25, 0, 0],
  L_Thigh: [-1.3, 0, 0], R_Thigh: [-1.3, 0, 0], // the thighs down the carrier's front
  L_Shin: [0.45, 0, 0], R_Shin: [0.45, 0, 0],
};

/** Bones sampled for a lying body's footprint / ownership points (the humanoid rig's names; missing ones are skipped). */
export const BODY_POINTS = ['Head', 'Neck', 'Chest', 'Spine', 'Hips', 'L_Hand', 'R_Hand', 'L_Forearm', 'R_Forearm', 'L_Shin', 'R_Shin', 'L_Foot', 'R_Foot'] as const;

interface Local { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();

/** The first skinned mesh's skeleton under `root` that holds a 'Hips' bone (null: no humanoid skin). */
function skeletonOf(root: THREE.Object3D): THREE.Skeleton | null {
  let out: THREE.Skeleton | null = null;
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!out && m.isSkinnedMesh && m.skeleton?.bones.some(b => b.name === 'Hips')) out = m.skeleton;
  });
  return out;
}

/**
 * Bind-local transforms of every skeleton bone whose parent is a bone of the same skeleton (the skin's inverse bind matrices:
 * local = inverse-bind(parent) x bind(bone)). The skeleton root ('Root') is not listed: it is never animated or simulated.
 */
export function bindLocals(root: THREE.Object3D): Map<THREE.Object3D, Local> {
  const out = new Map<THREE.Object3D, Local>();
  const sk = skeletonOf(root);
  if (!sk) return out;
  sk.bones.forEach((b, i) => {
    const j = b.parent ? sk.bones.indexOf(b.parent as THREE.Bone) : -1;
    if (j < 0) return;
    M.copy(sk.boneInverses[i]).invert();
    M2.multiplyMatrices(sk.boneInverses[j], M);
    const l: Local = {p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3()};
    M2.decompose(l.p, l.q, l.s);
    out.set(b, l);
  });
  return out;
}

/** Every listed bone back to its bind-local transform. */
function toBind(binds: Map<THREE.Object3D, Local>): void {
  for (const [b, l] of binds) { b.position.copy(l.p); b.quaternion.copy(l.q); b.scale.copy(l.s); }
}

/** The end frame of `clip` on the bones under `root` (each track evaluated at its last key: a LoopOnce clamp holds exactly this). */
export function applyClipEnd(root: THREE.Object3D, clip: THREE.AnimationClip): number {
  let n = 0;
  for (const t of clip.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(t.name);
    const node = THREE.PropertyBinding.findNode(root, parsed.nodeName) as THREE.Object3D | null;
    if (!node || !t.times.length) continue;
    const v = (t as unknown as {createInterpolant(result?: unknown): THREE.Interpolant}).createInterpolant(undefined).evaluate(t.times[t.times.length - 1]);
    if (parsed.propertyName === 'quaternion') node.quaternion.fromArray(v as ArrayLike<number> as number[]).normalize();
    else if (parsed.propertyName === 'position') node.position.fromArray(v as ArrayLike<number> as number[]);
    else if (parsed.propertyName === 'scale') node.scale.fromArray(v as ArrayLike<number> as number[]);
    else continue;
    n++;
  }
  return n;
}

/** The actor-facing bits of a body (EnemyActor). */
export interface PosedActor { readonly root: THREE.Object3D; authoredClip?(name: string): THREE.AnimationClip | null }

/** 'lying': the Death clip's end frame on the bind pose (see the header). Returns 'clip' or the 'bind' fallback used. */
export function poseLying(actor: PosedActor): 'clip' | 'bind' {
  const binds = bindLocals(actor.root);
  toBind(binds);
  const clip = actor.authoredClip?.('Death') ?? null;
  if (clip && applyClipEnd(actor.root, clip) > 0) { actor.root.updateMatrixWorld(true); return 'clip'; }
  // no Death clip: supine in the bind pose (head toward -Z like the authored deaths), the pelvis resting on its back
  for (const [b] of binds) {
    if (b.name !== 'Hips') continue;
    b.quaternion.multiply(Q.setFromEuler(E.set(-Math.PI / 2, 0, 0)));
    b.position.y = 0.14;
  }
  actor.root.updateMatrixWorld(true);
  return 'bind';
}

/** 'carry': the over-the-shoulder pose (CARRY_POSE on the bind pose). */
export function poseCarry(actor: PosedActor): void {
  const binds = bindLocals(actor.root);
  toBind(binds);
  for (const [b, l] of binds) {
    const r = CARRY_POSE[b.name];
    if (r) b.quaternion.copy(l.q).multiply(Q.setFromEuler(E.set(r[0], r[1], r[2])));
  }
  actor.root.updateMatrixWorld(true);
}

/**
 * Task studio-refinement-batch-20261113-035659-01 (lane DROPS): a 'fallen' pose (a dropped body's ragdoll at rest, its record's `bones` /
 * `hips`) back on the bones — the bind pose first, then every recorded bone's local rotation by name and the pelvis' local position (a
 * name the body does not have is skipped; a bone the record lacks keeps its bind rotation). Returns how many recorded bones were set.
 */
export function poseFallen(actor: PosedActor, bones: Readonly<Record<string, readonly number[]>>, hips: readonly number[] | undefined): number {
  const binds = bindLocals(actor.root);
  toBind(binds);
  let n = 0;
  for (const [b] of binds) {
    const q = bones[b.name];
    if (q) { b.quaternion.set(q[0], q[1], q[2], q[3]).normalize(); n++; }
    if (b.name === 'Hips' && hips) b.position.set(hips[0], hips[1], hips[2]);
  }
  actor.root.updateMatrixWorld(true);
  return n;
}

/** Lane DROPS: the current pose's bone locals as a 'fallen' record's `bones` (rounded unit quaternions, by name) + the pelvis' position. */
export function readFallen(root: THREE.Object3D, round: (v: number) => number): {bones: Record<string, [number, number, number, number]>; hips: [number, number, number] | null} {
  const bones: Record<string, [number, number, number, number]> = {};
  let hips: [number, number, number] | null = null;
  for (const [b] of bindLocals(root)) {
    const q = b.quaternion.clone().normalize();
    const v = [round(q.x), round(q.y), round(q.z), round(q.w)];
    const len = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
    bones[b.name] = v.map(c => round(c / len)) as [number, number, number, number];
    if (b.name === 'Hips') hips = [round(b.position.x), round(b.position.y), round(b.position.z)];
  }
  return {bones, hips};
}

/**
 * The lift (unscaled model metres; + up) that puts the CURRENT pose's lowest skinned vertex exactly on the root's floor: CPU skinning of
 * every `stride`-th bind-space vertex (three's SkinnedMesh.applyBoneTransform, the shader's maths) measured in the root's frame. The
 * authored deaths end within millimetres of the floor; a flowing garment (the Siren's dress) may sink a few centimetres — this keeps
 * every body grounded, never floating or sunk. Bounded to +-0.25 m.
 */
export function restingLift(root: THREE.Object3D, stride = 1): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), v = new THREE.Vector3();
  let lo = Infinity;
  root.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      lo = Math.min(lo, v.applyMatrix4(m.matrixWorld).applyMatrix4(inv).y);
    }
  });
  return Number.isFinite(lo) ? Math.max(-0.25, Math.min(0.25, -lo)) : 0;
}

/** A bone's position in the root's own frame (unscaled by the root's transform: its matrix is undone). */
export function boneInRoot(root: THREE.Object3D, name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
  const b = root.getObjectByName(name);
  if (!b) return null;
  root.updateMatrixWorld(true);
  b.getWorldPosition(out);
  return root.worldToLocal(out);
}

/** World positions of the BODY_POINTS bones (matrices updated first). */
export function bodyPoints(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  for (const n of BODY_POINTS) { const b = root.getObjectByName(n); if (b) out.push(b.getWorldPosition(new THREE.Vector3())); }
  return out;
}
