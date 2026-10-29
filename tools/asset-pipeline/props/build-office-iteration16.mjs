// Iteration 16 "Office Space" (task studio-office-space-survival-20261029-01, lane ASSETS): runtime derivatives of the
// Meshy T2.5 (smart-topology) gear / medical / office / exterior models and the Codex office textures.
//
// Reads the immutable raw originals + fsynced job ledger kept OUTSIDE Git in
//   reference/tasks/office-space-survival-20261029/assets/{ledger.jsonl,raw/<id>/...}
// (verifies every raw file against the ledger's sha256), never modifies them, and writes deterministically:
//   game/public/assets/models/office-<id>.glb              (flat: tools/release/package-ci.mjs only allows assets/models/<name>.glb)
//   game/public/assets/textures/office/<texture-id>.jpg|png
//   game/public/assets/derivatives/office-space-20261029.json  (provenance; no URLs / tokens)
//   tools/release/public-inputs.json                       (ONLY this lane's entries are added/updated; others untouched)
//   game/src/assets/officeAssets.ts                        (the GENERATED block only)
//   reference/.../assets/DELIVERED.json                    (delivery note for the gameplay lanes; atomic)
//
// Model derivative = rotate 180 deg about Y (Meshy's native front is +Z, verified on rendered views; the game convention for
// these assets is front -Z), uniform scale to the real size in the design table (sizeAxis h = height, w = width x, longest),
// grounded (min y = 0) and centred on x/z, baked into the vertices (identity node). No geometry simplification (Smart
// Topology already produced the target triangle count). Embedded 2048 JPEG PBR maps (base colour, metallic-roughness,
// normal) are downsized with sharp (Lanczos) to 512 (gear/medical + small office items) or 1024 and re-encoded as JPEG q85.
//
// Usage: node tools/asset-pipeline/props/build-office-iteration16.mjs
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
const TASK_DIR = 'reference/tasks/office-space-survival-20261029';
const ASSETS_DIR = path.join(root, TASK_DIR, 'assets');
const RAW = path.join(ASSETS_DIR, 'raw');
const LEDGER = path.join(ASSETS_DIR, 'ledger.jsonl');
const OUT_MODELS = path.join(root, 'game/public/assets/models');
const OUT_TEX = path.join(root, 'game/public/assets/textures/office');
const PROV_REL = 'assets/derivatives/office-space-20261029.json';
const PROV = path.join(root, 'game/public', PROV_REL);
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const REGISTRY = path.join(root, 'game/src/assets/officeAssets.ts');
const DELIVERED = path.join(ASSETS_DIR, 'DELIVERED.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const STYLE = 'realistic game asset, abandoned post-apocalyptic, dusty and worn, muted colours, single object, no ground plane';
// design.md Part 1 manifest: [code, id, subject, target tris, real size m, size axis, use, runtime texture px]
const ASSETS = [
  ['A1', 'gear-armor-vest', 'worn soft body-armor vest, faded dark navy fabric, frayed velcro, scuffed front panel, upright, no body', 4000, 0.62, 'h', 'gear', 512],
  ['A2', 'gear-chest-rig', 'worn load-bearing chest rig with magazine and utility pouches, olive drab nylon, dirty, upright, no body', 4000, 0.55, 'h', 'gear', 512],
  ['A3', 'gear-backpack', 'worn hiking daypack, faded red nylon, dirt stains, side mesh pockets, zipped, standing upright', 4000, 0.52, 'h', 'gear', 512],
  ['A4', 'gear-helmet', 'dented, scuffed yellow construction hard hat with chin strap, dirty', 3000, 0.30, 'longest', 'gear', 512],
  ['A5', 'gear-boots', 'pair of worn leather work boots, scuffed, mud-stained, laces', 3500, 0.32, 'longest', 'gear', 512],
  ['A6', 'gear-gloves', 'pair of worn work gloves, leather palms, cloth backs, dirty, lying flat', 2500, 0.26, 'longest', 'gear', 512],
  ['A7', 'med-leg-splint', 'rolled orange SAM malleable aluminium-foam splint with two velcro straps', 2000, 0.24, 'longest', 'medical', 512],
  ['A8', 'med-arm-sling', 'sealed plastic medical packet with a triangular arm sling and an elastic compression wrap roll', 2000, 0.20, 'longest', 'medical', 512],
  ['B1', 'office-desk', 'worn office cubicle desk, laminate top, metal drawer pedestal, scratched, dusty', 5000, 1.50, 'w', 'office', 1024],
  ['B2', 'office-chair', 'abandoned office swivel chair, torn fabric seat, five-star base', 4000, 1.00, 'h', 'office', 512],
  ['B3', 'filing-cabinet', 'four-drawer grey steel filing cabinet, dented, rust stains', 3000, 1.32, 'h', 'office', 1024],
  ['B4', 'office-monitor', 'old desktop computer monitor with keyboard, dusty, cracked screen', 3000, 0.55, 'w', 'office', 512],
  ['B5', 'photocopier', 'large office photocopier, beige plastic, dusty', 5000, 1.10, 'h', 'office', 1024],
  ['B6', 'water-cooler', 'office water cooler with an empty cracked blue bottle', 3000, 1.30, 'h', 'office', 512],
  ['B7', 'conference-table', 'long conference table, scratched wood laminate, dusty', 4000, 3.00, 'w', 'office', 1024],
  ['B8', 'dead-plant', 'potted dead office plant, dry brown leaves, cracked pot', 3000, 1.10, 'h', 'office', 512],
  ['B9', 'reception-desk', 'office lobby reception counter, chipped marble-look front panel, debris on top', 6000, 2.60, 'w', 'office', 1024],
  ['B10', 'server-rack', 'office server rack cabinet, broken glass door, tangled cables', 5000, 2.00, 'h', 'office', 1024],
  ['B11', 'whiteboard', 'office whiteboard on a wheeled stand, smeared marker writing', 2000, 1.80, 'w', 'office', 1024],
  ['B12', 'office-shelf', 'metal office bookshelf with a few binders and loose papers, dusty', 4000, 1.80, 'h', 'office', 1024],
  ['C1', 'car-wreck', 'burnt-out rusted sedan wreck, no glass, flat tyres', 8000, 4.60, 'longest', 'exterior', 1024],
  ['C2', 'rubble-pile', 'large pile of broken concrete rubble with bent rebar', 6000, 5.00, 'longest', 'exterior', 1024],
  ['C3', 'ruined-tower', 'ruined office skyscraper, collapsed upper floors, blown-out windows, exposed floor slabs, background asset', 20000, 60, 'h', 'exterior', 1024],
  ['C4', 'ruined-midrise', 'burnt mid-rise apartment block, collapsed corner, broken windows, background asset', 20000, 30, 'h', 'exterior', 1024],
  ['C5', 'bus-wreck', 'burnt, rusted city bus wreck, no glass', 10000, 12.0, 'longest', 'exterior', 1024],
].map(([code, id, subject, tris, sizeM, sizeAxis, use, texPx]) => ({code, id, subject, tris, sizeM, sizeAxis, use, texPx, prompt: `${subject}, ${STYLE}`}));
const BYTE_BUDGET = id => (id === 'ruined-tower' || id === 'ruined-midrise' ? 3_000_000 : 1_500_000);

// Codex textures (design.md T1-T6) -> runtime texture ids (game/src/assets/officeAssets.ts OfficeTextureId)
const TEXTURES = [
  {code: 'T1', raw: 'T1-carpet-tile', id: 'office-carpet', fmt: 'jpg', px: 1024, tileable: true, alpha: false, subject: 'worn, stained grey-blue office carpet tile (seamless)'},
  {code: 'T2', raw: 'T2-ceiling-tile', id: 'ceiling-tile', fmt: 'jpg', px: 1024, tileable: true, alpha: false, subject: 'water-stained drop-ceiling tile (seamless)'},
  {code: 'T3', raw: 'T3-partition-fabric', id: 'cubicle-fabric', fmt: 'jpg', px: 1024, tileable: true, alpha: false, subject: 'grey-blue cubicle partition fabric (seamless)'},
  {code: 'T4', raw: 'T4-drywall-peeling', id: 'office-wall', fmt: 'jpg', px: 1024, tileable: true, alpha: false, subject: 'peeling painted office drywall (seamless)'},
  {code: 'T5', raw: 'T5-skyline-panorama', id: 'skyline', fmt: 'jpg', px: 2048, tileable: false, alpha: false, subject: 'wide panorama of a destroyed city skyline at overcast dusk with smoke columns (distant backdrop)'},
  {code: 'T6', raw: 'T6-window-grime', id: 'window-glass', fmt: 'png', px: 1024, tileable: false, alpha: true, subject: 'grimy, cracked window glass with dust (RGBA overlay)'},
];

// ---------- ledger ----------
const ledger = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function jobsFor(id) {
  const ev = ledger.filter(e => e.asset === id);
  const last = (kind, event) => [...ev].reverse().find(e => e.kind === kind && e.event === event);
  const failed = ev.filter(e => e.event === 'status' && /FAIL|CANCEL/i.test(e.status ?? ''));
  return {ev, previewAck: last('preview', 'ack'), refineAck: last('refine', 'ack'), previewDl: last('preview', 'download'), refineDl: last('refine', 'download'),
    intents: ev.filter(e => e.event === 'intent'), failed, select: [...ev].reverse().find(e => e.event === 'select')};
}

// ---------- models ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const prevProv = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : null;
const outputs = [], missing = [], newFiles = [];
fs.mkdirSync(OUT_TEX, {recursive: true});

for (const a of ASSETS) {
  const j = jobsFor(a.id);
  const dl = j.select ? ledger.find(e => e.event === 'download' && e.asset === a.id && e.task_id === j.select.task_id) : j.refineDl;
  if (!dl || dl.kind !== 'refine') {
    missing.push({id: a.id, code: a.code, reason: j.failed.length ? `generation failed (${j.failed.map(f => f.status).join(', ')})`
      : j.refineAck ? 'refine submitted, not downloaded yet' : j.previewAck ? 'preview only' : 'not generated'});
    continue;
  }
  const rawPath = path.join(ASSETS_DIR, dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== dl.sha256) throw new Error(`raw sha mismatch for ${a.id}: ${dl.file}`);
  const previewDl = ledger.find(e => e.event === 'download' && e.asset === a.id && e.kind === 'preview' && e.task_id === j.refineAck?.preview_task_id) ?? j.previewDl;
  const refineAck = ledger.find(e => e.event === 'ack' && e.asset === a.id && e.kind === 'refine' && e.task_id === dl.task_id);
  const previewIntent = [...j.intents].reverse().find(e => e.kind === 'preview');
  const refineIntent = [...j.intents].reverse().find(e => e.kind === 'refine' && e.args.preview_task_id === refineAck?.preview_task_id);

  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const r = doc.getRoot();
  const rawTris = r.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const rawTex = r.listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const ext = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
  const ref = a.sizeAxis === 'h' ? ext[1] : a.sizeAxis === 'w' ? ext[0] : Math.max(...ext);
  const s = a.sizeM / ref;
  const tx = s * (b0.min[0] + b0.max[0]) / 2, ty = -s * b0.min[1], tz = s * (b0.min[2] + b0.max[2]) / 2;
  // p' = T + s * rotY(180) * p : (x, y, z) -> (-s x + tx, s y + ty, -s z + tz); column-major
  const M = [-s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, tx, ty, tz, 1];
  for (const m of r.listMeshes()) transformMesh(m, M);
  r.listMeshes().forEach((m, i) => m.setName(i ? `${a.id}-${i}` : a.id));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${a.id}-${i}` : a.id));
  r.listMaterials().forEach((m, i) => m.setName(i ? `office-${a.id}-${i}` : `office-${a.id}`));
  await doc.transform(dedup(), prune(), textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [a.texPx, a.texPx], quality: 85}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-office-iteration16.mjs (glTF-Transform)';
  const glb = Buffer.from(await io.writeBinary(doc));
  const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error(`URL/token-like string inside ${a.id} glTF JSON`);
  const outRel = `assets/models/office-${a.id}.glb`;
  fs.writeFileSync(path.join(root, 'game/public', outRel), glb);
  // re-measure the written file
  const chk = await io.readBinary(new Uint8Array(glb));
  const b1 = getBounds(chk.getRoot().getDefaultScene() ?? chk.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(k => +(b1.max[k] - b1.min[k]).toFixed(4));
  const tris = chk.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  if (Math.abs(b1.min[1]) > 1e-4 || Math.abs(b1.min[0] + b1.max[0]) > 1e-3 * a.sizeM || Math.abs(b1.min[2] + b1.max[2]) > 1e-3 * a.sizeM) throw new Error(`${a.id} not grounded/centred`);
  const textures = chk.getRoot().listTextures().map(t => {
    const slot = chk.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  const overBudget = glb.length > BYTE_BUDGET(a.id);
  outputs.push({code: a.code, id: a.id, key: `office-${a.id}`, use: a.use, subject: a.subject,
    model: 'meshy-t2.5', modelType: 'smart-topology', topology: 'triangle', route: 'text-to-3d preview (geometry) + refine (texture, inherits the preview model)',
    previewPrompt: previewIntent?.args.prompt ?? a.prompt, texturePrompt: refineIntent?.args.texture_prompt ?? a.prompt,
    previewArgs: previewIntent ? (({prompt: _p, response_format: _r, ...rest}) => rest)(previewIntent.args) : null,
    refineArgs: refineIntent ? (({texture_prompt: _t, preview_task_id: _i, response_format: _r, ...rest}) => ({...rest, ai_model: 'omitted (inherits the T2.5 preview)'}))(refineIntent.args) : null,
    tasks: {preview: refineAck?.preview_task_id ?? j.previewAck?.task_id ?? null, refine: dl.task_id},
    credits: {preview: previewDl?.consumed_credits ?? null, refine: dl.consumed_credits ?? null},
    source: {file: `${TASK_DIR}/assets/${dl.file} (raw original, outside Git)`, sha256: dl.sha256, bytes: dl.bytes, triangles: rawTris, extent: ext.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: previewDl ? `${TASK_DIR}/assets/${previewDl.file}` : null, previewSha256: previewDl?.sha256 ?? null, previewTriangles: previewDl?.glb?.tris ?? null},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: tris, dims, overBudget},
    targetTriangles: a.tris, sizeM: a.sizeM, sizeAxis: a.sizeAxis, scale: +s.toFixed(6),
    transform: 'rotateY(180deg) * uniform scale, then grounded (min y = 0) and centred on x/z; baked into vertices', front: '-Z', up: '+Y',
    textures});
  newFiles.push({path: outRel, buf: glb});
  console.log(`${a.code} ${a.id}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(2)} MB, dims ${dims.join(' x ')}${overBudget ? '  OVER BUDGET' : ''}`);
}

// ---------- textures ----------
const texOutputs = [], texMissing = [];
for (const t of TEXTURES) {
  const dl = [...ledger].reverse().find(e => e.event === 'download' && e.asset === t.raw && e.kind === 'texture');
  if (!dl) { texMissing.push({id: t.id, code: t.code, reason: 'not generated'}); continue; }
  const rawPath = path.join(ASSETS_DIR, dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== dl.sha256) throw new Error(`raw sha mismatch for ${t.raw}`);
  const meta = await sharp(rawBytes).metadata();
  let img = sharp(rawBytes).resize({width: Math.min(t.px, meta.width), withoutEnlargement: true, kernel: 'lanczos3'});
  img = t.fmt === 'jpg' ? img.removeAlpha().jpeg({quality: 85, mozjpeg: false, chromaSubsampling: '4:2:0'}) : img.png({compressionLevel: 9, palette: true, quality: 90, effort: 10});
  const buf = await img.toBuffer();
  const om = await sharp(buf).metadata();
  const outRel = `assets/textures/office/${t.id}.${t.fmt}`;
  fs.writeFileSync(path.join(root, 'game/public', outRel), buf);
  const intent = ledger.find(e => e.event === 'intent' && e.asset === t.raw);
  texOutputs.push({code: t.code, id: t.id, subject: t.subject, tileable: t.tileable, alpha: t.alpha,
    tool: 'Codex CLI built-in native image_gen (one call, no retries; model not reported by the tool)', promptSha256: intent?.promptSha256 ?? null,
    prompt: fs.readFileSync(path.join(RAW, t.raw, 'prompt.txt'), 'utf8').trim(),
    source: {file: `${TASK_DIR}/assets/${dl.file} (raw original, outside Git)`, sha256: dl.sha256, bytes: dl.bytes, size: [meta.width, meta.height], byteExactNativeCopy: dl.byteExact === true},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(buf), bytes: buf.length, size: [om.width, om.height], format: t.fmt === 'jpg' ? 'JPEG q85 (Lanczos resize)' : 'PNG palette (RGBA, Lanczos resize)'}});
  newFiles.push({path: outRel, buf});
  console.log(`${t.code} ${t.id}: ${meta.width}x${meta.height} -> ${om.width}x${om.height} ${(buf.length / 1e3).toFixed(0)} kB`);
}

// ---------- provenance ----------
const mcpDir = (() => {
  const base = path.join(process.env.HOME ?? '/home/node', '.npm/_npx');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) { const p = path.join(base, d, 'node_modules/@meshy-ai/meshy-mcp-server'); if (fs.existsSync(path.join(p, 'dist/tools/generation.js'))) return p; }
  return null;
})();
const mcpSha = mcpDir ? {version: JSON.parse(fs.readFileSync(path.join(mcpDir, 'package.json'), 'utf8')).version,
  'dist/tools/generation.js': sha(fs.readFileSync(path.join(mcpDir, 'dist/tools/generation.js'))),
  'dist/utils/generation-options.js': sha(fs.readFileSync(path.join(mcpDir, 'dist/utils/generation-options.js')))} : (prevProv?.modelProof?.mcpSource ?? null);
const prov = {schema: 'last-line-derivative/1', asset: 'office-space-20261029', task: 'studio-office-space-survival-20261029-01', lane: 'ASSETS (iteration 16)',
  status: 'runtime derivatives of models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP, and textures generated with Codex native image generation, under the user\'s batch authorization (budget-authorization.txt); provider terms apply; no licence clearance implied',
  rebuild: 'node tools/asset-pipeline/props/build-office-iteration16.mjs',
  rawStorage: `${TASK_DIR}/assets/raw/<id>/ (immutable originals, task JSON, thumbnails) + ${TASK_DIR}/assets/ledger.jsonl (fsynced intent/ack/download records); outside Git`,
  convention: 'metres at real size, +Y up, front -Z, grounded (min y = 0), centred on x/z; Meshy native front +Z rotated 180 deg about Y',
  modelProof: {
    requested: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', topology: 'triangle', target_formats: ['glb'], refine: 'texture_resolution 2k, enable_pbr true, ai_model omitted (inherits the preview model)'},
    evidence: [
      'exact create arguments recorded in the fsynced ledger (intent line) before every paid call',
      'meshy_text_to_3d (MCP 0.6.6) forwards ai_model and model_type verbatim in the preview request; its resolveGenerationOptions rejects smart-topology with a non-smart model (source hashes below)',
      'every preview billed 5 credits (the T2 / T2.5 / 6-lite tier; meshy-6, meshy-7.1 and latest bill 20) and every refine 10 (2K texture)',
      'every preview returned a triangle-only mesh within about 10% of target_polycount (smart-topology behaviour), kept unchanged by its refine',
      'the Meshy task GET response surfaced by the MCP does not echo ai_model / model_type, so the request record is the model proof'],
    mcpSource: mcpSha},
  manifest: {assets: ASSETS.length, creditsPerAsset: 15, runCap: 450},
  outputs, missing,
  textures: texOutputs, texturesMissing: texMissing};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
if (/https?:|Signature|X-Amz|Key-Pair|token=/i.test(provBuf.toString())) throw new Error('URL/token-like string in public provenance');
fs.writeFileSync(PROV, provBuf);
newFiles.push({path: PROV_REL, buf: provBuf});

// ---------- allowlist (only this lane's paths) ----------
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = p => /^assets\/models\/office-[\w-]+\.glb$/.test(p) || /^assets\/textures\/office\//.test(p) || p === PROV_REL;
const kept = allow.files.filter(f => !mine(f.path));
const added = newFiles.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}));
// remove stale files of mine that are no longer produced
for (const f of allow.files.filter(f => mine(f.path) && !added.some(x => x.path === f.path))) console.warn('allowlist: dropping stale', f.path);
allow.files = [...kept, ...added].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');

// ---------- registry (GENERATED block of officeAssets.ts) ----------
const fmt = v => (typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? `[${v.join(', ')}]` : v === null ? 'null' : String(v));
const assetLines = ASSETS.map(a => {
  const o = outputs.find(x => x.id === a.id);
  return `  '${a.id}': {url: ${o ? fmt(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, tris: ${o ? o.output.triangles : 0}, sizeM: ${a.sizeM}, use: '${a.use}', code: '${a.code}', sizeAxis: '${a.sizeAxis}', dims: ${o ? fmt(o.output.dims) : 'null'}},`;
});
const texLines = TEXTURES.map(t => {
  const o = texOutputs.find(x => x.id === t.id);
  return `  '${t.id}': {url: ${o ? fmt(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, srgb: true, tileable: ${t.tileable}, alpha: ${t.alpha}, size: ${o ? fmt(o.output.size) : 'null'}},`;
});
const block = ['// BEGIN GENERATED (build-office-iteration16.mjs) — do not hand-edit between the markers',
  'export const OFFICE_ASSETS: Record<OfficeAssetId, OfficeAssetEntry> = {', ...assetLines, '};', '',
  'export const OFFICE_TEXTURES: Record<OfficeTextureId, OfficeTextureEntry> = {', ...texLines, '};', '// END GENERATED'].join('\n');
const reg = fs.readFileSync(REGISTRY, 'utf8');
const re = /\/\/ BEGIN GENERATED[^\n]*\n[\s\S]*?\/\/ END GENERATED/;
if (!re.test(reg)) throw new Error('GENERATED markers missing in officeAssets.ts');
fs.writeFileSync(REGISTRY, reg.replace(re, block));

// ---------- delivery note (atomic) ----------
const delivered = {};
for (const a of ASSETS) {
  const o = outputs.find(x => x.id === a.id), m = missing.find(x => x.id === a.id);
  delivered[a.id] = {kind: 'model', code: a.code, key: `office-${a.id}`, url: o ? o.output.url : null, tris: o ? o.output.triangles : 0, bytes: o ? o.output.bytes : 0,
    sizeM: a.sizeM, sizeAxis: a.sizeAxis, dims: o ? o.output.dims : null, use: a.use,
    status: o ? 'ready' : /failed/.test(m?.reason ?? '') ? 'failed' : 'missing', note: o ? `front -Z, grounded, centred${o.output.overBudget ? '; OVER byte budget' : ''}` : m.reason};
}
for (const t of TEXTURES) {
  const o = texOutputs.find(x => x.id === t.id);
  delivered[t.id] = {kind: 'texture', code: t.code, key: t.id, url: o ? o.output.url : null, tris: 0, bytes: o ? o.output.bytes : 0, size: o ? o.output.size : null,
    tileable: t.tileable, alpha: t.alpha, status: o ? 'ready' : 'missing', note: o ? t.subject : 'not generated'};
}
const tmp = `${DELIVERED}.tmp-${process.pid}`;
const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(delivered, null, 1) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
fs.renameSync(tmp, DELIVERED);
console.log(`models ready ${outputs.length}/${ASSETS.length}, textures ready ${texOutputs.length}/${TEXTURES.length}; wrote ${path.relative(root, PROV)}, allowlist (+${added.length} own entries), registry, DELIVERED.json`);
