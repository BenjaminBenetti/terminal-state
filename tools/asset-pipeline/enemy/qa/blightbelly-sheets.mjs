#!/usr/bin/env node
// Task track1-siren-blightbelly-20261031 (lane RIGB): CPU QA sheets of the WRITTEN Blightbelly GLB (no browser / GPU):
//   node tools/asset-pipeline/enemy/qa/blightbelly-sheets.mjs [--out DIR]   (default reference/tasks/<task>/evidence/RIGB)
// Reads game/public/assets/models/enemy-blightbelly.glb (+ the heavyset zombie body for scale), CPU-skins the GLB's own
// animation tracks (FK from the node hierarchy, linear-blend skinning) and renders with zombie/lib/raster.mjs:
//   bind-joints.png      front / side / back bind pose + skeleton + pustule burst points
//   clips-34.png         all six clips, 6 frames each (3/4 front view)
//   clips-side.png       Walk / Run / Attack / Death side view (feet, belly, arm clearance)
//   boils-closeup.png    pustule close-ups (front / back / side)
//   beside-zombie.png    beside the runtime-scale heavyset zombie (front, side) + top-down collider vs a 1.0 m doorway
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {REPO} from '../../zombie/lib/master.mjs';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {qMul, qRot, V} from '../../zombie/lib/pose.mjs';
import {Canvas, project, dot, line, hline, drawSkeleton, composeGrid} from '../lib/qa-render.mjs';

const argOut = process.argv.indexOf('--out');
const OPT = {out: argOut > 0 ? process.argv[argOut + 1] : undefined};
const OUT = path.resolve(OPT.out ?? path.join(REPO, 'reference/tasks/track1-siren-blightbelly-20261031/evidence/RIGB'));
const GLB = path.join(REPO, 'game/public/assets/models/enemy-blightbelly.glb');
const ZOMBIE = path.join(REPO, 'game/public/assets/models/zombie-body-heavyset-t25.glb');

async function decode(tex) {
  const {data, info} = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height};
}

/** Skinned GLB -> {bind: {name: pos}, meshes: [{name, pos, nrm, uv, idx, joints, weights, tex}], clips: [{name, frames, times, tracks}], extras}. */
async function loadSkinned(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const root = doc.getRoot();
  const parent = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const skinNodes = root.listNodes().filter(n => n.getSkin() && n.getMesh());
  const skin = skinNodes[0].getSkin();
  const jn = skin.listJoints();
  const names = jn.map(j => j.getName());
  if (names.join() !== JOINTS.map(j => j[0]).join()) throw new Error('unexpected joint order');
  const bind = {};
  for (const j of jn) { let p = [0, 0, 0], n = j; while (n && names.includes(n.getName())) { p = V.add(p, n.getTranslation()); if (n.getRotation().some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-6)) throw new Error('non-identity bind rotation'); n = parent.get(n); } bind[j.getName()] = p; }
  const meshes = [];
  for (const node of skinNodes) for (const prim of node.getMesh().listPrimitives()) {
    const A = s => prim.getAttribute(s);
    const nA = A('NORMAL'), nArr = nA.getArray(), nrm = nA.getNormalized() ? Float32Array.from(nArr, v => Math.max(-1, v / 127)) : Float32Array.from(nArr);
    const wA = A('WEIGHTS_0'), wArr = wA.getArray(), weights = wA.getNormalized() ? Float32Array.from(wArr, v => v / 255) : Float32Array.from(wArr);
    const mat = prim.getMaterial();
    meshes.push({name: node.getName(), pos: Float32Array.from(A('POSITION').getArray()), nrm, uv: Float32Array.from(A('TEXCOORD_0').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()),
      joints: Uint16Array.from(A('JOINTS_0').getArray()), weights, tex: mat.getBaseColorTexture() ? await decode(mat.getBaseColorTexture()) : null});
  }
  const clips = root.listAnimations().map(a => {
    const tracks = {};
    let times = null;
    for (const ch of a.listChannels()) {
      const s = ch.getSampler(), t = s.getInput().getArray(), o = s.getOutput().getArray(), k = ch.getTargetPath() === 'rotation' ? 4 : 3;
      times = t;
      (tracks[ch.getTargetNode().getName()] ??= {})[ch.getTargetPath()] = Array.from({length: t.length}, (_, f) => Array.from(o.slice(f * k, f * k + k)));
    }
    return {name: a.getName(), times: Array.from(times), tracks};
  });
  return {bind, meshes, clips, extras: root.listScenes()[0].getExtras(), local: Object.fromEntries(jn.map(j => [j.getName(), j.getTranslation()]))};
}

/** FK of frame f of a clip (null clip = bind pose) using the GLB node hierarchy (JOINTS order is topological). */
function fk(M, clip, f) {
  const world = {};
  for (const [name, par] of JOINTS) {
    const tr = clip?.tracks[name];
    const lr = tr?.rotation ? tr.rotation[Math.min(f, tr.rotation.length - 1)] : [0, 0, 0, 1];
    const lt = tr?.translation ? tr.translation[Math.min(f, tr.translation.length - 1)] : M.local[name];
    if (!par) { world[name] = {pos: lt, rot: lr}; continue; }
    const P = world[par];
    world[name] = {pos: V.add(P.pos, qRot(P.rot, lt)), rot: qMul(P.rot, lr)};
  }
  return world;
}

const posed = (M, clip, f) => { const w = fk(M, clip, f); return {world: w, meshes: M.meshes.map(m => ({...m, pos: skinPositions(m, {joints: M.bind}, w), nrm: undefined}))}; };
const bboxOf = meshes => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[i + k]); hi[k] = Math.max(hi[k], m.pos[i + k]); } return {lo, hi}; };

function drawMeshes(c, cam, meshes) { for (const m of meshes) c.draw({pos: m.pos, idx: m.idx, uv: m.uv, tex: m.tex}, cam); }

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const M = await loadSkinned(GLB);
  const X = M.extras.enemyBlightbelly;
  const Z = await loadSkinned(ZOMBIE);
  const written = [];

  // ---- 1. bind + joints + burst points
  {
    const cells = [];
    const bp = posed(M, null, 0);
    for (const [yaw, lab] of [[0, 'front'], [90, 'side (from +X)'], [180, 'back']]) {
      const c = new Canvas(560, 640), cam = {yawDeg: yaw, cx: 0, cy: 0.98, cz: 0, height: 2.1};
      drawMeshes(c, cam, bp.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      drawSkeleton(c, cam, Object.fromEntries(Object.entries(bp.world).map(([k, v]) => [k, v.pos])), JOINTS);
      for (const p of X.pustules) { const s = project(c, cam, V.add(M.bind[p.bone], p.offset)); if (s[2] > -0.05 || yaw === 90) dot(c, s[0], s[1], 3.5, [60, 220, 255]); }
      cells.push({canvas: c, label: `${lab}: bind A-pose, 18 joints (yellow), burst points (cyan)`});
    }
    const f = path.join(OUT, 'bind-joints.png');
    await composeGrid(cells, {cols: 3, title: `Blightbelly bind pose ${X.heightM} m - skeleton + ${X.pustules.length} pustule burst points`, file: f});
    written.push(f);
  }

  // ---- 2. clips, 3/4 view, 6 frames each
  const sheet = async (file, title, yaw, clipNames, nFrames, W = 300, H = 380, height = 2.25) => {
    const cells = [];
    for (const cn of clipNames) {
      const clip = M.clips.find(c => c.name === cn), meta = X.clips[cn];
      const last = clip.times.length - 1, n = meta.loop ? nFrames : nFrames;
      for (let k = 0; k < n; k++) {
        const f = Math.round(meta.loop ? (k / n) * last : (k / (n - 1)) * last);
        const p = posed(M, clip, f), bb = bboxOf(p.meshes);
        // lying frames: zoom out so the whole body fits (same scale for every frame of the clip row would hide the standing ones)
        const th = yaw * Math.PI / 180, wide = Math.abs(Math.cos(th)) * (bb.hi[0] - bb.lo[0]) + Math.abs(Math.sin(th)) * (bb.hi[2] - bb.lo[2]);
        const hh = Math.max(height, wide * H / W * 1.08);
        const c = new Canvas(W, H), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cz: (bb.lo[2] + bb.hi[2]) / 2, cy: hh / 2 - 0.08 * hh / height, height: hh};
        drawMeshes(c, cam, p.meshes);
        hline(c, cam, 0, [200, 60, 60]);
        const t = clip.times[f];
        const tag = meta.impactTime != null && Math.abs(t - meta.impactTime) < 0.05 ? ' IMPACT' : meta.burstTime != null && Math.abs(t - meta.burstTime) < 0.05 ? ' BURST' : '';
        cells.push({canvas: c, label: `${cn} t=${t.toFixed(2)}/${meta.duration}s minY ${bb.lo[1].toFixed(3)}${tag}`});
      }
    }
    await composeGrid(cells, {cols: nFrames, title, file});
    written.push(file);
  };
  await sheet(path.join(OUT, 'clips-34.png'), 'Blightbelly clips (CPU-skinned GLB tracks), 3/4 front view; red line = floor', 35, ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'], 6);
  // attack frames at exact impact + side views
  await sheet(path.join(OUT, 'clips-side.png'), 'Blightbelly clips, side view (from +X): planted feet, belly / thigh / arm clearance', 90, ['Walk', 'Run', 'Attack', 'Death'], 6);
  await sheet(path.join(OUT, 'clips-front.png'), 'Blightbelly clips, front view: arms clear of the belly', 0, ['Idle', 'Walk', 'Run', 'Attack'], 6);

  // ---- 2b. clearance close-ups at the audit's worst frames (sidecar verification.clearance)
  {
    const side = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/enemy-blightbelly.json'), 'utf8')).verification.clearance;
    const cells = [];
    for (const k of ['thighs', 'arms']) for (const cn of ['Walk', 'Run', 'Attack']) {
      const clip = M.clips.find(c => c.name === cn), t = side[k][cn].worstT, f = clip.times.findIndex(x => Math.abs(x - t) < 1e-3);
      const p = posed(M, clip, Math.max(0, f));
      for (const yaw of [35, 90]) {
        const c = new Canvas(330, 330), cam = {yawDeg: yaw, cx: 0, cy: k === 'thighs' ? 0.62 : 1.05, cz: 0.05, height: k === 'thighs' ? 0.8 : 1.0};
        drawMeshes(c, cam, p.meshes);
        cells.push({canvas: c, label: `${k} ${cn} t=${t} max ${(side[k][cn].maxDepthM * 100).toFixed(1)} cm (${side[k][cn].maxVertsDeeperThan1cm} v) yaw ${yaw}`});
      }
    }
    const f = path.join(OUT, 'clearance-worst.png');
    await composeGrid(cells, {cols: 6, title: 'Clearance audit worst frames (thigh vs belly underside, forearm / hand vs torso): CPU-skinned close-ups', file: f});
    written.push(f);
  }

  // ---- 3. boils close-up (bind)
  {
    const bp = posed(M, null, 0);
    const cells = [];
    for (const [yaw, lab, cy, h, cx] of [[0, 'front chest / shoulders', 1.28, 0.75, 0], [180, 'back', 1.2, 0.9, 0], [90, 'left side / upper arm', 1.2, 0.9, 0], [25, 'front 3/4 belly', 1.0, 0.9, 0.05]]) {
      const c = new Canvas(620, 620), cam = {yawDeg: yaw, cx, cy, cz: 0, height: h};
      drawMeshes(c, cam, bp.meshes);
      cells.push({canvas: c, label: `${lab} (bind; ${h} m frame height)`});
    }
    const f = path.join(OUT, 'boils-closeup.png');
    await composeGrid(cells, {cols: 2, title: `Blightbelly pustules: ${X.pustules.length} clusters (procedural domes on the skin + painted inflamed halo)`, file: f});
    written.push(f);
  }

  // ---- 4. beside the heavyset zombie (runtime scale 1.0) + top-down footprint vs a 1.0 m doorway
  {
    const bp = posed(M, null, 0), zp = posed(Z, null, 0);
    const shift = (meshes, dx) => meshes.map(m => { const p = Float32Array.from(m.pos); for (let i = 0; i < p.length; i += 3) p[i] += dx; return {...m, pos: p}; });
    const cells = [];
    for (const [yaw, lab] of [[0, 'front'], [90, 'side (from +X)']]) {
      const c = new Canvas(760, 640), cam = {yawDeg: yaw, cx: yaw === 0 ? -0.1 : 0, cy: 1.02, cz: 0, height: 2.2};
      if (yaw === 0) { drawMeshes(c, cam, shift(zp.meshes, -0.75)); drawMeshes(c, cam, shift(bp.meshes, 0.6)); }
      else { drawMeshes(c, cam, zp.meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 2 ? v - 0.6 : v)}))); drawMeshes(c, cam, bp.meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 2 ? v + 0.6 : v)}))); }
      for (const [y, col] of [[0, [200, 60, 60]], [1.0, [90, 90, 110]], [1.78, [120, 200, 120]], [X.heightM, [240, 200, 80]], [2.0, [90, 90, 110]]]) hline(c, cam, y, col);
      cells.push({canvas: c, label: `${lab}: heavyset 1.78 m | Blightbelly ${X.heightM} m (lines 1.0 / 1.78 / ${X.heightM} / 2.0)`});
    }
    // top-down: positions (x, y, z) -> (x, -z, y): image up = -Z (back), depth = height
    const c = new Canvas(640, 640), cam = {yawDeg: 0, cx: 0, cy: 0, cz: 0, height: 1.6};
    drawMeshes(c, cam, bp.meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 0 ? v : i % 3 === 1 ? -m.pos[i + 1] : m.pos[i - 1])})));
    const R = X.radius;
    for (let k = 0; k < 360; k++) { const a = k * Math.PI / 180; const s = project(c, cam, [R * Math.cos(a), R * Math.sin(a), 0]); dot(c, s[0], s[1], 1.5, [60, 220, 255]); }
    for (const x of [-0.5, 0.5]) line(c, project(c, cam, [x, -0.8, 0]), project(c, cam, [x, 0.8, 0]), [255, 120, 60], 3);
    cells.push({canvas: c, label: `top-down (front down): collider r ${R} (cyan), 1.0 m door (orange)`});
    const f = path.join(OUT, 'beside-zombie.png');
    await composeGrid(cells, {cols: 3, title: 'Blightbelly scale check beside the runtime heavyset zombie (scale 1.0, both bind pose)', file: f});
    written.push(f);
  }
  console.log(written.map(f => path.relative(REPO, f)).join('\n'));
}

await main();
