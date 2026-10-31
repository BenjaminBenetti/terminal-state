// Task siren-clothing-refit-20261031 (lane FIT): user-authorised GARMENT-ONLY refit of the supplied GhostDress to the UNCHANGED
// Siren body (bind pose, game metres). The body is only read; the dress's vertex count, indices, UVs, material and textures are
// kept (no retopology), its POSITION / NORMAL are re-derived here, its skin weights come from lib/garment-skin.mjs.
//
// Why (lane FIT diagnosis): Track1's uniform x1.2853 kept the dress's mannequin proportions, so its cup / empire seam sat ~15 cm
// below the bust, the strap looped over the deltoid and the torso part was a rigid oversized tube offset to the wearer's right.
// The dress's own design already matches the coverage target (strap + cup on ITS -X side = the wearer's RIGHT when both face +Z),
// so NO rotation / mirror is applied. Method (deterministic, documented constants, all measured on the source / body):
//  1. Source frame -> cylinder coordinates about the dress's own axis (native x = z = 0): angle th (0 = front +Z, -90 deg = -X =
//     wearer's right), native height yn, radius r (metres at Track1's 1.2853, so the skirt keeps the length the user saw).
//  2. Vertical landmark map yn -> y: the empire (under-bust) seam yn 0.175 -> the body's under-bust line; above it the bodice is
//     scaled so the cup peak at the strap base (yn 0.335) lands on the top of the breast; below it the skirt keeps x1.2853.
//  3. Radius: the body's own torso radius about ITS axis at (th, y) — outermost skin hit of an inward ray, arms / hair excluded —
//     closed by a smoothing filter (cloth bridges the cleavage / under-bust / waist hollows instead of following them), plus a
//     per-region cloth offset (cup 6 mm, band 4 mm, waist / hip 8 mm); the dress's own relief (piping cords, folds, frayed edges)
//     is kept as its radius minus its own smoothed radius. Below the hip line the skirt hangs: the body's hip radius + the dress's
//     own A-line flare / folds, never closer than a clearance to the legs.
//  4. Strap: re-routed over the right shoulder as a path on the skin in the plane of its two (re-placed) bases (front: top of the
//     right breast / upper chest; back: upper back), offset by a strap clearance; its own cross-section (width / thickness)
//     is carried along the path; blended into the bodice mapping at the bases.
//  5. Collision pass: any vertex closer than its region's minimum clearance (or inside the skin) is pushed out along the skin
//     normal, the push diffused to its neighbours (no kinks); repeated.
//  6. Normals: each source normal is rotated by the rotation that takes the source geometric (welded) normal to the new one, so
//     authored shading is kept; the 102 zero-length source normals stay zero (carried as supplied).
import {TriGrid, weldMap, weldedNormals, closestOnTri, insideByParity} from '../../zombie/lib/penetration.mjs';
import {components} from '../../zombie/lib/mesh.mjs';

const DEG = Math.PI / 180;
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const r4 = v => +(+v).toFixed(4);

/** Refit parameters (documented constants; measured landmarks noted). */
export const REFIT = {
  trackScale: 1.2853,          // Track1's uniform dress scale (skirt length the user saw is kept below the seam)
  seamN: 0.175,                // source empire seam height (main-component top boundary 0.163-0.205; piping centre ~0.175)
  peakN: 0.335,                // source cup peak / strap base height (strap bases at 0.344-0.348)
  strapN: 0.345,               // source strap = main-component vertices above this (and x < -0.05)
  strapBlend: [0.335, 0.37],   // blend from the bodice map to the strap path
  underBustY: 1.155,           // body: inframammary fold 1.16-1.17 laterally, rib cage below -> the seam sits on the rib cage
  breastTopY: 1.335,           // body: top of the breast mound (front profile turns at 1.32-1.34)
  hipY: 0.86,                  // body: widest hip (x +-0.17 at 0.84-0.86); below it the skirt hangs
  offsets: [[1.17, 0.006], [1.13, 0.004], [1.02, 0.008], [0.86, 0.008]], // [y from which (downwards), cloth offset m]
  smallSigma: {th: 1, y: 2},   // closing filter in the bodice (bins: 2.5 deg, 5 mm)
  largeSigma: {th: 2, y: 7},   // closing filter at the waist / hip (cloth bridges the waist hollow)
  legClear: 0.022,             // skirt clearance from the legs' outer surface (bind)
  flareScale: 0.85,            // fraction of the dress's own A-line flare kept below the hip line
  strapClear: 0.003,           // strap centre-line offset from the skin (plus its own thickness)
  // angular warp of the UPPER bodice only (0 at the seam, full at the cup peak / strap base): the source's strap base sits at
  // th -65 deg about its narrow mannequin axis, which lands on the front of the shoulder joint of this broader body; +warp moves
  // the peak / front strap base medially onto the upper chest above the breast (strap mid-shoulder) and draws the cup's
  // medial half over the breast; the side seam (th <= -100 deg), the cup's medial edge (th >= +10 deg) and the back are unchanged
  cupWarp: {deg: 18, side: -100, peak: -65, medial: 10},
  minClear: {strap: 0.0015, cup: 0.004, band: 0.003, waist: 0.004, hip: 0.004, skirt: 0.008},
  pushRounds: 5,
};

// ------------------------------------------------------------------------------------------------------------- body field
const TH = 144, TH_STEP = 2 * Math.PI / TH;      // 2.5 deg bins, centre of bin k at -pi + (k + 0.5) * step
const Y0 = 0.50, Y1 = 1.48, YS = 0.005, NY = Math.round((Y1 - Y0) / YS) + 1;
const thBin = th => { let k = (th + Math.PI) / TH_STEP - 0.5; return k; };

function gaussSmooth(G, sTh, sY) {
  const out = new Float64Array(G.length), kTh = [], kY = [];
  for (let d = -3 * sTh; d <= 3 * sTh; d++) kTh.push([d, Math.exp(-0.5 * (d / sTh) ** 2)]);
  for (let d = -3 * sY; d <= 3 * sY; d++) kY.push([d, Math.exp(-0.5 * (d / sY) ** 2)]);
  const tmp = new Float64Array(G.length);
  for (let j = 0; j < NY; j++) for (let k = 0; k < TH; k++) { let s = 0, w = 0; for (const [d, g] of kTh) { s += g * G[j * TH + ((k + d) % TH + TH) % TH]; w += g; } tmp[j * TH + k] = s / w; }
  for (let j = 0; j < NY; j++) for (let k = 0; k < TH; k++) { let s = 0, w = 0; for (const [d, g] of kY) { const jj = j + d; if (jj < 0 || jj >= NY) continue; s += g * tmp[jj * TH + k]; w += g; } out[j * TH + k] = s / w; }
  return out;
}
function fillHoles(G) { // NaN cells: average of defined neighbours, repeated (periodic in th)
  for (let it = 0; it < 200; it++) {
    let left = 0; const src = G.slice();
    for (let j = 0; j < NY; j++) for (let k = 0; k < TH; k++) {
      if (!Number.isNaN(src[j * TH + k])) continue;
      let s = 0, n = 0;
      for (const [dj, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const jj = j + dj; if (jj < 0 || jj >= NY) continue; const v = src[jj * TH + ((k + dk) % TH + TH) % TH]; if (!Number.isNaN(v)) { s += v; n++; } }
      if (n) G[j * TH + k] = s / n; else left++;
    }
    if (!left) break;
  }
  return G;
}
function sampleGrid(G, th, y) {
  const fk = thBin(th), fj = (Math.min(Y1, Math.max(Y0, y)) - Y0) / YS;
  const k0 = Math.floor(fk), j0 = Math.min(NY - 2, Math.floor(fj)), u = fk - k0, v = fj - j0;
  const a = ((k0 % TH) + TH) % TH, b = (a + 1) % TH;
  return (G[j0 * TH + a] * (1 - u) + G[j0 * TH + b] * u) * (1 - v) + (G[(j0 + 1) * TH + a] * (1 - u) + G[(j0 + 1) * TH + b] * u) * v;
}

/**
 * Body field from the BIND body (game metres): skin-only triangles (hair strands excluded by garment-metrics skinMask), the torso
 * subset without arm-dominated triangles; the torso axis cz(y); the outer torso radius R(th, y) (NaN where an inward ray from
 * 0.5 m finds no torso — between the legs); its closed (cloth-bridged) versions.
 * body: {pos, idx, skin (per vertex 0/1), groups (per vertex 0 torso, 1 head, 2 arm, 3 leg)}
 */
export function bodyField(body) {
  const {pos: P, idx, skin, groups} = body;
  const skinIdx = [], torsoIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!(skin[a] && skin[b] && skin[c])) continue;
    skinIdx.push(a, b, c);
    // torso outline: no head, no arm triangles LATERAL of the shoulder joints (the T-pose arms); the arm-weighted shoulder cap /
    // armpit front fold medial of the joint is part of the torso outline at strap / underarm height
    const lat = Math.abs(P[a * 3] + P[b * 3] + P[c * 3]) / 3 > (body.shoulderX ?? 0.144);
    if (groups[a] !== 1 && groups[b] !== 1 && groups[c] !== 1 && !((groups[a] === 2 || groups[b] === 2 || groups[c] === 2) && lat)) torsoIdx.push(a, b, c);
  }
  const sIdx = Uint32Array.from(skinIdx), tIdx = Uint32Array.from(torsoIdx);
  const {remap} = weldMap(P);
  const N = weldedNormals(P, sIdx, remap);
  const skinGrid = new TriGrid(P, sIdx, 0.03), torsoGrid = new TriGrid(P, tIdx, 0.03);
  // axis cz(y): mid of the front / back skin within |x| < 0.05 (torso / leg vertices); held below the crotch; smoothed +-5 cm
  const cz = new Float64Array(NY).fill(NaN);
  for (let j = 0; j < NY; j++) {
    const y = Y0 + j * YS; let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < P.length / 3; i++) { if (!skin[i] || groups[i] === 2 || Math.abs(P[i * 3 + 1] - y) > 0.006 || Math.abs(P[i * 3]) > 0.05) continue; zMin = Math.min(zMin, P[i * 3 + 2]); zMax = Math.max(zMax, P[i * 3 + 2]); }
    if (zMax - zMin > 0.08) cz[j] = (zMin + zMax) / 2;
  }
  let firstDef = cz.findIndex(v => !Number.isNaN(v));
  for (let j = 0; j < NY; j++) if (Number.isNaN(cz[j])) { let jj = j; while (jj < NY && Number.isNaN(cz[jj])) jj++; cz[j] = jj < NY ? cz[jj] : cz[j - 1]; }
  void firstDef;
  const czS = new Float64Array(NY);
  for (let j = 0; j < NY; j++) { let s = 0, w = 0; for (let d = -10; d <= 10; d++) { const jj = j + d; if (jj < 0 || jj >= NY) continue; const g = Math.exp(-0.5 * (d / 5) ** 2); s += g * cz[jj]; w += g; } czS[j] = s / w; }
  const axisZ = y => { const f = (Math.min(Y1, Math.max(Y0, y)) - Y0) / YS, j = Math.min(NY - 2, Math.floor(f)); return lerp(czS[j], czS[j + 1], f - j); };
  // outer torso radius
  const R = new Float64Array(NY * TH).fill(NaN);
  for (let j = 0; j < NY; j++) {
    const y = Y0 + j * YS, z0 = axisZ(y);
    for (let k = 0; k < TH; k++) {
      const th = -Math.PI + (k + 0.5) * TH_STEP, dx = Math.sin(th), dz = Math.cos(th);
      const h = torsoGrid.ray(dx * 0.5, y, z0 + dz * 0.5, -dx, 0, -dz, 0.5);
      if (h) R[j * TH + k] = 0.5 - h.t;
    }
  }
  const Rraw = R.slice();
  fillHoles(R);
  const small = gaussSmooth(R, REFIT.smallSigma.th, REFIT.smallSigma.y), large = gaussSmooth(R, REFIT.largeSigma.th, REFIT.largeSigma.y);
  const closedS = R.map((v, i) => Math.max(v, small[i])), closedL = R.map((v, i) => Math.max(v, large[i]));
  return {P, N, remap, skinIdx: sIdx, torsoIdx: tIdx, skinGrid, torsoGrid, axisZ, Rraw, R, closedS, closedL,
    radius: (th, y) => sampleGrid(R, th, y), rawRadius: (th, y) => sampleGrid(Rraw, th, y),
    cloth: (th, y) => { const t = ss(1.10, 1.16, y); return lerp(sampleGrid(closedL, th, y), sampleGrid(closedS, th, y), t); }};
}

/** Signed distance of p to the skin (sign: interpolated normal, negative confirmed by parity) + the closest point / normal. */
export function skinDistance(F, p, maxR = 0.06) {
  const c = F.skinGrid.closest(p[0], p[1], p[2], maxR);
  if (!c) return null;
  const I = F.skinIdx, a = I[c.tri * 3], b = I[c.tri * 3 + 1], e = I[c.tri * 3 + 2], q = c.q, N = F.N;
  let n = [0, 1, 2].map(k => q[3] * N[a * 3 + k] + q[4] * N[b * 3 + k] + q[5] * N[e * 3 + k]);
  const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
  let sd = (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2] < 0 ? -c.d : c.d;
  if (sd < -0.001 && !insideByParity(F.skinGrid, p[0], p[1], p[2])) sd = c.d;
  return {sd, q: [q[0], q[1], q[2]], n, tri: c.tri, bary: [q[3], q[4], q[5]]};
}

// ------------------------------------------------------------------------------------------------------------- dress field
/** Smoothed own radius of the dress D(th, yn) (metres at trackScale) from its main surface (no strap / fringe bits). */
function dressField(nat, use) {
  const NTH = 72, NYN = 100, yn0 = -0.48, yn1 = 0.52, ys = (yn1 - yn0) / NYN;
  const S = new Float64Array(NTH * NYN), Wt = new Float64Array(NTH * NYN);
  for (let i = 0; i < nat.length / 3; i++) {
    if (!use[i]) continue;
    const x = nat[i * 3], y = nat[i * 3 + 1], z = nat[i * 3 + 2];
    const th = Math.atan2(x, z), r = Math.hypot(x, z) * REFIT.trackScale;
    const fk = (th + Math.PI) / (2 * Math.PI) * NTH - 0.5, fj = (y - yn0) / ys - 0.5;
    for (let dk = -2; dk <= 2; dk++) for (let dj = -2; dj <= 2; dj++) {
      const k = Math.round(fk) + dk, j = Math.round(fj) + dj; if (j < 0 || j >= NYN) continue;
      const g = Math.exp(-0.5 * (((fk - k) / 1.0) ** 2 + ((fj - j) / 1.2) ** 2));
      const kk = ((k % NTH) + NTH) % NTH; S[j * NTH + kk] += g * r; Wt[j * NTH + kk] += g;
    }
  }
  const G = new Float64Array(NTH * NYN);
  for (let i = 0; i < G.length; i++) G[i] = Wt[i] > 0.05 ? S[i] / Wt[i] : NaN;
  for (let it = 0; it < 300; it++) { let left = 0; const src = G.slice(); for (let j = 0; j < NYN; j++) for (let k = 0; k < NTH; k++) { if (!Number.isNaN(src[j * NTH + k])) continue; let s = 0, n = 0; for (const [dj, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const jj = j + dj; if (jj < 0 || jj >= NYN) continue; const v = src[jj * NTH + ((k + dk) % NTH + NTH) % NTH]; if (!Number.isNaN(v)) { s += v; n++; } } if (n) G[j * NTH + k] = s / n; else left++; } if (!left) break; }
  return (th, yn) => {
    const fk = (th + Math.PI) / (2 * Math.PI) * NTH - 0.5, fj = Math.min(NYN - 1.001, Math.max(0, (yn - yn0) / ys - 0.5));
    const k0 = Math.floor(fk), j0 = Math.floor(fj), u = fk - k0, v = fj - j0, a = ((k0 % NTH) + NTH) % NTH, b = (a + 1) % NTH;
    return (G[j0 * NTH + a] * (1 - u) + G[j0 * NTH + b] * u) * (1 - v) + (G[(j0 + 1) * NTH + a] * (1 - u) + G[(j0 + 1) * NTH + b] * u) * v;
  };
}

/** Vertical landmark map: source height yn -> body height y (smooth knee at the seam). */
export function verticalMap(yn) {
  const kTop = (REFIT.breastTopY - REFIT.underBustY) / (REFIT.peakN - REFIT.seamN), kSk = REFIT.trackScale, d = yn - REFIT.seamN;
  // slope kSk below / kTop above the seam, ramped linearly over +-h (C1); y(seam) = underBustY exactly
  const h = 0.01, dk = kTop - kSk;
  if (d >= h) return REFIT.underBustY + kSk * h + dk * 0.75 * h + kTop * (d - h);
  if (d <= -h) return REFIT.underBustY - kSk * h - dk * 0.25 * h + kSk * (d + h);
  return REFIT.underBustY + kSk * d + dk / (2 * h) * ((d + h) ** 2 / 2 - h * h / 2);
}

/** Angle warp (radians) of the upper bodice / strap base: see REFIT.cupWarp. */
export function cupWarp(th, yn) {
  const W = REFIT.cupWarp, d = th / DEG;
  const g = d <= W.peak ? ss(W.side, W.peak, d) : 1 - ss(W.peak, W.medial, d);
  return W.deg * DEG * g * ss(REFIT.seamN, REFIT.peakN, yn);
}

const offsetAt = y => { const o = REFIT.offsets; if (y >= o[0][0]) return o[0][1]; for (let i = 1; i < o.length; i++) if (y >= o[i][0]) { const t = ss(o[i][0], o[i - 1][0], y); return lerp(o[i][1], o[i - 1][1], t); } return o[o.length - 1][1]; };

// ------------------------------------------------------------------------------------------------------------- strap path
/** Skin path over the shoulder in the vertical plane through the two base points (front F, back B), offset outward. */
function strapPath(F, front, back, clear) {
  const mid = [(front[0] + back[0]) / 2, (front[1] + back[1]) / 2, (front[2] + back[2]) / 2];
  const hz = [back[0] - front[0], 0, back[2] - front[2]]; const hl = Math.hypot(hz[0], hz[2]); const u = [hz[0] / hl, 0, hz[2] / hl]; // front -> back, horizontal
  const v = [0, 1, 0], nPlane = [u[2], 0, -u[0]];
  const to2 = p => [(p[0] - mid[0]) * u[0] + (p[2] - mid[2]) * u[2], p[1] - mid[1]];
  // in-plane angle about the mid point: 0 = toward the back base, 90 deg = up, 180 deg = toward the front base; the strap goes
  // from the front base (~180 deg) OVER THE TOP (90 deg) to the back base (~0 deg)
  let aF = Math.atan2(to2(front)[1], to2(front)[0]); if (aF < 0) aF += 2 * Math.PI;
  const aB = Math.atan2(to2(back)[1], to2(back)[0]);
  const pts = [], nrm = [];
  for (let s = 0; s <= 96; s++) {
    const a = lerp(aF, aB, s / 96), d = [Math.cos(a) * u[0], Math.sin(a), Math.cos(a) * u[2]];
    const o = [mid[0] + d[0] * 0.3, mid[1] + d[1] * 0.3, mid[2] + d[2] * 0.3];
    const h = F.skinGrid.ray(o[0], o[1], o[2], -d[0], -d[1], -d[2], 0.3);
    if (!h) continue;
    const q = [o[0] - d[0] * h.t, o[1] - d[1] * h.t, o[2] - d[2] * h.t];
    // outward = the in-plane ray direction (the strap lies in its plane, like a strap pulled taut over the shoulder)
    pts.push(q.map((c, k) => c + d[k] * clear)); nrm.push(d);
  }
  // fix the ends to the given base points; arc length
  pts[0] = front.slice(); pts[pts.length - 1] = back.slice();
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const at = t => { const s = t * L[L.length - 1]; let i = 1; while (i < L.length - 1 && L[i] < s) i++; const f = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1); const p = pts[i - 1].map((c, k) => lerp(c, pts[i][k], f)); const n = nrm[i - 1].map((c, k) => lerp(c, nrm[i][k], f)); const l = Math.hypot(...n); return {p, n: n.map(x => x / l)}; };
  return {at, length: L[L.length - 1], plane: {u, v, n: nPlane, mid}, points: pts.length};
}

// ------------------------------------------------------------------------------------------------------------- refit
/**
 * @param src {pos (native POSITION), nrm (native NORMAL), idx} of the supplied GhostDress
 * @param body {pos (bind), idx, skin, groups}
 * @returns {pos, nrm (Float32Array, native vertex order), report}
 */
export function refitDress(src, body, log = () => {}) {
  const F = bodyField(body);
  const nat = src.pos, n = nat.length / 3, idx = src.idx;
  const {remap, uniq} = weldMap(nat);
  // welded topology for adjacency / normals
  const comp = components(n, Uint32Array.from(idx, i => remap[i]));
  let mainLabel = -1, best = 0; for (const [l, c] of comp.sizes) if (c > best) { best = c; mainLabel = l; }
  const isMain = i => comp.label[remap[i]] === mainLabel;
  const isStrap = i => isMain(i) && nat[i * 3 + 1] > REFIT.strapBlend[0] && nat[i * 3] < -0.05;
  // dress own radius field from the main surface + cup panel (no strap, no tiny fringe bits)
  const use = new Uint8Array(n); for (let i = 0; i < n; i++) use[i] = !isStrap(i) && comp.sizes.get(comp.label[remap[i]]) > 200 ? 1 : 0;
  const D = dressField(nat, use);
  const ynHip = REFIT.seamN + (REFIT.hipY - REFIT.underBustY) / REFIT.trackScale;
  const out = new Float32Array(n * 3);
  const region = new Uint8Array(n); // 0 strap 1 cup 2 band 3 waist 4 hip 5 skirt (by target height)
  const bodiceMap = i => {
    const x = nat[i * 3], yn = nat[i * 3 + 1], z = nat[i * 3 + 2];
    const th0 = Math.atan2(x, z), th = th0 + cupWarp(th0, yn), r = Math.hypot(x, z) * REFIT.trackScale, y = verticalMap(yn);
    const relief = r - D(th0, yn);
    let Rt;
    if (y >= REFIT.hipY) Rt = F.cloth(th, y) + offsetAt(y);
    else {
      Rt = F.cloth(th, REFIT.hipY) + offsetAt(REFIT.hipY) + REFIT.flareScale * (D(th0, yn) - D(th0, ynHip));
      const leg = F.rawRadius(th, y);
      if (Number.isFinite(leg)) Rt = Math.max(Rt, leg + REFIT.legClear - relief);
    }
    const rr = Rt + relief;
    return [rr * Math.sin(th), y, F.axisZ(y) + rr * Math.cos(th)];
  };
  // strap native centre-line (in the source's strap plane): angle about the arc centre between its two bases
  const sIds = []; for (const i of uniq) if (isStrap(i)) sIds.push(i);
  const baseOf = sgn => { const f = sIds.filter(i => nat[i * 3 + 1] < 0.36 && nat[i * 3 + 1] > 0.33 && Math.sign(nat[i * 3 + 2] + 0.025) === sgn); const med = k => f.map(i => nat[i * 3 + k]).sort((a, b) => a - b)[f.length >> 1]; return [med(0), med(1), med(2)]; };
  const bF = baseOf(1), bB = baseOf(-1);
  const cY = (bF[1] + bB[1]) / 2, cZ = (bF[2] + bB[2]) / 2;
  const phi = i => Math.atan2(nat[i * 3 + 1] - cY, nat[i * 3 + 2] - cZ); // front base ~0, apex ~+90 deg, back ~180 deg
  let phiF = Math.atan2(bF[1] - cY, bF[2] - cZ), phiB = Math.atan2(bB[1] - cY, bB[2] - cZ); if (phiB < phiF) phiB += 2 * Math.PI;
  const unwrapPhi = a => (a < phiF - Math.PI / 2 ? a + 2 * Math.PI : a);
  const NB = 48, cR = new Float64Array(NB), cX = new Float64Array(NB), cnt = new Float64Array(NB);
  const binOf = a => Math.min(NB - 1, Math.max(0, Math.floor((unwrapPhi(a) - phiF) / (phiB - phiF) * NB)));
  for (const i of sIds) { const b = binOf(phi(i)); cR[b] += Math.hypot(nat[i * 3 + 1] - cY, nat[i * 3 + 2] - cZ); cX[b] += nat[i * 3]; cnt[b]++; }
  for (let b = 0; b < NB; b++) { if (cnt[b]) { cR[b] /= cnt[b]; cX[b] /= cnt[b]; } else { cR[b] = NaN; cX[b] = NaN; } }
  for (let b = 0; b < NB; b++) if (Number.isNaN(cR[b])) { let l = b - 1, r = b + 1; while (l >= 0 && Number.isNaN(cR[l])) l--; while (r < NB && Number.isNaN(cR[r])) r++; const L = l >= 0 ? l : r, Rr = r < NB ? r : l; cR[b] = (cR[L] + cR[Rr]) / 2; cX[b] = (cX[L] + cX[Rr]) / 2; }
  // native arc length of the centre-line (for a proportional map onto the target path)
  const cl = []; for (let b = 0; b < NB; b++) { const a = phiF + (b + 0.5) / NB * (phiB - phiF); cl.push([cX[b], cY + Math.sin(a) * cR[b], cZ + Math.cos(a) * cR[b]]); }
  const cs = [0]; for (let b = 1; b < NB; b++) cs.push(cs[b - 1] + Math.hypot(...[0, 1, 2].map(k => cl[b][k] - cl[b - 1][k])));
  const tOf = a => { const f = Math.min(NB - 1.0001, Math.max(0, (unwrapPhi(a) - phiF) / (phiB - phiF) * NB - 0.5)); const b = Math.floor(f); return lerp(cs[b], cs[Math.min(NB - 1, b + 1)], f - b) / cs[NB - 1]; };
  const centreAt = a => { const f = Math.min(NB - 1.0001, Math.max(0, (unwrapPhi(a) - phiF) / (phiB - phiF) * NB - 0.5)); const b = Math.floor(f), u = f - b; return {r: lerp(cR[b], cR[Math.min(NB - 1, b + 1)], u), x: lerp(cX[b], cX[Math.min(NB - 1, b + 1)], u)}; };
  // target bases = the bodice map of the source bases
  const mapPoint = p => { const th0 = Math.atan2(p[0], p[2]), th = th0 + cupWarp(th0, p[1]), y = verticalMap(p[1]); const rr = F.cloth(th, y) + offsetAt(y); return [rr * Math.sin(th), y, F.axisZ(y) + rr * Math.cos(th)]; };
  const tF = mapPoint(bF), tB = mapPoint(bB);
  const path = strapPath(F, tF, tB, REFIT.strapClear);
  const strapMap = i => {
    const a = phi(i), t = tOf(a), c = centreAt(a);
    const dr = (Math.hypot(nat[i * 3 + 1] - cY, nat[i * 3 + 2] - cZ) - c.r) * REFIT.trackScale, dx = (nat[i * 3] - c.x) * REFIT.trackScale;
    const {p, n: nn} = path.at(Math.min(1, Math.max(0, t)));
    // across the strap: the plane normal (sign so that source -x (lateral) stays lateral = toward -x on the body)
    const pn = path.plane.n, sg = pn[0] > 0 ? 1 : -1;
    return [p[0] + nn[0] * dr + sg * pn[0] * dx, p[1] + nn[1] * dr + sg * pn[1] * dx, p[2] + nn[2] * dr + sg * pn[2] * dx];
  };
  for (const i of uniq) {
    const yn = nat[i * 3 + 1];
    let p = bodiceMap(i);
    if (isStrap(i)) { const w = ss(REFIT.strapBlend[0], REFIT.strapBlend[1], yn); if (w > 0) { const q = strapMap(i); p = p.map((c, k) => lerp(c, q[k], w)); } }
    out.set(p, i * 3);
    region[i] = isStrap(i) && yn > REFIT.strapN ? 0 : p[1] >= 1.17 ? 1 : p[1] >= 1.13 ? 2 : p[1] >= 0.95 ? 3 : p[1] >= REFIT.hipY - 0.06 ? 4 : 5;
  }
  // collision pass on welded vertices
  const wIdx = Uint32Array.from(idx, i => remap[i]);
  const adj = new Map(); for (const i of uniq) adj.set(i, new Set());
  for (let t = 0; t < wIdx.length; t += 3) for (let k = 0; k < 3; k++) { const a = wIdx[t + k], b = wIdx[t + (k + 1) % 3]; if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); } }
  const MIN = [REFIT.minClear.strap, REFIT.minClear.cup, REFIT.minClear.band, REFIT.minClear.waist, REFIT.minClear.hip, REFIT.minClear.skirt];
  const pushLog = [];
  for (let round = 0; round <= REFIT.pushRounds; round++) {
    const push = new Map();
    for (const i of uniq) {
      const p = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
      const s = skinDistance(F, p, 0.05); if (!s) continue;
      const need = MIN[region[i]];
      if (s.sd < need) push.set(i, s.n.map(v => v * (need - s.sd)));
    }
    pushLog.push(push.size);
    if (!push.size || round === REFIT.pushRounds) break;
    // diffuse: pushed vertices move fully, their 1- and 2-ring neighbours by 0.6 / 0.3 of the mean neighbouring push
    const move = new Map(push);
    for (const [fac, ring] of [[0.6, 1], [0.3, 2]]) {
      const add = new Map();
      for (const [i] of (ring === 1 ? push : move)) for (const j of adj.get(i)) { if (move.has(j) || add.has(j)) continue; const nb = [...adj.get(j)].filter(k => move.has(k)); if (!nb.length) continue; const m = [0, 1, 2].map(k => nb.reduce((s, q) => s + move.get(q)[k], 0) / nb.length * fac); add.set(j, m); }
      for (const [j, m] of add) move.set(j, m);
    }
    for (const [i, m] of move) { out[i * 3] += m[0]; out[i * 3 + 1] += m[1]; out[i * 3 + 2] += m[2]; }
  }
  // propagate to UV-seam duplicates
  for (let i = 0; i < n; i++) if (remap[i] !== i) { out[i * 3] = out[remap[i] * 3]; out[i * 3 + 1] = out[remap[i] * 3 + 1]; out[i * 3 + 2] = out[remap[i] * 3 + 2]; region[i] = region[remap[i]]; }
  // normals: rotate the source normals by (old geometric -> new geometric) welded normal
  const srcG = Float32Array.from(nat, v => v * REFIT.trackScale);
  const g0 = weldedNormals(srcG, idx, remap), g1 = weldedNormals(out, idx, remap);
  const nrm = new Float32Array(n * 3);
  let zeroNormals = 0;
  for (let i = 0; i < n; i++) {
    const a = [src.nrm[i * 3], src.nrm[i * 3 + 1], src.nrm[i * 3 + 2]];
    if (Math.hypot(...a) < 1e-6) { zeroNormals++; continue; }
    nrm.set(rotateBetween([g0[i * 3], g0[i * 3 + 1], g0[i * 3 + 2]], [g1[i * 3], g1[i * 3 + 1], g1[i * 3 + 2]], a), i * 3);
  }
  log(`  refit: strap path ${path.points} samples ${path.length.toFixed(3)} m; push rounds ${pushLog.join('/')}`);
  return {pos: out, nrm, region, field: F, report: {method: 'lib/garment-refit.mjs', params: REFIT, strap: {sourceBases: {front: bF.map(r4), back: bB.map(r4)}, targetBases: {front: tF.map(r4), back: tB.map(r4)}, pathLengthM: r4(path.length), sourceLengthM: r4(cs[NB - 1] * REFIT.trackScale)},
    pushRounds: pushLog, zeroLengthSourceNormalsCarried: zeroNormals, weldedVertices: uniq.length, components: comp.sizes.size}};
}

/** Rotates v by the shortest rotation taking unit a to unit b. */
function rotateBetween(a, b, v) {
  const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1; a = a.map(x => x / la); b = b.map(x => x / lb);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) return v.map(x => -x); // degenerate 180 deg flip of a double-sided sheet: keep the orientation flipped
  const k = 1 / (1 + d);
  const vx = v[0], vy = v[1], vz = v[2];
  // Rodrigues via the unnormalised axis c (|c| = sin), formula v' = v d + c x v + c (c.v) k
  const cxv = [c[1] * vz - c[2] * vy, c[2] * vx - c[0] * vz, c[0] * vy - c[1] * vx], cv = c[0] * vx + c[1] * vy + c[2] * vz;
  const o = [vx * d + cxv[0] + c[0] * cv * k, vy * d + cxv[1] + c[1] * cv * k, vz * d + cxv[2] + c[2] * cv * k];
  const l = Math.hypot(...o) || 1; return o.map(x => x / l);
}
