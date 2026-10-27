#!/usr/bin/env node
// Iteration 07 (Lane W): wardrobe FIT contact sheets with poke-through highlighting (CPU raster, no browser).
//   node tools/asset-pipeline/zombie/qa/fit-sheets.mjs [--models=DIR] [--out=DIR] [--tag=after] [--copy=DIR]
// Per body: several looks x (rest | walk | attack) x (front | side | back), close framing on the torso
// and hips. Body triangles poking OUT through the worn cloth (lib/penetration.mjs definition, visible
// = front-most surface in the image) are painted MAGENTA; a lower garment poking through the upper is
// painted ORANGE. The magenta/orange pixel counts are written to <out>/fit-sheets-<tag>.json.
// Also: head-wear close-ups (front | side | back | 3/4) per body with every head/face item.
import fs from 'node:fs';
import path from 'node:path';
import {loadBody, loadWearable, skinMesh, maskedIndex, sheet} from './render-lib.mjs';
import {Canvas} from '../lib/raster.mjs';
import {loadBodyGeo, loadWearGeo, clipWorld, worldFromLocal, EXTREME_POSES, bodyEligible} from './fit-audit.mjs';
import {prepareInner, bindCoverage, auditPose, skin, unionHide, outerWallMask} from '../lib/penetration.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
const MODELS = path.resolve(REPO, args.models || 'game/public/assets/models');
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/iter07-wardrobe');
const TAG = args.tag || 'after';
fs.mkdirSync(OUT, {recursive: true});

const LOOKS = {
  lastshift: [['blazer', 'cargo'], ['coat', 'jeans'], ['flannel', 'slacks', 'hardhat'], ['hoodie', 'cargo', 'cap']],
  courier: [['trench', 'jeans'], ['hoodie', 'slacks'], ['sweater', 'cargo', 'beanie'], ['hivis', 'jeans', 'hardhat']],
  agent: [['blazer', 'slacks'], ['coat', 'cargo'], ['flannel', 'jeans', 'cap'], ['hivis', 'cargo', 'hardhat']],
  scavenger: [['trench', 'cargo'], ['hoodie', 'jeans'], ['sweater', 'slacks'], ['blazer', 'cargo']],
  heavyset: [['hoodie', 'jeans'], ['puffer', 'cargo'], ['blazer', 'slacks', 'hardhat'], ['trench', 'jeans', 'beanie']],
  tall: [['flannel', 'slacks'], ['puffer', 'jeans'], ['coat', 'cargo', 'hardhat'], ['hivis', 'jeans', 'cap']],
};
const POSES = [['rest', null, 0], ['walk', 'Walk', 0.3], ['attack', 'Attack', 0.45]];
const VIEWS = [['front', 0], ['side', 90], ['back', 180]];
const LAYER = {lower: 1, upper: 2, face: 3, head: 4};

const bodyCache = {}, wearCache = {};
const getBody = async id => (bodyCache[id] ??= {r: await loadBody(path.join(MODELS, `zombie-body-${id}.glb`)), g: await loadBodyGeo(path.join(MODELS, `zombie-body-${id}.glb`))});
const getWear = async id => (wearCache[id] ??= fs.existsSync(path.join(MODELS, `outfit-${id}.glb`)) ? {r: await loadWearable(path.join(MODELS, `outfit-${id}.glb`)), g: await loadWearGeo(path.join(MODELS, `outfit-${id}.glb`))} : null);

/** Poke state (body vs worn set; lower vs upper) for a world pose. */
function pokeTris(Bg, worn, world) {
  const out = {body: null, lower: null};
  const hide = unionHide(Bg.mesh.idx.length / 3, worn.map(o => o.v.extras.hideBodyTriangles));
  const inner = prepareInner(Bg.mesh, hide, bodyEligible(Bg));
  const cover = bindCoverage(inner, worn.map(o => o.v.mesh));
  const ip = skin(Bg.mesh, world, 255);
  const op = worn.map(o => ({pos: skin(o.v.mesh, world, 255).pos, idx: o.v.mesh.idx}));
  const r = auditPose(inner, cover, ip, op, {withState: true, outerInside: false});
  out.body = triFlags(Bg.mesh.idx, inner.remap, r.state, hide);
  const up = worn.find(o => o.slot === 'upper'), lo = worn.find(o => o.slot === 'lower');
  if (up && lo) {
    const lh = unionHide(lo.v.mesh.idx.length / 3, [up.v.extras.hideWear?.[lo.id]]);
    const li = prepareInner(lo.v.mesh, lh, outerWallMask(lo.v.mesh, Bg.mesh));
    const lc = bindCoverage(li, [up.v.mesh]);
    const lp = skin(lo.v.mesh, world, 255);
    const rr = auditPose(li, lc, lp, [{pos: skin(up.v.mesh, world, 255).pos, idx: up.v.mesh.idx}], {withState: true, outerInside: false});
    out.lower = triFlags(lo.v.mesh.idx, li.remap, rr.state, lh);
  }
  return out;
}
const triFlags = (idx, remap, state, hide) => {
  const keep = [];
  for (let t = 0; t < idx.length / 3; t++) { if (hide && hide[t]) continue; if ([0, 1, 2].some(c => state[remap[idx[t * 3 + c]]] === 2)) keep.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]); }
  return Uint32Array.from(keep);
};

function render(B, worn, {clip, t, yaw, W, H, frame, overlay = true, rot = null}) {
  const c = new Canvas(W, H, [44, 44, 50]);
  const world = rot ? worldFromLocal(B.g, rot) : clip ? clipWorld(B.g, clip, t) : worldFromLocal(B.g);
  const rw = world.map(w => ({q: w.q, p: w.p}));
  const cam = {yawDeg: yaw, cx: frame.cx ?? 0, cy: frame.cy, cz: frame.cz ?? 0, height: frame.h};
  const bodyPos = skinMesh(B.r.mesh, B.r, rw);
  c.draw({pos: bodyPos, idx: maskedIndex(B.r.mesh.idx, worn.map(o => o.v.extras.hideBodyTriangles)), uv: B.r.mesh.uv, tex: B.r.tex, cullBack: true}, cam);
  const posed = new Map();
  for (const o of [...worn].sort((a, b) => LAYER[a.slot] - LAYER[b.slot])) {
    const v = o.rv;
    const over = worn.filter(x => x !== o).map(x => x.v.extras.hideWear?.[o.id]).filter(Boolean);
    const p = skinMesh(v.mesh, B.r, rw); posed.set(o.id, p);
    c.draw({pos: p, idx: maskedIndex(v.mesh.idx, over), uv: v.mesh.uv, tex: o.r.tex, cullBack: true}, cam);
  }
  let magenta = 0, orange = 0;
  if (overlay && worn.length) {
    const cloth = worn.filter(o => o.slot === 'upper' || o.slot === 'lower').length ? worn.filter(o => o.slot === 'upper' || o.slot === 'lower') : worn;
    const pk = pokeTris(B.g, cloth, world);
    if (pk.body.length) c.draw({pos: bodyPos, idx: pk.body, color: [255, 0, 255], cullBack: true, zBias: 0.002, mark: 1}, cam);
    const lo = cloth.find(o => o.slot === 'lower');
    if (pk.lower?.length) c.draw({pos: posed.get(lo.id), idx: pk.lower, color: [255, 140, 0], cullBack: true, zBias: 0.002, mark: 2}, cam);
    if (c.mark) for (const m of c.mark) { if (m === 1) magenta++; else if (m === 2) orange++; }
  }
  c.stats = {magenta, orange};
  return c;
}

const written = [], stats = {};
const bodies = Object.keys(LOOKS).filter(b => fs.existsSync(path.join(MODELS, `zombie-body-${b}.glb`)));
for (const b of bodies) {
  const B = await getBody(b);
  const Hm = B.r.extras.heightM;
  const rows = [], labels = [];
  for (const ids of LOOKS[b]) {
    const worn = [];
    for (const id of ids) {
      const w = await getWear(id);
      if (!w || !w.r.variants[b]) continue;
      worn.push({id, slot: w.r.extras.slot, r: w.r, rv: w.r.variants[b], v: w.g.variants[b]});
    }
    if (!worn.length) continue;
    const row = [];
    for (const [pn, clip, t] of POSES) for (const [vn, yaw] of VIEWS) {
      const c = render(B, worn, {clip, t, yaw: yaw + (clip ? 15 : 0), W: 230, H: 330, frame: {cy: 1.08 * Hm / 1.78, h: 1.15}});
      row.push(c);
      (stats[`${b}:${worn.map(o => o.id).join('+')}`] ??= {})[`${pn}-${vn}`] = c.stats;
    }
    rows.push(row);
    labels.push([b, ...worn.map(o => o.id)].join('+'));
  }
  const cols = POSES.flatMap(([pn]) => VIEWS.map(([vn]) => `${pn} ${vn}`));
  written.push(await sheet(path.join(OUT, `fit-${b}-${TAG}.png`), `${b} (${TAG}): rest / walk / attack x front / side / back; MAGENTA = body poking out through the cloth, ORANGE = pants poking through the upper`, rows, 230, 330, cols, labels, {labelW: 170}));
}

// ragdoll-like extreme poses (inside the runtime ragdoll joint limits): per body its first available look
const rowsX = [], labX = [];
for (const b of bodies) {
  const B = await getBody(b);
  let worn = null;
  for (const ids of LOOKS[b]) {
    const w = [];
    for (const id of ids) { const x = await getWear(id); if (x && x.r.variants[b]) w.push({id, slot: x.r.extras.slot, r: x.r, rv: x.r.variants[b], v: x.g.variants[b]}); }
    if (w.some(o => o.slot === 'upper' || o.slot === 'lower')) { worn = w; break; }
  }
  if (!worn) continue;
  const row = [];
  for (const [name, rot] of Object.entries(EXTREME_POSES)) for (const yaw of [20, 200]) {
    const c = render(B, worn, {rot, yaw, W: 210, H: 260, frame: {cy: 1.0 * B.r.extras.heightM / 1.78, h: 1.9}});
    row.push(c);
    (stats[`${b}:${worn.map(o => o.id).join('+')}`] ??= {})[`${name}-${yaw}`] = c.stats;
  }
  rowsX.push(row); labX.push([b, ...worn.map(o => o.id)].join('+'));
}
if (rowsX.length) written.push(await sheet(path.join(OUT, `fit-extreme-${TAG}.png`), `Ragdoll-like extreme poses (${TAG}); MAGENTA = body poking out through the cloth, ORANGE = pants through the upper`, rowsX, 210, 260, Object.keys(EXTREME_POSES).flatMap(n => [n + ' front', n + ' back']), labX, {labelW: 170}));

// head-wear close-ups: every head/face item per body, 4 views + the attack pose
const HW = ['hardhat', 'cap', 'beanie', 'gasmask', 'respirator'];
const rowsH = [], labH = [];
const colsH = ['front', '3/4', 'side', 'back', 'attack 3/4'];
for (const b of bodies) {
  const B = await getBody(b);
  for (const id of HW) {
    const w = await getWear(id);
    if (!w || !w.r.variants[b]) continue;
    const worn = [{id, slot: w.r.extras.slot, r: w.r, rv: w.r.variants[b], v: w.g.variants[b]}];
    const hi = B.g.names.indexOf('Head'), hy = B.g.bind[hi][1];
    const aw = clipWorld(B.g, 'Attack', 0.45)[hi].p;
    rowsH.push([0, 40, 90, 180].map(yaw => render(B, worn, {yaw, W: 170, H: 190, frame: {cy: hy + 0.06, h: 0.42}, overlay: !!args.headOverlay}))
      .concat([render(B, worn, {clip: 'Attack', t: 0.45, yaw: 40, W: 170, H: 190, frame: {cx: aw[0], cz: aw[2], cy: aw[1] + 0.05, h: 0.5}, overlay: !!args.headOverlay})]));
    labH.push(`${b}+${id}`);
  }
}
if (rowsH.length) {
  // split into two sheets to keep them readable
  const half = Math.ceil(rowsH.length / 2);
  written.push(await sheet(path.join(OUT, `headwear-${TAG}-a.png`), `Head / face items (${TAG}) - front, 3/4, side, back, attack`, rowsH.slice(0, half), 170, 190, colsH, labH.slice(0, half), {labelW: 150}));
  written.push(await sheet(path.join(OUT, `headwear-${TAG}-b.png`), `Head / face items (${TAG}) - front, 3/4, side, back, attack`, rowsH.slice(half), 170, 190, colsH, labH.slice(half), {labelW: 150}));
}
fs.writeFileSync(path.join(OUT, `fit-sheets-${TAG}.json`), JSON.stringify({models: path.relative(REPO, MODELS), note: 'visible poke-through pixels per look/pose/view at 230x330 px (magenta = body through cloth, orange = pants through the upper)', stats}, null, 1) + '\n');
if (args.copy) {
  const dst = path.resolve(REPO, args.copy); fs.mkdirSync(dst, {recursive: true});
  for (const f of written) fs.copyFileSync(f, path.join(dst, 'iter07-' + path.basename(f)));
  console.log('copied', written.length, 'sheets to', path.relative(REPO, dst));
}
