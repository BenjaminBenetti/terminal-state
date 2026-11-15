// Offline partition of the UV-aware private truck cook. Never edits or publishes the private master.
// Run through the task's shared heavy-job runner. Existing paint/normal/metallic-roughness pixels remain byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune, getBounds} from '@gltf-transform/functions';

const root = path.resolve(import.meta.dirname, '../../..');
const input = process.argv[2];
if (!input) throw new Error('Pass the UV-aware private intermediate GLB path; never the master or runtime output');
const source = fs.readFileSync(input), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHash = sha(source);
const previous = JSON.parse(fs.readFileSync(input.replace(/\.glb$/, '.json'), 'utf8'));
if (sourceHash !== previous.output.sha256 || previous.master.sha256 !== '44d12d07e54e49530d74f6e528e40864e0e6e373caa8f93fd772d279e08f6b4a' || !previous.derivative.geometry.includes('attribute-aware')) throw new Error('Unexpected UV-aware truck cook');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(source), r = doc.getRoot();
const textureHashes = r.listTextures().map(t => sha(t.getImage()));

const wheels = [
  {id: 'f1l', x: -0.96, y: 0.52, z: -2.18}, {id: 'f1r', x: 0.96, y: 0.52, z: -2.18},
  {id: 'f2l', x: -0.96, y: 0.52, z: -1.02}, {id: 'f2r', x: 0.96, y: 0.52, z: -1.02},
  {id: 'r1l', x: -0.96, y: 0.52, z: 1.36}, {id: 'r1r', x: 0.96, y: 0.52, z: 1.36},
  {id: 'r2l', x: -0.96, y: 0.52, z: 2.36}, {id: 'r2r', x: 0.96, y: 0.52, z: 2.36},
];
const body = [], glass = [], wheelTris = wheels.map(() => []);
const prims = r.listMeshes().flatMap(m => m.listPrimitives());
if (prims.length !== 1) throw new Error("Expected supplied truck single painted primitive");
const src = prims[0], positions = src.getAttribute('POSITION').getArray(), indices = src.getIndices().getArray();
for (let i = 0; i < indices.length; i += 3) {
  const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
  const x = (positions[ia] + positions[ib] + positions[ic]) / 3;
  const y = (positions[ia + 1] + positions[ib + 1] + positions[ic + 1]) / 3;
  const z = (positions[ia + 2] + positions[ib + 2] + positions[ic + 2]) / 3;
  const ax = positions[ib] - positions[ia], ay = positions[ib + 1] - positions[ia + 1], az = positions[ib + 2] - positions[ia + 2];
  const bx = positions[ic] - positions[ia], by = positions[ic + 1] - positions[ia + 1], bz = positions[ic + 2] - positions[ia + 2];
  const nx = ay * bz - az * by, nz = ax * by - ay * bx;
  const front = Math.abs(x) < 1.01 && y > 1.5 && y < 2.1 && z > -3.4 && z < -3.0 && Math.abs(nz) > Math.abs(nx) * 0.65;
  const side = Math.abs(x) > 0.88 && Math.abs(x) < 1.19 && y > 1.5 && y < 2.1 && z > -3.31 && z < -2.05 && Math.abs(nx) > Math.abs(nz) * 0.65;
  let bucket = body;
  if (front || side) bucket = glass;
  else {
    const wi = wheels.findIndex(w => Math.abs(x - w.x) < 0.27 && Math.hypot(y - w.y, z - w.z) < 0.54 && y < 1.06);
    if (wi >= 0) bucket = wheelTris[wi];
  }
  bucket.push(indices[i], indices[i + 1], indices[i + 2]);
}
if (glass.length < 90 || wheelTris.some(p => p.length < 90)) throw new Error('Truck windows/wheels could not be identified safely');

const buffer = r.listBuffers()[0], scene = r.getDefaultScene() ?? r.listScenes()[0];
for (const n of [...scene.listChildren()]) scene.removeChild(n);
const clear = doc.createMaterial('glass').setBaseColorFactor([0.12, 0.16, 0.15, 0.2]).setMetallicFactor(0).setRoughnessFactor(0.08).setAlphaMode('BLEND').setDoubleSided(true);
function part(name, list, material, centre = [0, 0, 0]) {
  const unique = [], remap = new Map(), idx = [];
  for (const i of list) { if (!remap.has(i)) {remap.set(i, unique.length); unique.push(i);} idx.push(remap.get(i)); }
  const p = doc.createPrimitive().setMaterial(material);
  for (const semantic of src.listSemantics()) {
    const old = src.getAttribute(semantic), input = old.getArray(), size = old.getElementSize(), out = new input.constructor(unique.length * size);
    for (let i = 0; i < unique.length; i++) for (let k = 0; k < size; k++) out[i * size + k] = input[unique[i] * size + k] - (semantic === 'POSITION' ? centre[k] ?? 0 : 0);
    p.setAttribute(semantic, doc.createAccessor().setType(old.getType()).setNormalized(old.getNormalized()).setArray(out).setBuffer(buffer));
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(unique.length <= 65535 ? Uint16Array.from(idx) : Uint32Array.from(idx)).setBuffer(buffer));
  const mesh = doc.createMesh(name).addPrimitive(p), node = doc.createNode(name).setMesh(mesh).setTranslation(centre);
  scene.addChild(node);
}
part('surface-truck-body', body, src.getMaterial());
part('surface-truck-glass', glass, clear);
wheels.forEach((w, i) => part(`surface-truck-wheel-${w.id}`, wheelTris[i], src.getMaterial(), [w.x, w.y, w.z]));
await doc.transform(prune(), dedup());
if (textureHashes.some((h, i) => h !== sha(r.listTextures()[i].getImage()))) throw new Error('PBR maps changed unexpectedly');
r.getAsset().generator = 'Terminal State offline Surface Run truck refinement';
const bytes = Buffer.from(await io.writeBinary(doc)), bb = getBounds(scene);
const output = 'assets/models/surface-military-truck.glb';
const provPath = path.join(root, 'game/public/assets/derivatives/surface-military-truck.json');

previous.derivative = {...previous.derivative,
  triangles: (body.length + glass.length + wheelTris.reduce((n, p) => n + p.length, 0)) / 3,
  dimensionsM: bb.max.map((v, i) => +(v - bb.min[i]).toFixed(4)),
  geometry: previous.derivative.geometry + '; cab-over windshield/side-window and eight wheel triangle partitions; no further simplification, authored PBR pixels retained byte-for-byte',
  priorCook: {bytes: source.length, sha256: sourceHash, triangles: previous.derivative.triangles, preservedPrivately: true},
  parts: {bodyTriangles: body.length / 3, glassTriangles: glass.length / 3, wheels: wheels.map((w, i) => ({...w, triangles: wheelTris[i].length / 3}))},
  textureHashes,
};
previous.output = {url: output, bytes: bytes.length, sha256: sha(bytes)};
fs.writeFileSync(path.join(root, 'game/public', output), bytes);
fs.writeFileSync(provPath, JSON.stringify(previous, null, 2) + '\n');
console.log(JSON.stringify({output: previous.output, derivative: previous.derivative}, null, 2));
