// Terminal State — LOCAL geometry repairs of two Meshy T2.5 runtime derivatives (task studio-model-touchups-20261030-01, lane GEOM).
//
// User feedback 2026-10-30: "supply cabinet side face looks bad, sorta like accordion lines or something. Might be able to
// manually fix the model, by putting a proper flat face on the sides / top." and "Bench found in the subway track area has
// messed up back rest, lots of mangled triangles".
//
// Pure, deterministic functions on build-meshy-t25.mjs's FITTED runtime mesh {P, N, UV, I} (output frame: metres, +Y up, front +Z,
// bottom-centre origin), applied after the exact footprint fit and before the GLB is written. No texture is edited and nothing is
// generated: every new face samples the derivative's own atlas through UVs, so the colour, metallic-roughness and normal maps stay
// consistent with each other. Measurements are taken from the mesh itself and checked against the values found by inspection
// (a mismatch throws instead of building something unexpected).
//
//   repairCabinetTall  — ROOT CAUSE: Meshy rebuilt the plain side panels as 32 separate vertical fins (16 per side, 3 cm proud of a
//                        thin inner wall, ~1 cm gaps) and the top as 13 transverse slats, painted with dark streaks = the accordion
//                        look. FIX: the fins / slats (and the hidden faces they covered) are removed; each side gets ONE flat panel
//                        between the corner posts (1.5 mm inside the post faces: no coplanar overlap) and the top a flat cap box at
//                        the exact old outer bounds, textured from the cabinet's own clean back-panel paint / front header rail.
//                        Front, doors (runtime split), handles, posts, plinth, interior and the bbox are unchanged.
//   repairBenchBackrest — ROOT CAUSE: the three perforated backrest panels were reconstructed as torn shells (holes, sliver fans,
//                        shard walls inside the slab). FIX: per bay, the old triangles are clipped exactly on planes where the
//                        geometry is clean (fillet y 0.386, back corner y 0.325, rolled top rail y 0.73, inside the teal side
//                        plates) and the panel is rebuilt as two clean surfaces (front with the seat fillet, back with the bottom
//                        corner) welded to the cut edges; textured from the bench's own seat-top / seat-bottom paint.

export const GEOM_REPAIR_VERSION = 'geom-r1';

// ---- small vector helpers --------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const r4 = v => Math.round(v * 1e4) / 1e4, r6 = v => Math.round(v * 1e6) / 1e6;
const P3 = (M, i) => [M.P[3 * i], M.P[3 * i + 1], M.P[3 * i + 2]];

/** Geometry of face f: centroid, unit normal (winding), area, min angle (deg), longest edge, shortest altitude. */
export function faceGeom(P, I, f) {
  const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
  const A = [P[a], P[a + 1], P[a + 2]], B = [P[b], P[b + 1], P[b + 2]], C = [P[c], P[c + 1], P[c + 2]];
  const e = [len(sub(B, A)), len(sub(C, B)), len(sub(A, C))], nn = cross(sub(B, A), sub(C, A)), l = len(nn), area = l / 2;
  const emax = Math.max(...e), emin = Math.min(...e);
  // angles from the law of cosines (robust enough for the reporting thresholds used here)
  const ang = (x, y, z) => (y > 0 && z > 0 ? Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z)))) * 180 / Math.PI : 0);
  const minAngle = emin <= 0 ? 0 : Math.min(ang(e[0], e[1], e[2]), ang(e[1], e[2], e[0]), ang(e[2], e[0], e[1]));
  return {c: [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], n: l > 0 ? [nn[0] / l, nn[1] / l, nn[2] / l] : [0, 0, 0], area, minAngle, emax, emin, alt: emax > 0 ? 2 * area / emax : 0};
}

export function bboxOf(P) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < mn[k]) mn[k] = P[i + k]; if (P[i + k] > mx[k]) mx[k] = P[i + k]; }
  return {min: mn, max: mx};
}

/** Position-welded connected components (5 decimal places, like the builder's meshStats). Returns comp id per face + comps. */
function components(P, I) {
  const nv = P.length / 3, key = new Map(), weld = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${P[3 * v].toFixed(5)},${P[3 * v + 1].toFixed(5)},${P[3 * v + 2].toFixed(5)}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld[v] = w; }
  const par = Int32Array.from({length: key.size}, (_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let f = 0; f < I.length; f += 3) { const a = find(weld[I[f]]), b = find(weld[I[f + 1]]); if (a !== b) par[a] = b; const c = find(weld[I[f + 2]]), d = find(b); if (c !== d) par[c] = d; }
  const faceComp = new Int32Array(I.length / 3), comps = new Map();
  for (let f = 0; f < I.length / 3; f++) {
    const r = find(weld[I[3 * f]]); faceComp[f] = r;
    let e = comps.get(r); if (!e) comps.set(r, (e = {id: r, faces: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}));
    e.faces.push(f);
    for (let k = 0; k < 3; k++) { const v = 3 * I[3 * f + k]; for (let j = 0; j < 3; j++) { e.min[j] = Math.min(e.min[j], P[v + j]); e.max[j] = Math.max(e.max[j], P[v + j]); } }
  }
  return {faceComp, comps: [...comps.values()]};
}

/** UV islands = index-connected face groups (glTF splits vertices on UV seams). Returns island id per face. */
function islands(I, nv) {
  const par = Int32Array.from({length: nv}, (_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let f = 0; f < I.length; f += 3) { const a = find(I[f]), b = find(I[f + 1]); if (a !== b) par[a] = b; const c = find(I[f + 2]), d = find(b); if (c !== d) par[c] = d; }
  const out = new Int32Array(I.length / 3);
  for (let f = 0; f < I.length / 3; f++) out[f] = find(I[3 * f]);
  return out;
}

/** Least-squares affine map (a, b) -> (u, v) over the vertices of `faces` (axes ia, ib); max residual in UV units. */
function fitAffine(M, faces, ia, ib) {
  const verts = [...new Set(faces.flatMap(f => [M.I[3 * f], M.I[3 * f + 1], M.I[3 * f + 2]]))].sort((x, y) => x - y);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bu = [0, 0, 0], bv = [0, 0, 0];
  for (const i of verts) { const r = [M.P[3 * i + ia], M.P[3 * i + ib], 1]; for (let j = 0; j < 3; j++) { for (let k = 0; k < 3; k++) A[j][k] += r[j] * r[k]; bu[j] += r[j] * M.UV[2 * i]; bv[j] += r[j] * M.UV[2 * i + 1]; } }
  const solve = b => {
    const m = A.map((row, i) => [...row, b[i]]);
    for (let i = 0; i < 3; i++) {
      let p = i; for (let j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
      [m[i], m[p]] = [m[p], m[i]];
      if (Math.abs(m[i][i]) < 1e-15) throw new Error('fitAffine: degenerate sample set');
      for (let j = 0; j < 3; j++) if (j !== i) { const q = m[j][i] / m[i][i]; for (let k = i; k < 4; k++) m[j][k] -= q * m[i][k]; }
    }
    return m.map((row, i) => row[3] / row[i]);
  };
  const u = solve(bu), v = solve(bv);
  let maxResidual = 0;
  for (const i of verts) { const a = M.P[3 * i + ia], b = M.P[3 * i + ib]; maxResidual = Math.max(maxResidual, Math.hypot(u[0] * a + u[1] * b + u[2] - M.UV[2 * i], v[0] * a + v[1] * b + v[2] - M.UV[2 * i + 1])); }
  const at = (a, b) => [u[0] * a + u[1] * b + u[2], v[0] * a + v[1] * b + v[2]];
  return {u, v, maxResidual, at, vertices: verts.length, faces: faces.length, axes: ['xyz'[ia], 'xyz'[ib]]};
}
const fitRecord = F => ({axes: F.axes, u: F.u.map(r6), v: F.v.map(r6), faces: F.faces, vertices: F.vertices, maxResidualUV: Number(F.maxResidual.toExponential(2))});

/** Growable output mesh that starts as a copy of the source vertex buffer (old vertices keep their indices). */
class MeshOut {
  constructor(M) { this.P = Array.from(M.P); this.N = Array.from(M.N); this.UV = Array.from(M.UV); this.I = []; }
  get nv() { return this.P.length / 3; }
  vert(p, n, uv) { this.P.push(p[0], p[1], p[2]); const q = unit(n); this.N.push(q[0], q[1], q[2]); this.UV.push(uv[0], uv[1]); return this.nv - 1; }
  /** Triangle (a, b, c) wound so its geometric normal agrees with `want` (or with its vertex normals when `want` is null). */
  tri(a, b, c, want = null) {
    const A = [this.P[3 * a], this.P[3 * a + 1], this.P[3 * a + 2]], B = [this.P[3 * b], this.P[3 * b + 1], this.P[3 * b + 2]], C = [this.P[3 * c], this.P[3 * c + 1], this.P[3 * c + 2]];
    const g = cross(sub(B, A), sub(C, A));
    const w = want ?? [0, 1, 2].map(k => this.N[3 * a + k] + this.N[3 * b + k] + this.N[3 * c + k]);
    if (dot(g, w) < 0) this.I.push(a, c, b); else this.I.push(a, b, c);
  }
  /** Compacts away unused vertices (order of first appearance in the old buffer kept) and returns typed arrays. */
  finish() {
    const nv = this.nv, used = new Uint8Array(nv); for (const i of this.I) used[i] = 1;
    const map = new Int32Array(nv).fill(-1); let k = 0; for (let v = 0; v < nv; v++) if (used[v]) map[v] = k++;
    const P = new Float32Array(3 * k), N = new Float32Array(3 * k), UV = new Float32Array(2 * k);
    for (let v = 0; v < nv; v++) if (used[v]) { const j = map[v]; P.set(this.P.slice(3 * v, 3 * v + 3), 3 * j); N.set(this.N.slice(3 * v, 3 * v + 3), 3 * j); UV.set(this.UV.slice(2 * v, 2 * v + 2), 2 * j); }
    return {P, N, UV, I: Uint32Array.from(this.I, i => map[i])};
  }
}

/** A planar quad of 2 triangles with its own 4 vertices (flat normal n, hard edges); corners in any consistent order. */
function quad(out, corners, n, uvOf) {
  const ids = corners.map(p => out.vert(p, n, uvOf(p)));
  out.tri(ids[0], ids[1], ids[2], n); out.tri(ids[0], ids[2], ids[3], n);
  return 2;
}

// ---- quality metrics (also used by the evidence script and the tests) --------------------------------------------------
/**
 * Triangle quality over the faces selected by `pick(geom, f)`: degenerate (an edge < 1e-6 m or area < 1e-10 m^2), sliver (min angle
 * < 1 deg), thin (min angle < 5 deg), flipped (winding normal opposite the mean of its vertex normals), and the min angle.
 */
export function triangleQuality(M, pick = () => true) {
  const out = {triangles: 0, degenerate: 0, sliver: 0, thin: 0, flipped: 0, minAngleDeg: 180, areaM2: 0};
  for (let f = 0; f < M.I.length / 3; f++) {
    const g = faceGeom(M.P, M.I, f);
    if (!pick(g, f)) continue;
    out.triangles++; out.areaM2 += g.area;
    if (g.emin < 1e-6 || g.area < 1e-10) { out.degenerate++; continue; }
    if (g.minAngle < 1) out.sliver++;
    if (g.minAngle < 5) out.thin++;
    out.minAngleDeg = Math.min(out.minAngleDeg, g.minAngle);
    const vn = [0, 1, 2].map(k => M.N[3 * M.I[3 * f] + k] + M.N[3 * M.I[3 * f + 1] + k] + M.N[3 * M.I[3 * f + 2] + k]);
    if (dot(vn, g.n) < 0) out.flipped++;
  }
  out.areaM2 = r6(out.areaM2); out.minAngleDeg = r4(out.minAngleDeg);
  return out;
}

/**
 * Orthographic ray probe along one axis: rays start outside (direction `dir` = [axis, sign] travelling toward -sign) on a regular
 * grid over the rectangle `rect` = [[a0, a1], [b0, b1]] of the two other axes (in xyz order). Per ray: all hits sorted from the
 * viewer; the summary reports holes (0 hits), the first-hit depth spread, and the RMS angle between the first hit's winding
 * normal / interpolated shading normal and the expected outward axis (what a viewer sees: flat panel -> 0 deg).
 */
export function rayProbe(M, {axis, sign, rect, steps = [24, 24], pick = null}) {
  const o = [0, 1, 2].filter(k => k !== axis), want = [0, 0, 0]; want[axis] = sign;
  const tris = [];
  for (let f = 0; f < M.I.length / 3; f++) {
    const g = faceGeom(M.P, M.I, f);
    if (g.area <= 0 || (pick && !pick(g, f))) continue;
    tris.push(f);
  }
  const rays = [];
  for (let i = 0; i < steps[0]; i++) for (let j = 0; j < steps[1]; j++) {
    const a = rect[0][0] + (i + 0.5) / steps[0] * (rect[0][1] - rect[0][0]), b = rect[1][0] + (j + 0.5) / steps[1] * (rect[1][1] - rect[1][0]);
    const hits = [];
    for (const f of tris) {
      const ia = M.I[3 * f], ib = M.I[3 * f + 1], ic = M.I[3 * f + 2];
      const ax = M.P[3 * ia + o[0]], ay = M.P[3 * ia + o[1]], bx = M.P[3 * ib + o[0]], by = M.P[3 * ib + o[1]], cx = M.P[3 * ic + o[0]], cy = M.P[3 * ic + o[1]];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(d) < 1e-14) continue;
      const w0 = ((by - cy) * (a - cx) + (cx - bx) * (b - cy)) / d, w1 = ((cy - ay) * (a - cx) + (ax - cx) * (b - cy)) / d, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const depth = w0 * M.P[3 * ia + axis] + w1 * M.P[3 * ib + axis] + w2 * M.P[3 * ic + axis];
      const sn = unit([0, 1, 2].map(k => w0 * M.N[3 * ia + k] + w1 * M.N[3 * ib + k] + w2 * M.N[3 * ic + k]));
      hits.push({depth, f, sn});
    }
    hits.sort((p, q) => sign * (q.depth - p.depth));
    rays.push(hits);
  }
  const first = rays.filter(h => h.length).map(h => h[0]);
  const angle = n => Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(n, want))))) * 180 / Math.PI;
  const rms = arr => (arr.length ? Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length) : 0);
  const depths = first.map(h => h.depth);
  const hitHist = {};
  for (const h of rays) hitHist[h.length] = (hitHist[h.length] ?? 0) + 1;
  return {
    rays: rays.length, holes: rays.filter(h => !h.length).length, hitsPerRay: hitHist,
    firstHitDepthSpreadM: depths.length ? r4(Math.max(...depths) - Math.min(...depths)) : 0,
    windingNormalRmsDeg: r4(rms(first.map(h => angle(faceGeom(M.P, M.I, h.f).n)))),
    shadingNormalRmsDeg: r4(rms(first.map(h => angle(h.sn)))),
    distinctFirstHitFaces: new Set(first.map(h => h.f)).size,
  };
}

// ---- triangle clipping by axis planes ----------------------------------------------------------------------------------
/**
 * Splits every face selected by `want(f)` by the axis planes (Sutherland–Hodgman per plane, shared edge vertices cached, attributes
 * interpolated, the cut coordinate set exactly); other faces pass through. Returns {out: MeshOut copy with faces as [a, b, c]
 * index triples, faces}. Zero-area fan pieces are dropped.
 */
function clipFaces(M, planes, want) {
  const out = new MeshOut(M), cache = new Map(), faces = [];
  const edgeVertex = (i, j, ax, val) => {
    const [p, q] = i < j ? [i, j] : [j, i], k = `${p}_${q}_${ax}_${val}`;
    let v = cache.get(k);
    if (v === undefined) {
      const a = out.P[3 * p + ax], b = out.P[3 * q + ax], t = (val - a) / (b - a);
      const pos = [0, 1, 2].map(c => (c === ax ? val : out.P[3 * p + c] + t * (out.P[3 * q + c] - out.P[3 * p + c])));
      const n = [0, 1, 2].map(c => out.N[3 * p + c] + t * (out.N[3 * q + c] - out.N[3 * p + c]));
      const uv = [0, 1].map(c => out.UV[2 * p + c] + t * (out.UV[2 * q + c] - out.UV[2 * p + c]));
      v = out.vert(pos, n, uv); cache.set(k, v);
    }
    return v;
  };
  for (let f = 0; f < M.I.length / 3; f++) {
    let polys = [[M.I[3 * f], M.I[3 * f + 1], M.I[3 * f + 2]]];
    if (want(f)) for (const {axis, value} of planes) {
      const next = [];
      for (const poly of polys) {
        const d = poly.map(i => { const x = out.P[3 * i + axis] - value; return Math.abs(x) < 1e-9 ? 0 : x; });
        if (d.every(x => x <= 0) || d.every(x => x >= 0)) { next.push(poly); continue; }
        const lo = [], hi = [];
        for (let k = 0; k < poly.length; k++) {
          const i = poly[k], j = poly[(k + 1) % poly.length], di = d[k], dj = d[(k + 1) % poly.length];
          if (di <= 0) lo.push(i); if (di >= 0) hi.push(i);
          if ((di < 0 && dj > 0) || (di > 0 && dj < 0)) { const v = edgeVertex(i, j, axis, value); lo.push(v); hi.push(v); }
        }
        if (lo.length >= 3) next.push(lo); if (hi.length >= 3) next.push(hi);
      }
      polys = next;
    }
    for (const poly of polys) for (let k = 1; k + 1 < poly.length; k++) {
      const t = [poly[0], poly[k], poly[k + 1]];
      const A = P3(out, t[0]), B = P3(out, t[1]), C = P3(out, t[2]);
      if (len(cross(sub(B, A), sub(C, A))) < 2e-12) continue;
      faces.push(t);
    }
  }
  return {out, faces};
}

// ======================================================================================================================
// Supply cabinet (base:cabinetTall)
// ======================================================================================================================
/** Values found by inspection on cabinet-tall-t25.glb (2026-10-30); the repair re-measures them and throws on a mismatch. */
export const CABINET_TALL_REPAIR = {
  expect: {fins: 32, slats: 13, bbox: {min: [-0.5415, 0, -0.2915], max: [0.5415, 1.9, 0.2915]}, backPostFrontZ: -0.26, frontPostBackZ: 0.24, plinthTopY: 0.084, postOuterX: 0.5415, postTopY: 1.851, frontZ: 0.27, tol: 0.004},
  // classification (output frame): a fin is a narrow vertical component outside the inner wall; a slat a full-width strip on top
  fin: {minAbsX: 0.505, maxSizeX: 0.04, minSizeYFrac: 0.5, maxSizeZ: 0.07},
  slat: {topBand: 0.055, minSizeXFrac: 0.9, maxSizeZ: 0.08},
  // hidden faces the fins / slats used to cover (now enclosed by the new panel / cap): the inner wall's outward faces, the
  // inner top plate's upper faces
  innerWallAbsX: [0.5, 0.516], topPlateY: [1.868, 1.888],
  panelInset: 0.0015,           // side panel 1.5 mm inside the corner posts' outer faces (posts read as the frame; no coplanar overlap)
  panelOverlap: 0.002,          // panel edges tucked 2 mm into the posts / plinth (no slit)
  doorRegionTopY: 0.974 * 1.9,  // items/lootLayout.ts CABINET_SPECS.cabinetTall.y1 x PROP_DEFS h: the cap stays above the door cut
  // UV sources (back-panel coordinates x, y on the cabinet's own clean painted back, island measured by fitAffine; the stencilled
  // '3' sits at x 0.24..0.40, y 1.55..1.80 and a scuff at x 0.19..0.40, y ~1.45: avoided)
  sideSrcX: {right: -0.47, left: -0.40},   // + panel depth (0.504 m): right x -0.47..0.034, left (mirrored) -0.40..0.104
  topSrc: {x0: -0.47, y0: 0.30},           // top: depth (0.56 m) along back x, width (1.083 m) along back y 0.30..1.383
};

export function repairCabinetTall(M, opt = CABINET_TALL_REPAIR) {
  const E = opt.expect, tol = E.tol, bb = bboxOf(M.P);
  for (let k = 0; k < 3; k++) if (Math.abs(bb.min[k] - E.bbox.min[k]) > 1e-3 || Math.abs(bb.max[k] - E.bbox.max[k]) > 1e-3) throw new Error(`cabinet repair: bbox ${bb.min} .. ${bb.max} is not the fitted footprint`);
  const W2 = bb.max[0], H = bb.max[1], zBack = bb.min[2];
  const nf = M.I.length / 3, G = Array.from({length: nf}, (_, f) => faceGeom(M.P, M.I, f));
  const {faceComp, comps} = components(M.P, M.I);
  const size = c => [0, 1, 2].map(k => c.max[k] - c.min[k]);
  const fins = comps.filter(c => { const s = size(c); return (c.min[0] > opt.fin.minAbsX || c.max[0] < -opt.fin.minAbsX) && s[0] < opt.fin.maxSizeX && s[1] > opt.fin.minSizeYFrac * H && s[2] < opt.fin.maxSizeZ; });
  const slats = comps.filter(c => { const s = size(c); return c.min[1] > H - opt.slat.topBand && s[0] > opt.slat.minSizeXFrac * 2 * W2 && s[2] < opt.slat.maxSizeZ; });
  if (fins.length !== E.fins || slats.length !== E.slats) throw new Error(`cabinet repair: found ${fins.length} fins / ${slats.length} slats (expected ${E.fins} / ${E.slats})`);
  const dropComp = new Set([...fins, ...slats].map(c => c.id));
  // UV source 1: the front header rail (front-most slat) front faces -> affine (x, y) -> uv (one island, exact)
  const header = slats.slice().sort((a, b) => b.max[2] - a.max[2])[0];
  const headerFaces = header.faces.filter(f => G[f].n[2] > 0.9 && G[f].area > 1e-6);
  const HDR = fitAffine(M, headerFaces, 0, 1);
  if (HDR.maxResidual > 1e-4) throw new Error(`cabinet repair: header faces are not one affine UV island (${HDR.maxResidual})`);
  // UV source 2: the painted back panel (large -Z faces at the back) -> affine (x, y) -> uv
  const backFaces = G.map((g, f) => f).filter(f => !dropComp.has(faceComp[f]) && G[f].n[2] < -0.95 && G[f].c[2] < zBack + 0.006 && Math.abs(G[f].c[0]) < W2 - 0.03 && G[f].area > 0.05);
  const BACK = fitAffine(M, backFaces, 0, 1);
  if (BACK.maxResidual > 1e-4) throw new Error(`cabinet repair: back panel is not one affine UV island (${BACK.maxResidual})`);
  const backRange = (() => { const b = bboxOf(Float32Array.from(backFaces.flatMap(f => [0, 1, 2].flatMap(k => P3(M, M.I[3 * f + k]))))); return {x: [r4(b.min[0]), r4(b.max[0])], y: [r4(b.min[1]), r4(b.max[1])]}; })();
  // hidden faces under the old fins / slats
  const hidden = f => {
    const g = G[f], ax = Math.abs(g.c[0]);
    if (Math.abs(g.n[0]) > 0.95 && Math.sign(g.n[0]) === Math.sign(g.c[0]) && ax > opt.innerWallAbsX[0] && ax < opt.innerWallAbsX[1] && g.c[1] > 0.07 && g.c[1] < H - 0.01 && g.c[2] > E.backPostFrontZ + 0.003 && g.c[2] < E.frontPostBackZ - 0.003) return 'innerWallOutward';
    if (g.n[1] > 0.95 && g.c[1] > opt.topPlateY[0] && g.c[1] < opt.topPlateY[1] && Math.abs(g.c[0]) < 0.512 && g.c[2] > zBack + 0.02 && g.c[2] < E.frontPostBackZ + 0.002) return 'topPlateUpward';
    return null;
  };
  const out = new MeshOut(M), removed = {fins: 0, slats: 0, innerWallOutward: 0, topPlateUpward: 0};
  const finIds = new Set(fins.map(c => c.id));
  const kept = [];
  for (let f = 0; f < nf; f++) {
    if (dropComp.has(faceComp[f])) { removed[finIds.has(faceComp[f]) ? 'fins' : 'slats']++; continue; }
    const h = hidden(f); if (h) { removed[h]++; continue; }
    kept.push(f); out.I.push(M.I[3 * f], M.I[3 * f + 1], M.I[3 * f + 2]);
  }
  // re-measure the frame on the kept geometry
  const side = f => Math.abs(G[f].c[0]) > 0.515;
  const mid = f => G[f].c[1] > 0.2 && G[f].c[1] < 1.7;
  const maxOf = (fs, fn) => fs.reduce((m, f) => Math.max(m, fn(f)), -Infinity), minOf = (fs, fn) => fs.reduce((m, f) => Math.min(m, fn(f)), Infinity);
  const meas = {
    backPostFrontZ: maxOf(kept.filter(f => side(f) && mid(f) && G[f].n[2] > 0.9 && G[f].c[2] < 0), f => G[f].c[2]),
    frontPostBackZ: minOf(kept.filter(f => side(f) && mid(f) && G[f].n[2] < -0.9 && G[f].c[2] > 0), f => G[f].c[2]),
    plinthTopY: maxOf(kept.filter(f => side(f) && G[f].n[1] > 0.9 && G[f].c[1] < 0.2), f => G[f].c[1]),
    postOuterX: maxOf(kept.filter(f => mid(f)), f => Math.max(...[0, 1, 2].map(k => Math.abs(M.P[3 * M.I[3 * f + k]])))),
    postTopY: maxOf(kept.filter(f => side(f) && Math.abs(G[f].c[2]) > 0.24 && G[f].n[1] > 0.9 && G[f].c[1] > 1.8), f => G[f].c[1]),
    frontZ: maxOf(kept.filter(f => side(f) && mid(f) && G[f].n[2] > 0.9), f => G[f].c[2]),
  };
  for (const [k, v] of Object.entries(meas)) if (!(Math.abs(v - E[k]) <= tol)) throw new Error(`cabinet repair: measured ${k} ${v} (expected ~${E[k]})`);
  // ---- new geometry ----
  const yS = Math.max(meas.postTopY, opt.doorRegionTopY) + 0.0005;            // cap skirts' bottom edge (above posts and door cut)
  const xP = meas.postOuterX - opt.panelInset;                                // side panel plane
  const z0 = meas.backPostFrontZ - opt.panelOverlap, z1 = meas.frontPostBackZ + opt.panelOverlap;
  const y0 = meas.plinthTopY - opt.panelOverlap, y1 = yS + 0.0025;            // panel top tucked behind the cap's side skirt
  const zF = meas.frontZ;
  const back = (x, y) => BACK.at(x, y), hdr = (x, y) => HDR.at(x, y);
  const added = [];
  const add = (name, corners, n, uvOf, source) => { quad(out, corners, n, uvOf); added.push({name, normal: n, corners: corners.map(p => p.map(r4)), uvSource: source}); };
  const depth = z1 - z0;
  add('side-panel-right', [[xP, y0, z1], [xP, y0, z0], [xP, y1, z0], [xP, y1, z1]], [1, 0, 0], ([, y, z]) => back(opt.sideSrcX.right + (z - z0), y), `back panel x ${r4(opt.sideSrcX.right)}..${r4(opt.sideSrcX.right + depth)}`);
  add('side-panel-left', [[-xP, y0, z0], [-xP, y0, z1], [-xP, y1, z1], [-xP, y1, z0]], [-1, 0, 0], ([, y, z]) => back(opt.sideSrcX.left + (z1 - z), y), `back panel x ${r4(opt.sideSrcX.left)}..${r4(opt.sideSrcX.left + depth)} (mirrored)`);
  const capD = zF - zBack, sy = 1;   // top: back x <- cabinet z (depth), back y <- cabinet x (width)
  add('cap-top', [[-W2, H, zBack], [-W2, H, zF], [W2, H, zF], [W2, H, zBack]], [0, 1, 0], ([x, , z]) => back(opt.topSrc.x0 + (z - zBack), opt.topSrc.y0 + sy * (x + W2)), `back panel x ${r4(opt.topSrc.x0)}..${r4(opt.topSrc.x0 + capD)}, y ${r4(opt.topSrc.y0)}..${r4(opt.topSrc.y0 + 2 * W2)} (rotated)`);
  add('cap-front', [[-W2, yS, zF], [W2, yS, zF], [W2, H, zF], [-W2, H, zF]], [0, 0, 1], ([x, y]) => hdr(x, y), 'front header rail (same texels as the removed header strip)');
  add('cap-back', [[W2, yS, zBack], [-W2, yS, zBack], [-W2, H, zBack], [W2, H, zBack]], [0, 0, -1], ([x, y]) => hdr(-x, y), 'front header rail (mirrored)');
  const zMid = (zF + zBack) / 2;
  add('cap-right', [[W2, yS, zF], [W2, yS, zBack], [W2, H, zBack], [W2, H, zF]], [1, 0, 0], ([, y, z]) => hdr(zMid - z, y), 'front header rail (centre part)');
  add('cap-left', [[-W2, yS, zBack], [-W2, yS, zF], [-W2, H, zF], [-W2, H, zBack]], [-1, 0, 0], ([, y, z]) => hdr(z - zMid, y), 'front header rail (centre part)');
  const R = out.finish();
  const bb2 = bboxOf(R.P);
  for (let k = 0; k < 3; k++) if (Math.abs(bb2.min[k] - bb.min[k]) > 1e-6 || Math.abs(bb2.max[k] - bb.max[k]) > 1e-6) throw new Error(`cabinet repair changed the bbox: ${bb2.min} .. ${bb2.max}`);
  const info = {
    version: GEOM_REPAIR_VERSION, method: 'repairCabinetTall (tools/asset-pipeline/props/lib/local-repair-geom.mjs)',
    rootCause: `Meshy T2.5 reconstructed the plain painted side panels as ${fins.length} separate vertical fins (${fins.length / 2} per side, each a closed blob ~2-3 cm wide standing 3 cm proud of a thin inner wall at |x| 0.51 with ~1 cm gaps) and the top as ${slats.length} transverse slats; the fins / slats are also painted with dark-grey streaks. Shading across fins and gaps reads as accordion lines. Not a normal / normal-map / simplification issue (the cabinet was never simplified; its normal map is calm).`,
    removed: {...removed, finComponents: fins.length, slatComponents: slats.length},
    added: {faces: added.length, triangles: 2 * added.length, quads: added},
    measured: Object.fromEntries(Object.entries(meas).map(([k, v]) => [k, r4(v)])),
    planes: {sidePanelX: r4(xP), sidePanelZ: [r4(z0), r4(z1)], sidePanelY: [r4(y0), r4(y1)], capY: [r4(yS), r4(H)], capZ: [r4(zBack), r4(zF)], capX: [r4(-W2), r4(W2)]},
    uvSources: {backPanel: {...fitRecord(BACK), range: backRange}, frontHeader: fitRecord(HDR)},
    triangles: {before: nf, after: R.I.length / 3},
    keeps: 'front, doors (runtime split region |x| < 0.499, y 0.129..1.8506, z > 0.2495 untouched), handles, hinges, corner posts, plinth, feet, back panel, interior shell and the exact bbox',
  };
  return {...R, info};
}

// ======================================================================================================================
// Platform bench (base:bench)
// ======================================================================================================================
/** Values found by inspection on bench-t25.glb (2026-10-30); the repair re-measures the plates / chains and throws on mismatch. */
export const BENCH_REPAIR = {
  // teal L side plates (end, divider, divider, end) — centres; their bay-facing side faces are measured
  plates: [-0.85, -0.263, 0.273, 0.855],
  expectBays: [[-0.823, -0.289], [-0.237, 0.249], [0.298, 0.829]], bayTol: 0.006,
  // clean cut planes (ray / slice probes 2026-10-30): the fillet is clean below y 0.386 in all bays, the back corner below 0.33, the
  // rolled top rail above 0.725; the zone between them is rebuilt
  yFront: 0.386, yBack: 0.325, yTop: 0.73, zSplit: -0.15, envelope: 0.004, plateMargin: 0.002, exemptReach: 0.004,
  // ideal profile (z, y) measured on the clean parts: seat fillet (vertical ray profile z -> y, same in every bay), then the front
  // face leaning back 7 mm (z -0.1105 at y 0.41 -> the rail's cut edge at y 0.73); back face z -0.238 with the bottom corner
  // rounding (-0.2365 @ 0.330, -0.2378 @ 0.335) and the start of the rail's rounding (-0.2365 @ 0.722)
  filletRows: [[-0.094, 0.388], [-0.097, 0.390], [-0.1, 0.392], [-0.1025, 0.394], [-0.105, 0.397], [-0.107, 0.4], [-0.1088, 0.404], [-0.1105, 0.41]],
  frontFaceRows: [0.47, 0.54, 0.61, 0.68, 0.722],
  backRows: [[-0.2365, 0.33], [-0.2378, 0.335], [-0.238, 0.34], [-0.238, 0.42], [-0.238, 0.52], [-0.238, 0.62], [-0.238, 0.715], [-0.2365, 0.722]],
  columnSpacing: 0.14,
  // UV sources: the bay's seat-top paint (mirrored at the fillet: continuous with the kept seat) for the front; the bay's
  // seat-bottom paint (rotated, avoiding the under-seat bracket footprint baked into it) for the back
  seatTopZMax: 0.21, seatBottomZ: 0.215, bracketMargin: 0.015,
};

/** Builds the strip between a chain (old cut-edge vertices, sorted by x) and a regular row (same x span); outward = want. */
function zipper(out, chain, row, wantAt) {
  let i = 0, j = 0;
  const X = v => out.P[3 * v];
  while (i < chain.length - 1 || j < row.length - 1) {
    const advChain = j >= row.length - 1 || (i < chain.length - 1 && X(chain[i + 1]) <= X(row[j + 1]));
    if (advChain) { out.tri(chain[i], chain[i + 1], row[j], wantAt(X(chain[i]))); i++; } else { out.tri(chain[i], row[j + 1], row[j], wantAt(X(row[j]))); j++; }
  }
}

export function repairBenchBackrest(M, opt = BENCH_REPAIR) {
  const nf0 = M.I.length / 3, bb = bboxOf(M.P);
  const G0 = Array.from({length: nf0}, (_, f) => faceGeom(M.P, M.I, f));
  // ---- plates: bay-facing side faces (|n.x| > 0.9 near each plate centre, backrest height) ----
  const plates = opt.plates.map(xc => {
    const pos = [Infinity, -Infinity], neg = [Infinity, -Infinity];
    for (let f = 0; f < nf0; f++) {
      const g = G0[f]; if (Math.abs(g.n[0]) < 0.9 || Math.abs(g.c[0] - xc) > 0.04 || g.c[1] < 0.3 || g.c[1] > 0.76 || g.area < 1e-7) continue;
      const r = g.n[0] > 0 ? pos : neg;
      for (let k = 0; k < 3; k++) { const x = M.P[3 * M.I[3 * f + k]]; r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); }
    }
    return {xc, pos, neg};
  });
  const bays = [];
  for (let k = 0; k + 1 < plates.length; k++) {
    const L = plates[k].pos, R = plates[k + 1].neg;   // left plate's +x face, right plate's -x face
    const bay = {i: k, faceL: L.map(r4), faceR: R.map(r4), xa: L[0] - opt.plateMargin, xb: R[1] + opt.plateMargin, inL: L[1] + opt.exemptReach, inR: R[0] - opt.exemptReach};
    const e = opt.expectBays[k];
    if (!(Math.abs(L[1] - e[0]) < opt.bayTol && Math.abs(R[0] - e[1]) < opt.bayTol)) throw new Error(`bench repair: bay ${k} plate faces ${L} / ${R} (expected ~${e})`);
    bays.push(bay);
  }
  // ---- UV sources per bay (largest affine island among the selected faces) ----
  const isl = islands(M.I, M.P.length / 3);
  const islandFit = (faces, ia, ib, what) => {
    const by = new Map(); for (const f of faces) { const k = isl[f]; by.set(k, (by.get(k) ?? 0) + G0[f].area); }
    const best = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const F = fitAffine(M, faces.filter(f => isl[f] === best), ia, ib);
    if (F.maxResidual > 2e-4) throw new Error(`bench repair: ${what} is not an affine UV island (${F.maxResidual})`);
    return F;
  };
  // under-seat brackets (small separate parts just below the seat bottom) whose footprint is baked into the seat-bottom paint
  const {faceComp, comps} = components(M.P, M.I);
  const brackets = comps.filter(c => c.min[1] > 0.284 && c.max[1] < 0.296 && c.max[0] - c.min[0] < 0.12).map(c => [c.min[0], c.max[0]]);
  void faceComp;
  for (const bay of bays) {
    const inBay = g => g.c[0] > bay.inL + 0.02 && g.c[0] < bay.inR - 0.02;
    bay.top = islandFit(G0.map((g, f) => f).filter(f => G0[f].n[1] > 0.98 && Math.abs(G0[f].c[1] - 0.38) < 0.004 && G0[f].c[2] > -0.05 && G0[f].c[2] < 0.2 && inBay(G0[f])), 0, 2, `bay ${bay.i} seat top`);
    bay.bot = islandFit(G0.map((g, f) => f).filter(f => G0[f].n[1] < -0.98 && G0[f].c[1] > 0.2905 && G0[f].c[1] < 0.296 && inBay(G0[f])), 0, 2, `bay ${bay.i} seat bottom`);
    // clean x-range of the seat bottom (largest gap free of baked bracket footprints)
    let lo = bay.inL + 0.01, hi = bay.inR - 0.01;
    const cuts = brackets.filter(([a, b]) => b > lo && a < hi).map(([a, b]) => [a - opt.bracketMargin, b + opt.bracketMargin]);
    const gaps = []; let x = lo; for (const [a, b] of cuts.sort((p, q) => p[0] - q[0])) { if (a > x) gaps.push([x, a]); x = Math.max(x, b); } if (hi > x) gaps.push([x, hi]);
    [lo, hi] = gaps.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    bay.botClean = [lo, hi];
  }
  // ---- clip the old mesh on the cut planes inside each bay box ----
  const planes = bays.flatMap(b => [{axis: 0, value: b.xa}, {axis: 0, value: b.xb}]).concat([{axis: 1, value: opt.yBack}, {axis: 1, value: opt.yFront}, {axis: 1, value: opt.yTop}]);
  const boxHit = f => { const g = G0[f]; return bays.some(b => g.c[0] > b.xa - 0.1 && g.c[0] < b.xb + 0.1) && g.c[1] > opt.yBack - 0.08 && g.c[1] < opt.yTop + 0.08 && g.c[2] < -0.04; };
  const {out, faces} = clipFaces(M, planes, boxHit);
  // ideal profile z bands
  const frontRows = [...opt.filletRows];
  const zFrontAt = (y, zTop) => {
    if (y <= opt.filletRows[0][1]) return opt.filletRows[0][0];
    for (let k = 0; k + 1 < frontRows.length; k++) if (y <= frontRows[k + 1][1]) { const [za, ya] = frontRows[k], [zb, yb] = frontRows[k + 1]; return za + (zb - za) * (y - ya) / (yb - ya); }
    const [z0, y0] = frontRows[frontRows.length - 1]; return z0 + (zTop - z0) * (y - y0) / (opt.yTop - y0);
  };
  const zBackAt = y => (y < 0.33 ? -0.234 - 0.0025 * (y - 0.325) / 0.005 : y < 0.335 ? -0.2365 : -0.238);
  const bayOf = x => bays.find(b => x > b.xa && x < b.xb);
  const zone = (c, zTop) => {
    if (c[1] <= opt.yBack || c[1] >= opt.yTop) return false;
    const zf = c[1] > opt.yFront ? zFrontAt(c[1], zTop) + opt.envelope : opt.zSplit;
    return c[2] > zBackAt(c[1]) - opt.envelope && c[2] < zf;
  };
  // the front cut edge's z at the rail (needed by the zone's front face line): from the kept rail vertices at y == yTop
  const railZ = {};
  for (const b of bays) {
    const zs = [];
    for (let v = 0; v < out.nv; v++) if (Math.abs(out.P[3 * v + 1] - opt.yTop) < 1e-7 && out.P[3 * v] > b.inL && out.P[3 * v] < b.inR && out.P[3 * v + 2] > -0.135 && out.P[3 * v + 2] < -0.1) zs.push(out.P[3 * v + 2]);
    if (!zs.length) throw new Error(`bench repair: bay ${b.i} no rail front edge at y ${opt.yTop}`);
    railZ[b.i] = zs.reduce((s, z) => s + z, 0) / zs.length;
  }
  const keptFaces = [], removedFaces = [];
  for (const t of faces) {
    const A = P3(out, t[0]), B = P3(out, t[1]), C = P3(out, t[2]);
    const c = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], n = unit(cross(sub(B, A), sub(C, A)));
    const bay = bayOf(c[0]);
    if (bay && zone(c, railZ[bay.i]) && !(Math.abs(n[0]) > 0.85 && (c[0] < bay.inL || c[0] > bay.inR))) removedFaces.push(t); else keptFaces.push(t);
  }
  out.I = keptFaces.flat();
  // ---- chains: kept cut-edge vertices on each cut line (slab faces only; bay proper), sorted by x ----
  const vertFaceNx = new Map();
  for (const t of keptFaces) { const A = P3(out, t[0]), B = P3(out, t[1]), C = P3(out, t[2]); const n = unit(cross(sub(B, A), sub(C, A))); for (const v of t) vertFaceNx.set(v, Math.min(vertFaceNx.get(v) ?? 1, Math.abs(n[0]))); }
  const chain = (bay, y, z0, z1) => {
    const pts = [];
    for (const [v, nx] of vertFaceNx) {
      const p = P3(out, v);
      if (nx > 0.5 || Math.abs(p[1] - y) > 1e-7 || p[2] < z0 || p[2] > z1 || p[0] <= bay.faceL[1] || p[0] >= bay.faceR[0]) continue;
      pts.push(v);
    }
    pts.sort((a, b) => out.P[3 * a] - out.P[3 * b] || a - b);
    const ded = []; for (const v of pts) { const l = ded[ded.length - 1]; if (l === undefined || len(sub(P3(out, v), P3(out, l))) > 3e-4) ded.push(v); }
    if (ded.length < 2) throw new Error(`bench repair: bay ${bay.i} chain at y ${y} has ${ded.length} vertices`);
    return ded;
  };
  const info = {version: GEOM_REPAIR_VERSION, method: 'repairBenchBackrest (tools/asset-pipeline/props/lib/local-repair-geom.mjs)', bays: []};
  let added = 0;
  for (const bay of bays) {
    const zTop = railZ[bay.i];
    const FB = chain(bay, opt.yFront, -0.1, -0.075), FT = chain(bay, opt.yTop, -0.135, -0.1), BT = chain(bay, opt.yTop, -0.25, -0.215), BB = chain(bay, opt.yBack, -0.25, -0.22);
    const zBT = BT.reduce((s, v) => s + out.P[3 * v + 2], 0) / BT.length;
    const nseg = Math.max(2, Math.ceil((bay.xb - bay.xa) / opt.columnSpacing));
    const xs = Array.from({length: nseg + 1}, (_, k) => bay.xa + (bay.xb - bay.xa) * k / nseg);
    // profiles (z, y) between the chains; s = arc length from the bottom chain
    const zFB = FB.reduce((s, v) => s + out.P[3 * v + 2], 0) / FB.length, zBB = BB.reduce((s, v) => s + out.P[3 * v + 2], 0) / BB.length;
    const front = [[zFB, opt.yFront], ...opt.filletRows, ...opt.frontFaceRows.map(y => [zFrontAt(y, zTop), y]), [zTop, opt.yTop]];
    const backP = [[zBB, opt.yBack], ...opt.backRows, [zBT, opt.yTop]];
    const arc = prof => { const s = [0]; for (let k = 1; k < prof.length; k++) s.push(s[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1])); return s; };
    const sF = arc(front), sB = arc(backP);
    // profile normals (central differences): front faces +z / up, back faces -z / down
    const profN = (prof, k, outward) => {
      const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)], dz = b[0] - a[0], dy = b[1] - a[1];
      return outward > 0 ? unit([0, -dz, dy]) : unit([0, dz, -dy]);
    };
    // UV maps
    const T = bay.top, Bt = bay.bot;
    // front: mirror of the seat top at the fillet cut (zc = seat-top z whose texels meet the cut edge; least squares over FB)
    const gz = [T.u[1], T.v[1]], gzz = gz[0] * gz[0] + gz[1] * gz[1];
    const zc = FB.reduce((s, v) => { const x = out.P[3 * v], base = T.at(x, 0); return s + ((out.UV[2 * v] - base[0]) * gz[0] + (out.UV[2 * v + 1] - base[1]) * gz[1]) / gzz; }, 0) / FB.length;
    const kf = Math.min(1, (opt.seatTopZMax - zc) / sF[sF.length - 1]);
    const uvFront = (x, s) => T.at(x, zc + kf * s);
    // back: seat-bottom paint, rotated: back arc s -> seat-bottom x (clean range), bay x -> seat-bottom z
    const [cx0, cx1] = bay.botClean, kb = Math.min(1, (cx1 - cx0) / sB[sB.length - 1]);
    const uvBack = (x, s) => Bt.at(cx0 + kb * s, -opt.seatBottomZ + 2 * opt.seatBottomZ * (x - bay.xa) / (bay.xb - bay.xa));
    const tris0 = out.I.length / 3;
    const build = (prof, sArr, bottom, top, outward, uvOf) => {
      // bottom / top chains re-emitted as NEW vertices (same position + normal, UV from this surface's map: a UV seam, no gap)
      const re = (vs, s) => vs.map(v => out.vert(P3(out, v), [out.N[3 * v], out.N[3 * v + 1], out.N[3 * v + 2]], uvOf(out.P[3 * v], s)));
      // chain ends are extended to the bay box (inside the plates) at the end vertex's position / normal
      const extend = (vs, s) => {
        const r = re(vs, s), a = r[0], b = r[r.length - 1];
        const pa = P3(out, a), pb = P3(out, b);
        if (pa[0] > bay.xa + 1e-6) r.unshift(out.vert([bay.xa, pa[1], pa[2]], [out.N[3 * a], out.N[3 * a + 1], out.N[3 * a + 2]], uvOf(bay.xa, s)));
        if (pb[0] < bay.xb - 1e-6) r.push(out.vert([bay.xb, pb[1], pb[2]], [out.N[3 * b], out.N[3 * b + 1], out.N[3 * b + 2]], uvOf(bay.xb, s)));
        return r;
      };
      const rows = [];
      for (let k = 1; k < prof.length - 1; k++) rows.push(xs.map(x => out.vert([x, prof[k][1], prof[k][0]], profN(prof, k, outward), uvOf(x, sArr[k]))));
      const cb = extend(bottom, 0), ct = extend(top, sArr[sArr.length - 1]);
      const wantRow = k => x => { void x; const n = profN(prof, k, outward); return n; };
      zipper(out, cb, rows[0], wantRow(0));
      for (let k = 0; k + 1 < rows.length; k++) for (let c = 0; c + 1 < xs.length; c++) {
        const w = profN(prof, k + 1, outward);
        out.tri(rows[k][c], rows[k][c + 1], rows[k + 1][c + 1], w); out.tri(rows[k][c], rows[k + 1][c + 1], rows[k + 1][c], w);
      }
      zipper(out, ct, rows[rows.length - 1], wantRow(prof.length - 1));
    };
    build(front, sF, FB, FT, +1, uvFront);
    build(backP, sB, BB, BT, -1, uvBack);
    const addedHere = out.I.length / 3 - tris0;
    added += addedHere;
    info.bays.push({bay: bay.i, x: [r4(bay.xa), r4(bay.xb)], plateFaces: {left: bay.faceL, right: bay.faceR}, chains: {frontBottom: FB.length, frontTop: FT.length, backTop: BT.length, backBottom: BB.length},
      railFrontZ: r4(zTop), railBackZ: r4(zBT), columns: nseg, newTriangles: addedHere,
      uv: {front: {source: 'seat top of this bay (mirrored at the fillet cut: continuous with the kept seat)', fit: fitRecord(T), zAtCut: r4(zc), compress: r4(kf)},
        back: {source: 'seat bottom of this bay (rotated; under-seat bracket footprint avoided)', fit: fitRecord(Bt), cleanX: bay.botClean.map(r4), compress: r4(kb)}}});
  }
  const R = out.finish();
  const bb2 = bboxOf(R.P);
  for (let k = 0; k < 3; k++) if (Math.abs(bb2.min[k] - bb.min[k]) > 1e-6 || Math.abs(bb2.max[k] - bb.max[k]) > 1e-6) throw new Error(`bench repair changed the bbox: ${bb2.min} .. ${bb2.max}`);
  Object.assign(info, {
    rootCause: 'Meshy T2.5 reconstructed the three perforated backrest panels as torn shells: front / back faces with holes, fans of sliver triangles converging on single points, shard walls inside the 12 cm slab (y 0.33..0.725 in every bay); present in the native output (the 8173 -> 7999 seam-preserving simplification is not the cause). The seat, the seat fillet below y 0.386, the rolled top rail above y 0.725 and the teal L side plates are clean.',
    cut: {planes: {yFront: opt.yFront, yBack: opt.yBack, yTop: opt.yTop, bayX: bays.map(b => [r4(b.xa), r4(b.xb)])}, envelopeM: opt.envelope, removedTriangles: removedFaces.length, note: 'old triangles clipped exactly on the planes (attributes interpolated); pieces inside the slab envelope of a bay removed, the plates\' side faces kept'},
    added: {triangles: added},
    triangles: {before: nf0, afterClip: faces.length, after: R.I.length / 3},
    keeps: 'seat (top, nose, bottom), seat fillet below the cut, rolled top rail, teal L side plates, legs, foot plates, bolts, brackets and the exact bbox (collider / placement unchanged)',
  });
  return {...R, info};
}
