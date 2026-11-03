#!/usr/bin/env node
// node tools/asset-pipeline/zombie/qa/preview-repose-skin.mjs <source.glb> <out.png> <heightM> '<hair rule json>' [sha256]
// Lane BODY (task mall-lingerie-20261102): preview of the LBS T->A repose (lib/repose-skin.mjs) on the densified source, exactly as
// build-wardrobe.mjs runs it for `repose: 'T-skin'` bodies (front / side / back / 3/4, CPU raster). Prints the repose log.
import sharp from 'sharp';
import {loadSource} from '../lib/source.mjs';
import {densify} from '../lib/densify.mjs';
import {reposeTtoAskinned} from '../lib/repose-skin.mjs';
import {Canvas} from '../lib/raster.mjs';
import {bounds} from '../lib/mesh.mjs';
import {T25_DENSIFY} from '../wardrobe.config.mjs';
const [file, out, heightM, hairJson, sha] = process.argv.slice(2);
let m = await loadSource({id: 'preview', file, sha256: sha || undefined});
const b0 = bounds(m.pos);
const d = densify(m, (b0.max[1] - b0.min[1]) * T25_DENSIFY.body);
m = {...m, pos: d.pos, nrm: d.nrm, uv: d.uv, idx: d.idx};
const r = await reposeTtoAskinned(m, {heightM: +heightM, hair: hairJson ? JSON.parse(hairJson) : null});
console.log(JSON.stringify({...r.repose, skeletonT: undefined}));
const b = bounds(r.pos);
const Hh = (b.max[1] - b.min[1]) * 1.05, cy = (b.min[1] + b.max[1]) / 2, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
const W = 420, H = 480, views = [0, 90, 180, 225];
const sheet = Buffer.alloc(W * views.length * H * 3);
for (const [vi, yaw] of views.entries()) {
  const c = new Canvas(W, H);
  c.draw({pos: r.pos, idx: r.idx, uv: r.uv, tex: r.baseColor}, {yawDeg: yaw, cx, cy, cz, height: Hh});
  for (let y = 0; y < H; y++) Buffer.from(c.rgb.buffer, y * W * 3, W * 3).copy(sheet, (y * W * views.length + vi * W) * 3);
}
await sharp(sheet, {raw: {width: W * views.length, height: H, channels: 3}}).png().toFile(out);
console.log('wrote', out);
