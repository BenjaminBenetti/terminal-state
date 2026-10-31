// Task track1-siren-blightbelly-20261031 (lane SPAWN): the level / enemy REGISTRATION CONTRACT (docs/level-enemy-contract.md) and the
// new families' spawn rules:
//  - every registered level declares an integer tier + a valid spawn profile (Subway 0, Office 1); a missing / wrong one is an
//    error (synthetic registries), never a silent Subway / Office default; no hardcoded level count;
//  - familyPool defaults (Blightbelly 5 % on, Siren off) and the opt-in rule; invalid eligibility is rejected;
//  - the rat/dog band of the roll is untouched by the new families (identical rat/dog draws);
//  - Siren eligibility criteria on synthetic grids (context, kind, room, size, clear patch, doorway keep-off, fair passage, cap);
//  - census of the real generators: zero Sirens in the Subway, Office Sirens only in eligible office-floor rooms, ~2 per run,
//    Blightbelly ~5 % of the placed enemies on both levels, rat/dog ~5 %;
//  - spawn context tags cover every spawn of every registered level; killed indices stay dead for the new families.
//  - lane INTEG (task track3-eaton-centre-20261031): The Eaton's Center is registered (tier 2): its ambient spawns carry 'pit' /
//    'ring', its horde members the horde pool's own declared context (declaredSpawnContexts) — never an ambient family. The
//    synthetic "unregistered level" of the registry test is now 'arcade' (the id 'mall' is a real level).

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {FLOOR, Grid} from '../src/gen/grid';
import {LEVELS, LEVEL_IDS, levelTier} from '../src/levels/registry';
import {levelTiers, validateLevelRegistry} from '../src/levels/levelContract';
import {assignEnemyArchetypes, enemyRoll, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {
  DEFAULT_FAMILY_SHARES, ENEMY_FAMILY_IDS, ENEMY_POOL, HORDE_CONTEXT, MALL_SIREN_ELIGIBILITY, OFFICE_ENEMY_POOL, OFFICE_SIREN_ELIGIBILITY, OFFICE_SIREN_WEIGHT,
  OPT_IN_FAMILIES, SPAWN_PROFILES, declaredSpawnContexts, eligibilityFailure, eligibleFamily, familyPool, markSpawnContext, roomFamilyPool, sealsPassage,
  spawnContextOf, spawnProfile,
  validateSpawnProfile, type EnemyFamilyId, type FamilyEligibility, type SpawnProfile,
} from '../src/ai/spawnTables';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import type {StationLayout} from '../src/gen/stationTypes';

const SUBWAY = spawnProfile('subway'), OFFICE = spawnProfile('office');
const OLD_POOL = [['zombie', 0.95], ['ratdog', 0.05]] as const; // both levels before task track1

describe('level registry contract: explicit tiers + profiles', () => {
  it('the shipped registry is valid: Subway tier 0, Office tier 1, a profile for every registered level (no fixed count)', () => {
    expect(validateLevelRegistry()).toEqual([]);
    expect(levelTier('subway')).toBe(0);
    expect(levelTier('office')).toBe(1);
    expect(levelTier('mall')).toBe(2); // lane INTEG: The Eaton's Center
    expect(levelTiers()).toEqual(LEVEL_IDS.map(id => ({id, tier: LEVELS[id].tier})));
    for (const id of LEVEL_IDS) {
      expect(Number.isInteger(LEVELS[id].tier) && LEVELS[id].tier >= 0, id).toBe(true);
      expect(SPAWN_PROFILES[id].id).toBe(id);
    }
  });

  it('a level without a tier / profile, a bad tier, a mismatched id or a stray entry is an error — never a default', () => {
    const levels = {...LEVELS} as Record<string, unknown>;
    const profiles = {...SPAWN_PROFILES} as Record<string, SpawnProfile | undefined>;
    const arcade = {...LEVELS.office, id: 'arcade', tier: 1}; // lane INTEG: an UNREGISTERED id ('mall' is registered now)
    const v = (ids: string[], l: Record<string, unknown>, p: Record<string, SpawnProfile | undefined>) => validateLevelRegistry(ids, l as never, p);
    // a new level registered with a tier but no spawn profile
    expect(v([...LEVEL_IDS, 'arcade'], {...levels, arcade}, profiles).join('\n')).toMatch(/arcade: no spawn profile/);
    // ... with a profile but no tier
    const {tier: _drop, ...noTier} = arcade;
    const arcadeProfile = {...OFFICE, id: 'arcade', label: 'Arcade'};
    expect(v([...LEVEL_IDS, 'arcade'], {...levels, arcade: noTier}, {...profiles, arcade: arcadeProfile}).join('\n')).toMatch(/arcade: no difficulty tier/);
    for (const bad of [-1, 1.5, NaN, '1']) expect(v([...LEVEL_IDS, 'arcade'], {...levels, arcade: {...arcade, tier: bad}}, {...profiles, arcade: arcadeProfile}).join('\n')).toMatch(/arcade: tier .* not an integer/);
    // ... fully declared: valid (the contract accepts any number of levels)
    expect(v([...LEVEL_IDS, 'arcade'], {...levels, arcade}, {...profiles, arcade: arcadeProfile})).toEqual([]);
    // no LEVELS entry, mismatched ids, a profile / level outside LEVEL_IDS, an invalid profile
    expect(v([...LEVEL_IDS, 'arcade'], levels, {...profiles, arcade: arcadeProfile}).join('\n')).toMatch(/arcade: no LEVELS entry/);
    expect(v([...LEVEL_IDS], {...levels, office: {...LEVELS.office, id: 'subway'}}, profiles).join('\n')).toMatch(/office: LEVELS entry has id 'subway'/);
    expect(v([...LEVEL_IDS], levels, {...profiles, office: {...OFFICE, id: 'subway'}}).join('\n')).toMatch(/office: spawn profile has id/);
    expect(v([...LEVEL_IDS], {...levels, arcade}, profiles).join('\n')).toMatch(/arcade: LEVELS entry for a level not in LEVEL_IDS/);
    expect(v([...LEVEL_IDS], levels, {...profiles, arcade: arcadeProfile}).join('\n')).toMatch(/arcade: spawn profile for a level not in LEVEL_IDS/);
    expect(v([...LEVEL_IDS], levels, {...profiles, subway: {...SUBWAY, families: [['zombie', 1]]}}).join('\n')).toMatch(/family blightbelly missing/);
    expect(v(['subway', 'subway', 'office'], levels, profiles).join('\n')).toMatch(/listed twice/);
    expect(() => levelTier('arcade' as never)).toThrow(/not registered/);
    expect(() => spawnProfile('arcade' as never)).toThrow(/no spawn profile/);
  });
});

describe('family pools: defaults, opt-in, eligibility validation', () => {
  it('familyPool: every family in registry order, Blightbelly 5 % ON, Siren OFF, rat/dog 5 %, zombie the remainder', () => {
    expect(OPT_IN_FAMILIES).toEqual(['siren']);
    expect(DEFAULT_FAMILY_SHARES).toEqual({blightbelly: 0.05, siren: 0, ratdog: 0.05});
    expect(familyPool().map(([f]) => f)).toEqual([...ENEMY_FAMILY_IDS]);
    expect(familyPool()).toEqual([['zombie', 0.9], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0.05]]);
    expect(ENEMY_POOL).toEqual(familyPool());
    expect(SUBWAY.families).toBe(ENEMY_POOL);
    expect(OFFICE.families).toBe(OFFICE_ENEMY_POOL);
    expect(OFFICE_ENEMY_POOL).toEqual([['zombie', 0.71], ['blightbelly', 0.05], ['siren', OFFICE_SIREN_WEIGHT], ['ratdog', 0.05]]);
    for (const p of [SUBWAY, OFFICE]) expect(p.families.reduce((t, [, w]) => t + w, 0)).toBeCloseTo(1, 12);
    expect(() => familyPool({siren: 0.95})).toThrow(/exceed 1/);
    // the Subway never opts in; the Office does, with its eligibility rule
    expect(SUBWAY.eligibility?.siren).toBeUndefined();
    expect(OFFICE.eligibility?.siren).toBe(OFFICE_SIREN_ELIGIBILITY);
  });

  it('rejects an opt-in weight without a rule and every malformed eligibility rule', () => {
    const rule = OFFICE_SIREN_ELIGIBILITY;
    const withEl = (el: unknown, p: SpawnProfile = OFFICE): SpawnProfile => ({...p, eligibility: el as SpawnProfile['eligibility']});
    const bad: [string, SpawnProfile, RegExp][] = [
      ['siren weighted without a rule', {...SUBWAY, families: familyPool({siren: 0.1})}, /opt-in family .* needs an eligibility.siren rule/],
      ['unknown family', withEl({dragon: rule}), /eligibility.dragon: unknown family/],
      ['no contexts', withEl({siren: {...rule, contexts: []}}), /needs at least one context/],
      ['unknown context', withEl({siren: {...rule, contexts: ['cellar']}}), /unknown spawn context cellar/],
      ['undeclared context', withEl({siren: {...rule, contexts: ['station']}}), /context station is not declared/],
      ['unknown kind', withEl({siren: {...rule, kinds: ['attic']}}), /unknown area kind attic/],
      ['unknown room key', withEl({siren: {...rule, excludeRooms: ['ballroom']}}), /unknown room key ballroom/],
      ['fractional cap', withEl({siren: {...rule, maxPerLevel: 1.5}}), /maxPerLevel/],
      ['negative radius', withEl({siren: {...rule, passageRadiusM: -1}}), /passageRadiusM/],
      ['fallback to itself', withEl({siren: {...rule, fallback: 'siren'}}), /falls back to itself/],
      ['unknown fallback', withEl({siren: {...rule, fallback: 'ghost'}}), /unknown family ghost/],
      ['fallback with a rule', withEl({siren: {...rule, fallback: 'blightbelly'}, blightbelly: {...rule, fallback: 'zombie'}}), /has an eligibility rule of its own/],
      ['no reason', withEl({siren: {...rule, why: ' '}}), /needs a reason/],
      ['unknown knob', withEl({siren: {...rule, chance: 1}}), /unknown knob/],
    ];
    for (const [what, p, re] of bad) expect(validateSpawnProfile(p).join('\n'), what).toMatch(re);
    // explicit zero weight is the documented way to keep the Siren out (valid, with or without a rule)
    expect(validateSpawnProfile({...OFFICE, families: familyPool()})).toEqual([]);
    expect(validateSpawnProfile(SUBWAY)).toEqual([]);
  });
});

describe('the rat/dog band of the roll is untouched', () => {
  it('rat/dog iff the old pool drew a rat/dog — 200k (seed, index) rolls, Subway and Office pools; new families only take old zombie draws', () => {
    for (let k = 0; k < 200000; k++) {
      const seed = (k * 2654435761) >>> 0, i = k % 41;
      const old = pickEnemyArchetype(seed, i, OLD_POOL);
      for (const pool of [ENEMY_POOL, OFFICE_ENEMY_POOL]) {
        const now = pickEnemyArchetype(seed, i, pool);
        if ((old === 'ratdog') !== (now === 'ratdog')) throw new Error(`rat/dog draw moved at seed ${seed} index ${i}: ${old} -> ${now}`);
      }
    }
    // the bands: Office zombie [0, 0.71), blightbelly [0.71, 0.76), siren [0.76, 0.95), rat/dog [0.95, 1)
    let n = 0;
    for (let k = 0; k < 2000 && n < 50; k++) {
      const r = enemyRoll(k, 3);
      if (r >= 0.70 && r < 0.97) { n++; expect(pickEnemyArchetype(k, 3, OFFICE_ENEMY_POOL)).toBe(r < 0.71 ? 'zombie' : r < 0.76 ? 'blightbelly' : r < 0.95 ? 'siren' : 'ratdog'); }
    }
    expect(n).toBe(50);
  });
});

// --- synthetic geometry for the eligibility criteria -------------------------------------------------------------------------
/** A W x H storey: one room area (id 0) of open floor inside a one-cell wall; `blocked` = prop footprint cells. */
function room(w: number, h: number, opts: {blocked?: [number, number][]} = {}) {
  const g = new Grid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { g.cells[g.idx(x, y)] = FLOOR; g.area[g.idx(x, y)] = 0; }
  for (const [x, y] of opts.blocked ?? []) g.blocked[g.idx(x, y)] = 1;
  const layout = {
    seed: 5, grid: g, levels: [{grid: g}], doors: [] as {x: number; y: number; w: number; h: number; a: number; b: number}[],
    areas: [{id: 0, kind: 'room' as const, type: 'office-room' as const, purpose: 'office-meeting', x: 1, y: 1, w: w - 2, h: h - 2}],
    zombies: [] as {x: number; z: number; area: number; level?: number; archetype?: string; type: 'shambler'}[],
  };
  return layout;
}
const at = (x: number, y: number) => ({x: (x + 0.5) * 0.5, z: (y + 0.5) * 0.5, area: 0});
const RULE: FamilyEligibility = {...OFFICE_SIREN_ELIGIBILITY, doorKeepM: undefined, passageRadiusM: undefined};

describe('Siren eligibility criteria (synthetic storeys)', () => {
  it('context, kind, room exclusions and size', () => {
    const L = room(24, 24);
    expect(eligibilityFailure(RULE, L, at(12, 12), 'floor')).toBeNull();
    for (const c of ['street', 'roof', undefined] as const) expect(eligibilityFailure(RULE, L, at(12, 12), c)).toBe('context');
    const corridor = {...L, areas: [{...L.areas[0], kind: 'passage' as const, type: 'office-corridor' as const}]};
    expect(eligibilityFailure(RULE, corridor, at(12, 12), 'floor')).toBe('kind');
    for (const [type, purpose] of [['washroom', 'washroom'], ['office-stair', 'office-stair'], ['office-room', 'office-lobby']] as const) {
      expect(eligibilityFailure(RULE, {...L, areas: [{...L.areas[0], type, purpose}]}, at(12, 12), 'floor'), type).toBe('room');
    }
    const small = room(9, 24); // 7 x 22 cells: shorter side 3.5 m < 4 m
    expect(eligibilityFailure(RULE, small, at(4, 12), 'floor')).toBe('size');
    expect(eligibilityFailure(RULE, {...L, areas: [{...L.areas[0], w: 9, h: 10}]}, at(5, 5), 'floor')).toBe('size'); // 90 cells
  });

  it('clear floor patch of her own room, doorway keep-off and the fair-passage disc', () => {
    const L = room(24, 24, {blocked: [[13, 12]]});
    expect(eligibilityFailure(RULE, L, at(12, 12), 'floor')).toBe('clear'); // a desk cell beside her
    expect(eligibilityFailure(RULE, L, at(15, 12), 'floor')).toBeNull();
    // doorway 2.5 m away (< 3 m): rejected; 4 m away: fine
    const D = room(24, 24);
    D.doors.push({x: 12, y: 0, w: 2, h: 1, a: 0, b: 1});
    const rule = {...RULE, doorKeepM: 3};
    expect(eligibilityFailure(rule, D, at(12, 5), 'floor')).toBe('door');
    expect(eligibilityFailure(rule, D, at(12, 9), 'floor')).toBeNull();
    // fair passage: a 5 m wide room lets you walk round her 2.5 m disc only if a lane stays open
    const strip = room(40, 12); // floor rows 1..10 = 5 m wide
    expect(sealsPassage(strip.grid, at(20, 5).x, at(20, 5).z, 2.5)).toBe(true); // middle: seals the strip
    const wide = room(40, 22); // 10 m wide
    expect(sealsPassage(wide.grid, at(20, 10).x, at(20, 10).z, 2.5)).toBe(false);
    expect(eligibilityFailure({...RULE, passageRadiusM: 2.5}, strip, at(20, 5), 'floor')).toBe('passage');
    expect(eligibilityFailure({...RULE, passageRadiusM: 2.5}, wide, at(20, 10), 'floor')).toBeNull();
    // missing geometry is never eligible (conservative)
    expect(eligibilityFailure(RULE, {areas: D.areas}, at(12, 12), 'floor')).toBe('geometry');
  });

  it('an ineligible or over-cap draw falls back to a zombie; the cap counts the whole level; tags decide the context', () => {
    const L = room(60, 60);
    for (let k = 0; k < 6; k++) L.zombies.push({...at(8 + k * 8, 30), type: 'shambler'});
    const P: SpawnProfile = {...OFFICE, eligibility: {siren: {...RULE, maxPerLevel: 4}}};
    const placed = new Map<EnemyFamilyId, number>();
    const got = L.zombies.map((z, i) => { const f = eligibleFamily(P, 'siren', L, z, i, placed); placed.set('siren', (placed.get('siren') ?? 0) + (f === 'siren' ? 1 : 0)); return f; });
    expect(got).toEqual(['zombie', 'zombie', 'zombie', 'zombie', 'zombie', 'zombie']); // untagged in a multi-context profile
    markSpawnContext(L, 0, 'floor');
    expect(spawnContextOf(L, P, 5)).toBe('floor');
    placed.clear();
    const got2 = L.zombies.map((z, i) => { const f = eligibleFamily(P, 'siren', L, z, i, placed); if (f === 'siren') placed.set('siren', (placed.get('siren') ?? 0) + 1); return f; });
    expect(got2).toEqual(['siren', 'siren', 'siren', 'siren', 'zombie', 'zombie']);
    // other families never consult the rule; a single-context profile implies its context
    expect(eligibleFamily(P, 'blightbelly', L, L.zombies[0], 0)).toBe('blightbelly');
    // (Track 2, lane CONTENT: the shipped Subway has two contexts now — station + service — so a synthetic single-context profile)
    expect(spawnContextOf({}, {...SUBWAY, contexts: {station: SUBWAY.contexts.station}}, 0)).toBe('station');
    expect(spawnContextOf({}, SUBWAY, 0)).toBeUndefined();
    expect(spawnContextOf({}, OFFICE, 0)).toBeUndefined();
  });
});

// --- census of the real generators -------------------------------------------------------------------------------------------
const OFFICE_RUNS = 36, SUBWAY_RUNS = 36;
const offices: StationLayout[] = [], stations: StationLayout[] = [];
const officeSeed = (k: number) => 810000 + k * 37, stationSeed = (k: number) => 910000 + k * 53;
const officeWeapon = (k: number) => (k % 2 ? 'rifle' : 'pistol') as 'rifle' | 'pistol';
const census = () => {
  if (!offices.length) for (let k = 0; k < OFFICE_RUNS; k++) offices.push(generateOfficeLevel({levelSeed: officeSeed(k), startWeapon: officeWeapon(k)}));
  if (!stations.length) for (let k = 0; k < SUBWAY_RUNS; k++) stations.push(generateStation(stationSeed(k), {startWeapon: 'rifle'}));
};
// (task studio-alpha-track2-round2-20261031-01, R6: the service annexes draw from their own pool — rat/dog 0.20 — so the level-pool
// shares are measured on the CORE spawns, and the service spawns separately)
const share = (ls: StationLayout[], f: string, P: SpawnProfile, service = false) => {
  let n = 0, t = 0;
  for (const l of ls) l.zombies.forEach((z, i) => {
    if ((spawnContextOf(l, P, i) === 'service') !== service) return;
    t++; if ((z.archetype ?? 'zombie') === f) n++;
  });
  return n / t;
};

describe('spawn census (real generators)', () => {
  it('Subway: zero Sirens; Blightbelly and rat/dog ~5 % of the placed enemies', () => {
    census();
    expect(share(stations, 'siren', SUBWAY)).toBe(0);
    expect(share(stations, 'siren', SUBWAY, true)).toBe(0);
    const b = share(stations, 'blightbelly', SUBWAY), r = share(stations, 'ratdog', SUBWAY), rs = share(stations, 'ratdog', SUBWAY, true);
    process.stdout.write(`\n[enemy-spawn-contract] Subway ${SUBWAY_RUNS} runs: core blightbelly ${(b * 100).toFixed(2)} %, rat/dog ${(r * 100).toFixed(2)} %; service rat/dog ${(rs * 100).toFixed(2)} %\n`);
    expect(Math.abs(b - 0.05)).toBeLessThan(0.02);
    expect(Math.abs(r - 0.05)).toBeLessThan(0.02);
    // the service spawns' configured 0.20 (sampled outcome, ~200 spawns: a loose band, never a per-annex quota)
    expect(Math.abs(rs - 0.2)).toBeLessThan(0.09);
  });

  it('Office: ~2 Sirens per complete run, only in eligible office-floor rooms; Blightbelly / rat/dog ~5 %; every spawn context-tagged', () => {
    census();
    const per = offices.map(l => l.zombies.filter(z => z.archetype === 'siren').length);
    const mean = per.reduce((a, b) => a + b, 0) / per.length;
    for (const l of offices) {
      l.zombies.forEach((z, i) => {
        const ctx = spawnContextOf(l, OFFICE, i);
        expect(ctx && ctx in OFFICE.contexts, `${l.seed}#${i} context ${String(ctx)}`).toBe(true);
        if (z.archetype !== 'siren') return;
        expect(ctx).toBe('floor');
        expect((z.level ?? 0) >= 2 && (z.level ?? 0) <= 8).toBe(true);
        expect(eligibilityFailure(OFFICE_SIREN_ELIGIBILITY, l, z, ctx)).toBeNull();
        expect(pickEnemyArchetype(l.seed, i, roomFamilyPool(OFFICE, l.areas[z.area]))).toBe('siren');
      });
      expect(per[offices.indexOf(l)]).toBeLessThanOrEqual(OFFICE_SIREN_ELIGIBILITY.maxPerLevel!);
    }
    const b = share(offices, 'blightbelly', OFFICE), r = share(offices, 'ratdog', OFFICE);
    expect(share(offices, 'siren', OFFICE, true)).toBe(0);
    process.stdout.write(`\n[enemy-spawn-contract] Office ${OFFICE_RUNS} runs: Sirens / run mean ${mean.toFixed(2)}, none ${per.filter(v => !v).length}, max ${Math.max(...per)}; blightbelly ${(b * 100).toFixed(2)} %, rat/dog ${(r * 100).toFixed(2)} %\n`);
    expect(mean).toBeGreaterThan(1.3);
    expect(mean).toBeLessThan(2.7);
    expect(Math.abs(b - 0.05)).toBeLessThan(0.02);
    expect(Math.abs(r - 0.05)).toBeLessThan(0.02);
  });

  it('every registered level: each spawn carries a context its profile declares (annex contexts must tag their spawns too)', () => {
    for (const id of LEVEL_IDS) {
      const l = LEVELS[id].generate('main', {levelSeed: 4242, startWeapon: 'rifle'});
      const p = spawnProfile(id);
      // lane INTEG: the declared contexts = the ambient `contexts` + the horde pool's own context when the profile has hordes
      l.zombies.forEach((_, i) => expect(declaredSpawnContexts(p), `${id}#${i}`).toContain(spawnContextOf(l, p, i)));
      // the horde pool's members (and only they) carry its context; no ambient family roll ever reaches them
      l.zombies.forEach((z, i) => {
        expect(spawnContextOf(l, p, i) === HORDE_CONTEXT, `${id}#${i} horde tag`).toBe(z.horde !== undefined);
        if (z.horde !== undefined) expect(z.archetype ?? 'zombie', `${id}#${i} horde family`).toBe('zombie');
        if (z.archetype === 'siren') expect(eligibilityFailure(p.eligibility!.siren!, l, z, spawnContextOf(l, p, i)), `${id}#${i} siren`).toBeNull();
      });
      if (id === 'mall') {
        expect(l.zombies.some(z => z.horde !== undefined)).toBe(true);
        // (Track2 integration: + 'service' spawns when the level grew a service annex — appended last, tagged, ambient families)
        expect(new Set(l.zombies.flatMap((z, i) => (z.horde === undefined && spawnContextOf(l, p, i) !== 'service' ? [spawnContextOf(l, p, i)] : [])))).toEqual(new Set(['pit', 'ring']));
        expect(l.zombies.filter(z => z.archetype === 'siren').length).toBeLessThanOrEqual(MALL_SIREN_ELIGIBILITY.maxPerLevel!);
      }
    }
  });

  it('assignEnemyArchetypes is deterministic and idempotent on a generated level (Retry / revisit regenerate the same families)', () => {
    census();
    const l = offices[0], before = l.zombies.map(z => z.archetype);
    assignEnemyArchetypes(l, OFFICE);
    expect(l.zombies.map(z => z.archetype)).toEqual(before);
    const again = generateOfficeLevel({levelSeed: officeSeed(0), startWeapon: officeWeapon(0)});
    expect(again.zombies.map(z => z.archetype)).toEqual(before);
  });
});

describe('persistence: the new families die once per run (generic per-index run memory)', () => {
  it('killed Siren / Blightbelly indices are never spawned again; the regenerated layout names the same enemies', () => {
    census();
    const k = offices.findIndex(o => o.zombies.some(z => z.archetype === 'siren') && o.zombies.some(z => z.archetype === 'blightbelly'));
    expect(k).toBeGreaterThanOrEqual(0);
    const l = offices[k];
    const siren = l.zombies.findIndex(z => z.archetype === 'siren'), blight = l.zombies.findIndex(z => z.archetype === 'blightbelly');
    const mem = createMemory({level: 'office', section: 'main'});
    mem.killed = [siren, blight];
    const regen = generateOfficeLevel({levelSeed: officeSeed(k), startWeapon: officeWeapon(k)});
    const alive = enemiesToSpawn(regen.zombies.length, mem);
    expect(alive).not.toContain(siren);
    expect(alive).not.toContain(blight);
    expect(alive.length).toBe(regen.zombies.length - 2);
    expect([regen.zombies[siren].archetype, regen.zombies[blight].archetype]).toEqual(['siren', 'blightbelly']);
  });
});
