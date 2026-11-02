// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): fits one clean Meshy lingerie set (lib/lingerie-garment.mjs: TOP +
// BOTTOM pieces, simplified) to one WRITTEN wardrobe body (lib/lingerie-body.mjs), pose-aware, and derives its skin weights and the
// runtime masks. The body is only read. Deterministic (no randomness; fixed iteration counts).
//
//  1. landmark alignment (one vertical affine map for the whole set, so the design's own heights stay: high-waist stays high):
//     garment cup apex height -> the body's breast apex height, garment crotch (lowest midline point of the brief) -> the body's
//     crotch; s = (apexY - crotchY)_body / (apexY - crotchY)_garment. Horizontal, per piece and height (5 mm bins, smoothed): the
//     piece's own width / depth / centre -> the body's torso cross-section there (+ the cloth offset) wherever the piece is a closed
//     tube (band, brief, bodysuit, garter belt); above a piece's tube (straps) and below it (suspender straps, thigh rings) the
//     nearest tube mapping is held, then the cup apices are moved onto the breast apices (lateral warp of the top piece that fades
//     out at the side seam) and the strap crests onto the shoulder strap line (|x| = 0.72 x the shoulder joint, medial on the
//     trapezius).
//  2. thigh rings / closed leg loops are re-centred on the thigh's own cross-section at their height (rigid per component).
//  3. non-rigid conformity (shrink-wrap): per welded vertex the closest point of the body's FIT surface (closed skin, torso + legs;
//     never arms / head / hair) gives a signed distance; the target is offset + the vertex's own layer height (outer face of a thin
//     sheet = its measured thickness, inner face 0), the correction along the body normal is Laplacian-smoothed over the cloth
//     (smoothing schedule 24 -> 2 passes) so the cloth bridges hollows (cleavage, butt crease) and keeps the design's relief.
//  4. clearance: any vertex closer than minClear is pushed out along the skin normal (diffused to its neighbours, no kinks).
//  5. skin weights: each cloth vertex copies the body's own weights interpolated (barycentric) at its closest fit-surface point
//     (Head -> Neck), light Laplacian smoothing over the cloth, top-4 normalised: cloth and the skin under it deform alike.
//  6. pose-aware clearance: every validation pose (every 3rd frame of all six clips) is skinned; a vertex that comes closer than
//     poseClear to the posed skin (or sinks) in ANY pose is pushed out in the bind pose by that deficit (diffused, capped), weights
//     re-derived; repeated.
//  7. masks: body triangles fully enclosed by the piece (normal + 4 tilted rays from below the skin hit it within maxDist) are
//     hidden while it is worn; bottom-piece triangles under the top piece likewise (layering, e.g. suspender tops under a bustier).
import {TriGrid, weldMap, insideByParity} from './penetration.mjs';
import {coverMask} from './fit.mjs';
import {GROUP} from './lingerie-body.mjs';

const r4 = v => +(+v).toFixed(4), mm = v => +(v * 1000).toFixed(2);
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const FIT = {
  offset: {top: 0.0035, bottom: 0.003},   // cloth inner face above the skin (m)
  layerMax: 0.007,                         // max layer height kept for an outer face (thin closed sheets: 2-4 mm)
  minClear: 0.0015,                        // bind clearance floor
  poseClear: 0.0008,                       // posed clearance floor (any validation pose)
  poseRounds: +(process.env.LING_POSE_ROUNDS ?? 3), posePushMax: 0.012,
  wrapIterations: 14, wrapRadius: [0.035, 0.008],     // spatial smoothing radius of the conformity correction (coarse -> fine)
  pushRadius: 0.012,                       // clearance push dilation radius
  weightSmooth: {iters: 2, lambda: 0.3},
  strapLineFactor: 0.72,
  tubeMin: 0.55,                           // a height bin is a "tube" when the piece spans >= this fraction of the body's width and depth
  mask: {maxDist: 0.025, tiltDeg: 30, inset: 0.006},
  layerMask: {maxDist: 0.012, tiltDeg: 20, inset: 0.0015},
};

// ------------------------------------------------------------------------------------------------ welded cloth graph
export function clothGraph(piece) {
  const {remap, uniq} = weldMap(piece.pos);
  const n = piece.pos.length / 3;
  const adj = new Map(); for (const i of uniq) adj.set(i, new Set());
  for (let t = 0; t < piece.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = remap[piece.idx[t + k]], b = remap[piece.idx[t + (k + 1) % 3]]; if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); } }
  const nb = new Map([...adj].map(([i, s]) => [i, Uint32Array.from([...s].sort((x, y) => x - y))]));
  // welded triangle list (for normals / grids)
  const widx = Uint32Array.from(piece.idx, v => remap[v]);
  return {remap, uniq, nb, widx, n};
}

function laplace(G, field, dim, iters, lambda = 0.5, fixed = null) {
  let cur = field;
  for (let it = 0; it < iters; it++) {
    const next = cur.slice();
    for (const i of G.uniq) {
      if (fixed && fixed[i]) continue;
      const nb = G.nb.get(i); if (!nb.length) continue;
      for (let k = 0; k < dim; k++) { let s = 0; for (const j of nb) s += cur[j * dim + k]; next[i * dim + k] = cur[i * dim + k] + lambda * (s / nb.length - cur[i * dim + k]); }
    }
    cur = next;
  }
  return cur;
}
const spread = (G, arr, dim) => { for (let i = 0; i < G.n; i++) { const r = G.remap[i]; if (r !== i) for (let k = 0; k < dim; k++) arr[i * dim + k] = arr[r * dim + k]; } return arr; };

function geomNormals(pos, widx, n) {
  const acc = new Float64Array(n * 3);
  for (let t = 0; t < widx.length; t += 3) {
    const a = widx[t] * 3, b = widx[t + 1] * 3, c = widx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[v + k] += f[k];
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]); if (l > 0) for (let k = 0; k < 3; k++) out[i * 3 + k] = acc[i * 3 + k] / l; }
  return out;
}

/** Closest point on the body FIT surface (+ interpolated welded skin normal, signed distance, barycentrics). */
function fitClosest(B, grid, idx, nrm, x, y, z, maxR = 0.12) {
  const c = grid.closest(x, y, z, maxR);
  if (!c) return null;
  const a = idx[c.tri * 3], b = idx[c.tri * 3 + 1], e = idx[c.tri * 3 + 2], q = c.q;
  let nx = q[3] * nrm[a * 3] + q[4] * nrm[b * 3] + q[5] * nrm[e * 3], ny = q[3] * nrm[a * 3 + 1] + q[4] * nrm[b * 3 + 1] + q[5] * nrm[e * 3 + 1], nz = q[3] * nrm[a * 3 + 2] + q[4] * nrm[b * 3 + 2] + q[5] * nrm[e * 3 + 2];
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const s = (x - q[0]) * nx + (y - q[1]) * ny + (z - q[2]) * nz;
  return {q, n: [nx, ny, nz], sd: s < 0 ? -c.d : c.d, d: c.d, v: [a, b, e], bary: [q[3], q[4], q[5]], tri: c.tri};
}


// ------------------------------------------------------------------------------------------------ spatial neighbourhoods
/** Welded vertices within `radius` of each welded vertex (uniform hash grid): [ids, dists] per vertex. Spatial (not graph)
 *  neighbourhoods couple the two faces of a thin closed sheet (inner / outer face are graph-adjacent only at the rim), so a
 *  smoothed correction moves both faces alike and the sheet keeps its thickness (never collapses / inverts). */
export function spatialNeighbours(G, P, radius) {
  const cell = radius, key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const H = new Map();
  for (const i of G.uniq) { const k = key(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); let a = H.get(k); if (!a) H.set(k, a = []); a.push(i); }
  const out = new Map();
  for (const i of G.uniq) {
    const cx = Math.floor(P[i * 3] / cell), cy = Math.floor(P[i * 3 + 1] / cell), cz = Math.floor(P[i * 3 + 2] / cell);
    const ids = [], ds = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = H.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (const j of a) { const d = Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]); if (d <= radius) { ids.push(j); ds.push(d); } }
    }
    out.set(i, {ids, ds});
  }
  return out;
}
function spatialSmooth(G, NB, field, dim, radius) {
  const out = new Float32Array(field.length), sig = radius / 2;
  for (const i of G.uniq) {
    const {ids, ds} = NB.get(i); let w = 0; const acc = new Float64Array(dim);
    for (let q = 0; q < ids.length; q++) { const g = Math.exp(-0.5 * (ds[q] / sig) ** 2); w += g; for (let k = 0; k < dim; k++) acc[k] += g * field[ids[q] * dim + k]; }
    for (let k = 0; k < dim; k++) out[i * dim + k] = acc[k] / w;
  }
  return out;
}
/** Dilated push magnitude: max over neighbours within radius of need_j x (1 - d / radius) (the other face of the sheet and the
 *  surrounding cloth move with the vertex that needs it; no kinks). */
function dilate(G, NB, need, radius) {
  const out = new Float32Array(need.length);
  for (const i of G.uniq) { const {ids, ds} = NB.get(i); let m = need[i]; for (let q = 0; q < ids.length; q++) { const v = need[ids[q]] * (1 - ds[q] / radius); if (v > m) m = v; } out[i] = m; }
  return out;
}

// ------------------------------------------------------------------------------------------------ 1. landmarks + coarse map
/** Garment landmarks in the garment frame. */
export function garmentLandmarks(top, bottom) {
  // cups: the upper part of the top piece without the strap tops (a bodysuit's belly / a longline's lower band never counts)
  let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < top.pos.length; i += 3) { y0 = Math.min(y0, top.pos[i]); y1 = Math.max(y1, top.pos[i]); }
  const apex = capApex(top.pos, 0.02, 0.25, 0.012, [y0 + 0.2 * (y1 - y0), y1 - 0.1 * (y1 - y0)]);
  return garmentRest(top, bottom, apex);
}
/** Symmetric apex: per side the centroid of the most forward `cap` (m) of the piece's vertices with |x| in [x0, x1]; then the mean of
 *  both sides mirrored (one stray vertex / asymmetric lace scallop never skews a cup). */
export function capApex(P, x0, x1, cap, yRange = [-Infinity, Infinity]) {
  const raw = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    let zMax = -Infinity; const ids = [];
    for (let i = 0; i < P.length / 3; i++) { const x = P[i * 3] * s, y = P[i * 3 + 1]; if (x < x0 || x > x1 || y < yRange[0] || y > yRange[1]) continue; ids.push(i); zMax = Math.max(zMax, P[i * 3 + 2]); }
    const c = ids.filter(i => P[i * 3 + 2] > zMax - cap);
    raw[side] = [0, 1, 2].map(k => c.reduce((a, i) => a + P[i * 3 + k], 0) / c.length);
  }
  const mx = (Math.abs(raw.L[0]) + Math.abs(raw.R[0])) / 2, my = (raw.L[1] + raw.R[1]) / 2, mz = (raw.L[2] + raw.R[2]) / 2;
  return {L: [mx, my, mz], R: [-mx, my, mz], raw};
}
function garmentRest(top, bottom, apex) {
  // crotch: the lowest midline point of the bottom piece's largest component (suspenders / rings are separate components)
  const {label, sizes} = compLabels(bottom);
  const main = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  let crotch = null;
  for (let i = 0; i < bottom.pos.length / 3; i++) { if (label[i] !== main || Math.abs(bottom.pos[i * 3]) > 0.02) continue; if (!crotch || bottom.pos[i * 3 + 1] < crotch[1]) crotch = [bottom.pos[i * 3], bottom.pos[i * 3 + 1], bottom.pos[i * 3 + 2]]; }
  const strapTop = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) { let best = -1; for (let i = 0; i < top.pos.length / 3; i++) { if (top.pos[i * 3] * s <= 0.01) continue; if (best < 0 || top.pos[i * 3 + 1] > top.pos[best * 3 + 1]) best = i; } strapTop[side] = [top.pos[best * 3], top.pos[best * 3 + 1], top.pos[best * 3 + 2]]; }
  return {apex, apexX: (apex.L[0] - apex.R[0]) / 2, apexY: (apex.L[1] + apex.R[1]) / 2, apexZ: (apex.L[2] + apex.R[2]) / 2, crotch, strapTop};
}

export function compLabels(piece) {
  const {remap} = weldMap(piece.pos);
  const n = piece.pos.length / 3, par = Int32Array.from({length: n}, (_, i) => i);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < piece.idx.length; t += 3) { const a = find(remap[piece.idx[t]]), b = find(remap[piece.idx[t + 1]]); if (a !== b) par[b] = a; const c = find(remap[piece.idx[t + 2]]), a2 = find(a); if (a2 !== c) par[c] = a2; }
  const label = new Int32Array(n), sizes = new Map();
  for (let i = 0; i < n; i++) { label[i] = find(remap[i]); sizes.set(label[i], (sizes.get(label[i]) ?? 0) + 1); }
  return {label, sizes};
}

function gauss1(arr, sigma) {
  const out = new Float64Array(arr.length), R = Math.ceil(3 * sigma);
  for (let j = 0; j < arr.length; j++) { let s = 0, w = 0; for (let d = -R; d <= R; d++) { const k = j + d; if (k < 0 || k >= arr.length) continue; const g = Math.exp(-0.5 * (d / sigma) ** 2); s += g * arr[k]; w += g; } out[j] = s / w; }
  return out;
}

/** One vertical affine map for the whole set + per-piece horizontal profile maps. Returns mapped copies of the pieces. */
export function coarseAlign(B, pieces, GL, opts = FIT) {
  const L = B.landmarks, prof = L.profile;
  const s = (L.apexY - L.crotch[1]) / (GL.apexY - GL.crotch[1]);
  const mapY = y => L.crotch[1] + (y - GL.crotch[1]) * s;
  const out = {}, report = {verticalScale: r4(s), mapY: {garmentCrotchY: r4(GL.crotch[1]), bodyCrotchY: r4(L.crotch[1]), garmentApexY: r4(GL.apexY), bodyApexY: r4(L.apexY)}, pieces: {}};
  for (const [name, P0] of Object.entries(pieces)) {
    const P = P0.pos, n = P.length / 3, NY = prof.NY;
    const gx = new Float64Array(NY).fill(NaN), gzF = new Float64Array(NY).fill(NaN), gzB = new Float64Array(NY).fill(NaN);
    // garment extents per bin over a +-2 cm window (a tilted band: front cups and back band are at different heights)
    for (let i = 0; i < n; i++) {
      const j0 = Math.round((mapY(P[i * 3 + 1]) - prof.Y0) / prof.YS);
      for (let j = j0 - 4; j <= j0 + 4; j++) {
        if (j < 0 || j >= NY) continue;
        const ax = Math.abs(P[i * 3]);
        gx[j] = Number.isNaN(gx[j]) ? ax : Math.max(gx[j], ax);
        gzF[j] = Number.isNaN(gzF[j]) ? P[i * 3 + 2] : Math.max(gzF[j], P[i * 3 + 2]);
        gzB[j] = Number.isNaN(gzB[j]) ? P[i * 3 + 2] : Math.min(gzB[j], P[i * 3 + 2]);
      }
    }
    // body torso cross-section per bin (above the crotch both sides; below it the hip-level is held)
    const sx = new Float64Array(NY).fill(NaN), sz = new Float64Array(NY).fill(NaN), dz = new Float64Array(NY).fill(NaN);
    const valid = new Uint8Array(NY);
    const off = opts.offset[name] ?? 0.003;
    for (let j = 0; j < NY; j++) {
      const b = prof.bins[j]; if (!Number.isFinite(b.xMax) || b.y < L.crotch[1] || Number.isNaN(gx[j])) continue;
      const bw = Math.max(b.xMax, -b.xMin), bd = b.zMax - b.zMin, gw = gx[j], gd = gzF[j] - gzB[j];
      if (gw < opts.tubeMin * s * bw || gd < opts.tubeMin * s * bd) continue;
      valid[j] = 1;
      sx[j] = (bw + off) / gw; sz[j] = (bd + 2 * off) / gd;
      dz[j] = (b.zMax + b.zMin) / 2 - (gzF[j] + gzB[j]) / 2 * sz[j];
    }
    const vj = [...valid.keys()].filter(j => valid[j]);
    if (!vj.length) throw new Error(`coarseAlign ${name}: the piece is nowhere a closed tube around the torso`);
    // ONE horizontal map per piece: the medians over its tube bins (per-height maps tear a tilted band apart; the conformity pass
    // adapts the shape height by height)
    const med = a => { const b = Float64Array.from(a).sort(); return b[Math.floor(b.length / 2)]; };
    const SXc = Math.min(1.7 * s, Math.max(0.6 * s, med(vj.map(j => sx[j])))), SZc = Math.min(1.9 * s, Math.max(0.6 * s, med(vj.map(j => sz[j]))));
    const DZc = med(vj.map(j => { const b = prof.bins[j]; return (b.zMax + b.zMin) / 2 - (gzF[j] + gzB[j]) / 2 * SZc; }));
    const Q = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { Q[i * 3] = P[i * 3] * SXc; Q[i * 3 + 1] = mapY(P[i * 3 + 1]); Q[i * 3 + 2] = P[i * 3 + 2] * SZc + DZc; }
    report.pieces[name] = {tubeBins: vj.length, tubeY: [r4(prof.bins[vj[0]].y), r4(prof.bins[vj[vj.length - 1]].y)], sx: r4(SXc), sz: r4(SZc), dz: r4(DZc)};
    out[name] = {...P0, pos: Q, garmentPos: P};
  }
  // cup apices -> breast apices (top piece: lateral + vertical warp fading out at the side seam / band / straps)
  if (out.top) {
    const T = out.top.pos, n = T.length / 3;
    let ty0 = Infinity, ty1 = -Infinity; for (let i = 1; i < T.length; i += 3) { ty0 = Math.min(ty0, T[i]); ty1 = Math.max(ty1, T[i]); }
    const ga = capApex(T, 0.02, 0.2, 0.012, [ty0 + 0.2 * (ty1 - ty0), ty1 - 0.1 * (ty1 - ty0)]);
    // symmetric: the mean apex offset of both sides (mirrored in x), capped (an asymmetric / flat chest never tears a cup)
    const cap = v => Math.max(-0.03, Math.min(0.03, v));
    const mdx = cap(L.apex.L[0] - ga.L[0]), mdy = cap(L.apex.L[1] - ga.L[1]);
    const warp = {dx: r4(mdx), dy: r4(mdy)};
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const A = ga[side];
      for (let i = 0; i < n; i++) {
        if (T[i * 3] * sg <= 0) continue;
        // full at the apex, fading with the distance from it (cup radius ~ 9 cm), never moving the midline
        const d = Math.hypot(T[i * 3] - A[0], T[i * 3 + 1] - A[1]);
        const w = (1 - ss(0.06, 0.16, d)) * ss(0, Math.abs(A[0]) * 0.8, Math.abs(T[i * 3])) * ss(A[2] - 0.14, A[2] - 0.06, T[i * 3 + 2]); // front only
        T[i * 3] += sg * mdx * w; T[i * 3 + 1] += mdy * w;
      }
    }
    report.apexWarp = warp;
    // strap crests -> the shoulder strap line (x only, fading in above the apex height)
    const crestX = L.strapX;
    const sw = {};
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      let best = -1; for (let i = 0; i < n; i++) { if (T[i * 3] * sg <= 0.01) continue; if (best < 0 || T[i * 3 + 1] > T[best * 3 + 1]) best = i; }
      const top = [T[best * 3], T[best * 3 + 1], T[best * 3 + 2]];
      if (top[1] < L.apexY + 0.08) { sw[side] = {strapless: true, topY: r4(top[1])}; continue; }
      const dx = sg * crestX - top[0];
      sw[side] = {dx: r4(dx), crestY: r4(top[1])};
      for (let i = 0; i < n; i++) { if (T[i * 3] * sg <= 0) continue; const w = ss(L.apexY + 0.03, top[1] - 0.02, T[i * 3 + 1]); T[i * 3] += dx * w; }
    }
    report.strapWarp = sw;
  }
  return {pieces: out, report, mapY, s};
}

// ------------------------------------------------------------------------------------------------ 2. leg loops
export function recentreLegLoops(B, piece) {
  const L = B.landmarks, prof = L.profile;
  const {label, sizes} = compLabels(piece);
  const P = piece.pos, moved = [];
  for (const [lab] of [...sizes.entries()].sort((a, b) => a[0] - b[0])) {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], cnt = 0;
    for (let i = 0; i < P.length / 3; i++) if (label[i] === lab) { cnt++; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i * 3 + k]); mx[k] = Math.max(mx[k], P[i * 3 + k]); } }
    if (mx[1] > L.crotch[1] - 0.02) continue; // only components wholly below the crotch
    const cy = (mn[1] + mx[1]) / 2, side = (mn[0] + mx[0]) / 2 >= 0 ? 'L' : 'R';
    const b = prof.at(cy).legs[side];
    if (!Number.isFinite(b.xMax)) continue;
    const lw = b.xMax - b.xMin, ld = b.zMax - b.zMin;
    if (mx[0] - mn[0] < 0.6 * lw || mx[2] - mn[2] < 0.6 * ld) continue; // not a loop around the leg (suspender strap / clip)
    const dx = (b.xMax + b.xMin) / 2 - (mn[0] + mx[0]) / 2, dz = (b.zMax + b.zMin) / 2 - (mn[2] + mx[2]) / 2;
    for (let i = 0; i < P.length / 3; i++) if (label[i] === lab) { P[i * 3] += dx; P[i * 3 + 2] += dz; }
    moved.push({vertices: cnt, side, y: r4(cy), dx: r4(dx), dz: r4(dz)});
  }
  return moved;
}

// ------------------------------------------------------------------------------------------------ 3-4. conformity + clearance
/** Layer height per welded vertex: outer face of a thin sheet (its source normal faces away from the body and a face of the same
 *  piece lies behind it within layerMax) = that distance; else 0. Measured on the coarse-aligned piece. */
function layerHeights(B, piece, G, opts) {
  const P = piece.pos, N = piece.srcNrmAligned;
  const grid = new TriGrid(P, piece.idx, 0.02);
  const h = new Float32Array(G.n);
  for (const i of G.uniq) {
    const c = fitClosest(B, B.fitGrid, B.fitIdx, B.nrm, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    if (!c) continue;
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    if (nx * c.n[0] + ny * c.n[1] + nz * c.n[2] < 0.2) continue;
    const hit = grid.ray(P[i * 3] - nx * 1e-4, P[i * 3 + 1] - ny * 1e-4, P[i * 3 + 2] - nz * 1e-4, -nx, -ny, -nz, opts.layerMax, 2e-4);
    if (hit) h[i] = hit.t;
  }
  return spread(G, laplace(G, h, 1, 2, 0.5), 1);
}

export function shrinkWrap(B, piece, G, name, opts = FIT) {
  const P = piece.pos, off = opts.offset[name] ?? 0.003;
  const hist = [];
  const N = opts.wrapIterations;
  for (let it = 0; it < N; it++) {
    const d = new Float32Array(G.n * 3);
    let sum = 0, cnt = 0, far = 0;
    for (const i of G.uniq) {
      const c = fitClosest(B, B.fitGrid, B.fitIdx, B.nrm, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.15);
      if (!c) { far++; continue; }
      const e = off - c.sd;
      for (let k = 0; k < 3; k++) d[i * 3 + k] = e * c.n[k];
      sum += Math.abs(e); cnt++;
    }
    // smoothing radius schedule (coarse -> fine; never below the sheet-coupling radius)
    const r = opts.wrapRadius[0] + (opts.wrapRadius[1] - opts.wrapRadius[0]) * (it / Math.max(1, N - 1));
    const NB = spatialNeighbours(G, P, r);
    const S = laplace(G, spatialSmooth(G, NB, d, 3, r), 3, 1, 0.5);
    for (const i of G.uniq) for (let k = 0; k < 3; k++) P[i * 3 + k] += S[i * 3 + k];
    spread(G, P, 3);
    hist.push({it, radiusMM: mm(r), meanAbsErrMM: mm(sum / Math.max(1, cnt)), far});
  }
  return {history: hist};
}

/** Signed distance with the sign verified: a negative normal sign (closest point on the fit surface) only counts when the point is
 *  also inside the CLOSED skin by ray parity (the fit surface is open at the arms / neck / leg cuts, where the normal sign alone lies). */
export function verifiedClosest(B, grid, idx, nrm, closedGrid, x, y, z, maxR) {
  const c = fitClosest(B, grid, idx, nrm, x, y, z, maxR);
  if (c && c.sd < 0.002 && closedGrid && !insideByParity(closedGrid, x, y, z) && c.sd < 0) c.sd = c.d;
  return c;
}


/** Torso / leg skin vertices of the fit surface (welded representatives) within `near` of a cloth piece (bind). */
export function pokeCandidates(B, piece, near = 0.03) {
  const grid = new TriGrid(piece.pos, piece.idx, 0.02), out = [], seen = new Uint8Array(B.pos.length / 3);
  for (const v of B.fitIdx) {
    const r = B.remap[v]; if (seen[r] || B.groups[r] === 2 || B.hair[r]) continue; seen[r] = 1;
    if (grid.closest(B.pos[r * 3], B.pos[r * 3 + 1], B.pos[r * 3 + 2], near)) out.push(r);
  }
  return Uint32Array.from(out);
}
/**
 * Body skin poking through the cloth (between cloth vertices: a nipple / mons / hip bone under a coarse cloth triangle): per welded
 * cloth vertex the outward push it needs = max over the candidate body vertices whose outward ray, started `depth` inside the skin,
 * meets one of its triangles before skin + minClear.
 */
export function bodyPokeNeeds(bodyPos, bodyNrm, cand, clothPos, clothIdx, G, minClear, depth = 0.008) {
  const grid = new TriGrid(clothPos, clothIdx, 0.02), need = new Float32Array(G.n);
  let count = 0;
  for (const v of cand) {
    const nx = bodyNrm[v * 3], ny = bodyNrm[v * 3 + 1], nz = bodyNrm[v * 3 + 2];
    const h = grid.ray(bodyPos[v * 3] - nx * depth, bodyPos[v * 3 + 1] - ny * depth, bodyPos[v * 3 + 2] - nz * depth, nx, ny, nz, depth + minClear);
    if (!h) continue;
    const d = depth + minClear - h.t;
    count++;
    if (process.env.LING_DEBUG_POKE && d > depth * 0.8 && count < 12) console.log(`      poke body v ${v} at ${[0, 1, 2].map(k => bodyPos[v * 3 + k].toFixed(3)).join(',')} n ${[nx, ny, nz].map(q => q.toFixed(2)).join(',')} hit t ${h.t.toFixed(4)} tri ${[0, 1, 2].map(k => [0, 1, 2].map(q => clothPos[clothIdx[h.tri * 3 + k] * 3 + q].toFixed(3)).join(',')).join(' / ')}`);
    for (let k = 0; k < 3; k++) { const c = G.remap[clothIdx[h.tri * 3 + k]]; if (d > need[c]) need[c] = d; }
  }
  return {need, count};
}

export function clearancePass(B, piece, G, floor, rounds = 6, push = null, maxStep = 0.02, opts = FIT) {
  const P = piece.pos; let fixed = 0;
  const cand = piece.pokeCand ??= pokeCandidates(B, piece);
  for (let r = 0; r < rounds; r++) {
    const need = new Float32Array(G.n), dir = new Float32Array(G.n * 3); let any = 0;
    const poke = bodyPokeNeeds(B.pos, B.nrm, cand, P, piece.idx, G, floor).need;
    if (process.env.LING_DEBUG) { const top = [...G.uniq].filter(i => poke[i] > 0).sort((a, b) => poke[b] - poke[a]); console.log(`   clear round ${r}: poke vertices ${top.length}`, top.slice(0, 5).map(i => `${(poke[i] * 1000).toFixed(1)}mm@${[0, 1, 2].map(k => P[i * 3 + k].toFixed(3)).join(',')}`).join(' ')); }
    for (const i of G.uniq) {
      const c = verifiedClosest(B, B.fitGrid, B.fitIdx, B.nrm, B.skinGrid, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.08);
      if (!c) continue;
      dir.set(c.n, i * 3);
      const v = Math.min(maxStep, Math.max(push ? push[i] : 0, floor - c.sd, poke[i]));
      if (v > 0) { need[i] = v; any++; }
    }
    if (!any) break;
    fixed += any;
    const NB = spatialNeighbours(G, P, opts.pushRadius);
    const D = dilate(G, NB, need, opts.pushRadius);
    for (const i of G.uniq) for (let k = 0; k < 3; k++) P[i * 3 + k] += D[i] * dir[i * 3 + k];
    spread(G, P, 3);
    push = null;
  }
  return fixed;
}

// ------------------------------------------------------------------------------------------------ 5. weights
export function transferWeights(B, piece, G, opts = FIT) {
  const names = B.names, nj = names.length, J = Object.fromEntries(names.map((n, i) => [n, i]));
  const P = piece.pos, rows = new Float64Array(G.n * nj);
  let far = 0;
  for (const i of G.uniq) {
    const c = fitClosest(B, B.fitGrid, B.fitIdx, B.nrm, P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.25);
    if (!c) { rows[i * nj + J.Hips] = 1; far++; continue; }
    for (let k = 0; k < 3; k++) {
      const v = c.v[k], b = c.bary[k];
      for (let q = 0; q < 4; q++) { const w = B.weights[v * 4 + q]; if (!w) continue; let j = B.joints[v * 4 + q]; if (names[j] === 'Head') j = J.Neck; rows[i * nj + j] += b * w; }
    }
  }
  const S = laplace(G, rows, nj, opts.weightSmooth.iters, opts.weightSmooth.lambda);
  const joints = new Uint8Array(G.n * 4), weights = new Float32Array(G.n * 4);
  for (const i of G.uniq) {
    const e = [];
    for (let j = 0; j < nj; j++) if (S[i * nj + j] > 1e-6) e.push([S[i * nj + j], j]);
    e.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const top = e.slice(0, 4), s = top.reduce((a, [w]) => a + w, 0);
    top.forEach(([w, j], k) => { joints[i * 4 + k] = j; weights[i * 4 + k] = w / s; });
  }
  spread(G, joints, 4); spread(G, weights, 4);
  return {joints, weights, far};
}

// ------------------------------------------------------------------------------------------------ posing helpers
export function poseWorld(B, clip, t) { return B.worldAt(clip, t); }
/** LBS with float weights over the body's joint world matrices (column-major 4x4 incl. IBM). */
export function skinWith(mats, pos, joints, weights, nrm = null) {
  const n = pos.length / 3, out = new Float32Array(n * 3), on = nrm ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[i * 4 + k]; if (!w) continue;
      const M = mats[joints[i * 4 + k]];
      ox += w * (M[0] * x + M[4] * y + M[8] * z + M[12]); oy += w * (M[1] * x + M[5] * y + M[9] * z + M[13]); oz += w * (M[2] * x + M[6] * y + M[10] * z + M[14]);
      if (on) { const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2]; nx += w * (M[0] * a + M[4] * b + M[8] * c); ny += w * (M[1] * a + M[5] * b + M[9] * c); nz += w * (M[2] * a + M[6] * b + M[10] * c); }
    }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    if (on) { const l = Math.hypot(nx, ny, nz) || 1; on[i * 3] = nx / l; on[i * 3 + 1] = ny / l; on[i * 3 + 2] = nz / l; }
  }
  return on ? {pos: out, nrm: on} : out;
}

/** Per welded cloth vertex: the minimum signed distance to the posed FIT surface over the given poses. */
export function poseMinClearance(B, pieceSets, poses, pokeFloor = FIT.poseClear) {
  const mins = pieceSets.map(p => new Float32Array(p.G.n).fill(Infinity));
  const pokes = pieceSets.map(p => new Float32Array(p.G.n));
  for (const pose of poses) {
    const mats = pose.mats;
    const bp = skinWith(mats, B.pos, B.joints, B.weights);
    const grid = new TriGrid(bp, B.fitIdx, 0.025), closed = new TriGrid(bp, B.skinIdx, 0.025);
    const bn = posedWeldedNormals(B, bp);
    pieceSets.forEach((ps, k) => {
      const gp = skinWith(mats, ps.piece.pos, ps.w.joints, ps.w.weights);
      const pk = bodyPokeNeeds(bp, bn, ps.piece.pokeCand ??= pokeCandidates(B, ps.piece), gp, ps.piece.idx, ps.G, pokeFloor).need;
      for (const i of ps.G.uniq) if (pk[i] > pokes[k][i]) { pokes[k][i] = pk[i]; if (process.env.LING_DEBUG) (ps.dbgPoke ??= {})[i] = pose.clip + '@' + pose.t; }
      for (const i of ps.G.uniq) {
        const c = verifiedClosest(B, grid, B.fitIdx, bn, closed, gp[i * 3], gp[i * 3 + 1], gp[i * 3 + 2], 0.06);
        if (c && c.sd < mins[k][i]) { mins[k][i] = c.sd; if (process.env.LING_DEBUG) { (ps.dbgSd ??= {})[i] = pose.clip + '@' + pose.t + ' tri ' + c.v.map(v => B.groups[v]).join(''); } }
      }
    });
  }
  return {mins, pokes};
}

/** Welded skin normals of a posed body (same welding / skin-only triangles as the bind). */
export function posedWeldedNormals(B, pos) {
  const n = pos.length / 3, acc = new Float32Array(n * 3), I = B.skinIdx, remap = B.remap;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2], e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [I[t], I[t + 1], I[t + 2]]) { const r = remap[v] * 3; acc[r] += nx; acc[r + 1] += ny; acc[r + 2] += nz; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = remap[i] * 3; const l = Math.hypot(acc[r], acc[r + 1], acc[r + 2]) || 1; out[i * 3] = acc[r] / l; out[i * 3 + 1] = acc[r + 1] / l; out[i * 3 + 2] = acc[r + 2] / l; }
  return out;
}

// ------------------------------------------------------------------------------------------------ normals: source shading kept
/** Rotate each source normal by the minimal rotation taking the source geometric (welded) normal to the fitted one. */
export function carryNormals(srcPos, srcNrm, fitPos, G) {
  const a = geomNormals(srcPos, G.widx, G.n), b = geomNormals(fitPos, G.widx, G.n);
  const out = new Float32Array(srcNrm.length);
  for (let i = 0; i < G.n; i++) {
    const r = G.remap[i], u = [a[r * 3], a[r * 3 + 1], a[r * 3 + 2]], v = [b[r * 3], b[r * 3 + 1], b[r * 3 + 2]];
    const s = [srcNrm[i * 3], srcNrm[i * 3 + 1], srcNrm[i * 3 + 2]];
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    let o;
    if (!(u[0] || u[1] || u[2]) || !(v[0] || v[1] || v[2])) o = s;
    else if (dot < -0.9999) o = s.map(x => -x);
    else {
      const k = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], f = 1 / (1 + dot);
      const kx = k[0] * s[0] + k[1] * s[1] + k[2] * s[2], ks = [k[1] * s[2] - k[2] * s[1], k[2] * s[0] - k[0] * s[2], k[0] * s[1] - k[1] * s[0]];
      o = [0, 1, 2].map(q => s[q] * dot + ks[q] + k[q] * kx * f); // Rodrigues with unnormalised axis
    }
    const l = Math.hypot(...o) || 1;
    out[i * 3] = o[0] / l; out[i * 3 + 1] = o[1] / l; out[i * 3 + 2] = o[2] / l;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ full fit of one set
/**
 * @param B loadBody() + worldAt(clip, t) + validation poses B.poses [{clip, t, mats}]
 * @param pieces {top: simplified piece, bottom: simplified piece} (garment frame)
 */
/**
 * Stage 1 at the source resolution (cleaned, unsimplified pieces): landmark alignment, leg loops, conformity, clearance.
 * Returns per piece the fitted positions of EVERY source vertex of the piece (same order).
 */
export function fitStage1(B, pieces, opts = FIT) {
  const GL = garmentLandmarks(pieces.top, pieces.bottom);
  const A = coarseAlign(B, pieces, GL, opts);
  const report = {landmarks: {garment: {apex: {L: GL.apex.L.map(r4), R: GL.apex.R.map(r4)}, crotch: GL.crotch.map(r4)}, body: bodyLandmarkReport(B)}, align: A.report, pieces: {}};
  const out = {};
  for (const name of ['top', 'bottom']) {
    const piece = A.pieces[name];
    const G = clothGraph(piece);
    piece.srcNrmAligned = carryNormals(piece.garmentPos, piece.nrm, piece.pos, G);
    const loops = name === 'bottom' ? recentreLegLoops(B, piece) : [];
    if (opts.snap) opts.snap(name, 'coarse', piece.pos.slice());
    const wrap = shrinkWrap(B, piece, G, name, opts);
    if (opts.snap) opts.snap(name, 'wrap', piece.pos.slice());
    const fixed = clearancePass(B, piece, G, opts.minClear);
    if (opts.snap) opts.snap(name, 'clear', piece.pos.slice());
    out[name] = piece.pos;
    report.pieces[name] = {sourceVertices: piece.pos.length / 3, sourceTriangles: piece.idx.length / 3, legLoopsRecentred: loops, wrap: wrap.history.slice(-1)[0], stage1ClearanceRounds: fixed};
  }
  return {fitted: out, report};
}

function bodyLandmarkReport(B) { const {profile, crest, ...L} = B.landmarks; return JSON.parse(JSON.stringify(L, (k, v) => typeof v === 'number' ? r4(v) : v)); }

/**
 * Stage 2 on the runtime (simplified) pieces: `pieces[name]` = {pos (this body's stage-1 positions of the kept vertices), idx, uv,
 * nrm (source normals), garmentPos (source positions)}; clearance again (now with the coarse runtime triangles: body bumps between
 * cloth vertices), skin weights, pose-aware clearance through the validation poses, normals, masks.
 */
export function fitStage2(B, pieces, stage1Report, opts = FIT) {
  const out = {...stage1Report, pieces: {...stage1Report.pieces}};
  const sets = [];
  for (const name of ['top', 'bottom']) {
    const piece = pieces[name];
    const G = clothGraph(piece);
    const fixed = clearancePass(B, piece, G, opts.minClear);
    const w = transferWeights(B, piece, G, opts);
    sets.push({name, piece, G, w, bindFixed: fixed});
  }
  const poseRounds = [];
  for (let r = 0; r < opts.poseRounds; r++) {
    const {mins, pokes} = poseMinClearance(B, sets, B.poses, opts.poseClear);
    let need = 0;
    sets.forEach((s, k) => {
      const push = new Float32Array(s.G.n);
      let n = 0;
      for (const i of s.G.uniq) { const d = Math.max(opts.poseClear - mins[k][i], pokes[k][i]); if (Number.isFinite(d) && d > 0) { push[i] = Math.min(opts.posePushMax, d + 0.0005); n++; } }
      need += n;
      if (n) { clearancePass(B, s.piece, s.G, opts.minClear, 2, push); s.w = transferWeights(B, s.piece, s.G, opts); }
    });
    poseRounds.push({round: r, verticesNeedingMore: need});
    if (!need) break;
  }
  out.poseRounds = poseRounds;
  for (const s of sets) {
    s.nrm = carryNormals(s.piece.garmentPos, s.piece.nrm, s.piece.pos, s.G);
    out.pieces[s.name] = {...out.pieces[s.name], vertices: s.piece.pos.length / 3, triangles: s.piece.idx.length / 3, bindClearanceRounds: s.bindFixed, weightAnchorsBeyond25cm: s.w.far};
  }
  const bodyMesh = {pos: B.pos, idx: B.idx};
  for (const s of sets) s.mask = coverMask(bodyMesh, {pos: s.piece.pos, idx: s.piece.idx}, {...opts.mask, bodyJoints: B.joints});
  const top = sets.find(s => s.name === 'top'), bottom = sets.find(s => s.name === 'bottom');
  top.hideWear = coverMask({pos: bottom.piece.pos, idx: bottom.piece.idx}, {pos: top.piece.pos, idx: top.piece.idx}, {...opts.layerMask, skipJoints: [], bodyJoints: null});
  out.masks = {top: {hidden: top.mask.hidden, total: top.mask.total}, bottom: {hidden: bottom.mask.hidden, total: bottom.mask.total}, bottomUnderTop: {hidden: top.hideWear.hidden, total: top.hideWear.total}};
  return {sets, report: out};
}

/** Runtime piece of one body from its stage-1 positions and a simplification (vertex subset `srcIndex` of the source piece). */
export function runtimePiece(srcPiece, fittedPos, simp) {
  const n = simp.srcIndex.length, pos = new Float32Array(n * 3), garmentPos = new Float32Array(n * 3);
  simp.srcIndex.forEach((v, i) => { pos.set(fittedPos.subarray(v * 3, v * 3 + 3), i * 3); garmentPos.set(srcPiece.pos.subarray(v * 3, v * 3 + 3), i * 3); });
  return {pos, idx: simp.idx, uv: simp.uv, nrm: simp.nrm, garmentPos};
}

function quant(arr, q) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; }
export {r4, mm};
