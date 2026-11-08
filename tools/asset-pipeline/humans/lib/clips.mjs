// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): HEALTHY procedural clips for the friendly market humans (NOT the
// zombie clips, NOT mocap). Same machinery as zombie/lib/clips.mjs (imported, unchanged): parameter sets realized through the shared
// 18-joint Rig (zombie/lib/pose.mjs: FK, 2-bone leg IK with foot roll, arm aiming by (direction, hinge)), sampled per body with its own
// joint positions into joint rotation tracks + a Hips translation track.
//
// Posture: upright (no stoop, no head droop / tilt), knees soft, arms hanging relaxed at the sides; nothing reaches, limps, lurches.
//   Idle  - relaxed standing: breathing, slow weight shift between the feet, an occasional look around.
//   Walk  - a natural healthy gait at ~1.3 m/s: treadmill stance (the stance foot slides back at exactly the ground speed), heel
//           strike -> flat -> heel rise, pelvis rotation / sway / bob, counter-rotating shoulders, opposite arm swing. The stride is
//           fitted to each body's leg length (walkGait) so the leg IK never over-reaches.
//   Talk  - the trader's idle: weight on one leg, open-hand gestures at waist height, nods.
//   Greet - one-shot wave (the trade lane's onTalk greeting).
//   Work  - standing at a work top: slight forward lean, both hands busy at waist height.
//   Sit   - sitting on the floor, knees up, forearms resting on the knees (hips / shins solved per body against its own mesh).
import {realize, FPS} from '../../zombie/lib/clips.mjs';
import {qId} from '../../zombie/lib/pose.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {JOINT_NAMES} from '../../zombie/lib/skin.mjs';

const TAU = Math.PI * 2;
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const mirrorDir = d => [-d[0], d[1], d[2]];
const mirrorAxis = h => [h[0], -h[1], -h[2]];
/** Mirror an arm preset to the other side (as zombie/lib/clips.mjs mirrorArm). */
const mirrorArm = a => ({...a, dir: mirrorDir(a.dir), hinge: mirrorAxis(a.hinge), twist: -(a.twist || 0), wristSide: -(a.wristSide || 0)});

/** Relaxed hanging arm (left; Chest frame): close to the thigh, elbow soft, palm toward the leg (humerus ~25 deg internally rotated). */
const ARM_REST = {dir: [0.11, -0.985, 0.05], hinge: [-0.92, 0, -0.38], flex: 12, wrist: -4, twist: 0, wristSide: 0};

export function humanBasePose() {
  return {
    hips: [0, -0.008, 0], hipsRot: [0, 0, 0],
    spine: [1, 0, 0], chest: [1, 0, 0], neck: [2, 0, 0], head: [-2, 0, 0],
    armL: {...ARM_REST}, armR: mirrorArm({...ARM_REST}),
    legL: {mode: 'ik', z: 0, x: 0, lift: 0, pitch: 0, yaw: 5}, legR: {mode: 'ik', z: 0, x: 0, lift: 0, pitch: 0, yaw: -5},
  };
}

// ---------------------------------------------------------------- loops
function idle(rig, t, T) {
  const P = humanBasePose();
  const w = TAU * t / T, br = TAU * t / (T / 1); // one breath per loop (4 s), weight shift once per loop
  const shift = Math.sin(w);
  P.hips = [0.012 * shift, -0.008 - 0.004 * Math.abs(shift), 0.003 * Math.sin(w + 1)];
  P.hipsRot = [0.6 * Math.sin(br), 1.5 * Math.sin(w + 0.5), -1.6 * shift];
  P.spine = [1 + 0.5 * Math.sin(br + 0.3), -0.8 * Math.sin(w + 0.5), 0.9 * shift];
  P.chest = [1 + 1.1 * Math.sin(br + 0.8), -0.6 * Math.sin(w + 0.5), 0.6 * shift];
  P.neck = [2 + 0.8 * Math.sin(br + 1.2), 3 * Math.sin(w * 2 + 0.4) * ss(0.3, 0.7, 0.5 + 0.5 * Math.sin(w)), 0];
  P.head = [-2 + 1.5 * Math.sin(br + 1.6), 9 * Math.sin(w + 2.2), 1.2 * Math.sin(w + 0.9)];
  // the weighted leg stays straighter; the other knee softens a little (feet planted)
  P.legL = {...P.legL, lift: 0, z: 0.004 * Math.sin(w)}; P.legR = {...P.legR, z: -0.004 * Math.sin(w)};
  P.armL = {...P.armL, dir: [0.11 + 0.012 * Math.sin(br + 0.5), -0.985, 0.05 + 0.02 * Math.sin(w + 0.4)], flex: 12 + 3 * Math.sin(br)};
  P.armR = mirrorArm({...ARM_REST, dir: [0.11 + 0.012 * Math.sin(br + 2.1), -0.985, 0.05 + 0.02 * Math.sin(w + 2.4)], flex: 13 + 3 * Math.sin(br + 1.3)});
  return realize(rig, P);
}

/** Treadmill foot: stance slides back at ground speed (heel strike -> flat -> heel rise); swing returns it forward. */
function humanFoot(phase, {beta, stride, center, lift}) {
  const ph = ((phase % 1) + 1) % 1;
  if (ph < beta) {
    const s = ph / beta;
    return {z: center + stride / 2 - stride * s, lift: 0, pitch: lerp(-12, 0, ss(0, 0.18, s)) + 24 * ss(0.62, 1, s)};
  }
  const s = (ph - beta) / (1 - beta);
  const e = s * s * (3 - 2 * s);
  return {z: center - stride / 2 + stride * e, lift: lift * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.1)), 1.3), pitch: lerp(24, -12, ss(0.05, 0.9, s)) + 8 * Math.sin(Math.PI * s)};
}

/**
 * Walk parameters of a body (see walkGait): T loop duration, beta stance fraction, stride = foot excursion over the stance,
 * center = its forward offset, drop = pelvis lowering, swing = arm swing (deg).
 */
function walk(rig, t, G) {
  const P = humanBasePose();
  const w = TAU * t / G.T;
  const fl = humanFoot(t / G.T, G), fr = humanFoot(t / G.T + 0.5, G);
  P.hips = [0.016 * Math.sin(w), -G.drop - 0.011 * Math.cos(2 * w), 0];
  // pelvis: the swing-side hip comes forward (yaw), drops a little on the swing side (roll); slight forward lean when walking
  P.hipsRot = [3, -5 * Math.cos(w), 2.2 * Math.sin(w)];
  P.spine = [2, 2 * Math.cos(w), -1.2 * Math.sin(w)];
  P.chest = [2 + 0.6 * Math.cos(2 * w), 4.5 * Math.cos(w), -0.8 * Math.sin(w)];
  P.neck = [1, -0.8 * Math.cos(w), 0];
  P.head = [-1 + 0.8 * Math.cos(2 * w), -1.2 * Math.cos(w), 0];
  // arms swing opposite to the legs: at phase 0 (left heel strike) the right arm is forward
  const a = G.swing * Math.PI / 180;
  const arm = ang => ({...ARM_REST, dir: [0.11, -Math.cos(ang), Math.sin(ang) + 0.03], flex: 14 + 18 * Math.max(0, Math.sin(ang)) / Math.sin(a)});
  P.armL = arm(-a * Math.cos(w));
  P.armR = mirrorArm(arm(a * Math.cos(w)));
  P.legL = {mode: 'ik', z: fl.z, x: 0, lift: fl.lift, pitch: fl.pitch, yaw: 5};
  P.legR = {mode: 'ik', z: fr.z, x: 0, lift: fr.lift, pitch: fr.pitch, yaw: -5};
  return realize(rig, P);
}

function talk(rig, t, T) {
  const P = humanBasePose();
  const w = TAU * t / T;
  // weight on the left leg, right knee soft
  P.hips = [0.018, -0.012, 0];
  P.hipsRot = [0, 4 + 2 * Math.sin(w), -2.5];
  P.spine = [1, -2 + 1.5 * Math.sin(w + 0.5), 1.4];
  P.chest = [1.5 + 0.8 * Math.sin(2 * w), -2 + 3 * Math.sin(w + 1), 0.8];
  // nods on the beats, a turn toward the listener and back
  P.neck = [2 + 2.5 * Math.sin(3 * w), 3 * Math.sin(w + 0.3), 0];
  P.head = [-2 + 3.5 * Math.max(0, Math.sin(3 * w + 0.6)), 6 * Math.sin(w + 0.8), 2 * Math.sin(w)];
  P.legL = {...P.legL, z: 0.02}; P.legR = {...P.legR, z: -0.05, x: 0.03, yaw: -14};
  // right hand: open-palm gestures at waist height (two beats per loop); left hand joins on the second half
  const g = 0.5 + 0.5 * Math.sin(2 * w), both = ss(0.35, 0.55, (t / T)) * (1 - ss(0.85, 1, t / T));
  const gesture = (k, ph) => ({dir: [0.16 + 0.06 * Math.sin(2 * w + ph), -0.78 + 0.05 * k, 0.6], hinge: [-0.97, 0, -0.24], flex: 72 + 14 * k, wrist: -10 + 8 * Math.sin(4 * w + ph), twist: 40, wristSide: -8 * Math.sin(2 * w + ph)});
  P.armR = mirrorArm(gesture(g, 0));
  P.armL = mix(ARM_REST, gesture(0.5 + 0.5 * Math.sin(2 * w + 2.2), 2.2), both);
  return realize(rig, P);
}

/** Linear blend of two arm parameter sets (direction / hinge renormalised by realize). */
function mix(a, b, k) {
  return {dir: lerpV(a.dir, b.dir, k), hinge: lerpV(a.hinge, b.hinge, k), flex: lerp(a.flex, b.flex, k), wrist: lerp(a.wrist || 0, b.wrist || 0, k), twist: lerp(a.twist || 0, b.twist || 0, k), wristSide: lerp(a.wristSide || 0, b.wristSide || 0, k)};
}

function greet(rig, t, T) {
  const P = humanBasePose();
  const e = ss(0, 0.32, t) * (1 - ss(T - 0.42, T, t));
  const wave = Math.sin(TAU * 2.4 * (t - 0.3)) * ss(0.25, 0.45, t) * (1 - ss(T - 0.6, T - 0.35, t));
  P.chest = [1, 4 * e, -1.5 * e];
  P.head = [-2 - 2 * e, 4 * e, 2 * e];
  P.neck = [2 + 3 * Math.max(0, Math.sin(TAU * 1.2 * t)) * e, 0, 0];
  // right arm: upper arm out to the side and a little forward, forearm up, palm forward; the hand waves from the wrist
  const up = {dir: [0.84, -0.22, 0.5], hinge: [0, -0.35, 0.94], flex: 92, wrist: 0, twist: 0, wristSide: 22 * wave};
  P.armR = mirrorArm(mix(ARM_REST, up, e));
  P.armL = {...ARM_REST, flex: 12 + 4 * e};
  return realize(rig, P);
}

function work(rig, t, T) {
  const P = humanBasePose();
  const w = TAU * t / T;
  P.hips = [0.006 * Math.sin(w), -0.02, -0.01];
  P.hipsRot = [6, 2 * Math.sin(w), -1 * Math.sin(w)];
  P.spine = [7, -1.5 * Math.sin(w + 0.4), 0];
  P.chest = [6 + 0.8 * Math.sin(2 * w), -2 * Math.sin(w + 0.6), 0];
  P.neck = [8, 3 * Math.sin(w + 1.3), 0];
  P.head = [8 + 3 * Math.sin(2 * w + 0.5), 4 * Math.sin(w + 1.6), 0];
  P.legL = {...P.legL, z: 0.03, x: 0.02}; P.legR = {...P.legR, z: -0.03, x: 0.02};
  // both hands in front at about 0.95 m (a work top), alternating small movements
  // (upper arms hang ~20 deg forward, elbows ~85 deg: forearms level over the work top, never reaching out)
  const hand = ph => ({dir: [0.15, -0.93 + 0.03 * Math.sin(2 * w + ph), 0.34], hinge: [-0.96, 0, -0.28], flex: 84 + 10 * Math.sin(2 * w + ph), wrist: -16 + 10 * Math.sin(4 * w + ph), twist: 25, wristSide: 6 * Math.sin(2 * w + ph)});
  P.armL = hand(0);
  P.armR = mirrorArm(hand(Math.PI));
  return realize(rig, P);
}

/** Sitting pelvis pitch (deg; tilted back). */
const SIT_PELVIS = -14;

/** Sit on the floor, knees up; `S` = the per-body solve (hips height, knee flexion) from solveSit. */
function sit(rig, t, T, S) {
  const P = humanBasePose();
  const w = TAU * t / T;
  P.hips = [0, S.hipsY, S.hipsZ];
  P.hipsRot = [SIT_PELVIS + 0.5 * Math.sin(w), 0, 0];
  P.spine = [12 + 0.6 * Math.sin(w + 0.4), 0, 0];
  P.chest = [8 + 1.2 * Math.sin(w + 0.9), 1.5 * Math.sin(w * 0.5), 0];
  P.neck = [4, 4 * Math.sin(w * 0.5 + 0.7), 0];
  P.head = [-4 + 1.5 * Math.sin(w + 1.4), 7 * Math.sin(w * 0.5 + 1.1), 0];
  // thighs forward-up and a little apart; shins down to the floor; soles flat (foot = minus the leg pitch)
  const th = S.thigh, kn = S.knee;
  P.legL = {mode: 'fk', thigh: [th, 0, 9], shin: [kn, 0, -4], foot: [-(th + kn) - P.hipsRot[0], 0, 0]};
  P.legR = {mode: 'fk', thigh: [th, 0, -9], shin: [kn, 0, 4], foot: [-(th + kn) - P.hipsRot[0], 0, 0]};
  // hands resting on the thighs toward the knees (upper arms down and a little forward)
  const rest = {dir: [0.2, -0.86, 0.47], hinge: [-0.97, 0, -0.24], flex: 26 + 2 * Math.sin(w), wrist: -14, twist: 15, wristSide: 0};
  P.armL = rest;
  P.armR = mirrorArm(rest);
  return realize(rig, P);
}

/** The healthy clip set (names are the runtime's: market/humanLooks.ts HUMAN_CLIPS). Walk duration comes from the body's gait. */
export const HUMAN_CLIP_SPECS = {
  Idle: {duration: 4.0, loop: true},
  Walk: {duration: null, loop: true},
  Talk: {duration: 5.0, loop: true},
  Greet: {duration: 1.6, loop: false},
  Work: {duration: 3.2, loop: true},
  Sit: {duration: 4.0, loop: true},
};

/** Evaluate a clip; ctx = {gait (walkGait), sit (solveSit)}. */
export function evalHumanClip(rig, name, t, ctx) {
  switch (name) {
    case 'Idle': return idle(rig, t, HUMAN_CLIP_SPECS.Idle.duration);
    case 'Walk': return walk(rig, t, ctx.gait);
    case 'Talk': return talk(rig, t, HUMAN_CLIP_SPECS.Talk.duration);
    case 'Greet': return greet(rig, t, HUMAN_CLIP_SPECS.Greet.duration);
    case 'Work': return work(rig, t, HUMAN_CLIP_SPECS.Work.duration);
    case 'Sit': return sit(rig, t, HUMAN_CLIP_SPECS.Sit.duration, ctx.sit);
  }
  throw new Error('unknown human clip ' + name);
}

export const clipDuration = (name, ctx) => (name === 'Walk' ? ctx.gait.T : HUMAN_CLIP_SPECS[name].duration);

/** Sample a clip into tracks (zombie/lib/clips.mjs sampleClip format); loops get an exact copy of frame 0 at t = T. */
export function sampleHumanClip(rig, name, ctx) {
  const S = HUMAN_CLIP_SPECS[name], D = clipDuration(name, ctx);
  const frames = Math.round(D * FPS);
  const times = [], rot = {}, hips = [];
  const jn = rig.names.filter(n => n !== 'Root');
  for (const n of jn) rot[n] = [];
  let maxReach = 0;
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(D, f / FPS);
    const pose = evalHumanClip(rig, name, S.loop && f === frames ? 0 : t, ctx);
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
  return {name, duration: D, loop: S.loop, times, rot, hips, maxLegReach: +maxReach.toFixed(4)};
}

/**
 * Sit solve against the body's own skinned mesh (body {pos, joints, weights}, float weights): thighs at `thigh` deg; the pelvis
 * height puts the lowest seat vertex (Hips / Thigh dominant) `seat` m above the floor, then the knee flexion puts the lowest foot
 * vertex on the floor (2 mm). Deterministic bisection; the result is recorded in the body manifest.
 */
export function solveSit(rig, skel, mesh, {thigh = -102, seat = 0.012} = {}) {
  const groupOf = j => (/Hips|Thigh/.test(JOINT_NAMES[j]) ? 'seat' : /Foot|Shin/.test(JOINT_NAMES[j]) ? 'foot' : null);
  const groups = Array.from({length: mesh.pos.length / 3}, (_, i) => groupOf(mesh.joints[i * 4]));
  const lowest = S => {
    const P = skinPositions(mesh, skel, rig.fk(sit(rig, 0, HUMAN_CLIP_SPECS.Sit.duration, S)));
    const m = {seat: Infinity, foot: Infinity};
    for (let i = 0; i < groups.length; i++) { const g = groups[i]; if (g && P[i * 3 + 1] < m[g]) m[g] = P[i * 3 + 1]; }
    return m;
  };
  let S = {thigh, knee: 110, hipsY: -(skel.joints.Hips[1] - 0.15), hipsZ: -0.04};
  for (let round = 0; round < 8; round++) {
    // pelvis: seat on the floor (monotone in hipsY)
    let lo = -skel.joints.Hips[1], hi = 0;
    for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (lowest({...S, hipsY: mid}).seat < seat) lo = mid; else hi = mid; }
    S = {...S, hipsY: hi};
    // knee: feet down to the floor. Between a shin pointing forward (20 deg flexion) and a vertical shin the feet descend
    // monotonically: the flexion where the lowest foot vertex touches the floor
    let a = 20, b = -(S.thigh + SIT_PELVIS);
    for (let it = 0; it < 22; it++) { const mid = (a + b) / 2; if (lowest({...S, knee: mid}).foot < 0.002) b = mid; else a = mid; }
    S = {...S, knee: (a + b) / 2};
    // the feet still below the floor with the shins pointing forward: the knees are too low -> steeper thighs (3 deg) and again
    if (lowest(S).foot < -0.001 && S.thigh > -120) S = {...S, thigh: S.thigh - 3};
  }
  const m = lowest(S);
  return {thigh: S.thigh, knee: +S.knee.toFixed(3), hipsY: +S.hipsY.toFixed(4), hipsZ: S.hipsZ, lowestSeatM: +m.seat.toFixed(4), lowestFootM: +m.foot.toFixed(4),
    method: `thighs ${S.thigh} deg (from ${thigh}, raised while the feet could not reach the floor); pelvis height: lowest Hips / Thigh vertex ${seat} m above the floor; knee flexion: lowest Shin / Foot vertex on the floor (bisection, body mesh skinned)`};
}

/**
 * The body's walk: loop T = 1.05 s (114 steps / min), stance 62 %; the stance excursion is the largest (<= 0.9 m, 5 mm steps)
 * whose leg IK reach stays <= `maxReach` of the leg length over the whole cycle (the pelvis drops `drop`). Ground speed =
 * stride / (beta T) (the runtime scales the playback rate to the actual speed).
 */
export function walkGait(rig, {maxReach = 0.99, T = 1.0, drops = [0.045, 0.055], centers = [-0.08, -0.06, -0.04, -0.02, 0]} = {}) {
  let best = null;
  for (const drop of drops) {
    for (const center of centers) {
      const base = {T, beta: 0.62, center, lift: 0.085, drop, swing: 17};
      for (let stride = 0.95; stride >= 0.4; stride -= 0.005) {
        const G = {...base, stride: +stride.toFixed(3)};
        let reach = 0;
        for (let f = 0; f < 40; f++) reach = Math.max(reach, walk(rig, f / 40 * G.T, G).reach || 0);
        if (reach <= maxReach) { if (!best || G.stride > best.stride + 1e-9) best = {...G, maxReach: +reach.toFixed(4)}; break; }
      }
    }
    // the smallest pelvis drop that reaches 1.3 m/s wins (the shallowest knee bend)
    if (best && best.stride / (best.beta * T) >= 1.3) break;
  }
  if (!best) throw new Error('walkGait: no stride fits the leg');
  return {...best, groundSpeed: +(best.stride / (best.beta * best.T)).toFixed(4)};
}
