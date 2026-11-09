// Task studio-bunker-level-20261109-072224-01 (lane LEVEL): the runtime derivatives of THE BUNKER's own Meshy T2.5 flavour models,
// cooked the way the Reactor kits are (tools/asset-pipeline/props/build-reactor-x-kit.mjs).
//
// Reads (never modifies) the task records kept OUTSIDE Git in reference/tasks/bunker-level-20261109-072224/:
//   meshy/MANIFEST.json            the approved select-flavour budget, every paid item (task id, request args, Codex input sha256, the
//                                  master's sha256 / bytes, credits)
//   meshy/LEDGER.jsonl             intent / posted / succeeded / balance lines (each carries the approval sha)
//   meshy/raw/<asset>/<attempt>/   immutable native GLB + native_textures + SHA256.txt (the private masters)
//   codex/<asset>.png              the Codex initial reference image (sha256 recorded in the manifest)
// and writes deterministically:
//   game/public/assets/models/bunker-<id>.glb                   Bunker-only (assets/levelAssets.ts LEVEL_ONLY_RULES 'bunker-')
//   game/public/assets/derivatives/bunker-kit-20261109.json     provenance (no URLs / tokens)
//   game/src/assets/bunkerKit.generated.ts                      {key, url, bytes, tris, dims} per model (bundle literals)
//   tools/release/public-inputs.json                            ONLY this script's paths added / updated (+ CREDITS.md)
//   game/public/assets/CREDITS.md                               the marked bunker-kit section
//
// Derivatives: Meshy's native frame kept (front +Z as generated), UNIFORM scale so the reference axis matches the nominal real size
// (KIT below), grounded (min y = 0), centred on x / z, baked into the vertices; no geometry simplification (Smart Topology made it at
// target). The native 2K PBR maps are KEPT channel for channel (Meshy outputs keep their maps: no reprojection / retexture), only
// re-encoded / downsized to JPEG.
//
//   node tools/asset-pipeline/props/build-bunker-kit.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-bunker-level-20261109-072224-01';
const TASK_DIR = 'reference/tasks/bunker-level-20261109-072224';
/** The private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder (a lane's worktree sits inside the studio checkout). */
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const MESHY = path.join(REF_ROOT, TASK_DIR, 'meshy');
const PUB = path.join(root, 'game/public');
const PROV_REL = 'assets/derivatives/bunker-kit-20261109.json';
const REG = path.join(root, 'game/src/assets/bunkerKit.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN bunker-kit-20261109 (build-bunker-kit.mjs) -->';
const CREDITS_END = '<!-- END bunker-kit-20261109 -->';
const DRY = process.argv.includes('--dry-run');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The kit: manifest asset id, runtime key, the reference axis (0 x / 1 y / 2 z) and its nominal real size (m), texture policy
 * (base / metallicRoughness / normal px), what it is. Real-world scale (root CLAUDE.md rule 5), checked beside a runtime zombie
 * (tools/asset-pipeline/props/scale-check.mjs; the render in the task folder).
 */
const KIT = [
  {id: 'mainframe-tape-cabinet', key: 'mainframe', axis: 1, size: 1.9, tex: [1024, 256, 512],
    what: 'bunker: retro reel-to-reel mainframe tape cabinet (sealed computer equipment; its louvred doors are service panels)'},
];

// ---------- records ----------
const manifest = JSON.parse(fs.readFileSync(path.join(MESHY, 'MANIFEST.json'), 'utf8'));
const ledger = fs.readFileSync(path.join(MESHY, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (ledger.some(e => e.approvalSha256 && e.approvalSha256 !== manifest.approvalSha256)) throw new Error('ledger line with another approval sha');
const act = manifest.actual;
if (act.billed + act.reserved > manifest.authority.credits || act.attempts > manifest.authority.maxGenerationAttempts || act.paidPOSTs > manifest.authority.maxPaidPOSTs) throw new Error(`budget outside the authority: ${JSON.stringify(act)}`);

const out = [];
for (const k of KIT) {
  const item = manifest.items.find(x => x.asset === k.id);
  if (!item) throw new Error(`${k.id}: no manifest item`);
  const ok = ledger.find(e => e.event === 'succeeded' && e.taskId === item.taskId);
  if (!ok) throw new Error(`${k.id}: no succeeded ledger line for ${item.taskId}`);
  const bytes = fs.readFileSync(path.join(MESHY, item.master.glb));
  if (sha(bytes) !== item.master.sha256 || bytes.length !== item.master.bytes) throw new Error(`${k.id}: master sha / size mismatch`);
  const sums = fs.readFileSync(path.join(path.dirname(path.join(MESHY, item.master.glb)), 'SHA256.txt'), 'utf8');
  if (!sums.includes(`${item.master.sha256}  native.glb`)) throw new Error(`${k.id}: SHA256.txt does not list the master`);
  const codex = fs.readFileSync(path.join(REF_ROOT, TASK_DIR, item.input));
  if (sha(codex) !== item.inputSha256) throw new Error(`${k.id}: Codex input sha mismatch`);

  const doc = await io.readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const raw = [0, 1, 2].map(i => b0.max[i] - b0.min[i]);
  const s = k.size / (k.axis < 0 ? Math.max(...raw) : raw[k.axis]);
  for (const m of r.listMeshes()) transformMesh(m, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const b1 = getBounds(scene);
  for (const m of r.listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1]);
  const name = `bunker-${k.id}`;
  r.listMeshes().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  r.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${name}-${i}` : name));
  r.listMaterials().forEach((m, i) => m.setName(i ? `${name}-${i}` : name));
  const [tb, tmr, tn] = k.tex;
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tb, tb], quality: 86, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tmr, tmr], quality: 86, slots: /^metallicRoughness/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [tn, tn], quality: 90, slots: /^normal/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-bunker-kit.mjs (glTF-Transform)';
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
  out.push({key: k.key, id: k.id, url: `assets/models/${name}.glb`, bytes: glb.length, tris, dims, what: k.what, scale: +s.toFixed(5), rawExtent: raw.map(v => +v.toFixed(4)), textures,
    task: item.taskId, credits: item.consumedCredits, request: {tool: item.tool, ...item.args}, codexInput: {file: item.input, sha256: item.inputSha256},
    source: {file: item.master.glb, sha256: item.master.sha256, bytes: item.master.bytes}, sha256: sha(glb), glb});
}

console.log(JSON.stringify({models: out.map(k => ({id: k.id, bytes: k.bytes, tris: k.tris, dims: k.dims, scale: k.scale, textures: k.textures})), budget: act}, null, 1));
if (DRY) process.exit(0);

const written = [];
for (const k of out) { fs.writeFileSync(path.join(PUB, k.url), k.glb); written.push(k.url); }
const prov = {schema: 'last-line-derivative/1', asset: 'bunker-kit-20261109', task: TASK, lane: 'LEVEL (cook); the primary generated the model under the Bunker\'s approved select-flavour budget',
  status: 'runtime derivatives of NEW Bunker flavour models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP from Codex initial reference images; provider terms apply; unapproved prototype, no licence or commercial clearance implied',
  authority: {approvalSha256: manifest.approvalSha256, caps: manifest.authority},
  rebuild: 'node tools/asset-pipeline/props/build-bunker-kit.mjs',
  rawStorage: `${TASK_DIR}/meshy/raw/<asset>/<attempt>/ (immutable native GLB + native_textures + SHA256.txt) + meshy/MANIFEST.json + LEDGER.jsonl; the Codex original ${TASK_DIR}/codex/; outside Git`,
  texturePolicy: 'Meshy maps kept channel for channel (re-encoded JPEG: base / metallicRoughness / normal per KIT.tex); no reprojection / retexture',
  budget: {attempts: act.attempts, paidPOSTs: act.paidPOSTs, billed: act.billed, reserved: act.reserved},
  models: out.map(({glb, ...k}) => k)};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces\/).{0,20}/i); if (hit) throw new Error(`URL / token / local path in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf); written.push(PROV_REL);
const reg = `// GENERATED by tools/asset-pipeline/props/build-bunker-kit.mjs — do not edit (task ${TASK}).
// THE BUNKER's own Meshy T2.5 flavour models (from Codex initial reference images); provenance ${PROV_REL}.
// Models: real size (metres), +Y up, Meshy's native front +Z, grounded (min y 0), centred on x / z; maps kept from Meshy.
export interface BunkerKitModel { key: string; url: string; bytes: number; tris: number; dims: readonly [number, number, number] }
export const BUNKER_KIT = {
${out.map(k => `  ${k.key}: {key: 'bunker-${k.key}', url: '${k.url}', bytes: ${k.bytes}, tris: ${k.tris}, dims: [${k.dims.join(', ')}]},`).join('\n')}
} as const satisfies Readonly<Record<string, BunkerKitModel>>;
`;
fs.writeFileSync(REG, reg);
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const credSection = [CREDITS_BEGIN, '## The Bunker: flavour models', '',
  `Generated for this project with Meshy T2.5 (smart topology; image-to-3D from a Codex initial reference image, 2K PBR) through the Meshy MCP under the Bunker's approved select-flavour budget (${act.attempts} generation attempt, ${act.billed} credits billed). Runtime derivatives built by \`tools/asset-pipeline/props/build-bunker-kit.mjs\` (provenance: \`${PROV_REL}\`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the reference image are kept outside Git.`, '',
  ...out.map(k => `- \`${k.url}\` — ${k.what} (Meshy task ${k.task})`), CREDITS_END].join('\n');
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
fs.writeFileSync(CREDITS, credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`);
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([...written, 'assets/CREDITS.md']);
const add = [...mine].map(p => { const b = fs.readFileSync(path.join(PUB, p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
const ownModel = new Set(KIT.map(k => `assets/models/bunker-${k.id}.glb`));
allow.files = [...allow.files.filter(f => !mine.has(f.path) && !ownModel.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', written.length, 'public files +', path.relative(root, REG), 'CREDITS.md public-inputs.json');
