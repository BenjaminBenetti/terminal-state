#!/usr/bin/env node
// Task studio-alpha-beyond-station-round4-20261101-01 (lane ASSET): CPU QA sheets of the WRITTEN Strainer GLB (no browser /
// GPU; internal diagnostics, never committed):
//   node tools/asset-pipeline/enemy/qa/strainer-sheets.mjs [--out DIR]   (default qa-artifacts/strainer, git-ignored)
// Reads game/public/assets/models/enemy-strainer.glb (+ the lastshift zombie body for scale), CPU-skins the GLB's own
// animation tracks (FK from the node hierarchy, linear-blend skinning) and renders with zombie/lib/raster.mjs:
//   bind-joints.png      front / side / back bind pose + skeleton + headshot sphere
//   weights.png          dominant-bone colours (front / side / back) - region / curtain / strand assignment
//   clips-34.png         all six clips, 6 frames each (3/4 front view)
//   clips-side.png       Walk / Run / Attack / Death side view (feet, claws, lean)
//   clips-front.png      Idle / Walk / Run / Attack front view (claws vs thighs)
//   attack-hit.png       Attack around the hit frame (top / front / side) with the claw tip path and the reach
//   clearance-worst.png  the clearance audit's worst frames (sidecar verification.clearance)
//   beside-zombie.png    beside the runtime-scale zombie (front, side) + top-down collider vs a 1.0 m doorway
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
const OUT = path.resolve(argOut > 0 ? process.argv[argOut + 1] : path.join(REPO, 'qa-artifacts/strainer'));
const only = (i => i > 0 ? new Set(process.argv[i + 1].split(',')) : null)(process.argv.indexOf('--only'));
const GLB = path.join(REPO, 'game/public/assets/models/enemy-strainer.glb');
const ZOMBIE = path.join(REPO, 'game/public/assets/models/zombie-body-lastshift-t25.glb');
const SIDECAR = path.join(REPO, 'game/public/assets/derivatives/enemy-strainer.json');

async function decode(tex) {
  const {data, info} = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height};
}

/** Skinned GLB -> {bind, meshes, clips, extras, local}. */
async function loadSkinned(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const root = doc.getRoot();
  const parent = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const skinNodes = root.listNodes().filter(n => n.getSkin() && n.getMesh());
  const jn = skinNodes[0].getSkin().listJoints();
  const names = jn.map(j => j.getName());
  if (names.join() !== JOINTS.map(j => j[0]).join()) throw new Error('unexpected joint order');
  const bind = {};
  for (const j of jn) { let p = [0, 0, 0], n = j; while (n && names.includes(n.getName())) { p = V.add(p, n.getTranslation()); n = parent.get(n); } bind[j.getName()] = p; }
  const meshes = [];
  for (const node of skinNodes) for (const prim of node.getMesh().listPrimitives()) {
    const A = s => prim.getAttribute(s);
    const wA = A('WEIGHTS_0'), wArr = wA.getArray(), weights = wA.getNormalized() ? Float32Array.from(wArr, v => v / 255) : Float32Array.from(wArr);
    const mat = prim.getMaterial();
    meshes.push({name: node.getName(), pos: Float32Array.from(A('POSITION').getArray()), uv: Float32Array.from(A('TEXCOORD_0').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()),
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
const posed = (M, clip, f) => { const w = fk(M, clip, f); return {world: w, meshes: M.meshes.map(m => ({...m, pos: skinPositions(m, {joints: M.bind}, w)}))}; };
const bboxOf = meshes => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[i + k]); hi[k] = Math.max(hi[k], m.pos[i + k]); } return {lo, hi}; };
const drawMeshes = (c, cam, meshes) => { for (const m of meshes) c.draw({pos: m.pos, idx: m.idx, uv: m.uv, tex: m.tex}, cam); };

const PALETTE = [[60, 60, 60], [230, 230, 230], [240, 200, 60], [240, 130, 40], [200, 60, 200], [230, 40, 40], [40, 120, 240], [40, 200, 240], [40, 240, 160], [120, 60, 240], [60, 160, 255], [140, 255, 200],
  [160, 100, 40], [200, 160, 100], [255, 220, 170], [60, 120, 40], [120, 200, 80], [200, 255, 140]];
function weightMesh(m) {
  const W = JOINTS.length, data = new Uint8Array(W * 4);
  PALETTE.forEach((c, j) => data.set([...c, 255], j * 4));
  const n = m.pos.length / 3, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = (m.joints[i * 4] + 0.5) / W; uv[i * 2 + 1] = 0.5; }
  return {...m, uv, tex: {data, width: W, height: 1}};
}

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const M = await loadSkinned(GLB);
  const X = M.extras.enemyStrainer;
  const side = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'));
  const written = [];
  const want = k => !only || only.has(k);

  if (want('bind')) {
    const cells = [];
    const bp = posed(M, null, 0);
    for (const [yaw, lab] of [[0, 'front'], [90, 'side (from +X)'], [180, 'back']]) {
      const c = new Canvas(620, 640), cam = {yawDeg: yaw, cx: 0, cy: 1.1, cz: 0, height: 2.35};
      drawMeshes(c, cam, bp.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      drawSkeleton(c, cam, Object.fromEntries(Object.entries(bp.world).map(([k, v]) => [k, v.pos])), JOINTS);
      for (let k = 0; k < 360; k += 3) { const a = k * Math.PI / 180, r = X.headRadius; const p = project(c, cam, V.add(X.headCenter, yaw === 90 ? [0, r * Math.sin(a), r * Math.cos(a)] : [r * Math.cos(a), r * Math.sin(a), 0])); dot(c, p[0], p[1], 1.2, [60, 220, 255]); }
      cells.push({canvas: c, label: `${lab}: bind, 18 joints (yellow), headshot sphere r ${X.headRadius} (cyan)`});
    }
    const f = path.join(OUT, 'bind-joints.png');
    await composeGrid(cells, {cols: 3, title: `Strainer bind pose ${X.heightM} m - skeleton + headshot sphere`, file: f});
    written.push(f);
  }
  if (want('weights')) {
    const cells = [];
    const bp = posed(M, null, 0);
    for (const [yaw, lab, cy, h] of [[0, 'front', 1.1, 2.35], [90, 'side', 1.1, 2.35], [180, 'back', 1.1, 2.35], [35, 'upper 3/4', 1.65, 1.0]]) {
      const c = new Canvas(560, 600), cam = {yawDeg: yaw, cx: 0, cy, cz: 0, height: h};
      for (const m of bp.meshes) c.draw(weightMesh(m), cam);
      cells.push({canvas: c, label: `${lab}: dominant bone colour`});
    }
    const f = path.join(OUT, 'weights.png');
    await composeGrid(cells, {cols: 4, title: 'Strainer skin: dominant bone (Hips white, Spine yellow, Chest orange, Neck magenta, Head red, arms blue / cyan, legs brown / green)', file: f});
    written.push(f);
  }

  const sheet = async (file, title, yaw, clipNames, nFrames, W = 300, H = 400, height = 2.4, at = null) => {
    const cells = [];
    for (const cn of clipNames) {
      const clip = M.clips.find(c => c.name === cn), meta = X.clips[cn];
      const last = clip.times.length - 1;
      const frames = at?.[cn] ?? Array.from({length: nFrames}, (_, k) => Math.round(meta.loop ? (k / nFrames) * last : (k / (nFrames - 1)) * last));
      for (const f of frames) {
        const p = posed(M, clip, f), bb = bboxOf(p.meshes);
        const th = yaw * Math.PI / 180, wide = Math.abs(Math.cos(th)) * (bb.hi[0] - bb.lo[0]) + Math.abs(Math.sin(th)) * (bb.hi[2] - bb.lo[2]);
        const hh = Math.max(height, wide * H / W * 1.08);
        const c = new Canvas(W, H), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cz: (bb.lo[2] + bb.hi[2]) / 2, cy: hh / 2 - 0.08 * hh / height, height: hh};
        drawMeshes(c, cam, p.meshes);
        hline(c, cam, 0, [200, 60, 60]);
        const t = clip.times[f];
        const tag = meta.impactTime != null && Math.abs(t - meta.impactTime) < 0.02 ? ' HIT' : '';
        cells.push({canvas: c, label: `${cn} t=${t.toFixed(2)}/${meta.duration}s minY ${bb.lo[1].toFixed(3)}${tag}`});
      }
    }
    await composeGrid(cells, {cols: nFrames, title, file});
    written.push(file);
  };
  if (want('clips')) {
    await sheet(path.join(OUT, 'clips-34.png'), 'Strainer clips (CPU-skinned GLB tracks), 3/4 front view; red line = floor', 35, ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'], 6);
    await sheet(path.join(OUT, 'clips-side.png'), 'Strainer clips, side view (from +X): planted feet, lean, claws', 90, ['Walk', 'Run', 'Attack', 'Death'], 6);
    await sheet(path.join(OUT, 'clips-front.png'), 'Strainer clips, front view: claws vs thighs', 0, ['Idle', 'Walk', 'Run', 'Attack'], 6);
  }
  if (want('attack')) {
    const clip = M.clips.find(c => c.name === 'Attack'), A = X.attack;
    const fHit = clip.times.findIndex(t => Math.abs(t - A.hitTime) < 1e-3);
    const path_ = side.verification.attack.path;
    const cells = [];
    for (const [yaw, lab, top] of [[0, 'front', false], [90, 'side', false], [0, 'top-down (front up)', true]]) {
      for (const f of [fHit - 6, fHit, fHit + 5]) {
        const p = posed(M, clip, f);
        const c = new Canvas(420, 420);
        const cam = top ? {yawDeg: 0, cx: 0, cy: 0.4, cz: 0, height: 2.6} : {yawDeg: yaw, cx: 0, cy: 1.1, cz: 0.5, height: 2.6};
        const tr = m => top ? {...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 0 ? v : i % 3 === 1 ? m.pos[i + 1] : -m.pos[i - 1])} : m; // (x, z, -y): image up = +Z
        drawMeshes(c, cam, p.meshes.map(tr));
        if (!top) { hline(c, cam, 0, [200, 60, 60]); hline(c, cam, 1.3, [90, 160, 90]); }
        const toW = q => top ? [q[0], q[2], -q[1]] : q;
        for (const pt of path_) { const s = project(c, cam, toW(pt.R)); dot(c, s[0], s[1], 2, Math.abs(pt.t - A.hitTime) < 1e-3 ? [255, 60, 60] : [255, 220, 60]); }
        if (top) for (let k = 0; k < 360; k += 2) { const a = k * Math.PI / 180, s = project(c, cam, [A.reachM * Math.cos(a), A.reachM * Math.sin(a), 0]); dot(c, s[0], s[1], 1, [60, 220, 255]); }
        cells.push({canvas: c, label: `${lab} t=${clip.times[f].toFixed(2)}${f === fHit ? ' HIT' : ''}; R claw tip path (yellow, hit red)${top ? `, reach ${A.reachM} m (cyan)` : ', green 1.3 m'}`});
      }
    }
    const f = path.join(OUT, 'attack-hit.png');
    await composeGrid(cells, {cols: 3, title: `Strainer Attack: hit ${A.hitTime} s, reach ${A.reachM} m (horizontal root -> claw tip), centre-line crossing ${JSON.stringify(A.centreLineCrossingR)}`, file: f});
    written.push(f);
  }
  if (want('clearance')) {
    const cl = side.verification.clearance, cells = [];
    for (const k of ['armsVsTorso', 'thighsVsTorso', 'clawsVsLegs']) {
      const worst = Object.entries(cl[k]).filter(([c]) => c !== 'Bind').sort((a, b) => b[1].maxDepthM - a[1].maxDepthM).slice(0, 2);
      for (const [cn, v] of worst) {
        const clip = M.clips.find(c => c.name === cn), f = Math.max(0, clip.times.findIndex(x => Math.abs(x - (v.worstT ?? 0)) < 1e-3));
        const p = posed(M, clip, f);
        for (const yaw of [35, 90]) {
          const c = new Canvas(330, 330), bb = bboxOf(p.meshes), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy: k === 'thighsVsTorso' ? 0.95 : 1.1, cz: (bb.lo[2] + bb.hi[2]) / 2, height: 1.3};
          drawMeshes(c, cam, p.meshes);
          cells.push({canvas: c, label: `${k} ${cn} t=${v.worstT} ${(v.maxDepthM * 100).toFixed(1)} cm (${v.maxVertsDeeperThan1cm} v) yaw ${yaw}`});
        }
      }
    }
    const f = path.join(OUT, 'clearance-worst.png');
    await composeGrid(cells, {cols: 4, title: 'Clearance audit worst frames (CPU-skinned close-ups)', file: f});
    written.push(f);
  }
  if (want('beside')) {
    const Z = await loadSkinned(ZOMBIE);
    const bp = posed(M, null, 0), zp = posed(Z, null, 0), ip = posed(M, M.clips.find(c => c.name === 'Idle'), 0);
    const shift = (meshes, d) => meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => v + d[i % 3])}));
    const cells = [];
    for (const [yaw, lab] of [[0, 'front'], [90, 'side (from +X)']]) {
      const c = new Canvas(900, 640), cam = {yawDeg: yaw, cx: 0, cy: 1.15, cz: 0, height: 2.45};
      const off = yaw === 0 ? [[-1.35, 0, 0], [0.0, 0, 0], [1.3, 0, 0]] : [[0, 0, 1.0], [0, 0, 0], [0, 0, -1.0]];
      drawMeshes(c, cam, shift(zp.meshes, off[0])); drawMeshes(c, cam, shift(bp.meshes, off[1])); drawMeshes(c, cam, shift(ip.meshes, off[2]));
      for (const [y, col] of [[0, [200, 60, 60]], [1.78, [120, 200, 120]], [X.heightM, [240, 200, 80]], [2.3, [90, 90, 110]]]) hline(c, cam, y, col);
      cells.push({canvas: c, label: `${lab}: zombie 1.78 | Strainer bind ${X.heightM} | Idle (lines 1.78 / ${X.heightM} / 2.3 door)`});
    }
    const c = new Canvas(640, 640), cam = {yawDeg: 0, cx: 0, cy: 0, cz: 0, height: 1.8};
    drawMeshes(c, cam, ip.meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 0 ? v : i % 3 === 1 ? m.pos[i + 1] : -m.pos[i - 1])})));
    const R = X.radius;
    for (let k = 0; k < 360; k++) { const a = k * Math.PI / 180; const s = project(c, cam, [R * Math.cos(a), R * Math.sin(a), 0]); dot(c, s[0], s[1], 1.5, [60, 220, 255]); }
    for (const x of [-0.5, 0.5]) line(c, project(c, cam, [x, -0.85, 0]), project(c, cam, [x, 0.85, 0]), [255, 120, 60], 3);
    cells.push({canvas: c, label: `top-down Idle (front up): collider r ${R} (cyan), 1.0 m door (orange)`});
    const f = path.join(OUT, 'beside-zombie.png');
    await composeGrid(cells, {cols: 3, title: 'Strainer beside the runtime lastshift zombie (scale 1.0)', file: f});
    written.push(f);
  }
  console.log(written.map(f => path.relative(REPO, f)).join('\n'));
}

await main();
