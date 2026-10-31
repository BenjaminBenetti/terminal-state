// Task studio-alpha-track2-round2-20261031-01 (R3, primary — the sole Meshy submitter): the runtime derivative of the ONE accepted
// annex generator set, generated with Meshy T2.5 (smart-topology text-to-3D preview + 2K PBR refine) under the user's task-specific
// "100 credit budget" (<= 100 credits billed + reserved, <= 20 attempts, <= 40 attempted POSTs, ONE accepted model).
//
// Reads (never modifies) the task records kept OUTSIDE Git in reference/tasks/track2-round2-20261031/meshy/:
//   MANIFEST.json  the primary-frozen one-asset manifest (prompts, runtime fit, acceptance criteria)
//   LEDGER.jsonl   fsynced reserve / intent / ack / status / download / inspect / stop lines; the ACCEPTED refine's download line
//                  carries the raw sha256 this script verifies
//   raw/annex-genset-01/attempt-01/{preview,refine}/  immutable native GLBs + maps (read-only)
// and writes deterministically:
//   game/public/assets/models/annex-genset.glb                  shared (not mall-*), one mesh / one material
//   game/public/assets/derivatives/annex-genset-20261031.json   provenance (no URLs / tokens)
//   game/src/assets/annexGenset.generated.ts                    url / bytes / tris / dims (bundle literals for package-ci)
//   tools/release/public-inputs.json                            ONLY this task's two paths added / updated
//   game/public/assets/CREDITS.md                               the marked annex-genset section
//
// Derivative = native front +Z / length along X kept (the annex machine frame: front +Z, width along local X), UNIFORM scale to the
// nominal 3.5 m length (the generator room's ordinary genset footprint; gen/annexRooms.ts generatorLayout), grounded (min y = 0),
// centred on x / z, baked into the vertices. No geometry simplification (Smart Topology made ~11.6k triangles). The native 2K PBR
// material is kept channel for channel, downsized with sharp to JPEG: base colour 1024, metallic-roughness 256, normal 512.
//
//   node tools/asset-pipeline/props/build-annex-genset.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-alpha-track2-round2-20261031-01';
const TASK_DIR = 'reference/tasks/track2-round2-20261031';
const MESHY = path.join(root, TASK_DIR, 'meshy');
const PUB = path.join(root, 'game/public');
const OUT_REL = 'assets/models/annex-genset.glb';
const PROV_REL = 'assets/derivatives/annex-genset-20261031.json';
const REG = path.join(root, 'game/src/assets/annexGenset.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN annex-genset-20261031 (build-annex-genset.mjs) -->';
const CREDITS_END = '<!-- END annex-genset-20261031 -->';
const LENGTH_M = 3.5, TEX = {base: 1024, mr: 256, normal: 512, quality: 86};
const DRY = process.argv.includes('--dry-run');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// ---------- records: the accepted refine and its verified raw ----------
const ledger = fs.readFileSync(path.join(MESHY, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const manifest = JSON.parse(fs.readFileSync(path.join(MESHY, 'MANIFEST.json'), 'utf8'));
const asset = manifest.assets[0];
const accepted = ledger.filter(e => e.event === 'inspect' && e.kind === 'refine' && e.verdict === 'accepted' && e.asset === asset.id);
if (accepted.length !== 1) throw new Error(`expected exactly one accepted refine, found ${accepted.length}`);
const acc = accepted[0];
const dl = ledger.find(e => e.event === 'download' && e.kind === 'refine' && e.task_id === acc.task_id);
const refineAck = ledger.find(e => e.event === 'ack' && e.kind === 'refine' && e.task_id === acc.task_id);
const previewDl = ledger.find(e => e.event === 'download' && e.kind === 'preview' && e.task_id === refineAck.preview_task_id);
const rawBytes = fs.readFileSync(path.join(MESHY, dl.file));
if (sha(rawBytes) !== dl.sha256) throw new Error(`raw sha mismatch: ${dl.file}`);
const last = ledger[ledger.length - 1];
const stop = ledger.find(e => e.event === 'stop' && e.asset === asset.id);
if (!stop) throw new Error('no stop record: generation must be closed before a derivative ships');
if (last.billed + last.reserved > 100 || last.attempts > 20 || last.attemptedPOSTs > 40 || last.accepted !== 1) throw new Error(`ledger outside the authority: ${JSON.stringify(last)}`);

// ---------- derive ----------
const doc = await io.readBinary(new Uint8Array(rawBytes));
const r = doc.getRoot();
await doc.transform(flatten());
for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
const scene = r.getDefaultScene() ?? r.listScenes()[0];
const b0 = getBounds(scene);
const raw = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
if (!(raw[0] > raw[2] && raw[0] > raw[1])) throw new Error(`native length is not along X: ${raw}`);
const s = LENGTH_M / raw[0];
for (const m of r.listMeshes()) transformMesh(m, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
const b1 = getBounds(scene);
for (const m of r.listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1]);
r.listMeshes().forEach((m, i) => m.setName(i ? `annex-genset-${i}` : 'annex-genset'));
r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `annex-genset-${i}` : 'annex-genset'));
r.listMaterials().forEach((m, i) => m.setName(i ? `annex-genset-${i}` : 'annex-genset'));
await doc.transform(dedup(), prune(),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.base, TEX.base], quality: TEX.quality, slots: /^baseColor/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.mr, TEX.mr], quality: TEX.quality, slots: /^metallicRoughness/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX.normal, TEX.normal], quality: TEX.quality, slots: /^normal/}));
r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-annex-genset.mjs (glTF-Transform)';
const glb = Buffer.from(await io.writeBinary(doc));

// ---------- measure ----------
const d2 = await io.readBinary(new Uint8Array(glb));
const bb = getBounds(d2.getRoot().getDefaultScene() ?? d2.getRoot().listScenes()[0]);
const dims = [0, 1, 2].map(k => +(bb.max[k] - bb.min[k]).toFixed(4));
if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 3e-3 || Math.abs(bb.min[2] + bb.max[2]) > 3e-3) throw new Error('not grounded / centred');
const tris = d2.getRoot().listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((u, p) => u + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const mats = d2.getRoot().listMaterials();
const textures = d2.getRoot().listTextures().map(t => ({
  slot: mats.flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]).find(([, x]) => x === t)?.[0] ?? 'unused',
  size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength,
}));
const gpuBytes = textures.reduce((g, t) => g + (t.size ? Math.round(t.size[0] * t.size[1] * 4 * 4 / 3) : 0), 0);
const meshes = d2.getRoot().listMeshes().length, primitives = d2.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);

// ---------- provenance ----------
const credits = {billed: last.billed, reserved: last.reserved, unspentOf100: 100 - last.billed - last.reserved};
const prov = {schema: 'last-line-derivative/1', asset: 'annex-genset-20261031', task: TASK, lane: 'R3 (primary, sole Meshy submitter)',
  status: 'runtime derivative of ONE new industrial generator-set model generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP under the user\'s task-specific "100 credit budget"; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  rebuild: 'node tools/asset-pipeline/props/build-annex-genset.mjs',
  rawStorage: `${TASK_DIR}/meshy/raw/annex-genset-01/attempt-01/{preview,refine}/ (immutable native GLBs + maps, read-only) + ${TASK_DIR}/meshy/LEDGER.jsonl + MANIFEST.json; outside Git`,
  convention: `metres at real size (length ${LENGTH_M} m along X), +Y up, front +Z (the annex machine frame), grounded (min y = 0), centred on x / z; shared path (not mall-*)`,
  modelProof: {requested: asset.request.preview && {ai_model: 'meshy-t2.5', model_type: 'smart-topology', target_polycount: 12000, target_formats: ['glb'], refine: 'enable_pbr true, texture_resolution 2k, ai_model omitted (inherits the preview model: documented)'},
    evidence: ['exact create arguments recorded in the fsynced ledger intent line before each paid call; ack with the returned task id right after',
      `the preview billed ${ledger.find(e => e.event === 'status' && e.kind === 'preview' && e.task_id === refineAck.preview_task_id)?.consumed_credits} credits (the T2 / T2.5 tier; 7.1 / 6 / latest bill 20) and returned ${previewDl ? 'a triangle-only mesh near target_polycount (11,576)' : 'a mesh'}`,
      'the Meshy task GET response does not echo ai_model / model_type, so the request record + billing tier are the model proof']},
  tasks: {preview: refineAck.preview_task_id, refine: acc.task_id},
  source: {file: dl.file, bytes: dl.bytes, sha256: dl.sha256, previewSha256: previewDl?.sha256 ?? null},
  ledger: {attempts: last.attempts, attemptedPOSTs: last.attemptedPOSTs, accepted: last.accepted, credits, stop: stop.reason},
  derivative: {scale: +s.toFixed(5), rawExtent: raw.map(v => +v.toFixed(4)), dims, triangles: tris, meshes, primitives, materials: mats.length, textures, gpuBytesWithMips: gpuBytes, texturePolicy: TEX},
  output: {url: OUT_REL, bytes: glb.length, sha256: sha(glb)}};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }

const reg = `// GENERATED by tools/asset-pipeline/props/build-annex-genset.mjs — do not edit (task ${TASK}, R3).
// The ONE accepted annex generator-set model (Meshy T2.5, provenance ${PROV_REL}): shared runtime file, real size, front +Z.
export const ANNEX_GENSET = {key: 'annex-genset', url: '${OUT_REL}', bytes: ${glb.length}, tris: ${tris}, dims: [${dims.join(', ')}] as const} as const;
`;
console.log(JSON.stringify({out: OUT_REL, bytes: glb.length, tris, dims, textures, gpuMiB: +(gpuBytes / 1048576).toFixed(2), credits}, null, 1));
if (DRY) process.exit(0);

fs.writeFileSync(path.join(PUB, OUT_REL), glb);
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);
fs.writeFileSync(REG, reg);
// CREDITS section
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const credSection = [CREDITS_BEGIN, '## Beyond the Station round 2: the annex generator set', '',
  `Generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's task-specific 100-credit authorization (${last.attempts} attempt, ${credits.billed} credits); runtime derivative built by \`tools/asset-pipeline/props/build-annex-genset.mjs\` (provenance: \`${PROV_REL}\`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters are kept outside Git.`, '',
  `- \`${OUT_REL}\` — industrial diesel generator set (Meshy tasks ${refineAck.preview_task_id} / ${acc.task_id})`, CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`;
fs.writeFileSync(CREDITS, credNext);
// allowlist: only this task's paths (+ CREDITS.md, whose bytes changed)
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([OUT_REL, PROV_REL, 'assets/CREDITS.md']);
const add = [OUT_REL, PROV_REL, 'assets/CREDITS.md'].map(p => { const b = fs.readFileSync(path.join(PUB, p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', OUT_REL, PROV_REL, path.relative(root, REG), 'CREDITS.md', 'public-inputs.json');
