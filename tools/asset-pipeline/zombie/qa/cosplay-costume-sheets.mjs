#!/usr/bin/env node
// Task studio-cosplay-general-20261108-225231-01 (lane COSTUME): CPU contact sheets of the full convention cosplay costumes (render-lib:
// the runtime body + the three outfit-cosplay-costume-*.glb, the bodies' own clips, CPU skinning, the shipped hide masks). No browser.
//   node tools/asset-pipeline/zombie/qa/cosplay-costume-sheets.mjs --out=FILE.png [--models=DIR] [--costumes=a,b] [--bodies=a,b] [--close]
// One row per (costume, body): front | side | back in the bind pose, then Idle, Walk, Run, Attack, Hit and Death frames (three-quarter).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {loadBody, renderLook, sheet} from './render-lib.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const RECORD = JSON.parse(fs.readFileSync(path.resolve(MODELS, '../derivatives/outfit-cosplay-costume.json'), 'utf8'));
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/cosplay/costumes.png');
const bodyFile = id => path.join(REPO, 'game/public/assets/models', `zombie-body-${id.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}-t25.glb`);
const decode = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };

/** A multi-wearable costume file -> one loadWearable-shaped record per wearable id (variants by body, own base colour texture). */
async function wearablesOf(file) {
  const doc = await new NodeIO().registerExtensions([KHRMeshQuantization]).read(file);
  const root = doc.getRoot(), slot = root.listScenes()[0].getExtras().zombieWearable.slot, out = {}, cache = new Map();
  const arr = a => a ? a.getArray() : null;
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0], img = prim.getMaterial().getBaseColorTexture().getImage();
    if (!cache.has(img)) cache.set(img, await decode(img));
    const rec = out[m[1]] ??= {file, extras: {id: m[1], slot}, variants: {}, tex: cache.get(img)};
    rec.variants[m[2]] = {extras: n.getExtras(), mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255}};
  }
  return out;
}

const wear = {};
for (const o of Object.values(RECORD.outputs)) Object.assign(wear, await wearablesOf(path.join(MODELS, path.basename(o.file))));
const costumes = RECORD.costumes.filter(c => !args.costumes || String(args.costumes).split(',').includes(c.id));
const close = !!args.close;
const W = close ? 220 : 180, H = close ? 240 : 300;
const views = args.death ? [[0, 'Death', 0.6, 'Death 0.6'], [0, 'Death', 1.0, 'Death 1.0'], [0, 'Death', 1.6, 'Death 1.6 front'], [90, 'Death', 1.6, 'Death 1.6 side'], [180, 'Death', 1.6, 'Death 1.6 back'], [270, 'Death', 1.6, 'Death 1.6 side 2']]
  : [[0, null, 0, 'front'], [90, null, 0, 'side'], [180, null, 0, 'back'], [35, 'Idle', 1.2, 'Idle'], [35, 'Walk', 0.45, 'Walk'], [35, 'Run', 0.3, 'Run'], [35, 'Attack', 0.5, 'Attack'], [90, 'Hit', 0.2, 'Hit'], [35, 'Death', 1.6, 'Death']];
const rows = [], labels = [];
const bodies = {};
for (const c of costumes) for (const b of c.bodies) {
  if (args.bodies && !String(args.bodies).split(',').includes(b)) continue;
  bodies[b] ??= await loadBody(bodyFile(b));
  const B = bodies[b], pieces = Object.values(c.pieces).map(id => wear[id]);
  rows.push(views.map(([yaw, clip, t]) => renderLook(B, pieces, {clip, t, yaw, W, H, frame: close ? {cx: 0, cy: B.extras.heightM * 0.9, h: 0.75} : clip === 'Death' ? {cx: 0, cy: 0.4, cz: -0.5, h: 2.2} : {cx: 0, cy: 0.92, h: 2.05}})));
  labels.push(`${c.id} / ${b}`);
}
if (!rows.length) { console.error('nothing to render'); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), {recursive: true});
await sheet(OUT, 'Convention cosplay costumes (CPU render of the shipped GLBs)', rows, W, H, views.map(v => v[3]), labels, {labelW: 170});
