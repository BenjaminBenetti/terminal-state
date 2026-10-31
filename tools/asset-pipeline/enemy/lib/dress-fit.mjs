// Task track1-siren-blightbelly-20261031 (lane RIGS): UNIFORM dress fit for an appearance-locked garment.
// The dress is never reshaped: only D(v) = s * v + t (one uniform scale + translation; rotation fixed) is solved, mapping the
// dress's native frame into the placed body's game frame. Measured objective on game-space ANALYSIS copies:
//   - poke-through (exact ray test): a body SKIN vertex (hair excluded) whose outward horizontal normal ray meets no dress
//     surface, while a dress surface lies just behind it (within `behind` m inward) = skin showing through the garment.
//     Vertices with no dress on either side (tears, armholes, the open neckline) are NOT counted — the dress is open there
//     by design. Penalty = sum of squared depths (smooth enough for Nelder-Mead).
//   - strap anchor: the dress's top band must rest on the shoulder skin (gap target +4 mm), not float or sink;
//   - bodice ease: mean distance of bodice samples to the nearest skin sample (mild; keeps the fit from going baggy);
//   - hem clearance: the hem stays above the floor.
// Every term is reported for the chosen fit so it can be judged honestly.

function hashGrid(pts, ids, cell) {
  const m = new Map();
  for (const i of ids) {
    const k = `${Math.floor(pts[i * 3] / cell)},${Math.floor(pts[i * 3 + 1] / cell)},${Math.floor(pts[i * 3 + 2] / cell)}`;
    let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(i);
  }
  return {m, cell, pts};
}
function nearest(g, x, y, z, rMax = 3) {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell), cz = Math.floor(z / g.cell);
  let best = Infinity;
  for (let r = 0; r <= rMax; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      const a = g.m.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!a) continue;
      for (const i of a) { const d = (g.pts[i * 3] - x) ** 2 + (g.pts[i * 3 + 1] - y) ** 2 + (g.pts[i * 3 + 2] - z) ** 2; if (d < best) best = d; }
    }
    if (best <= (r * g.cell) ** 2) break;
  }
  return Math.sqrt(best);
}

/** Möller–Trumbore; returns t or -1. Triangles given as 9 floats in T at offset o. */
function rayTri(ox, oy, oz, dx, dz, T, o) {
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az, e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
  const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y; // d = (dx, 0, dz)
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dz * qz) * inv; if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/**
 * Poke-through of body skin vertices through a placed dress. dressPos: game-space dress positions; returns
 * {tested, count, maxM, sumSq, verts (Uint8Array flags), byRegion}.
 */
export function pokeThrough(body, dressPos, dressIdx, {behind = 0.08, ahead = 0.3} = {}) {
  const nt = dressIdx.length / 3, T = new Float32Array(nt * 9);
  const bands = new Map();
  let y0 = Infinity, y1 = -Infinity;
  for (let t = 0; t < nt; t++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 3; k++) { const i = dressIdx[t * 3 + k]; for (let c = 0; c < 3; c++) T[t * 9 + k * 3 + c] = dressPos[i * 3 + c]; const y = dressPos[i * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); }
    y0 = Math.min(y0, lo); y1 = Math.max(y1, hi);
    for (let b = Math.floor(lo / 0.01); b <= Math.floor(hi / 0.01); b++) { let a = bands.get(b); if (!a) bands.set(b, (a = [])); a.push(t); }
  }
  const P = body.pos, N = body.nrm, n = P.length / 3, flags = new Uint8Array(n);
  let tested = 0, count = 0, maxM = 0, sumSq = 0;
  const byRegion = {};
  for (const i of body.testIds) {
    const ox = P[i * 3], oy = P[i * 3 + 1], oz = P[i * 3 + 2];
    if (oy < y0 + 0.02 || oy > y1 - 0.02) continue;
    let dx = N[i * 3], dz = N[i * 3 + 2]; const l = Math.hypot(dx, dz); if (l < 0.3) continue; dx /= l; dz /= l;
    const tris = bands.get(Math.floor(oy / 0.01)); if (!tris) continue;
    tested++;
    let out = Infinity, back = Infinity;
    for (const t of tris) {
      const h = rayTri(ox, oy, oz, dx, dz, T, t * 9);
      if (h > 0 && h < out) out = h;
      const g = rayTri(ox, oy, oz, -dx, -dz, T, t * 9);
      if (g > 0 && g < back) back = g;
    }
    if (out > ahead && back < behind) {
      flags[i] = 1; count++; sumSq += back * back; maxM = Math.max(maxM, back);
      const k = `y${(Math.round(oy * 20) / 20).toFixed(2)}:${oz < -0.04 ? 'back' : oz > 0.04 ? 'front' : 'side'}${ox < 0 ? 'R' : 'L'}`;
      byRegion[k] = Math.max(byRegion[k] ?? 0, +back.toFixed(3));
    }
  }
  return {tested, count, maxM: +maxM.toFixed(4), sumSq, flags, byRegion};
}

/**
 * @param dress {pos, idx (native), samples (native Float32Array xyz)}
 * @param body {pos, nrm, testIds (skin vertices to test), skinSamples (game-space xyz of non-hair samples)}
 * @param opts {init: {s, t}, fixScale?, strapBand, bodiceBand, weights, floorClear}
 */
export function fitDress(dress, body, opts = {}) {
  const W = {pen: 3e4, strap: 4e4, ease: 3, hem: 1e4, ...(opts.weights || {})};
  const D = dress.samples, nd = D.length / 3;
  let dTop = -Infinity, dBot = Infinity;
  for (let i = 1; i < dress.pos.length; i += 3) { dTop = Math.max(dTop, dress.pos[i]); dBot = Math.min(dBot, dress.pos[i]); }
  const strapBand = opts.strapBand ?? 0.015, bodiceBand = opts.bodiceBand ?? 0.30;
  const strapIds = [], bodiceIds = [];
  for (let i = 0; i < nd; i++) {
    const y = D[i * 3 + 1];
    if (y > dTop - strapBand) strapIds.push(i);
    else if (y > dTop - bodiceBand * (dTop - dBot) && i % 4 === 0) bodiceIds.push(i);
  }
  const S = body.skinSamples, ns = S.length / 3;
  const grid = hashGrid(S, [...Array(ns).keys()], 0.02);
  const colTop = new Map();
  for (let i = 0; i < ns; i++) { const k = `${Math.floor(S[i * 3] / 0.01)},${Math.floor(S[i * 3 + 2] / 0.01)}`; const y = S[i * 3 + 1]; if (y > (colTop.get(k) ?? -Infinity)) colTop.set(k, y); }
  const topAt = (x, z) => { let best = -Infinity; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const v = colTop.get(`${Math.floor(x / 0.01) + dx},${Math.floor(z / 0.01) + dz}`); if (v != null && v > best) best = v; } return best; };
  const place = ([s, tx, ty, tz]) => { const o = new Float32Array(dress.pos.length); for (let i = 0; i < o.length; i += 3) { o[i] = s * dress.pos[i] + tx; o[i + 1] = s * dress.pos[i + 1] + ty; o[i + 2] = s * dress.pos[i + 2] + tz; } return o; };

  const evaluate = (p, detail = false) => {
    const [s, tx, ty, tz] = p;
    if (!(s > 0)) return {E: Infinity};
    const pk = pokeThrough(body, place(p), dress.idx);
    let strap = 0, strapN = 0, gapSum = 0;
    for (const i of strapIds) {
      const x = s * D[i * 3] + tx, y = s * D[i * 3 + 1] + ty, z = s * D[i * 3 + 2] + tz;
      const top = topAt(x, z); if (!Number.isFinite(top)) continue;
      const g = y - top; gapSum += g; strapN++; strap += (g - 0.004) ** 2;
    }
    let ease = 0, easeN = 0;
    for (const i of bodiceIds) { const d = nearest(grid, s * D[i * 3] + tx, s * D[i * 3 + 1] + ty, s * D[i * 3 + 2] + tz); if (Number.isFinite(d)) { ease += d; easeN++; } }
    const hemY = s * dBot + ty, hemPen = Math.max(0, (opts.floorClear ?? 0.06) - hemY);
    const E = W.pen * pk.sumSq + W.strap * (strapN ? strap / strapN : 1) + W.ease * (easeN ? ease / easeN : 1) + W.hem * hemPen * hemPen;
    if (!detail) return {E};
    return {E: +E.toFixed(5), pokeThrough: {skinVerticesTested: pk.tested, verticesThrough: pk.count, maxDepthM: pk.maxM, byRegionMaxDepthM: pk.byRegion},
      strap: {samples: strapN, meanGapM: +(gapSum / Math.max(1, strapN)).toFixed(4)}, bodice: {samples: easeN, meanDistToSkinM: +(ease / Math.max(1, easeN)).toFixed(4)},
      hemY: +hemY.toFixed(4), flags: pk.flags};
  };

  const p0 = [opts.init.s, ...opts.init.t];
  let best, nm;
  if (opts.fixScale) {
    nm = nelderMead(q => evaluate([opts.fixScale, ...q]).E, p0.slice(1), [0.01, 0.01, 0.008], opts.iterations ?? 120);
    best = [opts.fixScale, ...nm.x];
  } else {
    nm = nelderMead(p => evaluate(p).E, p0, [0.03, 0.01, 0.02, 0.008], opts.iterations ?? 160);
    best = nm.x;
  }
  const report = evaluate(best, true);
  return {s: best[0], t: [best[1], best[2], best[3]], evaluations: nm.evals, init: {s: p0[0], t: p0.slice(1)}, report, initReport: evaluate(p0, true),
    dressNative: {top: dTop, bottom: dBot}, weights: W, bands: {strapBand, bodiceBand}, evaluate, place};
}

export function nelderMead(f, x0, step, iters) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; simplex.push(x); }
  let vals = simplex.map(f), evals = n + 1;
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
    simplex = order.map(i => simplex[i]); vals = order.map(i => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += simplex[i][k] / n;
    const xr = c.map((v, k) => v + (v - simplex[n][k])), fr = f(xr); evals++;
    if (fr < vals[0]) {
      const xe = c.map((v, k) => v + 2 * (v - simplex[n][k])), fe = f(xe); evals++;
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((v, k) => v + 0.5 * (simplex[n][k] - v)), fc = f(xc); evals++;
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, k) => simplex[0][k] + 0.5 * (v - simplex[0][k])); vals[i] = f(simplex[i]); evals++; } }
    }
    if (Math.abs(vals[n] - vals[0]) < 1e-10) break;
  }
  const i = vals.indexOf(Math.min(...vals));
  return {x: simplex[i], f: vals[i], evals};
}
