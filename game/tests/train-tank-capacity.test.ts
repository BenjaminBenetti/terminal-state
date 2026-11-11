// Task gameplay-feedback-20261111 (lane TRAVEL; user: "Increase the train tank from two to four standard tanks (16 existing quarter-units).
// One hop still costs one standard tank; can/cart capacities and chipper yield stay unchanged. Preserve existing saved fuel amounts rather
// than filling the added capacity for free. Do not couple the capacity increase to a general fuel-loot increase."):
//  - FUEL.trainTankUnits 8 -> 16 (four tanks); every clamp / validator / refund / pour / hose / chipper transfer / gauge follows it;
//  - the hop (4), the can (1, stack 2), the cart (8), the station minimum (4) and the chipper's yield (2 ticks per body) and buffer (40)
//    are pinned unchanged; a New Game train still starts EMPTY (the same absolute amount as before: 0);
//  - an old save's tank (0..8) loads with its exact amount, through the real serializer / validator / restore; nothing tops it up;
//  - fuel supply does not follow the capacity: the market's fuel stall stocks exactly what it stocked (one hop .. two tanks, the same
//    seeded draws) and the station fuel plans never read the capacity.
// Node only.

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {FUEL, FUEL_PLAN, applyDebit, cartProblem, debitProblem, planDebit, refundDebit, routeCost, stationFuelPlan, tanksText, trainFuelProblem} from '../src/fuel/fuel';
import {CHIPPER, TANK_TICKS, freshChipper, transferToTank} from '../src/fuel/chipperFuel';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {fuelReadout, tankCount} from '../src/world/fuelPort';
import {FUEL_STALL_UNITS, stallDraws, stockRng, trainCapacityUnits} from '../src/market/trade/stock';
import {parseSaveText} from '../src/save/validate';
import {restoreRun, saveFileText} from '../src/save/serialize';
import type {ItemStack} from '../src/items/inventory';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';

const can = (uid: number, count: number): ItemStack => ({itemId: FUEL.canItem, count, uid} as ItemStack);

describe('the train tank: four standard tanks', () => {
  it('capacity 16 quarters = 4 tanks; a hop, a can, a stack, a cart, the station minimum and the chipper are unchanged', () => {
    expect(FUEL.trainTankUnits).toBe(16);
    expect(FUEL.trainTankUnits).toBe(4 * FUEL.tankUnits);
    expect([FUEL.tankUnits, FUEL.hopUnits, FUEL.canUnits, FUEL.canStackMax, FUEL.cartUnits, FUEL.stationMinUnits]).toEqual([4, 4, 1, 2, 8, 4]);
    expect([routeCost(1), routeCost(2), routeCost(4)]).toEqual([4, 8, 16]); // one standard tank per hop
    expect([CHIPPER.ticksPerQuarter, CHIPPER.bodyTicks, CHIPPER.bufferMaxTicks, TANK_TICKS]).toEqual([5, 2, 40, 20]); // 0.1 tank per body
    expect(tanksText(FUEL.trainTankUnits)).toBe('4 tanks');
    expect(tankCount(FUEL.trainTankUnits)).toBe('4');
  });

  it('a new train starts EMPTY (as before); a NewGame reset empties it', () => {
    const t = new PlayerTrainRecord();
    expect(t.fuel.tank).toBe(0);
    t.fuel.tank = 11;
    t.participant().reset();
    expect(t.fuel.tank).toBe(0);
  });

  it('records: 0..16 valid, 17 refused; a cart still holds at most 8; a debit may take up to 16 from the tank', () => {
    for (const tank of [0, 1, 7, 8, 9, 12, 16]) expect(trainFuelProblem({v: 1, tank, cargo: []})).toBeNull();
    expect(trainFuelProblem({v: 1, tank: 17, cargo: []})).toMatch(/train fuel 17 out of range \(0 to 16\)/);
    expect(cartProblem({uid: 'c', units: 8, x: 0, y: 0, z: 0, yaw: 0}, false)).toBeNull();
    expect(cartProblem({uid: 'c', units: 9, x: 0, y: 0, z: 0, yaw: 0}, false)).toMatch(/units 9 out of range \(0 to 8\)/);
    expect(debitProblem({tank: 16, carts: [], chest: []})).toBeNull();
    expect(debitProblem({tank: 17, carts: [], chest: []})).toMatch(/tank out of range/);
  });

  it('a full tank pays a four-hop route alone; a refund puts exactly that back and never past 16', () => {
    const chest: (ItemStack | null)[] = [can(1, 2), null];
    const d = planDebit(routeCost(4), 16, [], chest)!;
    expect(d).toEqual({tank: 16, carts: [], chest: []});
    expect(applyDebit(d, 16, [], chest)).toBe(0);
    expect(chest[0]!.count).toBe(2);
    expect(refundDebit(d, 0, [], chest, (count, uid) => can(uid, count))).toBe(16);
    expect(refundDebit({tank: 4, carts: [], chest: []}, 14, [], [], (count, uid) => can(uid, count))).toBe(16);
    // five hops: the tank, then the chest cans
    const five = planDebit(routeCost(5), 16, [], [can(7, 2), can(8, 2)])!;
    expect(five).toEqual({tank: 16, carts: [], chest: [{uid: 7, count: 2}, {uid: 8, count: 2}]});
  });

  it('the chipper fills the bigger tank: whole quarters while there is room (16), the rest waits; the yield per body is unchanged', () => {
    const c = freshChipper();
    c.ticks = CHIPPER.bufferMaxTicks; // 40 ticks = 8 quarters waiting
    const fuel = {tank: 10};
    expect(transferToTank(c, fuel)).toBe(6); // room for 6 (was: none above 8)
    expect([fuel.tank, c.ticks]).toEqual([16, 10]);
    expect(transferToTank(c, fuel)).toBe(0);
    const empty = {tank: 0}, c2 = freshChipper();
    c2.ticks = 40;
    expect(transferToTank(c2, empty)).toBe(8);
    expect([empty.tank, c2.ticks]).toEqual([8, 0]);
  });

  it('the HUD: sixteen quarter pips (four groups), the text counts tanks; "low" is still short of one hop', () => {
    expect(fuelReadout(16, [], []).pips).toBe(16);
    expect(fuelReadout(20, [], []).pips).toBe(16); // never more pips than the tank
    expect(fuelReadout(9, [], []).text).toBe('Fuel 2¼ tanks');
    expect(fuelReadout(3, [], []).low).toBe(true);
    expect(fuelReadout(4, [], []).low).toBe(false);
  });

  describe('ui/hud.ts on the fake DOM', () => {
    let dom: FakeDom;
    beforeAll(() => { dom = installFakeDom(); });
    afterAll(() => dom.uninstall());
    it('the fuel row prints FUEL.trainTankUnits pips with a gap before each further tank (3 gaps)', async () => {
      const {Hud} = await import('../src/ui/hud');
      const hud = new Hud();
      hud.setFuel({pips: 9, tank: 9, text: 'Fuel 2¼ tanks', low: false});
      const row = dom.el('#light-panel').children[0];
      expect((row.innerHTML.match(/<i class="(?:on)?(?: gap)?">/g) ?? []).length).toBe(16);
      expect((row.innerHTML.match(/<i class="on(?: gap)?">/g) ?? []).length).toBe(9);
      expect((row.innerHTML.match(/ gap">/g) ?? []).length).toBe(3);
    });
  });
});

describe('save compatibility: the saved amount, never a free top-up', () => {
  it('an older save\'s tank (0..8, written by the two-tank build) loads with exactly that amount', () => {
    for (const tank of [0, 3, 4, 7, 8]) {
      const a = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
      a.run.current = {level: 'subway', section: 'main', station: sid(1)};
      a.train.fuel.tank = tank;
      const p = parseSaveText(saveFileText(a.file('arrival', 1)));
      expect(p.ok, p.ok ? '' : p.error).toBe(true);
      if (!p.ok) continue;
      expect((p.value.run.participants['player-train'] as {fuel: unknown}).fuel).toEqual({v: 1, tank, cargo: []});
      const b = new Harness(fixtureCampaign());
      b.train.fuel.tank = 16; // whatever the loading session had: the save's own amount replaces it
      const r = restoreRun(p.value.run, b.target());
      expect(r.failed).toEqual([]);
      expect(b.train.fuel.tank).toBe(tank);
    }
  });

  it('the record loader keeps an in-range amount exactly and loads a malformed one EMPTY (never invented fuel)', () => {
    const t = new PlayerTrainRecord();
    t.fuel.load({v: 1, tank: 6, cargo: []});
    expect(t.fuel.tank).toBe(6);
    t.fuel.load({v: 1, tank: 17, cargo: []});
    expect(t.fuel.tank).toBe(0);
    t.fuel.load(undefined);
    expect(t.fuel.tank).toBe(0);
  });
});

describe('the capacity is not a fuel-supply increase', () => {
  const stallUnits = (station: string, seed: number) => stallDraws('fuel', stockRng(station, seed, 'fuel')).filter(d => d.itemId === FUEL.canItem).reduce((n, d) => n + d.count * FUEL.canUnits, 0);
  /** The two-tank build's draw: rng.int(hop, two tanks) on the same stream (the first draw of the stall's stream). */
  const legacyUnits = (station: string, seed: number) => stockRng(station, seed, 'fuel').int(FUEL.hopUnits, 2 * FUEL.tankUnits);

  it('the market fuel stall stocks exactly what it stocked: one hop .. two tanks, the same seeded draw per station', () => {
    expect(FUEL_STALL_UNITS).toEqual({min: 4, max: 8});
    for (const st of ['st-03', 'st-09', 'st-21']) for (let seed = 1; seed <= 60; seed++) {
      const u = stallUnits(st, seed);
      expect(u).toBe(legacyUnits(st, seed));
      expect(u).toBeGreaterThanOrEqual(FUEL.hopUnits);
      expect(u).toBeLessThanOrEqual(2 * FUEL.tankUnits);
    }
    expect(trainCapacityUnits()).toBe(FUEL.trainTankUnits); // (the trade view's "your train holds 4 tanks" wording only)
  });

  it('neither the stall nor the station fuel plans read the capacity (a different tank size changes nothing)', () => {
    const before = {stall: [1, 2, 3, 4, 5].map(s => stallUnits('st-09', s)), plans: ['st-01', 'st-07', 'st-30'].map(id => stationFuelPlan(424242, id))};
    const desc = Object.getOwnPropertyDescriptor(FUEL, 'trainTankUnits')!;
    try {
      for (const cap of [8, 32]) {
        Object.defineProperty(FUEL, 'trainTankUnits', {value: cap, configurable: true, enumerable: true, writable: true});
        expect([1, 2, 3, 4, 5].map(s => stallUnits('st-09', s))).toEqual(before.stall);
        expect(['st-01', 'st-07', 'st-30'].map(id => stationFuelPlan(424242, id))).toEqual(before.plans);
      }
    } finally { Object.defineProperty(FUEL, 'trainTankUnits', desc); }
    expect(FUEL.trainTankUnits).toBe(16);
    expect(FUEL_PLAN).toEqual({version: 2, rollMax: 12, cartChance: 0.25, cartMinTotal: 12});
  });
});
