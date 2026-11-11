// Task gameplay-feedback-20261111 (lane STORAGE): save compatibility of the extra storage row (pockets 12 -> 18, a chest rig's pockets
// 12..15 -> 18..21, a backpack's own slots 12 -> 18, the Lockbox 40 -> 50). An OLDER snapshot (no `packBase`: 12 base pockets) keeps its
// base pockets 0..11 in place, its chest-rig pockets move to the rig's indices now (18..21) and the new base pockets 12..17 load EMPTY —
// nothing is shuffled into them, lost or duplicated. Older 12-slot bags (worn, in the Lockbox, grounded in a station's memory, lying as a
// loose item) load with their new row empty, every item in its slot; an older 40-slot Lockbox loads into 50 with its items in place.
// End to end: a real captured run downgraded to the older shapes passes save/validate.ts, restores into exactly the state the current
// game would have written (inventory, Retry entry, Lockbox; nothing missing from the item census) and re-saves in the new shapes.
import {describe, expect, it} from 'vitest';
import {Inventory, LEGACY_PACK_SIZE, PACK_SIZE, packBaseOf, remapPockets, stackFromJSON, type InventoryJSON, type ItemStack, type SlotRef, type StackJSON} from '../src/items/inventory';
import {BACKPACK_SLOTS, LEGACY_BACKPACK_SLOTS} from '../src/items/gear';
import {ITEMS} from '../src/items/items';
import {mulberry32} from '../src/core/rng';
import {LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {PLAYER_TRAIN_PARTICIPANT} from '../src/run/playerTrain';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {BAG_LANE} from '../src/run/bagStore';
import {readSectionBags} from '../src/gear/bagStore';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText, type SaveFileV1Like, type SerializedRunV1} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, itemCensus, populateStation, sid, stackOf} from './helpers/saveFixture';

const P = (index: number): SlotRef => ({bar: 'pack', index});
const OLD_LOCKBOX = 40;
const RIG = [PACK_SIZE, PACK_SIZE + 1, PACK_SIZE + 2, PACK_SIZE + 3]; // the chest rig's pockets now (18..21)
const OLD_RIG = [LEGACY_PACK_SIZE, LEGACY_PACK_SIZE + 1, LEGACY_PACK_SIZE + 2, LEGACY_PACK_SIZE + 3]; // and in an older save (12..15)
const NEW_ROW = Array.from({length: PACK_SIZE - LEGACY_PACK_SIZE}, (_, i) => LEGACY_PACK_SIZE + i); // the new base pockets (12..17)
/** Plain loose items (no melee weapon: a v1 / v2 snapshot moves a pocketed knife into the melee slot by design). */
const LOOSE_IDS = ['water', 'beans', 'ammo_9mm', 'scrap_metal', 'gas_filter', 'cola', 'battery', 'medkit', 'rifle', 'pistol', 'ammo_12g', 'bandage'];
const looseIds = LOOSE_IDS.filter(id => ITEMS[id]);
const uidsAt = (list: readonly (ItemStack | StackJSON | null)[], idx: readonly number[]) => idx.map(i => list[i]?.uid ?? null);
/** itemId -> total count of a snapshot (every slot list, bag contents included). */
function jsonCensus(j: InventoryJSON): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (s: StackJSON | null | undefined): void => {
    if (!s) return;
    out[s.itemId] = (out[s.itemId] ?? 0) + s.count;
    for (const c of s.bag ?? []) add(c);
  };
  for (const s of [...j.hotbar, ...j.pack, ...Object.values(j.gear), ...(j.throw ?? []), ...(j.melee ?? [])]) add(s);
  return out;
}

/** A 12-slot bag's worth of items in a current-size (18-slot) backpack: slots 0..11 filled, the new row empty. */
function oldFullBag(inv: Inventory, r: () => number): ItemStack {
  const bag = inv.makeStack('backpack', 1);
  expect(bag.bag).toHaveLength(BACKPACK_SLOTS);
  for (let i = 0; i < LEGACY_BACKPACK_SLOTS; i++) bag.bag![i] = stackOf(inv, ITEMS[looseIds[(i * 7 + 1) % looseIds.length]], r);
  return bag;
}

/** The current snapshot of a kit an older build could also hold: pockets 0..11, the rig's 4 pockets, a worn 12-item backpack. */
function oldShapedKit(rig: boolean, seed = 3): Inventory {
  const r = mulberry32(seed), inv = new Inventory();
  if (rig) expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0);
  expect(inv.add(oldFullBag(inv, r))).toBe(0);
  expect(inv.wornBag()).not.toBeNull();
  for (let i = 0; i < LEGACY_PACK_SIZE; i++) inv.set(P(i), stackOf(inv, ITEMS[looseIds[i % looseIds.length]], r));
  if (rig) RIG.forEach((i, k) => inv.set(P(i), stackOf(inv, ITEMS[looseIds[(k * 5 + 2) % looseIds.length]], r)));
  inv.hotbar[1] = inv.makeStack('water', 2);
  return inv;
}

/** Throws unless the slots cut are empty (a downgrade never drops an item). */
function cutEmpty<T>(list: (T | null)[], from: number, to = list.length): void {
  expect(list.slice(from, to).every(x => x === null), `slots ${from}..${to - 1} must be empty to write an older shape`).toBe(true);
}

/** A stack's 18-slot bag written as an older build's 12. */
function oldBag(s: {itemId?: string; bag?: unknown[]} | null | undefined): void {
  if (!s?.bag) return;
  expect(s.bag).toHaveLength(BACKPACK_SLOTS);
  cutEmpty(s.bag, LEGACY_BACKPACK_SLOTS);
  s.bag = s.bag.slice(0, LEGACY_BACKPACK_SLOTS);
}

/** An InventoryJSON as an older build wrote it: no packBase, 12 base pockets then the rig's, 12-slot bags. */
function oldInventoryJSON(j0: InventoryJSON): InventoryJSON {
  const j = structuredClone(j0);
  expect(j.packBase).toBe(PACK_SIZE);
  cutEmpty(j.pack, LEGACY_PACK_SIZE, PACK_SIZE);
  j.pack = [...j.pack.slice(0, LEGACY_PACK_SIZE), ...j.pack.slice(PACK_SIZE)];
  delete j.packBase;
  for (const s of [...j.hotbar, ...j.pack, ...Object.values(j.gear), ...(j.throw ?? []), ...(j.melee ?? [])]) oldBag(s);
  return j;
}

/** A whole serialized run as an older build wrote it (carry, Retry entry, Lockbox, every memory's grounded bags and loose items). */
function downgradeRun(run0: SerializedRunV1): SerializedRunV1 {
  const run = structuredClone(run0);
  run.carry.inventory = oldInventoryJSON(run.carry.inventory);
  if (run.entry) run.entry.inventory = oldInventoryJSON(run.entry.inventory);
  const train = run.participants[PLAYER_TRAIN_PARTICIPANT] as {lockbox: {v: 1; slots: (StackJSON | null)[]}};
  expect(train.lockbox.slots).toHaveLength(LOCKBOX_SLOTS);
  cutEmpty(train.lockbox.slots, OLD_LOCKBOX);
  train.lockbox.slots = train.lockbox.slots.slice(0, OLD_LOCKBOX);
  train.lockbox.slots.forEach(oldBag);
  for (const mems of [run.memories, run.entry?.memories ?? {}]) {
    for (const m of Object.values(mems)) {
      for (const b of (m.lanes[BAG_LANE] as {bags?: {stack: StackJSON}[]} | undefined)?.bags ?? []) oldBag(b.stack);
      for (const t of m.pickups ?? []) oldBag(t[0] as unknown as {bag?: unknown[]});
    }
  }
  return run;
}

const resigned = (f: SaveFileV1Like, run: SerializedRunV1): SaveFileV1Like => ({...f, run, checksum: checksumOf(run)});

describe('older inventory snapshots (no packBase): base pockets stay, rig pockets move 12..15 -> 18..21, the new row loads empty', () => {
  it('no chest rig: the 12 pockets load into 18 in place (12..17 empty); a re-save writes packBase 18', () => {
    const live = oldShapedKit(false), j = oldInventoryJSON(live.toJSON());
    expect([j.pack.length, j.packBase, packBaseOf(j, 0)]).toEqual([LEGACY_PACK_SIZE, undefined, LEGACY_PACK_SIZE]);
    const inv = Inventory.fromJSON(j);
    expect(inv.pack).toHaveLength(PACK_SIZE);
    expect(uidsAt(inv.pack, [...Array(LEGACY_PACK_SIZE).keys()])).toEqual(uidsAt(live.pack, [...Array(LEGACY_PACK_SIZE).keys()]));
    expect(NEW_ROW.map(i => inv.pack[i])).toEqual(NEW_ROW.map(() => null));
    expect(inv.toJSON()).toEqual(live.toJSON()); // exactly the current game's state
    expect(inv.toJSON()).toMatchObject({packBase: PACK_SIZE});
    expect(inv.invariants()).toEqual([]);
  });

  it('a worn chest rig: the 16-entry pockets keep 0..11, the rig\'s 12..15 move to 18..21 (same uids), 12..17 stay empty; refused off', () => {
    const live = oldShapedKit(true), j = oldInventoryJSON(live.toJSON());
    expect(j.pack).toHaveLength(LEGACY_PACK_SIZE + 4);
    expect(uidsAt(j.pack, OLD_RIG)).toEqual(uidsAt(live.pack, RIG)); // the older file has the rig's items at 12..15
    expect(packBaseOf(j, 4)).toBe(LEGACY_PACK_SIZE);
    const inv = Inventory.fromJSON(j);
    expect([inv.pack.length, inv.capacity, inv.extraPockets]).toEqual([PACK_SIZE + 4, PACK_SIZE + 4, 4]);
    expect(uidsAt(inv.pack, RIG)).toEqual(uidsAt(j.pack, OLD_RIG));
    expect(uidsAt(inv.pack, RIG).every(u => u !== null)).toBe(true);
    expect(NEW_ROW.map(i => inv.pack[i])).toEqual(NEW_ROW.map(() => null)); // nothing shuffled into the new base pockets
    expect(inv.toJSON()).toEqual(live.toJSON());
    expect(inv.allStacks(true)).toHaveLength(live.allStacks(true).length);
    expect(inv.invariants()).toEqual([]);
    expect(inv.takeOff('chest')).toBe('refused'); // the rig still holds its items: nothing is dropped
    expect(inv.refusal?.text).toMatch(/19–22/);
  });

  it('v1 / v2 snapshots with a rig migrate the same way (and an explicit older packBase 12 equals an absent one)', () => {
    const live = oldShapedKit(true, 9), j3 = oldInventoryJSON(live.toJSON());
    const v1 = structuredClone(j3) as InventoryJSON, v2 = structuredClone(j3) as InventoryJSON;
    v1.v = 1; delete v1.throw; delete v1.melee; delete v1.meleeSelected;
    v2.v = 2; delete v2.melee; delete v2.meleeSelected;
    for (const j of [v1, v2, {...j3, packBase: LEGACY_PACK_SIZE}]) {
      const inv = Inventory.fromJSON(j);
      expect(inv.pack.map(s => s?.uid ?? null)).toEqual(live.pack.map(s => s?.uid ?? null));
      expect(inv.wornBag()!.bag).toHaveLength(BACKPACK_SLOTS);
      expect(inv.invariants()).toEqual([]);
    }
  });

  it('a current-layout snapshot stays put with or without packBase (18 / 22 entries); a malformed one never loses an item', () => {
    for (const rig of [false, true]) {
      const live = oldShapedKit(rig);
      live.set(P(15), live.makeStack('beans', 1)); // the new row in use
      const j = live.toJSON();
      const bare = structuredClone(j); delete bare.packBase;
      for (const x of [j, bare]) expect(Inventory.fromJSON(x).toJSON()).toEqual(j);
    }
    // 16 entries but no rig worn (malformed): the extra items are never dropped or duplicated — they go back in through add()
    const bad = oldInventoryJSON(oldShapedKit(true).toJSON());
    bad.gear.chest = null;
    const inv = Inventory.fromJSON(bad);
    expect(jsonCensus(inv.toJSON())).toEqual(jsonCensus(bad)); // (a stray may merge into a like stack: compare counts, not uids)
    expect(inv.invariants()).toEqual([]);
    // the remap itself: base pockets kept, the old rig's indices moved, out-of-range base pockets returned as loose
    const list = ['a', null, 'c', ...Array(9).fill(null), 'r0', null, 'r2', 'r3'];
    expect(remapPockets(list, LEGACY_PACK_SIZE)).toEqual({pack: ['a', null, 'c', ...Array(15).fill(null), 'r0', null, 'r2', 'r3'], loose: []});
    expect(remapPockets(['x', 'y', 'z'], 2)).toEqual({pack: ['x', 'y', ...Array(16).fill(null), 'z'], loose: []});
    const wide = [...Array(PACK_SIZE + 2).keys()].map(i => `p${i}`);
    expect(remapPockets(wide, PACK_SIZE + 2).loose).toEqual(['p18', 'p19']); // (a base wider than today's: never silently dropped)
    expect(remapPockets(wide, PACK_SIZE).pack).toEqual(wide);
  });
});

describe('older 12-slot bags and the older 40-slot Lockbox', () => {
  it('stackFromJSON / the Lockbox loader / a grounded bag record / a loose-item record: 12-slot bags come back at 18, items in place', () => {
    const r = mulberry32(5), inv = new Inventory(), bag = oldFullBag(inv, r);
    const old = JSON.parse(JSON.stringify(bag)) as StackJSON;
    oldBag(old);
    expect(old.bag).toHaveLength(LEGACY_BACKPACK_SLOTS);
    const want = JSON.parse(JSON.stringify(bag)) as StackJSON;
    // stackFromJSON (worn / carried bags, the train cargo, grounded bags)
    expect(JSON.parse(JSON.stringify(stackFromJSON(old)))).toEqual(want);
    // a grounded bag in a station's memory (gear/system.ts: readSectionBags -> stackFromJSON)
    const rec = readSectionBags({v: 1, seed: 77, init: true, bags: [{id: 'bag:1', stack: old, x: 1, y: 0, z: 2, yaw: 0, level: 0}]}, 77)!;
    expect(rec.bags).toHaveLength(1);
    const ground = stackFromJSON(rec.bags[0].stack)!;
    expect(ground.bag).toHaveLength(BACKPACK_SLOTS);
    expect(JSON.parse(JSON.stringify(ground))).toEqual(want);
    // a remembered loose item (run/worldMemory.ts stackFromRecord: a fresh top-level uid, the contents exactly as recorded)
    const loose = stackFromRecord(new Inventory(), {...stackRecord(stackFromJSON(old)!), bag: old.bag} as never);
    expect(loose.bag).toHaveLength(BACKPACK_SLOTS);
    expect(loose.bag!.map(s => s?.uid ?? null)).toEqual(bag.bag!.map(s => s?.uid ?? null));
    // the Lockbox (its own sanitizing loader)
    const box = new TrainLockbox();
    box.load({v: 1, slots: [old]});
    expect(box.slots[0]!.bag).toHaveLength(BACKPACK_SLOTS);
    expect(JSON.parse(JSON.stringify(box.slots[0]))).toEqual(want);
    expect(box.invariants()).toEqual([]);
  });

  it('a 40-slot Lockbox loads into 50: slots 0..39 exactly in place, 40..49 empty and usable', () => {
    const r = mulberry32(6), inv = new Inventory(), src = new TrainLockbox();
    for (let i = 0; i < OLD_LOCKBOX; i++) src.slots[i] = i % 9 === 0 ? oldFullBag(inv, r) : stackOf(inv, ITEMS[looseIds[i % looseIds.length]], r);
    const j = src.toJSON();
    const old = {v: 1 as const, slots: structuredClone(j.slots.slice(0, OLD_LOCKBOX))};
    old.slots.forEach(oldBag);
    const box = new TrainLockbox();
    box.load(old);
    expect([box.slots.length, box.used, box.free]).toEqual([LOCKBOX_SLOTS, OLD_LOCKBOX, LOCKBOX_SLOTS - OLD_LOCKBOX]);
    expect(box.toJSON()).toEqual(j);
    expect(box.slots.slice(OLD_LOCKBOX)).toEqual(new Array(LOCKBOX_SLOTS - OLD_LOCKBOX).fill(null));
    expect(box.invariants()).toEqual([]);
    // the new slots take items (the storeMove / stow paths are in tests/storage-extra-row.test.ts)
    box.slots[LOCKBOX_SLOTS - 1] = inv.makeStack('water', 1);
    expect([box.used, box.invariants()]).toEqual([OLD_LOCKBOX + 1, []]);
  });
});

describe('a whole older save file (12 + 4 pockets, 12-slot bags, a 40-slot Lockbox) validates, restores and re-saves in the new shapes', () => {
  const key = (i: number) => ({level: 'subway' as const, section: 'main', station: sid(i)});

  /** A current run holding only what an older build could hold (so it can be written in the older shapes without dropping anything). */
  function oldShapedRun(): Harness {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
    const r = mulberry32(21), inv = h.inv;
    expect(inv.add(inv.makeStack('chest_rig', 1))).toBe(0);
    expect(inv.add(oldFullBag(inv, r))).toBe(0);
    for (let i = 0; i < LEGACY_PACK_SIZE; i++) inv.set(P(i), stackOf(inv, ITEMS[looseIds[(i * 3) % looseIds.length]], r));
    RIG.forEach((i, k) => inv.set(P(i), stackOf(inv, ITEMS[looseIds[(k + 4) % looseIds.length]], r)));
    inv.hotbar[0] = inv.makeStack('pistol', 1);
    inv.hotbar[3] = inv.makeStack('medkit', 1);
    for (let i = 0; i < OLD_LOCKBOX; i++) h.train.lockbox.slots[i] = i < 4 ? oldFullBag(inv, r) : stackOf(inv, ITEMS[looseIds[(i * 5) % looseIds.length]], r);
    // station memories: grounded bags (with 12 items each) and a backpack lying as a loose item
    populateStation(h, key(0), {seed: 31, holders: 8, layoutPickups: 4, dropped: 3, zombies: 6, bags: 2});
    populateStation(h, key(1), {seed: 32, holders: 8, layoutPickups: 4, dropped: 3, zombies: 6, bags: 1});
    for (const k of [key(0), key(1)]) {
      const m = h.run.memory(k);
      for (const b of (m.lanes[BAG_LANE] as {bags: {stack: StackJSON}[]}).bags) b.stack.bag = b.stack.bag!.map((s, i) => (i < LEGACY_BACKPACK_SLOTS ? s : null));
      m.pickups!.push({stack: stackRecord(oldFullBag(inv, r)), pose: {p: [1.5, 0.2, -2], q: [0, 0, 0, 1]}, anchor: [1.5, 0.2, -2]});
    }
    h.run.current = key(1);
    h.takeEntry(); // the Retry snapshot (with the rig's items and the 12-item bag)
    inv.set(P(5), null); // play went on after the entry: the live kit differs from the Retry one
    return h;
  }

  it('the downgraded file passes save/validate.ts unchanged and restores the exact current state; nothing lost (item census)', () => {
    const a = oldShapedRun(), file = a.file('arrival');
    const old = downgradeRun(file.run);
    // it really is the older shape
    expect(old.carry.inventory.pack).toHaveLength(LEGACY_PACK_SIZE + 4);
    expect(old.carry.inventory).not.toHaveProperty('packBase');
    expect(old.entry!.inventory.pack).toHaveLength(LEGACY_PACK_SIZE + 4);
    expect(old.carry.inventory.gear.backpack!.bag).toHaveLength(LEGACY_BACKPACK_SLOTS);
    expect((old.participants[PLAYER_TRAIN_PARTICIPANT] as {lockbox: {slots: unknown[]}}).lockbox.slots).toHaveLength(OLD_LOCKBOX);
    const text = saveFileText(resigned(file, old));
    expect(text).not.toContain('packBase');
    const v = parseSaveText(text);
    if (!v.ok) throw new Error(v.error);
    const b = new Harness(null), res = restoreRun(v.value.run, b.target());
    expect(res.failed).toEqual([]);
    // carry: base pockets 0..11 in place, rig pockets at 18..21 (same uids), 12..17 empty, the bag at 18 with its 12 items in place
    expect(b.inv.pack).toHaveLength(PACK_SIZE + 4);
    expect(uidsAt(b.inv.pack, RIG)).toEqual(uidsAt(old.carry.inventory.pack, OLD_RIG));
    expect(NEW_ROW.map(i => b.inv.pack[i])).toEqual(NEW_ROW.map(() => null));
    expect(b.inv.wornBag()!.bag).toHaveLength(BACKPACK_SLOTS);
    expect(b.inv.toJSON()).toEqual(a.inv.toJSON());
    expect(b.inv.invariants()).toEqual([]);
    // the Retry entry's own inventory migrates the same way
    expect(b.run.entry!.inventory.toJSON()).toEqual(a.run.entry!.inventory.toJSON());
    expect(uidsAt(b.run.entry!.inventory.pack, RIG)).toEqual(uidsAt(old.entry!.inventory.pack, OLD_RIG));
    expect(b.run.entry!.inventory.invariants()).toEqual([]);
    // the Lockbox: 40 -> 50, items in place, bags at 18
    expect(b.train.lockbox.toJSON()).toEqual(a.train.lockbox.toJSON());
    expect([b.train.lockbox.slots.length, b.train.lockbox.used]).toEqual([LOCKBOX_SLOTS, OLD_LOCKBOX]);
    expect(b.train.lockbox.invariants()).toEqual([]);
    // station memories keep the older bag records as data; the loaders pad them (grounded bags, the loose backpack) with items in place
    for (const k of [key(0), key(1)]) {
      const ma = a.run.peekMemory(k)!, mb = b.run.peekMemory(k)!;
      const ba = (ma.lanes[BAG_LANE] as {seed: number; bags: {stack: StackJSON}[]}).bags;
      const rec = readSectionBags(mb.lanes[BAG_LANE], (mb.lanes[BAG_LANE] as {seed: number}).seed)!;
      expect(rec.bags.map(x => x.stack.bag!.length)).toEqual(ba.map(() => LEGACY_BACKPACK_SLOTS));
      rec.bags.forEach((x, i) => expect(JSON.parse(JSON.stringify(stackFromJSON(x.stack)))).toEqual(ba[i].stack));
      const pa = ma.pickups!.at(-1)!, pb = mb.pickups!.at(-1)!;
      expect(pb.stack.bag).toHaveLength(LEGACY_BACKPACK_SLOTS);
      const live = stackFromRecord(b.inv, pb.stack);
      expect(live.bag).toHaveLength(BACKPACK_SLOTS);
      expect(JSON.parse(JSON.stringify(live.bag))).toEqual(JSON.parse(JSON.stringify(pa.stack.bag)));
    }
    // nothing duplicated or lost anywhere (carry + Lockbox + every station's loose items and grounded bags)
    expect(itemCensus(b)).toEqual(itemCensus(a));
    // the restored rig still refuses to come off while its pockets hold the old items
    expect(b.inv.takeOff('chest')).toBe('refused');
    expect(b.inv.refusal?.text).toMatch(/19–22/);
  });

  it('a re-save writes the new shapes (packBase 18, 22 pockets, 18-slot bags, a 50-slot Lockbox) and equals the current game\'s save', () => {
    const a = oldShapedRun(), file = a.file('arrival');
    const v = parseSaveText(saveFileText(resigned(file, downgradeRun(file.run))));
    if (!v.ok) throw new Error(v.error);
    const b = new Harness(null);
    restoreRun(v.value.run, b.target());
    const again = b.file('arrival').run;
    expect(again.carry.inventory).toMatchObject({packBase: PACK_SIZE});
    expect(again.carry.inventory.pack).toHaveLength(PACK_SIZE + 4);
    expect(again.carry.inventory.gear.backpack!.bag).toHaveLength(BACKPACK_SLOTS);
    expect((again.participants[PLAYER_TRAIN_PARTICIPANT] as {lockbox: {slots: unknown[]}}).lockbox.slots).toHaveLength(LOCKBOX_SLOTS);
    expect(again.carry).toEqual(file.run.carry);
    expect(again.entry!.inventory).toEqual(file.run.entry!.inventory);
    expect(again.participants).toEqual(file.run.participants);
    expect(parseSaveText(saveFileText(b.file('arrival'))).ok).toBe(true);
  });

  it('save/validate.ts accepts both sizes and still rejects out-of-range ones (bags < 12 or > 18, a Lockbox > 50, a bad packBase)', () => {
    const a = oldShapedRun(), file = a.file('arrival');
    const cur = file.run, old = downgradeRun(cur);
    expect(validateSaveFile(file).ok).toBe(true);
    expect(validateSaveFile(resigned(file, old)).ok).toBe(true);
    const rejects = (base: SerializedRunV1, mut: (run: SerializedRunV1) => void, re: RegExp) => {
      const run = structuredClone(base);
      mut(run);
      const r = validateSaveFile(resigned(file, run));
      expect(r.ok, `expected a rejection matching ${re}`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    };
    rejects(old, run => { run.carry.inventory.gear.backpack!.bag!.pop(); }, /gear\.backpack\.bag: too few entries \(11; at least 12\)/);
    rejects(cur, run => { run.carry.inventory.gear.backpack!.bag!.push(null); }, /gear\.backpack\.bag: too many entries \(19; at most 18\)/);
    rejects(cur, run => { (run.participants[PLAYER_TRAIN_PARTICIPANT] as {lockbox: {slots: unknown[]}}).lockbox.slots.push(null); }, /lockbox\.slots: too many entries \(51; at most 50\)/);
    rejects(cur, run => { run.carry.inventory.packBase = 0; }, /packBase/);
    rejects(cur, run => { run.carry.inventory.packBase = 2.5; }, /packBase/);
    rejects(cur, run => { (run.carry.inventory as unknown as Record<string, unknown>).packBase = '18'; }, /packBase/);
  });
});
