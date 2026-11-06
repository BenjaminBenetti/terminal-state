// 2026-11-01 (task studio-alpha-bts-round4-compliance-followup-20261101-01, lane OFFICE). User: the ACTUAL Beyond the Station area
// occurrence is 20 % on every level type. The Office (TRACK_EXT_OFFICE, the original planner: annexes off eligible tunnels only) left
// ~7 % of its PRESENT rolls without an annex: its fixed east / south canvas often leaves every tunnel's first straight too short for a
// door (and many bed ends with no tunnel at all). THE PRESENCE FALLBACK (TrackExtConfig.fallbackHatch, gen/trackExt/index.ts): such a
// level gets ONE service-hatch annex — the Subway's lawful GEN-2 bed-wall entry (Carver.planHatch, TRACK_EXT.hatch's 2-10 m window) —
// at its open bed ends in a seeded order on its own fork rng.fork('annex-fallback'). Same single roll and 0.2; nothing else changes.
//  - config: an explicit Office option; the Subway / Mall configs carry none (their planner is untouched);
//  - the formerly-failing PRESENT seeds (31702 + every one of the first 330 present corpus seeds): exactly one hatch annex now, the
//    tunnels / log / core / attempt exactly as before, every invariant, the area's content (hideout, caches, marks, loot, lights,
//    service spawns from the service pool incl. the Strainer's, the invitation art, the hatch clues);
//  - byte-identical where the fallback never runs (present levels with a tunnel annex, absent levels);
//  - determinism (twice, the raw attempt, a revisit through the run);
//  - opt-in OFFICE_AREA_FALLBACK_BROAD=1: 666 present seeds in three families (the first 330 present corpus seeds + 31702, the present
//    seeds of 1-700, 200 present seeds of the 7777 family), old vs new, census + timing into /tmp/office-area-fallback-broad.txt.
import {writeFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {generateOfficeLevel, officeAttempt, officeIssues, towerFrame} from '../src/gen/office/index';
import {
  BTS_AREA_CHANCE, TRACK_EXT, TRACK_EXT_MALL, TRACK_EXT_OFFICE, btsAreaPresent, btsAreaRoll, coreView, extensionIssues, trackExtConfig, type TrackExtConfig,
} from '../src/gen/trackExt/index';
import {annexCachesOf} from '../src/gen/annexCache';
import {cacheMarkIssues} from '../src/gen/annexMarks';
import {extensionContentOf} from '../src/gen/annexContent';
import {SERVICE_ZONE_BUDGET, spawnContextOf, spawnProfile} from '../src/ai/spawnTables';
import {LEVELS} from '../src/levels/registry';
import {createRun} from '../src/run/runState';
import type {StationLayout} from '../src/gen/stationTypes';
import {canonDiff, canonLayout} from './helpers/trackExtCore';
import {absentSeeds, presentSeeds} from './helpers/btsArea';

const report = (s: string) => process.stdout.write(`[office-area-fallback] ${s}\n`);
/** The census corpus formula of the track-extension tests. */
const corpus = (i: number) => (i * 2654435761 + 12345) >>> 0;
/** The Office exactly as before the fallback (the reference: every other setting live). */
const BEFORE: TrackExtConfig = {...TRACK_EXT_OFFICE, fallbackHatch: undefined};
const live = (levelSeed: number): StationLayout => LEVELS.office.generate('main', {levelSeed, startWeapon: 'pistol'} as never);
const before = (levelSeed: number): StationLayout => generateOfficeLevel({levelSeed, startWeapon: 'pistol'}, undefined, undefined, BEFORE);
const cache = new Map<string, StationLayout>();
const memo = (k: string, f: () => StationLayout) => { let l = cache.get(k); if (!l) cache.set(k, (l = f())); return l; };
const liveOf = (s: number) => memo(`live:${s}`, () => live(s));
const beforeOf = (s: number) => memo(`before:${s}`, () => before(s));
/** Byte-level identity of two generated levels: every core record + grid digest and the extensions record. */
const sameLevel = (a: StationLayout, b: StationLayout): string[] => [
  ...canonDiff(canonLayout(a), canonLayout(b)),
  ...(JSON.stringify(a.extensions) === JSON.stringify(b.extensions) ? [] : ['extensions']),
];

/**
 * THE FORMERLY-FAILING PRESENT OFFICE SEEDS: 31702 (the primary's diagnosis seed) and EVERY seed of the first 330 corpus seeds that roll
 * the area present whose eligible tunnels placed no annex before the fallback (22 / 330: measured with BEFORE, re-proven below).
 */
const FORMER = [
  31702, 3689933781, 78096452, 2366836745, 4268300121, 2001141277, 3789599337, 3458825078, 2396659883, 1848116681, 1095144296, 2496325439,
  2369980363, 420256018, 2765498969, 1442401933, 2182034558, 210728764, 2147113349, 3387028207, 2760400898, 1084948154, 275473111,
];

/** The fallback's own checks of one formerly-failing level (returns its hatch annex). */
function checkFallback(s: number, l: StationLayout, ref: StationLayout): NonNullable<StationLayout['extensions']>['annexes'][number] {
  const e = l.extensions!, r = ref.extensions!, tag = `office ${s}`;
  expect(e.area, tag).toEqual({roll: btsAreaRoll(s), chance: BTS_AREA_CHANCE, present: true});
  // formerly failing: present, no annex; every tunnel honestly logged ineligible / omitted
  expect(r.area!.present, tag).toBe(true);
  expect(r.annexes, `${tag}: before`).toEqual([]);
  expect(r.log.filter(g => /^annex: /.test(g.result)).every(g => /not eligible|omitted/.test(g.result)), tag).toBe(true);
  // now: exactly ONE annex, behind a service hatch at a bed end no tunnel continues
  expect(e.annexes.length, tag).toBe(1);
  const n = e.annexes[0];
  expect(n.tunnel, tag).toBe(-1);
  expect(n.bed, tag).toBeTruthy();
  expect(e.tunnels.some(t => t.trench === n.bed!.trench && t.from === n.bed!.from), `${tag}: hatch at a tunnel's end`).toBe(false);
  expect(n.bed!.s, tag).toBeGreaterThanOrEqual(TRACK_EXT.hatch!.s[0] - 0.5);
  expect(n.bed!.s, tag).toBeLessThanOrEqual(TRACK_EXT.hatch!.s[1] + 0.5);
  // nothing else changed: the tunnels (no door, no clue), their log, the core, the attempt
  expect(JSON.stringify(e.tunnels), `${tag}: tunnels`).toBe(JSON.stringify(r.tunnels));
  expect(e.tunnels.every(t => !t.doors.length && !t.clues.length), tag).toBe(true);
  expect(e.log.slice(0, r.log.length), `${tag}: log prefix`).toEqual(r.log);
  const extra = e.log.slice(r.log.length);
  expect(extra.every(g => /^(hatch fallback: |annex 0 via a fallback bed hatch )/.test(g.result)), `${tag}: ${JSON.stringify(extra)}`).toBe(true);
  expect(extra.filter(g => /via a fallback bed hatch/.test(g.result)).length, tag).toBe(1);
  expect(l.attempt, `${tag}: attempt`).toBe(ref.attempt);
  expect(canonDiff(canonLayout(coreView(l)), canonLayout(coreView(ref))), `${tag}: core view`).toEqual([]);
  // every invariant (extensionIssues incl. hatchIssues: the door joins the bed and an annex corridor in the bed's side wall with rock
  // jambs; every annex cell reachable and walkable back to a ladder of that bed; no orphan door / stranded room) and the whole level
  expect(extensionIssues(l), tag).toEqual([]);
  expect(officeIssues(l, towerFrame(s), spawnProfile('office')), tag).toEqual([]);
  expect(cacheMarkIssues(l), tag).toEqual([]);
  // the area's content, conditional and intact on the fallback annex
  const ids = new Set(n.areas), P = spawnProfile('office');
  expect(extensionContentOf(l)?.annexes.length, tag).toBe(1);
  expect(n.hideout !== undefined && ids.has(n.hideout), `${tag} hideout`).toBe(true);
  expect(annexCachesOf(l).filter(c => c.annex === n.id).length, `${tag} caches`).toBeGreaterThanOrEqual(1);
  expect((e.cacheMarks ?? []).filter(m => m.annex === n.id).length, `${tag} survivor marks`).toBeGreaterThan(0);
  expect(l.props.filter(p => ids.has(p.area)).length, `${tag} props`).toBeGreaterThan(10);
  expect(l.lights.filter(x => ids.has(x.area)).length, `${tag} lights`).toBeGreaterThan(0);
  const svc = l.zombies.map((z, i) => [z, i] as const).filter(([z]) => ids.has(z.area));
  expect(svc.length, `${tag} service spawns`).toBeGreaterThanOrEqual(SERVICE_ZONE_BUDGET[0]);
  expect(svc.length, `${tag} service spawns`).toBeLessThanOrEqual(SERVICE_ZONE_BUDGET[1]);
  for (const [z, i] of svc) {
    expect(spawnContextOf(l, P, i), `${tag} #${i}`).toBe('service');
    // drawn from the service context's OWN pool (the Strainer has weight only there)
    expect((P.contexts.service?.families ?? P.families).some(([f, w]) => f === (z.archetype ?? 'zombie') && w > 0), `${tag} #${i} ${z.archetype}`).toBe(true);
  }
  // the station invitation art announces the hatch (measured: 1-4 pieces at every one of 56 fallback hatches over 666 present seeds)
  const art = (e.art ?? []).filter(a => a.annex === n.id);
  expect(art.length, `${tag} invitation art`).toBeGreaterThan(0);
  expect(art.every(a => a.entry === 'hatch' && a.trench === n.bed!.trench && a.from === n.bed!.from), tag).toBe(true);
  return n;
}

describe('the Office presence fallback (one seeded service hatch when a PRESENT roll placed no tunnel annex)', () => {
  it('is an explicit Office option (the Subway hatch window); the Subway / Mall planners carry none', () => {
    expect(TRACK_EXT_OFFICE.fallbackHatch).toEqual(TRACK_EXT.hatch);
    expect(TRACK_EXT.hatch).toEqual({s: [2, 10]});
    // the GEN-2 planner stays off on the Office: no count, no host first straight, no hatches as ordinary candidates
    expect(TRACK_EXT_OFFICE.annex.count).toBeUndefined();
    expect(TRACK_EXT_OFFICE.annex.hostFirstStraight).toBeUndefined();
    expect(TRACK_EXT_OFFICE.hatch).toBeUndefined();
    expect(TRACK_EXT_OFFICE.annex.max).toBe(2);
    for (const cfg of [TRACK_EXT, TRACK_EXT_MALL, trackExtConfig('subway'), trackExtConfig('mall')]) expect(cfg.fallbackHatch).toBeUndefined();
    expect(TRACK_EXT_MALL.annex.max).toBe(1);
    expect(LEVELS.office.trackExtensions).toBe(TRACK_EXT_OFFICE);
    for (const s of FORMER) expect(btsAreaPresent(s), `${s}`).toBe(true);
  });

  it('Office 31702 (present, every tunnel ineligible): exactly one hatch annex, the tunnels / core / attempt unchanged', () => {
    const l = liveOf(31702), n = checkFallback(31702, l, beforeOf(31702));
    report(`31702: annex 0 via the ${n.bed!.wall} wall hatch of bed ${n.bed!.trench}${n.bed!.from}, s ${n.bed!.s} m, ${Math.round(n.areaM2)} m² in ${n.areas.length} areas; tunnels ${l.extensions!.tunnels.length}, clues ${n.bed!.clues.length}, art ${(l.extensions!.art ?? []).length}`);
  }, 120000);

  it('every formerly-failing present seed of the corpus cohort: exactly one hatch annex with its content; nothing else changed', () => {
    let clues = 0, art = 0, hatchArt = 0;
    const t0 = performance.now();
    for (const s of FORMER) {
      const l = liveOf(s), n = checkFallback(s, l, beforeOf(s));
      clues += n.bed!.clues.length;
      const a = (l.extensions!.art ?? []).filter(x => x.annex === n.id).length;
      art += a; if (a) hatchArt++;
    }
    report(`${FORMER.length} formerly-failing present seeds: ${FORMER.length} / ${FORMER.length} with one hatch annex; hatch clues ${clues}, invitation art ${art} pieces at ${hatchArt} hatches; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    expect(clues, 'hatch graffiti clues over the cohort').toBeGreaterThan(0);
    expect(hatchArt, 'hatches announced by station art').toBe(FORMER.length);
  }, 600000);

  it('byte-identical where the fallback never runs: present levels with a tunnel annex, absent levels', () => {
    const withTunnel = presentSeeds(3, corpus), absent = absentSeeds(2, corpus);
    for (const s of withTunnel) {
      const l = liveOf(s), r = beforeOf(s);
      expect(r.extensions!.annexes.length, `${s}: a tunnel annex before`).toBeGreaterThanOrEqual(1);
      expect(r.extensions!.annexes.every(n => n.tunnel >= 0 && !n.bed), `${s}`).toBe(true);
      expect(sameLevel(l, r), `present ${s}`).toEqual([]);
      expect(l.extensions!.log.some(g => /fallback/.test(g.result)), `${s}`).toBe(false);
    }
    for (const s of absent) {
      const l = liveOf(s);
      expect(l.extensions!.area!.present).toBe(false);
      expect(l.extensions!.annexes).toEqual([]);
      expect(sameLevel(l, beforeOf(s)), `absent ${s}`).toEqual([]);
    }
  }, 300000);

  it('determinism: the same level twice, the raw attempt, and a revisit through the run', () => {
    const s = 31702, a = liveOf(s), b = live(s);
    expect(sameLevel(b, a)).toEqual([]);
    // the accepted attempt reproduced on its own (generation seed of that attempt; the roll stays the LEVEL seed's)
    const raw = officeAttempt({levelSeed: s, startWeapon: 'pistol'}, a.attempt)!;
    expect(JSON.stringify(raw.extensions)).toBe(JSON.stringify(a.extensions));
    // a revisit: the run keeps only the level seeds; the level regenerates identically (its fallback hatch included)
    const run = createRun({seeds: {subway: 1, office: s, mall: 2, skyways: 707, reactor: 3}, start: {level: 'office', section: 'main'}, levels: LEVELS});
    const again = LEVELS.office.generate('main', {levelSeed: run.seeds.office, startWeapon: 'pistol'} as never);
    expect(sameLevel(again, a)).toEqual([]);
    expect(again.extensions!.annexes.map(n => !!n.bed)).toEqual([true]);
  }, 120000);
});

describe.runIf(!!process.env.OFFICE_AREA_FALLBACK_BROAD)('the broad present cohort (opt-in OFFICE_AREA_FALLBACK_BROAD=1)', () => {
  it('666 present seeds in three families: every present Office level has the area; the fallback changes only the formerly-failing ones', () => {
    const cohorts: Record<string, number[]> = {
      corpus: [31702, ...presentSeeds(330, corpus)],
      'seeds 1-700': Array.from({length: 700}, (_, i) => i + 1).filter(btsAreaPresent),
      '7777': presentSeeds(200, i => (i * 2654435761 + 7777) >>> 0),
    };
    const lines: string[] = [], ms = {fbLive: 0, fbBefore: 0, nLive: 0, nBefore: 0};
    let fbCount = 0, nCount = 0;
    for (const [name, seeds] of Object.entries(cohorts)) {
      let realised = 0, tunnelAnnex = 0, fallback = 0, two = 0;
      const t0 = performance.now();
      for (const s of seeds) {
        const a = performance.now(), l = live(s), b = performance.now(), r = before(s), c = performance.now(), n = l.extensions!.annexes.length;
        if (n) realised++;
        if (n === 2) two++;
        if (r.extensions!.annexes.length) {
          tunnelAnnex++;
          ms.nLive += b - a; ms.nBefore += c - b; nCount++;
          expect(sameLevel(l, r), `${s}`).toEqual([]);
        } else {
          fallback++;
          ms.fbLive += b - a; ms.fbBefore += c - b; fbCount++;
          const h = checkFallback(s, l, r), svc = l.zombies.filter(z => h.areas.includes(z.area)).length;
          lines.push(`${name} ${s}: bed ${h.bed!.trench}${h.bed!.from} ${h.bed!.wall} s ${h.bed!.s} ${Math.round(h.areaM2)} m² ${h.areas.length} areas, clues ${h.bed!.clues.length}, art ${(l.extensions!.art ?? []).length}, service ${svc}, caches ${annexCachesOf(l).length}`);
        }
      }
      const msg = `${name}: ${seeds.length} present, ${realised} with the area (${tunnelAnnex} tunnel annex levels byte-identical, ${fallback} via the fallback hatch, ${two} with two); ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      report(msg);
      lines.unshift(msg);
      expect(realised, name).toBe(seeds.length);
      if (name === 'corpus') { expect(FORMER.every(s => seeds.includes(s))).toBe(true); expect(fallback).toBe(FORMER.length); }
    }
    const timing = `mean generation ms (live / before): fallback levels ${(ms.fbLive / fbCount).toFixed(0)} / ${(ms.fbBefore / fbCount).toFixed(0)} (${fbCount}), other present levels ${(ms.nLive / nCount).toFixed(0)} / ${(ms.nBefore / nCount).toFixed(0)} (${nCount})`;
    report(timing);
    writeFileSync('/tmp/office-area-fallback-broad.txt', [timing, ...lines].join('\n') + '\n');
  }, 7200000);
});
