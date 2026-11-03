#!/usr/bin/env node
// Meshy T2.5 migration (task studio-meshy-game-replacement-20261029-01, lane CHARS): class provenance of the character
// replacement -> game/public/assets/derivatives/meshy-t25-chars-20261029.json. Run after build-wardrobe.mjs /
// build-creature.mjs. One record per inventory master (6 bodies, 15 garments, 1 creature): Meshy task + native GLB +
// original input image (from the lane-MESHY delivery index), the live runtime file(s) (path, sha256, bytes, triangles,
// texture sizes, build tool) and the RESTORE map of every superseded runtime path (base commit + Git blob). Runtime
// files rebuilt only because the bodies they are fitted to changed are listed too (source unchanged). No signed URLs,
// no secrets: only repo-relative paths and hashes.
//   node tools/asset-pipeline/zombie/t25-provenance.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {REPO} from './lib/master.mjs';
import {T25_TASK, T25_BASE_COMMIT, deliveredIndex, restoreRecord, repoRel} from './lib/t25.mjs';
import {liveModelFiles} from './lib/live-files.mjs';
import {T25, KEEP_BODY_FILES, SKIP_WEARABLES} from './wardrobe.config.mjs';

const OUT = path.join(REPO, 'game/public/assets/derivatives/meshy-t25-chars-20261029.json');
const DERIV = path.join(REPO, 'game/public/assets/derivatives');
const git = args => execFileSync('git', ['-C', REPO, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rel = f => path.relative(REPO, f);
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const inventory = JSON.parse(fs.readFileSync(path.join(REPO, 'reference/tasks/meshy-game-replacement-20261029/inventory.json'), 'utf8'));
const delivered = deliveredIndex();
const creatureJson = JSON.parse(fs.readFileSync(path.join(DERIV, 'creature-ratdog.json'), 'utf8'));
const CREATURE_PIN = creatureJson.t25?.source ? {asset: 'creature:ratdog', attempt: creatureJson.t25.source.attempt, sha256: creatureJson.t25.source.nativeSha256} : null;

async function glbInfo(file) {
  const doc = await io.read(file);
  let tris = 0;
  const meshes = [];
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    meshes.push({node: n.getName(), triangles: t}); tris += t;
  }
  const textures = doc.getRoot().listTextures().map(t => ({name: t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength ?? 0}));
  return {path: rel(file), sha256: sha(file), bytes: fs.statSync(file).size, triangles: tris, meshNodes: meshes.length, ...(meshes.length > 1 ? {perNodeTriangles: meshes[0].triangles} : {}), textures,
    skins: doc.getRoot().listSkins().length, animations: doc.getRoot().listAnimations().map(a => a.getName())};
}
function nativeRecord(asset) {
  const d = delivered.assets?.[asset];
  if (!d) return null;
  return {meshyTaskId: d.taskId, attempt: d.attempt, provider: 'Meshy meshy_image_to_3d, ai_model meshy-t2.5, model_type smart-topology, should_texture + enable_pbr, texture_resolution 2k, target_formats [glb]',
    args: d.args, nativeGlb: `reference/tasks/meshy-game-replacement-20261029/assets/${d.nativeGlb}`, nativeSha256: d.sha256, nativeBytes: d.bytes, nativeTriangles: d.tris, nativeTextures: d.textures,
    inputImage: d.inputImage && repoRel(d.inputImage), inputImageSha256: d.inputImageSha256, review: d.review, reviewNote: d.reviewNote};
}

const live = liveModelFiles();
const masters = inventory.masters.filter(m => /^(body|garment|creature):/.test(m.id));
const records = [];
const rebuiltOnly = [];
for (const m of masters) {
  const [cls, id] = m.id.split(':');
  const oldPath = m.runtimePaths?.[0];
  const rec = {asset: m.id, class: m.class, displayName: m.displayName, oldRuntimePath: oldPath};
  const pinned = cls === 'creature' ? CREATURE_PIN : T25[id];
  const deriv = cls === 'body' ? `zombie-body-${id}.json` : cls === 'garment' ? `outfit-${id}.json` : 'creature-ratdog.json';
  const liveFile = cls === 'body' ? live.bodies[id] : cls === 'garment' ? live.wearables[id] : path.join(REPO, 'game/public', fs.readFileSync(path.join(REPO, 'game/src/assets/manifest.ts'), 'utf8').match(/creature_ratdog:\s*\{url:\s*'([^']+)'/)[1]);
  // replaced = the LIVE runtime file was actually built from the T2.5 source (its derivative manifest says so), not
  // merely pinned in the config
  const dj = liveFile ? JSON.parse(fs.readFileSync(path.join(DERIV, deriv), 'utf8')) : null;
  const builtFrom = dj?.t25?.source?.nativeSha256 ?? null;
  const replaced = !!dj?.t25?.sourceReplaced && !!builtFrom && builtFrom === (pinned?.sha256 ?? builtFrom) && rel(liveFile) === (dj.outputs?.glb?.path ?? dj.output?.file);
  if (cls === 'body' && KEEP_BODY_FILES.includes(id)) {
    rec.status = 'kept (no T2.5 replacement yet)';
    rec.reason = m.originalImage?.notOriginal ? `its T2.5 job uses a RECREATED reference (${m.originalImage.origin}; not an original) and is not delivered / integrated yet; the shipped file is verified unchanged by every wardrobe build` : 'no accepted T2.5 delivery integrated yet; shipped file verified unchanged';
  } else rec.status = replaced ? 'replaced' : 'pending (old local Pixal3D source still used)';
  rec.runtimeRebuilt = !!liveFile && !!oldPath && rel(liveFile) !== oldPath;
  if (replaced) rec.meshy = nativeRecord(m.id);
  if (m.originalImage?.notOriginal) rec.reference = {recreated: true, origin: m.originalImage.origin, note: 'conditioning image RECREATED from a guide render of the old model (user update 01); NOT a recovered original'};
  else if (pinned) rec.pinnedNotYetBuilt = {asset: pinned.asset ?? m.id, sha256: pinned.sha256};
  if (liveFile) {
    rec.runtime = {...await glbInfo(liveFile), derivativeManifest: `game/public/assets/derivatives/${deriv}`,
      buildTool: cls === 'creature' ? 'tools/asset-pipeline/creature/build-creature.mjs' : 'tools/asset-pipeline/zombie/build-wardrobe.mjs (wardrobe.config.mjs T25 pin)'};
    if (cls === 'garment') { const j = JSON.parse(fs.readFileSync(path.join(DERIV, deriv), 'utf8')); rec.runtime.fittedBodies = Object.keys(j.perBody ?? {}); }
    const d = JSON.parse(fs.readFileSync(path.join(DERIV, deriv), 'utf8'));
    if (d.t25?.source?.densify || d.source?.densify) rec.densify = d.t25?.source?.densify ?? d.source?.densify;
  }
  if (oldPath && liveFile && rel(liveFile) !== oldPath) rec.restore = restoreRecord(oldPath, git);
  if (!replaced && liveFile && rel(liveFile) !== oldPath) rebuiltOnly.push(m.id);
  records.push(rec);
}
// runtime files rebuilt in the migration without a replaced source (their per-body fits / clips follow replaced bodies)
const rebuilt = records.filter(r => rebuiltOnly.includes(r.asset)).map(r => ({asset: r.asset, runtime: r.runtime.path, restore: r.restore, reason: 'source master unchanged; per-body variants / masks (or the body clips solved against them) follow bodies / wearables replaced in this migration'}));
const counts = {masters: records.length, replaced: records.filter(r => r.status === 'replaced').length, kept: records.filter(r => r.status.startsWith('kept')).length,
  pending: records.filter(r => r.status.startsWith('pending')).length, rebuiltWithoutSourceChange: rebuilt.length};
const out = {schema: 'the-last-line/meshy-t25-class-provenance@1', class: 'chars', task: T25_TASK, lane: 'CHARS', generatedAt: new Date().toISOString(), baseCommit: T25_BASE_COMMIT,
  method: 'Accepted Meshy T2.5 native GLBs (single original front/reference image) are rebuilt by the EXISTING local CPU rig pipelines: densified (zombie/lib/densify.mjs, same surface + UV mapping) -> placement (metres, +Y up, +Z facing, feet / paws on y = 0) -> slice-landmark skeleton (18-joint humanoid / 25-joint quadruped, A-pose / bind as generated) -> simplify + new UV atlas + texture bake from the native textures -> automatic skin weights -> procedural clips (Idle/Walk/Run/Attack/Hit/Death) -> per-body garment fits (fit07 pose gate, masks, layering) recomputed for the new topology. No paid rigging / animation / remesh, no network.',
  status: {approved: false, gameReady: false, note: 'prototype derivatives; reference fidelity reviewed on CPU renders (reference/tasks/meshy-game-replacement-20261029/review/chars/)'},
  counts, keptBodyFiles: KEEP_BODY_FILES, skippedWearables: SKIP_WEARABLES, masters: records, rebuiltWithoutSourceChange: rebuilt};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', rel(OUT), JSON.stringify(counts));
