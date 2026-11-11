// Task studio-screacher-production-20261110-221858-01 (lane RIG): procedural clips for the SCREACHER (a headless, lanky undead
// that hunts by sound) on the SHARED 18-joint skeleton. Hand-authored keyframes / periodic gait functions (NOT mocap),
// evaluated by the zombie pose math (zombie/lib/pose.mjs Rig: FK, 2-bone leg IK with foot roll, arm aiming) through
// zombie/lib/clips.mjs `realize`, structured like lib/strainer-clips.mjs (nothing in the shared libs or the other enemies'
// clips changes). The four variants (sc01..sc04) share every clip NAME / duration / timing; each is sampled with its own rig.
//
// Design: the body is rigged in its RELAXED pose as generated (arms hanging, each variant with its own approved shoulder
// posture), so the hanging arm poses are written RELATIVE to each side's bind arm (`rel`: swing forward / out from the bind
// direction; elbow flex is relative to the bind elbow anyway): a variant keeps its own carriage in Idle / Walk / Run. Big
// gestures (the rake, the scream, the fall) use absolute directions. Gait geometry comes from the rig's own leg length:
// the pelvis is lowered just enough for the contract stride (no over-reach = no foot skate).
//   Idle    a headless body LISTENING: slow weight shift, the chest turning from side to side, the stump tilting, the long arms
//           hanging, wrists / hands twitching;
//   Walk    a slow, long-legged stalking walk (double support, knees never locked), arms dangling behind the stride;
//   Run     a fast loping run with a flight phase, torso pitched forward, the long arms reaching / trailing;
//   Attack  a fast long-arm rake, the right arm leading: coil -> lunge on the left foot, the right arm whips round to full
//           reach at chest height (the hit frame) -> rakes down across the front -> recover;
//   Hit     a flinch;
//   Death   knees buckle, the body topples onto its back and settles (floor-solved final pose; no head term);
//   Scream  the echolocation scream of a body without a head: a short gathering crouch, then by the cue the chest is thrust
//           up, the back arched, the stump raised, the arms flung down and back with the wrists splayed; a shudder runs
//           through it; it sinks back into the Idle pose. The feet never move.
import {realize} from '../../zombie/lib/clips.mjs';
import {qSlerp, qRot, qAxis, qMul, qInv, euler, V} from '../../zombie/lib/pose.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';

export const FPS = 30;
const TAU = Math.PI * 2;
const JOINT_NAMES = JOINTS.map(j => j[0]);
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const dirN = v => V.norm(v);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Clip contract (GLB extras + sidecar; the runtime AI is shared by the four variants). groundSpeed = m/s the in-place
 * locomotion cycle is authored for at timeScale 1; impactTime = seconds into Attack when the right hand is at full reach in
 * front at chest height (the hit frame); cueTime = seconds into Scream when the body is fully arched (the scream sounds).
 */
export const CLIP_SPECS = {
  Idle: {duration: 3.6, loop: true},
  Walk: {duration: 1.3, loop: true, groundSpeed: 1.25, beta: 0.56},
  Run: {duration: 0.72, loop: true, groundSpeed: 3.9, beta: 0.34},
  Attack: {duration: 1.0, loop: false, impactTime: 0.42},
  Hit: {duration: 0.35, loop: false},
  Death: {duration: 1.8, loop: false},
  Scream: {duration: 1.6, loop: false, cueTime: 0.5},
};
/** Attack targets (the reach solve in the builder moves the lunge until the measured hand tip is `reachM` out at the hit frame). */
export const ATTACK = {reachM: 1.2, tipHeightM: 1.42, tipX: -0.04, lunge: [0.02, 0.75], hold: [0.4, 0.43334]};

// ---------------------------------------------------------------- arms
// An arm is {rel: {fwd, out}} (bind upper-arm direction abducted `out` deg away from the body, then swung `fwd` deg forward) or
// {dir} (absolute upper-arm direction in the Chest frame), plus flex (elbow, deg from the BIND elbow), wrist, twist, wristSide,
// roll. Without an explicit `hinge` the elbow keeps its bind plane: hinge = the bind hinge (bone x +Z, pose.mjs armAim)
// carried by the minimal swing bind direction -> target direction, then rolled by `roll` deg about the target direction
// (lib/blightbelly-clips.mjs / lib/strainer-clips.mjs scheme).
function minimalRot(a, b) {
  const c = V.cross(a, b), d = V.dot(a, b);
  if (V.len(c) < 1e-9) return d > 0 ? [0, 0, 0, 1] : qAxis(Math.abs(a[0]) < 0.9 ? V.cross(a, [1, 0, 0]) : V.cross(a, [0, 1, 0]), 180);
  return qAxis(c, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
}
export function bindArm(rig, side) {
  const b = rig.bind, d0 = V.norm(V.sub(b[side + '_Forearm'], b[side + '_UpperArm'])), f0 = V.norm(V.sub(b[side + '_Hand'], b[side + '_Forearm']));
  const up = V.len(V.sub(b[side + '_Forearm'], b[side + '_UpperArm'])), fo = V.len(V.sub(b[side + '_Hand'], b[side + '_Forearm'])), ha = V.len(V.sub(rig.ends[side + '_Hand'], b[side + '_Hand']));
  return {d0, f0, h0: V.norm(V.cross(d0, [0, 0, 1])), elbowDeg: Math.acos(clamp(V.dot(d0, f0), -1, 1)) * 180 / Math.PI, upper: up, fore: fo, hand: ha, length: up + fo + ha};
}
function resolveArm(rig, side, a) {
  if (a.hinge && a.dir) return a;
  const sg = side === 'L' ? 1 : -1, {d0, h0} = bindArm(rig, side);
  const d = a.rel ? qRot(qMul(qAxis([1, 0, 0], -(a.rel.fwd || 0)), qAxis([0, 0, 1], sg * (a.rel.out || 0))), d0) : V.norm(a.dir);
  let h = qRot(minimalRot(d0, d), h0);
  if (a.roll) h = qRot(qAxis(d, sg * a.roll), h);
  const {rel, ...rest} = a;
  return {...rest, dir: d, hinge: h};
}
const resolveArms = (rig, P) => ({...P, armL: resolveArm(rig, 'L', P.armL), armR: resolveArm(rig, 'R', P.armR)});
const HANG = {rel: {fwd: 2, out: 0}, flex: 4, wrist: 0, twist: 0, wristSide: 0};
const arm = (fwd, out, flex, more = {}) => ({rel: {fwd, out}, flex, wrist: 0, twist: 0, wristSide: 0, ...more});
const chestWorld = P => qMul(qMul(euler(...P.hipsRot), euler(...P.spine)), euler(...P.chest));
/**
 * Upper-arm direction (Chest frame) that points a straight arm of this side from its posed shoulder at a world target whose
 * height is `y` and whose lateral position is `x` (the forward distance follows from the arm length).
 */
function aimArmAt(rig, P, side, y, x) {
  const pose = realize(rig, resolveArms(rig, {...P, armL: HANG, armR: HANG}));
  const w = rig.fk(pose), sh = w[side + '_UpperArm'].pos, L = bindArm(rig, side).length;
  const dy = y - sh[1], dx = x - sh[0], dz = Math.sqrt(Math.max(0.01, L * L - dy * dy - dx * dx));
  return qRot(qInv(w.Chest.rot), V.norm([dx, dy, dz]));
}

// ---------------------------------------------------------------- keyframe interpolation
function mixParams(A, B, t) {
  const out = {};
  for (const k of ['hips', 'hipsRot', 'spine', 'chest', 'neck', 'head']) out[k] = lerpV(A[k], B[k], t);
  for (const k of ['armL', 'armR']) {
    const a = A[k], b = B[k];
    out[k] = {dir: dirN(lerpV(dirN(a.dir), dirN(b.dir), t)), hinge: dirN(lerpV(dirN(a.hinge), dirN(b.hinge), t)),
      flex: lerp(a.flex, b.flex, t), wrist: lerp(a.wrist || 0, b.wrist || 0, t), twist: lerp(a.twist || 0, b.twist || 0, t), wristSide: lerp(a.wristSide || 0, b.wristSide || 0, t)};
  }
  for (const k of ['legL', 'legR']) {
    const a = A[k], b = B[k];
    out[k] = {mode: 'ik', z: lerp(a.z, b.z, t), x: lerp(a.x || 0, b.x || 0, t), lift: lerp(a.lift || 0, b.lift || 0, t), pitch: lerp(a.pitch || 0, b.pitch || 0, t), yaw: lerp(a.yaw || 0, b.yaw || 0, t)};
  }
  return out;
}
const EASE = {inOut: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), linear: t => t, snap: t => 1 - Math.pow(1 - t, 3), whip: t => t * t * t};
/** Mixed parameter set at time t of a key list [{t, p, ease}] (arms resolved per key). */
function mixAt(rig, keys0, t) {
  const keys = keys0.map(k => ({...k, p: resolveArms(rig, k.p)}));
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const A = keys[i], B = keys[i + 1];
  const u = clamp((t - A.t) / (B.t - A.t), 0, 1);
  return mixParams(A.p, B.p, (EASE[B.ease || 'inOut'])(u));
}
const keyed = (rig, keys, t) => realize(rig, mixAt(rig, keys, t));

// ---------------------------------------------------------------- stance / Idle
const tw = k => Math.pow(Math.max(0, Math.sin(k)), 6); // a short twitch pulse (integer harmonics of the loop: seamless)
/** Idle parameter set at time t (the one-shots start and end on idleParams(0): the Idle pose). */
export function idleParams(t, T = CLIP_SPECS.Idle.duration) {
  const w = TAU * t / T, w2 = 2 * w;
  return {
    // slow weight shift from foot to foot, a faint rise and fall
    hips: [0.024 * Math.sin(w), -0.03 + 0.006 * Math.sin(w2 + 0.5), 0.008 * Math.sin(w + 1)],
    hipsRot: [3 + 0.6 * Math.sin(w2), 2.5 * Math.sin(w + 0.4), -2.2 * Math.sin(w)],
    spine: [2 + 1.0 * Math.sin(w2 + 0.3), -2 * Math.sin(w), 1.6 * Math.sin(w)],
    // listening: the chest turns slowly from side to side, the stump tilts and "looks" a little further
    chest: [3 + 1.6 * Math.sin(w2 + 0.8), 8 * Math.sin(w + 0.6) + 3 * Math.sin(w2 + 1.3), 1.0 * Math.sin(w)],
    neck: [-3 + 5 * Math.sin(w2 + 1.0), 9 * Math.sin(w + 1.1) + 5 * Math.sin(3 * w), 6 * Math.sin(w + 0.3) + 3 * Math.sin(w2)],
    head: [0, 0, 0],
    // long arms hanging; the wrists / hands twitch
    armL: arm(2 + 2 * Math.sin(w + 1), 0.5 + 0.8 * Math.sin(w + 0.2), 4 + 3 * Math.sin(w2) + 9 * tw(5 * w + 0.3), {wrist: -4 - 18 * tw(7 * w + 1.1) + 9 * tw(3 * w + 2), wristSide: 9 * tw(9 * w + 0.4), twist: 12 * tw(4 * w + 1.0)}),
    armR: arm(2 + 2 * Math.sin(w + 2.4), 0.5 + 0.8 * Math.sin(w + 2.0), 5 + 3 * Math.sin(w2 + 1.5) + 9 * tw(4 * w + 1.7), {wrist: -4 - 18 * tw(6 * w + 2.5) + 9 * tw(5 * w + 0.6), wristSide: -9 * tw(8 * w + 1.9), twist: -12 * tw(3 * w + 2.2)}),
    legL: {mode: 'ik', z: 0.03, x: 0.0, lift: 0, pitch: 0, yaw: 4}, legR: {mode: 'ik', z: -0.04, x: 0.0, lift: 0, pitch: 0, yaw: -5},
  };
}
export const basePose = () => idleParams(0);
const idle = (rig, t, T) => realize(rig, resolveArms(rig, idleParams(t, T)));

// ---------------------------------------------------------------- gait
/** Treadmill gait: the stance foot slides back at ground speed; the swing returns it forward (zombie/lib/clips.mjs footCycle). */
function footCycle(phase, {beta, stride, lift, pitchOff = 18, pitchStrike = -6, drag = 0, heelOff = 0.72}) {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < beta) {
    const s = ph / beta;
    return {z: stride / 2 - stride * s, lift: 0, pitch: lerp(pitchStrike, 0, ss(0, 0.15, s)) + pitchOff * ss(heelOff, 1, s)};
  }
  const s = (ph - beta) / (1 - beta);
  const zz = -stride / 2 + stride * (s * s * (3 - 2 * s));
  const h = lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 1.2);
  return {z: zz, lift: Math.max(0, h), pitch: lerp(pitchOff, pitchStrike, ss(0.15, 0.85, s)) + drag * Math.sin(Math.PI * s)};
}
/**
 * Pelvis drop (m, positive) that lets the flat front foot reach `ahead` m in front of the hip joint with the leg at `reach`
 * of its length: the stride comes from the contract, the crouch from this body's own legs.
 */
function pelvisDrop(rig, ahead, reach) {
  const b = rig.bind, L = rig.thighLen + rig.shinLen, h = b.L_Thigh[1] - b.L_Foot[1], lat = Math.abs(b.L_Foot[0] - b.L_Thigh[0]);
  return h - Math.sqrt(Math.max(0.01, (reach * L) ** 2 - ahead * ahead - lat * lat));
}

function walk(rig, t, T, S) {
  const w = TAU * t / T, stride = S.groundSpeed * S.beta * T, lead = 0.07;
  // a low, deliberate stalk: the foot is carried forward and set down nearly flat, the heel peels off late
  const G = {beta: S.beta, stride, lift: 0.1, pitchOff: 16, pitchStrike: -4, drag: 8, heelOff: 0.7};
  const fl = footCycle(t / T, G), fr = footCycle(t / T + 0.5, G);
  const drop = Math.max(0.05, pelvisDrop(rig, stride / 2 - lead, 0.972));
  const sway = Math.sin(w - 0.3), dip = Math.pow(Math.max(0, Math.cos(2 * w - 0.5)), 2);
  const P = {
    hips: [0.035 * sway, -drop - 0.012 * dip, lead],
    hipsRot: [8, 7 * Math.cos(w), 3.5 * sway],
    spine: [4, -3 * Math.cos(w), -2.5 * sway],
    chest: [5 + 1.2 * dip, -6 * Math.cos(w), -1.5 * sway],
    // the stump keeps "pointing" ahead while the shoulders turn, with a slow searching tilt
    neck: [-8, 5 * Math.cos(w) + 4 * Math.sin(w + 0.8), 4 * Math.sin(w + 1.4)],
    head: [0, 0, 0],
    // the long arms dangle: a small pendulum swing that lags the stride, wrists limp
    armL: arm(3 - 13 * Math.cos(w - 0.7), 1.5, 5 + 7 * Math.max(0, -Math.cos(w - 0.7)), {wrist: -6 + 9 * Math.cos(w - 1.4)}),
    armR: arm(3 + 13 * Math.cos(w - 0.7), 1.5, 5 + 7 * Math.max(0, Math.cos(w - 0.7)), {wrist: -6 - 9 * Math.cos(w - 1.4)}),
    legL: {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 4},
    legR: {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -5},
  };
  return realize(rig, resolveArms(rig, P));
}

function run(rig, t, T, S) {
  const w = TAU * t / T, stride = S.groundSpeed * S.beta * T, lead = 0.15;
  // a lope: short hard contacts under the body, long flight, the trailing leg folding high behind
  const G = {beta: S.beta, stride, lift: 0.26, pitchOff: 34, pitchStrike: -3, drag: 16, heelOff: 0.5};
  const fl = footCycle(t / T, G), fr = footCycle(t / T + 0.5, G);
  const drop = Math.max(0.07, pelvisDrop(rig, stride / 2 - lead, 0.965));
  const sway = Math.sin(w - 0.3), bound = Math.cos(2 * w - 1.0); // highest in the flight phases
  const P = {
    hips: [0.03 * sway, -drop + 0.03 * bound, lead],
    hipsRot: [17 + 2 * bound, 11 * Math.cos(w), 4 * sway],
    spine: [8, -5 * Math.cos(w), -3 * sway],
    chest: [9 - 2 * bound, -9 * Math.cos(w), -2 * sway],
    neck: [-18 + 3 * bound, 6 * Math.cos(w), 3 * Math.sin(w + 1)],
    head: [0, 0, 0],
    // long arms: one reaches forward low while the other trails behind, elbows loose, hands limp
    armL: arm(-4 - 40 * Math.cos(w - 0.5), 7 + 4 * Math.max(0, Math.cos(w - 0.5)), 14 + 30 * Math.max(0, -Math.cos(w - 0.5)), {wrist: -10 + 14 * Math.cos(w - 1.2)}),
    armR: arm(-4 + 40 * Math.cos(w - 0.5), 7 + 4 * Math.max(0, -Math.cos(w - 0.5)), 14 + 30 * Math.max(0, Math.cos(w - 0.5)), {wrist: -10 - 14 * Math.cos(w - 1.2)}),
    legL: {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 3},
    legR: {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -4},
  };
  return realize(rig, resolveArms(rig, P));
}

// ---------------------------------------------------------------- one-shots
/**
 * Attack keys. `lunge` (m) = how far the pelvis drives forward at the hit (solved per variant by the builder so the measured
 * right hand tip is ATTACK.reachM in front of the root at the hit frame). The hit pose is HELD from ATTACK.hold[0] to
 * ATTACK.hold[1] (two consecutive 30 fps frames around impactTime 0.42 s), so the sampled track shows the full reach at the
 * hit frame; the rake carries on afterwards.
 */
export function attackKeys(rig, lunge = 0.3) {
  const B = basePose(), R = bindArm(rig, 'R');
  const back = clamp(lunge, 0, 0.6);
  // coil: the weight rocks back, the chest winds to the right, the right arm is cocked out to the side and back, the elbow
  // bent and the claw hand raised beside the shoulder (a human wind-up: the upper arm never points up behind the body)
  const coil = {...B, hips: [0.0, -0.07, -0.07], hipsRot: [1, -14, 0], spine: [-2, -9, 0], chest: [-5, -18, 0], neck: [-6, 10, 0],
    armL: arm(14, 8, 18, {wrist: -8}),
    armR: {dir: [-0.78, -0.25, -0.57], roll: -60, flex: 82, wrist: -25, twist: 0, wristSide: 0},
    legL: {mode: 'ik', z: 0.05, x: 0, lift: 0.015, pitch: 3, yaw: 4}, legR: {mode: 'ik', z: -0.1, x: 0, lift: 0, pitch: 0, yaw: -6}};
  const coiled = {...coil, hips: [0.0, -0.085, -0.09], chest: [-6, -22, 0], armR: {...coil.armR, dir: [-0.74, -0.18, -0.65], flex: 88}};
  // the hit: a lunge onto the left foot, low and forward; the chest swings round and the right arm whips out straight in
  // front at chest height (aimed at the target height, slightly across the centre line)
  const hitBody = {...B, hips: [0.0, -0.1 - 0.12 * back, lunge], hipsRot: [15 + 10 * back, 11, 0], spine: [6 + 6 * back, 7, 0], chest: [6 + 6 * back, 13, 0], neck: [-22 - 10 * back, -6, 0],
    legL: {mode: 'ik', z: lunge + 0.26, x: 0, lift: 0, pitch: -4, yaw: 4}, legR: {mode: 'ik', z: -0.12, x: 0, lift: 0, pitch: 16 + 22 * back, yaw: -6}};
  const hit = {...hitBody,
    armL: arm(-28, 16, 22, {wrist: -14}),
    armR: {dir: aimArmAt(rig, hitBody, 'R', ATTACK.tipHeightM, ATTACK.tipX), roll: -30, flex: -0.9 * R.elbowDeg, wrist: -10, twist: 0, wristSide: 0}};
  // held one frame: the rake has just started to drag down (the reach stays)
  const hit2 = {...hit, hips: V.add(hit.hips, [0, -0.008, 0.006]), chest: V.add(hit.chest, [1, 2, 0]),
    armR: {...hit.armR, dir: aimArmAt(rig, hitBody, 'R', ATTACK.tipHeightM - 0.04, ATTACK.tipX + 0.03), wrist: -2}};
  // the rake: the claw hand drags down and across to the left, the body folds over it
  const rake = {...hitBody, hips: [0.0, hitBody.hips[1] - 0.03, lunge * 0.96], hipsRot: V.add(hitBody.hipsRot, [4, 5, 0]), chest: V.add(hitBody.chest, [5, 7, 0]),
    armL: arm(-34, 18, 28, {wrist: -16}),
    armR: {dir: aimArmAt(rig, hitBody, 'R', 0.82, 0.16), roll: -30, flex: 12, wrist: 24, twist: 0, wristSide: 0}};
  // recovery: rise, drag the front foot back under the body
  const recover = {...B, hips: [0.0, -0.07, lunge * 0.4], hipsRot: [9, 4, 0], chest: [6, 4, 0],
    armL: arm(-8, 6, 12), armR: arm(16, 4, 26, {wrist: 10}),
    legL: {mode: 'ik', z: lunge * 0.45 + 0.06, x: 0, lift: 0.03, pitch: 0, yaw: 4}, legR: {mode: 'ik', z: -0.07, x: 0, lift: 0.015, pitch: 5, yaw: -5}};
  // the swing: half way from the coil to the hit the arm is flung out to the side, still bent (a round-house rake, not a poke)
  const swing = {...mixParams(resolveArms(rig, coiled), resolveArms(rig, hit), 0.45), armR: {dir: [-0.9, 0.06, 0.42], roll: -40, flex: 42, wrist: -28, twist: 0, wristSide: 0}};
  return [
    {t: 0, p: B}, {t: 0.17, p: coil, ease: 'out'}, {t: 0.27, p: coiled, ease: 'inOut'}, {t: 0.345, p: swing, ease: 'in'}, {t: ATTACK.hold[0], p: hit, ease: 'linear'}, {t: ATTACK.hold[1], p: hit2, ease: 'linear'},
    {t: 0.58, p: rake, ease: 'out'}, {t: 0.8, p: recover, ease: 'inOut'}, {t: CLIP_SPECS.Attack.duration, p: B, ease: 'inOut'},
  ];
}

function hitKeys() {
  const B = basePose();
  // the body jerks back and round from the blow, the stump whips, the arms fly out; a small forward rebound
  const flinch = {...B, hips: [0.012, -0.06, -0.06], hipsRot: [-3, 7, 3], spine: [-7, 6, 3], chest: [-11, 10, 5], neck: [-16, 12, 8],
    armL: arm(-16, 16, 30, {wrist: -22}), armR: arm(-10, 20, 36, {wrist: -26}),
    legL: {...B.legL, z: 0.04}, legR: {...B.legR, z: -0.08}};
  const rebound = {...B, hips: [0, -0.04, 0.012], hipsRot: [6, -2, -1], chest: [6, -3, 0], neck: [4, -4, -2], armL: arm(8, 3, 10), armR: arm(9, 3, 12)};
  return [{t: 0, p: B}, {t: 0.08, p: flinch, ease: 'snap'}, {t: 0.24, p: rebound, ease: 'inOut'}, {t: CLIP_SPECS.Hit.duration, p: B, ease: 'inOut'}];
}

/**
 * Final death pose (supine): lying on the back with the stump toward -Z, the long arms splayed on the floor, the left leg
 * nearly straight, the right knee raised; the heels stay on the floor near where the body stood. `tune` comes from the
 * floor-contact solve (solveScreacherDeath).
 */
export function deathFinal(rig, hipsY, tune = {}) {
  const L = rig.thighLen + rig.shinLen;
  const T = {...DEATH_START, ...tune};
  const P = {
    hips: [0.03, hipsY, -0.52 * L], hipsRot: [T.hipsPitch, -6, T.hipsRoll], spine: [T.spine, -3, 2], chest: [T.chest, -4, 3], neck: [T.neck, -8, 4], head: [0, 0, 0],
    // (the arms are bound hanging: they come to rest beside the body, flopped outward, not flung overhead - an overhead arm
    // would stretch the armpit of every sleeve for as long as the corpse lies there)
    armL: {dir: [0.5, -0.84, T.armLz], roll: 20, flex: -0.5 * bindArm(rig, 'L').elbowDeg, wrist: 10, twist: 0, wristSide: 0},
    armR: {dir: [-0.66, -0.72, T.armRz], roll: 35, flex: -0.2 * bindArm(rig, 'R').elbowDeg, wrist: 14, twist: 0, wristSide: 0},
    legL: {mode: 'ik', z: T.footLz * L, x: 0.06, lift: 0.012, pitch: -78, yaw: 18}, legR: {mode: 'ik', z: T.footRz * L, x: 0.05, lift: 0.006, pitch: -40, yaw: -22},
  };
  // the left leg lies nearly straight, never past 0.985 of its length (a clamped IK would leave the foot off its target)
  const hipsPose = {hips: P.hips, rot: {Hips: euler(...P.hipsRot)}};
  if (rig.legIK({...hipsPose, rot: {...hipsPose.rot}}, 'L', P.legL).reach > 0.985) {
    let lo = 0, hi = P.legL.z;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (rig.legIK({...hipsPose, rot: {...hipsPose.rot}}, 'L', {...P.legL, z: mid}).reach > 0.985) hi = mid; else lo = mid; }
    P.legL = {...P.legL, z: lo};
  }
  return P;
}
/** The realized final death pose (for the floor-contact solve / reports). */
export const deathFinalPose = (rig, hipsY, tune) => realize(rig, resolveArms(rig, deathFinal(rig, hipsY, tune)));
export const DEATH_PARAMS = {hipsPitch: [-100, -76], hipsRoll: [-12, 12], spine: [-16, 10], chest: [-18, 12], neck: [-20, 10], armLz: [-0.6, 0.3], armRz: [-0.6, 0.3], footLz: [0.25, 0.7], footRz: [-0.1, 0.4]};
export const DEATH_START = {hipsPitch: -88, hipsRoll: 5, spine: 2, chest: 2, neck: -6, armLz: -0.1, armRz: -0.1, footLz: 0.52, footRz: 0.16};

function deathKeys(rig, final) {
  const B = basePose(), L = rig.thighLen + rig.shinLen;
  // the body jolts, staggers back a step on its long legs, the knees buckle, it folds and topples backward as a unit, lands
  // on its back, the arms slap down, it settles
  const jolt = {...B, hips: [0, -0.05, -0.05], hipsRot: [-3, -6, 4], spine: [-6, -4, 0], chest: [-10, -6, 4], neck: [-14, 6, 6],
    armL: arm(-10, 18, 26, {wrist: -20}), armR: arm(-6, 22, 32, {wrist: -22}), legL: {...B.legL, z: 0.03}, legR: {...B.legR, z: -0.07}};
  const stagger = {...B, hips: [0.02, -0.1, -0.16], hipsRot: [-5, -10, 6], spine: [-5, -4, 2], chest: [-7, -6, 6], neck: [-10, 4, 8],
    armL: arm(10, 34, 30, {wrist: -20}), armR: arm(16, 40, 38, {wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.02, lift: 0, pitch: -6, yaw: 8}, legR: {mode: 'ik', z: -0.3 * L, x: 0.04, lift: 0, pitch: 12, yaw: -10}};
  const buckle = {...B, hips: [0.03, -0.42 * L, -0.24 * L], hipsRot: [-12, -8, 8], spine: [5, -4, 4], chest: [8, -4, 6], neck: [6, 0, 8],
    armL: arm(24, 38, 30, {wrist: -20}), armR: arm(28, 40, 40, {wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.03, lift: 0, pitch: -14, yaw: 12}, legR: {mode: 'ik', z: -0.28 * L, x: 0.05, lift: 0, pitch: 4, yaw: -12}};
  const topple = {...B, hips: [0.04, -0.6 * L, -0.42 * L], hipsRot: [-55, -6, 6], spine: [6, -4, 2], chest: [8, -2, 4], neck: [10, 0, 6],
    armL: arm(58, 34, 34, {wrist: -20}), armR: arm(50, 42, 40, {wrist: -20}),
    legL: {mode: 'ik', z: 0.0, x: 0.04, lift: 0, pitch: -20, yaw: 14}, legR: {mode: 'ik', z: -0.2 * L, x: 0.06, lift: 0, pitch: -12, yaw: -14}};
  const thud = {...final, hips: V.add(final.hips, [0, -0.004, 0.02]), chest: V.add(final.chest, [-4, 0, 0]), neck: V.add(final.neck, [6, 0, 0]),
    armL: {...final.armL, dir: V.add(final.armL.dir, [0.1, 0, 0.3]), flex: 18}, armR: {...final.armR, dir: V.add(final.armR.dir, [-0.1, 0, 0.3]), flex: 22}};
  return [
    {t: 0, p: B}, {t: 0.12, p: jolt, ease: 'snap'}, {t: 0.4, p: stagger, ease: 'out'}, {t: 0.72, p: buckle, ease: 'in'},
    {t: 1.0, p: topple, ease: 'inOut'}, {t: 1.26, p: thud, ease: 'in'}, {t: 1.46, p: {...final, hips: V.add(final.hips, [0, 0.012, 0])}, ease: 'out'},
    {t: CLIP_SPECS.Death.duration, p: final, ease: 'inOut'},
  ];
}

/** How high the pelvis can rise (hips y) with the pelvis pushed forward before the planted legs pass 0.992 of their length. */
const RISE = new WeakMap();
function screamRise(rig, B) {
  if (RISE.has(rig)) return RISE.get(rig);
  let lo = -0.09, hi = 0.05;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (realize(rig, resolveArms(rig, {...B, hips: [0, mid, 0.05], hipsRot: [-3, 0, 0]})).reach > 0.992) hi = mid; else lo = mid; }
  RISE.set(rig, lo);
  return lo;
}

/** Scream: feet planted (the Idle foot targets in every key); the shudder is added on top of the keys around the cue. */
function scream(rig, t) {
  const B = basePose(), S = CLIP_SPECS.Scream, bL = bindArm(rig, 'L'), bR = bindArm(rig, 'R'), rise = screamRise(rig, B);
  // gather: a short crouch, the chest caves, the arms draw in and forward
  const gather = {...B, hips: [0, -0.085, -0.02], hipsRot: [8, 0, 0], spine: [10, 0, 0], chest: [12, 0, 0], neck: [10, 0, 0],
    armL: arm(16, 4, 34, {wrist: 18}), armR: arm(16, 4, 36, {wrist: 18})};
  // the scream: the legs straighten as far as they go with the feet planted (`rise`), the pelvis tips, the back arches, the chest is thrust up and the stump thrown back; the arms
  // are flung down and back, straight, away from the body, wrists bent back and turned out (the hands "spread")
  const arch = {...B, hips: [0, rise, 0.05], hipsRot: [-3, 0, 0], spine: [-9, 0, 0], chest: [-15, 0, 0], neck: [-30, 0, 0],
    armL: arm(-46, 26, -0.8 * bL.elbowDeg, {wrist: -32, twist: 30, wristSide: 14}), armR: arm(-46, 26, -0.8 * bR.elbowDeg, {wrist: -32, twist: -30, wristSide: -14})};
  const hold = {...arch, hips: [0, rise - 0.006, 0.045], spine: [-8, 0, 0], chest: [-14, 0, 0], neck: [-27, 0, 0],
    armL: arm(-42, 29, -0.7 * bL.elbowDeg, {wrist: -28, twist: 26, wristSide: 14}), armR: arm(-42, 29, -0.7 * bR.elbowDeg, {wrist: -28, twist: -26, wristSide: -14})};
  // spent: it sags forward a little past the Idle pose before settling
  const sag = {...B, hips: [0, -0.05, 0.0], hipsRot: [6, 0, 0], spine: [6, 0, 0], chest: [7, 0, 0], neck: [6, 0, 0], armL: arm(8, 3, 12, {wrist: 6}), armR: arm(8, 3, 13, {wrist: 6})};
  const keys = [{t: 0, p: B}, {t: 0.2, p: gather, ease: 'inOut'}, {t: S.cueTime, p: arch, ease: 'snap'}, {t: 0.9, p: hold, ease: 'inOut'}, {t: 1.25, p: sag, ease: 'inOut'}, {t: S.duration, p: B, ease: 'inOut'}];
  const P = mixAt(rig, keys, t);
  // shudder: a fast tremor through the torso and the arms while it screams (7.5 Hz: 4 frames per cycle at 30 fps)
  const env = ss(S.cueTime - 0.08, S.cueTime + 0.06, t) * (1 - ss(0.95, 1.2, t)), q = TAU * 7.5 * t;
  if (env > 0) {
    P.chest = V.add(P.chest, [1.6 * env * Math.sin(q), 2.2 * env * Math.sin(q + 1.3), 1.4 * env * Math.sin(q + 2.1)]);
    P.spine = V.add(P.spine, [-0.9 * env * Math.sin(q + 0.6), 0, 0.9 * env * Math.sin(q + 2.4)]);
    P.neck = V.add(P.neck, [3.5 * env * Math.sin(q + 0.9), 4 * env * Math.sin(q + 2.2), 3 * env * Math.sin(q + 0.2)]);
    for (const [k, ph] of [['armL', 0.4], ['armR', 2.9]]) P[k] = {...P[k], flex: P[k].flex + 3 * env * Math.sin(q + ph), wrist: P[k].wrist + 7 * env * Math.sin(q + ph + 1), twist: P[k].twist + 8 * env * Math.sin(q + ph + 2)};
  }
  return realize(rig, P);
}

// ---------------------------------------------------------------- floor-contact solve of the death pose (no head term)
const GROUPS = {torso: ['Chest', 'Spine', 'Neck', 'Head'], pelvis: ['Hips'], armL: ['L_UpperArm', 'L_Forearm', 'L_Hand'], armR: ['R_UpperArm', 'R_Forearm', 'R_Hand'], legL: ['L_Thigh', 'L_Shin', 'L_Foot'], legR: ['R_Thigh', 'R_Shin', 'R_Foot']};
const groupOf = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, js]) => js.map(j => [j, g])));
/** Lowest skinned point per body region (dominant joint); the stump (Neck / Head) counts as torso: there is no head region. */
export function floorReport(rig, skel, mesh, pose) {
  const P = skinPositions(mesh, skel, rig.fk(pose)), out = {};
  for (let i = 0; i < P.length / 3; i++) { const g = groupOf[JOINT_NAMES[mesh.joints[i * 4]]]; if (!g) continue; out[g] = Math.min(out[g] ?? Infinity, P[i * 3 + 1]); }
  for (const k in out) out[k] = +out[k].toFixed(3);
  return out;
}
/**
 * The zombie/lib/clipsolve.mjs solveDeathPose search (same cost, same coordinate descent) on the Screacher's own final pose
 * and regions: torso (incl. the stump), pelvis, both arms, both legs. zombie/lib/clipsolve.mjs regionFloorReport cannot be
 * used: its cost needs head-dominant vertices and a Screacher has none (NaN).
 */
export function solveScreacherDeath(rig, skel, mesh) {
  const regions = Object.keys(GROUPS);
  let evals = 0;
  const evaluate = tune => {
    evals++;
    let hipsY = -(rig.bind.Hips[1] - 0.14), rep;
    for (let it = 0; it < 4; it++) {
      rep = floorReport(rig, skel, mesh, deathFinalPose(rig, hipsY, tune));
      const min = Math.min(...Object.entries(rep).filter(([k]) => !/^leg/.test(k)).map(([, v]) => v));
      hipsY += 0.01 - min;
    }
    rep = floorReport(rig, skel, mesh, deathFinalPose(rig, hipsY, tune));
    let cost = 0;
    for (const r of regions) cost += Math.pow(Math.max(0, rep[r] - 0.015), 2) + 4 * Math.pow(Math.min(0, rep[r] - 0.015), 2);
    return {cost, hipsY, rep};
  };
  // coordinate descent from three pelvis pitches (one start can stall with the pelvis hovering); the cheapest result wins
  let tune = null, best = null;
  for (const pitch of [-88, -84, -93]) {
    let t = {...DEATH_START, hipsPitch: pitch}, b = evaluate(t), step = 0.25;
    for (let round = 0; round < 7; round++) {
      for (const [k, [lo, hi]] of Object.entries(DEATH_PARAMS)) for (const dir of [1, -1]) {
        const cand = {...t, [k]: clamp(t[k] + dir * step * (hi - lo), lo, hi)};
        const r = evaluate(cand);
        if (r.cost < b.cost - 1e-7) { b = r; t = cand; }
      }
      step /= 2;
    }
    if (!best || b.cost < best.cost - 1e-9) { best = b; tune = t; }
  }
  return {tune: Object.fromEntries(Object.entries(tune).map(([k, v]) => [k, +v.toFixed(3)])), hipsY: best.hipsY, cost: best.cost, evals, report: best.rep, ranges: DEATH_PARAMS};
}

// ---------------------------------------------------------------- evaluation / sampling
/** ctx: {attackLunge, deathHipsY, deathTune}. */
export function evalClip(rig, name, t, ctx = {}) {
  const S = CLIP_SPECS[name], T = S.duration;
  switch (name) {
    case 'Idle': return idle(rig, t, T);
    case 'Walk': return walk(rig, t, T, S);
    case 'Run': return run(rig, t, T, S);
    case 'Attack': return keyed(rig, attackKeys(rig, ctx.attackLunge ?? 0.3), t);
    case 'Hit': return keyed(rig, hitKeys(), t);
    case 'Death': return keyed(rig, deathKeys(rig, deathFinal(rig, ctx.deathHipsY ?? -(rig.bind.Hips[1] - 0.14), ctx.deathTune || {})), t);
    case 'Scream': return scream(rig, t);
  }
  throw new Error('unknown clip ' + name);
}

/** Sample a clip into tracks at FPS (+ the end time); loops get an exact copy of frame 0 at t = T (lib/strainer-clips.mjs). */
export function sampleClip(rig, name, ctx = {}) {
  const S = CLIP_SPECS[name];
  const frames = Math.round(S.duration * FPS);
  const times = [], rot = {}, hips = [];
  const jn = rig.names.filter(n => n !== 'Root');
  for (const n of jn) rot[n] = [];
  let maxReach = 0;
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(S.duration, f / FPS);
    const pose = evalClip(rig, name, S.loop && f === frames ? 0 : t, ctx);
    maxReach = Math.max(maxReach, pose.reach || 0);
    times.push(+t.toFixed(5));
    hips.push(pose.hips || [0, 0, 0]);
    for (const n of jn) {
      let q = pose.rot[n] || [0, 0, 0, 1];
      const prev = rot[n][rot[n].length - 1];
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map(v => -v);
      rot[n].push(q.map(v => +v.toFixed(6)));
    }
  }
  return {name, duration: S.duration, loop: S.loop, times, rot, hips, maxLegReach: +maxReach.toFixed(4)};
}

/** Pose of sampled frame f (for CPU skinning / audits). */
export const poseAt = (clip, f) => ({hips: clip.hips[f], rot: Object.fromEntries(Object.entries(clip.rot).map(([k, v]) => [k, v[f]]))});
/** Pose of a sampled clip at time t, interpolated like the runtime (LINEAR tracks: slerp rotations, lerp the Hips offset). */
export function poseAtTime(clip, t) {
  let f = 0;
  while (f < clip.times.length - 2 && clip.times[f + 1] <= t) f++;
  const u = clamp((t - clip.times[f]) / (clip.times[f + 1] - clip.times[f]), 0, 1);
  return {hips: lerpV(clip.hips[f], clip.hips[f + 1], u), rot: Object.fromEntries(Object.entries(clip.rot).map(([k, v]) => [k, qSlerp(v[f], v[f + 1], u)]))};
}
