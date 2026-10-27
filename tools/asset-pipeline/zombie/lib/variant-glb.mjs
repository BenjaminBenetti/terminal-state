// GLB writers for the body x outfit system (glTF 2.0, gltf-transform, no compression extensions):
//  - body GLB: 18-joint hierarchy (same names as zombie-rigged.glb, identity bind rotations), skin
//    "ZombieSkin", SkinnedMesh node "ZombieBody", the six clips sampled with this body's own rig,
//    scene extras {zombieBody: {...}} (hit radii, triangle count, geometry hash);
//  - outfit GLB: ONE material/texture and ONE shared TEXCOORD_0 + index accessor; per body a
//    SkinnedMesh node "Outfit_<outfit>__<body>" with its own POSITION/NORMAL/JOINTS_0/WEIGHTS_0
//    and a skin over a prefixed copy of that body's joints; node extras carry the body's
//    hidden-triangle mask (base64 bitset) and bulk.
// JOINTS_0 is UNSIGNED_BYTE and WEIGHTS_0 normalized UNSIGNED_BYTE (core glTF; sums exactly 255).
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {JOINTS} from './skeleton.mjs';
import {V} from './pose.mjs';

export function quantizeWeights(joints, weights) {
  const n = joints.length / 4, J = new Uint8Array(n * 4), W = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = [0, 1, 2, 3].map(k => weights[i * 4 + k] * 255);
    const f = w.map(Math.floor);
    let rem = 255 - f.reduce((a, b) => a + b, 0);
    const order = [0, 1, 2, 3].sort((a, b) => (w[b] - f[b]) - (w[a] - f[a]) || a - b);
    for (const k of order) { if (rem <= 0) break; if (weights[i * 4 + k] > 0 || rem > 0) { f[k]++; rem--; } }
    for (let k = 0; k < 4; k++) { J[i * 4 + k] = f[k] ? joints[i * 4 + k] : 0; W[i * 4 + k] = f[k]; }
  }
  return {joints: J, weights: W};
}

export function geometryHash(pos, idx) {
  return crypto.createHash('sha256').update(Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength)).update(Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength)).digest('hex').slice(0, 16);
}

export function bitsetBase64(mask) {
  const b = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) b[i >> 3] |= 1 << (i & 7);
  return Buffer.from(b).toString('base64');
}

function addSkeleton(doc, buf, parentNode, skel, prefix, skinName) {
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(prefix + name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else parentNode.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin(skinName).setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor(skinName + '_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  return {nodes, skin};
}

function material(doc, name, baseJpg, mrJpg) {
  const tex = doc.createTexture(name + '_baseColor').setImage(baseJpg).setMimeType('image/jpeg');
  const mat = doc.createMaterial(name).setBaseColorTexture(tex).setMetallicFactor(1).setRoughnessFactor(1);
  if (mrJpg) mat.setMetallicRoughnessTexture(doc.createTexture(name + '_metallicRoughness').setImage(mrJpg).setMimeType('image/jpeg'));
  return mat;
}
const acc = (doc, buf, type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
/** Iteration 06 size pass: NORMAL as normalized BYTE (KHR_mesh_quantization, required; three.js GLTFLoader supports it). */
function normalAccessor(doc, buf, nrm, quantize) {
  if (!quantize) return acc(doc, buf, 'VEC3', nrm);
  if (!doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'KHR_mesh_quantization')) doc.createExtension(KHRMeshQuantization).setRequired(true);
  const q = new Int8Array(nrm.length);
  for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127)));
  return acc(doc, buf, 'VEC3', q, true);
}
const indexArray = (idx, nv) => nv < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);

export function buildBodyDocument({id, skel, mesh, clips, extras, generator, quantizeNormals = false}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = generator;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Zombie_' + id).setExtras({zombieBody: extras});
  const {nodes, skin} = addSkeleton(doc, buf, scene, skel, '', 'ZombieSkin');
  const q = quantizeWeights(mesh.joints, mesh.weights);
  const prim = doc.createPrimitive().setMaterial(material(doc, 'ZombieBodyMaterial', mesh.baseColor, mesh.metallicRoughness))
    .setAttribute('POSITION', acc(doc, buf, 'VEC3', mesh.pos)).setAttribute('NORMAL', normalAccessor(doc, buf, mesh.nrm, quantizeNormals))
    .setAttribute('TEXCOORD_0', acc(doc, buf, 'VEC2', mesh.uv)).setAttribute('JOINTS_0', acc(doc, buf, 'VEC4', q.joints)).setAttribute('WEIGHTS_0', acc(doc, buf, 'VEC4', q.weights, true))
    .setIndices(acc(doc, buf, 'SCALAR', indexArray(mesh.idx, mesh.pos.length / 3)));
  scene.addChild(doc.createNode('ZombieBody').setMesh(doc.createMesh('ZombieBody').addPrimitive(prim)).setSkin(skin));
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const tAcc = doc.createAccessor(clip.name + '_t').setType('SCALAR').setArray(Float32Array.from(clip.times)).setBuffer(buf);
    for (const [jn, track] of Object.entries(clip.rot)) {
      const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC4').setArray(Float32Array.from(track.flat())).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes[jn]).setTargetPath('rotation').setSampler(s));
    }
    const hipsT = clip.hips.map(o => V.add(V.sub(skel.joints.Hips, skel.joints.Root), o));
    const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(hipsT.flat())).setBuffer(buf)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.Hips).setTargetPath('translation').setSampler(s));
  }
  return doc;
}

/** variants: [{bodyId, skel, pos, nrm, joints, weights, extras}] sharing uv/idx/material. */
export function buildOutfitDocument({id, uv, idx, baseColor, metallicRoughness, variants, extras, generator, extrasKey = 'zombieOutfit', quantizeNormals = false}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = generator;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Outfit_' + id).setExtras({[extrasKey]: extras});
  const mat = material(doc, 'Outfit_' + id + 'Material', baseColor, metallicRoughness);
  const nv = uv.length / 2;
  const uvAcc = acc(doc, buf, 'VEC2', uv), idxAcc = acc(doc, buf, 'SCALAR', indexArray(idx, nv));
  for (const v of variants) {
    const holder = doc.createNode('Rig_' + v.bodyId);
    scene.addChild(holder);
    const {skin} = addSkeleton(doc, buf, holder, v.skel, v.bodyId + '_', 'Skin_' + v.bodyId);
    const q = quantizeWeights(v.joints, v.weights);
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc(doc, buf, 'VEC3', v.pos)).setAttribute('NORMAL', normalAccessor(doc, buf, v.nrm, quantizeNormals))
      .setAttribute('TEXCOORD_0', uvAcc).setAttribute('JOINTS_0', acc(doc, buf, 'VEC4', q.joints)).setAttribute('WEIGHTS_0', acc(doc, buf, 'VEC4', q.weights, true))
      .setIndices(idxAcc);
    const name = `Outfit_${id}__${v.bodyId}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setSkin(skin).setExtras(v.extras));
  }
  return doc;
}

export async function writeDoc(doc, file) { await new NodeIO().registerExtensions([KHRMeshQuantization]).write(file, doc); }
