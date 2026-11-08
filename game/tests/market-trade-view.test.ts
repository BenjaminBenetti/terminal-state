// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE TRADE VIEW + CONTROLLER on a Node fake DOM (tests/helpers/fakeDom.ts) and
// the save fixture's Game-like harness — the [E] prompt only at a stall's customer spot (its storey, facing the counter), [E] opens that
// stall (the trader's onTalk hook), the panel shows the sign, the Rail Ties balance with the tie glyph, your items with sell tags and the
// stall's stock with prices; pick -> quantity -> Confirm trades, Cancel changes nothing, refusals are red lines with Confirm disabled; the
// view closes on E (consumed) / Tab (passed on) / a hit / walking away / any other state / death / teardown; digits never leak.
// Task studio-market-rework-20261108-074144-01 (lane TRADE): the balance is the Rail Ties CARRIED (+ the ones waiting in a worn backpack);
// every stall buys everything (the deal names a better stall); CTRL+CLICK trades in one click with Confirm's quantity / price semantics (one
// transaction per press, the press consumed, its click ignored; each item's tooltip says what it does); HOSTILITY gating (market/hostility.ts):
// no prompt / no opening at a stall that will not trade, an open view closes the frame it turns, every transaction refused.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {SlotRef} from '../src/items/inventory';
import {TIE_GLYPH} from '../src/market/trade/ties';
import {RAIL_TIES_ID} from '../src/items/railTies';
import {TRADE_RT, TRADE_TEXT} from '../src/market/trade/tradeSystem';
import {buyPrice} from '../src/market/trade/stalls';
import {FUEL, tanksText} from '../src/fuel/fuel';
import {trainCapacityUnits} from '../src/market/trade/stock';
import {installFakeDom, type FakeEl, type FakeDom} from './helpers/fakeDom';
import {carriedTies, giveTies, hostility, tradeHost, tradeState} from './helpers/marketTradeFixture';

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
/** An item cell's game tooltip (ui/tooltip.ts data-tip*: heading, lines, hint — never a native title), as one text. */
const tip = (e: FakeEl): string => { expect(e.title).toBe(''); return [e.dataset.tip, e.dataset.tipBody, e.dataset.tipHint].filter(Boolean).join('\n'); };

let dom: FakeDom;
beforeAll(() => { dom = installFakeDom(); });
afterAll(() => dom.uninstall());

function market(ties = 0) {
  const t = tradeHost();
  t.h.inv.set(P(0), t.h.inv.makeStack('water', 3));
  t.h.inv.set(P(1), t.h.inv.makeStack('ammo_9mm', 40));
  t.h.inv.set(P(2), t.h.inv.makeStack('reactor_key', 1));
  t.build();
  if (ties) giveTies(t.h.inv, ties); // (into the first free pocket, P(3))
  const talks: string[] = [];
  t.sys.onTalk = id => talks.push(id);
  const snap = () => tradeState(t.h.inv, t.sys.stock!);
  return {...t, talks, snap};
}

/** A keydown as the window's capture listener sees it (+ whether it was consumed). */
const key = (code: string) => {
  const e = {code, key: code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'}, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
  return e as unknown as KeyboardEvent & {prevented: boolean; stopped: boolean};
};

/** The newest view's root (its listeners: mousedown / click / contextmenu; every test's controller mounts its own). */
const root = () => dom.el('#app').children.filter(c => c.id === 'tradeview').at(-1)!;
/** A mouse event on an item cell (its target's closest('.slot') is the cell) + whether it was consumed. */
const press = (cell: FakeEl, o: {ctrl?: boolean; meta?: boolean; button?: number} = {}) => {
  const e = {button: o.button ?? 0, ctrlKey: !!o.ctrl, metaKey: !!o.meta, target: {closest: (sel: string) => (sel.includes('.slot') ? cell : null)}, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
  return e as unknown as MouseEvent & {prevented: boolean; stopped: boolean};
};
const fire = (type: string, e: unknown) => { for (const f of root().listeners.get(type) ?? []) f(e); };

describe('market trade: the [E] prompt and opening a stall', () => {
  it('only at a stall\'s customer spot, on its storey, facing its counter; E opens THAT stall and tells its trader', () => {
    const t = market(7);
    t.standAt('medical');
    expect(t.prompt()).toBe('<b>[E]</b> Trade — MEDICAL STALL · 7 ties');
    t.standAt('medical', 0, 0, Math.PI); // facing away
    expect(t.prompt()).toBeNull();
    t.standAt('medical', 0, TRADE_RT.reach + 0.2); // too far back
    expect(t.prompt()).toBeNull();
    t.standAt('medical');
    t.host.player.y = 3; // another storey
    t.frame();
    expect([t.prompt(), t.press()]).toEqual([null, false]);
    t.standAt('medical', 0.6, 0, 0.3); // a little off to the side, turned a little: still at the counter
    expect(t.prompt()).toMatch(/MEDICAL STALL/);
    expect(t.press()).toBe(true);
    expect([t.sys.isOpen, t.sys.open?.id, t.talks, t.host.inputOwners.some(f => f())]).toEqual([true, 'medical', ['medical'], true]);
    expect(t.prompt()).toBeNull(); // the open view owns E
    expect(dom.el('.tr-title').textContent).toBe('MEDICAL STALL');
    expect(dom.el('.tr-wallet').innerHTML).toContain(TIE_GLYPH);
    expect(dom.el('.tr-wallet').innerHTML).toContain('7 ties');
    expect(t.h.inv.get(P(3))?.itemId).toBe(RAIL_TIES_ID); // the ties ARE an item in the pockets
  });

  it('the readout counts the ties carried; ties in a worn backpack are named apart (not spendable there)', () => {
    const t = market(12);
    const bag = t.h.inv.makeStack('backpack', 1);
    bag.bag![2] = t.h.inv.makeStack(RAIL_TIES_ID, 300);
    t.h.inv.wearBag(bag);
    t.standAt('general');
    expect(t.prompt()).toMatch(/· 12 ties$/);
    t.press();
    expect(dom.el('.tr-wallet').innerHTML).toMatch(/12 ties.*\+ 300 ties in your backpack/);
  });

  it('is refused outside play, dead, with a bag view open, and inert on a level without a market', () => {
    const t = market();
    t.standAt('gun');
    t.host.state = 'paused';
    t.frame();
    expect([t.prompt(), t.sys.openStall('gun')]).toEqual([null, false]);
    t.host.state = 'playing';
    t.host.gear.session = {};
    expect(t.sys.openStall('gun')).toBe(false);
    t.host.gear.session = null;
    t.host.player.alive = false;
    expect(t.sys.openStall('gun')).toBe(false);
    t.host.player.alive = true;
    t.teardown();
    for (const s of t.host.sectionHooks) s.build?.({props: []});
    t.standAt('gun');
    expect([t.sys.stock, t.prompt(), t.press(), t.sys.openStall('gun')]).toEqual([null, null, false, false]);
  });
});

describe('market trade view: the panel', () => {
  it('shows your items with sell tags (— where the stall will not buy) and the stall\'s stock with prices', () => {
    const t = market();
    t.standAt('gun');
    t.press();
    const stock = t.sys.stock!.stalls.gun;
    const cells = dom.el('[data-side="stock"]').children;
    expect(cells.length).toBe(stock.length);
    cells.forEach((c, i) => {
      expect([c.dataset.side, c.dataset.index]).toEqual(['stock', String(i)]);
      expect(c.innerHTML).toContain(`<span class="tr-price">${buyPrice(stock[i], stock[i].count)}</span>`);
    });
    expect(dom.el('[data-side="carry"]').children.length).toBe(7); // quick slots + grenade + melee
    expect(dom.el('[data-side="worn"]').children.length).toBe(6);
    const pack = dom.el('[data-side="pack"]').children;
    expect(pack.length).toBe(t.h.inv.pack.length);
    expect(pack[1].innerHTML).toMatch(/<span class="tr-price">sell \d+<\/span>/); // 9mm at the gunsmith
    expect(pack[0].innerHTML).toMatch(/<span class="tr-price">sell \d+<\/span>/); // water: off the gunsmith's line, but it buys it (lower multiple)
    expect(pack[0].className).not.toContain('tr-no');
    expect(tip(pack[0])).toMatch(/Ctrl\+click: sell 3 × Water for \d+ ties$/);
    expect(pack[2].className).toContain('tr-no');
    expect(tip(pack[2])).toMatch(/reactor/); // the startup key: never for sale
    expect(tip(pack[2])).not.toMatch(/Ctrl\+click/);
    expect([pack[2].dataset.tipTone, pack[0].dataset.tipTone, pack[0].dataset.tipHint]).toEqual(['warn', undefined, expect.stringMatching(/^Ctrl\+click: sell 3 × Water/)]); // a refusal is amber; the hint says what Ctrl+click does
    // the deal line names a stall that pays more (the layout's signs)
    t.sys.view.select({side: 'sell', ref: P(0)});
    expect(t.sys.view.deal).toMatch(/^Sell 3 × Water for \d+ ties · GENERAL STALL pays \d+$/);
  });

  it('pick -> quantity -> Confirm sells exactly that many; the partial stack stays selected', () => {
    const t = market();
    t.standAt('gun');
    t.press();
    const v = t.sys.view;
    v.select({side: 'sell', ref: P(1)});
    expect(v.qty).toBe(40);
    v.setQty(10);
    v.step(-1);
    v.step(+2);
    expect(v.qty).toBe(11);
    expect([v.deal, v.dealBad]).toEqual([expect.stringMatching(/^Sell 11 9mm rounds for \d+ ties$/), false]);
    const r = v.confirm();
    expect(r?.ok).toBe(true);
    expect([t.h.inv.get(P(1))!.count, carriedTies(t.h.inv) > 0, v.noteBad]).toEqual([29, true, false]);
    expect(v.note).toMatch(/^Sold 11 9mm rounds for \d+ ties$/);
    expect(v.selection).toEqual({side: 'sell', ref: P(1)});
    expect(v.qty).toBe(11);
    expect(dom.el('.tr-wallet').innerHTML).toContain(`${carriedTies(t.h.inv)} ties`);
    expect(t.sfx.ok).toBe(1);
    expect(t.host.syncs).toBe(1);
  });

  it('Cancel changes nothing (the inventory, its uid counter, the stock, the balance)', () => {
    const t = market(500);
    t.standAt('general');
    t.press();
    const before = t.snap(), v = t.sys.view;
    v.select({side: 'buy', index: 0});
    v.setQty(1);
    v.cancel();
    v.select({side: 'sell', ref: P(0)});
    v.all();
    v.cancel();
    expect(t.snap()).toBe(before);
    expect([v.selection, v.note, v.noteBad]).toEqual([null, 'Cancelled — nothing changed.', false]);
  });

  it('refusals are red deal lines with Confirm disabled, and confirming anyway changes nothing', () => {
    const t = market(0);
    t.standAt('gun');
    t.press();
    const v = t.sys.view, before = t.snap();
    v.select({side: 'sell', ref: P(2)}); // the startup key
    expect([v.dealBad, v.deal]).toEqual([true, expect.stringMatching(/reactor restart part/)]);
    expect((dom.el('.tr-confirm') as unknown as {disabled: boolean}).disabled).toBe(true);
    expect(v.confirm()?.ok).toBe(false);
    expect([v.noteBad, t.snap() === before]).toEqual([true, true]);
    v.select({side: 'buy', index: 0}); // no ties at all
    expect(v.qty).toBe(1);
    expect(v.deal).toMatch(/you have only 0 ties$/);
    const r = v.confirm();
    expect(r && !r.ok && r.code).toBe('short');
    expect(t.snap()).toBe(before);
    expect(t.sfx.denied).toBe(2);
  });

  it('the fuel stall speaks the common fuel units: a can is a quarter tank, the train\'s capacity from FUEL', () => {
    const t = market(500);
    t.standAt('fuel');
    t.press();
    expect(dom.el('.tr-stock-h').textContent).toMatch(new RegExp(`one can = ¼ tank · your train holds ${tanksText(trainCapacityUnits())}$`)); // (the two-tank train: 2 tanks)
    const i = t.sys.stock!.stalls.fuel.findIndex(s => s.itemId === FUEL.canItem && s.count === 2);
    expect(i).toBeGreaterThanOrEqual(0);
    t.sys.view.select({side: 'buy', index: i});
    expect(t.sys.view.deal).toMatch(/^Buy 2 × Fuel \(½ tank of fuel\) for 20 ties$/);
    t.sys.view.setQty(1);
    expect(t.sys.view.deal).toMatch(/^Buy Fuel \(¼ tank of fuel\) for 10 ties$/);
    expect(t.sys.view.confirm()?.ok).toBe(true);
    expect(t.h.inv.count(FUEL.canItem)).toBe(1); // an ordinary can in the pockets: pour it at the fuel cap or stow it, as always
  });

  it('a buy that fits: the quantity starts at what you can pay for', () => {
    const t = market(0);
    t.standAt('gun');
    t.press();
    const i = t.sys.stock!.stalls.gun.findIndex(s => s.itemId.startsWith('ammo_') && s.count > 3);
    expect(i).toBeGreaterThanOrEqual(0);
    const lot = t.sys.stock!.stalls.gun[i];
    giveTies(t.h.inv, buyPrice(lot, 3));
    t.sys.view.select({side: 'buy', index: i});
    expect(t.sys.view.qty).toBeGreaterThanOrEqual(3);
    expect(buyPrice(lot, t.sys.view.qty)).toBeLessThanOrEqual(carriedTies(t.h.inv));
    const r = t.sys.view.confirm();
    expect(r?.ok).toBe(true);
    expect(carriedTies(t.h.inv)).toBeGreaterThanOrEqual(0);
  });
});

describe('market trade view: Ctrl+click (user: "ctrl+click should sell or buy items in one click")', () => {
  it('Ctrl+press on an item sells it in ONE transaction (its default: the whole stack); the press is consumed and its click ignored', () => {
    const t = market();
    t.standAt('gun');
    t.press();
    const cell = dom.el('[data-side="pack"]').children[1]; // 40 x 9mm
    expect(tip(cell)).toMatch(/Ctrl\+click: sell 40 9mm rounds for (\d+) ties$/);
    const price = Number(/for (\d+) ties$/.exec(tip(cell))![1]);
    const trades = t.sys.counts.trades;
    const e = press(cell, {ctrl: true});
    fire('mousedown', e);
    expect([e.prevented, e.stopped, t.sys.counts.trades - trades]).toEqual([true, true, 1]);
    expect([t.h.inv.get(P(1))?.itemId, carriedTies(t.h.inv), t.sys.view.selection, t.sys.view.note]).toEqual([RAIL_TIES_ID, price, null, `Sold 40 9mm rounds for ${price} ties`]); // (the freed pocket took the ties)
    const c = press(cell, {ctrl: true}); // the same gesture's click: ignored (no selection, no second trade)
    fire('click', c);
    expect([c.stopped, t.sys.counts.trades - trades, t.sys.view.selection]).toEqual([true, 1, null]);
    expect(t.sfx.ok).toBe(1);
  });

  it('uses the SELECTED quantity on the selected item, the default elsewhere; Cmd works too; a plain press / right button does nothing', () => {
    const t = market();
    t.standAt('gun');
    t.press();
    const v = t.sys.view;
    v.select({side: 'sell', ref: P(1)});
    v.setQty(7);
    const cell = dom.el('[data-side="pack"]').children[1];
    expect(tip(cell)).toMatch(/Ctrl\+click: sell 7 9mm rounds for \d+ ties$/);
    for (const o of [{}, {ctrl: true, button: 2}]) { const e = press(cell, o); fire('mousedown', e); expect(e.stopped).toBe(false); }
    expect(t.sys.counts.trades).toBe(0);
    fire('mousedown', press(cell, {meta: true}));
    expect([t.sys.counts.trades, t.h.inv.get(P(1))!.count, v.selection, v.qty]).toEqual([1, 33, {side: 'sell', ref: P(1)}, 7]); // the partial stack stays selected
    // a buy: as many as the carried ties pay for (at least one), the lot's own price
    giveTies(t.h.inv, 500);
    const stock = t.sys.stock!.stalls.gun;
    const i = stock.findIndex(s => s.itemId.startsWith('ammo_'));
    v.render();
    const lot = stock[i], n = lot.count, cost = buyPrice(lot, n), have = carriedTies(t.h.inv);
    expect(cost).toBeLessThanOrEqual(have);
    const sc = dom.el('[data-side="stock"]').children[i];
    expect(tip(sc).endsWith(`for ${cost} ties`)).toBe(true);
    expect(tip(sc)).toMatch(/Ctrl\+click: buy /);
    fire('mousedown', press(sc, {ctrl: true}));
    expect([t.sys.counts.trades, carriedTies(t.h.inv), stock.includes(lot)]).toEqual([2, have - cost, false]);
  });

  it('a refused Ctrl+click changes nothing (a part, short of ties) and still trades at most once', () => {
    const t = market(0);
    t.standAt('gun');
    t.press();
    const before = t.snap();
    fire('mousedown', press(dom.el('[data-side="pack"]').children[2], {ctrl: true})); // the startup key
    fire('mousedown', press(dom.el('[data-side="stock"]').children[0], {ctrl: true})); // no ties at all
    expect([t.snap() === before, t.sys.counts.trades, t.sfx.denied, t.sys.view.noteBad]).toEqual([true, 0, 2, true]);
    expect(t.sys.view.note).toMatch(/You need \d+ ties — you have 0 ties/);
  });
});

describe('market trade: hostility gating (market/hostility.ts)', () => {
  it('a stall that will not trade shows no prompt and never opens (E stays the world\'s)', () => {
    const t = market(50);
    t.host.marketHostility = hostility(id => id !== 'gun');
    t.standAt('gun');
    expect([t.prompt(), t.press(), t.sys.openStall('gun')]).toEqual([null, false, false]);
    t.standAt('medical');
    expect(t.prompt()).toMatch(/MEDICAL STALL/);
    expect(t.press()).toBe(true);
  });

  it('an open view closes the frame its trader turns hostile / dies / flees, with a line saying why; trades are refused', () => {
    const t = market(50);
    let ok = true;
    t.host.marketHostility = hostility(() => ok);
    t.standAt('general');
    t.press();
    ok = false;
    const before = t.snap();
    const r = t.sys.sell(P(0));
    expect([r.ok, !r.ok && r.code, t.snap() === before]).toEqual([false, 'closed', true]); // (before the frame notices: still refused)
    t.frame();
    expect([t.sys.isOpen, t.sys.lastClose, t.toasts.at(-1)]).toEqual([false, 'hostile', TRADE_TEXT.unmanned]);
    ok = true;
    t.standAt('general');
    t.press();
    t.host.marketHostility = hostility(() => false, true);
    t.frame();
    expect([t.sys.isOpen, t.toasts.at(-1)]).toEqual([false, TRADE_TEXT.hostile]);
    // no hostility system at all: trading works as before
    t.host.marketHostility = null;
    t.standAt('general');
    expect(t.press()).toBe(true);
  });
});

describe('market trade view: closing', () => {
  it('E closes (consumed: never the game\'s E); Tab / Esc close and go on; digits are swallowed while open', () => {
    const t = market();
    t.standAt('fuel');
    t.press();
    const d = key('Digit3');
    t.sys.onKeyCapture(d);
    expect([d.prevented, d.stopped, t.sys.isOpen]).toEqual([true, true, true]);
    const e = key('KeyE');
    t.sys.onKeyCapture(e);
    expect([e.stopped, t.sys.isOpen, t.sys.lastClose]).toEqual([true, false, 'user']);
    const closed = key('KeyE');
    t.sys.onKeyCapture(closed); // closed: E is the game's again (opens it through interactHandlers)
    expect(closed.stopped).toBe(false);
    t.frame();
    expect(t.press()).toBe(true);
    const tab = key('Tab');
    t.sys.onKeyCapture(tab);
    expect([tab.stopped, t.sys.isOpen, t.sys.lastClose]).toEqual([false, false, 'state']);
  });

  it('a hit, walking away, another state, death and the teardown all close it (with a toast where the player should know why)', () => {
    const t = market();
    const reopen = () => { t.standAt('scrap'); expect(t.press()).toBe(true); };
    reopen();
    for (const f of t.host.hitListeners) f({amount: 0});
    expect(t.sys.isOpen).toBe(true);
    for (const f of t.host.hitListeners) f({amount: 5});
    expect([t.sys.isOpen, t.toasts.at(-1)]).toEqual([false, TRADE_TEXT.hit]);
    reopen();
    t.host.player.z += TRADE_RT.closeRange + 0.1;
    t.frame();
    expect([t.sys.isOpen, t.sys.lastClose, t.toasts.at(-1)]).toEqual([false, 'distance', TRADE_TEXT.far]);
    reopen();
    for (const f of t.host.stateListeners) f('paused', 'playing');
    expect([t.sys.isOpen, t.sys.lastClose]).toEqual([false, 'state']);
    reopen();
    t.host.player.alive = false;
    t.frame();
    expect([t.sys.isOpen, t.sys.lastClose]).toEqual([false, 'state']);
    t.host.player.alive = true;
    reopen();
    t.teardown();
    expect([t.sys.isOpen, t.sys.lastClose, t.sys.view.visible]).toEqual([false, 'travel', false]);
  });
});
