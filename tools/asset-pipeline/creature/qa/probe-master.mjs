import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('ext', root.listExtensionsUsed().map(e=>e.extensionName));
for (const n of root.listNodes()) console.log('node', n.getName(), n.getTranslation(), n.getRotation(), n.getScale(), !!n.getMesh());
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const pa = p.getAttribute('POSITION');
  console.log('prim', p.listSemantics(), pa.getCount(), p.getIndices()?.getCount(), pa.getMin([]), pa.getMax([]));
  const mat = p.getMaterial();
  console.log('mat', mat.getName(), mat.getBaseColorFactor(), mat.getMetallicFactor(), mat.getRoughnessFactor(), !!mat.getNormalTexture(), mat.getBaseColorTexture()?.getMimeType(), mat.getMetallicRoughnessTexture()?.getMimeType(), mat.getDoubleSided(), mat.getAlphaMode());
}
for (const t of root.listTextures()) console.log('tex', t.getName(), t.getMimeType(), t.getSize(), t.getImage().byteLength);
