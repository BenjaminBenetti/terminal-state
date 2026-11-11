// Task studio-general-armor-20261107-231448-01 (user: "train should be able to hold 2 tanks of fuel internally. lets up it!"): the train's
// built-in tank holds FUEL.trainTankUnits = 8 quarter units (two tanks; was one = 4). Nothing else changes: a hop still costs one tank
// (4), a can is a quarter (stack 2), a cart two tanks (8), a New Game train starts EMPTY, stations keep their finite fuel; an old save's
// actual tank amount loads as it was (never doubled / topped up).
// Task gameplay-feedback-20261111 (lane TRAVEL; user: "Increase the train tank from two to four standard tanks"): the capacity is now 16
// (four tanks; train-tank-capacity.test.ts) — the pins below that named 8 as the capacity follow FUEL.trainTankUnits; the two-tank
// facts that still hold (a two-hop route from two tanks, a saved 0..8 kept exactly) stay.
import {describe, expect, it} from 'vitest';
import {FUEL, applyDebit, debitProblem, planDebit, refundDebit, routeCost, tanksText, trainFuelProblem} from '../src/fuel/fuel';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {fuelReadout} from '../src/world/fuelPort';
import type {ItemStack} from '../src/items/inventory';

const can = (uid: number, count: number): ItemStack => ({itemId: FUEL.canItem, count, uid} as ItemStack);

describe('train fuel: a two-tank internal reserve', () => {
  it('the capacity is four tanks now (was two); the hop / can / cart units are unchanged', () => {
    expect(FUEL.trainTankUnits).toBe(16);
    expect(FUEL.trainTankUnits).toBe(4 * FUEL.tankUnits);
    expect([FUEL.tankUnits, FUEL.hopUnits, FUEL.canUnits, FUEL.canStackMax, FUEL.cartUnits, FUEL.stationMinUnits]).toEqual([4, 4, 1, 2, 8, 4]);
    expect(routeCost(1)).toBe(4);
    expect(routeCost(2)).toBe(8);
  });

  it('a new train is empty; an old record keeps its actual amount (not doubled); the record validator takes 0..16 (was 0..8)', () => {
    const fresh = new PlayerTrainRecord();
    expect(fresh.fuel.tank).toBe(0);
    for (const tank of [0, 3, 4, 7, 8]) {
      const r = new PlayerTrainRecord();
      r.fuel.load({v: 1, tank, cargo: []});
      expect(r.fuel.tank).toBe(tank);
      expect(trainFuelProblem({v: 1, tank, cargo: []})).toBeNull();
    }
    expect(trainFuelProblem({v: 1, tank: 9, cargo: []})).toBeNull(); // (lane TRAVEL: within the four-tank train)
    expect(trainFuelProblem({v: 1, tank: 17, cargo: []})).toMatch(/out of range \(0 to 16\)/);
  });

  it('a two-tank reserve pays a two-hop route from the tank alone; a refund puts exactly that back (never past the capacity)', () => {
    const chest: (ItemStack | null)[] = [can(1, 2), null];
    const d = planDebit(routeCost(2), 8, [], chest)!;
    expect(d).toEqual({tank: 8, carts: [], chest: []});
    expect(debitProblem(d)).toBeNull();
    const after = applyDebit(d, 8, [], chest);
    expect(after).toBe(0);
    expect(chest[0]!.count).toBe(2); // the chest was not touched
    expect(refundDebit(d, after, [], chest, (count, uid) => can(uid, count))).toBe(8);
    // a one-hop route from a 6-quarter tank leaves 2 aboard
    const one = planDebit(routeCost(1), 6, [], chest)!;
    expect(one.tank).toBe(4);
    expect(applyDebit(one, 6, [], chest)).toBe(2);
    // the refund clamps at the capacity (lane TRAVEL: four tanks = 16; was 7 + 4 -> 8)
    expect(refundDebit({tank: 4, carts: [], chest: []}, 15, [], [], (count, uid) => can(uid, count))).toBe(FUEL.trainTankUnits);
  });

  it('the HUD readout: a pip per quarter in the tank; the tank text counts tanks', () => {
    expect(fuelReadout(8, [], []).pips).toBe(8);
    expect(fuelReadout(6, [], []).pips).toBe(6);
    expect(fuelReadout(3, [], []).low).toBe(true); // short of one hop
    expect(fuelReadout(4, [], []).low).toBe(false);
    expect(tanksText(8)).toBe('2 tanks');
    expect(tanksText(6)).toBe('1½ tanks');
  });
});
