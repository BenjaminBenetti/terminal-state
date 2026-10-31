#!/usr/bin/env node
// Task siren-clothing-refit-20261031 (lane FIT): garment-fit checks of Siren GLBs — BEFORE (main's asset) vs AFTER (candidate), bind +
// every clip sampled at --fps (default 10) by CPU glTF skinning of the WRITTEN files (lib/garment-metrics.mjs; definitions there).
//   node tools/asset-pipeline/enemy/qa/siren-fit-checks.mjs --baseline <glb> --candidate <glb> --out <fit-checks.json>
//        [--dress <source GhostDress glb>] [--fps 10]
// The source dress (pinned sha256) provides the region masks in its own native frame, so both assets use identical masks.
// Local evidence tool (needs the staged user upload); nothing here modifies an asset.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSource, singlePrimitive, sha256File} from '../lib/native-glb.mjs';
import {loadRigged} from '../lib/siren-glb.mjs';
import {prepareFit, measureFrame, sampleTimes, summarizeClip, FLOAT_THRESHOLD, DRESS_REGIONS} from '../lib/garment-metrics.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const A = process.argv.slice(2), opt = (f, d) => { const i = A.indexOf(f); return i >= 0 ? A[i + 1] : d; };
const DRESS = {file: path.resolve(REPO, opt('--dress', '.cache/track1-siren-20261031/fbe47869acac46f3a52d808bab79f80a.glb')), sha256: 'aa3e731f0bfd6f1a80c5c0ee56c019f1c0d1625c347c5978db56988fa55a2a8c'};
const FPS = +opt('--fps', 10);
const CLIPS = ['Dormant', 'Rise', 'Run', 'Attack', 'Hit', 'Death'];

async function evaluate(glb, nat) {
  const R = await loadRigged(glb);
  const F = prepareFit(R, {dressNative: nat});
  const bind = measureFrame(F, null, 0);
  const clips = {}, frames = {};
  for (const c of CLIPS) {
    const fr = sampleTimes(R, c, FPS).map(t => measureFrame(F, c, t));
    clips[c] = summarizeClip(fr);
    const st = fr.map(f => f.skinThrough), wst = st.reduce((b, x, k) => (x.fraction > b.x.fraction ? {x, k} : b), {x: st[0], k: 0});
    clips[c].skinThrough = {bindCovered: st[0].bindCovered, maxFraction: wst.x.fraction, atT: fr[wst.k].t, maxUncoveredLeg: Math.max(...st.map(x => x.uncoveredLeg)), maxUncoveredTorso: Math.max(...st.map(x => x.uncoveredTorso)), meanFraction: +(st.reduce((a, x) => a + x.fraction, 0) / st.length).toFixed(4)};
    frames[c] = fr.map(f => ({t: f.t, penGt3mm: f.penetrationTotal.gt3mm, worstMm: f.penetrationTotal.worst.mm, worstRegion: f.penetrationTotal.worst.region ?? null, worstBody: f.penetrationTotal.worst.body ?? null,
      byRegionGt3mm: Object.fromEntries(Object.entries(f.penetration).map(([k, v]) => [k, v.gt3mm])), byBodyGt3mm: Object.values(f.penetration).reduce((a, p) => { for (const [k, v] of Object.entries(p.byBodyRegion)) a[k] = (a[k] ?? 0) + v; return a; }, {}),
      rightBreastCovered: f.coverage.wearerRightBreast.fraction, rightApexCovered: f.coverage.wearerRightBreast.apexZone.fraction, leftBreastCovered: f.coverage.wearerLeftBreast.fraction,
      strapGapP50Mm: f.floating.strap.p50Mm, strapGapP90Mm: f.floating.strap.p90Mm, floatInterior: Object.fromEntries(Object.entries(f.floating).map(([k, v]) => [k, v.overThresholdInterior])), dressMinY: f.floor.dressMinY, dressBelow: f.floor.dressVerticesBelowMinus5mm, skinThrough: f.skinThrough}));
  }
  return {file: path.relative(REPO, glb), sha256: sha256File(glb), bytes: fs.statSync(glb).size, facing: F.facing, breasts: {right: {apex: F.breasts.R.apex, vertices: F.breasts.R.ids.length, apexZone: F.breasts.R.apexZone.length}, left: {apex: F.breasts.L.apex, vertices: F.breasts.L.ids.length, apexZone: F.breasts.L.apexZone.length}},
    skinMask: F.skinMaskInfo, bind: {penetration: bind.penetration, penetrationTotal: bind.penetrationTotal, skinThrough: bind.skinThrough, floating: bind.floating, coverage: bind.coverage, floor: bind.floor}, clips, frames};
}

const t0 = Date.now();
const src = await readSource(DRESS.file, DRESS.sha256);
const nat = singlePrimitive(src.doc, 'dress').prim.getAttribute('POSITION').getArray();
const out = {
  tool: 'tools/asset-pipeline/enemy/qa/siren-fit-checks.mjs', generatedAt: new Date().toISOString(), fps: FPS,
  method: {
    skinThrough: 'torso / leg skin covered by the dress in the asset\'s own bind pose (outward normal ray meets it within 8 cm) whose posed outward ray no longer meets it: skin showing through / out of the cloth',
    skinning: 'CPU glTF linear-blend skinning of the written GLB (lib/siren-glb.mjs jointWorld / skinMesh): the actual skins and the actual six clips',
    axes: 'measured: the body faces +Z (face, bust and toes protrude to +Z about the Head / Chest / Foot joints), +Y up, wearer\'s RIGHT = -X',
    bodySurface: 'closed-skin triangles only (geometric mask: from inside each vertex a ray along -normal first meets the body from inside; hair strands / sheets fail) — hair is not a collision surface',
    penetration: 'dress (welded) vertex signed distance to the closest skin point, sign from the interpolated skin normal, a negative sign confirmed by 6-ray parity; counted when inside by > 3 mm (body chord tolerance); buckets > 10 / 25 mm; by dress region and by the body region (torso / head / arm / leg, dominant skin weight) of the closest point',
    floating: 'gap of fitted regions over thresholds (mm): ' + JSON.stringify(Object.fromEntries(Object.entries(FLOAT_THRESHOLD).map(([k, v]) => [k, v * 1000]))) + '; "interior" excludes open-edge vertices (neckline / tear / armhole / hem boundary + 2 rings) which may lift freely; search radius 80 mm (farther counts as floating)',
    coverage: 'anatomical breast vertex sets from the bind geometry (apex = most forward vertex per side; within 8.5 cm in x/y, <= 6 cm behind, facing forward); covered = the ray along the posed outward skin normal meets the dress within 6 cm; apex zone = within 3 cm of the apex. A coverage fraction is NOT a visual approval.',
    floor: 'lowest dress point per frame; dress vertices below -5 mm (the floor is y = 0)',
    regions: 'dress regions on the SOURCE dress native frame (lib/garment-metrics.mjs dressRegions): ' + DRESS_REGIONS.join(' / '),
    caveat: 'Thresholds are engineering tolerances chosen by lane FIT, not pass / fail gates; open edges, the intended left-side exposure and the skirt hanging free are not defects. Human review decides.'},
  sourceDress: {file: path.relative(REPO, DRESS.file), sha256: src.sha256},
};
for (const [k, f] of [['before', opt('--baseline')], ['after', opt('--candidate')]]) if (f) { console.log(`[${k}] ${f}`); out[k] = await evaluate(path.resolve(f), nat); }
if (out.before && out.after) {
  const cmp = {};
  for (const c of ['bind', ...CLIPS]) {
    const g = (x) => c === 'bind' ? {pen: x.bind.penetrationTotal.gt3mm, depth: x.bind.penetrationTotal.worst.mm, right: x.bind.coverage.wearerRightBreast.fraction, rightApex: x.bind.coverage.wearerRightBreast.apexZone.fraction, left: x.bind.coverage.wearerLeftBreast.fraction, strapP90: x.bind.floating.strap.p90Mm, sink: x.bind.floor.dressMaxSinkM}
      : {pen: x.clips[c].penetration.maxVerticesGt3mm, depth: x.clips[c].penetration.maxDepthMm, right: x.clips[c].coverage.wearerRightBreastMin, rightApex: x.clips[c].coverage.wearerRightApexMin, left: x.clips[c].coverage.wearerLeftBreastMax, strapP90: x.clips[c].strapGapP90MmMax, sink: x.clips[c].floor.dressMaxSinkM};
    cmp[c] = {before: g(out.before), after: g(out.after)};
  }
  out.summary = {legend: {pen: 'max welded dress vertices inside the skin by > 3 mm (any frame)', depth: 'max depth mm', right: 'min fraction of the wearer\'s RIGHT breast covered', rightApex: 'min fraction of its apex zone covered', left: 'max fraction of the LEFT breast covered (intended exposed)', strapP90: 'max per-frame p90 strap gap mm', sink: 'max dress depth below the floor m'}, byClip: cmp};
}
fs.mkdirSync(path.dirname(path.resolve(opt('--out'))), {recursive: true});
fs.writeFileSync(path.resolve(opt('--out')), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.summary?.byClip ?? {}, null, 0));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
