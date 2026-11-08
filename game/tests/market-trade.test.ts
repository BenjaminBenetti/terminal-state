// Task studio-survivor-market-20261108-005807-01 (lane TRADE): ATOMIC TRADES (market/trade/transactions.ts) on a real Inventory, wallet and
// seeded stock — a whole stack travels as the same object (uid, magazine, filter, air, wear), a partial one gets a fresh uid (detach
// semantics); full inventory / short of ties / every refusal leave the inventory (incl. its uid counter), the stock and the balance
// byte-identical; worn gear sells (a rig with full extra pockets is refused); and over many random buy / sell sequences no uid is ever
// duplicated, no item is created or lost, and the balance is exactly the sum of the trades.
import {describe, expect, it} from 'vitest';
import {ITEMS} from '../src/items/items';
import {GEAR_SLOTS, gearSpec} from '../src/items/gear';
import {Inventory, PACK_SIZE, type SlotRef} from '../src/items/inventory';
import {mulberry32} from '../src/core/rng';
import {MARKET_STALLS, type MarketStallId} from '../src/gen/market/marketTypes';
import {MarketWallet} from '../src/market/trade/wallet';
import {MarketStock, STOCK_MAX} from '../src/market/trade/stock';
import {buyPrice, sellQuote} from '../src/market/trade/stalls';
import {stackUnitCents} from '../src/market/trade/value';
import {itemArmor} from '../src/player/armor';
import {buy, quoteBuy, sell, type TradeCtx} from '../src/market/trade/transactions';
import {census, tradeState, uniqueUids} from './helpers/marketTradeFixture';

const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const G = (slot: string): SlotRef => ({bar: 'gear', index: GEAR_SLOTS.indexOf(slot as never)});
const gearSpecArmor = (id: string): number => gearSpec(id)!.armor!;

function setup(stall: MarketStallId = 'general', ties = 0) {
  const inv = new Inventory(), wallet = new MarketWallet();
  const stock = MarketStock.seed('st-03', 4242, (id, n) => inv.makeStack(id, n));
  wallet.receive(ties);
  const ctx: TradeCtx = {inv, wallet, stock, stall};
  return {inv, wallet, stock, ctx, snap: () => tradeState(inv, stock, wallet.ties)};
}

describe('market trades: what moves', () => {
  it('selling a whole stack: the SAME stack joins the stock (uid + condition kept), the ties are paid, the slot is empty', () => {
    const {inv, wallet, stock, ctx} = setup('gun');
    const pistol = inv.makeStack('pistol', 1, 9);
    inv.set(H(0), pistol);
    const q = sellQuote('gun', pistol, 1);
    const r = sell(ctx, H(0));
    expect(r.ok && q.ok && r.price === q.price).toBe(true);
    expect(inv.get(H(0))).toBeNull();
    expect(stock.stalls.gun.includes(pistol)).toBe(true);
    expect([pistol.mag, wallet.ties]).toEqual([9, q.ok ? q.price : -1]);
    expect(inv.invariants()).toEqual([]);
  });

  it('selling part of a stack: detach semantics (a fresh uid for the sold part, the rest keeps its uid) and it merges onto the stall\'s plain stack', () => {
    const {inv, wallet, stock, ctx} = setup('gun');
    stock.stalls.gun.length = 0;
    const ammo = inv.makeStack('ammo_9mm', 30);
    inv.set(P(0), ammo);
    const r1 = sell(ctx, P(0), 10);
    expect(r1.ok).toBe(true);
    expect([inv.get(P(0)) === ammo, ammo.count, ammo.uid]).toEqual([true, 20, ammo.uid]);
    const sold = stock.stalls.gun[0];
    expect([sold.itemId, sold.count, sold.uid !== ammo.uid]).toEqual(['ammo_9mm', 10, true]);
    expect(sold.uid).toBeLessThan((inv.toJSON().nextUid));
    const r2 = sell(ctx, P(0), 5);
    expect([r2.ok, stock.stalls.gun.length, stock.stalls.gun[0].count]).toEqual([true, 1, 15]); // merged onto the plain stack
    expect(wallet.ties).toBe((r1.ok ? r1.price : 0) + (r2.ok ? r2.price : 0));
  });

  it('buying: a whole lot is the SAME stack (uid / magazine / air kept); a partial lot gets a fresh uid and the rest stays on the stall', () => {
    const {inv, wallet, stock, ctx} = setup('gear', 1000);
    const tank = stock.stalls.gear.find(s => s.itemId === 'airtank_backpack') ?? (() => { const t = inv.makeStack('airtank_backpack', 1); t.air = 321; stock.stalls.gear.push(t); return t; })();
    tank.air = 321;
    const i = stock.stalls.gear.indexOf(tank), price = buyPrice(tank, 1);
    const r = buy(ctx, i);
    expect(r.ok).toBe(true);
    expect(stock.stalls.gear.includes(tank)).toBe(false);
    expect(inv.allStacks().includes(tank)).toBe(true); // worn (the back slot was free) — like a pickup
    expect([tank.air, wallet.ties]).toEqual([321, 1000 - price]);
    // partial: 3 of a 9mm lot
    const g = setup('gun', 1000), lot = g.inv.makeStack('ammo_9mm', 20);
    g.stock.stalls.gun.push(lot);
    const r2 = buy(g.ctx, g.stock.stalls.gun.length - 1, 3);
    expect(r2.ok).toBe(true);
    expect([lot.count, g.stock.stalls.gun.includes(lot), g.inv.count('ammo_9mm')]).toEqual([17, true, 3]);
    expect(g.inv.allStacks().find(s => s.itemId === 'ammo_9mm')!.uid).not.toBe(lot.uid);
    expect(r2.ok && r2.price).toBe(buyPrice(lot, 3));
  });

  it('armor wear travels with the stack both ways and lowers the price; it is never reset or repaired', () => {
    const {inv, stock, ctx, wallet} = setup('gear', 1000);
    const vest = inv.makeStack('armor_vest', 1);
    const full = gearSpecArmor('armor_vest');
    vest.armor = full / 2;
    inv.set(P(0), vest);
    const fresh = inv.makeStack('armor_vest', 1);
    expect(buyPrice(vest, 1)).toBeLessThan(buyPrice(fresh, 1));
    expect(sell(ctx, P(0)).ok).toBe(true);
    const i = stock.stalls.gear.indexOf(vest);
    expect([i >= 0, vest.armor]).toEqual([true, full / 2]);
    const price = buyPrice(vest, 1), before = wallet.ties;
    expect(buy(ctx, i).ok).toBe(true);
    expect([inv.allStacks().includes(vest), vest.armor, before - wallet.ties]).toEqual([true, full / 2, price]);
    // depleted armor (0) is still an armor vest: priced at its non-armor share, kept at 0 through a sale
    vest.armor = 0;
    const ref = inv.find(vest.uid)!;
    expect(stackUnitCents(vest)).toBeLessThan(stackUnitCents(fresh));
    expect(stackUnitCents(vest)).toBeGreaterThan(0);
    expect(sell(ctx, ref).ok).toBe(true);
    expect(vest.armor).toBe(0);
    expect(itemArmor(vest)).toBe(0);
  });

  it('worn gear sells (the helmet off your head); a chest rig whose extra pockets hold items is refused with nothing changed', () => {
    const {inv, ctx, snap} = setup('gear');
    const hat = inv.makeStack('helmet', 1), rig = inv.makeStack('chest_rig', 1);
    inv.set(G('helmet'), hat);
    inv.set(G('chest'), rig);
    inv.set(P(PACK_SIZE + 1), inv.makeStack('water', 1));
    expect(sell(ctx, G('helmet')).ok).toBe(true);
    expect(inv.worn('helmet')).toBeNull();
    const before = snap();
    const r = sell(ctx, G('chest'));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('held'); expect(r.text).toMatch(/extra pockets/); }
    expect(snap()).toBe(before);
    expect(inv.invariants()).toEqual([]);
  });
});

describe('market trades: all or nothing', () => {
  it('short of ties: refused, the inventory (with its uid counter), the stock and the balance byte-identical', () => {
    const {stock, ctx, snap} = setup('gun', 5);
    const i = stock.stalls.gun.findIndex(s => buyPrice(s, s.count) > 5);
    expect(i).toBeGreaterThanOrEqual(0);
    const before = snap();
    const r = buy(ctx, i);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('short'); expect(r.text).toMatch(/You need \d+ ties — you have 5 ties/); }
    expect(snap()).toBe(before);
  });

  it('inventory full: refused (proven on a copy first), nothing changes — not even the uid counter', () => {
    const {inv, stock, ctx, snap} = setup('general', 5000);
    for (let i = 0; i < 5; i++) inv.set(H(i), inv.makeStack('rifle', 1));
    for (let i = 0; i < inv.pack.length; i++) inv.set(P(i), inv.makeStack('shotgun', 1));
    const i = stock.stalls.general.findIndex(s => ITEMS[s.itemId].kind === 'consumable' && s.count > 1);
    expect(i).toBeGreaterThanOrEqual(0);
    const q = quoteBuy(ctx, i, 1);
    expect(q.ok && !q.room).toBe(true);
    const before = snap();
    for (const n of [1, 2, undefined]) {
      const r = buy(ctx, i, n);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.code).toBe('no-room'); expect(r.text).toMatch(/No room/); }
      expect(snap()).toBe(before);
    }
    // a flare still fits: the grenade slot is free
    stock.stalls.general.push(inv.makeStack('flare', 2));
    expect(buy(ctx, stock.stalls.general.length - 1).ok).toBe(true);
  });

  it('every refusal (a part, off the stall\'s line, a bag with contents, worth under a tie, an empty slot, a bad lot) changes nothing', () => {
    const {inv, ctx, snap} = setup('gun', 100);
    inv.set(P(0), inv.makeStack('reactor_key', 1));
    inv.set(P(1), inv.makeStack('water', 2));
    inv.set(P(2), inv.makeStack('ammo_9mm', 1));
    const bag = inv.makeStack('backpack', 1);
    bag.bag![0] = inv.makeStack('bandage', 2);
    inv.wearBag(bag);
    const before = snap();
    const cases: [SlotRef, string, MarketStallId][] = [[P(0), 'part', 'gun'], [P(1), 'off-line', 'gun'], [G('backpack'), 'bag-contents', 'gear'], [P(2), 'too-little', 'gun'], [P(9), 'gone', 'gun'], [{bar: 'bag' as never, index: 0}, 'gone', 'gun']];
    for (const [ref, code, stall] of cases) {
      const r = sell({...ctx, stall}, ref);
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
      expect(snap()).toBe(before);
    }
    for (const i of [-1, 999]) { const r = buy(ctx, i); expect(r.ok).toBe(false); expect(snap()).toBe(before); }
    expect(bag.bag![0]!.count).toBe(2); // the bag's contents untouched
  });

  it('a stall whose shelves are full still merges a plain stack, but refuses a new lot (nothing changes)', () => {
    const {inv, stock, ctx, snap} = setup('scrap');
    const list = stock.stalls.scrap;
    list.length = 0;
    list.push(inv.makeStack('scrap_metal', 10));
    while (list.length < STOCK_MAX) list.push(inv.makeStack('pistol', 1));
    inv.set(P(0), inv.makeStack('scrap_metal', 5));
    inv.set(P(1), inv.makeStack('knife', 1));
    expect(sell(ctx, P(0)).ok).toBe(true);
    expect(list[0].count).toBe(15);
    const before = snap();
    const r = sell(ctx, P(1));
    expect(!r.ok && r.code).toBe('shelf-full');
    expect(snap()).toBe(before);
  });
});

describe('market trades: conservation over many random sequences', () => {
  it('no duplicated uid, no item created or lost, the balance = the trades, inventory invariants hold, sell < buy keeps the balance honest', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = mulberry32(seed);
      const inv = new Inventory(), wallet = new MarketWallet();
      const stock = MarketStock.seed(`st-${seed}`, seed * 31337, (id, n) => inv.makeStack(id, n));
      // a starting kit
      inv.set(H(0), inv.makeStack('rifle', 1, 12));
      inv.set(P(0), inv.makeStack('ammo_556', 60));
      inv.set(P(1), inv.makeStack('water', 3));
      inv.set(P(2), inv.makeStack('scrap_metal', 14));
      inv.set(P(3), inv.makeStack('medkit', 2));
      const mask = inv.makeStack('gas_mask', 1);
      mask.filter = 20;
      inv.set(G('mask'), mask);
      wallet.receive(400); // (a balance earned earlier, so buys happen from the start)
      const c0 = census(inv, stock);
      let ledger = 400, trades = 0;
      for (let step = 0; step < 300; step++) {
        const stall = MARKET_STALLS[Math.floor(r() * MARKET_STALLS.length)];
        const ctx: TradeCtx = {inv, wallet, stock, stall};
        if (r() < 0.5) {
          const refs: SlotRef[] = [...inv.hotbar.map((_, i) => H(i)), ...inv.pack.map((_, i) => P(i)), ...GEAR_SLOTS.map(s => G(s)), {bar: 'throw', index: 0}, {bar: 'melee', index: 0}];
          const ref = refs[Math.floor(r() * refs.length)], st = inv.get(ref);
          const res = sell(ctx, ref, st ? 1 + Math.floor(r() * st.count) : 1);
          if (res.ok) { ledger += res.price; trades++; }
        } else {
          const list = stock.stalls[stall];
          if (!list.length) continue;
          const i = Math.floor(r() * list.length);
          const res = buy(ctx, i, 1 + Math.floor(r() * list[i].count));
          if (res.ok) { ledger -= res.price; trades++; }
        }
        const c = census(inv, stock);
        expect(uniqueUids(c.uids), `seed ${seed} step ${step}`).toBe(true);
        expect(c.counts).toEqual(c0.counts);
        expect(wallet.ties).toBe(ledger);
        expect(wallet.ties).toBeGreaterThanOrEqual(0);
        expect(inv.invariants()).toEqual([]);
        expect(Math.max(0, ...stock.all().map(s => s.uid))).toBeLessThan(inv.toJSON().nextUid);
      }
      expect(trades).toBeGreaterThan(40);
    }
  });

  it('a round trip (buy, then sell it straight back) always loses ties: no money pump at any stall', () => {
    const {stock, ctx, wallet} = setup('general', 10_000);
    let pumps = 0;
    for (const stall of MARKET_STALLS) {
      const c: TradeCtx = {...ctx, stall};
      for (let k = stock.stalls[stall].length; k > 0; k--) { // each original lot once (a sold-back lot goes to the end / merges)
        const before = wallet.ties;
        const b = buy(c, 0);
        expect(b.ok).toBe(true);
        if (!b.ok) break;
        const ref = ctx.inv.find(b.uid) ?? ctx.inv.allStacks().map(s => ctx.inv.find(s.uid)).find(x => x && ctx.inv.get(x)?.itemId === b.itemId)!;
        const s = sell(c, ref!, b.count);
        expect(wallet.ties).toBeLessThan(before); // sold back or not (a lot worth under a tie stays with the player), ties were lost
        if (s.ok) pumps++;
      }
    }
    expect(pumps).toBeGreaterThan(20);
  });
});
