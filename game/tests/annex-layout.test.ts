// Task studio-alpha-track2-round3-20261031-01 (lane LAYOUT): the service annexes as a LOGICAL service area. User (round 3): "layout
// feels like it is not logical. The layout should have a logical arrangement matching what a real service area would be like. There
// must always be 1 cache room generated at least." Metrics: tests/helpers/annexLayoutMetrics.ts.
//
// Opt-in evidence (never in CI):
//   ANNEX_LAYOUT_EVIDENCE=1 [LAYOUT_LABEL=after] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 \
//     --no-file-parallelism game/tests/annex-layout.test.ts      -> qa-artifacts/r3-layout/<label>/*.png + /tmp/r3-layout-<label>.json
//   ANNEX_LAYOUT_BROAD=1 [LAYOUT_LABEL=after] ...                -> the broad sample (200 Subway + 40 Office + 20 Mall levels)
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel} from '../src/gen/mall/index';
import {freshLayout} from './helpers/annexRoute';
import {annexLayoutMetrics, summarize, type AnnexLayoutMetrics} from './helpers/annexLayoutMetrics';
import {annexPlanPng} from './helpers/annexPlan';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.env.LAYOUT_LABEL ?? 'after';

/** The plan-picture sample (the round-2 fresh-run levels + Subway 1037). */
const PLAN_SAMPLE: readonly [LevelId, number][] = [['subway', 1043], ['subway', 1002], ['subway', 1037], ['office', 222], ['mall', 846932]];

describe.runIf(!!process.env.ANNEX_LAYOUT_EVIDENCE)('annex layout evidence (ANNEX_LAYOUT_EVIDENCE=1)', () => {
  it('renders top-down plans of the sample annexes and writes their metrics', async () => {
    const out = path.resolve(GAME, '..', 'qa-artifacts', 'r3-layout', LABEL);
    fs.mkdirSync(out, {recursive: true});
    const all: AnnexLayoutMetrics[] = [];
    for (const [level, seed] of PLAN_SAMPLE) {
      const l = freshLayout(level, seed);
      for (const n of l.extensions?.annexes ?? []) {
        const tag = `${level}-${seed}-a${n.id}`;
        all.push(annexLayoutMetrics(l, n, tag));
        fs.writeFileSync(path.join(out, `${tag}.png`), await annexPlanPng(l, n, `${LABEL}: ${level} ${seed} annex ${n.id}${n.tunnel < 0 ? ' (hatch)' : ''}`));
      }
    }
    fs.writeFileSync(`/tmp/r3-layout-${LABEL}-sample.json`, JSON.stringify({summary: summarize(all), annexes: all}, null, 1));
    expect(all.length).toBeGreaterThan(0);
  }, 300000);
});

describe.runIf(!!process.env.ANNEX_LAYOUT_BROAD)('annex layout broad sample (ANNEX_LAYOUT_BROAD=1)', () => {
  it('200 Subway + 40 Office + 20 Mall levels: metrics and the hideout guarantee', () => {
    const levels: [string, () => StationLayout][] = [];
    const nSub = Number(process.env.BROAD_SUBWAY ?? 200), nOff = Number(process.env.BROAD_OFFICE ?? 40), nMall = Number(process.env.BROAD_MALL ?? 20);
    for (let i = 0; i < nSub; i++) { const s = (i * 2654435761 + 12345) >>> 0; levels.push([`subway-${s}`, () => generateStation(s)]); }
    for (let i = 0; i < nOff; i++) { const s = 1000 + i * 7919; levels.push([`office-${s}`, () => generateOfficeLevel({levelSeed: s, startWeapon: 'pistol'})]); }
    for (let i = 0; i < nMall; i++) { const s = 9100 + 104729 * i; levels.push([`mall-${s}`, () => generateMallLevel({levelSeed: s, startWeapon: 'rifle'})]); }
    const per: Record<string, AnnexLayoutMetrics[]> = {subway: [], office: [], mall: []};
    const misses: string[] = [], incidence: Record<string, number[]> = {subway: [0, 0, 0], office: [0, 0, 0], mall: [0, 0, 0]};
    const t0 = performance.now();
    for (const [tag, gen] of levels) {
      const l = gen(), kind = tag.split('-')[0];
      const ann = l.extensions?.annexes ?? [];
      incidence[kind][ann.length]++;
      for (const n of ann) {
        const m = annexLayoutMetrics(l, n, `${tag}-a${n.id}`);
        per[kind].push(m);
        if (!m.hideoutOk) misses.push(m.tag);
      }
    }
    const ms = performance.now() - t0;
    const all = [...per.subway, ...per.office, ...per.mall];
    fs.writeFileSync(`/tmp/r3-layout-${LABEL}-broad.json`, JSON.stringify({
      levels: levels.length, ms, incidence, misses,
      summary: {all: summarize(all), subway: summarize(per.subway), office: summarize(per.office), mall: summarize(per.mall)},
      annexes: all,
    }, null, 1));
    expect(all.length).toBeGreaterThan(0);
  }, 3600000);
});
