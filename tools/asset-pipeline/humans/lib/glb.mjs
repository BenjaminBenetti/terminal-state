// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the market-human-cast.glb writer (glTF 2.0, gltf-transform; no
// Draco / meshopt / KTX2; KHR_mesh_quantization for int8 normals, as the zombie wardrobe files).
//
// Layout (the runtime market/humanWardrobe.ts reads exactly this):
//   scene 'MarketHumans', extras.marketHumans = {schema, bodies: [...], wearables: [...], clips: [...]}
//   per body <b>:  node 'Human_<b>' (holder at the origin)
//                    '<b>_Root' .. '<b>_R_Foot'     the shared 18-joint hierarchy (zombie/lib/skeleton.mjs JOINTS), joint names
//                                                   prefixed with the body id (one file: node names must be unique), identity
//                                                   bind rotations, translations = the body's own bind offsets
//                    'HumanBody_<b>'                SkinnedMesh, skin 'HumanSkin_<b>', the body's own Meshy maps (base colour,
//                                                   metal-rough, normal); extras {body, geometryHash, triangles}
//                    'Wear_<w>__<b>'                one SkinnedMesh per fitted wearable, SAME skin (bound to the body's skeleton);
//                                                   extras {wearable, slot, body, bodyGeometryHash, hideBodyTriangles (base64 bitset
//                                                   over the body's triangles), hideWear {<w2>: bitset over THIS mesh's triangles
//                                                   hidden when w2 is worn too}, incompatibleWear, bulkM}
//                  animations '<b>:<Clip>'          joint rotation tracks + the '<b>_Hips' translation track (the healthy clips)
//   per wearable:  ONE material / texture set and ONE TEXCOORD_0 + index accessor shared by its body variants.
// JOINTS_0 u8 / WEIGHTS_0 normalized u8 (sums exactly 255; zombie/lib/variant-glb.mjs quantizeWeights).
import {Document} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {V} from '../../zombie/lib/pose.mjs';
import {quantizeWeights} from '../../zombie/lib/variant-glb.mjs';

const acc = (doc, buf, type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
const indexArray = (idx, nv) => (nv < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx));
function normals(doc, buf, nrm) {
  if (!doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'KHR_mesh_quantization')) doc.createExtension(KHRMeshQuantization).setRequired(true);
  const q = new Int8Array(nrm.length);
  for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127)));
  return acc(doc, buf, 'VEC3', q, true);
}
const tex = (doc, name, jpg) => doc.createTexture(name).setImage(jpg).setMimeType('image/jpeg');

/**
 * bodies: [{id, skel, mesh: {pos, nrm, uv, idx, joints, weights}, enc: {baseJpg, mrJpg, normalJpg}, clips: [sampled], extras}]
 * wearables: [{id, uv, idx, enc: {baseJpg, mrJpg}, variants: [{bodyId, pos, nrm, joints, weights, extras}], extras}]
 */
export function buildCastDocument({bodies, wearables, extras, generator}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = generator;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('MarketHumans').setExtras({marketHumans: extras});
  const wearMat = new Map();
  for (const w of wearables) {
    const m = doc.createMaterial(`Wear_${w.id}_Material`).setBaseColorTexture(tex(doc, `Wear_${w.id}_baseColor`, w.enc.baseJpg)).setMetallicFactor(1).setRoughnessFactor(1);
    if (w.enc.mrJpg) m.setMetallicRoughnessTexture(tex(doc, `Wear_${w.id}_metallicRoughness`, w.enc.mrJpg));
    wearMat.set(w.id, {mat: m, uv: acc(doc, buf, 'VEC2', w.uv), idx: acc(doc, buf, 'SCALAR', indexArray(w.idx, w.uv.length / 2))});
  }
  for (const B of bodies) {
    const holder = doc.createNode('Human_' + B.id);
    scene.addChild(holder);
    const nodes = {};
    for (const [name, parent] of JOINTS) {
      const t = parent ? V.sub(B.skel.joints[name], B.skel.joints[parent]) : B.skel.joints[name];
      nodes[name] = doc.createNode(`${B.id}_${name}`).setTranslation(t.map(v => +v.toFixed(6)));
      (parent ? nodes[parent] : holder).addChild(nodes[name]);
    }
    const ibm = new Float32Array(JOINTS.length * 16);
    JOINTS.forEach(([name], i) => { const p = B.skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
    const skin = doc.createSkin('HumanSkin_' + B.id).setSkeleton(nodes.Root).setInverseBindMatrices(acc(doc, buf, 'MAT4', ibm));
    for (const [name] of JOINTS) skin.addJoint(nodes[name]);
    // body
    const mat = doc.createMaterial(`HumanBody_${B.id}_Material`).setBaseColorTexture(tex(doc, `HumanBody_${B.id}_baseColor`, B.enc.baseJpg)).setMetallicFactor(1).setRoughnessFactor(1);
    if (B.enc.mrJpg) mat.setMetallicRoughnessTexture(tex(doc, `HumanBody_${B.id}_metallicRoughness`, B.enc.mrJpg));
    if (B.enc.normalJpg) mat.setNormalTexture(tex(doc, `HumanBody_${B.id}_normal`, B.enc.normalJpg));
    const M = B.mesh, q = quantizeWeights(M.joints, M.weights);
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc(doc, buf, 'VEC3', M.pos)).setAttribute('NORMAL', normals(doc, buf, M.nrm)).setAttribute('TEXCOORD_0', acc(doc, buf, 'VEC2', M.uv))
      .setAttribute('JOINTS_0', acc(doc, buf, 'VEC4', q.joints)).setAttribute('WEIGHTS_0', acc(doc, buf, 'VEC4', q.weights, true))
      .setIndices(acc(doc, buf, 'SCALAR', indexArray(M.idx, M.pos.length / 3)));
    holder.addChild(doc.createNode('HumanBody_' + B.id).setMesh(doc.createMesh('HumanBody_' + B.id).addPrimitive(prim)).setSkin(skin).setExtras(B.extras));
    // fitted wearables of this body (same skin)
    for (const w of wearables) for (const v of w.variants.filter(x => x.bodyId === B.id)) {
      const wm = wearMat.get(w.id), vq = quantizeWeights(v.joints, v.weights);
      const p = doc.createPrimitive().setMaterial(wm.mat)
        .setAttribute('POSITION', acc(doc, buf, 'VEC3', v.pos)).setAttribute('NORMAL', normals(doc, buf, v.nrm)).setAttribute('TEXCOORD_0', wm.uv)
        .setAttribute('JOINTS_0', acc(doc, buf, 'VEC4', vq.joints)).setAttribute('WEIGHTS_0', acc(doc, buf, 'VEC4', vq.weights, true))
        .setIndices(wm.idx);
      const name = `Wear_${w.id}__${B.id}`;
      holder.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)).setSkin(skin).setExtras(v.extras));
    }
    // the body's healthy clips
    for (const clip of B.clips) {
      const anim = doc.createAnimation(`${B.id}:${clip.name}`);
      const tAcc = acc(doc, buf, 'SCALAR', Float32Array.from(clip.times));
      for (const [jn, track] of Object.entries(clip.rot)) {
        const s = doc.createAnimationSampler().setInput(tAcc).setOutput(acc(doc, buf, 'VEC4', Float32Array.from(track.flat()))).setInterpolation('LINEAR');
        anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes[jn]).setTargetPath('rotation').setSampler(s));
      }
      const hipsT = clip.hips.map(o => V.add(V.sub(B.skel.joints.Hips, B.skel.joints.Root), o));
      const s = doc.createAnimationSampler().setInput(tAcc).setOutput(acc(doc, buf, 'VEC3', Float32Array.from(hipsT.flat()))).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.Hips).setTargetPath('translation').setSampler(s));
    }
  }
  return doc;
}
