#!/usr/bin/env node
// Task siren-clothing-refit-20261031 (lane FIT): labelled CPU fit sheets of the Siren dress, BEFORE (main's asset) vs AFTER (the
// refit candidate) — the actual written GLBs, CPU glTF skinning of their own skins / clips (lib/siren-fit-render.mjs; not the game's
// PBR, not a browser / GPU). Anatomical labels: the body faces +Z (measured), wearer's RIGHT = -X = screen-LEFT in the front view.
//   node tools/asset-pipeline/enemy/qa/siren-fit-sheets.mjs --baseline <glb> --candidate <glb> --out <dir>
//        [--dress <source GhostDress glb>]   (the source dress gives the identical region masks for the red overlays)
// Writes: pair-fullbody.png, pair-chest.png, candidate-fullbody.png, candidate-chest.png, candidate-strap-hair-hidden.png,
//   candidate-clips-{front,threeQuarterRight,wearerLeft}.jpg, baseline-clips-threeQuarterRight.jpg, worst-skin-through.jpg,
//   worst-dress-inside.jpg, floor-sink.jpg, sections.png (horizontal cross-sections, body vs dress).
import path from 'node:path';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {readSource, singlePrimitive} from '../lib/native-glb.mjs';
import {jointWorld, skinMesh} from '../lib/siren-glb.mjs';
import {prepareFit, measureFrame, skinMask} from '../lib/garment-metrics.mjs';
import {loadForRender, posed, pitched, renderSheet, VIEWS} from '../lib/siren-fit-render.mjs';
import {TriGrid, weldMap, weldedNormals} from '../../zombie/lib/penetration.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const A = process.argv.slice(2), opt = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const OUT = path.resolve(opt('--out'));
const DRESS = path.resolve(REPO, opt('--dress', '.cache/track1-siren-20261031/fbe47869acac46f3a52d808bab79f80a.glb'));
const nat = singlePrimitive((await readSource(DRESS, 'aa3e731f0bfd6f1a80c5c0ee56c019f1c0d1625c347c5978db56988fa55a2a8c')).doc, 'dress').prim.getAttribute('POSITION').getArray();
const base = await loadForRender(path.resolve(opt('--baseline')), 1024), cand = await loadForRender(path.resolve(opt('--candidate')), 1024);
const LBL = {base: 'BASELINE (main 4ac5d8ca, Track1 uniform fit)', cand: 'CANDIDATE (garment-only refit)'};
const note = 'CPU ortho, base colour + Lambert (not game PBR / GPU)';
const landmarks = [{y: 1.335, label: 'breast top 1.335', color: 'rgba(255,200,90,0.7)'}, {y: 1.257, label: 'apex 1.257', color: 'rgba(255,120,120,0.7)'}, {y: 1.16, label: 'under-bust 1.16', color: 'rgba(120,230,200,0.7)'}];
const hairOf = X => { const b = X.R.meshes.find(m => m.name === 'SirenBody'); return Uint8Array.from(skinMask(skinMesh(b, jointWorld(X.R, null)), b.idx).skin, v => 1 - v); };
const files = [];
const SHORT = {front: 'FRONT', back: 'BACK', wearerLeft: "WEARER'S LEFT side", wearerRight: "WEARER'S RIGHT side", threeQuarterRight: '3/4 FRONT-RIGHT', threeQuarterLeft: '3/4 FRONT-LEFT'};
const sheet = async (panels, name, o) => { files.push((await renderSheet(panels, path.join(OUT, name), o)).file); };

// 1. pairs (bind): full body front / 3-4 right / wearer's right; chest front / 3-4 right / wearer's right / back
{
  const B = posed(base, null, 0), C = posed(cand, null, 0);
  const views = ['front', 'threeQuarterRight', 'wearerRight', 'wearerLeft'];
  await sheet(views.flatMap(v => [[B, 'base'], [C, 'cand']].map(([M, k]) => ({view: v, title: `${k === 'base' ? 'BEFORE' : 'AFTER'} · ${SHORT[v]}`, meshes: M, cam: {cx: 0, cy: 0.88, height: 1.86}, floorY: 0, lines: [LBL[k], note]}))),
    'pair-fullbody.png', {w: 300, h: 600, cols: 8, title: 'Siren dress — BEFORE (left of each pair) vs AFTER (right), bind pose, same body / camera'});
  await sheet(['front', 'threeQuarterRight', 'wearerRight', 'back'].flatMap(v => [[B, 'base'], [C, 'cand']].map(([M, k]) => ({view: v, title: `${k === 'base' ? 'BEFORE' : 'AFTER'} · ${SHORT[v]}`, meshes: M, cam: {cx: 0, cy: 1.2, height: 0.62}, guides: landmarks, lines: [LBL[k], note]}))),
    'pair-chest.png', {w: 360, h: 420, cols: 4, title: 'Chest / strap / underarm — BEFORE vs AFTER (bind); dashed = body landmarks; the right breast is on screen-LEFT in front views'});
  await sheet(['front', 'back', 'wearerLeft', 'wearerRight', 'threeQuarterRight', 'threeQuarterLeft'].map(v => ({view: v, meshes: C, cam: {cx: 0, cy: 0.88, height: 1.86}, floorY: 0, lines: [LBL.cand, note]})),
    'candidate-fullbody.png', {w: 360, h: 700, cols: 6, title: 'AFTER: refitted dress, bind pose, anatomical views (body faces +Z; wearer\'s RIGHT = -X)'});
  await sheet(['front', 'threeQuarterRight', 'wearerRight', 'back', 'wearerLeft', 'threeQuarterLeft'].map(v => ({view: v, meshes: C, cam: {cx: 0, cy: 1.2, height: 0.56}, guides: landmarks, lines: [LBL.cand, note]})),
    'candidate-chest.png', {w: 400, h: 460, cols: 3, title: 'AFTER: chest / strap / underarm / waist close-ups (bind)'});
  const H = posed(cand, null, 0, {hairMask: hairOf(cand)});
  await sheet([
    {view: 'front', meshes: H, cam: {cx: -0.05, cy: 1.3, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
    {view: 'threeQuarterRight', meshes: H, cam: {cx: -0.05, cy: 1.3, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
    {view: 'wearerRight', meshes: H, cam: {cx: 0, cy: 1.3, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
    {view: 'back', meshes: H, cam: {cx: 0.05, cy: 1.3, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
    {title: 'FROM ABOVE-FRONT (pitch 55 deg)', tags: {left: "wearer's RIGHT", right: "wearer's LEFT"}, meshes: pitched(H, {yawDeg: 0, pitchDeg: 55, cx: -0.06, cy: 1.35}), cam: {yawDeg: 0, cx: 0, cy: 0, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
    {title: 'FROM ABOVE-RIGHT (camera -X, pitch 55 deg)', tags: {left: 'her BACK', right: 'her FRONT'}, meshes: pitched(H, {yawDeg: 270, pitchDeg: 55, cx: -0.1, cy: 1.35}), cam: {yawDeg: 0, cx: 0, cy: 0, height: 0.5}, lines: ['HAIR HIDDEN (technical view)']},
  ], 'candidate-strap-hair-hidden.png', {w: 420, h: 420, cols: 3, title: 'AFTER: strap on the wearer\'s RIGHT shoulder, hair hidden (technical; the hair covers it in game)'});
}
// 2. clip sheets (actual clips)
const POSES = [['Dormant', 0], ['Dormant', 2.0], ['Rise', 0.3], ['Rise', 0.6], ['Rise', 1.0], ['Run', 0.0], ['Run', 0.15], ['Run', 0.3], ['Run', 0.45], ['Attack', 0.28], ['Attack', 0.4], ['Attack', 0.6], ['Hit', 0.1], ['Death', 0.6], ['Death', 1.2], ['Death', 1.8]];
for (const [X, k, views] of [[cand, 'candidate', ['front', 'threeQuarterRight', 'wearerLeft']], [base, 'baseline', ['threeQuarterRight']]]) for (const v of views) {
  await sheet(POSES.map(([c, t]) => ({view: v, title: `${c} t=${t.toFixed(2)} s`, meshes: posed(X, c, t), cam: {cx: 0, cy: 0.85, height: 1.9}, floorY: 0, lines: [`${k} · ${v}`]})),
    `${k}-clips-${v}.jpg`, {w: 260, h: 340, cols: 8, title: `${k === 'candidate' ? LBL.cand : LBL.base}: actual clips (CPU skinning of the written GLB), ${VIEWS[v].label}; floor line y = 0`});
}
// 3. worst frames (candidate): skin through, dress inside the skin, floor
{
  const F = prepareFit(cand.R, {dressNative: nat});
  const {remap} = weldMap(nat);
  const throughPanels = [], insidePanels = [];
  for (const [c, t] of [['Run', 0.4], ['Dormant', 0.4], ['Attack', 0.5], ['Rise', 0.6]]) {
    const M = posed(cand, c, t), B = M[0].pos, D = M[1].pos;
    const BN = weldedNormals(B, F.nonHairIdx, F.bodyRemap), dg = new TriGrid(D, F.dress.idx, 0.03), bad = new Uint8Array(B.length / 3); let n = 0;
    const badW = new Set();
    for (const i of F.coveredBind) { const nx = BN[i * 3], ny = BN[i * 3 + 1], nz = BN[i * 3 + 2]; if (!dg.ray(B[i * 3] + nx * 0.0015, B[i * 3 + 1] + ny * 0.0015, B[i * 3 + 2] + nz * 0.0015, nx, ny, nz, 0.08)) { n++; badW.add(F.bodyRemap[i]); } }
    for (let j = 0; j < bad.length; j++) if (badW.has(F.bodyRemap[j])) bad[j] = 1;
    const I = F.body.idx, red = []; for (let k = 0; k < I.length; k += 3) if (bad[I[k]] || bad[I[k + 1]] || bad[I[k + 2]]) red.push(I[k], I[k + 1], I[k + 2]);
    for (const v of ['front', 'wearerRight']) throughPanels.push({view: v, title: `${c} t=${t.toFixed(2)} · ${n} skin verts through`, meshes: [...M, {pos: B, idx: Uint32Array.from(red), color: [255, 40, 40], zBias: 0.002}], cam: {cx: 0, cy: 0.8, height: 1.75}, floorY: 0, lines: ['red = skin covered in bind, uncovered here']});
    const m = measureFrame(F, c, t, {withVertex: true});
    const DI = F.dress.idx, red2 = []; for (let k = 0; k < DI.length; k += 3) if ([DI[k], DI[k + 1], DI[k + 2]].some(v => m.sd[remap[v]] < -0.010)) red2.push(DI[k], DI[k + 1], DI[k + 2]);
    const dressOnly = [{...M[1], tex: null, color: [150, 200, 240]}, {pos: D, idx: Uint32Array.from(red2), color: [255, 30, 30], zBias: 0.0005}];
    for (const v of ['front', 'wearerLeft']) insidePanels.push({view: v, title: `${c} t=${t.toFixed(2)} · DRESS ONLY · >3mm: ${m.penetrationTotal.gt3mm}`, meshes: dressOnly, cam: {cx: 0, cy: 0.8, height: 1.75}, floorY: 0, lines: ['red = dress inside the skin by > 10 mm (body hidden)']});
  }
  await sheet(throughPanels, 'worst-skin-through.jpg', {w: 300, h: 420, cols: 8, title: 'AFTER, worst frames: bind-covered skin showing through / out of the dress (red, drawn on top)'});
  await sheet(insidePanels, 'worst-dress-inside.jpg', {w: 300, h: 420, cols: 8, title: 'AFTER, worst frames: where the dress is inside the skin (red; mostly hem / fringe vs bent knees and the skirt between the thighs)'});
  const floorPanels = [];
  for (const [X, k] of [[base, 'BEFORE'], [cand, 'AFTER']]) for (const [c, t] of [['Dormant', 0], ['Death', 1.1], ['Death', 1.6], ['Rise', 0.3]]) {
    const M = posed(X, c, t), D = M[1].pos;
    let lo = 0; for (let i = 1; i < D.length; i += 3) if (D[i] < D[lo * 3 + 1]) lo = (i - 1) / 3; // centre on the dress's lowest point
    for (const v of ['wearerLeft']) floorPanels.push({view: v, title: `${k} · ${c} t=${t} · dress min y ${D[lo * 3 + 1].toFixed(3)} m`, meshes: M, cam: {cx: 0, cz: D[lo * 3 + 2], cy: 0.22, height: 0.8}, floorY: 0, guides: [{y: -0.05, label: '-5 cm', color: 'rgba(255,90,90,0.6)'}, {y: -0.15, label: '-15 cm', color: 'rgba(255,90,90,0.6)'}], lines: [k === 'BEFORE' ? LBL.base : LBL.cand, 'no floor slab drawn (below white line = below floor)']});
  }
  await sheet(floorPanels, 'floor-sink.jpg', {w: 380, h: 380, cols: 4, title: 'Dress below the floor (y = 0, white line), BEFORE (top) vs AFTER (bottom): kneeling Dormant, prone Death, Rise start — wearer\'s LEFT side camera'});
}
// 4. horizontal sections, body (skin grey / hair red) vs dress (cyan), BEFORE vs AFTER
{
  const ys = [1.30, 1.24, 1.18, 1.12, 1.04, 0.95, 0.86, 0.70];
  const cw = 240, ch = 240, sc = 520, rows = 2, Wd = cw * ys.length, Ht = ch * rows + 30;
  const img = Buffer.alloc(Wd * Ht * 3, 20), svg = [`<text x="8" y="21" font-family="DejaVu Sans" font-size="15" font-weight="bold" fill="#fff">Horizontal sections (bind): body skin grey, hair red, dress cyan — top row BEFORE, bottom row AFTER (front +Z up; wearer's RIGHT = -X = left; grid 0.1 m)</text>`];
  for (const [r, X] of [[0, base], [1, cand]]) {
    const W = jointWorld(X.R, null), b = X.R.meshes.find(m => m.name === 'SirenBody'), d = X.R.meshes.find(m => m.name === 'SirenDress');
    const B = skinMesh(b, W), D = skinMesh(d, W), S = skinMask(B, b.idx).skin;
    ys.forEach((y, k) => {
      const ox = k * cw, oy = 30 + r * ch;
      const put = (x, z, c) => { const px = Math.round(ox + cw / 2 + x * sc), py = Math.round(oy + ch / 2 - z * sc); if (px >= ox && px < ox + cw && py >= oy && py < oy + ch) img.set(c, (py * Wd + px) * 3); };
      const slice = (P, I, colorOf) => { for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]]; for (let e = 0; e < 3; e++) { const a = v[e], bb = v[(e + 1) % 3], ya = P[a * 3 + 1], yb = P[bb * 3 + 1]; if ((ya - y) * (yb - y) > 0 || ya === yb) continue; const u = (y - ya) / (yb - ya); put(P[a * 3] + u * (P[bb * 3] - P[a * 3]), P[a * 3 + 2] + u * (P[bb * 3 + 2] - P[a * 3 + 2]), colorOf(a, bb)); } } };
      slice(B, b.idx, (p, q) => (S[p] && S[q] ? [215, 215, 215] : [230, 60, 60]));
      slice(D, d.idx, () => [60, 220, 240]);
      for (let g = -0.2; g <= 0.2001; g += 0.1) svg.push(`<line x1="${ox + cw / 2 + g * sc}" y1="${oy}" x2="${ox + cw / 2 + g * sc}" y2="${oy + ch}" stroke="#333"/><line x1="${ox}" y1="${oy + ch / 2 - g * sc}" x2="${ox + cw}" y2="${oy + ch / 2 - g * sc}" stroke="#333"/>`);
      svg.push(`<rect x="${ox}" y="${oy}" width="${cw}" height="${ch}" fill="none" stroke="#666"/><text x="${ox + 5}" y="${oy + 15}" font-family="DejaVu Sans" font-size="12" fill="#fff">${r ? 'AFTER' : 'BEFORE'} y = ${y.toFixed(2)} m</text>`);
    });
  }
  const f = path.join(OUT, 'sections.png');
  await sharp(img, {raw: {width: Wd, height: Ht, channels: 3}}).composite([{input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}">${svg.join('')}</svg>`), top: 0, left: 0}]).png().toFile(f);
  files.push(f);
}
console.log(files.map(f => path.relative(REPO, f)).join('\n'));
