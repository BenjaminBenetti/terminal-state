// Task studio-bunker-rework-20261109-205115-01, fix 3 (USER-CORRECTED FUEL CONTRACT): a Bunker generator needs ONE QUARTER-TANK fuel UNIT
// from ANY common train-style source. A fuel cart's HOSE feeds it exactly as it feeds the train's cap (world/fuelCarts.ts FuelHoseTarget):
// within the hose's reach of the filler, one whole unit per transfer tick, the cart's unit leaving in the same tick the generator takes
// it, the hose disconnecting when the generator is fuelled — the cart keeps the rest (no whole-cart drain, no overfill, no can needed).
// Out of reach / grabbed / disconnected mid-tick: nothing moves. The can pour and the v1 -> v2 record migration are covered in
// bunker-objective-runtime / bunker-objective-state.

import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {FUEL} from '../src/fuel/fuel';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {CART_TEXT, FUEL_CART, type FuelHoseTarget} from '../src/world/fuelCarts';
import {frame, lookAt, press, roomHost, run} from './helpers/fuelCartsHost';
import {BUNKER_GEN_FUEL_UNITS, addGenFuel, freshBunkerState, fuelNeeded, loadBunkerState} from '../src/world/bunker/objectiveState';

installCanvasShim(false);

/** A generator-like target on the room's floor (the objective's own commit rule: addGenFuel into a version-2 record). */
function generatorTarget(at: {x: number; y: number; z: number}) {
  const state = freshBunkerState(['gen-0']);
  let takes = 0;
  const t: FuelHoseTarget = {
    id: 'bunker:gen-0', label: 'auxiliary generator A',
    cap: () => at,
    room: () => fuelNeeded(state, 'gen-0'),
    take: () => { takes++; return addGenFuel(state, 'gen-0', 1) === 1; },
    fullText: 'Auxiliary generator A fuelled — hose disconnected · hold [E] to turn the key',
  };
  return {t, state, takes: () => takes};
}

/** A room (no train), a cart at (2.5, 3) facing +x, the player behind it; the target's filler `dx` m beyond the drum. */
function setup(units: number = FUEL.cartUnits, dx = 0.9) {
  const {h, carts} = roomHost();
  carts.spawn({uid: 'cart:g', units, x: 2.5, y: 0, z: 3, yaw: Math.PI / 2, level: 0});
  h.player.place(1.4, 3, 0, 0);
  frame(h);
  const b = () => carts.bodyOf('cart:g')!;
  const nozzle = () => { const N = CART_LOOK.nozzle, s = Math.sin(b().yaw), c = Math.cos(b().yaw); return {x: b().x + N.x * c + N.z * s, y: b().y + N.y, z: b().z - N.x * s + N.z * c}; };
  const n0 = nozzle();
  const gen = generatorTarget({x: n0.x + dx, y: 0.9, z: n0.z});
  carts.targets.push(gen.t);
  const aimDrum = () => { lookAt(h, b().x + Math.sin(b().yaw) * CART_LOOK.drumZ, b().y + CART_LOOK.drumTop - 0.1, b().z + Math.cos(b().yaw) * CART_LOOK.drumZ); };
  const cartUnits = () => carts.all().find(c => c.uid === 'cart:g')!.units;
  return {h, carts, gen, aimDrum, cartUnits};
}

describe('a fuel cart fuels a Bunker generator through its hose (one quarter-tank unit, then it disconnects)', () => {
  it('connects to the generator in reach; ONE unit in one tick (both sides at once); disconnects fuelled; the cart keeps the rest; no train involved', () => {
    const {h, carts, gen, aimDrum, cartUnits} = setup();
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Connect the hose to the auxiliary generator A · cart 2 tanks · needs ¼ tank/);
    press(h, 'KeyE');
    expect(carts.hoseOn?.target?.id).toBe('bunker:gen-0');
    expect(h.toasts).toContain(CART_TEXT.connected);
    run(h, FUEL_CART.transferEvery - 0.1);
    expect(gen.state.fuel['gen-0']).toBe(0); // nothing before the first tick
    expect(cartUnits()).toBe(FUEL.cartUnits);
    run(h, 0.3);
    expect(gen.state.fuel['gen-0']).toBe(BUNKER_GEN_FUEL_UNITS);
    expect(gen.state.gens['gen-0']).toBe('fuelled');
    expect(cartUnits()).toBe(FUEL.cartUnits - BUNKER_GEN_FUEL_UNITS); // exactly the need: no whole-cart drain
    expect(carts.hoseOn).toBeNull();
    expect(h.toasts.at(-1)).toBe(gen.t.fullText);
    run(h, 5);
    expect(cartUnits()).toBe(FUEL.cartUnits - 1);
    expect(gen.takes()).toBe(1);
    expect(h.playerTrain.fuel.tank).toBe(0);
    // fuelled: no more hose to it (the drag line only)
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart/);
  });

  it('E before the tick disconnects: nothing moves; an empty cart offers no hose; out of reach offers none', () => {
    const a = setup();
    a.aimDrum();
    press(a.h, 'KeyE');
    run(a.h, FUEL_CART.transferEvery * 0.5);
    a.aimDrum();
    frame(a.h);
    press(a.h, 'KeyE');
    expect(a.carts.hoseOn).toBeNull();
    run(a.h, 3);
    expect(a.gen.state.fuel['gen-0']).toBe(0);
    expect(a.cartUnits()).toBe(FUEL.cartUnits);
    const empty = setup(0);
    empty.aimDrum();
    frame(empty.h);
    expect(empty.carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart · empty/);
    const far = setup(FUEL.cartUnits, FUEL_CART.hoseMax + 0.6);
    far.aimDrum();
    frame(far.h);
    expect(far.carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart/);
    press(far.h, 'KeyE');
    expect([far.carts.hoseOn, far.carts.grab]).toEqual([null, null]); // a tap out of reach does nothing (never a grab)
    run(far.h, 3);
    expect(far.gen.state.fuel['gen-0']).toBe(0);
  });

  it('a refused commit moves nothing (the cart keeps its unit); a generator already paid takes nothing', () => {
    const {h, carts, gen, aimDrum, cartUnits} = setup();
    aimDrum();
    press(h, 'KeyE');
    // the generator gets its unit another way (a can poured) before the hose's first tick
    expect(addGenFuel(gen.state, 'gen-0', 1)).toBe(1);
    run(h, 2);
    expect(cartUnits()).toBe(FUEL.cartUnits); // the hose saw it full: disconnected, nothing drawn
    expect(carts.hoseOn).toBeNull();
    expect(addGenFuel(gen.state, 'gen-0', 1)).toBe(0); // no overfill
    expect(gen.state.fuel['gen-0']).toBe(BUNKER_GEN_FUEL_UNITS);
  });
});

describe('the quarter-unit record', () => {
  it('a generator needs one quarter of a standard tank = one fuel unit = one can; a version-1 record migrates as paid', () => {
    expect(BUNKER_GEN_FUEL_UNITS).toBe(FUEL.tankUnits / 4);
    expect(BUNKER_GEN_FUEL_UNITS).toBe(1);
    expect(FUEL.canUnits).toBe(BUNKER_GEN_FUEL_UNITS);
    const st = loadBunkerState({v: 1, gens: {'gen-0': 'online', 'gen-1': 'fuelled', 'gen-2': 'off'}}, ['gen-0', 'gen-1', 'gen-2']);
    expect(st.fuel).toEqual({'gen-0': 1, 'gen-1': 1, 'gen-2': 0});
    expect([fuelNeeded(st, 'gen-0'), fuelNeeded(st, 'gen-1'), fuelNeeded(st, 'gen-2')]).toEqual([0, 0, 1]);
    expect(st.gens).toEqual({'gen-0': 'online', 'gen-1': 'fuelled', 'gen-2': 'off'}); // never un-started, never re-charged
  });
});
