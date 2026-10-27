// Iteration 03: lighter ceiling-fixture runtime derivative for the big station (~280 fixtures).
// Input: the existing runtime derivative assets/models/light.glb (unchanged). Output: light-lod.glb
// (same node/material/texture setup, geometry simplified with meshoptimizer) + provenance json.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const SRC = 'game/public/assets/models/light.glb';
const OUT = 'game/public/assets/models/light-lod.glb';
const PROV = 'game/public/assets/derivatives/light-lod-iteration03.json';
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tris = doc => doc.getRoot().listMeshes().reduce((t, m) => t + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const before = tris(doc);
const ratio = Number(process.argv[2] ?? 0.25), error = Number(process.argv[3] ?? 0.02);
// Seam-preserving simplify stalls at ~2k tris (UV/normal seams lock borders), so use meshoptimizer's
// sloppy simplifier on positions: it returns indices into the ORIGINAL vertices, so UVs/normals stay valid.
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
  if (!idx) continue;
  const indices = new Uint32Array(idx.getArray());
  const target = Math.max(3, Math.floor(indices.length * ratio / 3) * 3);
  const [out] = MeshoptSimplifier.simplifySloppy(indices, new Float32Array(pos.getArray()), 3, null, target, error);
  idx.setArray(new Uint32Array(out));
}
await doc.transform(prune());
const after = tris(doc);
await io.write(OUT, doc);
const prov = {
  schema: 'last-line-derivative/1', asset: 'light-lod', task: 'studio-slice-iteration03-20261026', status: 'prototype; unapproved; gameReady false',
  source: {file: 'assets/models/light.glb', sha256: sha(SRC), note: 'existing iteration-01 runtime derivative of the generated ceiling light; source file unchanged'},
  output: {file: 'assets/models/light-lod.glb', sha256: sha(OUT), bytes: fs.statSync(OUT).size, triangles: Math.round(after)},
  steps: [{step: 'simplifySloppy (positions only, original vertex attributes kept) + prune', tool: 'meshoptimizer MeshoptSimplifier.simplifySloppy + @gltf-transform/functions prune', options: {ratio, error}, trianglesBefore: Math.round(before), trianglesAfter: Math.round(after)}],
  why: 'The iteration-03 station places ~250-300 instanced ceiling fixtures; 2,992 tris each was ~0.85M triangles per frame.',
};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 2) + '\n');
console.log(JSON.stringify({before: Math.round(before), after: Math.round(after), bytes: prov.output.bytes}));
