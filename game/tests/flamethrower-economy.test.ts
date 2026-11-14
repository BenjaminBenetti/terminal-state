// Task studio-flamethrower-fire-20261114-031614-01 (lane ECON): the flamethrower and its wearable fuel tank as ITEMS of the economy.
// User: "flamethrower (5 scrap metal + 3 electrical parts) and wearable tank (1 bio mater + 1 normal fuel can + 2 scrap metal). Crafting
// OR normal Market vendors ONLY: no random loot, gun-pool additions or supply retuning … crafted tanks start with EXACTLY recipe fuel …
// no free fuel or fuel loss." Covered here (focused, Node; the Market side is tests/flamethrower-market.test.ts, the tank's fuel through
// every copy / store / save tests/fuel-tank-state.test.ts):
//  - the registries: both are items with a damage class and loose-item physics of their own; the dev grant never hands them out;
//  - NEVER LOOT: neither id is in any loot table, pool, weight map, weapon-find leaf or starter kit (the exported data of the loot
//    modules walked whole, the generators' sources scanned, the rolls sampled), and the weapon pool version is what it was;
//  - the two bench recipes — exactly the user's costs, appended after every older row, the ordinary fuel can as a recipe input — and
//    that the tank recipe's cans ARE the new tank's fuel (FLAME_FUEL.newCans in, FLAME_FUEL.newUnits in the tank);
//  - the craft transaction: one item out for exactly its cost, drawn from the usual sources (carried, the worn backpack, the Lockbox,
//    a chest); the tank is worn when the back is free, else pocketed, else put in the Lockbox, always with exactly its recipe's fuel;
//    no room / a missing can / a failed delivery change nothing (the can and the materials are back in their very stacks);
//  - the texts: a stream weapon shows no magazine count, its tooltip says what it burns and what is on the back; the tank's shows its
//    fuel; the ordinary fuel can's says what it is for.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {FLAMETHROWER_ID, FLAME_FUEL, FLAME_FUEL_CAN, FUEL_TANK_ID} from '../src/fire/flamethrowerSpec';
import {tankFuel, wornFuelTank} from '../src/fire/fuelTank';
import {MADE_TEXT, carriedRoom, craftMade, craftSources, lockboxRoom, madeBlock, planCraft, recipeNeeds} from '../src/craft/crafting';
import {BENCH_RECIPES, MADE_RECIPES, RECIPES, RECIPE_MATERIALS, benchRecipeFor, isMadeRecipe, type MadeRecipe} from '../src/craft/recipes';
import {ITEM_CLASS, ITEM_PHYSICS, itemClass, itemPhysics} from '../src/damage/materials';
import * as gearLoot from '../src/gen/gearLoot';
import * as maskLoot from '../src/gen/maskLoot';
import * as weaponFinds from '../src/gen/weaponFinds';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {devGrantBundle, grantText} from '../src/items/devGrant';
import {FLAMETHROWER_CLASS, FLAMETHROWER_PHYSICS} from '../src/items/flamethrowerItems';
import {GEAR_SLOTS} from '../src/items/gear';
import {Inventory, PACK_SIZE, stackToJSON, type ItemStack, type SlotRef} from '../src/items/inventory';
import {ITEMS, itemDef} from '../src/items/items';
import * as loot from '../src/items/loot';
import * as lootTables from '../src/items/lootTables';
import * as weaponVariety from '../src/items/weaponVariety';
import type {LevelId} from '../src/levels/types';
import {starterInventory} from '../src/run/starter';
import {TrainLockbox} from '../src/run/trainLockbox';
import {fuelText, itemTip, itemTipLines, noMagazine, streamText, supplyText} from '../src/ui/itemTip';
import {WEAPONS} from '../src/weapons/weapons';
import {fakeStore} from './helpers/craftBenchFakes';

const IDS: readonly string[] = [FLAMETHROWER_ID, FUEL_TANK_ID];
const BACK = GEAR_SLOTS.indexOf('backpack');
const P = (index: number): SlotRef => ({bar: 'pack', index});
const H = (index: number): SlotRef => ({bar: 'hotbar', index});

/**
 * Every place (a path) where a string equal to one of `ids` sits in plain data: a value, an object key, a Set / Map member. Functions
 * are not walked (the rolls below call them).
 */
function mentions(v: unknown, ids: readonly string[], path = '', seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof v === 'string') { if (ids.includes(v)) out.push(path); return out; }
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (v instanceof Set) { for (const x of v) mentions(x, ids, `${path}{}`, seen, out); return out; }
  if (v instanceof Map) { for (const [k, x] of v) { mentions(k, ids, `${path}<key>`, seen, out); mentions(x, ids, `${path}.${String(k)}`, seen, out); } return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => mentions(x, ids, `${path}[${i}]`, seen, out)); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (ids.includes(k)) out.push(`${path}.${k} (key)`);
    mentions(x, ids, `${path}.${k}`, seen, out);
  }
  return out;
}

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
/** Every .ts file under a source directory (relative paths). */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(`${SRC}${dir}`)) {
    const rel = `${dir}/${name}`;
    if (statSync(`${SRC}${rel}`).isDirectory()) out.push(...sourcesUnder(rel));
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

describe('the two items in the registries', () => {
  it('a stream weapon without a magazine and a back-slot tank; each has its own damage class and loose-item physics', () => {
    expect(ITEMS[FLAMETHROWER_ID]).toMatchObject({id: FLAMETHROWER_ID, kind: 'weapon', stackMax: 1, weaponId: FLAMETHROWER_ID});
    expect(WEAPONS[FLAMETHROWER_ID]).toMatchObject({magazine: 0, stream: {unitSeconds: FLAME_FUEL.unitSeconds, refillTime: FLAME_FUEL.refillSeconds}});
    expect(WEAPONS[FLAMETHROWER_ID].caliber).toBeUndefined();
    expect(ITEMS[FUEL_TANK_ID]).toMatchObject({id: FUEL_TANK_ID, kind: 'gear', stackMax: 1, gear: {slot: 'backpack', fuelCap: FLAME_FUEL.capacity}});
    for (const id of IDS) {
      // (own entries: never the registry's defaults for an unlisted item)
      expect(Object.prototype.hasOwnProperty.call(ITEM_CLASS, id), id).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(ITEM_PHYSICS, id), id).toBe(true);
      expect(itemPhysics(id).mass, id).toBeGreaterThan(0);
    }
    expect([itemClass(FLAMETHROWER_ID), itemClass(FUEL_TANK_ID)]).toEqual([FLAMETHROWER_CLASS, 'steel']);
    expect(itemPhysics(FLAMETHROWER_ID)).toEqual(FLAMETHROWER_PHYSICS);
    expect(itemPhysics(FUEL_TANK_ID)).toEqual({mass: 9, shape: 'box', mat: 'heavy'});
    expect(itemPhysics(FUEL_TANK_ID).mass).toBeGreaterThan(itemPhysics(FLAMETHROWER_ID).mass); // (a jerrycan with fuel on a welded frame)
  });

  it('the dev grant never hands them out (bench / Market only): every other ranged gun and worn piece is still in it', () => {
    const ids = devGrantBundle().map(l => l.itemId);
    for (const id of IDS) expect(ids, id).not.toContain(id);
    expect(grantText()).not.toMatch(/flamethrower|fuel tank/i);
    const guns = Object.values(ITEMS).filter(d => d.kind === 'weapon' && !WEAPONS[d.weaponId!].melee && d.id !== FLAMETHROWER_ID).map(d => d.id);
    for (const id of [...guns, 'armor_vest', 'chest_rig', 'backpack', 'helmet', 'boots', 'gloves', 'gas_mask']) expect(ids, id).toContain(id);
  });
});

describe('never loot: bench or Market only', () => {
  it('the walker sees table rows, weight keys and leaf lists (it finds what IS loot)', () => {
    expect(mentions(lootTables, ['airtank_backpack']).some(p => /GEAR_WEIGHTS\.airtank_backpack \(key\)/.test(p))).toBe(true);
    expect(mentions(lootTables, ['bandage']).length).toBeGreaterThan(20);
    expect(mentions(weaponVariety, ['turnstile']).length).toBeGreaterThan(0);
    expect(mentions(weaponFinds, ['shotgun']).some(p => /WEAPON_FIND_AMMO\.shotgun \(key\)/.test(p))).toBe(true);
    expect(mentions(maskLoot, ['gas_mask']).length).toBeGreaterThan(0);
    expect(mentions({a: new Set(['x']), b: new Map([['k', ['y']]])}, ['x', 'y', 'k'])).toEqual(['.a{}', '.b<key>', '.b.k[0]']);
  });

  it('neither id is anywhere in the loot modules\' data: tables, pools, weights, reward finds, weapon-find leaves, mask / gear loot', () => {
    const modules = {lootTables, loot, weaponVariety, weaponFinds, gearLoot, maskLoot};
    for (const [name, m] of Object.entries(modules)) expect(mentions(m, IDS), name).toEqual([]);
    // the maps a new gear / gun item would have to join to be rolled
    expect(Object.keys(lootTables.GEAR_WEIGHTS).sort()).toEqual(['airtank_backpack', 'armor_vest', 'backpack', 'boots', 'chest_rig', 'gloves', 'helmet']);
    expect([...weaponVariety.GUN_LEAVES]).toEqual(['pistol', 'hornet', 'longslide', 'rifle', 'stub', 'overwatch', 'shotgun', 'coach_gun', 'thresher', 'turnstile']);
    expect(weaponVariety.MELEE_LEAVES).not.toContain(FLAMETHROWER_ID);
    expect(Object.keys(weaponFinds.WEAPON_FIND_AMMO).sort()).toEqual(['pistol', 'rifle', 'shotgun']);
    expect(weaponVariety.WEAPON_POOL_VERSION).toBe(2); // (no gun-pool addition: the pool is the one that added the Turnstile)
  });

  it('no generator, level, loot or starter source names either item', () => {
    const files = [...sourcesUnder('gen'), ...sourcesUnder('levels'), 'items/loot.ts', 'items/lootTables.ts', 'items/lootEconomy.ts', 'items/naturalFood.ts', 'items/pantryVariety.ts',
      'items/weaponVariety.ts', 'items/weaponVarietyItems.ts', 'run/starter.ts', 'world/containers.ts', 'world/openablesSpec.ts'];
    expect(files.length).toBeGreaterThan(100);
    const named = files.filter(f => /flamethrower|fuel_tank|FUEL_TANK_ID|flame_?fuel/i.test(readFileSync(`${SRC}${f}`, 'utf8')));
    expect(named).toEqual([]);
  });

  it('the rolls never give one: level gear, mask loot, every weapon slot of every pool version, the weapon finds, both starter kits', () => {
    const levels = Object.keys(lootTables.PROFILES) as LevelId[];
    expect(levels.length).toBeGreaterThanOrEqual(7);
    const rolled = new Set<string>();
    for (const level of levels) {
      for (let seed = 1; seed <= 150; seed++) {
        for (const a of Object.values(gearLoot.rollLevelGear(seed * 7919, level, ['main', 'b', 'c'])).flat()) rolled.add(a.itemId);
        for (const a of Object.values(maskLoot.rollMaskLoot(seed * 7919, level, ['main', 'b', 'c'])).flat()) rolled.add(a.itemId);
      }
    }
    expect(rolled.has('backpack') && rolled.has('airtank_backpack')).toBe(true); // (the sample does reach the gear pool)
    for (const kind of ['weapon', 'gun', 'pistol', 'rifle', 'shotgun', 'melee'] as const) {
      for (let pool = 1; pool <= weaponVariety.WEAPON_POOL_VERSION + 1; pool++) for (const [id] of weaponVariety.slotRows(kind, pool)) rolled.add(id);
    }
    for (const start of ['rifle', 'pistol'] as const) {
      for (const id of weaponFinds.findWeaponsFor(start)) rolled.add(id);
      const kit = starterInventory(start);
      for (const s of kit.allStacks(true)) rolled.add(s.itemId);
      expect(kit.gearSlots.every(s => s === null), start).toBe(true);
    }
    expect(rolled.has('turnstile') && rolled.has('knife')).toBe(true);
    for (const id of IDS) expect(rolled.has(id), id).toBe(false);
  });
});

describe('the bench recipes', () => {
  const flame = benchRecipeFor(FLAMETHROWER_ID) as MadeRecipe, tankR = benchRecipeFor(FUEL_TANK_ID) as MadeRecipe;

  it('exactly the user\'s costs; listed after every older row, whose costs and order are unchanged', () => {
    expect(flame).toMatchObject({kind: FLAMETHROWER_ID, make: {type: 'item', itemId: FLAMETHROWER_ID, count: 1},
      cost: {[SCRAP_METAL]: 5, [ELECTRICAL_PARTS]: 3, [BIO_MATER]: 0, [FLAME_FUEL_CAN]: 0}});
    expect(tankR).toMatchObject({kind: FUEL_TANK_ID, make: {type: 'item', itemId: FUEL_TANK_ID, count: 1},
      cost: {[SCRAP_METAL]: 2, [ELECTRICAL_PARTS]: 0, [BIO_MATER]: 1, [FLAME_FUEL_CAN]: 1}});
    expect(isMadeRecipe(flame) && isMadeRecipe(tankR)).toBe(true);
    expect(BENCH_RECIPES.map(r => r.kind)).toEqual([...RECIPES.map(r => r.kind), 'acid_grenade', 'lure_grenade', 'armor', FLAMETHROWER_ID, FUEL_TANK_ID]);
    expect(MADE_RECIPES.slice(-2)).toEqual([flame, tankR]);
    // the fuel can is the fourth recipe input; nothing older costs one, and every cost names all four
    expect([...RECIPE_MATERIALS]).toEqual([SCRAP_METAL, ELECTRICAL_PARTS, BIO_MATER, FLAME_FUEL_CAN]);
    expect(ITEMS[FLAME_FUEL_CAN]).toMatchObject({id: 'fuel_can', kind: 'supply'});
    for (const r of BENCH_RECIPES) {
      expect(Object.keys(r.cost), r.kind).toEqual([...RECIPE_MATERIALS]);
      if (r !== tankR) expect(r.cost[FLAME_FUEL_CAN], r.kind).toBe(0);
      for (const m of RECIPE_MATERIALS) expect(Number.isInteger(r.cost[m]) && r.cost[m] >= 0, `${r.kind}:${m}`).toBe(true);
    }
    for (const r of [flame, tankR]) { expect(r.name).toBe(r === flame ? 'Flamethrower' : itemDef(FUEL_TANK_ID).name); expect(r.blurb.length).toBeGreaterThan(40); }
    expect(flame.blurb).toMatch(/fuel tank on your back/i);
    expect(tankR.blurb).toMatch(/fuel can/i);
  });

  it('the tank recipe\'s fuel cans ARE the new tank\'s fuel: cans in × units a can = the units in the tank it makes', () => {
    expect(tankR.cost[FLAME_FUEL_CAN]).toBe(FLAME_FUEL.newCans);
    expect(tankR.cost[FLAME_FUEL_CAN] * FLAME_FUEL.unitsPerCan).toBe(FLAME_FUEL.newUnits);
    expect(new Inventory().makeStack(FUEL_TANK_ID, 1).fuel).toBe(tankR.cost[FLAME_FUEL_CAN] * FLAME_FUEL.unitsPerCan);
    expect(FLAME_FUEL.newUnits).toBeLessThanOrEqual(FLAME_FUEL.capacity);
    expect(flame.cost[FLAME_FUEL_CAN]).toBe(0); // (the flamethrower holds no fuel of its own)
    // the bench list's "have / need" chips name the can for the tank only
    const src = craftSources({inv: new Inventory()});
    expect(recipeNeeds(tankR, src).map(n => [n.id, n.need, n.have, n.ok])).toEqual([[SCRAP_METAL, 2, 0, false], [BIO_MATER, 1, 0, false], [FLAME_FUEL_CAN, 1, 0, false]]);
    expect(recipeNeeds(flame, src).map(n => [n.id, n.need])).toEqual([[SCRAP_METAL, 5], [ELECTRICAL_PARTS, 3]]);
    expect(recipeNeeds(benchRecipeFor('chest')!, src).some(n => n.id === FLAME_FUEL_CAN)).toBe(false);
  });
});

/** A bench world: materials carried in the pockets (whole stacks, in this order), an empty Lockbox. */
function world(o: {scrap?: number; elec?: number; bio?: number; cans?: number} = {}) {
  const inv = new Inventory(), box = new TrainLockbox();
  const give = (id: string, n: number) => {
    for (let left = n; left > 0;) { const st = inv.makeStack(id, left); left -= st.count; expect(inv.add(st), id).toBe(0); }
  };
  give(SCRAP_METAL, o.scrap ?? 0);
  give(ELECTRICAL_PARTS, o.elec ?? 0);
  give(BIO_MATER, o.bio ?? 0);
  give(FLAME_FUEL_CAN, o.cans ?? 0);
  const ctx = (lockbox: TrainLockbox | null = box) => ({sources: craftSources({inv, lockbox}), items: {inv, lockbox}});
  const count = () => ({scrap: inv.count(SCRAP_METAL), elec: inv.count(ELECTRICAL_PARTS), bio: inv.count(BIO_MATER), cans: inv.count(FLAME_FUEL_CAN)});
  return {inv, box, ctx, count};
}
/** Every slot's stack OBJECT and its plain state (the grenade / melee slots too): an exact refund puts both back. */
function slots(inv: Inventory, lists: readonly (readonly (ItemStack | null)[])[] = []) {
  const all = [inv.hotbar, inv.pack, inv.gearSlots, inv.throwSlot, inv.meleeSlot, inv.wornBag()?.bag ?? [], ...lists];
  return {refs: all.flatMap(l => [...l]), json: JSON.stringify(all.map(l => l.map(stackToJSON)))};
}
/** Every stack of an item anywhere on the player or in the given lists. */
const allOf = (inv: Inventory, id: string, lists: readonly (readonly (ItemStack | null)[])[] = []): ItemStack[] =>
  [...inv.allStacks(true), ...lists.flat().filter((s): s is ItemStack => !!s)].filter(s => s.itemId === id);
/** Fill every quick slot and pocket that is still free (so nothing more fits on the player). */
function fillCarried(inv: Inventory): void {
  for (let i = 0; i < inv.hotbar.length; i++) if (!inv.get(H(i))) inv.set(H(i), inv.makeStack('bandage', 1));
  for (let i = 0; i < PACK_SIZE; i++) if (!inv.get(P(i))) inv.set(P(i), inv.makeStack('water', 1));
}

describe('crafting the flamethrower', () => {
  const flame = benchRecipeFor(FLAMETHROWER_ID) as MadeRecipe;

  it('one flamethrower for exactly 5 scrap + 3 electrical parts, into a quick slot; short materials change nothing', () => {
    const w = world({scrap: 7, elec: 4, bio: 2, cans: 2});
    const r = craftMade(flame, w.ctx());
    expect(r).toMatchObject({ok: true, made: {type: 'item', itemId: FLAMETHROWER_ID, count: 1}, carried: 1, lockbox: 0});
    expect(w.count()).toEqual({scrap: 2, elec: 1, bio: 2, cans: 2}); // (no bio mater, no fuel can)
    const made = allOf(w.inv, FLAMETHROWER_ID, [w.box.slots]);
    expect(made).toHaveLength(1);
    expect(w.inv.get(H(0))).toBe(made[0]);
    expect(made[0]).toEqual({uid: made[0].uid, itemId: FLAMETHROWER_ID, count: 1, mag: 0});
    expect(w.inv.invariants()).toEqual([]);
    // not enough left for a second: refused with what is missing, nothing changes (not even the uid counter)
    const before = JSON.stringify([w.inv.toJSON(), w.box.toJSON()]);
    expect(craftMade(flame, w.ctx())).toMatchObject({ok: false, reason: 'missing', text: 'Need 3 more Scrap metal and 2 more Electrical parts', missing: {[SCRAP_METAL]: 3, [ELECTRICAL_PARTS]: 2}});
    expect(JSON.stringify([w.inv.toJSON(), w.box.toJSON()])).toBe(before);
  });

  it('nothing free on you: it goes into the Lockbox; no room there either: refused before anything is spent', () => {
    const w = world();
    fillCarried(w.inv);
    w.box.slots[10] = w.inv.makeStack(SCRAP_METAL, 5); // (paid from the Lockbox: no pocket is freed by the debit)
    w.box.slots[11] = w.inv.makeStack(ELECTRICAL_PARTS, 3);
    expect([carriedRoom(w.inv, FLAMETHROWER_ID), lockboxRoom(w.box, FLAMETHROWER_ID)]).toEqual([0, w.box.slots.length - 2]);
    const r = craftMade(flame, w.ctx());
    expect(r).toMatchObject({ok: true, carried: 0, lockbox: 1});
    expect(w.box.slots[0]).toEqual({uid: w.box.slots[0]!.uid, itemId: FLAMETHROWER_ID, count: 1, mag: 0});
    expect(allOf(w.inv, FLAMETHROWER_ID, [w.box.slots])).toHaveLength(1);
    expect([w.box.slots[10], w.box.slots[11]]).toEqual([null, null]);
    // materials that were whole stacks in your pockets leave their pockets free: the flamethrower takes one of them
    const u = world({scrap: 5, elec: 3});
    fillCarried(u.inv);
    expect(carriedRoom(u.inv, FLAMETHROWER_ID)).toBe(0);
    expect(craftMade(flame, u.ctx())).toMatchObject({ok: true, carried: 1, lockbox: 0});
    expect(u.inv.pack.filter(s => s?.itemId === FLAMETHROWER_ID)).toHaveLength(1);
    expect(u.box.used).toBe(0);
    // a full Lockbox too (the materials in a chest aboard): blocked with the room text, nothing changes
    const v = world();
    fillCarried(v.inv);
    for (let i = 0; i < v.box.slots.length; i++) v.box.slots[i] = v.inv.makeStack('water', 1);
    const chest = fakeStore('eq-1');
    chest.slots[0] = v.inv.makeStack(SCRAP_METAL, 5);
    chest.slots[1] = v.inv.makeStack(ELECTRICAL_PARTS, 3);
    const ctx = {sources: craftSources({inv: v.inv, lockbox: v.box, stores: [chest]}), items: {inv: v.inv, lockbox: v.box}};
    expect(planCraft(flame, ctx.sources).ok).toBe(true);
    const before = JSON.stringify([v.inv.toJSON(), v.box.toJSON(), chest.slots.map(stackToJSON)]);
    expect(madeBlock(flame, ctx)).toBe(MADE_TEXT.noRoom(1, itemDef(FLAMETHROWER_ID).name));
    expect(craftMade(flame, ctx)).toEqual({ok: false, reason: 'blocked', text: MADE_TEXT.noRoom(1, itemDef(FLAMETHROWER_ID).name)});
    expect(JSON.stringify([v.inv.toJSON(), v.box.toJSON(), chest.slots.map(stackToJSON)])).toBe(before);
    expect(craftMade(flame, {sources: ctx.sources, items: null})).toEqual({ok: false, reason: 'blocked', text: MADE_TEXT.unavailable});
  });

  it('a batch of an item that does not stack is one stack each (never one stack standing for the batch, never a copy)', () => {
    // (a synthetic two-item recipe: the delivery loop itself — the real recipes make one)
    const two: MadeRecipe = {...flame, make: {type: 'item', itemId: FLAMETHROWER_ID, count: 2}};
    const w = world({scrap: 5, elec: 3});
    for (let i = 1; i < w.inv.hotbar.length; i++) w.inv.set(H(i), w.inv.makeStack('bandage', 1)); // one quick slot free
    expect(craftMade(two, w.ctx())).toMatchObject({ok: true, carried: 2, lockbox: 0});
    const made = allOf(w.inv, FLAMETHROWER_ID, [w.box.slots]);
    expect(made.map(s => s.count)).toEqual([1, 1]);
    expect(new Set(made.map(s => s.uid)).size).toBe(2);
    expect([w.inv.get(H(0))?.itemId, w.inv.pack.filter(s => s?.itemId === FLAMETHROWER_ID).length]).toEqual([FLAMETHROWER_ID, 1]);
    expect(w.inv.invariants()).toEqual([]);
    // one fits on you, the other goes to the Lockbox
    const v = world();
    fillCarried(v.inv);
    v.inv.set(H(2), null);
    v.box.slots[10] = v.inv.makeStack(SCRAP_METAL, 5);
    v.box.slots[11] = v.inv.makeStack(ELECTRICAL_PARTS, 3);
    expect(craftMade(two, v.ctx())).toMatchObject({ok: true, carried: 1, lockbox: 1});
    expect([v.inv.get(H(2))?.itemId, v.box.slots[0]?.itemId]).toEqual([FLAMETHROWER_ID, FLAMETHROWER_ID]);
    const both = allOf(v.inv, FLAMETHROWER_ID, [v.box.slots]);
    expect(both).toHaveLength(2);
    expect(both[0].uid).not.toBe(both[1].uid);
  });
});

describe('crafting the fuel tank: exactly its recipe\'s fuel, wherever it is delivered', () => {
  const tankR = benchRecipeFor(FUEL_TANK_ID) as MadeRecipe;
  const NEW = FLAME_FUEL.newUnits;

  it('a free back: the tank is WORN, holding exactly the one can the recipe took (2 scrap, 1 bio mater, 1 fuel can)', () => {
    const w = world({scrap: 6, elec: 2, bio: 3, cans: 2});
    const r = craftMade(tankR, w.ctx());
    expect(r).toMatchObject({ok: true, made: {type: 'item', itemId: FUEL_TANK_ID, count: 1}, carried: 1, lockbox: 0});
    expect(w.count()).toEqual({scrap: 4, elec: 2, bio: 2, cans: 1}); // (exactly one can gone — it is in the tank)
    const worn = wornFuelTank(w.inv)!;
    expect(worn).toBe(w.inv.gearSlots[BACK]);
    expect(worn).toEqual({uid: worn.uid, itemId: FUEL_TANK_ID, count: 1, fuel: NEW});
    expect(tankFuel(worn)).toBe(FLAME_FUEL.newCans * FLAME_FUEL.unitsPerCan);
    expect(allOf(w.inv, FUEL_TANK_ID, [w.box.slots])).toHaveLength(1);
    expect(w.inv.invariants()).toEqual([]);
    // fuel is conserved: the cans' units before = the cans' units left + the tank's
    expect(1 * FLAME_FUEL.unitsPerCan + tankFuel(worn)).toBe(2 * FLAME_FUEL.unitsPerCan);
  });

  it('the back taken (a backpack, an airtank, another tank): the new tank goes to a pocket with the same fuel; nothing is swapped off', () => {
    for (const backId of ['backpack', 'airtank_backpack', FUEL_TANK_ID]) {
      const w = world({scrap: 2, bio: 1, cans: 1});
      const back = w.inv.makeStack(backId, 1);
      if (backId === FUEL_TANK_ID) back.fuel = 37; // (a part-used tank already worn: it keeps its own fuel)
      w.inv.gearSlots[BACK] = back;
      const r = craftMade(tankR, w.ctx());
      expect(r, backId).toMatchObject({ok: true, carried: 1, lockbox: 0});
      expect(w.inv.gearSlots[BACK], backId).toBe(back);
      const made = allOf(w.inv, FUEL_TANK_ID, [w.box.slots]).filter(s => s !== back);
      expect(made, backId).toHaveLength(1);
      expect(made[0]).toEqual({uid: made[0].uid, itemId: FUEL_TANK_ID, count: 1, fuel: NEW});
      expect(w.inv.pack.includes(made[0]), backId).toBe(true);
      if (backId === FUEL_TANK_ID) expect(back.fuel).toBe(37);
      expect(w.count()).toEqual({scrap: 0, elec: 0, bio: 0, cans: 0});
      expect(w.inv.invariants(), backId).toEqual([]);
    }
  });

  it('the materials may come from the worn backpack, the Lockbox and a chest: the can is drawn like any other input', () => {
    const inv = new Inventory(), box = new TrainLockbox(), chest = fakeStore('eq-3');
    const bag = inv.makeStack('backpack', 1);
    expect(inv.wearBag(bag)).toBe(true);
    bag.bag![1] = inv.makeStack(SCRAP_METAL, 2);
    box.slots[4] = inv.makeStack(BIO_MATER, 1);
    const cans = inv.makeStack(FLAME_FUEL_CAN, 2);
    chest.slots[9] = cans;
    const sources = craftSources({inv, lockbox: box, stores: [chest]});
    const plan = planCraft(tankR, sources);
    expect(plan).toEqual({ok: true, kind: FUEL_TANK_ID, takes: [
      {source: 'backpack', kind: 'backpack', material: SCRAP_METAL, n: 2}, {source: 'lockbox', kind: 'lockbox', material: BIO_MATER, n: 1},
      {source: 'chest:eq-3', kind: 'chest', material: FLAME_FUEL_CAN, n: 1},
    ]});
    const r = craftMade(tankR, {sources, items: {inv, lockbox: box}});
    expect(r).toMatchObject({ok: true, carried: 1, lockbox: 0}); // (the back holds the backpack: a pocket)
    expect([bag.bag![1], box.slots[4], chest.slots[9]]).toEqual([null, null, cans]);
    expect(cans.count).toBe(1); // (one can of the chest's two; the other is untouched)
    expect(chest.touched).toBeGreaterThan(0);
    const made = allOf(inv, FUEL_TANK_ID, [box.slots, chest.slots]);
    expect(made.map(s => s.fuel)).toEqual([NEW]);
    // a carried can is used before the chest's
    const carried = inv.makeStack(FLAME_FUEL_CAN, 1);
    expect(inv.add(carried)).toBe(0);
    box.slots[4] = inv.makeStack(BIO_MATER, 1);
    bag.bag![1] = inv.makeStack(SCRAP_METAL, 2);
    expect(craftMade(tankR, {sources: craftSources({inv, lockbox: box, stores: [chest]}), items: {inv, lockbox: box}})).toMatchObject({ok: true});
    expect([inv.count(FLAME_FUEL_CAN), cans.count]).toEqual([0, 1]);
    expect(allOf(inv, FUEL_TANK_ID, [box.slots, chest.slots]).map(s => s.fuel)).toEqual([NEW, NEW]);
  });

  it('back taken and nothing free on you: into the Lockbox with the same fuel; no room anywhere: refused, the can stays a can', () => {
    const w = world();
    w.inv.gearSlots[BACK] = w.inv.makeStack('airtank_backpack', 1);
    fillCarried(w.inv);
    w.box.slots[20] = w.inv.makeStack(SCRAP_METAL, 2); // (paid from the Lockbox: no pocket is freed by the debit)
    w.box.slots[21] = w.inv.makeStack(BIO_MATER, 1);
    w.box.slots[22] = w.inv.makeStack(FLAME_FUEL_CAN, 1);
    expect([carriedRoom(w.inv, FUEL_TANK_ID), lockboxRoom(w.box, FUEL_TANK_ID)]).toEqual([0, w.box.slots.length - 3]);
    expect(craftMade(tankR, w.ctx())).toMatchObject({ok: true, carried: 0, lockbox: 1});
    expect(w.box.slots[0]).toEqual({uid: w.box.slots[0]!.uid, itemId: FUEL_TANK_ID, count: 1, fuel: NEW});
    expect(allOf(w.inv, FUEL_TANK_ID, [w.box.slots])).toHaveLength(1);
    expect(w.box.slots.slice(20, 23)).toEqual([null, null, null]); // (the can went into the tank)
    // the stored tank keeps that fuel through the Lockbox's own save
    const again = new TrainLockbox();
    again.load(JSON.parse(JSON.stringify(w.box.toJSON())));
    expect(again.slots[0]).toEqual(w.box.slots[0]);
    // no room anywhere: blocked before the debit — byte for byte the same state, the can still in its slot
    const v = world({scrap: 2, bio: 1, cans: 1});
    v.inv.gearSlots[BACK] = v.inv.makeStack('backpack', 1);
    fillCarried(v.inv);
    for (let i = 0; i < v.box.slots.length; i++) v.box.slots[i] = v.inv.makeStack('water', 1);
    const before = JSON.stringify([v.inv.toJSON(), v.box.toJSON()]);
    expect(craftMade(tankR, v.ctx())).toEqual({ok: false, reason: 'blocked', text: MADE_TEXT.noRoom(1, 'Flamethrower fuel tank')});
    expect(JSON.stringify([v.inv.toJSON(), v.box.toJSON()])).toBe(before);
    expect(v.count().cans).toBe(1);
    // a free back counts as room even with every pocket full (the tank is worn)
    v.inv.gearSlots[BACK] = null;
    expect(carriedRoom(v.inv, FUEL_TANK_ID)).toBe(1);
    expect(madeBlock(tankR, v.ctx())).toBeNull();
  });

  it('no fuel can, no tank: the can is an input like the others (nothing else is spent, no empty tank is made)', () => {
    const w = world({scrap: 9, elec: 9, bio: 9});
    const before = JSON.stringify([w.inv.toJSON(), w.box.toJSON()]);
    expect(craftMade(tankR, w.ctx())).toEqual({ok: false, reason: 'missing', text: 'Need 1 more Fuel can', missing: {[FLAME_FUEL_CAN]: 1}});
    expect(JSON.stringify([w.inv.toJSON(), w.box.toJSON()])).toBe(before);
    expect(allOf(w.inv, FUEL_TANK_ID, [w.box.slots])).toEqual([]);
    // a tank is not a can: a worn tank's fuel is never counted or drawn as the recipe's can
    const t = w.inv.makeStack(FUEL_TANK_ID, 1);
    t.fuel = FLAME_FUEL.capacity;
    w.inv.gearSlots[BACK] = t;
    expect(craftMade(tankR, w.ctx())).toMatchObject({ok: false, reason: 'missing', missing: {[FLAME_FUEL_CAN]: 1}});
    expect(t.fuel).toBe(FLAME_FUEL.capacity);
  });

  it('a delivery that fails is undone exactly: the can and the materials are back in their very stacks, no tank exists', () => {
    for (const mode of ['throws', 'does not fit'] as const) {
      const w = world({scrap: 3, bio: 2, cans: 2});
      const before = slots(w.inv, [w.box.slots]);
      const real = w.inv.add.bind(w.inv);
      w.inv.add = (stack, opts) => {
        if (stack.itemId !== FUEL_TANK_ID) return real(stack, opts);
        if (mode === 'throws') throw new Error('boom');
        return stack.count;
      };
      const r = craftMade(tankR, w.ctx(null)); // (no Lockbox to fall back on)
      expect(r, mode).toMatchObject({ok: false, reason: 'failed'});
      if (mode === 'throws') expect((r as {error?: unknown}).error).toBeInstanceOf(Error);
      const after = slots(w.inv, [w.box.slots]);
      expect(after.json, mode).toBe(before.json);
      after.refs.forEach((s, i) => expect(s, `${mode}:${i}`).toBe(before.refs[i])); // the same stack objects in the same slots
      expect(w.count(), mode).toEqual({scrap: 3, elec: 0, bio: 2, cans: 2});
      expect(allOf(w.inv, FUEL_TANK_ID, [w.box.slots]), mode).toEqual([]);
      expect(w.inv.gearSlots[BACK], mode).toBeNull();
      // with a Lockbox the same refusal on the player is no failure: exactly one tank, in the Lockbox
      if (mode === 'does not fit') {
        expect(craftMade(tankR, w.ctx())).toMatchObject({ok: true, carried: 0, lockbox: 1});
        expect(allOf(w.inv, FUEL_TANK_ID, [w.box.slots]).map(s => s.fuel)).toEqual([NEW]);
        expect(w.count()).toEqual({scrap: 1, elec: 0, bio: 1, cans: 1});
      }
    }
  });

  it('crafting again and again never makes fuel: every can spent is one new tank\'s fuel, and nothing else changes it', () => {
    const w = world({scrap: 20, bio: 10, cans: 2});
    for (let i = 0; i < 4; i++) { const st = w.inv.makeStack(FLAME_FUEL_CAN, 2); expect(w.inv.add(st)).toBe(0); } // 10 cans carried
    const units = () => w.inv.count(FLAME_FUEL_CAN) * FLAME_FUEL.unitsPerCan + allOf(w.inv, FUEL_TANK_ID, [w.box.slots]).reduce((n, s) => n + tankFuel(s), 0);
    const total = units();
    expect(total).toBe(10 * FLAME_FUEL.unitsPerCan);
    let made = 0;
    for (let i = 0; i < 12; i++) {
      const r = craftMade(tankR, w.ctx());
      if (r.ok) made++;
      expect(units(), `${i}`).toBe(total);
      expect(w.inv.invariants()).toEqual([]);
    }
    expect(made).toBe(10); // (the scrap and the bio mater run out with the cans: 10 tanks)
    const tanks = allOf(w.inv, FUEL_TANK_ID, [w.box.slots]);
    expect(tanks).toHaveLength(10);
    expect(new Set(tanks.map(s => s.uid)).size).toBe(10);
    expect(tanks.every(s => s.fuel === NEW)).toBe(true);
    expect(w.count()).toEqual({scrap: 0, elec: 0, bio: 0, cans: 0});
  });
});

describe('the texts: no magazine on a stream weapon; the tank\'s fuel; what a fuel can is for', () => {
  it('noMagazine: melee and stream weapons show no round count; guns do', () => {
    expect([noMagazine(WEAPONS[FLAMETHROWER_ID]), noMagazine(WEAPONS.knife), noMagazine(WEAPONS.pistol), noMagazine(WEAPONS.shotgun), noMagazine(undefined), noMagazine(null)])
      .toEqual([true, true, false, false, false, false]);
  });

  it('the flamethrower\'s tooltip says what it burns and what is on the back — never "0 / 0 loaded"', () => {
    const inv = new Inventory();
    const ft = inv.makeStack(FLAMETHROWER_ID, 1);
    expect(inv.add(ft)).toBe(0);
    const base = 'Burns the fuel of a worn Flamethrower fuel tank · no magazine';
    expect(streamText()).toBe(base);
    expect(itemTipLines(ft)).toEqual([base]);
    expect(itemTipLines(ft, {inv})).toEqual([`${base} · no fuel tank worn: it will not fire`]);
    const tank = inv.makeStack(FUEL_TANK_ID, 1);
    expect(inv.add(tank)).toBe(0); // worn
    expect(itemTipLines(ft, {inv})).toEqual([`${base} · tank worn: 1 of 3 cans`]);
    tank.fuel = 137;
    expect(streamText(inv)).toBe(`${base} · tank worn: 0.6 of 3 cans`); // (never rounded up to fuel that is not there)
    tank.fuel = 0;
    expect(streamText(inv)).toBe(`${base} · tank worn: 0 of 3 cans`);
    // a tank in a pocket feeds nothing
    inv.gearSlots[BACK] = null;
    inv.set(P(0), tank);
    expect(streamText(inv)).toBe(`${base} · no fuel tank worn: it will not fire`);
    const tip = itemTip(ft, 'hint', {inv});
    expect(tip.head).toBe(itemDef(FLAMETHROWER_ID).name);
    expect(JSON.stringify(tip)).not.toMatch(/loaded|in reserve|0 \/ 0/);
    // a gun's line is what it was
    expect(itemTipLines(inv.makeStack('pistol', 1, 7))[0]).toMatch(/^7 \/ \d+ loaded · takes /);
  });

  it('the tank\'s tooltip and status texts show THAT tank\'s fuel; the fuel can says what it is for', () => {
    const inv = new Inventory();
    const tank = inv.makeStack(FUEL_TANK_ID, 1);
    expect(itemTipLines(tank)).toEqual(['flamethrower fuel 1 of 3 cans (20 s of flame) · no storage · refill from fuel cans (R)']);
    expect(fuelText(tank)).toBe('Fuel 1 of 3 cans · 20 s of flame');
    tank.fuel = FLAME_FUEL.capacity;
    expect(itemTipLines(tank)).toEqual(['flamethrower fuel 3 of 3 cans (60 s of flame) · no storage · refill from fuel cans (R)']);
    expect(fuelText(tank)).toBe('Fuel 3 of 3 cans · 60 s of flame');
    tank.fuel = 199;
    expect(fuelText(tank)).toBe('Fuel 0.9 of 3 cans · 20 s of flame');
    tank.fuel = 0;
    expect(itemTipLines(tank)).toEqual(['flamethrower fuel 0 of 3 cans (0 s of flame) · no storage · refill from fuel cans (R)']);
    expect(fuelText(tank)).toBe('Fuel empty — refill it from fuel cans');
    delete tank.fuel; // (a tank without the field is empty)
    expect(fuelText(tank)).toBe('Fuel empty — refill it from fuel cans');
    // the ordinary fuel can is no gas filter
    expect(supplyText('gas_filter')).toBe('A worn gas mask fits one by itself when its filter runs out');
    expect(supplyText(FLAME_FUEL_CAN)).toMatch(/^Train fuel: .* refills a worn Flamethrower fuel tank \(R with the flamethrower in your hands\)/);
    expect(itemTipLines(inv.makeStack(FLAME_FUEL_CAN, 1))).toEqual([supplyText(FLAME_FUEL_CAN)]);
    expect(itemTipLines(inv.makeStack('gas_filter', 1))).toEqual([supplyText('gas_filter')]);
    expect(itemDef(FLAME_FUEL_CAN).description).toMatch(/refills a worn Flamethrower fuel tank/);
  });
});
