#!/usr/bin/env node
// Skyways lane ASSET-C: the convention MASCOT — STATIC statues of the community-supplied chibi figure (light-blue hair, bear-ear beanie,
// white blouse, suspender skirt) in several humorous BAKED poses. Never an NPC, never animated: one mesh node per pose.
//
// Reads (never modifies) the user's source master kept OUTSIDE Git:
//   reference/tasks/skyways-level-20261106-054448/masters/Meshy_AI_Blue_Haired_Bear_Hat__1106042016_texture.glb  (sha256 pinned below)
// and writes deterministically:
//   game/public/assets/models/skyways-mascot-poses.glb        ONE material (the source's own PBR maps, re-encoded once: base colour
//                                                            1024, normal 1024, metallic-roughness 512) shared by one node per pose;
//                                                            the UV + index accessors are shared too (same topology in every pose)
//   game/public/assets/derivatives/skyways-mascot-poses.json  provenance (community-supplied source; no licence / authorship claim)
//   game/src/assets/skywaysMascot.generated.ts                SKYWAYS_MASCOT {url, height, poses: {<node>: {w, h, d, tris, pointDir?}}}
//   tools/release/public-inputs.json                          ONLY this lane's two public paths added / updated
//
// Method (all deterministic processing of the supplied model; no generation, no provider rig):
//  1. meshoptimizer simplifyWithAttributes (normals weighted, UV seams preserved) 569k -> TARGET_TRIS triangles; unused vertices dropped;
//  2. game frame: UNIFORM scale to HEIGHT_M (1.40 m statue), grounded (feet at y 0), centred on x / z; the source's front +Z kept;
//  3. region skinning (lib/skyways-mascot-rig.mjs): arm regions flood-filled from the hands through skin / white (hair and the maroon
//     skirt stop them), shoulder pivot = the centroid of each sleeve's seam ring, elbow along the arm axis; harmonic shoulder weights,
//     smoothstep elbow / neck / waist weights; ANGLE-blended rotations, child first; normals rotated (+ a geometric correction only where
//     the surface deforms); UVs, topology and the normal map untouched;
//  4. diagnostics per pose (edge stretch, folded triangles, moved-vs-static intersections); the build refuses torn / folded poses.
//
//   node tools/asset-pipeline/props/build-skyways-mascot.mjs [--ref-root <dir>] [--dry-run] [--qa <dir> [--focus <pose>]]
//     --ref-root  the private reference/ root (default <repo>/reference; a lane worktree passes the main checkout's)
//     --qa        private QA renders (never in Git): per-pose contact sheet, smooth-shaded normals, no-hair shoulder / waist close-ups,
//                 rig weights, stretch map + worst-triangle dump, diagnostics.json, stand-only.glb (for scale-check.mjs --prop)
//     --focus     + one pose's rest / pose / weights / stretch-and-intersection sheet around its moved joints
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Document, NodeIO} from '@gltf-transform/core';
import {getBounds} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {buildRig, pose, stretchStats, intersections, dirFromElAz} from './lib/skyways-mascot-rig.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REF = path.resolve(opt('--ref-root') ?? path.join(root, 'reference'));
const DRY = argv.includes('--dry-run');
const QA = opt('--qa');
const TASK_DIR = 'tasks/skyways-level-20261106-054448';
const MASTER_FILE = 'Meshy_AI_Blue_Haired_Bear_Hat__1106042016_texture.glb';
const MASTER_SHA = '11461397fde2670461a6abe3863e7f62d27d7d4ed16452264eb0d027c25e093d';
const ID = 'skyways-mascot-poses';
const OUT_REL = `assets/models/${ID}.glb`;
const PROV_REL = `assets/derivatives/${ID}.json`;
const REG = path.join(root, 'game/src/assets/skywaysMascot.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const HEIGHT_M = 1.40;
const TARGET_TRIS = 19500;
const TEX = {base: 1024, normal: 1024, mr: 512, quality: 86};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +(+v).toFixed(4);

// Rig constants (metres, game frame), measured on this figure and tuned against the diagnostics + QA renders:
//  seam      the sleeve-seam plane (through x / y; normal out and slightly down) that bounds the arm flood fill;
//  seamBand  geodesic half-width of the shoulder blend around the whole arm / torso junction (armhole loop incl. the armpit bottom);
//  seamSlab  the arm cross-section just past the seam plane whose centroid gives the shoulder pivot x / z; pivotFrac = its height;
//  hand      the hand-seed window (lowest skin vertex beside the skirt); neck / hairFade = head tilt pivot and the hanging-hair fade;
//  waist     the bow hinge (moved toward the front of the waist so the bodice does not fold into the skirt waistband).
const RIG = {
  seam: {x: 0.118, y: 0.494, tiltDeg: 15},
  seamBand: 0.045, seamSlab: 0.02, pivotFrac: 0.35, shoulderRadius: 0.13, elbowBand: 0.025,
  hand: {xMin: 0.16, yMin: 0.18, yMax: 0.44},
  neck: {y: 0.553, z: 0.09, band: 0.025}, hairFade: 0.37,
  waist: {y: 0.384, z: 0.12, band: 0.045},
};
// Poses. Arm directions: [elevation deg above horizontal, azimuth deg from the lateral axis toward the front], side +1 = +X (her
// left), -1 = -X (her right); in the torso frame (before the bow). The chibi head is as wide as the body, so raised hands stay below
// the jaw line and outside / in front of the side locks (checked by the intersection diagnostics).
const POSES = [
  {name: 'stand', spec: {}},
  {name: 'wave', spec: {arms: {[-1]: {upper: [28, 18], fore: [64, 18]}}, head: {axis: [0, 0, 1], deg: -7}}},
  {name: 'point', spec: {arms: {[-1]: {upper: [0, 8], fore: [0, 8]}}}, point: -1},
  {name: 'cheer', spec: {arms: {[1]: {upper: [40, 12], fore: [55, 12]}, [-1]: {upper: [40, 12], fore: [55, 12]}}}},
  {name: 'bow', spec: {bow: 28, arms: {[1]: {upper: 'rest', world: true}, [-1]: {upper: 'rest', world: true}}}},
];
// Not shipped (tried, not clean): `think` (hand to chin) — the chibi forearm cannot reach the chin from a lowered elbow and a raised
// elbow drives the forearm through the chest; `salute` — the hat brim is ~0.45 m from the shoulder for a ~0.25 m arm.
// Regression guards (absolute, not ratios: millimetre slivers in the armpit stretch by large factors without being visible):
// max edge growth, folded triangles (creases), intersecting triangles of the moved part beyond the rest-pose baseline. Arm poses must
// not cross the body / hair; the bow's crease where the bodice tucks into the skirt waistband is allowed a small count.
const LIMITS = {growMm: 40, folded: 80, armHits: 5, bowHits: 80};

// ---------- source ----------
const masterPath = path.join(REF, TASK_DIR, 'masters', MASTER_FILE);
const rawBytes = fs.readFileSync(masterPath);
if (sha(rawBytes) !== MASTER_SHA) throw new Error(`master sha256 mismatch: ${masterPath}`);
const listed = (() => { try { return JSON.parse(fs.readFileSync(path.join(REF, TASK_DIR, 'MASTERS-SHA256.json'), 'utf8')).find(e => e.file === MASTER_FILE); } catch { return null; } })();
if (listed && listed.sha256 !== MASTER_SHA) throw new Error('MASTERS-SHA256.json disagrees with the pinned sha256');
const io = new NodeIO();
const src = await io.readBinary(new Uint8Array(rawBytes));
const srcMeshes = src.getRoot().listMeshes();
if (srcMeshes.length !== 1 || srcMeshes[0].listPrimitives().length !== 1) throw new Error('expected one mesh / one primitive');
const prim = srcMeshes[0].listPrimitives()[0], srcMat = prim.getMaterial();
const P0 = prim.getAttribute('POSITION').getArray(), N0 = prim.getAttribute('NORMAL').getArray(), UV0 = prim.getAttribute('TEXCOORD_0').getArray();
const I0 = new Uint32Array(prim.getIndices().getArray());
const srcTris = I0.length / 3;
const srcTex = src.getRoot().listTextures().map(t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength}));
for (const [k, t] of [['baseColor', srcMat.getBaseColorTexture()], ['metallicRoughness', srcMat.getMetallicRoughnessTexture()], ['normal', srcMat.getNormalTexture()]]) if (!t) throw new Error(`source lacks ${k}`);

// ---------- 1. decimate ----------
await MeshoptSimplifier.ready;
const [simp, simpErr] = MeshoptSimplifier.simplifyWithAttributes(I0, P0, 3, new Float32Array(N0), 3, [0.25, 0.25, 0.25], null, TARGET_TRIS * 3, 1.0, []);
const remap = new Int32Array(P0.length / 3).fill(-1); let nv = 0;
const I = new Uint32Array(simp.length);
for (let i = 0; i < simp.length; i++) { const v = simp[i]; if (remap[v] < 0) remap[v] = nv++; I[i] = remap[v]; }
let P = new Float32Array(nv * 3); const N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
for (let v = 0; v < remap.length; v++) { const j = remap[v]; if (j < 0) continue; for (let k = 0; k < 3; k++) { P[j * 3 + k] = P0[v * 3 + k]; N[j * 3 + k] = N0[v * 3 + k]; } UV[j * 2] = UV0[v * 2]; UV[j * 2 + 1] = UV0[v * 2 + 1]; }
const tris = I.length / 3;
if (tris > 20000) throw new Error(`decimation left ${tris} triangles`);

// ---------- 2. game frame ----------
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i * 3 + k]); mx[k] = Math.max(mx[k], P[i * 3 + k]); }
const srcExtent = [0, 1, 2].map(k => mx[k] - mn[k]);
const scale = HEIGHT_M / srcExtent[1], cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
for (let i = 0; i < nv; i++) { P[i * 3] = (P[i * 3] - cx) * scale; P[i * 3 + 1] = (P[i * 3 + 1] - mn[1]) * scale; P[i * 3 + 2] = (P[i * 3 + 2] - cz) * scale; }
P = Float32Array.from(P);

// ---------- textures (the source maps, re-encoded once) ----------
const enc = async (tex, px, chroma) => sharp(Buffer.from(tex.getImage())).resize(px, px, {kernel: 'lanczos3'}).jpeg({quality: TEX.quality, chromaSubsampling: chroma}).toBuffer();
const baseJpg = await enc(srcMat.getBaseColorTexture(), TEX.base, '4:2:0');
const normalJpg = await enc(srcMat.getNormalTexture(), TEX.normal, '4:4:4');
const mrJpg = await enc(srcMat.getMetallicRoughnessTexture(), TEX.mr, '4:4:4');
const baseRaw = await sharp(baseJpg).removeAlpha().raw().toBuffer({resolveWithObject: true});
const tex = {data: baseRaw.data, w: baseRaw.info.width, h: baseRaw.info.height};

// ---------- 3. rig + poses ----------
const mesh = {P, N, UV, I};
const rig = buildRig(mesh, tex, RIG);
const posed = [];
for (const p of POSES) {
  const r = pose(mesh, rig, p.spec);
  // the part that moves as a block (raised arms, or the bowing upper body) vs everything else; the same test on the rest pose is
  // the baseline (the source already has touching / crossing layers)
  const group = new Uint8Array(tris), armsMoved = rig.arms.filter(A => p.spec.arms?.[A.side]);
  const wv = v => p.spec.bow ? rig.wB[v] : armsMoved.length ? Math.max(...armsMoved.map(A => A.wU[v])) : 0;
  for (let t = 0; t < tris; t++) for (let e = 0; e < 3; e++) if (wv(I[t * 3 + e]) > 0.5) group[t] = 1;
  const st = stretchStats(P, r.P, I, r.R);
  const any = group.some(x => x);
  const hit = any ? intersections(r.P, I, group) : {staticHit: 0, movingHit: 0};
  const base = any ? intersections(P, I, group) : {staticHit: 0, movingHit: 0};
  hit.base = [base.movingHit, base.staticHit];
  const moved = group;
  let pointDir = null;
  if (p.point) {
    const arm = p.spec.arms[p.point], d = dirFromElAz(p.point, ...(arm.fore ?? arm.upper)), l = Math.hypot(d[0], d[2]);
    pointDir = [r4(d[0] / l), r4(d[2] / l)];
  }
  posed.push({...p, P: r.P, N: r.N, stretch: st, hit, moved: moved.reduce((a, b) => a + b, 0), pointDir});
}
const diag = posed.map(p => ({pose: p.name, movedTris: p.moved, stretch: p.stretch.max, growMm: p.stretch.maxGrowMm, over15: p.stretch.over15, over2: p.stretch.over2, folded: p.stretch.folded, intersect: [p.hit.movingHit, p.hit.staticHit], restBaseline: p.hit.base ?? null}));
console.log(JSON.stringify({srcTris, tris, verts: nv, simpErr: +simpErr.toExponential(3), scale: r4(scale), classFlips: rig.cls.flips,
  arms: rig.arms.map(A => ({side: A.side, profile: A.profile, slabY: A.slabY.map(r4), armVerts: A.count, ring: A.ring, free: A.free, bridges: A.bridges, shoulder: A.S.map(r4), elbow: A.E.map(r4), tip: A.T.map(r4), len: r4(A.L)})), diag}, null, 1));
const hits = p => p.hit.movingHit + p.hit.staticHit - (p.hit.base ? p.hit.base[0] + p.hit.base[1] : 0);
const bad = posed.filter(p => p.stretch.maxGrowMm > LIMITS.growMm || p.stretch.folded > LIMITS.folded || hits(p) > (p.spec.bow ? LIMITS.bowHits : LIMITS.armHits));

// ---------- QA ----------
if (QA) {
  const {view, windowFor, render, grid, sheet} = await import('./lib/skyways-mascot-qa.mjs');
  fs.mkdirSync(QA, {recursive: true});
  const S = 520, tiles = [], labels = [];
  for (const p of posed) for (const [yaw, nm] of [[0, 'front'], [-35, '3/4 -X'], [90, 'side +X'], [180, 'back']]) {
    const f = view(yaw), w = {cu: 0, cv: 0.72, span: 1.5};
    tiles.push(grid(render({P: p.P, UV, I, tex}, f, S, w), S, w)); labels.push(`${p.name} ${nm}`);
  }
  await sheet(path.join(QA, 'poses-contact.png'), tiles, 4, S, labels);
  // the shipped vertex normals, smooth-shaded and untextured (normals facing away from the camera show dark)
  const tn = [], ln = [];
  for (const p of posed) for (const [yaw, nm] of [[0, 'front'], [-40, '3/4 -X'], [40, '3/4 +X'], [140, 'back 3/4']]) {
    const f = view(yaw), w = {cu: 0, cv: 0.72, span: 1.5};
    tn.push(grid(render({P: p.P, UV, I, tex: null, N: p.N}, f, 400, w), 400, w)); ln.push(`${p.name} normals ${nm}`);
  }
  await sheet(path.join(QA, 'poses-normals.png'), tn, 4, 400, ln);
  // shoulder / waist close-ups of moved parts; the shoulder views hide the hair (all-hair triangles) so the seam is visible
  const S2 = 520, t2 = [], l2 = [];
  const noHair = []; for (let t = 0; t < tris; t++) if (![0, 1, 2].every(e => rig.cls.hair[rig.W[I[t * 3 + e]]])) noHair.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  const IH = Uint32Array.from(noHair);
  for (const p of posed) {
    if (p.name === 'stand') continue;
    const sides = p.spec.bow ? [] : p.spec.arms ? Object.keys(p.spec.arms).map(Number) : [];
    for (const s of sides) {
      const A = rig.arms.find(a => a.side === s);
      for (const [yaw, pitch, nm] of [[0, 0, 'front'], [35 * s, 0, '3/4'], [90 * s, 0, 'outside'], [180, 0, 'back'], [0, 60, 'top'], [25 * s, -55, 'below']]) {
        const f = view(yaw, pitch), c = f(...A.S), w = {cu: c[0], cv: c[1] + 0.02, span: 0.4};
        t2.push(grid(render({P: p.P, UV, I: IH, tex}, f, S2, w), S2, w, 0.05)); l2.push(`${p.name} ${s > 0 ? '+X' : '-X'} ${nm} (no hair)`);
      }
    }
    if (p.spec.bow) for (const [yaw, nm] of [[90, 'side +X'], [-90, 'side -X'], [180, 'back'], [0, 'front']]) {
      const f = view(yaw), c = f(...rig.waist), w = {cu: c[0], cv: c[1] + 0.05, span: 0.6};
      t2.push(grid(render({P: p.P, UV, I, tex}, f, S2, w), S2, w, 0.05)); l2.push(`${p.name} waist ${nm}`);
    }
  }
  await sheet(path.join(QA, 'poses-closeups.png'), t2, 6, S2, l2);
  // focus sheet: one pose (--focus <pose>), each moved arm, rest vs pose, textured and weight-tinted, hair hidden
  const focus = opt('--focus');
  if (focus) {
    const p = posed.find(q => q.name === focus), t5 = [], l5 = [], S5 = 480;
    const tintW = new Float32Array(nv * 3), tintS = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { const u = Math.max(...rig.arms.map(A => A.wU[i])), f = Math.max(...rig.arms.map(A => A.wF[i])); tintW.set([u, f, u > 0 && u < 1 ? 1 - Math.abs(2 * u - 1) : 0], i * 3); }
    for (let t = 0; t < tris; t++) {
      const sv = p.stretch.per[t], c = sv >= 9 ? [0, 1, 1] : sv > 2 ? [1, 0, 1] : sv > 1.5 ? [1, 0.5, 0] : null;
      if (c) for (let e = 0; e < 3; e++) { const v = I[t * 3 + e]; if (tintS[v * 3 + 1] < 1) tintS.set(c, v * 3); }
    }
    for (const t of [...(p.hit.staticTris ?? []), ...(p.hit.movingTris ?? [])]) for (let e = 0; e < 3; e++) tintS.set([1, 1, 0], I[t * 3 + e] * 3);
    const spots = p.spec.bow ? [{c: rig.waist, nm: 'waist', views: [[0, 0, 'front'], [90, 0, '+X'], [-90, 0, '-X'], [180, 0, 'back'], [150, 25, 'back high'], [0, -50, 'below front']], span: 0.55, IU: I}]
      : Object.keys(p.spec.arms ?? {}).map(Number).map(s => ({c: rig.arms.find(a => a.side === s).S, nm: s > 0 ? '+X' : '-X', span: 0.3, IU: IH,
        views: [[0, 0, 'front'], [35 * s, 15, '3/4 front'], [90 * s, 0, 'outside'], [150 * s, 10, '3/4 back'], [180, 0, 'back'], [20 * s, -60, 'below']]}));
    for (const sp of spots) for (const [yaw, pitch, nm] of sp.views) {
      const f = view(yaw, pitch), c = f(...sp.c), w = {cu: c[0], cv: c[1], span: sp.span};
      for (const [PP, tag, tint] of [[P, 'REST', null], [p.P, 'POSE', null], [p.P, 'weights', p.spec.bow ? null : tintW], [p.P, 'stretch/hit', tintS]]) {
        t5.push(grid(render({P: PP, UV, I: sp.IU, tex, tint, tintMix: tint ? 0.65 : 0}, f, S5, w), S5, w, 0.05)); l5.push(`${focus} ${sp.nm} ${nm} ${tag}`);
      }
    }
    await sheet(path.join(QA, `focus-${focus}.png`), t5, 8, S5, l5);
  }
  // weights on the stand
  const tint = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const u = Math.max(...rig.arms.map(A => A.wU[i])), f = Math.max(...rig.arms.map(A => A.wF[i]));
    tint[i * 3] = u; tint[i * 3 + 1] = f; tint[i * 3 + 2] = rig.cls.hair[rig.W[i]] ? 1 : rig.wB[i] * 0.4;
  }
  const t3 = [], l3 = [];
  for (const [yaw, nm] of [[0, 'front'], [90, 'side +X'], [180, 'back'], [-90, 'side -X']]) {
    const f = view(yaw), w = {cu: 0, cv: 0.48, span: 0.62};
    t3.push(grid(render({P, UV, I, tex, tint, tintMix: 0.6}, f, S2, w), S2, w, 0.05)); l3.push(`weights R=upper G=fore B=hair ${nm}`);
  }
  await sheet(path.join(QA, 'rig-weights.png'), t3, 4, S2, l3);
  fs.writeFileSync(path.join(QA, 'diagnostics.json'), JSON.stringify(diag, null, 1));
  // stretch heat map: vertices of triangles stretched > 1.5x (or folded) in magenta, on the REST mesh (where) and the pose
  const t4 = [], l4 = [], dump = {};
  for (const p of posed) {
    if (p.name === 'stand') continue;
    const tint4 = new Float32Array(nv * 3).fill(0);
    const rows = [];
    const growOf = t => Math.max(...[0, 1, 2].map(e => { const a = I[t * 3 + e], b = I[t * 3 + (e + 1) % 3]; return Math.hypot(p.P[a * 3] - p.P[b * 3], p.P[a * 3 + 1] - p.P[b * 3 + 1], p.P[a * 3 + 2] - p.P[b * 3 + 2]) - Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); }));
    for (let t = 0; t < tris; t++) {
      const s = p.stretch.per[t];
      if (s <= 1.5) continue;
      for (let e = 0; e < 3; e++) { const v = I[t * 3 + e]; tint4.set([1, 0, 1], v * 3); }
      if (s > 1.5) rows.push({t, s: r4(s), growMm: +(growOf(t) * 1000).toFixed(1), v: [0, 1, 2].map(e => { const v = I[t * 3 + e], w = rig.W[v]; return {p: [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]].map(r4), hair: rig.cls.hair[w], maroon: rig.cls.maroon[w], inA: rig.arms.map(A => A.inA[v]), wU: rig.arms.map(A => r4(A.wU[v])), wF: rig.arms.map(A => r4(A.wF[v])), wH: r4(rig.wH[v]), wB: r4(rig.wB[v])}; })});
    }
    dump[p.name] = rows.sort((x, y) => y.growMm - x.growMm).slice(0, 40);
    for (const [yaw, nm] of [[0, 'front'], [90, 'side +X'], [180, 'back'], [-90, 'side -X']]) {
      const f = view(yaw), w = {cu: 0, cv: 0.5, span: 0.9};
      t4.push(grid(render({P, UV, I, tex, tint: tint4, tintMix: 0.8}, f, 360, w), 360, w)); l4.push(`${p.name} REST ${nm}`);
    }
  }
  await sheet(path.join(QA, 'stretch-map.png'), t4, 4, 360, l4);
  fs.writeFileSync(path.join(QA, 'stretch-worst.json'), JSON.stringify(dump, null, 1));
}
if (bad.length) throw new Error(`torn / folded / crossing poses: ${bad.map(p => `${p.name} (growth ${p.stretch.maxGrowMm} mm, folded ${p.stretch.folded}, hits ${hits(p)})`).join(', ')}`);

// ---------- 4. GLB: one material, shared UV / index accessors, one node per pose ----------
const doc = new Document();
const buffer = doc.createBuffer();
const texture = (name, jpg) => doc.createTexture(name).setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
const mat = doc.createMaterial('skyways-mascot')
  .setBaseColorTexture(texture('skyways-mascot-base', baseJpg))
  .setNormalTexture(texture('skyways-mascot-normal', normalJpg))
  .setMetallicRoughnessTexture(texture('skyways-mascot-mr', mrJpg))
  .setBaseColorFactor(srcMat.getBaseColorFactor()).setMetallicFactor(srcMat.getMetallicFactor()).setRoughnessFactor(srcMat.getRoughnessFactor())
  .setDoubleSided(srcMat.getDoubleSided()).setAlphaMode('OPAQUE');
const uvAcc = doc.createAccessor('skyways-mascot-uv').setType('VEC2').setArray(UV).setBuffer(buffer);
const idxAcc = doc.createAccessor('skyways-mascot-indices').setType('SCALAR').setArray(nv < 65536 ? Uint16Array.from(I) : I).setBuffer(buffer);
const scene = doc.createScene('skyways-mascot');
for (const p of posed) {
  const pr = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${p.name}-position`).setType('VEC3').setArray(p.P).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor(`${p.name}-normal`).setType('VEC3').setArray(p.N).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', uvAcc).setIndices(idxAcc).setMaterial(mat);
  scene.addChild(doc.createNode(p.name).setMesh(doc.createMesh(p.name).addPrimitive(pr)));
}
doc.getRoot().setDefaultScene(scene);
doc.getRoot().getAsset().generator = 'Terminal State tools/asset-pipeline/props/build-skyways-mascot.mjs (glTF-Transform)';
const glb = Buffer.from(await io.writeBinary(doc));
{ const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString(); if (/https?:|Signature|X-Amz|token/i.test(json)) throw new Error('URL/token-like string inside the glTF JSON'); }

// ---------- measure the written file ----------
const chk = await io.readBinary(new Uint8Array(glb));
const poses = {};
for (const node of chk.getRoot().listNodes()) {
  const b = getBounds(node), pr = node.getMesh().listPrimitives()[0];
  const name = node.getName(), p = posed.find(q => q.name === name);
  if (Math.abs(b.min[1]) > 1e-4) throw new Error(`${name} not grounded (min y ${b.min[1]})`);
  poses[name] = {w: r4(b.max[0] - b.min[0]), h: r4(b.max[1] - b.min[1]), d: r4(b.max[2] - b.min[2]), tris: pr.getIndices().getCount() / 3, ...(p.pointDir ? {pointDir: p.pointDir} : {})};
}
if (Math.abs(poses.stand.h - HEIGHT_M) > 1e-3) throw new Error(`stand height ${poses.stand.h}`);
const textures = [['baseColor', baseJpg, TEX.base], ['normal', normalJpg, TEX.normal], ['metallicRoughness', mrJpg, TEX.mr]].map(([slot, b, px]) => ({slot, size: [px, px], mime: 'image/jpeg', bytes: b.length, sha256: sha(b)}));

const prov = {
  schema: 'terminal-state-derivative-v1',
  id: ID,
  item: 'Skyways convention mascot statues (static props; never an NPC / animated): one mesh node per baked pose',
  task: 'skyways-level-20261106-054448, lane ASSET-C',
  sourceStatus: 'community-supplied source via the user; creator / license links pending; no license or authorship claim',
  source: {file: `reference/${TASK_DIR}/masters/${MASTER_FILE} (user source master, outside Git)`, sha256: MASTER_SHA, bytes: rawBytes.length, triangles: srcTris, extent: srcExtent.map(r4), textures: srcTex},
  method: [
    `meshoptimizer simplifyWithAttributes (normal-weighted, UV seams preserved): ${srcTris} -> ${tris} triangles, ${nv} vertices`,
    `uniform scale ${r4(scale)} to a ${HEIGHT_M} m statue, grounded (feet at y 0), centred on x / z; front +Z (source native)`,
    'poses by deterministic region skinning (tools/asset-pipeline/props/lib/skyways-mascot-rig.mjs): arm regions flood-filled from the hands (hair, the maroon skirt and black excluded by base colour), shoulder pivots from each arm\'s cross-section at the sleeve seam, harmonic shoulder weights over a geodesic band around the armhole, smoothstep elbow / neck / waist weights, angle-blended rotations; no provider rig, no generation',
    'checked per pose: max edge growth, folded triangles, moved-part intersections vs the rest pose (the build refuses torn / crossing poses); not shipped: think (forearm cannot reach the chin cleanly), salute (hat brim out of reach)',
    'the source PBR maps kept (re-encoded only): base colour, normal, metallic-roughness; one material and one UV / index set shared by every pose node',
  ],
  rig: {arms: rig.arms.map(A => ({side: A.side > 0 ? '+X (her left)' : '-X (her right)', shoulder: A.S.map(r4), elbow: A.E.map(r4), tip: A.T.map(r4), armVertices: A.count})), neck: rig.neck.map(r4), waist: rig.waist.map(r4)},
  poses: Object.fromEntries(posed.map(p => [p.name, {spec: p.spec, ...poses[p.name], stretchMax: p.stretch.max, folded: p.stretch.folded, intersectingTris: p.hit.movingHit + p.hit.staticHit}])),
  output: {file: `game/public/${OUT_REL}`, url: OUT_REL, sha256: sha(glb), bytes: glb.length, nodes: posed.map(p => p.name), trianglesPerPose: tris, materials: 1},
  heightM: HEIGHT_M,
  convention: 'metres at statue size (1.40 m standing), +Y up, front +Z, origin = bottom centre of the standing figure (feet at y 0), every node at identity; pointDir = unit [x, z] of the pointing hand in the model frame',
  textures,
  licence: 'community-supplied source via the user; creator / license links pending; no license or authorship claim; not cleared for production / commercial use',
};
const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`URL/token-like string in public provenance: ...${hit[0]}...`); }
const fmt = o => Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join(', ');
const reg = `// GENERATED by tools/asset-pipeline/props/build-skyways-mascot.mjs — do not edit (Skyways lane ASSET-C).
// The convention MASCOT statues: one GLB, one shared material, one mesh node per baked pose (static props; never an NPC / animated).
// Provenance ${PROV_REL} (community-supplied source via the user; no licence or authorship claim). Model frame: metres, +Y up,
// front +Z, origin = bottom centre of the standing figure (feet at y 0). w / h / d = the pose's bounds (x / y / z); pointDir = unit
// [x, z] direction the pointing hand points in the model frame (turn the statue so it faces the target).
export interface SkywaysMascotPose {readonly w: number; readonly h: number; readonly d: number; readonly tris: number; readonly pointDir?: readonly [number, number]}
export const SKYWAYS_MASCOT = {
  url: '${OUT_REL}',
  bytes: ${glb.length},
  height: ${HEIGHT_M},
  poses: {
${posed.map(p => `    ${p.name}: {${fmt(poses[p.name])}},`).join('\n')}
  },
} as const satisfies {readonly url: string; readonly bytes: number; readonly height: number; readonly poses: Readonly<Record<string, SkywaysMascotPose>>};
export type SkywaysMascotPoseName = keyof typeof SKYWAYS_MASCOT.poses;
`;
console.log(JSON.stringify({out: OUT_REL, bytes: glb.length, textures: textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes} B`), poses}, null, 1));
if (QA) {
  // stand-only GLB for the zombie scale check (private QA dir)
  const d2 = await io.readBinary(new Uint8Array(glb));
  for (const node of d2.getRoot().listNodes()) if (node.getName() !== 'stand') node.dispose();
  fs.writeFileSync(path.join(QA, 'stand-only.glb'), Buffer.from(await io.writeBinary(d2)));
}
if (DRY) process.exit(0);

fs.writeFileSync(path.join(root, 'game/public', OUT_REL), glb);
fs.writeFileSync(path.join(root, 'game/public', PROV_REL), provBuf);
fs.writeFileSync(REG, reg);
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map([[OUT_REL, glb], [PROV_REL, provBuf]]);
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', OUT_REL, PROV_REL, path.relative(root, REG), 'public-inputs.json');
