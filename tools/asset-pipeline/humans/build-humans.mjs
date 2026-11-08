#!/usr/bin/env node
// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the friendly MARKET HUMANS builder (CPU only; no generation,
// inference or network service — the five Meshy T2.5 human bases were generated and paid for by the task before this lane).
//   LL_THREADS=1 node --max-old-space-size=6000 tools/asset-pipeline/humans/build-humans.mjs [--reuse]
//   --reuse         reuse the zombie wardrobe's cached canonical-body / wearable stages (/tmp/ll-zombie-variants, keyed exactly as
//                   zombie/build-wardrobe.mjs keys them) and this builder's fit cache (/tmp/ll-market-humans/fit-cache)
//   dev only: --bodies=m1,f1 --wear=hoodie,cap --no-fit (bodies + clips only) --out=DIR (write to DIR/models, DIR/derivatives;
//             nothing else touched, no allowlist update) --no-gate (QA: keep gate failures, to render where they poke)
//
// Pipeline (every library reused by import from tools/asset-pipeline/zombie, none edited; the zombie outputs are untouched):
//  1. bodies (lib/body.mjs): the Meshy base placed at its stature, skeleton detected on a densified copy (+ documented landmark
//     fixes), the Meshy mesh / UVs / maps KEPT; skin weights (zombie autorig bodySkin), girth profile, hit radii.
//  2. HEALTHY clips per body (lib/clips.mjs): Idle, Walk (stride fitted to the leg), Talk, Greet, Work, Sit (solved on the mesh).
//  3. the canonical garment body = the zombie wardrobe's Last-shift stage, and the ordinary wearables' stages (garment canonical fit
//     / pants / rigid) exactly as the zombie wardrobe builds them (same sources, parameters, colour-grade policy, cache keys).
//  4. per body x wearable fit (zombie fit-pool: fit.mjs + fit07 pose-aware refit), validated on the bind pose + every 3rd frame of
//     the HEALTHY clips; lower / head first, then the uppers colliding with that body's fitted pants (layering).
//  5. gates (zombie FIT07 limits; no ragdoll extremes: the humans never ragdoll) + the motion-stretch gate; excluded pairs recorded.
//  6. layer masks (upper over lower), floor verification, then ONE cast GLB + ONE provenance JSON + their allowlist entries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadAnySource, t25LoaderHash} from '../zombie/lib/t25.mjs';
import {bodyStage, bodySkin, bodyProfile, spreadWeights, rigFor} from '../zombie/lib/autorig.mjs';
import {garmentCanonical} from '../zombie/lib/garment.mjs';
import {pantsStage} from '../zombie/lib/pants.mjs';
import {rigidStage} from '../zombie/lib/rigid.mjs';
import {hitRadii} from '../zombie/lib/hit.mjs';
import {fitVariantsParallel} from '../zombie/lib/fit-pool.mjs';
import {coverMask} from '../zombie/lib/fit.mjs';
import {auditPoses, triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {worldList} from '../zombie/lib/fit07.mjs';
import {Rig} from '../zombie/lib/pose.mjs';
import {geometryHash, bitsetBase64, writeDoc} from '../zombie/lib/variant-glb.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {gradeBase} from '../zombie/lib/grade.mjs';
import {noseCheck, shiftHeadCfg} from '../zombie/lib/nose-check.mjs';
import {BODIES as ZOMBIE_BODIES, CANONICAL_BODY, SKIN as ZOMBIE_SKIN, T25, T25_DENSIFY, T25_GRADE} from '../zombie/wardrobe.config.mjs';
import {humanSource, wardrobeT25Source, refRel, HUMANS_TASK} from './lib/sources.mjs';
import {humanBodyStage, trimLegBridges} from './lib/body.mjs';
import {HUMAN_CLIP_SPECS, sampleHumanClip, walkGait, solveSit} from './lib/clips.mjs';
import {buildCastDocument} from './lib/glb.mjs';
import {OUT, HUMAN_BODIES, HUMAN_WEARABLES, HUMAN_FIT, HUMAN_QUALITY, HUMAN_SKIN} from './humans.config.mjs';

// 1-CPU pod: bake.mjs / fit-pool.mjs size their worker pools from os.cpus() (the host's cores); LL_THREADS caps it
if (+process.env.LL_THREADS > 0) { const cpus = os.cpus; os.cpus = () => cpus().slice(0, +process.env.LL_THREADS); }
const ARGS = new Set(process.argv.slice(2));
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.replace(/^--/, '').split('=')));
const onlyB = OPT.bodies ? new Set(OPT.bodies.split(',')) : null, onlyW = OPT.wear ? new Set(OPT.wear.split(',')) : null;
const OUT_ROOT = OPT.out ? path.resolve(OPT.out) : null;
const PUB = path.join(REPO, 'game/public');
const GLB_FILE = OUT_ROOT ? path.join(OUT_ROOT, 'models', path.basename(OUT.glb)) : path.join(PUB, OUT.glb);
const JSON_FILE = OUT_ROOT ? path.join(OUT_ROOT, 'derivatives', path.basename(OUT.manifest)) : path.join(PUB, OUT.manifest);
const ALLOW = path.join(REPO, 'tools/release/public-inputs.json');
const GENERATOR = 'Terminal State market humans builder (tools/asset-pipeline/humans/build-humans.mjs)';
const ZTMP = '/tmp/ll-zombie-variants', TMP = '/tmp/ll-market-humans';
const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const cfgOf = def => { const {source, ...cfg} = def; return cfg; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const CLIP_NAMES = Object.keys(HUMAN_CLIP_SPECS);

// ---- the zombie wardrobe's stage cache, keyed exactly as zombie/build-wardrobe.mjs keys it (code hash of the same stage modules)
const ZOMBIE_LIB = new URL('../zombie/', import.meta.url);
function zombieCodeHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['lib/source.mjs', 'lib/mesh.mjs', 'lib/unwrap.mjs', 'lib/bake.mjs', 'lib/bake-worker.mjs', 'lib/stage-mesh.mjs', 'lib/skeleton.mjs', 'lib/slices.mjs', 'lib/autorig.mjs', 'lib/garment.mjs', 'lib/repose.mjs', 'lib/pants.mjs', 'lib/rigid.mjs'])
    h.update(fs.readFileSync(new URL(f, ZOMBIE_LIB)));
  return h.digest('hex').slice(0, 12);
}
function zombieCache(extraKey) {
  return async (key, fn) => {
    if (!ARGS.has('--reuse')) return fn();
    const file = path.join(ZTMP, 'cache', `${key}-${zombieCodeHash()}-${crypto.createHash('sha256').update(JSON.stringify(extraKey)).digest('hex').slice(0, 12)}.v8`);
    if (fs.existsSync(file)) { console.log('  (zombie stage cache)', path.basename(file)); return v8.deserialize(fs.readFileSync(file)); }
    const r = await fn();
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file + '.tmp', v8.serialize(r)); fs.renameSync(file + '.tmp', file);
    return r;
  };
}
/** zombie/build-wardrobe.mjs srcKey for a T2.5 source. */
const srcKey = src => `${src.sha256}|t25:${t25LoaderHash()}|${src.densifyFrac}${src.trimTopCap ? '|trim' + src.trimTopCap : ''}`;

function guard(file) {
  if (OUT_ROOT) { if (!path.resolve(file).startsWith(OUT_ROOT + path.sep)) throw new Error('dev output outside --out: ' + file); return file; }
  const rel = path.relative(PUB, path.resolve(file));
  if (rel !== OUT.glb && rel !== OUT.manifest) throw new Error('refusing to write outside the market human outputs: ' + rel);
  return file;
}

async function main() {
  const t0 = Date.now();
  const sources = [];
  // ------------------------------------------------------------------ 1. human bodies + 2. healthy clips
  const bodies = [];
  for (const def of HUMAN_BODIES) {
    if (onlyB && !onlyB.has(def.id)) continue;
    const src = humanSource(def.id);
    sources.push(src);
    console.log(`[human ${def.id}] ${refRel(src.file)}`);
    const stage = await humanBodyStage(src, {heightM: def.heightM, skeleton: def.skeleton ?? null, fix: def.fix ?? null, textures: def.textures});
    if (stage.issues.length) console.log(`  skeleton notes: ${stage.issues.join('; ')}`);
    const sw = bodySkin(stage, HUMAN_SKIN);
    const tr = trimLegBridges(stage.low, sw, stage.skel);
    stage.low = tr.low; stage.legBridgeTrim = {removed: tr.removed, method: tr.method};
    if (tr.removed) console.log(`  leg bridge trim: removed ${tr.removed} triangles`);
    const spread = spreadWeights(stage.low, sw);
    const profile = bodyProfile(stage.skel, stage.low.welded, sw);
    profile.hit = hitRadii(profile, stage.skel);
    const B = {id: def.id, def, src, stage, skel: stage.skel, rigDesc: rigFor(stage.skel), low: stage.low, weldedWeights: sw, joints: spread.joints, weights: spread.weights, profile};
    B.noseCheck = noseCheck(B);
    const rig = new Rig(B.skel);
    B.gait = walkGait(rig);
    B.sit = solveSit(rig, B.skel, {pos: B.low.pos, joints: B.joints, weights: B.weights});
    B.clips = CLIP_NAMES.map(n => sampleHumanClip(rig, n, {gait: B.gait, sit: B.sit}));
    B.rig = rig;
    // validation poses of the pose-aware garment refit: the bind pose + every 3rd frame of the healthy clips
    B.validation = [{clip: 'Bind', t: 0, world: worldList(rig.fk({hips: [0, 0, 0], rot: {}}), B.skel)},
      ...auditPoses(B.clips, {every: HUMAN_FIT.everyFrames}).map(p => ({clip: p.clip, t: p.t, world: worldList(rig.fk(p.pose), B.skel)}))];
    console.log(`  ${stage.stats.runtimeTriangles} tris, hit ${JSON.stringify(profile.hit)}; walk ${B.gait.groundSpeed} m/s (stride ${B.gait.stride}, drop ${B.gait.drop}, reach ${B.gait.maxReach}); sit knee ${B.sit.knee} hips ${B.sit.hipsY}; ${B.validation.length} validation poses`);
    bodies.push(B);
  }
  if (!bodies.length) throw new Error('no bodies');

  // ------------------------------------------------------------------ 3. canonical garment body + wearable stages
  const wear = [];
  let C = null;
  if (!ARGS.has('--no-fit')) {
    const cdef = ZOMBIE_BODIES.find(b => b.id === CANONICAL_BODY);
    const csrc = wardrobeT25Source(T25[CANONICAL_BODY], T25_DENSIFY.body);
    sources.push(csrc);
    const copts = cfgOf(cdef);
    const stageKey = Object.fromEntries(['heightM', 'targetTris', 'importance', 'unwrap', 'density', 'bake', 'textures', 'facing', 'repose', ...(copts.reposeOpts ? ['reposeOpts'] : []), ...(copts.skeleton ? ['skeleton'] : [])].map(k => [k, copts[k] ?? null]));
    console.log(`[canonical ${CANONICAL_BODY}] ${refRel(csrc.file)}`);
    const cst = await zombieCache({src: srcKey(csrc), stageKey})('body-' + CANONICAL_BODY, async () => bodyStage(await loadAnySource(csrc), copts));
    const csw = bodySkin(cst, {...ZOMBIE_SKIN, ...(cdef.skin ?? {})});
    const cspread = spreadWeights(cst.low, csw);
    const cprofile = bodyProfile(cst.skel, cst.low.welded, csw);
    cprofile.hit = hitRadii(cprofile, cst.skel);
    C = {id: CANONICAL_BODY, def: cdef, src: csrc, stage: cst, skel: cst.skel, rigDesc: rigFor(cst.skel), low: cst.low, weldedWeights: csw, joints: cspread.joints, weights: cspread.weights, profile: cprofile};
    for (const def of HUMAN_WEARABLES) {
      if (onlyW && !onlyW.has(def.id)) continue;
      if (!bodies.some(B => B.def.wear.includes(def.id))) continue;
      const p = T25[def.id];
      const src = wardrobeT25Source(p, T25_DENSIFY.wearable, p.trimTopCap ? {trimTopCap: p.trimTopCap} : {});
      sources.push(src);
      console.log(`[${def.slot} ${def.id}] ${refRel(src.file)}`);
      const cfg = cfgOf(def);
      if (def.kind === 'pants') cfg.measureDensify = 0.008; // as zombie/build-wardrobe.mjs (T2.5 pants)
      let g;
      if (def.kind === 'garment') g = await garmentCanonical(() => loadAnySource(src), cfg, {skel: C.skel, rigDesc: C.rigDesc, welded: C.low.welded, weights: C.weldedWeights}, zombieCache({src: srcKey(src), cfg, canonical: geometryHash(C.low.pos, C.low.idx)}), ZOMBIE_SKIN);
      else {
        const stageCfg = {targetTris: cfg.targetTris, unwrap: cfg.unwrap, bake: cfg.bake, textures: cfg.textures, facing: cfg.facing, trimBehind: cfg.trimBehind};
        g = await zombieCache({src: srcKey(src), stageCfg})(`${def.kind}-${def.id}`, async () => (def.kind === 'pants' ? pantsStage : rigidStage)(await loadAnySource(src), stageCfg));
      }
      // the zombie wardrobe's documented colour grade (T25 grade / T25_GRADE policy): the same texture as the zombies' file
      const grade = T25[def.id]?.grade ?? T25_GRADE;
      if (grade) {
        const gr = await gradeBase(g.enc, g.low, grade, def.textures.jpegQuality, src.t25.inputImage);
        g = {...g, enc: gr.jpg ? {...g.enc, baseJpg: gr.jpg} : g.enc, colourGrade: gr.stats};
      }
      wear.push({id: def.id, def, cfg, src, g});
    }
  }

  // ------------------------------------------------------------------ 4. fits
  const fits = {}, excluded = [];
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
  const lowerLayers = B => wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]?.weldedJoints).map(w => { const v = fits[w.id][B.id]; return {id: w.id, pos: v.weldedPos, idx: w.g.low.welded.idx, joints: v.weldedJoints, weights: v.weldedWeights}; });
  const lowerUV = B => Object.fromEntries(wear.filter(w => w.def.slot === 'lower' && fits[w.id]?.[B.id]).map(w => { const v = fits[w.id][B.id]; return [w.id, {pos: v.pos, idx: w.g.low.idx, joints: v.joints, weldId: w.g.low.weldId}]; }));
  const runPhase = async list => {
    const jobs = [];
    for (const w of list) {
      fits[w.id] ??= {};
      for (const B of bodies) {
        if (!B.def.wear.includes(w.id)) continue;
        const up = w.def.slot === 'upper';
        const jcfg = w.def.kind === 'rigid' ? shiftHeadCfg(w.cfg, B.noseCheck?.shift ?? 0) : w.cfg;
        jobs.push({key: `${w.id}|human-${B.id}`, g: w.g, cfg: jcfg, C, B, extraCollide: up ? lowerCollision(B) : undefined, poses: B.validation, layers: up ? lowerLayers(B) : undefined, layerUV: up ? lowerUV(B) : undefined, onDone: (v, ms) => {
          fits[w.id][B.id] = v;
          const rf = v.stats.refit07;
          console.log(`  fit ${w.id} x ${B.id}: hidden ${v.mask.hidden}/${v.mask.total}${rf ? ` refit offset p95 ${rf.offsetM.p95} max ${rf.offsetM.max}` : ''} (${ms} ms)`);
        }});
      }
    }
    await fitVariantsParallel(jobs, {cacheDir: ARGS.has('--reuse') ? path.join(TMP, 'fit-cache') : null});
  };
  if (C) {
    await runPhase(wear.filter(w => w.def.slot !== 'upper'));
    await runPhase(wear.filter(w => w.def.slot === 'upper'));
  }
  // ------------------------------------------------------------------ 5. gates
  const fitGate = {limits: HUMAN_FIT.gate, variants: [], layerIncompatible: []};
  for (const w of wear) for (const B of bodies) {
    const v = fits[w.id]?.[B.id], rf = v?.stats?.refit07;
    if (!rf) continue;
    const vis = rf.visiblePerClip ?? {}, cov = Math.max(1, ...Object.values(vis).map(c => c.covered));
    const anim = Object.entries(vis).filter(([k]) => k !== 'Bind');
    const m = {body: B.id, wearable: w.id, covered: cov, bind: +((vis.Bind?.maxVisiblePoke ?? 0) / cov).toFixed(4), animated: +(Math.max(0, ...anim.map(([, c]) => c.maxVisiblePoke)) / cov).toFixed(4),
      perClip: Object.fromEntries(anim.map(([k, c]) => [k, +(c.maxVisiblePoke / cov).toFixed(4)])), layers: {}};
    for (const [, c] of anim) for (const [lid, l] of Object.entries(c.layers ?? {})) { const q = m.layers[lid] ??= {covered: l.covered, animated: 0}; q.animated = Math.max(q.animated, l.maxVisiblePoke); }
    for (const q of Object.values(m.layers)) q.animated = +(q.animated / Math.max(1, q.covered)).toFixed(4);
    const g = HUMAN_FIT.gate, fail = [];
    if (m.bind > g.bind) fail.push(`bind ${(m.bind * 100).toFixed(2)}% > ${g.bind * 100}%`);
    if (m.animated > g.animated) fail.push(`animated ${(m.animated * 100).toFixed(2)}% > ${g.animated * 100}%`);
    m.pass = !fail.length;
    fitGate.variants.push(m);
    if (fail.length && !ARGS.has('--no-gate')) {
      excluded.push({body: B.id, wearable: w.id, slot: w.def.slot, rule: 'fit-pose-gate', reason: `body still visibly pokes through the refitted cloth in the healthy clips: ${fail.join(', ')} of ${cov} covered vertices`, metrics: m});
      delete fits[w.id][B.id];
      console.log(`  ! ${w.id} x ${B.id} EXCLUDED by the pose gate: ${fail.join(', ')}`);
      continue;
    }
    for (const [lid, q] of Object.entries(m.layers)) if (q.animated > g.layerAnimated) {
      fitGate.layerIncompatible.push({body: B.id, upper: w.id, lower: lid, animated: q.animated, covered: q.covered});
      (v.incompatibleWear ??= []).push(lid);
      console.log(`  ! ${w.id} over ${lid} on ${B.id}: pants poke through ${(q.animated * 100).toFixed(2)}% -> per-body incompatibility`);
    }
  }
  if (ARGS.has('--no-write')) { console.log('dev run: nothing written'); return; }

  // ------------------------------------------------------------------ 6. motion audit, layer masks, floor check, write
  const summary = {bodies: {}, pairs: [], motion: {}};
  const variantExtras = {};
  for (const B of bodies) {
    const worn = wear.filter(w => fits[w.id]?.[B.id]);
    const poses = auditPoses(B.clips, {every: 3});
    const bs = triangleStretch({pos: B.low.pos, idx: B.low.idx, joints: B.joints, weights: B.weights}, B.skel, B.rig, poses);
    const audit = {body: stretchStats(bs.worst, poses, bs.at, {ratio: HUMAN_QUALITY.stretchRatio}), wearables: {}};
    for (const w of worn) {
      const v = fits[w.id][B.id];
      const ws = triangleStretch({pos: v.pos, idx: w.g.low.idx, joints: v.joints, weights: v.weights}, B.skel, B.rig, poses);
      audit.wearables[w.id] = stretchStats(ws.worst, poses, ws.at, {ratio: HUMAN_QUALITY.stretchRatio});
    }
    for (const w of [...worn]) {
      const a = audit.wearables[w.id];
      if (a.fractionOver <= HUMAN_QUALITY.maxFractionOver) continue;
      excluded.push({body: B.id, wearable: w.id, slot: w.def.slot, rule: 'motion-quality-gate', reason: `${(a.fractionOver * 100).toFixed(1)}% of its triangles stretch > ${HUMAN_QUALITY.stretchRatio}x in the clips (limit ${HUMAN_QUALITY.maxFractionOver * 100}%)`, motion: a});
      delete fits[w.id][B.id];
      worn.splice(worn.indexOf(w), 1);
      console.log(`  ! ${w.id} x ${B.id} EXCLUDED by the motion-quality gate`);
    }
    summary.motion[B.id] = audit;
    console.log(`[audit ${B.id}] body over${HUMAN_QUALITY.stretchRatio}x ${audit.body[`over${HUMAN_QUALITY.stretchRatio}x`]}/${audit.body.triangles}; worn: ${worn.map(w => w.id).join(', ')}`);
    // layer masks: lower-garment triangles under each upper (the fit07 all-pose mask when the refit made one)
    for (const U of worn.filter(w => w.def.slot === 'upper')) for (const L of worn.filter(w => w.def.slot === 'lower')) {
      const lv = fits[L.id][B.id], uv = fits[U.id][B.id];
      const ex = (variantExtras[U.id] ??= {})[B.id] ??= {};
      if (uv.hideWear?.[L.id]) { (ex.hideWear ??= {})[L.id] = bitsetBase64(uv.hideWear[L.id].hide); (ex.hideWearCounts ??= {})[L.id] = uv.hideWear[L.id].hidden; continue; }
      const m = coverMask({pos: lv.pos, idx: L.g.low.idx}, {pos: uv.weldedPos, idx: U.g.canonical.idx}, {maxDist: 0.08, inset: 0.01, tiltDeg: 24, bodyJoints: lv.joints, skipJoints: ['L_Foot', 'R_Foot']});
      (ex.hideWear ??= {})[L.id] = bitsetBase64(m.hide); (ex.hideWearCounts ??= {})[L.id] = m.hidden;
    }
    // floor: the lowest skinned vertex per clip (body alone, body + each worn wearable)
    B.floor = {};
    for (const c of B.clips) {
      const row = {};
      const sets = {body: [{pos: B.low.pos, joints: B.joints, weights: B.weights}], ...Object.fromEntries(worn.map(w => [w.id, [{pos: fits[w.id][B.id].pos, joints: fits[w.id][B.id].joints, weights: fits[w.id][B.id].weights}]]))};
      for (const [label, meshes] of Object.entries(sets)) {
        let lo = Infinity;
        for (let f = 0; f < c.times.length; f += 2) {
          const world = B.rig.fk({hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))});
          for (const mesh of meshes) { const P = skinPositions(mesh, B.skel, world); for (let i = 1; i < P.length; i += 3) if (P[i] < lo) lo = P[i]; }
        }
        row[label] = +lo.toFixed(4);
      }
      B.floor[c.name] = row;
    }
    console.log(`  floor (lowest skinned vertex per clip): ${JSON.stringify(Object.fromEntries(Object.entries(B.floor).map(([k, v]) => [k, v.body])))}`);
  }
  // runtime extras
  const bodyExtras = B => ({body: B.id, label: B.def.label, heightM: r4(B.skel.H), hit: B.profile.hit, triangles: B.low.idx.length / 3, geometryHash: geometryHash(B.low.pos, B.low.idx),
    clips: Object.fromEntries(B.clips.map(c => [c.name, {duration: c.duration, loop: c.loop, ...(c.name === 'Walk' ? {groundSpeed: B.gait.groundSpeed} : {})}]))});
  const castBodies = bodies.map(B => ({id: B.id, skel: B.skel, mesh: {pos: B.low.pos, nrm: B.low.nrm, uv: B.low.uv, idx: B.low.idx, joints: B.joints, weights: B.weights}, enc: B.stage.enc, clips: B.clips, extras: bodyExtras(B)}));
  const castWear = wear.filter(w => bodies.some(B => fits[w.id]?.[B.id])).map(w => ({id: w.id, uv: w.g.low.uv, idx: w.g.low.idx, enc: w.g.enc,
    variants: bodies.filter(B => fits[w.id]?.[B.id]).map(B => {
      const v = fits[w.id][B.id], ex = variantExtras[w.id]?.[B.id] ?? {};
      return {bodyId: B.id, pos: v.pos, nrm: v.nrm, joints: v.joints, weights: v.weights,
        extras: {wearable: w.id, slot: w.def.slot, body: B.id, bodyGeometryHash: geometryHash(B.low.pos, B.low.idx), hideBodyTriangles: bitsetBase64(v.mask.hide), hiddenCount: v.mask.hidden, bulkM: v.stats.bulkM,
          ...(ex.hideWear ? {hideWear: ex.hideWear, hideWearCounts: ex.hideWearCounts} : {}), ...(v.incompatibleWear?.length ? {incompatibleWear: v.incompatibleWear} : {})}};
    })}));
  const sceneExtras = {schema: 'terminal-state/market-humans@1', task: HUMANS_TASK, clips: CLIP_NAMES,
    bodies: bodies.map(B => ({id: B.id, label: B.def.label, heightM: r4(B.skel.H), wear: castWear.filter(w => w.variants.some(v => v.bodyId === B.id)).map(w => w.id)})),
    wearables: castWear.map(w => { const d = wear.find(x => x.id === w.id).def; return {id: w.id, slot: d.slot, label: d.label, heavy: !!d.heavy, bodies: w.variants.map(v => v.bodyId)}; }),
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet'}, approved: false};
  const doc = buildCastDocument({bodies: castBodies, wearables: castWear, extras: sceneExtras, generator: GENERATOR});
  fs.mkdirSync(path.dirname(GLB_FILE), {recursive: true}); fs.mkdirSync(path.dirname(JSON_FILE), {recursive: true});
  await writeDoc(doc, guard(GLB_FILE));
  const glbBytes = fs.readFileSync(GLB_FILE);
  // sources unchanged
  for (const s of sources) if (sha256File(s.file) !== s.sha256) throw new Error('SOURCE CHANGED ' + s.file);
  const manifest = buildManifest({bodies, wear, fits, excluded, fitGate, summary, glb: {path: OUT.glb, bytes: glbBytes.length, sha256: sha(glbBytes)}, castWear});
  const manBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(guard(JSON_FILE), manBuf);
  console.log(`wrote ${OUT.glb} ${glbBytes.length} B, ${OUT.manifest} ${manBuf.length} B`);
  if (!OUT_ROOT && !onlyB && !onlyW) {
    const raw = fs.readFileSync(ALLOW, 'utf8'), allow = JSON.parse(raw);
    if (JSON.stringify(allow, null, 2) + '\n' !== raw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
    const mine = new Map([[OUT.glb, glbBytes], [OUT.manifest, manBuf]]);
    allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
    console.log('allowlist: tools/release/public-inputs.json (2 entries added / updated)');
  }
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
}

const STATUS = {approved: false, gameReady: false, stage: 'unapproved prototype derivative (friendly market humans); art / anatomy / deformation / fit not certified', licenseClearance: 'none - evaluation quality does not grant commercial rights; the bases are AI reconstructions (Meshy T2.5) of AI-generated (Codex) concept images'};
const HONESTY = {sourcesHadSkeleton: false, rig: 'NEW derivative skeleton (the shared 18-joint naming / hierarchy) and automatic skin weights created by this CPU pipeline (zombie autorig libraries)',
  animation: 'hand-authored procedural HEALTHY clips (tools/asset-pipeline/humans/lib/clips.mjs; same functions for every body, sampled with each body\'s own joints) - NOT motion capture, NOT the zombie clips',
  maps: 'the Meshy base colour, metallic-roughness and normal maps are KEPT on the Meshy mesh / UVs (re-encoded JPEG, resized only)', generation: 'no generation, inference, model download or network service was used by this builder'};

function buildManifest({bodies, wear, fits, excluded, fitGate, summary, glb, castWear}) {
  return {schema: 'the-last-line/derivative-manifest@1', asset: 'market-human-cast', task: HUMANS_TASK, title: 'Friendly market humans: five Meshy T2.5 bases x fitted ordinary wearables, healthy clips (prototype)', status: STATUS, honesty: HONESTY,
    outputs: {glb: {...glb, format: 'glTF 2.0 binary (KHR_mesh_quantization int8 normals); JPEG textures; per body: 18 prefixed joints, the skinned body, its fitted wearables on the SAME skin, its clips "<body>:<Clip>"; per wearable one shared texture / UV / index set'}},
    levelOnly: 'market (game/src/assets/levelAssets.ts LEVEL_ONLY_RULES market-*)',
    clips: Object.fromEntries(Object.entries(HUMAN_CLIP_SPECS).map(([k, v]) => [k, {loop: v.loop, durationS: v.duration ?? 'per body (gait)'}])),
    bodies: Object.fromEntries(bodies.map(B => {
      const J = B.skel.joints;
      return [B.id, {label: B.def.label, heightM: r4(B.skel.H), source: {file: refRel(B.src.file), sha256Verified: B.src.sha256, ...B.src.meshy},
        placement: {...B.stage.placement, nativeBounds: undefined}, facing: B.stage.facing, mesh: {...B.stage.stats, legBridgeTrim: B.stage.legBridgeTrim, shippedTriangles: B.low.idx.length / 3},
        skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), notes: B.stage.issues, fixes: B.skel.log.humanFix ?? [], options: B.def.skeleton ?? null},
        skinning: {method: 'zombie/lib/autorig.mjs bodySkin (skin.mjs region classification + chain weights + masked Laplacian smoothing)', ...B.weldedWeights.stats},
        profile: {...B.profile, torsoRows: undefined}, noseLandmarkCheck: B.noseCheck, gait: B.gait, sit: B.sit,
        clips: B.clips.map(c => ({name: c.name, durationS: c.duration, loop: c.loop, keyframes: c.times.length, maxLegReach: c.maxLegReach})),
        verification: {floorLowestSkinnedVertexM: B.floor, motionStretch: summary.motion[B.id]?.body},
        wear: {configured: B.def.wear, shipped: castWear.filter(w => w.variants.some(v => v.bodyId === B.id)).map(w => w.id)}}];
    })),
    canonicalGarmentBody: {id: CANONICAL_BODY, note: 'the zombie wardrobe\'s canonical body (its garments are fitted to it first, then retargeted to each human body)'},
    wearables: Object.fromEntries(wear.map(w => [w.id, {label: w.def.label, slot: w.def.slot, kind: w.def.kind, source: {asset: w.src.t25.asset, attempt: w.src.t25.attempt, taskId: w.src.t25.taskId, file: w.src.t25.nativeGlb, sha256Verified: w.src.sha256},
      stage: 'identical to the zombie wardrobe stage of this wearable (zombie/wardrobe.config.mjs parameters, same canonical fit, same colour-grade policy)', colourGrade: w.g.colourGrade ?? null,
      mesh: {vertices: w.g.low.pos.length / 3, triangles: w.g.low.idx.length / 3},
      perBody: Object.fromEntries(bodies.filter(B => fits[w.id]?.[B.id]).map(B => { const v = fits[w.id][B.id]; return [B.id, {node: `Wear_${w.id}__${B.id}`, hiddenBodyTriangles: v.mask.hidden, bulkM: v.stats.bulkM, refit: v.stats.refit07 ? {offsetM: v.stats.refit07.offsetM} : null, motionStretch: summary.motion[B.id]?.wearables[w.id], incompatibleWear: v.incompatibleWear ?? []}]; }))}])),
    fitGate, excluded,
    limitations: [
      'Automatic approximate skin weights; LBS volume loss at shoulders / elbows / hips in the deeper poses (Sit, Greet).',
      'Procedural (not mocap) clips; no facial rig, no finger or twist bones (hands stay in their A-pose shape).',
      'No cloth simulation: wearables are linear-blend skinned with weights transferred from each body; small gaps or pokes can show in strong poses.',
      'Hidden-side geometry of the Meshy bases is AI-hallucinated; the maps are the Meshy model\'s own (normal map kept, sampled without tangents).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified.',
    ],
    // (no build time / date: the record is byte-reproducible, like the GLB)
    rebuild: 'LL_THREADS=1 node --max-old-space-size=6000 tools/asset-pipeline/humans/build-humans.mjs --reuse && node tools/asset-pipeline/humans/qa/sheets.mjs'};
}

await main();
