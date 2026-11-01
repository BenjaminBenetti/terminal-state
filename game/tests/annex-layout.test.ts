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
import {extensionIssues, TRACK_EXT} from '../src/gen/trackExt/index';
import {ANNEX_ROOMS, ROOM_SIGNATURES, SIGNATURE_IDS, SIGNATURE_OF_PURPOSE, annexDoorGraph} from '../src/gen/annexRooms';
import {annexSignatureOf} from '../src/gen/annexContent';
import {freshLayout} from './helpers/annexRoute';
import {annexLayoutMetrics, bandOf, hideoutOk, summarize, type AnnexLayoutMetrics} from './helpers/annexLayoutMetrics';
import {annexPlanPng} from './helpers/annexPlan';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = process.env.LAYOUT_LABEL ?? 'after';

/** The CI sample: tunnel annexes, a tunnel + hatch level, a two-annex level, the Office street station and the mall (~9 annexes). */
const CI_SAMPLE: readonly [string, () => StationLayout][] = [
  ['subway 1043', () => generateStation(1043)], ['subway 1002', () => generateStation(1002)], ['subway 2563024239', () => generateStation(2563024239)],
  ['subway 774566179', () => generateStation(774566179)], ['office 222', () => generateOfficeLevel({levelSeed: 222, startWeapon: 'pistol'})],
  ['mall 846932', () => generateMallLevel({levelSeed: 846932, startWeapon: 'rifle'})],
];

describe('service annex layout: a logical service area (round 3, lane LAYOUT)', () => {
  let cached: (readonly [string, StationLayout])[] | null = null;
  const sample = () => (cached ??= CI_SAMPLE.map(([tag, gen]) => [tag, gen()] as const));

  it('rooms lined up along corridors (no maze): every room / hall / closet opens onto a corridor, every corridor serves rooms, long straight runs', () => {
    const all: AnnexLayoutMetrics[] = [];
    for (const [tag, l] of sample()) {
      expect(extensionIssues(l), tag).toEqual([]);
      for (const n of l.extensions!.annexes) {
        const m = annexLayoutMetrics(l, n, `${tag} annex ${n.id}`);
        all.push(m);
        // (only the hideout may be an inner store room behind a deep room, when no corridor bay was left for it)
        expect(m.roomsOnCorridor + m.closetsOnCorridor, `${m.tag} rooms on a corridor`).toBeGreaterThanOrEqual(m.rooms + m.closets - 1);
        expect(m.viaRooms, `${m.tag} rooms reached only through rooms`).toBeLessThanOrEqual(1);
        expect(m.maxRoomChain).toBeLessThanOrEqual(1);
        expect(m.corridorsNoRoom, `${m.tag} corridors serving no room`).toBe(0);
        expect(m.corridors).toBeGreaterThanOrEqual(3);
        expect(m.corridors).toBeLessThanOrEqual(24);
        expect(m.longestStraightM, `${m.tag} main corridor`).toBeGreaterThanOrEqual(20);
        expect(m.halls, `${m.tag} machinery halls`).toBeGreaterThanOrEqual(1);
        expect(m.halls).toBeLessThanOrEqual(TRACK_EXT.annex.hall!.count[1]);
      }
    }
    const s = summarize(all);
    fs.writeFileSync('/tmp/r3-layout-ci.json', JSON.stringify(s, null, 1));
    // functional zoning over the sample: most signature rooms have their partner next door / across the corridor
    const pairs = all.reduce((t, m) => t + m.adjPairs, 0), ok = all.reduce((t, m) => t + m.adjOk, 0);
    expect(ok / pairs, 'functional adjacency').toBeGreaterThanOrEqual(0.6);
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it('zones: staff rooms along the entry passage and the junction (no machinery there but halls), plant districts deeper, no repeats within 3 hops', () => {
    for (const [tag, l] of sample()) {
      for (const n of l.extensions!.annexes) {
        const areas = n.areas.map(id => l.areas[id]), dMin = Math.min(...areas.map(a => a.depth));
        const {adj} = annexDoorGraph(l, areas);
        for (const a of areas) {
          if (a.kind === 'service') continue;
          const host = (adj.get(a.id) ?? []).map(id => l.areas[id]).filter(c => c.kind === 'service').sort((p, q) => p.depth - q.depth)[0];
          if (host && host.depth <= dMin + 1 && !a.extHall) expect(annexSignatureOf(a), `${tag} annex ${n.id} ${a.purpose} in the staff zone`).toBeUndefined();
        }
        // the 3-hop anti-repetition (ANNEX_ROOMS.hops)
        for (const a of areas) {
          const s = annexSignatureOf(a);
          if (!s) continue;
          const d = new Map([[a.id, 0]]), q = [a.id];
          for (let h = 0; h < q.length; h++) for (const o of adj.get(q[h]) ?? []) if (!d.has(o) && d.get(q[h])! < ANNEX_ROOMS.hops) { d.set(o, d.get(q[h])! + 1); q.push(o); }
          for (const id of q) if (id !== a.id) expect(annexSignatureOf(l.areas[id]), `${tag} rooms ${a.id} / ${id} both ${s}`).not.toBe(s);
        }
      }
    }
    expect(ANNEX_ROOMS.hops).toBeGreaterThanOrEqual(2);
  });

  it('THE HIDEOUT: every annex records a dead-end store room of >= 3.5 x 4 m / 14 m² in the deepest third, never a closet / hall / signature', () => {
    for (const [tag, l] of sample()) {
      for (const n of l.extensions!.annexes) {
        const t = `${tag} annex ${n.id}`;
        expect(n.hideout, `${t} hideout`).toBeDefined();
        const h = l.areas[n.hideout!];
        expect(hideoutOk(l, n, n.hideout!), `${t} hideout rule`).toBe(true);
        expect(h.kind).toBe('room');
        expect(h.extHall).toBeFalsy();
        expect(annexSignatureOf(h)).toBeUndefined();
        expect(h.purpose, `${t} the old stores`).toBe('storage');
        expect(l.doors.filter(d => d.a === h.id || d.b === h.id).length, `${t} hideout doors`).toBe(1);
        const ds = n.areas.map(id => l.areas[id].depth);
        expect(bandOf(h.depth, Math.min(...ds), Math.max(...ds))).toBe(2);
      }
    }
    // the record is validated: a hideout that is not a plain room of its annex is an extension issue
    const l = sample()[0][1], n = l.extensions!.annexes[0], keep = n.hideout;
    n.hideout = n.areas[0];
    expect(extensionIssues(l).some(q => /hideout/.test(q))).toBe(true);
    n.hideout = keep;
    expect(extensionIssues(l)).toEqual([]);
    // the validation's signature purposes are the registry's
    expect([...SIGNATURE_IDS.map(s => ROOM_SIGNATURES[s].purpose)].sort()).toEqual(Object.keys(SIGNATURE_OF_PURPOSE).sort());
  });
});

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
