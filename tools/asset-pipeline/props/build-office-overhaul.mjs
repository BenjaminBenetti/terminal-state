// Task studio-beta-office-overhaul-20261030-01 (Studio Beta, lane ASSETS): runtime derivatives of the Meshy T2.5 (smart-topology)
// company signature props (D01-D40, 20 companies x 2) and supporting office-overhaul models (E01-E18).
//
// Reads the primary-authored finite manifest (sha256-pinned), the fsynced job ledger and the immutable raw originals kept OUTSIDE
// Git in reference/tasks/office-overhaul-20261030/assets/{manifest.json,ledger.jsonl,raw/<id>/...} (verifies every raw file against
// the ledger's sha256), never modifies them, and writes deterministically:
//   game/public/assets/models/office-<id>.glb                 (flat: tools/release/package-ci.mjs only allows assets/models/<name>.glb)
//   game/public/assets/derivatives/office-overhaul-20261030.json (provenance; no URLs / tokens)
//   tools/release/public-inputs.json                          (ONLY this task's paths are added/updated; every other entry untouched)
//   game/src/assets/companyAssets.ts                          (the GENERATED block only)
//   game/src/assets/companyDims.generated.ts                  (the GENERATED block only; three.js-free dims + nominal specs)
//   reference/.../assets/DELIVERED.json                       (delivery note for the gameplay lanes; atomic)
//
// Only ACCEPTED refines are built: the ledger must hold an `inspect` line {verdict: 'accepted', kind: 'refine', task_id, front} written
// after the CPU orthographic review of the refined native GLB (tools/asset-pipeline/props/lib/ortho-render.mjs). `front` is the
// native front direction seen on those views (Meshy's is normally +Z).
// Model derivative = rotate about Y so the native front faces -Z (game convention), uniform scale to the manifest's real size
// (sizeAxis h = height y, w = width x after rotation, longest = longest extent), grounded (min y = 0) and centred on x/z, baked into
// the vertices (identity nodes). No geometry simplification (Smart Topology already produced the target triangle count). The native
// 2K PBR material is preserved channel for channel (base colour, metallic-roughness, normal) and downsized per the iteration-16
// texture policy (sharp Lanczos, JPEG q85): base colour 1024 for large pieces (nominal max extent >= 1.5 m) else 512, the other maps
// 512; a deterministic step-down ladder keeps every GLB under its byte budget (large 600 kB, small 400 kB).
//
// Usage: node tools/asset-pipeline/props/build-office-overhaul.mjs [--only D01,E05]   (--only rebuilds a subset; the registry,
//        provenance, allowlist and DELIVERED.json always describe every delivered asset)
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
const TASK = 'studio-beta-office-overhaul-20261030-01';
const TASK_DIR = 'reference/tasks/office-overhaul-20261030';
const ASSETS_DIR = path.join(root, TASK_DIR, 'assets');
const MANIFEST = path.join(ASSETS_DIR, 'manifest.json');
const MANIFEST_SHA = 'c55dd4bcfdbab86e3c8e2b50119a38f57d5dfab6151e120476439c68198520c5';
const LEDGER = path.join(ASSETS_DIR, 'ledger.jsonl');
const OUT_MODELS = path.join(root, 'game/public/assets/models');
const PROV_REL = 'assets/derivatives/office-overhaul-20261030.json';
const PROV = path.join(root, 'game/public', PROV_REL);
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const REGISTRY = path.join(root, 'game/src/assets/companyAssets.ts');
const DIMS_TS = path.join(root, 'game/src/assets/companyDims.generated.ts');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS = path.join(root, 'game/public', CREDITS_REL);
const CREDITS_MARK = '## Office overhaul: company tenant props and supporting models';
const DELIVERED = path.join(ASSETS_DIR, 'DELIVERED.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const outRelOf = id => `assets/models/office-${id}.glb`;

// ---------- manifest (finite, primary-authored, pinned) ----------
const manifestBuf = fs.readFileSync(MANIFEST);
if (sha(manifestBuf) !== MANIFEST_SHA) throw new Error(`manifest sha256 changed (${sha(manifestBuf)}); refusing to build`);
const MANIFEST_JSON = JSON.parse(manifestBuf.toString());
const ASSETS = MANIFEST_JSON.assets;
if (ASSETS.length !== 58) throw new Error('expected 58 manifest assets');
const MY_PATHS = new Set([...ASSETS.map(a => outRelOf(a.id)), PROV_REL]);

// Texture policy (iteration-16 style): [baseColor px, other maps px, jpeg quality] ladders; budgets in bytes.
const isLarge = a => a.sizeM >= 1.5;
const LADDER_LARGE = [[1024, 512, 85], [1024, 512, 80], [1024, 512, 72], [768, 512, 80], [512, 512, 80], [512, 512, 72]];
const LADDER_SMALL = [[512, 512, 85], [512, 512, 80], [512, 512, 72], [512, 256, 72]];
const BUDGET = a => (isLarge(a) ? 600_000 : 400_000);

// Per-asset observations from the CPU-rendered QA views, for integrators (filled after inspection; mirrored in DELIVERED.json).
const NOTES = {
  'gumball-jar': 'tipped jar with gumballs spilled around the base: footprint ~1.03 x 0.66 m at 0.75 m tall',
  'console-station': 'TV on a low media stand (top ~0.93 m); console, controllers and open shelf on the -Z side',
  'law-bookcase': 'wide, deep bookcase (~1.13 x 2.2 x 0.67 m)',
  'trading-desk': 'curved desk: monitors on the outer arc, operator side (concave) toward -Z',
  'bull-statue': 'length along Z, head toward -Z',
  'lab-bench': 'replacement attempt 2 (attempt 1 was the wrong object)',
  'architect-model': 'presentation table with tall white towers (~1.6 x 1.61 x 1.46 m)',
  'tv-camera': 'native lens pointed -X; turned -90 deg so the lens faces -Z (~0.85 x 1.7 x 1.40 m)',
  'news-desk': 'ring-shaped anchor desk with a tall backdrop panel on +Z (~2.6 x 1.24 x 1.77 m)',
  'espresso-machine': 'freestanding all-in-one machine, no separate cart (~1.4 x 1.29 x 1.41 m, deep)',
  'coffee-roaster': 'large (~2.43 x 1.8 x 1.58 m); drum door and cooling tray at the -X end',
  'treadmill': 'console at the +Z end, deck toward -Z (~1.19 x 1.85 x 2.0 m)',
  'sneaker-wall': 'wide (2.32 m) tall panel unit plus a lower side shelf unit',
  'rocking-horse': 'length along Z, head toward -Z',
  'mixing-console': 'deep desk (~2.0 x 1.25 x 1.99 m), monitor speakers at the back',
  'ship-model': 'glass display case only, no cabinet: low (~0.59 m) - stand it on a sideboard/table',
  'parcel-pallet': 'bulky 2x2x2 parcel stack on a pallet (~1.2 x 1.3 x 1.44 m)',
  'nap-pod': 'dome pod (~1.8 x 1.27 x 1.63 m), opening toward -Z',
  'kegerator': 'bulky (~1.32 x 1.4 x 1.37 m); the refine texture painted a poster-like portrait of an elderly man on the -X side panel (texture hallucination; flagged for the primary)',
  'metal-detector': 'wide walk-through portal (~3.12 x 2.2 x 1.99 m); walk-through axis Z',
  'vault-safe': 'bulky (~1.31 x 1.5 x 1.35 m); dial door -Z',
  'aquarium': 'tank only, no cabinet (~1.5 x 0.64 x 0.70 m) - stand it on a sideboard/counter',
  'bakery-case': 'curved customer glass faces -Z (native, no rotation); open server side +Z',
  'satellite-model': 'solar wings span X (1.8 m); ~0.9 m tall on its stand',
  'telescope': 'aperture points +Z (toward the wall/window), eyepiece/handles face -Z',
  'executive-desk': 'front -Z = visitor/modesty side (native, no rotation); drawer/seat side +Z: put the executive chair on +Z facing -Z',
  'server-cabinet': 'wide three-bay cabinet (~2.92 x 2.0 x 1.38 m), glass server bay in the middle',
  'security-turnstile': 'replacement attempt 2; two pedestals spread along X (1.59 m) with glass flaps across one lane; walk-through axis Z',
  'foosball-table': 'rod handles stick out on both long sides (1.4 x 0.52 x 1.26 m incl. rods)',
  'ping-pong-table': 'squat table (~2.42 x 0.83 x 2.74 m); net across X at mid-length',
  'rooftop-hvac': '~2.13 x 2.32 x 2.4 m; fan grilles on -Z and both X sides, plain back +Z',
  'water-tower': 'tank sits low, no tall steel stand (~4.59 x 4.5 x 4.58 m); ladder on -Z',
  'satellite-dish': 'dish faces -Z (native, no rotation)',
  'toilet': 'tank at +Z (against the wall), bowl and open seat toward -Z',
};

// ---------- ledger ----------
const ledger = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
function jobsFor(a) {
  const ev = ledger.filter(e => e.code === a.code);
  const accepted = [...ev].reverse().find(e => e.event === 'inspect' && e.kind === 'refine' && e.verdict === 'accepted');
  const dl = accepted ? ev.find(e => e.event === 'download' && e.kind === 'refine' && e.task_id === accepted.task_id) : null;
  const refineAck = dl ? ev.find(e => e.event === 'ack' && e.kind === 'refine' && e.task_id === dl.task_id) : null;
  const previewId = refineAck?.preview_task_id ?? null;
  const previewDl = previewId ? ev.find(e => e.event === 'download' && e.kind === 'preview' && e.task_id === previewId) : null;
  const previewAck = previewId ? ev.find(e => e.event === 'ack' && e.kind === 'preview' && e.task_id === previewId) : null;
  const intentOf = ack => (ack ? ev.find(e => e.event === 'intent' && e.kind === ack.kind && e.t === ack.intentT)
    ?? [...ev].reverse().find(e => e.event === 'intent' && e.kind === ack.kind && e.t <= ack.t) : null);
  const previewIntent = intentOf(previewAck), refineIntent = intentOf(refineAck);
  const acks = ev.filter(e => e.event === 'ack');
  const rejects = ev.filter(e => e.event === 'reject');
  const failed = ev.filter(e => e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''));
  const credits = ev.filter(e => e.event === 'download' || (e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? '')))
    .reduce((acc, e) => { if (acc.seen.has(e.task_id)) return acc; acc.seen.add(e.task_id); acc[e.kind] += e.consumed_credits ?? 0; return acc; }, {preview: 0, refine: 0, seen: new Set()});
  return {ev, accepted, dl, refineAck, previewDl, previewAck, previewIntent, refineIntent, acks, rejects, failed,
    credits: {preview: credits.preview, refine: credits.refine, total: credits.preview + credits.refine}};
}

// ---------- models ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const prevProv = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : null;
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const ROT = {'+Z': Math.PI, '-Z': 0, '+X': Math.PI / 2, '-X': -Math.PI / 2};
const outputs = [], missing = [];

async function derive(a, rawBytes, front, [basePx, otherPx, quality]) {
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const th = ROT[front];
  const c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
  // rotated (axis-aligned, quarter-turn) extents: x' = c x + s z, z' = -s x + c z
  const e0 = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
  const ext = [Math.abs(c) * e0[0] + Math.abs(sn) * e0[2], e0[1], Math.abs(sn) * e0[0] + Math.abs(c) * e0[2]];
  const ref = a.sizeAxis === 'h' ? ext[1] : a.sizeAxis === 'w' ? ext[0] : Math.max(...ext);
  const s = a.sizeM / ref;
  // column-major: p' = s * rotY(th) * p
  const R = [s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, 0, 0, 0, 1];
  for (const m of r.listMeshes()) transformMesh(m, R);
  const b1 = getBounds(scene);
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1];
  for (const m of r.listMeshes()) transformMesh(m, T);
  r.listMeshes().forEach((m, i) => m.setName(i ? `${a.id}-${i}` : a.id));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${a.id}-${i}` : a.id));
  r.listMaterials().forEach((m, i) => m.setName(i ? `office-${a.id}-${i}` : `office-${a.id}`));
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [basePx, basePx], quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [otherPx, otherPx], quality, slots: /^(?!baseColor)/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-office-overhaul.mjs (glTF-Transform)';
  return {glb: Buffer.from(await io.writeBinary(doc)), scale: s, rawExtent: e0};
}

for (const a of ASSETS) {
  const j = jobsFor(a);
  if (!j.dl) {
    const failedNow = j.failed.length && !j.acks.some(x => x.kind === 'refine');
    missing.push({id: a.id, code: a.code, reason: failedNow ? `generation failed (${j.failed.map(f => f.status).join(', ')})`
      : j.acks.some(x => x.kind === 'refine') ? 'refine submitted, not accepted/delivered yet' : j.acks.some(x => x.kind === 'preview') ? 'preview only' : 'not generated'});
    continue;
  }
  const rawPath = path.join(ASSETS_DIR, j.dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== j.dl.sha256) throw new Error(`raw sha mismatch for ${a.id}: ${j.dl.file}`);
  const outRel = outRelOf(a.id);
  const outAbs = path.join(root, 'game/public', outRel);
  const front = j.accepted.front ?? '+Z';
  if (!(front in ROT)) throw new Error(`${a.id}: bad front ${front}`);
  // collision guard: never overwrite a public model this task did not create
  const prevMine = prevProv?.outputs?.some(o => o.output.url === outRel);
  if (fs.existsSync(outAbs) && allow.files.some(f => f.path === outRel) && !prevMine) throw new Error(`${outRel} exists and is not this task's file`);

  let glb, scale, rawExtent, step = 0;
  const ladder = isLarge(a) ? LADDER_LARGE : LADDER_SMALL;
  const reuse = ONLY && !ONLY.has(a.code) && fs.existsSync(outAbs) && prevProv?.outputs?.find(o => o.id === a.id && o.source.sha256 === j.dl.sha256 && o.output.sha256 === sha(fs.readFileSync(outAbs)));
  if (reuse) {
    glb = fs.readFileSync(outAbs); scale = reuse.scale; rawExtent = reuse.source.extent; step = reuse.textureStep;
  } else {
    for (step = 0; step < ladder.length; step++) {
      ({glb, scale, rawExtent} = await derive(a, rawBytes, front, ladder[step]));
      if (glb.length <= BUDGET(a)) break;
    }
    if (step === ladder.length) step = ladder.length - 1;
    const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
    if (/https?:|Signature=|X-Amz|Key-Pair-Id|token=/i.test(jsonChunk)) throw new Error(`URL/token-like string inside ${a.id} glTF JSON`);
    fs.writeFileSync(outAbs, glb);
  }
  // re-measure the written file
  const chk = await io.readBinary(new Uint8Array(glb));
  const b = getBounds(chk.getRoot().getDefaultScene() ?? chk.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(k => +(b.max[k] - b.min[k]).toFixed(4));
  const tris = chk.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 * a.sizeM || Math.abs(b.min[2] + b.max[2]) > 1e-3 * a.sizeM) throw new Error(`${a.id} not grounded/centred`);
  const textures = chk.getRoot().listTextures().map(t => {
    const slot = chk.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  const rawDoc = await io.readBinary(new Uint8Array(rawBytes));
  const rawTex = rawDoc.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  const rawTris = rawDoc.getRoot().listMeshes().reduce((s2, m) => s2 + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const overBudget = glb.length > BUDGET(a);
  const attempts = j.acks.map(x => ({kind: x.kind, task: x.task_id, ...(j.rejects.find(r => r.task_id === x.task_id) ? {rejected: j.rejects.find(r => r.task_id === x.task_id).reason} : {}),
    ...(j.failed.find(f => f.task_id === x.task_id) ? {status: j.failed.find(f => f.task_id === x.task_id).status} : {})}));
  outputs.push({code: a.code, id: a.id, key: `office-${a.id}`, company: a.company, use: a.use, placement: a.placement, subject: a.subject,
    ...(a.justification ? {justification: a.justification, feedbackItem: a.feedbackItem} : {}),
    model: 'meshy-t2.5', modelType: 'smart-topology', topology: 'triangle', route: 'text-to-3d preview (geometry) + refine (2K PBR texture, inherits the preview model)',
    previewPrompt: j.previewIntent?.args.prompt ?? a.preview.prompt, texturePrompt: j.refineIntent?.args.texture_prompt ?? a.refine.texture_prompt,
    previewArgs: j.previewIntent ? (({prompt: _p, response_format: _r, ...rest}) => rest)(j.previewIntent.args) : null,
    refineArgs: j.refineIntent ? (({texture_prompt: _t, preview_task_id: _i, response_format: _r, ...rest}) => ({...rest, ai_model: 'omitted (inherits the T2.5 preview)'}))(j.refineIntent.args) : null,
    tasks: {preview: j.refineAck.preview_task_id, refine: j.dl.task_id},
    credits: {preview: j.previewDl?.consumed_credits ?? null, refine: j.dl.consumed_credits ?? null},
    creditsAllAttempts: j.credits.total, attempts,
    source: {file: `${TASK_DIR}/assets/${j.dl.file} (raw original, outside Git)`, sha256: j.dl.sha256, bytes: j.dl.bytes, triangles: rawTris, extent: rawExtent.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: j.previewDl ? `${TASK_DIR}/assets/${j.previewDl.file}` : null, previewSha256: j.previewDl?.sha256 ?? null, previewTriangles: j.previewDl?.glb?.tris ?? null},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: tris, dims, overBudget},
    targetTriangles: a.tris, sizeM: a.sizeM, sizeAxis: a.sizeAxis, scale: +scale.toFixed(6), nativeFront: front, textureStep: step,
    textureSizes: {baseColor: ladder[step][0], other: ladder[step][1], jpegQuality: ladder[step][2]},
    transform: `rotateY(${({'+Z': '180', '-Z': '0', '+X': '90', '-X': '-90'})[front]}deg) * uniform scale, then grounded (min y = 0) and centred on x/z; baked into vertices`, front: '-Z', up: '+Y',
    review: {evidence: j.accepted.evidence ?? null, checks: j.accepted.checks ?? null, observation: j.accepted.observation ?? null},
    ...(NOTES[a.id] ? {note: NOTES[a.id]} : {}), textures});
  console.log(`${a.code} ${a.id}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e3).toFixed(0)} kB (tex step ${step}), dims ${dims.join(' x ')}${overBudget ? '  OVER BUDGET' : ''}${reuse ? ' (reused)' : ''}`);
}

// ---------- credits summary (whole run, from the ledger) ----------
const billed = new Map();
for (const e of ledger) if ((e.event === 'download' || e.event === 'status') && e.task_id && typeof e.consumed_credits === 'number') billed.set(e.task_id, {kind: e.kind, credits: e.consumed_credits, code: e.code});
const rejectedTasks = new Set(ledger.filter(e => e.event === 'reject').map(e => e.task_id));
const creditSummary = {previews: 0, refines: 0, rejectedOrReplacedAttempts: 0, total: 0};
for (const [tid, v] of billed) { creditSummary[v.kind === 'preview' ? 'previews' : 'refines'] += v.credits; if (rejectedTasks.has(tid)) creditSummary.rejectedOrReplacedAttempts += v.credits; creditSummary.total += v.credits; }
const replacements = ledger.filter(e => e.event === 'intent' && e.replacement).map(e => ({code: e.code, kind: e.kind, reason: e.replacement}));

// ---------- provenance ----------
const mcpDir = (() => {
  const base = path.join(process.env.HOME ?? '/home/node', '.npm/_npx');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).sort()) { const p = path.join(base, d, 'node_modules/@meshy-ai/meshy-mcp-server'); if (fs.existsSync(path.join(p, 'dist/tools/generation.js'))) return p; }
  return null;
})();
const mcpSha = mcpDir ? {version: JSON.parse(fs.readFileSync(path.join(mcpDir, 'package.json'), 'utf8')).version,
  'dist/tools/generation.js': sha(fs.readFileSync(path.join(mcpDir, 'dist/tools/generation.js'))),
  'dist/utils/generation-options.js': fs.existsSync(path.join(mcpDir, 'dist/utils/generation-options.js')) ? sha(fs.readFileSync(path.join(mcpDir, 'dist/utils/generation-options.js'))) : null} : (prevProv?.modelProof?.mcpSource ?? null);
const prov = {schema: 'last-line-derivative/1', asset: 'office-overhaul-20261030', task: TASK, lane: 'ASSETS (Studio Beta office overhaul)',
  status: 'runtime derivatives of models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP under the user\'s explicit authorization for this brief (40 company props + justified supporting office models, finite manifest, run cap 960 credits); provider terms apply; unapproved prototypes, no licence or commercial clearance implied',
  rebuild: 'node tools/asset-pipeline/props/build-office-overhaul.mjs',
  rawStorage: `${TASK_DIR}/assets/raw/<id>/{preview,refine}/ (immutable native GLBs, task status JSON, thumbnails) + ${TASK_DIR}/assets/ledger.jsonl (fsynced intent/ack/status/download/inspect records) + manifest.json (sha256 ${MANIFEST_SHA}); outside Git`,
  convention: 'metres at real size (sizeM along sizeAxis), +Y up, front -Z, grounded (min y = 0), centred on x/z; native front (normally +Z) turned to -Z about Y',
  texturePolicy: 'native 2K PBR maps (base colour, metallic-roughness, normal) kept per channel, downsized with sharp Lanczos to JPEG: base colour 1024 for pieces >= 1.5 m nominal else 512, other maps 512, q85; deterministic step-down ladder to stay under 600 kB (large) / 400 kB (small)',
  modelProof: {
    requested: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', topology: 'triangle', target_formats: ['glb'], refine: 'texture_resolution 2k, enable_pbr true, ai_model omitted (inherits the preview model)'},
    evidence: [
      'exact create arguments (verbatim from the pinned manifest) recorded in the fsynced ledger (intent line) before every paid call; ack with the returned task id right after',
      'every preview billed 5 credits (the T2 / T2.5 / 6-lite tier; meshy-6, meshy-7.1 and latest bill 20) and every refine 10 (2K texture)',
      'every preview returned a triangle-only mesh near target_polycount (smart-topology behaviour), kept unchanged by its refine',
      'the Meshy task GET response surfaced by the MCP does not echo ai_model / model_type, so the request record is the model proof'],
    mcpSource: mcpSha},
  manifest: {assets: ASSETS.length, company: ASSETS.filter(a => a.use === 'company').length, support: ASSETS.filter(a => a.use === 'support').length,
    manifestCredits: MANIFEST_JSON.manifestCredits, maxReplacements: MANIFEST_JSON.maxReplacements, runCap: MANIFEST_JSON.runCapCredits, sha256: MANIFEST_SHA},
  credits: creditSummary, replacements,
  outputs, missing};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i);
  if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }
const newFiles = outputs.map(o => ({path: o.output.url, buf: fs.readFileSync(path.join(root, 'game/public', o.output.url))}));
if (outputs.length) { fs.writeFileSync(PROV, provBuf); newFiles.push({path: PROV_REL, buf: provBuf}); }

// ---------- allowlist (only this task's paths; CREDITS.md entry refreshed only when it carries this task's section) ----------
const kept = allow.files.filter(f => !MY_PATHS.has(f.path));
const added = newFiles.map(f => ({path: f.path, bytes: f.buf.length, sha256: sha(f.buf)}));
for (const f of allow.files.filter(f => MY_PATHS.has(f.path) && !added.some(x => x.path === f.path))) console.warn('allowlist: dropping stale', f.path);
allow.files = [...kept, ...added].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
const credBuf = fs.readFileSync(CREDITS);
if (credBuf.toString().includes(CREDITS_MARK)) {
  const ce = allow.files.find(f => f.path === CREDITS_REL);
  if (ce && (ce.sha256 !== sha(credBuf) || ce.bytes !== credBuf.length)) { ce.bytes = credBuf.length; ce.sha256 = sha(credBuf); console.log('allowlist: refreshed assets/CREDITS.md (carries this task\'s credits section)'); }
}
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');

// ---------- registry (GENERATED blocks of companyAssets.ts / companyDims.generated.ts) ----------
const q = v => (v === null ? 'null' : `'${v}'`);
const arr = v => `[${v.join(', ')}]`;
const assetLines = ASSETS.map(a => {
  const o = outputs.find(x => x.id === a.id);
  return `  '${a.id}': {url: ${o ? q(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, tris: ${o ? o.output.triangles : 0}, sizeM: ${a.sizeM}, sizeAxis: '${a.sizeAxis}', code: '${a.code}', company: ${q(a.company)}, use: '${a.use}', placement: '${a.placement}', targetTris: ${a.tris}, dims: ${o ? arr(o.output.dims) : 'null'}},`;
});
const block1 = ['// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers',
  'export const COMPANY_ASSETS: Record<CompanyAssetId, CompanyAssetEntry> = {', ...assetLines, '};', '// END GENERATED'].join('\n');
const block2 = ['// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers',
  'export const COMPANY_DIMS: Record<string, readonly [number, number, number] | null> = {',
  ...ASSETS.map(a => { const o = outputs.find(x => x.id === a.id); return `  '${a.id}': ${o ? arr(o.output.dims) : 'null'},`; }), '};', '',
  'export const COMPANY_ASSET_SPECS: Record<string, CompanyAssetSpec> = {',
  ...ASSETS.map(a => `  '${a.id}': {code: '${a.code}', company: ${q(a.company)}, use: '${a.use}', sizeM: ${a.sizeM}, sizeAxis: '${a.sizeAxis}', placement: '${a.placement}'},`),
  '};', '// END GENERATED'].join('\n');
const re = /\/\/ BEGIN GENERATED[^\n]*\n[\s\S]*?\/\/ END GENERATED/;
for (const [f, blk] of [[REGISTRY, block1], [DIMS_TS, block2]]) {
  const src = fs.readFileSync(f, 'utf8');
  if (!re.test(src)) throw new Error(`GENERATED markers missing in ${f}`);
  const next = src.replace(re, blk);
  if (next !== src) fs.writeFileSync(f, next);
}

// ---------- delivery note (atomic) ----------
const delivered = {task: TASK, generatedBy: 'tools/asset-pipeline/props/build-office-overhaul.mjs', credits: creditSummary, replacements, assets: {}};
for (const a of ASSETS) {
  const o = outputs.find(x => x.id === a.id), m = missing.find(x => x.id === a.id), j = jobsFor(a);
  const nominalOther = o ? (() => { const d = o.output.dims; return {x: d[0], y: d[1], z: d[2]}; })() : null;
  delivered.assets[a.id] = {code: a.code, id: a.id, key: `office-${a.id}`, company: a.company, use: a.use, placement: a.placement,
    status: o ? 'ready' : /failed/.test(m?.reason ?? '') ? 'failed' : 'missing',
    url: o ? o.output.url : null, sizeM: a.sizeM, sizeAxis: a.sizeAxis, dims: o ? o.output.dims : null, measured: nominalOther,
    tris: o ? o.output.triangles : 0, bytes: o ? o.output.bytes : 0,
    tasks: j.acks.map(x => ({kind: x.kind, task_id: x.task_id, ...(j.rejects.some(r => r.task_id === x.task_id) ? {rejected: true} : {})})),
    credits: j.credits.total,
    files: o ? {raw: o.source.file.replace(/ \(raw.*$/, ''), rawSha256: o.source.sha256, preview: o.source.previewFile, previewSha256: o.source.previewSha256,
      runtime: o.output.file, runtimeSha256: o.output.sha256} : null,
    nativeFront: o ? o.nativeFront : null,
    note: o ? `front -Z, grounded, centred${o.note ? `; ${o.note}` : ''}${o.output.overBudget ? '; OVER byte budget' : ''}` : m.reason};
}
const tmp = `${DELIVERED}.tmp-${process.pid}`;
const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(delivered, null, 1) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd);
fs.renameSync(tmp, DELIVERED);
const totalBytes = outputs.reduce((s2, o) => s2 + o.output.bytes, 0);
console.log(`models ready ${outputs.length}/${ASSETS.length} (${(totalBytes / 1e6).toFixed(2)} MB runtime); credits ${JSON.stringify(creditSummary)}; wrote ${outputs.length ? path.relative(root, PROV) + ', ' : ''}allowlist (${added.length} own entries), registry + dims, DELIVERED.json`);
