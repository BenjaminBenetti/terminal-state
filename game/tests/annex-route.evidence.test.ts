// Playtest revision evidence (opt-in: ANNEX_ROUTE=1): ordinary discovery routes through service annexes (tests/helpers/annexRoute.ts),
// real Player + real ZombieBrain, written to qa-artifacts/annex-route/<tag>.json. Not part of CI (minutes of simulated walking).
//   ANNEX_ROUTE=1 [ROUTE_TAG=baseline] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/annex-route.evidence.test.ts
import {beforeAll, describe, it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {openableModels} from './helpers/openablesFixture';
import {freshLayout, walkAnnexRoute, type RouteReport} from './helpers/annexRoute';
import type {LevelId} from '../src/levels/types';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
let models: Record<string, GLTF> = {};
beforeAll(async () => { if (process.env.ANNEX_ROUTE) models = await openableModels(); }, 120000);

/** The locked representative sample (REPORT §1): two fresh Subway runs (tunnel + hatch), plus an Office and a Mall annex. */
export const ROUTE_SAMPLE: readonly {level: LevelId; seed: number}[] = [
  {level: 'subway', seed: 1043}, {level: 'subway', seed: 1002}, {level: 'office', seed: 222}, {level: 'mall', seed: 846932},
];

describe.runIf(!!process.env.ANNEX_ROUTE)('annex discovery routes (evidence)', () => {
  it.runIf(process.env.ROUTE_ONLY !== 'deeper' && process.env.ROUTE_ONLY !== 'marks')('walks every annex of the sample', () => {
    const out: RouteReport[] = [];
    for (const c of ROUTE_SAMPLE) {
      const l = freshLayout(c.level, c.seed);
      for (const a of l.extensions?.annexes ?? []) out.push(walkAnnexRoute(c.level, c.seed, a.id, models, {maxRooms: Number(process.env.ROUTE_ROOMS ?? 10)}));
    }
    mkdirSync('qa-artifacts/annex-route', {recursive: true});
    writeFileSync(`qa-artifacts/annex-route/${process.env.ROUTE_TAG ?? 'run'}.json`, JSON.stringify(out, null, 1));
  }, 1800000);

  // Round 2 (studio-alpha-track2-round2-20261031-01, lane CACHE, R5): an explorer pushing on toward the annex's deep end ('deeper': the
  // deepest frontier room by door hops, ties by walking distance — topology only, never the cache ground truth), opening what it
  // passes; records when it reaches a survivor cache (rooms / metres / depth), the cache holders opened, their ids, the inventory delta.
  //   ANNEX_ROUTE=1 ROUTE_ONLY=deeper [ROUTE_TAG=cache] [ROUTE_ROOMS_DEEP=40] ./node_modules/.bin/vitest run ... game/tests/annex-route.evidence.test.ts
  it.runIf(process.env.ROUTE_ONLY !== 'nearest' && process.env.ROUTE_ONLY !== 'marks')('walks every annex of the sample toward its deep end (survivor caches)', () => {
    const out: RouteReport[] = [];
    for (const c of ROUTE_SAMPLE) {
      const l = freshLayout(c.level, c.seed);
      for (const a of l.extensions?.annexes ?? []) out.push(walkAnnexRoute(c.level, c.seed, a.id, models, {strategy: 'deeper', maxRooms: Number(process.env.ROUTE_ROOMS_DEEP ?? 40), openPerRoom: 10}));
    }
    mkdirSync('qa-artifacts/annex-route', {recursive: true});
    writeFileSync(`qa-artifacts/annex-route/${process.env.ROUTE_TAG ?? 'run'}-deeper.json`, JSON.stringify(out, null, 1));
    // compact summary (console output is swallowed by the runner)
    writeFileSync('/tmp/annex-route-deeper.txt', out.map(r => `${r.level} ${r.seed} annex ${r.annex} (${r.entry}): rooms ${r.roomsVisited}/${r.roomsTotal}, ${r.metres} m, depth ${r.depthReached}/${r.maxDepth}; `
      + `cache ${r.cache ? `room ${r.cache.area} at ${r.cache.metres} m / ${r.cache.rooms} rooms / depth ${r.cache.depth}; opened ${r.cache.holdersOpened} [${r.cache.holderIds.join(' ')}] took ${JSON.stringify(r.cache.taken)}` : 'NOT REACHED'}; `
      + `inventory ${JSON.stringify(r.inventory)}; enemies aware ${r.enemies.aware}/${r.enemies.total}; returned ${r.returned}`).join('\n') + '\n');
  }, 3600000);

  // Round 3 (studio-alpha-track2-round3-20261031-01, lane HIDEOUT): a player following ONLY the survivor's trail they can see (strategy
  // 'marks': the marks on the walls of the area they stand in, read by helpers/cacheMarks.ts — never the cache / the record's door), vs
  // the round-2 topology-only 'deeper' explorer on the same layouts (ROUTE_DEEPER=0 skips it: the slow one).
  //   ANNEX_ROUTE=1 ROUTE_ONLY=marks [ROUTE_TAG=hideout] [ROUTE_DEEPER=0] ./node_modules/.bin/vitest run ... game/tests/annex-route.evidence.test.ts
  it.runIf(process.env.ROUTE_ONLY === 'marks')('follows the survivor\'s trail to the hideout (vs the topology-only deep route)', () => {
    const out: {marks: RouteReport; deeper: RouteReport | null}[] = [];
    for (const c of ROUTE_SAMPLE) {
      const l = freshLayout(c.level, c.seed);
      for (const a of l.extensions?.annexes ?? []) {
        const marks = walkAnnexRoute(c.level, c.seed, a.id, models, {strategy: 'marks', maxRooms: 80});
        const deeper = process.env.ROUTE_DEEPER === '0' ? null : walkAnnexRoute(c.level, c.seed, a.id, models, {strategy: 'deeper', maxRooms: Number(process.env.ROUTE_ROOMS_DEEP ?? 60), openPerRoom: 10});
        out.push({marks, deeper});
      }
    }
    mkdirSync('qa-artifacts/annex-route', {recursive: true});
    writeFileSync(`qa-artifacts/annex-route/${process.env.ROUTE_TAG ?? 'run'}-marks.json`, JSON.stringify(out, null, 1));
    const fmt = (r: RouteReport | null) => (!r ? 'skipped' : r.cache ? `cache after ${r.cache.rooms} rooms / ${r.cache.metres} m (depth ${r.cache.depth}/${r.maxDepth}), opened ${r.cache.holdersOpened}, took ${JSON.stringify(r.cache.taken)}` : `NOT REACHED (${r.roomsVisited} rooms, ${r.metres} m)`);
    writeFileSync('/tmp/annex-route-marks.txt', out.map(({marks: m, deeper: d}) => `${m.level} ${m.seed} annex ${m.annex} (${m.entry}, ${m.roomsTotal} areas): MARKS ${fmt(m)}; trail ${JSON.stringify(m.trail)} | DEEPER ${fmt(d)}`).join('\n') + '\n');
  }, 3600000);
});
