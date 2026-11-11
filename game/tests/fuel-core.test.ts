// Task studio-beta-train-fuel-system-20261106-024923-01: the pure fuel core (fuel/fuel.ts) — the user-confirmed numbers, the per-station
// plans (deterministic, own RNG namespace, >= one tank, the cart counting toward it), route cost, the departure draw order and its
// exact refund (quantity conservation), the records' validators and the wording.
import {describe, expect, it} from 'vitest';
import {FUEL, FUEL_PLAN, applyDebit, canUnitsIn, cartProblem, debitProblem, debitUnits, planDebit, refundDebit, reservesOf, routeCost, stationFuelPlan, stationFuelPlanV1,
  stationFuelProblem, stationFuelRemaining, tanksText, trainFuelProblem, type CartFuel} from '../src/fuel/fuel';
import {cartAboard, cartStraddles, fuelPortLocal} from '../src/fuel/trainPort';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {ITEMS, itemDims} from '../src/items/items';
import {Inventory, type ItemStack} from '../src/items/inventory';
import {GEAR_WEIGHTS} from '../src/items/lootTables';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {PlayerTrainRecord} from '../src/run/playerTrain';

const inv = new Inventory();
const cans = (n: number): ItemStack => { const s = inv.makeStack('fuel_can', n); s.count = n; return s; };

describe('the user-confirmed numbers (quarter-tank units)', () => {
  it('tank 4 = one hop; a hop costs 4; a can 1, stack 2 (two slots = a tank); a cart 8 (two tanks); a station >= 4 in total', () => {
    // (task gameplay-feedback-20261111 lane TRAVEL: the train holds four tanks = 16; was 8 — every other unit unchanged)
    expect(FUEL).toMatchObject({tankUnits: 4, trainTankUnits: 16, hopUnits: 4, canUnits: 1, canStackMax: 2, cartUnits: 8, stationMinUnits: 4, canItem: 'fuel_can'});
    expect(ITEMS.fuel_can).toMatchObject({id: 'fuel_can', kind: 'supply', stackMax: 2, icon: 'fuelCan'});
    expect(2 * FUEL.canStackMax * FUEL.canUnits).toBe(FUEL.tankUnits);
    expect(itemDims('fuel_can').h).toBeCloseTo(0.30, 2); // task fuel-feedback: user "Smaller fuel cans roughly med-pack sized" (was a 0.47 m jerrycan)
    expect(routeCost(1)).toBe(4);
    expect(routeCost(3)).toBe(12); // a 3-hop route costs 3 tanks
    expect(routeCost(3, true)).toBe(0); // the map cheat waives it
  });

  it('a New Game train starts EMPTY (tank 0, no cargo); NewGame resets it; an old save without fuel loads empty', () => {
    const r = new PlayerTrainRecord(), p = r.participant();
    expect(r.fuel.toJSON()).toEqual({v: 1, tank: 0, cargo: []});
    r.fuel.tank = 3;
    p.reset();
    expect(r.fuel.tank).toBe(0);
    p.load({id: 'player-train-l1', tier: 1, at: null}); // an old save: no `fuel`
    expect(r.fuel.toJSON()).toEqual({v: 1, tank: 0, cargo: []});
    p.load({id: 'player-train-l1', tier: 1, at: null, fuel: {v: 1, tank: 17, cargo: []}}); // malformed (past the four-tank train): empty, never invented fuel
    expect(r.fuel.tank).toBe(0);
    const cargo = [{uid: 'cart:st-03', units: 5, x: 1.5, y: 0.98, z: 0.4, yaw: 0.2}];
    p.load({id: 'player-train-l1', tier: 1, at: null, fuel: {v: 1, tank: 2, cargo}});
    expect(r.fuel.toJSON()).toEqual({v: 1, tank: 2, cargo});
    expect((p.save() as {fuel: unknown}).fuel).toEqual({v: 1, tank: 2, cargo});
  });
});

describe('station fuel plans (deterministic per network seed + station id; >= one tank; the cart counts)', () => {
  // task fuel-feedback (user: "Target about 4 tanks average per level … not forced to comb the whole level for the last can")
  it('v2: deterministic, about 4 tanks on average with useful variation, never below one tank; a cart is PART of a rich station\'s total', () => {
    const ids = Array.from({length: 60}, (_, i) => `st-${String(i).padStart(2, '0')}`);
    let carts = 0, total = 0, sum = 0, lean = 0, rich = 0, min = Infinity, max = 0;
    for (const seed of [1, 7, 12345, 0xdeadbeef, 42, 9001]) {
      for (const id of ids) {
        const a = stationFuelPlan(seed, id), b = stationFuelPlan(seed, id);
        expect(a).toEqual(b);
        expect(a.units).toBeGreaterThanOrEqual(FUEL.stationMinUnits);
        expect(a.units).toBeLessThanOrEqual(FUEL.stationMinUnits + 2 * FUEL_PLAN.rollMax);
        expect(a.units).toBe(a.cans * FUEL.canUnits + a.cart);
        if (a.cart) {
          carts++;
          expect(a.cart).toBe(FUEL.cartUnits);
          expect(a.units).toBeGreaterThanOrEqual(FUEL_PLAN.cartMinTotal);
          expect(a.cans).toBeGreaterThanOrEqual(4); // a cart station still has cans: the cart is not "half the target and nothing else"
        }
        sum += a.units; total++; min = Math.min(min, a.units); max = Math.max(max, a.units);
        if (a.units <= 8) lean++;
        if (a.units >= 24) rich++;
      }
    }
    const avg = sum / total;
    expect(avg).toBeGreaterThan(15); // ~16 units = 4 tanks
    expect(avg).toBeLessThan(17);
    expect(lean / total).toBeGreaterThan(0.03); // now and then a lean station …
    expect(lean / total).toBeLessThan(0.15);
    expect(rich / total).toBeGreaterThan(0.03); // … or a rich one
    expect(min).toBeLessThan(10);
    expect(max).toBeGreaterThan(22);
    expect(carts / total).toBeGreaterThan(0.12); // the optional cart: not a guarantee
    expect(carts / total).toBeLessThan(0.28);
    const differs = ids.filter(id => JSON.stringify(stationFuelPlan(1, id)) !== JSON.stringify(stationFuelPlan(2, id))).length;
    expect(differs).toBeGreaterThan(30); // another network seed: other plans (its own namespace per network)
  });

  it('v1 (released saves) is kept exactly: 12 % a full cart and no cans, else 4-6 cans mostly at the minimum (the delta\'s baseline)', () => {
    const ids = Array.from({length: 40}, (_, i) => `st-${String(i).padStart(2, '0')}`);
    let carts = 0, atMin = 0, total = 0;
    for (const seed of [1, 7, 12345, 0xdeadbeef]) {
      for (const id of ids) {
        const a = stationFuelPlanV1(seed, id);
        expect(a).toEqual(stationFuelPlanV1(seed, id));
        if (a.cart) { carts++; expect([a.cart, a.cans, a.units]).toEqual([FUEL.cartUnits, 0, 8]); }
        else { expect(a.cans).toBeGreaterThanOrEqual(4); expect(a.cans).toBeLessThanOrEqual(6); if (a.cans === 4) atMin++; }
        total++;
      }
    }
    expect(carts / total).toBeGreaterThan(0.04);
    expect(carts / total).toBeLessThan(0.22);
    expect(atMin / (total - carts)).toBeGreaterThan(0.55);
    // pinned values of the released v1 rolls (a v1 save's delta must be sized against exactly what it realized)
    expect(Array.from({length: 24}, (_, i) => `st-${String(i).padStart(2, '0')}`).map(id => stationFuelPlanV1(12345, id).units)).toEqual(V1_PIN);
  });

  it('the base filter / mask loot and the gear weights are untouched (the fuel task adds no loot rows)', () => {
    expect(MASK_LOOT.levels).toEqual({office: {masks: [1, 2], filters: [2, 5]}, subway: {masks: [0, 1], filters: [0, 2]}, mall: {masks: [1, 2], filters: [2, 5]}, reactor: {masks: [1, 1], filters: [3, 5]}, skyways: {masks: [1, 2], filters: [2, 5]}, market: {masks: [0, 0], filters: [0, 0]}, bunker: {masks: [1, 2], filters: [2, 5]}}); // (+ skyways: the Office's roll, task studio-skyways-level-20261106-054448-01; + market: clean air, no free loot — task studio-survivor-market-20261108-005807-01; + bunker: local gas leaks, the Office's roll — task studio-bunker-level-20261109-072224-01)
    expect(GEAR_WEIGHTS).toEqual({armor_vest: 1, chest_rig: 1, backpack: 1.4, helmet: 1, boots: 1, gloves: 1, airtank_backpack: 0.8});
  });
});

describe('the departure draw: tank, then carts aboard (uid order), then chest cans (slot order) — exact, refundable', () => {
  it('reserves count tank + carts + chest; planDebit draws in order and is null when short (nothing changes)', () => {
    const chest: (ItemStack | null)[] = [null, cans(2), inv.makeStack('water', 1), cans(1), null];
    const carts: CartFuel[] = [{uid: 'cart:b', units: 3}, {uid: 'cart:a', units: 2}];
    expect(reservesOf(1, carts, chest)).toEqual({tank: 1, carts: 5, chest: 3, total: 9});
    expect(canUnitsIn(chest)).toBe(3);
    expect(planDebit(10, 1, carts, chest)).toBeNull();
    const d = planDebit(8, 1, carts, chest)!;
    expect(d).toEqual({tank: 1, carts: [{uid: 'cart:a', units: 2}, {uid: 'cart:b', units: 3}], chest: [{uid: chest[1]!.uid, count: 2}]});
    expect(debitUnits(d)).toBe(8);
    expect(chest[1]!.count).toBe(2); // planning changes nothing
  });

  it('applyDebit then refundDebit restores every source exactly (an emptied chest stack comes back with its uid)', () => {
    const c1 = cans(2), c2 = cans(1);
    const chest: (ItemStack | null)[] = [c1, null, c2];
    const carts: CartFuel[] = [{uid: 'cart:x', units: 8}];
    const before = JSON.stringify({chest, carts});
    const d = planDebit(12, 4, carts, chest)!; // tank 4 + cart 8
    expect(d).toEqual({tank: 4, carts: [{uid: 'cart:x', units: 8}], chest: []});
    let tank = applyDebit(d, 4, carts, chest);
    expect([tank, carts[0].units]).toEqual([0, 0]);
    tank = refundDebit(d, tank, carts, chest, (count, uid) => ({uid, itemId: 'fuel_can', count}));
    expect(JSON.stringify({chest, carts})).toBe(before);
    expect(tank).toBe(4);
    const d2 = planDebit(3, 0, [], chest)!; // 2 + 1 cans, both stacks emptied
    tank = applyDebit(d2, 0, [], chest);
    expect(chest).toEqual([null, null, null]);
    refundDebit(d2, tank, [], chest, (count, uid) => ({uid, itemId: 'fuel_can', count}));
    expect(chest.filter(Boolean).map(s => [s!.uid, s!.count]).sort()).toEqual([[c1.uid, 2], [c2.uid, 1]].sort());
  });

  it('a 3-hop route needs 12: one full tank + 8 more aboard; with less, nothing is drawn', () => {
    expect(planDebit(routeCost(3), 4, [], [cans(2), cans(2), cans(2)])).toBeNull(); // 4 + 6 = 10 < 12
    expect(debitUnits(planDebit(routeCost(3), 4, [{uid: 'c', units: 8}], [])!)).toBe(12);
  });
});

describe('records and validators', () => {
  it('cart / train / station / debit records: good ones pass, malformed ones are named', () => {
    const cart = {uid: 'cart:st-01', units: 8, x: 1, y: 2, z: 3, yaw: 0};
    expect(cartProblem(cart, false)).toBeNull();
    expect(cartProblem({...cart, level: 0}, true)).toBeNull();
    expect(cartProblem({...cart, units: 9}, false)).toMatch(/out of range/);
    expect(cartProblem({...cart, units: 1.5}, false)).toMatch(/out of range/);
    expect(cartProblem({...cart, x: NaN}, false)).toMatch(/x out of range/);
    expect(cartProblem({...cart, extra: 1}, false)).toMatch(/unexpected/);
    expect(trainFuelProblem({v: 1, tank: 4, cargo: [cart]})).toBeNull();
    expect(trainFuelProblem({v: 1, tank: 8, cargo: []})).toBeNull(); // (task studio-general-armor-20261107-231448-01: the train holds two tanks)
    expect(trainFuelProblem({v: 1, tank: 16, cargo: []})).toBeNull(); // (task gameplay-feedback-20261111 lane TRAVEL: four tanks)
    expect(trainFuelProblem({v: 1, tank: 17, cargo: []})).toMatch(/out of range/);
    expect(trainFuelProblem({v: 1, tank: 1, cargo: [cart, cart]})).toMatch(/duplicate/);
    expect(stationFuelProblem({v: 1, realized: true, carts: [{...cart, level: 0}]})).toBeNull();
    expect(stationFuelProblem({v: 1, carts: []})).toMatch(/realized/);
    // v2 (task fuel-feedback): + the realized holder lots; a v1 record never carries lots
    expect(stationFuelProblem({v: 2, realized: true, carts: [], lots: ['shelf@0:120,-340#2901', 'crate@1:5,6#900']})).toBeNull();
    expect(stationFuelProblem({v: 2, realized: true, carts: []})).toMatch(/lots/);
    expect(stationFuelProblem({v: 2, realized: true, carts: [], lots: ['shelf@0:1,2#900', 'shelf@0:1,2#900']})).toMatch(/duplicate/);
    expect(stationFuelProblem({v: 2, realized: true, carts: [], lots: ['shelf 900']})).toMatch(/malformed/);
    expect(stationFuelProblem({v: 1, realized: true, carts: [], lots: []})).toMatch(/v1/);
    // v3 (task gameplay-feedback-20261111, lane FUEL-LOOT): the v2 shape, keyed by the station being built; v2 records are read as legacy
    expect(stationFuelProblem({v: 3, realized: true, carts: [], lots: ['crate@1:5,6#900']})).toBeNull();
    expect(stationFuelProblem({v: 3, realized: true, carts: []})).toMatch(/lots/);
    expect(stationFuelProblem({v: 4, realized: true, carts: [], lots: []})).toMatch(/version/);
    expect(debitProblem({tank: 1, carts: [{uid: 'c', units: 2}], chest: [{uid: 7, count: 2}]})).toBeNull();
    expect(debitProblem({tank: 1, carts: [], chest: [{uid: 7, count: 3}]})).toMatch(/chest/);
  });

  it('a station\'s remaining fuel counts loose cans, cans inside dropped / grounded bags and carts; tanks wording', () => {
    const n = stationFuelRemaining({
      pickups: [{stack: {itemId: 'fuel_can', count: 2}}, {stack: {itemId: 'water', count: 1}}, {stack: {itemId: 'backpack', count: 1, bag: [{itemId: 'fuel_can', count: 1}, null]}}],
      bags: [{stack: {bag: [{itemId: 'fuel_can', count: 2}, {itemId: 'water', count: 1}]}}],
      carts: [{units: 5}],
    });
    expect(n).toBe(2 + 1 + 2 + 5);
    // + recorded holder lots while their holder still lists them (a holder without a record keeps its lots)
    expect(stationFuelRemaining({lots: ['shelf@0:1,2#900', 'shelf@0:1,2#901', 'crate@0:3,4#900', 'desk@0:5,6#900'], holders: {'shelf@0:1,2': {lots: [7, 901]}, 'crate@0:3,4': {lots: []}}})).toBe(2);
    expect([tanksText(0), tanksText(1), tanksText(2), tanksText(3), tanksText(4), tanksText(6), tanksText(8), tanksText(9)])
      .toEqual(['empty', '¼ tank', '½ tank', '¾ tank', '1 tank', '1½ tanks', '2 tanks', '2¼ tanks']);
  });
});

/** stationFuelPlan(12345, st-00 .. st-23).units of the RELEASED v1 code (main 2109dc5; checked identical over 2,400 seed x id pairs). */
const V1_PIN = [4, 4, 4, 4, 4, 6, 8, 8, 4, 4, 4, 5, 8, 4, 4, 5, 4, 4, 4, 6, 4, 4, 4, 4];

describe('the fuel cap and the aboard rule (fuel/trainPort.ts)', () => {
  it('the cap sits on the platform-side skin between doors, 0.9 m above the floor; aboard = wholly inside; a doorway cart straddles', () => {
    const p = fuelPortLocal();
    expect(p.z).toBeLessThan(-PLAYER_TRAIN_SPEC.width / 2);
    expect(p.y).toBeCloseTo(PLAYER_TRAIN_SPEC.floorY + 0.9, 9);
    expect(p.x).toBeGreaterThan(0.18);
    expect(p.x).toBeLessThan(4.15);
    expect(cartAboard(0, 0)).toBe(true);
    expect(cartAboard(0, 1.1)).toBe(false); // against the side wall: not wholly inside
    expect(cartStraddles(0.18, -1.3)).toBe(true); // in the middle doorway
    expect(cartStraddles(0.18, -3)).toBe(false); // out on the platform
    expect(cartStraddles(0, 0)).toBe(false); // wholly in
  });
});
