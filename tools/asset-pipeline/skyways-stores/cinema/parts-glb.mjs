#!/usr/bin/env node
// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-CINEMA): exports the EXACT runtime box parts of the cinema store's three
// code-drawn art kinds (gen/skyways/stores/cinemaArt.ts cinemaArtShape: the parts world/skywaysStoreCinema.ts instances, plus the art quad
// as a thin slab) as GLBs in the prop frame (origin bottom centre, front +Z, metres), so tools/asset-pipeline/props/scale-check.mjs
// `--prop <glb>` can render them beside the runtime zombie (rule 5). Flat stand-in colours per part material; the art quad grey.
// QA only: writes to the given folder (default qa-artifacts/cinema-scale), never to game/public.
//
// Usage: node tools/asset-pipeline/skyways-stores/cinema/parts-glb.mjs [OUT_DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'qa-artifacts/cinema-scale'));
fs.mkdirSync(OUT, {recursive: true});

// bundle the pure-data module with the installed rolldown (vite's bundler), like scale-check.mjs
const {rolldown} = await import(pathToFileURL(require.resolve('rolldown', {paths: [ROOT, path.dirname(require.resolve('vite/package.json', {paths: [ROOT]}))]})).href);
const G = path.join(ROOT, 'game/src').split(path.sep).join('/');
const entry = `export {cinemaArtShape} from '${G}/gen/skyways/stores/cinemaArt'; export {STORE_CINEMA_KINDS, STORE_CINEMA_SPECS} from '${G}/gen/skyways/stores/kinds/cinema';`;
const bundle = await rolldown({input: 'e', platform: 'node', logLevel: 'silent', external: id => id !== 'e' && !id.startsWith('.') && !id.startsWith('/'),
  plugins: [{name: 'e', resolveId: id => (id === 'e' ? id : null), load: id => (id === 'e' ? entry : null)}]});
const {output} = await bundle.generate({format: 'esm'});
await bundle.close();
const tmp = path.join(os.tmpdir(), `cinema-parts-${process.pid}.mjs`);
fs.writeFileSync(tmp, output[0].code);
const rt = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, {force: true});

const COLOUR = {brass: [0.72, 0.57, 0.23], black: [0.08, 0.08, 0.08], glass: [0.78, 0.85, 0.86], steelDark: [0.23, 0.24, 0.25], art: [0.55, 0.45, 0.42]};

/** One box (size s, centre p) as an indexed mesh primitive. */
function box(doc, buf, mat, s, p) {
  const [hx, hy, hz] = s.map(v => v / 2), [cx, cy, cz] = p;
  const v = [];
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) v.push(cx + x, cy + y, cz + z);
  const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(v)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf);
  return doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind).setMaterial(mat);
}

const io = new NodeIO();
for (const kind of rt.STORE_CINEMA_KINDS) {
  const doc = new Document(), buf = doc.createBuffer(), mats = {};
  const mat = m => (mats[m] ??= doc.createMaterial(m).setBaseColorFactor([...COLOUR[m], 1]));
  const {parts, face} = rt.cinemaArtShape(kind, 0);
  const mesh = doc.createMesh(kind);
  for (const q of parts) mesh.addPrimitive(box(doc, buf, mat(q.m), q.s, q.p));
  mesh.addPrimitive(box(doc, buf, mat('art'), [face.w, face.h, 0.004], face.p));
  doc.createScene().addChild(doc.createNode(kind).setMesh(mesh));
  const file = path.join(OUT, `${kind}.glb`);
  await io.write(file, doc);
  const def = rt.STORE_CINEMA_SPECS[kind].def;
  console.log(`${kind}: ${file} (PROP_DEFS ${def.w} x ${def.h} x ${def.d} m)`);
}
