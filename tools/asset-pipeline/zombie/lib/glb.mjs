// Assemble the runtime GLB: joint hierarchy (identity bind rotations), one shared skin,
// SkinnedMesh nodes "ZombieBody"/"ZombieCoat", per-mesh materials and sampled clips.
import {Document, NodeIO} from '@gltf-transform/core';
import {JOINTS} from './skeleton.mjs';
import {V} from './pose.mjs';

export function buildDocument({skel, meshes, clips, generator}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = generator;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Zombie');
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
  const skin = doc.createSkin('ZombieSkin').setSkeleton(nodes.Root)
    .setInverseBindMatrices(doc.createAccessor('inverseBindMatrices').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);

  for (const m of meshes) {
    const tex = doc.createTexture(m.name + '_baseColor').setImage(m.baseColor).setMimeType('image/jpeg');
    const mrt = doc.createTexture(m.name + '_metallicRoughness').setImage(m.metallicRoughness).setMimeType('image/jpeg');
    const mat = doc.createMaterial(m.name + 'Material').setBaseColorTexture(tex).setMetallicRoughnessTexture(mrt)
      .setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(!!m.doubleSided);
    const acc = (type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc('VEC3', m.pos))
      .setAttribute('NORMAL', acc('VEC3', m.nrm))
      .setAttribute('TEXCOORD_0', acc('VEC2', m.uv))
      .setAttribute('JOINTS_0', acc('VEC4', m.joints))
      .setAttribute('WEIGHTS_0', acc('VEC4', m.weights))
      .setIndices(acc('SCALAR', m.idx.length / 3 < 65536 && m.pos.length / 3 < 65536 ? Uint16Array.from(m.idx) : m.idx));
    const node = doc.createNode(m.name).setMesh(doc.createMesh(m.name).addPrimitive(prim)).setSkin(skin);
    scene.addChild(node);
  }

  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const times = Float32Array.from(clip.times);
    const tAcc = doc.createAccessor(clip.name + '_t').setType('SCALAR').setArray(times).setBuffer(buf);
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
  const io = new NodeIO();
  await io.write(file, doc);
}

/** CPU linear-blend skinning of a mesh for a world-joint pose (from Rig.fk). */
export function skinPositions(mesh, skel, world) {
  const names = JOINTS.map(j => j[0]);
  const n = mesh.pos.length / 3, out = new Float32Array(n * 3);
  const mats = names.map(nm => ({rot: world[nm].rot, pos: world[nm].pos, bind: skel.joints[nm]}));
  const rot = (q, v) => {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  for (let i = 0; i < n; i++) {
    const v = [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[i * 4 + k]; if (!w) continue;
      const m = mats[mesh.joints[i * 4 + k]];
      const r = rot(m.rot, [v[0] - m.bind[0], v[1] - m.bind[1], v[2] - m.bind[2]]);
      x += w * (r[0] + m.pos[0]); y += w * (r[1] + m.pos[1]); z += w * (r[2] + m.pos[2]);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}
