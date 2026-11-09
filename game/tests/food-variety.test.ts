// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): FOOD VARIETY by family substitution at realization
// (items/pantryVariety.ts). User intent: "more VARIETY of collectible food and drinks across the game, less repetition like 30 % chocolate
// bars" — by REDISTRIBUTING the existing food opportunities, never by adding food.
//  - families: every pantry item stands in for exactly the kind of old item it resembles (food for food, drink for drink); every item is in
//    some level's palette; no level loads all 24; bread / the Skyways ramen food are never substituted;
//  - NUTRITION: in EVERY context (level x loot theme x holder slot, + the floor) the expected food / water of a substituted lot is within
//    10 % of the old item's food + water magnitude, per dimension;
//  - realization: pure (no RNG stream), deterministic, one lot -> one lot (count, position, compartment, rolled slot), non-food lots are
//    the very same objects, ids encode the variant (< 1e9, id % 1000 kept), a variant always FITS where the rolled item lies;
//  - PERSISTENCE: fresh -> captured record -> rebuilt = identical; an OLD record (rolled ids) keeps exactly its old items (no reroll /
//    refill / injection); a taken lot never comes back; through the real ContainerManager.build + run/worldMemory capture / apply path;
//  - a census over real generated layouts of every level: same lot / food-unit counts, chocolate much less dominant, more distinct foods,
//    the realized food / water totals within 10 % (written to /tmp/pantry-lane/census.json).
import {describe, expect, it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {ITEMS, itemDef} from '../src/items/items';
import {PANTRY_IDS, isPantryItem} from '../src/items/pantryFood';
import {
  LEVEL_PANTRY, PANTRY_BASES, PANTRY_CODE, PANTRY_FAMILIES, PANTRY_LOT_OFFSET, decodeLotId, familyExpectation, familyRows, fitInPlace,
  isPantryBase, levelPantryIds, levelPreloadPantryIds, pantryHolderRealizer, pantryIdsIn, pantryPickupItem, realizeHolderLots, realizePickupItem, variantLotId,
  type PantryContext,
} from '../src/items/pantryVariety';
import {SLOT_CATEGORIES, econCat, lootProfile} from '../src/items/lootTables';
import {placementBox, lotBoxesOverlap, holderSurfaces, type Surface} from '../src/items/lootLayout';
import {applyHolderRecord, captureHolder} from '../src/run/memory';
import {LEVEL_IDS, LEVELS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import type {LootTheme} from '../src/gen/purposes';
import type {Lot} from '../src/items/loot';
import {layoutHolderDetails, type LayoutHolderDetail} from './helpers/lootEconomy';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, rowLayout} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {Inventory} from '../src/items/inventory';
import {applyHolders, captureHolders} from '../src/run/worldMemory';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const OUT = '/tmp/pantry-lane';
const THEMES: readonly LootTheme[] = ['security', 'medical', 'food', 'service', 'tech', 'personal', 'public'];
const SLOTS = [...SLOT_CATEGORIES, 'floor', undefined] as const;
const LEVELS_X = [...LEVEL_IDS, 'baseline'];
const mag = (id: string) => Math.abs(ITEMS[id].hunger ?? 0) + Math.abs(ITEMS[id].thirst ?? 0);

describe('food variety: families and palettes', () => {
  it('every pantry item stands in for an old item of its own kind (food for food, drink for drink); bread / ramen food are not substituted', () => {
    const inFamily = new Set<string>();
    for (const [base, f] of Object.entries(PANTRY_FAMILIES)) {
      expect(f.base).toBe(base);
      expect(ITEMS[base], base).toBeTruthy();
      expect(f.keep, base).toBeGreaterThan(0);
      expect(f.keep, base).toBeLessThan(1);
      for (const id of Object.keys(f.members)) {
        inFamily.add(id);
        expect(isPantryItem(id), id).toBe(true);
        expect(econCat(id), `${id} in ${base}`).toBe(econCat(base));
        expect(itemDef(id).verb, `${id} in ${base}`).toBe(itemDef(base).verb);
      }
    }
    expect([...inFamily].sort()).toEqual([...PANTRY_IDS].sort());
    expect([...PANTRY_BASES].sort()).toEqual(['beans', 'chips', 'chocolate', 'cola', 'juice', 'noodles', 'water']);
    for (const id of ['bread', 'ramen', 'ramen_chashu', 'sushi_bento', 'bubble_tea', ...PANTRY_IDS, 'medkit', 'ammo_9mm']) expect(isPantryBase(id), id).toBe(false);
    // chocolate (the most repeated find) keeps under a third of its lots; plain water stays dominant
    expect(PANTRY_FAMILIES.chocolate.keep).toBeLessThanOrEqual(0.3);
    expect(PANTRY_FAMILIES.water.keep).toBeGreaterThanOrEqual(0.8);
  });

  it('every level has a palette (no level loads all 24 models); together they stock every pantry item', () => {
    const all = new Set<string>();
    for (const level of LEVEL_IDS) {
      const pal = LEVEL_PANTRY[level];
      expect(pal, level).toBeTruthy();
      expect(new Set(pal).size, level).toBe(pal.length);
      expect(pal.length, level).toBeLessThan(PANTRY_IDS.length);
      expect(pal.length, level).toBeGreaterThanOrEqual(12);
      for (const id of pal) { expect(isPantryItem(id), id).toBe(true); all.add(id); }
      // each level offers variety in every family (at least one member of each)
      for (const base of PANTRY_BASES) expect(familyRows(base, {level, theme: 'public', slot: 'shelf'}).length, `${level} ${base}`).toBeGreaterThan(1);
    }
    expect([...all].sort()).toEqual([...PANTRY_IDS].sort());
    expect(levelPantryIds('baseline')).toEqual(PANTRY_IDS);
    // a level's loading screen fetches its palette's models — none where the loot profile rolls no food / drink (the Survivor Market)
    for (const level of LEVEL_IDS) expect(levelPreloadPantryIds(level), level).toEqual(level === 'market' ? [] : LEVEL_PANTRY[level]);
    // rice crackers lean to Skyways / Market shops, rations to security / service rooms (and the Reactor)
    const share = (base: string, id: string, c: PantryContext) => familyRows(base, c).find(r => r[0] === id)?.[1] ?? 0;
    expect(share('chips', 'rice_crackers', {level: 'skyways', theme: 'food', slot: 'shelf'})).toBeGreaterThan(share('chips', 'rice_crackers', {level: 'office', theme: 'food', slot: 'shelf'}));
    expect(share('beans', 'field_ration', {level: 'reactor', theme: 'security', slot: 'container'})).toBeGreaterThan(2 * share('beans', 'field_ration', {level: 'subway', theme: 'food', slot: 'shelf'}));
    expect(share('beans', 'ration_brick', {level: 'subway', theme: 'food', slot: 'shelf'})).toBeLessThan(0.04); // rare
  });

  it('rows of every context sum to 1, keep the old item first at its keep share, and only list the level palette', () => {
    for (const level of LEVELS_X) for (const theme of THEMES) for (const slot of SLOTS) for (const base of PANTRY_BASES) {
      const rows = familyRows(base, {level, theme, slot});
      expect(Math.abs(rows.reduce((s, r) => s + r[1], 0) - 1), `${level}/${theme}/${slot}/${base}`).toBeLessThan(1e-9);
      expect(rows[0][0]).toBe(base);
      if (rows.length > 1) expect(rows[0][1]).toBeCloseTo(PANTRY_FAMILIES[base].keep, 12);
      for (const [id] of rows.slice(1)) expect(levelPantryIds(level), `${level} ${id}`).toContain(id);
    }
  });
});

describe('food variety: the expected food / water of a substituted lot stays within 10 % (every context)', () => {
  it('per family, level, loot theme and slot: |E - old| <= 10 % of the old item\'s food + water, per dimension', () => {
    const worst: Record<string, {ctx: string; dh: number; dt: number; tol: number}> = {};
    const bad = new Set<string>();
    for (const base of PANTRY_BASES) {
      const h0 = ITEMS[base].hunger ?? 0, t0 = ITEMS[base].thirst ?? 0, tol = 0.1 * mag(base);
      for (const level of LEVELS_X) for (const theme of THEMES) for (const slot of SLOTS) {
        const e = familyExpectation(base, {level, theme, slot});
        const dh = e.hunger - h0, dt = e.thirst - t0, ctx = `${level}/${theme}/${slot ?? '-'}`;
        if (Math.abs(dh) > tol) bad.add(`${base} food @ ${level}/${theme}: ${e.hunger.toFixed(2)} vs ${h0} (tol ${tol.toFixed(1)})`);
        if (Math.abs(dt) > tol) bad.add(`${base} water @ ${level}/${theme}: ${e.thirst.toFixed(2)} vs ${t0} (tol ${tol.toFixed(1)})`);
        const w = worst[base];
        if (!w || Math.max(Math.abs(dh), Math.abs(dt)) > Math.max(Math.abs(w.dh), Math.abs(w.dt))) worst[base] = {ctx, dh: +dh.toFixed(3), dt: +dt.toFixed(3), tol: +tol.toFixed(2)};
      }
    }
    mkdirSync(OUT, {recursive: true});
    writeFileSync(`${OUT}/nutrition-worst.json`, JSON.stringify(worst, null, 1));
    expect([...bad]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// realization on synthetic holders

const shelf = holderSurfaces('shelf', {w: 1.2, d: 0.45, h: 1.85});
const lot = (id: number, itemId: string, surface: number, x: number, o: Partial<Lot> = {}): Lot => ({id, itemId, count: 1, surface, x, y: shelf[surface].y, z: 0, yaw: 0, orient: 'up', ...o});
const H = (index: number, kind = 'shelf', areaType = 'convenience') => ({seed: 4242, kind, index, areaType, surfaces: shelf});

/** All lots of a holder sit within their surface's clear height and never overlap each other. */
function expectSound(lots: readonly Lot[], surfaces: readonly Surface[], label: string): void {
  const boxes = lots.map(l => placementBox(l.itemId, l));
  lots.forEach((l, i) => {
    const s = surfaces[l.surface];
    expect(boxes[i].max[1] - boxes[i].min[1] + 0.004, `${label} ${l.itemId} height`).toBeLessThanOrEqual(s.clear + 1e-9);
    for (let j = i + 1; j < lots.length; j++) expect(lotBoxesOverlap(boxes[i], boxes[j]), `${label} ${l.itemId} x ${lots[j].itemId}`).toBe(false);
  });
}

describe('food variety: realization (pure, one lot -> one lot, fits)', () => {
  it('ids encode the variant (append-only codes), stay below the save validator bound and keep the rolled slot', () => {
    expect(PANTRY_CODE).toEqual(PANTRY_IDS);
    for (const id of PANTRY_IDS) for (const rolled of [0, 7, 1004, 3700, 4_999_999]) {
      const v = variantLotId(rolled, id)!;
      expect(v).toBeLessThan(1e9);
      expect(v % 1000).toBe(rolled % 1000);
      expect(decodeLotId(v)).toEqual({rolled, variant: id});
    }
    expect(decodeLotId(4321)).toEqual({rolled: 4321, variant: null});
    expect(variantLotId(PANTRY_LOT_OFFSET, 'jerky')).toBeNull();
    expect(variantLotId(5, 'chocolate')).toBeNull();
  });

  it('deterministic, never mutates its input, non-food lots are the same objects, counts / positions / compartments unchanged', () => {
    let changed = 0;
    for (let index = 0; index < 300; index++) {
      const lots = [lot(index * 1000, 'chocolate', 1, -0.35), lot(index * 1000 + 1, 'ammo_9mm', 1, 0, {count: 6}), lot(index * 1000 + 2, 'beans', 1, 0.35, {part: 0}),
        lot(index * 1000 + 3, 'water', 2, -0.2), lot(index * 1000 + 4, 'bandage', 2, 0.2)];
      const before = structuredClone(lots);
      const a = realizeHolderLots(H(index), 'mall', lots), b = realizeHolderLots(H(index), 'mall', lots);
      expect(a).toEqual(b);
      expect(lots).toEqual(before);
      expect(a.length).toBe(lots.length);
      a.forEach((l, i) => {
        const r = lots[i];
        if (!isPantryBase(r.itemId)) { expect(l).toBe(r); return; }
        expect([l.count, l.surface, l.x, l.y, l.z, l.yaw, l.part]).toEqual([r.count, r.surface, r.x, r.y, r.z, r.yaw, r.part]);
        expect(decodeLotId(l.id).rolled).toBe(r.id);
        if (l.itemId !== r.itemId) {
          changed++;
          expect(decodeLotId(l.id).variant).toBe(l.itemId);
          expect(PANTRY_FAMILIES[r.itemId].members).toHaveProperty(l.itemId);
        } else expect(l.id).toBe(r.id);
      });
      expectSound(a, shelf, `#${index}`);
    }
    expect(changed).toBeGreaterThan(300); // ~60 % of the 900 food / drink lots
    // nothing to realize: the very same array
    const none = [lot(0, 'ammo_9mm', 0, 0), lot(1, 'bread', 0, 0.4)];
    expect(realizeHolderLots(H(1), 'subway', none)).toBe(none);
  });

  it('over many holders a family keeps its old item at its keep share (+-3 %) and spreads the rest over its members', () => {
    for (const base of PANTRY_BASES) {
      const n = 6000, got = new Map<string, number>();
      for (let index = 0; index < n; index++) {
        const [r] = realizeHolderLots({seed: 1234, kind: 'shelf', index, areaType: 'storage', surfaces: shelf}, 'baseline', [lot(index * 1000, base, 1, 0)]);
        got.set(r.itemId, (got.get(r.itemId) ?? 0) + 1);
      }
      const rows = familyRows(base, {level: 'baseline', theme: 'service', slot: 'shelf'});
      for (const [id, w] of rows) expect(Math.abs((got.get(id) ?? 0) / n - w), `${base} -> ${id}`).toBeLessThan(0.03);
    }
  });

  it('a variant must FIT where the rolled item lies: never taller than the clear height, never across the mid-line to a neighbour', () => {
    // a 6 cm chocolate tier: only flat variants fit (no 0.15 m pouch / bottle)
    const low: Surface[] = [{y: 0.5, x0: -0.3, x1: 0.3, z0: -0.15, z1: 0.15, clear: 0.06}];
    let seen = 0;
    for (let index = 0; index < 400; index++) {
      const l: Lot = {id: index * 1000, itemId: 'chocolate', count: 1, surface: 0, x: 0, y: 0.5, z: 0, yaw: 0, orient: 'up'};
      const [r] = realizeHolderLots({seed: 9, kind: 'shelf', index, areaType: 'convenience', surfaces: low}, 'mall', [l]);
      const b = placementBox(r.itemId, r);
      expect(b.max[1] - b.min[1] + 0.004, r.itemId).toBeLessThanOrEqual(0.06);
      if (r.itemId !== 'chocolate') seen++;
    }
    expect(seen).toBeGreaterThan(0);
    // two chocolate bars 5 cm apart: whatever they become, they never overlap (each decided against the other's ROLLED box)
    for (let index = 0; index < 400; index++) {
      const lots = [lot(index * 1000, 'chocolate', 1, -0.09), lot(index * 1000 + 1, 'chocolate', 1, 0.09)];
      expectSound(realizeHolderLots(H(index), 'mall', lots), shelf, `pair #${index}`);
    }
    // the fit helper: a 0.28 m sausage cannot take a 0.16 m chocolate bar's spot between two neighbours 2 cm away
    const at: Lot = lot(0, 'chocolate', 1, 0);
    const n = [placementBox('beans', lot(1, 'beans', 1, -0.12)), placementBox('beans', lot(2, 'beans', 1, 0.12))];
    expect(fitInPlace('smoked_sausage', at, 'chocolate', shelf, n)).toBeNull();
    expect(fitInPlace('raisins', at, 'chocolate', shelf, n)).not.toBeNull();
  });

  it('floor pickups: same count in one stack, curated rewards untouched, deterministic per layout index', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const [itemId, count] of [['chocolate', 1], ['water', 2], ['beans', 1], ['cola', 6]] as const) {
        const id = realizePickupItem(77, i, 'subway', 'public', {itemId, count});
        expect(id).toBe(realizePickupItem(77, i, 'subway', 'public', {itemId, count}));
        expect(ITEMS[id].stackMax, id).toBeGreaterThanOrEqual(count);
        expect(id === itemId || id in PANTRY_FAMILIES[itemId].members, id).toBe(true);
        seen.add(id);
      }
      expect(realizePickupItem(77, i, 'office', 'public', {itemId: 'chocolate', count: 1, reward: 'roof-find'})).toBe('chocolate');
      expect(realizePickupItem(77, i, 'office', 'public', {itemId: 'medkit', count: 1})).toBe('medkit');
    }
    expect(seen.size).toBeGreaterThan(10);
    const layout = {seed: 5, areas: [{purpose: 'convenience', type: 'shop'}], pickups: [{itemId: 'juice', count: 1, area: 0}, {itemId: 'ammo_9mm', count: 8, area: 0}]} as unknown as StationLayout;
    expect(pantryPickupItem(layout, 1, 'subway')).toBe('ammo_9mm');
    expect(pantryPickupItem(layout, 0, 'subway')).toBe(realizePickupItem(5, 0, 'subway', 'food', {itemId: 'juice', count: 1}));
  });

  it('pantryIdsIn finds pantry ids in any JSON-like record (inventory / store / memory), nothing else', () => {
    const v = {hotbar: [{uid: 1, itemId: 'sardines', count: 2}, null], pack: [{uid: 2, itemId: 'backpack', count: 1, bag: [{uid: 3, itemId: 'uht_milk', count: 1}]}],
      pickups: [{stack: {itemId: 'chocolate', count: 1}}, {stack: {itemId: 'ration_brick', count: 1}}], holders: {a: {lots: [1, 2]}}, note: 'jerky'};
    expect([...pantryIdsIn(v)].sort()).toEqual(['ration_brick', 'sardines', 'uht_milk']);
    expect(pantryIdsIn(null).size).toBe(0);
  });
});

describe('food variety: persistence (holder memory keeps lot ids only)', () => {
  const realize = (index: number, lots: Lot[], rec?: readonly number[]) => realizeHolderLots(H(index), 'mall', lots, rec) as Lot[];
  const rolled = (index: number) => [lot(index * 1000, 'chocolate', 1, -0.35), lot(index * 1000 + 1, 'chips', 1, 0), lot(index * 1000 + 2, 'cola', 2, 0.2),
    lot(index * 1000 + 3, 'medkit', 2, -0.3), lot(index * 1000 + 4, 'noodles', 1, 0.35)];

  it('fresh -> its captured record -> rebuilt: identical; with taken lots: the rest identical, the taken ones stay gone', () => {
    for (let index = 0; index < 200; index++) {
      const first = realize(index, rolled(index));
      const rec = captureHolder({lots: first, open: true, searched: true});
      expect(realize(index, rolled(index), rec.lots)).toEqual(first);
      // the player took the first and the fourth lot: their ids leave the record; the other lots realize exactly as before
      const left = {...rec, lots: rec.lots.filter((_, i) => i !== 0 && i !== 3)};
      const again = realize(index, rolled(index), left.lots);
      const st = {lots: again, open: true, searched: false};
      applyHolderRecord(st, left, {openable: false, container: false});
      expect(st.lots).toEqual(first.filter((_, i) => i !== 0 && i !== 3));
    }
  });

  it('an OLD record (rolled ids, before this change): exactly its old items — no reroll, no refill, no injection; taken lots stay taken', () => {
    let wouldChange = 0;
    for (let index = 0; index < 200; index++) {
      const base = rolled(index);
      const old = captureHolder({lots: base, open: true, searched: true}); // what an old save remembers: the rolled ids
      if (realize(index, rolled(index)).some((l, i) => l.itemId !== base[i].itemId)) wouldChange++;
      expect(realize(index, rolled(index), old.lots)).toEqual(base);
      const taken = {...old, lots: old.lots.filter((_, i) => i % 2 === 1)};
      const st = {lots: realize(index, rolled(index), taken.lots), open: true, searched: false};
      applyHolderRecord(st, taken, {openable: false, container: false});
      expect(st.lots).toEqual(base.filter((_, i) => i % 2 === 1));
      // an empty old record (everything taken) stays empty
      const gone = {lots: realize(index, rolled(index), []), open: true, searched: true};
      applyHolderRecord(gone, {lots: [], open: true, searched: true}, {openable: false, container: false});
      expect(gone.lots).toEqual([]);
    }
    expect(wouldChange).toBeGreaterThan(100); // (a fresh holder would have varied: the old record is what holds them)
  });

  it('a remembered variant id wins over the current pick (future tuning never mutates a visited holder)', () => {
    const base = rolled(3);
    const rec = [variantLotId(base[0].id, 'honey')!, base[1].id, variantLotId(base[2].id, 'iced_coffee')!, base[3].id, base[4].id];
    const r = realize(3, rolled(3), rec);
    expect(r.map(l => l.itemId)).toEqual(['honey', 'chips', 'iced_coffee', 'medkit', 'noodles']);
    expect(r.map(l => l.id)).toEqual(rec);
  });

  it('through the real ContainerManager.build hook + run/worldMemory capture / apply: a fresh station varies, a revisit is identical, an old save is untouched', () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const layout = rowLayout(['stockShelf', 'stockShelf', 'snackRack', 'shopCooler', 'stockShelf', 'snackRack', 'shopCooler', 'stockShelf', 'shopCounter', 'stockShelf', 'snackRack', 'stockShelf'], {seed: 31});
    for (const p of layout.props) p.purpose = 'convenience';
    const profile = lootProfile('subway');
    const items = (cm: ContainerManager) => cm.all.map(h => h.state.lots.map(l => `${l.id}:${l.itemId}`).join(','));
    const plain = new ContainerManager({}, mats, () => new Inventory());
    plain.build(layout, {}, profile);
    const fresh = new ContainerManager({}, mats, () => new Inventory());
    fresh.build(layout, {}, profile, pantryHolderRealizer('subway', {}, profile));
    // the same lots (count / slots / positions), food varied
    expect(fresh.all.map(h => h.state.lots.length)).toEqual(plain.all.map(h => h.state.lots.length));
    const pairs = fresh.all.flatMap((h, i) => h.state.lots.map((l, j) => [plain.all[i].state.lots[j], l] as const));
    expect(pairs.length).toBeGreaterThan(10);
    for (const [a, b] of pairs) {
      expect([b.x, b.z, b.surface, b.count]).toEqual([a.x, a.z, a.surface, a.count]);
      if (!isPantryBase(a.itemId)) expect(b).toEqual(a);
    }
    expect(pairs.some(([a, b]) => a.itemId !== b.itemId)).toBe(true);
    // the player takes one realized lot of each holder; the section is saved and visited again
    for (const h of fresh.all) if (h.state.lots.length) h.state.lots.shift();
    const recs = captureHolders(fresh);
    const revisit = new ContainerManager({}, mats, () => new Inventory());
    revisit.build(layout, {}, profile, pantryHolderRealizer('subway', recs, profile));
    applyHolders(revisit, recs);
    expect(items(revisit)).toEqual(items(fresh));
    // an OLD save remembered the plain (pre-variety) build with one lot taken per holder: exactly those old items, nothing added
    for (const h of plain.all) if (h.state.lots.length) h.state.lots.shift();
    const oldRecs = captureHolders(plain);
    const oldSave = new ContainerManager({}, mats, () => new Inventory());
    oldSave.build(layout, {}, profile, pantryHolderRealizer('subway', oldRecs, profile));
    applyHolders(oldSave, oldRecs);
    expect(items(oldSave)).toEqual(items(plain));
  });
});

// ---------------------------------------------------------------------------------------------
// census over real generated layouts

describe('food variety: census over real generated layouts of every level', () => {
  it('same lots and food units, much less chocolate, more distinct foods, food / water totals within 10 %; every variant fits', () => {
    const SEEDS: Record<LevelId, number[]> = {subway: [11, 222, 3333, 9120], office: [11, 222, 3333], mall: [5, 61], market: [7], skyways: [3, 47], reactor: [13, 29]};
    const census: Record<string, unknown> = {};
    const checks: [string, boolean][] = [];
    for (const level of LEVEL_IDS) {
      const profile = lootProfile(level);
      const before = new Map<string, number>(), after = new Map<string, number>();
      let lots = 0, food = 0, subst = 0, h0 = 0, t0 = 0, h1 = 0, t1 = 0, holders = 0;
      for (const seed of SEEDS[level] ?? []) {
        const layout = LEVELS[level].generate('main', {levelSeed: seed});
        const hs: LayoutHolderDetail[] = layoutHolderDetails(layout, profile);
        const realizer = pantryHolderRealizer(level, {}, profile);
        holders += hs.length;
        for (const h of hs) {
          const real = realizer({seed: layout.seed, kind: h.kind, index: h.index, areaType: h.areaType, surfaces: h.surfaces, prop: h.prop}, h.lots);
          expect(real.length).toBe(h.lots.length);
          expectSound(real, h.surfaces, `${level}:${seed} ${h.kind}#${h.index}`);
          real.forEach((l, i) => {
            const r = h.lots[i];
            lots++;
            if (!isPantryBase(r.itemId)) { expect(l).toBe(r); return; }
            food++;
            before.set(r.itemId, (before.get(r.itemId) ?? 0) + r.count);
            after.set(l.itemId, (after.get(l.itemId) ?? 0) + l.count);
            expect(l.count).toBe(r.count);
            h0 += (ITEMS[r.itemId].hunger ?? 0) * r.count; t0 += (ITEMS[r.itemId].thirst ?? 0) * r.count;
            h1 += (ITEMS[l.itemId].hunger ?? 0) * l.count; t1 += (ITEMS[l.itemId].thirst ?? 0) * l.count;
            if (l.itemId !== r.itemId) subst++;
          });
        }
        // the first-spawn floor pickups
        layout.pickups.forEach((p, i) => {
          if (!isPantryBase(p.itemId)) return;
          const id = pantryPickupItem(layout, i, level);
          before.set(`floor:${p.itemId}`, (before.get(`floor:${p.itemId}`) ?? 0) + p.count);
          after.set(`floor:${id}`, (after.get(`floor:${id}`) ?? 0) + p.count);
        });
      }
      const sum = (m: Map<string, number>, f: (k: string) => boolean = () => true) => [...m].filter(([k]) => f(k)).reduce((s, [, n]) => s + n, 0);
      const holderUnits = (m: Map<string, number>) => sum(m, k => !k.startsWith('floor:'));
      expect(holderUnits(after), level).toBe(holderUnits(before)); // not more food: the same units
      expect(sum(after), level).toBe(sum(before));
      const foods = (m: Map<string, number>) => [...m].filter(([k, n]) => n > 0 && !k.startsWith('floor:') && itemDef(k).verb === 'eat');
      const choc = (m: Map<string, number>) => (m.get('chocolate') ?? 0) / Math.max(1, foods(m).reduce((s, [, n]) => s + n, 0));
      census[level] = {
        layouts: SEEDS[level], holders, lots, foodDrinkLots: food, substituted: subst,
        chocolateShareOfFood: {before: +choc(before).toFixed(3), after: +choc(after).toFixed(3)},
        distinctFoods: {before: foods(before).length, after: foods(after).length},
        distinctDrinks: {before: [...before].filter(([k]) => !k.startsWith('floor:') && itemDef(k).verb === 'drink').length, after: [...after].filter(([k]) => !k.startsWith('floor:') && itemDef(k).verb === 'drink').length},
        food: {rolled: h0, realized: h1, ratio: +(h1 / Math.max(1, h0)).toFixed(3)}, water: {rolled: t0, realized: t1, ratio: +(t1 / Math.max(1, t0)).toFixed(3)},
        after: Object.fromEntries([...after].sort((a, b) => b[1] - a[1])),
      };
      if (food >= 30) {
        checks.push([`${level} food ratio`, Math.abs(h1 - h0) / h0 < 0.1]);
        if (t0 > 50) checks.push([`${level} water ratio`, Math.abs(t1 - t0) / t0 < 0.1]);
        checks.push([`${level} substituted share`, subst / food > 0.2]);
        checks.push([`${level} distinct foods`, foods(after).length > foods(before).length + 3]);
        if ((before.get('chocolate') ?? 0) >= 20) checks.push([`${level} chocolate share well down (expected x0.3)`, choc(after) < 0.6 * choc(before)]);
      }
    }
    mkdirSync(OUT, {recursive: true});
    writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));
    expect(checks.filter(c => !c[1]).map(c => c[0])).toEqual([]);
  });
});

