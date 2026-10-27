// Runtime GLB for the creature: joint hierarchy (identity bind rotations), one skin, one
// SkinnedMesh "RatdogBody" (baseColor 1024 JPEG, metallicRoughness 512 JPEG, tangent-space normal
// 512 JPEG), sampled clips (rotation tracks for every joint + Hips translation).
import {Document, NodeIO} from '@gltf-transform/core';
import {JOINTS} from './skeleton.mjs';
import {qRot, V} from './rig.mjs';

export function buildDocument({skel, mesh, clips, generator, extras}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = generator;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Ratdog');
  if (extras) scene.setExtras(extras);
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => {
    const p = skel.joints[name];
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16);
  });
  const skin = doc.createSkin('RatdogSkin').setSkeleton(nodes.Root)
    .setInverseBindMatrices(doc.createAccessor('inverseBindMatrices').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  const tex = (nm, img) => doc.createTexture(nm).setImage(img).setMimeType('image/jpeg');
  const mat = doc.createMaterial(mesh.name + 'Material')
    .setBaseColorTexture(tex(mesh.name + '_baseColor', mesh.baseColor))
    .setMetallicRoughnessTexture(tex(mesh.name + '_metallicRoughness', mesh.metallicRoughness))
    .setNormalTexture(tex(mesh.name + '_normal', mesh.normal)).setNormalScale(mesh.normalScale ?? 1)
    .setMetallicFactor(1).setRoughnessFactor(1);
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', acc('VEC3', mesh.pos))
    .setAttribute('NORMAL', acc('VEC3', mesh.nrm))
    .setAttribute('TEXCOORD_0', acc('VEC2', mesh.uv))
    .setAttribute('JOINTS_0', acc('VEC4', mesh.joints))
    .setAttribute('WEIGHTS_0', acc('VEC4', mesh.weights))
    .setIndices(acc('SCALAR', mesh.pos.length / 3 < 65536 ? Uint16Array.from(mesh.idx) : mesh.idx));
  const node = doc.createNode(mesh.name).setMesh(doc.createMesh(mesh.name).addPrimitive(prim)).setSkin(skin);
  if (mesh.extras) node.setExtras(mesh.extras);
  scene.addChild(node);

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

export async function writeGLB(doc, file) {
  await new NodeIO().write(file, doc);
}

/** CPU linear-blend skinning for a world pose (QRig.fk). */
export function skinPositions(mesh, skel, world) {
  const names = JOINTS.map(j => j[0]);
  const n = mesh.pos.length / 3, out = new Float32Array(n * 3);
  const mats = names.map(nm => ({rot: world[nm].rot, pos: world[nm].pos, bind: skel.joints[nm]}));
  for (let i = 0; i < n; i++) {
    const v = [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[i * 4 + k]; if (!w) continue;
      const m = mats[mesh.joints[i * 4 + k]];
      const r = qRot(m.rot, [v[0] - m.bind[0], v[1] - m.bind[1], v[2] - m.bind[2]]);
      x += w * (r[0] + m.pos[0]); y += w * (r[1] + m.pos[1]); z += w * (r[2] + m.pos[2]);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}
