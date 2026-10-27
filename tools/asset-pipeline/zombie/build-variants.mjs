#!/usr/bin/env node
// SUPERSEDED in iteration 06 by build-wardrobe.mjs (slot wardrobe: upper/lower/head/face, same output files).
// Running this iteration-05 builder would overwrite the iteration-06 runtime GLBs with the old outfit-only set.
// The Last Line - zombie body x outfit variety builder (iteration 05, CPU only, no inference).
//   node --max-old-space-size=24000 tools/asset-pipeline/zombie/build-variants.mjs [--reuse] [--only-stage]
//   --reuse       reuse cached body/garment mesh+bake stages in /tmp/ll-zombie-variants (dev; keyed by source sha + options + code hash)
//   --only-stage  stop after the cached stages (warm the cache)
// For every body whose source exists: generic auto-rig onto the shared 18-joint skeleton
// (lib/autorig.mjs). For every outfit whose source exists: fit once to the canonical body
// (lib/garment.mjs), then retarget/push-out/re-skin/mask per body (lib/fit.mjs). Writes ONLY:
//   game/public/assets/models/zombie-body-<id>.glb, game/public/assets/models/outfit-<id>.glb,
//   game/public/assets/derivatives/zombie-body-<id>.json, outfit-<id>.json, zombie-variants.json
// Sources (masters / native outputs) are read-only and sha256-verified before and after.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {REPO, sha256File} from './lib/master.mjs';
import {loadSource} from './lib/source.mjs';
import {bodyStage, bodySkin, bodyProfile, spreadWeights, rigFor} from './lib/autorig.mjs';
import {garmentCanonical} from './lib/garment.mjs';
import {reposeTtoA} from './lib/repose.mjs';
import {hitRadii} from './lib/hit.mjs';
import {fitVariantsParallel} from './lib/fit-pool.mjs';
import {sampleBodyClips, verifyClips} from './lib/clipsolve.mjs';
import {buildBodyDocument, buildOutfitDocument, writeDoc, geometryHash, bitsetBase64} from './lib/variant-glb.mjs';
import {JOINTS} from './lib/skeleton.mjs';
import {CLIP_SPECS} from './lib/clips.mjs';
import {BODIES, OUTFITS, CANONICAL_BODY, SKIN} from './variants.config.mjs';

const ARGS = new Set(process.argv.slice(2));
// dev filters (never used for the delivered build): --bodies=a,b --outfits=x,y --no-write
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.replace(/^--/, '').split('=')));
const onlyB = OPT.bodies ? new Set([...OPT.bodies.split(','), 'lastshift']) : null, onlyO = OPT.outfits ? new Set(OPT.outfits.split(',')) : null;
const TMP = '/tmp/ll-zombie-variants';
const MODELS = path.join(REPO, 'game/public/assets/models');
const DERIV = path.join(REPO, 'game/public/assets/derivatives');
const GENERATOR = 'The Last Line zombie variety builder (tools/asset-pipeline/zombie/build-variants.mjs)';
const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);

function guard(file) {
  const rel = path.relative(REPO, path.resolve(file));
  const ok = /^game\/public\/assets\/models\/(zombie-body|outfit)-[a-z0-9]+\.glb$/.test(rel) || /^game\/public\/assets\/derivatives\/(zombie-body-[a-z0-9]+|outfit-[a-z0-9]+|zombie-variants)\.json$/.test(rel);
  if (!ok) throw new Error('refusing to write outside the variety derivative outputs: ' + rel);
  return file;
}

function codeHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['lib/source.mjs', 'lib/mesh.mjs', 'lib/unwrap.mjs', 'lib/bake.mjs', 'lib/bake-worker.mjs', 'lib/stage-mesh.mjs', 'lib/skeleton.mjs', 'lib/slices.mjs', 'lib/autorig.mjs', 'lib/garment.mjs', 'lib/repose.mjs'])
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

async function main() {
  const t0 = Date.now();
  const sources = [];
  // ---------------------------------------------------------------- bodies
  const bodies = [], skipped = {bodies: [], outfits: []};
  for (const def of BODIES) {
    if (onlyB && !onlyB.has(def.id)) continue;
    const src = def.source();
    if (!src) { skipped.bodies.push({id: def.id, reason: 'source not available yet'}); console.log(`[body ${def.id}] skipped: no source`); continue; }
    sources.push(src);
    console.log(`[body ${def.id}] ${src.file}`);
    const {source, ...opts} = def;
    const stage = await makeCache({src: src.sha256, opts})('body-' + def.id, async () => {
      const m = await loadSource(src);
      // reused T-pose sources are re-posed into the shared A-pose on an in-memory copy first
      const r = def.repose === 'T' ? reposeTtoA(m) : m;
      const st = await bodyStage(r, opts);
      return r.repose ? {...st, repose: r.repose} : st;
    });
    if (stage.issues.length) console.log(`  ! skeleton issues: ${stage.issues.join('; ')}`);
    console.log('  facing', JSON.stringify(stage.facing), 'joints', JSON.stringify(stage.skel.joints));
    const sw = bodySkin(stage, SKIN);
    const spread = spreadWeights(stage.low, sw);
    const profile = bodyProfile(stage.skel, stage.low.welded, sw);
    profile.hit = hitRadii(profile, stage.skel); // supersedes autorig's single-row estimate
    console.log('  profile', JSON.stringify({limb: Object.fromEntries(Object.entries(profile.limb).map(([k, v]) => [k, v.radius])), torso: profile.torso, hit: profile.hit}));
    bodies.push({id: def.id, def, src, stage, skel: stage.skel, rigDesc: rigFor(stage.skel), low: stage.low, weldedWeights: sw, joints: spread.joints, weights: spread.weights, profile});
  }
  const C = bodies.find(b => b.id === CANONICAL_BODY);
  if (!C) throw new Error('canonical body missing');

  // ---------------------------------------------------------------- outfits (canonical fit)
  const outfits = [];
  for (const def of OUTFITS) {
    if (onlyO && !onlyO.has(def.id)) continue;
    const src = def.source();
    if (!src) { skipped.outfits.push({id: def.id, reason: 'source not available yet'}); console.log(`[outfit ${def.id}] skipped: no source`); continue; }
    sources.push(src);
    console.log(`[outfit ${def.id}] ${src.file}`);
    const {source, ...cfg} = def;
    const g = await garmentCanonical(() => loadSource(src), cfg, {skel: C.skel, rigDesc: C.rigDesc, welded: C.low.welded, weights: C.weldedWeights}, makeCache({src: src.sha256, cfg, canonical: geometryHash(C.low.pos, C.low.idx)}), SKIN);
    console.log('  fit', JSON.stringify(g.fit.scale), JSON.stringify(g.fit.translate), 'sleeved', g.garment.sleeved, 'tris', g.low.idx.length / 3, 'push', JSON.stringify(g.pushOut));
    outfits.push({id: def.id, def, src, g});
  }
  if (ARGS.has('--only-stage')) { console.log('stages ready'); return; }

  // ---------------------------------------------------------------- per body x outfit fit
  const variants = {}; // outfitId -> bodyId -> fit
  const jobs = [];
  for (const o of outfits) {
    variants[o.id] = {};
    const {source, ...cfg} = o.def;
    for (const B of bodies) jobs.push({key: `${o.id}|${B.id}`, g: o.g, cfg, C, B, onDone: (v, ms) => {
      variants[o.id][B.id] = v;
      console.log(`  fit ${o.id} x ${B.id}: hidden ${v.mask.hidden}/${v.mask.total} bulk ${JSON.stringify(v.stats.bulkM)} push max ${v.stats.pushOut.maxDisplacementM} insideBefore ${v.stats.pushOut.verticesInsideBodyBefore} transferMax ${v.stats.transfer.maxDistToBodyM} (${ms} ms)`);
    }});
  }
  await fitVariantsParallel(jobs);
  if (ARGS.has('--no-write') || ((onlyB || onlyO) && !ARGS.has('--write'))) {
    for (const o of outfits) for (const B of bodies) console.log(`  dbg ${o.id} x ${B.id}`, JSON.stringify(variants[o.id][B.id].stats.debug));
    if (OPT.dump) { const v8d = {}; for (const o of outfits) for (const B of bodies) v8d[o.id + '|' + B.id] = {pos: variants[o.id][B.id].pos, idx: o.g.low.idx, uv: o.g.low.uv, body: {pos: B.low.pos, idx: B.low.idx, uv: B.low.uv}}; fs.writeFileSync(OPT.dump, v8.serialize(v8d)); }
    console.log('dev run: nothing written'); return;
  }

  // ---------------------------------------------------------------- clips + verification per body
  fs.mkdirSync(MODELS, {recursive: true}); fs.mkdirSync(DERIV, {recursive: true});
  const summary = {bodies: {}, outfits: {}, combos: []};
  for (const B of bodies) {
    const bodyMesh = {name: 'ZombieBody', pos: B.low.pos, joints: B.joints, weights: B.weights};
    const outfitMeshes = outfits.map(o => ({name: 'Outfit_' + o.id, pos: variants[o.id][B.id].pos, joints: variants[o.id][B.id].joints, weights: variants[o.id][B.id].weights}));
    const {death, clips, rig} = sampleBodyClips(B.skel, [bodyMesh, ...outfitMeshes]);
    const sets = {body: [bodyMesh], ...Object.fromEntries(outfitMeshes.map(m => [m.name, [bodyMesh, m]]))};
    const verify = verifyClips(rig, B.skel, sets, clips);
    console.log(`[clips ${B.id}] death tune ${JSON.stringify(death.tune)} contact ${JSON.stringify(death.contact)}`);
    const worst = Math.min(...Object.values(verify).flatMap(c => Object.values(c).filter(x => x && x.minY != null).map(x => x.minY)));
    console.log(`  lowest skinned vertex over all clips/outfits ${worst.toFixed(4)} m`);
    const extras = {id: B.id, label: B.def.label, heightM: r4(B.skel.H), hit: B.profile.hit, bodyTriangles: B.low.idx.length / 3, geometryHash: geometryHash(B.low.pos, B.low.idx),
      clips: Object.keys(CLIP_SPECS), approved: false, gameReady: false, origin: B.def.origin};
    const doc = buildBodyDocument({id: B.id, skel: B.skel, mesh: {pos: B.low.pos, nrm: B.low.nrm, uv: B.low.uv, idx: B.low.idx, joints: B.joints, weights: B.weights, baseColor: B.stage.enc.baseJpg, metallicRoughness: B.stage.enc.mrJpg}, clips, extras, generator: GENERATOR});
    const glb = guard(path.join(MODELS, `zombie-body-${B.id}.glb`));
    await writeDoc(doc, glb);
    const bytes = fs.statSync(glb).size, sha = sha256File(glb);
    const manifest = bodyManifest(B, {glb, bytes, sha, death, verify, clips, extras});
    fs.writeFileSync(guard(path.join(DERIV, `zombie-body-${B.id}.json`)), JSON.stringify(manifest, null, 2) + '\n');
    summary.bodies[B.id] = {glb: path.relative(REPO, glb), bytes, sha256: sha, triangles: extras.bodyTriangles, vertices: B.low.pos.length / 3, heightM: extras.heightM, hit: B.profile.hit, skeletonIssues: B.stage.issues, lowestSkinnedVertexM: +worst.toFixed(4), boneLengths: manifest.skeleton.boneLengthsM};
    console.log(`  wrote ${path.relative(REPO, glb)} ${bytes} bytes`);
  }
  for (const o of outfits) {
    const vs = bodies.map(B => {
      const v = variants[o.id][B.id];
      return {bodyId: B.id, skel: B.skel, pos: v.pos, nrm: v.nrm, joints: v.joints, weights: v.weights,
        extras: {outfit: o.id, body: B.id, bodyTriangles: B.low.idx.length / 3, bodyGeometryHash: geometryHash(B.low.pos, B.low.idx), hideBodyTriangles: bitsetBase64(v.mask.hide), hiddenCount: v.mask.hidden, bulkM: v.stats.bulkM}};
    });
    const extras = {id: o.id, label: o.def.label, heavy: !!o.def.heavy, bodies: bodies.map(b => b.id), triangles: o.g.low.idx.length / 3, approved: false, gameReady: false, origin: o.def.origin};
    const doc = buildOutfitDocument({id: o.id, uv: o.g.low.uv, idx: o.g.low.idx, baseColor: o.g.enc.baseJpg, metallicRoughness: o.g.enc.mrJpg, variants: vs, extras, generator: GENERATOR});
    const glb = guard(path.join(MODELS, `outfit-${o.id}.glb`));
    await writeDoc(doc, glb);
    const bytes = fs.statSync(glb).size, sha = sha256File(glb);
    fs.writeFileSync(guard(path.join(DERIV, `outfit-${o.id}.json`)), JSON.stringify(outfitManifest(o, bodies, variants[o.id], {glb, bytes, sha}), null, 2) + '\n');
    summary.outfits[o.id] = {glb: path.relative(REPO, glb), bytes, sha256: sha, triangles: extras.triangles, vertices: o.g.low.pos.length / 3, heavy: extras.heavy};
    for (const B of bodies) summary.combos.push({body: B.id, outfit: o.id, hiddenBodyTriangles: variants[o.id][B.id].mask.hidden, bulkM: variants[o.id][B.id].stats.bulkM, pushOutMaxM: variants[o.id][B.id].stats.pushOut.maxDisplacementM, transferMaxDistM: variants[o.id][B.id].stats.transfer.maxDistToBodyM});
    console.log(`  wrote ${path.relative(REPO, glb)} ${bytes} bytes`);
  }
  // sources unchanged
  for (const s of sources) { const abs = path.isAbsolute(s.file) ? s.file : path.join(REPO, s.file); if (sha256File(abs) !== s.sha256) throw new Error('SOURCE CHANGED ' + s.file); }
  const totalBytes = Object.values(summary.bodies).reduce((a, b) => a + b.bytes, 0) + Object.values(summary.outfits).reduce((a, b) => a + b.bytes, 0);
  const out = {schema: 'the-last-line/zombie-variants@1', title: 'Zombie body x outfit variety (iteration 05) - prototype derivatives', status: {approved: false, gameReady: false},
    authoredOn: new Date().toISOString().slice(0, 10), canonicalBody: CANONICAL_BODY,
    counts: {bodies: bodies.length, outfits: outfits.length, bodyOutfitCombinations: bodies.length * outfits.length, plusBaseLooks: bodies.length, totalLooks: bodies.length * (outfits.length + 1)},
    skipped, totalBytes, totalMB: +(totalBytes / 1e6).toFixed(2), ...summary,
    rebuild: 'node --max-old-space-size=24000 tools/asset-pipeline/zombie/build-variants.mjs && node tools/asset-pipeline/zombie/qa/contact-sheet.mjs',
    buildSeconds: Math.round((Date.now() - t0) / 1000)};
  fs.writeFileSync(guard(path.join(DERIV, 'zombie-variants.json')), JSON.stringify(out, null, 2) + '\n');
  console.log(`done: ${bodies.length} bodies x ${outfits.length} outfits = ${bodies.length * outfits.length} combos; ${(totalBytes / 1e6).toFixed(2)} MB (${out.buildSeconds} s)`);
}

const STATUS = {approved: false, gameReady: false, stage: 'unapproved prototype derivative (iteration 05 zombie variety); art/anatomy/deformation/fit not certified', licenseClearance: 'none - evaluation quality does not grant commercial rights; sources are AI reconstructions of AI-generated concept images'};
const HONESTY = {sourcesHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming/hierarchy) and automatic skin weights created by this CPU pipeline', animation: 'hand-authored procedural keyframes (same clip functions for every body, sampled with each body\'s own joint positions) - NOT motion capture', generation: 'no AI generation, inference, model download or network service was used by this builder'};

function srcInfo(s, stageMaster) {
  const rel = f => f && (path.isAbsolute(f) ? path.relative(REPO, f) : f);
  return {id: s.id, file: rel(s.file), sha256Verified: s.sha256, uploadId: s.uploadId, sourceMetadata: rel(s.metadata), displayName: s.displayName, ledgerKey: s.ledgerKey, inputPng: s.inputPng && path.relative(REPO, s.inputPng), inputPngSha256: s.inputPngSha256, nativeJob: s.jobId, nativeMetadata: s.nativeMetadata && path.relative(REPO, s.nativeMetadata), nativeReceipt: s.nativeReceipt && path.relative(REPO, s.nativeReceipt),
    triangles: stageMaster?.triangles, vertices: stageMaster?.vertices, textures: stageMaster?.textures, material: stageMaster?.material};
}

function bodyManifest(B, {glb, bytes, sha, death, verify, clips, extras}) {
  const J = B.skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(Math.hypot(J[n][0] - J[p][0], J[n][1] - J[p][1], J[n][2] - J[p][2]))]));
  return {schema: 'the-last-line/derivative-manifest@1', asset: 'zombie-body-' + B.id, title: `Zombie body "${B.def.label}" - rigged runtime derivative (prototype)`, status: STATUS, honesty: HONESTY, origin: B.def.origin,
    outputs: {glb: {path: path.relative(REPO, glb), bytes, sha256: sha, format: 'glTF 2.0 binary, no Draco/meshopt/KTX2, JPEG textures, JOINTS_0 u8 / WEIGHTS_0 normalized u8'}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: extras.heightM, bindPose: 'A-pose as generated (arm angles in skeleton.estimation)'},
    source: srcInfo(B.src, B.stage.master), placement: {...B.stage.placement, nativeBounds: undefined}, facing: B.stage.facing, poseCorrection: B.stage.repose ?? null,
    mesh: {node: 'ZombieBody', vertices: B.low.pos.length / 3, triangles: B.low.idx.length / 3, simplify: B.stage.stats.simplify, unwrap: B.stage.stats.unwrap, bake: (({ms, ...r}) => r)(B.stage.stats.bake), textures: B.def.textures},
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends: B.skel.ends, boneLengthsM, validationIssues: B.stage.issues, estimation: B.skel.log},
    skinning: {method: 'skin.mjs region classification + chain weights + masked Laplacian smoothing (same as zombie-rigged body)', ...B.weldedWeights.stats},
    profile: B.profile,
    clips: clips.map(c => ({name: c.name, durationS: c.duration, loop: c.loop, keyframes: c.times.length, maxLegReach: c.maxLegReach})),
    death: {hipsY: r4(death.hipsY), tune: death.tune, lowestPointPerRegionM: death.contact, solvedAgainst: 'body + every fitted outfit'},
    verification: {cpuSkinningFloor: verify},
    limitations: [
      'Automatic approximate skin weights; LBS volume loss at shoulders/elbows/hips in extreme poses.',
      'Procedural (not mocap) clips; no facial rig, no finger or twist bones.',
      'Hidden-side geometry of the source is AI-hallucinated; textures re-baked at 2048 and downsampled to 1024 (MR 512); no normal map.',
      'Joint centres without visible landmarks use anthropometric ratios between measured landmarks.',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ]};
}

function outfitManifest(o, bodies, vmap, {glb, bytes, sha}) {
  const g = o.g;
  return {schema: 'the-last-line/derivative-manifest@1', asset: 'outfit-' + o.id, title: `Zombie outfit "${o.def.label}" - fitted per body (prototype)`, status: STATUS, honesty: {...HONESTY, garment: 'garment source is a separate ghost-mannequin reconstruction; fitted, retargeted and skinned per body by this pipeline (no cloth simulation)'}, origin: o.def.origin,
    outputs: {glb: {path: path.relative(REPO, glb), bytes, sha256: sha, format: 'glTF 2.0 binary; shared material/texture + shared TEXCOORD_0/index accessors; one SkinnedMesh per body (own POSITION/NORMAL/JOINTS_0/WEIGHTS_0 + skin over that body\'s joints)'}},
    source: srcInfo(o.src, g.master),
    canonicalFit: {body: CANONICAL_BODY, global: g.fit, backTaper: g.backTaper, sleeveRetarget: g.retarget, fitSkeleton: g.fitJoints, pushOut: g.pushOut, skin: g.skinStats},
    mesh: {vertices: g.low.pos.length / 3, triangles: g.low.idx.length / 3, simplify: g.stats.simplify, unwrap: g.stats.unwrap, bake: (({ms, ...r}) => r)(g.stats.bake), textures: o.def.textures},
    perBody: Object.fromEntries(bodies.map(B => [B.id, {node: `Outfit_${o.id}__${B.id}`, ...vmap[B.id].stats, mask: {hidden: vmap[B.id].mask.hidden, total: vmap[B.id].mask.total, method: vmap[B.id].mask.method}}])),
    limitations: [
      'No cloth simulation: the garment is linear-blend skinned with weights transferred from each body; it cannot drape, swing or collide in motion.',
      'Per-body fit = skeleton-driven retarget (torso height map + limb bone maps with girth ratios) + bind-pose push-out; residual interpenetration appears in strong poses (raised arms, deep crouch, lying down).',
      'Body triangles fully enclosed by the garment in the bind pose are hidden per body x outfit; in motion small gaps can reveal the underlying body or base clothing.',
      'Interior/lining and back of the garment source are AI-hallucinated hidden-side geometry.',
      'Unapproved prototype; gameReady false.',
    ]};
}

await main();
