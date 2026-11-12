// Task train-interaction-ux-20261112-063646 (lane DRAG; user: "ALL existing draggable items, including equipment and the fuel dolly,
// require HOLDING E to START dragging, with the existing crosshair hold-progress spinner. Quick normal interaction must not
// accidentally start dragging. … Cancel an unfinished hold normally on target/range/input-owner changes."): THE ONE HOLD GESTURE, pure
// (core/holdGesture.ts) — the rule the fuel carts and the train equipment both run:
//  - the press only begins; a release before DRAG_HOLD_S is the TAP, the key held DRAG_HOLD_S is the HOLD — at any frame rate, and
//    never a hold on a frame the key is already up;
//  - the ring: nothing before HOLD_RING_DELAY_S, then the rising progress, null exactly once when the gesture ends, nothing when idle;
//  - every cancel reason ends it with neither a tap nor a hold: the owner's conditions, the wiped keys, the aim, another input owner
//    BECOMING active (one already active at the press does not);
//  - foreignOwners(): the other owners as a bit set.
// The two systems on it: tests/drag-hold-fuel-cart.test.ts, tests/drag-hold-equipment.test.ts.

import {describe, expect, it} from 'vitest';
import {DRAG_HOLD_S, HOLD_RING_DELAY_S, HoldGesture, foreignOwners, type HoldFrame, type HoldStep} from '../src/core/holdGesture';
import {EQUIP_HOLD_S} from '../src/craft/equipmentApi';

const OK: HoldFrame = {down: true, clears: 0, live: true, aimed: true, foreign: 0};

function make() {
  const rings: (number | null)[] = [];
  const g = new HoldGesture<string>(p => { rings.push(p); });
  /** Step with E down until something other than 'pending' comes back (at most `max` s). */
  const run = (dt: number, f: Partial<HoldFrame> = {}, max = 5): {step: HoldStep; t: number} => {
    let t = 0;
    for (; t < max; t += dt) {
      const step = g.step(dt, {...OK, ...f});
      if (step !== 'pending') return {step, t: t + dt};
    }
    return {step: 'pending', t};
  };
  return {g, rings, run};
}

describe('the shared hold gesture: its times', () => {
  it('one hold time for every draggable: half a second (the grounded backpack\'s), the ring after a tenth', () => {
    expect(DRAG_HOLD_S).toBe(0.5);
    expect(HOLD_RING_DELAY_S).toBe(0.1);
    expect(EQUIP_HOLD_S).toBe(DRAG_HOLD_S); // the equipment's exported time IS the shared one (gear BAG_HOLD_S is 0.5 too)
    const g = new HoldGesture<string>();
    expect([g.holdS, g.ringDelayS]).toEqual([DRAG_HOLD_S, HOLD_RING_DELAY_S]);
  });
});

describe('the shared hold gesture: tap or hold', () => {
  it('idle: a step does nothing and never touches the ring', () => {
    const {g, rings} = make();
    for (let i = 0; i < 100; i++) expect(g.step(1 / 60, OK)).toBe('idle');
    expect([g.pending, g.target, g.progress]).toEqual([false, null, null]);
    expect(rings).toEqual([]);
    expect(g.cancel()).toBe(false);
    expect(rings).toEqual([]);
  });

  it('the press only begins: nothing is decided, nothing is shown', () => {
    const {g, rings} = make();
    g.begin('cart');
    expect([g.pending, g.target, g.progress, g.t]).toEqual([true, 'cart', 0, 0]);
    expect(rings).toEqual([]);
  });

  it('E released before the hold time = the TAP — also on the very frame of the press, also one frame short of the hold', () => {
    for (const frames of [0, 1, 5, 12, 29]) {
      const {g, rings} = make();
      g.begin('cart');
      for (let i = 0; i < frames; i++) expect(g.step(1 / 60, OK), `frame ${i}`).toBe('pending');
      expect(g.step(1 / 60, {...OK, down: false}), `released after ${frames} frames`).toBe('tap');
      expect([g.pending, g.target, g.progress]).toEqual([false, null, null]);
      expect(rings[rings.length - 1]).toBeNull(); // the ring is cleared with the gesture
      expect(g.step(1 / 60, OK)).toBe('idle'); // over: nothing follows
    }
  });

  it('E held for the hold time = the HOLD, once, at any frame rate; the time it takes is the hold time (within a frame)', () => {
    for (const hz of [240, 144, 60, 30, 20]) {
      const {g, run} = make();
      g.begin('cart');
      const r = run(1 / hz);
      expect(r.step, `${hz} Hz`).toBe('hold');
      expect(r.t, `${hz} Hz`).toBeGreaterThanOrEqual(DRAG_HOLD_S - 1e-9);
      expect(r.t, `${hz} Hz`).toBeLessThan(DRAG_HOLD_S + 1 / hz + 1e-9);
      expect(g.pending).toBe(false);
      expect(g.step(1 / hz, OK)).toBe('idle'); // the key still down afterwards: nothing more (no second hold)
      expect(g.step(1 / hz, {...OK, down: false})).toBe('idle'); // releasing it afterwards: nothing (never a tap after the hold)
    }
  });

  it('never a hold on a frame the key is already up — even a frame long enough to pass the hold time', () => {
    const {g} = make();
    g.begin('cart');
    expect(g.step(1 / 60, OK)).toBe('pending');
    expect(g.step(2, {...OK, down: false})).toBe('tap'); // a 2 s hitch with the key released during it: still the tap
    // and with the key down through a long frame it is the hold
    g.begin('cart');
    expect(g.step(2, OK)).toBe('hold');
  });

  it('a new press while one is pending starts over (the old one is dropped, the ring cleared)', () => {
    const {g, rings} = make();
    g.begin('a');
    for (let i = 0; i < 20; i++) g.step(1 / 60, OK);
    expect(g.progress).toBeGreaterThan(0.6);
    g.begin('b');
    expect([g.target, g.t, g.progress]).toEqual(['b', 0, 0]);
    expect(rings[rings.length - 1]).toBeNull();
  });

  it('custom times (a test knob): the same rule', () => {
    const rings: (number | null)[] = [];
    const g = new HoldGesture<number>(p => { rings.push(p); }, 1, 0.25);
    g.begin(7);
    let n = 0;
    while (g.step(1 / 16, OK) === 'pending') n++;
    expect(n).toBe(15); // the 16th step reaches 1 s (sixteenths are exact)
    expect(rings.filter(v => v === null)).toHaveLength(3 + 1); // 1/16 .. 3/16 s: no ring yet; + the clearing at the end
  });
});

describe('the shared hold gesture: the crosshair ring', () => {
  it('nothing for the first tenth of a second, then the progress rising to just under 1, then null once', () => {
    const {g, rings, run} = make();
    g.begin('cart');
    expect(run(1 / 64).step).toBe('hold'); // (64ths are exact: no rounding at the two thresholds)
    expect(rings).toHaveLength(32); // 31 pending frames + the clearing on the 32nd (0.5 s)
    const end = rings.length - 1;
    expect(rings[end]).toBeNull();
    const shown = rings.slice(0, end);
    const first = shown.findIndex(v => v !== null);
    expect(first).toBe(6); // frames 1..6 (t < 0.1 s) write null: a tap never flashes the ring
    for (let i = 0; i < first; i++) expect(shown[i]).toBeNull();
    const vals = shown.slice(first) as number[];
    expect(vals.every(v => typeof v === 'number')).toBe(true);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    expect(vals[0]).toBeCloseTo(HOLD_RING_DELAY_S / DRAG_HOLD_S, 1);
    expect(vals[vals.length - 1]).toBeGreaterThan(0.9);
    expect(vals[vals.length - 1]).toBeLessThan(1);
    // after the end: idle steps write nothing more
    const n = rings.length;
    for (let i = 0; i < 30; i++) g.step(1 / 60, OK);
    expect(rings.length).toBe(n);
  });

  it('a quick tap never shows the ring (only nulls are written)', () => {
    const {g, rings} = make();
    g.begin('cart');
    for (let i = 0; i < 4; i++) g.step(1 / 60, OK);
    expect(g.step(1 / 60, {...OK, down: false})).toBe('tap');
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.every(v => v === null)).toBe(true);
  });

  it('progress (QA) follows the clock and is null with nothing pending', () => {
    const {g} = make();
    expect(g.progress).toBeNull();
    g.begin('cart');
    g.step(0.25, OK);
    expect(g.progress).toBeCloseTo(0.5, 9);
    g.cancel();
    expect(g.progress).toBeNull();
  });
});

describe('the shared hold gesture: every cancel reason ends it with nothing done', () => {
  const reasons: [string, Partial<HoldFrame>][] = [
    ['the owner\'s conditions fail (not playing / dead / climbing / the train riding / the target gone)', {live: false}],
    ['the keys were wiped (a menu, a blur: Input.clears changed)', {clears: 1}],
    ['the aim left the target / its reach', {aimed: false}],
    ['another input owner became active', {foreign: 0b100}],
  ];
  for (const [name, bad] of reasons) {
    it(`${name}: cancelled — no tap, no hold, the ring cleared, at any moment of the hold`, () => {
      for (const after of [0, 3, 15, 29]) {
        const {g, rings} = make();
        g.begin('cart');
        for (let i = 0; i < after; i++) expect(g.step(1 / 60, OK)).toBe('pending');
        expect(g.step(1 / 60, {...OK, ...bad}), `after ${after} frames`).toBe('cancelled');
        expect([g.pending, g.target, g.progress]).toEqual([false, null, null]);
        expect(rings[rings.length - 1]).toBeNull();
        // the condition gone again, the key still down: nothing resumes
        for (let i = 0; i < 60; i++) expect(g.step(1 / 60, OK)).toBe('idle');
      }
    });

    it(`${name} on the frame the key is released: still cancelled, never the tap`, () => {
      const {g} = make();
      g.begin('cart');
      g.step(1 / 60, OK);
      expect(g.step(1 / 60, {...OK, ...bad, down: false})).toBe('cancelled');
    });

    it(`${name} on the frame the hold time is reached: still cancelled, never the hold`, () => {
      const {g} = make();
      g.begin('cart');
      for (let i = 0; i < 29; i++) g.step(1 / 60, OK);
      expect(g.step(1, {...OK, ...bad})).toBe('cancelled');
    });
  }

  it('the clear counter is compared with its value AT THE PRESS (not with zero)', () => {
    const {g, run} = make();
    g.begin('cart', 41);
    expect(g.step(1 / 60, {...OK, clears: 41})).toBe('pending');
    expect(run(1 / 60, {clears: 41}).step).toBe('hold');
    g.begin('cart', 41);
    expect(g.step(1 / 60, {...OK, clears: 42})).toBe('cancelled');
  });

  it('an input owner ALREADY active at the press does not cancel; a NEW one does; one that ended and comes back does', () => {
    const {g, run} = make();
    // (the gas mask going on when E is pressed: E on a cart worked then before, and still does)
    g.begin('cart', 0, 0b010);
    expect(run(1 / 60, {foreign: 0b010}).step).toBe('hold');
    // a second owner joins
    g.begin('cart', 0, 0b010);
    expect(g.step(1 / 60, {...OK, foreign: 0b010})).toBe('pending');
    expect(g.step(1 / 60, {...OK, foreign: 0b110})).toBe('cancelled');
    // the first one ends (not a cancel) and another takes over on a later frame
    g.begin('cart', 0, 0b010);
    expect(g.step(1 / 60, {...OK, foreign: 0})).toBe('pending');
    expect(g.step(1 / 60, {...OK, foreign: 0b010})).toBe('cancelled');
    // one ends and another begins on the SAME frame: a change of owner all the same
    g.begin('cart', 0, 0b010);
    expect(g.step(1 / 60, {...OK, foreign: 0b100})).toBe('cancelled');
  });

  it('cancel(): the owner drops it (a teardown, a restore, the target captured) — true once, the ring cleared once', () => {
    const {g, rings} = make();
    g.begin('cart');
    for (let i = 0; i < 10; i++) g.step(1 / 60, OK);
    const n = rings.length;
    expect(g.cancel()).toBe(true);
    expect(rings.length).toBe(n + 1);
    expect(rings[n]).toBeNull();
    expect(g.cancel()).toBe(false);
    expect(rings.length).toBe(n + 1);
    expect(g.step(1 / 60, OK)).toBe('idle');
  });
});

describe('foreignOwners: the other input owners as a bit set', () => {
  it('skips the owner\'s own function, sets one bit per active other owner, tolerates a missing list', () => {
    const state = [false, false, false, false];
    const owners = state.map((_, i) => () => state[i]);
    const own = owners[1];
    expect(foreignOwners(owners, own)).toBe(0);
    state[1] = true; // (its own: a pending hold is an input owner itself)
    expect(foreignOwners(owners, own)).toBe(0);
    state[0] = true;
    expect(foreignOwners(owners, own)).toBe(0b0001);
    state[3] = true;
    expect(foreignOwners(owners, own)).toBe(0b1001);
    expect(foreignOwners(owners, null)).toBe(0b1011);
    expect(foreignOwners(null, own)).toBe(0);
    expect(foreignOwners(undefined, own)).toBe(0);
    expect(foreignOwners([], own)).toBe(0);
  });

  it('more owners than bits: the ones past the 30th share the top bit (still a non-negative set, still seen)', () => {
    const state = new Array<boolean>(40).fill(false);
    const owners = state.map((_, i) => () => state[i]);
    state[39] = true;
    const m = foreignOwners(owners, null);
    expect(m).toBe(2 ** 30);
    state[35] = true;
    expect(foreignOwners(owners, null)).toBe(m);
    state[2] = true;
    expect(foreignOwners(owners, null)).toBe(m + 4);
    // and the gesture sees one of them becoming active
    const g = new HoldGesture<string>();
    g.begin('cart', 0, 0);
    expect(g.step(1 / 60, {...OK, foreign: m})).toBe('cancelled');
  });
});
