// Task studio-food-drink-half-20261109-201124-01: HALF the natural food / drink spawn on every level (user: "food spawn rate is to high …
// lets cut food / drink spawn in half. 50% reduction"). items/naturalFood.ts + run/worldMemory.ts dropNaturalFood + game.ts buildSection.
//  - what counts: the economy's own food / drink classification (old items, bread, the Skyways ramen food, the 24 pantry items); every
//    edible that real generated layouts of every level place is covered; nothing else is touched;
//  - the gate: pure, deterministic per origin and seed, idempotent, independent of the food-variety variant, keeps ~50 % (expected exactly
//    NATURAL_FOOD_KEEP per find);
//  - the real ContainerManager.build + run/worldMemory path: non-food lots are the very same objects, kept food lots unchanged (id / item /
//    count / spot), a revisit is identical (never halved twice), an OLD save keeps exactly its remembered food, a new holder in an old
//    campaign is gated;
//  - floor pickups: the yaw stream is drawn before the skip, non-food / curated pickups always spawn;
//  - a census over real generated layouts of every level: food and drink units each ~0.5 of before, non-food unchanged (written to
//    /tmp/food-half/census.json).
import {describe, expect, it} from 'vitest';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ITEMS, itemDef} from '../src/items/items';
import {PANTRY_IDS} from '../src/items/pantryFood';
import {pantryHolderRealizer, pantryPickupItem, variantLotId} from '../src/items/pantryVariety';
import {NATURAL_FOOD_KEEP, holderFoodOrigin, isNaturalFood, keepLayoutPickup, keepNaturalFood, pickupFoodOrigin} from '../src/items/naturalFood';
import {econCat, lootProfile} from '../src/items/lootTables';
import {holderKey} from '../src/run/memory';
import {LEVEL_IDS, LEVELS} from '../src/levels/registry';
import {sectionId, type LevelId} from '../src/levels/types';
import type {Lot} from '../src/items/loot';
import {layoutHolderDetails} from './helpers/lootEconomy';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, rowLayout} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {Inventory} from '../src/items/inventory';
import {applyHolders, captureHolders, dropNaturalFood, holderKeyOf} from '../src/run/worldMemory';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const OUT = '/tmp/food-half';
const edible = (id: string) => itemDef(id).verb === 'eat' || itemDef(id).verb === 'drink';

describe('natural food half: classification and the gate', () => {
  it('every food / drink of the economy counts (old items, bread, ramen food, all 24 pantry items); ammo, medicine, gear and materials never do', () => {
    for (const id of Object.keys(ITEMS)) {
      const c = econCat(id);
      expect(isNaturalFood(id), id).toBe(c === 'food' || c === 'drink');
    }
    for (const id of [...PANTRY_IDS, 'chocolate', 'chips', 'beans', 'noodles', 'bread', 'water', 'cola', 'juice']) expect(isNaturalFood(id), id).toBe(true);
    for (const id of ['ammo_9mm', 'bandage', 'medkit', 'battery', 'flare', 'fuel_can', 'gas_mask']) if (ITEMS[id]) expect(isNaturalFood(id), id).toBe(false);
  });

  it('pure and deterministic per origin and seed; keeps NATURAL_FOOD_KEEP (0.5) of 40 000 origins (+-1 %); seeds decide independently', () => {
    expect(NATURAL_FOOD_KEEP).toBe(0.5);
    let kept = 0, agree = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const o = holderFoodOrigin('subway:main', `stockShelf@0:${i * 37},${i * 11}`, i % 13);
      const k = keepNaturalFood(1234, o);
      expect(keepNaturalFood(1234, o)).toBe(k);
      if (k) kept++;
      if (keepNaturalFood(98765, o) === k) agree++;
    }
    expect(Math.abs(kept / N - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(agree / N - 0.5)).toBeLessThan(0.01); // another run's seed: an independent decision
  });

  it('a food-variety variant decides exactly like its rolled lot (the decision never depends on which variant a lot became)', () => {
    for (let id = 0; id < 3000; id += 7) {
      for (const v of ['honey', 'iced_coffee', 'corned_beef']) {
        const vid = variantLotId(id, v)!;
        expect(holderFoodOrigin('mall:main', 'shelf@1:5,5', vid)).toBe(holderFoodOrigin('mall:main', 'shelf@1:5,5', id));
      }
    }
  });

  it('floor pickups: non-food and curated (reward) pickups always spawn; food / drink about half, per layout index', () => {
    let kept = 0;
    for (let i = 0; i < 4000; i++) {
      expect(keepLayoutPickup(77, 'office:floor-3', i, {itemId: 'ammo_9mm'})).toBe(true);
      expect(keepLayoutPickup(77, 'office:floor-3', i, {itemId: 'water', reward: 'roof-find'})).toBe(true);
      const k = keepLayoutPickup(77, 'office:floor-3', i, {itemId: i % 2 ? 'water' : 'chocolate'});
      expect(k).toBe(keepNaturalFood(77, pickupFoodOrigin('office:floor-3', i)));
      if (k) kept++;
    }
    expect(Math.abs(kept / 4000 - 0.5)).toBeLessThan(0.03);
  });
});

describe('natural food half: through the real ContainerManager.build + run/worldMemory path', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const kinds = ['stockShelf', 'stockShelf', 'snackRack', 'shopCooler', 'stockShelf', 'snackRack', 'shopCooler', 'stockShelf', 'shopCounter', 'stockShelf', 'snackRack', 'stockShelf'] as const;
  const SID = 'subway:main';
  const profile = lootProfile('subway');
  const snap = (cm: ContainerManager) => cm.all.map(h => h.state.lots.map(l => `${l.id}:${l.itemId}:${l.count}:${l.surface}:${l.x.toFixed(4)},${l.z.toFixed(4)}`));
  const built = (seed: number, recs: Parameters<typeof applyHolders>[1] = {}) => {
    const layout = rowLayout([...kinds], {seed});
    for (const p of layout.props) p.purpose = 'convenience';
    const cm = new ContainerManager({}, mats, () => new Inventory());
    cm.build(layout, {}, profile, pantryHolderRealizer('subway', recs, profile));
    applyHolders(cm, recs);
    return {cm, layout};
  };

  it('a fresh section: non-food lots are the very same objects; kept food lots unchanged; only food / drink is dropped, about half', () => {
    let food = 0, keptFood = 0, nonFood = 0;
    for (const seed of [31, 32, 33, 34, 35, 36, 37, 38]) {
      const {cm, layout} = built(seed);
      const before = cm.all.map(h => [...h.state.lots]);
      const dropped = dropNaturalFood(cm, {}, layout.seed, SID, profile);
      cm.all.forEach((h, i) => {
        const was = before[i];
        expect(h.state.lots.every(l => was.includes(l)), 'kept lots are the same objects').toBe(true);
        expect(h.state.lots.map(l => was.indexOf(l))).toEqual([...h.state.lots.map(l => was.indexOf(l))].sort((a, b) => a - b)); // order kept
        for (const l of was) {
          const stays = h.state.lots.includes(l);
          if (!isNaturalFood(l.itemId)) { expect(stays, `${l.itemId} stays`).toBe(true); nonFood++; continue; }
          food++;
          if (stays) keptFood++;
          expect(stays).toBe(keepNaturalFood(layout.seed, holderFoodOrigin(SID, holderKeyOf(h), l.id)));
        }
      });
      expect(dropped).toBe(before.flat().length - cm.all.flatMap(h => h.state.lots).length);
      // idempotent: the gate never halves twice
      expect(dropNaturalFood(cm, {}, layout.seed, SID, profile)).toBe(0);
    }
    expect(food).toBeGreaterThan(60);
    expect(nonFood).toBeGreaterThan(0);
    expect(keptFood / food).toBeGreaterThan(0.35);
    expect(keptFood / food).toBeLessThan(0.65);
  });

  it('a revisit is identical (the record decides, nothing halved again); taken lots stay taken', () => {
    for (const seed of [41, 42, 43]) {
      const {cm, layout} = built(seed);
      dropNaturalFood(cm, {}, layout.seed, SID, profile);
      for (const h of cm.all) if (h.state.lots.length > 1) h.state.lots.pop(); // the player took one lot here and there
      const recs = captureHolders(cm);
      const again = built(seed, recs);
      expect(dropNaturalFood(again.cm, recs, again.layout.seed, SID, profile)).toBe(0);
      expect(snap(again.cm)).toEqual(snap(cm));
    }
  });

  it('an OLD save (remembered before this change, full food) keeps exactly its remembered food; a NEW holder of an old campaign is gated', () => {
    for (const seed of [51, 52, 53]) {
      const old = built(seed); // the pre-change realization (no gate): what an old save remembers
      const oldRecs = captureHolders(old.cm);
      const load = built(seed, oldRecs);
      expect(dropNaturalFood(load.cm, oldRecs, load.layout.seed, SID, profile)).toBe(0);
      expect(snap(load.cm)).toEqual(snap(old.cm));
      // the same old save, but one holder was never realized in it (a new area of the campaign): only that one is gated
      const keys = Object.keys(oldRecs);
      const fresh = keys.find((_, i) => old.cm.all[i].state.lots.filter(l => isNaturalFood(l.itemId)).length >= 2) ?? keys[0];
      const partial = Object.fromEntries(keys.filter(k => k !== fresh).map(k => [k, oldRecs[k]]));
      const mixed = built(seed, partial);
      dropNaturalFood(mixed.cm, partial, mixed.layout.seed, SID, profile);
      mixed.cm.all.forEach((h, i) => {
        const k = holderKeyOf(h);
        if (k !== fresh) { expect(snap(mixed.cm)[i]).toEqual(snap(old.cm)[i]); return; }
        const want = old.cm.all[i].state.lots.filter(l => !isNaturalFood(l.itemId) || keepNaturalFood(mixed.layout.seed, holderFoodOrigin(SID, k, l.id)));
        expect(h.state.lots.map(l => l.id)).toEqual(want.map(l => l.id));
      });
    }
  });
});

describe('natural food half: game.ts wiring (source order)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
  it('holders: gated after the fuel lots, the shelf filler and applyHolders (both see the holder as before)', () => {
    const at = (s: string) => { const i = src.indexOf(s); expect(i, s).toBeGreaterThan(0); return i; };
    const gate = at('dropNaturalFood(cm, mem.holders, this.layout.seed, mem.id, lootProfile(key.level));');
    expect(at('h.holders?.(this.layout)')).toBeLessThan(gate);
    expect(at('this.stock.build(this.layout')).toBeLessThan(gate);
    expect(at('applyHolders(cm, mem.holders);')).toBeLessThan(gate);
  });
  it('floor pickups: the yaw is drawn before the skip (every other pickup keeps its stream); first spawns only', () => {
    const loop = src.slice(src.indexOf('for (const i of plan.fromLayout) {'), src.indexOf('for (const rec of plan.restored) {'));
    const yaw = loop.indexOf('const yaw = this.rand() * Math.PI * 2;'), skip = loop.indexOf('if (!keepLayoutPickup(this.layout.seed, mem.id, i, p)) continue;'), make = loop.indexOf('makeStack(pantryPickupItem(');
    expect(yaw).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(yaw);
    expect(make).toBeGreaterThan(skip);
  });
});

// ---------------------------------------------------------------------------------------
// census over real generated layouts

describe('natural food half: census over real generated layouts of every level', () => {
  it('food and drink units each ~0.5 of before (expected exactly 0.5 per find), every edible covered, non-food untouched', () => {
    const SEEDS: Record<LevelId, number[]> = {subway: [11, 222, 3333, 9120], office: [11, 222, 3333], mall: [5, 61], market: [7], bunker: [17], skyways: [3, 47], reactor: [13, 29]};
    type Tally = {lots: number; units: number; keptLots: number; keptUnits: number};
    const zero = (): Tally => ({lots: 0, units: 0, keptLots: 0, keptUnits: 0});
    const add = (t: Tally, n: number, kept: boolean) => { t.lots++; t.units += n; if (kept) { t.keptLots++; t.keptUnits += n; } };
    const census: Record<string, unknown> = {};
    const pooled = {food: zero(), drink: zero()};
    const checks: [string, boolean][] = [];
    for (const level of LEVEL_IDS) {
      const profile = lootProfile(level);
      const sid = sectionId({level, section: 'main'});
      const t = {food: zero(), drink: zero(), floorFood: zero(), floorDrink: zero()};
      let nonFoodLots = 0, nonFoodPickups = 0, uncovered = 0;
      for (const seed of SEEDS[level] ?? []) {
        const layout = LEVELS[level].generate('main', {levelSeed: seed});
        const realize = pantryHolderRealizer(level, {}, profile);
        for (const h of layoutHolderDetails(layout, profile)) {
          const key = holderKey(h.kind, h.prop.level, h.prop.x, h.prop.z);
          for (const l of realize({seed: layout.seed, kind: h.kind, index: h.index, areaType: h.areaType, surfaces: h.surfaces, prop: h.prop}, h.lots) as Lot[]) {
            if (!isNaturalFood(l.itemId)) { nonFoodLots++; if (edible(l.itemId)) uncovered++; continue; }
            const kept = keepNaturalFood(layout.seed, holderFoodOrigin(sid, key, l.id));
            add(econCat(l.itemId) === 'food' ? t.food : t.drink, l.count, kept);
          }
        }
        layout.pickups.forEach((p, i) => {
          const id = pantryPickupItem(layout, i, level);
          const kept = keepLayoutPickup(layout.seed, sid, i, p);
          if (!isNaturalFood(id)) { nonFoodPickups++; if (edible(id)) uncovered++; expect(kept, `${level} pickup ${id}`).toBe(true); return; }
          if (p.reward) { expect(kept).toBe(true); return; }
          add(econCat(id) === 'food' ? t.floorFood : t.floorDrink, p.count, kept);
        });
      }
      expect(uncovered, `${level}: an edible find outside the food / drink classification`).toBe(0);
      const food = {lots: t.food.lots + t.floorFood.lots, units: t.food.units + t.floorFood.units, keptLots: t.food.keptLots + t.floorFood.keptLots, keptUnits: t.food.keptUnits + t.floorFood.keptUnits};
      const drink = {lots: t.drink.lots + t.floorDrink.lots, units: t.drink.units + t.floorDrink.units, keptLots: t.drink.keptLots + t.floorDrink.keptLots, keptUnits: t.drink.keptUnits + t.floorDrink.keptUnits};
      for (const [k, v] of [['food', food], ['drink', drink]] as const) {
        pooled[k].lots += v.lots; pooled[k].units += v.units; pooled[k].keptLots += v.keptLots; pooled[k].keptUnits += v.keptUnits;
      }
      const both = food.units + drink.units, keptBoth = food.keptUnits + drink.keptUnits;
      const r = (a: number, b: number) => (b ? +(a / b).toFixed(3) : null);
      census[level] = {
        layouts: SEEDS[level], expectedKeep: NATURAL_FOOD_KEEP,
        holderFood: t.food, holderDrink: t.drink, floorFood: t.floorFood, floorDrink: t.floorDrink,
        foodUnits: {before: food.units, after: food.keptUnits, ratio: r(food.keptUnits, food.units)},
        drinkUnits: {before: drink.units, after: drink.keptUnits, ratio: r(drink.keptUnits, drink.units)},
        foodAndDrinkUnits: {before: both, after: keptBoth, ratio: r(keptBoth, both)},
        nonFood: {holderLots: nonFoodLots, pickups: nonFoodPickups, changed: 0},
      };
      if (food.lots + drink.lots >= 40) checks.push([`${level} food + drink units ratio in [0.35, 0.65]`, keptBoth / both >= 0.35 && keptBoth / both <= 0.65]);
    }
    const total = {lots: pooled.food.lots + pooled.drink.lots, units: pooled.food.units + pooled.drink.units, kept: pooled.food.keptUnits + pooled.drink.keptUnits};
    census.all = {food: pooled.food, drink: pooled.drink, foodRatio: +(pooled.food.keptUnits / pooled.food.units).toFixed(3),
      drinkRatio: +(pooled.drink.keptUnits / pooled.drink.units).toFixed(3), ratio: +(total.kept / total.units).toFixed(3), expectedKeep: NATURAL_FOOD_KEEP};
    checks.push(['pooled food units ratio in [0.42, 0.58]', Math.abs(pooled.food.keptUnits / pooled.food.units - 0.5) <= 0.08]);
    checks.push(['pooled drink units ratio in [0.42, 0.58]', Math.abs(pooled.drink.keptUnits / pooled.drink.units - 0.5) <= 0.08]);
    checks.push(['pooled food + drink units ratio in [0.45, 0.55]', Math.abs(total.kept / total.units - 0.5) <= 0.05]);
    expect(total.lots).toBeGreaterThan(400);
    mkdirSync(OUT, {recursive: true});
    writeFileSync(`${OUT}/census.json`, JSON.stringify(census, null, 1));
    expect(checks.filter(c => !c[1]).map(c => c[0])).toEqual([]);
  });
});
