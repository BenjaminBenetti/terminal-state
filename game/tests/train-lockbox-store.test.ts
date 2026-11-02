// Task train-lockbox-windows-20261101-232156 (lane BOX): the train's 40-slot Lockbox store — run/trainLockbox.ts (slots, JSON, the
// malformed / old-save loads), run/playerTrain.ts (the RunParticipant: save / load / reset), items/inventory.ts storeMove /
// storeQuick / storeWornBag (atomic transfers both ways, backpacks in / out) and the Game's real carry methods (wireRunLanes /
// resetCarry / levelEntrySnapshot / restoreCarryFrom on a minimal shell): Travel keeps it, Retry restores it with the inventory
// (and keeps the uid counter above it), NewGame empties it. Node only (no renderer, no DOM).

import {describe, expect, it} from 'vitest';
import {Inventory, type ItemStack, type SlotRef, type StoreRef} from '../src/items/inventory';
import {WEAPONS} from '../src/weapons/weapons';
import {LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {PLAYER_TRAIN_PARTICIPANT, PlayerTrainRecord} from '../src/run/playerTrain';
import {resetParticipants, restoreParticipants, type RunSnapshot} from '../src/run/snapshot';
import {createRun} from '../src/run/runState';
import {LEVELS} from '../src/levels/registry';
import {Survival} from '../src/player/survival';
import {FlashlightBattery} from '../src/player/flashlight';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const P = (index: number): SlotRef => ({bar: 'pack', index});
const S = (index: number): StoreRef => ({bar: 'store', index});
const json = (v: unknown) => JSON.stringify(v);
const both = (inv: Inventory, box: TrainLockbox) => json({inv: inv.toJSON(), box: box.toJSON()});
const uidsOf = (inv: Inventory, box: TrainLockbox) => [...inv.allStacks(true), ...box.slots.flatMap(s => (s ? [s, ...(s.bag ?? []).filter((x): x is ItemStack => !!x)] : []))].map(s => s.uid);

describe('TrainLockbox: 40 ordinary slots, exact JSON, malformed data never crashes', () => {
  it('starts empty with 40 slots; toJSON / load round-trip keeps uid, count, magazine, backpack contents and the mask filter', () => {
    const box = new TrainLockbox(), inv = new Inventory();
    expect([box.slots.length, box.used, box.free, LOCKBOX_SLOTS]).toEqual([40, 0, 40, 40]);
    const rifle = inv.makeStack('rifle', 1, 7);
    const bag = inv.makeStack('backpack', 1);
    bag.bag![3] = inv.makeStack('water', 3);
    const mask = inv.makeStack('gas_mask', 1);
    mask.filter = 61.5;
    box.slots[0] = rifle;
    box.slots[5] = bag;
    box.slots[39] = mask;
    box.slots[12] = inv.makeStack('ammo_12ga', 20);
    const saved = structuredClone(box.toJSON());
    const other = new TrainLockbox();
    other.load(saved);
    expect(other.toJSON()).toEqual(saved);
    expect(other.slots[0]).toEqual({uid: rifle.uid, itemId: 'rifle', count: 1, mag: 7});
    expect(other.slots[5]!.bag![3]).toMatchObject({itemId: 'water', count: 3});
    expect(other.slots[39]!.filter).toBe(61.5);
    expect(other.slots[0]).not.toBe(rifle); // fresh objects, same uids
    expect(other.invariants()).toEqual([]);
    expect(other.maxUid()).toBe(Math.max(...uidsOf(new Inventory(), box)));
  });

  it('malformed / missing data loads as empty slots (never throws); bad slots are dropped, legacy ammo ids migrate, a bag in a bag is refused', () => {
    const box = new TrainLockbox();
    for (const d of [undefined, null, 42, 'x', {}, {slots: 'nope'}, {slots: [null, 7, 'a']}]) {
      expect(() => box.load(d)).not.toThrow();
      expect(box.used).toBe(0);
      expect(box.slots.length).toBe(40);
    }
    box.load({v: 1, slots: [
      {uid: 1, itemId: 'not_an_item', count: 1}, // unknown item
      {uid: 2, itemId: 'ammo_9mm', count: 0}, // empty stack
      {uid: 3, itemId: 'ammo_9mm', count: 999}, // over the stack limit
      {uid: 4, itemId: 'ammo_pistol', count: 30}, // legacy id -> ammo_9mm
      {uid: 4, itemId: 'water', count: 1}, // duplicate uid
      {uid: 6, itemId: 'pistol', count: 1, mag: 99}, // magazine clamped to 15
      {uid: 7, itemId: 'backpack', count: 1, bag: [{uid: 8, itemId: 'backpack', count: 1}, {uid: 9, itemId: 'bandage', count: 2}]},
      {uid: 1.5, itemId: 'water', count: 1}, // non-integer uid
    ]});
    expect(box.summary()).toEqual(['3:ammo_9mmx30', '5:pistolx1@15', '6:backpackx1[1]']);
    expect(box.slots[6]!.bag!.length).toBe(12);
    expect(box.slots[6]!.bag![1]).toMatchObject({uid: 9, itemId: 'bandage', count: 2});
    expect(box.invariants()).toEqual([]);
    const many = {slots: Array.from({length: 55}, (_, i) => ({uid: i + 1, itemId: 'water', count: 1}))};
    box.load(many); // more than 40 entries: only 40 slots exist
    expect([box.slots.length, box.used]).toEqual([40, 40]);
  });
});

describe('the player-train record owns the Lockbox (RunParticipant save / load / reset)', () => {
  it('save carries the slots; Retry restores them; NewGame empties them; the record identity stays train-only', () => {
    const rec = new PlayerTrainRecord(), part = rec.participant(), inv = new Inventory();
    expect(Object.keys(rec.state).sort()).toEqual(['at', 'id', 'tier']);
    rec.lockbox.slots[0] = inv.makeStack('shotgun', 1, 4);
    rec.parkAt({level: 'subway', section: 'main'});
    const entry = structuredClone(part.save()) as {lockbox: unknown};
    expect(entry.lockbox).toEqual(rec.lockbox.toJSON());
    rec.lockbox.slots[0] = null; // taken out after level entry
    rec.lockbox.slots[1] = inv.makeStack('helmet', 1);
    const box = rec.lockbox, slots = box.slots;
    restoreParticipants({lanes: {[PLAYER_TRAIN_PARTICIPANT]: entry}} as unknown as RunSnapshot, [part]);
    expect(rec.lockbox.summary()).toEqual(['0:shotgunx1@4']);
    expect(rec.lockbox).toBe(box); // restored in place (the open view / closures keep the same objects)
    expect(rec.lockbox.slots).toBe(slots);
    resetParticipants([part]);
    expect(rec.lockbox.used).toBe(0);
  });

  it('an old save without a lockbox (the PR #33 record) loads an empty 40-slot box; garbage never yields a broken box', () => {
    const rec = new PlayerTrainRecord(), part = rec.participant(), inv = new Inventory();
    rec.lockbox.slots[3] = inv.makeStack('boots', 1);
    part.load({id: 'player-train-l1', tier: 1, at: {level: 'office', section: 'main'}});
    expect([rec.state.at, rec.lockbox.used, rec.lockbox.slots.length]).toEqual([{level: 'office', section: 'main'}, 0, 40]);
    rec.lockbox.slots[3] = inv.makeStack('boots', 1);
    part.load({id: 'player-train-l1', tier: 1, at: null, lockbox: {slots: [{uid: 'x'}, {uid: 2, itemId: 'boots', count: 1}]}});
    expect(rec.lockbox.summary()).toEqual(['1:bootsx1']);
    expect(() => part.load(null)).not.toThrow();
    expect([rec.id, rec.lockbox.used]).toEqual(['player-train-l1', 0]);
  });
});

describe('Inventory store transfers: atomic, finite, every kind (lane BOX)', () => {
  it('click a pocket stack into the Lockbox: merges onto the same item first, the rest is the same object (uid kept); and back out', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    box.slots[2] = inv.makeStack('ammo_9mm', 100);
    const ammo = inv.makeStack('ammo_9mm', 50);
    inv.set(P(0), ammo);
    expect(inv.storeQuick(box.slots, P(0))).toBe(50);
    expect([box.slots[2]!.count, box.slots[0]]).toEqual([120, ammo]); // 20 merged, the remaining 30 moved as the same stack
    expect([ammo.count, inv.get(P(0))]).toEqual([30, null]);
    const gun = inv.makeStack('rifle', 1, 11);
    inv.set(H(1), gun);
    expect(inv.storeQuick(box.slots, H(1))).toBe(1);
    expect(box.slots[1]).toBe(gun);
    expect(inv.storeQuick(box.slots, S(1))).toBe(1); // back out: weapons go to the quick slots, the same object, magazine kept
    expect(inv.get(H(0))).toBe(gun);
    expect(gun.mag).toBe(11);
    expect([box.used, inv.invariants(), box.invariants()]).toEqual([2, [], []]);
  });

  it('full either way: what does not fit stays put (partial take), a full side refuses with nothing changed', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    for (let i = 0; i < inv.pack.length; i++) inv.set(P(i), inv.makeStack('water', 4));
    for (let i = 0; i < 5; i++) inv.set(H(i), inv.makeStack('cola', i === 4 ? 2 : 6));
    box.slots[0] = inv.makeStack('cola', 6);
    expect(inv.storeQuick(box.slots, S(0))).toBe(4); // only the last cola stack had room for 4
    expect([box.slots[0]!.count, inv.get(H(4))!.count]).toEqual([2, 6]);
    box.slots[1] = inv.makeStack('chips', 2);
    const before = both(inv, box);
    expect(inv.storeQuick(box.slots, S(1))).toBe(0);
    expect(inv.refusal?.code).toBe('no-room');
    expect(both(inv, box)).toBe(before);
    for (let i = 0; i < LOCKBOX_SLOTS; i++) box.slots[i] = inv.makeStack('battery', 4);
    const full = both(inv, box);
    expect(inv.storeQuick(box.slots, P(0))).toBe(0);
    expect([inv.refusal?.text, both(inv, box)]).toEqual(['The Lockbox is full.', full]);
  });

  it('drag: move / merge / swap / split between the pockets and the Lockbox and within it; slot rules hold; refusals change nothing', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    const water = inv.makeStack('water', 4), knife = inv.makeStack('knife', 1), flare = inv.makeStack('flare', 3);
    inv.set(P(0), water);
    inv.set({bar: 'melee', index: 0}, knife);
    inv.set({bar: 'throw', index: 0}, flare);
    expect(inv.storeMove(box.slots, P(0), S(7), 1)).toBe('split');
    expect([box.slots[7]!.count, water.count, box.slots[7]!.uid !== water.uid]).toEqual([1, 3, true]);
    expect(inv.storeMove(box.slots, P(0), S(7))).toBe('merged'); // 3 onto the 1
    expect([box.slots[7]!.count, inv.get(P(0))]).toEqual([4, null]);
    expect(inv.storeMove(box.slots, S(7), S(30))).toBe('moved'); // within the Lockbox
    expect(inv.storeMove(box.slots, {bar: 'melee', index: 0}, S(0))).toBe('moved'); // the knife leaves its slot
    expect([box.slots[0], inv.melee]).toEqual([knife, null]);
    expect(inv.storeMove(box.slots, {bar: 'throw', index: 0}, S(0))).toBe('refused'); // a swap would put the knife in the grenade slot
    expect(inv.refusal?.code).toBe('wrong-slot');
    const snap = both(inv, box);
    for (const [from, to] of [[{bar: 'gear', index: 1}, S(1)], [S(1), {bar: 'gear', index: 0}], [S(40), P(0)], [S(-1), P(0)], [{bar: 'bag', index: 0}, S(0)]] as const) {
      expect(inv.storeMove(box.slots, from as never, to as never)).toBe('refused');
      expect(both(inv, box)).toBe(snap);
    }
    expect(inv.storeQuick(inv.pack, P(0))).toBe(0); // the inventory's own lists are never a "store"
    expect(inv.storeMove(box.slots, S(0), {bar: 'melee', index: 0})).toBe('moved'); // the knife back into the melee slot
    expect([inv.invariants(), box.invariants(), new Set(uidsOf(inv, box)).size]).toEqual([[], [], uidsOf(inv, box).length]);
  });

  it('backpacks: stowed whole (contents kept); taken out = worn when the back is free, else refused; never into a pocket', () => {
    const inv = new Inventory(), box = new TrainLockbox();
    const mine = inv.makeStack('backpack', 1);
    mine.bag![0] = inv.makeStack('medkit', 2);
    expect(inv.add(mine)).toBe(0); // worn
    expect(inv.storeWornBag(box.slots)).toBe(true);
    expect([inv.worn('backpack'), box.slots[0]]).toEqual([null, mine]);
    expect(box.slots[0]!.bag![0]).toMatchObject({itemId: 'medkit', count: 2});
    expect(inv.storeWornBag(box.slots)).toBe(false); // nothing worn
    const spare = inv.makeStack('backpack', 1);
    box.slots[1] = spare;
    inv.set(P(0), inv.makeStack('beans', 1));
    let snap = both(inv, box);
    expect(inv.storeMove(box.slots, S(1), P(3))).toBe('refused');
    expect(inv.refusal?.text).toMatch(/click it in the Lockbox to wear it/);
    expect(inv.storeMove(box.slots, P(0), S(1))).toBe('refused'); // a swap would put the bag in a pocket
    expect(both(inv, box)).toBe(snap);
    expect(inv.storeQuick(box.slots, S(1))).toBe(1); // worn: the same stack
    expect([inv.worn('backpack'), box.slots[1]]).toEqual([spare, null]);
    snap = both(inv, box);
    expect(inv.storeQuick(box.slots, S(0))).toBe(0); // already wearing one
    expect([inv.refusal?.code, both(inv, box)]).toEqual(['slot-taken', snap]);
    expect(inv.storeWornBag(box.slots)).toBe(true); // swap them through the Lockbox
    expect(inv.storeQuick(box.slots, S(0))).toBe(1);
    expect(inv.worn('backpack')).toBe(mine);
    expect(inv.worn('backpack')!.bag![0]).toMatchObject({itemId: 'medkit', count: 2});
    expect([inv.invariants(), box.invariants()]).toEqual([[], []]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Game carry: Travel keeps the Lockbox, Retry restores it with the inventory, NewGame empties it (the real Game methods)', async () => {
  const {Game} = await import('../src/game');
  type Shell = {inv: Inventory; playerTrain: PlayerTrainRecord; run: ReturnType<typeof createRun>; runParticipants: {id: string}[]; arrival: {kind: string};
    wireRunLanes(): void; resetCarry(): void; restoreCarryFrom(s: RunSnapshot): void; levelEntrySnapshot(): RunSnapshot};
  function shell(): Shell {
    const battery = new FlashlightBattery();
    const s = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [] as {id: string}[], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number) => battery.reset(c)}, player: {hp: 100, stamina: 100, damageTaken: 0, alive: true},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0},
      run: createRun({seeds: {subway: 1, office: 2, mall: 3, reactor: 4}, start: {level: 'subway', section: 'main'}, levels: LEVELS}),
    };
    Object.setPrototypeOf(s, Game.prototype);
    return s as unknown as Shell;
  }
  /** Game.travel's carry steps for a level change: the record parks in the new level (buildSection), then the entry snapshot. */
  const travel = (g: Shell, level: 'office' | 'mall' | 'reactor' | 'subway') => {
    g.run.current = {level, section: 'main'};
    g.playerTrain.parkAt(g.run.current);
    g.run.entry = g.levelEntrySnapshot();
  };

  it('an item put in the box in the Subway is the same uid / count in the Office and the Mall; Retry and NewGame semantics', () => {
    const g = shell();
    g.wireRunLanes();
    expect(g.runParticipants.map(p => p.id)).toContain(PLAYER_TRAIN_PARTICIPANT);
    g.resetCarry(); // NewGame: the starter kit, an empty Lockbox
    g.playerTrain.parkAt({level: 'subway', section: 'main'});
    g.run.entry = g.levelEntrySnapshot();
    const box = g.playerTrain.lockbox;
    const ammo = g.inv.get(P(0))!; // 45 x 9mm
    expect(ammo.itemId).toBe('ammo_9mm');
    expect(g.inv.storeQuick(box.slots, P(0))).toBe(45);
    const pistol = g.inv.get(H(0))!;
    expect(g.inv.storeQuick(box.slots, H(0))).toBe(1);
    const want = ['0:ammo_9mmx45', `1:pistolx1@${WEAPONS.pistol.magazine}`];
    travel(g, 'office');
    expect([box.summary(), box.slots[0]!.uid, box.slots[1]!.uid]).toEqual([want, ammo.uid, pistol.uid]);
    travel(g, 'mall');
    expect([box.summary(), box.slots[0], box.slots[1]]).toEqual([want, ammo, pistol]); // the very same stacks
    // in the Mall: take the pistol back out, put the bandage in — then die and Retry: back to the Mall entry (no dup, no loss)
    expect(g.inv.storeQuick(box.slots, {bar: 'store', index: 1})).toBe(1);
    expect(g.inv.storeQuick(box.slots, H(4))).toBe(1);
    expect(box.summary()).toEqual(['0:ammo_9mmx45', '1:bandagex1']);
    g.restoreCarryFrom(g.run.entry!);
    expect(box.summary()).toEqual(want);
    expect(g.inv.allStacks(true).filter(s => s.itemId === 'pistol' || s.itemId === 'ammo_9mm')).toEqual([]);
    expect(g.inv.count('bandage')).toBe(1);
    const all = uidsOf(g.inv, box);
    expect(new Set(all).size).toBe(all.length);
    g.restoreCarryFrom(g.run.entry!); // Retry again: identical
    expect(box.summary()).toEqual(want);
    // NewGame: an empty box, the starter kit again
    g.resetCarry();
    expect([box.used, box.slots.length, g.inv.count('ammo_9mm')]).toEqual([0, 40, 45]);
  });

  it('Retry keeps the inventory uid counter above the Lockbox uids (Inventory.reserveUids)', () => {
    const g = shell();
    g.wireRunLanes();
    g.resetCarry();
    g.run.entry = g.levelEntrySnapshot();
    const box = g.playerTrain.lockbox;
    // a snapshot whose inventory counter is BELOW a Lockbox uid (e.g. a box restored from elsewhere): the restore must lift it
    const snap = g.run.entry!;
    snap.lanes[PLAYER_TRAIN_PARTICIPANT] = {...(snap.lanes[PLAYER_TRAIN_PARTICIPANT] as object), lockbox: {v: 1, slots: [{uid: 500, itemId: 'helmet', count: 1}]}};
    g.restoreCarryFrom(snap);
    expect(box.maxUid()).toBe(500);
    expect(g.inv.makeStack('water', 1).uid).toBeGreaterThan(500);
  });
});
