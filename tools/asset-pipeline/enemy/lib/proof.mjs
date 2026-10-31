// Task track1-siren-blightbelly-20261031 (lane RIGS): appearance-lock PROOF for a written Siren GLB against its verified sources.
//  1. byte equality: every source primitive attribute (POSITION / NORMAL / TEXCOORD_n / COLOR_n ...) and index accessor has the
//     same type / component / count / normalized flag and the SAME sha256 of its element bytes in the output;
//  2. materials: every material property / flag / texture slot is equal (texture slots compared by image sha256);
//  3. textures: the output carries exactly the source images (sha256 of the encoded bytes, mime type, size) — no extra, none
//     missing — and the DECODED pixels are identical (sha256 of raw RGBA from sharp, source vs output);
//  4. bind pose: CPU glTF skinning of the output at rest equals M_fit * v_native for every vertex (max error reported), and
//     skinned normals equal the rotated native normals (max angle) — i.e. positions are unchanged up to the recorded uniform
//     transform, applied only through the skins' inverse bind matrices.
import crypto from 'node:crypto';
import sharp from 'sharp';
import {fingerprint, transformPositions, transformNormals} from './native-glb.mjs';
import {loadRigged, jointWorld, skinMesh} from './siren-glb.mjs';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const texKeyed = (m, fp) => {
  if (!m) return m;
  const out = {...m};
  for (const k of Object.keys(out)) if (out[k] && typeof out[k] === 'object' && 'texture' in out[k]) out[k] = {...out[k], texture: fp.textures[out[k].texture]?.sha256 ?? null};
  return out;
};

async function rawPixelsSha(bytes) {
  const {data, info} = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {sha256: sha(data), width: info.width, height: info.height};
}

/**
 * @param out written GLB path
 * @param parts [{name, srcDoc, M, srcFile, srcSha256}] (source documents as read from the verified uploads)
 */
export async function proveAppearance(out, parts) {
  const R = await loadRigged(out);
  const outFp = fingerprint(R.doc);
  const result = {file: out, parts: [], textures: null, ok: true};
  const allSrcTex = [];
  for (const p of parts) {
    const srcFp = fingerprint(p.srcDoc);
    allSrcTex.push(...srcFp.textures);
    const m = R.meshes.find(x => x.name === p.name);
    const o = outFp.primitives.find(x => x.mesh === p.name);
    const s = srcFp.primitives[0];
    const attrs = {};
    let ok = !!o && !!m;
    const refitSems = p.refit ? ['POSITION', 'NORMAL'] : [];
    for (const [sem, a] of Object.entries(s.attributes)) {
      const b = o?.attributes[sem];
      if (refitSems.includes(sem)) {
        // user-authorised garment refit: the attribute is re-derived (same type / count); it must be exactly the refit array
        const want = sha(Buffer.from(Float32Array.from(p.refit[sem === 'POSITION' ? 'pos' : 'nrm']).buffer));
        const eq = !!b && ['type', 'componentType', 'normalized', 'count'].every(k => a[k] === b[k]) && b.sha256 === want;
        attrs[sem] = {count: a.count, sourceSha256: a.sha256, sha256: b?.sha256 ?? null, refit: true, equalToRefit: eq, equal: eq};
        ok &&= eq;
        continue;
      }
      const eq = !!b && ['type', 'componentType', 'normalized', 'count', 'sha256'].every(k => a[k] === b[k]);
      attrs[sem] = {count: a.count, sha256: a.sha256, equal: eq};
      ok &&= eq;
    }
    const extraAttrs = o ? Object.keys(o.attributes).filter(k => !(k in s.attributes)) : [];
    const idxEq = !!o && JSON.stringify(s.indices) === JSON.stringify(o.indices);
    const matEq = JSON.stringify(texKeyed(s.material, srcFp)) === JSON.stringify(texKeyed(o?.material, outFp));
    ok &&= idxEq && matEq && extraAttrs.length === 0 && o.mode === s.mode;
    // bind pose = M * native
    const world = jointWorld(R, null);
    const sk = skinMesh(m, world, true);
    const expect = p.refit ? Float32Array.from(p.refit.pos) : transformPositions(m.pos, p.M);
    let maxErr = 0; for (let i = 0; i < expect.length; i++) maxErr = Math.max(maxErr, Math.abs(expect[i] - sk.pos[i]));
    let maxAng = 0, zeroNormals = 0;
    if (m.nrm && sk.nrm) {
      const en = p.refit ? Float32Array.from(p.refit.nrm) : transformNormals(m.nrm, p.M);
      for (let i = 0; i < en.length; i += 3) {
        // zero-length source normals (degenerate in the supplied data, carried over byte-identical) have no direction to compare
        if (Math.hypot(m.nrm[i], m.nrm[i + 1], m.nrm[i + 2]) < 1e-6) { zeroNormals++; continue; }
        const d = en[i] * sk.nrm[i] + en[i + 1] * sk.nrm[i + 1] + en[i + 2] * sk.nrm[i + 2];
        maxAng = Math.max(maxAng, Math.acos(Math.min(1, Math.max(-1, d))));
      }
    }
    const bindOk = maxErr < 2e-5 && maxAng < 1e-3;
    ok &&= bindOk;
    // weights: every row sums to exactly 255 (normalised UNSIGNED_BYTE)
    let wBad = 0; for (let i = 0; i < m.weights.length; i += 4) if (m.weights[i] + m.weights[i + 1] + m.weights[i + 2] + m.weights[i + 3] !== 255) wBad++;
    ok &&= wBad === 0;
    result.parts.push({name: p.name, source: {file: p.srcFile, sha256: p.srcSha256}, mode: s.mode, attributes: attrs, indices: {...s.indices, equal: idxEq}, materialEqual: matEq, attributesAdded: ['JOINTS_0', 'WEIGHTS_0'], unexpectedAttributes: extraAttrs,
      bindPose: {maxPositionErrorM: +maxErr.toExponential(3), maxNormalAngleRad: +maxAng.toExponential(3), zeroLengthSourceNormalsSkipped: zeroNormals, equal: bindOk, rule: p.refit ? 'CPU glTF skinning at rest (JointWorld * IBM) vs the refit POSITION / NORMAL (M = identity), float32' : 'CPU glTF skinning at rest (JointWorld * IBM) vs M_fit * native, float32'},
      weightRowsNot255: wBad, ok});
    result.ok &&= ok;
  }
  // textures: exact multiset of encoded images + decoded pixels
  const srcSet = allSrcTex.map(t => t.sha256).sort(), outSet = outFp.textures.map(t => t.sha256).sort();
  const texOk = JSON.stringify(srcSet) === JSON.stringify(outSet);
  const pixels = [];
  for (const t of outFp.textures) {
    const srcT = allSrcTex.find(x => x.sha256 === t.sha256);
    const outImg = R.doc.getRoot().listTextures()[t.index].getImage();
    const srcImg = parts.flatMap(p => p.srcDoc.getRoot().listTextures()).find(x => sha(x.getImage()) === t.sha256)?.getImage();
    const a = await rawPixelsSha(outImg), b = srcImg ? await rawPixelsSha(srcImg) : null;
    pixels.push({sha256: t.sha256, mimeType: t.mimeType, bytes: t.bytes, size: t.size, sourceMime: srcT?.mimeType, decodedPixelsSha256: a.sha256, sourceDecodedPixelsSha256: b?.sha256 ?? null, pixelsEqual: !!b && a.sha256 === b.sha256 && a.width === b.width});
  }
  const pixOk = pixels.every(p => p.pixelsEqual && p.mimeType === p.sourceMime);
  result.textures = {count: outSet.length, encodedBytesEqual: texOk, pixelsEqual: pixOk, items: pixels};
  result.ok &&= texOk && pixOk;
  result.extensionsUsed = outFp.extensionsUsed;
  return result;
}

// ------------------------------------------------------------------------------------------------ body invariance (refit task)
const accSha = a => (a ? {type: a.getType(), componentType: a.getComponentType(), normalized: a.getNormalized(), count: a.getCount(), sha256: sha(Buffer.from(a.getArray().buffer, a.getArray().byteOffset, a.getArray().byteLength))} : null);

/**
 * Task siren-clothing-refit-20261031: the BODY of a written Siren GLB is identical to a reference build (main's asset): every body
 * primitive attribute incl. JOINTS_0 / WEIGHTS_0 and the indices (sha256 of the raw bytes), its material (texture slots by image
 * sha256) and texture bytes, its skin (joint names, inverse bind matrices bytes), the joint hierarchy and every joint's bind TRS, every
 * animation (names, channels: target / path, sampler interpolation, input / output bytes) and the gameplay extras (clips, hitRadii,
 * heightM, ends, joints, archetype, modelSpace). Also the dress's UVs / indices / material / textures vs the reference. Returns
 * {ok, ...per-item results, extrasChanged: keys that differ (dress-dependent bounds are expected to)}.
 */
export async function proveBodyInvariance(outFile, refFile) {
  const read = async f => (await loadRigged(f)).doc;
  const [A, B] = [await read(outFile), await read(refFile)];
  const node = (d, n) => d.getRoot().listNodes().find(x => x.getName() === n);
  const res = {reference: refFile, items: {}, ok: true};
  const put = (k, eq, detail = {}) => { res.items[k] = {equal: eq, ...detail}; res.ok &&= eq; };
  const bodyA = node(A, 'SirenBody').getMesh().listPrimitives()[0], bodyB = node(B, 'SirenBody').getMesh().listPrimitives()[0];
  for (const sem of [...new Set([...bodyA.listSemantics(), ...bodyB.listSemantics()])]) { const a = accSha(bodyA.getAttribute(sem)), b = accSha(bodyB.getAttribute(sem)); put('body.' + sem, JSON.stringify(a) === JSON.stringify(b), {sha256: a?.sha256, count: a?.count}); }
  { const a = accSha(bodyA.getIndices()), b = accSha(bodyB.getIndices()); put('body.indices', JSON.stringify(a) === JSON.stringify(b), {sha256: a?.sha256, count: a?.count}); }
  const fpA = fingerprint(A), fpB = fingerprint(B);
  const matOf = (fp, mesh) => JSON.stringify(texKeyed(fp.primitives.find(x => x.mesh === mesh)?.material, fp));
  put('body.material', matOf(fpA, 'SirenBody') === matOf(fpB, 'SirenBody'));
  put('textures.bytes', JSON.stringify(fpA.textures.map(t => t.sha256).sort()) === JSON.stringify(fpB.textures.map(t => t.sha256).sort()), {sha256: fpA.textures.map(t => t.sha256)});
  const skinA = node(A, 'SirenBody').getSkin(), skinB = node(B, 'SirenBody').getSkin();
  put('body.skin.joints', JSON.stringify(skinA.listJoints().map(j => j.getName())) === JSON.stringify(skinB.listJoints().map(j => j.getName())));
  { const a = accSha(skinA.getInverseBindMatrices()), b = accSha(skinB.getInverseBindMatrices()); put('body.skin.inverseBindMatrices', JSON.stringify(a) === JSON.stringify(b), {sha256: a.sha256}); }
  const joints = d => node(d, 'SirenBody').getSkin().listJoints().map(j => ({name: j.getName(), parent: j.getParentNode()?.getName() ?? null, t: j.getTranslation(), r: j.getRotation(), s: j.getScale()}));
  put('skeleton.jointsTRS', JSON.stringify(joints(A)) === JSON.stringify(joints(B)), {joints: joints(A).length});
  const anims = d => d.getRoot().listAnimations().map(an => ({name: an.getName(), channels: an.listChannels().map(c => ({target: c.getTargetNode().getName(), path: c.getTargetPath(), interpolation: c.getSampler().getInterpolation(), input: accSha(c.getSampler().getInput()).sha256, output: accSha(c.getSampler().getOutput()).sha256}))}));
  put('animations', JSON.stringify(anims(A)) === JSON.stringify(anims(B)), {clips: anims(A).map(a => [a.name, a.channels.length])});
  const exA = A.getRoot().listScenes()[0].getExtras().enemySiren ?? {}, exB = B.getRoot().listScenes()[0].getExtras().enemySiren ?? {};
  const GAMEPLAY = ['clips', 'hitRadii', 'heightM', 'ends', 'joints', 'archetype', 'modelSpace', 'meshes', 'version'];
  for (const k of GAMEPLAY) put('extras.' + k, JSON.stringify(exA[k]) === JSON.stringify(exB[k]));
  res.extrasChanged = [...new Set([...Object.keys(exA), ...Object.keys(exB)])].filter(k => JSON.stringify(exA[k]) !== JSON.stringify(exB[k]));
  const dA = node(A, 'SirenDress').getMesh().listPrimitives()[0], dB = node(B, 'SirenDress').getMesh().listPrimitives()[0];
  for (const sem of ['TEXCOORD_0']) { const a = accSha(dA.getAttribute(sem)), b = accSha(dB.getAttribute(sem)); put('dress.' + sem, JSON.stringify(a) === JSON.stringify(b), {sha256: a?.sha256}); }
  { const a = accSha(dA.getIndices()), b = accSha(dB.getIndices()); put('dress.indices', JSON.stringify(a) === JSON.stringify(b), {sha256: a?.sha256}); }
  put('dress.material', matOf(fpA, 'SirenDress') === matOf(fpB, 'SirenDress'));
  res.dressChanged = Object.fromEntries(['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0'].map(sem => [sem, {reference: accSha(dB.getAttribute(sem))?.sha256, output: accSha(dA.getAttribute(sem))?.sha256}]));
  { const a = accSha(node(A, 'SirenDress').getSkin().getInverseBindMatrices()), b = accSha(node(B, 'SirenDress').getSkin().getInverseBindMatrices()); res.dressChanged.inverseBindMatrices = {reference: b.sha256, output: a.sha256}; }
  return res;
}
