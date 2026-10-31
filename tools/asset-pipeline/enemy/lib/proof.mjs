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
    for (const [sem, a] of Object.entries(s.attributes)) {
      const b = o?.attributes[sem];
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
    const expect = transformPositions(m.pos, p.M);
    let maxErr = 0; for (let i = 0; i < expect.length; i++) maxErr = Math.max(maxErr, Math.abs(expect[i] - sk.pos[i]));
    let maxAng = 0, zeroNormals = 0;
    if (m.nrm && sk.nrm) {
      const en = transformNormals(m.nrm, p.M);
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
      bindPose: {maxPositionErrorM: +maxErr.toExponential(3), maxNormalAngleRad: +maxAng.toExponential(3), zeroLengthSourceNormalsSkipped: zeroNormals, equal: bindOk, rule: 'CPU glTF skinning at rest (JointWorld * IBM) vs M_fit * native, float32'},
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
