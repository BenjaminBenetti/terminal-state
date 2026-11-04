// Task studio-beta-filter-tension-airtank-20261104-072836-01: the runtime derivative of the Airtank Backpack gear item (items/gear.ts
// `airtank_backpack`) from its Meshy T2.5 image-to-3D original (conditioned on a Codex INITIAL concept image; route Codex -> Meshy).
//
// Reads the immutable raw original + the fsynced job ledger kept OUTSIDE Git in
//   reference/tasks/filter-tension-airtank-20261104-072836/gen/{LEDGER.jsonl, raw/...}
// (verifies the raw file against the ledger's accepted sha256), never modifies it, and writes deterministically:
//   game/public/assets/models/gear-airtank-backpack.glb          (flat: tools/release/package-ci.mjs only allows assets/models/<name>.glb)
//   game/public/assets/derivatives/gear-airtank-backpack.json    (provenance; no URLs / tokens / prompts' private paths)
//   tools/release/public-inputs.json                             (ONLY these two entries are added / updated; others untouched)
//
// Derivative = the office gear convention (build-office-iteration16.mjs): rotate 180 deg about Y (Meshy's native front is +Z; these
// gear derivatives face -Z, gear/models.ts fitDerivative turns them back), uniform scale to the real height H_M, grounded (min y = 0)
// and centred on x/z, baked into the vertices (identity nodes). No geometry simplification (Smart Topology made the target count). The
// model's OWN Meshy PBR maps (base colour, metallic-roughness, normal) are kept and only re-encoded: Lanczos downsize to TEX_PX, JPEG q85.
//
// Usage: node tools/asset-pipeline/props/build-airtank-backpack.mjs
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
const TASK_DIR = 'reference/tasks/filter-tension-airtank-20261104-072836/gen';
const GEN = path.join(root, TASK_DIR);
const LEDGER = path.join(GEN, 'LEDGER.jsonl');
const ID = 'gear-airtank-backpack';
const OUT_REL = `assets/models/${ID}.glb`;
const PROV_REL = `assets/derivatives/${ID}.json`;
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
/** Real height (m): a ~0.6 m steel cylinder + valve / gauge on its frame (tank diameter then ~0.17 m). */
const H_M = 0.72;
const TEX_PX = 1024;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const ledger = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const accept = ledger.find(e => e.event === 'accept' && e.asset === 'airtank-backpack');
if (!accept) throw new Error('no accepted airtank-backpack in the ledger');
const intent = ledger.find(e => e.event === 'intent' && e.asset === 'airtank-backpack' && e.kind === 'image-to-3d');
const status = ledger.find(e => e.event === 'status' && e.task_id === accept.task_id);
const codex = ledger.find(e => e.event === 'result' && e.kind === 'codex-image' && e.files?.some(f => f.sha256 === intent?.request?.inputSha256));
const rawBytes = fs.readFileSync(path.join(GEN, accept.rawGlb));
if (sha(rawBytes) !== accept.rawSha256) throw new Error(`raw sha mismatch: ${accept.rawGlb}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(new Uint8Array(rawBytes));
const r = doc.getRoot();
const tris = d => d.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const rawTris = tris(doc);
const rawTex = r.listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
await doc.transform(flatten());
for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
const scene = r.getDefaultScene() ?? r.listScenes()[0];
const b0 = getBounds(scene);
const ext = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
const s = H_M / ext[1];
const tx = s * (b0.min[0] + b0.max[0]) / 2, ty = -s * b0.min[1], tz = s * (b0.min[2] + b0.max[2]) / 2;
// p' = T + s * rotY(180) * p : (x, y, z) -> (-s x + tx, s y + ty, -s z + tz); column-major
const M = [-s, 0, 0, 0, 0, s, 0, 0, 0, 0, -s, 0, tx, ty, tz, 1];
for (const m of r.listMeshes()) transformMesh(m, M);
r.listMeshes().forEach((m, i) => m.setName(i ? `${ID}-${i}` : ID));
r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${ID}-${i}` : ID));
r.listMaterials().forEach((m, i) => m.setName(i ? `${ID}-${i}` : ID));
await doc.transform(dedup(), prune(), textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [TEX_PX, TEX_PX], quality: 85}));
r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-airtank-backpack.mjs (glTF-Transform)';
const glb = Buffer.from(await io.writeBinary(doc));
const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error('URL/token-like string inside the glTF JSON');
fs.writeFileSync(path.join(root, 'game/public', OUT_REL), glb);

const chk = await io.readBinary(new Uint8Array(glb));
const b1 = getBounds(chk.getRoot().getDefaultScene() ?? chk.getRoot().listScenes()[0]);
const dims = [0, 1, 2].map(k => +(b1.max[k] - b1.min[k]).toFixed(4));
if (Math.abs(b1.min[1]) > 1e-4 || Math.abs(b1.min[0] + b1.max[0]) > 1e-3 * H_M || Math.abs(b1.min[2] + b1.max[2]) > 1e-3 * H_M) throw new Error('not grounded / centred');
const textures = chk.getRoot().listTextures().map(t => {
  const slot = chk.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
  return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
});

const prov = {
  schema: 'terminal-state-derivative-v1',
  id: ID,
  item: 'airtank_backpack (items/gear.ts)',
  task: 'studio-beta-filter-tension-airtank-20261104-072836-01',
  approval: 'task-specific user generation approval (sha256 a8f41d80c3fb865aad4ff5bb3fddbbe831ae9b6275a0027927382a56f467a81b): one Airtank Backpack model, 50 Meshy credits total',
  route: 'Codex native image_gen INITIAL concept / conditioning image (straight-on front elevation) -> Meshy T2.5 image-to-3D (smart-topology, 2K PBR texture); the Meshy model keeps its own PBR maps (re-encoded only)',
  conditioningImage: codex ? {sha256: intent.request.inputSha256, bytes: codex.files[0].bytes, generator: 'Codex CLI 0.163.0 built-in image_gen (model id not reported)', file: `${TASK_DIR}/${codex.files[0].raw} (raw original, outside Git)`} : null,
  meshy: {
    tool: 'mcp__meshy__meshy_image_to_3d (@meshy-ai/meshy-mcp-server 0.6.6)',
    request: (({file_path: _f, inputSha256: _s, ...rest}) => rest)(intent.request),
    task: accept.task_id, status: status?.status ?? null, consumedCredits: status?.consumed_credits ?? null,
    evidence: 'the exact create arguments are in the fsynced ledger intent line before the POST; the 15-credit charge is the T2 / T2.5 single-image textured price (meshy-6 / 7.1 / latest bill 30); the GET response does not echo ai_model',
  },
  source: {file: `${TASK_DIR}/${accept.rawGlb} (raw original, outside Git)`, sha256: accept.rawSha256, bytes: rawBytes.length, triangles: rawTris, extent: ext.map(v => +v.toFixed(4)), textures: rawTex},
  output: {file: `game/public/${OUT_REL}`, url: OUT_REL, sha256: sha(glb), bytes: glb.length, triangles: tris(chk), dims},
  heightM: H_M, scale: +s.toFixed(6),
  transform: 'rotateY(180deg) * uniform scale to the real height, then grounded (min y = 0) and centred on x/z; baked into vertices',
  convention: 'metres at real size, +Y up, front -Z (the tank side; gear/models.ts turns gear derivatives to +Z), grounded, centred',
  textures,
  licence: 'generated for this project under the existing provider accounts; no blanket licence or commercial clearance implied (assets/CREDITS.md)',
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
if (/https?:|Signature|X-Amz|Key-Pair|token=/i.test(provBuf.toString())) throw new Error('URL/token-like string in public provenance');
fs.writeFileSync(path.join(root, 'game/public', PROV_REL), provBuf);

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([[OUT_REL, glb], [PROV_REL, provBuf]]);
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`${ID}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(2)} MB (${tris(chk)} tris), dims ${dims.join(' x ')} m, scale ${s.toFixed(4)}`);
console.log(textures.map(t => `${t.slot} ${t.size?.join('x')} ${t.mime} ${t.bytes} B`).join('\n'));
