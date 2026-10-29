#!/usr/bin/env node
// Wardrobe contact sheets (iteration 06), CPU-rendered straight from the runtime GLBs (no browser):
//   bind-front.png      every body x (base + every wearable it supports): each wearable on every body
//   bind-back.png       same, back view
//   combos-front.png    representative multi-slot looks per body (upper + lower + head/face)
//   combos-motion.png   the same looks in walk / attack wind-up / attack impact / run / death
//   slots-alone.png     each wearable alone per body (fit inspection)
//   node tools/asset-pipeline/zombie/qa/wardrobe-sheets.mjs [--models=game/public/assets/models] [--out=qa-artifacts/iter06-zombies] [--copy=reference/.../evidence]
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from '../lib/master.mjs';
import {loadBody, loadWearable, renderLook, sheet} from './render-lib.mjs';
import {liveModelFiles} from '../lib/live-files.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/iter06-zombies');
fs.mkdirSync(OUT, {recursive: true});
// T2.5 migration: the LIVE file per id (runtime manifest / -t25 in dev dirs), not every file matching the pattern
const live = liveModelFiles(MODELS);
const bodies = [], wear = [];
for (const f of Object.values(live.bodies).sort()) bodies.push(await loadBody(f));
for (const f of Object.values(live.wearables).sort()) { const w = await loadWearable(f); if (Object.keys(w.variants).length) wear.push(w); }
const BORDER = ['lastshift', 'courier', 'agent', 'scavenger', 'heavyset', 'tall'];
bodies.sort((a, b) => (BORDER.indexOf(a.extras.id) + 1 || 99) - (BORDER.indexOf(b.extras.id) + 1 || 99));
const SORDER = ['upper', 'lower', 'head', 'face'];
wear.sort((a, b) => SORDER.indexOf(a.extras.slot) - SORDER.indexOf(b.extras.slot) || a.extras.id.localeCompare(b.extras.id));
const W = (id) => wear.find(w => w.extras.id === id);
const sup = (B, w) => !!w.variants[B.extras.id];
const written = [];
const cellW = 150, cellH = 250;
const blank = null;

// 1+2: every wearable on every body (single slot)
const cols = [null, ...wear];
const colLabel = w => w ? `${w.extras.id} (${w.extras.slot})` : 'base';
for (const [name, yaw] of [['bind-front', 0], ['bind-back', 180]]) {
  written.push(await sheet(path.join(OUT, name + '.png'), `Bind pose ${yaw ? 'back' : 'front'} - ${bodies.length} bodies x (base + ${wear.length} wearables); blank = pair not supported (body covers slot / excluded)`,
    bodies.map(B => cols.map(w => !w ? renderLook(B, [], {yaw, W: cellW, H: cellH}) : sup(B, w) ? renderLook(B, [w], {yaw, W: cellW, H: cellH}) : blank)), cellW, cellH, cols.map(colLabel), bodies.map(b => b.extras.id)));
}
// head/face close-ups: every head/face item on every body
const hf = wear.filter(w => w.extras.slot === 'head' || w.extras.slot === 'face');
if (hf.length) {
  written.push(await sheet(path.join(OUT, 'head-face-closeups.png'), 'Head / face items close-up (front | 3/4) per body',
    bodies.map(B => hf.flatMap(w => sup(B, w) ? [0, 50].map(yaw => renderLook(B, [w], {yaw, W: 150, H: 170, frame: {cy: 1.55 * B.extras.heightM / 1.78, h: 0.5}})) : [blank, blank])), 150, 170, hf.flatMap(w => [w.extras.id + ' front', w.extras.id + ' 3/4']), bodies.map(b => b.extras.id)));
}
// 3+4: representative multi-slot looks per body (deterministic rotation through the wearables)
const bySlot = s => wear.filter(w => w.extras.slot === s);
const combos = [];
bodies.forEach((B, bi) => {
  for (let k = 0; k < 4; k++) {
    const look = [];
    for (const [si, s] of SORDER.entries()) {
      const list = bySlot(s).filter(w => sup(B, w));
      if (!list.length) continue;
      // upper/lower always (when supported); head on even k; face on k == 1 or 3 (minority)
      if (s === 'head' && k % 2) continue;
      if (s === 'face' && k !== 1) continue;
      look.push(list[(bi * 7 + k * 5 + si * 3 + k * si * 2) % list.length]);
    }
    combos.push({B, look});
  }
});
const comboLabel = c => [c.B.extras.id, ...c.look.map(w => w.extras.id)].join('+');
const perRow = 8;
const rowsOf = (list, fn) => { const rows = []; for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow).map(fn)); return rows; };
written.push(await sheet(path.join(OUT, 'combos-front.png'), 'Multi-slot looks (bind front): ' + combos.map(comboLabel).join(', ').slice(0, 260), rowsOf(combos, c => renderLook(c.B, c.look, {W: cellW, H: cellH})), cellW, cellH,
  [], Array.from({length: Math.ceil(combos.length / perRow)}, (_, i) => `#${i * perRow + 1}-${Math.min(combos.length, (i + 1) * perRow)}`), {labelW: 60}));
const MOTION = [['walk .3', {clip: 'Walk', t: 0.3, yaw: 35}], ['attack wind', {clip: 'Attack', t: 0.32, yaw: 30}], ['attack hit', {clip: 'Attack', t: 0.45, yaw: -40}], ['run .2', {clip: 'Run', t: 0.2, yaw: 60}], ['death end', {clip: 'Death', t: 5, yaw: 90}]];
const sample = combos.filter((_, i) => i % 4 < 2); // per body: one look with a head item, one with a face item
written.push(await sheet(path.join(OUT, 'combos-motion.png'), 'Multi-slot looks in motion (walk / attack wind-up / impact / run / death)',
  sample.map(c => MOTION.map(([, o]) => renderLook(c.B, c.look, {...o, W: 140, H: 230, frame: {cy: o.clip === 'Death' ? 0.55 : 0.92, h: 2.0}}))), 140, 230, MOTION.map(m => m[0]), sample.map(comboLabel), {labelW: 260}));
// 5: wearables alone per body
written.push(await sheet(path.join(OUT, 'slots-alone.png'), 'Fitted wearables alone (bind, front) per body',
  bodies.map(B => wear.map(w => sup(B, w) ? renderLook(B, [w], {noBody: true, W: 110, H: 200}) : blank)), 110, 200, wear.map(w => w.extras.id), bodies.map(b => b.extras.id)));
fs.writeFileSync(path.join(OUT, 'combos.json'), JSON.stringify(combos.map(c => ({body: c.B.extras.id, wear: Object.fromEntries(c.look.map(w => [w.extras.slot, w.extras.id]))})), null, 2) + '\n');
if (args.copy) {
  const dst = path.resolve(REPO, args.copy); fs.mkdirSync(dst, {recursive: true});
  for (const f of written) fs.copyFileSync(f, path.join(dst, 'zombies-' + path.basename(f)));
  console.log('copied to', path.relative(REPO, dst));
}
