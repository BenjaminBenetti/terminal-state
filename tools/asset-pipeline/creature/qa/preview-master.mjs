#!/usr/bin/env node
// Orientation probe of the READ-ONLY quadruped master (no writes next to it): CPU renders from
// several yaws + a top view into /tmp/ll-creature/master-views.png.
import fs from 'node:fs';
import sharp from 'sharp';
import {loadSource} from '../../zombie/lib/source.mjs';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {MASTER} from '../lib/master.mjs';

const m = await loadSource(MASTER);
console.log('tris', m.triangles, 'verts', m.vertices);
const W = 360, H = 260;
const views = [];
const tex = {...m.baseColor, channels: 4};
for (const yaw of [0, 90, 180, 270]) {
  const c = new Canvas(W, H);
  c.draw({pos: m.pos, idx: m.idx, uv: m.uv, tex, nrm: m.nrm}, {yawDeg: yaw, cx: 0.03, cy: 0.015, cz: -0.04, height: 0.75});
  views.push(c);
}
// top view: rotate (x, y, z) -> (x, -z, y) so +Y looks at the camera (camera yaw 0 looks at +Z face)
{
  const P = new Float32Array(m.pos.length), N = new Float32Array(m.nrm.length);
  for (let i = 0; i < P.length; i += 3) { P[i] = m.pos[i]; P[i + 1] = -m.pos[i + 2]; P[i + 2] = m.pos[i + 1]; N[i] = m.nrm[i]; N[i + 1] = -m.nrm[i + 2]; N[i + 2] = m.nrm[i + 1]; }
  const c = new Canvas(W, H);
  c.draw({pos: P, idx: m.idx, uv: m.uv, tex, nrm: N}, {yawDeg: 0, cx: 0.03, cy: 0.04, height: 0.75});
  views.push(c);
}
fs.mkdirSync('/tmp/ll-creature', {recursive: true});
const comps = views.map((c, i) => ({input: Buffer.from(c.rgb), raw: {width: W, height: H, channels: 3}, left: (i % 3) * W, top: Math.floor(i / 3) * H}));
await sharp({create: {width: W * 3, height: H * 2, channels: 3, background: '#000'}}).composite(comps).png().toFile('/tmp/ll-creature/master-views.png');
console.log('views: yaw0 (+Z face), yaw90, yaw180, yaw270, top (+Y; image up = -Z)');
