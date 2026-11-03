#!/usr/bin/env node
// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): CPU contact sheets of the SHIPPED lingerie fits (no GPU / browser).
//   node tools/asset-pipeline/zombie/qa/lingerie-sheets.mjs [outDir=qa-artifacts/lingerie/fit/sheets] [--designs=a,b]
// Per fit (LINGERIE build table): the body with its runtime hide mask + both pieces, textured, in the bind pose (front / side /
// back) and sampled frames of the six clips (Idle, Walk, Run, Attack, Hit, Death), plus the store stock (the set on the female display
// mannequin + its hanging rack items on a rail). Output is QA
// evidence only (qa-artifacts is ignored by Git).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {loadBody, skinMats} from '../lib/lingerie-body.mjs';
import {skinWith} from '../lib/lingerie-fit.mjs';
import {loadShippedFit} from '../lib/lingerie-metrics.mjs';
import {decodeTexture, renderPanels} from '../../enemy/lib/siren-render.mjs';
import {BODIES, MANNEQUIN} from '../lingerie.config.mjs';

async function loadMannequinMesh() {
  const d = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(REPO, MANNEQUIN.file));
  const p = d.getRoot().listMeshes()[0].listPrimitives()[0];
  return {pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: p.getIndices().getArray(), uv: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), tex: await decodeTexture(p.getMaterial().getBaseColorTexture().getImage(), 512)};
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const OUT = path.resolve(REPO, args.find(a => !a.startsWith('--')) ?? 'qa-artifacts/lingerie/fit/sheets');
const only = args.find(a => a.startsWith('--designs='))?.slice(10).split(',');
const S = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/zombie-lingerie.json'), 'utf8'));
fs.mkdirSync(OUT, {recursive: true});
const FRAMES = [[null, 0, [0, 90, 180]], ['Idle', 1.5, [30]], ['Walk', 0.6, [30]], ['Run', 0.3, [330]], ['Attack', 0.55, [30]], ['Hit', 0.2, [30]], ['Death', 1.6, [0]]];

for (const set of S.sets) {
  if (only && !only.includes(set.design)) continue;
  const file = path.join(REPO, set.glb);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const mat = doc.getRoot().listMaterials()[0];
  const gtex = await decodeTexture(mat.getBaseColorTexture().getImage(), 1024);
  for (const bodyId of set.bodies) {
    const B = await loadBody(path.join(REPO, BODIES[bodyId].file));
    const btex = await decodeTexture(B.R.meshes[0].material.getBaseColorTexture().getImage(), 1024);
    const pieces = await loadShippedFit(file, bodyId, B.names);
    const uvOf = name => { const n = doc.getRoot().listNodes().find(x => x.getName() === name); const a = n.getMesh().listPrimitives()[0].getAttribute('TEXCOORD_0'); return Float32Array.from(a.getArray(), v => a.getNormalized() ? v / 65535 : v); };
    const hide = new Uint8Array(B.nTris); for (const p of pieces) for (let t = 0; t < B.nTris; t++) if (p.hide[t]) hide[t] = 1;
    const bodyIdx = []; for (let t = 0; t < B.nTris; t++) if (!hide[t]) bodyIdx.push(B.idx[t * 3], B.idx[t * 3 + 1], B.idx[t * 3 + 2]);
    const panels = [];
    for (const [clip, t, yaws] of FRAMES) {
      const mats = skinMats(B, clip, t);
      const meshes = [{pos: skinWith(mats, B.pos, B.joints, B.weights), idx: Uint32Array.from(bodyIdx), uv: B.mesh.uv, tex: btex}];
      for (const p of pieces) meshes.push({pos: skinWith(mats, p.pos, p.joints, p.weights), idx: p.idx, uv: uvOf(p.node), tex: gtex});
      for (const yaw of yaws) panels.push({title: `${set.id} on ${bodyId}: ${clip ?? 'bind'} ${clip ? t + ' s' : ''} yaw ${yaw}`, meshes,
        cam: clip === 'Death' ? {yawDeg: yaw, cx: 0, cy: 0.35, height: 1.2} : {yawDeg: yaw, cx: 0, cy: 1.02, height: 0.9}, ruler: false});
    }
    await renderPanels(panels, path.join(OUT, `${set.design}-${bodyId}.png`), {w: 300, h: 420, cols: panels.length, title: `${set.label} fitted to ${bodyId} (shipped GLB, CPU render)`});
    console.log('wrote', path.relative(REPO, path.join(OUT, `${set.design}-${bodyId}.png`)));
  }
  // store stock (task store-polish): the set on the female display mannequin (its own frame) + the hanging rack items on a rail
  const mq = await loadMannequinMesh();
  const nodeMesh = (name, prim = 0) => { const n = doc.getRoot().listNodes().find(x => x.getName() === name); if (!n) return null; return n.getMesh().listPrimitives().map(p => { const a = p.getAttribute('TEXCOORD_0'); return {pos: Float32Array.from(p.getAttribute('POSITION').getArray()), idx: p.getIndices().getArray(), uv: a ? Float32Array.from(a.getArray(), v => a.getNormalized() ? v / 65535 : v) : null, tex: a ? gtex : null, color: a ? undefined : [200, 202, 208]}; }); };
  const dressed = [mq, ...nodeMesh(`LingerieMannequin_${set.design}_top`), ...nodeMesh(`LingerieMannequin_${set.design}_bottom`)];
  const rail = 1.53, items = (set.hang ?? []).length ? set.hang.map(h => h.node) : doc.getRoot().listNodes().filter(n => n.getName().startsWith('LingerieHang_')).map(n => n.getName());
  const rack = [{pos: Float32Array.from([-0.45, rail + 0.012, -0.004, 0.45, rail + 0.012, -0.004, 0.45, rail, -0.004, -0.45, rail, -0.004]), idx: Uint16Array.from([0, 1, 2, 0, 2, 3]), color: [150, 150, 160]}];
  items.forEach((name, k) => { for (const m of nodeMesh(name)) { const P = Float32Array.from(m.pos); for (let i = 0; i < P.length; i += 3) { P[i] += (k - (items.length - 1) / 2) * 0.34; P[i + 1] += rail; } rack.push({...m, pos: P}); } });
  await renderPanels([{title: `${set.id} on the female mannequin (front)`, meshes: dressed, cam: {yawDeg: 180, cx: 0, cy: 1.0, height: 1.9}}, {title: 'mannequin side', meshes: dressed, cam: {yawDeg: 90, cx: 0, cy: 1.0, height: 1.9}},
    {title: 'mannequin back', meshes: dressed, cam: {yawDeg: 0, cx: 0, cy: 1.0, height: 1.9}}, {title: `${set.id} rack items on a 1.53 m rail`, meshes: rack, cam: {yawDeg: 0, cx: 0, cy: 1.3, height: 0.7}, ruler: false}, {title: 'rack items, side', meshes: rack, cam: {yawDeg: 60, cx: 0, cy: 1.3, height: 0.7}, ruler: false}],
    path.join(OUT, `${set.design}-stock.png`), {w: 300, h: 420, cols: 5});
}
