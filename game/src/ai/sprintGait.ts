// Task studio-sprinter-gait-20261112-063646-01: the SPRINTER's own sprint clip. User: "Give sprinter zombies a genuinely distinct sprint
// animation. The current regular-zombie run clip played faster is not sufficient: the player should clearly see a sprinting gait/pose
// rather than a sped-up shamble. Reuse the existing rigs/resources; choose an appropriate existing sprint clip or implement a distinct
// motion on that rig without new paid/generated art." No existing clip fits: the zombie bodies carry Idle / Walk / Run / Attack / Hit /
// Death only, and every other enemy (Strainer, Screacher, Siren, Blightbelly, rat/dog) has its own skeleton.
//
// WHAT: a hand-authored PROCEDURAL loop (periodic gait functions + the analytic 2-bone leg IK and arm aiming of the zombie pipeline —
// NOT motion capture, no generation, no new asset), built at load time on each body's OWN rig: the shared 18-joint skeleton of every
// zombie body GLB (tools/asset-pipeline/zombie/lib/skeleton.mjs JOINTS). Bind rotations are identity there, so the pipeline's pose maths
// (lib/pose.mjs Rig.legIK / armAim, lib/clips.mjs mirrorArm) is ported here; only the gait is new. Two inputs are read from the runtime
// body instead of the pipeline's skeleton record: the sole's toe / heel (from the foot-weighted mesh, as lib/skeleton.mjs measures them)
// and the hand's wrist-side axis (it follows the forearm: the hand-tip end is not part of a runtime skeleton). A rig that does not
// match (missing joint, non-identity rest) gets no clip and keeps the old behaviour (zombieActor.ts: the Run clip).
//
// THE GAIT (versus the ordinary Run, a hunched lurch with both arms reaching forward, 0.75 s / 2.3 m/s, the stance 36 % of a cycle):
//  - authored FOR the sprint pace: SPRINT_CLIP.groundSpeed = SPRINTER.chaseSpeed (4.3 m/s) at timeScale 1 on a scale-1 body, so at the
//    sprinter's pace it plays at ~1/scale (0.95-1.05) — never a sped-up cycle. Cadence 0.64 s per cycle = ~3.1 steps/s (the Run sped up to
//    4.3 m/s: ~5 steps/s), stride 2.75 m per cycle (Run: 1.73 m);
//  - a FLIGHT phase: each foot is down 28 % of a cycle, so both feet are off the floor ~44 % of the time (Run: 28 %);
//  - heel kick and knee drive: the swing foot folds up behind (knee flexion up to ~120-125 deg; Run ~106-116) and the thigh drives
//    forward (~60-68 deg from vertical; Run ~48-58) before it reaches for the floor; the hips drop at mid-stance and rise in flight. Hip
//    flexion stays inside the wardrobe fit gate's validated extremes (lib/extreme-poses.mjs: ~80 deg); the knee goes up to ~10 deg past
//    their ~115 (the Run itself reaches ~116), checked by CPU renders of coats and trousers at that frame;
//  - ARMS PUMP: elbows bent ~55-100 deg, each arm swinging fore and aft against its own leg (contralateral), the hands passing the hips on
//    the back swing, crossing toward the chest on the forward swing, clawed; the shoulders counter-rotate against the pelvis;
//  - the trunk leans into the run (~25-28 deg hips to neck) with the head thrust forward and up, eyes level on the target.
// The vertical motion (swing lift, heel kick, hip drop) follows the body's leg length; the stride follows the ground speed. Floor contact
// (stance sole on y = 0, nothing below it), no foot slide at the authored pace, the joint range and the differences from the Run are
// checked on every shipped body by game/tests/sprinter-gait.test.ts.

import * as THREE from 'three';

type V3 = [number, number, number];
type Q = [number, number, number, number];

/** The clip: name, cycle, the stance foot's ground speed at timeScale 1 (scale-1 body), duty factor, sampling and foot contacts. */
export const SPRINT_CLIP = {
  name: 'Sprint',
  /** Seconds per cycle (two steps) at timeScale 1. */
  duration: 0.64,
  /** Ground speed (m/s) the stance foot covers at timeScale 1 on a scale-1 body: the sprinter's pursuit pace (ai/sprinter.ts). */
  groundSpeed: 4.3,
  /** Stance share of a cycle per foot (the rest is swing; < 0.5 = a flight phase). */
  duty: 0.28,
  fps: 30,
  /** Clip phases (0..1) of the foot strikes: left at 0, right at 0.5 (zombieActor.ts counts footfalls on them). */
  contacts: [0, 0.5],
} as const;

/** One step (m) of the clip at timeScale 1 on a scale-1 body: half the ground covered per cycle. */
export const SPRINT_STEP_M = SPRINT_CLIP.groundSpeed * SPRINT_CLIP.duration / 2;

/** The zombie skeleton (lib/skeleton.mjs JOINTS): [joint, parent]. */
const JOINTS: readonly (readonly [string, string | null])[] = [
  ['Root', null], ['Hips', 'Root'], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'],
  ['L_UpperArm', 'Chest'], ['L_Forearm', 'L_UpperArm'], ['L_Hand', 'L_Forearm'],
  ['R_UpperArm', 'Chest'], ['R_Forearm', 'R_UpperArm'], ['R_Hand', 'R_Forearm'],
  ['L_Thigh', 'Hips'], ['L_Shin', 'L_Thigh'], ['L_Foot', 'L_Shin'],
  ['R_Thigh', 'Hips'], ['R_Shin', 'R_Thigh'], ['R_Foot', 'R_Shin'],
];

// ---------------------------------------------------------------- pose maths (lib/pose.mjs, ported)
const D2R = Math.PI / 180;
const qId = (): Q => [0, 0, 0, 1];
function qAxis(a: V3, deg: number): Q {
  const l = Math.hypot(a[0], a[1], a[2]) || 1, h = deg * D2R / 2, s = Math.sin(h) / l;
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}
function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const qInv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
function qRot(q: Q, v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function qNorm(q: Q): Q { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
/** Euler (degrees), applied yaw(Y) * pitch(X) * roll(Z); +X pitches +Y toward +Z (a forward bend). */
const euler = (x = 0, y = 0, z = 0): Q => qMul(qAxis([0, 1, 0], y), qMul(qAxis([1, 0, 0], x), qAxis([0, 0, 1], z)));
function qFromMat(m: number[]): Q { // row-major 3x3
  const [a, b, c, d, e, f, g, h, i] = m, tr = a + e + i;
  let q: Q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s]; }
  return qNorm(q);
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Rotation taking frame (d0, h0) to (d1, h1); h is orthogonalised against d. */
function frameRot(d0: V3, h0: V3, d1: V3, h1: V3): Q {
  const f = (d: V3, h: V3): [V3, V3, V3] => { const e1 = norm(d); const e2 = norm(sub(h, mul(e1, dot(h, e1)))); return [e1, e2, cross(e1, e2)]; };
  const A = f(d0, h0), B = f(d1, h1), m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = B[0][r] * A[0][c] + B[1][r] * A[1][c] + B[2][r] * A[2][c];
  return qFromMat(m);
}

// ---------------------------------------------------------------- the body's rig
/** What the gait needs of a body: bind joint positions (skeleton space, metres), bone lengths and the sole's toe / heel. */
export interface SprintRig {
  bind: Record<string, V3>;
  /** Hips bone rest translation (the clip's Hips.position track is this + the gait's offset). */
  hipsRest: V3;
  thighLen: number;
  shinLen: number;
  /** Sole extremes (z, skeleton space): the toe tip (heel-up pivot) and the heel (+1 cm; toes-up pivot) — lib/skeleton.mjs heelZ. */
  toeZ: number;
  heelZ: number;
}

/**
 * The rig of a zombie body in its rest pose (a fresh clone, before any mixer update): null unless every JOINTS bone is there with its
 * parent, an identity rest rotation and unit scale (the convention the gait maths assumes). The sole comes from the body mesh's
 * foot-weighted vertices (within 4 cm of the floor, as lib/skeleton.mjs measures it); without them, ratios of the leg.
 */
export function sprintRigOf(root: THREE.Object3D): SprintRig | null {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse(o => { if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o); });
  const bind: Record<string, V3> = {};
  for (const [n, p] of JOINTS) {
    const b = bones.get(n);
    if (!b || (p && b.parent?.name !== p)) return null;
    const q = b.quaternion, s = b.scale;
    if (Math.abs(q.w) < 0.99999 || Math.abs(s.x - 1) > 1e-4 || Math.abs(s.y - 1) > 1e-4 || Math.abs(s.z - 1) > 1e-4) return null;
    const local: V3 = [b.position.x, b.position.y, b.position.z];
    bind[n] = p ? add(bind[p], local) : [0, 0, 0];
  }
  const hb = bones.get('Hips')!.position;
  const thighLen = len(sub(bind.L_Shin, bind.L_Thigh)), shinLen = len(sub(bind.L_Foot, bind.L_Shin));
  const sole = soleOf(root);
  const ankleZ = (bind.L_Foot[2] + bind.R_Foot[2]) / 2, legLen = thighLen + shinLen;
  return {
    bind, hipsRest: [hb.x, hb.y, hb.z], thighLen, shinLen,
    toeZ: sole?.toe ?? ankleZ + 0.27 * legLen,
    heelZ: sole ? sole.heel + 0.01 : ankleZ - 0.08 * legLen,
  };
}

/** Toe / heel z of the body mesh's sole: vertices within 4 cm of the floor whose heaviest weight is a foot bone (lib/skeleton.mjs). */
function soleOf(root: THREE.Object3D): {toe: number; heel: number} | null {
  const body = root.getObjectByName('ZombieBody') as THREE.SkinnedMesh | undefined;
  const g = body?.isSkinnedMesh ? body.geometry : null;
  const pos = g?.getAttribute('position'), si = g?.getAttribute('skinIndex'), sw = g?.getAttribute('skinWeight');
  if (!body || !pos || !si || !sw) return null;
  const feet = new Set(body.skeleton.bones.flatMap((b, i) => (b.name === 'L_Foot' || b.name === 'R_Foot' ? [i] : [])));
  let toe = -Infinity, heel = Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) >= 0.04) continue;
    let best = 0, j = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; j = si.getComponent(i, k); } }
    if (!feet.has(j)) continue;
    const z = pos.getZ(i);
    if (z > toe) toe = z;
    if (z < heel) heel = z;
  }
  return toe > heel ? {toe, heel} : null;
}

// ---------------------------------------------------------------- IK / aiming (lib/pose.mjs Rig, ported)
interface Pose { hips: V3; rot: Record<string, Q>; reach: number }
interface Leg { z: number; x: number; lift: number; pitch: number; yaw: number }
interface Arm { dir: V3; hinge: V3; flex: number; wrist: number; twist: number; wristSide: number }

function hipsWorld(rig: SprintRig, pose: Pose): {rot: Q; pos: V3} {
  return {rot: pose.rot.Hips ?? qId(), pos: add(rig.bind.Hips, pose.hips)};
}

/** Leg IK (Rig.legIK): foot = {z, x lateral, lift, pitch (+ heel up about the toe, - toes up about the heel), yaw}. */
function legIK(rig: SprintRig, pose: Pose, side: 'L' | 'R', foot: Leg): number {
  const b = rig.bind, sg = side === 'L' ? 1 : -1;
  const H = hipsWorld(rig, pose);
  const hip = add(H.pos, qRot(H.rot, sub(b[side + '_Thigh'], b.Hips)));
  const A0 = b[side + '_Foot'];
  const qf = qMul(qAxis([0, 1, 0], foot.yaw), qAxis([1, 0, 0], foot.pitch));
  const pivot0: V3 = [A0[0], 0, foot.pitch >= 0 ? rig.toeZ : rig.heelZ];
  const ground: V3 = [A0[0] + foot.x * sg, foot.lift, foot.z + pivot0[2]];
  const ankle = add(ground, qRot(qf, sub(A0, pivot0)));
  const a = rig.thighLen, c = rig.shinLen;
  let d = len(sub(ankle, hip));
  const u = norm(sub(ankle, hip));
  d = Math.min(Math.max(d, Math.abs(a - c) + 1e-3), (a + c) * 0.9995);
  const fwd = qRot(H.rot, norm([0.08 * sg, 0, 1]));
  const v = norm(sub(fwd, mul(u, dot(fwd, u))));
  const cosA = (a * a + d * d - c * c) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const knee = add(hip, add(mul(u, a * cosA), mul(v, a * sinA)));
  const ankleT = add(hip, mul(u, d));
  const dT = norm(sub(knee, hip)), dS = norm(sub(ankleT, knee));
  const hinge = norm(cross(v, u));
  const dT0 = norm(sub(b[side + '_Shin'], b[side + '_Thigh'])), dS0 = norm(sub(A0, b[side + '_Shin']));
  const Rt = frameRot(dT0, [1, 0, 0], dT, hinge), Rs = frameRot(dS0, [1, 0, 0], dS, hinge);
  pose.rot[side + '_Thigh'] = qMul(qInv(H.rot), Rt);
  pose.rot[side + '_Shin'] = qMul(qInv(Rt), Rs);
  pose.rot[side + '_Foot'] = qMul(qInv(Rs), qf);
  return len(sub(ankle, hip)) / (a + c);
}

/** Arm aim in the Chest frame (Rig.armAim): upper-arm direction, elbow hinge axis, flexion, wrist, twist (deg). */
function armAim(rig: SprintRig, pose: Pose, side: 'L' | 'R', A: Arm): void {
  const b = rig.bind;
  const dU0 = norm(sub(b[side + '_Forearm'], b[side + '_UpperArm'])), dF0 = norm(sub(b[side + '_Hand'], b[side + '_Forearm']));
  const hU0 = norm(cross(dU0, [0, 0, 1])), hF0 = norm(cross(dF0, [0, 0, 1]));
  pose.rot[side + '_UpperArm'] = frameRot(dU0, hU0, norm(A.dir), norm(A.hinge));
  pose.rot[side + '_Forearm'] = qAxis(hF0, A.flex);
  // (the hand continues the forearm: the rig's hand-tip end is not part of a runtime skeleton)
  const side0 = norm(cross(dF0, hF0));
  pose.rot[side + '_Hand'] = qMul(qAxis(dF0, A.twist), qMul(qAxis(hF0, A.wrist), qAxis(side0, A.wristSide)));
}

/** Mirror an arm to the other side (lib/clips.mjs mirrorArm): polar axes flip x, axial (hinge) axes flip y / z; twist / wristSide flip. */
const mirrorArm = (a: Arm): Arm => ({...a, dir: [-a.dir[0], a.dir[1], a.dir[2]], hinge: [a.hinge[0], -a.hinge[1], -a.hinge[2]], twist: -a.twist, wristSide: -a.wristSide});

// ---------------------------------------------------------------- the gait
const TAU = Math.PI * 2;
const ss = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const frac = (x: number): number => ((x % 1) + 1) % 1;
/** Hip-to-ankle leg length (m) the gait's heights were tuned on (the Last-shift body). */
const REFERENCE_LEG_M = 0.764;

/**
 * One foot of the sprint at cycle phase `phase` (0 = this foot strikes). Stance (the first `duty` of the cycle): the planted foot slides
 * back at the ground speed (z: front -> back, no lift), landing on the forefoot, flat at mid-stance, the heel rising into toe-off. Swing:
 * the foot first keeps travelling back and up (heel kick: it folds up behind the body), then the knee drives it forward high and it
 * reaches down for the next strike.
 */
function sprintFoot(phase: number, stride: number, front: number, k: number): {z: number; lift: number; pitch: number} {
  const D = SPRINT_CLIP.duty, back = front - stride, ph = frac(phase);
  if (ph < D) {
    const s = ph / D;
    return {z: front - stride * s, lift: 0, pitch: lerp(5, 0, ss(0, 0.3, s)) + 34 * ss(0.5, 1, s)};
  }
  const s = (ph - D) / (1 - D);
  const kick = 0.06 * k * Math.sin(Math.PI * Math.min(1, s / 0.42));
  const z = back + (front - back) * ss(0.2, 0.93, s) - kick;
  const lift = k * (0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.06)), 0.7) + 0.04 * Math.sin(Math.PI * Math.min(1, s / 0.5)));
  const pitch = s < 0.35 ? lerp(34, 46, ss(0, 0.35, s)) : lerp(46, 5, ss(0.35, 1, s));
  return {z, lift: Math.max(0, lift), pitch};
}

/** The sprint pose at cycle phase `ph` (0..1; the left foot strikes at 0, the right at 0.5). */
function sprintPose(rig: SprintRig, ph: number): Pose {
  const w = TAU * ph;
  const stride = SPRINT_CLIP.groundSpeed * SPRINT_CLIP.duty * SPRINT_CLIP.duration;
  const front = stride * 0.42;
  // the vertical motion follows the body's leg (the stride follows the ground speed): k = 1 on the Last-shift body's 0.764 m leg
  const k = (rig.thighLen + rig.shinLen) / REFERENCE_LEG_M;
  const fl = sprintFoot(ph, stride, front, k), fr = sprintFoot(ph + 0.5, stride, front, k);
  // the hips are lowest at each mid-stance (phase duty / 2, + 0.5) and highest in the flight between the steps
  const bob = -0.032 * k * Math.cos(2 * TAU * (ph - SPRINT_CLIP.duty / 2));
  const c = Math.cos(w), s = Math.sin(w);
  const pose: Pose = {hips: [0.018 * s, -0.085 * k + bob, 0.07], rot: {}, reach: 0};
  // the pelvis turns with the swinging leg (left hip forward at the left strike), the shoulders counter-rotate against it
  pose.rot.Hips = euler(12 + 2 * Math.cos(2 * w), -8 * c, -3 * s);
  pose.rot.Spine = euler(16, 5 * c, 2 * s);
  pose.rot.Chest = euler(11 + 2.5 * Math.cos(2 * w + 0.6), 11 * c, 2 * s);
  // the head thrust forward and up: eyes level on the target over the lean, steadied against the bob
  pose.rot.Neck = euler(10, -4 * c, 0);
  pose.rot.Head = euler(-48 + 3 * Math.cos(2 * w), -6 * c, 0);
  // arms pump against their own leg: the left arm is back when the left foot strikes (phase 0) and forward at the right strike
  const arm = (fwd: number): Arm => {
    const th = (24 + 52 * fwd) * D2R; // upper-arm swing in the Chest's sagittal plane (deg from its down axis; + forward)
    return {dir: [0.2, -Math.cos(th), Math.sin(th)], hinge: [-1, 0, -0.4], flex: 78 + 22 * fwd, wrist: 20, twist: 25, wristSide: -10};
  };
  armAim(rig, pose, 'L', arm(-c));
  armAim(rig, pose, 'R', mirrorArm(arm(c)));
  pose.reach = Math.max(
    legIK(rig, pose, 'L', {z: fl.z, x: -0.015, lift: fl.lift, pitch: fl.pitch, yaw: 4}),
    legIK(rig, pose, 'R', {z: fr.z, x: -0.015, lift: fr.lift, pitch: fr.pitch, yaw: -4}),
  );
  return pose;
}

/** Joint local rotations + the hips offset at clip time `t` (s, 0..duration): the clip's frames, and the tests' oracle. */
export function sprintPoseAt(rig: SprintRig, t: number): {rot: Record<string, Q>; hips: V3; reach: number} {
  const p = sprintPose(rig, frac(t / SPRINT_CLIP.duration));
  return {rot: p.rot, hips: p.hips, reach: p.reach};
}

/**
 * The Sprint clip of a rig: every joint's quaternion track and the Hips translation, sampled evenly at ~SPRINT_CLIP.fps over one cycle,
 * the last frame an exact copy of the first (a seamless LoopRepeat), linear like the GLB clips.
 */
export function buildSprintClip(rig: SprintRig): THREE.AnimationClip {
  const T = SPRINT_CLIP.duration, frames = Math.round(T * SPRINT_CLIP.fps);
  const names = JOINTS.map(j => j[0]).filter(n => n !== 'Root');
  const times = new Float32Array(frames + 1);
  const rot = new Map(names.map(n => [n, new Float32Array((frames + 1) * 4)]));
  const hips = new Float32Array((frames + 1) * 3);
  const prev = new Map<string, Q>();
  for (let f = 0; f <= frames; f++) {
    times[f] = f === frames ? T : f * T / frames;
    const p = sprintPose(rig, f === frames ? 0 : f / frames);
    for (const n of names) {
      let q = p.rot[n] ?? qId();
      const pq = prev.get(n);
      if (pq && pq[0] * q[0] + pq[1] * q[1] + pq[2] * q[2] + pq[3] * q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
      prev.set(n, q);
      rot.get(n)!.set(q, f * 4);
    }
    hips.set(add(rig.hipsRest, p.hips), f * 3);
  }
  const tracks: THREE.KeyframeTrack[] = names.map(n => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, rot.get(n)!));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
  return new THREE.AnimationClip(SPRINT_CLIP.name, T, tracks);
}

/** One Sprint clip per body model (keyed by its shared animations array: every actor of a body GLB shares that array). */
const CLIPS = new WeakMap<object, THREE.AnimationClip | null>();

/**
 * The Sprint clip of a freshly built zombie `root` (its bones still at rest) whose model's clips are `animations`; built once per body
 * model, null when the rig does not match (the caller keeps the Run clip). RNG-free: never draws from any stream.
 */
export function sprintClipFor(root: THREE.Object3D, animations: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  let clip = CLIPS.get(animations);
  if (clip === undefined) {
    const rig = sprintRigOf(root);
    clip = rig ? buildSprintClip(rig) : null;
    CLIPS.set(animations, clip);
  }
  return clip;
}
