#!/usr/bin/env node
// Task studio-screacher-production-20261110-221858-01 (lane RIG): CPU QA sheets of the WRITTEN Screacher GLBs (no browser /
// GPU; internal diagnostics in the PRIVATE task folder, never committed):
//   node tools/asset-pipeline/enemy/qa/screacher-sheets.mjs [--only sc04[,sc01]] [--sheets bind,weights,...] [--dir DIR] [--out DIR]
// Reads game/public/assets/models/enemy-screacher-<v>.glb + its sidecar (or --dir: a dev build folder) and the lastshift
// zombie body for scale, CPU-skins the GLB's own animation tracks (FK from the node hierarchy, linear-blend skinning, tracks
// interpolated like the runtime) and renders with zombie/lib/raster.mjs into <out>/<v>/ (default
// reference/tasks/screacher-production-20261110-221858/qa/rig/<v>/):
//   bind-joints.png      front / side / back bind pose + the 18 joints + the stump top; upper-body close-ups
//   weights.png          dominant-bone colours (regions, sleeves, stump)
//   clip-<Name>.png      each clip's key frames, front row + side row (Scream at 0 / 0.25 / 0.5 / 0.9 / 1.6 s)
//   attack-hit.png       Attack round the hit frame (front / side / top) with the hand tip path and the measured reach
//   death-floor.png      Death frames from the side with the floor line and the lowest point per frame; death-final.png close-ups
//   stretch.png          triangle stretch (posed / bind edge) at the worst frame of each clip
//   detail.png           large key poses (shoulders, sleeves, hands vs thighs)
// and once for the family:  <out>/beside-zombie.png   all four bodies beside the 1.78 m zombie (front, side).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {REPO} from '../../zombie/lib/master.mjs';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {qMul, qRot, qSlerp, V} from '../../zombie/lib/pose.mjs';
import {Canvas, project, dot, line, hline, drawSkeleton, composeGrid} from '../lib/qa-render.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const VARIANTS = ['sc01', 'sc02', 'sc03', 'sc04'];
const only = arg('--only') ? arg('--only').split(',') : VARIANTS;
const sheets = arg('--sheets') ? new Set(arg('--sheets').split(',')) : null;
const want = k => !sheets || sheets.has(k);
const OUT = path.resolve(arg('--out') || path.join(REPO, 'reference/tasks/screacher-production-20261110-221858/qa/rig'));
const DIR = arg('--dir') ? path.resolve(arg('--dir')) : null;
const glbOf = v => DIR ? path.join(DIR, `enemy-screacher-${v}.glb`) : path.join(REPO, `game/public/assets/models/enemy-screacher-${v}.glb`);
const sidecarOf = v => DIR ? path.join(DIR, `enemy-screacher-${v}.json`) : path.join(REPO, `game/public/assets/derivatives/enemy-screacher-${v}.json`);
const ZOMBIE = path.join(REPO, 'game/public/assets/models/zombie-body-lastshift-t25.glb');

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

/** FK at time t of a clip (tracks interpolated linearly / slerp like the runtime); clip null = bind. */
function fk(M, clip, t) {
  let f = 0, u = 0;
  if (clip) { const T = clip.times; while (f < T.length - 2 && T[f + 1] <= t) f++; u = Math.min(1, Math.max(0, (t - T[f]) / (T[f + 1] - T[f]))); }
  const world = {};
  for (const [name, par] of JOINTS) {
    const tr = clip?.tracks[name];
    const lr = tr?.rotation ? qSlerp(tr.rotation[f], tr.rotation[f + 1], u) : [0, 0, 0, 1];
    const lt = tr?.translation ? tr.translation[f].map((v, i) => v + (tr.translation[f + 1][i] - v) * u) : M.local[name];
    if (!par) { world[name] = {pos: lt, rot: lr}; continue; }
    const P = world[par];
    world[name] = {pos: V.add(P.pos, qRot(P.rot, lt)), rot: qMul(P.rot, lr)};
  }
  return world;
}
const posed = (M, clip, t) => { const w = fk(M, clip, t); return {world: w, meshes: M.meshes.map(m => ({...m, pos: skinPositions(m, {joints: M.bind}, w)}))}; };
const bboxOf = meshes => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[i + k]); hi[k] = Math.max(hi[k], m.pos[i + k]); } return {lo, hi}; };
const drawMeshes = (c, cam, meshes) => { for (const m of meshes) c.draw({pos: m.pos, idx: m.idx, uv: m.uv, tex: m.tex}, cam); };
const jointPos = world => Object.fromEntries(Object.entries(world).map(([k, v]) => [k, v.pos]));

const PALETTE = [[60, 60, 60], [230, 230, 230], [240, 200, 60], [240, 130, 40], [200, 60, 200], [230, 40, 40], [40, 120, 240], [40, 200, 240], [40, 240, 160], [120, 60, 240], [60, 160, 255], [140, 255, 200],
  [160, 100, 40], [200, 160, 100], [255, 220, 170], [60, 120, 40], [120, 200, 80], [200, 255, 140]];
function weightMesh(m) {
  const W = JOINTS.length, data = new Uint8Array(W * 4);
  PALETTE.forEach((c, j) => data.set([...c, 255], j * 4));
  const n = m.pos.length / 3, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = (m.joints[i * 4] + 0.5) / W; uv[i * 2 + 1] = 0.5; }
  return {...m, uv, tex: {data, width: W, height: 1}};
}
/** One bone's weight as a grey -> red ramp. */
function boneWeightMesh(m, j) {
  const data = new Uint8Array(64 * 4);
  for (let k = 0; k < 64; k++) { const s = k / 63; data.set([70 + 185 * s, 70 + 60 * (1 - Math.abs(2 * s - 1)), 70 * (1 - s), 255], k * 4); }
  const n = m.pos.length / 3, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { let w = 0; for (let k = 0; k < 4; k++) if (m.joints[i * 4 + k] === j) w += m.weights[i * 4 + k]; uv[i * 2] = (0.5 + 63 * w) / 64 * 0.98 + 0.01; uv[i * 2 + 1] = 0.5; }
  return {...m, uv, tex: {data, width: 64, height: 1}};
}

const FRAME_TIMES = {
  Idle: [0, 0.6, 1.2, 1.8, 2.4, 3.0],
  Walk: [0, 0.2167, 0.4333, 0.65, 0.8667, 1.0833],
  Run: [0, 0.12, 0.24, 0.36, 0.48, 0.6],
  Attack: [0, 0.17, 0.27, 0.345, 0.42, 0.5, 0.58, 0.8],
  Hit: [0, 0.05, 0.08, 0.16, 0.24, 0.35],
  Death: [0, 0.12, 0.4, 0.72, 1.0, 1.26, 1.46, 1.8],
  Scream: [0, 0.2, 0.25, 0.5, 0.7, 0.9, 1.25, 1.6],
};

async function variantSheets(v) {
  const out = path.join(OUT, v);
  fs.mkdirSync(out, {recursive: true});
  const M = await loadSkinned(glbOf(v));
  const X = M.extras.enemyScreacher;
  const side = JSON.parse(fs.readFileSync(sidecarOf(v), 'utf8'));
  const written = [];
  const tag = `Screacher ${v} "${X.name}"`;

  if (want('bind')) {
    const cells = [];
    const bp = posed(M, null, 0);
    for (const [yaw, lab, W] of [[0, 'front', 600], [90, 'side (from +X)', 420], [180, 'back', 600]]) {
      const c = new Canvas(W, 900), cam = {yawDeg: yaw, cx: 0, cy: 1.02, cz: 0, height: 2.15};
      drawMeshes(c, cam, bp.meshes);
      for (let y = 0; y <= 2.001; y += 0.5) hline(c, cam, y, y === 0 ? [200, 60, 60] : [80, 80, 100]);
      drawSkeleton(c, cam, jointPos(bp.world), JOINTS, {r: 4});
      const s = project(c, cam, X.stump.top); dot(c, s[0], s[1], 4, [255, 60, 60]);
      cells.push({canvas: c, label: `${lab}: bind, 18 joints (yellow), stump top (red); lines 0.5 m`});
    }
    let f = path.join(out, 'bind-joints.png');
    await composeGrid(cells, {cols: 3, title: `${tag} bind pose ${X.heightM} m - skeleton + stump top ${JSON.stringify(X.stump.top)}`, file: f});
    written.push(f);
    const cells2 = [];
    for (const [yaw, lab] of [[0, 'front'], [90, 'side'], [180, 'back']]) {
      const c = new Canvas(640, 700), cam = {yawDeg: yaw, cx: 0, cy: 1.62, cz: -0.05, height: 0.85};
      drawMeshes(c, cam, bp.meshes);
      for (let y = 1.3; y <= 2.001; y += 0.1) hline(c, cam, y, Math.abs(y - 2) < 1e-6 ? [200, 60, 60] : [70, 70, 90]);
      drawSkeleton(c, cam, jointPos(bp.world), JOINTS, {r: 4});
      const s = project(c, cam, X.stump.top); dot(c, s[0], s[1], 4, [255, 60, 60]);
      cells2.push({canvas: c, label: `${lab}: shoulders / stump (lines 0.1 m, red = 2.0 m)`});
    }
    f = path.join(out, 'bind-upper.png');
    await composeGrid(cells2, {cols: 3, title: `${tag} bind: shoulder joints, Neck (stump base), Head (technical joint under the stump top)`, file: f});
    written.push(f);
  }
  if (want('weights')) {
    const cells = [];
    const bp = posed(M, null, 0);
    for (const [yaw, lab, cy, h] of [[0, 'front', 1.02, 2.15], [90, 'side', 1.02, 2.15], [180, 'back', 1.02, 2.15], [0, 'upper front', 1.6, 0.95], [180, 'upper back', 1.6, 0.95], [0, 'pelvis front', 1.1, 0.75]]) {
      const c = new Canvas(520, 640), cam = {yawDeg: yaw, cx: 0, cy, cz: 0, height: h};
      for (const m of bp.meshes) c.draw(weightMesh(m), cam);
      cells.push({canvas: c, label: `${lab}: dominant bone colour`});
    }
    for (const [bone, yaw, cy, h] of [['L_UpperArm', 0, 1.6, 0.95], ['L_UpperArm', 180, 1.6, 0.95], ['Neck', 0, 1.8, 0.5], ['Chest', 0, 1.6, 0.95], ['L_Thigh', 0, 1.0, 0.9], ['Hips', 0, 1.1, 0.9]]) {
      const c = new Canvas(520, 640), cam = {yawDeg: yaw, cx: 0, cy, cz: 0, height: h};
      for (const m of bp.meshes) c.draw(boneWeightMesh(m, JOINTS.findIndex(j => j[0] === bone)), cam);
      cells.push({canvas: c, label: `${bone} weight (grey 0 -> red 1) yaw ${yaw}`});
    }
    const f = path.join(out, 'weights.png');
    await composeGrid(cells, {cols: 4, title: `${tag} skin: dominant bone (Hips white, Spine yellow, Chest orange, Neck magenta, Head red, L arm blue / cyan / mint, R arm violet / sky / pale mint, legs brown / green)`, file: f});
    written.push(f);
  }

  // per clip: a front row and a side row of key frames
  if (want('clips')) for (const cn of Object.keys(FRAME_TIMES)) {
    const clip = M.clips.find(c => c.name === cn), meta = X.clips[cn], times = FRAME_TIMES[cn];
    const cells = [];
    for (const [yaw, lab] of [[0, 'front'], [90, 'side'], [215, '3/4 back']]) for (const t of times) {
      const p = posed(M, clip, t), bb = bboxOf(p.meshes);
      const W = 250, H = 380, th = yaw * Math.PI / 180, wide = Math.abs(Math.cos(th)) * (bb.hi[0] - bb.lo[0]) + Math.abs(Math.sin(th)) * (bb.hi[2] - bb.lo[2]);
      const hh = Math.max(2.3, wide * H / W * 1.06);
      const c = new Canvas(W, H), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cz: (bb.lo[2] + bb.hi[2]) / 2, cy: hh / 2 - 0.08 * hh / 2.3, height: hh};
      drawMeshes(c, cam, p.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      const mark = meta.impactTime != null && Math.abs(t - meta.impactTime) < 1e-6 ? ' HIT' : meta.cueTime != null && Math.abs(t - meta.cueTime) < 1e-6 ? ' CUE' : '';
      cells.push({canvas: c, label: `${lab} t=${t.toFixed(2)}${mark} minY ${bb.lo[1].toFixed(3)}`});
    }
    const f = path.join(out, `clip-${cn}.png`);
    await composeGrid(cells, {cols: times.length, title: `${tag} ${cn} (${meta.duration} s${meta.loop ? ', loop' : ''}${meta.groundSpeed ? `, ${meta.groundSpeed} m/s` : ''}${meta.impactTime ? `, hit ${meta.impactTime} s` : ''}${meta.cueTime ? `, cue ${meta.cueTime} s` : ''}): CPU-skinned GLB tracks; red line = floor`, file: f});
    written.push(f);
  }

  if (want('detail')) {
    // key poses large: [clip, time, yaw, cy, height]
    const keys = [['Idle', 1.2, 25, 1.35, 1.5], ['Walk', 0.2167, 60, 1.05, 2.2], ['Run', 0.24, 70, 1.05, 2.2], ['Attack', 0.42, 40, 1.25, 1.9], ['Scream', 0.5, 35, 1.3, 1.9], ['Scream', 0.5, 150, 1.3, 1.9], ['Attack', 0.27, 200, 1.35, 1.6], ['Death', 1.8, 35, 0.4, 2.6]];
    const cells = [];
    for (const [cn, t, yaw, cy, h] of keys) {
      const clip = M.clips.find(c => c.name === cn);
      const p = posed(M, clip, t), bb = bboxOf(p.meshes);
      const c = new Canvas(500, 560), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy, cz: (bb.lo[2] + bb.hi[2]) / 2, height: h};
      drawMeshes(c, cam, p.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      cells.push({canvas: c, label: `${cn} t=${t.toFixed(2)} yaw ${yaw}`});
    }
    const f = path.join(out, 'detail.png');
    await composeGrid(cells, {cols: 4, title: `${tag} key poses (detail): shoulders, sleeves, elbows, hands vs thighs, stump`, file: f});
    written.push(f);
  }

  if (want('attack')) {
    const clip = M.clips.find(c => c.name === 'Attack'), A = side.verification.attack, hitT = X.attackHitTime;
    const cells = [];
    for (const [yaw, lab, top] of [[0, 'front', false], [90, 'side', false], [0, 'top-down (front up)', true]]) {
      for (const t of [0.345, hitT, 0.5]) {
        const p = posed(M, clip, t);
        const c = new Canvas(460, 460);
        const cam = top ? {yawDeg: 0, cx: 0, cy: 0.45, cz: 0, height: 2.7} : {yawDeg: yaw, cx: 0, cy: 1.1, cz: 0.45, height: 2.7};
        const tr = m => top ? {...m, pos: Float32Array.from(m.pos, (v, i) => i % 3 === 0 ? v : i % 3 === 1 ? m.pos[i + 1] : -m.pos[i - 1])} : m; // (x, z, -y): image up = +Z
        drawMeshes(c, cam, p.meshes.map(tr));
        if (!top) { hline(c, cam, 0, [200, 60, 60]); hline(c, cam, 1.3, [90, 160, 90]); hline(c, cam, 1.78, [90, 110, 160]); }
        const toW = q => top ? [q[0], q[2], -q[1]] : q;
        for (const pt of A.tipPath) { const s = project(c, cam, toW(pt.R)); dot(c, s[0], s[1], 2, [255, 220, 60]); }
        { const s = project(c, cam, toW(A.hit.handTipR)); dot(c, s[0], s[1], 4, [255, 60, 60]); }
        if (top) for (const [r, col] of [[X.reachM, [60, 220, 255]], [1.1, [90, 90, 120]], [1.3, [90, 90, 120]]]) for (let k = 0; k < 360; k += 2) { const a = k * Math.PI / 180, s = project(c, cam, [r * Math.cos(a), r * Math.sin(a), 0]); dot(c, s[0], s[1], 1, col); }
        if (yaw === 90 && !top) for (const z of [1.1, X.reachM, 1.3]) line(c, project(c, cam, [0, 0, z]), project(c, cam, [0, 2.0, z]), z === X.reachM ? [60, 220, 255] : [90, 90, 120], 1);
        cells.push({canvas: c, label: `${lab} t=${t.toFixed(3)}${t === hitT ? ' HIT' : ''}`});
      }
    }
    const f = path.join(out, 'attack-hit.png');
    await composeGrid(cells, {cols: 3, title: `${tag} Attack: hit ${hitT} s, reach ${X.reachM} m (root -> R hand tip ${JSON.stringify(A.hit.handTipR)}), lunge ${side.clips.attackSolve.lunge} m. Yellow: tip path; red: tip at the hit; cyan: reach; grey: 1.10 / 1.30; green 1.3 m, blue 1.78 m`, file: f});
    written.push(f);
  }

  if (want('death')) {
    const clip = M.clips.find(c => c.name === 'Death');
    const cells = [];
    for (const [yaw, lab] of [[90, 'side'], [35, '3/4']]) for (const t of [0.72, 1.0, 1.13, 1.26, 1.46, 1.8]) {
      const p = posed(M, clip, t), bb = bboxOf(p.meshes);
      const c = new Canvas(330, 300), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cz: (bb.lo[2] + bb.hi[2]) / 2, cy: 0.75, height: 2.3};
      drawMeshes(c, cam, p.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      cells.push({canvas: c, label: `${lab} t=${t.toFixed(2)} lowest ${bb.lo[1].toFixed(4)} m`});
    }
    let lo = Infinity; for (const t of clip.times) lo = Math.min(lo, bboxOf(posed(M, clip, t).meshes).lo[1]);
    const f = path.join(out, 'death-floor.png');
    await composeGrid(cells, {cols: 6, title: `${tag} Death floor check: lowest point over all ${clip.times.length} frames ${lo.toFixed(4)} m; contact ${JSON.stringify(side.clips.deathSolve.contact)}`, file: f});
    written.push(f);
    const cells2 = [];
    for (const yaw of [90, 270, 0, 180]) {
      const p = posed(M, clip, 1.8), bb = bboxOf(p.meshes);
      const c = new Canvas(980, 330), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cz: (bb.lo[2] + bb.hi[2]) / 2, cy: 0.3, height: 0.8};
      drawMeshes(c, cam, p.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      cells2.push({canvas: c, label: `final pose yaw ${yaw} (close): floor line red`});
    }
    const f2 = path.join(out, 'death-final.png');
    await composeGrid(cells2, {cols: 2, title: `${tag} Death final pose on the floor (close-ups)`, file: f2});
    written.push(f2);
  }

  if (want('stretch')) {
    const body = M.meshes[0], I = body.idx, P0 = body.pos, nt = I.length / 3;
    const grad = {width: 64, height: 1, data: new Uint8Array(64 * 4)};
    for (let k = 0; k < 64; k++) { const s = k / 63; grad.data.set(s < 0.33 ? [150, 150, 150, 255] : s < 0.66 ? [250, 210, 40, 255] : [240, 30, 30, 255], k * 4); }
    const L = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const ratio = P => { const r = new Float32Array(nt); for (let t = 0; t < nt; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; r[t] = Math.max(L(P, a, b) / Math.max(2e-3, L(P0, a, b)), L(P, b, c) / Math.max(2e-3, L(P0, b, c)), L(P, c, a) / Math.max(2e-3, L(P0, c, a))); } return r; };
    const cells = [];
    for (const cn of ['Walk', 'Run', 'Attack', 'Hit', 'Death', 'Scream']) {
      const clip = M.clips.find(c => c.name === cn);
      let best = null;
      for (let f = 0; f < clip.times.length; f += 2) { const p = posed(M, clip, clip.times[f]), r = ratio(p.meshes[0].pos); let k = 0; for (const x of r) if (x > 2.5) k++; if (!best || k > best.k) best = {f, k, r, p}; }
      const pos = new Float32Array(nt * 9), uv = new Float32Array(nt * 6), idx = new Uint32Array(nt * 3), Pp = best.p.meshes[0].pos;
      for (let t = 0; t < nt; t++) { const u = (0.5 + 63 * Math.min(1, Math.max(0, (best.r[t] - 1) / 2))) / 64 * 0.98 + 0.01; for (let k = 0; k < 3; k++) { const vv = I[t * 3 + k]; pos.set([Pp[vv * 3], Pp[vv * 3 + 1], Pp[vv * 3 + 2]], (t * 3 + k) * 3); uv.set([u, 0.5], (t * 3 + k) * 2); idx[t * 3 + k] = t * 3 + k; } }
      const bb = bboxOf(best.p.meshes);
      for (const yaw of [35, 215]) {
        const c = new Canvas(330, 400), hh = Math.max(2.3, (bb.hi[0] - bb.lo[0]) * 1.2, (bb.hi[2] - bb.lo[2]) * 1.2), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy: hh / 2 - 0.05, cz: (bb.lo[2] + bb.hi[2]) / 2, height: hh};
        c.draw({pos, idx, uv, tex: grad}, cam);
        cells.push({canvas: c, label: `${cn} t=${clip.times[best.f].toFixed(2)} tris>2.5x ${best.k} yaw ${yaw}`});
      }
    }
    const f = path.join(out, 'stretch.png');
    const S = side.verification.motionStretch;
    await composeGrid(cells, {cols: 6, title: `${tag} triangle stretch (posed / bind edge): grey < 1.66x, yellow < 2.3x, red above; worst frame per clip; p99 ${S.p99}, max ${S.max}, over 3x ${S.over3x} of ${S.triangles}`, file: f});
    written.push(f);
  }
  console.log(written.map(f => path.relative(REPO, f)).join('\n'));
  return M;
}

async function familySheet(loaded) {
  const Z = await loadSkinned(ZOMBIE);
  const zp = posed(Z, null, 0);
  const shift = (meshes, d) => meshes.map(m => ({...m, pos: Float32Array.from(m.pos, (v, i) => v + d[i % 3])}));
  const cells = [];
  const have = VARIANTS.filter(v => loaded[v]);
  for (const [yaw, lab] of [[0, 'front'], [90, 'side (from +X)']]) {
    const c = new Canvas(1900, 560), cam = {yawDeg: yaw, cx: 0, cy: 1.08, cz: 0, height: 2.35};
    const slots = [-3.0, -1.6, -0.3, 1.0, 2.3].slice(0, have.length + 1);
    const place = (meshes, k) => shift(meshes, yaw === 0 ? [slots[k], 0, 0] : [0, 0, -slots[k]]);
    drawMeshes(c, cam, place(zp.meshes, 0));
    have.forEach((v, k) => drawMeshes(c, cam, place(posed(loaded[v], null, 0).meshes, k + 1)));
    for (const [y, col] of [[0, [200, 60, 60]], [1.78, [120, 200, 120]], [2.0, [240, 200, 80]], [2.2, [90, 90, 110]]]) hline(c, cam, y, col);
    cells.push({canvas: c, label: `${lab}: zombie lastshift 1.78 m | ${have.map(v => `${v} ${loaded[v].extras.enemyScreacher.heightM} m`).join(' | ')}   (lines 1.78 green / 2.00 yellow / 2.20 door grey)`});
  }
  {
    const c = new Canvas(1900, 560), cam = {yawDeg: 0, cx: 0, cy: 1.08, cz: 0, height: 2.35};
    const slots = [-3.0, -1.6, -0.3, 1.0, 2.3];
    drawMeshes(c, cam, shift(zp.meshes, [slots[0], 0, 0]));
    have.forEach((v, k) => { const M = loaded[v]; drawMeshes(c, cam, shift(posed(M, M.clips.find(x => x.name === 'Idle'), 0).meshes, [slots[k + 1], 0, 0])); });
    for (const [y, col] of [[0, [200, 60, 60]], [1.78, [120, 200, 120]], [2.0, [240, 200, 80]], [2.2, [90, 90, 110]]]) hline(c, cam, y, col);
    cells.push({canvas: c, label: 'front: zombie bind | the Screachers in their Idle frame-0 pose'});
  }
  const f = path.join(OUT, 'beside-zombie.png');
  await composeGrid(cells, {cols: 1, title: 'Screacher sc01..sc04 beside the runtime lastshift zombie (1.78 m, scale 1.0)', file: f});
  console.log(path.relative(REPO, f));
}

const loaded = {};
for (const v of only) { if (!fs.existsSync(glbOf(v))) { console.log(`${v}: no GLB (skipped)`); continue; } loaded[v] = await variantSheets(v); }
if (want('beside') && Object.keys(loaded).length) {
  for (const v of VARIANTS) if (!loaded[v] && fs.existsSync(glbOf(v))) loaded[v] = await loadSkinned(glbOf(v));
  await familySheet(loaded);
}
