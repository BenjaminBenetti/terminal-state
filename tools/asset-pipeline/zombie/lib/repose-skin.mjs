// Lane BODY (task studio-beta-mall-lingerie-20261102-221554-01): T-pose -> A-pose bind correction by LINEAR-BLEND SKINNING,
// for unclothed, long-haired T-pose sources (the three user-uploaded female zombie bodies). The vertex-wise angle blend of
// lib/repose.mjs (built for the scavenger's jacket) is unusable on them: on the sparse Meshy topology it tears the torso's
// large triangles (its fringe trim drops flank triangles) and swings the hair resting on the shoulders out with the arms.
// Instead, on a game-space ANALYSIS copy (the source and its textures are never written):
//   1. placement as lib/autorig.mjs (target height, +Z facing from the feet, feet midpoint at the origin);
//   2. hair mask from the base colour (per-body luminance / saturation rule from the config; analysis only);
//   3. 18-joint T-pose skeleton: enemy/lib/tpose-skeleton.mjs on dense deterministic surface samples (hair ignored);
//   4. weights: the shared zombie skinning + the hair post-pass (enemy/lib/siren-skin.mjs bodyWeights: hair never takes arm
//      weights, so strands beside the shoulders stay with the head / chest);
//   5. each UpperArm rotates about the forward (+Z) axis through its shoulder joint until the shoulder -> wrist line hangs
//      `upperArmFromVerticalDeg` from vertical (the shared A-pose bind of lib/repose.mjs); LBS gives the reposed positions;
//   6. positions back to the native frame (inverse placement), normals recomputed; topology / UVs / textures unchanged.
// The result is a master-like copy {..., pos, nrm, repose, hairMask} that the normal body stage (lib/autorig.mjs bodyStage)
// consumes like the scavenger's reposed master (hairMask: left out of the A-pose skeleton slices, kept off the arm weights).
import {MeshoptSimplifier} from 'meshoptimizer';
import {bounds, weldByPosition, computeNormals, similarity} from './mesh.mjs';
import {detectFacing, placement} from './autorig.mjs';
import {skinPositions} from './glb.mjs';
import {Rig, qAxis, V} from './pose.mjs';
import {JOINT_NAMES} from './skin.mjs';
import {estimateSkeleton} from '../../enemy/lib/tpose-skeleton.mjs';
import {surfaceSamples, sampleAttribute} from '../../enemy/lib/surface.mjs';
import {bodyWeights} from '../../enemy/lib/siren-skin.mjs';

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);

/** Per-vertex hair flag from the base colour: lum < lumMax, or (saturation > satMin and lum < satLumMax). */
async function hairMask(master, rule) {
  const tex = master.baseColor, W = tex.width, Hh = tex.height, uv = master.uv, n = uv.length / 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.min(W - 1, Math.max(0, Math.floor((uv[i * 2] - Math.floor(uv[i * 2])) * W)));
    const y = Math.min(Hh - 1, Math.max(0, Math.floor((uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1])) * Hh)));
    const o = (y * W + x) * 4, r = tex.data[o], g = tex.data[o + 1], b = tex.data[o + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
    if (lum < (rule.lumMax ?? 0) || (rule.satMin != null && sat > rule.satMin && lum < (rule.satLumMax ?? 255))) out[i] = 1;
  }
  return out;
}

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function chestWallGuard(P, sw, skel, k) {
  const ARMJ = new Set(['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'].map(n => JOINT_NAMES.indexOf(n)));
  const CHEST = JOINT_NAMES.indexOf('Chest');
  const armpitY = skel.armpitY, xMax = Math.min(Math.abs(skel.joints.L_UpperArm[0]), Math.abs(skel.joints.R_UpperArm[0])) + 0.03 * k;
  let rows = 0, moved = 0;
  for (let i = 0; i < P.length / 3; i++) {
    const y = P[i * 3 + 1];
    if (Math.abs(P[i * 3]) > xMax || y > armpitY - 0.005 * k) continue;
    const f = ss(armpitY - 0.04 * k, armpitY - 0.005 * k, y);
    let take = 0;
    for (let s = 0; s < 4; s++) if (ARMJ.has(sw.joints[i * 4 + s]) && sw.weights[i * 4 + s] > 0) { const d = sw.weights[i * 4 + s] * (1 - f); sw.weights[i * 4 + s] -= d; take += d; }
    if (take <= 0) continue;
    rows++; moved += take;
    const row = new Map();
    for (let s = 0; s < 4; s++) if (sw.weights[i * 4 + s] > 0) row.set(sw.joints[i * 4 + s], (row.get(sw.joints[i * 4 + s]) ?? 0) + sw.weights[i * 4 + s]);
    row.set(CHEST, (row.get(CHEST) ?? 0) + take);
    const e = [...row.entries()].filter(([, w]) => w > 1e-6).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4), t = e.reduce((a, x) => a + x[1], 0);
    for (let s = 0; s < 4; s++) { sw.joints[i * 4 + s] = e[s]?.[0] ?? 0; sw.weights[i * 4 + s] = e[s] ? e[s][1] / t : 0; }
  }
  return {armpitY: r4(armpitY), medialOfX: r4(xMax), fadeM: [r4(0.005 * k), r4(0.04 * k)], rowsChanged: rows, armWeightMovedToChest: r4(moved)};
}

/**
 * @param master loadAnySource result (native frame, densified)
 * @param opts {heightM, hair: {lumMax, satMin?, satLumMax?, minY?}, upperArmFromVerticalDeg = 34, smoothIters = 4}
 */
export async function reposeTtoAskinned(master, {heightM, hair = null, upperArmFromVerticalDeg = 34, smoothIters = 4, sampleArea = 2e-5} = {}) {
  await MeshoptSimplifier.ready;
  const fd = detectFacing(master.pos);
  const pl = placement(master, heightM, fd.facing);
  const P = similarity(master.pos, pl);
  const welded = weldByPosition(P, computeNormals(P, master.idx), master.idx);
  // native vertex -> welded vertex (exact position, like weldByPosition)
  const remap = MeshoptSimplifier.generatePositionRemap(P, 3), nN = P.length / 3;
  const wid = new Int32Array(nN).fill(-1); let c = 0;
  for (let i = 0; i < nN; i++) if (remap[i] === i) wid[i] = c++;
  const map = Uint32Array.from({length: nN}, (_, i) => wid[remap[i]]);
  // hair (analysis only): native flags; hair only above the armpit band (the rule is colour-based, so dark / saturated skin
  // detail lower down - nipples, wounds - never counts)
  let hairV = null, hairW = null, hairS = null;
  if (hair) {
    hairV = await hairMask(master, hair);
    const minY = (hair.minYFrac ?? 0.6) * heightM;
    for (let i = 0; i < nN; i++) if (P[i * 3 + 1] < minY) hairV[i] = 0;
    hairW = new Uint8Array(welded.pos.length / 3);
    for (let i = 0; i < nN; i++) if (hairV[i]) hairW[map[i]] = 1;
  }
  const S = surfaceSamples(P, master.idx, sampleArea);
  if (hairV) hairS = sampleAttribute(S, master.idx, Float32Array.from(hairV));
  const skel = estimateSkeleton(S.pts, hairS);
  // weights: hair only MEDIAL of the shoulder joints (dark / saturated spots on the T-pose arms - bruises, dirt - are skin
  // and must follow the arm), dilated by `hair.dilate` rings inside that column so highlight texels inside a strand do not
  // keep arm weights (both would otherwise leave stretched spikes between moved and unmoved vertices)
  let hairWeights = null, hairCut = null;
  if (hairW) {
    const xMax = Math.min(Math.abs(skel.joints.L_UpperArm[0]), Math.abs(skel.joints.R_UpperArm[0]));
    const WP = welded.pos, nW = WP.length / 3;
    hairWeights = Uint8Array.from(hairW, (h, i) => (h && Math.abs(WP[i * 3]) < xMax ? 1 : 0));
    const nb = Array.from({length: nW}, () => []);
    for (let t = 0; t < welded.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = welded.idx[t + k], b = welded.idx[t + (k + 1) % 3]; nb[a].push(b); nb[b].push(a); }
    const minY = (hair.minYFrac ?? 0.6) * heightM;
    let dilated = 0;
    for (let r = 0; r < (hair.dilate ?? 2); r++) {
      const add = [];
      for (let i = 0; i < nW; i++) if (!hairWeights[i] && Math.abs(WP[i * 3]) < xMax && WP[i * 3 + 1] > minY && nb[i].some(j => hairWeights[j])) add.push(i);
      for (const i of add) hairWeights[i] = 1;
      dilated += add.length;
    }
    hairCut = {shoulderJointHalfWidthM: r4(xMax), colourHairVertices: hairW.reduce((a, b) => a + b, 0), lateralRemoved: hairW.reduce((a, h, i) => a + (h && Math.abs(WP[i * 3]) >= xMax ? 1 : 0), 0), dilatedRings: hair.dilate ?? 2, dilatedVertices: dilated};
  }
  const sw = bodyWeights(welded, skel, hairWeights, {smoothIters});
  // chest wall guard (lib/repose.mjs torso guard, for skin weights): in a T-pose nothing below the armpit belongs to an arm,
  // so arm influences on the chest-side skin medial of the shoulder joint fade out from 0.5 cm to 4 cm (x H / 1.78) below
  // the armpit (their share goes to Chest); otherwise the armpit / breast-side skin is dragged down with the arm and folds
  // into flaps in front of the breasts
  const guard = chestWallGuard(welded.pos, sw, skel, heightM / 1.78);
  // target pose: each upper arm rolls about +Z through its shoulder until shoulder -> wrist is upperArmFromVerticalDeg from -Y
  const J = skel.joints, rig = new Rig(skel), rot = {}, sides = {};
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1;
    const d = V.sub(J[s + '_Hand'], J[s + '_UpperArm']);
    const now = Math.atan2(sg * d[0], -d[1]) * 180 / Math.PI; // angle from straight down, in the frontal plane (+ = outward)
    const delta = now - upperArmFromVerticalDeg; // degrees to bring the arm down
    rot[s + '_UpperArm'] = qAxis([0, 0, 1], -sg * delta);
    sides[s] = {armFromVerticalDegBefore: +now.toFixed(1), rotationDeg: +(-sg * delta).toFixed(1), shoulderJointM: r4(J[s + '_UpperArm']), wristJointM: r4(J[s + '_Hand'])};
  }
  const world = rig.fk({hips: [0, 0, 0], rot});
  // the T-rig's elbow / wrist carried into the A-pose bind (FK of the same rotation): offered to the A-pose skeleton
  const armJointsA = Object.fromEntries(['L', 'R'].map(s => [s, {elbow: r4(world[s + '_Forearm'].pos), wrist: r4(world[s + '_Hand'].pos)}]));
  const Pw = skinPositions({pos: welded.pos, joints: sw.joints, weights: sw.weights}, skel, world);
  for (const s of ['L', 'R']) { const d = V.sub(world[s + '_Hand'].pos, world[s + '_UpperArm'].pos); sides[s].armFromVerticalDegAfter = +(Math.atan2((s === 'L' ? 1 : -1) * d[0], -d[1]) * 180 / Math.PI).toFixed(1); }
  // back to native: inverse of similarity(scale, pivot, flipFacing, offset 0)
  const sg = pl.flipFacing ? -1 : 1, out = new Float32Array(nN * 3);
  let moved = 0;
  for (let i = 0; i < nN; i++) {
    const w = map[i], x = Pw[w * 3], y = Pw[w * 3 + 1], z = Pw[w * 3 + 2];
    out[i * 3] = sg * x / pl.scale + pl.pivot[0];
    out[i * 3 + 1] = y / pl.scale + pl.pivot[1];
    out[i * 3 + 2] = sg * z / pl.scale + pl.pivot[2];
    if (Math.hypot(x - P[i * 3], y - P[i * 3 + 1], z - P[i * 3 + 2]) > 1e-4) moved++;
  }
  // arm-weight share of hair vertices after the post-pass (must be 0) and of the whole mesh
  const ARM = new Set(['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'].map(n => JOINT_NAMES.indexOf(n)));
  let hairArm = 0;
  if (hairWeights) for (let i = 0; i < hairWeights.length; i++) if (hairWeights[i]) for (let k = 0; k < 4; k++) if (ARM.has(sw.joints[i * 4 + k]) && sw.weights[i * 4 + k] > 0) { hairArm++; break; }
  const b0 = bounds(master.pos), b1 = bounds(out);
  const log = {version: 'skin-1', method: 'linear-blend-skinning repose (lib/repose-skin.mjs): T-pose skeleton (enemy/lib/tpose-skeleton.mjs, dense surface samples, hair ignored) + shared zombie skin weights with the hair post-pass (enemy/lib/siren-skin.mjs bodyWeights); each UpperArm rolled about +Z through its shoulder joint to the A-pose bind angle; topology / UVs / textures unchanged',
    upperArmFromVerticalDeg, analysisHeightM: heightM, facing: fd, sides, armJointsA, verticesMoved: moved, vertices: nN,
    chestWallGuard: guard,
    hair: hair ? {rule: hair, nativeVertices: hairV.reduce((a, b) => a + b, 0), weldedVertices: hairW.reduce((a, b) => a + b, 0), weightMask: hairCut, weldedHairVerticesWithArmWeights: hairArm, weights: sw.stats.hair} : null,
    skeletonT: {joints: Object.fromEntries(Object.entries(J).map(([k, v]) => [k, r4(v)])), log: skel.log},
    nativeBoundsBefore: {min: r4(b0.min), max: r4(b0.max)}, nativeBoundsAfter: {min: r4(b1.min), max: r4(b1.max)}};
  // hair flags per native vertex (the weight mask: colour rule, medial of the shoulders, dilated) for the A-pose stage: left out
  // of the skeleton measurements and kept off the arm chains by the final skinning (lib/autorig.mjs bodyStage / bodySkin)
  const hairFlags = hairWeights ? Uint8Array.from({length: nN}, (_, i) => hairWeights[map[i]]) : null;
  return {...master, pos: out, nrm: computeNormals(out, master.idx), repose: {...log}, armJointsA, ...(hairFlags ? {hairMask: hairFlags} : {})};
}
