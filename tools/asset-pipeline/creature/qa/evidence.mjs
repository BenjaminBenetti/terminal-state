#!/usr/bin/env node
// Evidence sheets for the rat/dog derivative, CPU-rendered from the BUILT runtime GLB (no browser/GPU):
//   source-trace.png   concept image | read-only master (CPU render) | runtime derivative, same framing
//   turnaround.png     bind pose at 8 yaws + top view (textured)
//   clips.png          Idle / Walk / Run / Attack / Hit / Death frames (side view, floor line)
//   attack-head.png    head close-up through the bite (jaw opening and snapping shut at the impact)
//   weights.png        skin-weight colours (dominant bones blended) in bind and in motion
//   textures.png       baked base-colour atlas + tangent-space normal map (from the build's previews)
// Writes qa-artifacts/iter07-creature/ and copies to reference/tasks/vertical-slice-iteration07-20261026/evidence/.
//   node tools/asset-pipeline/creature/qa/evidence.mjs [--master]   (--master adds the 1M-triangle master render)
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {REPO} from '../../zombie/lib/master.mjs';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {loadSource} from '../../zombie/lib/source.mjs';
import {MASTER} from '../lib/master.mjs';
import {quadrupedPlacement} from '../lib/placement.mjs';
import {loadCreature, render, sheet} from './render-lib.mjs';

const OUT = path.join(REPO, 'qa-artifacts/iter07-creature');
const REF = path.join(REPO, 'reference/tasks/vertical-slice-iteration07-20261026/evidence');
fs.mkdirSync(OUT, {recursive: true});
const ARGS = new Set(process.argv.slice(2));
const glb = path.join(REPO, 'game/public/assets/models/creature-ratdog.glb');
const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/creature-ratdog.json'), 'utf8'));
const c = await loadCreature(glb);
const files = [];
const out = f => { const p = path.join(OUT, f); files.push(p); return p; };
const side = {cy: 0.32, cz: -0.08, h: 1.0};
const wide = {cy: 0.34, cz: 0.02, h: 1.2};

// --- source trace ----------------------------------------------------------------------------
{
  const W = 420, H = 300;
  const concept = await sharp(path.join(REPO, MASTER.conceptImage)).resize(W, H, {fit: 'contain', background: '#28282e'}).removeAlpha().raw().toBuffer();
  const cells = [{rgb: concept, w: W, h: H}];
  if (ARGS.has('--master')) {
    const m = await loadSource(MASTER);
    const pl = quadrupedPlacement(m.pos, {topHeight: prov.placement.topHeightM});
    const cv = new Canvas(W, H, [40, 40, 46]);
    cv.draw({pos: pl.apply(m.pos), idx: m.idx, uv: m.uv, tex: {...m.baseColor, channels: 4}, nrm: pl.applyNormals(m.nrm)}, {yawDeg: 300, ...{cx: 0, cy: side.cy, cz: side.cz, height: side.h}});
    cells.push(cv);
  }
  cells.push(render(c, {yaw: 300, W, H, frame: side}));
  await sheet(out('source-trace.png'), `Source trace: Field Notes quadruped-02 concept (${MASTER.conceptSha256.slice(0, 12)}…) | ${ARGS.has('--master') ? 'read-only master 998,536 tris (CPU) | ' : ''}runtime derivative ${prov.output.triangles} tris`,
    [cells], W, H, ['concept image (native imagegen)', ...(ARGS.has('--master') ? ['master GLB (sha 03503553…)'] : []), 'creature-ratdog.glb (bind)'], [''], {labelW: 10});
}
// --- turnaround -----------------------------------------------------------------------------
{
  const W = 300, H = 230;
  const yaws = [0, 45, 90, 135, 180, 225, 270, 315];
  const row1 = yaws.slice(0, 4).map(yaw => render(c, {yaw, W, H, frame: side}));
  const row2 = yaws.slice(4).map(yaw => render(c, {yaw, W, H, frame: side}));
  await sheet(out('turnaround.png'), `creature-ratdog.glb bind pose turnaround (${prov.output.triangles} tris, 1024 colour + 512 normal/MR; top of shoulders ${prov.placement.topHeightM} m)`,
    [row1, row2, [render(c, {yaw: 'top', W, H, frame: {h: 1.6}})]], W, H, ['yaw 0 / 180 (front / back)', '45 / 225', '90 / 270 (left / right side)', '135 / 315'], ['', '', 'top']);
}
// --- clip frames ------------------------------------------------------------------------------
{
  const W = 270, H = 200, N = 6;
  const rows = [], labels = [];
  for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) {
    const m = c.extras.clips[name];
    const ts = Array.from({length: N}, (_, i) => +(m.duration * i / (m.loop ? N : N - 1)).toFixed(3));
    rows.push(ts.map(t => render(c, {clip: name, t, yaw: name === 'Death' ? 300 : 270, W, H, frame: wide})));
    labels.push(`${name} ${m.duration}s${m.groundSpeed ? ` @${m.groundSpeed} m/s` : ''}${m.impact ? ` bite ${m.impact}s` : ''}`);
  }
  await sheet(out('clips.png'), 'Procedural quadruped clips (CPU-skinned from the runtime GLB; floor line = y 0; frames evenly spaced over each clip)', rows, W, H, ['', '', '', '', '', ''], labels, {labelW: 150});
}
// --- attack head close-up ----------------------------------------------------------------------
{
  const W = 260, H = 220;
  const ts = [0, 0.2, 0.32, 0.38, 0.42, 0.55];
  await sheet(out('attack-head.png'), 'Attack (lunge + bite): head close-up — jaw opens through the lunge and snaps shut at the impact (0.42 s)',
    [ts.map(t => render(c, {clip: 'Attack', t, yaw: 290, W, H, frame: {cy: 0.4, cz: 0.45, h: 0.5}}))], W, H, ts.map(t => `t=${t}`), [''], {labelW: 10});
}
// --- weights ------------------------------------------------------------------------------------
{
  const W = 270, H = 200;
  await sheet(out('weights.png'), 'Automatic skin weights (colour per dominant bone, blended): bind / walk / run / attack / death',
    [[render(c, {yaw: 270, W, H, frame: side, mode: 'weights'}), render(c, {yaw: 90, W, H, frame: side, mode: 'weights'}), render(c, {yaw: 0, W, H, frame: side, mode: 'weights'})],
      [render(c, {clip: 'Walk', t: 0.31, yaw: 270, W, H, frame: side, mode: 'weights'}), render(c, {clip: 'Run', t: 0.21, yaw: 270, W, H, frame: side, mode: 'weights'}), render(c, {clip: 'Attack', t: 0.42, yaw: 270, W, H, frame: side, mode: 'weights'})]],
    W, H, ['', '', ''], ['bind', 'motion'], {labelW: 60});
}
// --- textures -----------------------------------------------------------------------------------
{
  const base = '/tmp/ll-creature/base-preview.png', nrm = '/tmp/ll-creature/normal-preview.png';
  if (fs.existsSync(base) && fs.existsSync(nrm)) {
    const a = await sharp(base).resize(512, 512).removeAlpha().raw().toBuffer();
    const b = await sharp(nrm).resize(512, 512).removeAlpha().raw().toBuffer();
    await sheet(out('textures.png'), 'Baked atlas (new UVs): base colour 1024 (shown 512) | tangent-space normal 512 (three.js derivative-tangent convention)',
      [[{rgb: a, w: 512, h: 512}, {rgb: b, w: 512, h: 512}]], 512, 512, ['base colour', 'normal'], [''], {labelW: 10});
  }
}
// --- ragdoll (physics) -------------------------------------------------------------------------
{
  // settled bone world matrices dumped by game/tests/creature.test.ts (LL_CREATURE_EVIDENCE=/tmp/ll-creature/ragdoll-poses.json)
  const f = '/tmp/ll-creature/ragdoll-poses.json';
  if (fs.existsSync(f)) {
    const poses = JSON.parse(fs.readFileSync(f, 'utf8'));
    const W = 330, H = 240;
    const bind = c.joints.map((_, j) => [-c.ibm[j * 16 + 12], -c.ibm[j * 16 + 13], -c.ibm[j * 16 + 14]]);
    const rows = poses.map(p => {
      const M = c.names.map(n => p.bones[n]);
      const m = c.mesh, n = m.pos.length / 3, P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 4; k++) {
          const w = m.weights[i * 4 + k]; if (!w) continue;
          const j = m.joints[i * 4 + k], e = M[j], b = bind[j];
          const vx = m.pos[i * 3] - b[0], vy = m.pos[i * 3 + 1] - b[1], vz = m.pos[i * 3 + 2] - b[2];
          x += w * (e[0] * vx + e[4] * vy + e[8] * vz + e[12]); y += w * (e[1] * vx + e[5] * vy + e[9] * vz + e[13]); z += w * (e[2] * vx + e[6] * vy + e[10] * vz + e[14]);
        }
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      }
      return [0, 60, 300, 'top'].map(yaw => {
        const cv = new Canvas(W, H, [40, 40, 46]);
        let Q = P;
        const cam = {yawDeg: yaw === 'top' ? 0 : yaw, cx: p.centre[0], cy: 0.25, cz: p.centre[2], height: 1.4};
        if (yaw === 'top') { Q = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { Q[i] = P[i]; Q[i + 1] = -P[i + 2]; Q[i + 2] = P[i + 1]; } cam.cy = -p.centre[2]; cam.cz = 0; }
        else { const y = Math.round(H / 2 + cam.cy * H / cam.height); for (let x = 0; x < W; x++) cv.rgb.set([90, 90, 70], (y * W + x) * 3); }
        cv.draw({pos: Q, idx: m.idx, uv: m.uv, tex: c.tex, cullBack: false}, cam);
        return cv;
      });
    });
    await sheet(out('ragdoll.png'), 'Quadruped ragdoll (cannon-es, physics/ragdoll.ts generic rig hook): settled poses after a rifle / shotgun kill from a running pose (node test, CPU render)',
      rows, W, H, ['yaw 0', 'yaw 60', 'yaw 300', 'top'], poses.map(p => `${p.weapon} kill, settled ${p.settled.toFixed(1)} s`), {labelW: 150});
  }
}
fs.mkdirSync(REF, {recursive: true});
for (const f of files) fs.copyFileSync(f, path.join(REF, 'creature-' + path.basename(f)));
console.log('wrote', files.map(f => path.relative(REPO, f)).join(', '), '+ copies in', path.relative(REPO, REF));
