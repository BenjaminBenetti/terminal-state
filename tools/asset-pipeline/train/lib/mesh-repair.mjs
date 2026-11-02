// Task studio-beta-train-shell-followup-20261101-221246-01 (lane ASSETS): deterministic mesh repair for the cooked player-train
// shell (used by build-player-train.mjs). Vertex records are [px, py, pz, nx, ny, nz, u, v, cls] (cls = the source class tag).
//  - censusOf: degenerate / sliver / normal-vs-winding disagreements / near-coincident parallel overlaps (z-fighting, folds:
//    opposite winding) / non-manifold edges;
//  - resolveCoverage: single coverage of near-coincident parallel surfaces: triangles in priority order, each clipped against the
//    already-kept pieces it overlaps (parallel within COS, planes within GAP), so folds (inward flaps over the skin) and duplicate
//    layers vanish while the covered area stays covered (no holes); attributes interpolated, no vertex moved;
//  - dropDegenerate; creaseNormals: vertex normals recomputed from the final faces, smoothed only across edges whose faces bend by
//    less than the crease angle (never across opposite windings).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const lerpV = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
export const faceNormal = t => cross(sub(t[1], t[0]), sub(t[2], t[0])); // area x 2, winding direction
export const areaOf = poly => { let n = [0, 0, 0]; for (let i = 1; i + 1 < poly.length; i++) { const c = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0])); n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]]; } return len(n) / 2; };
const fan = poly => { const t = []; for (let i = 1; i + 1 < poly.length; i++) t.push([poly[0], poly[i], poly[i + 1]]); return t; };

/** Convex polygon (records) clipped to side(v) >= 0. */
function clipSide(poly, side) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = side(a), db = side(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(lerpV(a, b, da / (da - db)));
  }
  return out.length >= 3 ? out : [];
}

/** Planar basis of a unit normal. */
const basis = n => { const ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]; const u = norm(cross(n, ax)); return [u, cross(n, u)]; };

/** poly minus the convex polygon K (both near-coplanar; K's plane projection): up to K.length convex pieces outside K. */
function subtractConvex(poly, K) {
  const [u, w] = basis(K.n);
  const k2 = K.poly.map(q => [dot(q, u), dot(q, w)]);
  // orient K counter-clockwise in (u, w)
  let s = 0; for (let i = 0; i < k2.length; i++) { const p = k2[i], q = k2[(i + 1) % k2.length]; s += p[0] * q[1] - q[0] * p[1]; }
  const ccw = s >= 0;
  const edgeSide = i => { const a = k2[i], b = k2[(i + 1) % k2.length]; return v => { const p = [dot(v, u), dot(v, w)]; const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); return ccw ? c : -c; }; };
  const pieces = [];
  let rest = poly;
  for (let i = 0; i < k2.length && rest.length; i++) {
    const side = edgeSide(i);
    const outside = clipSide(rest, v => -side(v));
    if (outside.length) pieces.push(outside);
    rest = clipSide(rest, side);
  }
  pieces.inside = rest; // the part inside K (callers decide)
  return pieces;
}

/** The overlap `inside` of a face with K is coincident (z-fighting) when all its vertices lie within `gap` of K's plane. */
const coincident = (inside, K, gap) => inside.length >= 3 && inside.every(v => Math.abs(dot(K.n, sub(v, K.poly[0]))) <= gap);

/**
 * Single coverage of near-coincident parallel surfaces. `priority(t)` -> number (lower first; ties by larger area first).
 * Returns {tris, removedArea, clippedTriangles}.
 */
export function resolveCoverage(tris, priority, {cos = 0.97, gap = 0.003, cell = 0.3, minArea = 1e-7} = {}) {
  const items = tris.map((t, i) => { const fnv = faceNormal(t), a = len(fnv) / 2; return {t, i, n: norm(fnv), a, pr: priority(t)}; })
    .filter(x => x.a > minArea).sort((p, q) => p.pr - q.pr || q.a - p.a || p.i - q.i);
  const grid = new Map(), kept = [];
  const cellsOf = poly => { const lo = [0, 1, 2].map(k => Math.floor(Math.min(...poly.map(v => v[k])) / cell)), hi = [0, 1, 2].map(k => Math.floor(Math.max(...poly.map(v => v[k])) / cell)); const out = []; for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) out.push(`${x},${y},${z}`); return out; };
  let removedArea = 0, clippedTriangles = 0;
  for (const it of items) {
    const near = new Set();
    for (const c of cellsOf(it.t)) for (const k of grid.get(c) ?? []) near.add(k);
    let pieces = [it.t];
    let touched = false;
    for (const k of [...near].sort((a, b) => a - b)) {
      const K = kept[k];
      if (Math.abs(dot(K.n, it.n)) < cos) continue;
      const next = [];
      let changed = false;
      for (const p of pieces) {
        const out = subtractConvex(p, K);
        // only the overlapping part that is coincident with K (inside its +-gap slab) goes; untouched pieces stay exact
        if (coincident(out.inside, K, gap) && areaOf(out.inside) > minArea) { next.push(...out); changed = true; } else next.push(p);
      }
      if (changed) { touched = true; pieces = next; }
    }
    if (touched) { clippedTriangles++; removedArea += it.a - pieces.reduce((s, p) => s + areaOf(p), 0); }
    for (const p of pieces) {
      if (areaOf(p) <= minArea) continue;
      const idx = kept.length;
      kept.push({poly: p, n: it.n});
      for (const c of cellsOf(p)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(idx); }
    }
  }
  const out = [];
  for (const K of kept) for (const t of fan(K.poly)) if (areaOf(t) > minArea) out.push(t);
  return {tris: out, removedArea, clippedTriangles};
}

/** Drops zero-area / collapsed triangles. */
export const dropDegenerate = (tris, minArea = 1e-7) => tris.filter(t => areaOf(t) > minArea);

/** Crease-angle vertex normals from the faces (positions welded at `weld` m). */
export function creaseNormals(tris, creaseDeg = 40, weld = 1e-5) {
  const key = v => `${Math.round(v[0] / weld)},${Math.round(v[1] / weld)},${Math.round(v[2] / weld)}`;
  const fn = tris.map(faceNormal), un = fn.map(norm), byPos = new Map(), cosC = Math.cos(creaseDeg * Math.PI / 180);
  tris.forEach((t, f) => t.forEach(v => { const k = key(v); if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(f); }));
  return tris.map((t, f) => t.map(v => {
    const n = [0, 0, 0];
    for (const g of byPos.get(key(v))) if (dot(un[f], un[g]) >= cosC) for (let k = 0; k < 3; k++) n[k] += fn[g][k];
    const nn = norm(n);
    const r = [...v]; r[3] = nn[0]; r[4] = nn[1]; r[5] = nn[2];
    return r;
  }));
}

/** Defect census of record triangles (see the header). */
export function censusOf(tris, {cos = 0.97, gap = 0.003, cell = 0.3, sliverRatio = 0.01, sliverMinLen = 0.02, minOverlap = 1e-4} = {}) {
  const c = {triangles: tris.length, degenerate: 0, sliver: 0, normalFlip: 0, foldOverlaps: 0, foldArea: 0, duplicateOverlaps: 0, duplicateArea: 0, nonManifoldEdges: 0};
  const items = [];
  tris.forEach((t, i) => {
    const fnv = faceNormal(t), a = len(fnv) / 2, e = [len(sub(t[1], t[0])), len(sub(t[2], t[1])), len(sub(t[0], t[2]))], emax = Math.max(...e);
    if (a < 1e-7 || emax < 1e-6) { c.degenerate++; return; }
    if ((2 * a / emax) / emax < sliverRatio && emax > sliverMinLen) c.sliver++;
    const vn = [0, 1, 2].map(k => t[0][3 + k] + t[1][3 + k] + t[2][3 + k]);
    if (dot(fnv, vn) < 0) c.normalFlip++;
    items.push({t, i, n: norm(fnv), a});
  });
  const key = v => `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`, edges = new Map();
  for (const {t} of items) { const ks = t.map(key); for (let j = 0; j < 3; j++) { const a = ks[j], b = ks[(j + 1) % 3]; if (a === b) continue; const k = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(k, (edges.get(k) ?? 0) + 1); } }
  for (const n of edges.values()) if (n > 2) c.nonManifoldEdges++;
  const grid = new Map();
  items.forEach((it, k) => { const lo = [0, 1, 2].map(d => Math.floor(Math.min(...it.t.map(v => v[d])) / cell)), hi = [0, 1, 2].map(d => Math.floor(Math.max(...it.t.map(v => v[d])) / cell)); for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const g = `${x},${y},${z}`; if (!grid.has(g)) grid.set(g, []); grid.get(g).push(k); } });
  const seen = new Set();
  for (const list of grid.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const A = items[list[x]], B = items[list[y]], pk = A.i < B.i ? `${A.i}|${B.i}` : `${B.i}|${A.i}`;
    if (seen.has(pk)) continue; seen.add(pk);
    const cs = dot(A.n, B.n); if (Math.abs(cs) < cos) continue;
    const K = {poly: A.t, n: A.n}, inside = subtractConvex(B.t, K).inside;
    if (!coincident(inside, K, gap)) continue;
    const ov = areaOf(inside);
    if (ov <= minOverlap) continue;
    if (cs < 0) { c.foldOverlaps++; c.foldArea += ov; } else { c.duplicateOverlaps++; c.duplicateArea += ov; }
  }
  c.foldArea = +c.foldArea.toFixed(3); c.duplicateArea = +c.duplicateArea.toFixed(3);
  return c;
}

/**
 * Orthographic raster of the outermost surface along a face normal (side +-Z: u = x, v = y; end +-X: u = z, v = y) over a box, with
 * the base-colour luminance there. `img` = {data (RGB), w, h}. Returns {W, H, dep, lum, u0, v1, px}.
 */
export function rasterFace(tris, img, {face, sign, u0, u1, v0, v1, nMin, nMax = Infinity, px = 0.01}) {
  const ax = face === 'side' ? {u: 0, v: 1, n: 2} : {u: 2, v: 1, n: 0};
  const W = Math.ceil((u1 - u0) / px), H = Math.ceil((v1 - v0) / px);
  const dep = new Float32Array(W * H).fill(-Infinity), lum = new Float32Array(W * H).fill(NaN);
  for (const t of tris) {
    if (Math.max(...t.map(q => sign * q[ax.n])) < nMin || Math.min(...t.map(q => sign * q[ax.n])) > nMax) continue;
    const s = t.map(q => [(q[ax.u] - u0) / px, (v1 - q[ax.v]) / px, sign * q[ax.n]]);
    const d = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(d) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(...s.map(q => q[0])))), maxX = Math.min(W - 1, Math.ceil(Math.max(...s.map(q => q[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...s.map(q => q[1])))), maxY = Math.min(H - 1, Math.ceil(Math.max(...s.map(q => q[1]))));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const a = ((s[1][0] - qx) * (s[2][1] - qy) - (s[2][0] - qx) * (s[1][1] - qy)) / d, b = ((s[2][0] - qx) * (s[0][1] - qy) - (s[0][0] - qx) * (s[2][1] - qy)) / d, c = 1 - a - b;
      if (a < 0 || b < 0 || c < 0) continue;
      const z = a * s[0][2] + b * s[1][2] + c * s[2][2];
      if (z < nMin || z > nMax) continue;
      const i = y * W + x;
      if (z <= dep[i]) continue;
      dep[i] = z;
      const uu = a * t[0][6] + b * t[1][6] + c * t[2][6], vv = a * t[0][7] + b * t[1][7] + c * t[2][7];
      const tx = Math.min(img.w - 1, Math.max(0, Math.floor((uu - Math.floor(uu)) * img.w))), ty = Math.min(img.h - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * img.h)));
      const o = (ty * img.w + tx) * 3;
      lum[i] = 0.3 * img.data[o] + 0.59 * img.data[o + 1] + 0.11 * img.data[o + 2];
    }
  }
  return {W, H, dep, lum, u0, v1, px};
}

/** Union bbox (u0, u1, v0, v1) of the dark connected components (lum < dark, >= minPx pixels) of a raster, or null. */
export function darkBox(r, {dark = 55, minPx = 150} = {}) {
  const {W, H, lum, u0, v1, px} = r, seen = new Uint8Array(W * H);
  let box = null;
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || !(lum[i] < dark)) continue;
    const st = [i]; seen[i] = 1; let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (k >= 0 && k < W * H && !seen[k] && lum[k] < dark) { seen[k] = 1; st.push(k); }
    }
    if (n < minPx) continue;
    const b = {u0: u0 + x0 * px, u1: u0 + (x1 + 1) * px, v0: v1 - (y1 + 1) * px, v1: v1 - y0 * px};
    box = box ? {u0: Math.min(box.u0, b.u0), u1: Math.max(box.u1, b.u1), v0: Math.min(box.v0, b.v0), v1: Math.max(box.v1, b.v1)} : b;
  }
  return box;
}

/** Minimum outermost depth on a ring `ring` outside a rect (raster units), i.e. the innermost skin around an opening. */
export function ringMin(r, rect, ring = 0.02) {
  const {W, H, dep, u0, v1, px} = r;
  let m = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = u0 + (x + 0.5) * px, v = v1 - (y + 0.5) * px;
    const inOuter = u >= rect.u0 - ring && u <= rect.u1 + ring && v >= rect.v0 - ring && v <= rect.v1 + ring;
    const inInner = u > rect.u0 && u < rect.u1 && v > rect.v0 && v < rect.v1;
    if (inOuter && !inInner && dep[y * W + x] > -Infinity) m = Math.min(m, dep[y * W + x]);
  }
  return m;
}

/**
 * Removes the part of every triangle inside an axis-aligned rect in the (u, v) projection whose normal-axis coordinate (x sign) is
 * beyond nMin (exact clipping, attributes interpolated). Returns {tris, removedArea}.
 */
export function cutRect(tris, {u, v, n, u0, u1, v0, v1, sign, nMin}) {
  const out = [];
  let removedArea = 0;
  const cl = (poly, axis, value, s) => clipSide(poly, q => s * (q[axis] - value));
  for (const t of tris) {
    if (Math.max(...t.map(q => q[u])) <= u0 || Math.min(...t.map(q => q[u])) >= u1 || Math.max(...t.map(q => q[v])) <= v0 || Math.min(...t.map(q => q[v])) >= v1 || Math.max(...t.map(q => sign * q[n])) < nMin) { out.push(t); continue; }
    const pieces = [cl(t, u, u0, -1), cl(t, u, u1, 1)];
    const mid = cl(cl(t, u, u0, 1), u, u1, -1);
    pieces.push(cl(mid, v, v1, 1), cl(mid, v, v0, -1));
    const inside = cl(cl(mid, v, v1, -1), v, v0, 1);
    if (inside.length) {
      const c = inside.reduce((s, q) => s + sign * q[n], 0) / inside.length;
      if (c > nMin) removedArea += areaOf(inside); else pieces.push(inside);
    }
    for (const p of pieces) for (const q of fan(p)) if (areaOf(q) > 1e-9) out.push(q);
  }
  return {tris: out, removedArea};
}

/** resolveCoverage repeated until a pass clips nothing (the coincidence test is per overlap region, so smaller pieces from one pass can
 *  reveal coincident overlaps the next pass resolves); at most `passes`. */
export function resolveCoverageFull(tris, priority, opts = {}, passes = 6) {
  let cur = tris, removedArea = 0, clippedTriangles = 0, n = 0;
  for (; n < passes; n++) {
    const r = resolveCoverage(cur, priority, opts);
    cur = dropDegenerate(r.tris);
    removedArea += r.removedArea; clippedTriangles += r.clippedTriangles;
    if (!r.clippedTriangles) break;
  }
  return {tris: cur, removedArea, clippedTriangles, passes: n + 1};
}

/**
 * Occupancy box of the dark glass in a raster (robust to stray dark smears outside a window): the longest run of columns that are dark
 * in >= colFrac of the rows, then within it the longest run of rows dark in >= rowFrac of those columns. Returns {u0, u1, v0, v1} or null.
 */
export function darkBoxOccupancy(r, {dark = 55, colFrac = 0.25, rowFrac = 0.25} = {}) {
  const {W, H, lum, u0, v1, px} = r;
  const isDark = i => lum[i] < dark;
  const longestRun = flags => { let best = null, s = -1; for (let i = 0; i <= flags.length; i++) { if (i < flags.length && flags[i]) { if (s < 0) s = i; } else if (s >= 0) { if (!best || i - s > best[1] - best[0]) best = [s, i]; s = -1; } } return best; };
  const cols = Array.from({length: W}, (_, x) => { let n = 0; for (let y = 0; y < H; y++) if (isDark(y * W + x)) n++; return n / H >= colFrac; });
  const cr = longestRun(cols);
  if (!cr) return null;
  const rows = Array.from({length: H}, (_, y) => { let n = 0; for (let x = cr[0]; x < cr[1]; x++) if (isDark(y * W + x)) n++; return n / (cr[1] - cr[0]) >= rowFrac; });
  const rr = longestRun(rows);
  if (!rr) return null;
  return {u0: u0 + cr[0] * px, u1: u0 + cr[1] * px, v0: v1 - rr[1] * px, v1: v1 - rr[0] * px};
}

/**
 * Task studio-beta-train-window-fit-20261102-004022-01 (lane TRAIN's probe: a slit below the platform-side roof cove, slivers above the
 * door heads, a crescent above a far-side window, slits along the roof): cracks in Meshy's own surface (present in the raw mesh, widened
 * by the body's vertical stretch), filled by BACKING STRIPS. In a projection (side: u = x, v = y, depth = sign * z; roof: u = x, v = z,
 * depth = y) the outermost surface is rastered with its texture coordinates; a crack = a run of empty pixels along v bounded by skin on
 * both sides, <= maxGap long, outside every intended opening. Runs of neighbouring columns merge into quads (<= maxRun along u) placed
 * `offset` behind the shallower bounding skin (outside the census's coincidence band) and overlapping `margin` behind both skin edges,
 * textured with the texel of the skin on the run's low-v side (a continuous painted band), normal along the projection. Records
 * [px, py, pz, nx, ny, nz, u, v, cls].
 */
export function crackStrips(tris, {face, sign, u0, u1, v0, v1, nMin, nMax = Infinity, px = 0.01, maxGap = 0.08, intended = () => false, offset = 0.004, margin = 0.01, mergeTol = 0.012, maxRun = 0.5, cls = 0}) {
  const ax = face === 'side' ? {u: 0, v: 1, n: 2} : {u: 0, v: 2, n: 1};
  const W = Math.ceil((u1 - u0) / px), H = Math.ceil((v1 - v0) / px);
  const dep = new Float32Array(W * H).fill(NaN), tu = new Float32Array(W * H), tv = new Float32Array(W * H);
  for (const t of tris) {
    if (Math.max(...t.map(q => sign * q[ax.n])) < nMin || Math.min(...t.map(q => sign * q[ax.n])) > nMax) continue;
    const s = t.map(q => [(q[ax.u] - u0) / px, (v1 - q[ax.v]) / px, sign * q[ax.n]]);
    const d = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...s.map(q => q[1])))); y <= Math.min(H - 1, Math.ceil(Math.max(...s.map(q => q[1])))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...s.map(q => q[0])))); x <= Math.min(W - 1, Math.ceil(Math.max(...s.map(q => q[0])))); x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const a = ((s[1][0] - qx) * (s[2][1] - qy) - (s[2][0] - qx) * (s[1][1] - qy)) / d, b = ((s[2][0] - qx) * (s[0][1] - qy) - (s[0][0] - qx) * (s[2][1] - qy)) / d, c = 1 - a - b;
        if (a < 0 || b < 0 || c < 0) continue;
        const z = a * s[0][2] + b * s[1][2] + c * s[2][2];
        if (z < nMin || z > nMax) continue;
        const i = y * W + x;
        if (z <= dep[i]) continue;
        dep[i] = z; tu[i] = a * t[0][6] + b * t[1][6] + c * t[2][6]; tv[i] = a * t[0][7] + b * t[1][7] + c * t[2][7];
      }
  }
  const uOf = x => u0 + (x + 0.5) * px, vOf = y => v1 - (y + 0.5) * px; // image row y grows toward low v
  // per column: crack runs (rows yTop..yBot empty, surface at yTop - 1 (high v) and yBot + 1 (low v))
  // an intended opening is a valid bound too: a crack touching a door head / window edge is filled from the opening's exact edge
  // (bisected) to the skin (no margin into the opening)
  const edgeV = (u, vIn, vOut) => { let a = vIn, b = vOut; for (let k = 0; k < 20; k++) { const m = (a + b) / 2; if (intended(u, m)) a = m; else b = m; } return b; };
  const cols = [];
  for (let x = 0; x < W; x++) {
    const runs = [];
    const u = uOf(x), state = k => (!Number.isNaN(dep[k * W + x]) ? 'skin' : intended(u, vOf(k)) ? 'open' : 'hole');
    let y = 0;
    while (y < H) {
      if (state(y) !== 'hole') { y++; continue; }
      const yTop = y; while (y < H && state(y) === 'hole') y++;
      const yBot = y - 1;
      if (yTop === 0 || y >= H) continue; // touches the raster edge: not bounded
      if ((yBot - yTop + 1) * px > maxGap) continue;
      const hi = state(yTop - 1), lo = state(yBot + 1);
      if (hi === 'open' && lo === 'open') continue; // between two openings: nothing to back
      const hiI = (yTop - 1) * W + x, loI = (yBot + 1) * W + x;
      const skinI = lo === 'skin' ? loI : hiI;
      const d = (hi === 'skin' && lo === 'skin' ? Math.min(dep[hiI], dep[loI]) : dep[skinI]) - offset;
      const vHi = hi === 'open' ? edgeV(u, vOf(yTop - 1), vOf(yTop)) : vOf(yTop) + px / 2 + margin;
      const vLo = lo === 'open' ? edgeV(u, vOf(yBot + 1), vOf(yBot)) : vOf(yBot) - px / 2 - margin;
      runs.push({vHi, vLo, d, uv: [tu[skinI], tv[skinI]]});
    }
    cols.push(runs);
  }
  // merge runs of neighbouring columns into quads
  const quads = [], used = cols.map(r => r.map(() => false));
  for (let x = 0; x < W; x++) cols[x].forEach((r, k) => {
    if (used[x][k]) return;
    used[x][k] = true;
    let q = {x0: x, x1: x, vHi: r.vHi, vLo: r.vLo, d: r.d, uv: r.uv, last: r};
    for (let x2 = x + 1; x2 < W && (x2 - x + 1) * px <= maxRun; x2++) {
      const k2 = cols[x2].findIndex((s, j) => !used[x2][j] && Math.abs(s.vHi - q.last.vHi) <= mergeTol && Math.abs(s.vLo - q.last.vLo) <= mergeTol);
      if (k2 < 0) break;
      const s = cols[x2][k2]; used[x2][k2] = true;
      q = {...q, x1: x2, vHi: Math.max(q.vHi, s.vHi), vLo: Math.min(q.vLo, s.vLo), d: Math.min(q.d, s.d), last: s};
    }
    quads.push(q);
  });
  const out = [];
  for (const q of quads) {
    const ua = u0 + q.x0 * px, ub = u0 + (q.x1 + 1) * px, va = q.vLo, vb = q.vHi; // margins applied per run (none toward an opening)
    const pt = (u, v) => { const p = [0, 0, 0]; p[ax.u] = u; p[ax.v] = v; p[ax.n] = sign * q.d; return p; };
    const n = [0, 0, 0]; n[ax.n] = sign;
    const rec = p => [...p, ...n, q.uv[0], q.uv[1], cls];
    const A = rec(pt(ua, va)), B = rec(pt(ub, va)), C = rec(pt(ub, vb)), D = rec(pt(ua, vb));
    const t1 = [A, B, C], fn = faceNormal(t1);
    if (dot(fn, n) >= 0) out.push([A, B, C], [A, C, D]); else out.push([A, C, B], [A, D, C]);
  }
  return out;
}
