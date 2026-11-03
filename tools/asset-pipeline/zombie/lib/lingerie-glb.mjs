// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): runtime GLB of one lingerie set (glTF 2.0, gltf-transform, no
// Draco / meshopt / KTX2; KHR_mesh_quantization for NORMAL (i8) and TEXCOORD_0 (u16), as the wardrobe already requires):
//  - ONE material (OPAQUE, double-sided like the Meshy source: thin straps / cups are seen from both sides) with the Meshy base
//    colour (1024 JPEG) + packed metallicRoughness (256 JPEG); shared by every node of the file (worn variants AND displays);
//  - per piece (top = slot upper, bottom = slot lower) ONE shared TEXCOORD_0 + index accessor;
//  - per fitted body: a holder `Rig_<body>` with a prefixed copy of that body's 18 joints + skin `Skin_<body>`, and two SkinnedMesh
//    nodes `Outfit_lingerie-<design>-top__<body>` / `Outfit_lingerie-<design>-bottom__<body>` (own POSITION / NORMAL / JOINTS_0 /
//    WEIGHTS_0) with wardrobe variant extras (outfit, slot, body, bodyTriangles, bodyGeometryHash, hideBodyTriangles, hiddenCount,
//    bulkM, hideWear) — exactly what ai/wardrobe.ts WardrobeLibrary reads (geometry-hash guard included);
//  - STATIC display nodes `LingerieDisplay_<design>_top` / `_bottom` (unskinned) that REUSE the display body's POSITION / NORMAL /
//    UV / index accessors (zero extra geometry or texture bytes): the set holding its fitted shape, translated so the set stands
//    centred on y = 0 (extras lingerieDisplay: size; toBodySpace = the OFFSET to add to the node translation for the body frame,
//    i.e. translation + toBodySpace = 0: the vertices themselves are in body space);
//  - task store-polish: unskinned `LingerieMannequin_<design>_top` / `_bottom` (the set fitted to the female display mannequin, in that
//    model's own frame: identity node, front -Z) and hanging rack items `LingerieHang_<design>_<item>` (garment primitive(s) + a
//    procedural chrome hanger primitive; origin = where the hook rests on the rail) sharing the lace material / UV / indices;
//  - scene extras zombieWearable {id, kind: 'lingerie-set', pieces, bodies, ...} WITHOUT a scene-level `slot` (the file holds one
//    wearable of each of two slots; WardrobeLibrary only rejects a file whose scene slot disagrees).
import {Document, NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {JOINTS} from './skeleton.mjs';
import {quantizeWeights} from './variant-glb.mjs';

const acc = (doc, buf, type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
const qNormals = nrm => { const q = new Int8Array(nrm.length); for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))); return q; };
const qUV = uv => { const q = new Uint16Array(uv.length); for (let i = 0; i < uv.length; i++) { const v = uv[i]; if (v < -1e-6 || v > 1 + 1e-6) throw new Error('lingerie UV outside [0, 1]: ' + v); q[i] = Math.round(Math.max(0, Math.min(1, v)) * 65535); } return q; };
const indexArray = (idx, nv) => nv < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);

function addSkeleton(doc, buf, parentNode, jointPos, prefix, skinName) {
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const p = jointPos[name], q = parent ? jointPos[parent] : [0, 0, 0];
    const node = doc.createNode(prefix + name).setTranslation([0, 1, 2].map(k => +(p[k] - q[k]).toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else parentNode.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = jointPos[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin(skinName).setSkeleton(nodes.Root).setInverseBindMatrices(acc(doc, buf, 'MAT4', ibm));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  return skin;
}

/**
 * @param o {design, wearables: {top, bottom} (ids), baseJpg, mrJpg, pieces: {top: {uv, idx}, bottom: {uv, idx}},
 *   variants: [{bodyId, jointPos, top: {pos, nrm, joints, weights, extras}, bottom: {...}}], display: {bodyId}, sceneExtras, generator}
 */
export function buildLingerieDocument(o) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = o.generator;
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Outfit_lingerie-' + o.design).setExtras({zombieWearable: o.sceneExtras});
  const name = 'Lingerie_' + o.design;
  const mat = doc.createMaterial(name).setAlphaMode('OPAQUE').setDoubleSided(true).setMetallicFactor(1).setRoughnessFactor(1)
    .setBaseColorTexture(doc.createTexture(name + '_baseColor').setImage(o.baseJpg).setMimeType('image/jpeg'))
    .setMetallicRoughnessTexture(doc.createTexture(name + '_metallicRoughness').setImage(o.mrJpg).setMimeType('image/jpeg'));
  const shared = {};
  for (const pn of ['top', 'bottom']) { const p = o.pieces[pn]; shared[pn] = {uv: acc(doc, buf, 'VEC2', qUV(p.uv), true), idx: acc(doc, buf, 'SCALAR', indexArray(p.idx, p.uv.length / 2))}; }
  const displayAcc = {};
  for (const v of o.variants) {
    const holder = doc.createNode('Rig_' + v.bodyId);
    scene.addChild(holder);
    const skin = addSkeleton(doc, buf, holder, v.jointPos, v.bodyId + '_', 'Skin_' + v.bodyId);
    for (const pn of ['top', 'bottom']) {
      const m = v[pn], q = quantizeWeights(m.joints, m.weights);
      const P = acc(doc, buf, 'VEC3', Float32Array.from(m.pos)), N = acc(doc, buf, 'VEC3', qNormals(m.nrm), true);
      const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', P).setAttribute('NORMAL', N).setAttribute('TEXCOORD_0', shared[pn].uv)
        .setAttribute('JOINTS_0', acc(doc, buf, 'VEC4', q.joints)).setAttribute('WEIGHTS_0', acc(doc, buf, 'VEC4', q.weights, true)).setIndices(shared[pn].idx);
      const nodeName = `Outfit_${o.wearables[pn]}__${v.bodyId}`;
      scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)).setSkin(skin).setExtras(m.extras));
      if (o.display && v.bodyId === o.display.bodyId) displayAcc[pn] = {P, N, pos: m.pos};
    }
  }
  if (o.display) {
    // the set stands centred on y = 0: translation = -(centre x, min y, centre z) of both pieces (bind shape on that body)
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const pn of ['top', 'bottom']) { const P = displayAcc[pn].pos; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } }
    const t = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2].map(v => +v.toFixed(5));
    const size = [0, 1, 2].map(k => +(mx[k] - mn[k]).toFixed(4));
    for (const pn of ['top', 'bottom']) {
      const d = displayAcc[pn];
      let pm = [Infinity, Infinity, Infinity], px = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.pos.length; i += 3) for (let k = 0; k < 3; k++) { pm[k] = Math.min(pm[k], d.pos[i + k]); px[k] = Math.max(px[k], d.pos[i + k]); }
      const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', d.P).setAttribute('NORMAL', d.N).setAttribute('TEXCOORD_0', shared[pn].uv).setIndices(shared[pn].idx);
      const nodeName = `LingerieDisplay_${o.design}_${pn}`;
      scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)).setTranslation(t).setExtras({lingerieDisplay: {design: o.design, piece: pn, wearable: o.wearables[pn], fittedOn: o.display.bodyId,
        setSizeM: size, pieceBounds: {min: [0, 1, 2].map(k => +(pm[k] + t[k]).toFixed(4)), max: [0, 1, 2].map(k => +(px[k] + t[k]).toFixed(4))}, toBodySpace: t.map(v => -v),
        note: 'static (unskinned) display stock: the set holding its fitted shape on that body, standing centred on y = 0 (front +Z); shares the worn variant geometry + texture'}}));
    }
  }
  // ---- task store-polish: static nodes on the female display mannequin + hanging rack items (shared lace material / UV / indices)
  if (o.mannequin) {
    for (const pn of ['top', 'bottom']) {
      const m = o.mannequin.pieces[pn];
      const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc(doc, buf, 'VEC3', Float32Array.from(m.pos))).setAttribute('NORMAL', acc(doc, buf, 'VEC3', qNormals(m.nrm), true))
        .setAttribute('TEXCOORD_0', shared[pn].uv).setIndices(shared[pn].idx);
      const nodeName = `LingerieMannequin_${o.design}_${pn}`;
      scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)).setExtras({lingerieMannequin: {design: o.design, piece: pn, wearable: o.wearables[pn], ...o.mannequin.extras}}));
    }
  }
  if (o.hang) {
    // one chrome hanger material + one accessor set per hanger type for the whole file (untextured procedural hardware)
    const hmat = doc.createMaterial('LingerieHanger').setAlphaMode('OPAQUE').setBaseColorFactor([0.72, 0.73, 0.75, 1]).setMetallicFactor(0.85).setRoughnessFactor(0.35);
    const hacc = {};
    for (const [k, h] of Object.entries(o.hang.hangers)) hacc[k] = {P: acc(doc, buf, 'VEC3', Float32Array.from(h.pos)), N: acc(doc, buf, 'VEC3', qNormals(h.nrm), true), I: acc(doc, buf, 'SCALAR', Uint16Array.from(h.idx))};
    for (const it of o.hang.items) {
      const nodeName = `LingerieHang_${o.design}_${it.item}`;
      const mesh = doc.createMesh(nodeName);
      for (const g of it.garments) mesh.addPrimitive(doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc(doc, buf, 'VEC3', Float32Array.from(g.pos))).setAttribute('NORMAL', acc(doc, buf, 'VEC3', qNormals(g.nrm), true))
        .setAttribute('TEXCOORD_0', shared[g.piece].uv).setIndices(shared[g.piece].idx));
      const h = hacc[it.hanger];
      mesh.addPrimitive(doc.createPrimitive().setMaterial(hmat).setAttribute('POSITION', h.P).setAttribute('NORMAL', h.N).setIndices(h.I));
      scene.addChild(doc.createNode(nodeName).setMesh(mesh).setExtras({lingerieHang: {design: o.design, item: it.item, pieces: it.garments.map(g => g.piece), ...it.extras}}));
    }
  }
  return doc;
}

export async function writeDoc(doc, file) { await new NodeIO().registerExtensions([KHRMeshQuantization]).write(file, doc); }
export async function docBytes(doc) { return new NodeIO().registerExtensions([KHRMeshQuantization]).writeBinary(doc); }
