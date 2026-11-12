// Task studio-turnstile-user-model-20261112-004550-01: the runtime model of the TURNSTILE (G07), the user-selected shotgun concept B
// ("Keep moving": a six-shell top-break revolving-cylinder 12-gauge) — from the USER'S OWN textured model. The user generated it and
// uploaded it for this task ("I want the model to be really good so I'm hand generating it"); it is the only input. Nothing is generated,
// re-textured or replaced here: the model's own geometry and PBR maps are kept (maps only downsized / re-encoded), as the weapon-variety cook.
//
// Reads (never modifies) the PRIVATE master outside Git (default reference/tasks/turnstile-user-model-20261112-004550/inputs/
// turnstile-user-original.glb; its sha256 + bytes must equal the delivery record below). The master never ships and is never copied into
// the repository; the public provenance names only its hashes and measurements.
//
// Derivative = the game's held-weapon convention (as weapons/build-weapon-variety.mjs; read by weapons/viewmodel.ts): metres, +Y up,
// forward = -Z, the weapon's right side +X.
//   Source frame (inspected; the same as the Meshy weapon-variety raws): muzzle at raw -X, +Y up, the concept's visible side (the weapon's
//   RIGHT side) facing raw -Z. Game = rotateY(-90deg) * uniform scale: (x, y, z) -> (-z s, y s, x s). s = the selected design's real
//   overall length (0.80 m: concept B, "the lightest and shortest shotgun") / the Z extent. At 0.80 m the six-shot cylinder is 78 mm
//   across and the length of pull ~0.34 m (a real carbine's); the barrel is round (X / Y 0.96: no thickness correction).
//   The bounding box is centred on the origin; empty marker nodes Grip (pistol-grip hand) / Muzzle (bore axis at the muzzle face) / Sight
//   (the eye line over the rear sight) / Eject (the cylinder's rear face: where the hulls leave when it is broken open) / Hinge.
//   Part (local mesh separation of the model's own geometry, recorded): `Barrels` = the whole break-open assembly — barrel, perforated
//   shroud (+ its four screws), front sight, barrel collar, cylinder (+ its front axis pin and rear ratchet), top strap and top latch, all
//   separate position-connected islands of the model, plus the frame's cylinder window AHEAD of the standing breech (front post + top
//   bar), cut exactly from the frame by an axis-aligned box. It turns about the `Hinge` marker = the model's own hinge pin at the lower
//   front of the window (the pin heads stay on the frame). A part node's translation is its pivot, its geometry relative to it.
// Geometry: an exact-attribute weld (lossless) only; NO simplification (30.4k triangles: a held-weapon first-person density, like the
// ~20k weapon-variety guns). Maps: the model's 8192 px base colour and 4096 px metallic-roughness / normal JPEGs, downsized to the guns'
// budget — base colour 2048, metallic-roughness / normal 1024 (sharp lanczos3, JPEG 4:4:4) — ~48.7 MB of maps -> ~2 MB.
//
// Writes deterministically:
//   game/public/assets/models/weapon-turnstile.glb              one body mesh node + the Barrels part node + marker nodes, ONE material
//   game/public/assets/derivatives/weapon-turnstile.json        safe public provenance (hashes / measurements; no paths, names or tokens)
//   game/src/assets/weaponTurnstileModel.generated.ts           WEAPON_TURNSTILE_MODEL (an entry of WEAPON_VARIETY_MODELS)
//   tools/release/public-inputs.json                            ONLY this script's two entries added / updated (others untouched)
//
//   node tools/asset-pipeline/weapons/build-turnstile.mjs [--master <glb>] [--dry-run <scratch dir>] [--islands]
//   (--dry-run writes the GLB + provenance + a registry preview only into the scratch dir; --islands prints the model's islands in the game
//   frame, for authoring)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {applyOps, boundsOf, compact, islands, r4, r5, r6, resolveMarkers, slab, triList, weld} from './lib/weapon-cook.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const MASTER = path.resolve(arg('--master') ?? path.join(root, 'reference/tasks/turnstile-user-model-20261112-004550/inputs/turnstile-user-original.glb'));
const DRY = arg('--dry-run') ? path.resolve(arg('--dry-run')) : null;
const SHOW_ISLANDS = argv.includes('--islands');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/weaponTurnstileModel.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/weapons/build-turnstile.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const W = {asset: 'G07', itemId: 'turnstile', slug: 'turnstile', name: 'Turnstile', kind: 'gun', family: 'shotgun', length: 0.80};
const TASK = {
  id: 'studio-turnstile-user-model-20261112-004550-01',
  /** The private master's delivery record (size / sha256 checked on every run). */
  master: {sha256: '492e620ab13990ba49052af702c37f041e2c33334ca7dc538cf9f1ef19637652', bytes: 50133992},
  /** The user-selected concept (shotgun concept options, option B): the design reference the user's model follows; not an input here. */
  concept: {id: 'B', name: 'Turnstile', tag: 'Keep moving', sha256: '52d41497202f7f45ed829cbfd43bfc600ca6ab204530e95783d6f5b3a84a6adc'},
  route: "the user's own textured model (made by the user with Meshy, per its export) of the selected concept B, supplied by the user for implementation and texture compression; cooked as-is: rotation, uniform scale to the design length, a lossless weld, one recorded local part separation and the model's own maps downsized / re-encoded (no generation, re-texture, projection or replacement)",
  licence: 'supplied by the user for this project (its upload file name mentions Meshy; the generator, account, settings and licence are not verified and the provider\'s terms may apply); unapproved prototype asset, no blanket licence or commercial clearance implied',
};

/** Source frame -> game frame (before scale): muzzle raw -X -> game -Z; the right side raw -Z -> game +X. */
const ROT = ([x, y, z]) => [-z, y, x];
const ROT_TEXT = 'rotateY(-90deg): (x, y, z) -> (-z, y, x); raw -X (muzzle) -> game -Z, raw -Z (the concept\'s visible = the weapon\'s RIGHT side) -> game +X';
/** Thickness probe: the barrel's X / Y cross-section ratio outside this band would need a recorded correction. */
const ROUND_BAND = [0.85, 1.18];
const TEX = {baseColor: 2048, metallicRoughness: 1024, normal: 1024};
const JPEG = {baseColor: {quality: 90, chromaSubsampling: '4:4:4'}, metallicRoughness: {quality: 90, chromaSubsampling: '4:4:4'}, normal: {quality: 92, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

/**
 * The recorded processing (inspected on the master; metres in the CENTRED game frame at 0.80 m). Islands (largest first): the frame + grip
 * + trigger guard (8712 triangles), the perforated shroud (5461), the stock tube (3417), the cylinder (3079: x +-0.0398, y -0.0176 .. 0.0604,
 * z -0.0567 .. 0.0224), the butt pad, the top latch, the front sight, the rear sight, the tape wraps, the top strap, the barrel (z -0.40 ..
 * -0.084), the trigger, the stock brace, the barrel collar, screws, the hinge pin heads (x +-0.026, centre y -0.0173 z -0.0653), the
 * cylinder's front axis pin and rear ratchet. The frame's breech face starts at z 0.0229 (the cylinder's rear face is 0.0224); the bottom
 * strap's top is at y -0.0167.
 */
const SPEC = {
  round: {z: [-0.40, -0.32], y: [0.02, 0.054], x: [-0.02, 0.02]}, roundPart: 'the barrel ahead of the shroud (round)',
  ops: [
    {op: 'assign', name: 'Barrels', islands: {box: {min: [-0.045, -0.018, -0.401], max: [0.045, 0.087, 0.032]}, expect: {islands: 13, tris: 12596}},
      why: 'the break-open assembly\'s own islands (every island ahead of the standing breech and above the bottom strap): barrel, perforated shroud + its four screws, front sight, barrel collar, the cylinder with its front axis pin and rear ratchet, the top strap and the top latch'},
    {op: 'assign', name: 'Barrels', clip: {box: {min: [-1, -0.0165, -1], max: [1, 1, 0.0228]},
      except: {box: {min: [-0.03, -0.024, -0.0715], max: [0.03, -0.011, -0.0595]}, expect: {islands: 2, tris: 324}}},
      why: 'the frame\'s cylinder window ahead of the standing breech (its front post and top bar) breaks with the barrel: the frame cut exactly at the breech face (z 0.0228, just ahead of its first vertex 0.0229 and behind the cylinder\'s rear face 0.0224) and just above the bottom strap (y -0.0165; the strap\'s top is -0.0167), which stays as the hinge carrier; the two hinge pin heads (their own islands) stay on the frame'},
  ],
  parts: [{name: 'Barrels', pivot: 'hinge', why: 'the top-break reload: barrel + shroud + cylinder + top strap + latch + the window\'s front post / top bar turn about the Hinge (rotation.x < 0 drops the muzzle and lifts the cylinder\'s rear face toward the eye)'}],
  markers: {Grip: [{mid: [-0.057, 0.132]}, -0.057, 0.132], Muzzle: {front: {y: [0.02, 0.052]}}, Sight: [{mid: [0.072, 0.069]}, 0.0833, 0.069],
    Eject: ['mid', 0.0214, 0.0224], Hinge: ['mid', -0.01735, -0.0653]},
  markerNotes: 'Grip: the slanted rubber pistol grip at mid-hand height (its section at y -0.057 spans z 0.102 - 0.161); Muzzle: the barrel\'s front face (y 0.022 - 0.0518; the front sight starts 3 mm behind it); Sight: the eye line over the rear sight top (0.0833; the front post tip is 0.0784 and the top latch rises to 0.0861 between them, so ADS sets a sight lift); Eject: the cylinder\'s rear face on its axis (where the hulls leave when it is broken open; a revolver throws none per shot); Hinge: the centre of the model\'s own hinge pin at the lower front of the cylinder window (the pivot axis is parallel to X)',
};

const fail = m => { throw new Error(`${W.asset}: ${m}`); };

// ---------- the private master ----------
const bytes = fs.readFileSync(MASTER);
if (bytes.length !== TASK.master.bytes || sha(bytes) !== TASK.master.sha256) fail(`the master ${MASTER} is not the delivered file (bytes / sha256 mismatch)`);
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
  // every name / uri the master carries (its own node, mesh, material, texture names, scene and generator strings): none may reach a public file
  const names = [...r.listNodes(), ...r.listMeshes(), ...r.listMaterials(), ...r.listTextures(), ...r.listScenes()].flatMap(o => [o.getName(), o.getURI?.()])
    .concat(r.getAsset().generator ?? '').filter(n => typeof n === 'string' && n.length >= 4);
  return {m, textures, maps, sampler, material, extraSemantics, tris: I.length / 3, verts: m.P.length / 3, names};
})();
const rb = boundsOf(raw.m.P), rawExtent = [0, 1, 2].map(k => r4(rb.max[k] - rb.min[k]));
if (!(rawExtent[0] > rawExtent[1] * 2 && rawExtent[0] > rawExtent[2] * 2)) fail(`expected the gun along raw X (${rawExtent})`);

// ---------- geometry ----------
const welded = weld(raw.m);
/** The centred game frame: rotation, uniform length fit, centring; the barrel's roundness probed (no thickness correction is recorded). */
const g = (() => {
  const m0 = welded.m, nv = m0.P.length / 3, P = new Float64Array(nv * 3), N = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = ROT([m0.P[3 * v], m0.P[3 * v + 1], m0.P[3 * v + 2]]), n = ROT([m0.N[3 * v], m0.N[3 * v + 1], m0.N[3 * v + 2]]);
    for (let k = 0; k < 3; k++) { P[3 * v + k] = p[k]; N[3 * v + k] = n[k]; }
  }
  const b0 = boundsOf(P), s = W.length / (b0.max[2] - b0.min[2]), c0 = [0, 1, 2].map(k => (b0.min[k] + b0.max[k]) / 2);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) P[3 * v + k] = (P[3 * v + k] - c0[k]) * s;
  const m = {P, N, UV: m0.UV, I: m0.I}, sl = slab(m, SPEC.round);
  const probe = {n: sl.n, x: r4(sl.max[0] - sl.min[0]), y: r4(sl.max[1] - sl.min[1]), ratioXY: r4((sl.max[0] - sl.min[0]) / (sl.max[1] - sl.min[1]))};
  if (probe.ratioXY < ROUND_BAND[0] || probe.ratioXY > ROUND_BAND[1]) fail(`barrel X / Y ${probe.ratioXY} outside ${ROUND_BAND.join(' - ')}: a thickness correction would have to be recorded`);
  return {m, scale: s, thickness: {probe: SPEC.round, part: SPEC.roundPart, after: probe, factorX: 1, band: ROUND_BAND}};
})();
if (SHOW_ISLANDS) {
  const list = islands(g.m);
  console.log(`${W.asset} islands ${list.length}:`);
  for (const o of list) console.log(`   ${String(o.tris.length).padStart(6)}  min ${o.min.map(r4).join(', ')}  max ${o.max.map(r4).join(', ')}`);
}
const ops = applyOps(W, g.m, SPEC.ops);
const {markers: mk, rules: markerRules} = resolveMarkers(W, ops.mesh, SPEC.markers);
const markers = Object.fromEntries(Object.entries(mk).map(([k, p]) => [k, p.map(r5)]));
for (const n of ['Grip', 'Muzzle', 'Sight', 'Eject', 'Hinge']) if (!markers[n]) fail(`marker ${n} missing`);
const byLabel = new Map();
ops.label.forEach((l, t) => { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(t); });
if (byLabel.size !== 1 + SPEC.parts.length) fail(`labels ${[...byLabel.keys()]} != the body + the recorded parts`);
const nodes = [{name: W.itemId, mesh: compact(ops.mesh, triList(ops.mesh, byLabel.get(''))), translation: [0, 0, 0]}];
const partRecs = [];
for (const p of SPEC.parts) {
  const tris = byLabel.get(p.name);
  if (!tris?.length) fail(`part ${p.name} has no triangles`);
  const I = triList(ops.mesh, tris), pb = boundsOf(ops.mesh.P, I), pivot = markers.Hinge;
  nodes.push({name: p.name, mesh: compact(ops.mesh, I, pivot), translation: pivot}); // node translation + local geometry = the model frame
  partRecs.push({name: p.name, why: p.why, pivot: {rule: 'the Hinge marker (the break-action axis, parallel to X)', at: pivot}, triangles: I.length / 3,
    bounds: {min: pb.min.map(r4), max: pb.max.map(r4)}});
}

// ---------- maps: the model's own, downsized / re-encoded ----------
const maps = {images: {}, recs: []};
for (const slot of SLOTS) {
  const t = raw.textures[slot], img = Buffer.from(t.getImage()), [sw, sh] = t.getSize(), px = TEX[slot];
  const out = await sharp(img, {limitInputPixels: false}).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
  maps.images[slot] = out;
  maps.recs.push({slot, source: {size: [sw, sh], mime: t.getMimeType(), bytes: img.length, sha256: sha(img)}, size: [px, px], mime: 'image/jpeg', bytes: out.length, sha256: sha(out),
    note: `the model's ${sw} px map downsized to ${px} (sharp lanczos3, JPEG q${JPEG[slot].quality} ${JPEG[slot].chromaSubsampling})`});
}

// ---------- the document ----------
const doc = new Document();
const buf = doc.createBuffer();
const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`weapon-${W.slug}-${slot}`).setImage(new Uint8Array(maps.images[slot])).setMimeType('image/jpeg')]));
const mt = raw.material;
const mat = doc.createMaterial(`weapon-${W.slug}`).setBaseColorFactor(mt.baseColorFactor).setMetallicFactor(mt.metallicFactor).setRoughnessFactor(mt.roughnessFactor)
  .setEmissiveFactor(mt.emissiveFactor).setDoubleSided(mt.doubleSided).setAlphaMode(mt.alphaMode)
  .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(mt.normalScale);
for (const [slot, info] of [['baseColor', mat.getBaseColorTextureInfo()], ['metallicRoughness', mat.getMetallicRoughnessTextureInfo()], ['normal', mat.getNormalTextureInfo()]]) {
  const s = raw.sampler[slot];
  info.setWrapS(s.wrapS).setWrapT(s.wrapT); if (s.magFilter != null) info.setMagFilter(s.magFilter); if (s.minFilter != null) info.setMinFilter(s.minFilter);
}
const scene = doc.createScene(`weapon-${W.slug}`);
doc.getRoot().setDefaultScene(scene);
const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
for (const n of nodes) {
  const {P, N, UV, I} = n.mesh;
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', UV))
    .setIndices(acc('SCALAR', P.length / 3 < 65536 ? Uint16Array.from(I) : Uint32Array.from(I)));
  const node = doc.createNode(n.name).setMesh(doc.createMesh(n.name).addPrimitive(prim));
  if (n.translation.some(v => v !== 0)) node.setTranslation(n.translation);
  scene.addChild(node);
}
for (const [name, p] of Object.entries(markers)) scene.addChild(doc.createNode(name).setTranslation(p));
doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
const glb = Buffer.from(await io.writeBinary(doc));
const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
const sourceName = text => raw.names.find(n => text.toLowerCase().includes(n.toLowerCase()));
if (/https?:|Signature|X-Amz|token|_texture\.glb/i.test(json) || sourceName(json)) fail('URL / token / an upload or source name string inside the glTF JSON');

// ---------- verify the written bytes + measure on them ----------
const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3) fail('not one material with three maps');
const all = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
let tris = 0, verts = 0;
const partNames = [];
for (const node of chk.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  if (node.getName() !== W.itemId) partNames.push(node.getName());
  const M = node.getWorldMatrix(), prim = mesh.listPrimitives()[0], pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  tris += prim.getIndices().getCount() / 3; verts += pos.getCount();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { const q = v[k] + M[12 + k]; all.min[k] = Math.min(all.min[k], q); all.max[k] = Math.max(all.max[k], q); } }
}
const length = r4(all.max[2] - all.min[2]);
if (Math.abs(length - W.length) > 2e-4) fail(`written length ${length} != ${W.length}`);
if (tris < raw.tris) fail(`triangles ${tris} < the source's ${raw.tris} (nothing may be dropped)`);
for (const name of Object.keys(markers)) if (!chk.listNodes().some(n => n.getName() === name && !n.getMesh())) fail(`marker node ${name} missing`);
const dims = [0, 1, 2].map(k => r4(all.max[k] - all.min[k]));
const bounds = {min: all.min.map(r4), max: all.max.map(r4)};
console.log(`${W.asset} ${W.itemId}: ${raw.tris} tris -> ${tris} (parts ${partNames.join(', ')}; weld ${welded.info.verticesBefore} -> ${welded.info.verticesAfter} verts), dims ${dims.join(' x ')} m, ` +
  `scale ${r6(g.scale)}, barrel X/Y ${g.thickness.after.ratioXY}; ${glb.length} B; maps ${maps.recs.map(t => `${t.slot} ${t.source.size[0]} -> ${t.size[0]} ${t.bytes}`).join(', ')}; ` +
  `markers ${Object.entries(markers).map(([k, v]) => `${k} ${v.join(',')}`).join(' | ')}`);

// ---------- public provenance (safe: hashes and measurements only) ----------
const url = `assets/models/weapon-${W.slug}.glb`, provRel = `assets/derivatives/weapon-${W.slug}.json`;
const prov = {
  schema: 'terminal-state-derivative-v1', id: `weapon-${W.slug}`, itemId: W.itemId, asset: W.asset, name: W.name, kind: W.kind, family: W.family,
  role: 'held / pickup model of the Turnstile (12-gauge six-shell top-break revolving-cylinder shotgun): a weapon-variety ADDITION (every other weapon model is unchanged)',
  task: TASK.id, route: TASK.route,
  concept: {...TASK.concept, note: 'the user-selected shotgun concept (outside Git): the design the user\'s model follows; a reference only, not an input of this cook'},
  source: {kind: 'user-supplied textured GLB: the private master stays outside Git, read-only and never shipped', sha256: TASK.master.sha256, bytes: TASK.master.bytes,
    triangles: raw.tris, vertices: raw.verts, extent: rawExtent, axes: 'muzzle at -X, +Y up, the weapon\'s right side (the concept\'s visible side) facing -Z',
    material: raw.material, maps: raw.maps, droppedAttributes: raw.extraSemantics},
  processing: {
    weld: {...welded.info, rule: 'exact-attribute weld (bitwise-equal position / normal / uv), degenerate triangles and unreferenced vertices dropped: lossless'},
    simplify: 'none: the model\'s triangle count is kept (held-weapon first-person density)',
    rotation: ROT_TEXT, lengthM: W.length, uniformScale: r6(g.scale),
    lengthRule: 'uniform scale so the overall Z extent (muzzle to butt pad) = the selected design\'s length (concept B: ~0.80 m, the shortest shotgun); the six-shot cylinder is then 78 mm across and the length of pull ~0.34 m',
    thickness: g.thickness, origin: 'the bounding box (all parts) centred on the origin',
    ops: ops.recs, parts: partRecs, markers: markerRules, markerNotes: SPEC.markerNotes,
  },
  output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: tris, vertices: verts, dims, bounds,
    nodes: {body: W.itemId, parts: partNames, markers: Object.keys(markers)}, markers},
  textures: maps.recs,
  texturePolicy: 'the model\'s own PBR maps kept slot for slot (base colour / metallic-roughness / normal), only downsized + re-encoded to the held-gun budget: base colour 8192 -> 2048 px, metallic-roughness / normal 4096 -> 1024 px (no recolour, tint, re-texture, projection or new art)',
  limitations: [
    'the model\'s cylinder faces carry no modelled chambers (front / rear faces are flat with an unresolved texture) and its section is not six-fold symmetric: the open action shows the rear face as modelled, and the cylinder does not index per shot (turning it would show surfaces the model never resolved); nothing is invented in their place',
  ],
  convention: 'metres at real size, +Y up, muzzle toward -Z, the right side +X; bounding box centred on the origin; empty marker nodes Grip / Muzzle / Sight / Eject / Hinge; the Barrels part node translated to its pivot (the Hinge)',
  licence: TASK.licence, rebuild: `node ${SELF} [--master <the private master glb>]`,
};
const provBytes = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
const hit = provBytes.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=|reference\/|\/workspace|portal|_texture\.glb).{0,20}/i);
if (hit) fail(`URL / token / private path in the public provenance: ...${hit[0]}...`);
if (sourceName(provBytes.toString())) fail('a source name string in the public provenance');

// ---------- registry ----------
const vec = v => `[${v.map(x => String(r5(x))).join(', ')}]`;
const registry = `// GENERATED by ${SELF} (task ${TASK.id}) — do not edit.
// The Turnstile (G07): the user's own textured model of the selected shotgun concept B, its PBR maps kept (base colour 2048 px +
// metallic-roughness / normal 1024 px). Provenance in assets/derivatives/weapon-turnstile.json. The held-weapon convention of the weapon-variety
// models (metres, +Y up, muzzle toward -Z, the right side +X, bounding box centred on the origin; empty marker nodes Grip / Muzzle / Sight /
// Eject / Hinge); part 'Barrels' = the whole top-break assembly (barrel, shroud, cylinder, top strap, latch and the window's front post),
// pivot = its 'Hinge' marker (the model's hinge pin; a rotation.x < 0 drops the muzzle and lifts the cylinder's rear face).
// The last entry of WEAPON_VARIETY_MODELS (assets/weaponVarietyModels.generated.ts).
import type {WeaponVarietyModel} from './weaponVarietyModels.generated';

export const WEAPON_TURNSTILE_MODEL: WeaponVarietyModel = {
  id: '${W.asset}', itemId: '${W.itemId}', kind: '${W.kind}', url: '${url}', length: ${dims[2]},
  bounds: {min: ${vec(bounds.min)}, max: ${vec(bounds.max)}}, tris: ${tris},
  markers: {${Object.entries(markers).map(([k, v]) => `${k}: ${vec(v)}`).join(', ')}},
  parts: [${partNames.map(p => `'${p}'`).join(', ')}],
};
`;

const written = new Map([[url, glb], [provRel, provBytes]]);
if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, b] of written) fs.writeFileSync(path.join(DRY, path.basename(rel)), b);
  fs.writeFileSync(path.join(DRY, path.basename(REG)), registry);
  console.log(`dry run: ${written.size} files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + registry preview written to ${DRY}`);
  process.exit(0);
}
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const othersBefore = JSON.stringify(allow.files.filter(f => !written.has(f.path)));
for (const [rel, b] of written) fs.writeFileSync(path.join(PUB, rel), b);
fs.writeFileSync(REG, registry);
allow.files = [...allow.files.filter(f => !written.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !written.has(f.path))) !== othersBefore) fail('another allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json (2 own entries)`);
