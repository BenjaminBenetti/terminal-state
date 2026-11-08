// 2026-11-01 (lane AREA). User: "drop the spawn chance of the beyond the station area ... twenty percent ... across all levels".
// THE BEYOND THE STATION AREA — the service annexes behind tunnel doors / bed hatches with everything that belongs to them (hideouts,
// caches, survivor marks, graffiti clues, station invitation art, annex loot / lights / vents / machinery, service spawns) — exists on a
// generated level only when the level's ONE seeded roll succeeds: btsAreaRoll(levelSeed) < BTS_AREA_CHANCE (0.2), a pure hash of the
// logical level seed (gen/trackExt/config.ts), the same rule and constant for every level type on the shared attach path.
//  - the roll: >= 60,000 seeds at 0.2 within a tight binomial band, independent of the seed family, the Subway archetype and the mall
//    variant; the same roll on every level type for a seed; recorded on every plan (layout.extensions.area);
//  - ABSENT and PRESENT levels of EVERY registered track-bearing level type (Subway, Office, Mall) through the production registry path:
//    absent => zero annexes and nothing of the area; present => the annexes with their guaranteed hideout, caches, marks, loot, spawns;
//  - core-view invariance (the core never depends on the roll), determinism (twice, either generation order, every attempt, a revisit);
//  - realised occurrence per level type over 250 seeds each (the cheap roll picks; every present level is generated): 0.2 on every
//    type — (2026-11-01, lane OFFICE) a present Office level whose tunnels are all ineligible takes ONE fallback service hatch.
import {describe, expect, it} from 'vitest';
import {generateAttempt, generateStation, pickArchetype} from '../src/gen/station';
import {generateOfficeLevel, officeAttempt} from '../src/gen/office/index';
import {generateMallLevel, mallAttempt} from '../src/gen/mall/index';
import {generateSkywaysLevel} from '../src/gen/skyways/index'; // task studio-skyways-level-20261106-054448-01
import {generateReactorLevel} from '../src/gen/reactor/index'; // task reactor-build-20261101 (lane GEN): the reactor's core reference
import {mallVariantOf} from '../src/gen/mall/frame';
import {BTS_AREA_CHANCE, btsAreaPresent, btsAreaRoll, coreView, isExtensionArea, type TrackExtConfig} from '../src/gen/trackExt/index';
import {annexCachesOf} from '../src/gen/annexCache';
import {extensionContentOf} from '../src/gen/annexContent';
import {SERVICE_ZONE_BUDGET} from '../src/ai/spawnTables';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {createRun} from '../src/run/runState';
import {Rng} from '../src/core/rng';
import type {StationLayout} from '../src/gen/stationTypes';
import type {LevelId} from '../src/levels/types';
import {canonDiff, canonLayout} from './helpers/trackExtCore';
import {FRESH, absentSeeds, presentSeeds} from './helpers/btsArea';
import {freshLayout} from './helpers/annexRoute';
import {placeSubwayMapKiosks} from '../src/gen/subwayMapKiosks';

const report = (s: string) => process.stdout.write(`[bts-area] ${s}\n`);
/** The census corpus formula of the track-extension tests. */
const corpus = (i: number) => (i * 2654435761 + 12345) >>> 0;
/** Every registered level whose generator plans track extensions (a future one joins automatically). */
const TRACK_LEVELS = LEVEL_IDS.filter(id => LEVELS[id].trackExtensions !== 'none');
/** The production path (levels/registry.ts: the level's own TrackExtConfig). */
const live = (level: LevelId, levelSeed: number): StationLayout => LEVELS[level].generate('main', {levelSeed, startWeapon: 'pistol'} as never);
/** The same level whose planner may place NO annex (annex.max 0; the core reserve and tunnels as live): the core reference. */
const noAnnex = (cfg: TrackExtConfig): TrackExtConfig => ({...cfg, annex: {...cfg.annex, max: 0}});
const reference = (level: LevelId, levelSeed: number): StationLayout => {
  const cfg = noAnnex(LEVELS[level].trackExtensions as TrackExtConfig);
  // (task studio-ui-subway-maps-20261108-074144-01) the Subway's registry path ends with its station map kiosks: the reference gets the same pass
  if (level === 'subway') { const l = generateStation(levelSeed, {startWeapon: 'pistol', trackExtensions: cfg}); placeSubwayMapKiosks(l); return l; }
  return level === 'office' ? generateOfficeLevel({levelSeed, startWeapon: 'pistol'}, undefined, undefined, cfg)
      : level === 'reactor' ? generateReactorLevel({levelSeed, startWeapon: 'pistol'}, {trackExt: cfg}) // task reactor-build-20261101 (lane GEN)
        : level === 'skyways' ? generateSkywaysLevel({levelSeed, startWeapon: 'pistol'}, {trackExt: cfg}) // task studio-skyways-level-20261106-054448-01
          : generateMallLevel({levelSeed, startWeapon: 'pistol'}, {trackExt: cfg});
};
/**
 * Canonical core view. The mall's locked street-exit halls are an APPEND-ONLY post-pass after the attach (gen/mall/exits.ts): their
 * area ids follow the extension areas, so the mall record's exits are compared with those ids taken out (everything else exact).
 */
const canonCore = (l: StationLayout): Record<string, unknown> => {
  const c = canonLayout(coreView(l));
  const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'area').map(([k, x]) => [k, strip(x)])) : v;
  if (c.mall && typeof c.mall === 'object') c.mall = {...(c.mall as Record<string, unknown>), exits: strip((c.mall as Record<string, unknown>).exits)};
  return c;
};
const cache = new Map<string, StationLayout>();
const gen = (level: LevelId, s: number) => { const k = `${level}:${s}`; let l = cache.get(k); if (!l) cache.set(k, (l = live(level, s))); return l; };
/** Two absent and two present levels per type (the real roll picks them from the corpus formula). */
const ABSENT = absentSeeds(2, corpus), PRESENT = presentSeeds(2, corpus);

/** Every trace of the area: annex areas / doors / hatches / clues / art / marks / caches / machinery / vents / content in their areas. */
function areaTraces(l: StationLayout): Record<string, number> {
  const e = l.extensions!, annexArea = (id: number) => l.areas[id]?.ext === 'annex';
  const inExt = (r: {area: number}) => isExtensionArea(l.areas[r.area]);
  return {
    annexes: e.annexes.length,
    annexAreas: l.areas.filter(a => a.ext === 'annex').length,
    annexDoors: l.doors.filter(d => annexArea(d.a) || annexArea(d.b)).length,
    hatches: e.annexes.filter(n => n.bed).length,
    tunnelDoors: e.tunnels.reduce((s, t) => s + t.doors.length, 0),
    clues: e.tunnels.reduce((s, t) => s + t.clues.length, 0) + e.annexes.reduce((s, n) => s + (n.bed?.clues.length ?? 0), 0),
    art: e.art?.length ?? 0,
    marks: e.cacheMarks?.length ?? 0,
    caches: annexCachesOf(l).length,
    hideouts: e.annexes.filter(n => n.hideout !== undefined).length,
    machines: e.machines?.length ?? 0,
    vents: e.vents?.length ?? 0,
    props: l.props.filter(inExt).length,
    pickups: l.pickups.filter(inExt).length,
    spawns: l.zombies.filter(inExt).length,
    annexLights: l.lights.filter(x => annexArea(x.area)).length,
    reportAnnexes: extensionContentOf(l)?.annexes.length ?? 0,
  };
}

describe('the Beyond the Station area roll (one 20 % roll per logical level)', () => {
  it('is 0.2 within a tight binomial band over 60,000 seeds of three families, independent of archetype / mall variant / level type', () => {
    expect(BTS_AREA_CHANCE).toBe(0.2);
    const rng = new Rng(20261101);
    const families: Record<string, (i: number) => number> = {sequential: i => i, corpus, random: () => Math.floor(rng.next() * 4294967296) >>> 0};
    const N = 20000, band = (n: number) => 4 * Math.sqrt((0.2 * 0.8) / n);
    let all = 0;
    const byArch = new Map<string, [number, number]>(), byVariant = new Map<string, [number, number]>();
    for (const [name, f] of Object.entries(families)) {
      let hit = 0;
      for (let i = 0; i < N; i++) {
        const s = f(i), u = btsAreaRoll(s);
        expect(u >= 0 && u < 1).toBe(true);
        const p = btsAreaPresent(s);
        expect(p).toBe(u < BTS_AREA_CHANCE);
        if (p) hit++;
        for (const [m, k] of [[byArch, pickArchetype(s)], [byVariant, mallVariantOf(s)]] as const) { const c = m.get(k) ?? [0, 0]; c[0]++; if (p) c[1]++; m.set(k, c); }
      }
      report(`${name}: ${hit}/${N} = ${(hit / N).toFixed(4)} (band ±${band(N).toFixed(4)})`);
      expect(Math.abs(hit / N - 0.2), name).toBeLessThan(band(N));
      all += hit;
    }
    expect(Math.abs(all / (3 * N) - 0.2)).toBeLessThan(band(3 * N));
    // independent of the other level-seed decisions: the same 0.2 per Subway archetype and per mall variant
    for (const [m, what] of [[byArch, 'archetype'], [byVariant, 'mall variant']] as const) {
      for (const [k, [n, p]] of m) {
        report(`${what} ${k}: ${p}/${n} = ${(p / n).toFixed(4)}`);
        expect(Math.abs(p / n - 0.2), `${what} ${k}`).toBeLessThan(band(n));
      }
    }
    // a pure function of the seed: repeated / interleaved calls agree; no level type has a chance of its own
    for (let i = 0; i < 200; i++) expect(btsAreaRoll(corpus(i))).toBe(btsAreaRoll(corpus(i)));
    for (const id of TRACK_LEVELS) expect('chance' in (LEVELS[id].trackExtensions as TrackExtConfig).annex, id).toBe(false);
    expect(TRACK_LEVELS).toEqual(['subway', 'office', 'mall', 'skyways', 'reactor']); // (+ reactor: task reactor-build-20261101 — TRACK_EXT_REACTOR; + skyways: TRACK_EXT_SKYWAYS)
  });

  it('ABSENT on every level type: zero annexes and nothing of the area; the tunnels stay ordinary tunnels', () => {
    for (const level of TRACK_LEVELS) {
      for (const seed of ABSENT) {
        const l = gen(level, seed), e = l.extensions!, tag = `${level} ${seed}`;
        expect(e, tag).toBeTruthy();
        expect(e.area, tag).toEqual({roll: btsAreaRoll(seed), chance: BTS_AREA_CHANCE, present: false});
        const t = areaTraces(l);
        expect(Object.entries(t).filter(([, v]) => v !== 0), `${tag}: ${JSON.stringify(t)}`).toEqual([]);
        // every tunnel was told why: no area; nothing else about annexes / hatches was tried
        for (const tr of e.tunnels) expect(e.log.some(g => g.trench === tr.trench && g.from === tr.from && /^annex: no area/.test(g.result)), tag).toBe(true);
        expect(e.log.filter(g => /^(annex \d|hatch|annex: (not eligible|omitted|not wanted))/.test(g.result)), tag).toEqual([]);
        // the extensions that remain are the tunnels only (+ their sparse fixtures)
        expect(l.areas.filter(isExtensionArea).every(a => a.ext === 'tunnel'), tag).toBe(true);
      }
    }
  }, 300000);

  it('PRESENT on every level type: annexes through the lawful entrances, each with its guaranteed hideout, caches, marks, loot, spawns', () => {
    let clues = 0, art = 0;
    for (const level of TRACK_LEVELS) {
      for (const seed of PRESENT) {
        const l = gen(level, seed), e = l.extensions!, tag = `${level} ${seed}`;
        expect(e.area, tag).toEqual({roll: btsAreaRoll(seed), chance: BTS_AREA_CHANCE, present: true});
        // the per-type count shape on the existing caps (Subway 1-2, Office <= 2, Mall 1); these seeds are all eligible
        expect(e.annexes.length, tag).toBeGreaterThanOrEqual(1);
        expect(e.annexes.length, tag).toBeLessThanOrEqual(level === 'mall' ? 1 : 2);
        const t = areaTraces(l);
        expect(t.reportAnnexes, tag).toBe(e.annexes.length);
        clues += t.clues; art += t.art;
        for (const n of e.annexes) {
          const ids = new Set(n.areas), ntag = `${tag} annex ${n.id}`;
          // the entrance: a tunnel door or (GEN-2 planner levels) a bed hatch. (2026-11-01, lane OFFICE) The Office has a hatch ONLY as
          // its presence fallback (TRACK_EXT_OFFICE.fallbackHatch): the level's one annex, when no tunnel annex exists
          if (n.bed && level === 'office') expect(e.annexes.length === 1 && e.tunnels.every(t => !t.doors.length), `${ntag}: an Office hatch only as the fallback`).toBe(true);
          if (!n.bed) expect(e.tunnels[n.tunnel].doors.some(d => d.annex === n.id), ntag).toBe(true);
          // the guaranteed deep hideout, its cache(s) and the survivor marks leading there
          expect(n.hideout !== undefined && ids.has(n.hideout), `${ntag} hideout`).toBe(true);
          expect(annexCachesOf(l).filter(c => c.annex === n.id).length, `${ntag} caches`).toBeGreaterThanOrEqual(1);
          expect((e.cacheMarks ?? []).filter(m => m.annex === n.id).length, `${ntag} survivor marks`).toBeGreaterThan(0);
          // its loot holders / finds, lights and service spawns (the zone budget per annex)
          expect(l.props.filter(p => ids.has(p.area)).length, `${ntag} props`).toBeGreaterThan(10);
          expect(l.lights.filter(x => ids.has(x.area)).length, `${ntag} lights`).toBeGreaterThan(0);
          expect(l.zombies.filter(z => ids.has(z.area)).length, `${ntag} service spawns`).toBeGreaterThanOrEqual(SERVICE_ZONE_BUDGET[0]);
          // the station invitation art at its entrance
          expect((e.art ?? []).some(a => a.annex === n.id), `${ntag} invitation art`).toBe(true);
        }
      }
    }
    expect(clues, 'graffiti clues on the present levels').toBeGreaterThan(0);
    expect(art).toBeGreaterThan(0);
  }, 300000);

  it('PRESENT with every tunnel ineligible (Office 31702): ONE fallback hatch annex, nothing else changed — never a second roll', () => {
    // (2026-11-01, lane OFFICE) was "no annex": the Office's presence fallback (TRACK_EXT_OFFICE.fallbackHatch) now places ONE
    // service-hatch annex at an open bed end on its own fork; the same one roll, the tunnels / core / attempt exactly as without it
    // (tests/office-area-fallback.test.ts proves the whole formerly-failing cohort)
    const l = gen('office', 31702), e = l.extensions!;
    expect(e.area).toEqual({roll: btsAreaRoll(31702), chance: BTS_AREA_CHANCE, present: true});
    const ref = generateOfficeLevel({levelSeed: 31702, startWeapon: 'pistol'}, undefined, undefined, {...(LEVELS.office.trackExtensions as TrackExtConfig), fallbackHatch: undefined});
    expect(ref.extensions!.annexes, 'without the fallback: none').toEqual([]);
    // the tunnels: every one still ineligible (first straight too short), no door, no clue; their log lines exactly as before
    const tunnelLog = e.log.filter(g => /^annex/.test(g.result) && !/fallback/.test(g.result));
    expect(tunnelLog.length).toBe(e.tunnels.length);
    expect(tunnelLog.every(g => /not eligible/.test(g.result))).toBe(true);
    expect(JSON.stringify(e.tunnels)).toBe(JSON.stringify(ref.extensions!.tunnels));
    expect(e.log.slice(0, ref.extensions!.log.length)).toEqual(ref.extensions!.log);
    // exactly one annex, behind a service hatch at a bed end no tunnel continues, with the whole area
    expect(e.annexes.length).toBe(1);
    const n = e.annexes[0];
    expect(n.tunnel).toBe(-1);
    expect(n.bed && !e.tunnels.some(t => t.trench === n.bed!.trench && t.from === n.bed!.from)).toBe(true);
    const t = areaTraces(l);
    expect({annexes: t.annexes, hatches: t.hatches, tunnelDoors: t.tunnelDoors, hideouts: t.hideouts, reportAnnexes: t.reportAnnexes}).toEqual({annexes: 1, hatches: 1, tunnelDoors: 0, hideouts: 1, reportAnnexes: 1});
    for (const k of ['annexAreas', 'annexDoors', 'caches', 'marks', 'props', 'pickups', 'spawns', 'annexLights'] as const) expect(t[k], k).toBeGreaterThan(0);
    // the core and the accepted attempt are those of the level without it
    expect(l.attempt).toBe(ref.attempt);
    expect(canonDiff(canonCore(l), canonCore(ref))).toEqual([]);
  }, 120000);

  it('the fresh-run sample seeds of the annex tests (tests/helpers/btsArea.ts FRESH) roll PRESENT and play their roles', () => {
    for (const [k, s] of Object.entries(FRESH)) expect(btsAreaPresent(s), k).toBe(true);
    // each is the FIRST seed at / after the old playtest seed that rolls present and plays the role
    for (const [k, old] of Object.entries({subwayTunnel: 1043, subwayHatch: 1002, subwayGenset: 1037, office: 222, mall: 846932})) expect(btsAreaPresent(old), `${k} old ${old}`).toBe(false);
    const tl = freshLayout('subway', FRESH.subwayTunnel), T = tl.extensions!;
    expect(T.annexes.map(n => n.tunnel >= 0)).toEqual([true]);
    expect((T.machines ?? []).some(m => m.kind === 'fanWall' || m.kind === 'fanUnit')).toBe(true);
    expect(annexCachesOf(tl).filter(c => c.annex === T.annexes[0].id).length).toBeGreaterThanOrEqual(2);
    expect(freshLayout('subway', FRESH.subwayHatch).extensions!.annexes.map(n => n.tunnel >= 0).sort()).toEqual([false, true]);
    expect(freshLayout('subway', FRESH.subwayGenset).extensions!.machines!.some(m => m.kind === 'genset')).toBe(true);
    expect(freshLayout('office', FRESH.office).extensions!.annexes.length).toBe(2);
    expect(freshLayout('mall', FRESH.mall).extensions!.annexes.length).toBe(1);
  }, 120000);

  it('core-view invariance: present or absent, the core equals the same level generated with no annex possible', () => {
    for (const level of TRACK_LEVELS) {
      for (const seed of [ABSENT[0], PRESENT[0]]) {
        const l = gen(level, seed), ref = reference(level, seed);
        expect(ref.extensions!.annexes, `${level} ${seed}: reference`).toEqual([]);
        expect(l.attempt, `${level} ${seed}: same attempt`).toBe(ref.attempt);
        expect(canonDiff(canonCore(l), canonCore(ref)), `${level} ${seed}: core view`).toEqual([]);
      }
    }
  }, 300000);

  it('determinism: the same level twice, in either generation order, on every attempt, and on a revisit through the run', () => {
    const order = TRACK_LEVELS.flatMap(level => [ABSENT[0], PRESENT[0]].map(seed => [level, seed] as const));
    // reverse order of the cached (first) generation, fresh layouts
    for (const [level, seed] of order.slice().reverse()) {
      const a = gen(level, seed), b = live(level, seed);
      expect(JSON.stringify(b.extensions), `${level} ${seed}`).toBe(JSON.stringify(a.extensions));
      expect(b.areas.length).toBe(a.areas.length);
      expect(b.zombies.length).toBe(a.zombies.length);
    }
    // the roll is the LEVEL seed's, never the attempt's: every raw attempt (different generation seeds) records the same roll
    const seed = PRESENT[0];
    const attempts = [
      ...[0, 1, 2].map(k => generateAttempt(seed, k)), ...[0, 1, 2].map(k => officeAttempt({levelSeed: seed}, k)), ...[0, 1, 2].map(k => mallAttempt({levelSeed: seed}, k)),
    ].filter((x): x is StationLayout => !!x);
    expect(attempts.length).toBeGreaterThanOrEqual(6);
    for (const a of attempts) expect(a.extensions!.area).toEqual({roll: btsAreaRoll(seed), chance: BTS_AREA_CHANCE, present: true});
    // a revisit: the run keeps only the level seeds; the level regenerates identically (the area included)
    const run = createRun({seeds: {subway: PRESENT[0], office: ABSENT[0], mall: PRESENT[1], market: 808, skyways: 707, reactor: ABSENT[1]}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    for (const level of TRACK_LEVELS) {
      const s = run.seeds[level], first = gen(level, s), again = LEVELS[level].generate('main', {levelSeed: run.seeds[level], startWeapon: 'pistol'} as never);
      expect(again.extensions!.area!.present, level).toBe(btsAreaPresent(s));
      expect(JSON.stringify(again.extensions), level).toBe(JSON.stringify(first.extensions));
    }
  }, 300000);

  it('realised occurrence per level type over 250 seeds each: 0.2 — every present level has the area (absent levels never carry an annex)', () => {
    // (2026-11-01, lane OFFICE) every present Subway / Mall level fits an annex, and so does every present Office level now: ~7 % of
    // them have no tunnel with a long enough first straight (measured 23 / 331), and those take ONE service hatch instead (the Office's
    // presence fallback, TRACK_EXT_OFFICE.fallbackHatch; tests/office-area-fallback.test.ts) — the same one roll, never a second one
    const N = 250, seeds = Array.from({length: N}, (_, i) => corpus(1000 + i));
    for (const level of TRACK_LEVELS) {
      const t0 = performance.now();
      const present = seeds.filter(btsAreaPresent);
      let realised = 0, two = 0, hatches = 0;
      for (const s of present) {
        const l = live(level, s), e = l.extensions!, n = e.annexes.length;
        expect(e.area!.present).toBe(true);
        if (n) realised++;
        if (n === 2) two++;
        hatches += e.annexes.filter(a => a.bed).length;
        // a present level without an annex would be genuinely ineligible: the log says why, nothing was rolled away
        if (!n) expect(e.log.filter(g => /^annex: /.test(g.result)).every(g => /not eligible|omitted/.test(g.result)), `${level} ${s}`).toBe(true);
        // an Office hatch only as the fallback: the level's one annex, no tunnel door
        if (level === 'office' && e.annexes.some(a => a.bed)) expect(n === 1 && e.tunnels.every(t => !t.doors.length), `${level} ${s}`).toBe(true);
      }
      // absent levels: a generated sample (the planner never runs there)
      for (const s of seeds.filter(x => !btsAreaPresent(x)).slice(0, 6)) expect(live(level, s).extensions!.annexes.length, `${level} ${s} absent`).toBe(0);
      const rate = present.length / N, occ = realised / N, elig = realised / present.length;
      report(`${level}: ${present.length}/${N} rolled present (${rate.toFixed(3)}), ${realised} with an annex (${two} with two, ${hatches} hatch annexes): realised ${occ.toFixed(3)}, eligibility ${elig.toFixed(3)}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      expect(Math.abs(rate - 0.2)).toBeLessThan(4 * Math.sqrt(0.16 / N));
      expect(elig, `${level}: every present level has the area`).toBe(1);
      expect(Math.abs(occ - 0.2), `${level}: realised occurrence`).toBeLessThan(4 * Math.sqrt(0.16 / N));
      expect(occ).toBeLessThanOrEqual(rate);
    }
  }, 600000);
});
