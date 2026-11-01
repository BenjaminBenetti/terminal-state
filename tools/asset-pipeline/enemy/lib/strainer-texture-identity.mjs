// Terminal State - STRAINER texture-swap identity proof (task studio-alpha-bts-round4-compliance-followup-20261101-01, lane
// TEXTURE). The Codex texture bake may change ONLY the three embedded images (and so the material's texture references); this
// hashes everything else of a gltf-transform Document part by part: geometry (every primitive attribute except the skin
// streams + indices, UVs included), skin (joint hierarchy / bind translations, inverse bind matrices, JOINTS_0 / WEIGHTS_0),
// animation (every channel target / path / interpolation + sampler input / output accessors), scene (scene / node names +
// the scene extras contract), material (the non-texture material parameters). STRAINER_IDENTITY pins the values of the GLB
// shipped before the bake (sha256 30d4347c..., Meshy maps re-encoded); the builder and game/tests/strainer-asset.test.ts
// both require the rebuilt GLB to reproduce them exactly.
import crypto from 'node:crypto';

export const STRAINER_IDENTITY = {
  pinnedFrom: {glbSha256: '30d4347c2556f035bc3cd662db4227c2d9255cecf582ea578a35b16b3459736a', bytes: 2377612, note: 'the Strainer GLB of merge 859a402 (Meshy provider maps re-encoded), before the Codex texture bake'},
  geometry: '75d40fcf82867944630d3a60ee7b3393bc72f970f6682cf88d46e760b90f8f4e',
  skin: '1a32b0b9a4d8ef8b5a70e1ee08b0588961b940845ba17aa96dc5ebec8cfaf589',
  animation: 'dfdfc819d8977d59c2c827b7f1642a55f1a3e8ac154d55e237e94dff34d88260',
  scene: '813f854bb0c3515b92a38e37de7f636066f6999793dc9752ca3c20bbe96a99e6',
  material: '89d343d836fa2d1d7522c736acae6a871790fff0776fa259318988cdf2b3ea43',
};

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const SKIN_STREAMS = ['JOINTS_0', 'WEIGHTS_0'];

function addAccessor(h, a) {
  if (!a) { h.update('null|'); return; }
  const arr = a.getArray();
  h.update(`${a.getType()}|${a.getComponentType()}|${a.getNormalized()}|${a.getCount()}|`);
  h.update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
}

/** {geometry, skin, animation, scene, material} sha256 hex digests of a gltf-transform Document. */
export function strainerIdentity(doc) {
  const root = doc.getRoot(), H = () => crypto.createHash('sha256');
  const g = H(), s = H(), a = H(), sc = H(), m = H();
  for (const mesh of root.listMeshes()) {
    g.update(`mesh:${mesh.getName()}|`); s.update(`mesh:${mesh.getName()}|`);
    for (const prim of mesh.listPrimitives()) {
      g.update(`prim:${prim.getMode()}|`);
      for (const sem of prim.listSemantics().slice().sort()) {
        const h = SKIN_STREAMS.includes(sem) ? s : g;
        h.update(`attr:${sem}|`); addAccessor(h, prim.getAttribute(sem));
      }
      g.update('indices|'); addAccessor(g, prim.getIndices());
      g.update(`targets:${prim.listTargets().length}|`);
      const mat = prim.getMaterial();
      m.update(stable(mat ? {name: mat.getName(), baseColorFactor: mat.getBaseColorFactor(), emissiveFactor: mat.getEmissiveFactor(), metallic: mat.getMetallicFactor(), roughness: mat.getRoughnessFactor(),
        normalScale: mat.getNormalScale(), occlusionStrength: mat.getOcclusionStrength(), alphaMode: mat.getAlphaMode(), alphaCutoff: mat.getAlphaCutoff(), doubleSided: mat.getDoubleSided(),
        textures: {baseColor: !!mat.getBaseColorTexture(), metallicRoughness: !!mat.getMetallicRoughnessTexture(), normal: !!mat.getNormalTexture(), occlusion: !!mat.getOcclusionTexture(), emissive: !!mat.getEmissiveTexture()},
        textureNames: [mat.getBaseColorTexture(), mat.getMetallicRoughnessTexture(), mat.getNormalTexture()].map(t => t && t.getName()),
        textureMimes: [mat.getBaseColorTexture(), mat.getMetallicRoughnessTexture(), mat.getNormalTexture()].map(t => t && t.getMimeType()),
        extensions: mat.listExtensions().map(e => e.extensionName)} : null));
    }
  }
  for (const skin of root.listSkins()) {
    s.update(`skin:${skin.getName()}|skeleton:${skin.getSkeleton()?.getName()}|joints:${skin.listJoints().map(j => j.getName()).join(',')}|`);
    addAccessor(s, skin.getInverseBindMatrices());
  }
  for (const node of root.listNodes()) {
    s.update(stable({node: node.getName(), t: node.getTranslation(), r: node.getRotation(), s: node.getScale(), children: node.listChildren().map(c => c.getName()), mesh: node.getMesh()?.getName() ?? null, skin: node.getSkin()?.getName() ?? null}));
    sc.update(stable({node: node.getName(), extras: node.getExtras()}));
  }
  for (const anim of root.listAnimations()) {
    a.update(`anim:${anim.getName()}|`);
    for (const ch of anim.listChannels()) {
      const smp = ch.getSampler();
      a.update(`ch:${ch.getTargetNode()?.getName()}|${ch.getTargetPath()}|${smp.getInterpolation()}|`);
      addAccessor(a, smp.getInput()); addAccessor(a, smp.getOutput());
    }
  }
  for (const scene of root.listScenes()) sc.update(stable({scene: scene.getName(), children: scene.listChildren().map(c => c.getName()), extras: scene.getExtras()}));
  sc.update(stable({extensionsUsed: root.listExtensionsUsed().map(e => e.extensionName).sort(), extensionsRequired: root.listExtensionsRequired().map(e => e.extensionName).sort(),
    counts: {meshes: root.listMeshes().length, skins: root.listSkins().length, animations: root.listAnimations().length, materials: root.listMaterials().length, textures: root.listTextures().length, scenes: root.listScenes().length}}));
  return {geometry: g.digest('hex'), skin: s.digest('hex'), animation: a.digest('hex'), scene: sc.digest('hex'), material: m.digest('hex')};
}

/** Throws unless every identity part equals the pinned value. */
export function assertStrainerIdentity(doc) {
  const got = strainerIdentity(doc), bad = Object.keys(got).filter(k => got[k] !== STRAINER_IDENTITY[k]);
  if (bad.length) throw new Error('Strainer identity changed (' + bad.join(', ') + '): ' + JSON.stringify(got));
  return got;
}
