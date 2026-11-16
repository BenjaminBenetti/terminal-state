// Task studio-surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the SURFACE RUN MILITARY TRUCK runtime model, a fresh derivative of
// the user's private, immutable master
//   reference/resources/user-military-truck/master.glb  (sha256 44d12d07…f08f6b4a, 144,978,172 bytes; outside Git / CI / runtime)
// (one node / one mesh / one primitive, 4,680,288 triangles, 2,540,619 vertices, ONE closed shell: the wheels, the cab and the canvas
// bed are fused into one surface; one material with 2048 px JPEG base colour / metallic-roughness / normal maps; the cab windows are
// flat grey texture on the shell). The master is read once, verified by size + sha256 and never written.
//
// Writes deterministically:
//   game/public/assets/models/surface-military-truck.glb     nodes `body` (opaque, the master's maps re-encoded), `glass` (flat clear
//                                                            panes, material `glass`), `wheel-0` … `wheel-7` (one node per road wheel,
//                                                            origin at its hub: they roll / steer at runtime)
//   game/public/assets/derivatives/surface-military-truck.json provenance (user-supplied model; no licence / authorship claim)
//   game/src/world/surface/truckAnchors.generated.ts          TRUCK_ANCHORS: measured anchors (three-free)
//   tools/release/public-inputs.json                          ONLY the two public entries above (others untouched)
//
// Frame: metres at real size (uniform SCALE), +Y up, NOSE toward -Z (runtime forward at yaw 0), grounded (min y = 0), centred on the
// x / z footprint (bounding box), baked into the vertices (identity nodes except the wheels' hub translations). Driver = LEFT seat (-X).
// The master's nose is -X: rotation about +Y by -90 deg (x' = -z, z' = x; winding kept).
//
// SCALE (4.0, from the model's own proportions): the canvas bed's outer width measures 0.625 master units -> 2.50 m (the road width of
// a military cargo truck); the same factor gives tyres 1.14 m in diameter (14.00 R20-class military tyres are 1.1-1.25 m), an overall
// height of 3.24 m over the canvas roof, a cab door window from 1.62 m to 2.19 m above the road and a seated driver's eye near 2 m. The
// model's 8 x 8 chassis is compressed lengthwise compared with a real 10 m eight-wheeler (7.55 m here); a uniform scale keeps the
// model's own proportions (the width, the wheels and the cab stay right).
//
// Steps (all deterministic, no generation):
//  1. WHEELS: the eight tyre contact patches (triangles within 3 cm of the ground) give each wheel's x / z; the tyre's silhouette in the
//     side projection gives its radius (hub = radius over the ground). Every triangle whose centroid lies inside the wheel's cylinder
//     (radius + 1.5 cm, axis along x) and outboard of a cut plane just inside the tyre's inner face becomes that wheel's; both sides of
//     the cut are CAPPED (a fan over each boundary loop, a dark tread texel) so neither the body nor the wheel shows a hole.
//  2. GLAZING: the cab windows are opaque grey texture. Window panes are found from the base map (flat low-saturation grey islands on the
//     cab's front / side faces) and turned into rounded rectangles in each face's projection; the shell is CUT on each outline (the
//     straddling triangles split exactly on the rounded rectangle's zero line) and the window triangles removed; the opening gets a flat
//     clear pane (fitted to the removed surface, 1.5 cm oversize, 4 mm inside it). The rear of the canvas cover gets an opening the same
//     way (the bed's cargo is loaded from behind; the runtime adds the bed floor and the cab interior).
//  3. ONE meshoptimizer simplifyWithAttributes pass per part (normal + UV, seams kept, the window / opening outlines locked).
//  4. Anchors measured on the result (see the generated file).
//
// Usage: node --max-old-space-size=6144 tools/asset-pipeline/props/build-surface-truck.mjs [--master <glb>] [--out-dir <dir>] [--dry]
//   --master   the private master (default <repo>/reference/resources/user-military-truck/master.glb, else the main checkout's)
//   --out-dir  write the GLB + anchors JSON + provenance THERE only (QA; nothing in the repo is touched)
//   --dry      measure + print, write nothing
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {Document, NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const OUT_DIR = opt('--out-dir') ? path.resolve(opt('--out-dir')) : null;
const MASTER_REL = 'reference/resources/user-military-truck/master.glb';
const MASTER_SHA256 = '44d12d07e54e49530d74f6e528e40864e0e6e373caa8f93fd772d279e08f6b4a';
const MASTER_BYTES = 144_978_172;
const ID = 'surface-military-truck';
const OUT_REL = `assets/models/${ID}.glb`;
const PROV_REL = `assets/derivatives/${ID}.json`;
const GEN_TS = path.join(root, 'game/src/world/surface/truckAnchors.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');

const SCALE = 4.0;
const BUDGET = {body: 150_000, wheel: 5_000};
const TEX = {baseColor: {px: 2048, q: 88}, normal: {px: 2048, q: 90}, metallicRoughness: {px: 1024, q: 88}};
const SIMPLIFY = {weights: {normal: 0.5, uv: 1}, maxError: 0.004};
const WHEEL = {contactY: 0.03, gapZ: 0.2, ringPad: 0.015, cutIn: 0.03, siloY: [0.04, 0.3], siloZ: 0.75};
/** Window classification (base map, 4 barycentric samples): flat grey = chroma <= CHROMA, luminance in LUM. */
const WIN = {CHROMA: 16, LUM: [72, 175], FACING: 0.85, MIN_ISLAND: 0.03, BAND: [1.5, 2.35], MIN_H: 0.35, MIN_W: 0.2, FILL: 0.7, CAB_BACK: -2.1,
  SHRINK: 0.012, RADIUS: 0.07, EXPAND: 0.05, SLAB: 0.09};
const PANE = {oversize: 0.015, inset: 0.004, cornerSegs: 6};
/** The canvas cover's rear face (triangles facing +Z within `depth` of the tail, above minY) -> the opening inset by side / top / bottom. */
const REAR = {depth: 0.2, minY: 1.4, side: 0.12, top: 0.16, bottom: 0.06, radius: 0.08};
const GLASS = {baseColorFactor: [0.55, 0.62, 0.62, 0.16], metallicFactor: 0, roughnessFactor: 0.06};

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
const log = (...a) => console.log(...a);

// ---- 1. master (verified, read-only) ----------------------------------------------------------------------------------------
function masterPath() {
  const own = opt('--master');
  if (own) return path.resolve(own);
  const here = path.join(root, MASTER_REL);
  if (fs.existsSync(here)) return here;
  // a git worktree: the main checkout's reference/ (the private mount lives there)
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: root, encoding: 'utf8'}).trim();
  return path.join(path.dirname(common), MASTER_REL);
}
const MASTER = masterPath();
const srcBytes = fs.readFileSync(MASTER);
const masterSha = sha(srcBytes);
if (srcBytes.length !== MASTER_BYTES || masterSha !== MASTER_SHA256) throw new Error(`master size / sha256 mismatch: ${srcBytes.length} ${masterSha}`);
log(`master ${MASTER}: ${srcBytes.length} B, sha256 ${masterSha} (verified)`);
const srcDoc = await new NodeIO().readBinary(new Uint8Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength));
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
for (const [k, t] of Object.entries(texSrc)) if (!t) throw new Error(`master lacks ${k}`);
const srcTex = Object.fromEntries(Object.entries(texSrc).map(([k, t]) => [k, {size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}]));
const nv0 = S_P.length / 3, nt0 = I0.length / 3;
const srcStats = {vertices: nv0, triangles: nt0};
log(`master: ${nt0} tris, ${nv0} verts`);

// ---- 2. frame -----------------------------------------------------------------------------------------------------------------
const smin = [Infinity, Infinity, Infinity], smax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < S_P.length; i += 3) for (let k = 0; k < 3; k++) { smin[k] = Math.min(smin[k], S_P[i + k]); smax[k] = Math.max(smax[k], S_P[i + k]); }
const scx = (smin[0] + smax[0]) / 2, scz = (smin[2] + smax[2]) / 2;
const P0 = new Float32Array(S_P.length), N0 = new Float32Array(S_N.length);
for (let i = 0; i < S_P.length; i += 3) {
  P0[i] = -(S_P[i + 2] - scz) * SCALE; P0[i + 1] = (S_P[i + 1] - smin[1]) * SCALE; P0[i + 2] = (S_P[i] - scx) * SCALE;
  N0[i] = -S_N[i + 2]; N0[i + 1] = S_N[i + 1]; N0[i + 2] = S_N[i];
}
// exact-position weld -> adjacency
const weld0 = new Int32Array(nv0);
let nWeld = 0;
{
  const key = new Map();
  for (let v = 0; v < nv0; v++) { const k = `${S_P[3 * v]},${S_P[3 * v + 1]},${S_P[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld0[v] = w; }
  nWeld = key.size;
}
const adj = new Int32Array(nt0 * 3).fill(-1);
{
  const em = new Map();
  for (let f = 0; f < nt0; f++) for (let e = 0; e < 3; e++) {
    const u = weld0[I0[3 * f + e]], v = weld0[I0[3 * f + (e + 1) % 3]];
    const k = u < v ? u * 4194304 + v : v * 4194304 + u;
    const o = em.get(k);
    if (o === undefined) em.set(k, 3 * f + e); else if (o >= 0) { adj[3 * f + e] = Math.floor(o / 3); adj[o] = f; em.set(k, -1); }
  }
}

// ---- 3. per-triangle features ---------------------------------------------------------------------------------------------------
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
const bmin0 = [Infinity, Infinity, Infinity], bmax0 = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < P0.length; i += 3) for (let k = 0; k < 3; k++) { bmin0[k] = Math.min(bmin0[k], P0[i + k]); bmax0[k] = Math.max(bmax0[k], P0[i + k]); }
log('runtime bounds', bmin0.map(r3), bmax0.map(r3));

/** connected components (edge adjacency) of the triangles in a set */
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
  return out.sort((a, b) => b.area - a.area);
}

// ---- 4. wheels ------------------------------------------------------------------------------------------------------------------
const wheels = [];
{
  const contact = [];
  for (let f = 0; f < nt0; f++) if (CEN[3 * f + 1] < WHEEL.contactY) contact.push(f);
  for (const side of [-1, 1]) {
    const own = contact.filter(f => Math.sign(CEN[3 * f]) === side).sort((a, b) => CEN[3 * a + 2] - CEN[3 * b + 2]);
    let group = [];
    const flush = () => { if (group.length) wheels.push({side, faces: group}); group = []; };
    for (const f of own) { if (group.length && CEN[3 * f + 2] - CEN[3 * group[group.length - 1] + 2] > WHEEL.gapZ) flush(); group.push(f); }
    flush();
  }
  if (wheels.length !== 8) throw new Error(`expected 8 tyre contact patches, found ${wheels.length}`);
  for (const w of wheels) {
    const xs = w.faces.map(f => CEN[3 * f]), zs = w.faces.map(f => CEN[3 * f + 2]);
    w.z = (Math.min(...zs) + Math.max(...zs)) / 2;
    w.xin = w.side > 0 ? Math.min(...xs) : Math.max(...xs);
    w.xout = w.side > 0 ? Math.max(...xs) : Math.min(...xs);
    // radius from the tyre's lower silhouette (outer 60 % of the tread width: clear of the axle / suspension), r = (dz^2 + y^2) / 2y
    const xa = w.xin + (w.xout - w.xin) * 0.4, lo = Math.min(xa, w.xout), hi = Math.max(xa, w.xout);
    const bins = new Map();
    for (let v = 0; v < nv0; v++) {
      const x = P0[3 * v], y = P0[3 * v + 1], z = P0[3 * v + 2];
      if (x < lo || x > hi || y < WHEEL.siloY[0] || y > WHEEL.siloY[1] || Math.abs(z - w.z) > WHEEL.siloZ) continue;
      const k = Math.round(y * 100);
      bins.set(k, Math.max(bins.get(k) ?? 0, Math.abs(z - w.z)));
    }
    const est = [...bins].map(([k, dz]) => { const y = k / 100; return (dz * dz + y * y) / (2 * y); }).sort((a, b) => a - b);
    w.rSilhouette = est[Math.floor(est.length / 2)];
  }
  // axle 1 L, axle 1 R, axle 2 L, … (pairs by z, each pair left first)
  wheels.sort((a, b) => a.z - b.z);
  for (let a = 0; a < 4; a++) {
    const p = wheels.slice(2 * a, 2 * a + 2).sort((x, y) => x.side - y.side);
    if (p[0].side !== -1 || p[1].side !== 1 || Math.abs(p[0].z - p[1].z) > 0.05) throw new Error('wheels do not pair into axles');
    wheels.splice(2 * a, 2, ...p);
  }
  // ONE tyre size (the eight tyres are the same model): the median of the eight silhouette estimates (the rear axles' lower silhouettes
  // also catch the mud flaps / bed hangers behind them, so a per-wheel value would read them as bigger tyres)
  const rs = wheels.map(w => w.rSilhouette).sort((a, b) => a - b), rMed = (rs[3] + rs[4]) / 2;
  for (const w of wheels) w.r = rMed;
  if (rMed < 0.5 || rMed > 0.65) throw new Error(`implausible wheel radius ${rMed}`);
  log('wheels', wheels.map(w => `${w.side < 0 ? 'L' : 'R'} z ${w.z.toFixed(3)} x ${w.xin.toFixed(3)}..${w.xout.toFixed(3)} r ${w.r.toFixed(3)} (silhouette ${w.rSilhouette.toFixed(3)})`).join(' | '));
}
const wheelOf = new Int8Array(nt0).fill(-1);
{
  for (let f = 0; f < nt0; f++) {
    const x = CEN[3 * f], y = CEN[3 * f + 1], z = CEN[3 * f + 2];
    if (y > 1.4) continue;
    for (let i = 0; i < 8; i++) {
      const w = wheels[i];
      if (Math.sign(x) !== w.side) continue;
      if (w.side * x < w.side * w.xin - WHEEL.cutIn) continue; // inboard of the cut plane
      if (Math.hypot(y - w.r, z - w.z) > w.r + WHEEL.ringPad) continue;
      wheelOf[f] = i; break;
    }
  }
  for (let i = 0; i < 8; i++) { let n = 0; for (let f = 0; f < nt0; f++) if (wheelOf[f] === i) n++; wheels[i].srcTris = n; }
  log('wheel triangles', wheels.map(w => w.srcTris).join(' '));
}

// ---- 5. windows (texture islands on the cab faces) and the bed's rear opening ----------------------------------------------------
// the cab: ahead of the first gap behind it — taken as the region in front of axle 2's centre, above the wheel tops
const cabZ1 = (wheels[2].z + wheels[4].z) / 2; // (between axle 2 and 3: generous; the faces test narrows it)
const front = bmin0[2];
const faceDefs = [
  {name: 'windscreen', axis: 2, sign: -1, u: 0, v: 1, zone: f => CEN[3 * f + 2] < front + 0.6 && CEN[3 * f + 1] > 1.3},
  {name: 'left', axis: 0, sign: -1, u: 2, v: 1, zone: f => CEN[3 * f] < bmin0[0] + 0.45 && CEN[3 * f + 2] < cabZ1 && CEN[3 * f + 1] > 1.3},
  {name: 'right', axis: 0, sign: 1, u: 2, v: 1, zone: f => CEN[3 * f] > bmax0[0] - 0.45 && CEN[3 * f + 2] < cabZ1 && CEN[3 * f + 1] > 1.3},
];
const windows = [], rejectedIslands = [];
for (const fd of faceDefs) {
  const isGrey = f => fd.zone(f) && fd.sign * FN[3 * f + fd.axis] > WIN.FACING && CHR[f] <= WIN.CHROMA && LUM[f] >= WIN.LUM[0] && LUM[f] <= WIN.LUM[1];
  const isl = components(isGrey).filter(s => s.area >= WIN.MIN_ISLAND);
  for (const s of isl) {
    if (fd.axis === 0) { let c = 0; for (const f of s.faces) c += CEN[3 * f + 2] * AREA[f]; if (c / s.area > WIN.CAB_BACK) continue; } // (side faces: the cab only)
    // area-weighted 2 % / 98 % extents in the face projection, the depth of the face
    const pts = s.faces.map(f => ({u: CEN[3 * f + fd.u], v: CEN[3 * f + fd.v], d: CEN[3 * f + fd.axis], a: AREA[f]}));
    const q = (key, p) => { const a = [...pts].sort((x, y) => x[key] - y[key]); let acc = 0; for (const x of a) { acc += x.a; if (acc >= p * s.area) return x[key]; } return a[a.length - 1][key]; };
    const w = {face: fd.name, axis: fd.axis, sign: fd.sign, uAxis: fd.u, vAxis: fd.v, area: s.area, tris: s.faces.length,
      u0: q('u', 0.01), u1: q('u', 0.99), v0: q('v', 0.01), v1: q('v', 0.99), d: q('d', 0.5)};
    // a pane: inside the window band, pane-sized, and rectangular (the island fills its box; camouflage patches are ragged)
    const fill = s.area / ((w.u1 - w.u0) * (w.v1 - w.v0));
    w.fill = fill;
    (w.v0 >= WIN.BAND[0] && w.v1 <= WIN.BAND[1] && w.v1 - w.v0 >= WIN.MIN_H && w.u1 - w.u0 >= WIN.MIN_W && fill >= WIN.FILL ? windows : rejectedIslands).push(w);
  }
}
const order = {windscreen: 0, left: 1, right: 2};
windows.sort((a, b) => order[a.face] - order[b.face] || a.u0 - b.u0);
for (const w of windows) {
  const same = windows.filter(x => x.face === w.face);
  w.name = w.face === 'windscreen' ? (w.u0 < 0 ? 'windscreen-left' : 'windscreen-right') : `${w.face}-${['front', 'middle', 'rear'][same.indexOf(w)] ?? same.indexOf(w)}`;
}
if (windows.length < 6) throw new Error(`expected at least the windscreen's two panes and two panes per door, found ${windows.length}`);
const islandText = w => `${w.name ?? w.face} ${w.tris}t ${w.area.toFixed(3)}m2 u ${w.u0.toFixed(3)}..${w.u1.toFixed(3)} v ${w.v0.toFixed(3)}..${w.v1.toFixed(3)} d ${w.d.toFixed(3)} fill ${w.fill.toFixed(2)}`;
log('window panes\n  ' + windows.map(islandText).join('\n  '));
log(`rejected grey islands: ${rejectedIslands.length}`);
if (DRY && argv.includes('--islands')) process.exit(0);

// the canvas cover's rear face -> the bed's rear opening (a rounded rectangle inside its edges)
const rearOpening = (() => {
  const faces = [];
  let area = 0;
  for (let f = 0; f < nt0; f++) if (wheelOf[f] < 0 && FN[3 * f + 2] > WIN.FACING && CEN[3 * f + 2] > bmax0[2] - REAR.depth && CEN[3 * f + 1] > REAR.minY) { faces.push(f); area += AREA[f]; }
  const pts = faces.map(f => ({u: CEN[3 * f], v: CEN[3 * f + 1], d: CEN[3 * f + 2], a: AREA[f]}));
  const q = (key, p) => { const a = [...pts].sort((x, y) => x[key] - y[key]); let acc = 0; for (const x of a) { acc += x.a; if (acc >= p * area) return x[key]; } return a[a.length - 1][key]; };
  const face = {u0: q('u', 0.01), u1: q('u', 0.99), v0: q('v', 0.01), v1: q('v', 0.99), d: q('d', 0.5)};
  return {name: 'bed-rear', face: 'rear', axis: 2, sign: 1, uAxis: 0, vAxis: 1, area, tris: faces.length, measured: face,
    u0: face.u0 + REAR.side, u1: face.u1 - REAR.side, v0: face.v0 + REAR.bottom, v1: face.v1 - REAR.top, d: face.d, radius: REAR.radius};
})();
log('bed rear face', JSON.stringify(rearOpening.measured), '-> opening', [rearOpening.u0, rearOpening.u1, rearOpening.v0, rearOpening.v1].map(r3));

// ---- 6. cut the shell on every outline (rounded rectangles in the face projections) ----------------------------------------------
const regions = [
  ...windows.map(w => ({...w, kind: 'pane', u0: w.u0 + WIN.SHRINK, u1: w.u1 - WIN.SHRINK, v0: w.v0 + WIN.SHRINK, v1: w.v1 - WIN.SHRINK, radius: WIN.RADIUS})),
  {...rearOpening, kind: 'opening'},
];
for (const r of regions) { r.uc = (r.u0 + r.u1) / 2; r.vc = (r.v0 + r.v1) / 2; r.hu = (r.u1 - r.u0) / 2; r.hv = (r.v1 - r.v0) / 2; }
/** signed distance to a region's rounded rectangle in its projection (< 0 inside) */
function sdf(r, x, y, z) {
  const p = [x, y, z], du = Math.abs(p[r.uAxis] - r.uc) - r.hu + r.radius, dv = Math.abs(p[r.vAxis] - r.vc) - r.hv + r.radius;
  let d = Math.hypot(Math.max(du, 0), Math.max(dv, 0)) + Math.min(Math.max(du, dv), 0) - r.radius;
  if (Math.abs(d) < 1e-7) d = 1e-7; // (never exactly on the outline: no zero-length cuts)
  return d;
}
const regionOf = new Int8Array(nt0).fill(-1);
for (let f = 0; f < nt0; f++) {
  if (wheelOf[f] >= 0) continue;
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k];
    // (any facing: the wiper blades / cover straps standing on the removed surface go with it — no floating slivers in the opening)
    if (Math.abs(CEN[3 * f + r.axis] - r.d) > WIN.SLAB) continue;
    if (sdf(r, CEN[3 * f], CEN[3 * f + 1], CEN[3 * f + 2]) > WIN.EXPAND) continue;
    regionOf[f] = k; break;
  }
}
const cutP = Array.from(P0), cutN = Array.from(N0), cutUV = Array.from(UV0);
const onOutline = new Set(); // vertex ids exactly on an outline
const bodyTris = [], removedByRegion = regions.map(() => []), wheelTris = Array.from({length: 8}, () => []);
let splitCount = 0;
{
  const edgeVert = new Map();
  const vf = (r, v) => sdf(r, P0[3 * v], P0[3 * v + 1], P0[3 * v + 2]);
  const cutVertex = (r, x, y) => {
    const k = x < y ? `${x}_${y}` : `${y}_${x}`;
    let id = edgeVert.get(k); if (id !== undefined) return id;
    const [u, w] = weld0[x] < weld0[y] ? [x, y] : [y, x]; // welded order: bit-identical positions across UV-seam duplicates
    const fu = vf(r, u), fw = vf(r, w), t = fu / (fu - fw);
    id = cutP.length / 3;
    for (let c = 0; c < 3; c++) cutP.push(P0[3 * u + c] + t * (P0[3 * w + c] - P0[3 * u + c]));
    let nx = N0[3 * u] + t * (N0[3 * w] - N0[3 * u]), ny = N0[3 * u + 1] + t * (N0[3 * w + 1] - N0[3 * u + 1]), nz = N0[3 * u + 2] + t * (N0[3 * w + 2] - N0[3 * u + 2]);
    const nl = Math.hypot(nx, ny, nz) || 1; cutN.push(nx / nl, ny / nl, nz / nl);
    cutUV.push(UV0[2 * u] + t * (UV0[2 * w] - UV0[2 * u]), UV0[2 * u + 1] + t * (UV0[2 * w + 1] - UV0[2 * u + 1]));
    edgeVert.set(k, id);
    onOutline.add(id);
    return id;
  };
  for (let f = 0; f < nt0; f++) {
    const v = [I0[3 * f], I0[3 * f + 1], I0[3 * f + 2]];
    if (wheelOf[f] >= 0) { wheelTris[wheelOf[f]].push(v[0], v[1], v[2]); continue; }
    const k = regionOf[f];
    if (k < 0) { bodyTris.push(v[0], v[1], v[2]); continue; }
    const r = regions[k], ins = v.map(x => (vf(r, x) < 0 ? 1 : 0));
    if (ins[0] && ins[1] && ins[2]) { removedByRegion[k].push(v[0], v[1], v[2]); continue; }
    if (!ins[0] && !ins[1] && !ins[2]) { bodyTris.push(v[0], v[1], v[2]); continue; }
    const lone = ins[0] !== ins[1] && ins[0] !== ins[2] ? 0 : ins[1] !== ins[0] && ins[1] !== ins[2] ? 1 : 2;
    const p = v[lone], q = v[(lone + 1) % 3], s2 = v[(lone + 2) % 3];
    const m1 = cutVertex(r, p, q), m2 = cutVertex(r, p, s2);
    const a = [p, m1, m2], b = [m1, q, s2, m1, s2, m2];
    (ins[lone] ? removedByRegion[k] : bodyTris).push(...a);
    (ins[lone] ? bodyTris : removedByRegion[k]).push(...b);
    splitCount++;
  }
}
log(`cut: ${splitCount} triangles split; removed per region ${regions.map((r, k) => `${r.name} ${removedByRegion[k].length / 3}`).join(', ')}`);

// ---- 7. caps: every boundary loop that is not an outline (the wheel cuts: body side and wheel side) ----------------------------------
const nCut = cutP.length / 3;
const weldC = [];
let weldN = 0;
{ const key = new Map(); for (let v = 0; v < nCut; v++) { const k = `${cutP[3 * v]},${cutP[3 * v + 1]},${cutP[3 * v + 2]}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weldC[v] = w; } weldN = key.size; }
// the dark tread texel: the darkest contact-patch triangle's UV (rubber)
const treadUV = (() => {
  let best = null, bl = Infinity;
  for (const w of wheels) for (const f of w.faces) {
    const u = (UV0[2 * I0[3 * f]] + UV0[2 * I0[3 * f + 1]] + UV0[2 * I0[3 * f + 2]]) / 3, v = (UV0[2 * I0[3 * f] + 1] + UV0[2 * I0[3 * f + 1] + 1] + UV0[2 * I0[3 * f + 2] + 1]) / 3;
    if (LUM[f] < bl) { bl = LUM[f]; best = [u, v]; }
  }
  return [...best, bl];
})();
/** open edges of a triangle list (welded), directed as in their triangle */
function openEdges(T) {
  const m = new Map();
  for (let i = 0; i < T.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = T[i + e], b = T[i + (e + 1) % 3], wa = weldC[a], wb = weldC[b], k = wa < wb ? wa * 8388608 + wb : wb * 8388608 + wa;
    const o = m.get(k);
    if (o) o.n++; else m.set(k, {a, b, n: 1});
  }
  return [...m.values()].filter(e => e.n === 1);
}
/** fan caps over the non-outline boundary loops of T (new vertices: the dark tread texel, the cap's own normal) */
function capLoops(T, label) {
  const E = openEdges(T).filter(e => !(onOutline.has(e.a) && onOutline.has(e.b)));
  const par = new Map(), find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const e of E) for (const v of [weldC[e.a], weldC[e.b]]) if (!par.has(v)) par.set(v, v);
  for (const e of E) { const a = find(weldC[e.a]), b = find(weldC[e.b]); if (a !== b) par.set(a, b); }
  const loops = new Map();
  for (const e of E) { const r = find(weldC[e.a]); let l = loops.get(r); if (!l) loops.set(r, (l = [])); l.push(e); }
  const stats = [];
  let fringe = 0;
  for (const l of loops.values()) {
    // a chain that reaches an outline is part of that opening's edge (a strap / lip under the cut): left open, never fanned across it
    if (l.some(e => onOutline.has(e.a) || onOutline.has(e.b))) { fringe += l.length; continue; }
    const c = [0, 0, 0];
    for (const e of l) for (let k = 0; k < 3; k++) c[k] += cutP[3 * e.a + k];
    for (let k = 0; k < 3; k++) c[k] /= l.length;
    // the cap's normal: the summed fan normals (each edge reversed: b, a, centre)
    const nn = [0, 0, 0];
    for (const e of l) {
      const A = [0, 1, 2].map(k => cutP[3 * e.b + k] - c[k]), B = [0, 1, 2].map(k => cutP[3 * e.a + k] - c[k]);
      nn[0] += A[1] * B[2] - A[2] * B[1]; nn[1] += A[2] * B[0] - A[0] * B[2]; nn[2] += A[0] * B[1] - A[1] * B[0];
    }
    const nl = Math.hypot(...nn) || 1;
    const vid = new Map();
    const copy = v => { const w = weldC[v]; let id = vid.get(w); if (id !== undefined) return id; id = cutP.length / 3; cutP.push(cutP[3 * v], cutP[3 * v + 1], cutP[3 * v + 2]); cutN.push(nn[0] / nl, nn[1] / nl, nn[2] / nl); cutUV.push(treadUV[0], treadUV[1]); weldC[id] = w; vid.set(w, id); return id; };
    const centre = cutP.length / 3; cutP.push(...c); cutN.push(nn[0] / nl, nn[1] / nl, nn[2] / nl); cutUV.push(treadUV[0], treadUV[1]); weldC[centre] = weldN++;
    for (const e of l) T.push(copy(e.b), copy(e.a), centre);
    stats.push({edges: l.length, area: r4(nl / 2), centre: c.map(r3)});
  }
  return {label, loops: stats.length, edges: E.length, fringe, stats: stats.sort((a, b) => b.edges - a.edges).slice(0, 12)};
}
const capLog = [capLoops(bodyTris, 'body'), ...wheelTris.map((T, i) => capLoops(T, `wheel-${i}`))];
log('caps', capLog.map(c => `${c.label}: ${c.loops} loops / ${c.edges} edges${c.fringe ? ` (opening fringe ${c.fringe})` : ''}`).join('; '));
// the remaining open edges of the body are exactly the outlines (no crack anywhere else)
const bodyOpen = openEdges(bodyTris), strayOpen = bodyOpen.filter(e => !(onOutline.has(e.a) && onOutline.has(e.b))).length - capLog[0].fringe;
log(`body open edges after caps: ${bodyOpen.length} (off an outline: ${strayOpen})`);
if (strayOpen) {
  for (const e of bodyOpen.filter(e => !(onOutline.has(e.a) && onOutline.has(e.b))).slice(0, 40)) log('  stray', [e.a, e.b].map(v => `${v}${onOutline.has(v) ? '*' : ''}@${[0, 1, 2].map(k => cutP[3 * v + k].toFixed(3))}`).join(' - '));
  throw new Error(`${strayOpen} open body edges off the outlines`);
}

// ---- 8. simplification (one pass per part; the outlines locked) -------------------------------------------------------------------
const vP = Float32Array.from(cutP), vN = Float32Array.from(cutN), vUV = Float32Array.from(cutUV);
await MeshoptSimplifier.ready;
function simplifyPart(T, budget, name) {
  const map = new Map(), P = [], N = [], UV = [], lock = [];
  const I = new Uint32Array(T.length);
  for (let i = 0; i < T.length; i++) {
    const v = T[i]; let id = map.get(v);
    if (id === undefined) { id = P.length / 3; map.set(v, id); P.push(vP[3 * v], vP[3 * v + 1], vP[3 * v + 2]); N.push(vN[3 * v], vN[3 * v + 1], vN[3 * v + 2]); UV.push(vUV[2 * v], vUV[2 * v + 1]); lock.push(onOutline.has(v) ? 1 : 0); }
    I[i] = id;
  }
  const pP = Float32Array.from(P), pN = Float32Array.from(N), pUV = Float32Array.from(UV), nv = pP.length / 3;
  const attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) { for (let k = 0; k < 3; k++) attrs[5 * v + k] = pN[3 * v + k] * SIMPLIFY.weights.normal; attrs[5 * v + 3] = pUV[2 * v]; attrs[5 * v + 4] = pUV[2 * v + 1]; }
  const scale = MeshoptSimplifier.getScale(pP, 3);
  let target = budget, out, err;
  for (let k = 0; k < 8; k++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(I, pP, 3, attrs, 5, [1, 1, 1, 1, 1], Uint8Array.from(lock), target * 3, 1, []);
    if (out.length / 3 <= budget) break;
    target -= out.length / 3 - budget + 100;
  }
  if (out.length / 3 > budget) throw new Error(`${name}: budget ${budget} not reached (${out.length / 3})`);
  const m2 = new Int32Array(nv).fill(-1), oP = [], oN = [], oUV = [], oI = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (m2[v] < 0) { m2[v] = oP.length / 3; oP.push(pP[3 * v], pP[3 * v + 1], pP[3 * v + 2]); oN.push(pN[3 * v], pN[3 * v + 1], pN[3 * v + 2]); oUV.push(pUV[2 * v], pUV[2 * v + 1]); }
    oI[i] = m2[v];
  }
  log(`simplify ${name}: ${T.length / 3} -> ${out.length / 3} tris, ${oP.length / 3} verts, error ${(err * scale * 1000).toFixed(2)} mm`);
  return {P: Float32Array.from(oP), N: Float32Array.from(oN), UV: Float32Array.from(oUV), I: oI, from: T.length / 3, errorM: err * scale};
}
const body = simplifyPart(bodyTris, BUDGET.body, 'body');
const wheelParts = wheelTris.map((T, i) => simplifyPart(T, BUDGET.wheel, `wheel-${i}`));
// each wheel about its hub (the node carries the hub's translation): x = the tread's middle, y = r over the ground, z = the patch's middle
for (let i = 0; i < 8; i++) {
  const w = wheels[i], hub = [(w.xin + w.xout) / 2, w.r, w.z], M = wheelParts[i];
  w.hub = hub;
  for (let v = 0; v < M.P.length / 3; v++) for (let k = 0; k < 3; k++) M.P[3 * v + k] -= hub[k];
}

// ---- 9. glass panes: flat, fitted to each removed window surface, oversize, just inside it ----------------------------------------
const panes = [];
{
  const Pc = vP;
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k];
    if (r.kind !== 'pane') continue;
    // least squares depth = a + b u + c v over the removed triangles that face out (the wiper blades / frame lips excluded)
    const T = removedByRegion[k];
    let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0], n = 0;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      const ux = Pc[3 * b] - Pc[3 * a], uy = Pc[3 * b + 1] - Pc[3 * a + 1], uz = Pc[3 * b + 2] - Pc[3 * a + 2], vx = Pc[3 * c] - Pc[3 * a], vy = Pc[3 * c + 1] - Pc[3 * a + 1], vz = Pc[3 * c + 2] - Pc[3 * a + 2];
      const nn = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], nl = Math.hypot(...nn) || 1;
      if (r.sign * nn[r.axis] / nl < WIN.FACING) continue;
      for (const v of [a, b, c]) {
        const x = [1, Pc[3 * v + r.uAxis], Pc[3 * v + r.vAxis]], d = Pc[3 * v + r.axis];
        for (let p = 0; p < 3; p++) { B[p] += x[p] * d; for (let q = 0; q < 3; q++) S[p][q] += x[p] * x[q]; }
        n++;
      }
    }
    // solve 3 x 3 (Cramer)
    const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det3(S), coef = [0, 1, 2].map(j => det3(S.map((row, i) => row.map((x, c) => (c === j ? B[i] : x)))) / D);
    const depth = (u, v) => coef[0] + coef[1] * u + coef[2] * v - r.sign * PANE.inset;
    // the rounded rectangle, oversize
    const hu = r.hu + PANE.oversize, hv = r.hv + PANE.oversize, rad = r.radius + PANE.oversize, ring = [];
    for (const [cu, cv, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) for (let s = 0; s <= PANE.cornerSegs; s++) {
      const a = (a0 + 90 * s / PANE.cornerSegs) * Math.PI / 180;
      ring.push([r.uc + cu * (hu - rad) + Math.cos(a) * rad, r.vc + cv * (hv - rad) + Math.sin(a) * rad]);
    }
    const to3 = (u, v) => { const p = [0, 0, 0]; p[r.uAxis] = u; p[r.vAxis] = v; p[r.axis] = depth(u, v); return p; };
    const normal = [0, 0, 0]; normal[r.axis] = r.sign;
    // (the fitted plane's tilt into the normal)
    normal[r.uAxis] = -coef[1] * r.sign; normal[r.vAxis] = -coef[2] * r.sign;
    const nl = Math.hypot(...normal); for (let i = 0; i < 3; i++) normal[i] /= nl;
    panes.push({name: r.name, centre: to3(r.uc, r.vc), ring: ring.map(([u, v]) => to3(u, v)), normal, fitVerts: n,
      box: (() => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const [u, v] of ring) { const p = to3(u, v); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); } } return {lo, hi}; })()});
  }
}
const glass = (() => {
  const P = [], N = [], I = [];
  for (const p of panes) {
    const c = P.length / 3;
    P.push(...p.centre); N.push(...p.normal);
    for (const q of p.ring) { P.push(...q); N.push(...p.normal); }
    const m = p.ring.length;
    for (let i = 0; i < m; i++) {
      const a = c + 1 + i, b = c + 1 + (i + 1) % m;
      // winding: the face normal along the pane's outward normal
      const A = [0, 1, 2].map(k => P[3 * a + k] - P[3 * c + k]), Bv = [0, 1, 2].map(k => P[3 * b + k] - P[3 * c + k]);
      const fn = [A[1] * Bv[2] - A[2] * Bv[1], A[2] * Bv[0] - A[0] * Bv[2], A[0] * Bv[1] - A[1] * Bv[0]];
      if (fn[0] * p.normal[0] + fn[1] * p.normal[1] + fn[2] * p.normal[2] >= 0) I.push(c, a, b); else I.push(c, b, a);
    }
  }
  return {P: Float32Array.from(P), N: Float32Array.from(N), I: Uint32Array.from(I)};
})();
log('glass panes', panes.map(p => `${p.name} c ${p.centre.map(r3)} n ${p.normal.map(r3)}`).join(' | '));

// ---- 10. anchors: measured on the cooked parts (truck frame) -----------------------------------------------------------------------
const ANCH = {
  /** the driver's eye: the left windscreen pane's centre x, its centre height + overScreenMid, behindScreen behind the fitted pane */
  eye: {behindScreen: 0.7, overScreenMid: 0.07},
  /** the seat's H-point from the eye (a truck seat: upright) */
  seat: {dy: -0.74, dz: 0.1},
  /** the steering wheel's pivot (its hub) from the eye; rim radius; tilt = the wheel plane's angle from horizontal (a truck's flat wheel) */
  steering: {dy: -0.46, dz: -0.36, radius: 0.22, tilt: 0.6},
  /** stand points this far outside the cab side at the door (m) */
  exitOut: 0.7,
  /** collision circles: columns across the width, circles `spacing` apart along each (a flat-ended body: small circles bulge little) */
  circles: {cols: 3, spacing: 0.6},
  /** voxel size (m) for the free cab box; headroom over the eye the box must hold */
  vox: 0.03, headroom: 0.12,
  /** headlamps: bright, low-chroma, forward-facing master triangles on the nose, low on the bumper, off the centre line */
  lamp: {lum: 150, chroma: 45, facing: 0.5, y: [0.6, 1.12], xMin: 0.4, depth: 0.5, pad: 0.01},
  /** the bed: secure points 2 x 3 on its floor, inset from the inner walls; gap between neighbours */
  bed: {inset: 0.08, cols: 2, rows: 3, gap: 0.06, clear: 0.05},
  /**
   * storage compartments (the outer box faces read off the 0.1 m grid renders of the side views; the face x is measured here):
   * left = the dark locker between axles 2 and 3 on the left frame rail; right = the small latched box ahead of the right fuel tank.
   */
  storage: [
    {id: 'left-locker', name: 'Left locker', side: -1, z: [-0.22, 0.58], y: [0.72, 1.15], depth: 0.42, slots: 12},
    {id: 'right-locker', name: 'Right locker', side: 1, z: [0.68, 0.93], y: [0.76, 1.3], depth: 0.34, slots: 6},
  ],
};
const parts = [
  {kind: 'body', P: body.P, I: body.I},
  {kind: 'glass', P: glass.P, I: glass.I},
  ...wheelParts.map((M, i) => ({kind: 'wheel', P: M.P.map((x, j) => x + wheels[i].hub[j % 3]), I: M.I})),
];
const TRI = (() => {
  let n = 0;
  for (const m of parts) n += m.I.length / 3;
  const V = new Float32Array(n * 9), K = new Uint8Array(n);
  let t = 0;
  parts.forEach((m, mi) => { for (let i = 0; i < m.I.length; i += 3, t++) { for (let e = 0; e < 3; e++) for (let k = 0; k < 3; k++) V[9 * t + 3 * e + k] = m.P[3 * m.I[i + e] + k]; K[t] = mi; } });
  return {V, K, n};
})();
const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < TRI.V.length; i += 3) for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], TRI.V[i + k]); bmax[k] = Math.max(bmax[k], TRI.V[i + k]); }
const dims = [0, 1, 2].map(k => bmax[k] - bmin[k]);
/** Möller–Trumbore: distance along d (Infinity = no hit); sets HIT.outer (the triangle faces the ray) */
const HIT = {outer: false};
function hitTri(t, o, d) {
  const V = TRI.V, b = 9 * t;
  const e1x = V[b + 3] - V[b], e1y = V[b + 4] - V[b + 1], e1z = V[b + 5] - V[b + 2], e2x = V[b + 6] - V[b], e2y = V[b + 7] - V[b + 1], e2z = V[b + 8] - V[b + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return Infinity;
  const inv = 1 / det, sx = o[0] - V[b], sy = o[1] - V[b + 1], sz = o[2] - V[b + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  HIT.outer = det < 0; // (the ray meets the front face: e1 x e2 . d < 0)
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
/** nearest hit along a general ray (brute force) */
function raycast(o, d, tMin = 1e-4) {
  let best = Infinity, kind = 'none', outer = false;
  for (let t = 0; t < TRI.n; t++) { const s = hitTri(t, o, d); if (s > tMin && s < best) { best = s; kind = parts[TRI.K[t]].kind; outer = HIT.outer; } }
  return {t: best, hit: kind, outer};
}
/** axis-aligned rays: triangles binned by their extent across the axis */
const AXBIN = 0.05;
const axisBins = [0, 1, 2].map(axis => {
  const ua = (axis + 1) % 3, va = (axis + 2) % 3, m = new Map(), V = TRI.V;
  for (let t = 0; t < TRI.n; t++) {
    const b = 9 * t;
    const u0 = Math.floor(Math.min(V[b + ua], V[b + 3 + ua], V[b + 6 + ua]) / AXBIN), u1 = Math.floor(Math.max(V[b + ua], V[b + 3 + ua], V[b + 6 + ua]) / AXBIN);
    const v0 = Math.floor(Math.min(V[b + va], V[b + 3 + va], V[b + 6 + va]) / AXBIN), v1 = Math.floor(Math.max(V[b + va], V[b + 3 + va], V[b + 6 + va]) / AXBIN);
    for (let i = u0; i <= u1; i++) for (let j = v0; j <= v1; j++) { const k = i * 100003 + j; let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(t); }
  }
  return {ua, va, m};
});
/** the first hit from o along +-axis (distance; Infinity none), only kinds in `kinds` */
function axisCast(o, axis, sign, kinds = ['body', 'glass', 'wheel']) {
  const B = axisBins[axis], d = [0, 0, 0];
  d[axis] = sign;
  const list = B.m.get(Math.floor(o[B.ua] / AXBIN) * 100003 + Math.floor(o[B.va] / AXBIN)) ?? [];
  let best = Infinity, outer = false;
  for (const t of list) { if (!kinds.includes(parts[TRI.K[t]].kind)) continue; const s = hitTri(t, o, d); if (s > 1e-4 && s < best) { best = s; outer = HIT.outer; } }
  return {t: best, outer};
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// wheels: hub, radius, axle; the bicycle model's wheelbase runs from the front axle to the rear tandem's middle (the turn centre lies on
// the line through the rear tandem); the second axle steers in proportion (Ackermann-like ratio of tangents)
const axleZ = [0, 1, 2, 3].map(a => (wheels[2 * a].hub[2] + wheels[2 * a + 1].hub[2]) / 2);
const rearMid = (axleZ[2] + axleZ[3]) / 2, wheelBase = r3(rearMid - axleZ[0]);
const steerRatio = a => (a < 2 ? r3((rearMid - axleZ[a]) / (rearMid - axleZ[0])) : 0);
const wheelAnchors = wheels.map((w, i) => ({x: r3(w.hub[0]), y: r3(w.hub[1]), z: r3(w.hub[2]), r: r3(w.r), axle: i >> 1, steer: steerRatio(i >> 1)}));
const track = r3([0, 1, 2, 3].reduce((s, a) => s + wheels[2 * a + 1].hub[0] - wheels[2 * a].hub[0], 0) / 4);

// the driver: eye, seat, steering wheel; the roof / floor over and under the eye
const paneBy = n => { const p = panes.find(q => q.name === n); if (!p) throw new Error(`pane ${n} missing`); return p; };
const wsL = paneBy('windscreen-left'), wsR = paneBy('windscreen-right');
const eye = {x: r3(wsL.centre[0]), y: r3(wsL.centre[1] + ANCH.eye.overScreenMid), z: r3(wsL.centre[2] + ANCH.eye.behindScreen)};
const eyeO = [eye.x, eye.y, eye.z];
const roofAtEye = r3(eye.y + axisCast(eyeO, 1, 1, ['body']).t), floorAtEye = r3(eye.y - axisCast(eyeO, 1, -1, ['body']).t);
const seat = {x: eye.x, y: r3(eye.y + ANCH.seat.dy), z: r3(eye.z + ANCH.seat.dz)};
const wheelCentre = {x: eye.x, y: r3(eye.y + ANCH.steering.dy), z: r3(eye.z + ANCH.steering.dz)};
const steering = {radius: ANCH.steering.radius, tilt: ANCH.steering.tilt};
const wsLo = Math.min(wsL.box.lo[1], wsR.box.lo[1]), wsHi = Math.max(wsL.box.hi[1], wsR.box.hi[1]);
const cowl = {y: r2(wsLo), z: r2(wsL.centre[2])}, header = {y: r2(wsHi), z: r2(wsL.centre[2])};
log(`eye ${JSON.stringify(eye)} roof ${roofAtEye} floor ${floorAtEye} seat ${JSON.stringify(seat)} wheel ${JSON.stringify(wheelCentre)}`);
if (!(roofAtEye - eye.y > 0.15 && roofAtEye - eye.y < 0.8)) throw new Error(`no cab roof over the eye (${roofAtEye})`);
if (!(seat.y - floorAtEye > 0.3)) throw new Error(`the seat is not above the cab floor (${floorAtEye})`);

// the free cab box (voxels of body + glass, dilated one voxel): seeded around the eye + steering wheel, grown face by face, x-symmetric
// about the windscreen's middle
const cabCx = (wsL.box.lo[0] + wsR.box.hi[0]) / 2;
const VOX = ANCH.vox, g0 = bmin.map(v => v - 2 * VOX), G = [0, 1, 2].map(k => Math.ceil((dims[k] + 4 * VOX) / VOX) + 1);
const occ = new Uint8Array(G[0] * G[1] * G[2]);
const vid = (i, j, k) => (k * G[1] + j) * G[0] + i;
for (let t = 0; t < TRI.n; t++) {
  const kind = parts[TRI.K[t]].kind;
  if (kind === 'wheel') continue;
  const V = TRI.V, b = 9 * t;
  const e = Math.max(Math.hypot(V[b] - V[b + 3], V[b + 1] - V[b + 4], V[b + 2] - V[b + 5]), Math.hypot(V[b] - V[b + 6], V[b + 1] - V[b + 7], V[b + 2] - V[b + 8]), Math.hypot(V[b + 3] - V[b + 6], V[b + 4] - V[b + 7], V[b + 5] - V[b + 8]));
  const n = Math.max(1, Math.ceil(e / (VOX * 0.5)));
  for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
    const wa = 1 - (u + v) / n, wb = u / n, wc = v / n;
    const p = [0, 1, 2].map(k => wa * V[b + k] + wb * V[b + 3 + k] + wc * V[b + 6 + k]);
    occ[vid(Math.floor((p[0] - g0[0]) / VOX), Math.floor((p[1] - g0[1]) / VOX), Math.floor((p[2] - g0[2]) / VOX))] = 1;
  }
}
const dil = new Uint8Array(occ.length);
for (let k = 1; k < G[2] - 1; k++) for (let j = 1; j < G[1] - 1; j++) for (let i = 1; i < G[0] - 1; i++) {
  if (!occ[vid(i, j, k)]) continue;
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) dil[vid(i + di, j + dj, k + dk)] = 1;
}
const boxFree = (i0, i1, j0, j1, k0, k1) => {
  if (i0 < 0 || j0 < 0 || k0 < 0 || i1 > G[0] || j1 > G[1] || k1 > G[2]) return false;
  for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) if (dil[vid(i, j, k)]) return false;
  return true;
};
const ix = x => Math.round((x - g0[0]) / VOX), iy = y => Math.round((y - g0[1]) / VOX), iz = z => Math.round((z - g0[2]) / VOX);
const fx = i => g0[0] + i * VOX, fy = j => g0[1] + j * VOX, fz = k => g0[2] + k * VOX;
const clear = (() => {
  const ic = ix(cabCx);
  let h = Math.max(ix(eye.x + 0.12) - ic, ic - ix(eye.x - 0.12), ic - ix(wheelCentre.x - steering.radius), ix(wheelCentre.x + steering.radius) - ic);
  let j0 = iy(wheelCentre.y - 0.12), j1 = iy(eye.y + ANCH.headroom), k0 = iz(wheelCentre.z - 0.1), k1 = iz(eye.z + 0.12);
  if (!boxFree(ic - h, ic + h, j0, j1, k0, k1)) throw new Error('the seed cab box (eye + steering wheel) is not free of the shell');
  // depth and height first (a seat and a dash need the cab's length), then the width
  for (const withX of [false, true]) for (let grew = true; grew;) {
    grew = false;
    if (withX && boxFree(ic - h - 1, ic + h + 1, j0, j1, k0, k1)) { h++; grew = true; }
    if (boxFree(ic - h, ic + h, j0 - 1, j1, k0, k1)) { j0--; grew = true; }
    if (boxFree(ic - h, ic + h, j0, j1 + 1, k0, k1)) { j1++; grew = true; }
    if (boxFree(ic - h, ic + h, j0, j1, k0 - 1, k1)) { k0--; grew = true; }
    if (boxFree(ic - h, ic + h, j0, j1, k0, k1 + 1)) { k1++; grew = true; }
  }
  return {x0: r2(fx(ic - h)), x1: r2(fx(ic + h)), y0: r2(fy(j0)), y1: r2(fy(j1)), z0: r2(fz(k0)), z1: r2(fz(k1))};
})();
// the cab's volume: its inner walls seen from the eye (body + glass: the side / front glass, the back wall, the roof, the floor)
const interior = (() => {
  const c = (axis, sign) => axisCast(eyeO, axis, sign, ['body', 'glass']).t;
  const box = {x0: r2(eye.x - c(0, -1)), x1: r2(eye.x + c(0, 1)), y0: floorAtEye, y1: roofAtEye, z0: r2(eye.z - c(2, -1)), z1: r2(eye.z + c(2, 1))};
  if (![box.x0, box.x1, box.z0, box.z1].every(Number.isFinite) || box.x1 - box.x0 < 1.6 || box.z1 - box.z0 < 1) throw new Error(`the cab's walls not found: ${JSON.stringify(box)}`);
  return box;
})();
log('cab volume', JSON.stringify(interior), 'clear box', JSON.stringify(clear));

// doors / exits: the cab side at the front side window (the door), stand points exitOut outside it
const doorZ = r2((paneBy('left-front').centre[2] + paneBy('right-front').centre[2]) / 2);
const halfAt = (side, z) => { let m = 0; const P = body.P; for (let i = 0; i < P.length; i += 3) if (Math.sign(P[i]) === side && Math.abs(P[i + 2] - z) < 0.12 && P[i + 1] > 0.8 && P[i + 1] < 1.6) m = Math.max(m, Math.abs(P[i])); return m; };
const exits = {left: {x: r2(-(halfAt(-1, doorZ) + ANCH.exitOut)), z: doorZ}, right: {x: r2(halfAt(1, doorZ) + ANCH.exitOut), z: doorZ}};

// collision circles: COLUMNS (the body is long, narrow and flat-ended: centre-line circles wide enough for it bulge a metre past the
// nose); `cols` equal bands across the footprint's width, each band's z extent covered by circles `spacing` apart (each circle covers its
// band's rectangle exactly: r = hypot(band half-width, spacing / 2), rounded up to the cm)
const circles = (() => {
  const C = ANCH.circles, hw = (bmax[0] - bmin[0]) / (2 * C.cols), out = [];
  for (let c = 0; c < C.cols; c++) {
    const x0 = bmin[0] + 2 * hw * c, x1 = x0 + 2 * hw;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < TRI.V.length; i += 3) if (TRI.V[i] >= x0 - 1e-6 && TRI.V[i] <= x1 + 1e-6) { z0 = Math.min(z0, TRI.V[i + 2]); z1 = Math.max(z1, TRI.V[i + 2]); }
    const n = Math.max(1, Math.ceil((z1 - z0) / C.spacing)), s = (z1 - z0) / n, r = Math.ceil(Math.hypot(hw, s / 2) * 100) / 100;
    for (let k = 0; k < n; k++) out.push({x: r3((x0 + x1) / 2), z: r3(z0 + s * (k + 0.5)), r});
  }
  return out.sort((a, b) => a.z - b.z || a.x - b.x);
})();
for (let i = 0; i < TRI.V.length; i += 3) if (!circles.some(c => Math.hypot(TRI.V[i] - c.x, TRI.V[i + 2] - c.z) <= c.r)) throw new Error('circles do not cover the footprint');
const circleBulge = (() => { // the most a circle reaches past the footprint's box (nose / tail / sides), m
  let m = 0;
  for (const c of circles) m = Math.max(m, bmin[2] - (c.z - c.r), c.z + c.r - bmax[2], bmin[0] - (c.x - c.r), c.x + c.r - bmax[0]);
  return r3(m);
})();
log(`collision circles: ${circles.length} (${ANCH.circles.cols} columns), r ${circles[0].r}, the most past the footprint box ${circleBulge} m`);

// headlamps: from the master's base map (bright, low-chroma, forward-facing, on the nose, low, off the centre line)
const lamps = (() => {
  const L = ANCH.lamp, out = {};
  for (const side of [-1, 1]) {
    const faces = [];
    let area = 0;
    for (let f = 0; f < nt0; f++) {
      const x = CEN[3 * f], y = CEN[3 * f + 1], z = CEN[3 * f + 2];
      if (wheelOf[f] >= 0 || Math.sign(x) !== side || Math.abs(x) < L.xMin || y < L.y[0] || y > L.y[1] || z > front + L.depth) continue;
      if (-FN[3 * f + 2] < L.facing || LUM[f] < L.lum || CHR[f] > L.chroma) continue;
      faces.push(f); area += AREA[f];
    }
    if (area < 0.004) throw new Error(`headlamp ${side} not found (${area} m2)`);
    const q = (k, p) => { const a = faces.map(f => [CEN[3 * f + k], AREA[f]]).sort((x, y) => x[0] - y[0]); let acc = 0; for (const [v, w] of a) { acc += w; if (acc >= p * area) return v; } return a[a.length - 1][0]; };
    const x0 = q(0, 0.03) - L.pad, x1 = q(0, 0.97) + L.pad, y0 = q(1, 0.03) - L.pad, y1 = q(1, 0.97) + L.pad, z = q(2, 0.5);
    out[side < 0 ? 'left' : 'right'] = {x0, x1, y0, y1, z, area: r4(area), tris: faces.length};
  }
  // the two lamps are one part mirrored about the cab's middle: the side whose bright area is larger (the other's paint is dimmer /
  // dirtier) gives the box, mirrored for the other
  const src = out.left.area >= out.right.area ? out.left : out.right, m = x => 2 * cabCx - x;
  const boxOf = (b, mirror) => { const x0 = mirror ? m(b.x1) : b.x0, x1 = mirror ? m(b.x0) : b.x1; return {poly: [[r3(x0), r3(b.y1)], [r3(x1), r3(b.y1)], [r3(x1), r3(b.y0)], [r3(x0), r3(b.y0)]], centre: {x: r3((x0 + x1) / 2), y: r3((b.y0 + b.y1) / 2), z: r3(b.z)}}; };
  const measured = {left: {area: out.left.area, tris: out.left.tris, box: [out.left.x0, out.left.x1, out.left.y0, out.left.y1].map(r3)}, right: {area: out.right.area, tris: out.right.tris, box: [out.right.x0, out.right.x1, out.right.y0, out.right.y1].map(r3)}, from: src === out.left ? 'left' : 'right'};
  out.left = {...boxOf(src, src !== out.left)}; out.right = {...boxOf(src, src !== out.right)};
  // the lens triangles the runtime will pick (every vertex inside the outline, facing forward, on the nose)
  const zMax = r2(Math.max(out.left.centre.z, out.right.centre.z) + 0.15);
  const inPoly = (x, y, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  let lens = 0;
  for (let t = 0; t < body.I.length; t += 3) {
    const v = [body.I[t], body.I[t + 1], body.I[t + 2]], P = body.P, N = body.N;
    if (v.reduce((s, a) => s + P[3 * a + 2], 0) / 3 > zMax) continue;
    const nz = v.reduce((s, a) => s + N[3 * a + 2], 0), nl = Math.hypot(v.reduce((s, a) => s + N[3 * a], 0), v.reduce((s, a) => s + N[3 * a + 1], 0), nz) || 1;
    if (-nz / nl < 0.3) continue;
    const poly = v.reduce((s, a) => s + P[3 * a], 0) > 0 ? out.right.poly : out.left.poly;
    if (v.every(a => inPoly(P[3 * a], P[3 * a + 1], poly))) lens++;
  }
  if (lens < 20) throw new Error(`too few lens triangles on the cooked body (${lens})`);
  const y = r2((out.left.centre.y + out.right.centre.y) / 2);
  return {zMax, facing: 0.3, left: out.left.poly, right: out.right.poly, centres: {left: out.left.centre, right: out.right.centre}, lensTris: lens,
    beam: {at: {x: r2(cabCx), y, z: r2(bmin[2] - 0.12)}, aim: {x: r2(cabCx), y: r2(y - 0.6), z: r2(bmin[2] - 16)}}, measured};
})();
log('lamps', JSON.stringify(lamps));

// the bed: the floor under the canvas, the inner walls, the cover's inside; secure points on its floor
const bed = (() => {
  // the floor well inside the bed first, then the front wall from inside, then the walls / cover between them
  const xs = [-0.7, -0.35, 0, 0.35, 0.7], floorHits = [];
  for (const z of [0.4, 1.2, 2.0, 2.8]) for (const x of xs) { const h = axisCast([x, 2.7, z], 1, -1, ['body']); if (h.t < 2) floorHits.push(2.7 - h.t); }
  const floorY = median(floorHits);
  const fronts = [];
  for (const x of [-0.5, 0, 0.5]) for (const dy of [0.3, 0.8]) fronts.push(2.0 - axisCast([x, floorY + dy, 2.0], 2, -1, ['body']).t);
  const zFront = Math.max(...fronts), zRear = rearOpening.measured.d - 0.03;
  const zs = Array.from({length: 9}, (_, i) => zFront + 0.15 + (zRear - zFront - 0.3) * i / 8);
  const sideL = [], sideR = [], roof = [];
  for (const z of zs) for (const dy of [0.4, 0.9]) {
    const o = [0, floorY + dy, z];
    sideL.push(axisCast(o, 0, -1, ['body']).t); sideR.push(axisCast(o, 0, 1, ['body']).t);
  }
  for (const z of zs) for (const x of xs) roof.push(floorY + 0.3 + axisCast([x, floorY + 0.3, z], 1, 1, ['body']).t);
  const box = {x0: r2(-Math.min(...sideL)), x1: r2(Math.min(...sideR)), y0: r2(floorY), y1: r2(Math.min(...roof)), z0: r2(zFront), z1: r2(zRear)};
  if (box.x1 - box.x0 < 2 || box.z1 - box.z0 < 4 || box.y1 - box.y0 < 1.4) throw new Error(`the bed's inside is not clear: ${JSON.stringify(box)}`);
  return {box, floorHits: floorHits.length, floorSpread: r3(Math.max(...floorHits) - Math.min(...floorHits)), opening: {x0: r3(rearOpening.u0), x1: r3(rearOpening.u1), y0: r3(rearOpening.v0), y1: r3(rearOpening.v1), z: r3(rearOpening.d)}};
})();
log('bed', JSON.stringify(bed));
const attach = (() => {
  const B = bed.box, A = ANCH.bed, x0 = B.x0 + A.inset, x1 = B.x1 - A.inset, z0 = B.z0 + A.inset, z1 = B.z1 - A.inset;
  const w = (x1 - x0 - (A.cols - 1) * A.gap) / A.cols, d = (z1 - z0 - (A.rows - 1) * A.gap) / A.rows, h = B.y1 - B.y0 - A.clear;
  const out = [];
  for (let r = 0; r < A.rows; r++) for (let c = 0; c < A.cols; c++) {
    out.push({id: `bed-${['front', 'middle', 'rear'][r]}-${c ? 'right' : 'left'}`, x: r3(x0 + c * (w + A.gap) + w / 2), y: r3(B.y0), z: r3(z0 + r * (d + A.gap) + d / 2), yaw: 0, w: r3(w), d: r3(d), h: r3(h)});
  }
  return out;
})();
log('attach', attach.map(a => `${a.id} (${a.x}, ${a.y}, ${a.z}) ${a.w} x ${a.d} x ${a.h}`).join(' | '));

// storage compartments: the outer face measured (axis rays from outside, a 5 x 5 grid inside the face)
const storage = ANCH.storage.map(s => {
  const hits = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
    const z = s.z[0] + 0.03 + (s.z[1] - s.z[0] - 0.06) * a / 4, y = s.y[0] + 0.03 + (s.y[1] - s.y[0] - 0.06) * b / 4;
    const h = axisCast([s.side * 3, y, z], 0, -s.side, ['body']);
    if (h.t < 3) hits.push(s.side * (3 - h.t));
  }
  if (hits.length < 20) throw new Error(`${s.id}: face not found (${hits.length} hits)`);
  const face = median(hits.map(Math.abs)), spread = Math.max(...hits.map(Math.abs)) - Math.min(...hits.map(Math.abs));
  if (spread > 0.12) throw new Error(`${s.id}: the face is not flat (${spread.toFixed(3)} m)`);
  const fxv = s.side * face, inner = s.side * (face - s.depth);
  return {id: s.id, name: s.name, side: s.side, slots: s.slots, x0: r2(Math.min(fxv, inner)), x1: r2(Math.max(fxv, inner)), y0: s.y[0], y1: s.y[1], z0: s.z[0], z1: s.z[1], faceX: r3(fxv), faceSpread: r3(spread)};
});
log('storage', JSON.stringify(storage));

// first-person sight lines from the eye (yaw: 0 = forward (-Z), +90 = left (-X); pitch: + up): required ones leave through glass
const dir = (yaw, pitch) => { const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180; return [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)]; };
const SIGHTS = [['forward', 0, 0, true], ['forward-down-10', 0, -10, true], ['forward-up-8', 0, 8, true], ['forward-left-15', 15, 0, true], ['forward-right-20', -20, 0, true],
  ['left', 90, 0, true], ['left-down-10', 90, -10, true], ['right', -90, 0, true], ['right-forward-60', -60, 0, false], ['centre-pillar', -24, 0, false], ['back', 180, 0, false]];
const sightLines = SIGHTS.map(([name, yaw, pitch, required]) => { const r = raycast(eyeO, dir(yaw, pitch)); return {name, yaw, pitch, required, hit: r.hit, distance: r3(r.t)}; });
log('sight lines', sightLines.map(s => `${s.name}:${s.hit}@${s.distance}`).join(' '));
for (const s of sightLines) if (s.required && s.hit !== 'glass') throw new Error(`sight line ${s.name} hits ${s.hit}`);
// past the glass, a sight line leaves the truck or meets an OUTER face (never the hollow shell's inside)
const lookGrid = {raysThroughGlass: 0, intoShell: 0, grid: 'yaw -120..120, pitch -30..30, 6 deg'};
for (let yaw = -120; yaw <= 120; yaw += 6) for (let pitch = -30; pitch <= 30; pitch += 6) {
  const d = dir(yaw, pitch), first = raycast(eyeO, d);
  if (first.hit !== 'glass') continue;
  lookGrid.raysThroughGlass++;
  let t = first.t, next = first;
  for (let k = 0; k < 4; k++) { next = raycast(eyeO, d, t + 1e-4); if (next.hit !== 'glass') break; t = next.t; }
  if (next.hit !== 'none' && !next.outer) { lookGrid.intoShell++; (lookGrid.examples ??= []).length < 8 && lookGrid.examples.push([yaw, pitch, next.hit]); }
}
log('look-through grid', JSON.stringify(lookGrid));

const glassBoxes = panes.map(p => ({name: p.name, x0: r3(p.box.lo[0]), x1: r3(p.box.hi[0]), y0: r3(p.box.lo[1]), y1: r3(p.box.hi[1]), z0: r3(p.box.lo[2]), z1: r3(p.box.hi[2]), n: p.normal.map(r3)}));
const anchors = {length: r3(dims[2]), width: r3(dims[0]), height: r3(dims[1]), wheelBase, track, wheels: wheelAnchors, eye, seat, wheelCentre, steering, exits, doorZ, circles, interior, clear,
  cowl, header, roofAtEye, floorAtEye, lamps: {zMax: lamps.zMax, facing: lamps.facing, left: lamps.left, right: lamps.right, beam: lamps.beam}, glass: glassBoxes, bed: {...bed.box, opening: bed.opening},
  attach, storage: storage.map(({faceSpread, ...s}) => s)};
log('anchors', JSON.stringify(anchors));
if (DRY) process.exit(0);

// ---- 11. GLB ----------------------------------------------------------------------------------------------------------------
async function encode(t, {px, q}) {
  return sharp(Buffer.from(t.getImage())).removeAlpha().resize(px, px, {kernel: 'lanczos3'}).jpeg({quality: q, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
}
const doc = new Document();
const buf = doc.createBuffer();
const quant = doc.createExtension(KHRMeshQuantization).setRequired(true);
void quant;
const acc = (type, arr, normalized = false) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf).setNormalized(normalized);
const qNormal = N => { const q = new Int8Array(N.length); for (let i = 0; i < N.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(N[i] * 127))); return q; };
const qUV = UV => { const q = new Uint16Array(UV.length); for (let i = 0; i < UV.length; i++) { if (UV[i] < 0 || UV[i] > 1) throw new Error(`UV outside [0, 1]: ${UV[i]}`); q[i] = Math.round(UV[i] * 65535); } return q; };
const texOut = {};
for (const [k, t] of Object.entries(texSrc)) texOut[k] = doc.createTexture(`truck-${k}`).setImage(new Uint8Array(await encode(t, TEX[k]))).setMimeType('image/jpeg');
const bodyMat = doc.createMaterial('body').setBaseColorFactor(sMat.getBaseColorFactor()).setMetallicFactor(sMat.getMetallicFactor()).setRoughnessFactor(sMat.getRoughnessFactor())
  .setDoubleSided(false).setAlphaMode('OPAQUE')
  .setBaseColorTexture(texOut.baseColor).setMetallicRoughnessTexture(texOut.metallicRoughness).setNormalTexture(texOut.normal).setNormalScale(sMat.getNormalScale());
const glassMat = doc.createMaterial('glass').setBaseColorFactor(GLASS.baseColorFactor).setMetallicFactor(GLASS.metallicFactor).setRoughnessFactor(GLASS.roughnessFactor)
  .setDoubleSided(true).setAlphaMode('BLEND');
const prim = (M, mat, uv = true) => {
  const p = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', M.P)).setAttribute('NORMAL', acc('VEC3', qNormal(M.N), true))
    .setIndices(acc('SCALAR', M.P.length / 3 <= 65535 ? Uint16Array.from(M.I) : M.I)).setMaterial(mat);
  if (uv) p.setAttribute('TEXCOORD_0', acc('VEC2', qUV(M.UV), true));
  return p;
};
const scene = doc.createScene(ID);
scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim(body, bodyMat))));
scene.addChild(doc.createNode('glass').setMesh(doc.createMesh('glass').addPrimitive(prim(glass, glassMat, false))));
wheelParts.forEach((M, i) => scene.addChild(doc.createNode(`wheel-${i}`).setTranslation(wheels[i].hub).setMesh(doc.createMesh(`wheel-${i}`).addPrimitive(prim(M, bodyMat)))));
doc.getRoot().setDefaultScene(scene);
doc.getRoot().getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-surface-truck.mjs (glTF-Transform)';
const glb = Buffer.from(await new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(doc));
const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error('URL/token-like string inside the glTF JSON');
const extUsed = JSON.parse(jsonChunk).extensionsUsed ?? [];
if (extUsed.some(e => e !== 'KHR_mesh_quantization')) throw new Error(`unexpected glTF extensions ${extUsed}`);
const outTex = Object.fromEntries(Object.entries(texOut).map(([k, t]) => [k, {size: TEX[k].px, mime: 'image/jpeg', quality: TEX[k].q, bytes: t.getImage().byteLength, sha256: sha(t.getImage())}]));
const tris = {body: body.I.length / 3, glass: glass.I.length / 3, wheels: wheelParts.map(M => M.I.length / 3)};
tris.total = tris.body + tris.glass + tris.wheels.reduce((a, b) => a + b, 0);
log(`GLB ${glb.length} B: tris ${JSON.stringify(tris)}; textures ${Object.entries(outTex).map(([k, t]) => `${k} ${t.bytes} B`).join(', ')}`);
// ---- 12. provenance, generated anchors, credits, allowlist -----------------------------------------------------------------------
function pkgVersion(name) {
  for (let d = root; ; d = path.dirname(d)) {
    const f = path.join(d, 'node_modules', name, 'package.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).version;
    if (path.dirname(d) === d) return 'unknown';
  }
}
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: ID,
  role: 'Surface Run military truck: the district vehicle model (body, clear cab glass, eight wheel nodes that roll / steer at runtime); the cab interior, the bed floor, the back-face lining and the lamp lenses are added at runtime from the anchors',
  task: 'surface-run-opus-rebuild-20261116-020827 lane TRUCK',
  source: {
    file: `${MASTER_REL} (private user master, outside Git / CI / runtime; read-only)`, sha256: MASTER_SHA256, bytes: MASTER_BYTES,
    triangles: srcStats.triangles, vertices: srcStats.vertices, closedShell: true, oneMaterial: true, noseAxis: '-X (source)', extentSourceUnits: [0, 1, 2].map(k => r4(smax[k] - smin[k])), maps: srcTex,
    licence: 'user-supplied model: the user supplied this model for the project; its origin, authorship and licence are NOT verified; no licence, authorship or clearance is claimed or implied',
  },
  output: {file: `game/public/${OUT_REL}`, url: OUT_REL, sha256: sha(glb), bytes: glb.length, dims: dims.map(r3), triangles: tris,
    nodes: {body: 'opaque (material `body`: the master maps re-encoded)', glass: 'flat clear panes (material `glass`, BLEND, double-sided; no texture)', wheels: 'wheel-0 … wheel-7: axle 1 left, axle 1 right, axle 2 left, … (front to back); origin at the hub; the same `body` material'},
    quantization: 'KHR_mesh_quantization (required): normals int8 normalized, UVs uint16 normalized, positions float32', maps: outTex},
  transform: {scale: SCALE, rotation: 'about +Y by -90 deg (source nose -X -> runtime -Z): x = -z_src, z = x_src', grounded: true, centred: 'x / z footprint (bounding box)', baked: 'into the vertices (identity nodes except the wheels\' hub translations)'},
  scale: 'uniform x 4.0 from the model\'s own proportions: the canvas bed\'s outer width (0.625 source units) -> 2.50 m, a military cargo truck\'s road width; the same factor gives 1.15 m tyres (14.00 R20-class 1.1-1.25 m), a 3.24 m roof over the canvas, the cab side windows 1.6-2.2 m over the road and the driver\'s eye at 2.0 m; the chassis (7.55 m) is shorter than a real ten-metre eight-wheeler: the source\'s own compression, kept',
  convention: 'metres at real size, +Y up, NOSE toward -Z (runtime forward at yaw 0), grounded (min y = 0), centred on x / z; driver = LEFT seat (-X)',
  wheels: {method: 'tyre contact patches (triangles within 3 cm of the ground) -> x / z per wheel, paired into four axles; ONE radius = the median of the eight lower-silhouette estimates; every triangle whose centroid lies inside the wheel cylinder (r + 1.5 cm, axis x) outboard of a plane 3 cm inside the tyre\'s inner face belongs to that wheel; both sides of the cut capped (fans with the darkest tread texel)',
    params: WHEEL, measured: wheels.map(w => ({side: w.side, z: r3(w.z), xin: r3(w.xin), xout: r3(w.xout), rSilhouette: r3(w.rSilhouette), r: r3(w.r), hub: w.hub.map(r3), sourceTriangles: w.srcTris}))},
  glazing: {method: 'flat low-chroma grey islands of the base map on the cab\'s front / side faces (window band, pane-sized, rectangular) -> rounded rectangles in each face\'s projection; the shell cut exactly on each outline (straddling triangles split on the zero line) and the inside removed with anything standing on it (wipers); a flat clear pane fitted (least squares) to the removed surface, 1.5 cm oversize, 4 mm inside; the canvas cover\'s rear face opened the same way',
    params: {WIN, PANE, REAR, GLASS}, panes: windows.map(w => ({name: w.name, face: w.face, u: [r3(w.u0), r3(w.u1)], v: [r3(w.v0), r3(w.v1)], depth: r3(w.d), area: r4(w.area), fill: r3(w.fill)})), rejectedIslands: rejectedIslands.length,
    rearOpening: {face: Object.fromEntries(Object.entries(rearOpening.measured).map(([k, v]) => [k, r3(v)])), opening: [rearOpening.u0, rearOpening.u1, rearOpening.v0, rearOpening.v1].map(r3)}, splitTriangles: splitCount,
    removed: Object.fromEntries(regions.map((r, k) => [r.name, removedByRegion[k].length / 3])), caps: capLog},
  simplify: {tool: `meshoptimizer ${pkgVersion('meshoptimizer')} simplifyWithAttributes (normal x ${SIMPLIFY.weights.normal} + UV; the window / opening outlines locked; one pass per part)`, budget: BUDGET,
    body: {fromTriangles: body.from, triangles: tris.body, errorMeters: r4(body.errorM)}, wheels: wheelParts.map(M => ({fromTriangles: M.from, triangles: M.I.length / 3, errorMeters: r4(M.errorM)}))},
  anchors: {...anchors, lampsMeasured: lamps.measured, lensTriangles: lamps.lensTris, sightLines, lookThroughFromEye: lookGrid,
    method: {
      eye: `left seat: x = the left windscreen pane's centre; y = its centre + ${ANCH.eye.overScreenMid} m; z = ${ANCH.eye.behindScreen} m behind the fitted pane`,
      seat: `H-point = eye + (0, ${ANCH.seat.dy}, ${ANCH.seat.dz}) m`,
      wheelCentre: `steering-wheel hub = eye + (0, ${ANCH.steering.dy}, ${ANCH.steering.dz}) m; rim radius ${ANCH.steering.radius} m, plane ${ANCH.steering.tilt} rad from horizontal`,
      interior: 'the cab volume: axis rays from the eye to the shell (body + glass): side glass, windscreen, back wall, roof, floor',
      clear: `the free box: voxels (${ANCH.vox} m, dilated one voxel) of body + glass; seeded around the eye (+ ${ANCH.headroom} m) and the steering wheel; grown in depth / height, then width; x-symmetric about the windscreen's middle`,
      wheelBase: 'front axle -> the rear tandem\'s middle (the turn centre lies on the line through the rear tandem); axle 2 steers at the ratio of tangents (rear-middle - z) / wheelBase',
      exits: `${ANCH.exitOut} m outside the cab side (max |x| at 0.8-1.6 m) at the door (the front side windows' middle z)`,
      circles: `${ANCH.circles.cols} columns (equal bands across the footprint's width), each band's z extent covered by circles ${ANCH.circles.spacing} m apart (r = hypot(band half-width, spacing / 2), rounded up); every vertex of every part inside a circle; at most ${circleBulge} m past the footprint box`,
      lamps: 'bright, low-chroma, forward-facing master triangles on the nose, low on the bumper: the side with the larger bright area gives the box, mirrored about the cab\'s middle; the runtime lens = the body\'s triangles inside it',
      bed: 'axis rays inside the canvas cover: the floor (median, well inside), the front wall, the side walls and the cover between them; the rear = the opened face',
      attach: `${ANCH.bed.cols} x ${ANCH.bed.rows} secure points on the bed floor, ${ANCH.bed.inset} m inside the walls, ${ANCH.bed.gap} m apart; h = the cover's inside over the floor - ${ANCH.bed.clear} m`,
      storage: 'compartment boxes read off the 0.1 m grid renders of the side views; the outer face x measured by axis rays (a 5 x 5 grid inside the face)',
    }},
  limitations: [
    'The source is one closed shell: the cab is hollow (no seats, dash or steering wheel; two thin posts and a raised platform behind the seats). The runtime adds a handmade cab (floor, dash with gauges, a steering wheel on its pivot, two seats, a back panel, door cards) and a dark back-face lining of the cab and the bed.',
    'Inside the canvas cover the shell is the cover block\'s own inside (seen from behind): the runtime lines it and lays a floor slab at the bed floor.',
    `${lookGrid.intoShell} of ${lookGrid.raysThroughGlass} first-person sight lines through the glass meet an inner shell face (the windscreen\'s pillar lips): the runtime\'s back-face lining covers them.`,
    'The wheels are the source tyres cut at a plane just inside each tyre\'s inner face; the hubs / axles inboard of it stay with the body; the cut faces are capped with a dark tread texel. All eight share one radius (the median silhouette).',
    'Real-world markings are in the source texture and were NOT painted over: a manufacturer\'s lettering on the grille, a registration-style number plate and a unit plate (trade-dress caveat).',
    'The right side has two side panes (the left three): the source texture paints no grey pane behind the right door.',
    'No interior lights, mirrors\' glass or indicator lenses are separated: the indicators and the rear lamps stay painted texture.',
  ],
  tool: {script: 'tools/asset-pipeline/props/build-surface-truck.mjs', libraries: {'@gltf-transform/core': pkgVersion('@gltf-transform/core'), meshoptimizer: pkgVersion('meshoptimizer'), sharp: pkgVersion('sharp')},
    parameters: {SCALE, BUDGET, TEX, SIMPLIFY, WHEEL, WIN, PANE, REAR, GLASS, ANCH}, noGeneration: true},
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
if (/https?:|Signature|X-Amz|Key-Pair|token=/i.test(provBuf.toString())) throw new Error('URL/token-like string in public provenance');

const TA = {url: OUT_REL, bodyTris: tris.body, glassTris: tris.glass, wheelTris: tris.wheels[0], ...anchors};
const ts = `// GENERATED by tools/asset-pipeline/props/build-surface-truck.mjs — do not edit (Surface Run lane TRUCK).
// The Surface Run military truck (assets/models/surface-military-truck.glb; provenance assets/derivatives/surface-military-truck.json):
// measured anchors. Frame: metres, +Y up, NOSE toward -Z (forward at yaw 0), grounded (y = 0), centred on x / z; +X = the truck's
// RIGHT, driver = LEFT seat (-X). Nodes: \`body\`, \`glass\` (material \`glass\`), \`wheel-0\` … \`wheel-7\` (origin at the hub).
// wheels: axle 1 left, axle 1 right, axle 2 left, … {x, y = hub height, z, r, axle, steer = the share of the front wheel angle's
// tangent}; wheelBase = front axle -> the rear tandem's middle; eye = seated driver eye; seat = its H-point; wheelCentre / steering =
// the steering wheel's hub, rim radius and plane tilt (rad from horizontal); exits = stand points outside each door (doorZ); circles =
// collision circles {x, z, r} in columns; interior = the cab's volume (its walls from the eye); clear = the free box inside it; cowl /
// header = the windscreen's base / top; lamps = headlamp outlines in the front projection (lens triangles: every vertex inside,
// facing forward, z < zMax) + the beam; glass = pane boxes + normals; bed = the space under the canvas (opening = the opened rear
// face); attach = secure points on the bed floor (w across, d along, h clear); storage = compartment boxes (faceX = the outer face).
export const TRUCK_ANCHORS = {
${Object.entries(TA).map(([k, v]) => `  ${k}: ${JSON.stringify(v).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/,/g, ', ')},`).join('\n')}
} as const;
`;

const CREDITS_REL = 'assets/CREDITS.md', CREDITS = path.join(root, 'game/public', CREDITS_REL);
const CREDIT_TAG = 'surface-military-truck-20261116';
const creditBlock = `<!-- BEGIN ${CREDIT_TAG} (build-surface-truck.mjs) -->
## Surface Run military truck

A user-supplied model: the user supplied this textured eight-wheeled military cargo truck model for the project (task
surface-run-opus-rebuild-20261116). Its origin, authorship and licence are NOT verified and no licence or clearance is implied.
The game ships a re-oriented, uniformly re-scaled (x ${SCALE}: ${r2(dims[2])} m long), cut (eight wheel nodes; the cab windows opened
and fitted with flat clear panes; the canvas cover's rear opened) and simplified derivative with the model's own PBR maps
re-encoded (base colour / normal ${TEX.baseColor.px} px, metallic-roughness ${TEX.metallicRoughness.px} px). Real-world markings in its
texture (a manufacturer's lettering, number plates) are kept as supplied (trade-dress caveat). The original stays outside the
repository. No generation.

- \`${OUT_REL}\` — the truck (body, glass, wheel-0 … wheel-7); runtime derivative by
  \`tools/asset-pipeline/props/build-surface-truck.mjs\` (provenance: \`${PROV_REL}\`).
<!-- END ${CREDIT_TAG} -->
`;

if (OUT_DIR) {
  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(path.join(OUT_DIR, `${ID}.glb`), glb);
  fs.writeFileSync(path.join(OUT_DIR, `${ID}.json`), provBuf);
  fs.writeFileSync(path.join(OUT_DIR, 'truckAnchors.generated.ts'), ts);
  fs.writeFileSync(path.join(OUT_DIR, 'cook.json'), JSON.stringify({anchors, wheels: wheels.map(({faces, ...w}) => w), windows, regions: regions.map(({measured, ...r}) => r), panes, capLog, tris}, null, 1));
} else {
  fs.writeFileSync(path.join(root, 'game/public', OUT_REL), glb);
  fs.writeFileSync(path.join(root, 'game/public', PROV_REL), provBuf);
  fs.mkdirSync(path.dirname(GEN_TS), {recursive: true});
  fs.writeFileSync(GEN_TS, ts);
  // CREDITS: this task's block replaced in place, else appended
  const credits = fs.readFileSync(CREDITS, 'utf8');
  const re = new RegExp(`<!-- BEGIN ${CREDIT_TAG} [^\\n]*-->\\n[\\s\\S]*?<!-- END ${CREDIT_TAG} -->\\n`);
  const nextCredits = re.test(credits) ? credits.replace(re, creditBlock) : `${credits.replace(/\n*$/, '\n')}\n${creditBlock}`;
  fs.writeFileSync(CREDITS, nextCredits);
  const allowRaw = fs.readFileSync(ALLOW, 'utf8');
  const allow = JSON.parse(allowRaw);
  if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
  const mine = new Map([[OUT_REL, glb], [PROV_REL, provBuf], [CREDITS_REL, Buffer.from(nextCredits)]]);
  allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
}
// the master again: unchanged
const after = fs.readFileSync(MASTER);
if (after.length !== MASTER_BYTES || sha(after) !== MASTER_SHA256) throw new Error('the master changed during the cook');
log(`master after: ${after.length} B, sha256 ${sha(after)} (unchanged)`);
log(`${ID}: ${srcStats.triangles} tris, ${(srcBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(2)} MB (${JSON.stringify(tris)}), dims ${dims.map(r3).join(' x ')} m${OUT_DIR ? ` -> ${OUT_DIR}` : ''}`);


