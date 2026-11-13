// Task studio-train-armor-makeover-20261113-183146-01: the runtime derivatives of the train armour makeover's FOUR new kit parts — the
// tall body PLATE, the buttress POST, the plough WING and the roof-line RAIL — from their Meshy T2.5 smart-topology image-to-3D originals,
// each conditioned on one Codex INITIAL design image (route Codex -> Meshy; every model keeps Meshy's own PBR maps, re-encoded only). The kit's other two
// models (the skirt strip and the fin grille, tools/asset-pipeline/props/build-refinement-batch.mjs) are reused as they are.
//
// Reads (never modifies) the immutable raw originals + the job records kept OUTSIDE Git in
//   reference/tasks/train-armor-makeover-20261113-183146/{finance/ledger.jsonl, gen/codex/codex.jsonl, gen/raw/<raw>.glb, gen/out/<image>.png}
// (each raw + conditioning image is verified against the ledger's reserve / raw / accept rows and the Codex log: a mismatch stops the
// cook) and writes deterministically:
//   game/public/assets/models/{train-armor-plate,train-armor-post,train-armor-wing,train-armor-rail}.glb
//   game/public/assets/derivatives/train-armor-makeover-20261113.json   (provenance; hash-only: no generation text / URLs / private paths)
//   game/src/assets/trainArmorKit.generated.ts   (urls / bytes / tris / dims the runtime reads)
//   game/public/assets/CREDITS.md (its marked section) + tools/release/public-inputs.json (only this script's paths + CREDITS.md)
//
// Derivatives (every frame is measured on the mesh, never assumed): metres, +Y up, grounded (min y = 0), transforms baked into the
// vertices, one material each with Meshy's base colour / packed metallic-roughness / normal maps (Lanczos downsize, JPEG): no
// reprojection / retexture / repaint. No geometry simplification (Smart Topology made the requested triangle targets). All four: the
// native frame kept (width along X, the fins toward +Z — checked: the fins stand proud of their side's typical surface; else a half
// turn), a uniform scale to the reference width, origin at the bottom centre of the BACK (mounting) face: z = 0 at the back. The layout
// (game/src/world/trainArmorLayout.ts) fits them to the car.
//  - RAIL: Meshy reconstructed the straight-on rail design as a two-faced beam (a row of fins on +Z and another on -Z). Kept: the +Z
//    half. Every vertex behind the mounting plane (the bounds' mid-depth) is projected onto it, which folds the rear half flat into a
//    closed back (no triangle is cut or added) — the first kit's end-plough processing (processing of the generated mesh, not authoring).
//
// Usage: node tools/asset-pipeline/props/build-train-armor-makeover.mjs [--dry-run]
//   (the private records' root: TS_REFERENCE_ROOT, else the first ancestor of the repo holding the task folder)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {flatten, clearNodeTransform, transformMesh, getBounds, textureCompress, prune, dedup, join} from '@gltf-transform/functions';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const TASK = 'studio-train-armor-makeover-20261113-183146-01';
const GRANT = '383bee85-ee41-4ac9-b941-d1624ceba6c0';
const CAP = 75;
const TASK_DIR = 'reference/tasks/train-armor-makeover-20261113-183146';
const SCRIPT = 'tools/asset-pipeline/props/build-train-armor-makeover.mjs';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const TDIR = path.join(REF_ROOT, TASK_DIR);
const PROV_ID = 'train-armor-makeover-20261113';
const PROV_REL = `assets/derivatives/${PROV_ID}.json`;
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/trainArmorKit.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN train-armor-makeover-20261113 (build-train-armor-makeover.mjs) -->';
const CREDITS_END = '<!-- END train-armor-makeover-20261113 -->';
const DRY = process.argv.includes('--dry-run');

/** Texture policy (px, JPEG quality): the first armour kit's (the kit covers a whole car seen from a few metres). */
const TEX = {base: 1024, normal: 1024, mr: 512, quality: 85, normalQuality: 90};

/** The parts and their reference widths along X (m); height and depth follow the generated proportions. */
const MODELS = [
  {asset: 'ARMOR_PLATE', id: 'train-armor-plate', key: 'plate', width: 1.2,
    what: 'the train ARMOUR body plate: a layered rusted steel slab in a bolted angle-iron frame with a second welded slab, two riveted straps, a half-sunk circular saw disc, a row of five tapered fins on a bar and a hazard-striped corner',
    credit: 'the train armour\'s body plate (a layered, bolted steel slab with a saw disc and a row of fins; overlapping along both sides of the lower body)'},
  {asset: 'ARMOR_POST', id: 'train-armor-post', key: 'post', width: 0.45,
    what: 'the train ARMOUR buttress post: an upright I-beam girder on a bolted back plate with gussets at the top and bottom, three hooked fins down the spine and a hazard-striped foot',
    credit: 'the train armour\'s buttress post (an I-beam girder on a bolted plate with three hooked fins; the window pillars, the plough\'s corner towers and its prow)'},
  {asset: 'ARMOR_WING', id: 'train-armor-wing', key: 'wing', width: 1.5,
    what: 'the train ARMOUR plough wing: a riveted mouldboard panel with a hazard-striped box beam along the top, six long swept fins, gussets, a circular saw disc at one corner and a saw-toothed wear bar along the bottom',
    credit: 'the train armour\'s plough wing (a mouldboard panel with six swept fins, a saw disc and a toothed wear bar; two per end form the wedge plough)'},
  {asset: 'ARMOR_CREST', id: 'train-armor-rail', key: 'rail', width: 1.6, fold: true,
    what: 'the train ARMOUR roof-line rail: a bolted box-section beam with strap plates at its ends, a row of six raked fins and a hazard-striped end',
    credit: 'the train armour\'s roof-line rail (a bolted box beam with a row of six raked fins; along both sides under the roof and across each end over the windscreen)'},
];

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = m => { throw new Error(`build-train-armor-makeover: ${m}`); };
const r4 = v => +v.toFixed(4);

// ---------------------------------------------------------------------------------------------
// Records: the ledger (sole writer: the task's broker) and the Codex log are the authority

const readRec = rel => fs.readFileSync(path.join(TDIR, rel));
const ledger = readRec('finance/ledger.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
const codex = readRec('gen/codex/codex.jsonl').toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
{
  const grant = ledger.filter(e => e.event === 'AUTHORIZE_FRESH_GRANT');
  if (grant.length !== 1 || grant[0].grantId !== GRANT || grant[0].credits !== CAP) fail('ledger grant row missing / mismatched');
  if (ledger.some(e => e.event !== 'AUTHORIZE_FRESH_GRANT' && e.grantId !== GRANT)) fail('a ledger row of another grant');
}
const billedTotal = ledger.filter(e => e.event === 'settle').reduce((s, e) => s + (e.billed ?? 0), 0);
const generations = ledger.filter(e => e.event === 'reserve').length;
if (billedTotal > CAP) fail(`ledger billed ${billedTotal} > the ${CAP}-credit cap`);
/** The private records' own absolute paths -> this checkout's (the ledger was written where the task ran). */
const local = p => { const i = p.indexOf(TASK_DIR); return i < 0 ? p : path.join(REF_ROOT, p.slice(i)); };
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
  const img = fs.readFileSync(local(reserve.input)), rawBytes = fs.readFileSync(local(raw.file));
  if (sha(img) !== reserve.inputSha256 || img.length !== reserve.inputBytes) fail(`${m.asset}: conditioning image differs from its reservation`);
  if (sha(rawBytes) !== raw.sha256 || rawBytes.length !== raw.bytes) fail(`${m.asset}: raw differs from its ledger row`);
  const cx = codex.find(r => r.phase === 'result' && r.status === 'ok' && r.id === m.asset && r.sha256 === reserve.inputSha256);
  if (!cx || cx.imageGenGenerations !== 1) fail(`${m.asset}: conditioning image is not a recorded single Codex image_gen output`);
  const {file_path: _f, ...request} = reserve.params;
  const meta = await sharp(img).metadata();
  m.rec = {res, meshyTask: posted.taskId, request, billedCredits: settle.billed, priceEvidenceSha256: reserve.priceEvidence.sha256,
    conditioningImage: {sha256: reserve.inputSha256, bytes: img.length, size: `${meta.width}x${meta.height}`, attempt: cx.attempt,
      generator: 'Codex CLI built-in image_gen (ChatGPT login); image model id not reported', file: path.relative(TDIR, local(reserve.input))},
    raw: {sha256: raw.sha256, bytes: raw.bytes, file: path.relative(TDIR, local(raw.file))}};
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
  const rawParts = r.listMeshes().reduce((s, q) => s + q.listPrimitives().length, 0);
  if (r.listMaterials().length !== 1) fail(`${m.asset}: expected one material in the raw, found ${r.listMaterials().length}`);
  // Smart Topology may deliver the parts as several nodes of the one material: one mesh, one primitive for the runtime's instancing
  await doc.transform(flatten(), join({keepNamed: false}));
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  await doc.transform(prune());
  if (r.listMeshes().length !== 1 || r.listMeshes()[0].listPrimitives().length !== 1) fail(`${m.asset}: expected one mesh, one primitive after the join`);
  if (tris(doc) !== rawTris) fail(`${m.asset}: the join changed the triangle count`);
  const scene = r.getDefaultScene() ?? r.listScenes()[0];
  const b0 = getBounds(scene);
  return {doc, r, rawTris, rawTex, rawParts, b0, ext: [0, 1, 2].map(k => b0.max[k] - b0.min[k])};
}
function compactIndices(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    if (idx && p.getAttribute('POSITION').getCount() <= 65535 && !(idx.getArray() instanceof Uint16Array)) idx.setArray(Uint16Array.from(idx.getArray()));
  }
}
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
  const r = doc.getRoot(), tx = TEX;
  compactIndices(doc);
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
  if (chk.getRoot().listMeshes().length !== 1 || chk.getRoot().listMeshes()[0].listPrimitives().length !== 1) fail(`${m.id}: expected one mesh, one primitive`);
  const T = triangleList(chk), b = boundsOf(T);
  if (Math.abs(b.min[1]) > 1e-4) fail(`${m.id}: not grounded (min y ${b.min[1]})`);
  return {glb, textures, T, b, dims: [0, 1, 2].map(k => r4(b.max[k] - b.min[k])), outTris: tris(chk)};
}

/**
 * How far the TYPICAL outer surface seen from each Z side lies behind that side's extreme plane (m): the outermost depth per 4 mm cell
 * (triangles sampled, not just vertices), its median against the bounds. The flat mounting back covers its plane (a gap near 0); on the
 * fin side the fins stand proud of the panel (a gap of centimetres).
 */
function sideProud(T, b) {
  const RES = 0.004, nx = Math.ceil((b.max[0] - b.min[0]) / RES), ny = Math.ceil((b.max[1] - b.min[1]) / RES);
  const front = new Float64Array(nx * ny).fill(-Infinity), back = new Float64Array(nx * ny).fill(Infinity);
  for (const [p, q, r] of T) {
    const e = Math.max(Math.hypot(q[0] - p[0], q[1] - p[1]), Math.hypot(r[0] - p[0], r[1] - p[1]), Math.hypot(r[0] - q[0], r[1] - q[1]));
    const n = Math.max(1, Math.ceil(e / (RES * 0.7)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v, x = p[0] * w + q[0] * u + r[0] * v, y = p[1] * w + q[1] * u + r[1] * v, z = p[2] * w + q[2] * u + r[2] * v;
      const k = Math.min(nx - 1, Math.floor((x - b.min[0]) / RES)) * ny + Math.min(ny - 1, Math.floor((y - b.min[1]) / RES));
      if (z > front[k]) front[k] = z;
      if (z < back[k]) back[k] = z;
    }
  }
  const median = a => { const v = [...a].filter(Number.isFinite).sort((x, y) => x - y); return v[v.length >> 1]; };
  return {front: b.max[2] - median(front), back: median(back) - b.min[2]};
}

// ---------------------------------------------------------------------------------------------
// Cook

async function cook(m) {
  const o = await openRaw(m);
  let folded, foldZ;
  if (m.fold) {
    // keep the +Z half: vertices behind the mid-depth plane are projected onto it (the rear half folds flat into a closed back)
    const b0 = boundsOf(triangleList(o.doc));
    foldZ = (b0.min[2] + b0.max[2]) / 2;
    const P = o.r.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION'), A = P.getArray();
    folded = 0;
    for (let i = 2; i < A.length; i += 3) if (A[i] < foldZ) { A[i] = foldZ; folded++; }
    P.setArray(A);
  }
  const T0 = triangleList(o.doc), b = boundsOf(T0);
  if (!(b.max[2] - b.min[2] < 0.3 * Math.max(o.ext[0], o.ext[1]))) fail(`${m.asset}: expected a panel / post / bar facing +-Z (thin along Z), raw extent ${o.ext.map(r4)}`);
  const proud = sideProud(T0, b), halfTurn = proud.back > proud.front; // the fins (the proud side) end up toward +Z
  if (!(Math.max(proud.front, proud.back) > 5 * Math.min(proud.front, proud.back) + 0.005)) fail(`${m.asset}: cannot tell the fin side from the mounting back (${JSON.stringify(proud)})`);
  const s = m.width / o.ext[0];
  const backZ = halfTurn ? b.max[2] : b.min[2];
  bake(o, m, [s, s, s], [(b.min[0] + b.max[0]) / 2, b.min[1], backZ], halfTurn);
  const out = await finish(o.doc, m);
  if (Math.abs(out.b.min[2]) > 1e-4) fail(`${m.asset}: the back face is not at z = 0`);
  if (Math.abs(out.b.min[0] + out.b.max[0]) > 1e-4) fail(`${m.asset}: not centred along X`);
  return {...out, rawTris: o.rawTris, rawTex: o.rawTex, rawParts: o.rawParts, ext: o.ext, scale: [s, s, s], halfTurn, proud: {front: r4(proud.front), back: r4(proud.back)},
    ...(m.fold ? {foldedVertices: folded, foldPlaneRawZ: r4(foldZ)} : {}),
    convention: `width along X, up +Y, the fin side toward +Z; origin = bottom centre of the back (mounting) face (z = 0 at the back)${m.fold ? '; the raw\'s rear half folded flat onto the back' : ''}`};
}

for (const m of MODELS) {
  m.out = await cook(m);
  console.log(`${m.id}: ${m.out.glb.length} B, ${m.out.outTris} tris, dims ${m.out.dims.join(' x ')} m, scale ${m.out.scale[0].toFixed(4)}, half turn ${m.out.halfTurn}, raw parts ${m.out.rawParts}`);
}
if (DRY) process.exit(0);

// ---------------------------------------------------------------------------------------------
// Write: models, provenance, the generated module, CREDITS section, allowlist

const rel = m => `assets/models/${m.id}.glb`;
for (const m of MODELS) fs.writeFileSync(path.join(PUB, rel(m)), m.out.glb);
const prov = {
  schema: 'terminal-state-derivative-v1',
  id: PROV_ID,
  what: 'the train armour makeover\'s new kit parts: the body plate, the buttress post, the plough wing and the roof-line rail (the skirt strip and the fin grille of refinement-batch-20261113 are reused)',
  task: TASK,
  approval: `task-specific user generation grant ${GRANT}: a fresh cap of ${CAP} Meshy credits for the train armour makeover, reuse first`,
  accepted: true,
  route: 'Codex native image_gen INITIAL design -> Meshy T2.5 image-to-3D, own PBR maps kept',
  budget: {generations, billedCredits: billedTotal, capCredits: CAP, creditsPerModel: 15, note: 'every model is the first Meshy attempt of its first design image'},
  meshyTool: `${MODELS[0].tool} (the project's Meshy MCP entry)`,
  evidence: 'the exact create arguments, task ids, charges, price evidence and raw hashes are in the job ledger kept outside Git; this cook verifies every raw original and conditioning image against it before it writes',
  licence: 'generated for this project under the existing provider accounts; no blanket licence or commercial clearance implied (assets/CREDITS.md)',
  models: MODELS.map(m => {
    const o = m.out, a = m.rec;
    return {
      id: m.id, what: m.what,
      conditioningImage: {sha256: a.conditioningImage.sha256, bytes: a.conditioningImage.bytes, size: a.conditioningImage.size, codexAttempt: a.conditioningImage.attempt, generator: a.conditioningImage.generator, file: `${TASK_DIR}/${a.conditioningImage.file} (raw original, outside Git)`},
      meshy: {task: a.meshyTask, request: a.request, status: 'SUCCEEDED', billedCredits: a.billedCredits, attempt: 1, priceEvidenceSha256: a.priceEvidenceSha256},
      source: {file: `${TASK_DIR}/${a.raw.file} (raw original, outside Git)`, sha256: a.raw.sha256, bytes: a.raw.bytes, triangles: o.rawTris, parts: o.rawParts, extent: o.ext.map(r4), textures: o.rawTex},
      output: {file: `game/public/${rel(m)}`, url: rel(m), sha256: sha(o.glb), bytes: o.glb.length, triangles: o.outTris, dims: o.dims},
      scale: o.scale.map(v => +v.toFixed(6)), convention: o.convention, halfTurn: o.halfTurn, finSideProud: o.proud,
      ...(o.foldedVertices !== undefined ? {foldedVertices: o.foldedVertices, foldPlaneRawZ: o.foldPlaneRawZ} : {}),
      texturePolicy: `Meshy maps kept channel for channel, Lanczos downsize + JPEG: base ${TEX.base} px q${TEX.quality}, metallic-roughness ${TEX.mr} px q${TEX.quality}, normal ${TEX.normal} px q${TEX.normalQuality}; no reprojection / retexture / repaint`,
      textures: o.textures,
    };
  }),
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=|\/workspaces\/|\/home\/|prompt).{0,20}/i); if (hit) fail(`URL / token / local path / generation text in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(PUB, PROV_REL), provBuf);

const modelLine = m => {
  const o = m.out, tex = Object.fromEntries(o.textures.map(t => [t.slot, t.size]));
  return `  ${m.key}: {key: '${m.id}', url: '${rel(m)}', bytes: ${o.glb.length}, tris: ${o.outTris}, dims: [${o.dims.join(', ')}] as const, textures: {baseColor: [${tex.baseColor.join(', ')}] as const, metallicRoughness: [${tex.metallicRoughness.join(', ')}] as const, normal: [${tex.normal.join(', ')}] as const}},`;
};
fs.writeFileSync(REG, `// GENERATED by ${SCRIPT} — do not edit (task ${TASK}).
// The train armour makeover's new kit parts: Meshy T2.5 image-to-3D derivatives of one Codex design image each, their own PBR maps kept
// (provenance ${PROV_REL}). world/trainArmorLayout.ts fits them to the car beside the first kit's two models
// (assets/trainArmor.generated.ts). Frames (metres at the reference size, +Y up, grounded: min y = 0; one mesh, one material, identity
// node): width along X, the fin side toward +Z; origin = bottom centre of the BACK (mounting) face (z = 0).
//  - plate: one body plate (a layered slab with a saw disc and a row of fins).
//  - post: one buttress post (an I-beam girder on a bolted plate with three hooked fins).
//  - wing: one plough wing (a mouldboard panel with six swept fins and a toothed wear bar).
//  - rail: one roof-line rail (a bolted box beam with a row of six raked fins).
// dims = [along X, height, depth along Z].
export const TRAIN_ARMOR_KIT_MODELS = {
${MODELS.map(modelLine).join('\n')}
} as const;
`);

const credSection = [CREDITS_BEGIN, '## Train armour makeover: body plates, buttress posts, plough wings and roof-line rails', '',
  `Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded only). Task ${TASK} under the user's fresh ${CAP}-credit grant (${billedTotal} credits billed, ${generations} generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by \`${SCRIPT}\` (provenance: \`${PROV_REL}\`). The kit's skirt strip and fin grille are the refinement batch's \`assets/models/train-armor-side.glb\` and \`assets/models/train-armor-end.glb\`, reused as they are.`, '',
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
console.log(`wrote ${MODELS.map(rel).join(', ')}, ${PROV_REL}, ${path.relative(root, REG)}, assets/CREDITS.md, tools/release/public-inputs.json`);
