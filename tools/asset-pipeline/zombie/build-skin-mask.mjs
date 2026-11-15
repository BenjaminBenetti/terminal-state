// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane MASK): the irradiated zombies' SKIN MASK, a DATA texture (root CLAUDE.md
// "Textures": data textures such as masks are exempt; "processing is not authoring"). Deterministic PROCESSING of the already-shipped
// ordinary zombie bodies: no image or model generation, nothing hand-drawn, the source GLBs are only read.
//
// For each of the 9 ordinary bodies (game/src/ai/outfits.ts ZOMBIE_BODIES; one `ZombieBody` mesh, one material, one 1024² baked
// base-colour atlas that also carries baked clothing, hair, eyes and - on the scavenger - its gas mask and straps) it classifies the
// exposed-SKIN texels in UV space (the mesh's own TEXCOORD_0, glTF convention: v down the image, flipY = false):
//   1. rasterise every triangle into the 1024² UV grid (texel -> triangle + barycentrics; triangles -> UV islands by shared vertices);
//   2. a skinning-weight REGION PRIOR per texel (head / neck / chest / spine / pelvis / upperArm / forearm / hand / thigh / shin / foot,
//      interpolated from the vertex weights) times a per-body allowance (0 = never skin: shoes, socks, the scavenger's gas-mask head);
//   3. a per-body COLOUR model in CIE Lab: a skin Gaussian learned from seed regions (robust median/MAD then Mahalanobis trim) against
//      a k-means mixture of every other colour of that atlas (clusters near the skin model are dropped as skin); the per-texel skin
//      posterior combines the two likelihoods with the region prior;
//   4. spatial clean-up INSIDE each UV island only (never across islands): Gaussian smoothing, threshold, removal of tiny skin specks,
//      filling of small enclosed holes (stubble, wounds), tiny-island majority, optional removal of skin-coloured prints enclosed in cloth;
//   5. a ~1 px feather at 512 (blur at 1024 inside the island + coverage-normalised 2x2 downsample), then dilation of every island's
//      values into the empty UV gutters (nearest covered texel, max GUTTER px) - never over another island's texels.
//
// Output (deterministic; same inputs -> same bytes):
//   game/public/assets/textures/zombie-skin-mask.png      1024 x 1024 RGB (linear data, NOT sRGB colour), 2 x 2 tiles of 512²; each body is
//                                                         one channel of one tile (alpha deliberately unused: browsers may premultiply an
//                                                         alpha channel and wipe the other channels where it is 0)
//   game/src/assets/zombieSkinMask.generated.ts           url / size / tile / per-body slot {tile: [col, row], channel} / coverage
//   game/public/assets/derivatives/zombie-skin-mask.json  provenance: input GLB + embedded base-colour sha256s, per-body parameters,
//                                                         output sha256 / bytes, coverage, limits
//   --qa[=<dir>]  review images (NOT in Git): per body the atlas with the mask in green + CPU 3D views, and a contact sheet
//                 (default dir: reference/tasks/reactor-glowing-zombies-20261115-013245/qa/mask under the main checkout)
//   --check       rebuild in memory and fail if any committed output differs
//
// Usage: node tools/asset-pipeline/zombie/build-skin-mask.mjs [--qa[=<dir>]] [--check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Canvas} from './lib/raster.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-reactor-glowing-zombies-20261115-013245-01';
const LANE = 'MASK';
const PUB = path.join(ROOT, 'game/public');
const PNG_REL = 'assets/textures/zombie-skin-mask.png';
const PROV_REL = 'assets/derivatives/zombie-skin-mask.json';
const TS_REL = 'game/src/assets/zombieSkinMask.generated.ts';
const SCRIPT_REL = 'tools/asset-pipeline/zombie/build-skin-mask.mjs';
const QA_REL = 'reference/tasks/reactor-glowing-zombies-20261115-013245/qa/mask';
/** The task's external reference/ mount above this checkout (worktrees sit below the main checkout), else the ignored qa-artifacts/. */
function qaDefault() {
  for (let d = ROOT, i = 0; i < 6; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, QA_REL, '../..'))) return path.join(d, QA_REL);
  return path.join(ROOT, 'qa-artifacts/zombie-skin-mask');
}

const SIZE = 1024; // packed atlas
const TILE = 512; // one body's mask resolution
const WORK = 1024; // classification grid (= the base-colour atlas resolution)
const GUTTER = 4; // px at 512: dilation of island values into empty UV gutters
const TINY_ISLAND = 40; // px at 1024: islands this small take their majority value
const ENCLOSED = 0.75; // a skin component whose outline touches non-skin of its own island for >= this share is "enclosed" (enclosedMax)
const KMEANS_K = 12;
const KMEANS_SAMPLES = 40000;
const KMEANS_ITERS = 30;

const CHECK = process.argv.includes('--check');
const qaArg = process.argv.find(a => a === '--qa' || a.startsWith('--qa='));
const QA_DIR = qaArg ? (qaArg.includes('=') ? path.resolve(qaArg.slice(5)) : qaDefault()) : null;

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { console.error(`build-skin-mask: ${m}`); process.exit(1); };

// ---------- regions (skinning-weight prior) ----------
const REGIONS = ['head', 'neck', 'chest', 'spine', 'pelvis', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
const R = REGIONS.length;
const JOINT_REGION = {
  Root: 'pelvis', Hips: 'pelvis', Spine: 'spine', Chest: 'chest', Neck: 'neck', Head: 'head',
  L_UpperArm: 'upperArm', R_UpperArm: 'upperArm', L_Forearm: 'forearm', R_Forearm: 'forearm', L_Hand: 'hand', R_Hand: 'hand',
  L_Thigh: 'thigh', R_Thigh: 'thigh', L_Shin: 'shin', R_Shin: 'shin', L_Foot: 'foot', R_Foot: 'foot',
};

// ---------- the bodies (ZOMBIE_BODIES order) and their per-body parameters ----------
// slot: tile index t -> [col, row] = [t % 2, t / 2 | 0]; channel 0..2 (R, G, B). 3 tiles x 3 channels = 9 bodies; tile 3 is free.
// Parameters (defaults in DEFAULTS):
//   seed      regions whose texels (region weight > 0.8) seed the skin colour model
//   allow     region prior multipliers (default 1; 0 = never skin)
//   prior     base skin prior of the posterior
//   dMax      Mahalanobis distance from the skin model beyond which a texel cannot be skin
//   lStretch  scale of the skin model's lightness axis (baked shading varies lightness more than hue)
//   drop      clusters of the "everything else" mixture whose mean lies within this distance of the skin model are skin, not competitors
//   minSkin / maxHole  px at 1024: smallest kept skin component / largest filled enclosed non-skin hole (eyes are larger and stay out)
//   facing    {region: z}: that region may be skin only where the surface faces forward (bind-pose normal z above ~z)
//   xMax      {region: m}: that region may be skin only within |x| <= m of the bind-pose centre line (an open jacket front)
//   abFloor   variance floor of the skin model's a / b axes (widens a too-uniform seed tone to its shaded / stubbled parts)
//   enclosedMax  px at 1024: skin components enclosed (ENCLOSED share of their outline) by non-skin inside one island, at most this big, are dropped
//                (skin-coloured blood stains printed on baked cloth); 0 = off
const DEFAULTS = {seed: ['forearm', 'hand'], allow: {}, prior: 0.5, dMax: 3.6, lStretch: 1.6, drop: 2.2, minSkin: 24, maxHole: 64, facing: {}, xMax: {}, abFloor: 1, enclosedMax: 0};
const BODIES = [
  {id: 'lastshift', glb: 'assets/models/zombie-body-lastshift-t25.glb', tile: 0, channel: 0, why: {
    allow: 'boots + socks on the feet; grey tee and denim cargo shorts are told apart by colour',
    enclosedMax: 'a tan repair patch printed on the cargo shorts matches the skin tone; it sits enclosed in the denim',
  }, params: {allow: {foot: 0}, enclosedMax: 800}},
  {id: 'courier', glb: 'assets/models/zombie-body-courier-t25.glb', tile: 0, channel: 1, why: {
    allow: 'full-length jeans and sneakers: legs / pelvis / feet are never skin (rips are too small to matter)',
    enclosedMax: 'dark-red blood stains printed on the white tank top match the wounded skin tone; they sit enclosed in the cloth',
  }, params: {allow: {pelvis: 0, thigh: 0, shin: 0, foot: 0}, enclosedMax: 6000}},
  {id: 'agent', glb: 'assets/models/zombie-body-agent-t25.glb', tile: 0, channel: 2, why: {
    allow: 'uniform trousers and shoes: legs / pelvis / feet are never skin',
  }, params: {allow: {pelvis: 0, thigh: 0, shin: 0, foot: 0}}},
  {id: 'scavenger', glb: 'assets/models/zombie-body-scavenger-t25.glb', tile: 1, channel: 0, why: {
    seed: 'only the bare hands are reliably skin (sleeves cover the forearms)',
    allow: 'built-in gas mask + hood on the head, jacket sleeves / trousers / boots everywhere else: only the hands and the open throat / chest',
    facing: 'the jacket back, collar and the mask straps behind the neck share the skin tone: neck / chest / belly count only where they face forward',
    xMax: 'the open jacket front: its lapels are as pink-brown as the skin, so the torso counts only between them (|x| <= 8.5 cm)',
    maxHole: 'the throat / chest skin is mottled with dark veins: fill them; the eyes are behind the mask anyway',
  }, params: {seed: ['hand'], allow: {head: 0, pelvis: 0, upperArm: 0, forearm: 0, thigh: 0, shin: 0, foot: 0}, facing: {neck: 0.3, chest: 0.6, spine: 0.6}, xMax: {neck: 0.08, chest: 0.085, spine: 0.085}, maxHole: 400}},
  {id: 'heavyset', glb: 'assets/models/zombie-body-heavyset-t25.glb', tile: 1, channel: 1, why: {
    seed: 'forearms and hands share the one brown skin tone',
    allow: 'dark socks on the feet; grey tank top / dark trunks are told apart by colour',
    abFloor: 'the shaved scalp and knees are darker / less saturated than the forearms: widen the hue tolerance',
    maxHole: 'bruises on the knees and scalp stubble patches are skin; the eyes are larger',
  }, params: {seed: ['forearm', 'hand'], allow: {foot: 0}, abFloor: 4, maxHole: 200}},
  {id: 'tall', glb: 'assets/models/zombie-body-tall-t25.glb', tile: 1, channel: 2, why: {
    allow: 'grey socks on the feet; grey tee / black shorts are told apart by colour',
  }, params: {allow: {foot: 0}}},
  {id: 'paleGaze', glb: 'assets/models/zombie-body-pale-gaze-t25.glb', tile: 2, channel: 0, why: {
    seed: 'nude: arms and legs seed the pale skin model',
    abFloor: 'the grey-beige limbs give a very tight hue model; the pinker fingertips / claws and lips-adjacent skin need a wider one',
  }, params: {seed: ['forearm', 'hand', 'thigh', 'shin'], abFloor: 3}},
  {id: 'paleRevenant', glb: 'assets/models/zombie-body-pale-revenant-t25.glb', tile: 2, channel: 1, why: {
    seed: 'nude: arms and legs seed the pale skin model',
  }, params: {seed: ['forearm', 'hand', 'thigh', 'shin']}},
  {id: 'paleApparition', glb: 'assets/models/zombie-body-pale-apparition-t25.glb', tile: 2, channel: 2, why: {
    seed: 'nude: arms and legs seed the pale skin model',
  }, params: {seed: ['forearm', 'hand', 'thigh', 'shin']}},
];
const tileColRow = t => [t % 2, (t / 2) | 0];

// ---------- colour ----------
const S2L = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
function rgbToLab(r, g, b, out, o) {
  const R_ = S2L[r], G_ = S2L[g], B_ = S2L[b];
  const X = (0.4124564 * R_ + 0.3575761 * G_ + 0.1804375 * B_) / 0.95047;
  const Y = 0.2126729 * R_ + 0.7151522 * G_ + 0.0721750 * B_;
  const Z = (0.0193339 * R_ + 0.1191920 * G_ + 0.9503041 * B_) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
}

// ---------- small linear algebra (3x3 symmetric) ----------
function meanCov(lab, list, wts = null) {
  let sw = 0; const m = [0, 0, 0];
  for (let i = 0; i < list.length; i++) { const o = list[i] * 3, w = wts ? wts[i] : 1; sw += w; for (let k = 0; k < 3; k++) m[k] += w * lab[o + k]; }
  for (let k = 0; k < 3; k++) m[k] /= sw || 1;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < list.length; i++) {
    const o = list[i] * 3, w = wts ? wts[i] : 1, d = [lab[o] - m[0], lab[o + 1] - m[1], lab[o + 2] - m[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += w * d[a] * d[b];
  }
  for (let k = 0; k < 9; k++) c[k] /= sw || 1;
  return {mean: m, cov: c, n: list.length};
}
function inv3(c) {
  const [a, b, cc, d, e, f, g, h, i] = c;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + cc * C;
  const inv = [A, -(b * i - cc * h), b * f - cc * e, B, a * i - cc * g, -(a * f - cc * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  return {inv, det};
}
function gaussian(mean, cov, floor = [4, 1, 1]) {
  const c = cov.slice();
  c[0] += floor[0]; c[4] += floor[1]; c[8] += floor[2];
  const {inv, det} = inv3(c);
  return {mean, cov: c, inv, logNorm: -0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI)};
}
function maha2(G, x0, x1, x2) {
  const d0 = x0 - G.mean[0], d1 = x1 - G.mean[1], d2 = x2 - G.mean[2], I = G.inv;
  return d0 * (I[0] * d0 + I[1] * d1 + I[2] * d2) + d1 * (I[3] * d0 + I[4] * d1 + I[5] * d2) + d2 * (I[6] * d0 + I[7] * d1 + I[8] * d2);
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function median(arr) { const s = Float64Array.from(arr).sort(); return s.length ? s[s.length >> 1] : 0; }

// ---------- load ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function loadBody(b) {
  const file = path.join(PUB, b.glb);
  if (!fs.existsSync(file)) fail(`missing ${b.glb}`);
  const bytes = fs.readFileSync(file);
  const doc = await io.read(file);
  const meshes = doc.getRoot().listMeshes();
  const mesh = meshes.find(m => m.getName() === 'ZombieBody');
  if (!mesh || meshes.length !== 1 || mesh.listPrimitives().length !== 1) fail(`${b.id}: expected exactly one ZombieBody mesh with one primitive`);
  const prim = mesh.listPrimitives()[0];
  const mat = prim.getMaterial();
  const info = mat.getBaseColorTextureInfo();
  if (!info || info.getTexCoord() !== 0) fail(`${b.id}: base colour must use TEXCOORD_0`);
  const img = Buffer.from(mat.getBaseColorTexture().getImage());
  const raw = await sharp(img).removeAlpha().raw().toBuffer({resolveWithObject: true});
  if (raw.info.width !== WORK || raw.info.height !== WORK) fail(`${b.id}: base colour is ${raw.info.width}x${raw.info.height}, expected ${WORK}²`);
  const P = prim.getAttribute('POSITION'), UV = prim.getAttribute('TEXCOORD_0'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const NR = prim.getAttribute('NORMAL');
  const n = P.getCount();
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), reg = new Float32Array(n * R);
  const skin = doc.getRoot().listSkins()[0];
  const jointRegion = skin.listJoints().map(j => { const r = JOINT_REGION[j.getName()]; if (!r) fail(`${b.id}: unmapped joint ${j.getName()}`); return REGIONS.indexOf(r); });
  const e = [], je = [], we = [];
  for (let i = 0; i < n; i++) {
    P.getElement(i, e); pos.set(e, i * 3);
    NR.getElement(i, e); nrm.set(e, i * 3);
    UV.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1];
    J.getElement(i, je); W.getElement(i, we);
    let s = 0;
    for (let k = 0; k < 4; k++) s += we[k];
    for (let k = 0; k < 4; k++) if (we[k] > 0) reg[i * R + jointRegion[je[k]]] += we[k] / (s || 1);
  }
  const idx = Uint32Array.from(prim.getIndices().getArray());
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { yMin = Math.min(yMin, pos[i]); yMax = Math.max(yMax, pos[i]); }
  const uvMin = [Infinity, Infinity], uvMax = [-Infinity, -Infinity];
  for (let i = 0; i < uv.length; i++) { uvMin[i & 1] = Math.min(uvMin[i & 1], uv[i]); uvMax[i & 1] = Math.max(uvMax[i & 1], uv[i]); }
  // the shader maps uv into one tile (tileOffset + uv * 0.5): UVs outside [0, 1] would sample another body's tile
  if (uvMin[0] < 0 || uvMin[1] < 0 || uvMax[0] > 1 || uvMax[1] > 1) fail(`${b.id}: TEXCOORD_0 leaves [0, 1] (${uvMin} .. ${uvMax})`);
  return {b, glbSha: sha(bytes), glbBytes: bytes.length, atlasSha: sha(img), atlas: raw.data, pos, nrm, uv, reg, idx, n, yMin, yMax, uvMin, uvMax};
}

// ---------- UV raster + islands ----------
function rasterise(body) {
  const {uv, idx} = body, N = WORK * WORK;
  const tri = new Int32Array(N).fill(-1), b0 = new Float32Array(N), b1 = new Float32Array(N);
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = uv[a * 2] * WORK, ay = uv[a * 2 + 1] * WORK, bx = uv[b * 2] * WORK, by = uv[b * 2 + 1] * WORK, cx = uv[c * 2] * WORK, cy = uv[c * 2 + 1] * WORK;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(WORK - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(WORK - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area;
      const w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const o = y * WORK + x;
      tri[o] = t; b0[o] = w0; b1[o] = w1;
    }
  }
  // islands: union-find over vertices joined by triangles (Meshy splits vertices at UV seams) and by identical UVs
  const parent = new Int32Array(body.n).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let t = 0; t < idx.length; t += 3) { unite(idx[t], idx[t + 1]); unite(idx[t], idx[t + 2]); }
  const byUv = new Map();
  for (let i = 0; i < body.n; i++) {
    const k = `${Math.round(uv[i * 2] * 1e6)},${Math.round(uv[i * 2 + 1] * 1e6)}`;
    const j = byUv.get(k);
    if (j === undefined) byUv.set(k, i); else unite(i, j);
  }
  const islandOfRoot = new Map();
  const triIsland = new Int32Array(idx.length / 3);
  for (let t = 0; t < triIsland.length; t++) {
    const r = find(idx[t * 3]);
    if (!islandOfRoot.has(r)) islandOfRoot.set(r, islandOfRoot.size);
    triIsland[t] = islandOfRoot.get(r);
  }
  const island = new Int32Array(N).fill(-1);
  for (let o = 0; o < N; o++) if (tri[o] >= 0) island[o] = triIsland[tri[o]];
  return {tri, b0, b1, island, islands: islandOfRoot.size};
}

/** Interpolated per-texel attribute (vertex array with `dim` components) */
function texelAttr(body, ras, o, arr, dim, k) {
  const t = ras.tri[o], i = body.idx;
  const w0 = ras.b0[o], w1 = ras.b1[o], w2 = 1 - w0 - w1;
  return w0 * arr[i[t * 3] * dim + k] + w1 * arr[i[t * 3 + 1] * dim + k] + w2 * arr[i[t * 3 + 2] * dim + k];
}

// ---------- classification ----------
function classify(body, ras, p) {
  const N = WORK * WORK, {atlas} = body;
  const covered = [];
  for (let o = 0; o < N; o++) if (ras.tri[o] >= 0) covered.push(o);
  const lab = new Float32Array(N * 3);
  for (const o of covered) rgbToLab(atlas[o * 3], atlas[o * 3 + 1], atlas[o * 3 + 2], lab, o * 3);
  // region prior per texel
  const allow = REGIONS.map(r => p.allow[r] ?? 1);
  const seedSet = p.seed.map(r => REGIONS.indexOf(r));
  const prior = new Float32Array(N), seeds = [];
  const facing = REGIONS.map(r => p.facing[r]), xMax = REGIONS.map(r => p.xMax[r]);
  const anyFacing = facing.some(f => f !== undefined), anyX = xMax.some(f => f !== undefined);
  for (const o of covered) {
    let a = 0, s = 0, nz = 0, ax = 0;
    if (anyFacing) {
      const nx = texelAttr(body, ras, o, body.nrm, 3, 0), ny = texelAttr(body, ras, o, body.nrm, 3, 1), nz0 = texelAttr(body, ras, o, body.nrm, 3, 2);
      nz = nz0 / (Math.hypot(nx, ny, nz0) || 1);
    }
    if (anyX) ax = Math.abs(texelAttr(body, ras, o, body.pos, 3, 0));
    for (let r = 0; r < R; r++) {
      const w = texelAttr(body, ras, o, body.reg, R, r);
      let al = allow[r];
      if (facing[r] !== undefined) al *= Math.min(1, Math.max(0, (nz - facing[r] + 0.2) / 0.4));
      if (xMax[r] !== undefined) al *= Math.min(1, Math.max(0, (xMax[r] + 0.01 - ax) / 0.02));
      a += w * al;
      if (seedSet.includes(r)) s += w;
    }
    prior[o] = a;
    if (s > 0.8 && a > 0.5) seeds.push(o);
  }
  if (seeds.length < 500) fail(`${body.b.id}: only ${seeds.length} skin seed texels`);
  // robust skin model: per-channel median / MAD trim, then two Mahalanobis trims
  const ch = k => seeds.map(o => lab[o * 3 + k]);
  const med = [0, 1, 2].map(k => median(ch(k)));
  const mad = [0, 1, 2].map(k => median(ch(k).map(v => Math.abs(v - med[k]))) * 1.4826 + 1e-3);
  let kept = seeds.filter(o => [0, 1, 2].every(k => Math.abs(lab[o * 3 + k] - med[k]) < 2.5 * mad[k]));
  let mc = meanCov(lab, kept), G = gaussian(mc.mean, mc.cov);
  for (let it = 0; it < 2; it++) {
    kept = seeds.filter(o => maha2(G, lab[o * 3], lab[o * 3 + 1], lab[o * 3 + 2]) < 9);
    mc = meanCov(lab, kept); G = gaussian(mc.mean, mc.cov);
  }
  // stretch the lightness axis (baked shading) of the final skin model
  const S = [p.lStretch, 1, 1], cs = mc.cov.map((v, i) => v * S[(i / 3) | 0] * S[i % 3]);
  const skinG = gaussian(mc.mean, cs, [4, p.abFloor, p.abFloor]);
  // "everything else": k-means over all covered texels (deterministic sample), skin-like clusters dropped
  const rnd = mulberry32(0x5eed ^ body.b.id.length * 7919);
  const sample = [];
  for (let i = 0; i < Math.min(KMEANS_SAMPLES, covered.length); i++) sample.push(covered[Math.floor(rnd() * covered.length)]);
  const first = sample[Math.floor(rnd() * sample.length)];
  const dist = new Float64Array(sample.length).fill(Infinity);
  const cent = [[...lab.subarray(first * 3, first * 3 + 3)]];
  while (cent.length < KMEANS_K) { // k-means++
    let tot = 0;
    const c = cent[cent.length - 1];
    for (let i = 0; i < sample.length; i++) {
      const o = sample[i] * 3, d = (lab[o] - c[0]) ** 2 + (lab[o + 1] - c[1]) ** 2 + (lab[o + 2] - c[2]) ** 2;
      if (d < dist[i]) dist[i] = d;
      tot += dist[i];
    }
    let r = rnd() * tot, pick = 0;
    for (let i = 0; i < sample.length; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
    cent.push([...lab.subarray(sample[pick] * 3, sample[pick] * 3 + 3)]);
  }
  const assign = new Int32Array(sample.length);
  for (let it = 0; it < KMEANS_ITERS; it++) {
    for (let i = 0; i < sample.length; i++) {
      const o = sample[i] * 3;
      let best = 0, bd = Infinity;
      for (let k = 0; k < cent.length; k++) { const c = cent[k], d = (lab[o] - c[0]) ** 2 + (lab[o + 1] - c[1]) ** 2 + (lab[o + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = k; } }
      assign[i] = best;
    }
    for (let k = 0; k < cent.length; k++) {
      const s = [0, 0, 0]; let n = 0;
      for (let i = 0; i < sample.length; i++) if (assign[i] === k) { const o = sample[i] * 3; s[0] += lab[o]; s[1] += lab[o + 1]; s[2] += lab[o + 2]; n++; }
      if (n) cent[k] = s.map(v => v / n);
    }
  }
  const others = [], clusters = [];
  for (let k = 0; k < cent.length; k++) {
    const members = sample.filter((_, i) => assign[i] === k);
    if (members.length < 20) continue;
    const m = meanCov(lab, members), g = gaussian(m.mean, m.cov);
    const dSkin = Math.sqrt(maha2(skinG, ...m.mean));
    const isSkin = dSkin < p.drop;
    clusters.push({mean: m.mean.map(v => +v.toFixed(1)), share: +(members.length / sample.length).toFixed(3), dSkin: +dSkin.toFixed(2), skin: isSkin});
    if (!isSkin) others.push({g, w: members.length});
  }
  const wSum = others.reduce((s, c) => s + c.w, 0) || 1;
  for (const c of others) c.lw = Math.log(c.w / wSum);
  // posterior
  const post = new Float32Array(N);
  const dMax2 = p.dMax * p.dMax;
  for (const o of covered) {
    const x0 = lab[o * 3], x1 = lab[o * 3 + 1], x2 = lab[o * 3 + 2];
    const pr = Math.min(0.999, p.prior * prior[o]);
    if (pr <= 0) continue;
    const d2 = maha2(skinG, x0, x1, x2);
    if (d2 > dMax2 * 2.25) continue;
    const ls = skinG.logNorm - 0.5 * d2 + Math.log(pr);
    let lc = -Infinity;
    for (const c of others) {
      const v = c.g.logNorm - 0.5 * maha2(c.g, x0, x1, x2) + c.lw;
      lc = lc > v ? lc + Math.log1p(Math.exp(v - lc)) : v + Math.log1p(Math.exp(lc - v));
    }
    lc += Math.log(1 - pr);
    let q = 1 / (1 + Math.exp(lc - ls));
    if (d2 > dMax2) q *= Math.max(0, 1 - (Math.sqrt(d2) - p.dMax) / (0.5 * p.dMax)); // soft cut-off beyond dMax
    post[o] = q;
  }
  return {post, prior, skinModel: {mean: skinG.mean.map(v => +v.toFixed(2)), sd: [0, 4, 8].map(i => +Math.sqrt(mc.cov[i]).toFixed(2)), seeds: seeds.length, kept: kept.length}, clusters, covered};
}

/** Gaussian blur restricted to texels of the same island (normalised). */
function islandBlur(src, ras, sigma, radius) {
  const N = WORK * WORK, out = new Float32Array(N), isl = ras.island;
  const kw = []; for (let d = -radius; d <= radius; d++) kw.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  const tmp = new Float32Array(N), tw = new Float32Array(N);
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    const o = y * WORK + x, I = isl[o];
    if (I < 0) continue;
    let s = 0, w = 0;
    for (let d = -radius; d <= radius; d++) { const xx = x + d; if (xx < 0 || xx >= WORK) continue; const q = o + d; if (isl[q] !== I) continue; s += src[q] * kw[d + radius]; w += kw[d + radius]; }
    tmp[o] = s; tw[o] = w;
  }
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    const o = y * WORK + x, I = isl[o];
    if (I < 0) continue;
    let s = 0, w = 0;
    for (let d = -radius; d <= radius; d++) { const yy = y + d; if (yy < 0 || yy >= WORK) continue; const q = o + d * WORK; if (isl[q] !== I) continue; const k = kw[d + radius]; s += k * tmp[q] / (tw[q] || 1); w += k; }
    out[o] = w ? s / w : src[o];
  }
  return out;
}

/** Connected components (4-neighbour, same island, same binary value). */
function components(bin, ras) {
  const N = WORK * WORK, lab = new Int32Array(N).fill(-1), isl = ras.island, comps = [];
  const stack = new Int32Array(N);
  for (let o0 = 0; o0 < N; o0++) {
    if (isl[o0] < 0 || lab[o0] >= 0) continue;
    const id = comps.length, I = isl[o0], v = bin[o0];
    let sp = 0, area = 0, border = false, edgeOut = 0, edgeIn = 0;
    stack[sp++] = o0; lab[o0] = id;
    while (sp) {
      const o = stack[--sp]; area++;
      const x = o % WORK, y = (o / WORK) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= WORK || yy >= WORK) { border = true; edgeOut++; continue; }
        const q = yy * WORK + xx;
        if (isl[q] !== I) { border = true; edgeOut++; continue; }
        if (bin[q] !== v) { edgeIn++; continue; }
        if (lab[q] >= 0) continue;
        lab[q] = id; stack[sp++] = q;
      }
    }
    // enclosure = share of the component's outline that touches the OTHER value inside the same island (1 = fully enclosed)
    comps.push({value: v, area, border, enclosure: edgeIn / ((edgeIn + edgeOut) || 1), island: I});
  }
  return {lab, comps};
}

function segment(body, ras, cls, p) {
  const N = WORK * WORK;
  const sm = islandBlur(cls.post, ras, 1.5, 3);
  const bin = new Uint8Array(N);
  for (const o of cls.covered) bin[o] = sm[o] > 0.5 ? 1 : 0;
  // island areas
  const isArea = new Int32Array(ras.islands), isSum = new Float64Array(ras.islands);
  for (const o of cls.covered) { isArea[ras.island[o]]++; isSum[ras.island[o]] += sm[o]; }
  const {lab, comps} = components(bin, ras);
  for (const o of cls.covered) {
    const c = comps[lab[o]], I = ras.island[o];
    if (isArea[I] < TINY_ISLAND) { bin[o] = isSum[I] / isArea[I] > 0.5 ? 1 : 0; continue; }
    if (c.value === 1 && c.area < p.minSkin && c.area < isArea[I]) bin[o] = 0;
    else if (c.value === 1 && c.enclosure >= ENCLOSED && c.area <= p.enclosedMax) bin[o] = 0;
    else if (c.value === 0 && !c.border && c.area <= p.maxHole) bin[o] = 1;
  }
  const feather = islandBlur(bin, ras, 1.0, 2);
  return {bin, feather};
}

/** 1024 feathered mask -> 512 tile (coverage-normalised 2x2) + gutter dilation. */
function toTile(ras, feather) {
  const T = TILE, f = WORK / T, out = new Float32Array(T * T), cov = new Float32Array(T * T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let s = 0, n = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const o = (y * f + dy) * WORK + x * f + dx; if (ras.island[o] >= 0) { s += feather[o]; n++; } }
    if (n) { out[y * T + x] = s / n; cov[y * T + x] = n / (f * f); }
  }
  // multi-source BFS from covered texels (8-neighbour), up to GUTTER px: nearest covered texel's value
  let front = [];
  const done = new Uint8Array(T * T);
  for (let o = 0; o < T * T; o++) if (cov[o] > 0) { done[o] = 1; front.push(o); }
  for (let step = 0; step < GUTTER && front.length; step++) {
    const next = [], acc = new Map();
    for (const o of front) {
      const x = o % T, y = (o / T) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= T || yy >= T) continue;
        const q = yy * T + xx;
        if (done[q]) continue;
        const a = acc.get(q);
        if (a) { a.s += out[o]; a.n++; } else { acc.set(q, {s: out[o], n: 1}); next.push(q); }
      }
    }
    for (const q of next) { const a = acc.get(q); out[q] = a.s / a.n; done[q] = 1; }
    front = next;
  }
  return {mask: out, cov};
}

/** Bilinear sample of a 512 tile at uv (clamped), as the shader's linear filter would. */
function sampleTile(mask, u, v) {
  const T = TILE;
  const x = Math.min(T - 1, Math.max(0, u * T - 0.5)), y = Math.min(T - 1, Math.max(0, v * T - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(T - 1, x0 + 1), y1 = Math.min(T - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (mask[y0 * T + x0] * (1 - fx) + mask[y0 * T + x1] * fx) * (1 - fy) + (mask[y1 * T + x0] * (1 - fx) + mask[y1 * T + x1] * fx) * fy;
}

function coverageStats(body, ras, seg, tile) {
  let covN = 0, covS = 0;
  for (let o = 0; o < WORK * WORK; o++) if (ras.island[o] >= 0) { covN++; covS += seg.feather[o]; }
  // surface coverage as the shader sees it: per triangle, the 512 tile sampled at 4 interior points, weighted by 3D area
  const {pos, uv, idx} = body;
  let aS = 0, aT = 0;
  const pts = [[1 / 3, 1 / 3], [2 / 3, 1 / 6], [1 / 6, 2 / 3], [1 / 6, 1 / 6]];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const e1 = [0, 1, 2].map(k => pos[b * 3 + k] - pos[a * 3 + k]), e2 = [0, 1, 2].map(k => pos[c * 3 + k] - pos[a * 3 + k]);
    const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    let s = 0;
    for (const [w1, w2] of pts) {
      const w0 = 1 - w1 - w2;
      s += sampleTile(tile.mask, w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2], w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1]);
    }
    aS += area * s / pts.length; aT += area;
  }
  return {uv: covS / covN, surface: aS / aT, coveredTexels: covN};
}

// ---------- QA images ----------
async function qaImages(body, ras, seg, tile, stats, sheetRows) {
  const id = body.b.id, A = body.atlas;
  const over = Buffer.alloc(WORK * WORK * 4);
  const plain = Buffer.alloc(WORK * WORK * 4);
  for (let y = 0; y < WORK; y++) for (let x = 0; x < WORK; x++) {
    const o = y * WORK + x;
    const m = sampleTile(tile.mask, (x + 0.5) / WORK, (y + 0.5) / WORK);
    const k = 0.7 * m;
    over[o * 4] = A[o * 3] * (1 - k) + 40 * k; over[o * 4 + 1] = A[o * 3 + 1] * (1 - k) + 255 * k; over[o * 4 + 2] = A[o * 3 + 2] * (1 - k) + 60 * k; over[o * 4 + 3] = 255;
    plain[o * 4] = A[o * 3]; plain[o * 4 + 1] = A[o * 3 + 1]; plain[o * 4 + 2] = A[o * 3 + 2]; plain[o * 4 + 3] = 255;
  }
  const label = s => Buffer.from(`<svg width="2048" height="40"><rect width="2048" height="40" fill="#16171a"/><text x="12" y="27" font-family="DejaVu Sans" font-size="20" fill="#e8e8e8">${s}</text></svg>`);
  await sharp({create: {width: 2048, height: 1064, channels: 3, background: '#16171a'}}).composite([
    {input: label(`${id}: base-colour atlas | skin mask in green (surface ${(stats.surface * 100).toFixed(1)} %, UV ${(stats.uv * 100).toFixed(1)} %)`), left: 0, top: 0},
    {input: plain, raw: {width: WORK, height: WORK, channels: 4}, left: 0, top: 40},
    {input: over, raw: {width: WORK, height: WORK, channels: 4}, left: 1024, top: 40},
  ]).jpeg({quality: 84}).toFile(path.join(QA_DIR, `${id}-atlas.jpg`));
  // CPU 3D views (bind pose, orthographic): plain front + overlay front / back / side
  const H = 760, Wd = 540, views = [];
  const cam = {cx: 0, cz: 0, cy: (body.yMin + body.yMax) / 2, height: (body.yMax - body.yMin) * 1.06};
  const texPlain = {data: plain, width: WORK, height: WORK, channels: 4}, texOver = {data: over, width: WORK, height: WORK, channels: 4};
  for (const [yaw, tex] of [[0, texPlain], [0, texOver], [180, texOver], [90, texOver], [270, texOver]]) {
    const c = new Canvas(Wd, H);
    c.draw({pos: body.pos, idx: body.idx, uv: body.uv, tex}, {...cam, yawDeg: yaw});
    views.push(await sharp(Buffer.from(c.rgb), {raw: {width: Wd, height: H, channels: 3}}).png().toBuffer());
  }
  await sharp({create: {width: Wd * views.length, height: H + 40, channels: 3, background: '#16171a'}}).composite([
    {input: label(`${id}: bind pose, CPU raster - plain | skin mask front | back | left | right`), left: 0, top: 0},
    ...views.map((v, i) => ({input: v, left: i * Wd, top: 40})),
  ]).jpeg({quality: 84}).toFile(path.join(QA_DIR, `${id}-views.jpg`));
  sheetRows.push({id, views, stats});
}

async function contactSheet(rows) {
  const Wd = 540, H = 760, s = 0.5, w = Math.round(Wd * s), h = Math.round(H * s), cols = 3; // front-overlay + back-overlay per body
  const cellW = w * 2, cellH = h + 26, nRows = Math.ceil(rows.length / cols);
  const comps = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], x = (i % cols) * cellW, y = ((i / cols) | 0) * cellH + 40;
    comps.push({input: Buffer.from(`<svg width="${cellW}" height="26"><text x="8" y="19" font-family="DejaVu Sans" font-size="15" fill="#e8e8e8">${r.id}  ${(r.stats.surface * 100).toFixed(1)} % skin</text></svg>`), left: x, top: y});
    for (const [j, k] of [[0, 1], [1, 2]]) comps.push({input: await sharp(r.views[k]).resize(w, h).png().toBuffer(), left: x + j * w, top: y + 26});
  }
  comps.push({input: Buffer.from(`<svg width="${cellW * cols}" height="40"><text x="10" y="27" font-family="DejaVu Sans" font-size="20" fill="#e8e8e8">zombie-skin-mask: green = skin (front | back, bind pose CPU raster)</text></svg>`), left: 0, top: 0});
  await sharp({create: {width: cellW * cols, height: nRows * cellH + 40, channels: 3, background: '#16171a'}}).composite(comps).jpeg({quality: 84}).toFile(path.join(QA_DIR, 'contact-sheet.jpg'));
}

// ---------- main ----------
const results = [];
const packed = Buffer.alloc(SIZE * SIZE * 3);
const sheetRows = [];
if (QA_DIR) fs.mkdirSync(QA_DIR, {recursive: true});
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
for (const b of BODIES) {
  if (only && !only.includes(b.id)) continue;
  const p = {...DEFAULTS, ...b.params, allow: {...DEFAULTS.allow, ...b.params.allow}};
  const body = await loadBody(b);
  const ras = rasterise(body);
  const cls = classify(body, ras, p);
  const seg = segment(body, ras, cls, p);
  const tile = toTile(ras, seg.feather);
  const stats = coverageStats(body, ras, seg, tile);
  const [col, row] = tileColRow(b.tile);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const v = Math.round(Math.min(1, Math.max(0, tile.mask[y * TILE + x])) * 255);
    packed[((row * TILE + y) * SIZE + col * TILE + x) * 3 + b.channel] = v;
  }
  results.push({b, p, body, ras, cls, stats});
  console.log(`${b.id.padEnd(15)} islands ${String(ras.islands).padStart(4)}  skin surface ${(stats.surface * 100).toFixed(1).padStart(5)} %  uv ${(stats.uv * 100).toFixed(1).padStart(5)} %  model L/a/b ${cls.skinModel.mean.join('/')} sd ${cls.skinModel.sd.join('/')}  seeds ${cls.skinModel.seeds}  clusters dropped ${cls.clusters.filter(c => c.skin).length}/${cls.clusters.length}`);
  if (process.argv.includes('--verbose')) console.log('  clusters', JSON.stringify(cls.clusters));
  if (QA_DIR) await qaImages(body, ras, seg, tile, stats, sheetRows);
}
if (QA_DIR && sheetRows.length) await contactSheet(sheetRows);
if (only) { console.log('--only: outputs not written'); process.exit(0); }

const png = await sharp(packed, {raw: {width: SIZE, height: SIZE, channels: 3}}).png({compressionLevel: 9, adaptiveFiltering: true, palette: false}).toBuffer();
const pngSha = sha(png);
const r4 = v => Math.round(v * 1e4) / 1e4;

const prov = {
  schema: 'last-line-derivative/1',
  asset: 'zombie-skin-mask',
  task: TASK,
  lane: LANE,
  status: 'runtime DATA texture (a mask; root CLAUDE.md: data textures are exempt from the Codex rule, processing is not authoring) derived deterministically from the shipped ordinary zombie body GLBs (their meshes, skinning weights and embedded base-colour atlases); no image or model generation; unapproved prototype, no licence or commercial clearance implied beyond the source models\' own status',
  rebuild: `node ${SCRIPT_REL}`,
  tool: `@gltf-transform/core + sharp (libvips) via ${SCRIPT_REL}`,
  output: {
    url: PNG_REL, width: SIZE, height: SIZE, format: 'png', channels: 'RGB (8-bit, linear data: load with NoColorSpace, flipY = false like the glTF UVs)',
    tile: TILE, layout: '2 x 2 tiles of 512²; each body = one channel (R, G, B) of one tile; alpha deliberately unused (premultiplied-alpha uploads would wipe RGB where alpha is 0); tile [1, 1] free',
    bytes: png.length, sha256: pngSha,
  },
  method: {
    grid: `${WORK}² classification in the mesh's TEXCOORD_0 space (texel centres), feathered (Gaussian sigma 1 px at 1024 inside each UV island) and downsampled 2x2 (coverage-normalised) to ${TILE}²; island values dilated ${GUTTER} px (at 512) into empty UV gutters, never over another island`,
    regions: 'per-texel skinning-weight prior: ' + Object.entries(JOINT_REGION).map(([j, r]) => `${j}->${r}`).join(', '),
    colour: `CIE Lab; skin Gaussian from seed-region texels (median/MAD 2.5 trim, then two Mahalanobis-3 trims, lightness axis stretched) vs a k-means (k=${KMEANS_K}, ${KMEANS_SAMPLES} seeded samples) Gaussian mixture of the atlas, clusters within "drop" of the skin model removed; posterior = prior-weighted likelihood ratio, cut beyond dMax`,
    cleanup: `inside each UV island only: Gaussian smoothing (sigma 1.5 px) + 0.5 threshold, skin specks < minSkin px removed, enclosed non-skin holes <= maxHole px filled, skin components enclosed in non-skin (>= ${ENCLOSED} of their outline) and <= enclosedMax px removed, islands < ${TINY_ISLAND} px take their majority`,
    coverage: 'surface = 3D-area-weighted mean of the 512 tile sampled bilinearly at 4 interior points of every triangle (what the shader sees); uv = mean over covered 1024 texels',
  },
  bodies: Object.fromEntries(results.map(r => [r.b.id, {
    input: {glb: r.b.glb, sha256: r.body.glbSha, bytes: r.body.glbBytes, baseColorSha256: r.body.atlasSha},
    slot: {tile: tileColRow(r.b.tile), channel: r.b.channel, channelName: 'RGB'[r.b.channel]},
    parameters: Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, r.p[k]])),
    reasons: r.b.why,
    skinModel: r.cls.skinModel,
    uvIslands: r.ras.islands,
    uvRange: {min: r.body.uvMin.map(v => r4(v)), max: r.body.uvMax.map(v => r4(v))},
    coverage: {surface: r4(r.stats.surface), uv: r4(r.stats.uv)},
  }])),
  limits: LIMITS(),
};

function LIMITS() {
  const lo = Math.min(...results.map(r => Math.min(r.body.uvMin[0], r.body.uvMin[1]))), hi = Math.max(...results.map(r => Math.max(r.body.uvMax[0], r.body.uvMax[1])));
  return [
    'Heuristic segmentation (colour + skinning-weight region prior + UV-island clean-up), checked by eye on atlas overlays and bind-pose CPU renders, not hand-painted: expect a few px of error along skin / cloth borders inside an island and on tiny Meshy fragments.',
    'Mask resolution is 512² per body (half the 1024² base colour); edges are feathered ~1 px at 512.',
    `Mipmaps would bleed neighbouring tiles (other bodies) at low levels: sample with a linear filter and no (or capped) mipmaps. Every body's UVs lie in [${lo.toFixed(4)}, ${hi.toFixed(4)}], so bilinear mip-0 sampling never leaves its tile.`,
    'Wounds / blood larger than maxHole on skin stay non-skin; skin-coloured blood stains / patches printed on baked cloth are removed only where enclosed in the cloth (courier, lastshift); a few px at the courier\'s tank-top hem remain.',
    'scavenger: whether the pink, vein-mottled torso under its open jacket is bare skin or a flesh-toned torn shirt is ambiguous in the texture; it is treated as skin between the lapels (throat to belt) plus the hands; the gas-mask head, jacket, trousers and boots are never skin.',
    'heavyset: the short beard stubble counts as skin (the colour tolerance that covers the darker shaved scalp includes it); eyes stay out.',
    'Hair: dark / brown / blonde hair is excluded by colour; pale strands lying on skin and a thin line along some hairlines are approximate. Eyes and mouth interiors stay out where larger than maxHole.',
    'Runtime garments (upper / lower slots) cover much of the body; the mask under them is irrelevant but harmless.',
  ];
}

const ts = `// GENERATED by ${SCRIPT_REL} - do not edit (task ${TASK}, lane ${LANE}).
// The irradiated zombies' SKIN MASK: a DATA texture (deterministic processing, no generation) classified from the ${results.length} shipped
// ordinary zombie bodies (ai/outfits.ts ZOMBIE_BODIES, assets/models/zombie-body-*-t25.glb): their UVs, skinning weights and embedded
// base-colour atlases. Provenance (input GLB sha256s, per-body parameters, limits): assets/derivatives/zombie-skin-mask.json.
// Layout: ${SIZE}² RGB PNG, 2 x 2 tiles of ${TILE}²; a body's mask = channel \`channel\` of tile [col, row] (tile [1, 1] and alpha unused).
// Sample at tileOffset + uv * (tile / size) with the body mesh's own TEXCOORD_0 (flipY = false), NoColorSpace, linear filter, no mipmaps.
// coverage = skin fraction of the body's surface area (as the shader samples it).
export const ZOMBIE_SKIN_MASK = {
  url: '${PNG_REL}',
  bytes: ${png.length},
  sha256: '${pngSha}',
  size: ${SIZE},
  tile: ${TILE},
  slots: {
${results.map(r => `    ${r.b.id}: {tile: [${tileColRow(r.b.tile).join(', ')}], channel: ${r.b.channel}},`).join('\n')}
  },
  coverage: {
${results.map(r => `    ${r.b.id}: ${r4(r.stats.surface)},`).join('\n')}
  },
} as const;
export type ZombieSkinMaskBodyId = keyof typeof ZOMBIE_SKIN_MASK.slots;
`;

const provText = JSON.stringify(prov, null, 1) + '\n';
const outs = [[path.join(PUB, PNG_REL), png], [path.join(PUB, PROV_REL), Buffer.from(provText)], [path.join(ROOT, TS_REL), Buffer.from(ts)]];
if (CHECK) {
  const bad = outs.filter(([f, b]) => !fs.existsSync(f) || !fs.readFileSync(f).equals(b)).map(([f]) => path.relative(ROOT, f));
  if (bad.length) fail(`--check: out of date: ${bad.join(', ')}`);
  console.log('--check: all outputs up to date');
} else {
  for (const [f, b] of outs) { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, b); }
  console.log(`wrote ${PNG_REL} (${png.length} bytes, sha256 ${pngSha.slice(0, 12)}), ${PROV_REL}, ${TS_REL}`);
}
