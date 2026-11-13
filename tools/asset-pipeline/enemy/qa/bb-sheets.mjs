#!/usr/bin/env node
// Task studio-bb-models-20261112-234540-01: CPU QA sheets of the WRITTEN BB GLBs (no browser / GPU; internal diagnostics in the
// PRIVATE task folder, never committed):
//   node tools/asset-pipeline/enemy/qa/bb-sheets.mjs [--only binky[,teddy]] [--sheets bind,weights,keys,stretch] [--dir DIR] [--out DIR]
// Reads game/public/assets/models/enemy-bb-<v>.glb (or --dir: a dev build folder) and the lastshift zombie body for scale,
// rebuilds the rig from the GLB itself (bind joints from the node translations; fingertips, toes, heels and palms from the scene
// extras `enemyBb`), CPU-skins the contract's key poses (lib/bb-poses.mjs) with linear-blend skinning and renders with
// zombie/lib/raster.mjs into <out>/<v>/ (default reference/tasks/bb-models-20261112-234540/qa/sheets/<v>/):
//   bind.png      front / side / back bind pose + the 18 joints, the head sphere, the fingertip / crown ends
//   weights.png   dominant-bone colours (front / back / side)
//   keys.png      CRAWL, WINDUP, POUNCE, TWITCH from the side and three-quarter front, lowest point on the floor line
//   stretch.png   worst triangle stretch (posed / bind edge) over the key poses + every envelope range end
// and once for the family:  <out>/beside-zombie.png   the four bodies (bind) beside the 1.78 m runtime zombie (front, side).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {REPO} from '../../zombie/lib/master.mjs';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {Rig, V} from '../../zombie/lib/pose.mjs';
import {triangleStretch} from '../../zombie/lib/stretch.mjs';
import {seamlessNormals} from '../../zombie/lib/raster.mjs';
import {Canvas, project, dot, hline, drawSkeleton, composeGrid} from '../lib/qa-render.mjs';
import {bbPose, KEY_POSES, envelopePoses} from '../lib/bb-poses.mjs';

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const VARIANTS = ['lullaby', 'binky', 'teddy', 'changeling'];
const only = arg('--only') ? arg('--only').split(',') : VARIANTS;
const sheets = arg('--sheets') ? new Set(arg('--sheets').split(',')) : null;
const want = k => !sheets || sheets.has(k);
const OUT = path.resolve(arg('--out') || path.join(REPO, 'reference/tasks/bb-models-20261112-234540/qa/sheets'));
const DIR = arg('--dir') ? path.resolve(arg('--dir')) : null;
const glbOf = v => DIR ? path.join(DIR, `enemy-bb-${v}.glb`) : path.join(REPO, `game/public/assets/models/enemy-bb-${v}.glb`);
const ZOMBIE = path.join(REPO, 'game/public/assets/models/zombie-body-lastshift-t25.glb');
const BG = [70, 70, 76];
const PAL = [[90, 90, 90], [200, 200, 200], [120, 80, 200], [80, 140, 230], [60, 200, 220], [250, 240, 90],
  [240, 120, 60], [240, 60, 60], [250, 170, 190], [60, 200, 90], [40, 140, 60], [180, 240, 120],
  [200, 120, 40], [230, 200, 60], [255, 255, 160], [120, 60, 160], [170, 110, 230], [220, 190, 255]];

async function decode(tex) {
  const {data, info} = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  return {data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height};
}

/** Skinned GLB -> {mesh (pos, idx, uv, joints, weights), tex, bind joints, extras}. */
async function loadSkinned(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const root = doc.getRoot(), parent = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const node = root.listNodes().find(n => n.getSkin() && n.getMesh());
  const jn = node.getSkin().listJoints(), names = jn.map(j => j.getName());
  if (names.join() !== JOINTS.map(j => j[0]).join()) throw new Error('unexpected joint order');
  const bind = {};
  for (const j of jn) { let p = [0, 0, 0], n = j; while (n && names.includes(n.getName())) { p = V.add(p, n.getTranslation()); n = parent.get(n); } bind[j.getName()] = p; }
  const prim = node.getMesh().listPrimitives()[0], A = s => prim.getAttribute(s);
  const wA = A('WEIGHTS_0'), wArr = wA.getArray();
  const weights = wA.getNormalized() ? Float32Array.from(wArr, v => v / (wArr instanceof Uint16Array ? 65535 : 255)) : Float32Array.from(wArr);
  const mat = prim.getMaterial();
  return {mesh: {pos: Float32Array.from(A('POSITION').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()), uv: Float32Array.from(A('TEXCOORD_0').getArray()), joints: Uint16Array.from(A('JOINTS_0').getArray()), weights},
    tex: mat.getBaseColorTexture() ? await decode(mat.getBaseColorTexture()) : null, bind, extras: root.listScenes()[0].getExtras().enemyBb};
}

/** The pose rig (zombie/lib/pose.mjs Rig input) from the GLB's bind joints + extras. */
function rigOf(G) {
  const J = G.bind, X = G.extras;
  const skel = {
    joints: J, heelZ: Math.max(J.L_Foot[2] + X.contact.heel.L[2], J.R_Foot[2] + X.contact.heel.R[2]),
    ends: {Head: V.add(J.Head, X.ends.Head), L_Hand: V.add(J.L_Hand, X.ends.L_Hand), R_Hand: V.add(J.R_Hand, X.ends.R_Hand), L_Foot: V.add(J.L_Foot, X.contact.toe.L), R_Foot: V.add(J.R_Foot, X.contact.toe.R)},
    contact: X.contact,
  };
  return {skel, rig: new Rig(skel)};
}

function circle(c, cam, centre, r, yaw, rgb) {
  for (let a = 0; a < 72; a++) {
    const t = a / 72 * Math.PI * 2;
    const q = project(c, cam, Math.abs(yaw % 180) < 1 ? [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t), centre[2]] : [centre[0], centre[1] + r * Math.sin(t), centre[2] + r * Math.cos(t)]);
    dot(c, q[0], q[1], 1.2, rgb);
  }
}

async function sheetsFor(v) {
  const G = await loadSkinned(glbOf(v)), {skel, rig} = rigOf(G), M = G.mesh, out = path.join(OUT, v);
  fs.mkdirSync(out, {recursive: true});
  const nrm0 = seamlessNormals(M.pos, M.idx);
  const posed = spec => { const P = skinPositions(M, skel, rig.fk(bbPose(rig, skel, spec))); let y0 = Infinity; for (let i = 1; i < P.length; i += 3) y0 = Math.min(y0, P[i]); for (let i = 1; i < P.length; i += 3) P[i] -= y0; return P; };
  if (want('bind')) {
    const cells = [];
    for (const yaw of [0, 90, 180]) {
      const c = new Canvas(420, 480, BG), cam = {yawDeg: yaw, cx: 0, cy: 0.45, height: 0.95};
      c.draw({pos: M.pos, nrm: nrm0, uv: M.uv, idx: M.idx, tex: G.tex}, cam); hline(c, cam, 0, [200, 60, 60]); hline(c, cam, 0.85, [200, 60, 60]);
      drawSkeleton(c, cam, G.bind, JOINTS, {r: 3});
      for (const e of Object.values(skel.ends)) { const q = project(c, cam, e); dot(c, q[0], q[1], 3, [255, 60, 60]); }
      circle(c, cam, G.extras.head.centre, G.extras.head.radius, yaw, [255, 80, 200]);
      cells.push({canvas: c, label: `${v} bind yaw ${yaw} (red lines: floor, 0.85 m)`});
    }
    await composeGrid(cells, {cols: 3, title: `BB ${v}: bind pose, joints, head sphere, ends`, file: path.join(out, 'bind.png')});
  }
  if (want('weights')) {
    const cells = [];
    const groups = new Map();
    for (let t = 0; t < M.idx.length; t += 3) { const vtx = M.idx[t]; let best = 0; for (let k = 1; k < 4; k++) if (M.weights[vtx * 4 + k] > M.weights[vtx * 4 + best]) best = k; const j = M.joints[vtx * 4 + best]; (groups.get(j) || groups.set(j, []).get(j)).push(M.idx[t], M.idx[t + 1], M.idx[t + 2]); }
    for (const yaw of [0, 180, 90]) {
      const c = new Canvas(420, 480, BG), cam = {yawDeg: yaw, cx: 0, cy: 0.45, height: 0.95};
      for (const [j, tri] of groups) c.draw({pos: M.pos, nrm: nrm0, idx: Uint32Array.from(tri), color: PAL[j]}, cam);
      drawSkeleton(c, cam, G.bind, JOINTS, {r: 2.5});
      cells.push({canvas: c, label: `${v} dominant bone yaw ${yaw}`});
    }
    await composeGrid(cells, {cols: 3, title: `BB ${v}: dominant skin bone`, file: path.join(out, 'weights.png')});
  }
  if (want('keys')) {
    const cells = [];
    for (const [name, spec] of Object.entries(KEY_POSES)) {
      const P = posed(spec), nrm = seamlessNormals(P, M.idx);
      for (const yaw of [90, 30]) {
        const c = new Canvas(420, 400, BG), cam = {yawDeg: yaw, cx: 0, cy: 0.3, cz: 0.15, height: 0.8};
        c.draw({pos: P, nrm, uv: M.uv, idx: M.idx, tex: G.tex}, cam); hline(c, cam, 0, [200, 60, 60]);
        cells.push({canvas: c, label: `${v} ${name} yaw ${yaw}`});
      }
    }
    await composeGrid(cells, {cols: 4, title: `BB ${v}: the contract's key poses (lib/bb-poses.mjs; lowest point on the floor)`, file: path.join(out, 'keys.png')});
  }
  if (want('stretch')) {
    const poses = [...Object.entries(KEY_POSES).map(([n, spec]) => ({clip: n, pose: bbPose(rig, skel, spec)})), ...envelopePoses().map(p => ({clip: p.name, pose: bbPose(rig, skel, p.spec)}))];
    const st = triangleStretch(M, skel, rig, poses);
    const BC = [[150, 150, 150], [120, 200, 120], [240, 220, 60], [250, 130, 40], [240, 30, 30]];
    const bucket = s => s > 3 ? 4 : s > 2 ? 3 : s > 1.5 ? 2 : s > 1.25 ? 1 : 0;
    const groups = [[], [], [], [], []];
    for (let k = 0; k < M.idx.length / 3; k++) groups[bucket(st.worst[k])].push(M.idx[k * 3], M.idx[k * 3 + 1], M.idx[k * 3 + 2]);
    const cells = [];
    for (const yaw of [0, 180, 90, 270]) {
      const c = new Canvas(420, 480, BG), cam = {yawDeg: yaw, cx: 0, cy: 0.45, height: 0.95};
      groups.forEach((g, b) => { if (g.length) c.draw({pos: M.pos, nrm: nrm0, idx: Uint32Array.from(g), color: BC[b], zBias: b * 1e-4}, cam); });
      cells.push({canvas: c, label: `${v} worst stretch yaw ${yaw}`});
    }
    await composeGrid(cells, {cols: 4, title: `BB ${v}: worst triangle stretch over the key poses + envelope ends (grey < 1.25, green < 1.5, yellow < 2, orange < 3, red > 3)`, file: path.join(out, 'stretch.png')});
  }
  console.log(`${v}: sheets in ${out}`);
  return G;
}

async function besideZombie(loaded) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(ZOMBIE);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0], mat = prim.getMaterial();
  const Z = {pos: Float32Array.from(prim.getAttribute('POSITION').getArray()), idx: Uint32Array.from(prim.getIndices().getArray()), uv: Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray()), tex: mat.getBaseColorTexture() ? await decode(mat.getBaseColorTexture()) : null};
  const cells = [];
  for (const yaw of [0, 90]) {
    const c = new Canvas(1100, 520, BG), cam = {yawDeg: yaw, cx: 0, cy: 0.95, height: 2.0}, k = c.h / cam.height;
    // the zombie at 1.0 (runtime-scaled reference, never rescaled), the BBs beside it, 0.55 m apart
    const shift = (pos, dx) => { const P = Float32Array.from(pos); for (let i = 0; i < P.length; i += 3) { if (yaw === 0) P[i] += dx; else P[i + 2] -= dx; } return P; };
    c.draw({pos: shift(Z.pos, -1.1), idx: Z.idx, uv: Z.uv, tex: Z.tex}, cam);
    loaded.forEach((G, i) => c.draw({pos: shift(G.mesh.pos, -0.45 + i * 0.5), idx: G.mesh.idx, uv: G.mesh.uv, tex: G.tex}, cam));
    for (const y of [0, 0.85, 1.78]) hline(c, cam, y, [200, 60, 60]);
    void k;
    cells.push({canvas: c, label: `the four BBs (0.85 m) beside the runtime zombie (lastshift body, 1.78 m), yaw ${yaw}; red lines 0 / 0.85 / 1.78 m`});
  }
  await composeGrid(cells, {cols: 1, title: 'BB scale check', file: path.join(OUT, 'beside-zombie.png')});
}

const loaded = [];
for (const v of only) loaded.push(await sheetsFor(v));
if (only.length === VARIANTS.length && want('scale')) await besideZombie(loaded);
