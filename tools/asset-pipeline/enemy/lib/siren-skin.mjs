// Task track1-siren-blightbelly-20261031 (lane RIGS): skin weights for the appearance-locked Siren, computed on welded
// game-space ANALYSIS copies and spread back onto the UNCHANGED native vertices (per native vertex: JOINTS_0 / WEIGHTS_0 only).
//  - body: the shared zombie skinning (zombie/lib/skin.mjs computeSkinWeights: region flood, chain weights, masked Laplacian
//    smoothing, top-4) on the estimated skeleton, unchanged; then a HAIR post-pass: hair vertices (base-colour luminance mask)
//    never take arm weights (strands hanging beside the shoulders would otherwise swing with the arms) — their arm share is
//    replaced by the weights of the nearest non-hair torso vertex;
//  - dress: the shared closest-point transfer (skin.mjs transferWeights: barycentric body weights, Head -> Neck, centre-faded
//    skirt rule below the crotch, masked smoothing).
// Welding is by exact native position (UV-seam duplicates get identical weights, so seams never tear).
import {MeshoptSimplifier} from 'meshoptimizer';
import {computeSkinWeights, transferWeights, JOINT_NAMES} from '../../zombie/lib/skin.mjs';
import {buildGrid} from '../../zombie/lib/bake.mjs';
import {normalizeAll} from '../../zombie/lib/mesh.mjs';

const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const ARM = new Set(['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'].map(n => JI[n]));

/** Weld by exact position: {welded: {pos, nrm, idx}, map: native vertex -> welded vertex}. */
export async function weld(pos, nrm, idx) {
  await MeshoptSimplifier.ready;
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3, id = new Int32Array(n).fill(-1);
  let c = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) id[i] = c++;
  const map = new Uint32Array(n), P = new Float32Array(c * 3), N = new Float32Array(c * 3);
  for (let i = 0; i < n; i++) {
    const r = id[remap[i]]; map[i] = r;
    if (remap[i] === i) P.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], r * 3);
    N[r * 3] += nrm[i * 3]; N[r * 3 + 1] += nrm[i * 3 + 1]; N[r * 3 + 2] += nrm[i * 3 + 2];
  }
  normalizeAll(N);
  const I = [];
  for (let t = 0; t < idx.length; t += 3) { const a = map[idx[t]], b = map[idx[t + 1]], d = map[idx[t + 2]]; if (a !== b && b !== d && a !== d) I.push(a, b, d); }
  return {welded: {pos: P, nrm: N, idx: Uint32Array.from(I)}, map};
}

export function rigDescriptor(skel) {
  return {joints: skel.joints, ends: skel.ends, cut: skel.cut, wall: skel.wall, crotchY: skel.crotchY, hipY: skel.hipY, neckY: skel.neckY, headY: skel.headY, kneeY: skel.kneeY, ankleY: skel.ankleY};
}

/**
 * Body weights on the welded mesh. hairW: per welded vertex hair flag (0/1) or null.
 * Returns {joints, weights, region, stats} on welded vertices.
 */
export function bodyWeights(welded, skel, hairW = null, opts = {}) {
  const sw = computeSkinWeights(welded, rigDescriptor(skel), {kind: 'body', smoothIters: opts.smoothIters ?? 4, smoothLambda: opts.smoothLambda ?? 0.5});
  let hairFixed = 0, hairArmVerts = 0;
  if (hairW) {
    const P = welded.pos, n = P.length / 3;
    // nearest non-hair TORSO-region vertex (spatial hash) for hair rows that carried arm weights
    const cell = 0.03, grid = new Map();
    for (let i = 0; i < n; i++) if (!hairW[i] && sw.region[i] === 0) { const k = `${Math.floor(P[i * 3] / cell)},${Math.floor(P[i * 3 + 1] / cell)},${Math.floor(P[i * 3 + 2] / cell)}`; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); }
    const near = i => {
      const c = [0, 1, 2].map(k => Math.floor(P[i * 3 + k] / cell)); let best = -1, bd = Infinity;
      for (let r = 1; r <= 6 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const a = grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`); if (!a) continue;
        for (const j of a) { const d = (P[j * 3] - P[i * 3]) ** 2 + (P[j * 3 + 1] - P[i * 3 + 1]) ** 2 + (P[j * 3 + 2] - P[i * 3 + 2]) ** 2; if (d < bd) { bd = d; best = j; } }
      }
      return best;
    };
    for (let i = 0; i < n; i++) {
      if (!hairW[i]) continue;
      let arm = 0; for (let k = 0; k < 4; k++) if (ARM.has(sw.joints[i * 4 + k])) arm += sw.weights[i * 4 + k];
      if (arm <= 0) continue;
      hairArmVerts++;
      const j = near(i); if (j < 0) continue;
      for (let k = 0; k < 4; k++) { sw.joints[i * 4 + k] = sw.joints[j * 4 + k]; sw.weights[i * 4 + k] = sw.weights[j * 4 + k]; }
      // the nearest torso vertex may itself carry a shoulder (UpperArm) share: strip it and renormalise
      let s = 0; for (let k = 0; k < 4; k++) { if (ARM.has(sw.joints[i * 4 + k])) sw.weights[i * 4 + k] = 0; s += sw.weights[i * 4 + k]; }
      if (s <= 1e-6) { sw.joints.fill(0, i * 4, i * 4 + 4); sw.joints[i * 4] = JI.Chest; sw.weights.fill(0, i * 4, i * 4 + 4); sw.weights[i * 4] = 1; }
      else {
        // renormalise; sort the row (largest first, emptied slots last) and put the float residual on the largest weight
        const row = [0, 1, 2, 3].map(k => [sw.weights[i * 4 + k] / s, sw.joints[i * 4 + k]]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        row.forEach(([w, j], k) => { sw.weights[i * 4 + k] = w; sw.joints[i * 4 + k] = w > 0 ? j : 0; });
        sw.weights[i * 4] += 1 - (sw.weights[i * 4] + sw.weights[i * 4 + 1] + sw.weights[i * 4 + 2] + sw.weights[i * 4 + 3]);
      }
      hairFixed++;
    }
  }
  return {...sw, stats: {...sw.stats, hair: hairW ? {hairVertices: hairW.reduce((a, b) => a + b, 0), hairVerticesWithArmWeights: hairArmVerts, reassignedFromNearestTorsoVertex: hairFixed, rule: 'hair never takes arm weights: rows with any arm share copy the nearest non-hair torso vertex, arm share stripped, renormalised'} : null}};
}

/**
 * Dress weights (welded dress in game space) by closest-point transfer from the welded body.
 * opts.mode: 'rule' (shared skirt rule below the crotch: Hips + partial thigh follow), 'legs' (closest leg point everywhere;
 * opts.skirt false), or 'legs-thigh' ('legs', then shin / foot influences moved to the thigh of the same side: the skirt follows
 * the thighs, never the shins — in kneeling poses the shins lie face-down on the floor and would carry the hem under it).
 */
export function dressWeights(dressWelded, bodyWelded, bodyW, skel, opts = {}) {
  const mode = opts.mode ?? (opts.skirt === false ? 'legs' : 'rule');
  const tw = transferWeights(dressWelded, bodyWelded, bodyW, rigDescriptor(skel), {thighMax: opts.thighMax ?? 0.45, smoothIters: opts.smoothIters ?? 3, skirt: mode === 'rule', grid: buildGrid(bodyWelded.pos, bodyWelded.idx, 0.03)});
  let remapped = 0;
  if (mode === 'legs-thigh') {
    const n = tw.joints.length / 4;
    for (let i = 0; i < n; i++) {
      const row = new Map();
      for (let k = 0; k < 4; k++) {
        let j = tw.joints[i * 4 + k]; const w = tw.weights[i * 4 + k]; if (!w) continue;
        const nm = JOINT_NAMES[j];
        if (/_(Shin|Foot)$/.test(nm)) { j = JI[nm.slice(0, 2) + 'Thigh']; remapped++; }
        row.set(j, (row.get(j) ?? 0) + w);
      }
      const e = [...row.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      for (let k = 0; k < 4; k++) { tw.joints[i * 4 + k] = e[k]?.[0] ?? 0; tw.weights[i * 4 + k] = e[k]?.[1] ?? 0; }
    }
  }
  // sleeveless garment (opts.noArms, default true): arm-chain influences (picked up where the strap rests just outside the
  // shoulder joint) move to Chest — otherwise the strap / neckline swings off the body whenever the T-pose arms come down
  let armRows = 0;
  if (opts.noArms ?? true) {
    const n = tw.joints.length / 4;
    for (let i = 0; i < n; i++) {
      let moved = 0;
      for (let k = 0; k < 4; k++) if (ARM.has(tw.joints[i * 4 + k]) && tw.weights[i * 4 + k] > 0) { moved += tw.weights[i * 4 + k]; tw.weights[i * 4 + k] = 0; }
      if (!moved) continue;
      armRows++;
      let slot = -1;
      for (let k = 0; k < 4; k++) if (tw.joints[i * 4 + k] === JI.Chest && tw.weights[i * 4 + k] > 0) slot = k;
      if (slot < 0) for (let k = 0; k < 4; k++) if (tw.weights[i * 4 + k] === 0) { slot = k; break; }
      tw.joints[i * 4 + slot] = JI.Chest; tw.weights[i * 4 + slot] += moved;
    }
  }
  return {...tw, stats: {...tw.stats, mode, ...(mode === 'legs-thigh' ? {shinFootInfluencesMovedToThigh: remapped} : {}), sleeveless: opts.noArms ?? true, rowsWithArmWeightMovedToChest: armRows}};
}

/** Welded weights -> native vertices. */
export function spread(map, w) {
  const n = map.length, joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = map[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = w.joints[s * 4 + k]; weights[i * 4 + k] = w.weights[s * 4 + k]; } }
  return {joints, weights};
}

/** Weight sanity: every row sums to 1 (float) and joints are in range. */
export function weightStats(w, nJoints = JOINT_NAMES.length) {
  const n = w.joints.length / 4; let maxErr = 0, bad = 0;
  for (let i = 0; i < n; i++) {
    let s = 0; for (let k = 0; k < 4; k++) { s += w.weights[i * 4 + k]; if (w.joints[i * 4 + k] >= nJoints || w.weights[i * 4 + k] < 0) bad++; }
    maxErr = Math.max(maxErr, Math.abs(s - 1));
  }
  return {vertices: n, maxSumError: +maxErr.toExponential(2), badEntries: bad};
}
