// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE): QA helper for the root CLAUDE.md rule-5 SCALE CHECK of the
// science store's three code-drawn wall-art kinds (skySciStarMap / skySciChart / skySciPoster: no model file). Writes one throwaway GLB
// per kind (optionally scaled: the double height's 1.5x mural) with the SAME geometry world/skywaysStoreScienceArt.ts draws — the frame
// bars, the backing board and the art face textured with its piece of the Codex atlas — for tools/asset-pipeline/props/scale-check.mjs
// `--prop` (front +Z, the back on the wall plane at z = -d/2, bottom at y = 0). QA output only (never a game input).
//
// Usage: node tools/asset-pipeline/skyways-stores/science/scale-glb.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Document, NodeIO} from '@gltf-transform/core';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(import.meta.dirname, '../../../..');
const out = process.argv[2];
if (!out) { console.error('usage: scale-glb.mjs <out dir>'); process.exit(1); }
fs.mkdirSync(out, {recursive: true});

// the kinds' data (kept in step with gen/skyways/stores/kinds/science.ts and scienceArt.generated.ts: read from the TS sources)
const kindsTs = fs.readFileSync(path.join(root, 'game/src/gen/skyways/stores/kinds/science.ts'), 'utf8');
const artTs = fs.readFileSync(path.join(root, 'game/src/gen/skyways/stores/scienceArt.generated.ts'), 'utf8');
const num = (re, src) => { const m = src.match(re); if (!m) throw new Error(`not found: ${re}`); return Number(m[1]); };
const BAR = num(/bar: ([0-9.]+)/, kindsTs), D = num(/d: ([0-9.]+)\} as const/, kindsTs);
const face = k => ({w: num(new RegExp(`${k}: \\{w: ([0-9.]+)`), kindsTs), h: num(new RegExp(`${k}: \\{w: [0-9.]+, h: ([0-9.]+)`), kindsTs)});
const rect = piece => { const m = artTs.match(new RegExp(`${piece}: \\{u0: ([0-9.]+), v0: ([0-9.]+), u1: ([0-9.]+), v1: ([0-9.]+)`)); return m.slice(1, 5).map(Number); };
const atlas = path.join(root, 'game/public', artTs.match(/url: '([^']+)'/)[1]);

const JOBS = [['skySciStarMap', 'starMap', 1], ['skySciStarMap', 'starMap', 1.5], ['skySciChart', 'chart', 1], ['skySciPoster', 'chemistry', 1]];
for (const [kind, piece, s] of JOBS) {
  const {w, h} = face(kind);
  const doc = new Document(), buf = doc.createBuffer();
  const scene = doc.createScene();
  const frameMat = doc.createMaterial('frame').setBaseColorFactor([0.78, 0.8, 0.82, 1]).setMetallicFactor(0.6).setRoughnessFactor(0.4);
  const boardMat = doc.createMaterial('board').setBaseColorFactor([0.85, 0.84, 0.8, 1]);
  const box = (name, mat, [sx, sy, sz], [px, py, pz]) => {
    const x0 = px - sx / 2, x1 = px + sx / 2, y0 = py - sy / 2, y1 = py + sy / 2, z0 = pz - sz / 2, z1 = pz + sz / 2;
    const P = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
    const I = [0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0];
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(P.flat().map(v => v * 1))).setBuffer(buf);
    const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMaterial(mat);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setScale([s, s, 1]));
  };
  box('bar-bottom', frameMat, [w + 2 * BAR, BAR, D], [0, BAR / 2, 0]);
  box('bar-top', frameMat, [w + 2 * BAR, BAR, D], [0, h + 1.5 * BAR, 0]);
  box('bar-left', frameMat, [BAR, h, D], [-(w + BAR) / 2, h / 2 + BAR, 0]);
  box('bar-right', frameMat, [BAR, h, D], [(w + BAR) / 2, h / 2 + BAR, 0]);
  box('board', boardMat, [w, h, 0.01], [0, h / 2 + BAR, -D / 2 + 0.005]);
  // the art face: its atlas piece as the texture (cropped out of the atlas: v = 0 at the bottom)
  const [u0, v0, u1, v1] = rect(piece), meta = await sharp(atlas).metadata();
  const png = await sharp(atlas).extract({left: Math.round(u0 * meta.width), top: Math.round((1 - v1) * meta.height), width: Math.round((u1 - u0) * meta.width), height: Math.round((v1 - v0) * meta.height)}).resize({width: 512}).png().toBuffer();
  const tex = doc.createTexture('art').setImage(png).setMimeType('image/png');
  const artMat = doc.createMaterial('art').setBaseColorTexture(tex).setRoughnessFactor(0.8);
  const z = -D / 2 + 0.012, yc = h / 2 + BAR;
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([-w / 2, yc - h / 2, z, w / 2, yc - h / 2, z, w / 2, yc + h / 2, z, -w / 2, yc + h / 2, z])).setBuffer(buf);
  const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0])).setBuffer(buf);
  const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(artMat);
  scene.addChild(doc.createNode('art').setMesh(doc.createMesh('art').addPrimitive(prim)).setScale([s, s, 1]));
  const file = path.join(out, `${kind}${s !== 1 ? `-x${s}` : ''}.glb`);
  await new NodeIO().write(file, doc);
  console.log('wrote', file, `${((w + 2 * BAR) * s).toFixed(3)} x ${((h + 2 * BAR) * s).toFixed(3)} x ${D} m`);
}
