// Task enemy-spawn-tables-20261030 (lane SPAWN): the source-generated ENEMY SPAWN reference (tools/pages/enemyReference.ts).
//  - coverage: every registered level / archetype family / generation context appears (in registry order), an explicit room entry
//    appears automatically, and unknown registrations fail the build;
//  - runtime agreement: every number === the profile API, context runs === what the real generator runs, the census === a fresh
//    generation of the registered generator (eligible m² = cells its own candidate filter accepted x CELL²);
//  - exact maths (E[count], shares, expected coated share vs the real type roll), determinism, source links, docs agreement.

import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {
  ENEMY_FAMILY_IDS, SPAWN_CONTEXT_IDS, rollZombieTypes, roomKey, setSpawnCensusHook, spawnProfile, type SpawnCandidateReport, type SpawnProfile,
} from '../src/ai/spawnTables';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {OFFICE_FLOORS} from '../src/gen/office/frame';
import {startWeaponFor} from '../src/weapons/pistol';
import {
  ENEMY_CENSUS_SEEDS, ENEMY_GENERATED_FROM, ENEMY_LEVEL_ADAPTER, buildEnemyReference, enemyCensus, expectedCoatedShare,
} from '../../tools/pages/enemyReference';
import {ENEMY_REFERENCE_SCHEMA, type EnemyReference, type SourceLoc} from '../../tools/pages/enemyReferenceTypes';

const readSource = (f: string): string | null => {
  try { return readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'); } catch { return null; }
};
let cached: EnemyReference | null = null;
const ref = (): EnemyReference => (cached ??= buildEnemyReference({readSource, commit: 'test'}));
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
        lo += c.perLevel.lo; hi += c.perLevel.hi; mean += c.perLevel.mean;
      }
      expect([L.total.lo, L.total.hi, L.total.mean]).toEqual([lo, hi, mean]);
      const den = P.families.reduce((s, [, w]) => s + w, 0);
      expect(L.pool.denominator).toBe(den);
      L.pool.rows.forEach((row, i) => {
        expect(row.weight).toBe(P.families[i][1]);
        expect(row.share).toBeCloseTo(P.families[i][1] / den, 7);
        expect(L.pool.expectedPerLevel[i].mean).toBeCloseTo(row.share * L.total.mean, 6);
      });
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
    try { layout = LEVELS.office.generate('main', {levelSeed: 222, startWeapon: 'pistol'}); } finally { setSpawnCensusHook(null); }
    for (const r of reports) if (r.layout === layout) runs.set(r.context, (runs.get(r.context) ?? 0) + 1);
    expect(Object.fromEntries(runs)).toEqual(Object.fromEntries(level('office').contexts.map(c => [c.id, c.runs])));
    expect(level('office').contexts.find(c => c.id === 'floor')!.runs).toBe(OFFICE_FLOORS.length - 1);
  });

  it('the sampled census is the registered generator: placed / eligible floor agree with a fresh generation', () => {
    const r = ref();
    expect(r.meta.census.map(c => [c.level, c.seeds])).toEqual(LEVEL_IDS.map(l => [l, [...ENEMY_CENSUS_SEEDS]]));
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
