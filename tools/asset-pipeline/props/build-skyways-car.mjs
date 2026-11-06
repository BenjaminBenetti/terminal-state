// Skyways lane ASSET-B: the HERO PRIZE CAR runtime model (first-person drivable; pristine) from the user's community-supplied source
//   reference/tasks/skyways-level-20261106-054448/masters/Meshy_AI_sports_car_model_1106041732_image-to-3d-texture.glb
// (1.04 M triangles, one closed opaque shell, base / metallic-roughness / normal maps; the windows are dark texture on the shell).
// The source is read-only and sha256-verified against MASTERS-SHA256.json; nothing private is shipped.
//
// Writes deterministically:
//   game/public/assets/models/skyways-prize-car.glb        nodes `body` (opaque, the source maps re-encoded) + `glass` (material
//                                                           `glass`, BLEND, dark neutral tint, own primitive)
//   game/public/assets/derivatives/skyways-prize-car.json  provenance (community source; no license / authorship claim)
//   game/src/assets/skywaysCar.generated.ts                SKYWAYS_CAR measured anchors (three-free)
//   tools/release/public-inputs.json                       ONLY the two entries above (others untouched)
//
// Frame: metres at real size (uniform scale to an overall length of 4.78 m), +Y up, NOSE toward -Z (runtime forward at yaw 0),
// grounded (min y = 0), centred on the x / z footprint, baked into the vertices (identity nodes). Driver = LEFT seat (-X).
//
// Glass (deterministic): every source triangle gets a texture-sampled colour (4 samples of the base map) and is a glass candidate
// only inside the greenhouse zone (centroid above the beltline y > BELT_Y, |x| < ZONE_HALF_X: never tyres / grille / lights / sills /
// mirrors). A soft dark + low-saturation score is median-filtered twice (area-weighted ball of radius RHO, threshold 0.5), islands
// < MIN_ISLAND m^2 are dropped and non-glass holes fully inside the zone (painted interior seen through the windscreen, defroster
// lines) are filled. Then the FIRST-PERSON LOOK-THROUGH rule (the shell is hollow): from a nominal driver eye, a glass triangle whose
// sight line — glass transparent — next meets the shell's INSIDE is dark trim, not window (the cowl / wiper plenum, mirror sails,
// recessed frame bands) and goes back to the body. The triangle-level outline is then replaced by the 0.5 iso-line of a smooth
// per-vertex field (the mask convolved with a tent kernel of radius SMOOTH_R over ~1 cm surface samples): the straddling triangles
// are SPLIT exactly on it (positions / normals / UVs interpolated; positions computed from the welded edge so UV-seam duplicates
// stay bit-identical), so the body hole and the glass share one boundary. The glass triangles get their own vertex copies: the
// window outline becomes an attribute seam, so one meshoptimizer simplifyWithAttributes pass (UV and normal attributes, seams
// preserved, positions never moved) keeps body and glass edge-for-edge identical (verified: body + glass welded by exact position
// has no open edge, like the source; 4 glass islands; a 5 deg grid of sight lines from the eye never looks through glass into the
// hollow shell; the required windscreen / side-window sight lines leave through glass).
//
// Usage: node --max-old-space-size=3072 tools/asset-pipeline/props/build-skyways-car.mjs [--reference <dir>] [--dry]
//   --reference  the private reference/ root (default <repo>/reference; a git worktree passes the main checkout's)
//   --dry        measure + print, write nothing
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Document, NodeIO} from '@gltf-transform/core';
import {MeshoptSimplifier} from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REF = path.resolve(opt('--reference') ?? path.join(root, 'reference'));
const DRY = argv.includes('--dry');
const TASK_REL = 'tasks/skyways-level-20261106-054448';
const TASK = path.join(REF, TASK_REL);
const MASTER = 'Meshy_AI_sports_car_model_1106041732_image-to-3d-texture.glb';
const ID = 'skyways-prize-car';
const OUT_REL = `assets/models/${ID}.glb`;
const PROV_REL = `assets/derivatives/${ID}.json`;
const GEN_TS = path.join(root, 'game/src/assets/skywaysCar.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');

const LENGTH_M = 4.78;
const BODY_TRI_BUDGET = 120_000;
const TEX = {baseColor: {px: 2048, q: 88}, normal: {px: 2048, q: 90}, metallicRoughness: {px: 1024, q: 88}};
const CLASSIFY = {BELT_Y: 0.9, ZONE_HALF_X: 0.9, LUM: [30, 55], CHROMA: [20, 40], RHO: 0.03, ITERS: 2, MIN_ISLAND: 0.03, MAX_HOLE: 0.3, SMOOTH_R: 0.045};
const SIMPLIFY = {weights: {normal: 0.5, uv: 1}, maxError: 0.002};
const GLASS = {baseColorFactor: [0.04, 0.045, 0.05, 0.3], metallicFactor: 0, roughnessFactor: 0.05};
// first-person anchor conventions (documented in the generated file)
const EYE = {belowRoof: 0.25, behindHeader: 0.36};
const WHEEL_FROM_EYE = {dy: -0.33, dz: -0.5};
const EXIT_OUT = 0.7;
const N_CIRCLES = 4;
const INTERIOR_HEADROOM = 0.06, INTERIOR_BEHIND_EYE = 0.45, INTERIOR_FRONT_SLACK = 0.12;

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100, r6 = v => Math.round(v * 1e6) / 1e6;
const log = (...a) => console.log(...a);

// ---- 1. source (verified) ------------------------------------------------------------------------------------------------
const masterPath = path.join(TASK, 'masters', MASTER);
const masters = JSON.parse(fs.readFileSync(path.join(TASK, 'MASTERS-SHA256.json'), 'utf8'));
const mEntry = masters.find(e => e.file === MASTER);
if (!mEntry) throw new Error(`${MASTER} not in MASTERS-SHA256.json`);
const srcBytes = fs.readFileSync(masterPath);
if (srcBytes.length !== mEntry.bytes || sha(srcBytes) !== mEntry.sha256) throw new Error('master sha256 / size mismatch');
const srcDoc = await new NodeIO().readBinary(new Uint8Array(srcBytes));
const sRoot = srcDoc.getRoot();
if (sRoot.listMeshes().length !== 1 || sRoot.listMeshes()[0].listPrimitives().length !== 1) throw new Error('expected one mesh primitive');
for (const n of sRoot.listNodes()) if (n.getMatrix().some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) throw new Error('non-identity source node');
const sPrim = sRoot.listMeshes()[0].listPrimitives()[0];
if (sPrim.getMode() !== 4) throw new Error('triangles only');
const sMat = sPrim.getMaterial();
const S_P = sPrim.getAttribute('POSITION').getArray(), S_N = sPrim.getAttribute('NORMAL').getArray();
const UV0 = Float32Array.from(sPrim.getAttribute('TEXCOORD_0').getArray());
const I0 = Uint32Array.from(sPrim.getIndices().getArray());
const texSrc = {baseColor: sMat.getBaseColorTexture(), metallicRoughness: sMat.getMetallicRoughnessTexture(), normal: sMat.getNormalTexture()};
for (const [k, t] of Object.entries(texSrc)) if (!t) throw new Error(`source lacks ${k}`);
const srcTex = Object.fromEntries(Object.entries(texSrc).map(([k, t]) => [k, {size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}]));
const srcStats = {vertices: S_P.length / 3, triangles: I0.length / 3};
log(`source ${MASTER}: ${srcStats.triangles} tris, ${srcStats.vertices} verts, ${(srcBytes.length / 1e6).toFixed(2)} MB`);

// ---- 2. frame: nose -X (source) -> -Z, uniform scale to LENGTH_M, grounded, centred -----------------------------------------
const smin = [Infinity, Infinity, Infinity], smax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < S_P.length; i += 3) for (let k = 0; k < 3; k++) { smin[k] = Math.min(smin[k], S_P[i + k]); smax[k] = Math.max(smax[k], S_P[i + k]); }
const SCALE = LENGTH_M / (smax[0] - smin[0]);
const scx = (smin[0] + smax[0]) / 2, scz = (smin[2] + smax[2]) / 2;
const nv0 = S_P.length / 3;
const P0 = new Float32Array(S_P.length), N0 = new Float32Array(S_N.length);
// rotation about +Y by -90 deg (proper, winding kept): x' = -z, z' = x
for (let i = 0; i < S_P.length; i += 3) {
  P0[i] = -(S_P[i + 2] - scz) * SCALE; P0[i + 1] = (S_P[i + 1] - smin[1]) * SCALE; P0[i + 2] = (S_P[i] - scx) * SCALE;
  N0[i] = -S_N[i + 2]; N0[i + 1] = S_N[i + 1]; N0[i + 2] = S_N[i];
}
// position weld (exact source floats) -> adjacency
const weld0 = new Int32Array(nv0);
{
  const key = new Map();
  for (let v = 0; v < nv0; v++) { const k = `${S_P[3 * v]},${S_P[3 * v + 1]},${S_P[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld0[v] = w; }
}
const nt0 = I0.length / 3;
const adj = new Int32Array(nt0 * 3).fill(-1);
{
  const em = new Map();
  for (let f = 0; f < nt0; f++) for (let e = 0; e < 3; e++) {
    const u = weld0[I0[3 * f + e]], v = weld0[I0[3 * f + (e + 1) % 3]];
    const k = u < v ? u * 1048576 + v : v * 1048576 + u;
    const o = em.get(k);
    if (o === undefined) em.set(k, 3 * f + e); else { adj[3 * f + e] = Math.floor(o / 3); adj[o] = f; em.delete(k); }
  }
  if (em.size) throw new Error(`source not closed: ${em.size} open edges`);
}

// ---- 3. per-triangle features (base map at 4 barycentric samples) --------------------------------------------------------
const decode = async t => { const {data, info} = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, w: info.width, h: info.height}; };
const baseImg = await decode(texSrc.baseColor);
const texel = (img, u, v) => 3 * (Math.min(img.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.h))) * img.w + Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w))));
const LUM = new Float32Array(nt0), CHR = new Float32Array(nt0), CEN = new Float32Array(nt0 * 3), FN = new Float32Array(nt0 * 3), AREA = new Float32Array(nt0);
{
  const W = [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];
  for (let f = 0; f < nt0; f++) {
    const a = I0[3 * f], b = I0[3 * f + 1], c = I0[3 * f + 2];
    let r = 0, g = 0, bl = 0;
    for (const w of W) {
      const o = texel(baseImg, w[0] * UV0[2 * a] + w[1] * UV0[2 * b] + w[2] * UV0[2 * c], w[0] * UV0[2 * a + 1] + w[1] * UV0[2 * b + 1] + w[2] * UV0[2 * c + 1]);
      r += baseImg.data[o]; g += baseImg.data[o + 1]; bl += baseImg.data[o + 2];
    }
    r /= 4; g /= 4; bl /= 4;
    LUM[f] = 0.299 * r + 0.587 * g + 0.114 * bl; CHR[f] = Math.max(r, g, bl) - Math.min(r, g, bl);
    for (let k = 0; k < 3; k++) CEN[3 * f + k] = (P0[3 * a + k] + P0[3 * b + k] + P0[3 * c + k]) / 3;
    const ux = P0[3 * b] - P0[3 * a], uy = P0[3 * b + 1] - P0[3 * a + 1], uz = P0[3 * b + 2] - P0[3 * a + 2], vx = P0[3 * c] - P0[3 * a], vy = P0[3 * c + 1] - P0[3 * a + 1], vz = P0[3 * c + 2] - P0[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
    AREA[f] = nl / 2; FN[3 * f] = nx / nl; FN[3 * f + 1] = ny / nl; FN[3 * f + 2] = nz / nl;
  }
}

// ---- 4. glass classification (triangle level) ----------------------------------------------------------------------------
function components(inSet) {
  const lab = new Int32Array(nt0).fill(-1); let n = 0; const st = [];
  for (let f = 0; f < nt0; f++) {
    if (lab[f] >= 0 || !inSet(f)) continue;
    lab[f] = n; st.push(f);
    while (st.length) { const x = st.pop(); for (let e = 0; e < 3; e++) { const h = adj[3 * x + e]; if (h >= 0 && lab[h] < 0 && inSet(h)) { lab[h] = n; st.push(h); } } }
    n++;
  }
  const out = Array.from({length: n}, () => ({faces: [], area: 0}));
  for (let f = 0; f < nt0; f++) if (lab[f] >= 0) { out[lab[f]].faces.push(f); out[lab[f]].area += AREA[f]; }
  return out;
}
/** spatial hash over points (stride 3) for radius queries */
function pointGrid(pts, idxs, cell) {
  const g = new Map();
  for (const i of idxs) { const k = `${Math.floor(pts[3 * i] / cell)},${Math.floor(pts[3 * i + 1] / cell)},${Math.floor(pts[3 * i + 2] / cell)}`; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(i); }
  return (x, y, z, r, fn) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell), rr = r * r, span = Math.ceil(r / cell);
    for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) for (let k = -span; k <= span; k++) {
      const a = g.get(`${gx + i},${gy + j},${gz + k}`); if (!a) continue;
      for (const h of a) { const dx = pts[3 * h] - x, dy = pts[3 * h + 1] - y, dz = pts[3 * h + 2] - z; if (dx * dx + dy * dy + dz * dz <= rr) fn(h); }
    }
  };
}
const C = CLASSIFY;
const zone = new Uint8Array(nt0);
const zf = [];
for (let f = 0; f < nt0; f++) if (CEN[3 * f + 1] > C.BELT_Y && Math.abs(CEN[3 * f]) < C.ZONE_HALF_X) { zone[f] = 1; zf.push(f); }
const clamp01 = v => Math.min(1, Math.max(0, v));
let cur = new Float32Array(nt0);
for (const f of zf) cur[f] = clamp01((C.LUM[1] - LUM[f]) / (C.LUM[1] - C.LUM[0])) * clamp01((C.CHROMA[1] - CHR[f]) / (C.CHROMA[1] - C.CHROMA[0]));
const seedCount = zf.filter(f => cur[f] >= 1).length;
{
  const q = pointGrid(CEN, zf, C.RHO);
  const nb = new Map(); for (const f of zf) { const a = []; q(CEN[3 * f], CEN[3 * f + 1], CEN[3 * f + 2], C.RHO, h => a.push(h)); nb.set(f, a); }
  for (let it = 0; it < C.ITERS; it++) {
    const next = new Float32Array(nt0);
    for (const f of zf) { let s = 0, a = 0; for (const h of nb.get(f)) { s += AREA[h] * cur[h]; a += AREA[h]; } next[f] = a > 0 && s / a >= 0.5 ? 1 : 0; }
    cur = next;
  }
}
const glassTri = new Uint8Array(nt0);
for (const f of zf) glassTri[f] = cur[f] ? 1 : 0;
const dropped = [];
for (const isl of components(f => glassTri[f])) if (isl.area < C.MIN_ISLAND) { dropped.push(isl.area); for (const f of isl.faces) glassTri[f] = 0; }
const filled = [];
for (const h of components(f => !glassTri[f])) {
  if (h.area > C.MAX_HOLE || h.faces.some(f => !zone[f])) continue;
  for (const f of h.faces) glassTri[f] = 1; filled.push(h.area);
}
const classifyLog = {zoneTriangles: zf.length, strongSeedTriangles: seedCount, droppedIslands: dropped.length, droppedArea: r6(dropped.reduce((s, a) => s + a, 0)), filledHoles: filled.length, filledArea: r6(filled.reduce((s, a) => s + a, 0)), glassTriangles: glassTri.reduce((s, v) => s + v, 0)};

// ---- 4b. first-person look-through rule (the source shell is hollow) ------------------------------------------------------
// Dark trim that is NOT window (the cowl / wiper plenum below the windscreen, the mirror sails) passes the colour test; seen from
// the driver it would open a view INTO the hollow shell (under the hood, inside the mirror housing). For every glass triangle visible
// from a nominal driver eye (same rules as the final anchor, on this classification), the ray through it — glass transparent — must
// leave the car or meet an OUTER body face; meeting the shell's INNER side rejects the triangle as glass.
/** uniform-grid ray caster over the full-res source (glass optionally transparent) */
const RG = (() => {
  const cell = 0.05, lo = smin.map(() => 0), dim = [0, 0, 0];
  const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P0.length; i += 3) for (let k = 0; k < 3; k++) { pmin[k] = Math.min(pmin[k], P0[i + k]); pmax[k] = Math.max(pmax[k], P0[i + k]); }
  for (let k = 0; k < 3; k++) { lo[k] = pmin[k] - 1e-3; dim[k] = Math.ceil((pmax[k] - lo[k] + 1e-3) / cell); }
  const cid = (i, j, k) => (k * dim[1] + j) * dim[0] + i;
  const ncell = dim[0] * dim[1] * dim[2], count = new Int32Array(ncell + 1);
  let RGfill = null;
  const span = f => { const a = I0[3 * f], b = I0[3 * f + 1], c = I0[3 * f + 2]; return [0, 1, 2].map(k => [Math.floor((Math.min(P0[3 * a + k], P0[3 * b + k], P0[3 * c + k]) - lo[k]) / cell), Math.floor((Math.max(P0[3 * a + k], P0[3 * b + k], P0[3 * c + k]) - lo[k]) / cell)]); };
  for (let pass = 0; pass < 2; pass++) {
    const fill = pass ? new Int32Array(count[ncell]) : null, at = pass ? count.slice() : null;
    for (let f = 0; f < nt0; f++) {
      const s = span(f);
      for (let k = s[2][0]; k <= s[2][1]; k++) for (let j = s[1][0]; j <= s[1][1]; j++) for (let i = s[0][0]; i <= s[0][1]; i++) { const c = cid(i, j, k); if (pass) fill[at[c]++] = f; else count[c + 1]++; }
    }
    if (!pass) for (let c = 0; c < ncell; c++) count[c + 1] += count[c]; else RGfill = fill;
  }
  return {cell, lo, dim, cid, count, get list() { return RGfill; }};
})();
function hitTri(f, o, d) {
  const a = 3 * I0[3 * f], b = 3 * I0[3 * f + 1], c = 3 * I0[3 * f + 2];
  const e1x = P0[b] - P0[a], e1y = P0[b + 1] - P0[a + 1], e1z = P0[b + 2] - P0[a + 2], e2x = P0[c] - P0[a], e2y = P0[c + 1] - P0[a + 1], e2z = P0[c + 2] - P0[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) return Infinity;
  const inv = 1 / det, tx = o[0] - P0[a], ty = o[1] - P0[a + 1], tz = o[2] - P0[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
/** nearest source triangle hit with t > tmin, skipping triangles where skip(f) (3D-DDA over the grid) */
function castSource(o, d, tmin, skip) {
  const {cell, lo, dim, cid, count} = RG, list = RG.list;
  let i = Math.floor((o[0] - lo[0]) / cell), j = Math.floor((o[1] - lo[1]) / cell), k = Math.floor((o[2] - lo[2]) / cell);
  const step = d.map(v => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const tMax = [0, 1, 2].map(a => (d[a] === 0 ? Infinity : ((([i, j, k][a] + (step[a] > 0 ? 1 : 0)) * cell + lo[a] - o[a]) / d[a])));
  const tDelta = d.map(v => (v === 0 ? Infinity : cell / Math.abs(v)));
  let best = Infinity, bestF = -1;
  while (i >= 0 && j >= 0 && k >= 0 && i < dim[0] && j < dim[1] && k < dim[2]) {
    const c = cid(i, j, k), tExit = Math.min(...tMax);
    for (let n = count[c]; n < count[c + 1]; n++) { const f = list[n]; if (skip && skip(f)) continue; const t = hitTri(f, o, d); if (t > tmin && t < best) { best = t; bestF = f; } }
    if (best <= tExit) break;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    if (a === 0) i += step[0]; else if (a === 1) j += step[1]; else k += step[2];
    tMax[a] += tDelta[a];
  }
  return {t: best, f: bestF};
}
const outerFacing = (f, d) => { let s = 0; for (let k = 0; k < 3; k++) { const v = I0[3 * f + k]; s += N0[3 * v] * d[0] + N0[3 * v + 1] * d[1] + N0[3 * v + 2] * d[2]; } return s < 0; };
// nominal eye: windscreen = the largest glass island ahead of the cabin; header = its highest centroid at the driver x
const NOMINAL_EYE_X = -0.36;
const nominalEye = (() => {
  const isl = components(f => glassTri[f]).filter(s => { let cx = 0, cz = 0; for (const f of s.faces) { cx += CEN[3 * f] * AREA[f]; cz += CEN[3 * f + 2] * AREA[f]; } return Math.abs(cx / s.area) < 0.25 && cz / s.area < 0; }).sort((a, b) => b.area - a.area)[0];
  let hy = -Infinity, hz = 0;
  for (const f of isl.faces) if (Math.abs(CEN[3 * f] - NOMINAL_EYE_X) < 0.03 && CEN[3 * f + 1] > hy) { hy = CEN[3 * f + 1]; hz = CEN[3 * f + 2]; }
  const z = hz + EYE.behindHeader;
  const top = RG.lo[1] + RG.dim[1] * RG.cell - 1e-6, roof = castSource([NOMINAL_EYE_X, top, z], [0, -1, 0], 0, null);
  if (!Number.isFinite(roof.t)) throw new Error('no roof above the nominal eye');
  return [NOMINAL_EYE_X, top - roof.t - EYE.belowRoof, z];
})();
const lookThrough = {nominalEye: nominalEye.map(r3), visibleGlass: 0, rejected: 0, rejectedArea: 0};
{
  const reject = [];
  const isGlass = f => glassTri[f] === 1;
  for (let f = 0; f < nt0; f++) {
    if (!glassTri[f]) continue;
    const c = [CEN[3 * f], CEN[3 * f + 1], CEN[3 * f + 2]], d0 = [c[0] - nominalEye[0], c[1] - nominalEye[1], c[2] - nominalEye[2]], tf = Math.hypot(...d0), d = d0.map(v => v / tf);
    const first = castSource(nominalEye, d, 1e-4, isGlass); // glass transparent
    if (first.t < tf - 2e-3) continue; // hidden behind the shell's inside: not visible from the eye
    lookThrough.visibleGlass++;
    if (first.f >= 0 && !outerFacing(first.f, d)) reject.push(f);
  }
  for (const f of reject) { glassTri[f] = 0; lookThrough.rejectedArea += AREA[f]; }
  lookThrough.rejected = reject.length;
  for (const isl of components(f => glassTri[f])) if (isl.area < C.MIN_ISLAND) for (const f of isl.faces) glassTri[f] = 0;
  lookThrough.rejectedArea = r6(lookThrough.rejectedArea);
  classifyLog.lookThrough = lookThrough;
  classifyLog.glassTriangles = glassTri.reduce((s, v) => s + v, 0);
}
log('classify', JSON.stringify(classifyLog));

// ---- 5. smooth the outline: split straddling triangles on the 0.5 iso-line of a per-vertex field ----------------------------
const nw = weld0.reduce((m, w) => Math.max(m, w), 0) + 1;
const FW = new Float32Array(nw); // field per welded vertex
{
  // the mask is convolved with a tent kernel (radius SMOOTH_R) over SURFACE SAMPLES (~1 cm apart, area-weighted), so large flat
  // windscreen triangles contribute only their part inside the kernel: a smooth field -> a smooth iso-line (no triangle staircase)
  const SP = [], SW = [], SG = [];
  for (let f = 0; f < nt0; f++) {
    if (CEN[3 * f + 1] < C.BELT_Y - 0.1) continue;
    const a = I0[3 * f], b = I0[3 * f + 1], c = I0[3 * f + 2];
    const e = Math.max(Math.hypot(P0[3 * a] - P0[3 * b], P0[3 * a + 1] - P0[3 * b + 1], P0[3 * a + 2] - P0[3 * b + 2]), Math.hypot(P0[3 * a] - P0[3 * c], P0[3 * a + 1] - P0[3 * c + 1], P0[3 * a + 2] - P0[3 * c + 2]), Math.hypot(P0[3 * b] - P0[3 * c], P0[3 * b + 1] - P0[3 * c + 1], P0[3 * b + 2] - P0[3 * c + 2]));
    const n = Math.max(1, Math.ceil(e / 0.01));
    const pts = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) pts.push([(i + 1 / 3) / n, (j + 1 / 3) / n], ...(i + j < n - 1 ? [[(i + 2 / 3) / n, (j + 2 / 3) / n]] : []));
    for (const [u, v] of pts) { const w0 = 1 - u - v; for (let k = 0; k < 3; k++) SP.push(w0 * P0[3 * a + k] + u * P0[3 * b + k] + v * P0[3 * c + k]); SW.push(AREA[f] / pts.length); SG.push(glassTri[f]); }
  }
  const sp = Float32Array.from(SP);
  const q = pointGrid(sp, Array.from({length: SW.length}, (_, i) => i), C.SMOOTH_R);
  const done = new Uint8Array(nw);
  for (let v = 0; v < nv0; v++) {
    const w = weld0[v]; if (done[w]) continue; done[w] = 1;
    if (P0[3 * v + 1] < C.BELT_Y - 0.05) continue;
    const x = P0[3 * v], y = P0[3 * v + 1], z = P0[3 * v + 2];
    let s = 0, a = 0;
    q(x, y, z, C.SMOOTH_R, h => { const k = SW[h] * (1 - Math.hypot(sp[3 * h] - x, sp[3 * h + 1] - y, sp[3 * h + 2] - z) / C.SMOOTH_R); s += k * SG[h]; a += k; });
    let val = a > 0 ? s / a : 0;
    if (Math.abs(val - 0.5) < 1e-4) val = 0.5 + 1e-4; // never exactly on the iso value (no zero-length cuts)
    FW[w] = val;
  }
}
const cutP = Array.from(P0), cutN = Array.from(N0), cutUV = Array.from(UV0);
const tris = []; // [a, b, c, glass]
let splitCount = 0;
{
  const edgeVert = new Map();
  const F = v => FW[weld0[v]];
  const cutVertex = (x, y) => {
    const k = x < y ? `${x}_${y}` : `${y}_${x}`;
    let id = edgeVert.get(k); if (id !== undefined) return id;
    const [u, w] = weld0[x] < weld0[y] ? [x, y] : [y, x]; // welded order -> bit-identical positions across UV-seam duplicates
    const t = (0.5 - F(u)) / (F(w) - F(u));
    id = cutP.length / 3;
    for (let k2 = 0; k2 < 3; k2++) cutP.push(P0[3 * u + k2] + t * (P0[3 * w + k2] - P0[3 * u + k2]));
    let nx = N0[3 * u] + t * (N0[3 * w] - N0[3 * u]), ny = N0[3 * u + 1] + t * (N0[3 * w + 1] - N0[3 * u + 1]), nz = N0[3 * u + 2] + t * (N0[3 * w + 2] - N0[3 * u + 2]);
    const nl = Math.hypot(nx, ny, nz) || 1; cutN.push(nx / nl, ny / nl, nz / nl);
    cutUV.push(UV0[2 * u] + t * (UV0[2 * w] - UV0[2 * u]), UV0[2 * u + 1] + t * (UV0[2 * w + 1] - UV0[2 * u + 1]));
    edgeVert.set(k, id);
    return id;
  };
  for (let f = 0; f < nt0; f++) {
    const v = [I0[3 * f], I0[3 * f + 1], I0[3 * f + 2]], ins = v.map(x => F(x) >= 0.5 ? 1 : 0);
    if (ins[0] === ins[1] && ins[1] === ins[2]) { tris.push(v[0], v[1], v[2], ins[0]); continue; }
    const lone = ins[0] !== ins[1] && ins[0] !== ins[2] ? 0 : ins[1] !== ins[0] && ins[1] !== ins[2] ? 1 : 2;
    const p = v[lone], q = v[(lone + 1) % 3], r = v[(lone + 2) % 3];
    const m1 = cutVertex(p, q), m2 = cutVertex(p, r);
    tris.push(p, m1, m2, ins[lone], m1, q, r, 1 - ins[lone], m1, r, m2, 1 - ins[lone]);
    splitCount++;
  }
}
// the smoothed iso-line can leave specks: glass islands below MIN_ISLAND go back to the body, small body islands inside a window
// (enclosed: not the main body shell) become glass
const specks = {glassToBody: 0, bodyToGlass: 0};
{
  const ntc0 = tris.length / 4, key = new Map(), PW = new Int32Array(cutP.length / 3);
  for (let v = 0; v < PW.length; v++) { const k = `${cutP[3 * v]},${cutP[3 * v + 1]},${cutP[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); PW[v] = w; }
  const triArea = t => { const a = tris[4 * t], b = tris[4 * t + 1], c = tris[4 * t + 2]; const u = [0, 1, 2].map(k => cutP[3 * b + k] - cutP[3 * a + k]), w = [0, 1, 2].map(k => cutP[3 * c + k] - cutP[3 * a + k]); return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; };
  for (const cls of [1, 0]) {
    const par = Int32Array.from({length: key.size}, (_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < ntc0; t++) if (tris[4 * t + 3] === cls) { const a = find(PW[tris[4 * t]]), b = find(PW[tris[4 * t + 1]]), c = find(PW[tris[4 * t + 2]]); par[a] = c; par[b] = c; }
    const comp = new Map();
    for (let t = 0; t < ntc0; t++) if (tris[4 * t + 3] === cls) { const r = find(PW[tris[4 * t]]); let s = comp.get(r); if (!s) comp.set(r, (s = {area: 0, tris: []})); s.area += triArea(t); s.tris.push(t); }
    const biggest = Math.max(...[...comp.values()].map(s => s.area));
    for (const s of comp.values()) {
      if (cls === 1 && s.area < C.MIN_ISLAND) { for (const t of s.tris) tris[4 * t + 3] = 0; specks.glassToBody++; }
      if (cls === 0 && s.area < biggest && s.area < 0.01) { for (const t of s.tris) tris[4 * t + 3] = 1; specks.bodyToGlass++; }
    }
  }
}
log(`outline: ${splitCount} triangles split on the smoothed iso-line; specks ${JSON.stringify(specks)}`);

// ---- 6. one simplification pass, the outline as an attribute seam ---------------------------------------------------------
// vertex buffer: body copies of every vertex used by a body triangle, separate glass copies for glass triangles
const ntc = tris.length / 4, nvc = cutP.length / 3;
const bodyMap = new Int32Array(nvc).fill(-1), glassMap = new Int32Array(nvc).fill(-1);
const VP = [], VN = [], VUV = [], VG = [];
const IDX = new Uint32Array(ntc * 3);
for (let t = 0; t < ntc; t++) {
  const g = tris[4 * t + 3], map = g ? glassMap : bodyMap;
  for (let k = 0; k < 3; k++) {
    const v = tris[4 * t + k];
    if (map[v] < 0) { map[v] = VP.length / 3; VP.push(cutP[3 * v], cutP[3 * v + 1], cutP[3 * v + 2]); VN.push(cutN[3 * v], cutN[3 * v + 1], cutN[3 * v + 2]); VUV.push(cutUV[2 * v], cutUV[2 * v + 1]); VG.push(g); }
    IDX[3 * t + k] = map[v];
  }
}
const vP = Float32Array.from(VP), vN = Float32Array.from(VN), vUV = Float32Array.from(VUV), vG = Uint8Array.from(VG);
const nvs = vP.length / 3;
const attrs = new Float32Array(nvs * 5);
for (let v = 0; v < nvs; v++) {
  for (let k = 0; k < 3; k++) attrs[5 * v + k] = vN[3 * v + k] * SIMPLIFY.weights.normal;
  attrs[5 * v + 3] = vUV[2 * v]; attrs[5 * v + 4] = vUV[2 * v + 1];
}
await MeshoptSimplifier.ready;
const meshScale = MeshoptSimplifier.getScale(vP, 3);
const countBody = out => { let n = 0; for (let i = 0; i < out.length; i += 3) if (!vG[out[i]]) n++; return n; };
let target = BODY_TRI_BUDGET + 6000, simp, simpErr, bodyTris;
for (let k = 0; k < 8; k++) {
  [simp, simpErr] = MeshoptSimplifier.simplifyWithAttributes(IDX, vP, 3, attrs, 5, [1, 1, 1, 1, 1], null, target * 3, SIMPLIFY.maxError, []);
  bodyTris = countBody(simp);
  log(`simplify target ${target}: ${simp.length / 3} tris (body ${bodyTris}), error ${(simpErr * meshScale * 1000).toFixed(2)} mm`);
  if (bodyTris <= BODY_TRI_BUDGET) break;
  target -= bodyTris - BODY_TRI_BUDGET + 200;
}
if (bodyTris > BODY_TRI_BUDGET) throw new Error('body triangle budget not reached');
// split + compact per primitive
function compact(sel) {
  const map = new Int32Array(nvs).fill(-1), P = [], N = [], UV = [], I = [];
  for (let i = 0; i < simp.length; i += 3) {
    const g = vG[simp[i]];
    if (vG[simp[i + 1]] !== g || vG[simp[i + 2]] !== g) throw new Error('mixed body / glass triangle after simplification');
    if (g !== sel) continue;
    for (let k = 0; k < 3; k++) {
      const v = simp[i + k];
      if (map[v] < 0) { map[v] = P.length / 3; P.push(vP[3 * v], vP[3 * v + 1], vP[3 * v + 2]); N.push(vN[3 * v], vN[3 * v + 1], vN[3 * v + 2]); UV.push(vUV[2 * v], vUV[2 * v + 1]); }
      I.push(map[v]);
    }
  }
  return {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I: Uint32Array.from(I)};
}
const body = compact(0), glass = compact(1);
log(`body ${body.I.length / 3} tris / ${body.P.length / 3} verts, glass ${glass.I.length / 3} tris / ${glass.P.length / 3} verts`);

// ---- 7. topology proof: body + glass welded by exact position = closed manifold; glass islands -------------------------------
function weldStats(parts) {
  const key = new Map(), edges = new Map();
  const wid = (P, v) => { const k = `${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); return w; };
  for (const {P, I} of parts) for (let i = 0; i < I.length; i += 3) {
    const a = wid(P, I[i]), b = wid(P, I[i + 1]), c = wid(P, I[i + 2]);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u}_${v}` : `${v}_${u}`; edges.set(k, (edges.get(k) ?? 0) + 1); }
  }
  let open = 0, nonManifold = 0; for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) nonManifold++; }
  return {open, nonManifold, edges: edges.size};
}
const topoAll = weldStats([body, glass]), topoBody = weldStats([body]), topoGlass = weldStats([glass]);
log('topology body+glass', JSON.stringify(topoAll), 'body', JSON.stringify(topoBody), 'glass', JSON.stringify(topoGlass));
if (topoAll.open !== 0) throw new Error(`body + glass not closed: ${topoAll.open} open edges (gap between the body hole and the glass)`);
if (topoBody.open !== topoGlass.open) throw new Error('body hole boundary != glass boundary');
/** connected components of a primitive (by exact position) with stats */
function islandsOf({P, I}) {
  const key = new Map(), wid = v => { const k = `${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); return w; };
  const W = Int32Array.from({length: P.length / 3}, (_, v) => wid(v));
  const par = Int32Array.from({length: key.size}, (_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < I.length; i += 3) { const a = find(W[I[i]]), b = find(W[I[i + 1]]), c = find(W[I[i + 2]]); par[a] = c; par[b] = c; }
  const m = new Map();
  for (let i = 0; i < I.length; i += 3) {
    const r = find(W[I[i]]); let s = m.get(r);
    if (!s) m.set(r, (s = {tris: 0, area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], c: [0, 0, 0], idx: []}));
    const a = I[i], b = I[i + 1], c = I[i + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    s.tris++; s.area += ar; s.idx.push(i);
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { s.min[k] = Math.min(s.min[k], P[3 * v + k]); s.max[k] = Math.max(s.max[k], P[3 * v + k]); s.c[k] += ar * P[3 * v + k] / 3; }
  }
  return [...m.values()].map(s => ({...s, c: s.c.map(v => v / s.area)})).sort((a, b) => b.area - a.area);
}
const glassIslands = islandsOf(glass);
log('glass islands raw', glassIslands.map(s => `${s.tris}t ${s.area.toFixed(4)}m2 c${s.c.map(v => v.toFixed(2))}`).join(' | '));
const named = {};
for (const s of glassIslands) {
  const name = Math.abs(s.c[0]) < 0.25 ? (s.c[2] < 0 ? 'windscreen' : 'rear') : s.c[0] < 0 ? 'left' : 'right';
  if (named[name]) throw new Error(`two glass islands classified ${name}`);
  named[name] = s;
}
for (const k of ['windscreen', 'rear', 'left', 'right']) if (!named[k]) throw new Error(`no ${k} glass island`);
if (glassIslands.length !== 4) throw new Error(`expected 4 glass islands, found ${glassIslands.length}`);
const islandReport = Object.fromEntries(Object.entries(named).map(([k, s]) => [k, {triangles: s.tris, areaM2: r3(s.area), min: s.min.map(r3), max: s.max.map(r3)}]));
log('glass islands', JSON.stringify(islandReport));

// ---- 8. measurements / anchors ----------------------------------------------------------------------------------------------
const allP = [body.P, glass.P];
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (const P of allP) for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], P[i + k]); bmax[k] = Math.max(bmax[k], P[i + k]); }
const dims = [0, 1, 2].map(k => bmax[k] - bmin[k]);
if (Math.abs(bmin[1]) > 1e-5 || Math.abs(bmin[0] + bmax[0]) > 2e-3 || Math.abs(bmin[2] + bmax[2]) > 2e-3) throw new Error(`not grounded / centred: ${bmin} ${bmax}`);
if (Math.abs(dims[2] - LENGTH_M) > 1e-3) throw new Error(`length ${dims[2]}`);
// wheels (full-res source in the runtime frame): tread contact patch (centroids within 3 cm of the local ground) gives x / z,
// the outward-facing silver rim disc gives the hub height; r = hub - local ground
function wheel(sx, sz) {
  const near = f => Math.sign(CEN[3 * f]) === sx && Math.sign(CEN[3 * f + 2]) === sz && Math.abs(CEN[3 * f]) > 0.6;
  let ground = Infinity;
  for (let f = 0; f < nt0; f++) if (near(f) && Math.abs(CEN[3 * f + 2]) > 0.9 && Math.abs(CEN[3 * f + 2]) < 2.1) ground = Math.min(ground, CEN[3 * f + 1]);
  const cx = [], cz = [];
  for (let f = 0; f < nt0; f++) if (near(f) && Math.abs(CEN[3 * f + 2]) > 0.9 && Math.abs(CEN[3 * f + 2]) < 2.1 && CEN[3 * f + 1] < ground + 0.03) { cx.push(CEN[3 * f]); cz.push(CEN[3 * f + 2]); }
  const mid = a => (Math.min(...a) + Math.max(...a)) / 2;
  const x = mid(cx), z = mid(cz);
  const ry = [];
  for (let f = 0; f < nt0; f++) if (near(f) && Math.abs(CEN[3 * f + 2] - z) < 0.42 && Math.abs(CEN[3 * f]) > 0.75 && CEN[3 * f + 1] < 0.75 && LUM[f] > 140 && Math.abs(FN[3 * f]) > 0.5) ry.push(CEN[3 * f + 1]);
  ry.sort((a, b) => a - b);
  const q = p => ry[Math.min(ry.length - 1, Math.max(0, Math.round(p * (ry.length - 1))))];
  const hub = (q(0.005) + q(0.995)) / 2;
  return {x: r3(x), y: r3(hub), z: r3(z), r: r3(hub - ground), rimRadius: r3((q(0.995) - q(0.005)) / 2), ground: r3(ground), contactWidth: r3(Math.max(...cx) - Math.min(...cx))};
}
const wheelsFull = [wheel(-1, -1), wheel(1, -1), wheel(-1, 1), wheel(1, 1)]; // FL FR RL RR
const wheels = wheelsFull.map(({x, y, z, r}) => ({x, y, z, r}));
const wheelBase = r3((wheels[2].z + wheels[3].z) / 2 - (wheels[0].z + wheels[1].z) / 2);
const trackFront = wheels[1].x - wheels[0].x, trackRear = wheels[3].x - wheels[2].x;
const track = r3((trackFront + trackRear) / 2);
log('wheels', JSON.stringify(wheelsFull), 'wheelBase', wheelBase, 'track', track, r3(trackFront), r3(trackRear));
// helpers on the runtime mesh
const bodyVerts = function* () { for (let i = 0; i < body.P.length; i += 3) yield [body.P[i], body.P[i + 1], body.P[i + 2]]; };
/** first hit of a ray against the runtime body + glass: {hit: 'body' | 'glass' | null, t, outer: the hit side is the outside} */
function raycast(o, d, tmin = 1e-4) {
  let bestT = Infinity, hit = null, outer = null;
  for (const [name, M] of [['body', body], ['glass', glass]]) {
    const {P, N, I} = M;
    for (let t = 0; t < I.length; t += 3) {
      const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > tmin && tt < bestT) { bestT = tt; hit = name; outer = (N[a] + N[b] + N[c]) * d[0] + (N[a + 1] + N[b + 1] + N[c + 1]) * d[1] + (N[a + 2] + N[b + 2] + N[c + 2]) * d[2] < 0; }
    }
  }
  return {hit, t: bestT, outer};
}
/** roof line (outer top surface) at x, z */
const roofAt = (x, z) => 3 - raycast([x, 3, z], [0, -1, 0]).t;
/** points where an island of the glass crosses the plane x = const */
function sectionX(isl, x) {
  const out = [];
  for (const i of isl.idx) for (let e = 0; e < 3; e++) {
    const a = glass.I[i + e], b = glass.I[i + (e + 1) % 3], xa = glass.P[3 * a], xb = glass.P[3 * b];
    if ((xa - x) * (xb - x) > 0 || xa === xb) continue;
    const t = (x - xa) / (xb - xa);
    out.push([x, glass.P[3 * a + 1] + t * (glass.P[3 * b + 1] - glass.P[3 * a + 1]), glass.P[3 * a + 2] + t * (glass.P[3 * b + 2] - glass.P[3 * a + 2])]);
  }
  if (!out.length) throw new Error('empty glass section');
  return out;
}
/** inner half-width of the cabin toward the left side at (y, z): distance from the centreline to the first surface */
const sideHalfWidth = (y, z) => raycast([0, y, z], [-1, 0, 0]).t;
let eye = {x: -0.37, y: 0, z: 0};
let header, cowl;
for (let it = 0; it < 3; it++) {
  const wv = sectionX(named.windscreen, eye.x);
  header = wv.reduce((a, b) => (b[1] > a[1] ? b : a));
  cowl = wv.reduce((a, b) => (b[1] < a[1] ? b : a));
  eye.z = header[2] + EYE.behindHeader;
  eye.y = roofAt(eye.x, eye.z) - EYE.belowRoof;
  eye.x = -sideHalfWidth(eye.y, eye.z) / 2;
}
eye = {x: r2(eye.x), y: r2(eye.y), z: r2(eye.z)};
const roofAtEye = roofAt(eye.x, eye.z);
const wheelCentre = {x: eye.x, y: r2(eye.y + WHEEL_FROM_EYE.dy), z: r2(eye.z + WHEEL_FROM_EYE.dz)};
// door seams: dark, side-facing source triangles at mid door height between the wheel arches
function doorSeams(sx) {
  const bins = new Map();
  const zA = (wheels[0].z + wheels[1].z) / 2 + 0.55, zB = (wheels[2].z + wheels[3].z) / 2 - 0.55;
  for (let f = 0; f < nt0; f++) {
    const x = CEN[3 * f], y = CEN[3 * f + 1], z = CEN[3 * f + 2];
    if (Math.sign(x) !== sx || Math.abs(x) < 0.7 || Math.abs(FN[3 * f]) < 0.6 || y < 0.45 || y > 0.75 || z < zA || z > zB || LUM[f] > 45) continue;
    const k = Math.round(z * 50); bins.set(k, (bins.get(k) ?? 0) + AREA[f]);
  }
  const strong = [...bins].filter(([, a]) => a > 2e-4).map(([k]) => k / 50).sort((a, b) => a - b);
  if (strong.length < 2) throw new Error('door seams not found');
  return [strong[0], strong[strong.length - 1]];
}
const seamsL = doorSeams(-1), seamsR = doorSeams(1);
const midDoor = r2((seamsL[0] + seamsL[1] + seamsR[0] + seamsR[1]) / 4);
const halfWidthLow = (z, d = 0.1) => { let m = 0; for (const [x, y, pz] of bodyVerts()) if (Math.abs(pz - z) < d && y > 0.3 && y < 0.9) m = Math.max(m, Math.abs(x)); return m; };
const doorHalf = halfWidthLow(midDoor);
const exits = {left: {x: r2(-(doorHalf + EXIT_OUT)), z: midDoor}, right: {x: r2(doorHalf + EXIT_OUT), z: midDoor}};
// collision circles: footprint (no mirrors: vertices below the mirror line) per 2 cm slice, greedy cover minimising the radius
const BELOW_MIRRORS = 0.95;
const slices = new Map();
for (const P of allP) for (let i = 0; i < P.length; i += 3) { if (P[i + 1] > BELOW_MIRRORS) continue; const k = Math.round(P[i + 2] * 50); slices.set(k, Math.max(slices.get(k) ?? 0, Math.abs(P[i]))); }
const sl = [...slices].sort((a, b) => a[0] - b[0]).map(([k, hw]) => ({z: k / 50, hw}));
function cover(R) {
  const out = []; let i = 0;
  while (i < sl.length) {
    let lo = -Infinity, hi = Infinity, j = i;
    for (; j < sl.length; j++) { if (sl[j].hw > R) return null; const d = Math.sqrt(R * R - sl[j].hw * sl[j].hw); const nlo = Math.max(lo, sl[j].z - d), nhi = Math.min(hi, sl[j].z + d); if (nlo > nhi) break; lo = nlo; hi = nhi; }
    out.push({from: i, to: j, z: (lo + hi) / 2}); i = j;
  }
  return out;
}
let Rlo = Math.max(...sl.map(s => s.hw)), Rhi = 4;
for (let k = 0; k < 40; k++) { const m = (Rlo + Rhi) / 2, c = cover(m); if (c && c.length <= N_CIRCLES) Rhi = m; else Rlo = m; }
// radii from the actual vertices of each circle's z segment (not the 2 cm slices), rounded UP to the cm
const circles = cover(Rhi).map(c => {
  const z = r2(c.z), za = sl[c.from].z - 0.011, zb = sl[c.to - 1].z + 0.011;
  let r = 0;
  for (const P of allP) for (let i = 0; i < P.length; i += 3) if (P[i + 1] <= BELOW_MIRRORS && P[i + 2] >= za && P[i + 2] <= zb) r = Math.max(r, Math.hypot(P[i], P[i + 2] - z));
  return {z, r: Math.ceil(r * 100) / 100};
});
for (const P of allP) for (let i = 0; i < P.length; i += 3) if (P[i + 1] <= BELOW_MIRRORS && !circles.some(c => Math.hypot(P[i], P[i + 2] - c.z) <= c.r)) throw new Error('circles do not cover the footprint');

// voxel occupancy of the runtime shell (body + glass) -> the cabin box for the cockpit. It starts at the windscreen base (the dash
// front) so a dash fits; the raked windscreen (its whole glass island: the curved screen dips lower at the corners) and the A-pillars
// ABOVE the cowl -> header line cross its top-front edge (a dash stays below them): those samples are ignored; everything else
// (roof, doors, sills, floor, wheel tubs, side / rear glass) must stay outside the box.
const VOX = 0.02;
const WS_SLOPE = (header[1] - cowl[1]) / (header[2] - cowl[2]);
const aboveWindscreenLine = (y, z) => z <= header[2] + 0.02 && y > cowl[1] + (z - cowl[2]) * WS_SLOPE - 0.03;
const g0 = [bmin[0] - 0.04, bmin[1] - 0.04, bmin[2] - 0.04];
const G = [0, 1, 2].map(k => Math.ceil((bmax[k] - bmin[k] + 0.08) / VOX) + 1);
const occ = new Uint8Array(G[0] * G[1] * G[2]);
const vid = (i, j, k) => (k * G[1] + j) * G[0] + i;
const wsTri = new Set(named.windscreen.idx);
for (const [M, isGlass] of [[body, false], [glass, true]]) for (let t = 0; t < M.I.length; t += 3) {
  if (isGlass && wsTri.has(t)) continue;
  const {P, I} = M, a = I[t], b = I[t + 1], c = I[t + 2];
  const e = Math.max(Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]), Math.hypot(P[3 * a] - P[3 * c], P[3 * a + 1] - P[3 * c + 1], P[3 * a + 2] - P[3 * c + 2]), Math.hypot(P[3 * b] - P[3 * c], P[3 * b + 1] - P[3 * c + 1], P[3 * b + 2] - P[3 * c + 2]));
  const n = Math.max(1, Math.ceil(e / (VOX * 0.5)));
  for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
    const wa = 1 - (u + v) / n, wb = u / n, wc = v / n;
    const x = wa * P[3 * a] + wb * P[3 * b] + wc * P[3 * c], y = wa * P[3 * a + 1] + wb * P[3 * b + 1] + wc * P[3 * c + 1], z = wa * P[3 * a + 2] + wb * P[3 * b + 2] + wc * P[3 * c + 2];
    if (aboveWindscreenLine(y, z)) continue;
    occ[vid(Math.floor((x - g0[0]) / VOX), Math.floor((y - g0[1]) / VOX), Math.floor((z - g0[2]) / VOX))] = 1;
  }
}
// 3D prefix sums (occupied voxels dilated by one voxel = >= 2 cm clearance)
const dil = new Uint8Array(occ.length);
for (let k = 1; k < G[2] - 1; k++) for (let j = 1; j < G[1] - 1; j++) for (let i = 1; i < G[0] - 1; i++) {
  if (!occ[vid(i, j, k)]) continue;
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) dil[vid(i + di, j + dj, k + dk)] = 1;
}
const PS = new Int32Array((G[0] + 1) * (G[1] + 1) * (G[2] + 1));
const pid = (i, j, k) => (k * (G[1] + 1) + j) * (G[0] + 1) + i;
for (let k = 1; k <= G[2]; k++) for (let j = 1; j <= G[1]; j++) for (let i = 1; i <= G[0]; i++)
  PS[pid(i, j, k)] = dil[vid(i - 1, j - 1, k - 1)] + PS[pid(i - 1, j, k)] + PS[pid(i, j - 1, k)] + PS[pid(i, j, k - 1)] - PS[pid(i - 1, j - 1, k)] - PS[pid(i - 1, j, k - 1)] - PS[pid(i, j - 1, k - 1)] + PS[pid(i - 1, j - 1, k - 1)];
const boxSum = (i0, i1, j0, j1, k0, k1) => PS[pid(i1, j1, k1)] - PS[pid(i0, j1, k1)] - PS[pid(i1, j0, k1)] - PS[pid(i1, j1, k0)] + PS[pid(i0, j0, k1)] + PS[pid(i0, j1, k0)] + PS[pid(i1, j0, k0)] - PS[pid(i0, j0, k0)];
const ix = x => Math.round((x - g0[0]) / VOX), iy = y => Math.round((y - g0[1]) / VOX), iz = z => Math.round((z - g0[2]) / VOX);
const icx = ix(0);
let best = null;
{
  const need = [eye, wheelCentre];
  // front cabin: from the windscreen base back to the rear wheel arches (the rear tubs would pinch a longer box to a sliver)
  const zLo = iz(cowl[2]), zHi = iz(Math.min(wheels[2].z - wheels[2].r, wheels[3].z - wheels[3].r));
  const kE0 = Math.min(...need.map(p => iz(p.z))) - 1, kE1 = Math.max(...need.map(p => iz(p.z))) + 1;
  const jE0 = Math.min(...need.map(p => iy(p.y))) - 1, jE1 = Math.max(iy(eye.y + INTERIOR_HEADROOM), Math.max(...need.map(p => iy(p.y))) + 1);
  const hMin = Math.max(...need.map(p => Math.abs(ix(p.x) - icx))) + 2;
  // top = eye + headroom (a cockpit needs width more than height); back >= behind the driver's seat back
  const kSeat = Math.max(kE1, iz(eye.z + INTERIOR_BEHIND_EYE));
  for (let k0 = zLo; k0 <= zLo + Math.round(INTERIOR_FRONT_SLACK / VOX); k0++) for (let k1 = kSeat; k1 <= zHi; k1++) for (let j0 = iy(0.1); j0 <= jE0; j0++) for (let j1 = jE1; j1 <= jE1; j1++) {
    // a cockpit needs the cabin WIDTH first (two seats + console): widest box, then the largest volume
    const vol0 = (k1 - k0) * (j1 - j0);
    if (boxSum(icx - hMin, icx + hMin, j0, j1, k0, k1) > 0) continue;
    let lo = hMin, hi = Math.min(icx, G[0] - icx) - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (boxSum(icx - m, icx + m, j0, j1, k0, k1) === 0) lo = m; else hi = m - 1; }
    const vol = vol0 * 2 * lo;
    if (!best || lo > best.h || (lo === best.h && vol > best.vol)) best = {vol, h: lo, j0, j1, k0, k1};
  }
}
if (!best) throw new Error('no free cabin box around the eye');
const fx = i => g0[0] + i * VOX, fy = j => g0[1] + j * VOX, fz = k => g0[2] + k * VOX;
const interior = {x0: r2(fx(icx - best.h)), x1: r2(fx(icx + best.h)), y0: r2(fy(best.j0)), y1: r2(fy(best.j1)), z0: r2(fz(best.k0)), z1: r2(fz(best.k1))};

// first-person sight lines from the eye: the first surface hit must be glass
// yaw: 0 = forward (-Z), +90 = left (-X); pitch: + up
const dir = (yaw, pitch) => { const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180; return [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)]; };
// [name, yaw, pitch, required]: required lines must leave through glass (windscreen + both side windows); the others are recorded
// for the vehicle runtime (the left A-pillar and the far door below the right beltline are real, opaque body)
const SIGHTS = [['forward', 0, 0, true], ['forward-down-6', 0, -6, true], ['forward-up-15', 0, 15, true], ['forward-left-15', 15, 0, true], ['forward-right-30', -30, 0, true],
  ['left', 90, 0, true], ['left-forward-50', 50, -5, true], ['left-down-10', 90, -10, true], ['left-back-110', 110, 0, true], ['right', -90, 0, true], ['right-forward-45', -45, -5, true], ['right-down-5', -90, -5, true],
  ['a-pillar-left-30', 30, 0, false], ['right-down-10', -90, -10, false], ['back', 180, 0, false]];
const eyeO = [eye.x, eye.y, eye.z];
const sightLines = SIGHTS.map(([name, yaw, pitch, required]) => { const r = raycast(eyeO, dir(yaw, pitch)); return {name, yaw, pitch, required, hit: r.hit, distance: r3(r.t)}; });
log('sight lines', sightLines.map(s => `${s.name}:${s.hit}@${s.distance}`).join(' '));
for (const s of sightLines) if (s.required && s.hit !== 'glass') throw new Error(`sight line ${s.name} hits ${s.hit}`);
// look-through proof on the runtime mesh: a 5 deg grid of rays from the eye; every ray that meets glass first must, past the glass,
// leave the car or meet an OUTER body face (never the hollow shell's inside)
const lookGrid = {raysThroughGlass: 0, intoShell: 0, grid: 'yaw -120..120, pitch -25..35, 5 deg'};
for (let yaw = -120; yaw <= 120; yaw += 5) for (let pitch = -25; pitch <= 35; pitch += 5) {
  const d = dir(yaw, pitch), first = raycast(eyeO, d);
  if (first.hit !== 'glass') continue;
  lookGrid.raysThroughGlass++;
  let t = first.t, next;
  for (let k = 0; k < 4; k++) { next = raycast(eyeO, d, t + 1e-4); if (next.hit !== 'glass') break; t = next.t; }
  if (next.hit === 'body' && !next.outer) { lookGrid.intoShell++; (lookGrid.examples ??= []).length < 8 && lookGrid.examples.push([yaw, pitch]); }
}
log('look-through grid', JSON.stringify(lookGrid));
if (lookGrid.intoShell) throw new Error(`${lookGrid.intoShell} sight lines look through glass into the hollow shell`);

const anchors = {length: r3(dims[2]), width: r3(dims[0]), height: r3(dims[1]), wheelBase, track, wheels, eye, wheelCentre, exits, circles, interior,
  cowl: {y: r2(cowl[1]), z: r2(cowl[2])}, header: {y: r2(header[1]), z: r2(header[2])}};
log('anchors', JSON.stringify(anchors));
log('door seams', seamsL, seamsR, 'door half width', r3(doorHalf), 'roof at eye', r3(roofAtEye));
if (DRY) process.exit(0);

// ---- 9. textures + GLB ---------------------------------------------------------------------------------------------------
async function encode(t, {px, q}) {
  const bytes = await sharp(Buffer.from(t.getImage())).removeAlpha().resize(px, px, {kernel: 'lanczos3'}).jpeg({quality: q, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
  return bytes;
}
const doc = new Document();
const buf = doc.createBuffer();
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const texOut = {};
for (const [k, t] of Object.entries(texSrc)) texOut[k] = doc.createTexture(`body-${k}`).setImage(new Uint8Array(await encode(t, TEX[k]))).setMimeType('image/jpeg');
const bodyMat = doc.createMaterial('body').setBaseColorFactor(sMat.getBaseColorFactor()).setMetallicFactor(sMat.getMetallicFactor()).setRoughnessFactor(sMat.getRoughnessFactor())
  .setDoubleSided(sMat.getDoubleSided()).setAlphaMode('OPAQUE')
  .setBaseColorTexture(texOut.baseColor).setMetallicRoughnessTexture(texOut.metallicRoughness).setNormalTexture(texOut.normal).setNormalScale(sMat.getNormalScale());
const glassMat = doc.createMaterial('glass').setBaseColorFactor(GLASS.baseColorFactor).setMetallicFactor(GLASS.metallicFactor).setRoughnessFactor(GLASS.roughnessFactor)
  .setDoubleSided(true).setAlphaMode('BLEND');
const prim = (M, mat) => doc.createPrimitive().setAttribute('POSITION', acc('VEC3', M.P)).setAttribute('NORMAL', acc('VEC3', M.N)).setAttribute('TEXCOORD_0', acc('VEC2', M.UV))
  .setIndices(acc('SCALAR', M.P.length / 3 <= 65535 ? Uint16Array.from(M.I) : M.I)).setMaterial(mat);
const scene = doc.createScene(ID);
scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim(body, bodyMat))));
scene.addChild(doc.createNode('glass').setMesh(doc.createMesh('glass').addPrimitive(prim(glass, glassMat))));
doc.getRoot().setDefaultScene(scene);
doc.getRoot().getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-skyways-car.mjs (glTF-Transform)';
const glb = Buffer.from(await new NodeIO().writeBinary(doc));
const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error('URL/token-like string inside the glTF JSON');
if (/"extensionsUsed"/.test(jsonChunk)) throw new Error('glTF extensions are not allowed (plain glTF only)');
fs.writeFileSync(path.join(root, 'game/public', OUT_REL), glb);
const outTex = Object.fromEntries(Object.entries(texOut).map(([k, t]) => [k, {size: TEX[k].px, mime: 'image/jpeg', quality: TEX[k].q, bytes: t.getImage().byteLength, sha256: sha(t.getImage())}]));
const bodyTriCount = body.I.length / 3, glassTriCount = glass.I.length / 3;

// ---- 10. provenance, generated anchors, allowlist -------------------------------------------------------------------------
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: ID,
  role: 'Skyways prize-car add-on: the one first-person drivable hero car (body + window glass); a cockpit model is placed separately in the interior box',
  task: 'skyways-level-20261106-054448 lane ASSET-B',
  source: {
    member: mEntry.member, file: `reference/${TASK_REL}/masters/${MASTER} (user source master, outside Git)`, sha256: mEntry.sha256, bytes: mEntry.bytes,
    triangles: srcStats.triangles, vertices: srcStats.vertices, closedShell: true, extentM: [0, 1, 2].map(k => r6(smax[k] - smin[k])), noseAxis: '-X (source)', maps: srcTex,
    licence: 'community-supplied source via the user (sky-ways.zip); creator / license links pending; no license or authorship claim',
  },
  output: {file: `game/public/${OUT_REL}`, url: OUT_REL, sha256: sha(glb), bytes: glb.length, triangles: bodyTriCount + glassTriCount, dims: dims.map(r3),
    body: {node: 'body', material: 'body', triangles: bodyTriCount, vertices: body.P.length / 3, maps: outTex, doubleSided: sMat.getDoubleSided()},
    glass: {node: 'glass', material: 'glass', triangles: glassTriCount, vertices: glass.P.length / 3, alphaMode: 'BLEND', doubleSided: true, ...GLASS, islands: islandReport, note: 'keeps TEXCOORD_0 (the body base map would fit) but binds no texture: a uniform dark neutral tint you can see through'}},
  transform: {scale: r6(SCALE), rotation: 'about +Y by -90 deg (source nose -X -> runtime -Z): x = -z_src, z = x_src', grounded: true, centred: 'x / z footprint (bounding box)', lengthM: LENGTH_M, baked: 'into the vertices (identity nodes)'},
  convention: 'metres at real size, +Y up, NOSE toward -Z (runtime forward at yaw 0), grounded (min y = 0), centred on x / z; driver = LEFT seat (-X)',
  glassClassification: {
    method: 'per-triangle base-map colour (4 barycentric samples) scored dark (luminance ramp) x low-saturation (chroma ramp), only inside the greenhouse zone (centroid above the beltline, inside the greenhouse half-width: never tyres / grille / lights / sills / mirrors); area-weighted ball median filter; small islands dropped; enclosed non-glass holes in the zone filled (painted interior, defroster lines); outline smoothed: straddling triangles split on the 0.5 iso-line of a per-vertex field; glass vertices duplicated so the outline is an attribute seam through simplification',
    params: {...CLASSIFY}, result: classifyLog, splitTriangles: splitCount,
    proof: {bodyPlusGlassWelded: topoAll, bodyOpenEdges: topoBody.open, glassOpenEdges: topoGlass.open, glassIslands: glassIslands.length, lookThroughFromEye: lookGrid},
  },
  simplify: {tool: 'meshoptimizer simplifyWithAttributes (normal x0.5 + UV; seams kept incl. the glass outline; positions never moved)', fromTriangles: ntc, triangles: bodyTriCount + glassTriCount, bodyBudget: BODY_TRI_BUDGET, errorRelative: r6(simpErr), errorMeters: r6(simpErr * meshScale), maxErrorRelative: SIMPLIFY.maxError},
  anchors: {...anchors, wheelsMeasured: wheelsFull, trackFront: r3(trackFront), trackRear: r3(trackRear), doorSeams: {left: seamsL, right: seamsR}, doorHalfWidth: r3(doorHalf), roofAtEye: r3(roofAtEye), sightLines,
    method: {
      wheels: 'tread contact patch (source triangles within 3 cm of the local ground) -> x / z; outward-facing silver rim disc (0.5 / 99.5 % height quantiles) -> hub y; r = hub - local ground',
      eye: `left seat: z = windscreen header (top edge at the eye x) + ${EYE.behindHeader} m; y = roof line at the eye - ${EYE.belowRoof} m; x = half the side-glass half-width at the eye`,
      wheelCentre: `steering-wheel estimate: eye + (0, ${WHEEL_FROM_EYE.dy}, ${WHEEL_FROM_EYE.dz}) m`,
      exits: `${EXIT_OUT} m outside the body side (max |x| at door height) at mid-door (between the door seam lines found in the texture)`,
      circles: `${N_CIRCLES} circles on the centreline covering the footprint below the mirrors (y <= ${BELOW_MIRRORS} m) with the smallest common radius`,
      interior: `cabin box for the cockpit: front within ${INTERIOR_FRONT_SLACK} m of the windscreen base (the dash front; the curved screen corners dip lower at the sides), widest (then largest) x-symmetric box free of the shell (body + glass, 2 cm voxels + 1 voxel clearance) except the raked windscreen / A-pillars above the cowl -> header line (top-front edge; a dash stays below it); contains the eye (top = eye + ${INTERIOR_HEADROOM} m) and the steering-wheel estimate; back >= eye + ${INTERIOR_BEHIND_EYE} m (behind the seat back), the rear wheel arches at most`,
    }},
  limitations: [
    'The source has no interior: the shell is hollow (no firewall, dash or seats). From the eye, everything BELOW the windscreen base (the cowl -> header line) looks into the empty engine bay until the cockpit model (dash / firewall) closes it; through the glass itself the view always leaves the car (lookThroughFromEye).',
    'The front wheels are modelled steered (they stand ~0.1 m proud of the front arches and set the overall width); wheels are part of the body shell, not separate nodes (no spin / steer).',
    'Badges are in the source texture and were NOT painted over: a winged emblem on the upper grille, on the rear panel between the tail lights and on both front fenders behind the wheel arches; illegible dark script in the rear plate recess. The body is a recognisable real-world sports-coupe design (trade-dress caveat).',
    'The rear window carries the source geometry ridges along its defroster lines (kept, inside the glass primitive).',
    `${topoAll.nonManifold} non-manifold edges from the simplification (front wheels / front bumper, none at the cabin or the glass outline); the welded shell has no open edge.`,
    'The glass is double-sided BLEND: the runtime should render it after the opaque body (transparent pass) and may draw its back faces first.',
  ],
  textures: outTex,
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
if (/https?:|Signature|X-Amz|Key-Pair|token=/i.test(provBuf.toString())) throw new Error('URL/token-like string in public provenance');
fs.writeFileSync(path.join(root, 'game/public', PROV_REL), provBuf);

const SK = {url: OUT_REL, length: anchors.length, width: anchors.width, height: anchors.height, bodyTris: bodyTriCount, glassTris: glassTriCount, wheelBase, track, wheels, eye, wheelCentre, exits, circles, interior, cowl: anchors.cowl, header: anchors.header};
const ts = `// GENERATED by tools/asset-pipeline/props/build-skyways-car.mjs — do not edit (Skyways lane ASSET-B).
// The Skyways prize car (assets/models/skyways-prize-car.glb; provenance assets/derivatives/skyways-prize-car.json): measured anchors.
// Frame: metres, +Y up, NOSE toward -Z (runtime forward at yaw 0), grounded (y = 0), centred on x / z. Driver = LEFT seat (-X).
// Nodes: \`body\` (opaque, double-sided paint) and \`glass\` (material \`glass\`, BLEND). wheels: [front-left, front-right, rear-left,
// rear-right] {x, y = hub height, z, r}. eye = seated driver eye; wheelCentre = steering-wheel estimate; exits = stand points ${EXIT_OUT} m
// outside each door at mid-door; circles = collision circles on the centreline (x = 0) covering the footprint below the mirrors;
// interior = the cabin box for the cockpit (front = windscreen base / dash front; no body shell inside it except the raked windscreen over
// its top-front edge, above the cowl -> header line, where a dash stays below; contains eye + wheelCentre); cowl / header = windscreen
// base / top edge at the eye x (a dash top must stay under the line between them).
export const SKYWAYS_CAR = {
${Object.entries(SK).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/,/g, ', ')},`).join('\n')}
} as const;
`;
fs.writeFileSync(GEN_TS, ts);

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([[OUT_REL, glb], [PROV_REL, provBuf]]);
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
log(`${ID}: ${srcStats.triangles} tris, ${(srcBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(2)} MB (body ${bodyTriCount} + glass ${glassTriCount} tris), dims ${dims.map(r3).join(' x ')} m`);
log(Object.entries(outTex).map(([k, t]) => `${k} ${t.size} jpeg q${t.quality} ${t.bytes} B`).join('\n'));
