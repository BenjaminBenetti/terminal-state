#!/usr/bin/env node
// The Last Line - rigged zombie derivative builder (single reproducible entry point).
//   node tools/asset-pipeline/zombie/build-zombie.mjs            full deterministic rebuild
//   node tools/asset-pipeline/zombie/build-zombie.mjs --reuse-bake   dev only: reuse cached mesh/bake stages in /tmp/ll-zombie
//   (--skip-coat: dev only, body without coat)
// Reads the two static AI-reconstructed masters (read-only, sha256-verified), writes ONLY:
//   game/public/assets/models/zombie-rigged.glb
//   game/public/assets/derivatives/zombie-rigged.json
// The masters had no skeleton; this script creates a NEW derivative rig, automatic skin weights
// and hand-authored procedural keyframe clips (not mocap).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {REPO, MASTERS, loadMaster, sha256File} from './lib/master.mjs';
import {bodyPlacement, placeHigh, lowPolyAndBake} from './lib/stage-mesh.mjs';
import {weldByPosition} from './lib/mesh.mjs';
import {detectSkeleton} from './lib/skeleton.mjs';
import {computeSkinWeights, JOINT_NAMES} from './lib/skin.mjs';
import {Rig} from './lib/pose.mjs';
import {CLIP_SPECS, sampleClip, deathFinal, realize} from './lib/clips.mjs';
import {buildDocument, writeGLB, skinPositions} from './lib/glb.mjs';
import {buildCoat} from './lib/coat.mjs';
import {makeManifest} from './lib/manifest.mjs';

const ARGS = new Set(process.argv.slice(2));
const TMP = '/tmp/ll-zombie';
const OUT_GLB = path.join(REPO, 'game/public/assets/models/zombie-rigged.glb');
const OUT_JSON = path.join(REPO, 'game/public/assets/derivatives/zombie-rigged.json');

function guardOutput(file) {
  const rel = path.relative(REPO, path.resolve(file));
  if (rel.startsWith('..') || rel.startsWith('public/vision-board') || rel.startsWith('reference') || rel.includes('masters'))
    throw new Error('refusing to write outside the derivative outputs: ' + rel);
  if (![path.relative(REPO, OUT_GLB), path.relative(REPO, OUT_JSON)].includes(rel)) throw new Error('unexpected output path ' + rel);
}

const OPTIONS = {
  height: 1.78,
  body: {
    targetTris: 17000,
    importance: {head: 100, hands: 40, note: 'extra simplifier attribute = position * k; head ~2x triangles (3.2k vs 1.6k at k=0)'},
    unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
    density: {head: 1.8, hands: 1.3},
    bake: {size: 2048, cage: 0.015, rayBelow: 0.004},
    textures: {baseColor: 1024, metallicRoughness: 512, jpegQuality: 92},
  },
  coat: {
    targetTris: 10500,
    unwrap: {coneDeg: 66, validDot: 0.15, minChartFaces: 80, smoothIters: 12, atlas: 1024, pad: 6},
    bake: {size: 2048, cage: 0.012, rayBelow: 0.004},
    textures: {baseColor: 1024, metallicRoughness: 512, jpegQuality: 92},
    thighFollow: 0.45,
    pushOut: {margin: 0.012, radius: 0.06, rounds: 8, smoothIters: 6},
    backTaper: {hemFactor: 0.3, fullAboveY: 1.25, clearance: 0.015, fullTaperBelowY: 'hipY'},
  },
  skin: {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4},
  fps: 30,
};

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function codeHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['lib/master.mjs', 'lib/mesh.mjs', 'lib/unwrap.mjs', 'lib/bake.mjs', 'lib/bake-worker.mjs', 'lib/stage-mesh.mjs', 'lib/skeleton.mjs', 'lib/slices.mjs', 'lib/coat.mjs'])
    h.update(fs.readFileSync(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 16);
}
const BAKE_DEPS = {body: () => [OPTIONS.height, OPTIONS.body], coat: () => [OPTIONS.coat.targetTris, OPTIONS.coat.unwrap, OPTIONS.coat.bake, OPTIONS.coat.textures]};
async function cached(key, fn) {
  if (!ARGS.has('--reuse-bake')) return fn();
  const file = path.join(TMP, 'cache', `${key}-${codeHash()}-${crypto.createHash('sha256').update(JSON.stringify(BAKE_DEPS[key]())).digest('hex').slice(0, 12)}.v8`);
  if (fs.existsSync(file)) { console.log('  (dev cache)', path.basename(file)); return v8.deserialize(fs.readFileSync(file)); }
  const r = await fn();
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, v8.serialize(r));
  return r;
}

function slimSkeleton(sk) {
  const arms = {}; for (const s of ['L', 'R']) { const {ids, line, ...rest} = sk.arms[s]; arms[s] = rest; }
  return {...sk, arms};
}

async function bodyStage() {
  const m = await loadMaster('body');
  const placement = bodyPlacement(m, OPTIONS.height);
  const high = placeHigh(m, placement);
  const welded = weldByPosition(high.pos, high.nrm, high.idx);
  const skel = slimSkeleton(detectSkeleton(welded.pos));
  const O = OPTIONS.body;
  const neckY = skel.neckBaseY;
  const inHand = (p, s) => {
    const a = skel.arms[s];
    const d = (p[0] - a.wrist[0]) * a.dir[0] + (p[1] - a.wrist[1]) * a.dir[1] + (p[2] - a.wrist[2]) * a.dir[2];
    return Math.abs(p[0]) > 0.3 && (s === 'L' ? p[0] > 0 : p[0] < 0) ? d : -1;
  };
  const importanceOf = p => Math.max(O.importance.head * smooth(neckY - 0.06, neckY + 0.02, p[1]), ...['L', 'R'].map(s => O.importance.hands * smooth(-0.04, 0, inHand(p, s))));
  const faceRegion = (t, c) => {
    if (c[1] > neckY - 0.03) return {region: 1, density: O.density.head};
    if (['L', 'R'].some(s => inHand(c, s) > -0.01)) return {region: 2, density: O.density.hands};
    return {region: 0, density: 1};
  };
  const r = await lowPolyAndBake(high, m, {targetTris: O.targetTris, importanceOf, faceRegion, unwrapOpts: O.unwrap, bakeSize: O.bake.size, bakeOpts: {cage: O.bake.cage, rayBelow: O.bake.rayBelow}, baseSize: O.textures.baseColor, mrSize: O.textures.metallicRoughness, quality: O.textures.jpegQuality});
  const {nativeBounds, ...pl} = placement;
  return {skel, placement: {...pl, nativeBounds}, low: r.low, enc: {baseJpg: r.enc.baseJpg, mrJpg: r.enc.mrJpg, basePreview: r.enc.basePreview}, stats: r.stats,
    master: {id: m.id, uploadId: m.uploadId, file: m.file, sha256: m.sha256Verified, bytes: m.bytes, triangles: m.triangles, vertices: m.vertices, material: m.material, textures: {baseColor: [m.baseColor.width, m.baseColor.height, m.baseColor.mimeType], metallicRoughness: [m.metallicRoughness.width, m.metallicRoughness.height, m.metallicRoughness.mimeType]}}};
}

function rigFor(skel) {
  return {joints: skel.joints, ends: skel.ends, cut: skel.cut, wall: skel.wall, crotchY: skel.crotchY, hipY: skel.hipY, neckY: skel.neckY, headY: skel.headY, kneeY: skel.kneeY, ankleY: skel.ankleY};
}

/** Copy welded-vertex weights onto UV-split output vertices (identical weights across seams). */
function spreadWeights(low, sw) {
  const n = low.weldId.length;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = low.weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

/** Lowest point per body region (by dominant joint) for a pose: checks floor contact. */
function regionFloorReport(rig, skel, meshes, pose) {
  const groups = {head: ['Head', 'Neck'], torso: ['Chest', 'Spine'], pelvis: ['Hips'], armL: ['L_UpperArm', 'L_Forearm', 'L_Hand'], armR: ['R_UpperArm', 'R_Forearm', 'R_Hand'], legL: ['L_Thigh', 'L_Shin', 'L_Foot'], legR: ['R_Thigh', 'R_Shin', 'R_Foot']};
  const world = rig.fk(pose);
  const out = {};
  for (const m of meshes) {
    const P = skinPositions(m, skel, world);
    for (let i = 0; i < P.length / 3; i++) {
      const j = JOINT_NAMES[m.joints[i * 4]];
      const g = Object.keys(groups).find(k => groups[k].includes(j));
      if (!g) continue;
      const key = (m.name === 'ZombieCoat' ? 'coat.' : '') + g;
      out[key] = Math.min(out[key] ?? Infinity, P[i * 3 + 1]);
    }
  }
  for (const k in out) out[k] = +out[k].toFixed(3);
  return out;
}

const DEATH_PARAMS = {hipsPitch: [-95, -80], hipsRoll: [-12, 12], neck: [-35, 10], head: [-30, 10], headYaw: [-80, -20], armLz: [-0.8, 0], armRz: [-0.8, 0], footLz: [0.0, 0.5], footRz: [-0.2, 0.35]};
function solveDeathPose(rig, skel, meshes) {
  const regions = ['torso', 'pelvis', 'head', 'armL', 'armR', 'legL', 'legR'];
  let evals = 0;
  const evaluate = tune => {
    evals++;
    let hipsY = -0.64, rep;
    for (let it = 0; it < 3; it++) {
      rep = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(hipsY, tune)));
      // IK keeps the heels on the floor whatever the hip height, so solve on everything else
      const min = Math.min(...Object.entries(rep).filter(([k]) => !/leg[LR]$/.test(k)).map(([, v]) => v));
      hipsY += 0.01 - min;
    }
    rep = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(hipsY, tune)));
    const target = 0.015;
    let cost = 0;
    for (const r of regions) cost += Math.pow(Math.max(0, rep[r] - target), 2) + 4 * Math.pow(Math.min(0, rep[r] - target), 2);
    return {cost, hipsY, rep};
  };
  let tune = {hipsPitch: -88, hipsRoll: 5, neck: -4, head: -6, headYaw: -38, armLz: -0.3, armRz: -0.3, footLz: 0.42, footRz: 0.12};
  let best = evaluate(tune);
  let step = 0.25;
  for (let round = 0; round < 6; round++) {
    for (const [k, [lo, hi]] of Object.entries(DEATH_PARAMS)) {
      for (const dir of [1, -1]) {
        const cand = {...tune, [k]: Math.min(hi, Math.max(lo, tune[k] + dir * step * (hi - lo)))};
        const r = evaluate(cand);
        if (r.cost < best.cost - 1e-7) { best = r; tune = cand; }
      }
    }
    step /= 2;
  }
  return {tune: Object.fromEntries(Object.entries(tune).map(([k, v]) => [k, +v.toFixed(3)])), hipsY: best.hipsY, cost: best.cost, evals, report: best.rep};
}

function verifyClips(rig, skel, meshes, clips) {
  const out = {};
  for (const c of clips) {
    const rows = [];
    for (let f = 0; f < c.times.length; f += 1) {
      const pose = {hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))};
      const world = rig.fk(pose);
      const r = {t: c.times[f]};
      for (const m of meshes) {
        const P = skinPositions(m, skel, world);
        let min = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < min) min = P[i];
        r[m.name] = +min.toFixed(4);
      }
      rows.push(r);
    }
    const mins = rows.map(r => Math.min(...meshes.map(m => r[m.name])));
    const iMin = mins.indexOf(Math.min(...mins));
    const below = rows.filter((r, i) => mins[i] < -0.01).map(r => r.t);
    out[c.name] = {minYOverClip: +Math.min(...mins).toFixed(4), minAtT: rows[iMin].t, framesBelowMinus1cm: below, maxOfFrameMinY: +Math.max(...mins).toFixed(4), firstFrameMinY: mins[0], lastFrameMinY: mins[mins.length - 1], maxLegReach: c.maxLegReach};
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  for (const f of [OUT_GLB, OUT_JSON]) guardOutput(f);
  console.log('[1/6] body master -> placement, skeleton, simplify, unwrap, bake');
  const body = await cached('body', bodyStage);
  const skel = body.skel;
  console.log('  joints', JSON.stringify(skel.joints));
  console.log('  body', JSON.stringify(body.stats.simplify), JSON.stringify(body.stats.unwrap), JSON.stringify(body.stats.bake));

  console.log('[2/6] body skin weights');
  const rigDesc = rigFor(skel);
  const bodyW = computeSkinWeights(body.low.welded, rigDesc, {kind: 'body', ...OPTIONS.skin});
  const bodyMesh = {name: 'ZombieBody', pos: body.low.pos, nrm: body.low.nrm, uv: body.low.uv, idx: body.low.idx, ...spreadWeights(body.low, bodyW), baseColor: body.enc.baseJpg, metallicRoughness: body.enc.mrJpg};

  let coat = null, coatMesh = null;
  if (!ARGS.has('--skip-coat')) {
    console.log('[3/6] coat master -> global fit, simplify, unwrap, bake, sleeve retarget, skin');
    coat = await buildCoat({skel, rigDesc, options: OPTIONS.coat, skinOptions: OPTIONS.skin, cached, bodyWelded: body.low.welded, bodyWeights: bodyW});
    console.log('  coat fit', JSON.stringify(coat.fit.scale), JSON.stringify(coat.fit.translate), 'pushOut', JSON.stringify(coat.pushOut), 'retarget', JSON.stringify(coat.retarget));
    coatMesh = {name: 'ZombieCoat', pos: coat.low.pos, nrm: coat.low.nrm, uv: coat.low.uv, idx: coat.low.idx, joints: coat.joints, weights: coat.weights, baseColor: coat.enc.baseJpg, metallicRoughness: coat.enc.mrJpg};
  }
  const meshes = [bodyMesh, coatMesh].filter(Boolean);

  console.log('[4/6] procedural clips');
  const rig = new Rig(skel);
  // Death final pose: deterministic coordinate descent over a few pose parameters so every body
  // region rests close to the floor, with the overall lowest vertex (body+coat) at +1 cm.
  const death = solveDeathPose(rig, skel, meshes);
  const deathHipsY = death.hipsY;
  console.log('  death solve', JSON.stringify(death.tune), 'cost', death.cost.toFixed(5), 'evals', death.evals);
  const deathContact = regionFloorReport(rig, skel, meshes, realize(rig, deathFinal(deathHipsY, death.tune)));
  console.log('  death final pose: hips y offset', deathHipsY.toFixed(4), 'lowest point per region (m):', JSON.stringify(deathContact));
  {
    const world = rig.fk(realize(rig, deathFinal(deathHipsY, death.tune)));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) { const P = skinPositions(m, skel, world); for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); } }
    death.bounds = {min: lo.map(v => +v.toFixed(3)), max: hi.map(v => +v.toFixed(3))};
  }
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, {deathHipsY, deathTune: death.tune}));

  console.log('[5/6] verify (CPU skinning)');
  const verify = verifyClips(rig, skel, meshes, clips);
  console.log('  ', JSON.stringify(verify));

  console.log('[6/6] write GLB + manifest');
  const doc = buildDocument({skel, meshes, clips, generator: 'The Last Line zombie derivative builder (tools/asset-pipeline/zombie/build-zombie.mjs)'});
  fs.mkdirSync(path.dirname(OUT_GLB), {recursive: true});
  await writeGLB(doc, OUT_GLB);
  const outBytes = fs.statSync(OUT_GLB).size, outSha = sha256File(OUT_GLB);
  const manifest = makeManifest({body, coat, skel, bodyW, clips, verify, outBytes, outSha, deathHipsY, deathContact, death, bodyMesh, coatMesh, OPTIONS, CLIP_SPECS, OUT_GLB, OUT_JSON, REPO});
  fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
  fs.writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n');
  // masters must be unchanged
  for (const k of ['body', 'coat']) { const s = sha256File(path.join(REPO, MASTERS[k].file)); if (s !== MASTERS[k].sha256) throw new Error('MASTER CHANGED ' + k); }
  fs.writeFileSync(path.join(TMP, 'body-base-preview.png'), body.enc.basePreview);
  if (coat) fs.writeFileSync(path.join(TMP, 'coat-base-preview.png'), coat.enc.basePreview);
  console.log(`done: ${path.relative(REPO, OUT_GLB)} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await main();
