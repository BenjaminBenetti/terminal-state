#!/usr/bin/env node
// Terminal State - STRAINER enemy derivative builder (task studio-alpha-beyond-station-round4-20261101-01, lane ASSET). CPU
// only: no generation, inference, network or GPU. Single reproducible entry point (mirrors enemy/build-blightbelly.mjs):
//   flock /tmp/r4-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-strainer.mjs [--no-write]
//   QA sheets:  node tools/asset-pipeline/enemy/qa/strainer-sheets.mjs --out /tmp/r4qa/strainer   (renders the WRITTEN GLB)
// Reads the READ-ONLY accepted Meshy T2.5 Strainer (image-to-3D 01a195f6..., reference/tasks/beyond-station-round4-20261101/
// meshy/raw/a1/model.glb, sha256-pinned + re-verified after the build; ledger meshy/LEDGER.jsonl, read only) and writes ONLY:
//   game/public/assets/models/enemy-strainer.glb
//   game/public/assets/derivatives/enemy-strainer.json
// It does NOT touch the zombie wardrobe or any other enemy (no BODIES entry; never picked as an ordinary zombie body).
//
// Pipeline (the humanoid libs in tools/asset-pipeline/zombie/lib are used unchanged):
//   1. placement: facing (autorig.detectFacing), uniform scale to OPTIONS.heightM, feet midpoint at the origin, +Z facing;
//   2. landmarks: the main body (largest connected component; the ~250 loose frond / grille strands are separate closed
//      strips) densified (zombie/lib/densify.mjs, same surface) -> lib/strainer-skeleton.mjs (the shared 18-joint skeleton
//      measured with Strainer-specific, logged rules: hunched head, spread arms, long clawed hands, bent knees);
//   3. mesh: the Meshy smart-topology mesh, its UVs and its 2K PBR maps are KEPT (no simplify / re-UV / re-bake); textures
//      re-encoded for size only (base colour 2048 JPEG, metallic-roughness + normal 1024 JPEG 4:4:4);
//   4. skin: zombie/lib/skin.mjs region flood + chain weights + masked Laplacian smoothing (welded), then (a) the Neck /
//      Head share fades to Chest laterally (the spiked shoulder tops rise level with the crown), (b) the Chest / Neck / Head
//      shares are diffused over the jaw / upper rib-cage junction, (c) every loose strand copies the weights of the body
//      surface at its root (rigid strands: no stretching between bones), top 4;
//   5. clips: lib/strainer-clips.mjs (Idle, Walk, Run, Attack, Hit, Death), death pose floor-solved (zombie/lib/clipsolve.mjs
//      search + regionFloorReport with Strainer ranges: lib/strainer-clips.mjs solveStrainerDeath),
//      floor guard on the one-shots, CPU-skinned verification (floor, planted feet, arm / thigh vs torso and claw vs leg
//      clearance, triangle stretch, the Attack claw reach / hit frame);
//   6. GLB (gltf-transform; KHR_mesh_quantization normals) + scene extras `enemyStrainer` + sidecar provenance.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadSource} from '../zombie/lib/source.mjs';
import {detectFacing, placement, validateSkeleton, rigFor, bodyProfile} from '../zombie/lib/autorig.mjs';
import {placeHigh} from '../zombie/lib/stage-mesh.mjs';
import {densify} from '../zombie/lib/densify.mjs';
import {weldByPosition, bounds, normalizeAll, components, vertexAdjacency} from '../zombie/lib/mesh.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {computeSkinWeights, JOINT_NAMES} from '../zombie/lib/skin.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {regionFloorReport} from '../zombie/lib/clipsolve.mjs';
import {realize, deathFinal} from '../zombie/lib/clips.mjs';
import {Rig, V} from '../zombie/lib/pose.mjs';
import {quantizeWeights, writeDoc, geometryHash} from '../zombie/lib/variant-glb.mjs';
import {auditPoses, triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {TriGrid} from '../zombie/lib/penetration.mjs';
import {CLIP_SPECS, sampleClip, poseAt, FPS, solveStrainerDeath} from './lib/strainer-clips.mjs';
import {detectStrainerSkeleton, SKELETON_OPTIONS} from './lib/strainer-skeleton.mjs';

const ARGS = new Set(process.argv.slice(2));
const TASK = 'studio-alpha-beyond-station-round4-20261101-01';
const TASK_DIR = path.join(REPO, 'reference/tasks/beyond-station-round4-20261101');
const GENERATOR = 'Terminal State Strainer enemy derivative builder (tools/asset-pipeline/enemy/build-strainer.mjs)';
const OUT_GLB = path.join(REPO, 'game/public/assets/models/enemy-strainer.glb');
const OUT_JSON = path.join(REPO, 'game/public/assets/derivatives/enemy-strainer.json');

/** The accepted Meshy T2.5 image-to-3D body (meshy/LEDGER.jsonl 'accepted' row), pinned. */
export const SOURCE = {
  id: 'strainer-a1', file: path.join(TASK_DIR, 'meshy/raw/a1/model.glb'), sha256: 'cfaa5c7068aab8271fc2f9c13076082aca8e473dbe1fff131ee2ac7f2a6b8b64', bytes: 9383188,
  ledger: path.join(TASK_DIR, 'meshy/LEDGER.jsonl'), approvalAck: path.join(TASK_DIR, 'meshy/MESHY-APPROVAL-ACK.json'), taskId: '01a195f6-f769-7638-9bb6-48d52ba3c491',
  // the user-approved front T-pose the image-to-3D task was conditioned on (project's own Codex generation; read only)
  inputImage: {file: path.join(REPO, 'reference/tasks/strainer-tpose-20261101/pose/strainer-tpose-attempt2.png'), sha256: 'bb297b9a04db913e85d51f40ae6d4c4ef9d7539344d87fe00b0198e9ae1987be', bytes: 1888811},
};

export const OPTIONS = {
  heightM: 2.15, // decided: ~21 % taller than the 1.78 m zombie; annex doors 2.3 m, ceilings 2.4-2.8 m (runtime root scale multiplies)
  landmarks: {densifyFrac: 0.0045},
  skin: {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4},
  // the spiked shoulder tops / trapezius rise level with the crown: their Neck / Head share fades to Chest laterally (the
  // head cage itself is ~ +-0.15 m wide), so a head turn does not drag the shoulder spikes
  neckLateralFade: {x0: 0.16, x1: 0.25, note: 'torso-region main-body vertices: Neck + Head weight x (1 - smoothstep(x0, x1, |x|)), the remainder to Chest'},
  jawJunction: {below: 0.14, above: 0.06, maxAbsX: 0.25, iterations: 24, lambda: 0.5, note: 'torso-region main-body vertices from Neck.y - below to Head.y + above, |x| < maxAbsX: Laplacian diffusion of the normalised Chest / Neck / Head shares (neighbours outside the zone are fixed boundary values); each vertex keeps its Chest + Neck + Head total and all other influences'},
  strands: {note: 'every connected component other than the main body (loose frond / grille strips) copies the 4 weights of the main-body vertex nearest to its topmost vertex (its root): strands move rigidly with what they hang from'},
  textures: {baseColor: 2048, metallicRoughness: 1024, normal: 1024, quality: {base: 86, mr: 88, normal: 92}},
  // motor collider: the torso / hip core (the hunched crown overhangs it, the hanging arms swing outside it); must pass the
  // game's narrowest walk-through openings (2-cell doors = 1.0 m in the 0.5 m grid)
  collider: {radius: 0.36, narrowestOpeningM: 1.0},
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const r3 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(3)) : +(+v).toFixed(3);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const rel = f => path.relative(REPO, f);
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const REGION_STRAND = 5;

function guardOutput(file) {
  const r = rel(path.resolve(file));
  if (![rel(OUT_GLB), rel(OUT_JSON)].includes(r)) throw new Error('refusing to write outside the Strainer derivative outputs: ' + r);
  return file;
}

/** The task ledger (read only): one paid image-to-3D attempt, accepted. */
function readLedger() {
  const rows = fs.readFileSync(SOURCE.ledger, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const ev = (e, a = 1) => rows.find(r => r.event === e && (r.attempt === a || e === 'genesis'));
  const intent = ev('intent'), ack = ev('ack'), status = ev('status'), dl = ev('download+inspect'), acc = ev('accepted');
  if (!intent || !ack || !status || !dl || !acc) throw new Error('ledger rows missing');
  if (ack.taskId !== SOURCE.taskId || status.taskId !== SOURCE.taskId || dl.taskId !== SOURCE.taskId || acc.taskId !== SOURCE.taskId) throw new Error('ledger task id does not match the pinned source');
  if (dl.raw['model.glb'].sha256 !== SOURCE.sha256 || dl.raw['model.glb'].bytes !== SOURCE.bytes) throw new Error('ledger sha / bytes do not match the pinned source');
  if (intent.inputSha256 !== SOURCE.inputImage.sha256) throw new Error('ledger input image sha does not match');
  const ack0 = JSON.parse(fs.readFileSync(SOURCE.approvalAck, 'utf8'));
  const p = ack0.bodyRecipe.params;
  const last = rows[rows.length - 1];
  return {
    ledger: rel(SOURCE.ledger), approvalAck: rel(SOURCE.approvalAck), taskId: SOURCE.taskId, tool: intent.tool, status: status.status, credits: status.consumedCredits, waitSeconds: status.waitSeconds,
    settings: {ai_model: p.ai_model, model_type: p.model_type, pose_mode: p.pose_mode, should_texture: p.should_texture, texture_resolution: p.texture_resolution, enable_pbr: p.enable_pbr, target_polycount: p.target_polycount, target_formats: p.target_formats},
    inputImage: {file: rel(SOURCE.inputImage.file), sha256: intent.inputSha256, bytes: ack0.approvedInput.bytes, png: ack0.approvedInput.png},
    raw: {glb: dl.raw['model.glb'], providerMaps: Object.fromEntries(Object.entries(dl.raw).filter(([k]) => k !== 'model.glb'))}, rawMesh: dl.mesh,
    accepted: {at: acc.t, why: acc.why}, ledgerTotal: {bodyAttempts: last.bodyAttempts, paidPOSTs: last.paidPOSTs, billedCredits: last.billed, accepted: last.accepted},
  };
}

/** Raw embedded images of the source material. */
async function sourceImages() {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SOURCE.file);
  const mat = doc.getRoot().listMaterials()[0];
  const img = t => t && {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize()};
  return {base: img(mat.getBaseColorTexture()), mr: img(mat.getMetallicRoughnessTexture()), normal: img(mat.getNormalTexture()), doubleSided: mat.getDoubleSided(), normalScale: mat.getNormalScale()};
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

/** Main body (largest connected component) vs loose strands. */
function splitComponents(weld) {
  const n = weld.pos.length / 3, comp = components(n, weld.idx);
  const counts = new Map(); for (const l of comp.label) counts.set(l, (counts.get(l) || 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const strands = new Map();
  for (let i = 0; i < n; i++) { const l = comp.label[i]; if (l === main) continue; if (!strands.has(l)) strands.set(l, []); strands.get(l).push(i); }
  const isMain = Uint8Array.from(comp.label, l => l === main ? 1 : 0);
  return {isMain, mainVertices: counts.get(main), strands: [...strands.values()]};
}

/** Landmark point cloud: the densified, welded main body (the strands would read as limbs / torso in the slices). */
function landmarkCloud(weld, split, H) {
  const keep = [];
  for (let t = 0; t < weld.idx.length; t += 3) if (split.isMain[weld.idx[t]]) keep.push(weld.idx[t], weld.idx[t + 1], weld.idx[t + 2]);
  const d = densify({pos: weld.pos, nrm: weld.nrm, uv: new Float32Array(weld.pos.length / 3 * 2), idx: Uint32Array.from(keep)}, H * OPTIONS.landmarks.densifyFrac);
  const wh = weldByPosition(d.pos, d.nrm, d.idx);
  return {pos: wh.pos, stats: {densify: d.stats, weldedVertices: wh.pos.length / 3, method: `main body only (largest connected component, ${split.mainVertices} welded vertices; ${split.strands.length} loose strand components left out), densified to max edge ${OPTIONS.landmarks.densifyFrac} x height and welded`}};
}

/** Replace a vertex's 4 influences by a joint -> weight map (top 4, normalised). */
function setRow(sw, i, m) {
  const top = [...m.entries()].filter(e => e[1] > 1e-4).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const s = top.reduce((a, e) => a + e[1], 0);
  for (let k = 0; k < 4; k++) { sw.joints[i * 4 + k] = top[k] ? top[k][0] : 0; sw.weights[i * 4 + k] = top[k] ? top[k][1] / s : 0; }
  sw.weights[i * 4] += 1 - (sw.weights[i * 4] + sw.weights[i * 4 + 1] + sw.weights[i * 4 + 2] + sw.weights[i * 4 + 3]);
}
const rowOf = (sw, i) => { const m = new Map(); for (let k = 0; k < 4; k++) { const w = sw.weights[i * 4 + k]; if (w > 0) m.set(sw.joints[i * 4 + k], (m.get(sw.joints[i * 4 + k]) || 0) + w); } return m; };

/** (a) lateral fade of the Neck / Head share (shoulder spikes / trapezius stay with the Chest). */
function neckLateralFade(weld, sw, split) {
  const O = OPTIONS.neckLateralFade, NECK = JOINT_NAMES.indexOf('Neck'), HEAD = JOINT_NAMES.indexOf('Head'), CHEST = JOINT_NAMES.indexOf('Chest');
  let changed = 0, moved = 0;
  for (let i = 0; i < weld.pos.length / 3; i++) {
    if (!split.isMain[i] || sw.region[i] !== 0) continue;
    const f = smooth(O.x0, O.x1, Math.abs(weld.pos[i * 3]));
    if (f <= 0) continue;
    const m = rowOf(sw, i), nh = (m.get(NECK) || 0) + (m.get(HEAD) || 0);
    if (nh <= 1e-6) continue;
    if (m.has(NECK)) m.set(NECK, m.get(NECK) * (1 - f));
    if (m.has(HEAD)) m.set(HEAD, m.get(HEAD) * (1 - f));
    m.set(CHEST, (m.get(CHEST) || 0) + nh * f);
    setRow(sw, i, m); changed++; moved += nh * f;
  }
  return {verticesChanged: changed, weightMovedToChest: r4(moved), ...O};
}

/**
 * (b) jaw / rib-cage junction: the exposed upper ribs join the jaw directly under the face, so skin.mjs's tilted neck / head
 * boundary switches Chest -> Head within ~6 cm there; diffuse the Chest / Neck / Head shares (each vertex keeps its total
 * of the three and every other influence) over the junction zone so the change is spread over the upper rib cage.
 */
function junctionSmooth(weld, sw, skel, split) {
  const O = OPTIONS.jawJunction, J = skel.joints, C = ['Chest', 'Neck', 'Head'].map(n => JOINT_NAMES.indexOf(n));
  const n = weld.pos.length / 3, {offs, adj} = vertexAdjacency(n, weld.idx);
  const inZone = new Uint8Array(n), share = new Float32Array(n * 3), total = new Float32Array(n);
  let zone = 0;
  for (let i = 0; i < n; i++) {
    const m = rowOf(sw, i);
    for (let k = 0; k < 3; k++) share[i * 3 + k] = m.get(C[k]) || 0;
    total[i] = share[i * 3] + share[i * 3 + 1] + share[i * 3 + 2];
    const x = weld.pos[i * 3], y = weld.pos[i * 3 + 1];
    if (split.isMain[i] && sw.region[i] === 0 && total[i] > 0.05 && Math.abs(x) < O.maxAbsX && y > J.Neck[1] - O.below && y < J.Head[1] + O.above) { inZone[i] = 1; zone++; }
  }
  for (let it = 0; it < O.iterations; it++) {
    const next = Float32Array.from(share);
    for (let i = 0; i < n; i++) {
      if (!inZone[i]) continue;
      const deg = offs[i + 1] - offs[i]; if (!deg) continue;
      const avg = [0, 0, 0];
      for (let e = offs[i]; e < offs[i + 1]; e++) { const j = adj[e], tj = total[j] || 1; for (let k = 0; k < 3; k++) avg[k] += share[j * 3 + k] / tj; }
      const cur = [0, 1, 2].map(k => share[i * 3 + k] / total[i]);
      const mix = cur.map((v, k) => (1 - O.lambda) * v + O.lambda * avg[k] / deg), ms = mix[0] + mix[1] + mix[2] || 1;
      for (let k = 0; k < 3; k++) next[i * 3 + k] = total[i] * mix[k] / ms;
    }
    share.set(next);
  }
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (!inZone[i]) continue;
    const m = rowOf(sw, i);
    for (let k = 0; k < 3; k++) m.set(C[k], share[i * 3 + k]);
    setRow(sw, i, m); changed++;
  }
  return {zoneVertices: zone, verticesChanged: changed, ...O};
}

/** (c) loose strands copy the weights at their root (nearest main-body vertex to the strand's topmost vertex). */
function strandsFollowRoots(weld, sw, split) {
  const P = weld.pos, mainIds = [];
  for (let i = 0; i < P.length / 3; i++) if (split.isMain[i]) mainIds.push(i);
  const byBone = {};
  let maxRootGap = 0;
  for (const ids of split.strands) {
    let top = ids[0]; for (const i of ids) if (P[i * 3 + 1] > P[top * 3 + 1]) top = i;
    let best = -1, bd = Infinity;
    for (const j of mainIds) { const d = (P[j * 3] - P[top * 3]) ** 2 + (P[j * 3 + 1] - P[top * 3 + 1]) ** 2 + (P[j * 3 + 2] - P[top * 3 + 2]) ** 2; if (d < bd) { bd = d; best = j; } }
    maxRootGap = Math.max(maxRootGap, Math.sqrt(bd));
    for (const i of ids) { for (let k = 0; k < 4; k++) { sw.joints[i * 4 + k] = sw.joints[best * 4 + k]; sw.weights[i * 4 + k] = sw.weights[best * 4 + k]; } sw.region[i] = REGION_STRAND; }
    const dom = JOINT_NAMES[sw.joints[best * 4]];
    byBone[dom] = (byBone[dom] || 0) + 1;
  }
  return {strands: split.strands.length, vertices: split.strands.reduce((a, s) => a + s.length, 0), byDominantBone: byBone, maxRootGapM: r4(maxRootGap), ...OPTIONS.strands};
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

/** Hit volumes (model metres, actor scale 1) on the welded bind mesh; head sphere for headshots. */
function measureHit(weld, sw, skel, profile) {
  const J = skel.joints, P = weld.pos, n = P.length / 3, HEAD = JOINT_NAMES.indexOf('Head');
  const spine = [J.Hips, J.Spine, J.Chest, J.Neck];
  const torso = [], head = [], headPts = [];
  for (let i = 0; i < n; i++) {
    if (sw.region[i] !== 0) continue;
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    let hw = 0; for (let k = 0; k < 4; k++) if (sw.joints[i * 4 + k] === HEAD) hw += sw.weights[i * 4 + k];
    if (hw >= 0.5 && p[1] >= skel.neckBaseY) { headPts.push(p); head.push(onPolyline(p, [J.Head, skel.ends.Head])); continue; }
    if (p[1] < skel.crotchY || p[1] > J.Neck[1] || p[2] > 0.2) continue; // torso core (not the rib cage / grille bar standing in front)
    torso.push(onPolyline(p, spine));
  }
  const lo = [0, 1, 2].map(k => Math.min(...headPts.map(q => q[k]))), hi = [0, 1, 2].map(k => Math.max(...headPts.map(q => q[k])));
  const centre = lo.map((v, k) => (v + hi[k]) / 2);
  const dists = headPts.map(q => V.len(V.sub(q, centre)));
  const L = profile.limb;
  return {
    headSphere: {bone: 'Head', center: r4(centre), offset: r4(V.sub(centre, J.Head)), radius: r4(pct(dists, 0.85)), radiusMax: r4(Math.max(...dists)), vertices: headPts.length,
      method: 'bind pose: torso-region vertices above the neck base with Head weight >= 0.5 (the crown / face cage); centre = their bbox centre, radius = 85th pct distance to it (radiusMax = enclosing)'},
    head: r4(pct(head, 0.75)),
    torso: r4(pct(torso, 0.75)),
    arm: r4(((L.L_UpperArm.radius ?? 0.06) + (L.L_Forearm.radius ?? 0.05)) / 2 * 1.35),
    leg: r4(((L.L_Thigh.radius ?? 0.09) + (L.L_Shin.radius ?? 0.07)) / 2 * 1.4),
    torsoP90: r4(pct(torso, 0.9)),
    method: 'torso: 75th pct distance of the torso core (crotch..neck, z < 0.2: not the rib cage / grille bar standing in front) to the Hips-Spine-Chest-Neck chain (capsule Hips->Neck in ai/zombieActor.ts updateVolumes); head: 75th pct distance of the head vertices to the Head joint -> head end segment (the crown points forward-down), plus the headshot sphere; limbs: autorig bodyProfile radii x1.35 (arm) / x1.4 (leg) like zombie/lib/hit.mjs (unclamped)',
  };
}

/** Footprint / door clearance from the bind mesh (torso + legs; arms reported separately; strands skipped). */
function footprint(weld, sw) {
  const P = weld.pos, n = P.length / 3;
  let torsoR = 0, armR = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const rs = [];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], z = P[i * 3 + 2], r = Math.hypot(x, z);
    if (sw.region[i] === REGION_STRAND) continue;
    if (sw.region[i] === 1 || sw.region[i] === 2) { armR = Math.max(armR, Math.abs(x)); continue; }
    torsoR = Math.max(torsoR, r); rs.push(r);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const R = OPTIONS.collider.radius, gap = OPTIONS.collider.narrowestOpeningM;
  return {torsoHalfWidthM: r3(Math.max(-x0, x1)), torsoFrontZ: r3(z1), torsoBackZ: r3(z0), torsoMaxRadiusM: r3(torsoR), torsoRadiusP95: r3(pct(rs, 0.95)), torsoRadiusP90: r3(pct(rs, 0.9)), armOuterXM: r3(armR),
    collider: {radius: R, diameter: r3(2 * R), narrowestOpeningM: gap, clearancePerSideM: r3((gap - 2 * R) / 2),
      note: `motor circle radius ${R} m (ordinary zombie 0.33, coated 0.38): covers the torso / hip core (95th pct horizontal radius of the torso + leg vertices ${r3(pct(rs, 0.95))} m; the hunched crown overhangs it forward to z ${r3(z1)} m) and passes the narrowest walk-through openings (2-cell doors, 1.0 m) with ${r3((gap - 2 * R) / 2)} m per side; hanging arms / claws may visually brush door jambs (no collision)`}};
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
        const stance = c.name === 'Idle' || ((c.name === 'Walk' || c.name === 'Run') && ph < S.beta - 0.04 && ph > 0.04);
        if (stance) { feet[s].stanceMaxY = Math.max(feet[s].stanceMaxY, fm); feet[s].stanceFrames++; }
      }
    }
    const fr = s => ({minY: r4(feet[s].minY), ...(feet[s].stanceFrames ? {stanceLowestPointMaxY: r4(feet[s].stanceMaxY), stanceFrames: feet[s].stanceFrames} : {})});
    out[c.name] = {frames: c.times.length, minY: r4(lo), atT: c.times[iLo], framesBelowMinus1cm: below, maxLegReach: c.maxLegReach, feet: {L: fr('L'), R: fr('R')}};
  }
  return out;
}

/** Planted-foot slide (loops): horizontal travel of the flat stance foot's sole vs the treadmill ground speed. */
function verifySkate(rig, skel, mesh, clips, footVerts) {
  const out = {};
  // fixed sole vertex sets: bind foot vertices below 3 cm
  const sole = Object.fromEntries(['L', 'R'].map(s => [s, footVerts[s].filter(i => mesh.pos[i * 3 + 1] < 0.03)]));
  for (const c of clips.filter(c => c.name === 'Walk' || c.name === 'Run' || c.name === 'Idle')) {
    const S = CLIP_SPECS[c.name], v = S.groundSpeed || 0, dt = 1 / FPS;
    let worst = 0, sum = 0, k = 0;
    for (const s of ['L', 'R']) {
      let prev = null;
      for (let f = 0; f < c.times.length; f++) {
        const ph = (c.times[f] / c.duration + (s === 'R' ? 0.5 : 0)) % 1;
        // flat-foot window of the stance (heel strike settled by 15 %, toe roll starts at 75 %: lib/strainer-clips.mjs footCycle)
        const stance = c.name === 'Idle' || (ph > 0.15 * S.beta && ph < 0.75 * S.beta);
        const P = skinPositions(mesh, skel, rig.fk(poseAt(c, f)));
        const m = sole[s].reduce((a, i) => [a[0] + P[i * 3] / sole[s].length, a[1] + P[i * 3 + 2] / sole[s].length], [0, 0]);
        if (stance && prev) { const slip = Math.hypot(m[0] - prev[0], (m[1] - prev[1]) + v * dt) / dt; worst = Math.max(worst, slip); sum += slip; k++; }
        prev = stance ? m : null;
      }
    }
    out[c.name] = {maxSlipMps: r3(worst), meanSlipMps: r3(k ? sum / k : 0), framesTested: k, groundSpeed: v};
  }
  return {method: 'flat-foot stance frames (phase 0.15..0.75 x beta; Idle all frames): mean horizontal position of the fixed sole vertex set (bind foot vertices below 3 cm), frame-to-frame speed relative to the treadmill (the stance foot slides back at exactly groundSpeed in place); 0 = no skating', soleVertices: {L: sole.L.length, R: sole.R.length}, ...out};
}

/**
 * Clearance audit: posed limb vertices against a posed body surface. Depth = how far a vertex lies INSIDE the closest surface
 * triangle (against its outward normal). Only vertices clear of that surface in the bind pose are tested.
 */
function clearanceAudit(rig, skel, weld, sw, clips, {every = 2} = {}) {
  const P0 = weld.pos, I = weld.idx, n = P0.length / 3;
  const regionOf = i => sw.region[i];
  const dom = i => JOINT_NAMES[sw.joints[i * 4]];
  const triSet = pred => { const out = []; for (let t = 0; t < I.length; t += 3) if (pred(I[t]) && pred(I[t + 1]) && pred(I[t + 2])) out.push(I[t], I[t + 1], I[t + 2]); return Uint32Array.from(out); };
  const torsoTris = triSet(i => regionOf(i) === 0 && P0[i * 3 + 1] > skel.crotchY - 0.05);
  const legTris = triSet(i => (regionOf(i) === 3 || regionOf(i) === 4) && /_(Thigh|Shin)$/.test(dom(i)));
  const sign = TI => {
    const NW = weld.nrm, sgn = new Int8Array(TI.length / 3);
    for (let t = 0; t < TI.length / 3; t++) {
      const a = TI[t * 3] * 3, b = TI[t * 3 + 1] * 3, c = TI[t * 3 + 2] * 3;
      const fn = V.cross([P0[b] - P0[a], P0[b + 1] - P0[a + 1], P0[b + 2] - P0[a + 2]], [P0[c] - P0[a], P0[c + 1] - P0[a + 1], P0[c + 2] - P0[a + 2]]);
      sgn[t] = V.dot(fn, [NW[a] + NW[b] + NW[c], NW[a + 1] + NW[b + 1] + NW[c + 1], NW[a + 2] + NW[b + 2] + NW[c + 2]]) < 0 ? -1 : 1;
    }
    return sgn;
  };
  const pairs = {
    armsVsTorso: {tris: torsoTris, verts: i => (regionOf(i) === 1 || regionOf(i) === 2) && /_(Forearm|Hand)$/.test(dom(i)), bindGap: 0.03},
    thighsVsTorso: {tris: torsoTris, verts: i => (regionOf(i) === 3 || regionOf(i) === 4) && /_Thigh$/.test(dom(i)), bindGap: 0.06},
    clawsVsLegs: {tris: legTris, verts: i => (regionOf(i) === 1 || regionOf(i) === 2) && /_Hand$/.test(dom(i)), bindGap: 0.03},
  };
  const res = {method: `every ${every}nd frame: CPU-skinned limb vertices clear of the surface in the bind pose vs the posed surface; depth = distance behind the closest surface triangle along its outward normal (oriented by the bind vertex normals). armsVsTorso: forearm / hand vs torso above the crotch; thighsVsTorso: thigh vs torso; clawsVsLegs: hand / claw vs thigh + shin`, testedVertices: {}};
  const mesh = {pos: P0, joints: sw.joints, weights: sw.weights};
  const bindClip = {name: 'Bind', times: [0], hips: [[0, 0, 0]], rot: {}};
  for (const [key, def] of Object.entries(pairs)) {
    const sgn = sign(def.tris), bindGrid = new TriGrid(P0, def.tris, 0.04), set = [];
    for (let i = 0; i < n; i++) { if (!def.verts(i)) continue; const h = bindGrid.closest(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2], 0.06); if (h && h.d < def.bindGap) continue; set.push(i); }
    res.testedVertices[key] = set.length;
    res[key] = {};
    for (const c of [bindClip, ...clips]) {
      const acc = {maxDepth: 0, frames: 0, worstT: null, vertsOver1cm: 0};
      for (let f = 0; f < c.times.length; f += every) {
        const P = skinPositions(mesh, skel, rig.fk(poseAt(c, f)));
        const g = new TriGrid(P, def.tris, 0.04);
        let over = 0, md = 0;
        for (const i of set) {
          const h = g.closest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.12);
          if (!h) continue;
          const a = def.tris[h.tri * 3] * 3, b = def.tris[h.tri * 3 + 1] * 3, cc = def.tris[h.tri * 3 + 2] * 3;
          const fn = V.mul(V.norm(V.cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[cc] - P[a], P[cc + 1] - P[a + 1], P[cc + 2] - P[a + 2]])), sgn[h.tri]);
          const depth = -V.dot(V.sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], h.q.slice(0, 3)), fn);
          if (depth > 0.01) over++;
          if (depth > md) md = depth;
        }
        acc.frames++;
        if (md > acc.maxDepth) { acc.maxDepth = md; acc.worstT = c.times[f]; }
        acc.vertsOver1cm = Math.max(acc.vertsOver1cm, over);
      }
      res[key][c.name] = {maxDepthM: r4(acc.maxDepth), worstT: acc.worstT, maxVertsDeeperThan1cm: acc.vertsOver1cm, framesTested: acc.frames};
    }
  }
  return res;
}

/** Floor guard for the one-shots: per frame, lift the Hips so the lowest skinned vertex stays >= 5 mm above the floor. */
function floorGuard(rig, skel, mesh, clip, minY = 0.005) {
  let maxLift = 0, frames = 0;
  for (let f = 0; f < clip.times.length; f++) {
    const P = skinPositions(mesh, skel, rig.fk(poseAt(clip, f)));
    let mn = Infinity; for (let i = 1; i < P.length; i += 3) mn = Math.min(mn, P[i]);
    if (mn < -0.002) { const lift = minY - mn; clip.hips[f] = [clip.hips[f][0], clip.hips[f][1] + lift, clip.hips[f][2]]; maxLift = Math.max(maxLift, lift); frames++; }
  }
  return {frames, maxLiftM: r4(maxLift)};
}

/**
 * Attack claw metrics (CPU skinning of the welded body): per frame the right / left hand-region vertex farthest from the root
 * horizontally; at the hit frame (impactTime) the reach (horizontal distance root -> claw tip), the tip height and position;
 * the right claw tip path through the swing (when it crosses the front centre line x = 0 in front of the body).
 */
function attackMetrics(rig, skel, weld, sw, clip) {
  const mesh = {pos: weld.pos, joints: sw.joints, weights: sw.weights};
  const hands = {L: [], R: []};
  for (let i = 0; i < weld.pos.length / 3; i++) { const j = JOINT_NAMES[sw.joints[i * 4]]; if ((sw.region[i] === 1 || sw.region[i] === 2) && j === 'L_Hand') hands.L.push(i); else if ((sw.region[i] === 1 || sw.region[i] === 2) && j === 'R_Hand') hands.R.push(i); }
  const S = CLIP_SPECS.Attack, fHit = clip.times.findIndex(t => Math.abs(t - S.impactTime) < 1e-4);
  const path = [];
  let hit = null, maxReach = {d: 0};
  for (let f = 0; f < clip.times.length; f++) {
    const P = skinPositions(mesh, skel, rig.fk(poseAt(clip, f)));
    const tip = s => { let best = null; for (const i of hands[s]) { const d = Math.hypot(P[i * 3], P[i * 3 + 2]); if (!best || d > best.d) best = {d, p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]}; } return best; };
    const R = tip('R'), L = tip('L');
    // the forward-most right claw point (the swiping claw edge in front)
    let fwd = null; for (const i of hands.R) if (!fwd || P[i * 3 + 2] > fwd[2]) fwd = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    path.push({t: clip.times[f], R: r3(R.p), reachR: r3(R.d), L: r3(L.p), reachL: r3(L.d), frontR: r3(fwd)});
    if (R.d > maxReach.d) maxReach = {d: R.d, t: clip.times[f]};
    if (f === fHit) hit = {t: clip.times[f], reachM: r3(Math.max(R.d, L.d)), reachR: r3(R.d), reachL: r3(L.d), clawTipR: r3(R.p), clawTipL: r3(L.p), frontMostR: r3(fwd)};
  }
  // centre-line crossing of the right claw's forward-most point (x from - to +) while in front of the body
  let crossing = null;
  for (let f = 1; f < path.length; f++) { const a = path[f - 1].frontR, b = path[f].frontR; if (a[0] < 0 && b[0] >= 0 && b[2] > 0.4) { const u = -a[0] / (b[0] - a[0]); crossing = {t: r3(path[f - 1].t + u * (path[f].t - path[f - 1].t)), y: r3(a[1] + u * (b[1] - a[1])), z: r3(a[2] + u * (b[2] - a[2]))}; break; } }
  return {hitFrame: fHit, hit, maxReachR: {m: r3(maxReach.d), t: maxReach.t}, centreLineCrossingR: crossing, handVertices: {L: hands.L.length, R: hands.R.length},
    path: path.filter((p, i) => i % 2 === 0 || i === fHit),
    method: 'CPU skinning of the welded body (top-4 float weights) at every Attack frame; reach = horizontal distance from the root (feet midpoint, actor origin) to the hand-region vertex farthest from it; clawTip = that vertex; frontMostR = the right hand vertex with the largest z; centre-line crossing = when frontMostR passes x = 0 in front of the body (z > 0.4 m)'};
}

// ------------------------------------------------------------------------------------------------ GLB
function buildDocument({skel, body, clips, extras, tex}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Strainer').setExtras({enemyStrainer: extras});
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin('StrainerSkin').setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor('StrainerSkin_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  const acc = (type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
  const qn = nrm => { const q = new Int8Array(nrm.length); for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))); return q; };
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const texture = (name, img, mime) => doc.createTexture(name).setImage(img).setMimeType(mime);
  const bodyMat = doc.createMaterial('StrainerBodyMaterial').setBaseColorTexture(texture('Strainer_baseColor', tex.base, 'image/jpeg'))
    .setMetallicRoughnessTexture(texture('Strainer_metallicRoughness', tex.mr, 'image/jpeg')).setNormalTexture(texture('Strainer_normal', tex.normal, 'image/jpeg'))
    .setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(tex.doubleSided);
  const q = quantizeWeights(body.joints, body.weights);
  const prim = doc.createPrimitive().setMaterial(bodyMat).setAttribute('POSITION', acc('VEC3', body.pos)).setAttribute('NORMAL', acc('VEC3', qn(body.nrm), true))
    .setAttribute('TEXCOORD_0', acc('VEC2', body.uv)).setAttribute('JOINTS_0', acc('VEC4', q.joints)).setAttribute('WEIGHTS_0', acc('VEC4', q.weights, true))
    .setIndices(acc('SCALAR', body.pos.length / 3 < 65536 ? Uint16Array.from(body.idx) : Uint32Array.from(body.idx)));
  scene.addChild(doc.createNode('StrainerBody').setMesh(doc.createMesh('StrainerBody').addPrimitive(prim)).setSkin(skin).setExtras({slot: 'body'}));
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

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const t0 = Date.now();
  for (const f of [OUT_GLB, OUT_JSON]) guardOutput(f);
  if (sha256File(SOURCE.file) !== SOURCE.sha256 || fs.statSync(SOURCE.file).size !== SOURCE.bytes) throw new Error('source sha256 / bytes mismatch: ' + rel(SOURCE.file));
  const meshy = readLedger();
  const inputVerified = fs.existsSync(SOURCE.inputImage.file) ? sha256File(SOURCE.inputImage.file) === SOURCE.inputImage.sha256 : null;
  if (inputVerified === false) throw new Error('approved input image sha256 mismatch');
  console.log('[1/7] load + place');
  const m = await loadSource({id: SOURCE.id, file: SOURCE.file, sha256: SOURCE.sha256});
  const imgs = await sourceImages();
  const fd = detectFacing(m.pos);
  const pl = placement(m, OPTIONS.heightM, fd.facing);
  const low = placeHigh(m, pl);
  const {nativeBounds, ...plRest} = pl;
  console.log('  facing', fd.facing, 'scale', pl.scale.toFixed(4), 'textures', JSON.stringify([imgs.base.size, imgs.base.mime, imgs.mr && imgs.mr.size, imgs.normal && imgs.normal.size]));

  console.log('[2/7] landmarks + skeleton');
  const weld = weldLow(low.pos, low.nrm, m.idx);
  const split = splitComponents(weld);
  const cloud = landmarkCloud(weld, split, OPTIONS.heightM);
  const skel = detectStrainerSkeleton(cloud.pos);
  const issues = validateSkeleton(skel);
  console.log('  issues', JSON.stringify(issues), 'joints', JSON.stringify(skel.joints));

  console.log('[3/7] skin');
  const sw = computeSkinWeights(weld, rigFor(skel), {kind: 'body', ...OPTIONS.skin});
  const lateral = neckLateralFade(weld, sw, split);
  const junction = junctionSmooth(weld, sw, skel, split);
  const strands = strandsFollowRoots(weld, sw, split);
  const bodyW = spread(weld.weldId, sw);
  const profile = bodyProfile(skel, weld, sw);
  const hit = measureHit(weld, sw, skel, profile);
  const foot = footprint(weld, sw);
  console.log('  regions', JSON.stringify(sw.stats.regionVertexCounts), 'neckLateralFade', lateral.verticesChanged, 'junction', junction.zoneVertices, 'strands', JSON.stringify(strands.byDominantBone), 'rootGap', strands.maxRootGapM);
  console.log('  hit', JSON.stringify(hit), 'footprint', JSON.stringify(foot));
  const bodyMesh = {name: 'StrainerBody', pos: low.pos, nrm: low.nrm, uv: m.uv, idx: m.idx, ...bodyW};

  console.log('[4/7] clips');
  const rig = new Rig(skel);
  // (zombie/lib/clipsolve.mjs labels the mesh named 'ZombieBody' as the body)
  const solveSet = [{...bodyMesh, name: 'ZombieBody'}];
  const death = solveStrainerDeath(rig, skel, solveSet, regionFloorReport);
  const deathContact = regionFloorReport(rig, skel, solveSet, realize(rig, deathFinal(death.hipsY, death.tune)));
  console.log('  death', JSON.stringify({tune: death.tune, hipsY: r4(death.hipsY), contact: deathContact}));
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, {deathHipsY: death.hipsY, deathTune: death.tune}));
  const guarded = {};
  for (const c of clips) if (['Attack', 'Hit', 'Death'].includes(c.name)) guarded[c.name] = floorGuard(rig, skel, bodyMesh, c);
  console.log('  floor guard', JSON.stringify(guarded));

  console.log('[5/7] verify');
  const footVerts = {L: [], R: []};
  for (let i = 0; i < bodyW.joints.length / 4; i++) { const j = JOINT_NAMES[bodyW.joints[i * 4]]; if (j === 'L_Foot') footVerts.L.push(i); else if (j === 'R_Foot') footVerts.R.push(i); }
  const floor = verifyFloor(rig, skel, bodyMesh, clips, footVerts);
  console.log('  floor', JSON.stringify(floor));
  const skate = verifySkate(rig, skel, bodyMesh, clips, footVerts);
  console.log('  skate', JSON.stringify(skate));
  const attack = attackMetrics(rig, skel, weld, sw, clips.find(c => c.name === 'Attack'));
  console.log('  attack', JSON.stringify({hit: attack.hit, max: attack.maxReachR, crossing: attack.centreLineCrossingR}));
  const clearance = clearanceAudit(rig, skel, weld, sw, clips);
  console.log('  clearance', JSON.stringify(Object.fromEntries(['armsVsTorso', 'thighsVsTorso', 'clawsVsLegs'].map(k => [k, Object.fromEntries(Object.entries(clearance[k]).map(([c, v]) => [c, [v.maxDepthM, v.maxVertsDeeperThan1cm, v.worstT]]))]))));
  const poses = auditPoses(clips, {every: 3});
  const st = triangleStretch({pos: low.pos, idx: m.idx, joints: bodyW.joints, weights: bodyW.weights}, skel, rig, poses);
  const stretch = stretchStats(st.worst, poses, st.at, {ratio: 3});
  console.log('  stretch', JSON.stringify(stretch));
  if (ARGS.has('--no-write')) { console.log('dev run: nothing written'); return; }

  console.log('[6/7] textures');
  const base = await sharp(imgs.base.bytes).resize(OPTIONS.textures.baseColor, OPTIONS.textures.baseColor, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.base, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mr = await sharp(imgs.mr.bytes).resize(OPTIONS.textures.metallicRoughness, OPTIONS.textures.metallicRoughness, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.mr, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const normal = await sharp(imgs.normal.bytes).resize(OPTIONS.textures.normal, OPTIONS.textures.normal, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const mrStats = (await sharp(imgs.mr.bytes).stats()).channels.map(c => ({min: c.min, max: c.max, mean: +c.mean.toFixed(1)}));
  console.log('  bytes base', base.length, 'mr', mr.length, 'normal', normal.length);

  console.log('[7/7] GLB + sidecar');
  const bb = bounds(low.pos);
  const clipMeta = Object.fromEntries(clips.map(c => { const S = CLIP_SPECS[c.name]; return [c.name, {duration: S.duration, loop: S.loop, frames: c.times.length, ...(S.groundSpeed ? {groundSpeed: S.groundSpeed} : {}), ...(S.impactTime ? {impactTime: S.impactTime} : {})}]; }));
  const deathClip = clips.find(c => c.name === 'Death');
  const dp = skinPositions(bodyMesh, skel, rig.fk(poseAt(deathClip, deathClip.times.length - 1))), db = bounds(dp);
  const extras = {
    version: 1, archetype: 'strainer', task: TASK, heightM: r4(skel.H), joints: JOINT_NAMES, bodyMesh: 'StrainerBody',
    sourceSha256: SOURCE.sha256, meshyTaskId: SOURCE.taskId,
    headCenter: hit.headSphere.center, headRadius: hit.headSphere.radius, head: {bone: 'Head', offset: hit.headSphere.offset, radiusMax: hit.headSphere.radiusMax},
    attackHitTime: CLIP_SPECS.Attack.impactTime, reachM: attack.hit.reachM,
    attack: {hitTime: CLIP_SPECS.Attack.impactTime, duration: CLIP_SPECS.Attack.duration, reachM: attack.hit.reachM, reachR: attack.hit.reachR, reachL: attack.hit.reachL, clawTipR: attack.hit.clawTipR, clawTipL: attack.hit.clawTipL, frontMostR: attack.hit.frontMostR, maxReachR: attack.maxReachR, centreLineCrossingR: attack.centreLineCrossingR, swingArm: 'R'},
    clipDurations: Object.fromEntries(clips.map(c => [c.name, CLIP_SPECS[c.name].duration])),
    clips: clipMeta,
    hitRadii: (({headSphere, ...h}) => h)(hit), radius: OPTIONS.collider.radius, footprint: foot,
    boundsM: {min: r3(bb.min), max: r3(bb.max)}, deathPoseBoundsM: {min: r3(db.min), max: r3(db.max)},
    note: 'Rigged derivative of the accepted Meshy T2.5 Strainer (image-to-3D of the approved front T-pose); NEW 18-joint skeleton / skin / procedural clips; offsets in model metres at actor scale 1 (bind frame = model frame, identity bind rotations); unapproved, gameReady false.',
  };
  const doc = buildDocument({skel, body: bodyMesh, clips, extras, tex: {base, mr, normal, doubleSided: imgs.doubleSided}});
  fs.mkdirSync(path.dirname(OUT_GLB), {recursive: true});
  await writeDoc(doc, guardOutput(OUT_GLB));
  const outBytes = fs.statSync(OUT_GLB).size, outSha = sha256File(OUT_GLB);
  if (sha256File(SOURCE.file) !== SOURCE.sha256) throw new Error('SOURCE CHANGED during the build');
  const J = skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(V.len(V.sub(J[n], J[p])))]));
  const manifest = {
    schema: 'the-last-line/derivative-manifest@1', asset: 'enemy-strainer', title: 'Strainer (tall clawed drain-filter stalker) - rigged runtime derivative of the accepted Meshy T2.5 model (prototype)',
    task: TASK, lane: 'ASSET', date: '2026-11-01', generatedBy: 'tools/asset-pipeline/enemy/build-strainer.mjs', builtAt: new Date().toISOString(), buildSeconds: Math.round((Date.now() - t0) / 1000),
    status: {approved: false, gameReady: false, stage: 'unapproved prototype derivative; art / anatomy / deformation / gameplay fit not certified', licenseClearance: 'none - a derivative of an AI generation (Meshy, conditioned on a Codex-generated image); access to it grants no licence, commercial or production clearance'},
    honesty: {sourceHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming / hierarchy of the zombie wardrobe) and automatic skin weights created by this CPU pipeline', animation: 'hand-authored procedural keyframes / gait functions (lib/strainer-clips.mjs) sampled with this body\'s own joint positions - NOT motion capture', textures: 'the provider\'s own generated maps, resized / re-encoded only (no painting, no new artwork)', generation: 'no AI generation, inference, model download or network service was used by this builder; the Meshy model was generated earlier by the task primary (ledger below)'},
    provenance: 'generated (Meshy T2.5 image-to-3D, smart topology, t-pose, 2K PBR, from the project\'s own user-approved Codex-generated front T-pose) + local derivative work',
    source: {file: rel(SOURCE.file), sha256Verified: SOURCE.sha256, bytes: fs.statSync(SOURCE.file).size, readOnly: true, rawKeptOutsideGit: 'reference/ (external, ignored) - the raw GLB, its provider maps and the input image are not modified or shipped', triangles: m.triangles, vertices: m.vertices, material: m.material, doubleSided: imgs.doubleSided,
      textures: {baseColor: [...imgs.base.size, imgs.base.mime, imgs.base.bytes.length], metallicRoughness: [...imgs.mr.size, imgs.mr.mime, imgs.mr.bytes.length], normal: [...imgs.normal.size, imgs.normal.mime, imgs.normal.bytes.length]}, metallicRoughnessChannelStats: mrStats,
      inputImageVerified: inputVerified,
      meshy: {...meshy, provider: 'Meshy image-to-3D (meshy_image_to_3d)', aiModel: meshy.settings.ai_model, smartTopology: meshy.settings.model_type === 'smart-topology'}},
    outputs: {glb: {path: rel(OUT_GLB), bytes: outBytes, sha256: outSha, format: 'glTF 2.0 binary; KHR_mesh_quantization (NORMAL int8 normalized; required); JPEG textures; JOINTS_0 u8 / WEIGHTS_0 normalized u8; one SkinnedMesh node'},
      textures: {baseColor: {size: OPTIONS.textures.baseColor, format: 'JPEG 4:2:0', quality: OPTIONS.textures.quality.base, bytes: base.length, edits: 'none (re-encode only)'}, metallicRoughness: {size: OPTIONS.textures.metallicRoughness, format: 'JPEG 4:4:4 (source packed map: G roughness, B metallic; resized)', quality: OPTIONS.textures.quality.mr, bytes: mr.length}, normal: {size: OPTIONS.textures.normal, format: 'JPEG 4:4:4 tangent-space (source map resized; glTF convention, no tangents: three.js derivative tangents)', quality: OPTIONS.textures.quality.normal, bytes: normal.length}}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: r4(skel.H), bindPose: 'the generated T-pose (arms ~44 deg below horizontal, slightly bent knees, head / crown hunched forward)', bindRotations: 'identity (bone frames aligned with model space)'},
    placement: {...plRest, nativeBounds: {min: r4(nativeBounds.min), max: r4(nativeBounds.max)}, boundsM: extras.boundsM, sizeM: r3([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]])}, facing: fd,
    landmarks: cloud.stats,
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends: skel.ends, boneLengthsM, validationIssues: issues, options: SKELETON_OPTIONS,
      validationNote: 'the anthropometric ranges of autorig.validateSkeleton are for ordinary adults; this creature is deliberately long-shinned with wide-set shoulders and long forearms (out-of-range ratios are the generated proportions, not a detection failure: see the joint overlay render)', estimation: skel.log},
    skinning: {method: 'zombie/lib/skin.mjs region classification + chain weights + masked Laplacian smoothing on the welded source mesh (UV-seam copies share weights), + lateral Neck / Head fade, + jaw / rib-cage junction diffusion, + loose strands follow their roots', neckLateralFade: lateral, jawJunction: junction, strands, ...sw.stats},
    mesh: {node: 'StrainerBody', vertices: low.pos.length / 3, triangles: m.idx.length / 3, weldedVertices: weld.pos.length / 3, mainBodyWeldedVertices: split.mainVertices, looseStrandComponents: split.strands.length, geometryHash: geometryHash(low.pos, m.idx), note: 'the Meshy smart-topology mesh and UVs unchanged (placed: uniform scale + translation); no simplification / re-UV / re-bake'},
    profile: {heightM: profile.heightM, landmarks: profile.landmarks, limb: profile.limb, head: profile.head, torso: profile.torso},
    clips: {method: 'hand-authored procedural keyframes / gait functions (lib/strainer-clips.mjs) at 30 fps, legs by foot-planting IK (zombie/lib/pose.mjs); not motion capture', fps: FPS, meta: clipMeta,
      runtime: {attackDuration: CLIP_SPECS.Attack.duration, attackImpact: CLIP_SPECS.Attack.impactTime, attackHitTime: CLIP_SPECS.Attack.impactTime, attackReachM: attack.hit.reachM, walkGroundSpeed: CLIP_SPECS.Walk.groundSpeed, runGroundSpeed: CLIP_SPECS.Run.groundSpeed,
        note: 'ZombieStats.attackDuration / attackImpact should match Attack (the right claw sweeps through the front at chest height at attackHitTime; reachM = horizontal root -> claw tip at that frame, actor scale 1); locomotion clips are authored in place for groundSpeed at timeScale 1 (ai/zombieActor.ts scales by speed / (groundSpeed x actor scale), clamped 0.35..1.8)'},
      deathSolve: {method: 'lib/strainer-clips.mjs solveStrainerDeath (zombie/lib/clipsolve.mjs coordinate descent + cost on regionFloorReport, Strainer ranges)', ranges: death.ranges, tune: death.tune, hipsY: r4(death.hipsY), cost: +death.cost.toExponential(3), evals: death.evals, contact: deathContact, solvedAgainst: 'body'}, floorGuard: {method: 'per frame: Hips raised so the lowest CPU-skinned vertex stays >= 5 mm above the floor (Attack / Hit / Death)', clips: guarded}},
    verification: {cpuSkinningFloor: floor, footSkate: skate, clearance, attack, motionStretch: {...stretch, method: 'per triangle: worst edge length ratio posed / bind over every 3rd frame of all six clips (CPU skinning)'}},
    hit: {radii: (({headSphere, ...h}) => h)(hit), headSphere: hit.headSphere, collider: foot.collider, footprint: foot, heightM: r4(skel.H), notes: ['ai/zombieActor.ts updateVolumes: head sphere (r head), torso capsule Hips->Neck (r torso), limb capsules UpperArm->Hand (r arm), Thigh->Foot (r leg); the headshot sphere (bone Head + offset, radius) covers the forward-hunched crown / face cage that a sphere at the Head joint would miss', 'all values in model metres at actor root scale 1 (multiply by the runtime scale)']},
    runtime: {modelKey: 'enemy_strainer', url: 'assets/models/enemy-strainer.glb', extras: 'gltf.scene.userData.enemyStrainer', meshes: {body: 'StrainerBody'}, bones: 'same 18 names as the zombie bodies (ai/zombieActor.ts BONES all present)'},
    limitations: [
      'Automatic approximate skin weights on a low-poly (20.5 k triangle) source: LBS volume loss at shoulders / elbows / knees in strong poses; no finger / claw / jaw bones (the claws move rigidly with the Hand; the "twitch" is wrist / forearm motion).',
      'The loose fronds / grille strands are rigid with the body part they hang from (no secondary motion / physics); in poses far from the bind (arms hanging) the arm fronds no longer hang vertically.',
      'Procedural (not mocap) clips; no facial rig.',
      'Hidden-side geometry and texture of the source are AI-generated (Meshy); the texture atlas has dilation streaks in unused space.',
      'The hunched crown overhangs the motor collider forward and the hanging claws swing outside it (visual brushing of door jambs, no collision change).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ],
    rebuild: 'flock /tmp/r4-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-strainer.mjs && node tools/asset-pipeline/enemy/qa/strainer-sheets.mjs --out /tmp/r4qa/strainer',
  };
  fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
  fs.writeFileSync(guardOutput(OUT_JSON), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`done: ${rel(OUT_GLB)} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await main();
