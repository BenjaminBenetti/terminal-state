// Task office-props-physics-scale-20261030 (lane RACK): the collectible CRAFTING MATERIALS (items/craftMaterials.ts) — Electrical parts,
// Scrap metal (user #5: "the most common spawn items here will bee "electrical parts". As well as "scrap metal" these will be used later
// in crafting") and Bio mater (user #6, the quoted label kept exactly; lab loot is lane FURN's). For FUTURE crafting: no recipes, no
// crafting UI, no currency — passive stacks with honest descriptions, finite themed loot, pickup / drop / bag / carryover support.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {layoutHolders} from './helpers/lootEconomy';
import {ITEMS, ITEM_DIMS, effectText, itemDef, isFoodOrDrink} from '../src/items/items';
import {BIO_MATER, ELECTRICAL_PARTS, MATERIAL_IDS, MATERIAL_NOTE, SCRAP_METAL, isMaterialItem} from '../src/items/craftMaterials';
import {Inventory, stacksIn, type AnyRef, type SlotRef} from '../src/items/inventory';
import {GEAR_SLOTS} from '../src/items/gear';
import {BagSession} from '../src/gear/bagSession';
import {
  BOX_COUNT, ECON_CATS, GLOBAL_POOL, HOLDER_ALLOW, OFF_THEME_WEIGHTS, OPENABLE_TABLES, PROFILES, SERVER_RACK_ROWS, SERVER_SPARES_ROWS, THEME_ECONOMY,
  econCat, lootProfile, validateLootProfile, type OwnTable,
} from '../src/items/lootTables';
import {scarceFinds} from '../src/items/lootEconomy';
import {holderFinds} from '../src/items/loot';
import {ITEM_CLASS, ITEM_PHYSICS} from '../src/damage/materials';
import {ICONS} from '../src/ui/icons';
import {MATERIAL_MODEL_SOURCE, materialItemModel} from '../src/world/materialItems';
import {itemModelSources, itemTemplate} from '../src/world/pickups';
import {generateStation} from '../src/gen/station';
import {mulberry32} from '../src/core/rng';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

describe('the three materials: stable ids, labels, passive kind, honest descriptions', () => {
  it('Electrical parts / Scrap metal / Bio mater', () => {
    expect([...MATERIAL_IDS]).toEqual(['electrical_parts', 'scrap_metal', 'bio_mater']);
    expect([ELECTRICAL_PARTS, SCRAP_METAL, BIO_MATER].map(id => itemDef(id).name)).toEqual(['Electrical parts', 'Scrap metal', 'Bio mater']);
    for (const id of MATERIAL_IDS) {
      const d = ITEMS[id];
      expect(isMaterialItem(id)).toBe(true);
      expect(d).toMatchObject({id, kind: 'material'});
      expect(d.stackMax).toBeGreaterThanOrEqual(10);
      // nothing to use: no effect, verb, use time, weapon, gear slot or treatment — and the description says it is for later crafting
      for (const k of ['heal', 'hunger', 'thirst', 'verb', 'useTime', 'recharge', 'weaponId', 'gear', 'treats', 'caliber'] as const) expect(d[k], `${id}.${k}`).toBeUndefined();
      expect(effectText(d)).toBe('');
      expect(isFoodOrDrink(d)).toBe(false);
      expect(d.description).toMatch(/crafting, which comes in a later update/);
      expect(d.description).not.toMatch(/restores|heals|refill|\+\d/i);
      expect(ICONS[d.icon]).toMatch(/^<svg/);
      expect(ITEM_DIMS[id]).toBeTruthy();
      expect(ITEM_CLASS[id]).toBeTruthy();
      expect(ITEM_PHYSICS[id].mass).toBeGreaterThan(0.1);
    }
    expect(MATERIAL_NOTE).toMatch(/nothing to use by hand yet/);
    expect(itemDef(BIO_MATER).description).toMatch(/Not food and not medicine/);
  });
});

describe('inventory: pockets first, stacks, drop / pick up, worn and grounded bags, carryover snapshots', () => {
  const P = (index: number): SlotRef => ({bar: 'pack', index});
  it('pockets first (like ammo), stack to stackMax, count / take, JSON round trip keeps them', () => {
    const inv = new Inventory();
    expect(inv.add(inv.makeStack(ELECTRICAL_PARTS, 3))).toBe(0);
    expect(inv.hotbar.every(s => s === null)).toBe(true); // never clutters the quick slots while the pockets have room
    expect(inv.pack.find(s => s?.itemId === ELECTRICAL_PARTS)?.count).toBe(3);
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 12));
    inv.add(inv.makeStack(ELECTRICAL_PARTS, 13));
    expect(inv.count(ELECTRICAL_PARTS)).toBe(28);
    expect(Math.max(...inv.pack.filter(s => s?.itemId === ELECTRICAL_PARTS).map(s => s!.count))).toBe(itemDef(ELECTRICAL_PARTS).stackMax);
    inv.add(inv.makeStack(SCRAP_METAL, 2));
    inv.add(inv.makeStack(BIO_MATER, 1));
    const back = Inventory.fromJSON(JSON.parse(JSON.stringify(inv.toJSON())));
    for (const id of MATERIAL_IDS) expect(back.count(id), id).toBe(inv.count(id));
    expect(back.invariants()).toEqual([]);
    expect(inv.take(SCRAP_METAL, 5)).toBe(2);
    expect(inv.count(SCRAP_METAL)).toBe(0);
  });

  it('a worn bag carries them (snapshot), a grounded open bag takes / gives them without loss', () => {
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack(ELECTRICAL_PARTS, 4);
    bag.bag![1] = inv.makeStack(BIO_MATER, 2);
    inv.set({bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')}, bag);
    inv.add(inv.makeStack(SCRAP_METAL, 3));
    const snap = Inventory.fromJSON(inv.toJSON());
    const all = (i: Inventory) => i.allStacks(true).filter(s => isMaterialItem(s.itemId)).reduce((m, s) => ({...m, [s.itemId]: (m[s.itemId] ?? 0) + s.count}), {} as Record<string, number>);
    expect(all(snap)).toEqual({[ELECTRICAL_PARTS]: 4, [BIO_MATER]: 2, [SCRAP_METAL]: 3});
    const taken = inv.takeOffBag()!;
    const s = new BagSession(() => inv, {stack: taken, grounded: true});
    expect(s.quick({bar: 'bag', index: 0} as AnyRef)).toBe(4);
    expect(inv.count(ELECTRICAL_PARTS)).toBe(4);
    const ref = inv.pack.findIndex(x => x?.itemId === SCRAP_METAL);
    expect(s.quick(P(ref))).toBe(3); // pockets -> the open bag
    expect(stacksIn(taken).filter(x => x.itemId === SCRAP_METAL).reduce((n, x) => n + x.count, 0)).toBe(3);
    expect(inv.invariants()).toEqual([]);
  });
});

describe('world / held / icon model: authored geometry in its ITEM_DIMS box', () => {
  it('grounded, centred, fills its dims; pickups and icons use it', () => {
    for (const id of MATERIAL_IDS) {
      const o = materialItemModel(id);
      const b = new THREE.Box3().setFromObject(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const d = ITEM_DIMS[id];
      expect(Math.abs(b.min.y), `${id} grounded`).toBeLessThan(0.002);
      expect(Math.abs(c.x), `${id} centred x`).toBeLessThan(0.012);
      expect(Math.abs(c.z), `${id} centred z`).toBeLessThan(0.012);
      for (const [k, v] of [['w', size.x], ['h', size.y], ['d', size.z]] as const) {
        expect(v, `${id} ${k} within its dims`).toBeLessThanOrEqual(d[k] + 0.004);
        expect(v, `${id} ${k} fills its dims`).toBeGreaterThan(d[k] * 0.8);
      }
      expect(itemTemplate(id).children.length).toBeGreaterThan(0);
    }
    expect(Object.entries(itemModelSources()).filter(([k]) => isMaterialItem(k)).map(([, v]) => v)).toEqual(MATERIAL_IDS.map(() => MATERIAL_MODEL_SOURCE));
  });
});

describe('loot: economy category material — finite, themed, kept as rolled, never an off-theme pick', () => {
  it('category data: no theme / off-theme weight, valid profiles, stack sizes', () => {
    for (const id of MATERIAL_IDS) expect(econCat(id)).toBe('material');
    expect(ECON_CATS).toContain('material');
    expect(OFF_THEME_WEIGHTS.material).toBe(0);
    for (const [t, T] of Object.entries(THEME_ECONOMY)) { expect(T.cats, t).not.toContain('material'); expect(T.weights.material ?? 0, t).toBe(0); }
    expect(GLOBAL_POOL.material.map(r => r[0]).sort()).toEqual([...MATERIAL_IDS].sort());
    for (const p of Object.values(PROFILES)) expect(validateLootProfile(p)).toEqual([]);
    for (const id of MATERIAL_IDS) { expect(BOX_COUNT[id].small[0]).toBeGreaterThanOrEqual(1); expect(BOX_COUNT[id].big[1]).toBeLessThanOrEqual(3); }
    // a holder's own rows may only list materials where it is allowed to hold them
    for (const [k, t] of Object.entries(OPENABLE_TABLES as Readonly<Record<string, OwnTable>>)) {
      if (t.items.some(([id]) => isMaterialItem(id))) expect(HOLDER_ALLOW[k], k).toContain('material');
    }
    expect(SERVER_RACK_ROWS.filter(([id]) => isMaterialItem(id)).map(r => r[0])).toEqual([ELECTRICAL_PARTS, SCRAP_METAL]);
    expect(SERVER_SPARES_ROWS.some(([id]) => id === ELECTRICAL_PARTS)).toBe(true);
  });

  it('the scarcity cut never touches a rolled material (kept exactly, like ammo)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const out = scarceFinds([{itemId: ELECTRICAL_PARTS, count: 2}, {itemId: SCRAP_METAL, count: 1}], {kind: 'serverRack', areaKey: 'office-server', rows: SERVER_RACK_ROWS, boxCount: () => 1}, r);
      expect(out.filter(f => isMaterialItem(f.itemId))).toEqual([{itemId: ELECTRICAL_PARTS, count: 2, source: 'roll'}, {itemId: SCRAP_METAL, count: 1, source: 'roll'}]);
    }
  });

  it('server racks: electrical parts are the most common find, then scrap metal; ~1 rack in 4 holds anything; finite counts', () => {
    const P = lootProfile('office');
    const units: Record<string, number> = {};
    let withAny = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const f = holderFinds(9000 + i, i, 'serverRack', 'office-server', false, P);
      if (f.length) withAny++;
      for (const e of f) units[e.itemId] = (units[e.itemId] ?? 0) + e.count;
      expect(f.length).toBeLessThanOrEqual(2);
    }
    const rank = Object.entries(units).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    expect(rank.slice(0, 2)).toEqual([ELECTRICAL_PARTS, SCRAP_METAL]);
    expect(withAny / N).toBeGreaterThan(0.2);
    expect(withAny / N).toBeLessThan(0.4);
    expect(units[ELECTRICAL_PARTS] / N).toBeGreaterThan(0.3);
    expect(units[ELECTRICAL_PARTS] / N).toBeLessThan(0.8);
    console.info(`[craft-materials] serverRack over ${N} rolls: ${withAny} hold something; units ${JSON.stringify(units)}`);
  });

  it('the Subway never holds a material (unrelated pools untouched)', () => {
    for (const seed of [1, 2, 3]) {
      const l = generateStation(seed);
      for (const h of layoutHolders(l)) for (const lot of h.lots) expect(isMaterialItem(lot.itemId), `seed ${seed} ${h.kind}`).toBe(false);
      for (const p of l.pickups) expect(isMaterialItem(p.itemId)).toBe(false);
    }
  });
});
