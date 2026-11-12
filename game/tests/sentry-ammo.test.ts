// Task train-interaction-ux-20261112-063646 (lane SENTRY): THE SENTRY'S FEED — a real FOUR-SLOT inventory of 5.56 mm rounds (it replaces
// the round counter and its load-all / take-all console). Real stacks in, real stacks out, none made:
//  - the traits (craft/equipment.ts): four slots that take one item, every round an older hopper could hold has a place;
//  - the feed's rule against the game's REAL Inventory (items/inventory.ts setStoreRule + world/trainEquipment.ts feedRule): the store
//    moves of every other store — click-transfer, drag, merge, split, swap, the worn backpack — accept 5.56 and refuse everything else
//    with the reason, where it is; a store without the rule (the Lockbox, a chest) is untouched by it;
//  - a REAL live unit (world/trainEquipment.ts on the flat room): `ammo` is what its slots hold, takeAmmo is the only other way out,
//    and inventory + feed is the running total at every step of a long random sequence of moves, splits, pick-ups and shots;
//  - the store controller and its view (world/equipmentChestStore.ts over a fake equipment system, in a fake DOM): [E] opens the
//    sentry's OWN view (four slots, no backpack stow, the one item named), the prompt counts the rounds and carries the turret's notes,
//    a refusal names the sentry, one view for every unit with slots;
//  - the turret (world/sentryTurret.ts): nothing but the player's own moves ever adds a round — a crafted sentry stays empty through
//    play, a ride and a rebuild, with rounds in the pockets.
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';
import {fakeEquipment, fakeUnit} from './helpers/craftBenchFakes';
import {DT, sentryWorld, teardownSentryWorlds} from './helpers/sentryFixture';
import {aboardRec, equipRoom, fakePlacement, loadAboard} from './helpers/trainEquipmentHost';
import {flatRoom, run} from './helpers/fuelCartsHost';
import {mulberry32} from '../src/core/rng';
import {EQUIPMENT, EQUIPMENT_KINDS, SENTRY_FEED_SLOTS, equipmentRounds} from '../src/craft/equipment';
import {Inventory, setStoreRule, storeRefusal, type ItemStack, type SlotRef, type StoreRef} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {LOCKBOX_VIEW} from '../src/ui/lockboxView';
import {CHEST_VIEW, STORE_TEXT, installEquipmentChestStore, storeViewOptions} from '../src/world/equipmentChestStore';
import {SENTRY_TEXT} from '../src/world/sentryTurret';
import {feedRule} from '../src/world/trainEquipment';

const undoCanvas = installCanvasShim(false);
afterEach(teardownSentryWorlds);
afterAll(undoCanvas);

const DEF = EQUIPMENT.sentry, AMMO = DEF.slotItem!, STACK = itemDef(AMMO).stackMax;
const ONLY = `Only ${itemDef(AMMO).name} go in ${DEF.the}.`;
const P = (index: number): SlotRef => ({bar: 'pack', index});
const S = (index: number): StoreRef => ({bar: 'store', index});

/** A feed's slots as a live unit has them: empty, under the feed's rule. */
function feed(): (ItemStack | null)[] {
  const slots = new Array<ItemStack | null>(DEF.slots).fill(null);
  setStoreRule(slots, feedRule(DEF));
  return slots;
}
const rounds = (slots: readonly (ItemStack | null)[]) => slots.reduce((n, s) => n + (s?.itemId === AMMO ? s.count : 0), 0);
const shape = (slots: readonly (ItemStack | null)[]) => slots.map(s => (s ? s.count : 0));
/** Rounds into the pockets (as many stacks as it takes); returns what did not fit. */
function carry(inv: Inventory, n: number): number {
  let left = 0;
  for (; n > 0; n -= STACK) left += inv.add(inv.makeStack(AMMO, Math.min(n, STACK)));
  return left;
}
/** Everything in the pockets, the quick slots and a feed, by uid: each stack once, a feed's all rounds in legal stacks. */
function audit(inv: Inventory, slots: readonly (ItemStack | null)[], tag = ''): void {
  const seen = new Set<number>();
  for (const s of [...inv.allStacks(false), ...slots]) {
    if (!s) continue;
    expect(seen.has(s.uid), `${tag}: uid ${s.uid} twice`).toBe(false);
    seen.add(s.uid);
  }
  for (const s of slots) {
    if (!s) continue;
    expect(s.itemId, tag).toBe(AMMO);
    expect(Number.isInteger(s.count) && s.count >= 1 && s.count <= STACK, `${tag}: a stack of ${s.count}`).toBe(true);
  }
}

describe('sentry feed: the traits', () => {
  it('four slots that take 5.56 only; every round an older hopper could hold has a place; no other kind is a feed', () => {
    expect([DEF.slots, SENTRY_FEED_SLOTS, AMMO, STACK]).toEqual([4, 4, 'ammo_556', 120]);
    expect(DEF.slots * STACK).toBeGreaterThanOrEqual(DEF.legacyAmmoCap);
    expect(DEF.legacyAmmoCap).toBe(300);
    expect(EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].slotItem !== null)).toEqual(['sentry']);
    expect(EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].legacyAmmoCap > 0)).toEqual(['sentry']);
    // the rule itself: its item passes, anything else gets the reason
    const rule = feedRule(DEF);
    expect(rule.accepts(AMMO)).toBeNull();
    for (const id of ['ammo_9mm', 'ammo_12g', 'beans', 'rifle', 'backpack', 'scrap_metal']) expect(rule.accepts(id), id).toBe(ONLY);
    expect(ONLY).toBe('Only 5.56×45mm rounds go in the defense sentry.');
  });
});

describe('sentry feed: the inventory\'s own store moves under the feed\'s rule', () => {
  it('a click moves carried rounds in (onto part stacks first, then free slots) and back out; the same stacks, nothing made', () => {
    const inv = new Inventory(), slots = feed();
    const a = inv.makeStack(AMMO, STACK), b = inv.makeStack(AMMO, 80), c = inv.makeStack(AMMO, 70);
    [a, b, c].forEach((s, i) => inv.set(P(i), s)); // (three separate carried stacks, as found)
    expect(inv.count(AMMO)).toBe(270);
    expect(inv.storeQuick(slots, inv.find(b.uid)!)).toBe(80);
    expect(slots[0]).toBe(b); // (the same stack object: its uid goes with it)
    expect(inv.storeQuick(slots, inv.find(c.uid)!)).toBe(70); // 40 top the part stack up, the other 30 take the next slot
    expect([shape(slots), slots[1] === c]).toEqual([[STACK, 30, 0, 0], true]);
    expect(inv.storeQuick(slots, inv.find(a.uid)!)).toBe(STACK); // 90 fill the part stack, the rest the next free slot
    expect(shape(slots)).toEqual([STACK, STACK, 30, 0]);
    expect([inv.count(AMMO), rounds(slots)]).toEqual([0, 270]);
    audit(inv, slots);
    // back out: a click takes a whole stack into the pockets
    expect(inv.storeQuick(slots, S(1))).toBe(STACK);
    expect([shape(slots), inv.count(AMMO)]).toEqual([[STACK, 0, 30, 0], STACK]);
    expect(inv.storeQuick(slots, S(1))).toBe(0); // (an empty slot)
    audit(inv, slots);
  });

  it('a drag moves, merges, splits and swaps rounds between the pockets and the slots by the usual rules', () => {
    const inv = new Inventory(), slots = feed();
    carry(inv, 2 * STACK + 40);
    const [p0, p1, p2] = [inv.pack[0]!, inv.pack[1]!, inv.pack[2]!];
    expect([p0.count, p1.count, p2.count]).toEqual([STACK, STACK, 40]);
    expect(inv.storeMove(slots, P(2), S(3))).toBe('moved');
    expect(slots[3]).toBe(p2);
    // a split: a new stack with its own uid, the rest stays
    expect(inv.storeMove(slots, P(0), S(0), 50)).toBe('split');
    expect([slots[0]!.count, inv.pack[0]!.count, slots[0]!.uid !== p0.uid]).toEqual([50, STACK - 50, true]);
    // a merge onto a part stack takes what fits
    expect(inv.storeMove(slots, P(1), S(0))).toBe('merged');
    expect([slots[0]!.count, inv.pack[1]!.count]).toEqual([STACK, 50]);
    // a swap of rounds for rounds (a full stack onto a full one of another count is a swap)
    expect(inv.storeMove(slots, S(3), P(0))).toBe('merged'); // 40 onto the 70 in the pocket
    expect([slots[3], inv.pack[0]!.count]).toEqual([null, 110]);
    expect(inv.storeMove(slots, S(0), S(2))).toBe('moved'); // within the feed
    expect(shape(slots)).toEqual([0, 0, STACK, 0]);
    expect(inv.storeMove(slots, P(1), S(2))).toBe('swapped'); // (the slot's stack is full: the two change places)
    expect([shape(slots), inv.pack[1]!.count]).toEqual([[0, 0, 50, 0], STACK]);
    expect(inv.count(AMMO) + rounds(slots)).toBe(2 * STACK + 40);
    audit(inv, slots);
  });

  it('anything but its rounds is refused where it is — click, drag, swap either way, the worn backpack — with the reason', () => {
    const inv = new Inventory(), slots = feed();
    const nine = inv.makeStack('ammo_9mm', 30), beans = inv.makeStack('beans', 2), gun = inv.makeStack('pistol', 1), bag = inv.makeStack('backpack', 1);
    for (const s of [nine, beans, gun]) inv.add(s);
    expect(inv.wearBag(bag)).toBe(true);
    carry(inv, STACK);
    const full = inv.find(inv.allStacks(false).find(s => s.itemId === AMMO)!.uid)!;
    expect(inv.storeMove(slots, full, S(1))).toBe('moved');
    const before = JSON.stringify([inv.toJSON(), slots]);
    for (const st of [nine, beans, gun]) {
      const ref = inv.find(st.uid)!;
      expect(inv.storeQuick(slots, ref), st.itemId).toBe(0);
      expect(inv.refusal).toEqual({code: 'wrong-slot', text: ONLY});
      expect(inv.storeMove(slots, ref, S(0)), st.itemId).toBe('refused'); // onto a free slot
      expect(inv.refusal).toEqual({code: 'wrong-slot', text: ONLY});
      expect(inv.storeMove(slots, ref, S(1)), st.itemId).toBe('refused'); // onto its rounds (a swap)
      expect(inv.storeMove(slots, S(1), ref), st.itemId).toBe('refused'); // its rounds onto the thing (the swap the other way)
      expect(inv.refusal).toEqual({code: 'wrong-slot', text: ONLY});
    }
    expect(inv.storeWornBag(slots)).toBe(false);
    expect(inv.refusal).toEqual({code: 'wrong-slot', text: ONLY});
    expect(inv.wornBag()).toBe(bag);
    expect(JSON.stringify([inv.toJSON(), slots])).toBe(before);
    expect(storeRefusal(slots, 'beans')).toBe(ONLY);
    expect(storeRefusal(slots, AMMO)).toBeNull();
  });

  it('full is full: four full stacks, a fifth stays carried; a part stack takes only its room', () => {
    const inv = new Inventory(), slots = feed();
    carry(inv, 4 * STACK - 20);
    for (let i = 0; i < 4; i++) expect(inv.storeQuick(slots, inv.find(inv.allStacks(false).find(s => s.itemId === AMMO)!.uid)!)).toBeGreaterThan(0);
    expect([shape(slots), inv.count(AMMO)]).toEqual([[STACK, STACK, STACK, STACK - 20], 0]);
    carry(inv, 50);
    const ref = inv.find(inv.allStacks(false).find(s => s.itemId === AMMO)!.uid)!;
    expect(inv.storeQuick(slots, ref)).toBe(20);
    expect([rounds(slots), inv.count(AMMO), inv.get(ref)!.count]).toEqual([4 * STACK, 30, 30]);
    const v = inv.version;
    expect(inv.storeQuick(slots, ref)).toBe(0);
    expect(inv.refusal?.code).toBe('no-room');
    expect([rounds(slots), inv.count(AMMO), inv.version]).toEqual([4 * STACK, 30, v]);
    audit(inv, slots);
  });

  it('the rule is the feed\'s alone: a store without one (the Lockbox, a chest) takes everything as before; a rule can be lifted', () => {
    const inv = new Inventory(), plainStore = new Array<ItemStack | null>(8).fill(null), slots = feed();
    inv.set(P(0), inv.makeStack('beans', 2));
    expect(storeRefusal(plainStore, 'beans')).toBeNull();
    expect(inv.storeQuick(plainStore, P(0))).toBe(2);
    expect(plainStore[0]).toMatchObject({itemId: 'beans', count: 2});
    setStoreRule(slots, null);
    expect(storeRefusal(slots, 'beans')).toBeNull();
  });
});

describe('sentry feed: a real live unit — rounds are conserved through any sequence', () => {
  function live() {
    const {h, eq} = equipRoom(flatRoom(), fakePlacement(1, 3.5, 3.5));
    loadAboard(h, [aboardRec('sentry', 1, -2.1, -0.5, 0)]);
    run(h, 0.1);
    return {h, eq, u: eq.unit('eq-1')!, inv: h.inv};
  }

  it('a crafted unit has four empty slots under the rule; ammo counts them; takeAmmo uses the last stack first and frees an emptied slot', () => {
    const {u, inv, eq} = live();
    expect(u.slots).toHaveLength(SENTRY_FEED_SLOTS);
    expect([u.ammo, u.takeAmmo(1), u.takeAmmo(), storeRefusal(u.slots!, 'beans')]).toEqual([0, 0, 0, ONLY]);
    carry(inv, STACK + 3);
    expect(inv.storeMove(u.slots!, P(0), S(0))).toBe('moved');
    expect(inv.storeMove(u.slots!, P(1), S(2))).toBe('moved');
    u.touchStore();
    expect([u.ammo, shape(u.slots!)]).toEqual([STACK + 3, [STACK, 0, 3, 0]]);
    const v = u.storeVersion;
    expect([u.takeAmmo(), u.takeAmmo(1), shape(u.slots!)]).toEqual([1, 1, [STACK, 0, 1, 0]]);
    expect(u.storeVersion).toBeGreaterThan(v); // (an open view redraws)
    expect([u.takeAmmo(5), shape(u.slots!), u.slots![2]]).toEqual([5, [STACK - 4, 0, 0, 0], null]); // across stacks; the emptied slot is free
    for (const bad of [0, -3, NaN, 0.4]) expect(u.takeAmmo(bad), String(bad)).toBe(0);
    expect(u.takeAmmo(2.9)).toBe(2); // whole rounds
    expect(u.takeAmmo(1e9)).toBe(STACK - 6);
    expect([u.ammo, u.takeAmmo(1)]).toEqual([0, 0]);
    // the record is the stacks (no count beside them); a feed is never a store the bench crafts from
    expect(eq.aboard()[0]).toMatchObject({uid: 'eq-1', slots: [null, null, null, null]});
    expect(eq.aboard()[0].ammo).toBeUndefined();
    expect(eq.storesAboard()).toEqual([]);
  });

  it('900 random moves / splits / clicks / pick-ups / shots / pocket clutter: inventory + feed is the running total at every step', () => {
    const {u, inv, eq} = live(), slots = u.slots!;
    const R = mulberry32(0x5e77), pick = (n: number) => Math.floor(R() * n);
    const max = itemDef('bandage').stackMax;
    let total = 0, ins = 0, outs = 0, shots = 0, refused = 0;
    for (let i = 0; i < 900; i++) {
      const k = R();
      if (k < 0.16) { const n = 1 + pick(150); total += n - carry(inv, n); } // found rounds (what fits)
      else if (k < 0.34) { if (inv.storeQuick(slots, P(pick(inv.pack.length))) > 0 && ++ins) u.touchStore(); else if (inv.refusal?.code === 'wrong-slot') refused++; }
      else if (k < 0.48) { if (inv.storeQuick(slots, S(pick(slots.length))) > 0) outs++; }
      else if (k < 0.62) { const r = inv.storeMove(slots, P(pick(inv.pack.length)), S(pick(slots.length)), R() < 0.5 ? 1 + pick(60) : undefined); if (r === 'refused') refused++; else if (r !== 'none') ins++; }
      else if (k < 0.72) { const r = inv.storeMove(slots, S(pick(slots.length)), P(pick(inv.pack.length)), R() < 0.5 ? 1 + pick(60) : undefined); if (r === 'refused') refused++; else if (r !== 'none') outs++; }
      else if (k < 0.76) inv.storeMove(slots, S(pick(slots.length)), S(pick(slots.length)), R() < 0.5 ? 1 + pick(60) : undefined);
      else if (k < 0.88) { const n = 1 + pick(3), got = u.takeAmmo(n); expect(got).toBe(Math.min(n, got + u.ammo)); total -= got; shots += got; } // shots: the only other way out
      else if (k < 0.95) inv.add(inv.makeStack('bandage', max)); // the pockets fill up (and a bandage is offered to the feed above)
      else inv.take('bandage', 1 + pick(2 * max));
      expect(inv.count(AMMO) + u.ammo, `step ${i}`).toBe(total);
      expect(u.ammo).toBe(rounds(slots));
      expect(u.ammo).toBeLessThanOrEqual(DEF.slots * STACK);
      audit(inv, slots, `step ${i}`);
    }
    expect(Math.min(ins, outs, shots, refused)).toBeGreaterThan(20); // (the sequence really exercised every way in and out)
    expect(inv.invariants()).toEqual([]);
    // and the record a save takes holds exactly what the unit holds
    expect(equipmentRounds(eq.aboard()[0])).toBe(u.ammo);
    expect(eq.aboard()[0].ammo).toBeUndefined();
  });
});

describe('sentry feed: [E] opens its own store view (the one controller of every unit with slots)', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => { dom.uninstall(); });

  function setup() {
    const eq = fakeEquipment();
    const toasts: string[] = [];
    const host = {
      inv: new Inventory(), player: {x: 0, y: 0, z: 1, alive: true}, state: 'playing', qa: false,
      hud: {toast: (t: string) => { toasts.push(t); }}, sfx: null, trainEquipment: eq, trainRide: {riding: false},
      frameHooks: [] as ((dt: number) => void)[], stateListeners: [] as ((s: never, p: never) => void)[],
      sectionHooks: [] as {build?(l: never): void; teardown?(): void}[], inputOwners: [] as (() => boolean)[],
      hitListeners: [] as ((hit: {amount: number}) => void)[],
      input: {locked: true, onLockChange: (_l: boolean) => {}, lock: () => Promise.resolve(true), unlock: () => {}},
      gear: {session: null as unknown, cancelReady: (_r: boolean) => {}, showResume: () => {}}, syncHeld: () => {},
    };
    const store = installEquipmentChestStore(host as never);
    const sentry = fakeUnit('sentry', 'eq-1', {x: 0, y: 0, z: 0, yaw: 0, level: 0});
    const chest = fakeUnit('chest', 'eq-2', {x: 0.6, y: 0, z: 0.2, yaw: 0, level: 0});
    const radar = fakeUnit('radar', 'eq-3', {x: -1, y: 0, z: 0, yaw: 0, level: 0});
    eq.list.push(sentry, chest, radar);
    return {host, eq, store, sentry, chest, radar, toasts, frame: () => { for (const f of host.frameHooks) f(1 / 60); }};
  }

  it('the store use is registered for every kind with slots — the sentry among them, no kind named', () => {
    const s = setup();
    const withSlots = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].slots > 0);
    expect(withSlots).toContain('sentry');
    expect(Object.keys(s.eq.uses).sort()).toEqual([...withSlots].sort());
    for (const k of withSlots) expect(s.eq.uses[k]).toBe(s.store.use);
    expect(s.store.qa()).toMatchObject({open: false, registered: true});
  });

  it('the prompt names the one action and counts the rounds; the turret\'s notes follow it; riding or carried it is the system\'s own', () => {
    const s = setup(), inv = s.host.inv;
    expect(s.store.use.prompt(s.sentry)).toBe('<b>[E]</b> Open the defense sentry · 0 × 5.56mm');
    s.sentry.slots![0] = inv.makeStack(AMMO, STACK);
    s.sentry.slots![3] = inv.makeStack(AMMO, 7);
    expect(s.store.use.prompt(s.sentry)).toBe(`<b>[E]</b> Open the defense sentry · ${STACK + 7} × 5.56mm`);
    expect(s.store.use.prompt(s.sentry)).toBe(STORE_TEXT.openFeed(DEF.the, STACK + 7, '5.56mm'));
    // what the sentry's own system has to say comes after it — for its unit only
    s.eq.promptNotes.push(u => (u.kind === 'sentry' ? SENTRY_TEXT.unplugged : null));
    expect(s.store.use.prompt(s.sentry)).toBe(`<b>[E]</b> Open the defense sentry · ${STACK + 7} × 5.56mm · not plugged in`);
    expect(s.store.use.prompt(s.chest)).toBe(STORE_TEXT.open(EQUIPMENT.chest.the, 0, EQUIPMENT.chest.slots));
    s.eq.promptNotes.push(() => { throw new Error('a broken note'); }); // (never the prompt's problem)
    expect(s.store.use.prompt(s.sentry)).toContain('· not plugged in');
    expect(s.store.use.prompt(s.radar)).toBeNull();
    s.host.trainRide.riding = true;
    expect(s.store.use.prompt(s.sentry)).toBeNull();
    s.host.trainRide.riding = false;
    s.sentry.mode = 'cargo';
    expect(s.store.use.prompt(s.sentry)).toBeNull();
  });

  it('a tap opens the sentry\'s view: its four slots in one row, the rounds named, no backpack stow; [E] closes it', () => {
    const s = setup(), inv = s.host.inv;
    const opts = storeViewOptions(DEF);
    expect(opts).toMatchObject({id: 'sentryview', name: 'Defense sentry', the: 'the defense sentry', slots: 4, columns: 4, stow: false, heading: 'Ammunition · 5.56×45mm rounds only'});
    expect(storeViewOptions(DEF)).toBe(opts);
    expect(storeViewOptions(EQUIPMENT.chest)).toBe(CHEST_VIEW);
    expect(new Set([opts.id, CHEST_VIEW.id, LOCKBOX_VIEW.id]).size).toBe(3);
    s.sentry.slots![1] = inv.makeStack(AMMO, 33);
    expect(s.store.use.tap(s.sentry)).toBe(true);
    expect(s.store.qa()).toMatchObject({open: true, unit: 'eq-1', kind: 'sentry', view: 'sentryview', used: 1, slots: 4, ammo: 33});
    expect(s.store.view.opts).toBe(opts);
    const root = dom.el('#app').children.find(c => c.id === 'sentryview')!;
    expect(root).toBeTruthy();
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.innerHTML).toContain('Ammunition · 5.56×45mm rounds only');
    expect(root.innerHTML).toContain('lb-g4" data-side="store"');
    expect(root.innerHTML).toContain('only 5.56×45mm rounds go in');
    expect(root.innerHTML).not.toContain('Stow worn backpack');
    expect(root.querySelector('[data-side="store"]')!.children.length).toBe(4);
    expect(s.sentry.lidCalls).toEqual([true]); // (the look's business: a kind without a lid ignores it)
    expect(s.store.use.prompt(s.sentry)).toBe('<b>[E]</b> Close the defense sentry');
    // a second tap on it closes it
    expect(s.store.use.tap(s.sentry)).toBe(true);
    expect([s.store.isOpen, root.classList.contains('hidden')]).toEqual([false, true]);
  });

  it('transfers in the open view are the inventory\'s moves over the unit\'s own slots; a refusal names the sentry and changes nothing', () => {
    const s = setup(), inv = s.host.inv, view = () => s.store.view;
    const a = inv.makeStack(AMMO, STACK), b = inv.makeStack(AMMO, 30);
    [a, b, inv.makeStack('ammo_9mm', 40)].forEach((st, i) => inv.set(P(i), st));
    expect(s.store.use.tap(s.sentry)).toBe(true);
    expect(view().quick(P(0))).toBe(STACK);
    expect(s.sentry.slots![0]).toBe(a);
    expect(view().note).toBe(`${STACK} × 5.56mm → Defense sentry`);
    expect(view().move(P(1), S(3))).toBe('moved');
    expect(s.sentry.slots![3]).toBe(b);
    expect([s.sentry.ammo, inv.count(AMMO)]).toEqual([STACK + 30, 0]);
    // the other caliber: refused by the click and the drag, said in the view
    const before = JSON.stringify([inv.toJSON(), s.sentry.slots]);
    expect(view().quick(P(2))).toBe(0);
    expect([view().note, view().noteBad]).toEqual([ONLY, true]);
    expect(view().move(P(2), S(1))).toBe('refused');
    expect(view().move(P(2), S(0))).toBe('refused');
    expect(view().move(S(0), P(2))).toBe('refused');
    expect(view().stow()).toBe(false);
    expect(JSON.stringify([inv.toJSON(), s.sentry.slots])).toBe(before);
    // full: the fifth stack stays carried, and the note names the sentry (never the Lockbox)
    s.sentry.slots![1] = inv.makeStack(AMMO, STACK);
    s.sentry.slots![2] = inv.makeStack(AMMO, STACK);
    s.sentry.slots![3] = inv.makeStack(AMMO, STACK);
    carry(inv, 25);
    const extra = inv.find(inv.allStacks(false).find(x => x.itemId === AMMO)!.uid)!;
    expect(view().quick(extra)).toBe(0);
    expect(view().note).toBe('The defense sentry is full.');
    expect(inv.count(AMMO)).toBe(25);
    // rounds back out with a click: into the pockets
    expect(view().quick(S(0))).toBe(STACK);
    expect([inv.count(AMMO), s.sentry.ammo]).toEqual([STACK + 25, 3 * STACK]);
    audit(inv, s.sentry.slots!);
  });

  it('ONE view at a time: the sentry\'s closes the chest\'s and the other way round; the ride, a move, and distance close it like a chest\'s', () => {
    const s = setup();
    expect(s.store.use.tap(s.chest)).toBe(true);
    expect(s.store.qa()).toMatchObject({open: true, unit: 'eq-2', view: 'chestview'});
    expect(s.store.use.tap(s.sentry)).toBe(true);
    expect(s.store.qa()).toMatchObject({open: true, unit: 'eq-1', view: 'sentryview'});
    expect(dom.el('#app').children.find(c => c.id === 'chestview')!.classList.contains('hidden')).toBe(true);
    expect(s.chest.lidCalls).toEqual([true, false]);
    expect(s.store.use.tap(s.chest)).toBe(true);
    expect(s.store.qa()).toMatchObject({open: true, unit: 'eq-2', view: 'chestview'});
    expect(dom.el('#app').children.find(c => c.id === 'sentryview')!.classList.contains('hidden')).toBe(true);
    expect(s.store.use.tap(s.sentry)).toBe(true);
    // it rolled (a push): closed, with its own name
    s.sentry.pose!.x += 0.5;
    s.frame();
    expect([s.store.isOpen, s.store.lastClose, s.toasts.pop()]).toEqual([false, 'moved', STORE_TEXT.moved(DEF.the)]);
    // walked away
    expect(s.store.use.tap(s.sentry)).toBe(true);
    s.host.player.z = 9;
    s.frame();
    expect([s.store.isOpen, s.store.lastClose, s.toasts.pop()]).toEqual([false, 'distance', STORE_TEXT.far(DEF.the)]);
    s.host.player.z = 1;
    // the train moves: a tap only says so
    s.host.trainRide.riding = true;
    expect(s.store.use.tap(s.sentry)).toBe(true);
    expect([s.store.isOpen, s.toasts.pop()]).toEqual([false, STORE_TEXT.moving]);
  });
});

describe('sentry feed: nothing but the player\'s own moves adds a round', () => {
  it('a crafted, plugged-in sentry stays empty through play, a ride and a rebuild — with rounds in the pockets', () => {
    const s = sentryWorld({plug: 0});
    const u = s.unit;
    carry(s.host.inv, 90); // carried rounds are not taken by themselves
    for (let i = 0; i < 4 / DT; i++) s.sys.update(DT);
    s.host.trainRide.riding = true;
    s.eq.parked = false;
    for (let i = 0; i < 1 / DT; i++) s.sys.update(DT);
    s.host.trainRide.riding = false;
    s.eq.parked = true;
    for (const h of s.host.sectionHooks) h.teardown?.();
    for (const h of s.host.sectionHooks) h.build?.(s.lay);
    for (let i = 0; i < 2 / DT; i++) s.sys.update(DT);
    expect(u.ammo).toBe(0);
    expect(u.asked).toEqual([]);
    expect(s.host.inv.count(AMMO)).toBe(90);
    expect([s.sys.counts.shots, s.sys.deploy, s.sys.view.root.visible]).toEqual([0, 0, false]);
    // the turret's system has no use of its own on the console and no inventory in its hands: only its notes on the prompt
    expect(Object.keys(s.eq.uses)).toEqual([]);
    expect(s.eq.promptNotes.map(f => f(u))).toEqual([null]);
    s.eq.disconnect(u);
    expect(s.eq.promptNotes.map(f => f(u))).toEqual([SENTRY_TEXT.unplugged]);
  });
});
