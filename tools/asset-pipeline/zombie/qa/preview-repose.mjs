#!/usr/bin/env node
// node tools/asset-pipeline/zombie/qa/preview-repose.mjs <source.glb> <out.png> [sha256]  - T->A re-pose preview (front/side)
import sharp from 'sharp';
import {loadSource} from '../lib/source.mjs';
import {reposeTtoA} from '../lib/repose.mjs';
import {Canvas} from '../lib/raster.mjs';
import {bounds} from '../lib/mesh.mjs';
const [file, out, sha] = process.argv.slice(2);
const m0 = await loadSource({id: 'preview', file, sha256: sha || undefined});
const m = reposeTtoA(m0);
console.log(JSON.stringify(m.repose));
const b = bounds(m.pos);
const Hh = (b.max[1] - b.min[1]) * 1.05, cy = (b.min[1] + b.max[1]) / 2, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
const W = 420, H = 480, views = [180, 90, 0, 225];
const sheet = Buffer.alloc(W * views.length * H * 3);
for (const [vi, yaw] of views.entries()) {
  const c = new Canvas(W, H);
  c.draw({pos: m.pos, idx: m.idx, uv: m.uv, tex: m.baseColor}, {yawDeg: yaw, cx, cy, cz, height: Hh});
  for (let y = 0; y < H; y++) Buffer.from(c.rgb.buffer, y * W * 3, W * 3).copy(sheet, (y * W * views.length + vi * W) * 3);
}
await sharp(sheet, {raw: {width: W * views.length, height: H, channels: 3}}).png().toFile(out);
