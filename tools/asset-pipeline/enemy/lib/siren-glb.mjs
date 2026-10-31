// Task track1-siren-blightbelly-20261031 (lane RIGS): runtime GLB assembly for the appearance-locked Siren, and spec-exact
// CPU skinning of the WRITTEN file (for proofs / renders).
// Assembly is lossless repackaging of the supplied documents:
//  - the body document is read fresh from the verified upload; the dress document is merged into it
//    (@gltf-transform/functions mergeDocuments); the dress node moves into the main scene; all accessors share one buffer;
//  - POSITION / NORMAL / TEXCOORD_n / index accessors, materials, textures and image bytes are the source objects themselves
//    (typed arrays / Uint8Arrays as read; nothing decoded, re-encoded, quantised or re-indexed);
//  - ADDED: JOINTS_0 (UNSIGNED_BYTE) + WEIGHTS_0 (normalised UNSIGNED_BYTE, rows sum to exactly 255) per native vertex, an
//    18-joint hierarchy (identity bind rotations, game metres), one skin per mesh sharing the joints, the clips, scene extras;
//  - parts may REPLACE attributes (p.replace, e.g. the refitted dress POSITION / NORMAL in game metres with M = identity);
//  - the uniform unit-fit (scale + Y rotation + translation, incl. any source node transform) is folded into each skin's
//    inverse bind matrices: IBM_j = T(-J_j) * M_fit. Mesh nodes sit at the scene root with identity transforms, so both the
//    glTF spec (node transform of a skinned mesh ignored) and three.js (bindMatrix = node world = identity) render the bind
//    pose as M_fit * v_native.
import fs from 'node:fs';
import {mergeDocuments} from '@gltf-transform/functions';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {quantizeWeights} from '../../zombie/lib/variant-glb.mjs';
import {io} from './native-glb.mjs';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = m => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

/** IBM_j = T(-J) * M (column-major). */
export function ibmFor(J, M) {
  const o = M.slice();
  o[12] = M[12] - J[0]; o[13] = M[13] - J[1]; o[14] = M[14] - J[2];
  return o;
}

/**
 * @param parts [{file, sha256, name ('SirenBody' | 'SirenDress'), M (column-major fit incl. node transform), joints, weights}]
 * @param skel {joints}
 * @param clips [{name, times, rot: {joint: [quat]}, hips: [[x,y,z]]}]
 */
export async function assembleDocument({parts, skel, clips, extras, extrasKey = 'enemySiren', generator}) {
  const doc = await io().readBinary(fs.readFileSync(parts[0].file));
  const docs = [doc];
  for (const p of parts.slice(1)) { const d = await io().readBinary(fs.readFileSync(p.file)); mergeDocuments(doc, d); docs.push(d); }
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  // one mesh node per part, in part order (sources have exactly one mesh node each)
  const meshNodes = root.listNodes().filter(n => n.getMesh());
  if (meshNodes.length !== parts.length) throw new Error(`expected ${parts.length} mesh nodes, found ${meshNodes.length}`);
  for (const s of root.listScenes().slice(1)) s.dispose();
  for (const n of meshNodes) { for (const par of n.listParents()) if (par !== root && par.removeChild) par.removeChild(n); }
  const buf = root.listBuffers()[0];
  for (const a of root.listAccessors()) a.setBuffer(buf);
  for (const b of root.listBuffers().slice(1)) b.dispose();
  doc.getRoot().getAsset().generator = generator;

  // joints
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? skel.joints[name].map((v, k) => v - skel.joints[parent][k]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const report = [];
  parts.forEach((p, i) => {
    const node = meshNodes[i];
    const nodeM = node.getMatrix();
    if (!isIdentity(nodeM)) throw new Error(`${p.name}: source node transform must be folded into M (got non-identity local matrix)`);
    node.setName(p.name).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    node.getMesh().setName(p.name);
    scene.addChild(node);
    const ibm = new Float32Array(JOINTS.length * 16);
    JOINTS.forEach(([name], j) => ibm.set(ibmFor(skel.joints[name], p.M), j * 16));
    const skin = doc.createSkin(p.name + 'Skin').setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor(p.name + '_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
    for (const [name] of JOINTS) skin.addJoint(nodes[name]);
    node.setSkin(skin);
    const prim = node.getMesh().listPrimitives()[0];
    // garment refit (task siren-clothing-refit-20261031): re-derived attributes replace the source accessors (same count / type);
    // indices, UVs, material and textures stay the source objects
    for (const [sem, arr] of Object.entries(p.replace ?? {})) {
      const old = prim.getAttribute(sem);
      if (!old || old.getCount() * old.getElementSize() !== arr.length) throw new Error(`${p.name}: replacement ${sem} does not match the source accessor`);
      prim.setAttribute(sem, doc.createAccessor(`${p.name}_${sem.toLowerCase()}_refit`).setType(old.getType()).setArray(Float32Array.from(arr)).setBuffer(buf));
      if (!old.listParents().some(x => x !== root && x !== old)) old.dispose();
    }
    const q = quantizeWeights(p.joints, p.weights);
    prim.setAttribute('JOINTS_0', doc.createAccessor(p.name + '_joints').setType('VEC4').setArray(q.joints).setBuffer(buf));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor(p.name + '_weights').setType('VEC4').setArray(q.weights).setNormalized(true).setBuffer(buf));
    report.push({name: p.name, vertices: prim.getAttribute('POSITION').getCount(), skin: p.name + 'Skin'});
  });
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const tAcc = doc.createAccessor(clip.name + '_t').setType('SCALAR').setArray(Float32Array.from(clip.times)).setBuffer(buf);
    for (const [jn, track] of Object.entries(clip.rot)) {
      const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC4').setArray(Float32Array.from(track.flat())).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes[jn]).setTargetPath('rotation').setSampler(s));
    }
    const base = skel.joints.Hips.map((v, k) => v - skel.joints.Root[k]);
    const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(clip.hips.flatMap(o => [base[0] + o[0], base[1] + o[1], base[2] + o[2]]))).setBuffer(buf)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.Hips).setTargetPath('translation').setSampler(s));
  }
  scene.setName('Siren').setExtras({[extrasKey]: extras});
  return {doc, report};
}

// ------------------------------------------------------------------------------------------------ CPU skinning of a written GLB
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
function trsMatrix(p, q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, p[0], p[1], p[2], 1];
}
function mul4(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

/** Reads a written Siren GLB for CPU posing: meshes (native arrays), skins (IBM), joints, animations. */
export async function loadRigged(fileOrDoc) {
  const doc = typeof fileOrDoc === 'string' ? await io().read(fileOrDoc) : fileOrDoc;
  const root = doc.getRoot();
  const meshes = root.listNodes().filter(n => n.getMesh() && n.getSkin()).map(n => {
    const prim = n.getMesh().listPrimitives()[0], skin = n.getSkin();
    const get = s => prim.getAttribute(s)?.getArray() ?? null;
    return {name: n.getName(), node: n, prim, pos: get('POSITION'), nrm: get('NORMAL'), uv: get('TEXCOORD_0'), idx: prim.getIndices()?.getArray(), joints: get('JOINTS_0'), weights: get('WEIGHTS_0'),
      weightsNormalized: prim.getAttribute('WEIGHTS_0').getNormalized(), skinJoints: skin.listJoints(), ibm: skin.getInverseBindMatrices().getArray(), material: prim.getMaterial()};
  });
  const joints = meshes[0].skinJoints;
  return {doc, meshes, joints, names: joints.map(j => j.getName()), anims: root.listAnimations(), extras: root.listScenes()[0].getExtras()};
}

/** Joint world matrices for a clip time (rest pose when clipName is null). */
export function jointWorld(R, clipName = null, t = 0) {
  const local = R.joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()}));
  const anim = clipName && R.anims.find(a => a.getName() === clipName);
  if (clipName && !anim) throw new Error('no clip ' + clipName);
  if (anim) for (const ch of anim.listChannels()) {
    const ji = R.joints.indexOf(ch.getTargetNode()); if (ji < 0) continue;
    const s = ch.getSampler(), T = s.getInput().getArray(), O = s.getOutput().getArray(), k = ch.getTargetPath() === 'rotation' ? 4 : 3;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - T[i]) / ((T[i + 1] - T[i]) || 1)));
    const v = Array.from({length: k}, (_, q) => O[i * k + q] * (1 - u) + O[(i + 1) * k + q] * u);
    if (k === 4) { const l = Math.hypot(...v); local[ji].q = v.map(x => x / l); } else local[ji].p = v;
  }
  const world = [];
  R.joints.forEach((j, i) => {
    const pi = R.joints.indexOf(j.getParentNode());
    if (pi < 0) world[i] = {q: local[i].q, p: local[i].p};
    else { const P = world[pi]; world[i] = {q: qmul(P.q, local[i].q), p: qrot(P.q, local[i].p).map((v, c) => v + P.p[c])}; }
  });
  return world.map(w => trsMatrix(w.p, w.q));
}

/** glTF linear blend skinning: v' = sum_k w_k * (JointWorld_k * IBM_k) * v. Returns Float32Array positions (and normals). */
export function skinMesh(m, world, withNormals = false) {
  const mats = m.skinJoints.map((j, k) => mul4(world[k], Array.from(m.ibm.subarray(k * 16, k * 16 + 16))));
  const n = m.pos.length / 3, out = new Float32Array(n * 3), nout = withNormals && m.nrm ? new Float32Array(n * 3) : null;
  const wScale = m.weightsNormalized && m.weights instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < n; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.weights[i * 4 + k] * wScale; if (!w) continue;
      const M = mats[m.joints[i * 4 + k]];
      ox += w * (M[0] * x + M[4] * y + M[8] * z + M[12]); oy += w * (M[1] * x + M[5] * y + M[9] * z + M[13]); oz += w * (M[2] * x + M[6] * y + M[10] * z + M[14]);
      if (nout) { const a = m.nrm[i * 3], b = m.nrm[i * 3 + 1], c = m.nrm[i * 3 + 2]; nx += w * (M[0] * a + M[4] * b + M[8] * c); ny += w * (M[1] * a + M[5] * b + M[9] * c); nz += w * (M[2] * a + M[6] * b + M[10] * c); }
    }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    if (nout) { const l = Math.hypot(nx, ny, nz) || 1; nout[i * 3] = nx / l; nout[i * 3 + 1] = ny / l; nout[i * 3 + 2] = nz / l; }
  }
  return withNormals ? {pos: out, nrm: nout} : out;
}
