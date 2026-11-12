// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE SENTRY'S HOPPER — real 5.56 mm rounds in, real rounds out, none made.
//  - craft/sentry.ts loadHopper / unloadHopper against the game's REAL Inventory (items/inventory.ts) and a unit whose hopper clamps as
//    the contract says: load all / up to the cap / nothing carried / full; unload all (ordinary stacks) / merge into a carried stack /
//    as many as fit when the pockets are full; inventory + hopper constant through a long random sequence; a hopper that takes fewer
//    rounds than offered gives the rest back;
//  - the console (world/sentryTurret.ts: EquipmentSystemLike.uses.sentry): the prompt in every state, TAP loads, HOLD unloads, the
//    denials change nothing, plugged in or not, not while the train moves; a crafted (empty) sentry holds nothing and nothing but a
//    TAP ever adds a round.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {DT, FakeUnit, sentryWorld, teardownSentryWorlds} from './helpers/sentryFixture';
import {mulberry32} from '../src/core/rng';
import {Inventory} from '../src/items/inventory';
import {itemDef} from '../src/items/items';
import {EQUIPMENT} from '../src/craft/equipment';
import {loadHopper, planLoad, planUnload, unloadHopper} from '../src/craft/sentry';
import {SENTRY_TEXT} from '../src/world/sentryTurret';

installCanvasShim(false);
afterEach(teardownSentryWorlds);

const AMMO = EQUIPMENT.sentry.ammoItem!, CAP = EQUIPMENT.sentry.ammoCap, STACK = itemDef(AMMO).stackMax;

const slotsOf = (inv: Inventory) => [...inv.pack, ...inv.hotbar];
const freeSlots = (inv: Inventory) => slotsOf(inv).filter(s => !s).length;
const ammoStacks = (inv: Inventory) => slotsOf(inv).filter(s => s?.itemId === AMMO).map(s => s!.count).sort((a, b) => b - a);
/** Rounds into the pockets (as many stacks as it takes); returns what did not fit. */
function carry(inv: Inventory, n: number): number {
  let left = 0;
  for (; n > 0; n -= STACK) left += inv.add(inv.makeStack(AMMO, Math.min(n, STACK)));
  return left;
}
/** Every free slot but `free` filled with full stacks of something else. */
function clutter(inv: Inventory, free: number): void {
  const max = itemDef('bandage').stackMax;
  for (let guard = 0; guard < 64 && freeSlots(inv) > free; guard++) inv.add(inv.makeStack('bandage', max));
  expect(freeSlots(inv)).toBe(free);
}

describe('sentry hopper: the plan (pure)', () => {
  it('a load moves every carried round there is room for; an unload hands back one stack at a time', () => {
    expect(CAP).toBe(300);
    expect(AMMO).toBe('ammo_556');
    expect(planLoad(75, 0, CAP)).toBe(75);
    expect(planLoad(360, 0, CAP)).toBe(300);
    expect(planLoad(360, 290, CAP)).toBe(10);
    expect(planLoad(0, 12, CAP)).toBe(0);
    expect(planLoad(50, CAP, CAP)).toBe(0);
    expect(planLoad(50, CAP + 5, CAP)).toBe(0); // (never negative)
    expect(planLoad(-3, 0, CAP)).toBe(0);
    expect(planUnload(300, STACK)).toBe(STACK);
    expect(planUnload(45, STACK)).toBe(45);
    expect(planUnload(0, STACK)).toBe(0);
  });
});

describe('sentry hopper: loading from the real inventory', () => {
  it('load all: every carried round goes in, the pockets are empty of them', () => {
    const inv = new Inventory(), u = new FakeUnit('eq-1');
    carry(inv, 75);
    expect(loadHopper(inv, u)).toBe(75);
    expect([u.ammo, inv.count(AMMO)]).toEqual([75, 0]);
    expect(ammoStacks(inv)).toEqual([]);
  });

  it('load to the cap: only the room is taken, the rest stays carried', () => {
    const inv = new Inventory(), u = new FakeUnit('eq-1');
    carry(inv, 360);
    expect(loadHopper(inv, u)).toBe(CAP);
    expect([u.ammo, inv.count(AMMO)]).toEqual([CAP, 60]);
    const inv2 = new Inventory(), u2 = new FakeUnit('eq-2', 'sentry', 290);
    carry(inv2, 45);
    expect(loadHopper(inv2, u2)).toBe(10);
    expect([u2.ammo, inv2.count(AMMO)]).toEqual([CAP, 35]);
  });

  it('nothing carried / already full: nothing moves, nothing is touched', () => {
    const inv = new Inventory(), u = new FakeUnit('eq-1', 'sentry', 12);
    inv.add(inv.makeStack('ammo_9mm', 40)); // (another caliber is not sentry ammunition)
    const v = inv.version;
    expect(loadHopper(inv, u)).toBe(0);
    expect([u.ammo, inv.count(AMMO), inv.count('ammo_9mm'), inv.version, u.asked.length]).toEqual([12, 0, 40, v, 0]);
    const full = new FakeUnit('eq-2', 'sentry', CAP);
    carry(inv, 50);
    const v2 = inv.version;
    expect(loadHopper(inv, full)).toBe(0);
    expect([full.ammo, inv.count(AMMO), inv.version, full.asked.length]).toEqual([CAP, 50, v2, 0]);
  });

  it('a hopper that takes fewer rounds than offered gives the rest back (the total is exact either way)', () => {
    const inv = new Inventory();
    carry(inv, 100);
    let ammo = 0;
    const odd = {get ammo() { return ammo; }, setAmmo(n: number) { ammo = Math.min(n, 30); return ammo; }, def: {ammoCap: CAP, ammoItem: AMMO}};
    expect(loadHopper(inv, odd)).toBe(30);
    expect([ammo, inv.count(AMMO)]).toEqual([30, 70]);
  });
});

describe('sentry hopper: unloading into the real inventory', () => {
  it('unload all: the rounds come back as ordinary stacks', () => {
    const inv = new Inventory(), u = new FakeUnit('eq-1', 'sentry', CAP);
    expect(unloadHopper(inv, u, STACK)).toBe(CAP);
    expect(u.ammo).toBe(0);
    expect(ammoStacks(inv)).toEqual([120, 120, 60]);
    for (const s of slotsOf(inv)) if (s) expect(s.itemId).toBe(AMMO);
  });

  it('unloaded rounds merge into a carried stack first', () => {
    const inv = new Inventory(), u = new FakeUnit('eq-1', 'sentry', 50);
    carry(inv, 100);
    expect(unloadHopper(inv, u, STACK)).toBe(50);
    expect(u.ammo).toBe(0);
    expect(ammoStacks(inv)).toEqual([120, 30]);
  });

  it('pockets full: as many as fit come out, the rest stays loaded', () => {
    // one free slot: one stack
    const a = new Inventory(), ua = new FakeUnit('eq-1', 'sentry', CAP);
    clutter(a, 1);
    expect(unloadHopper(a, ua, STACK)).toBe(STACK);
    expect([ua.ammo, a.count(AMMO), freeSlots(a)]).toEqual([CAP - STACK, STACK, 0]);
    // no free slot, a carried stack with room for 20
    const b = new Inventory(), ub = new FakeUnit('eq-2', 'sentry', CAP);
    carry(b, 100);
    clutter(b, 0);
    expect(unloadHopper(b, ub, STACK)).toBe(20);
    expect([ub.ammo, b.count(AMMO)]).toEqual([CAP - 20, 120]);
    // no room at all
    const c = new Inventory(), uc = new FakeUnit('eq-3', 'sentry', 77);
    clutter(c, 0);
    expect(unloadHopper(c, uc, STACK)).toBe(0);
    expect([uc.ammo, c.count(AMMO), uc.asked.length]).toEqual([77, 0, 0]);
  });
});

describe('sentry hopper: rounds are conserved through any sequence', () => {
  it('800 random loads / unloads / pick-ups / shots / pocket clutter: inventory + hopper is the running total at every step', () => {
    const R = mulberry32(0x5e77), inv = new Inventory(), u = new FakeUnit('eq-1');
    let total = 0, loads = 0, unloads = 0, shots = 0;
    for (let i = 0; i < 800; i++) {
      const k = R();
      if (k < 0.3) { const n = loadHopper(inv, u); if (n) loads++; }
      else if (k < 0.55) { const n = unloadHopper(inv, u, STACK); if (n) unloads++; }
      else if (k < 0.7) { const n = 1 + Math.floor(R() * 150); total += n - carry(inv, n); } // found rounds (what fits)
      else if (k < 0.82) { if (u.ammo > 0) { u.setAmmo(u.ammo - 1); total--; shots++; } } // a shot: the only other way out
      else if (k < 0.92) inv.add(inv.makeStack('bandage', itemDef('bandage').stackMax)); // the pockets fill up
      else inv.take('bandage', 1 + Math.floor(R() * 12));
      expect(inv.count(AMMO) + u.ammo, `step ${i}`).toBe(total);
      expect(u.ammo).toBeGreaterThanOrEqual(0);
      expect(u.ammo).toBeLessThanOrEqual(CAP);
      expect(Number.isInteger(u.ammo)).toBe(true);
    }
    expect(Math.min(loads, unloads, shots)).toBeGreaterThan(20); // (the sequence really exercised all three)
  });
});

describe('sentry console: [E] loads, hold [E] unloads', () => {
  it('registers the console use; a crafted sentry is empty and its prompt says what the player can do', () => {
    const s = sentryWorld({plug: null});
    const use = s.eq.uses.sentry!, u = s.unit;
    expect(typeof use.prompt).toBe('function');
    expect(typeof use.hold).toBe('function');
    expect(u.ammo).toBe(0);
    expect(use.prompt(u)).toBe('Sentry 0/300 rounds — no 5.56mm carried · not plugged in');
    carry(s.host.inv, 75);
    expect(use.prompt(u)).toBe('<b>[E]</b> Load 5.56mm (75 carried) · sentry 0/300 rounds · not plugged in');
    s.eq.connect(u, 1);
    expect(use.prompt(u)).toBe('<b>[E]</b> Load 5.56mm (75 carried) · sentry 0/300 rounds');
  });

  it('TAP loads what is carried (plugged in or not), toasts the count; nothing carried / full are denials that change nothing', () => {
    const s = sentryWorld({plug: null});
    const use = s.eq.uses.sentry!, u = s.unit, inv = s.host.inv;
    // nothing carried
    expect(use.tap(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: SENTRY_TEXT.nothingToLoad('5.56mm'), warn: true});
    expect([u.ammo, s.sfx.count('denied'), s.sfx.count('shellIn')]).toEqual([0, 1, 0]);
    // unplugged: loading works
    carry(inv, 75);
    expect(use.tap(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: 'Loaded 75 rounds — sentry 75/300', warn: false});
    expect([u.ammo, inv.count(AMMO), s.sfx.count('shellIn')]).toEqual([75, 0, 1]);
    expect(use.prompt(u)).toBe('Sentry 75/300 rounds — no 5.56mm carried · hold <b>[E]</b> to unload · not plugged in');
    // plugged: up to the cap, the rest stays carried
    s.eq.connect(u, 0);
    carry(inv, 300);
    expect(use.tap(u)).toBe(true);
    expect(s.toasts.pop()!.text).toBe('Loaded 225 rounds — sentry 300/300');
    expect([u.ammo, inv.count(AMMO)]).toEqual([CAP, 75]);
    expect(use.prompt(u)).toBe('Sentry 300/300 rounds — full · hold <b>[E]</b> to unload');
    // full
    const v = inv.version;
    expect(use.tap(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: SENTRY_TEXT.hopperFull(CAP), warn: true});
    expect([u.ammo, inv.count(AMMO), inv.version]).toEqual([CAP, 75, v]);
    // one round
    u.setAmmo(299);
    expect(use.tap(u)).toBe(true);
    expect(s.toasts.pop()!.text).toBe('Loaded 1 round — sentry 300/300');
    expect(s.sys.counts.loaded).toBe(75 + 225 + 1);
  });

  it('HOLD unloads into the pockets, as many as fit; an empty sentry / full pockets are denials', () => {
    const s = sentryWorld({plug: 0, ammo: 250});
    const use = s.eq.uses.sentry!, u = s.unit, inv = s.host.inv;
    clutter(inv, 1);
    expect(use.hold!(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: 'Unloaded 120 rounds — no room for the other 130', warn: true});
    expect([u.ammo, inv.count(AMMO)]).toEqual([130, 120]);
    // no room now
    expect(use.hold!(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: SENTRY_TEXT.noRoom(130, CAP), warn: true});
    expect([u.ammo, inv.count(AMMO)]).toEqual([130, 120]);
    // room again: everything comes out
    inv.take('bandage', 9999);
    expect(use.hold!(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: 'Unloaded 130 rounds — the sentry is empty', warn: false});
    expect([u.ammo, inv.count(AMMO)]).toEqual([0, 250]);
    expect(ammoStacks(inv)).toEqual([120, 120, 10]);
    // empty
    expect(use.hold!(u)).toBe(true);
    expect(s.toasts.pop()).toEqual({text: SENTRY_TEXT.nothingToUnload, warn: true});
    expect(s.sys.counts.unloaded).toBe(250);
  });

  it('not while the train moves (riding, or the unit is cargo): nothing is loaded or unloaded', () => {
    const s = sentryWorld({plug: 0, ammo: 40});
    const use = s.eq.uses.sentry!, u = s.unit, inv = s.host.inv;
    carry(inv, 60);
    for (const set of [() => { s.host.trainRide.riding = true; }, () => { s.host.trainRide.riding = false; u.mode = 'cargo'; }]) {
      set();
      expect(use.prompt(u)).toBe('Sentry 40/300 rounds — not while the train is moving');
      expect(use.tap(u)).toBe(true);
      expect(use.hold!(u)).toBe(true);
      expect(s.toasts.splice(0).map(t => t.text)).toEqual([SENTRY_TEXT.moving, SENTRY_TEXT.moving]);
      expect([u.ammo, inv.count(AMMO)]).toEqual([40, 60]);
    }
    u.mode = 'world';
    expect(use.tap(u)).toBe(true);
    expect([u.ammo, inv.count(AMMO)]).toEqual([100, 0]);
  });

  it('nothing but a TAP adds a round: a crafted, plugged-in sentry stays at 0 through play, a ride and a rebuild', () => {
    const s = sentryWorld({plug: 0});
    const u = s.unit;
    carry(s.host.inv, 90); // carried rounds are not taken by themselves
    for (let i = 0; i < 4 / DT; i++) s.sys.update(DT);
    s.host.trainRide.riding = true;
    s.eq.parked = false;
    for (let i = 0; i < 1 / DT; i++) s.sys.update(DT);
    s.host.trainRide.riding = false;
    s.eq.parked = true;
    for (const h of s.host.sectionHooks) h.teardown?.();
    for (const h of s.host.sectionHooks) h.build?.(s.lay);
    for (let i = 0; i < 2 / DT; i++) s.sys.update(DT);
    expect(u.ammo).toBe(0);
    expect(u.asked).toEqual([]);
    expect(s.host.inv.count(AMMO)).toBe(90);
    expect([s.sys.counts.shots, s.sys.deploy, s.sys.view.root.visible]).toEqual([0, 0, false]);
  });
});
