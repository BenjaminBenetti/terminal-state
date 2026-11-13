// Task enemy-spawn-tables-20261030 (lane SPAWN): the source-generated ENEMY SPAWN reference (tools/pages/enemyReference.ts).
//  - coverage: every registered level / archetype family / generation context appears (in registry order), an explicit room entry
//    appears automatically, and unknown registrations fail the build;
//  - runtime agreement: every number === the profile API, context runs === what the real generator runs, the census === a fresh
//    generation of the registered generator (eligible m² = cells its own candidate filter accepted x CELL²);
//  - exact maths (E[count], shares, expected coated share vs the real type roll), determinism, source links, docs agreement.
//  - task track1-siren-blightbelly-20261031 (lane SPAWN), schema 2: tiers === the registry, family stats / rules === the exported
//    constants (Siren hp = 2 x the shambler's), eligibility rules === the profile, the eligibility census === a fresh generation.
//  - task studio-screacher-production-20261110-221858-01 (lane REGISTRY-DOCS), schema 3: THE SEEDED ROSTER === ai/enemyRoster.ts
//    (FAMILY_ROSTER, rosterRate, familyInRoster, the pass's own report), the roster-only Screacher (weight 0 in every pool, its
//    variants), and every sampled "what a level holds" figure === a fresh generation THROUGH THE REGISTRY with the roster version on.

import {beforeAll, describe, expect, it} from 'vitest';
import {LINGERIE_STORES_MAX} from '../src/gen/mall/lingerieSpawns'; // task mall-lingerie-20261102-221554 (lane CONTEXT): the mall's lingerie store zone
import {COSPLAY_CONVENTIONS_MAX} from '../src/gen/skyways/cosplaySpawns'; // task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the Skyways convention's zone
import {trackExtConfig} from '../src/gen/trackExt/config'; // Track 2 (lane CONTENT): annexes per level (the service zone; task mall-playtest-revision-20261031: per level — the mall grows at most 1)
import {existsSync, readFileSync} from 'node:fs';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {
  ENEMY_FAMILY_IDS, ROSTER_ONLY_FAMILIES, SPAWN_CONTEXT_IDS, rollZombieTypes, roomFamilyPool, roomKey, setSpawnCensusHook, spawnProfile, type SpawnCandidateReport, type SpawnProfile,
} from '../src/ai/spawnTables';
// task studio-screacher-production-20261110-221858-01: the seeded roster and the Screacher's exported constants
import {FAMILY_ROSTER, ROSTER_LANE, ROSTER_PLACE_LAST, ROSTER_PLACE_PRIORITY, ROSTER_VERSION, ZOMBIE_FREE_LEVELS, familyInRoster, rosterOf, rosterRate} from '../src/ai/enemyRoster';
import {
  IMPACT_FAMILY_LOUDNESS, SCREACHER_AGGRO, SCREACHER_ASSET, SCREACHER_ECHO, SCREACHER_MAX_TOP_M, SCREACHER_NOISE, SCREACHER_SCALE, SCREACHER_SENSE, SCREACHER_SPEED, SCREACHER_STATS,
  SCREACHER_VARIANTS, SCREACHER_VOICE_Y,
} from '../src/ai/screacher';
// task studio-bb-production-20261112-234540-01: BB's exported constants (the second roster-only family)
import {BB_STATS, BB_VARIANTS} from '../src/ai/bb';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {MELEE_MASS} from '../src/combat/meleeImpact';
import {pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {HEARING, ZOMBIE_STATS} from '../src/ai/brain';
import {SIREN_STATS, SIREN_WAKE} from '../src/ai/siren';
import {BLIGHTBELLY_BURST, BLIGHTBELLY_STATS} from '../src/ai/blightbelly';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {OFFICE_FLOORS} from '../src/gen/office/frame';
import {startWeaponFor} from '../src/weapons/pistol';
import {
  BUNKER_DAMP_RUNS_MAX, ENEMY_CENSUS_SEEDS, ENEMY_ELIGIBILITY_SEEDS, ENEMY_FAMILY_ADAPTER, ENEMY_GENERATED_FROM, ENEMY_LEVEL_ADAPTER, ENEMY_ROSTER_SEEDS, ROSTER_ROLL_CHECK_SEEDS,
  buildEnemyReference, eligibilityCensus, enemyCensus, expectedCoatedShare, rosterCensus, ruleRows,
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
      // task studio-screacher-production-20261110-221858-01: a family with several bodies lists every variant model of the registry
      expect(f.variantModels?.map(v => [v.variant, v.model]) ?? null, f.id).toEqual(d.variantModels ? Object.entries(d.variantModels) : null);
      expect(f.rosterOnly, f.id).toBe(ROSTER_ONLY_FAMILIES.includes(f.id as never));
      // a family is never said to spawn in a zombie-free level
      for (const l of f.levels) expect(ZOMBIE_FREE_LEVELS as readonly string[], `${f.id} in ${l}`).not.toContain(l);
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
        // (lane COSPLAY: + the Skyways convention's 'cosplay' context: one run per convention, 0-COSPLAY_CONVENTIONS_MAX per level)
        // (task studio-bunker-level-20261109-072224-01: + the Bunker's 'damp' context: one run per level over its damp areas, 0-BUNKER_DAMP_RUNS_MAX)
        expect(!!c.zone, `${L.id} ${c.id} zone`).toBe(c.id === 'service' || c.id === 'lingerie' || c.id === 'cosplay' || c.id === 'damp');
        if (c.zone) {
          const max = c.id === 'lingerie' ? LINGERIE_STORES_MAX : c.id === 'cosplay' ? COSPLAY_CONVENTIONS_MAX : c.id === 'damp' ? BUNKER_DAMP_RUNS_MAX : trackExtConfig(L.id as LevelId).annex.max;
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
    // the room census for every level, then the 20-level sample pass: the eligibility census for every level whose profile restricts a
    // family (Office) and — task studio-screacher-production-20261110-221858-01 — the roster census for EVERY level that can hold
    // enemies (was: only the levels with an eligibility rule had the 20-level sample), on the same seeds
    expect(ENEMY_ROSTER_SEEDS).toEqual(ENEMY_ELIGIBILITY_SEEDS);
    expect(r.meta.census.map(c => [c.level, c.seeds])).toEqual(LEVEL_IDS.flatMap(l => [[l, [...ENEMY_CENSUS_SEEDS]],
      ...(Object.keys(spawnProfile(l).eligibility ?? {}).length || !ZOMBIE_FREE_LEVELS.includes(l) ? [[l, [...ENEMY_ELIGIBILITY_SEEDS]]] : [])]));
    for (const c of r.meta.census) if (!ZOMBIE_FREE_LEVELS.includes(c.level as LevelId)) expect(c.note, c.level).toMatch(/roster/);
    for (const L of r.levels) {
      const c = L.census!;
      expect(c.layouts).toBe(ENEMY_CENSUS_SEEDS.length);
      expect(c.note).toMatch(/^SAMPLED/);
      expect(c.note).toMatch(/WITH THE SEEDED ROSTER APPLIED/); // (schema 3: the census reports what a level holds)
      // the roster changes families only: both stages count the same spawns; a roster-only family is never placed by the per-spawn roll
      expect(c.placed.reduce((s, x) => s + x.rollTotal, 0)).toBe(c.placed.reduce((s, x) => s + x.total, 0));
      for (const f of ROSTER_ONLY_FAMILIES) expect(c.placed.find(p => p.family === f)!.rollTotal, `${L.id} ${f}`).toBe(0);
      for (const p of c.placed) expect(p.levels > 0, `${L.id} ${p.family}`).toBe(p.total > 0);
      expect(c.cellM2).toBe(CELL * CELL);
      expect(c.eligibleM2).toBeCloseTo(c.eligibleCells * CELL * CELL, 6);
      const rows = L.rooms.rows.filter(x => x.observed);
      expect(rows.reduce((s, x) => s + x.observed!.eligibleCells, 0)).toBe(c.eligibleCells);
      for (const f of ENEMY_FAMILY_IDS) expect(rows.reduce((s, x) => s + x.observed!.placed[f], 0)).toBe(c.placed.find(p => p.family === f)!.total);
      expect(c.byContext.reduce((s, x) => s + x.placed, 0)).toBe(c.placed.reduce((s, x) => s + x.total, 0));
    }
    // one seed per level against a fresh generation of the registered generator — task studio-screacher-production-20261110-221858-01:
    // THROUGH THE REGISTRY WITH THE ROSTER ON (rosterVersion: what the game passes for a new station), since the census reports what a
    // level holds; `plain` = the same seed without a roster version (the per-spawn roll alone: the census's "before the pass" stage)
    for (const l of LEVEL_IDS) {
      const seed = ENEMY_CENSUS_SEEDS[1];
      const fresh = LEVELS[l].generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false), rosterVersion: ROSTER_VERSION});
      const plain = LEVELS[l].generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false)});
      const cen = enemyCensus(l, [seed]);
      expect(cen.spawns.map(s => s.rolled), `${l} before the pass`).toEqual(plain.zombies.filter(z => z.horde === undefined).map(z => z.archetype ?? 'zombie'));
      // the pass keeps every spawn where it is: only family / variant differ between the two generations
      expect(fresh.zombies.map(z => [z.x, z.z, z.y, z.area, z.type, z.horde])).toEqual(plain.zombies.map(z => [z.x, z.z, z.y, z.area, z.type, z.horde]));
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
      // (+ the constant's own labels: task studio-screacher-production-20261110-221858-01; + a constant that never borrows a shared
      // label: task studio-bb-production-20261112-234540-01)
      for (const [k, r] of ENEMY_FAMILY_ADAPTER[id].rules.entries()) expect(fam(id).rules[k].rows).toEqual(ruleRows(r.value, '', r.labels, r.ownLabelsOnly));
      const d = ENEMY_ARCHETYPES[id];
      if (d.stats) expect(ENEMY_FAMILY_ADAPTER[id].stats.some(v => v.stats === d.stats), `${id} registry stats`).toBe(true);
    }
    const leaves = (o: object): number => Object.values(o).reduce((n: number, v) => n + (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v) : 1), 0);
    expect(ruleRows(SIREN_WAKE).length).toBe(leaves(SIREN_WAKE));
    // task studio-screacher-production-20261110-221858-01: the Screacher — stats and every behaviour constant are the exported ones,
    // every leaf has its OWN label (no bare key path, none borrowed from another family's constant of the same key)
    const sc = fam('screacher');
    expect(sc.stats).toHaveLength(1);
    expect(sc.stats[0]).toMatchObject({variant: null, hp: SCREACHER_STATS.hp, chaseSpeed: SCREACHER_STATS.chaseSpeed, attackRange: SCREACHER_STATS.attackRange,
      attackDamage: SCREACHER_STATS.attackDamage, sightRange: 0, radius: SCREACHER_STATS.radius});
    expect(ENEMY_ARCHETYPES.screacher.stats).toBe(SCREACHER_STATS);
    const rule = (title: RegExp) => sc.rules.find(g => title.test(g.title))!;
    const value = (g: {rows: readonly {what: string; value: number | string}[]}, what: RegExp) => g.rows.find(r => what.test(r.what))!.value;
    expect(value(rule(/^Echolocation scream/), /^time between screams/)).toBe(SCREACHER_ECHO.periodS);
    expect(value(rule(/^Echolocation scream/), /^the scan finds the player within/)).toBe(SCREACHER_ECHO.rangeM);
    expect(value(rule(/^Paces/), /^FRENZY pace/)).toBe(SCREACHER_SPEED.frenzy);
    expect(value(rule(/^Aggression/), /^heat from which it is frenzied/)).toBe(SCREACHER_AGGRO.frenzyAt);
    expect(value(rule(/^What it hears besides gunfire/), /^one sprinting footstep/)).toBe(SCREACHER_NOISE.run);
    expect(value(rule(/^Touch and memory/), /^it feels the player/)).toBe(SCREACHER_SENSE.touchM);
    expect(value(rule(/^Body, reach and clip timing/), /^bind height \(feet to the top of the neck stump/)).toBe(SCREACHER_ASSET.heightM);
    for (const [k, r] of ENEMY_FAMILY_ADAPTER.screacher.rules.entries()) {
      expect(sc.rules[k].rows.length, r.symbol).toBe(leaves(r.value));
      for (const row of sc.rules[k].rows) expect(row.what, `${r.symbol}: an unlabelled leaf`).toMatch(/ /); // a label, never a bare key path
    }
    // the same key means different things in two constants (holdS: the hold rule / the scream's length): each constant's own label wins
    expect(rule(/^Touch and memory/).rows.find(r => r.value === SCREACHER_SENSE.holdS)!.what).toMatch(/quieter class of sound/);
    expect(rule(/^Echolocation scream/).rows.find(r => r.value === SCREACHER_ECHO.holdS)!.what).toMatch(/stands still/);
    expect(sc.variantModels!.map(v => [v.variant, v.name])).toEqual(Object.entries(SCREACHER_VARIANTS).map(([id, v]) => [id, v.name]));
    expect(sc.variants).toMatch(/ONE enemy type/);
  });

  // Task studio-bb-production-20261112-234540-01 (lane REGISTRY-DOCS). BB's behaviour constants are still being tuned, and keys may be
  // added or renamed: nothing here counts leaves or names a key — every exported constant of the adapter is shown leaf for leaf, and a
  // key without a label of its own shows its key path (ownLabelsOnly), never a label borrowed from another family's constant.
  it('BB: stats and every behaviour constant are the exported ones (leaf for leaf, own labels only); four looks of ONE enemy type', () => {
    const bb = ref().families.find(f => f.id === 'bb')!, A = ENEMY_FAMILY_ADAPTER.bb;
    expect([bb.label, bb.rosterOnly, bb.model]).toEqual([ENEMY_ARCHETYPES.bb.label, true, null]);
    expect(ENEMY_ARCHETYPES.bb.stats).toBe(BB_STATS);
    expect(bb.stats).toHaveLength(1);
    expect(bb.stats[0]).toMatchObject({variant: null, hp: BB_STATS.hp, wanderSpeed: BB_STATS.wanderSpeed, chaseSpeed: BB_STATS.chaseSpeed, attackRange: BB_STATS.attackRange,
      attackDamage: BB_STATS.attackDamage, sightRange: BB_STATS.sightRange, radius: BB_STATS.radius, height: BB_STATS.height});
    const leafPaths = (o: object, prefix = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const get = (o: object, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o);
    expect(A.rules.length).toBeGreaterThanOrEqual(5);
    expect(bb.rules.map(g => [g.at.file, g.at.symbol])).toEqual(A.rules.map(r => ['game/src/ai/bb.ts', r.symbol]));
    for (const [k, r] of A.rules.entries()) {
      expect(r.ownLabelsOnly, r.symbol).toBe(true);
      expect(r.symbol, 'a BB constant').toMatch(/^BB_/);
      const paths = leafPaths(r.value), rows = bb.rules[k].rows;
      expect(rows.length, `${r.symbol}: every leaf has a row`).toBe(paths.length);
      paths.forEach((path, i) => {
        // the row's value is the constant's (a [lo, hi] range shows both ends), its label the constant's own — else its key path
        const v = get(r.value, path);
        if (Array.isArray(v)) for (const n of v) expect(String(rows[i].value), `${r.symbol}.${path}`).toContain(String(n));
        else expect(rows[i].value, `${r.symbol}.${path}`).toBe(v);
        const own = r.labels?.[path];
        expect([rows[i].what, rows[i].unit], `${r.symbol}.${path}`).toEqual(own ? [own[0], own[1]] : [path, '']);
      });
      // a key this adapter does not label yet is listed by its path, even when another family's constant labels the same key
      expect(ruleRows({zzNewKey: 3, proximityM: 2}, '', r.labels, true).map(x => [x.what, x.value])).toEqual([['zzNewKey', 3], ['proximityM', 2]]);
    }
    expect(ruleRows({proximityM: 2})[0].what, 'the shared label table does label this key (what ownLabelsOnly keeps out)').not.toBe('proximityM');
    // every label of the adapter names a key the constant has today: a renamed key cannot leave a stale label behind unnoticed
    for (const r of A.rules) for (const key of Object.keys(r.labels ?? {})) expect(leafPaths(r.value), `${r.symbol}: label for a key it does not have`).toContain(key);
    expect(bb.variantModels!.map(v => [v.variant, v.name, v.model])).toEqual(Object.entries(BB_VARIANTS).map(([id, v]) => [id, v.name, v.model]));
    expect(bb.variants).toMatch(/ONE enemy type/);
    for (const v of Object.values(BB_VARIANTS)) expect(bb.variants).toContain(v.name);
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

// Task studio-screacher-production-20261110-221858-01 (lane REGISTRY-DOCS), schema 3.
describe('enemy spawn reference: the seeded roster (ai/enemyRoster.ts)', () => {
  const combat = LEVEL_IDS.filter(l => !ZOMBIE_FREE_LEVELS.includes(l));

  it('every family\'s roster rule is FAMILY_ROSTER (no copied numbers); the Screacher and BB are roster-only: weight 0 in every pool', () => {
    const r = ref();
    expect([r.roster.version, r.roster.lane]).toEqual([ROSTER_VERSION, ROSTER_LANE]);
    expect(r.roster.zombieFreeLevels).toEqual([...ZOMBIE_FREE_LEVELS]);
    expect(r.roster.rosterOnly).toEqual([...ROSTER_ONLY_FAMILIES]);
    expect(r.roster.families.map(f => f.family)).toEqual([...ENEMY_FAMILY_IDS]); // every registered family decides, in registry order
    for (const f of r.roster.families) {
      const rule = FAMILY_ROSTER[f.family as keyof typeof FAMILY_ROSTER];
      expect([f.mode, f.why], f.family).toEqual([rule.mode, rule.why]);
      expect(f.rosterOnly, f.family).toBe(ROSTER_ONLY_FAMILIES.includes(f.family as never));
      if (rule.mode === 'baseline') { expect([f.rate, f.place, f.since, f.key, f.counts, f.slots]).toEqual([null, null, null, null, null, null]); continue; }
      expect([f.rate, f.place, f.since, f.key], f.family).toEqual([rule.rate, rule.place, rule.since, rule.key]);
      expect(f.levelRates, f.family).toEqual(Object.entries(rule.levelRates ?? {}).map(([level, rate]) => ({level, rate})));
      expect(f.contexts, f.family).toEqual(rule.place === 'context-one' ? [...rule.contexts] : null);
      if (rule.place === 'count') {
        expect(f.counts!.map(c => [c.count, c.weight])).toEqual(rule.counts.map(c => [...c]));
        expect(f.counts!.reduce((t, c) => t + c.share, 0)).toBeCloseTo(1, 9);
        expect(f.countMean!).toBeCloseTo(rule.counts.reduce((t, [n, w]) => t + n * w, 0) / rule.counts.reduce((t, [, w]) => t + w, 0), 9);
        expect(f.slots).toMatchObject({contexts: [...rule.slots.contexts], excludeKinds: [...rule.slots.excludeKinds], excludeRooms: [...rule.slots.excludeRooms],
          minSideCells: rule.slots.minSideCells, minSideM: rule.slots.minSideCells * CELL, minAreaCells: rule.slots.minAreaCells, minAreaM2: rule.slots.minAreaCells * CELL * CELL});
        expect([f.spacingM, f.variants]).toEqual([rule.spacingM, [...rule.variants]]);
        // the rule's numbers are in its plain-language policy too
        for (const n of [rule.spacingM, rule.slots.minSideCells, rule.slots.minAreaCells]) expect(f.placement, f.family).toContain(String(n));
      } else expect([f.counts, f.slots, f.spacingM, f.variants], f.family).toEqual([null, null, null, null]);
    }
    // the present families are placed the most constrained first; every seeded family is in the order exactly once
    expect([...r.roster.order].sort()).toEqual(ENEMY_FAMILY_IDS.filter(f => FAMILY_ROSTER[f].mode === 'seeded').sort());
    // the order is the source's own exported priority (ROSTER_PLACE_PRIORITY; the reference keeps no copy): families sorted by it,
    // ties in registry order — and a rule marked `last` (BB, roster version 3: task studio-bb-production-20261112-234540-01) after
    // every policy (ROSTER_PLACE_LAST), so the families of the earlier versions keep their slots
    const prio = (f: string) => { const rule = FAMILY_ROSTER[f as keyof typeof FAMILY_ROSTER]; return rule.mode !== 'seeded' ? -1 : rule.last ? ROSTER_PLACE_LAST : ROSTER_PLACE_PRIORITY[rule.place]; };
    const want = ENEMY_FAMILY_IDS.map((f, k) => [f, k] as const).filter(([f]) => FAMILY_ROSTER[f].mode === 'seeded').sort((a, b) => prio(a[0]) - prio(b[0]) || a[1] - b[1]).map(x => x[0]);
    expect(r.roster.order).toEqual(want);
    for (const f of r.roster.families) { const rule = FAMILY_ROSTER[f.family as keyof typeof FAMILY_ROSTER]; expect(f.last, f.family).toBe(rule.mode === 'seeded' && rule.last === true); }
    const lastOnes = r.roster.families.filter(f => f.last).map(f => f.family);
    expect(r.roster.order.slice(r.roster.order.length - lastOnes.length)).toEqual(lastOnes);
    for (const f of r.roster.families.filter(x => x.last)) expect(f.placement, f.family).toMatch(new RegExp(`PLACED LAST[\\s\\S]*roster version ${f.since}`));
    expect(readSource('tools/pages/enemyReference.ts')!).not.toMatch(/'context-one': \d/); // no priority table of its own
    // a share top-up says what "present" guarantees: at least one (the source's min-one step), none only without a slot
    for (const f of r.roster.families.filter(x => x.place === 'share-topup')) expect(f.placement, f.family).toMatch(/PRESENT MEANS AT LEAST ONE[\s\S]*no slot/);
    expect(r.roster.rules.join(' ')).toMatch(/PRESENT MEANS AT LEAST ONE for every policy/);
    expect(r.roster.rules.join(' ')).toMatch(new RegExp(`version ${ROSTER_VERSION}`));
    expect(r.roster.rules.join(' ')).toContain(ROSTER_LANE);
    // THE SCREACHER AND BB: registered, roster-only, no band in any pool of any level — level pool, a context's own pool, the horde pool
    expect(r.families.filter(f => f.rosterOnly).map(f => f.id)).toEqual([...ROSTER_ONLY_FAMILIES]);
    for (const id of ROSTER_ONLY_FAMILIES) {
      const fam = r.families.find(f => f.id === id)!;
      expect([fam.rosterOnly, fam.model, fam.levels], id).toEqual([true, null, combat]);
      for (const L of r.levels) {
        expect(L.pool.rows.find(x => x.family === id), `${L.id} ${id}`).toMatchObject({weight: 0, share: 0});
        expect(L.pool.expectedPerLevel.find(x => x.family === id), `${L.id} ${id}`).toEqual({family: id, mean: 0, basis: 'exact'});
        for (const c of L.contexts) if (c.families) expect(c.families.rows.find(x => x.family === id), `${L.id} ${c.id} ${id}`).toMatchObject({weight: 0, share: 0});
        if (L.horde) expect(L.horde.pool.rows.find(x => x.family === id), `${L.id} horde ${id}`).toMatchObject({weight: 0, share: 0});
      }
    }
    for (const L of r.levels) expect(L.generator.note, L.id).toMatch(/seeded roster/i);
  });

  it('every level states every family: rate === rosterRate, eligibility === the profile, the roll check === familyInRoster', () => {
    const r = ref();
    expect(r.roster.rollCheckSeeds).toBe(ROSTER_ROLL_CHECK_SEEDS);
    for (const L of r.levels) {
      const id = L.id as LevelId, P = spawnProfile(id);
      expect(L.roster.rows.map(x => x.family), id).toEqual([...ENEMY_FAMILY_IDS]);
      expect(L.roster.zombieFree, id).toBe(ZOMBIE_FREE_LEVELS.includes(id));
      for (const row of L.roster.rows) {
        const f = row.family as keyof typeof FAMILY_ROSTER, what = `${id} ${f}`;
        if (ZOMBIE_FREE_LEVELS.includes(id)) { expect([row.eligibility, row.rate, row.rolled], what).toEqual(['zombie-free', 0, null]); continue; }
        if (FAMILY_ROSTER[f].mode === 'baseline') { expect([row.eligibility, row.rate, row.rolled], what).toEqual(['baseline', 0, null]); continue; }
        if (row.eligibility === 'never') { expect([row.rate, row.rolled], what).toEqual([0, null]); continue; }
        expect(['every-map', 'layout'], what).toContain(row.eligibility);
        expect(row.rate, what).toBe(rosterRate(f, id));
        expect(row.rolled!.seeds, what).toBe(ROSTER_ROLL_CHECK_SEEDS);
        expect(row.status, what).toContain(`${Math.round(row.rate * 1000) / 10} %`);
      }
      // the knob list names every rolled family's rate
      for (const row of L.roster.rows.filter(x => x.rolled)) expect(L.knobs.find(k => k.what === `seeded roster rate (${row.family})`)!.value, `${id} ${row.family}`).toBe(row.rate);
      // which families a level is never rolled into: the Siren without an eligibility rule (the Subway), the Strainer without a context that runs
      const row = (f: string) => L.roster.rows.find(x => x.family === f)!;
      if (!ZOMBIE_FREE_LEVELS.includes(id)) {
        expect(row('siren').eligibility, id).toBe(P.eligibility?.siren ? 'every-map' : 'never');
        expect(row('screacher').eligibility, id).toBe('every-map');
        expect(row('bb').eligibility, id).toBe('every-map');
        // the Strainer depends on the map (an ambient spawn in a service annex / the damp zone), never "every map"; where the sample
        // found such a map the row cannot say never
        expect(['layout', 'never'], id).toContain(row('strainer').eligibility);
        if ((L.roster.census?.families.find(x => x.family === 'strainer')?.eligible ?? 0) > 0) expect(row('strainer').eligibility, id).toBe('layout');
      }
    }
    expect(level('subway').roster.rows.find(x => x.family === 'siren')!.eligibility).toBe('never');
    expect(level('bunker').roster.rows.find(x => x.family === 'strainer')!).toMatchObject({eligibility: 'layout', rate: rosterRate('strainer', 'bunker')}); // its damp zone
    expect(level('reactor').roster.rows.filter(x => x.rate === 1).map(x => x.family)).toEqual(['blightbelly', 'ratdog']); // the Reactor always has both
    // the roll check is the real roll: recount two rows (a default rate, a per-level override) over the same seeds
    for (const [l, f] of [['subway', 'screacher'], ['reactor', 'ratdog'], ['office', 'siren'], ['mall', 'bb']] as const) {
      let n = 0;
      for (let seed = 1; seed <= ROSTER_ROLL_CHECK_SEEDS; seed++) if (familyInRoster(f, l, seed)) n++;
      expect(level(l).roster.rows.find(x => x.family === f)!.rolled!.present, `${l} ${f}`).toBe(n);
      // 10,000 seeds: the share is the rate within sampling error (3.5 sigma of a binomial)
      const rate = rosterRate(f, l);
      expect(Math.abs(n / ROSTER_ROLL_CHECK_SEEDS - rate), `${l} ${f}`).toBeLessThanOrEqual(3.5 * Math.sqrt(rate * (1 - rate) / ROSTER_ROLL_CHECK_SEEDS));
    }
  });

  it('the roster census is the pass itself: counts conserved, absent = none, Strainer exactly one, Screachers 1-3, zombie-free = nothing', () => {
    const r = ref();
    for (const L of r.levels) {
      const id = L.id as LevelId, c = L.roster.census;
      if (ZOMBIE_FREE_LEVELS.includes(id)) {
        expect(c, id).toBeNull();
        expect(L.census!.placed.every(p => p.total === 0 && p.rollTotal === 0), id).toBe(true); // no enemy of any family, before or after
        continue;
      }
      expect([c!.seeds, c!.layouts], id).toEqual([[...ENEMY_ROSTER_SEEDS], ENEMY_ROSTER_SEEDS.length]);
      expect(c!.note).toMatch(/^SAMPLED/);
      expect(c!.note).toMatch(/SMALL sample/);
      expect(c!.families.map(f => f.family), id).toEqual([...ENEMY_FAMILY_IDS]);
      const sum = (k: 'before' | 'after' | 'removed' | 'added') => c!.families.reduce((t, f) => t + f[k], 0);
      // the pass never adds or removes a spawn: both stages count the same ambient spawns, and every slot taken is a slot given
      expect([sum('before'), sum('after')], id).toEqual([c!.ambient, c!.ambient]);
      expect(sum('removed'), id).toBe(sum('added'));
      for (const f of c!.families) {
        const what = `${id} ${f.family}`, rule = FAMILY_ROSTER[f.family as keyof typeof FAMILY_ROSTER];
        expect(f.after, what).toBe(f.before - f.removed + f.added);
        expect(f.holding <= f.present && f.present <= f.eligible && f.eligible <= c!.layouts, what).toBe(true);
        expect(f.histogram.reduce((t, h) => t + h.layouts, 0), what).toBe(c!.layouts);
        expect(f.histogram.reduce((t, h) => t + h.count * h.layouts, 0), what).toBe(f.after);
        expect(f.histogram[0].layouts, what).toBe(c!.layouts - f.holding);
        if (rule.mode === 'baseline') { expect([f.eligible, f.present, f.holding], what).toEqual([c!.layouts, c!.layouts, c!.layouts]); continue; }
        // the sample's present / absent pattern is the roll of those seeds on this level (an ineligible map is never rolled into it)
        const rolled = ENEMY_ROSTER_SEEDS.filter(seed => familyInRoster(f.family as never, id, seed)).length;
        if (L.roster.rows.find(x => x.family === f.family)!.eligibility === 'every-map') expect(f.present, what).toBe(rolled);
        else expect(f.present, what).toBeLessThanOrEqual(rolled);
        // PRESENT MEANS AT LEAST ONE, for every policy: a level whose roll includes the family holds it unless the pass reported that it
        // has no slot for it (the Siren without an enemy in an eligible room; a share top-up without a zombie slot of its pools)
        expect(f.holding, `${what}: present = at least one unless no slot`).toBe(f.present - f.noSlot);
        if (rule.place === 'context-one') expect([f.holding, f.max <= 1, f.noSlot], what).toEqual([f.present, true, 0]); // a selected Strainer: exactly one
        if (rule.place === 'count') {
          expect([f.before, f.removed, f.holding, f.noSlot], what).toEqual([0, 0, f.present, 0]); // only the roster places it; a selected level has it
          expect(f.max, what).toBeLessThanOrEqual(Math.max(...rule.counts.map(([n]) => n)));
          expect(f.after, what).toBeGreaterThanOrEqual(f.present); // at least one per selected level
        }
      }
    }
    // one seed per combat level against the REGISTRY with the roster version on (what the game runs) and its own report
    for (const id of combat) {
      const seed = ENEMY_ROSTER_SEEDS[2];
      const on = LEVELS[id].generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false), rosterVersion: ROSTER_VERSION});
      const off = LEVELS[id].generate('main', {levelSeed: seed, startWeapon: startWeaponFor(false)});
      const rep = rosterOf(on)!, one = rosterCensus(id, [seed]);
      expect(rosterOf(off), id).toBeUndefined(); // no roster version = no pass (the pinned fingerprints' path)
      expect(rep.version).toBe(ROSTER_VERSION);
      const count = (l: typeof on, f: string) => l.zombies.filter(z => z.horde === undefined && (z.archetype ?? 'zombie') === f).length;
      for (const f of one.families) {
        const what = `${id} ${seed} ${f.family}`, fr = rep.families[f.family as keyof typeof rep.families];
        expect([f.before, f.after], what).toEqual([count(off, f.family), count(on, f.family)]);
        if (fr) expect([f.eligible, f.present, f.noSlot], what).toEqual([fr.eligible ? 1 : 0, fr.present ? 1 : 0, fr.noSlot ? 1 : 0]);
      }
      // the 4-seed census of the same seed agrees with it too (one pass, two views)
      const cen = enemyCensus(id, [seed]);
      for (const f of ENEMY_FAMILY_IDS) expect(cen.spawns.filter(s => s.family === f).length, `${id} ${f}`).toBe(count(on, f));
      // a Screacher or a BB (roster version 3) carries one of its own approved variants; nothing else carries one
      for (const z of on.zombies) expect(z.variant !== undefined, id).toBe(z.archetype === 'screacher' || z.archetype === 'bb');
      for (const z of on.zombies) if (z.variant !== undefined) expect(Object.keys(z.archetype === 'bb' ? BB_VARIANTS : SCREACHER_VARIANTS)).toContain(z.variant);
    }
    // the eligibility census is the stage BEFORE the pass (the plain generator): its note says so
    expect(level('office').eligibilityCensus!.note).toMatch(/BEFORE the seeded roster pass/);
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
      'game/src/ai/spawnTables.ts', 'tools/pages/enemyReference.ts', 'tools/pages/enemyReferenceTypes.ts', 'enemies/index.html',
      // task studio-screacher-production-20261110-221858-01: the seeded roster and the Screacher's own page
      'game/src/ai/enemyRoster.ts', 'FAMILY_ROSTER', 'ROSTER_ONLY_FAMILIES', 'ZOMBIE_FREE_LEVELS', 'ROSTER_VERSION', 'applyEnemyRoster', 'docs/screacher.md',
      // task studio-bb-production-20261112-234540-01: BB's own page and the placed-last rule
      'docs/bb.md', 'game/src/ai/bb.ts', 'placed last']) {
      expect(doc!.includes(s), s).toBe(true);
    }
    // the roster section states every seeded family's rate as the source has it (a rate change must reach the page)
    const lines = doc!.split('\n');
    const from = lines.findIndex(l => l.startsWith('## The seeded roster'));
    expect(from, 'docs/enemy-spawns.md has a "## The seeded roster" section').toBeGreaterThanOrEqual(0);
    const to = lines.findIndex((l, i) => i > from && l.startsWith('## '));
    const rosterDoc = lines.slice(from, to < 0 ? lines.length : to);
    const percent = (rate: number) => `${Math.round(rate * 1000) / 10} %`;
    for (const f of ENEMY_FAMILY_IDS) {
      const rule = FAMILY_ROSTER[f];
      const row = rosterDoc.find(l => l.startsWith(`| \`${f}\` |`)); // the family's row of the roster table
      expect(row, `roster table row of ${f}`).toBeTruthy();
      if (rule.mode !== 'seeded') continue;
      expect(row!, f).toContain(percent(rule.rate));
      for (const [l, rate] of Object.entries(rule.levelRates ?? {})) expect(row!, `${f} ${l}`).toContain(percent(rate as number));
    }
    expect(existsSync(new URL('../../docs/screacher.md', import.meta.url))).toBe(true);
    // the roster section states the version the source is at, and marks the family the pass places last
    expect(rosterDoc.join('\n')).toContain(`\`ROSTER_VERSION\` is ${ROSTER_VERSION}`);
    for (const f of ENEMY_FAMILY_IDS) { const rule = FAMILY_ROSTER[f]; if (rule.mode === 'seeded' && rule.last) expect(rosterDoc.find(l => l.startsWith(`| \`${f}\` |`))!, f).toMatch(/placed last/); }
    for (const f of (doc!.match(/`((?:game|tools|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md))`/g) ?? []).map(m => m.slice(1, -1))) {
      expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(true);
    }
  });

  // Task studio-screacher-production-20261110-221858-01 (lane REGISTRY-DOCS): docs/screacher.md states its numbers in tables whose last
  // cell names the constant(s) they come from. Every such row is checked against the live constant: a retune that does not reach the
  // page fails here (the page never holds a number the source has moved away from).
  it('docs/screacher.md: every constant table row === the exported constant; its derived statements and its file names hold', () => {
    const doc = readSource('docs/screacher.md');
    expect(doc).not.toBeNull();
    const ROOTS: Record<string, unknown> = {
      SCREACHER_STATS, SCREACHER_ASSET, SCREACHER_SPEED, SCREACHER_AGGRO, SCREACHER_NOISE, SCREACHER_SENSE, SCREACHER_ECHO, SCREACHER_SCALE, SCREACHER_MAX_TOP_M,
      SCREACHER_VOICE_Y, IMPACT_FAMILY_LOUDNESS, HEARING, FAMILY_ROSTER, MELEE_MASS,
    };
    const resolve = (path: string): unknown => path.split('.').reduce<unknown>((o, k, i) => (i === 0 ? ROOTS[k] : (o as Record<string, unknown> | undefined)?.[k]), undefined);
    const shown = (v: number) => String(Math.round(v * 1e6) / 1e6);
    const hasNumber = (cell: string, v: number) => new RegExp(`(?<![\\d.])${shown(v).replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(cell);
    let rows = 0;
    const roots = new Set<string>();
    for (const line of doc!.split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 3) continue;
      const symbols = [...cells[cells.length - 1].matchAll(/`([A-Z][A-Z_]*(?:\.[A-Za-z0-9_]+)*)`/g)].map(m => m[1]).filter(sym => sym.split('.')[0] in ROOTS);
      if (!symbols.length) continue;
      const valueCell = cells[cells.length - 2];
      for (const sym of symbols) {
        const v = resolve(sym);
        expect(typeof v, `${sym} is a number constant (row: ${line})`).toBe('number');
        expect(hasNumber(valueCell, v as number), `${sym} = ${shown(v as number)} in "${valueCell}"`).toBe(true);
        roots.add(sym.split('.')[0]);
      }
      rows++;
    }
    // the page really carries its tables: the stats, the senses, every noise, the heat rules, the paces, the echo, the roster rule
    expect(rows).toBeGreaterThanOrEqual(50);
    for (const r of ['SCREACHER_STATS', 'SCREACHER_SENSE', 'SCREACHER_NOISE', 'SCREACHER_AGGRO', 'SCREACHER_SPEED', 'SCREACHER_ECHO', 'HEARING', 'FAMILY_ROSTER']) expect(roots, r).toContain(r);
    // every leaf of the constants a player's choices depend on has its row (nothing of them is left to prose)
    const leafPaths = (name: string, o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leafPaths(`${name}.${k}`, v) : [`${name}.${k}`]));
    for (const [name, o] of [['SCREACHER_NOISE', SCREACHER_NOISE], ['SCREACHER_SENSE', SCREACHER_SENSE], ['SCREACHER_ECHO', SCREACHER_ECHO], ['SCREACHER_SPEED', SCREACHER_SPEED], ['HEARING', HEARING]] as const) {
      for (const p of leafPaths(name, o)) expect(doc!.includes(`\`${p}\``), `${p} has a row`).toBe(true);
    }
    // the derived statements, recomputed from the constants
    const A = SCREACHER_AGGRO, tier = (heat: number) => (heat >= A.frenzyAt ? 'frenzy' : heat >= A.huntAt ? 'hunt' : 'investigate');
    expect([tier(A.weight.gunshot), tier(2 * A.weight.gunshot), tier(3 * A.weight.gunshot), tier(2 * A.weight.run)]).toEqual(['investigate', 'hunt', 'frenzy', 'hunt']);
    expect(doc!).toContain(`${shown(A.quietHoldS + (A.heatMax - A.huntAt) / A.decayPerS)} s of silence bring it back to the walking tier and ${shown(A.quietHoldS + A.heatMax / A.decayPerS)} s to no heat`);
    const rule = FAMILY_ROSTER.screacher;
    if (rule.mode !== 'seeded' || rule.place !== 'count') throw new Error('the Screacher is a counted roster family');
    const total = rule.counts.reduce((t, [, w]) => t + w, 0);
    expect(doc!).toContain(`holds ${rule.counts.map(([n]) => n).join(', ').replace(/, (\d+)$/, ' or $1')} (\`FAMILY_ROSTER.screacher.counts\`: ${rule.counts.map(([, w]) => `${Math.round(1000 * w / total) / 10} %`).join(', ').replace(/, ([\d.]+ %)$/, ' and $1')} of those`);
    expect(doc!).toContain(`The other ${Math.round(1000 * (1 - rule.rate)) / 10} % of levels hold none.`);
    // where it does not stand: every context, excluded area kind and excluded room of the rule is named on this page and in the
    // roster section of docs/enemy-spawns.md (an exclusion added to the rule must reach both)
    const spawnsDoc = readSource('docs/enemy-spawns.md')!;
    for (const name of [...rule.slots.contexts, ...rule.slots.excludeKinds, ...rule.slots.excludeRooms]) {
      expect(doc!.includes(`\`${name}\``), `docs/screacher.md names ${name}`).toBe(true);
      expect(spawnsDoc.includes(`\`${name}\``), `docs/enemy-spawns.md names ${name}`).toBe(true);
    }
    // the four bodies: every variant with its name, lazy model key and file
    for (const [id, v] of Object.entries(SCREACHER_VARIANTS)) {
      expect(doc!, id).toContain(`| \`${id}\` | ${v.name} | \`${v.model}\` | \`${ENEMY_MODEL_FILES[v.model].url}\` |`);
    }
    // every repository file the page names exists
    for (const f of (doc!.match(/`((?:game|tools|docs)\/[A-Za-z0-9_./-]+\.(?:ts|md|mjs|json))`/g) ?? []).map(m => m.slice(1, -1))) {
      expect(existsSync(new URL(`../../${f}`, import.meta.url)), f).toBe(true);
    }
  });
});
