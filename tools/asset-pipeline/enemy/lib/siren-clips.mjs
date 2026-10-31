// Task track1-siren-blightbelly-20261031 (lane RIGS): hand-authored procedural Siren clips (NOT mocap), evaluated with the
// shared humanoid pose machinery (zombie/lib/pose.mjs Rig: FK, 2-bone leg IK, arm aiming; zombie/lib/clips.mjs realize) on
// the Siren's own 18-joint skeleton. Pose animation is behaviour only — the mesh is deformed solely by skinning at runtime.
//   Dormant  4.0 s loop  kneeling nearly upright, torso bowed far forward over the knees, head hanging, arms straight down with
//                        the claws resting on the floor; slow breathing (chest / spine pitch), faint head sway
//   Rise     1.0 s       dormant -> push up from the floor -> one foot planted -> predatory stance
//   Run      0.6 s loop  fast, aggressive, leaning forward, claws reaching (authored ground speed in SIREN_CLIPS.Run)
//   Attack   1.0 s       readable wind-up (right claw raised back, torso twisted) -> diagonal swipe (impact 0.40 s) ->
//                        follow-through -> recover
//   Hit      0.35 s      flinch
//   Death    1.8 s       jolt, knees buckle, kneel, topple forward, prone on the floor
// Arm specs are given in WORLD space ({dirW, flexW: forearm bend direction, flex}) and converted to the chest frame for the
// key's torso, so poses read naturally regardless of the torso pitch. Right arms mirror the left unless given explicitly.
import {euler, qMul, qInv, qRot, V} from '../../zombie/lib/pose.mjs';
import {realize} from '../../zombie/lib/clips.mjs';

export const FPS = 30;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const SIREN_CLIPS = {
  Dormant: {duration: 4.0, loop: true},
  Rise: {duration: 1.0, loop: false},
  Run: {duration: 0.6, loop: true, groundSpeed: 4.2},
  Attack: {duration: 1.0, loop: false, impactTime: 0.40, windupEnd: 0.28},
  Hit: {duration: 0.35, loop: false},
  Death: {duration: 1.8, loop: false},
};

// ------------------------------------------------------------------------------------------------ world -> chest arm specs
const chestWorld = P => qMul(qMul(euler(...P.hipsRot), euler(...P.spine)), euler(...P.chest));
const mirrorW = v => [-v[0], v[1], v[2]];
/** World arm spec -> chest-local {dir, hinge, flex, ...} for the realize() arm aimer. flexW = direction the forearm bends toward. */
function armLocal(P, side, a) {
  const q = qInv(chestWorld(P));
  let d = V.norm(a.dirW), f = a.flexW ? V.norm(a.flexW) : [0, 0, 1];
  if (side === 'R' && !a.explicit) { d = mirrorW(d); f = mirrorW(f); }
  f = V.norm(V.sub(f, V.mul(d, V.dot(f, d)))); // orthogonalise
  const hinge = V.cross(d, f); // flex rotates the forearm toward hinge x dir = f
  return {dir: qRot(q, d), hinge: qRot(q, hinge), flex: a.flex ?? 0, wrist: a.wrist ?? 0, twist: (side === 'R' && !a.explicit ? -1 : 1) * (a.twist ?? 0), wristSide: (side === 'R' && !a.explicit ? -1 : 1) * (a.wristSide ?? 0)};
}
/** Torso / legs params + world arm specs -> realize() parameter set. */
function key(T, armL, armR = null) {
  const P = {hips: T.hips.slice(), hipsRot: T.hipsRot, spine: T.spine, chest: T.chest, neck: T.neck, head: T.head, legL: legLocal(T, T.legL, 'L'), legR: legLocal(T, T.legR ?? T.legL, 'R')};
  if (T.ground) P.ground = T.ground;
  P.armL = armLocal(P, 'L', armL);
  P.armR = armR ? armLocal(P, 'R', armR) : armLocal(P, 'R', armL);
  return P;
}
/**
 * FK legs given by WORLD pitch (deg; 0 = bone straight down, + swings the lower end backward, - forward): {mode: 'fkw', thigh:
 * [pitchW, yaw, roll], shin: pitchW, foot: pitchW (0 = foot flat forward, 90 = toes down, 180 = toes back / sole up)}. Converted to
 * the local rotations realize() expects (thigh relative to the Hips pitch; shin / foot relative to their parent). R mirrors L
 * (yaw / roll negated) unless the key gives legR explicitly with `side: 'R'`.
 */
const fkw = (thigh, shin, foot, side = null) => ({mode: 'fkw', thigh, shin, foot, side});
function legLocal(T, l, side) {
  if (!l || l.mode !== 'fkw') return l;
  const sg = side === 'R' && l.side !== 'R' ? -1 : 1;
  return {mode: 'fk', thigh: [l.thigh[0] - T.hipsRot[0], sg * (l.thigh[1] ?? 0), sg * (l.thigh[2] ?? 0)], shin: [l.shin - l.thigh[0], 0, 0], foot: [l.foot - l.shin, 0, 0]};
}

// ------------------------------------------------------------------------------------------------ poses
/** Predatory stance (end of Rise, base of Attack / Hit): crouched, pelvis tipped forward, claws forward and ready. */
export function stance() {
  return key({hips: [0, -0.11, 0.02], hipsRot: [18, 0, 0], spine: [9, 0, 0], chest: [8, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0],
    legL: {mode: 'ik', z: 0.11, x: 0.03, lift: 0, pitch: 0, yaw: 8}, legR: {mode: 'ik', z: -0.13, x: 0.03, lift: 0, pitch: 6, yaw: -10}},
  {dirW: [0.42, -0.55, 0.72], flexW: [-0.3, 0.7, 0.6], flex: 38, wristSide: -10});
}

/** Dormant base (t-independent): see the header. `ctx.dormant` = {hipsY, armFlex} solved by the builder (floor contact). */
export function dormantPose(ctx = {}, breath = 0, sway = 0) {
  const D = ctx.dormant ?? {hipsY: -0.40, armFlex: 10, hipsZ: -0.08};
  // kneeling nearly upright (thighs ~12 deg forward: the hips stay high, so the Hips-weighted skirt sinks as little as a kneel
  // allows), pelvis tipped 45 deg and torso bowed far forward over the knees (the tipped pelvis also swings the skirt back /
  // up), arms hanging straight down with the claws on the floor, head hanging
  return key({hips: [0, D.hipsY + 0.004 * breath, D.hipsZ], hipsRot: [45 + 0.6 * breath, 0, 0], spine: [30 + 1.2 * breath, 0.8 * sway, 0], chest: [20 - 1.6 * breath, 0.6 * sway, 0],
    neck: [8 + 0.8 * breath, 2.0 * sway, 0], head: [12 - 1.2 * breath, 3.0 * sway, 1.5 * sway], legL: fkw([-12, 6, 3], 92, 158)},
  {dirW: [0.12, -0.98, 0.06], flexW: [-0.1, 0.1, 1], flex: D.armFlex, wrist: -25, wristSide: 0});
}

function dormant(rig, t, T, ctx) {
  const w = TAU * t / T;
  return realize(rig, dormantPose(ctx, Math.sin(w), Math.sin(w + 0.9)));
}

// ------------------------------------------------------------------------------------------------ keyframes (as zombie/lib/clips.mjs)
function mixParams(A, B, t) {
  const out = {};
  for (const k of ['hips', 'hipsRot', 'spine', 'chest', 'neck', 'head']) out[k] = lerpV(A[k], B[k], t);
  for (const k of ['armL', 'armR']) {
    const a = A[k], b = B[k];
    out[k] = {dir: V.norm(lerpV(V.norm(a.dir), V.norm(b.dir), t)), hinge: V.norm(lerpV(V.norm(a.hinge), V.norm(b.hinge), t)), flex: lerp(a.flex, b.flex, t), wrist: lerp(a.wrist, b.wrist, t), twist: lerp(a.twist, b.twist, t), wristSide: lerp(a.wristSide, b.wristSide, t)};
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
  const zero = {mode: 'fk', thigh: [0, 0, 0], shin: [0, 0, 0], foot: [0, 0, 0]};
  const pose = realize(rig, {...P, legL: P.legL.mode === 'slerp' ? zero : P.legL, legR: P.legR.mode === 'slerp' ? zero : P.legR});
  for (const s of ['L', 'R']) {
    const l = P['leg' + s];
    if (l.mode !== 'slerp') continue;
    // legs switching IK <-> FK: realize each key with ITS OWN hips, slerp the leg joints
    const pa = realize(rig, A), pb = realize(rig, B);
    for (const j of ['_Thigh', '_Shin', '_Foot']) pose.rot[s + j] = slerpQ(pa.rot[s + j], pb.rot[s + j], l.t);
  }
  return pose;
}
function slerpQ(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = d < 0 ? b.map(v => -v) : b; d = Math.abs(d);
  if (d > 0.9995) { const q = a.map((v, i) => v + (bb[i] - v) * t); const l = Math.hypot(...q); return q.map(v => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + bb[i] * Math.sin(t * th)) / s);
}
const EASE = {inOut: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), linear: t => t, snap: t => 1 - Math.pow(1 - t, 3)};
/** Keys flagged `ground` get their hips height solved once by ctx.ground (the builder's floor-contact solve); cached per clip. */
function groundedKeys(name, build, ctx) {
  ctx.cache ??= {};
  if (ctx.cache[name]) return ctx.cache[name];
  const keys = build(ctx);
  if (ctx.ground) for (const k of keys) if (k.p.ground) k.p.hips[1] = ctx.ground(k.p, k.p.ground);
  return (ctx.cache[name] = keys);
}
function keyed(rig, keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const A = keys[i], B = keys[i + 1];
  const u = Math.min(1, Math.max(0, (t - A.t) / (B.t - A.t)));
  const e = (EASE[B.ease || 'inOut'])(u);
  return realizeMixed(rig, mixParams(A.p, B.p, e), A.p, B.p);
}

function riseKeys(ctx) {
  const D = ctx.dormant ?? {hipsY: -0.40, armFlex: 10, hipsZ: -0.08};
  // kneeling upright, torso still forward, head coming up, claws leaving the floor
  const push = key({hips: [0, D.hipsY + 0.10, D.hipsZ + 0.02], hipsRot: [30, 0, 0], spine: [10, 0, 0], chest: [4, 0, 0], neck: [-8, 0, 0], head: [-22, 0, 0], legL: fkw([-6, 5, 3], 92, 160), ground: 'legs'},
    {dirW: [0.25, -0.85, 0.45], flexW: [-0.1, 0.3, 1], flex: 22, wrist: -25});
  // left foot planted forward (lunge kneel), right knee still down
  const lunge = key({hips: [0, -0.33, D.hipsZ + 0.05], hipsRot: [22, 6, 0], spine: [6, 0, 0], chest: [2, 0, 0], neck: [-10, 0, 0], head: [-16, 0, 0],
    legL: fkw([-62, 6, 2], 4, 2), legR: fkw([8, 4, 3], 93, 150), ground: 'legs'},
  {dirW: [0.45, -0.5, 0.75], flexW: [-0.3, 0.7, 0.5], flex: 30, wristSide: -10});
  const st = stance();
  return [{t: 0, p: dormantPose(ctx)}, {t: 0.32, p: push, ease: 'inOut'}, {t: 0.62, p: lunge, ease: 'inOut'}, {t: 1.0, p: st, ease: 'out'}];
}

function attackKeys() {
  const st = stance();
  // wind-up: weight back, torso twisted to her right, right claw raised high and back, left claw out for balance
  const windup = key({hips: [0, -0.12, -0.05], hipsRot: [8, -14, 0], spine: [2, -12, 0], chest: [-4, -14, 0], neck: [-6, 8, 0], head: [-8, 10, 0],
    legL: {mode: 'ik', z: 0.14, x: 0.03, lift: 0.02, pitch: 4, yaw: 8}, legR: {mode: 'ik', z: -0.16, x: 0.03, lift: 0, pitch: 8, yaw: -14}},
  {dirW: [0.55, -0.35, 0.75], flexW: [-0.4, 0.6, 0.4], flex: 30, wristSide: -12},
  {explicit: true, dirW: [-0.45, 0.72, -0.52], flexW: [0.3, 0.3, 0.9], flex: 85, wrist: 20, wristSide: 0});
  // impact (0.40 s): lunge forward, torso whipped to her left, right claw slashing across at chest / head height
  const impact = key({hips: [0, -0.16, 0.16], hipsRot: [22, 14, 0], spine: [10, 14, 0], chest: [12, 16, 0], neck: [-14, -10, 0], head: [-10, -8, 0],
    legL: {mode: 'ik', z: 0.36, x: 0.04, lift: 0, pitch: -4, yaw: 10}, legR: {mode: 'ik', z: -0.18, x: 0.02, lift: 0, pitch: 22, yaw: -8}},
  {dirW: [0.6, -0.55, 0.45], flexW: [-0.3, 0.6, 0.6], flex: 40, wristSide: -12},
  {explicit: true, dirW: [0.15, 0.12, 0.98], flexW: [0.9, 0.1, 0.2], flex: 12, wrist: -10, wristSide: 15});
  // follow-through: claw continues down and across to her left
  const follow = key({hips: [0, -0.17, 0.15], hipsRot: [26, 20, 0], spine: [12, 16, 0], chest: [14, 18, 0], neck: [-14, -14, 0], head: [-8, -10, 0],
    legL: impact.legL, legR: impact.legR},
  {dirW: [0.6, -0.6, 0.4], flexW: [-0.3, 0.6, 0.6], flex: 40, wristSide: -12},
  {explicit: true, dirW: [0.62, -0.5, 0.6], flexW: [0.5, 0.5, 0.3], flex: 22, wrist: -15, wristSide: 20});
  return [{t: 0, p: st}, {t: 0.28, p: windup, ease: 'inOut'}, {t: 0.40, p: impact, ease: 'in'}, {t: 0.54, p: follow, ease: 'out'}, {t: 1.0, p: st, ease: 'inOut'}];
}

function hitKeys() {
  const st = stance();
  const flinch = key({hips: [0.01, -0.10, -0.05], hipsRot: [6, 8, 4], spine: [-6, 8, 3], chest: [-12, 10, 5], neck: [-6, 8, 0], head: [-22, 14, 14],
    legL: {mode: 'ik', z: 0.09, x: 0.03, lift: 0, pitch: 0, yaw: 8}, legR: {mode: 'ik', z: -0.16, x: 0.03, lift: 0, pitch: 8, yaw: -10}},
  {dirW: [0.6, -0.45, 0.35], flexW: [-0.3, 0.8, 0.4], flex: 55, wristSide: -10});
  return [{t: 0, p: st}, {t: 0.08, p: flinch, ease: 'snap'}, {t: 0.35, p: st, ease: 'inOut'}];
}

/** Death: `ctx.deathHipsY` = final prone hips offset solved by the builder (lowest body point on the floor). */
function deathKeys(ctx) {
  const st = stance();
  const jolt = key({hips: [0, -0.08, -0.06], hipsRot: [4, -6, 4], spine: [-8, -4, 0], chest: [-14, -6, 4], neck: [-12, 0, 0], head: [-28, -10, 12],
    legL: {mode: 'ik', z: 0.09, x: 0.03, lift: 0, pitch: 0, yaw: 8}, legR: {mode: 'ik', z: -0.17, x: 0.03, lift: 0, pitch: 8, yaw: -10}},
  {dirW: [0.85, -0.2, -0.3], flexW: [-0.2, 0.9, 0.2], flex: 35, wristSide: 0});
  const kneel = key({hips: [0, -0.43, -0.10], hipsRot: [16, -6, 6], spine: [10, -4, 4], chest: [10, -4, 4], neck: [16, 0, 0], head: [12, -16, 10], legL: fkw([-8, 4, 4], 93, 158), ground: 'legs'},
    {dirW: [0.4, -0.9, 0.1], flexW: [-0.2, 0, 1], flex: 15, wrist: -10});
  const tip = key({hips: [0.02, -0.55, 0.10], hipsRot: [55, -8, 8], spine: [8, -4, 4], chest: [8, -2, 4], neck: [6, 0, 0], head: [0, -30, 10],
    legL: fkw([-12, 4, 4], 93, 158), legR: fkw([-4, -4, -4], 94, 160, 'R'), ground: 'legs'},
  {dirW: [0.45, -0.6, 0.65], flexW: [-0.2, 0.5, 0.8], flex: 25, wrist: -20});
  const hy = ctx.deathHipsY ?? -0.70;
  const prone = key({hips: [0.03, hy, 0.18], hipsRot: [86, -4, 6], spine: [2, -2, 2], chest: [2, -2, 2], neck: [-6, -20, 0], head: [-6, -50, 0],
    legL: fkw([84, 4, 4], 94, 168), legR: fkw([86, -6, -2], 96, 170, 'R')},
  {dirW: [0.75, 0.0, 0.65], flexW: [-0.6, 0, 0.8], flex: 30, wrist: 0},
  {explicit: true, dirW: [-0.25, 0.0, -0.97], flexW: [0.9, 0, 0.3], flex: 10, wrist: 0});
  return [{t: 0, p: st}, {t: 0.14, p: jolt, ease: 'snap'}, {t: 0.62, p: kneel, ease: 'in'}, {t: 0.95, p: kneel, ease: 'linear'}, {t: 1.35, p: tip, ease: 'in'}, {t: 1.62, p: prone, ease: 'in'}, {t: 1.8, p: prone, ease: 'out'}];
}

/** Treadmill gait (as zombie/lib/clips.mjs footCycle). */
function footCycle(phase, {beta, stride, lift, pitchOff = 26, pitchStrike = -4}) {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < beta) { const s = ph / beta; return {z: stride / 2 - stride * s, lift: 0, pitch: lerp(pitchStrike, 0, ss(0, 0.15, s)) + pitchOff * ss(0.7, 1, s)}; }
  const s = (ph - beta) / (1 - beta);
  return {z: -stride / 2 + stride * (s * s * (3 - 2 * s)), lift: Math.max(0, lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 1.2)), pitch: lerp(pitchOff, pitchStrike, ss(0.15, 0.85, s))};
}
export const RUN_GAIT = {beta: 0.3, lift: 0.24};
function run(rig, t, T) {
  const S = SIREN_CLIPS.Run, beta = RUN_GAIT.beta, stride = S.groundSpeed * beta * T;
  const w = TAU * t / T;
  const fl = footCycle(t / T, {beta, stride, lift: RUN_GAIT.lift}), fr = footCycle(t / T + 0.5, {beta, stride, lift: RUN_GAIT.lift});
  const bob = 0.035 * Math.cos(2 * w + 0.4);
  const P0 = {hips: [0.03 * Math.sin(w - 0.5), -0.15 + bob, 0.06], hipsRot: [26, 9 * Math.sin(w), -4 * Math.sin(w)], spine: [10, -7 * Math.sin(w), 2 * Math.sin(w)], chest: [8 + 3 * Math.cos(2 * w), -8 * Math.sin(w), -3 * Math.sin(w)],
    neck: [-18, 5 * Math.sin(w), 0], head: [-16 + 4 * Math.cos(2 * w), -5 * Math.sin(w), 0],
    legL: {mode: 'ik', z: fl.z, x: 0.01, lift: fl.lift, pitch: fl.pitch, yaw: 4}, legR: {mode: 'ik', z: fr.z, x: 0.01, lift: fr.lift, pitch: fr.pitch, yaw: -4}};
  // claws reach forward, pumping opposite to the legs
  const sw = Math.sin(w);
  return realize(rig, key(P0,
    {dirW: [0.38, -0.35 + 0.35 * sw, 0.80 - 0.25 * sw], flexW: [-0.4, 0.6, 0.5], flex: 32 + 14 * sw, wristSide: -10},
    {dirW: [0.38, -0.35 - 0.35 * sw, 0.80 + 0.25 * sw], flexW: [-0.4, 0.6, 0.5], flex: 32 - 14 * sw, wristSide: -10}));
}

export function evalClip(rig, name, t, ctx = {}) {
  const T = SIREN_CLIPS[name].duration;
  switch (name) {
    case 'Dormant': return dormant(rig, t, T, ctx);
    case 'Rise': return keyed(rig, groundedKeys('Rise', riseKeys, ctx), t);
    case 'Run': return run(rig, t, T);
    case 'Attack': return keyed(rig, groundedKeys('Attack', attackKeys, ctx), t);
    case 'Hit': return keyed(rig, groundedKeys('Hit', hitKeys, ctx), t);
    case 'Death': return keyed(rig, groundedKeys('Death', deathKeys, ctx), t);
  }
  throw new Error('unknown Siren clip ' + name);
}

/** Sample a clip into tracks (loops get an exact copy of frame 0 at t = T). */
export function sampleClip(rig, name, ctx = {}) {
  const S = SIREN_CLIPS[name];
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
  return {name, duration: S.duration, loop: S.loop, times, rot, hips, maxLegReach: +maxReach.toFixed(4), ...(S.groundSpeed ? {groundSpeed: S.groundSpeed} : {}), ...(S.impactTime ? {impactTime: S.impactTime} : {})};
}

export const poseAtFrame = (c, f) => ({hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))});
