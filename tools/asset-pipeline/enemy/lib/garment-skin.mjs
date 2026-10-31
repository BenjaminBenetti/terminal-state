// Task siren-clothing-refit-20261031 (lane FIT): skin weights for the REFITTED Siren dress (garment only; the body's weights,
// skeleton and clips are read, never changed). Computed on welded dress vertices (UV-seam duplicates share a row), spread back to
// the native vertex order.
//  - Fitted part (strap / cup / band / waist / hip): each cloth vertex copies the body's OWN weights interpolated (barycentric) at
//    its anchor = the closest torso / leg SKIN point (arms, head and hair excluded), so cloth and the skin under it deform with the
//    same bone blend and the cloth offset is carried along (Track1 instead re-weighted the misplaced strap to Chest). The strap now
//    sits medially on the trapezius, where the skin is Chest / Neck dominated, so it follows the shoulder without swinging off
//    with the upper arm. Head influence -> Neck (cloth never follows the head).
//  - Skirt (below the hip line): a rule instead of the closest point (which flips between the two thighs on the centre line and
//    tears the skirt between the legs): Hips * (1 - tau) + tau * (L_Thigh * (1 + s) / 2 + R_Thigh * (1 - s) / 2), s = the relative
//    distance to the two thigh bones, (dR - dL) / (dR + dL) x sideSharpness clamped to [-1, 1] (the centre front / back split
//    evenly, cloth over one thigh follows that thigh), tau rising from tau0 at the crotch to tau1 by mid-thigh (cloth over the
//    front of a lifted thigh lifts with it; the hem never lags behind the knees); shin / foot influence of the leg skin goes to that thigh except a share (hemShin x a ramp below the knee joint) for
//    the hem / fringe hanging below the knee, so a bent knee does not pass through the hem. Blended with the anchor
//    weights between the hip line and the crotch.
//  - Laplacian smoothing over the dress adjacency (light, lambda fittedLambda, on the fitted part so the cloth keeps the weights of the
//    skin right under it; full lambda on the skirt), top-4, normalised (the GLB writer quantises to u8 rows summing to 255).
import {TriGrid, weldMap} from '../../zombie/lib/penetration.mjs';

const lerpL = (a, b, t) => a + (b - a) * t;
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const GARMENT_SKIN = {hipY: 0.86, crotchY: 0.771, tau0: 1.0, tau1: 1.0, tauFullY: 0.62, hemShin: 0.6, sideSharpness: 2.5, smoothIters: 4, smoothLambda: 0.5, fittedLambda: 0.15};

const segDist = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]); };

/**
 * @param dress {pos (bind, game m, native order), idx, region (per native vertex: 0 strap 1 cup 2 band 3 waist 4 hip 5 skirt)}
 * @param body {pos (bind), idx, skin (0/1), groups (0 torso 1 head 2 arm 3 leg), joints (Uint16/Uint8 x4), weights (float x4, rows sum 1),
 *   jointPos {name: [x, y, z] bind}}
 * @param names joint names in skin order
 */
export function garmentWeights(dress, body, names, opts = {}) {
  if (!body.jointPos) throw new Error('garmentWeights: body.jointPos (bind joint positions by name) required');
  const JP = body.jointPos;
  const O = {...GARMENT_SKIN, ...opts};
  const J = Object.fromEntries(names.map((n, i) => [n, i]));
  const nj = names.length;
  const {remap, uniq} = weldMap(dress.pos);
  const P = dress.pos, n = P.length / 3;
  // anchor surface: torso + leg skin; no head / hair triangles, no arm triangles LATERAL of the shoulder joints (the T-pose arms) —
  // the arm-weighted underarm / shoulder-cap skin medial of the joint is what the cup side and strap lie on, so they copy it
  const shX = Math.abs(JP.R_UpperArm[0]);
  const tIdx = [], legIdx = {L: [], R: []};
  for (let t = 0; t < body.idx.length; t += 3) {
    const v = [body.idx[t], body.idx[t + 1], body.idx[t + 2]];
    if (!v.every(i => body.skin[i] && body.groups[i] !== 1)) continue;
    const cx = (body.pos[v[0] * 3] + body.pos[v[1] * 3] + body.pos[v[2] * 3]) / 3;
    if (v.some(i => body.groups[i] === 2) && Math.abs(cx) > shX) continue;
    tIdx.push(...v);
    // per-side leg / hip skin for the skirt (below the waist, that side of the midline)
    const cy = (body.pos[v[0] * 3 + 1] + body.pos[v[1] * 3 + 1] + body.pos[v[2] * 3 + 1]) / 3;
    if (cy < O.hipY + 0.05 && v.every(i => body.groups[i] !== 2)) legIdx[cx >= 0 ? 'L' : 'R'].push(...v);
  }
  const I = Uint32Array.from(tIdx), grid = new TriGrid(body.pos, I, 0.03);
  const LI = {L: Uint32Array.from(legIdx.L), R: Uint32Array.from(legIdx.R)}, legGrid = {L: new TriGrid(body.pos, LI.L, 0.03), R: new TriGrid(body.pos, LI.R, 0.03)};
  const rows = new Map();
  // skirt rows: shin / foot influence of the leg skin is moved to that thigh, except a share keepShin(y) for hem / fringe below the
  // knee joint (they then track the bent knee instead of letting it pass through the hem, and swing back with the shins in a kneel)
  const kneeY = (JP.L_Shin[1] + JP.R_Shin[1]) / 2;
  const keepShin = y => O.hemShin * ss(kneeY + 0.04, kneeY - 0.06, y);
  const bodyRow = (i, acc, w, side = null, y = 1) => { for (let k = 0; k < 4; k++) { const ww = body.weights[i * 4 + k]; if (ww > 0) { let j = body.joints[i * 4 + k]; const nm = names[j]; if (nm === 'Head') j = J.Neck; else if (side && /_(Shin|Foot)$/.test(nm)) { const keep = /_Shin$/.test(nm) ? keepShin(y) : 0; acc[j] += w * ww * keep; j = J[nm.slice(0, 2) + 'Thigh']; acc[j] += w * ww * (1 - keep); continue; } acc[j] += w * ww; } } };
  const anchorRow = (g, Ix, p, acc, w, side) => { const c = g.closest(p[0], p[1], p[2], 0.3); if (!c) return false; const a = Ix[c.tri * 3], b = Ix[c.tri * 3 + 1], e = Ix[c.tri * 3 + 2]; bodyRow(a, acc, c.q[3] * w, side, p[1]); bodyRow(b, acc, c.q[4] * w, side, p[1]); bodyRow(e, acc, c.q[5] * w, side, p[1]); return true; };
  let anchored = 0, ruled = 0, far = 0;
  for (const i of uniq) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const acc = new Float64Array(nj);
    const wRule = ss(O.hipY, O.crotchY - 0.02, y);
    if (wRule < 1) { if (anchorRow(grid, I, [x, y, z], acc, 1 - wRule, null)) anchored++; else { acc[J.Hips] += 1 - wRule; far++; } }
    if (wRule > 0) {
      // skirt: each side's own leg / hip skin weights at the closest point there (shin / foot -> that thigh), shared by the
      // relative distance to the two thigh bones (centre front / back split evenly); a Hips share fading out by mid-thigh
      const dL = segDist([x, y, z], JP.L_Thigh, JP.L_Shin), dR = segDist([x, y, z], JP.R_Thigh, JP.R_Shin);
      const s = Math.max(-1, Math.min(1, O.sideSharpness * (dR - dL) / (dR + dL + 1e-9))); // > 0: nearer the LEFT thigh
      const hips = 1 - (O.tau0 + (O.tau1 - O.tau0) * ss(O.crotchY, O.tauFullY, y));
      acc[J.Hips] += wRule * hips;
      for (const [side, sh] of [['L', (1 + s) / 2], ['R', (1 - s) / 2]]) if (sh > 1e-4 && !anchorRow(legGrid[side], LI[side], [x, y, z], acc, wRule * (1 - hips) * sh, side)) acc[J[side + '_Thigh']] += wRule * (1 - hips) * sh;
      ruled++;
    }
    rows.set(i, acc);
  }
  // masked Laplacian smoothing (welded adjacency)
  const adj = new Map(); for (const i of uniq) adj.set(i, new Set());
  for (let t = 0; t < dress.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = remap[dress.idx[t + k]], b = remap[dress.idx[t + (k + 1) % 3]]; if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); } }
  for (let it = 0; it < O.smoothIters; it++) {
    const next = new Map();
    for (const i of uniq) {
      const nb = adj.get(i), r = rows.get(i);
      if (!nb.size) { next.set(i, r); continue; }
      const m = new Float64Array(nj); for (const j of nb) { const q = rows.get(j); for (let k = 0; k < nj; k++) m[k] += q[k]; }
      // fitted cloth keeps (almost) the skin's own weights under it — light smoothing; the skirt smooths fully (no tearing)
      const lam = lerpL(O.fittedLambda, O.smoothLambda, ss(O.hipY + 0.04, O.crotchY, P[i * 3 + 1]));
      const o = new Float64Array(nj); for (let k = 0; k < nj; k++) o[k] = r[k] + lam * (m[k] / nb.size - r[k]);
      next.set(i, o);
    }
    for (const [i, r] of next) rows.set(i, r);
  }
  // top-4, normalised, spread to the native order
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  let armRows = 0, shinRows = 0;
  const top = new Map();
  for (const i of uniq) {
    const r = rows.get(i);
    const e = [...r].map((w, j) => [w, j]).filter(([w]) => w > 1e-6).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 4);
    const s = e.reduce((a, [w]) => a + w, 0);
    top.set(i, e.map(([w, j]) => [w / s, j]));
    if (e.some(([, j]) => /UpperArm|Forearm|Hand/.test(names[j]))) armRows++;
    if (e.some(([, j]) => /Shin|Foot/.test(names[j]))) shinRows++;
  }
  for (let i = 0; i < n; i++) { const e = top.get(remap[i]); e.forEach(([w, j], k) => { joints[i * 4 + k] = j; weights[i * 4 + k] = w; }); }
  return {joints, weights, stats: {weldedVertices: uniq.length, anchored, skirtRule: ruled, anchorBeyond20cm: far, rowsWithArmInfluence: armRows, rowsWithShinFootInfluence: shinRows, params: O,
    method: 'anchor = closest torso / leg skin point (bind): body weights interpolated there (Head -> Neck); skirt rule below the hip line (Hips + both thighs by lateral position, never shins); masked Laplacian smoothing; top-4 normalised'}};
}
