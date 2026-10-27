#!/usr/bin/env node
// SUPERSEDED in iteration 06 by qa/wardrobe-sheets.mjs (slot wardrobe; reads KHR_mesh_quantization +
// zombieWearable extras). Kept for the iteration-05 record; it cannot read the iteration-06 GLBs.
// CPU-rendered contact sheets of every body x look (no outfit + each outfit) straight from the
// runtime GLBs (zombie-body-*.glb, outfit-*.glb): applies each variant's hidden-body-triangle mask,
// poses with the GLB's own skeleton/clips (CPU linear-blend skinning) and rasterises with
// lib/raster.mjs. No browser/GPU.
//   node tools/asset-pipeline/zombie/qa/contact-sheet.mjs [--out=qa-artifacts/iter05-zombies] [--copy=reference/tasks/.../evidence]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {REPO} from '../lib/master.mjs';
import {Canvas} from '../lib/raster.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/iter05-zombies');
const MODELS = path.join(REPO, 'game/public/assets/models');
fs.mkdirSync(OUT, {recursive: true});
const io = new NodeIO();

const decode = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };
const arr = a => a ? a.getArray() : null;

// ---- quaternion / matrix helpers
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };

async function loadBody(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const node = root.listNodes().find(n => n.getName() === 'ZombieBody');
  const prim = node.getMesh().listPrimitives()[0];
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const mat = prim.getMaterial();
  const extras = root.listScenes()[0].getExtras().zombieBody;
  return {doc, extras, joints, names: joints.map(j => j.getName()), ibm: arr(skin.getInverseBindMatrices()),
    mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255},
    tex: await decode(mat.getBaseColorTexture().getImage()), anims: root.listAnimations()};
}
async function loadOutfit(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const extras = root.listScenes()[0].getExtras().zombieOutfit;
  const variants = {};
  let tex = null;
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0];
    if (!tex) tex = await decode(prim.getMaterial().getBaseColorTexture().getImage());
    variants[m[2]] = {extras: n.getExtras(), mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255}};
  }
  return {extras, variants, tex};
}

/** World joint matrices (as {q, p}) for a clip time, from the body's own animation. */
function poseAt(body, clipName, t) {
  const local = body.joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()}));
  const anim = clipName && body.anims.find(a => a.getName() === clipName);
  if (anim) for (const ch of anim.listChannels()) {
    const ji = body.joints.indexOf(ch.getTargetNode()); if (ji < 0) continue;
    const s = ch.getSampler(), T = s.getInput().getArray(), O = s.getOutput().getArray(), k = ch.getTargetPath() === 'rotation' ? 4 : 3;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i] || 1)));
    const v = Array.from({length: k}, (_, c) => O[i * k + c] * (1 - u) + O[(i + 1) * k + c] * u);
    if (k === 4) { const l = Math.hypot(...v); local[ji].q = v.map(x => x / l); } else local[ji].p = v;
  }
  const world = [];
  body.joints.forEach((j, i) => {
    const par = j.getParentNode && j.getParentNode();
    const pi = body.joints.indexOf(par);
    if (pi < 0) world[i] = {q: local[i].q, p: local[i].p};
    else { const P = world[pi]; world[i] = {q: qmul(P.q, local[i].q), p: qrot(P.q, local[i].p).map((v, c) => v + P.p[c])}; }
  });
  return world;
}
function skin(mesh, body, world) {
  const n = mesh.pos.length / 3, out = new Float32Array(n * 3);
  const bind = body.joints.map((_, j) => [-body.ibm[j * 16 + 12], -body.ibm[j * 16 + 13], -body.ibm[j * 16 + 14]]);
  for (let i = 0; i < n; i++) {
    const v = [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[i * 4 + k] / mesh.wScale; if (!w) continue;
      const j = mesh.joints[i * 4 + k], W = world[j], b = bind[j];
      const r = qrot(W.q, [v[0] - b[0], v[1] - b[1], v[2] - b[2]]);
      x += w * (r[0] + W.p[0]); y += w * (r[1] + W.p[1]); z += w * (r[2] + W.p[2]);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}
function maskedIndex(idx, b64) {
  if (!b64) return idx;
  const bits = Buffer.from(b64, 'base64');
  const out = [];
  for (let t = 0; t < idx.length / 3; t++) if (!(bits[t >> 3] & (1 << (t & 7)))) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  return Uint32Array.from(out);
}

function renderCell(body, outfit, {clip = null, t = 0, yaw = 0, W = 220, H = 330, frame, noBody = false}) {
  const c = new Canvas(W, H, [44, 44, 50]);
  const world = poseAt(body, clip, t);
  const v = outfit && outfit.variants[body.extras.id];
  if (v && v.extras.bodyGeometryHash !== body.extras.geometryHash) throw new Error(`mask/body hash mismatch ${outfit.extras.id} x ${body.extras.id}`);
  const cam = {yawDeg: yaw, cx: 0, cy: frame?.cy ?? 0.92, cz: 0, height: frame?.h ?? 2.0};
  if (!noBody) c.draw({pos: skin(body.mesh, body, world), idx: maskedIndex(body.mesh.idx, v?.extras.hideBodyTriangles), uv: body.mesh.uv, tex: body.tex}, cam);
  if (v) c.draw({pos: skin(v.mesh, body, world), idx: v.mesh.idx, uv: v.mesh.uv, tex: outfit.tex}, cam);
  return c;
}

const esc = s => String(s).replace(/[<>&]/g, ch => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[ch]));
async function sheet(file, title, rows, cellW, cellH, colLabels, rowLabels) {
  const LW = 120, TH = 46, CH = 22;
  const Wt = LW + cellW * colLabels.length, Ht = TH + CH + cellH * rows.length;
  const comps = [];
  rows.forEach((row, ri) => row.forEach((c, ci) => { if (c) comps.push({input: Buffer.from(c.rgb), raw: {width: c.w, height: c.h, channels: 3}, left: LW + ci * cellW, top: TH + CH + ri * cellH}); }));
  const svg = `<svg width="${Wt}" height="${Ht}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:DejaVu Sans,Arial,sans-serif;fill:#e8e4da}</style>
    <text x="10" y="28" font-size="20">${esc(title)}</text>
    ${colLabels.map((l, i) => `<text x="${LW + i * cellW + cellW / 2}" y="${TH + 16}" font-size="14" text-anchor="middle">${esc(l)}</text>`).join('')}
    ${rowLabels.map((l, i) => `<text x="8" y="${TH + CH + i * cellH + cellH / 2}" font-size="14">${esc(l)}</text>`).join('')}</svg>`;
  await sharp({create: {width: Wt, height: Ht, channels: 3, background: '#1c1c20'}}).composite([...comps, {input: Buffer.from(svg), left: 0, top: 0}]).png().toFile(file);
  console.log('wrote', path.relative(REPO, file));
  return file;
}

const files = fs.readdirSync(MODELS);
const bodies = [], outfits = [];
for (const f of files.filter(f => /^zombie-body-.+\.glb$/.test(f)).sort()) bodies.push(await loadBody(path.join(MODELS, f)));
for (const f of files.filter(f => /^outfit-.+\.glb$/.test(f)).sort()) outfits.push(await loadOutfit(path.join(MODELS, f)));
// stable order: canonical first
const order = ['lastshift'];
bodies.sort((a, b) => (order.indexOf(a.extras.id) + 1 || 99) - (order.indexOf(b.extras.id) + 1 || 99) || a.extras.id.localeCompare(b.extras.id));
const outfitOrder = ['coat'];
outfits.sort((a, b) => (outfitOrder.indexOf(a.extras.id) + 1 || 99) - (outfitOrder.indexOf(b.extras.id) + 1 || 99) || a.extras.id.localeCompare(b.extras.id));
if (args.focus) {
  // close-up QA: --focus=body:outfit,body:outfit -> front / side / back / outfit-only at 360x540
  const pairs = String(args.focus).split(',').map(p => p.split(':'));
  const rows = pairs.map(([b, o]) => { const B = bodies.find(x => x.extras.id === b), O = outfits.find(x => x.extras.id === o) ?? null; return [0, 90, 180].map(yaw => renderCell(B, O, {yaw, W: 360, H: 540, frame: {cy: 1.1, h: 1.3}})).concat([renderCell(B, O, {noBody: true, W: 360, H: 540, frame: {cy: 1.1, h: 1.3}})]); });
  await sheet(path.join(OUT, 'focus.png'), 'Focus: ' + args.focus, rows, 360, 540, ['front', 'side (char. left)', 'back', 'outfit only'], pairs.map(p => p.join('+')));
  process.exit(0);
}
const looks = [null, ...outfits];
const lookLabel = o => o ? o.extras.id : 'no outfit';
const written = [];
const cellW = 220, cellH = 330;
written.push(await sheet(path.join(OUT, 'bind-front.png'), `Bind pose, front - ${bodies.length} bodies x (no outfit + ${outfits.length} outfits) = ${bodies.length * looks.length} looks (${bodies.length * outfits.length} body x outfit combos)`,
  bodies.map(b => looks.map(o => renderCell(b, o, {W: cellW, H: cellH}))), cellW, cellH, looks.map(lookLabel), bodies.map(b => b.extras.id)));
written.push(await sheet(path.join(OUT, 'bind-back.png'), 'Bind pose, back view (180 deg)',
  bodies.map(b => looks.map(o => renderCell(b, o, {yaw: 180, W: cellW, H: cellH}))), cellW, cellH, looks.map(lookLabel), bodies.map(b => b.extras.id)));
written.push(await sheet(path.join(OUT, 'walk-frame.png'), 'Walk t=0.30 s, three-quarter view (yaw 35 deg)',
  bodies.map(b => looks.map(o => renderCell(b, o, {clip: 'Walk', t: 0.3, yaw: 35, W: cellW, H: cellH}))), cellW, cellH, looks.map(lookLabel), bodies.map(b => b.extras.id)));
written.push(await sheet(path.join(OUT, 'attack-frame.png'), 'Attack wind-up t=0.32 s (arms raised) and impact t=0.45 s, three-quarter view',
  bodies.map(b => looks.flatMap(o => [renderCell(b, o, {clip: 'Attack', t: 0.32, yaw: 30, W: 160, H: cellH}), renderCell(b, o, {clip: 'Attack', t: 0.45, yaw: -40, W: 160, H: cellH})])), 160, cellH, looks.flatMap(o => [lookLabel(o) + ' wind', lookLabel(o) + ' hit']), bodies.map(b => b.extras.id)));
written.push(await sheet(path.join(OUT, 'outfits-alone.png'), 'Fitted outfit meshes alone (bind pose): front | back, per body',
  bodies.map(b => outfits.flatMap(o => [renderCell(b, o, {noBody: true, W: 160, H: cellH}), renderCell(b, o, {noBody: true, yaw: 180, W: 160, H: cellH})])), 160, cellH, outfits.flatMap(o => [o.extras.id + ' front', o.extras.id + ' back']), bodies.map(b => b.extras.id)));
if (args.copy) {
  const dst = path.resolve(REPO, args.copy); fs.mkdirSync(dst, {recursive: true});
  for (const f of written) fs.copyFileSync(f, path.join(dst, path.basename(f)));
  console.log('copied to', path.relative(REPO, dst));
}
