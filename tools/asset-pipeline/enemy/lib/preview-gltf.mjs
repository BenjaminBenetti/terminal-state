// Task studio-siren-clothing-refit-20261031-01 (lane PREVIEW): generic glTF read + clip sampling + linear-blend skinning for the
// human-review preview renders (tools/asset-pipeline/enemy/qa/siren-preview.mjs). Read-only: the GLB on disk is never modified.
//
// Semantics follow three.js (what the game renders with GLTFLoader + AnimationMixer + SkinnedMesh):
//  - every node of the scene graph is evaluated (not only the 18 body joints), so a garment-only helper joint / extra skin works;
//  - clip channels: translation / scale LINEAR = lerp, rotation LINEAR = slerp (three QuaternionLinearInterpolant), STEP = hold,
//    CUBICSPLINE = Hermite (three GLTFCubicSplineInterpolant); morph `weights` channels are applied to POSITION / NORMAL targets;
//    times outside [0, duration] clamp (LoopOnce + clampWhenFinished, or the loop's own end key);
//  - skinned vertex (world) = meshWorld * bindMatrixInverse * sum_k w_k (boneWorld_k * IBM_k) * bindMatrix * v with
//    bindMatrix = the mesh node's world matrix at rest (three.js SkinnedMesh.bind default). For the Siren the mesh nodes are
//    identity at the scene root, so this equals the glTF spec form sum_k w_k (boneWorld_k * IBM_k) * v.
import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';

const ID = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
export function inv4(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) throw new Error('singular matrix');
  const d = 1 / det;
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
}
function trs(t, q, s) {
  const [x, y, z, w] = q, [sx, sy, sz] = s;
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
}
function slerp(a, b, u) {
  let [bx, by, bz, bw] = b;
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka = 1 - u, kb = u;
  if (c < 0.9995) { const th = Math.acos(c), s = Math.sin(th); ka = Math.sin((1 - u) * th) / s; kb = Math.sin(u * th) / s; }
  const o = [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb];
  const l = Math.hypot(...o) || 1;
  return o.map(v => v / l);
}

const toFloat = acc => {
  const a = acc.getArray();
  if (a instanceof Float32Array) return a;
  const out = new Float32Array(a.length);
  if (!acc.getNormalized()) { for (let i = 0; i < a.length; i++) out[i] = a[i]; return out; }
  const max = a instanceof Uint8Array ? 255 : a instanceof Int8Array ? 127 : a instanceof Uint16Array ? 65535 : a instanceof Int16Array ? 32767 : 1;
  const signed = a instanceof Int8Array || a instanceof Int16Array;
  for (let i = 0; i < a.length; i++) out[i] = signed ? Math.max(a[i] / max, -1) : a[i] / max;
  return out;
};

/**
 * Reads a GLB into a flat evaluable structure.
 * @returns {file, doc, nodes:[{name, parent, t, r, s, matrix?}], prims:[{node, name, role, pos, nrm, uv, idx, joints, weights,
 *   targets, skinJoints (node indices), ibm, material}], clips:{name: {duration, channels}}, extras}
 */
export async function loadGlb(file, {roleOf} = {}) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
  const doc = await io.readBinary(fs.readFileSync(file));
  const root = doc.getRoot();
  const list = root.listNodes();
  const index = new Map(list.map((n, i) => [n, i]));
  const nodes = list.map(n => ({name: n.getName(), parent: -1, t: n.getTranslation().slice(), r: n.getRotation().slice(), s: n.getScale().slice(), weights: n.getWeights?.()?.slice() ?? []}));
  list.forEach((n, i) => { for (const c of n.listChildren()) nodes[index.get(c)].parent = i; });
  const scene = root.listScenes()[0];
  const inScene = new Set();
  const mark = n => { inScene.add(index.get(n)); n.listChildren().forEach(mark); };
  scene.listChildren().forEach(mark);
  const prims = [];
  for (const n of list) {
    if (!n.getMesh() || !inScene.has(index.get(n))) continue;
    const skin = n.getSkin();
    n.getMesh().listPrimitives().forEach((p, pi) => {
      if (p.getMode() !== 4) return;
      const get = s => (p.getAttribute(s) ? toFloat(p.getAttribute(s)) : null);
      const jAcc = p.getAttribute('JOINTS_0');
      const m = p.getMaterial();
      const tex = t => (t ? {bytes: t.getImage(), mime: t.getMimeType(), size: t.getSize()} : null);
      const pos = get('POSITION');
      const name = n.getName() + (pi ? `#${pi}` : '');
      prims.push({
        node: index.get(n), name, role: roleOf ? roleOf(n.getName(), m?.getName() ?? '') : /dress/i.test(n.getName()) ? 'dress' : 'body',
        pos, nrm: get('NORMAL'), uv: get('TEXCOORD_0'), idx: p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: pos.length / 3}, (_, i) => i),
        joints: jAcc ? Uint16Array.from(jAcc.getArray()) : null, weights: get('WEIGHTS_0'),
        targets: p.listTargets().map(t => ({pos: t.getAttribute('POSITION') ? toFloat(t.getAttribute('POSITION')) : null, nrm: t.getAttribute('NORMAL') ? toFloat(t.getAttribute('NORMAL')) : null})),
        skinJoints: skin ? skin.listJoints().map(j => index.get(j)) : null,
        ibm: skin ? (skin.getInverseBindMatrices() ? Float64Array.from(skin.getInverseBindMatrices().getArray()) : Float64Array.from({length: skin.listJoints().length * 16}, (_, k) => (k % 5 === 0 ? 1 : 0))) : null,
        material: m ? {
          name: m.getName(), doubleSided: m.getDoubleSided(), alphaMode: m.getAlphaMode(), baseColorFactor: m.getBaseColorFactor(),
          metallicFactor: m.getMetallicFactor(), roughnessFactor: m.getRoughnessFactor(), emissiveFactor: m.getEmissiveFactor(),
          normalScale: m.getNormalScale(), baseColor: tex(m.getBaseColorTexture()), metallicRoughness: tex(m.getMetallicRoughnessTexture()),
          normal: tex(m.getNormalTexture()), emissive: tex(m.getEmissiveTexture()),
        } : null,
        vertexCount: pos.length / 3, triangleCount: (p.getIndices() ? p.getIndices().getCount() : pos.length / 3) / 3,
      });
    });
  }
  const clips = {};
  for (const a of root.listAnimations()) {
    let duration = 0;
    const channels = a.listChannels().map(ch => {
      const s = ch.getSampler();
      const T = toFloat(s.getInput()), O = toFloat(s.getOutput());
      duration = Math.max(duration, T[T.length - 1]);
      return {node: index.get(ch.getTargetNode()), path: ch.getTargetPath(), interp: s.getInterpolation(), T, O};
    });
    clips[a.getName()] = {duration, channels};
  }
  const asset = {file, doc, nodes, prims, clips, extras: scene.getExtras() ?? {}};
  asset.restWorld = worldMatrices(asset, null);
  return asset;
}

function sampleChannel(ch, t) {
  const {T, O, path, interp} = ch, n = T.length;
  const k = path === 'rotation' ? 4 : path === 'weights' ? O.length / n / (interp === 'CUBICSPLINE' ? 3 : 1) : 3;
  const at = (i, part = 1) => { const stride = interp === 'CUBICSPLINE' ? 3 * k : k, o = i * stride + (interp === 'CUBICSPLINE' ? part * k : 0); return Array.from(O.subarray(o, o + k)); };
  if (t <= T[0] || n === 1) return at(0);
  if (t >= T[n - 1]) return at(n - 1);
  let i = 0; while (i < n - 2 && t >= T[i + 1]) i++;
  const dt = T[i + 1] - T[i], u = (t - T[i]) / dt;
  if (interp === 'STEP') return at(i);
  if (interp === 'CUBICSPLINE') {
    const p0 = at(i, 1), m0 = at(i, 2).map(v => v * dt), p1 = at(i + 1, 1), m1 = at(i + 1, 0).map(v => v * dt);
    const u2 = u * u, u3 = u2 * u;
    const v = p0.map((_, c) => (2 * u3 - 3 * u2 + 1) * p0[c] + (u3 - 2 * u2 + u) * m0[c] + (-2 * u3 + 3 * u2) * p1[c] + (u3 - u2) * m1[c]);
    if (path === 'rotation') { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }
    return v;
  }
  if (path === 'rotation') return slerp(at(i), at(i + 1), u);
  const a = at(i), b = at(i + 1);
  return a.map((v, c) => v + (b[c] - v) * u);
}

/** Local TRS (and morph weights) of every node for clip `name` at time t (rest when name is null). */
export function samplePose(asset, name, t) {
  const pose = asset.nodes.map(n => ({t: n.t.slice(), r: n.r.slice(), s: n.s.slice(), weights: n.weights.slice()}));
  if (name == null) return pose;
  const clip = asset.clips[name];
  if (!clip) throw new Error(`${asset.file}: no clip ${name} (has ${Object.keys(asset.clips).join(', ')})`);
  const tc = Math.min(Math.max(t, 0), clip.duration);
  for (const ch of clip.channels) {
    if (ch.node == null) continue;
    const v = sampleChannel(ch, tc);
    if (ch.path === 'translation') pose[ch.node].t = v; else if (ch.path === 'rotation') pose[ch.node].r = v;
    else if (ch.path === 'scale') pose[ch.node].s = v; else if (ch.path === 'weights') pose[ch.node].weights = v;
  }
  return pose;
}

/** World matrices (column-major arrays) of every node for a pose (null = rest). */
export function worldMatrices(asset, pose) {
  const P = pose ?? samplePose(asset, null, 0);
  const W = new Array(asset.nodes.length);
  const visit = i => {
    if (W[i]) return W[i];
    const local = trs(P[i].t, P[i].r, P[i].s);
    const par = asset.nodes[i].parent;
    W[i] = par < 0 ? local : mul4(visit(par), local);
    return W[i];
  };
  for (let i = 0; i < asset.nodes.length; i++) visit(i);
  return W;
}

/** World-space positions + normals of one primitive for a pose (three.js SkinnedMesh semantics, see header). */
export function posePrim(asset, prim, pose, world) {
  const W = world ?? worldMatrices(asset, pose);
  const n = prim.pos.length / 3;
  let base = prim.pos, baseN = prim.nrm;
  const mw = pose?.[prim.node]?.weights ?? asset.nodes[prim.node].weights;
  if (prim.targets.length && mw.some(v => v)) {
    base = Float32Array.from(prim.pos); baseN = prim.nrm ? Float32Array.from(prim.nrm) : null;
    prim.targets.forEach((tg, k) => { const w = mw[k] || 0; if (!w) return; if (tg.pos) for (let i = 0; i < base.length; i++) base[i] += w * tg.pos[i]; if (tg.nrm && baseN) for (let i = 0; i < baseN.length; i++) baseN[i] += w * tg.nrm[i]; });
  }
  const out = new Float32Array(n * 3), outN = new Float32Array(n * 3);
  if (!prim.skinJoints || !prim.joints || !prim.weights) {
    const M = W[prim.node];
    for (let i = 0; i < n; i++) xf(M, base, baseN, i, out, outN);
    return {pos: out, nrm: outN};
  }
  const bind = asset.restWorld[prim.node], bindInv = inv4(bind), meshW = W[prim.node];
  const pre = mul4(meshW, bindInv);
  const mats = prim.skinJoints.map((j, k) => mul4(pre, mul4(mul4(W[j], Array.from(prim.ibm.subarray(k * 16, k * 16 + 16))), bind)));
  const J = prim.joints, Wt = prim.weights;
  const m = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    m.fill(0);
    let tot = 0;
    for (let k = 0; k < 4; k++) {
      const w = Wt[i * 4 + k]; if (!w) continue;
      const M = mats[J[i * 4 + k]]; tot += w;
      for (let c = 0; c < 3; c++) { m[c * 3] += w * M[c * 4]; m[c * 3 + 1] += w * M[c * 4 + 1]; m[c * 3 + 2] += w * M[c * 4 + 2]; }
      m[9] += w * M[12]; m[10] += w * M[13]; m[11] += w * M[14];
    }
    void tot;
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    out[i * 3] = m[0] * x + m[3] * y + m[6] * z + m[9]; out[i * 3 + 1] = m[1] * x + m[4] * y + m[7] * z + m[10]; out[i * 3 + 2] = m[2] * x + m[5] * y + m[8] * z + m[11];
    if (baseN) {
      const a = baseN[i * 3], b = baseN[i * 3 + 1], c = baseN[i * 3 + 2];
      const nx = m[0] * a + m[3] * b + m[6] * c, ny = m[1] * a + m[4] * b + m[7] * c, nz = m[2] * a + m[5] * b + m[8] * c, l = Math.hypot(nx, ny, nz) || 1;
      outN[i * 3] = nx / l; outN[i * 3 + 1] = ny / l; outN[i * 3 + 2] = nz / l;
    }
  }
  return {pos: out, nrm: outN};
}
function xf(M, P, N, i, out, outN) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  out[i * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]; out[i * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; out[i * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  if (N) { const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]; const nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c, l = Math.hypot(nx, ny, nz) || 1; outN[i * 3] = nx / l; outN[i * 3 + 1] = ny / l; outN[i * 3 + 2] = nz / l; }
}

/** Every primitive posed: [{prim, pos, nrm}] (clip null = rest / bind). */
export function poseAll(asset, clip = null, t = 0, {scale = 1} = {}) {
  const pose = samplePose(asset, clip, t);
  const W = worldMatrices(asset, pose);
  return asset.prims.map(prim => {
    const r = posePrim(asset, prim, pose, W);
    if (scale !== 1) for (let i = 0; i < r.pos.length; i++) r.pos[i] *= scale;
    return {prim, ...r};
  });
}

export {ID};
