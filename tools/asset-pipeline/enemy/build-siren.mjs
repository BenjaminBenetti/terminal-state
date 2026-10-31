#!/usr/bin/env node
// Task track1-siren-blightbelly-20261031 (lane RIGS) — Siren rig builder; task siren-clothing-refit-20261031 (lane FIT) — the
// user-authorised GARMENT-ONLY dress refit (lib/garment-refit.mjs + lib/garment-skin.mjs; the body stays appearance-locked and is
// proven identical to the reference build: lib/proof.mjs proveBodyInvariance). Single reproducible entry point:
//   node tools/asset-pipeline/enemy/build-siren.mjs              the Siren: pinned user uploads -> runtime GLB + sidecar + evidence
//   node tools/asset-pipeline/enemy/build-siren.mjs --standin    project-owned stand-in (Meshy T2.5 attempt-1 preview of this task +
//                                                                a procedural garment fixture) -> evidence/RIGS/standin/ ONLY
//   options: --no-evidence (skip renders), --uploads <dir> (default .cache/track1-siren-20261031 or $SIREN_UPLOADS_DIR),
//            --baseline <glb> (reference build for the body-invariance proof; default .cache/siren-refit-20261031/
//            enemy-siren-main-4ac5d8ca.glb, sha256-pinned; --no-baseline skips that proof and records it as skipped),
//            --out <glb> (scratch output: the sidecar goes beside it; the game files are not touched)
// Writes ONLY: game/public/assets/models/enemy-siren.glb, game/public/assets/derivatives/enemy-siren.json and evidence under
// reference/tasks/siren-clothing-refit-20261031/evidence/FIT/builder/. The uploads are read-only and sha256-verified (refused on
// mismatch). User directions: Track1 "Don't modify the siren. The siren's already perfect." — the BODY's native vertices, UVs,
// normals, materials and texture bytes are carried over unchanged (uniform fit in the skin's inverse bind matrices), skeleton,
// body weights and procedural clips unchanged; 2026-10-31 the user authorised remodelling / refitting the DRESS ONLY ("the
// clothing needs to actually be fit to her model ... do a close refit"; her right breast covered, left exposed): the dress's
// POSITION / NORMAL / skin weights are re-derived, its UVs, indices, material and texture bytes are unchanged.
// See lib/siren-build.mjs, lib/garment-refit.mjs, lib/garment-skin.mjs, lib/siren-glb.mjs, lib/proof.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Document} from '@gltf-transform/core';
import {buildSiren, assemble, placeBody} from './lib/siren-build.mjs';
import {proveAppearance, proveBodyInvariance} from './lib/proof.mjs';
import {io, sha256File, readSource, singlePrimitive, transformPositions} from './lib/native-glb.mjs';
import {loadRigged, jointWorld, skinMesh} from './lib/siren-glb.mjs';
import {decodeTexture, renderPanels, loadZombieBind, markers, boneLines} from './lib/siren-render.mjs';
import {writeStandinGarment} from './lib/standin.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {SIREN_CLIPS} from './lib/siren-clips.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TASK = 'siren-clothing-refit-20261031';
const EVID = path.join(REPO, 'reference/tasks', TASK, 'evidence/FIT/builder');
const STANDIN_SRC_TASK = 'track1-siren-blightbelly-20261031'; // the stand-in body is that task's rejected Meshy preview (read-only)
const ARGS = process.argv.slice(2);
const flag = f => ARGS.includes(f), opt = (f, d) => { const i = ARGS.indexOf(f); return i >= 0 ? ARGS[i + 1] : d; };
const STANDIN = flag('--standin');
const UPLOADS = path.resolve(REPO, opt('--uploads', process.env.SIREN_UPLOADS_DIR || '.cache/track1-siren-20261031'));
/** Reference build for the body-invariance proof: main's enemy-siren.glb before the refit (commit 0b53b6d). */
const BASELINE = {file: path.resolve(REPO, opt('--baseline', '.cache/siren-refit-20261031/enemy-siren-main-4ac5d8ca.glb')), sha256: '4ac5d8cae88e1655d0e721eeab2442d16d12697a695a433b6670f0a35997098b', commit: '0b53b6d19b0e7c85fbe5dd84c482b014e338df57'};
const SCRATCH_OUT = opt('--out', null);

/** The Siren: pinned user uploads (ids are the upload-store ids; filename labels are not provenance). */
export const SIREN = {
  body: {uploadId: '1f8ac189e97848b984697f9ab4f4a7c7', label: 'Pale Apparition (Siren body)', bytes: 4042956, sha256: '6437be9e8ce2d0c254ad9ef12d22ac6f521c640ab7844d36e84825dc232900b4'},
  dress: {uploadId: 'fbe47869acac46f3a52d808bab79f80a', label: 'Ghost Dress', bytes: 8325776, sha256: 'aa3e731f0bfd6f1a80c5c0ee56c019f1c0d1625c347c5978db56988fa55a2a8c'},
  heightM: 1.70,       // game-scale choice: top of the head / hair 1.70 m (ordinary zombies 1.65-1.80 m)
  hairLumMax: 60,      // base-colour luminance below which a body vertex is hair (analysis mask only)
  // measured scan (task lane notes RIGS.notes): fixed-scale scan 1.22-1.42 with the strap on the right shoulder; skin poke-through
  // (exact ray test) is cleared at the buttocks from s ~1.29 with the dress 1 cm back; the optimiser refines from here
  dressFit: {init: {s: 1.30, t: [-0.040, 0.790, -0.012]}},
  skin: {smoothIters: 4},
  dressSkin: {thighMax: 0.45, skirt: true},
  dressMode: 'refit',  // task siren-clothing-refit-20261031: user-authorised garment-only refit (was Track1's 'uniform')
};
const OUT = STANDIN
  ? {glb: path.join(EVID, 'standin/standin-siren.glb'), json: path.join(EVID, 'standin/standin-siren.json'), evidence: path.join(EVID, 'standin')}
  : SCRATCH_OUT ? {glb: path.resolve(SCRATCH_OUT), json: path.resolve(SCRATCH_OUT).replace(/\.glb$/, '.json'), evidence: path.join(EVID, 'scratch-run')}
  : {glb: path.join(REPO, 'game/public/assets/models/enemy-siren.glb'), json: path.join(REPO, 'game/public/assets/derivatives/enemy-siren.json'), evidence: EVID};

function guard(file) {
  const rel = path.relative(REPO, path.resolve(file));
  const ok = STANDIN ? rel.startsWith(path.relative(REPO, EVID) + path.sep) : [path.relative(REPO, OUT.glb), path.relative(REPO, OUT.json)].includes(rel) || rel.startsWith(path.relative(REPO, EVID) + path.sep);
  // a --out scratch build must stay outside the game tree / sources (evidence or /tmp)
  if (SCRATCH_OUT && (rel.startsWith('game' + path.sep) || rel.startsWith('tools' + path.sep))) throw new Error('refusing scratch output inside the repo tree ' + rel);
  if ((!SCRATCH_OUT && rel.startsWith('..')) || !ok || rel.startsWith('.cache')) throw new Error('refusing to write ' + rel);
  return file;
}
const write = (file, data) => { guard(file); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); };

async function config() {
  if (!STANDIN) {
    const f = id => path.join(UPLOADS, id + '.glb');
    for (const p of [SIREN.body, SIREN.dress]) { if (!fs.existsSync(f(p.uploadId))) throw new Error(`upload ${p.uploadId} not staged at ${UPLOADS}`); if (fs.statSync(f(p.uploadId)).size !== p.bytes) throw new Error(`upload ${p.uploadId}: size mismatch`); }
    return {...SIREN, body: {...SIREN.body, file: f(SIREN.body.uploadId)}, dress: {...SIREN.dress, file: f(SIREN.dress.uploadId)}};
  }
  // stand-in: the task's own unused Meshy T2.5 attempt-1 preview (thin, untextured, no UVs / normals) + a procedural garment
  const body = path.join(REPO, 'reference/tasks', STANDIN_SRC_TASK, 'meshy/raw/a1-preview/model.glb');
  const garment = guard(path.join(EVID, 'standin/fixtures/standin-garment.glb'));
  const src = await readSource(body), sp = singlePrimitive(src.doc, 'stand-in');
  const placed = placeBody(sp.prim.getAttribute('POSITION').getArray(), sp.world, 1.70);
  await writeStandinGarment(garment, transformPositions(sp.prim.getAttribute('POSITION').getArray(), placed.M), {top: 1.28, bottom: 0.45, shoulderX: 0.16});
  return {body: {file: body, sha256: sha256File(body), label: 'stand-in body: Meshy T2.5 a1 preview of this task (rejected for the Blightbelly; thin, untextured, no UVs / normals)'}, dress: {file: garment, sha256: sha256File(garment), label: 'stand-in procedural garment fixture (lib/standin.mjs)'},
    heightM: 1.70, hairLumMax: null, dressFit: {init: {s: 1.0, t: [0, 0, 0]}, weights: {strap: 0}}, skin: {smoothIters: 4}, dressSkin: {thighMax: 0.45, skirt: true}, dressMode: 'uniform'};
}

/** Evidence-only static GLB of the bind pose (skinned rest positions, original textures) for scale-check.mjs --prop. */
async function bindStatic(R, file) {
  const doc = new Document(), buf = doc.createBuffer(), scene = doc.createScene();
  const world = jointWorld(R, null);
  for (const m of R.meshes) {
    const sk = skinMesh(m, world, true);
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(sk.pos).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(m.idx)).setBuffer(buf));
    if (m.uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(m.uv)).setBuffer(buf));
    const t = m.material?.getBaseColorTexture();
    const mat = doc.createMaterial(m.name).setDoubleSided(true);
    if (t) mat.setBaseColorTexture(doc.createTexture().setImage(t.getImage()).setMimeType(t.getMimeType()));
    prim.setMaterial(mat);
    scene.addChild(doc.createNode(m.name).setMesh(doc.createMesh(m.name).addPrimitive(prim)));
  }
  guard(file); fs.mkdirSync(path.dirname(file), {recursive: true});
  await io().write(file, doc);
}

async function evidence(R, B, outGlb, dir) {
  const rig = await loadRigged(outGlb);
  const tex = {};
  for (const m of rig.meshes) { const t = m.material?.getBaseColorTexture(); tex[m.name] = t ? await decodeTexture(t.getImage(), 1024) : null; }
  const zombie = await loadZombieBind(path.join(REPO, 'game/public/assets/models/zombie-body-lastshift-t25.glb'));
  const ZX = -0.95;
  const zMesh = {...zombie, pos: Float32Array.from(zombie.pos, (v, i) => i % 3 === 0 ? v + ZX : v)};
  const posed = (clip, t) => { const W = jointWorld(rig, clip, t); return rig.meshes.map(m => ({pos: skinMesh(m, W), idx: m.idx, uv: m.uv, tex: tex[m.name], color: [205, 205, 210]})); };
  const files = [];
  // 1. originals (native, as supplied)
  const orig = [];
  for (const [label, file] of [['BODY', R.bodySrc.file], ...(R.dress ? [['DRESS', R.dress.src.file]] : [])]) {
    const s = await readSource(file); const {prim} = singlePrimitive(s.doc, label);
    const t = prim.getMaterial()?.getBaseColorTexture();
    const m = {pos: prim.getAttribute('POSITION').getArray(), idx: prim.getIndices().getArray(), uv: prim.getAttribute('TEXCOORD_0')?.getArray(), nrm: prim.getAttribute('NORMAL')?.getArray(), tex: t ? await decodeTexture(t.getImage(), 2048) : null, color: [205, 205, 210]};
    let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < m.pos.length; i += 3) { y0 = Math.min(y0, m.pos[i]); y1 = Math.max(y1, m.pos[i]); }
    for (const [yaw, v] of [[0, 'front'], [90, 'side +X'], [180, 'back'], [270, 'side -X']]) orig.push({title: `${label} original — ${v}`, lines: [`native units, unchanged (sha256 ${s.sha256.slice(0, 12)}…)`], meshes: [m], cam: {yawDeg: yaw, cx: 0, cy: (y0 + y1) / 2, height: (y1 - y0) * 1.08}, ruler: false});
  }
  files.push((await renderPanels(orig, path.join(dir, 'originals-native.png'), {w: 460, h: 560, cols: 4, title: 'Siren uploads — ORIGINALS as supplied (native frame, no transform; CPU ortho, double-sided)'})).file);
  // 2. bind pose, runtime scale, beside a standing zombie
  const bind = posed(null, 0);
  const H = R.skel.H;
  files.push((await renderPanels([0, 90, 180, 270].map(yaw => ({title: `bind (runtime scale) yaw ${yaw}`, lines: [`Siren ${H.toFixed(2)} m · zombie lastshift 1.78 m (x ${ZX} m)`], meshes: [...bind, zMesh], cam: {yawDeg: yaw, cx: -0.4, cy: 1.0, height: 2.15}, floorY: 0, guides: [{y: H}, {y: 1.78, color: 'rgba(255,200,90,0.6)'}]})),
    path.join(dir, 'rigged-bind-beside-zombie.png'), {w: 620, h: 700, title: 'Rigged + dressed Siren — bind pose at runtime scale beside a real standing zombie (CPU glTF skinning of the written GLB)'})).file);
  // 3. skeleton overlay
  const J = R.skel.joints, segs = JOINTS.filter(j => j[1]).map(([n, p]) => [J[p], J[n]]);
  for (const e of ['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot']) segs.push([J[e], R.skel.ends[e]]);
  files.push((await renderPanels([0, 90].map(yaw => ({title: `skeleton yaw ${yaw}`, meshes: [bind[0], boneLines(segs), markers(Object.values(J))], cam: {yawDeg: yaw, cx: 0, cy: 0.88, height: 1.85}, floorY: 0})),
    path.join(dir, 'skeleton.png'), {w: 560, h: 640, title: 'Estimated 18-joint skeleton on the native body (bind)'})).file);
  // 4. clip poses beside the zombie
  const poses = [['Dormant', 0], ['Dormant', 2.0], ['Rise', 0.32], ['Rise', 0.62], ['Rise', 1.0], ['Run', 0.0], ['Run', 0.15], ['Run', 0.3], ['Attack', 0.28], ['Attack', 0.40], ['Attack', 0.54], ['Hit', 0.08], ['Death', 0.62], ['Death', 1.35], ['Death', 1.8]];
  for (const [yaw, tag] of [[0, 'front'], [90, 'side'], [35, 'three-quarter']]) {
    files.push((await renderPanels(poses.map(([c, t]) => ({title: `${c} t=${t.toFixed(2)} s`, lines: [tag], meshes: [...posed(c, t), zMesh], cam: {yawDeg: yaw, cx: -0.35, cy: 0.95, height: 2.1}, floorY: 0})),
      path.join(dir, `clips-${tag}.png`), {w: 400, h: 520, cols: 5, title: `Siren clips (${tag}) beside a standing zombie — CPU skinning of the written GLB; floor line y = 0`})).file);
  }
  // 5. dormant close-ups (4 sides)
  files.push((await renderPanels([0, 90, 180, 270].map(yaw => ({title: `Dormant yaw ${yaw}`, meshes: posed('Dormant', 0), cam: {yawDeg: yaw, cx: 0, cy: 0.45, height: 1.1}, floorY: 0})),
    path.join(dir, 'dormant-closeup.png'), {w: 520, h: 520, title: 'Dormant (frame 0) — knees / claws on the floor; skirt below the floor line is hidden by the floor in game'})).file);
  // 6. dress fit close-ups with poke-through flags (bind)
  if (R.dress) {
    const {pokeThrough} = await import('./lib/dress-fit.mjs');
    // skin vertices only: the refit uses the geometric closed-skin mask (the luminance hair mask misses the lighter strand tips)
    const pk = pokeThrough({pos: R.P, nrm: R.N, testIds: [...Array(R.P.length / 3).keys()].filter(i => (R.dress.refit ? R.dress.refit.skin[i] : !R.hairV || !R.hairV[i]))}, R.dress.pos, R.dress.idx);
    const I = R.native.idx, red = [];
    for (let t = 0; t < I.length; t += 3) if (pk.flags[I[t]] || pk.flags[I[t + 1]] || pk.flags[I[t + 2]]) red.push(I[t], I[t + 1], I[t + 2]);
    const redMesh = {pos: R.P, idx: Uint32Array.from(red), color: [255, 40, 40], zBias: 0.004};
    const fitLine = R.dress.mode === 'refit' ? 'garment-only refit (lib/garment-refit.mjs)' : `s ${R.dress.fit.s.toFixed(4)} · t ${R.dress.fit.t.map(v => v.toFixed(4)).join(', ')}`;
    files.push((await renderPanels([0, 90, 180, 270].map(yaw => ({title: `dress fit yaw ${yaw}`, lines: [`${fitLine} · skin through dress: ${pk.count} verts (red)`], meshes: [...bind, redMesh], cam: {yawDeg: yaw, cx: 0, cy: 1.0, height: 1.0}, ruler: false})),
      path.join(dir, 'dress-fit.png'), {w: 520, h: 640, title: R.dress.mode === 'refit' ? 'Dress REFIT (garment only) — bind; red = body skin showing through the dress (horizontal-normal ray test)' : 'Dress attachment (uniform scale + translation only) — bind; red = body skin showing through the dress'})).file);
  }
  return files.map(f => path.relative(REPO, f));
}

async function main() {
  const t0 = Date.now();
  const cfg = await config();
  const log = s => console.log(s);
  // sources verified BEFORE the build (readSource re-verifies when read; recorded here for the sidecar)
  const sourcesBefore = STANDIN ? null : [cfg.body, cfg.dress].map(p => ({uploadId: p.uploadId, sha256: sha256File(p.file), mode: (fs.statSync(p.file).mode & 0o777).toString(8)}));
  if (sourcesBefore) for (const [k, p] of [[0, cfg.body], [1, cfg.dress]]) if (sourcesBefore[k].sha256 !== p.sha256) throw new Error('source mismatch before the build: ' + p.uploadId);
  const B = await buildSiren({...cfg, generator: 'tools/asset-pipeline/enemy/build-siren.mjs'}, log);
  log(`  skeleton validation: ${B.skel.log.validation.filter(v => !v.ok).map(v => v.name).join(', ') || 'all in range'}`);
  if (B.dress?.mode === 'refit') log(`  dress REFIT strap ${JSON.stringify(B.dress.refit.report.strap)} push ${B.dress.refit.report.pushRounds.join('/')} weights ${JSON.stringify((({params: _p, method: _m, ...r}) => r)(B.dress.weightReport))}`);
  else if (B.dress) log(`  dress fit s ${B.dress.fit.s.toFixed(4)} t ${B.dress.fit.t.map(v => v.toFixed(4))} → ${JSON.stringify(B.dress.fit.report.pokeThrough)} strap ${JSON.stringify(B.dress.fit.report.strap)}`);
  log(`  dormant ${JSON.stringify(B.dormant)}\n  death ${JSON.stringify(B.death)}\n  guard ${JSON.stringify(B.guarded)}`);
  log('[6] assemble + write');
  const {doc, report} = await assemble(B, B.dress?.mode === 'refit' ? 'The Last Line — Siren rig, appearance-locked body + refitted dress (tools/asset-pipeline/enemy/build-siren.mjs)' : 'The Last Line — appearance-locked Siren rig (tools/asset-pipeline/enemy/build-siren.mjs)');
  guard(OUT.glb); fs.mkdirSync(path.dirname(OUT.glb), {recursive: true});
  await io().write(OUT.glb, doc);
  const outBytes = fs.statSync(OUT.glb).size, outSha = sha256File(OUT.glb);
  log(`  ${path.relative(REPO, OUT.glb)} ${outBytes} B sha256 ${outSha}`);
  log('[7] proofs');
  const proof = await proveAppearance(OUT.glb, [{name: 'SirenBody', srcDoc: (await readSource(B.bodySrc.file, B.bodySrc.sha256)).doc, M: B.place.M, srcFile: B.cfg.body.uploadId ?? path.relative(REPO, B.bodySrc.file), srcSha256: B.bodySrc.sha256},
    ...(B.dress ? [{name: 'SirenDress', srcDoc: (await readSource(B.dress.src.file, B.dress.src.sha256)).doc, M: B.dress.M, srcFile: B.cfg.dress.uploadId ?? path.relative(REPO, B.dress.src.file), srcSha256: B.dress.src.sha256, ...(B.dress.refit ? {refit: {pos: B.dress.refit.pos, nrm: B.dress.refit.nrm}} : {})}] : [])]);
  log(`  appearance proof ok=${proof.ok} ${proof.parts.map(p => `${p.name}: attrs ${Object.values(p.attributes).every(a => a.equal)} idx ${p.indices.equal} mat ${p.materialEqual} bind ${p.bindPose.maxPositionErrorM}`).join(' | ')} | textures bytes ${proof.textures.encodedBytesEqual} pixels ${proof.textures.pixelsEqual}`);
  if (!proof.ok) throw new Error('APPEARANCE PROOF FAILED — output not acceptable');
  proof.file = path.relative(REPO, proof.file);
  // the BODY must be identical to the reference build (main's asset before the refit): attributes incl. weights, indices, material,
  // textures, skin IBMs, skeleton, animations, gameplay extras
  let bodyInvariance = {skipped: 'stand-in build'};
  if (!STANDIN) {
    if (flag('--no-baseline')) bodyInvariance = {skipped: '--no-baseline'};
    else {
      if (!fs.existsSync(BASELINE.file)) throw new Error(`baseline ${BASELINE.file} not staged (copy main's enemy-siren.glb ${BASELINE.sha256.slice(0, 8)}… there, or pass --no-baseline)`);
      if (sha256File(BASELINE.file) !== BASELINE.sha256) throw new Error('baseline sha256 mismatch: ' + BASELINE.file);
      bodyInvariance = {...await proveBodyInvariance(OUT.glb, BASELINE.file), reference: {file: path.relative(REPO, BASELINE.file), sha256: BASELINE.sha256, commit: BASELINE.commit}};
      log(`  body invariance vs ${BASELINE.sha256.slice(0, 8)}… ok=${bodyInvariance.ok} (${Object.entries(bodyInvariance.items).filter(([, v]) => !v.equal).map(([k]) => k).join(', ') || 'all items equal'}); extras changed: ${bodyInvariance.extrasChanged.join(', ') || 'none'}`);
      if (!bodyInvariance.ok) throw new Error('BODY INVARIANCE FAILED — the body differs from the reference build');
    }
  }
  // the sources must still be byte-identical after the build
  for (const p of [B.bodySrc, B.dress?.src].filter(Boolean)) if (sha256File(p.file) !== p.sha256) throw new Error('SOURCE CHANGED ' + p.file);
  const sourcesAfter = STANDIN ? null : [cfg.body, cfg.dress].map(p => ({uploadId: p.uploadId, sha256: sha256File(p.file), mode: (fs.statSync(p.file).mode & 0o777).toString(8)}));
  let files = [];
  if (!flag('--no-evidence')) {
    log('[8] evidence renders');
    files = await evidence(B, B, OUT.glb, OUT.evidence);
    const R = await loadRigged(OUT.glb);
    const staticFile = path.join(OUT.evidence, STANDIN ? 'standin-bind-static.glb' : 'siren-bind-static.glb');
    await bindStatic(R, staticFile);
    files.push(path.relative(REPO, staticFile));
  }
  const refit = B.dress?.mode === 'refit';
  const dressAttr = refit ? Object.fromEntries(['POSITION', 'NORMAL'].map(sem => [sem, {source: proof.parts[1].attributes[sem].sourceSha256, refit: proof.parts[1].attributes[sem].sha256}])) : null;
  const sidecar = {
    asset: 'enemy-siren', task: refit ? 'studio-siren-clothing-refit-20261031-01 (dress refit) on studio-track1-siren-blightbelly-20261031-01 (rig)' : 'studio-track1-siren-blightbelly-20261031-01',
    lane: refit ? 'FIT (garment-only refit) / RIGS (appearance-locked body rig)' : 'RIGS (appearance-locked Siren rig path)', standin: STANDIN || undefined,
    generatedBy: 'tools/asset-pipeline/enemy/build-siren.mjs', builtAt: new Date().toISOString(),
    output: {file: path.relative(REPO, OUT.glb), bytes: outBytes, sha256: outSha, meshes: report, joints: JOINTS.length, clips: Object.keys(SIREN_CLIPS), extrasKey: 'scene.userData.enemySiren'},
    provenance: STANDIN ? {note: 'STAND-IN validation build — never shipped as the Siren.', body: {file: path.relative(REPO, B.bodySrc.file), sha256: B.bodySrc.sha256, label: cfg.body.label}, dress: {file: path.relative(REPO, B.dress.src.file), sha256: B.dress.src.sha256, label: cfg.dress.label}}
      : {status: refit ? 'user-supplied; body appearance-locked (technical rig / uniform fit only); dress = user-authorised garment-only refit of the supplied GhostDress; no licence clearance implied'
          : 'user-supplied, appearance-locked, technical rig / fit only; no licence clearance implied',
        userDirection: '"Don\'t don\'t modify the siren. The siren\'s already perfect." — appearance locked: no regeneration, redesign, reshaping, retexturing; originals untouched.',
        ...(refit ? {refitAuthority: {date: '2026-10-31', task: 'studio-siren-clothing-refit-20261031-01', scope: 'remodel / refit the existing DRESS only to the unchanged body (garment geometry, fit, skin weights); body appearance, rig, clips, gameplay unchanged; no new generation; renderings for human approval before merge / publication',
          userWords: '"the clothing needs to actually be fit to her model not just like staying rigid and just like crammed inside her model ... do a close refit clothing refit"', coverage: 'the wearer\'s anatomical RIGHT breast covered, LEFT exposed (the dress\'s own torn one-strap design)', humanApproval: 'pending (private preview)'}} : {}),
        sources: [B.cfg.body, B.cfg.dress].map(s => ({uploadId: s.uploadId, label: s.label, bytes: s.bytes, sha256: s.sha256, stagedCopy: path.relative(REPO, s.file), readOnly: true, filenameLabelIsNotProvenance: true})),
        sourcesVerified: {before: sourcesBefore, after: sourcesAfter},
        ...(refit ? {previousAsset: {sha256: BASELINE.sha256, commit: BASELINE.commit, dress: 'uniform scale 1.285299 + translation (-0.032857, 0.781470, -0.010275) m, no rotation (Track1)'}} : {}),
        generation: 'none — no model / image / audio generation was used for the Siren', licence: 'no licence or commercial clearance implied by this integration; the conditional prototype licensing caveats of the supplied uploads are unchanged; user approval of the refit appearance is not legal clearance'},
    appearanceLock: refit ? {preserved: 'BODY: native POSITION / NORMAL / TEXCOORD_0 / indices / material / texture bytes byte-identical (positions differ only by the recorded uniform transform in the skin\'s inverse bind matrices); body JOINTS_0 / WEIGHTS_0, skin IBMs, skeleton, clips identical to the reference build. DRESS: TEXCOORD_0 / indices / material / texture bytes byte-identical; POSITION / NORMAL re-derived by the refit (same vertex count / order)',
      added: 'JOINTS_0 / WEIGHTS_0 per native vertex, 18-joint skeleton, two skins sharing it, 6 procedural clips, scene extras, node / mesh names', proof, bodyInvariance}
      : {preserved: 'native POSITION / NORMAL / TEXCOORD_0 / indices / materials / textures (image bytes) — byte-identical; positions differ only by the recorded uniform transform, applied through the skins\' inverse bind matrices',
        added: 'JOINTS_0 / WEIGHTS_0 per native vertex, 18-joint skeleton, two skins sharing it, 6 procedural clips, scene extras, node / mesh names', proof},
    fit: {body: {uniformScale: +B.place.scale.toFixed(6), yawDeg: B.place.yawDeg, translationM: B.place.t.map(v => +v.toFixed(6)), matrix: B.place.M.map(v => +v.toFixed(9)), heightM: B.cfg.heightM, facing: B.place.facing, nativeBounds: B.place.nativeBounds,
      rule: 'uniform scale to the 1.70 m head / hair top (game-scale choice; ordinary zombies 1.65-1.80 m); feet midpoint to the origin; soles on y = 0; facing +Z (detected from the feet)'},
    dress: !B.dress ? null : refit ? {mode: 'refit', matrix: B.dress.M, rotation: 'none, no mirror: the dress\'s own strap / cup side (its -X) already lands on the wearer\'s RIGHT when both face +Z',
      method: 'lib/garment-refit.mjs: cylinder coordinates about the dress\'s own axis -> vertical landmark map (empire seam -> under-bust, cup peak -> top of the breast, skirt keeps Track1\'s x1.2853 length) + upper-bodice angle warp -> radius from the body\'s own torso surface closed by a smoothing filter + per-region cloth offset + the dress\'s own relief; skirt hangs from the hip with its own A-line flare, clear of the legs; strap re-routed over the right shoulder on the skin between its re-placed bases; collision push-out with diffusion; normals rotated from the source normals',
      changedAttributes: dressAttr, report: B.dress.refit.report, bodySkinMask: B.dress.refit.skinMask, pokeThroughAllSkinBind: B.stats.pokeThroughBind}
      : {uniformScale: +B.dress.fit.s.toFixed(6), translationM: B.dress.fit.t.map(v => +v.toFixed(6)), rotation: 'none (the dress faces +Z like the body)', matrix: B.dress.M.map(v => +v.toFixed(9)), solve: {method: 'Nelder-Mead over (s, tx, ty, tz) from a measured scan; objective = skin poke-through depth^2 (exact ray test) + strap-on-shoulder gap + bodice ease + hem clearance', init: B.dress.fit.init, evaluations: B.dress.fit.evaluations, weights: B.dress.fit.weights},
        result: B.dress.fit.report, initial: B.dress.fit.initReport, pokeThroughAllSkinBind: B.stats.pokeThroughBind}},
    skeleton: {method: 'tools/asset-pipeline/enemy/lib/tpose-skeleton.mjs on dense surface samples of the placed native body (hair excluded by a base-colour luminance mask)', joints: B.skel.joints, ends: B.skel.ends, hierarchy: JOINTS, landmarks: {H: B.skel.H, crotchY: B.skel.crotchY, hipY: B.skel.hipY, armpitY: B.skel.armpitY, neckBaseY: B.skel.neckBaseY, chinY: B.skel.chinY}, log: B.skel.log, bindRotations: 'identity (bone frames aligned with model space)'},
    skin: {body: {method: 'zombie/lib/skin.mjs computeSkinWeights (unchanged) on the welded body + hair post-pass (lib/siren-skin.mjs)', stats: B.sw.stats, check: B.stats.bodyWeights},
      dress: !B.dress ? null : refit ? {method: B.dress.weightReport.method, stats: B.dress.weightReport, check: B.stats.dressWeights} : {method: 'zombie/lib/skin.mjs transferWeights (closest body point, Head->Neck, skirt rule)', stats: B.dress.weights.stats, check: B.stats.dressWeights},
      encoding: 'JOINTS_0 UNSIGNED_BYTE, WEIGHTS_0 normalised UNSIGNED_BYTE (rows sum to exactly 255)'},
    clips: {method: 'hand-authored procedural keyframes / gait functions sampled at 30 fps (lib/siren-clips.mjs) on the shared pose machinery (zombie/lib/pose.mjs); not motion capture', specs: SIREN_CLIPS, dormantSolve: B.dormant, deathSolve: B.death,
      floorGuard: {method: 'per frame: Hips raised so the lowest CPU-skinned BODY vertex stays >= 5 mm above the floor', clips: B.guarded}, verify: B.verify},
    hitRadii: B.radii, extras: B.extras, stats: B.stats, evidence: files,
    limitations: refit ? [
      'Body (unchanged, inherited): linear blend skinning only (no corrective shapes): shoulders lose some volume when the T-pose arms come down; knees / ankles crease in the kneeling Dormant / Death poses; hair is part of the body mesh and deforms rigidly with the head / neck / chest (no hair simulation).',
      'Dress (refit): linear-blend skinned like the body, no cloth simulation: in strong hip / knee flexion (Run, Attack, Rise, kneeling Dormant) the thighs / knees pass through the skirt and its hem fringe in places, and the arm pressed to the side meets the cup side; the skirt does not drape or pool — it follows the thighs.',
      'Dress (refit): in the kneeling / prone poses the hem / fringe still passes below the floor line (dressMaxSinkBelowFloorM per clip in clips.verify; far less than before), hidden by the floor in game.',
      'Dress (refit): the hem sits at the knee (~0.42 m; fringe to ~0.33 m) — the bodice moved up onto the bust and the skirt kept its length, so it reads shorter than the Track1 placement (hem ~0.27 m); the left flank stays torn open from the under-bust to the hip and the left breast is exposed, as the supplied dress is designed.',
    ] : [
      'Linear blend skinning only (no corrective shapes): shoulders lose some volume when the T-pose arms come down; knees / ankles crease in the kneeling Dormant / Death poses.',
      'The dress is skinned to the body (closest-point transfer, skirt rule below the crotch); in kneeling / prone poses the skirt passes below the floor line (dressMaxSinkBelowFloorM per clip in clips.verify), hidden by the floor in game.',
      'Hair is part of the body mesh: it is weighted to the head / neck / chest chain (never the arms) and deforms rigidly with them (no hair simulation).',
      'The supplied dress is a torn one-strap slip: with the faithful uniform fit its bodice leaves the chest and the left flank / hip uncovered — a property of the supplied art, not changed here.',
    ],
  };
  write(OUT.json, JSON.stringify(sidecar, null, 1) + '\n');
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${path.relative(REPO, OUT.json)}`);
}

await main();
