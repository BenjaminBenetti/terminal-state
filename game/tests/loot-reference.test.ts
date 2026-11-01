// Task loot-reference-pages-20261030 (lane DATA): the source-generated loot reference (tools/pages/lootReference.ts, contract
// tools/pages/lootReferenceTypes.ts, guide docs/loot-reference.md).
//  - COVERAGE: every registered level, all 12 slot categories, every loot-holder kind, every purpose with loot, every
//    OPENABLE_TABLES key, every named lootTables table, every reward key, the floor programs and every special-source family are in
//    the reference; an UNKNOWN registration (a new lootTables export, holder kind, level, reward, tilt, census pickup ...) fails here
//    until the reference documents it. The test-only reducedFood example is never a level.
//  - DETERMINISM: two builds are deep-equal (and hash-equal).
//  - RUNTIME AGREEMENT: shown values === the exported game values; the analytical expectations (before fit) agree with the REAL roll
//    functions (rollLootItems / rollTableItems / holderFinds, rollLevelGear, rollMaskLoot, officeWeaponPlan) in a bounded empirical
//    check.
//  - PROBABILITY MATHS: empty / multi-stage / zero-weight / empty-table / single-row cases; every number finite.
// Bounded: one full build (~4 s: a small fixed-seed census, cached per process) + cheap rebuilds; ~3k rolls per checked context.

import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import * as LT from '../src/items/lootTables';
import {
  ANNEX_FLOOR, BASE_TABLES, HOLDER_SLOTS, OFFICE_FLOOR, OPENABLE_TABLES, PROFILES, REWARD_FINDS, REWARD_TABLES, SLOT_CATEGORIES, SUBWAY_FLOOR, THEME_ECONOMY,
  OFF_THEME_WEIGHTS, BOX_COUNT, gearParams, lootProfile, type LootProfile, type LootSpec, type OwnTable,
} from '../src/items/lootTables';
import {ITEMS} from '../src/items/items';
import {
  CONTAINER_KINDS, SURFACE_KINDS, compartmentTable, holderFinds, holderTable, isLootHolderKind, rollLootItems, rollTableItems,
  type HolderKind, type LootEntry,
} from '../src/items/loot';
import {ALL_PURPOSES} from '../src/gen/purposes';
import {OPENABLE_SPECS, containerLoot} from '../src/world/openablesSpec';
import {LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {rollLevelGear} from '../src/gen/gearLoot';
import {MASK_LOOT, rollMaskLoot} from '../src/gen/maskLoot';
import {FIND_COPY_THRESHOLDS, FIND_MAX_PER_WEAPON, PISTOL_START_BOXES, WEAPON_FIND_AMMO, findWeaponsFor} from '../src/gen/weaponFinds';
import {officeWeaponPlan, scarceOdds} from '../src/gen/office/spawns';
import {COMPANIES} from '../src/gen/office/companies';
import {OFFICE_ROOF_LEVEL} from '../src/gen/office/frame';
import {startWeaponFor} from '../src/weapons/pistol';
import {
  CENSUS_SEEDS, LEVEL_ADAPTER, LOOT_TABLES_EXPORT_ROLES, buildLootReference, censusLayout, censusSeedsFor,
} from '../../tools/pages/lootReference';
import {
  atLeastOne, cappedPoisson, denominator, expectation, halvingPicks, meanInt, noneOfN, pickProbs, rd, shares, thresholdBands, uniformInt,
} from '../../tools/pages/probability';
import type {HolderContext, LootReference} from '../../tools/pages/lootReferenceTypes';

const readSource = (f: string): string | null => {
  try { return readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'); } catch { return null; }
};
let cached: LootReference | null = null;
const ref = (): LootReference => (cached ??= buildLootReference({readSource, commit: 'test'}));
const level = (id: string) => ref().levels.find(l => l.id === id)!;
const rows = (id: string) => ref().tables[id].rows.map(r => [r.itemId, r.weight] as const);
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// The analytical expectations (exact under ideal uniform draws, before fit) against the REAL roll functions.
const N = 3000;
function empirical(roll: (seed: number, index: number) => readonly LootEntry[]) {
  const units = new Map<string, number[]>(), any = new Map<string, number>();
  let nonEmpty = 0;
  for (let s = 1; s <= N; s++) {
    const out = roll(s * 7919 + 13, s % 11);
    if (out.length) nonEmpty++;
    const per = new Map<string, number>();
    for (const e of out) per.set(e.itemId, (per.get(e.itemId) ?? 0) + e.count);
    for (const [id, n] of per) {
      let a = units.get(id);
      if (!a) units.set(id, (a = []));
      a.push(n);
      any.set(id, (any.get(id) ?? 0) + 1);
    }
  }
  return {units, any, nonEmpty};
}
function agree(h: HolderContext, emp: ReturnType<typeof empirical>, field: 'units' | 'rawUnits' = 'units') {
  const ids = new Set([...emp.units.keys(), ...h.expected!.items.map(i => i.itemId)]);
  for (const id of ids) {
    const xs = emp.units.get(id) ?? [];
    const sum = xs.reduce((s, x) => s + x, 0), sq = xs.reduce((s, x) => s + x * x, 0);
    const mean = sum / N, sd = Math.sqrt(Math.max(0, sq / N - mean * mean));
    const exp = h.expected!.items.find(i => i.itemId === id)?.[field] ?? 0;
    expect(Math.abs(mean - exp), `${h.id} ${field} ${id}: empirical ${mean} vs analytical ${exp}`).toBeLessThanOrEqual(5 * sd / Math.sqrt(N) + 0.004);
    if (field === 'units') {
      const p = h.expected!.items.find(i => i.itemId === id)?.pAtLeastOne ?? 0, f = (emp.any.get(id) ?? 0) / N;
      expect(Math.abs(f - p), `${h.id} P(>=1 ${id}): empirical ${f} vs ${p}`).toBeLessThanOrEqual(5 * Math.sqrt(p * (1 - p) / N) + 0.004);
    }
  }
  if (field === 'units') {
    const f = emp.nonEmpty / N, p = h.expected!.pAny;
    expect(Math.abs(f - p), `${h.id} P(any): empirical ${f} vs ${p}`).toBeLessThanOrEqual(5 * Math.sqrt(p * (1 - p) / N) + 0.004);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
describe('loot reference: coverage (unknown registrations fail)', () => {
  it('lists exactly the registered logical levels with their real profiles (never the test-only reducedFood example)', () => {
    const r = ref();
    expect(r.levels.map(l => l.id)).toEqual([...LEVEL_IDS]);
    expect(Object.keys(PROFILES).sort()).toEqual([...LEVEL_IDS].sort());
    expect(Object.keys(LEVEL_ADAPTER).sort()).toEqual([...LEVEL_IDS].sort());
    for (const l of r.levels) {
      const P = lootProfile(l.id as LevelId);
      expect(l.profile.id).toBe(P.id);
      expect(l.profile.label).toBe(P.label);
      expect(l.profile.baseTables).toBe(P.tables === BASE_TABLES);
      expect(l.profile.validation).toEqual([]);
      // the Subway / Office: no overrides (the user likes the current rates); task track3-eaton-centre-20261031 (lane PROFILES): the
      // mall's explicit overrides (bio mater item weight) are listed exactly as the profile declares them
      const listed = (knob: 'itemWeight' | 'categoryWeight') => Object.entries(P.overrides[knob] ?? {}).map(([key, multiplier]) => ({knob, key, multiplier}));
      expect(l.profile.overrides).toEqual(l.id === 'mall' || l.id === 'reactor' ? [...listed('itemWeight'), ...listed('categoryWeight')] : []);
      if (l.id === 'mall') expect(Object.keys(P.overrides).sort()).toEqual(['categoryWeight', 'itemWeight']);
      if (l.id === 'reactor') expect(Object.keys(P.overrides)).toEqual(['categoryWeight']); // task reactor-build-20261101: the culminating level's pressure
    }
    const text = JSON.stringify(r.levels.map(l => [l.id, l.label, l.profile.id]));
    expect(text).not.toMatch(/reduced|deep|baseline/i);
  });

  it('has all 12 slot categories, globally and per level', () => {
    const r = ref();
    expect(r.slots.map(s => s.id)).toEqual([...SLOT_CATEGORIES]);
    for (const l of r.levels) expect(l.slots.map(s => s.slot)).toEqual([...SLOT_CATEGORIES]);
    for (const s of r.slots) for (const k of s.holderKinds) expect(HOLDER_SLOTS[k]).toBe(s.id);
  });

  it('classifies every loot-holder kind, and every HOLDER_SLOTS kind is a real holder kind', () => {
    const r = ref();
    const kinds = new Set<string>([...CONTAINER_KINDS, ...SURFACE_KINDS]);
    for (const k of kinds) {
      expect(r.holderKinds[k], k).toBeDefined();
      expect(r.holderKinds[k].slot).toBe(HOLDER_SLOTS[k]);
    }
    for (const k of Object.keys(HOLDER_SLOTS)) expect(isLootHolderKind(k), `HOLDER_SLOTS.${k} is not a loot holder kind`).toBe(true);
    expect(Object.keys(r.holderKinds).sort()).toEqual([...kinds].sort());
    for (const k of kinds) if (containerLoot(k) === null) expect(r.holderKinds[k].class).toBe('non-loot');
  });

  it('covers every lootTables export: tables by name (same rows), everything else classified', () => {
    const r = ref();
    const ns = LT as unknown as Record<string, unknown>;
    const isRows = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'number');
    const isSpec = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && isRows((v as {items?: unknown}).items);
    const unknown: string[] = [];
    for (const [name, v] of Object.entries(ns)) {
      if (isRows(v) || isSpec(v)) {
        expect(r.tables[name], `named table ${name}`).toBeDefined();
        const src = isRows(v) ? v as readonly (readonly [string, number])[] : (v as LootSpec).items;
        expect(rows(name)).toEqual(src.map(x => [x[0], x[1]]));
        if (isSpec(v)) { expect(r.tables[name].lots).toEqual((v as LootSpec).lots); expect(r.tables[name].empty).toBe((v as LootSpec).empty); }
      } else if (!(name in LOOT_TABLES_EXPORT_ROLES)) unknown.push(name);
    }
    expect(unknown, 'new lootTables exports: classify them in tools/pages/lootReference.ts LOOT_TABLES_EXPORT_ROLES and surface them').toEqual([]);
    for (const name of Object.keys(LOOT_TABLES_EXPORT_ROLES)) expect(name in ns, `stale LOOT_TABLES_EXPORT_ROLES entry ${name}`).toBe(true);
  });

  it('has every OPENABLE_TABLES key with its exact rows / lots / empty', () => {
    for (const [k, t] of Object.entries(OPENABLE_TABLES as Readonly<Record<string, OwnTable>>)) {
      const info = ref().tables[`OPENABLE_TABLES.${k}`];
      expect(info, k).toBeDefined();
      expect(rows(info.id)).toEqual(t.items.map(x => [x[0], x[1]]));
      expect(info.lots).toEqual(t.lots);
      expect(info.empty).toBe(t.empty);
    }
  });

  it('has every purpose, and every purpose loot entry points at a table with its exact rows', () => {
    const r = ref();
    for (const p of ALL_PURPOSES) {
      const info = r.purposes[p.id];
      expect(info, p.id).toBeDefined();
      const entries = Object.entries(p.loot as Readonly<Record<string, LootSpec | undefined>>).filter(([, s]) => s);
      expect(info.loot.map(e => e.holder)).toEqual(entries.map(([h]) => h));
      entries.forEach(([, spec], i) => expect(rows(info.loot[i].tableId)).toEqual(spec!.items.map(x => [x[0], x[1]])));
    }
  });

  it('has every reward key as a special source placed by a level generator, with its exact picks', () => {
    const r = ref();
    const keys = new Set([...Object.keys(REWARD_TABLES), ...LEVEL_IDS.flatMap(l => Object.keys(lootProfile(l).tables.rewards ?? {}))]);
    for (const key of keys) {
      const s = r.specials.find(x => x.id === `reward:${key}`);
      expect(s, key).toBeDefined();
      expect(s!.levels.length, `reward ${key} is not placed by any level (tools/pages/lootReference.ts LEVEL_ADAPTER.rewards)`).toBeGreaterThan(0);
      REWARD_TABLES[key]?.picks.forEach((p, i) => expect(rows(`ROOF_CACHE.picks[${i}]`)).toEqual(p.items.map(x => [x[0], x[1]])));
    }
    const roof = level('office').holders.find(h => h.source === 'reward')!;
    expect(roof.class).toBe('guaranteed');
    expect(roof.occurrence.levelsObserved).toBe(roof.occurrence.samples); // the roof cache is in every sample Office level
  });

  it('has every find reward key (task gas-mask-roof-feedback-20261030: the roof find) as a guaranteed special source with its exact rows + paired ammo', () => {
    const r = ref();
    const keys = new Set([...Object.keys(REWARD_FINDS), ...LEVEL_IDS.flatMap(l => Object.keys(lootProfile(l).tables.rewardFinds ?? {}))]);
    expect(keys.size).toBeGreaterThan(0);
    const start = startWeaponFor(false);
    for (const key of keys) {
      const s = r.specials.find(x => x.id === `reward-find:${key}`);
      expect(s, key).toBeDefined();
      expect(s!.levels.length, `find ${key} is not laid out by any level (tools/pages/lootReference.ts LEVEL_ADAPTER.rewardFinds)`).toBeGreaterThan(0);
      expect(s!.class).toBe('guaranteed');
      const rf = REWARD_FINDS[key];
      const rowsShown = s!.items.filter(i => i.weight !== undefined).map(i => [i.itemId, i.weight]);
      expect(rowsShown).toEqual(rf.items.filter(x => x[0] !== start && x[1] > 0).map(x => [x[0], x[1]]));
      expect(s!.items.filter(i => i.share !== undefined).reduce((t, i) => t + i.share!, 0)).toBeCloseTo(1, 3);
      for (const [id] of rf.items) if (rf.pairedAmmo && WEAPON_FIND_AMMO[id] && id !== start) expect(s!.items).toContainEqual(expect.objectContaining({itemId: WEAPON_FIND_AMMO[id][0], count: WEAPON_FIND_AMMO[id][1]}));
      expect(rows(key === LT.ROOF_FIND_KEY ? 'ROOF_FIND' : `REWARD_FINDS.${key}`)).toEqual(rf.items.map(x => [x[0], x[1]]));
    }
    // the census: every sample Office level lays out the roof find on the roof
    for (const seed of censusSeedsFor('office')) {
      const c = censusLayout('office', seed);
      expect(c.pickups.filter(p => p.level === OFFICE_ROOF_LEVEL).length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
    expect(level('office').specials).toContain(`reward-find:${LT.ROOF_FIND_KEY}`);
    expect(level('subway').specials).not.toContain(`reward-find:${LT.ROOF_FIND_KEY}`);
  });

  it('has the floor programs of every level, every Office company tilt and every special-source family', () => {
    const r = ref();
    for (const l of r.levels) expect(l.floor.id).toBe(LEVEL_ADAPTER[l.id as LevelId].floor);
    const sub = level('subway').floor.variants[0].finds;
    expect(sub.filter(f => f.stage === 'boxes').map(f => [f.itemId, f.count, f.copies])).toEqual(SUBWAY_FLOOR.boxes.map(b => [b.itemId, b.count, b.n]));
    expect(sub.filter(f => f.stage === 'kept').map(f => [f.itemId, f.copies, f.chance])).toEqual(SUBWAY_FLOOR.kept.map(k => [k.itemId, k.n, k.keep]));
    expect(sub.filter(f => f.stage === 'light').map(f => [f.itemId, f.chance])).toEqual(SUBWAY_FLOOR.light.map(c => [c.itemId, c.chance]));
    const off = level('office').floor;
    expect(off.variants.map(v => v.id)).toEqual(['street', ...Object.keys(OFFICE_FLOOR.tilt).map(t => `tower:${t}`), 'annex']);
    for (const c of Object.values(COMPANIES)) expect(Object.keys(OFFICE_FLOOR.tilt), `company tilt ${c.loot}`).toContain(c.loot);
    // Track 2 (lane CONTENT): every annex-bearing level shows the per-annex program (items/lootTables.ts ANNEX_FLOOR) as its 'annex'
    // variant, outside the exact per-level totals
    for (const id of LEVEL_IDS) {
      const a = level(id).floor.variants.find(v => v.id === 'annex');
      expect(!!a, `${id} annex variant`).toBe(LEVEL_ADAPTER[id].annex);
      if (!a) continue;
      expect(a.finds.filter(f => f.stage === 'boxes').map(f => [f.itemId, f.count, f.copies])).toEqual(ANNEX_FLOOR.boxes.map(b => [b.itemId, b.count, b.n]));
      expect(a.finds.filter(f => f.stage === 'kept').map(f => [f.itemId, f.copies, f.chance])).toEqual(ANNEX_FLOOR.kept.map(k => [k.itemId, k.n, k.keep]));
      expect(a.finds.filter(f => f.stage === 'light').map(f => [f.itemId, f.chance])).toEqual(ANNEX_FLOOR.light.map(c => [c.itemId, c.chance]));
    }
    for (const v of off.variants.filter(q => q.id.startsWith('tower:'))) {
      const t = v.tilt!.id as keyof typeof OFFICE_FLOOR.tilt;
      expect(v.tilt!.odds).toEqual(scarceOdds(t).map(rd));
      const boxes = v.finds.filter(f => f.stage === 'tower.box');
      const th = t === 'ammo' ? OFFICE_FLOOR.tower.ammoThresholds : OFFICE_FLOOR.tower.thresholds;
      expect(boxes.map(b => b.chance)).toEqual(thresholdBands(th).probs);
    }
    const families = new Set(r.specials.map(s => s.family));
    for (const f of ['gear', 'mask', 'weapon', 'starter', 'reward', 'objective', 'fixture', 'interaction', 'decoration', 'floor-moved']) expect(families, f).toContain(f);
    for (const k of Object.keys(OPENABLE_SPECS)) if (containerLoot(k) === null) expect(r.specials.map(s => s.id)).toContain(`fixture:${k}`);
    for (const l of Object.keys(MASK_LOOT.levels)) expect(LEVEL_IDS as readonly string[]).toContain(l);
    for (const w of findWeaponsFor(startWeaponFor(false))) expect(WEAPON_FIND_AMMO[w], w).toBeDefined();
  });

  it('explains every census holder and every generated pickup of every level (a new source fails until documented)', () => {
    const r = ref();
    for (const l of r.levels) {
      const ids = new Set(l.holders.map(h => h.id));
      const sources = new Set<string>();
      for (const f of l.floor.variants.flatMap(v => v.finds)) sources.add(`${f.itemId}x${f.count}`);
      for (const s of r.specials.filter(x => l.specials.includes(x.id))) {
        for (const it of s.items) if (typeof it.count === 'number') sources.add(`${it.itemId}x${it.count}`);
      }
      const seeds = r.meta.census.find(c => c.level === l.id)!.seeds;
      expect(seeds).toEqual(censusSeedsFor(l.id as LevelId));
      for (const seed of seeds) {
        const c = censusLayout(l.id as LevelId, seed);
        for (const h of c.holders) expect(ids.has(`${l.id}/${h.kind}@${h.areaKey}`), `${l.id} seed ${seed}: holder ${h.kind}@${h.areaKey}`).toBe(true);
        for (const p of c.pickups) expect(sources.has(`${p.itemId}x${p.count}`), `${l.id} seed ${seed}: pickup ${p.itemId} x${p.count} has no documented source`).toBe(true);
      }
    }
    // the pistol start's 9mm boxes are a Subway-only source
    expect(r.specials.find(s => s.id === 'pistol-start-boxes')!.levels).toEqual(LEVEL_IDS.filter(l => LEVEL_ADAPTER[l].pistolBoxes));
  });

  it('keeps Office storeys and companies as contexts of the ONE Office level (never separate levels or gear rolls)', () => {
    const r = ref();
    const o = level('office');
    expect(o.contexts.storeys!.length).toBeGreaterThan(2);
    expect(o.contexts.companies!.length).toBe(Object.keys(COMPANIES).length);
    expect(r.levels.filter(l => /floor|storey|lobby/i.test(l.id))).toEqual([]);
    expect(r.specials.filter(s => s.family === 'gear').every(s => s.levels.includes('office'))).toBe(true);
    // the census samples every tenant company (so company-specific storage is observed)
    const seen = new Set(r.levels.find(l => l.id === 'office')!.holders.flatMap(h => h.occurrence.companies ?? []));
    expect([...seen].sort()).toEqual(Object.keys(COMPANIES).sort());
  });

  it('ships the maintenance guide', () => {
    expect(existsSync(new URL('../../docs/loot-reference.md', import.meta.url))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('loot reference: determinism and plain, finite data', () => {
  it('two builds are deep-equal (and hash-equal)', () => {
    const a = ref();
    const b = buildLootReference({readSource, commit: 'test'});
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.meta.dataHash).toBe(a.meta.dataHash);
    const c = buildLootReference({commit: 'other', buildId: 'run-1', readSource});
    expect(c.meta.commit).toBe('other');
    expect(c.meta.buildId).toBe('run-1');
    expect(c.meta.dataHash).toBe(a.meta.dataHash);
  });

  it('is plain JSON with only finite numbers', () => {
    const r = ref();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const NULLABLE = new Set(['tableId', 'expected', 'allow', 'econ', 'copies', 'chance']); // the contract's `| null` fields
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') expect(Number.isFinite(v), path).toBe(true);
      else if (v === null) expect(NULLABLE.has(path.split('.').pop()!), `null at ${path}`).toBe(true);
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(r, 'ref');
    expect(r.meta.census.map(c => c.level)).toEqual([...LEVEL_IDS]);
    expect(r.meta.census[0].seeds).toEqual([...CENSUS_SEEDS]);
  });

  it('every table\'s shares sum to 1 (or it is empty) and every context references existing tables / items', () => {
    const r = ref();
    for (const t of Object.values(r.tables)) {
      if (t.emptyTable) { expect(t.rows).toEqual([]); continue; }
      expect(close(t.rows.reduce((s, x) => s + x.share, 0), 1, 1e-6), t.id).toBe(true);
      for (const x of t.rows) expect(ITEMS[x.itemId], `${t.id}: ${x.itemId}`).toBeDefined();
    }
    for (const l of r.levels) for (const h of l.holders) {
      if (h.tableId) expect(r.tables[h.tableId], h.id).toBeDefined();
      for (const p of h.rewardPicks ?? []) expect(r.tables[p], h.id).toBeDefined();
      if (h.expected) for (const it of h.expected.items) expect(r.items[it.itemId], it.itemId).toBeDefined();
    }
    for (const s of r.specials) for (const it of s.items) expect(r.items[it.itemId], `${s.id}: ${it.itemId}`).toBeDefined();
  });

  it('source locations resolve to real files and declaration lines', () => {
    const r = ref();
    const t = r.tables['OPENABLE_TABLES.bin'];
    expect(t.at.file).toBe('game/src/items/lootTables.ts');
    expect(readSource(t.at.file)!.split('\n')[t.at.line! - 1]).toMatch(/\bbin:/);
    const cc = r.tables.CACHE_CRATE;
    expect(readSource(cc.at.file)!.split('\n')[cc.at.line! - 1]).toMatch(/export const CACHE_CRATE\b/);
    for (const f of r.meta.generatedFrom) expect(readSource(f), f).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('loot reference: runtime agreement', () => {
  it('every holder context shows exactly what holderTable() / compartmentTable() resolve', () => {
    for (const l of ref().levels) {
      const P = lootProfile(l.id as LevelId);
      for (const h of l.holders) {
        const t = h.compartment ? compartmentTable(h.kind as HolderKind, h.areaKey, P)! : holderTable(h.kind as HolderKind, h.areaKey, P);
        expect(h.source, h.id).toBe(t.source);
        expect(h.slot, h.id).toBe(t.slot);
        expect(h.gates.empty, h.id).toBe(t.empty);
        expect(h.gates.lots, h.id).toEqual(t.lots);
        if (h.tableId) expect(rows(h.tableId), h.id).toEqual(t.rows.map(x => [x[0], x[1]]));
      }
    }
  });

  it('the economy shows the exported values', () => {
    const e = level('subway').economy;
    for (const th of e.themes) {
      const T = THEME_ECONOMY[th.id as keyof typeof THEME_ECONOMY];
      expect([th.keep, th.on, th.cats]).toEqual([T.keep, T.on, [...T.cats]]);
      expect(th.weights.map(w => w.weight)).toEqual(T.cats.map(c => T.weights[c] ?? 0));
    }
    expect(e.offTheme.map(o => [o.cat, o.weight])).toEqual(Object.entries(OFF_THEME_WEIGHTS));
    expect(e.boxCount.map(b => [b.itemId, b.small, b.big])).toEqual(Object.entries(BOX_COUNT).map(([k, b]) => [k, b.small, b.big]));
  });

  /** A spread of contexts: every source kind, compartments, junk, security (global-pool ammo), limb holders, legacy, rewards. */
  function picks(): HolderContext[] {
    const all = ref().levels.flatMap(l => l.holders.filter(h => h.expected));
    const by = (f: (h: HolderContext) => boolean) => all.find(f);
    const list = [
      by(h => h.source === 'legacy' && h.kind === 'vending'), by(h => h.source === 'legacy' && h.kind !== 'vending'),
      by(h => h.source === 'purpose' && h.scarcity.theme === 'security'), by(h => h.source === 'purpose' && h.scarcity.theme === 'food'),
      by(h => h.source === 'purpose' && h.scarcity.theme === 'service'), by(h => h.source === 'purpose' && h.scarcity.theme === 'tech'),
      by(h => h.source === 'purpose' && h.gates.bigBoxes), by(h => !!h.tableId?.startsWith('narrowed:')), by(h => h.scarcity.limbFrom === 'holder'),
      by(h => h.kind === 'bin'), by(h => h.kind === 'toiletStall'), by(h => h.source === 'own' && h.kind === 'examTable'),
      by(h => h.source === 'own' && h.kind === 'vaultSafe'), by(h => h.compartment && h.kind === 'desk'), by(h => h.compartment && h.kind === 'monitorDesk'),
      by(h => h.source === 'reward'), by(h => !!h.tableId?.startsWith('purpose-merged:')),
    ];
    return list.filter((h): h is HolderContext => !!h);
  }

  it('expected units / P(>= 1) per holder (before fit) match the real roll functions', () => {
    const list = picks();
    expect(list.length).toBeGreaterThanOrEqual(14);
    for (const h of list) {
      const P = lootProfile(h.level as LevelId), kind = h.kind as HolderKind;
      if (h.compartment) {
        agree(h, empirical((s, i) => holderFinds(s, i, kind, h.areaKey, true, P).slice(holderFinds(s, i, kind, h.areaKey, false, P).length)));
      } else {
        agree(h, empirical((s, i) => rollLootItems(s, i, kind, h.areaKey, P)));
        if (h.source !== 'reward') agree(h, empirical((s, i) => rollTableItems(s, i, kind, h.areaKey, P)), 'rawUnits');
      }
    }
  });

  it('rare gear: the capped-Poisson count and per-piece chances match rollLevelGear', () => {
    const g = ref().specials.find(s => s.id === 'gear')!;
    const Ng = 4000, counts = new Map<number, number>(), has = new Map<string, number>();
    for (let s = 1; s <= Ng; s++) {
      const out = rollLevelGear(s * 104729, 'office', ['main']).main;
      counts.set(out.length, (counts.get(out.length) ?? 0) + 1);
      for (const id of new Set(out.map(o => o.itemId))) has.set(id, (has.get(id) ?? 0) + 1);
    }
    expect(close(g.distribution!.reduce((s, d) => s + d.p, 0), 1)).toBe(true);
    for (const d of g.distribution!) expect(Math.abs((counts.get(d.k) ?? 0) / Ng - d.p), `gear count ${d.k}`).toBeLessThanOrEqual(5 * Math.sqrt(d.p * (1 - d.p) / Ng) + 0.003);
    for (const it of g.items) expect(Math.abs((has.get(it.itemId) ?? 0) / Ng - it.chance!), it.itemId).toBeLessThanOrEqual(5 * Math.sqrt(it.chance! * (1 - it.chance!) / Ng) + 0.003);
    const G = gearParams(lootProfile('office'));
    expect(g.expected).toBe(rd(expectation(cappedPoisson(G.mean, G.cap))));
  });

  it('gas masks / filters and weapon-find copies match their roll functions', () => {
    const m = ref().specials.find(s => s.id === 'gas-mask')!;
    for (const pl of m.perLevel!) {
      const Nm = 2000, counts = new Map<number, number>();
      for (let s = 1; s <= Nm; s++) { const n = rollMaskLoot(s * 31337, pl.level as LevelId, ['main']).main.filter(x => x.itemId === 'gas_mask').length; counts.set(n, (counts.get(n) ?? 0) + 1); }
      for (const d of pl.distribution!) expect(Math.abs((counts.get(d.k) ?? 0) / Nm - d.p), `${pl.level} masks ${d.k}`).toBeLessThanOrEqual(5 * Math.sqrt(d.p * (1 - d.p) / Nm) + 0.003);
      const [lo, hi] = MASK_LOOT.levels[pl.level as LevelId].masks;
      expect(pl.distribution!.map(d => d.k)).toEqual(uniformInt(lo, hi).map(d => d.n));
    }
    const w = ref().specials.find(s => s.id === 'weapon-finds')!;
    expect(w.distribution).toEqual([{k: 0, p: FIND_COPY_THRESHOLDS.none}, {k: 1, p: rd(FIND_COPY_THRESHOLDS.one - FIND_COPY_THRESHOLDS.none)}, {k: FIND_MAX_PER_WEAPON, p: rd(1 - FIND_COPY_THRESHOLDS.one)}]);
    const start = startWeaponFor(false), Nw = 3000, copies = new Map<number, number>();
    for (let s = 1; s <= Nw; s++) {
      const plan = officeWeaponPlan(s * 7907, start);
      const n = Object.values(plan).flat().filter(x => x === findWeaponsFor(start)[0]).length;
      copies.set(n, (copies.get(n) ?? 0) + 1);
    }
    for (const d of w.distribution!) expect(Math.abs((copies.get(d.k) ?? 0) / Nw - d.p), `copies ${d.k}`).toBeLessThanOrEqual(5 * Math.sqrt(d.p * (1 - d.p) / Nw) + 0.003);
    const box = ref().specials.find(s => s.id === 'pistol-start-boxes')!;
    expect(box.items[0]).toMatchObject({itemId: PISTOL_START_BOXES.itemId, count: PISTOL_START_BOXES.count});
    expect(box.distribution!.map(d => d.k)).toEqual(uniformInt(PISTOL_START_BOXES.n[0], PISTOL_START_BOXES.n[1]).map(d => d.n));
  });

  it('the starter kit is read from starterInventory (incl. the knife)', () => {
    const k = ref().specials.find(s => s.id === 'starter-kit')!;
    expect(k.class).toBe('guaranteed');
    expect(k.items.map(i => i.itemId)).toEqual(expect.arrayContaining(['pistol', 'knife', 'ammo_9mm', 'bandage', 'flare']));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('loot reference: probability maths and override / empty-table paths', () => {
  it('pick shares, ranges and P(>= 1)', () => {
    expect(pickProbs([1, 3])).toEqual([0.25, 0.75]);
    expect(pickProbs([2])).toEqual([1]); // single row
    expect(pickProbs([0, 0, 0])).toEqual([0, 0, 1]); // the pick walk returns the last row when every weight is 0
    expect(pickProbs([])).toEqual([]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(denominator([1, 2.5])).toBe(3.5);
    expect(() => denominator([1, -1])).toThrow();
    expect(meanInt(1, 3)).toBe(2);
    expect(uniformInt(3, 4)).toEqual([{n: 3, p: 0.5}, {n: 4, p: 0.5}]);
    expect(atLeastOne(0.5, 1, 1, 0.2)).toBeCloseTo(0.1, 12); // empty gate x one lot
    expect(atLeastOne(1, 2, 3, 0.5)).toBeCloseTo(1 - (0.25 + 0.125) / 2, 12); // multi-lot
    expect(atLeastOne(0, 1, 5, 1)).toBe(0); // always empty
    expect(noneOfN(0, 0, 0.9)).toBe(1); // zero lots
  });

  it('capped Poisson, repeat-halving picks and threshold bands', () => {
    const d = cappedPoisson(1, 5);
    expect(d.map(x => x.k)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(d.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 12);
    expect(d[0].p).toBeCloseTo(Math.exp(-1), 12);
    expect(cappedPoisson(2, 0)).toEqual([{k: 0, p: 1}]);
    const [a] = halvingPicks([['a', 1], ['b', 1]], 2);
    expect(a.pAny).toBeCloseTo(5 / 6, 12); // P(b, b) = 1/2 x 1/3
    expect(halvingPicks([['x', 3]], 3)[0]).toEqual({id: 'x', pAny: 1, mean: 3});
    const b = thresholdBands([0.55, 0.8, 0.93]);
    expect(b.probs.map(x => rd(x))).toEqual([0.55, 0.25, 0.13]);
    expect(rd(b.none)).toBe(0.07);
    expect(thresholdBands([0.5, 0.3])).toEqual({probs: [0.5, 0], none: 0.5}); // non-monotone (override-scaled) thresholds
    expect(() => rd(NaN)).toThrow();
  });

  const synthetic: LootProfile = {
    id: 'synthetic', label: 'Synthetic (test only)', tables: BASE_TABLES,
    overrides: {
      categoryWeight: {food: 0.4}, keep: {food: 0.5, med: 2}, itemWeight: {chips: 0}, slot: {surface: {empty: 1.5}, shelf: {lots: 0}},
      floor: {chance: {food: 0, battery: 0.5}, count: {med: 0.5}}, gear: {mean: 0.7, weight: {backpack: 2}},
    },
  };

  it('resolves a level profile with overrides (resolved tables, override list, analytical vs real rolls)', () => {
    const r = buildLootReference({profileFor: () => synthetic, censusSeeds: [11]});
    for (const l of r.levels) {
      expect(l.profile.overrides.length).toBeGreaterThan(5);
      expect(l.profile.validation).toEqual([]);
      for (const h of l.holders) {
        const t = h.compartment ? compartmentTable(h.kind as HolderKind, h.areaKey, synthetic)! : holderTable(h.kind as HolderKind, h.areaKey, synthetic);
        expect([h.gates.empty, h.gates.lots], h.id).toEqual([t.empty, t.lots]);
        if (h.tableId) expect(r.tables[h.tableId].rows.map(x => [x.itemId, x.weight]), h.id).toEqual(t.rows.map(x => [x[0], x[1]]));
        if (h.slot === 'shelf' && h.expected) expect(h.expected.units, h.id).toBe(0);
      }
    }
    expect(Object.keys(r.tables).some(id => id.endsWith('~synthetic'))).toBe(true);
    const h = r.levels[0].holders.find(x => x.source === 'purpose' && x.scarcity.theme === 'food' && x.slot !== 'shelf')!;
    agree(h, empirical((s, i) => rollLootItems(s, i, h.kind as HolderKind, h.areaKey, synthetic)));
    const sub = r.levels[0].floor.variants[0].finds;
    expect(sub.find(f => f.itemId === 'battery')!.chance).toBe(0.5);
    expect(sub.find(f => f.itemId === 'medkit')!.copies).toEqual([1, 1]); // [1, 2] x 0.5 rounded
    expect(r.specials.find(s => s.family === 'gear')!.expected).toBe(rd(expectation(cappedPoisson(0.7, 5))));
  });

  it('an override that zeroes every category gives empty tables: nothing drawn anywhere, still well-formed', () => {
    // (round 2, lane CACHE: + the gas-mask filter canister of the annex survivor caches' kit — a supply item with no economy category,
    // so its item weight is the dial that zeroes it)
    const nothing: LootProfile = {id: 'nothing', label: 'Nothing (test only)', tables: BASE_TABLES,
      overrides: {categoryWeight: {food: 0, drink: 0, med: 0, ammo: 0, battery: 0, flare: 0, material: 0}, itemWeight: {gas_filter: 0}}}; // + material: lane RACK (office-props-physics-scale-20261030)
    const r = buildLootReference({profileFor: () => nothing, censusSeeds: [11]});
    for (const l of r.levels) for (const h of l.holders) {
      if (!h.expected) continue;
      expect(h.expected.units, h.id).toBe(0);
      expect(h.expected.pAny, h.id).toBe(0);
      if (h.tableId) expect(r.tables[h.tableId].emptyTable, h.id).toBe(true);
    }
    const roof = r.levels.find(l => l.id === 'office')!.holders.find(h => h.source === 'reward')!;
    expect(roof.class).toBe('conditional'); // its picks resolve to empty tables: no longer guaranteed
    expect(rollLootItems(5, 0, 'crate', 'roof-cache', nothing)).toEqual([]);
  });
});
