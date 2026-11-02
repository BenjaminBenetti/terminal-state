// Task studio-reactor-surface-ending-20261102-213051-01 (primary — the SOLE Meshy / Codex producer): the runtime derivatives of THE REACTOR
// SURFACE ENDING's ruined-city kit — accepted Meshy T2.5 models from Codex initial reference images (each generated with the actual B
// concept attached as the style reference), seen from the bounded surface around the roof aperture after the win.
//
// Reads (never modifies) the task records kept OUTSIDE Git in reference/tasks/reactor-surface-ending-20261102-213051/:
//   meshy/MANIFEST.json   asset families, inputs (Codex image sha256), recipes, forecast
//   meshy/LEDGER.jsonl    fsynced reserve+intent / ack / status / download / inspect lines; the ACCEPTED result's download line carries
//                         the raw sha256 this script verifies (authority sha256 1eb98c31… on every line)
//   meshy/raw/<asset>/attempt-<n>/   immutable native GLBs + maps (0444)
//   art/codex/ATTEMPTS.jsonl + *.png the Codex initial images (accepted lines carry their sha256)
// and writes deterministically:
//   game/public/assets/models/reactor-<id>.glb                 Reactor-only (LEVEL_ONLY_RULES 'reactor-'), one file per model
//   game/public/assets/derivatives/reactor-surface-kit-20261102.json   provenance (no URLs / tokens; tracked, not shipped)
//   game/src/assets/reactorSurfaceKit.generated.ts            {key, url, bytes, tris, dims} per model (bundle literals)
//   tools/release/public-inputs.json                           ONLY this script's paths added / updated (+ CREDITS.md)
//   game/public/assets/CREDITS.md                              the marked reactor-surface-kit section
//
// Derivatives: Meshy's native frame kept (front +Z as generated), UNIFORM scale so the model's reference axis matches its nominal
// real size (KIT below), grounded (min y = 0), centred on x / z, baked into the vertices. No geometry simplification (Smart Topology
// made them at target). The native 2K PBR material is KEPT channel for channel (the user's rule: Meshy outputs keep their maps; no
// reprojection / retexture), only re-encoded / downsized with sharp to JPEG per the size policy.
//
//   node tools/asset-pipeline/props/build-reactor-surface-kit.mjs [--dry-run] [--only id,id]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-reactor-surface-ending-20261102-213051-01';
const TASK_DIR = 'reference/tasks/reactor-surface-ending-20261102-213051';
const AUTH = '1eb98c310d518f7762254fff11c30b5d455adbc87eb970877d1b6761dcab2247';
const B_SHA = 'd7e5821d6146af0c4ee0cbe1485c8863c825156a227e5a132992bfe99e9df340';
const MESHY = path.join(root, TASK_DIR, 'meshy');
const CODEX = path.join(root, TASK_DIR, 'art/codex');
const PUB = path.join(root, 'game/public');
const PROV_REL = 'assets/derivatives/reactor-surface-kit-20261102.json';
const REG = path.join(root, 'game/src/assets/reactorSurfaceKit.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN reactor-surface-kit-20261102 (build-reactor-surface-kit.mjs) -->';
const CREDITS_END = '<!-- END reactor-surface-kit-20261102 -->';
const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The kit: runtime key, the reference axis (0 x / 1 y / 2 z) and its nominal real size (m), texture policy (base / mr / normal px),
 * what it is. Sizes: real-world scale (root CLAUDE.md rule 5), checked beside a runtime zombie (scale-check renders in the task folder).
 */
const KIT = [
  // the ruined city round the surface (distant / mid-distance buildings: base 1024, mr 256, normal 512)
  {id: 'city-highrise-ruin', key: 'cityHighrise', axis: 1, size: 75.0, tex: [1024, 256, 512], what: 'surface: ruined ~25-storey glass / concrete office tower, top sheared off'},
  {id: 'city-apartment-ruin', key: 'cityApartment', axis: 1, size: 24.0, tex: [1024, 256, 512], what: 'surface: ruined 7-storey brick apartment block with fire escapes, a collapsed corner'},
  {id: 'city-garage-skeleton', key: 'cityGarage', axis: 1, size: 16.0, tex: [1024, 256, 512], what: 'surface: burned-out multi-storey parking garage stripped to its concrete frame'},
  {id: 'city-storefront-row', key: 'cityStorefronts', axis: 1, size: 8.0, tex: [1024, 256, 512], what: 'surface: ruined two-storey corner row of shops (blank signs)'},
];
/** No tileable surface sets in this kit. */
const TEXTURES = [];

// ---------- records ----------
const ledger = fs.readFileSync(path.join(MESHY, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (ledger.some(e => e.authority !== AUTH)) throw new Error('ledger line without the authority sha');
const last = ledger[ledger.length - 1];
if (last.billed + last.reserved > 200 || last.attempts > 12 || last.attemptedPOSTs > 24) throw new Error(`ledger outside the authority: ${JSON.stringify(last)}`);
const codexRows = fs.readFileSync(path.join(CODEX, 'ATTEMPTS.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(MESHY, 'MANIFEST.json'), 'utf8'));

function acceptedModel(id, refine) {
  const acc = ledger.filter(e => e.event === 'inspect' && e.asset === id && e.verdict === 'accepted' && (refine ? e.kind === 'refine' : !e.kind));
  if (acc.length !== 1) throw new Error(`${id}: expected exactly one accepted ${refine ? 'refine' : 'result'}, found ${acc.length}`);
  const a = acc[0];
  const dl = ledger.find(e => e.event === 'download' && e.task_id === a.task_id);
  if (!dl) throw new Error(`${id}: no download record`);
  const file = Object.keys(dl.files).find(f => f.endsWith('.glb'));
  const bytes = fs.readFileSync(path.join(MESHY, file));
  if (sha(bytes) !== dl.files[file]) throw new Error(`${id}: raw sha mismatch ${file}`);
  const status = ledger.find(e => e.event === 'status' && e.task_id === a.task_id);
  const intent = ledger.filter(e => e.event === 'reserve+intent' && e.asset === id);
  const m = manifest.assets.find(x => x.id === id);
  const codex = m ? codexRows.find(r => r.event === 'accepted' && r.file === m.input) : null;
  if (m && (!codex || codex.sha256 !== m.inputSha256)) throw new Error(`${id}: Codex input not accepted / sha mismatch`);
  return {acc: a, dl, file, bytes, status, intent, manifest: m, codex};
}

const kitOut = [], texOut = [], written = [];
for (const k of KIT) {
  if (ONLY && !ONLY.has(k.id)) continue;
  let rec;
  try { rec = acceptedModel(k.id, !!k.refine); } catch (e) { console.warn(`skip ${k.id}: ${e.message}`); continue; }
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const raw = [0, 1, 2].map(i => b0.max[i] - b0.min[i]);
  const ref = k.axis < 0 ? Math.max(...raw) : raw[k.axis];
  const s = k.size / ref;
  for (const m of r.listMeshes()) transformMesh(m, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const b1 = getBounds(scene);
  for (const m of r.listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1]);
  const name = `reactor-${k.id.replace(/^reactor-/, '')}`; // (expansion ids never collide with build-reactor-kit.mjs ids)
  r.listMeshes().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${name}-${i}` : name));
  r.listMaterials().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  const [tb, tmr, tn] = k.tex;
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tb, tb], quality: 86, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tmr, tmr], quality: 86, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tn, tn], quality: 90, slots: /^normal/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-reactor-surface-kit.mjs (glTF-Transform)';
  const glb = Buffer.from(await io.writeBinary(doc));
  const d2 = await io.readBinary(new Uint8Array(glb));
  const bb = getBounds(d2.getRoot().getDefaultScene() ?? d2.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(i => +(bb.max[i] - bb.min[i]).toFixed(4));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 3e-3 || Math.abs(bb.min[2] + bb.max[2]) > 3e-3) throw new Error(`${k.id}: not grounded / centred`);
  const tris = d2.getRoot().listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((u, p) => u + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const mats = d2.getRoot().listMaterials();
  const textures = d2.getRoot().listTextures().map(t => ({
    slot: mats.flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]).find(([, x]) => x === t)?.[0] ?? 'unused',
    size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength,
  }));
  const url = `assets/models/${name}.glb`;
  kitOut.push({key: k.key, id: k.id, url, bytes: glb.length, tris, dims, what: k.what, scale: +s.toFixed(5), rawExtent: raw.map(v => +v.toFixed(4)), textures,
    task: rec.acc.task_id, credits: rec.status?.consumed_credits ?? null, codexInput: rec.manifest ? {file: rec.manifest.input, sha256: rec.manifest.inputSha256, codexSession: codexRows.find(x => x.event === 'result' && x.outputs?.[0]?.file === rec.manifest.input)?.codexSession ?? null} : null,
    source: {file: rec.file, sha256: rec.dl.files[rec.file]}, sha256: sha(glb), glb});
}

// ---------- surface textures ----------
for (const t of TEXTURES) {
  if (ONLY && !ONLY.has(t.id)) continue;
  const acc = codexRows.find(r => r.event === 'accepted' && r.asset === t.id);
  if (!acc) { console.warn(`skip ${t.id}: not accepted`); continue; }
  const src = fs.readFileSync(path.join(CODEX, acc.file));
  if (sha(src) !== acc.sha256) throw new Error(`${t.id}: Codex sha mismatch`);
  const N = t.size;
  // colour: centre square crop, resized (the source was asked for a seamless tile; the crop keeps its full repeat)
  const meta = await sharp(src).metadata();
  const side = Math.min(meta.width, meta.height);
  const colorImg = sharp(src).extract({left: Math.floor((meta.width - side) / 2), top: Math.floor((meta.height - side) / 2), width: side, height: side}).resize(N, N);
  const color = await colorImg.clone().jpeg({quality: 86}).toBuffer();
  const {data: rgb} = await colorImg.clone().removeAlpha().raw().toBuffer({resolveWithObject: true});
  const lum = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) lum[i] = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255;
  // height = luminance, box-blurred (wrap-around: the tile stays seamless)
  const blur = (src, r) => { const out = new Float32Array(N * N), tmp = new Float32Array(N * N), w = 2 * r + 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let d = -r; d <= r; d++) s += src[y * N + ((x + d + N) % N)]; tmp[y * N + x] = s / w; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let d = -r; d <= r; d++) s += tmp[((y + d + N) % N) * N + x]; out[y * N + x] = s / w; }
    return out; };
  const h = blur(lum, 1), low = blur(lum, 12);
  const nrm = Buffer.alloc(N * N * 3), orm = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dx = (h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N]) * t.strength, dy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * t.strength;
    const l = Math.hypot(dx, dy, 1);
    nrm[i * 3] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[i * 3 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nrm[i * 3 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    const ao = Math.min(1, Math.max(0.35, 1 - (low[i] - h[i]) * 2.2));
    const rough = t.rough[0] + (t.rough[1] - t.rough[0]) * (1 - Math.min(1, h[i] * 1.4));
    // metal: bright, low-saturation pixels read as bare steel; rust / paint less metallic
    const r8 = rgb[i * 3], g8 = rgb[i * 3 + 1], b8 = rgb[i * 3 + 2], sat = (Math.max(r8, g8, b8) - Math.min(r8, g8, b8)) / 255;
    const metal = t.metal * Math.max(0, 1 - sat * 2.5);
    orm[i * 3] = Math.round(ao * 255); orm[i * 3 + 1] = Math.round(rough * 255); orm[i * 3 + 2] = Math.round(metal * 255);
  }
  const normal = await sharp(nrm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: 90}).toBuffer();
  const ormJpg = await sharp(orm, {raw: {width: N, height: N, channels: 3}}).jpeg({quality: 88}).toBuffer();
  const base = `assets/textures/reactor/${t.name}`;
  texOut.push({key: t.name, id: t.id, what: t.what, size: N, codex: {file: acc.file, sha256: acc.sha256, codexSession: codexRows.find(x => x.event === 'result' && x.outputs?.[0]?.file === acc.file)?.codexSession ?? null},
    files: [{url: `${base}-color.jpg`, buf: color}, {url: `${base}-normal.jpg`, buf: normal}, {url: `${base}-orm.jpg`, buf: ormJpg}]});
}

// ---------- outputs ----------
const totalBytes = kitOut.reduce((s, k) => s + k.bytes, 0) + texOut.reduce((s, t) => s + t.files.reduce((u, f) => u + f.buf.length, 0), 0);
console.log(JSON.stringify({models: kitOut.map(k => ({id: k.id, bytes: k.bytes, tris: k.tris, dims: k.dims})), textures: texOut.map(t => ({id: t.id, bytes: t.files.map(f => f.buf.length)})), totalMiB: +(totalBytes / 1048576).toFixed(2), ledger: {billed: last.billed, reserved: last.reserved, attempts: last.attempts, posts: last.attemptedPOSTs}}, null, 1));
if (DRY) process.exit(0);
if (ONLY) throw new Error('--only is for dry runs (the registry / provenance must list the whole kit)');

fs.mkdirSync(path.join(PUB, 'assets/textures/reactor'), {recursive: true});
for (const k of kitOut) { fs.writeFileSync(path.join(PUB, k.url), k.glb); written.push(k.url); }
for (const t of texOut) for (const f of t.files) { fs.writeFileSync(path.join(PUB, f.url), f.buf); written.push(f.url); }
const prov = {schema: 'last-line-derivative/1', asset: 'reactor-surface-kit-20261102', task: TASK, lane: 'primary (sole Meshy / Codex producer)',
  status: 'runtime derivatives of NEW Reactor surface-ending city models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP, from Codex initial reference images (and three Codex tileable surface sources) each generated WITH the user-selected B concept image attached; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  selectedReference: {file: 'B-service-cathedral-attempt2.png (private, outside Git)', sha256: B_SHA},
  authority: {userGenerationApprovalSha256: AUTH, caps: {credits: 200, attempts: 12, paidPosts: 24}},
  rebuild: 'node tools/asset-pipeline/props/build-reactor-surface-kit.mjs',
  rawStorage: `${TASK_DIR}/meshy/raw/<asset>/attempt-<n>/ (immutable native GLBs + maps, read-only) + meshy/LEDGER.jsonl + MANIFEST.json; Codex originals ${TASK_DIR}/art/codex/ (read-only) + ATTEMPTS.jsonl; outside Git`,
  modelProof: {requested: 'image-to-3d: ai_model meshy-t2.5, model_type smart-topology, should_texture, texture_resolution 2k, enable_pbr, target_formats [glb]; text-to-3d: preview ai_model meshy-t2.5 smart-topology + refine (enable_pbr, 2k, ai_model omitted: inherits the preview)',
    evidence: ['exact create arguments in the fsynced ledger intent line before each paid call; ack with the returned task id right after', 'billing tier: image-to-3d 15 (T2 / T2.5 textured; 7.1 / 6 / latest bill 30), text preview 5 (7.1 / 6 / latest bill 20), refine 10', 'the Meshy task GET response does not echo ai_model / model_type: the request record + billing tier are the model proof']},
  texturePolicy: 'Meshy maps kept channel for channel (re-encoded JPEG: base / metallicRoughness / normal per KIT.tex); surface sets: Codex colour source + normal / ORM derived locally from its luminance (no generation)',
  ledger: {attempts: last.attempts, attemptedPOSTs: last.attemptedPOSTs, billed: last.billed, reserved: last.reserved, accepted: last.accepted},
  models: kitOut.map(({glb, ...k}) => k), textures: texOut.map(t => ({key: t.key, id: t.id, what: t.what, size: t.size, codex: t.codex, files: t.files.map(f => ({url: f.url, bytes: f.buf.length, sha256: sha(f.buf)}))}))};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf); written.push(PROV_REL);
const reg = `// GENERATED by tools/asset-pipeline/props/build-reactor-surface-kit.mjs — do not edit (task ${TASK}, primary).
// THE REACTOR SURFACE ENDING's ruined-city Meshy T2.5 kit (from Codex reference images made with the user-selected B concept attached);
// provenance ${PROV_REL}. Models: real size (metres), +Y up, Meshy's native front +Z, grounded (min y 0), centred on x / z; maps kept.
import type {ReactorKitModel} from './reactorKit.generated';
export const REACTOR_SURFACE_KIT = {
${kitOut.map(k => `  ${k.key}: {key: 'reactor-${k.key}', url: '${k.url}', bytes: ${k.bytes}, tris: ${k.tris}, dims: [${k.dims.join(', ')}]},`).join('\n')}
} as const satisfies Readonly<Record<string, ReactorKitModel>>;
`;
fs.writeFileSync(REG, reg);
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const credSection = [CREDITS_BEGIN, '## The Reactor surface ending: the ruined city round the roof aperture', '',
  `Generated for this project with Meshy T2.5 (smart topology; image-to-3D from Codex initial reference images made with the user-selected B concept attached) through the Meshy MCP under the user's NEW surface-ending 200-credit authorization (sha256 ${AUTH.slice(0, 8)}…); Meshy's PBR maps kept (re-encoded only). Raw masters + provenance stay private / tracked outside the shipped site.`, '',
  ...kitOut.map(k => `- \`${k.url}\` — ${k.what} (Meshy task ${k.task})`),
  ...texOut.map(t => `- \`assets/textures/reactor/${t.key}-{color,normal,orm}.jpg\` — ${t.what} (Codex colour source; normal / ORM derived locally)`), CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
fs.writeFileSync(CREDITS, credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`);
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([...written, 'assets/CREDITS.md']);
const add = [...mine].map(p => { const b = fs.readFileSync(path.join(PUB, p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
// drop only THIS kit's own stale outputs (build-reactor-kit.mjs's models / textures keep their entries)
const ownModel = new Set(KIT.map(k => `assets/models/reactor-${k.id.replace(/^reactor-/, '')}.glb`));
allow.files = [...allow.files.filter(f => !mine.has(f.path) && !ownModel.has(f.path) && !TEXTURES.some(t => f.path.startsWith(`assets/textures/reactor/${t.name}-`))), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', written.length, 'public files +', path.relative(root, REG), 'CREDITS.md public-inputs.json');
