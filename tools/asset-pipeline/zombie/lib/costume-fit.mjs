// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): fits one FULL Meshy garment piece (a cosplay costume's upper: torso +
// two A-pose sleeves; or its lower: waist / skirt + both legs + footwear) to one WRITTEN wardrobe body (lib/lingerie-body.mjs loadBody:
// the runtime zombie-body-<id>-t25.glb, read only). CPU only, deterministic (no randomness, fixed iteration counts).
//
// 1. PARTS (garment frame, +Y up, front +Z, wearer's left +X): an upper piece = torso + sleeve L / R; the torso / sleeve boundary is
//    measured, not assumed: the frontal occupancy (triangles projected on XY) gives per side the ARMPIT (the highest row where a gap
//    separates the torso panel from the hanging sleeve) and the gap midline below it; above it the seam leans out along the sleeve
//    angle. A lower piece = waist (waistband / hips / skirt) + leg L / R (trouser legs below the crotch; or the one-sided legwear
//    components of a skirt: stockings / socks) + shoe L / R (below the measured instep top: where the leg's front-back depth jumps to
//    the foot's). Part weights are smooth (no seam tear).
// 2. MAPPING (landmark retarget, the garment's own shape kept):
//    - torso / waist: ONE horizontal scale per axis from the reference cross-section (upper: the chest just under the armpit; lower:
//      the waistband) to the body's + a cloth ease, the body's own front-back centre per height; vertical: piecewise linear between
//      landmarks (upper: armpit -> armpit, hem -> the configured hem height; lower: waistband top -> the configured waist height,
//      crotch -> crotch (trousers) / instep -> ankle (skirts: design proportions kept));
//    - sleeves: the measured sleeve axis (slice centroids) re-laid along the body's arm chain shoulder -> elbow -> wrist -> hand tip
//      (axial: the cuff ends at the configured arm position; radial: rotated onto the bone and scaled like the torso);
//    - legs: the garment leg axis (hip joint -> ankle) re-laid along hip -> knee -> ankle; trousers scaled like the waist, tight legwear
//      (stockings / socks) conformed per height to the body's leg cross-section + a thin cloth offset;
//    - shoes: heel -> heel, toe -> toe, sole -> floor, width -> the foot's width + margin, turned to the body foot's own yaw (the body's
//      own foot / shoe is hidden inside).
// 3. CLEARANCE as an OFFSET FIELD ON THE INNER SURFACE (the lib/fit07.mjs method): each garment vertex is anchored to the closest
//    inner-surface point of the regions its part may cover (sleeves -> own arm / hand + the shoulder cap; torso -> torso / neck / head
//    (hoods, collars) and the thighs below the crotch; waist -> torso + legs; legs -> own leg + foot; shoes -> own foot + shin); inner
//    surface = the body's closed skin (+ fused hair; never the free-hanging hair, which hangs OVER the cloth) and, for an upper, the
//    fitted lower piece (the jacket hem goes over the waistband; a lower vertex is matched to the upper's cloth by its own skin anchor
//    too and its depth measured to the body, so a bulky hakama or a thin bow is cleared). Bind rounds raise the field where cloth is closer than `clear` to its
//    anchor or a covered inner vertex has the cloth nearer than `minClear` / under it; POSE rounds do the same in every validation pose
//    (every 0.1 s of all six clips) and raise an extra field (capped). Every garment vertex moves along its anchor normal by the field
//    there: both walls of a thick garment move together (no crumple), thin sheets keep their relief.
// 4. WEIGHTS: the body's own skin weights interpolated at the anchor (cloth and body deform with the same bones); collars / hoods use
//    Neck instead of Head; skirts and hems below the crotch follow the thighs (shin / foot -> thigh, the centre line split between both
//    thighs: lib/fit07.mjs's coat-skirt rule) so a stride swings the skirt instead of tearing through it; light masked smoothing.
// 5. MASKS: body triangles enclosed by the cloth in the bind pose (normal + 4 tilted rays, lib/fit.mjs coverMask) AND covered (never
//    poking, never exposed) in every validation pose are hidden (feet inside shoes, the arms inside sleeves, the torso inside the top);
//    an upper hides the lower's triangles it encloses (hideWear: the waistband under the hem) the same way, plus every lower triangle
//    whose own skin anchors its torso covers in the bind pose and every validation pose (a bulky lower bulging out through the upper);
//    body hair inside / poking through the costume's torso / waist cloth is hidden with the upper (hairHide).
import {TriGrid, insideByParity, weldMap, outerHull} from './penetration.mjs';
import {coverMask} from './fit.mjs';
import {skinWith, posedWeldedNormals, clothGraph, carryNormals, spatialNeighbours} from './lingerie-fit.mjs';

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const r4 = v => +(+v).toFixed(4);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), nrmz = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const quantile = (arr, q) => { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };

export const COSTUME_FIT = {
  clear: {upper: 0.007, lower: 0.006},     // bind: cloth >= this outside the inner surface point it is anchored to
  minClear: {upper: 0.005, lower: 0.004},  // bind: every covered inner vertex has the cloth >= this outside it
  poseClear: 0.002,                        // every validation pose: the same test (contact allowed, no poke)
  maxBind: 0.14, maxExtra: 0.05, maxRoundRaise: 0.04, maxDeficitStep: 0.012, minDirCos: 0.5, poseDirCos: 0.3, bindRounds: 8, poseRounds: 6, freezeAfter: 9,
  nearM: 0.06,                              // a cloth triangle counts against an inner vertex only when anchored within this of it
  coverDist: 0.16,                          // bind coverage ray length (skirts flare off the thighs)
  // the upper hides the lower's cloth whose skin anchor ray meets the upper's torso within this distance (bind + every pose)
  layerCoverM: 0.15,
  // body hair vs the costume's torso / waist cloth (hairClothFrame): search distance, cloth anchored within nearM of the hair's skin point
  // and crossed along its anchor normal (cos > hairDirCos)
  hairMaxDist: 0.25, hairNearM: 0.25, hairDirCos: 0, hairSideM: 0.12,
  hairIslandShare: 0.8,                     // a visible hair island at least this much in / on the cloth (bind) is hidden
  ease: {upper: {x: 0.016, z: 0.02}, lower: {x: 0.008, z: 0.012}},
  tightOffset: 0.0035,                      // legwear (stockings / socks) inner face above the skin
  shoeMargin: 0.012,                        // shoe inner margin round the body's foot (heel, toe, sides)
  weights: {smoothIters: 2, lambda: 0.3, skirtCentre: 0.075},
  mask: {upper: {maxDist: 0.07, tiltDeg: 26, inset: 0.012}, lower: {maxDist: 0.07, tiltDeg: 26, inset: 0.012}, layer: {maxDist: 0.06, tiltDeg: 22, inset: 0.006}},
};

// ------------------------------------------------------------------------------------------------------------------------------ body
export const REG = {torso: 0, head: 1, armL: 2, handL: 3, armR: 4, handR: 5, legL: 6, footL: 7, legR: 8, footR: 9};
const REG_OF_JOINT = {Root: REG.torso, Hips: REG.torso, Spine: REG.torso, Chest: REG.torso, Neck: REG.torso, Head: REG.head,
  L_UpperArm: REG.armL, L_Forearm: REG.armL, L_Hand: REG.handL, R_UpperArm: REG.armR, R_Forearm: REG.armR, R_Hand: REG.handR,
  L_Thigh: REG.legL, L_Shin: REG.legL, L_Foot: REG.footL, R_Thigh: REG.legR, R_Shin: REG.legR, R_Foot: REG.footR};

/**
 * Adds the costume measurements to a lib/lingerie-body.mjs body (mutates B.costume): regions, the inner (collision) surface, region
 * grids, landmarks (armpits, chest / waist / hip cross-sections, front-back centre profile, arm and leg chains, feet, floor).
 */
export function prepareCostumeBody(B) {
  const n = B.pos.length / 3, P = B.pos;
  const region = new Uint8Array(n);
  for (let v = 0; v < n; v++) { let b = 0; for (let k = 1; k < 4; k++) if (B.weights[v * 4 + k] > B.weights[v * 4 + b]) b = k; region[v] = REG_OF_JOINT[B.names[B.joints[v * 4 + b]]] ?? REG.torso; }
  // inner surface: closed skin + hair fused onto it (free-hanging hair never: it hangs over the cloth)
  const tris = [];
  for (let t = 0; t < B.idx.length; t += 3) {
    const v = [B.idx[t], B.idx[t + 1], B.idx[t + 2]];
    if (v.some(i => B.hair[i] && !B.fused[i])) continue;
    tris.push(...v);
  }
  const innerIdx = Uint32Array.from(tris);
  const innerVert = new Uint8Array(n); for (const v of innerIdx) innerVert[v] = 1;
  // outer hull of the inner surface: the AI bodies' own clothes are shells over the skin (a base layer's shirt / shorts, a jacket's
  // inside, inner walls facing the skin); only the externally visible surface is fitted against / audited (lib/fit07.mjs rule)
  const hull = outerHull(P, B.nrm, innerIdx);
  const J = B.J;
  const floorY = (() => { let m = Infinity; for (let v = 0; v < n; v++) if (region[v] === REG.footL || region[v] === REG.footR) m = Math.min(m, P[v * 3 + 1]); return m; })();
  // frontal armpits on the closed skin (torso + arms; hair excluded)
  const occ = occupancyXY(P, innerIdx, 0.004, i => region[i] !== REG.head);
  const armpit = {L: armpitOf(occ, 1), R: armpitOf(occ, -1)};
  // shoulder line on the closed skin (hair excluded: a lock lying on the shoulder is not the shoulder): vertical rays down at 50-70 %
  // of the armpit's x, the median top
  const xAb = (armpit.L.x + armpit.R.x) / 2, shTops = [];
  for (const sg of [1, -1]) for (let f = 0.5; f <= 0.701; f += 0.05) for (const dz of [-0.02, 0, 0.02]) { const h = B.skinGrid.ray(sg * f * xAb, 2.5, J.Neck[2] + dz, 0, -1, 0, 2.5); if (h) shTops.push(2.5 - h.t); }
  const shoulderY = shTops.length ? shTops.sort((a, b) => a - b)[shTops.length >> 1] : J.Neck[1] - 0.05;
  // torso cross-section profile (torso-region inner vertices; 1 cm bins, +-1 cm union) and the front-back centre per height
  const prof = torsoProfile(P, n, v => innerVert[v] && region[v] === REG.torso);
  const chain = s => {
    const U = J[s + '_UpperArm'], E = J[s + '_Forearm'], W = J[s + '_Hand'];
    const dir = nrmz(sub(W, E)); let tip = W, best = -Infinity;
    for (let v = 0; v < n; v++) if (region[v] === (s === 'L' ? REG.handL : REG.handR)) { const d = dot(sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], W), dir); if (d > best) { best = d; tip = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; } }
    const tipOnAxis = add(W, mul(dir, Math.max(0.05, best)));
    return polyline([U, E, W, tipOnAxis]);
  };
  const legChain = s => polyline([J[s + '_Thigh'], J[s + '_Shin'], J[s + '_Foot']]);
  const foot = s => {
    const R = s === 'L' ? REG.footL : REG.footR;
    let toe = null, heel = null, xMin = Infinity, xMax = -Infinity;
    for (let v = 0; v < n; v++) { if (region[v] !== R) continue; const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; if (!toe || p[2] > toe[2]) toe = p; if (!heel || p[2] < heel[2]) heel = p; xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]); }
    // yaw of the foot: the heel -> toe direction on the floor (toes may turn out)
    const fwd = nrmz([toe[0] - heel[0], 0, toe[2] - heel[2]]);
    return {toe, heel, width: xMax - xMin, xMid: (xMin + xMax) / 2, length: toe[2] - heel[2], yaw: Math.atan2(fwd[0], fwd[2]), ankle: J[s + '_Foot']};
  };
  const neckY = J.Neck[1], hipsY = J.Hips[1];
  const waistY = hipsY + 0.33 * (neckY - hipsY);
  B.costume = {region, innerIdx, innerVert, hull, floorY, armpit, shoulderY, prof, waistY, crotch: B.landmarks.crotch, arm: {L: chain('L'), R: chain('R')}, leg: {L: legChain('L'), R: legChain('R')},
    foot: {L: foot('L'), R: foot('R')}, grids: new Map(), nrm: B.nrm, adjacency: welded1Ring(B, innerIdx)};
  return B.costume;
}

function welded1Ring(B, idx) {
  const nb = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = B.remap[idx[t + k]], b = B.remap[idx[t + (k + 1) % 3]]; if (a === b) continue;
    (nb.get(a) ?? nb.set(a, new Set()).get(a)).add(b); (nb.get(b) ?? nb.set(b, new Set()).get(b)).add(a);
  }
  return new Map([...nb].map(([k, s]) => [k, Uint32Array.from([...s].sort((x, y) => x - y))]));
}

function polyline(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  return {pts, cum, total: cum[cum.length - 1]};
}
/** Point + (blended) unit direction at arc length a along a polyline (extrapolated linearly beyond both ends). */
function along(pl, a, blend = 0.03) {
  const {pts, cum} = pl, m = pts.length - 1;
  let k = 0; while (k < m - 1 && a > cum[k + 1]) k++;
  const d = nrmz(sub(pts[k + 1], pts[k]));
  const p = add(pts[k], mul(d, a - cum[k]));
  // direction blended over +-blend round the inner joints (no kink in the cloth at the elbow / knee)
  let dir = d;
  if (k > 0 && a - cum[k] < blend) { const dp = nrmz(sub(pts[k], pts[k - 1])); const w = 0.5 + 0.5 * (a - cum[k]) / blend; dir = nrmz(add(mul(d, w), mul(dp, 1 - w))); }
  else if (k < m - 1 && cum[k + 1] - a < blend) { const dn = nrmz(sub(pts[k + 2], pts[k + 1])); const w = 0.5 + 0.5 * (cum[k + 1] - a) / blend; dir = nrmz(add(mul(d, w), mul(dn, 1 - w))); }
  return {p, dir};
}

/** Minimal rotation (3 x 3, row-major) taking unit a onto unit b. */
function rotBetween(a, b) {
  const v = cross(a, b), c = dot(a, b);
  if (c < -0.9999) return [-1, 0, 0, 0, -1, 0, 0, 0, 1];
  const k = 1 / (1 + c);
  return [v[0] * v[0] * k + c, v[1] * v[0] * k - v[2], v[2] * v[0] * k + v[1],
    v[0] * v[1] * k + v[2], v[1] * v[1] * k + c, v[2] * v[1] * k - v[0],
    v[0] * v[2] * k - v[1], v[1] * v[2] * k + v[0], v[2] * v[2] * k + c];
}
const rot = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

/** Frontal occupancy: the triangles (filter: every vertex passes) projected on XY, rasterised at `cell`. */
export function occupancyXY(P, idx, cell, keep = null) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of idx) { x0 = Math.min(x0, P[v * 3]); x1 = Math.max(x1, P[v * 3]); y0 = Math.min(y0, P[v * 3 + 1]); y1 = Math.max(y1, P[v * 3 + 1]); }
  const W = Math.ceil((x1 - x0) / cell) + 3, H = Math.ceil((y1 - y0) / cell) + 3, X0 = x0 - cell, Y0 = y0 - cell;
  const g = new Uint8Array(W * H);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (keep && !(keep(a) && keep(b) && keep(c))) continue;
    const ax = (P[a * 3] - X0) / cell, ay = (P[a * 3 + 1] - Y0) / cell, bx = (P[b * 3] - X0) / cell, by = (P[b * 3 + 1] - Y0) / cell, cx = (P[c * 3] - X0) / cell, cy = (P[c * 3 + 1] - Y0) / cell;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const qx = i + 0.5, qy = j + 0.5;
      if (Math.abs(area) < 1e-9) { if (Math.abs(qx - ax) < 0.75 && Math.abs(qy - ay) < 0.75) g[j * W + i] = 1; continue; }
      const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area, w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area, w2 = 1 - w0 - w1;
      const e = -0.35 / Math.max(1, Math.abs(area)) ** 0.5; // a little conservative dilation: thin sheets never leave pin holes
      if (w0 >= e && w1 >= e && w2 >= e) g[j * W + i] = 1;
    }
  }
  return {g, W, H, X0, Y0, cell};
}

/** Intervals of occupied x (metres) on side s (+1: x >= 0, -1: x <= 0) of row j, sorted outward. */
function rowIntervals(occ, j, s) {
  const {g, W, X0, cell} = occ, out = [];
  const i0 = Math.round(-X0 / cell);
  let cur = null;
  for (let k = 0; k < W; k++) {
    const i = s > 0 ? i0 + k : i0 - k;
    if (i < 0 || i >= W) break;
    const on = g[j * W + i];
    if (on && !cur) cur = [k * cell, k * cell];
    else if (on) cur[1] = k * cell;
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Armpit of side s from a frontal occupancy: scanning rows upward, the highest row where the interval holding the midline (torso) is
 * separated by a gap (>= 2 cells) from an interval further out (the arm / sleeve). {y, x (gap midline, |x|), gaps: [{y, x0, x1}]}.
 */
function armpitOf(occ, s) {
  const {H, Y0, cell} = occ, gaps = [];
  for (let j = 0; j < H; j++) {
    const iv = rowIntervals(occ, j, s);
    if (iv.length < 2 || iv[0][0] > 2 * cell) continue;
    const g0 = iv[0][1], g1 = iv[1][0];
    if (g1 - g0 >= 2 * cell) gaps.push({y: Y0 + (j + 0.5) * cell, x0: g0, x1: g1});
  }
  if (!gaps.length) throw new Error('no armpit gap found');
  // the highest gap row of the contiguous run under the shoulder (a stray gap high up - between a collar and an epaulette - would be a
  // separate run: take the run containing the widest gap, its top row)
  const runs = []; let cur = [];
  for (const q of gaps) { if (cur.length && q.y - cur[cur.length - 1].y > 2.5 * cell) { runs.push(cur); cur = []; } cur.push(q); }
  if (cur.length) runs.push(cur);
  const run = runs.reduce((a, r) => (Math.max(...r.map(q => q.x1 - q.x0)) * r.length > Math.max(...a.map(q => q.x1 - q.x0)) * a.length ? r : a));
  const top = run[run.length - 1];
  return {y: top.y, x: (top.x0 + top.x1) / 2, gaps: run.map(q => ({y: q.y, mid: (q.x0 + q.x1) / 2, x0: q.x0, x1: q.x1}))};
}

/** Torso cross-section profile: per 1 cm bin half-width (max |x|), front / back z, centre z; smoothed centre(y). */
function torsoProfile(P, n, keep) {
  let y0 = Infinity, y1 = -Infinity;
  for (let v = 0; v < n; v++) if (keep(v)) { y0 = Math.min(y0, P[v * 3 + 1]); y1 = Math.max(y1, P[v * 3 + 1]); }
  const YS = 0.01, NY = Math.ceil((y1 - y0) / YS) + 1;
  const bins = Array.from({length: NY}, (_, j) => ({y: y0 + j * YS, hw: 0, zMin: Infinity, zMax: -Infinity, n: 0}));
  for (let v = 0; v < n; v++) {
    if (!keep(v)) continue;
    const j = Math.round((P[v * 3 + 1] - y0) / YS), b = bins[j];
    b.hw = Math.max(b.hw, Math.abs(P[v * 3])); b.zMin = Math.min(b.zMin, P[v * 3 + 2]); b.zMax = Math.max(b.zMax, P[v * 3 + 2]); b.n++;
  }
  const raw = bins.map(b => ({...b}));
  for (let j = 0; j < NY; j++) for (const d of [-1, 1]) { const r = raw[j + d]; if (!r || !r.n) continue; const b = bins[j]; b.hw = Math.max(b.hw, r.hw); b.zMin = Math.min(b.zMin, r.zMin); b.zMax = Math.max(b.zMax, r.zMax); b.n += r.n; }
  const at = y => bins[Math.max(0, Math.min(NY - 1, Math.round((y - y0) / YS)))];
  // smoothed centre z (gaussian over +-8 cm of the populated bins)
  const smooth = f => bins.map((b, j) => { let s = 0, w = 0; for (let d = -8; d <= 8; d++) { const q = bins[j + d]; if (!q || !q.n) continue; const g = Math.exp(-0.5 * (d / 4) ** 2); s += g * f(q); w += g; } return w ? s / w : 0; });
  const centre = smooth(q => (q.zMin + q.zMax) / 2), back = smooth(q => q.zMin);
  const ix = y => Math.max(0, Math.min(NY - 1, Math.round((y - y0) / YS)));
  // side depth at y: front-back extent of the vertices at 20-75 % of the half width (clear of the midline: bows, the bust cleft)
  const sideDepth = y => { const hw = at(y).hw; let z0 = Infinity, z1 = -Infinity; for (let v = 0; v < n; v++) { if (!keep(v) || Math.abs(P[v * 3 + 1] - y) > 0.012) continue; const ax = Math.abs(P[v * 3]); if (ax < 0.2 * hw || ax > 0.75 * hw) continue; z0 = Math.min(z0, P[v * 3 + 2]); z1 = Math.max(z1, P[v * 3 + 2]); } return {zBack: z0, zFront: z1, depth: z1 - z0}; };
  return {y0, YS, NY, bins, at, centreAt: y => centre[ix(y)], backAt: y => back[ix(y)], halfWidth: y => at(y).hw, depth: y => { const b = at(y); return b.zMax - b.zMin; }, sideDepth};
}

/** Region-restricted grid over the body's inner triangles (>= 2 vertices in the set). */
function regionGrid(B, key, pred) {
  const C = B.costume;
  if (C.grids.has(key)) return C.grids.get(key);
  const keep = [], I = C.innerIdx;
  for (let t = 0; t < I.length; t += 3) { let k = 0; for (let c = 0; c < 3; c++) if (pred(I[t + c])) k++; if (k >= 2) keep.push(I[t], I[t + 1], I[t + 2]); }
  const idx = Uint32Array.from(keep), g = {idx, grid: new TriGrid(B.pos, idx, 0.03)};
  C.grids.set(key, g);
  return g;
}

// ------------------------------------------------------------------------------------------------------------------------------ garment
/**
 * Garment analysis (garment frame). kind 'upper': armpits, sleeve axes / cuffs, chest reference section, hem. kind 'lower': waistband,
 * crotch (trousers), legwear components (skirts), per-side instep top / ankle centre / foot box.
 */
export function analyseGarment(G, kind, cfg = {}) {
  const P = G.pos, n = P.length / 3;
  const graph = clothGraph(G);
  if (kind === 'upper') {
    const occ = occupancyXY(P, G.idx, 0.004);
    const out = {kind, graph, side: {}};
    for (const [s, sg] of [['L', 1], ['R', -1]]) {
      const A = armpitOf(occ, sg);
      // provisional sleeve direction: armpit -> the farthest occupied point of the side
      let far = null;
      for (let i = 0; i < n; i++) { const x = P[i * 3] * sg; if (!far || x > far[0] * sg) far = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; }
      const d2 = nrmz([far[0] - sg * A.x, far[1] - A.y, 0]);
      const alpha = Math.atan2(-d2[1], Math.abs(d2[0])); // angle below horizontal
      const seam = seamFn(A, sg, alpha);
      // pure sleeve vertices: well outside the seam; the axis = line through slice centroids along the provisional direction
      const ids = []; for (let i = 0; i < n; i++) if (seam(P[i * 3], P[i * 3 + 1]) > 0.03) ids.push(i);
      const d0 = [d2[0], d2[1], 0], o = [sg * A.x, A.y, 0];
      let uMax = -Infinity; for (const i of ids) uMax = Math.max(uMax, dot(sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], o), d0));
      const slices = new Map();
      for (const i of ids) { const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], u = dot(sub(p, o), d0); if (u < 0.25 * uMax || u > 0.92 * uMax) continue; const k = Math.floor(u / 0.01); const q = slices.get(k) ?? slices.set(k, [0, 0, 0, 0]).get(k); q[0] += p[0]; q[1] += p[1]; q[2] += p[2]; q[3]++; }
      const cs = [...slices.values()].filter(q => q[3] >= 3).map(q => [q[0] / q[3], q[1] / q[3], q[2] / q[3]]);
      const c0 = mul(cs.reduce((a, c) => add(a, c), [0, 0, 0]), 1 / cs.length);
      // principal direction of the centroids (power iteration on the 3 x 3 scatter)
      const S = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (const c of cs) { const d = sub(c, c0); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a * 3 + b] += d[a] * d[b]; }
      let ax = d0; for (let it = 0; it < 50; it++) ax = nrmz(rot(S, ax));
      if (dot(ax, d0) < 0) ax = mul(ax, -1);
      // cuff: centroid of the sleeve's last 1.5 cm along the axis
      let tMax = -Infinity; for (const i of ids) tMax = Math.max(tMax, dot(sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], c0), ax));
      const cuffIds = ids.filter(i => dot(sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], c0), ax) > tMax - 0.015);
      const cuff = mul(cuffIds.reduce((a, i) => add(a, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]), [0, 0, 0]), 1 / cuffIds.length);
      out.side[s] = {sg, armpit: {y: A.y, x: A.x}, alpha, seam, axis: {o: c0, d: ax}, cuff, tCuff: dot(sub(cuff, c0), ax), pureSleeveVertices: ids.length};
    }
    // sleeve weight per vertex (smooth across the seam)
    const ws = new Float32Array(n), side = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const sg = P[i * 3] >= 0 ? 1 : -1, S = out.side[sg > 0 ? 'L' : 'R'];
      ws[i] = ss(-0.015, 0.02, S.seam(P[i * 3], P[i * 3 + 1])); side[i] = sg;
    }
    out.ws = ws; out.sideOf = side;
    // reference chest section just below the armpits (torso part only)
    const yA = (out.side.L.armpit.y + out.side.R.armpit.y) / 2, yRef = yA - 0.025;
    let hw = 0, zMin = Infinity, zMax = -Infinity, hem = Infinity, top = -Infinity;
    for (let i = 0; i < n; i++) {
      if (ws[i] > 0.5) continue;
      const y = P[i * 3 + 1]; hem = Math.min(hem, y); top = Math.max(top, y);
      if (Math.abs(y - yRef) < 0.012) { hw = Math.max(hw, Math.abs(P[i * 3])); zMin = Math.min(zMin, P[i * 3 + 2]); zMax = Math.max(zMax, P[i * 3 + 2]); }
    }
    // side depth (20-75 % of the half width: clear of the bow / buttons / lapels on the midline) and its back face
    let sz0 = Infinity, sz1 = -Infinity;
    for (let i = 0; i < n; i++) { if (ws[i] > 0.5 || Math.abs(P[i * 3 + 1] - yRef) > 0.012) continue; const ax = Math.abs(P[i * 3]); if (ax < 0.2 * hw || ax > 0.75 * hw) continue; sz0 = Math.min(sz0, P[i * 3 + 2]); sz1 = Math.max(sz1, P[i * 3 + 2]); }
    // shoulder line: the garment's top over the shoulder slope (50-70 % of the armpit's x, both sides; the median: an epaulette /
    // frill never decides it)
    const xA = (out.side.L.armpit.x + out.side.R.armpit.x) / 2, tops = [];
    for (const sg of [1, -1]) for (let f = 0.5; f <= 0.701; f += 0.05) { const x = sg * f * xA; let t = -Infinity; for (let i = 0; i < n; i++) if (Math.abs(P[i * 3] - x) < 0.006) t = Math.max(t, P[i * 3 + 1]); if (Number.isFinite(t)) tops.push(t); }
    const shoulderY = quantile(tops, 0.5);
    Object.assign(out, {yA, yRef, chest: {hw, depth: zMax - zMin, zc: (zMin + zMax) / 2, sideDepth: sz1 - sz0, zBack: sz0}, hem, top, shoulderY, xA});
    return out;
  }
  // ---- lower
  const comps = componentsOf(G, graph);
  const out = {kind, graph, comps: comps.list.length};
  const label = comps.label;
  // legwear components (skirts): wholly on one side of the midline and below the skirt hem's level
  const info = comps.list.map(c => c);
  const crossing = new Set(info.filter(c => c.xMin < -0.01 && c.xMax > 0.01));
  const waistTop = Math.max(...[...crossing].map(c => c.yMax));
  // the midline split: scanning down from the waistband, the first row where no cloth lies on the midline (|x| < 1 cm) = the skirt's
  // hem (skirts) / the crotch (trousers): below it the two legs stand apart
  const occ = occupancyXY(P, G.idx, 0.004);
  let split = null;
  {
    const i0 = Math.round(-occ.X0 / occ.cell), r = Math.ceil(0.01 / occ.cell);
    for (let j = Math.floor((waistTop - 0.03 - occ.Y0) / occ.cell); j >= 0; j--) {
      let on = false; for (let i = i0 - r; i <= i0 + r && !on; i++) on = !!occ.g[j * occ.W + i];
      if (!on) { split = occ.Y0 + (j + 1) * occ.cell; break; }
    }
  }
  if (split === null) throw new Error('lower piece: the legs never part on the midline');
  // trousers: the CROTCH is the gusset over the legs - the median first cloth met by five rays going UP the midline (x = 0, round the
  // waist's front-back centre) from between the legs; baggy legs that touch at the midline keep the frontal split far lower
  let crotch = null;
  if (cfg.style === 'trousers') {
    if (cfg.crotch != null) crotch = cfg.crotch;
    else {
      const grid = new TriGrid(P, G.idx, 0.02), zc = (zMinW(P, n, waistTop) + zMaxW(P, n, waistTop)) / 2, y0 = split - 0.02, hits = [];
      for (const dz of [-0.03, -0.015, 0, 0.015, 0.03]) { const h = grid.ray(0, y0, zc + dz, 0, 1, 0, waistTop - y0); if (h) hits.push(y0 + h.t); }
      crotch = hits.length ? Math.max(split, quantile(hits, 0.5)) : split;
    }
  }
  const skirtHem = cfg.style === 'skirt' ? split : null;
  // waistband reference section (top 1-4 cm)
  let hw = 0, zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y > waistTop - 0.04 && y < waistTop - 0.01 && crossing.has(info[label[i]])) { hw = Math.max(hw, Math.abs(P[i * 3])); zMin = Math.min(zMin, P[i * 3 + 2]); zMax = Math.max(zMax, P[i * 3 + 2]); } }
  // part of each vertex: leg side (-1 / 0 / +1) and leg weight. Trousers: below the crotch (blended over +-3 cm). Skirts: the legwear
  // below the hem, and up under the skirt the cloth that stays on the leg (within 1.6 x the legwear radius of its axis, extrapolated
  // up from the 20 cm below the hem): stocking tops under a skirt
  const legSide = new Int8Array(n), wl = new Float32Array(n);
  const legAxis = {};
  if (cfg.style === 'skirt') {
    for (const sg of [1, -1]) {
      const bins = new Map();
      for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (P[i * 3] * sg <= 0 || y > split - 0.02 || y < split - 0.22) continue; const j = Math.round(y / 0.01); const b = bins.get(j) ?? bins.set(j, {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity}).get(j); b.x0 = Math.min(b.x0, P[i * 3]); b.x1 = Math.max(b.x1, P[i * 3]); b.z0 = Math.min(b.z0, P[i * 3 + 2]); b.z1 = Math.max(b.z1, P[i * 3 + 2]); }
      const pts = [...bins.entries()].map(([j, b]) => ({y: j * 0.01, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, r: ((b.x1 - b.x0) + (b.z1 - b.z0)) / 4}));
      const fit = k => { const my = pts.reduce((a, p) => a + p.y, 0) / pts.length, mv = pts.reduce((a, p) => a + p[k], 0) / pts.length; let num = 0, den = 0; for (const p of pts) { num += (p.y - my) * (p[k] - mv); den += (p.y - my) ** 2; } const b = den ? num / den : 0; return y => mv + b * (y - my); };
      const top = pts.filter(p => p.y > split - 0.07);
      legAxis[sg] = {x: fit('x'), z: fit('z'), r: top.length ? top.reduce((a, p) => a + p.r, 0) / top.length : 0.05};
    }
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], sg = x >= 0 ? 1 : -1;
      if (y < split) { legSide[i] = sg; wl[i] = 1; continue; }
      if (y > split + (cfg.legwearAboveHem ?? 0.06)) continue;
      const A = legAxis[sg], d = Math.hypot(x - A.x(y), P[i * 3 + 2] - A.z(y));
      if (d < 1.5 * A.r) { legSide[i] = sg; wl[i] = 1; }
    }
  } else {
    for (let i = 0; i < n; i++) { legSide[i] = P[i * 3] >= 0 ? 1 : -1; wl[i] = ss(crotch + 0.03, crotch - 0.03, P[i * 3 + 1]); }
  }
  // per side: the instep top (where the leg's front-back depth jumps to the foot's), the ankle centre above it, the foot box
  out.side = {};
  for (const [s, sg] of [['L', 1], ['R', -1]]) {
    const ids = []; for (let i = 0; i < n; i++) if (legSide[i] === sg && wl[i] > 0.5) ids.push(i);
    let yMin = Infinity; for (const i of ids) yMin = Math.min(yMin, P[i * 3 + 1]);
    const YS = 0.005, bins = [];
    for (const i of ids) { const j = Math.floor((P[i * 3 + 1] - yMin) / YS); const b = bins[j] ??= {zMin: Infinity, zMax: -Infinity, xMin: Infinity, xMax: -Infinity, n: 0}; b.zMin = Math.min(b.zMin, P[i * 3 + 2]); b.zMax = Math.max(b.zMax, P[i * 3 + 2]); b.xMin = Math.min(b.xMin, P[i * 3]); b.xMax = Math.max(b.xMax, P[i * 3]); b.n++; }
    const depth = j => (bins[j] && bins[j].n ? bins[j].zMax - bins[j].zMin : 0);
    let footLen = 0; for (let j = 0; j < 8; j++) footLen = Math.max(footLen, depth(j));
    let instep = 0; for (let j = 0; j < bins.length; j++) { if (depth(j) > 0.72 * footLen) instep = j; else if (j > 8) break; }
    const instepY = yMin + (instep + 1) * YS;
    const ankleY = instepY + 0.02;
    const near = ids.filter(i => Math.abs(P[i * 3 + 1] - ankleY) < 0.008);
    const ankle = [0, 1, 2].map(k => near.reduce((a, i) => a + P[i * 3 + k], 0) / Math.max(1, near.length));
    ankle[0] = near.length ? (Math.min(...near.map(i => P[i * 3])) + Math.max(...near.map(i => P[i * 3]))) / 2 : ankle[0];
    ankle[2] = near.length ? (Math.min(...near.map(i => P[i * 3 + 2])) + Math.max(...near.map(i => P[i * 3 + 2]))) / 2 : ankle[2];
    ankle[1] = ankleY;
    let toe = -Infinity, heel = Infinity, fx0 = Infinity, fx1 = -Infinity;
    for (const i of ids) { if (P[i * 3 + 1] > instepY) continue; toe = Math.max(toe, P[i * 3 + 2]); heel = Math.min(heel, P[i * 3 + 2]); fx0 = Math.min(fx0, P[i * 3]); fx1 = Math.max(fx1, P[i * 3]); }
    out.side[s] = {sg, sole: yMin, instepY, ankle, toe, heel, footWidth: fx1 - fx0, footMidX: (fx0 + fx1) / 2, vertices: ids.length};
  }
  Object.assign(out, {waistTop, skirtHem, crotch, waist: {hw, depth: zMax - zMin, zc: (zMin + zMax) / 2}, legSide, wl, legVertices: wl.reduce((a, w) => a + (w > 0.5 ? 1 : 0), 0)});
  return out;
}

/** Welded connected components with extents. */
function componentsOf(G, graph) {
  const n = G.pos.length / 3, par = Int32Array.from({length: n}, (_, i) => i);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < G.idx.length; t += 3) { const a = find(graph.remap[G.idx[t]]); for (let k = 1; k < 3; k++) { const b = find(graph.remap[G.idx[t + k]]); if (a !== b) par[b] = a; } }
  const map = new Map(), list = [], label = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = find(graph.remap[i]);
    let k = map.get(r); if (k === undefined) { k = list.length; map.set(r, k); list.push({n: 0, xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity}); }
    label[i] = k; const c = list[k]; c.n++;
    c.xMin = Math.min(c.xMin, G.pos[i * 3]); c.xMax = Math.max(c.xMax, G.pos[i * 3]); c.yMin = Math.min(c.yMin, G.pos[i * 3 + 1]); c.yMax = Math.max(c.yMax, G.pos[i * 3 + 1]);
  }
  return {list, label};
}

/** Signed distance (garment frame, frontal) from the torso / sleeve seam of side sg: > 0 = sleeve side. */
function seamFn(A, sg, alpha) {
  const gaps = A.gaps, ca = Math.cos(alpha), ta = Math.tan(alpha);
  const midAt = y => { let best = gaps[0]; for (const q of gaps) if (Math.abs(q.y - y) < Math.abs(best.y - y)) best = q; return best.mid; };
  return (x, y) => {
    const ax = x * sg;
    if (y <= A.y) return ax - midAt(y);
    return (ax - (A.x + (y - A.y) * ta)) * ca;
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ mapping
/** Retargets the garment onto the body (bind pose). Returns {pos, parts (per vertex: 'torso'|'sleeveL'|..|'shoeR'), report}. */
export function mapGarment(B, G, GA, cfg, opts = COSTUME_FIT) {
  const C = B.costume, P = G.pos, n = P.length / 3, out = new Float32Array(n * 3), part = new Array(n);
  const report = {};
  if (GA.kind === 'upper') {
    const yA_b = (C.armpit.L.y + C.armpit.R.y) / 2;
    const hemB = C.waistY - cfg.hem * (C.waistY - C.crotch[1]);
    const sy = (yA_b - hemB) / (GA.yA - GA.hem);
    const yRefB = yA_b - 0.025;
    const sd = C.prof.sideDepth(yRefB);
    const sx = (C.prof.halfWidth(yRefB) + opts.ease.upper.x) / GA.chest.hw, sz = (sd.depth + 2 * opts.ease.upper.z) / GA.chest.sideDepth;
    // above the armpits: the garment's shoulder line onto the body's (the collar keeps its designed height over the shoulders)
    const sUp = Math.min(1.6 * sy, Math.max(0.6 * sy, (C.shoulderY - yA_b) / (GA.shoulderY - GA.yA)));
    const ymap = y => yA_b + (y - GA.yA) * (y > GA.yA ? sUp : sy), yinv = y => GA.yA + (y - yA_b) / (y > yA_b ? sUp : sy);
    report.shoulderScale = r4(sUp); report.shoulderY = r4(C.shoulderY); report.garmentShoulderY = r4(GA.shoulderY);
    // front-back: the garment's back face at the reference section -> the body's (smoothed) back at each height - ease
    const zb = y => C.prof.backAt(y) - opts.ease.upper.z;
    const T = p => { const y = ymap(p[1]); return [p[0] * sx, y, zb(y) + (p[2] - GA.chest.zBack) * sz]; };
    const Tinv = q => [q[0] / sx, yinv(q[1]), GA.chest.zBack + (q[2] - zb(q[1])) / sz];
    const sr = (sx + sz) / 2;
    const sleeve = {};
    for (const s of ['L', 'R']) {
      const S = GA.side[s], arm = C.arm[s];
      const U = arm.pts[0], Ug = Tinv(U);
      const tS = dot(sub(Ug, S.axis.o), S.axis.d), Lg = S.tCuff - tS;
      const endArc = armArc(arm, cfg.sleeveEnd);
      sleeve[s] = {S, arm, tS, k: endArc / Lg, Sg: add(S.axis.o, mul(S.axis.d, tS))};
      report['sleeve' + s] = {garmentAngleDeg: r4(S.alpha * 180 / Math.PI), garmentLength: r4(Lg), bodyArc: r4(endArc), axialScale: r4(endArc / Lg)};
    }
    const Smap = (p, s) => {
      const L = sleeve[s], t = dot(sub(p, L.Sg), L.S.axis.d), rr = sub(p, add(L.Sg, mul(L.S.axis.d, t)));
      const {p: c, dir} = along(L.arm, t * L.k);
      return add(c, mul(rot(rotBetween(L.S.axis.d, dir), rr), sr));
    };
    for (let i = 0; i < n; i++) {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], s = GA.sideOf[i] > 0 ? 'L' : 'R', w = GA.ws[i];
      const q = w <= 0 ? T(p) : w >= 1 ? Smap(p, s) : add(mul(T(p), 1 - w), mul(Smap(p, s), w));
      out.set(q, i * 3);
      part[i] = w > 0.5 ? 'sleeve' + s : 'torso';
    }
    Object.assign(report, {sx: r4(sx), sy: r4(sy), sz: r4(sz), sleeveRadialScale: r4(sr), armpitY: r4(yA_b), hemTargetY: r4(hemB), garmentArmpitY: r4(GA.yA), garmentHemY: r4(GA.hem)});
    return {pos: out, part, report};
  }
  // ---- lower
  const waistB = C.waistY + (cfg.waistOffset ?? 0);
  const sx = (C.prof.halfWidth(waistB) + opts.ease.lower.x) / GA.waist.hw, sz = (C.prof.depth(waistB) + opts.ease.lower.z) / GA.waist.depth;
  let ymap, yinv;
  const ankleB = (C.foot.L.ankle[1] + C.foot.R.ankle[1]) / 2, ankleG = (GA.side.L.ankle[1] + GA.side.R.ankle[1]) / 2;
  if (cfg.style === 'trousers') {
    const crB = C.crotch[1] - (cfg.crotchDrop ?? 0.02);
    const s1 = (waistB - crB) / (GA.waistTop - GA.crotch);
    ymap = y => waistB + (y - GA.waistTop) * s1; yinv = y => GA.waistTop + (y - waistB) / s1;
    report.sy = r4(s1);
  } else {
    const s1 = (waistB - ankleB) / (GA.waistTop - ankleG);
    ymap = y => waistB + (y - GA.waistTop) * s1; yinv = y => GA.waistTop + (y - waistB) / s1;
    report.sy = r4(s1);
  }
  const W = p => { const y = ymap(p[1]); return [p[0] * sx, y, C.prof.centreAt(Math.max(y, C.crotch[1])) + (p[2] - GA.waist.zc) * sz]; };
  const Winv = q => [q[0] / sx, yinv(q[1]), GA.waist.zc + (q[2] - C.prof.centreAt(Math.max(q[1], C.crotch[1]))) / sz];
  const legs = {};
  for (const s of ['L', 'R']) {
    const S = GA.side[s], leg = C.leg[s], F = C.foot[s];
    const Hg = Winv(leg.pts[0]);
    // the garment leg's own centreline: the radial frame of every leg vertex (a hip-joint guess would twist a tight stocking round the
    // knee)
    const sg = s === 'L' ? 1 : -1, bins = new Map();
    for (let i = 0; i < n; i++) {
      if (GA.legSide[i] !== sg || GA.wl[i] < 0.5) continue;
      const j = Math.round(P[i * 3 + 1] / 0.01), b = bins.get(j) ?? bins.set(j, {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, n: 0}).get(j);
      b.x0 = Math.min(b.x0, P[i * 3]); b.x1 = Math.max(b.x1, P[i * 3]); b.z0 = Math.min(b.z0, P[i * 3 + 2]); b.z1 = Math.max(b.z1, P[i * 3 + 2]); b.n++;
    }
    // a STRAIGHT line (least squares over the 1 cm box centres above the footwear, each weighted by the vertices it holds): the masters
    // stand straight-legged, and a simplified sock has too few vertices per height for a per-height centre (it would wobble)
    const ys = [...bins.keys()].map(j => j * 0.01).filter(y => y > (cfg.shoeTop != null ? S.sole + cfg.shoeTop : S.ankle[1]));
    let w0 = 0, wy = 0, wx = 0, wz = 0, wyy = 0, wxy = 0, wzy = 0;
    for (const y of ys) { const b = bins.get(Math.round(y / 0.01)), w = Math.sqrt(b.n), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; w0 += w; wy += w * y; wx += w * cx; wz += w * cz; wyy += w * y * y; wxy += w * cx * y; wzy += w * cz * y; }
    const den = w0 * wyy - wy * wy, bx = den ? (w0 * wxy - wy * wx) / den : 0, bz = den ? (w0 * wzy - wy * wz) / den : 0, ax = (wx - bx * wy) / (w0 || 1), az = (wz - bz * wy) / (w0 || 1);
    const centre = y => [ax + bx * y, y, az + bz * y];
    // pointing DOWN the leg like the body chain (hip -> knee -> ankle): the radial frame is turned by the small bend between them
    const tangent = y => nrmz(sub(centre(y - 0.03), centre(y + 0.03)));
    const yTop = Hg[1], yAnk = S.ankle[1];
    legs[s] = {S, leg, F, Hg, centre, tangent, yTop, yAnk};
    report['leg' + s] = {garmentHipY: r4(yTop), garmentAnkleY: r4(yAnk), bodyLength: r4(leg.total), axialScale: r4(leg.total / (yTop - yAnk))};
  }
  const sr = (sx + sz) / 2;
  const legSection = legSectionFn(B);
  const H = C.hull;
  const legGrid = {L: regionGrid(B, 'legL', v => C.region[v] === REG.legL || C.region[v] === REG.footL), R: regionGrid(B, 'legR', v => C.region[v] === REG.legR || C.region[v] === REG.footR)};
  // tight legwear: the garment's own smooth radius per height (median distance from its centreline over 1 cm) - the relief (bows,
  // garters, sock cuffs) is what stands out of it
  const tight = cfg.legFit === 'tight';
  // relief of every legwear vertex: its distance from the garment leg's centreline minus the same distance smoothed over its 2 cm
  // SPATIAL neighbourhood (both walls of a thick sock average together: each keeps half the wall thickness; a bow / garter / cuff
  // stands out by its own height); the centreline's own noise cancels
  const reliefOf = new Float32Array(n);
  if (tight) {
    const Gg = clothGraph(G), rad0 = new Float32Array(n);
    for (let i = 0; i < n; i++) { if (!GA.legSide[i] || GA.wl[i] < 0.5) continue; const L = legs[GA.legSide[i] > 0 ? 'L' : 'R'], c = L.centre(P[i * 3 + 1]); rad0[i] = Math.hypot(P[i * 3] - c[0], P[i * 3 + 2] - c[2]); }
    const NB = spatialNeighbours(Gg, P, 0.02);
    for (const i of Gg.uniq) {
      if (!GA.legSide[i] || GA.wl[i] < 0.5) continue;
      const {ids, ds} = NB.get(i); let a = 0, w = 0;
      for (let q = 0; q < ids.length; q++) { const j = ids[q]; if (GA.legSide[j] !== GA.legSide[i] || GA.wl[j] < 0.5) continue; const g = Math.exp(-0.5 * (ds[q] / 0.01) ** 2); a += g * rad0[j]; w += g; }
      reliefOf[i] = Math.max(-0.006, Math.min(0.015, rad0[i] - (w ? a / w : rad0[i])));
    }
    for (let i = 0; i < n; i++) reliefOf[i] = reliefOf[Gg.remap[i]];
  }
  // tight legwear: the leg's own outer surface as a SMOOTH polar radius map per side (36 directions x 1 cm of height about the leg
  // bone: a ray from 25 cm out back toward the bone, the outermost hit on the leg's outer-hull skin; gaps filled, dilated over one
  // cell and smoothed 1-2-1): every stocking vertex lies on it + the cloth offset + its own relief (no per-vertex ray noise)
  const polar = {};
  if (tight) for (const s of ['L', 'R']) {
    const pts = legs[s].leg.pts, NA = 36, YS = 0.01, y0 = C.floorY, y1 = pts[0][1], NY = Math.ceil((y1 - y0) / YS) + 1;
    const origin = y => { for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; if ((y <= a[1] && y >= b[1]) || k === pts.length - 2) { const f = Math.max(0, Math.min(1.5, (a[1] - y) / ((a[1] - b[1]) || 1))); return [a[0] + (b[0] - a[0]) * f, y, a[2] + (b[2] - a[2]) * f]; } } return [pts[0][0], y, pts[0][2]]; };
    const R = new Float32Array(NY * NA).fill(NaN), g = legGrid[s].grid;
    for (let j = 0; j < NY; j++) {
      const y = y0 + j * YS, o = origin(y);
      for (let k = 0; k < NA; k++) { const th = k * 2 * Math.PI / NA, ux = Math.sin(th), uz = Math.cos(th); const h = g.ray(o[0] + ux * 0.25, y, o[2] + uz * 0.25, -ux, 0, -uz, 0.25); if (h) R[j * NA + k] = 0.25 - h.t; }
    }
    for (let j = 0; j < NY; j++) { const row = Array.from(R.subarray(j * NA, j * NA + NA)); if (row.every(Number.isNaN)) continue; for (let k = 0; k < NA; k++) if (Number.isNaN(row[k])) { let d = 1; while (Number.isNaN(row[(k + d) % NA]) && Number.isNaN(row[(k - d + NA) % NA])) d++; const a = row[(k + d) % NA], b = row[(k - d + NA) % NA]; R[j * NA + k] = Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a, b); } }
    for (let j = 0; j < NY; j++) if (Number.isNaN(R[j * NA])) { let d = 1; while (j - d >= 0 && Number.isNaN(R[(j - d) * NA]) && (j + d >= NY || Number.isNaN(R[(j + d) * NA]))) d++; const src = j - d >= 0 && !Number.isNaN(R[(j - d) * NA]) ? j - d : j + d; if (src >= 0 && src < NY) R.copyWithin(j * NA, src * NA, src * NA + NA); }
    const at = (j, k) => R[Math.max(0, Math.min(NY - 1, j)) * NA + ((k % NA) + NA) % NA];
    const D = new Float32Array(NY * NA), S2 = new Float32Array(NY * NA);
    for (let j = 0; j < NY; j++) for (let k = 0; k < NA; k++) { let m = -Infinity; for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) m = Math.max(m, at(j + dj, k + dk)); D[j * NA + k] = m; }
    const atD = (j, k) => D[Math.max(0, Math.min(NY - 1, j)) * NA + ((k % NA) + NA) % NA];
    for (let j = 0; j < NY; j++) for (let k = 0; k < NA; k++) { let a = 0, w = 0; for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) { const g2 = (2 - Math.abs(dj)) * (2 - Math.abs(dk)); a += g2 * atD(j + dj, k + dk); w += g2; } S2[j * NA + k] = a / w; }
    polar[s] = {origin, at: (y, ux, uz) => {
      const fj = Math.max(0, Math.min(NY - 1.001, (y - y0) / YS)), j = Math.floor(fj), tj = fj - j;
      let th = Math.atan2(ux, uz); if (th < 0) th += 2 * Math.PI;
      const fk = th / (2 * Math.PI) * NA, k = Math.floor(fk), tk = fk - k;
      const v = (jj, kk) => S2[Math.min(NY - 1, jj) * NA + (kk % NA)];
      return (v(j, k) * (1 - tk) + v(j, k + 1) * tk) * (1 - tj) + (v(j + 1, k) * (1 - tk) + v(j + 1, k + 1) * tk) * tj;
    }};
  }
  const Lmap = (p, s, i) => {
    const L = legs[s], cg = L.centre(p[1]), dg = L.tangent(p[1]);
    // axial: garment hip height -> the body hip joint, garment ankle line -> the body ankle (arc length along hip -> knee -> ankle)
    const a = (L.yTop - p[1]) / (L.yTop - L.yAnk) * L.leg.total;
    const {p: c, dir} = along(L.leg, a);
    const rr0 = sub(p, cg), rr = sub(rr0, mul(dg, dot(rr0, dg)));
    const r1 = rot(rotBetween(dg, dir), rr);
    if (!tight) return add(c, mul(r1, sr));
    const h = Math.hypot(r1[0], r1[2]);
    if (h < 1e-6) return add(c, mul(r1, sr));
    const ux = r1[0] / h, uz = r1[2] / h, yb = c[1] + r1[1], o = polar[s].origin(yb);
    const rad = polar[s].at(yb, ux, uz) + opts.tightOffset + 0.006 + reliefOf[i] * sr;
    return [o[0] + ux * rad, yb, o[2] + uz * rad];
  };
  const shoe = {};
  for (const s of ['L', 'R']) {
    const S = GA.side[s], F = C.foot[s], m = opts.shoeMargin;
    const sv = (F.ankle[1] - C.floorY) / (S.ankle[1] - S.sole);
    const sf = (F.length + 2 * m) / (S.toe - S.heel);
    const sw = (F.width + 2 * m) / S.footWidth;
    shoe[s] = {S, F, sv, sf, sw};
    report['shoe' + s] = {vertical: r4(sv), length: r4(sf), width: r4(sw), bodyFootLength: r4(F.length), bodyFootWidth: r4(F.width), yawDeg: r4(F.yaw * 180 / Math.PI)};
  }
  const Fmap = (p, s) => {
    const {S, F, sv, sf, sw} = shoe[s];
    // garment shoe box -> body foot box (heel to heel, sole to floor), then turned by the body foot's yaw about its ankle
    const x = F.xMid + (p[0] - S.footMidX) * sw, y = C.floorY + (p[1] - S.sole) * sv, z = (F.heel[2] - opts.shoeMargin) + (p[2] - S.heel) * sf;
    const c = Math.cos(F.yaw), sn = Math.sin(F.yaw), ox = F.ankle[0], oz = F.ankle[2];
    return [ox + (x - ox) * c + (z - oz) * sn, y, oz - (x - ox) * sn + (z - oz) * c];
  };
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], ls = GA.legSide[i], wl = GA.wl[i];
    if (!ls || wl <= 0) { out.set(W(p), i * 3); part[i] = 'waist'; continue; }
    const s = ls > 0 ? 'L' : 'R', S = GA.side[s];
    const top = cfg.shoeTop != null ? S.sole + cfg.shoeTop : S.ankle[1];
    const wsh = ss(top + 0.012, top - 0.018, p[1]);
    let q = wsh >= 1 ? Fmap(p, s) : wsh > 0 ? add(mul(Lmap(p, s, i), 1 - wsh), mul(Fmap(p, s), wsh)) : Lmap(p, s, i);
    if (wl < 1) q = add(mul(W(p), 1 - wl), mul(q, wl));
    out.set(q, i * 3);
    part[i] = wsh > 0.5 ? 'shoe' + s : wl > 0.5 ? 'leg' + s : 'waist';
  }
  Object.assign(report, {sx: r4(sx), sz: r4(sz), legRadialScale: r4(sr), waistTargetY: r4(waistB), garmentWaistTop: r4(GA.waistTop), garmentCrotch: GA.crotch == null ? null : r4(GA.crotch)});
  return {pos: out, part, report};
}

/** Arc length along the arm chain for a position in "arm units": 0 shoulder, 1 elbow, 2 wrist, 3 hand tip (fractions interpolate). */
function armArc(arm, u) {
  const k = Math.min(2, Math.max(0, Math.floor(u))), f = u - k;
  return arm.cum[k] + f * (arm.cum[k + 1] - arm.cum[k]);
}

/** Body leg cross-section at height y, per side: {cx, cz (centre), a (half width), b (half depth)} over +-1 cm, or null. */
function legSectionFn(B) {
  const C = B.costume, P = B.pos, n = P.length / 3, YS = 0.01, cache = {};
  for (const [s, R1, R2] of [['L', REG.legL, REG.footL], ['R', REG.legR, REG.footR]]) {
    const bins = new Map();
    for (let v = 0; v < n; v++) {
      if (!C.innerVert[v] || (C.region[v] !== R1 && C.region[v] !== R2)) continue;
      const j = Math.round(P[v * 3 + 1] / YS), b = bins.get(j) ?? bins.set(j, {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity}).get(j);
      b.x0 = Math.min(b.x0, P[v * 3]); b.x1 = Math.max(b.x1, P[v * 3]); b.z0 = Math.min(b.z0, P[v * 3 + 2]); b.z1 = Math.max(b.z1, P[v * 3 + 2]);
    }
    cache[s] = bins;
  }
  return (s, y) => {
    const j = Math.round(y / YS); let cx = 0, cz = 0, a = 0, b = 0, w = 0;
    for (let d = -1; d <= 1; d++) { const q = cache[s].get(j + d); if (!q) continue; cx += (q.x0 + q.x1) / 2; cz += (q.z0 + q.z1) / 2; a += (q.x1 - q.x0) / 2; b += (q.z1 - q.z0) / 2; w++; }
    return w ? {cx: cx / w, cz: cz / w, a: a / w, b: b / w} : null;
  };
}
/**
 * Interior caps: Meshy closes a garment's openings and reconstructs hidden undersides as surfaces ACROSS the tube (a lid over the
 * waistband, a skirt's underside floor spanning between the legs, a closed cuff). Mapped onto a body they lie deep inside it and no
 * clearance can lift them out. A triangle is such a cap when, mapped onto this body, all three vertices lie inside the closed skin
 * (ray parity) by >= `depth`, and its garment-frame normal is within 50 deg of its part's tube axis (vertical for the torso / waist,
 * the garment sleeve / leg axis otherwise): real cloth walls run along the tube, caps across it. Shoes are never capped (an insole
 * lies inside the hidden foot). Returns a Uint8Array over the garment triangles.
 */
export function interiorCaps(B, G, GA, cfg, opts = COSTUME_FIT, depth = 0.01) {
  const M = mapGarment(B, G, GA, cfg, opts), P = G.pos, Q = M.pos, idx = G.idx, nt = idx.length / 3, out = new Uint8Array(nt);
  const closed = B.skinGrid, inside = new Map();
  // depth of a mapped point inside the closed skin (0 outside)
  const depthAt = (x, y, z) => { const c = closed.closest(x, y, z, 0.3); return c && insideByParity(closed, x, y, z) ? c.d : 0; };
  const vDepth = v => { if (!inside.has(v)) inside.set(v, depthAt(Q[v * 3], Q[v * 3 + 1], Q[v * 3 + 2])); return inside.get(v); };
  const deep = v => vDepth(v) >= depth;
  const axisOf = (pn, v) => {
    if (pn.startsWith('sleeve')) return GA.side?.[pn.slice(6)]?.axis.d ?? [0, 1, 0];
    return [0, 1, 0];
  };
  // garment-frame interior: a vertex well inside its own tube (radial distance < 45 % of the tube's median radius at that height /
  // along that sleeve): a reconstructed inner surface (a stocking's filled-in leg, a sleeve's lining spike), never the cloth itself
  const interior = tubeInterior(G, GA, M.part);
  let bridges = 0, chords = 0;
  let n = 0;
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (M.part[a].startsWith('shoe') || M.part[b].startsWith('shoe') || M.part[c].startsWith('shoe')) continue;
    const f = nrmz(cross(sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]]), sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]])));
    // a skirt's lining stitched to the legwear tops under it (Meshy welds them): its triangles would be torn between the skirt's and
    // the leg's mapping into sheets through the thighs; hidden under the skirt, dropped
    const legs = [a, b, c].filter(v => M.part[v].startsWith('leg')).length;
    if (GA.skirtHem != null && legs > 0 && legs < 3) { out[t] = 1; n++; bridges++; continue; }
    // a CHORD: a long triangle cutting through the body (simplified across a thin tube, or stretched across a cap): its centroid lies
    // >= 1.5 x depth inside while it dips >= 1 cm deeper than its deepest vertex (a cloth panel merely sunk into the skin keeps its
    // centroid as deep as its corners and is lifted by the clearance field instead)
    const cd = depthAt((Q[a * 3] + Q[b * 3] + Q[c * 3]) / 3, (Q[a * 3 + 1] + Q[b * 3 + 1] + Q[c * 3 + 1]) / 3, (Q[a * 3 + 2] + Q[b * 3 + 2] + Q[c * 3 + 2]) / 3);
    if (cd >= 1.5 * depth && cd > Math.max(vDepth(a), vDepth(b), vDepth(c)) + 0.01) { out[t] = 1; n++; chords++; continue; }
    if (Math.abs(dot(f, axisOf(M.part[a], a))) < Math.cos(50 * Math.PI / 180) && !(interior[a] === 1 && interior[b] === 1 && interior[c] === 1)) continue;
    // all three vertices deep, or (a coarse cap spanning the opening from rim to rim) its centroid 1.5 x deeper
    const floor = interior[a] === 2 && interior[b] === 2 && interior[c] === 2;
    if (floor || (deep(a) && deep(b) && deep(c)) || cd >= 1.5 * depth) { out[t] = 1; n++; }
  }
  return {drop: out, count: n, bridges, chords};
}

/** Per garment vertex: inside its own tube by more than 55 % of the tube's median radius (see interiorCaps). */
function tubeInterior(G, GA, part) {
  const P = G.pos, n = P.length / 3, out = new Uint8Array(n);
  const key = i => {
    const p = part[i];
    if (p.startsWith('sleeve')) { const S = GA.side[p.slice(6)]; const t = dot(sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], S.axis.o), S.axis.d); return [p + ':' + Math.round(t / 0.015), () => len(sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], add(S.axis.o, mul(S.axis.d, t))))]; }
    return [p + ':' + Math.round(P[i * 3 + 1] / 0.015), null];
  };
  // per bin: centre (x, z) for the vertical tubes, then radial distances
  const bins = new Map();
  for (let i = 0; i < n; i++) { const [k] = key(i); const b = bins.get(k) ?? bins.set(k, {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, r: []}).get(k); b.x0 = Math.min(b.x0, P[i * 3]); b.x1 = Math.max(b.x1, P[i * 3]); b.z0 = Math.min(b.z0, P[i * 3 + 2]); b.z1 = Math.max(b.z1, P[i * 3 + 2]); }
  const rad = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [k, f] = key(i), b = bins.get(k);
    // vertical tubes: elliptical radius about the bin's box centre, normalised by its half extents (1 = on the box)
    rad[i] = f ? f() : Math.hypot((P[i * 3] - (b.x0 + b.x1) / 2) / Math.max(1e-4, (b.x1 - b.x0) / 2), (P[i * 3 + 2] - (b.z0 + b.z1) / 2) / Math.max(1e-4, (b.z1 - b.z0) / 2));
    b.r.push(rad[i]);
  }
  const med = new Map([...bins].map(([k, b]) => [k, quantile(b.r, 0.5)]));
  for (let i = 0; i < n; i++) {
    const [k] = key(i);
    if (part[i] === 'torso') continue;
    // a skirt's waist part: its UNDERSIDE (Meshy closes the hem with a floor across the opening, between the legs): within 70 % of the
    // skirt's own section box below the hips (2 = such a floor vertex, dropped whatever the body)
    if (part[i] === 'waist') { if (GA.skirtHem != null && P[i * 3 + 1] < GA.waistTop - 0.12 && rad[i] < 0.7) out[i] = 2; continue; }
    if (rad[i] < 0.45 * med.get(k)) out[i] = 1;
  }
  return out;
}

/** A garment with the flagged triangles removed (vertices compacted in first-use order; srcIndex kept relative to the input). */
export function dropTriangles(G, drop) {
  const keep = []; for (let t = 0; t < G.idx.length / 3; t++) if (!drop[t]) keep.push(G.idx[t * 3], G.idx[t * 3 + 1], G.idx[t * 3 + 2]);
  const map = new Map(), src = [], I = new Uint32Array(keep.length);
  keep.forEach((v, k) => { let m = map.get(v); if (m === undefined) { m = src.length; map.set(v, m); src.push(v); } I[k] = m; });
  const pick = (A, d) => { const o = new Float32Array(src.length * d); src.forEach((v, i) => { for (let k = 0; k < d; k++) o[i * d + k] = A[v * d + k]; }); return o; };
  return {...G, pos: pick(G.pos, 3), nrm: pick(G.nrm, 3), uv: pick(G.uv, 2), idx: I, srcIndex: G.srcIndex ? Uint32Array.from(src, v => G.srcIndex[v]) : Uint32Array.from(src), triangles: I.length / 3, vertices: src.length};
}

/**
 * Rigid shoe enclosure: the mapped shoes (heel / toe / width / sole boxes) are scaled up about the body foot's heel-floor point until
 * the body's own foot (shoe / sock / bare foot) is inside: every foot vertex below the shoe's top opening (- 1 cm) has its outward normal
 * ray meet the shoe within 8 cm (k = 1.00 .. 1.30 in 2.5 % steps; the first k with <= 1 % of them outside wins). Mutates M.pos.
 */
function encloseFeet(B, M, idx) {
  const C = B.costume, P = B.pos, N = B.nrm, Q = M.pos, out = {};
  for (const [s, R, RL] of [['L', REG.footL, REG.legL], ['R', REG.footR, REG.legR]]) {
    const ids = []; for (let i = 0; i < M.part.length; i++) if (M.part[i] === 'shoe' + s) ids.push(i);
    if (!ids.length) continue;
    const tri = []; for (let t = 0; t < idx.length; t += 3) if (M.part[idx[t]] === 'shoe' + s || M.part[idx[t + 1]] === 'shoe' + s || M.part[idx[t + 2]] === 'shoe' + s) tri.push(idx[t], idx[t + 1], idx[t + 2]);
    let top = -Infinity; for (const i of ids) top = Math.max(top, Q[i * 3 + 1]);
    // the body's own foot (shoe / sock / bare) and the shin inside a boot shaft, below its opening - 2 cm, outer hull only
    const foot = []; for (let v = 0; v < P.length / 3; v++) if (C.region[v] === R && C.innerVert[v] && C.hull[v] && B.remap[v] === v && P[v * 3 + 1] < top - 0.02 && N[v * 3 + 1] > -0.5) foot.push(v);
    const F = C.foot[s], piv = [F.xMid, C.floorY, (F.heel[2] + F.toe[2]) / 2];
    const orig = ids.map(i => [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]);
    const outsideAt = (k, ky) => {
      ids.forEach((i, j) => { Q[i * 3] = piv[0] + (orig[j][0] - piv[0]) * k; Q[i * 3 + 1] = piv[1] + (orig[j][1] - piv[1]) * k * ky; Q[i * 3 + 2] = piv[2] + (orig[j][2] - piv[2]) * k; });
      const g = new TriGrid(Q, Uint32Array.from(tri), 0.02);
      let o = 0;
      for (const v of foot) if (!g.ray(P[v * 3] - N[v * 3] * 0.002, P[v * 3 + 1] - N[v * 3 + 1] * 0.002, P[v * 3 + 2] - N[v * 3 + 2] * 0.002, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], 0.08)) o++;
      return o;
    };
    // cheapest first: (k - 1) x 2 + (ky - 1); k in 1 .. 1.25, ky in 1 .. 1.6
    const cands = [];
    for (let k = 1; k <= 1.1001; k += 0.025) cands.push([+k.toFixed(3), 1]);
    cands.sort((a, b) => (2 * (a[0] - 1) + (a[1] - 1)) - (2 * (b[0] - 1) + (b[1] - 1)) || a[0] - b[0]);
    let chosen = null, best = null;
    for (const [k, ky] of cands) {
      const o = outsideAt(k, ky);
      if (!best || o < best.outside) best = {scale: k, heightScale: ky, outside: o};
      if (o <= Math.max(2, 0.02 * foot.length)) { chosen = {scale: k, heightScale: ky, outside: o}; break; }
    }
    chosen ??= best;
    outsideAt(chosen.scale, chosen.heightScale);
    out[s] = {...chosen, enclosedVertices: foot.length, enclosed: chosen.outside <= Math.max(2, 0.02 * foot.length)};
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------ inner surface
/**
 * The inner surface the cloth is fitted against: the body's inner triangles (+ an already fitted lower piece for an upper). Arrays are
 * concatenated: vertices [0, nb) are the body's, [nb, nb + nl) the layer's. Each vertex has a bind normal (body: welded skin normal;
 * layer: its anchor's skin normal = the direction it was pushed out along), joints / weights (float), a welded representative and a
 * 1-ring (field diffusion).
 */
export function innerSurface(B, layer = null) {
  const C = B.costume, nb = B.pos.length / 3;
  if (!layer) return {pos: B.pos, idx: C.innerIdx, nrm: C.nrm, joints: B.joints, weights: B.weights, remap: B.remap, ring: C.adjacency, nb, nl: 0, isBody: true};
  const nl = layer.pos.length / 3, N = nb + nl;
  const pos = new Float32Array(N * 3); pos.set(B.pos); pos.set(layer.pos, nb * 3);
  const nrm = new Float32Array(N * 3); nrm.set(C.nrm); nrm.set(layer.anchorNrm, nb * 3);
  const joints = new Uint8Array(N * 4); joints.set(B.joints); joints.set(layer.joints, nb * 4);
  const weights = new Float32Array(N * 4); weights.set(B.weights); weights.set(layer.weights, nb * 4);
  const idx = new Uint32Array(C.innerIdx.length + layer.idx.length); idx.set(C.innerIdx); for (let k = 0; k < layer.idx.length; k++) idx[C.innerIdx.length + k] = layer.idx[k] + nb;
  const remap = new Uint32Array(N); remap.set(B.remap); const lw = weldMap(layer.pos).remap; for (let i = 0; i < nl; i++) remap[nb + i] = lw[i] + nb;
  const ring = new Map(C.adjacency);
  for (let t = 0; t < layer.idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = remap[nb + layer.idx[t + k]], b = remap[nb + layer.idx[t + (k + 1) % 3]]; if (a === b) continue;
    const ra = ring.get(a), rb = ring.get(b);
    ring.set(a, ra instanceof Set ? ra.add(b) : new Set([...(ra ?? []), b])); ring.set(b, rb instanceof Set ? rb.add(a) : new Set([...(rb ?? []), a]));
  }
  for (const [k, v] of ring) if (v instanceof Set) ring.set(k, Uint32Array.from([...v].sort((x, y) => x - y)));
  const layerIdx = Uint32Array.from(layer.idx, v => v + nb);
  const I = {pos, idx, nrm, joints, weights, remap, ring, nb, nl, layerIdx, isBody: false};
  // the layer's own skin anchors (a bulky lower stands far off the skin the upper's cloth may be anchored on)
  if (layer.anchorPos) { I.apos = new Float32Array(N * 3); I.apos.set(B.pos); I.apos.set(layer.anchorPos, nb * 3); }
  // orientation of the layer's geometric normals vs the direction it was pushed out along (fixed once: posed normals keep it)
  const g = layerGeomNormals(I, layer.pos);
  I.layerSign = new Int8Array(nl);
  for (let i = 0; i < nl; i++) I.layerSign[i] = g[i * 3] * layer.anchorNrm[i * 3] + g[i * 3 + 1] * layer.anchorNrm[i * 3 + 1] + g[i * 3 + 2] * layer.anchorNrm[i * 3 + 2] < 0 ? -1 : 1;
  return I;
}

/** Region predicate (on inner vertices) for a garment part. */
function partPredicate(B, I, partName, kind) {
  const R = B.costume.region, P = I.pos, nb = I.nb, apY = Math.min(B.costume.armpit.L.y, B.costume.armpit.R.y);
  const isLayer = v => v >= nb;
  switch (partName) {
    case 'torso': return v => isLayer(v) || R[v] === REG.torso || R[v] === REG.head || ((R[v] === REG.legL || R[v] === REG.legR) && kind === 'upper');
    case 'sleeveL': return v => !isLayer(v) && (R[v] === REG.armL || R[v] === REG.handL || (R[v] === REG.torso && P[v * 3 + 1] > apY - 0.01 && P[v * 3] > 0));
    case 'sleeveR': return v => !isLayer(v) && (R[v] === REG.armR || R[v] === REG.handR || (R[v] === REG.torso && P[v * 3 + 1] > apY - 0.01 && P[v * 3] < 0));
    case 'waist': return v => R[v] === REG.torso || R[v] === REG.legL || R[v] === REG.legR;
    case 'legL': return v => R[v] === REG.legL || R[v] === REG.footL;
    case 'legR': return v => R[v] === REG.legR || R[v] === REG.footR;
    case 'shoeL': return v => R[v] === REG.footL || R[v] === REG.legL;
    case 'shoeR': return v => R[v] === REG.footR || R[v] === REG.legR;
    default: throw new Error('part ' + partName);
  }
}

/** Region-restricted closest inner point (anchor) of every garment vertex. */
function anchorsOf(B, I, pos, part, kind) {
  const n = pos.length / 3, verts = new Uint32Array(n * 3), bw = new Float32Array(n * 3), q = new Float32Array(n * 3), nr = new Float32Array(n * 3), dist = new Float32Array(n);
  const grids = new Map(), all = {idx: I.idx, grid: new TriGrid(I.pos, I.idx, 0.03)};
  const gridOf = pn => {
    if (grids.has(pn)) return grids.get(pn);
    const pred = partPredicate(B, I, pn, kind), keep = [], H = B.costume.hull;
    for (let t = 0; t < I.idx.length; t += 3) { let k = 0, h = 0; for (let c = 0; c < 3; c++) { const v = I.idx[t + c]; if (pred(v)) k++; if (v >= I.nb || H[v]) h++; } if (k >= 2 && h >= 2) keep.push(I.idx[t], I.idx[t + 1], I.idx[t + 2]); }
    const idx = Uint32Array.from(keep), g = {idx, grid: new TriGrid(I.pos, idx, 0.03)};
    grids.set(pn, g); return g;
  };
  let fallback = 0;
  for (let i = 0; i < n; i++) {
    const g = gridOf(part[i]);
    let c = g.idx.length ? g.grid.closest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0.5) : null, idx = g.idx;
    if (!c) { c = all.grid.closest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 1.0); idx = all.idx; fallback++; }
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { const v = idx[c.tri * 3 + k]; verts[i * 3 + k] = v; bw[i * 3 + k] = c.q[3 + k]; q[i * 3 + k] = c.q[k]; nx += I.nrm[v * 3] * c.q[3 + k]; ny += I.nrm[v * 3 + 1] * c.q[3 + k]; nz += I.nrm[v * 3 + 2] * c.q[3 + k]; }
    const l = Math.hypot(nx, ny, nz) || 1; nr[i * 3] = nx / l; nr[i * 3 + 1] = ny / l; nr[i * 3 + 2] = nz / l;
    dist[i] = c.d;
  }
  return {verts, bw, q, n: nr, dist, fallback};
}

/** Cloth weights from the anchors (dense rows over the 18 joints), the collar / skirt rules, masked smoothing, top-4. */
function anchorWeights(B, I, A, pos, idx, part, kind, opts, cfg = {}) {
  const names = B.names, NJ = names.length, JI = Object.fromEntries(names.map((nm, j) => [nm, j]));
  const n = pos.length / 3, Wd = new Float32Array(n * NJ), crY = B.costume.crotch[1];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = A.verts[i * 3 + k], w0 = A.bw[i * 3 + k]; if (!w0) continue;
    for (let s = 0; s < 4; s++) { const w = I.weights[v * 4 + s]; if (w) Wd[i * NJ + I.joints[v * 4 + s]] += w0 * w; }
  }
  let skirt = 0;
  const sc = opts.weights.skirtCentre;
  for (let i = 0; i < n; i++) {
    const row = Wd.subarray(i * NJ, i * NJ + NJ);
    row[JI.Neck] += row[JI.Head]; row[JI.Head] = 0;
    const y = pos[i * 3 + 1], x = pos[i * 3];
    if (kind === 'lower') for (const j of ['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand']) row[JI[j]] = 0;
    // skirts / hems below the crotch (+6 cm): follow the thighs; the centre line splits evenly between both thighs (lib/fit07.mjs)
    if ((part[i] === 'torso' || part[i] === 'waist') && y < crY + 0.06) {
      skirt++;
      for (const s of ['L', 'R']) { row[JI[s + '_Thigh']] += row[JI[s + '_Shin']] + row[JI[s + '_Foot']]; row[JI[s + '_Shin']] = 0; row[JI[s + '_Foot']] = 0; }
      const T = row[JI.L_Thigh] + row[JI.R_Thigh];
      const g = (1 - ss(0.03, sc + 0.04, Math.abs(x))) * ss(crY + 0.06, crY - 0.02, y), tL = ss(-sc, sc, x);
      row[JI.L_Thigh] = (1 - g) * row[JI.L_Thigh] + g * T * tL;
      row[JI.R_Thigh] = (1 - g) * row[JI.R_Thigh] + g * T * (1 - tL);
      // a SKIRT over an unclothed body must keep covering it: its lower part follows the thighs only partly and the hips for the rest
      // (cfg.skirtHips; the stride then pushes the skirt out - the pose rounds flare it - instead of lifting it off the groin)
      if (cfg.skirtHips && part[i] === 'waist') {
        const h = cfg.skirtHips * ss(crY + 0.06, crY - 0.03, y);
        for (let j = 0; j < NJ; j++) row[j] *= 1 - h;
        row[JI.Hips] += h;
      }
    }
    let s = 0; for (let j = 0; j < NJ; j++) s += row[j];
    if (s > 0) for (let j = 0; j < NJ; j++) row[j] /= s; else row[JI.Hips] = 1;
  }
  // masked smoothing over the welded cloth graph (a joint never spreads where no neighbour has it)
  const G = clothGraph({pos, idx});
  for (let it = 0; it < opts.weights.smoothIters; it++) {
    const Wn = Wd.slice();
    for (const i of G.uniq) {
      const nb = G.nb.get(i); if (!nb.length) continue;
      for (let j = 0; j < NJ; j++) { let a = 0; for (const k of nb) a += Wd[k * NJ + j]; Wn[i * NJ + j] = (1 - opts.weights.lambda) * Wd[i * NJ + j] + opts.weights.lambda * a / nb.length; }
      let s = 0; for (let j = 0; j < NJ; j++) s += Wn[i * NJ + j];
      for (let j = 0; j < NJ; j++) Wn[i * NJ + j] /= s || 1;
    }
    for (let i = 0; i < n; i++) { const r = G.remap[i]; if (r !== i) for (let j = 0; j < NJ; j++) Wn[i * NJ + j] = Wn[r * NJ + j]; }
    Wd.set(Wn);
  }
  const joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const row = []; for (let j = 0; j < NJ; j++) if (Wd[i * NJ + j] > 1e-4) row.push([Wd[i * NJ + j], j]);
    row.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const top = row.slice(0, 4), s = top.reduce((a, e) => a + e[0], 0) || 1;
    top.forEach(([w, j], k) => { joints[i * 4 + k] = j; weights[i * 4 + k] = w / s; });
  }
  return {joints, weights, skirtVertices: skirt};
}

/** Max-preserving diffusion of a field over the inner surface's welded 1-ring. */
function diffuse(I, e, iters = 4, k = 0.85) {
  // fold seam duplicates onto their welded representative first (a raise on either copy counts)
  let cur = e.slice();
  for (let i = 0; i < cur.length; i++) { const r = I.remap[i]; if (r !== i && cur[i] > cur[r]) cur[r] = cur[i]; }
  for (let it = 0; it < iters; it++) {
    const nx = cur.slice();
    for (const [v, nb] of I.ring) { if (!nb.length) continue; let a = 0; for (const u of nb) a += cur[u]; nx[v] = Math.max(cur[v], k * a / nb.length); }
    cur = nx;
  }
  for (let i = 0; i < cur.length; i++) cur[i] = cur[I.remap[i]];
  return cur;
}

/**
 * Coverage / clearance deficits of the cloth over inner vertices (lib/fit07.mjs deficits): for each eligible inner vertex (`covered`
 * given: only those) the cloth must lie >= minClear outside it along its normal; when it lies UNDER it (an inward ray meets the cloth
 * within the inner surface's own half thickness), the deficit is its depth + minClear. Only cloth anchored near that vertex counts.
 */
function deficits(inner, cloth, minClear, {covered = null, coverDist, outDist = 0.12, maxDepth = 0.06, eligible = null, near = null, track = null, allow = null} = {}) {
  const og = new TriGrid(cloth.pos, cloth.idx, 0.03), ig = inner.grid ?? new TriGrid(inner.pos, inner.idx, 0.03);
  const P = inner.pos, N = inner.nrm, nv = P.length / 3;
  const def = new Float32Array(nv), hitTri = new Int32Array(nv).fill(-1), cov = covered ?? new Uint8Array(nv);
  let nCov = 0, poke = 0, close = 0, exposed = 0;
  for (let i = 0; i < nv; i++) {
    if (eligible && !eligible[i]) continue;
    if (covered && !covered[i]) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    if (!(nx || ny || nz)) continue;
    let d = 0, tri = -1;
    const skip = allow ? t => !allow(i, t) : null;
    const out = og.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, nx, ny, nz, covered ? outDist : coverDist, 0, skip);
    if (out) { if (!covered) cov[i] = 1; if (out.t < minClear) { d = minClear - out.t; tri = out.tri; close++; } }
    else {
      // the inner surface's own thickness behind the vertex: for a layer vertex the BODY under it (a thin bow / frill on the lower has
      // its other wall millimetres behind: the upper sunk under it would never be seen)
      const back = (inner.bodyGrid && i >= inner.nb ? inner.bodyGrid : ig).ray(x - nx * 0.001, y - ny * 0.001, z - nz * 0.001, -nx, -ny, -nz, 0.4, 0.004);
      const lim = Math.min(maxDepth, 0.45 * (back ? back.t : 0.4));
      const u = og.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, lim, 0.0002, skip);
      if (u) { if (!covered) cov[i] = 1; d = u.t + minClear; tri = u.tri; poke++; if (track) track.poke[i] = 1; }
      else if (covered) { exposed++; if (track) track.exposed[i] = 1; }
    }
    if (cov[i]) nCov++;
    if (tri >= 0 && (!near || near(i, tri))) { def[i] = d; hitTri[i] = tri; }
  }
  return {def, hitTri, covered: cov, stats: {covered: nCov, poke, close, exposed}};
}

/**
 * The full fit of one piece on one body. G = simplified garment (garment frame: pos, nrm, uv, idx), GA = analyseGarment(G), cfg =
 * the piece's tailoring config, layer = the fitted lower (for an upper) {pos, idx, joints, weights, anchorNrm} or null.
 * Returns {pos, nrm, joints, weights, part, anchorNrm, mask, hideLayer, report}.
 */
export function fitPiece(B, G, GA, cfg, layer = null, opts = COSTUME_FIT) {
  const t0 = Date.now(), kind = GA.kind;
  const M = mapGarment(B, G, GA, cfg, opts);
  const shoeFit = kind === 'lower' ? encloseFeet(B, M, G.idx) : null;
  const I = innerSurface(B, layer);
  const base = M.pos, n = base.length / 3, idx = G.idx;
  const A = anchorsOf(B, I, base, M.part, kind);
  const Wt = anchorWeights(B, I, A, base, idx, M.part, kind, opts, cfg);
  const nI = I.pos.length / 3;
  const BP = I.pos, BN = I.nrm;
  const clear = opts.clear[kind], minClear = opts.minClear[kind];
  // a cloth triangle counts against inner vertex i only when ALL its corners are anchored within nearM of i (a triangle spanning a limb -
  // anchored on opposite sides - is a chord no outward lift can clear: never chased); a layer vertex also by its own skin anchor (cloth
  // anchored on the skin under a bulky lower)
  const AP = I.apos;
  const nearInner = (i, tri) => {
    for (let c = 0; c < 3; c++) {
      const g = idx[tri * 3 + c];
      if (Math.hypot(A.q[g * 3] - BP[i * 3], A.q[g * 3 + 1] - BP[i * 3 + 1], A.q[g * 3 + 2] - BP[i * 3 + 2]) < opts.nearM) continue;
      if (AP && i >= I.nb && Math.hypot(A.q[g * 3] - AP[i * 3], A.q[g * 3 + 1] - AP[i * 3 + 1], A.q[g * 3 + 2] - AP[i * 3 + 2]) < opts.nearM) continue;
      return false;
    }
    return true;
  };
  // eligible inner vertices: the body's inner surface (+ the layer's outer face); the head only under a hood-like part
  const eligible = new Uint8Array(nI);
  for (const v of I.idx) eligible[v] = v >= I.nb || B.costume.hull[v] ? 1 : 0;
  for (let v = 0; v < I.nb; v++) {
    const r = B.costume.region[v];
    // feet: inside the rigid shoes (encloseFeet) for a lower, never an upper's; a lower never fits the head / arms
    if (r === REG.footL || r === REG.footR) eligible[v] = 0;
    if (kind === 'lower' && (r === REG.head || r === REG.armL || r === REG.armR || r === REG.handL || r === REG.handR)) eligible[v] = 0;
  }
  const innerBind = {pos: BP, nrm: BN, idx: I.idx};
  innerBind.grid = new TriGrid(BP, I.idx, 0.03);
  const nBodyIdx = I.idx.length - (I.layerIdx?.length ?? 0);
  if (!I.isBody) { innerBind.nb = I.nb; innerBind.bodyGrid = new TriGrid(BP, I.idx.subarray(0, nBodyIdx), 0.03); }
  const allow = partAllowance(B, I, M.part, idx);
  // ---- the offset field
  const eBind = new Float32Array(nI), eExtra = new Float32Array(nI), frozen = new Uint8Array(nI), raised = new Uint8Array(nI);
  let eS = new Float32Array(nI);
  const refresh = () => { const e = new Float32Array(nI); for (let i = 0; i < nI; i++) e[i] = eBind[i] + eExtra[i]; eS = diffuse(I, e); };
  // cloth-side smoothing of the field (no lone vertex is lifted: the cloth round it rises with it; max-preserving dilation over 1.5 cm
  // of SPATIAL neighbours - both walls of a thick garment - then one averaging pass); shoes are rigid (no field)
  const Gc = clothGraph({pos: base, idx}), NBc = spatialNeighbours(Gc, base, 0.015);
  // shoes: rigid below the ankle line (encloseFeet sized them; the hidden foot is inside), a boot shaft above it may be lifted
  const gain = Float32Array.from(M.part, (p, i) => {
    if (!p.startsWith('shoe') || kind !== 'lower') return 1;
    const S = GA.side[p.slice(4)];
    return ss(S.ankle[1] - 0.005, S.ankle[1] + 0.02, G.pos[i * 3 + 1]);
  });
  const posOf = () => {
    const e = new Float32Array(n);
    for (const i of Gc.uniq) { let v = 0; for (let k = 0; k < 3; k++) v += A.bw[i * 3 + k] * eS[A.verts[i * 3 + k]]; e[i] = v * gain[i]; }
    const d = new Float32Array(n);
    for (const i of Gc.uniq) { const {ids, ds} = NBc.get(i); let m = e[i]; for (let q = 0; q < ids.length; q++) { const v = e[ids[q]] * (1 - ds[q] / 0.015); if (v > m) m = v; } d[i] = m * (gain[i] > 0 ? 1 : 0); }
    const f = new Float32Array(n);
    for (const i of Gc.uniq) { const nb = Gc.nb.get(i); let a = 0; for (const j of nb) a += d[j]; f[i] = nb.length ? Math.max(e[i], 0.5 * d[i] + 0.5 * a / nb.length) : d[i]; }
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = f[Gc.remap[i]]; for (let k = 0; k < 3; k++) p[i * 3 + k] = base[i * 3 + k] + A.n[Gc.remap[i] * 3 + k] * v; }
    return p;
  };
  const raise = (field, v, d, cap) => { if (d > 0 && !frozen[v]) field[v] = Math.min(cap, Math.max(field[v], d)); };
  // a contact the cloth cannot clear by moving along its anchor normals (their mean against the inner vertex's normal: cos < 0.3) is
  // reported, not chased (lib/fit07.mjs: chasing it over-inflates)
  const triDir = (tri, i) => { let x = 0, y = 0, z = 0; for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; x += A.n[g * 3]; y += A.n[g * 3 + 1]; z += A.n[g * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; return (x * BN[i * 3] + y * BN[i * 3 + 1] + z * BN[i * 3 + 2]) / l; };
  let skew = 0;
  const raiseTri = (field, tri, d, cap, i, minCos = opts.minDirCos) => { if (i !== undefined && triDir(tri, i) < minCos) { skew++; return; } for (let c = 0; c < 3; c++) { const g = idx[tri * 3 + c]; if (!gain[g]) continue; for (let k = 0; k < 3; k++) if (A.bw[g * 3 + k] > 0.15) raise(field, A.verts[g * 3 + k], d, cap); } };
  const bindLog = [];
  for (let r = 0; r < opts.bindRounds; r++) {
    // (a) every cloth vertex >= clear outside its own anchor (exact: the need is applied before the between-vertex test sees it)
    let pos = posOf();
    const reqA = new Float32Array(nI);
    let anchorNeed = 0;
    for (let i = 0; i < n; i++) {
      if (!gain[i] || A.dist[i] > 0.2) continue;
      const s = (pos[i * 3] - A.q[i * 3]) * A.n[i * 3] + (pos[i * 3 + 1] - A.q[i * 3 + 1]) * A.n[i * 3 + 1] + (pos[i * 3 + 2] - A.q[i * 3 + 2]) * A.n[i * 3 + 2];
      // near the skin (8 cm) any shortfall; deeper only cloth really INSIDE the body (a jacket front sunk into a big belly: ray parity)
      if (s < clear - 1e-4 && s > -0.2 && (A.dist[i] <= 0.08 && s > -0.08 || insideByParity(B.skinGrid, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))) { anchorNeed++; for (let k = 0; k < 3; k++) if (A.bw[i * 3 + k] > 0.2) raise(reqA, A.verts[i * 3 + k], Math.min(opts.maxRoundRaise, clear - s), 1); }
    }
    let nA = 0;
    for (let i = 0; i < nI; i++) if (reqA[i] > 1e-4) { nA++; eBind[i] = Math.min(opts.maxBind, eBind[i] + reqA[i]); }
    if (nA) { refresh(); pos = posOf(); }
    // (b) every covered inner vertex has the cloth >= minClear outside it (skin bumps between cloth vertices); small steps
    const req = new Float32Array(nI);
    const d = deficits(innerBind, {pos, idx}, minClear, {eligible, near: nearInner, coverDist: opts.coverDist, allow});
    for (let i = 0; i < nI; i++) if (d.def[i] > 0 && d.hitTri[i] >= 0) raiseTri(req, d.hitTri[i], Math.min(opts.maxDeficitStep, d.def[i]), 1, i);
    let need = 0, mx = 0;
    for (let i = 0; i < nI; i++) if (req[i] > 1e-4 || reqA[i] > 1e-4) { need++; mx = Math.max(mx, req[i], reqA[i]); if (++raised[i] >= opts.freezeAfter) frozen[i] = 1; }
    bindLog.push({round: r, anchorBelowClear: anchorNeed, ...d.stats, innerVerticesRaised: need, maxRaiseM: r4(mx)});
    if (!need) break;
    for (let i = 0; i < nI; i++) if (req[i] > 0) eBind[i] = Math.min(opts.maxBind, eBind[i] + req[i]);
    refresh();
  }
  // ---- pose rounds
  const poses = B.poses ?? [];
  const poseLog = [];
  let final = null;
  const innerMesh = {pos: BP, joints: I.joints, weights: I.weights};
  for (let r = 0; r <= opts.poseRounds; r++) {
    const bindPos = posOf();
    const bc = deficits(innerBind, {pos: bindPos, idx}, 0, {eligible, coverDist: opts.coverDist, allow}).covered;
    const track = {poke: new Uint8Array(nI), exposed: new Uint8Array(nI)};
    const req = new Float32Array(nI);
    const per = {};
    for (const p of poses) {
      const ip = skinWith(p.mats, BP, I.joints, I.weights);
      const inrm = posedInnerNormals(B, I, ip);
      const cp = skinWith(p.mats, bindPos, Wt.joints, Wt.weights);
      const d = deficits({pos: ip, nrm: inrm, idx: I.idx, ...(I.isBody ? {} : {nb: I.nb, bodyGrid: new TriGrid(ip, I.idx.subarray(0, nBodyIdx), 0.03)})}, {pos: cp, idx}, opts.poseClear, {covered: bc, eligible, near: nearInner, track, allow});
      const s = per[p.clip] ??= {poses: 0, covered: d.stats.covered, maxPoke: 0, maxClose: 0, maxExposed: 0};
      s.poses++; s.maxPoke = Math.max(s.maxPoke, d.stats.poke); s.maxClose = Math.max(s.maxClose, d.stats.close); s.maxExposed = Math.max(s.maxExposed, d.stats.exposed);
      for (let i = 0; i < nI; i++) if (d.def[i] > 0 && d.hitTri[i] >= 0) raiseTri(req, d.hitTri[i], Math.min(opts.maxDeficitStep, d.def[i]), 1, i, opts.poseDirCos);
    }
    let need = 0, mx = 0;
    for (let i = 0; i < nI; i++) if (req[i] > 1e-4) { need++; mx = Math.max(mx, req[i]); if (++raised[i] >= opts.freezeAfter + 3) frozen[i] = 1; }
    poseLog.push({round: r, innerVerticesNeedingMore: need, maxDeficitM: r4(mx)});
    final = {bc, track, per};
    if (r === opts.poseRounds || !need) break;
    for (let i = 0; i < nI; i++) if (req[i] > 0) eExtra[i] = Math.min(opts.maxExtra, eExtra[i] + req[i]);
    refresh();
  }
  const pos = posOf();
  // ---- masks: enclosed in the bind pose AND covered in every validation pose
  const bodyIdx = B.idx, bodySkip = kind === 'upper'
    ? ['Head', 'L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot', ...(cfg.handsCovered ? [] : ['L_Hand', 'R_Hand'])]
    : ['Head', 'Neck', 'Chest', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'];
  const m0 = coverMask({pos: B.pos, idx: bodyIdx}, {pos, idx}, {...opts.mask[kind], bodyJoints: B.joints, skipJoints: bodySkip.filter(j => B.names.includes(j))});
  const hide = new Uint8Array(m0.hide.length);
  let hidden = 0, dropped = 0, feet = 0;
  const hasShoes = M.part.some(p => p.startsWith('shoe'));
  const FR = B.costume.region;
  for (let t = 0; t < hide.length; t++) {
    if (hasShoes && [0, 1, 2].every(c => { const r = FR[bodyIdx[t * 3 + c]]; return r === REG.footL || r === REG.footR; })) { hide[t] = 1; hidden++; feet++; continue; }
    if (!m0.hide[t]) continue;
    let ok = true;
    for (let c = 0; c < 3; c++) { const v = bodyIdx[t * 3 + c]; if (eligible[v] && (final.track.poke[v] || final.track.exposed[v])) { ok = false; break; } }
    if (B.hair[bodyIdx[t * 3]] && B.hair[bodyIdx[t * 3 + 1]] && B.hair[bodyIdx[t * 3 + 2]] && !B.fused[bodyIdx[t * 3]]) ok = false; // free hair is never hidden
    if (ok) { hide[t] = 1; hidden++; } else dropped++;
  }
  let hideLayer = null;
  if (layer) {
    // only the upper's TORSO cloth hides the lower, and only the lower's waist part (a sleeve hanging beside a stocking never hides it)
    const torsoIdx = []; for (let t = 0; t < idx.length; t += 3) if (M.part[idx[t]] === 'torso' && M.part[idx[t + 1]] === 'torso' && M.part[idx[t + 2]] === 'torso') torsoIdx.push(idx[t], idx[t + 1], idx[t + 2]);
    const ml = coverMask({pos: layer.pos, idx: layer.idx}, {pos, idx: Uint32Array.from(torsoIdx)}, {...opts.mask.layer, bodyJoints: null, skipJoints: []});
    const h = new Uint8Array(ml.hide.length); let k = 0;
    for (let t = 0; t < h.length; t++) { if (!ml.hide[t] || (layer.part && [0, 1, 2].some(c => layer.part[layer.idx[t * 3 + c]] !== 'waist'))) continue; let ok = true; for (let c = 0; c < 3; c++) { const v = I.nb + layer.idx[t * 3 + c]; if (final.track.poke[v] || final.track.exposed[v]) { ok = false; break; } } if (ok) { h[t] = 1; k++; } }
    // + the lower's cloth whose OWN SKIN ANCHOR the upper's torso covers (the ray from the anchor out along its normal meets the torso
    // within layerCoverM) in the bind pose AND every validation pose: hidden even where a bulky lower bulges out through the upper (the
    // upper lies under it there, so hiding it shows the upper, never a hole); shoes never
    let byAnchor = 0;
    if (layer.anchorPos) {
      const tIdx = Uint32Array.from(torsoIdx), nl = layer.pos.length / 3, cov = new Uint8Array(nl);
      for (let v = 0; v < nl; v++) cov[v] = layer.part && layer.part[v].startsWith('shoe') ? 0 : 1;
      for (const p of [null, ...poses]) {
        const up = p ? skinWith(p.mats, pos, Wt.joints, Wt.weights) : pos;
        const an = p ? skinWith(p.mats, layer.anchorPos, layer.joints, layer.weights, layer.anchorNrm) : {pos: layer.anchorPos, nrm: layer.anchorNrm};
        const g = new TriGrid(up, tIdx, 0.03), AP = an.pos, AN = an.nrm;
        for (let v = 0; v < nl; v++) if (cov[v] && !g.ray(AP[v * 3] + AN[v * 3] * 0.001, AP[v * 3 + 1] + AN[v * 3 + 1] * 0.001, AP[v * 3 + 2] + AN[v * 3 + 2] * 0.001, AN[v * 3], AN[v * 3 + 1], AN[v * 3 + 2], opts.layerCoverM)) cov[v] = 0;
      }
      for (let t = 0; t < h.length; t++) if (!h[t] && cov[layer.idx[t * 3]] && cov[layer.idx[t * 3 + 1]] && cov[layer.idx[t * 3 + 2]]) { h[t] = 1; k++; byAnchor++; }
    }
    hideLayer = {hide: h, hidden: k, byAnchor};
  }
  // ---- normals: the source shading carried onto the fitted surface
  const Gw = clothGraph({pos, idx});
  const nrm = carryNormals(G.pos, G.nrm, pos, Gw);
  // anchor normal of every cloth vertex (an upper fitted over this piece moves along it)
  const anchorNrm = A.n;
  // bulk (hit volumes): median cloth -> inner distance over torso / arm / leg cloth
  const groups = {torso: [], arm: [], leg: []};
  for (let i = 0; i < n; i++) {
    const s = (pos[i * 3] - A.q[i * 3]) * A.n[i * 3] + (pos[i * 3 + 1] - A.q[i * 3 + 1]) * A.n[i * 3 + 1] + (pos[i * 3 + 2] - A.q[i * 3 + 2]) * A.n[i * 3 + 2];
    const pn = M.part[i];
    if (pn === 'torso' || (pn === 'waist' && kind === 'upper')) groups.torso.push(s); else if (pn.startsWith('sleeve')) groups.arm.push(s); else if (pn.startsWith('leg') || pn === 'waist') groups.leg.push(s);
  }
  const med = a => r4(Math.max(0, quantile(a, 0.5)));
  const bulkM = kind === 'upper' ? {torso: med(groups.torso), arm: med(groups.arm)} : {leg: med(groups.leg)};
  const q = (a, f) => r4(quantile(a, f));
  const disp = Array.from({length: n}, (_, i) => Math.hypot(pos[i * 3] - base[i * 3], pos[i * 3 + 1] - base[i * 3 + 1], pos[i * 3 + 2] - base[i * 3 + 2]));
  const parts = {}, dispByPart = {};
  for (let i = 0; i < n; i++) { const p = M.part[i]; parts[p] = (parts[p] ?? 0) + 1; (dispByPart[p] ??= []).push(disp[i]); }
  const displacementByPart = Object.fromEntries(Object.entries(dispByPart).map(([p, a]) => [p, {p50: q(a, 0.5), p95: q(a, 0.95), max: q(a, 1)}]));
  const report = {map: M.report, parts, displacementByPart, anchorFallbacks: A.fallback, anchorDistanceM: {p50: q(A.dist, 0.5), p95: q(A.dist, 0.95)}, skirtVertices: Wt.skirtVertices,
    fieldM: {bindMax: q(eBind, 1), poseExtraMax: q(eExtra, 1), displacementP50: q(disp, 0.5), displacementP95: q(disp, 0.95), displacementMax: q(disp, 1)},
    bindRounds: bindLog, poseRounds: poseLog, finalPerClip: final.per, validationPoses: poses.length, directionSkewSkipped: skew, shoes: shoeFit,
    mask: {hidden, feetInShoes: feet, droppedNotCoveredInEveryPose: dropped, total: hide.length}, layerHidden: hideLayer?.hidden ?? null, layerHiddenByAnchor: hideLayer?.byAnchor ?? null, bulkM, ms: Date.now() - t0};
  return {pos, nrm, joints: Wt.joints, weights: Wt.weights, part: M.part, anchorNrm, anchorPos: A.q, mask: {hide, hidden}, hideLayer, bulkM, report};
}

/** Welded geometric normals of the layer part of an inner surface (positions `lp` of the layer's vertices). */
function layerGeomNormals(I, lp) {
  const nl = I.nl, lidx = I.layerIdx, acc = new Float32Array(nl * 3), out = new Float32Array(nl * 3);
  for (let t = 0; t < lidx.length; t += 3) {
    const a = lidx[t] - I.nb, b = lidx[t + 1] - I.nb, c = lidx[t + 2] - I.nb;
    const f = cross([lp[b * 3] - lp[a * 3], lp[b * 3 + 1] - lp[a * 3 + 1], lp[b * 3 + 2] - lp[a * 3 + 2]], [lp[c * 3] - lp[a * 3], lp[c * 3 + 1] - lp[a * 3 + 1], lp[c * 3 + 2] - lp[a * 3 + 2]]);
    for (const v of [a, b, c]) { const r = I.remap[I.nb + v] - I.nb; acc[r * 3] += f[0]; acc[r * 3 + 1] += f[1]; acc[r * 3 + 2] += f[2]; }
  }
  for (let i = 0; i < nl; i++) { const r = I.remap[I.nb + i] - I.nb; const l = Math.hypot(acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]) || 1; out[i * 3] = acc[r * 3] / l; out[i * 3 + 1] = acc[r * 3 + 1] / l; out[i * 3 + 2] = acc[r * 3 + 2] / l; }
  return out;
}

/** Posed normals of the inner surface: the body's welded skin normals re-derived on the posed body; the layer's posed geometric normals
 *  oriented like its bind push-out direction. */
function posedInnerNormals(B, I, ip) {
  const bp = I.isBody ? ip : ip.subarray(0, I.nb * 3);
  const bn = posedWeldedNormals(B, bp);
  if (I.isBody) return bn;
  const out = new Float32Array(I.pos.length); out.set(bn);
  const g = layerGeomNormals(I, ip.subarray(I.nb * 3));
  for (let i = 0; i < I.nl; i++) for (let k = 0; k < 3; k++) out[(I.nb + i) * 3 + k] = g[i * 3 + k] * I.layerSign[i];
  return out;
}

/**
 * Which cloth may count against which inner vertex (coverage, clearance, poke): the cloth part of the hit triangle (its majority part)
 * against the inner vertex's body region. An arm hanging beside a jacket's flank is limb contact, not fit; the arm is the sleeve's.
 */
function partAllowance(B, I, part, idx) {
  const C = B.costume, R = C.region, P = I.pos, apY = Math.min(C.armpit.L.y, C.armpit.R.y);
  const code = {torso: 1, waist: 2, sleeveL: 4, sleeveR: 8, legL: 16, legR: 32, shoeL: 64, shoeR: 128};
  const nt = idx.length / 3, tp = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) { const c = {}; for (let k = 0; k < 3; k++) { const p = part[idx[t * 3 + k]]; c[p] = (c[p] ?? 0) + 1; } tp[t] = code[Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]]; }
  const allowed = new Uint8Array(I.pos.length / 3);
  for (let v = 0; v < allowed.length; v++) {
    if (v >= I.nb) { allowed[v] = code.torso; continue; }
    const hi = P[v * 3 + 1] > apY - 0.02;
    switch (R[v]) {
      case REG.torso: allowed[v] = code.torso | code.waist | (hi ? code.sleeveL | code.sleeveR : 0); break;
      case REG.head: allowed[v] = code.torso; break;
      case REG.armL: case REG.handL: allowed[v] = code.sleeveL | (hi ? code.torso : 0); break;
      case REG.armR: case REG.handR: allowed[v] = code.sleeveR | (hi ? code.torso : 0); break;
      case REG.legL: allowed[v] = code.torso | code.waist | code.legL | code.shoeL; break;
      case REG.legR: allowed[v] = code.torso | code.waist | code.legR | code.shoeR; break;
      case REG.footL: allowed[v] = code.legL | code.shoeL; break;
      case REG.footR: allowed[v] = code.legR | code.shoeR; break;
    }
  }
  return (v, t) => (allowed[v] & tp[t]) !== 0;
}

export {insideByParity};

/** Front-back extent of the garment's top 6 cm (its waistband). */
function zMinW(P, n, top) { let z = Infinity; for (let i = 0; i < n; i++) if (P[i * 3 + 1] > top - 0.06) z = Math.min(z, P[i * 3 + 2]); return z; }
function zMaxW(P, n, top) { let z = -Infinity; for (let i = 0; i < n; i++) if (P[i * 3 + 1] > top - 0.06) z = Math.max(z, P[i * 3 + 2]); return z; }

// ------------------------------------------------------------------------------------------------------------------------------ hair vs cloth
// Only the costume's torso / waist cloth: the layer over the back, chest and hips that long hair can lie in or on; sleeves and trouser
// legs swing past hair without covering it.
const HAIR_CLOTH_PARTS = new Set(['torso', 'waist']);

/** Barycentric weights of point p in triangle (a, b, c) (flat offsets into P), clamped to the triangle. */
function bary(P, a, b, c, px, py, pz) {
  const v0 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v1 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]], v2 = [px - P[a], py - P[a + 1], pz - P[a + 2]];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-14) return [1 / 3, 1 / 3, 1 / 3];
  let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  v = Math.min(1, Math.max(0, v)); w = Math.min(1 - v, Math.max(0, w));
  return [1 - v - w, v, w];
}

/** Every hair vertex (welded representative) with its closest closed-skin point (both skinned with the hair vertex's own weights). */
export function hairSetup(B) {
  const n = B.pos.length / 3, verts = [], skin = [];
  for (let v = 0; v < n; v++) {
    if (!B.hair[v] || B.remap[v] !== v) continue;
    const c = B.skinGrid.closest(B.pos[v * 3], B.pos[v * 3 + 1], B.pos[v * 3 + 2], 0.3); if (!c) continue;
    verts.push(v); skin.push(c.q[0], c.q[1], c.q[2]);
  }
  const V = Uint32Array.from(verts);
  return {verts: V, free: Uint8Array.from(verts, v => B.fused[v] ? 0 : 1), pos: Float32Array.from(verts.flatMap(v => [B.pos[v * 3], B.pos[v * 3 + 1], B.pos[v * 3 + 2]])), skin: Float32Array.from(skin),
    joints: Uint8Array.from(verts.flatMap(v => [0, 1, 2, 3].map(k => B.joints[v * 4 + k]))), weights: Float32Array.from(verts.flatMap(v => [0, 1, 2, 3].map(k => B.weights[v * 4 + k])))};
}

/** The costume's torso / waist cloth merged: cloths [{pos, idx, joints, weights, anchorPos, anchorNrm, part}] (weights as floats). */
export function hairClothMerge(cloths) {
  const nv = cloths.reduce((a, c) => a + c.pos.length / 3, 0);
  const pos = new Float32Array(nv * 3), anchorPos = new Float32Array(nv * 3), anchorNrm = new Float32Array(nv * 3), joints = new Uint8Array(nv * 4), weights = new Float32Array(nv * 4), idx = [], pieces = [];
  let o = 0;
  for (const c of cloths) {
    pos.set(c.pos, o * 3); anchorPos.set(c.anchorPos, o * 3); anchorNrm.set(c.anchorNrm, o * 3); joints.set(c.joints, o * 4); weights.set(c.weights, o * 4);
    const own = [];
    for (let t = 0; t < c.idx.length; t += 3) if ([0, 1, 2].every(k => HAIR_CLOTH_PARTS.has(c.part[c.idx[t + k]]))) own.push(c.idx[t] + o, c.idx[t + 1] + o, c.idx[t + 2] + o);
    idx.push(...own); pieces.push(Uint32Array.from(own));
    o += c.pos.length / 3;
  }
  return {pos, anchorPos, anchorNrm, joints, weights, idx: Uint32Array.from(idx), pieces};
}

/**
 * One frame (mats null = the bind pose) of hair against the merged torso / waist cloth. Cloth "outward" is its own anchor normal (the
 * direction it was offset from the skin along; both walls of a thick garment share it), interpolated at the cloth point; only cloth
 * anchored within nearM of the hair's skin point counts. A hair vertex is
 *  - UNDER the cloth (inside the costume, or crossing its surface) when either
 *    (a) it lies on the INNER side of the closest cloth point of a piece (within sideM; the offset to it within 60 deg of the cloth's
 *        normal, never beside a hem / collar edge), or
 *    (b) the ray from it away from the skin (skin point -> hair) leaves cloth OUTWARD (cos > minCos) within maxDist;
 *  - OVER the cloth (lying on its outside) when it lies on the OUTER side of such a closest cloth point, or the ray back towards the
 *    skin enters cloth inward before the skin.
 * Cloth met from the wrong side by a ray (hair outside a jacket bent towards its collar) is stepped over.
 */
export function hairClothFrame(H, C, mats, {maxDist = COSTUME_FIT.hairMaxDist, nearM = COSTUME_FIT.hairNearM, minCos = COSTUME_FIT.hairDirCos, sideM = COSTUME_FIT.hairSideM} = {}) {
  const cp = mats ? skinWith(mats, C.pos, C.joints, C.weights) : C.pos;
  const A = mats ? skinWith(mats, C.anchorPos, C.joints, C.weights, C.anchorNrm) : {pos: C.anchorPos, nrm: C.anchorNrm}, ca = A.pos, cn = A.nrm;
  const hp = mats ? skinWith(mats, H.pos, H.joints, H.weights) : H.pos, sp = mats ? skinWith(mats, H.skin, H.joints, H.weights) : H.skin;
  const g = new TriGrid(cp, C.idx, 0.03), I = C.idx, nh = H.verts.length, under = new Uint8Array(nh), over = new Uint8Array(nh), n2 = nearM * nearM;
  const pg = C.pieces.filter(ix => ix.length).map(ix => ({ix, g: new TriGrid(cp, ix, 0.03)}));
  // the side of a piece's closest cloth point the hair lies on (-1 inner, +1 outer, 0 none / beside an edge)
  const side = (x, y, z, sx, sy, sz) => {
    let out = 0;
    for (const {ix, g: gp} of pg) {
      const h = gp.closest(x, y, z, sideM); if (!h) continue;
      const a = ix[h.tri * 3] * 3, b = ix[h.tri * 3 + 1] * 3, c = ix[h.tri * 3 + 2] * 3, w = [h.q[3], h.q[4], h.q[5]];
      const ax = w[0] * ca[a] + w[1] * ca[b] + w[2] * ca[c], ay = w[0] * ca[a + 1] + w[1] * ca[b + 1] + w[2] * ca[c + 1], az = w[0] * ca[a + 2] + w[1] * ca[b + 2] + w[2] * ca[c + 2];
      if ((ax - sx) ** 2 + (ay - sy) ** 2 + (az - sz) ** 2 > n2) continue;
      const nx = w[0] * cn[a] + w[1] * cn[b] + w[2] * cn[c], ny = w[0] * cn[a + 1] + w[1] * cn[b + 1] + w[2] * cn[c + 1], nz = w[0] * cn[a + 2] + w[1] * cn[b + 2] + w[2] * cn[c + 2];
      const vx = x - h.q[0], vy = y - h.q[1], vz = z - h.q[2], d = Math.hypot(vx, vy, vz), sd = (vx * nx + vy * ny + vz * nz) / (Math.hypot(nx, ny, nz) || 1);
      if (Math.abs(sd) >= 0.5 * d) { if (sd < 0) return -1; out = 1; }
    }
    return out;
  };
  // nearest hit whose cloth point (anchor + anchor normal interpolated at the hit: big flat panels have corners far apart) is anchored
  // within nearM of the skin point and crossed along its anchor normal (sgn +1: outward, -1: inward); others are stepped over (at most 6)
  const hitNear = (x, y, z, dx, dy, dz, tMax, sx, sy, sz, sgn) => {
    let t0 = 0;
    for (let it = 0; it < 6; it++) {
      const h = g.ray(x, y, z, dx, dy, dz, tMax, t0); if (!h) return false;
      const a = I[h.tri * 3] * 3, b = I[h.tri * 3 + 1] * 3, c = I[h.tri * 3 + 2] * 3;
      const px = x + dx * h.t, py = y + dy * h.t, pz = z + dz * h.t;
      const w = bary(cp, a, b, c, px, py, pz);
      const ax = w[0] * ca[a] + w[1] * ca[b] + w[2] * ca[c], ay = w[0] * ca[a + 1] + w[1] * ca[b + 1] + w[2] * ca[c + 1], az = w[0] * ca[a + 2] + w[1] * ca[b + 2] + w[2] * ca[c + 2];
      const nx = w[0] * cn[a] + w[1] * cn[b] + w[2] * cn[c], ny = w[0] * cn[a + 1] + w[1] * cn[b + 1] + w[2] * cn[c + 1], nz = w[0] * cn[a + 2] + w[1] * cn[b + 2] + w[2] * cn[c + 2];
      const cos = sgn * (nx * dx + ny * dy + nz * dz) / (Math.hypot(nx, ny, nz) || 1);
      if (cos > minCos && (ax - sx) ** 2 + (ay - sy) ** 2 + (az - sz) ** 2 <= n2) return true;
      t0 = h.t + 1e-4;
    }
    return false;
  };
  for (let k = 0; k < nh; k++) {
    const sx = sp[k * 3], sy = sp[k * 3 + 1], sz = sp[k * 3 + 2];
    const x = hp[k * 3], y = hp[k * 3 + 1], z = hp[k * 3 + 2], dx = x - sx, dy = y - sy, dz = z - sz, l = Math.hypot(dx, dy, dz);
    if (l < 1e-5) continue;
    const ux = dx / l, uy = dy / l, uz = dz / l;
    const sd = side(x, y, z, sx, sy, sz);
    if (sd < 0 || hitNear(x, y, z, ux, uy, uz, maxDist, sx, sy, sz, 1)) under[k] = 1;
    if (sd > 0 || hitNear(x, y, z, -ux, -uy, -uz, l, sx, sy, sz, -1)) over[k] = 1;
  }
  return {under, over};
}

/**
 * Visible hair islands: connected components (shared welded vertices) of the body's hair triangles (all three corners hair) no mask
 * hides (`hidden`: body-triangle bitset) with at least `share` of their vertices UNDER or OVER the cloth in the bind pose (`inCloth`,
 * per body vertex; the rest is the rim where the lock crosses the cloth surface): hair emerging from the cloth with no visible link to
 * the head (the dark blob a long lock makes where it pokes out of a jacket back). Returns the islands' triangles.
 */
export function hairIslands(B, hidden, inCloth, share = COSTUME_FIT.hairIslandShare) {
  const nT = B.idx.length / 3, par = new Int32Array(B.pos.length / 3).map((_, i) => i);
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const tris = [];
  for (let t = 0; t < nT; t++) {
    if (hidden[t]) continue;
    const a = B.remap[B.idx[t * 3]], b = B.remap[B.idx[t * 3 + 1]], c = B.remap[B.idx[t * 3 + 2]];
    if (!B.hair[a] || !B.hair[b] || !B.hair[c]) continue;
    tris.push(t); par[find(b)] = find(a); par[find(c)] = find(a);
  }
  const seen = new Set(), nIn = new Map(), nAll = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = B.remap[B.idx[t * 3 + k]]; if (seen.has(v)) continue; seen.add(v);
    const r = find(v); nAll.set(r, (nAll.get(r) ?? 0) + 1); if (inCloth[v]) nIn.set(r, (nIn.get(r) ?? 0) + 1);
  }
  return tris.filter(t => { const r = find(B.remap[B.idx[t * 3]]); return (nIn.get(r) ?? 0) >= share * nAll.get(r); });
}

/**
 * Body hair hidden under a costume (per body x costume, merged into the upper's hideBodyTriangles): every hair triangle with a corner
 * UNDER the torso / waist cloth in the bind pose or any validation pose (inside the costume or poking through it), then the visible
 * hair islands left lying on the cloth (hairIslands). Hair over the shoulders and outside the garment, joined to the head, stays.
 * cloths [{pos, idx, joints, weights (floats), anchorPos, part}], hidden = the costume's other body masks (union).
 */
export function hairHide(B, cloths, poses, hidden) {
  const H = hairSetup(B), C = hairClothMerge(cloths), nV = B.pos.length / 3, nT = B.idx.length / 3;
  const under = new Uint8Array(nV), inCloth = new Uint8Array(nV);
  let f = 0;
  for (const m of [null, ...poses.map(p => p.mats)]) {
    const s = hairClothFrame(H, C, m);
    for (let k = 0; k < H.verts.length; k++) { if (s.under[k] && H.free[k]) under[H.verts[k]] = 1; if (!f && (s.under[k] || s.over[k])) inCloth[H.verts[k]] = 1; }
    f++;
  }
  const hide = new Uint8Array(nT), all = Uint8Array.from(hidden);
  let byUnder = 0;
  for (let t = 0; t < nT; t++) {
    const a = B.remap[B.idx[t * 3]], b = B.remap[B.idx[t * 3 + 1]], c = B.remap[B.idx[t * 3 + 2]];
    if (!B.hair[a] || !B.hair[b] || !B.hair[c] || !(under[a] || under[b] || under[c])) continue;
    hide[t] = 1; if (!all[t]) byUnder++; all[t] = 1;
  }
  const isl = hairIslands(B, all, inCloth);
  for (const t of isl) hide[t] = 1;
  let n = 0; for (let t = 0; t < nT; t++) if (hide[t]) n++;
  return {hide, hidden: n, stats: {hairVertices: H.verts.length, underInSomeFrame: under.reduce((a, v) => a + v, 0), trianglesUnder: byUnder, islandTriangles: isl.length, frames: f}};
}

// ------------------------------------------------------------------------------------------------------------------------------ ragdoll poses
import {EXTREME_POSES} from './extreme-poses.mjs';
const qmul4 = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot4 = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const mulM4 = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trsM4 = (p, q) => { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, p[0], p[1], p[2], 1]; };
/**
 * The three ragdoll-like extreme poses of lib/extreme-poses.mjs (inside the runtime ragdoll's joint limits: legs splayed, crumpled,
 * twisted - the kind of pose a corpse ends in; zombies hand their bones to a physics ragdoll on death) as validation poses
 * {clip: 'ragdoll-<name>', t: 0, mats} (skinning matrices JointWorld x IBM, like lib/lingerie-body.mjs skinMats).
 */
export function ragdollPoses(B) {
  const R = B.R, ibm = B.mesh.ibm;
  return Object.entries(EXTREME_POSES).map(([name, rot]) => {
    const world = [];
    R.joints.forEach((j, i) => {
      const local = {q: rot[j.getName()] ?? j.getRotation().slice(), p: j.getTranslation().slice()};
      const pi = R.joints.indexOf(j.getParentNode());
      if (pi < 0) world[i] = local;
      else { const P = world[pi]; world[i] = {q: qmul4(P.q, local.q), p: qrot4(P.q, local.p).map((v, c) => v + P.p[c])}; }
    });
    const W = world.map(w => trsM4(w.p, w.q));
    return {clip: name, t: 0, mats: B.mesh.skinJoints.map((j, k) => mulM4(W[R.joints.indexOf(j)], Array.from(ibm.subarray(k * 16, k * 16 + 16))))};
  });
}
