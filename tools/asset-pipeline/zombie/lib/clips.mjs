// Hand-authored procedural clips (NOT mocap): periodic gait functions + eased keyframes,
// evaluated through FK/IK into per-joint quaternion tracks and a Hips translation track.
import {euler, qMul, qAxis, qId, qSlerp, V} from './pose.mjs';

export const FPS = 30;
const TAU = Math.PI * 2;
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const dirN = v => V.norm(v);
const mirrorDir = d => [-d[0], d[1], d[2]];
const mirrorAxis = h => [h[0], -h[1], -h[2]];

// ---------------------------------------------------------------- shared posture
// Arm presets: dir = upper-arm direction in the Chest frame; hinge = elbow axis (palm = -(dir x hinge)).
const ARM_HANG = {dir: [0.16, -0.97, 0.17], hinge: [-0.55, 0.0, -0.84], flex: 18, wrist: -8, twist: 0};
const ARM_REACH = {dir: [0.24, 0.20, 0.95], hinge: [0.0, -1.0, 0.0], flex: 8, wrist: 0, twist: 35, wristSide: -25};

export function basePose() {
  return {
    hips: [0, -0.035, 0], hipsRot: [5, 0, 0],
    spine: [6, 0, 0], chest: [7, 0, 0], neck: [10, 0, 0], head: [-12, 0, 9],
    armL: {...ARM_HANG}, armR: mirrorArm({...ARM_HANG, dir: [0.14, -0.97, 0.21], flex: 24}),
    legL: {mode: 'ik', z: 0.0, x: 0, lift: 0, pitch: 0, yaw: 4}, legR: {mode: 'ik', z: -0.03, x: 0, lift: 0, pitch: 0, yaw: -6},
  };
}
// Mirror an arm preset to the other side. Rotations about polar-mirrored axes (forearm axis for
// twist, hand side axis for wristSide) flip sign; hinge-axis rotations (flex, wrist) do not.
function mirrorArm(a) { return {...a, dir: mirrorDir(a.dir), hinge: mirrorAxis(a.hinge), twist: -(a.twist || 0), wristSide: -(a.wristSide || 0)}; }

/** Turn a parameter set into a pose {hips, rot}. */
export function realize(rig, P) {
  const pose = {hips: P.hips, rot: {}};
  pose.rot.Hips = euler(...P.hipsRot);
  pose.rot.Spine = euler(...P.spine);
  pose.rot.Chest = euler(...P.chest);
  pose.rot.Neck = euler(...P.neck);
  pose.rot.Head = euler(...P.head);
  for (const s of ['L', 'R']) {
    const a = P['arm' + s];
    if (a.quats) Object.assign(pose.rot, a.quats);
    else rig.armAim(pose, s, {...a, dir: dirN(a.dir), hinge: dirN(a.hinge)});
    const l = P['leg' + s];
    if (l.mode === 'ik') pose.reach = Math.max(pose.reach || 0, rig.legIK(pose, s, l).reach);
    else { pose.rot[s + '_Thigh'] = euler(...l.thigh); pose.rot[s + '_Shin'] = euler(...l.shin); pose.rot[s + '_Foot'] = euler(...l.foot); }
  }
  return pose;
}

// ---------------------------------------------------------------- keyframe interpolation
function mixParams(rig, A, B, t) {
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
    else if (a.mode === 'fk' && b.mode === 'fk') out[k] = {mode: 'fk', thigh: lerpV(a.thigh, b.thigh, t), shin: lerpV(a.shin, b.shin, t), foot: lerpV(a.foot, b.foot, t)};
    else out[k] = {mode: 'slerp', a, b, t};
  }
  return out;
}
function realizeMixed(rig, P, A, B) {
  // legs switching IK<->FK: realize each key fully with its own hips, then slerp the leg joints
  const pose = realize(rig, {...P, legL: P.legL.mode === 'slerp' ? {mode: 'fk', thigh: [0, 0, 0], shin: [0, 0, 0], foot: [0, 0, 0]} : P.legL, legR: P.legR.mode === 'slerp' ? {mode: 'fk', thigh: [0, 0, 0], shin: [0, 0, 0], foot: [0, 0, 0]} : P.legR});
  for (const s of ['L', 'R']) {
    const l = P['leg' + s];
    if (l.mode !== 'slerp') continue;
    const pa = realize(rig, A), pb = realize(rig, B);
    for (const j of ['_Thigh', '_Shin', '_Foot']) pose.rot[s + j] = qSlerp(pa.rot[s + j], pb.rot[s + j], l.t);
  }
  return pose;
}
const EASE = {inOut: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), linear: t => t, snap: t => 1 - Math.pow(1 - t, 3)};
function keyed(rig, keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const A = keys[i], B = keys[i + 1];
  const u = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
  const e = (EASE[B.ease || 'inOut'])(u);
  const P = mixParams(rig, A.p, B.p, e);
  return realizeMixed(rig, P, A.p, B.p);
}

// ---------------------------------------------------------------- loops
function idle(rig, t, T) {
  const P = basePose();
  const w = TAU * t / T;
  P.hips = [0.014 * Math.sin(w), -0.035 + 0.006 * Math.sin(2 * w), 0.008 * Math.sin(w + 1)];
  P.hipsRot = [5 + 1.0 * Math.sin(2 * w), 2 * Math.sin(w + 0.4), -1.6 * Math.sin(w)];
  P.spine = [6 + 1.2 * Math.sin(2 * w + 0.6), -1.5 * Math.sin(w), 1.2 * Math.sin(w)];
  P.chest = [7 + 1.8 * Math.sin(2 * w + 1.0), -1.0 * Math.sin(w + 0.3), 1.0 * Math.sin(w)];
  P.neck = [10 + 3 * Math.sin(w + 2.0), 4 * Math.sin(w + 0.5), 0];
  P.head = [-12 + 4 * Math.sin(2 * w + 1.5), 6 * Math.sin(w + 1.1), 9 + 7 * Math.sin(w + 0.2)];
  P.armL = {...P.armL, dir: [0.16 + 0.03 * Math.sin(w + 1), -0.97, 0.17 + 0.05 * Math.sin(w + 0.5)], flex: 18 + 4 * Math.sin(w)};
  P.armR = {...P.armR, dir: [-0.14 - 0.03 * Math.sin(w + 2), -0.97, 0.21 + 0.05 * Math.sin(w + 2.2)], flex: 24 + 5 * Math.sin(w + 1.5)};
  return realize(rig, P);
}

/** Treadmill gait: stance foot slides back at ground speed v; swing returns it forward. */
function footCycle(phase, {beta, stride, lift, pitchOff = 22, pitchStrike = -8, drag = 0}) {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < beta) {
    const s = ph / beta;
    return {z: stride / 2 - stride * s, lift: 0, pitch: lerp(pitchStrike, 0, ss(0, 0.15, s)) + pitchOff * ss(0.7, 1, s)};
  }
  const s = (ph - beta) / (1 - beta);
  const zz = -stride / 2 + stride * (s * s * (3 - 2 * s));
  const h = lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 1.2);
  return {z: zz, lift: Math.max(0, h), pitch: lerp(pitchOff, pitchStrike, ss(0.15, 0.85, s)) + drag * Math.sin(Math.PI * s)};
}

function walk(rig, t, T, G) {
  const P = basePose();
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta: G.betaL, stride: G.strideL, lift: 0.075});
  const fr = footCycle(t / T + 0.5, {beta: G.betaR, stride: G.strideR, lift: 0.035, pitchOff: 14, drag: 10});
  // limp: deeper hip dip while the bad (right) leg carries weight; bob twice per cycle
  const bob = -0.012 * Math.cos(2 * w);
  P.hips = [0.03 * Math.sin(w - 0.6), -0.045 + bob - 0.012 * Math.max(0, Math.sin(w + Math.PI)), 0];
  P.hipsRot = [7, 7 * Math.sin(w), -3 * Math.sin(w) + 2.5];
  P.spine = [9, -4 * Math.sin(w), 2 * Math.sin(w)];
  P.chest = [9 + 1.5 * Math.cos(2 * w), -4 * Math.sin(w), -3];
  P.neck = [8, 3 * Math.sin(w), 0];
  P.head = [-22 + 3 * Math.cos(2 * w), -4 * Math.sin(w), 12 + 3 * Math.sin(w)];
  P.armL = {...ARM_REACH, dir: [0.24, 0.22 + 0.06 * Math.sin(w + 0.5), 0.95], flex: 7 + 4 * Math.sin(w), wristSide: -25 + 6 * Math.sin(w + 1)};
  P.armR = mirrorArm({...ARM_REACH, dir: [0.26, 0.02 + 0.06 * Math.sin(w + 2.4), 0.96], flex: 14 + 5 * Math.sin(w + 2), wristSide: -32});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 4};
  P.legR = {mode: 'ik', z: fr.z, x: 0.02, lift: fr.lift, pitch: fr.pitch, yaw: -10};
  return realize(rig, P);
}

function run(rig, t, T, G) {
  const P = basePose();
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta: G.beta, stride: G.stride, lift: 0.20, pitchOff: 30, pitchStrike: -4});
  const fr = footCycle(t / T + 0.5, {beta: G.beta, stride: G.stride * 0.94, lift: 0.15, pitchOff: 26, pitchStrike: -2, drag: 6});
  const bob = 0.03 * Math.cos(2 * w + 0.4);
  P.hips = [0.035 * Math.sin(w - 0.5), -0.075 + bob, 0.04];
  P.hipsRot = [16, 10 * Math.sin(w), -4 * Math.sin(w)];
  P.spine = [12, -6 * Math.sin(w), 3 * Math.sin(w)];
  P.chest = [12 + 3 * Math.cos(2 * w), -7 * Math.sin(w), -4 + 2 * Math.sin(w)];
  P.neck = [2, 4 * Math.sin(w), 0];
  P.head = [-30 + 5 * Math.cos(2 * w), -5 * Math.sin(w), 8 + 4 * Math.sin(w + 1)];
  P.armL = {...ARM_REACH, dir: [0.26, 0.45 + 0.22 * Math.sin(w + 0.3), 0.86], flex: 10 + 8 * Math.sin(w), wristSide: -18 + 10 * Math.sin(w + 1)};
  P.armR = mirrorArm({...ARM_REACH, dir: [0.28, 0.35 + 0.22 * Math.sin(w + 0.3 + Math.PI), 0.88], flex: 12 + 8 * Math.sin(w + Math.PI), wristSide: -24});
  P.legL = {mode: 'ik', z: fl.z, x: 0.0, lift: fl.lift, pitch: fl.pitch, yaw: 3};
  P.legR = {mode: 'ik', z: fr.z, x: 0.0, lift: fr.lift, pitch: fr.pitch, yaw: -7};
  return realize(rig, P);
}

// ---------------------------------------------------------------- one-shots
function attackKeys() {
  const B = basePose();
  // wind-up: arms pulled up and out to the sides, elbows bent, claws (palms) facing forward
  const windup = {...B, hips: [0, -0.06, -0.06], hipsRot: [-2, -8, 0], spine: [-4, -6, 0], chest: [-8, -8, 0], neck: [0, 0, 0], head: [-14, 5, 4],
    armL: {dir: [0.80, 0.45, -0.30], hinge: [0, -1, 0], flex: 75, wrist: 0, twist: 0, wristSide: 10},
    armR: mirrorArm({dir: [0.78, 0.50, -0.30], hinge: [0, -1, 0], flex: 80, wrist: 0, twist: 0, wristSide: 10}),
    legL: {mode: 'ik', z: 0.04, x: 0, lift: 0.03, pitch: 6, yaw: 4}, legR: {mode: 'ik', z: -0.08, x: 0, lift: 0, pitch: 0, yaw: -6}};
  // impact (0.45 s): lunge, both arms swiped forward/inward at chest-head height
  const impact = {...B, hips: [0, -0.10, 0.17], hipsRot: [18, 6, 0], spine: [12, 4, 0], chest: [16, 6, 0], neck: [-2, 0, 0], head: [-30, 0, 6],
    armL: {dir: [0.16, 0.62, 0.77], hinge: [0, -1, 0], flex: 6, wrist: 0, twist: 35, wristSide: -10},
    armR: mirrorArm({dir: [0.18, 0.55, 0.82], hinge: [0, -1, 0], flex: 8, wrist: 0, twist: 35, wristSide: -12}),
    legL: {mode: 'ik', z: 0.32, x: 0, lift: 0, pitch: -4, yaw: 4}, legR: {mode: 'ik', z: -0.10, x: 0, lift: 0, pitch: 18, yaw: -6}};
  // follow-through: arms continue down, staying on their own side (no crossing)
  const follow = {...impact, hips: [0, -0.11, 0.15], hipsRot: [20, 10, 0], chest: [22, 8, 0], head: [-26, 4, 8],
    armL: {dir: [0.20, 0.05, 0.98], hinge: [0, -1, 0], flex: 10, wrist: 0, twist: 35, wristSide: -28},
    armR: mirrorArm({dir: [0.22, -0.05, 0.97], hinge: [0, -1, 0], flex: 12, wrist: 0, twist: 35, wristSide: -28})};
  return [
    {t: 0, p: B}, {t: 0.32, p: windup, ease: 'inOut'}, {t: 0.45, p: impact, ease: 'in'}, {t: 0.58, p: follow, ease: 'out'},
    {t: 0.82, p: {...B, hips: [0, -0.06, 0.06], legL: {mode: 'ik', z: 0.14, x: 0, lift: 0.03, pitch: 0, yaw: 4}}, ease: 'inOut'}, {t: 1.1, p: B, ease: 'inOut'},
  ];
}

function hitKeys() {
  const B = basePose();
  const flinch = {...B, hips: [0.01, -0.05, -0.05], hipsRot: [-3, 6, 3], spine: [-6, 6, 3], chest: [-12, 10, 5], neck: [-6, 6, 0], head: [-26, 12, 16],
    armL: {...B.armL, dir: [0.4, -0.85, -0.1], flex: 40, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.35, -0.85, -0.05], flex: 45, wrist: -25}),
    legL: {...B.legL, z: 0.02}, legR: {...B.legR, z: -0.07}};
  return [{t: 0, p: B}, {t: 0.08, p: flinch, ease: 'snap'}, {t: 0.35, p: B, ease: 'inOut'}];
}

function deathKeys(final) {
  // shot/knocked back: jolt, stagger back, knees buckle, sit down hard, fall onto the back, settle
  const B = basePose();
  const jolt = {...B, hips: [0, -0.04, -0.05], hipsRot: [-6, -6, 4], spine: [-6, -4, 0], chest: [-12, -6, 4], neck: [-8, 0, 0], head: [-28, -10, 14],
    armL: {...B.armL, dir: [0.55, -0.80, -0.20], flex: 30}, armR: mirrorArm({...ARM_HANG, dir: [0.50, -0.82, -0.25], flex: 35}),
    legL: {...B.legL, z: 0.02}, legR: {...B.legR, z: -0.06}};
  const stagger = {...B, hips: [0.02, -0.08, -0.14], hipsRot: [-8, -10, 6], spine: [-6, -4, 2], chest: [-10, -6, 6], neck: [-4, 0, 0], head: [-20, -14, 16],
    armL: {...ARM_HANG, dir: [0.80, -0.25, -0.10], flex: 40, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.75, -0.10, -0.20], flex: 50, wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.02, lift: 0, pitch: -6, yaw: 8}, legR: {mode: 'ik', z: -0.32, x: 0.04, lift: 0, pitch: 12, yaw: -10}};
  const buckle = {...B, hips: [0.03, -0.36, -0.24], hipsRot: [-14, -8, 8], spine: [4, -4, 4], chest: [6, -4, 6], neck: [10, 0, 0], head: [0, -16, 18],
    armL: {...ARM_HANG, dir: [0.75, -0.55, 0.0], flex: 30, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.70, -0.55, -0.10], flex: 40, wrist: -25}),
    legL: {mode: 'ik', z: -0.02, x: 0.03, lift: 0, pitch: -14, yaw: 12}, legR: {mode: 'ik', z: -0.30, x: 0.05, lift: 0, pitch: 4, yaw: -12}};
  // topple: from buckled knees the body falls back as a unit (feet still planted). Hip height is
  // kept above skirt-length x cos(pitch) so the rigid coat skirt never swings through the floor.
  const topple = {...B, hips: [0.04, -0.50, -0.40], hipsRot: [-55, -6, 6], spine: [6, -4, 2], chest: [8, -2, 4], neck: [16, 0, 0], head: [4, -20, 10],
    armL: {...ARM_HANG, dir: [0.85, 0.15, 0.40], flex: 35, wrist: -20}, armR: mirrorArm({...ARM_HANG, dir: [0.82, 0.10, 0.45], flex: 40, wrist: -20}),
    legL: {mode: 'ik', z: 0.0, x: 0.04, lift: 0, pitch: -20, yaw: 14}, legR: {mode: 'ik', z: -0.24, x: 0.06, lift: 0, pitch: -12, yaw: -14}};
  const impact = {...final, hips: V.add(final.hips, [0, -0.004, 0.02]), chest: V.add(final.chest, [-4, 0, 0]), neck: V.add(final.neck, [5, 0, 0]), head: V.add(final.head, [2, -15, 0]),
    armL: {...final.armL, dir: V.add(final.armL.dir, [0, 0, 0.25])}, armR: {...final.armR, dir: V.add(final.armR.dir, [0, 0, 0.25])}};
  return [
    {t: 0, p: B}, {t: 0.12, p: jolt, ease: 'snap'}, {t: 0.36, p: stagger, ease: 'out'}, {t: 0.62, p: buckle, ease: 'in'},
    {t: 0.86, p: topple, ease: 'inOut'}, {t: 1.1, p: impact, ease: 'in'}, {t: 1.28, p: {...final, hips: V.add(final.hips, [0, 0.012, 0])}, ease: 'out'}, {t: 1.6, p: final, ease: 'inOut'},
  ];
}

export function deathFinal(hipsY, tune = {}) {
  // supine: lying on the back, head rolled to the right, arms splayed on the floor (palms up),
  // left leg nearly straight, right knee raised; head toward -Z, heels on the floor near +Z.
  // `tune` comes from the build's floor-contact solver (see DEATH_PARAMS in build-zombie.mjs).
  const T = {hipsPitch: -88, hipsRoll: 5, neck: -4, head: -6, headYaw: -38, armLz: -0.3, armRz: -0.3, footLz: 0.42, footRz: 0.12, ...tune};
  return {
    hips: [0.03, hipsY, -0.42], hipsRot: [T.hipsPitch, -6, T.hipsRoll], spine: [2, -3, 2], chest: [2, -4, 3], neck: [T.neck, -10, 0], head: [T.head, T.headYaw, 6],
    armL: {dir: [0.88, 0.30, T.armLz], hinge: [0, -1, 0], flex: 25, wrist: 0, twist: 0, wristSide: 0},
    armR: mirrorArm({dir: [0.80, -0.35, T.armRz], hinge: [0, -1, 0], flex: 35, wrist: 0, twist: 0, wristSide: 0}),
    // legs stay in IK so the whole fall keeps the heels on the floor (feet slide out as the body drops)
    legL: {mode: 'ik', z: T.footLz, x: 0.06, lift: 0, pitch: -78, yaw: 18}, legR: {mode: 'ik', z: T.footRz, x: 0.05, lift: 0, pitch: -40, yaw: -22},
  };
}

export const CLIP_SPECS = {
  Idle: {duration: 3.0, loop: true},
  Walk: {duration: 1.2, loop: true, groundSpeed: 0.55},
  Run: {duration: 0.75, loop: true, groundSpeed: 2.3},
  Attack: {duration: 1.1, loop: false, impactTime: 0.45},
  Hit: {duration: 0.35, loop: false},
  Death: {duration: 1.6, loop: false},
};

/** Evaluate a clip to a pose at time t. */
export function evalClip(rig, name, t, ctx = {}) {
  const S = CLIP_SPECS[name], T = S.duration;
  switch (name) {
    case 'Idle': return idle(rig, t, T);
    case 'Walk': {
      const v = S.groundSpeed, betaL = 0.66, betaR = 0.56;
      return walk(rig, t, T, {betaL, betaR, strideL: v * betaL * T, strideR: v * betaR * T});
    }
    case 'Run': { const beta = 0.36; return run(rig, t, T, {beta, stride: S.groundSpeed * beta * T}); }
    case 'Attack': return keyed(rig, attackKeys(), t);
    case 'Hit': return keyed(rig, hitKeys(), t);
    case 'Death': return keyed(rig, deathKeys(deathFinal(ctx.deathHipsY ?? -0.64, ctx.deathTune || {})), t);
  }
  throw new Error('unknown clip ' + name);
}

/** Sample a clip into tracks; loops get an exact copy of frame 0 at t = T. */
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
      let q = pose.rot[n] || qId();
      const prev = rot[n][rot[n].length - 1];
      if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map(v => -v);
      rot[n].push(q.map(v => +v.toFixed(6)));
    }
  }
  return {name, duration: S.duration, loop: S.loop, times, rot, hips, maxLegReach: +maxReach.toFixed(4)};
}
export {qMul, qAxis};
