// Task studio-flamethrower-fire-20261114-031614-01 (lane ECON): the Flamethrower fuel tank's FUEL is state of that very tank — whole
// units on its own ItemStack (`fuel`; fire/flamethrowerSpec.ts FLAME_FUEL), like an Airtank Backpack's `air`. No copy, store or save
// path may make fuel or lose it. Covered here (focused, Node):
//  - a NEW tank holds exactly its recipe's fuel; a tank without the field is EMPTY, never a new one;
//  - every copy keeps `fuel` exactly (0 stays 0) and the tank's uid: StackJSON, Inventory clone / toJSON / loadJSON (pocketed and worn),
//    the world record of a dropped / remembered tank, and the ONE sanitising loader behind every store (run/trainLockbox.ts: the
//    Lockbox, the car trunk, a crafted chest, a market stall's stock);
//  - that loader never makes fuel (clamped to a full tank, floored to whole units, absent / malformed = empty, dropped on other items);
//  - Inventory.invariants and the save validator refuse fuel that cannot be (negative, fractional, above a full tank, not a number, on
//    an item that is not a tank) wherever the stack lies;
//  - a save holding tanks everywhere a stack can be (worn, pocketed, Lockbox, crafted chest, train cargo, a remembered pickup, the car
//    trunk, market stock) validates and restores every one exactly; an older record without the field loads as an EMPTY tank;
//  - Retry: the level-entry snapshot gives each tank back as it was (fuel burnt or poured since is undone with everything else).
import {describe, expect, it} from 'vitest';
import {FLAME_FUEL, FUEL_TANK_ID} from '../src/fire/flamethrowerSpec';
import {tankFuel} from '../src/fire/fuelTank';
import {EQUIPMENT, freshEquipment} from '../src/craft/equipment';
import {GEAR_SLOTS, gearSpec, isBagItem, isFuelTank} from '../src/items/gear';
import {Inventory, stackFromJSON, stackToJSON, type ItemStack, type SlotRef, type StackJSON} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {MARKET_STOCK_LANE, MarketStock, type MarketStockJSON} from '../src/market/trade/stock';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {LOCKBOX_SLOTS, TrainLockbox} from '../src/run/trainLockbox';
import {stackFromRecord, stackRecord} from '../src/run/worldMemory';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {SKYWAYS_CAR_LANE, TRUNK_SLOTS, skywaysCarRecord, type SkywaysCarRecord} from '../src/world/skywaysCarStore';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;
const BACK = GEAR_SLOTS.indexOf('backpack');
const P = (index: number): SlotRef => ({bar: 'pack', index});
const CAP = FLAME_FUEL.capacity;
/** Empty, one unit, a part can, a new tank, one unit short of full, full. */
const LEVELS = [0, 1, 137, FLAME_FUEL.newUnits, CAP - 1, CAP];
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A tank holding exactly `fuel` units (uids from `inv`). */
function tank(inv: Inventory, fuel: number): ItemStack {
  const t = inv.makeStack(FUEL_TANK_ID, 1);
  t.fuel = fuel;
  return t;
}
/** The stack exactly as a tank with `fuel` units is: nothing else on it. */
const asTank = (uid: number, fuel?: number) => (fuel === undefined ? {uid, itemId: FUEL_TANK_ID, count: 1} : {uid, itemId: FUEL_TANK_ID, count: 1, fuel});
/** One stack through the stores' loader (a one-slot store). */
function load(j: unknown): ItemStack | null {
  const box = new TrainLockbox(1);
  box.load({v: 1, slots: [j]});
  return box.slots[0];
}

describe('the fuel tank item: whole units on its own stack', () => {
  it('a NEW tank holds exactly its recipe\'s fuel — one can — and nothing else makes a stack with fuel', () => {
    expect(FLAME_FUEL.newUnits).toBe(FLAME_FUEL.newCans * FLAME_FUEL.unitsPerCan);
    expect(FLAME_FUEL.capacity).toBe(FLAME_FUEL.capacityCans * FLAME_FUEL.unitsPerCan);
    expect(Number.isInteger(FLAME_FUEL.unitsPerCan) && FLAME_FUEL.newUnits <= CAP).toBe(true);
    expect(gearSpec(FUEL_TANK_ID)).toMatchObject({slot: 'backpack', fuelCap: CAP});
    expect([isFuelTank(FUEL_TANK_ID), isBagItem(FUEL_TANK_ID), itemDef(FUEL_TANK_ID).stackMax]).toEqual([true, false, 1]);
    const inv = new Inventory();
    const t = inv.makeStack(FUEL_TANK_ID, 3); // (a tank never stacks: one tank, one fuel count)
    expect(t).toEqual(asTank(t.uid, FLAME_FUEL.newUnits));
    for (const id of ['backpack', 'airtank_backpack', 'fuel_can', 'flamethrower', 'water', 'armor_vest']) {
      expect(isFuelTank(id), id).toBe(false);
      expect(inv.makeStack(id, 1).fuel, id).toBeUndefined();
    }
  });

  it('a tank without the field is EMPTY (never a new one): no path invents its fuel', () => {
    const inv = new Inventory();
    inv.makeStack('water', 1);
    const t = inv.makeStack(FUEL_TANK_ID, 1);
    delete t.fuel;
    expect(tankFuel(t)).toBe(0);
    expect(stackToJSON(t)).toEqual(asTank(t.uid));
    expect(stackFromJSON(asTank(41))).toEqual(asTank(41));
    inv.set(P(0), t);
    expect(inv.invariants()).toEqual([]);
    expect(inv.clone().get(P(0))).toEqual(asTank(t.uid));
    // a remembered / dropped tank whose record has no fuel comes back EMPTY, not as makeStack's new tank
    const back = stackFromRecord(inv, {itemId: FUEL_TANK_ID, count: 1});
    expect(back).toEqual(asTank(back.uid));
    expect(tankFuel(back)).toBe(0);
    // the stores' loader: absent stays absent
    expect(load(asTank(9))).toEqual(asTank(9));
    expect(MarketStock.fromJSON({v: 1, stalls: {gear: [asTank(9)]}}).stalls.gear[0]).toEqual(asTank(9));
  });
});

describe('the fuel belongs to that tank: every copy keeps it and its uid', () => {
  it('StackJSON / Inventory clone, toJSON, loadJSON / the world record keep `fuel` exactly at every level (0 stays 0)', () => {
    for (const fuel of LEVELS) {
      const inv = new Inventory();
      inv.makeStack('water', 1); // (so the tank's uid is not the first)
      const t = tank(inv, fuel);
      inv.set(P(2), t);
      expect(inv.invariants(), `${fuel}`).toEqual([]);
      expect(stackToJSON(t), `${fuel}`).toEqual(asTank(t.uid, fuel));
      expect(stackFromJSON(json(stackToJSON(t)))).toEqual(t);
      const c = inv.clone();
      expect(c.get(P(2))).toEqual(asTank(t.uid, fuel));
      expect(c.get(P(2))).not.toBe(t); // (a deep copy: burning the copy's fuel never touches the original)
      c.get(P(2))!.fuel = 0;
      expect(t.fuel).toBe(fuel);
      expect(Inventory.fromJSON(json(inv.toJSON())).get(P(2))).toEqual(asTank(t.uid, fuel));
      const other = new Inventory();
      other.loadJSON(json(inv.toJSON()));
      expect(other.get(P(2))).toEqual(asTank(t.uid, fuel));
      expect(other.invariants()).toEqual([]);
      // worn on the back (where it feeds the flamethrower from)
      const w = new Inventory();
      const worn = tank(w, fuel);
      expect(w.add(worn)).toBe(0);
      expect(w.gearSlots[BACK]).toBe(worn);
      expect(w.clone().gearSlots[BACK]).toEqual(asTank(worn.uid, fuel));
      expect(Inventory.fromJSON(json(w.toJSON())).gearSlots[BACK]).toEqual(asTank(worn.uid, fuel));
      expect(w.clone().invariants()).toEqual([]);
      // dropped / remembered: a record without a uid, the SAME fuel; back with a fresh uid and that fuel (makeStack's new-tank fuel is not kept)
      const rec = stackRecord(t);
      expect(rec).toEqual({itemId: FUEL_TANK_ID, count: 1, fuel});
      const back = stackFromRecord(inv, json(rec));
      expect(back).toEqual(asTank(back.uid, fuel));
      expect(back.uid).toBeGreaterThan(t.uid);
    }
  });

  it('every store keeps it: the Lockbox, the car trunk, a crafted chest and a market stall\'s stock share one loader', () => {
    const inv = new Inventory();
    for (const fuel of LEVELS) {
      for (const size of [LOCKBOX_SLOTS, TRUNK_SLOTS, EQUIPMENT.chest.slots, 1]) {
        const t = tank(inv, fuel);
        const box = new TrainLockbox(size);
        box.slots[size - 1] = t;
        const other = new TrainLockbox(size);
        other.load(json(box.toJSON()));
        expect(other.slots[size - 1], `${size}:${fuel}`).toEqual(asTank(t.uid, fuel));
        expect(other.maxUid()).toBe(t.uid);
      }
      const t = tank(inv, fuel);
      const st = new MarketStock();
      st.stalls.gear.push(t);
      const back = MarketStock.fromJSON(json(st.toJSON()));
      expect(back.stalls.gear, `${fuel}`).toEqual([asTank(t.uid, fuel)]);
    }
  });

  it('the loader never makes fuel: clamped to a full tank, whole units, malformed = empty, dropped on anything that is not a tank', () => {
    const T = (fuel: unknown) => ({uid: 7, itemId: FUEL_TANK_ID, count: 1, fuel});
    expect(load(T(9999))).toEqual(asTank(7, CAP));
    expect(load(T(CAP + 1))).toEqual(asTank(7, CAP));
    expect(load(T(137.9))).toEqual(asTank(7, 137)); // (down: never a unit that was not there)
    expect(load(T(0.99))).toEqual(asTank(7, 0));
    expect(load(T(-5))).toEqual(asTank(7, 0));
    for (const bad of ['full', '200', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, [200], true]) expect(load(T(bad)), String(bad)).toEqual(asTank(7));
    expect(load({uid: 7, itemId: 'water', count: 1, fuel: 50})).toEqual({uid: 7, itemId: 'water', count: 1});
    expect(load({uid: 7, itemId: 'fuel_can', count: 1, fuel: 200})).toEqual({uid: 7, itemId: 'fuel_can', count: 1});
    expect(load({uid: 7, itemId: 'airtank_backpack', count: 1, air: 10, fuel: 50})).toEqual({uid: 7, itemId: 'airtank_backpack', count: 1, air: 10});
    expect(load({uid: 7, itemId: 'flamethrower', count: 1, mag: 0, fuel: 50})).toEqual({uid: 7, itemId: 'flamethrower', count: 1, mag: 0});
    expect(load({uid: 7, itemId: 'backpack', count: 1, fuel: 50})!.fuel).toBeUndefined();
    // a tank's own fuel is not air, a filter charge or a magazine
    expect(load({...T(300), air: 100, filter: 10, mag: 4})).toEqual(asTank(7, 300));
    // the same loader behind a market stall
    const st = MarketStock.fromJSON({v: 1, stalls: {gear: [T(9999), {uid: 8, itemId: 'helmet', count: 1, fuel: 9}], gun: [{uid: 9, itemId: 'pistol', count: 1, mag: 3, fuel: 9}]}});
    expect(st.stalls.gear.map(s => s.fuel)).toEqual([CAP, undefined]);
    expect(st.stalls.gun[0]).toEqual({uid: 9, itemId: 'pistol', count: 1, mag: 3});
  });

  it('Inventory.invariants: fuel only on a fuel tank, whole, 0 .. a full tank', () => {
    const problems = (itemId: string, fuel: unknown, worn = false): string[] => {
      const inv = new Inventory();
      const s = inv.makeStack(itemId, 1);
      (s as Any).fuel = fuel;
      if (worn) inv.gearSlots[BACK] = s; else inv.set(P(0), s);
      return inv.invariants();
    };
    for (const worn of [false, true]) {
      for (const fuel of LEVELS) expect(problems(FUEL_TANK_ID, fuel, worn), `${fuel}`).toEqual([]);
      for (const fuel of [-1, CAP + 1, 0.5, 199.999, Number.NaN, Number.POSITIVE_INFINITY, '200']) {
        expect(problems(FUEL_TANK_ID, fuel, worn).some(x => /^bad fuel fuel_tank:/.test(x)), String(fuel)).toBe(true);
      }
    }
    for (const id of ['water', 'fuel_can', 'flamethrower', 'helmet']) expect(problems(id, 5).some(x => x === `non-tank ${id} carries fuel`), id).toBe(true);
    expect(problems('airtank_backpack', 5, true).some(x => x === 'non-tank airtank_backpack carries fuel')).toBe(true);
    expect(problems('backpack', 0, true).some(x => x === 'non-tank backpack carries fuel')).toBe(true); // (even 0: the field itself)
  });
});

describe('saves: a tank keeps its fuel and uid wherever it lies', () => {
  const KEY = {level: 'subway' as const, section: 'main', station: sid(1)};
  const memId = `${sid(1)}:main`;

  /** A run with a tank in every place a stack can be saved, each at its own fuel level. */
  function everywhere() {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    const inv = h.inv;
    const worn = tank(inv, 137), pocket = tank(inv, 0), stowed = tank(inv, CAP), chested = tank(inv, 1), aboard = tank(inv, FLAME_FUEL.newUnits),
      lying = tank(inv, 399), trunked = tank(inv, CAP - 1), stocked = tank(inv, 2 * FLAME_FUEL.unitsPerCan), stockEmpty = tank(inv, 0);
    inv.gearSlots[BACK] = worn;
    inv.set(P(3), pocket);
    h.train.lockbox.slots[11] = stowed;
    const chest = freshEquipment('chest', h.train.equipment.nextUid(), {x: -2, y: 0.98, z: 0.9, yaw: 0});
    chest.slots![5] = stackToJSON(chested);
    h.train.equipment.setAboard([chest]);
    h.train.cargo.setRecords([{kind: 'item', stack: json(stackToJSON(aboard)!), x: 0.5, y: 0.4, z: 0.2, q: [0, 0, 0, 1]}]);
    const mem = h.run.memory(KEY);
    mem.visits = 1;
    mem.pickups = [{stack: stackRecord(lying), pose: {p: [3, 0.1, 2], q: [0, 0, 0, 1]}, anchor: [3, 0.1, 2]}];
    const trunk: (StackJSON | null)[] = new Array(TRUNK_SLOTS).fill(null);
    trunk[4] = stackToJSON(trunked);
    h.run.setLaneStore(SKYWAYS_CAR_LANE, skywaysCarRecord(15, 0, 14, 0, 0, {trunk}), KEY);
    const stock = new MarketStock();
    stock.stalls.gear.push(stocked, stockEmpty);
    h.run.setLaneStore(MARKET_STOCK_LANE, stock.toJSON(), KEY);
    expect(inv.invariants()).toEqual([]);
    return {h, worn, pocket, stowed, chested, aboard, lying, trunked, stocked, stockEmpty};
  }

  /** Where each of those tanks is in a saved run. */
  const at = (run: Any) => {
    const lanes = run.memories[memId].lanes;
    return {
      worn: run.carry.inventory.gear.backpack, pocket: run.carry.inventory.pack[3],
      stowed: run.participants['player-train'].lockbox.slots[11], chested: run.participants['player-train'].equipment.aboard[0].slots[5],
      aboard: run.participants['player-train'].cargo.items[0].stack, lying: run.memories[memId].pickups[0][0], // (a saved pickup is a tuple: its stack first)
      trunked: lanes[SKYWAYS_CAR_LANE].trunk[4], stocked: lanes[MARKET_STOCK_LANE].stalls.gear[0], stockEmpty: lanes[MARKET_STOCK_LANE].stalls.gear[1],
    };
  };

  it('worn, pocketed, Lockbox, chest, cargo, remembered pickup, car trunk and market stock: validated, restored exactly', () => {
    const e = everywhere(), h = e.h;
    const file = h.file('arrival', 1);
    const parsed = parseSaveText(saveFileText(file));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const saved = at(parsed.value.run);
    expect(saved.worn).toEqual(asTank(e.worn.uid, 137));
    expect(saved.pocket).toEqual(asTank(e.pocket.uid, 0));
    expect(saved.stowed).toEqual(asTank(e.stowed.uid, CAP));
    expect(saved.chested).toEqual(asTank(e.chested.uid, 1));
    expect(saved.aboard).toEqual(asTank(e.aboard.uid, FLAME_FUEL.newUnits));
    expect(saved.lying).toEqual({itemId: FUEL_TANK_ID, count: 1, fuel: 399});
    expect(saved.trunked).toEqual(asTank(e.trunked.uid, CAP - 1));
    expect(saved.stocked).toEqual(asTank(e.stocked.uid, 2 * FLAME_FUEL.unitsPerCan));
    expect(saved.stockEmpty).toEqual(asTank(e.stockEmpty.uid, 0));
    // restored into a fresh game: the same stacks (uid + fuel) in the same places, nothing else changed
    const back = new Harness();
    const r = restoreRun(parsed.value.run, back.target());
    expect(r.failed).toEqual([]);
    expect(back.inv.gearSlots[BACK]).toEqual(asTank(e.worn.uid, 137));
    expect(back.inv.get(P(3))).toEqual(asTank(e.pocket.uid, 0));
    expect(back.train.lockbox.slots[11]).toEqual(asTank(e.stowed.uid, CAP));
    expect(back.train.equipment.records()[0].slots![5]).toEqual(asTank(e.chested.uid, 1));
    expect(back.train.cargo.records()[0].stack).toEqual(asTank(e.aboard.uid, FLAME_FUEL.newUnits));
    expect(JSON.stringify([back.inv.toJSON(), back.train.lockbox.toJSON(), back.train.cargo.toJSON(), back.train.equipment.toJSON()]))
      .toBe(JSON.stringify([h.inv.toJSON(), h.train.lockbox.toJSON(), h.train.cargo.toJSON(), h.train.equipment.toJSON()]));
    // a second save of the restored game is the same text: nothing drifts across save / load cycles
    expect(saveFileText(back.file('arrival', 1)) === saveFileText(file)).toBe(true);
    const mem = back.run.memory(KEY);
    expect(mem.pickups![0].stack).toEqual({itemId: FUEL_TANK_ID, count: 1, fuel: 399});
    const lying = stackFromRecord(back.inv, mem.pickups![0].stack); // (spawned again at the station: a fresh uid, the same fuel)
    expect(lying).toEqual(asTank(lying.uid, 399));
    expect(lying.uid).toBeGreaterThan(Math.max(...Object.values(e).filter((s): s is ItemStack => 'uid' in s).map(s => s.uid)));
    expect((back.run.laneStore(SKYWAYS_CAR_LANE, KEY) as SkywaysCarRecord).trunk[4]).toEqual(asTank(e.trunked.uid, CAP - 1));
    const stock = MarketStock.fromJSON(back.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY));
    expect(stock.stalls.gear).toEqual([asTank(e.stocked.uid, 2 * FLAME_FUEL.unitsPerCan), asTank(e.stockEmpty.uid, 0)]);
    expect(back.inv.invariants()).toEqual([]);
  });

  it('fuel that cannot be is refused wherever the tank lies: negative, fractional, above a full tank, not a number, on another item', () => {
    const {h} = everywhere();
    const file = h.file('arrival', 1);
    expect(validateSaveFile(structuredClone(file)).ok).toBe(true);
    const rejects = (mut: (run: Any) => void, re: RegExp, what: string) => {
      const f = structuredClone(file) as Any;
      mut(f.run);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok, what).toBe(false);
      expect((r as {error: string}).error, what).toMatch(re);
    };
    for (const where of Object.keys(at(file.run)) as (keyof ReturnType<typeof at>)[]) {
      rejects(run => { at(run)[where].fuel = -1; }, /fuel: -1 is out of range/, where);
      rejects(run => { at(run)[where].fuel = CAP + 1; }, /fuel: 601 is out of range/, where);
      rejects(run => { at(run)[where].fuel = 137.5; }, /fuel: 137\.5 is not a whole number/, where);
      rejects(run => { at(run)[where].fuel = '200'; }, /fuel: expected a finite number/, where);
      rejects(run => { at(run)[where].fuel = null; }, /fuel: expected a finite number/, where);
    }
    rejects(run => { run.carry.inventory.hotbar[0] = {uid: 99999, itemId: 'water', count: 1, fuel: 5}; }, /water holds no fuel/, 'water');
    rejects(run => { run.carry.inventory.hotbar[0] = {uid: 99999, itemId: 'fuel_can', count: 1, fuel: 200}; }, /fuel_can holds no fuel/, 'fuel can');
    rejects(run => { run.carry.inventory.hotbar[0] = {uid: 99999, itemId: 'flamethrower', count: 1, mag: 0, fuel: 0}; }, /flamethrower holds no fuel/, 'flamethrower');
    rejects(run => { run.participants['player-train'].lockbox.slots[0] = {uid: 99999, itemId: 'airtank_backpack', count: 1, air: 5, fuel: 5}; }, /airtank_backpack holds no fuel/, 'airtank');
    // (the boundary values themselves are fine)
    for (const fuel of [0, CAP]) {
      const f = structuredClone(file) as Any;
      for (const s of Object.values(at(f.run)) as Any[]) s.fuel = fuel;
      f.checksum = checksumOf(f.run);
      expect(validateSaveFile(f).ok, `${fuel}`).toBe(true);
    }
  });

  it('an older record without the field validates and loads as an EMPTY tank everywhere (no fuel appears on load)', () => {
    const e = everywhere();
    const f = structuredClone(e.h.file('arrival', 1)) as Any;
    for (const s of Object.values(at(f.run)) as Any[]) delete s.fuel;
    f.checksum = checksumOf(f.run);
    const parsed = parseSaveText(saveFileText(f as SaveFileV1Like));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const back = new Harness();
    expect(restoreRun(parsed.value.run, back.target()).failed).toEqual([]);
    const got: (ItemStack | StackJSON | null)[] = [
      back.inv.gearSlots[BACK], back.inv.get(P(3)), back.train.lockbox.slots[11], back.train.equipment.records()[0].slots![5], back.train.cargo.records()[0].stack,
      stackFromRecord(back.inv, back.run.memory(KEY).pickups![0].stack), load((back.run.laneStore(SKYWAYS_CAR_LANE, KEY) as SkywaysCarRecord).trunk[4]),
      ...MarketStock.fromJSON(back.run.laneStore(MARKET_STOCK_LANE, KEY)).stalls.gear,
    ];
    expect(got.length).toBe(9);
    for (const s of got) {
      expect(s).toEqual(asTank(s!.uid));
      expect(tankFuel(s)).toBe(0);
    }
    expect(back.inv.invariants()).toEqual([]);
  });

  it('Retry: the level-entry snapshot gives each tank back as it was; a bad value inside the snapshot is refused too', () => {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    const worn = tank(h.inv, 437), stowed = tank(h.inv, FLAME_FUEL.newUnits);
    h.inv.gearSlots[BACK] = worn;
    h.train.lockbox.slots[0] = stowed;
    h.takeEntry();
    const snap = h.run.entry!;
    // after the entry: the worn tank is burnt down, the stowed one filled up
    worn.fuel = 12;
    stowed.fuel = CAP;
    expect(snap.inventory.gearSlots[BACK]).toEqual(asTank(worn.uid, 437)); // (the snapshot is its own copy)
    for (let i = 0; i < 2; i++) { // (twice: the snapshot is never consumed)
      const inv = restoreCarry(snap, {player: h.player, survival: h.survival, battery: h.battery, stats: h.stats});
      h.inv.loadJSON(inv.toJSON());
      restoreParticipants(snap, h.participants);
      expect(h.inv.gearSlots[BACK]).toEqual(asTank(worn.uid, 437));
      expect(h.train.lockbox.slots[0]).toEqual(asTank(stowed.uid, FLAME_FUEL.newUnits));
      h.inv.gearSlots[BACK]!.fuel = 0;
    }
    // the snapshot travels in a save: validated as strictly as the run itself
    const file = h.file('arrival', 1);
    expect(validateSaveFile(structuredClone(file)).ok).toBe(true);
    const f = structuredClone(file) as Any;
    expect(f.run.entry.inventory.gear.backpack).toEqual(asTank(worn.uid, 437));
    f.run.entry.inventory.gear.backpack.fuel = CAP + 1;
    f.checksum = checksumOf(f.run);
    const r = validateSaveFile(f);
    expect(r.ok).toBe(false);
    expect((r as {error: string}).error).toMatch(/entry.*fuel: 601 is out of range/);
  });
});
