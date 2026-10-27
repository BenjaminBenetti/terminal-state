// Generic read-only loader for a static AI-reconstructed source GLB (body or garment master).
// Unlike master.mjs (fixed iteration-01 masters), this accepts any sha256-pinned file, bakes node
// transforms into the positions, merges primitives that share one material/texture set, and
// synthesises a constant metallicRoughness texture when the source has none.
// Sources are never written; every derivative is produced in memory and saved elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {REPO, sha256File} from './master.mjs';
import {computeNormals} from './mesh.mjs';

const mul4 = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/**
 * @param src {id, file (repo-relative or absolute), sha256, uploadId?}
 * @returns same shape as master.mjs loadMaster: {pos, nrm, uv, idx, baseColor, metallicRoughness, material, ...}
 */
export async function loadSource(src) {
  const abs = path.isAbsolute(src.file) ? src.file : path.join(REPO, src.file);
  const sha = sha256File(abs);
  if (src.sha256 && sha !== src.sha256) throw new Error(`${src.id}: sha256 mismatch ${sha} != ${src.sha256}`);
  const bytes = fs.statSync(abs).size;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(abs);
  const items = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const wm = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) items.push({p, wm});
  }
  if (!items.length) throw new Error(`${src.id}: no mesh primitives`);
  const mats = [...new Set(items.map(i => i.p.getMaterial()))];
  const texOf = m => m && m.getBaseColorTexture();
  if (new Set(mats.map(texOf)).size !== 1) throw new Error(`${src.id}: primitives use ${mats.length} different base colour textures (unsupported; bake expects one atlas)`);
  const P = [], N = [], U = [], I = [];
  let base = 0, hadNormals = true;
  for (const {p, wm} of items) {
    if (p.getMode() !== 4) throw new Error(`${src.id}: non-triangle primitive mode ${p.getMode()}`);
    const pa = p.getAttribute('POSITION'), na = p.getAttribute('NORMAL'), ua = p.getAttribute('TEXCOORD_0');
    if (!ua) throw new Error(`${src.id}: primitive without TEXCOORD_0 (cannot bake texture)`);
    const n = pa.getCount();
    const el = [], ne = [], ue = [];
    // normal matrix: inverse-transpose of the upper 3x3 (similarity in practice; normalised later)
    for (let i = 0; i < n; i++) {
      pa.getElement(i, el); const q = mul4(wm, el); P.push(q[0], q[1], q[2]);
      if (na) { na.getElement(i, ne); const o = mul4(wm, ne), z = mul4(wm, [0, 0, 0]); N.push(o[0] - z[0], o[1] - z[1], o[2] - z[2]); } else hadNormals = false;
      ua.getElement(i, ue); U.push(ue[0], ue[1]);
    }
    const ix = p.getIndices();
    if (ix) { const a = ix.getArray(); for (let k = 0; k < a.length; k++) I.push(a[k] + base); } else for (let k = 0; k < n; k++) I.push(k + base);
    base += n;
  }
  const pos = Float32Array.from(P), uv = Float32Array.from(U), idx = Uint32Array.from(I);
  let nrm;
  if (hadNormals) { nrm = Float32Array.from(N); for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; } }
  else nrm = computeNormals(pos, idx);
  const mat = mats[0];
  const decode = async tex => {
    const {data, info} = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    return {data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, mimeType: tex.getMimeType()};
  };
  const baseColor = await decode(mat.getBaseColorTexture());
  // baseColorFactor multiplies the texture; fold it in so the bake samples final colour
  const f = mat.getBaseColorFactor();
  if (f.some((v, i) => i < 3 && Math.abs(v - 1) > 1e-6)) for (let i = 0; i < baseColor.data.length; i += 4) for (let k = 0; k < 3; k++) baseColor.data[i + k] = Math.round(baseColor.data[i + k] * f[k]);
  let metallicRoughness, mrSynth = false;
  const mrt = mat.getMetallicRoughnessTexture();
  if (mrt) metallicRoughness = await decode(mrt);
  else {
    // constant texture from the factors (G roughness, B metalness)
    mrSynth = true;
    const d = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) d.set([255, Math.round(255 * mat.getRoughnessFactor()), Math.round(255 * mat.getMetallicFactor()), 255], i * 4);
    metallicRoughness = {data: d, width: 4, height: 4, mimeType: 'synthetic/constant'};
  }
  return {
    ...src, file: path.relative(REPO, abs), sha256: sha, sha256Verified: sha, bytes, pos, nrm, uv, idx,
    triangles: idx.length / 3, vertices: pos.length / 3, primitives: items.length, hadNormals,
    material: {metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(), baseColorFactor: mat.getBaseColorFactor(), metallicRoughnessSynthesised: mrSynth},
    baseColor, metallicRoughness,
  };
}
