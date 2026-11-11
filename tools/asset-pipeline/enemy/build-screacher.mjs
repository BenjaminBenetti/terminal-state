#!/usr/bin/env node
// Terminal State - SCREACHER enemy derivative builder (task studio-screacher-production-20261110-221858-01, lane RIG). CPU
// only: no generation, inference, network or GPU. Single reproducible entry point (mirrors enemy/build-strainer.mjs):
//   flock /tmp/ll-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-screacher.mjs [--only sc04[,sc01]] [--no-write]
//   QA sheets:  node tools/asset-pipeline/enemy/qa/screacher-sheets.mjs   (renders the WRITTEN GLBs)
// The Screacher is ONE enemy with FOUR approved bodies (sc01 Hollow Commuter, sc02 Track Ganger, sc03 Lopsided Sleeper, sc04
// Long-Stride Runner): headless lanky humanoids. Reads the four READ-ONLY accepted Meshy T2.5 image-to-3D masters (private raw
// store outside Git: SCREACHER_RAW_DIR or the task's private masters folder; each sha256 + byte count pinned below and
// re-verified after the build) and writes ONLY:
//   game/public/assets/models/enemy-screacher-<v>.glb
//   game/public/assets/derivatives/enemy-screacher-<v>.json     (hash-only public provenance: no private path, URL or prompt)
//   game/public/assets/CREDITS.md          the marked enemy-screacher section only (rewritten in place)
//   tools/release/public-inputs.json       only this builder's output entries + CREDITS.md (whose bytes change)
// It does NOT touch the zombie wardrobe or any other enemy (no BODIES entry; never picked as an ordinary zombie body).
//
// Pipeline (the humanoid libs in tools/asset-pipeline/zombie/lib are used unchanged):
//   1. placement: facing (autorig.detectFacing), uniform scale so floor -> top of the neck stump is OPTIONS.heightM, feet
//      midpoint at the origin, +Z facing;
//   2. skeleton: lib/screacher-skeleton.mjs on the welded mesh (the shared 18-joint skeleton measured with headless /
//      relaxed-pose rules; `Neck` = the base of the stump, `Head` = a technical joint under its top; the bind pose is the
//      pose as generated: no re-posing);
//   3. mesh: the Meshy smart-topology mesh, its UVs and its 2K PBR maps are KEPT (no simplify / re-UV / re-bake / repaint;
//      the stump stays open as generated); textures re-encoded for size only (base colour 2048 JPEG, metallic-roughness +
//      normal 1024 JPEG 4:4:4);
//   4. skin: lib/screacher-skin.mjs (topology arm / leg labels, position chain weights, masked Laplacian smoothing), top 4;
//   5. clips: lib/screacher-clips.mjs (Idle, Walk, Run, Attack, Hit, Death, Scream; one contract for the four variants, each
//      sampled with its own rig): death pose floor-solved (no head term), Attack lunge solved to the contract reach, floor
//      guard on Attack / Hit / Death, CPU-skinned verification (floor, planted feet, skating, reach at the hit frame, limb
//      clearance, triangle stretch);
//   6. GLB (gltf-transform; KHR_mesh_quantization normals) + scene extras `enemyScreacher` + sidecar provenance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadSource} from '../zombie/lib/source.mjs';
import {detectFacing, placement, validateSkeleton} from '../zombie/lib/autorig.mjs';
import {placeHigh} from '../zombie/lib/stage-mesh.mjs';
import {bounds, normalizeAll, components} from '../zombie/lib/mesh.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {Rig, V, qAxis, qRot as qRotate} from '../zombie/lib/pose.mjs';
import {quantizeWeights, writeDoc, geometryHash} from '../zombie/lib/variant-glb.mjs';
import {auditPoses, triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {TriGrid} from '../zombie/lib/penetration.mjs';
import {detectScreacherSkeleton, SKELETON_OPTIONS} from './lib/screacher-skeleton.mjs';
import {computeScreacherSkin, JOINT_NAMES} from './lib/screacher-skin.mjs';
import {CLIP_SPECS, ATTACK, FPS, sampleClip, poseAt, poseAtTime, evalClip, solveScreacherDeath, floorReport, deathFinalPose, bindArm} from './lib/screacher-clips.mjs';

const ARGV = process.argv.slice(2);
const flag = n => ARGV.includes(n);
const opt = n => { const i = ARGV.indexOf(n); return i >= 0 ? ARGV[i + 1] : null; };
const TASK = 'studio-screacher-production-20261110-221858-01';
const RAW_DIR = process.env.SCREACHER_RAW_DIR ? path.resolve(process.env.SCREACHER_RAW_DIR) : path.join(REPO, 'reference/tasks/screacher-production-20261110-221858/gen/masters');
const GENERATOR = 'Terminal State Screacher enemy derivative builder (tools/asset-pipeline/enemy/build-screacher.mjs)';
const CREDITS = path.join(REPO, 'game/public/assets/CREDITS.md');
const ALLOW = path.join(REPO, 'tools/release/public-inputs.json');
const CREDITS_BEGIN = '<!-- BEGIN enemy-screacher-20261110 (build-screacher.mjs) -->';
const CREDITS_END = '<!-- END enemy-screacher-20261110 -->';
/** Dev only: write the GLB + sidecar into this folder instead of game/public (no CREDITS / allowlist update). */
const DEV_OUT = opt('--out-dir') ? path.resolve(opt('--out-dir')) : null;
const outGlb = v => DEV_OUT ? path.join(DEV_OUT, `enemy-screacher-${v}.glb`) : path.join(REPO, `game/public/assets/models/enemy-screacher-${v}.glb`);
const outJson = v => DEV_OUT ? path.join(DEV_OUT, `enemy-screacher-${v}.json`) : path.join(REPO, `game/public/assets/derivatives/enemy-screacher-${v}.json`);

/**
 * The four accepted Meshy T2.5 image-to-3D bodies (one paid attempt each, accepted by the task lead), pinned by hash. Public
 * provenance is HASH-ONLY: the raw GLBs, the provider's map files and the conditioning images live in a private raw store.
 */
const RECIPE = {tool: 'meshy_image_to_3d (Meshy MCP)', ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 20000, target_formats: ['glb']};
export const VARIANTS = [
  {v: 'sc01', id: 'SC01', name: 'Hollow Commuter', look: 'a headless commuter in a torn suit jacket, shirt and tie', meshyTaskId: '01a1c79e-a37b-7105-bfd5-f5ccc500aa07', poseMode: null,
    raw: {sha256: '3a3534a9f4d9e29b88232d0dbfb1b362b98d3e0832561927520582e80028da38', bytes: 7884036}, inputImageSha256: '41036303086b66d1260d507c92b4a718c199c08be053ff15014e71dec0eb0899',
    providerMaps: {base_color: {bytes: 5008137, sha256: '6c4670e51e68bd661fb191983db9d03a78d865e0712d7ffb616dd6eb014808db'}, metallic: {bytes: 52411, sha256: '7017b4d6775af51be3ed2f9dcaaa06c59f23d4c35bb0c78a6405907ae4c33658'}, roughness: {bytes: 1244760, sha256: '697c2657b5dc80a334695a83c4b5e7d57c40f5471b2dee269bc5206ab4fd3954'}, normal: {bytes: 4725172, sha256: '08baf9162d3124d11267f9b3db99dbc94f6923f9a0bc10cb3d63dc2bcd14a0a1'}}},
  {v: 'sc02', id: 'SC02', name: 'Track Ganger', look: 'a headless track worker in orange hi-vis coveralls and work boots', meshyTaskId: '01a1c79e-ab85-767c-bb51-d32482b9d9cf', poseMode: null,
    raw: {sha256: 'ee5c45c168cb04ea54f16804ece9d38b31e8ef555bedf53c71d3dd9b904a14ff', bytes: 8076608}, inputImageSha256: '35bf827b54a8afcea6012dc52db6a432a09ffb7bdd758444e474d2846c6ab494',
    providerMaps: {base_color: {bytes: 4885863, sha256: '1acb4d60a05a8c0dd0f27e9d171d941ff355fda2cc1f85cac29e9e0773faf95b'}, metallic: {bytes: 25136, sha256: 'dd0cf6e415f58b72ff47d59536e40834f9dea6b5fd47c535160986b20b8c54af'}, roughness: {bytes: 1308842, sha256: '8d0f35bf73bf8424eaecbaa2a40e8d28cc2d2bb402bd3355b97ae07568fc77a9'}, normal: {bytes: 4547730, sha256: '2dcf6452d0778df1c3b48a52ea39aa2698229cbb43606d8b304180b7daeb4078'}}},
  {v: 'sc03', id: 'SC03', name: 'Lopsided Sleeper', look: 'a headless, lopsided sleeper in a vest and striped pyjama trousers, barefoot', meshyTaskId: '01a1c79e-b350-7726-8c6b-9ed1cccd1ef8', poseMode: null,
    raw: {sha256: '2f303e252fc93a933f96b34a3d6231923ef740f210d4a7ecf28119af89e4deb6', bytes: 7945016}, inputImageSha256: 'a85122e76c7bf99aa8568a8f03ecd81503c3b8a61db95672360871eafe97754e',
    providerMaps: {base_color: {bytes: 4514046, sha256: '5302ef84ac929559f7a560a84b558ecf2a547bb37a023dae17bf8dd406664914'}, metallic: {bytes: 22863, sha256: '2878f1874585e350ed2b6b73f1ccb7899aa7e97db0d406eb054fc644da954735'}, roughness: {bytes: 1122981, sha256: '2b74b85777b6d4c305ec9f7ef3b4d163a2878c811f90a9ba6376c578dc613e43'}, normal: {bytes: 4542952, sha256: 'af89b3c706fd2aaadfa92f834395e5e9a7a8fa858d7eb4094c40b2225c8846f9'}}},
  {v: 'sc04', id: 'SC04', name: 'Long-Stride Runner', look: 'a headless runner in a track jacket, shorts and trainers', meshyTaskId: '01a1c79d-2dc8-7345-b577-f12daca5f86f', poseMode: 't-pose',
    raw: {sha256: '4b25e46ac6cff7470ae4864d9270d310e998442b4541c313b8e0decd8dd9a772', bytes: 8425072}, inputImageSha256: 'b105ea7cf585dac7f38484c286430a04b123f1e4443dcdc7e538b57bbb1991a9',
    providerMaps: {base_color: {bytes: 4791966, sha256: 'f5ca30bfac12bfc1cabc3bead3ba5d33878ce7f4a58accde308c0d832c430c60'}, metallic: {bytes: 49073, sha256: '55da43723ac9b3a1c61fffe46879bd55773ea6f18937dcc45ba7655c5538120f'}, roughness: {bytes: 1310504, sha256: '2a65c0cd50735f48badd3b70651fd4317e76f8fae3237d6fe2be5665947f1144'}, normal: {bytes: 4822897, sha256: '10cafae4eb28b6e8b138c102eb0c6eef837adefd045aea4809bc087960a2f018'}}},
];

export const OPTIONS = {
  heightM: 2.0, // contract: floor -> top of the neck stump (a little taller than the 1.78 m zombie; runtime root scale multiplies)
  textures: {baseColor: 2048, metallicRoughness: 1024, normal: 1024, quality: {base: 86, mr: 88, normal: 92}},
  collider: {radius: 0.34, narrowestOpeningM: 1.0}, // contract radius (the lanky torso / hip core; the hanging arms swing outside it)
  maxBytes: 3_200_000,
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const r3 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(3)) : +(+v).toFixed(3);
const rel = f => path.relative(REPO, f);
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function guardOutput(file) {
  const abs = path.resolve(file), allowed = DEV_OUT ? VARIANTS.flatMap(x => [outGlb(x.v), outJson(x.v)]) : [...VARIANTS.flatMap(x => [outGlb(x.v), outJson(x.v)]), CREDITS, ALLOW];
  if (!allowed.includes(abs)) throw new Error('refusing to write outside the Screacher derivative outputs: ' + rel(abs));
  return abs;
}

/** Pin check: the raw GLB's sha256 / byte count (and, when the private task record / map files are there, those too). */
function verifySource(X) {
  const file = path.join(RAW_DIR, `${X.id}-g1.glb`);
  if (!fs.existsSync(file)) throw new Error(`${X.v}: raw master not found (private raw store; set SCREACHER_RAW_DIR)`);
  const size = fs.statSync(file).size, s = sha256File(file);
  if (s !== X.raw.sha256 || size !== X.raw.bytes) throw new Error(`${X.v}: raw master sha256 / bytes mismatch (refusing to build)`);
  const checks = {rawGlb: true, taskRecord: null, providerMaps: null};
  const record = path.join(RAW_DIR, '..', 'MESHY-MODELS.json');
  if (fs.existsSync(record)) {
    const m = JSON.parse(fs.readFileSync(record, 'utf8')).models.find(e => e.variant === X.v);
    if (!m || m.meshyTaskId !== X.meshyTaskId || m.raw.sha256 !== X.raw.sha256 || m.raw.bytes !== X.raw.bytes || m.inputImage.sha256 !== X.inputImageSha256 || m.credits !== 15 || m.accepted !== true
      || Object.keys(X.providerMaps).some(k => m.providerMaps[k].sha256 !== X.providerMaps[k].sha256 || m.providerMaps[k].bytes !== X.providerMaps[k].bytes)
      || m.recipe.ai_model !== RECIPE.ai_model || m.recipe.model_type !== RECIPE.model_type || m.recipe.texture_resolution !== RECIPE.texture_resolution || m.recipe.target_polycount !== RECIPE.target_polycount || (m.recipe.pose_mode ?? null) !== X.poseMode)
      throw new Error(`${X.v}: the private task record does not match the pinned source`);
    checks.taskRecord = true;
  }
  const mapDir = path.join(RAW_DIR, `${X.id}-g1_textures`);
  if (fs.existsSync(mapDir)) {
    for (const [k, e] of Object.entries(X.providerMaps)) { const f = path.join(mapDir, k + '.png'); if (!fs.existsSync(f) || fs.statSync(f).size !== e.bytes || sha256File(f) !== e.sha256) throw new Error(`${X.v}: provider map ${k} does not match its pinned sha256`); }
    checks.providerMaps = true;
  }
  return {file, checks};
}

/** Raw embedded images of the source material. */
async function sourceImages(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const root = doc.getRoot(), mats = root.listMaterials();
  if (mats.length !== 1 || root.listSkins().length || root.listAnimations().length) throw new Error('unexpected source structure (expected one material, no skin, no animation)');
  const mat = mats[0];
  const img = t => t && {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize(), sha256: sha(Buffer.from(t.getImage()))};
  return {base: img(mat.getBaseColorTexture()), mr: img(mat.getMetallicRoughnessTexture()), normal: img(mat.getNormalTexture()), doubleSided: mat.getDoubleSided(), normalScale: mat.getNormalScale(),
    meshes: root.listMeshes().length, primitives: root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0)};
}

/** Weld by exact position, keeping the UV-split -> welded vertex map (weldByPosition semantics). */
function weldLow(pos, nrm, idx) {
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3, newId = new Int32Array(n).fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) newId[i] = count++;
  const P = new Float32Array(count * 3), N = new Float32Array(count * 3), weldId = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const r = newId[remap[i]]; weldId[i] = r;
    if (remap[i] === i) for (let k = 0; k < 3; k++) P[r * 3 + k] = pos[i * 3 + k];
    for (let k = 0; k < 3; k++) N[r * 3 + k] += nrm[i * 3 + k];
  }
  normalizeAll(N);
  const I = [];
  for (let t = 0; t < idx.length; t += 3) { const a = weldId[idx[t]], b = weldId[idx[t + 1]], c = weldId[idx[t + 2]]; if (a !== b && b !== c && a !== c) I.push(a, b, c); }
  return {pos: P, nrm: N, idx: Uint32Array.from(I), weldId};
}
function spread(weldId, sw) {
  const n = weldId.length, joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

// ------------------------------------------------------------------------------------------------ measurements
const onPolyline = (p, pts) => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], ab = V.sub(pts[i + 1], a), L2 = V.dot(ab, ab);
    const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / L2));
    best = Math.min(best, V.len(V.sub(p, V.add(a, V.mul(ab, t)))));
  }
  return best;
};
const LIMBS = [['L_UpperArm', 'L_Forearm'], ['L_Forearm', 'L_Hand'], ['R_UpperArm', 'R_Forearm'], ['R_Forearm', 'R_Hand'], ['L_Thigh', 'L_Shin'], ['L_Shin', 'L_Foot'], ['R_Thigh', 'R_Shin'], ['R_Shin', 'R_Foot']];
/** Per limb bone: median distance of its dominant-weight vertices (middle half of the bone) to the bone axis (autorig.bodyProfile rule). */
function limbRadii(weld, sw, skel) {
  const J = skel.joints, P = weld.pos, n = P.length / 3, limb = {};
  for (const [a, b] of LIMBS) {
    const ja = JOINT_NAMES.indexOf(a), A = J[a], d = V.sub(J[b], A), L = V.len(d), u = V.mul(d, 1 / L), rs = [];
    for (let i = 0; i < n; i++) {
      if (sw.joints[i * 4] !== ja || sw.weights[i * 4] < 0.6) continue;
      const q = V.sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], A), t = V.dot(q, u) / L;
      if (t < 0.25 || t > 0.75) continue;
      rs.push(V.len(V.sub(q, V.mul(u, t * L))));
    }
    rs.sort((x, y) => x - y);
    limb[a] = {length: r4(L), radius: rs.length ? r4(rs[rs.length >> 1]) : null, radiusP90: rs.length ? r4(pct(rs, 0.9)) : null, samples: rs.length};
  }
  return limb;
}
/** Hit radii (model metres, actor scale 1) the Strainer's way; a Screacher has NO head volume. */
function measureHit(weld, sw, skel, limb) {
  const J = skel.joints, P = weld.pos, n = P.length / 3, spine = [J.Hips, J.Spine, J.Chest, J.Neck], torso = [];
  for (let i = 0; i < n; i++) {
    if (sw.region[i] !== 0) continue;
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    if (p[1] < skel.crotchY || p[1] > J.Neck[1]) continue;
    torso.push(onPolyline(p, spine));
  }
  const pair = (a, b) => ((limb['L_' + a].radius ?? 0) + (limb['R_' + a].radius ?? 0) + (limb['L_' + b].radius ?? 0) + (limb['R_' + b].radius ?? 0)) / 4;
  return {
    radii: {torso: r4(pct(torso, 0.75)), arm: r4(pair('UpperArm', 'Forearm') * 1.35), leg: r4(pair('Thigh', 'Shin') * 1.4)},
    torsoP90: r4(pct(torso, 0.9)), torsoVertices: torso.length,
    method: 'torso: 75th pct distance of the torso-region vertices (crotch .. neck base: clothing included) to the Hips-Spine-Chest-Neck chain (capsule Hips -> Neck); limbs: median distance of each limb bone\'s dominant-weight vertices (middle half of the bone) to its axis, mean of upper + lower and both sides, x1.35 (arm: capsule UpperArm -> Hand) / x1.4 (leg: capsule Thigh -> Foot) like the Strainer / zombie/lib/hit.mjs (unclamped); NO head volume: the stump is not a target',
  };
}
/** Footprint from the bind mesh (torso + legs; arms reported separately) vs the contract collider radius. */
function footprint(weld, sw) {
  const P = weld.pos, n = P.length / 3, rs = [];
  let armR = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], z = P[i * 3 + 2];
    if (sw.region[i] === 1 || sw.region[i] === 2) { armR = Math.max(armR, Math.hypot(x, z)); continue; }
    rs.push(Math.hypot(x, z)); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const R = OPTIONS.collider.radius, gap = OPTIONS.collider.narrowestOpeningM;
  return {torsoHalfWidthM: r3(Math.max(-x0, x1)), torsoFrontZ: r3(z1), torsoBackZ: r3(z0), torsoMaxRadiusM: r3(Math.max(...rs)), torsoRadiusP95: r3(pct(rs, 0.95)), armOuterRadiusM: r3(armR),
    collider: {radius: R, diameter: r3(2 * R), narrowestOpeningM: gap, clearancePerSideM: r3((gap - 2 * R) / 2),
      note: `contract motor circle radius ${R} m (ordinary zombie 0.33): the torso / hip / leg core (95th pct horizontal radius ${r3(pct(rs, 0.95))} m; the shoes reach ${r3(Math.max(...rs))} m) passes the narrowest walk-through openings (2-cell doors, 1.0 m) with ${r3((gap - 2 * R) / 2)} m per side; the long hanging arms reach ${r3(armR)} m from the axis and may visually brush door jambs (no collision)`}};
}

/** Lowest skinned point per frame and planted-foot check for the loops. */
function verifyFloor(rig, skel, mesh, clips, footVerts) {
  const out = {};
  for (const c of clips) {
    const S = CLIP_SPECS[c.name];
    let lo = Infinity, iLo = 0, below = 0;
    const feet = {L: {minY: Infinity, stanceMaxY: -Infinity, stanceFrames: 0}, R: {minY: Infinity, stanceMaxY: -Infinity, stanceFrames: 0}};
    for (let f = 0; f < c.times.length; f++) {
      const P = skinPositions(mesh, skel, rig.fk(poseAt(c, f)));
      let m = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i];
      if (m < lo) { lo = m; iLo = f; }
      if (m < -0.01) below++;
      for (const s of ['L', 'R']) {
        let fm = Infinity; for (const i of footVerts[s]) fm = Math.min(fm, P[i * 3 + 1]);
        feet[s].minY = Math.min(feet[s].minY, fm);
        const ph = (c.times[f] / c.duration + (s === 'R' ? 0.5 : 0)) % 1;
        const stance = c.name === 'Idle' || c.name === 'Scream' || ((c.name === 'Walk' || c.name === 'Run') && ph < S.beta - 0.04 && ph > 0.04);
        if (stance) { feet[s].stanceMaxY = Math.max(feet[s].stanceMaxY, fm); feet[s].stanceFrames++; }
      }
    }
    const fr = s => ({minY: r4(feet[s].minY), ...(feet[s].stanceFrames ? {stanceLowestPointMaxY: r4(feet[s].stanceMaxY), stanceFrames: feet[s].stanceFrames} : {})});
    out[c.name] = {frames: c.times.length, minY: r4(lo), atT: c.times[iLo], framesBelowMinus1cm: below, maxLegReach: c.maxLegReach, feet: {L: fr('L'), R: fr('R')}};
  }
  return out;
}

/** Planted-foot slide: horizontal travel of the flat stance foot's sole vs the treadmill ground speed (Idle / Scream: all frames, speed 0). */
function verifySkate(rig, skel, mesh, clips, footVerts) {
  const out = {};
  const sole = Object.fromEntries(['L', 'R'].map(s => [s, footVerts[s].filter(i => mesh.pos[i * 3 + 1] < 0.03)]));
  for (const c of clips.filter(c => ['Walk', 'Run', 'Idle', 'Scream'].includes(c.name))) {
    const S = CLIP_SPECS[c.name], v = S.groundSpeed || 0, planted = c.name === 'Idle' || c.name === 'Scream';
    let worst = 0, sum = 0, k = 0, travel = 0;
    for (const s of ['L', 'R']) {
      let prev = null, first = null;
      for (let f = 0; f < c.times.length; f++) {
        const ph = (c.times[f] / c.duration + (s === 'R' ? 0.5 : 0)) % 1;
        // flat-foot window of the stance (heel strike settled by 15 %, the heel peels off from heelOff: lib/screacher-clips.mjs footCycle)
        const stance = planted || (ph > 0.15 * S.beta && ph < (c.name === 'Run' ? 0.5 : 0.7) * S.beta);
        const P = skinPositions(mesh, skel, rig.fk(poseAt(c, f)));
        const m = sole[s].reduce((a, i) => [a[0] + P[i * 3] / sole[s].length, a[1] + P[i * 3 + 2] / sole[s].length], [0, 0]);
        const dt = prev ? c.times[f] - prev.t : 0;
        if (stance && prev && dt > 1e-6) { const slip = Math.hypot(m[0] - prev.m[0], (m[1] - prev.m[1]) + v * dt) / dt; worst = Math.max(worst, slip); sum += slip; k++; }
        if (planted) { first ??= m; travel = Math.max(travel, Math.hypot(m[0] - first[0], m[1] - first[1])); }
        prev = stance ? {m, t: c.times[f]} : null;
      }
    }
    out[c.name] = {maxSlipMps: r3(worst), meanSlipMps: r3(k ? sum / k : 0), framesTested: k, groundSpeed: v, ...(planted ? {maxSoleTravelM: r4(travel)} : {})};
  }
  return {method: 'flat-foot stance frames (Walk: phase 0.15..0.7 x beta, Run: 0.15..0.5 x beta; Idle / Scream: all frames): mean horizontal position of the fixed sole vertex set (bind foot vertices below 3 cm), frame-to-frame speed relative to the treadmill (the stance foot slides back at exactly groundSpeed in place); 0 = no skating; maxSoleTravelM = farthest the planted sole centre ever moves from its first frame', soleVertices: {L: sole.L.length, R: sole.R.length}, ...out};
}

/**
 * Clearance audit (the idea of enemy/build-strainer.mjs, another measure): is a posed forearm / hand vertex UNDER a body
 * surface? The Strainer measures the depth behind the closest surface triangle of a closed body; a Screacher wears nested,
 * thin, open shells (jacket over shirt over torso, shorts legs over thighs), where "closest triangle" picks an inner shell
 * and vertex normals have no reliable side. Here a ray is cast from the vertex straight AWAY from the bone chain the
 * surface wraps (posed spine chain for the torso shells, the nearer posed leg chain for the leg shells): if it hits that
 * surface, the vertex is covered by it and the hit distance is its depth. Only vertices that are uncovered in the bind pose
 * are tested. A synthetic pose with the arms pressed into the body (ProbeArmsPressedIn) is audited too: proof that the
 * audit sees a real penetration.
 */
function clearanceAudit(rig, skel, weld, sw, clips, {every = 2, maxDepth = 0.2} = {}) {
  const P0 = weld.pos, I = weld.idx, n = P0.length / 3;
  const regionOf = i => sw.region[i], dom = i => JOINT_NAMES[sw.joints[i * 4]];
  const triSet = pred => { const out = []; for (let t = 0; t < I.length; t += 3) if (pred(I[t]) && pred(I[t + 1]) && pred(I[t + 2])) out.push(I[t], I[t + 1], I[t + 2]); return Uint32Array.from(out); };
  const closestOn = (p, pts) => { let best = null, bd = Infinity; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], ab = V.sub(pts[i + 1], a), t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / V.dot(ab, ab))), q = V.add(a, V.mul(ab, t)), d = V.len(V.sub(p, q)); if (d < bd) { bd = d; best = q; } } return {q: best, d: bd}; };
  const chain = (w, names) => names.map(nm => w[nm].pos);
  const pairs = {
    armsVsTorso: {tris: triSet(i => regionOf(i) === 0 && P0[i * 3 + 1] > skel.crotchY - 0.05), verts: i => (regionOf(i) === 1 || regionOf(i) === 2) && /_(Forearm|Hand)$/.test(dom(i)),
      axis: (p, w) => closestOn(p, chain(w, ['Hips', 'Spine', 'Chest', 'Neck'])).q},
    handsVsLegs: {tris: triSet(i => (regionOf(i) === 3 || regionOf(i) === 4) && /_(Thigh|Shin)$/.test(dom(i))), verts: i => (regionOf(i) === 1 || regionOf(i) === 2) && /_Hand$/.test(dom(i)),
      axis: (p, w) => { const a = closestOn(p, chain(w, ['L_Thigh', 'L_Shin', 'L_Foot'])), b = closestOn(p, chain(w, ['R_Thigh', 'R_Shin', 'R_Foot'])); return a.d <= b.d ? a.q : b.q; }},
  };
  const res = {method: `every ${every}nd frame: CPU-skinned forearm / hand vertices that are uncovered in the bind pose; a ray from the vertex straight away from the posed bone chain the surface wraps (spine chain / nearer leg chain) that hits the posed surface within ${maxDepth} m means the vertex is UNDER that surface: depth = the hit distance. armsVsTorso: forearm / hand vs the torso region above the crotch (clothing shells included); handsVsLegs: hand vs thigh + shin (shorts / trouser legs included). ProbeArmsPressedIn is a synthetic self-check pose (each arm rotated inward about its shoulder until the wrist is over the thigh joint), not a clip`, testedVertices: {}};
  const mesh = {pos: P0, joints: sw.joints, weights: sw.weights};
  const bindClip = {name: 'Bind', times: [0], hips: [[0, 0, 0]], rot: {}};
  // (each arm rotated inward about its shoulder until the wrist joint is over its thigh joint: the hand is then in the thigh)
  const J = skel.joints, probeDeg = {};
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1, S = J[s + '_UpperArm'], W = J[s + '_Hand'], target = sg * J[s + '_Thigh'][0] + 0.01;
    let a = 0;
    for (; a < 70; a += 1) { const q = V.add(S, qRotate(qAxis([0, 0, 1], -sg * a), V.sub(W, S))); if (sg * q[0] <= target) break; }
    probeDeg[s] = a;
  }
  const probe = {name: 'ProbeArmsPressedIn', times: [0], hips: [[0, 0, 0]], rot: {L_UpperArm: [qAxis([0, 0, 1], -probeDeg.L)], R_UpperArm: [qAxis([0, 0, 1], probeDeg.R)]}};
  const cover = (g, P, i, w, def) => {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], d = V.sub(p, def.axis(p, w)), L = V.len(d);
    if (L < 1e-6) return 0;
    const h = g.ray(p[0], p[1], p[2], d[0] / L, d[1] / L, d[2] / L, maxDepth, 0.002);
    return h ? h.t : 0;
  };
  for (const [key, def] of Object.entries(pairs)) {
    const w0 = rig.fk(poseAt(bindClip, 0)), g0 = new TriGrid(P0, def.tris, 0.04), set = [];
    for (let i = 0; i < n; i++) if (def.verts(i) && cover(g0, P0, i, w0, def) === 0) set.push(i);
    res.testedVertices[key] = set.length;
    res[key] = {};
    for (const c of [bindClip, probe, ...clips]) {
      const acc = {maxDepth: 0, frames: 0, worstT: null, vertsOver1cm: 0};
      for (let f = 0; f < c.times.length; f += every) {
        const w = rig.fk(poseAt(c, f)), P = skinPositions(mesh, skel, w);
        const g = new TriGrid(P, def.tris, 0.04);
        let over = 0, md = 0;
        for (const i of set) { const depth = cover(g, P, i, w, def); if (depth > 0.01) over++; if (depth > md) md = depth; }
        acc.frames++;
        if (md > acc.maxDepth) { acc.maxDepth = md; acc.worstT = c.times[f]; }
        acc.vertsOver1cm = Math.max(acc.vertsOver1cm, over);
      }
      res[key][c.name] = {maxDepthM: r4(acc.maxDepth), worstT: acc.worstT, maxVertsDeeperThan1cm: acc.vertsOver1cm, framesTested: acc.frames};
    }
  }
  res.probeInwardDeg = probeDeg;
  return res;
}

/** Floor guard for the one-shots that leave the feet: per frame, lift the Hips so the lowest skinned vertex stays >= 5 mm above the floor. */
function floorGuard(rig, skel, mesh, clip, minY = 0.005) {
  let maxLift = 0, frames = 0;
  for (let f = 0; f < clip.times.length; f++) {
    const P = skinPositions(mesh, skel, rig.fk(poseAt(clip, f)));
    let mn = Infinity; for (let i = 1; i < P.length; i += 3) mn = Math.min(mn, P[i]);
    if (mn < -0.002) { const lift = minY - mn; clip.hips[f] = [clip.hips[f][0], clip.hips[f][1] + lift, clip.hips[f][2]]; maxLift = Math.max(maxLift, lift); frames++; }
  }
  return {frames, maxLiftM: r4(maxLift)};
}

/** Hand-region vertex sets of the welded body. */
function handVertices(weld, sw) {
  const hands = {L: [], R: []};
  for (let i = 0; i < weld.pos.length / 3; i++) { const j = JOINT_NAMES[sw.joints[i * 4]]; if (sw.region[i] === 1 && j === 'L_Hand') hands.L.push(i); else if (sw.region[i] === 2 && j === 'R_Hand') hands.R.push(i); }
  return hands;
}
/** The hand vertex of a side farthest from the root horizontally in skinned positions P. */
const handTip = (P, ids) => { let best = null; for (const i of ids) { const d = Math.hypot(P[i * 3], P[i * 3 + 2]); if (!best || d > best.d) best = {d, p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]}; } return best; };

/**
 * Attack metrics (CPU skinning of the welded body): the right hand tip (hand-region vertex farthest from the root
 * horizontally) per frame; at the HIT FRAME (impactTime, the sampled tracks interpolated like the runtime does) its reach
 * (horizontal distance root -> tip), height and position.
 */
function attackMetrics(rig, skel, weld, sw, clip) {
  const mesh = {pos: weld.pos, joints: sw.joints, weights: sw.weights}, hands = handVertices(weld, sw), S = CLIP_SPECS.Attack;
  const at = pose => { const P = skinPositions(mesh, skel, rig.fk(pose)); return {R: handTip(P, hands.R), L: handTip(P, hands.L)}; };
  const h = at(poseAtTime(clip, S.impactTime));
  const hit = {t: S.impactTime, reachM: r3(h.R.d), handTipR: r3(h.R.p), reachL: r3(h.L.d), handTipL: r3(h.L.p), forwardZ: r3(h.R.p[2]), heightY: r3(h.R.p[1])};
  const pathR = [];
  let maxReach = {d: 0, t: 0};
  for (let f = 0; f < clip.times.length; f++) { const a = at(poseAt(clip, f)); pathR.push({t: clip.times[f], R: r3(a.R.p), reachR: r3(a.R.d)}); if (a.R.d > maxReach.d) maxReach = {d: a.R.d, t: clip.times[f]}; }
  return {hit, maxReachR: {m: r3(maxReach.d), t: maxReach.t}, handVertices: {L: hands.L.length, R: hands.R.length}, tipPath: pathR,
    method: 'CPU skinning of the welded body (top-4 float weights); hand tip = the right-hand-region vertex farthest from the root (feet midpoint, actor origin) horizontally; the hit frame = impactTime with the sampled 30 fps tracks interpolated linearly (slerp) exactly like the runtime; reach = that horizontal distance'};
}

/** Solve the Attack lunge (pelvis travel at the hit) so the measured right hand tip is ATTACK.reachM out at the hit frame. */
function solveAttack(rig, skel, weld, sw, ctx) {
  const mesh = {pos: weld.pos, joints: sw.joints, weights: sw.weights}, hands = handVertices(weld, sw), tMid = (ATTACK.hold[0] + ATTACK.hold[1]) / 2;
  const reach = lunge => { const pose = evalClip(rig, 'Attack', tMid, {...ctx, attackLunge: lunge}); const P = skinPositions(mesh, skel, rig.fk(pose)); return {reach: handTip(P, hands.R).d, legReach: pose.reach}; };
  let [lo, hi] = ATTACK.lunge;
  const rLo = reach(lo), rHi = reach(hi);
  let lunge, evals = 2;
  if (rLo.reach >= ATTACK.reachM) lunge = lo;
  else if (rHi.reach <= ATTACK.reachM) lunge = hi;
  else { for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; evals++; if (reach(mid).reach < ATTACK.reachM) lo = mid; else hi = mid; } lunge = (lo + hi) / 2; }
  const r = reach(lunge);
  return {lunge: r4(lunge), reachAtHold: r4(r.reach), legReach: r4(r.legReach), range: ATTACK.lunge, reachAtRangeEnds: r4([rLo.reach, rHi.reach]), evals, target: ATTACK.reachM,
    method: 'bisection on the pelvis forward travel of the hit keys (lib/screacher-clips.mjs attackKeys `lunge`) until the CPU-skinned right hand tip is the contract reach from the root in the held hit pose'};
}

// ------------------------------------------------------------------------------------------------ GLB
function buildDocument({X, skel, body, clips, extras, tex}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Screacher-' + X.id).setExtras({enemyScreacher: extras});
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin('ScreacherSkin').setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor('ScreacherSkin_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  const acc = (type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
  const qn = nrm => { const q = new Int8Array(nrm.length); for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))); return q; };
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const texture = (name, img) => doc.createTexture(name).setImage(img).setMimeType('image/jpeg');
  const bodyMat = doc.createMaterial('ScreacherBodyMaterial').setBaseColorTexture(texture('Screacher_baseColor', tex.base))
    .setMetallicRoughnessTexture(texture('Screacher_metallicRoughness', tex.mr)).setNormalTexture(texture('Screacher_normal', tex.normal))
    .setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(tex.doubleSided);
  const q = quantizeWeights(body.joints, body.weights);
  const prim = doc.createPrimitive().setMaterial(bodyMat).setAttribute('POSITION', acc('VEC3', body.pos)).setAttribute('NORMAL', acc('VEC3', qn(body.nrm), true))
    .setAttribute('TEXCOORD_0', acc('VEC2', body.uv)).setAttribute('JOINTS_0', acc('VEC4', q.joints)).setAttribute('WEIGHTS_0', acc('VEC4', q.weights, true))
    .setIndices(acc('SCALAR', body.pos.length / 3 < 65536 ? Uint16Array.from(body.idx) : Uint32Array.from(body.idx)));
  scene.addChild(doc.createNode('ScreacherBody').setMesh(doc.createMesh('ScreacherBody').addPrimitive(prim).setExtras({slot: 'body'})).setSkin(skin).setExtras({slot: 'body'}));
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const tAcc = doc.createAccessor(clip.name + '_t').setType('SCALAR').setArray(Float32Array.from(clip.times)).setBuffer(buf);
    for (const [jn, track] of Object.entries(clip.rot)) {
      const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC4').setArray(Float32Array.from(track.flat())).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes[jn]).setTargetPath('rotation').setSampler(s));
    }
    const hipsT = clip.hips.map(o => V.add(V.sub(skel.joints.Hips, skel.joints.Root), o));
    const s = doc.createAnimationSampler().setInput(tAcc).setOutput(doc.createAccessor().setType('VEC3').setArray(Float32Array.from(hipsT.flat())).setBuffer(buf)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.Hips).setTargetPath('translation').setSampler(s));
  }
  return doc;
}

// ------------------------------------------------------------------------------------------------ CREDITS + allowlist
/** The marked CREDITS.md section (always the full four-variant section: every GLB that exists), then this builder's allowlist entries. */
function writeCreditsAndAllowlist() {
  const pub = p => path.relative(path.join(REPO, 'game/public'), p).split(path.sep).join('/');
  const have = VARIANTS.filter(X => fs.existsSync(outGlb(X.v)) && fs.existsSync(outJson(X.v)));
  const credSrc = fs.readFileSync(CREDITS, 'utf8');
  const section = [CREDITS_BEGIN, '## The Screacher (enemy, four bodies)', '',
    'One enemy with four approved bodies. Each was generated for this project with Meshy T2.5 image-to-3D (smart topology, 2K PBR; 1 attempt and 15 credits each) through the Meshy MCP under the user\'s task authorization, conditioned on the project\'s own user-approved concept image of that body (a Codex native image generation). Rigged and animated locally on CPU by `tools/asset-pipeline/enemy/build-screacher.mjs`: the shared 18-joint skeleton, automatic skin weights and hand-authored procedural clips (not motion capture); the provider\'s texture maps are resized / re-encoded only (hash-only provenance: `assets/derivatives/enemy-screacher-<variant>.json`). AI-generated assets: provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters, provider maps and the input images are kept outside Git.', '',
    ...have.map(X => `- \`${pub(outGlb(X.v))}\` — Screacher ${X.id} "${X.name}": ${X.look} (Meshy task ${X.meshyTaskId})`), CREDITS_END].join('\n');
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
  const next = re.test(credSrc) ? credSrc.replace(re, () => section) : credSrc.replace(/\n*$/, '\n\n') + section + '\n';
  if (next !== credSrc) fs.writeFileSync(guardOutput(CREDITS), next);
  const allowRaw = fs.readFileSync(ALLOW, 'utf8'), allow = JSON.parse(allowRaw);
  if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) throw new Error('unknown public-input policy schema');
  if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
  const mineAll = [...VARIANTS.flatMap(X => [outGlb(X.v), outJson(X.v)]), CREDITS].map(pub);
  const files = [...have.flatMap(X => [outGlb(X.v), outJson(X.v)]), CREDITS];
  const add = files.map(f => ({path: pub(f), bytes: fs.statSync(f).size, sha256: sha256File(f)}));
  allow.files = [...allow.files.filter(f => !mineAll.includes(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const out = JSON.stringify(allow, null, 2) + '\n';
  if (out !== allowRaw) fs.writeFileSync(guardOutput(ALLOW), out);
  console.log('  CREDITS section + allowlist:', add.map(a => `${a.path} ${a.bytes}`).join(', '));
}

// ------------------------------------------------------------------------------------------------ one variant
async function buildVariant(X) {
  const t0 = Date.now(), log = (...a) => console.log(`[${X.v}]`, ...a);
  for (const f of [outGlb(X.v), outJson(X.v)]) guardOutput(f);
  const src = verifySource(X);
  log('1/7 load + place');
  const m = await loadSource({id: X.v, file: src.file, sha256: X.raw.sha256});
  const imgs = await sourceImages(src.file);
  if (imgs.meshes !== 1 || imgs.primitives !== 1) throw new Error('expected one mesh / one primitive');
  const fd = detectFacing(m.pos);
  if (fd.facing !== 1) throw new Error('unexpected facing: the accepted masters face +Z');
  const pl = placement(m, OPTIONS.heightM, fd.facing);
  const low = placeHigh(m, pl);
  const {nativeBounds, ...plRest} = pl;
  log('  facing', fd.facing, 'scale', pl.scale.toFixed(4), 'tris', m.triangles, 'verts', m.vertices, 'textures', JSON.stringify([imgs.base.size, imgs.base.mime, imgs.mr.size, imgs.mr.mime, imgs.normal.size, imgs.normal.mime]));

  log('2/7 skeleton');
  const weld = weldLow(low.pos, low.nrm, m.idx);
  const comp = components(weld.pos.length / 3, weld.idx);
  const skel = detectScreacherSkeleton(weld);
  const issues = validateSkeleton(skel);
  log('  joints', JSON.stringify(skel.joints));
  log('  stump', JSON.stringify(skel.stump), 'arms symmetric', skel.armsSymmetric, 'crotch', r3(skel.crotchY), 'issues', JSON.stringify(issues));

  log('3/7 skin');
  const sw = computeScreacherSkin(weld, skel);
  const bodyW = spread(weld.weldId, sw);
  const limb = limbRadii(weld, sw, skel);
  const hit = measureHit(weld, sw, skel, limb);
  const foot = footprint(weld, sw);
  const used = new Set(); for (let i = 0; i < sw.joints.length; i++) if (sw.weights[i] > 0.05) used.add(JOINT_NAMES[sw.joints[i]]);
  log('  regions', JSON.stringify(sw.stats.regionVertexCounts), 'cap', JSON.stringify(sw.stats.shoulderCapVertices), 'joints unused', JSON.stringify(JOINT_NAMES.filter(j => !used.has(j))));
  log('  hit', JSON.stringify(hit.radii), 'footprint', JSON.stringify({p95: foot.torsoRadiusP95, max: foot.torsoMaxRadiusM, arm: foot.armOuterRadiusM}));
  const bodyMesh = {name: 'ScreacherBody', pos: low.pos, nrm: low.nrm, uv: m.uv, idx: m.idx, ...bodyW};
  const weldMesh = {pos: weld.pos, joints: sw.joints, weights: sw.weights};

  log('4/7 clips');
  const rig = new Rig(skel);
  const death = solveScreacherDeath(rig, skel, weldMesh);
  const deathContact = floorReport(rig, skel, weldMesh, deathFinalPose(rig, death.hipsY, death.tune));
  log('  death', JSON.stringify({tune: death.tune, hipsY: r4(death.hipsY), cost: +death.cost.toExponential(2), contact: deathContact}));
  const ctx0 = {deathHipsY: death.hipsY, deathTune: death.tune};
  const attackSolve = solveAttack(rig, skel, weld, sw, ctx0);
  log('  attack solve', JSON.stringify(attackSolve));
  const ctx = {...ctx0, attackLunge: attackSolve.lunge};
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, ctx));
  const guarded = {};
  for (const c of clips) if (['Attack', 'Hit', 'Death'].includes(c.name)) guarded[c.name] = floorGuard(rig, skel, bodyMesh, c);
  log('  floor guard', JSON.stringify(guarded), 'leg reach', JSON.stringify(Object.fromEntries(clips.map(c => [c.name, c.maxLegReach]))));

  log('5/7 verify');
  const footVerts = {L: [], R: []};
  for (let i = 0; i < bodyW.joints.length / 4; i++) { const j = JOINT_NAMES[bodyW.joints[i * 4]]; if (j === 'L_Foot') footVerts.L.push(i); else if (j === 'R_Foot') footVerts.R.push(i); }
  const floor = verifyFloor(rig, skel, bodyMesh, clips, footVerts);
  log('  floor', JSON.stringify(Object.fromEntries(Object.entries(floor).map(([k, v]) => [k, [v.minY, v.framesBelowMinus1cm, v.feet.L.stanceLowestPointMaxY ?? null, v.feet.R.stanceLowestPointMaxY ?? null]]))));
  const skate = verifySkate(rig, skel, bodyMesh, clips, footVerts);
  log('  skate', JSON.stringify(Object.fromEntries(['Idle', 'Walk', 'Run', 'Scream'].map(k => [k, skate[k]]))));
  const attack = attackMetrics(rig, skel, weld, sw, clips.find(c => c.name === 'Attack'));
  log('  attack', JSON.stringify({hit: attack.hit, max: attack.maxReachR}));
  const clearance = clearanceAudit(rig, skel, weld, sw, clips);
  log('  clearance', JSON.stringify(Object.fromEntries(['armsVsTorso', 'handsVsLegs'].map(k => [k, Object.fromEntries(Object.entries(clearance[k]).map(([c, v]) => [c, [v.maxDepthM, v.maxVertsDeeperThan1cm, v.worstT]]))]))), 'tested', JSON.stringify(clearance.testedVertices));
  const poses = auditPoses(clips, {every: 3});
  const st = triangleStretch({pos: low.pos, idx: m.idx, joints: bodyW.joints, weights: bodyW.weights}, skel, rig, poses);
  const stretch = stretchStats(st.worst, poses, st.at, {ratio: 3});
  log('  stretch', JSON.stringify(stretch));
  if (process.env.SCREACHER_DEBUG_STRETCH) { // dev: where the worst triangles are (bind centroid, regions, dominant joints, pose)
    const order = Array.from(st.worst.keys()).sort((a, b) => st.worst[b] - st.worst[a]).slice(0, +process.env.SCREACHER_DEBUG_STRETCH);
    const byZone = {};
    for (let k = 0; k < st.worst.length; k++) if (st.worst[k] > 2.5) { const vs = [0, 1, 2].map(e => weld.weldId[m.idx[k * 3 + e]]); const key = vs.map(v => sw.region[v]).sort().join('') + ' ' + [...new Set(vs.map(v => JOINT_NAMES[sw.joints[v * 4]]))].sort().join('+') + ' ' + poses[st.at[k]].clip; byZone[key] = (byZone[key] || 0) + 1; }
    log('   stretch>2.5 by regions / dominant joints / clip', JSON.stringify(Object.fromEntries(Object.entries(byZone).sort((a, b) => b[1] - a[1]).slice(0, 30))));
    for (const k of order) { const vs = [0, 1, 2].map(e => weld.weldId[m.idx[k * 3 + e]]); const c = [0, 1, 2].map(a => (weld.pos[vs[0] * 3 + a] + weld.pos[vs[1] * 3 + a] + weld.pos[vs[2] * 3 + a]) / 3); log('   tri', k, st.worst[k].toFixed(1), r3(c), vs.map(v => sw.region[v] + ':' + skel.labels.arm[v] + ':' + JOINT_NAMES[sw.joints[v * 4]] + ':' + sw.weights[v * 4].toFixed(2)).join(' '), poses[st.at[k]].clip, poses[st.at[k]].t); }
  }
  // the Scream pose at the cue (stump height, arch) for the record
  const screamClip = clips.find(c => c.name === 'Scream');
  const cueWorld = rig.fk(poseAtTime(screamClip, CLIP_SPECS.Scream.cueTime)), bindWorld = rig.fk({hips: [0, 0, 0], rot: {}});
  const screamCue = {t: CLIP_SPECS.Scream.cueTime, headJoint: r3(cueWorld.Head.pos), headJointBind: r3(bindWorld.Head.pos), chestJoint: r3(cueWorld.Chest.pos), handR: r3(cueWorld.R_Hand.pos), handL: r3(cueWorld.L_Hand.pos), handRBind: r3(bindWorld.R_Hand.pos)};
  log('  scream cue', JSON.stringify(screamCue));
  if (flag('--no-write')) { log(`dev run: nothing written (${((Date.now() - t0) / 1000).toFixed(1)} s)`); return null; }

  log('6/7 textures');
  const T = OPTIONS.textures;
  const base = await sharp(imgs.base.bytes).resize(T.baseColor, T.baseColor, {kernel: 'lanczos3'}).jpeg({quality: T.quality.base, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mr = await sharp(imgs.mr.bytes).resize(T.metallicRoughness, T.metallicRoughness, {kernel: 'lanczos3'}).jpeg({quality: T.quality.mr, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const normal = await sharp(imgs.normal.bytes).resize(T.normal, T.normal, {kernel: 'lanczos3'}).jpeg({quality: T.quality.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const mrStats = (await sharp(imgs.mr.bytes).stats()).channels.map(c => ({min: c.min, max: c.max, mean: +c.mean.toFixed(1)}));
  log('  bytes base', base.length, 'mr', mr.length, 'normal', normal.length);

  log('7/7 GLB + sidecar');
  const bb = bounds(low.pos);
  const clipMeta = Object.fromEntries(clips.map(c => { const S = CLIP_SPECS[c.name]; return [c.name, {duration: S.duration, loop: S.loop, frames: c.times.length, ...(S.groundSpeed ? {groundSpeed: S.groundSpeed} : {}), ...(S.impactTime ? {impactTime: S.impactTime} : {}), ...(S.cueTime ? {cueTime: S.cueTime} : {})}]; }));
  const deathClip = clips.find(c => c.name === 'Death');
  const dp = skinPositions(bodyMesh, skel, rig.fk(poseAt(deathClip, deathClip.times.length - 1))), db = bounds(dp);
  // GLB scene extras: exactly the asset contract the runtime reads (no head field: a Screacher has no head volume)
  const extras = {
    version: 1, archetype: 'screacher', variant: X.v, name: X.name, task: TASK,
    heightM: r4(skel.H), joints: JOINT_NAMES, bodyMesh: 'ScreacherBody', sourceSha256: X.raw.sha256, meshyTaskId: X.meshyTaskId,
    stump: {top: r4(skel.stump.top)},
    attackHitTime: CLIP_SPECS.Attack.impactTime, reachM: attack.hit.reachM,
    screamCueTime: CLIP_SPECS.Scream.cueTime,
    clips: clipMeta,
    hitRadii: hit.radii, radius: OPTIONS.collider.radius,
    boundsM: {min: r3(bb.min), max: r3(bb.max)}, deathPoseBoundsM: {min: r3(db.min), max: r3(db.max)},
  };
  const doc = buildDocument({X, skel, body: bodyMesh, clips, extras, tex: {base, mr, normal, doubleSided: imgs.doubleSided}});
  fs.mkdirSync(path.dirname(outGlb(X.v)), {recursive: true});
  await writeDoc(doc, guardOutput(outGlb(X.v)));
  const outBytes = fs.statSync(outGlb(X.v)).size, outSha = sha256File(outGlb(X.v));
  if (sha256File(src.file) !== X.raw.sha256) throw new Error('SOURCE CHANGED during the build');
  if (outBytes > OPTIONS.maxBytes) throw new Error(`${X.v}: GLB ${outBytes} bytes exceeds the ${OPTIONS.maxBytes} target`);
  const J = skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(V.len(V.sub(J[n], J[p])))]));
  const compSizes = [...comp.sizes.values()].sort((a, b) => b - a);
  const armInfo = Object.fromEntries(['L', 'R'].map(s => { const a = bindArm(rig, s); return [s, {upperM: r4(a.upper), forearmM: r4(a.fore), handM: r4(a.hand), lengthM: r4(a.length), bindElbowDeg: r4(a.elbowDeg)}]; }));
  const manifest = {
    schema: 'the-last-line/derivative-manifest@1', asset: `enemy-screacher-${X.v}`, title: `Screacher ${X.id} "${X.name}" (${X.look}) - rigged runtime derivative of the accepted Meshy T2.5 model (prototype)`,
    task: TASK, lane: 'RIG', date: '2026-11-10', generatedBy: 'tools/asset-pipeline/enemy/build-screacher.mjs',
    family: {archetype: 'screacher', variant: X.v, id: X.id, name: X.name, variants: VARIANTS.map(e => e.v), note: 'one enemy type with four visual variants: the same AI, stats and clip contract (names / durations / timings); each variant has its own skeleton fit and its own clip sampling'},
    status: {approved: false, gameReady: false, stage: 'generated by Meshy (image-to-3D of the user-approved concept); rig, skin weights and clips are local and procedural; not approved in game by a human yet', licenseClearance: 'none - a derivative of an AI generation (Meshy, conditioned on a Codex-generated image); access to it grants no licence, commercial or production clearance'},
    honesty: {sourceHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming / hierarchy of the zombie wardrobe) and automatic skin weights created by this CPU pipeline', animation: 'hand-authored procedural keyframes / gait functions (lib/screacher-clips.mjs) sampled with this body\'s own joint positions - NOT motion capture', textures: 'the provider\'s own generated maps, resized / re-encoded only (no painting, no reprojection, no new artwork)', mesh: 'the mesh as generated (uniform scale + translation only): no decimation, no re-pose, no added geometry; there is no head and the neck stump is left open exactly as generated', generation: 'no AI generation, inference, model download or network service was used by this builder; the Meshy model was generated earlier by the task lead'},
    provenance: 'generated (Meshy T2.5 image-to-3D, smart topology, 2K PBR, from the project\'s own user-approved Codex-generated concept image) + local derivative work; public provenance is hash-only',
    source: {sha256Verified: X.raw.sha256, bytes: X.raw.bytes, readOnly: true, pinChecks: src.checks, rawKeptOutsideGit: 'the raw GLB, the provider map files and the conditioning image are kept in a private raw-asset store outside Git (not modified, not shipped); only their hashes are public',
      triangles: m.triangles, vertices: m.vertices, primitives: imgs.primitives, material: m.material, doubleSided: imgs.doubleSided,
      embeddedTextures: {baseColor: {size: imgs.base.size, mime: imgs.base.mime, bytes: imgs.base.bytes.length, sha256: imgs.base.sha256}, metallicRoughness: {size: imgs.mr.size, mime: imgs.mr.mime, bytes: imgs.mr.bytes.length, sha256: imgs.mr.sha256}, normal: {size: imgs.normal.size, mime: imgs.normal.mime, bytes: imgs.normal.bytes.length, sha256: imgs.normal.sha256}}, metallicRoughnessChannelStats: mrStats,
      meshy: {provider: 'Meshy image-to-3D', taskId: X.meshyTaskId, tool: RECIPE.tool, aiModel: RECIPE.ai_model, smartTopology: true, attempts: 1, credits: 15, accepted: true,
        settings: {ai_model: RECIPE.ai_model, model_type: RECIPE.model_type, pose_mode: X.poseMode, should_texture: RECIPE.should_texture, texture_resolution: RECIPE.texture_resolution, enable_pbr: RECIPE.enable_pbr, target_polycount: RECIPE.target_polycount, target_formats: RECIPE.target_formats},
        poseNote: X.poseMode ? 't-pose was requested; the model came back in the pose of the input image (arms hanging), which is the approved posture' : 'no pose mode requested: the model keeps the pose of the input image (arms hanging), which is the approved posture',
        inputImage: {sha256: X.inputImageSha256, what: 'the user-approved concept image of this variant (the project\'s own Codex native image generation)'},
        raw: {glb: {sha256: X.raw.sha256, bytes: X.raw.bytes}, providerMaps: X.providerMaps}}},
    outputs: {glb: {path: DEV_OUT ? path.basename(outGlb(X.v)) : rel(outGlb(X.v)), bytes: outBytes, sha256: outSha, format: 'glTF 2.0 binary; KHR_mesh_quantization (NORMAL int8 normalized; required); JPEG textures; JOINTS_0 u8 / WEIGHTS_0 normalized u8; one SkinnedMesh node'},
      textures: {baseColor: {size: T.baseColor, format: 'JPEG 4:2:0', quality: T.quality.base, bytes: base.length, sha256: sha(base), edits: 'none (re-encode only)'}, metallicRoughness: {size: T.metallicRoughness, format: 'JPEG 4:4:4 (source packed map: G roughness, B metallic; resized)', quality: T.quality.mr, bytes: mr.length, sha256: sha(mr), edits: 'none (resize + re-encode only)'}, normal: {size: T.normal, format: 'JPEG 4:4:4 tangent-space (source map resized; glTF convention, no tangents: three.js derivative tangents)', quality: T.quality.normal, bytes: normal.length, sha256: sha(normal), edits: 'none (resize + re-encode only)'}}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: r4(skel.H), heightIs: 'floor -> top of the neck stump (there is no head)', bindPose: 'the relaxed pose as generated (legs vertical, arms hanging at the sides): no re-posing', bindRotations: 'identity (bone frames aligned with model space)'},
    placement: {...plRest, nativeBounds: {min: r4(nativeBounds.min), max: r4(nativeBounds.max)}, boundsM: extras.boundsM, sizeM: r3([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]])}, facing: fd,
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends: skel.ends, boneLengthsM, arms: armInfo, armsSymmetric: skel.armsSymmetric, stump: skel.stump, validationIssues: issues, options: SKELETON_OPTIONS,
      headless: 'Neck = the base of the neck stump between the shoulders; Head = a TECHNICAL joint just under the top of the stump (the runtime ragdoll / actors look bones up by name); there is no head geometry, no head sphere and no head hit volume',
      validationNote: 'the anthropometric ranges of autorig.validateSkeleton are for ordinary adults WITH a head measured to the crown; this body is headless (its height ends at the stump) and deliberately long-shinned / long-armed, so the listed out-of-range ratios are the generated proportions, not a detection failure (see the joint overlay sheet)', estimation: skel.log},
    skinning: sw.stats,
    mesh: {node: 'ScreacherBody', vertices: low.pos.length / 3, triangles: m.idx.length / 3, weldedVertices: weld.pos.length / 3, connectedComponents: compSizes.length, largestComponentsWeldedVertices: compSizes.slice(0, 8), geometryHash: geometryHash(low.pos, m.idx), jointsUsed: JOINT_NAMES.filter(j => used.has(j)), jointsUnused: JOINT_NAMES.filter(j => !used.has(j)),
      note: 'the Meshy smart-topology mesh and UVs unchanged (placed: uniform scale + translation); no simplification / re-UV / re-bake; the part-separated shells (clothing, limbs, shoes) keep their own vertices and get position-based weights'},
    profile: {heightM: r4(skel.H), landmarks: {ankle: r4(skel.ankleY), knee: r4(J.L_Shin[1]), crotch: r4(skel.crotchY), hip: r4(skel.hipY), spine: r4(J.Spine[1]), chest: r4(J.Chest[1]), armpit: r4(skel.armpitY), neckBase: r4(skel.neckBaseY), stumpTop: r4(skel.H)}, limb},
    clips: {method: 'hand-authored procedural keyframes / gait functions (lib/screacher-clips.mjs) at 30 fps (+ the end time), legs by foot-planting IK (zombie/lib/pose.mjs); not motion capture; the hanging-arm poses are relative to this body\'s own bind arms', fps: FPS, meta: clipMeta,
      runtime: {attackDuration: CLIP_SPECS.Attack.duration, attackImpact: CLIP_SPECS.Attack.impactTime, attackHitTime: CLIP_SPECS.Attack.impactTime, attackReachM: attack.hit.reachM, walkGroundSpeed: CLIP_SPECS.Walk.groundSpeed, runGroundSpeed: CLIP_SPECS.Run.groundSpeed, screamDuration: CLIP_SPECS.Scream.duration, screamCueTime: CLIP_SPECS.Scream.cueTime,
        note: 'reachM = horizontal root -> right hand tip at the hit frame, actor scale 1 (the hit pose is held over the two 30 fps frames round impactTime); locomotion clips are authored in place for groundSpeed at timeScale 1; Scream returns to the Idle frame-0 pose with the feet planted throughout'},
      attackSolve, gait: {walk: {beta: CLIP_SPECS.Walk.beta, stanceTravelM: r4(CLIP_SPECS.Walk.groundSpeed * CLIP_SPECS.Walk.beta * CLIP_SPECS.Walk.duration)}, run: {beta: CLIP_SPECS.Run.beta, stanceTravelM: r4(CLIP_SPECS.Run.groundSpeed * CLIP_SPECS.Run.beta * CLIP_SPECS.Run.duration)}, legLengthM: r4(rig.thighLen + rig.shinLen), note: 'stance travel = groundSpeed x beta x duration (the contract); the pelvis is lowered per variant so the front foot is reached below full leg extension (maxLegReach < 1: no clamped IK, no skating)'},
      deathSolve: {method: 'lib/screacher-clips.mjs solveScreacherDeath (the zombie/lib/clipsolve.mjs coordinate descent + cost, on this body\'s own supine pose; regions torso incl. the stump, pelvis, arms, legs; NO head term)', ranges: death.ranges, tune: death.tune, hipsY: r4(death.hipsY), cost: +death.cost.toExponential(3), evals: death.evals, contact: deathContact},
      floorGuard: {method: 'per frame: Hips raised so the lowest CPU-skinned vertex stays >= 5 mm above the floor (Attack / Hit / Death; not Scream: its feet are planted by IK)', clips: guarded}, screamCue},
    verification: {cpuSkinningFloor: floor, footSkate: skate, clearance, attack, motionStretch: {...stretch, method: 'per triangle: worst edge length ratio posed / bind over every 3rd frame of all seven clips (CPU skinning)'}},
    hit: {radii: hit.radii, torsoP90: hit.torsoP90, method: hit.method, collider: foot.collider, footprint: foot, heightM: r4(skel.H), stumpTop: r4(skel.stump.top),
      torsoCapsule: {hipsY: r4(J.Hips[1]), neckY: r4(J.Neck[1]), radius: hit.radii.torso, capTopIfEndedAtNeck: r4(J.Neck[1] + hit.radii.torso), stumpTopY: r4(skel.H), endYForCapAtStumpTop: r4(skel.H - hit.radii.torso),
        note: 'Neck is the base of the stump (the shoulder line): a round-capped capsule Hips -> Neck with the torso radius rises above the top of the stump (capTopIfEndedAtNeck), where a zombie has its head; ending the capsule axis at endYForCapAtStumpTop (= stump top - radius) keeps the cap at the stump top (a runtime choice: stump.top and hitRadii.torso are both in the extras)'},
      notes: ['torso capsule Hips -> Neck (r torso), limb capsules UpperArm -> Hand (r arm), Thigh -> Foot (r leg); NO head volume (the extras carry no head field): a shot above the shoulders hits nothing', 'stump.top = the centre of the top of the neck stump in the bind pose (voice / QA anchor, not a target)', 'all values in model metres at actor root scale 1 (multiply by the runtime scale)']},
    runtime: {modelKey: `enemy_screacher_${X.v}`, url: `assets/models/enemy-screacher-${X.v}.glb`, extras: 'gltf.scene.userData.enemyScreacher', meshes: {body: 'ScreacherBody'}, bones: 'the same 18 names as the zombie bodies (Root, Hips, Spine, Chest, Neck, Head, L_/R_ UpperArm, Forearm, Hand, Thigh, Shin, Foot)'},
    limitations: [
      'Automatic approximate skin weights on a low-poly (16-21 k triangle) source: LBS volume loss at shoulders / elbows / knees in strong poses; no finger bones (the "twitching" and "spread" hands are wrist / forearm motion).',
      'Sleeves, jackets and trouser legs are skinned shells without cloth simulation: where a sleeve hangs against the flank it shears between arm and chest when the arm lifts.',
      'Procedural (not mocap) clips; the knee height is the family proportion (trousers hide the knees of three variants).',
      'Hidden-side geometry and texture of the source are AI-generated (Meshy); the open neck stump shows the generated inside faces.',
      'The long hanging arms swing outside the motor collider (visual brushing of door jambs, no collision change).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ],
    rebuild: 'node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-screacher.mjs [--only <variant>] (needs the private raw masters: SCREACHER_RAW_DIR); QA sheets: node tools/asset-pipeline/enemy/qa/screacher-sheets.mjs',
  };
  const text = JSON.stringify(manifest, null, 1) + '\n';
  if (/reference\/|\/workspaces?\/|\/home\/|\/tmp\/|https?:\/\//.test(text)) throw new Error('sidecar would carry a private / absolute path or a URL');
  fs.mkdirSync(path.dirname(outJson(X.v)), {recursive: true});
  fs.writeFileSync(guardOutput(outJson(X.v)), text);
  log(`done: ${DEV_OUT ? outGlb(X.v) : rel(outGlb(X.v))} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return {v: X.v, bytes: outBytes, sha256: outSha};
}

async function main() {
  const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
  const todo = VARIANTS.filter(X => !only || only.has(X.v));
  if (!todo.length) throw new Error('no such variant: ' + opt('--only'));
  const done = [];
  for (const X of todo) { const r = await buildVariant(X); if (r) done.push(r); }
  if (done.length && !DEV_OUT) writeCreditsAndAllowlist();
}

await main();
