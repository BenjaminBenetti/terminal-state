// Task studio-screacher-production-20261110-221858-01 (lane RIG): skin weights of a SCREACHER body on the shared 18-joint
// skeleton. The scheme is zombie/lib/skin.mjs computeSkinWeights (region labels -> per-region chain weights with smooth joint
// blends -> masked Laplacian smoothing -> top 4), copied and adapted (that file and every other body stay untouched) because
// its region rules do not hold here:
//   - its arm region is a flood from the hand restricted by a slice-measured torso wall, plus a distance adoption of loose
//     pieces: the Screacher's arms hang against the body, so the wall cuts sleeves that touch the flank lengthwise and the
//     adoption takes jacket hems / toggles beside the forearm. Here the arm below the cloth armpit is the TOPOLOGY label of
//     lib/screacher-skeleton.mjs (the flooded arm piece + the tracked sleeve loops); above the armpit the shoulder cut plane
//     decides, by position, for every mesh part alike (cloth, the arm inside it);
//   - legs below the crotch take the leg-loop label (trouser legs that touch at the midline), x sign only as the fallback;
//   - there is no head: the tilted neck / head boundary (jaw follows the head) is gone; the Neck / Head shares exist only
//     inside the stump column and fade to Chest laterally (hunched shoulders rise above the stump base);
// Every weight is a function of POSITION inside its region, so the separate smart-topology parts (clothing shells, limbs,
// shoes) lying at the same place get the same weights and move together.
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {vertexAdjacency, components} from '../../zombie/lib/mesh.mjs';

export const JOINT_NAMES = JOINTS.map(j => j[0]);
const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const NJ = JOINT_NAMES.length;

export const SKIN_OPTIONS = {
  smoothIters: 4, smoothLambda: 0.5,
  spineBlendHalf: {Spine: 0.06, Chest: 0.07, Neck: 0.03, Head: 0.02},
  stumpFade: {inner: 0.02, outer: 0.09},
  // the arms are bound HANGING (the worst case for lifting them): a wide Chest <-> UpperArm blend across the cut plane and
  // extra smoothing round the shoulder spread the armpit stretch over more triangles
  shoulder: {blend: 0.075, reach: 0.2, extraSmoothRadius: 0.26, extraSmoothIters: 6},
  elbow: [0.045, 0.035], wrist: [0.02, 0.03], knee: 0.05, ankle: [0.035, 0.03],
  // loose bits (a button, a lace, a torn-cuff triangle): a connected component this small moves rigidly with what it sits on
  bits: {maxVertices: 60, maxDiagonalM: 0.15, maxGapM: 0.02},
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Closest point parameter on a polyline: {seg, t, s (arc length), dist} (zombie/lib/skin.mjs). */
function onPolyline(p, pts) {
  let best = null, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a), L = len(ab);
    const t = dot(sub(p, a), ab) / (L * L);
    const tc = Math.min(1, Math.max(0, t));
    const q = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
    const d = len(sub(p, q));
    if (!best || d < best.dist - 1e-9) best = {seg: i, t, s: acc + Math.min(Math.max(t, i === 0 ? -1 : 0), i === pts.length - 2 ? 2 : 1) * L, dist: d};
    acc += L;
  }
  return best;
}

/**
 * @param mesh welded body mesh {pos, idx} (the mesh lib/screacher-skeleton.mjs measured: its vertex labels index it)
 * @param skel detectScreacherSkeleton result
 * @returns {joints (Uint16 x4), weights (Float32 x4), region (Int8: 0 torso, 1 armL, 2 armR, 3 legL, 4 legR), stats}
 */
export function computeScreacherSkin(mesh, skel, O = SKIN_OPTIONS) {
  const P = mesh.pos, n = P.length / 3, J = skel.joints;
  const {offs, adj} = vertexAdjacency(n, mesh.idx);
  const p = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const REG = {torso: 0, armL: 1, armR: 2, legL: 3, legR: 4};
  const region = new Int8Array(n);
  const cutSd = {}, capCount = {L: 0, R: 0};
  // ---- 1. regions
  for (const side of ['L', 'R']) {
    const {A, T} = skel.cut[side], sg = side === 'L' ? 1 : -1;
    let nn = nrm(cross(sub(T, A), [0, 0, 1]));
    if (nn[0] * sg < 0) nn = nn.map(v => -v);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = dot(sub(p(i), A), nn);
    cutSd[side] = sd;
  }
  let legFallback = 0;
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1], al = skel.labels.arm[i];
    if (al) { region[i] = al === 1 ? REG.armL : REG.armR; continue; }
    // shoulder cap: above the cloth armpit, on the outer side of the cut plane (same rule for cloth and the arm inside it)
    let cap = 0;
    for (const side of ['L', 'R']) if (y > skel.cut[side].A[1] - 0.01 && cutSd[side][i] > 0) cap = side === 'L' ? REG.armL : REG.armR;
    if (cap) { region[i] = cap; capCount[cap === REG.armL ? 'L' : 'R']++; continue; }
    if (y < skel.crotchY) {
      const ll = skel.labels.leg[i];
      if (!ll) legFallback++;
      region[i] = (ll ? ll === 1 : P[i * 3] >= 0) ? REG.legL : REG.legR;
    }
  }

  // ---- 2. raw weights
  const W = new Float32Array(n * NJ);
  const add = (i, name, w) => { if (w > 0) W[i * NJ + JI[name]] += w; };
  const spineChain = [['Hips', -Infinity], ['Spine', J.Spine[1]], ['Chest', J.Chest[1]], ['Neck', J.Neck[1]], ['Head', J.Head[1]]];
  const r0 = skel.stump.halfWidth + O.stumpFade.inner, r1 = skel.stump.halfWidth + O.stumpFade.outer;
  const spineWeights = (x, y, z) => {
    const out = {Hips: 1};
    for (let k = 1; k < spineChain.length; k++) {
      const [name, y0] = spineChain[k];
      const b = O.spineBlendHalf[name];
      let f = smoothstep(y0 - b, y0 + b, y);
      // the Neck / Head shares live in the stump column only (distance to the Neck -> Head axis in the horizontal plane)
      if (name === 'Neck') { const u = Math.min(1, Math.max(0, (y - J.Neck[1]) / Math.max(1e-6, J.Head[1] - J.Neck[1]))); f *= 1 - smoothstep(r0, r1, Math.hypot(x - (J.Neck[0] + (J.Head[0] - J.Neck[0]) * u), z - (J.Neck[2] + (J.Head[2] - J.Neck[2]) * u))); }
      if (f <= 0) break;
      const prev = spineChain[k - 1][0], moved = out[prev] * f;
      out[prev] -= moved; out[name] = moved;
    }
    return out;
  };
  const armChain = side => [J[side + '_UpperArm'], J[side + '_Forearm'], J[side + '_Hand'], skel.ends[side + '_Hand']];
  const segLen = pts => pts.slice(0, -1).map((a, i) => len(sub(pts[i + 1], a)));
  const chains = {L: armChain('L'), R: armChain('R')}, chainLen = {L: segLen(chains.L), R: segLen(chains.R)};
  for (let i = 0; i < n; i++) {
    const q = p(i), [x, y, z] = q, r = region[i];
    if (r === REG.armL || r === REG.armR) {
      const side = r === REG.armL ? 'L' : 'R', L = chainLen[side];
      const s = onPolyline(q, chains[side]).s, sE = L[0], sW = L[0] + L[1];
      const wArm = 0.5 + 0.5 * smoothstep(0, O.shoulder.blend, cutSd[side][i]);
      const fE = smoothstep(sE - O.elbow[0], sE + O.elbow[1], s), fW = smoothstep(sW - O.wrist[0], sW + O.wrist[1], s);
      add(i, 'Chest', 1 - wArm);
      add(i, side + '_UpperArm', wArm * (1 - fE));
      add(i, side + '_Forearm', wArm * fE * (1 - fW));
      add(i, side + '_Hand', wArm * fE * fW);
      continue;
    }
    const side = r === REG.legL ? 'L' : r === REG.legR ? 'R' : x >= 0 ? 'L' : 'R';
    const heightRamp = smoothstep(skel.hipY + 0.10, skel.hipY - 0.12, y);
    const sideFade = smoothstep(0.0, 0.07, Math.abs(x));
    const below = smoothstep(skel.crotchY, skel.crotchY - 0.10, y);
    const thighW = heightRamp * (sideFade + (1 - sideFade) * below);
    if (thighW > 0) {
      if (r === REG.legL || r === REG.legR || y < skel.hipY) {
        const fK = smoothstep(J[side + '_Shin'][1] + O.knee, J[side + '_Shin'][1] - O.knee, y);
        const fA = smoothstep(J[side + '_Foot'][1] + O.ankle[0], J[side + '_Foot'][1] - O.ankle[1], y);
        add(i, side + '_Thigh', thighW * (1 - fK));
        add(i, side + '_Shin', thighW * fK * (1 - fA));
        add(i, side + '_Foot', thighW * fK * fA);
      } else add(i, side + '_Thigh', thighW);
    }
    const rest = 1 - thighW;
    for (const [name, w] of Object.entries(spineWeights(x, y, z))) add(i, name, rest * w);
    // torso side of the shoulder cut: share with the UpperArm near the plane (mirror of the arm side)
    for (const s of ['L', 'R']) {
      const sd = cutSd[s][i];
      if (sd > -O.shoulder.blend && sd <= 0 && len(sub(q, J[s + '_UpperArm'])) < O.shoulder.reach && y < J.Neck[1] && y > skel.cut[s].A[1] - 0.01) {
        const wArm = 0.5 * smoothstep(-O.shoulder.blend, 0, sd);
        const tot = W.subarray(i * NJ, i * NJ + NJ).reduce((a, b) => a + b, 0) || 1;
        for (let j = 0; j < NJ; j++) W[i * NJ + j] *= (1 - wArm) / tot;
        add(i, s + '_UpperArm', wArm);
      }
    }
  }

  // ---- 3. allowed-bone masks + masked Laplacian smoothing
  const allowed = new Uint8Array(n * NJ);
  for (let i = 0; i < n; i++) {
    const q = p(i), r = region[i], a = allowed.subarray(i * NJ, i * NJ + NJ);
    const set = names => names.forEach(nm => { a[JI[nm]] = 1; });
    if (r === REG.armL || r === REG.armR) { const s = r === REG.armL ? 'L' : 'R'; set(['Chest', s + '_UpperArm', s + '_Forearm', s + '_Hand']); continue; }
    if (r === REG.legL || r === REG.legR) { const s = r === REG.legL ? 'L' : 'R'; set(['Hips', 'Spine', s + '_Thigh', s + '_Shin', s + '_Foot']); continue; }
    set(['Hips', 'Spine', 'Chest', 'Neck', 'Head']);
    for (const s of ['L', 'R']) {
      if (len(sub(q, J[s + '_UpperArm'])) < O.shoulder.reach + 0.01 && q[1] < J.Neck[1] && cutSd[s][i] > -O.shoulder.blend - 0.015) set([s + '_UpperArm']);
      const sx = s === 'L' ? q[0] : -q[0];
      if (sx > -0.005 && q[1] < skel.hipY + 0.12) set([s + '_Thigh', s + '_Shin', s + '_Foot']);
    }
  }
  for (let i = 0; i < n * NJ; i++) if (!allowed[i]) W[i] = 0;
  normalizeRows(W, n);
  // (zone: null = every vertex; else only the flagged vertices move, the others are fixed boundary values)
  const smoothPass = zone => {
    const Wn = Float32Array.from(W);
    for (let i = 0; i < n; i++) {
      if (zone && !zone[i]) continue;
      const deg = offs[i + 1] - offs[i];
      for (let j = 0; j < NJ; j++) {
        if (!allowed[i * NJ + j]) { Wn[i * NJ + j] = 0; continue; }
        let s = 0;
        for (let k = offs[i]; k < offs[i + 1]; k++) s += W[adj[k] * NJ + j];
        Wn[i * NJ + j] = (1 - O.smoothLambda) * W[i * NJ + j] + O.smoothLambda * (deg ? s / deg : W[i * NJ + j]);
      }
    }
    W.set(Wn);
    normalizeRows(W, n);
  };
  for (let it = 0; it < O.smoothIters; it++) smoothPass(null);
  // extra passes round the shoulders / armpits only
  const shoulderZone = new Uint8Array(n);
  let zoneCount = 0;
  for (let i = 0; i < n; i++) { const q = p(i); if (Math.min(len(sub(q, J.L_UpperArm)), len(sub(q, J.R_UpperArm))) < O.shoulder.extraSmoothRadius) { shoulderZone[i] = 1; zoneCount++; } }
  for (let it = 0; it < O.shoulder.extraSmoothIters; it++) smoothPass(shoulderZone);

  // ---- 4. top 4
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  let truncated = 0;
  for (let i = 0; i < n; i++) {
    const row = Array.from(W.subarray(i * NJ, i * NJ + NJ), (w, j) => [w, j]).filter(e => e[0] > 1e-4).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (row.length > 4) truncated++;
    const top = row.slice(0, 4), s = top.reduce((a, e) => a + e[0], 0);
    for (let k = 0; k < 4; k++) { joints[i * 4 + k] = top[k] ? top[k][1] : 0; weights[i * 4 + k] = top[k] ? top[k][0] / s : 0; }
    weights[i * 4] += 1 - (weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3]);
  }
  // ---- 5. loose bits follow what they sit on: every vertex of a small component copies the 4 weights (and the region) of the
  //         nearest vertex of a large component (position-based weights alone leave a torn-cuff triangle beside the forearm
  //         on the torso: it would stay behind in the air when the arm moves)
  const comp = components(n, mesh.idx), groups = new Map();
  for (let i = 0; i < n; i++) { let g = groups.get(comp.label[i]); if (!g) groups.set(comp.label[i], g = []); g.push(i); }
  const isBit = g => { if (g.length > O.bits.maxVertices) return false; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const i of g) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); } return len(sub(hi, lo)) <= O.bits.maxDiagonalM; };
  const bits = [...groups.values()].filter(isBit), bitFlag = new Uint8Array(n);
  for (const g of bits) for (const i of g) bitFlag[i] = 1;
  const anchors = []; for (let i = 0; i < n; i++) if (!bitFlag[i]) anchors.push(i);
  let bitsAttached = 0, bitVertices = 0, bitsChanged = 0;
  for (const g of bits) {
    let best = -1, bd = Infinity;
    for (const i of g) for (const j of anchors) { const d = (P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2; if (d < bd) { bd = d; best = j; } }
    if (best < 0 || Math.sqrt(bd) > O.bits.maxGapM) continue;
    bitsAttached++;
    for (const i of g) {
      bitVertices++;
      if (joints[i * 4] !== joints[best * 4] || region[i] !== region[best]) bitsChanged++;
      for (let k = 0; k < 4; k++) { joints[i * 4 + k] = joints[best * 4 + k]; weights[i * 4 + k] = weights[best * 4 + k]; }
      region[i] = region[best];
    }
  }
  const counts = {};
  for (let i = 0; i < n; i++) { const k = Object.keys(REG).find(k => REG[k] === region[i]); counts[k] = (counts[k] || 0) + 1; }
  return {joints, weights, region, stats: {regionVertexCounts: counts, shoulderCapVertices: capCount, shoulderExtraSmoothVertices: zoneCount, looseBits: {components: bits.length, attached: bitsAttached, vertices: bitVertices, verticesWhoseDominantBoneOrRegionChanged: bitsChanged}, legVerticesBySignFallback: legFallback, verticesWithMoreThan4Truncated: truncated, smoothIters: O.smoothIters, smoothLambda: O.smoothLambda, options: O,
    method: 'lib/screacher-skin.mjs: regions (arm = topology label below the cloth armpit + outer side of the shoulder cut plane above it; leg = leg-loop label / x sign below the crotch; torso), chain weights with smooth joint blends (zombie/lib/skin.mjs formulas; Neck / Head only inside the stump column, no tilted head boundary), masked Laplacian smoothing on the welded mesh, top 4; small loose components copy the weights of the surface they sit on'}};
}

function normalizeRows(W, n) {
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = 0; j < NJ; j++) s += W[i * NJ + j];
    if (s <= 0) { W[i * NJ + JI.Hips] = 1; continue; }
    for (let j = 0; j < NJ; j++) W[i * NJ + j] /= s;
  }
}
