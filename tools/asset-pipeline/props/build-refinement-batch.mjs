// Task studio-refinement-batch-20261113-035659-01 (lead): the runtime derivatives of the refinement batch's FOUR new models — the train
// ARMOUR kit (a side skirt segment and an end plough) and the two crafted throwables (the Acid Scrapper Grenade's caged acid jar and the
// Zombie Lure's wrapped tin) — from their Meshy T2.5 smart-topology image-to-3D originals, each conditioned on one Codex INITIAL design
// image (route Codex -> Meshy; every model keeps Meshy's own PBR maps, re-encoded only). The Save terminal reuses an existing model
// (assets/models/p7-crt-terminal-t25.glb): nothing is cooked for it here.
//
// Reads (never modifies) the immutable raw originals + the job records kept OUTSIDE Git in
//   reference/tasks/refinement-batch-20261113-035659/{finance/ledger.jsonl, gen/codex/codex.jsonl, gen/raw/<raw>.glb, gen/out/<image>.png}
// (each raw + conditioning image is verified against the ledger's reserve / raw / accept rows and the Codex log: a mismatch stops the
// cook) and writes deterministically:
//   game/public/assets/models/{train-armor-side,train-armor-end,item-acid-grenade,item-lure-grenade}.glb
//   game/public/assets/derivatives/refinement-batch-20261113.json   (provenance; hash-only: no generation text / URLs / private paths)
//   game/src/assets/trainArmor.generated.ts + game/src/assets/grenades.generated.ts   (urls / bytes / tris / dims the runtime reads)
//   game/public/assets/CREDITS.md (its marked section) + tools/release/public-inputs.json (only this script's paths + CREDITS.md)
//
// Derivatives (every frame is measured on the mesh, never assumed): metres, +Y up, grounded (min y = 0), transforms baked into the
// vertices, one material each with Meshy's base colour / packed metallic-roughness / normal maps (Lanczos downsize, JPEG): no
// reprojection / retexture / repaint. Task studio-train-armor-palette-20261113-213306-01: the two ARMOUR models' base colour maps carry
// THE ARMOUR'S PALETTE GRADE (lib/armor-palette.mjs: a deterministic per-texel grade of Meshy's own map toward the car body's own light
// steel, rust kept as accents; applied to the raw map before its downsize; their other two maps and the throwables' maps as before).
// No geometry simplification (Smart Topology made the requested triangle targets).
//  - ARMOUR SIDE: native frame kept (length along X, blades toward +Z — checked: the blade side is the deeper, rougher side), uniform
//    scale to the reference length SIDE_L, origin at the bottom centre of the BACK (mounting) face: z = 0 at the back.
//  - ARMOUR END: Meshy reconstructed the straight-on plough design as a symmetric deep sled (a plough on +Z and another on -Z). Kept:
//    the +Z half. Every vertex behind the mounting plane (the bounds' mid-depth) is projected onto it, which folds the rear half flat
//    into a closed back plate (no triangle is cut or added), then the depth is scaled to END_D at the reference width END_W
//    (processing of the generated mesh, not authoring). Origin as the side segment's.
//  - GRENADES: uniform scale to the item height, origin at the bottom centre, front (+Z) as generated (the biohazard band / the red tape).
//
// Usage: node tools/asset-pipeline/props/build-refinement-batch.mjs [--dry-run]
//   (the private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

import {ARMOR_PALETTE, applyArmorPalette, armorPaletteNote, armorPaletteRecord} from './lib/armor-palette.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-refinement-batch-20261113-035659-01';
const GRANT = '39e43eef-e262-431f-af78-c1fbef081438';
const TASK_DIR = 'reference/tasks/refinement-batch-20261113-035659';
const SCRIPT = 'tools/asset-pipeline/props/build-refinement-batch.mjs';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const TDIR = path.join(REF_ROOT, TASK_DIR);
const PROV_ID = 'refinement-batch-20261113';
const PROV_REL = `assets/derivatives/${PROV_ID}.json`;
const PUB = path.join(root, 'game/public');
const REG_ARMOR = path.join(root, 'game/src/assets/trainArmor.generated.ts');
const REG_GRENADE = path.join(root, 'game/src/assets/grenades.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN refinement-batch-models-20261113 (build-refinement-batch.mjs) -->';
const CREDITS_END = '<!-- END refinement-batch-models-20261113 -->';
const DRY = process.argv.includes('--dry-run');

/** Reference sizes (m). The armour layout (world/trainArmor.ts) fits these to the car; the throwables are hand-sized canisters. */
const SIDE_L = 2.4;
const END_W = 2.6, END_D = 0.55;
const ITEM_H = {ACID: 0.15, LURE: 0.14};
/** Texture policy (px, JPEG quality): the armour kit covers a whole car seen from a few metres (the chipper's / bench's policy); the
 *  throwables are held right in front of the camera (viewmodel), so their base colour stays 1024 too. */
const TEX = {
  armor: {base: 1024, normal: 1024, mr: 512, quality: 85, normalQuality: 90},
  item: {base: 1024, normal: 512, mr: 256, quality: 85, normalQuality: 90},
};

const MODELS = [
  {asset: 'ARMOR_SIDE', id: 'train-armor-side', key: 'side', kind: 'armorSide', tex: 'armor',
    what: 'the train ARMOUR side skirt segment: overlapping welded rusted steel plates with a row of blades and spikes, two half-sunk circular saw discs, hazard stripes and a top rail',
    credit: 'the train armour\'s side skirt segment (welded rusted plates, a row of blades and spikes, two saw discs; tiled along both sides)'},
  {asset: 'ARMOR_END', id: 'train-armor-end', key: 'end', kind: 'armorEnd', tex: 'armor',
    what: 'the train ARMOUR end plough: a welded steel pilot grille with a row of long tapered fins, two circular saw discs at the corners and a hazard-striped top beam',
    credit: 'the train armour\'s end plough (welded pilot grille with long tapered fins and two saw discs; one at each end of the car)'},
  {asset: 'ACID', id: 'item-acid-grenade', key: 'acid', kind: 'item', tex: 'item',
    what: 'the ACID SCRAPPER GRENADE: a thick glass jar of glowing green liquid in a welded wire cage, a taped screw cap with a twisted pull ring and a biohazard-yellow band',
    credit: 'the Acid Scrapper Grenade (caged glass jar of green acid, taped cap and pull ring)'},
  {asset: 'LURE', id: 'item-lure-grenade', key: 'lure', kind: 'item', tex: 'item',
    what: 'the ZOMBIE LURE: a dented tin wrapped in stained cloth and rope with a red tape band, a perforated lid, a short wick and a pull ring',
    credit: 'the Zombie Lure (a cloth- and rope-wrapped tin with a perforated lid, wick and pull ring)'},
];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { throw new Error(`build-refinement-batch: ${m}`); };
const r4 = v => +v.toFixed(4);

// ---------------------------------------------------------------------------------------------
// Records: the ledger (sole writer: the task's broker) and the Codex log are the authority

const readRec = rel => fs.readFileSync(path.join(TDIR, rel));
const ledger = readRec('finance/ledger.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
const codex = readRec('gen/codex/codex.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
{
  const grant = ledger.filter(e => e.event === 'AUTHORIZE_FRESH_GRANT');
  if (grant.length !== 1 || grant[0].grantId !== GRANT || grant[0].credits !== 75) fail('ledger grant row missing / mismatched');
  if (ledger.some(e => e.event !== 'AUTHORIZE_FRESH_GRANT' && e.grantId !== GRANT)) fail('a ledger row of another grant');
}
const billedTotal = ledger.filter(e => e.event === 'settle').reduce((s, e) => s + (e.billed ?? 0), 0);
const generations = ledger.filter(e => e.event === 'reserve').length;
if (billedTotal > 75) fail(`ledger billed ${billedTotal} > the 75-credit cap`);
for (const m of MODELS) {
  const mine = ledger.filter(e => e.asset === m.asset && e.event !== 'price');
  const accepts = mine.filter(e => e.event === 'accept');
  if (accepts.length !== 1) fail(`${m.asset}: expected exactly one ledger accept, found ${accepts.length}`);
  const res = accepts[0].res;
  if (mine.some(e => e.res !== res)) fail(`${m.asset}: the ledger holds another attempt (expected the first attempt only)`);
  const one = ev => { const l = mine.filter(e => e.event === ev); if (l.length !== 1) fail(`${m.asset}: expected one '${ev}' line, found ${l.length}`); return l[0]; };
  const reserve = one('reserve'), posted = one('posted'), settle = one('settle'), raw = one('raw');
  if (settle.status !== 'SUCCEEDED' || settle.billed !== reserve.credits) fail(`${m.asset}: settle ${settle.status} / billed ${settle.billed}`);
  if (!reserve.priceEvidence?.sha256) fail(`${m.asset}: the reservation carries no price evidence`);
  const img = fs.readFileSync(reserve.input), rawBytes = fs.readFileSync(raw.file);
  if (sha(img) !== reserve.inputSha256 || img.length !== reserve.inputBytes) fail(`${m.asset}: conditioning image differs from its reservation`);
  if (sha(rawBytes) !== raw.sha256 || rawBytes.length !== raw.bytes) fail(`${m.asset}: raw differs from its ledger row`);
  const cx = codex.find(r => r.phase === 'result' && r.status === 'ok' && r.id === m.asset && r.sha256 === reserve.inputSha256);
  if (!cx || cx.imageGenGenerations !== 1) fail(`${m.asset}: conditioning image is not a recorded single Codex image_gen output`);
  const {file_path: _f, ...request} = reserve.params;
  const meta = await sharp(img).metadata();
  m.rec = {res, meshyTask: posted.taskId, request, billedCredits: settle.billed, priceEvidenceSha256: reserve.priceEvidence.sha256,
    conditioningImage: {sha256: reserve.inputSha256, bytes: img.length, size: `${meta.width}x${meta.height}`, attempt: cx.attempt,
      generator: 'Codex CLI built-in image_gen (ChatGPT login); image model id not reported', file: path.relative(TDIR, reserve.input)},
    raw: {sha256: raw.sha256, bytes: raw.bytes, file: path.relative(TDIR, raw.file)}};
  m.tool = reserve.tool;
  m.rawBytes = rawBytes;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tris = d => d.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
function triangleList(d) {
  const out = [];
  for (const n of d.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
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

async function openRaw(m) {
  const doc = await io.readBinary(new Uint8Array(m.rawBytes));
  const r = doc.getRoot();
  const rawTris = tris(doc);
  const rawTex = r.listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  if (r.listMeshes().length !== 1 || r.listMeshes()[0].listPrimitives().length !== 1 || r.listMaterials().length !== 1) fail(`${m.asset}: expected one mesh, one primitive, one material in the raw`);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  return {doc, r, rawTris, rawTex, b0, ext: [0, 1, 2].map(k => b0.max[k] - b0.min[k])};
}
function compactIndices(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    if (idx && p.getAttribute('POSITION').getCount() <= 65535 && !(idx.getArray() instanceof Uint16Array)) idx.setArray(Uint16Array.from(idx.getArray()));
  }
}
/** The single primitive's POSITION array (edited in place) after node transforms were cleared. */
const positions = o => o.r.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
/** Column-major affine: per-axis scale s about `origin` (x, y, z in the raw frame) after an optional half turn about Y. */
function bake(o, m, s, origin, halfTurn = false) {
  const [sx, sy, sz] = s, h = halfTurn ? -1 : 1;
  const M = [h * sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, h * sz, 0, -h * sx * origin[0], -sy * origin[1], -h * sz * origin[2], 1];
  for (const mesh of o.r.listMeshes()) transformMesh(mesh, M);
  o.r.listMeshes()[0].setName(m.id);
  o.r.listNodes().filter(n => n.getMesh())[0].setName(m.id);
  o.r.listMaterials()[0].setName(m.id);
}
async function finish(doc, m) {
  const r = doc.getRoot(), tx = TEX[m.tex];
  compactIndices(doc);
  // task train-armor-palette: the armour's palette grade of the raw base colour map, before its downsize (lib/armor-palette.mjs);
  // the throwables keep their maps as they are
  const palette = m.tex === 'armor' ? await applyArmorPalette(doc, sharp, sha) : null;
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tx.base, tx.base], quality: tx.quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tx.mr, tx.mr], quality: tx.quality, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tx.normal, tx.normal], quality: tx.normalQuality, slots: /^normal/}));
  r.getAsset().generator = `Terminal State ${SCRIPT} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) fail(`${m.id}: URL/token-like string inside the glTF JSON`);
  const chk = await io.readBinary(new Uint8Array(glb));
  const mats = chk.getRoot().listMaterials();
  if (mats.length !== 1 || !mats[0].getBaseColorTexture() || !mats[0].getMetallicRoughnessTexture() || !mats[0].getNormalTexture()) fail(`${m.id}: expected one material with base colour, metallic-roughness and normal maps`);
  const textures = chk.getRoot().listTextures().map(t => {
    const q = mats[0];
    const slot = [['baseColor', q.getBaseColorTexture()], ['metallicRoughness', q.getMetallicRoughnessTexture()], ['normal', q.getNormalTexture()]].find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  if (textures.length !== 3 || textures.some(t => t.slot === 'unused' || t.mime !== 'image/jpeg')) fail(`${m.id}: expected exactly the three JPEG maps, got ${JSON.stringify(textures.map(t => [t.slot, t.mime]))}`);
  const T = triangleList(chk), b = boundsOf(T);
  if (Math.abs(b.min[1]) > 1e-4) fail(`${m.id}: not grounded (min y ${b.min[1]})`);
  return {glb, textures, palette, T, b, dims: [0, 1, 2].map(k => r4(b.max[k] - b.min[k])), outTris: tris(chk)};
}

/** Mean |depth - plane| of the outermost surface seen from each Z side: the flat mounting back is the SMOOTHER side. */
function sideRoughness(T, b) {
  const RES = 0.01, nx = Math.ceil((b.max[0] - b.min[0]) / RES), ny = Math.ceil((b.max[1] - b.min[1]) / RES);
  const front = new Float64Array(nx * ny).fill(-Infinity), back = new Float64Array(nx * ny).fill(Infinity);
  for (const t of T) for (const q of t) {
    const i = Math.min(nx - 1, Math.floor((q[0] - b.min[0]) / RES)), j = Math.min(ny - 1, Math.floor((q[1] - b.min[1]) / RES)), k = i * ny + j;
    if (q[2] > front[k]) front[k] = q[2];
    if (q[2] < back[k]) back[k] = q[2];
  }
  const dev = (a, ref) => { let s = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { s += Math.abs(v - ref); n++; } return n ? s / n : 0; };
  return {front: dev(front, b.max[2]), back: dev(back, b.min[2])};
}

// ---------------------------------------------------------------------------------------------
// Cooks

async function cookSide(m) {
  const o = await openRaw(m);
  const T0 = triangleList(o.doc), b = boundsOf(T0);
  if (!(o.ext[0] > 3 * o.ext[1] && o.ext[0] > 3 * o.ext[2])) fail(`side: expected a long strip along X, raw extent ${o.ext.map(r4)}`);
  const rough = sideRoughness(T0, b), halfTurn = rough.back > rough.front; // blades (the rough side) end up toward +Z
  const s = SIDE_L / o.ext[0];
  const backZ = halfTurn ? b.max[2] : b.min[2];
  bake(o, m, [s, s, s], [(b.min[0] + b.max[0]) / 2, b.min[1], backZ], halfTurn);
  const out = await finish(o.doc, m);
  if (Math.abs(out.b.min[2]) > 1e-4) fail('side: the back face is not at z = 0');
  return {...out, rawTris: o.rawTris, rawTex: o.rawTex, ext: o.ext, scale: [s, s, s], halfTurn, roughness: {front: r4(rough.front), back: r4(rough.back)},
    convention: 'length along X, up +Y, the blade side toward +Z; origin = bottom centre of the back (mounting) face (z = 0 at the back)'};
}

async function cookEnd(m) {
  const o = await openRaw(m);
  const T0 = triangleList(o.doc), b = boundsOf(T0);
  // keep the +Z half: vertices behind the mid-depth plane are projected onto it (the rear half folds flat into a closed back plate)
  const zMid = (b.min[2] + b.max[2]) / 2;
  const P = positions(o), A = P.getArray();
  let folded = 0;
  for (let i = 2; i < A.length; i += 3) if (A[i] < zMid) { A[i] = zMid; folded++; }
  P.setArray(A);
  const s = END_W / o.ext[0], sz = END_D / (b.max[2] - zMid);
  bake(o, m, [s, s, sz], [(b.min[0] + b.max[0]) / 2, b.min[1], zMid]);
  const out = await finish(o.doc, m);
  if (Math.abs(out.b.min[2]) > 1e-4) fail('end: the back plate is not at z = 0');
  return {...out, rawTris: o.rawTris, rawTex: o.rawTex, ext: o.ext, scale: [s, s, sz], foldedVertices: folded, foldPlaneRawZ: r4(zMid),
    convention: 'width along X, up +Y, the fins toward +Z; origin = bottom centre of the back plate (z = 0 at the back); the raw\'s rear half folded flat onto the back plate, depth scaled'};
}

async function cookItem(m) {
  const o = await openRaw(m);
  if (!(o.ext[1] > o.ext[0] && o.ext[1] > o.ext[2])) fail(`${m.asset}: expected an upright canister (tallest along Y), raw extent ${o.ext.map(r4)}`);
  const s = ITEM_H[m.asset] / o.ext[1];
  bake(o, m, [s, s, s], [(o.b0.min[0] + o.b0.max[0]) / 2, o.b0.min[1], (o.b0.min[2] + o.b0.max[2]) / 2]);
  const out = await finish(o.doc, m);
  return {...out, rawTris: o.rawTris, rawTex: o.rawTex, ext: o.ext, scale: [s, s, s],
    convention: 'upright, origin at the bottom centre, front +Z as generated'};
}

for (const m of MODELS) {
  m.out = m.asset === 'ARMOR_SIDE' ? await cookSide(m) : m.asset === 'ARMOR_END' ? await cookEnd(m) : await cookItem(m);
  console.log(`${m.id}: ${m.out.glb.length} B, ${m.out.outTris} tris, dims ${m.out.dims.join(' x ')} m, scale ${m.out.scale.map(v => v.toFixed(4)).join(',')}`);
}
if (DRY) process.exit(0);

// ---------------------------------------------------------------------------------------------
// Write: models, provenance, generated modules, CREDITS section, allowlist

const rel = m => `assets/models/${m.id}.glb`;
for (const m of MODELS) fs.writeFileSync(path.join(PUB, rel(m)), m.out.glb);
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: PROV_ID,
  what: 'the refinement batch\'s new models: the train armour kit (side skirt segment, end plough) and the two crafted throwables (Acid Scrapper Grenade, Zombie Lure)',
  task: TASK,
  approval: `task-specific user generation grant ${GRANT}: a fresh cap of 75 Meshy credits for the batch's asset targets, reuse first`,
  accepted: true,
  route: 'Codex native image_gen INITIAL design -> Meshy T2.5 image-to-3D, own PBR maps kept',
  budget: {generations, billedCredits: billedTotal, capCredits: 75, creditsPerModel: 15, note: 'every model is the first Meshy attempt of its design image; the Save terminal reuses assets/models/p7-crt-terminal-t25.glb'},
  meshyTool: `${MODELS[0].tool} (the project's Meshy MCP entry)`,
  evidence: 'the exact create arguments, task ids, charges, price evidence and raw hashes are in the job ledger kept outside Git; this cook verifies every raw original and conditioning image against it before it writes',
  licence: 'generated for this project under the existing provider accounts; no blanket licence or commercial clearance implied (assets/CREDITS.md)',
  palette: {...armorPaletteRecord(), models: MODELS.filter(m => m.out.palette).map(m => m.id)},
  models: MODELS.map(m => {
    const o = m.out, a = m.rec, tx = TEX[m.tex];
    return {
      id: m.id, what: m.what,
      conditioningImage: {sha256: a.conditioningImage.sha256, bytes: a.conditioningImage.bytes, size: a.conditioningImage.size, codexAttempt: a.conditioningImage.attempt, generator: a.conditioningImage.generator, file: `${TASK_DIR}/${a.conditioningImage.file} (raw original, outside Git)`},
      meshy: {task: a.meshyTask, request: a.request, status: 'SUCCEEDED', billedCredits: a.billedCredits, attempt: 1, priceEvidenceSha256: a.priceEvidenceSha256},
      source: {file: `${TASK_DIR}/${a.raw.file} (raw original, outside Git)`, sha256: a.raw.sha256, bytes: a.raw.bytes, triangles: o.rawTris, extent: o.ext.map(r4), textures: o.rawTex},
      output: {file: `game/public/${rel(m)}`, url: rel(m), sha256: sha(o.glb), bytes: o.glb.length, triangles: o.outTris, dims: o.dims},
      scale: o.scale.map(v => +v.toFixed(6)), convention: o.convention,
      ...(o.halfTurn !== undefined ? {halfTurn: o.halfTurn, sideRoughness: o.roughness} : {}),
      ...(o.foldedVertices !== undefined ? {foldedVertices: o.foldedVertices, foldPlaneRawZ: o.foldPlaneRawZ} : {}),
      texturePolicy: o.palette
        ? `Meshy maps kept, Lanczos downsize + JPEG: base ${tx.base} px q${tx.quality}, metallic-roughness ${tx.mr} px q${tx.quality}, normal ${tx.normal} px q${tx.normalQuality}; metallic-roughness and normal channel for channel; ${armorPaletteNote()}`
        : `Meshy maps kept channel for channel, Lanczos downsize + JPEG: base ${tx.base} px q${tx.quality}, metallic-roughness ${tx.mr} px q${tx.quality}, normal ${tx.normal} px q${tx.normalQuality}; no reprojection / retexture / repaint`,
      ...(o.palette ? {palette: o.palette} : {}),
      textures: o.textures,
    };
  }),
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces\/|\/home\/|prompt).{0,20}/i); if (hit) fail(`URL / token / local path / generation text in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);

const by = Object.fromEntries(MODELS.map(m => [m.key, m]));
const modelLine = m => {
  const o = m.out, tex = Object.fromEntries(o.textures.map(t => [t.slot, t.size]));
  return `  ${m.key}: {key: '${m.id}', url: '${rel(m)}', bytes: ${o.glb.length}, tris: ${o.outTris}, dims: [${o.dims.join(', ')}] as const, textures: {baseColor: [${tex.baseColor.join(', ')}] as const, metallicRoughness: [${tex.metallicRoughness.join(', ')}] as const, normal: [${tex.normal.join(', ')}] as const}},`;
};
fs.writeFileSync(REG_ARMOR, `// GENERATED by ${SCRIPT} — do not edit (task ${TASK}).
// The train armour kit: Meshy T2.5 image-to-3D derivatives of one Codex design image each, their own PBR maps kept (the base colour
// graded: ${ARMOR_PALETTE.id}, lib/armor-palette.mjs; provenance ${PROV_REL}).
// world/trainArmor.ts reads this. Frames (metres at the reference size, +Y up, grounded: min y = 0; one mesh, one material, identity
// node):
//  - side: one skirt segment, length along X, the blade side toward +Z; origin = bottom centre of the BACK (mounting) face (z = 0).
//  - end: one end plough, width along X, the fins toward +Z; origin = bottom centre of the back plate (z = 0).
// dims = [along X, height, depth along Z].
export const TRAIN_ARMOR_MODELS = {
${[by.side, by.end].map(modelLine).join('\n')}
} as const;
`);
fs.writeFileSync(REG_GRENADE, `// GENERATED by ${SCRIPT} — do not edit (task ${TASK}).
// The crafted throwables' models: Meshy T2.5 image-to-3D derivatives of one Codex design image each, their own PBR maps kept
// (provenance ${PROV_REL}). Frames: upright, origin at the bottom centre, front +Z, metres at runtime size; dims = [w, h, d].
export const GRENADE_MODELS = {
${[by.acid, by.lure].map(modelLine).join('\n')}
} as const;
`);

const credSection = [CREDITS_BEGIN, '## Refinement batch: train armour and crafted throwables', '',
  `Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded; the two train armour models' base colour maps carry the armour's deterministic palette grade \`${ARMOR_PALETTE.id}\` of task ${ARMOR_PALETTE.task} — \`tools/asset-pipeline/props/lib/armor-palette.mjs\`: toward the car body's own weathered steel, rust kept as accents, nothing generated). Task ${TASK} under the user's fresh 75-credit grant (${billedTotal} credits billed, ${generations} generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by \`${SCRIPT}\` (provenance: \`${PROV_REL}\`). The train's Save terminal reuses the existing \`assets/models/p7-crt-terminal-t25.glb\`.`, '',
  ...MODELS.map(m => `- \`${rel(m)}\` — ${m.credit} (Meshy task ${m.rec.meshyTask}).`),
  CREDITS_END].join('\n');
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
fs.writeFileSync(CREDITS, credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '')}\n\n${credSection}\n`);

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([...MODELS.map(rel), PROV_REL, 'assets/CREDITS.md'].map(p => [p, fs.readFileSync(path.join(PUB, p))]));
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${MODELS.map(rel).join(', ')}, ${PROV_REL}, ${path.relative(root, REG_ARMOR)}, ${path.relative(root, REG_GRENADE)}, assets/CREDITS.md, tools/release/public-inputs.json`);
