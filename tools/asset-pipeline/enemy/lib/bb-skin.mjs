// Task studio-bb-models-20261112-234540-01: skin weights of a BB body (standing A-pose bind, toddler proportions) on the shared
// 18-joint skeleton. The scheme is lib/screacher-skin.mjs (itself zombie/lib/skin.mjs adapted): region labels -> per-region
// chain weights with smooth joint blends -> allowed-bone masks -> masked Laplacian smoothing -> top 4 -> small loose components
// copy the weights of the surface they sit on. Copied and adapted (those files and their bodies stay untouched) because:
//   - arm region: there is no topology label here. Above the armpit the shoulder cut plane decides by position (the plane
//     through the armpit and the shoulder top, containing +Z; puff sleeves, the vest flap and hood rims over the shoulder go
//     with the arm only near the joint); and at any height a vertex on the outer side of that plane belongs to the arm when it
//     lies beyond the armpit along the arm and within `arm.radiusK` x the tracked section radius (+ `arm.marginM`) of
//     lib/bb-skeleton.mjs's measured arm centreline; the hand is the mesh-connected surface flooded from the fingertip beyond
//     the wrist plane (splayed fingers leave any radius);
//   - there IS a head: the zombie rule's tilted Neck / Head boundary is back (the jaw and chin follow the head, the nape the
//     neck, tilted more gently behind: a toddler's skull and a hood reach far back), everything inside the measured skull
//     sphere is Head, and the arm never reaches above the neck;
//   - below the crotch, the midline share of the thigh weight is kept for the leg itself only (`legness`: a smock / vest hem
//     hanging between the legs follows the Hips at the midline instead of tearing between the two thighs);
//   - blend widths are scaled to a 0.85 m toddler.
// Every weight is a function of POSITION inside its region, so separate smart-topology parts at the same place (cloth shells,
// the limb inside them) get the same weights and move together.
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {vertexAdjacency, components} from '../../zombie/lib/mesh.mjs';

export const JOINT_NAMES = JOINTS.map(j => j[0]);
const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const NJ = JOINT_NAMES.length;

export const BB_SKIN_OPTIONS = {
  smoothIters: 4, smoothLambda: 0.5,
  spineBlendHalf: {Spine: 0.04, Chest: 0.045, Neck: 0.02, Head: 0.018},
  headTilt: 1.0, napeTilt: 0.3, skullK: 1.0,
  arm: {radiusK: 1.45, marginM: 0.008, clearM: 0.01, handFloodBehindWristM: 0.01},
  shoulder: {blend: 0.05, reach: 0.13, extraSmoothRadius: 0.15, extraSmoothIters: 6},
  thigh: {rampAbove: 0.07, rampBelow: 0.08, sideFadeM: 0.05, belowM: 0.07, legnessInner: 1.15, legnessOuter: 1.6},
  elbow: [0.03, 0.025], wrist: [0.015, 0.02], knee: 0.035, ankle: [0.025, 0.02],
  // loose bits (a button, a bow, a ribbon end, a torn-hem triangle): a connected component this small moves rigidly with what
  // it sits on
  bits: {maxVertices: 60, maxDiagonalM: 0.10, maxGapM: 0.015},
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
 * @param mesh welded body mesh {pos, idx} (the mesh lib/bb-skeleton.mjs measured)
 * @param skel detectBbSkeleton result
 * @returns {joints (Uint16 x4), weights (Float32 x4), region (Int8: 0 torso, 1 armL, 2 armR, 3 legL, 4 legR), stats}
 */
export function computeBbSkin(mesh, skel, O = BB_SKIN_OPTIONS) {
  const P = mesh.pos, n = P.length / 3, J = skel.joints;
  const {offs, adj} = vertexAdjacency(n, mesh.idx);
  const p = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const REG = {torso: 0, armL: 1, armR: 2, legL: 3, legR: 4};
  const region = new Int8Array(n);
  // head height: the zombie/lib/skin.mjs tilt (the front, jaw / chin, counts as higher; the nape as lower, gently: a toddler's
  // skull and a hood reach far back) + the measured skull sphere is all Head (the back of a big skull sits low)
  const sc = skel.head.centre, sr = skel.head.radius * O.skullK;
  const headH = (y, z, x = 0) => {
    if ((x - sc[0]) ** 2 + (y - sc[1]) ** 2 + (z - sc[2]) ** 2 < sr * sr) return Math.max(y, J.Head[1] + O.spineBlendHalf.Head);
    const dz = z - J.Neck[2];
    return y + (dz > 0 ? O.headTilt : O.napeTilt) * dz * smoothstep(J.Neck[1] - 0.03, J.Neck[1] + 0.015, y);
  };
  // ---- 1. regions
  const cutSd = {}, capCount = {L: 0, R: 0}, radialCount = {L: 0, R: 0};
  const armLine = {}, trackOf = {};
  for (const side of ['L', 'R']) {
    const A = skel.arms[side], sg = A.sg;
    let nn = nrm(cross(sub(A.top, A.pit), [0, 0, 1]));
    if (nn[0] * sg < 0) nn = nn.map(v => -v);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = dot(sub(p(i), A.pit), nn);
    cutSd[side] = sd;
    armLine[side] = [J[side + '_UpperArm'], J[side + '_Forearm'], J[side + '_Hand'], skel.ends[side + '_Hand']];
    trackOf[side] = A.track;
  }
  const armRadiusAt = (side, q) => {
    const A = skel.arms[side], t = dot(sub(q, A.S), A.u);
    let best = null; for (const e of trackOf[side]) if (!best || Math.abs(e.t - t) < Math.abs(best.t - t)) best = e;
    return best ? {r: Math.min(best.r90, 1.6 * A.clearR), cen: best.cen, t} : {r: A.clearR, cen: A.S, t};
  };
  // the hand: the mesh-connected surface flooded from the fingertip vertex beyond the wrist plane (splayed / downward fingers
  // leave the tracked arm radius; nothing else touches the hand in the A-pose bind)
  const hand = new Int8Array(n), handCount = {L: 0, R: 0};
  for (const side of ['L', 'R']) {
    const A = skel.arms[side], t0 = A.wristT - O.arm.handFloodBehindWristM, tAx = i => dot(sub(p(i), A.S), A.u);
    const queue = [A.tipI]; hand[A.tipI] = side === 'L' ? 1 : 2;
    while (queue.length) {
      const v = queue.pop(); handCount[side]++;
      for (let k = offs[v]; k < offs[v + 1]; k++) { const w = adj[k]; if (!hand[w] && tAx(w) > t0) { hand[w] = side === 'L' ? 1 : 2; queue.push(w); } }
    }
  }
  // axial distance (along the shoulder -> fingertip line) beyond which the arm is clear of the trunk: the armpit's, + `arm.clearM`
  const tClear = {L: dot(sub(skel.arms.L.pit, skel.arms.L.S), skel.arms.L.u) + O.arm.clearM, R: dot(sub(skel.arms.R.pit, skel.arms.R.S), skel.arms.R.u) + O.arm.clearM};
  for (let i = 0; i < n; i++) {
    const q = p(i), [x, y, z] = q;
    const hh = headH(y, z, x);
    let arm = hand[i] ? (hand[i] === 1 ? 'L' : 'R') : 0;
    for (const side of arm ? [] : ['L', 'R']) {
      const A = skel.arms[side], sd = cutSd[side][i];
      if (sd <= 0 || A.sg * x <= 0) continue;
      // within the tracked section radius of the arm centreline (a drooping arm's elbow top lies above the armpit height too)
      // (only where the arm is clear of the trunk: beyond the armpit along the arm, below the neck; nearer the joint the cap rule)
      const {r, cen, t} = armRadiusAt(side, q);
      if (t > tClear[side] && y < J.Neck[1] && hh < J.Head[1] && len(sub(q, cen)) < O.arm.radiusK * r + O.arm.marginM) { arm = side; radialCount[side]++; continue; }
      // shoulder cap: above the armpit, outer side of the cut, near the joint, below the neck / head
      if (y > A.pit[1] - 0.01 && y < J.Neck[1] + 0.01 && hh < J.Head[1] && len(sub(q, A.S)) < O.shoulder.reach) { arm = side; capCount[side]++; }
    }
    if (arm) { region[i] = arm === 'L' ? REG.armL : REG.armR; continue; }
    if (y < skel.crotchY) region[i] = x >= 0 ? REG.legL : REG.legR;
  }

  // ---- 2. raw weights
  const W = new Float32Array(n * NJ);
  const add = (i, name, w) => { if (w > 0) W[i * NJ + JI[name]] += w; };
  const spineChain = [['Hips', -Infinity], ['Spine', J.Spine[1]], ['Chest', J.Chest[1]], ['Neck', J.Neck[1]], ['Head', J.Head[1]]];
  const spineWeights = (x, y, z) => {
    const out = {Hips: 1}, hh = headH(y, z, x);
    for (let k = 1; k < spineChain.length; k++) {
      const [name, y0] = spineChain[k];
      const b = O.spineBlendHalf[name];
      const f = smoothstep(y0 - b, y0 + b, name === 'Neck' || name === 'Head' ? hh : y);
      if (f <= 0) break;
      const prev = spineChain[k - 1][0], moved = out[prev] * f;
      out[prev] -= moved; out[name] = moved;
    }
    return out;
  };
  // legness below the crotch: 1 on the leg itself, 0 on a hem / panel hanging off it (by the horizontal distance to the
  // thigh -> shin axis vs the leg's own radius: the median section radius just above the knee and low on the thigh, the lower of
  // the two, so a smock hem at one of those heights does not inflate it); the midline of a hem then follows the Hips instead of
  // splitting between the two thighs
  const legAxisDist = (side, q) => {
    const a = J[side + '_Thigh'], b = J[side + '_Shin'], ab = sub(b, a), t = Math.min(1.2, Math.max(0, dot(sub(q, a), ab) / dot(ab, ab)));
    return Math.hypot(q[0] - (a[0] + ab[0] * t), q[2] - (a[2] + ab[2] * t));
  };
  const legR = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, kn = J[side + '_Shin'][1], meds = [];
    for (const h of [kn + 0.02, kn + 0.4 * (skel.crotchY - kn)]) {
      const ds = []; for (let i = 0; i < n; i++) if (Math.abs(P[i * 3 + 1] - h) < 0.005 && sg * P[i * 3] > 0 && Math.abs(P[i * 3]) < 0.2) { const d = legAxisDist(side, p(i)); if (d < 0.12) ds.push(d); }
      ds.sort((x, y) => x - y); if (ds.length) meds.push(ds[ds.length >> 1]);
    }
    legR[side] = Math.min(...meds);
  }
  const segLen = pts => pts.slice(0, -1).map((a, i) => len(sub(pts[i + 1], a)));
  const chainLen = {L: segLen(armLine.L), R: segLen(armLine.R)};
  const T = O.thigh;
  for (let i = 0; i < n; i++) {
    const q = p(i), [x, y, z] = q, r = region[i];
    if (r === REG.armL || r === REG.armR) {
      const side = r === REG.armL ? 'L' : 'R', L = chainLen[side];
      const s = onPolyline(q, armLine[side]).s, sE = L[0], sW = L[0] + L[1];
      const wArm = 0.5 + 0.5 * smoothstep(0, O.shoulder.blend, cutSd[side][i]);
      const fE = smoothstep(sE - O.elbow[0], sE + O.elbow[1], s), fW = smoothstep(sW - O.wrist[0], sW + O.wrist[1], s);
      add(i, 'Chest', 1 - wArm);
      add(i, side + '_UpperArm', wArm * (1 - fE));
      add(i, side + '_Forearm', wArm * fE * (1 - fW));
      add(i, side + '_Hand', wArm * fE * fW);
      continue;
    }
    const side = r === REG.legL ? 'L' : r === REG.legR ? 'R' : x >= 0 ? 'L' : 'R';
    const heightRamp = smoothstep(skel.hipY + T.rampAbove, skel.hipY - T.rampBelow, y);
    const sideFade = smoothstep(0.0, T.sideFadeM, Math.abs(x));
    const below = smoothstep(skel.crotchY, skel.crotchY - T.belowM, y);
    const legness = smoothstep(T.legnessOuter * legR[side], T.legnessInner * legR[side], legAxisDist(side, q));
    const thighW = heightRamp * (sideFade + (1 - sideFade) * below * legness);
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
      const sd = cutSd[s][i], A = skel.arms[s];
      if (sd > -O.shoulder.blend && sd <= 0 && len(sub(q, A.S)) < O.shoulder.reach && y < J.Neck[1] && y > A.pit[1] - 0.01 && headH(y, z, x) < J.Head[1]) {
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
      const A = skel.arms[s];
      if (len(sub(q, A.S)) < O.shoulder.reach + 0.01 && q[1] < J.Neck[1] && cutSd[s][i] > -O.shoulder.blend - 0.01) set([s + '_UpperArm']);
      const sx = s === 'L' ? q[0] : -q[0];
      if (sx > -0.005 && q[1] < skel.hipY + T.rampAbove + 0.01) set([s + '_Thigh', s + '_Shin', s + '_Foot']);
    }
  }
  for (let i = 0; i < n * NJ; i++) if (!allowed[i]) W[i] = 0;
  normalizeRows(W, n);
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
  // ---- 5. loose bits follow what they sit on (nearest vertex of a large component)
  const comp = components(n, mesh.idx), groups = new Map();
  for (let i = 0; i < n; i++) { let g = groups.get(comp.label[i]); if (!g) groups.set(comp.label[i], g = []); g.push(i); }
  const isBit = g => { if (g.length > O.bits.maxVertices) return false; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const i of g) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i * 3 + k]); hi[k] = Math.max(hi[k], P[i * 3 + k]); } return len(sub(hi, lo)) <= O.bits.maxDiagonalM; };
  const bits = [...groups.values()].filter(isBit), bitFlag = new Uint8Array(n);
  for (const g of bits) for (const i of g) bitFlag[i] = 1;
  // spatial hash of the anchors (large-component vertices)
  const cell = 0.02, hash = new Map(), key = (a, b, c) => `${a},${b},${c}`;
  for (let i = 0; i < n; i++) if (!bitFlag[i]) { const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell)); (hash.get(k) || hash.set(k, []).get(k)).push(i); }
  const nearestAnchor = i => {
    const cx = Math.floor(P[i * 3] / cell), cy = Math.floor(P[i * 3 + 1] / cell), cz = Math.floor(P[i * 3 + 2] / cell);
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const j of hash.get(key(cx + dx, cy + dy, cz + dz)) || []) {
      const d = (P[i * 3] - P[j * 3]) ** 2 + (P[i * 3 + 1] - P[j * 3 + 1]) ** 2 + (P[i * 3 + 2] - P[j * 3 + 2]) ** 2; if (d < bd) { bd = d; best = j; }
    }
    return {best, d: Math.sqrt(bd)};
  };
  let bitsAttached = 0, bitVertices = 0, bitsChanged = 0;
  for (const g of bits) {
    let best = -1, bd = Infinity;
    for (const i of g) { const r = nearestAnchor(i); if (r.d < bd) { bd = r.d; best = r.best; } }
    if (best < 0 || bd > O.bits.maxGapM) continue;
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
  return {joints, weights, region, stats: {regionVertexCounts: counts, handFloodVertices: handCount, shoulderCapVertices: capCount, armRadialVertices: radialCount, shoulderExtraSmoothVertices: zoneCount, looseBits: {components: bits.length, attached: bitsAttached, vertices: bitVertices, verticesWhoseDominantBoneOrRegionChanged: bitsChanged}, legRadiusM: {L: +legR.L.toFixed(4), R: +legR.R.toFixed(4)}, verticesWithMoreThan4Truncated: truncated, options: O,
    method: 'lib/bb-skin.mjs: regions (arm = the hand flooded from the fingertip beyond the wrist plane + the outer side of the shoulder cut plane: near the joint above the armpit, within the tracked section radius of the measured arm centreline beyond it; leg = x sign below the crotch; torso), chain weights with smooth joint blends (zombie/lib/skin.mjs formulas incl. the tilted Neck / Head boundary), masked Laplacian smoothing on the welded mesh, top 4; small loose components copy the weights of the surface they sit on'}};
}

function normalizeRows(W, n) {
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = 0; j < NJ; j++) s += W[i * NJ + j];
    if (s <= 0) { W[i * NJ + JI.Hips] = 1; continue; }
    for (let j = 0; j < NJ; j++) W[i * NJ + j] /= s;
  }
}
