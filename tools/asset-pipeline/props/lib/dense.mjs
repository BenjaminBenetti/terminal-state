// Load a dense single-primitive reconstruction GLB (read-only) and simplify its geometry.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';

export const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const sha256Buf = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function decodeRGBA(bytes) {
  const {data, info} = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height};
}

export async function loadDense(file) {
  const doc = await new NodeIO().read(file);
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error(`${file}: expected exactly one mesh primitive`);
  for (const n of root.listNodes()) {
    const m = n.getMatrix();
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (m.some((v, i) => Math.abs(v - ident[i]) > 1e-9)) throw new Error(`${file}: non-identity node transform not supported`);
  }
  const prim = meshes[0].listPrimitives()[0];
  if (prim.getMode() !== 4) throw new Error('triangles only');
  const P = Float32Array.from(prim.getAttribute('POSITION').getArray());
  const N = Float32Array.from(prim.getAttribute('NORMAL').getArray());
  const UV = Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray());
  const I = Uint32Array.from(prim.getIndices().getArray());
  const mat = prim.getMaterial();
  const bcTex = mat.getBaseColorTexture(), mrTex = mat.getMetallicRoughnessTexture();
  if (!bcTex || !mrTex) throw new Error('expected baseColor + metallicRoughness textures');
  const bc = await decodeRGBA(bcTex.getImage());
  const mr = await decodeRGBA(mrTex.getImage());
  const bbox = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { bbox.min[c] = Math.min(bbox.min[c], P[i + c]); bbox.max[c] = Math.max(bbox.max[c], P[i + c]); }
  return {
    P, N, UV, I, bc, mr, bbox,
    material: {
      name: mat.getName(), baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
      doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode(),
      textures: {baseColor: {mime: bcTex.getMimeType(), width: bc.width, height: bc.height}, metallicRoughness: {mime: mrTex.getMimeType(), width: mr.width, height: mr.height}},
      extraTextures: ['normalTexture', 'occlusionTexture', 'emissiveTexture'].filter(k => (k === 'normalTexture' ? mat.getNormalTexture() : k === 'occlusionTexture' ? mat.getOcclusionTexture() : mat.getEmissiveTexture())),
    },
    stats: {vertices: P.length / 3, triangles: I.length / 3},
  };
}

// Geometry-only simplification. The source's UV seams would otherwise pin ~80k triangles, so the
// collapse runs in meshoptimizer 'Permissive' mode (collapses across attribute seams allowed:
// the old UVs are discarded, a fresh atlas is generated and textures are re-baked afterwards).
// The result is then welded by exact position so former seam splits do not become cracks.
export async function simplifyGeometry(dense, targetTris, flags = ['Permissive']) {
  await MeshoptSimplifier.ready;
  const {P, I} = dense;
  const remap = MeshoptSimplifier.generatePositionRemap(P, 3);
  const [out, error] = MeshoptSimplifier.simplify(I, P, 3, targetTris * 3, 1.0, flags);
  // weld by position + compact vertices in first-use order (deterministic); drop degenerates
  const map = new Int32Array(P.length / 3).fill(-1);
  const pos = [];
  const idx = [];
  let nv = 0, degenerate = 0;
  for (let k = 0; k < out.length; k += 3) {
    const a = remap[out[k]], b = remap[out[k + 1]], c = remap[out[k + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const v of [a, b, c]) {
      if (map[v] < 0) { map[v] = nv++; pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      idx.push(map[v]);
    }
  }
  const scale = MeshoptSimplifier.getScale(P, 3);
  return {pos: Float32Array.from(pos), idx: Uint32Array.from(idx), error, errorAbsolute: error * scale, droppedDegenerate: degenerate, flags};
}
