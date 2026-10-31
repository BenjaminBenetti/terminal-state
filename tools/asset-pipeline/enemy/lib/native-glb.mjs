// Task track1-siren-blightbelly-20261031 (lane RIGS): LOSSLESS access to a user-supplied, appearance-locked source GLB.
// The source document is read with gltf-transform and is never modified on disk. Accessor arrays (POSITION / NORMAL /
// TEXCOORD_n / indices) and image byte buffers are kept as the exact typed arrays / Uint8Arrays that were read; analysis
// works on SEPARATE game-space copies (Float64 math, Float32 storage) that are never written to the runtime GLB.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

export const sha256Buf = b => crypto.createHash('sha256').update(b).digest('hex');
export const sha256File = f => sha256Buf(fs.readFileSync(f));
const bytesOf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
export const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Reads a pinned source GLB: refuses on a SHA-256 mismatch. */
export async function readSource(file, expectSha) {
  const sha = sha256File(file);
  if (expectSha && sha !== expectSha) throw new Error(`${file}: sha256 ${sha} != pinned ${expectSha}`);
  const doc = await io().read(file);
  return {file, sha256: sha, bytes: fs.statSync(file).size, doc};
}

/**
 * Lossless fingerprint of a document's appearance-defining data: every primitive attribute / index accessor (sha256 of the
 * raw element bytes + type / component / normalized / count), every material (all core factors, flags and texture slots),
 * every texture (mime, size and sha256 of the image bytes). Used for the before / after equality proof.
 */
export function fingerprint(doc) {
  const root = doc.getRoot();
  const tex = root.listTextures();
  const prims = [];
  for (const mesh of root.listMeshes()) for (const [pi, p] of mesh.listPrimitives().entries()) {
    const attrs = {};
    for (const s of p.listSemantics()) {
      if (s === 'JOINTS_0' || s === 'WEIGHTS_0') continue; // added by the rig (not part of the appearance)
      const a = p.getAttribute(s);
      attrs[s] = {type: a.getType(), componentType: a.getComponentType(), normalized: a.getNormalized(), count: a.getCount(), sha256: sha256Buf(bytesOf(a.getArray()))};
    }
    const ix = p.getIndices();
    const m = p.getMaterial();
    prims.push({mesh: mesh.getName(), prim: pi, mode: p.getMode(), attributes: attrs,
      indices: ix ? {componentType: ix.getComponentType(), count: ix.getCount(), sha256: sha256Buf(bytesOf(ix.getArray()))} : null,
      material: m ? materialFingerprint(m, tex) : null, targets: p.listTargets().length});
  }
  return {primitives: prims, textures: tex.map((t, i) => ({index: i, name: t.getName(), mimeType: t.getMimeType(), size: t.getSize(), bytes: t.getImage().byteLength, sha256: sha256Buf(bytesOf(t.getImage()))})),
    extensionsUsed: root.listExtensionsUsed().map(e => e.extensionName).sort()};
}

function materialFingerprint(m, tex) {
  const slot = (t, info) => t ? {texture: tex.indexOf(t), texCoord: info?.getTexCoord() ?? 0, wrapS: info?.getWrapS(), wrapT: info?.getWrapT(), magFilter: info?.getMagFilter(), minFilter: info?.getMinFilter()} : null;
  return {name: m.getName(), alphaMode: m.getAlphaMode(), alphaCutoff: m.getAlphaCutoff(), doubleSided: m.getDoubleSided(),
    baseColorFactor: m.getBaseColorFactor(), emissiveFactor: m.getEmissiveFactor(), metallicFactor: m.getMetallicFactor(), roughnessFactor: m.getRoughnessFactor(),
    normalScale: m.getNormalScale(), occlusionStrength: m.getOcclusionStrength(),
    baseColorTexture: slot(m.getBaseColorTexture(), m.getBaseColorTextureInfo()), metallicRoughnessTexture: slot(m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()),
    normalTexture: slot(m.getNormalTexture(), m.getNormalTextureInfo()), occlusionTexture: slot(m.getOcclusionTexture(), m.getOcclusionTextureInfo()),
    emissiveTexture: slot(m.getEmissiveTexture(), m.getEmissiveTextureInfo()), extensions: m.listExtensions().map(e => e.extensionName).sort()};
}

/** The single mesh node of a source (the supplied uploads have exactly one node / mesh / primitive). */
export function singlePrimitive(doc, label) {
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1) throw new Error(`${label}: expected one mesh node, found ${nodes.length}`);
  const prims = nodes[0].getMesh().listPrimitives();
  if (prims.length !== 1) throw new Error(`${label}: expected one primitive, found ${prims.length}`);
  const p = prims[0];
  if (p.getMode() !== 4) throw new Error(`${label}: primitive mode ${p.getMode()} (triangles required)`);
  if (doc.getRoot().listSkins().length || doc.getRoot().listAnimations().length) throw new Error(`${label}: source already has skins / animations`);
  return {node: nodes[0], prim: p, world: nodes[0].getWorldMatrix()};
}

// ---------------------------------------------------------------------------------------------- similarity transforms
// S(v) = s * Ry(yaw) * (M_node * v) + t   (column-major 4x4 like glTF). Only uniform scale + rotation about Y + translation.
export function similarityMatrix({scale, yawDeg = 0, t = [0, 0, 0]}, node = null) {
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  const S = [scale * c, 0, -scale * s, 0, 0, scale, 0, 0, scale * s, 0, scale * c, 0, t[0], t[1], t[2], 1];
  return node ? mat4Mul(S, node) : S;
}
export function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
/** Applies a column-major 4x4 to positions (Float64 math) -> new Float32Array (analysis copy). */
export function transformPositions(pos, M) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
    out[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
    out[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
  }
  return out;
}
/** Rotates (and renormalises) normals by the linear part of a similarity. */
export function transformNormals(nrm, M) {
  const out = new Float32Array(nrm.length);
  for (let i = 0; i < nrm.length; i += 3) {
    const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
    const a = M[0] * x + M[4] * y + M[8] * z, b = M[1] * x + M[5] * y + M[9] * z, c = M[2] * x + M[6] * y + M[10] * z;
    const l = Math.hypot(a, b, c) || 1;
    out[i] = a / l; out[i + 1] = b / l; out[i + 2] = c / l;
  }
  return out;
}
/** Uniform scale factor of a similarity matrix (asserts orthogonality up to 1e-9 relative). */
export function similarityScale(M) {
  const cols = [0, 1, 2].map(c => [M[c * 4], M[c * 4 + 1], M[c * 4 + 2]]);
  const l = cols.map(v => Math.hypot(...v));
  if (Math.max(...l) - Math.min(...l) > 1e-9 * Math.max(...l)) throw new Error('not a uniform similarity: column lengths ' + l.join(', '));
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (Math.abs(cols[a][0] * cols[b][0] + cols[a][1] * cols[b][1] + cols[a][2] * cols[b][2]) > 1e-9 * l[0] * l[0]) throw new Error('not a similarity: skewed axes');
  return l[0];
}
