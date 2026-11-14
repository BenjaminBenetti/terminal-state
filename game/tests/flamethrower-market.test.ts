// Task studio-flamethrower-fire-20261114-031614-01 (lane ECON): the flamethrower and its fuel tank at the MARKET's ordinary stalls.
// User: "Crafting OR normal Market vendors ONLY: no random loot, gun-pool additions or supply retuning" — "Existing normal Market vendors
// must stock this gun/tank". Covered here (focused, Node; market/trade/stock.ts, value.ts, stalls.ts, tradeSystem.ts):
//  - NO SUPPLY RETUNING: every market seed's draws and every seeded stack (item, count, condition, uid) are byte for byte what they were
//    before this task — fingerprints pinned on main — and the two new items are never a draw;
//  - THE ADDITIVE LOTS: every gun stall stocks exactly ONE flamethrower and every gear stall exactly ONE new fuel tank (its recipe's fuel),
//    made after every seeded stack; finite like all stock (bought once, gone for good);
//  - an ALREADY-SEEDED market remembered from before them is topped up exactly ONCE (the record's `extras` marker, written with the lots):
//    never again after a revisit, a save / load, a Retry or buying them; a record without the marker stays a valid save;
//  - PRICES: the flamethrower 140 ties; the tank 60 ties empty + its fuel at exactly the fuel can's value (10 ties a can, 5 cents a
//    unit): 70 new, 90 full; monotone in fuel; pouring a can into a tank moves value and never makes it; at every stall and fuel level a
//    sale pays less than the purchase costs; the fuel travels with the tank through a sale and a purchase (never refilled, never merged).
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {FLAMETHROWER_ID, FLAME_FUEL, FLAME_FUEL_CAN, FUEL_TANK_ID} from '../src/fire/flamethrowerSpec';
import {tankFuel, wornFuelTank} from '../src/fire/fuelTank';
import {MARKET_STALLS, MARKET_STALLS_ALL, type MarketStallId} from '../src/gen/market/marketTypes';
import {GEAR_SLOTS} from '../src/items/gear';
import {Inventory, stackToJSON, stacksIn, type ItemStack, type SlotRef} from '../src/items/inventory';
import {ITEMS} from '../src/items/items';
import {MARKET_STOCK_LANE, MarketStock, STOCK_EXTRAS, STOCK_EXTRAS_VERSION, STOCK_MAX, stallDraws, stockRng, type MarketStockJSON} from '../src/market/trade/stock';
import {TRADE_RATES, betterStall, buyBackPct, buyPrice, sellQuote} from '../src/market/trade/stalls';
import {CENTS, VALUE, baseCents, conditionText, isTradeable, stackCents, stackUnitCents, tankFuelCents} from '../src/market/trade/value';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {installRestore, makeSaveFile, maxUidOfRun, prepareRestore, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {MARKET_STATION, carriedTies, census, giveTies, tradeHost, uniqueUids} from './helpers/marketTradeFixture';

const BACK = GEAR_SLOTS.indexOf('backpack');
const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const KEY = {level: 'subway' as const, section: 'main', station: MARKET_STATION};
const memId = `${MARKET_STATION}:main`;
const CAP = FLAME_FUEL.capacity, CAN = FLAME_FUEL.unitsPerCan;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isExtra = (s: {itemId: string}) => s.itemId === FLAMETHROWER_ID || s.itemId === FUEL_TANK_ID;
const tankAt = (fuel?: number): Pick<ItemStack, 'itemId' | 'count' | 'fuel'> => (fuel === undefined ? {itemId: FUEL_TANK_ID, count: 1} : {itemId: FUEL_TANK_ID, count: 1, fuel});
/** A seeded stock, the inventory whose uid counter made it and how many stacks the seeding made (`made`: its last uid). */
function seeded(scope: string, seed: number, stalls: readonly MarketStallId[] = MARKET_STALLS) {
  const inv = new Inventory();
  let made = 0;
  const st = MarketStock.seed(scope, seed, (id, n) => { made++; return inv.makeStack(id, n); }, stalls);
  return {inv, st, made};
}

describe('market stock: no supply retuning — the draws and every seeded stack are what they were', () => {
  // Pinned on main (f284496c, before the flamethrower existed) with exactly this walk; the additive lots are sliced off the END of
  // their lists here — they are made after every seeded stack, so nothing before them may differ in any byte (items, counts, part-used
  // condition, uids).
  const STOCK_MAIN = '4af17e341cbf8546c99ad40bd8db984aa11f802d6e3c4b1f53e823678db8c689', STACKS_MAIN = 17120;
  const DRAWS_MAIN = '3819a4ebfb6810bce76f46b7b071c2a66c79550f74c3898990c7a1c759ff9937';

  it('300 stations × (the six stalls | + the bar): the seeded stacks hash to main\'s fingerprint', () => {
    const h = createHash('sha256');
    let stacks = 0, extras = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const stalls of [MARKET_STALLS, MARKET_STALLS_ALL]) {
        const {st} = seeded(`st-${String(seed % 37).padStart(2, '0')}`, (seed * 7919) >>> 0, stalls);
        for (const s of MARKET_STALLS_ALL) {
          const list = st.stalls[s], n = STOCK_EXTRAS.filter(x => x.stall === s).length;
          const own = list.slice(0, list.length - n);
          expect(list.slice(list.length - n).map(x => x.itemId)).toEqual(STOCK_EXTRAS.filter(x => x.stall === s).map(x => x.itemId));
          expect(own.some(isExtra)).toBe(false);
          h.update(JSON.stringify([s, own.map(x => stackToJSON(x))]));
          stacks += own.length;
          extras += n;
        }
      }
    }
    expect([h.digest('hex'), stacks, extras]).toEqual([STOCK_MAIN, STACKS_MAIN, 600 * STOCK_EXTRAS.length]);
  });

  it('every stall\'s draws hash to main\'s fingerprint; the flamethrower and the tank are never a draw', () => {
    const d = createHash('sha256');
    for (let seed = 1; seed <= 300; seed++) for (const s of MARKET_STALLS_ALL) d.update(JSON.stringify(stallDraws(s, stockRng(`st-${seed}`, seed * 31, s))));
    expect(d.digest('hex')).toBe(DRAWS_MAIN);
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 1500; seed++) for (const s of MARKET_STALLS_ALL) for (const x of stallDraws(s, stockRng(`st-${seed % 40}`, seed * 2654435761, s))) drawn.add(x.itemId);
    expect([drawn.has(FLAMETHROWER_ID), drawn.has(FUEL_TANK_ID)]).toEqual([false, false]);
    // the gunsmith's drawn weapons are the four they were; the outfitter's drawn gear is the loot gear + the mask
    expect([...drawn].filter(id => ITEMS[id].kind === 'weapon').sort()).toEqual(['knife', 'pistol', 'rifle', 'shotgun']);
    expect([...drawn].filter(id => ITEMS[id].kind === 'gear').sort()).toEqual(['airtank_backpack', 'armor_vest', 'backpack', 'boots', 'chest_rig', 'gas_mask', 'gloves', 'helmet']);
  });
});

describe('the additive lots: one flamethrower at every gun stall, one new fuel tank at every gear stall', () => {
  it('exactly one of each, last in its list, made after every seeded stack (the next uids), the tank with its recipe\'s fuel', () => {
    expect(STOCK_EXTRAS.map(x => [x.stall, x.itemId, x.count])).toEqual([['gun', FLAMETHROWER_ID, 1], ['gear', FUEL_TANK_ID, 1]]);
    expect(STOCK_EXTRAS_VERSION).toBe(1);
    for (let seed = 1; seed <= 120; seed++) {
      for (const stalls of [MARKET_STALLS, MARKET_STALLS_ALL]) {
        const {inv, st, made} = seeded(`st-${seed % 40}`, seed * 104729, stalls);
        const all = st.all();
        expect(all.filter(s => s.itemId === FLAMETHROWER_ID), `${seed}`).toHaveLength(1);
        expect(all.filter(s => s.itemId === FUEL_TANK_ID), `${seed}`).toHaveLength(1);
        const ft = st.stalls.gun.at(-1)!, tank = st.stalls.gear.at(-1)!;
        // the last two stacks the seeding made (a merged draw's uid is spent too: every seeded uid is below them)
        expect(ft).toEqual({uid: made - 1, itemId: FLAMETHROWER_ID, count: 1, mag: 0});
        expect(tank).toEqual({uid: made, itemId: FUEL_TANK_ID, count: 1, fuel: FLAME_FUEL.newUnits});
        expect(Math.max(...all.filter(s => !isExtra(s)).flatMap(stacksIn).map(s => s.uid))).toBeLessThan(made - 1);
        expect(inv.makeStack('water', 1).uid).toBe(made + 1);
        expect([st.extras, st.toJSON().extras]).toEqual([STOCK_EXTRAS_VERSION, STOCK_EXTRAS_VERSION]);
        for (const s of MARKET_STALLS_ALL) expect(st.stalls[s].length).toBeLessThanOrEqual(STOCK_MAX);
      }
    }
    expect(tankFuel(seeded('st-03', 5).st.stalls.gear.at(-1))).toBe(FLAME_FUEL.newCans * CAN);
  });

  it('deterministic; a station places them only at the stalls it has', () => {
    const a = seeded('st-07', 4242), b = seeded('st-07', 4242);
    expect(JSON.stringify(a.st.toJSON())).toBe(JSON.stringify(b.st.toJSON()));
    const noGun = seeded('st-07', 4242, ['medical', 'gear', 'scrap']).st;
    expect([noGun.stalls.gun.length, noGun.stalls.gear.at(-1)!.itemId, noGun.all().filter(isExtra).length, noGun.extras]).toEqual([0, FUEL_TANK_ID, 1, 1]);
    const neither = seeded('st-07', 4242, ['medical', 'fuel']).st;
    expect([neither.all().filter(isExtra).length, neither.extras]).toEqual([0, 1]);
  });

  it('addExtras: once, all or nothing (a stall at its limit takes no part of them), marked in the record', () => {
    const inv = new Inventory();
    const make = (id: string, n: number) => inv.makeStack(id, n);
    // a record from before the lots: no marker -> given once, then never again
    const old = MarketStock.fromJSON({v: 1, stalls: {gun: [{uid: 900, itemId: 'pistol', count: 1, mag: 3}], gear: []}});
    inv.reserveUids(old.maxUid());
    expect([old.extras, 'extras' in old.toJSON()]).toEqual([0, false]);
    const v0 = old.version;
    expect(old.addExtras(make)).toBe(true);
    expect([old.extras, old.version, old.toJSON().extras]).toEqual([1, v0 + 1, 1]);
    expect(old.stalls.gun.map(s => s.itemId)).toEqual(['pistol', FLAMETHROWER_ID]);
    expect(old.stalls.gear).toEqual([{uid: 902, itemId: FUEL_TANK_ID, count: 1, fuel: FLAME_FUEL.newUnits}]);
    const after = JSON.stringify(old.toJSON());
    expect(old.addExtras(make)).toBe(false);
    expect(JSON.stringify(old.toJSON())).toBe(after);
    // the marker survives the record; bought lots do not come back
    const back = MarketStock.fromJSON(json(old.toJSON()));
    back.stalls.gun.pop();
    back.stalls.gear.pop();
    expect(back.addExtras(make)).toBe(false);
    expect(back.all().filter(isExtra)).toEqual([]);
    // the gear stall at its limit: neither lot is added, the marker stays unset (a later build tries again) — never half of them
    const full = new MarketStock();
    for (let i = 0; i < STOCK_MAX; i++) full.stalls.gear.push(inv.makeStack('helmet', 1));
    expect(full.addExtras(make)).toBe(false);
    expect([full.extras, full.stalls.gun.length, full.stalls.gear.length, 'extras' in full.toJSON()]).toEqual([0, 0, STOCK_MAX, false]);
    full.stalls.gear.pop();
    expect(full.addExtras(make)).toBe(true);
    expect([full.extras, full.stalls.gun.length, full.stalls.gear.length]).toEqual([1, 1, STOCK_MAX]);
    // the marker as read from a record: a positive whole number (never above the current version); anything else = not given yet
    const marker = (extras: unknown) => MarketStock.fromJSON({v: 1, stalls: {}, extras}).extras;
    expect([1, 2, 99].map(marker)).toEqual([1, 1, 1]);
    expect([0, -1, 1.5, '1', null, undefined, true, {}].map(marker)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('finite: bought once, gone for good (leave / return never restocks them)', () => {
    const t = tradeHost();
    t.build();
    giveTies(t.h.inv, 400);
    expect([t.sys.counts.seeded, t.sys.counts.writes]).toEqual([1, 1]); // (the lots are part of the one seeding write)
    const rec0 = t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!;
    expect([rec0.extras, rec0.stalls.gun.filter(isExtra).length, rec0.stalls.gear.filter(isExtra).length]).toEqual([1, 1, 1]);
    t.standAt('gun');
    expect(t.press()).toBe(true);
    const gi = t.sys.stock!.stalls.gun.findIndex(s => s.itemId === FLAMETHROWER_ID);
    const ties = carriedTies(t.h.inv);
    const b = t.sys.buy(gi);
    expect(b).toMatchObject({ok: true, kind: 'buy', itemId: FLAMETHROWER_ID, count: 1, price: 140});
    expect(carriedTies(t.h.inv)).toBe(ties - 140);
    t.sys.close('user');
    t.standAt('gear');
    expect(t.press()).toBe(true);
    const ti = t.sys.stock!.stalls.gear.findIndex(s => s.itemId === FUEL_TANK_ID);
    expect(t.sys.buy(ti)).toMatchObject({ok: true, itemId: FUEL_TANK_ID, price: 70});
    expect(wornFuelTank(t.h.inv)).toMatchObject({itemId: FUEL_TANK_ID, fuel: FLAME_FUEL.newUnits}); // (a free back: worn at once, its fuel as bought)
    expect(carriedTies(t.h.inv)).toBe(ties - 210);
    t.sys.close('user');
    for (let i = 0; i < 3; i++) {
      t.teardown();
      t.build();
      expect(t.sys.stock!.all().filter(isExtra)).toEqual([]);
      expect(t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!.extras).toBe(1);
    }
    expect(t.sys.counts.seeded).toBe(1);
    expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
    expect(t.h.inv.invariants()).toEqual([]);
  });
});

describe('an already-seeded market from before the lots: topped up exactly once', () => {
  /** A market built now, its record rewritten as an older build left it: no additive lots, no marker (the seeded stacks untouched). */
  function oldMarket(ties = 0) {
    const t = tradeHost();
    t.build();
    if (ties) giveTies(t.h.inv, ties);
    const rec = json(t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!);
    for (const s of MARKET_STALLS) rec.stalls[s] = rec.stalls[s].filter(x => !isExtra(x));
    delete rec.extras;
    t.teardown();
    t.h.run.setLaneStore(MARKET_STOCK_LANE, json(rec), KEY);
    return {t, rec};
  }
  const lots = (st: MarketStock) => st.all().filter(isExtra).map(s => s.itemId);

  it('the first build after the update adds both lots (fresh uids, after the remembered stock) and writes the marked record at once', () => {
    const {t, rec} = oldMarket();
    const writes = t.sys.counts.writes, top = Math.max(...MARKET_STALLS.flatMap(s => rec.stalls[s]).map(s => s.uid));
    t.build();
    expect([t.sys.counts.seeded, t.sys.counts.loaded, t.sys.counts.writes]).toEqual([1, 1, writes + 1]);
    const st = t.sys.stock!;
    expect(lots(st)).toEqual([FLAMETHROWER_ID, FUEL_TANK_ID]);
    expect(st.stalls.gun.at(-1)).toMatchObject({itemId: FLAMETHROWER_ID, count: 1, mag: 0});
    expect(st.stalls.gear.at(-1)).toMatchObject({itemId: FUEL_TANK_ID, count: 1, fuel: FLAME_FUEL.newUnits});
    expect(Math.min(st.stalls.gun.at(-1)!.uid, st.stalls.gear.at(-1)!.uid)).toBeGreaterThan(top);
    // every remembered stack is exactly as it was, in its place
    for (const s of MARKET_STALLS) expect(JSON.stringify(st.stalls[s].filter(x => !isExtra(x)).map(x => stackToJSON(x))), s).toBe(JSON.stringify(rec.stalls[s]));
    const now = t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!;
    expect(now.extras).toBe(1);
    expect(JSON.stringify(now)).toBe(JSON.stringify(st.toJSON()));
    expect(uniqueUids(census(t.h.inv, st).uids)).toBe(true);
    expect(t.h.inv.toJSON().nextUid).toBeGreaterThan(st.maxUid());
    // ... and only once: later builds load the marked record and write nothing
    const marked = JSON.stringify(now);
    for (let i = 0; i < 3; i++) {
      t.teardown();
      t.build();
      expect(JSON.stringify(t.h.run.laneStore(MARKET_STOCK_LANE, KEY))).toBe(marked);
    }
    expect(t.sys.counts.writes).toBe(writes + 1);
    expect(lots(t.sys.stock!)).toEqual([FLAMETHROWER_ID, FUEL_TANK_ID]);
  });

  it('bought after the top-up, they never come back: revisit, save / load, and a second save / load', () => {
    const {t} = oldMarket(400);
    t.build();
    t.standAt('gun');
    t.press();
    expect(t.sys.buy(t.sys.stock!.stalls.gun.findIndex(s => s.itemId === FLAMETHROWER_ID))).toMatchObject({ok: true, price: 140});
    t.sys.close('user');
    t.standAt('gear');
    t.press();
    expect(t.sys.buy(t.sys.stock!.stalls.gear.findIndex(s => s.itemId === FUEL_TANK_ID))).toMatchObject({ok: true, price: 70});
    t.sys.close('user');
    t.teardown();
    t.build();
    expect(lots(t.sys.stock!)).toEqual([]);
    let from = t;
    for (let round = 0; round < 2; round++) {
      const v = parseSaveText(saveFileText(from.h.file('arrival')));
      expect(v.ok, v.ok ? '' : v.error).toBe(true);
      if (!v.ok) return;
      const u = tradeHost();
      installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
      u.build();
      expect([u.sys.counts.seeded, u.sys.counts.loaded, u.sys.counts.writes]).toEqual([0, 1, 0]); // (loaded, nothing to add, nothing written)
      expect(lots(u.sys.stock!)).toEqual([]);
      const mine = u.h.inv.allStacks(true).filter(isExtra);
      expect(mine.map(s => s.itemId).sort()).toEqual([FLAMETHROWER_ID, FUEL_TANK_ID]);
      expect(uniqueUids(census(u.h.inv, u.sys.stock!).uids)).toBe(true);
      from = u;
    }
  });

  it('an old save (no marker) is valid, loads and is topped up once with uids above everything in the run', () => {
    const {t, rec} = oldMarket();
    t.h.train.lockbox.slots[0] = t.h.inv.makeStack('rifle', 1); // (a stored stack with a high uid)
    const file = t.h.file('arrival');
    expect((file.run.memories as unknown as Record<string, {lanes: Record<string, MarketStockJSON>}>)[memId].lanes[MARKET_STOCK_LANE]).toEqual(rec);
    const v = parseSaveText(saveFileText(file));
    expect(v.ok, v.ok ? '' : v.error).toBe(true);
    if (!v.ok) return;
    const top = maxUidOfRun(v.value.run);
    const u = tradeHost();
    installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
    u.build();
    expect([u.sys.counts.seeded, u.sys.counts.loaded, u.sys.counts.writes]).toEqual([0, 1, 1]);
    const st = u.sys.stock!;
    expect(lots(st)).toEqual([FLAMETHROWER_ID, FUEL_TANK_ID]);
    expect(Math.min(...st.all().filter(isExtra).map(s => s.uid))).toBeGreaterThan(top);
    expect(uniqueUids([...census(u.h.inv, st).uids, ...u.h.train.lockbox.slots.filter((s): s is ItemStack => !!s).map(s => s.uid)])).toBe(true);
    // the topped-up run saves and validates (the marker is part of a valid record) and restores without a second top-up
    const again = parseSaveText(saveFileText(u.h.file('arrival')));
    expect(again.ok, again.ok ? '' : again.error).toBe(true);
    if (!again.ok) return;
    const w = tradeHost();
    installRestore(prepareRestore(again.value.run, w.h.makeRun), w.h.target());
    w.build();
    expect([w.sys.counts.loaded, w.sys.counts.writes, lots(w.sys.stock!)]).toEqual([1, 0, [FLAMETHROWER_ID, FUEL_TANK_ID]]);
    expect(JSON.stringify(w.sys.stock!.toJSON())).toBe(JSON.stringify(st.toJSON()));
  });

  it('Retry to an entry snapshot from before the lots: one of each again, never two; the bought ones go back with the inventory', () => {
    const {t} = oldMarket(400);
    t.h.takeEntry(); // (the level-entry snapshot holds the old record)
    const snap = t.h.run.entry!;
    t.build();
    t.standAt('gun');
    t.press();
    expect(t.sys.buy(t.sys.stock!.stalls.gun.findIndex(s => s.itemId === FLAMETHROWER_ID)).ok).toBe(true);
    t.sys.close('user');
    for (let i = 0; i < 2; i++) {
      t.teardown();
      t.h.run.restoreScopeMemories(KEY, snap.memories);
      t.h.inv.loadJSON(restoreCarry(snap, {player: t.h.player, survival: t.h.survival, battery: t.h.battery, stats: t.h.stats}).toJSON());
      restoreParticipants(snap, t.h.participants);
      t.build();
      expect(lots(t.sys.stock!)).toEqual([FLAMETHROWER_ID, FUEL_TANK_ID]);
      expect(t.h.inv.allStacks(true).filter(isExtra)).toEqual([]);
      expect(carriedTies(t.h.inv)).toBe(400);
      expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
    }
  });

  it('save validation: the marker is optional, 1 .. the current version, a whole number; the lots are checked like any stock', () => {
    const t = tradeHost();
    t.build();
    const file = t.h.file('arrival');
    const revalidate = (mutate: (s: MarketStockJSON & Record<string, unknown>) => void) => {
      const run = structuredClone(file.run) as unknown as Record<string, unknown>;
      mutate((run.memories as Record<string, {lanes: Record<string, unknown>}>)[memId].lanes[MARKET_STOCK_LANE] as never);
      return validateSaveFile(makeSaveFile(run as never, (file as SaveFileV1Like).meta));
    };
    expect(revalidate(() => {}).ok).toBe(true);
    expect(revalidate(s => { delete s.extras; }).ok).toBe(true);
    for (const bad of [0, STOCK_EXTRAS_VERSION + 1, -1, 1.5, '1', null, true]) {
      const r = revalidate(s => { (s as {extras: unknown}).extras = bad; });
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.error, String(bad)).toMatch(/market\.stock\.extras/);
    }
    const gear = (s: MarketStockJSON) => s.stalls.gear.find(x => x.itemId === FUEL_TANK_ID)!;
    expect(revalidate(s => { gear(s).fuel = CAP; }).ok).toBe(true);
    expect(revalidate(s => { gear(s).fuel = 0; }).ok).toBe(true);
    expect(revalidate(s => { delete gear(s).fuel; }).ok).toBe(true);
    for (const [bad, re] of [[CAP + 1, /out of range/], [-1, /out of range/], [0.5, /not a whole number/], ['200', /finite number/]] as const) {
      const r = revalidate(s => { (gear(s) as {fuel: unknown}).fuel = bad; });
      expect(!r.ok && r.error, String(bad)).toMatch(re);
    }
    const r = revalidate(s => { (s.stalls.gun.find(x => x.itemId === FLAMETHROWER_ID) as {fuel?: number}).fuel = 5; });
    expect(!r.ok && r.error).toMatch(/flamethrower holds no fuel/);
    const m = revalidate(s => { s.stalls.gun.find(x => x.itemId === FLAMETHROWER_ID)!.mag = 1; });
    expect(!m.ok && m.error).toMatch(/out of range/); // (a stream weapon has no magazine to load)
  });
});

describe('prices: the flamethrower 140 ties; the tank 60 empty + its fuel at the fuel can\'s value', () => {
  const unit = (fuel?: number) => stackUnitCents(tankAt(fuel));

  it('the values: explicit, in whole cents; a can of fuel is worth the same in the tank as in the can', () => {
    expect(VALUE.fixed).toEqual({[FLAMETHROWER_ID]: 140, [FUEL_TANK_ID]: 60});
    expect([isTradeable(FLAMETHROWER_ID), isTradeable(FUEL_TANK_ID)]).toEqual([true, true]);
    expect([baseCents(FLAMETHROWER_ID), baseCents(FUEL_TANK_ID), baseCents(FLAME_FUEL_CAN)]).toEqual([140 * CENTS, 60 * CENTS, 10 * CENTS]);
    expect([tankFuelCents(0), tankFuelCents(1), tankFuelCents(CAN), tankFuelCents(CAP)]).toEqual([0, 5, baseCents(FLAME_FUEL_CAN), FLAME_FUEL.capacityCans * baseCents(FLAME_FUEL_CAN)]);
    expect([tankFuelCents(-5), tankFuelCents(1.9), tankFuelCents(Number.NaN)]).toEqual([0, 5, 0]);
    expect((CAN * tankFuelCents(1))).toBe(baseCents(FLAME_FUEL_CAN)); // (exact: no cent appears or vanishes over a can)
    // the tank: empty 60, new (one can) 70, two cans 80, full 90; absent = empty; never above a full tank
    expect([unit(0), unit(FLAME_FUEL.newUnits), unit(2 * CAN), unit(CAP)].map(c => c / CENTS)).toEqual([60, 70, 80, 90]);
    expect([unit(undefined), unit(CAP + 500), unit(-3)]).toEqual([unit(0), unit(CAP), unit(0)]);
    expect([0, FLAME_FUEL.newUnits, 2 * CAN, CAP].map(f => buyPrice(tankAt(f), 1))).toEqual([60, 70, 80, 90]);
    expect(stackCents(new Inventory().makeStack(FUEL_TANK_ID, 1))).toBe(70 * CENTS); // a NEW tank as the stalls stock it
    // the flamethrower: 140, whatever a stray `mag` says (it holds no rounds, no fuel)
    expect([stackUnitCents({itemId: FLAMETHROWER_ID, mag: 0}), stackUnitCents({itemId: FLAMETHROWER_ID, mag: 30}), stackUnitCents({itemId: FLAMETHROWER_ID})]).toEqual([14000, 14000, 14000]);
    expect(buyPrice({itemId: FLAMETHROWER_ID, mag: 0}, 1)).toBe(140);
    // no other item's value moved: the guns and the gear the user priced
    expect([buyPrice({itemId: 'armor_vest'}, 1), buyPrice({itemId: 'backpack'}, 1), buyPrice({itemId: FLAME_FUEL_CAN}, 1)]).toEqual([72, 78, 10]);
  });

  it('monotone in fuel: every unit adds exactly 5 cents; prices never fall as fuel rises', () => {
    let prevBuy = 0;
    const prevSell: Partial<Record<MarketStallId, number>> = {};
    for (let f = 0; f <= CAP; f++) {
      expect(unit(f)).toBe(60 * CENTS + 5 * f);
      const b = buyPrice(tankAt(f), 1);
      expect(b).toBeGreaterThanOrEqual(prevBuy);
      prevBuy = b;
      for (const s of MARKET_STALLS_ALL) {
        const q = sellQuote(s, tankAt(f), 1);
        expect(q.ok, `${s}:${f}`).toBe(true);
        if (!q.ok) continue;
        expect(q.price).toBeGreaterThanOrEqual(prevSell[s] ?? 0);
        prevSell[s] = q.price;
      }
    }
    expect(prevBuy).toBe(90);
  });

  it('pouring a can into a tank moves value, never makes it: tank + can = the fuller tank, to the cent', () => {
    for (let f = 0; f + CAN <= CAP; f += 7) expect(unit(f) + baseCents(FLAME_FUEL_CAN), `${f}`).toBe(unit(f + CAN));
    // burning it is the only way the value goes — one unit, five cents
    expect(unit(CAP) - unit(CAP - 1)).toBe(5);
  });

  it('no arbitrage: at every stall and fuel level a sale pays less than the purchase costs — with or without pouring cans in', () => {
    const best = (st: Pick<ItemStack, 'itemId' | 'count' | 'fuel' | 'mag'>) => Math.max(...MARKET_STALLS_ALL.map(s => { const q = sellQuote(s, st, 1); return q.ok ? q.price : 0; }));
    const can = buyPrice({itemId: FLAME_FUEL_CAN}, 1);
    for (let f = 0; f <= CAP; f++) {
      const cost = buyPrice(tankAt(f), 1);
      expect(best(tankAt(f)), `${f}`).toBeLessThan(cost);
      // buy the tank and k cans, pour them in, sell the fuller tank anywhere
      for (let k = 1; f + k * CAN <= CAP; k++) expect(best(tankAt(f + k * CAN)), `${f}+${k}`).toBeLessThan(cost + k * can);
    }
    const ft = {itemId: FLAMETHROWER_ID, count: 1, mag: 0};
    expect(best(ft)).toBeLessThan(buyPrice(ft, 1));
    // the right stall pays its own-line share, the others less
    expect([buyBackPct('gun', FLAMETHROWER_ID), buyBackPct('gear', FLAMETHROWER_ID), buyBackPct('gear', FUEL_TANK_ID), buyBackPct('gun', FUEL_TANK_ID)])
      .toEqual([TRADE_RATES.themedPct, TRADE_RATES.offPct, TRADE_RATES.themedPct, TRADE_RATES.offPct]);
    expect(sellQuote('gun', ft, 1)).toEqual({ok: true, price: 77, pct: 55, themed: true});
    expect(sellQuote('gear', tankAt(FLAME_FUEL.newUnits), 1)).toEqual({ok: true, price: 38, pct: 55, themed: true});
    expect([sellQuote('gear', tankAt(0), 1), sellQuote('gear', tankAt(CAP), 1)]).toMatchObject([{price: 33}, {price: 49}]);
    expect(betterStall('fuel', tankAt(CAP), 1)).toMatchObject({stall: 'gear', price: 49});
    expect(betterStall('gear', ft, 1)).toMatchObject({stall: 'gun', price: 77});
  });

  it('the trade row names the tank\'s fuel; the flamethrower has no rounds to name', () => {
    expect(conditionText(tankAt(FLAME_FUEL.newUnits))).toBe('fuel 1 of 3 cans');
    expect(conditionText(tankAt(CAP))).toBe('fuel 3 of 3 cans');
    expect(conditionText(tankAt(137))).toBe('fuel 0.6 of 3 cans');
    expect(conditionText(tankAt(1))).toBe('fuel 0 of 3 cans'); // (a trace: not a tenth of a can, and not "empty")
    expect(conditionText(tankAt(0))).toBe('fuel empty');
    expect(conditionText(tankAt())).toBe('fuel empty');
    expect(conditionText({itemId: FLAMETHROWER_ID, mag: 0})).toBe('');
    expect(conditionText({itemId: 'pistol', mag: 7})).toMatch(/^7 of \d+ rounds loaded$/);
  });

  it('a tank\'s fuel travels with it through a sale and a purchase: priced as it is, never refilled, never merged', () => {
    const t = tradeHost();
    t.build();
    giveTies(t.h.inv, 300);
    const used = t.h.inv.makeStack(FUEL_TANK_ID, 1);
    used.fuel = 37;
    t.h.inv.gearSlots[BACK] = used; // sold straight off the back
    const empty = t.h.inv.makeStack(FUEL_TANK_ID, 1);
    empty.fuel = 0;
    t.h.inv.set(P(0), empty);
    t.standAt('gear');
    expect(t.press()).toBe(true);
    const ties = carriedTies(t.h.inv);
    const s1 = t.sys.sell({bar: 'gear', index: BACK});
    expect(s1).toMatchObject({ok: true, kind: 'sell', itemId: FUEL_TANK_ID, price: Math.floor(((6000 + 37 * 5) * 55) / 10000), uid: used.uid});
    const s2 = t.sys.sell(P(0));
    expect(s2).toMatchObject({ok: true, price: 33, uid: empty.uid});
    expect(carriedTies(t.h.inv)).toBe(ties + 34 + 33);
    // three tanks on the shelf now, each its own lot with its own fuel (the stall's new one untouched)
    const shelf = t.sys.stock!.stalls.gear.filter(s => s.itemId === FUEL_TANK_ID);
    expect(shelf.map(s => s.fuel).sort((a, b) => a! - b!)).toEqual([0, 37, FLAME_FUEL.newUnits]);
    expect(shelf.find(s => s.fuel === 37)).toBe(used);
    // leave / return: the record keeps each
    t.sys.close('user');
    t.teardown();
    t.build();
    const back = t.sys.stock!.stalls.gear.filter(s => s.itemId === FUEL_TANK_ID);
    expect(back.map(s => [s.uid, s.fuel]).sort((a, b) => a[1]! - b[1]!)).toEqual([[empty.uid, 0], [used.uid, 37], [back.find(s => s.fuel === FLAME_FUEL.newUnits)!.uid, FLAME_FUEL.newUnits]]);
    // buy the part-used one back: its price by its fuel, the same uid and fuel in the hands again (worn: the back is free)
    t.standAt('gear');
    t.press();
    const i = t.sys.stock!.stalls.gear.findIndex(s => s.uid === used.uid);
    const b = t.sys.buy(i);
    expect(b).toMatchObject({ok: true, kind: 'buy', price: Math.ceil((6000 + 37 * 5) / 100), uid: used.uid});
    expect(wornFuelTank(t.h.inv)).toEqual({uid: used.uid, itemId: FUEL_TANK_ID, count: 1, fuel: 37});
    expect(carriedTies(t.h.inv)).toBe(ties + 34 + 33 - 62); // sold for 34, bought back for 62: no profit in the round trip
    expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
    expect(t.h.inv.invariants()).toEqual([]);
  });
});
