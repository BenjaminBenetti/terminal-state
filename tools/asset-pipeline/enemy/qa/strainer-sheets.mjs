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
//   textured.png         lit + normal-mapped (lib/strainer-texture-render.mjs) bind front / back / 3/4, two clip poses, crown
//                        close-ups (the Codex-projected maps; texture QA of lane TEXTURE)
//   normal-check.png     the same close-ups with the normal map off / on + a synthetic dome quad (bump direction check)
//   --glb FILE           render another GLB (default: the written runtime GLB)
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
import {LitCanvas, skinNormals} from '../lib/strainer-texture-render.mjs';
import {normalFromGradient} from '../lib/strainer-texture-bake.mjs';

const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(argOut > 0 ? process.argv[argOut + 1] : path.join(REPO, 'qa-artifacts/strainer'));
const only = (i => i > 0 ? new Set(process.argv[i + 1].split(',')) : null)(process.argv.indexOf('--only'));
const GLB = (i => (i > 0 ? path.resolve(process.argv[i + 1]) : path.join(REPO, 'game/public/assets/models/enemy-strainer.glb')))(process.argv.indexOf('--glb'));
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
    const nA = A('NORMAL'), nrm = nA ? Float32Array.from(nA.getArray(), v => (nA.getNormalized() ? Math.max(-1, v / 127) : v)) : null;
    meshes.push({name: node.getName(), pos: Float32Array.from(A('POSITION').getArray()), nrm, uv: Float32Array.from(A('TEXCOORD_0').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()),
      joints: Uint16Array.from(A('JOINTS_0').getArray()), weights, tex: mat.getBaseColorTexture() ? await decode(mat.getBaseColorTexture()) : null,
      normalTex: mat.getNormalTexture() ? await decode(mat.getNormalTexture()) : null, mrTex: mat.getMetallicRoughnessTexture() ? await decode(mat.getMetallicRoughnessTexture()) : null});
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
const posed = (M, clip, f) => { const w = fk(M, clip, f); return {world: w, meshes: M.meshes.map(m => ({...m, pos: skinPositions(m, {joints: M.bind}, w), nrm: m.nrm && skinNormals(m, w, JOINTS.map(j => j[0]))}))}; };
const litMesh = m => ({pos: m.pos, nrm: m.nrm, uv: m.uv, idx: m.idx, base: m.tex, normal: m.normalTex, mr: m.mrTex});
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
    for (const [yaw, lab, cy, h, tex] of [[0, 'front', 1.1, 2.35], [90, 'side', 1.1, 2.35], [180, 'back', 1.1, 2.35], [35, 'upper 3/4', 1.65, 1.0],
      [0, 'pelvis front', 1.0, 0.6], [0, 'pelvis front (texture)', 1.0, 0.6, true], [0, 'shoulders front', 1.8, 0.7], [180, 'shoulders back', 1.8, 0.7]]) {
      const c = new Canvas(560, 600), cam = {yawDeg: yaw, cx: 0, cy, cz: 0, height: h};
      for (const m of bp.meshes) c.draw(tex ? m : weightMesh(m), cam);
      cells.push({canvas: c, label: `${lab}${tex ? '' : ': dominant bone colour'}`});
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
  if (want('detail')) {
    // key poses large: [clip, time, yaw, cy, height]
    const keys = [['Idle', 1.0, 30, 1.25, 1.6], ['Walk', 0.45, 60, 1.1, 2.2], ['Run', 0.3, 70, 1.05, 2.2], ['Attack', 0.6, 20, 1.2, 2.0], ['Hit', 0.1, 330, 1.3, 1.6], ['Death', 2.1, 30, 0.35, 2.4], ['Walk', 0.9, 200, 1.1, 2.2], ['Death', 2.1, 120, 0.35, 2.4]];
    const cells = [];
    for (const [cn, t, yaw, cy, h] of keys) {
      const clip = M.clips.find(c => c.name === cn), f = clip.times.findIndex(x => Math.abs(x - t) < 0.017);
      const p = posed(M, clip, f), bb = bboxOf(p.meshes);
      const c = new Canvas(520, 560), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy, cz: (bb.lo[2] + bb.hi[2]) / 2, height: h};
      drawMeshes(c, cam, p.meshes);
      hline(c, cam, 0, [200, 60, 60]);
      cells.push({canvas: c, label: `${cn} t=${clip.times[f].toFixed(2)} yaw ${yaw}`});
    }
    const f = path.join(OUT, 'detail.png');
    await composeGrid(cells, {cols: 4, title: 'Strainer key poses (detail): wrists / claws attached, shoulders, head follows the neck', file: f});
    written.push(f);
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
  if (want('stretch')) {
    // per clip: the frame with the most triangles stretched > 2.5x (edge length posed / bind), triangles coloured by stretch
    const body = M.meshes[0], I = body.idx, P0 = body.pos, nt = I.length / 3;
    const grad = {width: 64, height: 1, data: new Uint8Array(64 * 4)};
    for (let k = 0; k < 64; k++) { const s = k / 63; grad.data.set(s < 0.33 ? [150, 150, 150, 255] : s < 0.66 ? [250, 210, 40, 255] : [240, 30, 30, 255], k * 4); }
    const L = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const ratio = P => { const r = new Float32Array(nt); for (let t = 0; t < nt; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; r[t] = Math.max(L(P, a, b) / Math.max(2e-3, L(P0, a, b)), L(P, b, c) / Math.max(2e-3, L(P0, b, c)), L(P, c, a) / Math.max(2e-3, L(P0, c, a))); } return r; };
    const cells = [];
    for (const cn of ['Walk', 'Run', 'Attack', 'Hit', 'Death']) {
      const clip = M.clips.find(c => c.name === cn);
      let best = null;
      for (let f = 0; f < clip.times.length; f += 2) { const p = posed(M, clip, f), r = ratio(p.meshes[0].pos); let k = 0; for (const v of r) if (v > 2.5) k++; if (!best || k > best.k) best = {f, k, r, p}; }
      const pos = new Float32Array(nt * 9), uv = new Float32Array(nt * 6), idx = new Uint32Array(nt * 3), Pp = best.p.meshes[0].pos;
      for (let t = 0; t < nt; t++) { const u = (0.5 + 63 * Math.min(1, Math.max(0, (best.r[t] - 1) / 2))) / 64 * 0.98 + 0.01; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; pos.set([Pp[v * 3], Pp[v * 3 + 1], Pp[v * 3 + 2]], (t * 3 + k) * 3); uv.set([u, 0.5], (t * 3 + k) * 2); idx[t * 3 + k] = t * 3 + k; } }
      const bb = bboxOf(best.p.meshes);
      for (const yaw of [35, 215]) {
        const c = new Canvas(360, 400), hh = Math.max(2.3, (bb.hi[0] - bb.lo[0]) * 1.2, (bb.hi[2] - bb.lo[2]) * 1.2), cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy: hh / 2 - 0.05, cz: (bb.lo[2] + bb.hi[2]) / 2, height: hh};
        c.draw({pos, idx, uv, tex: grad}, cam);
        cells.push({canvas: c, label: `${cn} t=${clip.times[best.f].toFixed(2)} tris>2.5x ${best.k} yaw ${yaw}`});
      }
    }
    const f = path.join(OUT, 'stretch.png');
    await composeGrid(cells, {cols: 4, title: 'Strainer triangle stretch (posed / bind edge): grey < 1.66x, yellow < 2.3x, red above; the worst frame per clip', file: f});
    written.push(f);
  }
  if (want('textured')) {
    const cells = [], bp = posed(M, null, 0);
    for (const [yaw, lab] of [[0, 'bind front'], [180, 'bind back'], [35, 'bind 3/4 front'], [215, 'bind 3/4 back']]) {
      const c = new LitCanvas(470, 560), cam = {yawDeg: yaw, cx: 0, cy: 1.1, cz: 0, height: 2.3};
      for (const m of bp.meshes) c.draw(litMesh(m), cam);
      cells.push({canvas: c, label: lab});
    }
    for (const [cn, t, yaw, lab] of [['Walk', 0.45, 30, 'Walk'], ['Attack', null, 330, 'Attack hit']]) {
      const clip = M.clips.find(c => c.name === cn), f = t == null ? clip.times.findIndex(x => Math.abs(x - X.attackHitTime) < 1e-3) : clip.times.findIndex(x => Math.abs(x - t) < 0.017);
      const p = posed(M, clip, f), bb = bboxOf(p.meshes), c = new LitCanvas(470, 560);
      const cam = {yawDeg: yaw, cx: (bb.lo[0] + bb.hi[0]) / 2, cy: 1.1, cz: (bb.lo[2] + bb.hi[2]) / 2, height: 2.4};
      for (const m of p.meshes) c.draw(litMesh(m), cam);
      cells.push({canvas: c, label: `${lab} t=${clip.times[f].toFixed(2)} yaw ${yaw}`});
    }
    for (const [yaw, lab] of [[20, 'crown 3/4 front'], [200, 'crown 3/4 back']]) {
      const c = new LitCanvas(470, 560), cam = {yawDeg: yaw, cx: 0, cy: 1.72, cz: 0.15, height: 0.95};
      for (const m of bp.meshes) c.draw(litMesh(m), cam);
      cells.push({canvas: c, label: lab});
    }
    const f = path.join(OUT, 'textured.png');
    await composeGrid(cells, {cols: 4, title: 'Strainer textured (Codex-projected base colour + derived normal / roughness; CPU lit, normal-mapped)', file: f});
    written.push(f);
  }
  if (want('texdetail')) {
    // close-ups of the regions projection covers worst: crown top, under the crown, arm undersides, hands, armpit / flank,
    // inner thighs, feet, idle pose from a player's eye height
    const cells = [], bp = posed(M, null, 0);
    const idle = posed(M, M.clips.find(c => c.name === 'Idle'), 0);
    const views = [[bp, 180, 0, 2.0, -0.05, 0.6, 'crown top from behind'], [bp, 0, 0, 1.75, 0.3, 0.6, 'under the crown (front)'], [bp, 90, 0.55, 1.45, 0, 0.8, 'L arm side (from +X)'],
      [bp, 0, 0.95, 1.0, 0.1, 0.6, 'L hand front'], [bp, 180, -0.95, 1.0, 0.1, 0.6, 'R hand back'], [bp, 60, 0.3, 1.45, 0, 0.7, 'L flank / armpit 3/4'],
      [bp, 10, 0, 0.75, 0, 0.8, 'thighs / knees front'], [bp, 30, 0, 0.15, 0.1, 0.45, 'feet 3/4'], [idle, 20, 0, 1.3, 0, 2.3, 'Idle from 1.6 m (3/4)'], [idle, 160, 0, 1.3, 0, 2.3, 'Idle back 3/4']];
    for (const [P_, yaw, cx, cy, cz, hh, lab] of views) {
      const c = new LitCanvas(380, 420), cam = {yawDeg: yaw, cx, cy, cz, height: hh};
      for (const m of P_.meshes) c.draw(litMesh(m), cam);
      cells.push({canvas: c, label: lab});
    }
    const f = path.join(OUT, 'texdetail.png');
    await composeGrid(cells, {cols: 5, title: 'Strainer texture close-ups (projection coverage stress regions)', file: f});
    written.push(f);
  }
  if (want('normalcheck')) {
    const cells = [], bp = posed(M, null, 0);
    for (const nmOn of [false, true]) for (const [yaw, cy, hh, lab] of [[10, 1.75, 0.6, 'crown / ribs'], [190, 1.5, 0.7, 'back / spine'], [25, 0.7, 0.6, 'knee']]) {
      const c = new LitCanvas(380, 380), cam = {yawDeg: yaw, cx: yaw === 25 ? 0.15 : 0, cy, cz: 0.1, height: hh};
      for (const m of bp.meshes) c.draw(litMesh(m), cam, {normalMap: nmOn});
      cells.push({canvas: c, label: `${lab}: normal map ${nmOn ? 'ON' : 'off'} (key light upper left)`});
    }
    // synthetic dome through the bake's own normal encoder on a glTF-UV quad (u -> +X, v -> -Y): lit upper-left = raised
    const S = 64, img = new Uint8Array(S * S * 4), hgt = (x, y) => Math.exp(-((x - 32) ** 2 + (y - 32) ** 2) / 120);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const nv = normalFromGradient((hgt(x + 1, y) - hgt(x - 1, y)) / 2, (hgt(x, y + 1) - hgt(x, y - 1)) / 2, 6, 0.9); img.set([(nv[0] * 0.5 + 0.5) * 255, (nv[1] * 0.5 + 0.5) * 255, (nv[2] * 0.5 + 0.5) * 255, 255], (y * S + x) * 4); }
    const quad = {pos: Float32Array.from([-0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 0]), nrm: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), uv: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]), idx: Uint32Array.from([0, 2, 1, 0, 3, 2]),
      base: {data: new Uint8Array(S * S * 4).fill(170), width: S, height: S}, normal: {data: img, width: S, height: S}};
    const c = new LitCanvas(380, 380); c.draw(quad, {yawDeg: 0, cx: 0, cy: 0, cz: 0, height: 1.2});
    cells.push({canvas: c, label: 'synthetic dome (bake encoder): bright upper-left = raised'});
    const f = path.join(OUT, 'normal-check.png');
    await composeGrid(cells, {cols: 3, title: 'Normal map direction check (glTF convention; three.js derivative tangents)', file: f});
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
