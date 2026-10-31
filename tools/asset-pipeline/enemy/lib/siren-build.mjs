// Task track1-siren-blightbelly-20261031 (lane RIGS): the appearance-locked Siren rig pipeline (library; the CLI is
// tools/asset-pipeline/enemy/build-siren.mjs). Given a body GLB and an optional dress GLB (each sha256-pinned, read-only):
//   1. placement: ONE uniform scale (to `heightM`), a Y rotation (0 / 180 from the feet) and a translation (feet midpoint to
//      the origin, soles on y = 0) -> M_body; nothing is baked into the vertices;
//   2. analysis copies (game space): dense surface samples, welded mesh, hair mask (base-colour luminance, analysis only);
//   3. skeleton: lib/tpose-skeleton.mjs (shared 18-joint names / hierarchy);
//   4. body weights (shared zombie skinning + hair post-pass), dress fit (lib/dress-fit.mjs: uniform scale + translation only)
//      and dress weights (shared closest-point transfer);
//   5. clips (lib/siren-clips.mjs) with floor solves (dormant knees / claws, prone death) and a per-frame floor guard;
//   6. assembly (lib/siren-glb.mjs) + proofs (lib/proof.mjs).
import {readSource, singlePrimitive, similarityMatrix, transformPositions, transformNormals, similarityScale, fingerprint} from './native-glb.mjs';
import {surfaceSamples, vertexLuminance, sampleAttribute} from './surface.mjs';
import {estimateSkeleton} from './tpose-skeleton.mjs';
import {weld, bodyWeights, dressWeights, spread, weightStats} from './siren-skin.mjs';
import {fitDress, pokeThrough} from './dress-fit.mjs';
import {SIREN_CLIPS, RUN_GAIT, sampleClip, poseAtFrame, dormantPose, evalClip} from './siren-clips.mjs';
import {assembleDocument} from './siren-glb.mjs';
import {detectFacing, bodyProfile} from '../../zombie/lib/autorig.mjs';
import {computeNormals, bounds} from '../../zombie/lib/mesh.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {Rig, V} from '../../zombie/lib/pose.mjs';
import {realize} from '../../zombie/lib/clips.mjs';
import {JOINT_NAMES} from '../../zombie/lib/skin.mjs';

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const GROUP = {head: ['Head', 'Neck'], torso: ['Chest', 'Spine'], pelvis: ['Hips'], armL: ['L_UpperArm', 'L_Forearm'], armR: ['R_UpperArm', 'R_Forearm'], handL: ['L_Hand'], handR: ['R_Hand'], legL: ['L_Thigh', 'L_Shin', 'L_Foot'], legR: ['R_Thigh', 'R_Shin', 'R_Foot']};
const groupOf = Object.fromEntries(Object.entries(GROUP).flatMap(([g, js]) => js.map(j => [JOINT_NAMES.indexOf(j), g])));

/** Placement of the body: uniform scale to heightM, facing +Z, feet midpoint at the origin, soles on y = 0. */
export function placeBody(nativePos, nodeWorld, heightM) {
  const P0 = transformPositions(nativePos, nodeWorld);
  const fd = detectFacing(P0);
  const b = bounds(P0), scale = heightM / (b.max[1] - b.min[1]), yawDeg = fd.facing < 0 ? 180 : 0;
  const P1 = transformPositions(nativePos, similarityMatrix({scale, yawDeg}, nodeWorld));
  const b1 = bounds(P1), L = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity}, R = {...L}, cx = (b1.min[0] + b1.max[0]) / 2;
  for (let i = 0; i < P1.length; i += 3) {
    if (P1[i + 1] - b1.min[1] > 0.04) continue;
    const s = P1[i] > cx ? L : R;
    s.x0 = Math.min(s.x0, P1[i]); s.x1 = Math.max(s.x1, P1[i]); s.z0 = Math.min(s.z0, P1[i + 2]); s.z1 = Math.max(s.z1, P1[i + 2]);
  }
  const t = [-((L.x0 + L.x1) / 2 + (R.x0 + R.x1) / 2) / 2, -b1.min[1], -((L.z0 + L.z1) / 2 + (R.z0 + R.z1) / 2) / 2];
  const M = similarityMatrix({scale, yawDeg, t}, nodeWorld);
  return {M, scale, yawDeg, t, facing: fd, nativeBounds: {min: r4(b.min), max: r4(b.max)}};
}

function regionLows(rig, skel, mesh, pose) {
  const P = skinPositions(mesh, skel, rig.fk(pose)), out = {};
  for (let i = 0; i < P.length / 3; i++) { const g = groupOf[mesh.joints[i * 4]]; if (!g) continue; out[g] = Math.min(out[g] ?? Infinity, P[i * 3 + 1]); }
  return {lows: out, P};
}
const minY = P => { let m = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };

/** Dormant floor solve: legs (knees / shins / feet) touch the floor; claws rest on it. */
function solveDormant(rig, skel, mesh, base = {hipsY: -0.40, armFlex: 10, hipsZ: -0.08}) {
  const D = {...base};
  const lows = () => regionLows(rig, skel, mesh, realize(rig, dormantPose({dormant: D}))).lows;
  for (let round = 0; round < 3; round++) {
    let L = lows();
    D.hipsY += 0.006 - Math.min(L.legL, L.legR);
    // claws: smallest elbow flex whose hand region stays >= 4 mm above the floor, as close to it as possible
    let best = null;
    for (let f = 0; f <= 110; f += 2) { D.armFlex = f; L = lows(); const h = Math.min(L.handL, L.handR); if (h >= 0.004 && (!best || h < best.h)) best = {f, h}; }
    D.armFlex = best ? best.f : 110;
  }
  const {lows: L, P} = regionLows(rig, skel, mesh, realize(rig, dormantPose({dormant: D})));
  return {hipsY: r4(D.hipsY), hipsZ: D.hipsZ, armFlex: D.armFlex, regionLowsM: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, r4(v)])), lowestY: r4(minY(P))};
}

/** Prone death: hips height so the lowest body point rests 8 mm above the floor (bisection). */
function solveDeath(rig, skel, mesh, ground) {
  let lo = -1.2, hi = 0, best = null;
  const at = hy => minY(skinPositions(mesh, skel, rig.fk(evalClip(rig, 'Death', SIREN_CLIPS.Death.duration, {deathHipsY: hy, ground}))));
  for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; const m = at(mid); best = {hipsY: mid, minY: m}; if (m > 0.008) hi = mid; else lo = mid; }
  const {lows} = regionLows(rig, skel, mesh, evalClip(rig, 'Death', SIREN_CLIPS.Death.duration, {deathHipsY: best.hipsY, ground}));
  return {hipsY: r4(best.hipsY), lowestY: r4(best.minY), regionLowsM: Object.fromEntries(Object.entries(lows).map(([k, v]) => [k, r4(v)]))};
}

/** Per frame: raise the Hips so the lowest skinned BODY point stays >= 5 mm above the floor. */
function floorGuard(rig, skel, mesh, clip) {
  let frames = 0, maxLift = 0;
  for (let f = 0; f < clip.times.length; f++) {
    const m = minY(skinPositions(mesh, skel, rig.fk(poseAtFrame(clip, f))));
    if (m < -0.002) { const lift = 0.005 - m; clip.hips[f] = [clip.hips[f][0], clip.hips[f][1] + lift, clip.hips[f][2]]; frames++; maxLift = Math.max(maxLift, lift); }
  }
  return {frames, maxLiftM: r4(maxLift)};
}

function verifyClips(rig, skel, body, dress, clips) {
  const out = {};
  for (const c of clips) {
    let bodyMin = Infinity, dressMin = Infinity, below = 0, dressBelowFrames = 0, dressBelowShareMax = 0, top = -Infinity;
    const box = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
    for (let f = 0; f < c.times.length; f++) {
      const W = rig.fk(poseAtFrame(c, f));
      const B = skinPositions(body, skel, W); const bm = minY(B); bodyMin = Math.min(bodyMin, bm); if (bm < -0.01) below++;
      for (let i = 0; i < B.length; i += 3) for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], B[i + k]); box.max[k] = Math.max(box.max[k], B[i + k]); }
      for (let i = 1; i < B.length; i += 3) top = Math.max(top, B[i]);
      if (dress) {
        const D = skinPositions(dress, skel, W); let dm = Infinity, nb = 0;
        for (let i = 1; i < D.length; i += 3) { if (D[i] < dm) dm = D[i]; if (D[i] < -0.005) nb++; }
        dressMin = Math.min(dressMin, dm); if (nb) dressBelowFrames++; dressBelowShareMax = Math.max(dressBelowShareMax, nb / (D.length / 3));
        for (let i = 0; i < D.length; i += 3) for (let k = 0; k < 3; k++) { box.min[k] = Math.min(box.min[k], D[i + k]); box.max[k] = Math.max(box.max[k], D[i + k]); }
      }
    }
    out[c.name] = {frames: c.times.length, bodyMinY: r4(bodyMin), bodyFramesBelowMinus1cm: below, topY: r4(top), maxLegReach: c.maxLegReach,
      ...(dress ? {dressMinY: r4(dressMin), dressMaxSinkBelowFloorM: r4(Math.max(0, -dressMin)), dressFramesWithVerticesBelowFloor: dressBelowFrames, dressMaxShareBelowFloor: r4(dressBelowShareMax)} : {}),
      boundsM: {min: r4(box.min), max: r4(box.max)}};
  }
  return out;
}

/** Hit radii from the shared body profile on NON-hair vertices (hair is not a hit target size). */
function hitRadii(skel, welded, sw, hairW) {
  const keep = []; for (let i = 0; i < welded.pos.length / 3; i++) if (!hairW || !hairW[i]) keep.push(i);
  const pos = new Float32Array(keep.length * 3), joints = new Uint16Array(keep.length * 4), weights = new Float32Array(keep.length * 4), region = new Int8Array(keep.length);
  keep.forEach((i, j) => { pos.set(welded.pos.subarray(i * 3, i * 3 + 3), j * 3); joints.set(sw.joints.subarray(i * 4, i * 4 + 4), j * 4); weights.set(sw.weights.subarray(i * 4, i * 4 + 4), j * 4); region[j] = sw.region[i]; });
  const prof = bodyProfile({...skel, armpitY: skel.armpitY}, {pos}, {joints, weights, region});
  return {...prof.hit, method: 'zombie/lib/autorig.mjs bodyProfile on non-hair body vertices (bind pose): head = mean half extents above the neck (clamped 0.11-0.17), torso = 0.25 x (chest width + depth) x 0.95 (0.15-0.30), limbs = mean measured radii x 1.35 (arm) / 1.4 (leg)', profile: {limb: prof.limb, head: prof.head, torso: prof.torso, landmarks: prof.landmarks}};
}

/**
 * Full pipeline. cfg: {body: {file, sha256, uploadId?, label}, dress?: {file, sha256, uploadId?, label}, heightM, hairLumMax (null = no hair mask),
 *   dressFit: {init: {s, t}, fixScale?, weights?}, skin: {smoothIters}, dressSkin: {thighMax, skirt}, generator}
 */
export async function buildSiren(cfg, log = () => {}) {
  const t0 = Date.now();
  const bodySrc = await readSource(cfg.body.file, cfg.body.sha256);
  const bp = singlePrimitive(bodySrc.doc, 'body');
  const bodyFp = fingerprint(bodySrc.doc);
  const native = {pos: bp.prim.getAttribute('POSITION').getArray(), nrm: bp.prim.getAttribute('NORMAL')?.getArray() ?? null, uv: bp.prim.getAttribute('TEXCOORD_0')?.getArray() ?? null, idx: bp.prim.getIndices()?.getArray()};
  if (!native.idx) throw new Error('body: non-indexed primitive (unsupported)');
  log(`[1] body ${bodySrc.sha256.slice(0, 12)}… ${native.pos.length / 3} verts / ${native.idx.length / 3} tris; placement`);
  const place = placeBody(native.pos, bp.world, cfg.heightM);
  similarityScale(place.M);
  const P = transformPositions(native.pos, place.M);
  const N = native.nrm ? transformNormals(native.nrm, place.M) : computeNormals(P, native.idx);
  const {welded, map} = await weld(P, N, native.idx);
  // hair mask (analysis only)
  let hairV = null, hairW = null;
  const bcTex = bp.prim.getMaterial()?.getBaseColorTexture();
  if (cfg.hairLumMax != null && bcTex && native.uv) {
    const lum = await vertexLuminance(bcTex.getImage(), native.uv);
    hairV = Float32Array.from(lum, l => l < cfg.hairLumMax ? 1 : 0);
    hairW = new Uint8Array(welded.pos.length / 3);
    for (let i = 0; i < map.length; i++) if (hairV[i]) hairW[map[i]] = 1;
  }
  const S = surfaceSamples(P, native.idx, cfg.sampleArea ?? 2e-5);
  const hairS = hairV ? sampleAttribute(S, native.idx, hairV) : null;
  log('[2] skeleton');
  const skel = estimateSkeleton(S.pts, hairS);
  log('[3] body weights');
  const sw = bodyWeights(welded, skel, hairW, cfg.skin ?? {});
  const bodyNative = spread(map, sw);
  const bodyMesh = {pos: welded.pos, joints: sw.joints, weights: sw.weights};

  // ---- dress ----
  let dress = null;
  if (cfg.dress) {
    log('[4] dress fit (uniform) + weights');
    const dressSrc = await readSource(cfg.dress.file, cfg.dress.sha256);
    const dp = singlePrimitive(dressSrc.doc, 'dress');
    const dpos0 = transformPositions(dp.prim.getAttribute('POSITION').getArray(), dp.world); // node frame (identity for the uploads)
    const didx = dp.prim.getIndices()?.getArray(); if (!didx) throw new Error('dress: non-indexed primitive (unsupported)');
    const DS = surfaceSamples(dpos0, didx, 1e-5);
    const skinIds = []; for (let i = 0; i < P.length / 3; i++) if (!hairV || !hairV[i]) skinIds.push(i);
    const skinSamples = []; for (let i = 0; i < S.pts.length / 3; i++) if (!hairS || hairS[i] < 0.5) skinSamples.push(S.pts[i * 3], S.pts[i * 3 + 1], S.pts[i * 3 + 2]);
    const fit = fitDress({pos: dpos0, idx: didx, samples: DS.pts}, {pos: P, nrm: N, testIds: skinIds, skinSamples: Float32Array.from(skinSamples)}, {...cfg.dressFit, floorClear: cfg.dressFit?.floorClear});
    const Md = similarityMatrix({scale: fit.s, t: fit.t}, dp.world);
    const DP = transformPositions(dp.prim.getAttribute('POSITION').getArray(), Md);
    const DN = dp.prim.getAttribute('NORMAL') ? transformNormals(dp.prim.getAttribute('NORMAL').getArray(), Md) : computeNormals(DP, didx);
    const dw = await weld(DP, DN, didx);
    const tw = dressWeights(dw.welded, welded, sw, skel, cfg.dressSkin ?? {});
    const {flags, ...fitReport} = fit.report; void flags;
    dress = {src: dressSrc, fp: fingerprint(dressSrc.doc), prim: dp.prim, M: Md, fit: {s: fit.s, t: fit.t, evaluations: fit.evaluations, init: fit.init, report: fitReport, initReport: (({flags: _f, ...r}) => r)(fit.initReport), weights: fit.weights, bands: fit.bands},
      pos: DP, idx: didx, welded: dw.welded, map: dw.map, weights: tw, native: spread(dw.map, tw), mesh: {pos: dw.welded.pos, joints: tw.joints, weights: tw.weights}};
  }

  // ---- clips ----
  log('[5] clips (floor solves, guard, verify)');
  const rig = new Rig(skel);
  // key ground solve: hips height so the lowest LEG (knee / shin / foot) point rests 6 mm above the floor (bisection)
  const groundLog = [];
  const ground = (P, which) => {
    let lo = P.hips[1] - 0.6, hi = P.hips[1] + 0.6;
    const low = hy => { const L = regionLows(rig, skel, bodyMesh, realize(rig, {...P, hips: [P.hips[0], hy, P.hips[2]]})).lows; return which === 'legs' ? Math.min(L.legL, L.legR) : Math.min(...Object.values(L)); };
    for (let it = 0; it < 26; it++) { const mid = (lo + hi) / 2; if (low(mid) > 0.006) hi = mid; else lo = mid; }
    groundLog.push({which, hipsY: r4(hi)});
    return hi;
  };
  const dormant = solveDormant(rig, skel, bodyMesh);
  const death = solveDeath(rig, skel, bodyMesh, ground);
  const ctx = {dormant, deathHipsY: death.hipsY, ground};
  const clips = Object.keys(SIREN_CLIPS).map(name => sampleClip(rig, name, ctx));
  const guarded = {};
  for (const c of clips) if (['Rise', 'Attack', 'Hit', 'Death'].includes(c.name)) guarded[c.name] = floorGuard(rig, skel, bodyMesh, c);
  const verify = verifyClips(rig, skel, bodyMesh, dress?.mesh ?? null, clips);
  // attack reach: right claw tip at impact, relative to the root (forward = +Z)
  const atk = clips.find(c => c.name === 'Attack');
  const fImpact = Math.round(SIREN_CLIPS.Attack.impactTime * 30);
  const Wimp = rig.fk(poseAtFrame(atk, fImpact));
  const handTip = side => { const w = Wimp[side + '_Hand']; const rel = V.sub(skel.ends[side + '_Hand'], skel.joints[side + '_Hand']); const q = w.rot, v = rel; const [x, y, z, ww] = q; const ix = ww * v[0] + y * v[2] - z * v[1], iy = ww * v[1] + z * v[0] - x * v[2], iz = ww * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return V.add(w.pos, [ix * ww + iw * -x + iy * -z - iz * -y, iy * ww + iw * -y + iz * -x - ix * -z, iz * ww + iw * -z + ix * -y - iy * -x]); };
  const clawR = handTip('R');

  // ---- extras ----
  const radii = hitRadii(skel, welded, sw, hairW);
  const dormantFrame = clips.find(c => c.name === 'Dormant');
  const Wd = rig.fk(poseAtFrame(dormantFrame, 0));
  const dB = skinPositions(bodyMesh, skel, Wd), dD = dress ? skinPositions(dress.mesh, skel, Wd) : null;
  const bb = arrs => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const A of arrs) if (A) for (let i = 0; i < A.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], A[i + k]); mx[k] = Math.max(mx[k], A[i + k]); } return {min: r4(mn), max: r4(mx)}; };
  const dormantBox = bb([dB, dD]);
  const allBox = {min: [0, 1, 2].map(k => Math.min(...Object.values(verify).map(v => v.boundsM.min[k]))), max: [0, 1, 2].map(k => Math.max(...Object.values(verify).map(v => v.boundsM.max[k])))};
  const cc = [0, 1, 2].map(k => (allBox.min[k] + allBox.max[k]) / 2), cr = Math.hypot(...[0, 1, 2].map(k => (allBox.max[k] - allBox.min[k]) / 2));
  const endRel = Object.fromEntries(['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot'].map(b => [b, r4(V.sub(skel.ends[b], skel.joints[b]))]));
  const extras = {
    version: 1, archetype: 'siren', meshes: dress ? ['SirenBody', 'SirenDress'] : ['SirenBody'], joints: JOINT_NAMES, heightM: r4(skel.H), ends: endRel,
    clips: Object.fromEntries(clips.map(c => [c.name, {duration: c.duration, loop: c.loop, frames: c.times.length, ...(c.groundSpeed ? {groundSpeed: c.groundSpeed} : {}),
      ...(c.name === 'Attack' ? {impactTime: SIREN_CLIPS.Attack.impactTime, windupEnd: SIREN_CLIPS.Attack.windupEnd, clawBone: 'R_Hand', clawTipAtImpactM: r4(clawR)} : {})}])),
    hitRadii: {head: radii.head, torso: radii.torso, arm: radii.arm, leg: radii.leg},
    dormant: {footprintM: {minX: dormantBox.min[0], maxX: dormantBox.max[0], minZ: dormantBox.min[2], maxZ: dormantBox.max[2]}, topY: dormantBox.max[1], lowestBodyY: dormant.lowestY,
      groundingOffsetM: 0, hipsOffsetY: dormant.hipsY, headY: r4(Wd.Head.pos[1]), headPos: r4(Wd.Head.pos), chestPos: r4(Wd.Chest.pos),
      note: 'Root on the floor at the spawn point; Dormant frame 0 rests the knees / shins / claws on y = 0 (floor solve), the skirt pools below the floor line by up to dressMaxSinkBelowFloorM (skinning only).'},
    bindBoundsM: bb([P, dress?.pos]), clipBoundsM: {min: r4(allBox.min), max: r4(allBox.max)}, cullSphere: {center: r4(cc), radius: r4(cr)},
    modelSpace: '+Z forward, +Y up, +X = character left, metres; feet / Root at the origin',
    note: 'User-supplied Siren (Pale Apparition body + Ghost Dress), appearance-locked: native vertices / UVs / normals / materials / textures unchanged; technical rig, uniform fit and procedural clips only.',
  };
  return {cfg, bodySrc, bodyFp, bp, place, native, P, N, welded, map, hairV, hairW, samples: S, hairS, skel, sw, bodyNative, bodyMesh, dress, rig, clips, ctx, dormant, death, guarded, verify, radii, extras, keyGround: groundLog,
    stats: {seconds: +((Date.now() - t0) / 1000).toFixed(1), bodyWeights: weightStats(bodyNative), dressWeights: dress ? weightStats(dress.native) : null, weldedBodyVertices: welded.pos.length / 3, weldedDressVertices: dress ? dress.welded.pos.length / 3 : null,
      pokeThroughBind: dress ? (({flags: _f, ...r}) => r)(pokeThrough({pos: P, nrm: N, testIds: [...Array(P.length / 3).keys()].filter(i => !hairV || !hairV[i])}, dress.pos, dress.idx)) : null, runGait: RUN_GAIT}};
}

/** Assembles the runtime document from a build result. */
export async function assemble(R, generator) {
  const parts = [{file: R.bodySrc.file, name: 'SirenBody', M: R.place.M, ...R.bodyNative}];
  if (R.dress) parts.push({file: R.dress.src.file, name: 'SirenDress', M: R.dress.M, ...R.dress.native});
  return assembleDocument({parts, skel: R.skel, clips: R.clips, extras: R.extras, generator});
}
