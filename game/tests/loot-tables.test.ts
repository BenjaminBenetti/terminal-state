// Task loot-tables-20261030 (lane LOOT): the loot-table foundation (items/lootTables.ts) — slot categories every holder kind plugs
// into, named tables consumed by real surfaces / containers, one baseline profile per logical level (identity resolution: the
// golden hashes in tests/loot-golden.test.ts prove byte-identical rolls), per-level overrides demonstrated by a TEST-ONLY
// reduced-food profile, validation, fit constraints and determinism. Bounded deterministic corpora only.

import {describe, expect, it} from 'vitest';
import {
  BASELINE_PROFILE, BASE_TABLES, CACHE_CRATE, ECON_CATS, HOLDER_SLOTS, LEGACY_POOL, OFFICE_DESK, OFFICE_ROWS, OPENABLE_TABLES, PROFILES,
  SLOT_CATEGORIES, STORE_DRINKS, TENANT_ARMS, TOILET_ROWS, catWeight, econCat, floorChance, floorCount, gearParams, keepChance, lootProfile,
  resolveRows, slotEmpty, slotLots, validateLootProfile, type EconCat, type LootProfile, type OwnTable,
} from '../src/items/lootTables';
import {
  CONTAINER_KINDS, SURFACE_KINDS, compartmentTable, holderTable, isLootHolderKind, rollHolderLots, rollLootItems, rollTableItems, type HolderKind,
} from '../src/items/loot';
import {LIMB_ECONOMY, GLOBAL_POOL} from '../src/items/lootEconomy';
import {containerLoot, separateCompartmentLoot} from '../src/world/openablesSpec';
import {ALL_PURPOSES} from '../src/gen/purposes';
import {PROP_DEFS} from '../src/gen/props';
import {holderSurfaces, placementBox, type Surface} from '../src/items/lootLayout';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {scarceOdds} from '../src/gen/office/spawns';
import {rollLevelGear} from '../src/gen/gearLoot';
import {LEVEL_IDS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {ECONOMY_CORPUS, layoutHolders} from './helpers/lootEconomy';

const HOLDER_KINDS: readonly HolderKind[] = [...CONTAINER_KINDS, ...SURFACE_KINDS];

/**
 * TEST-ONLY example of a future deeper-network level (NOT registered to any level): food is rarer (relative weight x0.4), what
 * food is rolled survives the scarcity cut half as often (keep x0.5) and no food lies on the floor. docs/loot-tables.md shows it.
 */
const REDUCED_FOOD: LootProfile = {
  id: 'reduced-food-example', label: 'Reduced food (test-only example)', tables: BASE_TABLES,
  overrides: {categoryWeight: {food: 0.4}, keep: {food: 0.5}, floor: {chance: {food: 0}}},
};
const withOverrides = (overrides: LootProfile['overrides'], tables = BASE_TABLES): LootProfile => ({id: 'test', label: 'test', tables, overrides});

const surf = (k: HolderKind): Surface[] => holderSurfaces(k, (PROP_DEFS as unknown as Record<string, {w: number; d: number; h: number}>)[k] ?? {w: 1, d: 0.6, h: 1});

describe('slots: every loot-holder kind plugs into a named slot category', () => {
  it('every holder kind is assigned a known slot; every slot category is used; no stale entries', () => {
    for (const k of HOLDER_KINDS) {
      expect(HOLDER_SLOTS[k], k).toBeDefined();
      expect(SLOT_CATEGORIES, k).toContain(HOLDER_SLOTS[k]);
      expect(holderTable(k, 'platform').slot, k).toBe(HOLDER_SLOTS[k]);
    }
    for (const k of Object.keys(HOLDER_SLOTS)) expect(isLootHolderKind(k), k).toBe(true);
    for (const c of SLOT_CATEGORIES) expect(Object.values(HOLDER_SLOTS), c).toContain(c);
  });

  it('every slot resolves: own-table kinds roll their table, the rest have per-kind defaults; fixtures roll nothing', () => {
    for (const k of HOLDER_KINDS) {
      const own = containerLoot(k);
      if (own === undefined) {
        expect(BASE_TABLES.holderEmpty[k], k).toBeGreaterThanOrEqual(0);
        expect(BASE_TABLES.holderLots[k], k).toHaveLength(2);
        expect(BASE_TABLES.holderMod[k], k).toHaveLength(4);
      }
      const t = holderTable(k, 'platform');
      if (own === null) {
        expect(HOLDER_SLOTS[k]).toBe('fixture');
        expect(t.source).toBe('fixture');
        expect(t.rows).toEqual([]);
        expect(Array.from({length: 40}, (_, i) => rollTableItems(5, i, k, 'platform')).flat()).toEqual([]);
      } else expect(t.rows.length, k).toBeGreaterThan(0);
    }
    // desk-style compartments (drawers / cupboards) are closed storage with their own named table
    for (const k of HOLDER_KINDS) if (separateCompartmentLoot(k)) expect(compartmentTable(k, 'platform')?.slot, k).toBe('container');
  });
});

describe('named tables feed real holders (a normal surface and container / furniture slots)', () => {
  it('surface: an office desk top rolls OFFICE_DESK; its drawers roll OFFICE_ROWS (slot container)', () => {
    const t = holderTable('desk', 'office-open', PROFILES.office);
    expect(t).toMatchObject({slot: 'surface', source: 'purpose', empty: OFFICE_DESK.empty, lots: OFFICE_DESK.lots});
    expect(t.rows).toBe(OFFICE_DESK.items);
    const drawers = compartmentTable('desk', 'platform', PROFILES.subway)!;
    expect(drawers).toMatchObject({slot: 'container', source: 'own', empty: OPENABLE_TABLES.desk.empty, lots: OPENABLE_TABLES.desk.lots});
    expect(drawers.rows).toBe(OFFICE_ROWS);
    const ids = new Set(OFFICE_DESK.items.map(r => r[0]));
    const rolled = Array.from({length: 300}, (_, i) => rollTableItems(77, i, 'desk', 'office-open', PROFILES.office)).flat();
    expect(rolled.length).toBeGreaterThan(0);
    for (const e of rolled) expect(ids.has(e.itemId), e.itemId).toBe(true);
  });

  it('containers / furniture: crate -> CACHE_CRATE, gun locker -> TENANT_ARMS, toilet stall -> TOILET_ROWS, cooler -> STORE_DRINKS', () => {
    const cases: [HolderKind, string, string, readonly unknown[]][] = [
      ['crate', 'storage', 'container', CACHE_CRATE.items],
      ['gunLocker', 'office-control', 'arms', TENANT_ARMS.items],
      ['toiletStall', 'washroom', 'stash', TOILET_ROWS],
      ['shopCooler', 'burger', 'cold', STORE_DRINKS.items],
    ];
    for (const [kind, area, slot, rows] of cases) {
      const t = holderTable(kind, area, lootProfile(area.startsWith('office') ? 'office' : 'subway'));
      expect(t.slot, kind).toBe(slot);
      expect(t.rows, kind).toBe(rows);
      const ids = new Set((rows as readonly (readonly [string, number])[]).map(r => r[0]));
      const rolled = Array.from({length: 200}, (_, i) => rollTableItems(91, i, kind, area)).flat();
      expect(rolled.length, kind).toBeGreaterThan(0);
      for (const e of rolled) expect(ids.has(e.itemId), `${kind}: ${e.itemId}`).toBe(true);
    }
    // the stall's own table: lots / empty from OPENABLE_TABLES (washroom `loot: {}` keeps it)
    expect(holderTable('toiletStall', 'washroom')).toMatchObject({empty: 0.2, lots: [1, 2]});
  });

  it('plain halls use the legacy room-type tables (a table on a platform: slot surface, legacy rows)', () => {
    const t = holderTable('table', 'platform');
    expect(t).toMatchObject({slot: 'surface', source: 'legacy', empty: 0.65, lots: [1, 2]});
    for (const [id] of t.rows) expect(econCat(id)).not.toBe('ammo'); // table modifier: no ammo
    expect(holderTable('shelf', 'food-court')).toMatchObject({source: 'legacy', lots: [2, 7]}); // fuller shelves in stocked rooms
  });
});

describe('profiles: one per logical level, today\'s tables, no overrides', () => {
  it('each logical level picks its own baseline profile', () => {
    for (const id of LEVEL_IDS) {
      const p = lootProfile(id);
      expect(p).toBe(PROFILES[id]);
      expect(p.id).toBe(id);
      expect(validateLootProfile(p)).toEqual([]);
      // Task track3-eaton-centre-20261031 (lane PROFILES): the mall = the base tables + its salvage, with its explicit overrides
      // (tests/mall-profiles.test.ts checks them); the Subway and the Office keep the shared tables and no overrides
      if (id === 'mall') {
        for (const [k, v] of Object.entries(BASE_TABLES)) expect((p.tables as unknown as Record<string, unknown>)[k], k).toBe(v);
        expect(p.tables.salvage).toBeDefined();
        continue;
      }
      // Task reactor-build-20261101: the Reactor = the mall's tables (its per-storey floor program serves the tiers) under explicit
      // category overrides (scarcer ammo / medicine / batteries / materials — tests/reactor-registration.test.ts)
      if (id === 'reactor') {
        expect(p.tables).toBe(PROFILES.mall.tables);
        expect(Object.keys(p.overrides)).toEqual(['categoryWeight']);
        continue;
      }
      expect(p.tables).toBe(BASE_TABLES);
      expect(Object.keys(p.overrides)).toEqual([]);
    }
    expect(validateLootProfile(BASELINE_PROFILE)).toEqual([]);
    expect(BASE_TABLES.limb).toBe(LIMB_ECONOMY); // the live object (tests zero it in place)
    expect(BASE_TABLES.globalPool).toBe(GLOBAL_POOL);
  });

  it('baseline resolution is the identity: same arrays, same numbers (byte-identical draws)', () => {
    for (const p of [PROFILES.subway, PROFILES.office, BASELINE_PROFILE]) {
      const tables: (readonly (readonly [string, number])[])[] = [
        ...Object.values(LEGACY_POOL), ...Object.values(GLOBAL_POOL), BASE_TABLES.vendingFood, LIMB_ECONOMY.pool,
        ...Object.values(OPENABLE_TABLES as Readonly<Record<string, OwnTable>>).map(t => t.items),
        ...ALL_PURPOSES.flatMap(P => Object.values(P.loot).map(s => s!.items)),
      ];
      for (const rows of tables) expect(resolveRows(p, rows)).toBe(rows);
      for (const c of ECON_CATS) {
        expect(catWeight(p, c, 0.37)).toBe(0.37);
        expect(keepChance(p, 0.21, c)).toBe(0.21);
        expect(floorChance(p, c, 0.35)).toBe(0.35);
        const n = [2, 3] as const;
        expect(floorCount(p, c, n)).toBe(n);
      }
      for (const s of SLOT_CATEGORIES) {
        const lots = [1, 3] as const;
        expect(slotEmpty(p, s, 0.45)).toBe(0.45);
        expect(slotLots(p, s, lots)).toBe(lots);
      }
      expect(gearParams(p)).toBe(BASE_TABLES.gear);
    }
  });

  it('level profiles roll exactly what the level-agnostic defaults roll (holders, gear)', () => {
    const kinds: HolderKind[] = ['desk', 'crate', 'toiletStall', 'shelf', 'vending', 'gunLocker', 'kitchenette', 'bin'];
    for (const k of kinds) for (let i = 0; i < 25; i++) {
      for (const area of ['storage', 'office-open', 'platform', 'washroom']) {
        const base = rollHolderLots(1234, i, k, area, surf(k));
        expect(rollHolderLots(1234, i, k, area, surf(k), PROFILES.subway)).toEqual(base);
        expect(rollHolderLots(1234, i, k, area, surf(k), PROFILES.office)).toEqual(base);
      }
    }
    for (let s = 0; s < 50; s++) for (const id of LEVEL_IDS) expect(rollLevelGear(s, id, ['main'], PROFILES[id])).toEqual(rollLevelGear(s, id, ['main']));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Overrides

type Units = Record<EconCat, number>;
const zero = (): Units => ({food: 0, drink: 0, med: 0, ammo: 0, battery: 0, flare: 0, material: 0}); // + material: lane RACK (office-props-physics-scale-20261030)
function holderUnits(layouts: readonly StationLayout[], profile?: LootProfile): Units {
  const u = zero();
  for (const l of layouts) for (const h of layoutHolders(l, profile)) for (const lot of h.lots) { const c = econCat(lot.itemId); if (c) u[c] += lot.count; }
  return u;
}
const ratio = (a: number, b: number) => a / Math.max(1, b);

describe('per-level overrides (TEST-ONLY reduced-food example)', () => {
  // Bounded corpus: the first station of each of the 6 Subway families + two office levels.
  const subway = [0, 3, 6, 9, 12, 15].map(i => generateStation(ECONOMY_CORPUS[i].seed, {startWeapon: 'pistol'}));
  const officeSeeds = [11, 222];
  const office = officeSeeds.map(levelSeed => generateOfficeLevel({levelSeed, startWeapon: 'pistol'}));

  it('is a valid profile', () => {
    expect(validateLootProfile(REDUCED_FOOD)).toEqual([]);
  });

  it('holder food falls sharply; ammo / med / light stay within tolerance; the baseline is untouched', () => {
    const corpus = [...subway, ...office];
    const base = holderUnits(corpus), base2 = holderUnits(corpus, PROFILES.subway), less = holderUnits(corpus, REDUCED_FOOD);
    process.stdout.write(`[loot-tables] holder units baseline ${JSON.stringify(base)} · reduced-food ${JSON.stringify(less)}\n`);
    expect(base2).toEqual(base);
    expect(base.food).toBeGreaterThan(40);
    expect(ratio(less.food, base.food)).toBeLessThan(0.5);
    // ammo is never thinned (exact roll); relative food weight moves a little share to the other rows of mixed tables
    expect(ratio(less.ammo, base.ammo)).toBeGreaterThan(0.85); expect(ratio(less.ammo, base.ammo)).toBeLessThan(1.35);
    expect(ratio(less.med, base.med)).toBeGreaterThan(0.75); expect(ratio(less.med, base.med)).toBeLessThan(1.5);
    expect(ratio(less.battery + less.flare, base.battery + base.flare)).toBeGreaterThan(0.75);
    expect(ratio(less.battery + less.flare, base.battery + base.flare)).toBeLessThan(1.5);
    // drink gains a little of food's share where both share a table (relative weights); `keep` alone would not redistribute
    expect(ratio(less.drink, base.drink)).toBeGreaterThan(0.9); expect(ratio(less.drink, base.drink)).toBeLessThan(1.4);
  });

  it('floor food off: no loose food on office floors; the Subway floor program (no food) is unchanged', () => {
    const food = (l: StationLayout) => l.pickups.filter(p => econCat(p.itemId) === 'food').length;
    const reduced = officeSeeds.map(levelSeed => generateOfficeLevel({levelSeed, startWeapon: 'pistol'}, REDUCED_FOOD));
    const count = (ls: StationLayout[], c: EconCat) => ls.reduce((n, l) => n + l.pickups.filter(p => econCat(p.itemId) === c).length, 0);
    process.stdout.write(`[loot-tables] office floor food baseline ${office.map(food).join('+')} · reduced-food ${reduced.map(food).join('+')}\n`);
    // a food company's floor rolls food at its tilted odds; the profile resolves those odds to 0 (no draw at all)
    expect(scarceOdds('food')[3]).toBeGreaterThan(0);
    expect(floorChance(REDUCED_FOOD, 'food', scarceOdds('food')[3])).toBe(0);
    expect(floorChance(REDUCED_FOOD, 'med', scarceOdds('food')[0])).toBe(scarceOdds('food')[0]);
    expect(office.reduce((n, l) => n + food(l), 0)).toBeGreaterThan(0);
    expect(reduced.reduce((n, l) => n + food(l), 0)).toBe(0);
    for (const c of ['ammo', 'med', 'battery', 'flare'] as EconCat[]) expect(count(reduced, c), c).toBe(count(office, c));
    const s = generateStation(ECONOMY_CORPUS[0].seed, {startWeapon: 'pistol', loot: REDUCED_FOOD});
    expect(s.pickups).toEqual(subway[0].pickups);
  });

  it('each knob acts where it should: slot lots 0 empties a slot, keep + category 0 remove a category, item weight 0 empties a table', () => {
    const area = (k: HolderKind) => (k === 'bin' || k === 'wheelieBin' ? 'platform' : 'washroom');
    const all = (P: LootProfile, k: HolderKind, n = 200) => Array.from({length: n}, (_, i) => rollLootItems(4242, i, k, area(k), P)).flat();
    expect(all(BASELINE_PROFILE, 'bin').length).toBeGreaterThan(0);
    expect(all(withOverrides({slot: {junk: {lots: 0}}}), 'bin')).toEqual([]);
    expect(all(withOverrides({slot: {junk: {lots: 0}}}), 'toiletStall').length).toBeGreaterThan(0); // other slots untouched
    expect(all(withOverrides({slot: {stash: {empty: 5}}}), 'toiletStall')).toEqual([]); // empty chance capped at 1
    // availability: keep 0 -> no ROLLED med entry survives the scarcity cut, yet re-picks of other entries may still become med;
    // + category weight 0 -> no row / re-pick chooses med either: the category is gone (ammo would still be kept exactly as rolled)
    const med = (P: LootProfile) => all(P, 'toiletStall', 400).filter(e => econCat(e.itemId) === 'med').length;
    expect(med(BASELINE_PROFILE)).toBeGreaterThan(0);
    expect(med(withOverrides({keep: {med: 0}}))).toBeLessThan(med(BASELINE_PROFILE));
    expect(med(withOverrides({keep: {med: 0}, categoryWeight: {med: 0}}))).toBe(0);
    // relative weight 0 for every row of a table -> the table is empty -> no loot (intentional, nothing drawn)
    const zeroToilet = withOverrides({itemWeight: Object.fromEntries(TOILET_ROWS.map(r => [r[0], 0]))});
    expect(holderTable('toiletStall', 'washroom', zeroToilet).rows).toEqual([]);
    expect(Array.from({length: 100}, (_, i) => rollTableItems(3, i, 'toiletStall', 'washroom', zeroToilet)).flat()).toEqual([]);
    // gear: mean 0 -> no gear; the roll key / count is still per logical level
    for (let s = 0; s < 40; s++) expect(rollLevelGear(s, 'office', ['main'], withOverrides({gear: {mean: 0}})).main).toEqual([]);
  });

  it('floor counts: Subway floor ammo boxes x0 leave only the weapon finds\' paired ammo (explicit exception)', () => {
    const l = generateStation(ECONOMY_CORPUS[3].seed, {startWeapon: 'pistol', loot: withOverrides({floor: {count: {ammo: 0}}})});
    const boxes = (q: StationLayout) => q.pickups.filter(p => (p.itemId === 'ammo_556' && p.count === 30) || (p.itemId === 'ammo_12ga' && p.count === 8));
    expect(boxes(subway[1]).length).toBeGreaterThan(0);
    expect(boxes(l)).toEqual([]);
    expect(l.pickups.some(p => p.itemId.startsWith('ammo_'))).toBe(true); // weapon-find ammo + pistol-start 9 mm stay
  });

  it('deterministic: same seed + profile -> same rolls and layouts', () => {
    const a = holderUnits(office, REDUCED_FOOD), b = holderUnits(office, REDUCED_FOOD);
    expect(a).toEqual(b);
    const x = generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'}, REDUCED_FOOD), y = generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'}, REDUCED_FOOD);
    expect(x.pickups).toEqual(y.pickups);
    for (let i = 0; i < 30; i++) expect(rollHolderLots(9, i, 'shelf', 'stock-room', surf('shelf'), REDUCED_FOOD)).toEqual(rollHolderLots(9, i, 'shelf', 'stock-room', surf('shelf'), REDUCED_FOOD));
  });
});

describe('fit constraints still apply under any profile', () => {
  const MORE = withOverrides({slot: {container: {lots: 3}, shelf: {lots: 3}}, keep: {food: 3, drink: 3, med: 3}});

  it('items that fit no surface are dropped (rolled, never placed)', () => {
    const tiny: Surface[] = [{y: 0.5, x0: -0.05, x1: 0.05, z0: -0.05, z1: 0.05, clear: 0.02}];
    let rolled = 0;
    for (const P of [BASELINE_PROFILE, MORE]) for (let i = 0; i < 150; i++) {
      rolled += rollLootItems(31337, i, 'cabinetTall', 'storage', P).length;
      expect(rollHolderLots(31337, i, 'cabinetTall', 'storage', tiny, P)).toEqual([]);
    }
    expect(rolled).toBeGreaterThan(0);
  });

  it('placed lots stay on their surface, within its clearance, without overlaps (more lots via overrides)', () => {
    for (const kind of ['cabinetTall', 'crate', 'shelf', 'stockShelf', 'desk'] as HolderKind[]) {
      const S = surf(kind);
      let placed = 0;
      for (let i = 0; i < 80; i++) {
        const lots = rollHolderLots(2024, i, kind, 'storage', S, MORE);
        placed += lots.length;
        for (const l of lots) {
          const s = S[l.surface], b = placementBox(l.itemId, l);
          expect(b.min[0]).toBeGreaterThanOrEqual(s.x0 - 1e-6); expect(b.max[0]).toBeLessThanOrEqual(s.x1 + 1e-6);
          expect(b.min[2]).toBeGreaterThanOrEqual(s.z0 - 1e-6); expect(b.max[2]).toBeLessThanOrEqual(s.z1 + 1e-6);
          expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(s.clear);
        }
        for (const a of lots) for (const c of lots) {
          if (a === c || a.surface !== c.surface) continue;
          const A = placementBox(a.itemId, a), C = placementBox(c.itemId, c);
          expect(A.max[0] <= C.min[0] + 1e-6 || C.max[0] <= A.min[0] + 1e-6, `${kind} overlap`).toBe(true);
        }
      }
      expect(placed, kind).toBeGreaterThan(0);
    }
  });

  it('eligibility holds under overrides: no snacks in toilets, coolers only drinks', () => {
    const P = withOverrides({categoryWeight: {food: 5}, keep: {food: 3}});
    const toilet = Array.from({length: 400}, (_, i) => rollLootItems(8, i, 'toiletStall', 'office-break', P)).flat();
    expect(toilet.some(e => econCat(e.itemId) === 'food')).toBe(false);
    const cooler = Array.from({length: 300}, (_, i) => rollLootItems(8, i, 'shopCooler', 'convenience', P)).flat();
    for (const e of cooler) expect(econCat(e.itemId)).toBe('drink');
  });
});

describe('validation', () => {
  const issues = (p: LootProfile) => validateLootProfile(p).join('\n');

  it('rejects unknown ids, non-finite / negative weights and multipliers, lo > hi, chances outside [0, 1]', () => {
    expect(issues(withOverrides({itemWeight: {unobtainium: 2}}))).toMatch(/unknown item id/);
    expect(issues(withOverrides({categoryWeight: {gold: 2} as never}))).toMatch(/unknown economy category/);
    expect(issues(withOverrides({slot: {attic: {empty: 1}} as never}))).toMatch(/unknown slot category/);
    expect(issues(withOverrides({slot: {shelf: {lots: 1, rows: 2} as never}}))).toMatch(/unknown knob/);
    expect(issues(withOverrides({gear: {weight: {jetpack: 1}}}))).toMatch(/unknown gear id/);
    expect(issues(withOverrides({categoryWeight: {food: NaN}}))).toMatch(/not a finite number >= 0/);
    expect(issues(withOverrides({keep: {med: Infinity}}))).toMatch(/not a finite number >= 0/);
    expect(issues(withOverrides({itemWeight: {water: -1}}))).toMatch(/not a finite number >= 0/);
    expect(issues(withOverrides({slot: {surface: {empty: -0.5}}}))).toMatch(/not a finite number >= 0/);
    expect(issues(withOverrides({floor: {count: {ammo: Number.POSITIVE_INFINITY}}}))).toMatch(/not a finite number >= 0/);
    expect(issues(withOverrides({gear: {cap: 2.5}}))).toMatch(/not an integer >= 0/);
    const T = BASE_TABLES;
    expect(issues(withOverrides({}, {...T, holderLots: {...T.holderLots, shelf: [5, 2]}}))).toMatch(/holderLots\.shelf: range/);
    expect(issues(withOverrides({}, {...T, floor: {...T.floor, subway: {...T.floor.subway, boxes: [{itemId: 'ammo_556', count: 30, n: [4, 3]}]}}}))).toMatch(/boxes\[0\]\.n: range/);
    expect(issues(withOverrides({}, {...T, holderEmpty: {...T.holderEmpty, desk: 1.2}}))).toMatch(/holderEmpty\.desk: chance/);
    expect(issues(withOverrides({}, {...T, floor: {...T.floor, subway: {...T.floor.subway, light: [{itemId: 'flare', count: 1, chance: -0.1}]}}}))).toMatch(/chance -0\.1 is outside/);
    expect(issues(withOverrides({}, {...T, pool: {...T.pool, drink: [['water', NaN]]}}))).toMatch(/pool\.drink\[0\]: weight NaN/);
    expect(issues(withOverrides({}, {...T, vendingFood: [['caviar', 1]]}))).toMatch(/unknown item id caviar/);
    expect(issues(withOverrides({}, {...T, themes: {...T.themes, food: {...T.themes.food, keep: 1.5}}}))).toMatch(/themes\.food\.keep: chance/);
  });

  it('accepts an intentional empty table (= no loot) and zero weights', () => {
    const T = BASE_TABLES;
    expect(validateLootProfile(withOverrides({}, {...T, vendingFood: [], pool: {...T.pool, ammo: []}}))).toEqual([]);
    expect(validateLootProfile(withOverrides({itemWeight: {chocolate: 0}, categoryWeight: {food: 0}, slot: {junk: {lots: 0}}}))).toEqual([]);
    expect(validateLootProfile(REDUCED_FOOD)).toEqual([]);
  });
});
