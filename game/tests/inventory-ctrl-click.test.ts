// Task studio-cosplay-general-20261108-225231-01 (lane GENERAL; user: "Ctrl-click in inventory should do the same equip/unequip as
// double-click."): on the inventory screen a Ctrl (or Cmd) + left click on a slot runs that slot's DOUBLE-CLICK action (the same
// InventoryUI.activate path: use a consumable, wear / take off gear, a flare into the grenade slot, a knife into the melee slot) — once
// per physical click: never a drag, its click / macOS context menu ignored, never half of a later double-click; a slot without a
// double-click action is a plain click. The Market trade view keeps its own Ctrl+click (buy / sell). Node fake DOM (tests/helpers/fakeDom).
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom, type FakeDom, type FakeEl} from './helpers/fakeDom';
import {Inventory, MELEE_REF, THROW_REF, isMeleeItem, type SlotRef} from '../src/items/inventory';
import {GEAR_SLOTS} from '../src/items/gear';
import {InventoryUI, isQuickClick} from '../src/ui/inventoryUI';
import {carriedTies, tradeHost} from './helpers/marketTradeFixture';

installCanvasShim(false);

const P = (i: number): SlotRef => ({bar: 'pack', index: i});
const H = (i: number): SlotRef => ({bar: 'hotbar', index: i});
const GEAR = (slot: (typeof GEAR_SLOTS)[number]): SlotRef => ({bar: 'gear', index: GEAR_SLOTS.indexOf(slot)});

// A window that records its listeners (InventoryUI's pointermove / pointerup / pointercancel / blur).
const winListeners = new Map<string, ((e: unknown) => void)[]>();
const g = globalThis as unknown as {window?: unknown};
const prevWindow = g.window;
beforeAll(() => {
  g.window = {addEventListener: (t: string, f: (e: unknown) => void) => { const l = winListeners.get(t) ?? []; l.push(f); winListeners.set(t, l); }, removeEventListener() {}, innerHeight: 720, innerWidth: 1280};
});
afterAll(() => { g.window = prevWindow; });

type Ev = {button: number; buttons: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; pointerId: number; clientX: number; clientY: number;
  target: unknown; prevented: boolean; stopped: boolean; preventDefault(): void; stopPropagation(): void};

/** A fresh fake DOM (its own registry: listeners never pile up across screens) + an inventory screen over `setup`'s inventory. */
function screen(setup: (inv: Inventory) => void) {
  winListeners.clear();
  const dom: FakeDom = installFakeDom();
  const inv = new Inventory();
  setup(inv);
  const log: string[] = [];
  const at = (r: SlotRef) => `${r.bar}:${r.index}`;
  const ui = new InventoryUI(() => inv, {
    use: r => { log.push(`use ${at(r)}`); inv.detach(r, 1); }, // (Game.startUse: one item used)
    drop: (r, n) => { log.push(`drop ${at(r)}`); inv.detach(r, n); },
    equip: r => { log.push(`equip ${at(r)}`); if (isMeleeItem(inv.get(r)?.itemId)) inv.equipMeleeFrom(r); }, // (Game.equipRef's melee path)
    close: () => log.push('close'),
    changed: () => log.push('changed'),
  });
  ui.render();
  const container = (r: SlotRef) => dom.el(r.bar === 'pack' ? '#inv-pack' : r.bar === 'gear' ? '#inv-gear' : '#inv-hotbar');
  const cellOf = (r: SlotRef): FakeEl | undefined => container(r).children.find(c => c.dataset.bar === r.bar && Number(c.dataset.index) === r.index);
  const ev = (r: SlotRef, o: {ctrl?: boolean; meta?: boolean; button?: number; x?: number} = {}): Ev => ({
    button: o.button ?? 0, buttons: (o.button ?? 0) === 0 ? 1 : 2, ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: false, pointerId: 1, clientX: o.x ?? 10, clientY: 10,
    target: {closest: (sel: string) => (sel === '.slot' ? cellOf(r) ?? null : null)}, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
  });
  const fire = (r: SlotRef, type: string, e: Ev) => { for (const f of container(r).listeners.get(type) ?? []) f(e); return e; };
  const fireWin = (type: string, e: Ev) => { for (const f of winListeners.get(type) ?? []) f(e); return e; };
  /** One physical left click: press, release, click (Ctrl / Cmd held when asked). */
  const click = (r: SlotRef, o: {ctrl?: boolean; meta?: boolean} = {}) => {
    const down = fire(r, 'pointerdown', ev(r, o));
    fireWin('pointerup', ev(r, o));
    const c = fire(r, 'click', ev(r, o));
    return {down, click: c};
  };
  /** Every slot's item (id x count), for comparing two screens' item state. */
  const state = () => {
    const out: Record<string, string> = {};
    for (const r of [...inv.hotbar.map((_, i) => H(i)), THROW_REF, MELEE_REF, ...inv.pack.map((_, i) => P(i)), ...GEAR_SLOTS.map(GEAR)]) {
      const st = inv.get(r);
      if (st) out[at(r)] = `${st.itemId}x${st.count}`;
    }
    return out;
  };
  return {dom, inv, ui, log, fire, fireWin, ev, click, state, done: () => dom.uninstall()};
}

/** A screen after ONE Ctrl+click on `ref`, and one after a plain DOUBLE-click on `ref` (two clicks well inside 380 ms). */
function both(setup: (inv: Inventory) => void, ref: SlotRef) {
  const a = screen(setup);
  const ctrl = a.click(ref, {ctrl: true});
  const ra = {state: a.state(), log: [...a.log], selected: a.ui.selected, ctrl};
  a.done();
  const b = screen(setup);
  b.click(ref);
  b.click(ref);
  const rb = {state: b.state(), log: [...b.log]};
  b.done();
  return {ctrl: ra, dbl: rb};
}

const actions = (log: string[]) => log.filter(l => /^(use|equip|drop) /.test(l));

describe('inventory Ctrl+click = the double-click action', () => {
  it('isQuickClick: Ctrl or Cmd with the LEFT button only', () => {
    expect([isQuickClick({button: 0, ctrlKey: true}), isQuickClick({button: 0, metaKey: true}), isQuickClick({button: 0}), isQuickClick({button: 2, ctrlKey: true})]).toEqual([true, true, false, false]);
  });

  it('gear: Ctrl+click wears it and takes it off again — the same item state as a double-click, one action per click', () => {
    const wear = both(inv => { inv.set(P(0), inv.makeStack('helmet', 1)); }, P(0));
    expect(wear.ctrl.state).toEqual(wear.dbl.state);
    expect(wear.ctrl.state).toEqual({'gear:0': 'helmetx1'});
    expect(actions(wear.ctrl.log)).toEqual([]); // wearing is the inventory's own move (no use / equip / drop action)
    expect(wear.ctrl.log.filter(l => l === 'changed')).toEqual(wear.dbl.log.filter(l => l === 'changed'));
    const off = both(inv => { inv.set(P(0), inv.makeStack('armor_vest', 1)); inv.wearFrom(P(0)); }, GEAR('chest'));
    expect(off.ctrl.state).toEqual(off.dbl.state);
    expect(Object.values(off.ctrl.state)).toEqual(['armor_vestx1']);
    expect(off.ctrl.state['gear:1']).toBeUndefined(); // off the chest slot, back into the pockets
  });

  it('weapon: a knife goes into the melee slot (equip once); a gun has no double-click action — Ctrl+click only selects it', () => {
    const knife = both(inv => { inv.set(P(2), inv.makeStack('knife', 1)); }, P(2));
    expect(knife.ctrl.state).toEqual(knife.dbl.state);
    expect(knife.ctrl.state).toEqual({'melee:0': 'knifex1'});
    expect(actions(knife.ctrl.log)).toEqual(['equip pack:2']);
    expect(actions(knife.dbl.log)).toEqual(['equip pack:2']);
    const gun = both(inv => { inv.set(P(1), inv.makeStack('pistol', 1, 12)); }, P(1));
    expect(gun.ctrl.state).toEqual(gun.dbl.state);
    expect([actions(gun.ctrl.log), actions(gun.dbl.log)]).toEqual([[], []]); // no equip / fire from a click on a gun
    expect(gun.ctrl.selected).toEqual(P(1)); // (a plain click: its details + Equip button)
  });

  it('consumable (pockets and the held quick slot): used ONCE, as a double-click uses it', () => {
    for (const ref of [P(3), H(2)]) {
      const r = both(inv => { inv.set(ref, inv.makeStack('water', 3)); }, ref);
      expect(r.ctrl.state).toEqual(r.dbl.state);
      expect(r.ctrl.state).toEqual({[`${ref.bar}:${ref.index}`]: 'waterx2'});
      expect(actions(r.ctrl.log)).toEqual([`use ${ref.bar}:${ref.index}`]);
      expect(actions(r.dbl.log)).toEqual([`use ${ref.bar}:${ref.index}`]);
    }
  });

  it('throwable: a flare goes into the grenade slot (moved, never thrown); in the grenade slot Ctrl+click only selects it', () => {
    const r = both(inv => { inv.set(P(4), inv.makeStack('flare', 2)); }, P(4));
    expect(r.ctrl.state).toEqual(r.dbl.state);
    expect(r.ctrl.state).toEqual({'throw:0': 'flarex2'});
    expect(actions(r.ctrl.log)).toEqual([]);
    const s = both(inv => { inv.set(THROW_REF, inv.makeStack('flare', 2)); }, THROW_REF);
    expect(s.ctrl.state).toEqual(s.dbl.state);
    expect(s.ctrl.state).toEqual({'throw:0': 'flarex2'});
  });

  it('the press is consumed: no drag starts (a far pointer move, a release elsewhere drop nothing), its click is ignored', () => {
    const s = screen(inv => { inv.set(P(0), inv.makeStack('water', 3)); inv.set(P(1), inv.makeStack('ammo_9mm', 20)); });
    const down = s.fire(P(1), 'pointerdown', s.ev(P(1), {ctrl: true}));
    expect([down.prevented, down.stopped]).toEqual([true, true]);
    s.fireWin('pointermove', s.ev(P(1), {ctrl: true, x: 400}));
    expect(s.ui.dragging).toBe(false);
    s.fireWin('pointerup', s.ev(P(1), {ctrl: true, x: 400}));
    expect(s.ui.lastDrop).toBeNull();
    const c = s.fire(P(1), 'click', s.ev(P(1), {ctrl: true}));
    expect(c.prevented).toBe(true);
    expect(s.ui.selected).toEqual(P(1)); // ammo: no double-click action -> a plain click (selected once, not toggled back by its click)
    expect([actions(s.log), s.state()]).toEqual([[], {'pack:0': 'waterx3', 'pack:1': 'ammo_9mmx20'}]);
    s.done();
  });

  it('one action per physical click: never paired with a plain click before or after it; Ctrl released before the click; macOS context menu', () => {
    // Ctrl+click, then a plain click on the same slot at once: ONE use (the plain click only selects)
    const a = screen(inv => { inv.set(P(0), inv.makeStack('water', 4)); });
    a.click(P(0), {ctrl: true});
    a.click(P(0));
    expect(actions(a.log)).toEqual(['use pack:0']);
    expect(a.inv.get(P(0))?.count).toBe(3);
    a.done();
    // a plain click, then a Ctrl+click at once: ONE use (not a double-click plus a Ctrl+click)
    const b = screen(inv => { inv.set(P(0), inv.makeStack('water', 4)); });
    b.click(P(0));
    b.click(P(0), {ctrl: true});
    expect(actions(b.log)).toEqual(['use pack:0']);
    b.click(P(0)); // and the next plain click starts a NEW double-click (no action yet)
    expect(actions(b.log)).toEqual(['use pack:0']);
    b.done();
    // Ctrl released before the button: the gesture's click is still ignored
    const c = screen(inv => { inv.set(P(0), inv.makeStack('helmet', 1)); });
    c.fire(P(0), 'pointerdown', c.ev(P(0), {ctrl: true}));
    c.fireWin('pointerup', c.ev(P(0)));
    const ck = c.fire(P(0), 'click', c.ev(P(0)));
    expect([ck.prevented, c.state(), c.ui.selected]).toEqual([true, {'gear:0': 'helmetx1'}, GEAR('helmet')]);
    c.done();
    // macOS: Ctrl+press then the context menu (no click): the press acted, the right-click action does NOT run on top
    const d = screen(inv => { inv.set(P(0), inv.makeStack('water', 4)); });
    d.fire(P(0), 'pointerdown', d.ev(P(0), {ctrl: true}));
    const cm = d.fire(P(0), 'contextmenu', d.ev(P(0), {ctrl: true}));
    expect([cm.prevented, actions(d.log)]).toEqual([true, ['use pack:0']]);
    // ... and an ordinary right-click afterwards still works (its own press resets the gesture)
    d.fire(P(0), 'pointerdown', d.ev(P(0), {button: 2}));
    d.fire(P(0), 'contextmenu', d.ev(P(0), {button: 2}));
    expect(actions(d.log)).toEqual(['use pack:0', 'use pack:0']);
    d.done();
  });

  it('Ctrl + RIGHT button stays the right-click action; Cmd + click works like Ctrl; empty slots and a closed screen do nothing', () => {
    const a = screen(inv => { inv.set(P(0), inv.makeStack('water', 4)); });
    const down = a.fire(P(0), 'pointerdown', a.ev(P(0), {ctrl: true, button: 2}));
    expect(down.stopped).toBe(false);
    a.fire(P(0), 'contextmenu', a.ev(P(0), {ctrl: true, button: 2}));
    expect(actions(a.log)).toEqual(['use pack:0']);
    a.click(P(0), {meta: true});
    expect(actions(a.log)).toEqual(['use pack:0', 'use pack:0']);
    a.click(P(5), {ctrl: true}); // empty
    expect([actions(a.log).length, a.ui.selected]).toEqual([2, null]);
    a.dom.el('#inventory').classList.add('hidden'); // the inventory does not own the input
    a.click(P(0), {ctrl: true});
    expect([actions(a.log).length, a.inv.get(P(0))?.count]).toEqual([2, 2]);
    a.done();
  });
});

describe('the Market trade view keeps its own Ctrl+click (buy / sell)', () => {
  let dom: FakeDom;
  beforeAll(() => { dom = installFakeDom(); });
  afterAll(() => dom.uninstall());

  it('with an inventory screen mounted, a Ctrl+press on a trade cell still sells (one trade); the inventory screen does nothing', () => {
    const t = tradeHost();
    t.h.inv.set(P(1), t.h.inv.makeStack('ammo_9mm', 40));
    t.build();
    const log: string[] = [];
    const ui = new InventoryUI(() => t.h.inv, {use: () => log.push('use'), drop: () => log.push('drop'), equip: () => log.push('equip'), close() {}, changed() {}});
    ui.render();
    t.standAt('gun');
    expect(t.press()).toBe(true);
    const root = dom.el('#app').children.filter(c => c.id === 'tradeview').at(-1)!;
    const cell = dom.el('[data-side="pack"]').children[1];
    const e = {button: 0, ctrlKey: true, metaKey: false, target: {closest: (sel: string) => (sel.includes('.slot') ? cell : null)}, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }};
    const trades = t.sys.counts.trades;
    for (const f of root.listeners.get('mousedown') ?? []) f(e);
    for (const f of root.listeners.get('click') ?? []) f(e);
    expect([t.sys.counts.trades - trades, t.h.inv.get(P(1))?.itemId !== 'ammo_9mm', carriedTies(t.h.inv) > 0]).toEqual([1, true, true]);
    expect([log, ui.selected, ui.lastDrop]).toEqual([[], null, null]);
  });
});
