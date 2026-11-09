// Task studio-food-shelf-production-20261109-002816-01 (lane COOK): the runtime derivatives of the approved food / drink / ruined-shelf
// Meshy T2.5 models. Route: Codex native image_gen INITIAL conditioning image (a strict straight-on elevation conditioned on the
// user-approved concept original) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); every model KEEPS Meshy's own PBR maps (base
// colour, metallic-roughness, normal), downsized / re-encoded / atlas-packed only — never a Codex re-texture or projection.
//
// Reads (never modifies) the lead's private task records OUTSIDE Git (reference/tasks/food-shelf-production-20261109-002816/):
//   PRODUCTION-ASSET-MANIFEST.json   the 51 approved asset ids (names, approved concept originals + sha256; D03 / D08 excluded)
//   USER-GENERATION-APPROVAL.json    its sha256 must equal every reservation's approvalSha256
//   gen/LEDGER.jsonl                 the broker's fsynced reserve / posted / settle / raw / accept lines (the ONLY source of raws)
//   gen/raw/<ID>-<RES>-<taskId>.glb  the immutable raw originals (read-only; sha256 + bytes checked against the ledger's raw line)
//   gen/lanes/<lane>/codex.jsonl     the Codex call that produced the reserved conditioning image (matched by sha256; no prompts kept)
// Only the LATEST ACCEPTED reservation per asset id is cooked (an asset without one is skipped and left out of the registry).
// Writes deterministically:
//   game/public/assets/models/food-<slug>.glb             24 collectibles: one node / mesh / primitive / material, Meshy maps downsized
//   game/public/assets/models/shelf-junk-atlas.glb        27 ruined props: one mesh node per prop id (P01..P27), ALL on ONE material
//                                                         whose base / metallic-roughness / normal maps are one 2048 px atlas each
//   game/public/assets/derivatives/food-shelf-<slug>-model.json, food-shelf-junk-atlas.json   provenance (no URLs / tokens / prompts)
//   game/src/assets/foodShelfModels.generated.ts          FOOD_ITEM_MODELS (key = ItemDef id = slug) + SHELF_JUNK_ATLAS (three-free)
//   tools/release/public-inputs.json                      ONLY this script's entries added / updated (others untouched)
//
// Per model: exact-attribute weld (+ degenerate triangles dropped; lossless), meshoptimizer seam-preserving simplification ONLY where
// the delivered count is above the budget (collectibles 2500, ruined props 2000 triangles; source UVs / normals kept; the result is
// refused when visibly crumpled), UNIFORM scale so the plan's reference measure is its real size (H = the full height, W = the longer
// horizontal extent = width / length, D = the diameter = the horizontal extent, optionally within a height band), Meshy's native
// frame kept (+Y up, front +Z), grounded (min y = 0) and centred on x / z, baked into the vertices (identity nodes).
// Atlas: each prop's three Meshy maps are resized into ONE square cell per prop (the same cell in all three atlases), the cell side
// proportional to sqrt(surface area / UV area) so every prop gets the same texel density; cells sit on a 16 px grid with an 8 px
// edge-copied gutter (no bleeding between props down to the 256 px mip); the prop's UVs are remapped into its cell's inner square
// (uniform u / v scale: tangent frames and normal-map handedness unchanged). Meshy material factors must all be 1 (else refused).
//
//   node tools/asset-pipeline/props/build-food-shelf-meshy.mjs [--reference <dir>] [--dry-run <scratch dir>]
//   (--reference defaults to <repo>/reference; --dry-run writes the GLBs + provenance + a registry preview only into the scratch dir)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO, TextureInfo} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '../../..');
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const TASK = 'studio-food-shelf-production-20261109-002816-01';
const TASK_DIR = 'reference/tasks/food-shelf-production-20261109-002816';
const REF = path.resolve(arg('--reference') ?? path.join(root, 'reference'));
const T = path.join(REF, 'tasks/food-shelf-production-20261109-002816');
const GEN = path.join(T, 'gen');
const DRY = arg('--dry-run');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/foodShelfModels.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/props/build-food-shelf-meshy.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4), r6 = v => +v.toFixed(6);
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The plan's table. fit: the reference measure and its real size (m): h = the full height, w = the longer horizontal extent (width /
 * length), d = the diameter (the longer horizontal extent; `band` = [lo, hi] height fractions it is measured in, e.g. a tin without
 * its brush).
 */
const ITEMS = [
  ['F01', 'corned_beef', {h: 0.10}], ['F02', 'sardines', {w: 0.11}], ['F03', 'field_ration', {h: 0.20}], ['F04', 'ration_brick', {w: 0.15}],
  ['F05', 'pickles', {h: 0.18}], ['F06', 'peanut_butter', {h: 0.12}], ['F07', 'saltines', {w: 0.22}], ['F08', 'jerky', {h: 0.20}],
  ['F09', 'trail_mix', {h: 0.20}], ['F10', 'honey', {h: 0.17}], ['F11', 'butter_cookies', {d: 0.20}], ['F12', 'pudding_cups', {w: 0.15}],
  ['F13', 'fruit_puree', {h: 0.15}], ['F14', 'raisins', {w: 0.12}], ['F15', 'smoked_sausage', {w: 0.28}], ['F16', 'wax_cheese', {d: 0.14}],
  ['F17', 'rolled_oats', {h: 0.24}], ['F18', 'rice_crackers', {w: 0.22}], ['D01', 'sports_drink', {h: 0.23}], ['D02', 'iced_coffee', {h: 0.17}],
  ['D04', 'iced_tea', {h: 0.24}], ['D05', 'juice_boxes', {w: 0.15}], ['D06', 'uht_milk', {h: 0.20}], ['D07', 'ginger_soda', {h: 0.22}],
].map(([id, slug, fit]) => ({id, slug, fit}));
const JUNK = [
  ['P01', 'mouldy_loaf', {w: 0.32}], ['P02', 'bloated_can', {h: 0.12}], ['P03', 'burst_milk', {h: 0.25}], ['P04', 'rotten_fruit_crate', {w: 0.40}],
  ['P05', 'crushed_cereal', {h: 0.30}], ['P06', 'mould_jar', {h: 0.18}], ['P07', 'flour_sack', {h: 0.40}], ['P08', 'deli_clamshell', {w: 0.18}],
  ['P09', 'egg_carton', {w: 0.16}], ['P10', 'potato_sack', {h: 0.40}], ['P11', 'wrapper_cluster', {w: 0.25}], ['P12', 'rusty_tins', {h: 0.30}],
  ['P13', 'retail_carton', {w: 0.20}], ['P14', 'shipping_box', {w: 0.55}], ['P15', 'torn_carton', {w: 0.45}], ['P16', 'crushed_box', {w: 0.45}],
  ['P17', 'blister_card', {h: 0.25}], ['P18', 'carton_bundle', {w: 0.30}], ['P19', 'shelf_tray', {w: 0.40}], ['P20', 'cleaner_jug', {h: 0.30}],
  ['P21', 'trigger_sprayer', {h: 0.28}], ['P22', 'rag_bundle', {w: 0.30}], ['P23', 'tool_tote', {w: 0.45}], ['P24', 'cable_adapter', {w: 0.25}],
  ['P25', 'paint_tin', {d: 0.17}], ['P26', 'towel_pack', {w: 0.30}], ['P27', 'binder_stack', {w: 0.32}],
].map(([id, slug, fit]) => ({id, slug, fit}));
const dashed = s => s.replace(/_/g, '-');
/**
 * Recorded per-asset geometry processing (deterministic; the lead's binding cook adjustments + the lane accept notes), applied to the
 * raw mesh (`dropIslands`, `flatten`: raw Meshy units) or after the uniform fit (`depth`, `layFlat`, `settle`):
 *  dropIslands  local mesh separation: position-connected islands lying wholly in front of raw z = minZ are removed (expected counts checked)
 *  flatten      one position-connected island (matched by its triangle count + raw bounds) is squashed along raw +Z toward z = toZ
 *  depth        the face-on conditioning image gave Meshy no depth: z is scaled to the real product depth (m) about its centre; the plan's
 *               reference measure does not involve z, so this equals a raw-Z pre-scale before the uniform fit
 *  layFlat      a quarter turn about x: the front (+Z) face turns up (+Y), the old top goes to -Z (rests on its back, label up)
 *  settle       a rigid roll about z onto two supports (a model that would otherwise stand on a dangling speck)
 */
const ADJUST = {
  F01: {dropIslands: {minZ: 0.175, dropTris: 1450, keepTris: 1629,
    why: "lane A1 salvage accept: Meshy extruded the label's plate / meat illustration into 12 islands standing proud of the tin's front face (raw z 0.265); removing them leaves the closed tin with lid and side key (a faint pale ghost of the plate art stays on the label)"}},
  F02: {depth: {z: 0.025, why: 'lane A1: depth 5 % of the width (~6 mm); a real club sardine tin is ~25 mm deep (plain metal side band stretched)'}},
  F03: {depth: {z: 0.020, why: 'lane A1: depth ~5 mm; a filled field-ration retort pouch is ~20 mm thick'}},
  F15: {settle: 'the paper tag hangs 3 cm below the chub (a hanging pose): resting on the tag alone the chub floats; it rolls onto the tag and the chub end'},
  F16: {depth: {z: 0.065, why: 'lead: a 0.14 m wax cheese round is 0.065 m thick (Meshy: lens-thin ~2 cm)'}, layFlat: 'lead: lies on its flat face, the circular CHEESE label up'},
  F18: {depth: {z: 0.035, why: 'lead: the 0.22 m rice cracker tray pack is 0.035 m deep (Meshy: ~1 cm)'}, layFlat: 'lead: lies label-up'},
  D06: {depth: {z: 0.065, why: 'lead: a 0.20 m UHT 1 L brick is ~0.065 m deep (Meshy: ~0.04 m); the front face keeps the approved proportions (0.084 m wide)'}},
  D07: {flatten: {tris: 956, min: [-0.055, -0.177, 0.077], max: [0.082, -0.098, 0.168], toZ: 0.094, factor: 0.12,
    why: "lane A3 / lead: Meshy extruded the label's ginger-root illustration into a separate closed part ~1.6 cm proud of the round bottle; squashed onto the label surface the art stays and the bottle is round again"}},
  P11: {layFlat: 'lead: Meshy built the wrapper / cup cluster upright on a narrow base; laid on its back it rests stably like the approved concept'},
};
/** Collectible triangle budget steps (seam-preserving; the class budget first; see simplifyStepped). */
const ITEM_BUDGETS = [2500, 3000];
/**
 * Ruined-prop budgets (lead, SHELF lane: a station carries ~2.3k-5.3k filler pieces under a 320k-triangle stock budget): the leanest
 * step whose result stays within JUNK_TARGET_ERROR, small parts (cans, jars, cartons, sprayers, blister card, wrappers, ...) up to 600,
 * big ones (crates, sacks, totes, shipping / torn / crushed boxes, rag bundle) up to 900 triangles.
 */
const JUNK_STEPS = {small: [300, 450, 600], big: [450, 600, 900]};
const JUNK_BIG = new Set(['P04', 'P07', 'P10', 'P14', 'P15', 'P16', 'P22', 'P23']);
const JUNK_TARGET_ERROR = 0.045;
/**
 * Collectible map sizes [base, metallicRoughness, normal] px: the repo's consumable-item class (meshy-t25 items: 512 px colour, 256 px
 * MR / normal; ~2 MB GPU per item). The packaging lettering stays legible at 512 (checked); 1024 / 512 / 512 would be ~8 MB GPU each.
 */
const ITEM_TEX = [512, 256, 256];
const ATLAS = {size: 2048, grid: 16, pad: 8, minCell: 64, maxCell: 1024, url: 'assets/models/shelf-junk-atlas.glb', id: 'shelf-junk-atlas',
  background: {baseColor: [128, 128, 128], metallicRoughness: [255, 255, 0], normal: [128, 128, 255]}};
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, targetError: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept)',
  toolPermissive: 'meshoptimizer 1.3 simplifyWithAttributes Permissive (normals x0.5 + UV x1 attribute weights; collapses across UV seams allowed, charged by the UV attribute error; source UVs / normals kept)'};
/** Above this relative error the seam-preserving result counts as visibly crumpled: the source mesh is kept instead. */
const MAX_KEEP_ERROR = 0.05;
/** JPEG encodes per slot (channel-packed metallic-roughness and normals without chroma subsampling). */
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

// ---------- records ----------
const manifest = JSON.parse(fs.readFileSync(path.join(T, 'PRODUCTION-ASSET-MANIFEST.json'), 'utf8'));
const approved = new Map(manifest.assets.map(a => [a.id, a]));
for (const r of [...ITEMS, ...JUNK]) if (!approved.has(r.id) || (manifest.excluded ?? []).includes(r.id)) throw new Error(`${r.id}: not an approved asset`);
if (ITEMS.length + JUNK.length !== manifest.assets.length) throw new Error('the plan table does not cover the approved manifest');
const approvalSha = sha(fs.readFileSync(path.join(T, 'USER-GENERATION-APPROVAL.json')));
const ledgerLines = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map((l, i) => ({...JSON.parse(l), seq: i + 1}));
const CAPS = {credits: 1000, attempts: 66, posts: 100};

/** The broker's own state machine (gen/broker.py state()) over the ledger, keeping the line numbers. */
function ledgerState() {
  const res = new Map();
  for (const l of ledgerLines) {
    if (l.type === 'reserve') { res.set(l.res, {reserve: l, state: 'reserved', billed: 0, lines: {reserve: l.seq}}); continue; }
    const x = res.get(l.res);
    if (!x) continue;
    if (l.asset !== x.reserve.asset) throw new Error(`ledger line ${l.seq}: asset ${l.asset} != reservation ${l.res} asset ${x.reserve.asset}`);
    if (l.type === 'posted') Object.assign(x, {state: 'posted', taskId: l.taskId, posted: l});
    else if (l.type === 'uncertain') x.state = 'uncertain';
    else if (l.type === 'reconciled') { if (l.taskId) Object.assign(x, {state: 'posted', taskId: l.taskId, posted: l}); else x.state = 'released'; }
    else if (l.type === 'settle') Object.assign(x, {state: l.status.toLowerCase(), billed: l.billed, settle: l});
    else if (l.type === 'raw') x.raw = l;
    else if (l.type === 'accept') Object.assign(x, {accepted: true, accept: l});
    else if (l.type === 'reject') Object.assign(x, {accepted: false, reject: l});
    x.lines[l.type] = l.seq;
  }
  const all = [...res.values()];
  const billed = all.reduce((s, x) => s + x.billed, 0);
  const reserved = all.filter(x => ['reserved', 'posted', 'uncertain'].includes(x.state)).reduce((s, x) => s + x.reserve.credits, 0);
  return {res, billed, reserved, attempts: all.length, posts: all.length};
}
const ledger = ledgerState();
if (ledger.billed + ledger.reserved > CAPS.credits || ledger.attempts > CAPS.attempts || ledger.posts > CAPS.posts) throw new Error(`ledger outside the caps: ${JSON.stringify({billed: ledger.billed, reserved: ledger.reserved, attempts: ledger.attempts})}`);

const codexLines = new Map();
function codexOf(lane, inputSha) {
  if (!codexLines.has(lane)) {
    const f = path.join(GEN, 'lanes', lane, 'codex.jsonl');
    codexLines.set(lane, fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim().startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
  }
  const hit = codexLines.get(lane).filter(l => l.phase === 'result' && l.sha256 === inputSha);
  if (!hit.length) return null;
  const h = hit[hit.length - 1];
  const intent = codexLines.get(lane).find(l => l.phase === 'intent' && l.id === h.id && l.attempt === h.attempt);
  return {lane, asset: h.id, attempt: h.attempt, session: h.session, status: h.status, size: h.size, bytes: h.bytes, sha256: h.sha256,
    identityReferenceSha256: intent?.inputSha256 ?? h.inputSha256 ?? null, promptSha256: intent?.promptSha256 ?? null,
    generator: 'OpenAI Codex CLI built-in image_gen (image model id not reported)'};
}
const relT = f => { const rel = path.relative(T, f); if (rel.startsWith('..')) throw new Error(`${f} is outside the task dir`); return `${TASK_DIR}/${rel.split(path.sep).join('/')}`; };

/** The latest accepted reservation of an asset (or null), every record cross-checked. */
function records(row) {
  const a = approved.get(row.id);
  const cands = [...ledger.res.values()].filter(x => x.reserve.asset === row.id && x.accepted === true).sort((p, q) => q.accept.seq - p.accept.seq);
  if (!cands.length) return null;
  const x = cands[0], rv = x.reserve;
  const fail = m => { throw new Error(`${row.id} ${rv.res}: ${m}`); };
  if (x.state !== 'succeeded' || !x.settle || x.settle.status !== 'SUCCEEDED') fail(`accepted but not SUCCEEDED (${x.state})`);
  if (!x.taskId || !x.raw) fail('no task id / raw line');
  if (rv.approvalSha256 !== approvalSha) fail('reservation approval sha256 != USER-GENERATION-APPROVAL.json');
  if (rv.approvedSourceSha256 !== a.sourceImageSha256) fail('approved concept sha256 mismatch');
  if (rv.params?.file_path !== rv.input || rv.params?.ai_model !== 'meshy-t2.5' || rv.params?.model_type !== 'smart-topology' || rv.params?.enable_pbr !== true) fail('reservation params are not the approved T2.5 PBR recipe');
  const inputBytes = fs.readFileSync(rv.input);
  if (sha(inputBytes) !== rv.inputSha256 || inputBytes.length !== rv.inputBytes) fail('conditioning image sha256 / bytes mismatch');
  const rawFile = x.raw.file;
  if (path.dirname(path.resolve(rawFile)) !== path.join(GEN, 'raw') || !path.basename(rawFile).startsWith(`${row.id}-`) || !path.basename(rawFile).includes(x.taskId)) fail(`raw file name ${rawFile} is not gen/raw/<ID>-<RES>-<taskId>.glb`);
  const bytes = fs.readFileSync(rawFile);
  if (sha(bytes) !== x.raw.sha256 || bytes.length !== x.raw.bytes) fail(`raw original sha256 / bytes mismatch (${rawFile})`);
  const codex = codexOf(rv.lane, rv.inputSha256);
  return {res: rv.res, lane: rv.lane, taskId: x.taskId, reserve: rv, settle: x.settle, raw: x.raw, accept: x.accept, lines: x.lines, bytes, inputBytes, codex, approvedAsset: a,
    attemptsForAsset: [...ledger.res.values()].filter(y => y.reserve.asset === row.id).map(y => ({res: y.reserve.res, state: y.state, accepted: y.accepted ?? null}))};
}

// ---------- geometry ----------
async function readSource(id, rec) {
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh());
  const fail = m => { throw new Error(`${id}: ${m}`); };
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) fail('expected one mesh node / mesh / material');
  const M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) fail('non-identity source node');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) fail('expected one triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`missing ${s}`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) fail('unexpected material (alpha / occlusion / emissive)');
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) if (!info || info.getTexCoord() !== 0) fail('a map is missing or uses TEXCOORD_1');
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: p.getAttribute('POSITION').getCount()}, (_, i) => i);
  const m = {P: Float32Array.from(p.getAttribute('POSITION').getArray()), N: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), I};
  const textures = {baseColor: mat.getBaseColorTexture(), metallicRoughness: mat.getMetallicRoughnessTexture(), normal: mat.getNormalTexture()};
  const maps = SLOTS.map(slot => { const t = textures[slot]; return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}; });
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  const extraSemantics = p.listSemantics().filter(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s));
  return {doc, prim: p, mat, m, maps, material, textures, extraSemantics};
}

/** Exact-attribute weld (bitwise-equal position / normal / uv) + degenerate-triangle and unreferenced-vertex removal; lossless. */
function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) {
    A.set(m.P.subarray(3 * v, 3 * v + 3), v * stride); A.set(m.N.subarray(3 * v, 3 * v + 3), v * stride + 3); A.set(m.UV.subarray(2 * v, 2 * v + 2), v * stride + 6);
  }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [], used = new Uint8Array(nv);
  for (let i = 0; i < m.I.length; i++) used[m.I[i]] = 1;
  let unreferenced = 0;
  for (let v = 0; v < nv; v++) {
    if (!used[v]) { unreferenced++; continue; }
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    for (let s = (h >>> 0) & (cap - 1); ; s = (s + 1) & (cap - 1)) {
      const w = table[s];
      if (w < 0) { table[s] = first.length; remap[v] = first.length; first.push(v); break; }
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[first[w] * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = w; break; }
    }
  }
  const n = first.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  first.forEach((v, i) => { P.set(m.P.subarray(3 * v, 3 * v + 3), 3 * i); N.set(m.N.subarray(3 * v, 3 * v + 3), 3 * i); UV.set(m.UV.subarray(2 * v, 2 * v + 2), 2 * i); });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {P, N, UV, I: Uint32Array.from(I), weld: {verticesBefore: nv, verticesAfter: n, unreferencedVerticesDropped: unreferenced, degenerateTrianglesDropped: degenerate}};
}

/** UV charts = index-connected triangle groups (Meshy splits vertices at chart borders). */
function uvCharts(m) {
  const nv = m.P.length / 3, parent = Int32Array.from({length: nv}, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let f = 0; f < m.I.length; f += 3) for (const [a, b] of [[m.I[f], m.I[f + 1]], [m.I[f + 1], m.I[f + 2]]]) { const x = find(a), y = find(b); if (x !== y) parent[x] = y; }
  const roots = new Set();
  for (let f = 0; f < m.I.length; f += 3) roots.add(find(m.I[f]));
  return roots.size;
}

/**
 * The budget steps: the class budget first; a model whose seam-preserving result at a step is visibly crumpled (relative error >
 * MAX_KEEP_ERROR, e.g. a crate full of fruit under a torn wrap) takes the next step (recorded), never a crumpled mesh.
 */
async function simplifyStepped(m, budgets) {
  const tried = [];
  for (const budget of budgets) {
    const r = await simplify(m, budget);
    if (r.info.applied || r.info.reason.startsWith('already')) return {m: r.m, info: {...r.info, budgetSteps: budgets, ...(tried.length ? {raisedFrom: tried} : {})}};
    tried.push({budget, reason: r.info.reason, attempt: r.info.attempt});
  }
  return {m, info: {applied: false, reason: `no budget step gives an uncrumpled seam-preserving result: source mesh kept`, triangles: m.I.length / 3, budgetSteps: budgets, raisedFrom: tried}};
}

/**
 * Ruined props: the leanest budget step (JUNK_STEPS) whose result stays within JUNK_TARGET_ERROR — seam-preserving first; where the
 * Meshy UV seams stall it far above the step (200-700 charts), meshoptimizer's Permissive mode (collapses across UV seams allowed but
 * charged by the UV attribute error, so texture distortion is part of the metric). No step within the target: the class cap, recorded.
 */
async function simplifyLean(m, steps) {
  const tried = [];
  let last = null;
  for (const budget of steps) {
    for (const mode of ['seam', 'permissive']) {
      const r = await simplify(m, budget, mode, Infinity);
      if (r.info.reason?.startsWith('already')) return {m: r.m, info: {...r.info, budgetSteps: steps, targetError: JUNK_TARGET_ERROR}};
      const a = r.info.applied ? r.info : r.info.attempt;
      tried.push({budget, mode, triangles: a.triangles, errorRelative: a.errorRelative});
      if (r.info.applied && r.info.errorRelative <= JUNK_TARGET_ERROR) return {m: r.m, info: {...r.info, budgetSteps: steps, targetError: JUNK_TARGET_ERROR, tried}};
      if (r.info.applied && budget === steps[steps.length - 1] && (!last || r.info.errorRelative < last.info.errorRelative)) last = r;
    }
  }
  if (!last) throw new Error('no lean simplification reached the class cap');
  return {m: last.m, info: {...last.info, budgetSteps: steps, targetError: JUNK_TARGET_ERROR, tried, note: `no step within the ${JUNK_TARGET_ERROR} target error: the class cap ${steps[steps.length - 1]} (lowest error), checked visually`}};
}

/** Simplification on the welded source buffer (UVs / normals kept); `kept` + reason when it stalls or crumples. mode: seam | permissive. */
async function simplify(m, budget, mode = 'seam', maxError = MAX_KEEP_ERROR) {
  const tris0 = m.I.length / 3;
  if (tris0 <= budget) return {m, info: {applied: false, reason: `already within the ${budget} budget`, triangles: tris0, budget}};
  await MeshoptSimplifier.ready;
  const nv = m.P.length / 3, attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) attrs[5 * v + k] = m.N[3 * v + k] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  const flags = mode === 'permissive' ? ['Permissive'] : [];
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget (or makes no progress)
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 10; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, SIMPLIFY.targetError, flags);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  const attempt = {mode, fromTriangles: tris0, triangles: out.length / 3, budget, askedTriangles: ask, passes: passes + 1, errorRelative: r6(err)};
  if (out.length / 3 > budget) return {m, info: {applied: false, reason: `the UV seams stall the ${mode} collapse at ${out.length / 3} triangles (> the ${budget} budget): source mesh kept rather than smear the texture`, triangles: tris0, budget, attempt}};
  if (err > maxError) return {m, info: {applied: false, reason: `the ${mode} result at the budget is visibly crumpled (relative error ${r6(err)} > ${maxError}): source mesh kept`, triangles: tris0, budget, attempt}};
  const map = new Int32Array(nv).fill(-1), P = [], N = [], UV = [], I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (map[v] < 0) { map[v] = P.length / 3; P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    I[i] = map[v];
  }
  return {m: {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I},
    info: {applied: true, tool: mode === 'permissive' ? SIMPLIFY.toolPermissive : SIMPLIFY.tool, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, targetError: SIMPLIFY.targetError, ...attempt,
      errorSourceUnits: r6(err * MeshoptSimplifier.getScale(m.P, 3))}};
}

/** Position-connected islands (exact positions; as the lanes' islands.mjs): [{tris: [triangle indices], verts: Set, min, max}], largest first. */
function islands(m) {
  const nv = m.P.length / 3, key = new Map(), rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${m.P[3 * v]},${m.P[3 * v + 1]},${m.P[3 * v + 2]}`; if (!key.has(k)) key.set(k, key.size); rep[v] = key.get(k); }
  const par = Int32Array.from({length: key.size}, (_, i) => i);
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const T = m.I.length / 3;
  for (let t = 0; t < T; t++) { const a = rep[m.I[3 * t]], b = rep[m.I[3 * t + 1]], c = rep[m.I[3 * t + 2]]; par[f(a)] = f(b); par[f(b)] = f(c); }
  const comps = new Map();
  for (let t = 0; t < T; t++) {
    const c = f(rep[m.I[3 * t]]);
    if (!comps.has(c)) comps.set(c, {tris: [], verts: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
    const o = comps.get(c); o.tris.push(t);
    for (let k = 0; k < 3; k++) { const v = m.I[3 * t + k]; o.verts.add(v); for (let r = 0; r < 3; r++) { o.min[r] = Math.min(o.min[r], m.P[3 * v + r]); o.max[r] = Math.max(o.max[r], m.P[3 * v + r]); } }
  }
  return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length);
}

/** The raw-mesh adjustments (ADJUST.dropIslands / flatten), in raw Meshy units; returns the new mesh + a record. */
function preAdjust(id, m, adj) {
  const rec = {};
  if (adj?.dropIslands) {
    const a = adj.dropIslands, list = islands(m);
    const drop = list.filter(o => o.min[2] >= a.minZ);
    const dropTris = drop.reduce((s, o) => s + o.tris.length, 0), keepTris = m.I.length / 3 - dropTris;
    if (dropTris !== a.dropTris || keepTris !== a.keepTris) throw new Error(`${id}: island drop ${dropTris} / keep ${keepTris} != the expected ${a.dropTris} / ${a.keepTris}`);
    const gone = new Set(drop.flatMap(o => o.tris)), I = [];
    for (let t = 0; t < m.I.length / 3; t++) if (!gone.has(t)) I.push(m.I[3 * t], m.I[3 * t + 1], m.I[3 * t + 2]);
    m = {...m, I: Uint32Array.from(I)};
    rec.dropIslands = {rule: `position-connected islands lying wholly in front of raw z = ${a.minZ} (min z >= ${a.minZ})`, islands: drop.length, ofIslands: list.length,
      droppedTriangles: dropTris, keptTriangles: keepTris, droppedBounds: drop.map(o => ({tris: o.tris.length, min: o.min.map(r4), max: o.max.map(r4)})), why: a.why};
  }
  if (adj?.flatten) {
    const a = adj.flatten, list = islands(m);
    const hit = list.filter(o => o.tris.length === a.tris && o.min.every((v, k) => Math.abs(v - a.min[k]) < 0.002) && o.max.every((v, k) => Math.abs(v - a.max[k]) < 0.002));
    if (hit.length !== 1) throw new Error(`${id}: expected exactly one island of ${a.tris} triangles at the recorded raw bounds, found ${hit.length}`);
    const P = Float32Array.from(m.P), N = Float32Array.from(m.N);
    for (const v of hit[0].verts) {
      P[3 * v + 2] = a.toZ + (P[3 * v + 2] - a.toZ) * a.factor;
      const x = N[3 * v], y = N[3 * v + 1], z = N[3 * v + 2] / a.factor, l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    m = {...m, P, N};
    rec.flatten = {island: {tris: a.tris, min: hit[0].min.map(r4), max: hit[0].max.map(r4)}, rule: `z' = ${a.toZ} + (z - ${a.toZ}) * ${a.factor} for the island's vertices (raw units); normals inverse-transpose, renormalised`, why: a.why};
  }
  return {m, rec};
}

function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return {min, max};
}

/** The UNIFORM fit on the plan's reference measure: scale, grounded, centred on x / z (normals unchanged under a uniform scale). */
function fitMesh(low, fit) {
  const b = boundsOf(low.P);
  let s, info;
  if (fit.h) { s = fit.h / (b.max[1] - b.min[1]); info = {measure: 'H', kind: 'the full height (y extent)', size: fit.h}; }
  else {
    const size = fit.w ?? fit.d;
    let x0 = b.min[0], x1 = b.max[0], z0 = b.min[2], z1 = b.max[2];
    if (fit.band) {
      const lo = b.min[1] + fit.band[0] * (b.max[1] - b.min[1]), hi = b.min[1] + fit.band[1] * (b.max[1] - b.min[1]);
      x0 = z0 = Infinity; x1 = z1 = -Infinity;
      for (let i = 0; i < low.P.length; i += 3) if (low.P[i + 1] >= lo && low.P[i + 1] <= hi) { x0 = Math.min(x0, low.P[i]); x1 = Math.max(x1, low.P[i]); z0 = Math.min(z0, low.P[i + 2]); z1 = Math.max(z1, low.P[i + 2]); }
    }
    const ex = x1 - x0, ez = z1 - z0, axis = ex >= ez ? 'x' : 'z';
    s = size / Math.max(ex, ez);
    info = {measure: fit.w ? 'W' : 'D', kind: `${fit.w ? 'the width / length' : 'the diameter'} = the longer horizontal extent (${axis})${fit.band ? ` within the ${fit.band.map(v => `${v * 100} %`).join(' - ')} height band` : ''}`, size, axis};
  }
  const P = low.P.map(v => v * s), N = Float32Array.from(low.N);
  const out = {...info, scale: r6(s), measuredOn: 'the welded (and simplified) mesh that ships'};
  // depth correction: a face-on conditioning image leaves the reconstructed depth (z) of flat-faced packaging a guess; z is stretched
  // about its centre to the real product depth (normals by the inverse transpose), the reference measure untouched
  if (fit.depth) {
    const bz = boundsOf(P), from = bz.max[2] - bz.min[2], k = fit.depth.z / from, cz = (bz.min[2] + bz.max[2]) / 2;
    for (let i = 0; i < P.length; i += 3) P[i + 2] = cz + (P[i + 2] - cz) * k;
    for (let i = 0; i < N.length; i += 3) { const x = N[i], y = N[i + 1], z = N[i + 2] / k, l = Math.hypot(x, y, z) || 1; N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l; }
    out.depthCorrection = {axis: 'z', fromM: r4(from), toM: fit.depth.z, factor: r6(k), reason: fit.depth.why, normals: 'inverse-transpose (z / factor), renormalised'};
  }
  // lie flat: a quarter turn about x, the front (+Z) face up (+Y), the old top to -Z
  if (fit.layFlat) {
    for (const A of [P, N]) for (let i = 0; i < A.length; i += 3) { const y = A[i + 1], z = A[i + 2]; A[i + 1] = z; A[i + 2] = -y; }
    out.layFlat = {rotation: 'a quarter turn about x: (x, y, z) -> (x, z, -y); the front (+Z) face up, the old top at -Z', reason: fit.layFlat};
  }
  // rest pose: a model standing on a speck (a dangling tag) is rolled about z, rigidly, onto the support edge of its x-y hull on the side
  // of its centre of mass (two contacts), as it would settle under gravity
  if (fit.settle) {
    let roll = 0;
    for (let it = 0; it < 4; it++) {
      let li = 0;
      for (let i = 3; i < P.length; i += 3) if (P[i + 1] < P[li + 1]) li = i;
      const L = [P[li], P[li + 1]], C = centroidXY(P, low.I);
      const dir = C[0] < L[0] ? -1 : 1;
      let best = null;
      for (let i = 0; i < P.length; i += 3) {
        const d = dir * (P[i] - L[0]);
        if (d < 1e-4) continue;
        const a = Math.atan2(P[i + 1] - L[1], d);
        if (!best || a < best.a) best = {a, x: P[i]};
      }
      if (!best || best.a < 1e-3) break;
      const th = dir < 0 ? best.a : -best.a, c = Math.cos(th), sn = Math.sin(th);
      for (const A of [P, N]) for (let i = 0; i < A.length; i += 3) { const x = A[i] - (A === P ? L[0] : 0), y = A[i + 1] - (A === P ? L[1] : 0); A[i] = x * c - y * sn + (A === P ? L[0] : 0); A[i + 1] = x * sn + y * c + (A === P ? L[1] : 0); }
      roll += th;
    }
    out.restPose = {rollAboutZDeg: r4(roll * 180 / Math.PI), reason: fit.settle, method: 'rigid roll about z onto the x-y hull support edge on the centre-of-mass side (surface-weighted centroid), iterated until stable'};
  }
  const bb = boundsOf(P), tx = -(bb.min[0] + bb.max[0]) / 2, ty = -bb.min[1], tz = -(bb.min[2] + bb.max[2]) / 2;
  for (let i = 0; i < P.length; i += 3) { P[i] += tx; P[i + 1] += ty; P[i + 2] += tz; }
  return {P, N, fit: {...out, translate: [tx, ty, tz].map(r6), rotation: fit.layFlat ? 'laid flat (front face up)' : fit.settle ? 'the rest-pose roll about z only (front +Z, +Y up kept)' : 'none (Meshy native front +Z, +Y up kept)'}};
}

/** Surface-area-weighted centroid (x, y) of an indexed mesh (the centre of mass of a thin shell). */
function centroidXY(P, I) {
  let A = 0, x = 0, y = 0;
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const w = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    A += w; x += w * (P[a] + P[b] + P[c]) / 3; y += w * (P[a + 1] + P[b + 1] + P[c + 1]) / 3;
  }
  return [x / A, y / A];
}

/** Surface area (m², shipped mesh) and UV area (fraction of the unit square) of an indexed mesh. */
function areas(P, UV, I) {
  let A = 0, U = 0;
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f], b = I[f + 1], c = I[f + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
    const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    U += 0.5 * Math.abs((UV[2 * b] - UV[2 * a]) * (UV[2 * c + 1] - UV[2 * a + 1]) - (UV[2 * c] - UV[2 * a]) * (UV[2 * b + 1] - UV[2 * a + 1]));
  }
  return {surfaceM2: A, uvArea: U};
}

/** Cooks one model's geometry (weld -> simplify -> uniform fit) and its measurements. */
async function cookGeometry(row, rec, junk) {
  const src = await readSource(row.id, rec);
  const srcB = boundsOf(src.m.P);
  const extent = [0, 1, 2].map(k => r4(srcB.max[k] - srcB.min[k]));
  const uv = src.m.UV;
  let umin = Infinity, umax = -Infinity;
  for (let i = 0; i < uv.length; i++) { umin = Math.min(umin, uv[i]); umax = Math.max(umax, uv[i]); }
  if (umin < -1e-4 || umax > 1 + 1e-4) throw new Error(`${row.id}: UVs outside [0, 1] (${umin} .. ${umax}); wrapping cannot be atlas-packed`);
  const adj = ADJUST[row.id] ?? {};
  const pre = preAdjust(row.id, src.m, adj);
  const welded = weld(pre.m); // (the weld also drops vertices no longer referenced after an island removal)
  const charts = uvCharts(welded);
  const {m: low, info: simp} = junk ? await simplifyLean(welded, JUNK_STEPS[JUNK_BIG.has(row.id) ? 'big' : 'small']) : await simplifyStepped(welded, ITEM_BUDGETS);
  const {P, N, fit} = fitMesh(low, {...row.fit, depth: adj.depth, layFlat: adj.layFlat, settle: adj.settle});
  const b = boundsOf(P);
  const dims = [0, 1, 2].map(k => r4(b.max[k] - b.min[k]));
  return {src, extent, welded, charts, simp, fit, adjust: Object.keys(pre.rec).length ? pre.rec : null, mesh: {P, N, UV: low.UV, I: low.I}, dims, min: b.min.map(r6), max: b.max.map(r6), uvRange: [r6(umin), r6(umax)]};
}

const checkFactors = (id, mt) => {
  const one = v => Math.abs(v - 1) < 1e-6;
  if (!mt.baseColorFactor.every(one) || !one(mt.metallicFactor) || !one(mt.roughnessFactor) || !one(mt.normalScale)) throw new Error(`${id}: Meshy material factors are not all 1 (${JSON.stringify(mt)}); the shared atlas material cannot hold them`);
};
const indexArray = (I, nv) => (nv < 65536 ? Uint16Array.from(I) : Uint32Array.from(I));
const resizeMap = async (img, px) => sharp(Buffer.from(img)).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'});
const noUrls = (id, glb) => { const j = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString(); if (/https?:|Signature|X-Amz|token/i.test(j)) throw new Error(`${id}: URL / token-like string inside the glTF JSON`); };

// ---------- collectibles ----------
const itemOut = [], skipped = [];
for (const row of ITEMS) {
  const rec = records(row);
  if (!rec) { skipped.push(row.id); continue; }
  const id = `food-${dashed(row.slug)}`, url = `assets/models/${id}.glb`, provRel = `assets/derivatives/food-shelf-${dashed(row.slug)}-model.json`;
  const g = await cookGeometry(row, rec, false);
  const {doc, prim, mat} = g.src;
  const r = doc.getRoot();
  const nv = g.mesh.P.length / 3;
  for (const s of g.src.extraSemantics) prim.setAttribute(s, null);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.mesh.P).setBuffer(r.listBuffers()[0]));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.mesh.N)).setBuffer(r.listBuffers()[0]));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(g.mesh.UV)).setBuffer(r.listBuffers()[0]));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indexArray(g.mesh.I, nv)).setBuffer(r.listBuffers()[0]));
  const px = {baseColor: ITEM_TEX[0], metallicRoughness: ITEM_TEX[1], normal: ITEM_TEX[2]};
  for (const slot of SLOTS) {
    const t = g.src.textures[slot];
    const img = await (await resizeMap(t.getImage(), px[slot])).jpeg(JPEG[slot]).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI(`${id}-${slot}.jpg`).setName(`${id}-${slot}`);
  }
  r.listMeshes()[0].setName(id); r.listNodes().forEach(n => n.setName(id)); mat.setName(id);
  r.listScenes().forEach(sc => sc.setName(id));
  await doc.transform(dedup(), prune());
  r.getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  noUrls(id, glb);
  // ---- verify the written bytes + measure on them
  const chk = await io.readBinary(new Uint8Array(glb));
  const cr = chk.getRoot();
  if (cr.listNodes().length !== 1 || cr.listMeshes().length !== 1 || cr.listMeshes()[0].listPrimitives().length !== 1 || cr.listMaterials().length !== 1 || cr.listTextures().length !== 3) throw new Error(`${id}: not one node / mesh / primitive / material with three maps`);
  const bb = getBounds(cr.getDefaultScene() ?? cr.listScenes()[0]);
  const dims = [0, 1, 2].map(k => r4(bb.max[k] - bb.min[k]));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 1e-3 || Math.abs(bb.min[2] + bb.max[2]) > 1e-3) throw new Error(`${id}: not grounded / centred`);
  const cp = cr.listMeshes()[0].listPrimitives()[0];
  const tris = cp.getIndices().getCount() / 3;
  if (g.simp.applied && tris > g.simp.budget) throw new Error(`${id}: over budget`);
  const m0 = cr.listMaterials()[0];
  const slotOf = t => SLOTS.find(s => ({baseColor: m0.getBaseColorTexture(), metallicRoughness: m0.getMetallicRoughnessTexture(), normal: m0.getNormalTexture()})[s] === t) ?? 'unused';
  const textures = cr.listTextures().map(t => ({slot: slotOf(t), size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  itemOut.push({row, id, url, provRel, rec, g, glb, dims, min: bb.min.map(r6), max: bb.max.map(r6), tris, vertices: cp.getAttribute('POSITION').getCount(), textures});
  console.log(`${row.id} ${id}: ${rec.bytes.length} B ${g.src.m.I.length / 3} tris -> ${glb.length} B ${tris} tris (${g.simp.applied ? `simplified to the ${g.simp.budget} step, err ${g.simp.errorRelative}` : g.simp.reason}; ${g.charts} UV charts), ` +
    `dims ${dims.join(' x ')} m (${g.fit.measure} ${g.fit.size}${g.fit.axis ? ` on ${g.fit.axis}` : ''}), scale ${g.fit.scale}; maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}

// ---------- ruined props: one shared atlas ----------
const parts = [];
for (const row of JUNK) {
  const rec = records(row);
  if (!rec) { skipped.push(row.id); continue; }
  const g = await cookGeometry(row, rec, true);
  checkFactors(row.id, g.src.material);
  if (g.src.material.doubleSided !== true) throw new Error(`${row.id}: the shared atlas material is double-sided like every Meshy material; this source is not`);
  const ar = areas(g.mesh.P, g.mesh.UV, g.mesh.I);
  parts.push({row, rec, g, ...ar, need: Math.sqrt(ar.surfaceM2 / Math.max(ar.uvArea, 1e-6))});
  console.log(`${row.id} ${row.slug}: ${rec.bytes.length} B ${g.src.m.I.length / 3} tris -> ${g.mesh.I.length / 3} tris (${g.simp.applied ? `simplified to the ${g.simp.budget} step, err ${g.simp.errorRelative}` : g.simp.reason}; ${g.charts} UV charts), ` +
    `dims ${g.dims.join(' x ')} m (${g.fit.measure} ${g.fit.size}${g.fit.axis ? ` on ${g.fit.axis}` : ''}), scale ${g.fit.scale}, surface ${r4(ar.surfaceM2)} m², UV area ${r4(ar.uvArea)}`);
}

/** Skyline bottom-left packing of squares (side px, multiples of the grid) into the atlas; null when they do not fit. */
function skyline(sizes, W) {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  let sky = [{x: 0, w: W, y: 0}];
  const at = new Array(sizes.length);
  for (const i of order) {
    const s = sizes[i];
    let best = null;
    for (let k = 0; k < sky.length; k++) {
      const x = sky[k].x;
      if (x + s > W) break;
      let y = 0;
      for (let j = k; j < sky.length && sky[j].x < x + s; j++) y = Math.max(y, sky[j].y);
      if (y + s > W) continue;
      if (!best || y < best.y || (y === best.y && x < best.x)) best = {x, y};
    }
    if (!best) return null;
    at[i] = best;
    const next = [];
    for (const seg of sky) {
      const a = seg.x, b = seg.x + seg.w;
      if (b <= best.x || a >= best.x + s) { next.push(seg); continue; }
      if (a < best.x) next.push({x: a, w: best.x - a, y: seg.y});
      if (b > best.x + s) next.push({x: best.x + s, w: b - best.x - s, y: seg.y});
    }
    next.push({x: best.x, w: s, y: best.y + s});
    next.sort((p, q) => p.x - q.x);
    sky = [];
    for (const seg of next) { const l = sky[sky.length - 1]; if (l && l.y === seg.y && l.x + l.w === seg.x) l.w += seg.w; else sky.push({...seg}); }
  }
  return at;
}
const cellSizes = k => parts.map(p => Math.min(ATLAS.maxCell, Math.max(ATLAS.minCell, ATLAS.grid * Math.round((k * p.need + 2 * ATLAS.pad) / ATLAS.grid))));

let atlasOut = null;
if (parts.length) {
  // the largest uniform texel density (px / m) whose cells pack: binary search on k
  let lo = 0, hi = ATLAS.size / Math.min(...parts.map(p => p.need)), at = null;
  for (let it = 0; it < 40; it++) { const k = (lo + hi) / 2; if (skyline(cellSizes(k), ATLAS.size)) lo = k; else hi = k; }
  const k = lo, sizes = cellSizes(k);
  at = skyline(sizes, ATLAS.size);
  if (!at) throw new Error('atlas: no packing');
  const used = sizes.reduce((s, c) => s + c * c, 0) / (ATLAS.size * ATLAS.size);
  parts.forEach((p, i) => {
    const s = sizes[i], inner = s - 2 * ATLAS.pad;
    p.cell = {x: at[i].x, y: at[i].y, size: s, pad: ATLAS.pad, inner,
      uvRect: [(at[i].x + ATLAS.pad) / ATLAS.size, (at[i].y + ATLAS.pad) / ATLAS.size, (at[i].x + ATLAS.pad + inner) / ATLAS.size, (at[i].y + ATLAS.pad + inner) / ATLAS.size].map(r6),
      texelsPerMetre: r4(inner * Math.sqrt(p.uvArea / p.surfaceM2))};
  });
  // the three atlases: each prop's Meshy map resized into its cell's inner square, the gutter edge-copied
  const atlasImages = {};
  for (const slot of SLOTS) {
    const comps = [];
    for (const p of parts) {
      const t = p.g.src.textures[slot];
      const cellImg = await (await resizeMap(t.getImage(), p.cell.inner)).extend({top: ATLAS.pad, bottom: ATLAS.pad, left: ATLAS.pad, right: ATLAS.pad, extendWith: 'copy'}).png().toBuffer();
      comps.push({input: cellImg, left: p.cell.x, top: p.cell.y});
    }
    const [R, G, B] = ATLAS.background[slot];
    atlasImages[slot] = await sharp({create: {width: ATLAS.size, height: ATLAS.size, channels: 3, background: {r: R, g: G, b: B}}}).composite(comps).removeAlpha().jpeg(JPEG[slot]).toBuffer();
  }
  // the document: one material, one mesh node per prop (identity transforms; geometry grounded / centred per node)
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`${ATLAS.id}-${slot}`).setImage(new Uint8Array(atlasImages[slot])).setMimeType('image/jpeg').setURI(`${ATLAS.id}-${slot}.jpg`)]));
  const mat = doc.createMaterial(ATLAS.id).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(true).setAlphaMode('OPAQUE')
    .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(1);
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) info.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
  const scene = doc.createScene(ATLAS.id);
  doc.getRoot().setDefaultScene(scene);
  for (const p of parts) {
    const {P, N, UV, I} = p.g.mesh, c = p.cell;
    const UV2 = new Float32Array(UV.length);
    for (let i = 0; i < UV.length; i += 2) { UV2[i] = (c.x + c.pad + UV[i] * c.inner) / ATLAS.size; UV2[i + 1] = (c.y + c.pad + UV[i + 1] * c.inner) / ATLAS.size; }
    const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
    const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', Float32Array.from(N)))
      .setAttribute('TEXCOORD_0', acc('VEC2', UV2)).setIndices(acc('SCALAR', indexArray(I, P.length / 3)));
    scene.addChild(doc.createNode(p.row.id).setMesh(doc.createMesh(p.row.id).addPrimitive(prim)));
  }
  doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  noUrls(ATLAS.id, glb);
  // ---- verify the written bytes: per node grounded / centred, one material, UVs inside the cell
  const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
  if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3 || chk.listNodes().length !== parts.length) throw new Error('atlas: not one material / three maps / one node per prop');
  for (const p of parts) {
    const node = chk.listNodes().find(n => n.getName() === p.row.id);
    const prims = node?.getMesh()?.listPrimitives() ?? [];
    if (!node || prims.length !== 1 || prims[0].getMaterial() !== chk.listMaterials()[0]) throw new Error(`${p.row.id}: missing node / not on the shared material`);
    if (node.getMatrix().some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-12)) throw new Error(`${p.row.id}: non-identity node`);
    const P = prims[0].getAttribute('POSITION').getArray(), U = prims[0].getAttribute('TEXCOORD_0').getArray(), b = boundsOf(P);
    if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 || Math.abs(b.min[2] + b.max[2]) > 1e-3) throw new Error(`${p.row.id}: not grounded / centred`);
    for (let i = 0; i < U.length; i += 2) if (U[i] < p.cell.uvRect[0] - 1e-6 || U[i] > p.cell.uvRect[2] + 1e-6 || U[i + 1] < p.cell.uvRect[1] - 1e-6 || U[i + 1] > p.cell.uvRect[3] + 1e-6) throw new Error(`${p.row.id}: UV outside its cell`);
    p.tris = prims[0].getIndices().getCount() / 3; p.vertices = P.length / 3;
    p.dims = [0, 1, 2].map(k => r4(b.max[k] - b.min[k])); p.min = b.min.map(r6); p.max = b.max.map(r6);
    if (p.g.simp.applied && p.tris > p.g.simp.budget) throw new Error(`${p.row.id}: over budget`);
  }
  const textures = chk.listTextures().map((t, i) => ({slot: SLOTS[i], size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  atlasOut = {glb, textures, k: r4(k), used: r4(used), provRel: 'assets/derivatives/food-shelf-junk-atlas.json'};
  console.log(`${ATLAS.id}: ${parts.length} props, ${glb.length} B, ${parts.reduce((s, p) => s + p.tris, 0)} tris; atlas ${ATLAS.size} px, density ${r4(k)} px per sqrt(m² / UV area), cells use ${(used * 100).toFixed(1)} %; maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}
if (skipped.length) console.log(`not accepted yet (skipped, left out of the registry): ${skipped.join(' ')}`);

// ---------- provenance ----------
const ROUTE = 'Codex native image_gen INITIAL conditioning image (a strict straight-on front elevation, conditioned on the user-approved concept original) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (downsized / re-encoded / atlas-packed only; no re-texture, projection or hand-painted replacement)';
const LICENCE = "generated for this project (Codex initial image -> Meshy T2.5) under the user's food / shelf generation approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied";
const APPROVAL = {userGenerationApprovalSha256: approvalSha,
  summary: "the user's fresh food / shelf generation approval: up to 1000 Meshy credits on the 51 approved food, drink and ruined-shelf assets with the T2.5 model (caps 66 attempts / 100 paid POSTs; D03 / D08 excluded); Codex conditioning images recorded"};
const lineOf = l => { const {seq: _s, type: _t, ...rest} = l; return rest; };
function sourceProv(row, rec, g) {
  const a = rec.approvedAsset;
  return {
    asset: row.id, name: a.name, class: a.class,
    approvedConcept: {sha256: a.sourceImageSha256, file: `${path.relative(root, a.workerApprovedOriginal).split(path.sep).join('/')} (approved concept original, outside Git)`},
    conditioningImage: {sha256: rec.reserve.inputSha256, bytes: rec.reserve.inputBytes, file: `${relT(rec.reserve.input)} (outside Git)`,
      codex: rec.codex ?? 'no matching Codex result line found in the lane record'},
    meshy: {tool: rec.reserve.tool, request: (({file_path: _f, ...rest}) => rest)(rec.reserve.params), task: rec.taskId, reservation: rec.res, lane: rec.lane,
      status: rec.settle.status, billedCredits: rec.settle.billed, attemptsForAsset: rec.attemptsForAsset, acceptNote: rec.accept.note || null,
      ledger: {file: `${TASK_DIR}/gen/LEDGER.jsonl (outside Git)`, lines: rec.lines, accept: lineOf(rec.accept)}},
    source: {file: `${relT(rec.raw.file)} (raw original, read-only, outside Git; never shipped)`, sha256: rec.raw.sha256, bytes: rec.raw.bytes,
      triangles: g.src.m.I.length / 3, vertices: g.src.m.P.length / 3, extent: g.extent, uvRange: g.uvRange, uvCharts: g.charts, material: g.src.material, maps: g.src.maps,
      droppedAttributes: g.src.extraSemantics},
    rawAdjustments: g.adjust, fit: g.fit, weld: g.welded.weld, simplify: g.simp,
  };
}
const written = new Map();
const guard = (id, buf) => { const hit = buf.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=).{0,20}/i); if (hit) throw new Error(`${id}: URL / token-like string in public provenance: ...${hit[0]}...`); return buf; };
for (const o of itemOut) {
  const prov = {
    schema: 'terminal-state-derivative-v1', id: o.id, itemId: o.row.slug, asset: o.row.id,
    role: `collectible ${approved.get(o.row.id).class === 'collectible_drink' ? 'drink' : 'food'} pickup model: ${approved.get(o.row.id).name}`,
    task: `${TASK} (lane COOK; models generated by the asset lanes through the task's single broker / ledger)`, approval: APPROVAL, accepted: true, route: ROUTE,
    ...sourceProv(o.row, o.rec, o.g),
    output: {url: o.url, file: `game/public/${o.url}`, bytes: o.glb.length, sha256: sha(o.glb), triangles: o.tris, vertices: o.vertices, dims: o.dims, min: o.min, max: o.max},
    textures: o.textures,
    texturePolicy: `Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal), lanczos3 downsize to ${ITEM_TEX.join(' / ')} px, JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4`,
    convention: 'metres at real size, +Y up; Meshy native frame (front +Z = the straight-on elevation the model was conditioned on); grounded (min y = 0), centred on x / z; one node / mesh / primitive / material, identity node (transform baked into the vertices)',
    licence: LICENCE, rebuild: `node ${SELF} [--reference <dir holding tasks/food-shelf-production-20261109-002816>]`,
  };
  written.set(o.url, o.glb);
  written.set(o.provRel, guard(o.id, Buffer.from(JSON.stringify(prov, null, 1) + '\n')));
}
if (atlasOut) {
  const prov = {
    schema: 'terminal-state-derivative-v1', id: ATLAS.id, role: 'non-collectible ruined shelf props (physics filler): one GLB, one mesh node per prop id on ONE shared material with one 2048 px atlas per PBR slot',
    task: `${TASK} (lane COOK; models generated by the asset lanes through the task's single broker / ledger)`, approval: APPROVAL, accepted: true, route: ROUTE,
    output: {url: ATLAS.url, file: `game/public/${ATLAS.url}`, bytes: atlasOut.glb.length, sha256: sha(atlasOut.glb), nodes: parts.map(p => p.row.id), triangles: parts.reduce((s, p) => s + p.tris, 0)},
    textures: atlasOut.textures,
    atlas: {size: ATLAS.size, grid: ATLAS.grid, pad: ATLAS.pad, cellRule: 'square cell per prop, side = k * sqrt(surface area m² / UV area) + 2 * pad, rounded to the grid, clamped to ' +
      `${ATLAS.minCell}..${ATLAS.maxCell} px; skyline bottom-left packing (largest first); k = the largest uniform density that packs (binary search)`, k: atlasOut.k, cellsUse: atlasOut.used,
      fill: "each prop's Meshy map lanczos3-resized to the cell's inner square (the same cell in all three atlases), gutter = edge copy; unused atlas area = neutral grey / rough non-metal / flat normal",
      uvRemap: "u' = (cell.x + pad + u * inner) / size, v' = (cell.y + pad + v * inner) / size (uniform scale: tangent frames unchanged)", background: ATLAS.background},
    texturePolicy: "Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal), atlas-packed at a uniform texel density, JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4; Meshy material factors all 1 (checked), so one shared material is exact",
    convention: 'metres at real size, +Y up; Meshy native frame (front +Z = the straight-on elevation each model was conditioned on); every node an identity transform, its geometry grounded (min y = 0) and centred on x / z at the node origin (the nodes overlap at the origin by design; use one node per prop instance)',
    parts: Object.fromEntries(parts.map(p => [p.row.id, {slug: p.row.slug, node: p.row.id, ...sourceProv(p.row, p.rec, p.g),
      output: {node: p.row.id, triangles: p.tris, vertices: p.vertices, dims: p.dims, min: p.min, max: p.max},
      cell: {...p.cell, surfaceM2: r6(p.surfaceM2), uvArea: r6(p.uvArea)}}])),
    licence: LICENCE, rebuild: `node ${SELF} [--reference <dir holding tasks/food-shelf-production-20261109-002816>]`,
  };
  written.set(ATLAS.url, atlasOut.glb);
  written.set(atlasOut.provRel, guard(ATLAS.id, Buffer.from(JSON.stringify(prov, null, 1) + '\n')));
}

// ---------- registry ----------
const registry = `// GENERATED by ${SELF} (task ${TASK}) — do not edit.
// The food / drink pickups' runtime models (FOOD_ITEM_MODELS, keyed by ItemDef id) and the non-collectible ruined shelf props' shared atlas
// (SHELF_JUNK_ATLAS, one mesh node per prop id P01..P27 on ONE material). Three-free. Meshy T2.5 models (Codex initial conditioning image ->
// Meshy image-to-3D; Meshy's own PBR maps kept, downsized / atlas-packed only); provenance in assets/derivatives/food-shelf-*.json.
// Metres at real size, +Y up, front +Z, grounded (min y = 0), centred on x / z (atlas: per node, identity node transforms). id = the
// approved asset id; w / h / d = the measured runtime bounds (x / y / z extents); tris = triangles. Only accepted models are listed.

export interface FoodShelfModel { id: string; url: string; w: number; h: number; d: number; tris: number }
export const FOOD_ITEM_MODELS: Readonly<Record<string, FoodShelfModel>> = {
${itemOut.map(o => `  ${o.row.slug}: {id: '${o.row.id}', url: '${o.url}', w: ${o.dims[0]}, h: ${o.dims[1]}, d: ${o.dims[2]}, tris: ${o.tris}},`).join('\n')}
};

export interface ShelfJunkPart { id: string; slug: string; node: string; w: number; h: number; d: number; tris: number }
export const SHELF_JUNK_ATLAS: {url: string; parts: Readonly<Record<string, ShelfJunkPart>>} = {url: '${ATLAS.url}', parts: {
${parts.map(p => `  ${p.row.id}: {id: '${p.row.id}', slug: '${p.row.slug}', node: '${p.row.id}', w: ${p.dims[0]}, h: ${p.dims[1]}, d: ${p.dims[2]}, tris: ${p.tris}},`).join('\n')}
}};
`;

if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, buf] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), buf);
  fs.writeFileSync(path.join(DRY, 'foodShelfModels.generated.ts'), registry);
  console.log(`dry run: ${written.size} files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + registry preview written to ${DRY}`);
  process.exit(0);
}

for (const [rel, buf] of written) fs.writeFileSync(path.join(PUB, rel), buf);
fs.writeFileSync(REG, registry);
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const ownPaths = new Set([...ITEMS.flatMap(r => [`assets/models/food-${dashed(r.slug)}.glb`, `assets/derivatives/food-shelf-${dashed(r.slug)}-model.json`]), ATLAS.url, 'assets/derivatives/food-shelf-junk-atlas.json']);
allow.files = [...allow.files.filter(f => !ownPaths.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json`);
