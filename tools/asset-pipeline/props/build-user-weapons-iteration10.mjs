// Iteration 10 (task studio-user-weapons-20261028-01): runtime derivatives of the three USER-SUPPLIED weapon models.
// Reads the read-only masters from .cache/user-weapons-20261028/ (verified by SHA-256), never modifies them, and writes
//   game/public/assets/models/{rifle-user,shotgun-user,pistol}.glb + game/public/assets/derivatives/user-weapons-20261028.json
// Derivative = the game's gun convention: muzzle -Z, +Y up, real-world length, centred; empty marker nodes Grip / Muzzle /
// Sight / Eject (read off gridded side silhouettes of the masters, see the task REPORT); geometry welded + meshopt-simplified
// to a held-weapon density (the masters are 0.33-0.81 M triangles); the embedded 2048 JPEG PBR textures are kept BYTE-EXACT.
// Mapping is by inspected geometry (AR rifle with red dot / compact pistol / pump shotgun), not by upload file name.
// Source provider/settings/licence are NOT verified (upload names mention Meshy; not asserted).
// Usage: node --max-old-space-size=12000 tools/asset-pipeline/props/build-user-weapons-iteration10.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld, simplify, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '../../..');
const SRC = path.join(root, '.cache/user-weapons-20261028');
const OUT = path.join(root, 'game/public/assets/models');
const PROV = path.join(root, 'game/public/assets/derivatives/user-weapons-20261028.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

// Source-space markers (master units, muzzle at -X, +Y up, viewer side +Z = the gun's LEFT side) and target lengths.
const WEAPONS = [
  {key: 'rifle', out: 'rifle-user.glb', src: '8a96a73b667e489cae56561060a9b2e0.glb', srcSha: '3e5c6112be7f3b497063be80e7c024ba7f9ecf40991224edee00528bf468c485',
    uploadName: 'Meshy_AI_Worn_Tactical_Rifle_1028062649_texture.glb', subject: 'AR-style carbine with red-dot sight, vertical foregrip, collapsible stock',
    length: 0.88, ratio: 0.14, markers: {Muzzle: [-0.949, 0.096, 0], Grip: [0.368, -0.162, 0], Sight: [0.029, 0.306, 0], Eject: [0.147, 0.088, -0.04]}},
  {key: 'shotgun', out: 'shotgun-user.glb', src: 'ee901a08d78a4d9f948698bf0328e62a.glb', srcSha: 'b1490e3f9429e585648e1ac272af3998874cdc6271b9b904cc7e5e6f2bf2e48e',
    uploadName: 'Meshy_AI_Rustbound_Repeater_1028062608_texture.glb', subject: 'pump-action shotgun with magazine tube, pump fore-end and full stock',
    length: 0.98, ratio: 0.24, markers: {Muzzle: [-0.941, 0.169, 0], Grip: [0.412, 0.059, 0], Sight: [0.257, 0.218, 0], Eject: [0.059, 0.132, -0.05]}},
  {key: 'pistol', out: 'pistol.glb', src: '97d4f008457a4b77925eb5439d66f866.glb', srcSha: 'e3f4a6626ae6c369c3bdf59ab89abf3a5b07a99373d1291c748ec888f28e5ae5',
    uploadName: 'Meshy_AI_Worn_Tactical_Pistol_1028062601_texture.glb', subject: 'compact striker-style semi-automatic pistol',
    length: 0.185, ratio: 0.13, markers: {Muzzle: [-0.941, 0.472, 0], Grip: [0.559, -0.212, 0], Sight: [0.743, 0.685, 0], Eject: [-0.088, 0.568, -0.12]}},
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const prov = {schema: 'last-line-derivative/1', asset: 'user-weapons-20261028', task: 'studio-user-weapons-20261028-01',
  status: 'runtime derivatives of user-supplied models; source provider/settings/licence NOT verified (upload names mention Meshy — not asserted); no licence clearance implied',
  rebuild: 'node --max-old-space-size=12000 tools/asset-pipeline/props/build-user-weapons-iteration10.mjs',
  convention: 'muzzle -Z, +Y up, metres, centred at the source origin; game = rotateY(-90deg) * uniform scale: (x,y,z) -> (-z*s, y*s, x*s); source +Z (gun LEFT side) faces game -X',
  outputs: []};

for (const w of WEAPONS) {
  const srcPath = path.join(SRC, w.src);
  const bytes = fs.readFileSync(srcPath);
  if (sha(bytes) !== w.srcSha) throw new Error(`source SHA mismatch for ${w.src}`);
  const doc = await io.readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  const prim = r.listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  let minX = Infinity, maxX = -Infinity;
  const v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]); }
  const s = w.length / (maxX - minX);
  const srcTris = (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
  const texBefore = r.listTextures().map(t => sha(t.getImage()));
  // weld + simplify (topology-preserving; attributes are UV-aware through weld; textures untouched)
  await doc.transform(weld({tolerance: 0.0001}), simplify({simplifier: MeshoptSimplifier, ratio: w.ratio, error: 0.0008, lockBorder: true}), dedup(), prune());
  // bake orientation + scale into the mesh node; centre stays at the source origin
  const node = r.listNodes().find(n => n.getMesh());
  node.setName(w.key).setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2]).setScale([s, s, s]).setTranslation([0, 0, 0]);
  r.listMeshes()[0].setName(w.key);
  const mat = r.listMaterials()[0]; if (!mat.getName()) mat.setName(`${w.key}-user`);
  const scene = r.listScenes()[0] ?? r.getDefaultScene();
  const markersGame = {};
  for (const [name, [x, y, z]] of Object.entries(w.markers)) {
    const g = [-z * s, y * s, x * s];
    markersGame[name] = g.map(n => +n.toFixed(5));
    scene.addChild(doc.createNode(name).setTranslation(g));
  }
  const outPrim = r.listMeshes()[0].listPrimitives()[0];
  const outTris = (outPrim.getIndices()?.getCount() ?? 0) / 3;
  const texAfter = r.listTextures().map(t => sha(t.getImage()));
  if (JSON.stringify(texBefore) !== JSON.stringify(texAfter)) throw new Error('texture bytes changed');
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(OUT, w.out), glb);
  prov.outputs.push({key: w.key, subject: w.subject, uploadName: w.uploadName,
    source: {file: `.cache/user-weapons-20261028/${w.src} (ignored master; byte-exact originals also kept by Main)`, sha256: w.srcSha, bytes: bytes.length, triangles: srcTris, vertices: pos.getCount(), extentX: +(maxX - minX).toFixed(4)},
    output: {file: `game/public/assets/models/${w.out}`, sha256: sha(glb), bytes: glb.length, triangles: outTris, vertices: outPrim.getAttribute('POSITION').getCount()},
    lengthM: w.length, scale: +s.toFixed(6), simplify: {ratio: w.ratio, error: 0.0008, lockBorder: true, simplifier: 'meshoptimizer (MeshoptSimplifier)'},
    textures: r.listTextures().map((t, i) => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: texAfter[i], note: 'embedded source texture, byte-exact'})),
    markersSource: w.markers, markersGame});
  console.log(`${w.key}: ${srcTris} -> ${outTris} tris, ${glb.length} B, scale ${s.toFixed(5)}`);
}
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log('wrote', PROV);
