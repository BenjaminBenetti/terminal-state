// Task studio-survivor-market-20261108-005807-01 (lane TRADE): THE TRADE VIEW + CONTROLLER on a Node fake DOM (tests/helpers/fakeDom.ts) and
// the save fixture's Game-like harness — the [E] prompt only at a stall's customer spot (its storey, facing the counter), [E] opens that
// stall (the trader's onTalk hook), the panel shows the sign, the Rail Ties balance with the tie glyph, your items with sell tags and the
// stall's stock with prices; pick -> quantity -> Confirm trades, Cancel changes nothing, refusals are red lines with Confirm disabled; the
// view closes on E (consumed) / Tab (passed on) / a hit / walking away / any other state / death / teardown; digits never leak.
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {SlotRef} from '../src/items/inventory';
import {TIE_GLYPH} from '../src/market/trade/ties';
import {TRADE_RT, TRADE_TEXT} from '../src/market/trade/tradeSystem';
import {buyPrice} from '../src/market/trade/stalls';
import {installFakeDom, type FakeDom} from './helpers/fakeDom';
import {tradeHost, tradeState} from './helpers/marketTradeFixture';

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
  if (ties) t.sys.wallet.receive(ties);
  const talks: string[] = [];
  t.sys.onTalk = id => talks.push(id);
  const snap = () => tradeState(t.h.inv, t.sys.stock!, t.sys.wallet.ties);
  return {...t, talks, snap};
}

/** A keydown as the window's capture listener sees it (+ whether it was consumed). */
const key = (code: string) => {
  const e = {code, key: code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'}, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
  return e as unknown as KeyboardEvent & {prevented: boolean; stopped: boolean};
};

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
    expect(pack[0].className).toContain('tr-no'); // water: off the gunsmith's line
    expect(pack[0].title).toMatch(/try GENERAL STALL or SCRAP STALL for the water/); // (the layout's signs)
    expect(pack[2].title).toMatch(/reactor/); // the startup key: never for sale
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
    expect([t.h.inv.get(P(1))!.count, t.sys.wallet.ties > 0, v.noteBad]).toEqual([29, true, false]);
    expect(v.note).toMatch(/^Sold 11 9mm rounds for \d+ ties$/);
    expect(v.selection).toEqual({side: 'sell', ref: P(1)});
    expect(v.qty).toBe(11);
    expect(dom.el('.tr-wallet').innerHTML).toContain(`${t.sys.wallet.ties} ties`);
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
    v.select({side: 'sell', ref: P(0)}); // water at the gunsmith
    expect([v.dealBad, v.deal]).toEqual([true, expect.stringMatching(/This stall deals in guns and ammunition — try GENERAL STALL or SCRAP STALL for the water/)]);
    expect((dom.el('.tr-confirm') as unknown as {disabled: boolean}).disabled).toBe(true);
    expect(v.confirm()?.ok).toBe(false);
    expect([v.noteBad, t.snap() === before]).toEqual([true, true]);
    v.select({side: 'sell', ref: P(2)}); // the startup key
    expect(v.deal).toMatch(/reactor restart part/);
    v.select({side: 'buy', index: 0}); // no ties at all
    expect(v.qty).toBe(1);
    expect(v.deal).toMatch(/you have only 0 ties$/);
    const r = v.confirm();
    expect(r && !r.ok && r.code).toBe('short');
    expect(t.snap()).toBe(before);
    expect(t.sfx.denied).toBe(2);
  });

  it('a buy that fits: the quantity starts at what you can pay for', () => {
    const t = market(0);
    t.standAt('gun');
    t.press();
    const i = t.sys.stock!.stalls.gun.findIndex(s => s.itemId.startsWith('ammo_') && s.count > 3);
    expect(i).toBeGreaterThanOrEqual(0);
    const lot = t.sys.stock!.stalls.gun[i];
    t.sys.wallet.receive(buyPrice(lot, 3));
    t.sys.view.select({side: 'buy', index: i});
    expect(t.sys.view.qty).toBeGreaterThanOrEqual(3);
    expect(buyPrice(lot, t.sys.view.qty)).toBeLessThanOrEqual(t.sys.wallet.ties);
    const r = t.sys.view.confirm();
    expect(r?.ok).toBe(true);
    expect(t.sys.wallet.ties).toBeGreaterThanOrEqual(0);
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
