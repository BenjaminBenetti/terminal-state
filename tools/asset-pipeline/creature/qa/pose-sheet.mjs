#!/usr/bin/env node
// Pose / clip-frame contact sheet of the BUILT creature GLB (CPU render).
//   node tools/asset-pipeline/creature/qa/pose-sheet.mjs [--out=/tmp/ll-creature/poses.png] [--mode=tex|weights]
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from '../../zombie/lib/master.mjs';
import {loadCreature, render, sheet} from './render-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const OUT = path.resolve(REPO, args.out || '/tmp/ll-creature/poses.png');
fs.mkdirSync(path.dirname(OUT), {recursive: true});
const c = await loadCreature(path.join(REPO, 'game/public/assets/models/creature-ratdog.glb'));
const mode = args.mode || 'tex';
const W = 300, H = 220, fr = {cy: 0.3, h: 0.9};
const rows = [];
const labels = [];
const add = (label, list) => { labels.push(label); rows.push(list.map(o => render(c, {W, H, mode, frame: fr, ...o}))); };
add('bind', [{yaw: 270}, {yaw: 90}, {yaw: 0}, {yaw: 180}, {yaw: 'top', frame: {h: 1.5}}]);
const clip = (name, n, extra = {}) => { const d = c.extras.clips[name].duration; add(name, Array.from({length: n}, (_, i) => ({clip: name, t: d * i / (n - (c.extras.clips[name].loop ? 0 : 1)), yaw: 270, ...extra}))); };
clip('Idle', 5); clip('Walk', 5); clip('Run', 5); clip('Attack', 5); clip('Hit', 5); clip('Death', 5, {yaw: 300});
await sheet(OUT, `creature-ratdog ${mode} (CPU skinned from the runtime GLB)`, rows, W, H, ['', '', '', '', ''], labels);
console.log('wrote', OUT);
