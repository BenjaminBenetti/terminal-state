// Task studio-beta-track3-eaton-centre-20261031-01 (Studio Beta, lane ASSETS): runtime derivatives of the NEW mall-art models of
// The Eaton's Center (LevelId `mall`), generated with Meshy T2.5 (smart-topology text-to-3D preview + 2K PBR refine) under the task's
// finite authorization (<= 100 attempts incl. replacements, <= 1500 credits, <= 200 generation POSTs; staged batches frozen by the
// primary). Modelled on build-office-overhaul.mjs.
//
// Reads (never modifies) the task's records kept OUTSIDE Git in reference/tasks/track3-eaton-centre-20261031/assets/:
//   batch-<n>.frozen.json  the primary-frozen batch specs — each verified against the sha256 of its ledger `freeze` line (immutable);
//                          they are the ONLY spec source for a delivered asset (size, axis, tris, prompts)
//   ledger.jsonl           fsynced intent / ack / status / download / inspect records (only ACCEPTED refines are built: an `inspect`
//                          line {kind: 'refine', verdict: 'accepted', front} written after the CPU ortho review)
//   raw/<id>/<attempt>/{preview,refine}/  immutable native GLBs (sha256-verified against the ledger download line)
// and writes deterministically:
//   game/public/assets/models/mall-<id>.glb                 flat path (tools/release/package-ci.mjs publicPath); level-only by path
//                                                           (game/src/assets/levelAssets.ts mall rule)
//   game/public/assets/derivatives/mall-track3-20261031.json provenance (no URLs / tokens)
//   tools/release/public-inputs.json                         ONLY this task's paths added / updated / dropped (or --allowlist-out)
//   game/src/assets/mallAssets.ts                            GENERATED block (urls / bytes / tris: the bundle literals package-ci needs)
//   game/src/assets/mallDims.generated.ts                    GENERATED block (three-free dims + nominal specs for gen/ code)
//   game/public/assets/CREDITS.md                            the marked mall section (only when something is delivered)
//   reference/.../assets/DELIVERED.json                      delivery note for SHOPS / PACKAGE (atomic)
//
// Derivative = rotate about Y so the reviewed native front faces -Z, UNIFORM scale to the frozen real size (sizeM along sizeAxis:
// h = height y, w = width x after rotation, longest), grounded (min y = 0), centred on x/z, baked into the vertices (identity
// nodes). No geometry simplification (Smart Topology made the target triangle count). The native 2K PBR material is kept channel for
// channel (base colour, metallic-roughness, normal), downsized with sharp Lanczos to JPEG by tier:
//   --policy lean (DEFAULT): L (nominal max extent >= 2.0 m) base 1024 / other maps 256, M (>= 0.8 m) 512 / 256, S 512 / 256;
//                            budgets 420 / 260 / 180 kB
//   --policy balanced:       L (>= 1.8 m) 1024 / 512, M 512 / 512, S 512 / 256; budgets 480 / 320 / 200 kB (the office policy)
// with a deterministic step-down ladder per tier. EDITS[id] (after review) ports the office lane-FURN local operations: a painted /
// opaque glass region split into a real transparent 'glass' node, baked loose clutter separated into its own models (rule 4; no
// regeneration), a furniture-only resize.
//
// Usage:
//   node tools/asset-pipeline/props/build-mall-track3.mjs [--policy lean|balanced] [--only M01,M05] [--allowlist-out <file>]
//   node tools/asset-pipeline/props/build-mall-track3.mjs --dry-run      plan only: verify freezes / ledger / raws, write NOTHING
//   node tools/asset-pipeline/props/build-mall-track3.mjs --dry-run --fixture <any.glb> --fixture-code M05 [--fixture-front +Z]
//        exercise the derive path on a local GLB under a manifest spec -> /tmp/track3-fixture/mall-<id>.glb + report (never public)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup} from '@gltf-transform/functions';
import {GLASS_MATERIAL, cleanSupportTexture, cropPartTextures, extentOf, scaleGroundCentre, splitClutter, splitGlass} from './lib/clutter-split.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-beta-track3-eaton-centre-20261031-01';
const TASK_DIR = 'reference/tasks/track3-eaton-centre-20261031';
const ASSETS_DIR = path.join(root, TASK_DIR, 'assets');
const LEDGER = path.join(ASSETS_DIR, 'ledger.jsonl');
const MANIFEST = path.join(ASSETS_DIR, 'manifest.track3.json');
const PUB = path.join(root, 'game/public');
const PROV_REL = 'assets/derivatives/mall-track3-20261031.json';
const PROV = path.join(PUB, PROV_REL);
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const REGISTRY = path.join(root, 'game/src/assets/mallAssets.ts');
const DIMS_TS = path.join(root, 'game/src/assets/mallDims.generated.ts');
const CREDITS_REL = 'assets/CREDITS.md';
const CREDITS = path.join(PUB, CREDITS_REL);
const CREDITS_BEGIN = '<!-- BEGIN mall-track3-20261031 (build-mall-track3.mjs) -->';
const CREDITS_END = '<!-- END mall-track3-20261031 -->';
const DELIVERED = path.join(ASSETS_DIR, 'DELIVERED.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const outRelOf = id => `assets/models/mall-${id}.glb`;
const partRelOf = id => `assets/models/mall-${id}.glb`;
const libraryKey = id => `office-${id}`; // SHOPS: mall kinds render through the office prop path (gen/office/kinds.ts officeModelKey)

const argOf = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry-run');
const POLICY = argOf('--policy') ?? 'lean';
if (!['lean', 'balanced'].includes(POLICY)) throw new Error('--policy lean|balanced');
const ONLY = argOf('--only') ? new Set(argOf('--only').split(',')) : null;
const ALLOW_OUT = argOf('--allowlist-out');
const FIXTURE = argOf('--fixture'), FIXTURE_CODE = argOf('--fixture-code'), FIXTURE_FRONT = argOf('--fixture-front') ?? '+Z';
if (FIXTURE && !DRY) throw new Error('--fixture is a dry-run tool (never writes public files): add --dry-run');

// ---------- texture policy (tiers by the nominal max extent of the frozen target size) ----------
const POLICIES = {
  lean: {L: 2.0, tiers: {
    L: {budget: 420_000, ladder: [[1024, 256, 85], [1024, 256, 78], [768, 256, 78], [768, 256, 72], [512, 256, 78], [512, 256, 70]]},
    M: {budget: 260_000, ladder: [[512, 256, 85], [512, 256, 78], [512, 256, 72], [384, 256, 72]]},
    S: {budget: 180_000, ladder: [[512, 256, 85], [512, 256, 78], [384, 256, 74], [256, 256, 72]]}}},
  balanced: {L: 1.8, tiers: {
    L: {budget: 480_000, ladder: [[1024, 512, 85], [1024, 512, 80], [1024, 512, 72], [768, 512, 80], [512, 512, 80], [512, 512, 72]]},
    M: {budget: 320_000, ladder: [[512, 512, 85], [512, 512, 80], [512, 512, 72], [512, 256, 72]]},
    S: {budget: 200_000, ladder: [[512, 256, 85], [512, 256, 80], [512, 256, 72], [384, 256, 72]]}}},
};
const tierOf = spec => { const m = Math.max(spec.targetSize.w, spec.targetSize.h, spec.targetSize.d); return m >= POLICIES[POLICY].L ? 'L' : m >= 0.8 ? 'M' : 'S'; };
const PART_TEX_PX = 256, PART_TEX_Q = 85;

// Per-asset observations from the CPU ortho / scale-check reviews, for integrators (filled after inspection; mirrored in DELIVERED.json).
const NOTES = {};
// Local edits after review (office lane-FURN mechanism, no regeneration): {glass: {minY, maxX}} -> transparent 'glass' node;
// {clutter: c => bool, supports: [{y, tol}], parts: {<partId>: {box, sizeM, sizeAxis, label}}} -> baked loose items separated into
// mall-<partId>.glb at their own real size (rule 4); {sizeM, sizeAxis, basis} -> furniture-only resize. Filled per accepted asset.
const EDITS = {};

// ---------- records ----------
const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const freezes = ledger.filter(e => e.event === 'freeze');
const SPECS = new Map(); // code -> {spec (frozen attempt entry), batch, freezeSha}
for (const f of freezes) {
  const p = path.join(ASSETS_DIR, f.file);
  const buf = fs.readFileSync(p);
  if (sha(buf) !== f.sha256) throw new Error(`${f.file} changed after its freeze (${sha(buf)} != ${f.sha256}); refusing to build`);
  const b = JSON.parse(buf.toString());
  for (const a of b.attempts) {
    const prev = SPECS.get(a.code);
    if (prev && JSON.stringify(prev.spec.targetSize) !== JSON.stringify(a.targetSize)) throw new Error(`${a.code}: frozen size differs between batches`);
    if (!prev || !a.replacesAttempt) SPECS.set(a.code, {spec: a, batch: b.batch, freezeSha: f.sha256, frozenBy: b.frozenBy, frozenAt: b.frozenAt});
  }
}
// id collisions with the office / company library keys (the mall renders through `office-<id>` keys) or foreign public files
const companyIds = new Set([...fs.readFileSync(path.join(root, 'game/src/assets/companyDims.generated.ts'), 'utf8').matchAll(/^ {2}'([a-z0-9-]+)': /gm)].map(m => m[1]));
for (const [code, {spec}] of SPECS) {
  if (companyIds.has(spec.assetId)) throw new Error(`${code} ${spec.assetId}: id collides with a company asset (library key ${libraryKey(spec.assetId)})`);
  if (fs.existsSync(path.join(PUB, `assets/models/office-${spec.assetId}.glb`))) throw new Error(`${code} ${spec.assetId}: office-${spec.assetId}.glb exists (library key collision)`);
}

function jobsFor(code) {
  const ev = ledger.filter(e => e.code === code);
  const accepted = [...ev].reverse().find(e => e.event === 'inspect' && e.kind === 'refine' && e.verdict === 'accepted');
  const dl = accepted ? ev.find(e => e.event === 'download' && e.kind === 'refine' && e.task_id === accepted.task_id) : null;
  const refineAck = dl ? ev.find(e => e.event === 'ack' && e.kind === 'refine' && e.task_id === dl.task_id) : null;
  const previewId = refineAck?.preview_task_id ?? null;
  const previewDl = previewId ? ev.find(e => e.event === 'download' && e.kind === 'preview' && e.task_id === previewId) : null;
  const intentOf = ack => (ack ? ev.find(e => e.event === 'intent' && e.t === ack.intentT) : null);
  const previewAck = previewId ? ev.find(e => e.event === 'ack' && e.kind === 'preview' && e.task_id === previewId) : null;
  const scale = accepted ? [...ev].reverse().find(e => e.event === 'scale-review' && e.task_id === accepted.task_id) : null;
  const acks = ev.filter(e => e.event === 'ack');
  const rejects = ev.filter(e => e.event === 'reject');
  const failed = ev.filter(e => e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''));
  const seen = new Set(); let credits = 0;
  for (const e of ev) if ((e.event === 'download' || (e.event === 'status' && /FAIL|CANCEL|EXPIRE/i.test(e.status ?? ''))) && !seen.has(e.task_id)) { seen.add(e.task_id); credits += e.consumed_credits ?? 0; }
  return {ev, accepted, dl, refineAck, previewDl, previewIntent: intentOf(previewAck), refineIntent: intentOf(refineAck), scale, acks, rejects, failed, credits};
}

// ---------- derive ----------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ROT = {'+Z': Math.PI, '-Z': 0, '+X': Math.PI / 2, '-X': -Math.PI / 2};
const sizeMOf = s => s.targetSize.sizeM, sizeAxisOf = s => s.targetSize.sizeAxis;

async function derive(spec, rawBytes, front, [basePx, otherPx, quality]) {
  const id = spec.assetId;
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const r = doc.getRoot();
  await doc.transform(flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  const th = ROT[front];
  const c = Math.round(Math.cos(th)), sn = Math.round(Math.sin(th));
  const e0 = [0, 1, 2].map(k => b0.max[k] - b0.min[k]);
  const ext = [Math.abs(c) * e0[0] + Math.abs(sn) * e0[2], e0[1], Math.abs(sn) * e0[0] + Math.abs(c) * e0[2]];
  const axis = sizeAxisOf(spec);
  const ref = axis === 'h' ? ext[1] : axis === 'w' ? ext[0] : Math.max(...ext);
  const s = sizeMOf(spec) / ref;
  const R = [s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, 0, 0, 0, 1]; // column-major p' = s * rotY(th) * p
  for (const m of r.listMeshes()) transformMesh(m, R);
  const b1 = getBounds(scene);
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b1.min[0] + b1.max[0]) / 2, -b1.min[1], -(b1.min[2] + b1.max[2]) / 2, 1];
  for (const m of r.listMeshes()) transformMesh(m, T);
  const E = EDITS[id];
  let k = 1, split = null, glass = null, ghosts = null;
  const parts = [];
  if (E) {
    if (E.parts) split = await splitClutter(doc, E);
    if (E.glass) glass = await splitGlass(doc, sharp, E.glass);
    if (E.supports) ghosts = await cleanSupportTexture(doc, sharp, E.supports, E.ghostThresh ?? 34, null);
    if (E.sizeM) {
      const bb = getBounds(scene);
      k = E.sizeM / extentOf(bb, E.sizeAxis);
      scaleGroundCentre(doc, k);
    }
    for (const p of split?.parts ?? []) {
      const pr = p.doc.getRoot();
      pr.listMeshes().forEach((m, i) => m.setName(i ? `${p.id}-${i}` : p.id));
      pr.listNodes().filter(n => n.getMesh()).forEach((n, i) => n.setName(i ? `${p.id}-${i}` : p.id));
      pr.listMaterials().forEach((m, i) => m.setName(i ? `mall-${p.id}-${i}` : `mall-${p.id}`));
      const crop = await cropPartTextures(p.doc, sharp, PART_TEX_PX, PART_TEX_Q);
      pr.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-mall-track3.mjs + lib/clutter-split.mjs (glTF-Transform)';
      parts.push({id: p.id, glb: Buffer.from(await io.writeBinary(p.doc)), tris: p.tris, scale: s * p.scale, crop});
    }
  }
  // names: '<id>' meshes / nodes, 'mall-<id>' materials; a separated transparent 'glass' node keeps /glass/ (damage/materials.ts partKeyClass)
  r.listMeshes().filter(m => !/glass/.test(m.getName())).forEach((m, i) => m.setName(i ? `${id}-${i}` : id));
  r.listNodes().filter(n => n.getMesh() && n.getName() !== 'glass').forEach((n, i) => n.setName(i ? `${id}-${i}` : id));
  r.listMaterials().filter(m => !/-glass$/.test(m.getName())).forEach((m, i) => m.setName(i ? `mall-${id}-${i}` : `mall-${id}`));
  for (const m of r.listMaterials().filter(q => /-glass$/.test(q.getName()))) m.setName(`mall-${id}-glass`);
  for (const m of r.listMeshes().filter(q => /glass/.test(q.getName()))) m.setName(`${id}-glass`);
  await doc.transform(dedup(), prune(),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [basePx, basePx], quality, slots: /^baseColor/}),
    textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [otherPx, otherPx], quality, slots: /^(?!baseColor)/}));
  r.getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-mall-track3.mjs (glTF-Transform)';
  return {glb: Buffer.from(await io.writeBinary(doc)), scale: s * k, rawExtent: e0, parts, edits: E ? {k, removed: split?.removed ?? null, glass, ghosts} : null};
}

async function measure(glb) {
  const d = await io.readBinary(new Uint8Array(glb));
  const b = getBounds(d.getRoot().getDefaultScene() ?? d.getRoot().listScenes()[0]);
  const dims = [0, 1, 2].map(k => +(b.max[k] - b.min[k]).toFixed(4));
  const tris = d.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const textures = d.getRoot().listTextures().map(t => {
    const slot = d.getRoot().listMaterials().flatMap(m => [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()], ['occlusion', m.getOcclusionTexture()], ['emissive', m.getEmissiveTexture()]]).find(([, tt]) => tt === t)?.[0] ?? 'unused';
    return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())};
  });
  const gpuBytes = textures.reduce((s2, t) => s2 + (t.size ? Math.round(t.size[0] * t.size[1] * 4 * 4 / 3) : 0), 0);
  return {b, dims, tris, textures, gpuBytes};
}
function checkGrounded(id, b, sizeM) {
  if (Math.abs(b.min[1]) > 1e-4 || Math.abs(b.min[0] + b.max[0]) > 1e-3 * sizeM || Math.abs(b.min[2] + b.max[2]) > 1e-3 * sizeM) throw new Error(`${id} not grounded/centred`);
}
const tokenCheck = (id, buf) => {
  const json = buf.subarray(20, 20 + buf.readUInt32LE(12)).toString();
  if (/https?:|Signature=|X-Amz|Key-Pair-Id|token=/i.test(json)) throw new Error(`URL/token-like string inside ${id} glTF JSON`);
};

// ---------- fixture (dry-run pipeline exercise; writes only to /tmp) ----------
if (FIXTURE) {
  const spec = manifest.slots.find(s => s.code === FIXTURE_CODE);
  if (!spec) throw new Error(`--fixture-code ${FIXTURE_CODE} not in the manifest`);
  const rawBytes = fs.readFileSync(FIXTURE);
  const tier = tierOf(spec), T = POLICIES[POLICY].tiers[tier];
  let out, step;
  for (step = 0; step < T.ladder.length; step++) { out = await derive(spec, rawBytes, FIXTURE_FRONT, T.ladder[step]); if (out.glb.length <= T.budget) break; }
  step = Math.min(step, T.ladder.length - 1);
  tokenCheck(spec.assetId, out.glb);
  const m = await measure(out.glb);
  checkGrounded(spec.assetId, m.b, sizeMOf(spec));
  const got = sizeAxisOf(spec) === 'h' ? m.dims[1] : sizeAxisOf(spec) === 'w' ? m.dims[0] : Math.max(...m.dims);
  if (Math.abs(got - sizeMOf(spec)) > 2e-3) throw new Error(`fixture not at its real size (${got} != ${sizeMOf(spec)})`);
  const dir = '/tmp/track3-fixture';
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `mall-${spec.assetId}.glb`);
  fs.writeFileSync(file, out.glb);
  const rep = {fixture: true, NOT_A_DELIVERY: 'pipeline exercise on a local stand-in GLB; never copied to game/public', input: path.relative(root, path.resolve(FIXTURE)), inputSha256: sha(rawBytes),
    code: spec.code, id: spec.assetId, policy: POLICY, tier, textureStep: step, ladder: T.ladder[step], budget: T.budget, bytes: out.glb.length, overBudget: out.glb.length > T.budget,
    dims: m.dims, sizeM: sizeMOf(spec), sizeAxis: sizeAxisOf(spec), tris: m.tris, trisAcceptMax: spec.tris.acceptMax, gpuBytes: m.gpuBytes, textures: m.textures.map(t => ({slot: t.slot, size: t.size, bytes: t.bytes})),
    scale: +out.scale.toFixed(6), rawExtent: out.rawExtent.map(v => +v.toFixed(4)), out: file};
  fs.writeFileSync(path.join(dir, `mall-${spec.assetId}.report.json`), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

// ---------- build every accepted asset of the frozen batches ----------
const prevProv = fs.existsSync(PROV) ? JSON.parse(fs.readFileSync(PROV, 'utf8')) : null;
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const outputs = [], missing = [];
for (const [code, {spec, batch, freezeSha, frozenBy, frozenAt}] of [...SPECS].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const id = spec.assetId;
  const j = jobsFor(code);
  if (!j.dl) {
    missing.push({code, id, batch, reason: j.failed.length && !j.acks.some(x => x.kind === 'refine') ? `generation failed (${j.failed.map(f => f.status).join(', ')})`
      : j.acks.some(x => x.kind === 'refine') ? 'refine submitted, not accepted / delivered yet' : j.acks.some(x => x.kind === 'preview') ? 'preview only' : 'not generated yet'});
    continue;
  }
  const rawPath = path.join(ASSETS_DIR, j.dl.file);
  const rawBytes = fs.readFileSync(rawPath);
  if (sha(rawBytes) !== j.dl.sha256) throw new Error(`raw sha mismatch for ${id}: ${j.dl.file}`);
  const front = j.accepted.front;
  if (!(front in ROT)) throw new Error(`${id}: bad front ${front}`);
  const outRel = outRelOf(id), outAbs = path.join(PUB, outRel);
  const prevMine = prevProv?.outputs?.some(o => o.output.url === outRel);
  if (fs.existsSync(outAbs) && allow.files.some(f => f.path === outRel) && !prevMine) throw new Error(`${outRel} exists and is not this task's file`);
  const tier = tierOf(spec), T = POLICIES[POLICY].tiers[tier];
  const reuse = ONLY && !ONLY.has(code) && fs.existsSync(outAbs) && prevProv?.outputs?.find(o => o.id === id && o.source.sha256 === j.dl.sha256 && o.policy === POLICY && o.output.sha256 === sha(fs.readFileSync(outAbs)));
  let glb, scale, rawExtent, step, parts = [], edits = null;
  if (reuse) {
    glb = fs.readFileSync(outAbs); scale = reuse.scale; rawExtent = reuse.source.extent; step = reuse.textureStep;
    parts = (reuse.parts ?? []).map(q => ({id: q.id, glb: fs.readFileSync(path.join(PUB, q.output.url)), tris: q.output.triangles, scale: q.scale, crop: q.textureCrop}));
    edits = reuse.edits ?? null;
  } else {
    for (step = 0; step < T.ladder.length; step++) { ({glb, scale, rawExtent, parts, edits} = await derive(spec, rawBytes, front, T.ladder[step])); if (glb.length <= T.budget) break; }
    step = Math.min(step, T.ladder.length - 1);
    for (const q of [glb, ...parts.map(p => p.glb)]) tokenCheck(id, q);
    if (!DRY) {
      fs.writeFileSync(outAbs, glb);
      for (const q of parts) {
        const rel = partRelOf(q.id), abs = path.join(PUB, rel);
        const mine = prevProv?.outputs?.some(o => (o.parts ?? []).some(x => x.output.url === rel));
        if (fs.existsSync(abs) && allow.files.some(f => f.path === rel) && !mine) throw new Error(`${rel} exists and is not this pipeline's file`);
        fs.writeFileSync(abs, q.glb);
      }
    }
  }
  const m = await measure(glb);
  const E = EDITS[id];
  const sizeM = E?.sizeM ?? sizeMOf(spec), sizeAxis = E?.sizeAxis ?? sizeAxisOf(spec);
  checkGrounded(id, m.b, sizeM);
  const partOut = [];
  for (const q of parts) {
    const P = E.parts[q.id], pm = await measure(q.glb);
    checkGrounded(q.id, pm.b, P.sizeM);
    partOut.push({id: q.id, label: P.label, sizeM: P.sizeM, sizeAxis: P.sizeAxis, scale: +q.scale.toFixed(6), selection: P.box, textureCrop: q.crop,
      output: {file: `game/public/${partRelOf(q.id)}`, url: partRelOf(q.id), sha256: sha(q.glb), bytes: q.glb.length, triangles: pm.tris, dims: pm.dims}});
  }
  const rawDoc = await io.readBinary(new Uint8Array(rawBytes));
  const rawTris = rawDoc.getRoot().listMeshes().reduce((s2, mm) => s2 + mm.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const rawTex = rawDoc.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
  const attempts = j.acks.map(x => ({kind: x.kind, task: x.task_id, slot: x.slot, attemptId: x.attemptId,
    ...(j.rejects.find(r => r.task_id === x.task_id) ? {rejected: j.rejects.find(r => r.task_id === x.task_id).reason} : {}),
    ...(j.failed.find(f => f.task_id === x.task_id) ? {status: j.failed.find(f => f.task_id === x.task_id).status} : {})}));
  outputs.push({code, id, key: libraryKey(id), batch, freezeSha256: freezeSha, frozenBy, frozenAt, category: spec.category, priority: spec.priority, role: spec.role, programs: spec.programs,
    shopsKind: spec.shopsKind?.kind ?? null, interaction: spec.interaction, placement: spec.placement,
    model: 'meshy-t2.5', modelType: 'smart-topology', topology: 'triangle', route: 'text-to-3d preview (geometry, 5 credits) + refine (2K PBR texture, 10 credits, inherits the T2.5 preview model)',
    previewPrompt: j.previewIntent?.args.prompt ?? spec.preview.args.prompt, texturePrompt: j.refineIntent?.args.texture_prompt ?? spec.refine.args.texture_prompt,
    previewArgs: j.previewIntent ? (({prompt: _p, response_format: _r, ...rest}) => rest)(j.previewIntent.args) : null,
    refineArgs: j.refineIntent ? (({texture_prompt: _t, preview_task_id: _i, response_format: _r, ...rest}) => ({...rest, ai_model: 'omitted (inherits the T2.5 preview)'}))(j.refineIntent.args) : null,
    tasks: {preview: j.refineAck.preview_task_id, refine: j.dl.task_id}, credits: {preview: j.previewDl?.consumed_credits ?? null, refine: j.dl.consumed_credits ?? null},
    creditsAllAttempts: j.credits, attempts,
    source: {file: `${TASK_DIR}/assets/${j.dl.file} (raw original, outside Git)`, sha256: j.dl.sha256, bytes: j.dl.bytes, triangles: rawTris, extent: rawExtent.map(v => +v.toFixed(4)), textures: rawTex,
      previewFile: j.previewDl ? `${TASK_DIR}/assets/${j.previewDl.file}` : null, previewSha256: j.previewDl?.sha256 ?? null, previewTriangles: j.previewDl?.glb?.tris ?? null},
    output: {file: `game/public/${outRel}`, url: outRel, sha256: sha(glb), bytes: glb.length, triangles: m.tris, dims: m.dims, overBudget: glb.length > T.budget,
      overTris: m.tris > (spec.tris?.acceptMax ?? Infinity), gpuTextureBytes: m.gpuBytes},
    targetTriangles: spec.tris?.target ?? null, targetSize: spec.targetSize, sizeM, sizeAxis, scale: +scale.toFixed(6), nativeFront: front,
    policy: POLICY, tier, textureStep: step, textureSizes: {baseColor: T.ladder[step][0], other: T.ladder[step][1], jpegQuality: T.ladder[step][2]}, budget: T.budget,
    transform: `rotateY(${({'+Z': '180', '-Z': '0', '+X': '90', '-X': '-90'})[front]}deg) * uniform scale to ${sizeMOf(spec)} m (${sizeAxisOf(spec)}), grounded (min y = 0), centred on x/z; baked into vertices${E ? '; local edits (EDITS): ' + Object.keys(E).join(', ') : ''}`, front: '-Z', up: '+Y',
    review: {evidence: j.accepted.evidence ?? null, checks: j.accepted.checks ?? null, rule4: j.accepted.rule4 ?? null, scale: j.scale ? {verdict: j.scale.verdict, notes: j.scale.notes, evidence: j.scale.evidence} : null},
    ...(NOTES[id] ? {note: NOTES[id]} : {}), textures: m.textures,
    ...(edits ? {edits: {...edits, ...(edits.glass ? {glassMaterial: {...GLASS_MATERIAL, alphaMode: 'BLEND', doubleSided: true}, glassContract: 'transparent, depthWrite false, never a flashlight-shadow caster (shop-cooler glass contract)'} : {})}} : {}),
    ...(partOut.length ? {parts: partOut} : {})});
  console.log(`${code} ${id}: ${rawTris} tris, ${(rawBytes.length / 1e6).toFixed(2)} MB -> ${(glb.length / 1e3).toFixed(0)} kB (${POLICY} ${tier} step ${step}), dims ${m.dims.join(' x ')}${glb.length > T.budget ? '  OVER BUDGET' : ''}${reuse ? ' (reused)' : ''}${DRY ? ' (dry-run: not written)' : ''}`);
}

// ---------- credits / authority summary (whole task, from the ledger) ----------
const billed = new Map();
for (const e of ledger) if ((e.event === 'download' || e.event === 'status') && e.task_id && typeof e.consumed_credits === 'number') billed.set(e.task_id, {kind: e.kind, credits: e.consumed_credits});
const rejectedTasks = new Set(ledger.filter(e => e.event === 'reject').map(e => e.task_id));
const creditSummary = {previews: 0, refines: 0, rejectedOrReplacedAttempts: 0, total: 0};
for (const [tid, v] of billed) { creditSummary[v.kind === 'preview' ? 'previews' : 'refines'] += v.credits; if (rejectedTasks.has(tid)) creditSummary.rejectedOrReplacedAttempts += v.credits; creditSummary.total += v.credits; }
const notCreated = new Set(ledger.filter(e => e.event === 'reconciled' && e.created === false).map(e => e.intentT));
const liveIntents = ledger.filter(e => e.event === 'intent' && !notCreated.has(e.t));
const authorityUse = {attempts: new Set(liveIntents.filter(e => e.kind === 'preview').map(e => e.slot)).size, posts: liveIntents.length,
  max: {attempts: 100, credits: 1500, posts: 200}};
const replacements = ledger.filter(e => e.event === 'intent' && e.replacement).map(e => ({code: e.code, slot: e.slot, ...e.replacement}));

// ---------- provenance ----------
const prov = {schema: 'last-line-derivative/1', asset: 'mall-track3-20261031', task: TASK, lane: 'ASSETS (Studio Beta Track3, sole Meshy submitter)',
  status: 'runtime derivatives of NEW mall-art models generated for this project with Meshy T2.5 (smart topology) through the Meshy MCP under the user\'s finite authorization for Track3 (<= 100 attempts incl. replacements, <= 1500 credits, <= 200 generation POSTs; staged batches frozen by the primary); provider terms apply; unapproved prototypes, no licence or commercial clearance implied',
  rebuild: `node tools/asset-pipeline/props/build-mall-track3.mjs --policy ${POLICY}`,
  rawStorage: `${TASK_DIR}/assets/raw/<id>/<attemptId>/{preview,refine}/ (immutable native GLBs, task status JSON, thumbnails) + ${TASK_DIR}/assets/ledger.jsonl (fsynced intent / ack / status / download / inspect / scale records) + batch-<n>.frozen.json (sha256 in the ledger freeze lines); outside Git`,
  convention: 'metres at real size (sizeM along sizeAxis), +Y up, front -Z, grounded (min y = 0), centred on x/z; library key office-<id> (SHOPS mall kinds render through the office prop path); level-only by path (assets/models/mall-*.glb)',
  texturePolicy: {policy: POLICY, tierFromM: POLICIES[POLICY].L, tiers: POLICIES[POLICY].tiers},
  modelProof: {requested: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', topology: 'triangle', target_formats: ['glb'], refine: 'texture_resolution 2k, enable_pbr true, ai_model omitted (inherits the preview model)'},
    evidence: ['exact create arguments copied from the sha-verified frozen batch into the fsynced ledger intent line before every paid call; ack with the returned task id right after',
      'every preview billed 5 credits (T2 / T2.5 / 6-lite tier; meshy-6 / 7.1 / latest bill 20) and returned a triangle-only mesh near target_polycount (smart topology) — checked before its refine',
      'the Meshy task GET response does not echo ai_model / model_type, so the request record + billing tier are the model proof']},
  freezes: freezes.map(f => ({batch: f.batch, file: f.file, sha256: f.sha256, frozenBy: f.frozenBy, frozenAt: f.frozenAt, attempts: f.attempts, credits: f.credits})),
  credits: creditSummary, authorityUse, replacements, outputs, missing};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }

// ---------- allowlist (only this task's paths) ----------
const MY_PATHS = new Set([PROV_REL, ...[...SPECS.values()].map(v => outRelOf(v.spec.assetId)), ...Object.values(EDITS).flatMap(e => Object.keys(e.parts ?? {}).map(partRelOf)),
  ...(prevProv?.outputs ?? []).flatMap(o => [o.output.url, ...(o.parts ?? []).map(q => q.output.url)])]);
const newFiles = DRY ? outputs.flatMap(o => [{path: o.output.url, buf: null, bytes: o.output.bytes, sha256: o.output.sha256}])
  : outputs.flatMap(o => [o.output.url, ...(o.parts ?? []).map(q => q.output.url)]).map(u => ({path: u, buf: fs.readFileSync(path.join(PUB, u))}));
if (outputs.length) newFiles.push({path: PROV_REL, buf: provBuf});
const added = newFiles.map(f => ({path: f.path, bytes: f.buf ? f.buf.length : f.bytes, sha256: f.buf ? sha(f.buf) : f.sha256}));
const kept = allow.files.filter(f => !MY_PATHS.has(f.path));
const dropped = allow.files.filter(f => MY_PATHS.has(f.path) && !added.some(x => x.path === f.path)).map(f => f.path);
allow.files = [...kept, ...added].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

// ---------- CREDITS section ----------
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const credSection = outputs.length ? [CREDITS_BEGIN, "## The Eaton's Center (Track3): mall fixtures, furniture and loose stock", '',
  `Generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's finite Track3 authorization; runtime derivatives built by \`tools/asset-pipeline/props/build-mall-track3.mjs\` (provenance: \`${PROV_REL}\`). Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters are kept outside Git.`, '',
  ...outputs.map(o => `- \`${o.output.url}\` — ${o.id} (${o.code}; Meshy tasks ${o.tasks.preview} / ${o.tasks.refine})`), CREDITS_END].join('\n') : null;
const credRe = new RegExp(`${CREDITS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CREDITS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const credNext = credSection ? (credRe.test(credSrc) ? credSrc.replace(credRe, credSection) : `${credSrc.replace(/\n*$/, '\n')}\n${credSection}\n`)
  : credRe.test(credSrc) ? credSrc.replace(credRe, '').replace(/\n{3,}$/, '\n') : credSrc;

// ---------- registry blocks ----------
const q = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "\\'")}'`);
const arr = v => `[${v.join(', ')}]`;
const specList = [...SPECS.values()].map(v => v.spec).sort((a, b) => (a.code < b.code ? -1 : 1));
const assetLines = specList.map(s => {
  const o = outputs.find(x => x.id === s.assetId);
  return `  '${s.assetId}': {url: ${o && !DRY ? q(o.output.url) : 'null'}, bytes: ${o ? o.output.bytes : 0}, tris: ${o ? o.output.triangles : 0}, code: '${s.code}', key: '${libraryKey(s.assetId)}'},`;
});
const partLines = outputs.flatMap(o => (o.parts ?? []).map(p => `  '${p.id}': {url: ${q(p.output.url)}, bytes: ${p.output.bytes}, tris: ${p.output.triangles}, from: '${o.id}'},`));
const block1 = ['// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers',
  'export const MALL_ASSETS: Readonly<Record<string, MallAssetEntry>> = {', ...assetLines, '};', '',
  'export const MALL_PART_ASSETS: Readonly<Record<string, MallPartEntry>> = {', ...partLines, '};', '// END GENERATED'].join('\n');
const block2 = ['// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers',
  'export const MALL_DIMS: Readonly<Record<string, readonly [number, number, number]>> = {',
  ...outputs.filter(() => !DRY).map(o => `  '${o.id}': ${arr(o.output.dims)},`), '};', '',
  'export const MALL_ASSET_SPECS: Readonly<Record<string, MallAssetSpec>> = {',
  ...specList.map(s => `  '${s.assetId}': {code: '${s.code}', role: ${q(s.role)}, programs: [${(s.programs ?? []).map(q).join(', ')}], sizeM: ${EDITS[s.assetId]?.sizeM ?? s.targetSize.sizeM}, sizeAxis: '${EDITS[s.assetId]?.sizeAxis ?? s.targetSize.sizeAxis}', target: ${arr([s.targetSize.w, s.targetSize.h, s.targetSize.d])}, placement: ${q(s.placement)}, shopsKind: ${q(s.shopsKind?.kind)}},`),
  '};', '// END GENERATED'].join('\n');
const re = /\/\/ BEGIN GENERATED[^\n]*\n[\s\S]*?\/\/ END GENERATED/;
const regNext = [[REGISTRY, block1], [DIMS_TS, block2]].map(([f, blk]) => {
  const src = fs.readFileSync(f, 'utf8');
  if (!re.test(src)) throw new Error(`GENERATED markers missing in ${f}`);
  return [f, src, src.replace(re, blk)];
});

// ---------- delivery note ----------
const delivered = {task: TASK, generatedBy: 'tools/asset-pipeline/props/build-mall-track3.mjs', policy: POLICY, credits: creditSummary, authorityUse, replacements, assets: {}};
for (const s of specList) {
  const o = outputs.find(x => x.id === s.assetId), mi = missing.find(x => x.id === s.assetId);
  delivered.assets[s.assetId] = {code: s.code, key: libraryKey(s.assetId), shopsKind: s.shopsKind?.kind ?? null, status: o ? 'ready' : /failed/.test(mi?.reason ?? '') ? 'failed' : 'missing',
    url: o ? o.output.url : null, dims: o ? o.output.dims : null, sizeM: o?.sizeM ?? s.targetSize.sizeM, sizeAxis: o?.sizeAxis ?? s.targetSize.sizeAxis, tris: o?.output.triangles ?? 0, bytes: o?.output.bytes ?? 0,
    interaction: s.interaction, placement: s.placement, frontIs: s.frontIs, note: o ? `front -Z, grounded, centred${o.note ? `; ${o.note}` : ''}${o.output.overBudget ? '; OVER byte budget' : ''}` : mi.reason};
}

const totalBytes = outputs.reduce((s2, o) => s2 + o.output.bytes + (o.parts ?? []).reduce((t, p) => t + p.output.bytes, 0), 0);
const gpu = outputs.reduce((s2, o) => s2 + o.output.gpuTextureBytes, 0);
if (DRY) {
  console.log(JSON.stringify({dryRun: true, policy: POLICY, freezes: freezes.length, frozenAssets: SPECS.size, accepted: outputs.length, missing: missing.length,
    wouldWrite: {models: outputs.length, provenance: outputs.length ? PROV_REL : null, allowlist: {own: added.length, dropped}, registry: path.relative(root, REGISTRY), dims: path.relative(root, DIMS_TS),
      credits: credNext !== credSrc, registryChanged: regNext.some(([, a, b]) => a !== b)},
    runtimeBytes: totalBytes, gpuTextureBytes: gpu, credits: creditSummary, authorityUse}, null, 1));
  process.exit(0);
}
if (outputs.length) fs.writeFileSync(PROV, provBuf);
else if (fs.existsSync(PROV) && prevProv?.task === TASK) fs.unlinkSync(PROV);
if (credNext !== credSrc) fs.writeFileSync(CREDITS, credNext);
{ const ce = allow.files.find(f => f.path === CREDITS_REL); const cb = fs.readFileSync(CREDITS); if (ce && (ce.bytes !== cb.length || ce.sha256 !== sha(cb))) { ce.bytes = cb.length; ce.sha256 = sha(cb); } }
if (ALLOW_OUT) fs.writeFileSync(ALLOW_OUT, JSON.stringify({note: 'entries build-mall-track3.mjs owns (tools/release/public-inputs.json files[]); stale ones dropped', owned: [...MY_PATHS].sort(), dropped,
  files: allow.files.filter(f => MY_PATHS.has(f.path) || f.path === CREDITS_REL)}, null, 2) + '\n');
else fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
for (const [f, a, b] of regNext) if (a !== b) fs.writeFileSync(f, b);
{ const tmp = `${DELIVERED}.tmp-${process.pid}`; const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, JSON.stringify(delivered, null, 1) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fs.renameSync(tmp, DELIVERED); }
console.log(`mall models ready ${outputs.length}/${SPECS.size} frozen (${(totalBytes / 1e6).toFixed(2)} MB runtime, ~${(gpu / 1e6).toFixed(0)} MB GPU textures, ${POLICY}); credits ${JSON.stringify(creditSummary)}; allowlist ${added.length} own entries${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
