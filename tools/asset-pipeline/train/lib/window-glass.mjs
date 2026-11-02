// Task studio-beta-train-window-fit-20261102-004022-01 (lane ASSETS; user: "front window is not curved to align with the body of the
// subway car, it should be. all windows need to be better matched to car geometry"): CONFORMAL window glass + reveals for the cooked
// player-train shell, used by build-player-train.mjs. Pure geometry, deterministic, no textures.
//
// Per opening the glass follows the ORIGINAL pane surface of the model: the pre-cut (repaired) shell is sampled by rays on a grid over
// the hole's interior (inset from the gasket), and a smooth surface is fitted to those samples (least squares on the inner envelope:
// samples standing proud of the fit, e.g. a skin layer that covered a pane, are dropped iteratively):
//  - side window: depth = side * z over (u = x, v = y), biquadratic;
//  - centre end window: depth = end * x over (u = z, v = y), biquadratic;
//  - WRAP (an outer end window + its nose-corner window = ONE opening round the curved nose): depth = the plan radius about a vertical
//    axis inside the car, over (u = the plan angle, v = y), cubic in u x quadratic in v.
// The sheet is that surface on a regular grid over the hole + an overlap band (tucked behind the gasket: no gap at the edge), with ONE
// uniform recess per sheet (>= RECESS behind the pane, and behind every surface that REMAINS under the sheet by >= CLEARANCE, so it never
// pokes through), outward normals. Hitscan boxes: thin axis-aligned slabs covering the sheet (recursive split until each is <= BOX_THICK
// on its thinnest axis or MAX_BOXES). Reveals: ruled strips from the hole's own boundary loop (on the remaining skin's cut edge) to the
// lining cut-out (the published rect on the lining plane), normals facing into the opening; across a door-leaf pocket the strip leaves
// the leaf slot open.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Farthest hit distance of a ray (origin o, unit dir d) on the candidate triangles, or NaN (Moller-Trumbore, both faces). */
function farthestHit(cands, o, d) {
  let best = NaN;
  for (const [a, b, c] of cands) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, s = sub(o, a), u = dot(s, p) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = cross(s, e1), v = dot(d, q) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = dot(e2, q) * inv;
    if (t > 0 && !(t <= best)) best = t;
  }
  return best;
}

/** Nearest hit distance > tMin of a ray on the candidate triangles, or NaN. */
function nearestHit(cands, o, d, tMin) {
  let best = NaN;
  for (const [a, b, c] of cands) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, s = sub(o, a), u = dot(s, p) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = cross(s, e1), v = dot(d, q) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = dot(e2, q) * inv;
    if (t > tMin && !(t >= best)) best = t;
  }
  return best;
}

/** Least squares: coefficients c for sum_k c_k f_k(u, v) ~ d (normal equations, Gaussian elimination with partial pivoting). */
function lsq(samples, terms) {
  const n = terms.length, A = Array.from({length: n}, () => new Array(n + 1).fill(0));
  for (const {u, v, d} of samples) {
    const f = terms.map(t => t(u, v));
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += f[i] * f[j]; A[i][n] += f[i] * d; }
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-9;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j]; }
  }
  return A.map((row, i) => row[n] / row[i]);
}
const polyTerms = (du, dv) => { const t = []; for (let i = 0; i <= du; i++) for (let j = 0; j <= dv; j++) t.push((u, v) => u ** i * v ** j); return t; };

/** One opening's frame: point for (u, v, depth), the outward unit direction there and the sampling ray. */
function frameOf(o) {
  if (o.kind === 'side') return {point: (u, v, d) => [u, v, o.s * d], out: () => [0, 0, o.s], ray: (u, v) => ({origin: [u, v, o.s * 1.0], dir: [0, 0, o.s], base: 1.0})};
  if (o.kind === 'end') return {point: (u, v, d) => [o.e * d, v, u], out: () => [o.e, 0, 0], ray: (u, v) => ({origin: [o.e * 6.9, v, u], dir: [o.e, 0, 0], base: 6.9})};
  const dirOf = u => [o.e * Math.cos(u), 0, o.s * Math.sin(u)];
  return {point: (u, v, d) => { const q = dirOf(u); return [o.cx + q[0] * d, v, q[2] * d]; }, out: u => dirOf(u), ray: (u, v) => ({origin: [o.cx, v, 0], dir: dirOf(u), base: 0})};
}

/** The outline (in (u, v)) of the union of axis-aligned rects (one rect, or a wrap's two overlapping in u). */
function unionOutline(rects) {
  if (rects.length === 1) { const r = rects[0]; return [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]]; }
  const [a, b] = [...rects].sort((p, q) => p.u0 - q.u0); // a starts first in u, b ends last (they overlap)
  const bot = a.v0 <= b.v0 ? [[a.u0, a.v0], [a.u1, a.v0], [a.u1, b.v0], [b.u1, b.v0]] : [[a.u0, a.v0], [b.u0, a.v0], [b.u0, b.v0], [b.u1, b.v0]];
  const top = a.v1 >= b.v1 ? [[b.u1, b.v1], [a.u1, b.v1], [a.u1, a.v1], [a.u0, a.v1]] : [[b.u1, b.v1], [b.u0, b.v1], [b.u0, a.v1], [a.u0, a.v1]];
  const pts = [...bot, ...top];
  return pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9; });
}
const inRects = (rects, u, v, iu = 0, iv = 0) => rects.some(r => u > r.u0 + iu && u < r.u1 - iu && v > r.v0 + iv && v < r.v1 - iv);

/**
 * Builds the conformal glass sheet + reveal of one opening.
 * o = {node, kind, e?, s?, cx?, rects: [{u0, u1, v0, v1}] (the hole = their union; u in radians for a wrap), uScale (m per u unit),
 *      lining (depth of the lining plane in the frame), liningRect(P) -> inner reveal point, slot? {u0, u1, d0, d1}}.
 * shell = the final shell triangles (what remains), preCut = the shell before the window cuts (the original panes).
 */
export function buildOpening(shell, preCut, o, opt) {
  const F = frameOf(o);
  const U0 = Math.min(...o.rects.map(r => r.u0)), U1 = Math.max(...o.rects.map(r => r.u1)), V0 = Math.min(...o.rects.map(r => r.v0)), V1 = Math.max(...o.rects.map(r => r.v1));
  const corners = [];
  for (const u of [U0, (U0 + U1) / 2, U1]) for (const v of [V0, V1]) for (const d of [o.lining - 0.1, o.lining + 0.7]) corners.push(F.point(u, v, d));
  const lo = [0, 1, 2].map(k => Math.min(...corners.map(c => c[k])) - 0.3), hi = [0, 1, 2].map(k => Math.max(...corners.map(c => c[k])) + 0.3);
  const near = tris => tris.filter(t => [0, 1, 2].every(k => Math.max(t[0][k], t[1][k], t[2][k]) >= lo[k] && Math.min(t[0][k], t[1][k], t[2][k]) <= hi[k]));
  const shellC = near(shell), preC = near(preCut);
  const depthOn = (cands, u, v) => { const r = F.ray(u, v), t = farthestHit(cands, r.origin, r.dir); return Number.isFinite(t) ? r.base + t : NaN; };
  // the original pane: interior samples of the pre-cut surface (inset from the gasket)
  const stepU = opt.sampleStep / o.uScale, stepV = opt.sampleStep, iu = opt.inset / o.uScale, iv = opt.inset;
  const uc = (U0 + U1) / 2, vc = (V0 + V1) / 2, uh = (U1 - U0) / 2, vh = (V1 - V0) / 2;
  const samples = [];
  for (let u = U0 + stepU / 2; u < U1; u += stepU) for (let v = V0 + stepV / 2; v < V1; v += stepV) {
    if (!inRects(o.rects, u, v, iu, iv)) continue;
    const d = depthOn(preC, u, v);
    if (Number.isFinite(d)) samples.push({u: (u - uc) / uh, v: (v - vc) / vh, d, U: u, V: v});
  }
  if (samples.length < 30) throw new Error(`window ${o.node}: only ${samples.length} pane samples`);
  const terms = o.kind === 'wrap' ? polyTerms(3, 2) : polyTerms(2, 2);
  let c = lsq(samples, terms), kept = samples;
  const evalN = (un, vn) => terms.reduce((s, t, k) => s + c[k] * t(un, vn), 0);
  // robust fit: iteratively drop samples off the fit by > max(envelope, 2.5 x MAD) on EITHER side (a skin layer standing proud over the
  // pane, a dent or a gasket lip below it), keeping >= 50 %
  for (let pass = 0; pass < 6; pass++) {
    const r = kept.map(s => ({s, r: Math.abs(s.d - evalN(s.u, s.v))}));
    const sorted = r.map(q => q.r).sort((a, b) => a - b), lim = Math.max(opt.envelope, 2.5 * sorted[Math.floor(sorted.length / 2)]);
    let next = r.filter(q => q.r <= lim).map(q => q.s);
    if (next.length < 0.5 * samples.length) next = r.sort((a, b) => a.r - b.r).slice(0, Math.ceil(0.5 * samples.length)).map(q => q.s);
    if (next.length === kept.length) break;
    kept = next; c = lsq(kept, terms);
  }
  const fitAt = (u, v) => evalN((u - uc) / uh, (v - vc) / vh);
  const fitError = Math.max(...kept.map(s => Math.abs(fitAt(s.U, s.V) - s.d)));
  // the sheet grid over the hole's bounding rect + overlap; one uniform recess behind the pane and behind everything that remains
  const ou = opt.overlap / o.uScale, ov = opt.overlap;
  const su0 = U0 - ou, su1 = U1 + ou, sv0 = V0 - ov, sv1 = V1 + ov;
  const nu = Math.max(2, Math.ceil((su1 - su0) * o.uScale / opt.gridU)) + 1, nv = Math.max(2, Math.ceil((sv1 - sv0) / opt.gridV)) + 1;
  const uv = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) uv.push([su0 + (su1 - su0) * i / (nu - 1), sv0 + (sv1 - sv0) * j / (nv - 1)]);
  // the sheet covers the hole (the union of its rects) + the overlap band only (a wrap's L-shaped union: not its bounding rect)
  const covered = uv.map(([u, v]) => inRects(o.rects, u, v, -ou - 1e-9, -ov - 1e-9));
  // the INNERMOST remaining surface beyond the lining plane along each grid ray (a gasket back / doubled layer counts too)
  const innerOn = (u, v) => { const r = F.ray(u, v), t = nearestHit(shellC, r.origin, r.dir, o.lining - r.base); return Number.isFinite(t) ? r.base + t : NaN; };
  const skinUnder = uv.map(([u, v], k) => (covered[k] ? innerOn(u, v) : NaN));
  // the visible glass (in the hole) sits `recess` behind the fitted pane; a rim vertex (overlap band) tucks individually behind whatever
  // remains over it (gasket, frame) by >= clearance, so the sheet never pokes through and the rim stays right behind the gasket
  const recess = opt.recess;
  const depthAtK = ([u, v], k) => Math.min(fitAt(u, v) - recess, Number.isFinite(skinUnder[k]) ? skinUnder[k] - opt.clearance : Infinity);
  const depths = uv.map(depthAtK);
  const tuck = Math.max(0, ...uv.map(([u, v], k) => fitAt(u, v) - recess - depths[k]));
  const P = uv.map(([u, v], k) => F.point(u, v, depths[k]));
  const N = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = P[j * nu + Math.min(nu - 1, i + 1)], b = P[j * nu + Math.max(0, i - 1)], cc = P[Math.min(nv - 1, j + 1) * nu + i], dd = P[Math.max(0, j - 1) * nu + i];
    let n = norm(cross(sub(a, b), sub(cc, dd)));
    if (dot(n, F.out(uv[j * nu + i][0])) < 0) n = n.map(x => -x);
    N.push(n);
  }
  const I = [];
  for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) {
    const a = j * nu + i, b = a + 1, cI = a + nu + 1, d = a + nu;
    if (!(covered[a] || covered[b] || covered[cI] || covered[d])) continue; // a cell touching the covered region (keeps the band continuous)
    if (dot(cross(sub(P[b], P[a]), sub(P[cI], P[a])), N[a]) >= 0) I.push(a, b, cI, a, cI, d); else I.push(a, cI, b, a, d, cI);
  }
  let poke = 0;
  uv.forEach((_, k) => { if (Number.isFinite(skinUnder[k]) && skinUnder[k] < depths[k] + opt.clearance / 2) poke++; });
  const usedV = new Set(I);
  const boxes = slabs(P, nu, nv, opt.boxThick, opt.maxBoxes, usedV);
  // compact: only the vertices the covered cells use
  const remap = new Map(), CP = [], CN = [];
  for (let k = 0; k < P.length; k++) if (usedV.has(k)) { remap.set(k, CP.length); CP.push(P[k]); CN.push(N[k]); }
  const sheet = {P: CP, N: CN, I: I.map(k => remap.get(k)), nu, nv, recess, tuck, fitError, samples: samples.length, kept: kept.length, poke, bounds: boundsOf(CP), boxes};
  sheet.boxThick = Math.max(...sheet.boxes.map(b => Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])));
  // the reveal: the hole's own outline, its outer edge on the REMAINING skin's cut edge (sampled edgeProbe outside the hole; the pane fit
  // where nothing remains), to the lining rect
  const outline = unionOutline(o.rects);
  const loop = [];
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k], b = outline[(k + 1) % outline.length], len = Math.hypot((b[0] - a[0]) * o.uScale, b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / opt.revealStep));
    for (let i = 0; i < n; i++) loop.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  const outer = loop.map(([u, v]) => {
    // step edgeProbe outward, perpendicular to the outline edge the point lies on (outside the union in (u, v))
    let pu = u, pv = v;
    const e = opt.edgeProbe;
    if (!inRects(o.rects, u + e / o.uScale, v, -1e-9, -1e-9)) pu = u + e / o.uScale; else if (!inRects(o.rects, u - e / o.uScale, v, -1e-9, -1e-9)) pu = u - e / o.uScale;
    if (!inRects(o.rects, pu, v + e, -1e-9, -1e-9)) pv = v + e; else if (!inRects(o.rects, pu, v - e, -1e-9, -1e-9)) pv = v - e;
    const d0 = depthOn(shellC, pu, pv), d = Number.isFinite(d0) ? d0 : fitAt(u, v);
    return {u, v, d, P: F.point(u, v, d)};
  });
  const inner = outer.map(q => o.liningRect(q.P));
  const centre = F.point(uc, vc, (fitAt(uc, vc) + o.lining) / 2);
  const R = {P: [], N: [], I: []};
  const quad = (a, b, cq, d) => {
    let n = norm(cross(sub(b, a), sub(d, a)));
    const m = [0, 1, 2].map(k => (a[k] + b[k] + cq[k] + d[k]) / 4);
    let q4 = [a, b, cq, d];
    if (dot(n, sub(centre, m)) < 0) { n = n.map(x => -x); q4 = [a, d, cq, b]; }
    const base = R.P.length;
    for (const p of q4) { R.P.push(p); R.N.push(n); }
    R.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const along = (q, inn, D) => { const t = (q.d - D) / (q.d - o.lining); return [0, 1, 2].map(k => q.P[k] + (inn[k] - q.P[k]) * clamp(t, 0, 1)); };
  for (let k = 0; k < outer.length; k++) {
    const k2 = (k + 1) % outer.length, a = outer[k], b = outer[k2], ai = inner[k], bi = inner[k2];
    const um = (a.u + b.u) / 2;
    if (o.slot && um > o.slot.u0 && um < o.slot.u1) {
      quad(a.P, b.P, along(b, bi, o.slot.d1), along(a, ai, o.slot.d1));
      quad(along(a, ai, o.slot.d0), along(b, bi, o.slot.d0), bi, ai);
    } else quad(a.P, b.P, bi, ai);
  }
  return {sheet, reveal: R, outline};
}

const boundsOf = P => ({min: [0, 1, 2].map(k => Math.min(...P.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...P.map(p => p[k])))});

/** Axis-aligned slabs covering a grid sheet: split the (i, j) range until each is thin enough or maxBoxes. */
function slabs(P, nu, nv, thick, maxBoxes, used) {
  const boxOf = (i0, i1, j0, j1) => { const pts = []; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (used.has(j * nu + i)) pts.push(P[j * nu + i]); return pts.length ? boundsOf(pts) : null; };
  const th = b => (b ? Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 0);
  const parts = [[0, nu - 1, 0, nv - 1]];
  while (parts.length < maxBoxes) {
    let worst = -1, wt = thick;
    parts.forEach((p, k) => { const t = th(boxOf(...p)); if (t > wt && (p[1] - p[0] > 1 || p[3] - p[2] > 1)) { wt = t; worst = k; } });
    if (worst < 0) break;
    const [i0, i1, j0, j1] = parts[worst];
    const im = Math.floor((i0 + i1) / 2), jm = Math.floor((j0 + j1) / 2);
    const byI = i1 - i0 > 1 ? Math.max(th(boxOf(i0, im, j0, j1)), th(boxOf(im, i1, j0, j1))) : Infinity;
    const byJ = j1 - j0 > 1 ? Math.max(th(boxOf(i0, i1, j0, jm)), th(boxOf(i0, i1, jm, j1))) : Infinity;
    parts.splice(worst, 1, ...(byI <= byJ ? [[i0, im, j0, j1], [im, i1, j0, j1]] : [[i0, i1, j0, jm], [i0, i1, jm, j1]]));
  }
  return parts.map(p => boxOf(...p)).filter(Boolean);
}

/** The farthest skin hit along a ray (for the build: wrap edge angles). */
export function skinHit(tris, origin, dir) { return farthestHit(tris, origin, norm(dir)); }
