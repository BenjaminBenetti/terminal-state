// Parallel per-body garment fitting: one worker_threads job per (outfit, body) pair.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import {Worker} from 'node:worker_threads';

// iteration 07: + welded skin regions, UV-split weld map, validation poses and (uppers) fitted lower layers for lib/fit07.mjs
const bodyRec = (B, extra, job = {}) => ({id: B.id, skel: B.skel, rigDesc: B.rigDesc, profile: B.profile, low: {pos: B.low.pos, idx: B.low.idx, nrm: B.low.nrm, welded: B.low.welded, weldId: B.low.weldId}, weldedWeights: {joints: B.weldedWeights.joints, weights: B.weldedWeights.weights, region: B.weldedWeights.region}, joints: B.joints, extraCollide: extra ?? undefined, pantsFit: B.def?.pantsFit,
  poses: job.poses, layers: job.layers, layerUV: job.layerUV});
// garment jobs carry the canonical fit; pants / rigid jobs the body-independent stage mesh
const stageRec = (g, cfg) => cfg.kind === 'pants' || cfg.kind === 'rigid' ? {kind: cfg.kind, low: {weldId: g.low.weldId, welded: g.low.welded}} : {canonical: g.canonical, low: {weldId: g.low.weldId}, sleeved: g.garment.sleeved};

/**
 * Meshy T2.5 migration (lane CHARS, 1-CPU studio pod): `LL_THREADS` caps the worker count (the default
 * `os.cpus() - 4` sees the 48-core host, not the pod's 1-CPU quota / 8 GiB limit).
 */
export const threadCap = () => { const n = +(process.env.LL_THREADS || 0); return n > 0 ? n : Infinity; };

/**
 * Meshy T2.5 migration: optional fit-result cache (`cacheDir`). A fit is a pure function of the worker message
 * (stage + config + canonical body + target body incl. validation poses / fitted lower layers) and of the fitting
 * code, so the key is sha256(v8.serialize(message)) + the hash of every module the worker runs. Rebuilding after
 * ONE body or wearable changed then refits only the pairs whose inputs changed; the output is identical to a full
 * refit (the cached value is the worker's own result).
 */
const FIT_CODE = ['fit-worker.mjs', 'fit.mjs', 'fit07.mjs', 'pants.mjs', 'rigid.mjs', 'headwear.mjs', 'penetration.mjs', 'coat.mjs', 'skin.mjs', 'pose.mjs', 'mesh.mjs', 'bake.mjs'];
let fitCodeHash = null;
function codeHash() {
  if (fitCodeHash) return fitCodeHash;
  const h = crypto.createHash('sha256');
  for (const f of FIT_CODE) h.update(fs.readFileSync(new URL(f, import.meta.url)));
  return (fitCodeHash = h.digest('hex').slice(0, 12));
}

/** jobs: [{key, g (garmentCanonical result), cfg, C, B}] -> Map(key -> fitVariant result) */
export async function fitVariantsParallel(jobs, {threads = Math.min(jobs.length, Math.max(1, os.cpus().length - 4), threadCap()), cacheDir = null} = {}) {
  const results = new Map();
  const todo = [];
  for (const j of jobs) {
    j.msg = {id: j.key, gC: stageRec(j.g, j.cfg), cfg: j.cfg, C: bodyRec(j.C), B: bodyRec(j.B, j.extraCollide, j)};
    if (cacheDir) {
      j.cacheFile = path.join(cacheDir, `fit-${j.key.replace(/[^a-z0-9]+/gi, '_')}-${codeHash()}-${crypto.createHash('sha256').update(v8.serialize({...j.msg, id: null})).digest('hex').slice(0, 20)}.v8`);
      if (fs.existsSync(j.cacheFile)) {
        const v = v8.deserialize(fs.readFileSync(j.cacheFile));
        results.set(j.key, v);
        j.onDone?.(v, 0);
        continue;
      }
    }
    todo.push(j);
  }
  if (cacheDir && jobs.length) console.log(`  fit cache: ${jobs.length - todo.length}/${jobs.length} pairs reused, ${todo.length} to fit`);
  let next = 0;
  const run = () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./fit-worker.mjs', import.meta.url), {resourceLimits: {maxOldGenerationSizeMb: 4096}});
    const feed = () => {
      if (next >= todo.length) { w.terminate(); resolve(); return; }
      const j = todo[next++];
      j.t0 = Date.now();
      w.postMessage(j.msg);
    };
    w.on('message', m => {
      if (m.error) { w.terminate(); reject(new Error(`fit ${m.id}: ${m.error}`)); return; }
      const j = todo.find(x => x.key === m.id);
      results.set(m.id, m.v);
      if (j.cacheFile) { fs.mkdirSync(path.dirname(j.cacheFile), {recursive: true}); fs.writeFileSync(j.cacheFile + '.tmp', v8.serialize(m.v)); fs.renameSync(j.cacheFile + '.tmp', j.cacheFile); }
      j.onDone?.(m.v, Date.now() - j.t0);
      feed();
    });
    w.on('error', reject);
    feed();
  });
  if (todo.length) await Promise.all(Array.from({length: Math.max(1, Math.min(threads, todo.length))}, run));
  for (const j of jobs) delete j.msg;
  return results;
}
