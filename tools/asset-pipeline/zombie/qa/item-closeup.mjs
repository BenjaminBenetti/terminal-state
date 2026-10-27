#!/usr/bin/env node
// Close-up of ONE fitted wearable variant alone (no body) from 4 sides - texture / bake inspection.
//   node qa/item-closeup.mjs <modelsDir> <wearableId> <bodyId> <out.png>
import path from 'node:path';
import sharp from 'sharp';
import {loadBody, loadWearable, renderLook} from './render-lib.mjs';
const [dir, wid, bid, out] = process.argv.slice(2);
const B = await loadBody(path.join(dir, `zombie-body-${bid}.glb`)), Wr = await loadWearable(path.join(dir, `outfit-${wid}.glb`));
const v = Wr.variants[bid].mesh; let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < v.pos.length; i += 3) { y0 = Math.min(y0, v.pos[i]); y1 = Math.max(y1, v.pos[i]); }
const S = 360, cells = [0, 90, 180, 270].map(yaw => renderLook(B, [Wr], {yaw, W: S, H: S, noBody: true, frame: {cy: (y0 + y1) / 2, h: (y1 - y0) * 1.4}}));
const buf = Buffer.alloc(S * 4 * S * 3);
cells.forEach((c, i) => { for (let y = 0; y < S; y++) Buffer.from(c.rgb.buffer, y * S * 3, S * 3).copy(buf, (y * S * 4 + i * S) * 3); });
await sharp(buf, {raw: {width: S * 4, height: S, channels: 3}}).png().toFile(out);
