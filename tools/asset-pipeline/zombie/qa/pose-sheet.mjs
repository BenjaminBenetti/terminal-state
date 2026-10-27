#!/usr/bin/env node
// Pose sheet for chosen looks: each row = body[+wearable+...], columns = bind front/side/back +
// clip frames (Walk/Attack/Death/Run). Used to diagnose fit problems in MOTION.
//   node tools/asset-pipeline/zombie/qa/pose-sheet.mjs --looks=scavenger,scavenger+hivis,lastshift+cargo+hardhat \
//        [--models=game/public/assets/models] [--out=qa-artifacts/iter06-zombies/pose.png] [--title=...] [--frame=1.1,1.3]
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from '../lib/master.mjs';
import {loadBody, loadWearable, renderLook, sheet} from './render-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/iter06-zombies/pose-sheet.png');
fs.mkdirSync(path.dirname(OUT), {recursive: true});
// a look may name a models directory: 'before@scavenger+hivis' with --dirs=before=/path,after=/path
const DIRS = Object.fromEntries(String(args.dirs || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, path.resolve(REPO, v)]));
const looks = String(args.looks || 'scavenger').split(',').map(s => { const [d, l] = s.includes('@') ? s.split('@') : [null, s]; const parts = l.split('+'); parts.dir = d; return parts; });
const bodyCache = {}, wearCache = {};
const dirOf = d => d ? DIRS[d] : MODELS;
const body = async (id, d) => bodyCache[d + ':' + id] ??= await loadBody(path.join(dirOf(d), `zombie-body-${id}.glb`));
const wear = async (id, d) => wearCache[d + ':' + id] ??= await loadWearable(path.join(dirOf(d), `outfit-${id}.glb`));
const [fcy, fh] = args.frame ? String(args.frame).split(',').map(Number) : [0.92, 2.0];
const COLS = [
  ['bind front', {yaw: 0}], ['bind side', {yaw: 90}], ['bind back', {yaw: 180}],
  ['walk .3 3/4', {clip: 'Walk', t: 0.3, yaw: 35}], ['walk .9 side', {clip: 'Walk', t: 0.9, yaw: 90}],
  ['attack .32 wind', {clip: 'Attack', t: 0.32, yaw: 30}], ['attack .32 front', {clip: 'Attack', t: 0.32, yaw: 0}], ['attack .45 hit', {clip: 'Attack', t: 0.45, yaw: -40}],
  ['run .2', {clip: 'Run', t: 0.2, yaw: 60}], ['death 0.5', {clip: 'Death', t: 0.5, yaw: 70}], ['death end', {clip: 'Death', t: 5, yaw: 90}],
];
const cols = args.cols ? COLS.filter(([l]) => String(args.cols).split(',').some(k => l.startsWith(k))) : COLS;
const W = +(args.w || 200), H = +(args.h || 300);
const rows = [];
for (const lk of looks) {
  const [b, ...ws] = lk;
  const B = await body(b, lk.dir), Ws = [];
  for (const w of ws) Ws.push(await wear(w, lk.dir));
  rows.push(cols.map(([, o]) => renderLook(B, Ws, {...o, W, H, frame: {cy: o.clip === 'Death' ? 0.6 : fcy, h: fh}})));
}
await sheet(OUT, args.title || 'Pose sheet', rows, W, H, cols.map(c => c[0]), looks.map(l => (l.dir ? l.dir + ': ' : '') + l.join('+')), {labelW: 170});
