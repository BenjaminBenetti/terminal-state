// Task studio-beta-mall-lingerie-store-polish-20261103-045922-01 (lane FIT): the Mall's female display mannequin (M81, the accepted
// Meshy T2.5 model cooked to game/public/assets/models/mall-mannequin-female.glb: origin at the base centre on the floor, front -Z,
// 1.75 m, one static mesh) read as a fitting "body" for the lingerie sets. Read-only: nothing here changes the mannequin.
//  - working frame = the model frame turned half a turn about Y (front +Z, like the zombie bodies the fit library expects);
//    toModelFrame() turns positions / normals back for the runtime nodes (identity node transform in the mannequin's own frame);
//  - landmarks from horizontal slices of the mesh: base / feet, crotch (front-back midline scan, as for the bodies), armpit (the
//    highest slice whose arms are separate clusters beside the torso), neck (narrowest slice above the shoulders), shoulder width;
//  - groups: head (above the neck), arm (the side clusters below the armpit, and lateral of the shoulder joint above it), leg (below
//    the crotch), base (the plate / ankle rod below the feet), torso (the rest);
//  - FIT surface = torso + legs (+ the armpit fold medial of the shoulder joint); closed surface = the whole figure (parity tests);
//  - synthetic joint positions (Hips / Chest / Neck / UpperArm) for the shared landmark measurement (lib/lingerie-body.mjs).
// The mannequin is a static prop: no skin, no clips, no masks (it is drawn whole), so a fitted piece must clear it everywhere.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {TriGrid, weldMap, weldedNormals} from './penetration.mjs';
import {bucketByHeight, clusterXZ} from './slices.mjs';
import {surfaceSamples} from '../../enemy/lib/surface.mjs';
import {measureLandmarks} from './lingerie-body.mjs';

const r4 = v => +(+v).toFixed(4);
const GROUP = {torso: 0, head: 1, arm: 2, leg: 3, base: 4};

/** Half turn about Y (model frame <-> working frame; its own inverse). */
export function toModelFrame(arr) { const o = Float32Array.from(arr); for (let i = 0; i < o.length; i += 3) { o[i] = -o[i]; o[i + 2] = -o[i + 2]; } return o; }

export async function loadMannequin(file) {
  const bytes = fs.readFileSync(file);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1) throw new Error('mannequin: expected one mesh node');
  const n = nodes[0], t = n.getTranslation(), r = n.getRotation(), s = n.getScale();
  if (t.some(v => v) || r[3] !== 1 || s.some(v => v !== 1)) throw new Error('mannequin: non-identity node transform');
  const prim = n.getMesh().listPrimitives()[0];
  const pos = toModelFrame(prim.getAttribute('POSITION').getArray()), idx = Uint32Array.from(prim.getIndices().getArray());
  const nv = pos.length / 3;
  const {remap} = weldMap(pos);
  const nrm = weldedNormals(pos, idx, remap);
  let H = 0; for (let i = 0; i < nv; i++) H = Math.max(H, pos[i * 3 + 1]);
  // ---- slices (1 cm): clusters per height
  const step = 0.01, {buckets} = bucketByHeight(pos, 0, H + step, step);
  const slices = buckets.map((b, k) => ({y: (k + 0.5) * step, ids: b, clusters: clusterXZ(pos, b, 0.015, 3)}));
  const central = sl => sl.clusters.reduce((best, c) => (c.minX <= 0.02 && c.maxX >= -0.02 && (!best || c.count > best.count)) ? c : best, null);
  // feet top: the base plate + rod end where two separate foot / shin clusters (|x| > 1 cm) first appear above 3 cm
  let feetY = 0.05;
  for (const sl of slices) { if (sl.y < 0.03) continue; if (sl.clusters.filter(c => c.count >= 3 && Math.abs((c.minX + c.maxX) / 2) > 0.02).length >= 2) { feetY = sl.y; break; } }
  // neck: the narrowest central slice between 75 % and 92 % of the height
  let neck = null;
  for (const sl of slices) { if (sl.y < 0.75 * H || sl.y > 0.92 * H) continue; const c = central(sl); if (!c) continue; const w = c.maxX - c.minX; if (!neck || w < neck.w) neck = {y: sl.y, w, z: (c.minZ + c.maxZ) / 2}; }
  // armpit: the highest slice below the neck where the central torso cluster has a separate cluster on each side
  let armpit = null;
  for (let k = slices.length - 1; k >= 0; k--) {
    const sl = slices[k]; if (sl.y > neck.y - 0.08 || sl.y < 0.5 * H) continue;
    const c = central(sl); if (!c) continue;
    const L = sl.clusters.some(o => o !== c && o.minX > c.maxX - 0.005), R = sl.clusters.some(o => o !== c && o.maxX < c.minX + 0.005);
    if (L && R) { armpit = {y: sl.y, torsoHalfW: (c.maxX - c.minX) / 2, z: (c.minZ + c.maxZ) / 2}; break; }
  }
  if (!armpit) throw new Error('mannequin: armpit not found');
  // shoulder: widest extent of the slice band between the armpit and the neck (acromion), joint 4 cm medial of it
  let shoulderHalfW = 0;
  for (const sl of slices) { if (sl.y < armpit.y || sl.y > neck.y) continue; for (const i of sl.ids) shoulderHalfW = Math.max(shoulderHalfW, Math.abs(pos[i * 3])); }
  const shoulderJointX = shoulderHalfW - 0.04;
  // groups. ARMS from dense surface samples (the 3k-triangle mesh has too few vertices per slice): per side and 1 cm band between the
  // hand's lowest band and the armpit, the |x| distribution of the samples has a gap between the torso / thigh and the hanging arm
  // (> 1.2 cm, outer part beyond 12 cm); the cut x(y) is the gap's middle (bands without a gap: the neighbours' cut). A vertex beyond
  // the cut is arm; above the armpit, skin lateral of the shoulder joint is arm.
  const groups = new Uint8Array(nv);
  const S = surfaceSamples(pos, idx, 2e-5, 30).pts;
  const NB = Math.ceil(H / step), cut = {1: new Float64Array(NB).fill(NaN), [-1]: new Float64Array(NB).fill(NaN)};
  const bandX = {1: Array.from({length: NB}, () => []), [-1]: Array.from({length: NB}, () => [])};
  for (let i = 0; i < S.length / 3; i++) { const k = Math.floor(S[i * 3 + 1] / step); if (k < 0 || k >= NB) continue; const x = S[i * 3]; (x >= 0 ? bandX[1] : bandX[-1])[k].push(Math.abs(x)); }
  const handBottom = {};
  for (const side of [1, -1]) {
    let low = null;
    for (let k = Math.floor(armpit.y / step); k >= 0; k--) {
      const xs = bandX[side][k].sort((p, q) => p - q);
      let best = null;
      for (let j = 1; j < xs.length; j++) { const g = xs[j] - xs[j - 1]; if (xs[j] > 0.12 && xs[j - 1] > 0.06 && g > 0.012 && (!best || g > best.g)) best = {g, c: (xs[j] + xs[j - 1]) / 2}; }
      if (best) { cut[side][k] = best.c; low = k; } else if (low != null && k < low - 3) break; // below the hand: no more arm
    }
    handBottom[side] = low * step;
    // fill gaps (between found bands) from the nearest found band above
    let last = NaN; for (let k = NB - 1; k >= 0; k--) { if (!Number.isNaN(cut[side][k])) last = cut[side][k]; else if (k >= low && k <= Math.floor(armpit.y / step)) cut[side][k] = last; }
  }
  for (let i = 0; i < nv; i++) {
    const y = pos[i * 3 + 1], side = pos[i * 3] >= 0 ? 1 : -1, k = Math.floor(y / step);
    if (k >= 0 && k < NB && y <= armpit.y && y >= handBottom[side] - 0.005 && !Number.isNaN(cut[side][k]) && Math.abs(pos[i * 3]) > cut[side][k]) groups[i] = GROUP.arm;
  }
  for (let i = 0; i < nv; i++) {
    const y = pos[i * 3 + 1], ax = Math.abs(pos[i * 3]);
    if (y >= armpit.y && y <= neck.y && ax > shoulderJointX) groups[i] = GROUP.arm;
    if (y > neck.y && Math.abs(pos[i * 3]) < neck.w / 2 + 0.025) groups[i] = GROUP.head; // the neck / head, not the shoulder slope beside it
    if (y > neck.y + 0.06) groups[i] = GROUP.head;
    if (y < feetY) groups[i] = GROUP.base;
  }
  // the ankle rod: the midline strip (|x| < 1.2 cm) below the knees (the legs stand apart there)
  for (let i = 0; i < nv; i++) if (pos[i * 3 + 1] < 0.33 * H && Math.abs(pos[i * 3]) < 0.012) groups[i] = GROUP.base;
  for (let i = 0; i < nv; i++) if (groups[remap[i]] !== groups[i] && groups[remap[i]] !== GROUP.torso) groups[i] = groups[remap[i]];
  // synthetic joints for the shared landmark measurement (heights / depths measured above; anthropometric spacing between them)
  // body centre depth at a height: the middle of the midline front / back surface (rays on the closed figure)
  const closedG = new TriGrid(pos, idx, 0.025);
  const zAt = y => { const f = closedG.ray(0, y, 0.6, 0, 0, -1, 1.2), b = closedG.ray(0, y, -0.6, 0, 0, 1, 1.2); return f && b ? ((0.6 - f.t) + (-0.6 + b.t)) / 2 : 0; };
  const chestY = armpit.y - 0.03;
  // provisional hips for the crotch scan (60 % of the height: a fashion mannequin's long legs put the crotch at ~55 %); refined from
  // the measured crotch below
  const provHips = 0.6 * H;
  const J = {Hips: [0, provHips, zAt(provHips)], Chest: [0, chestY, zAt(chestY)], Neck: [0, neck.y, zAt(neck.y)], L_UpperArm: [shoulderJointX, armpit.y + 0.06, zAt(armpit.y)], R_UpperArm: [-shoulderJointX, armpit.y + 0.06, zAt(armpit.y)]};
  const skinIdx = idx;
  const B = {file, id: 'mannequinFemale', static: true, pos, idx, nrm, remap, groups, J, names: [], hair: new Uint8Array(nv), fused: new Uint8Array(nv),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, H, skinIdx, nrmIdx: skinIdx};
  B.skinGrid = closedG;
  const setFit = () => {
    const fit = [];
    for (let t = 0; t < idx.length; t += 3) { const v = [idx[t], idx[t + 1], idx[t + 2]]; if (v.every(i => groups[i] === GROUP.torso || groups[i] === GROUP.leg)) fit.push(...v); }
    B.fitIdx = Uint32Array.from(fit); B.fitGrid = new TriGrid(pos, B.fitIdx, 0.025);
    B.profilePts = surfaceSamples(pos, B.fitIdx, 2e-5, 30).pts; // dense cross-sections of the 3k-triangle figure
  };
  setFit();
  // crotch: the front-back midline scan (as lib/lingerie-body.mjs) on the whole closed figure; legs = torso skin below it, hips 6 cm above
  let crotchY = null;
  for (let y = provHips; y > 0.3 * H; y -= 0.0025) { const f = B.skinGrid.ray(0, y, 0.6, 0, 0, -1, 1.2), b = B.skinGrid.ray(0, y, -0.6, 0, 0, 1, 1.2); if (!f || !b || (0.6 - f.t) - (-0.6 + b.t) < 0.01) break; crotchY = y; }
  if (crotchY == null) throw new Error('mannequin: crotch not found');
  B.J.Hips = [0, crotchY + 0.06, zAt(crotchY + 0.06)];
  for (let i = 0; i < nv; i++) if (groups[i] === GROUP.torso && pos[i * 3 + 1] < crotchY - 0.005) groups[i] = GROUP.leg;
  setFit();
  B.landmarks = measureLandmarks(B);
  B.measured = {heightM: r4(H), feetTopY: r4(feetY), handBottomY: [r4(handBottom[1]), r4(handBottom[-1])], neckY: r4(neck.y), armpitY: r4(armpit.y), shoulderHalfWidthM: r4(shoulderHalfW), shoulderJointX: r4(shoulderJointX),
    groups: Object.fromEntries(Object.entries(GROUP).map(([k, g]) => [k, groups.reduce((a, v) => a + (v === g ? 1 : 0), 0)])), fitTriangles: B.fitIdx.length / 3};
  return B;
}

// ------------------------------------------------------------------------------------------------ fitting the static mannequin
import {fitStage1, runtimePiece, clothGraph, clearancePass, carryNormals, verifiedClosest, FIT} from './lingerie-fit.mjs';
import {measureSet} from './lingerie-metrics.mjs';

/** Static fitting options: the mannequin is drawn whole (nothing hidden), so the cloth clears it a touch more. */
export const MANNEQUIN_FIT = {...FIT, minClear: 0.002, offset: {top: 0.0035, bottom: 0.003}};

/**
 * Fit one design's source pieces to the mannequin (stage 1 at the source resolution + the design's runtime simplification, i.e. the
 * same kept vertices / UVs / indices as its worn variants, then clearance on the runtime triangles: cloth vs figure and figure
 * poking through between cloth vertices). Returns pieces in the WORKING frame + the fit report.
 */
export function fitMannequin(M, srcPieces, simp, opts = MANNEQUIN_FIT) {
  const S1 = fitStage1(M, srcPieces, opts);
  const pieces = {}, report = {...S1.report, pieces: {...S1.report.pieces}};
  for (const pn of ['top', 'bottom']) {
    const piece = runtimePiece(srcPieces[pn], S1.fitted[pn], simp[pn]);
    const G = clothGraph(piece);
    const rounds = clearancePass(M, piece, G, opts.minClear, 8);
    pieces[pn] = {pos: piece.pos, idx: piece.idx, uv: piece.uv, nrm: carryNormals(piece.garmentPos, piece.nrm, piece.pos, G)};
    report.pieces[pn] = {...report.pieces[pn], vertices: piece.pos.length / 3, triangles: piece.idx.length / 3, runtimeClearanceRounds: rounds};
  }
  // a one-piece garment cut into top / bottom (blush) shares the raw vertices along the cut: both halves get the outer of their two
  // positions and the mean normal there (each half was conformed on its own: no step / seam at the waist on the mannequin and the hanger)
  const rawOf = pn => Uint32Array.from(simp[pn].srcIndex, j => srcPieces[pn].srcIndex[j]);
  const rt = rawOf('top'), rb = rawOf('bottom'), byRaw = new Map();
  rt.forEach((r, i) => { (byRaw.get(r) ?? byRaw.set(r, {t: [], b: []}).get(r)).t.push(i); });
  rb.forEach((r, i) => { const e = byRaw.get(r); if (e) e.b.push(i); });
  let welded = 0;
  for (const {t, b} of byRaw.values()) {
    if (!t.length || !b.length) continue;
    const T = pieces.top, Bt = pieces.bottom;
    // the outer of the two positions (larger clearance), so the joined edge never dips into the figure
    const sdOf = (P, i) => verifiedClosest(M, M.fitGrid, M.fitIdx, M.nrm, M.skinGrid, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.08)?.sd ?? 1;
    const src = sdOf(T.pos, t[0]) >= sdOf(Bt.pos, b[0]) ? [T.pos, t[0]] : [Bt.pos, b[0]];
    const m = [0, 1, 2].map(k => src[0][src[1] * 3 + k]), nn = [0, 1, 2].map(k => T.nrm[t[0] * 3 + k] + Bt.nrm[b[0] * 3 + k]);
    const l = Math.hypot(...nn) || 1;
    for (const i of t) for (let k = 0; k < 3; k++) { T.pos[i * 3 + k] = m[k]; T.nrm[i * 3 + k] = nn[k] / l; }
    for (const i of b) for (let k = 0; k < 3; k++) { Bt.pos[i * 3 + k] = m[k]; Bt.nrm[i * 3 + k] = nn[k] / l; }
    welded++;
  }
  report.cutVerticesJoined = welded;
  return {pieces, report};
}

/** Metrics of a static fit (one rest "pose", nothing hidden: every poke is visible). */
export function measureMannequin(M, pieces) {
  const nv = M.pos.length / 3;
  M.joints ??= new Uint8Array(nv * 4); M.weights ??= Float32Array.from({length: nv * 4}, (_, i) => (i % 4 === 0 ? 1 : 0));
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const list = Object.entries(pieces).map(([name, p]) => ({name, pos: p.pos, idx: p.idx, joints: new Uint8Array(p.pos.length / 3 * 4), weights: Float32Array.from({length: p.pos.length / 3 * 4}, (_, i) => (i % 4 === 0 ? 1 : 0)), hide: new Uint8Array(M.idx.length / 3)}));
  return measureSet(M, list, {poses: [{clip: 'Static', t: 0, mats: [I4]}]}).summary.Static;
}
