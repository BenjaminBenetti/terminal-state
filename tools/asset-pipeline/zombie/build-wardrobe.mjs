#!/usr/bin/env node
// The Last Line - zombie WARDROBE builder (iteration 06, CPU only, no inference / network).
//   node --max-old-space-size=24000 tools/asset-pipeline/zombie/build-wardrobe.mjs [--reuse] [--only-stage]
//   --reuse          reuse cached body / wearable stages in /tmp/ll-zombie-variants (keyed by source sha + options + code hash)
//   --only-stage     stop after the cached stages (warm the cache)
//   dev only: --bodies=a,b --wear=x,y (canonical body always included) --out=DIR (write GLB/JSON to DIR/models, DIR/derivatives
//             instead of game/public/assets; nothing else is touched) --no-write
// Iteration 07: after the per-body placement, every upper / pants variant is REFITTED by lib/fit07.mjs
// (outer-hull anchors -> body weights at the anchor -> wrinkle ironing -> skin offset field until the cloth
// is outside the body AND the fitted pants -> pose validation over the bind pose, every 3rd frame of the six
// clips and 3 ragdoll-like extremes -> all-pose masks); hats use lib/headwear.mjs (cranium fit + seat solve);
// the fit07 gate (wardrobe.config FIT07) excludes variants whose body still VISIBLY pokes through and turns
// failing upper x pants layerings into per-body incompatibilities (variant extras incompatibleWear).
// Independent check: qa/fit-audit.mjs on the written GLBs + qa/fit-report.mjs.
// Slots: upper (garment kind: canonical fit + per-body retarget), lower (pants kind: per-body row
// profile fit), head / face (rigid kind: per-body scale + contact solve, 100% Head). Order:
//   bodies (auto-rig, stretch audit) -> wearable stages -> phase 1: lower + head + face per body ->
//   phase 2: upper per body, colliding with that body's fitted lower garments (layering) -> clips +
//   motion stretch audit of every body x wearable -> layer masks (upper over lower, head over face)
//   -> GLBs + provenance + zombie-wardrobe.json.
// Writes ONLY game/public/assets/models/{zombie-body,outfit}-<id>.glb and
// game/public/assets/derivatives/{zombie-body-<id>,outfit-<id>,zombie-wardrobe,zombie-variants}.json.
// Sources (masters / native outputs) are read-only and sha256-verified before and after.
// Meshy T2.5 migration (2026-10-29, lane CHARS): bodies / wearables pinned in wardrobe.config.mjs T25 are built from
// the accepted Meshy T2.5 native GLB (lib/t25.mjs: densified, same stages); rebuilt files get the '-t25' suffix
// (new URLs; derivative JSON names unchanged), KEEP_BODY_FILES bodies are verified but not rewritten, SKIP_WEARABLES
// are left out. LL_THREADS=N caps worker threads (1-CPU pod); --reuse also caches per-pair fit results.
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {REPO, sha256File} from './lib/master.mjs';
import {loadAnySource as loadSource, t25LoaderHash, restoreRecord, T25_TASK, T25_SUFFIX} from './lib/t25.mjs';
import {bodyStage, bodySkin, bodyProfile, spreadWeights, rigFor, trimArmTorsoBridges} from './lib/autorig.mjs';
import {garmentCanonical} from './lib/garment.mjs';
import {pantsStage} from './lib/pants.mjs';
import {rigidStage} from './lib/rigid.mjs';
import {reposeTtoA} from './lib/repose.mjs';
import {hitRadii} from './lib/hit.mjs';
import {fitVariantsParallel} from './lib/fit-pool.mjs';
import {coverMask} from './lib/fit.mjs';
import {sampleBodyClips, verifyClips} from './lib/clipsolve.mjs';
import {auditPoses, triangleStretch, stretchStats} from './lib/stretch.mjs';
import {worldList} from './lib/fit07.mjs';
import {EXTREME_POSES} from './lib/extreme-poses.mjs';
import {Rig} from './lib/pose.mjs';
import {buildBodyDocument, buildOutfitDocument, writeDoc, geometryHash, bitsetBase64} from './lib/variant-glb.mjs';
import {Document} from '@gltf-transform/core';
import {JOINTS} from './lib/skeleton.mjs';
import {JOINT_NAMES} from './lib/skin.mjs';
import {CLIP_SPECS} from './lib/clips.mjs';
import {BODIES, WEARABLES, CANONICAL_BODY, SKIN, EXCLUDED_PAIRS, QUALITY, FIT07, KEEP_BODY_FILES, SKIP_WEARABLES} from './wardrobe.config.mjs';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {NodeIO} from '@gltf-transform/core';

// 1-CPU pod: bake.mjs sizes its worker pool from os.cpus() (the host's 48 cores); LL_THREADS caps it without
// touching the stage code (its hash keys the stage cache)
if (+process.env.LL_THREADS > 0) { const cpus = os.cpus; os.cpus = () => cpus().slice(0, +process.env.LL_THREADS); }
/** Stage-cache identity of a source: T2.5 sources add the loader (densify) hash and density. */
const srcKey = src => (src.t25 ? `${src.sha256}|t25:${t25LoaderHash()}|${src.densifyFrac}` : src.sha256);
const git = args => execFileSync('git', ['-C', REPO, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
const T25_TAG = src => src.t25 ? ` + Meshy T2.5 replacement ${src.t25.asset} ${src.t25.attempt} (task ${src.t25.taskId}; ${T25_TASK})` : '';

const ARGS = new Set(process.argv.slice(2));
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.replace(/^--/, '').split('=')));
const onlyB = OPT.bodies ? new Set([...OPT.bodies.split(','), CANONICAL_BODY]) : null, onlyW = OPT.wear ? new Set(OPT.wear.split(',')) : null;
const TMP = '/tmp/ll-zombie-variants';
const OUT_ROOT = OPT.out ? path.resolve(OPT.out) : null;
const MODELS = OUT_ROOT ? path.join(OUT_ROOT, 'models') : path.join(REPO, 'game/public/assets/models');
const DERIV = OUT_ROOT ? path.join(OUT_ROOT, 'derivatives') : path.join(REPO, 'game/public/assets/derivatives');
const GENERATOR = 'The Last Line zombie wardrobe builder (tools/asset-pipeline/zombie/build-wardrobe.mjs)';
const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const SLOT_ORDER = ['lower', 'upper', 'face', 'head'];

function guard(file) {
  if (OUT_ROOT) { if (!path.resolve(file).startsWith(OUT_ROOT + path.sep)) throw new Error('dev output outside --out: ' + file); return file; }
  const rel = path.relative(REPO, path.resolve(file));
  const ok = /^game\/public\/assets\/models\/(zombie-body|outfit)-[a-z0-9]+(-t25)?\.glb$/.test(rel) || /^game\/public\/assets\/derivatives\/(zombie-body-[a-z0-9]+|outfit-[a-z0-9]+|zombie-wardrobe|zombie-variants)\.json$/.test(rel);
  if (!ok) throw new Error('refusing to write outside the wardrobe derivative outputs: ' + rel);
  return file;
}

function codeHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['lib/source.mjs', 'lib/mesh.mjs', 'lib/unwrap.mjs', 'lib/bake.mjs', 'lib/bake-worker.mjs', 'lib/stage-mesh.mjs', 'lib/skeleton.mjs', 'lib/slices.mjs', 'lib/autorig.mjs', 'lib/garment.mjs', 'lib/repose.mjs', 'lib/pants.mjs', 'lib/rigid.mjs'])
    h.update(fs.readFileSync(new URL(f, import.meta.url)));
  return h.digest('hex').slice(0, 12);
}
function makeCache(extraKey) {
  return async (key, fn) => {
    if (!ARGS.has('--reuse')) return fn();
    const file = path.join(TMP, 'cache', `${key}-${codeHash()}-${crypto.createHash('sha256').update(JSON.stringify(extraKey)).digest('hex').slice(0, 12)}.v8`);
    if (fs.existsSync(file)) { console.log('  (cache)', path.basename(file)); return v8.deserialize(fs.readFileSync(file)); }
    const r = await fn();
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file + '.tmp', v8.serialize(r)); fs.renameSync(file + '.tmp', file);
    return r;
  };
}
const cfgOf = def => { const {source, ...cfg} = def; return cfg; };
const fits = {}; // wearableId -> bodyId -> fit

async function main() {
  const t0 = Date.now();
  const sources = [];
  const skipped = {bodies: [], wearables: []};
  // ---------------------------------------------------------------- bodies
  const bodies = [];
  for (const def of BODIES) {
    if (onlyB && !onlyB.has(def.id)) continue;
    const src = def.source();
    if (!src) { skipped.bodies.push({id: def.id, reason: 'source not available yet'}); console.log(`[body ${def.id}] skipped: no source`); continue; }
    sources.push(src);
    console.log(`[body ${def.id}] ${src.file}`);
    const opts = cfgOf(def);
    // stage cache key: only what the mesh/bake stage depends on (labels, traits, weights, skin overrides excluded)
    const stageKey = Object.fromEntries(['heightM', 'targetTris', 'importance', 'unwrap', 'density', 'bake', 'textures', 'facing', 'repose'].map(k => [k, opts[k] ?? null]));
    const stage = await makeCache({src: srcKey(src), stageKey})('body-' + def.id, async () => {
      const m = await loadSource(src);
      const r = def.repose === 'T' ? reposeTtoA(m) : m;
      const st = await bodyStage(r, opts);
      return r.repose ? {...st, repose: r.repose} : st;
    });
    if (stage.issues.length) console.log(`  ! skeleton issues: ${stage.issues.join('; ')}`);
    const sw = bodySkin(stage, {...SKIN, ...(def.skin ?? {})});
    if (def.trimBridges) {
      const tr = trimArmTorsoBridges(stage.low, sw, stage.skel);
      stage.low = tr.low; stage.bridgeTrim = {removed: tr.removed, method: tr.method};
      console.log('  bridge trim: removed', tr.removed, 'triangles');
    }
    const spread = spreadWeights(stage.low, sw);
    const profile = bodyProfile(stage.skel, stage.low.welded, sw);
    profile.hit = hitRadii(profile, stage.skel);
    console.log('  tris', stage.low.idx.length / 3, 'hit', JSON.stringify(profile.hit));
    bodies.push({id: def.id, def, src, stage, skel: stage.skel, rigDesc: rigFor(stage.skel), low: stage.low, weldedWeights: sw, joints: spread.joints, weights: spread.weights, profile});
  }
  const C = bodies.find(b => b.id === CANONICAL_BODY);
  if (!C) throw new Error('canonical body missing');
  // iteration 07: validation poses per body for the pose-aware refit (lib/fit07.mjs): every 3rd frame of
  // the six clips (death pose solved against the body alone) + three ragdoll-like extreme poses
  for (const B of bodies) {
    const {clips, rig} = sampleBodyClips(B.skel, [{name: 'ZombieBody', pos: B.low.pos, joints: B.joints, weights: B.weights}]);
    const list = [{clip: 'Bind', t: 0, world: worldList(rig.fk({hips: [0, 0, 0], rot: {}}), B.skel)}, ...auditPoses(clips, {every: FIT07.everyFrames}).map(p => ({clip: p.clip, t: p.t, world: worldList(rig.fk(p.pose), B.skel)}))];
    for (const [name, rot] of Object.entries(EXTREME_POSES)) list.push({clip: name, t: 0, world: worldList(new Rig(B.skel).fk({hips: [0, 0, 0], rot}), B.skel)});
    B.validation = list;
    console.log(`  [${B.id}] validation poses: ${list.length}`);
  }

  // ---------------------------------------------------------------- wearable stages
  const wear = [];
  for (const def of WEARABLES) {
    if (onlyW && !onlyW.has(def.id)) continue;
    const skip = SKIP_WEARABLES.find(x => x.id === def.id);
    if (skip) { skipped.wearables.push({id: def.id, slot: def.slot, reason: skip.reason}); console.log(`[${def.slot} ${def.id}] skipped: ${skip.reason}`); continue; }
    const src = def.source();
    if (!src) { skipped.wearables.push({id: def.id, slot: def.slot, reason: 'source not available yet'}); console.log(`[${def.slot} ${def.id}] skipped: no source`); continue; }
    sources.push(src);
    console.log(`[${def.slot} ${def.id}] ${src.file}`);
    const cfg = cfgOf(def);
    let g;
    if (def.kind === 'garment') {
      g = await garmentCanonical(() => loadSource(src), cfg, {skel: C.skel, rigDesc: C.rigDesc, welded: C.low.welded, weights: C.weldedWeights}, makeCache({src: srcKey(src), cfg, canonical: geometryHash(C.low.pos, C.low.idx)}), SKIN);
      console.log('  fit', JSON.stringify(g.fit.scale), 'sleeved', g.garment.sleeved, 'tris', g.low.idx.length / 3);
    } else {
      const stageCfg = {targetTris: cfg.targetTris, unwrap: cfg.unwrap, bake: cfg.bake, textures: cfg.textures, facing: cfg.facing, trimBehind: cfg.trimBehind};
      g = await makeCache({src: srcKey(src), stageCfg})(`${def.kind}-${def.id}`, async () => (def.kind === 'pants' ? pantsStage : rigidStage)(await loadSource(src), stageCfg));
      console.log('  stage tris', g.low.idx.length / 3, g.frameSummary ? JSON.stringify(g.frameSummary) : '');
    }
    wear.push({id: def.id, def, cfg, src, g});
  }
  if (ARGS.has('--only-stage')) { console.log('stages ready'); return; }

  // ---------------------------------------------------------------- pairs
  const excluded = [];
  const supports = (w, B) => {
    const covers = B.def.traits?.covers ?? [];
    if (covers.includes(w.def.slot)) return {ok: false, reason: `body ${B.id} covers the ${w.def.slot} slot (${B.def.traits.note ?? 'own geometry'})`, rule: 'body-covers-slot'};
    const ex = EXCLUDED_PAIRS.find(e => e.body === B.id && e.wearable === w.id);
    if (ex) return {ok: false, reason: ex.reason, rule: 'qa-exclusion'};
    return {ok: true};
  };
  const runPhase = async list => {
    const jobs = [];
    for (const w of list) {
      fits[w.id] ??= {};
      for (const B of bodies) {
        const s = supports(w, B);
        if (!s.ok) { excluded.push({body: B.id, wearable: w.id, slot: w.def.slot, rule: s.rule, reason: s.reason}); continue; }
        const up = w.def.slot === 'upper';
        jobs.push({key: `${w.id}|${B.id}`, g: w.g, cfg: w.cfg, C, B, extraCollide: up ? lowerCollision(B) : undefined, poses: B.validation, layers: up ? lowerLayers(B) : undefined, layerUV: up ? lowerUV(B) : undefined, onDone: (v, ms) => {
          fits[w.id][B.id] = v;
          const rf = v.stats.refit07;
          console.log(`  fit ${w.id} x ${B.id}: hidden ${v.mask.hidden}/${v.mask.total} bulk ${JSON.stringify(v.stats.bulkM)}${rf ? ` refit: offset p50 ${rf.offsetM.p50} p95 ${rf.offsetM.p95} max ${rf.offsetM.max}; bind rounds ${rf.bindRounds.map(r => r.skinVerticesRaised).join('>')}; pose rounds ${rf.poseRounds.map(r => r.skinVerticesNeedingMore).join('>')}` : ''} (${ms} ms)`);
        }});
      }
    }
    await fitVariantsParallel(jobs, {cacheDir: ARGS.has('--reuse') ? path.join(TMP, 'fit-cache') : null});
  };
  // lower-garment collision proxy per body: fitted pants triangles above the crotch (welded)
  const lowerCollision = B => {
    const parts = wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]).map(w => ({pos: fits[w.id][B.id].weldedPos, idx: w.g.low.welded.idx}));
    if (!parts.length) return undefined;
    const pos = [], idx = []; let base = 0;
    for (const p of parts) {
      for (let t = 0; t < p.idx.length; t += 3) { const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2]; if (Math.min(p.pos[a * 3 + 1], p.pos[b * 3 + 1], p.pos[c * 3 + 1]) > B.skel.crotchY - 0.02) idx.push(a + base, b + base, c + base); }
      for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
      base += p.pos.length / 3;
    }
    return {pos: Float32Array.from(pos), idx: Uint32Array.from(idx)};
  };
  // iteration 07: fitted lower garments of this body as layers the upper must stay outside of (welded,
  // weighted) + their UV-split triangles for the all-pose hideWear masks
  const lowerLayers = B => wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]?.weldedJoints).map(w => { const v = fits[w.id][B.id]; return {id: w.id, pos: v.weldedPos, idx: w.g.low.welded.idx, joints: v.weldedJoints, weights: v.weldedWeights}; });
  const lowerUV = B => Object.fromEntries(wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]).map(w => { const v = fits[w.id][B.id]; return [w.id, {pos: v.pos, idx: w.g.low.idx, joints: v.joints, weldId: w.g.low.weldId}]; }));
  await runPhase(wear.filter(w => w.def.slot !== 'upper'));
  await runPhase(wear.filter(w => w.def.slot === 'upper'));
  // ---------------------------------------------------------------- iteration 07 fit gate
  // Every refitted upper / pants variant reports, from its own pose validation, how many covered body
  // vertices still poke through the cloth (bind pose, any clip frame, the 3 ragdoll-like extremes) and,
  // for uppers, how many covered outer-wall vertices of each fitted pants poke through it. A variant over
  // the limits is EXCLUDED (never shipped); an upper x pants layering over the limit becomes a per-body
  // incompatibility (the runtime never combines them on that body).
  const fitGate = {limits: FIT07.gate, variants: [], layerIncompatible: []};
  for (const w of wear) for (const B of bodies) {
    const v = fits[w.id]?.[B.id], rf = v?.stats?.refit07;
    if (!rf) continue;
    // VISIBLE poke-through (vertices of unhidden triangles) per validation pose, as a fraction of the
    // covered body vertices; 'Bind' = the rest pose itself
    const vis = rf.visiblePerClip ?? {}, cov = Math.max(1, ...Object.values(vis).map(c => c.covered));
    const anim = Object.entries(vis).filter(([k]) => !/^ragdoll-|^Bind$/.test(k)), ext = Object.entries(vis).filter(([k]) => /^ragdoll-/.test(k));
    const m = {body: B.id, wearable: w.id, covered: cov, bind: +((vis.Bind?.maxVisiblePoke ?? 0) / cov).toFixed(4), animated: +(Math.max(0, ...anim.map(([, c]) => c.maxVisiblePoke)) / cov).toFixed(4), extreme: +(Math.max(0, ...ext.map(([, c]) => c.maxVisiblePoke)) / cov).toFixed(4), layers: {}};
    for (const [, c] of anim) for (const [lid, l] of Object.entries(c.layers ?? {})) { const q = m.layers[lid] ??= {covered: l.covered, animated: 0}; q.animated = Math.max(q.animated, l.maxVisiblePoke); }
    for (const q of Object.values(m.layers)) q.animated = +(q.animated / Math.max(1, q.covered)).toFixed(4);
    const g = FIT07.gate, fail = [];
    if (m.bind > g.bind) fail.push(`bind ${(m.bind * 100).toFixed(2)}% > ${g.bind * 100}%`);
    if (m.animated > g.animated) fail.push(`animated ${(m.animated * 100).toFixed(2)}% > ${g.animated * 100}%`);
    if (m.extreme > g.extreme) fail.push(`extreme ${(m.extreme * 100).toFixed(2)}% > ${g.extreme * 100}%`);
    m.pass = !fail.length;
    fitGate.variants.push(m);
    if (fail.length && g.enforce && process.env.FIT07_NOGATE !== '1') {
      excluded.push({body: B.id, wearable: w.id, slot: w.def.slot, rule: 'fit07-pose-gate', reason: `body still visibly pokes through the refitted cloth in the pose validation: ${fail.join(', ')} of ${cov} covered vertices`, metrics: m});
      delete fits[w.id][B.id];
      console.log(`  ! ${w.id} x ${B.id} EXCLUDED by the fit07 pose gate: ${fail.join(', ')}`);
      continue;
    }
    for (const [lid, q] of Object.entries(m.layers)) if (q.animated > g.layerAnimated && g.enforce && process.env.FIT07_NOGATE !== '1') {
      fitGate.layerIncompatible.push({body: B.id, upper: w.id, lower: lid, animated: q.animated, covered: q.covered});
      (v.incompatibleWear ??= []).push(lid);
      console.log(`  ! ${w.id} over ${lid} on ${B.id}: pants poke through ${(q.animated * 100).toFixed(2)}% > ${g.layerAnimated * 100}% -> per-body incompatibility`);
    }
  }
  // an upper that no fitted pants may be layered under on a body that REQUIRES pants would be unreachable:
  // exclude that pair explicitly (recorded) instead of shipping a dead variant
  for (const B of bodies) {
    if (!(B.def.traits?.requires ?? []).includes('lower')) continue;
    const lowers = wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]).map(w => w.id);
    for (const U of wear.filter(w => w.def.slot === 'upper' && fits[w.id]?.[B.id])) {
      const inc = fits[U.id][B.id].incompatibleWear ?? [];
      if (lowers.length && lowers.every(l => inc.includes(l))) {
        excluded.push({body: B.id, wearable: U.id, slot: 'upper', rule: 'fit07-layering-gate', reason: `every fitted pants of ${B.id} (a body that always wears pants) visibly pokes through it: ${lowers.join(', ')}`});
        delete fits[U.id][B.id];
        console.log(`  ! ${U.id} x ${B.id} EXCLUDED: incompatible with every fitted pants of a pants-required body`);
      }
    }
  }
  if (ARGS.has('--no-write')) { console.log('dev run: nothing written'); return; }

  // ---------------------------------------------------------------- clips, motion audit, layer masks per body
  fs.mkdirSync(MODELS, {recursive: true}); fs.mkdirSync(DERIV, {recursive: true});
  const summary = {bodies: {}, wearables: {}, pairs: [], motionAudit: {}};
  const variantExtras = {}; // wearableId -> bodyId -> extras
  for (const B of bodies) {
    const bodyMesh = {name: 'ZombieBody', pos: B.low.pos, joints: B.joints, weights: B.weights};
    const worn = wear.filter(w => fits[w.id]?.[B.id]);
    const wMeshes = worn.map(w => ({name: 'Outfit_' + w.id, pos: fits[w.id][B.id].pos, joints: fits[w.id][B.id].joints, weights: fits[w.id][B.id].weights}));
    const {death, clips, rig} = sampleBodyClips(B.skel, [bodyMesh, ...wMeshes]);
    const sets = {body: [bodyMesh], ...Object.fromEntries(wMeshes.map(m => [m.name, [bodyMesh, m]]))};
    const verify = verifyClips(rig, B.skel, sets, clips);
    const worst = Math.min(...Object.values(verify).flatMap(c => Object.values(c).filter(x => x && x.minY != null).map(x => x.minY)));
    // motion stretch audit (every 3rd frame of every clip)
    const poses = auditPoses(clips, {every: 3});
    const bs = triangleStretch({pos: B.low.pos, idx: B.low.idx, joints: B.joints, weights: B.weights}, B.skel, rig, poses);
    const audit = {body: stretchStats(bs.worst, poses, bs.at, {ratio: QUALITY.stretchRatio}), wearables: {}};
    for (const w of worn) {
      const v = fits[w.id][B.id];
      const ws = triangleStretch({pos: v.pos, idx: w.g.low.idx, joints: v.joints, weights: v.weights}, B.skel, rig, poses);
      audit.wearables[w.id] = stretchStats(ws.worst, poses, ws.at, {ratio: QUALITY.stretchRatio});
    }
    summary.motionAudit[B.id] = audit;
    console.log(`[audit ${B.id}] body ${JSON.stringify(audit.body)}`);
    for (const [k, a] of Object.entries(audit.wearables)) console.log(`   ${k}: over${QUALITY.stretchRatio}x ${a[`over${QUALITY.stretchRatio}x`]}/${a.triangles} max ${a.max} p99 ${a.p99}`);
    // motion-quality gate: a variant whose triangles stretch > ratio x in motion over more than
    // maxFractionOver of the mesh (batwing panels / torn skirts) is NOT shipped - recorded as excluded
    for (const w of [...worn]) {
      const a = audit.wearables[w.id];
      if (a.fractionOver <= QUALITY.maxFractionOver) continue;
      excluded.push({body: B.id, wearable: w.id, slot: w.def.slot, rule: 'motion-quality-gate', reason: `${(a.fractionOver * 100).toFixed(1)}% of its triangles stretch > ${QUALITY.stretchRatio}x in the clips (limit ${QUALITY.maxFractionOver * 100}%): sheet-like webbing under the raised arms`, motion: a});
      delete fits[w.id][B.id];
      worn.splice(worn.indexOf(w), 1);
      console.log(`   ! ${w.id} x ${B.id} EXCLUDED by the motion-quality gate`);
    }
    // layer masks: lower triangles under each upper; face-item triangles under each head item
    const extrasOf = w => (variantExtras[w.id] ??= {})[B.id] ??= {};
    for (const [over, under] of [['upper', 'lower'], ['head', 'face']]) {
      for (const U of worn.filter(w => w.def.slot === over)) for (const L of worn.filter(w => w.def.slot === under)) {
        const lv = fits[L.id][B.id], uv = fits[U.id][B.id];
        if (uv.hideWear?.[L.id]) { const ex = extrasOf(U); (ex.hideWear ??= {})[L.id] = bitsetBase64(uv.hideWear[L.id].hide); (ex.hideWearCounts ??= {})[L.id] = uv.hideWear[L.id].hidden; continue; }
        const m = coverMask({pos: lv.pos, idx: L.g.low.idx}, {pos: uv.weldedPos, idx: U.def.kind === 'garment' ? U.g.canonical.idx : U.g.low.welded.idx},
          {maxDist: over === 'upper' ? 0.08 : 0.04, inset: 0.01, tiltDeg: 24, bodyJoints: lv.joints, skipJoints: ['L_Foot', 'R_Foot']});
        const ex = extrasOf(U);
        (ex.hideWear ??= {})[L.id] = bitsetBase64(m.hide);
        (ex.hideWearCounts ??= {})[L.id] = m.hidden;
      }
    }
    const extras = {id: B.id, label: B.def.label, heightM: r4(B.skel.H), hit: B.profile.hit, bodyTriangles: B.low.idx.length / 3, geometryHash: geometryHash(B.low.pos, B.low.idx),
      clips: Object.keys(CLIP_SPECS), traits: B.def.traits ?? {}, provenance: provenanceOf(B), approved: false, gameReady: false, origin: originOf(B)};
    const doc = buildBodyDocument({id: B.id, skel: B.skel, mesh: {pos: B.low.pos, nrm: B.low.nrm, uv: B.low.uv, idx: B.low.idx, joints: B.joints, weights: B.weights, baseColor: B.stage.enc.baseJpg, metallicRoughness: B.stage.enc.mrJpg}, clips, extras, generator: GENERATOR, quantizeNormals: true});
    // T2.5 migration: every CHANGED runtime file gets a new (-t25) URL; a rebuild that is byte-identical to the shipped
    // legacy file keeps that file (not rewritten). KEEP_BODY_FILES bodies (no T2.5 replacement) must also keep their
    // geometry exactly (every wearable variant fitted here indexes it).
    const legacyBody = path.join(REPO, 'game/public/assets/models', `zombie-body-${B.id}.glb`);
    if (KEEP_BODY_FILES.includes(B.id)) {
      const ex = await shippedBodyExtras(legacyBody);
      if (ex.geometryHash !== extras.geometryHash) throw new Error(`kept body ${B.id}: rebuilt geometry ${extras.geometryHash} != shipped ${ex.geometryHash} (${path.relative(REPO, legacyBody)})`);
    }
    if (!B.src.t25 && await sameAsShipped(doc, legacyBody)) {
      if (OUT_ROOT) fs.copyFileSync(legacyBody, path.join(MODELS, path.basename(legacyBody)));
      const bytes = fs.statSync(legacyBody).size, sha = sha256File(legacyBody);
      summary.bodies[B.id] = {glb: path.relative(REPO, legacyBody), kept: true, bytes, sha256: sha, triangles: extras.bodyTriangles, vertices: B.low.pos.length / 3, heightM: extras.heightM, hit: B.profile.hit, traits: extras.traits, provenance: B.def.provenance, skeletonIssues: B.stage.issues, lowestSkinnedVertexM: +worst.toFixed(4), motion: audit.body};
      console.log(`  KEPT ${path.relative(REPO, legacyBody)} (rebuild byte-identical; not rewritten)`);
      continue;
    }
    const glb = guard(path.join(MODELS, `zombie-body-${B.id}${T25_SUFFIX}.glb`));
    await writeDoc(doc, glb);
    const bytes = fs.statSync(glb).size, sha = sha256File(glb);
    const manifest = bodyManifest(B, {glb, bytes, sha, death, verify, clips, extras, audit: audit.body, t25: await t25Block(B.src, `game/public/assets/models/zombie-body-${B.id}.glb`, glb)});
    fs.writeFileSync(guard(path.join(DERIV, `zombie-body-${B.id}.json`)), JSON.stringify(manifest, null, 2) + '\n');
    summary.bodies[B.id] = {glb: rel(glb), bytes, sha256: sha, triangles: extras.bodyTriangles, vertices: B.low.pos.length / 3, heightM: extras.heightM, hit: B.profile.hit, traits: extras.traits, provenance: provenanceOf(B), t25Source: !!B.src.t25, skeletonIssues: B.stage.issues, lowestSkinnedVertexM: +worst.toFixed(4), motion: audit.body};
    console.log(`  wrote ${rel(glb)} ${bytes} bytes`);
  }
  // ---------------------------------------------------------------- wearable GLBs
  for (const w of wear) {
    const bs = bodies.filter(B => fits[w.id]?.[B.id]);
    if (!bs.length) {
      // iteration 07: a wearable excluded on EVERY body still gets an inert GLB (no meshes / textures, scene
      // extras only) so a stale earlier build of it can never be loaded and matched against these bodies
      const reasons = excluded.filter(e => e.wearable === w.id).map(e => ({body: e.body, rule: e.rule, reason: e.reason}));
      const doc = new Document();
      doc.getRoot().getAsset().generator = GENERATOR;
      doc.createScene('Outfit_' + w.id).setExtras({zombieWearable: {id: w.id, label: w.def.label, slot: w.def.slot, kind: w.def.kind, bodies: [], excludedOnEveryBody: true, approved: false, gameReady: false}});
      const glb = guard(path.join(MODELS, `outfit-${w.id}${T25_SUFFIX}.glb`));
      await writeDoc(doc, glb);
      const bytes = fs.statSync(glb).size, sha = sha256File(glb);
      fs.writeFileSync(guard(path.join(DERIV, `outfit-${w.id}.json`)), JSON.stringify({schema: 'the-last-line/derivative-manifest@1', asset: 'outfit-' + w.id, title: `Zombie wearable "${w.def.label}" (${w.def.slot}) - EXCLUDED on every body (iteration 07 fit gate)`, status: STATUS, origin: originOf(w), provenance: provenanceOf(w), slot: w.def.slot, kind: w.def.kind, t25: await t25Block(w.src, `game/public/assets/models/outfit-${w.id}.glb`, glb),
        outputs: {glb: {path: rel(glb), bytes, sha256: sha, format: 'inert glTF 2.0 binary: scene extras only, no meshes / textures (not in the runtime manifest)'}}, source: srcInfo(w.src, w.g.master), perBody: {}, excludedOnEveryBody: reasons}, null, 2) + '\n');
      summary.wearables[w.id] = {slot: w.def.slot, kind: w.def.kind, glb: rel(glb), bytes, sha256: sha, triangles: 0, excludedOnEveryBody: true, bodies: []};
      console.log(`  wrote INERT ${rel(glb)} (excluded on every body)`);
      continue;
    }
    const kind = w.def.kind;
    const uv = w.g.low.uv, idx = w.g.low.idx;
    const vs = bs.map(B => {
      const v = fits[w.id][B.id];
      const ex = variantExtras[w.id]?.[B.id] ?? {};
      return {bodyId: B.id, skel: B.skel, pos: v.pos, nrm: v.nrm, joints: v.joints, weights: v.weights,
        extras: {outfit: w.id, slot: w.def.slot, body: B.id, bodyTriangles: B.low.idx.length / 3, bodyGeometryHash: geometryHash(B.low.pos, B.low.idx), hideBodyTriangles: bitsetBase64(v.mask.hide), hiddenCount: v.mask.hidden, bulkM: v.stats.bulkM, ...(ex.hideWear ? {hideWear: ex.hideWear, hideWearCounts: ex.hideWearCounts} : {}), ...(v.incompatibleWear?.length ? {incompatibleWear: v.incompatibleWear} : {})}};
    });
    const extras = {id: w.id, label: w.def.label, slot: w.def.slot, kind, heavy: !!w.def.heavy, bodies: bs.map(b => b.id), triangles: idx.length / 3, provenance: provenanceOf(w), approved: false, gameReady: false, origin: originOf(w)};
    const doc = buildOutfitDocument({id: w.id, uv, idx, baseColor: w.g.enc.baseJpg, metallicRoughness: w.g.enc.mrJpg, variants: vs, extras, generator: GENERATOR, extrasKey: 'zombieWearable', quantizeNormals: true});
    const legacyWear = path.join(REPO, 'game/public/assets/models', `outfit-${w.id}.glb`);
    if (!w.src.t25 && await sameAsShipped(doc, legacyWear)) {
      if (OUT_ROOT) fs.copyFileSync(legacyWear, path.join(MODELS, path.basename(legacyWear)));
      summary.wearables[w.id] = {slot: w.def.slot, kind, glb: path.relative(REPO, legacyWear), kept: true, bytes: fs.statSync(legacyWear).size, sha256: sha256File(legacyWear), triangles: extras.triangles, vertices: w.g.low.pos.length / 3, heavy: extras.heavy, provenance: w.def.provenance, bodies: extras.bodies};
      for (const B of bs) summary.pairs.push({body: B.id, wearable: w.id, slot: w.def.slot, hiddenBodyTriangles: fits[w.id][B.id].mask.hidden, bulkM: fits[w.id][B.id].stats.bulkM, motion: summary.motionAudit[B.id].wearables[w.id] && {over: summary.motionAudit[B.id].wearables[w.id][`over${QUALITY.stretchRatio}x`], fraction: summary.motionAudit[B.id].wearables[w.id].fractionOver, max: summary.motionAudit[B.id].wearables[w.id].max}});
      console.log(`  KEPT ${path.relative(REPO, legacyWear)} (rebuild byte-identical; not rewritten)`);
      continue;
    }
    const glb = guard(path.join(MODELS, `outfit-${w.id}${T25_SUFFIX}.glb`));
    await writeDoc(doc, glb);
    const bytes = fs.statSync(glb).size, sha = sha256File(glb);
    fs.writeFileSync(guard(path.join(DERIV, `outfit-${w.id}.json`)), JSON.stringify(wearableManifest(w, bs, {glb, bytes, sha, t25: await t25Block(w.src, `game/public/assets/models/outfit-${w.id}.glb`, glb)}, summary.motionAudit), null, 2) + '\n');
    summary.wearables[w.id] = {slot: w.def.slot, kind, glb: rel(glb), bytes, sha256: sha, triangles: extras.triangles, vertices: w.g.low.pos.length / 3, heavy: extras.heavy, provenance: provenanceOf(w), t25Source: !!w.src.t25, bodies: extras.bodies};
    for (const B of bs) summary.pairs.push({body: B.id, wearable: w.id, slot: w.def.slot, hiddenBodyTriangles: fits[w.id][B.id].mask.hidden, bulkM: fits[w.id][B.id].stats.bulkM, motion: summary.motionAudit[B.id].wearables[w.id] && {over: summary.motionAudit[B.id].wearables[w.id][`over${QUALITY.stretchRatio}x`], fraction: summary.motionAudit[B.id].wearables[w.id].fractionOver, max: summary.motionAudit[B.id].wearables[w.id].max}});
    console.log(`  wrote ${rel(glb)} ${bytes} bytes`);
  }
  for (const s of sources) { const abs = path.isAbsolute(s.file) ? s.file : path.join(REPO, s.file); if (sha256File(abs) !== s.sha256) throw new Error('SOURCE CHANGED ' + s.file); }
  const totalBytes = Object.values(summary.bodies).reduce((a, b) => a + b.bytes, 0) + Object.values(summary.wearables).reduce((a, b) => a + b.bytes, 0);
  const counts = countLooks(bodies, wear, fits);
  const out = {schema: 'the-last-line/zombie-wardrobe@1', title: 'Zombie wardrobe: bodies x slot wearables (iteration 07 refit) - prototype derivatives', status: {approved: false, gameReady: false},
    authoredOn: new Date().toISOString().slice(0, 10), canonicalBody: CANONICAL_BODY, slots: SLOT_ORDER,
    t25Migration: {task: T25_TASK, note: 'Meshy T2.5 replacement of the locally generated characters: T2.5-sourced bodies / wearables are rebuilt from the accepted Meshy native GLB with the same CPU rig / fit pipeline; every rebuilt runtime file has a -t25 URL; kept bodies are verified, not rewritten', t25Bodies: bodies.filter(B => B.src.t25).map(B => B.id), t25Wearables: wear.filter(w => w.src.t25).map(w => w.id), keptBodyFiles: KEEP_BODY_FILES, skippedWearables: SKIP_WEARABLES},
    counts, excluded, skipped, quality: QUALITY, fit07: {method: 'lib/fit07.mjs (garments, pants) + lib/headwear.mjs (hats); validation poses = every ' + FIT07.everyFrames + 'rd frame of the six clips + 3 ragdoll-like extremes', gate: fitGate}, totalBytes, totalMB: +(totalBytes / 1e6).toFixed(2), ...summary,
    rebuild: 'node --max-old-space-size=24000 tools/asset-pipeline/zombie/build-wardrobe.mjs && node tools/asset-pipeline/zombie/qa/wardrobe-sheets.mjs',
    buildSeconds: Math.round((Date.now() - t0) / 1000)};
  fs.writeFileSync(guard(path.join(DERIV, 'zombie-wardrobe.json')), JSON.stringify(out, null, 2) + '\n');
  if (!OUT_ROOT) fs.writeFileSync(guard(path.join(DERIV, 'zombie-variants.json')), JSON.stringify({schema: 'the-last-line/zombie-variants@1', superseded: true, note: 'Iteration-05 body x outfit summary superseded in iteration 06 by the slot wardrobe: see zombie-wardrobe.json (same runtime files, rebuilt by build-wardrobe.mjs). The iteration-05 record is preserved in the pre-iteration-06 backup and reference/tasks/vertical-slice-iteration05-20261026.', see: 'zombie-wardrobe.json'}, null, 2) + '\n');
  console.log(`done: ${bodies.length} bodies, ${wear.length} wearables, ${counts.pairs} supported pairs, ${counts.looks} valid looks; ${(totalBytes / 1e6).toFixed(2)} MB (${out.buildSeconds} s)`);
}
const rel = f => OUT_ROOT ? path.relative(OUT_ROOT, f) : path.relative(REPO, f);
const originOf = X => X.def.origin + T25_TAG(X.src);
const provenanceOf = X => (X.src.t25 ? 'generated (Meshy T2.5 replacement of the local Pixal3D master)' : X.def.provenance);
/** True when `doc` serialises to exactly the bytes of the shipped file (then that file is kept, not rewritten). */
async function sameAsShipped(doc, file) {
  if (!fs.existsSync(file)) return false;
  fs.mkdirSync(TMP, {recursive: true});
  const probe = path.join(TMP, `probe-${process.pid}-${path.basename(file)}`);
  await writeDoc(doc, probe);
  const same = sha256File(probe) === sha256File(file);
  fs.rmSync(probe, {force: true});
  return same;
}
async function shippedBodyExtras(file) {
  const doc = await new NodeIO().registerExtensions([KHRMeshQuantization]).read(file);
  return doc.getRoot().listScenes()[0].getExtras().zombieBody;
}
/**
 * T2.5 migration record of one written runtime file: the Meshy source (when this asset was replaced) incl. the
 * densification actually applied, and the pushed-history restore record of the superseded runtime path.
 */
async function t25Block(src, oldRel, glb) {
  const out = {migration: T25_TASK, sourceReplaced: !!src.t25};
  if (src.t25) {
    const m = await loadSource(src); // deterministic: re-derives the densification stats of this exact source
    out.source = {...src.t25, densify: m.densify};
  } else out.note = 'source master unchanged (legacy local Pixal3D); file rebuilt because its per-body fits / masks follow bodies replaced in this migration';
  const newRel = OUT_ROOT ? null : path.relative(REPO, glb);
  if (newRel && newRel !== oldRel) out.supersedes = restoreRecord(oldRel, git) ?? {path: oldRel, note: 'not tracked in the base commit'};
  return out;
}

/** Exact counts of supported pairs and valid slot compositions (non-base) per body. */
function countLooks(bodies, wear, fits) {
  const per = {};
  let pairs = 0, looks = 0;
  for (const B of bodies) {
    const covers = B.def.traits?.covers ?? [], requires = B.def.traits?.requires ?? [];
    const bySlot = Object.fromEntries(SLOT_ORDER.map(s => [s, wear.filter(w => w.def.slot === s && fits[w.id]?.[B.id]).map(w => w.id)]));
    const p = Object.values(bySlot).reduce((a, l) => a + l.length, 0);
    // iteration 07: enumerate (instead of multiplying) so per-body layering incompatibilities count
    const inc = (a, b) => (fits[a]?.[B.id]?.incompatibleWear ?? []).includes(b) || (fits[b]?.[B.id]?.incompatibleWear ?? []).includes(a);
    const slots = SLOT_ORDER.filter(s => !covers.includes(s));
    let n = 0;
    const rec = (k, picked) => {
      if (k === slots.length) { if (picked.length && requires.every(r => covers.includes(r) || picked.some(w => wear.find(x => x.id === w).def.slot === r))) n++; return; }
      if (!requires.includes(slots[k])) rec(k + 1, picked);
      for (const w of bySlot[slots[k]]) if (picked.every(q => !inc(q, w))) rec(k + 1, [...picked, w]);
    };
    rec(0, []);
    per[B.id] = {pairs: p, perSlot: Object.fromEntries(Object.entries(bySlot).map(([s, l]) => [s, l.length])), compositions: n};
    pairs += p; looks += n;
  }
  return {bodies: bodies.length, wearables: wear.length, perSlotWearables: Object.fromEntries(SLOT_ORDER.map(s => [s, wear.filter(w => w.def.slot === s).length])), pairs, looks, perBody: per,
    definitions: {pairs: 'supported body x wearable pairs: each is a separately fitted, skinned and masked mesh variant (built here, validated by tests); excluded/covered pairs are not counted',
      looks: 'valid compositions per body (enumerated): one fitted wearable or nothing per slot the body does not cover, required slots filled, at least one wearable, no per-body layering incompatibility (iteration 07 incompatibleWear); registry incompatibleWith rules are applied on top by the runtime count'}};
}

const STATUS = {approved: false, gameReady: false, stage: 'unapproved prototype derivative (iteration 06 zombie wardrobe); art/anatomy/deformation/fit not certified', licenseClearance: 'none - evaluation quality does not grant commercial rights; sources are AI reconstructions of AI-generated concept images'};
const HONESTY = {sourcesHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming/hierarchy) and automatic skin weights created by this CPU pipeline', animation: 'hand-authored procedural keyframes (same clip functions for every body, sampled with each body\'s own joint positions) - NOT motion capture', generation: 'no AI generation, inference, model download or network service was used by this builder'};

function srcInfo(s, stageMaster) {
  const rr = f => f && (path.isAbsolute(f) ? path.relative(REPO, f) : f);
  return {id: s.id, file: rr(s.file), sha256Verified: s.sha256, uploadId: s.uploadId, sourceMetadata: rr(s.metadata), displayName: s.displayName, ledger: s.ledger, ledgerKey: s.ledgerKey, inputPng: rr(s.inputPng), inputPngSha256: s.inputPngSha256, nativeJob: s.jobId, nativeMetadata: rr(s.nativeMetadata), nativeReceipt: rr(s.nativeReceipt), preservedXz: rr(s.preservedXz),
    triangles: stageMaster?.triangles, vertices: stageMaster?.vertices, textures: stageMaster?.textures, material: stageMaster?.material};
}

function bodyManifest(B, {glb, bytes, sha, death, verify, clips, extras, audit, t25}) {
  const J = B.skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(Math.hypot(J[n][0] - J[p][0], J[n][1] - J[p][1], J[n][2] - J[p][2]))]));
  return {schema: 'the-last-line/derivative-manifest@1', asset: 'zombie-body-' + B.id, title: `Zombie body "${B.def.label}" - rigged runtime derivative (prototype)`, status: STATUS, honesty: HONESTY, origin: originOf(B), provenance: provenanceOf(B), traits: B.def.traits ?? {}, t25,
    outputs: {glb: {path: rel(glb), bytes, sha256: sha, format: 'glTF 2.0 binary, no Draco/meshopt/KTX2, JPEG textures, JOINTS_0 u8 / WEIGHTS_0 normalized u8'}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: extras.heightM, bindPose: 'A-pose (arm angles in skeleton.estimation)'},
    source: srcInfo(B.src, B.stage.master), placement: {...B.stage.placement, nativeBounds: undefined}, facing: B.stage.facing, poseCorrection: B.stage.repose ?? null, bridgeTrim: B.stage.bridgeTrim ?? null, skinOverrides: B.def.skin ?? null,
    mesh: {node: 'ZombieBody', vertices: B.low.pos.length / 3, triangles: B.low.idx.length / 3, simplify: B.stage.stats.simplify, unwrap: B.stage.stats.unwrap, bake: (({ms, ...r}) => r)(B.stage.stats.bake), textures: B.def.textures},
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends: B.skel.ends, boneLengthsM, validationIssues: B.stage.issues, estimation: B.skel.log},
    skinning: {method: 'skin.mjs region classification + chain weights + masked Laplacian smoothing (same as zombie-rigged body)', ...B.weldedWeights.stats},
    profile: B.profile,
    clips: clips.map(c => ({name: c.name, durationS: c.duration, loop: c.loop, keyframes: c.times.length, maxLegReach: c.maxLegReach})),
    death: {hipsY: r4(death.hipsY), tune: death.tune, lowestPointPerRegionM: death.contact, solvedAgainst: 'body + every fitted wearable'},
    verification: {cpuSkinningFloor: verify, motionStretch: {...audit, method: 'per triangle: worst edge length ratio posed/bind over every 3rd frame of all six clips (CPU skinning); body alone'}},
    limitations: [
      'Automatic approximate skin weights; LBS volume loss at shoulders/elbows/hips in extreme poses.',
      'Procedural (not mocap) clips; no facial rig, no finger or twist bones.',
      'Hidden-side geometry of the source is AI-hallucinated; textures re-baked at 2048 and downsampled to 1024 (MR 256); no normal map.',
      'Joint centres without visible landmarks use anthropometric ratios between measured landmarks.',
      ...(B.def.repose ? ['Reused T-pose source: arms rotated into the A-pose offline (repose v2: torso flank held fixed below the armpit, cloth fringe hanging under the T-pose sleeves removed); the wide torn jacket sleeves still deform with LBS.'] : []),
      ...(B.def.traits?.baseLayer ? ['Base-layer body (opaque tank/t-shirt + shorts/briefs + socks as generated); the runtime always gives it pants (traits.requires lower).'] : []),
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ]};
}

function wearableManifest(w, bodies, {glb, bytes, sha, t25}, motion) {
  const g = w.g, kind = w.def.kind;
  const perBody = Object.fromEntries(bodies.map(B => { const v = fits0(w, B); return [B.id, {node: `Outfit_${w.id}__${B.id}`, ...v.stats, mask: {hidden: v.mask.hidden, total: v.mask.total, method: v.mask.method}, motionStretch: motion[B.id]?.wearables[w.id]}]; }));
  return {schema: 'the-last-line/derivative-manifest@1', asset: 'outfit-' + w.id, title: `Zombie wearable "${w.def.label}" (${w.def.slot}) - fitted per body (prototype)`, status: STATUS,
    honesty: {...HONESTY, garment: kind === 'rigid' ? 'item source is a separate empty (ghost) reconstruction; scaled and placed per body (rigid, no deformation)' : 'garment source is a separate ghost-mannequin reconstruction; fitted and skinned per body by this pipeline (no cloth simulation)'},
    origin: originOf(w), provenance: provenanceOf(w), slot: w.def.slot, kind, t25,
    outputs: {glb: {path: rel(glb), bytes, sha256: sha, format: 'glTF 2.0 binary; shared material/texture + shared TEXCOORD_0/index accessors; one SkinnedMesh per body (own POSITION/NORMAL/JOINTS_0/WEIGHTS_0 + skin over that body\'s joints); scene extras zombieWearable'}},
    source: srcInfo(w.src, g.master),
    stage: kind === 'garment' ? {canonicalFit: {body: CANONICAL_BODY, global: g.fit, backTaper: g.backTaper, sleeveRetarget: g.retarget, fitSkeleton: g.fitJoints, pushOut: g.pushOut, skin: g.skinStats}} : {nominal: g.nominal, frame: g.frameSummary ?? null, sourceTrim: g.trim ?? null},
    mesh: {vertices: g.low.pos.length / 3, triangles: g.low.idx.length / 3, simplify: g.stats.simplify, unwrap: g.stats.unwrap, bake: (({ms, ...r}) => r)(g.stats.bake), textures: w.def.textures},
    perBody,
    limitations: [
      kind === 'rigid' ? 'Rigid item: follows the Head bone exactly; no strap/brim flex.' : 'No cloth simulation: linear-blend skinned with weights transferred from each body; it cannot drape, swing or collide in motion.',
      kind === 'pants' ? 'Pants fitted by a row-wise profile map (A-pose bodies standing upright) + push-out; deep crouches/lying poses can show small interpenetration with the body\'s own shoes or shorts.' : kind === 'garment' ? 'Per-body fit = skeleton-driven retarget + bind-pose push-out (+ collision with the body\'s fitted pants above the crotch); residual interpenetration appears in strong poses.' : 'Placement by a rigid contact solve on a 2 mm height/depth field; hair is allowed to compress slightly under hats and is hidden where enclosed.',
      'Body triangles fully enclosed by the item in the bind pose are hidden per body; in motion small gaps can reveal the underlying body or base clothing.',
      'Hidden-side geometry of the source is AI-hallucinated.',
      'Unapproved prototype; gameReady false.',
    ]};
}
const fits0 = (w, B) => fits[w.id][B.id];

await main();
