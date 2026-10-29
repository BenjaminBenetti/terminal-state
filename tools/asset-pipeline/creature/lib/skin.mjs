// Automatic quadruped skin weights (bone-segment / region based, not a heat-diffusion solver):
//  1. regions: each leg = mesh-connected flood from its toe through vertices on its side, below
//     its girdle joint and clearly closer to its own bone chain than to the spine chain; tail =
//     connected vertices behind the rump end (geodesic distance from the tail root); the rest is
//     torso / neck / head.
//  2. per-region chain weights with smooth blends at the joints: legs by arc length along
//     upper -> lower -> foot -> toe (top of the leg blends into Chest / Hips by height); torso by
//     projection on the spine polyline Hips..Chest..Neck..Head; jaw = head vertices under the mouth
//     line in front of the hinge; tail by geodesic distance along the actual curl.
//  3. masked Laplacian smoothing (a vertex never gains bones outside its region set), top-4, normalised.
import {JOINT_NAMES} from './skeleton.mjs';
import {vertexAdjacency, components} from '../../zombie/lib/mesh.mjs';
import {geodesic} from './landmarks.mjs';

const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const NJ = JOINT_NAMES.length;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
export const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Closest point on a polyline: {seg, t, s (arc length), dist}. */
export function onPolyline(p, pts) {
  let best = null, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a), L = len(ab) || 1e-9;
    const t = dot(sub(p, a), ab) / (L * L);
    const tc = Math.min(1, Math.max(0, t));
    const q = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
    const d = len(sub(p, q));
    if (!best || d < best.dist - 1e-9) best = {seg: i, t, s: acc + Math.min(Math.max(t, i === 0 ? -1 : 0), i === pts.length - 2 ? 2 : 1) * L, dist: d};
    acc += L;
  }
  return best;
}

/** Weights along a chain of bones by arc length s with smooth blends of half-width h at each joint. */
function chainWeights(bones, lengths, s, h) {
  const out = {};
  let acc = 0;
  const bounds = [];
  for (let i = 0; i < lengths.length - 1; i++) { acc += lengths[i]; bounds.push(acc); }
  // weight of bone i = smoothstep over its start boundary minus over its end boundary
  for (let i = 0; i < bones.length; i++) {
    const a = i === 0 ? 1 : smoothstep(bounds[i - 1] - h, bounds[i - 1] + h, s);
    const b = i === bones.length - 1 ? 0 : smoothstep(bounds[i] - h, bounds[i] + h, s);
    const w = a - b;
    if (w > 1e-4) out[bones[i]] = (out[bones[i]] ?? 0) + w;
  }
  return out;
}

/**
 * @param mesh {pos, idx} welded low-poly mesh
 * @param skel {joints, ends, measures}
 */
export function computeQuadrupedWeights(mesh, skel, opts = {}) {
  // seedRadius (Meshy T2.5 migration): flood each leg from EVERY vertex within this distance of its foot -> toe segment
  // (low-poly sources carry claws / toes as separate mesh pieces, so the single vertex nearest the toe tip can sit on an
  // isolated claw and the flood never reaches the leg); 0 = the iteration-07 single nearest-vertex seed
  // islands (Meshy T2.5 migration): every small disconnected mesh piece (claws, toes, whiskers of a low-poly source) takes
  // the region of the nearest vertex of the main body, so it moves with the paw / snout it belongs to (default off)
  const {smoothIters = 4, smoothLambda = 0.5, legRatio = 0.55, jointBlend = 0.025, seedRadius = 0, islands = false} = opts;
  const P = mesh.pos, n = P.length / 3, J = skel.joints, E = skel.ends, M = skel.measures;
  const p = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const {offs, adj} = vertexAdjacency(n, mesh.idx);
  const spine = [J.Hips, J.Spine1, J.Spine2, J.Chest, J.Neck, J.Head, E.Head];
  const REG = {torso: 0, tail: 1, L_Front: 2, R_Front: 3, L_Hind: 4, R_Hind: 5};
  const region = new Int8Array(n).fill(REG.torso);
  const legInfo = {};
  // ---- legs: flood from the toe --------------------------------------------------------------
  for (const leg of ['L_Front', 'R_Front', 'L_Hind', 'R_Hind']) {
    const sg = leg[0] === 'L' ? 1 : -1;
    const chain = [J[leg + 'Upper'], J[leg + 'Lower'], J[leg + 'Foot'], E[leg + 'Foot']];
    const top = J[leg + 'Upper'][1] + 0.04;
    const ok = u => {
      const q = p(u);
      if (q[0] * sg < -0.005 || q[1] > top) return false;
      return onPolyline(q, chain).dist < legRatio * onPolyline(q, spine).dist;
    };
    let seed = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = len(sub(p(i), E[leg + 'Foot'])); if (d < bd) { bd = d; seed = i; } }
    const stack = [seed], seen = new Uint8Array(n); seen[seed] = 1;
    if (seedRadius > 0) {
      const foot = [J[leg + 'Foot'], E[leg + 'Foot']], yMax = J[leg + 'Foot'][1] + 0.03;
      for (let i = 0; i < n; i++) if (!seen[i] && region[i] === REG.torso && P[i * 3 + 1] < yMax && onPolyline(p(i), foot).dist < seedRadius && ok(i)) { seen[i] = 1; stack.push(i); }
    }
    let count = 0;
    while (stack.length) {
      const v = stack.pop();
      if (region[v] !== REG.torso) continue;
      region[v] = REG[leg]; count++;
      for (let k = offs[v]; k < offs[v + 1]; k++) { const u = adj[k]; if (!seen[u] && ok(u)) { seen[u] = 1; stack.push(u); } }
    }
    legInfo[leg] = {chain, count, lengths: chain.slice(0, -1).map((a, i) => len(sub(chain[i + 1], a)))};
  }
  let islandStats = null;
  if (islands) {
    const {label, sizes} = components(n, mesh.idx);
    let main = -1, best = -1;
    for (const [r, c] of sizes) if (c > best) { best = c; main = r; }
    const mainIds = [];
    for (let i = 0; i < n; i++) if (label[i] === main) mainIds.push(i);
    const byComp = new Map();
    for (let i = 0; i < n; i++) if (label[i] !== main) { let l = byComp.get(label[i]); if (!l) byComp.set(label[i], (l = [])); l.push(i); }
    islandStats = {pieces: byComp.size, vertices: 0, regions: {}};
    for (const ids of byComp.values()) {
      // nearest main-body vertex to the piece (over all its vertices)
      let bi = -1, bd = Infinity;
      for (const i of ids) for (const j of mainIds) { const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bi = j; } }
      for (const i of ids) region[i] = region[bi];
      islandStats.vertices += ids.length;
      const key = Object.keys(REG).find(k => REG[k] === region[bi]);
      islandStats.regions[key] = (islandStats.regions[key] ?? 0) + 1;
    }
    for (const leg of Object.keys(legInfo)) legInfo[leg].count = region.reduce((a, r) => a + (r === REG[leg]), 0);
  }
  // ---- tail: connected vertices behind the rump end, geodesic from the root ring -------------
  const rootZ = J.Tail1[2] + 0.02;
  const tmask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (region[i] === REG.torso && P[i * 3 + 2] < rootZ + 0.03 && P[i * 3 + 1] > 0.12 && Math.abs(P[i * 3]) < 0.16) tmask[i] = 1;
  const sources = [];
  for (let i = 0; i < n; i++) if (tmask[i] && P[i * 3 + 2] > rootZ) sources.push(i);
  const gd = geodesic(P, mesh.idx, tmask, sources);
  // tail joints' geodesic positions: nearest masked vertex to each joint
  const tailBones = ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5'];
  const jd = tailBones.map(b => { let bi = -1, bdd = Infinity; for (let i = 0; i < n; i++) if (tmask[i] && Number.isFinite(gd[i])) { const d = len(sub(p(i), J[b])); if (d < bdd) { bdd = d; bi = i; } } return bi >= 0 ? gd[bi] : 0; });
  for (let i = 0; i < n; i++) if (tmask[i] && Number.isFinite(gd[i]) && P[i * 3 + 2] < rootZ) region[i] = REG.tail;
  // ---- raw weights ----------------------------------------------------------------------------
  const W = new Float32Array(n * NJ);
  const allowed = Array.from({length: n}, () => new Set());
  const add = (i, name, w) => { if (w > 0) { W[i * NJ + JI[name]] += w; allowed[i].add(JI[name]); } };
  const spineBones = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck', 'Head'];
  const spineLens = spine.slice(0, -1).map((a, i) => len(sub(spine[i + 1], a)));
  // mouth line: hinge -> lip corner point under the nose (between the nose tip and the chin)
  const lip = [0, (E.Head[1] + E.Jaw[1]) / 2, (E.Head[2] + E.Jaw[2]) / 2];
  const hinge = J.Jaw;
  const underMouth = q => {
    if (q[2] < hinge[2] - 0.03) return 0;
    const t = Math.min(1, Math.max(0, (q[2] - hinge[2]) / (lip[2] - hinge[2] || 1)));
    const lineY = hinge[1] + (lip[1] - hinge[1]) * t;
    return smoothstep(0.008, -0.008, q[1] - lineY) * smoothstep(hinge[2] - 0.03, hinge[2] + 0.01, q[2]);
  };
  for (let i = 0; i < n; i++) {
    const q = p(i), r = region[i];
    if (r >= REG.L_Front) {
      const leg = Object.keys(REG).find(k => REG[k] === r);
      const info = legInfo[leg];
      const pr = onPolyline(q, info.chain);
      const cw = chainWeights([leg + 'Upper', leg + 'Lower', leg + 'Foot'], info.lengths, pr.s, jointBlend);
      const up = J[leg + 'Upper'], low = J[leg + 'Lower'];
      const girdle = leg.includes('Front') ? 'Chest' : 'Hips';
      const ft = leg.includes('Front') ? smoothstep(low[1] + 0.03, up[1] + 0.03, q[1]) : smoothstep(up[1] - 0.06, up[1] + 0.04, q[1]);
      for (const [b, w] of Object.entries(cw)) add(i, b, w * (1 - ft));
      if (ft > 0) {
        // the girdle skin follows the spine around it
        const sp = chainWeights(spineBones, spineLens, onPolyline(q, spine).s, 0.05);
        for (const [b, w] of Object.entries(sp)) add(i, b, w * ft);
      }
    } else if (r === REG.tail) {
      const d = gd[i];
      // piecewise along the tail joints' geodesic distances (Hips before Tail1)
      const knots = [[-0.03, 'Hips'], ...tailBones.map((b, k) => [jd[k], b])];
      let placed = false;
      for (let k = 0; k < knots.length - 1; k++) {
        const [d0, b0] = knots[k], [d1, b1] = knots[k + 1];
        if (d <= d1) { const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0 || 1))); const tt = smoothstep(0.35, 0.65, t); add(i, b0, 1 - tt); add(i, b1, tt); placed = true; break; }
      }
      if (!placed) add(i, 'Tail5', 1);
    } else {
      const pr = onPolyline(q, spine);
      const sp = chainWeights(spineBones, spineLens, pr.s, 0.05);
      const jw = underMouth(q);
      for (const [b, w] of Object.entries(sp)) add(i, b, w * (1 - jw));
      if (jw > 0) add(i, 'Jaw', jw);
      // vertices just behind the tail root: let the root bend them a little
      if (q[2] < J.Hips[2] && Number.isFinite(gd[i]) && tmask[i]) add(i, 'Tail1', 0.15 * smoothstep(J.Hips[2], rootZ, q[2]));
    }
  }
  // ---- masked Laplacian smoothing --------------------------------------------------------------
  // a vertex may also take the bones of its direct neighbours' regions (soft seams), never others
  const allow = allowed.map(s => new Set(s));
  for (let i = 0; i < n; i++) for (let k = offs[i]; k < offs[i + 1]; k++) for (const b of allowed[adj[k]]) allow[i].add(b);
  let cur = W;
  for (let it = 0; it < smoothIters; it++) {
    const nx = new Float32Array(n * NJ);
    for (let i = 0; i < n; i++) {
      const deg = offs[i + 1] - offs[i];
      for (const b of allow[i]) {
        let s = 0;
        for (let k = offs[i]; k < offs[i + 1]; k++) s += cur[adj[k] * NJ + b];
        nx[i * NJ + b] = (1 - smoothLambda) * cur[i * NJ + b] + smoothLambda * (deg ? s / deg : cur[i * NJ + b]);
      }
    }
    cur = nx;
  }
  // ---- top-4 -----------------------------------------------------------------------------------
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  let maxInfl = 0;
  for (let i = 0; i < n; i++) {
    const list = [];
    for (let b = 0; b < NJ; b++) { const w = cur[i * NJ + b]; if (w > 1e-3) list.push([b, w]); }
    list.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = list.slice(0, 4);
    const s = top.reduce((a, x) => a + x[1], 0) || 1;
    if (!top.length) top.push([JI.Hips, 1]);
    maxInfl = Math.max(maxInfl, top.length);
    top.forEach(([b, w], k) => { joints[i * 4 + k] = b; weights[i * 4 + k] = w / s; });
  }
  const regionCounts = Object.fromEntries(Object.entries(REG).map(([k, v]) => [k, region.reduce((a, r) => a + (r === v ? 1 : 0), 0)]));
  return {joints, weights, region, stats: {method: 'region flood (legs from the toe, tail by geodesic distance) + chain weights with smooth joint blends + masked Laplacian smoothing, top-4', regionCounts, legRatio, jointBlend, smoothIters, smoothLambda, maxInfluences: maxInfl, tailJointGeodesicM: jd.map(v => +v.toFixed(3)), ...(seedRadius ? {legSeedRadiusM: seedRadius} : {}), ...(islandStats ? {islands: islandStats} : {})}};
}
