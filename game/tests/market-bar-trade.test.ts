// Task studio-market-bar-20261108-225231-01 (lane BAR): THE BARTENDER IS A STALL ('bar', gen/market/marketTypes.ts BAR_STALL) — on a
// layout-version-3 market it trades like every stall:
//  - finite stock seeded ONCE per station (all five beers, a few bottles each, + a little ordinary drink), written to the station's lane
//    memory at once, remembered (leave / return / save / load), never refilled; a market without a bar seeds and writes exactly the six
//    as before (same order, same uids); an old stock record without `bar` loads (an empty bar), the save check takes it with or without;
//  - the beers' prices: exactly 20 ties (the four timed beers) / 40 (Second Supper Bock) a bottle; the bar buys its own line (beers and
//    drinks) at the own-line rate, anything ordinary at the specialists' off-line rate; every other stall buys beer too; no arbitrage;
//  - the all-vendor rules (parts / ties refused), the deal line naming the bar only where the station has one;
//  - the hostility gating (no prompt / open / trade when the bartender won't trade), its stock's theft path (takeStock) and a theft record
//    naming the bar (the trader 'trader:bar').
import {describe, expect, it} from 'vitest';
import type {SlotRef} from '../src/items/inventory';
import {BEERS, BEER_IDS} from '../src/items/beers';
import {BAR_STALL, MARKET_STALLS, MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {BAR_BEER_COUNTS, MARKET_STOCK_LANE, MarketStock, stallDraws, stockRng, type MarketStockJSON} from '../src/market/trade/stock';
import {STALL_TRADE, TRADE_RATES, betterStall, buyBackPct, buyPrice, sellQuote} from '../src/market/trade/stalls';
import {validateSaveFile} from '../src/save/validate';
import {makeSaveFile, type SaveFileV1Like} from '../src/save/serialize';
import {econCat} from '../src/items/lootTables';
import {marketHostilityProblem, traderId} from '../src/market/combat/record';
import {RAIL_TIES_ID} from '../src/items/railTies';
import {Inventory} from '../src/items/inventory';
import {MARKET_STATION, carriedTies, census, fakeStall, giveTies, hostility, tradeHost, uniqueUids} from './helpers/marketTradeFixture';

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const KEY = {level: 'subway' as const, section: 'main', station: MARKET_STATION};

/** A trade host whose station is a layout-version-3 market (the six + the bar), built, with `ties` carried. */
function barMarket(ties = 0) {
  const t = tradeHost();
  t.layout.market = {...t.layout.market, v: 3, stalls: [...t.layout.market.stalls, fakeStall(BAR_STALL, 6, 2.95, 1)]};
  t.build();
  if (ties) giveTies(t.h.inv, ties);
  return t;
}

describe('the bar\'s stock: seeded once per station, remembered, never refilled', () => {
  it('a version-3 market seeds the bar with all five beers (a few bottles each) and a little drink, written to the lane memory at once', () => {
    const t = barMarket();
    expect([t.sys.counts.seeded, t.sys.counts.writes]).toEqual([1, 1]);
    expect(t.sys.stalls.map(s => s.id)).toEqual([...MARKET_STALLS_ALL]);
    const bar = t.sys.stock!.stalls.bar;
    for (const id of BEER_IDS) {
      const n = bar.filter(s => s.itemId === id).reduce((k, s) => k + s.count, 0);
      expect(n, id).toBeGreaterThanOrEqual(BAR_BEER_COUNTS[id][0]);
      expect(n, id).toBeLessThanOrEqual(BAR_BEER_COUNTS[id][1]);
    }
    const others = bar.filter(s => !(BEER_IDS as string[]).includes(s.itemId));
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const s of others) expect(econCat(s.itemId), s.itemId).toBe('drink');
    const rec = t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!;
    expect(rec.stalls.bar!.length).toBe(bar.length);
    expect(JSON.stringify(rec)).toBe(JSON.stringify(t.sys.stock!.toJSON()));
    expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
    // deterministic per station: its own stream (never a draw on another stall's)
    const again = MarketStock.seed('x', 7, (id, n) => new Inventory().makeStack(id, n), [...MARKET_STALLS_ALL]);
    expect(stallDraws(BAR_STALL, stockRng('x', 7, BAR_STALL))).toEqual(stallDraws(BAR_STALL, stockRng('x', 7, BAR_STALL)));
    expect(again.stalls.bar.length).toBeGreaterThanOrEqual(BEER_IDS.length);
  });

  it('bought bottles stay gone (leave / return loads the record: no re-seed, no refill); a sale to the bar stays sold', () => {
    const t = barMarket(1000);
    t.standAt(BAR_STALL);
    expect(t.press()).toBe(true);
    expect(t.sys.open?.id).toBe(BAR_STALL);
    const lager = () => t.sys.stock!.stalls.bar.filter(s => s.itemId === 'beer_lager').reduce((k, s) => k + s.count, 0);
    const had = lager(), ties = carriedTies(t.h.inv);
    const i = t.sys.stock!.stalls.bar.findIndex(s => s.itemId === 'beer_lager');
    const r = t.sys.buy(i);
    expect(r.ok).toBe(true);
    expect(carriedTies(t.h.inv)).toBe(ties - 20 * had); // 20 ties a bottle
    expect(lager()).toBe(0);
    t.h.inv.set(P(0), t.h.inv.makeStack('water', 2));
    expect(t.sys.sell(P(0)).ok).toBe(true);
    t.sys.close('user');
    t.teardown();
    t.build();
    expect([t.sys.counts.seeded, t.sys.counts.loaded]).toEqual([1, 1]);
    expect(lager()).toBe(0); // never refilled
    expect(t.sys.stock!.stalls.bar.some(s => s.itemId === 'water')).toBe(true);
    expect(uniqueUids(census(t.h.inv, t.sys.stock!).uids)).toBe(true);
  });

  it('a market without a bar seeds / writes exactly the six as before (same order, same uids); an old record without `bar` loads', () => {
    const t = tradeHost();
    t.build();
    const rec = t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!;
    expect(Object.keys(rec.stalls)).toEqual([...MARKET_STALLS]);
    const make = () => { const inv = new Inventory(); return (id: string, n: number) => inv.makeStack(id, n); };
    const six = MarketStock.seed('st-a', 99, make()), seven = MarketStock.seed('st-a', 99, make(), [...MARKET_STALLS_ALL]);
    // (re-pin, task studio-flamethrower-fire-20261114-031614-01: every SEEDED stack of the six is the same with or without the bar — same order, same
    // uids. The two additive lots (the flamethrower, its fuel tank) are made after every seeded stack, the bar's included, so they are
    // the same items at the end of the same lists with the uids that follow; the record carries their marker `extras`)
    const extra = (x: {itemId: string}) => x.itemId === 'flamethrower' || x.itemId === 'fuel_tank';
    for (const s of MARKET_STALLS) {
      expect(JSON.stringify(seven.stalls[s].filter(x => !extra(x))), s).toBe(JSON.stringify(six.stalls[s].filter(x => !extra(x))));
      expect(seven.stalls[s].filter(extra).map(x => [x.itemId, x.count, x.mag, x.fuel]), s).toEqual(six.stalls[s].filter(extra).map(x => [x.itemId, x.count, x.mag, x.fuel]));
    }
    expect(six.stalls.bar).toEqual([]);
    expect(JSON.stringify(six.toJSON())).toBe(JSON.stringify({v: 1, stalls: Object.fromEntries(MARKET_STALLS.map(s => [s, six.toJSON().stalls[s]])), extras: 1}));
    expect(Object.keys(seven.toJSON().stalls)).toEqual([...MARKET_STALLS_ALL]);
    // the given order never matters (the fixed order: the bar last)
    expect(JSON.stringify(MarketStock.seed('st-a', 99, make(), [BAR_STALL, ...MARKET_STALLS]).toJSON())).toBe(JSON.stringify(seven.toJSON()));
    // an old record (no bar) / a bar sold out (omitted: lossless) both load with an empty bar
    const back = MarketStock.fromJSON(JSON.parse(JSON.stringify(six.toJSON())));
    expect(back.stalls.bar).toEqual([]);
    expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(six.toJSON()));
    const round = MarketStock.fromJSON(JSON.parse(JSON.stringify(seven.toJSON())));
    expect(JSON.stringify(round.toJSON())).toBe(JSON.stringify(seven.toJSON()));
  });

  it('the save check takes a stock record with or without the bar; refuses a bar holding ties or a restart part, and unknown stalls', () => {
    const t = barMarket(10);
    const file = t.h.file('arrival') as SaveFileV1Like;
    expect(validateSaveFile(file).ok).toBe(true);
    const memId = `${MARKET_STATION}:main`;
    const mutate = (fn: (st: Record<string, unknown[]>) => void) => {
      const run = structuredClone(file.run) as unknown as {memories: Record<string, {lanes: Record<string, {stalls: Record<string, unknown[]>}>}>};
      fn(run.memories[memId].lanes[MARKET_STOCK_LANE].stalls);
      return validateSaveFile(makeSaveFile(run as never, file.meta));
    };
    expect(mutate(st => { delete st.bar; }).ok).toBe(true);
    expect(mutate(st => { st.bar = []; }).ok).toBe(true);
    const tie = {uid: 999_001, itemId: RAIL_TIES_ID, count: 5};
    expect(mutate(st => { st.bar = [...(st.bar ?? []), tie]; }).ok).toBe(false);
    expect(mutate(st => { st.bar = [...(st.bar ?? []), {uid: 999_002, itemId: 'fuse_cartridge', count: 1}]; }).ok).toBe(false);
    expect(mutate(st => { st.pub = []; }).ok).toBe(false);
    expect(mutate(st => { delete st.gun; }).ok).toBe(false); // (the six stay required)
  });
});

describe('the bar\'s prices and the all-vendor rules', () => {
  const inv = new Inventory();
  it('a bottle costs exactly 20 ties (the timed beers) / 40 (Second Supper Bock); the bar buys beer at its own-line rate, others lower', () => {
    for (const id of BEER_IDS) {
      const one = inv.makeStack(id, 1), six = inv.makeStack(id, 6);
      expect(buyPrice(one, 1), id).toBe(BEERS[id].price);
      expect(buyPrice(six, 6), id).toBe(6 * BEERS[id].price);
      expect(BEERS[id].price).toBe(id === 'beer_bock' ? 40 : 20);
      expect(buyBackPct(BAR_STALL, id)).toBe(TRADE_RATES.themedPct);
      const q = sellQuote(BAR_STALL, six, 6);
      expect(q.ok && q.price, id).toBe(Math.floor(6 * BEERS[id].price * TRADE_RATES.themedPct / 100));
      // every stall buys beer (the general store / scrapyard at their broad rates, the specialists at the off-line rate) — all below the bar
      for (const s of MARKET_STALLS) {
        expect(buyBackPct(s, id), `${id}@${s}`).toBe(STALL_TRADE[s].broadPct);
        const o = sellQuote(s, six, 6);
        expect(o.ok && o.price, `${id}@${s}`).toBeLessThan(q.ok ? q.price : 0);
      }
      // no arbitrage anywhere: the best sale is below the purchase
      for (const s of MARKET_STALLS_ALL) { const o = sellQuote(s, one, 1); expect(o.ok ? o.price : 0, `${id}@${s}`).toBeLessThan(buyPrice(one, 1)); }
    }
  });

  it('the bar\'s line is beers and drinks (own-line rate); it buys anything ordinary at the off-line rate; parts and ties never', () => {
    expect([STALL_TRADE.bar.label, STALL_TRADE.bar.line, STALL_TRADE.bar.broadPct]).toEqual(['Bartender', 'beers and drinks', TRADE_RATES.offPct]);
    expect(buyBackPct(BAR_STALL, 'water')).toBe(TRADE_RATES.themedPct);
    expect(buyBackPct(BAR_STALL, 'cola')).toBe(TRADE_RATES.themedPct);
    expect(buyBackPct(BAR_STALL, 'scrap_metal')).toBe(TRADE_RATES.offPct);
    expect(buyBackPct(BAR_STALL, 'rifle')).toBe(TRADE_RATES.offPct);
    expect(sellQuote(BAR_STALL, inv.makeStack('scrap_metal', 12), 12).ok).toBe(true);
    expect(sellQuote(BAR_STALL, inv.makeStack(RAIL_TIES_ID, 5), 5)).toMatchObject({ok: false, code: 'currency'});
    expect(sellQuote(BAR_STALL, inv.makeStack('fuse_cartridge', 1), 1)).toMatchObject({ok: false, code: 'part'});
  });

  it('the deal line names the bar only where the station has one; drinks still go to the general store first', () => {
    const lager = inv.makeStack('beer_lager', 3);
    const withBar = {general: 'PANTRY', bar: 'THE BUFFER STOP — bar & beers'}, noBar = {general: 'PANTRY', scrap: 'SCRAP KING'};
    expect(betterStall('gun', lager, 3, withBar)).toEqual({stall: BAR_STALL, name: withBar.bar, price: (sellQuote(BAR_STALL, lager, 3) as {price: number}).price});
    expect(betterStall('gun', lager, 3, noBar)?.stall).toBe('general');
    expect(betterStall('gun', lager, 3)?.stall).toBe('general'); // (no station names: the six)
    expect(betterStall(BAR_STALL, lager, 3, withBar)).toBeNull();
    const water = inv.makeStack('water', 3);
    expect(betterStall('gun', water, 3, withBar)?.stall).toBe('general'); // the bar pays the same for drinks: the first best stays
  });
});

describe('the bartender and the hostility rules', () => {
  it('no prompt / open / trade while the bartender will not trade; trades again when allowed', () => {
    const t = barMarket(100);
    t.host.marketHostility = hostility(s => s !== BAR_STALL);
    t.standAt(BAR_STALL);
    expect(t.prompt()).toBeNull();
    expect(t.sys.openStall(BAR_STALL)).toBe(false);
    t.host.marketHostility = hostility();
    t.standAt(BAR_STALL);
    expect(t.prompt()).toMatch(/Trade — BAR STALL/);
    expect(t.press()).toBe(true);
    const i = t.sys.stock!.stalls.bar.findIndex(s => s.itemId === 'beer_bock');
    t.host.marketHostility = hostility(s => s !== BAR_STALL, true);
    expect(t.sys.buy(i, 1).ok).toBe(false);
    t.frame();
    expect(t.sys.isOpen).toBe(false); // closed at once (the bartender turned)
  });

  it('a displayed bottle taken without paying leaves the stock at once (takeStock); a theft record naming the bar is well-formed', () => {
    const t = barMarket();
    const units = () => t.sys.stock!.stalls.bar.reduce((k, s) => k + s.count, 0);
    const st = t.sys.stock!.stalls.bar[0], before = units(), writes = t.sys.counts.writes;
    const piece = t.sys.takeStock(BAR_STALL, st.uid, 1)!;
    expect([piece.itemId, piece.count]).toEqual([st.itemId, 1]);
    expect(units()).toBe(before - 1);
    expect(t.sys.counts.writes).toBe(writes + 1);
    const rec = t.h.run.laneStore<MarketStockJSON>(MARKET_STOCK_LANE, KEY)!;
    expect(JSON.stringify(rec)).toBe(JSON.stringify(t.sys.stock!.toJSON()));
    const person = {s: 'alive', hp: 100, role: 'fight', gun: 'pistol', mag: 8, spare: 16, posture: 'fight', x: 1, y: 2.95, z: 2, yaw: 0};
    expect(traderId(BAR_STALL)).toBe('trader:bar');
    expect(marketHostilityProblem({v: 1, hostile: true, cause: 'theft', stall: BAR_STALL, people: {[traderId(BAR_STALL)]: person, 'resident:3': {...person, role: 'flee', posture: 'flee'}}})).toBeNull();
    expect(marketHostilityProblem({v: 1, hostile: true, cause: 'theft', stall: 'pub', people: {}})).toBe('bad stall');
  });
});
