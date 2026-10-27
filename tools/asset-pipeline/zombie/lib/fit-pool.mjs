// Parallel per-body garment fitting: one worker_threads job per (outfit, body) pair.
import os from 'node:os';
import {Worker} from 'node:worker_threads';

const bodyRec = (B, extra) => ({id: B.id, skel: B.skel, rigDesc: B.rigDesc, profile: B.profile, low: {pos: B.low.pos, idx: B.low.idx, welded: B.low.welded}, weldedWeights: {joints: B.weldedWeights.joints, weights: B.weldedWeights.weights}, joints: B.joints, extraCollide: extra ?? undefined, pantsFit: B.def?.pantsFit});
// garment jobs carry the canonical fit; pants / rigid jobs the body-independent stage mesh
const stageRec = (g, cfg) => cfg.kind === 'pants' || cfg.kind === 'rigid' ? {kind: cfg.kind, low: {weldId: g.low.weldId, welded: g.low.welded}} : {canonical: g.canonical, low: {weldId: g.low.weldId}, sleeved: g.garment.sleeved};

/** jobs: [{key, g (garmentCanonical result), cfg, C, B}] -> Map(key -> fitVariant result) */
export async function fitVariantsParallel(jobs, {threads = Math.min(jobs.length, Math.max(1, os.cpus().length - 4))} = {}) {
  const results = new Map();
  let next = 0;
  const run = () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./fit-worker.mjs', import.meta.url), {resourceLimits: {maxOldGenerationSizeMb: 4096}});
    const feed = () => {
      if (next >= jobs.length) { w.terminate(); resolve(); return; }
      const j = jobs[next++];
      j.t0 = Date.now();
      w.postMessage({id: j.key, gC: stageRec(j.g, j.cfg), cfg: j.cfg, C: bodyRec(j.C), B: bodyRec(j.B, j.extraCollide)});
    };
    w.on('message', m => {
      if (m.error) { w.terminate(); reject(new Error(`fit ${m.id}: ${m.error}`)); return; }
      const j = jobs.find(x => x.key === m.id);
      results.set(m.id, m.v);
      j.onDone?.(m.v, Date.now() - j.t0);
      feed();
    });
    w.on('error', reject);
    feed();
  });
  await Promise.all(Array.from({length: threads}, run));
  return results;
}
