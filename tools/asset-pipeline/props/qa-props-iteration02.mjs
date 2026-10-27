#!/usr/bin/env node
// Quick orientation/visual renders for the iteration02 props (turnstile, crate). Firefox CPU WebGL via the shared viewer.
// Usage: node tools/asset-pipeline/props/qa-props-iteration02.mjs native|derived [turnstile,supply-crate]
// Writes PNG sheets to qa-artifacts/assets/props-iteration02/ only.
import fs from 'node:fs';
import path from 'node:path';
import {withViewer, REPO} from './qa/browser.mjs';

const mode = process.argv[2] ?? 'derived';
const which = (process.argv[3] ?? 'turnstile,supply-crate').split(',');
const OUTDIR = path.join(REPO, 'qa-artifacts/assets/props-iteration02');
fs.mkdirSync(OUTDIR, {recursive: true});
const GEN = '/reference/tasks/vertical-slice-iteration02-20261025/generation';
const derived = {turnstile: '/game/public/assets/models/turnstile.glb', 'supply-crate': '/game/public/assets/models/crate.glb'};
await withViewer(async v => {
  for (const a of which) {
    const url = mode === 'native' ? `${GEN}/${a}/native/asset.glb` : derived[a];
    const info = await v.load(a, url);
    console.log(a, mode, 'tris', info.tris, 'errors', info.errors.length);
    const cells = mode === 'native'
      ? ['+z', '-z', '+x', '-x', '+y'].map(axis => ({id: a, view: {kind: 'ortho', axis}, label: `native ortho from ${axis}`})).concat([{id: a, view: {kind: 'persp', dir: [0.8, 0.55, 1]}, label: 'persp from +x+y+z'}])
      : [{id: a, view: {kind: 'ortho', axis: '+z'}, label: 'front (+Z), 0.1 m grid'}, {id: a, view: {kind: 'ortho', axis: '+x'}, label: 'side (+X)'},
         {id: a, view: {kind: 'ortho', axis: '+y'}, label: 'top (+Y); +Z is image-down'}, {id: a, view: {kind: 'persp', dir: [0.8, 0.55, 1]}, label: '3/4 front-right'},
         {id: a, view: {kind: 'persp', dir: [-0.8, 0.5, -1]}, label: '3/4 back-left (inferred)'}, {id: a, view: {kind: 'persp', dir: [-0.9, 0.5, 0.9]}, label: '3/4 front-left'}];
    await v.sheet({title: `${a} ${mode} (${url})`, cols: 3, cells}, path.join(OUTDIR, `${a}-${mode}.png`));
    await v.dispose(a);
  }
  const errs = v.consoleLines.filter(l => /error/i.test(l));
  if (errs.length) console.log('console errors:', errs.slice(0, 5));
});
