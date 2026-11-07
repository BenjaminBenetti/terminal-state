// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-BOOKS): QA-only GLBs of the bookshop's two CODE-DRAWN kinds, built from
// the same numbers the game draws them with (gen/skyways/stores/kinds/books.ts BOOKS_SIGN_BOARD / BOOKS_RUG_SIZE, the atlas rects of
// gen/skyways/stores/booksArt.generated.ts), so tools/asset-pipeline/props/scale-check.mjs can render them beside the runtime zombie
// (root CLAUDE.md rule 5). Written to a scratch folder (default /tmp/books-scale), never under game/public: the game draws these kinds
// itself (world/skywaysStoreBooks.ts). Also a "sign on its bookcase" composite (the oak bookcase model + the sign on its top, front flush).
// Usage: node tools/asset-pipeline/skyways-stores/books/scale-glb.mjs [OUT_DIR]
import fs from 'node:fs';
import path from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';

const root = path.resolve(import.meta.dirname, '../../../..');
const out = process.argv[2] ?? '/tmp/books-scale';
fs.mkdirSync(out, {recursive: true});
const src = fs.readFileSync(path.join(root, 'game/src/gen/skyways/stores/kinds/books.ts'), 'utf8');
const num = re => Number(src.match(re)[1]);
const SIGN = {w: num(/BOOKS_SIGN_BOARD = \{w: ([\d.]+)/), h: num(/BOOKS_SIGN_BOARD = \{w: [\d.]+, h: ([\d.]+)/), d: num(/BOOKS_SIGN_BOARD = \{[^}]*d: ([\d.]+)/), fw: num(/face: \{w: ([\d.]+)/), fh: num(/face: \{w: [\d.]+, h: ([\d.]+)/)};
const RUG = {w: num(/BOOKS_RUG_SIZE = \{w: ([\d.]+)/), d: num(/BOOKS_RUG_SIZE = \{w: [\d.]+, d: ([\d.]+)/), h: num(/BOOKS_RUG_SIZE = \{[^}]*h: ([\d.]+)/)};
const art = fs.readFileSync(path.join(root, 'game/src/gen/skyways/stores/booksArt.generated.ts'), 'utf8');
const piece = key => { const m = art.match(new RegExp(`'${key}': \\{u0: ([\\d.]+), v0: ([\\d.]+), u1: ([\\d.]+), v1: ([\\d.]+), aspect: ([\\d.]+)\\}`)); return {u0: +m[1], v0: +m[2], u1: +m[3], v1: +m[4], aspect: +m[5]}; };
const jpg = fs.readFileSync(path.join(root, 'game/public/assets/textures/skyways/stores/books/skyways-store-books-art.jpg'));

/** A mesh from quads / boxes: positions, uvs (glTF: v down = 1 - three's v), indices. */
function build(name, parts, extra) {
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene(name);
  const tex = doc.createTexture('atlas').setImage(jpg).setMimeType('image/jpeg');
  const artMat = doc.createMaterial('art').setBaseColorTexture(tex).setRoughnessFactor(0.85).setMetallicFactor(0);
  const wood = doc.createMaterial('walnut').setBaseColorFactor([0.23, 0.14, 0.09, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  for (const [i, p] of parts.entries()) {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p.pos)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(p.uv)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(p.idx)).setBuffer(buf))
      .setMaterial(p.art ? artMat : wood);
    scene.addChild(doc.createNode(`${name}-${i}`).setMesh(doc.createMesh(`${name}-${i}`).addPrimitive(prim)));
  }
  extra?.(doc, scene, buf);
  return doc;
}
const quad = (corners, r) => ({pos: corners.flat(), uv: [r.u0, 1 - r.v0, r.u1, 1 - r.v0, r.u1, 1 - r.v1, r.u0, 1 - r.v1], idx: [0, 1, 2, 0, 2, 3], art: true});
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  const pos = [], uv = [], idx = [];
  for (const q of f) { const b = pos.length / 3; for (const k of q) { pos.push(...v[k]); uv.push(0, 0); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return {pos, uv, idx, art: false};
}
/** The sign at (ox, oy, oz) scaled s: the board and its two faces (the front +Z; the game's back face mirrors it at -Z). */
function signParts(key, s = 1, ox = 0, oy = 0, oz = 0) {
  const r = piece(key), w = SIGN.fw * s, h = Math.min(SIGN.fh + 0.008, SIGN.fw / r.aspect) * s, cy = oy + SIGN.h * s / 2, zf = oz + SIGN.d * s / 2 + 0.0015, zb = oz - SIGN.d * s / 2 - 0.0015;
  return [box(ox - SIGN.w * s / 2, oy, oz - SIGN.d * s / 2, ox + SIGN.w * s / 2, oy + SIGN.h * s, oz + SIGN.d * s / 2),
    quad([[ox - w / 2, cy - h / 2, zf], [ox + w / 2, cy - h / 2, zf], [ox + w / 2, cy + h / 2, zf], [ox - w / 2, cy + h / 2, zf]], r),
    quad([[ox + w / 2, cy - h / 2, zb], [ox - w / 2, cy - h / 2, zb], [ox - w / 2, cy + h / 2, zb], [ox + w / 2, cy + h / 2, zb]], r)];
}
const io = new NodeIO();
await io.write(path.join(out, 'sky-books-sign.glb'), build('skyBooksSign', signParts('local-history')));
await io.write(path.join(out, 'sky-books-sign-table.glb'), build('skyBooksSignTable', signParts('new-notable', 0.62)));
const rr = piece('rug-reading'), rc = piece('rug-children');
await io.write(path.join(out, 'sky-books-rug.glb'), build('skyBooksRug', [quad([[-RUG.w / 2, RUG.h, RUG.d / 2], [RUG.w / 2, RUG.h, RUG.d / 2], [RUG.w / 2, RUG.h, -RUG.d / 2], [-RUG.w / 2, RUG.h, -RUG.d / 2]], rr)]));
await io.write(path.join(out, 'sky-books-rug-children.glb'), build('skyBooksRugChildren', [quad([[-RUG.w / 2, RUG.h, RUG.d / 2], [RUG.w / 2, RUG.h, RUG.d / 2], [RUG.w / 2, RUG.h, -RUG.d / 2], [-RUG.w / 2, RUG.h, -RUG.d / 2]], rc)]));
// the sign on its oak bookcase: the case model (its own nodes copied in) + the sign on the 2.4 m top, its face flush with the case front
const bc = await io.read(path.join(root, 'game/public/assets/models/skyways-d-bk-bookcase.glb'));
const caseD = 0.4453;
const composite = build('signOnBookcase', signParts('fiction', 1, 0, 2.4, caseD / 2 - SIGN.d / 2 - 0.01));
const {mergeDocuments} = await import('@gltf-transform/functions');
mergeDocuments(composite, bc);
const scenes = composite.getRoot().listScenes();
for (const n of scenes[1]?.listChildren() ?? []) scenes[0].addChild(n);
scenes[1]?.dispose();
for (const b of composite.getRoot().listBuffers().slice(1)) { for (const a of composite.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(composite.getRoot().listBuffers()[0]); b.dispose(); }
await io.write(path.join(out, 'sky-books-sign-on-bookcase.glb'), composite);
console.log('wrote', fs.readdirSync(out).filter(f => f.endsWith('.glb')).map(f => path.join(out, f)).join('\n'));
