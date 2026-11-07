#!/usr/bin/env node
// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-GARDEN): SCALE CHECK of the garden store's two code-drawn kinds
// (game/src/gen/skyways/stores/kinds/garden.ts: box parts, no model file). Exports each kind's parts — bundled from the TS source with the
// installed rolldown, never hand-copied — as a flat-coloured GLB in the prop frame (origin bottom centre, front +Z), then renders them
// with tools/asset-pipeline/props/scale-check.mjs beside the runtime-scaled reference zombie (root CLAUDE.md "Props" rule 5):
//  - storeGardenSoilPallet as placed (grounded);
//  - storeGardenBasketRail at its hang height (lifted to GARDEN_RAIL_CLEAR: the lowest the dresser hangs it) with the five geranium-pot
//    baskets (the runtime skyways-d-gd-pot.glb, the kind skyDGeraniumPot) standing in its rings, as the dresser hosts them.
// usage: node tools/asset-pipeline/skyways-stores/garden/scale-check.mjs [--out <dir>]   (default qa-artifacts/scale-check/garden; git-ignored)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';
import {mergeDocuments, unpartition} from '@gltf-transform/functions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(ROOT, 'qa-artifacts/scale-check/garden');
fs.mkdirSync(outDir, {recursive: true});

// --- the kinds' data, bundled from the TS source -----------------------------------------------------------------------------
const {rolldown} = await import(pathToFileURL(require.resolve('rolldown', {paths: [ROOT, path.dirname(require.resolve('vite/package.json', {paths: [ROOT]}))]})).href);
const entry = `export * from '${path.join(ROOT, 'game/src/gen/skyways/stores/kinds/garden.ts').split(path.sep).join('/')}';`;
const bundle = await rolldown({
  input: 'garden-entry', platform: 'node', logLevel: 'silent',
  external: id => id !== 'garden-entry' && !id.startsWith('.') && !id.startsWith('/'),
  plugins: [{name: 'garden-entry', resolveId: id => (id === 'garden-entry' ? id : null), load: id => (id === 'garden-entry' ? entry : null)}],
});
const {output} = await bundle.generate({format: 'esm'});
await bundle.close();
const tmp = path.join(os.tmpdir(), `garden-kinds-${process.pid}.mjs`);
fs.writeFileSync(tmp, output[0].code);
let K;
try { K = await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, {force: true}); }

// flat stand-in colours per shape-material key (the render is about size / contact, not the look)
const COLOR = {wood: [0.55, 0.4, 0.25], accent: [0.2, 0.32, 0.18], counter: [0.88, 0.86, 0.8], steelDark: [0.22, 0.24, 0.26], steelBright: [0.7, 0.72, 0.74]};

/** A box part's triangles (24 vertices) in the prop frame. */
function boxPrim(doc, buffer, part, mat) {
  const [sx, sy, sz] = part.s.map(v => v / 2), rx = part.rx ?? 0, c = Math.cos(rx), s = Math.sin(rx);
  const faces = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
  const rot = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
  const pos = [], nor = [], idx = [];
  for (const [n, vs] of faces) {
    const b = pos.length / 3;
    for (const v of vs) { const p = rot([v[0] * sx, v[1] * sy, v[2] * sz]); pos.push(p[0] + part.p[0], p[1] + part.p[1], p[2] + part.p[2]); nor.push(...rot(n)); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer));
}
function partsDoc(name, parts) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene(name), mesh = doc.createMesh(name), mats = {};
  for (const part of parts) {
    mats[part.m] ??= doc.createMaterial(part.m).setBaseColorFactor([...COLOR[part.m], 1]).setRoughnessFactor(0.8);
    mesh.addPrimitive(boxPrim(doc, buffer, part, mats[part.m]));
  }
  scene.addChild(doc.createNode(name).setMesh(mesh));
  return doc;
}

const io = new NodeIO();
const pallet = path.join(outDir, 'storeGardenSoilPallet.glb');
await io.write(pallet, partsDoc('storeGardenSoilPallet', K.SOIL_PALLET_PARTS));
// the rail with its five baskets (the runtime geranium-pot model in each ring, its base at the rail placement's y)
const rail = partsDoc('storeGardenBasketRail', K.BASKET_RAIL_PARTS);
const potFile = path.join(ROOT, 'game/public/assets/models/skyways-d-gd-pot.glb');
for (const x of K.BASKET_RAIL.slots) {
  const pot = await io.read(potFile);
  const map = mergeDocuments(rail, pot);
  const target = rail.getRoot().listScenes()[0];
  for (const sc of pot.getRoot().listScenes()) {
    const merged = map.get(sc);
    const holder = rail.createNode(`basket@${x}`).setTranslation([x, 0, 0]);
    for (const n of merged.listChildren()) holder.addChild(n);
    target.addChild(holder);
    merged.dispose();
  }
}
const railFile = path.join(outDir, 'storeGardenBasketRail.glb');
await rail.transform(unpartition());
await io.write(railFile, rail);

const png = path.join(outDir, 'garden-kinds.png');
const sc = path.join(ROOT, 'tools/asset-pipeline/props/scale-check.mjs');
const out = execFileSync(process.execPath, [sc, '--prop', pallet, '--label', 'storeGardenSoilPallet', '--prop', railFile, '--lift', String(K.GARDEN_RAIL_CLEAR), '--label', `storeGardenBasketRail (hung: baskets ${K.GARDEN_RAIL_CLEAR} m up)`, '--out', png], {encoding: 'utf8', cwd: ROOT});
process.stdout.write(out);
