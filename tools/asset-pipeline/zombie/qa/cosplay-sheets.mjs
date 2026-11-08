#!/usr/bin/env node
// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): CPU contact sheets of the convention cosplay looks (render-lib:
// the runtime body + wearable GLBs, the bodies' own clips, CPU skinning, hidden-triangle masks). No browser / GPU.
//   node tools/asset-pipeline/zombie/qa/cosplay-sheets.mjs [--models=DIR] [--out=FILE.png] [--looks=a,b] [--bodies=a,b] [--close]
// One row per (look, body): front | three-quarter | side | back in the Idle pose, then Walk and Attack frames (three-quarter).
// --close frames the head (wig / hat fit check). Looks / pieces: the build record's costumes.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {loadBody, loadWearable, renderLook} from './render-lib.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/cosplay/cosplay-looks.png');
/** The costumes (pieces per slot) from the build record next to the models (derivatives/outfit-cosplay.json). */
const RECORD = JSON.parse(fs.readFileSync(path.resolve(MODELS, '../derivatives/outfit-cosplay.json'), 'utf8'));
const LOOKS = Object.fromEntries(RECORD.costumes.map(c => [c.id, c.pieces]));
const FILES = {head: 'outfit-cosplay-head.glb', upper: 'outfit-cosplay-upper.glb', lower: 'outfit-cosplay-lower.glb'};
const ORDINARY = {slacks: 'outfit-slacks-t25.glb'};
const bodyFile = id => `zombie-body-${id.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}-t25.glb`;
const looks = String(args.looks || Object.keys(LOOKS).join(',')).split(',');
const bodyIds = String(args.bodies || 'lastshift,courier,agent,heavyset,tall,paleGaze,paleRevenant,paleApparition').split(',');

/** A multi-wearable cosplay file -> one loadWearable-shaped record per wearable id (variants by body, own texture). */
async function cosplayWearables(file) {
  const {NodeIO} = await import('@gltf-transform/core');
  const {KHRMeshQuantization} = await import('@gltf-transform/extensions');
  const doc = await new NodeIO().registerExtensions([KHRMeshQuantization]).read(file);
  const root = doc.getRoot();
  const slot = root.listScenes()[0].getExtras().zombieWearable.slot;
  const out = {};
  const decode = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };
  const arr = a => a ? a.getArray() : null;
  const texCache = new Map();
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0];
    const img = prim.getMaterial().getBaseColorTexture().getImage();
    if (!texCache.has(img)) texCache.set(img, await decode(img));
    const rec = out[m[1]] ??= {file, extras: {id: m[1], slot}, variants: {}, tex: texCache.get(img)};
    const nrm = prim.getAttribute('NORMAL');
    rec.variants[m[2]] = {extras: n.getExtras(), mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255}};
    void nrm;
  }
  return out;
}

const wear = {};
for (const [slot, f] of Object.entries(FILES)) if (fs.existsSync(path.join(MODELS, f))) Object.assign(wear, await cosplayWearables(path.join(MODELS, f)));
for (const [id, f] of Object.entries(ORDINARY)) { const w = await loadWearable(path.join(REPO, 'game/public/assets/models', f)); wear[id] = w; }
const bodies = {};
for (const id of bodyIds) bodies[id] = await loadBody(path.join(REPO, 'game/public/assets/models', bodyFile(id)));

const close = !!args.close;
const W = close ? 200 : 170, H = close ? 220 : 300;
const views = [[0, null, 0], [35, null, 0], [90, null, 0], [180, null, 0], [35, 'Walk', 0.45], [35, 'Attack', 0.5]];
const rows = [];
for (const look of looks) for (const id of bodyIds) {
  const B = bodies[id], L = LOOKS[look];
  const pieces = Object.values(L).map(w => wear[w]);
  if (pieces.some(p => !p?.variants[id])) continue;
  const tiles = [];
  for (const [yaw, clip, t] of views) {
    const c = renderLook(B, pieces, {clip, t, yaw, W, H, frame: close ? {cx: 0, cy: B.extras.heightM * 0.93, h: 0.72} : {cx: 0, cy: 0.95, h: 2.05}});
    tiles.push(c);
  }
  rows.push({label: `${look} / ${id}`, tiles});
}
if (!rows.length) { console.error('nothing to render'); process.exit(1); }
const cols = views.length, SW = cols * W, SH = rows.length * H;
const buf = Buffer.alloc(SW * SH * 3);
rows.forEach((r, ri) => r.tiles.forEach((t, ci) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = (y * W + x) * 3, d = ((ri * H + y) * SW + ci * W + x) * 3; buf[d] = t.rgb[s]; buf[d + 1] = t.rgb[s + 1]; buf[d + 2] = t.rgb[s + 2]; } }));
const labels = rows.map((r, i) => `<text x="6" y="${i * H + 16}" font-family="sans-serif" font-size="13" fill="#ffe">${r.label}</text>`).join('');
const svg = Buffer.from(`<svg width="${SW}" height="${SH}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`);
fs.mkdirSync(path.dirname(OUT), {recursive: true});
await sharp(buf, {raw: {width: SW, height: SH, channels: 3}}).composite([{input: svg}]).png().toFile(OUT);
console.log(`wrote ${OUT} (${rows.length} rows: ${rows.map(r => r.label).join(', ')})`);
