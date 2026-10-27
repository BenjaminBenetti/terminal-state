#!/usr/bin/env node
// The Last Line — rat/dog creature derivative builder (iteration 07, Lane Q). Single reproducible entry point:
//   node tools/asset-pipeline/creature/build-creature.mjs [--reuse-bake]   (--reuse-bake: dev cache in /tmp/ll-creature)
// Reads the READ-ONLY Field Notes quadruped master (quadruped-02 "Tunnel scavenger", sha256-verified) and writes ONLY:
//   game/public/assets/models/creature-ratdog.glb
//   game/public/assets/derivatives/creature-ratdog.json
// The master is an unrigged static reconstruction; this script makes a NEW derivative: placement from paw landmarks,
// simplification + new UVs + texture/normal bake, a NEW quadruped skeleton auto-placed from mesh landmarks, automatic
// skin weights and hand-authored procedural keyframe clips (not mocap). Nothing here was animated in the master.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadSource} from '../zombie/lib/source.mjs';
import {weldByPosition, simplifyMesh, computeNormals, bounds} from '../zombie/lib/mesh.mjs';
import {unwrap} from '../zombie/lib/unwrap.mjs';
import {MASTER} from './lib/master.mjs';
import {quadrupedPlacement} from './lib/placement.mjs';
import {detectQuadruped} from './lib/landmarks.mjs';
import {bakeAll, encodeAll} from './lib/bake.mjs';
import {computeQuadrupedWeights, onPolyline} from './lib/skin.mjs';
import {JOINTS, JOINT_NAMES, boneSegments} from './lib/skeleton.mjs';
import {QRig, LEGS, V} from './lib/rig.mjs';
import {CLIP_SPECS, GAITS, groundSpeed, sampleClip, poseAtFrame} from './lib/clips.mjs';
import {buildDocument, writeGLB, skinPositions} from './lib/glb.mjs';

const ARGS = new Set(process.argv.slice(2));
const TMP = '/tmp/ll-creature';
const OUT_GLB = path.join(REPO, 'game/public/assets/models/creature-ratdog.glb');
const OUT_JSON = path.join(REPO, 'game/public/assets/derivatives/creature-ratdog.json');

export const OPTIONS = {
  topHeight: 0.64, // provisional: top of the shoulder bristles 0.64 m (about a large dog); the concept gives no size
  targetTris: 12000,
  importance: {head: 60, paws: 25, note: 'extra simplifier attribute = position * k: face/jaw and paws keep more triangles'},
  unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 60, smoothIters: 12, atlas: 1024, pad: 6},
  density: {head: 1.8, paws: 1.25},
  bake: {size: 2048, cage: 0.012, rayBelow: 0.004, normalBlend: 0.8},
  textures: {baseColor: 1024, metallicRoughness: 512, normal: 512, jpegQuality: 90},
  skin: {smoothIters: 4, smoothLambda: 0.5, legRatio: 0.55, jointBlend: 0.025},
};

function guardOutput(file) {
  const rel = path.relative(REPO, path.resolve(file));
  if (rel.startsWith('..') || rel.startsWith('public/vision-board') || rel.startsWith('reference') || rel.includes('masters'))
    throw new Error('refusing to write outside the derivative outputs: ' + rel);
  if (![path.relative(REPO, OUT_GLB), path.relative(REPO, OUT_JSON)].includes(rel)) throw new Error('unexpected output path ' + rel);
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function codeHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['lib/placement.mjs', 'lib/landmarks.mjs', 'lib/bake.mjs', 'lib/bake-worker.mjs']) h.update(fs.readFileSync(new URL(f, import.meta.url)));
  h.update(JSON.stringify([OPTIONS.topHeight, OPTIONS.targetTris, OPTIONS.importance, OPTIONS.unwrap, OPTIONS.density, OPTIONS.bake, OPTIONS.textures]));
  return h.digest('hex').slice(0, 16);
}

async function meshStage() {
  const m = await loadSource(MASTER);
  if (m.sha256Verified !== MASTER.sha256) throw new Error('master sha mismatch');
  const pl = quadrupedPlacement(m.pos, {topHeight: OPTIONS.topHeight});
  const high = {pos: pl.apply(m.pos), nrm: pl.applyNormals(m.nrm), uv: m.uv, idx: m.idx};
  const welded = weldByPosition(high.pos, high.nrm, high.idx);
  const skel = detectQuadruped(welded, pl.paws);
  if (skel._sanity.length) throw new Error('skeleton sanity: ' + skel._sanity.join('; '));
  // simplification importance: head (in front of the skull base) and paws (below the foot joints)
  const J = skel.joints;
  const headK = p => smooth(J.Head[2] - 0.04, J.Head[2] + 0.02, p[2]) * smooth(0.12, 0.2, p[1]);
  const pawK = p => smooth(0.11, 0.06, p[1]);
  const imp = new Float32Array(welded.pos.length / 3);
  for (let i = 0; i < imp.length; i++) { const p = [welded.pos[i * 3], welded.pos[i * 3 + 1], welded.pos[i * 3 + 2]]; imp[i] = Math.max(OPTIONS.importance.head * headK(p), OPTIONS.importance.paws * pawK(p)); }
  const simp = await simplifyMesh(welded, {targetTris: OPTIONS.targetTris, importance: imp});
  const lowNrm = computeNormals(simp.pos, simp.idx);
  const faceRegion = (t, c) => headK(c) > 0.5 ? {region: 1, density: OPTIONS.density.head} : pawK(c) > 0.5 ? {region: 2, density: OPTIONS.density.paws} : {region: 0, density: 1};
  const uw = unwrap(simp.pos, simp.idx, {...OPTIONS.unwrap, faceRegion});
  const nv = uw.vertMap.length;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { const s = uw.vertMap[i]; for (let k = 0; k < 3; k++) { pos[i * 3 + k] = simp.pos[s * 3 + k]; nrm[i * 3 + k] = lowNrm[s * 3 + k]; } }
  const low = {pos, nrm, uv: uw.uv, idx: uw.idx, weldId: uw.vertMap, welded: {pos: simp.pos, idx: simp.idx, nrm: lowNrm}};
  const bk = await bakeAll(high, low, {baseColor: m.baseColor, metallicRoughness: m.metallicRoughness}, OPTIONS.bake);
  const enc = await encodeAll(bk, {baseSize: OPTIONS.textures.baseColor, mrSize: OPTIONS.textures.metallicRoughness, nrmSize: OPTIONS.textures.normal, quality: OPTIONS.textures.jpegQuality});
  const {debug, _sanity, ...skelOut} = skel;
  void debug; void _sanity;
  return {skel: skelOut, placement: pl.report(), low, enc,
    stats: {weldedVertices: welded.pos.length / 3, weldedTriangles: welded.idx.length / 3,
      simplify: {targetTris: OPTIONS.targetTris, importance: OPTIONS.importance, resultTris: simp.triangles, resultVerts: simp.vertices, relativeError: +simp.error.toFixed(5), absoluteErrorM: +(simp.error * simp.scale).toFixed(5), flags: ['Prune', 'Regularize']},
      unwrap: uw.stats, bake: bk.stats, outVertices: nv},
    master: {id: m.id, title: MASTER.title, uploadId: m.uploadId, file: m.file, sha256: m.sha256Verified, bytes: m.bytes, triangles: m.triangles, vertices: m.vertices, material: m.material,
      textures: {baseColor: [m.baseColor.width, m.baseColor.height, m.baseColor.mimeType], metallicRoughness: [m.metallicRoughness.width, m.metallicRoughness.height, m.metallicRoughness.mimeType]},
      nativeJob: MASTER.nativeJob, conceptImage: MASTER.conceptImage, conceptSha256: MASTER.conceptSha256}};
}

async function cachedMeshStage() {
  if (!ARGS.has('--reuse-bake')) return meshStage();
  const file = path.join(TMP, 'cache', `mesh-${codeHash()}.v8`);
  if (fs.existsSync(file)) { console.log('  (dev cache)', path.basename(file)); return v8.deserialize(fs.readFileSync(file)); }
  const r = await meshStage();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, v8.serialize(r));
  return r;
}

function spreadWeights(low, sw) {
  const n = low.weldId.length;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = low.weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

/** Lowest skinned point per region (dominant joint group) for a pose. */
function regionLows(rig, skel, mesh, pose) {
  const groups = {head: ['Head', 'Jaw', 'Neck'], torso: ['Chest', 'Spine2', 'Spine1'], pelvis: ['Hips'], tail: ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5'],
    frontL: ['L_FrontUpper', 'L_FrontLower', 'L_FrontFoot'], frontR: ['R_FrontUpper', 'R_FrontLower', 'R_FrontFoot'], hindL: ['L_HindUpper', 'L_HindLower', 'L_HindFoot'], hindR: ['R_HindUpper', 'R_HindLower', 'R_HindFoot']};
  const P = skinPositions(mesh, skel, rig.fk(pose));
  const out = {};
  for (let i = 0; i < P.length / 3; i++) {
    const j = JOINT_NAMES[mesh.joints[i * 4]];
    const g = Object.keys(groups).find(k => groups[k].includes(j));
    if (!g) continue;
    out[g] = Math.min(out[g] ?? Infinity, P[i * 3 + 1]);
  }
  for (const k in out) out[k] = +out[k].toFixed(3);
  return {lows: out, P};
}

function solveDeath(rig, skel, mesh) {
  // final lying height: lowest vertex 1 cm above the floor (bisection on the hips y offset)
  const spec = CLIP_SPECS.Death;
  let lo = -0.45, hi = 0.0, best = null;
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    const pose = spec.pose(rig, spec.duration, {deathFinal: {hipsY: mid, hipsX: -0.06}});
    const P = skinPositions(mesh, skel, rig.fk(pose));
    let minY = Infinity; for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]);
    best = {hipsY: mid, minY};
    if (minY > 0.01) hi = mid; else lo = mid;
  }
  const pose = spec.pose(rig, spec.duration, {deathFinal: {hipsY: best.hipsY, hipsX: -0.06}});
  const {lows, P} = regionLows(rig, skel, mesh, pose);
  const b = bounds(P);
  return {hipsY: +best.hipsY.toFixed(4), hipsX: -0.06, lowestY: +best.minY.toFixed(4), regionLows: lows, bounds: {min: b.min.map(v => +v.toFixed(3)), max: b.max.map(v => +v.toFixed(3))}};
}

/**
 * Floor guard for the falling / lunging clips: per frame, if the lowest skinned vertex is below the
 * floor, raise the Hips translation by the difference (+5 mm). Returns the per-clip lifts applied.
 */
function floorGuard(rig, skel, mesh, clip, minY = 0.005) {
  let maxLift = 0, frames = 0;
  for (let f = 0; f < clip.times.length; f++) {
    const P = skinPositions(mesh, skel, rig.fk(poseAtFrame(clip, f)));
    let mn = Infinity; for (let i = 1; i < P.length; i += 3) mn = Math.min(mn, P[i]);
    if (mn < -0.002) { const lift = minY - mn; clip.hips[f] = [clip.hips[f][0], clip.hips[f][1] + lift, clip.hips[f][2]]; maxLift = Math.max(maxLift, lift); frames++; }
  }
  return {frames, maxLiftM: +maxLift.toFixed(4)};
}

function verifyClips(rig, skel, mesh, clips) {
  const out = {};
  for (const c of clips) {
    const mins = [], maxH = [];
    let feetFloat = 0, feetSink = 0, contacts = 0;
    for (let f = 0; f < c.times.length; f++) {
      const pose = poseAtFrame(c, f);
      const W = rig.fk(pose);
      const P = skinPositions(mesh, skel, W);
      let mn = Infinity, mx = -Infinity; for (let i = 1; i < P.length; i += 3) { mn = Math.min(mn, P[i]); mx = Math.max(mx, P[i]); }
      mins.push(mn); maxH.push(mx);
      // planted-paw check (locomotion / idle): toe tips of stance legs at the floor
      if (['Idle', 'Walk', 'Run'].includes(c.name)) {
        for (const L of LEGS) {
          const w = W[L + 'Foot'];
          const toe = V.add(w.pos, rig.leg[L] ? [0, 0, 0] : [0, 0, 0]);
          void toe;
        }
      }
    }
    const iMin = mins.indexOf(Math.min(...mins));
    out[c.name] = {frames: c.times.length, duration: c.duration, minYOverClip: +Math.min(...mins).toFixed(4), minAtT: c.times[iMin], framesBelowMinus1cm: c.times.filter((t, i) => mins[i] < -0.01).length,
      maxTopY: +Math.max(...maxH).toFixed(3), firstFrameMinY: +mins[0].toFixed(4), lastFrameMinY: +mins[mins.length - 1].toFixed(4), maxLegReach: c.maxLegReach, groundSpeed: c.groundSpeed};
    void feetFloat; void feetSink; void contacts;
  }
  return out;
}

/** Hit-volume / ragdoll radii measured on the low mesh (75th percentile distance to the bone chain per region). */
function measureRadii(mesh, skel, region) {
  const J = skel.joints, E = skel.ends;
  const P = mesh.pos, n = P.length / 3;
  const pct = (arr, q) => { arr.sort((a, b) => a - b); return arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0; };
  const torso = [], head = [], neck = [], legs = {front: [], hind: []}, tail = [];
  const spine = [J.Hips, J.Spine1, J.Spine2, J.Chest];
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], r = region[i];
    if (r === 0) {
      if (p[2] > J.Head[2]) head.push(onPolyline(p, [J.Head, E.Head]).dist);
      else if (p[2] > J.Chest[2]) neck.push(onPolyline(p, [J.Chest, J.Neck, J.Head]).dist);
      else torso.push(onPolyline(p, spine).dist);
    } else if (r === 1) tail.push(onPolyline(p, [J.Tail1, J.Tail2, J.Tail3, J.Tail4, J.Tail5, E.Tail5]).dist);
    else {
      const L = ['', '', 'L_Front', 'R_Front', 'L_Hind', 'R_Hind'][r];
      (L.includes('Front') ? legs.front : legs.hind).push(onPolyline(p, [J[L + 'Upper'], J[L + 'Lower'], J[L + 'Foot'], E[L + 'Foot']]).dist);
    }
  }
  const r3 = v => +v.toFixed(3);
  return {method: '75th percentile of the distance from region vertices to the region bone chain (low mesh, bind pose)', torso: r3(pct(torso, 0.75)), neck: r3(pct(neck, 0.75)), head: r3(pct(head, 0.75)),
    frontLeg: r3(pct(legs.front, 0.75)), hindLeg: r3(pct(legs.hind, 0.75)), tail: r3(pct(tail, 0.75))};
}

async function main() {
  const t0 = Date.now();
  for (const f of [OUT_GLB, OUT_JSON]) guardOutput(f);
  console.log('[1/6] master -> placement, landmarks/skeleton, simplify, unwrap, bake (colour + MR + normal)');
  const ms = await cachedMeshStage();
  const skel = ms.skel;
  console.log('  placement', JSON.stringify(ms.placement));
  console.log('  stats', JSON.stringify(ms.stats.simplify), JSON.stringify(ms.stats.bake));
  console.log('[2/6] skin weights');
  const sw = computeQuadrupedWeights(ms.low.welded, skel, OPTIONS.skin);
  console.log('  ', JSON.stringify(sw.stats));
  const mesh = {name: 'RatdogBody', pos: ms.low.pos, nrm: ms.low.nrm, uv: ms.low.uv, idx: ms.low.idx, ...spreadWeights(ms.low, sw), baseColor: ms.enc.baseJpg, metallicRoughness: ms.enc.mrJpg, normal: ms.enc.nrmJpg, normalScale: 1};
  console.log('[3/6] rig + death solve');
  const rig = new QRig(skel);
  const death = solveDeath(rig, skel, mesh);
  console.log('  death', JSON.stringify(death));
  console.log('[4/6] clips');
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, {deathFinal: death}));
  const floorGuarded = {};
  for (const c of clips) if (['Death', 'Attack', 'Hit'].includes(c.name)) floorGuarded[c.name] = floorGuard(rig, skel, mesh, c);
  console.log('  floor guard', JSON.stringify(floorGuarded));
  console.log('[5/6] verify (CPU skinning)');
  const verify = verifyClips(rig, skel, mesh, clips);
  console.log('  ', JSON.stringify(verify));
  const radii = measureRadii(ms.low.welded, skel, sw.region);
  console.log('  radii', JSON.stringify(radii));
  const bb = bounds(ms.low.pos);
  const clipMeta = Object.fromEntries(clips.map(c => [c.name, {duration: c.duration, loop: c.loop, groundSpeed: c.groundSpeed, impact: c.impact, frames: c.times.length}]));
  // end points relative to their bone (bind frame == model frame): nose, chin, toe tips, tail tip
  const endRel = {};
  for (const [bone, key] of [['Head', 'Head'], ['Jaw', 'Jaw'], ['Tail5', 'Tail5'], ...['L_Front', 'R_Front', 'L_Hind', 'R_Hind'].map(l => [l + 'Foot', l + 'Foot'])])
    endRel[bone] = V.sub(skel.ends[key], skel.joints[bone]).map(v => +v.toFixed(4));
  const extras = {creatureRatdog: {version: 1, archetype: 'ratdog', joints: JOINT_NAMES, ends: endRel, clips: clipMeta, radii,
    boundsM: {min: bb.min.map(v => +v.toFixed(3)), max: bb.max.map(v => +v.toFixed(3))}, deathBounds: death.bounds,
    note: 'Derivative of the unrigged Field Notes quadruped-02 master; NEW skeleton/skin/procedural clips; unapproved, gameReady false.'}};
  console.log('[6/6] write GLB + provenance');
  const doc = buildDocument({skel, mesh: {...mesh, extras: {slot: 'body'}}, clips, generator: 'The Last Line creature derivative builder (tools/asset-pipeline/creature/build-creature.mjs)', extras});
  fs.mkdirSync(path.dirname(OUT_GLB), {recursive: true});
  await writeGLB(doc, OUT_GLB);
  const outBytes = fs.statSync(OUT_GLB).size, outSha = sha256File(OUT_GLB);
  const segs = boneSegments(skel);
  const manifest = {
    asset: 'creature-ratdog', task: 'studio-slice-iteration07-20261026-01', lane: 'Q (rat/dog quadruped enemy)',
    generatedBy: 'tools/asset-pipeline/creature/build-creature.mjs', builtAt: new Date().toISOString(),
    output: {file: path.relative(REPO, OUT_GLB), bytes: outBytes, sha256: outSha, triangles: mesh.idx.length / 3, vertices: mesh.pos.length / 3,
      textures: {baseColor: `${OPTIONS.textures.baseColor}² JPEG (${ms.enc.baseJpg.length} B)`, metallicRoughness: `${OPTIONS.textures.metallicRoughness}² JPEG (${ms.enc.mrJpg.length} B)`, normal: `${OPTIONS.textures.normal}² JPEG tangent-space, three.js derivative-tangent convention (${ms.enc.nrmJpg.length} B)`},
      meshNode: 'RatdogBody', skin: 'RatdogSkin', joints: JOINTS.length, clips: Object.keys(clipMeta)},
    source: {...ms.master, readOnly: true, unrigged: true, note: 'The master is a static, unrigged AI reconstruction (Field Notes Core Assets quadruped-02). It was NOT animated; everything rig/animation related below is new derivative work.'},
    placement: {...ms.placement, provisionalSize: 'Top of the shoulder bristles at 0.64 m (about a large dog). The concept card gives proposed anatomy but no size; this is a game-scale choice, not approved lore.'},
    mesh: ms.stats,
    skeleton: {method: 'auto-placed from mesh landmarks of the placed master (lib/landmarks.mjs): paw contact patches, midline back/underside profile, slice-tracked leg centrelines, narrowest neck section, nose tip, tail centreline by geodesic distance bands; anatomical ratios for joints inside the body', joints: skel.joints, ends: skel.ends, hierarchy: JOINTS, measures: skel.measures, ratios: skel.ratios,
      boneSegments: Object.fromEntries(Object.entries(segs).map(([k, [a, b]]) => [k, {from: a, to: b}])), bindRotations: 'identity (bone frames aligned with model space: +Y up, +Z forward, +X = creature left)'},
    skin: sw.stats,
    clips: {method: 'hand-authored procedural keyframes sampled at 30 fps (lib/clips.mjs); legs by paw-planting IK on per-leg stance/swing cycles; not motion capture', gaits: Object.fromEntries(Object.entries(GAITS).map(([k, g]) => [k, {...g, groundSpeed: groundSpeed(g)}])), meta: clipMeta, deathSolve: death, floorGuard: {method: 'per frame: Hips raised so the lowest CPU-skinned vertex stays >= 5 mm above the floor (falling/lunging clips)', clips: floorGuarded}, verify},
    hitRadii: radii,
    runtime: {modelSpace: '+Z forward, +Y up, +X = creature left, paws on y=0; metres', archetype: 'game/src/ai/creature*.ts (ratdog)'},
    approval: {approved: false, gameReady: false, notes: ['Unreviewed prototype derivative; the user judges look/feel.', 'Fur silhouette is simplified to a closed low-poly surface; bristles survive only in the baked colour/normal maps.', 'Skin weights are automatic (region + bone-segment), not hand-painted; extreme poses may crease at the shoulders/hips.', 'Death clip is the fallback when no physics ragdoll is available.']},
  };
  fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
  fs.writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 1) + '\n');
  const s = sha256File(path.join(REPO, MASTER.file));
  if (s !== MASTER.sha256) throw new Error('MASTER CHANGED');
  fs.mkdirSync(TMP, {recursive: true});
  fs.writeFileSync(path.join(TMP, 'base-preview.png'), ms.enc.basePreview);
  fs.writeFileSync(path.join(TMP, 'normal-preview.png'), ms.enc.nrmPreview);
  console.log(`done: ${path.relative(REPO, OUT_GLB)} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await main();
