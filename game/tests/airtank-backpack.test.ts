// Task studio-beta-filter-tension-airtank-20261104-072836-01 (user): "reduce gas-mask filter lifetime to 25 % of current; the mask warning
// must account for usable spare filters in inventory; add an Airtank Backpack occupying the backpack slot instead of normal storage,
// capacity 400 % of the old 150 s filter" — "the air tank is consumeable and cannot be refilled" — "we're not gonna touch spawning of
// base filters at all and we'll just add the air tank and the loot table for the gear".
//
// Covered here (focused, Node): the 37.5 s filter, 600 s tank = 4 old / 16 new filters; ONE air source per frame (worn tank first, the
// fitted filter after it, spares auto-fitted only then); the tank needs a mask that is ON; the reserve-aware tone (fitted + drawable
// spares + worn tank; amber <= 30 s, red only at none) and what it never counts (a bag's contents, an unworn tank); the back slot
// without storage (no 6 / set-down, safe refused swaps, nothing lost); `air` kept per item by every copy (JSON, clone, world record,
// Lockbox, save) and never refilled; a legacy 150 s save rescaled ONCE (fraction kept, idempotent, checksum fresh); the only loot
// change = one gear-pool row (filters / masks untouched).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GAS_MASK, installGasMask, type MaskHudView} from '../src/gear/gasMask';
import {AIRTANK_AIR_S, FILTER_LIFE_S, GEAR_ITEMS, GEAR_SLOTS, LEGACY_FILTER_LIFE_S, gearStatText, isAirtank, isBagItem} from '../src/items/gear';
import {Inventory, stackFromJSON, stackToJSON, type ItemStack, type SlotRef} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import type {RunParticipant} from '../src/run/snapshot';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {TrainLockbox} from '../src/run/trainLockbox';
import {GEAR_LOOT, GEAR_WEIGHTS} from '../src/items/lootTables';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {rollLevelGear} from '../src/gen/gearLoot';
import {devGrantBundle} from '../src/items/devGrant';
import {checksumOf} from '../src/save/checksum';
import {migrateFilterUnits, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fillInventory, fixtureCampaign, sid} from './helpers/saveFixture';
import type {Game} from '../src/game';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;
const DT = 1 / 60;
const BACK: SlotRef = {bar: 'gear', index: GEAR_SLOTS.indexOf('backpack')};
const P = (index: number): SlotRef => ({bar: 'pack', index});

/** A Game shell with what GasMaskSystem touches (as tests/gas-mask.test.ts). */
function shell() {
  const toasts: {text: string; warn: boolean}[] = [];
  const calls = {battery: 0};
  let view: MaskHudView | null = null;
  const g = {
    scene: new THREE.Scene(), frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    stateListeners: [] as ((s: string, prev: string) => void)[], inputOwners: [] as (() => boolean)[], runParticipants: [] as RunParticipant[],
    invUI: {gear: {dropBag: () => null as string | null, changed: () => {}}},
    warmRegistry: {addPool: () => {}},
    inv: new Inventory(), weapon: new WeaponController(), gear: {readied: false, viewOpen: false, holdProgress: null, cancelReady() {}}, state: 'playing', player: {alive: true},
    hud: {toast: (text: string, warn = false) => { toasts.push({text, warn}); }, setMask: (v: MaskHudView | null) => { view = v; }},
    sfx: {denied() {}, batteryInsert() { calls.battery++; }, maskRustle() {}},
  };
  const sys = installGasMask(g as unknown as Game, {cancelUse: () => {}, cancelFlareHold: () => {}});
  const step = (seconds = DT, dt = DT) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) for (const f of g.frameHooks) f(dt); };
  const giveMask = (filter?: number): ItemStack => { const st = g.inv.makeStack('gas_mask', 1); if (filter !== undefined) st.filter = filter; expect(g.inv.add(st)).toBe(0); return st; };
  const giveFilters = (n: number) => { const st = g.inv.makeStack('gas_filter', n); st.count = n; expect(g.inv.add(st)).toBe(0); };
  const giveTank = (air?: number): ItemStack => { const st = g.inv.makeStack('airtank_backpack', 1); if (air !== undefined) st.air = air; expect(g.inv.add(st)).toBe(0); return st; };
  const toggle = () => { sys.press(); step(0.7); }; // 0.6 s donning + 0.1 s on
  return {g, sys, toasts, calls, step, giveMask, giveFilters, giveTank, toggle, view: () => view};
}

describe('the numbers and the item', () => {
  it('a filter lasts 37.5 s (a quarter of 150 s, not 112.5); a full Airtank Backpack 600 s = 4 old / 16 new filters', () => {
    expect(FILTER_LIFE_S).toBe(37.5);
    expect(LEGACY_FILTER_LIFE_S * 0.25).toBe(FILTER_LIFE_S);
    expect(GAS_MASK.filterLifeS).toBe(FILTER_LIFE_S);
    expect(GEAR_ITEMS.gas_mask.gear!.filterLife).toBe(37.5);
    expect(AIRTANK_AIR_S).toBe(600);
    expect(AIRTANK_AIR_S).toBe(4 * LEGACY_FILTER_LIFE_S);
    expect(AIRTANK_AIR_S).toBe(16 * FILTER_LIFE_S);
    expect(gearStatText(GEAR_ITEMS.gas_mask.gear!)).toMatch(/one filter lasts 37.5 s/);
  });

  it('"Airtank Backpack": back-slot gear without storage (not a bag), 600 s of air, a NEW tank is full, a copy without air reads empty', () => {
    const d = GEAR_ITEMS.airtank_backpack;
    expect(d).toMatchObject({id: 'airtank_backpack', name: 'Airtank Backpack', kind: 'gear', stackMax: 1});
    expect(d.gear).toMatchObject({slot: 'backpack', tier: 1, airLife: 600});
    expect(d.gear!.bagSlots).toBeUndefined();
    expect(isBagItem('airtank_backpack')).toBe(false);
    expect(isAirtank('airtank_backpack')).toBe(true);
    expect(isAirtank('backpack')).toBe(false);
    expect(d.description).toMatch(/cannot be refilled/);
    expect(gearStatText(d.gear!)).toMatch(/10 min of air .* no storage · cannot be refilled/);
    const inv = new Inventory();
    const t = inv.makeStack('airtank_backpack', 1);
    expect(t.air).toBe(600);
    expect(t.bag).toBeUndefined();
    expect(stackFromJSON({uid: 9, itemId: 'airtank_backpack', count: 1})!.air).toBeUndefined(); // undefined = empty, never full
  });
});

describe('one air source at a time: the worn tank first, then the fitted filter, then the spares', () => {
  it('mask ON + worn tank: only the tank drains (the filter is untouched, no spare drawn); empty mid-frame -> the rest from the filter', () => {
    const s = shell();
    const m = s.giveMask(20);
    s.giveFilters(2);
    const t = s.giveTank(5);
    expect(s.g.inv.get(BACK)).toBe(t); // worn on pickup (the back slot was free)
    s.step(10); // OFF the face: nothing drains, even with a tank on the back
    expect([t.air, m.filter]).toEqual([5, 20]);
    s.toggle();
    expect(t.air).toBeCloseTo(4.9, 9);
    expect(m.filter).toBe(20);
    expect(s.sys.protects()).toBe(true);
    s.step(4.8, 0.05);
    expect(t.air!).toBeCloseTo(0.1, 6);
    expect(m.filter).toBe(20);
    s.step(0.25, 0.25); // 0.1 s of tank + 0.15 s of filter in the same frame — never both drawn for the same second
    expect(t.air).toBe(0);
    expect(m.filter!).toBeCloseTo(20 - 0.15, 9);
    expect(s.toasts.filter(x => /^Airtank empty — now on the mask filter \(\d+ % · 2 spare\)\. It cannot be refilled\.$/.test(x.text))).toHaveLength(1);
    expect(s.calls.battery).toBe(0);
    expect(s.g.inv.count('gas_filter')).toBe(2);
    s.step(60, 0.05); // the filter, then a spare, as before
    expect(s.calls.battery).toBeGreaterThanOrEqual(1);
    expect(t.air).toBe(0); // never refilled
    expect(s.g.inv.get(BACK)).toBe(t); // an empty tank stays an inert back item until you take it off
  });

  it('the tank protects with an empty fitted filter (no spare drawn while it supplies air); without the mask ON it is no protection', () => {
    const s = shell();
    const m = s.giveMask(0);
    s.giveFilters(1);
    const t = s.giveTank();
    expect(s.sys.protects()).toBe(false); // mask off
    s.toggle();
    expect(s.sys.protects()).toBe(true);
    s.step(30, 0.05);
    expect(m.filter).toBe(0);
    expect(s.g.inv.count('gas_filter')).toBe(1); // not drawn: the tank supplies the air
    expect(t.air!).toBeCloseTo(600 - 30.1, 6);
    s.sys.press(); // taking the mask off: unprotected at once, the tank stops
    s.step(1);
    expect(s.sys.protects()).toBe(false);
    const left = t.air!;
    s.step(20);
    expect(t.air).toBe(left);
  });

  it('a tank that is not WORN (in the pockets) supplies nothing; a tank without a mask equipped protects nothing', () => {
    const s = shell();
    const bag = s.g.inv.makeStack('backpack', 1);
    expect(s.g.inv.add(bag)).toBe(0); // the back slot holds a bag
    const t = s.giveTank(); // -> the pockets
    expect(s.g.inv.get(BACK)).toBe(bag);
    expect(s.g.inv.find(t.uid)?.bar).toBe('pack');
    const m = s.giveMask(10);
    s.toggle();
    s.step(5, 0.05);
    expect(t.air).toBe(600);
    expect(m.filter!).toBeLessThan(10);
    expect(s.sys.reserveSeconds).toBeCloseTo(m.filter!, 9); // the pocketed tank is not counted
    const s2 = shell();
    s2.giveTank();
    expect(s2.sys.press()).toBe('no-mask');
    expect(s2.sys.protects()).toBe(false);
    expect(s2.sys.reserveSeconds).toBe(0);
  });
});

describe('the reserve-aware warning (tone: HUD Q cell, visor rim, toasts)', () => {
  it('counts the fitted filter + spares the auto-fit can draw + a worn tank; amber at <= 30 s, red only with nothing usable', () => {
    const s = shell();
    const m = s.giveMask(2);
    expect(s.sys.tone).toBe('low'); // 2 s in all
    s.giveFilters(1);
    expect(s.sys.reserveSeconds).toBeCloseTo(2 + 37.5, 9);
    expect(s.sys.tone).toBe('ok'); // a spare that will refill it: no false alarm (updates on the inventory change)
    m.filter = 0;
    expect(s.sys.tone).toBe('ok'); // an EMPTY fitted filter but a usable spare: not red
    s.g.inv.take('gas_filter', 1);
    expect(s.sys.tone).toBe('empty');
    expect(s.sys.reserveSeconds).toBe(0);
    m.filter = 30;
    expect(s.sys.tone).toBe('low');
    m.filter = 30.01;
    expect(s.sys.tone).toBe('ok');
    m.filter = 0;
    const t = s.giveTank(31);
    expect([s.sys.tone, s.sys.reserveSeconds]).toEqual(['ok', 31]);
    t.air = 0;
    expect(s.sys.tone).toBe('empty'); // an empty tank is no reserve
    s.step(DT);
    expect(s.view()).toMatchObject({tone: 'empty', reserveS: 0, tankS: 0});
  });

  it('never counts spares it cannot draw: a bag\'s contents (worn or grounded), the Lockbox; a tank only while worn', () => {
    const s = shell();
    s.giveMask(10);
    const bag = s.g.inv.makeStack('backpack', 1);
    bag.bag![0] = s.g.inv.makeStack('gas_filter', 6);
    expect(s.g.inv.add(bag)).toBe(0); // worn, 6 filters inside: out of reach of the auto-fit
    expect(s.sys.reserveSeconds).toBeCloseTo(10, 9);
    expect(s.sys.tone).toBe('low');
    const box = new TrainLockbox();
    box.slots[0] = s.g.inv.makeStack('gas_filter', 6);
    expect(s.sys.reserveSeconds).toBeCloseTo(10, 9);
    // moving one spare into the pockets: now drawable, counted at once
    s.g.inv.set(P(4), s.g.inv.makeStack('gas_filter', 1));
    expect(s.sys.reserveSeconds).toBeCloseTo(47.5, 9);
    expect(s.sys.tone).toBe('ok');
  });

  it('one low toast per crossing of the 30 s mark (re-armed above it); a pickup ends the alarm', () => {
    const s = shell();
    s.giveMask(35);
    s.toggle();
    s.step(6, 0.05);
    expect(s.toasts.filter(t => /^Gas mask air low — \d+ s of protection left · no spare filter$/.test(t.text) && t.warn)).toHaveLength(1);
    expect(s.sys.tone).toBe('low');
    s.giveFilters(1);
    s.step(DT);
    expect(s.sys.tone).toBe('ok');
    s.step(40, 0.05); // ~66 s -> the spare goes in -> back below 30 s: warned again, once
    expect(s.toasts.filter(t => /air low/.test(t.text))).toHaveLength(2);
  });
});

describe('the back slot without storage: safe moves, no grounded tank bag, nothing lost', () => {
  it('wearing the tank over a worn backpack is refused (a bag never goes into the pockets) — nothing moved, contents intact', () => {
    const inv = new Inventory();
    const bag = inv.makeStack('backpack', 1);
    bag.bag![2] = inv.makeStack('water', 2);
    expect(inv.add(bag)).toBe(0);
    const t = inv.makeStack('airtank_backpack', 1);
    expect(inv.add(t)).toBe(0);
    const at = inv.find(t.uid)!;
    expect(at.bar).toBe('pack');
    expect(inv.wearFrom(at)).toBe('refused');
    expect(inv.refusal?.code).toBe('bag-not-pocketable');
    expect(inv.get(BACK)).toBe(bag);
    expect(bag.bag![2]).toMatchObject({itemId: 'water', count: 2});
    expect(inv.find(t.uid)).toEqual(at);
    expect(inv.invariants()).toEqual([]);
  });

  it('with the back slot free it is worn / taken off like any gear (no contents); a backpack cannot go on while it is worn', () => {
    const inv = new Inventory();
    const t = inv.makeStack('airtank_backpack', 1);
    t.air = 123.5;
    inv.set(P(0), t);
    expect(inv.wearFrom(P(0))).toBe('moved');
    expect(inv.get(BACK)).toBe(t);
    expect(inv.wornBag()).toBeNull(); // the 6 / set-down / bag paths see no bag
    const bag = inv.makeStack('backpack', 1);
    expect(inv.wearBag(bag)).toBe(false);
    expect(inv.refusal?.text).toBe('You are wearing the Airtank Backpack — take it off first (Tab: gear).');
    expect(inv.add(bag)).toBe(1); // a picked-up backpack is refused (it never goes into the pockets)
    expect(inv.refusal?.text).toMatch(/Airtank Backpack — take it off first/);
    expect(inv.takeOff('backpack')).toBe('moved');
    expect(inv.get(BACK)).toBeNull();
    expect(inv.find(t.uid)?.bar).toBe('pack');
    expect(t.air).toBe(123.5);
    expect(inv.invariants()).toEqual([]);
  });

  it('key 6 never turns a worn tank into a grounded bag (it would be invisible storage): refused with a short toast', async () => {
    const {installGear} = await import('../src/gear/system');
    const toasts: string[] = [];
    const g = {
      scene: new THREE.Scene(), modifierSources: [] as unknown[], frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as unknown[], hitListeners: [] as unknown[],
      sectionHooks: [] as unknown[], stateListeners: [] as unknown[], promptProviders: [] as unknown[], inputOwners: [] as unknown[],
      warmRegistry: {addPool: () => {}}, invUI: {gear: null as unknown},
      input: {onLockChange: () => {}, clears: 0, pressed: new Set<string>(), mouse: [false, false, false], mousePressed: [false, false, false], wheel: 0, locked: true, hit(c: string) { return this.pressed.has(c); }, unlock() {}, lock: () => Promise.resolve(true)},
      inv: new Inventory(), weapon: new WeaponController(), player: {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, climbing: false, grounded: true, alive: true, eye: 1.6},
      consumeView: {busy: false}, viewmodel: {setItem: () => {}}, sfx: {equip() {}, denied() {}, pickup() {}, search() {}}, hud: {toast: (t: string) => { toasts.push(t); }},
      flareHold: {active: false, cancel: () => false}, syncHeld() {}, camera: new THREE.PerspectiveCamera(), state: 'playing', qa: true,
    };
    const sys = installGear(g as unknown as Game);
    const t = g.inv.makeStack('airtank_backpack', 1);
    expect(g.inv.add(t)).toBe(0);
    expect(sys.ready()).toBe(false);
    expect(sys.readied).toBe(false);
    expect(toasts.at(-1)).toBe('The Airtank Backpack has no storage to set down — take it off in Tab: gear');
    expect(sys.placeFromInventory()).not.toBeNull(); // the drag-out set-down path refuses too (the UI drops it like a vest instead)
    expect(g.inv.get(BACK)).toBe(t);
    expect(t.bag).toBeUndefined();
    expect(sys.bags).toHaveLength(0);
  });
});

describe('the air belongs to that tank: every copy keeps it, nothing refills it', () => {
  it('StackJSON / clone / world record / Lockbox keep `air` exactly (0 stays 0); invariants reject air on other items or out of range', () => {
    const inv = new Inventory();
    const t = inv.makeStack('airtank_backpack', 1);
    t.air = 0;
    inv.set(P(2), t);
    expect(stackToJSON(t)).toEqual({uid: t.uid, itemId: 'airtank_backpack', count: 1, air: 0});
    expect(stackFromJSON(stackToJSON(t))).toEqual(t);
    expect(inv.clone().get(P(2))).toMatchObject({uid: t.uid, air: 0});
    expect(Inventory.fromJSON(inv.toJSON()).get(P(2))).toMatchObject({air: 0});
    const back = stackFromRecord(inv, stackRecord(t)); // a dropped / remembered tank: a fresh uid, the SAME air (makeStack's full one is overwritten)
    expect(back.air).toBe(0);
    t.air = 333.25;
    const box = new TrainLockbox();
    box.slots[7] = t;
    const other = new TrainLockbox();
    other.load(structuredClone(box.toJSON()));
    expect(other.slots[7]).toMatchObject({itemId: 'airtank_backpack', air: 333.25});
    const raw = structuredClone(box.toJSON()) as Any;
    raw.slots[7].air = 9999;
    const clamp = new TrainLockbox();
    clamp.load(raw);
    expect(clamp.slots[7]!.air).toBe(600);
    const bad = new Inventory();
    const w = bad.makeStack('water', 1);
    (w as Any).air = 5;
    bad.add(w);
    expect(bad.invariants().some(x => /non-airtank water carries air/.test(x))).toBe(true);
    const over = new Inventory();
    const t2 = over.makeStack('airtank_backpack', 1);
    t2.air = 601;
    over.add(t2);
    expect(over.invariants().some(x => /bad air/.test(x))).toBe(true);
  });

  it('saves: worn, pocketed and stowed tanks round-trip exactly; bad air values are refused; no save wipe', () => {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    const worn = h.inv.makeStack('airtank_backpack', 1);
    worn.air = 412.75;
    h.inv.gearSlots[GEAR_SLOTS.indexOf('backpack')] = worn;
    const stowed = h.inv.makeStack('airtank_backpack', 1);
    stowed.air = 0;
    h.train.lockbox.slots[3] = stowed;
    const file = h.file('arrival', 1);
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const v = (p as {value: SaveFileV1Like}).value;
    expect(v.run.carry.inventory.gear.backpack).toMatchObject({itemId: 'airtank_backpack', air: 412.75});
    expect(v.run.filterLifeS).toBe(37.5);
    const rejects = (mut: (f: Any) => void, re: RegExp) => {
      const f = structuredClone(file) as Any;
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    rejects(f => { f.run.carry.inventory.gear.backpack.air = 600.5; }, /out of range/);
    rejects(f => { f.run.carry.inventory.gear.backpack.air = -1; }, /out of range/);
    rejects(f => { f.run.carry.inventory.gear.backpack.air = 'full'; }, /finite number/);
    rejects(f => { f.run.carry.inventory.hotbar[0] = {uid: 99999, itemId: 'water', count: 1, air: 5}; }, /holds no air/);
  });
});

describe('old saves: filters written in 150 s units are rescaled once (same fraction), idempotent', () => {
  /** An older build's save: no filterLifeS, every fitted-filter charge in 150 s units (x4 of today's), checksum of that run. */
  function legacyFile(): {legacy: Any; now: SaveFileV1Like} {
    const h = new Harness(fixtureCampaign());
    fillInventory(h);
    const lockMask = h.inv.makeStack('gas_mask', 1);
    lockMask.filter = 30; // 80 % of a filter today
    h.train.lockbox.slots[0] = lockMask;
    const now = h.file('arrival', 1);
    const legacy = structuredClone(now) as Any;
    delete legacy.run.filterLifeS;
    const walk = (o: Any): void => {
      if (!o || typeof o !== 'object') return;
      if (o.itemId === 'gas_mask' && typeof o.filter === 'number') o.filter *= 4;
      for (const v of Object.values(o)) walk(v);
    };
    walk(legacy.run);
    legacy.checksum = checksumOf(legacy.run);
    return {legacy, now};
  }

  it('a legacy 150 s save loads with each mask at the same fraction of a 37.5 s filter, carrying today\'s units and its own checksum', () => {
    const {legacy, now} = legacyFile();
    expect(legacy.run.carry.inventory.gear.mask.filter).toBe(88.25); // (fillInventory: 22.0625 today = 88.25 of 150 s)
    const r = validateSaveFile(structuredClone(legacy));
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const v = (r as {value: SaveFileV1Like}).value;
    expect(v.run.filterLifeS).toBe(37.5);
    expect(v.run.carry.inventory.gear.mask!.filter).toBe(22.0625);
    expect(v.run).toEqual(now.run); // exactly today's run: every mask everywhere (carry, Retry entry, Lockbox, memories) rescaled
    expect(v.checksum).toBe(checksumOf(v.run));
    // idempotent: the migrated value validates as is and is NOT rescaled again; its text round-trips unchanged
    const again = validateSaveFile(structuredClone(v));
    expect(again.ok).toBe(true);
    expect((again as {value: SaveFileV1Like}).value.run).toEqual(v.run);
    const text = parseSaveText(saveFileText(v));
    expect((text as {value: SaveFileV1Like}).value.run).toEqual(v.run);
    expect(migrateFilterUnits(v.run)).toBe(v.run);
  });

  it('legacy bounds: a full 150 s filter becomes exactly one 37.5 s filter; > 150 s is still refused; a current save keeps <= 37.5 s', () => {
    const {legacy} = legacyFile();
    legacy.run.carry.inventory.gear.mask.filter = 150;
    legacy.checksum = checksumOf(legacy.run);
    const ok = validateSaveFile(structuredClone(legacy));
    expect((ok as {value: SaveFileV1Like}).value.run.carry.inventory.gear.mask!.filter).toBe(37.5);
    legacy.run.carry.inventory.gear.mask.filter = 150.5;
    legacy.checksum = checksumOf(legacy.run);
    expect(validateSaveFile(structuredClone(legacy)).ok).toBe(false);
    const cur = structuredClone(legacyFile().now) as Any;
    cur.run.carry.inventory.gear.mask.filter = 37.6;
    cur.checksum = checksumOf(cur.run);
    expect((validateSaveFile(cur) as {error: string}).error).toMatch(/mask\.filter: 37.6 is out of range/);
  });
});

describe('loot: ONE new normal gear-pool row; base filters, masks and the gear count are untouched', () => {
  it('GEAR_WEIGHTS = the previous weights + airtank_backpack 0.8; mean / cap unchanged; mask-loot tables unchanged on every level', () => {
    expect(GEAR_WEIGHTS).toEqual({armor_vest: 1, chest_rig: 1, backpack: 1.4, helmet: 1, boots: 1, gloves: 1, airtank_backpack: 0.8});
    expect([GEAR_LOOT.mean, GEAR_LOOT.cap]).toEqual([1, 5]);
    expect(MASK_LOOT.levels).toEqual({office: {masks: [1, 2], filters: [2, 5]}, subway: {masks: [0, 1], filters: [0, 2]}, mall: {masks: [1, 2], filters: [2, 5]}, reactor: {masks: [1, 1], filters: [3, 5]}});
    expect(MASK_LOOT.foundFilter).toEqual([0.35, 0.75]);
  });

  it('the level gear roll can deal an Airtank Backpack (rarely) with the same per-level counts; the dev bundle never holds one', () => {
    let tanks = 0, total = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = rollLevelGear(seed * 7919, 'subway', ['main']);
      total += r.main.length;
      tanks += r.main.filter(a => a.itemId === 'airtank_backpack').length;
    }
    expect(tanks).toBeGreaterThan(0);
    expect(tanks / total).toBeLessThan(0.2); // a little rarer than a base piece (weight 0.8 of 7.2)
    expect(devGrantBundle().some(l => l.itemId === 'airtank_backpack')).toBe(false);
  });
});
