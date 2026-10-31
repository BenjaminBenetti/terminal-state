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
  it('walks every annex of the sample', () => {
    const out: RouteReport[] = [];
    for (const c of ROUTE_SAMPLE) {
      const l = freshLayout(c.level, c.seed);
      for (const a of l.extensions?.annexes ?? []) out.push(walkAnnexRoute(c.level, c.seed, a.id, models, {maxRooms: Number(process.env.ROUTE_ROOMS ?? 10)}));
    }
    mkdirSync('qa-artifacts/annex-route', {recursive: true});
    writeFileSync(`qa-artifacts/annex-route/${process.env.ROUTE_TAG ?? 'run'}.json`, JSON.stringify(out, null, 1));
  }, 1800000);
});
