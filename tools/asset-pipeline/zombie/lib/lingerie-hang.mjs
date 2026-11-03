// Task studio-beta-mall-lingerie-store-polish-20261103-045922-01 (lane FIT): hanging rack stock from the mannequin-fitted lingerie
// pieces (deterministic geometry processing of the fitted Meshy garments; textures / UVs untouched) + the hangers they hang on.
// Item frame: origin = the point of the hook that rests on the rail (the inside top of the hook), +Y up, the garment's front +Z,
// everything hanging below the origin. The hangers are plain procedural hardware (chrome wire tubes / small clips, untextured
// material factors only: no generated or painted art):
//   wire hanger  hook + neck + a 0.30 m triangle frame (arms sloping from y -0.045 at the neck to -0.10 at the tips, bottom bar)
//   clip hanger  hook + neck + a straight 0.30 m bar at y -0.05 with two clips at x +-0.12 (jaws y -0.055 .. -0.095)
// Hanging a piece (working frame of the mannequin fit, front +Z):
//   strapped tops: each strap crest (the highest point of the strap loop per side) rests on the wire hanger's arm at its own x;
//   strapless tops / bottoms: the top edge near x +-0.12 sits in the clip jaws;
//   depth relaxed around the hang points (z' = z_hang + (z - z_hang) x kz: kz 0.55 tops, 0.32 bottoms: the garment off its form
//   flattens, molded cups keep some depth); x / y unchanged otherwise (no stretch).

const r4 = v => +(+v).toFixed(4);
export const HANGER = {width: 0.30, hookInnerR: 0.012, wireR: 0.0022, neckY: -0.045, tipY: -0.10, barY: -0.105, clipBarY: -0.05, clipX: 0.12, clipJaw: [-0.055, -0.095]};
const armY = x => HANGER.neckY + (HANGER.tipY - HANGER.neckY) * Math.min(1, Math.abs(x) / (HANGER.width / 2));

/** Tube mesh along a polyline (closed or open), radius r, `sides` segments; returns {pos, nrm, idx}. */
function tube(path, r, sides = 6, closed = false) {
  const pos = [], nrm = [], idx = [];
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const p = path[i], a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map(v => v / tl);
    const ref = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    for (let k = 0; k < sides; k++) { const th = 2 * Math.PI * k / sides, c = Math.cos(th), s = Math.sin(th); const d = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s]; pos.push(p[0] + r * d[0], p[1] + r * d[1], p[2] + r * d[2]); nrm.push(...d); }
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) { const i2 = (i + 1) % n; for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides, a = i * sides + k, b = i * sides + k2, c = i2 * sides + k, d = i2 * sides + k2; idx.push(a, c, b, b, c, d); } }
  return {pos, nrm, idx};
}
function box(c, h) { // axis-aligned box, centre c, half extents h
  const pos = [], nrm = [], idx = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = [0, 0, 0]; p[ax] = c[ax] + sg * h[ax]; p[u] = c[u] + a * h[u]; p[v] = c[v] + b * h[v]; pos.push(...p); const n = [0, 0, 0]; n[ax] = sg; nrm.push(...n); }
    if (sg > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return {pos, nrm, idx};
}
function merge(parts) { const pos = [], nrm = [], idx = []; for (const p of parts) { const b = pos.length / 3; pos.push(...p.pos); nrm.push(...p.nrm); idx.push(...p.idx.map(i => i + b)); } return {pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint16Array.from(idx)}; }

function hookPath() {
  const R = HANGER.hookInnerR + HANGER.wireR, cy = -R + HANGER.wireR; // the wire's inner top edge at y 0
  const pts = [];
  for (let a = -30; a <= 210; a += 15) { const th = a * Math.PI / 180; pts.push([R * Math.cos(th), cy + R * Math.sin(th), 0]); }
  // down from the hook's open side to the neck
  const end = pts[0];
  pts.unshift([end[0] * 0.5, (end[1] + HANGER.neckY) / 2, 0]);
  pts.unshift([0, HANGER.neckY + 0.004, 0]);
  return pts.reverse();
}
/** The two hangers' meshes (item frame). */
export function hangerMeshes() {
  const W = HANGER.width / 2, r = HANGER.wireR;
  const wire = merge([tube(hookPath(), r, 6, false), tube([[0, HANGER.neckY, 0], [-W, HANGER.tipY, 0], [-W - 0.004, HANGER.barY, 0], [W + 0.004, HANGER.barY, 0], [W, HANGER.tipY, 0]], r, 6, true)]);
  const clip = merge([tube(hookPath(), r, 6, false), tube([[0, HANGER.neckY, 0], [0, HANGER.clipBarY, 0]], r, 6, false), tube([[-W, HANGER.clipBarY, 0], [W, HANGER.clipBarY, 0]], r * 1.6, 6, false),
    ...[-1, 1].map(s => box([s * HANGER.clipX, (HANGER.clipJaw[0] + HANGER.clipJaw[1]) / 2, 0], [0.011, (HANGER.clipJaw[0] - HANGER.clipJaw[1]) / 2 + 0.004, 0.006]))]);
  return {wire, clip};
}

/** Welded highest vertex per side among the piece's vertices (optionally restricted to |x| in [x0, x1]). */
function topPoint(P, side, x0 = 0.01, x1 = 1) {
  let best = -1;
  for (let i = 0; i < P.length / 3; i++) { const x = P[i * 3] * side; if (x < x0 || x > x1) continue; if (best < 0 || P[i * 3 + 1] > P[best * 3 + 1]) best = i; }
  return best < 0 ? null : [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
}

/**
 * The hang transform of an item from its FIRST piece (working frame, front +Z): kind 'strapped' (strap crests on the wire hanger's
 * arms) | 'clip' (top edge in the clip jaws). Returns {dy, zHang, kz, record}; applyHang() maps any piece of the item with it.
 */
export function hangTransform(P, kind, kz) {
  if (kind === 'strapped') {
    const L = topPoint(P, 1), R = topPoint(P, -1);
    const crestX = (Math.abs(L[0]) + Math.abs(R[0])) / 2, crestY = (L[1] + R[1]) / 2;
    return {dy: armY(crestX) + HANGER.wireR + 0.003 - crestY, zHang: (L[2] + R[2]) / 2, kz, record: {hanger: 'wire', hangPoints: 'strap crests on the hanger arms', crestX: r4(crestX)}};
  }
  const L = topPoint(P, 1, HANGER.clipX - 0.03, HANGER.clipX + 0.03), R = topPoint(P, -1, HANGER.clipX - 0.03, HANGER.clipX + 0.03);
  return {dy: (HANGER.clipJaw[0] + HANGER.clipJaw[1]) / 2 - 0.006 - (L[1] + R[1]) / 2, zHang: (L[2] + R[2]) / 2, kz, record: {hanger: 'clip', hangPoints: `top edge in the clip jaws (x +-${HANGER.clipX})`}};
}
export function applyHang(P, t) {
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { out[i] = P[i]; out[i + 1] = P[i + 1] + t.dy; out[i + 2] = (P[i + 2] - t.zHang) * t.kz; }
  return out;
}
/** Bounds record of a hung item (garment pieces + its hanger). */
export function hangRecord(pieces, t) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const P of pieces) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const x0 = Math.min(mn[0], -HANGER.width / 2 - 0.006), x1 = Math.max(mx[0], HANGER.width / 2 + 0.006), w = x1 - x0, d = mx[2] - mn[2];
  return {...t.record, kz: t.kz, dropM: r4(-mn[1]), widthM: r4(w), depthM: r4(d), garmentBounds: {min: mn.map(r4), max: mx.map(r4)}, spacingM: {faceOut: r4(w + 0.02), sideOn: r4(Math.max(0.06, d + 0.02))}};
}

/** Relaxed-depth normals: scale the normal's z by 1 / kz (the depth map z' = z kz) and renormalise. */
export function hangNormals(N, kz) {
  const o = new Float32Array(N.length);
  for (let i = 0; i < N.length; i += 3) { const x = N[i], y = N[i + 1], z = N[i + 2] / kz, l = Math.hypot(x, y, z) || 1; o[i] = x / l; o[i + 1] = y / l; o[i + 2] = z / l; }
  return o;
}
