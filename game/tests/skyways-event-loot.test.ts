// Task studio-skywalk-loot-performance-20261116-022934-01 (lane LOOT; Skyways layout version 8; user: "Make Technology Expo, Mini-golf
// and Evacuation Centre feel properly supplied with useful, plausible existing loot, not just decorative furniture"): the new events'
// own supply holders (gen/skyways/events/eventLoot.ts), their exact tables (items/lootTables.ts EXPO_* / GOLF_* / EVAC_*) and loot keys
// (gen/skyways/events/eventLootPurposes.ts).
//  - the tables: existing items, no ammo or weapons, within each holder kind's allowed categories, exact, keyed explicitly;
//  - the expected yield of each event's full set (seeded holder rolls), recorded here and in docs/skyways.md;
//  - per event (three seeds each): the holders, their places and themes, their placement (venue room, floor, wall, doors, routes,
//    clearances), unique holder indices and lot ids, finite seeded contents;
//  - save compatibility: version 8 = version 7 + the appended holders (every earlier record, holder roll and lot id identical, the
//    same attempt and event draw); the convention and the prize car are byte-identical.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {PROP_DEFS} from '../src/gen/props';
import {CELL, FLOOR} from '../src/gen/grid';
import {Rng} from '../src/core/rng';
import {backed, cellsOfBox, makePlaceCtx, propBlocksDoorway, type PlaceCtx} from '../src/gen/placeKit';
import type {Side} from '../src/gen/stationTypes';
import {skywaysAddonFor} from '../src/gen/skyways/frame';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {eventVenueContext} from '../src/gen/skyways/venueDress';
import {SKYWAYS_EVENT_ADDONS, type SkywaysEventAddonId, type SkywaysVenueRole} from '../src/gen/skyways/skywaysTypes';
import {SKYWAYS_EVENT_LOOT_MIN_VERSION, SKYWAYS_LAYOUT_VERSION} from '../src/gen/skyways/layoutVersion';
import {SKYWAYS_EVENT_LOOT, SKYWAYS_EVENT_SUPPLIES, skywaysEventLootOf, type SkywaysEventSupplyPlace} from '../src/gen/skyways/events/eventLoot';
import {SKYWAYS_EVENT_LOOT_PURPOSE, SKYWAYS_EVENT_LOOT_PURPOSES} from '../src/gen/skyways/events/eventLootPurposes';
import {ROOM_PURPOSES, purposeLoot} from '../src/gen/purposes';
import {HOLDER_ALLOW, econCat, lootProfile, type LootSpec} from '../src/items/lootTables';
import {createHolderState, holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {ITEMS} from '../src/items/items';
import {GOLF_EVENT_ONLY} from '../src/items/golfItems';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {officeModelKeysFor} from '../src/gen/office/index';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from '../src/gen/skyways/addonKinds';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {layoutHolders, surfaceOpts} from './helpers/lootEconomy';

const PROFILE = lootProfile('skyways');
/** Fixture seeds: three of each new event (the GAME130 pins' event seeds), plus a prize car and a convention. */
const EVENT_SEEDS: Readonly<Record<SkywaysEventAddonId, readonly number[]>> = {'tech-expo': [6, 10, 103855126], 'mini-golf': [5, 12, 4242], 'evac-centre': [2, 7, 15]};
const OTHER_SEEDS = [1, 4];

const cache = new Map<string, StationLayout>();
const gen = (seed: number, v: number): StationLayout => {
  const k = `${seed}:${v}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: v} as never) as StationLayout));
  return l;
};
const allKinds = (ev: SkywaysEventAddonId) => [...new Set(SKYWAYS_EVENT_SUPPLIES[ev].flatMap(s => s.holders.flat()))];
const specOf = (key: string, kind: string): LootSpec => purposeLoot(key, kind)!;
const units = (lots: readonly {count: number}[]) => lots.reduce((s, l) => s + l.count, 0);

/** The venue roles each place may use (evacuation sections: the shelter record's). */
const PLACE_ROLES: Readonly<Record<SkywaysEventSupplyPlace, readonly SkywaysVenueRole[] | null>> = {
  'expo-storage': ['storage', 'backstage', 'panel'], 'expo-demo': ['panel'], 'expo-floor': ['exhibitors'],
  'golf-desk': ['registration'], 'golf-maintenance': ['storage', 'backstage'], 'golf-concessions': ['exhibitors', 'panel'],
  'evac-medical': null, 'evac-rations': null, 'evac-supplies': null,
};
const EVAC_SECTIONS: Partial<Record<SkywaysEventSupplyPlace, readonly string[]>> = {'evac-medical': ['medical'], 'evac-rations': ['rations'], 'evac-supplies': ['supplies', 'office']};
const SIDE_OF = (rot: number): Side => (Math.abs(rot) < 0.01 ? 'N' : Math.abs(Math.abs(rot) - Math.PI) < 0.01 ? 'S' : rot > 0 ? 'W' : 'E');

/**
 * Expected yield (units) of one holder of each set (its primary kind), over 2000 seeded holder rolls (the real roll: createHolderState
 * on the holder's own stream, fitted to the kind's surfaces). docs/skyways.md "Version 8" records the same numbers.
 */
const EXPECTED: Readonly<Record<SkywaysEventAddonId, {perHolder: Readonly<Record<string, number>>; total: number}>> = {
  'tech-expo': {perHolder: {'expo-storage:rollingToolChest': 2.26, 'expo-storage:cardboardBoxFlaps': 1.39, 'expo-demo:footlocker': 1.48, 'expo-floor:cardboardBoxFlaps': 1.39, 'expo-floor:storageTote': 1.41}, total: 7.92},
  'mini-golf': {perHolder: {'golf-desk:filingCabinet': 1.58, 'golf-maintenance:rollingToolChest': 1.6, 'golf-maintenance:cabinetTall': 1.99, 'golf-concessions:shopCooler': 1.66, 'golf-concessions:snackRack': 1.59}, total: 8.43},
  'evac-centre': {perHolder: {'evac-medical:medCabinet': 1.82, 'evac-medical:storageTote': 1.17, 'evac-rations:crate': 1.75, 'evac-rations:cardboardBoxFlaps': 1.83, 'evac-supplies:cabinetTall': 1.71, 'evac-supplies:crate': 1.65}, total: 9.93},
};
/** What each fixture seed's version-8 supply holders actually hold (units by category), pinned. */
const SEED_YIELD: Readonly<Record<number, {holders: number; units: Readonly<Record<string, number>>}>> = {
  6: {holders: 5, units: {material: 2, battery: 3}},
  10: {holders: 5, units: {material: 9, battery: 4}},
  103855126: {holders: 5, units: {material: 5, battery: 1, drink: 1}},
  5: {holders: 5, units: {drink: 1, food: 1}},
  12: {holders: 5, units: {drink: 3, med: 2, material: 2, food: 3}},
  4242: {holders: 5, units: {med: 2, material: 4, battery: 1, drink: 1}},
  2: {holders: 6, units: {med: 5, drink: 2, food: 1, battery: 2, flare: 1}},
  7: {holders: 6, units: {med: 3, food: 1, drink: 2, flare: 1, battery: 3}},
  15: {holders: 5, units: {med: 4, food: 4, drink: 2, flare: 1}},
};

describe('Skyways event supplies: tables and keys (layout version 8)', () => {
  it('version 8 is the current version and gates the pass', () => {
    expect(SKYWAYS_EVENT_LOOT_MIN_VERSION).toBe(8);
    expect(SKYWAYS_LAYOUT_VERSION).toBeGreaterThanOrEqual(SKYWAYS_EVENT_LOOT_MIN_VERSION);
    expect(Object.keys(SKYWAYS_EVENT_SUPPLIES).sort()).toEqual([...SKYWAYS_EVENT_ADDONS].sort());
  });

  it('the loot keys are preset-only purposes (weight 0, max 0, skyways- prefix) appended to ROOM_PURPOSES', () => {
    const ids = Object.values(SKYWAYS_EVENT_LOOT_PURPOSE);
    expect(Object.keys(SKYWAYS_EVENT_LOOT_PURPOSES()).sort()).toEqual([...ids].sort());
    const order = Object.keys(ROOM_PURPOSES);
    for (const id of ids) {
      const p = ROOM_PURPOSES[id];
      expect(p, id).toBeDefined();
      expect(id.startsWith('skyways-'), id).toBe(true);
      expect(p.weight, id).toBe(0);
      expect(p.max, id).toBe(0);
      expect(order.indexOf(id), `${id} is appended last`).toBeGreaterThanOrEqual(order.length - ids.length);
    }
  });

  for (const ev of SKYWAYS_EVENT_ADDONS) {
    it(`${ev}: every holder (fallbacks too) rolls its place's exact table — existing items, no ammo / weapons / golf items, within its kind's categories`, () => {
      for (const set of SKYWAYS_EVENT_SUPPLIES[ev]) for (const kind of set.holders.flat()) {
        const what = `${set.place} ${kind}`;
        expect(isLootHolderKind(kind), what).toBe(true);
        const spec = specOf(set.key, kind);
        expect(spec?.exact, what).toBe(true);
        expect(spec.salvage, what).toBe(false);
        const t = holderTable(kind as HolderKind, set.key, PROFILE);
        expect(t.source, `${what}: the key's own entry, never the kind's own table`).toBe('purpose');
        expect(t.exact, what).toBe(true);
        expect(t.rows, `${what}: exactly the named rows`).toEqual(spec.items);
        const allow = HOLDER_ALLOW[kind];
        for (const [id] of spec.items) {
          expect(ITEMS[id as keyof typeof ITEMS], `${what}: ${id} exists`).toBeDefined();
          const cat = econCat(id);
          expect(cat, `${what}: ${id}`).not.toBeNull();
          expect(cat, `${what}: no ammo`).not.toBe('ammo');
          expect(GOLF_EVENT_ONLY.includes(id), `${what}: ${id} is no golf item`).toBe(false);
          if (allow) expect(allow.includes(cat!), `${what}: ${id} (${cat}) allowed in a ${kind}`).toBe(true);
        }
      }
    });

    it(`${ev}: every holder kind is an existing, audited openable with a physics class and a model the Skyways may load`, () => {
      for (const kind of allKinds(ev)) {
        const a = OPENABLE_AUDIT.find(r => r.kind === kind);
        // (openable: new doors / lids / drawers; existing: the legacy openable containers; open: always-open shelving, the snack rack)
        expect(['openable', 'existing', 'open'], `${kind}: classified (${a?.cls})`).toContain(a?.cls);
        expect(PROP_PHYSICS_AUDIT[kind]?.cls, `${kind}: physics class`).toMatch(/^(dynamic|static)$/);
      }
    });

    it(`${ev}: the expected yield of a full set (2000 seeded rolls per holder) is pinned`, () => {
      const opts = surfaceOpts(), N = 2000;
      let total = 0;
      for (const set of SKYWAYS_EVENT_SUPPLIES[ev]) for (const kinds of set.holders) {
        const kind = kinds[0], def = PROP_DEFS[kind] as {w: number; d: number; h: number};
        const surfaces = holderSurfaces(kind as never, def, opts);
        let u = 0;
        for (let s = 1; s <= N; s++) u += units(createHolderState(s * 7919, s % 5, kind as HolderKind, set.key, surfaces, undefined, PROFILE).lots);
        const mean = u / N;
        expect(mean, `${set.place} ${kind}`).toBeCloseTo(EXPECTED[ev].perHolder[`${set.place}:${kind}`], 2);
        total += mean;
      }
      expect(total).toBeCloseTo(EXPECTED[ev].total, 1);
    });
  }
});

/** A whole-layout placement context of the holder's storey (door zones, stair edges, apertures). */
const ctxCache = new WeakMap<StationLayout, Map<number, PlaceCtx>>();
const ctxOf = (l: StationLayout, lv: number): PlaceCtx => {
  let m = ctxCache.get(l);
  if (!m) ctxCache.set(l, (m = new Map()));
  let c = m.get(lv);
  if (!c) m.set(lv, (c = makePlaceCtx(l, new Rng(1), lv)));
  return c;
};

describe('Skyways event supplies: generated venues (layout version 8)', () => {
  for (const ev of SKYWAYS_EVENT_ADDONS) for (const seed of EVENT_SEEDS[ev]) {
    it(`${ev} seed ${seed}: version 8 = version 7 + the appended supply holders (records, holder rolls, lot ids, attempt, event draw)`, () => {
      expect(skywaysAddonFor(seed, 7)).toBe(ev);
      expect(skywaysAddonFor(seed, 8)).toBe(ev);
      const L7 = gen(seed, 7), L8 = gen(seed, 8);
      expect(L8.attempt).toBe(L7.attempt);
      expect(L8.skyways!.addon.id).toBe(ev);
      const n7 = L7.props.length;
      expect(L8.props.slice(0, n7)).toEqual(L7.props);
      for (const k of ['areas', 'doors', 'pickups', 'zombies', 'hordes', 'signs', 'storefronts', 'lights'] as const) expect(L8[k], k).toEqual(L7[k]);
      expect(L8.skyways).toEqual(L7.skyways);
      const r = skywaysEventLootOf(L8);
      expect(r.holders.map(h => h.index).sort((a, b) => a - b)).toEqual(Array.from({length: L8.props.length - n7}, (_, i) => n7 + i));
      // every earlier holder keeps its index, purpose key and rolled lots; the new ones come after
      const h7 = layoutHolders(L7, PROFILE), h8 = layoutHolders(L8, PROFILE);
      expect(h8.slice(0, h7.length)).toEqual(h7);
      expect(h8.length).toBe(h7.length + r.holders.length);
      // the same validation verdict
      expect(skywaysIssues(L8)).toEqual(skywaysIssues(L7));
    });

    it(`${ev} seed ${seed}: the supply holders' places, themes, unique ids and finite seeded contents`, () => {
      const L8 = gen(seed, 8), r = skywaysEventLootOf(L8);
      expect(r.holders.length, `holders (skipped: ${r.skipped.join('; ')})`).toBeGreaterThanOrEqual(SKYWAYS_EVENT_SUPPLIES[ev].length + 1);
      const sets = SKYWAYS_EVENT_SUPPLIES[ev];
      for (const set of sets) expect(r.holders.some(h => h.place === set.place), `${set.place} has a holder (skipped: ${r.skipped.join('; ')})`).toBe(true);
      const venue = L8.skyways!.addon.venue!;
      const holders = layoutHolders(L8, PROFILE);
      const serialOf = new Map<number, number>();
      L8.props.forEach((p, i) => { if (isLootHolderKind(p.kind)) serialOf.set(i, serialOf.size); });
      const tot: Record<string, number> = {};
      for (const h of r.holders) {
        const p = L8.props[h.index], set = sets.find(s => s.place === h.place)!, what = `${h.place} ${h.kind} #${h.index}`;
        expect(set.holders.flat(), what).toContain(h.kind);
        expect(p.purpose, what).toBe(set.key);
        // the place's rooms
        const roles = PLACE_ROLES[h.place];
        if (roles) expect(roles, what).toContain(venue.find(q => q.area === p.area)?.role);
        else expect(L8.skyways!.addon.evac!.sections.some(s => s.area === p.area && EVAC_SECTIONS[h.place]!.includes(s.role)), what).toBe(true);
        // its contents: rolled once from the holder's own stream, only its table's items
        const roll = holders[serialOf.get(h.index)!];
        expect(roll.areaType, what).toBe(set.key);
        const rows = new Set(specOf(set.key, h.kind).items.map(([id]) => id));
        for (const l of roll.lots) {
          expect(rows.has(l.itemId), `${what}: ${l.itemId}`).toBe(true);
          tot[econCat(l.itemId)!] = (tot[econCat(l.itemId)!] ?? 0) + l.count;
        }
      }
      expect(tot.ammo ?? 0).toBe(0);
      // unique per-kind holder indices and lot ids across the whole level
      const idx = new Set(holders.map(h => `${h.kind}:${h.index}`));
      expect(idx.size).toBe(holders.length);
      const uids = holders.flatMap((h, serial) => h.lots.map(l => serial * 1000 + (l.id % 1000)));
      expect(new Set(uids).size).toBe(uids.length);
      // deterministic: a second generation rolls the very same holders and contents
      const again = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 8} as never) as StationLayout;
      expect(again.props.slice(L8.props.length - r.holders.length)).toEqual(L8.props.slice(L8.props.length - r.holders.length));
      expect(layoutHolders(again, PROFILE)).toEqual(holders);
    });

    it(`${ev} seed ${seed}: every supply holder stands on the venue floor with its back to a solid wall, clear of doors, routes, props, pickups and spawns`, () => {
      const L7 = gen(seed, 7), L8 = gen(seed, 8), r = skywaysEventLootOf(L8), R = SKYWAYS_EVENT_LOOT;
      for (const h of r.holders) {
        const p = L8.props[h.index], lv = p.level ?? 0, ctx = ctxOf(L8, lv), g = ctx.g, a = L8.areas[p.area], def = PROP_DEFS[p.kind as keyof typeof PROP_DEFS], what = `${h.place} ${h.kind} #${h.index}`;
        expect(a.level ?? 0, what).toBe(lv);
        expect(lv, what).toBe(L8.skyways!.addon.level);
        // on the floor: every cell under it is floor of its room at the prop's height
        const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const i = g.idx(cx, cy);
          expect(g.cells[i], what).toBe(FLOOR);
          expect(g.area[i], what).toBe(a.id);
          expect(Math.abs(g.floorOf(i) - p.y), `${what}: grounded`).toBeLessThan(1e-6);
          expect(ctx.zone[i] || ctx.doorCell[i] || ctx.edge[i], `${what}: no door zone / stair edge`).toBeFalsy();
        }
        // its back against a solid wall of its room (foot and top), within a few cm
        const side = SIDE_OF(p.rot), along = side === 'N' || side === 'S', t = along ? p.x : p.z, hw = def.w / 2;
        expect(backed(ctx, a, side, t - hw, t + hw, p.y + 0.1) && backed(ctx, a, side, t - hw, t + hw, p.y + def.h - 0.05), `${what}: wall-backed`).toBe(true);
        const wall = side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
        const back = side === 'N' ? p.z - p.hz : side === 'S' ? p.z + p.hz : side === 'W' ? p.x - p.hx : p.x + p.hx;
        expect(Math.abs(back - wall), `${what}: against the wall`).toBeLessThan(0.05);
        expect(propBlocksDoorway(L8, p.x, p.z, p.hx, p.hz, p.y, p.h), `${what}: no door's clear volume`).toBeNull();
        // its front strip is open floor (beyond the cells it stands in itself)
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), f = R.front, hd = def.d / 2;
        const [s0, s1, s2, s3] = cellsOfBox(p.x + fx * (hd + f / 2), p.z + fz * (hd + f / 2), fx ? f / 2 : hw * 0.8, fz ? f / 2 : hw * 0.8);
        let open = 0;
        for (let cy = s1; cy <= s3; cy++) for (let cx = s0; cx <= s2; cx++) {
          if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
          expect(g.walkable(cx, cy), `${what}: front strip`).toBe(true);
          open++;
        }
        expect(open, `${what}: front strip`).toBeGreaterThan(0);
        // no other prop's box meets it (any height), no pickup within 0.8 m, no enemy spawn within 1.1 m
        for (const [j, q] of L8.props.entries()) {
          if (j === h.index || (q.level ?? 0) !== lv) continue;
          const overlap = q.x + q.hx > p.x - p.hx + 0.01 && q.x - q.hx < p.x + p.hx - 0.01 && q.z + q.hz > p.z - p.hz + 0.01 && q.z - q.hz < p.z + p.hz - 0.01
            && q.y + q.h > p.y + 0.01 && q.y + (q.lift ?? 0) < p.y + p.h - 0.01;
          expect(overlap, `${what} meets ${q.kind} #${j}`).toBe(false);
        }
        const gap = (x: number, z: number) => Math.max(Math.abs(x - p.x) - p.hx, Math.abs(z - p.z) - p.hz);
        for (const q of L8.pickups) if ((q.level ?? 0) === lv) expect(gap(q.x, q.z), `${what}: pickup ${q.itemId}`).toBeGreaterThan(0.8);
        for (const z of L8.zombies) if ((z.level ?? 0) === lv) expect(gap(z.x, z.z), `${what}: spawn`).toBeGreaterThan(1.1);
      }
      // every 1.2 m route the venue had (from the bridges to each opening, and each room's own) is still there
      const roles: SkywaysVenueRole[] = ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge', 'backstage', 'storage'];
      const before = eventVenueContext(L7, new Rng(1), roles)!, after = eventVenueContext(L8, new Rng(1), roles)!;
      expect(after.walk.key0).toBe(before.walk.key0);
      expect([...after.reach0]).toEqual([...before.reach0]);
      // the models are the Skyways' own (no foreign level's catalogue)
      const sub = {props: r.holders.map(h => L8.props[h.index])};
      const keys = [...officeModelKeysFor(sub), ...p7ModelKeysFor(sub as never), ...skywaysAddonModelKeysFor(sub)];
      const cat = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...MALL_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES};
      expect(selectLevelKeys('skyways', keys, cat).foreign).toEqual([]);
    });
  }

  it('mini-golf: the finite putter and balls, the course and the desk record are untouched', () => {
    for (const seed of EVENT_SEEDS['mini-golf']) {
      const L7 = gen(seed, 7), L8 = gen(seed, 8);
      expect(L8.skyways!.addon.golf).toEqual(L7.skyways!.addon.golf);
      const golf = (l: StationLayout) => l.pickups.filter(q => GOLF_EVENT_ONLY.includes(q.itemId));
      expect(golf(L8)).toEqual(golf(L7));
      expect(golf(L8).length).toBeGreaterThan(0);
    }
  });

  it('the fixture seeds\' supply yields are pinned', () => {
    for (const ev of SKYWAYS_EVENT_ADDONS) for (const seed of EVENT_SEEDS[ev]) {
      const L8 = gen(seed, 8), r = skywaysEventLootOf(L8), holders = layoutHolders(L8, PROFILE);
      const serialOf = new Map<number, number>();
      L8.props.forEach((p, i) => { if (isLootHolderKind(p.kind)) serialOf.set(i, serialOf.size); });
      const tot: Record<string, number> = {};
      for (const h of r.holders) for (const l of holders[serialOf.get(h.index)!].lots) tot[econCat(l.itemId)!] = (tot[econCat(l.itemId)!] ?? 0) + l.count;
      expect({holders: r.holders.length, units: tot}, `seed ${seed}`).toEqual(SEED_YIELD[seed]);
    }
    expect(Object.keys(SEED_YIELD).length).toBe(9);
  });

  it('the convention and the prize car are byte-identical at version 8 (the pass draws nothing for them)', () => {
    for (const seed of OTHER_SEEDS) {
      expect(['convention', 'prize-car']).toContain(skywaysAddonFor(seed, 8));
      const L7 = gen(seed, 7), L8 = gen(seed, 8);
      expect(JSON.stringify(L8.props)).toBe(JSON.stringify(L7.props));
      for (const k of ['areas', 'pickups', 'zombies', 'hordes', 'signs', 'skyways'] as const) expect(JSON.stringify(L8[k]), `seed ${seed} ${k}`).toBe(JSON.stringify(L7[k]));
      expect(skywaysEventLootOf(L8).holders).toEqual([]);
    }
  });
});
