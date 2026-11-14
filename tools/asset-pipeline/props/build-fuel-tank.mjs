// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the runtime model of the FUEL TANK gear item (items/gear.ts `fuel_tank`:
// the worn tank the Flamethrower burns from — a dented red jerrycan strapped to a tubular pack frame with a hand pump, a fuel hose,
// shoulder straps and a waist belt) from its Meshy T2.5 smart-topology image-to-3D original, conditioned on one Codex INITIAL design image
// (a front elevation of the outward side; route Codex -> Meshy). Nothing is generated, re-textured or replaced here: the model's own
// geometry and PBR maps are kept (maps only downsized / re-encoded), as the Airtank Backpack cook (build-airtank-backpack.mjs).
//
// Reads (never modifies) the PRIVATE raw original outside Git (--master <glb>; default: the task's raw under TS_REFERENCE_ROOT, else under
// the first ancestor of the repository that holds the task folder). Its sha256 + bytes must equal the record below: a different file
// stops the cook. The raw never ships and is never copied into the repository; the public provenance names only its hashes and
// measurements.
//
// Derivative = the gear convention (build-airtank-backpack.mjs; read by gear/models.ts): metres at real size, +Y up, the outward side
// (the jerrycan) toward -Z — Meshy's native front is +Z; gear/models.ts fitDerivative turns gear derivatives back to +Z — grounded
// (min y = 0) and centred on x / z, baked into the vertices.
//   Source frame (measured on every run: the shoulder straps must loop out toward raw -Z): the jerrycan facing raw +Z, +Y up.
//   Game = rotateY(180deg) * uniform scale: (x, y, z) -> (-x s, y s, -z s). s = the real overall height (0.62 m: the hanging waist
//   belt's buckle to the top of the frame) / the Y extent.
// Geometry: an exact-attribute weld (lossless); NO simplification (14.5k triangles), no repair, one mesh. Maps: Meshy's 2048 px JPEGs
// downsized (sharp lanczos3) to 1024 (base colour, normal) / 512 (metallic-roughness) — the pack is a ground / stall / icon model, never
// held in first person.
//
// Writes deterministically:
//   game/public/assets/models/gear-fuel-tank.glb           one mesh node, ONE material
//   game/public/assets/derivatives/gear-fuel-tank.json     public provenance (hashes / measurements only: no paths, names or tokens)
//   game/public/assets/CREDITS.md                          its marked section
//   tools/release/public-inputs.json                       ONLY this script's two entries + CREDITS.md added / updated
//
//   node tools/asset-pipeline/props/build-fuel-tank.mjs [--master <glb>] [--dry-run <scratch dir>] [--islands]
//   (--dry-run writes the GLB + provenance only into the scratch dir; --islands prints the model's islands in the cooked frame)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {boundsOf, compact, inBox, islands, r4, r6, slab, weld} from '../weapons/lib/weapon-cook.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const TASK_DIR = 'reference/tasks/flamethrower-fire-20261114-031614';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const DRY = arg('--dry-run') ? path.resolve(arg('--dry-run')) : null;
const SHOW_ISLANDS = argv.includes('--islands');
const PUB = path.join(root, 'game/public');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN flamethrower-fuel-tank-model-20261114 (build-fuel-tank.mjs) -->';
const CREDITS_END = '<!-- END flamethrower-fuel-tank-model-20261114 -->';
/** A new section goes right after the first of these that exists (the Flamethrower's own, else the other Codex -> Meshy survival gear); at the end of the file when both are missing. */
const CREDITS_AFTER = ['<!-- END flamethrower-model-20261114 -->', '<!-- END train-fuel-and-airtank-models -->'];
const SELF = 'tools/asset-pipeline/props/build-fuel-tank.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const ID = 'gear-fuel-tank', ITEM = 'fuel_tank', ASSET = 'FUEL_TANK';
/** Real overall height (m): the hanging waist belt's buckle to the top of the frame (the slim jerrycan is then 0.24 m wide and 0.42 m tall). */
const H_M = 0.62;
const TASK = {
  id: 'studio-flamethrower-fire-20261114-031614-01',
  grant: '63caa2a0-d8b5-44c0-9b69-fa4eb22585e2',
  /** The private raw original's record (size / sha256 checked on every run): the job ledger's row R002. */
  master: {sha256: 'da329600fce670269e37c58d2b4310c08c66cfe8cb79bf8963a6d3bcdc09ca6c', bytes: 9089008, ledgerRow: 'R002'},
  meshy: {task: '01a1d827-dec4-76e0-973b-b51cc616368d', billedCredits: 15, attempt: 1,
    request: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 14000, target_formats: ['glb']}},
  /** The Codex INITIAL design image Meshy was conditioned on (outside Git; a reference here, not an input of this cook). */
  conditioningImage: {sha256: 'f572c6aceaac80e48a9ea7c93604132d4a38abbd1188ae875391668333e71698', bytes: 2364311, size: '1254x1254'},
  route: 'Codex native image_gen INITIAL design image (a front elevation of the outward side: the jerrycan on its frame) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); the Meshy model keeps its own PBR maps (re-encoded only)',
  licence: 'generated for this project under the existing provider accounts; unapproved prototype asset, no blanket licence or commercial clearance implied (assets/CREDITS.md)',
};
const MASTER = path.resolve(arg('--master') ?? path.join(REF_ROOT, TASK_DIR, `gen/raw/${ASSET}-${TASK.master.ledgerRow}-${TASK.meshy.task}.glb`));

/** Source frame -> cooked frame (before scale): the jerrycan raw +Z -> -Z. */
const ROT = ([x, y, z]) => [-x, y, -z];
const ROT_TEXT = 'rotateY(180deg): (x, y, z) -> (-x, y, -z); raw +Z (the jerrycan, the outward side) -> -Z, the gear derivatives\' front';
const TEX = {baseColor: 1024, metallicRoughness: 512, normal: 1024};
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

/**
 * The recorded measurements (inspected on the raw; metres in the COOKED frame at 0.62 m; 112 islands). `upper`: the orientation check —
 * above the waist belt the shoulder straps loop out behind the frame (the wearer's side, +Z here: 0.166 m) farther than the jerrycan,
 * its hose and the pump stand out in front of it (0.118 m). `frame` / `can`: the two islands measured for the record — the frame's
 * feet do not reach the floor (the belt loop hangs lower; its buckle is the lowest part).
 */
const SPEC = {
  upper: {y: [0.3, 0.62], strapsMinZ: 0.15, canMaxZ: 0.14},
  frame: {box: {min: [-0.15, 0.04, -0.05], max: [0.15, 0.6201, -0.015]}, expect: {tris: 564}},
  can: {box: {min: [-0.125, 0.125, -0.105], max: [0.125, 0.55, -0.02]}, expect: {tris: 1360}},
};

const fail = m => { throw new Error(`${ASSET}: ${m}`); };

// ---------- the private raw original ----------
const bytes = fs.readFileSync(MASTER);
if (bytes.length !== TASK.master.bytes || sha(bytes) !== TASK.master.sha256) fail('the --master file is not the recorded raw original (bytes / sha256 mismatch)');
const raw = await (async () => {
  const doc = await io.readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) fail('expected one mesh node / mesh / material');
  const M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) fail('non-identity source node');
  if (r.listAnimations().length || r.listSkins().length) fail('unexpected animation / skin');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) fail('expected one triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`missing ${s}`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) fail('unexpected material (alpha / occlusion / emissive)');
  const infos = {baseColor: mat.getBaseColorTextureInfo(), metallicRoughness: mat.getMetallicRoughnessTextureInfo(), normal: mat.getNormalTextureInfo()};
  for (const info of Object.values(infos)) if (!info || info.getTexCoord() !== 0) fail('a map is missing or uses TEXCOORD_1');
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: p.getAttribute('POSITION').getCount()}, (_, i) => i);
  const m = {P: Float64Array.from(p.getAttribute('POSITION').getArray()), N: Float64Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float64Array.from(p.getAttribute('TEXCOORD_0').getArray()), I};
  const textures = {baseColor: mat.getBaseColorTexture(), metallicRoughness: mat.getMetallicRoughnessTexture(), normal: mat.getNormalTexture()};
  const maps = SLOTS.map(slot => { const t = textures[slot]; return {slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}; });
  const sampler = Object.fromEntries(SLOTS.map(s => [s, {wrapS: infos[s].getWrapS(), wrapT: infos[s].getWrapT(), magFilter: infos[s].getMagFilter(), minFilter: infos[s].getMinFilter()}]));
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  const extraSemantics = p.listSemantics().filter(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s));
  // every name / uri the raw carries (node, mesh, material, texture, scene names): none may reach a public file
  const names = [...r.listNodes(), ...r.listMeshes(), ...r.listMaterials(), ...r.listTextures(), ...r.listScenes()].flatMap(o => [o.getName(), o.getURI?.()])
    .filter(n => typeof n === 'string' && n.length >= 4);
  return {m, textures, maps, sampler, material, extraSemantics, tris: I.length / 3, verts: m.P.length / 3, names};
})();
const rb = boundsOf(raw.m.P), rawExtent = [0, 1, 2].map(k => r4(rb.max[k] - rb.min[k]));

// ---------- geometry ----------
const welded = weld(raw.m);
/** The cooked frame: rotation, uniform height fit, grounded, centred on x / z; the orientation measured. */
const g = (() => {
  const m0 = welded.m, nv = m0.P.length / 3, P = new Float64Array(nv * 3), N = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = ROT([m0.P[3 * v], m0.P[3 * v + 1], m0.P[3 * v + 2]]), n = ROT([m0.N[3 * v], m0.N[3 * v + 1], m0.N[3 * v + 2]]);
    for (let k = 0; k < 3; k++) { P[3 * v + k] = p[k]; N[3 * v + k] = n[k]; }
  }
  const b0 = boundsOf(P), s = H_M / (b0.max[1] - b0.min[1]), c0 = [(b0.min[0] + b0.max[0]) / 2, b0.min[1], (b0.min[2] + b0.max[2]) / 2];
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) P[3 * v + k] = (P[3 * v + k] - c0[k]) * s;
  return {m: {P, N, UV: m0.UV, I: m0.I}, scale: s};
})();
const mesh = g.m;
const isl = islands(mesh);
if (SHOW_ISLANDS) {
  console.log(`${ASSET} islands ${isl.length}:`);
  for (const o of isl) console.log(`   ${String(o.tris.length).padStart(6)}  min ${o.min.map(r4).join(', ')}  max ${o.max.map(r4).join(', ')}`);
}
/** The largest island lying wholly inside a box (islands are sorted largest first), checked against its recorded triangle count. */
const islandIn = (name, sel) => {
  const hit = isl.filter(o => inBox(o, sel.box));
  if (!hit.length || hit[0].tris.length !== sel.expect.tris) fail(`${name}: the largest island in its box has ${hit[0]?.tris.length} triangles != the recorded ${sel.expect.tris}`);
  return hit[0];
};
const up = slab(mesh, {y: SPEC.upper.y});
const orientation = {bandY: SPEC.upper.y, backZ: r4(up.max[2]), frontZ: r4(up.min[2]),
  rule: `above the waist belt (y ${SPEC.upper.y.join(' .. ')} m) the shoulder straps reach z >= ${SPEC.upper.strapsMinZ} m behind the frame (the wearer's side) and the jerrycan stands out no farther than z = -${SPEC.upper.canMaxZ} m in front`};
if (!(up.max[2] >= SPEC.upper.strapsMinZ && up.min[2] >= -SPEC.upper.canMaxZ)) fail(`the jerrycan is not at raw +Z (upper band z ${orientation.frontZ} .. ${orientation.backZ}): inspect the raw before changing the rotation`);
const frame = islandIn('frame', SPEC.frame), can = islandIn('can', SPEC.can);
const partRec = o => ({triangles: o.tris.length, bounds: {min: o.min.map(r4), max: o.max.map(r4)}, size: [0, 1, 2].map(k => r4(o.max[k] - o.min[k]))});

// ---------- maps: the model's own, downsized + re-encoded ----------
const maps = {images: {}, recs: []};
for (const slot of SLOTS) {
  const t = raw.textures[slot], img = Buffer.from(t.getImage()), [sw, sh] = t.getSize(), px = TEX[slot];
  const out = await sharp(img, {limitInputPixels: false}).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
  maps.images[slot] = out;
  maps.recs.push({slot, source: {size: [sw, sh], mime: t.getMimeType(), bytes: img.length, sha256: sha(img)}, size: [px, px], mime: 'image/jpeg', bytes: out.length, sha256: sha(out),
    note: `Meshy's ${sw} px map downsized to ${px} (sharp lanczos3, JPEG q${JPEG[slot].quality} ${JPEG[slot].chromaSubsampling})`});
}

// ---------- the document ----------
const doc = new Document();
const buf = doc.createBuffer();
const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`${ID}-${slot}`).setImage(new Uint8Array(maps.images[slot])).setMimeType('image/jpeg')]));
const mt = raw.material;
const mat = doc.createMaterial(ID).setBaseColorFactor(mt.baseColorFactor).setMetallicFactor(mt.metallicFactor).setRoughnessFactor(mt.roughnessFactor)
  .setEmissiveFactor(mt.emissiveFactor).setDoubleSided(mt.doubleSided).setAlphaMode(mt.alphaMode)
  .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(mt.normalScale);
for (const [slot, info] of [['baseColor', mat.getBaseColorTextureInfo()], ['metallicRoughness', mat.getMetallicRoughnessTextureInfo()], ['normal', mat.getNormalTextureInfo()]]) {
  const s = raw.sampler[slot];
  info.setWrapS(s.wrapS).setWrapT(s.wrapT); if (s.magFilter != null) info.setMagFilter(s.magFilter); if (s.minFilter != null) info.setMinFilter(s.minFilter);
}
const scene = doc.createScene(ID);
doc.getRoot().setDefaultScene(scene);
const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
{
  const {P, N, UV, I} = compact(mesh, mesh.I);
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', UV))
    .setIndices(acc('SCALAR', P.length / 3 < 65536 ? Uint16Array.from(I) : Uint32Array.from(I)));
  scene.addChild(doc.createNode(ID).setMesh(doc.createMesh(ID).addPrimitive(prim)));
}
doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
const glb = Buffer.from(await io.writeBinary(doc));
const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
const sourceName = text => raw.names.find(n => text.toLowerCase().includes(n.toLowerCase()));
if (/https?:|Signature|X-Amz|token|_texture\.glb/i.test(json) || sourceName(json)) fail('URL / token / a source name string inside the glTF JSON');

// ---------- verify the written bytes + measure on them ----------
const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3 || chk.listNodes().length !== 1) fail('not one mesh node / one material with three maps');
const all = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
let tris = 0, verts = 0;
for (const m of chk.listMeshes()) {
  const prim = m.listPrimitives()[0], pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  tris += prim.getIndices().getCount() / 3; verts += pos.getCount();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { all.min[k] = Math.min(all.min[k], v[k]); all.max[k] = Math.max(all.max[k], v[k]); } }
}
if (tris !== raw.tris) fail(`triangles ${tris} != the source's ${raw.tris}`);
const dims = [0, 1, 2].map(k => r4(all.max[k] - all.min[k]));
const bounds = {min: all.min.map(r4), max: all.max.map(r4)};
if (Math.abs(dims[1] - H_M) > 2e-4 || Math.abs(all.min[1]) > 1e-4 || Math.abs(all.min[0] + all.max[0]) > 1e-3 * H_M || Math.abs(all.min[2] + all.max[2]) > 1e-3 * H_M) fail('not the real height / grounded / centred');
console.log(`${ID}: ${raw.tris} tris -> ${tris} (weld ${welded.info.verticesBefore} -> ${welded.info.verticesAfter} verts; ${verts} written), dims ${dims.join(' x ')} m, scale ${r6(g.scale)}; ` +
  `${glb.length} B; maps ${maps.recs.map(t => `${t.slot} ${t.source.size[0]} -> ${t.size[0]} ${t.bytes}`).join(', ')}; frame y ${r4(frame.min[1])} .. ${r4(frame.max[1])}, can ${partRec(can).size.join(' x ')}`);

// ---------- public provenance (hashes and measurements only) ----------
const url = `assets/models/${ID}.glb`, provRel = `assets/derivatives/${ID}.json`;
const prov = {
  schema: 'terminal-state-derivative-v1', id: ID, item: `${ITEM} (items/gear.ts)`,
  role: 'ground / stall / icon model of the Fuel Tank gear item (the worn tank the Flamethrower burns from)',
  task: TASK.id,
  approval: `task-specific user generation grant ${TASK.grant} (a scoped cap of 75 Meshy credits); this model: ${TASK.meshy.billedCredits} credits, the first attempt of its design image`,
  route: TASK.route,
  conditioningImage: {...TASK.conditioningImage, generator: 'Codex CLI built-in image_gen (ChatGPT login); image model id not reported', note: 'the INITIAL design image (kept outside Git): a reference only, not an input of this cook'},
  meshy: {tool: 'mcp__meshy__meshy_image_to_3d (the project\'s Meshy MCP entry)', task: TASK.meshy.task, request: TASK.meshy.request, status: 'SUCCEEDED',
    billedCredits: TASK.meshy.billedCredits, attempt: TASK.meshy.attempt, ledgerRow: TASK.master.ledgerRow,
    evidence: 'the exact create arguments, the charge, the price evidence and the raw hash are in the job ledger kept outside Git'},
  source: {kind: 'the Meshy raw original: kept outside Git, read-only and never shipped', sha256: TASK.master.sha256, bytes: TASK.master.bytes,
    triangles: raw.tris, vertices: raw.verts, extent: rawExtent, axes: 'the jerrycan (the outward side) facing +Z, +Y up, the shoulder straps looping out toward -Z',
    material: raw.material, maps: raw.maps, droppedAttributes: raw.extraSemantics},
  processing: {
    weld: {...welded.info, rule: 'exact-attribute weld (bitwise-equal position / normal / uv), degenerate triangles and unreferenced vertices dropped: lossless'},
    simplify: 'none: the model\'s triangle count is kept', ops: [],
    rotation: ROT_TEXT, orientationCheck: orientation,
    heightM: H_M, uniformScale: r6(g.scale),
    heightRule: 'uniform scale so the overall Y extent (the hanging waist belt\'s buckle to the top of the frame) = 0.62 m: a pack frame the height of a torso, carrying a slim jerrycan',
    origin: 'grounded (min y = 0) and centred on x / z; baked into the vertices',
  },
  output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: tris, vertices: verts, dims, bounds},
  measured: {
    frame: {...partRec(frame), rule: `the largest island lying inside the box min ${JSON.stringify(SPEC.frame.box.min)} max ${JSON.stringify(SPEC.frame.box.max)} (m)`},
    jerrycan: {...partRec(can), rule: `the largest island lying inside the box min ${JSON.stringify(SPEC.can.box.min)} max ${JSON.stringify(SPEC.can.box.max)} (m)`},
    frameFeetAboveFloorM: r4(frame.min[1]),
  },
  textures: maps.recs,
  texturePolicy: 'the model\'s own PBR maps kept slot for slot (base colour / metallic-roughness / normal), downsized 2048 -> 1024 / 512 / 1024 px and re-encoded (no recolour, tint, re-texture, projection or new art)',
  limitations: [
    'one rigid mesh: the straps, the waist belt, the pump lever and the hose are modelled in place and do not move',
    `the waist belt is modelled as a closed loop hanging around the foot of the frame: its buckle is the model's lowest part, so the standing pack rests on the belt and the frame's feet stay ${Math.round(frame.min[1] * 1000)} mm above the floor`,
    'the jerrycan is modelled slim (a shallow can against the frame\'s back plate)',
  ],
  convention: 'metres at real size, +Y up, front -Z (the jerrycan side; gear/models.ts turns gear derivatives to +Z), grounded, centred on x / z',
  licence: TASK.licence, rebuild: `node ${SELF} [--master <the private raw original>]`,
};
const provBytes = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{
  const hit = provBytes.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=|reference\/|\/workspace|\/home\/|portal|prompt|_texture\.glb).{0,20}/i);
  if (hit) fail(`URL / token / private path / generation text in the public provenance: ...${hit[0]}...`);
  if (sourceName(provBytes.toString())) fail('a source name string in the public provenance');
}

const credSection = [CREDITS_BEGIN, '## The Fuel Tank', '',
  `Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (re-encoded only). Task ${TASK.id} under the user's scoped 75-credit grant (${TASK.meshy.billedCredits} credits, a first attempt). AI-generated asset: an unapproved prototype, no licence or commercial clearance implied. The raw master, the design image and the job ledger are kept outside Git.`, '',
  `- \`${url}\` — the Fuel Tank gear item (a red jerrycan on a tubular pack frame with a hand pump, hose, shoulder straps and a waist belt); runtime derivative by \`${SELF}\` (provenance: \`${provRel}\`; Meshy task ${TASK.meshy.task}).`,
  CREDITS_END].join('\n');

const written = new Map([[url, glb], [provRel, provBytes]]);
if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, b] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), b);
  console.log(`dry run: ${written.size} files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) written to ${DRY}`);
  process.exit(0);
}
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
const after = CREDITS_AFTER.find(m => credSrc.includes(m));
const credOut = credRe.test(credSrc) ? credSrc.replace(credRe, credSection)
  : after ? credSrc.replace(after, `${after}\n\n${credSection}`)
    : `${credSrc.replace(/\n*$/, '')}\n\n${credSection}\n`;
written.set('assets/CREDITS.md', Buffer.from(credOut));
const othersBefore = JSON.stringify(allow.files.filter(f => !written.has(f.path)));
for (const [rel, b] of written) fs.writeFileSync(path.join(PUB, rel), b);
allow.files = [...allow.files.filter(f => !written.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !written.has(f.path))) !== othersBefore) fail('another allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + public-inputs.json (its own entries + CREDITS.md)`);
