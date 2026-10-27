#!/usr/bin/env node
// Lane P2 (iteration 07): stacks the builder's per-type preview strips (.cache/iteration07-p2-previews/<key>.png: conditioning input |
// front | right | back | 3/4 | rear 3/4 of the RUNTIME mesh) into one labelled contact sheet for review. QA only (not a game asset).
// Usage: node tools/asset-pipeline/props/contact-sheet-iteration07.mjs --out <png> [--scale 0.5] [--since <iso>] [key ...]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PREV = path.join(REPO, '.cache/iteration07-p2-previews');
const PROV = path.join(REPO, 'game/public/assets/derivatives/props-iteration07.json');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt('--out') ?? '/tmp/p7-sheet.png', scale = Number(opt('--scale') ?? 0.5), since = opt('--since');
const prov = JSON.parse(fs.readFileSync(PROV, 'utf8'));
let keys = args.length ? args : prov.outputs.map(o => o.key);
if (since) keys = keys.filter(k => fs.existsSync(path.join(PREV, `${k}.png`)) && fs.statSync(path.join(PREV, `${k}.png`)).mtimeMs >= Date.parse(since));
const rows = [];
for (const k of keys) {
  const f = path.join(PREV, `${k}.png`);
  if (!fs.existsSync(f)) continue;
  const o = prov.outputs.find(x => x.key === k);
  const m = await sharp(f).metadata();
  const W = Math.round(m.width * scale), H = Math.round(m.height * scale);
  const label = `${k} [${o?.mode ?? '?'} ${o?.sizeClass ?? ''}] ${o ? `${o.dimensionsMeters.measured.w}x${o.dimensionsMeters.measured.h}x${o.dimensionsMeters.measured.d} m ${o.triangles} tris ${(o.bytes / 1000).toFixed(0)} kB` : ''}`;
  const svg = Buffer.from(`<svg width="${W}" height="18"><rect width="100%" height="100%" fill="#111"/><text x="4" y="13" font-family="sans-serif" font-size="12" fill="#eee">${label.replace(/[<&>]/g, '')}</text></svg>`);
  rows.push({img: await sharp(f).resize(W, H).png().toBuffer(), svg, W, H});
}
if (!rows.length) { console.log('no previews'); process.exit(0); }
const W = Math.max(...rows.map(r => r.W)), H = rows.reduce((s, r) => s + r.H + 18, 0);
const comp = []; let y = 0;
for (const r of rows) { comp.push({input: r.svg, top: y, left: 0}); comp.push({input: r.img, top: y + 18, left: 0}); y += r.H + 18; }
const canvas = sharp({create: {width: W, height: H, channels: 3, background: '#282828'}}).composite(comp);
await (out.endsWith('.jpg') ? canvas.jpeg({quality: 82}) : canvas.png()).toFile(out);
console.log(`${out}: ${rows.length} rows`);
