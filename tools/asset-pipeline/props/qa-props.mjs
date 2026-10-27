#!/usr/bin/env node
// Visual + loader QA for the props derivatives. Renders with the stock three.js GLTFLoader (no
// Draco/meshopt/KTX2 decoders registered) in Firefox on CPU WebGL2 (tools/qa/browser-env.mjs,
// always inside withBrowserLock). Writes PNG contact sheets + qa-report.json to qa-artifacts/assets/props.
// Usage: node tools/asset-pipeline/props/qa-props.mjs [--no-source]
import fs from 'node:fs';
import path from 'node:path';
import {withViewer, REPO} from './qa/browser.mjs';

const OUTDIR = path.join(REPO, 'qa-artifacts/assets/props');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/props.json'), 'utf8'));
const withSource = !process.argv.includes('--no-source');
const out = f => path.join(OUTDIR, f);
const report = {loader: 'three GLTFLoader (examples/jsm), no extensions/decoders registered', renderer: null, outputs: {}, silhouettes: {}, sheets: [], consoleErrors: []};

function matrixOf(t) { // column-major 4x4 for p' = s R p + t
  const R = t.R, s = t.scale, T = t.translation;
  return [s * R[0][0], s * R[1][0], s * R[2][0], 0, s * R[0][1], s * R[1][1], s * R[2][1], 0, s * R[0][2], s * R[1][2], s * R[2][2], 0, T[0], T[1], T[2], 1];
}

await withViewer(async v => {
  report.renderer = await v.glInfo();
  const sheet = async (file, spec) => { const st = await v.sheet(spec, out(file)); report.sheets.push(`qa-artifacts/assets/props/${file}`); return st; };

  // 1) every output loads cleanly
  for (const o of manifest.outputs) {
    const info = await v.load(o.key, '/' + o.output);
    report.outputs[o.key] = {file: o.output, ...info, manifestTriangles: o.triangles};
    console.log(o.key, 'tris', info.tris, 'textures', info.textures.join(' '), 'nodes', JSON.stringify(info.nodes), 'errors', info.errors.length);
  }

  // 2) per-asset view sheets
  const gunCells = (k, title) => ({title, cols: 2, cells: [
    {id: k, view: {kind: 'ortho', axis: '-x'}, markers: true, label: 'side from -X (reference/player side) - red=Muzzle, cyan=Grip, 0.1 m grid'},
    {id: k, view: {kind: 'ortho', axis: '+x'}, label: 'side from +X (AI-inferred far side)'},
    {id: k, view: {kind: 'ortho', axis: '+y'}, markers: true, label: 'top (+Y) - muzzle arrow points -Z (up the image = away)'},
    {id: k, view: {kind: 'persp', dir: [-1, 0.45, 0.8], zoom: 0.9}, label: '3/4 rear-left, 1 m grid at bbox floor'},
    {id: k, view: {kind: 'fp', fov: 70}, markers: true, label: 'first-person: camera at origin looking -Z, gun at (0.25,-0.22,-0.45)'},
    {id: k, view: {kind: 'ortho', axis: '-z'}, markers: true, label: 'from the muzzle end (-Z)'},
  ]});
  const propCells = (k, title, extra = [], backLabel = '3/4 back-left (AI-inferred back)') => ({title, cols: 2, cells: [
    {id: k, view: {kind: 'ortho', axis: '+z'}, label: 'front (+Z), 0.1 m grid / 1 m bold'},
    {id: k, view: {kind: 'ortho', axis: '+x'}, label: 'side (+X)'},
    {id: k, view: {kind: 'persp', dir: [0.8, 0.55, 1]}, label: '3/4 front-right, 0.1 m floor grid at bbox bottom'},
    {id: k, view: {kind: 'persp', dir: [-0.8, 0.5, -1]}, label: backLabel},
    ...extra,
  ]});
  const dims = o => o.dimensionsMeters.bbox.size.map(x => x.toFixed(3)).join(' x ');
  for (const o of manifest.outputs) {
    const title = `${o.output}  ${o.triangles} tris  ${dims(o)} m (provisional)  - prototype, unapproved`;
    if (o.kind === 'gun') await sheet(`${o.key}-views.png`, gunCells(o.key, title));
    else if (o.key === 'light') await sheet(`${o.key}-views.png`, propCells(o.key, title + '  origin top-centre', [
      {id: o.key, view: {kind: 'persp', dir: [0.5, -0.6, 1]}, label: 'from below-front (as seen hanging)'},
      {id: o.key, view: {kind: 'ortho', axis: '-y'}, label: 'underside (-Y)'}]));
    else if (o.key === 'sign') await sheet(`${o.key}-views.png`, propCells(o.key, `${o.output}  ${o.triangles} tris  ${dims(o)} m  - procedural draft re-export`, [], '3/4 back-left (authored plain back)'));
    else await sheet(`${o.key}-views.png`, propCells(o.key, title));
  }
  // first-person comparison of both guns side by side, larger FOV context
  await sheet('guns-firstperson.png', {title: 'first-person check: visible side must be the concept side, muzzle pointing away (-Z)', cols: 2, cells: [
    {id: 'rifle', view: {kind: 'fp', fov: 70}, label: 'rifle.glb FP'},
    {id: 'shotgun', view: {kind: 'fp', fov: 70}, label: 'shotgun.glb FP'},
  ]});

  // close-ups for chart-seam / bake artefact inspection (player-side)
  await sheet('guns-closeup.png', {title: 'close-ups of the player (-X) side: bake seams, texture density, normal-map shading', cols: 2, cells: [
    {id: 'rifle', view: {kind: 'persp', dir: [-1, 0.25, 0.15], zoom: 0.3, grid: false}, label: 'rifle receiver/magazine'},
    {id: 'rifle', view: {kind: 'persp', dir: [-0.7, 0.6, 1], zoom: 0.3, grid: false}, label: 'rifle from behind-left-above'},
    {id: 'shotgun', view: {kind: 'persp', dir: [-1, 0.25, 0.15], zoom: 0.28, grid: false}, label: 'shotgun receiver/shell carrier'},
    {id: 'shotgun', view: {kind: 'persp', dir: [-0.7, 0.6, 1], zoom: 0.3, grid: false}, label: 'shotgun from behind-left-above'},
  ]});

  // 3) dense source vs derivative (silhouette + appearance), source aligned with the same transform
  if (withSource) {
    for (const o of manifest.outputs.filter(x => x.kind !== 'procedural-reexport')) {
      const srcId = `${o.key}-src`;
      const info = await v.load(srcId, '/' + o.source.path, {matrix: matrixOf(o.transform)});
      const front = o.kind === 'gun' ? '-x' : '+z', side = o.kind === 'gun' ? '+y' : '+x';
      const close = o.kind === 'gun' ? {kind: 'persp', dir: [-1, 0.35, -0.45], zoom: 0.5} : {kind: 'persp', dir: [0.8, 0.55, 1], zoom: 0.75};
      const st = await sheet(`${o.key}-vs-source.png`, {title: `${o.key}: dense source ${info.tris} tris (transformed identically) vs derivative ${o.triangles} tris`, cols: 2, cells: [
        {id: srcId, view: close, label: `SOURCE ${info.tris} tris`},
        {id: o.key, view: close, label: `DERIVATIVE ${o.triangles} tris (baked)`},
        {kind: 'silhouette', ids: [srcId, o.key], view: {kind: 'ortho', axis: front, margin: 1.05}, label: `silhouette ${front}`},
        {kind: 'silhouette', ids: [srcId, o.key], view: {kind: 'ortho', axis: side, margin: 1.05}, label: `silhouette ${side}`},
      ]});
      report.silhouettes[o.key] = st.map(s => ({iou: +s.iou.toFixed(4), sourceOnlyPx: s.onlyA, derivativeOnlyPx: s.onlyB}));
      report.outputs[o.key].sourceRender = {tris: info.tris, errors: info.errors.length};
      await v.dispose(srcId);
      console.log(o.key, 'silhouette IoU', report.silhouettes[o.key].map(s => s.iou).join(' / '));
    }
  }

  // 4) procedural normal-map convention evidence + extracted textures used the plain three.js way
  const T = '/game/public/assets/textures/';
  await v.load('wall-src', '/public/vision-board/models/3a998a5eea914f7bad3c8e3b0012b49e.glb');
  await v.texPlane('wall-ext', {color: T + 'wall-working-face-color.jpg', orm: T + 'wall-working-face-orm.jpg', normal: T + 'wall-working-face-normal.png', w: 3.6, h: 1.8});
  await v.texPlane('tunnel-ext', {color: T + 'tunnel-working-face-color.jpg', orm: T + 'tunnel-working-face-orm.jpg', normal: T + 'tunnel-working-face-normal.png', w: 3.6, h: 1.38});
  await v.texPlane('platform-ext', {color: T + 'platform-working-face-color.jpg', orm: T + 'platform-working-face-orm.jpg', normal: T + 'platform-working-face-normal.png', w: 2.4, h: 2.28});
  const graze = {key: [-0.6, 3, 0.35], intensity: 3.5, fill: 0, env: 0.15};
  const near = {kind: 'persp', dir: [0, 0, 1], zoom: 0.16, grid: false, fov: 20};
  await sheet('procedural-normal-green-check.png', {title: 'Grazing light from ABOVE; tiles authored RAISED, chips RECESSED: tile top edges should catch light', cols: 2, cells: [
    {id: 'wall-src', view: near, light: graze, label: 'SOURCE env-wall-03 GLB as authored (green-down): relief inverted'},
    {id: 'wall-ext', view: near, light: graze, label: 'EXTRACTED wall textures, TextureLoader + PlaneGeometry: correct'},
    {id: 'tunnel-ext', view: {kind: 'persp', dir: [0, 0, 1], zoom: 0.45, grid: false, fov: 25}, light: graze, label: 'extracted tunnel working face (3.6 x 1.38 m)'},
    {id: 'platform-ext', view: {kind: 'persp', dir: [0, 0, 1], zoom: 0.45, grid: false, fov: 25}, light: graze, label: 'extracted platform working face (2.4 x 2.28 m)'},
  ]});
  report.consoleErrors = v.consoleLines.filter(l => /error/i.test(l));
});

fs.writeFileSync(out('qa-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('wrote', path.relative(REPO, out('qa-report.json')), 'console errors:', report.consoleErrors.length);
