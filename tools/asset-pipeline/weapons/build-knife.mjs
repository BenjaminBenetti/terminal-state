// Task studio-knife-melee-20261030-01 (lane KNIFE): runtime derivative of the USER-UPLOADED survival knife (the game's
// first melee weapon). Reads the read-only upload from .cache/user-knife-20261030/ (verified by SHA-256), never modifies it,
// and writes game/public/assets/models/knife-user.glb + game/public/assets/derivatives/user-knife-20261030.json.
//
// Derivative = the game's held-weapon convention (as the user guns, build-user-weapons-iteration10.mjs):
//   tip -Z (forward), +Y up = serrated SPINE up / cutting EDGE down, blade flats facing ±X, metres, real knife length;
//   PIVOT AT THE HAND: the mesh node is translated so the grip centre (middle of the handle, on its axis) is the origin;
//   empty marker nodes `Grip` (0, 0, 0) and `Tip` (blade point). No `Muzzle` (not a gun).
// Source frame (inspected renders + vertex profile): blade tip at -X, pommel at +X, spine +Y, edge -Y; handle on the X axis.
// Mapping source -> game = rotateY(-90deg) * uniform scale s, then minus the grip: (x, y, z) -> (-z s, y s, x s) - grip.
// Geometry: welded + meshopt-simplified to a first-person viewmodel density (source 72,790 tris); the serrated spine and
// the clip-point silhouette are kept by an error bound (see SIMPLIFY). Textures: the embedded 2048 JPEG base colour /
// metallic-roughness / normal maps resized to 1024 (lanczos3, JPEG); the emissive map is all black (max 3/255) with
// emissiveFactor 1 — it is dropped and emissiveFactor set to 0 (no visible change, one less texture).
// Provenance: a user upload (user-supplied original filename mentions Meshy; the filename and the embedded generator
// field are NOT provider / licence proof — not asserted). Generation 0: no generation service was called.
//
// Usage: node tools/asset-pipeline/weapons/build-knife.mjs [--out <dir>] [--ratio r] [--error e] [--no-prov]
//   (--out / --ratio / --error are for QA experiments; the committed derivative uses the defaults below.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld, simplify, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

const SOURCE = {
  file: '.cache/user-knife-20261030/4fde1d8eef60486296922bef05dd2a98.glb',
  sha256: 'f82d48727f3720f387490900fa36a690fd519d0a3b4ebbfcfbd4635b53e03d4b',
  bytes: 10_951_220,
  uploadName: 'Meshy_AI_Survival_Knife_1030034338_texture.glb',
};
/** Real overall length (tip to pommel), metres: a ~7.6" clip-point blade survival knife. */
const LENGTH_M = 0.32;
/**
 * Source-space markers (source units). Grip = middle of the handle (x 0.316 guard back .. 0.83 pommel front) on the
 * handle axis (y / z centre of the handle rings). Tip = the blade point (min-X vertex, measured at build time).
 */
const GRIP_SOURCE = [0.573, -0.001, 0];
/** meshopt simplification: ratio of the welded source triangles, bounded by a relative error (keeps the serrations). */
const SIMPLIFY = {ratio: 0.085, error: 0.0012, lockBorder: true};
const TEXTURE_MAX = 1024;
const JPEG_QUALITY = 88;

const OUT_DIR = path.resolve(arg('--out', path.join(root, 'game/public/assets/models')));
const OUT_FILE = path.join(OUT_DIR, 'knife-user.glb');
const PROV = path.join(root, 'game/public/assets/derivatives/user-knife-20261030.json');
const ratio = Number(arg('--ratio', SIMPLIFY.ratio));
const error = Number(arg('--error', SIMPLIFY.error));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const bytes = fs.readFileSync(path.join(root, SOURCE.file));
if (bytes.length !== SOURCE.bytes || sha(bytes) !== SOURCE.sha256) throw new Error('knife source size / SHA-256 mismatch — refusing to build');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.readBinary(new Uint8Array(bytes));
const r = doc.getRoot();
if (r.listMeshes().length !== 1 || r.listMeshes()[0].listPrimitives().length !== 1) throw new Error('expected one mesh / one primitive');
const prim = r.listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const v = [0, 0, 0];
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
let tip = null;
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v);
  for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  if (!tip || v[0] < tip[0]) tip = [...v];
}
const srcTris = (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
const srcVerts = pos.getCount();
const extent = [0, 1, 2].map(k => max[k] - min[k]);
if (!(extent[0] > extent[1] * 3 && extent[0] > extent[2] * 3)) throw new Error('expected the knife along source X');
const s = LENGTH_M / extent[0];

// --- geometry: weld + simplify (topology-preserving, UV / normal / tangent aware); textures untouched here
await doc.transform(weld({tolerance: 0.0001}), simplify({simplifier: MeshoptSimplifier, ratio, error, lockBorder: SIMPLIFY.lockBorder}), dedup(), prune());

// --- material / textures: resize to TEXTURE_MAX (JPEG), drop the black emissive map
const mat = r.listMaterials()[0];
mat.setName('knife-user');
const emissive = mat.getEmissiveTexture();
let emissiveNote = 'none';
if (emissive) {
  const st = await sharp(Buffer.from(emissive.getImage())).stats();
  const peak = Math.max(...st.channels.slice(0, 3).map(c => c.max));
  if (peak > 8) throw new Error(`emissive map is not black (peak ${peak}); refusing to drop it`);
  mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
  emissiveNote = `dropped: the source emissive map is black (peak ${peak}/255, emissiveFactor 1) -> emissiveFactor 0, no visible change`;
}
await doc.transform(prune());
const textures = [];
const slotOf = t => (mat.getBaseColorTexture() === t ? 'baseColor' : mat.getMetallicRoughnessTexture() === t ? 'metallicRoughness' : mat.getNormalTexture() === t ? 'normal' : 'other');
for (const t of r.listTextures()) {
  const src = Buffer.from(t.getImage());
  const [w, h] = t.getSize();
  const srcSha = sha(src);
  const scale = Math.min(1, TEXTURE_MAX / Math.max(w, h));
  const out = scale < 1
    ? await sharp(src).resize(Math.round(w * scale), Math.round(h * scale), {kernel: 'lanczos3'}).jpeg({quality: JPEG_QUALITY, chromaSubsampling: '4:4:4'}).toBuffer()
    : src;
  t.setImage(new Uint8Array(out)).setMimeType('image/jpeg');
  const slot = slotOf(t);
  t.setName(`knife-${slot}`);
  textures.push({slot, source: {size: [w, h], bytes: src.length, sha256: srcSha}, size: t.getSize(), mime: 'image/jpeg', bytes: out.length, sha256: sha(out),
    note: scale < 1 ? `resized ${w} -> ${Math.round(w * scale)} (sharp lanczos3, JPEG q${JPEG_QUALITY} 4:4:4)` : 'source bytes, unchanged'});
}

// --- orientation / scale / pivot baked into the mesh node: rotateY(-90deg), uniform s, grip at the origin
const R = ([x, y, z]) => [-z, y, x];
const gripGame = R(GRIP_SOURCE).map(n => n * s);
const node = r.listNodes().find(n => n.getMesh());
node.setName('knife').setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([s, s, s]).setTranslation(gripGame.map(n => -n));
r.listMeshes()[0].setName('knife');
const scene = r.listScenes()[0] ?? r.getDefaultScene();
const markersSource = {Grip: GRIP_SOURCE, Tip: tip.map(n => +n.toFixed(4))};
const markersGame = {};
for (const [name, p] of Object.entries(markersSource)) {
  const g = R(p).map((n, k) => +(n * s - gripGame[k]).toFixed(5));
  markersGame[name] = g.map(n => (Object.is(n, -0) ? 0 : n));
  scene.addChild(doc.createNode(name).setTranslation(markersGame[name]));
}

const outPrim = r.listMeshes()[0].listPrimitives()[0];
const outTris = (outPrim.getIndices()?.getCount() ?? 0) / 3;
const outPos = outPrim.getAttribute('POSITION');
// game-space bounds (metres, grip pivot at the origin)
const gmin = [Infinity, Infinity, Infinity], gmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < outPos.getCount(); i++) {
  outPos.getElement(i, v);
  const g = R(v).map((n, k) => n * s - gripGame[k]);
  for (let k = 0; k < 3; k++) { gmin[k] = Math.min(gmin[k], g[k]); gmax[k] = Math.max(gmax[k], g[k]); }
}
fs.mkdirSync(OUT_DIR, {recursive: true});
const glb = await io.writeBinary(doc);
fs.writeFileSync(OUT_FILE, glb);
console.log(`knife: ${srcTris} -> ${outTris} tris (ratio ${ratio}, error ${error}), ${glb.length} B, scale ${s.toFixed(6)}, bounds ${gmin.map(n => n.toFixed(4))} .. ${gmax.map(n => n.toFixed(4))}`);

if (!process.argv.includes('--no-prov') && OUT_DIR === path.join(root, 'game/public/assets/models')) {
  const prov = {
    schema: 'last-line-derivative/1', asset: 'user-knife-20261030', task: 'studio-knife-melee-20261030-01', generation: 0,
    status: 'runtime derivative of a USER-UPLOADED model (the user identifies it as a knife and authorized it as the first melee weapon); '
      + 'source provider / settings / licence NOT verified — the upload filename and embedded generator field are not provider or licence proof; no licence clearance implied',
    rebuild: 'node tools/asset-pipeline/weapons/build-knife.mjs',
    convention: 'tip -Z, +Y up (serrated spine up, edge down), blade flats facing ±X, metres; PIVOT = grip centre at the origin; '
      + 'game = rotateY(-90deg) * uniform scale - grip: (x,y,z) -> (-z*s, y*s, x*s) - Grip; markers Grip (0,0,0) and Tip',
    subject: 'combat / survival knife: dark blackened clip-point blade with serrated spine, cross guard, olive-green ridged grip, steel pommel with lanyard hole',
    source: {file: `${SOURCE.file} (ignored worker copy; the canonical upload, same SHA-256, is kept by Main in the user-upload store, untouched)`, uploadName: SOURCE.uploadName,
      sha256: SOURCE.sha256, bytes: SOURCE.bytes, triangles: srcTris, vertices: srcVerts, extent: extent.map(n => +n.toFixed(4)), axes: 'tip -X, pommel +X, spine +Y, edge -Y'},
    output: {file: 'game/public/assets/models/knife-user.glb', sha256: sha(glb), bytes: glb.length, triangles: outTris, vertices: outPos.getCount(),
      boundsM: {min: gmin.map(n => +n.toFixed(4)), max: gmax.map(n => +n.toFixed(4))}, lengthM: +(gmax[2] - gmin[2]).toFixed(4)},
    lengthM: LENGTH_M, scale: +s.toFixed(6),
    simplify: {ratio, error, lockBorder: SIMPLIFY.lockBorder, weldTolerance: 0.0001, simplifier: 'meshoptimizer (MeshoptSimplifier) via glTF-Transform simplify'},
    material: {name: 'knife-user', note: 'source PBR material kept (base colour, metallic-roughness, normal; opaque, double-sided)', emissive: emissiveNote},
    textures, markersSource, markersGame,
  };
  fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
  console.log('wrote', path.relative(root, PROV));
}
