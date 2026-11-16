// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): REPAIRING THE TRUCK (world/surface/truckRepair.ts; the user's
// decision: "repairable, you just need 5 scrap metal") on the REAL vehicle controller and a real Inventory:
//  - [Hold E] at the nose of a stopped damaged / broken-down truck: exactly 5 scrap metal drawn ONCE through the crafting bench's own
//    material handling (carried, then the worn backpack) — the condition back to 1, mobility back, the engine fire out, the smoke
//    stopping, the record written; nothing else drawn (no fee, tool or kit);
//  - refused with NOTHING drawn: sound, seated, moving, short of scrap (the bench's text), and a hold released early / walked away from /
//    hit / looked away from / interrupted by a state change;
//  - never the truck's lockers or a secured-cargo record (scrap stored there does not count and is not touched).
import {describe, expect, it} from 'vitest';
import type {Inventory, SlotRef} from '../src/items/inventory';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {missingText} from '../src/craft/crafting';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {SURFACE_TRUCK_LANE, type SurfaceTruckRecord} from '../src/world/surface/truckStore';
import {TRUCK_CONDITION_TEXT, truckStateOf} from '../src/world/surface/truckCondition';
import {TRUCK_REPAIR, TRUCK_REPAIR_COST, TRUCK_REPAIR_TEXT, truckRepairHave} from '../src/world/surface/truckRepair';
import {frame, lookAt, press, run} from './helpers/skywaysCarHost';
import {getInTruck} from './helpers/surfaceTruckHost';
import {fieldHost, type FieldTestHost} from './helpers/surfaceTruckFieldHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

const P = (index: number): SlotRef => ({bar: 'pack', index});
const scrap = (inv: Inventory) => truckRepairHave(inv);

/** Stand `out` m in front of the nose (on its centre line, or `side` m across) and look at the nose. */
function atNose(h: FieldTestHost, car: SkywaysCar, out = 1.2, side = 0): void {
  const b = car.body!, nose = -TRUCK_SPEC.length / 2;
  const at = carToWorld(b.x, b.z, b.yaw, side, nose - out), face = carToWorld(b.x, b.z, b.yaw, 0, nose);
  h.player.place(at.x, at.z, 0, b.y);
  frame(h, car);
  lookAt(h, face.x, b.y + 1.1, face.z);
  frame(h, car);
}

/** Press E and keep it down for `s` seconds (then let go). */
function holdE(h: FieldTestHost, car: SkywaysCar, s: number, each?: () => void): void {
  h.keys.held.add('KeyE');
  press(h, car, 'KeyE');
  for (let t = 0; t < s; t += 1 / 60) { each?.(); frame(h, car); }
  h.keys.held.delete('KeyE');
  frame(h, car);
}

function damaged(c: number, n = 7) {
  const w = fieldHost();
  w.sys.condition.setCondition(c);
  if (n > 0) w.h.inv.set(P(0), w.h.inv.makeStack(SCRAP_METAL, n));
  return w;
}

describe('truck repair: exactly 5 scrap metal', () => {
  it('[Hold E] at the nose of a burning truck: 5 scrap drawn once, condition 1, the fire out, the smoke stopping, the record written', () => {
    const {h, car, sys, log, storage} = damaged(0.1);
    run(h, car, 0.5);
    expect(log.loops.filter(l => l.playing)).toHaveLength(1);
    expect(log.plumes.filter(p => p.alive)).toHaveLength(1);
    storage.stores[0].slots[0] = h.inv.makeStack('water', 2);
    car.store();
    const stored = structuredClone((h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord).storage);
    const pose = {x: car.body!.x, z: car.body!.z, yaw: car.body!.yaw};
    atNose(h, car);
    expect(sys.repair.aimed()).toBe(true);
    expect(car.prompt).toBe(TRUCK_REPAIR_TEXT.prompt(5));
    expect(TRUCK_REPAIR_COST).toMatchObject({[SCRAP_METAL]: 5, [ELECTRICAL_PARTS]: 0});
    holdE(h, car, TRUCK_REPAIR.holdS + 0.1);
    expect(sys.repair.counts.repairs).toBe(1);
    expect(scrap(h.inv)).toBe(2);
    expect(truckStateOf(car).condition).toBe(1);
    expect(log.cues).toContain('reactorRodStop');
    expect(log.loops.every(l => !l.playing)).toBe(true);
    expect(log.plumes.every(p => !p.alive)).toBe(true);
    expect(h.toasts).toContain(TRUCK_REPAIR_TEXT.done(5));
    const rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec.condition).toBe(1);
    expect(rec.storage).toEqual(stored);
    expect({x: car.body!.x, z: car.body!.z, yaw: car.body!.yaw}).toEqual(pose);
    // nothing burns or smokes any more; the repair is offered no longer
    const f = log.flameCalls, s = log.smokeCalls;
    run(h, car, 1);
    expect([log.flameCalls, log.smokeCalls]).toEqual([f, s]);
    expect(sys.repair.aimed()).toBe(false);
    expect(scrap(h.inv)).toBe(2);
  });

  it('a broken-down truck repaired drives again', () => {
    const {h, car, sys} = damaged(0);
    atNose(h, car);
    holdE(h, car, TRUCK_REPAIR.holdS + 0.1);
    expect(sys.repair.counts.repairs).toBe(1);
    getInTruck(h, car);
    const x0 = car.body!.x;
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    h.keys.held.clear();
    expect(Math.abs(car.body!.x - x0)).toBeGreaterThan(1);
  });

  it('carried first, then the worn backpack; the bench\'s exact debit; never the truck\'s lockers', () => {
    const {h, car, sys, storage} = damaged(0.4, 0);
    // scrap stored in the truck's locker does not count and is never touched
    const inLocker = h.inv.makeStack(SCRAP_METAL, 9);
    storage.stores[1].slots[0] = inLocker;
    expect(scrap(h.inv)).toBe(0);
    expect(sys.repair.repair()).toMatchObject({ok: false, reason: 'missing', text: missingText({[SCRAP_METAL]: 5})});
    expect(storage.stores[1].slots[0]).toBe(inLocker);
    expect(inLocker.count).toBe(9);
    // 3 carried + 2 in the worn backpack (+ electrical parts that are never drawn)
    h.inv.set(P(0), h.inv.makeStack(SCRAP_METAL, 3));
    h.inv.set(P(1), h.inv.makeStack(ELECTRICAL_PARTS, 4));
    const bag = h.inv.makeStack('backpack', 1);
    expect(h.inv.wearBag(bag)).toBe(true);
    bag.bag![0] = h.inv.makeStack(SCRAP_METAL, 2);
    expect(scrap(h.inv)).toBe(5);
    atNose(h, car);
    expect(car.prompt).toBe(TRUCK_REPAIR_TEXT.prompt(5));
    holdE(h, car, TRUCK_REPAIR.holdS + 0.1);
    expect(sys.repair.counts.repairs).toBe(1);
    expect(scrap(h.inv)).toBe(0);
    expect(h.inv.get(P(1))).toMatchObject({itemId: ELECTRICAL_PARTS, count: 4});
    expect(inLocker.count).toBe(9);
    expect(storage.stores[1].slots[0]).toBe(inLocker);
  });
});

describe('truck repair: refused or cancelled — nothing drawn', () => {
  it('sound, seated, moving, short of scrap: refused with the reason, the scrap untouched', () => {
    const sound = damaged(1);
    atNose(sound.h, sound.car);
    expect(sound.sys.repair.aimed()).toBe(false); // (nothing to repair: not offered)
    expect(sound.car.prompt).not.toBe(TRUCK_REPAIR_TEXT.prompt(5));
    expect(sound.sys.repair.repair()).toMatchObject({ok: false, reason: 'healthy'});
    expect(scrap(sound.h.inv)).toBe(7);

    const seated = damaged(0.5);
    getInTruck(seated.h, seated.car);
    expect(seated.sys.repair.repair()).toMatchObject({ok: false, reason: 'seated', text: TRUCK_REPAIR_TEXT.seated});
    expect(scrap(seated.h.inv)).toBe(7);

    const moving = damaged(0.5);
    moving.car.body!.v = 2;
    expect(moving.sys.repair.repair()).toMatchObject({ok: false, reason: 'moving', text: TRUCK_REPAIR_TEXT.moving});
    expect(scrap(moving.h.inv)).toBe(7);

    const short = damaged(0.5, 4);
    atNose(short.h, short.car);
    expect(short.car.prompt).toBe(TRUCK_REPAIR_TEXT.short(4, 5));
    press(short.h, short.car, 'KeyE');
    expect(short.sys.repair.hold.pending).toBe(false);
    expect(short.h.toasts).toContain(missingText({[SCRAP_METAL]: 1}));
    expect(short.h.sfxCalls).toContain('denied');
    expect(scrap(short.h.inv)).toBe(4);
    expect(truckStateOf(short.car).condition).toBe(0.5);
    expect(short.car.driving).toBe(false); // (one action per press: never the doors)
  });

  it('a hold released early, walked away from, hit, looked away from or interrupted by a state change cancels — nothing consumed', () => {
    const cases: [string, (w: ReturnType<typeof damaged>) => void][] = [
      ['released early', () => {}],
      ['walked away', w => { const b = w.car.body!, at = carToWorld(b.x, b.z, b.yaw, 0.9, -TRUCK_SPEC.length / 2 - 1.2); w.h.player.place(at.x, at.z, 0, b.y); }],
      ['hit', w => { for (const l of w.h.hitListeners) l({amount: 8}); }],
      ['looked away', w => { w.h.player.yaw += Math.PI / 2; }],
      ['paused', w => { (w.h as {state: string}).state = 'paused'; for (const l of w.h.stateListeners) l('paused' as never, 'playing' as never); }],
    ];
    for (const [what, act] of cases) {
      const w = damaged(0.3);
      atNose(w.h, w.car);
      if (what === 'released early') holdE(w.h, w.car, 1);
      else holdE(w.h, w.car, TRUCK_REPAIR.holdS + 0.2, (() => { let done = false; return () => { if (!done && w.sys.repair.hold.t > 1) { done = true; act(w); } }; })());
      expect(w.sys.repair.counts.repairs, what).toBe(0);
      expect(scrap(w.h.inv), what).toBe(7);
      expect(truckStateOf(w.car).condition, what).toBe(0.3);
      expect(w.sys.repair.hold.pending, what).toBe(false);
      if (what === 'released early') expect(w.h.toasts, what).toContain(TRUCK_REPAIR_TEXT.hold);
      else expect(w.sys.repair.counts.cancelled, what).toBeGreaterThan(0);
    }
  });

  it('the prompt stays the repair\'s for the whole hold (never the doors), and a second press during it does nothing else', () => {
    const {h, car, sys} = damaged(0.6);
    atNose(h, car);
    h.keys.held.add('KeyE');
    press(h, car, 'KeyE');
    run(h, car, 1);
    expect(sys.repair.hold.pending).toBe(true);
    expect(car.prompt).toBe(TRUCK_REPAIR_TEXT.prompt(5));
    press(h, car, 'KeyE'); // (a repeat press while held: swallowed)
    expect(car.driving).toBe(false);
    run(h, car, TRUCK_REPAIR.holdS);
    h.keys.held.clear();
    expect(sys.repair.counts.repairs).toBe(1);
    expect(scrap(h.inv)).toBe(2);
    expect(h.toasts).not.toContain(TRUCK_CONDITION_TEXT.dead);
  });
});
