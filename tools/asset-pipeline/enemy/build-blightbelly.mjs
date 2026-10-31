#!/usr/bin/env node
// The Last Line - BLIGHTBELLY enemy derivative builder (task track1-siren-blightbelly-20261031, lane RIGB). CPU only: no
// generation, inference, network or GPU. Single reproducible entry point (standalone, like creature/build-creature.mjs):
//   flock /tmp/track1-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-blightbelly.mjs [--no-write]
//   QA sheets:  node tools/asset-pipeline/enemy/qa/blightbelly-sheets.mjs   (renders the WRITTEN GLB)
// Reads the READ-ONLY accepted Meshy T2.5 Blightbelly (text-to-3D a2 preview 01a18f47... + 2K PBR refine 01a18f48...,
// reference/tasks/track1-siren-blightbelly-20261031/meshy/raw/a2-refine/model.glb, sha256-pinned + re-verified after the build)
// and writes ONLY:
//   game/public/assets/models/enemy-blightbelly.glb
//   game/public/assets/derivatives/enemy-blightbelly.json
// It does NOT touch the zombie wardrobe (no BODIES entry, no outfit rewrites; never picked as an ordinary zombie body).
//
// Pipeline (reusing the humanoid libs in tools/asset-pipeline/zombie/lib unchanged):
//   1. placement: facing (autorig.detectFacing), uniform scale to OPTIONS.heightM, feet midpoint at the origin, +Z facing;
//   2. landmarks: the low-poly source is densified (lib/densify.mjs, same surface) for the slice-based joint estimation
//      (lib/skeleton.mjs detectSkeleton, the shared 18-joint skeleton) after dropping thin cloth-detail slice fragments
//      below the hands from the LANDMARK point cloud only; the glenohumeral joints are refined from the shoulder top profile
//      (the obese trapezius slope fooled the generic acromion rule);
//   3. mesh: the Meshy smart-topology mesh and its own UVs / 2K PBR maps are KEPT (no simplify / re-UV / re-bake: no quality
//      loss); textures re-encoded for size (base colour 2048 JPEG with inflamed halos painted round the new pustules,
//      metallic-roughness + normal 1024 JPEG);
//   4. skin: lib/skin.mjs region flood + chain weights + masked Laplacian smoothing (welded), then the belly overhang in
//      front of the hip joints is faded off the thigh chain (a lifted thigh must not drag the belly), top 4;
//   5. pustules: lib/pustules.mjs seeded rig-bound domes (second SkinnedMesh on the same skin) + burst points;
//   6. clips: lib/blightbelly-clips.mjs (Idle, Walk, Run, Attack, Hit, Death; heavy timing), death pose floor-solved
//      against body + pustules (zombie/lib/clipsolve.mjs), floor guard on the one-shots, CPU-skinned verification (floor,
//      planted feet, arm / thigh vs belly clearance, triangle stretch);
//   7. GLB (gltf-transform; KHR_mesh_quantization normals) + scene extras `enemyBlightbelly` + sidecar provenance.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadSource} from '../zombie/lib/source.mjs';
import {detectFacing, placement, validateSkeleton, slimSkeleton, rigFor, bodyProfile} from '../zombie/lib/autorig.mjs';
import {placeHigh} from '../zombie/lib/stage-mesh.mjs';
import {densify} from '../zombie/lib/densify.mjs';
import {weldByPosition, bounds, normalizeAll} from '../zombie/lib/mesh.mjs';
import {bucketByHeight, clusterXZ} from '../zombie/lib/slices.mjs';
import {detectSkeleton, JOINTS} from '../zombie/lib/skeleton.mjs';
import {computeSkinWeights, JOINT_NAMES} from '../zombie/lib/skin.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {solveDeathPose, regionFloorReport} from '../zombie/lib/clipsolve.mjs';
import {realize, deathFinal} from '../zombie/lib/clips.mjs';
import {Rig, V} from '../zombie/lib/pose.mjs';
import {quantizeWeights, writeDoc, geometryHash} from '../zombie/lib/variant-glb.mjs';
import {auditPoses, triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {TriGrid} from '../zombie/lib/penetration.mjs';
import {CLIP_SPECS, sampleClip, poseAt, FPS} from './lib/blightbelly-clips.mjs';
import {buildPustules, colourClass, pustuleTexture, paintHalos} from './lib/pustules.mjs';

const ARGS = new Set(process.argv.slice(2));
const TASK = 'track1-siren-blightbelly-20261031';
const TASK_DIR = path.join(REPO, 'reference/tasks', TASK);
const GENERATOR = 'The Last Line Blightbelly enemy derivative builder (tools/asset-pipeline/enemy/build-blightbelly.mjs)';
const OUT_GLB = path.join(REPO, 'game/public/assets/models/enemy-blightbelly.glb');
const OUT_JSON = path.join(REPO, 'game/public/assets/derivatives/enemy-blightbelly.json');

/** The accepted Meshy T2.5 refine (primary; meshy/ledger.jsonl), pinned. */
export const SOURCE = {
  id: 'blightbelly-a2-refine', file: path.join(TASK_DIR, 'meshy/raw/a2-refine/model.glb'), sha256: '478b2b338ceaf98ffa57ad37796744f64365b74b5ea8d935813b21b77e0346a5', bytes: 8704376,
  ledger: path.join(TASK_DIR, 'meshy/ledger.jsonl'), previewTaskId: '01a18f47-ef88-70c2-add2-230a05fe5cd1', refineTaskId: '01a18f48-a0cd-744a-83e4-92ffccf69b39',
};

export const OPTIONS = {
  heightM: 1.85, // obese, large: taller than the 1.65-1.80 m wardrobe bodies (runtime root scale multiplies)
  landmarks: {densifyFrac: 0.0045, junkBelowY: 0.72, junkFraction: 0.15},
  shoulder: {medial: 0.02, below: 0.05, profileZBand: 0.06},
  skin: {smoothIters: 4, smoothLambda: 0.5, maxInfluences: 4},
  bellyThighFade: {start: 0.06, end: 0.16, rampY: 0.14, note: 'torso-region vertices whose z is start..end m IN FRONT of the hip joints lose their thigh-chain weight to Hips (smoothstep), ramped in over rampY m above the crotch line'},
  // base colour keeps the source 2K (most of the visible detail); normal / metallic-roughness at 1K with full chroma (4:4:4: the
  // X / Y of a normal map and the R / G / B of an MR map live in the chroma a 4:2:0 JPEG would halve) — ~2 MB GLB in total
  textures: {baseColor: 2048, metallicRoughness: 1024, normal: 1024, quality: {base: 88, mr: 88, normal: 92}},
  pustules: {
    seed: 0xB11687, minSpacing: 0.15, mainR: [0.026, 0.04], satellites: [2, 4], satR: [0.42, 0.72], satDist: [1.45, 2.3], heightK: [0.38, 0.6],
    rings: 3, segments: 10, sink: 0.3, variants: 4, prefer: {skin: 3, boil: 10, cloth: 0.2}, satelliteNever: ['dark'],
    quotas: [
      // no Hips quota: below the shirt the Hips skin is the trousers (and the buttocks); the arms / shoulders / chest carry most
      {bone: 'Chest', n: 5, sides: [1, -1], front: [1, 1, -1, -1, 1]},
      {bone: 'Spine', n: 3, sides: [1, -1], front: [1, 1, -1], frontBias: 0.05},
      {bone: 'L_UpperArm', n: 4, lateral: 0.05, minSpacing: 0.11},
      {bone: 'R_UpperArm', n: 4, lateral: 0.05, minSpacing: 0.11},
    ],
    halo: {reach: 1.8, strength: 0.45, colour: [150, 44, 38]},
  },
  // motor collider: covers the torso / belly footprint (arms swing outside it); must pass the game's narrowest walk-through
  // openings (2-cell doors = 1.0 m in the 0.5 m grid; gen/office, gen/station connect(.., 2, ..))
  collider: {radius: 0.42, narrowestOpeningM: 1.0},
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const r3 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(3)) : +(+v).toFixed(3);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const rel = f => path.relative(REPO, f);

function guardOutput(file) {
  const r = rel(path.resolve(file));
  if (![rel(OUT_GLB), rel(OUT_JSON)].includes(r)) throw new Error('refusing to write outside the Blightbelly derivative outputs: ' + r);
  return file;
}

function readLedger() {
  const rows = fs.readFileSync(SOURCE.ledger, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const res = stage => rows.find(r => r.kind === 'result' && r.stage === stage);
  const intent = stage => rows.find(r => r.kind === 'intent' && r.stage === stage);
  const pv = res('a2-preview'), rf = res('a2-refine');
  if (!pv || !rf || pv.taskId !== SOURCE.previewTaskId || rf.taskId !== SOURCE.refineTaskId || rf.sha256 !== SOURCE.sha256) throw new Error('ledger does not match the pinned source');
  const a1 = res('a1-preview');
  return {
    ledger: rel(SOURCE.ledger), model: intent('a2-preview').settings.ai_model, modelType: intent('a2-preview').settings.model_type,
    preview: {taskId: pv.taskId, status: pv.status, credits: pv.consumedCredits, sha256: pv.sha256, bytes: pv.bytes, prompt: intent('a2-preview').settings.prompt, settings: (({prompt, ...s}) => s)(intent('a2-preview').settings), qc: pv.qc, t25Evidence: pv.t25Evidence},
    refine: {taskId: rf.taskId, status: rf.status, credits: rf.consumedCredits, inheritsPreview: rf.inheritsPreview, sha256: rf.sha256, bytes: rf.bytes, texturePrompt: intent('a2-refine').settings.texture_prompt, settings: (({texture_prompt, ...s}) => s)(intent('a2-refine').settings), textures: rf.textures, qc: rf.qc},
    rejectedAttempt: a1 && {stage: 'a1-preview', taskId: a1.taskId, credits: a1.consumedCredits, qc: a1.qc},
    ledgerTotal: rf.ledgerTotal, decision: rf.decision,
  };
}

/** Raw embedded images of the source material (normal map is not decoded by zombie/lib/source.mjs). */
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

/** Landmark point cloud: densified placed source, thin slice fragments below the hands removed (landmarks only). */
function landmarkCloud(m, pl) {
  const b = bounds(m.pos), H = b.max[1] - b.min[1];
  const d = densify(m, H * OPTIONS.landmarks.densifyFrac);
  const high = placeHigh({...m, pos: d.pos, nrm: d.nrm, uv: d.uv, idx: d.idx}, pl);
  const wh = weldByPosition(high.pos, high.nrm, high.idx);
  const pos = wh.pos;
  let top = 0; for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  const {buckets} = bucketByHeight(pos, 0, top + 0.01, 0.01);
  const drop = new Uint8Array(pos.length / 3);
  let dropped = 0;
  buckets.forEach((ids, k) => {
    if ((k + 0.5) * 0.01 > OPTIONS.landmarks.junkBelowY) return;
    const cl = clusterXZ(pos, ids, 0.02, 1), mx = Math.max(0, ...cl.map(c => c.count));
    for (const c of cl) if (c.count < OPTIONS.landmarks.junkFraction * mx) for (const i of c.ids) { drop[i] = 1; dropped++; }
  });
  const keep = [];
  for (let i = 0; i < drop.length; i++) if (!drop[i]) keep.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  return {pos: Float32Array.from(keep), stats: {densify: d.stats, weldedVertices: pos.length / 3, droppedFragmentVertices: dropped,
    method: `densified (max edge ${OPTIONS.landmarks.densifyFrac} x height) and welded; in every 1 cm slice below ${OPTIONS.landmarks.junkBelowY} m, XZ clusters smaller than ${OPTIONS.landmarks.junkFraction} x the slice's largest (thin pocket / belt / hem fragments of the low-poly source that the leg / crotch rule would read as legs) are left out of the LANDMARK point cloud only (the mesh keeps them)`}};
}

/**
 * Shoulder refinement: the generic acromion rule (skeleton.mjs: first sustained top-surface slope < -0.8 after the trapezius
 * plateau) stops on the obese trapezius slope, ~6 cm medial of the deltoid (joint inside the torso wall). Here the acromion is
 * the outer edge of the shoulder top = the steepest 1 cm drop of the same top-surface profile within 0.25 m outward of the
 * first detection; the joint stays OPTIONS.shoulder.below under it and .medial inward (skeleton.mjs offsets), z centred in the
 * shoulder slab. Elbow / wrist keep their limb-section estimates.
 */
function refineShoulders(pos, skel) {
  const n = pos.length / 3, out = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1, a = skel.arms[side], J0 = skel.joints[side + '_UpperArm'];
    const zc = J0[2], x0 = Math.abs(a.acromionPt[0]) - 0.04;
    const tops = [];
    for (let k = 0; k <= 30; k++) {
      const x = x0 + k * 0.01; let top = -Infinity;
      for (let i = 0; i < n; i++) {
        if (Math.abs(sg * pos[i * 3] - x) > 0.005 || Math.abs(pos[i * 3 + 2] - zc) > OPTIONS.shoulder.profileZBand) continue;
        const y = pos[i * 3 + 1]; if (y < skel.neckBaseY && y > top) top = y;
      }
      tops.push({x, top});
    }
    let best = null;
    for (let k = 0; k < tops.length - 1; k++) {
      if (!Number.isFinite(tops[k].top) || !Number.isFinite(tops[k + 1].top) || tops[k].x < Math.abs(a.acromionPt[0])) continue;
      const drop = tops[k].top - tops[k + 1].top;
      if (!best || drop > best.drop) best = {...tops[k], drop};
    }
    const jx = best.x - OPTIONS.shoulder.medial, jy = best.top - OPTIONS.shoulder.below;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { if (Math.abs(sg * pos[i * 3] - jx) > 0.01 || Math.abs(pos[i * 3 + 1] - jy) > 0.02) continue; z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
    out[side] = {joint: [sg * jx, jy, (z0 + z1) / 2], acromion: [sg * best.x, best.top], drop: best.drop, detected: J0, profile: tops.map(t => [r3(t.x), r3(t.top)])};
  }
  // symmetrise like skeleton.mjs (A-pose is symmetric)
  const L = out.L.joint, R = out.R.joint, x = (L[0] - R[0]) / 2, y = (L[1] + R[1]) / 2, z = (L[2] + R[2]) / 2;
  const ax = (out.L.acromion[0] - out.R.acromion[0]) / 2, ay = (out.L.acromion[1] + out.R.acromion[1]) / 2;
  skel.joints.L_UpperArm = r4([x, y, z]); skel.joints.R_UpperArm = r4([-x, y, z]);
  for (const s of ['L', 'R']) {
    const sg = s === 'L' ? 1 : -1;
    skel.arms[s].shoulder = skel.joints[s + '_UpperArm'];
    skel.arms[s].acromionPt = r4([sg * ax, ay, z]);
    skel.cut[s].T = r4([sg * ax, ay, skel.cut[s].T[2]]);
  }
  return {method: 'acromion = outer shoulder-top edge (steepest 1 cm drop of the top-surface profile within 0.25 m outward of the generic detection); joint 5 cm below / 2 cm medial (skeleton.mjs offsets), slab-centred z; symmetrised; shoulder cut plane T moved to it',
    raw: {L: {joint: r4(out.L.joint), acromion: r4(out.L.acromion), dropM: r4(out.L.drop), detected: out.L.detected}, R: {joint: r4(out.R.joint), acromion: r4(out.R.acromion), dropM: r4(out.R.drop), detected: out.R.detected}},
    result: {L_UpperArm: skel.joints.L_UpperArm, R_UpperArm: skel.joints.R_UpperArm}, profileL: out.L.profile};
}

/** Fade the thigh chain off the belly overhang (torso region above the crotch, in front of the hip joints). */
function bellyThighFade(weld, sw, skel) {
  const LEG = new Set(['L_Thigh', 'R_Thigh', 'L_Shin', 'R_Shin', 'L_Foot', 'R_Foot'].map(n => JOINT_NAMES.indexOf(n)));
  const HIPS = JOINT_NAMES.indexOf('Hips');
  const zHip = skel.joints.L_Thigh[2], {start, end} = OPTIONS.bellyThighFade;
  let changed = 0, moved = 0;
  for (let i = 0; i < weld.pos.length / 3; i++) {
    if (sw.region[i] !== 0) continue;
    // ramped in above the crotch line so the thigh-top / belly-underside junction stays a smooth blend (no tearing seam)
    const f = 1 - smooth(skel.crotchY, skel.crotchY + OPTIONS.bellyThighFade.rampY, weld.pos[i * 3 + 1]) * smooth(start, end, weld.pos[i * 3 + 2] - zHip);
    if (f >= 1) continue;
    const m = new Map();
    let rem = 0;
    for (let k = 0; k < 4; k++) {
      const j = sw.joints[i * 4 + k], w = sw.weights[i * 4 + k];
      if (w <= 0) continue;
      const keep = LEG.has(j) ? w * f : w;
      rem += w - keep;
      m.set(j, (m.get(j) || 0) + keep);
    }
    if (rem <= 1e-6) continue;
    m.set(HIPS, (m.get(HIPS) || 0) + rem);
    const top = [...m.entries()].filter(e => e[1] > 1e-4).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const s = top.reduce((a, e) => a + e[1], 0);
    for (let k = 0; k < 4; k++) { sw.joints[i * 4 + k] = top[k] ? top[k][0] : 0; sw.weights[i * 4 + k] = top[k] ? top[k][1] / s : 0; }
    sw.weights[i * 4] += 1 - (sw.weights[i * 4] + sw.weights[i * 4 + 1] + sw.weights[i * 4 + 2] + sw.weights[i * 4 + 3]);
    changed++; moved += rem;
  }
  return {verticesChanged: changed, weightMovedToHips: r4(moved), ...OPTIONS.bellyThighFade};
}

function spread(weldId, sw) {
  const n = weldId.length, joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

/** Mean colour of the base texture around a UV (5 x 5 texels). */
function texColour(tex, u, v) {
  const W = tex.width, H = tex.height, d = tex.data;
  const cx = Math.floor((u - Math.floor(u)) * W), cy = Math.floor((v - Math.floor(v)) * H);
  const s = [0, 0, 0]; let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = Math.min(W - 1, Math.max(0, cx + dx)), y = Math.min(H - 1, Math.max(0, cy + dy)), o = (y * W + x) * 4; s[0] += d[o]; s[1] += d[o + 1]; s[2] += d[o + 2]; n++; }
  return s.map(v => v / n);
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
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/** Hit radii (model metres, actor scale 1) measured on the welded bind mesh by skin region. */
function measureHit(weld, sw, skel, profile) {
  const J = skel.joints, P = weld.pos, n = P.length / 3;
  const spine = [J.Hips, J.Spine, J.Chest, J.Neck];
  const torso = [], belly = [], head = [];
  const bellyBand = [J.Spine[1] - 0.2, J.Spine[1] + 0.15];
  let bc = [0, 0, 0], bn = 0;
  for (let i = 0; i < n; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], r = sw.region[i];
    if (r !== 0) continue;
    if (p[1] > skel.neckBaseY + 0.04) { head.push(onPolyline(p, [J.Head, skel.ends.Head])); continue; }
    if (p[1] < skel.crotchY || p[1] > J.Neck[1]) continue;
    torso.push(onPolyline(p, spine));
    if (p[1] > bellyBand[0] && p[1] < bellyBand[1] && p[2] > J.Spine[2]) { bc = V.add(bc, p); bn++; }
  }
  bc = V.mul(bc, 1 / bn);
  // belly sphere: centre pushed forward to the middle of the front half, radius = 85th pct of front-half distances to it
  const front = [];
  for (let i = 0; i < n; i++) { const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; if (sw.region[i] === 0 && p[1] > bellyBand[0] && p[1] < bellyBand[1] && p[2] > J.Spine[2]) front.push(V.len(V.sub(p, bc))); }
  const L = profile.limb;
  const hit = {
    head: r4(pct(head, 0.75)),
    torso: r4(pct(torso, 0.75)),
    arm: r4(((L.L_UpperArm.radius ?? 0.06) + (L.L_Forearm.radius ?? 0.05)) / 2 * 1.35),
    leg: r4(((L.L_Thigh.radius ?? 0.09) + (L.L_Shin.radius ?? 0.07)) / 2 * 1.4),
    belly: {bone: 'Spine', offset: r4(V.sub(bc, J.Spine)), r: r4(pct(front, 0.85))},
    torsoP90: r4(pct(torso, 0.9)),
    method: 'torso: 75th percentile distance of torso-region vertices (crotch..neck) to the Hips-Spine-Chest-Neck chain (capsule Hips->Neck in ai/zombieActor.ts updateVolumes); belly: sphere at the centroid of the front torso vertices in the Spine-0.20..+0.15 m band (offset from the Spine bone, bind frame = model frame), r = 85th pct; head: 75th pct distance above the neck base to the Head joint->top segment; limbs: autorig bodyProfile radii x1.35 (arm) / x1.4 (leg) like zombie/lib/hit.mjs (unclamped)',
  };
  return hit;
}

/** Footprint / door clearance from the bind mesh (torso + legs; arms reported separately). */
function footprint(weld, sw) {
  const P = weld.pos, n = P.length / 3;
  let torsoR = 0, armR = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const rs = [];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], z = P[i * 3 + 2], r = Math.hypot(x, z);
    if (sw.region[i] === 1 || sw.region[i] === 2) { armR = Math.max(armR, Math.abs(x)); continue; }
    torsoR = Math.max(torsoR, r); rs.push(r);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const R = OPTIONS.collider.radius, gap = OPTIONS.collider.narrowestOpeningM;
  return {torsoHalfWidthM: r3(Math.max(-x0, x1)), torsoFrontZ: r3(z1), torsoBackZ: r3(z0), torsoMaxRadiusM: r3(torsoR), torsoRadiusP95: r3(pct(rs, 0.95)), armOuterXM: r3(armR),
    collider: {radius: R, diameter: r3(2 * R), narrowestOpeningM: gap, clearancePerSideM: r3((gap - 2 * R) / 2),
      note: `motor circle radius ${R} m (ordinary zombie 0.33, coated 0.38): covers the torso / belly core (95th pct horizontal radius ${r3(pct(rs, 0.95))} m) and passes the narrowest walk-through openings (2-cell doors, 1.0 m in the 0.5 m nav grid) with ${r3((gap - 2 * R) / 2)} m per side; the swinging arms and the belly rim may visually brush door jambs (no collision)`}};
}

/** Lowest skinned point per frame (body + pustules) and planted-foot check for the loops. */
function verifyFloor(rig, skel, meshes, clips, footVerts) {
  const out = {};
  for (const c of clips) {
    const S = CLIP_SPECS[c.name];
    let lo = Infinity, iLo = 0, below = 0;
    const feet = {L: {minY: Infinity, stanceMaxY: -Infinity, stanceFrames: 0}, R: {minY: Infinity, stanceMaxY: -Infinity, stanceFrames: 0}};
    for (let f = 0; f < c.times.length; f++) {
      const world = rig.fk(poseAt(c, f));
      let m = Infinity;
      for (const mesh of meshes) { const P = skinPositions(mesh, skel, world); for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; }
      if (m < lo) { lo = m; iLo = f; }
      if (m < -0.01) below++;
      const P = skinPositions(meshes[0], skel, world);
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

/**
 * Clearance audit: posed arm (forearm / hand) and thigh vertices against the posed torso surface. Depth = how far a vertex lies
 * INSIDE the closest torso triangle (against its outward normal). Only vertices that are > `bindGap` from the torso in the bind
 * pose are tested (the limb roots are joined to the torso there).
 */
function clearanceAudit(rig, skel, weld, sw, clips, {every = 2} = {}) {
  const P0 = weld.pos, I = weld.idx, n = P0.length / 3;
  const torsoTris = [];
  for (let t = 0; t < I.length; t += 3) if (sw.region[I[t]] === 0 && sw.region[I[t + 1]] === 0 && sw.region[I[t + 2]] === 0 && Math.min(P0[I[t] * 3 + 1], P0[I[t + 1] * 3 + 1], P0[I[t + 2] * 3 + 1]) > skel.crotchY - 0.05) torsoTris.push(I[t], I[t + 1], I[t + 2]);
  const TI = Uint32Array.from(torsoTris);
  // outward sign per torso triangle from the bind vertex normals (the source winding is not trusted)
  const NW = weld.nrm, sgn = new Int8Array(TI.length / 3);
  for (let t = 0; t < TI.length / 3; t++) {
    const a = TI[t * 3] * 3, b = TI[t * 3 + 1] * 3, c = TI[t * 3 + 2] * 3;
    const fn = V.cross([P0[b] - P0[a], P0[b + 1] - P0[a + 1], P0[b + 2] - P0[a + 2]], [P0[c] - P0[a], P0[c + 1] - P0[a + 1], P0[c + 2] - P0[a + 2]]);
    sgn[t] = V.dot(fn, [NW[a] + NW[b] + NW[c], NW[a + 1] + NW[b + 1] + NW[c + 1], NW[a + 2] + NW[b + 2] + NW[c + 2]]) < 0 ? -1 : 1;
  }
  const bindGrid = new TriGrid(P0, TI, 0.04);
  const domName = i => JOINT_NAMES[sw.joints[i * 4]];
  const sets = {arms: [], thighs: []};
  for (let i = 0; i < n; i++) {
    const j = domName(i), r = sw.region[i];
    const isArm = (r === 1 || r === 2) && /_(Forearm|Hand)$/.test(j), isThigh = (r === 3 || r === 4) && /_Thigh$/.test(j);
    if (!isArm && !isThigh) continue;
    const h = bindGrid.closest(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2], 0.06);
    if (h && h.d < (isArm ? 0.03 : 0.06)) continue;
    sets[isArm ? 'arms' : 'thighs'].push(i);
  }
  const res = {arms: {}, thighs: {}};
  const mesh = {pos: P0, joints: sw.joints, weights: sw.weights};
  // 'Bind' = the unposed source (baseline: folds / creases the generated mesh already has)
  const bindClip = {name: 'Bind', times: [0], hips: [[0, 0, 0]], rot: {}};
  for (const c of [bindClip, ...clips]) {
    const acc = {arms: {maxDepth: 0, frames: 0, worstT: null, vertsOver1cm: 0}, thighs: {maxDepth: 0, frames: 0, worstT: null, vertsOver1cm: 0}};
    for (let f = 0; f < c.times.length; f += every) {
      const P = skinPositions(mesh, skel, rig.fk(poseAt(c, f)));
      const g = new TriGrid(P, TI, 0.04);
      for (const k of ['arms', 'thighs']) {
        let over = 0, md = 0;
        for (const i of sets[k]) {
          const h = g.closest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0.12);
          if (!h) continue;
          const a = TI[h.tri * 3] * 3, b = TI[h.tri * 3 + 1] * 3, cc = TI[h.tri * 3 + 2] * 3;
          const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[cc] - P[a], P[cc + 1] - P[a + 1], P[cc + 2] - P[a + 2]];
          const fn = V.mul(V.norm(V.cross(e1, e2)), sgn[h.tri]);
          const depth = -V.dot(V.sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], h.q.slice(0, 3)), fn);
          if (depth > 0.01) over++;
          if (depth > md) md = depth;
        }
        acc[k].frames++;
        if (md > acc[k].maxDepth) { acc[k].maxDepth = md; acc[k].worstT = c.times[f]; }
        acc[k].vertsOver1cm = Math.max(acc[k].vertsOver1cm, over);
      }
    }
    for (const k of ['arms', 'thighs']) res[k][c.name] = {maxDepthM: r4(acc[k].maxDepth), worstT: acc[k].worstT, maxVertsDeeperThan1cm: acc[k].vertsOver1cm, framesTested: acc[k].frames};
  }
  return {method: `every ${every}nd frame: CPU-skinned forearm / hand (resp. thigh) vertices that are clear of the torso in the bind pose (> 3 cm / 6 cm) vs the posed torso surface above the crotch; depth = distance behind the closest torso triangle along its outward normal (oriented by the bind vertex normals)`, testedVertices: {arms: sets.arms.length, thighs: sets.thighs.length}, ...res};
}

/** Floor guard for the one-shots: per frame, lift the Hips so the lowest skinned vertex stays >= 5 mm above the floor. */
function floorGuard(rig, skel, meshes, clip, minY = 0.005) {
  let maxLift = 0, frames = 0;
  for (let f = 0; f < clip.times.length; f++) {
    const world = rig.fk(poseAt(clip, f));
    let mn = Infinity;
    for (const mesh of meshes) { const P = skinPositions(mesh, skel, world); for (let i = 1; i < P.length; i += 3) mn = Math.min(mn, P[i]); }
    if (mn < -0.002) { const lift = minY - mn; clip.hips[f] = [clip.hips[f][0], clip.hips[f][1] + lift, clip.hips[f][2]]; maxLift = Math.max(maxLift, lift); frames++; }
  }
  return {frames, maxLiftM: r4(maxLift)};
}

// ------------------------------------------------------------------------------------------------ GLB
function buildDocument({skel, body, pust, clips, extras, tex}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('Blightbelly').setExtras({enemyBlightbelly: extras});
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin('BlightbellySkin').setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor('BlightbellySkin_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  const acc = (type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
  const qn = nrm => { const q = new Int8Array(nrm.length); for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))); return q; };
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const texture = (name, img, mime) => doc.createTexture(name).setImage(img).setMimeType(mime);
  const bodyMat = doc.createMaterial('BlightbellyBodyMaterial').setBaseColorTexture(texture('Blightbelly_baseColor', tex.base, 'image/jpeg'))
    .setMetallicRoughnessTexture(texture('Blightbelly_metallicRoughness', tex.mr, 'image/jpeg')).setNormalTexture(texture('Blightbelly_normal', tex.normal, 'image/jpeg'))
    .setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(tex.doubleSided);
  const pustMat = doc.createMaterial('BlightbellyPustuleMaterial').setBaseColorTexture(texture('Blightbelly_pustules', tex.pustules, 'image/png'))
    .setMetallicFactor(0).setRoughnessFactor(0.38);
  const prim = (m, mat) => {
    const q = quantizeWeights(m.joints, m.weights);
    return doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', m.pos)).setAttribute('NORMAL', acc('VEC3', qn(m.nrm), true))
      .setAttribute('TEXCOORD_0', acc('VEC2', m.uv)).setAttribute('JOINTS_0', acc('VEC4', q.joints)).setAttribute('WEIGHTS_0', acc('VEC4', q.weights, true))
      .setIndices(acc('SCALAR', m.pos.length / 3 < 65536 ? Uint16Array.from(m.idx) : Uint32Array.from(m.idx)));
  };
  scene.addChild(doc.createNode('BlightbellyBody').setMesh(doc.createMesh('BlightbellyBody').addPrimitive(prim(body, bodyMat))).setSkin(skin).setExtras({slot: 'body'}));
  scene.addChild(doc.createNode('BlightbellyPustules').setMesh(doc.createMesh('BlightbellyPustules').addPrimitive(prim(pust, pustMat))).setSkin(skin).setExtras({slot: 'pustules'}));
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
  if (sha256File(SOURCE.file) !== SOURCE.sha256) throw new Error('source sha256 mismatch: ' + rel(SOURCE.file));
  const meshy = readLedger();
  console.log('[1/8] load + place');
  const m = await loadSource({id: SOURCE.id, file: SOURCE.file, sha256: SOURCE.sha256});
  const imgs = await sourceImages();
  const fd = detectFacing(m.pos);
  const pl = placement(m, OPTIONS.heightM, fd.facing);
  const low = placeHigh(m, pl);
  const {nativeBounds, ...plRest} = pl;
  console.log('  facing', fd.facing, 'scale', pl.scale.toFixed(4));

  console.log('[2/8] landmarks + skeleton');
  const cloud = landmarkCloud(m, pl);
  const skel = slimSkeleton(detectSkeleton(cloud.pos));
  const shoulder = refineShoulders(cloud.pos, skel);
  const issues = validateSkeleton(skel);
  console.log('  issues', JSON.stringify(issues), 'shoulders', JSON.stringify(shoulder.result));

  console.log('[3/8] skin');
  const weld = weldLow(low.pos, low.nrm, m.idx);
  const sw = computeSkinWeights(weld, rigFor(skel), {kind: 'body', ...OPTIONS.skin});
  const fade = bellyThighFade(weld, sw, skel);
  const bodyW = spread(weld.weldId, sw);
  const profile = bodyProfile(skel, weld, sw);
  const hit = measureHit(weld, sw, skel, profile);
  const foot = footprint(weld, sw);
  console.log('  regions', JSON.stringify(sw.stats.regionVertexCounts), 'fade', JSON.stringify(fade));
  console.log('  hit', JSON.stringify(hit), 'footprint', JSON.stringify(foot));

  console.log('[4/8] pustules');
  const firstUV = new Int32Array(weld.pos.length / 3).fill(-1);
  for (let i = 0; i < weld.weldId.length; i++) if (firstUV[weld.weldId[i]] < 0) firstUV[weld.weldId[i]] = i;
  const cls = Array.from(firstUV, i => colourClass(texColour(m.baseColor, m.uv[i * 2], m.uv[i * 2 + 1])));
  const pz = buildPustules(weld, sw, cls, skel, OPTIONS.pustules);
  console.log('  ', JSON.stringify(pz.stats), 'skipped', JSON.stringify(pz.skipped));
  const baseTex = {width: m.baseColor.width, height: m.baseColor.height, data: Uint8Array.from(m.baseColor.data)};
  const haloTexels = paintHalos(baseTex, {pos: low.pos, uv: m.uv, idx: m.idx}, pz.clusters, OPTIONS.pustules.halo);
  console.log('  halo texels', haloTexels);

  const bodyMesh = {name: 'BlightbellyBody', pos: low.pos, nrm: low.nrm, uv: m.uv, idx: m.idx, ...bodyW};
  const pustMesh = {name: 'BlightbellyPustules', ...pz.mesh};

  console.log('[5/8] clips');
  const rig = new Rig(skel);
  // (zombie/lib/clipsolve.mjs labels the mesh named 'ZombieBody' as the body, every other mesh as 'outfit.*')
  const solveSet = [{...bodyMesh, name: 'ZombieBody'}, pustMesh];
  const death = solveDeathPose(rig, skel, solveSet);
  const deathContact = regionFloorReport(rig, skel, solveSet, realize(rig, deathFinal(death.hipsY, death.tune)));
  console.log('  death', JSON.stringify({tune: death.tune, hipsY: r4(death.hipsY), contact: deathContact}));
  const clips = Object.keys(CLIP_SPECS).map(name => sampleClip(rig, name, {deathHipsY: death.hipsY, deathTune: death.tune}));
  const guarded = {};
  for (const c of clips) if (['Attack', 'Hit', 'Death'].includes(c.name)) guarded[c.name] = floorGuard(rig, skel, [bodyMesh, pustMesh], c);
  console.log('  floor guard', JSON.stringify(guarded));

  console.log('[6/8] verify');
  const footVerts = {L: [], R: []};
  for (let i = 0; i < bodyW.joints.length / 4; i++) { const j = JOINT_NAMES[bodyW.joints[i * 4]]; if (j === 'L_Foot') footVerts.L.push(i); else if (j === 'R_Foot') footVerts.R.push(i); }
  const floor = verifyFloor(rig, skel, [bodyMesh, pustMesh], clips, footVerts);
  console.log('  floor', JSON.stringify(floor));
  const clearance = clearanceAudit(rig, skel, weld, sw, clips);
  console.log('  clearance', JSON.stringify(clearance));
  const poses = auditPoses(clips, {every: 3});
  const st = triangleStretch({pos: low.pos, idx: m.idx, joints: bodyW.joints, weights: bodyW.weights}, skel, rig, poses);
  const stretch = stretchStats(st.worst, poses, st.at, {ratio: 3});
  console.log('  stretch', JSON.stringify(stretch));

  console.log('[7/8] textures');
  const base = await sharp(Buffer.from(baseTex.data), {raw: {width: baseTex.width, height: baseTex.height, channels: 4}}).removeAlpha().resize(OPTIONS.textures.baseColor, OPTIONS.textures.baseColor, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.base, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mr = await sharp(imgs.mr.bytes).resize(OPTIONS.textures.metallicRoughness, OPTIONS.textures.metallicRoughness, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.mr, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const normal = await sharp(imgs.normal.bytes).resize(OPTIONS.textures.normal, OPTIONS.textures.normal, {kernel: 'lanczos3'}).jpeg({quality: OPTIONS.textures.quality.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const pt = pustuleTexture(OPTIONS.pustules.variants);
  const pustPng = await sharp(Buffer.from(pt.data), {raw: {width: pt.width, height: pt.height, channels: 3}}).png({compressionLevel: 9}).toBuffer();
  const mrStats = (await sharp(imgs.mr.bytes).stats()).channels.map(c => ({min: c.min, max: c.max, mean: +c.mean.toFixed(1)}));
  console.log('  bytes base', base.length, 'mr', mr.length, 'normal', normal.length, 'pustules', pustPng.length);

  console.log('[8/8] GLB + sidecar');
  const bb = bounds(low.pos);
  const clipMeta = Object.fromEntries(clips.map(c => { const S = CLIP_SPECS[c.name]; return [c.name, {duration: S.duration, loop: S.loop, frames: c.times.length, ...(S.groundSpeed ? {groundSpeed: S.groundSpeed} : {}), ...(S.impactTime ? {impactTime: S.impactTime} : {}), ...(S.burstTime ? {burstTime: S.burstTime} : {})}]; }));
  const extras = {
    version: 1, archetype: 'blightbelly', task: TASK, heightM: r4(skel.H), joints: JOINT_NAMES, bodyMesh: 'BlightbellyBody', pustuleMesh: 'BlightbellyPustules',
    clips: clipMeta,
    hitRadii: hit, radius: OPTIONS.collider.radius, footprint: foot,
    boundsM: {min: r3(bb.min), max: r3(bb.max)}, deathPoseBoundsM: null,
    pustules: pz.burst.map(({bone, offset, r, normal}) => ({bone, offset, r, normal})),
    note: 'Rigged derivative of the accepted Meshy T2.5 Blightbelly (text-to-3D a2 preview + 2K PBR refine); NEW 18-joint skeleton / skin / procedural clips + procedural rig-bound pustules; offsets in model metres at actor scale 1 (bind frame = model frame, identity bind rotations); unapproved, gameReady false.',
  };
  // death-pose bounds (corpse footprint)
  const dw = rig.fk(poseAt(clips.find(c => c.name === 'Death'), clips.find(c => c.name === 'Death').times.length - 1));
  const dp = skinPositions(bodyMesh, skel, dw), db = bounds(dp);
  extras.deathPoseBoundsM = {min: r3(db.min), max: r3(db.max)};
  if (ARGS.has('--no-write')) { console.log('dev run: nothing written'); return; }
  const doc = buildDocument({skel, body: bodyMesh, pust: pustMesh, clips, extras, tex: {base, mr, normal, pustules: pustPng, doubleSided: imgs.doubleSided}});
  fs.mkdirSync(path.dirname(OUT_GLB), {recursive: true});
  await writeDoc(doc, guardOutput(OUT_GLB));
  const outBytes = fs.statSync(OUT_GLB).size, outSha = sha256File(OUT_GLB);
  if (sha256File(SOURCE.file) !== SOURCE.sha256) throw new Error('SOURCE CHANGED during the build');
  const J = skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(V.len(V.sub(J[n], J[p])))]));
  const manifest = {
    schema: 'the-last-line/derivative-manifest@1', asset: 'enemy-blightbelly', title: 'Blightbelly (obese pustule zombie) - rigged runtime derivative of the accepted Meshy T2.5 model (prototype)',
    task: TASK, lane: 'RIGB', generatedBy: 'tools/asset-pipeline/enemy/build-blightbelly.mjs', builtAt: new Date().toISOString(), buildSeconds: Math.round((Date.now() - t0) / 1000),
    status: {approved: false, gameReady: false, stage: 'unapproved prototype derivative; art / anatomy / deformation / gameplay fit not certified', licenseClearance: 'none - a derivative of an AI generation (Meshy); access to it grants no licence, commercial or production clearance'},
    honesty: {sourceHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming / hierarchy of the zombie wardrobe) and automatic skin weights created by this CPU pipeline', animation: 'hand-authored procedural keyframes / gait functions (lib/blightbelly-clips.mjs) sampled with this body\'s own joint positions - NOT motion capture', pustules: 'procedural geometry added by this builder (seeded), not part of the Meshy output', generation: 'no AI generation, inference, model download or network service was used by this builder; the Meshy model was generated earlier by the task primary (ledger below)'},
    provenance: 'generated (Meshy T2.5 text-to-3D, smart topology, 2K PBR refine) + local derivative work',
    source: {file: rel(SOURCE.file), sha256Verified: SOURCE.sha256, bytes: fs.statSync(SOURCE.file).size, readOnly: true, rawKeptOutsideGit: 'reference/ (external, ignored) - the raw GLB and its textures are not modified or shipped', triangles: m.triangles, vertices: m.vertices, material: m.material, doubleSided: imgs.doubleSided,
      textures: {baseColor: [...imgs.base.size, imgs.base.mime, imgs.base.bytes.length], metallicRoughness: [...imgs.mr.size, imgs.mr.mime, imgs.mr.bytes.length], normal: [...imgs.normal.size, imgs.normal.mime, imgs.normal.bytes.length]}, metallicRoughnessChannelStats: mrStats,
      meshy: {...meshy, provider: 'Meshy text-to-3D (meshy_text_to_3d preview + meshy_text_to_3d_refine)', aiModel: 'meshy-t2.5', smartTopology: true, renderQc: rel(path.join(TASK_DIR, 'meshy/a2-refine-vs-heavyset.png'))}},
    outputs: {glb: {path: rel(OUT_GLB), bytes: outBytes, sha256: outSha, format: 'glTF 2.0 binary; KHR_mesh_quantization (NORMAL int8 normalized; required); JPEG body textures, PNG pustule gradient; JOINTS_0 u8 / WEIGHTS_0 normalized u8; two SkinnedMesh nodes on one skin'},
      textures: {baseColor: {size: OPTIONS.textures.baseColor, format: 'JPEG', quality: OPTIONS.textures.quality.base, bytes: base.length, edits: `inflamed halos painted round the pustule domes (${haloTexels} texels)`}, metallicRoughness: {size: OPTIONS.textures.metallicRoughness, format: 'JPEG 4:4:4 (source packed map: G roughness, B metallic; resized)', quality: OPTIONS.textures.quality.mr, bytes: mr.length}, normal: {size: OPTIONS.textures.normal, format: 'JPEG 4:4:4 tangent-space (source map resized; glTF convention, no tangents: three.js derivative tangents)', quality: OPTIONS.textures.quality.normal, bytes: normal.length}, pustules: {size: [pt.width, pt.height], format: 'PNG gradient strip (apex -> rim, 4 variant rows)', bytes: pustPng.length}}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: r4(skel.H), bindPose: 'A-pose as generated (arms ~23 deg off vertical)', bindRotations: 'identity (bone frames aligned with model space)'},
    placement: {...plRest, nativeBounds: {min: r4(nativeBounds.min), max: r4(nativeBounds.max)}, boundsM: extras.boundsM, sizeM: r3([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]])}, facing: fd,
    landmarks: cloud.stats,
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends: skel.ends, boneLengthsM, validationIssues: issues,
      validationNote: 'the anthropometric ranges of autorig.validateSkeleton are for ordinary adults; this body is deliberately short-legged and obese (hip / thigh / shin ratios below range are the generated proportions, not a detection failure: see the joint overlay render)', shoulderRefinement: shoulder, estimation: skel.log},
    skinning: {method: 'zombie/lib/skin.mjs region classification + chain weights + masked Laplacian smoothing on the welded source mesh (UV-seam copies share weights), + belly thigh fade', bellyThighFade: fade, ...sw.stats},
    mesh: {node: 'BlightbellyBody', vertices: low.pos.length / 3, triangles: m.idx.length / 3, weldedVertices: weld.pos.length / 3, geometryHash: geometryHash(low.pos, m.idx), note: 'the Meshy smart-topology mesh and UVs unchanged (placed: uniform scale + translation); no simplification / re-UV / re-bake'},
    profile: {heightM: profile.heightM, landmarks: profile.landmarks, limb: profile.limb, head: profile.head, torso: profile.torso},
    pustules: {node: 'BlightbellyPustules', method: 'lib/pustules.mjs (seeded clusters on the welded body surface; per-dome skin weights copied from the surface point; halo painted into the base colour)', spec: OPTIONS.pustules, ...pz.stats, skipped: pz.skipped, burstPoints: pz.burst},
    clips: {method: 'hand-authored procedural keyframes / gait functions (lib/blightbelly-clips.mjs) at 30 fps, legs by foot-planting IK (zombie/lib/pose.mjs); not motion capture', fps: FPS, meta: clipMeta,
      runtime: {attackDuration: CLIP_SPECS.Attack.duration, attackImpact: CLIP_SPECS.Attack.impactTime, walkGroundSpeed: CLIP_SPECS.Walk.groundSpeed, runGroundSpeed: CLIP_SPECS.Run.groundSpeed, deathBurstTime: CLIP_SPECS.Death.burstTime,
        note: 'ZombieStats.attackDuration / attackImpact should match Attack; locomotion clips are authored in place for groundSpeed at timeScale 1 (ai/zombieActor.ts scales by speed / (groundSpeed x actor scale), clamped 0.35..1.8); Death swells to its peak at burstTime (a natural moment for the pustule burst; bursting at t = 0 also works)'},
      deathSolve: {tune: death.tune, hipsY: r4(death.hipsY), cost: +death.cost.toExponential(3), evals: death.evals, contact: deathContact, solvedAgainst: 'body + pustules'}, floorGuard: {method: 'per frame: Hips raised so the lowest CPU-skinned vertex (body + pustules) stays >= 5 mm above the floor (Attack / Hit / Death)', clips: guarded}},
    verification: {cpuSkinningFloor: floor, clearance, motionStretch: {...stretch, method: 'per triangle: worst edge length ratio posed / bind over every 3rd frame of all six clips (CPU skinning); body alone'}},
    hit: {radii: hit, collider: foot.collider, footprint: foot, heightM: r4(skel.H), notes: ['ai/zombieActor.ts updateVolumes: head sphere (r head), torso capsule Hips->Neck (r torso), limb capsules UpperArm->Hand (r arm), Thigh->Foot (r leg); the belly sphere is an optional extra volume (bone Spine + offset, r) for the forward bulge the capsule does not cover', 'all values in model metres at actor root scale 1 (multiply by the runtime scale)']},
    runtime: {modelKey: 'enemy_blightbelly', url: 'assets/models/enemy-blightbelly.glb', extras: 'gltf.scene.userData.enemyBlightbelly', meshes: {body: 'BlightbellyBody', pustules: 'BlightbellyPustules (hide / shrink after the burst)'}, bones: 'same 18 names as the zombie bodies (ai/zombieActor.ts BONES all present)'},
    limitations: [
      'Automatic approximate skin weights on a low-poly (21 k triangle) source: LBS volume loss at shoulders / elbows / hips in strong poses; the belly is rigid with Hips / Spine (no jiggle / secondary motion).',
      'Procedural (not mocap) clips; no facial rig, no finger / twist bones.',
      'Pustules are rigid domes riding the skin (no swelling animation); the burst itself is a runtime VFX (lane BLIGHT) at the exported burst points.',
      'Hidden-side geometry and texture of the source are AI-generated (Meshy); the texture atlas has dilation streaks in unused space.',
      'The obese silhouette is wider than the motor collider (arms / belly rim may brush door jambs in 1.0 m openings; no collision change).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ],
    rebuild: 'flock /tmp/track1-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-blightbelly.mjs && node tools/asset-pipeline/enemy/qa/blightbelly-sheets.mjs',
  };
  fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
  fs.writeFileSync(guardOutput(OUT_JSON), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`done: ${rel(OUT_GLB)} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await main();
