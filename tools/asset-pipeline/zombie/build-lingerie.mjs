#!/usr/bin/env node
// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT) — the LINGERIE builder: the six accepted Meshy T2.5 lingerie sets
// (user reference designs; Meshy PBR maps kept) fitted to the three pale female zombie bodies for the store-local ordinary-zombie
// variants of the Mall lingerie store. CPU only, deterministic, no network / generation / inference.
//   node tools/asset-pipeline/zombie/build-lingerie.mjs              build the pinned ASSIGNMENT (lingerie.config.mjs) and write:
//        game/public/assets/models/outfit-lingerie-<design>.glb        (skinned variants per fitted body + static display nodes)
//        game/public/assets/derivatives/outfit-lingerie-<design>.json  (provenance, cleaning, fit, per-clip metrics, bytes)
//        game/public/assets/derivatives/zombie-lingerie.json           (summary: assignment, metrics, limits, evaluation, bytes)
//        game/src/ai/lingerie.generated.ts                             (runtime table: files, bytes, fitted bodies, display nodes)
//   --check        rebuild in a temp dir and require every output to be byte-identical to the committed one (needs the private raw
//                  sources; without them: structural check of the shipped files against their recorded sha256 / bytes)
//   --evaluate     fit EVERY design on EVERY body, measure all six clips, choose the assignment (each design once, two per body,
//                  best worst-case score) -> tools/asset-pipeline/zombie/lingerie.evaluation.json (nothing else written)
//   dev only: --out=DIR (write the GLB / JSON there instead), --bodies=id:path,... (body files, e.g. a stand-in),
//             --assign=body:designA+designB,...  --designs=a,b  --no-gate
// Method: lib/lingerie-garment.mjs (clean / split / simplify / textures), lib/lingerie-body.mjs (body landmarks),
// lib/lingerie-fit.mjs (landmark alignment, non-rigid conformity, clearance, weight transfer, pose-aware clearance, masks),
// lib/lingerie-metrics.mjs (per-clip penetration / gap / poke / coverage), lib/lingerie-glb.mjs (writer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadRawGarment, cleanAndSplit, simplifyPiece, encodeTextures, sha256File} from './lib/lingerie-garment.mjs';
import {loadBody, validationPoses, clipDurations} from './lib/lingerie-body.mjs';
import {fitStage1, fitStage2, runtimePiece, FIT} from './lib/lingerie-fit.mjs';
import {measureSet, checkLimits, LIMITS} from './lib/lingerie-metrics.mjs';
import {buildLingerieDocument, writeDoc, docBytes} from './lib/lingerie-glb.mjs';
import {loadMannequin, fitMannequin, measureMannequin, toModelFrame} from './lib/lingerie-mannequin.mjs';
import {hangerMeshes, hangTransform, applyHang, hangRecord, hangNormals, HANGER} from './lib/lingerie-hang.mjs';
import {bitsetBase64} from './lib/variant-glb.mjs';
import {LINGERIE_TASK, AUTHORED_ON, RAW_DIR, USER_INPUTS, MESHY_REQUEST, DESIGNS, DESIGN_ORDER, BODIES, BODY_ORDER, ASSIGNMENT, TEXTURES, VALIDATION_STEP, MANNEQUIN, MANNEQUIN_LIMITS, POLISH_TASK} from './lingerie.config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// private sources (reference/ is its own ignored checkout): this repository's, else the main checkout of a git worktree, else
// $LINGERIE_SOURCES_ROOT
const SRC_ROOT = (() => {
  const c = [process.env.LINGERIE_SOURCES_ROOT, REPO];
  try { c.push(path.dirname(path.resolve(REPO, execFileSync('git', ['-C', REPO, 'rev-parse', '--git-common-dir'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()))); } catch { /* not a git checkout */ }
  return c.filter(Boolean).find(r => fs.existsSync(path.join(r, RAW_DIR))) ?? REPO;
})();
const ARGS = new Set(process.argv.slice(2).filter(a => !a.includes('=')));
const OPT = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const GENERATOR = 'Terminal State lingerie builder (tools/asset-pipeline/zombie/build-lingerie.mjs)';
const r4 = v => +(+v).toFixed(4);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const wearableId = (design, piece) => `lingerie-${design}-${piece}`;
const STATUS = {approved: false, gameReady: false, stage: 'unapproved prototype derivative (lingerie store variants); art / fit / deformation not certified',
  licenseClearance: 'none - prototype status as every Meshy-generated asset of this repository; the designs are the user-supplied reference images'};

function resolveBodies() {
  if (OPT.bodies) return Object.fromEntries(OPT.bodies.split(',').map(s => { const [id, f] = s.split(':'); return [id, {file: f, label: id}]; }));
  return BODIES;
}
function resolveAssignment() {
  if (OPT.assign) return Object.fromEntries(OPT.assign.split(',').map(s => { const [b, d] = s.split(':'); return [b, d.split('+')]; }));
  return ASSIGNMENT;
}

/** Clean, split, simplify one design + its textures. */
async function prepareDesign(id) {
  const D = DESIGNS[id];
  const raw = await loadRawGarment(path.join(SRC_ROOT, RAW_DIR, D.raw), D.sha256);
  for (const [f, h] of Object.entries(D.textures.sha256)) { const got = sha256File(path.join(SRC_ROOT, RAW_DIR, D.textures.dir, f)); if (got !== h) throw new Error(`${id} ${f}: sha256 ${got} != pinned ${h}`); }
  const cs = cleanAndSplit(raw, {splitY: D.split.y, splitBy: D.split.by, junkMaxTris: 12, junkGap: 0.015, innerGap: 0.004, mirror: D.mirror});
  // source-resolution pieces (compacted, not simplified): the fit runs on these; the runtime simplification happens in BODY space
  const pieces = {};
  for (const pn of ['top', 'bottom']) pieces[pn] = await simplifyPiece(raw, cs.pieces[pn], {targetTris: null});
  const tx = await encodeTextures(path.join(SRC_ROOT, RAW_DIR, D.textures.dir), TEXTURES);
  return {id, D, raw, cs, pieces, tx};
}


/** Fit one prepared design to bodies: stage 1 at source resolution per body, ONE body-space simplification on the first body's fit
 *  (shared topology / UVs / indices for every body of the file), stage 2 per body. Returns {simp, fits: [{B, F}]}. */
async function fitDesign(prep, bodyIds, bodies) {
  const st = [];
  for (const bid of bodyIds) { const B = await bodyFor(bid, bodies[bid].file); st.push({B, S1: fitStage1(B, prep.pieces)}); }
  const simp = {};
  for (const pn of ['top', 'bottom']) {
    const src = prep.pieces[pn];
    simp[pn] = await simplifyPiece({pos: st[0].S1.fitted[pn], nrm: src.nrm, uv: src.uv}, src.idx, {targetTris: Math.round(src.triangles * prep.D.simplify[pn]), targetError: 0.01});
  }
  const fits = st.map(({B, S1}) => ({B, F: fitStage2(B, {top: runtimePiece(prep.pieces.top, S1.fitted.top, simp.top), bottom: runtimePiece(prep.pieces.bottom, S1.fitted.bottom, simp.bottom)}, S1.report)}));
  return {simp, fits};
}

function fitScore(summary) {
  let pen = 0, deep = 0, hover = 0, poke = 0, exp = 0, apex = 1, groin = 1, gap = 0, n = 0;
  for (const S of Object.values(summary)) {
    for (const P of Object.values(S.pieces)) { pen = Math.max(pen, P.penetration); deep = Math.max(deep, P.deep); hover = Math.max(hover, P.hover); gap += P.gapP95MM; n++; }
    poke = Math.max(poke, S.body.pokeVisibleFraction); exp = Math.max(exp, S.body.exposedHiddenFraction); apex = Math.min(apex, S.coverage.apex); groin = Math.min(groin, S.coverage.groin);
  }
  const score = 100 * (pen + 3 * deep + hover + poke + exp) + 50 * (1 - apex) + 50 * (1 - groin) + gap / n / 10;
  return {score: r4(score), worst: {penetration: pen, deep, hover, pokeVisible: poke, exposedHidden: exp, apexCoverage: apex, groinCoverage: groin, meanGapP95MM: r4(gap / n)}};
}

const poseCache = new Map();
async function bodyFor(id, file) {
  if (poseCache.has(id)) return poseCache.get(id);
  const B = await loadBody(path.resolve(REPO, file));
  B.poses = validationPoses(B, {step: VALIDATION_STEP});
  poseCache.set(id, B);
  return B;
}
const piecesOf = (prep, F) => F.sets.map(s => ({name: s.name, pos: s.piece.pos, idx: s.piece.idx, joints: s.w.joints, weights: s.w.weights, hide: s.mask.hide}));

async function evaluate() {
  const bodies = resolveBodies(), designs = OPT.designs ? OPT.designs.split(',') : DESIGN_ORDER;
  const table = {};
  for (const d of designs) {
    const prep = await prepareDesign(d);
    for (const [bid] of Object.entries(bodies)) {
      const t0 = Date.now();
      const {fits: [{B, F}]} = await fitDesign(prep, [bid], bodies);
      const M = measureSet(B, piecesOf(prep, F), {poses: B.poses});
      const s = fitScore(M.summary);
      (table[d] ??= {})[bid] = {...s, failures: checkLimits(M.summary).length, ms: Date.now() - t0};
      console.log(`[evaluate] ${d} x ${bid}: score ${s.score} ${JSON.stringify(s.worst)} (${Date.now() - t0} ms)`);
    }
  }
  // assignment: every design exactly once, two per body; minimise the worst score, then the sum
  const ids = Object.keys(bodies);
  let best = null;
  const rec = (k, cur, load) => {
    if (k === designs.length) {
      const sc = designs.map(d => table[d][cur[d]].score), worst = Math.max(...sc), sum = sc.reduce((a, b) => a + b, 0);
      if (!best || worst < best.worst - 1e-9 || (Math.abs(worst - best.worst) < 1e-9 && sum < best.sum)) best = {worst: r4(worst), sum: r4(sum), assignment: {...cur}};
      return;
    }
    for (const b of ids) { if (load[b] >= Math.ceil(designs.length / ids.length)) continue; cur[designs[k]] = b; load[b]++; rec(k + 1, cur, load); load[b]--; delete cur[designs[k]]; }
  };
  rec(0, {}, Object.fromEntries(ids.map(b => [b, 0])));
  const byBody = Object.fromEntries(ids.map(b => [b, designs.filter(d => best.assignment[d] === b)]));
  const out = {schema: 'terminal-state/lingerie-evaluation@1', task: LINGERIE_TASK, method: 'build-lingerie.mjs --evaluate: every design fitted to every body, metrics over every 0.1 s of the six clips (lib/lingerie-metrics.mjs); score = 100 x (penetration + 3 x deep + hover + visible poke + exposed hidden) + 50 x (1 - apex coverage) + 50 x (1 - groin coverage) + mean gap p95 (mm) / 10 (lower is better); assignment = each design once, two per body, minimal worst score then sum',
    bodies: Object.fromEntries(ids.map(b => [b, bodies[b].file])), table, chosen: {...best, byBody}};
  if (!OPT.out) fs.writeFileSync(path.join(REPO, 'tools/asset-pipeline/zombie/lingerie.evaluation.json'), JSON.stringify(out, null, 2) + '\n');
  else { fs.mkdirSync(OPT.out, {recursive: true}); fs.writeFileSync(path.join(OPT.out, 'lingerie.evaluation.json'), JSON.stringify(out, null, 2) + '\n'); }
  console.log('chosen', JSON.stringify(out.chosen));
}


/** Limit check of a static mannequin fit (measureMannequin summary). */
function checkMannequin(S, lim = MANNEQUIN_LIMITS) {
  const f = [];
  for (const [pn, P] of Object.entries(S.pieces)) {
    if (P.penetration > lim.penetration) f.push(`mannequin ${pn}: penetration ${P.penetration} > ${lim.penetration}`);
    if (P.deep > lim.deep) f.push(`mannequin ${pn}: deep ${P.deep} > ${lim.deep}`);
    if (P.minSdMM < lim.minSdMM) f.push(`mannequin ${pn}: min sd ${P.minSdMM} mm < ${lim.minSdMM}`);
    if (P.hover > lim.hover) f.push(`mannequin ${pn}: hover ${P.hover} > ${lim.hover}`);
    if (P.edgeHover > lim.edgeHover) f.push(`mannequin ${pn}: free-edge hover ${P.edgeHover} > ${lim.edgeHover}`);
  }
  if (S.body.pokeVisible > lim.pokeVisibleCount) f.push(`mannequin: ${S.body.pokeVisible} figure vertices poke through the cloth > ${lim.pokeVisibleCount}`);
  if (S.coverage.apex < 1) f.push(`mannequin: bust apex coverage ${S.coverage.apex} < 1`);
  if (S.coverage.groinCore < 1) f.push(`mannequin: groin core coverage ${S.coverage.groinCore} < 1`);
  return f;
}

/** Hanging rack items of a design from its mannequin fit (working frame): a one-piece set hangs whole, else top + bottom apart. */
function hangItems(d, MQ, M) {
  const top = MQ.pieces.top.pos;
  let maxY = -Infinity; for (let i = 1; i < top.length; i += 3) maxY = Math.max(maxY, top[i]);
  const strapped = maxY > M.landmarks.apexY + 0.08;
  const defs = DESIGNS[d].split.by === 'triangle' ? [{item: 'set', pieces: ['top', 'bottom'], kind: 'strapped', kz: 0.55}]
    : [{item: 'top', pieces: ['top'], kind: strapped ? 'strapped' : 'clip', kz: 0.55}, {item: 'bottom', pieces: ['bottom'], kind: 'clip', kz: 0.32}];
  return defs.map(def => {
    const t = hangTransform(MQ.pieces[def.pieces[0]].pos, def.kind, def.kz);
    const garments = def.pieces.map(pn => ({piece: pn, pos: applyHang(MQ.pieces[pn].pos, t), nrm: hangNormals(MQ.pieces[pn].nrm, def.kz)}));
    const rec = hangRecord(garments.map(g => g.pos), t);
    if (rec.widthM > 0.45) throw new Error(`hang item ${d} ${def.item}: ${rec.widthM} m wide (> 0.45)`);
    return {item: def.item, hanger: def.kind === 'strapped' ? 'wire' : 'clip', garments, extras: rec};
  });
}

async function build(outRoot) {
  const bodies = resolveBodies(), assign = resolveAssignment();
  const models = path.join(outRoot, 'game/public/assets/models'), deriv = path.join(outRoot, 'game/public/assets/derivatives'), gen = path.join(outRoot, 'game/src/ai');
  for (const d of [models, deriv, gen]) fs.mkdirSync(d, {recursive: true});
  const designBodies = {};
  for (const b of Object.keys(assign)) for (const d of assign[b]) (designBodies[d] ??= []).push(b);
  const designs = (OPT.designs ? OPT.designs.split(',') : DESIGN_ORDER).filter(d => designBodies[d]);
  for (const d of DESIGN_ORDER) if (!OPT.designs && !OPT.assign && !designBodies[d]) throw new Error(`design ${d} is not assigned to any body`);
  const summary = {sets: [], fits: [], gate: {limits: LIMITS, failures: []}};
  // task store-polish: the female display mannequin (M81) the store dresses, pinned by sha256
  const mqFile = path.join(REPO, MANNEQUIN.file);
  if (sha256File(mqFile) !== MANNEQUIN.sha256) throw new Error(`mannequin ${MANNEQUIN.file}: sha256 differs from the pinned ${MANNEQUIN.sha256}`);
  const MQB = await loadMannequin(mqFile);
  const hangers = hangerMeshes();
  const generated = [];
  for (const d of designs) {
    const prep = await prepareDesign(d);
    const D = prep.D, wear = {top: wearableId(d, 'top'), bottom: wearableId(d, 'bottom')};
    const variants = [], perBody = {};
    const t00 = Date.now();
    const order = [...designBodies[d]].sort((a, b) => BODY_ORDER.indexOf(a) - BODY_ORDER.indexOf(b));
    const FD = await fitDesign(prep, order, bodies);
    for (const [fi, {B, F}] of FD.fits.entries()) {
      const bid = order[fi];
      const t0 = t00;
      const M = measureSet(B, piecesOf(prep, F), {poses: B.poses});
      const fails = checkLimits(M.summary);
      const score = fitScore(M.summary);
      console.log(`[fit] ${d} x ${bid}: score ${score.score} ${JSON.stringify(score.worst)}; ${fails.length} limit failures (${Date.now() - t0} ms)`);
      for (const f of fails) console.log('   ! ' + f);
      if (fails.length) summary.gate.failures.push({design: d, body: bid, failures: fails});
      const top = F.sets.find(s => s.name === 'top'), bottom = F.sets.find(s => s.name === 'bottom');
      // hit-volume bulk (ai/wardrobe.ts adds it to the body's measured radii): the cloth's median clearance over the skin in the rest pose
      const bulk = s => r4(M.summary.Idle?.pieces[s.name]?.gapP50MM / 1000 || FIT.offset[s.name]);
      const ex = (s, slot, other) => ({outfit: wear[s.name], slot, body: bid, set: 'lingerie-' + d, bodyTriangles: B.nTris, bodyGeometryHash: B.geometryHash, hideBodyTriangles: bitsetBase64(s.mask.hide), hiddenCount: s.mask.hidden,
        bulkM: slot === 'upper' ? {torso: bulk(s), arm: 0} : {leg: bulk(s)}, ...(other ? {hideWear: {[wear.bottom]: bitsetBase64(other.hide)}, hideWearCounts: {[wear.bottom]: other.hidden}} : {})});
      variants.push({bodyId: bid, jointPos: B.J,
        top: {pos: top.piece.pos, nrm: top.nrm, joints: top.w.joints, weights: top.w.weights, extras: ex(top, 'upper', top.hideWear)},
        bottom: {pos: bottom.piece.pos, nrm: bottom.nrm, joints: bottom.w.joints, weights: bottom.w.weights, extras: ex(bottom, 'lower', null)}});
      // compact per-clip record (worst frame per clip); the strap / leg-part (region) worsts go to the summary
      const compact = Object.fromEntries(Object.entries(M.summary).map(([c, S]) => [c, {frames: S.frames, pieces: Object.fromEntries(Object.entries(S.pieces).map(([pn, P]) => [pn, (({regions, ...r}) => r)(P)])), body: (({covered, hiddenOnly, ...r}) => r)(S.body), coverage: S.coverage}]));
      const regions = {};
      for (const S of Object.values(M.summary)) for (const [pn, P] of Object.entries(S.pieces)) for (const [rn, R] of Object.entries(P.regions ?? {})) { if (rn === 'core') continue; const q = regions[`${pn}.${rn === 'upper' ? 'straps / upper edge' : 'suspenders / thigh rings'}`] ??= {penetration: 0, hover: 0, gapP95MM: 0}; q.penetration = Math.max(q.penetration, R.penetration); q.hover = Math.max(q.hover, R.hover); q.gapP95MM = Math.max(q.gapP95MM, R.gapP95MM); }
      const {masks, ...fitRep} = F.report;
      perBody[bid] = {fit: fitRep, masks, metrics: {score, limitsFailed: fails, poses: M.poses, coverageZones: M.zones, perClip: compact}};
      summary.fits.push({design: d, body: bid, score: score.score, worst: score.worst, regionsWorst: regions, limitsFailed: fails.length, clips: Object.keys(M.summary), poses: M.poses});
    }
    // task store-polish: the set fitted to the static female display mannequin (same kept vertices / UVs / indices) + hanging rack items
    const MQ = fitMannequin(MQB, prep.pieces, FD.simp);
    const MS = measureMannequin(MQB, MQ.pieces), mFails = checkMannequin(MS);
    console.log(`[mannequin] ${d}: ${JSON.stringify({top: (({regions, ...r}) => r)(MS.pieces.top), bottom: (({regions, ...r}) => r)(MS.pieces.bottom), poke: MS.body.pokeVisible, coverage: MS.coverage})}; ${mFails.length} limit failures`);
    for (const f of mFails) console.log('   ! ' + f);
    if (mFails.length) summary.gate.failures.push({design: d, body: 'mannequinFemale', failures: mFails});
    const items = hangItems(d, MQ, MQB);
    const mqMetrics = {pieces: Object.fromEntries(Object.entries(MS.pieces).map(([pn, P]) => [pn, (({regions, ...r}) => r)(P)])), figurePokeVertices: MS.body.pokeVisible, coverage: MS.coverage};
    const mannequinNodes = {top: `LingerieMannequin_${d}_top`, bottom: `LingerieMannequin_${d}_bottom`};
    const sceneExtras = {id: 'lingerie-' + d, kind: 'lingerie-set', label: D.label, pieces: {upper: wear.top, lower: wear.bottom}, bodies: variants.map(v => v.bodyId),
      mannequin: {...mannequinNodes, model: MANNEQUIN.key, frame: MANNEQUIN.frame}, hang: items.map(it => `LingerieHang_${d}_${it.item}`),
      triangles: {top: FD.simp.top.triangles, bottom: FD.simp.bottom.triangles}, provenance: 'generated (Meshy T2.5 image-to-3D from the user reference image; Meshy PBR maps kept)', approved: false, gameReady: false};
    const doc = buildLingerieDocument({design: d, wearables: wear, baseJpg: prep.tx.baseJpg, mrJpg: prep.tx.mrJpg, pieces: {top: FD.simp.top, bottom: FD.simp.bottom}, variants, sceneExtras, generator: GENERATOR,
      mannequin: {pieces: Object.fromEntries(['top', 'bottom'].map(pn => [pn, {pos: toModelFrame(MQ.pieces[pn].pos), nrm: toModelFrame(MQ.pieces[pn].nrm)}])), extras: {mannequin: MANNEQUIN.key, mannequinFile: MANNEQUIN.file, mannequinSha256: MANNEQUIN.sha256, frame: MANNEQUIN.frame, metrics: mqMetrics}},
      hang: {hangers, items: items.map(it => ({...it, extras: {...it.extras, frame: 'origin = the hook resting on the rail, +Y up, front +Z, hanging below'}}))}});
    const glb = path.join(models, `outfit-lingerie-${d}.glb`);
    await writeDoc(doc, glb);
    const bytes = fs.statSync(glb).size, glbSha = sha256File(glb);
    const manifest = {schema: 'the-last-line/derivative-manifest@1', asset: 'outfit-lingerie-' + d, title: `Lingerie set "${D.label}" - fitted per body + dressed display mannequin + rack stock (prototype)`, status: STATUS, task: LINGERIE_TASK, authoredOn: AUTHORED_ON,
      origin: `Meshy T2.5 image-to-3D (task ${D.meshyTask}) from the user-supplied reference ${D.reference.file}; generated by the primary (sole Meshy submitter) under the user's 200-credit clothing approval; lane FIT fitted it locally`,
      provenance: 'generated (Meshy T2.5 image-to-3D from the user reference image; Meshy PBR maps kept: base colour + metallic / roughness re-encoded, normal map not shipped)',
      honesty: {generation: 'no generation / inference / network service was used by this builder', fitting: 'CPU landmark alignment + non-rigid conformity to the body surface + weight transfer from the body + pose-aware clearance (lib/lingerie-fit.mjs); no cloth simulation', texture: 'Meshy base colour / roughness / metallic maps resized and re-encoded only (no retexture, no painting)'},
      outputs: {glb: {path: path.relative(outRoot, glb), bytes, sha256: glbSha, format: 'glTF 2.0 binary, KHR_mesh_quantization (NORMAL i8, TEXCOORD_0 u16); one OPAQUE double-sided material (base colour JPEG + metallicRoughness JPEG); per piece shared TEXCOORD_0 / indices; per fitted body two SkinnedMesh nodes (Outfit_<wearable>__<body>) + a prefixed skeleton copy; unskinned LingerieMannequin_<design>_top/_bottom (the female display mannequin\'s own frame) and hanging rack items LingerieHang_<design>_<item> (garment + procedural chrome hanger primitives)'}},
      source: {raw: {file: `${RAW_DIR}/${D.raw}`, sha256Verified: D.sha256, triangles: prep.raw.idx.length / 3, vertices: prep.raw.pos.length / 3, material: prep.raw.material, private: true}, textures: prep.tx.sources.map(s => ({...s, file: `${RAW_DIR}/${D.textures.dir}/${s.name}`})), meshyTask: D.meshyTask, meshyRequest: MESHY_REQUEST,
        reference: {file: `${USER_INPUTS}/${D.reference.file}`, sha256: D.reference.sha256, private: true}},
      cleaning: {degenerateTriangles: prep.cs.degenerate, components: prep.cs.components.length, componentsTop: prep.cs.components.filter(c => c.piece === 'top').length, componentsBottom: prep.cs.components.filter(c => c.piece === 'bottom').length, splitComponents: prep.cs.components.filter(c => c.piece === 'split').length,
        smallestGapToOthers: Math.max(0, ...prep.cs.components.map(c => c.gapToOthers ?? 0)), dropped: prep.cs.dropped, split: D.split, mirrored: prep.cs.mirrored, note: 'welded components (UV seams joined); a floating component (<= 12 triangles, > 15 mm from the rest) or an inner shell would be dropped: none found (every small component is a slider, clip, ring, bow, lacing or boning piece touching the set)'},
      pieces: Object.fromEntries(['top', 'bottom'].map(pn => [pn, {wearable: wear[pn], slot: pn === 'top' ? 'upper' : 'lower', design: pn === 'top' ? D.top : D.bottom, triangles: FD.simp[pn].triangles, vertices: FD.simp[pn].vertices, sourceTriangles: prep.pieces[pn].triangles, simplifyRatio: D.simplify[pn], simplifyError: FD.simp[pn].error, simplifiedIn: `body space (the fit on ${order[0]}), meshoptimizer UV-weighted quadric, attribute seams preserved`}])),
      textures: prep.tx.encoded, perBody,
      mannequin: {task: POLISH_TASK, model: MANNEQUIN.key, file: MANNEQUIN.file, sha256: MANNEQUIN.sha256, frame: MANNEQUIN.frame, nodes: mannequinNodes, measured: MQB.measured, fit: (({landmarks, align, pieces, cutVerticesJoined}) => ({align, pieces, cutVerticesJoined}))(MQ.report), metrics: mqMetrics, limitsFailed: mFails,
        method: 'the worn-variant fit (lib/lingerie-fit.mjs stage 1) on the static mannequin mesh (lib/lingerie-mannequin.mjs: slice landmarks, arm / head / base groups), the design\'s runtime vertices / UVs / indices, clearance incl. figure poke-through; no skin'},
      hang: {task: POLISH_TASK, hanger: HANGER, items: items.map(it => ({node: `LingerieHang_${d}_${it.item}`, item: it.item, pieces: it.garments.map(g => g.piece), ...it.extras})),
        method: 'the mannequin-fitted pieces hung on procedural chrome hangers (strap crests on the wire hanger arms; strapless tops / bottoms in clip jaws), depth relaxed (lib/lingerie-hang.mjs); UVs / texture unchanged'},
      limitations: ['Linear-blend skinned with weights transferred from the body: no cloth simulation (no swing / drape).', 'Body triangles enclosed by each piece are hidden while it is worn; very narrow straps hide nothing and rely on their clearance.',
        'The Meshy hidden-side geometry is AI-reconstructed; the lace is a texture on an opaque material (no transparency).', 'Unapproved prototype; gameReady false.']};
    fs.writeFileSync(path.join(deriv, `outfit-lingerie-${d}.json`), JSON.stringify(manifest, null, 1) + '\n');
    summary.sets.push({id: 'lingerie-' + d, design: d, label: D.label, model: `outfit_lingerie_${d}`, glb: path.relative(outRoot, glb), bytes, sha256: glbSha, bodies: variants.map(v => v.bodyId), pieces: {upper: wear.top, lower: wear.bottom},
      mannequin: {nodes: mannequinNodes, metrics: mqMetrics, limitsFailed: mFails.length}, hang: items.map(it => ({node: `LingerieHang_${d}_${it.item}`, hanger: it.hanger, dropM: it.extras.dropM, widthM: it.extras.widthM})), textures: {baseColorBytes: prep.tx.encoded.baseColor.bytes, metallicRoughnessBytes: prep.tx.encoded.metallicRoughness.bytes}, triangles: sceneExtras.triangles});
    generated.push({id: 'lingerie-' + d, design: d, label: D.label, model: `outfit_lingerie_${d}`, url: `assets/models/outfit-lingerie-${d}.glb`, bytes, top: wear.top, bottom: wear.bottom, topLabel: D.top, bottomLabel: D.bottom, bodies: variants.map(v => v.bodyId),
      mannequin: mannequinNodes, hang: items.map(it => ({node: `LingerieHang_${d}_${it.item}`, item: it.item, hanger: it.hanger, dropM: it.extras.dropM, widthM: it.extras.widthM, depthM: it.extras.depthM, spacingFaceOutM: it.extras.spacingM.faceOut, spacingSideOnM: it.extras.spacingM.sideOn}))});
    console.log(`  wrote ${path.relative(outRoot, glb)} ${bytes} bytes (base colour ${prep.tx.encoded.baseColor.bytes}, MR ${prep.tx.encoded.metallicRoughness.bytes})`);
  }
  const totalBytes = summary.sets.reduce((a, s) => a + s.bytes, 0);
  const evalFile = path.join(REPO, 'tools/asset-pipeline/zombie/lingerie.evaluation.json');
  const evaluation = fs.existsSync(evalFile) ? JSON.parse(fs.readFileSync(evalFile, 'utf8')) : null;
  const out = {schema: 'terminal-state/zombie-lingerie@1', title: 'Lingerie store variants: Meshy lingerie sets fitted to the pale female zombie bodies (prototype derivatives)', status: STATUS, task: LINGERIE_TASK, authoredOn: AUTHORED_ON,
    assignment: assign, bodies: Object.fromEntries(Object.entries(bodies).map(([k, v]) => [k, v.file])), totalBytes, totalMB: +(totalBytes / 1e6).toFixed(3), ...summary,
    validation: {step: VALIDATION_STEP, clips: Object.keys(clipDurations([...poseCache.values()][0] ?? {R: {anims: []}})), method: 'lib/lingerie-metrics.mjs'}, fitParams: FIT,
    evaluation: evaluation && {method: evaluation.method, chosen: evaluation.chosen, scores: Object.fromEntries(Object.entries(evaluation.table).map(([d, t]) => [d, Object.fromEntries(Object.entries(t).map(([b, e]) => [b, e.score]))]))},
    rebuild: 'node tools/asset-pipeline/zombie/build-lingerie.mjs (raw Meshy sources are private: reference/tasks/mall-lingerie-20261102-221554/meshy/raw)'};
  fs.writeFileSync(path.join(deriv, 'zombie-lingerie.json'), JSON.stringify(out, null, 1) + '\n');
  const ts = `// GENERATED by tools/asset-pipeline/zombie/build-lingerie.mjs (task ${LINGERIE_TASK}, lane FIT) - do not edit.
// The shipped lingerie set files: model key, url, exact bytes, wearable ids (top = slot upper, bottom = slot lower), the bodies each
// set is fitted to, the static nodes fitted to the female display mannequin and the hanging rack items inside the same GLB (sharing its
// texture). Logic: ai/lingerie.ts.
export interface LingerieBuildSet {
  id: string; design: string; label: string; model: string; url: string; bytes: number;
  top: string; bottom: string; topLabel: string; bottomLabel: string; bodies: readonly string[];
  /** Static nodes of the set fitted to the female display mannequin (mannequinFemale), in that model's own frame (identity node). */
  mannequin: {top: string; bottom: string};
  /** Hanging rack items (origin = the hook resting on the rail, +Y up, front +Z, hanging below). */
  hang: readonly {node: string; item: string; hanger: string; dropM: number; widthM: number; depthM: number; spacingFaceOutM: number; spacingSideOnM: number}[];
}
export const LINGERIE_BUILD: readonly LingerieBuildSet[] = ${JSON.stringify(generated, null, 2).replace(/"([a-zA-Z]+)":/g, '$1:').replace(/"/g, "'")};
`;
  fs.writeFileSync(path.join(gen, 'lingerie.generated.ts'), ts);
  console.log(`done: ${summary.sets.length} sets, ${summary.fits.length} fits, ${totalBytes} bytes (${(totalBytes / 1e6).toFixed(3)} MB); gate failures ${summary.gate.failures.length}`);
  for (const p of designs) { const D = DESIGNS[p]; if (sha256File(path.join(SRC_ROOT, RAW_DIR, D.raw)) !== D.sha256) throw new Error('SOURCE CHANGED ' + D.raw); }
  if (summary.gate.failures.length && !ARGS.has('--no-gate')) throw new Error(`fit gate: ${summary.gate.failures.length} fit(s) over the limits (see above); --no-gate for a dev build`);
  return out;
}

const OUTPUTS = d => [`game/public/assets/models/outfit-lingerie-${d}.glb`, `game/public/assets/derivatives/outfit-lingerie-${d}.json`];
async function check() {
  const rawOk = DESIGN_ORDER.every(d => fs.existsSync(path.join(SRC_ROOT, RAW_DIR, DESIGNS[d].raw)));
  const files = [...DESIGN_ORDER.flatMap(OUTPUTS), 'game/public/assets/derivatives/zombie-lingerie.json', 'game/src/ai/lingerie.generated.ts'];
  if (!rawOk) {
    // structural: every shipped GLB matches the summary's recorded bytes / sha256
    const S = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/zombie-lingerie.json'), 'utf8'));
    const bad = S.sets.filter(s => { const f = path.join(REPO, s.glb); return !fs.existsSync(f) || fs.statSync(f).size !== s.bytes || sha256File(f) !== s.sha256; }).map(s => s.glb);
    console.log(`--check (raw sources not available: structural only): ${S.sets.length} sets, mismatches: ${bad.length ? bad.join(', ') : 'none'}`);
    if (bad.length) process.exit(1);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingerie-check-'));
  try {
    await build(tmp);
    const diff = files.filter(f => !fs.existsSync(path.join(REPO, f)) || sha256File(path.join(REPO, f)) !== sha256File(path.join(tmp, f)));
    console.log(`--check: ${files.length} outputs, differing: ${diff.length ? diff.join(', ') : 'none (byte-identical)'}`);
    if (diff.length) process.exitCode = 1;
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}

if (ARGS.has('--evaluate')) await evaluate();
else if (ARGS.has('--check')) await check();
else await build(OPT.out ? path.resolve(OPT.out) : REPO);
