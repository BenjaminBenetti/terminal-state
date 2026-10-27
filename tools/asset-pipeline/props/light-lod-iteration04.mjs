#!/usr/bin/env node
// Iteration 04: corrected low-poly ceiling-fixture derivative (light-lod2.glb) for the ~280 instanced station fixtures.
//
// Diagnosis of iteration 03's light-lod.glb (kept unchanged for history): it was made with meshoptimizer
// simplifySloppy on POSITIONS ONLY over light.glb, whose UVs are a box-projection atlas of ~760 separate charts.
// Sloppy simplification clusters vertices across chart seams and keeps one arbitrary original vertex per cluster,
// so most output triangles take their three UVs from different, unrelated atlas charts: total UV area 32x the atlas
// (light.glb: 0.40), 50% of UV area in triangles stretched >8x the median texel density -> the "mangled" texture.
// light.glb itself is clean (UV area 0.40, no stretched triangles).
//
// Fix: do not decimate a baked atlas. Rebuild from the sha256-verified dense master exactly like the iteration-01
// pipeline (build-props.mjs: geometry-only simplify -> fresh atlas unwrap -> re-bake colour/ORM/normal from the
// dense source), only with a lower triangle target. Same orientation (identity), same 1.2 m length, same top-centre
// origin, so the runtime fit (game.ts fixture dims from the model bbox) is unchanged.
//
// Usage: node tools/asset-pipeline/props/light-lod-iteration04.mjs [targetTris=900]
// Reads public/vision-board/models/<master>.glb (read-only). Writes ONLY game/public/assets/models/light-lod2.glb and
// game/public/assets/derivatives/light-lod-iteration04.json. QA: light-lod-iteration04-qa.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDense, simplifyGeometry, sha256File, sha256Buf} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake} from './lib/bake.mjs';
import {encodeImage, writeMeshGlb} from './lib/glb.mjs';
import {transformPositions, bbox, minAreaYaw} from './lib/orient.mjs';
import {uvMetrics} from './light-lod-iteration04-qa.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(REPO, 'public/vision-board');
const OUT_GLB = path.join(REPO, 'game/public/assets/models/light-lod2.glb');
const OUT_PROV = path.join(REPO, 'game/public/assets/derivatives/light-lod-iteration04.json');
const ID = 'env-light-03';
const TARGET = Number(process.argv[2] ?? 900);
const ATLAS = 1024, PAD = 4, LENGTH_M = 1.2;
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
for (const f of [OUT_GLB, OUT_PROV]) if (fs.existsSync(f) && !process.argv.includes('--overwrite')) throw new Error(`${path.relative(REPO, f)} exists; pass --overwrite to rebuild it`);

const r6 = v => Math.round(v * 1e6) / 1e6;
const modelMap = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'local-model-map.json'), 'utf8'));
const entry = modelMap.models.find(m => m.id === ID);
const srcFile = path.join(SRC_DIR, entry.packagePath);
const srcSha = sha256File(srcFile);
if (srcSha !== entry.sha256) throw new Error(`${ID}: sha256 mismatch ${srcSha} != ${entry.sha256}`);
const t0 = Date.now();
console.log(`${ID} <- ${path.relative(REPO, srcFile)} (sha256 verified)`);

const dense = await loadDense(srcFile);
const yaw = minAreaYaw(transformPositions(dense.P, IDENT));
if (Math.abs(yaw) >= 0.3) throw new Error(`unexpected min-area yaw ${yaw} (iteration-01 light.glb applied none)`);
const simp = await simplifyGeometry(dense, TARGET);
console.log(`simplified ${dense.stats.triangles} -> ${simp.idx.length / 3} tris, error ${simp.errorAbsolute.toExponential(3)} source units`);
const low = unwrap(simp.pos, simp.idx, {atlas: ATLAS, pad: PAD});
console.log(`unwrap: ${low.stats.charts} charts, fill ${(low.stats.chartAreaFraction * 100).toFixed(1)}%`);
const searchRadius = Math.max(0.02, 6 * simp.errorAbsolute);
const baked = await bake(dense, low, {atlas: ATLAS, supersample: 2, mrDiv: 2, normalDiv: 2, searchRadius, log: s => console.log('  ', s)});

const bb0 = bbox(low.pos);
const s = LENGTH_M / bb0.size[0];
const bbS = bbox(transformPositions(low.pos, IDENT, s));
const t = [-bbS.center[0], -bbS.max[1], -bbS.center[2]];
const pos = transformPositions(low.pos, IDENT, s, t);
const nrm = Float32Array.from(low.nrm);
const idx = Uint32Array.from(low.idx);
const outBB = bbox(pos);
const qa = uvMetrics(pos, low.uv, idx);
if (qa.uvAreaSum > 1 || qa.uvRange[0] < 0 || qa.uvRange[1] > 1 || qa.trianglesStretched8xMedian > idx.length / 300) throw new Error(`atlas check failed ${JSON.stringify(qa)}`);

const color = await encodeImage(baked.color.data, baked.color.size, baked.color.size, 'color');
const orm = await encodeImage(baked.mr.data, baked.mr.size, baked.mr.size, 'orm');
const normal = await encodeImage(baked.normal.data, baked.normal.size, baked.normal.size, 'normal');
const glb = await writeMeshGlb({
  name: 'light', mesh: {pos, nrm, uv: low.uv, idx}, textures: {color, orm, normal}, material: dense.material,
  extras: {sourceId: ID, uploadId: entry.uploadId, sourceSha256: srcSha, units: 'meters', provisionalDimensionsMeters: outBB.size.map(r6), status: 'prototype runtime LOD derivative of an unapproved AI-reconstructed master; gameReady false', pipeline: 'tools/asset-pipeline/props/light-lod-iteration04.mjs'},
});
fs.writeFileSync(OUT_GLB, glb);
const ref = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/props.json'), 'utf8')).outputs.find(o => o.key === 'light');
const prov = {
  schema: 'last-line-derivative/1', asset: 'light-lod2', task: 'studio-slice-iteration04-20261026-01', status: 'prototype; unapproved; gameReady false',
  replaces: {runtimeKey: 'light', previous: 'assets/models/light-lod.glb (iteration 03; file kept unchanged, no longer referenced by the manifest)'},
  diagnosis: {
    symptom: 'User feedback iteration 04: "Overhead lights textures look messed up / mangled".',
    cause: 'light-lod.glb = meshoptimizer simplifySloppy on positions only over light.glb. light.glb UVs are a ~760-chart box-projection atlas; sloppy clustering merges vertices across chart seams and reuses one arbitrary original vertex (with its UV) per cluster, so output triangles sample unrelated atlas charts.',
    measured: {'light.glb (iteration 01)': {triangles: 2992, uvAreaSum: 0.3994, trianglesStretched8xMedian: 0, verdict: 'clean bake/atlas'}, 'light-lod.glb (iteration 03)': {triangles: 670, uvAreaSum: 32.1073, trianglesStretched8xMedian: 129, stretchedUvAreaFraction: 0.5026, referencedVertices: 165, storedVertices: 4423, verdict: 'mangled: triangles span multiple atlas charts; unused vertices also kept'}},
    evidence: 'qa-artifacts/assets/light-lod-iteration04/compare.png + metrics.json (CPU renders: front, below 3/4, straight below)',
  },
  source: {id: ID, uploadId: entry.uploadId, path: path.relative(REPO, srcFile), sha256: srcSha, sha256Verified: true, bytes: fs.statSync(srcFile).size, triangles: dense.stats.triangles, reviewStatus: 'unapproved', gameReady: false, note: 'same dense master as iteration-01 light.glb; read-only'},
  output: {file: 'assets/models/light-lod2.glb', sha256: sha256Buf(glb), bytes: glb.length, triangles: idx.length / 3, vertices: pos.length / 3,
    textures: {baseColor: [baked.color.size, baked.color.size], metallicRoughness: [baked.mr.size, baked.mr.size], normal: [baked.normal.size, baked.normal.size]},
    bboxMeters: {min: outBB.min.map(r6), max: outBB.max.map(r6), size: outBB.size.map(r6)}, comparedTo: {file: 'assets/models/light.glb', bboxSize: ref?.dimensionsMeters?.bbox?.size ?? null}},
  conventions: {units: 'meters', front: '+Z', up: '+Y', origin: 'top centre (y=0 is the top/mounting face; fixture hangs down to negative y; x/z bbox centre)', transform: `identity orientation (as light.glb), uniform scale ${r6(s)} to ${LENGTH_M} m length, translation ${t.map(r6)}`},
  steps: [
    {step: 'verify-source', detail: 'sha256 vs public/vision-board/local-model-map.json'},
    {step: 'simplify', tool: 'lib/dense.mjs simplifyGeometry (meshoptimizer simplify, Permissive, weld by position)', options: {targetTriangles: TARGET, targetError: 1.0}, resultTriangles: idx.length / 3, errorMeters: r6(simp.errorAbsolute * s), droppedDegenerate: simp.droppedDegenerate},
    {step: 'unwrap', tool: 'lib/unwrap.mjs (fresh box-projection atlas; no UV reused from light.glb)', options: {atlas: ATLAS, paddingPx: PAD}, stats: {charts: low.stats.charts, chartAreaFraction: r6(low.stats.chartAreaFraction)}},
    {step: 'bake', tool: 'lib/bake.mjs (closest same-facing dense-source surface; colour, packed metallic-roughness, tangent-space normal)', options: {supersample: 2, mrDiv: 2, normalDiv: 2, searchRadiusSourceUnits: r6(searchRadius)}},
    {step: 'qa', tool: 'light-lod-iteration04-qa.mjs uvMetrics', result: qa},
    {step: 'encode', detail: 'baseColor JPEG q86 4:4:4, metallicRoughness JPEG q90, normal PNG; plain glTF 2.0 binary'},
  ],
  limitations: [
    'Source is an unapproved AI reconstruction; inferred hidden surfaces. Prototype derivative, not approved art, no license clearance asserted.',
    `Simplified from ${dense.stats.triangles} to ${idx.length / 3} triangles (max error ~${(simp.errorAbsolute * s * 1000).toFixed(1)} mm); small fasteners/strap relief survive only in the baked normal/colour maps.`,
    'Provisional 1.2 m length chosen in iteration 01, not measured/approved.',
  ],
};
fs.writeFileSync(OUT_PROV, JSON.stringify(prov, null, 2) + '\n');
console.log(JSON.stringify({triangles: idx.length / 3, vertices: pos.length / 3, bytes: glb.length, bbox: outBB.size.map(r6), qa, seconds: (Date.now() - t0) / 1000}));
