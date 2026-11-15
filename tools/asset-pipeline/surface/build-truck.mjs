// Deterministic offline cook of the private supplied truck. No provider calls.
// Preserve prior derivatives before running; source masters never enter Git/CI/runtime.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune, weld, compactPrimitive, textureCompress, flatten, clearNodeTransform, transformMesh, getBounds} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../../..');
const task = 'surface-run-codex-20261115-200810';
const input = process.argv[2] ?? path.join(root, `reference/tasks/${task}/inputs/user-military-truck-master.glb`);
const output = process.argv[3];
if (!output || !output.endsWith('.glb') || path.resolve(output).startsWith(path.join(root, 'game/public'))) throw Error('Pass a private intermediate .glb output path, outside runtime inputs');
const digest = '44d12d07e54e49530d74f6e528e40864e0e6e373caa8f93fd772d279e08f6b4a';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const raw = fs.readFileSync(input);
if (raw.length !== 144978172 || sha(raw) !== digest) throw Error('Unexpected truck master; refusing cook');
const backup = path.join(root, `reference/tasks/${task}/inputs/user-truck-master.glb`);
if (sha(fs.readFileSync(backup)) !== digest) throw Error('Private staged copy integrity failed');
const evidence = JSON.parse(fs.readFileSync(path.join(root, `reference/tasks/${task}/INPUT-MANIFEST.json`), 'utf8'));
if (!evidence.independentMainBackup || evidence.sha256 !== digest) throw Error('Missing Main durable-backup evidence');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.readBinary(raw), r = doc.getRoot();
await doc.transform(flatten());
for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
const scene = r.getDefaultScene() ?? r.listScenes()[0];
const before = getBounds(scene), scale = 6.8 / (before.max[0] - before.min[0]);
const cx = (before.min[0] + before.max[0]) / 2, cz = (before.min[2] + before.max[2]) / 2;
for (const m of r.listMeshes()) transformMesh(m, [0, 0, scale, 0, 0, scale, 0, 0, -scale, 0, 0, 0, cz * scale, -before.min[1] * scale, -cx * scale, 1]);
// Tiny disagreements in the imported triangle soup must share the same topological positions.
for (const mesh of r.listMeshes()) for (const p of mesh.listPrimitives()) {
  const a = p.getAttribute('POSITION').getArray();
  for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * 2000) / 2000;
}
await doc.transform(weld());
const passes = [];
for (const mesh of r.listMeshes()) for (const p of mesh.listPrimitives()) {
  const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0'), normal = p.getAttribute('NORMAL');
  if (!uv || !normal) throw Error('Supplied PBR UVs/normals required');
  const count = pos.getCount(), attributes = new Float32Array(count * 5), U = uv.getArray(), N = normal.getArray();
  for (let i = 0; i < count; i++) {
    attributes[i * 5] = U[i * 2]; attributes[i * 5 + 1] = U[i * 2 + 1];
    attributes[i * 5 + 2] = N[i * 3]; attributes[i * 5 + 3] = N[i * 3 + 1]; attributes[i * 5 + 4] = N[i * 3 + 2];
  }
  const previous = p.getIndices(), indices = Uint32Array.from(previous.getArray());
  const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, pos.getArray(), 3, attributes, 5,
    [2, 2, 0.3, 0.3, 0.3], null, Math.floor(indices.length * 0.025 / 3) * 3, 0.004, ['Permissive']);
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(reduced).setBuffer(r.listBuffers()[0]));
  if (previous.listParents().length === 1) previous.dispose();
  compactPrimitive(p);
  passes.push({beforeTriangles: indices.length / 3, triangles: reduced.length / 3, error});
}
await doc.transform(dedup(), prune(),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [2048, 2048], quality: 88, slots: /^baseColor/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 88, slots: /^normal/}),
  textureCompress({encoder: sharp, targetFormat: 'jpeg', resize: [512, 512], quality: 88, slots: /^metallicRoughness/}));
r.listNodes().forEach(n => n.setName('surface-military-truck-body'));
r.listMaterials().forEach(m => m.setName('surface-truck-pbr').setDoubleSided(false));
r.getAsset().generator = 'Terminal State offline UV-aware Surface Run truck cook';
const bytes = Buffer.from(await io.writeBinary(doc));
const tris = r.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0);
const bb = getBounds(scene), dims = bb.max.map((v, i) => +(v - bb.min[i]).toFixed(4));
const textures = r.listTextures().map(t => ({mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength, sha256: sha(t.getImage())}));
const prov = {schema: 'terminal-state-derivative/1', asset: 'surface-military-truck', task,
  status: 'User-supplied model, optimized offline for the Surface Run preview. Provider/owner terms remain applicable; no blanket license or commercial clearance implied.',
  master: {filename: 'Meshy_AI_Camouflaged_Military__1115093536_texture.glb', bytes: raw.length, sha256: digest, private: true, immutable: true, notInGitCiRuntime: true},
  backup: {evidence: 'Main INPUT-MANIFEST attests independent durable raw-art backup; two private read-only staged copies independently SHA-256 checked before cook', sha256: digest},
  rebuild: 'node tools/asset-pipeline/surface/build-truck.mjs <private-master.glb> <private-intermediate.glb>; node tools/asset-pipeline/surface/refine-truck.mjs <private-intermediate.glb>',
  derivative: {convention: 'metres; +Y up; nose -Z; grounded; footprint centred', lengthM: 6.8, uniformScale: scale, dimensionsM: dims, triangles: tris, textures,
    geometry: '0.5 mm position snap + weld + meshoptimizer attribute-aware simplification, UV weights 2/2 and normal weights .3/.3/.3, ratio .025 bounded by error .004; independent authored PBR maps retained', passes,
    runtimeCab: 'Same existing arcade controller, supplied cab-over 8x8 shell, handmade first-person cab, no generation services'},
  output: {bytes: bytes.length, sha256: sha(bytes)}};
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, bytes, {flag: 'wx'});
fs.writeFileSync(output.replace(/\.glb$/, '.json'), JSON.stringify(prov, null, 2) + '\n', {flag: 'wx'});
if (sha(fs.readFileSync(input)) !== digest || sha(fs.readFileSync(backup)) !== digest) throw Error('Master integrity changed unexpectedly');
console.log(JSON.stringify({output, bytes: bytes.length, triangles: tris, dimensionsM: dims, passes, textures, sha256: sha(bytes)}, null, 2));
