// Task studio-flamethrower-fire-20261114-031614-01 (user: "Tank occupies backpack/air-tank slot; firing requires its paired tank worn.
// Normal fuel cans refill it; crafted tanks start with EXACTLY recipe fuel. Maintain exact consumption/refill/save/UID state: no free fuel
// or fuel loss."): the flamethrower's STREAM cycle over the real Inventory + WeaponController (weapons/weapons.ts updateStream,
// fire/fuelTank.ts):
//  - every 'flame' tick is paid for by exactly one fuel unit in the same step, at any frame rate, for taps, holds and hitches;
//  - no worn tank / an empty tank: no flame, a dry click; the tank in the pack or another back item does not feed it;
//  - R pours ONE whole can after the pour time, atomically (can gone = units in), only when all of it fits; cancelled = nothing taken;
//  - it touches no ammunition, has no magazine, and the flame goes out with the weapon.
import {describe, expect, it} from 'vitest';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {GEAR_SLOTS, isFuelTank} from '../src/items/gear';
import {itemDef} from '../src/items/items';
import {WEAPONS, WeaponController, reserveFor, streamDefOf, type TriggerInput, type WeaponEvent} from '../src/weapons/weapons';
import {FLAME, FLAME_FUEL, FLAME_FUEL_CAN, FLAMETHROWER_ID, FUEL_TANK_ID} from '../src/fire/flamethrowerSpec';
import {burnUnit, canPourCan, pourCan, tankFuel, tankRoom, wornFuelTank} from '../src/fire/fuelTank';

const BACK = GEAR_SLOTS.indexOf('backpack');
const DEF = WEAPONS[FLAMETHROWER_ID];
const IDLE: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const HOLD: TriggerInput = {held: true, pressed: false, reload: false, lowered: false};
const PRESS: TriggerInput = {held: true, pressed: true, reload: false, lowered: false};

function rig(o: {tank?: boolean; fuel?: number; cans?: number} = {}) {
  const inv = new Inventory();
  const gun = inv.makeStack(FLAMETHROWER_ID, 1);
  inv.hotbar[0] = gun;
  let tank: ItemStack | null = null;
  if (o.tank !== false) {
    tank = inv.makeStack(FUEL_TANK_ID, 1);
    if (o.fuel !== undefined) tank.fuel = o.fuel;
    inv.gearSlots[BACK] = tank;
  }
  for (let i = 0; i < (o.cans ?? 0); i++) inv.pack[i] = inv.makeStack(FLAME_FUEL_CAN, 1);
  const wc = new WeaponController();
  wc.equip(gun);
  const events: WeaponEvent[] = [];
  const run = (seconds: number, input: TriggerInput, dt = 1 / 60) => {
    const out: WeaponEvent[] = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) out.push(...wc.update(dt, input, inv));
    events.push(...out);
    return out;
  };
  run(DEF.equipTime + 0.05, IDLE); // raised
  events.length = 0;
  return {inv, gun, tank, wc, run, events};
}
const ticks = (ev: readonly WeaponEvent[]) => ev.reduce((n, e) => n + (e.type === 'flame' ? e.ticks : 0), 0);
const types = (ev: readonly WeaponEvent[]) => ev.map(e => e.type);

describe('flamethrower: the weapon and its tank', () => {
  it('is a stream weapon with no magazine and no caliber; the tank is back-slot gear holding whole units', () => {
    expect(DEF.stream).toEqual({unitSeconds: FLAME_FUEL.unitSeconds, refillTime: FLAME_FUEL.refillSeconds});
    expect(DEF.magazine).toBe(0);
    expect(DEF.caliber).toBeUndefined();
    expect(DEF.melee).toBeUndefined();
    expect(DEF.itemId).toBe(FLAMETHROWER_ID);
    expect(streamDefOf(FLAMETHROWER_ID)).toBe(DEF);
    expect(streamDefOf('pistol')).toBeNull();
    expect(Object.values(WEAPONS).filter(w => w.stream).map(w => w.id)).toEqual([FLAMETHROWER_ID]);
    expect(DEF.damage).toBeCloseTo(FLAME.dps * FLAME_FUEL.unitSeconds, 9); // (one tick's damage: the def and the fire agree)
    expect(DEF.range).toBe(FLAME.range);
    const tank = itemDef(FUEL_TANK_ID);
    expect(tank.kind).toBe('gear');
    expect(tank.gear).toMatchObject({slot: 'backpack', fuelCap: FLAME_FUEL.capacity});
    expect(tank.stackMax).toBe(1);
    expect(isFuelTank(FUEL_TANK_ID)).toBe(true);
    expect(isFuelTank('airtank_backpack')).toBe(false);
    expect(itemDef(FLAMETHROWER_ID).kind).toBe('weapon');
    // whole numbers that agree: a can is unitsPerCan units, the capacity whole cans, a new tank exactly the recipe's one can
    expect(FLAME_FUEL.capacity).toBe(FLAME_FUEL.unitsPerCan * FLAME_FUEL.capacityCans);
    expect(FLAME_FUEL.newUnits).toBe(FLAME_FUEL.unitsPerCan * FLAME_FUEL.newCans);
    expect(FLAME_FUEL.newCans).toBe(1);
    for (const n of [FLAME_FUEL.unitsPerCan, FLAME_FUEL.capacity, FLAME_FUEL.newUnits]) expect(Number.isInteger(n)).toBe(true);
  });

  it('a NEW tank stack holds exactly the recipe fuel; fuel helpers clamp and never invent or lose a unit', () => {
    const inv = new Inventory();
    const t = inv.makeStack(FUEL_TANK_ID, 1);
    expect(t.fuel).toBe(FLAME_FUEL.newUnits);
    expect(tankFuel(t)).toBe(FLAME_FUEL.newUnits);
    expect(tankRoom(t)).toBe(FLAME_FUEL.capacity - FLAME_FUEL.newUnits);
    // malformed / absent values read as empty or capped; other items hold no fuel
    expect(tankFuel({itemId: FUEL_TANK_ID})).toBe(0);
    expect(tankFuel({itemId: FUEL_TANK_ID, fuel: NaN})).toBe(0);
    expect(tankFuel({itemId: FUEL_TANK_ID, fuel: -5})).toBe(0);
    expect(tankFuel({itemId: FUEL_TANK_ID, fuel: 12.9})).toBe(12);
    expect(tankFuel({itemId: FUEL_TANK_ID, fuel: 1e9})).toBe(FLAME_FUEL.capacity);
    expect(tankFuel({itemId: 'backpack', fuel: 50})).toBe(0);
    expect(tankFuel(null)).toBe(0);
    // burnUnit: one unit or nothing
    t.fuel = 2;
    expect(burnUnit(t)).toBe(true);
    expect(burnUnit(t)).toBe(true);
    expect(burnUnit(t)).toBe(false);
    expect(t.fuel).toBe(0);
    // pourCan: a whole can or nothing
    expect(pourCan(t, inv)).toBe(false); // no can
    inv.pack[0] = inv.makeStack(FLAME_FUEL_CAN, 2);
    expect(pourCan(t, inv)).toBe(true);
    expect([t.fuel, inv.count(FLAME_FUEL_CAN)]).toEqual([FLAME_FUEL.unitsPerCan, 1]);
    t.fuel = FLAME_FUEL.capacity - FLAME_FUEL.unitsPerCan + 1; // one unit short of room for a can
    expect(canPourCan(t)).toBe(false);
    expect(pourCan(t, inv)).toBe(false);
    expect([t.fuel, inv.count(FLAME_FUEL_CAN)]).toEqual([FLAME_FUEL.capacity - FLAME_FUEL.unitsPerCan + 1, 1]);
    t.fuel = FLAME_FUEL.capacity - FLAME_FUEL.unitsPerCan;
    expect(pourCan(t, inv)).toBe(true);
    expect([t.fuel, inv.count(FLAME_FUEL_CAN)]).toEqual([FLAME_FUEL.capacity, 0]);
  });

  it('only a tank WORN on the back feeds it: not one in the pack, not a backpack / airtank on the back', () => {
    const {inv, tank} = rig();
    expect(wornFuelTank(inv)).toBe(tank);
    inv.gearSlots[BACK] = null;
    inv.pack[3] = tank;
    expect(wornFuelTank(inv)).toBeNull();
    inv.gearSlots[BACK] = inv.makeStack('airtank_backpack', 1);
    expect(wornFuelTank(inv)).toBeNull();
    inv.gearSlots[BACK] = inv.makeStack('backpack', 1);
    expect(wornFuelTank(inv)).toBeNull();
  });
});

describe('flamethrower: every tick of flame is paid for', () => {
  it('holding the trigger burns exactly one unit per tick, 10 a second, at 144 / 60 / 30 / 20 fps', () => {
    for (const fps of [144, 60, 30, 20]) {
      const r = rig({fuel: 600});
      const ev = r.run(3, HOLD, 1 / fps);
      const n = ticks(ev);
      expect(600 - tankFuel(r.tank), `${fps} fps`).toBe(n); // paid = given, exactly
      expect(n, `${fps} fps`).toBeGreaterThanOrEqual(29);
      expect(n, `${fps} fps`).toBeLessThanOrEqual(31); // 3 s at unitSeconds 0.1 (+ the first tick at once)
      expect(types(ev).filter(t => t === 'streamStart')).toHaveLength(1);
      expect(r.wc.streaming).toBe(true);
      // letting go: the stream ends once the tick already paid for has run out — no further unit
      const before = tankFuel(r.tank);
      const off = r.run(0.5, IDLE, 1 / fps);
      expect(ticks(off)).toBe(0);
      expect(tankFuel(r.tank)).toBe(before);
      expect(types(off)).toEqual(['streamEnd']);
      expect((off[0] as {dry: boolean}).dry).toBe(false);
      expect(r.wc.streaming).toBe(false);
    }
  });

  it('the first press gives its tick at once; tapping can never beat the rate (a tick lasts unitSeconds, paid once)', () => {
    const r = rig({fuel: 600});
    const first = r.wc.update(1 / 60, PRESS, r.inv);
    expect(types(first)).toEqual(['streamStart', 'flame']);
    expect(tankFuel(r.tank)).toBe(599);
    // hammer the trigger: down one frame, up the next, for 2 s
    let n = 1;
    for (let i = 0; i < 120; i++) n += ticks(r.wc.update(1 / 60, i % 2 ? PRESS : IDLE, r.inv));
    expect(600 - tankFuel(r.tank)).toBe(n);
    expect(n).toBeLessThanOrEqual(1 + Math.ceil((120 / 60) / FLAME_FUEL.unitSeconds)); // never more than a held trigger gives
  });

  it('a long frame pays for at most a few ticks and owes nothing after it (no burst of free or forced fuel)', () => {
    const r = rig({fuel: 600});
    r.run(0.5, HOLD);
    const before = tankFuel(r.tank);
    const ev = r.wc.update(2.0, HOLD, r.inv); // a 2 s hitch
    const n = ticks(ev);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3);
    expect(before - tankFuel(r.tank)).toBe(n);
    const next = r.wc.update(1 / 60, HOLD, r.inv); // no backlog fires on the next frame
    expect(ticks(next)).toBe(0);
  });

  it('runs the tank to exactly zero, then ends dry; an empty tank or no tank gives a dry click and no flame', () => {
    const r = rig({fuel: 7});
    const ev = r.run(2, HOLD);
    expect(ticks(ev)).toBe(7);
    expect(tankFuel(r.tank)).toBe(0);
    const end = ev.filter(e => e.type === 'streamEnd');
    expect(end).toHaveLength(1);
    expect((end[0] as {dry: boolean}).dry).toBe(true);
    expect(r.wc.streaming).toBe(false);
    // empty: a press clicks dry (throttled), nothing burns
    const dry = [...r.wc.update(1 / 60, PRESS, r.inv), ...r.run(1, HOLD)];
    expect(types(dry).filter(t => t === 'dry')).toHaveLength(1);
    expect(ticks(dry)).toBe(0);
    expect(tankFuel(r.tank)).toBe(0);
    // no tank worn at all
    const n = rig({tank: false, cans: 2});
    const ev2 = [...n.wc.update(1 / 60, PRESS, n.inv), ...n.run(1, HOLD)];
    expect(types(ev2)).toEqual(['dry']);
    expect(n.inv.count(FLAME_FUEL_CAN)).toBe(2); // (cans are never burned straight from the pack)
    expect(n.wc.streaming).toBe(false);
  });

  it('a lowered lance (sprinting / busy hands) gives no flame and takes no fuel; the flame goes out with the weapon', () => {
    const r = rig({fuel: 100});
    const ev = r.run(1, {...HOLD, lowered: true});
    expect(ev).toEqual([]);
    expect(tankFuel(r.tank)).toBe(100);
    r.run(0.35, HOLD);
    expect(r.wc.streaming).toBe(true);
    const used = 100 - tankFuel(r.tank);
    r.wc.equip(null);
    expect(r.wc.streaming).toBe(false);
    expect(r.wc.update(1, HOLD, r.inv)).toEqual([]);
    expect(100 - tankFuel(r.tank)).toBe(used);
  });

  it('touches no ammunition: rounds in the inventory are neither needed nor spent', () => {
    const r = rig({fuel: 50});
    r.inv.pack[5] = r.inv.makeStack('ammo_9mm', 30);
    const before = r.inv.count('ammo_9mm');
    expect(reserveFor(DEF, r.inv)).toBe(0);
    r.run(2, HOLD);
    expect(r.inv.count('ammo_9mm')).toBe(before);
    expect(r.gun.mag ?? 0).toBe(0);
  });
});

describe('flamethrower: refuelling from ordinary fuel cans', () => {
  it('R pours ONE can after the pour time: the can leaves and its units arrive in the same step, never before', () => {
    const r = rig({fuel: 30, cans: 2});
    expect(r.wc.canReload(r.inv)).toBe(true);
    const start = r.wc.update(1 / 60, {...IDLE, reload: true}, r.inv);
    expect(types(start)).toEqual(['refuelStart']);
    expect(r.wc.reloading).toBe(true);
    // mid-pour: nothing has moved yet
    r.run(FLAME_FUEL.refillSeconds * 0.9, IDLE);
    expect([tankFuel(r.tank), r.inv.count(FLAME_FUEL_CAN)]).toEqual([30, 2]);
    const end = r.run(FLAME_FUEL.refillSeconds * 0.2, IDLE);
    expect(types(end)).toEqual(['refuelEnd']);
    expect((end[0] as {poured: boolean}).poured).toBe(true);
    expect([tankFuel(r.tank), r.inv.count(FLAME_FUEL_CAN)]).toEqual([30 + FLAME_FUEL.unitsPerCan, 1]);
    expect(r.wc.reloading).toBe(false);
  });

  it('no flame while pouring; a pour stops a running stream first (its paid tick is not refunded or re-charged)', () => {
    const r = rig({fuel: 100, cans: 1});
    r.run(0.55, HOLD);
    const before = tankFuel(r.tank);
    const ev = r.wc.update(1 / 60, {...HOLD, reload: true}, r.inv);
    expect(types(ev)).toEqual(['streamEnd', 'refuelStart']);
    const pour = r.run(FLAME_FUEL.refillSeconds + 0.1, HOLD); // trigger held throughout the pour
    expect(ticks(pour.filter((_, i) => i < pour.findIndex(e => e.type === 'refuelEnd')))).toBe(0);
    expect(types(pour).slice(0, 1)).toEqual(['refuelEnd']);
    const after = pour.slice(1);
    expect(before + FLAME_FUEL.unitsPerCan - tankFuel(r.tank)).toBe(ticks(after)); // every unit since: a paid tick
  });

  it('a cancelled pour (lowered, or the can gone) takes nothing; a full tank, or one a whole can does not fit, cannot start one', () => {
    const r = rig({fuel: 10, cans: 1});
    r.wc.update(1 / 60, {...IDLE, reload: true}, r.inv);
    r.run(1, IDLE);
    const cancelled = r.wc.update(1 / 60, {...IDLE, lowered: true}, r.inv);
    expect(types(cancelled)).toEqual(['refuelEnd']);
    expect((cancelled[0] as {poured: boolean}).poured).toBe(false);
    expect([tankFuel(r.tank), r.inv.count(FLAME_FUEL_CAN)]).toEqual([10, 1]);
    // the can dropped mid-pour
    r.wc.update(1 / 60, {...IDLE, reload: true}, r.inv);
    r.run(1, IDLE);
    r.inv.pack[0] = null;
    const gone = r.run(0.1, IDLE);
    expect((gone[0] as {poured: boolean}).poured).toBe(false);
    expect(tankFuel(r.tank)).toBe(10);
    // no room for a whole can: refused before it starts
    for (const fuel of [FLAME_FUEL.capacity, FLAME_FUEL.capacity - FLAME_FUEL.unitsPerCan + 1]) {
      const f = rig({fuel, cans: 2});
      expect(f.wc.canReload(f.inv)).toBe(false);
      expect(f.wc.update(1 / 60, {...IDLE, reload: true}, f.inv)).toEqual([]);
      f.run(FLAME_FUEL.refillSeconds + 0.5, IDLE);
      expect([tankFuel(f.tank), f.inv.count(FLAME_FUEL_CAN)]).toEqual([fuel, 2]);
    }
    // no tank worn: no pour
    const n = rig({tank: false, cans: 2});
    expect(n.wc.canReload(n.inv)).toBe(false);
  });

  it('conservation over a long mixed session: units in the tank + flame ticks given == start + cans poured x unitsPerCan', () => {
    const r = rig({fuel: FLAME_FUEL.newUnits, cans: 5});
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    let given = 0, poured = 0;
    for (let i = 0; i < 6000; i++) {
      const dt = rnd() < 0.02 ? 0.3 : 1 / (30 + rnd() * 114);
      const held = rnd() < 0.7, input: TriggerInput = {held, pressed: held && rnd() < 0.2, reload: rnd() < 0.01, lowered: rnd() < 0.03};
      for (const e of r.wc.update(dt, input, r.inv)) {
        if (e.type === 'flame') given += e.ticks;
        if (e.type === 'refuelEnd' && e.poured) poured++;
      }
      expect(tankFuel(r.tank) + given).toBe(FLAME_FUEL.newUnits + poured * FLAME_FUEL.unitsPerCan);
      expect(r.inv.count(FLAME_FUEL_CAN)).toBe(5 - poured);
    }
    expect(given).toBeGreaterThan(200);
    expect(poured).toBeGreaterThan(0);
  });
});
