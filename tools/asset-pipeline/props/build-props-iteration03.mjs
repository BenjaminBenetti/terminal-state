#!/usr/bin/env node
// The Last Line - iteration03 runtime derivatives for the NEW generated masters (stall, vending, shelf, 7 consumable items).
// Usage: node tools/asset-pipeline/props/build-props-iteration03.mjs [--only shelf,water] [--inspect]
// Copied/adapted from build-props-iteration02.mjs (same verify -> level/orient -> simplify -> unwrap -> bake -> encode chain).
// Reads (read-only) the native F16 SV masters of reference/tasks/vertical-slice-iteration03-20261026/generation/<asset>/native/
// (sha256-verified against the controller receipt; uncompressed working copy in .cache/iteration03-native-masters/, restored from the
// preserved asset.glb.xz when missing) and writes ONLY game/public/assets/models/{stall,vending,shelf,item-*}.glb and
// game/public/assets/derivatives/props-iteration03.json. Prototype, unapproved, gameReady false.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadDense, simplifyGeometry, sha256File, sha256Buf} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake} from './lib/bake.mjs';
import {encodeImage, writeMeshGlb} from './lib/glb.mjs';
import {det3, transformPositions, bbox} from './lib/orient.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GEN = path.join(REPO, 'reference/tasks/vertical-slice-iteration03-20261026/generation');
const STAGE = path.join(REPO, '.cache/iteration03-native-masters');
const OUT = {models: path.join(REPO, 'game/public/assets/models'), derivatives: path.join(REPO, 'game/public/assets/derivatives')};
const FILES = {shelf: 'shelf.glb', vending: 'vending.glb', stall: 'stall.glb', water: 'item-water.glb', cola: 'item-cola.glb', juice: 'item-juice.glb',
  chocolate: 'item-chocolate.glb', chips: 'item-chips.glb', beans: 'item-beans.glb', noodles: 'item-noodles.glb'};
const OWNED = [...Object.values(FILES).map(f => path.join(OUT.models, f)), path.join(OUT.derivatives, 'props-iteration03.json')];
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
//  depth-axis  : the horizontal frame axis with the SMALLER extent (front = long face), e.g. shelf, stall, chips bag, chocolate bar
//  camera-left : the horizontal frame axis maximising (x - z) => the visible face on the image-LEFT (all iteration03 images show the
//                front face on the image left and a side face on the image right)
//  camera      : horizontal projection of the camera direction (rotationally symmetric cans/bottles/cups: label faces the camera)
function pickFront(rule, up, hz, P) {
  if (rule === 'camera') { const c = [0, 0, -1]; return norm(c.map((x, k) => x - dot(c, up) * up[k])); }
  const H = hz.map(towardCamera);
  if (rule === 'depth-axis') return extentAlong(P, H[0]) <= extentAlong(P, H[1]) ? H[0] : H[1];
  if (rule === 'camera-left') return (H[0][0] - H[0][2]) >= (H[1][0] - H[1][2]) ? H[0] : H[1];
  throw new Error(rule);
}
function levelRotation(P, I, cfg) {
  let axes, method;
  if (cfg.up === 'box') { axes = boxFrame(P, I); method = 'box frame (area-weighted dominant planar face normals)'; }
  else { axes = pcaFrame(P, I); method = 'area-weighted surface PCA'; }
  let upI;
  if (cfg.up === 'box') { upI = 0; axes.forEach((a, i) => { if (Math.abs(a.d[1]) > Math.abs(axes[upI].d[1])) upI = i; }); }
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
function upSurfaces(P, I, region, {minNy = 0.9, bin = 0.005, minFrac = 0.08} = {}) {
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
  for (const k of keys) { const last = clusters[clusters.length - 1]; if (last && k - last.k1 <= 2) { last.k1 = k; last.area += hist.get(k); last.sy += hist.get(k) * k * bin; } else clusters.push({k0: k, k1: k, area: hist.get(k), sy: hist.get(k) * k * bin}); }
  const big = clusters.filter(c => c.area >= minFrac * Math.max(...clusters.map(x => x.area)));
  return {totalArea: total, surfaces: big.map(c => ({y: r3(c.sy / c.area), yTop: r3(c.k1 * bin), yBottom: r3(c.k0 * bin), areaM2: r4(c.area)}))};
}

// Triangle budgets per the primary's on-screen counts (21-52 shelves, 10-20 stalls, dozens of items per station).
const ITEM_TEX = {tris: 1500, atlas: 512, mrDiv: 2, normalDiv: 4};
const PROP_TEX = {tris: 8000, atlas: 1024, mrDiv: 2, normalDiv: 2};
const ASSETS = [
  {key: 'shelf', ...PROP_TEX, tris: 2800, up: 'box', front: 'depth-axis', target: {axis: 1, meters: 1.85, label: 'height'},
    orientationEvidence: 'Levelled via the dominant box-face frame (deck tops / post faces); front (+Z) = the open long face (the horizontal axis with the smaller extent, signed toward the conditioning camera); the diagonal back brace ends up at -Z.'},
  {key: 'vending', ...PROP_TEX, normalDiv: 4, window: true, up: 'box', front: 'camera-left', target: {axis: 1, meters: 1.85, label: 'height'},
    orientationEvidence: 'Levelled via the dominant box-face frame; front (+Z) = the glass/control face, the visible face on the image left (the blue side panel is on the image right); X = Y x Z (no mirror), so the control column sits at +X seen from the front.'},
  {key: 'stall', ...PROP_TEX, tris: 5800, normalDiv: 4, up: 'box', front: 'depth-axis', target: {axis: 0, meters: 2.4, label: 'width'},
    orientationEvidence: 'Levelled via the dominant box-face frame (roof, counter top, walls); front (+Z) = the long counter/shutter face (horizontal axis with the smaller extent, signed toward the conditioning camera).'},
  {key: 'water', ...ITEM_TEX, tris: 1000, up: 'pca-long', front: 'camera', target: {axis: 1, meters: 0.23, label: 'height'},
    orientationEvidence: 'Up = longest surface PCA axis (bottle axis, cap at +Y); front (+Z) = horizontal projection of the conditioning-camera direction (label graphic faced the camera).'},
  {key: 'cola', ...ITEM_TEX, tris: 700, up: 'pca-long', front: 'camera', target: {axis: 1, meters: 0.122, label: 'height'},
    orientationEvidence: 'Up = longest surface PCA axis (can axis, pull-tab lid at +Y); front (+Z) = horizontal projection of the conditioning-camera direction (starburst emblem faced the camera).'},
  {key: 'juice', ...ITEM_TEX, tris: 700, up: 'box', front: 'camera-left', target: {axis: 1, meters: 0.195, label: 'height'},
    orientationEvidence: 'Levelled via the dominant box-face frame (carton panels); front (+Z) = the orange-slice panel, the visible face on the image left.'},
  {key: 'chocolate', ...ITEM_TEX, tris: 600, up: 'pca-short', front: 'depth-axis', target: {axis: 0, meters: 0.16, label: 'length'},
    orientationEvidence: 'Lying flat: up = thinnest surface PCA axis; length along X; front (+Z) = the long side that faced the conditioning camera.'},
  {key: 'chips', ...ITEM_TEX, tris: 1200, up: 'pca-long', front: 'depth-axis', target: {axis: 1, meters: 0.27, label: 'height'},
    orientationEvidence: 'Upright bag: up = longest surface PCA axis; front (+Z) = the bag face (thinnest horizontal axis) signed toward the conditioning camera.'},
  {key: 'beans', ...ITEM_TEX, tris: 700, up: 'pca-long', front: 'camera', target: {axis: 1, meters: 0.11, label: 'height'},
    orientationEvidence: 'Up = longest surface PCA axis (can axis); front (+Z) = horizontal projection of the conditioning-camera direction (label illustration faced the camera).'},
  {key: 'noodles', ...ITEM_TEX, tris: 900, up: 'box', front: 'camera', target: {axis: 1, meters: 0.105, label: 'height'},
    orientationEvidence: 'Up = box-frame axis nearest source +Y (the planar foil lid / cup base dominate the planar area); front (+Z) = horizontal projection of the conditioning-camera direction.'},
];
const CFG = Object.fromEntries(ASSETS.map(a => [a.key, a]));

CFG.shelf.measure = (DP, I, bb) => {
  const W = bb.size[0], D = bb.size[2], H = bb.size[1];
  const s = upSurfaces(DP, I, (x, y, z) => Math.abs(x - bb.center[0]) < 0.4 * W && Math.abs(z - bb.center[2]) < 0.35 * D, {minFrac: 0.15});
  const tiers = s.surfaces.map(t => ({...t, fractionOfHeight: r4(t.y / H)}));
  return {tierTopsY: tiers.map(t => t.y), tierTopsFraction: tiers.map(t => t.fractionOfHeight), tiers, usableDepthMeters: r3(D), usableWidthMeters: r3(W),
    method: 'Dense output-space faces with normal.y > 0.9 inside the central 80% x 70% of the footprint, area-weighted 5 mm height histogram; clusters >= 15% of the largest = deck top surfaces (y = area-weighted mean).',
    extras: {shelfTierY: tiers.map(t => t.y)}};
};
CFG.stall.measure = (DP, I, bb) => {
  const W = bb.size[0], D = bb.size[2], H = bb.size[1], zF = bb.max[2], zB = bb.min[2];
  const counter = upSurfaces(DP, I, (x, y, z) => z > zF - 0.45 * D && y > 0.5 && y < 1.5 && Math.abs(x - bb.center[0]) < 0.45 * W, {minFrac: 0.2});
  const top = counter.surfaces.sort((a, b) => b.areaM2 - a.areaM2)[0] ?? null;
  const back = upSurfaces(DP, I, (x, y, z) => z < zB + 0.45 * D && y > 0.15 && y < H - 0.25 && Math.abs(x - bb.center[0]) < 0.4 * W, {minFrac: 0.1});
  // merge back-zone clusters closer than 5 cm (area-weighted), then classify by height relative to the counter and the opening head
  const merged = [];
  for (const c of back.surfaces.slice().sort((a, b) => a.y - b.y)) { const l = merged[merged.length - 1]; if (l && c.y - l.y < 0.05) { const A = l.areaM2 + c.areaM2; l.y = r3((l.y * l.areaM2 + c.y * c.areaM2) / A); l.yTop = Math.max(l.yTop, c.yTop); l.yBottom = Math.min(l.yBottom, c.yBottom); l.areaM2 = r4(A); } else merged.push({...c}); }
  const cY = top?.y ?? 1.0, headY = 0.72 * H;
  const shelves = merged.filter(s => s.y > cY + 0.06 && s.y < headY);
  const below = merged.filter(s => s.y <= cY + 0.06), head = merged.filter(s => s.y >= headY);
  return {counterTopY: top?.y ?? null, counterTopMaxY: top?.yTop ?? null, counterSurface: top, backShelfY: shelves.map(s => s.y), backShelves: shelves,
    interiorBelowCounter: below, openingHeadOrShutterBox: head, footprint: {width: r3(W), depth: r3(D), height: r3(H)},
    method: 'Dense output-space faces with normal.y > 0.9; counter = largest horizontal cluster in the front 45% of the depth between 0.5 and 1.5 m; back-zone horizontal clusters in the back 45% (central 80% of width) merged within 5 cm and classified: back shelves = between counter + 6 cm and 72% of the height; below = interior floor / under-counter ledges; head = opening head / shutter box.',
    extras: {stallCounterY: top?.y ?? null, stallBackShelfY: shelves.map(s => s.y)}};
};
CFG.vending.measure = (DP, I, bb) => {
  // Front relief map (1 cm cells, outermost z per cell). The delivery flap is a shallow (~1 cm) recess below the glass window: cells
  // 5 mm..12 cm behind the 95th-percentile front frame plane, below 0.6 m, away from the side frame and the +X control column.
  const cell = 0.01, nx = Math.ceil(bb.size[0] / cell), ny = Math.ceil(bb.size[1] / cell), Z = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = 0; i < DP.length; i += 3) { const ix = Math.min(nx - 1, Math.floor((DP[i] - bb.min[0]) / cell)), iy = Math.min(ny - 1, Math.floor(DP[i + 1] / cell)); const k = iy * nx + ix; if (DP[i + 2] > Z[k]) Z[k] = DP[i + 2]; }
  const zs = [...Z].filter(Number.isFinite).sort((a, b) => a - b), zFrame = zs[Math.floor(0.95 * zs.length)];
  const x0c = Math.ceil(0.08 / cell), x1c = Math.floor(0.72 * nx), lower = [];
  for (let iy = 5; iy < 60; iy++) for (let ix = x0c; ix < x1c; ix++) if (Number.isFinite(Z[iy * nx + ix])) lower.push(Z[iy * nx + ix]);
  lower.sort((a, b) => a - b); const zRef = lower[Math.floor(0.75 * lower.length)];
  const fl = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, n: 0}, xs = [];
  for (let iy = 5; iy < 60; iy++) {
    const rec = []; for (let ix = x0c; ix < x1c; ix++) { const z = Z[iy * nx + ix]; if (Number.isFinite(z)) rec.push(zRef - z); }
    rec.sort((a, b) => a - b); if (!rec.length || rec[Math.floor(rec.length / 2)] < 0.007) continue;
    fl.n++; fl.y0 = Math.min(fl.y0, iy * cell); fl.y1 = Math.max(fl.y1, (iy + 1) * cell);
    for (let ix = x0c; ix < x1c; ix++) { const z = Z[iy * nx + ix]; if (Number.isFinite(z) && zRef - z >= 0.007) xs.push(bb.min[0] + (ix + 0.5) * cell); }
  }
  xs.sort((a, b) => a - b); if (xs.length) { fl.x0 = xs[Math.floor(0.03 * xs.length)] - cell / 2; fl.x1 = xs[Math.floor(0.97 * xs.length)] + cell / 2; }
  const flap = fl.n ? {xMin: r3(fl.x0), xMax: r3(fl.x1), yMin: r3(fl.y0), yMax: r3(fl.y1), recessedRows: fl.n, referenceZ: r3(zRef), note: 'shallow ~1 cm recess; approximate'} : null;
  return {frontFramePlaneZ: r3(zFrame), deliveryFlap: flap,
    method: 'Glass window: see the window-repaint pipeline step (glassWindowFromPane). Delivery flap: front relief map (1 cm cells, outermost z) of the dense output-space mesh between 0.05 and 0.6 m height, excluding the side frame and the +X control column; rows whose median recess vs the lower-front reference plane (75th percentile z) is >= 7 mm; x extent = 3rd-97th percentile of recessed cells. Geometry-only, approximate.',
    extras: {deliveryFlap: flap}};
};

// Per-asset limitations observed in the CPU QA renders (qa-artifacts/assets/props-iteration03/<key>-derived.png).
CFG.shelf.limitations = ['Simplified to ~2.7k triangles for 21-52 instances per station: the slotted angle posts are partly ragged/thinned; the reconstruction shows a slight (~2-3 deg) parallelogram shear in plan.', 'Depth (x0.70) and width (x0.84) were fitted to the 1.2 x 0.45 m contract from the single-view proportions (1.42 x 0.64 m at 1.85 m height).'];
CFG.vending.limitations = ['The native master modelled the product rows behind an opaque grey glass-pane surface; the window texels were repainted from an orthographic render of the dense interior (window-repaint step), so the products are a flat picture on the pane, not visible depth.', 'Delivery-flap measurement is approximate (only a ~1 cm recess in the reconstruction).', 'Back and right side inferred.'];
CFG.stall.limitations = ['Height stretched x1.30 relative to the uniform width fit (single-view reconstruction was 2.4 x 1.85 x 1.30 m with a 0.70 m counter); after the fit the counter top is 0.86-0.955 m (not perfectly flat) and the booth 2.4 m tall.', 'Roof/footprint slightly sheared; back wall and interior inferred; shutter is fixed geometry (not animated).'];
CFG.water.limitations = ['Clear bottle reconstructed as an opaque light-blue/white surface (no transparency); label graphic soft at 512 px.'];
CFG.cola.limitations = ['The reconstruction invented an illegible nutrition-style panel on the +X side (no real brand or legible text).'];
CFG.juice.limitations = ['Back panel inferred (repeated orange slice).'];
CFG.chocolate.limitations = ['Thickness fitted to 2 cm (x0.77 of the uniform fit).'];
CFG.chips.limitations = ['The printed chips illustration was reconstructed as ~2 cm of protruding relief on the front face; back panel inferred (beige).'];
CFG.beans.limitations = ['Back of the label inferred (repeated illustration).'];
CFG.noodles.limitations = ['Back of the cup inferred with illegible pseudo-text (no real brand).'];

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
  // Fit: uniform scale on the target axis, then (contract fit) per-axis factors toward the lane-contract dims when the reconstruction's
  // single-view proportions differ; bounded to +-35% per axis relative to the uniform fit, otherwise that axis stays uniform.
  const C = M[cfg.key].targetRuntimeMeters, want = [C.w, C.h, C.d];
  const uni = bbR.size.map(v => v * s);
  const S = [0, 1, 2].map(k => { const f = want[k] / uni[k]; return s * ((f >= 0.65 && f <= 1.35) ? f : 1); });
  const fit = {mode: 'contract-fit (per-axis, bounded +-35% vs uniform)', uniformScale: r6(s), uniformDims: vec(uni), perAxisScale: vec(S), relativeFactors: vec(S.map(v => v / s)), contract: C};
  const MS = R.map((row, k) => row.map(v => v * S[k]));
  const bbS = bbox(transformPositions(low.pos, MS));
  const t = [-bbS.center[0], -bbS.min[1], -bbS.center[2]];
  const pos = transformPositions(low.pos, MS, 1, t);
  const nrm = transformPositions(low.nrm, R);
  for (let i = 0; i < nrm.length; i += 3) { nrm[i] /= S[0]; nrm[i + 1] /= S[1]; nrm[i + 2] /= S[2]; const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  const idx = Uint32Array.from(low.idx);
  if (det < 0) for (let f = 0; f < idx.length; f += 3) { const tmp = idx[f + 1]; idx[f + 1] = idx[f + 2]; idx[f + 2] = tmp; }
  const outBB = bbox(pos);
  const measurements = cfg.measure ? cfg.measure(transformPositions(dense.P, MS, 1, t), dense.I, outBB) : null;
  let windowInfo = null;
  if (cfg.window) {
    windowInfo = windowRepaint(dense, transformPositions(dense.P, MS, 1, t), low, pos, baked, cfg);
    if (measurements) { measurements.glassWindowFromPane = windowInfo.glassWindow; if (measurements.extras) measurements.extras.glass = windowInfo.glassWindow; }
  }
  const color = await encodeImage(baked.color.data, baked.color.size, baked.color.size, 'color');
  const orm = await encodeImage(baked.mr.data, baked.mr.size, baked.mr.size, 'orm');
  const normal = await encodeImage(baked.normal.data, baked.normal.size, baked.normal.size, 'normal');
  const status = 'prototype runtime derivative of an unapproved AI-reconstructed master (iteration03 native F16 SV); reviewStatus unapproved; gameReady false; no license clearance';
  const glb = await writeMeshGlb({
    name: cfg.key, mesh: {pos, nrm, uv: low.uv, idx}, textures: {color, orm, normal}, material: dense.material, children: [],
    extras: {sourceId: `iteration03-${cfg.key}`, nativeJobId: src.jobId, sourceSha256: src.sha256, units: 'meters', provisionalDimensionsMeters: vec(outBB.size), status, pipeline: 'tools/asset-pipeline/props/build-props-iteration03.mjs', ...(measurements?.extras ?? {})},
  });
  const written = guardedWrite(path.join(OUT.models, FILES[cfg.key]), glb);
  log(`  wrote ${written.path} ${written.bytes} bytes, ${idx.length / 3} tris, size ${vec(outBB.size)} m (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (measurements) log('  measurements', JSON.stringify((({extras, method, ...m}) => m)(measurements)));
  return {
    output: written.path, key: cfg.key, modelKey: M[cfg.key].modelKey, displayName: M[cfg.key].displayName, kind: M[cfg.key].category === 'prop' ? 'prop' : 'item', bytes: written.bytes, sha256: written.sha256, triangles: idx.length / 3, vertices: pos.length / 3,
    textures: {baseColor: {size: [baked.color.size, baked.color.size], mime: color.mime, bytes: color.bytes.length}, metallicRoughness: {size: [baked.mr.size, baked.mr.size], mime: orm.mime, bytes: orm.bytes.length}, normal: {size: [baked.normal.size, baked.normal.size], mime: normal.mime, bytes: normal.bytes.length}},
    source: {asset: cfg.key, preservedMaster: src.preserved, sha256: src.sha256, sha256Verified: true, bytes: src.bytes, nativeJobId: src.jobId, nativeReceipt: src.receipt, generationMode: 'local native F16 SV 1024, 24 steps/flow, seed 42, GSS 10, FoV 20', conditioningImage: src.conditioningImage, reviewStatus: 'unapproved', gameReady: false, triangles: dense.stats.triangles, vertices: dense.stats.vertices, textures: dense.material.textures},
    transform: {description: 'p_out = diag(perAxisScale) * R * p_source + translation (baked into vertices; node transform identity; normals use the inverse-transpose). R rows = output X,Y,Z axes in source coordinates.', levelFrame: lev.frame, R: R.map(r => r.map(r6)), determinant: Math.round(det), mirrored: det < 0, fit, translation: vec(t), orientationEvidence: cfg.orientationEvidence, origin: 'bottom centre (y=0 floor contact; x/z bbox centre)'},
    dimensionsMeters: {provisional: true, contract: M[cfg.key].targetRuntimeMeters, chosen: `${cfg.target.label} ${cfg.target.meters} m uniform, then bounded per-axis contract fit (relative factors ${fit.relativeFactors.map(v => v.toFixed(3)).join(' / ')} for x/y/z)`, bbox: {min: vec(outBB.min), max: vec(outBB.max), size: vec(outBB.size)}, measured: {w: r3(outBB.size[0]), h: r3(outBB.size[1]), d: r3(outBB.size[2])}},
    conventions: {units: 'meters', front: '+Z', up: '+Y', origin: 'bottom-center'},
    measurements: measurements ? (({extras, ...m}) => m)(measurements) : null,
    pipeline: [
      {step: 'verify-source', detail: 'sha256 of the uncompressed working copy == native controller receipt (== native metadata output sha256); the preserved master is the lossless asset.glb.xz in the generation folder'},
      {step: 'level+orient', detail: lev.frame.method + '; up rule ' + cfg.up + ', front rule ' + cfg.front + ' (see orientationEvidence); uniform scale + bottom-centre origin baked into vertices'},
      {step: 'simplify', tool: 'meshoptimizer (Permissive, weld by position)', targetTriangles: cfg.tris, resultTriangles: idx.length / 3, errorMeters: r6(simp.errorAbsolute * s), errorNote: 'approximate (uniform-fit scale)'},
      {step: 'unwrap', tool: 'lib/unwrap.mjs', atlas: cfg.atlas, charts: low.stats.charts},
      {step: 'bake', tool: 'lib/bake.mjs (closest same-facing dense surface; colour, metallic-roughness, tangent normal)', supersample: 2, mrDiv: cfg.mrDiv, normalDiv: cfg.normalDiv, searchRadiusSourceUnits: r6(searchRadius), stats: {matchedSameFacing: baked.stats.matchedSameFacing, matchedFallbackAnyFacing: baked.stats.matchedFallbackAnyFacing, unmatched: baked.stats.unmatched}},
      ...(windowInfo ? [{step: 'window-repaint', ...windowInfo}] : []),
      {step: 'encode', detail: 'baseColor JPEG, metallicRoughness JPEG, normal PNG; plain glTF 2.0 binary, no extensions'},
    ],
    limitations: [
      'Single-view AI reconstruction: back/underside/hidden surfaces and texture are inferred, not designed.',
      `Simplified from ${dense.stats.triangles} to ${idx.length / 3} triangles; thin parts lose geometric detail; fine relief approximated by the baked normal map.`,
      'Provisional real-world scale chosen by this pipeline (uniform fit on one axis plus a bounded per-axis fit to the provisional lane-contract dims; single-view depth is the least reliable axis), not measured or approved.',
      'Prototype derivative: unapproved, gameReady false; no commercial/model license clearance asserted. Labels are fictional AI designs.',
      ...(cfg.limitations ?? []),
    ],
  };
}

const t0 = Date.now();
const manifestPath = path.join(OUT.derivatives, 'props-iteration03.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const outputs = [];
for (const cfg of ASSETS) {
  if (only && !only.includes(cfg.key)) { const prev = previous?.outputs?.find(o => o.key === cfg.key); if (prev) outputs.push(prev); continue; }
  const r = await buildMesh(cfg);
  if (r) outputs.push(r);
}
if (!inspect) {
  const manifest = {
    schema: 'last-line-props-derivatives-v1', task: 'studio-slice-iteration03-20261026-01',
    status: 'PROTOTYPE runtime derivatives of NEW iteration03 native F16 SV masters (stall, vending, shelf, 7 consumables). Unapproved, gameReady false, not production art, no license clearance asserted. Dimensions provisional.',
    rebuild: 'node tools/asset-pipeline/props/build-props-iteration03.mjs [--only key,key]',
    generationManifest: 'reference/tasks/vertical-slice-iteration03-20261026/generation/manifest.json',
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: 'bottom-centre (y=0 floor contact)', files: 'plain glTF 2.0 binary, no extensions'},
    outputs,
    note: 'Native masters stay in reference/tasks/vertical-slice-iteration03-20261026/generation/<asset>/native/ (asset.glb.xz, lossless) and are never copied to game/public.',
  };
  guardedWrite(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  log(`\nwrote ${path.relative(REPO, manifestPath)} (${((Date.now() - t0) / 1000).toFixed(1)} s total)`);
}
