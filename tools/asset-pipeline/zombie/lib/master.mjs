// Read-only access to the static AI-reconstructed masters.
// Masters are never written; every derivative is produced in memory and saved elsewhere.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');

export const MASTERS = {
  body: {
    id: 'zombie-body-03',
    uploadId: '269b8a208b034b7d8887f44dcdf12f2f',
    file: 'public/vision-board/models/269b8a208b034b7d8887f44dcdf12f2f.glb',
    sha256: '4183d7a74a8088074541e5062728642c9b6b4cfe71bf981f39ec6d106d2ccf7c',
    triangles: 925572,
  },
  coat: {
    id: 'zombie-coat-03',
    uploadId: '0429b64701a740bab039f492351b01cd',
    file: 'public/vision-board/models/0429b64701a740bab039f492351b01cd.glb',
    sha256: '22c2a696972c75ac2e6b7f4d815d416f8a7e3da46124635c436374bb80cc6a84',
    triangles: 988416,
  },
};

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  try {
    for (;;) { const n = fs.readSync(fd, buf, 0, buf.length, null); if (!n) break; h.update(buf.subarray(0, n)); }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** Verify sha256 and read geometry + decoded textures of one master (read once per run). */
export async function loadMaster(key) {
  const m = MASTERS[key];
  const abs = path.join(REPO, m.file);
  const sha = sha256File(abs);
  if (sha !== m.sha256) throw new Error(`${m.id}: sha256 mismatch ${sha} != ${m.sha256}`);
  const bytes = fs.statSync(abs).size;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(abs);
  const prims = doc.getRoot().listMeshes().flatMap(me => me.listPrimitives());
  if (prims.length !== 1) throw new Error(`${m.id}: expected 1 primitive, got ${prims.length}`);
  const p = prims[0];
  const node = doc.getRoot().listNodes().find(n => n.getMesh());
  const wm = node.getWorldMatrix();
  const ident = wm.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
  if (!ident) throw new Error(`${m.id}: non-identity node transform not supported`);
  const pos = new Float32Array(p.getAttribute('POSITION').getArray());
  const nrm = new Float32Array(p.getAttribute('NORMAL').getArray());
  const uv = new Float32Array(p.getAttribute('TEXCOORD_0').getArray());
  const idx = new Uint32Array(p.getIndices().getArray());
  const mat = p.getMaterial();
  const decode = async tex => {
    const {data, info} = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    return {data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, mimeType: tex.getMimeType()};
  };
  const baseColor = await decode(mat.getBaseColorTexture());
  const metallicRoughness = await decode(mat.getMetallicRoughnessTexture());
  return {
    ...m, sha256Verified: sha, bytes, pos, nrm, uv, idx,
    triangles: idx.length / 3, vertices: pos.length / 3,
    material: {metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(), baseColorFactor: mat.getBaseColorFactor()},
    baseColor, metallicRoughness,
  };
}
