// Task studio-train-crafting-v1-20261111-225628-01 (lane ASSET): the runtime derivatives of the train CRAFTING equipment — the crafting
// BENCH, the three device MODULES that stand on a hand truck (route RADAR, SENTRY control, item / enemy SCANNER) and the sentry's roof
// TURRET — from their five Meshy T2.5 smart-topology image-to-3D originals, each conditioned on one Codex INITIAL design image (route
// Codex -> Meshy; every model keeps Meshy's own PBR maps, re-encoded only).
//
// Reads (never modifies) the immutable raw originals + the job records kept OUTSIDE Git in
//   reference/tasks/train-crafting-v1-20261111-225628/{gen/PRODUCTION-INPUT-MANIFEST.json, gen/MESHY-APPROVAL-ACK.json,
//   finance/ledger.jsonl, gen/raw/<accepted raw>.glb, gen/out/<conditioning image>.png}
// (every raw + conditioning image is verified against the production input manifest's sha256 / bytes, and the manifest against the
// ledger and the approval acknowledgement: a mismatch stops the cook) and writes deterministically:
//   game/public/assets/models/train-{bench,radar,sentry,scanner,turret}.glb   (flat: tools/release/package-ci.mjs allows assets/models/<name>.glb)
//   game/public/assets/derivatives/train-equipment.json   (provenance; hash-only: no generation text / URLs / private paths)
//   game/src/assets/trainEquipment.generated.ts           (keys / urls / bytes / tris / dims + the measured constants the runtime reads)
//   game/public/assets/CREDITS.md                         (the marked train-equipment-models section)
//   tools/release/public-inputs.json                      (ONLY this script's paths + CREDITS.md added / updated; others untouched)
//
// Derivatives (every frame is checked on the mesh, never assumed): metres at runtime size, +Y up, grounded (min y = 0), transforms baked
// into the vertices. No geometry simplification (Smart Topology made the approved ~18-19k triangle target). Each model's OWN Meshy PBR
// maps (base colour, packed metallic-roughness, normal) are kept channel for channel and re-encoded (Lanczos downsize, JPEG): no
// reprojection / retexture / repaint. One material per model.
//  - BENCH: native frame kept (front = +Z, X along the wall), uniform scale to the runtime length BENCH_L, centred on its bounds.
//  - MODULES: native frame kept (console face = +Z), fixed uniform scale (MODULE_SCALE), origin at the bottom centre of the CABINET's
//    footprint. Where the module stands on the hand truck (`mountZ`) is measured against the truck's cooked model (assets/models/
//    p7-hand-truck-t25.glb as world/fuelCartModel.ts places it: DOLLY) so the module clears the truck's frame and truck + module stay
//    inside the dolly's footprint circle.
//  - TURRET: rotated a quarter turn (the raw barrel points -X; runtime +Z = the muzzle), origin on the yaw axis (the base flange's
//    centre) at the flange's underside, scale 1. The raw mesh is 284 separate shells; they are CLASSIFIED (never cut: no triangle is
//    split; the only added geometry is two flat caps closing the rear arm plates' open inner sides, which the tilt uncovers) into
//    three nodes sharing one material: 'turret-base' (fixed: flange, slew rings, bolts), 'turret-yoke'
//    (child of the scene root; turns about +Y through the origin: the U frame, its arms and hubs, the power hose and its junction box)
//    and 'turret-head' (child of the yoke, translated to the tilt axis PITCH_PIVOT, its vertices relative to it: the gun, barrel, sensor
//    pod, ammunition boxes and feed chutes). The runtime only sets yoke.rotation.y and head.rotation.x (positive = muzzle down).
//
// Usage: node tools/asset-pipeline/props/build-train-equipment.mjs [--dry-run]
//   (the private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-train-crafting-v1-20261111-225628-01';
const TASK_DIR = 'reference/tasks/train-crafting-v1-20261111-225628';
const SCRIPT = 'tools/asset-pipeline/props/build-train-equipment.mjs';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const TDIR = path.join(REF_ROOT, TASK_DIR);
const PROV_ID = 'train-equipment';
const PROV_REL = `assets/derivatives/${PROV_ID}.json`;
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/trainEquipment.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN train-equipment-models (build-train-equipment.mjs) -->';
const CREDITS_END = '<!-- END train-equipment-models -->';
const CREDITS_AFTER = '<!-- END train-chipper-model -->';
const DRY = process.argv.includes('--dry-run');
/** Texture policy (px, JPEG quality): the train chipper's (build-train-chipper.mjs) — hard-surface fixtures the player works at. */
const TEX = {base: 1024, normal: 1024, mr: 512, quality: 85, normalQuality: 90};

/** The bench's runtime length along X (m): the car's rear compartment takes 1.086 m less 25 mm each end (craft/trainFixtures.ts). */
const BENCH_L = 1.02;
const BENCH_LIMIT = {d: 0.71, h: 1.4, worktop: [0.78, 0.95]};
/** The modules' uniform scales (Meshy's ~0.95 m tall originals are already about cabinet-sized: 0.34-0.35 m wide, the nose plate's
 *  width). On the truck: the radar's antenna bar tops out at ~0.94 m and the scanner's beacon at ~1.07 m above the floor; the sentry
 *  console is the deepest and is taken 2 % DOWN (top ~1.0 m) so truck + module stay inside the dolly's footprint circle. */
const MODULE_SCALE = {radar: 1.08, sentry: 0.98, scanner: 1.05};
/** The dolly frame (world/fuelCartModel.ts CART_LOOK, fuel/trainPort.ts PORT.cartRadius; tests/train-equipment-asset.test.ts pins these
 *  against the sources): the hand truck's model origin z, its nose plate's top, the footprint circle about the dolly origin. */
const DOLLY = {truckUrl: 'assets/models/p7-hand-truck-t25.glb', truckZ: -0.071268, plateTop: 0.073, radius: 0.36, plate: {x0: -0.174, x1: 0.173, z0: -0.066, z1: 0.232}};
/** Module rules on the truck (m): clearance behind the module, the hard plan-radius cap (whip aerials included), top limits above the floor. */
const MOUNT = {clear: 0.004, hardRadius: 0.40, bodyTopMax: 1.20, topMax: 1.30};
/** The turret's tilt axis (cooked frame, m): the lateral axis through this point. Chosen by the clearance scan below (pitchClear): the
 *  gun's nose swings DOWN in front of the yoke's open front while its rear lifts, so the roof gun can depress onto targets below it. */
const PITCH_PIVOT = {x: 0, y: 0.27, z: 0.052};
const PITCH_NEED = {down: 30, up: 0};

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { throw new Error(`build-train-equipment: ${m}`); };
const r4 = v => +v.toFixed(4), r3 = v => +v.toFixed(3);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
/** Smallest / largest f(item) (loops: the sample lists are too long to spread into Math.min / Math.max). */
const lo = (a, f) => { let m = Infinity; for (const q of a) { const v = f(q); if (v < m) m = v; } return m; };
const hi = (a, f) => { let m = -Infinity; for (const q of a) { const v = f(q); if (v > m) m = v; } return m; };

const MODELS = [
  {key: 'bench', asset: 'BENCH', id: 'train-bench', kind: 'bench',
    what: 'the train CRAFTING BENCH: a small welded steel workbench with a wooden top inside a low back / end rail, a bolted-down bench vise, bench grinder and gauge / test box with its cable, and a wire-mesh lower shelf',
    credit: 'the train\'s crafting bench (wooden top on a welded steel frame; bolted-down vise, bench grinder and gauge box; mesh lower shelf)'},
  {key: 'radar', asset: 'RADAR', id: 'train-radar', kind: 'module',
    what: 'the ROUTE RADAR device module: a field cabinet (round scope, lamps, vent, side handles, coiled power lead) carrying a mast-mounted antenna bar and a whip aerial; it stands on a hand truck\'s nose plate',
    credit: 'the route radar module (field cabinet with a mast-mounted antenna bar and whip aerial; stands on the existing hand truck)'},
  {key: 'sentry', asset: 'SENTRY', id: 'train-sentry', kind: 'module',
    what: 'the SENTRY CONTROL device module: a field console (monitor, switches, emergency stop, vent, side handles, coiled power lead) with an open ammunition hopper on top; it stands on a hand truck\'s nose plate',
    credit: 'the sentry control module (field console with monitor and emergency stop under an open ammunition hopper; stands on the existing hand truck)'},
  {key: 'scanner', asset: 'SCANNER', id: 'train-scanner', kind: 'module',
    what: 'the ITEM / ENEMY SCANNER device module: a field console (hooded round scope, dials, lamps, vent, side handles, coiled power lead) with a beacon and a whip aerial; it stands on a hand truck\'s nose plate',
    credit: 'the item / enemy scanner module (field console with a hooded round scope, beacon and whip aerial; stands on the existing hand truck)'},
  {key: 'turret', asset: 'TURRET', id: 'train-turret', kind: 'turret',
    what: 'the SENTRY ROOF TURRET: a belt-fed machine gun with a sensor pod and twin ammunition boxes in a U yoke on a bolted slew-ring base, with its power hose and junction box',
    credit: 'the sentry\'s roof turret (machine gun with sensor pod and twin ammunition boxes in a U yoke on a slew-ring base; three nodes: base, yoke, head)'},
];

// ---------------------------------------------------------------------------------------------
// Records: the production input manifest is the authority; the ledger and the approval acknowledgement must agree with it

const readRec = rel => fs.readFileSync(path.join(TDIR, rel));
const manifest = JSON.parse(readRec('gen/PRODUCTION-INPUT-MANIFEST.json'));
const ack = JSON.parse(readRec('gen/MESHY-APPROVAL-ACK.json'));
const ledger = readRec('finance/ledger.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
if (manifest.schema !== 'train-crafting-production-input-manifest-v1' || manifest.task !== TASK) fail('unexpected production input manifest');
const AUTHORITY = manifest.authoritySha256;
if (!/^[a-f0-9]{64}$/.test(AUTHORITY) || ack.authoritySha256 !== AUTHORITY || ack.task !== TASK) fail('the approval acknowledgement does not carry the manifest\'s authority');
const stable = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(q => [q, v[q]])) : v));
if (stable(manifest.totals.caps) !== stable(ack.caps)) fail('manifest caps differ from the approval acknowledgement');
if (Object.keys(manifest.assets).sort().join() !== MODELS.map(m => m.asset).sort().join()) fail(`manifest assets ${Object.keys(manifest.assets)} are not exactly the five models`);
{
  const of = ev => ledger.filter(e => e.event === ev);
  const billed = of('settle').reduce((s, e) => s + (e.billed ?? 0), 0), gens = of('reserve').length, posts = of('posted').length;
  const T = manifest.totals;
  if (billed !== T.billedCredits || gens !== T.generations || posts !== T.paidPosts) fail(`ledger totals ${billed} credits / ${gens} generations / ${posts} requests differ from the manifest`);
  if (billed > ack.caps.credits || gens > ack.caps.generations || posts > ack.caps.posts) fail('ledger outside the approval caps');
  if (of('budget_authorized').length !== 1 || of('budget_authorized')[0].maxCredits !== ack.caps.credits) fail('ledger budget line differs from the approval caps');
}
for (const m of MODELS) {
  const a = manifest.assets[m.asset];
  if (a.accepted !== true || a.status !== 'SUCCEEDED') fail(`${m.asset}: not an accepted, succeeded generation`);
  if (!/^gen\/raw\/[\w.-]+\.glb$/.test(a.raw.file) || !/^gen\/out\/[\w.-]+\.png$/.test(a.conditioningImage.file)) fail(`${m.asset}: unexpected record path`);
  const mine = ledger.filter(e => e.asset === m.asset);
  const accepts = mine.filter(e => e.event === 'accept');
  if (accepts.length !== 1 || accepts[0].res !== a.reservation) fail(`${m.asset}: expected exactly one ledger accept of ${a.reservation}`);
  if (mine.some(e => e.res !== a.reservation)) fail(`${m.asset}: the ledger holds another attempt (the manifest says first attempt)`);
  const one = ev => { const l = mine.filter(e => e.event === ev); if (l.length !== 1) fail(`${m.asset}: expected one '${ev}' line, found ${l.length}`); return l[0]; };
  const reserve = one('reserve'), posted = one('posted'), settle = one('settle'), raw = one('raw');
  const {file_path: reqFile, ...request} = reserve.params;
  if (reserve.authoritySha256 !== AUTHORITY) fail(`${m.asset}: reserve line authority differs`);
  if (reserve.inputSha256 !== a.conditioningImage.sha256 || reserve.inputProof?.sourceSha256 !== a.conditioningImage.sha256 || reserve.inputBytes !== a.conditioningImage.bytes) fail(`${m.asset}: the ledger's conditioning image differs from the manifest`);
  if (path.basename(reserve.input) !== path.basename(a.conditioningImage.file) || path.basename(reqFile) !== path.basename(a.conditioningImage.file)) fail(`${m.asset}: conditioning image name differs`);
  if (stable(request) !== stable(a.request)) fail(`${m.asset}: the ledger's request differs from the manifest`);
  if (posted.taskId !== a.meshyTask || settle.status !== 'SUCCEEDED' || settle.billed !== a.billedCredits || a.billedCredits !== ack.pricePerJobCredits) fail(`${m.asset}: task / settle / price differs`);
  if (raw.sha256 !== a.raw.sha256 || raw.bytes !== a.raw.bytes || path.basename(raw.file) !== path.basename(a.raw.file)) fail(`${m.asset}: the ledger's raw differs from the manifest`);
  m.rec = a;
  m.tool = reserve.tool;
  m.rawBytes = readRec(a.raw.file);
  if (sha(m.rawBytes) !== a.raw.sha256 || m.rawBytes.length !== a.raw.bytes) fail(`${m.asset}: raw sha256 / size mismatch against the manifest`);
  const img = readRec(a.conditioningImage.file);
  if (sha(img) !== a.conditioningImage.sha256 || img.length !== a.conditioningImage.bytes) fail(`${m.asset}: conditioning image sha256 / size mismatch against the manifest`);
  const meta = await sharp(img).metadata();
  if (`${meta.width}x${meta.height}` !== a.conditioningImage.size) fail(`${m.asset}: conditioning image is ${meta.width}x${meta.height}, the manifest says ${a.conditioningImage.size}`);
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tris = d => d.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
/** Every triangle as [[x,y,z] x 3] in the SCENE frame (node world matrices applied), optionally only the nodes `pick` accepts. */
function triangleList(d, pick) {
  const out = [];
  for (const n of d.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh || (pick && !pick(n.getName()))) continue;
    const M = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute('POSITION').getArray(), I = p.getIndices()?.getArray() ?? Uint32Array.from({length: P.length / 3}, (_, i) => i);
      const at = i => { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
      for (let t = 0; t < I.length; t += 3) out.push([at(I[t]), at(I[t + 1]), at(I[t + 2])]);
    }
  }
  return out;
}
const boundsOf = T => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of T) for (const q of t) for (let k = 0; k < 3; k++) { if (q[k] < min[k]) min[k] = q[k]; if (q[k] > max[k]) max[k] = q[k]; }
  return {min, max};
};
/**
 * A height / depth map: cells over axes (a, c) of size res inside box `win` ({min, max} on all 3 axes); each cell keeps the extreme
 * (sign +1 max / -1 min) of axis v over the triangles covering the cell centre (only triangle parts inside win along v count).
 */
function extremeMap(T, a, c, v, sign, res, win) {
  const nA = Math.max(1, Math.ceil((win.max[a] - win.min[a]) / res)), nC = Math.max(1, Math.ceil((win.max[c] - win.min[c]) / res));
  const m = new Float64Array(nA * nC).fill(NaN);
  for (const p of T) {
    const A = p.map(q => (q[a] - win.min[a]) / res - 0.5), C = p.map(q => (q[c] - win.min[c]) / res - 0.5);
    const i0 = Math.max(0, Math.ceil(Math.min(...A))), i1 = Math.min(nA - 1, Math.floor(Math.max(...A)));
    const j0 = Math.max(0, Math.ceil(Math.min(...C))), j1 = Math.min(nC - 1, Math.floor(Math.max(...C)));
    if (i0 > i1 || j0 > j1) continue;
    const d = (A[1] - A[0]) * (C[2] - C[0]) - (A[2] - A[0]) * (C[1] - C[0]);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const w1 = ((i - A[0]) * (C[2] - C[0]) - (A[2] - A[0]) * (j - C[0])) / d, w2 = ((A[1] - A[0]) * (j - C[0]) - (i - A[0]) * (C[1] - C[0])) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
      const val = w0 * p[0][v] + w1 * p[1][v] + w2 * p[2][v];
      if (val < win.min[v] || val > win.max[v]) continue;
      const k = i * nC + j;
      if (Number.isNaN(m[k]) || (sign > 0 ? val > m[k] : val < m[k])) m[k] = val;
    }
  }
  const at = (i, j) => m[i * nC + j];
  const cA = i => win.min[a] + (i + 0.5) * res, cC = j => win.min[c] + (j + 0.5) * res;
  return {m, nA, nC, at, cA, cC};
}
/** Dense surface samples (a barycentric lattice no coarser than `step` along the longest edge; the corners are always included). */
function* samples(T, step) {
  for (const [a, b, c] of T) {
    const L = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2])), n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, v = j / n, w = 1 - u - v; yield [a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v]; }
  }
}
/** The plateau of a height map: the most populated 1 cm band of its finite cells inside [lo, hi], refined to the mean of the cells within 6 mm. */
function plateau(map, lo, hi) {
  const cells = [];
  for (const v of map.m) if (Number.isFinite(v) && v >= lo && v <= hi) cells.push(v);
  const bins = new Map();
  for (const v of cells) { const k = Math.floor(v / 0.01); bins.set(k, (bins.get(k) ?? 0) + 1); }
  let y = ([...bins].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0] + 0.5) * 0.01;
  for (let it = 0; it < 4; it++) y = mean(cells.filter(v => Math.abs(v - y) <= 0.006));
  return {y, cells: cells.filter(v => Math.abs(v - y) <= 0.006).length, of: cells.length};
}

// ---------------------------------------------------------------------------------------------
// Shared cook steps

/** Reads a raw GLB, bakes its node transforms into its single mesh (one primitive, one material: checked). */
async function openRaw(m) {
  const doc = await io.readBinary(new Uint8Array(m.rawBytes));
  const r = doc.getRoot();
  const rawTris = tris(doc);
  const rawTex = r.listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const meshes = r.listMeshes();
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1 || r.listMaterials().length !== 1) fail(`${m.asset}: expected one mesh, one primitive, one material in the raw`);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  return {doc, r, scene, rawTris, rawTex, b0, ext: [0, 1, 2].map(k => b0.max[k] - b0.min[k])};
}
/** 16-bit indices where the vertex count allows (lossless; the raws carry 32-bit ones). */
function compactIndices(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    if (idx && p.getAttribute('POSITION').getCount() <= 65535 && !(idx.getArray() instanceof Uint16Array)) idx.setArray(Uint16Array.from(idx.getArray()));
  }
}
/** Texture re-encode, write, re-read: {glb, chk (the re-read document), textures}. */
async function finish(doc, m) {
  const r = doc.getRoot();
  compactIndices(doc);
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.base, TEX.base], quality: TEX.quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.mr, TEX.mr], quality: TEX.quality, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.normal, TEX.normal], quality: TEX.normalQuality, slots: /^normal/}));
  r.getAsset().generator = `Terminal State ${SCRIPT} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) fail(`${m.id}: URL/token-like string inside the glTF JSON`);
  const chk = await io.readBinary(new Uint8Array(glb));
  const cr = chk.getRoot();
  const mats = cr.listMaterials();
  if (mats.length !== 1 || !mats[0].getBaseColorTexture() || !mats[0].getMetallicRoughnessTexture() || !mats[0].getNormalTexture()) fail(`${m.id}: expected one material with base colour, metallic-roughness and normal maps`);
  const textures = cr.listTextures().map(t => {
    const slot = mats.flatMap(q => [['baseColor', q.getBaseColorTexture()], ['metallicRoughness', q.getMetallicRoughnessTexture()], ['normal', q.getNormalTexture()], ['occlusion', q.getOcclusionTexture()], ['emissive', q.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  if (textures.length !== 3 || textures.some(t => t.slot === 'unused' || t.mime !== 'image/jpeg')) fail(`${m.id}: expected exactly the three JPEG maps, got ${JSON.stringify(textures.map(t => [t.slot, t.mime]))}`);
  const T = triangleList(chk), b = boundsOf(T);
  if (Math.abs(b.min[1]) > 1e-4) fail(`${m.id}: not grounded (min y ${b.min[1]})`);
  return {glb, chk, textures, T, b, dims: [0, 1, 2].map(k => r4(b.max[k] - b.min[k])), outTris: tris(chk)};
}
/** One mesh at identity: uniform scale s about `origin` (raw x / z; the raw's lowest point goes to y = 0), names set. */
function bakeUniform(o, m, s, origin) {
  const M = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * origin[0], -s * o.b0.min[1], -s * origin[1], 1]; // column-major
  for (const mesh of o.r.listMeshes()) transformMesh(mesh, M);
  o.r.listMeshes()[0].setName(m.id);
  o.r.listNodes().filter(n => n.getMesh())[0].setName(m.id);
  o.r.listMaterials()[0].setName(m.id);
}

// ---------------------------------------------------------------------------------------------
// BENCH

/** Raw-frame checks: +Y up (four feet: the lowest layer reaches all four corners), the worktop is a broad plateau. */
function benchOrientation(T, b, ext) {
  const low = T.flat().filter(q => q[1] < b.min[1] + 0.03 * ext[1]);
  const span = k => (hi(low, q => q[k]) - lo(low, q => q[k])) / ext[k];
  const res = {upAxis: 'y', feetSpanX: r3(span(0)), feetSpanZ: r3(span(2))};
  if (!(res.feetSpanX > 0.85 && res.feetSpanZ > 0.7)) fail(`bench: not +Y up? lowest layer spans ${JSON.stringify(res)}`);
  return res;
}
function measureBench(T, b) {
  const RES = 0.005, RISE = 0.012;
  const top = extremeMap(T, 0, 2, 1, 1, RES, {min: b.min, max: b.max});
  const wt = plateau(top, 0.5, b.max[1]);
  const worktopY = wt.y;
  const flat = (i, j) => { const v = top.at(i, j); return Number.isFinite(v) && Math.abs(v - worktopY) <= 0.008; };
  // the top's extent = the columns / rows of the map in which at least a quarter of the cells are plateau (a stray cell at that height,
  // e.g. on the cable, does not count); the free rectangle = the largest all-plateau rectangle (maximal rectangle, histogram method)
  const colN = new Int32Array(top.nA), rowN = new Int32Array(top.nC);
  for (let i = 0; i < top.nA; i++) for (let j = 0; j < top.nC; j++) if (flat(i, j)) { colN[i]++; rowN[j]++; }
  const span = (n, need) => { let a = 0, c = n.length - 1; while (a < c && n[a] < need) a++; while (c > a && n[c] < need) c--; return [a, c]; };
  const [i0, i1] = span(colN, 0.25 * top.nC), [j0, j1] = span(rowN, 0.25 * top.nA);
  const rect = (a0, a1, c0, c1) => ({x0: r3(top.cA(a0) - RES / 2), x1: r3(top.cA(a1) + RES / 2), z0: r3(top.cC(c0) - RES / 2), z1: r3(top.cC(c1) + RES / 2)});
  let best = null;
  const hgt = new Int32Array(top.nC);
  for (let i = 0; i < top.nA; i++) {
    for (let j = 0; j < top.nC; j++) hgt[j] = flat(i, j) ? hgt[j] + 1 : 0;
    const st = [];
    for (let j = 0; j <= top.nC; j++) {
      const h = j < top.nC ? hgt[j] : 0;
      let start = j;
      while (st.length && st[st.length - 1][1] >= h) {
        const [s0, hh] = st.pop();
        const area = hh * (j - s0);
        if (!best || area > best.area) best = {area, a0: i - hh + 1, a1: i, c0: s0, c1: j - 1};
        start = s0;
      }
      st.push([start, h]);
    }
  }
  // what stands ABOVE the worktop: every height-map cell rising RISE over it must lie in one of the bench's reviewed fixture zones
  // (cooked frame, m; the model's renders and this map were inspected: the three fixtures are bolted down, the rail is part of the top).
  // Anything rising elsewhere would be a loose item baked into the furniture (prop rule 4): the cook stops.
  const ZONES = [
    ['rail', (x, z) => z <= -0.295 || (x >= 0.425 && z <= -0.11), 'the low rail along the back and the +X end of the top (part of the top)'],
    ['vise', x => x <= -0.26, 'the bench vise on its bolted base plate at the -X end (its screw handle reaches past the front edge)'],
    ['grinder', (x, z) => x >= -0.05 && x < 0.185 && z >= -0.17 && z <= 0.05, 'the bench grinder on its bolted foot'],
    ['gauge-box', (x, z) => x >= 0.185 && z > -0.13 && z <= 0.07, 'the gauge / test box at the +X end (two dials, toggle switches), with its cable'],
  ];
  const zoneCells = new Map(ZONES.map(z => [z[0], []])), stray = [];
  for (let i = 0; i < top.nA; i++) for (let j = 0; j < top.nC; j++) {
    const v = top.at(i, j);
    if (!Number.isFinite(v) || v <= worktopY + RISE) continue;
    const zone = ZONES.find(([, test]) => test(top.cA(i), top.cC(j)));
    (zone ? zoneCells.get(zone[0]) : stray).push([i, j, v]);
  }
  const zoneBox = cells => ({...rect(lo(cells, q => q[0]), hi(cells, q => q[0]), lo(cells, q => q[1]), hi(cells, q => q[1])), top: r3(hi(cells, q => q[2])), areaCm2: Math.round(cells.length * RES * RES * 1e4)});
  if (stray.length * RES * RES > 0.0002) fail(`bench: something rises above the worktop outside the reviewed fixture zones (prop rule 4 review needed): ${JSON.stringify(zoneBox(stray))}`);
  const fixtures = ZONES.map(([name, , what]) => { if (!zoneCells.get(name).length) fail(`bench: nothing stands in the '${name}' zone`); return {name, what, ...zoneBox(zoneCells.get(name))}; });
  const fx = Object.fromEntries(fixtures.map(f => [f.name, f]));
  if (!(fx.vise.top > worktopY + 0.2 && fx.grinder.top > worktopY + 0.12 && fx['gauge-box'].top > worktopY + 0.15 && fx.rail.top < worktopY + 0.1)) fail(`bench: fixture heights implausible ${JSON.stringify(fixtures)}`);
  // the lower shelf: the broad plateau seen from above once everything from 15 cm under the worktop up is ignored
  const under = extremeMap(T, 0, 2, 1, 1, RES, {min: b.min, max: [b.max[0], worktopY - 0.15, b.max[2]]});
  const sh = plateau(under, 0.05, worktopY - 0.15);
  const slab = rect(i0, i1, j0, j1);
  // the front = +Z: the rail closes the back, the vise's screw handle reaches past the top's front edge
  if (!(fx.rail.z0 < slab.z0 + 0.01 && fx.vise.z1 > slab.z1 + 0.02)) fail(`bench: front is not +Z? ${JSON.stringify({rail: fx.rail, vise: fx.vise, slab})}`);
  return {
    worktopY: r3(worktopY), worktop: slab, free: rect(best.a0, best.a1, best.c0, best.c1), shelfY: r3(sh.y), fixtures,
    looseItems: {found: 0, strayRaisedCm2: +(stray.length * RES * RES * 1e4).toFixed(2), note: 'nothing rises above the worktop outside the fixture zones; the dark marks on the top are painted stains (flat); the lower shelf is empty'},
    plateau: {cells: wt.cells, shareOfTopView: r3(wt.cells / wt.of)}, shelfPlateau: {cells: sh.cells},
  };
}
async function cookBench(m) {
  const o = await openRaw(m);
  const orient = benchOrientation(triangleList(o.doc), o.b0, o.ext);
  const s = BENCH_L / o.ext[0];
  bakeUniform(o, m, s, [(o.b0.min[0] + o.b0.max[0]) / 2, (o.b0.min[2] + o.b0.max[2]) / 2]);
  const f = await finish(o.doc, m);
  const {b, dims} = f;
  if (Math.abs(b.min[0] + b.max[0]) > 2e-3 || Math.abs(b.min[2] + b.max[2]) > 2e-3) fail(`bench: not centred ${JSON.stringify(b)}`);
  const M = measureBench(f.T, b);
  if (Math.abs(dims[0] - BENCH_L) > 1e-3 || dims[2] > BENCH_LIMIT.d || dims[1] >= BENCH_LIMIT.h || !(M.worktopY > BENCH_LIMIT.worktop[0] && M.worktopY < BENCH_LIMIT.worktop[1])) fail(`bench: size outside the car's rear compartment rules: ${dims} worktop ${M.worktopY}`);
  return {...o, ...f, scale: s, orient: {...orient, result: 'Meshy native frame kept (no rotation): +Y up, the front (gauge dials, vise screw) = +Z, the low rail at the back (-Z) and the +X end'},
    transform: 'uniform scale to the runtime length, grounded (min y = 0), centred on x / z, baked into the vertices (identity node); no rotation, no geometry simplification',
    convention: 'metres at runtime size, +Y up, origin at the bottom centre of the footprint; +Z = the front (the side the player stands at), X along the wall it stands against (vise at -X, gauge box at +X)',
    measured: {size: {l: r3(dims[0]), h: r3(dims[1]), d: r3(dims[2])}, ...M},
    method: {
      worktopY: 'top-down height map (5 mm): the most populated 1 cm band above 0.5 m, refined to the mean of the cells within 6 mm = the wooden top',
      worktop: 'the height-map columns / rows in which at least a quarter of the cells are within 8 mm of the worktop height (the top as far as it is seen from above, inside its rail); free = the largest rectangle made only of such cells (nothing stands in it)',
      fixtures: 'every height-map cell rising more than 12 mm over the worktop is assigned to a reviewed plan zone (rail / vise / grinder / gauge box); more than 2 cm2 of raised cells outside the zones stops the cook (prop rule 4: no loose item is baked into the bench)',
      shelfY: 'the same plateau measure with everything from 15 cm under the worktop up ignored = the wire-mesh lower shelf',
    }};
}

// ---------------------------------------------------------------------------------------------
// MODULES (radar / sentry / scanner)

const FOOT_BAND = 0.05; // the cabinet footprint = the lowest 5 % of the height
/** The hand truck above its nose plate as the dolly sees it: the frontmost z of its geometry per 4 mm (x, y) cell, and its plan radius. */
async function loadTruck() {
  const bytes = fs.readFileSync(path.join(PUB, DOLLY.truckUrl));
  const doc = await io.readBinary(new Uint8Array(bytes));
  const T = triangleList(doc).map(t => t.map(q => [q[0], q[1], q[2] + DOLLY.truckZ]));
  const CELL = 0.004, front = new Map();
  let radius = 0;
  for (const q of samples(T, CELL / 2)) {
    radius = Math.max(radius, Math.hypot(q[0], q[2]));
    if (q[1] <= DOLLY.plateTop + 0.003) continue;
    const k = `${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`;
    if (!front.has(k) || q[2] > front.get(k)) front.set(k, q[2]);
  }
  return {sha256: sha(bytes), bytes: bytes.length, CELL, front, radius};
}
/** Raw-frame checks: +Y up (the lowest layer is the cabinet's full footprint), the console face = +Z (the cabinet's back is flat; the
 *  lead, hood or connector stand proud of the front). Returns the footprint (raw frame). */
function moduleFootprint(m, T, b, ext) {
  const low = T.flat().filter(q => q[1] <= b.min[1] + FOOT_BAND * ext[1]);
  const foot = {x0: lo(low, q => q[0]), x1: hi(low, q => q[0]), z0: lo(low, q => q[2]), z1: hi(low, q => q[2])};
  const res = {upAxis: 'y', footprintShareX: r3((foot.x1 - foot.x0) / ext[0]), footprintShareZ: r3((foot.z1 - foot.z0) / ext[2]), behindBack: r3(foot.z0 - b.min[2]), proudOfFront: r3(b.max[2] - foot.z1)};
  if (!(res.footprintShareX > 0.6 && res.footprintShareZ > 0.7)) fail(`${m.id}: not +Y up? ${JSON.stringify(res)}`);
  if (!(res.behindBack < 0.006 && res.proudOfFront > 0.04)) fail(`${m.id}: console face not +Z? ${JSON.stringify(res)}`);
  return {foot, res};
}
function measureModule(m, T, b, truck) {
  const pts = [...samples(T, truck.CELL / 2)];
  const H = b.max[1];
  const low = pts.filter(q => q[1] <= FOOT_BAND * H);
  const foot = {x0: lo(low, q => q[0]), x1: hi(low, q => q[0]), z0: lo(low, q => q[2]), z1: hi(low, q => q[2])};
  if (Math.abs(foot.x0 + foot.x1) > 2e-3 || Math.abs(foot.z0 + foot.z1) > 2e-3) fail(`${m.id}: the cabinet footprint is not centred on the origin ${JSON.stringify(foot)}`);
  const footW = foot.x1 - foot.x0, footD = foot.z1 - foot.z0;
  // horizontal slabs (5 mm): plan extents of everything, and of the cabinet body alone (inside the footprint's width: no handles / leads)
  const SL = 0.005, nS = Math.ceil(H / SL);
  const slab = Array.from({length: nS}, () => ({x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, bx0: Infinity, bx1: -Infinity}));
  for (const q of pts) {
    const s = slab[Math.max(0, Math.min(nS - 1, Math.floor(q[1] / SL)))];
    if (q[0] < s.x0) s.x0 = q[0]; if (q[0] > s.x1) s.x1 = q[0]; if (q[2] < s.z0) s.z0 = q[2]; if (q[2] > s.z1) s.z1 = q[2];
    if (Math.abs(q[0]) <= footW / 2 + 0.005) { if (q[0] < s.bx0) s.bx0 = q[0]; if (q[0] > s.bx1) s.bx1 = q[0]; }
  }
  // a whip aerial: the run of slabs from the top down that are thinner than 3 cm both ways
  let k = nS - 1;
  while (k > 0 && slab[k].x1 - slab[k].x0 < 0.03 && slab[k].z1 - slab[k].z0 < 0.03) k--;
  const bodyTop = Math.min(H, (k + 1) * SL);
  // the console face band: from the base up, the run of slabs where the cabinet body is still (nearly) as wide as its footprint
  let f = 0;
  while (f < nS && slab[f].bx1 - slab[f].bx0 >= 0.75 * footW) f++;
  const face = {y0: 0, y1: r3(f * SL)};
  // where it stands on the truck: every sample stays MOUNT.clear in front of the truck's frontmost geometry in its own and the
  // neighbouring (x, y) cells; mountZ = that limit rounded up to a millimetre
  let need = -Infinity, tight = null;
  for (const q of pts) {
    const ci = Math.floor(q[0] / truck.CELL), cj = Math.floor((q[1] + DOLLY.plateTop) / truck.CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const fz = truck.front.get(`${ci + di},${cj + dj}`);
      if (fz !== undefined && fz - q[2] > need) { need = fz - q[2]; tight = {x: r3(q[0]), y: r3(q[1] + DOLLY.plateTop), truckZ: r3(fz)}; }
    }
  }
  const mountZ = Math.ceil((need + MOUNT.clear) * 1000 - 1e-6) / 1000;
  let radius = 0, radiusAll = 0;
  for (const q of pts) { const r = Math.hypot(q[0], q[2] + mountZ); if (r > radiusAll) radiusAll = r; if (q[1] <= bodyTop && r > radius) radius = r; }
  const plateFront = DOLLY.plate.z1 + DOLLY.truckZ;
  const res = {
    size: {w: r3(b.max[0] - b.min[0]), h: r3(H), d: r3(b.max[2] - b.min[2])},
    mountZ, face, bodyTop: r3(bodyTop),
    footprint: {w: r3(footW), d: r3(footD)},
    bounds: {x0: r3(b.min[0]), x1: r3(b.max[0]), z0: r3(b.min[2]), z1: r3(b.max[2])},
    radius: r3(radius),
    onTruck: {
      clearance: r4(mountZ - need), tightestAt: tight, radiusWithWhip: r3(radiusAll), truckRadius: r3(truck.radius),
      bodyTopAboveFloor: r3(DOLLY.plateTop + bodyTop), topAboveFloor: r3(DOLLY.plateTop + H),
      footprintFrontPastPlate: r3(Math.max(0, mountZ + foot.z1 - plateFront)),
    },
  };
  if (!(res.onTruck.clearance >= MOUNT.clear - 1e-9)) fail(`${m.id}: no clearance behind the module ${JSON.stringify(res.onTruck)}`);
  if (radius > DOLLY.radius + 1e-9 || radiusAll > MOUNT.hardRadius) fail(`${m.id}: outside the dolly's footprint circle: radius ${radius.toFixed(4)} (with whip ${radiusAll.toFixed(4)})`);
  if (res.onTruck.bodyTopAboveFloor > MOUNT.bodyTopMax || res.onTruck.topAboveFloor > MOUNT.topMax) fail(`${m.id}: too tall on the truck ${JSON.stringify(res.onTruck)}`);
  if (!(face.y1 > 0.4 && face.y1 <= bodyTop + 1e-9)) fail(`${m.id}: console face band implausible ${JSON.stringify(face)}`);
  return res;
}
async function cookModule(m, truck) {
  const o = await openRaw(m);
  const {foot, res: orient} = moduleFootprint(m, triangleList(o.doc), o.b0, o.ext);
  const s = MODULE_SCALE[m.key];
  bakeUniform(o, m, s, [(foot.x0 + foot.x1) / 2, (foot.z0 + foot.z1) / 2]);
  const f = await finish(o.doc, m);
  const M = measureModule(m, f.T, f.b, truck);
  return {...o, ...f, scale: s, orient: {...orient, result: 'Meshy native frame kept (no rotation): +Y up, the console face = +Z'},
    transform: 'fixed uniform scale, grounded (min y = 0), the cabinet footprint (the lowest 5 % of the height) centred on x / z, baked into the vertices (identity node); no rotation, no geometry simplification',
    convention: 'metres at runtime size, +Y up, origin at the bottom centre of the cabinet\'s footprint; +Z = the console face. On the hand truck the origin sits at (0, nose plate top, mountZ) in the dolly frame',
    measured: M,
    method: {
      mountZ: `the truck's cooked model (${DOLLY.truckUrl}, at z ${DOLLY.truckZ} in the dolly frame) sampled every 2 mm above its nose plate (top ${DOLLY.plateTop} m): frontmost z per 4 mm (x, y) cell; the module's samples must stay ${MOUNT.clear * 1000} mm in front of it in their own and the neighbouring cells; rounded up to a millimetre`,
      radius: `largest plan distance from the dolly origin of the mounted module's samples up to bodyTop (limit ${DOLLY.radius} m; a whip aerial may reach ${MOUNT.hardRadius} m)`,
      bodyTop: 'the top of the model without a whip aerial: 5 mm slabs from the top down are skipped while thinner than 3 cm both ways',
      face: 'from the base up, the run of 5 mm slabs in which the cabinet body (inside the footprint\'s width: no handles / leads) is at least 75 % as wide as the footprint = the cabinet / console front',
      footprint: 'the plan bounds of the lowest 5 % of the height (the cabinet\'s base)',
    }};
}

// ---------------------------------------------------------------------------------------------
// TURRET

/** Connected shells: vertices welded by position (10 um), union-find over the triangles, ordered by their first triangle. */
function components(P, I) {
  const nV = P.length / 3, key = new Map(), weld = new Uint32Array(nV);
  for (let i = 0; i < nV; i++) { const k = `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld[i] = w; }
  const parent = Uint32Array.from({length: key.size}, (_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let t = 0; t < I.length; t += 3) { const a = find(weld[I[t]]), b = find(weld[I[t + 1]]), c = find(weld[I[t + 2]]); parent[b] = a; parent[find(c)] = a; }
  const byRoot = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const r = find(weld[I[t]]);
    let c = byRoot.get(r);
    if (!c) byRoot.set(r, (c = {tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}));
    c.tris.push(t);
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = P[I[t + k] * 3 + a]; if (v < c.min[a]) c.min[a] = v; if (v > c.max[a]) c.max[a] = v; }
  }
  const comps = [...byRoot.values()].sort((a, b) => a.tris[0] - b.tris[0]);
  comps.forEach((c, i) => {
    c.id = i; c.n = c.tris.length; c.ext = [0, 1, 2].map(k => c.max[k] - c.min[k]);
    c.absZmin = c.min[2] > 0 ? c.min[2] : c.max[2] < 0 ? -c.max[2] : 0; // distance of the shell from the mirror plane z = 0
    const first = new Map();
    for (const t of c.tris) for (let k = 0; k < 3; k++) if (!first.has(weld[I[t + k]])) first.set(weld[I[t + k]], I[t + k]);
    c.pts = [...first.values()].map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  });
  return comps;
}
/** Squared distance point - triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function ptTri(p, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  const done = () => (p[0] - qx) ** 2 + (p[1] - qy) ** 2 + (p[2] - qz) ** 2;
  if (d1 <= 0 && d2 <= 0) { [qx, qy, qz] = a; return done(); }
  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { [qx, qy, qz] = b; return done(); }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = a[0] + v * abx; qy = a[1] + v * aby; qz = a[2] + v * abz; return done(); }
  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { [qx, qy, qz] = c; return done(); }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = a[0] + w * acx; qy = a[1] + w * acy; qz = a[2] + w * acz; return done(); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = b[0] + w * (c[0] - b[0]); qy = b[1] + w * (c[1] - b[1]); qz = b[2] + w * (c[2] - b[2]); return done(); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  qx = a[0] + abx * v + acx * w; qy = a[1] + aby * v + acy * w; qz = a[2] + abz * v + acz * w;
  return done();
}
/** The reviewed split (renders of every part, alone and posed, were inspected): shells / triangles per node. A different raw stops the cook. */
const TURRET_PINS = {shells: 284, base: [34, 2012], yoke: [58, 4001], head: [192, 12203]};
/**
 * Sorts the raw turret's shells into base / yoke / head. RAW frame (m): +Y up, the barrel along -X, mirror plane z = 0, the yoke's floor
 * at y ~ -0.10, the base flange below y -0.14. Unambiguous shells are SEEDED by where they are; the remaining small ones (bolts, hub
 * caps, latches, strips) join the class of the nearest already classified shell, nearest first.
 */
function classifyTurret(comps, P, I) {
  const V = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (const c of comps) {
    c.part = null;
    const halfZ = Math.max(-c.min[2], c.max[2]);
    // the power hose's lower run, its collar and the junction box it enters (on the flange's rim at the rear) ride with the yoke: the
    // hose is one piece from the yoke to that box, and the flange is a body of revolution under it, so nothing tears as the yoke turns
    if (c.max[1] <= -0.14 && c.min[0] >= 0.32 && halfZ <= 0.04) c.part = 'yoke';
    else if (c.max[1] <= -0.14) c.part = 'base'; // below the yoke: flange, slew rings, bolts
    else if (c.ext[2] > 0.3 && c.min[1] < -0.14 && c.max[1] > 0.05) c.part = 'yoke'; // the U frame
    else if (c.n > 500 && c.max[1] < -0.09 && c.min[0] > 0.3) c.part = 'yoke'; // the hose's upper run
    else if (c.n >= 100 && c.absZmin >= 0.07 && c.min[0] > 0.31 && c.max[1] < 0.11 && c.min[1] > -0.05) { c.part = 'yoke'; c.armPlate = true; } // rear arm plates
    else if (c.n >= 50 && c.absZmin >= 0.07 && c.max[1] < -0.03 && c.min[1] < -0.1 && c.ext[1] > 0.05) c.part = 'yoke'; // gussets
    else if (c.max[1] <= -0.10) c.part = 'yoke'; // at the rails / on the floor
    else if (c.n >= 200 || (c.absZmin === 0 && c.ext[2] > 0.1 && c.n >= 40)) c.part = 'head'; // big, or spanning the middle: gun body, pod, barrel
    else if (c.absZmin >= 0.07 && c.min[0] >= 0.14 && c.max[0] <= 0.326 && c.min[1] >= -0.06) c.part = 'head'; // the ammunition boxes' zone
    else if (c.absZmin >= 0.07 && halfZ <= 0.1 && c.min[0] >= 0.14 && c.max[0] <= 0.345 && c.min[1] >= -0.06) c.part = 'head'; // box mount strips on the body's sides
    c.seed = c.part !== null;
  }
  // growth: every open shell keeps, per class, the smallest vertex-to-surface distance (both directions, capped at 5 cm) to that
  // class's shells so far; the globally nearest one joins its class (a near tie close to the mirror plane = the gun), then the rest update
  const compDist = (a, b) => {
    if (a.min[0] - b.max[0] > 0.05 || b.min[0] - a.max[0] > 0.05 || a.min[1] - b.max[1] > 0.05 || b.min[1] - a.max[1] > 0.05 || a.min[2] - b.max[2] > 0.05 || b.min[2] - a.max[2] > 0.05) return 0.05;
    let m = Infinity;
    for (const p of a.pts) for (const t of b.tris) { const d = ptTri(p, V(I[t]), V(I[t + 1]), V(I[t + 2])); if (d < m) m = d; }
    for (const p of b.pts) for (const t of a.tris) { const d = ptTri(p, V(I[t]), V(I[t + 1]), V(I[t + 2])); if (d < m) m = d; }
    return Math.min(0.05, Math.sqrt(m));
  };
  const open = comps.filter(c => !c.part);
  for (const c of open) c.d = {yoke: Infinity, head: Infinity};
  // (the junction shells below the yoke are far from every open shell: they never decide a growth step)
  for (const s of comps) if (s.part === 'yoke' || s.part === 'head') for (const c of open) { const d = compDist(c, s); if (d < c.d[s.part]) c.d[s.part] = d; }
  let grown = 0, farthest = 0;
  while (open.length) {
    let bi = 0, bd = Infinity;
    open.forEach((c, i) => { const d = Math.min(c.d.yoke, c.d.head); if (d < bd - 1e-12) { bd = d; bi = i; } });
    const c = open.splice(bi, 1)[0];
    c.part = Math.abs(c.d.yoke - c.d.head) < 0.0015 && c.absZmin < 0.095 ? 'head' : c.d.yoke < c.d.head ? 'yoke' : 'head';
    grown++; farthest = Math.max(farthest, bd);
    for (const o of open) { const d = compDist(o, c); if (d < o.d[c.part]) o.d[c.part] = d; }
  }
  // the model is mirror-symmetric about z = 0: a shell and its mirror twin must land in the same node
  let mirrorMismatch = 0;
  for (const c of comps) {
    if (c.absZmin === 0) continue;
    const tw = comps.find(o => o !== c && Math.abs(o.min[0] - c.min[0]) < 0.006 && Math.abs(o.max[0] - c.max[0]) < 0.006 && Math.abs(o.min[1] - c.min[1]) < 0.006 && Math.abs(o.max[1] - c.max[1]) < 0.006 && Math.abs(o.min[2] + c.max[2]) < 0.012 && Math.abs(o.max[2] + c.min[2]) < 0.012);
    if (tw && tw.part !== c.part) mirrorMismatch++;
  }
  const count = part => { const l = comps.filter(c => c.part === part); return [l.length, l.reduce((s, c) => s + c.n, 0)]; };
  const split = {shells: comps.length, base: count('base'), yoke: count('yoke'), head: count('head'), seeded: comps.length - grown, grown, farthestJoinMm: r3(farthest * 1000), mirrorMismatch};
  if (mirrorMismatch) fail(`turret: ${mirrorMismatch} mirror twins were split across nodes`);
  if (farthest >= 0.02) fail(`turret: a shell joined its class from ${farthest} m away`);
  for (const k of ['base', 'yoke', 'head']) if (split[k][0] !== TURRET_PINS[k][0] || split[k][1] !== TURRET_PINS[k][1]) fail(`turret: the split differs from the reviewed one: ${JSON.stringify(split)}`);
  if (split.shells !== TURRET_PINS.shells) fail(`turret: ${split.shells} shells, reviewed ${TURRET_PINS.shells}`);
  return split;
}
/**
 * The two rear arm plates are OPEN shells on their inner side (at rest the gun's rear lies against it, so the raw never shows it);
 * tilting the head uncovers that side. Each is closed with a flat cap: a fan over the shell's open rim (its boundary loop in the plane
 * nearest the gun), wound to face the gun. No new texture: every cap vertex takes the texture coordinate of the nearest vertex (in the
 * plate's plane) of the shell's own OUTER face, so the inner face shows the same painted plate. RAW frame in and out.
 */
function capArmPlate(c, P, U, I) {
  const key = v => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`;
  const V = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const dir = new Map(); // directed edges of the shell, by welded position
  for (const t of c.tris) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; dir.set(`${key(a)}|${key(b)}`, [a, b]); }
  const side = c.min[2] > 0 ? 1 : -1, inner = side > 0 ? c.min[2] : c.max[2];
  const rim = [];
  for (const [k, [a, b]] of dir) {
    const [ka, kb] = k.split('|');
    if (!dir.has(`${kb}|${ka}`) && Math.abs(P[a * 3 + 2] - inner) <= 0.006 && Math.abs(P[b * 3 + 2] - inner) <= 0.006) rim.push({a, b, ka, kb});
  }
  const next = new Map(rim.map(e => [e.ka, e]));
  const loop = [];
  for (let e = rim[0]; e && loop.length < rim.length && !(loop.length && e === rim[0]); e = next.get(e.kb)) loop.push(e);
  if (rim.length < 12 || next.size !== rim.length || loop.length !== rim.length || next.get(loop[loop.length - 1].kb) !== rim[0]) fail(`turret: arm plate #${c.id}: its inner rim is not one simple loop (${rim.length} edges, ${loop.length} chained)`);
  const pts = loop.map(e => V(e.a));
  const centre = [0, 1, 2].map(k => mean(pts.map(q => q[k])));
  const length = loop.reduce((s, e) => s + Math.hypot(...V(e.a).map((v, k) => v - V(e.b)[k])), 0);
  // the cap runs the rim backwards (b -> a) so it continues the shell's outside; it must face the gun (the mirror plane) everywhere
  for (const e of loop) {
    const p = V(e.b), q = V(e.a);
    const nz = (q[0] - p[0]) * (centre[1] - p[1]) - (q[1] - p[1]) * (centre[0] - p[0]);
    if (!(nz * side < 0)) fail(`turret: arm plate #${c.id}: the cap would not face the gun (rim not star-shaped about its centre, or the shell is wound inwards)`);
  }
  // the shell's outer face: its triangles lying in the plate's plane on the far side
  const outer = new Set();
  for (const t of c.tris) {
    const p = V(I[t]), q = V(I[t + 1]), w = V(I[t + 2]);
    const n = [(q[1] - p[1]) * (w[2] - p[2]) - (q[2] - p[2]) * (w[1] - p[1]), (q[2] - p[2]) * (w[0] - p[0]) - (q[0] - p[0]) * (w[2] - p[2]), (q[0] - p[0]) * (w[1] - p[1]) - (q[1] - p[1]) * (w[0] - p[0])];
    if (Math.abs(n[2]) > 0.9 * Math.hypot(...n) && ((p[2] + q[2] + w[2]) / 3 - inner) * side > 0.5 * c.ext[2]) for (let k = 0; k < 3; k++) outer.add(I[t + k]);
  }
  if (outer.size < 3) fail(`turret: arm plate #${c.id}: no outer face found`);
  const uvOf = q => { let best = -1, bd = Infinity; for (const v of outer) { const d = (P[v * 3] - q[0]) ** 2 + (P[v * 3 + 1] - q[1]) ** 2; if (d < bd) { bd = d; best = v; } } return [U[best * 2], U[best * 2 + 1]]; };
  const pos = [...pts, centre]; // the rim's own vertices (no gap at the rim) + the fan's centre
  const idx = [];
  loop.forEach((e, i) => idx.push((i + 1) % loop.length, i, loop.length)); // (b, a, centre): loop[i].b is loop[i + 1].a
  return {pos, uv: pos.map(uvOf), normal: [0, 0, -side], idx, edges: loop.length, rimLength: length, flatness: hi(pts, q => Math.abs(q[2] - inner))};
}
/**
 * Tilt clearance (cooked frame): on a 2 mm (x, z) grid, the head tilted about the lateral axis through PITCH_PIVOT must not sink below
 * the top of the yoke + base in any column (columns that already overlap at rest are the mounts and are left out). Returns the
 * overlap area (cm2, deeper than 1 mm) per whole degree, and the largest clear angles (overlap <= 0.5 cm2) each way.
 */
function pitchClearance(headT, staticT, b) {
  const RES = 0.002, win = {min: [b.min[0] - 0.01, -1, -0.45], max: [b.max[0] + 0.01, 2, 0.75]};
  const stat = extremeMap(staticT, 0, 2, 1, 1, RES, win);
  const under = deg => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); // three.js rotation.x = a: positive lowers the +Z muzzle
    const T = deg === 0 ? headT : headT.map(t => t.map(q => { const y = q[1] - PITCH_PIVOT.y, z = q[2] - PITCH_PIVOT.z; return [q[0], PITCH_PIVOT.y + y * c - z * s, PITCH_PIVOT.z + y * s + z * c]; }));
    return extremeMap(T, 0, 2, 1, -1, RES, win);
  };
  const rest = under(0), skip = new Uint8Array(stat.m.length);
  for (let k = 0; k < skip.length; k++) if (Number.isFinite(rest.m[k]) && Number.isFinite(stat.m[k]) && rest.m[k] < stat.m[k] - 0.001) skip[k] = 1;
  const overlap = deg => {
    const h = under(deg);
    let cells = 0, deep = 0;
    for (let k = 0; k < skip.length; k++) { if (skip[k] || !Number.isFinite(h.m[k]) || !Number.isFinite(stat.m[k])) continue; const pen = stat.m[k] - h.m[k]; if (pen > 0.001) { cells++; if (pen > deep) deep = pen; } }
    return {cm2: +(cells * RES * RES * 1e4).toFixed(1), deepMm: Math.round(deep * 1000)};
  };
  const scan = (sign, max) => { const out = []; let clear = 0, open = true; for (let d = 1; d <= max; d++) { const o = overlap(sign * d); out.push(o); if (open && o.cm2 <= 0.5) clear = d; else open = false; } return {clear, out}; };
  const down = scan(1, 40), up = scan(-1, 12);
  const DOWN = [5, 10, 15, 20, 25, 30, 35, 40], UP = [2, 4, 6, 8, 10, 12], pick = (list, s, k) => Object.fromEntries(list.map(d => [d, s.out[d - 1][k]]));
  return {down: down.clear, up: up.clear, table: {downCm2: pick(DOWN, down, 'cm2'), downDeepMm: pick(DOWN, down, 'deepMm'), upCm2: pick(UP, up, 'cm2'), upDeepMm: pick(UP, up, 'deepMm')}};
}
async function cookTurret(m) {
  const o = await openRaw(m);
  const {doc, r, scene} = o;
  const prim = r.listMeshes()[0].listPrimitives()[0];
  if (prim.listSemantics().slice().sort().join() !== 'NORMAL,POSITION,TEXCOORD_0') fail(`turret: unexpected vertex attributes ${prim.listSemantics()}`);
  const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray(), U = prim.getAttribute('TEXCOORD_0').getArray(), I = prim.getIndices().getArray();
  const comps = components(P, I);
  const split = classifyTurret(comps, P, I);
  // orientation (raw frame, checked): the flange (the widest base shell) is the lowest thing; the barrel is the thin -X end
  const flange = comps.filter(c => c.part === 'base').sort((a, c) => c.ext[2] - a.ext[2] || a.id - c.id)[0];
  const barrel = comps.filter(c => c.part === 'head').sort((a, c) => a.min[0] - c.min[0] || a.id - c.id)[0];
  const orient = {upAxis: 'y', flangeUnderside: r4(flange.min[1] - o.b0.min[1]), flangeDiameter: [r4(flange.ext[0]), r4(flange.ext[2])], barrel: {reachesMinX: r4(barrel.min[0] - o.b0.min[0]), length: r4(barrel.ext[0]), thickness: [r4(barrel.ext[1]), r4(barrel.ext[2])]}};
  if (!(Math.abs(orient.flangeUnderside) < 1e-3 && Math.abs(flange.ext[0] - flange.ext[2]) < 0.004)) fail(`turret: the round flange is not the lowest part (+Y up?) ${JSON.stringify(orient)}`);
  if (!(Math.abs(orient.barrel.reachesMinX) < 1e-6 && barrel.ext[0] > 0.3 && barrel.ext[1] < 0.08 && barrel.ext[2] < 0.08)) fail(`turret: the barrel is not the thin -X end ${JSON.stringify(orient)}`);
  // the yaw axis: the flange's centre; the slew rings above it must agree
  const ax = (flange.min[0] + flange.max[0]) / 2, az = (flange.min[2] + flange.max[2]) / 2;
  for (const c of comps.filter(c => c.part === 'base' && c !== flange && c.ext[2] > 0.2)) if (Math.hypot((c.min[0] + c.max[0]) / 2 - ax, (c.min[2] + c.max[2]) / 2 - az) > 0.004) fail(`turret: slew ring #${c.id} is off the flange's axis`);
  // cooked frame: a quarter turn about +Y (raw -X -> +Z), origin on the yaw axis at the flange's underside; the head relative to its pivot
  const y0 = o.b0.min[1];
  const cook = i => [P[i * 3 + 2] - az, P[i * 3 + 1] - y0, -(P[i * 3] - ax)];
  const cookP = q => [q[2] - az, q[1] - y0, -(q[0] - ax)];
  const plates = comps.filter(c => c.armPlate);
  if (plates.length !== 2 || plates.some(c => c.part !== 'yoke')) fail(`turret: expected the two rear arm plates, found ${plates.length}`);
  const caps = plates.map(c => capArmPlate(c, P, U, I));
  const mat = prim.getMaterial(), buffer = r.listBuffers()[0];
  for (const n of r.listNodes()) n.dispose();
  for (const mesh of r.listMeshes()) mesh.dispose();
  const node = {};
  for (const part of ['base', 'yoke', 'head']) {
    const org = part === 'head' ? [PITCH_PIVOT.x, PITCH_PIVOT.y, PITCH_PIVOT.z] : [0, 0, 0];
    const map = new Map(), pos = [], nor = [], uv = [], idx = [];
    for (const c of comps) if (c.part === part) for (const t of c.tris) for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      let j = map.get(v);
      if (j === undefined) {
        j = map.size; map.set(v, j);
        const q = cook(v);
        pos.push(q[0] - org[0], q[1] - org[1], q[2] - org[2]);
        nor.push(N[v * 3 + 2], N[v * 3 + 1], -N[v * 3]);
        uv.push(U[v * 2], U[v * 2 + 1]);
      }
      idx.push(j);
    }
    if (part === 'yoke') for (const cap of caps) {
      const base = pos.length / 3;
      for (let i = 0; i < cap.pos.length; i++) { pos.push(...cookP(cap.pos[i])); nor.push(cap.normal[2], cap.normal[1], -cap.normal[0]); uv.push(...cap.uv[i]); }
      for (const i of cap.idx) idx.push(base + i);
    }
    const p = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer)).setMaterial(mat);
    node[part] = doc.createNode(`turret-${part}`).setMesh(doc.createMesh(`turret-${part}`).addPrimitive(p));
  }
  node.head.setTranslation([PITCH_PIVOT.x, PITCH_PIVOT.y, PITCH_PIVOT.z]);
  scene.addChild(node.base).addChild(node.yoke);
  node.yoke.addChild(node.head);
  mat.setName(m.id);
  const f = await finish(doc, m);
  const {chk, b, dims} = f;
  // structure: three named nodes, base + yoke at the origin under the scene, head under the yoke at the pivot, one shared material
  const cr = chk.getRoot(), names = cr.listNodes().map(n => n.getName()).sort().join();
  const nb = cr.listNodes().find(n => n.getName() === 'turret-base'), ny = cr.listNodes().find(n => n.getName() === 'turret-yoke'), nh = cr.listNodes().find(n => n.getName() === 'turret-head');
  if (names !== 'turret-base,turret-head,turret-yoke' || nh.getParentNode() !== ny || ny.getParentNode() !== null || nb.getParentNode() !== null) fail(`turret: node hierarchy wrong (${names})`);
  if ([nb, ny].some(n => n.getTranslation().some(v => v !== 0)) || [nb, ny, nh].some(n => n.getRotation().join() !== '0,0,0,1' || n.getScale().join() !== '1,1,1')) fail('turret: base / yoke must sit at the origin, no node may be rotated or scaled');
  if (nh.getTranslation().map(r4).join() !== [PITCH_PIVOT.x, PITCH_PIVOT.y, PITCH_PIVOT.z].join()) fail(`turret: head node not at the pivot (${nh.getTranslation()})`);
  const part = name => triangleList(chk, n => n === name);
  const headT = part('turret-head'), yokeT = part('turret-yoke'), baseT = part('turret-base');
  const bb = boundsOf(baseT), by = boundsOf(yokeT), bh = boundsOf(headT);
  // the base ring is centred on the yaw axis; the muzzle = the centre of the barrel's tip (the head's vertices within 4 mm of its front)
  if (Math.hypot(bb.min[0] + bb.max[0], bb.min[2] + bb.max[2]) / 2 > 2e-3 || Math.abs(bb.min[1]) > 1e-4) fail(`turret: base not centred on the yaw axis / grounded ${JSON.stringify(bb)}`);
  const tip = headT.flat().filter(q => q[2] > bh.max[2] - 0.004);
  const mid = k => (lo(tip, q => q[k]) + hi(tip, q => q[k])) / 2;
  const muzzle = {x: r3(mid(0)), y: r3(mid(1)), z: r3(bh.max[2])};
  if (!(Math.abs(muzzle.x) < 0.005 && muzzle.z > 0.6 && muzzle.y > PITCH_PIVOT.y)) fail(`turret: muzzle implausible ${JSON.stringify(muzzle)}`);
  const clear = pitchClearance(headT, [...yokeT, ...baseT], b);
  if (clear.down < PITCH_NEED.down || clear.up < PITCH_NEED.up) fail(`turret: the head does not clear the yoke over the needed tilt ${JSON.stringify(clear)}`);
  const planR = T => hi(T.flat(), q => Math.hypot(q[0], q[2]));
  const box = q => ({x0: r3(q.min[0]), x1: r3(q.max[0]), y0: r3(q.min[1]), y1: r3(q.max[1]), z0: r3(q.min[2]), z1: r3(q.max[2])});
  const measured = {
    size: {l: r3(dims[2]), h: r3(dims[1]), w: r3(dims[0])},
    pitch: true, pitchPivot: PITCH_PIVOT, muzzle,
    pitchClear: {down: clear.down, up: clear.up},
    baseRadius: r3(planR(baseT)), swingRadius: r3(Math.max(planR(yokeT), planR(headT))),
    parts: {base: box(bb), yoke: box(by), head: box(bh)},
    split, pitchOverlap: clear.table,
    caps: {count: caps.length, triangles: caps.reduce((t, c) => t + c.edges, 0), rimLengths: caps.map(c => r3(c.rimLength)), rimFlatnessMm: r3(Math.max(...caps.map(c => c.flatness)) * 1000), what: 'the two rear arm plates\' open inner sides (uncovered when the head tilts) closed with flat fans; texture coordinates taken from each plate\'s own outer face'},
  };
  return {...o, ...f, addedTris: measured.caps.triangles, scale: 1, orient: {...orient, yawAxisRaw: {x: r4(ax), z: r4(az)}, result: 'rotated a quarter turn about +Y (the raw barrel points -X): +Y up, +Z = the muzzle at rest'},
    transform: 'scale 1; a quarter turn about +Y, origin on the yaw axis (the base flange\'s centre) at the flange\'s underside (min y = 0), baked into the vertices; the mesh\'s 284 separate shells sorted (none cut) into three nodes sharing one material; two flat caps added (the rear arm plates\' open inner sides, which the tilt uncovers); the head\'s vertices are relative to its node at the tilt axis; no geometry simplification',
    convention: 'metres at runtime size, +Y up, origin on the yaw axis at the underside of the base ring; +Z = the muzzle at rest. Nodes: turret-base (fixed), turret-yoke (child of the scene root; yaw = rotation.y about its origin), turret-head (child of the yoke at pitchPivot; tilt = rotation.x about its origin, positive = muzzle down)',
    measured,
    method: {
      split: 'connected shells (vertices welded by position); shells are seeded into base / yoke / head by where they are, the remaining small ones join the class of the nearest classified shell (nearest first); mirror twins must agree; the result must equal the reviewed shell / triangle counts',
      caps: 'each rear arm plate is an open shell whose boundary loop lies in its innermost plane: a triangle fan over that loop about its centre, wound to continue the shell\'s outside (facing the gun); each cap vertex takes the texture coordinate of the nearest vertex of the plate\'s own outer face (no new texture)',
      pitchPivot: 'chosen, not a modelled hinge: the lateral axis that lets the gun depress in front of the yoke (the modelled hub discs on the rear arms would only allow ~6 degrees before the nose meets the yoke floor)',
      pitchClear: 'column test on a 2 mm plan grid: the tilted head\'s underside against the top of the yoke + base, columns overlapping at rest (the mounts) left out; the largest whole-degree angle each way with at most 0.5 cm2 deeper than 1 mm',
      muzzle: 'the centre of the head\'s vertices within 4 mm of its front end (the barrel\'s tip), at rest',
      yawAxis: 'the centre of the base flange\'s bounds (the slew rings agree within 4 mm)',
    }};
}

// ---------------------------------------------------------------------------------------------
// Cook all five

const truck = await loadTruck();
for (const m of MODELS) {
  m.out = m.kind === 'bench' ? await cookBench(m) : m.kind === 'module' ? await cookModule(m, truck) : await cookTurret(m);
  const o = m.out;
  if (o.outTris !== o.rawTris + (o.addedTris ?? 0)) fail(`${m.id}: triangle count changed ${o.rawTris} -> ${o.outTris}`);
  console.log(`${m.id}: ${o.rawTris} tris, ${(m.rawBytes.length / 1e6).toFixed(2)} MB -> ${(o.glb.length / 1e6).toFixed(3)} MB (${o.outTris} tris), dims ${o.dims.join(' x ')} m, scale ${o.scale.toFixed(5)}, sha256 ${sha(o.glb)}`);
  console.log(o.textures.map(t => `  ${t.slot} ${t.size?.join('x')} ${t.mime} ${t.bytes} B`).join('\n'));
  console.log('  orientation', JSON.stringify(o.orient));
  console.log('  measured', JSON.stringify(o.measured));
}
if (DRY) process.exit(0);

// ---------------------------------------------------------------------------------------------
// Write: models, provenance, generated module, CREDITS section, allowlist

const rel = m => `assets/models/${m.id}.glb`;
for (const m of MODELS) fs.writeFileSync(path.join(PUB, rel(m)), m.out.glb);
const T = manifest.totals;
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: PROV_ID,
  what: 'the train crafting equipment: the crafting bench, the three device modules that stand on a hand truck (route radar, sentry control, item / enemy scanner) and the sentry\'s roof turret',
  task: TASK,
  approval: `task-specific user generation approval (sha256 ${AUTHORITY}): the bench, three modules and roof turret, up to ${ack.caps.credits} Meshy credits`,
  accepted: true,
  route: 'Codex native image_gen INITIAL design -> Meshy T2.5 image-to-3D, own PBR maps kept',
  budget: {generations: T.generations, paidRequests: T.paidPosts, billedCredits: T.billedCredits, creditsPerModel: ack.pricePerJobCredits, caps: {credits: ack.caps.credits, generations: ack.caps.generations, requests: ack.caps.posts}, note: 'every model is the first Meshy attempt of its design image'},
  meshyTool: `${MODELS[0].tool} (the project's Meshy MCP entry)`,
  evidence: 'the exact create arguments, task ids, charges and raw hashes are in the job ledger and the production input manifest kept outside Git; this cook verifies every raw original and conditioning image against them before it writes',
  texturePolicy: `Meshy maps kept channel for channel (base colour, packed metallic-roughness, normal), Lanczos downsize + JPEG: base ${TEX.base} px q${TEX.quality}, metallic-roughness ${TEX.mr} px q${TEX.quality}, normal ${TEX.normal} px q${TEX.normalQuality}; no reprojection / retexture / repaint`,
  handTruck: {url: DOLLY.truckUrl, sha256: truck.sha256, bytes: truck.bytes, dollyFrame: {truckZ: DOLLY.truckZ, plateTop: DOLLY.plateTop, footprintRadius: DOLLY.radius}, note: 'the existing hand truck model the modules stand on (not changed by this cook); it alone reaches the truckRadius recorded per module'},
  licence: 'generated for this project under the existing provider accounts; no blanket licence or commercial clearance implied (assets/CREDITS.md)',
  models: MODELS.map(m => {
    const o = m.out, a = m.rec;
    return {
      id: m.id, what: m.what,
      conditioningImage: {sha256: a.conditioningImage.sha256, bytes: a.conditioningImage.bytes, size: a.conditioningImage.size, generator: a.conditioningImage.generator, file: `${TASK_DIR}/${a.conditioningImage.file} (raw original, outside Git)`},
      meshy: {task: a.meshyTask, request: a.request, status: a.status, billedCredits: a.billedCredits, attempt: 1},
      source: {file: `${TASK_DIR}/${a.raw.file} (raw original, outside Git)`, sha256: a.raw.sha256, bytes: a.raw.bytes, triangles: o.rawTris, extent: o.ext.map(r4), textures: o.rawTex},
      output: {file: `game/public/${rel(m)}`, url: rel(m), sha256: sha(o.glb), bytes: o.glb.length, triangles: o.outTris, dims: o.dims},
      scale: +o.scale.toFixed(6),
      orientation: o.orient, transform: o.transform, convention: o.convention,
      measured: o.measured, measureMethod: o.method,
      textures: o.textures,
    };
  }),
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces\/|\/home\/|prompt).{0,20}/i); if (hit) fail(`URL / token / local path / generation text in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);

const lit = o => JSON.stringify(o).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1: ').replace(/,/g, ', ').replace(/"/g, '\'');
const by = Object.fromEntries(MODELS.map(m => [m.key, m]));
const modelLine = m => {
  const o = m.out, tex = Object.fromEntries(o.textures.map(t => [t.slot, t.size]));
  return `  ${m.key}: {key: '${m.id}', url: '${rel(m)}', bytes: ${o.glb.length}, tris: ${o.outTris}, dims: [${o.dims.join(', ')}] as const, textures: {baseColor: [${tex.baseColor.join(', ')}] as const, metallicRoughness: [${tex.metallicRoughness.join(', ')}] as const, normal: [${tex.normal.join(', ')}] as const}},`;
};
const B = by.bench.out.measured, TU = by.turret.out.measured;
const moduleLine = k => { const M = by[k].out.measured; return `  ${k}: ${lit({size: M.size, mountZ: M.mountZ, face: M.face, bodyTop: M.bodyTop, footprint: M.footprint, bounds: M.bounds, radius: M.radius})},`; };
const reg = `// GENERATED by ${SCRIPT} — do not edit (task ${TASK}).
// The crafting bench, the three device modules and the roof turret: Meshy T2.5 image-to-3D derivatives of one Codex design image each,
// their own PBR maps kept (provenance ${PROV_REL}). craft/trainFixtures.ts, world/trainEquipmentModel.ts,
// world/craftBench.ts and world/sentryTurret.ts read this.
// Model frames (metres at runtime size, +Y up, grounded: min y = 0; one material per model):
//  - bench: origin at the bottom centre of its footprint; +Z = the front (the side the player stands at), X along the wall it stands
//    against (vise at -X, gauge box at +X). One mesh, identity node.
//  - modules (radar / sentry / scanner): origin at the bottom centre of the CABINET's footprint (handles, leads, the antenna bar and the
//    hood reach past it: \`bounds\`); +Z = the console face. One mesh, identity node. They stand on the hand truck's nose plate
//    (world/fuelCartModel.ts): origin at (0, plate top, mountZ) in the dolly frame.
//  - turret: origin on the yaw axis at the underside of the base ring; +Z = the muzzle direction at rest. Nodes: 'turret-base' (fixed),
//    'turret-yoke' (child of the root, turns about +Y through the origin: set rotation.y), 'turret-head' (child of the yoke, translated
//    to \`pitchPivot\`, tilts about the X axis through it: set rotation.x, POSITIVE = muzzle DOWN). \`pitch: false\` would mean the head
//    could not be separated (then 'turret-head' would be absent); it could.
export const TRAIN_EQUIPMENT_MODELS = {
${MODELS.map(modelLine).join('\n')}
} as const;

/**
 * The bench: length along X, height (to the top of its bolted-down fixtures), depth along Z (the vise's screw handle included); the
 * worktop's height. Added by the cook: \`worktop\` = the wooden top's extent as seen from above, \`free\` = the largest rectangle of it
 * with nothing standing in it (the front strip beside the vise, in front of the grinder and the gauge box), \`shelfY\` = the wire-mesh
 * lower shelf's top. The vise, grinder and gauge box are bolted-down fixtures of the model; nothing loose is baked in.
 */
export const TRAIN_BENCH_MEASURED = {
  size: ${lit(B.size)},
  worktopY: ${B.worktopY},
  worktop: ${lit(B.worktop)},
  free: ${lit(B.free)},
  shelfY: ${B.shelfY},
} as const;

/**
 * The device modules: overall size (w along X, h, d along Z) and where the module's origin sits on the hand truck (\`mountZ\`, the dolly
 * frame's z: world/fuelCartModel.ts CART_LOOK; y = the nose plate's top): ${MOUNT.clear * 1000} mm in front of the truck's uprights, truck + module inside the
 * dolly's ${DOLLY.radius} m footprint circle. \`face\` = the cabinet / console front's band (y0..y1 over the module's base) the player aims at to
 * use it. Added by the cook: \`bodyTop\` = the top without a whip aerial, \`footprint\` = the cabinet's base (centred on the origin),
 * \`bounds\` = the plan bounds of everything (model frame), \`radius\` = the mounted module's largest plan distance from the dolly origin.
 */
export const TRAIN_MODULE_MEASURED = {
${['radar', 'sentry', 'scanner'].map(moduleLine).join('\n')}
} as const;

/**
 * The roof turret: size at rest (l along Z, h, w along X), the tilt axis (the lateral axis through \`pitchPivot\`: a chosen axis that
 * lets the gun depress, not the modelled hub discs), the muzzle = the barrel tip's centre at rest (model frame). Added by the cook:
 * \`pitchClear\` = the largest tilt in whole degrees each way at which the head still clears the yoke (down = positive rotation.x),
 * \`baseRadius\` = the fixed base ring's plan radius, \`swingRadius\` = the largest plan distance of the turning parts from the yaw axis.
 */
export const TRAIN_TURRET_MEASURED = {
  size: ${lit(TU.size)},
  pitch: true,
  pitchPivot: ${lit(TU.pitchPivot)},
  muzzle: ${lit(TU.muzzle)},
  pitchClear: ${lit(TU.pitchClear)},
  baseRadius: ${TU.baseRadius},
  swingRadius: ${TU.swingRadius},
} as const;
`;
fs.writeFileSync(REG, reg);

const credSection = [CREDITS_BEGIN, '## Train crafting equipment', '',
  `Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded only). Task ${TASK} under the user's crafting-equipment authorization (${T.billedCredits} of up to ${ack.caps.credits} credits, ${T.generations} generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by \`${SCRIPT}\` (provenance: \`${PROV_REL}\`).`, '',
  ...MODELS.map(m => `- \`${rel(m)}\` — ${m.credit} (Meshy task ${m.rec.meshyTask}).`),
  CREDITS_END].join('\n');
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
if (!credRe.test(credSrc) && !credSrc.includes(CREDITS_AFTER)) fail('CREDITS.md: neither the train equipment section nor the train chipper section marker found');
fs.writeFileSync(CREDITS, credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : credSrc.replace(CREDITS_AFTER, `${CREDITS_AFTER}\n\n${credSection}`));

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([...MODELS.map(rel), PROV_REL, 'assets/CREDITS.md'].map(p => [p, fs.readFileSync(path.join(PUB, p))]));
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${MODELS.map(rel).join(', ')}, ${PROV_REL}, ${path.relative(root, REG)}, assets/CREDITS.md, tools/release/public-inputs.json`);
