// Write plain glTF binary (no Draco/meshopt/KTX2/webp extensions) with gltf-transform.
import {Document, NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';

export async function encodeImage(raw, width, height, kind) {
  const img = sharp(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), {raw: {width, height, channels: 3}});
  if (kind === 'color') return {mime: 'image/jpeg', ext: 'jpg', bytes: await img.jpeg({quality: 86, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer()};
  if (kind === 'orm') return {mime: 'image/jpeg', ext: 'jpg', bytes: await img.jpeg({quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer()};
  if (kind === 'normal') return {mime: 'image/png', ext: 'png', bytes: await img.png({compressionLevel: 9, adaptiveFiltering: true}).toBuffer()};
  throw new Error(kind);
}

// mesh: {pos, nrm, uv, idx}; textures: {color, orm, normal?} each {mime, bytes}; children: [{name, translation}]
export async function writeMeshGlb({name, mesh, textures, material, children = [], extras}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', mesh.pos))
    .setAttribute('NORMAL', acc('VEC3', mesh.nrm))
    .setAttribute('TEXCOORD_0', acc('VEC2', mesh.uv))
    .setIndices(acc('SCALAR', mesh.pos.length / 3 <= 65535 ? Uint16Array.from(mesh.idx) : mesh.idx));
  const mat = doc.createMaterial(`${name}-baked`)
    .setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(material.metallicFactor).setRoughnessFactor(material.roughnessFactor)
    .setDoubleSided(false).setAlphaMode('OPAQUE');
  const tex = (n, t) => doc.createTexture(n).setImage(new Uint8Array(t.bytes)).setMimeType(t.mime);
  mat.setBaseColorTexture(tex(`${name}-color`, textures.color));
  mat.setMetallicRoughnessTexture(tex(`${name}-orm`, textures.orm));
  if (textures.normal) mat.setNormalTexture(tex(`${name}-normal`, textures.normal)).setNormalScale(1);
  prim.setMaterial(mat);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  for (const c of children) node.addChild(doc.createNode(c.name).setTranslation(c.translation));
  const scene = doc.createScene('Scene').addChild(node);
  doc.getRoot().setDefaultScene(scene);
  if (extras) node.setExtras(extras);
  return Buffer.from(await new NodeIO().writeBinary(doc));
}
