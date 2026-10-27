// New UV parameterization for the simplified mesh.
// The AI masters use thousands of tiny atlas charts, so seam-preserving decimation stalls far
// above the triangle budget. Instead we unwrap the low-poly mesh ourselves and later bake colour
// from the master:
//  1. chart growth on Laplacian-smoothed normals (ignores wrinkle noise) inside a cone,
//     with every face's TRUE normal required to face the chart's projection axis (no flips);
//  2. small charts merged into neighbours when still valid;
//  3. planar projection, min-area rotation, per-region texel density (face gets more);
//  4. "horizon" packing of the actual chart shapes (column profiles, 4 rotations).
import {faceNormalsAreas, faceAdjacency, vertexAdjacency, computeNormals} from './mesh.mjs';

export function unwrap(pos, idx, opts) {
  const {coneDeg = 62, validDot = 0.3, minChartFaces = 40, smoothIters = 12, atlas = 1024, pad = 6, faceRegion} = opts;
  const nt = idx.length / 3, nv = pos.length / 3;
  const {FN, FA} = faceNormalsAreas(pos, idx);
  const fnb = faceAdjacency(idx);
  // smoothed vertex normals -> smoothed face normals
  let VN = computeNormals(pos, idx);
  const {offs, adj} = vertexAdjacency(nv, idx);
  for (let it = 0; it < smoothIters; it++) {
    const nx = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      let x = VN[v * 3], y = VN[v * 3 + 1], z = VN[v * 3 + 2];
      for (let k = offs[v]; k < offs[v + 1]; k++) { const u = adj[k]; x += VN[u * 3]; y += VN[u * 3 + 1]; z += VN[u * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1; nx[v * 3] = x / l; nx[v * 3 + 1] = y / l; nx[v * 3 + 2] = z / l;
    }
    VN = nx;
  }
  const SN = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 3; c++) { const v = idx[t * 3 + c]; x += VN[v * 3]; y += VN[v * 3 + 1]; z += VN[v * 3 + 2]; }
    const l = Math.hypot(x, y, z) || 1; SN[t * 3] = x / l; SN[t * 3 + 1] = y / l; SN[t * 3 + 2] = z / l;
  }
  const region = new Int32Array(nt), density = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const c = [0, 1, 2].map(k => (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3);
    const r = faceRegion ? faceRegion(t, c) : {region: 0, density: 1};
    region[t] = r.region; density[t] = r.density;
  }
  const dotF = (N, t, a) => N[t * 3] * a[0] + N[t * 3 + 1] * a[1] + N[t * 3 + 2] * a[2];
  const cosCone = Math.cos(coneDeg * Math.PI / 180);
  const order = Array.from({length: nt}, (_, i) => i).sort((a, b) => FA[b] - FA[a] || a - b);
  const chartOf = new Int32Array(nt).fill(-1);
  const charts = [];
  for (const seed of order) {
    if (chartOf[seed] >= 0) continue;
    const id = charts.length;
    let axis = [SN[seed * 3], SN[seed * 3 + 1], SN[seed * 3 + 2]];
    if (dotF(FN, seed, axis) < validDot) axis = [FN[seed * 3], FN[seed * 3 + 1], FN[seed * 3 + 2]];
    const faces = [seed]; chartOf[seed] = id;
    for (let q = 0; q < faces.length; q++) {
      const t = faces[q];
      for (let e = 0; e < 3; e++) {
        const f = fnb[t * 3 + e];
        if (f < 0 || chartOf[f] >= 0 || region[f] !== region[seed]) continue;
        if (dotF(SN, f, axis) < cosCone || dotF(FN, f, axis) < validDot) continue;
        chartOf[f] = id; faces.push(f);
      }
    }
    charts.push({id, axis, faces, region: region[seed], alive: true});
  }
  const initialCharts = charts.length;
  // merge small charts into the neighbour sharing most edges, if every face stays valid
  let merged = 0;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const bySize = charts.filter(c => c.alive && c.faces.length < minChartFaces).sort((a, b) => a.faces.length - b.faces.length || a.id - b.id);
    for (const ch of bySize) {
      if (!ch.alive) continue;
      const cand = new Map();
      for (const t of ch.faces) for (let e = 0; e < 3; e++) { const f = fnb[t * 3 + e]; if (f >= 0 && chartOf[f] !== ch.id) cand.set(chartOf[f], (cand.get(chartOf[f]) || 0) + 1); }
      const sorted = [...cand.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      for (const [cid] of sorted) {
        const other = charts[cid];
        if (!other.alive || other.region !== ch.region) continue;
        if (!ch.faces.every(t => dotF(FN, t, other.axis) > validDot)) continue;
        for (const t of ch.faces) { chartOf[t] = cid; other.faces.push(t); }
        ch.faces = []; ch.alive = false; merged++; changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  const live = charts.filter(c => c.alive);
  // projection + min-area rotation
  for (const ch of live) {
    const a = ch.axis;
    const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ref, a)), v = cross(a, u);
    const local = new Map();
    for (const t of ch.faces) for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k];
      if (!local.has(vi)) local.set(vi, [pos[vi * 3] * u[0] + pos[vi * 3 + 1] * u[1] + pos[vi * 3 + 2] * u[2], pos[vi * 3] * v[0] + pos[vi * 3 + 1] * v[1] + pos[vi * 3 + 2] * v[2]]);
    }
    let best = null;
    const pts = [...local.values()];
    for (let deg = 0; deg < 90; deg += 3) {
      const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { const X = c * x - s * y, Y = s * x + c * y; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area < best.area - 1e-12) best = {area, c, s, x0, y0, w: x1 - x0, h: y1 - y0};
    }
    const dens = ch.faces.reduce((m, t) => Math.max(m, density[t]), 0);
    for (const [vi, [x, y]] of local) local.set(vi, [(best.c * x - best.s * y - best.x0) * dens, (best.s * x + best.c * y - best.y0) * dens]);
    ch.local = local; ch.w = best.w * dens; ch.h = best.h * dens; ch.density = dens;
    ch.tris = ch.faces.map(t => [0, 1, 2].map(c => local.get(idx[t * 3 + c])));
    ch.area = ch.tris.reduce((s, [p, q, r]) => s + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2, 0);
  }
  const packOrder = live.map((c, i) => i).sort((a, b) => live[b].area - live[a].area || a - b);
  let lo = 50, hi = 5000, bestPack = null;
  for (let it = 0; it < 22; it++) {
    const k = Math.sqrt(lo * hi);
    const placed = horizonPack(live, packOrder, k, atlas, pad);
    if (placed) { lo = k; bestPack = {k, placed}; } else hi = k;
  }
  if (!bestPack) throw new Error('unwrap: packing failed');
  const {k, placed} = bestPack;
  const vertMap = [], uv = [], outIdx = new Uint32Array(idx.length);
  for (const pl of placed) {
    const ch = live[pl.i];
    const ids = new Map();
    for (const [vi, [x, y]] of ch.local) {
      const [X, Y] = xform(x * k, y * k, pl.rot, ch.w * k, ch.h * k);
      ids.set(vi, vertMap.length);
      vertMap.push(vi);
      uv.push((pl.x + X) / atlas, (pl.y + Y) / atlas);
    }
    for (const t of ch.faces) for (let c = 0; c < 3; c++) outIdx[t * 3 + c] = ids.get(idx[t * 3 + c]);
  }
  const U = Float32Array.from(uv);
  let flipped = 0, uvArea = 0;
  for (let t = 0; t < nt; t++) {
    const a = outIdx[t * 3], b = outIdx[t * 3 + 1], c = outIdx[t * 3 + 2];
    const ar = (U[b * 2] - U[a * 2]) * (U[c * 2 + 1] - U[a * 2 + 1]) - (U[c * 2] - U[a * 2]) * (U[b * 2 + 1] - U[a * 2 + 1]);
    if (ar < 0) flipped++;
    uvArea += Math.abs(ar) / 2;
  }
  return {
    vertMap: Uint32Array.from(vertMap), uv: U, idx: outIdx,
    stats: {initialCharts, charts: live.length, mergedSmallCharts: merged, texelsPerMetreBase: +k.toFixed(1), uvAreaFill: +uvArea.toFixed(3), uvMirroredFaces: flipped, coneDeg, validDot, minChartFaces, smoothIters, padTexels: pad, packAtlas: atlas},
  };
}

// rotation r in {0,1,2,3} x 90deg, keeping the chart in [0,w']x[0,h']
function xform(x, y, r, w, h) {
  switch (r) {
    case 0: return [x, y];
    case 1: return [y, w - x];
    case 2: return [w - x, h - y];
    default: return [h - y, x];
  }
}

/** Column profiles (min/max y per integer column) of a chart's triangles, dilated by pad/2. */
function profile(ch, k, rot, pad) {
  const W = ch.w * k, Hh = ch.h * k;
  const ow = rot % 2 ? Hh : W;
  const half = Math.ceil(pad / 2);
  const cols = Math.ceil(ow) + 1;
  const lo = new Float64Array(cols).fill(Infinity), hi = new Float64Array(cols).fill(-Infinity);
  for (const tri of ch.tris) {
    const P = tri.map(([x, y]) => xform(x * k, y * k, rot, W, Hh));
    const xs = P.map(p => p[0]);
    const c0 = Math.max(0, Math.floor(Math.min(...xs))), c1 = Math.min(cols - 1, Math.floor(Math.max(...xs)));
    for (let c = c0; c <= c1; c++) {
      const a = c, b = c + 1;
      let mn = Infinity, mx = -Infinity;
      for (const p of P) if (p[0] >= a && p[0] <= b) { mn = Math.min(mn, p[1]); mx = Math.max(mx, p[1]); }
      for (let e = 0; e < 3; e++) {
        const p = P[e], q = P[(e + 1) % 3];
        for (const X of [a, b]) {
          if ((p[0] - X) * (q[0] - X) <= 0 && p[0] !== q[0]) { const y = p[1] + (q[1] - p[1]) * (X - p[0]) / (q[0] - p[0]); mn = Math.min(mn, y); mx = Math.max(mx, y); }
        }
      }
      if (mn < lo[c]) lo[c] = mn; if (mx > hi[c]) hi[c] = mx;
    }
  }
  // dilate: widen by `half` columns each side and pad vertically
  const n = cols + 2 * half;
  const L = new Float64Array(n).fill(Infinity), Hi = new Float64Array(n).fill(-Infinity);
  for (let c = 0; c < cols; c++) {
    if (!(hi[c] >= lo[c])) continue;
    for (let d = -half; d <= half; d++) { const j = c + half + d; L[j] = Math.min(L[j], lo[c] - half); Hi[j] = Math.max(Hi[j], hi[c] + half); }
  }
  return {L, Hi, n, half};
}

function horizonPack(live, order, k, atlas, pad) {
  const horizon = new Float64Array(atlas).fill(0);
  const out = [];
  for (const i of order) {
    const ch = live[i];
    let best = null;
    for (let rot = 0; rot < 4; rot++) {
      const pr = profile(ch, k, rot, pad);
      if (pr.n > atlas) continue;
      for (let x = 0; x + pr.n <= atlas; x++) {
        let y = -Infinity;
        for (let c = 0; c < pr.n; c++) if (pr.Hi[c] >= pr.L[c]) y = Math.max(y, horizon[x + c] - pr.L[c]);
        let top = 0, waste = 0;
        for (let c = 0; c < pr.n; c++) if (pr.Hi[c] >= pr.L[c]) { top = Math.max(top, y + pr.Hi[c]); waste += y + pr.L[c] - horizon[x + c]; }
        if (top > atlas) continue;
        const score = top + 0.02 * waste / pr.n;
        if (!best || score < best.score) best = {score, x, y, rot, pr};
      }
    }
    if (!best) return null;
    const {pr} = best;
    for (let c = 0; c < pr.n; c++) if (pr.Hi[c] >= pr.L[c]) horizon[best.x + c] = Math.max(horizon[best.x + c], best.y + pr.Hi[c]);
    // chart-local origin = profile origin shifted by the dilation half-width
    out.push({i, x: best.x + pr.half, y: best.y, rot: best.rot});
  }
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
