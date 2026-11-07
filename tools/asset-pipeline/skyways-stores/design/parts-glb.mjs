// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): writes the design store's CODE-DRAWN kinds (a vignette rug,
// a stack of folded throws, a stack of folded towels, a framed print — gen/skyways/stores/kinds/design.ts designRugParts / designTextileParts /
// designPrintParts, the
// exact boxes world/skywaysStoreDesignDraw.ts draws) as small flat-coloured GLBs, so the prop scale check
// (tools/asset-pipeline/props/scale-check.mjs --prop <glb>) can render them beside the runtime zombie (it skips model-less kinds).
// QA only: the GLBs are scratch files (never game inputs). Colours: the colourway tints (the game draws the tinted office carpet).
// Usage: node tools/asset-pipeline/skyways-stores/design/parts-glb.mjs OUT_DIR [rugW rugD]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {Document, NodeIO} from '@gltf-transform/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const [outDir = path.join(root, 'qa-artifacts/skyways-store-design'), rugW = '2.8', rugD = '2.2'] = process.argv.slice(2);
fs.mkdirSync(outDir, {recursive: true});

const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = h => [lin(((h >> 16) & 255) / 255), lin(((h >> 8) & 255) / 255), lin((h & 255) / 255), 1];

function boxPrim(doc, buf, s, p) {
  const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
  const pos = [], nor = [], idx = [];
  const faces = [[[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
  for (const [n, vs] of faces) {
    const b = pos.length / 3;
    for (const v of vs) { pos.push(p[0] + v[0] * hx, p[1] + v[1] * hy, p[2] + v[2] * hz); nor.push(...n); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf));
}

async function write(file, parts, tints) {
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene(), mats = new Map();
  for (const part of parts) {
    let m = mats.get(part.t);
    if (!m) mats.set(part.t, (m = doc.createMaterial(`design-${part.t}`).setBaseColorFactor(rgb(tints[part.t])).setRoughnessFactor(1).setMetallicFactor(0)));
    const mesh = doc.createMesh(`part-${part.t}`).addPrimitive(boxPrim(doc, buf, part.s, part.p).setMaterial(m));
    scene.addChild(doc.createNode(`part-${part.t}`).setMesh(mesh));
  }
  await new NodeIO().write(file, doc);
  console.log(file);
}

const server = await createServer({root: path.join(root, 'game'), configFile: false, logLevel: 'error', server: {middlewareMode: true, hmr: false}, appType: 'custom', optimizeDeps: {noDiscovery: true, include: []}});
try {
  const K = await server.ssrLoadModule('/src/gen/skyways/stores/kinds/design.ts');
  await write(path.join(outDir, 'design-rug.glb'), K.designRugParts(Number(rugW) / 2, Number(rugD) / 2, 0), K.DESIGN_TINT);
  await write(path.join(outDir, 'design-throws.glb'), K.designTextileParts(K.DESIGN_TEXTILES.throws[0]), K.DESIGN_TINT);
  await write(path.join(outDir, 'design-towels.glb'), K.designTextileParts(K.DESIGN_TEXTILES.towels[0]), K.DESIGN_TINT);
  // the framed print: the frame bars (pale oak), the white mat and the art face (a flat stand-in colour here; the game maps the atlas)
  const art = K.designPrintArt(), P = K.DESIGN_PRINT;
  const print = [...K.designPrintParts().map(q => ({t: q.m === 'wood' ? 'oak' : 'mat', s: q.s, p: q.p})), {t: 'art', s: [art.w, art.h, 0.002], p: [0, P.h / 2, -P.d / 2 + 0.0095]}];
  await write(path.join(outDir, 'design-print.glb'), print, {oak: 0xc8a676, mat: 0xf0ece4, art: 0x8f9d86});
} finally {
  await server.close();
}
