// Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): the 24 PANTRY foods / drinks (items/pantryFood.ts) as ordinary
// collectible consumables, registered like the Skyways ramen food:
//  - ITEMS / FOOD_IDS / DRINK_IDS / ITEM_DIMS / IconKey + SVG HUD icon / econ categories / damage classes / rigid bodies / the existing
//    eat-drink motion and take; numbers in the existing balance (close to the old item each stands in for); no buff / poison / disease;
//  - models: the cook's FOOD_ITEM_MODELS (empty stub OK: a plain labelled FALLBACK primitive at ITEM_DIMS size), lazily fetched (never a
//    boot file), the template / loot highlight refresh when a model arrives; the delivered GLBs at ITEM_DIMS (checked once in the tree);
//  - the generic consume path on the REAL Game methods (the last unit removes the stack exactly once), a stack split / merge;
//  - save validation (inventory / Lockbox stacks, holder records with variant lot ids, pickups) and a text round trip;
//  - market values from the item data, consistent with the old foods; every stall takes them (the general store at its themed rate).
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {DRINK_IDS, FOOD_IDS, ITEMS, ITEM_DIMS, effectText, isFoodOrDrink, itemDef, useLabel} from '../src/items/items';
import {
  PANTRY_ASSET_ID, PANTRY_CONSUME, PANTRY_DRINK_IDS, PANTRY_FOOD_IDS, PANTRY_IDS, PANTRY_NOMINAL, PANTRY_SOUND, pantryModelUrl,
} from '../src/items/pantryFood';
import {PANTRY_FAMILIES} from '../src/items/pantryVariety';
import {FOOD_ITEM_MODELS} from '../src/assets/foodShelfModels.generated';
import {MODEL_FILES} from '../src/assets/manifest';
import {levelOfAsset} from '../src/assets/levelAssets';
import {ICONS} from '../src/ui/icons';
import {econCat} from '../src/items/lootTables';
import {ITEM_CLASS, ITEM_PHYSICS, itemClass, itemPhysics, modelClass} from '../src/damage/materials';
import {ITEM_MODEL_KEYS, itemModelSources, itemTemplate, refreshItemTemplates} from '../src/world/pickups';
import {ensurePantryModels, pantryModelSource, registerPantryModel} from '../src/world/pantryModels';
import {LotDisplay} from '../src/world/lootDisplay';
import {Survival} from '../src/player/survival';
import {ConsumeView} from '../src/weapons/consumeView';
import {Inventory, type SlotRef} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import {starterInventory} from '../src/run/starter';
import {FlashlightBattery} from '../src/player/flashlight';
import {validateSaveFile, parseSaveText} from '../src/save/validate';
import {saveFileText} from '../src/save/serialize';
import {holderKey} from '../src/run/memory';
import {variantLotId} from '../src/items/pantryVariety';
import {baseCents, isTradeable} from '../src/market/trade/value';
import {STALL_TRADE, TRADE_RATES, buyBackPct, sellQuote} from '../src/market/trade/stalls';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {loadStripped} from './helpers/openablesFixture';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const DT = 1 / 60;
/** The vision board ids / slugs (PLAN): F01..F18, D01, D02, D04..D07 — D03 / D08 are excluded. */
const PLAN: Record<string, string> = {
  F01: 'corned_beef', F02: 'sardines', F03: 'field_ration', F04: 'ration_brick', F05: 'pickles', F06: 'peanut_butter', F07: 'saltines', F08: 'jerky',
  F09: 'trail_mix', F10: 'honey', F11: 'butter_cookies', F12: 'pudding_cups', F13: 'fruit_puree', F14: 'raisins', F15: 'smoked_sausage', F16: 'wax_cheese',
  F17: 'rolled_oats', F18: 'rice_crackers', D01: 'sports_drink', D02: 'iced_coffee', D04: 'iced_tea', D05: 'juice_boxes', D06: 'uht_milk', D07: 'ginger_soda',
};
/** PLAN's reference measure per item: [axis, metres] (H = height, W = width / length, D = diameter). */
const MEASURE: Record<string, ['H' | 'W' | 'D', number]> = {
  corned_beef: ['H', 0.10], sardines: ['W', 0.11], field_ration: ['H', 0.20], ration_brick: ['W', 0.15], pickles: ['H', 0.18], peanut_butter: ['H', 0.12],
  saltines: ['W', 0.22], jerky: ['H', 0.20], trail_mix: ['H', 0.20], honey: ['H', 0.17], butter_cookies: ['D', 0.20], pudding_cups: ['W', 0.15],
  fruit_puree: ['H', 0.15], raisins: ['W', 0.12], smoked_sausage: ['W', 0.28], wax_cheese: ['D', 0.14], rolled_oats: ['H', 0.24], rice_crackers: ['W', 0.22],
  sports_drink: ['H', 0.23], iced_coffee: ['H', 0.17], iced_tea: ['H', 0.24], juice_boxes: ['W', 0.15], uht_milk: ['H', 0.20], ginger_soda: ['H', 0.22],
};
const familiesOf = (id: string) => Object.values(PANTRY_FAMILIES).filter(f => id in f.members).map(f => f.base);

describe('pantry food: 24 ordinary consumables', () => {
  it('the ids are the PLAN slugs (no D03 / D08); foods eat, drinks drink; effects, stacks, use times, icons, text', () => {
    expect(Object.fromEntries(Object.entries(PANTRY_ASSET_ID).map(([id, a]) => [a, id]))).toEqual(PLAN);
    expect([...PANTRY_IDS].sort()).toEqual(Object.values(PLAN).sort());
    expect(PANTRY_FOOD_IDS.length).toBe(18);
    expect(PANTRY_DRINK_IDS.length).toBe(6);
    for (const id of PANTRY_IDS) {
      const d = ITEMS[id], drink = (PANTRY_DRINK_IDS as readonly string[]).includes(id);
      expect(d, id).toMatchObject({id, kind: 'consumable', icon: id, verb: drink ? 'drink' : 'eat'});
      expect(isFoodOrDrink(d), id).toBe(true);
      expect((drink ? DRINK_IDS : FOOD_IDS) as readonly string[], id).toContain(id);
      expect(econCat(id), id).toBe(drink ? 'drink' : 'food');
      expect(ICONS[d.icon], id).toMatch(/^<svg viewBox="0 0 64 32"/);
      expect(d.description.length, id).toBeGreaterThan(50);
      expect(d.name.length, id).toBeGreaterThan(3);
      expect(d.useTime!, id).toBeGreaterThanOrEqual(1.2);
      expect(d.useTime!, id).toBeLessThanOrEqual(2.5);
      expect(d.stackMax, id).toBeGreaterThan(1);
      expect(d.stackMax, id).toBeLessThanOrEqual(6);
      if (drink) expect(d.thirst!, id).toBeGreaterThan(0); else expect(d.hunger!, id).toBeGreaterThan(0);
      // no new mechanics: only food / water (no heal, treatment, battery, gear, ammo)
      expect(Object.keys(d).filter(k => !['id', 'name', 'short', 'kind', 'stackMax', 'hunger', 'thirst', 'useTime', 'verb', 'icon', 'description'].includes(k)), id).toEqual([]);
      expect(useLabel(d), id).toMatch(drink ? /^Drinking / : /^Eating /);
      expect(effectText(d), id).toMatch(/food|water/);
    }
    expect(effectText(itemDef('ration_brick'))).toBe('+44 food · −6 water');
    expect(effectText(itemDef('uht_milk'))).toBe('+10 food · +22 water');
  });

  it('numbers sit in the existing balance: close to the old item each one stands in for (food within 14 / water within 10 points)', () => {
    for (const id of PANTRY_IDS) {
      const fam = familiesOf(id);
      expect(fam.length, id).toBeGreaterThan(0);
      const d = ITEMS[id];
      const near = fam.some(b => Math.abs((d.hunger ?? 0) - (ITEMS[b].hunger ?? 0)) <= 14 && Math.abs((d.thirst ?? 0) - (ITEMS[b].thirst ?? 0)) <= 10); // (the rare ration brick is the far one: 44 / -6 vs beans 30 / +4)
      expect(near, `${id} vs ${fam.join('/')}`).toBe(true);
      expect(d.hunger ?? 0, id).toBeLessThanOrEqual(45); // never above the chashu ramen bowl, the most filling find
      expect(d.thirst ?? 0, id).toBeLessThanOrEqual(35); // never above plain water, the best thing for thirst
    }
  });

  it('eating / drinking moves the existing survival bars only (the generic Survival.consume path; no cap of its own)', () => {
    for (const id of PANTRY_IDS) {
      const s = new Survival();
      s.hunger = 40; s.thirst = 40;
      const d = itemDef(id);
      expect(s.consume(d), id).toEqual({hunger: d.hunger ?? 0, thirst: d.thirst ?? 0});
      expect([s.hunger, s.thirst], id).toEqual([40 + (d.hunger ?? 0), 40 + (d.thirst ?? 0)]);
    }
  });

  it('first-person use: an existing motion per food (consume view reaches its use phase), an existing take per item', () => {
    for (const id of PANTRY_FOOD_IDS) expect(['chocolate', 'chips', 'beans', 'noodles', 'sip', 'bite'], id).toContain(PANTRY_CONSUME[id]);
    for (const id of PANTRY_IDS) expect(PANTRY_SOUND[id], id).toMatch(itemDef(id).verb === 'eat' ? /^eat/ : /^drink/);
    for (const id of PANTRY_IDS) {
      const D = ITEM_DIMS[id];
      const cv = new ConsumeView({camera: new THREE.Object3D(), setHolstered() {}}, () => {
        const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(D.w, D.h, D.d));
        m.position.y = D.h / 2;
        g.add(m);
        return g;
      });
      cv.start(id, itemDef(id).useTime!, 'empty');
      for (let t = 0; t < 0.35; t += DT) cv.update(DT);
      expect(cv.phase, id).toBe('use');
      const o = cv.group.children[0];
      expect(o.position.length(), id).toBeLessThan(0.6); // held in front of the face
    }
  });

  it('damage classes and rigid bodies: every item, plausible masses; model keys item_<id> share the class', () => {
    for (const id of PANTRY_IDS) {
      expect(ITEM_CLASS[id], id).toBeDefined();
      expect(modelClass(`item_${id}`), id).toBe(itemClass(id));
      const ph = ITEM_PHYSICS[id];
      expect(ph, id).toBeDefined();
      expect(itemPhysics(id).mass, id).toBeGreaterThanOrEqual(0.08);
      expect(itemPhysics(id).mass, id).toBeLessThanOrEqual(1.1);
    }
    expect([itemClass('pickles'), itemClass('sardines'), itemClass('uht_milk')]).toEqual(['glass', 'sheetMetal', 'cardboard']);
  });
});

describe('pantry food: sizes and models (lazy, the cook record may still be empty)', () => {
  it('ITEM_DIMS = the delivered model bounds when the cook record has the item, else the vision-board real size (the PLAN measure)', () => {
    for (const id of PANTRY_IDS) {
      const m = FOOD_ITEM_MODELS[id], D = ITEM_DIMS[id];
      if (m) { expect([D.w, D.h, D.d], id).toEqual([m.w, m.h, m.d].map(v => Math.round(v * 10000) / 10000)); continue; }
      expect({w: D.w, h: D.h, d: D.d}, id).toEqual({w: PANTRY_NOMINAL[id].w, h: PANTRY_NOMINAL[id].h, d: PANTRY_NOMINAL[id].d});
      const [axis, v] = MEASURE[id];
      const got = axis === 'H' ? D.h : Math.max(D.w, D.d);
      expect(Math.abs(got - v), `${id} ${axis}`).toBeLessThan(0.006);
    }
    // the shape is the item's own, except a delivered box-like model cooked lying (height < half its footprint) rests flat
    for (const [id, D] of Object.entries(PANTRY_NOMINAL)) {
      const m = FOOD_ITEM_MODELS[id], lying = !!m && D.shape === 'box' && m.h < 0.5 * Math.max(m.w, m.d);
      expect(ITEM_DIMS[id].shape, id).toBe(lying ? 'flat' : D.shape);
    }
  });

  it('never boot files: no item_<id> in MODEL_FILES; delivered urls are shared (food travels) food-<slug>.glb files', () => {
    for (const id of PANTRY_IDS) {
      expect(ITEM_MODEL_KEYS[id], id).toBe(`item_${id}`);
      expect(`item_${id}` in MODEL_FILES, id).toBe(false);
      const url = pantryModelUrl(id);
      if (!url) continue;
      expect(url, id).toBe(`assets/models/food-${id.replace(/_/g, '-')}.glb`);
      expect(levelOfAsset(url), id).toBeNull();
    }
    for (const k of Object.keys(FOOD_ITEM_MODELS)) expect(PANTRY_IDS as readonly string[], k).toContain(k);
  });

  it('without a loaded model: a plain labelled FALLBACK primitive at ITEM_DIMS size (no texture); a registered model replaces it on refresh', async () => {
    expect(await ensurePantryModels(PANTRY_IDS)).toEqual([]); // (no browser: nothing is fetched)
    refreshItemTemplates(PANTRY_IDS);
    for (const id of PANTRY_IDS) {
      const t = itemTemplate(id);
      const fb = t.getObjectByName(`pantry-fallback-${id}`) ?? (t.name === `pantry-fallback-${id}` ? t : null);
      expect(fb, id).toBeTruthy();
      expect(fb!.userData.fallback, id).toBe(true);
      const mats: THREE.Material[] = [];
      t.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) mats.push(m.material as THREE.Material); });
      expect(mats.length, id).toBeGreaterThan(0);
      for (const m of mats) { expect((m as THREE.MeshStandardMaterial).isMeshStandardMaterial, id).toBe(true); expect((m as THREE.MeshStandardMaterial).map, id).toBeNull(); }
      const s = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3()), D = ITEM_DIMS[id];
      expect(Math.abs(s.y - D.h), `${id} h`).toBeLessThan(0.01);
      expect(Math.max(s.x, s.z), `${id} footprint`).toBeLessThan(Math.max(D.w, D.d) + 0.01);
      expect(itemModelSources()[id], id).toMatch(/^FALLBACK/);
      expect(pantryModelSource(id), id).toMatch(/^FALLBACK/);
    }
    // a delivered model (a stand-in box GLTF here) is fitted at ITEM_DIMS size and replaces the fallback once templates refresh
    const id = 'sardines', D = ITEM_DIMS[id];
    const scene = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(D.w * 2, D.h * 2, D.d * 2), new THREE.MeshStandardMaterial({name: 'meshy'}));
    body.position.y = D.h;
    scene.add(body);
    const display = new LotDisplay();
    display.allocate(new Map([[id, 1]]));
    const lot = {id: 1, itemId: id, matrix: new THREE.Matrix4()};
    display.show([lot], 1);
    const before = display.highlightObject!;
    try {
      registerPantryModel(id, {scene});
      expect(itemTemplate(id).getObjectByName(`pantry-fallback-${id}`)).toBeTruthy(); // (cached until refreshed)
      refreshItemTemplates([id]);
      const t = itemTemplate(id);
      expect(t.getObjectByName(`pantry-fallback-${id}`)).toBeUndefined();
      const s = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3());
      expect(Math.abs(s.y - D.h)).toBeLessThan(1e-6);
      expect(pantryModelSource(id)).toMatch(/^meshy-t2\.5/);
      // the loot display's cached highlight copy follows the new template
      display.show([lot], 1);
      const after = display.highlightObject!;
      expect(after).not.toBe(before);
      let named = false;
      after.traverse(o => { if (((o as THREE.Mesh).material as THREE.Material | undefined)?.name === 'meshy') named = true; });
      expect(named).toBe(true);
    } finally {
      registerPantryModel(id, null);
      refreshItemTemplates([id]);
      display.dispose();
    }
    expect(itemTemplate(id).getObjectByName(`pantry-fallback-${id}`)).toBeTruthy();
  });

  // the cooked GLBs come from the COOK lane (merged by the lead): checked here once they are in the tree
  for (const id of PANTRY_IDS) {
    const url = pantryModelUrl(id);
    const file = url ? path.join(PUB, url) : '';
    it.skipIf(!url || !fs.existsSync(file))(`${id}: the delivered model is at ITEM_DIMS size (+-1 cm), grounded and centred`, async () => {
      const g = await loadStripped(url!);
      g.scene.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(g.scene), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      expect(Math.abs(s.x - ITEM_DIMS[id].w), id).toBeLessThan(0.01);
      expect(Math.abs(s.y - ITEM_DIMS[id].h), id).toBeLessThan(0.01);
      expect(Math.abs(s.z - ITEM_DIMS[id].d), id).toBeLessThan(0.01);
      expect(Math.abs(b.min.y), id).toBeLessThan(0.005);
      expect(Math.hypot(c.x, c.z), id).toBeLessThan(0.01);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// the generic consume path (the REAL Game methods on a minimal shell: tests/consumable-return.test.ts)

const {Game} = await import('../src/game');
type Shell = {
  inv: Inventory; use: {t: number; total: number} | null; toasts: string[]; survival: Survival;
  startUse(r: SlotRef): void; completeUse(): void; syncHeld(): void; slotKeys(i: {hit(c: string): boolean; wheel: number}): void;
};
function shell(): Shell {
  const toasts: string[] = [];
  const s = {
    inv: starterInventory('pistol'), weapon: new WeaponController(), input: {mouse: [false, false, false]}, lmbLatch: false, use: null, consumeReturn: null, toasts, state: 'playing',
    survival: new Survival(), torch: {battery: new FlashlightBattery(() => 0.5)}, mods: {handlingMult: 1},
    player: {hp: 50, maxHp: 100, heal(n: number) { const h = Math.min(n, this.maxHp - this.hp); this.hp += h; return h; }},
    stats: {itemsUsed: 0, healed: 0}, gasMask: {transitioning: false}, flareHold: {active: false}, gear: null, invUI: {selected: null as SlotRef | null},
    injuries: {refuseReason: () => null, healNote: () => '', completeTreatment: (_d: unknown, take: () => boolean) => (take() ? {ok: true, text: 'Treated'} : {ok: false, text: 'Nothing to treat'})},
    consumeView: {start() {}, complete() {}, cancel() {}},
    sfx: {equip() {}, denied() {}, heal() {}, eat() {}, drink() {}, batteryInsert() {}},
    viewmodel: {setItem() {}},
    hud: {toast: (t: string) => { toasts.push(t); }},
  };
  Object.setPrototypeOf(s, Game.prototype);
  const g = s as unknown as Shell;
  g.survival.hunger = 20;
  g.survival.thirst = 20;
  g.syncHeld();
  return g;
}

describe('pantry food: the generic consume path, stacks', () => {
  it('each use applies the item once; the use that eats / drinks the last unit removes the stack exactly once', () => {
    for (const id of PANTRY_IDS) {
      const g = shell(), d = itemDef(id), ref: SlotRef = {bar: 'hotbar', index: 3};
      g.inv.set(ref, g.inv.makeStack(id, 2));
      const use = () => { g.startUse(ref); expect(g.use, id).not.toBeNull(); g.use!.t = g.use!.total; g.completeUse(); };
      use();
      expect(g.inv.get(ref)?.count, id).toBe(1);
      expect([g.survival.hunger, g.survival.thirst], id).toEqual([20 + (d.hunger ?? 0), 20 + (d.thirst ?? 0)]); // (from 20: never near a cap; no clamp in pantry code)
      use();
      expect(g.inv.get(ref), id).toBeNull();
      expect(g.inv.count(id), id).toBe(0);
      // nothing left: a further use is refused, nothing applied again
      const [h, t] = [g.survival.hunger, g.survival.thirst];
      g.startUse(ref);
      expect(g.use, id).toBeNull();
      expect([g.survival.hunger, g.survival.thirst], id).toEqual([h, t]);
    }
  });

  it('stacks split and merge within stackMax; inventory adds fill to stackMax and spill the rest', () => {
    for (const id of PANTRY_IDS) {
      const inv = new Inventory(), max = itemDef(id).stackMax;
      const a: SlotRef = {bar: 'pack', index: 0}, b: SlotRef = {bar: 'pack', index: 1};
      inv.set(a, inv.makeStack(id, max));
      expect(inv.moveCount(a, b, 1), id).toBe('split');
      expect([inv.get(a)?.count, inv.get(b)?.count], id).toEqual([max - 1, 1]);
      expect(inv.moveCount(b, a), id).toBe('merged');
      expect([inv.get(a)?.count, inv.get(b)], id).toEqual([max, null]);
      expect(inv.makeStack(id, max + 5).count, id).toBe(max);
      expect(inv.count(id), id).toBe(max);
      expect(inv.invariants(), id).toEqual([]);
    }
  });
});

describe('pantry food: saves', () => {
  it('inventory / Lockbox stacks, holder records with variant lot ids and loose pickups validate; a text round trip keeps them', () => {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    PANTRY_IDS.slice(0, 12).forEach((id, i) => h.inv.set({bar: 'pack', index: i}, h.inv.makeStack(id, itemDef(id).stackMax)));
    PANTRY_IDS.slice(12).forEach((id, i) => { h.train.lockbox.slots[i] = h.inv.makeStack(id, 1); });
    const mem = h.run.memory({level: 'subway', section: 'main', station: sid(0)});
    mem.visits = 2;
    mem.holders[holderKey('stockShelf', 0, 12.5, 4.25)] = {lots: [3000, variantLotId(3001, 'jerky')!, variantLotId(3502, 'uht_milk')!], open: true, searched: true};
    mem.pickups = PANTRY_IDS.map((id, i) => ({stack: {itemId: id, count: 1}, pose: {p: [i, 0, 0], q: [0, 0, 0, 1]}, anchor: [i, 0.05, 0], fromLot: {holder: 7, lot: variantLotId(7000 + i, id)!}}));
    const file = h.file();
    const r = validateSaveFile(file);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const back = parseSaveText(saveFileText(file));
    expect(back.ok, back.ok ? '' : back.error).toBe(true);
    const text = saveFileText(file);
    for (const id of PANTRY_IDS) expect(text, id).toContain(`"${id}"`);
    expect(text).toContain(String(variantLotId(3001, 'jerky')));
  });
});

describe('pantry food: market values (from the item data, like the old foods)', () => {
  it('every item has a value close to the old item it stands in for; the general store deals in them; every stall quotes a full stack', () => {
    for (const id of PANTRY_IDS) {
      expect(isTradeable(id), id).toBe(true);
      const v = baseCents(id);
      expect(v, id).toBeGreaterThan(0);
      for (const b of familiesOf(id)) {
        const ratio = v / baseCents(b);
        expect(ratio, `${id} vs ${b}`).toBeGreaterThan(0.5);
        expect(ratio, `${id} vs ${b}`).toBeLessThan(1.6);
      }
      expect(STALL_TRADE.general.deals(itemDef(id)), id).toBe(true);
      expect(buyBackPct('general', id), id).toBe(TRADE_RATES.themedPct);
      const inv = new Inventory(), whole = inv.makeStack(id, itemDef(id).stackMax);
      for (const st of MARKET_STALLS) {
        const q = sellQuote(st, whole, whole.count);
        if (!q.ok) expect(q.code, `${id}@${st}`).toBe('too-little');
      }
      expect(sellQuote('general', whole, whole.count).ok, id).toBe(true);
    }
    // the rare, dense ration brick is worth more than a tin of beans; a fruit pouch about a chocolate bar
    expect(baseCents('ration_brick')).toBeGreaterThan(baseCents('beans'));
    expect(Math.abs(baseCents('fruit_puree') / baseCents('chocolate') - 1)).toBeLessThan(0.25);
  });
});
