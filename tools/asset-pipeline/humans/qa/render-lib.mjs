// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): CPU QA rendering of market-human-cast.glb (no browser / GPU).
// Loads the cast into the zombie QA render-lib's body / wearable shapes, so its posing (the body's own clips, CPU linear-blend
// skinning), masking (hideBodyTriangles / hideWear) and rasteriser (zombie/lib/raster.mjs) are reused unchanged.
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const decode = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };
const arr = a => (a ? a.getArray() : null);
const meshOf = prim => ({pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255});

/**
 * @returns {extras, bodies: {id: body (zombie render-lib loadBody shape; extras.id = the body id)}, wearables: {id: wearable
 *   (loadWearable shape: variants keyed by body id)}}. Clip names are '<body>:<Clip>' (poseAt(body, `${id}:Walk`, t)).
 */
export async function loadCast(file, {textures = true} = {}) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const extras = root.listScenes()[0].getExtras().marketHumans;
  const anims = root.listAnimations();
  const bodies = {}, wearables = {};
  const texCache = new Map();
  const texOf = async t => { if (!textures || !t) return null; if (!texCache.has(t)) texCache.set(t, await decode(t.getImage())); return texCache.get(t); };
  for (const n of root.listNodes()) {
    const mb = /^HumanBody_(.+)$/.exec(n.getName());
    if (mb) {
      const id = mb[1], prim = n.getMesh().listPrimitives()[0], skin = n.getSkin();
      const ex = n.getExtras();
      bodies[id] = {file, doc, extras: {...ex, id}, joints: skin.listJoints(), names: skin.listJoints().map(j => j.getName()), ibm: arr(skin.getInverseBindMatrices()),
        mesh: meshOf(prim), tex: await texOf(prim.getMaterial().getBaseColorTexture()), anims: anims.filter(a => a.getName().startsWith(id + ':'))};
      continue;
    }
    const mw = /^Wear_(.+)__(.+)$/.exec(n.getName());
    if (mw) {
      const [, wid, bid] = mw, prim = n.getMesh().listPrimitives()[0], ex = n.getExtras();
      const w = wearables[wid] ??= {file, extras: {id: wid, slot: ex.slot}, variants: {}, tex: await texOf(prim.getMaterial().getBaseColorTexture())};
      w.variants[bid] = {extras: ex, mesh: meshOf(prim)};
    }
  }
  return {extras, bodies, wearables};
}
