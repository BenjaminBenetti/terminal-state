#!/usr/bin/env node
// Lane BODY (task mall-lingerie-20261102): proves that a rebuilt wearable GLB keeps every EXISTING per-body variant exactly.
//   node tools/asset-pipeline/zombie/qa/variant-identity.mjs <old.glb> <new.glb> [...<old.glb> <new.glb>]
// Per body node Outfit_<wearable>__<body>: sha256 of every vertex attribute array, the index array, the node extras (masks,
// bulk, layering), the inverse bind matrices and the skin joint names / translations; plus the shared textures. Prints one
// line per file pair, exits 1 when an old variant is missing or differs (new variants are listed, not compared).
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const h = a => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
async function variants(f) {
  const doc = await io.read(f), out = {};
  for (const n of doc.getRoot().listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const p = n.getMesh().listPrimitives()[0], skin = n.getSkin();
    out[m[2]] = JSON.stringify({attrs: Object.fromEntries(p.listSemantics().map(s => [s, h(p.getAttribute(s).getArray())])), idx: h(p.getIndices().getArray()), extras: n.getExtras(),
      ibm: h(skin.getInverseBindMatrices().getArray()), joints: skin.listJoints().map(j => j.getName() + ':' + j.getTranslation().join(','))});
  }
  return {out, tex: doc.getRoot().listTextures().map(t => h(t.getImage())).join(',')};
}
const args = process.argv.slice(2);
let bad = 0;
for (let i = 0; i + 1 < args.length; i += 2) {
  const A = await variants(args[i]), B = await variants(args[i + 1]);
  const same = Object.keys(A.out).filter(k => A.out[k] === B.out[k]), diff = Object.keys(A.out).filter(k => B.out[k] && A.out[k] !== B.out[k]), gone = Object.keys(A.out).filter(k => !B.out[k]);
  const added = Object.keys(B.out).filter(k => !A.out[k]);
  if (diff.length || gone.length || A.tex !== B.tex) bad++;
  console.log(JSON.stringify({file: args[i + 1].split('/').pop(), texturesIdentical: A.tex === B.tex, identical: same, differ: diff, missing: gone, added}));
}
process.exit(bad ? 1 : 0);
