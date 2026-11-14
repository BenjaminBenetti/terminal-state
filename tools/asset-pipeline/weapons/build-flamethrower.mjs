// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the runtime model of the FLAMETHROWER ("Weed burner": a scrap-built
// burner lance — shoulder rest, rubber grip with a brass squeeze lever, a red valve body with a gauge, a perforated heat shield and a
// wide burner bell) from its Meshy T2.5 smart-topology image-to-3D original, conditioned on one Codex INITIAL design image (a strict
// side view; route Codex -> Meshy). Nothing is generated, re-textured or replaced here: the model's own geometry and PBR maps are kept
// (maps only downsized / re-encoded), as the weapon-variety and Turnstile cooks.
//
// Reads (never modifies) the PRIVATE raw original outside Git (--master <glb>; default: the task's raw under TS_REFERENCE_ROOT, else under
// the first ancestor of the repository that holds the task folder). Its sha256 + bytes must equal the record below: a different file
// stops the cook. The raw never ships and is never copied into the repository; the public provenance names only its hashes and
// measurements.
//
// Derivative = the game's held-weapon convention (weapons/build-weapon-variety.mjs, build-turnstile.mjs; read by weapons/viewmodel.ts):
// metres, +Y up, forward = -Z, the weapon's right side +X.
//   Source frame (measured on every run: the wide round bell end must be at raw -X): burner bell at raw -X, +Y up, the design image's
//   visible side (the weapon's RIGHT side) facing raw -Z. Game = rotateY(-90deg) * uniform scale: (x, y, z) -> (-z s, y s, x s). s = the
//   real overall length (0.95 m: shoulder rest to the bell's mouth) / the Z extent. The bounding box is centred on the origin; empty
//   marker nodes Grip (the firing hand: the rear rubber grip, over the brass squeeze lever) / Muzzle (the centre of the burner bell's
//   mouth plane: the flame starts here) / Sight (the top of the pressure gauge, the model's highest point: it only anchors the hip pose —
//   this weapon has no aimed pose) / Fore (the front vertical handle: the second hand).
// Geometry: an exact-attribute weld (lossless) and ONE recorded repair — a stray thread of five long sliver triangles between the hose
// end and the front handle's foot (a reconstruction artefact; SPEC.thread) is removed. NO simplification (20.2k triangles: a held-weapon
// first-person density), no moving parts (one mesh). Maps: Meshy's 2048 px JPEGs; the base colour is kept byte-exact, the
// metallic-roughness / normal maps downsized to 1024 (sharp lanczos3, JPEG 4:4:4) — the weapon-variety guns' budget.
//
// Writes deterministically:
//   game/public/assets/models/weapon-flamethrower.glb           one mesh node + the marker nodes, ONE material
//   game/public/assets/derivatives/weapon-flamethrower.json     public provenance (hashes / measurements only: no paths, names or tokens)
//   game/src/assets/flamethrowerModels.generated.ts             FLAMETHROWER_MODEL (weapons/flamethrower.ts, weapons/lazyWeaponModels.ts)
//   game/public/assets/CREDITS.md                               its marked section
//   tools/release/public-inputs.json                            ONLY this script's two entries + CREDITS.md added / updated
//
//   node tools/asset-pipeline/weapons/build-flamethrower.mjs [--master <glb>] [--dry-run <scratch dir>] [--islands]
//   (--dry-run writes the GLB + provenance + a registry preview only into the scratch dir; --islands prints the model's islands in the
//   game frame, for authoring)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {boundsOf, compact, inBox, islands, r4, r5, r6, resolveMarkers, slab, weld} from './lib/weapon-cook.mjs';

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
const REG = path.join(root, 'game/src/assets/flamethrowerModels.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN flamethrower-model-20261114 (build-flamethrower.mjs) -->';
const CREDITS_END = '<!-- END flamethrower-model-20261114 -->';
/** A new section goes right after this one (the other Codex -> Meshy survival gear); at the end of the file when it is missing. */
const CREDITS_AFTER = '<!-- END train-fuel-and-airtank-models -->';
const SELF = 'tools/asset-pipeline/weapons/build-flamethrower.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const W = {asset: 'FLAMETHROWER', itemId: 'flamethrower', slug: 'flamethrower', name: 'Flamethrower', kind: 'gun', length: 0.95};
const TASK = {
  id: 'studio-flamethrower-fire-20261114-031614-01',
  grant: '63caa2a0-d8b5-44c0-9b69-fa4eb22585e2',
  /** The private raw original's record (size / sha256 checked on every run): the job ledger's row R001. */
  master: {sha256: '9cbc8b549385f89ef38f42a39f776a41120e13de470617c5a5757e097c740416', bytes: 8890976, ledgerRow: 'R001'},
  meshy: {task: '01a1d827-b0b0-769e-b5f4-748d2528597c', billedCredits: 15, attempt: 1,
    request: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 20000, target_formats: ['glb']}},
  /** The Codex INITIAL design image Meshy was conditioned on (outside Git; a reference here, not an input of this cook). */
  conditioningImage: {sha256: '5253e16be523cf856ed0419f9496bac4377c4a082e773d67cfd0aa74d7fe2de9', bytes: 1641163, size: '2172x724'},
  route: 'Codex native image_gen INITIAL design image (a strict side view: shoulder rest at the left, burner bell at the right) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); the Meshy model keeps its own PBR maps (re-encoded only)',
  licence: 'generated for this project under the existing provider accounts; unapproved prototype asset, no blanket licence or commercial clearance implied (assets/CREDITS.md)',
};
const MASTER = path.resolve(arg('--master') ?? path.join(REF_ROOT, TASK_DIR, `gen/raw/${W.asset}-${TASK.master.ledgerRow}-${TASK.meshy.task}.glb`));

/** Source frame -> game frame (before scale): the bell raw -X -> game -Z; the right side raw -Z -> game +X. */
const ROT = ([x, y, z]) => [-z, y, x];
const ROT_TEXT = 'rotateY(-90deg): (x, y, z) -> (-z, y, x); raw -X (the burner bell) -> game -Z, raw -Z (the design image\'s visible = the weapon\'s RIGHT side) -> game +X';
/** Thickness probe: the bell mouth's X / Y cross-section ratio outside this band would need a recorded correction. */
const ROUND_BAND = [0.85, 1.18];
const TEX = {baseColor: 2048, metallicRoughness: 1024, normal: 1024};
const JPEG = {baseColor: {quality: 90, chromaSubsampling: '4:4:4'}, metallicRoughness: {quality: 90, chromaSubsampling: '4:4:4'}, normal: {quality: 92, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];

/**
 * The recorded processing (inspected on the raw; metres in the CENTRED game frame at 0.95 m). Islands (70; largest first): the burner
 * bell + heat shield (8140 triangles, z -0.475 .. 0.0005), the rear rubber grip sleeve (1551: x +-0.0153, y -0.0019 .. 0.0341,
 * z 0.2205 .. 0.3139), the front handle + lever guard + hose (1491, joined only by the stray thread), the shoulder rest, the T-piece,
 * the stock tube, the pilot tube, the brass squeeze lever, the red button, the pressure gauge (318: x +-0.0066, y 0.0642 .. 0.1114,
 * z 0.1426 .. 0.1918), clamps, the valve body (y up to 0.0511) and its bolts.
 */
const SPEC = {
  /** The orientation check: the bell (front, -Z) end is a wide round mouth, the shoulder-rest (rear) end a narrow upright pad. */
  ends: {band: 0.01, bellMinWidth: 0.1, restMaxWidth: 0.07},
  round: {z: [-0.4751, -0.465]}, roundPart: 'the burner bell\'s mouth rim (round)',
  /**
   * The stray thread: five long sliver triangles that run under the weapon from the hose's end fitting to the centre of the front
   * handle's foot (two of them a 3 cm spike off the fitting), a reconstruction artefact that reads as a wire between the two. Selected
   * as the triangles lying wholly inside the box whose Z extent exceeds `minSpanZ` (the handle foot's and the fitting's own cap
   * triangles are all shorter).
   */
  thread: {box: {min: [-0.006, -0.1125, 0.03], max: [0.006, -0.1065, 0.152]}, minSpanZ: 0.02, expect: {tris: 5}},
  grip: {box: {min: [-0.016, -0.003, 0.2204], max: [0.016, 0.035, 0.314]}, expect: {tris: 1551}},
  gauge: {box: {min: [-0.008, 0.063, 0.14], max: [0.008, 0.113, 0.194]}, expect: {tris: 318}},
  fore: {box: {min: [-0.024, -0.113, 0.012], max: [0.024, 0.008, 0.06]}, expect: {tris: 566}},
  markerNotes: 'Grip: the centre of the rear rubber grip sleeve (the firing hand wraps the lance there, its fingers on the brass squeeze lever underneath); Muzzle: the centre of the burner bell\'s mouth plane (the open bell\'s rim: the flame starts here); Sight: the top centre of the pressure gauge on the valve body, the model\'s highest point (it anchors the hip pose only: the weapon has no aimed pose); Fore: the centre of the front vertical handle (the second hand)',
};

const fail = m => { throw new Error(`${W.asset}: ${m}`); };

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
if (!(rawExtent[0] > rawExtent[1] * 2 && rawExtent[0] > rawExtent[2] * 2)) fail(`expected the lance along raw X (${rawExtent})`);

// ---------- geometry ----------
const welded = weld(raw.m);
/** The centred game frame: rotation, uniform length fit, centring; the ends and the bell's roundness measured. */
const g = (() => {
  const m0 = welded.m, nv = m0.P.length / 3, P = new Float64Array(nv * 3), N = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = ROT([m0.P[3 * v], m0.P[3 * v + 1], m0.P[3 * v + 2]]), n = ROT([m0.N[3 * v], m0.N[3 * v + 1], m0.N[3 * v + 2]]);
    for (let k = 0; k < 3; k++) { P[3 * v + k] = p[k]; N[3 * v + k] = n[k]; }
  }
  const b0 = boundsOf(P), s = W.length / (b0.max[2] - b0.min[2]), c0 = [0, 1, 2].map(k => (b0.min[k] + b0.max[k]) / 2);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) P[3 * v + k] = (P[3 * v + k] - c0[k]) * s;
  const m = {P, N, UV: m0.UV, I: m0.I}, b = boundsOf(P);
  const front = slab(m, {z: [b.min[2], b.min[2] + SPEC.ends.band]}), rear = slab(m, {z: [b.max[2] - SPEC.ends.band, b.max[2]]});
  const ends = {bandM: SPEC.ends.band, front: {x: r4(front.max[0] - front.min[0]), y: r4(front.max[1] - front.min[1])}, rear: {x: r4(rear.max[0] - rear.min[0]), y: r4(rear.max[1] - rear.min[1])}};
  if (!(ends.front.x >= SPEC.ends.bellMinWidth && ends.rear.x <= SPEC.ends.restMaxWidth)) fail(`the burner bell is not at raw -X (front end ${ends.front.x} m wide, rear end ${ends.rear.x} m): inspect the raw before changing the rotation`);
  const sl = slab(m, SPEC.round);
  const probe = {n: sl.n, x: r4(sl.max[0] - sl.min[0]), y: r4(sl.max[1] - sl.min[1]), ratioXY: r4((sl.max[0] - sl.min[0]) / (sl.max[1] - sl.min[1]))};
  if (probe.ratioXY < ROUND_BAND[0] || probe.ratioXY > ROUND_BAND[1]) fail(`bell mouth X / Y ${probe.ratioXY} outside ${ROUND_BAND.join(' - ')}: a thickness correction would have to be recorded`);
  return {m, scale: s, ends, thickness: {probe: SPEC.round, part: SPEC.roundPart, after: probe, factorX: 1, band: ROUND_BAND}};
})();

/** The stray thread removed (SPEC.thread): whole triangles dropped, nothing cut, moved or added; vertices only they used go with them. */
const repaired = (() => {
  const {P, N, UV, I} = g.m, T = SPEC.thread, keep = [], gone = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]], z = v.map(i => P[3 * i + 2]);
    const inside = v.every(i => [0, 1, 2].every(k => P[3 * i + k] >= T.box.min[k] && P[3 * i + k] <= T.box.max[k]));
    if (inside && Math.max(...z) - Math.min(...z) > T.minSpanZ) gone.push(v); else keep.push(...v);
  }
  if (gone.length !== T.expect.tris) fail(`the stray thread: ${gone.length} triangles selected != the recorded ${T.expect.tris}`);
  const used = new Uint8Array(P.length / 3);
  for (const i of keep) used[i] = 1;
  const orphans = new Set(gone.flat().filter(i => !used[i]));
  const b = boundsOf(P, Uint32Array.from(gone.flat()));
  return {m: {P, N, UV, I: Uint32Array.from(keep)},
    rec: {op: 'drop', why: 'a stray thread of long sliver triangles between the hose\'s end fitting and the centre of the front handle\'s foot (a reconstruction artefact that reads as a wire under the weapon)',
      rule: `the triangles lying wholly inside the box min ${JSON.stringify(T.box.min)} max ${JSON.stringify(T.box.max)} (m) whose Z extent exceeds ${T.minSpanZ} m`,
      triangles: gone.length, bounds: {min: b.min.map(r4), max: b.max.map(r4)}, verticesDropped: orphans.size,
      note: 'whole triangles removed; nothing cut, moved or added (a ~3 x 11 mm opening stays on the underside of the hose fitting, where the spike left it); UVs / maps untouched'}};
})();
const mesh = repaired.m;
const isl = islands(mesh);
if (SHOW_ISLANDS) {
  console.log(`${W.asset} islands ${isl.length}:`);
  for (const o of isl) console.log(`   ${String(o.tris.length).padStart(6)}  min ${o.min.map(r4).join(', ')}  max ${o.max.map(r4).join(', ')}`);
}

// ---------- markers (measured on the repaired mesh) ----------
/** The largest island lying wholly inside a box (islands are sorted largest first), checked against its recorded triangle count. */
const islandIn = (name, sel) => {
  const hit = isl.filter(o => inBox(o, sel.box));
  if (!hit.length || hit[0].tris.length !== sel.expect.tris) fail(`${name}: the largest island in its box has ${hit[0]?.tris.length} triangles != the recorded ${sel.expect.tris}`);
  return hit[0];
};
const mid = (o, k) => (o.min[k] + o.max[k]) / 2;
const sleeve = islandIn('Grip', SPEC.grip), gauge = islandIn('Sight', SPEC.gauge), handle = islandIn('Fore', SPEC.fore);
const front = resolveMarkers(W, mesh, {Muzzle: {front: {}}});
const boxText = b => `min ${JSON.stringify(b.min)} max ${JSON.stringify(b.max)} (m)`;
const islandRec = o => ({triangles: o.tris.length, bounds: {min: o.min.map(r4), max: o.max.map(r4)}});
const markerRules = {
  Grip: {rule: `the bounds centre of the rear rubber grip sleeve: the largest island lying inside the box ${boxText(SPEC.grip.box)}`, island: islandRec(sleeve)},
  Muzzle: front.rules.Muzzle,
  Sight: {rule: `the top centre of the pressure gauge: x / z = the bounds centre, y = the top of the largest island lying inside the box ${boxText(SPEC.gauge.box)}`, island: islandRec(gauge)},
  Fore: {rule: `the bounds centre of the front vertical handle: the largest island lying inside the box ${boxText(SPEC.fore.box)} (its own island once the stray thread is gone)`, island: islandRec(handle)},
};
const markers = Object.fromEntries(Object.entries({
  Grip: [mid(sleeve, 0), mid(sleeve, 1), mid(sleeve, 2)], Muzzle: front.markers.Muzzle,
  Sight: [mid(gauge, 0), gauge.max[1], mid(gauge, 2)], Fore: [mid(handle, 0), mid(handle, 1), mid(handle, 2)],
}).map(([k, p]) => [k, p.map(r5)]));
{
  const b = boundsOf(mesh.P, mesh.I), M = markers;
  if (M.Muzzle[2] !== r5(b.min[2])) fail('the Muzzle is not on the front face');
  if (Math.hypot(M.Muzzle[0], M.Muzzle[1] - M.Grip[1]) > 0.02) fail('the bell mouth\'s centre is more than 2 cm off the lance axis through the Grip');
  if (!(M.Grip[2] > M.Fore[2] && M.Fore[2] > M.Muzzle[2] && M.Sight[2] < M.Grip[2] && M.Sight[2] > M.Fore[2])) fail('marker order along the lance (Muzzle < Fore < Sight < Grip in z) broken');
  if (M.Sight[1] !== r5(b.max[1])) fail('the Sight (gauge top) is not the model\'s highest point');
}

// ---------- maps: the model's own, kept / downsized + re-encoded ----------
const maps = {images: {}, recs: []};
for (const slot of SLOTS) {
  const t = raw.textures[slot], img = Buffer.from(t.getImage()), [sw, sh] = t.getSize(), px = TEX[slot];
  let out, note;
  if (sw === px && sh === px && t.getMimeType() === 'image/jpeg') { out = img; note = `Meshy's ${sw} px JPEG, byte-exact`; }
  else {
    out = await sharp(img, {limitInputPixels: false}).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
    note = `Meshy's ${sw} px map downsized to ${px} (sharp lanczos3, JPEG q${JPEG[slot].quality} ${JPEG[slot].chromaSubsampling})`;
  }
  maps.images[slot] = out;
  maps.recs.push({slot, source: {size: [sw, sh], mime: t.getMimeType(), bytes: img.length, sha256: sha(img)}, size: [px, px], mime: 'image/jpeg', bytes: out.length, sha256: sha(out), note});
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
{
  const {P, N, UV, I} = compact(mesh, mesh.I);
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', UV))
    .setIndices(acc('SCALAR', P.length / 3 < 65536 ? Uint16Array.from(I) : Uint32Array.from(I)));
  scene.addChild(doc.createNode(W.itemId).setMesh(doc.createMesh(W.itemId).addPrimitive(prim)));
}
for (const [name, p] of Object.entries(markers)) scene.addChild(doc.createNode(name).setTranslation(p));
doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
const glb = Buffer.from(await io.writeBinary(doc));
const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
const sourceName = text => raw.names.find(n => text.toLowerCase().includes(n.toLowerCase()));
if (/https?:|Signature|X-Amz|token|_texture\.glb/i.test(json) || sourceName(json)) fail('URL / token / a source name string inside the glTF JSON');

// ---------- verify the written bytes + measure on them ----------
const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3) fail('not one material with three maps');
const all = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
let tris = 0, verts = 0;
for (const node of chk.listNodes()) {
  const m = node.getMesh();
  if (!m) continue;
  if (node.getName() !== W.itemId) fail(`unexpected mesh node ${node.getName()}`);
  const prim = m.listPrimitives()[0], pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  tris += prim.getIndices().getCount() / 3; verts += pos.getCount();
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { all.min[k] = Math.min(all.min[k], v[k]); all.max[k] = Math.max(all.max[k], v[k]); } }
}
const length = r4(all.max[2] - all.min[2]);
if (Math.abs(length - W.length) > 2e-4) fail(`written length ${length} != ${W.length}`);
if (tris !== raw.tris - repaired.rec.triangles) fail(`triangles ${tris} != the source's ${raw.tris} - the ${repaired.rec.triangles} recorded`);
for (const name of Object.keys(markers)) if (!chk.listNodes().some(n => n.getName() === name && !n.getMesh())) fail(`marker node ${name} missing`);
const dims = [0, 1, 2].map(k => r4(all.max[k] - all.min[k]));
const bounds = {min: all.min.map(r4), max: all.max.map(r4)};
if (bounds.min.some((v, k) => Math.abs(v + bounds.max[k]) > 2e-4)) fail('the bounding box is not centred on the origin');
console.log(`${W.asset} ${W.itemId}: ${raw.tris} tris -> ${tris} (weld ${welded.info.verticesBefore} -> ${welded.info.verticesAfter} verts; ${verts} written), dims ${dims.join(' x ')} m, scale ${r6(g.scale)}, ` +
  `bell X/Y ${g.thickness.after.ratioXY}; ${glb.length} B; maps ${maps.recs.map(t => `${t.slot} ${t.source.size[0]} -> ${t.size[0]} ${t.bytes}`).join(', ')}; ` +
  `markers ${Object.entries(markers).map(([k, v]) => `${k} ${v.join(',')}`).join(' | ')}`);

// ---------- public provenance (hashes and measurements only) ----------
const url = `assets/models/weapon-${W.slug}.glb`, provRel = `assets/derivatives/weapon-${W.slug}.json`;
const prov = {
  schema: 'terminal-state-derivative-v1', id: `weapon-${W.slug}`, itemId: W.itemId, name: W.name, kind: W.kind,
  role: 'held / pickup / icon model of the Flamethrower (a stream weapon, crafted at the train\'s bench or bought at a Market gun stall; not a weapon-variety identity, never a find)',
  task: TASK.id,
  approval: `task-specific user generation grant ${TASK.grant} (a scoped cap of 75 Meshy credits); this model: ${TASK.meshy.billedCredits} credits, the first attempt of its design image`,
  route: TASK.route,
  conditioningImage: {...TASK.conditioningImage, generator: 'Codex CLI built-in image_gen (ChatGPT login); image model id not reported', note: 'the INITIAL design image (kept outside Git): a reference only, not an input of this cook'},
  meshy: {tool: 'mcp__meshy__meshy_image_to_3d (the project\'s Meshy MCP entry)', task: TASK.meshy.task, request: TASK.meshy.request, status: 'SUCCEEDED',
    billedCredits: TASK.meshy.billedCredits, attempt: TASK.meshy.attempt, ledgerRow: TASK.master.ledgerRow,
    evidence: 'the exact create arguments, the charge, the price evidence and the raw hash are in the job ledger kept outside Git'},
  source: {kind: 'the Meshy raw original: kept outside Git, read-only and never shipped', sha256: TASK.master.sha256, bytes: TASK.master.bytes,
    triangles: raw.tris, vertices: raw.verts, extent: rawExtent, axes: 'the burner bell at -X, +Y up, the weapon\'s right side (the design image\'s visible side) facing -Z',
    material: raw.material, maps: raw.maps, droppedAttributes: raw.extraSemantics},
  processing: {
    weld: {...welded.info, rule: 'exact-attribute weld (bitwise-equal position / normal / uv), degenerate triangles and unreferenced vertices dropped: lossless'},
    simplify: 'none: the model\'s triangle count is kept (held-weapon first-person density)',
    rotation: ROT_TEXT, orientationCheck: {...g.ends, rule: `the front (-Z) end band must be >= ${SPEC.ends.bellMinWidth} m wide (the bell) and the rear end band <= ${SPEC.ends.restMaxWidth} m (the shoulder rest)`},
    lengthM: W.length, uniformScale: r6(g.scale),
    lengthRule: 'uniform scale so the overall Z extent (shoulder rest to the bell\'s mouth) = 0.95 m: a two-handed burner lance; the bell is then 125 mm across, the heat shield 50 mm, the rear grip sleeve 31 mm',
    thickness: g.thickness, origin: 'the bounding box centred on the origin',
    ops: [repaired.rec], parts: [], markers: markerRules, markerNotes: SPEC.markerNotes,
  },
  output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: tris, vertices: verts, dims, bounds,
    nodes: {body: W.itemId, parts: [], markers: Object.keys(markers)}, markers},
  textures: maps.recs,
  texturePolicy: 'the model\'s own PBR maps kept slot for slot (base colour / metallic-roughness / normal): the 2048 px base colour JPEG byte-exact, the metallic-roughness / normal maps downsized 2048 -> 1024 px and re-encoded (no recolour, tint, re-texture, projection or new art)',
  limitations: [
    'one rigid mesh: the squeeze lever, the valve button and the gauge needle are modelled in place and do not move',
    'the burner bell is an open cone with the nozzle modelled inside; its inner surface carries the reconstruction\'s own texture',
  ],
  convention: 'metres at real size, +Y up, the burner bell toward -Z, the right side +X; bounding box centred on the origin; empty marker nodes Grip / Muzzle / Sight / Fore',
  licence: TASK.licence, rebuild: `node ${SELF} [--master <the private raw original>]`,
};
const provBytes = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{
  const hit = provBytes.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=|reference\/|\/workspace|\/home\/|portal|prompt|_texture\.glb).{0,20}/i);
  if (hit) fail(`URL / token / private path / generation text in the public provenance: ...${hit[0]}...`);
  if (sourceName(provBytes.toString())) fail('a source name string in the public provenance');
}

// ---------- registry ----------
const vec = v => `[${v.map(x => String(r5(x))).join(', ')}]`;
const registry = `// GENERATED by ${SELF} (task ${TASK.id}) — do not edit.
// The Flamethrower: a Meshy T2.5 image-to-3D model of one Codex design image, its own PBR maps kept (base colour 2048 px + metallic-roughness /
// normal 1024 px). Provenance in assets/derivatives/weapon-flamethrower.json. The held-weapon convention of the weapon-variety models (metres,
// +Y up, the burner bell toward -Z, the right side +X, bounding box centred on the origin; the same empty marker nodes exist in the GLB):
// Grip = the firing hand (the rear rubber grip, over the squeeze lever), Muzzle = the centre of the burner bell's mouth plane (the flame
// starts here), Sight = the top of the pressure gauge (the model's highest point: it anchors the hip pose only — no aimed pose), Fore = the
// front vertical handle (the second hand). One rigid mesh: no moving parts.
// A lazily delivered weapon model (weapons/lazyWeaponModels.ts); NOT a weapon-variety identity (weapons/varietyIds.ts) and never a find.
export const FLAMETHROWER_MODEL = {
  itemId: '${W.itemId}', kind: '${W.kind}', url: '${url}', length: ${dims[2]},
  bounds: {min: ${vec(bounds.min)}, max: ${vec(bounds.max)}}, tris: ${tris},
  markers: {${Object.entries(markers).map(([k, v]) => `${k}: ${vec(v)}`).join(', ')}},
  parts: [],
} as const;
`;

const credSection = [CREDITS_BEGIN, '## The Flamethrower', '',
  `Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (the base colour as generated, the other two re-encoded). Task ${TASK.id} under the user's scoped 75-credit grant (${TASK.meshy.billedCredits} credits, a first attempt). AI-generated asset: an unapproved prototype, no licence or commercial clearance implied. The raw master, the design image and the job ledger are kept outside Git.`, '',
  `- \`${url}\` — the Flamethrower (a scrap-built burner lance: shoulder rest, squeeze-lever grip, valve body with a gauge, perforated heat shield, burner bell); runtime derivative by \`${SELF}\` (provenance: \`${provRel}\`; Meshy task ${TASK.meshy.task}).`,
  CREDITS_END].join('\n');

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
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
const credOut = credRe.test(credSrc) ? credSrc.replace(credRe, credSection)
  : credSrc.includes(CREDITS_AFTER) ? credSrc.replace(CREDITS_AFTER, `${CREDITS_AFTER}\n\n${credSection}`)
    : `${credSrc.replace(/\n*$/, '')}\n\n${credSection}\n`;
written.set('assets/CREDITS.md', Buffer.from(credOut));
const othersBefore = JSON.stringify(allow.files.filter(f => !written.has(f.path)));
for (const [rel, b] of written) fs.writeFileSync(path.join(PUB, rel), b);
fs.writeFileSync(REG, registry);
allow.files = [...allow.files.filter(f => !written.has(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !written.has(f.path))) !== othersBefore) fail('another allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json (its own entries + CREDITS.md)`);
