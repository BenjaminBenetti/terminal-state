// Task enemy-spawn-tables-20261030 (lane SPAWN): the source-generated ENEMY SPAWN reference (tools/pages/enemyReference.ts).
//  - coverage: every registered level / archetype family / generation context appears (in registry order), an explicit room entry
//    appears automatically, and unknown registrations fail the build;
//  - runtime agreement: every number === the profile API, context runs === what the real generator runs, the census === a fresh
//    generation of the registered generator (eligible m² = cells its own candidate filter accepted x CELL²);
//  - exact maths (E[count], shares, expected coated share vs the real type roll), determinism, source links, docs agreement.
//  - task track1-siren-blightbelly-20261031 (lane SPAWN), schema 2: tiers === the registry, family stats / rules === the exported
//    constants (Siren hp = 2 x the shambler's), eligibility rules === the profile, the eligibility census === a fresh generation.

import {beforeAll, describe, expect, it} from 'vitest';
import {LINGERIE_STORES_MAX} from '../src/gen/mall/lingerieSpawns'; // task mall-lingerie-20261102-221554 (lane CONTEXT): the mall's lingerie store zone
import {trackExtConfig} from '../src/gen/trackExt/config'; // Track 2 (lane CONTENT): annexes per level (the service zone; task mall-playtest-revision-20261031: per level — the mall grows at most 1)
import {existsSync, readFileSync} from 'node:fs';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {
  ENEMY_FAMILY_IDS, SPAWN_CONTEXT_IDS, rollZombieTypes, roomFamilyPool, roomKey, setSpawnCensusHook, spawnProfile, type SpawnCandidateReport, type SpawnProfile,
} from '../src/ai/spawnTables';
import {pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {ZOMBIE_STATS} from '../src/ai/brain';
import {SIREN_STATS, SIREN_WAKE} from '../src/ai/siren';
import {BLIGHTBELLY_BURST, BLIGHTBELLY_STATS} from '../src/ai/blightbelly';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {OFFICE_FLOORS} from '../src/gen/office/frame';
import {startWeaponFor} from '../src/weapons/pistol';
import {
  ENEMY_CENSUS_SEEDS, ENEMY_ELIGIBILITY_SEEDS, ENEMY_FAMILY_ADAPTER, ENEMY_GENERATED_FROM, ENEMY_LEVEL_ADAPTER, buildEnemyReference, eligibilityCensus,
  enemyCensus, expectedCoatedShare, ruleRows,
} from '../../tools/pages/enemyReference';
import {ENEMY_REFERENCE_SCHEMA, type EnemyReference, type SourceLoc} from '../../tools/pages/enemyReferenceTypes';
import {FRESH} from './helpers/btsArea';

const readSource = (f: string): string | null => {
  try { return readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'); } catch { return null; }
};
let cached: EnemyReference | null = null;
const ref = (): EnemyReference => (cached ??= buildEnemyReference({readSource, commit: 'test'}));
// Task studio-skywalk-encounters-20261108-074144-01: the reference is built ONCE here (fixture setup, its own explicit time limit), not
// inside the first test: every level with a family eligibility rule adds its 20-level sampled eligibility census
// (ENEMY_ELIGIBILITY_SEEDS), and Skyways version 5 now has one (its Siren) — 20 more generated Skyways levels. Every assertion below is
// unchanged and keeps the default per-test limit.
beforeAll(() => { ref(); }, 300_000);
const level = (id: string) => ref().levels.find(l => l.id === id)!;

/** Every SourceLoc in a JSON value. */
function locs(v: unknown, out: SourceLoc[] = []): SourceLoc[] {
  if (Array.isArray(v)) for (const x of v) locs(x, out);
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.file === 'string' && typeof o.symbol === 'string') out.push(o as unknown as SourceLoc);
    else for (const x of Object.values(o)) locs(x, out);
  }
  return out;
}

describe('enemy spawn reference: coverage', () => {
  it('every registered level, archetype family and generation context appears, in registry order', () => {
    const r = ref();
    expect(r.meta.schema).toBe(ENEMY_REFERENCE_SCHEMA);
    expect(r.levels.map(l => l.id)).toEqual([...LEVEL_IDS]);
    expect(r.families.map(f => f.id)).toEqual(Object.keys(ENEMY_ARCHETYPES));
    expect(r.families.map(f => f.id)).toEqual([...ENEMY_FAMILY_IDS]);
    for (const f of r.families) {
      const d = ENEMY_ARCHETYPES[f.id as keyof typeof ENEMY_ARCHETYPES];
      expect([f.label, f.model]).toEqual([d.label, d.model]);
    }
    expect(r.families.find(f => f.id === 'zombie')!.variants).toMatch(/not separate families/);
    for (const L of r.levels) {
      const P = spawnProfile(L.id as LevelId);
      expect(L.name).toBe(LEVELS[L.id as LevelId].name);
      expect(L.contexts.map(c => c.id)).toEqual(Object.keys(P.contexts));
      expect(Object.keys(ENEMY_LEVEL_ADAPTER[L.id as LevelId].contexts).sort()).toEqual(Object.keys(P.contexts).sort());
      expect(L.contexts.every(c => (SPAWN_CONTEXT_IDS as readonly string[]).includes(c.id))).toBe(true);
      expect(L.pool.rows.map(x => x.family)).toEqual(P.families.map(([f]) => f));
    }
    expect(level('subway').levelMoves).not.toBeNull();
    expect(level('office').levelMoves).toBeNull();
  });

  it('source links name real files and land on their declaration', () => {
    const all = locs(ref());
    expect(all.length).toBeGreaterThan(30);
    for (const f of ENEMY_GENERATED_FROM) expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(true);
    for (const l of all) {
      const text = readSource(l.file);
      expect(text, l.file).not.toBeNull();
      expect(l.line, `${l.file} ${l.symbol}`).toBeGreaterThan(0);
      const line = text!.split('\n')[l.line! - 1];
      const last = l.symbol.split('.').pop()!;
      expect(line.includes(last) || line.includes(l.symbol.split('.')[0]), `${l.file}:${l.line} ${l.symbol}: ${line}`).toBe(true);
    }
  });
});

describe('enemy spawn reference: runtime agreement', () => {
  it('every shown control === the profile; context runs === what the real Office generator runs', () => {
    for (const L of ref().levels) {
      const P = spawnProfile(L.id as LevelId);
      let lo = 0, hi = 0, mean = 0;
      for (const c of L.contexts) {
        const pc = P.contexts[c.id as keyof SpawnProfile['contexts']]!;
        expect([c.count.lo, c.count.hi]).toEqual([...pc.count]);
        expect(c.count.mean).toBe((pc.count[0] + pc.count[1]) / 2);
        expect([c.perLevel.lo, c.perLevel.hi, c.perLevel.mean]).toEqual([c.runs * pc.count[0], c.runs * pc.count[1], c.runs * c.count.mean]);
        const pl = pc.placement;
        expect(c.placement.areaWeights.rules.map(r => r.weight)).toEqual(pl.areaWeights.rules.map(r => r.weight));
        expect(c.placement.areaWeights.otherwise).toBe(pl.areaWeights.otherwise);
        expect(c.placement.caps.passes).toEqual([...pl.caps.passes]);
        expect([c.placement.triesPerArea, c.placement.spacing.metres]).toEqual([pl.tries, pl.spacingM]);
        expect(c.placement.keepAway[0]).toMatchObject({value: pl.startCells, metres: pl.startCells * CELL});
        // Track 2 (lane CONTENT): the 'service' annex context is a ZONE (one run per seeded annex, 0-TRACK_EXT.annex.max per level),
        // reported separately: never part of the whole-level total; task mall-lingerie-20261102-221554 (lane CONTEXT): so is the mall's
        // 'lingerie' store context (one run per lingerie store, 0-LINGERIE_STORES_MAX per mall)
        expect(!!c.zone, `${L.id} ${c.id} zone`).toBe(c.id === 'service' || c.id === 'lingerie');
        if (c.zone) {
          const max = c.id === 'lingerie' ? LINGERIE_STORES_MAX : trackExtConfig(L.id as LevelId).annex.max;
          expect(c.zone.runsPerLevel).toEqual({lo: 0, hi: max});
          expect(c.zone.perLevelMax).toBe(max * pc.count[1]);
          continue;
        }
        lo += c.perLevel.lo; hi += c.perLevel.hi; mean += c.perLevel.mean;
      }
      expect([L.total.lo, L.total.hi, L.total.mean]).toEqual([lo, hi, mean]);
      const den = P.families.reduce((s, [, w]) => s + w, 0);
      expect(L.pool.denominator).toBe(den);
      const affected = new Set(Object.entries(P.eligibility ?? {}).flatMap(([f, r]) => [f, r!.fallback]));
      L.pool.rows.forEach((row, i) => {
        expect(row.weight).toBe(P.families[i][1]);
        expect(row.share).toBeCloseTo(P.families[i][1] / den, 7);
        expect(!!row.restricted).toBe(!!P.eligibility?.[row.family as keyof typeof P.eligibility]);
        const e = L.pool.expectedPerLevel[i];
        if (affected.has(row.family)) {
          // a restricted family and its fallback: measured by the eligibility census (placed per level), never share x total
          expect(e.basis).toBe('sampled');
          expect(e.mean).toBe(L.eligibilityCensus!.placed.find(x => x.family === row.family)!.perLevel);
        } else {
          expect(e.basis).toBe('exact');
          expect(e.mean!).toBeCloseTo(row.share * L.total.mean, 6);
        }
      });
      expect(L.tier.value).toBe(LEVELS[L.id as LevelId].tier);
      expect(L.pool.eligibility.map(e => e.family)).toEqual(Object.keys(P.eligibility ?? {}));
      expect(L.zombieTypes.types[0]).toEqual({type: 'coated', chance: P.zombieTypes.coatedChance});
      expect(L.rooms.entries).toEqual([]);
      for (const row of L.rooms.rows) {
        expect(row.intensity).toBe(1);
        for (const f of row.families) expect(f).toEqual({family: f.family, density: 1, weight: 1, from: 'default'});
      }
    }
    expect(level('subway').levelMoves).toMatchObject({mainKeep: spawnProfile('subway').levelMoves!.mainKeep, passes: spawnProfile('subway').levelMoves!.passes});
    // runs: the real Office generator runs 'street' once, 'floor' once per office floor 2..8, 'roof' once (one generation per level)
    const runs = new Map<string, number>();
    let layout: object | null = null;
    const reports: SpawnCandidateReport[] = [];
    setSpawnCensusHook(r => reports.push(r));
    // (2026-11-01, lane AREA: an Office level rolling the Beyond the Station area PRESENT — FRESH.office; 222 now rolls it absent)
    try { layout = LEVELS.office.generate('main', {levelSeed: FRESH.office, startWeapon: 'pistol'}); } finally { setSpawnCensusHook(null); }
    for (const r of reports) if (r.layout === layout) runs.set(r.context, (runs.get(r.context) ?? 0) + 1);
    // (Track 2, lane CONTENT: the 'service' zone runs once per seeded service annex of THIS level — its count of annexes)
    const annexes = (layout as unknown as {extensions?: {annexes: unknown[]}}).extensions?.annexes.length ?? 0;
    expect(Object.fromEntries(runs)).toEqual(Object.fromEntries(level('office').contexts.map(c => [c.id, c.zone ? annexes : c.runs]).filter(([, n]) => n)));
    expect(annexes, `office ${FRESH.office} exercises the service zone`).toBeGreaterThan(0);
    expect(level('office').contexts.find(c => c.id === 'floor')!.runs).toBe(OFFICE_FLOORS.length - 1);
  });

  it('the sampled census is the registered generator: placed / eligible floor agree with a fresh generation', () => {
    const r = ref();
    // the room census for every level, then the eligibility census for every level whose profile restricts a family (Office)
    expect(r.meta.census.map(c => [c.level, c.seeds])).toEqual(LEVEL_IDS.flatMap(l => [[l, [...ENEMY_CENSUS_SEEDS]],
      ...(Object.keys(spawnProfile(l).eligibility ?? {}).length ? [[l, [...ENEMY_ELIGIBILITY_SEEDS]]] : [])]));
    for (const L of r.levels) {
      const c = L.census!;
      expect(c.layouts).toBe(ENEMY_CENSUS_SEEDS.length);
      expect(c.note).toMatch(/^SAMPLED/);
      expect(c.cellM2).toBe(CELL * CELL);
      expect(c.eligibleM2).toBeCloseTo(c.eligibleCells * CELL * CELL, 6);
      const rows = L.rooms.rows.filter(x => x.observed);
      expect(rows.reduce((s, x) => s + x.observed!.eligibleCells, 0)).toBe(c.eligibleCells);
      for (const f of ENEMY_FAMILY_IDS) expect(rows.reduce((s, x) => s + x.observed!.placed[f], 0)).toBe(c.placed.find(p => p.family === f)!.total);
      expect(c.byContext.reduce((s, x) => s + x.placed, 0)).toBe(c.placed.reduce((s, x) => s + x.total, 0));
    }
    // one seed per level against a fresh generation of the registered generator
    for (const l of LEVEL_IDS) {
      const seed = ENEMY_CENSUS_SEEDS[1];
      const fresh = LEVELS[l].generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false)});
      const cen = enemyCensus(l, [seed]);
      // task track3-eaton-centre-20261031 (lane PROFILES): horde members are the separate pool (census.horde), not ambient spawns
      const ambient = fresh.zombies.filter(z => z.horde === undefined);
      expect(cen.spawns.length).toBe(ambient.length);
      expect(cen.horde.length).toBe(fresh.zombies.length - ambient.length);
      expect(cen.spawns.map(s => `${s.family}:${s.key}`)).toEqual(ambient.map(z => `${z.archetype}:${roomKey(fresh.areas[z.area])}`));
      // every placed spawn stands in an area the generator reported as eligible
      const eligible = new Set(cen.areas.map(a => a.key));
      for (const s of cen.spawns) expect(eligible.has(s.key), s.key).toBe(true);
    }
  });
});

describe('enemy spawn reference: tiers, family stats, eligibility (task track1, schema 2)', () => {
  it('every level shows its registry tier (Subway 0, Office 1) and the tier knob', () => {
    expect(ref().levels.map(l => [l.id, l.tier.value])).toEqual(LEVEL_IDS.map(id => [id, LEVELS[id].tier]));
    expect([level('subway').tier.value, level('office').tier.value]).toEqual([0, 1]);
    for (const L of ref().levels) {
      expect(L.tier.note).toMatch(/no automatic scaling/);
      expect(L.knobs.find(k => k.what === 'difficulty tier')!.value).toBe(L.tier.value);
    }
  });

  it('family stats and behaviour rules are the exported constants (no copied numbers)', () => {
    const fam = (id: string) => ref().families.find(f => f.id === id)!;
    expect(fam('zombie').stats.map(v => [v.variant, v.hp])).toEqual([['shambler', ZOMBIE_STATS.shambler.hp], ['coated', ZOMBIE_STATS.coated.hp]]);
    const siren = fam('siren').stats[0];
    expect(siren).toMatchObject({variant: null, hp: SIREN_STATS.hp, chaseSpeed: SIREN_STATS.chaseSpeed, attackDamage: SIREN_STATS.attackDamage});
    expect(siren.hp).toBe(2 * ZOMBIE_STATS.shambler.hp); // double the ordinary zombie, not the coated one
    expect(fam('blightbelly').stats[0]).toMatchObject({hp: BLIGHTBELLY_STATS.hp, chaseSpeed: BLIGHTBELLY_STATS.chaseSpeed, radius: BLIGHTBELLY_STATS.radius});
    const wake = fam('siren').rules.find(g => g.title.startsWith('Dormant wake'))!;
    expect(wake.rows.find(r => r.what.startsWith('proximity wake: plan distance'))!.value).toBe(SIREN_WAKE.proximityM);
    const burst = fam('blightbelly').rules.find(g => g.title.startsWith('Death burst'))!;
    expect(burst.rows.find(r => r.what.startsWith('blast damage to the player'))!.value).toBe(BLIGHTBELLY_BURST.blastMax);
    expect(burst.rows.find(r => r.what.startsWith('toxic gas cloud life'))!.value).toBe(BLIGHTBELLY_BURST.gasDurationS);
    // every leaf of every rules constant is listed (labelled, else by its key path): nothing silently dropped
    for (const id of ENEMY_FAMILY_IDS) {
      for (const [k, r] of ENEMY_FAMILY_ADAPTER[id].rules.entries()) expect(fam(id).rules[k].rows).toEqual(ruleRows(r.value));
      const d = ENEMY_ARCHETYPES[id];
      if (d.stats) expect(ENEMY_FAMILY_ADAPTER[id].stats.some(v => v.stats === d.stats), `${id} registry stats`).toBe(true);
    }
    const leaves = (o: object): number => Object.values(o).reduce((n: number, v) => n + (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v) : 1), 0);
    expect(ruleRows(SIREN_WAKE).length).toBe(leaves(SIREN_WAKE));
  });

  it('eligibility rules === the profile; the eligibility census === a fresh generation (draws, placed, fallbacks)', () => {
    const o = level('office');
    const P = spawnProfile('office');
    expect(o.pool.eligibility).toHaveLength(1);
    const e = o.pool.eligibility[0];
    expect([e.family, e.contexts, e.fallback, e.maxPerLevel]).toEqual(['siren', [...P.eligibility!.siren!.contexts], 'zombie', P.eligibility!.siren!.maxPerLevel]);
    expect(e.criteria.length).toBeGreaterThanOrEqual(8);
    expect(level('subway').pool.eligibility).toEqual([]);
    expect(level('subway').eligibilityCensus).toBeNull();
    const c = o.eligibilityCensus!;
    expect(c.layouts).toBe(ENEMY_ELIGIBILITY_SEEDS.length);
    expect(c.note).toMatch(/^SAMPLED/);
    const s = c.restricted[0];
    expect(s.family).toBe('siren');
    expect(s.placed).toBe(c.placed.find(x => x.family === 'siren')!.total);
    expect(s.draws - s.placed).toBe(s.fallbacks.reduce((n, f) => n + f.draws, 0));
    expect(s.perLevel.histogram.reduce((n, h) => n + h.layouts, 0)).toBe(c.layouts);
    expect(s.perLevel.max).toBeLessThanOrEqual(P.eligibility!.siren!.maxPerLevel!);
    expect(s.byContext.map(x => x.context)).toEqual(['floor']);
    // one seed against a fresh generation
    const seed = ENEMY_ELIGIBILITY_SEEDS[3];
    const fresh = LEVELS.office.generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false)});
    const one = eligibilityCensus('office', [seed]).restricted[0];
    expect(one.placed).toBe(fresh.zombies.filter(z => z.archetype === 'siren').length);
    expect(one.draws).toBe(fresh.zombies.filter((z, i) => pickEnemyArchetype(fresh.seed, i, roomFamilyPool(P, fresh.areas[z.area])) === 'siren').length);
  });
});

describe('enemy spawn reference: maths, determinism, failures, docs', () => {
  it('exact expected coated share incl. the at-least-one-each fix agrees with the real type roll', () => {
    const c = spawnProfile('office').zombieTypes;
    for (const n of [1, 2, 3, 5, 8]) {
      const rng = new Rng(4242 + n);
      let coated = 0;
      const runs = 20000;
      for (let k = 0; k < runs; k++) coated += rollZombieTypes(rng, n, c).slice(0, n).filter(t => t === 'coated').length;
      expect(Math.abs(coated / (runs * n) - expectedCoatedShare(n, c.coatedChance, c.atLeastOneEach)), `n ${n}`).toBeLessThan(0.008);
    }
    expect(expectedCoatedShare(32, 0.4, true)).toBeCloseTo(0.4, 6);
    const zt = level('office').zombieTypes.expectedCoated;
    expect(zt.find(z => z.context === 'roof' && z.count === 1)).toBeUndefined(); // roof U{0..2}: lo 0 has no spawns, hi 2 shown
    expect(zt.find(z => z.context === 'roof' && z.count === 2)!.share).toBeCloseTo(expectedCoatedShare(2, 0.4, true), 7);
  });

  it('is deterministic; a test-only room entry appears automatically; unknown registrations fail the build', () => {
    const a = buildEnemyReference({censusSeeds: [], commit: 'x'}), b = buildEnemyReference({censusSeeds: [], commit: 'x'});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.levels.every(l => l.census === null)).toBe(true);
    expect(JSON.parse(JSON.stringify(ref()))).toEqual(ref()); // plain JSON
    const tuned = (l: LevelId): SpawnProfile => l === 'office'
      ? {...spawnProfile(l), rooms: {'office-server': {ratdog: {weight: 2}}, 'office-roof': {all: {density: 0}}}} : spawnProfile(l);
    const t = buildEnemyReference({censusSeeds: [], profileFor: tuned});
    const o = t.levels.find(l => l.id === 'office')!;
    expect(o.rooms.entries).toEqual([
      {room: 'office-roof', family: 'all', density: 0, weight: null},
      {room: 'office-server', family: 'ratdog', density: null, weight: 2},
    ]);
    const server = o.rooms.rows.find(r => r.room === 'office-server')!;
    expect(server.families.find(f => f.family === 'ratdog')).toEqual({family: 'ratdog', density: 1, weight: 2, from: 'profile'});
    expect(server.intensity).toBe(1); // weight never changes the room intensity
    expect(o.rooms.rows.find(r => r.room === 'office-roof')!.intensity).toBe(0);
    expect(o.knobs.find(k => k.what === 'room modifiers')!.value).toBe('2 entries');
    expect(() => buildEnemyReference({profileFor: tuned})).toThrow(/censusSeeds/);
    // an unknown context / a profile missing a context its generator runs / an invalid value all fail the build
    const bad = (mut: (p: SpawnProfile) => SpawnProfile) => () => buildEnemyReference({censusSeeds: [], profileFor: l => (l === 'office' ? mut(spawnProfile(l)) : spawnProfile(l))});
    expect(bad(p => ({...p, contexts: {...p.contexts, cellar: p.contexts.floor} as never}))).toThrow(/invalid spawn profile|adapter contexts/);
    expect(bad(p => { const contexts = {...p.contexts}; delete contexts.roof; return {...p, contexts}; })).toThrow(/adapter contexts/);
    expect(bad(p => ({...p, rooms: {'office-server': {ratdog: {weight: -1}}}}))).toThrow(/invalid spawn profile/);
  });

  it('docs/enemy-spawns.md names every level, context, family, modifier field and the files it describes', () => {
    const doc = readSource('docs/enemy-spawns.md');
    expect(doc).not.toBeNull();
    for (const s of [...LEVEL_IDS, ...SPAWN_CONTEXT_IDS, ...ENEMY_FAMILY_IDS, 'density', 'weight', '`all`', 'SPAWN_PROFILES', 'validateSpawnProfile',
      'game/src/ai/spawnTables.ts', 'tools/pages/enemyReference.ts', 'tools/pages/enemyReferenceTypes.ts', 'enemies/index.html']) {
      expect(doc!.includes(s), s).toBe(true);
    }
    for (const f of (doc!.match(/`((?:game|tools|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md))`/g) ?? []).map(m => m.slice(1, -1))) {
      expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(true);
    }
  });
});
