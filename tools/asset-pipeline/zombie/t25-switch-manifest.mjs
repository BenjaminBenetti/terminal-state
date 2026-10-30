#!/usr/bin/env node
// Meshy T2.5 migration (lane CHARS): point the runtime manifest (game/src/assets/manifest.ts MODEL_FILES) at the files
// the last build-wardrobe.mjs run shipped (derivatives/zombie-wardrobe.json bodies / wearables .glb + bytes). Only the
// `zombieBody_<id>` / `outfit_<id>` entries are touched (anchored per-line replacement; the rest of the shared file,
// incl. other lanes' entries, is left byte-for-byte). Model keys stay the same; only url / bytes change.
//   node tools/asset-pipeline/zombie/t25-switch-manifest.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import {REPO} from './lib/master.mjs';

const MANIFEST = path.join(REPO, 'game/src/assets/manifest.ts');
const W = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/zombie-wardrobe.json'), 'utf8'));
let src = fs.readFileSync(MANIFEST, 'utf8');
const changes = [];
const entry = (key, glb) => {
  const url = glb.replace(/^game\/public\//, '');
  const bytes = fs.statSync(path.join(REPO, glb)).size;
  const kb = `${Math.round(bytes / 1000).toLocaleString('en-US').replace(/,/g, '_')}_000`;
  const re = new RegExp(`^(\\s*${key}: \\{url: ')([^']+)(', bytes: )([0-9_]+)(\\})`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`manifest entry ${key} not found`);
  if (m[2] === url && m[4] === kb) return;
  src = src.replace(re, `$1${url}$3${kb}$5`);
  changes.push({key, from: m[2], to: url, bytes: kb});
};
for (const [id, b] of Object.entries(W.bodies)) entry(`zombieBody_${id}`, b.glb);
for (const [id, w] of Object.entries(W.wearables)) if (!w.excludedOnEveryBody) entry(`outfit_${id}`, w.glb);
if (!process.argv.includes('--dry')) fs.writeFileSync(MANIFEST, src);
console.log(JSON.stringify(changes, null, 1));
