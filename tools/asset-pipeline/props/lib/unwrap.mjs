// Deterministic UV atlas for a simplified mesh: faces are clustered by dominant axis (6-way box
// projection), smoothed, split into edge-connected charts, small charts merged into compatible
// neighbours, each chart orthographically projected along its axis (every face keeps a positive
// projected area, so no flips), rotated to a minimal bounding box and shelf-packed with padding.
// Normals use smoothing groups (dihedral < creaseDeg), independent of chart borders.

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// in-plane basis per axis with t x b = axis (texture appears unmirrored seen from outside)
const BASIS = [
  [[0, 0, -1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]],
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]],
];
const dot3 = (a, i, b) => a[i] * b[0] + a[i + 1] * b[1] + a[i + 2] * b[2];

export function unwrap(pos, idx, opts) {
  const {atlas, pad, minDot = 0.25, smoothIters = 4, mergeMaxFaces = 6, creaseDeg = 50} = opts;
  const nv = pos.length / 3, nf = idx.length / 3;
  const fn = new Float64Array(nf * 3), fa = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    fa[f] = l / 2;
    if (l > 0) { x /= l; y /= l; z /= l; }
    fn[3 * f] = x; fn[3 * f + 1] = y; fn[3 * f + 2] = z;
  }
  // edge adjacency (manifold edges only)
  const edgeMap = new Map();
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = idx[3 * f + e], b = idx[3 * f + (e + 1) % 3];
    const k = a < b ? a * nv + b : b * nv + a;
    const l = edgeMap.get(k);
    if (l) l.push(f * 3 + e); else edgeMap.set(k, [f * 3 + e]);
  }
  const nb = new Int32Array(nf * 3).fill(-1);
  const edgeLen = new Float64Array(nf * 3);
  for (const list of edgeMap.values()) {
    if (list.length !== 2) continue;
    const [p, q] = list;
    nb[p] = (q / 3) | 0; nb[q] = (p / 3) | 0;
  }
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = idx[3 * f + e], b = idx[3 * f + (e + 1) % 3];
    edgeLen[3 * f + e] = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
  }
  // initial labels
  let label = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) {
    let best = -2, bl = 0;
    for (let k = 0; k < 6; k++) { const d = dot3(fn, 3 * f, AXES[k]); if (d > best + 1e-12) { best = d; bl = k; } }
    label[f] = bl;
  }
  // smoothing (Jacobi): adopt a label held by >=2 neighbours if still safely front-facing
  for (let it = 0; it < smoothIters; it++) {
    const next = Uint8Array.from(label);
    for (let f = 0; f < nf; f++) {
      const cnt = [0, 0, 0, 0, 0, 0];
      for (let e = 0; e < 3; e++) { const g = nb[3 * f + e]; if (g >= 0) cnt[label[g]]++; }
      for (let k = 0; k < 6; k++) if (k !== label[f] && cnt[k] >= 2 && dot3(fn, 3 * f, AXES[k]) > minDot) { next[f] = k; break; }
    }
    label = next;
  }
  // connected components
  const chartOf = new Int32Array(nf).fill(-1);
  const charts = [];
  const stack = [];
  for (let f = 0; f < nf; f++) {
    if (chartOf[f] >= 0) continue;
    const id = charts.length; const faces = [];
    chartOf[f] = id; stack.push(f);
    while (stack.length) {
      const g = stack.pop(); faces.push(g);
      for (let e = 0; e < 3; e++) { const h = nb[3 * g + e]; if (h >= 0 && chartOf[h] < 0 && label[h] === label[f]) { chartOf[h] = id; stack.push(h); } }
    }
    charts.push({axis: label[f], faces});
  }
  // merge small charts into the neighbouring chart with the longest shared edge whose axis keeps all faces front-facing
  let merges = 0;
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let ci = 0; ci < charts.length; ci++) {
      const ch = charts[ci];
      if (!ch || ch.faces.length > mergeMaxFaces) continue;
      const shared = new Map();
      for (const f of ch.faces) for (let e = 0; e < 3; e++) {
        const g = nb[3 * f + e]; if (g < 0) continue;
        const o = chartOf[g]; if (o === ci) continue;
        shared.set(o, (shared.get(o) || 0) + edgeLen[3 * f + e]);
      }
      const cands = [...shared.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      for (const [o] of cands) {
        const ax = AXES[charts[o].axis];
        if (ch.faces.every(f => fa[f] === 0 || dot3(fn, 3 * f, ax) > minDot)) {
          for (const f of ch.faces) chartOf[f] = o;
          charts[o].faces.push(...ch.faces);
          charts[ci] = null; changed++; merges++;
          break;
        }
      }
    }
    if (!changed) break;
  }
  const live = [];
  const renum = new Int32Array(charts.length).fill(-1);
  charts.forEach((c, i) => { if (c) { renum[i] = live.length; c.faces.sort((a, b) => a - b); live.push(c); } });
  for (let f = 0; f < nf; f++) chartOf[f] = renum[chartOf[f]];

  // smoothing groups per vertex: faces around a vertex joined across edges with dihedral < creaseDeg
  const cosCrease = Math.cos(creaseDeg * Math.PI / 180);
  const vertFaces = Array.from({length: nv}, () => []);
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) vertFaces[idx[3 * f + e]].push(f);
  const cornerGroup = new Int32Array(nf * 3); // global group id per corner
  const groupNormals = [];
  for (let v = 0; v < nv; v++) {
    const faces = vertFaces[v];
    const parent = faces.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const pos_ = new Map(faces.map((f, i) => [f, i]));
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      for (let e = 0; e < 3; e++) {
        const g = nb[3 * f + e]; if (g < 0 || !pos_.has(g)) continue;
        // edge must contain v
        const a = idx[3 * f + e], b = idx[3 * f + (e + 1) % 3];
        if (a !== v && b !== v) continue;
        if (fn[3 * f] * fn[3 * g] + fn[3 * f + 1] * fn[3 * g + 1] + fn[3 * f + 2] * fn[3 * g + 2] > cosCrease) {
          const ri = find(i), rj = find(pos_.get(g)); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
        }
      }
    }
    const gid = new Map();
    for (let i = 0; i < faces.length; i++) {
      const r = find(i);
      if (!gid.has(r)) { gid.set(r, groupNormals.length); groupNormals.push([0, 0, 0]); }
      const G = gid.get(r), f = faces[i];
      const n = groupNormals[G];
      n[0] += fn[3 * f] * fa[f]; n[1] += fn[3 * f + 1] * fa[f]; n[2] += fn[3 * f + 2] * fa[f];
      for (let e = 0; e < 3; e++) if (idx[3 * f + e] === v) cornerGroup[3 * f + e] = G;
    }
  }
  let zeroNormals = 0;
  for (const n of groupNormals) {
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l > 0) { n[0] /= l; n[1] /= l; n[2] /= l; } else { n[0] = 0; n[1] = 1; n[2] = 0; zeroNormals++; }
  }

  // per-chart projection, rotation and bounding boxes
  const chartVerts = live.map(() => new Map()); // vertex -> [x,y]
  const rects = [];
  for (let ci = 0; ci < live.length; ci++) {
    const ch = live[ci]; const [t, b] = BASIS[ch.axis];
    const m = chartVerts[ci];
    for (const f of ch.faces) for (let e = 0; e < 3; e++) {
      const v = idx[3 * f + e];
      if (!m.has(v)) m.set(v, [dot3(pos, 3 * v, t), dot3(pos, 3 * v, b)]);
    }
    const pts = [...m.values()];
    let bestA = Infinity, bestAng = 0;
    for (let k = 0; k < 30; k++) {
      const ang = k * Math.PI / 60; const c = Math.cos(ang), s = Math.sin(ang);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { const X = x * c - y * s, Y = x * s + y * c; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
      const A = (x1 - x0) * (y1 - y0);
      if (A < bestA - 1e-15) { bestA = A; bestAng = ang; }
    }
    let c = Math.cos(bestAng), s = Math.sin(bestAng);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
    let rot90 = false;
    if (y1 - y0 > x1 - x0) rot90 = true;
    for (const [v, [x, y]] of m) {
      let X = x * c - y * s, Y = x * s + y * c;
      if (rot90) { const T = X; X = -Y; Y = T; }
      m.set(v, [X, Y]);
    }
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const [X, Y] of m.values()) { bx0 = Math.min(bx0, X); bx1 = Math.max(bx1, X); by0 = Math.min(by0, Y); by1 = Math.max(by1, Y); }
    rects.push({ci, x0: bx0, y1: by1, w: bx1 - bx0, h: by1 - by0});
  }
  // shelf packing with binary search on texel density (texels per source unit)
  const order = rects.map((_, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w || a - b);
  const place = (s, commit) => {
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const r = rects[i];
      const W = Math.ceil(r.w * s) + 2 * pad, Hh = Math.ceil(r.h * s) + 2 * pad;
      if (W > atlas) return false;
      if (x + W > atlas) { y += rowH; x = 0; rowH = 0; }
      if (y + Hh > atlas) return false;
      if (commit) { r.ox = x; r.oy = y; r.W = W; r.H = Hh; }
      x += W; rowH = Math.max(rowH, Hh);
    }
    return true;
  };
  let lo = 1, hi = 1e7;
  for (let it = 0; it < 60; it++) { const mid = Math.sqrt(lo * hi); if (place(mid, false)) lo = mid; else hi = mid; }
  const texelsPerUnit = lo;
  place(texelsPerUnit, true);

  // build output vertex buffers: one vertex per (chart, smoothing group); group implies vertex
  const keyMap = new Map();
  const oPos = [], oNrm = [], oUV = [], oIdx = new Uint32Array(nf * 3);
  const nCharts = live.length;
  let usedTexels = 0;
  for (const r of rects) usedTexels += (r.W - 2 * pad) * (r.H - 2 * pad);
  for (let f = 0; f < nf; f++) {
    const ci = chartOf[f]; const r = rects[ci]; const m = chartVerts[ci];
    for (let e = 0; e < 3; e++) {
      const v = idx[3 * f + e], G = cornerGroup[3 * f + e];
      const key = G * nCharts + ci;
      let o = keyMap.get(key);
      if (o === undefined) {
        o = oPos.length / 3; keyMap.set(key, o);
        oPos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
        const n = groupNormals[G]; oNrm.push(n[0], n[1], n[2]);
        const [X, Y] = m.get(v);
        oUV.push((r.ox + pad + (X - r.x0) * texelsPerUnit) / atlas, (r.oy + pad + (r.y1 - Y) * texelsPerUnit) / atlas);
      }
      oIdx[3 * f + e] = o;
    }
  }
  const faceChart = Int32Array.from(chartOf);
  return {
    pos: Float32Array.from(oPos), nrm: Float32Array.from(oNrm), uv: Float32Array.from(oUV), idx: oIdx, faceChart,
    stats: {charts: nCharts, mergedSmallCharts: merges, degenerateNormalGroups: zeroNormals, texelsPerSourceUnit: texelsPerUnit, atlas, pad, chartAreaFraction: usedTexels / (atlas * atlas), vertices: oPos.length / 3, triangles: nf},
  };
}
