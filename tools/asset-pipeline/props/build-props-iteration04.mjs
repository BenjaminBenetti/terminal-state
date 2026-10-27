#!/usr/bin/env node
// The Last Line - iteration04 runtime derivatives for the NEW generated masters (trash can + modular shop building blocks:
// service counter, drinks cooler, food display case, back-counter kitchen module).
// Usage: node tools/asset-pipeline/props/build-props-iteration04.mjs [--only trashCan,shopCounter] [--inspect]
// Copied from build-props-iteration03.mjs (same verify -> level/orient -> simplify -> unwrap -> bake -> encode chain), extended for
// STRAIGHT-ON conditioning images (user rule, iteration04): 'camera-axis' front rule, 'source-y' up rule, per-axis fit bounds and
// shop-component measurements. Reads (read-only) the native F16 SV masters of
// reference/tasks/vertical-slice-iteration04-20261026/generation/<asset>/native/ (sha256-verified against the controller receipt;
// uncompressed working copy in .cache/iteration04-native-masters/, restored from the preserved asset.glb.xz when missing) and writes ONLY
// game/public/assets/models/{trash-can,shop-*}.glb and game/public/assets/derivatives/props-iteration04.json. Prototype, unapproved, gameReady false.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadDense, simplifyGeometry, sha256File, sha256Buf} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake, dilate} from './lib/bake.mjs';
import {encodeImage, writeMeshGlb} from './lib/glb.mjs';
import sharp from 'sharp';
import {det3, transformPositions, bbox} from './lib/orient.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GEN = path.join(REPO, 'reference/tasks/vertical-slice-iteration04-20261026/generation');
const STAGE = path.join(REPO, '.cache/iteration04-native-masters');
const OUT = {models: path.join(REPO, 'game/public/assets/models'), derivatives: path.join(REPO, 'game/public/assets/derivatives')};
const FILES = {trashCan: 'trash-can.glb', shopCounter: 'shop-counter.glb', shopCooler: 'shop-cooler.glb', shopDisplay: 'shop-display.glb', shopBackbar: 'shop-backbar.glb'};
const OWNED = [...Object.values(FILES).map(f => path.join(OUT.models, f)), path.join(OUT.derivatives, 'props-iteration04.json')];
function guardedWrite(file, bytes) {
  const abs = path.resolve(file);
  if (!OWNED.includes(abs)) throw new Error(`refusing to write a file this script does not own: ${abs}`);
  fs.writeFileSync(abs, bytes);
  return {path: path.relative(REPO, abs), bytes: bytes.length, sha256: sha256Buf(bytes)};
}
const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const inspect = args.includes('--inspect');
const log = (...a) => console.log(...a);
const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 1e4) / 1e4, r3 = v => Math.round(v * 1e3) / 1e3, vec = a => a.map(r6);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(GEN, 'manifest.json'), 'utf8'));
const M = Object.fromEntries(MANIFEST.assets.map(a => [a.key, a]));

// ---- frames -------------------------------------------------------------------------------------------------------
// Single-view reconstructions keep the elevated conditioning-camera pose; source +Y ~ image up, source -Z ~ toward the camera,
// source +X ~ image left (iteration02 evidence). up = recovered object axis nearest source +Y; front chosen per asset rule.
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
function faceSamples(P, I, max = 80000) {
  const nf = I.length / 3, step = Math.max(1, Math.floor(nf / max)), N = [], A = [], C = [];
  for (let f = 0; f < nf; f += step) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l > 0) { N.push([nx / l, ny / l, nz / l]); A.push(l / 2); C.push([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3]); }
  }
  return {N, A, C};
}
// Box frame from area-weighted dominant planar face normals (iteration02 method).
function boxFrame(P, I) {
  const {N, A} = faceSamples(P, I, 60000);
  const score = d => { let s = 0; for (let i = 0; i < N.length; i++) { if (Math.abs(dot(N[i], d)) > 0.99) s += A[i]; } return s; };
  const refine = d => { for (let it = 0; it < 4; it++) { const m = [0, 0, 0]; for (let i = 0; i < N.length; i++) { const c = dot(N[i], d); if (Math.abs(c) > 0.985) { const sg = Math.sign(c); for (let k = 0; k < 3; k++) m[k] += sg * A[i] * N[i][k]; } } d = norm(m); } return d; };
  const cands = []; const K = 1500;
  for (let i = 0; i < K; i++) { const y = 1 - (i + 0.5) / K, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5)); if (y >= 0) cands.push([r * Math.cos(t), y, r * Math.sin(t)]); }
  const d1 = refine(cands.reduce((b, d) => { const s = score(d); return s > b.s ? {s, d} : b; }, {s: -1}).d);
  let d2 = refine(cands.filter(d => Math.abs(dot(d, d1)) < 0.15).reduce((b, d) => { const s = score(d); return s > b.s ? {s, d} : b; }, {s: -1}).d);
  d2 = norm(d2.map((x, k) => x - dot(d2, d1) * d1[k]));
  return [d1, d2, cross(d1, d2)].map(d => ({d, s: score(d)}));
}
// Area-weighted PCA of the surface (face centroids); axes sorted by decreasing variance.
function pcaFrame(P, I) {
  const {A, C} = faceSamples(P, I, 120000);
  let w = 0; const m = [0, 0, 0];
  for (let i = 0; i < C.length; i++) { w += A[i]; for (let k = 0; k < 3; k++) m[k] += A[i] * C[i][k]; }
  for (let k = 0; k < 3; k++) m[k] /= w;
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < C.length; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[i] * (C[i][r] - m[r]) * (C[i][c] - m[c]) / w;
  // Jacobi eigen-decomposition
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], a = S.map(r => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return [0, 1, 2].map(i => ({d: [V[0][i], V[1][i], V[2][i]], s: a[i][i]})).sort((x, y) => y.s - x.s);
}
const extentAlong = (P, d) => { let mn = Infinity, mx = -Infinity; for (let i = 0; i < P.length; i += 3) { const v = P[i] * d[0] + P[i + 1] * d[1] + P[i + 2] * d[2]; if (v < mn) mn = v; if (v > mx) mx = v; } return mx - mn; };
const towardCamera = d => (-d[2] >= 0 ? d : d.map(x => -x));
// Front rules (all signed toward the conditioning camera, source -Z):
//  camera-axis : (iteration04, STRAIGHT-ON inputs) the horizontal frame axis most aligned with the camera direction (largest -z): the
//                face the straight-on conditioning image showed is the front
//  camera      : horizontal projection of the camera direction (rotationally symmetric objects such as the round trash can)
//  depth-axis / camera-left: iteration03 three-quarter rules, kept for reference only (not used by iteration04 assets)
function pickFront(rule, up, hz, P) {
  if (rule === 'camera') { const c = [0, 0, -1]; return norm(c.map((x, k) => x - dot(c, up) * up[k])); }
  const H = hz.map(towardCamera);
  if (rule === 'camera-axis') return -H[0][2] >= -H[1][2] ? H[0] : H[1];
  if (rule === 'depth-axis') return extentAlong(P, H[0]) <= extentAlong(P, H[1]) ? H[0] : H[1];
  if (rule === 'camera-left') return (H[0][0] - H[0][2]) >= (H[1][0] - H[1][2]) ? H[0] : H[1];
  throw new Error(rule);
}
function levelRotation(P, I, cfg) {
  let axes, method;
  if (cfg.up === 'box') { axes = boxFrame(P, I); method = 'box frame (area-weighted dominant planar face normals)'; }
  else if (cfg.up === 'source-y') { axes = [{d: [0, 1, 0], s: 1}, {d: [1, 0, 0], s: 0}, {d: [0, 0, 1], s: 0}]; method = 'source +Y kept as up (straight-on, 0 deg elevation conditioning camera)'; }
  else { axes = pcaFrame(P, I); method = 'area-weighted surface PCA'; }
  let upI;
  if (cfg.up === 'box') { upI = 0; axes.forEach((a, i) => { if (Math.abs(a.d[1]) > Math.abs(axes[upI].d[1])) upI = i; }); }
  else if (cfg.up === 'source-y') upI = 0;
  else upI = cfg.up === 'pca-long' ? 0 : 2;   // pca-long: the longest axis is up (tall cylinders/upright bag); pca-short: the thinnest axis is up (flat bar)
  const up = axes[upI].d[1] < 0 ? axes[upI].d.map(x => -x) : axes[upI].d;
  const hz = axes.filter((_, i) => i !== upI).map(a => a.d);
  const Z0 = pickFront(cfg.front, up, hz, P);
  const Y = up; let Z = norm(cross(cross(Y, Z0), Y)), X = cross(Y, Z);
  // Box-like assets: refine the yaw about the recovered up axis by minimising the footprint bounding-box area (+-12 deg, 0.1 deg steps).
  let yawRefineDeg = 0;
  if (cfg.up === 'box') {
    const pts = []; for (let i = 0; i < P.length; i += 3 * 7) pts.push([dot([P[i], P[i + 1], P[i + 2]], X), dot([P[i], P[i + 1], P[i + 2]], Z)]);
    let best = {a: Infinity, d: 0};
    for (let d = -12; d <= 12.0001; d += 0.1) {
      const c = Math.cos(d * Math.PI / 180), sn = Math.sin(d * Math.PI / 180); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of pts) { const u = c * x + sn * z, w = -sn * x + c * z; if (u < x0) x0 = u; if (u > x1) x1 = u; if (w < z0) z0 = w; if (w > z1) z1 = w; }
      const a = (x1 - x0) * (z1 - z0); if (a < best.a) best = {a, d};
    }
    yawRefineDeg = r4(best.d);
    const c = Math.cos(best.d * Math.PI / 180), sn = Math.sin(best.d * Math.PI / 180);
    const X2 = X.map((v, k) => c * v + sn * Z[k]), Z2 = Z.map((v, k) => -sn * X[k] + c * v); X = X2; Z = Z2;
  }
  return {R: [X, Y, Z], frame: {method, upRule: cfg.up, frontRule: cfg.front, yawRefineDeg, up: vec(Y), front: vec(Z), right: vec(X), tiltFromSourceYDeg: r4(Math.acos(Math.min(1, Y[1])) * 180 / Math.PI),
    frontYawFromCameraDeg: r4(Math.atan2(Z[0], -Z[2]) * 180 / Math.PI), axisScores: axes.map(a => a.s)}};
}

function verifiedSource(asset) {
  const dir = path.join(GEN, asset, 'native');
  const rc = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  if (!rc.ok) throw new Error(`${asset}: native receipt not ok`);
  const art = rc.artifacts['asset.glb'];
  const file = path.join(STAGE, asset, 'asset.glb');
  if (!fs.existsSync(file)) {  // restore the working copy from the preserved lossless xz master
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const r = spawnSync('sh', ['-c', `xz -dc "$0" > "$1.tmp" && mv "$1.tmp" "$1"`, art.preservedAs.path, file], {stdio: 'inherit'});
    if (r.status !== 0) throw new Error(`${asset}: xz restore failed`);
  }
  const sha = sha256File(file);
  if (sha !== art.sha256) throw new Error(`${asset}: sha256 mismatch`);
  const img = JSON.parse(fs.readFileSync(path.join(GEN, asset, 'image', 'receipt.json'), 'utf8'));
  return {file, rel: path.relative(REPO, art.preservedAs.path), sha256: sha, bytes: fs.statSync(file).size, jobId: rc.job_id, receipt: path.relative(REPO, path.join(dir, 'receipt.json')),
    preserved: {path: path.relative(REPO, art.preservedAs.path), sha256: art.preservedAs.sha256, bytes: art.preservedAs.bytes, format: art.preservedAs.format},
    conditioningImage: {path: path.relative(REPO, img.output.path), sha256: img.output.sha256, generator: img.generator, generatorModel: img.generatorModel, codexThreadId: img.codexThreadId}};
}

// ---- measurement helpers (output space, metres) --------------------------------------------------------------------
// Area-weighted histogram of UPWARD-facing dense faces (normal.y > minNy) inside a region; peaks = horizontal support surfaces.
function upSurfaces(P, I, region, {minNy = 0.9, bin = 0.005, minFrac = 0.08, gap = 2, dump = false} = {}) {
  const hist = new Map(); let total = 0;
  for (let f = 0; f < I.length / 3; f++) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!(l > 0) || ny / l < minNy) continue;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (!region(cx, cy, cz)) continue;
    const k = Math.round(cy / bin); hist.set(k, (hist.get(k) ?? 0) + l / 2); total += l / 2;
  }
  // merge adjacent bins into clusters (gap > 2 bins splits); report area-weighted mean y and the max-y bin of each cluster
  const keys = [...hist.keys()].sort((x, y) => x - y), clusters = [];
  if (dump) log('  up-facing area histogram (y m: m2):', keys.filter(k => hist.get(k) > 0.004).map(k => `${r3(k * bin)}:${r4(hist.get(k))}`).join(' '));
  for (const k of keys) { const last = clusters[clusters.length - 1]; if (last && k - last.k1 <= gap) { last.k1 = k; last.area += hist.get(k); last.sy += hist.get(k) * k * bin; } else clusters.push({k0: k, k1: k, area: hist.get(k), sy: hist.get(k) * k * bin}); }
  const big = clusters.filter(c => c.area >= minFrac * Math.max(...clusters.map(x => x.area)));
  return {totalArea: total, surfaces: big.map(c => ({y: r3(c.sy / c.area), yTop: r3(c.k1 * bin), yBottom: r3(c.k0 * bin), areaM2: r4(c.area)}))};
}

// Triangle/texture budgets (iteration04 brief): trash can <= ~2.5k tris, shop components ~4-6k tris; colour 1024 + MR/normal 512.
const PROP_TEX = {atlas: 1024, mrDiv: 2, normalDiv: 2};
// Fit bounds (relative to the uniform fit on the target axis): x/y +-35% as iteration03. Depth (z) +-50% for the straight-on assets:
// a front elevation carries no direct depth cue, so the reconstruction's depth is the least reliable axis.
const FIT = {x: [0.65, 1.35], y: [0.65, 1.35], z: [0.5, 1.5]};
const ASSETS = [
  {key: 'trashCan', ...PROP_TEX, tris: 2400, up: 'pca-long', front: 'camera', target: {axis: 1, meters: 0.95, label: 'height'}, topRepaint: {yMinFrac: 0.8, minNy: 0.35}, radialRepaint: {yMinFrac: 0.72, yMaxFrac: 1.0, maxNy: 0.35},
    orientationEvidence: 'Round receptacle: up = longest surface PCA axis (signed toward source +Y; the straight-on input had 0 deg elevation); front (+Z) = horizontal projection of the conditioning-camera direction, i.e. the hooded disposal opening and the blank label plate that faced the camera.'},
  {key: 'shopCounter', ...PROP_TEX, tris: 4000, up: 'box', front: 'camera-axis', target: {axis: 1, meters: 1.05, label: 'height'}, depthFit: {front: 0.14, back: 0.04},
    orientationEvidence: 'Levelled via the dominant box-face frame (counter top / front panel); front (+Z) = the customer face with the tray-slide rail, i.e. the horizontal frame axis most aligned with the straight-on conditioning camera.'},
  {key: 'shopCooler', ...PROP_TEX, tris: 4500, up: 'box', front: 'camera-axis', target: {axis: 1, meters: 2.0, label: 'height'}, depthFit: {front: 0.08, back: 0.04, protrusion: 'auto', protrusionTo: 0.05}, paneProjection: {paneDepth: 0.03, minLight: 140}, shelfLines: true, recolor: {classes: ['side', 'back', 'top', 'interiorTop'], topFrac: 0.9},
    orientationEvidence: 'Levelled via the dominant box-face frame (cabinet sides / glass door); front (+Z) = the glass door face that the straight-on conditioning camera saw (handle on the +X edge).'},
  {key: 'shopDisplay', ...PROP_TEX, tris: 4500, up: 'box', front: 'camera-axis', target: {axis: 0, meters: 1.1, label: 'width'},
    dims: {w: 1.1, h: 0.7, d: 0.62}, dimsReason: 'Native proportions (w/h 1.58) give 0.76 m height at the manifest 1.2 m width, i.e. a 1.81 m top on the 1.05 m service counter (above eye level). Scaled uniformly (no vertical stretch) to a 1.1 m wide x 0.70 m tall countertop unit (common merchandiser sizes 0.6-1.2 m); depth fitted to 0.62 m so it sits on the 0.75 m deep counter.',
    paneProjection: {paneDepth: 0.04, minLight: 120},
    recolor: {classes: ['side', 'back'], yBand: [0.27, 0.86], baseFrom: 'centralBox', centralBox: [0.3, 0.2, 0.7, 0.75], keep: 0.3, mr: [255, 50, 0]},
    orientationEvidence: 'Levelled via the dominant box-face frame (base / canopy / glass); front (+Z) = the glass front with the control knob (on the +X side) that faced the straight-on conditioning camera.'},
  {key: 'shopBackbar', ...PROP_TEX, tris: 5200, up: 'box', front: 'camera-axis', target: {axis: 1, meters: 1.83, label: 'height'},
    dims: {w: 1.77, h: 1.83, d: 0.7}, dimsReason: 'The native proportions put the worktop at 47% of the overall height: at the manifest 1.5 m overall the worktop measured 0.705 m, below the 0.86-0.91 m of real commercial worktops (and hidden behind the 1.05 m service counter). Scaled uniformly (no vertical stretch) so the worktop lands at ~0.86 m: a 1.77 m wide x 1.83 m tall module (commercial back counters come in 1.22/1.52/1.83 m widths); depth fitted to 0.70 m.',
    orientationEvidence: 'Levelled via the dominant box-face frame (cabinet doors / worktop / overshelf); front (+Z) = the door/drawer face that faced the straight-on conditioning camera (griddle on -X, fryer on +X).'},
];
const CFG = Object.fromEntries(ASSETS.map(a => [a.key, a]));

// Front relief map (output space): 1 cm cells over x/y, outermost z per cell.
function frontRelief(DP, bb, cell = 0.01) {
  const nx = Math.ceil(bb.size[0] / cell), ny = Math.ceil(bb.size[1] / cell), Z = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = 0; i < DP.length; i += 3) { const ix = Math.min(nx - 1, Math.max(0, Math.floor((DP[i] - bb.min[0]) / cell))), iy = Math.min(ny - 1, Math.max(0, Math.floor(DP[i + 1] / cell))); const k = iy * nx + ix; if (DP[i + 2] > Z[k]) Z[k] = DP[i + 2]; }
  return {nx, ny, Z, cell, x: ix => bb.min[0] + (ix + 0.5) * cell, y: iy => (iy + 0.5) * cell};
}
const pct = (A, t) => { const B = A.filter(Number.isFinite).sort((a, b) => a - b); return B.length ? B[Math.min(B.length - 1, Math.floor(t * B.length))] : null; };
const allSurfaces = (DP, I, bb, {xFrac = 0.45, zFrac = 0.45, minFrac = 0.05, y0 = 0.02, gap = 2, dump = false} = {}) =>
  upSurfaces(DP, I, (x, y, z) => y > y0 && Math.abs(x - bb.center[0]) < xFrac * bb.size[0] && Math.abs(z - bb.center[2]) < zFrac * bb.size[2], {minFrac, gap, dump}).surfaces;

CFG.trashCan.measure = (DP, I, bb) => {
  // Disposal opening: per-column reference = outermost z of the body band (15-60% of the height); a cell is "open" when its outermost z is
  // >= 15 cm behind that reference (looking into the bin). Opening = the first contiguous run of rows above 55% of the height in which
  // >= 25% of the central 70% of columns are open (the hood lip above it is not that deep, so the run ends there).
  const R = frontRelief(DP, bb), H = bb.size[1], ref = new Float32Array(R.nx).fill(-Infinity);
  for (let iy = Math.floor(0.15 * H / R.cell); iy < Math.floor(0.6 * H / R.cell); iy++) for (let ix = 0; ix < R.nx; ix++) ref[ix] = Math.max(ref[ix], R.Z[iy * R.nx + ix]);
  const cx0 = Math.floor(0.15 * R.nx), cx1 = Math.ceil(0.85 * R.nx), rows = [], xs = [];
  for (let iy = Math.floor(0.55 * H / R.cell); iy < R.ny; iy++) {
    const open = []; for (let ix = cx0; ix < cx1; ix++) { const z = R.Z[iy * R.nx + ix]; if (Number.isFinite(ref[ix]) && (!Number.isFinite(z) || ref[ix] - z >= 0.15)) open.push(ix); }
    if (open.length >= 0.25 * (cx1 - cx0)) { rows.push(iy); open.forEach(ix => xs.push(R.x(ix))); } else if (rows.length) break;
  }
  const opening = rows.length ? {yMin: r3(R.y(rows[0]) - R.cell / 2), yMax: r3(R.y(rows[rows.length - 1]) + R.cell / 2), xMin: r3(pct(xs, 0.03)), xMax: r3(pct(xs, 0.97)), rows: rows.length, note: 'front relief, approximate'} : null;
  return {lidTopY: r3(bb.max[1]), diameterX: r3(bb.size[0]), diameterZ: r3(bb.size[2]), disposalOpening: opening,
    method: 'Disposal opening from a 1 cm front relief map (outermost z per cell) of the dense output-space mesh: per-column reference = outermost z in the 15-60% height band; open cell = >= 15 cm behind it; opening = first contiguous run of rows above 55% of the height with >= 25% of the central 70% of columns open; x = 3rd-97th percentile of open cells.',
    extras: {disposalOpening: opening}};
};
CFG.shopCounter.measure = (DP, I, bb) => {
  const surf = allSurfaces(DP, I, bb, {xFrac: 0.45, zFrac: 0.48, minFrac: 0.05});
  const top = surf.filter(s => s.y > 0.6).sort((a, b) => b.areaM2 - a.areaM2)[0] ?? null;
  // Tray-slide rail: front relief cells below the counter top that protrude >= 2.5 cm in front of the front-panel plane (median z of the
  // lower-middle panel band).
  const R = frontRelief(DP, bb), panel = [];
  for (let iy = Math.floor(0.25 / R.cell); iy < Math.floor(0.6 / R.cell); iy++) for (let ix = Math.floor(0.2 * R.nx); ix < Math.ceil(0.8 * R.nx); ix++) panel.push(R.Z[iy * R.nx + ix]);
  const zPanel = pct(panel, 0.5), railRows = [];
  for (let iy = 0; iy < R.ny; iy++) { if (top && R.y(iy) > top.yBottom - 0.01) break; let n = 0; for (let ix = Math.floor(0.1 * R.nx); ix < Math.ceil(0.9 * R.nx); ix++) { const z = R.Z[iy * R.nx + ix]; if (Number.isFinite(z) && z - zPanel >= 0.025) n++; } if (n >= 0.4 * R.nx) railRows.push(iy); }
  const rail = railRows.length ? {yMin: r3(R.y(railRows[0]) - R.cell / 2), yMax: r3(R.y(railRows[railRows.length - 1]) + R.cell / 2), frontZ: r3(bb.max[2]), panelZ: r3(zPanel), protrusionM: r3(bb.max[2] - zPanel)} : null;
  return {counterTopY: top?.y ?? null, counterTopMaxY: top?.yTop ?? null, counterSurface: top, trayRail: rail, frontPanelZ: r3(zPanel), backZ: r3(bb.min[2]), horizontalSurfaces: surf,
    method: 'Counter top = largest horizontal (normal.y > 0.9) dense-face cluster above 0.6 m within the central 90% x 96% of the footprint (area-weighted 5 mm histogram). Tray rail = rows of a 1 cm front relief map below the counter top where >= 40% of the central 80% of cells protrude >= 2.5 cm in front of the median front-panel plane (0.25-0.6 m band).',
    extras: {counterTopY: top?.y ?? null, trayRail: rail}};
};
CFG.shopCooler.measure = (DP, I, bb) => {
  // Interior shelves (if the reconstruction modelled depth behind the glass): horizontal clusters in the central 80% x 70% footprint.
  const surf = allSurfaces(DP, I, bb, {xFrac: 0.4, zFrac: 0.35, minFrac: 0.05, y0: 0.15}).filter(s => s.y < bb.size[1] - 0.05);
  const R = frontRelief(DP, bb), zFront = pct([...R.Z], 0.95), mid = [];
  for (let iy = Math.floor(0.4 * R.ny); iy < Math.floor(0.8 * R.ny); iy++) for (let ix = Math.floor(0.25 * R.nx); ix < Math.ceil(0.75 * R.nx); ix++) mid.push(zFront - R.Z[iy * R.nx + ix]);
  return {shelfY: surf.map(s => s.y), horizontalSurfaces: surf, frontZ: r3(zFront), doorCentreRecessMedianM: r3(pct(mid, 0.5)), doorCentreRecessP90M: r3(pct(mid, 0.9)),
    method: 'Horizontal (normal.y > 0.9) dense-face clusters >= 5% of the largest within the central 80% x 70% of the footprint above 0.15 m (interior shelves only if modelled); door recess = front relief (1 cm cells) of the central door area vs the 95th-percentile front z.',
    extras: {shelfY: surf.map(s => s.y)}};
};
CFG.shopDisplay.measure = (DP, I, bb) => {
  const surf = allSurfaces(DP, I, bb, {xFrac: 0.42, zFrac: 0.4, minFrac: 0.05, y0: 0.03});
  const inner = surf.filter(s => s.y < bb.size[1] - 0.04);
  return {horizontalSurfaces: surf, innerLevelsY: inner.map(s => s.y), topY: r3(bb.max[1]),
    method: 'Horizontal (normal.y > 0.9) dense-face clusters >= 5% of the largest within the central 84% x 80% of the footprint (base deck, pan levels, canopy top).',
    extras: {levelsY: inner.map(s => s.y)}};
};
CFG.shopBackbar.measure = (DP, I, bb) => {
  const surf = allSurfaces(DP, I, bb, {xFrac: 0.47, zFrac: 0.47, minFrac: 0.03, gap: 1});
  const work = surf.filter(s => s.y > 0.6 && s.y < 1.15 && s.areaM2 >= 0.3).sort((a, b) => a.y - b.y)[0] ?? null;
  const over = surf.filter(s => s.y > 1.2 && s.areaM2 >= 0.1).sort((a, b) => a.y - b.y)[0] ?? null;
  const equipment = surf.filter(s => work && s.y > work.yTop && s.y < 1.3).map(s => s.y);
  return {worktopY: work?.y ?? null, worktop: work, equipmentTopsY: equipment, overshelfY: over?.y ?? null, overshelf: over, horizontalSurfaces: surf,
    method: 'Horizontal (normal.y > 0.9) dense-face clusters (5 mm bins, adjacent bins merged) >= 3% of the largest within the central 94% x 94% of the footprint; worktop = LOWEST cluster >= 0.3 m2 between 0.6 and 1.15 m (partly covered by the griddle/fryer, whose plate/basket tops are the equipmentTopsY clusters just above it); overshelf = lowest cluster >= 0.1 m2 above 1.2 m (pans sit on it).',
    extras: {worktopY: work?.y ?? null, overshelfY: over?.y ?? null}};
};

// Per-asset limitations observed in the CPU QA renders (qa-artifacts/assets/props-iteration04/<key>-derived.png); filled after review.
CFG.trashCan.limitations = ['At ~2.4k triangles the slats are slightly uneven and the hood is coarse; the dome top and hood band are repainted by projection (top-repaint / radial-repaint steps) because the coarse cap baked the dark bin interior; their normal texels are flat.', 'Back and interior inferred from a single front view (no opening at the back; dark inner bin visible between the slats). Label plate blank.'];
CFG.shopCounter.limitations = ['The single front view gave no depth cue: SV returned a box 2.66 m deep at the 1.05 m height fit; depth-band remap kept the front 14 cm (rail, top overhang) and back 4 cm at true scale and compressed the plain middle x0.23 to reach 0.75 m. Width compressed x0.735 (rail tubes run along x, so their cross-section is unaffected).', 'SV mirrored the tray-slide rail onto the BACK face as well (staff side) and invented grey patches on the back/sides; a small knob protrudes at the +X end. Both ends are plain panels (modular run), not cut-open.'];
CFG.shopCooler.limitations = ['SV reconstructed the glass door as an opaque light pane with only shelves and a few bottles behind it; the pane texels show the straight-on conditioning image projected along Z (pane-projection step): the drinks are a flat picture on closed glass, not modelled depth or loot. Shelf lines (visibleShelfLinesY) are measured on that image.', 'SV returned a box 2.38 m deep at the 2.0 m height fit with the door handle 0.375 m proud of the door: depth-band remap compressed the handle stand-off to 5 cm and the middle x0.31 to reach 0.75 m.', 'Sides, back and the open top were invented by SV as white panels/light interior: recoloured to the cabinet charcoal sampled from the conditioning image, with flat normals and constant painted-steel MR. A light sliver of the interior is still visible over the top edge from above.'];
CFG.shopDisplay.limitations = ['SV reconstructed the glass as opaque light panes with nothing behind the front: the front-plane texels show the straight-on conditioning image projected along Z (pane-projection step), so the lit pans and racks are a flat picture on closed glass. Side and back glass (never seen by the front view) are tinted to the mean interior colour of the image with flat normals; they are opaque.', 'Scaled to a 1.1 m countertop unit (see dimsOverride); depth fitted x0.58 vs uniform. Horizontal levels (innerLevelsY) come from the reconstructed geometry: lower deck ~0.21 m, upper rack ~0.43 m above the unit base (add the counter-top height when placed on shopCounter).'];
CFG.shopBackbar.limitations = ['Reconstruction was tilted ~9 deg toward the camera in source space (levelled by the box frame). Depth fitted x0.58 relative to the uniform fit (single front view, no depth cue): griddle/fryer/overshelf are proportionally shallower.', 'Back and sides inferred (plain stainless back with a raised upstand); thin overshelf posts and fryer basket handles are coarse at ~5.2k triangles. Pans on the overshelf and the fryer baskets are fixed geometry (not loot).'];

// Vending window: the native master models the product rows ~3-33 cm behind an opaque, light grey "glass" pane surface, so a plain
// closest-surface bake shows a blank grey window. This step (vending only) finds the pane faces in the dense output-space mesh
// (front-facing, light + desaturated texture, at the pane depth), renders the dense interior BEHIND the pane orthographically from
// the front (pane excluded, nearest-z wins), and repaints only the low-poly pane texels with that view (82% interior + 18% glass
// tint), glossy non-metal MR and a flat normal. Everything else keeps the regular bake.
function windowRepaint(dense, DP, low, pos, baked, cfg) {
  const {I, UV, bc} = dense, nf = I.length / 3;
  const texAt = (ui) => { const tx = Math.min(bc.width - 1, Math.max(0, Math.floor(UV[2 * ui] * bc.width))), ty = Math.min(bc.height - 1, Math.max(0, Math.floor(UV[2 * ui + 1] * bc.height))); const o = 4 * (ty * bc.width + tx); return [bc.data[o], bc.data[o + 1], bc.data[o + 2]]; };
  const fz = new Float32Array(nf), fnz = new Float32Array(nf), light = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = DP[b] - DP[a], uy = DP[b + 1] - DP[a + 1], uz = DP[b + 2] - DP[a + 2], vx = DP[c] - DP[a], vy = DP[c + 1] - DP[a + 1], vz = DP[c + 2] - DP[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    fnz[f] = nz / l; fz[f] = (DP[a + 2] + DP[b + 2] + DP[c + 2]) / 3;
    const col = [0, 1, 2].map(k => texAt(I[3 * f + k])).reduce((s, x) => s.map((v, i) => v + x[i] / 3), [0, 0, 0]);
    light[f] = (Math.min(...col) > 140 && Math.max(...col) - Math.min(...col) < 30) ? 1 : 0;
  }
  const zs = []; for (let f = 0; f < nf; f++) if (fnz[f] > 0.8 && light[f]) zs.push(fz[f]);
  zs.sort((x, y) => x - y); const zPane = zs[Math.floor(zs.length / 2)];
  const pane = new Uint8Array(nf); const rect = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity}; let paneArea = 0;
  for (let f = 0; f < nf; f++) if (fnz[f] > 0.6 && light[f] && Math.abs(fz[f] - zPane) < 0.025) {
    pane[f] = 1;
    for (let k = 0; k < 3; k++) { const v = 3 * I[3 * f + k]; rect.x0 = Math.min(rect.x0, DP[v]); rect.x1 = Math.max(rect.x1, DP[v]); rect.y0 = Math.min(rect.y0, DP[v + 1]); rect.y1 = Math.max(rect.y1, DP[v + 1]); }
  }
  // robust rect: 2nd/98th percentiles of pane vertex x/y
  const px = [], py = []; for (let f = 0; f < nf; f++) if (pane[f]) { const v = 3 * I[3 * f]; px.push(DP[v]); py.push(DP[v + 1]); }
  px.sort((a, b) => a - b); py.sort((a, b) => a - b); const q = (A, t) => A[Math.floor(t * (A.length - 1))];
  // window extents from pane-face AREA density: 1 cm columns/rows whose pane area >= 30% of the median non-empty bin (robust to stray
  // light-coloured faces on the control column / frame)
  const bins = (axis) => { const m = new Map(); for (let f = 0; f < nf; f++) if (pane[f]) { const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
      const ux = DP[b] - DP[a], uy = DP[b + 1] - DP[a + 1], vx = DP[c] - DP[a], vy = DP[c + 1] - DP[a + 1], ar = Math.abs(ux * vy - uy * vx) / 2;
      const k = Math.floor((DP[a + axis] + DP[b + axis] + DP[c + axis]) / 3 / 0.01); m.set(k, (m.get(k) ?? 0) + ar); }
    const vals = [...m.values()].sort((x, y) => x - y), med = vals[Math.floor(vals.length / 2)], keys = [...m.keys()].filter(k => m.get(k) >= 0.3 * med).sort((x, y) => x - y);
    // longest contiguous run
    let best = [keys[0], keys[0]], cur = [keys[0], keys[0]]; for (const k of keys.slice(1)) { if (k <= cur[1] + 2) cur[1] = k; else cur = [k, k]; if (cur[1] - cur[0] > best[1] - best[0]) best = cur.slice(); }
    return [best[0] * 0.01, (best[1] + 1) * 0.01]; };
  const [gx0, gx1] = bins(0), [gy0, gy1] = bins(1);
  const G = {x0: gx0, x1: gx1, y0: gy0, y1: gy1};
  // front ortho render of the interior behind the pane (2 mm cells), excluding pane faces and anything in front of the pane
  const cell = 0.002, W = Math.ceil((G.x1 - G.x0) / cell), H = Math.ceil((G.y1 - G.y0) / cell);
  const img = new Uint8Array(W * H * 3), zb = new Float32Array(W * H).fill(-Infinity);
  for (let f = 0; f < nf; f++) {
    if (pane[f] || fnz[f] <= 0.05 || fz[f] > zPane - 0.005) continue;
    const vs = [0, 1, 2].map(k => I[3 * f + k]);
    const X = vs.map(v => (DP[3 * v] - G.x0) / cell), Y = vs.map(v => (G.y1 - DP[3 * v + 1]) / cell), Z = vs.map(v => DP[3 * v + 2]);
    const xa = Math.max(0, Math.floor(Math.min(...X))), xb = Math.min(W - 1, Math.ceil(Math.max(...X))), ya = Math.max(0, Math.floor(Math.min(...Y))), yb = Math.min(H - 1, Math.ceil(Math.max(...Y)));
    if (xa > xb || ya > yb) continue;
    const den = (Y[1] - Y[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Y[0] - Y[2]); if (Math.abs(den) < 1e-12) continue;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const w0 = ((Y[1] - Y[2]) * (x + 0.5 - X[2]) + (X[2] - X[1]) * (y + 0.5 - Y[2])) / den, w1 = ((Y[2] - Y[0]) * (x + 0.5 - X[2]) + (X[0] - X[2]) * (y + 0.5 - Y[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], k = y * W + x; if (z <= zb[k]) continue; zb[k] = z;
      const u = w0 * UV[2 * vs[0]] + w1 * UV[2 * vs[1]] + w2 * UV[2 * vs[2]], v = w0 * UV[2 * vs[0] + 1] + w1 * UV[2 * vs[1] + 1] + w2 * UV[2 * vs[2] + 1];
      const tx = Math.min(bc.width - 1, Math.max(0, Math.floor(u * bc.width))), ty = Math.min(bc.height - 1, Math.max(0, Math.floor(v * bc.height))), o = 4 * (ty * bc.width + tx);
      img[3 * k] = bc.data[o]; img[3 * k + 1] = bc.data[o + 1]; img[3 * k + 2] = bc.data[o + 2];
    }
  }
  let covered = 0; for (let k = 0; k < W * H; k++) if (zb[k] > -Infinity) covered++;
  // repaint low-poly pane texels (faces facing +Z, centroid inside the glass rect and at the pane depth)
  const tint = [172, 182, 184], kI = 0.82;
  const C = baked.color, MRi = baked.mr, NI = baked.normal; let texels = 0, lowFaces = 0;
  const li = low.idx; const LR = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity};
  for (let f = 0; f < li.length / 3; f++) {
    const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]];
    const P3 = vs.map(v => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    const u = [P3[1][0] - P3[0][0], P3[1][1] - P3[0][1], P3[1][2] - P3[0][2]], w = [P3[2][0] - P3[0][0], P3[2][1] - P3[0][1], P3[2][2] - P3[0][2]];
    const n = cross(u, w), nl = Math.hypot(...n) || 1; if (n[2] / nl < 0.85) continue;
    const cx = (P3[0][0] + P3[1][0] + P3[2][0]) / 3, cy = (P3[0][1] + P3[1][1] + P3[2][1]) / 3, cz = (P3[0][2] + P3[1][2] + P3[2][2]) / 3;
    if (cx < G.x0 + 0.005 || cx > G.x1 - 0.005 || cy < G.y0 + 0.005 || cy > G.y1 - 0.005 || Math.abs(cz - zPane) > 0.04) continue;
    lowFaces++;
    for (const q3 of P3) { LR.x0 = Math.min(LR.x0, q3[0]); LR.x1 = Math.max(LR.x1, q3[0]); LR.y0 = Math.min(LR.y0, q3[1]); LR.y1 = Math.max(LR.y1, q3[1]); }
    for (const [T, isColor, kind] of [[C, true, 'c'], [MRi, false, 'm'], [NI, false, 'n']]) {
      const S = T.size, U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U) - 1)), xb = Math.min(S - 1, Math.ceil(Math.max(...U) + 1)), ya = Math.max(0, Math.floor(Math.min(...V) - 1)), yb = Math.min(S - 1, Math.ceil(Math.max(...V) + 1));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      const tol = -1.0 / Math.max(1, Math.sqrt(Math.abs(den)));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const o = 3 * (y * S + x);
        if (kind === 'c') {
          const X = w0 * P3[0][0] + w1 * P3[1][0] + w2 * P3[2][0], Y = w0 * P3[0][1] + w1 * P3[1][1] + w2 * P3[2][1];
          const ix = Math.min(W - 1, Math.max(0, Math.floor((X - G.x0) / cell))), iy = Math.min(H - 1, Math.max(0, Math.floor((G.y1 - Y) / cell))), k = iy * W + ix;
          if (zb[k] === -Infinity) continue;
          for (let ch = 0; ch < 3; ch++) T.data[o + ch] = Math.round(kI * 0.92 * img[3 * k + ch] + (1 - kI) * tint[ch]);
          texels++;
        } else if (kind === 'm') { T.data[o] = 255; T.data[o + 1] = 40; T.data[o + 2] = 0; }   // roughness ~0.16, metalness 0
        else { T.data[o] = 128; T.data[o + 1] = 128; T.data[o + 2] = 255; }
      }
    }
  }
  const r3_ = v => Math.round(v * 1e3) / 1e3;
  log(`  window repaint: pane z ${r3_(zPane)} m, rect x ${r3_(G.x0)}..${r3_(G.x1)} y ${r3_(G.y0)}..${r3_(G.y1)}, interior coverage ${(covered / (W * H) * 100).toFixed(1)}%, low faces ${lowFaces}, colour texels ${texels}`);
  return {paneZ: r3_(zPane), glassWindow: {xMin: r3_(G.x0), xMax: r3_(G.x1), yMin: r3_(G.y0), yMax: r3_(G.y1), widthM: r3_(G.x1 - G.x0), heightM: r3_(G.y1 - G.y0), areaM2: r3_((G.x1 - G.x0) * (G.y1 - G.y0)), z: r3_(zPane), source: 'pane-face area density (1 cm bins >= 30% of median, longest run)'},
    repaintedLowFacesBBox: {xMin: r3_(LR.x0), xMax: r3_(LR.x1), yMin: r3_(LR.y0), yMax: r3_(LR.y1)},
    interiorCoverage: Math.round(covered / (W * H) * 1000) / 1000, lowPaneFaces: lowFaces, repaintedColorTexels: texels, interiorDepthRangeBehindPane: 'products ~3-33 cm behind the pane in the dense master',
    method: 'Dense output-space faces with normal.z > 0.6, light desaturated texture (min RGB > 140, spread < 30) within 2.5 cm of the median pane depth = glass pane; rect = pane-face area density per 1 cm column/row (>= 30% of the median bin, longest contiguous run). Interior rendered orthographically from +Z at 2 mm behind the pane (nearest-z), repainted onto low-poly pane texels (82% interior x 0.92 + 18% glass tint), MR roughness ~0.16 / metal 0, flat normal.'};
}

// Top-projection repaint (iteration04): coarse low-poly caps (e.g. the trash-can dome) can sit closer to an inner dark surface (the bin
// interior seen through the hood) than to the outer shell, so the closest-surface bake shows black blotches. This step renders the dense
// output-space mesh orthographically from above (+Y, 2 mm cells, highest upward-facing surface wins, colour + MR from the dense textures)
// and repaints only low-poly texels of upward-facing faces (normal.y > minNy) whose centroid lies above yMin with that top view; the
// normal texels of those faces are set flat. Everything else keeps the regular bake.
function topRepaint(dense, DP, low, pos, baked, {yMin, minNy = 0.35, cell = 0.002}) {
  const {I, UV, bc, mr} = dense, nf = I.length / 3;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < DP.length; i += 3) { x0 = Math.min(x0, DP[i]); x1 = Math.max(x1, DP[i]); z0 = Math.min(z0, DP[i + 2]); z1 = Math.max(z1, DP[i + 2]); }
  const W = Math.ceil((x1 - x0) / cell) + 1, H = Math.ceil((z1 - z0) / cell) + 1;
  const col = new Uint8Array(W * H * 3), mrv = new Uint8Array(W * H * 2), yb = new Float32Array(W * H).fill(-Infinity);
  for (let f = 0; f < nf; f++) {
    const vs = [I[3 * f], I[3 * f + 1], I[3 * f + 2]];
    const X = vs.map(v => (DP[3 * v] - x0) / cell), Z = vs.map(v => (DP[3 * v + 2] - z0) / cell), Y = vs.map(v => DP[3 * v + 1]);
    const ux = DP[3 * vs[1]] - DP[3 * vs[0]], uy = DP[3 * vs[1] + 1] - DP[3 * vs[0] + 1], uz = DP[3 * vs[1] + 2] - DP[3 * vs[0] + 2];
    const vx = DP[3 * vs[2]] - DP[3 * vs[0]], vy = DP[3 * vs[2] + 1] - DP[3 * vs[0] + 1], vz = DP[3 * vs[2] + 2] - DP[3 * vs[0] + 2];
    const ny = uz * vx - ux * vz, l = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
    if (ny / l <= 0.05 || Math.max(...Y) < yMin - 0.05) continue;
    const xa = Math.max(0, Math.floor(Math.min(...X))), xb = Math.min(W - 1, Math.ceil(Math.max(...X))), za = Math.max(0, Math.floor(Math.min(...Z))), zb = Math.min(H - 1, Math.ceil(Math.max(...Z)));
    const den = (Z[1] - Z[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Z[0] - Z[2]); if (Math.abs(den) < 1e-12) continue;
    for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) {
      const w0 = ((Z[1] - Z[2]) * (x + 0.5 - X[2]) + (X[2] - X[1]) * (z + 0.5 - Z[2])) / den, w1 = ((Z[2] - Z[0]) * (x + 0.5 - X[2]) + (X[0] - X[2]) * (z + 0.5 - Z[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const y = w0 * Y[0] + w1 * Y[1] + w2 * Y[2], k = z * W + x; if (y <= yb[k]) continue; yb[k] = y;
      const u = w0 * UV[2 * vs[0]] + w1 * UV[2 * vs[1]] + w2 * UV[2 * vs[2]], v = w0 * UV[2 * vs[0] + 1] + w1 * UV[2 * vs[1] + 1] + w2 * UV[2 * vs[2] + 1];
      const tx = Math.min(bc.width - 1, Math.max(0, Math.floor(u * bc.width))), ty = Math.min(bc.height - 1, Math.max(0, Math.floor(v * bc.height))), o = 4 * (ty * bc.width + tx);
      col[3 * k] = bc.data[o]; col[3 * k + 1] = bc.data[o + 1]; col[3 * k + 2] = bc.data[o + 2]; mrv[2 * k] = mr.data[o + 1]; mrv[2 * k + 1] = mr.data[o + 2];
    }
  }
  const li = low.idx; let lowFaces = 0, texels = 0;
  for (let f = 0; f < li.length / 3; f++) {
    const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]], P3 = vs.map(v => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    const n = cross(P3[1].map((x, k) => x - P3[0][k]), P3[2].map((x, k) => x - P3[0][k])), nl = Math.hypot(...n) || 1;
    if (n[1] / nl < minNy || (P3[0][1] + P3[1][1] + P3[2][1]) / 3 < yMin) continue;
    lowFaces++;
    for (const [T, kind] of [[baked.color, 'c'], [baked.mr, 'm'], [baked.normal, 'n']]) {
      const S = T.size, U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U) - 1)), xb = Math.min(S - 1, Math.ceil(Math.max(...U) + 1)), ya = Math.max(0, Math.floor(Math.min(...V) - 1)), yb2 = Math.min(S - 1, Math.ceil(Math.max(...V) + 1));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      const tol = -1.0 / Math.max(1, Math.sqrt(Math.abs(den)));
      for (let y = ya; y <= yb2; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const o = 3 * (y * S + x);
        if (kind === 'n') { T.data[o] = 128; T.data[o + 1] = 128; T.data[o + 2] = 255; continue; }
        const X = w0 * P3[0][0] + w1 * P3[1][0] + w2 * P3[2][0], Z = w0 * P3[0][2] + w1 * P3[1][2] + w2 * P3[2][2];
        const ix = Math.min(W - 1, Math.max(0, Math.floor((X - x0) / cell))), iz = Math.min(H - 1, Math.max(0, Math.floor((Z - z0) / cell))), k = iz * W + ix;
        if (yb[k] === -Infinity) continue;
        if (kind === 'c') { for (let ch = 0; ch < 3; ch++) T.data[o + ch] = col[3 * k + ch]; texels++; }
        else { T.data[o] = 255; T.data[o + 1] = mrv[2 * k]; T.data[o + 2] = mrv[2 * k + 1]; }
      }
    }
  }
  log(`  top repaint: low faces ${lowFaces} (normal.y > ${minNy}, centroid y > ${yMin} m), colour texels ${texels}`);
  return {yMin, minNy, cellM: cell, lowFaces, repaintedColorTexels: texels,
    method: 'Dense output-space mesh rendered orthographically from +Y (2 mm cells, highest upward-facing surface wins; colour + metallic-roughness from the dense textures); repainted onto low-poly texels of faces with normal.y > minNy and centroid above yMin; their normal texels set flat. Fixes closest-surface bake hits on the dark interior below a coarse simplified cap.'};
}

// Radial-projection repaint (iteration04, round objects): same failure as above on the near-vertical faces of a coarse hood band. The dense
// output-space mesh is rendered in cylindrical (theta, y) space around the vertical axis through the bbox centre (0.5 deg x 2 mm cells,
// outermost outward-facing surface wins) and repainted onto low-poly texels of side-facing faces (|normal.y| < maxNy) whose centroid lies in
// [yMin, yMax]; their normal texels are set flat. Where the outermost surface is the dark interior seen through the disposal opening, the
// render keeps that dark interior.
function radialRepaint(dense, DP, low, pos, baked, {yMin, yMax, maxNy = 0.6, dTheta = 0.5, cell = 0.002, cx = 0, cz = 0}) {
  const {I, UV, bc, mr} = dense, nf = I.length / 3, W = Math.round(360 / dTheta), H = Math.ceil((yMax - yMin + 0.1) / cell) + 1, y0 = yMin - 0.05;
  const th = (x, z) => ((Math.atan2(x - cx, z - cz) * 180 / Math.PI) + 360) % 360 / dTheta;   // 0 at +Z (front), increasing toward +X
  const col = new Uint8Array(W * H * 3), mrv = new Uint8Array(W * H * 2), rb = new Float32Array(W * H).fill(-Infinity);
  for (let f = 0; f < nf; f++) {
    const vs = [I[3 * f], I[3 * f + 1], I[3 * f + 2]], Y = vs.map(v => DP[3 * v + 1]);
    if (Math.max(...Y) < y0 || Math.min(...Y) > yMax + 0.05) continue;
    const P3 = vs.map(v => [DP[3 * v], DP[3 * v + 1], DP[3 * v + 2]]);
    const n = cross(P3[1].map((x, k) => x - P3[0][k]), P3[2].map((x, k) => x - P3[0][k])), nl = Math.hypot(...n) || 1;
    const mx = (P3[0][0] + P3[1][0] + P3[2][0]) / 3 - cx, mz = (P3[0][2] + P3[1][2] + P3[2][2]) / 3 - cz, ml = Math.hypot(mx, mz) || 1;
    if ((n[0] * mx + n[2] * mz) / (nl * ml) <= 0.1) continue;
    let T = P3.map(p => th(p[0], p[2]));
    if (Math.max(...T) - Math.min(...T) > W / 2) T = T.map(t => (t < W / 2 ? t + W : t));
    const Yc = Y.map(y => (y - y0) / cell), Rr = P3.map(p => Math.hypot(p[0] - cx, p[2] - cz));
    const xa = Math.floor(Math.min(...T)), xb = Math.ceil(Math.max(...T)), ya = Math.max(0, Math.floor(Math.min(...Yc))), yb = Math.min(H - 1, Math.ceil(Math.max(...Yc)));
    const den = (Yc[1] - Yc[2]) * (T[0] - T[2]) + (T[2] - T[1]) * (Yc[0] - Yc[2]); if (Math.abs(den) < 1e-12) continue;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const w0 = ((Yc[1] - Yc[2]) * (x + 0.5 - T[2]) + (T[2] - T[1]) * (y + 0.5 - Yc[2])) / den, w1 = ((Yc[2] - Yc[0]) * (x + 0.5 - T[2]) + (T[0] - T[2]) * (y + 0.5 - Yc[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const r = w0 * Rr[0] + w1 * Rr[1] + w2 * Rr[2], k = y * W + (((x % W) + W) % W); if (r <= rb[k]) continue; rb[k] = r;
      const u = w0 * UV[2 * vs[0]] + w1 * UV[2 * vs[1]] + w2 * UV[2 * vs[2]], v = w0 * UV[2 * vs[0] + 1] + w1 * UV[2 * vs[1] + 1] + w2 * UV[2 * vs[2] + 1];
      const tx = Math.min(bc.width - 1, Math.max(0, Math.floor(u * bc.width))), ty = Math.min(bc.height - 1, Math.max(0, Math.floor(v * bc.height))), o = 4 * (ty * bc.width + tx);
      col[3 * k] = bc.data[o]; col[3 * k + 1] = bc.data[o + 1]; col[3 * k + 2] = bc.data[o + 2]; mrv[2 * k] = mr.data[o + 1]; mrv[2 * k + 1] = mr.data[o + 2];
    }
  }
  const li = low.idx; let lowFaces = 0, texels = 0;
  for (let f = 0; f < li.length / 3; f++) {
    const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]], P3 = vs.map(v => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    const n = cross(P3[1].map((x, k) => x - P3[0][k]), P3[2].map((x, k) => x - P3[0][k])), nl = Math.hypot(...n) || 1, cy = (P3[0][1] + P3[1][1] + P3[2][1]) / 3;
    const mx = (P3[0][0] + P3[1][0] + P3[2][0]) / 3 - cx, mz = (P3[0][2] + P3[1][2] + P3[2][2]) / 3 - cz;
    if (Math.abs(n[1] / nl) >= maxNy || cy < yMin || cy > yMax || (n[0] * mx + n[2] * mz) <= 0) continue;
    lowFaces++;
    for (const [T, kind] of [[baked.color, 'c'], [baked.mr, 'm'], [baked.normal, 'n']]) {
      const S = T.size, U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U) - 1)), xb = Math.min(S - 1, Math.ceil(Math.max(...U) + 1)), ya = Math.max(0, Math.floor(Math.min(...V) - 1)), yb2 = Math.min(S - 1, Math.ceil(Math.max(...V) + 1));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      const tol = -1.0 / Math.max(1, Math.sqrt(Math.abs(den)));
      for (let y = ya; y <= yb2; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const o = 3 * (y * S + x);
        if (kind === 'n') { T.data[o] = 128; T.data[o + 1] = 128; T.data[o + 2] = 255; continue; }
        const X = w0 * P3[0][0] + w1 * P3[1][0] + w2 * P3[2][0], Yw = w0 * P3[0][1] + w1 * P3[1][1] + w2 * P3[2][1], Z = w0 * P3[0][2] + w1 * P3[1][2] + w2 * P3[2][2];
        const ix = Math.floor(th(X, Z)) % W, iy = Math.min(H - 1, Math.max(0, Math.floor((Yw - y0) / cell))), k = iy * W + ix;
        if (rb[k] === -Infinity) continue;
        if (kind === 'c') { for (let ch = 0; ch < 3; ch++) T.data[o + ch] = col[3 * k + ch]; texels++; }
        else { T.data[o] = 255; T.data[o + 1] = mrv[2 * k]; T.data[o + 2] = mrv[2 * k + 1]; }
      }
    }
  }
  log(`  radial repaint: low faces ${lowFaces} (|normal.y| < ${maxNy}, centroid y ${yMin.toFixed(3)}..${yMax.toFixed(3)} m), colour texels ${texels}`);
  return {yMin: r3(yMin), yMax: r3(yMax), maxNy, dThetaDeg: dTheta, cellM: cell, lowFaces, repaintedColorTexels: texels,
    method: 'Dense output-space mesh rendered in cylindrical (theta, y) space about the vertical axis through the bbox centre (0.5 deg x 2 mm cells, outermost outward-facing surface wins; colour + metallic-roughness from the dense textures); repainted onto low-poly texels of outward side faces in the band; normal texels set flat.'};
}

// Depth-band remap (iteration04, straight-on inputs): a front elevation carries no depth cue and SV can return a box far deeper than the
// object (shop counter: depth 1.3x its width). A plain z scale would also flatten the front relief (rail stand-off, top overhang). This keeps
// the front band (front metres) and back band (back metres) at the uniform scale and compresses only the plain middle so the total depth equals
// the target; then re-centres z. Monotonic in z only: planar faces at constant z stay planar; normals get the inverse z factor.
function depthRemap(bb, target, {front, back, protrusion = 0, protrusionTo = 0}) {
  // Optional protrusion segment: the first `protrusion` metres (things sticking out in front of the main front plane, e.g. an oversized
  // reconstructed door handle) are compressed to `protrusionTo` metres; the kept front band then starts at the main front plane.
  const zB = bb.min[2], D = bb.size[2], P0 = protrusion, mid = D - P0 - front - back;
  if (!(D > target + 1e-6) || mid <= 0 || target - protrusionTo - front - back <= 0.02) return null;
  const k = (target - protrusionTo - front - back) / mid, kp = P0 > 0 ? protrusionTo / P0 : 1;
  const map = z => { const u = z - zB; let v;
    if (u <= back) v = u; else if (u <= back + mid) v = back + (u - back) * k; else if (u <= D - P0) v = back + mid * k + (u - back - mid);
    else v = back + mid * k + front + (u - (D - P0)) * kp;
    return v - target / 2; };
  return {k, info: {frontBandM: front, backBandM: back, protrusionM: P0, protrusionToM: protrusionTo, uniformDepthM: r4(D), targetDepthM: target, middleScale: r4(k), protrusionScale: r4(kp),
      note: 'z remapped piecewise-linearly: front band (behind any protrusion) and back band kept at uniform scale, middle compressed, protrusion compressed; re-centred on z = 0'},
    factorAt: z => { const u = z - zB; return u <= back ? 1 : u <= back + mid ? k : u <= D - P0 ? 1 : kp; },
    apply: P => { for (let i = 2; i < P.length; i += 3) P[i] = map(P[i]); return P; }};
}

// Conditioning-image pane projection (iteration04, straight-on inputs only): SV reconstructs glass as an opaque light pane and models little
// or nothing behind it (cooler: shelves + a few bottles, ghost smudges). Because the conditioning image is a straight-on front elevation,
// its glass region maps onto the pane by a planar projection along Z: image alpha bbox (alpha >= 128) <-> output-space front silhouette
// bbox (x, y). Repaints only low-poly texels of front-facing faces (normal.z > 0.85) within `paneDepth` of the detected pane plane whose
// baked colour is light (the pane), with the conditioning-image pixels (bilinear); glossy non-metal MR, flat normal.
async function paneProjection(src, low, pos, baked, outBB, {paneZ, paneDepth = 0.03, minLight = 140, inset = 0.01}) {
  const {data, info} = await sharp(path.join(REPO, src.conditioningImage.path)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const IW = info.width, IH = info.height; let bx0 = IW, by0 = IH, bx1 = -1, by1 = -1;
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (data[4 * (y * IW + x) + 3] >= 128) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const toPx = (X, Y) => [bx0 + (X - outBB.min[0]) / outBB.size[0] * (bx1 + 1 - bx0), by0 + (outBB.max[1] - Y) / outBB.size[1] * (by1 + 1 - by0)];
  const sample = (px, py, out) => { const x = Math.min(IW - 1.001, Math.max(0, px - 0.5)), y = Math.min(IH - 1.001, Math.max(0, py - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    for (let c = 0; c < 3; c++) { const g = (xx, yy) => data[4 * (yy * IW + xx) + c]; out[c] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy; } };
  const C = baked.color, li = low.idx, rgb = [0, 0, 0]; let lowFaces = 0, texels = 0; const R = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity};
  for (let f = 0; f < li.length / 3; f++) {
    const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]], P3 = vs.map(v => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    const n = cross(P3[1].map((x, k) => x - P3[0][k]), P3[2].map((x, k) => x - P3[0][k])), nl = Math.hypot(...n) || 1;
    if (n[2] / nl < 0.85 || Math.abs((P3[0][2] + P3[1][2] + P3[2][2]) / 3 - paneZ) > paneDepth) continue;
    // light baked colour at the face centroid texel => pane (not the black door frame)
    const S0 = C.size, cu = Math.min(S0 - 1, Math.floor((low.uv[2 * vs[0]] + low.uv[2 * vs[1]] + low.uv[2 * vs[2]]) / 3 * S0)), cv = Math.min(S0 - 1, Math.floor((low.uv[2 * vs[0] + 1] + low.uv[2 * vs[1] + 1] + low.uv[2 * vs[2] + 1]) / 3 * S0));
    const o0 = 3 * (cv * S0 + cu); if ((C.data[o0] + C.data[o0 + 1] + C.data[o0 + 2]) / 3 < minLight) continue;
    lowFaces++; for (const q of P3) { R.x0 = Math.min(R.x0, q[0]); R.x1 = Math.max(R.x1, q[0]); R.y0 = Math.min(R.y0, q[1]); R.y1 = Math.max(R.y1, q[1]); }
    for (const [T, kind] of [[baked.color, 'c'], [baked.mr, 'm'], [baked.normal, 'n']]) {
      const S = T.size, U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U) - 1)), xb = Math.min(S - 1, Math.ceil(Math.max(...U) + 1)), ya = Math.max(0, Math.floor(Math.min(...V) - 1)), yb = Math.min(S - 1, Math.ceil(Math.max(...V) + 1));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      const tol = -1.0 / Math.max(1, Math.sqrt(Math.abs(den)));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const o = 3 * (y * S + x);
        if (kind === 'c') { const [px, py] = toPx(w0 * P3[0][0] + w1 * P3[1][0] + w2 * P3[2][0], w0 * P3[0][1] + w1 * P3[1][1] + w2 * P3[2][1]); sample(px, py, rgb); for (let c = 0; c < 3; c++) T.data[o + c] = Math.round(rgb[c]); texels++; }
        else if (kind === 'm') { T.data[o] = 255; T.data[o + 1] = 45; T.data[o + 2] = 0; }
        else { T.data[o] = 128; T.data[o + 1] = 128; T.data[o + 2] = 255; }
      }
    }
  }
  log(`  pane projection: pane z ${r3(paneZ)}, low faces ${lowFaces}, colour texels ${texels}, rect x ${r3(R.x0)}..${r3(R.x1)} y ${r3(R.y0)}..${r3(R.y1)}; image bbox ${bx0},${by0}..${bx1},${by1}`);
  return {paneZ: r3(paneZ), lowFaces, repaintedColorTexels: texels, paneRect: {xMin: r3(R.x0), xMax: r3(R.x1), yMin: r3(R.y0), yMax: r3(R.y1)}, imageAlphaBBox: [bx0, by0, bx1, by1], conditioningImage: src.conditioningImage.path,
    method: 'Planar projection along Z of the straight-on conditioning image: image alpha>=128 bbox <-> output front-silhouette bbox (x, y); applied to low-poly texels of front-facing faces (normal.z > 0.85) within paneDepth of the pane plane (the dominant front-facing depth layer in the FRONT half, central 60% width x 30-80% height) whose baked colour is light; MR roughness ~0.18 / metal 0; flat normal. The products are a flat picture on the glass, not modelled depth.'};
}

// Face-class recolour (iteration04): a straight-on single view shows only the front, so SV invents the sides/back/top (cooler: white side
// panels and an open light top on a charcoal cabinet). Low-poly texels of the selected face classes (side |n.x| > 0.8, back n.z < -0.8,
// top n.y > 0.8 above topFrac of the height) are tinted to the cabinet colour sampled from the conditioning image (mean of opaque pixels
// with luminance < darkLum), keeping a mild luminance variation from the bake (grime) so they are not flat.
async function recolorFaces(src, low, pos, baked, outBB, {classes = ['side', 'back', 'top'], topFrac = 0.97, darkLum = 70, keep = 0.2, flatten = true, mr = [255, 165, 30], baseFrom = 'darkPixels', yBand = null, centralBox = [0.3, 0.35, 0.7, 0.6]}) {
  const {data, info} = await sharp(path.join(REPO, src.conditioningImage.path)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const sum = [0, 0, 0]; let n = 0;
  if (baseFrom === 'darkPixels') {
    for (let i = 0; i < info.width * info.height; i++) { const o = 4 * i; if (data[o + 3] < 200) continue; const L = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; if (L >= darkLum) continue; sum[0] += data[o]; sum[1] += data[o + 1]; sum[2] += data[o + 2]; n++; }
  } else {   // 'centralBox': mean colour of a central box of the object's alpha bbox (fractions x0,y0,x1,y1): the interior seen through the glass
    let bx0 = info.width, by0 = info.height, bx1 = -1, by1 = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[4 * (y * info.width + x) + 3] >= 128) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    const X0 = Math.round(bx0 + centralBox[0] * (bx1 - bx0)), X1 = Math.round(bx0 + centralBox[2] * (bx1 - bx0)), Y0 = Math.round(by0 + centralBox[1] * (by1 - by0)), Y1 = Math.round(by0 + centralBox[3] * (by1 - by0));
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const o = 4 * (y * info.width + x); sum[0] += data[o]; sum[1] += data[o + 1]; sum[2] += data[o + 2]; n++; }
  }
  const base = sum.map(v => v / Math.max(1, n)), baseL = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  const C = baked.color, li = low.idx; let lowFaces = 0, texels = 0;
  const done = new Uint8Array(C.size * C.size);   // each colour texel is tinted once (shared-edge texels are covered by two faces; the tint is relative)
  for (let f = 0; f < li.length / 3; f++) {
    const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]], P3 = vs.map(v => [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]]);
    const nn = cross(P3[1].map((x, k) => x - P3[0][k]), P3[2].map((x, k) => x - P3[0][k])), nl = Math.hypot(...nn) || 1, nv = nn.map(x => x / nl), cy = (P3[0][1] + P3[1][1] + P3[2][1]) / 3;
    const cz = (P3[0][2] + P3[1][2] + P3[2][2]) / 3;
    const cls = Math.abs(nv[0]) > 0.8 ? 'side' : nv[2] < -0.8 ? 'back' : (nv[1] > 0.8 && cy > topFrac * outBB.size[1]) ? 'top'
      : (cy > topFrac * outBB.size[1] && cz < outBB.max[2] - 0.15) ? 'interiorTop' : null;
    if (!cls || !classes.includes(cls) || (yBand && (cy < yBand[0] * outBB.size[1] || cy > yBand[1] * outBB.size[1]))) continue;
    lowFaces++;
    for (const [T, kind] of [[C, 'c'], ...(flatten ? [[baked.mr, 'm'], [baked.normal, 'n']] : [])]) {
      const S = T.size, U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U) - 1)), xb = Math.min(S - 1, Math.ceil(Math.max(...U) + 1)), ya = Math.max(0, Math.floor(Math.min(...V) - 1)), yb = Math.min(S - 1, Math.ceil(Math.max(...V) + 1));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      const tol = -1.0 / Math.max(1, Math.sqrt(Math.abs(den)));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 < tol || w1 < tol || w2 < tol) continue;
        const o = 3 * (y * S + x);
        if (kind === 'm') { T.data[o] = mr[0]; T.data[o + 1] = mr[1]; T.data[o + 2] = mr[2]; continue; }
        if (kind === 'n') { T.data[o] = 128; T.data[o + 1] = 128; T.data[o + 2] = 255; continue; }
        if (done[y * S + x]) continue; done[y * S + x] = 1;
        const L = Math.min(1, Math.max(0.6, (0.299 * T.data[o] + 0.587 * T.data[o + 1] + 0.114 * T.data[o + 2]) / 255));
        for (let c = 0; c < 3; c++) T.data[o + c] = Math.max(0, Math.min(255, Math.round(base[c] * (1 - keep / 2 + keep * (L - 0.6) / 0.4))));
        texels++;
      }
    }
  }
  log(`  recolour: classes ${classes.join('/')}, base rgb ${base.map(v => Math.round(v)).join(',')} (${baseFrom}: ${n} conditioning-image pixels), low faces ${lowFaces}, texels ${texels}`);
  return {classes, topFrac, baseFrom, yBand, flattenedNormalAndConstantMR: flatten ? {orm: mr, note: 'painted steel: occlusion 1, roughness ~0.65, metal ~0.12; flat normal'} : false, baseRgb: base.map(v => Math.round(v)), baseLuminance: Math.round(baseL), darkImagePixels: n, lowFaces, recolouredTexels: texels, keepLuminanceVariation: keep,
    method: 'Low-poly texels of side (|n.x| > 0.8), back (n.z < -0.8) and top (n.y > 0.8 near the top) faces tinted to the mean colour of the dark opaque conditioning-image pixels (cabinet paint), keeping a mild luminance variation from the bake: out = base x (1 - keep/2 + keep x (clamp(lum, 0.6, 1) - 0.6) / 0.4) (the clamp stops dark gutter texels from drawing triangle edges). Also tints faces near the top that lie >15 cm behind the front (interiorTop: the open top showed the light interior). These faces were never seen by the straight-on view (SV inferred them).'};
}

// Shelf lines visible through the glass, measured on the straight-on conditioning image (projected pane): rows inside the pane rect whose
// MEDIAN luminance over the central 70% of the glass columns is a local peak >= 1.12 x the pane median (continuous light shelf lips; bottles
// occupy only part of a row so they do not dominate the median). Returned in output-space metres.
async function shelfLinesFromImage(src, paneRect, outBB) {
  // Glass region found in the image itself: rows/columns of the object where >= 55% of the pixels are bright (luminance > 110; the glass
  // interior is light, the cabinet frame/header/grille dark). Shelf lips = rows inside it whose median luminance over the central 70% of the
  // glass columns is a local peak >= 1.08 x the glass median; non-maximum suppression keeps the strongest peaks >= 100 px apart. (paneRect unused; kept for the provenance call signature.)
  const {data, info} = await sharp(path.join(REPO, src.conditioningImage.path)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const IW = info.width, IH = info.height, lum = (x, y) => { const o = 4 * (y * IW + x); return data[o + 3] < 128 ? -1 : 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; };
  let bx0 = IW, by0 = IH, bx1 = -1, by1 = -1;
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (data[4 * (y * IW + x) + 3] >= 128) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const frac = (xs, ys) => { let b = 0, n = 0; for (const y of ys) for (const x of xs) { const L = lum(x, y); if (L < 0) continue; n++; if (L > 110) b++; } return n ? b / n : 0; };
  const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
  const rows = range(by0, by1).filter(y => frac(range(bx0, bx1), [y]) >= 0.55), cols = range(bx0, bx1).filter(x => frac([x], range(by0, by1)) >= 0.55);
  if (!rows.length || !cols.length) return {linesY: [], glass: null};
  const gy0 = rows[0], gy1 = rows[rows.length - 1], gx0 = cols[0], gx1 = cols[cols.length - 1], x0 = Math.round(gx0 + 0.15 * (gx1 - gx0)), x1 = Math.round(gx1 - 0.15 * (gx1 - gx0));
  const med = []; for (let y = gy0; y <= gy1; y++) { const L = []; for (let x = x0; x <= x1; x++) L.push(lum(x, y)); L.sort((a, b) => a - b); med.push(L[L.length >> 1]); }
  const m = med.slice().sort((a, b) => a - b)[med.length >> 1], lines = [];
  const peaks = []; for (let i = 4; i < med.length - 4; i++) if (med[i] >= 1.08 * m && med[i] === Math.max(...med.slice(i - 4, i + 5))) peaks.push(i);
  peaks.sort((a, b) => med[b] - med[a]).forEach(i => { if (lines.every(j => Math.abs(i - j) > 100)) lines.push(i); });   // strongest first, >= 100 px apart
  lines.sort((a, b) => a - b);
  const Yof = p => outBB.max[1] - (p - by0) / (by1 + 1 - by0) * outBB.size[1], Xof = p => outBB.min[0] + (p - bx0) / (bx1 + 1 - bx0) * outBB.size[0];
  return {linesY: lines.map(i => r3(Yof(gy0 + i))), glass: {xMin: r3(Xof(gx0)), xMax: r3(Xof(gx1 + 1)), yMin: r3(Yof(gy1 + 1)), yMax: r3(Yof(gy0))}};
}

// Re-dilation after repaint steps (iteration04): repaint steps write only texels covered by the selected faces; chart gutters keep the
// colour dilated from the ORIGINAL bake, which shows as lines along chart borders under filtering (many tiny charts on SV-invented sides).
// Rasterises the coverage of ALL low-poly faces per texture (texel centres inside a face) and re-runs the lib dilate() from the covered
// texels into every uncovered gutter texel (8 iterations). Covered texels are unchanged.
function redilate(low, baked) {
  for (const T of [baked.color, baked.mr, baked.normal]) {
    const S = T.size, mask = new Uint8Array(S * S), li = low.idx;
    for (let f = 0; f < li.length / 3; f++) {
      const vs = [li[3 * f], li[3 * f + 1], li[3 * f + 2]], U = vs.map(v => low.uv[2 * v] * S), V = vs.map(v => low.uv[2 * v + 1] * S);
      const xa = Math.max(0, Math.floor(Math.min(...U))), xb = Math.min(S - 1, Math.ceil(Math.max(...U))), ya = Math.max(0, Math.floor(Math.min(...V))), yb = Math.min(S - 1, Math.ceil(Math.max(...V)));
      const den = (V[1] - V[2]) * (U[0] - U[2]) + (U[2] - U[1]) * (V[0] - V[2]); if (Math.abs(den) < 1e-12) continue;
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const w0 = ((V[1] - V[2]) * (x + 0.5 - U[2]) + (U[2] - U[1]) * (y + 0.5 - V[2])) / den, w1 = ((V[2] - V[0]) * (x + 0.5 - U[2]) + (U[0] - U[2]) * (y + 0.5 - V[2])) / den, w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * S + x] = 1;
      }
    }
    let covered = 0; for (let i = 0; i < mask.length; i++) covered += mask[i];
    dilate(mask, [T.data], S, 8);
    T.redilate = {covered, size: S};
  }
  return {iterations: 8, coverage: [baked.color, baked.mr, baked.normal].map(T => ({size: T.size, coveredTexels: T.redilate.covered})),
    method: 'Coverage of all low-poly faces rasterised per texture (texel centres inside); lib/bake.mjs dilate() re-run from covered texels into uncovered gutter texels (8 iterations) so gutters follow the repainted colours.'};
}

async function buildMesh(cfg) {
  const t0 = Date.now();
  const src = verifiedSource(cfg.key);
  log(`\n== ${cfg.key} <- ${src.rel} (job ${src.jobId}, sha256 verified)`);
  const dense = await loadDense(src.file);
  const lev = levelRotation(dense.P, dense.I, cfg);
  const R = lev.R, det = det3(R);
  log('  level frame', JSON.stringify(lev.frame), 'det', det.toFixed(4));
  const bbR0 = bbox(transformPositions(dense.P, R));
  if (inspect) { log('  dense', dense.stats, 'levelled bbox size (source units)', vec(bbR0.size), 'ratios w/h d/h', r4(bbR0.size[0] / bbR0.size[1]), r4(bbR0.size[2] / bbR0.size[1])); return null; }
  const simp = await simplifyGeometry(dense, cfg.tris);
  log(`  simplified ${dense.stats.triangles} -> ${simp.idx.length / 3} tris`);
  const pad = cfg.atlas >= 1024 ? 4 : 3;
  const low = unwrap(simp.pos, simp.idx, {atlas: cfg.atlas, pad});
  const searchRadius = Math.max(0.02, 6 * simp.errorAbsolute);
  const baked = await bake(dense, low, {atlas: cfg.atlas, supersample: 2, mrDiv: cfg.mrDiv, normalDiv: cfg.normalDiv, searchRadius, log: s => log('   ', s)});
  const bbR = bbox(transformPositions(low.pos, R));
  const s = cfg.target.meters / bbR.size[cfg.target.axis];
  // Fit: uniform scale on the target axis, then (contract fit) per-axis factors toward the brief's dims when the reconstruction's
  // single-view proportions differ; bounded per axis relative to the uniform fit (FIT: x/y +-35%, depth z +-50%: straight-on inputs carry
  // no direct depth cue); outside the bound that axis is clamped to the bound (iteration03 left it uniform).
  const C = cfg.dims ?? M[cfg.key].targetRuntimeMeters, want = [C.w, C.h, C.d], B = [FIT.x, FIT.y, FIT.z];
  const uni = bbR.size.map(v => v * s);
  const S = [0, 1, 2].map(k => { const f = want[k] / uni[k]; return (k === 2 && cfg.depthFit) ? s : s * Math.min(B[k][1], Math.max(B[k][0], f)); });
  const fit = {mode: cfg.depthFit ? 'contract-fit x/y (per-axis toward the brief dims, clamped +-35% vs uniform); depth by the depth-band remap below (z uniform before it)' : 'contract-fit (per-axis toward the brief dims, clamped to x/y +-35%, z +-50% vs uniform)',
    bounds: FIT, ...(cfg.dims ? {dimsOverride: {manifestTarget: M[cfg.key].targetRuntimeMeters, used: cfg.dims, reason: cfg.dimsReason}} : {}), uniformScale: r6(s), uniformDims: vec(uni), perAxisScale: vec(S), relativeFactors: vec(S.map(v => v / s)), contract: C};
  const MS = R.map((row, k) => row.map(v => v * S[k]));
  const bbS = bbox(transformPositions(low.pos, MS));
  const t = [-bbS.center[0], -bbS.min[1], -bbS.center[2]];
  const pos0 = transformPositions(low.pos, MS, 1, t);
  // Auto protrusion for depthFit.protrusion === 'auto': the main front plane = the depth (from the front, 1 cm bins at uniform scale) holding the
  // most front-facing dense area within the front 30% of the depth; everything in front of it is a protrusion.
  let depthCfg = cfg.depthFit;
  if (depthCfg && depthCfg.protrusion === 'auto') {
    const DP0 = transformPositions(dense.P, MS, 1, t), zMax = bbox(DP0).max[2], Dz = bbox(DP0).size[2], h = new Map();
    for (let f = 0; f < dense.I.length / 3; f++) { const a = 3 * dense.I[3 * f], b = 3 * dense.I[3 * f + 1], c = 3 * dense.I[3 * f + 2];
      const ux = DP0[b] - DP0[a], uy = DP0[b + 1] - DP0[a + 1], uz = DP0[b + 2] - DP0[a + 2], vx = DP0[c] - DP0[a], vy = DP0[c + 1] - DP0[a + 1], vz = DP0[c + 2] - DP0[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (!l || nz / l < 0.85) continue;
      const dz = zMax - (DP0[a + 2] + DP0[b + 2] + DP0[c + 2]) / 3; if (dz > 0.3 * Dz) continue; const k = Math.floor(dz / 0.01); h.set(k, (h.get(k) ?? 0) + l / 2); }
    const kBest = [...h.entries()].sort((x, y) => y[1] - x[1])[0][0];
    depthCfg = {...depthCfg, protrusion: Math.max(0, kBest * 0.01 - 0.005)};
    log(`  main front plane ${r3(kBest * 0.01)} m behind the front-most point (uniform scale) -> protrusion ${r3(depthCfg.protrusion)} m compressed to ${depthCfg.protrusionTo} m`);
  }
  const depth = depthCfg ? depthRemap(bbox(pos0), C.d, depthCfg) : null;
  const place = P => (depth ? depth.apply(transformPositions(P, MS, 1, t)) : transformPositions(P, MS, 1, t));
  const pos = depth ? depth.apply(Float32Array.from(pos0)) : pos0;
  const nrm = transformPositions(low.nrm, R);
  for (let i = 0; i < nrm.length; i += 3) {
    const kz = depth ? depth.factorAt(pos0[i + 2]) : 1;
    nrm[i] /= S[0]; nrm[i + 1] /= S[1]; nrm[i + 2] /= S[2] * kz; const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  if (depth) { fit.depthRemap = depth.info; log('  depth remap', JSON.stringify(depth.info)); }
  const idx = Uint32Array.from(low.idx);
  if (det < 0) for (let f = 0; f < idx.length; f += 3) { const tmp = idx[f + 1]; idx[f + 1] = idx[f + 2]; idx[f + 2] = tmp; }
  const outBB = bbox(pos);
  const DPout = place(dense.P);   // dense mesh in output space (same transform + depth remap as the runtime mesh), for measurement/repaint
  const measurements = cfg.measure ? cfg.measure(DPout, dense.I, outBB) : null;
  let windowInfo = null;
  if (cfg.window) {
    windowInfo = windowRepaint(dense, DPout, low, pos, baked, cfg);
    if (measurements) { measurements.glassWindowFromPane = windowInfo.glassWindow; if (measurements.extras) measurements.extras.glass = windowInfo.glassWindow; }
  }
  const topInfo = cfg.topRepaint ? topRepaint(dense, DPout, low, pos, baked, {yMin: cfg.topRepaint.yMinFrac * outBB.size[1], minNy: cfg.topRepaint.minNy}) : null;
  const radialInfo = cfg.radialRepaint ? radialRepaint(dense, DPout, low, pos, baked, {yMin: cfg.radialRepaint.yMinFrac * outBB.size[1], yMax: cfg.radialRepaint.yMaxFrac * outBB.size[1], maxNy: cfg.radialRepaint.maxNy, cx: outBB.center[0], cz: outBB.center[2]}) : null;
  let paneInfo = null;
  if (cfg.paneProjection) {
    // pane plane = dominant front-facing depth layer of the dense output-space mesh in the central region (behind any protrusion)
    const h = new Map();
    for (let f = 0; f < dense.I.length / 3; f++) { const a = 3 * dense.I[3 * f], b = 3 * dense.I[3 * f + 1], c = 3 * dense.I[3 * f + 2];
      const ux = DPout[b] - DPout[a], uy = DPout[b + 1] - DPout[a + 1], uz = DPout[b + 2] - DPout[a + 2], vx = DPout[c] - DPout[a], vy = DPout[c + 1] - DPout[a + 1], vz = DPout[c + 2] - DPout[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (!l || nz / l < 0.85) continue;
      const cx = (DPout[a] + DPout[b] + DPout[c]) / 3, cy = (DPout[a + 1] + DPout[b + 1] + DPout[c + 1]) / 3, cz = (DPout[a + 2] + DPout[b + 2] + DPout[c + 2]) / 3;
      if (Math.abs(cx - outBB.center[0]) > 0.3 * outBB.size[0] || cy < 0.3 * outBB.size[1] || cy > 0.8 * outBB.size[1] || cz < outBB.center[2]) continue;   // front half only
      const k = Math.round((DPout[a + 2] + DPout[b + 2] + DPout[c + 2]) / 3 / 0.005); h.set(k, (h.get(k) ?? 0) + l / 2); }
    const paneZ = [...h.entries()].sort((x, y) => y[1] - x[1])[0][0] * 0.005;
    paneInfo = await paneProjection(src, low, pos, baked, outBB, {paneZ, ...cfg.paneProjection});
    if (measurements) { measurements.paneFromProjection = paneInfo.paneRect; if (cfg.shelfLines) { const sl = await shelfLinesFromImage(src, paneInfo.paneRect, outBB); measurements.visibleShelfLinesY = sl.linesY; measurements.glassFromImage = sl.glass; measurements.shelfLinesMethod = 'image-based: see shelfLinesFromImage (flat picture on the pane, not geometry)'; if (measurements.extras) { measurements.extras.visibleShelfLinesY = sl.linesY; measurements.extras.glass = sl.glass; } } }
  }
  const recolorInfo = cfg.recolor ? await recolorFaces(src, low, pos, baked, outBB, cfg.recolor) : null;
  const redilateInfo = (windowInfo || topInfo || radialInfo || paneInfo || recolorInfo) ? redilate(low, baked) : null;
  const color = await encodeImage(baked.color.data, baked.color.size, baked.color.size, 'color');
  const orm = await encodeImage(baked.mr.data, baked.mr.size, baked.mr.size, 'orm');
  const normal = await encodeImage(baked.normal.data, baked.normal.size, baked.normal.size, 'normal');
  const status = 'prototype runtime derivative of an unapproved AI-reconstructed master (iteration04 native F16 SV, straight-on input); reviewStatus unapproved; gameReady false; no license clearance';
  const glb = await writeMeshGlb({
    name: cfg.key, mesh: {pos, nrm, uv: low.uv, idx}, textures: {color, orm, normal}, material: dense.material, children: [],
    extras: {sourceId: `iteration04-${cfg.key}`, nativeJobId: src.jobId, sourceSha256: src.sha256, units: 'meters', provisionalDimensionsMeters: vec(outBB.size), status, pipeline: 'tools/asset-pipeline/props/build-props-iteration04.mjs', ...(measurements?.extras ?? {})},
  });
  const written = guardedWrite(path.join(OUT.models, FILES[cfg.key]), glb);
  log(`  wrote ${written.path} ${written.bytes} bytes, ${idx.length / 3} tris, size ${vec(outBB.size)} m (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (measurements) log('  measurements', JSON.stringify((({extras, method, ...m}) => m)(measurements)));
  return {
    output: written.path, key: cfg.key, modelKey: M[cfg.key].modelKey, displayName: M[cfg.key].displayName, kind: M[cfg.key].category, bytes: written.bytes, sha256: written.sha256, triangles: idx.length / 3, vertices: pos.length / 3,
    textures: {baseColor: {size: [baked.color.size, baked.color.size], mime: color.mime, bytes: color.bytes.length}, metallicRoughness: {size: [baked.mr.size, baked.mr.size], mime: orm.mime, bytes: orm.bytes.length}, normal: {size: [baked.normal.size, baked.normal.size], mime: normal.mime, bytes: normal.bytes.length}},
    source: {asset: cfg.key, preservedMaster: src.preserved, sha256: src.sha256, sha256Verified: true, bytes: src.bytes, nativeJobId: src.jobId, nativeReceipt: src.receipt, generationMode: 'local native F16 SV 1024, 24 steps/flow, seed 42, GSS 10, FoV 20 (straight-on input)', conditioningImage: src.conditioningImage, reviewStatus: 'unapproved', gameReady: false, triangles: dense.stats.triangles, vertices: dense.stats.vertices, textures: dense.material.textures},
    transform: {description: 'p_out = diag(perAxisScale) * R * p_source + translation (baked into vertices; node transform identity; normals use the inverse-transpose). R rows = output X,Y,Z axes in source coordinates.', levelFrame: lev.frame, R: R.map(r => r.map(r6)), determinant: Math.round(det), mirrored: det < 0, fit, translation: vec(t), orientationEvidence: cfg.orientationEvidence, origin: 'bottom centre (y=0 floor contact; x/z bbox centre)'},
    dimensionsMeters: {provisional: true, contract: M[cfg.key].targetRuntimeMeters, chosen: `${cfg.target.label} ${cfg.target.meters} m uniform, then bounded per-axis contract fit (relative factors ${fit.relativeFactors.map(v => v.toFixed(3)).join(' / ')} for x/y/z)`, bbox: {min: vec(outBB.min), max: vec(outBB.max), size: vec(outBB.size)}, measured: {w: r3(outBB.size[0]), h: r3(outBB.size[1]), d: r3(outBB.size[2])}},
    conventions: {units: 'meters', front: '+Z', up: '+Y', origin: 'bottom-center'},
    measurements: measurements ? (({extras, ...m}) => m)(measurements) : null,
    pipeline: [
      {step: 'verify-source', detail: 'sha256 of the uncompressed working copy == native controller receipt (== native metadata output sha256); the preserved master is the lossless asset.glb.xz in the generation folder; conditioning image = straight-on front elevation (user rule, iteration04)'},
      {step: 'level+orient', detail: lev.frame.method + '; up rule ' + cfg.up + ', front rule ' + cfg.front + ' (see orientationEvidence); uniform scale + bottom-centre origin baked into vertices'},
      {step: 'simplify', tool: 'meshoptimizer (Permissive, weld by position)', targetTriangles: cfg.tris, resultTriangles: idx.length / 3, errorMeters: r6(simp.errorAbsolute * s), errorNote: 'approximate (uniform-fit scale)'},
      {step: 'unwrap', tool: 'lib/unwrap.mjs', atlas: cfg.atlas, charts: low.stats.charts},
      {step: 'bake', tool: 'lib/bake.mjs (closest same-facing dense surface; colour, metallic-roughness, tangent normal)', supersample: 2, mrDiv: cfg.mrDiv, normalDiv: cfg.normalDiv, searchRadiusSourceUnits: r6(searchRadius), stats: {matchedSameFacing: baked.stats.matchedSameFacing, matchedFallbackAnyFacing: baked.stats.matchedFallbackAnyFacing, unmatched: baked.stats.unmatched}},
      ...(windowInfo ? [{step: 'window-repaint', ...windowInfo}] : []),
      ...(topInfo ? [{step: 'top-repaint', ...topInfo}] : []),
      ...(radialInfo ? [{step: 'radial-repaint', ...radialInfo}] : []),
      ...(paneInfo ? [{step: 'pane-projection', ...paneInfo}] : []),
      ...(recolorInfo ? [{step: 'recolour', ...recolorInfo}] : []),
      ...(redilateInfo ? [{step: 'redilate', ...redilateInfo}] : []),
      {step: 'encode', detail: 'baseColor JPEG, metallicRoughness JPEG, normal PNG; plain glTF 2.0 binary, no extensions'},
    ],
    limitations: [
      'Single-view AI reconstruction: back/underside/hidden surfaces and texture are inferred, not designed.',
      `Simplified from ${dense.stats.triangles} to ${idx.length / 3} triangles; thin parts lose geometric detail; fine relief approximated by the baked normal map.`,
      'Provisional real-world scale chosen by this pipeline (uniform fit on one axis plus a bounded per-axis fit to the brief dims; a straight-on single view carries no direct depth cue, so depth is the least reliable axis), not measured or approved.',
      'Prototype derivative: unapproved, gameReady false; no commercial/model license clearance asserted. Labels are fictional AI designs.',
      ...(cfg.limitations ?? []),
    ],
  };
}

const t0 = Date.now();
const manifestPath = path.join(OUT.derivatives, 'props-iteration04.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const outputs = [];
for (const cfg of ASSETS) {
  if (only && !only.includes(cfg.key)) { const prev = previous?.outputs?.find(o => o.key === cfg.key); if (prev) outputs.push(prev); continue; }
  const r = await buildMesh(cfg);
  if (r) outputs.push(r);
}
if (!inspect) {
  const manifest = {
    schema: 'last-line-props-derivatives-v1', task: 'studio-slice-iteration04-20261026-01',
    status: 'PROTOTYPE runtime derivatives of NEW iteration04 native F16 SV masters (trash can + modular shop building blocks) made from STRAIGHT-ON conditioning images. Unapproved, gameReady false, not production art, no license clearance asserted. Dimensions provisional.',
    rebuild: 'node tools/asset-pipeline/props/build-props-iteration04.mjs [--only key,key]',
    generationManifest: 'reference/tasks/vertical-slice-iteration04-20261026/generation/manifest.json',
    assembly: 'Shop components are building blocks (front +Z, origin bottom-centre, metres) to be assembled with procedurally authored shopfront frames, sign bands, menu boards and shutters (Lanes B/C); none is a whole shop.',
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: 'bottom-centre (y=0 floor contact)', files: 'plain glTF 2.0 binary, no extensions'},
    outputs,
    note: 'Native masters stay in reference/tasks/vertical-slice-iteration04-20261026/generation/<asset>/native/ (asset.glb.xz, lossless) and are never copied to game/public.',
  };
  guardedWrite(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  log(`\nwrote ${path.relative(REPO, manifestPath)} (${((Date.now() - t0) / 1000).toFixed(1)} s total)`);
}
