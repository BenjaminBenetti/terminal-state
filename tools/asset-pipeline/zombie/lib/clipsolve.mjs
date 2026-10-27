// Per-body clip sampling helpers (generalised copies of the build-zombie.mjs functions, which stay
// untouched): death-pose floor-contact solve over N meshes (body + every fitted outfit), clip
// sampling with the body's own rig (same CLIP_SPECS / keyframe functions for every body) and
// CPU-skinning floor verification.
import {JOINT_NAMES} from './skin.mjs';
import {skinPositions} from './glb.mjs';
import {CLIP_SPECS, sampleClip, deathFinal, realize} from './clips.mjs';
import {Rig} from './pose.mjs';

const GROUPS = {head: ['Head', 'Neck'], torso: ['Chest', 'Spine'], pelvis: ['Hips'], armL: ['L_UpperArm', 'L_Forearm', 'L_Hand'], armR: ['R_UpperArm', 'R_Forearm', 'R_Hand'], legL: ['L_Thigh', 'L_Shin', 'L_Foot'], legR: ['R_Thigh', 'R_Shin', 'R_Foot']};
const groupOf = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, js]) => js.map(j => [j, g])));

/** Lowest point per region (dominant joint); outfit meshes reported as 'outfit.<region>' (min over outfits). */
export function regionFloorReport(rig, skel, meshes, pose) {
  const world = rig.fk(pose);
  const out = {};
  for (const m of meshes) {
    const P = skinPositions(m, skel, world);
    const pre = m.name === 'ZombieBody' ? '' : 'outfit.';
    for (let i = 0; i < P.length / 3; i++) {
      const g = groupOf[JOINT_NAMES[m.joints[i * 4]]]; if (!g) continue;
      const key = pre + g;
      out[key] = Math.min(out[key] ?? Infinity, P[i * 3 + 1]);
    }
  }
  for (const k in out) out[k] = +out[k].toFixed(3);
  return out;
}

const DEATH_PARAMS = {hipsPitch: [-95, -80], hipsRoll: [-12, 12], neck: [-35, 10], head: [-30, 10], headYaw: [-80, -20], armLz: [-0.8, 0], armRz: [-0.8, 0], footLz: [0.0, 0.5], footRz: [-0.2, 0.35]};
export function solveDeathPose(rig, skel, meshes) {
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
  let tune = {hipsPitch: -88, hipsRoll: 5, neck: -4, head: -6, headYaw: -38, armLz: -0.3, armRz: -0.3, footLz: 0.42, footRz: 0.12};
  let best = evaluate(tune), step = 0.25;
  for (let round = 0; round < 6; round++) {
    for (const [k, [lo, hi]] of Object.entries(DEATH_PARAMS)) for (const dir of [1, -1]) {
      const cand = {...tune, [k]: Math.min(hi, Math.max(lo, tune[k] + dir * step * (hi - lo)))};
      const r = evaluate(cand);
      if (r.cost < best.cost - 1e-7) { best = r; tune = cand; }
    }
    step /= 2;
  }
  return {tune: Object.fromEntries(Object.entries(tune).map(([k, v]) => [k, +v.toFixed(3)])), hipsY: best.hipsY, cost: best.cost, evals, report: best.rep};
}

/** Lowest skinned vertex per frame for each mesh set (body alone and body + each outfit). */
export function verifyClips(rig, skel, sets, clips) {
  const out = {};
  for (const c of clips) {
    const row = {};
    for (const [label, meshes] of Object.entries(sets)) {
      let lo = Infinity, iLo = 0, below = 0;
      for (let f = 0; f < c.times.length; f++) {
        const pose = {hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))};
        const world = rig.fk(pose);
        let m = Infinity;
        for (const mesh of meshes) { const P = skinPositions(mesh, skel, world); for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; }
        if (m < lo) { lo = m; iLo = f; }
        if (m < -0.01) below++;
      }
      row[label] = {minY: +lo.toFixed(4), atT: c.times[iLo], framesBelowMinus1cm: below};
    }
    out[c.name] = {maxLegReach: c.maxLegReach, ...row};
  }
  return out;
}

/** Build the body's rig, solve the death pose against all meshes, sample every clip. */
export function sampleBodyClips(skel, meshes) {
  const rig = new Rig(skel);
  const death = solveDeathPose(rig, skel, meshes);
  const deathContact = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(death.hipsY, death.tune)));
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, {deathHipsY: death.hipsY, deathTune: death.tune}));
  return {rig, death: {...death, contact: deathContact}, clips};
}
