// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, user: "turning the camera around in the mall causes the spike"):
// world/levelCulling.ts runs a FULL update on every turning frame. Its position-only results (each entry's slab test, the atrium /
// portal sight tests, the street-exit sight rays) are now kept per eye position, and the hot loop no longer allocates per entry.
// On the REAL mall (seed t3a, the game's build path incl. the glass lift and the loot display):
//  - exactness: over yaw sweeps at five poses (3° per frame, turning in place) and a walk with turning, every registered entry's
//    layer and every culler statistic equal those of a decision with the caches forgotten (fresh computation) at the same camera;
//  - structural cost bound (time-free): turning in place, a slab test / sight test / ray runs once per entry / tile / opening when
//    first needed at that eye position — over 39 turning updates at most 5-10 % of the uncached work (the same counters with the
//    caches forgotten every update: ~580-1,745 slab tests and up to ~240 rays per update).
// Node timing (studio pod, informative only; tests/rendercpu-culler numbers in docs/rendering-warmup.md): turning in place median
// 2.10 -> 1.39 ms, p95 3.41 -> 2.04 ms per update over 2,160 frames.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {LevelCuller} from '../src/world/levelCulling';
import {mallQaPose} from '../src/gen/mall/qa';
import {eyeCam, realMallScene, startPose, torchOn, type Pose} from './helpers/rendercpuMall';

type Proto = Record<string, (...a: unknown[]) => unknown>;
const COUNTED = ['slabHidden', 'sees', 'ray'] as const;

function counting<T>(fn: () => T): {r: T; n: Record<(typeof COUNTED)[number], number>} {
  const proto = LevelCuller.prototype as unknown as Proto;
  const n = {slabHidden: 0, sees: 0, ray: 0};
  const saved = COUNTED.map(k => proto[k]);
  COUNTED.forEach((k, i) => { proto[k] = function (this: unknown, ...a: unknown[]) { n[k]++; return saved[i].apply(this, a); }; });
  try { return {r: fn(), n}; } finally { COUNTED.forEach((k, i) => { proto[k] = saved[i]; }); }
}

const state = (c: LevelCuller) => ({
  masks: c.entries.map(e => e.obj.layers.mask).join(','),
  stats: JSON.stringify([c.stats.culled, c.stats.fogged, c.stats.tilesTested, c.stats.tilesVisible, c.stats.visibleLevels, c.stats.hops, c.slabCulled, c.occlusionCulled, c.apertureCulled, c.atriumStats]),
});

describe('mall culler: position-only caches are exact and remove the per-turn slab / sight work (real mall t3a)', () => {
  it('yaw sweeps + a walk: identical decisions to fresh computation; turning in place makes no slab test, sight test or ray', async () => {
    const M = await realMallScene('t3a');
    const c = M.world.culler;
    const poses: Pose[] = [startPose(M.layout)];
    for (const [n, r] of [['ring-edge', 2], ['escalator', 1], ['court', undefined], ['corridor', 1]] as const) {
      const p = mallQaPose(M.layout, n, r);
      if (p) poses.push({name: `${n}${r ?? ''}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: 0});
    }
    expect(poses.length).toBe(5);
    let compared = 0, turning = 0;
    const lines: string[] = [];
    for (const p of poses) {
      const cam = eyeCam(p), fl = torchOn(cam);
      c.viewpoints = [fl];
      const sum = {cached: {slabHidden: 0, sees: 0, ray: 0}, fresh: {slabHidden: 0, sees: 0, ray: 0}};
      for (let s = 0; s < 40; s++) {
        cam.rotation.set(s % 7 === 3 ? -0.3 : 0, p.yaw + s * 3 * Math.PI / 180, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        const cached = counting(() => c.update(cam, true));
        const a = state(c);
        c.forgetPositionCaches();
        const fresh = counting(() => c.update(cam, true));
        expect(state(c), `${p.name} step ${s}`).toEqual(a);
        compared++;
        if (s > 0) {
          turning++;
          for (const k of COUNTED) { sum.cached[k] += cached.n[k]; sum.fresh[k] += fresh.n[k]; }
        }
      }
      cam.remove(fl, fl.target);
      // turning in place (the eye never moves): a position-only test runs once per entry / tile / opening when it is first needed at
      // this eye position, not on every frame — over the 39 turning updates at most a few percent of the fresh (uncached) work
      lines.push(`${p.name}: cached ${JSON.stringify(sum.cached)} vs fresh ${JSON.stringify(sum.fresh)}`);
      expect(sum.fresh.slabHidden, p.name).toBeGreaterThan(5000); // the per-frame work exists (>= ~150 slab tests per update)
      expect(sum.cached.slabHidden, `${p.name} slab`).toBeLessThanOrEqual(sum.fresh.slabHidden / 20);
      expect(sum.cached.sees, `${p.name} sight tests`).toBeLessThanOrEqual(Math.max(2, sum.fresh.sees / 10));
      expect(sum.cached.ray, `${p.name} rays`).toBeLessThanOrEqual(Math.max(100, sum.fresh.ray / 10));
    }
    if (process.env.LL_RCPU_CULLER_OUT) (await import('node:fs')).writeFileSync(process.env.LL_RCPU_CULLER_OUT, lines.join('\n') + '\n');
    // a walk with turning (the eye moves every frame: every cache is recomputed for the new position, never reused stale)
    const p0 = poses[4], cam = eyeCam(p0), fl = torchOn(cam);
    c.viewpoints = [fl];
    for (let s = 0; s < 40; s++) {
      cam.position.set(p0.x + Math.sin(p0.yaw) * -0.15 * s, p0.y + 1.62, p0.z + Math.cos(p0.yaw) * -0.15 * s);
      cam.rotation.set(0, p0.yaw + Math.sin(s / 6) * 0.8, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      c.update(cam); // (the game's call: full update or the between-updates occlusion refresh)
      c.update(cam, true);
      const a = state(c);
      c.forgetPositionCaches();
      c.update(cam, true);
      expect(state(c), `walk step ${s}`).toEqual(a);
      compared++;
    }
    cam.remove(fl, fl.target);
    c.viewpoints = [];
    expect(compared).toBe(240);
    expect(turning).toBe(195);
    void THREE;
  }, 300_000);
});
