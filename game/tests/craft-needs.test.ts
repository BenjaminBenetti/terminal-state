// Task train-interaction-ux-20261112-063646 (lane CRAFT-UI): THE RECIPE LIST'S COUNTS ARE THE CRAFT'S OWN (craft/crafting.ts
// recipeNeeds). User: "Counts must use the same accessible sources and atomic recipe calculation as crafting."
//  - `have` is exactly what the craft may draw on: carried + the worn backpack + the Lockbox + the chests aboard (countMaterials over
//    the craftSources list) and NOTHING else (not a backpack stored inside a box, not a chest that is not aboard, not another item);
//  - for every recipe over many stocks spread over the four places: all needs ok  <=>  planCraft finds a plan  <=>  craft() succeeds;
//    a short need is short by exactly planCraft's `missing`;
//  - the helper changes nothing; a craft lowers `have` by exactly the cost;
//  - the recipe list's rows (ui/craftView.ts craftModel) are built from it.
import {describe, expect, it} from 'vitest';
import {countMaterials, craft, craftSources, planCraft, recipeNeeds, type MaterialSource} from '../src/craft/crafting';
import {RECIPES, RECIPE_MATERIALS, type RecipeMaterial} from '../src/craft/recipes';
import {mulberry32} from '../src/core/rng';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {Inventory} from '../src/items/inventory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {craftModel} from '../src/ui/craftView';
import {fakeEquipment, fakeStore, worldSnapshot} from './helpers/craftBenchFakes';

type Place = 'carried' | 'backpack' | 'lockbox' | 'chestA' | 'chestB';
const PLACES: readonly Place[] = ['carried', 'backpack', 'lockbox', 'chestA', 'chestB'];
type Stock = Record<RecipeMaterial, Record<Place, number>>;

const emptyStock = (): Stock => Object.fromEntries(RECIPE_MATERIALS.map(m => [m, Object.fromEntries(PLACES.map(p => [p, 0]))])) as Stock;
const totalOf = (s: Stock, m: RecipeMaterial) => PLACES.reduce((n, p) => n + s[m][p], 0);

/**
 * A world holding exactly `stock` in the five places a craft may draw on (pockets, the worn backpack, the Lockbox, two chests aboard) —
 * plus plenty of the same materials where a craft may NOT reach: a backpack stored inside the Lockbox, a chest that is not aboard
 * (never handed to craftSources), and other items everywhere.
 */
function world(stock: Stock) {
  const inv = new Inventory(), box = new TrainLockbox();
  const chestA = fakeStore('eq-3'), chestB = fakeStore('eq-12'), away = fakeStore('eq-7');
  const bag = inv.makeStack('backpack', 1);
  expect(inv.wearBag(bag)).toBe(true);
  inv.add(inv.makeStack('bandage', 2));
  inv.add(inv.makeStack(BIO_MATER, 4)); // a material no recipe costs
  bag.bag![5] = inv.makeStack('ammo_9mm', 20);
  let slot = 0;
  for (const m of RECIPE_MATERIALS) {
    const s = stock[m];
    if (s.carried) expect(inv.add(inv.makeStack(m, s.carried))).toBe(0);
    if (s.backpack) bag.bag![slot] = inv.makeStack(m, s.backpack);
    if (s.lockbox) box.slots[slot] = inv.makeStack(m, s.lockbox);
    if (s.chestA) chestA.slots[slot] = inv.makeStack(m, s.chestA);
    if (s.chestB) chestB.slots[40 + slot] = inv.makeStack(m, s.chestB);
    slot++;
  }
  // out of reach: a backpack lying INSIDE the Lockbox with materials in it, a chest left on the platform
  const stored = inv.makeStack('backpack', 1);
  stored.bag![0] = inv.makeStack(SCRAP_METAL, 20);
  stored.bag![1] = inv.makeStack(ELECTRICAL_PARTS, 20);
  box.slots[20] = stored;
  away.slots[0] = inv.makeStack(SCRAP_METAL, 20);
  away.slots[1] = inv.makeStack(ELECTRICAL_PARTS, 20);
  const sources = (): MaterialSource[] => craftSources({inv, lockbox: box, stores: [chestB, chestA]});
  const snap = () => worldSnapshot(inv, [box.slots, chestA.slots, chestB.slots, away.slots, stored.bag!]);
  return {inv, box, sources, snap};
}

/** Stocks around every recipe's edges (exactly enough, one short, split over the places) + seeded random spreads. */
function stocks(): Stock[] {
  const out: Stock[] = [emptyStock()];
  const put = (scrap: number, elec: number, where: (i: number) => Place) => {
    const s = emptyStock();
    for (let i = 0; i < scrap; i++) s[SCRAP_METAL][where(i)]++;
    for (let i = 0; i < elec; i++) s[ELECTRICAL_PARTS][where(i + 2)]++;
    out.push(s);
  };
  for (const r of RECIPES) {
    const a = r.cost[SCRAP_METAL], b = r.cost[ELECTRICAL_PARTS];
    for (const [da, db] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 1], [0, 3]] as const) {
      const x = Math.max(0, a + da), y = Math.max(0, b + db);
      for (const p of PLACES) put(x, y, () => p); // everything in one place
      put(x, y, i => PLACES[i % PLACES.length]); // one unit after the other around the five places
    }
  }
  const rand = mulberry32(0xc4af7);
  for (let n = 0; n < 60; n++) {
    const s = emptyStock();
    for (const m of RECIPE_MATERIALS) for (const p of PLACES) if (rand() < 0.45) s[m][p] = Math.floor(rand() * 6);
    out.push(s);
  }
  return out;
}

describe('recipe needs: the list counts what the craft pays from', () => {
  it('lists exactly the materials a recipe costs, in the recipe materials\' order, with the cost as `need`', () => {
    const w = world(emptyStock());
    for (const r of RECIPES) {
      const needs = recipeNeeds(r, w.sources());
      expect(needs.map(n => n.id), r.kind).toEqual(RECIPE_MATERIALS.filter(m => r.cost[m] > 0));
      for (const n of needs) expect(n.need).toBe(r.cost[n.id]);
    }
    expect(recipeNeeds(RECIPES.find(r => r.kind === 'chest')!, w.sources()).map(n => n.id)).toEqual([SCRAP_METAL]); // (no electrical parts: no entry)
  });

  it('`have` = carried + the worn backpack + the Lockbox + the chests aboard, nothing else — and it is countMaterials\' total', () => {
    const stock = emptyStock();
    stock[SCRAP_METAL] = {carried: 1, backpack: 2, lockbox: 3, chestA: 4, chestB: 5};
    stock[ELECTRICAL_PARTS] = {carried: 0, backpack: 0, lockbox: 2, chestA: 0, chestB: 1};
    const w = world(stock), src = w.sources(), counts = countMaterials(src);
    for (const r of RECIPES) {
      for (const n of recipeNeeds(r, src)) {
        expect(n.have, `${r.kind} ${n.id}`).toBe(totalOf(stock, n.id)); // (the 20 + 20 stored in a boxed backpack, the 20 + 20 in a chest away: not counted)
        expect(n.have).toBe(counts[n.id].total);
        expect(n.where).toEqual(counts[n.id]);
        expect([n.where.carried, n.where.backpack, n.where.lockbox, n.where.chests]).toEqual([stock[n.id].carried, stock[n.id].backpack, stock[n.id].lockbox, stock[n.id].chestA + stock[n.id].chestB]);
        expect(n.ok).toBe(n.have >= n.need);
      }
    }
    expect(totalOf(stock, SCRAP_METAL)).toBe(15);
    // handing the counts in (several recipes over one source list) is the same answer
    for (const r of RECIPES) expect(recipeNeeds(r, src, counts)).toEqual(recipeNeeds(r, src));
  });

  it('for every recipe over varied stocks: all needs ok <=> planCraft finds a plan <=> the craft goes through; short by planCraft\'s `missing`', () => {
    const all = stocks();
    expect(all.length).toBeGreaterThan(200);
    let craftable = 0, refused = 0;
    for (const [i, stock] of all.entries()) {
      for (const r of RECIPES) {
        const w = world(stock), src = w.sources(), tag = `stock ${i} ${r.kind}`;
        const before = w.snap();
        const needs = recipeNeeds(r, src), plan = planCraft(r, src);
        // the helper (and the plan) change nothing
        const after = w.snap();
        expect(after.json, tag).toBe(before.json);
        after.refs.forEach((st, k) => expect(st === before.refs[k], tag).toBe(true));
        // one truth
        const allOk = needs.every(n => n.ok);
        expect(allOk, tag).toBe(plan.ok);
        for (const n of needs) {
          expect(n.have, tag).toBe(totalOf(stock, n.id));
          if (plan.ok) expect(plan.takes.filter(t => t.material === n.id).reduce((sum, t) => sum + t.n, 0), tag).toBe(n.need); // drawn: exactly the need, all of it from what was counted
          else expect(plan.missing[n.id] ?? 0, tag).toBe(Math.max(0, n.need - n.have));
        }
        // ... and the transaction itself agrees
        const eq = fakeEquipment(), res = craft(r, {sources: src, equipment: eq});
        expect(res.ok, tag).toBe(allOk);
        const then = recipeNeeds(r, w.sources());
        then.forEach((n, k) => expect(n.have, tag).toBe(needs[k].have - (res.ok ? n.need : 0)));
        if (res.ok) craftable++; else { refused++; expect(w.snap().json, tag).toBe(before.json); }
      }
    }
    expect(craftable).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it('the recipe list is built from it: a row\'s chips are the needs, its button is the plan (and the equipment system\'s answer)', () => {
    const rand = mulberry32(0xbe7c4);
    for (const stock of stocks().filter(() => rand() < 0.2)) {
      const src = world(stock).sources();
      for (const blocked of [false, true]) {
        const m = craftModel(src, () => (blocked ? 'No room on the car floor — move something first' : null));
        RECIPES.forEach((r, i) => {
          const needs = recipeNeeds(r, src);
          expect(m.rows[i].needs.map(n => [n.material, n.have, n.need, n.state])).toEqual(needs.map(n => [n.id, n.have, n.need, n.ok ? 'ok' : 'short']));
          expect(m.rows[i].can).toBe(planCraft(r, src).ok && !blocked);
        });
      }
    }
  });
});
