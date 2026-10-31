// Task track1-siren-blightbelly-20261031 (lane RIGB): procedural clips for the obese Blightbelly on the SHARED 18-joint
// skeleton. Hand-authored keyframes / periodic gait functions (NOT mocap), evaluated by the zombie pose math
// (zombie/lib/pose.mjs Rig: FK, 2-bone leg IK with foot roll, arm aiming) through zombie/lib/clips.mjs `realize`.
// Nothing here changes the ordinary zombie clips (zombie/lib/clips.mjs CLIP_SPECS stay as they are).
//
// Design (heavy, lumbering): the arms are carried WIDE (upper-arm direction ~25-30 deg off vertical, like the bind
// A-pose) so the forearms stay clear of the belly; a wide-stance waddle with a big lateral hip sway and torso counter-roll;
// short strides (short thick legs: thigh+shin ~0.59 m); slow wind-up overhead double-fist slam; a swell / convulsion at the
// start of the Death clip (where the pustules burst) before the knees buckle and the body topples onto its back.
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
 * Clip contract (exported in the GLB extras and the sidecar). groundSpeed = m/s the in-place locomotion cycle was authored
 * for at timeScale 1 (the runtime scales the clip to the actual speed, like ai/zombieActor.ts CLIP_GROUND_SPEED);
 * impactTime = seconds into Attack when the slam lands (ZombieStats.attackImpact); burstTime = the Death clip's swell peak.
 */
export const CLIP_SPECS = {
  Idle: {duration: 3.6, loop: true},
  Walk: {duration: 1.4, loop: true, groundSpeed: 0.4, beta: 0.62},
  Run: {duration: 0.8, loop: true, groundSpeed: 1.5, beta: 0.4},
  Attack: {duration: 1.5, loop: false, impactTime: 0.7},
  Hit: {duration: 0.5, loop: false},
  Death: {duration: 2.3, loop: false, burstTime: 0.38},
};

// Arms carried wide (bind upper arm ~23 deg off vertical, forearm angled further out): the hang keeps the elbow outside
// the belly flank (+-0.36 m at belly height). hinge = elbow axis (palm = -(dir x hinge)).
const ARM_HANG = {dir: [0.5, -0.86, 0.08], flex: 16, wrist: -6, twist: 0};

export function basePose() {
  return {
    hips: [0, -0.03, 0], hipsRot: [3, 0, 0],
    spine: [-2, 0, 0], chest: [6, 0, 0], neck: [12, 0, 0], head: [-10, 0, 6],
    armL: {...ARM_HANG}, armR: mirrorArm({...ARM_HANG, dir: [0.49, -0.86, 0.11], flex: 20}),
    legL: {mode: 'ik', z: 0.0, x: 0.0, lift: 0, pitch: 0, yaw: 6}, legR: {mode: 'ik', z: -0.02, x: 0.0, lift: 0, pitch: 0, yaw: -8},
  };
}

// ---------------------------------------------------------------- natural elbow hinge
// zombie/lib/clips.mjs presets give an explicit elbow hinge axis tuned for the wardrobe bodies' bind arms; on this bind (forearm
// angled out and forward) those presets twist the upper arm ~60 deg about its axis and swing the forearms INTO the belly. Here an
// arm without `hinge` keeps its bind elbow plane: hinge = the bind hinge (bone x +Z, pose.mjs armAim) carried by the minimal
// swing bind direction -> target direction, then rolled by `roll` deg about the target direction (+ = elbow out / back).
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

// ---------------------------------------------------------------- keyframe interpolation (same scheme as zombie/lib/clips.mjs)
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
  const w = TAU * t / T, br = TAU * 2 * t / T; // two slow, laboured breaths per loop
  P.hips = [0.012 * Math.sin(w), -0.03 + 0.008 * Math.sin(br), 0.006 * Math.sin(w + 1)];
  P.hipsRot = [3 + 1.0 * Math.sin(br), 2.5 * Math.sin(w + 0.4), -2.2 * Math.sin(w)];
  P.spine = [-2 - 2.2 * Math.sin(br + 0.3), -1.5 * Math.sin(w), 1.6 * Math.sin(w)]; // belly heaves with the breath
  P.chest = [6 + 2.6 * Math.sin(br + 0.8), -1.2 * Math.sin(w + 0.3), 1.2 * Math.sin(w)];
  P.neck = [12 + 3 * Math.sin(w + 2.0), 5 * Math.sin(w + 0.5), 0];
  P.head = [-10 + 5 * Math.sin(br + 1.4), 7 * Math.sin(w + 1.1), 6 + 6 * Math.sin(w + 0.2)];
  P.armL = {...P.armL, dir: [0.5 + 0.03 * Math.sin(w + 1), -0.86, 0.08 + 0.05 * Math.sin(w + 0.5)], flex: 16 + 4 * Math.sin(br)};
  P.armR = {...P.armR, dir: [-0.49 - 0.03 * Math.sin(w + 2), -0.86, 0.11 + 0.05 * Math.sin(w + 2.2)], flex: 20 + 5 * Math.sin(br + 1.5)};
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
  const fl = footCycle(t / T, {beta: G.beta, stride: G.stride, lift: 0.06});
  const fr = footCycle(t / T + 0.5, {beta: G.beta, stride: G.stride * 0.96, lift: 0.05, drag: 6});
  // waddle: the pelvis swings over the stance foot (lateral sway once per cycle), dips at each heel strike (twice)
  const bob = -0.014 * Math.cos(2 * w);
  P.hips = [0.05 * Math.sin(w - 0.3), -0.05 + bob, 0];
  P.hipsRot = [5, 6 * Math.sin(w), 6 * Math.sin(w - 0.3)];
  P.spine = [-1, -3 * Math.sin(w), -5 * Math.sin(w - 0.3)]; // torso counter-roll keeps the head over the feet
  P.chest = [6 + 1.5 * Math.cos(2 * w), -3 * Math.sin(w), -2 * Math.sin(w - 0.3)];
  P.neck = [10, 3 * Math.sin(w), 0];
  P.head = [-14 + 3 * Math.cos(2 * w), -4 * Math.sin(w), 6 + 3 * Math.sin(w)];
  // arms swing forward / back out to the sides (never across the belly)
  P.armL = {...ARM_HANG, dir: [0.53 + 0.04 * Math.max(0, -Math.sin(w)), -0.82, 0.08 - 0.22 * Math.sin(w)], flex: 18 + 8 * Math.max(0, -Math.sin(w))};
  P.armR = mirrorArm({...ARM_HANG, dir: [0.52 + 0.04 * Math.max(0, Math.sin(w)), -0.83, 0.1 + 0.22 * Math.sin(w)], flex: 22 + 8 * Math.max(0, Math.sin(w))});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 8};
  P.legR = {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -10};
  return realize(rig, resolveArms(rig, P));
}

function run(rig, t, T, G) {
  const P = basePose();
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta: G.beta, stride: G.stride, lift: 0.09, pitchOff: 22, pitchStrike: -4});
  const fr = footCycle(t / T + 0.5, {beta: G.beta, stride: G.stride * 0.95, lift: 0.08, pitchOff: 20, pitchStrike: -3, drag: 5});
  const bob = 0.03 * Math.cos(2 * w + 0.4);
  P.hips = [0.045 * Math.sin(w - 0.4), -0.085 + bob, 0.03];
  P.hipsRot = [12, 8 * Math.sin(w), 5 * Math.sin(w - 0.4)];
  P.spine = [4, -5 * Math.sin(w), -4 * Math.sin(w - 0.4)];
  P.chest = [8 + 3 * Math.cos(2 * w), -6 * Math.sin(w), -2 * Math.sin(w)];
  P.neck = [4, 4 * Math.sin(w), 0];
  P.head = [-20 + 5 * Math.cos(2 * w), -5 * Math.sin(w), 6 + 3 * Math.sin(w + 1)];
  // lumbering arm pump, elbows out, hands reaching forward beside (not over) the belly
  P.armL = {...ARM_HANG, dir: [0.5, -0.62 + 0.18 * Math.sin(w + 0.3), 0.45 - 0.35 * Math.sin(w)], flex: 40 + 18 * Math.max(0, Math.sin(w + Math.PI))};
  P.armR = mirrorArm({...ARM_HANG, dir: [0.5, -0.62 + 0.18 * Math.sin(w + 0.3 + Math.PI), 0.45 + 0.35 * Math.sin(w)], flex: 42 + 18 * Math.max(0, Math.sin(w))});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 7};
  P.legR = {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -9};
  return realize(rig, resolveArms(rig, P));
}

// ---------------------------------------------------------------- one-shots
function attackKeys() {
  const B = basePose();
  // lift: both arms come up in FRONT (not round the sides) as the weight shifts back
  const lift = {...B, hips: [0, -0.035, -0.03], hipsRot: [-1, 0, 0], spine: [-4, 0, 0], chest: [0, 0, 0], neck: [6, 0, 0], head: [-10, 0, 0],
    armL: {dir: [0.32, 0.4, 0.86], flex: 35, wrist: -10, twist: 0, wristSide: 0},
    armR: mirrorArm({dir: [0.32, 0.4, 0.86], flex: 35, wrist: -10, twist: 0, wristSide: 0})};
  // wind-up: both fists hauled high over the head (elbows slightly bent forward), torso rocks back onto the heels
  const windup = {...B, hips: [0, -0.04, -0.06], hipsRot: [-4, 0, 0], spine: [-6, 0, 0], chest: [-6, 0, 0], neck: [-2, 0, 0], head: [-6, 0, 0],
    armL: {dir: [0.2, 0.96, -0.18], flex: 32, wrist: -15, twist: 0, wristSide: 0},
    armR: mirrorArm({dir: [0.2, 0.96, -0.18], flex: 32, wrist: -15, twist: 0, wristSide: 0}),
    legL: {mode: 'ik', z: 0.02, x: 0, lift: 0, pitch: 0, yaw: 6}, legR: {mode: 'ik', z: -0.06, x: 0, lift: 0, pitch: 0, yaw: -8}};
  // impact: the fists come down hard in front at chest height, the whole mass lurches forward onto a front step
  const impact = {...B, hips: [0, -0.1, 0.12], hipsRot: [14, 0, 0], spine: [8, 0, 0], chest: [12, 0, 0], neck: [-6, 0, 0], head: [-22, 0, 0],
    armL: {dir: [0.28, -0.12, 0.95], flex: 4, wrist: -14, twist: 0, wristSide: 0},
    armR: mirrorArm({dir: [0.28, -0.12, 0.95], flex: 4, wrist: -14, twist: 0, wristSide: 0}),
    legL: {mode: 'ik', z: 0.22, x: 0, lift: 0, pitch: -4, yaw: 6}, legR: {mode: 'ik', z: -0.08, x: 0, lift: 0, pitch: 14, yaw: -8}};
  // follow-through: arms continue down beside the belly (outward), torso settles
  const follow = {...impact, hips: [0, -0.11, 0.11], hipsRot: [16, 0, 0], chest: [14, 0, 0], head: [-18, 0, 0],
    armL: {dir: [0.52, -0.42, 0.74], flex: 6, wrist: -12, twist: 0, wristSide: 0},
    armR: mirrorArm({dir: [0.52, -0.42, 0.74], flex: 6, wrist: -12, twist: 0, wristSide: 0})};
  const recover = {...B, hips: [0, -0.06, 0.06], hipsRot: [8, 0, 0], legL: {mode: 'ik', z: 0.12, x: 0, lift: 0.02, pitch: 0, yaw: 6}};
  return [
    {t: 0, p: B}, {t: 0.24, p: lift, ease: 'inOut'}, {t: 0.5, p: windup, ease: 'out'}, {t: CLIP_SPECS.Attack.impactTime, p: impact, ease: 'in'}, {t: 0.88, p: follow, ease: 'out'},
    {t: 1.18, p: recover, ease: 'inOut'}, {t: CLIP_SPECS.Attack.duration, p: B, ease: 'inOut'},
  ];
}

function hitKeys() {
  const B = basePose();
  const flinch = {...B, hips: [0.01, -0.05, -0.05], hipsRot: [-4, 6, 3], spine: [-8, 5, 3], chest: [-10, 8, 4], neck: [-6, 6, 0], head: [-22, 12, 14],
    armL: {...ARM_HANG, dir: [0.62, -0.72, -0.05], flex: 35, wrist: -18}, armR: mirrorArm({...ARM_HANG, dir: [0.6, -0.74, -0.02], flex: 40, wrist: -20}),
    legL: {...B.legL, z: 0.02}, legR: {...B.legR, z: -0.06}};
  // the belly mass carries on: a small forward rebound before settling
  const rebound = {...B, hips: [0, -0.04, 0.01], hipsRot: [5, -2, -1], spine: [2, -2, -1], chest: [8, -2, 0], head: [-8, -3, 5]};
  return [{t: 0, p: B}, {t: 0.1, p: flinch, ease: 'snap'}, {t: 0.3, p: rebound, ease: 'inOut'}, {t: CLIP_SPECS.Hit.duration, p: B, ease: 'inOut'}];
}

function deathKeys(final) {
  const B = basePose();
  // swell / convulsion (pustules burst at the peak): chest heaves up and back, arms jerk out to the sides, head thrown back
  const swell = {...B, hips: [0, -0.02, -0.02], hipsRot: [-6, 0, 0], spine: [-10, 0, 0], chest: [-14, 0, 0], neck: [-12, 0, 0], head: [-16, 0, 0],
    armL: {...ARM_HANG, dir: [0.9, -0.25, 0.1], flex: 30, wrist: -25}, armR: mirrorArm({...ARM_HANG, dir: [0.9, -0.22, 0.12], flex: 34, wrist: -25}),
    legL: {...B.legL, z: 0.01}, legR: {...B.legR, z: -0.03}};
  const sag = {...B, hips: [0.02, -0.07, -0.08], hipsRot: [-4, -6, 5], spine: [4, -3, 2], chest: [8, -4, 4], neck: [14, 0, 0], head: [6, -12, 14],
    armL: {...ARM_HANG, dir: [0.7, -0.68, 0.0], flex: 25, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.66, -0.72, -0.05], flex: 32, wrist: -25}),
    legL: {mode: 'ik', z: 0.0, x: 0.02, lift: 0, pitch: -6, yaw: 10}, legR: {mode: 'ik', z: -0.18, x: 0.03, lift: 0, pitch: 8, yaw: -12}};
  const buckle = {...B, hips: [0.03, -0.28, -0.2], hipsRot: [-12, -8, 8], spine: [4, -4, 4], chest: [6, -4, 6], neck: [12, 0, 0], head: [2, -16, 18],
    armL: {...ARM_HANG, dir: [0.8, -0.5, 0.05], flex: 30, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.76, -0.52, -0.05], flex: 38, wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.03, lift: 0, pitch: -14, yaw: 12}, legR: {mode: 'ik', z: -0.22, x: 0.05, lift: 0, pitch: 4, yaw: -12}};
  const topple = {...B, hips: [0.04, -0.4, -0.34], hipsRot: [-52, -6, 6], spine: [6, -4, 2], chest: [8, -2, 4], neck: [16, 0, 0], head: [4, -20, 10],
    armL: {...ARM_HANG, dir: [0.88, 0.15, 0.35], flex: 35, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.85, 0.1, 0.4], flex: 40, wrist: -20}),
    legL: {mode: 'ik', z: 0.0, x: 0.04, lift: 0, pitch: -20, yaw: 14}, legR: {mode: 'ik', z: -0.18, x: 0.06, lift: 0, pitch: -12, yaw: -14}};
  const thud = {...final, hips: V.add(final.hips, [0, -0.004, 0.02]), chest: V.add(final.chest, [-4, 0, 0]), neck: V.add(final.neck, [5, 0, 0]), head: V.add(final.head, [2, -15, 0]),
    armL: {...final.armL, dir: V.add(final.armL.dir, [0, 0, 0.25])}, armR: {...final.armR, dir: V.add(final.armR.dir, [0, 0, 0.25])}};
  return [
    {t: 0, p: B}, {t: 0.2, p: {...swell, chest: [-8, 0, 0]}, ease: 'snap'}, {t: CLIP_SPECS.Death.burstTime, p: swell, ease: 'out'}, {t: 0.75, p: sag, ease: 'inOut'},
    {t: 1.1, p: buckle, ease: 'in'}, {t: 1.42, p: topple, ease: 'inOut'}, {t: 1.7, p: thud, ease: 'in'}, {t: 1.92, p: {...final, hips: V.add(final.hips, [0, 0.012, 0])}, ease: 'out'},
    {t: CLIP_SPECS.Death.duration, p: final, ease: 'inOut'},
  ];
}

export function evalClip(rig, name, t, ctx = {}) {
  const S = CLIP_SPECS[name], T = S.duration;
  switch (name) {
    case 'Idle': return idle(rig, t, T);
    case 'Walk': return walk(rig, t, T, {beta: S.beta, stride: S.groundSpeed * S.beta * T});
    case 'Run': return run(rig, t, T, {beta: S.beta, stride: S.groundSpeed * S.beta * T});
    case 'Attack': return keyed(rig, attackKeys(), t);
    case 'Hit': return keyed(rig, hitKeys(), t);
    case 'Death': return keyed(rig, deathKeys(deathFinal(ctx.deathHipsY ?? -0.6, ctx.deathTune || {})), t);
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
