#!/usr/bin/env node
// Iteration 07 (Lane W): per-pose garment fit audit straight from the RUNTIME GLBs (CPU only).
//   node tools/asset-pipeline/zombie/qa/fit-audit.mjs [--models=DIR] [--out=FILE.json] [--every=2] [--threads=N] [--pairs=body:wear,...] [--combos]
// For every supported body x wearable pair (and, with --combos, representative upper+lower layer pairs)
// the body (and lower garment) is CPU-skinned through every `every`-th frame of all six clips plus
// three ragdoll-like extreme poses (within the runtime ragdoll joint limits), and lib/penetration.mjs
// measures: visible poke-through of covered body vertices, see-through exposure of hidden body
// triangles, outer-garment vertices inside the body, and clearance. Writes a JSON report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {prepareInner, bindCoverage, auditPose, skin, unionHide, outerWallMask} from '../lib/penetration.mjs';
import {EXTREME_POSES, euler} from '../lib/extreme-poses.mjs';
import {liveModelFiles, liveFile} from '../lib/live-files.mjs'; // T2.5 migration: live file per id (manifest / -t25), not by pattern

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const arr = a => (a ? a.getArray() : null);
const normArr = a => { if (!a) return null; const v = a.getArray(); if (v instanceof Float32Array) return v; const s = v instanceof Int8Array ? 127 : v instanceof Int16Array ? 32767 : 1; return Float32Array.from(v, x => Math.max(-1, x / s)); };

// ------------------------------------------------------------------------------------- loading
export async function loadBodyGeo(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const node = root.listNodes().find(n => n.getName() === 'ZombieBody');
  const prim = node.getMesh().listPrimitives()[0];
  const skinN = node.getSkin(), joints = skinN.listJoints();
  const ibm = arr(skinN.getInverseBindMatrices());
  const extras = root.listScenes()[0].getExtras().zombieBody;
  const bind = joints.map((_, j) => [-ibm[j * 16 + 12], -ibm[j * 16 + 13], -ibm[j * 16 + 14]]);
  const anims = {};
  for (const a of root.listAnimations()) {
    const ch = a.listChannels().map(c => ({ji: joints.indexOf(c.getTargetNode()), path: c.getTargetPath(), T: c.getSampler().getInput().getArray(), O: c.getSampler().getOutput().getArray()}));
    anims[a.getName()] = {ch, duration: Math.max(...ch.map(c => c.T[c.T.length - 1]))};
  }
  return {file, extras, names: joints.map(j => j.getName()), parents: joints.map(j => joints.indexOf(j.getParentNode?.() ?? null)),
    local: joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()})), bind, anims,
    mesh: {pos: arr(prim.getAttribute('POSITION')), nrm: normArr(prim.getAttribute('NORMAL')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0'))}};
}
export async function loadWearGeo(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const sx = root.listScenes()[0].getExtras();
  const extras = sx.zombieWearable ?? sx.zombieOutfit;
  const variants = {};
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0];
    variants[m[2]] = {extras: n.getExtras(), mesh: {pos: arr(prim.getAttribute('POSITION')), nrm: normArr(prim.getAttribute('NORMAL')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0'))}};
  }
  return {file, extras: {slot: 'upper', ...extras}, variants};
}

// ------------------------------------------------------------------------------------- poses
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const qaxis = (ax, deg) => { const l = Math.hypot(...ax) || 1, h = deg * Math.PI / 360, s = Math.sin(h) / l; return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
export {euler};

/** World joint transforms [{q, p, b}] for local overrides (rot by joint name, hips translation offset). */
export function worldFromLocal(B, rot = {}, hipsOffset = null) {
  const local = B.local.map((l, i) => ({q: rot[B.names[i]] ?? l.q, p: l.p.slice()}));
  if (hipsOffset) { const h = B.names.indexOf('Hips'); local[h].p = local[h].p.map((v, k) => v + hipsOffset[k]); }
  return compose(B, local);
}
function compose(B, local) {
  const world = [];
  for (let i = 0; i < local.length; i++) {
    const pi = B.parents[i];
    if (pi < 0) world[i] = {q: local[i].q, p: local[i].p, b: B.bind[i]};
    else { const P = world[pi]; world[i] = {q: qmul(P.q, local[i].q), p: qrot(P.q, local[i].p).map((v, c) => v + P.p[c]), b: B.bind[i]}; }
  }
  return world;
}
/** Clip pose at time t (linear interpolation, as the runtime mixer). */
export function clipWorld(B, clip, t) {
  const local = B.local.map(l => ({q: l.q.slice(), p: l.p.slice()}));
  const a = B.anims[clip];
  if (a) for (const c of a.ch) {
    if (c.ji < 0) continue;
    const k = c.path === 'rotation' ? 4 : 3, T = c.T, O = c.O;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i] || 1)));
    const v = Array.from({length: k}, (_, q) => O[i * k + q] * (1 - u) + O[(i + 1) * k + q] * u);
    if (k === 4) { const l = Math.hypot(...v); local[c.ji].q = v.map(x => x / l); } else local[c.ji].p = v;
  }
  return compose(B, local);
}

export {EXTREME_POSES};

/** Every `every`-th frame (30 fps) of the six clips + the extreme poses + bind. [{clip, t, world}] */
export function auditPoseList(B, every = 2) {
  const out = [{clip: 'Bind', t: 0, world: worldFromLocal(B)}];
  for (const [name, a] of Object.entries(B.anims)) {
    const n = Math.round(a.duration * 30);
    for (let f = 0; f <= n; f += every) out.push({clip: name, t: +(f / 30).toFixed(4), world: clipWorld(B, name, f / 30)});
  }
  for (const [name, rot] of Object.entries(EXTREME_POSES)) out.push({clip: name, t: 0, world: worldFromLocal(B, rot)});
  return out;
}

// ------------------------------------------------------------------------------------- regions
/** Body vertex region label (for the report): head, shoulder, underarm, chest, waist/hip, thigh, arm, shin/foot. */
export function regionOf(B, i) {
  const P = B.mesh.pos, J = B.mesh.joints, W = B.mesh.weights;
  let best = 0, bj = 0; for (let k = 0; k < 4; k++) if (W[i * 4 + k] > best) { best = W[i * 4 + k]; bj = J[i * 4 + k]; }
  const name = B.names[bj], y = P[i * 3 + 1], x = Math.abs(P[i * 3]);
  const jb = n => B.bind[B.names.indexOf(n)];
  const sh = jb('L_UpperArm');
  if (name === 'Head' || name === 'Neck') return 'head';
  if (/Thigh/.test(name)) return 'thigh';
  if (/Shin|Foot/.test(name)) return 'shin/foot';
  if (/Forearm|Hand/.test(name)) return 'arm';
  if (/UpperArm/.test(name)) return y > sh[1] - 0.04 ? 'shoulder' : (x < sh[0] + 0.02 && y > sh[1] - 0.2 ? 'underarm' : 'arm');
  if (name === 'Chest') return y > sh[1] - 0.05 ? 'shoulder' : (x > 0.6 * sh[0] && y > sh[1] - 0.22 ? 'underarm' : 'chest');
  if (name === 'Spine') return y > jb('Spine')[1] + 0.04 ? 'chest' : 'waist/hip';
  return 'waist/hip';
}

/**
 * Body vertices that cloth is expected to cover: everything except footwear (Foot-dominant skin): pant
 * legs end at the shoes / boots, so a boot top meeting a hem is not counted as cloth clipping.
 */
export function bodyEligible(B) {
  const n = B.mesh.pos.length / 3, out = new Uint8Array(n), fl = B.names.indexOf('L_Foot'), fr = B.names.indexOf('R_Foot');
  for (let i = 0; i < n; i++) { let best = 0, bj = 0; for (let k = 0; k < 4; k++) if (B.mesh.weights[i * 4 + k] > best) { best = B.mesh.weights[i * 4 + k]; bj = B.mesh.joints[i * 4 + k]; } out[i] = bj === fl || bj === fr ? 0 : 1; }
  return out;
}

// ------------------------------------------------------------------------------------- audit job
const cache = new Map();
async function body(models, id) { const k = 'b:' + id; if (!cache.has(k)) cache.set(k, await loadBodyGeo(liveFile(models, 'body', id))); return cache.get(k); }
async function wearable(models, id) { const k = 'w:' + id; if (!cache.has(k)) cache.set(k, await loadWearGeo(liveFile(models, 'wearable', id))); return cache.get(k); }

/**
 * job {models, body, wear: [ids...] (the worn set), inner: 'body' | <lower wearable id>, every}
 * inner 'body': body masked by every worn item's hideBodyTriangles vs all worn items;
 * inner <id>: that (lower) garment masked by the others' hideWear[<id>] vs the other worn items.
 */
export async function runJob(job) {
  const B = await body(job.models, job.body);
  const worn = [];
  for (const w of job.wear) { const W = await wearable(job.models, w); const v = W.variants[job.body]; if (!v) throw new Error(`no ${w} variant for ${job.body}`); worn.push({id: w, W, v}); }
  let innerMesh, hide, outers, eligible = null;
  if (job.inner === 'body') {
    innerMesh = B.mesh;
    hide = unionHide(B.mesh.idx.length / 3, worn.map(o => o.v.extras.hideBodyTriangles));
    outers = worn;
    eligible = bodyEligible(B);
  } else {
    const me = worn.find(o => o.id === job.inner);
    innerMesh = me.v.mesh;
    hide = unionHide(me.v.mesh.idx.length / 3, worn.filter(o => o !== me).map(o => o.v.extras.hideWear?.[me.id]));
    outers = worn.filter(o => o !== me);
    eligible = outerWallMask(innerMesh, B.mesh);
  }
  const inner = prepareInner({...innerMesh, weights: innerMesh.weights}, hide, eligible);
  const cover = bindCoverage(inner, outers.map(o => o.v.mesh), {coverDist: job.coverDist ?? 0.1});
  const poses = auditPoseList(B, job.every ?? 2);
  const perClip = {}, regionPoke = {}, everPoke = new Uint8Array(innerMesh.pos.length / 3);
  let coveredN = 0; for (const i of inner.uniq) if (cover.covered[i]) coveredN++;
  const worst = {frac: 0, clip: null, t: 0};
  for (const p of poses) {
    const ip = skin({pos: innerMesh.pos, nrm: inner.mesh.nrm, joints: innerMesh.joints, weights: innerMesh.weights}, p.world, 255);
    const op = outers.map(o => ({pos: skin(o.v.mesh, p.world, 255).pos, idx: o.v.mesh.idx, step: 2}));
    const r = auditPose(inner, cover, ip, op, {outerInside: true});
    for (const i of r.pokeIds) everPoke[i] = 1;
    const frac = coveredN ? r.pokeVisible / coveredN : 0;
    const c = perClip[p.clip] ??= {poses: 0, maxPokeVisible: 0, maxPokeVisibleFrac: 0, sumFrac: 0, worstT: 0, maxExposedHidden: 0, maxOuterInsideFrac: 0, maxPokeDepth: 0, minClearP05: Infinity};
    c.poses++; c.sumFrac += frac;
    if (r.pokeVisible > c.maxPokeVisible) { c.maxPokeVisible = r.pokeVisible; c.maxPokeVisibleFrac = +frac.toFixed(4); c.worstT = p.t; }
    c.maxExposedHidden = Math.max(c.maxExposedHidden, r.exposedHidden);
    c.maxOuterInsideFrac = Math.max(c.maxOuterInsideFrac, +(r.outerTotal ? r.outerInside / r.outerTotal : 0).toFixed(4));
    c.maxPokeDepth = Math.max(c.maxPokeDepth, r.pokeDepthMax);
    c.minClearP05 = Math.min(c.minClearP05, r.clearP05);
    if (frac > worst.frac) { worst.frac = +frac.toFixed(4); worst.clip = p.clip; worst.t = p.t; }
  }
  for (const c of Object.values(perClip)) { c.meanPokeVisibleFrac = +(c.sumFrac / c.poses).toFixed(4); delete c.sumFrac; if (!Number.isFinite(c.minClearP05)) c.minClearP05 = null; }
  if (job.inner === 'body') for (const i of inner.uniq) if (everPoke[i]) { const r = regionOf(B, i); regionPoke[r] = (regionPoke[r] ?? 0) + 1; }
  const anim = Object.entries(perClip).filter(([k]) => !/^ragdoll-|^Bind$/.test(k));
  const agg = (list, f) => Math.max(0, ...list.map(([, c]) => c[f]));
  return {body: job.body, wear: job.wear, inner: job.inner, incompatible: !!job.incompatible, coveredVertices: coveredN, poses: poses.length,
    bind: perClip.Bind, animatedMaxPokeVisibleFrac: agg(anim, 'maxPokeVisibleFrac'), animatedMeanPokeVisibleFrac: +(anim.reduce((a, [, c]) => a + c.meanPokeVisibleFrac * c.poses, 0) / Math.max(1, anim.reduce((a, [, c]) => a + c.poses, 0))).toFixed(4),
    extremeMaxPokeVisibleFrac: agg(Object.entries(perClip).filter(([k]) => /^ragdoll-/.test(k)), 'maxPokeVisibleFrac'),
    maxExposedHidden: agg(Object.entries(perClip), 'maxExposedHidden'), worst, everPokeVisibleVertices: everPoke.reduce((a, v) => a + v, 0), regionPoke, perClip};
}

// ------------------------------------------------------------------------------------- driver
if (!isMainThread) {
  parentPort.on('message', async job => {
    try { parentPort.postMessage({key: job.key, r: await runJob(job)}); } catch (e) { parentPort.postMessage({key: job.key, error: String(e?.stack || e)}); }
  });
} else if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.length ? v.join('=') : true]));
  const models = path.resolve(REPO, args.models || 'game/public/assets/models');
  const out = path.resolve(REPO, args.out || 'qa-artifacts/iter07-wardrobe/fit-audit.json');
  const every = +(args.every || 2);
  const live = liveModelFiles(models);
  const bodies = Object.keys(live.bodies).sort();
  const wears = [];
  for (const f of Object.values(live.wearables).sort()) { const W = await loadWearGeo(f); wears.push({id: W.extras.id, slot: W.extras.slot, bodies: Object.keys(W.variants), incompatible: Object.fromEntries(Object.entries(W.variants).map(([b, v]) => [b, v.extras.incompatibleWear ?? []]))}); }
  const only = args.pairs ? new Set(String(args.pairs).split(',')) : null;
  const jobs = [];
  for (const w of wears) for (const b of w.bodies) if (!only || only.has(`${b}:${w.id}`)) jobs.push({key: `${b}:${w.id}`, models, body: b, wear: [w.id], inner: 'body', every});
  if (args.combos) {
    // layering: every supported upper x lower per body: body under both, and lower under the upper
    for (const b of bodies) for (const u of wears.filter(w => w.slot === 'upper' && w.bodies.includes(b))) for (const l of wears.filter(w => w.slot === 'lower' && w.bodies.includes(b))) {
      if (only && !only.has(`${b}:${u.id}+${l.id}`)) continue;
      // per-body layering exclusions (variant extras incompatibleWear) are audited too, flagged
      const inc = (u.incompatible[b] ?? []).includes(l.id) || (l.incompatible[b] ?? []).includes(u.id);
      jobs.push({key: `${b}:${u.id}+${l.id}|body`, models, body: b, wear: [u.id, l.id], inner: 'body', every: every * 2, incompatible: inc});
      jobs.push({key: `${b}:${u.id}+${l.id}|${l.id}`, models, body: b, wear: [u.id, l.id], inner: l.id, every: every * 2, incompatible: inc});
    }
  }
  const threads = Math.min(jobs.length, +(args.threads || Math.max(1, Math.min(16, os.cpus().length - 8))));
  console.log(`fit audit: ${jobs.length} jobs, ${threads} threads, every ${every} frames, models ${path.relative(REPO, models)}`);
  const results = {};
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({length: threads}, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), {resourceLimits: {maxOldGenerationSizeMb: 3072}});
    const feed = () => { if (next >= jobs.length) { w.terminate(); resolve(); return; } w.postMessage(jobs[next++]); };
    w.on('message', m => {
      if (m.error) { console.error('job', m.key, m.error); results[m.key] = {error: m.error}; } else results[m.key] = m.r;
      done++;
      if (!m.error) console.log(`  [${done}/${jobs.length}] ${m.key}: anim max ${(100 * m.r.animatedMaxPokeVisibleFrac).toFixed(1)}% mean ${(100 * m.r.animatedMeanPokeVisibleFrac).toFixed(2)}% extreme ${(100 * m.r.extremeMaxPokeVisibleFrac).toFixed(1)}% bind ${m.r.bind.maxPokeVisible} exposedHidden ${m.r.maxExposedHidden} (${Math.round((Date.now() - t0) / 1000)} s)`);
      feed();
    });
    w.on('error', reject);
    feed();
  })));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify({schema: 'the-last-line/wardrobe-fit-audit@1', models: path.relative(REPO, models), every, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    definitions: 'see tools/asset-pipeline/zombie/lib/penetration.mjs header: covered = bind outward ray hits the worn items within 10 cm; poke = posed outward ray misses while the inward ray hits cloth within min(12 cm, 0.45 x local thickness); visible = vertex used by a triangle not hidden by the runtime masks; fractions are of covered vertices',
    results}, null, 1) + '\n');
  console.log('wrote', path.relative(REPO, out));
}
