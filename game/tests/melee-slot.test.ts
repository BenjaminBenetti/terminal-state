// Task knife-windup-20261030 (lane SLOT), user: "just the same way we have a custom ... grenade slot ... I want a custom melee
// weapon slot and so you hit the tilde key to switch to your knife ... tilde key is always melee weapon slot and you equip your
// knife in the melee weapon slot so that way it doesn't take up a hot[bar] slot".
// Node tests over the real code: items/inventory.ts (the melee slot: melee-only rules, pickups, bag transfers, selection, snapshot
// v3 + the v1 / v2 migration of a carried knife), run/starter.ts (knife in the melee slot, quick slot 3 empty, pistol selected),
// run/snapshot.ts (Retry / NewGame / travel), player/input.ts (Backquote with / without modifiers or typing — the real keydown
// listener on a stub window), Game's real selection methods (slotKeys / selectSlot / selectMelee / syncHeld / equipRef on a minimal
// Game shell with the real WeaponController), ui/hud.ts (the ~ cell), ui/inventoryUI.ts (the melee cell, ~ assign, drop rules) and
// the responsive hotbar CSS (the 8-cell bar fits between the vitals and the weapon panel down to 960 px).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {INVENTORY_JSON_VERSION, Inventory, MELEE_REF, PACK_SIZE, isMeleeItem, type InventoryJSON, type SlotRef} from '../src/items/inventory';
import {ITEMS, type ItemDef} from '../src/items/items';
import {WEAPONS, WeaponController, type WeaponDef} from '../src/weapons/weapons';
import {starterInventory} from '../src/run/starter';
import type {GearSlot} from '../src/items/gear';
import {restoreCarry, takeSnapshot} from '../src/run/snapshot';
import {Survival} from '../src/player/survival';
import {FlashlightBattery} from '../src/player/flashlight';
import {Input, MELEE_KEY, isMeleeKey, isTypingTarget, shouldPreventKey} from '../src/player/input';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

installCanvasShim(false);

const SRC = (p: string) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const knivesIn = (inv: Inventory) => inv.allStacks(true).filter(s => s.itemId === 'knife');
// a legacy (pre-gas-mask) snapshot's gear: no 'mask' key — the loader treats a missing slot as empty
const NO_GEAR = {helmet: null, chest: null, gloves: null, boots: null, backpack: null} as Record<GearSlot, null>;
const emptyPack = (n = PACK_SIZE) => new Array(n).fill(null);

// ---------------------------------------------------------------------------------------------------------------------
describe('the melee slot takes melee weapons only (a genuine equipment slot)', () => {
  it('set / move / swap: anything that is not a melee weapon is refused with a reason (nothing moves); the knife goes in as the same object', () => {
    const inv = new Inventory();
    for (const id of ['pistol', 'rifle', 'shotgun', 'ammo_9mm', 'bandage', 'water', 'battery', 'flare', 'backpack', 'helmet', 'armor_vest']) {
      inv.set(MELEE_REF, inv.makeStack(id, 1));
      expect(inv.refusal?.code, id).toBe('wrong-slot');
      expect(inv.melee, id).toBeNull();
    }
    expect(isMeleeItem('knife')).toBe(true);
    for (const id of ['pistol', 'flare', 'backpack', null, undefined]) expect(isMeleeItem(id)).toBe(false);
    const gun = inv.makeStack('pistol', 1, 15), knife = inv.makeStack('knife', 1);
    inv.set(P(0), gun);
    inv.set(P(1), knife);
    expect(inv.moveCount(P(0), MELEE_REF)).toBe('refused');
    expect(inv.refusal?.text).toMatch(/Only melee weapons .* melee slot \(~\) — not the pistol/);
    expect(inv.moveCount(P(1), MELEE_REF)).toBe('moved');
    expect(inv.melee).toBe(knife);
    expect(inv.moveCount(P(0), MELEE_REF)).toBe('refused'); // a swap would put the pistol in it
    expect(inv.moveCount(MELEE_REF, P(0))).toBe('refused'); // ... and the swap back too
    expect([inv.melee, inv.pack[0]]).toEqual([knife, gun]);
    const second = inv.makeStack('knife', 1);
    inv.set(P(2), second);
    expect(inv.moveCount(P(2), MELEE_REF)).toBe('swapped'); // melee <-> melee is fine
    expect([inv.melee, inv.pack[2]]).toEqual([second, knife]);
    expect(inv.moveCount(MELEE_REF, H(3))).toBe('moved'); // out of the slot: an ordinary item again
    expect([inv.melee, inv.hotbar[3]]).toEqual([null, second]);
    expect(inv.invariants()).toEqual([]);
  });

  it('not a hardcoded knife button: a future melee weapon (registered at runtime) is accepted, picked into the slot and drawn', () => {
    const W = WEAPONS as Record<string, WeaponDef>, I = ITEMS as Record<string, ItemDef>;
    W.crowbar = {...WEAPONS.knife, id: 'crowbar', itemId: 'crowbar'};
    I.crowbar = {...ITEMS.knife, id: 'crowbar', weaponId: 'crowbar', name: 'Crowbar', short: 'Crowbar'};
    try {
      expect(isMeleeItem('crowbar')).toBe(true);
      const inv = new Inventory();
      const bar = inv.makeStack('crowbar', 1);
      expect(inv.add(bar)).toBe(0);
      expect(inv.melee).toBe(bar);
      expect(inv.selectMelee()).toBe(true);
      expect(inv.selectedStack()).toBe(bar);
      const knife = inv.makeStack('knife', 1);
      inv.set(P(0), knife);
      expect(inv.equipMeleeFrom(P(0))).toBe('swapped'); // the crowbar goes back where the knife was
      expect([inv.melee, inv.pack[0]]).toEqual([knife, bar]);
      expect(inv.invariants()).toEqual([]);
    } finally {
      delete W.crowbar;
      delete I.crowbar;
    }
    expect(isMeleeItem('crowbar')).toBe(false);
  });

  it('pickups: a knife fills an EMPTY melee slot first (same object); a second one is an ordinary item; room counts the slot; guns never go there', () => {
    const inv = new Inventory();
    for (let i = 0; i < 5; i++) inv.set(H(i), inv.makeStack('bandage', 5));
    for (let i = 0; i < PACK_SIZE; i++) inv.set(P(i), inv.makeStack('chocolate', 6));
    expect(inv.hasRoomFor('water')).toBe(false);
    expect(inv.hasRoomFor('knife')).toBe(true); // the empty melee slot
    const k = inv.makeStack('knife', 1);
    expect(inv.add(k)).toBe(0);
    expect(inv.melee).toBe(k);
    expect(inv.hasRoomFor('knife')).toBe(false);
    expect(inv.add(inv.makeStack('knife', 1))).toBe(1); // nowhere left: refused, nothing lost
    const inv2 = new Inventory();
    const a = inv2.makeStack('knife', 1), b = inv2.makeStack('knife', 1);
    inv2.add(a);
    inv2.add(b);
    expect([inv2.melee, inv2.hotbar[0]]).toEqual([a, b]); // the second knife: normal weapon order (quick slots first)
    const inv3 = new Inventory();
    inv3.add(inv3.makeStack('pistol', 1, 15));
    expect(inv3.melee).toBeNull();
    expect(inv3.hotbar[0]?.itemId).toBe('pistol');
    for (const x of [inv, inv2, inv3]) expect(x.invariants()).toEqual([]);
  });

  it('count / find / holds / allStacks / take / detach include it; consumeAt never uses a melee weapon up', () => {
    const inv = starterInventory('pistol');
    const k = inv.melee!;
    expect(inv.count('knife')).toBe(1);
    expect(inv.find(k.uid)).toEqual(MELEE_REF);
    expect(inv.holds(k)).toBe(true);
    expect(inv.allStacks()).toContain(k);
    expect(inv.consumeAt(MELEE_REF)).toBe(false);
    expect(inv.melee).toBe(k);
    expect(inv.detach(MELEE_REF)).toBe(k); // drop: the same object (uid, mag 0)
    expect(inv.melee).toBeNull();
    inv.set(MELEE_REF, k);
    expect(inv.take('knife', 1)).toBe(1);
    expect(inv.melee).toBeNull();
    expect(inv.invariants()).toEqual([]);
  });

  it('grounded-bag transfers (bag sessions): knife into a bag and back (filling the empty slot first); non-melee refused there', () => {
    const inv = starterInventory('pistol');
    const bag = inv.makeStack('backpack', 1); // a bag lying on the ground (not worn)
    expect(inv.bagQuick(bag, MELEE_REF)).toBe(1);
    expect(inv.melee).toBeNull();
    const at = bag.bag!.findIndex(s => s?.itemId === 'knife');
    expect(at).toBeGreaterThanOrEqual(0);
    inv.set(P(5), inv.makeStack('water', 1));
    expect(inv.bagMove(bag, P(5), MELEE_REF)).toBe('refused');
    expect(inv.bagQuick(bag, {bar: 'bag', index: at})).toBe(1);
    expect(inv.melee?.itemId).toBe('knife');
    expect(inv.bagMove(bag, MELEE_REF, {bar: 'bag', index: 0})).toBe('moved'); // drag out into the bag
    expect(inv.bagMove(bag, {bar: 'bag', index: 0}, MELEE_REF)).toBe('moved'); // and onto the slot again
    expect(inv.melee?.itemId).toBe('knife');
    expect(inv.invariants()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('selection: ~ draws the melee slot, 1-5 / wheel leave it, the remembered quick slot is kept', () => {
  it('selectMelee / select / cycle / selectedStack / selectedRef', () => {
    const inv = starterInventory('pistol');
    const gun = inv.hotbar[0]!, knife = inv.melee!;
    expect([inv.meleeSelected, inv.selected, inv.selectedStack()]).toEqual([false, 0, gun]);
    expect(inv.selectedRef()).toEqual(H(0));
    const v = inv.version;
    expect(inv.selectMelee()).toBe(true);
    expect(inv.version).toBeGreaterThan(v); // the HUD redraws
    expect([inv.meleeSelected, inv.selected, inv.selectedStack()]).toEqual([true, 0, knife]);
    expect(inv.selectedRef()).toEqual(MELEE_REF);
    inv.cycle(1); // the wheel from the melee slot: back to the remembered quick slot first
    expect([inv.meleeSelected, inv.selected]).toEqual([false, 0]);
    inv.cycle(1);
    expect(inv.selected).toBe(1);
    inv.selectMelee();
    inv.select(4); // a number key leaves the melee slot
    expect([inv.meleeSelected, inv.selectedStack()?.itemId]).toEqual([false, 'bandage']);
    expect(inv.invariants()).toEqual([]);
  });

  it('an empty melee slot cannot be selected; emptying it while drawn falls back to the quick slot; a knife found later never draws itself', () => {
    const inv = starterInventory('pistol');
    const knife = inv.detach(MELEE_REF)!;
    expect(inv.selectMelee()).toBe(false);
    expect([inv.meleeSelected, inv.selectedStack()?.itemId]).toEqual([false, 'pistol']);
    inv.add(knife);
    inv.selectMelee();
    for (const empty of [(i: Inventory) => i.detach(MELEE_REF), (i: Inventory) => i.moveCount(MELEE_REF, P(9)), (i: Inventory) => i.take('knife', 1),
      (i: Inventory) => i.set(MELEE_REF, null), (i: Inventory) => i.bagQuick(i.makeStack('backpack', 1), MELEE_REF)]) {
      inv.allStacks().filter(s => s.itemId === 'knife' && s !== inv.melee).forEach(s => inv.remove(inv.find(s.uid)!));
      if (!inv.melee) inv.set(MELEE_REF, inv.makeStack('knife', 1));
      inv.selectMelee();
      expect(inv.selectedStack()?.itemId).toBe('knife');
      empty(inv);
      expect(inv.meleeSelected).toBe(false);
      expect(inv.selectedStack()?.itemId).toBe('pistol'); // never a stale knife
      inv.allStacks().filter(s => s.itemId === 'knife').forEach(s => inv.remove(inv.find(s.uid)!));
      inv.add(inv.makeStack('knife', 1)); // picked up again: into the slot, NOT drawn
      expect(inv.melee?.itemId).toBe('knife');
      expect(inv.meleeSelected).toBe(false);
    }
    expect(inv.invariants()).toEqual([]);
  });

  it('refillMeleeSlot (like the grenade slot\'s refill): pockets first, the held quick slot last; equipMeleeFrom moves / swaps / refuses', () => {
    const inv = new Inventory();
    expect(inv.refillMeleeSlot()).toBe(false);
    const held = inv.makeStack('knife', 1), pocket = inv.makeStack('knife', 1);
    inv.set(H(2), held);
    inv.select(2);
    inv.set(P(4), pocket);
    expect(inv.refillMeleeSlot()).toBe(true);
    expect(inv.melee).toBe(pocket);
    expect(inv.selectedStack()).toBe(held);
    inv.detach(MELEE_REF);
    expect(inv.refillMeleeSlot()).toBe(true);
    expect(inv.melee).toBe(held); // only the held one was left
    expect(inv.refillMeleeSlot()).toBe(true); // already full: unchanged
    inv.set(P(0), inv.makeStack('pistol', 1, 15));
    expect(inv.equipMeleeFrom(P(0))).toBe('refused');
    expect(inv.refusal?.code).toBe('wrong-slot');
    expect(inv.equipMeleeFrom(MELEE_REF)).toBe('none');
    expect(inv.invariants()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('starter kit, Retry, NewGame, travel: the knife in the melee slot, quick slot 3 free, the pistol selected', () => {
  const carry = () => ({player: {hp: 80, stamina: 60, damageTaken: 20}, survival: new Survival(), battery: new FlashlightBattery(() => 0.5),
    stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}});

  it('fresh spawn: full kit, pistol selected, knife in the melee slot, quick slots 2-4 empty (a found gun takes slot 2, then 3)', () => {
    const inv = starterInventory('pistol');
    expect(inv.hotbar.map(s => s?.itemId ?? null)).toEqual(['pistol', null, null, null, 'bandage']);
    expect(inv.hotbar[0]!.mag).toBe(WEAPONS.pistol.magazine);
    expect(inv.count('ammo_9mm')).toBe(45);
    expect(inv.thrown?.itemId).toBe('flare');
    expect(inv.melee).toMatchObject({itemId: 'knife', count: 1, mag: 0});
    expect([inv.selected, inv.meleeSelected]).toEqual([0, false]);
    expect(knivesIn(inv)).toHaveLength(1);
    inv.add(inv.makeStack('rifle', 1, 30));
    inv.add(inv.makeStack('shotgun', 1, 6));
    expect(inv.hotbar.map(s => s?.itemId ?? null)).toEqual(['pistol', 'rifle', 'shotgun', null, 'bandage']); // quick slot 3 was free
    expect(inv.invariants()).toEqual([]);
  });

  it('Retry restores the melee slot and the selection exactly as entered; NewGame hands out one fresh knife; travel keeps the same one', () => {
    const inv = starterInventory('pistol');
    inv.selectMelee(); // entered the level with the knife drawn
    const c = carry();
    const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}}, {inv, ...c, participants: []}, {});
    const uid = inv.melee!.uid;
    inv.detach(MELEE_REF);
    inv.select(1);
    for (let round = 0; round < 2; round++) {
      const r = restoreCarry(snap, c);
      expect(r.melee).toMatchObject({uid, itemId: 'knife', mag: 0});
      expect([r.meleeSelected, r.selected]).toEqual([true, 0]);
      expect(knivesIn(r)).toHaveLength(1);
      expect(r.hotbar[2]).toBeNull();
      expect(r.invariants()).toEqual([]);
      r.detach(MELEE_REF); // play on with the copy: the snapshot stays intact
    }
    for (let i = 0; i < 3; i++) { const n = starterInventory('pistol'); expect([knivesIn(n).length, n.meleeSelected]).toEqual([1, false]); }
    const live = starterInventory('pistol');
    live.selectMelee();
    const k = live.melee!, slot = live.meleeSlot;
    live.loadJSON(live.toJSON()); // Game.installInventory (travel / Retry install in place)
    expect(live.meleeSlot).toBe(slot);
    expect([live.melee!.uid, live.meleeSelected, knivesIn(live).length]).toEqual([k.uid, true, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('snapshots: v3 carries the melee slot; v1 / v2 (older carryover / Retry data) migrate the carried knife once', () => {
  it('toJSON / fromJSON / clone / loadJSON: deep, same uids, selection kept, nextUid above it', () => {
    const inv = starterInventory('pistol');
    inv.selectMelee();
    const j = inv.toJSON();
    expect(INVENTORY_JSON_VERSION).toBe(3);
    expect(j.v).toBe(3);
    expect(j.melee).toEqual([{uid: inv.melee!.uid, itemId: 'knife', count: 1, mag: 0}]);
    expect([j.selected, j.meleeSelected]).toEqual([0, true]);
    for (const x of [inv.clone(), Inventory.fromJSON(JSON.parse(JSON.stringify(j)))]) {
      expect(x.toJSON()).toEqual(j);
      expect(x.melee).not.toBe(inv.melee);
      expect(x.meleeSelected).toBe(true);
      expect(x.makeStack('water', 1).uid).toBeGreaterThan(inv.melee!.uid);
      expect(x.invariants()).toEqual([]);
    }
  });

  it('a malformed v3 slot (a gun in it) is never lost (back in through add()); meleeSelected over an empty slot is ignored', () => {
    const j = new Inventory().toJSON();
    j.melee = [{uid: 5, itemId: 'pistol', count: 1, mag: 7}];
    j.meleeSelected = true;
    j.nextUid = 2;
    const r = Inventory.fromJSON(j);
    expect(r.melee).toBeNull();
    expect(r.meleeSelected).toBe(false);
    expect(r.hotbar[0]).toMatchObject({uid: 5, itemId: 'pistol', mag: 7});
    expect(r.makeStack('cola', 1).uid).toBeGreaterThan(5);
    expect(r.invariants()).toEqual([]);
  });

  /** The knife-melee-20261030 format (v2): pistol (mag 9) in 1, the knife in 3, bandage in 5, 45 × 9mm, a flare in the grenade slot. */
  const legacy = (o: Partial<InventoryJSON> & {selected?: number} = {}): InventoryJSON => ({
    v: 2, hotbar: [{uid: 1, itemId: 'pistol', count: 1, mag: 9}, null, {uid: 7, itemId: 'knife', count: 1, mag: 0}, null, {uid: 2, itemId: 'bandage', count: 1}],
    pack: [{uid: 3, itemId: 'ammo_9mm', count: 45}, ...emptyPack(PACK_SIZE - 1)], gear: {...NO_GEAR}, throw: [{uid: 4, itemId: 'flare', count: 1}],
    selected: 0, nextUid: 8, ...o,
  } as InventoryJSON);

  it('v2 with the gun held: the knife moves from quick slot 3 into the melee slot (same uid), the pistol stays selected, nothing refilled', () => {
    const inv = Inventory.fromJSON(legacy());
    expect(inv.melee).toMatchObject({uid: 7, itemId: 'knife', mag: 0});
    expect(inv.hotbar[2]).toBeNull();
    expect([inv.selected, inv.meleeSelected, inv.selectedStack()?.itemId]).toEqual([0, false, 'pistol']);
    expect([inv.hotbar[0]!.mag, inv.count('ammo_9mm'), inv.count('flare'), inv.count('bandage')]).toEqual([9, 45, 1, 1]); // no refill
    expect(knivesIn(inv)).toHaveLength(1);
    expect(inv.makeStack('water', 1).uid).toBe(8);
    expect(inv.invariants()).toEqual([]);
    // saved again as v3: loading it again moves nothing (exactly once) — even a knife the player later puts in a quick slot stays
    inv.moveCount(MELEE_REF, H(3));
    const again = Inventory.fromJSON(inv.toJSON());
    expect([again.melee, again.hotbar[3]?.uid]).toEqual([null, 7]);
  });

  it('v2 with the KNIFE held (quick slot 3 selected): the melee slot becomes the selection (still the knife in hand); 1-5 come back to the gun', () => {
    const inv = Inventory.fromJSON(legacy({selected: 2}));
    expect([inv.meleeSelected, inv.selectedStack()?.uid]).toEqual([true, 7]);
    expect(inv.selected).toBe(0); // the remembered quick slot: the first gun
    inv.cycle(1);
    expect(inv.selectedStack()?.itemId).toBe('pistol');
    // no gun in the quick slots: the remembered quick slot is the one the knife left
    const bare = Inventory.fromJSON(legacy({selected: 2, hotbar: [null, null, {uid: 7, itemId: 'knife', count: 1, mag: 0}, null, null]}));
    expect([bare.meleeSelected, bare.selected]).toEqual([true, 2]);
    expect(bare.invariants()).toEqual([]);
  });

  it('only ONE knife migrates (quick slots first, then pockets); further knives stay where they are — no duplicate, nothing lost', () => {
    const two = Inventory.fromJSON(legacy({pack: [{uid: 3, itemId: 'ammo_9mm', count: 45}, null, null, null, null, {uid: 9, itemId: 'knife', count: 1, mag: 0}, ...emptyPack(PACK_SIZE - 6)], nextUid: 10}));
    expect(two.melee?.uid).toBe(7);
    expect(two.pack[5]?.uid).toBe(9);
    expect(knivesIn(two).map(s => s.uid).sort()).toEqual([7, 9]);
    const pocketOnly = Inventory.fromJSON(legacy({hotbar: [{uid: 1, itemId: 'pistol', count: 1, mag: 9}, null, null, null, null],
      pack: [{uid: 3, itemId: 'ammo_9mm', count: 45}, {uid: 7, itemId: 'knife', count: 1, mag: 0}, ...emptyPack(PACK_SIZE - 2)]}));
    expect([pocketOnly.melee?.uid, pocketOnly.pack[1]]).toEqual([7, null]);
    // a melee slot already occupied in an older snapshot (malformed): kept, and the carried knife stays put
    const occ = Inventory.fromJSON(legacy({melee: [{uid: 11, itemId: 'knife', count: 1, mag: 0}], nextUid: 12}));
    expect([occ.melee?.uid, occ.hotbar[2]?.uid]).toEqual([11, 7]);
    for (const x of [two, pocketOnly, occ]) expect(x.invariants()).toEqual([]);
  });

  it('never from a backpack: the worn bag\'s contents and a grounded bag stay untouched; a v1 snapshot migrates the same way', () => {
    const bagKnife = {uid: 20, itemId: 'knife', count: 1, mag: 0};
    const worn = {uid: 21, itemId: 'backpack', count: 1, bag: [bagKnife, ...new Array(7).fill(null)]};
    const inv = Inventory.fromJSON(legacy({hotbar: [{uid: 1, itemId: 'pistol', count: 1, mag: 9}, null, null, null, null], gear: {...NO_GEAR, backpack: worn}, nextUid: 22}));
    expect(inv.melee).toBeNull(); // nothing carried: the slot stays empty (~ then says "No melee weapon")
    expect(inv.worn('backpack')!.bag![0]).toMatchObject({uid: 20, itemId: 'knife'});
    expect(inv.refillMeleeSlot()).toBe(false); // the worn bag's contents stay out of reach
    const grounded = inv.makeStack('backpack', 1);
    grounded.bag![0] = inv.makeStack('knife', 1);
    const before = JSON.stringify(grounded);
    inv.loadJSON(legacy());
    expect(JSON.stringify(grounded)).toBe(before);
    const v1 = Inventory.fromJSON({...legacy(), v: 1, throw: undefined} as unknown as InventoryJSON);
    expect([v1.melee?.uid, v1.hotbar[2], v1.thrown]).toEqual([7, null, null]);
    expect(v1.count('flare')).toBe(0); // (v1 had no grenade slot: that legacy field is ignored as before)
    expect(v1.invariants()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the ~ key (player/input.ts): Backquote, plain or shifted; never with Ctrl / Alt / Meta or while typing', () => {
  it('pure helpers: isMeleeKey / isTypingTarget / shouldPreventKey', () => {
    expect(MELEE_KEY).toBe('Backquote');
    expect(isMeleeKey({code: 'Backquote'})).toBe(true);
    expect(isMeleeKey({code: 'Backquote', shiftKey: true} as {code: string})).toBe(true); // ~
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) expect(isMeleeKey({code: 'Backquote', [mod]: true}), mod).toBe(false);
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isMeleeKey({code: 'Backquote', target: {tagName}})).toBe(false);
    expect(isMeleeKey({code: 'Backquote', target: {tagName: 'DIV', isContentEditable: true}})).toBe(false);
    expect(isMeleeKey({code: 'Backquote', target: {tagName: 'CANVAS'}})).toBe(true);
    expect(isMeleeKey({code: 'Digit1'})).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(shouldPreventKey({code: 'Backquote'}, true)).toBe(true);
    expect(shouldPreventKey({code: 'Backquote'}, false)).toBe(false); // menus: the browser's
    expect(shouldPreventKey({code: 'Backquote', metaKey: true}, true)).toBe(false);
    expect(shouldPreventKey({code: 'Digit3'}, true)).toBe(true); // unchanged
    expect(shouldPreventKey({code: 'KeyG'}, false)).toBe(true);
  });

  it('the real keydown listener: ` and ~ register (and are prevented while playing); Ctrl/Alt/Meta+` and typing are left alone', () => {
    const g = globalThis as Record<string, unknown>;
    const saved = {window: g.window, document: g.document};
    const on: Record<string, ((e: unknown) => void)[]> = {};
    g.window = {addEventListener: (t: string, f: (e: unknown) => void) => { (on[t] ??= []).push(f); }};
    g.document = {addEventListener() {}, querySelectorAll: () => [], fullscreenElement: null, pointerLockElement: null};
    try {
      const input = new Input({addEventListener() {}} as unknown as HTMLCanvasElement, false);
      input.active = true;
      const seen: string[] = [];
      input.onKey = c => seen.push(c);
      const key = (o: Record<string, unknown>) => {
        let prevented = false;
        for (const f of on.keydown) f({code: 'Backquote', key: '`', repeat: false, target: {tagName: 'CANVAS'}, preventDefault: () => { prevented = true; }, ...o});
        const hit = input.hit('Backquote');
        input.endFrame();
        input.keys.clear();
        return {hit, prevented};
      };
      expect(key({})).toEqual({hit: true, prevented: true});
      expect(key({key: '~', shiftKey: true})).toEqual({hit: true, prevented: true});
      expect(key({ctrlKey: true})).toEqual({hit: false, prevented: false});
      expect(key({altKey: true})).toEqual({hit: false, prevented: false});
      expect(key({metaKey: true})).toEqual({hit: false, prevented: false}); // e.g. Cmd+` (window switching)
      expect(key({target: {tagName: 'TEXTAREA'}})).toEqual({hit: false, prevented: false});
      expect(key({repeat: true})).toEqual({hit: false, prevented: true}); // auto-repeat: no second press
      expect(seen).toEqual(['Backquote', 'Backquote']);
      input.active = false; // a menu: still reaches onKey (the inventory uses it), the browser keeps its default
      expect(key({})).toEqual({hit: true, prevented: false});
    } finally {
      g.window = saved.window;
      g.document = saved.document;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Game selection wiring (the real Game methods on a minimal shell + the real WeaponController)', async () => {
  const {Game} = await import('../src/game');
  type Shell = {inv: Inventory; weapon: InstanceType<typeof WeaponController>; input: {mouse: boolean[]}; lmbLatch: boolean; toasts: string[]; denied: number;
    equips: number; held: (string | null)[]; invUI: {selected: SlotRef | null}};
  function shell(inv = starterInventory('pistol')) {
    const s = {
      inv, weapon: new WeaponController(), input: {mouse: [false, false, false]}, lmbLatch: false, toasts: [] as string[], denied: 0, equips: 0,
      held: [] as (string | null)[], use: null, consumeView: {cancel() {}}, flareHold: {active: false}, gear: null,
      invUI: {selected: null as SlotRef | null},
      sfx: {equip: () => { s.equips++; }, denied: () => { s.denied++; }},
      viewmodel: {setItem: (id: string | null) => { s.held.push(id); }},
      hud: {toast: (t: string) => { s.toasts.push(t); }},
    };
    Object.setPrototypeOf(s, Game.prototype);
    const m = s as unknown as Shell & {slotKeys(i: {hit(c: string): boolean; wheel: number}): void; syncHeld(): void; selectMelee(): boolean; equipRef(r: SlotRef): void};
    m.syncHeld();
    return m;
  }
  const press = (g: ReturnType<typeof shell>, codes: string[], wheel = 0) => g.slotKeys({hit: c => codes.includes(c), wheel});

  it('~ draws the knife (weapon controller + viewmodel), again is a no-op; 1-5 and the wheel come back (Q is the gas mask); slot 3 is an empty quick slot', () => {
    const g = shell();
    expect(g.weapon.def?.id).toBe('pistol');
    press(g, ['Backquote']);
    expect([g.inv.meleeSelected, g.weapon.def?.id, g.weapon.stack, g.held.at(-1)]).toEqual([true, 'knife', g.inv.melee, 'knife']);
    const eq = g.equips;
    press(g, ['Backquote']);
    expect([g.equips, g.toasts]).toEqual([eq, []]);
    press(g, ['Digit1']);
    expect([g.inv.meleeSelected, g.weapon.def?.id]).toEqual([false, 'pistol']);
    press(g, ['KeyQ']); // task gasmask-breach-20261030: Q is the gas mask (Game.update -> gasMask.press), not a selection key
    expect([g.inv.meleeSelected, g.weapon.def?.id]).toEqual([false, 'pistol']);
    press(g, ['Backquote']);
    press(g, [], 1); // the wheel from the melee slot: the remembered quick slot (the pistol), not slot 2
    expect([g.inv.meleeSelected, g.inv.selected, g.weapon.def?.id]).toEqual([false, 0, 'pistol']);
    press(g, ['Digit3']); // quick slot 3 no longer holds the knife: empty hands
    expect([g.weapon.stack, g.held.at(-1)]).toEqual([null, null]);
    press(g, ['Backquote']);
    expect(g.weapon.def?.id).toBe('knife');
    press(g, ['Digit3']);
    expect(g.weapon.stack).toBeNull();
  });

  it('empty melee slot: "No melee weapon", the gun stays drawn, nothing stale; a carried knife is moved in and drawn instead', () => {
    const g = shell();
    press(g, ['Backquote']);
    g.inv.detach(MELEE_REF); // dropped (inventory drag-out) while drawn ...
    g.syncHeld(); // ... Game.dropRef re-syncs
    expect([g.inv.meleeSelected, g.weapon.def?.id]).toEqual([false, 'pistol']);
    press(g, ['Backquote']);
    expect([g.toasts.at(-1), g.denied, g.weapon.def?.id, g.inv.meleeSelected]).toEqual(['No melee weapon', 1, 'pistol', false]);
    const k = g.inv.makeStack('knife', 1);
    g.inv.set(P(7), k);
    press(g, ['Backquote']);
    expect([g.inv.melee, g.inv.pack[7], g.weapon.stack]).toEqual([k, null, k]);
  });

  it('a held mouse button through ~ never attacks with the knife (latched until released); G\'s grenade slot is untouched by ~', () => {
    const g = shell();
    const flare = g.inv.thrown;
    g.input.mouse[0] = true;
    press(g, ['Backquote']);
    expect(g.lmbLatch).toBe(true);
    expect(g.inv.thrown).toBe(flare);
    press(g, ['KeyG']); // G is not a selection key
    expect([g.inv.meleeSelected, g.inv.thrown]).toEqual([true, flare]);
  });

  it('inventory Equip / right-click on a knife: into the melee slot (swap) and drawn; a gun equipped from the pockets while the knife is drawn', () => {
    const g = shell();
    const old = g.inv.melee!, spare = g.inv.makeStack('knife', 1);
    g.inv.set(P(2), spare);
    g.equipRef(P(2));
    expect([g.inv.melee, g.inv.pack[2], g.inv.meleeSelected, g.weapon.stack, g.invUI.selected]).toEqual([spare, old, true, spare, MELEE_REF]);
    const rifle = g.inv.makeStack('rifle', 1, 30);
    g.inv.set(P(3), rifle);
    g.inv.select(1);
    g.inv.selectMelee();
    g.equipRef(P(3));
    expect([g.inv.hotbar[1], g.inv.meleeSelected, g.weapon.stack]).toEqual([rifle, false, rifle]);
    g.equipRef(MELEE_REF); // the melee slot's own weapon: drawn
    expect(g.weapon.stack).toBe(spare);
  });

  it('source wiring: update() runs slotKeys; ~ in the inventory assigns; 6 / E-hold treat ~ like 1-5; held refs follow the selection', () => {
    const src = SRC('game.ts');
    expect(src).toMatch(/this\.slotKeys\(inp\);/);
    expect(src).toMatch(/inp\.hit\('Backquote'\)\) this\.selectMelee\(\)/);
    expect(src).toMatch(/code === 'Backquote'\) this\.invUI\.assignMelee\(\)/);
    expect(src).toMatch(/this\.startUse\(this\.inv\.selectedRef\(\)\)/);
    expect(src).not.toMatch(/KNIFE_SLOT/);
    expect(SRC('gear/system.ts')).toMatch(/KEYS_SHOULDER = \[[^\]]*'Backquote'/);
    expect(src).not.toMatch(/lastSlot/); // no last-item cycling (Q is the gas mask)
    expect(SRC('run/starter.ts')).toMatch(/inv\.set\(MELEE_REF, inv\.makeStack\('knife', 1\)\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('HUD ~ cell, inventory melee cell, controls, responsive hotbar', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());
  const state = {hp: 100, maxHp: 100, stamina: 100, weaponName: '', mag: null, reserve: 0, hint: '', prompt: '', remaining: 0, total: 0, area: '', spreadPx: 4, aiming: false, flashlight: false, use: null};

  it('HUD: 9 cells — Q (gas mask), 1-5, 6, G and the melee slot "~" last (knife icon, selected while drawn, dim "melee" when empty); quick slot 3 is free', async () => {
    const {Hud} = await import('../src/ui/hud');
    const hud = new Hud();
    const inv = starterInventory('pistol');
    hud.update(state, inv);
    const bar = dom.el('#hotbar');
    expect(bar.children).toHaveLength(9);
    expect(bar.children.map(c => c.dataset.bar)).toEqual(['gear', 'hotbar', 'hotbar', 'hotbar', 'hotbar', 'hotbar', 'gear', 'throw', 'melee']);
    const m = bar.children[8], q1 = bar.children[1];
    expect(bar.children[0].classList.contains('maskslot')).toBe(true); // the gas-mask cell Q (task gasmask-breach-20261030) stays first
    expect(m.classList.contains('meleeslot')).toBe(true);
    expect(m.innerHTML).toMatch(/<span class="key">~<\/span>/);
    expect(m.innerHTML).toMatch(/Knife/);
    expect(m.innerHTML).not.toMatch(/class="count"/); // no rounds on a melee weapon
    expect([m.classList.contains('vacant'), m.classList.contains('selected'), q1.classList.contains('selected')]).toEqual([false, false, true]);
    expect(bar.children[3].innerHTML).not.toMatch(/Knife/);
    inv.selectMelee();
    hud.update(state, inv);
    expect([m.classList.contains('selected'), q1.classList.contains('selected')]).toEqual([true, false]);
    inv.add(inv.makeStack('backpack', 1)); // worn
    hud.setBagSelected(true); // 6: the readied backpack is what the hands hold
    hud.update(state, inv);
    expect([m.classList.contains('selected'), bar.children[6].classList.contains('selected')]).toEqual([false, true]);
    hud.setBagSelected(false);
    inv.detach(MELEE_REF);
    hud.update(state, inv);
    expect([m.classList.contains('vacant'), m.classList.contains('selected'), q1.classList.contains('selected')]).toEqual([true, false, true]);
    expect(m.innerHTML).toMatch(/<span class="ghost"><svg[\s\S]*<span class="nm">melee<\/span>/);
    expect(bar.children[7].innerHTML).toMatch(/<span class="key">G<\/span>/); // G cell unchanged
  });

  it('inventory: the melee cell (key ~, "held" while drawn); drag rules; ~ assigns the selected knife; a gun is refused with a reason', async () => {
    const {InventoryUI} = await import('../src/ui/inventoryUI');
    const inv = starterInventory('pistol');
    const drops: SlotRef[] = [];
    const ui = new InventoryUI(() => inv, {use() {}, drop: (ref, count) => { drops.push(ref); inv.detach(ref, count); }, equip() {}, close() {}, changed() {}});
    inv.selectMelee();
    ui.render();
    const row = dom.el('#inv-hotbar');
    expect(row.children.map(c => c.dataset.bar)).toEqual(['hotbar', 'hotbar', 'hotbar', 'hotbar', 'hotbar', 'throw', 'melee']);
    const cell = row.children[6];
    expect(cell.innerHTML).toMatch(/<span class="key">~<\/span>/);
    expect(cell.classList.contains('held')).toBe(true);
    expect(row.children[0].classList.contains('held')).toBe(false);
    expect(cell.dataset.tipHint).toMatch(/Melee slot: ~ draws it/);
    expect(ui.dropAt(H(0), MELEE_REF)).toBe('refused');
    expect(dom.el('#inv-detail .fx').textContent).toMatch(/Only melee weapons/);
    expect(ui.dropAt(MELEE_REF, P(8))).toBe('moved'); // a knife may leave the slot ...
    expect(inv.meleeSelected).toBe(false);
    expect(ui.selected).toEqual(P(8)); // (the moved stack stays selected)
    expect(ui.assignMelee()).toBe('moved'); // ... and ~ puts it back
    expect(inv.melee?.itemId).toBe('knife');
    ui.click(H(0));
    expect(ui.assignMelee()).toBe('refused');
    expect(ui.dropAt(MELEE_REF, 'out')).toBe('dropped'); // drag out of the panel = drop, as for every slot
    expect(drops.at(-1)).toEqual(MELEE_REF);
    ui.render();
    expect(row.children[6].innerHTML).toMatch(/class="ghost"/);
  });

  it('controls list and hints name ~ for melee; the knife is no longer "3 at the start"', async () => {
    const {CONTROLS} = await import('../src/ui/hud');
    expect(CONTROLS.some(([a, k]) => k === '~' && /melee/i.test(a))).toBe(true);
    expect(CONTROLS.some(([a]) => /knife: 3/.test(a))).toBe(false);
    expect(CONTROLS.some(([a, k]) => a === 'Throw equipped grenade' && k.startsWith('Hold G'))).toBe(true); // G unchanged (campaign-save-controls-fix: item-agnostic label)
    expect(CONTROLS.some(([a, k]) => /Backpack/.test(a) && k.startsWith('6'))).toBe(true); // 6 unchanged
    expect(SRC('game.ts')).toMatch(/'6 slings it back on · 1-5 \/ ~ switch'/);
  });

  it('responsive CSS: the 9-cell bar (Q, ~, 1-5, 6, G) fits the hotbar band between the vitals and the weapon panel at 960-1920 px', () => {
    // The band layout is main's (task gasmask-hud-fix-20261030, styles.css): #hotbar spans left: --hb-left .. right: --hb-right and
    // its cells shrink in proportion (flex) when their natural widths do not fit; the Q cell does not shrink. This recomputes it.
    const css = SRC('styles.css'), gear = SRC('ui/gearStyles.ts');
    const num = (re: RegExp, s = css) => { const m = re.exec(s); expect(m, String(re)).toBeTruthy(); return Number(m![1]); };
    const media = (w: number) => { const m = new RegExp(`@media \\(max-width: ${w}px\\) \\{([^\\n]*(?:\\n  [^\\n]*)*)`).exec(css); expect(m, `@media ${w}`).toBeTruthy(); return m![1]; };
    const m1400 = media(1400), m1250 = media(1250), m1100 = media(1100);
    expect(gear).toMatch(/#hotbar \.slot\.maskslot \{ order: -2; \}/);
    expect(gear).toMatch(/#hotbar \.slot\.meleeslot \{ order: -1; margin-right: 6px; \}/);
    expect(gear).toMatch(/#hotbar \.slot\.bagslot \{ margin-left: 10px; \}/);
    expect(gear).toMatch(/#hotbar \.slot\.throwslot \{ margin-left: 4px; \}/);
    expect(gear).toMatch(/#inv-hotbar \{ grid-template-columns: repeat\(7, 1fr\); \}/);
    expect(css).toMatch(/#hotbar \.slot \{ width: 84px; flex: 0 1 auto; min-width: 30px;/);
    expect(css).toMatch(/#hotbar \.slot\.maskslot \{ width: 64px; flex-shrink: 0; margin-right: 6px; \}/);
    expect(css).toMatch(/#hotbar \.slot \.count \{ top: 3px; bottom: auto; \}/); // counts top right, clear of the name
    const gap = num(/#hotbar \{[^}]*gap: (\d+)px/);
    for (const W of [960, 1024, 1100, 1180, 1280, 1366, 1440, 1600, 1920]) {
      const narrow = W <= 1100;
      const left = narrow ? num(/--hb-left: (\d+)px/, m1100) : num(/--hb-left: (\d+)px/), right = narrow ? num(/--hb-right: (\d+)px/, m1100) : num(/--hb-right: (\d+)px/);
      const vitals = 22 + (narrow ? num(/#vitals \{ width: (\d+)px/, m1100) : num(/#vitals \{[^}]*width: (\d+)px/));
      const panelR = num(/#weapon-panel \{[^}]*right: (\d+)px/);
      const text = narrow ? Math.max(num(/#weapon-hint \{ max-width: (\d+)px/, m1100), num(/#weapon-name \{ max-width: (\d+)px/, m1100)) : Math.max(num(/#weapon-hint \{[^}]*max-width: (\d+)px/), num(/#weapon-name \{[^}]*max-width: (\d+)px/));
      expect(left, `${W}px: band clear of the vitals`).toBeGreaterThanOrEqual(vitals + 6);
      expect(W - right, `${W}px: band clear of the weapon panel (name / hint)`).toBeLessThanOrEqual(W - panelR - text - 6);
      const cell = narrow ? num(/#hotbar \.slot \{ width: (\d+)px/, m1100) : W <= 1400 ? num(/#hotbar \.slot \{ width: (\d+)px/, m1400) : 84;
      const q = W <= 1250 ? num(/#hotbar \.slot\.maskslot \{ width: (\d+)px/, m1250) : W <= 1400 ? num(/#hotbar \.slot\.maskslot \{ width: (\d+)px/, m1400) : 64;
      const qGap = W <= 1250 ? num(/margin-right: (\d+)px/, m1250) : 6;
      const fixed = q + qGap + 6 + 10 + 4 + 8 * gap; // Q cell + its margin, the ~ margin, 6 / G separators, 8 gaps between 9 cells
      const w = Math.min(cell, (W - left - right - fixed) / 8); // the 8 shrinkable cells share the squeeze equally (same basis)
      expect(w, `${W}px: cells stay readable`).toBeGreaterThanOrEqual(W <= 1100 ? 45 : 55);
      expect(w).toBeGreaterThanOrEqual(30); // above the min-width floor: the flex shrink alone keeps the bar in the band
    }
  });
});
