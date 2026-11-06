// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): the fuel cart's HOSE on a generated station with the REAL parked
// train (PlayerTrainRuntime + TrainRide): E on the drum within PORT.hoseMax of the fuel cap connects it (one pooled tube, rewritten in
// place); one unit every FUEL_CART.transferEvery s from the drum into the train tank — whole units, conserved exactly, never past
// FUEL.tankUnits; it disconnects (the unit in progress lost) on E, the tank full, the cart empty, the cart pushed out of reach, the
// train departing and a world teardown; out of reach / with a full tank E grabs instead.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainSpawnPose, trainToWorld} from '../src/gen/playerTrain';
import {FUEL} from '../src/fuel/fuel';
import {PORT, fuelPortLocal} from '../src/fuel/trainPort';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK, HOSE} from '../src/world/fuelCartModel';
import {CART_TEXT, FUEL_CART} from '../src/world/fuelCarts';
import {DT, frame, lookAt, press, run, stationHost, teardown} from './helpers/fuelCartsHost';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';

installCanvasShim(false);

let subway: StationLayout | null = null;
const SUBWAY = () => (subway ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** The station, a cart on the platform beside the fuel cap (drum toward the car), the player behind it looking at the drum. */
function setup(units = FUEL.cartUnits, tank = 0, lz = -2.5, dx = 0) {
  const s = stationHost(SUBWAY());
  live.push(s.rt);
  const {h, carts} = s;
  const p = h.trainPlacement!, cap = fuelPortLocal(SPEC);
  const w = trainToWorld(p, cap.x + dx, SPEC.floorY, lz);
  const floor = h.levels!.floorAt(w.x, w.z, p.floorY + 0.3);
  const yaw = Math.atan2(0, -p.platformSide); // the cart's front (the drum) toward the car
  carts.spawn({uid: 'cart:test', units, x: w.x, y: floor, z: w.z, yaw, level: p.level});
  h.playerTrain.fuel.tank = tank;
  const pw = trainToWorld(p, cap.x + dx, SPEC.floorY, lz - 1.05);
  h.player.place(pw.x, pw.z, 0, floor);
  frame(h);
  const aimDrum = () => {
    const b = carts.bodyOf('cart:test')!;
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.drumZ, b.y + CART_LOOK.drumTop - 0.1, b.z + Math.cos(b.yaw) * CART_LOOK.drumZ);
  };
  const aimHandle = () => {
    const b = carts.bodyOf('cart:test')!;
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z);
  };
  const capW = trainToWorld(p, cap.x, cap.y, cap.z);
  return {...s, p, aimDrum, aimHandle, capW, cartUnits: () => carts.all().find(c => c.uid === 'cart:test')!.units};
}

describe('fuel cart hose', () => {
  it('E on the drum near the cap connects; whole units every 1.2 s, conserved exactly; stops at a full tank (no overfill)', () => {
    const {h, carts, aimDrum, capW, cartUnits} = setup(FUEL.cartUnits, 1);
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Connect the hose · cart 2 tanks · train tank ¼ tank/);
    const geo = carts.hose.geometry;
    press(h, 'KeyE');
    expect(carts.hoseOn).not.toBeNull();
    expect(h.toasts).toContain(CART_TEXT.connected);
    expect(h.sfxCalls).toContain('hose:true');
    expect(carts.hose.mesh.visible).toBe(true);
    const total = h.playerTrain.fuel.tank + cartUnits();
    // nothing flows before the first 1.2 s
    run(h, FUEL_CART.transferEvery - 0.1);
    expect(h.playerTrain.fuel.tank).toBe(1);
    let maxTank = 0;
    run(h, 10, () => {
      const t = h.playerTrain.fuel.tank;
      maxTank = Math.max(maxTank, t);
      expect(Number.isInteger(t) && Number.isInteger(cartUnits())).toBe(true);
      expect(t + cartUnits()).toBe(total); // conserved exactly
      return false;
    });
    expect(h.playerTrain.fuel.tank).toBe(FUEL.tankUnits);
    expect(maxTank).toBe(FUEL.tankUnits); // never past the tank
    expect(cartUnits()).toBe(total - FUEL.tankUnits);
    expect(carts.hoseOn).toBeNull();
    expect(carts.hose.mesh.visible).toBe(false);
    expect(h.toasts).toContain(CART_TEXT.full);
    expect(carts.counts.transfers).toBe(FUEL.tankUnits - 1);
    expect(h.sfxCalls.filter(c => c === 'pour')).toHaveLength(FUEL.tankUnits - 1);
    // the hose was one pooled geometry rewritten in place, its sag above the floor, ending at the cap
    expect(carts.hose.geometry).toBe(geo);
    expect(carts.hose.updates).toBeGreaterThan(100);
    expect(carts.hose.lowestY()).toBeGreaterThan(carts.bodyOf('cart:test')!.y + 0.05 - HOSE.radius - 1e-3);
    const pos = geo.attributes.position.array as Float32Array, last = pos.length - 3 * HOSE.sides;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < HOSE.sides; j++) { cx += pos[last + 3 * j]; cy += pos[last + 3 * j + 1]; cz += pos[last + 3 * j + 2]; }
    expect(Math.hypot(cx / HOSE.sides - capW.x, cy / HOSE.sides - capW.y, cz / HOSE.sides - capW.z)).toBeLessThan(0.01);
    // a full tank: E on the drum grabs instead (the prompt says why)
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Grab the fuel cart · 1¼ tanks · train tank full/);
  });

  it('an empty cart stops the flow ("Cart empty"); the tank keeps what it got', () => {
    const {h, carts, aimDrum, cartUnits} = setup(1, 0);
    aimDrum();
    press(h, 'KeyE');
    expect(carts.hoseOn).not.toBeNull();
    run(h, 3);
    expect(cartUnits()).toBe(0);
    expect(h.playerTrain.fuel.tank).toBe(1);
    expect(carts.hoseOn).toBeNull();
    expect(h.toasts).toContain(CART_TEXT.empty);
    // an empty cart offers no hose; it stays movable (E grabs)
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Grab the fuel cart · empty/);
    press(h, 'KeyE');
    expect(carts.grab).not.toBeNull();
  });

  it('E again disconnects: the unit in progress is not transferred', () => {
    const {h, carts, aimDrum, cartUnits} = setup(FUEL.cartUnits, 0);
    aimDrum();
    press(h, 'KeyE');
    run(h, FUEL_CART.transferEvery * 1.5); // one unit + half of the next
    expect(h.playerTrain.fuel.tank).toBe(1);
    aimDrum();
    frame(h);
    expect(carts.prompt).toMatch(/Disconnect the hose/);
    press(h, 'KeyE');
    expect(carts.hoseOn).toBeNull();
    expect(h.toasts).toContain(CART_TEXT.disconnected);
    expect(h.sfxCalls).toContain('hose:false');
    run(h, 3);
    expect(h.playerTrain.fuel.tank).toBe(1);
    expect(cartUnits()).toBe(FUEL.cartUnits - 1);
  });

  it('out of the hose reach: no hose offered (E grabs); a connected cart pushed beyond PORT.hoseMax pulls free', () => {
    const far = setup(FUEL.cartUnits, 0, -2.5, PORT.hoseMax + 0.5); // along the platform, beyond the hose's reach
    far.aimDrum();
    frame(far.h);
    expect(far.carts.prompt).toMatch(/Grab the fuel cart/);
    const {h, carts, aimDrum} = setup(FUEL.cartUnits, 0);
    aimDrum();
    press(h, 'KeyE');
    expect(carts.hoseOn).not.toBeNull();
    // the cart rolls away (a shove): beyond the hose's reach it disconnects with nothing more transferred
    const b = carts.bodyOf('cart:test')!;
    b.vz = 2.5 * Math.sign(b.z - h.trainPlacement!.z) || 2.5;
    (carts as unknown as {carts: {awake: boolean}[]}).carts[0].awake = true;
    for (let t = 0; t < 3 && carts.hoseOn; t += DT) { b.vz = 2.5 * Math.sign(b.z - h.trainPlacement!.z); frame(h); }
    expect(carts.hoseOn).toBeNull();
    expect(h.toasts).toContain(CART_TEXT.pulled);
    expect(h.playerTrain.fuel.tank).toBeLessThanOrEqual(1);
  });

  it('grabbing the cart, the train departing and a world teardown disconnect safely', () => {
    // grab (a second E after the disconnect grabs; startGrab itself drops a connected hose)
    {
      const {h, carts, aimDrum, aimHandle} = setup(FUEL.cartUnits, 0);
      aimDrum();
      press(h, 'KeyE');
      aimHandle();
      press(h, 'KeyE'); // (E on the connected cart disconnects first)
      expect(carts.hoseOn).toBeNull();
      aimDrum();
      press(h, 'KeyE');
      expect(carts.hoseOn).not.toBeNull();
      (carts as unknown as {startGrab(c: unknown): void}).startGrab((carts as unknown as {carts: unknown[]}).carts[0]);
      expect(carts.hoseOn).toBeNull();
      expect(carts.grab).not.toBeNull();
    }
    // departure: the player boards and the ride starts -> silently off, nothing more flows
    {
      const {h, carts, aimDrum, ride, p} = setup(FUEL.cartUnits, 0);
      aimDrum();
      press(h, 'KeyE');
      run(h, FUEL_CART.transferEvery + 0.05);
      expect(h.playerTrain.fuel.tank).toBe(1);
      const pose = trainSpawnPose(h.layout!, p);
      h.player.place(pose.x, pose.z, pose.yaw, pose.y);
      void ride.depart();
      expect(ride.riding).toBe(true);
      run(h, 3);
      expect(carts.hoseOn).toBeNull();
      expect(h.playerTrain.fuel.tank).toBe(1);
      ride.reset();
    }
    // teardown
    {
      const {h, carts, aimDrum} = setup(FUEL.cartUnits, 0);
      aimDrum();
      press(h, 'KeyE');
      run(h, 0.5);
      teardown(h);
      expect(carts.hoseOn).toBeNull();
      expect(carts.hose.mesh.visible).toBe(false);
      expect(h.playerTrain.fuel.tank).toBe(0);
    }
  });
});
