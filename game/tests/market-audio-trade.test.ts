// Task studio-market-bar-20261108-225231-01 (lane AUDIO; user: "Subtle cash-register sound on buy/sell."): the trade's SUCCESS COMMIT
// (market/trade/tradeSystem.ts TradeSystem.done) plays exactly ONE register cue per successful transaction — a Confirm sell / buy and a
// Ctrl+click sell / buy alike — and none on a preview / quote, a refusal (short of ties, a part it will not buy, a hostile / unmanned stall),
// a Cancel, a closed view or a theft (market/wares takeStock). Node fake DOM + the trade fixture's Game-like host.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {SlotRef} from '../src/items/inventory';
import {buyPrice} from '../src/market/trade/stalls';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';
import {giveTies, hostility, tradeHost} from './helpers/marketTradeFixture';

const P = (i: number): SlotRef => ({bar: 'pack', index: i});

let dom: FakeDom;
beforeAll(() => { dom = installFakeDom(); });
afterAll(() => dom.uninstall());

function market(ties = 0) {
  const t = tradeHost();
  t.h.inv.set(P(0), t.h.inv.makeStack('water', 3));
  t.h.inv.set(P(1), t.h.inv.makeStack('ammo_9mm', 40));
  t.h.inv.set(P(2), t.h.inv.makeStack('reactor_key', 1));
  t.build();
  if (ties) giveTies(t.h.inv, ties);
  const cash: number[] = [];
  (t.host as unknown as {marketAudio: {cash(): void}}).marketAudio = {cash: () => { cash.push(t.sys.counts.trades); }};
  return {...t, cash};
}

describe('market audio: the register cue at the trade\'s success commit', () => {
  it('ONE cue per successful Confirm sell / buy and per Ctrl+click sell / buy — after the trade is committed', () => {
    const t = market(2000);
    t.standAt('gun');
    expect(t.press()).toBe(true);
    const v = t.sys.view;
    // previews / quotes: picking, quantities, the deal line — nothing
    v.select({side: 'sell', ref: P(1)});
    v.setQty(10);
    v.all();
    expect(t.cash).toEqual([]);
    // Confirm sell
    v.select({side: 'sell', ref: P(0)});
    expect(v.confirm()?.ok).toBe(true);
    expect(t.cash).toEqual([1]); // played once, after the commit counted the trade
    // Confirm buy
    const i = t.sys.stock!.stalls.gun.findIndex(s => buyPrice(s, 1) > 0);
    v.select({side: 'buy', index: i});
    v.setQty(1);
    expect(v.confirm()?.ok).toBe(true);
    expect(t.cash).toEqual([1, 2]);
    // Ctrl+click sell / buy (one transaction each)
    expect(v.quick({side: 'sell', ref: P(1)})?.ok).toBe(true);
    expect(v.quick({side: 'buy', index: 0})?.ok).toBe(true);
    expect(t.cash).toEqual([1, 2, 3, 4]);
    expect(t.sys.counts.trades).toBe(4);
  });

  it('none on a refusal, a Cancel, a closed view, a hostile / unmanned stall or a theft', () => {
    const t = market(0);
    t.standAt('gun');
    t.press();
    const v = t.sys.view;
    // refusals: the reactor part is not for sale; no ties for a buy
    v.select({side: 'sell', ref: P(2)});
    expect(v.confirm()?.ok).toBe(false);
    v.select({side: 'buy', index: 0});
    expect(v.confirm()?.ok).toBe(false);
    expect(v.quick({side: 'buy', index: 0})?.ok).toBe(false);
    // Cancel
    v.select({side: 'sell', ref: P(0)});
    v.all();
    v.cancel();
    expect(t.cash).toEqual([]);
    expect(t.sfx.denied).toBe(3);
    // a theft: the wares' one other path out of the stock
    const lot = t.sys.stock!.stalls.gun[0];
    expect(t.sys.takeStock('gun', lot.uid)).not.toBeNull();
    // a hostile / unmanned stall refuses (the view open or not)
    t.host.marketHostility = hostility(() => false, true);
    expect(t.sys.sell(P(0)).ok).toBe(false);
    t.frame(); // the view closes
    expect(t.sys.isOpen).toBe(false);
    expect(t.sys.sell(P(0)).ok).toBe(false);
    expect(t.sys.buy(0).ok).toBe(false);
    expect([t.cash, t.sys.counts.trades]).toEqual([[], 0]);
  });

  it('a market without the audio seam trades exactly as before (optional chaining)', () => {
    const t = market(0);
    (t.host as unknown as {marketAudio: unknown}).marketAudio = undefined;
    t.standAt('general');
    t.press();
    t.sys.view.select({side: 'sell', ref: P(0)});
    expect(t.sys.view.confirm()?.ok).toBe(true);
    expect(t.sfx.ok).toBe(1);
  });
});
