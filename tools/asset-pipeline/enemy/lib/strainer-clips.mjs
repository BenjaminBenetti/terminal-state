// Task studio-alpha-beyond-station-round4-20261101-01 (lane ASSET): procedural clips for the STRAINER (the "patient
// stalker") on the SHARED 18-joint skeleton. Hand-authored keyframes / periodic gait functions (NOT mocap), evaluated by the
// zombie pose math (zombie/lib/pose.mjs Rig: FK, 2-bone leg IK with foot roll, arm aiming) through zombie/lib/clips.mjs
// `realize`, structured like lib/blightbelly-clips.mjs (nothing in the shared libs or the other enemies' clips changes).
//
// Design: tall (2.15 m), gaunt, hunched; long arms with 0.45 m clawed hands carried hanging FORWARD of the thighs (claw tips
// below the knee); a slow, long, deliberate stride with the torso leaning in; a loping biped run (deeper lean, arms
// trailing / pumping, no all-fours); one long reaching right-claw swipe across the front at chest height on a lunge (left
// claw following); a sharp flinch; a collapse onto the back (knees buckle, the body topples, floor-solved final pose).
import {realize, deathFinal} from '../../zombie/lib/clips.mjs';
import {qSlerp, qRot, qAxis, V} from '../../zombie/lib/pose.mjs';

export const FPS = 30;
const TAU = Math.PI * 2;
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const dirN = v => V.norm(v);
const mirrorDir = d => [-d[0], d[1], d[2]];
const mirrorAxis = h => [h[0], -h[1], -h[2]];
function mirrorArm(a) { return {...a, dir: mirrorDir(a.dir), ...(a.hinge ? {hinge: mirrorAxis(a.hinge)} : {}), twist: -(a.twist || 0), wristSide: -(a.wristSide || 0)}; }

/**
 * Clip contract (GLB extras + sidecar). groundSpeed = m/s the in-place locomotion cycle was authored for at timeScale 1;
 * impactTime = seconds into Attack when the right claw tips cross the front centre line at chest height (the hit frame).
 */
export const CLIP_SPECS = {
  Idle: {duration: 4.0, loop: true},
  Walk: {duration: 1.8, loop: true, groundSpeed: 0.62, beta: 0.64},
  Run: {duration: 0.9, loop: true, groundSpeed: 2.4, beta: 0.38},
  Attack: {duration: 1.4, loop: false, impactTime: 0.6},
  Hit: {duration: 0.45, loop: false},
  Death: {duration: 2.1, loop: false},
};

// Arms hanging forward of the thighs and slightly out (the claws spread ~0.3 m): upper arm direction in the Chest frame.
const ARM_HANG = {dir: [0.3, -0.9, 0.3], flex: 18, wrist: -8, twist: 0};

export function basePose() {
  return {
    hips: [0, -0.06, 0], hipsRot: [9, 0, 0],
    spine: [4, 0, 0], chest: [5, 0, 0], neck: [-8, 0, 0], head: [-6, 0, 0],
    armL: {...ARM_HANG}, armR: mirrorArm({...ARM_HANG, dir: [0.29, -0.9, 0.32], flex: 20}),
    legL: {mode: 'ik', z: 0.03, x: 0.0, lift: 0, pitch: 0, yaw: 4}, legR: {mode: 'ik', z: -0.05, x: 0.0, lift: 0, pitch: 0, yaw: -5},
  };
}

// ---------------------------------------------------------------- natural elbow hinge (lib/blightbelly-clips.mjs scheme)
// An arm without `hinge` keeps its bind elbow plane: hinge = the bind hinge (bone x +Z, pose.mjs armAim) carried by the minimal
// swing bind direction -> target direction, then rolled by `roll` deg about the target direction.
function minimalRot(a, b) {
  const c = V.cross(a, b), d = V.dot(a, b);
  if (V.len(c) < 1e-9) return d > 0 ? [0, 0, 0, 1] : qAxis(Math.abs(a[0]) < 0.9 ? V.cross(a, [1, 0, 0]) : V.cross(a, [0, 1, 0]), 180);
  return qAxis(c, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
}
function resolveArm(rig, side, a) {
  if (a.hinge) return a;
  const b = rig.bind, d0 = V.norm(V.sub(b[side + '_Forearm'], b[side + '_UpperArm'])), h0 = V.norm(V.cross(d0, [0, 0, 1]));
  const d = V.norm(a.dir);
  let h = qRot(minimalRot(d0, d), h0);
  if (a.roll) h = qRot(qAxis(d, (side === 'L' ? 1 : -1) * a.roll), h);
  return {...a, hinge: h};
}
const resolveArms = (rig, P) => ({...P, armL: resolveArm(rig, 'L', P.armL), armR: resolveArm(rig, 'R', P.armR)});

// ---------------------------------------------------------------- keyframe interpolation
function mixParams(A, B, t) {
  const out = {};
  for (const k of ['hips', 'hipsRot', 'spine', 'chest', 'neck', 'head']) out[k] = lerpV(A[k], B[k], t);
  for (const k of ['armL', 'armR']) {
    const a = A[k], b = B[k];
    out[k] = {dir: dirN(lerpV(dirN(a.dir), dirN(b.dir), t)), hinge: dirN(lerpV(dirN(a.hinge), dirN(b.hinge), t)),
      flex: lerp(a.flex, b.flex, t), wrist: lerp(a.wrist, b.wrist, t), twist: lerp(a.twist || 0, b.twist || 0, t), wristSide: lerp(a.wristSide || 0, b.wristSide || 0, t)};
  }
  for (const k of ['legL', 'legR']) {
    const a = A[k], b = B[k];
    if (a.mode === 'ik' && b.mode === 'ik') out[k] = {mode: 'ik', z: lerp(a.z, b.z, t), x: lerp(a.x || 0, b.x || 0, t), lift: lerp(a.lift || 0, b.lift || 0, t), pitch: lerp(a.pitch || 0, b.pitch || 0, t), yaw: lerp(a.yaw || 0, b.yaw || 0, t)};
    else out[k] = {mode: 'slerp', a, b, t};
  }
  return out;
}
function realizeMixed(rig, P, A, B) {
  const fk0 = {mode: 'fk', thigh: [0, 0, 0], shin: [0, 0, 0], foot: [0, 0, 0]};
  const pose = realize(rig, {...P, legL: P.legL.mode === 'slerp' ? fk0 : P.legL, legR: P.legR.mode === 'slerp' ? fk0 : P.legR});
  for (const s of ['L', 'R']) {
    const l = P['leg' + s];
    if (l.mode !== 'slerp') continue;
    const pa = realize(rig, A), pb = realize(rig, B);
    for (const j of ['_Thigh', '_Shin', '_Foot']) pose.rot[s + j] = qSlerp(pa.rot[s + j], pb.rot[s + j], l.t);
  }
  return pose;
}
const EASE = {inOut: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), linear: t => t, snap: t => 1 - Math.pow(1 - t, 3)};
function keyed(rig, keys0, t) {
  const keys = keys0.map(k => ({...k, p: resolveArms(rig, k.p)}));
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const A = keys[i], B = keys[i + 1];
  const u = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
  return realizeMixed(rig, mixParams(A.p, B.p, (EASE[B.ease || 'inOut'])(u)), A.p, B.p);
}

// ---------------------------------------------------------------- loops
function idle(rig, t, T) {
  const P = basePose();
  const w = TAU * t / T, br = TAU * 2 * t / T; // two slow breaths per loop
  P.hips = [0.012 * Math.sin(w), -0.06 + 0.006 * Math.sin(br), 0.008 * Math.sin(w + 1)];
  P.hipsRot = [9 + 0.8 * Math.sin(br), 2.5 * Math.sin(w + 0.4), -1.6 * Math.sin(w)];
  P.spine = [4 - 1.6 * Math.sin(br + 0.3), -1.5 * Math.sin(w), 1.2 * Math.sin(w)];
  P.chest = [5 - 2.4 * Math.sin(br + 0.8), -1.2 * Math.sin(w + 0.3), 1.0 * Math.sin(w)]; // the ribs heave with the breath
  // the head hangs and slowly sways / tilts, a predator listening
  P.neck = [-8 + 2 * Math.sin(w + 2.0), 4 * Math.sin(w + 0.5), 0];
  P.head = [-6 + 2.5 * Math.sin(br + 1.4), 4 * Math.sin(w + 1.1), 3 * Math.sin(w + 0.2)];
  // claws twitch: small fast wrist / finger-plane jerks (integer harmonics: seamless loop)
  const tw = k => Math.pow(Math.max(0, Math.sin(k)), 6);
  P.armL = {...P.armL, dir: [0.3 + 0.02 * Math.sin(w + 1), -0.9, 0.3 + 0.04 * Math.sin(w + 0.5)], flex: 18 + 3 * Math.sin(br) + 8 * tw(5 * w + 0.3), wrist: -8 - 14 * tw(7 * w + 1.1) + 6 * tw(3 * w + 2), wristSide: 6 * tw(9 * w + 0.4)};
  P.armR = {...P.armR, dir: [-0.29 - 0.02 * Math.sin(w + 2), -0.9, 0.32 + 0.04 * Math.sin(w + 2.2)], flex: 20 + 3 * Math.sin(br + 1.5) + 8 * tw(4 * w + 1.7), wrist: -8 - 14 * tw(6 * w + 2.5) + 6 * tw(5 * w + 0.6), wristSide: -6 * tw(8 * w + 1.9)};
  return realize(rig, resolveArms(rig, P));
}

/** Treadmill gait: stance foot slides back at ground speed v; swing returns it forward (zombie/lib/clips.mjs footCycle). */
function footCycle(phase, {beta, stride, lift, pitchOff = 18, pitchStrike = -6, drag = 0}) {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < beta) {
    const s = ph / beta;
    return {z: stride / 2 - stride * s, lift: 0, pitch: lerp(pitchStrike, 0, ss(0, 0.15, s)) + pitchOff * ss(0.75, 1, s)};
  }
  const s = (ph - beta) / (1 - beta);
  const zz = -stride / 2 + stride * (s * s * (3 - 2 * s));
  const h = lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 1.2);
  return {z: zz, lift: Math.max(0, h), pitch: lerp(pitchOff, pitchStrike, ss(0.15, 0.85, s)) + drag * Math.sin(Math.PI * s)};
}

function walk(rig, t, T, G) {
  const P = basePose();
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta: G.beta, stride: G.stride, lift: 0.11, pitchOff: 20, pitchStrike: -8});
  const fr = footCycle(t / T + 0.5, {beta: G.beta, stride: G.stride, lift: 0.11, pitchOff: 20, pitchStrike: -8});
  // deliberate: the pelvis rises over each planted foot and sinks at heel strike (twice per cycle), small sway
  const bob = -0.018 * Math.cos(2 * w);
  P.hips = [0.025 * Math.sin(w - 0.3), -0.075 + bob, 0];
  P.hipsRot = [11, 7 * Math.sin(w), 3 * Math.sin(w - 0.3)];
  P.spine = [4, -3 * Math.sin(w), -2 * Math.sin(w - 0.3)];
  P.chest = [5 + 1.5 * Math.cos(2 * w), -4 * Math.sin(w), -1.5 * Math.sin(w - 0.3)];
  // the head stays level and fixed on the prey (counters the torso yaw / bob)
  P.neck = [-9 - 1.5 * Math.cos(2 * w), 4 * Math.sin(w), 0];
  P.head = [-7, 3 * Math.sin(w), 0];
  // arms hang forward and swing loosely opposite the legs, claws trailing
  P.armL = {...ARM_HANG, dir: [0.3, -0.9, 0.3 - 0.16 * Math.sin(w)], flex: 18 + 8 * Math.max(0, -Math.sin(w)), wrist: -8 + 6 * Math.sin(w - 0.6)};
  P.armR = mirrorArm({...ARM_HANG, dir: [0.29, -0.9, 0.32 + 0.16 * Math.sin(w)], flex: 20 + 8 * Math.max(0, Math.sin(w)), wrist: -8 - 6 * Math.sin(w - 0.6)});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 4};
  P.legR = {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -5};
  return realize(rig, resolveArms(rig, P));
}

function run(rig, t, T, G) {
  const P = basePose();
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta: G.beta, stride: G.stride, lift: 0.2, pitchOff: 26, pitchStrike: -6});
  const fr = footCycle(t / T + 0.5, {beta: G.beta, stride: G.stride, lift: 0.2, pitchOff: 26, pitchStrike: -6});
  const bob = 0.035 * Math.cos(2 * w + 0.4);
  P.hips = [0.03 * Math.sin(w - 0.4), -0.12 + bob, 0.04];
  P.hipsRot = [20, 9 * Math.sin(w), 4 * Math.sin(w - 0.4)];
  P.spine = [6, -5 * Math.sin(w), -3 * Math.sin(w - 0.4)];
  P.chest = [6 + 3 * Math.cos(2 * w), -7 * Math.sin(w), -2 * Math.sin(w)];
  P.neck = [-11, 4 * Math.sin(w), 0];
  P.head = [-9 + 2 * Math.cos(2 * w), -3 * Math.sin(w), 2 * Math.sin(w + 1)];
  // loping arm pump, opposite the legs: claws swing forward low, trail back high
  P.armL = {...ARM_HANG, dir: [0.32, -0.78 + 0.12 * Math.sin(w + 0.3), 0.2 - 0.55 * Math.sin(w)], flex: 30 + 20 * Math.max(0, -Math.sin(w)), wrist: -14 + 10 * Math.sin(w - 0.8)};
  P.armR = mirrorArm({...ARM_HANG, dir: [0.32, -0.78 + 0.12 * Math.sin(w + 0.3 + Math.PI), 0.2 + 0.55 * Math.sin(w)], flex: 30 + 20 * Math.max(0, Math.sin(w)), wrist: -14 - 10 * Math.sin(w - 0.8)});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 3};
  P.legR = {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -4};
  return realize(rig, resolveArms(rig, P));
}

// ---------------------------------------------------------------- one-shots
export function attackKeys() {
  const B = basePose();
  // wind-up: the right claw drawn up and back out to the side, torso coiled to the right, weight on the back foot
  const windup = {...B, hips: [0, -0.07, -0.06], hipsRot: [4, -10, 0], spine: [0, -8, 0], chest: [-2, -14, 0], neck: [-8, 5, 0], head: [-6, 5, 0],
    armL: {...ARM_HANG, dir: [0.45, -0.8, 0.4], flex: 30, wrist: -10},
    armR: mirrorArm({dir: [0.82, 0.3, -0.48], flex: 45, wrist: -18, twist: 0, wristSide: 0}),
    legL: {mode: 'ik', z: 0.06, x: 0, lift: 0.02, pitch: 4, yaw: 4}, legR: {mode: 'ik', z: -0.12, x: 0, lift: 0, pitch: 0, yaw: -6}};
  // hit: lunge onto the left foot, torso uncoils; the extended right arm sweeps through the front at chest height
  const hit = {...B, hips: [0, -0.1, 0.18], hipsRot: [10, 8, 0], spine: [6, 6, 0], chest: [2, 10, 0], neck: [-12, -5, 0], head: [-9, -4, 0],
    armL: {...ARM_HANG, dir: [0.4, -0.75, 0.52], flex: 26, wrist: -10},
    // (the torso is uncoiled ~24 deg to the left here: this Chest-frame direction points the arm straight ahead)
    // (wristSide lifts the hanging claws in line with the forearm: the tips sweep at ~1.35 m)
    armR: mirrorArm({dir: [0.45, -0.05, 0.9], flex: 6, wrist: 2, twist: 0, wristSide: -25}),
    legL: {mode: 'ik', z: 0.42, x: 0, lift: 0, pitch: -4, yaw: 4}, legR: {mode: 'ik', z: -0.16, x: 0, lift: 0, pitch: 16, yaw: -6}};
  // follow-through: the claw carries on across and down to the left, well in front of the body (elbow bending), the left
  // claw following low and out
  const follow = {...hit, hips: [0, -0.12, 0.18], hipsRot: [12, 14, 0], chest: [4, 14, 0], neck: [-12, -5, 0], head: [-9, -5, 0],
    armL: {...ARM_HANG, dir: [0.55, -0.7, 0.45], flex: 30, wrist: -12},
    armR: mirrorArm({dir: [-0.08, -0.4, 0.91], flex: 22, wrist: -6, twist: 0, wristSide: 0})};
  const recover = {...B, hips: [0, -0.1, 0.1], hipsRot: [12, 4, 0], legL: {mode: 'ik', z: 0.2, x: 0, lift: 0.02, pitch: 0, yaw: 4}};
  return [
    {t: 0, p: B}, {t: 0.4, p: windup, ease: 'inOut'}, {t: CLIP_SPECS.Attack.impactTime, p: hit, ease: 'in'}, {t: 0.78, p: follow, ease: 'out'},
    {t: 1.08, p: recover, ease: 'inOut'}, {t: CLIP_SPECS.Attack.duration, p: B, ease: 'inOut'},
  ];
}

function hitKeys() {
  const B = basePose();
  const flinch = {...B, hips: [0.01, -0.07, -0.06], hipsRot: [2, 6, 3], spine: [-6, 5, 3], chest: [-10, 8, 4], neck: [-12, 4, 0], head: [-10, 5, 4],
    armL: {...ARM_HANG, dir: [0.5, -0.8, 0.1], flex: 40, wrist: -22}, armR: mirrorArm({...ARM_HANG, dir: [0.48, -0.82, 0.15], flex: 44, wrist: -24}),
    legL: {...B.legL, z: 0.04}, legR: {...B.legR, z: -0.09}};
  const rebound = {...B, hips: [0, -0.06, 0.01], hipsRot: [11, -2, -1], chest: [7, -2, 0], head: [-5, -2, 2]};
  return [{t: 0, p: B}, {t: 0.09, p: flinch, ease: 'snap'}, {t: 0.26, p: rebound, ease: 'inOut'}, {t: CLIP_SPECS.Hit.duration, p: B, ease: 'inOut'}];
}

function deathKeys(final) {
  const B = basePose();
  // jolt upright, stagger back a step, knees buckle, the long body topples back as a unit, hits the floor, settles
  const jolt = {...B, hips: [0, -0.04, -0.05], hipsRot: [0, -6, 4], spine: [-6, -4, 0], chest: [-10, -6, 4], neck: [-12, 0, 0], head: [-10, -5, 4],
    armL: {...ARM_HANG, dir: [0.6, -0.72, 0.1], flex: 34, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.55, -0.75, 0.05], flex: 38, wrist: -22}),
    legL: {...B.legL, z: 0.03}, legR: {...B.legR, z: -0.08}};
  const stagger = {...B, hips: [0.02, -0.1, -0.16], hipsRot: [-4, -10, 6], spine: [-6, -4, 2], chest: [-8, -6, 6], neck: [-10, 0, 0], head: [-8, -6, 5],
    armL: {...ARM_HANG, dir: [0.8, -0.4, -0.1], flex: 40, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.75, -0.3, -0.2], flex: 46, wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.02, lift: 0, pitch: -6, yaw: 8}, legR: {mode: 'ik', z: -0.34, x: 0.04, lift: 0, pitch: 12, yaw: -10}};
  const buckle = {...B, hips: [0.03, -0.42, -0.26], hipsRot: [-12, -8, 8], spine: [4, -4, 4], chest: [6, -4, 6], neck: [-4, 0, 0], head: [-4, -6, 6],
    armL: {...ARM_HANG, dir: [0.75, -0.6, 0.0], flex: 30, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.7, -0.6, -0.1], flex: 40, wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.03, lift: 0, pitch: -14, yaw: 12}, legR: {mode: 'ik', z: -0.32, x: 0.05, lift: 0, pitch: 4, yaw: -12}};
  const topple = {...B, hips: [0.04, -0.56, -0.46], hipsRot: [-55, -6, 6], spine: [6, -4, 2], chest: [8, -2, 4], neck: [-6, 0, 0], head: [-4, -8, 5],
    armL: {...ARM_HANG, dir: [0.85, 0.15, 0.4], flex: 35, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.82, 0.1, 0.45], flex: 40, wrist: -20}),
    legL: {mode: 'ik', z: 0.0, x: 0.04, lift: 0, pitch: -20, yaw: 14}, legR: {mode: 'ik', z: -0.24, x: 0.06, lift: 0, pitch: -12, yaw: -14}};
  const thud = {...final, hips: V.add(final.hips, [0, -0.004, 0.02]), chest: V.add(final.chest, [-4, 0, 0]), neck: V.add(final.neck, [5, 0, 0]), head: V.add(final.head, [2, -5, 0]),
    armL: {...final.armL, dir: V.add(final.armL.dir, [0, 0, 0.25])}, armR: {...final.armR, dir: V.add(final.armR.dir, [0, 0, 0.25])}};
  return [
    {t: 0, p: B}, {t: 0.14, p: jolt, ease: 'snap'}, {t: 0.44, p: stagger, ease: 'out'}, {t: 0.8, p: buckle, ease: 'in'},
    {t: 1.1, p: topple, ease: 'inOut'}, {t: 1.38, p: thud, ease: 'in'}, {t: 1.62, p: {...final, hips: V.add(final.hips, [0, 0.012, 0])}, ease: 'out'},
    {t: CLIP_SPECS.Death.duration, p: final, ease: 'inOut'},
  ];
}

/**
 * Death-pose floor-contact solve: the zombie/lib/clipsolve.mjs solveDeathPose search (same cost, same coordinate descent,
 * same zombie/lib/clips.mjs deathFinal supine pose) with Strainer parameter ranges: the head may only turn a little
 * (headYaw -16..0 deg instead of -80..-20) and nod only a little (neck -16..4, head -14..4 instead of -35..10 / -30..10): the
 * crown cage is joined to the exposed rib cage directly under the jaw, and a large head turn / pitch tears that junction.
 */
export const DEATH_PARAMS = {hipsPitch: [-95, -80], hipsRoll: [-12, 12], neck: [-16, 4], head: [-14, 4], headYaw: [-16, 0], armLz: [-0.8, 0], armRz: [-0.8, 0], footLz: [0.0, 0.5], footRz: [-0.2, 0.35]};
export const DEATH_START = {hipsPitch: -88, hipsRoll: 5, neck: -10, head: -8, headYaw: -10, armLz: -0.3, armRz: -0.3, footLz: 0.42, footRz: 0.12};
export function solveStrainerDeath(rig, skel, meshes, regionFloorReport) {
  const regions = ['torso', 'pelvis', 'head', 'armL', 'armR', 'legL', 'legR'];
  let evals = 0;
  const evaluate = tune => {
    evals++;
    let hipsY = -0.64 * skel.H / 1.78, rep;
    for (let it = 0; it < 3; it++) {
      rep = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(hipsY, tune)));
      const min = Math.min(...Object.entries(rep).filter(([k]) => !/leg[LR]$/.test(k)).map(([, v]) => v));
      hipsY += 0.01 - min;
    }
    rep = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(hipsY, tune)));
    let cost = 0;
    for (const r of regions) cost += Math.pow(Math.max(0, rep[r] - 0.015), 2) + 4 * Math.pow(Math.min(0, rep[r] - 0.015), 2);
    return {cost, hipsY, rep};
  };
  let tune = {...DEATH_START};
  let best = evaluate(tune), step = 0.25;
  for (let round = 0; round < 6; round++) {
    for (const [k, [lo, hi]] of Object.entries(DEATH_PARAMS)) for (const dir of [1, -1]) {
      const cand = {...tune, [k]: Math.min(hi, Math.max(lo, tune[k] + dir * step * (hi - lo)))};
      const r = evaluate(cand);
      if (r.cost < best.cost - 1e-7) { best = r; tune = cand; }
    }
    step /= 2;
  }
  return {tune: Object.fromEntries(Object.entries(tune).map(([k, v]) => [k, +v.toFixed(3)])), hipsY: best.hipsY, cost: best.cost, evals, report: best.rep, ranges: DEATH_PARAMS};
}

export function evalClip(rig, name, t, ctx = {}) {
  const S = CLIP_SPECS[name], T = S.duration;
  switch (name) {
    case 'Idle': return idle(rig, t, T);
    case 'Walk': return walk(rig, t, T, {beta: S.beta, stride: S.groundSpeed * S.beta * T});
    case 'Run': return run(rig, t, T, {beta: S.beta, stride: S.groundSpeed * S.beta * T});
    case 'Attack': return keyed(rig, attackKeys(), t);
    case 'Hit': return keyed(rig, hitKeys(), t);
    case 'Death': return keyed(rig, deathKeys(deathFinal(ctx.deathHipsY ?? -0.7, ctx.deathTune || {})), t);
  }
  throw new Error('unknown clip ' + name);
}

/** Sample a clip into tracks at FPS; loops get an exact copy of frame 0 at t = T. */
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

/** QA probes (tools only). */
export const _qa = {keyed, resolveArms, basePose};
