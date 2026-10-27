#!/usr/bin/env node
// Visual QA for the rigged zombie: loads the GLB with three's GLTFLoader in Firefox (CPU WebGL2)
// and writes labelled contact sheets to qa-artifacts/assets/zombie/.
//   node tools/asset-pipeline/zombie/qa/render-qa.mjs [--only=clips|bind|...] [--out=dir]
import fs from 'node:fs';
import path from 'node:path';
import {withViewer} from './browser.mjs';
import {REPO, sha256File} from '../lib/master.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const OUT = path.resolve(REPO, args.out || 'qa-artifacts/assets/zombie');
const GLB = '/game/public/assets/models/zombie-rigged.glb';
const only = args.only ? new Set(String(args.only).split(',')) : null;
const want = k => !only || only.has(k);

const STAND = {cx: 0, cy: 0.92, cz: 0, h: 2.0};
const clipFrames = {
  Idle: [0, 0.75, 1.5, 2.25], Walk: [0, 0.3, 0.6, 0.9], Run: [0, 0.19, 0.375, 0.56],
  Attack: [0, 0.32, 0.45, 0.58, 0.82, 1.1], Hit: [0, 0.08, 0.2, 0.35], Death: [0, 0.45, 0.72, 1.05, 1.25, 1.6],
};

const report = {glb: GLB, sheets: []};
await withViewer(async v => {
  const summary = await v.load(GLB);
  report.load = summary;
  console.log('loaded:', JSON.stringify({meshes: summary.meshes, skinned: summary.skinnedMeshes.map(m => [m.name, m.vertices, m.triangles, m.joints.length, m.map, m.mr]), shared: summary.sharedSkeleton, clips: summary.clips, errors: summary.errors}));
  const sheet = async (name, spec) => { const f = path.join(OUT, name); await v.sheet(spec, f); report.sheets.push(path.relative(REPO, f)); console.log('  wrote', path.relative(REPO, f)); };
  const views4 = ['front', 'left', 'back', 'threequarter'];
  if (want('bind')) {
    await sheet('bind-body-only.png', {title: 'Bind (A-pose) - ZombieBody only (coat hidden)', cols: 4, cellW: 360, cellH: 480, cells: views4.map(view => ({label: view, view, coat: false, frame: STAND}))});
    await sheet('bind-body-coat.png', {title: 'Bind (A-pose) - ZombieBody + ZombieCoat', cols: 4, cellW: 360, cellH: 480, cells: views4.map(view => ({label: view, view, frame: STAND}))});
    await sheet('head-closeup.png', {title: 'Head close-up (1024 base colour, head charts at 1.8x texel density)', cols: 3, cellW: 360, cellH: 360, cells: ['front', 'threequarter', 'left'].map(view => ({label: view, view, coat: false, frame: {cx: 0, cy: 1.63, cz: 0, h: 0.38}}))});
  }
  if (want('skeleton')) {
    await sheet('skeleton-overlay.png', {title: 'Derivative skeleton (18 joints) over bind mesh', cols: 3, cellW: 440, cellH: 560, cells: [
      {label: 'front (body only)', view: 'front', coat: false, skeleton: true, jointLabels: true, frame: STAND},
      {label: 'side (body only)', view: 'left', coat: false, skeleton: true, jointLabels: true, frame: STAND},
      {label: 'front (body+coat)', view: 'front', skeleton: true, frame: STAND}]});
  }
  if (want('weights')) {
    await sheet('skin-weights.png', {title: 'Skin weights (colour = weighted joint colours)', cols: 4, cellW: 360, cellH: 480, cells: [
      {label: 'body front', view: 'front', coat: false, weights: true, frame: STAND}, {label: 'body back', view: 'back', coat: false, weights: true, frame: STAND},
      {label: 'coat front', view: 'front', body: false, weights: true, frame: STAND}, {label: 'coat side', view: 'left', body: false, weights: true, frame: STAND}]});
  }
  if (want('clips')) {
    for (const [clip, times] of Object.entries(clipFrames)) {
      if (only && !only.has('clips') && !only.has(clip)) continue;
      const death = clip === 'Death';
      const fr = death ? {cx: 0, cy: 0.75, cz: -0.45, h: 2.6} : STAND;
      const frSide = death ? {cx: 0, cy: 0.75, cz: -0.45, h: 2.6} : {...STAND, cz: 0.1};
      const cells = [
        ...times.map(t => ({label: `${clip} t=${t.toFixed(2)} front`, view: death ? 'threequarter' : 'front', clip, t, frame: fr})),
        ...times.map(t => ({label: `${clip} t=${t.toFixed(2)} side`, view: 'left', clip, t, frame: frSide})),
      ];
      await sheet(`clip-${clip.toLowerCase()}.png`, {title: `${clip} - body+coat - hand-authored procedural keyframes (not mocap)`, cols: times.length, cellW: 300, cellH: 400, cells});
      if (['Walk', 'Attack', 'Death'].includes(clip)) await sheet(`clip-${clip.toLowerCase()}-nocoat.png`, {title: `${clip} - uncoated variant (ZombieCoat hidden)`, cols: times.length, cellW: 300, cellH: 400, cells: cells.map(c => ({...c, coat: false}))});
    }
  }
  if (want('floor')) {
    report.floor = {};
    for (const [clip, times] of Object.entries(clipFrames)) report.floor[clip] = await Promise.all(times.map(async t => ({t, ...(await v.minY(clip, t))})));
  }
  report.consoleLogs = v.logs.filter(l => !l.includes('THREE.WebGLRenderer') && !l.includes('GPU stall'));
});
report.glbSha256 = sha256File(path.join(REPO, GLB));
fs.mkdirSync(OUT, {recursive: true});
// baked atlas previews (derived textures, for reference)
for (const [src, dst] of [['/tmp/ll-zombie/body-base-preview.png', 'atlas-body-basecolor-1024.png'], ['/tmp/ll-zombie/coat-base-preview.png', 'atlas-coat-basecolor-1024.png']])
  if (fs.existsSync(src) && !only) { fs.copyFileSync(src, path.join(OUT, dst)); report.sheets.push(path.relative(REPO, path.join(OUT, dst))); }
fs.writeFileSync(path.join('/tmp/ll-zombie', 'qa-report.json'), JSON.stringify(report, null, 2));
// record the browser QA in the derivative manifest (only for a full run into the real QA folder)
const manifestFile = path.join(REPO, 'game/public/assets/derivatives/zombie-rigged.json');
if (!only && !args.out && fs.existsSync(manifestFile)) {
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (m.outputs?.glb?.sha256 !== report.glbSha256) throw new Error('manifest/GLB sha mismatch - rebuild first');
  const L = report.load;
  m.qa = {
    renderer: 'three 0.186.1 GLTFLoader + WebGLRenderer in Firefox (puppeteer) on Xvfb with Mesa llvmpipe CPU WebGL2 (tools/qa/browser-env.mjs)',
    loadedWithoutErrors: L.errors.length === 0 && report.consoleLogs.every(l => !/error/i.test(l)),
    loadErrors: L.errors, consoleLogs: report.consoleLogs.slice(0, 20),
    skinnedMeshes: L.skinnedMeshes.map(x => ({name: x.name, vertices: x.vertices, triangles: x.triangles, joints: x.joints.length, baseColor: x.map, metallicRoughness: x.mr})),
    sharedSkeleton: L.sharedSkeleton, jointNames: L.skinnedMeshes[0]?.joints, clips: L.clips,
    threeSkinningFloorSamples: report.floor,
    contactSheets: report.sheets,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(m, null, 2) + '\n');
  console.log('manifest qa section updated');
}
console.log('qa report: /tmp/ll-zombie/qa-report.json');
