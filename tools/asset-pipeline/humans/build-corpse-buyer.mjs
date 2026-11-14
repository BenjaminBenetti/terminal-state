#!/usr/bin/env node
// Task studio-corpse-market-shop-20261114-031614-01 (lane ASSET): THE CORPSE BUYER — one clothed Meshy T2.5 body rigged and animated
// LOCALLY with the friendly market humans' pipeline, written in the exact market-human-cast.glb layout (a one-body cast, no wearables),
// so market/humanWardrobe.ts HumanWardrobe loads it unchanged and build({body: 'cb', wear: {}, scale: 1}) works.
// CPU only: no generation, inference, provider rig / animation or network service (the paid T2.5 generation is finished).
//   LL_THREADS=1 node --max-old-space-size=6000 tools/asset-pipeline/humans/build-corpse-buyer.mjs [--dry-run] [--out=DIR]
//   --dry-run   build + audit, write nothing        --out=DIR  write the GLB / JSON to DIR only (QA; nothing else touched)
//
// Reuses (imports, none edited; the market-human-cast.glb build and its config are untouched):
//   lib/body.mjs humanBodyStage (the Meshy mesh / UVs / maps KEPT, skeleton detected on a densified copy, documented landmark
//   fixes) + trimLegBridges; zombie/lib/autorig.mjs bodySkin / spreadWeights / bodyProfile; lib/clips.mjs HUMAN_CLIP_SPECS (the
//   healthy clips: Idle, Walk, Talk, Greet, Work, Sit) with walkGait / solveSit fitted to this body; lib/glb.mjs buildCastDocument.
// Reads (never modifies) the private task records (../props/lib/corpse-shop-records.mjs: the master + Codex input verified by sha256
// against the finance ledger) and writes deterministically:
//   game/public/assets/models/market-corpse-buyer.glb        Market-only (assets/levelAssets.ts LEVEL_ONLY_RULES 'market-*')
//   game/public/assets/derivatives/market-corpse-buyer.json  provenance + fit / clip QA record (hash-only: no URLs / tokens)
//   game/src/assets/corpseBuyer.generated.ts                 CORPSE_BUYER_MODEL {key, url, bytes, body, heightM}
//   tools/release/public-inputs.json                         ONLY this script's two paths (+ the recomputed CREDITS.md row)
//   game/public/assets/CREDITS.md                            the marked corpse-shop section (shared with build-corpse-shop-kit.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bodySkin, bodyProfile, spreadWeights} from '../zombie/lib/autorig.mjs';
import {hitRadii} from '../zombie/lib/hit.mjs';
import {auditPoses, triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {Rig} from '../zombie/lib/pose.mjs';
import {geometryHash, writeDoc} from '../zombie/lib/variant-glb.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {humanBodyStage, trimLegBridges} from './lib/body.mjs';
import {HUMAN_CLIP_SPECS, sampleHumanClip, walkGait, solveSit} from './lib/clips.mjs';
import {buildCastDocument} from './lib/glb.mjs';
import {HUMAN_QUALITY, HUMAN_SKIN} from './humans.config.mjs';
import {ROOT, TASK, PUB, BUYER_PROV_REL, sha, verifyMaster, assertPublicSafe, writeCredits, updateAllowlist} from '../props/lib/corpse-shop-records.mjs';

if (+process.env.LL_THREADS > 0) { const cpus = os.cpus; os.cpus = () => cpus().slice(0, +process.env.LL_THREADS); }
const ARGS = new Set(process.argv.slice(2));
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.replace(/^--/, '').split('=')));
const DRY = ARGS.has('--dry-run');
const OUT_ROOT = OPT.out ? path.resolve(OPT.out) : null;
const GLB_REL = 'assets/models/market-corpse-buyer.glb';
const REG = path.join(ROOT, 'game/src/assets/corpseBuyer.generated.ts');
const GENERATOR = 'Terminal State corpse buyer builder (tools/asset-pipeline/humans/build-corpse-buyer.mjs; the market humans pipeline)';
const CLIP_NAMES = Object.keys(HUMAN_CLIP_SPECS);
const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);

/**
 * The body. id 'cb' (one file of its own: the cast layout's node names are prefixed with it). Fully clothed in his own Meshy mesh
 * (roll-neck, leather waistcoat, elbow-length rubber gloves, work trousers, tall rubber boots): no wearables. Textures as the market
 * cast (Meshy's base colour kept at 2048: a face seen across the booth's counter). skeleton / fix: zombie/lib/skeleton.mjs options /
 * lib/body.mjs applyFixes, only when the detector needs them (documented in the record).
 */
const BODY = {id: 'cb', label: 'Corpse buyer, about 55, very tall and gaunt', heightM: 1.85,
  textures: {baseColor: 2048, normal: 1024, metallicRoughness: 512, jpegQuality: 85, normalQuality: 90},
  skeleton: null, fix: null,
  what: 'the corpse buyer: a very tall, gaunt man of about 55 (balding, round dark-tinted spectacles, a thin closed-mouth smile) in a charcoal roll-neck, an oxblood leather waistcoat, elbow-length black rubber gloves, dark work trousers and tall rubber boots; rigged / animated locally with the market humans\' healthy clips'};

async function main() {
  const t0 = Date.now();
  const {file, record} = verifyMaster('CORPSE_BUYER');
  const src = {id: 'corpse-buyer', file, sha256: record.master.sha256, displayName: `CORPSE_BUYER-${record.reservation}`};
  console.log(`[corpse buyer ${BODY.id}] ${record.master.file}`);
  // ---- 1. body stage: placed Meshy mesh (maps kept), skeleton, skin weights, girth profile, hit radii
  const stage = await humanBodyStage(src, {heightM: BODY.heightM, skeleton: BODY.skeleton, fix: BODY.fix, textures: BODY.textures});
  if (stage.issues.length) console.log(`  skeleton notes: ${stage.issues.join('; ')}`);
  const sw = bodySkin(stage, HUMAN_SKIN);
  const tr = trimLegBridges(stage.low, sw, stage.skel);
  stage.low = tr.low; stage.legBridgeTrim = {removed: tr.removed, method: tr.method};
  if (tr.removed) console.log(`  leg bridge trim: removed ${tr.removed} triangles`);
  const spread = spreadWeights(stage.low, sw);
  const profile = bodyProfile(stage.skel, stage.low.welded, sw);
  profile.hit = hitRadii(profile, stage.skel);
  // ---- 2. the healthy clips, fitted to this body (stride to his leg length, the sit solve against his own mesh)
  const rig = new Rig(stage.skel);
  const gait = walkGait(rig);
  const mesh = {pos: stage.low.pos, idx: stage.low.idx, joints: spread.joints, weights: spread.weights};
  const sit = solveSit(rig, stage.skel, mesh);
  const clips = CLIP_NAMES.map(n => sampleHumanClip(rig, n, {gait, sit}));
  console.log(`  ${stage.stats.runtimeTriangles} tris, H ${r4(stage.skel.H)} m, hit ${JSON.stringify(profile.hit)}; walk ${gait.groundSpeed} m/s (stride ${gait.stride}, reach ${gait.maxReach}); sit knee ${sit.knee} hips ${sit.hipsY}`);
  // ---- 3. motion audit (the market humans' gate) + floor (the lowest skinned vertex per clip)
  const poses = auditPoses(clips, {every: 3});
  const bs = triangleStretch(mesh, stage.skel, rig, poses);
  const motion = stretchStats(bs.worst, poses, bs.at, {ratio: HUMAN_QUALITY.stretchRatio});
  // per clip: how many triangles stretch > 2x / > 3x at their worst frame of that clip (arm-torso tearing shows up as such sheets)
  const perClip = Object.fromEntries(CLIP_NAMES.map(c => {
    const pc = poses.filter(p => p.clip === c), s = triangleStretch(mesh, stage.skel, rig, pc), st = stretchStats(s.worst, pc, s.at, {ratio: HUMAN_QUALITY.stretchRatio});
    return [c, {over2x: st.over2x, [`over${HUMAN_QUALITY.stretchRatio}x`]: st[`over${HUMAN_QUALITY.stretchRatio}x`], p99: st.p99, max: st.max}];
  }));
  console.log(`  motion: over${HUMAN_QUALITY.stretchRatio}x ${motion[`over${HUMAN_QUALITY.stretchRatio}x`]}/${motion.triangles} (${(motion.fractionOver * 100).toFixed(2)} %, limit ${HUMAN_QUALITY.maxFractionOver * 100} %); per clip ${JSON.stringify(perClip)}`);
  if (motion.fractionOver > HUMAN_QUALITY.maxFractionOver) throw new Error(`motion-quality gate: ${(motion.fractionOver * 100).toFixed(2)} % of the triangles stretch > ${HUMAN_QUALITY.stretchRatio}x`);
  const floor = {};
  for (const c of clips) {
    let lo = Infinity;
    for (let f = 0; f < c.times.length; f += 2) {
      const world = rig.fk({hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))});
      const P = skinPositions(mesh, stage.skel, world);
      for (let i = 1; i < P.length; i += 3) if (P[i] < lo) lo = P[i];
    }
    floor[c.name] = +lo.toFixed(4);
  }
  console.log(`  floor (lowest skinned vertex per clip): ${JSON.stringify(floor)}`);
  for (const [c, y] of Object.entries(floor)) if (Math.abs(y) > 0.03) throw new Error(`floor: ${c} lowest skinned vertex ${y} m (|y| > 3 cm: floating / sunk)`);

  // ---- 4. the one-body cast document (market-human-cast.glb layout)
  const extras = {body: BODY.id, label: BODY.label, heightM: r4(stage.skel.H), hit: profile.hit, triangles: stage.low.idx.length / 3, geometryHash: geometryHash(stage.low.pos, stage.low.idx),
    clips: Object.fromEntries(clips.map(c => [c.name, {duration: c.duration, loop: c.loop, ...(c.name === 'Walk' ? {groundSpeed: gait.groundSpeed} : {})}]))};
  const sceneExtras = {schema: 'terminal-state/market-humans@1', task: TASK, clips: CLIP_NAMES,
    bodies: [{id: BODY.id, label: BODY.label, heightM: r4(stage.skel.H), wear: []}], wearables: [],
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet'}, approved: false};
  const doc = buildCastDocument({bodies: [{id: BODY.id, skel: stage.skel, mesh: {pos: stage.low.pos, nrm: stage.low.nrm, uv: stage.low.uv, idx: stage.low.idx, joints: spread.joints, weights: spread.weights}, enc: stage.enc, clips, extras}],
    wearables: [], extras: sceneExtras, generator: GENERATOR});
  if (DRY) { console.log('dry run: nothing written'); return; }
  const glbFile = OUT_ROOT ? path.join(OUT_ROOT, 'models', path.basename(GLB_REL)) : path.join(PUB, GLB_REL);
  const jsonFile = OUT_ROOT ? path.join(OUT_ROOT, 'derivatives', path.basename(BUYER_PROV_REL)) : path.join(PUB, BUYER_PROV_REL);
  fs.mkdirSync(path.dirname(glbFile), {recursive: true}); fs.mkdirSync(path.dirname(jsonFile), {recursive: true});
  await writeDoc(doc, glbFile);
  const glb = fs.readFileSync(glbFile);
  if (sha(fs.readFileSync(file)) !== record.master.sha256) throw new Error('SOURCE CHANGED ' + record.master.file);

  // ---- 5. provenance + QA record
  const J = stage.skel.joints;
  const man = {schema: 'the-last-line/derivative-manifest@1', asset: 'market-corpse-buyer', task: TASK, title: 'The Survivor Market\'s corpse buyer: one clothed Meshy T2.5 body, local rig, the market humans\' healthy clips (prototype)', what: BODY.what,
    status: {approved: false, gameReady: false, stage: 'unapproved prototype derivative (the corpse buyer); art / anatomy / deformation not certified', licenseClearance: 'none - evaluation quality does not grant commercial rights; the body is an AI reconstruction (Meshy T2.5) of an AI-generated (Codex) concept image'},
    honesty: {sourceHadSkeleton: false, rig: 'NEW derivative skeleton (the shared 18-joint naming / hierarchy, measured on this body) and automatic skin weights created by the market humans\' CPU pipeline (zombie autorig libraries); no provider rig',
      animation: 'the market humans\' hand-authored procedural HEALTHY clips (tools/asset-pipeline/humans/lib/clips.mjs, sampled with this body\'s own joints; walk stride / sit fitted to it) - NOT motion capture, NOT provider animation, NOT the zombie clips',
      maps: 'the Meshy base colour, metallic-roughness and normal maps are KEPT on the Meshy mesh / UVs (re-encoded JPEG, resized only)', generation: 'no generation, inference, model download or network service was used by this builder'},
    generation: record,
    outputs: {glb: {path: GLB_REL, bytes: glb.length, sha256: sha(glb), format: 'glTF 2.0 binary (KHR_mesh_quantization int8 normals); JPEG textures; the market-human-cast.glb layout with ONE body \'cb\' and no wearables: 18 prefixed joints, the skinned body, its clips "cb:<Clip>"'}},
    levelOnly: 'market (game/src/assets/levelAssets.ts LEVEL_ONLY_RULES market-*)',
    runtime: 'market/humanWardrobe.ts HumanWardrobe loads the file unchanged: build({body: \'cb\', wear: {}, scale: 1})',
    clips: Object.fromEntries(Object.entries(HUMAN_CLIP_SPECS).map(([k, v]) => [k, {loop: v.loop, durationS: v.duration ?? gait.T}])),
    body: {id: BODY.id, label: BODY.label, heightM: r4(stage.skel.H), placement: {...stage.placement, nativeBounds: undefined}, facing: stage.facing,
      mesh: {...stage.stats, legBridgeTrim: stage.legBridgeTrim, shippedTriangles: stage.low.idx.length / 3},
      skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), notes: stage.issues, fixes: stage.skel.log.humanFix ?? [], options: BODY.skeleton},
      skinning: {method: 'zombie/lib/autorig.mjs bodySkin (skin.mjs region classification + chain weights + masked Laplacian smoothing), the market humans\' HUMAN_SKIN options', ...sw.stats},
      profile: {...profile, torsoRows: undefined}, gait, sit,
      clips: clips.map(c => ({name: c.name, durationS: c.duration, loop: c.loop, keyframes: c.times.length, maxLegReach: c.maxLegReach}))},
    verification: {floorLowestSkinnedVertexM: floor, motionStretch: motion, motionStretchPerClip: perClip,
      qa: 'CPU renders (tools/asset-pipeline/humans/qa/sheets.mjs --cast <this file>: bind + every clip front / side, the face, the scale line beside a runtime zombie) viewed; renders kept in the task\'s private QA folder'},
    limitations: [
      'Automatic approximate skin weights; LBS volume loss at shoulders / elbows / hips in the deeper poses (Sit, Greet).',
      'Procedural (not mocap) clips; no facial rig, no finger or twist bones (the gloved hands keep their A-pose shape).',
      'Hidden-side geometry of the Meshy base is AI-hallucinated; the maps are the Meshy model\'s own (normal map kept, sampled without tangents).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified.',
    ],
    rebuild: 'LL_THREADS=1 node --max-old-space-size=6000 tools/asset-pipeline/humans/build-corpse-buyer.mjs'};
  const manBuf = Buffer.from(JSON.stringify(man, null, 2) + '\n');
  assertPublicSafe(manBuf.toString(), BUYER_PROV_REL);
  fs.writeFileSync(jsonFile, manBuf);
  console.log(`wrote ${path.relative(ROOT, glbFile)} ${glb.length} B, ${path.relative(ROOT, jsonFile)} ${manBuf.length} B`);
  if (!OUT_ROOT) {
    fs.writeFileSync(REG, `// GENERATED by tools/asset-pipeline/humans/build-corpse-buyer.mjs — do not edit (task ${TASK}).
// The Market den's corpse buyer: ONE clothed Meshy T2.5 body (maps kept) rigged LOCALLY on the market humans' 18-joint skeleton with their
// healthy clips, in the market-human-cast.glb layout (a one-body cast, no wearables: market/humanWardrobe.ts loads it unchanged).
// Provenance ${BUYER_PROV_REL}.
export const CORPSE_BUYER_MODEL = {key: 'market_corpseBuyer', url: '${GLB_REL}', bytes: ${glb.length}, body: '${BODY.id}', heightM: ${r4(stage.skel.H)}} as const;
`);
    writeCredits();
    updateAllowlist([GLB_REL, BUYER_PROV_REL]);
    console.log(`wrote ${path.relative(ROOT, REG)} + CREDITS.md section + public-inputs.json rows`);
  }
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

await main();
