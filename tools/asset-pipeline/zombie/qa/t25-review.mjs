#!/usr/bin/env node
// Meshy T2.5 migration (lane CHARS): CPU review sheets of a replaced character asset next to its ORIGINAL reference
// image (the exact conditioning image recorded in DELIVERED.json) and the superseded runtime derivative (read from the
// pushed base commit with read-only `git show`). No browser / GPU: CPU skinning + lib/raster.mjs.
//   node tools/asset-pipeline/zombie/qa/t25-review.mjs --asset=body:heavyset|garment:hoodie|creature:ratdog
//        [--models=game/public/assets/models] [--out=reference/tasks/meshy-game-replacement-20261029/review/chars]
// Rows: reference | old derivative (bind) | new: bind front, bind back / side, sampled clip frames (Walk, Attack, Death).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {REPO} from '../lib/master.mjs';
import {T25_BASE_COMMIT, T25_ROOT, deliveredIndex} from '../lib/t25.mjs';
import {loadBody, loadWearable, renderLook, sheet} from './render-lib.mjs';
import {loadCreature, render as renderCreature} from '../../creature/qa/render-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const asset = args.asset;
if (!asset) throw new Error('--asset=<inventory id> required');
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'reference/tasks/meshy-game-replacement-20261029/review/chars');
fs.mkdirSync(OUT, {recursive: true});
const d = deliveredIndex().assets[asset];
if (!d) throw new Error('not delivered: ' + asset);
const [kind, id] = asset.split(':');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't25-review-'));
/** Old runtime file from the pushed base commit (read-only git). */
function oldFile(rel) {
  const out = path.join(tmp, path.basename(rel));
  fs.writeFileSync(out, execFileSync('git', ['-C', REPO, 'show', `${T25_BASE_COMMIT}:${rel}`], {maxBuffer: 1 << 28}));
  return out;
}
/** An image file as a sheet cell (same {rgb, w, h} shape as a Canvas). */
async function imageCell(file, W, H) {
  const {data} = await sharp(file).resize(W, H, {fit: 'contain', background: '#2c2c32'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {rgb: new Uint8Array(data), w: W, h: H};
}
const ref = d.inputImage;
const label = `${asset} ${d.attempt} (Meshy task ${d.taskId})`;
const written = [];

if (kind === 'body') {
  const cw = 170, ch = 290;
  const nb = await loadBody(path.join(MODELS, `zombie-body-${id}-t25.glb`));
  const ob = await loadBody(oldFile(`game/public/assets/models/zombie-body-${id}.glb`));
  const H = nb.extras.heightM, fr = {cy: 0.5 * H + 0.03, h: H + 0.25};
  const row = [await imageCell(ref, cw, ch), renderLook(ob, [], {W: cw, H: ch, frame: fr}), renderLook(nb, [], {W: cw, H: ch, frame: fr}), renderLook(nb, [], {yaw: 180, W: cw, H: ch, frame: fr}), renderLook(nb, [], {yaw: 90, W: cw, H: ch, frame: fr}),
    renderLook(nb, [], {clip: 'Walk', t: 0.3, yaw: 35, W: cw, H: ch, frame: fr}), renderLook(nb, [], {clip: 'Attack', t: 0.45, yaw: -40, W: cw, H: ch, frame: fr}), renderLook(nb, [], {clip: 'Death', t: 5, yaw: 90, W: cw, H: ch, frame: {cy: 0.6, cz: -0.35, h: 3.4}})];
  written.push(await sheet(path.join(OUT, `${kind}-${id}.png`), `${label}: original reference | old Pixal3D derivative | new T2.5 rigged derivative (A-pose bind front / back / side, Walk, Attack, Death)`,
    [row], cw, ch, ['reference (input)', 'old (bind)', 'new bind front', 'new back', 'new side', 'Walk t=0.3', 'Attack t=0.45', 'Death end'], [''], {labelW: 10}));
} else if (kind === 'garment') {
  const cw = 150, ch = 260;
  const nw = await loadWearable(path.join(MODELS, `outfit-${id}-t25.glb`));
  const ow = await loadWearable(oldFile(`game/public/assets/models/outfit-${id}.glb`));
  const live = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/zombie-wardrobe.json'), 'utf8'));
  const rows = [], labels = [];
  for (const b of Object.keys(nw.variants)) {
    const bf = live.bodies?.[b]?.glb ? path.join(REPO, live.bodies[b].glb) : path.join(MODELS, `zombie-body-${b}.glb`);
    const B = await loadBody(fs.existsSync(path.join(MODELS, path.basename(bf))) ? path.join(MODELS, path.basename(bf)) : bf);
    const H = B.extras.heightM, fr = {cy: 0.5 * H + 0.03, h: H + 0.25};
    // the body's required lower slot is filled for the look shots (as at runtime); the garment alone is shown too
    const row = [rows.length ? null : await imageCell(ref, cw, ch), renderLook(B, [nw], {W: cw, H: ch, frame: fr}), renderLook(B, [nw], {yaw: 180, W: cw, H: ch, frame: fr}), renderLook(B, [nw], {yaw: 90, W: cw, H: ch, frame: fr}),
      renderLook(B, [nw], {clip: 'Walk', t: 0.3, yaw: 35, W: cw, H: ch, frame: fr}), renderLook(B, [nw], {clip: 'Attack', t: 0.45, yaw: -40, W: cw, H: ch, frame: fr}), renderLook(B, [nw], {noBody: true, W: cw, H: ch, frame: fr})];
    rows.push(row); labels.push(b);
  }
  // the old garment on the body it shared with the new one (guide), if any
  const common = Object.keys(ow.variants).find(b => nw.variants[b]);
  if (common) {
    const ob = await loadBody(oldFile(`game/public/assets/models/zombie-body-${common}.glb`));
    const H = ob.extras.heightM;
    rows.push([null, renderLook(ob, [ow], {W: cw, H: ch, frame: {cy: 0.5 * H + 0.03, h: H + 0.25}}), renderLook(ob, [ow], {yaw: 180, W: cw, H: ch, frame: {cy: 0.5 * H + 0.03, h: H + 0.25}})]);
    labels.push(`OLD ${common}`);
  }
  written.push(await sheet(path.join(OUT, `${kind}-${id}.png`), `${label}: reference | fitted on every supported body (bind front / back / side, Walk, Attack, garment alone); last row: old Pixal3D garment`,
    rows, cw, ch, ['reference', 'bind front', 'back', 'side', 'Walk t=0.3', 'Attack t=0.45', 'garment alone'], labels, {labelW: 110}));
} else if (kind === 'creature') {
  const cw = 360, ch = 220;
  const nc = await loadCreature(path.join(MODELS, `creature-${id}-t25.glb`));
  const oc = await loadCreature(oldFile(`game/public/assets/models/creature-${id}.glb`));
  const fr = {cy: 0.4, cz: -0.15, h: 1.1};
  const rows = [
    [await imageCell(ref, cw, ch), renderCreature(oc, {yaw: 270, W: cw, H: ch, frame: fr}), renderCreature(nc, {yaw: 270, W: cw, H: ch, frame: fr}), renderCreature(nc, {yaw: 0, W: cw, H: ch, frame: fr})],
    [renderCreature(nc, {clip: 'Walk', t: 0.35, yaw: 270, W: cw, H: ch, frame: fr}), renderCreature(nc, {clip: 'Run', t: 0.2, yaw: 270, W: cw, H: ch, frame: fr}), renderCreature(nc, {clip: 'Attack', t: 0.42, yaw: 300, W: cw, H: ch, frame: fr}), renderCreature(nc, {clip: 'Death', t: 5, yaw: 270, W: cw, H: ch, frame: fr})],
    [renderCreature(nc, {yaw: 270, W: cw, H: ch, frame: fr, mode: 'weights'}), renderCreature(oc, {yaw: 270, W: cw, H: ch, frame: fr, mode: 'weights'}), renderCreature(nc, {yaw: 'top', W: cw, H: ch, frame: {cy: 0.15, h: 1.9}}), renderCreature(oc, {yaw: 'top', W: cw, H: ch, frame: {cy: 0.15, h: 1.9}})],
  ];
  const {sheet: csheet} = await import('../../creature/qa/render-lib.mjs');
  written.push(await csheet(path.join(OUT, `${kind}-${id}.png`), `${label}: row 1 reference | old (bind, right side) | new bind right side | new front; row 2 new Walk / Run / Attack bite / Death; row 3 skin weights new | old, top new | old`,
    rows, cw, ch, ['', '', '', ''], ['bind', 'clips', 'weights / top'], {labelW: 110}));
}
fs.rmSync(tmp, {recursive: true, force: true});
console.log(JSON.stringify({asset, written: written.map(f => path.relative(REPO, f)), reference: path.relative(REPO, ref), native: path.relative(REPO, path.join(T25_ROOT, d.nativeGlb))}));
