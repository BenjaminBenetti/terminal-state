#!/usr/bin/env node
// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): QA sheets of the market humans (CPU renders; LOOK at them).
//   node tools/asset-pipeline/humans/qa/sheets.mjs [--cast <glb>] [--out <dir>] [--only=poses,looks,faces,scale]
// Writes (default qa-artifacts/market-humans/, git-ignored):
//   poses.png  every body bare (its own base layer) in the bind pose and the healthy clips (front + side views)
//   looks.png  every body in its fitted wearables (each worn alone + layered combinations), Idle / Walk
//   faces.png  head close-ups (healthy faces: no zombie skin / wounds)
//   scale.png  the five humans at runtime scale 1 beside a runtime-scaled standing zombie (zombie-body-lastshift-t25.glb, its
//              baked height; root scale 1.0 = the median of ai/zombieActor.ts 0.95 + rand x 0.1) on one ground line, 0.5 m grid
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {REPO} from '../../zombie/lib/master.mjs';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {loadBody, renderLook, sheet, poseAt, skinMesh} from '../../zombie/qa/render-lib.mjs';
import {loadCast} from './render-lib.mjs';

const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.replace(/^--/, '').split('=')));
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const CAST = path.resolve(arg('--cast') ?? path.join(REPO, 'game/public/assets/models/market-human-cast.glb'));
const OUT = path.resolve(arg('--out') ?? path.join(REPO, 'qa-artifacts/market-humans'));
const ONLY = OPT.only ? new Set(OPT.only.split(',')) : null;
fs.mkdirSync(OUT, {recursive: true});

const cast = await loadCast(CAST);
const ids = Object.keys(cast.bodies);
const dur = (B, c) => B.extras.clips?.[c]?.duration ?? 1;

if (!ONLY || ONLY.has('poses')) {
  const cols = [['Bind', null, 0, 0], ['Idle', 'Idle', 0.25, 0], ['Walk 0', 'Walk', 0, 0], ['Walk 1/4', 'Walk', 0.25, 0], ['Walk side', 'Walk', 0.12, 90], ['Talk', 'Talk', 0.3, 0],
    ['Greet', 'Greet', 0.45, 0], ['Work', 'Work', 0.3, 0], ['Work side', 'Work', 0.3, 90], ['Sit', 'Sit', 0, 0], ['Sit side', 'Sit', 0, 90]];
  const rows = ids.map(id => { const B = cast.bodies[id]; return cols.map(([, c, f, yaw]) => renderLook(B, [], {clip: c && `${id}:${c}`, t: c ? f * dur(B, c) : 0, yaw, W: 200, H: 300, frame: {cy: 0.95, h: 2.05}})); });
  await sheet(path.join(OUT, 'poses.png'), 'Market humans: bare bodies (own base layer) - bind + healthy clips', rows, 200, 300, cols.map(c => c[0]), ids.map(id => `${id} ${cast.bodies[id].extras.heightM} m`), {labelW: 90});
}

if (!ONLY || ONLY.has('looks')) {
  const rows = [], rowLabels = [];
  let ncol = 0;
  for (const id of ids) {
    const B = cast.bodies[id];
    const mine = Object.values(cast.wearables).filter(w => w.variants[id]);
    const by = s => mine.filter(w => w.extras.slot === s);
    const looks = [[], ...mine.map(w => [w])];
    // layered: each upper over the first lower + a hat
    for (const u of by('upper')) looks.push([u, by('lower')[looks.length % Math.max(1, by('lower').length)], by('head')[looks.length % Math.max(1, by('head').length)]].filter(Boolean));
    const compatible = look => look.every(a => look.every(b => a === b || !(a.variants[id].extras.incompatibleWear ?? []).includes(b.extras.id)));
    const ok = looks.filter(compatible);
    rows.push(ok.map((l, k) => renderLook(B, l, {clip: `${id}:${k % 3 === 2 ? 'Walk' : 'Idle'}`, t: 0.3, yaw: k % 4 === 3 ? 35 : 0, W: 170, H: 280, frame: {cy: 0.95, h: 2.05}})));
    rowLabels.push(`${id}: ${ok.map(l => l.map(w => w.extras.id).join('+') || 'base').join(' | ')}`.slice(0, 40));
    ncol = Math.max(ncol, ok.length);
  }
  await sheet(path.join(OUT, 'looks.png'), 'Market humans: fitted wearables (alone, then layered upper + lower + hat)', rows, 170, 280, Array.from({length: ncol}, (_, i) => i ? `look ${i}` : 'base layer'), rowLabels, {labelW: 60});
}

if (!ONLY || ONLY.has('faces')) {
  const cols = [['front', 0], ['3/4', 35], ['side', 90]];
  const rows = ids.map(id => { const B = cast.bodies[id]; return cols.map(([, yaw]) => renderLook(B, [], {clip: `${id}:Idle`, t: 0, yaw, W: 260, H: 300, frame: {cy: B.extras.heightM - 0.13, h: 0.36}})); });
  await sheet(path.join(OUT, 'faces.png'), 'Market humans: faces (Meshy base colour as shipped, 2048 px)', rows, 260, 300, cols.map(c => c[0]), ids, {labelW: 40});
}

if (!ONLY || ONLY.has('scale')) {
  const Z = await loadBody(path.join(REPO, 'game/public/assets/models/zombie-body-lastshift-t25.glb'));
  const figs = [{label: `zombie lastshift ${Z.extras.heightM} m (runtime scale 1.0)`, body: Z, clip: null}, ...ids.map(id => ({label: `${id} ${cast.bodies[id].extras.heightM} m`, body: cast.bodies[id], clip: null}))];
  const W = 1700, H = 520, step = 0.95, span = 2.4;
  const c = new Canvas(W, H, [40, 40, 46]);
  const cam = {yawDeg: 0, cx: 0, cy: 1.05, height: span};
  // grid lines every 0.5 m (thin bars)
  const k = H / span;
  for (let y = 0; y <= 2.0001; y += 0.5) { const py = Math.round(H / 2 - (y - cam.cy) * k); for (let x = 0; x < W; x++) if (py >= 0 && py < H) c.rgb.set(y === 0 ? [200, 200, 200] : [90, 90, 100], (py * W + x) * 3); }
  const x0 = -((figs.length - 1) * step) / 2;
  figs.forEach((f, i) => {
    const world = poseAt(f.body, f.clip, 0);
    const P = skinMesh(f.body.mesh, f.body, world);
    for (let v = 0; v < P.length; v += 3) P[v] += x0 + i * step;
    c.draw({pos: P, idx: f.body.mesh.idx, uv: f.body.mesh.uv, tex: f.body.tex, cullBack: true}, cam);
  });
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:DejaVu Sans,Arial,sans-serif;fill:#e8e4da}</style>
    ${figs.map((f, i) => `<text x="${W / 2 + (x0 + i * step) * k}" y="${H - 8}" font-size="12" text-anchor="middle">${f.label}</text>`).join('')}
    ${[0.5, 1, 1.5, 2].map(y => `<text x="6" y="${H / 2 - (y - cam.cy) * k - 3}" font-size="11">${y} m</text>`).join('')}</svg>`;
  await sharp(Buffer.from(c.rgb), {raw: {width: W, height: H, channels: 3}}).composite([{input: Buffer.from(svg), left: 0, top: 0}]).png().toFile(path.join(OUT, 'scale.png'));
  console.log('wrote', path.relative(REPO, path.join(OUT, 'scale.png')));
  const report = figs.map(f => { const P = f.body.mesh.pos; let lo = Infinity, hi = -Infinity, x0b = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let v = 0; v < P.length; v += 3) { lo = Math.min(lo, P[v + 1]); hi = Math.max(hi, P[v + 1]); x0b = Math.min(x0b, P[v]); x1 = Math.max(x1, P[v]); z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); } return {label: f.label, WxHxD: [x1 - x0b, hi - lo, z1 - z0].map(v => +v.toFixed(3)), lowestY: +lo.toFixed(4)}; });
  fs.writeFileSync(path.join(OUT, 'scale.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
