// Hand-authored procedural keyframe clips for the quadruped (not mocap, not a humanoid turned
// sideways). Locomotion plants each paw with the leg IK on a stance/swing cycle per leg:
//   Walk  4-beat lateral-sequence walk (LH, LF, RH, RF at 0, .25, .5, .75 of the cycle), duty .62,
//         bobbing hips, alternating spine side-bend, counter-swinging head, lagging tail wave.
//   Run   rotary gallop / lope (LH, RH, RF, LF), duty .3, gathered suspension, spine flexion and
//         extension, head counter-pitch, mouth a little open, tail streaming.
//   Idle  breathing, slow look-around and sniffing, tail sway, all four paws planted.
//   Attack crouch -> lunge with both forepaws reaching -> jaw snaps shut at IMPACT -> head shake -> recover.
//   Hit   flinch: body curls away, head jerks, tail tucks, paws stay planted.
//   Death stagger, legs buckle, roll onto the right side; final hips height solved so the lowest
//         skinned vertex rests 1 cm above the floor.
// Ground speeds (m/s at timeScale 1) are derived from the stride numbers below and written into
// the GLB extras / provenance; the runtime scales playback to the actual ground speed.
import {qId, qAxis, qMul, V} from './rig.mjs';
import {euler, qSlerp} from '../../zombie/lib/pose.mjs';
import {LEGS} from './rig.mjs';

export const FPS = 30;
const TAU = Math.PI * 2;
const ss = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export const GAITS = {
  Walk: {T: 0.62, duty: 0.62, S: {front: 0.22, hind: 0.24}, lift: {front: 0.055, hind: 0.05}, phase: {L_Hind: 0, L_Front: 0.25, R_Hind: 0.5, R_Front: 0.75},
    bias: {front: -0.012, hind: -0.01}, crouch: -0.034, swingPitch: {front: 55, hind: 35}, pushPitch: {front: 16, hind: 14}},
  Run: {T: 0.42, duty: 0.3, S: {front: 0.28, hind: 0.34}, lift: {front: 0.09, hind: 0.085}, phase: {L_Hind: 0, R_Hind: 0.09, R_Front: 0.44, L_Front: 0.53},
    bias: {front: -0.045, hind: -0.01}, crouch: -0.07, swingPitch: {front: 62, hind: 45}, pushPitch: {front: 26, hind: 24}},
};
export const groundSpeed = g => +(((g.S.front + g.S.hind) / 2) / (g.duty * g.T)).toFixed(3);

/** Foot params for a leg at cycle phase f (0..1; stance first). */
function gaitFoot(g, L, f) {
  const end = L.includes('Front') ? 'front' : 'hind';
  const S = g.S[end], duty = g.duty;
  f = ((f % 1) + 1) % 1;
  if (f < duty) {
    const s = f / duty;
    return {dz: g.bias[end] + S / 2 - S * s, lift: 0, pitch: g.pushPitch[end] * ss((s - 0.72) / 0.28)};
  }
  const t = (f - duty) / (1 - duty);
  const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
  return {dz: g.bias[end] - S / 2 + S * e, lift: g.lift[end] * Math.pow(Math.sin(Math.PI * t), 0.85), pitch: g.swingPitch[end] * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - 0.35 * t) + g.pushPitch[end] * (1 - ss(t / 0.25))};
}

const E = (x = 0, y = 0, z = 0) => euler(x, y, z);

function plantAll(rig, pose, feet = {}) {
  const rep = {};
  for (const L of LEGS) rep[L] = rig.legIK(pose, L, {y: 0.012, ...(feet[L] || {})});
  return rep;
}

function tailWave(rot, t, {amp = 8, pitch = 0, freq = 1, lag = 0.6, droop = 0, pitchAmp = 0}) {
  for (let k = 1; k <= 5; k++) rot['Tail' + k] = E(pitch * (k === 1 ? 1 : 0.4) + droop * (k / 5) + pitchAmp * Math.sin(TAU * freq * t - k * lag + 1), amp * Math.sin(TAU * freq * t - k * lag) * (0.6 + 0.12 * k), 0);
}

// ------------------------------------------------------------------------------------------------
export const CLIP_SPECS = {
  Idle: {duration: 4.0, loop: true, pose(rig, t) {
    const b = Math.sin(TAU * t / 2.0); // breathing ~2 s
    const look = Math.sin(TAU * t / 4.0), sniff = Math.max(0, Math.sin(TAU * t / 1.0 * 3)) * ss((t - 1.4) / 0.2) * (1 - ss((t - 2.2) / 0.2));
    const pose = {hips: [0, -0.016 + 0.003 * b, 0], rot: {}};
    pose.rot.Spine1 = E(0.6 * b, 0, 0);
    pose.rot.Spine2 = E(0.8 * b, 0, 0);
    pose.rot.Chest = E(-0.8 * b, 2 * look, 0);
    pose.rot.Neck = E(4 + 3 * sniff, 7 * look, 0);
    pose.rot.Head = E(-2 + 4 * sniff - 2 * Math.sin(TAU * t / 4 + 1), 9 * look, 2 * look);
    pose.rot.Jaw = E(1.5 + 1.5 * Math.max(0, b), 0, 0);
    tailWave(pose.rot, t, {amp: 7, freq: 0.5, droop: -4, lag: 0.5});
    pose.ik = plantAll(rig, pose);
    return pose;
  }},

  Walk: {duration: GAITS.Walk.T, loop: true, gait: 'Walk', pose(rig, t) {
    const g = GAITS.Walk, f = t / g.T;
    const pose = {hips: [0.007 * Math.sin(TAU * f), g.crouch + 0.006 * Math.cos(TAU * 2 * f - 0.5), 0], rot: {}};
    pose.rot.Hips = E(0, 2.5 * Math.sin(TAU * f), -1.5 * Math.sin(TAU * f));
    pose.rot.Spine1 = E(0, -1.5 * Math.sin(TAU * f), 0);
    pose.rot.Spine2 = E(0, -1.5 * Math.sin(TAU * f), 0);
    pose.rot.Chest = E(0, -2.5 * Math.sin(TAU * f + 0.4), 1.5 * Math.sin(TAU * f + 0.4));
    pose.rot.Neck = E(5 + 2 * Math.sin(TAU * 2 * f), 2.5 * Math.sin(TAU * f + 0.4), 0);
    pose.rot.Head = E(-3 - 3 * Math.sin(TAU * 2 * f + 0.6), 1.5 * Math.sin(TAU * f), 0);
    pose.rot.Jaw = E(2, 0, 0);
    tailWave(pose.rot, t, {amp: 10, freq: 1 / g.T, droop: 4, lag: 0.7});
    const feet = {};
    for (const L of LEGS) feet[L] = gaitFoot(g, L, f - g.phase[L]);
    pose.feet = feet;
    pose.ik = plantAll(rig, pose, feet);
    return pose;
  }},

  Run: {duration: GAITS.Run.T, loop: true, gait: 'Run', pose(rig, t) {
    const g = GAITS.Run, f = t / g.T;
    // spine: extended while the hind legs push (f ~ 0..0.35), flexed (arched) while gathered (~0.6..0.95)
    const flex = Math.sin(TAU * (f - 0.3));
    const pose = {hips: [0, g.crouch + 0.016 * Math.sin(TAU * (f - 0.15)), 0.012 * flex], rot: {}};
    pose.rot.Hips = E(-5 * flex, 0, 0);
    pose.rot.Spine1 = E(-4 * flex, 0, 0);
    pose.rot.Spine2 = E(2 * flex, 0, 0);
    pose.rot.Chest = E(7 * flex, 0, 0);
    pose.rot.Neck = E(-2 - 6 * flex, 0, 0);
    pose.rot.Head = E(-6 - 4 * flex, 0, 0);
    pose.rot.Jaw = E(10 + 4 * Math.sin(TAU * f), 0, 0);
    tailWave(pose.rot, t, {amp: 6, freq: 1 / g.T, pitch: 8, lag: 0.5, pitchAmp: 6});
    const feet = {};
    for (const L of LEGS) feet[L] = gaitFoot(g, L, f - g.phase[L]);
    pose.feet = feet;
    pose.ik = plantAll(rig, pose, feet);
    return pose;
  }},

  Attack: {duration: 0.9, loop: false, impact: 0.42, pose(rig, t) {
    const crouch = ss(t / 0.2) * (1 - ss((t - 0.22) / 0.12));
    const lunge = ss((t - 0.2) / 0.2) * (1 - ss((t - 0.5) / 0.35));
    const open = ss((t - 0.14) / 0.18) * (1 - ss((t - 0.37) / 0.05));
    const shake = t > 0.42 && t < 0.66 ? Math.sin(TAU * (t - 0.42) / 0.12) * (1 - ss((t - 0.5) / 0.16)) : 0;
    const pose = {hips: [0, -0.02 - 0.04 * crouch - 0.012 * lunge, -0.06 * crouch + 0.14 * lunge], rot: {}};
    pose.rot.Hips = E(4 * crouch - 3 * lunge, 0, 0);
    pose.rot.Spine1 = E(-6 * crouch + 2 * lunge, 0, 0);
    pose.rot.Spine2 = E(-4 * crouch + 3 * lunge, 0, 0);
    pose.rot.Chest = E(8 * crouch - 6 * lunge, 5 * shake, 0);
    pose.rot.Neck = E(12 * crouch - 14 * lunge, 8 * shake, 0);
    pose.rot.Head = E(6 * crouch - 6 * lunge - 6 * open, 14 * shake, 10 * shake);
    pose.rot.Jaw = E(3 + 34 * open, 0, 0);
    tailWave(pose.rot, t, {amp: 4, freq: 1.5, pitch: 8 * lunge - 6 * crouch, lag: 0.4});
    // forepaws reach with the lunge and land ahead; hind paws push but stay planted
    const reach = ss((t - 0.22) / 0.18), land = ss((t - 0.4) / 0.06), back = ss((t - 0.6) / 0.28);
    const fz = lerp(0, 0.15, reach) * (1 - back) + 0.14 * lunge * 0, lift = 0.09 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.22) / 0.2))) * (1 - land);
    const feet = {
      L_Front: {dz: fz, lift, pitch: 40 * lift / 0.09}, R_Front: {dz: fz - 0.02 * reach * (1 - back), lift: lift * 0.9, pitch: 36 * lift / 0.09},
      L_Hind: {dz: 0.04 * lunge, pitch: 22 * lunge}, R_Hind: {dz: 0.03 * lunge, pitch: 20 * lunge},
    };
    pose.feet = feet;
    pose.ik = plantAll(rig, pose, feet);
    return pose;
  }},

  Hit: {duration: 0.45, loop: false, pose(rig, t) {
    const k = ss(t / 0.06) * (1 - ss((t - 0.12) / 0.33));
    const pose = {hips: [0.018 * k, -0.016 - 0.02 * k, -0.015 * k], rot: {}};
    pose.rot.Hips = E(0, 0, 4 * k);
    pose.rot.Spine1 = E(-3 * k, 6 * k, 0);
    pose.rot.Spine2 = E(-3 * k, 6 * k, 0);
    pose.rot.Chest = E(4 * k, 7 * k, -2 * k);
    pose.rot.Neck = E(-10 * k, 12 * k, 0);
    pose.rot.Head = E(-12 * k, 16 * k, 8 * k);
    pose.rot.Jaw = E(4 + 16 * k, 0, 0);
    tailWave(pose.rot, t, {amp: 3, freq: 2, pitch: -16 * k, droop: -10 * k, lag: 0.3});
    const feet = {L_Front: {dz: -0.02 * k, pitch: 6 * k}, R_Front: {dz: -0.01 * k, pitch: 4 * k}, L_Hind: {dx: 0.01 * k}, R_Hind: {pitch: 10 * k}};
    pose.feet = feet;
    pose.ik = plantAll(rig, pose, feet);
    return pose;
  }},

  Death: {duration: 1.5, loop: false, pose(rig, t, ctx) {
    const fin = ctx?.deathFinal ?? {hipsY: -0.24, hipsX: -0.06};
    const stag = ss(t / 0.18) * (1 - ss((t - 0.3) / 0.2));
    const buckle = ss((t - 0.12) / 0.35);
    const roll = ss((t - 0.3) / 0.55);
    const settle = ss((t - 0.85) / 0.5);
    const drop = ss((t - 0.5) / 0.55);
    const pose = {hips: [fin.hipsX * roll, lerp(-0.06 * buckle, fin.hipsY, drop), -0.03 * buckle], rot: {}};
    pose.rot.Hips = E(3 * buckle, 0, 84 * roll);
    pose.rot.Spine1 = E(-4 * buckle, -1.5 * roll, 0);
    pose.rot.Spine2 = E(-3 * buckle, -1.5 * roll, 0);
    pose.rot.Chest = E(-12 * stag + 4 * buckle, -2 * roll, -3 * roll);
    pose.rot.Neck = E(-22 * stag + 10 * buckle - 8 * roll, -3 * roll, -4 * roll);
    pose.rot.Head = E(-18 * stag + 6 * buckle - 4 * roll, -4 * roll * (1 + 0.5 * settle), -8 * roll);
    pose.rot.Jaw = E(6 + 22 * stag + 6 * settle, 0, 0);
    for (let k = 1; k <= 5; k++) pose.rot['Tail' + k] = E(-5 * buckle - 6 * roll * (k / 5), -8 * roll * (k / 5), 0);
    // legs: buckle under the body while still standing, then go limp and splay (no planting)
    if (roll < 0.02) {
      const feet = {};
      for (const L of LEGS) feet[L] = {dz: L.includes('Front') ? 0.04 * buckle : -0.03 * buckle, dx: 0.03 * buckle, pitch: 25 * buckle};
      pose.ik = plantAll(rig, pose, feet);
    } else {
      const k = roll;
      // the legs that end up underneath (right side) fold while the body rolls, then go limp
      const fold = Math.sin(Math.PI * Math.min(1, k * 1.1));
      for (const L of LEGS) {
        const front = L.includes('Front'), sg = L[0] === 'L' ? 1 : -1, under = sg < 0 ? 1 : 0.35;
        pose.rot[L + 'Upper'] = E(front ? -18 * k - 30 * fold * under : 22 * k + 34 * fold * under, 0, -sg * 6 * k);
        pose.rot[L + 'Lower'] = E(front ? 20 * k + 55 * fold * under : -24 * k - 60 * fold * under, 0, 0);
        pose.rot[L + 'Foot'] = E(28 * k + 30 * fold * under, 0, 0);
      }
    }
    return pose;
  }},
};

/** Sample a clip into per-joint quaternion tracks + hips translation track. */
export function sampleClip(rig, name, ctx = {}) {
  const spec = CLIP_SPECS[name];
  const n = Math.max(2, Math.round(spec.duration * FPS) + 1);
  const times = [], hips = [], rot = {}, ik = [];
  const names = rig.names.filter(j => j !== 'Root');
  for (const j of names) rot[j] = [];
  for (let i = 0; i < n; i++) {
    let t = i / FPS;
    if (i === n - 1) t = spec.duration;
    const pose = spec.pose(rig, spec.loop ? t % spec.duration : t, ctx);
    times.push(+t.toFixed(5));
    hips.push(pose.hips || [0, 0, 0]);
    for (const j of names) rot[j].push(pose.rot[j] || qId());
    if (pose.ik) ik.push(Object.fromEntries(Object.entries(pose.ik).map(([k, v]) => [k, v.reach])));
  }
  // continuity: loop clips end exactly where they start
  if (spec.loop) { for (const j of names) rot[j][n - 1] = rot[j][0]; hips[n - 1] = hips[0]; }
  // hemisphere continuity for linear quaternion interpolation
  for (const j of names) for (let i = 1; i < n; i++) { const a = rot[j][i - 1], b = rot[j][i]; if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) rot[j][i] = b.map(v => -v); }
  const maxReach = ik.length ? Math.max(...ik.flatMap(r => Object.values(r))) : null;
  return {name, times, hips, rot, loop: !!spec.loop, duration: spec.duration, impact: spec.impact ?? null, gait: spec.gait ?? null,
    groundSpeed: spec.gait ? groundSpeed(GAITS[spec.gait]) : 0, maxLegReach: maxReach === null ? null : +maxReach.toFixed(3)};
}

export function poseAtFrame(clip, f) {
  return {hips: clip.hips[f], rot: Object.fromEntries(Object.entries(clip.rot).map(([k, v]) => [k, v[f]]))};
}

void qAxis; void qMul; void V; void qSlerp;
