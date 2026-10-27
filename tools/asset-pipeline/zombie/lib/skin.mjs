// Practical automatic skin weights (not a heat-diffusion solver):
//  1. region labels: arms = mesh-connected flood fill from the hand/cuff restricted to the outer
//     side of a cut plane through the armpit and the acromion (so torso flanks under the armpit,
//     which are closer to the upper-arm bone than to the spine, are never captured);
//     legs = below the crotch split by x; pelvis; torso/head.
//  2. per-region chain weights (projection onto the bone chain / height bands) with smooth
//     blends at joints; tilted neck/head boundary so the jaw follows the head.
//  3. masked Laplacian smoothing (bones a vertex may never receive are re-zeroed every pass:
//     no left-thigh weight on the right leg, no arm weight on the head, etc.).
//  4. top-4 influences, normalized.
import {JOINTS} from './skeleton.mjs';
import {vertexAdjacency} from './mesh.mjs';

export const JOINT_NAMES = JOINTS.map(j => j[0]);
const JI = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i]));
const NJ = JOINT_NAMES.length;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Closest point parameter on a polyline: returns {seg, t (0..1 on seg), s (arc length), dist}. */
function onPolyline(p, pts) {
  let best = null, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ab = sub(b, a), L = len(ab);
    let t = dot(sub(p, a), ab) / (L * L);
    const tc = Math.min(1, Math.max(0, t));
    const q = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
    const d = len(sub(p, q));
    if (!best || d < best.dist - 1e-9) best = {seg: i, t, s: acc + Math.min(Math.max(t, i === 0 ? -1 : 0), i === pts.length - 2 ? 2 : 1) * L, dist: d};
    acc += L;
  }
  return best;
}

/**
 * @param mesh {pos, idx} welded mesh (weights are later copied to UV-split vertices)
 * @param rig {joints, ends, cut: {L:{A,T}, R:{A,T}}, crotchY, hipY, neckY, headY, kneeY, ankleY}
 * @param opts {kind:'body'|'coat', smoothIters, coatThighMax}
 */
export function computeSkinWeights(mesh, rig, opts = {}) {
  const {kind = 'body', smoothIters = 4, smoothLambda = 0.5, coatThighMax = 0.45, armRule = 'wall', armProximityRatio = 0.55, rigidHeadFront = null} = opts;
  const P = mesh.pos, n = P.length / 3;
  const J = rig.joints;
  const {offs, adj} = vertexAdjacency(n, mesh.idx);
  const p = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

  // ---- 1. regions ---------------------------------------------------------------------
  const REG = {torso: 0, armL: 1, armR: 2, legL: 3, legR: 4};
  const region = new Int8Array(n).fill(REG.torso);
  const cutSd = {}, adoptedTotal = {};
  for (const side of ['L', 'R']) {
    const {A, T} = rig.cut[side];
    const sg = side === 'L' ? 1 : -1;
    let nn = nrm(cross(sub(T, A), [0, 0, 1]));
    if (nn[0] * sg < 0) nn = nn.map(v => -v);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = dot(sub(p(i), A), nn);
    cutSd[side] = sd;
    // seed: vertex farthest along the arm chain (hand tip / cuff)
    const tip = rig.ends[side + '_Hand'];
    let seed = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = len(sub(p(i), tip)); if (d < bd) { bd = d; seed = i; } }
    // below the armpit the arm is separated from the torso: only accept vertices clearly
    // outside the measured torso wall there (prevents leaking down the flank into hips/legs)
    const wallAt = y => { const w = rig.wall; if (!w) return 0; const k = Math.round((y - w.y0) / w.step); const arr = w[side]; return k < 0 ? arr[0] : k >= arr.length ? arr[arr.length - 1] : arr[k]; };
    // armRule 'proximity' (iteration 06, bodies whose wide sleeves hang beside bulky hip gear): below
    // the armpit a vertex belongs to the arm when it is clearly closer to the arm bone chain than to
    // the spine chain (the slice-measured torso wall includes pouches/flaps there and cut sleeves in two)
    const spine = [J.Hips, J.Spine, J.Chest, J.Neck];
    const armC = [J[side + '_UpperArm'], J[side + '_Forearm'], J[side + '_Hand'], rig.ends[side + '_Hand']];
    const below = u => armRule === 'proximity'
      ? onPolyline(p(u), armC).dist < armProximityRatio * onPolyline(p(u), spine).dist
      : sg * P[u * 3] > wallAt(P[u * 3 + 1]) + (rig.wallMargin ?? 0.015);
    const ok = u => sd[u] > 0 && (P[u * 3 + 1] > A[1] - 0.01 || below(u));
    const stack = [seed]; const seen = new Uint8Array(n); seen[seed] = 1;
    while (stack.length) {
      const v = stack.pop();
      region[v] = REG['arm' + side];
      for (let k = offs[v]; k < offs[v + 1]; k++) { const u = adj[k]; if (!seen[u] && ok(u)) { seen[u] = 1; stack.push(u); } }
    }
    // disconnected pieces (sleeve lining / cuff shells) the flood cannot reach: same geometric
    // test plus proximity to the arm bone chain
    const chain = [J[side + '_UpperArm'], J[side + '_Forearm'], J[side + '_Hand'], rig.ends[side + '_Hand']];
    let adopted = 0;
    for (let i = 0; i < n; i++) {
      if (region[i] !== REG.torso || !ok(i)) continue;
      if (onPolyline(p(i), chain).dist < 0.16) { region[i] = REG['arm' + side]; adopted++; }
    }
    adoptedTotal[side] = adopted;
  }
  if (kind === 'body') {
    for (let i = 0; i < n; i++) {
      if (region[i] !== REG.torso) continue;
      if (P[i * 3 + 1] < rig.crotchY) region[i] = P[i * 3] >= 0 ? REG.legL : REG.legR;
    }
  }

  // ---- 2. raw weights -----------------------------------------------------------------
  const W = new Float32Array(n * NJ);
  const add = (i, name, w) => { if (w > 0) W[i * NJ + JI[name]] += w; };
  const spineChain = kind === 'coat'
    ? [['Hips', -Infinity], ['Spine', J.Spine[1]], ['Chest', J.Chest[1]], ['Neck', J.Neck[1]]]
    : [['Hips', -Infinity], ['Spine', J.Spine[1]], ['Chest', J.Chest[1]], ['Neck', J.Neck[1]], ['Head', J.Head[1]]];
  const blendHalf = {Spine: 0.06, Chest: 0.07, Neck: 0.03, Head: 0.025};
  const spineWeights = (y, z) => {
    // tilt the neck/head boundary: front (jaw/chin) counts as higher, nape as lower
    const tiltK = smoothstep(J.Neck[1] - 0.04, J.Neck[1] + 0.02, y);
    const h = y + 1.0 * (z - J.Neck[2]) * tiltK;
    const out = {};
    out.Hips = 1;
    for (let k = 1; k < spineChain.length; k++) {
      const [name, y0] = spineChain[k];
      const hh = (name === 'Head' || name === 'Neck') ? h : y;
      const b = blendHalf[name];
      const f = smoothstep(y0 - b, y0 + b, hh);
      if (f <= 0) break;
      // move fraction f of the previous bone's weight to this bone
      const prev = spineChain[k - 1][0];
      const moved = out[prev] * f;
      out[prev] -= moved; out[name] = moved;
    }
    return out;
  };
  const armChain = side => [J[side + '_UpperArm'], J[side + '_Forearm'], J[side + '_Hand'], rig.ends[side + '_Hand']];
  const segLen = pts => pts.slice(0, -1).map((a, i) => len(sub(pts[i + 1], a)));

  for (let i = 0; i < n; i++) {
    const q = p(i), [x, y, z] = q, r = region[i];
    if (r === REG.armL || r === REG.armR) {
      const side = r === REG.armL ? 'L' : 'R';
      const ch = armChain(side), L = segLen(ch);
      const pr = onPolyline(q, ch);
      const sE = L[0], sW = L[0] + L[1];
      const s = pr.s;
      // shoulder blend across the cut plane (Chest <-> UpperArm), symmetric with the torso side
      const sd = cutSd[side][i];
      const wArm = 0.5 + 0.5 * smoothstep(0, 0.045, sd);
      const fE = smoothstep(sE - 0.045, sE + 0.035, s); // UpperArm -> Forearm
      const fW = smoothstep(sW - 0.02, sW + 0.03, s);   // Forearm -> Hand
      add(i, 'Chest', 1 - wArm);
      add(i, side + '_UpperArm', wArm * (1 - fE));
      add(i, side + '_Forearm', wArm * fE * (1 - fW));
      add(i, side + '_Hand', wArm * fE * fW);
      continue;
    }
    // torso / pelvis / legs share the vertical decomposition
    let thighW = 0, side = x >= 0 ? 'L' : 'R';
    if (kind === 'body') {
      const heightRamp = smoothstep(rig.hipY + 0.10, rig.hipY - 0.12, y);
      const sideFade = smoothstep(0.0, 0.07, Math.abs(x));
      const below = smoothstep(rig.crotchY, rig.crotchY - 0.10, y);
      thighW = heightRamp * (sideFade + (1 - sideFade) * below);
    } else {
      // coat skirt: partial thigh follow, fading to Hips on the centre line (front/back panels)
      thighW = coatThighMax * smoothstep(rig.hipY + 0.05, rig.crotchY - 0.05, y) * smoothstep(0.03, 0.15, Math.abs(x));
    }
    if (thighW > 0) {
      if (kind === 'body' && (r === REG.legL || r === REG.legR || y < rig.hipY)) {
        const fK = smoothstep(J[side + '_Shin'][1] + 0.05, J[side + '_Shin'][1] - 0.05, y);
        const fA = smoothstep(J[side + '_Foot'][1] + 0.035, J[side + '_Foot'][1] - 0.03, y);
        add(i, side + '_Thigh', thighW * (1 - fK));
        add(i, side + '_Shin', thighW * fK * (1 - fA));
        add(i, side + '_Foot', thighW * fK * fA);
      } else add(i, side + '_Thigh', thighW);
    }
    const rest = 1 - thighW;
    const sw = spineWeights(y, z);
    for (const [name, w] of Object.entries(sw)) add(i, name, rest * w);
    // torso side of the shoulder cut: share with UpperArm near the plane (mirror of arm side)
    for (const s of ['L', 'R']) {
      const sd = cutSd[s][i];
      if (sd > -0.045 && sd <= 0 && len(sub(q, J[s + '_UpperArm'])) < 0.17 && y < J.Neck[1]) {
        const wArm = 0.5 * smoothstep(-0.045, 0, sd);
        // move wArm from whatever spine bones hold it to the upper arm
        const tot = W.subarray(i * NJ, i * NJ + NJ).reduce((a, b) => a + b, 0) || 1;
        for (let j = 0; j < NJ; j++) W[i * NJ + j] *= (1 - wArm) / tot;
        add(i, s + '_UpperArm', wArm);
      }
    }
  }

  // ---- 3. allowed-bone masks + masked Laplacian smoothing --------------------------------
  const allowed = new Uint8Array(n * NJ);
  for (let i = 0; i < n; i++) {
    const q = p(i), r = region[i], a = allowed.subarray(i * NJ, i * NJ + NJ);
    const set = names => names.forEach(nm => { a[JI[nm]] = 1; });
    if (r === REG.armL || r === REG.armR) { const s = r === REG.armL ? 'L' : 'R'; set(['Chest', s + '_UpperArm', s + '_Forearm', s + '_Hand']); continue; }
    if (r === REG.legL || r === REG.legR) { const s = r === REG.legL ? 'L' : 'R'; set(['Hips', 'Spine', s + '_Thigh', s + '_Shin', s + '_Foot']); continue; }
    set(['Hips', 'Spine', 'Chest', 'Neck']);
    if (kind === 'body') set(['Head']);
    for (const s of ['L', 'R']) {
      if (len(sub(q, J[s + '_UpperArm'])) < 0.18 && q[1] < J.Neck[1] && cutSd[s][i] > -0.06) set([s + '_UpperArm']);
      const sx = s === 'L' ? q[0] : -q[0];
      if (kind === 'body' && sx > -0.005 && q[1] < rig.hipY + 0.12) set([s + '_Thigh', s + '_Shin', s + '_Foot']);
      if (kind === 'coat' && sx > 0 && q[1] < rig.hipY + 0.06) set([s + '_Thigh']);
    }
  }
  // rigidHeadFront (iteration 06): rigid items fused into the head (a gas mask + side filter on the
  // reused scavenger) follow the head only: vertices above the neck base and in front of the neck
  // get 100% Head and may not blend (the tilted neck/head boundary otherwise split the filter)
  let rigidFront = 0;
  if (rigidHeadFront != null && kind === 'body') {
    const yMin = (rig.neckY ?? J.Neck[1]) - 0.02, zMin = J.Neck[2] + rigidHeadFront;
    for (let i = 0; i < n; i++) {
      if (region[i] !== REG.torso || P[i * 3 + 1] < yMin || P[i * 3 + 2] < zMin) continue;
      // only vertices the neck/head chain already gives mostly to Neck/Head (never the collar / chest)
      if (W[i * NJ + JI.Head] + W[i * NJ + JI.Neck] < 0.5) continue;
      allowed.fill(0, i * NJ, i * NJ + NJ); allowed[i * NJ + JI.Head] = 1; rigidFront++;
    }
  }
  for (let i = 0; i < n * NJ; i++) if (!allowed[i]) W[i] = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < NJ; j++) s += W[i * NJ + j]; if (s <= 0 && allowed[i * NJ + JI.Head] && !allowed[i * NJ + JI.Hips]) W[i * NJ + JI.Head] = 1; }
  normalizeRows(W, n);
  for (let it = 0; it < smoothIters; it++) {
    const Wn = new Float32Array(W.length);
    for (let i = 0; i < n; i++) {
      const deg = offs[i + 1] - offs[i];
      for (let j = 0; j < NJ; j++) {
        if (!allowed[i * NJ + j]) continue;
        let s = 0;
        for (let k = offs[i]; k < offs[i + 1]; k++) s += W[adj[k] * NJ + j];
        Wn[i * NJ + j] = (1 - smoothLambda) * W[i * NJ + j] + smoothLambda * (deg ? s / deg : W[i * NJ + j]);
      }
    }
    W.set(Wn);
    normalizeRows(W, n);
  }

  // ---- 4. top-4 -------------------------------------------------------------------------
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  let truncated = 0;
  for (let i = 0; i < n; i++) {
    const row = Array.from(W.subarray(i * NJ, i * NJ + NJ), (w, j) => [w, j]).filter(e => e[0] > 1e-4).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (row.length > 4) truncated++;
    const top = row.slice(0, 4);
    const s = top.reduce((a, e) => a + e[0], 0);
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = top[k] ? top[k][1] : 0;
      weights[i * 4 + k] = top[k] ? top[k][0] / s : 0;
    }
    // exact normalization in float32
    const sum = weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3];
    weights[i * 4] += 1 - sum;
  }
  const counts = {};
  for (let i = 0; i < n; i++) { const k = Object.keys(REG).find(k => REG[k] === region[i]); counts[k] = (counts[k] || 0) + 1; }
  return {joints, weights, region, stats: {regionVertexCounts: counts, armVerticesAdoptedOutsideFlood: adoptedTotal, verticesWithMoreThan4Truncated: truncated, smoothIters, smoothLambda, armRule, ...(armRule === 'proximity' ? {armProximityRatio} : {}), ...(rigidHeadFront != null ? {rigidHeadFrontVertices: rigidFront, rigidHeadFrontZOffsetM: rigidHeadFront} : {})}};
}

function normalizeRows(W, n) {
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = 0; j < NJ; j++) s += W[i * NJ + j];
    if (s <= 0) { W[i * NJ + JI.Hips] = 1; continue; }
    for (let j = 0; j < NJ; j++) W[i * NJ + j] /= s;
  }
}

/**
 * Garment weight transfer: each garment vertex copies the (barycentric-blended) weights of the
 * closest point on the skinned body. Below the crotch the closest points lie on separate legs,
 * which would tear the back panel at the centre line, so the skirt uses a centre-faded rule
 * (Hips + partial thigh follow) blended in over [crotchY-0.05, crotchY+0.08]. Head -> Neck so
 * the hood/collar never follows head turns. Masked smoothing + top-4 as for the body.
 */
export function transferWeights(garment, body, bodyW, rig, {thighMax = 0.45, smoothIters = 3, smoothLambda = 0.5, grid, skirt = true, region = null, armpitY = null} = {}) {
  const P = garment.pos, n = P.length / 3;
  // iteration 06 region mask (garments): torso-panel vertices below the armpit may not take arm
  // weights (the closest body point of a jacket flank is often the inner upper arm of bodies whose
  // arms hang close: the whole flank then rose with the arm as a 'batwing'); sleeve vertices may only
  // take their own arm chain + Chest
  const ARMS = {L: ['L_UpperArm', 'L_Forearm', 'L_Hand'].map(n => JI[n]), R: ['R_UpperArm', 'R_Forearm', 'R_Hand'].map(n => JI[n])};
  // torso panels: arm weights fade out from 3 cm to 15 cm below the armpit (attenuated at the start
  // and once more after smoothing, so the sleeve seam stays a smooth blend); sleeves: hard mask
  const forbid = region ? new Uint8Array(n * NJ) : null;
  const atten = region ? new Float32Array(n).fill(1) : null;
  let panelVerts = 0;
  if (region) for (let i = 0; i < n; i++) {
    const f = forbid.subarray(i * NJ, i * NJ + NJ);
    if (region[i] === 0) { if (armpitY != null) { atten[i] = 1 - smoothstep(armpitY - 0.03, armpitY - 0.15, P[i * 3 + 1]); if (atten[i] < 1) panelVerts++; } }
    else { const own = region[i] === 1 ? ARMS.L : ARMS.R; for (let j = 0; j < NJ; j++) if (j !== JI.Chest && !own.includes(j)) f[j] = 1; }
  }
  const applyForbid = (row, i, attenuate = false) => {
    if (!forbid) return;
    if (attenuate && atten[i] < 1) for (const j of [...ARMS.L, ...ARMS.R]) row[j] *= atten[i];
    let s = 0; for (let j = 0; j < NJ; j++) { if (forbid[i * NJ + j]) row[j] = 0; s += row[j]; }
    if (s <= 1e-6) row[JI.Chest] = 1;
  };
  const {offs, adj} = vertexAdjacency(n, garment.idx);
  const bp = i => [body.pos[i * 3], body.pos[i * 3 + 1], body.pos[i * 3 + 2]];
  const W = new Float32Array(n * NJ);
  let maxDist = 0, far = 0;
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    // closest body triangle via the grid (expanding shells)
    const c = [0, 1, 2].map(k => Math.floor((p[k] - grid.min[k]) / grid.cell));
    let best = null, bd = Infinity;
    // shells grow until a triangle is found (loose garments on thin bodies can sit > 6 cells away)
    const rMax = Math.max(grid.dims[0], grid.dims[1], grid.dims[2]);
    for (let r = 1; r <= rMax && !(best && (bd <= (r - 1) * grid.cell || r > 6)); r++) {
      for (let z = c[2] - r; z <= c[2] + r; z++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let x = c[0] - r; x <= c[0] + r; x++) {
        if (x < 0 || y < 0 || z < 0 || x >= grid.dims[0] || y >= grid.dims[1] || z >= grid.dims[2]) continue;
        if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r && r > 1) continue;
        const ci = (z * grid.dims[1] + y) * grid.dims[0] + x;
        for (let k = grid.start[ci]; k < grid.start[ci + 1]; k++) {
          const t = grid.tris[k];
          const a = body.idx[t * 3], b = body.idx[t * 3 + 1], cc = body.idx[t * 3 + 2];
          const res = closestBary(p, bp(a), bp(b), bp(cc));
          if (res.d < bd) { bd = res.d; best = {a, b, c: cc, w: res.w}; }
        }
      }
    }
    maxDist = Math.max(maxDist, bd); if (bd > 0.1) far++;
    const row = new Float32Array(NJ);
    for (const [v, bw] of [[best.a, best.w[0]], [best.b, best.w[1]], [best.c, best.w[2]]])
      for (let k = 0; k < 4; k++) row[bodyW.joints[v * 4 + k]] += bw * bodyW.weights[v * 4 + k];
    row[JI.Neck] += row[JI.Head]; row[JI.Head] = 0;
    // skirt rule below the crotch
    const [x, y] = p;
    // pants (skirt: false): every vertex keeps the closest body point's weights (each leg follows its own thigh/shin)
    const fSkirt = skirt ? smoothstep(rig.crotchY + 0.08, rig.crotchY - 0.05, y) : 0;
    if (fSkirt > 0) {
      const thighW = thighMax * smoothstep(rig.hipY + 0.05, rig.crotchY - 0.05, y) * smoothstep(0.03, 0.15, Math.abs(x));
      const skirt = new Float32Array(NJ);
      skirt[JI[(x >= 0 ? 'L' : 'R') + '_Thigh']] = thighW; skirt[JI.Hips] = 1 - thighW;
      for (let j = 0; j < NJ; j++) row[j] = (1 - fSkirt) * row[j] + fSkirt * skirt[j];
    }
    applyForbid(row, i, true);
    W.set(row, i * NJ);
  }
  // allowed mask = joints present in the vertex or its neighbours (prevents distant bleeding)
  const allowed = new Uint8Array(n * NJ);
  for (let i = 0; i < n; i++) for (let j = 0; j < NJ; j++) if (W[i * NJ + j] > 0.02) allowed[i * NJ + j] = 1;
  normalizeRows(W, n);
  for (let it = 0; it < smoothIters; it++) {
    const Wn = new Float32Array(W.length);
    for (let i = 0; i < n; i++) {
      const deg = offs[i + 1] - offs[i];
      for (let j = 0; j < NJ; j++) {
        let s = 0; for (let k = offs[i]; k < offs[i + 1]; k++) s += W[adj[k] * NJ + j];
        Wn[i * NJ + j] = (1 - smoothLambda) * W[i * NJ + j] + smoothLambda * (deg ? s / deg : W[i * NJ + j]);
      }
    }
    // a vertex may only gain joints that a neighbour already had (one-ring), never L<->R swaps
    for (let i = 0; i < n; i++) for (let j = 0; j < NJ; j++) if (!allowed[i * NJ + j]) {
      let nb = false; for (let k = offs[i]; k < offs[i + 1] && !nb; k++) nb = allowed[adj[k] * NJ + j] === 1;
      if (!nb) Wn[i * NJ + j] = 0;
    }
    if (forbid) for (let i = 0; i < n; i++) applyForbid(Wn.subarray(i * NJ, i * NJ + NJ), i, it === smoothIters - 1);
    W.set(Wn); normalizeRows(W, n);
  }
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const row = Array.from(W.subarray(i * NJ, i * NJ + NJ), (w, j) => [w, j]).filter(e => e[0] > 1e-4).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 4);
    const s = row.reduce((a, e) => a + e[0], 0);
    for (let k = 0; k < 4; k++) { joints[i * 4 + k] = row[k] ? row[k][1] : 0; weights[i * 4 + k] = row[k] ? row[k][0] / s : 0; }
    weights[i * 4] += 1 - (weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3]);
  }
  return {joints, weights, stats: {method: 'closest-point transfer from body weights (barycentric), Head->Neck' + (skirt ? ', centre-faded skirt rule below crotch' : ', no skirt rule (pants)') + ', masked smoothing' + (region ? '; region mask: arm weights on torso panels fade out 3-15 cm below the armpit, sleeves keep their own arm chain + Chest' : ''), maxDistToBodyM: +maxDist.toFixed(4), verticesFartherThan10cm: far, thighFollowMax: thighMax, smoothIters, ...(region ? {panelVerticesArmFree: panelVerts} : {})}};
}

function closestBary(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let w;
  if (d1 <= 0 && d2 <= 0) w = [1, 0, 0];
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) w = [0, 1, 0];
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w = [1 - v, v, 0]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) w = [0, 0, 1];
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); w = [1 - t, 0, t]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w = [0, 1 - t, t]; }
            else { const den = 1 / (va + vb + vc); const v = vb * den, ww = vc * den; w = [1 - v - ww, v, ww]; }
          }
        }
      }
    }
  }
  const q = [a[0] * w[0] + b[0] * w[1] + c[0] * w[2], a[1] * w[0] + b[1] * w[1] + c[1] * w[2], a[2] * w[0] + b[2] * w[1] + c[2] * w[2]];
  return {w, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])};
}
