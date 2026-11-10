// Task studio-fuel-cart-stairs-20261110-004505-01 (the user's final fuel decision: "physical fueling. The player must move the fuel to
// the generator which can be by fuel tank or by cart. Just let the player drag the carts up and down stairs"): END TO END on generated
// Bunkers, the REAL systems together (tests/helpers/bunkerCartWorld.ts: FuelCarts, the station fuel coordinator, the parked train, the
// lift runtime, the Bunker objective, the Player body) and a bot that only does what a player can (tests/helpers/cartBot.ts: look, walk,
// E) — no teleported cart, no direct state writes.
//
// Version 2 (the cargo lift): the station's OWN planned cart (8 quarter units) is dragged from the platform through the vault door's
// threshold and down the real stairs to gen-0, gen-1 and gen-2 BEFORE the lift has power; at each generator the hose gives exactly ONE
// quarter unit (the cart keeps the rest), the key starts it; with all three online the lift has power; the cart then goes back UP a
// stair run, rides the powered lift to the station (held by the player: it never leaves the car floor) and returns to the platform.
// Exactly three units left the cart; nothing else was debited; one cart, one uid. A revisit restores the cart, the paid generators and
// the lift.
// Version 1 (no lift; an entered station's frozen layout): the same cart route by stairs alone; a teardown while the cart stands
// MID-FLIGHT on a stair restores it exactly there (pose, storey, fuel, uid), and the job is finished after it.

import {afterEach, describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {FUEL, FUEL_LANE, stationFuelProblem, type StationFuelJSON} from '../src/fuel/fuel';
import {FUEL_CART} from '../src/world/fuelCarts';
import {CART, flightAt} from '../src/world/fuelCartPhysics';
import {BUNKER_GEN} from '../src/world/bunker/objective';
import {BUNKER_GEN_FUEL_UNITS, BUNKER_LANE, type BunkerStateJSON} from '../src/world/bunker/objectiveState';
import {GEN_PANEL, GEN_USE, genToWorld} from '../src/world/bunker/objectiveViews';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {DT, frame, lookAt} from './helpers/fuelCartsHost';
import {BUNKER_STATION, bunkerCartWorld, cartStationCampaign, type BunkerCartWorld} from './helpers/bunkerCartWorld';

installCanvasShim(false);

const LOG = '/tmp/bunker-cart-fuel-e2e.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, s + '\n');
const UID = `cart:${BUNKER_STATION}`;
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** The world with the station's plan realized: its own cart on the platform storey, the player stepped out beside it. */
function arrive(L: StationLayout): BunkerCartWorld {
  const W = bunkerCartWorld(L, {campaign: cartStationCampaign(), coordinator: true});
  live.push(W.rt);
  expect(W.stations!.last).toMatchObject({station: BUNKER_STATION, mode: 'plan', cart: true});
  expect(W.carts.all().map(c => [c.uid, c.units, c.owner, c.mode, c.level])).toEqual([[UID, FUEL.cartUnits, 'station', 'world', 0]]);
  const b = W.carts.bodyOf(UID)!;
  // (the walk from the car door to the cart is ordinary walking: the player starts a pace behind its handle)
  W.h.player.place(b.x - Math.sin(b.yaw) * 1.0, b.z - Math.cos(b.yaw) * 1.0, b.yaw + Math.PI, b.y);
  frame(W.h);
  return W;
}

/** The cart's place in front of generator i for the hose (left of its panel, clear of where the operator stands). */
const hoseSpot = (W: BunkerCartWorld, i: number) => genToWorld(W.objective.info!.generators[i], {x: -0.4, y: 0, z: 1.75});

/** Drag the cart to generator i, hose ONE unit into it, start it with the key. Returns the drag's stats. */
function fuelAndStart(W: BunkerCartWorld, i: number) {
  const {bot, carts, objective, h} = W;
  const gen = objective.info!.generators[i], before = carts.bodyOf(UID)!.units, spot = hoseSpot(W, i);
  const r = bot.dragTo(UID, spot.x, gen.y, spot.z, {arrive: 0.6});
  log(`  ${gen.id} (storey ${gen.level}): drag ok ${r.ok} ${r.t.toFixed(0)} s, forced let-go ${r.forcedLetGo}, cart y ${r.yMin.toFixed(2)} .. ${r.yMax.toFixed(2)} ${r.why ?? ''}`);
  expect(r.ok, `${gen.id}: ${r.why}`).toBe(true);
  expect(carts.bodyOf(UID)!.level).toBe(gen.level);
  expect(Math.abs(carts.bodyOf(UID)!.y - gen.y)).toBeLessThan(0.02);
  // the hose: let go, aim at the drum, E — it picks this generator (in reach, needs fuel)
  expect(objective.genState(i)).toBe('off');
  expect(bot.connectHose(UID), `${gen.id}: hose`).toBe(true);
  expect(carts.hoseOn?.target?.id).toBe(`bunker:${gen.id}`);
  // nothing moves before the transfer tick; then exactly ONE unit, both sides at once, and the hose lets go by itself
  bot.wait(FUEL_CART.transferEvery - 0.3);
  expect(carts.all()[0].units).toBe(before);
  bot.wait(0.6);
  expect(carts.all()[0].units).toBe(before - BUNKER_GEN_FUEL_UNITS);
  expect(objective.state!.fuel[gen.id]).toBe(BUNKER_GEN_FUEL_UNITS);
  expect(objective.genState(i)).toBe('fuelled');
  expect(carts.hoseOn).toBeNull();
  bot.wait(3); // (no second unit, no whole-cart drain)
  expect(carts.all()[0].units).toBe(before - BUNKER_GEN_FUEL_UNITS);
  // the key: the operator's place in front of the panel, hold E
  const use = genToWorld(gen, {x: GEN_USE.x, y: 0, z: GEN_USE.z});
  expect(bot.walkTo(use.x, gen.y, use.z, 0.4, 60), `${gen.id}: walk to the panel`).toBe(true);
  const panel = genToWorld(gen, {x: GEN_PANEL.cx, y: GEN_PANEL.cy, z: GEN_PANEL.frontZ});
  lookAt(h, panel.x, panel.y, panel.z);
  frame(h);
  h.keys.held.add('KeyE'); h.keys.hits.add('KeyE');
  for (let t = 0; t < BUNKER_GEN.HOLD_S + 0.4; t += DT) frame(h);
  h.keys.held.delete('KeyE');
  expect(objective.genState(i), `${gen.id}: key`).toBe('online');
  expect(carts.grab).toBeNull();
  return r;
}

describe('Bunker v2: the station cart fuels all three generators by stairs before the lift has power', () => {
  it('platform -> vault threshold -> stairs -> gen-0 / gen-1 / gen-2: one quarter unit each by hose (3 total), keys, lift power; back up a stair and by lift', () => {
    const L = generateBunkerLevel({levelSeed: 9001});
    expect(L.bunker!.version).toBe(2);
    const W = arrive(L);
    const {carts, bot, objective, tower, h, harness} = W;
    const home = {...carts.bodyOf(UID)!};
    const tank0 = h.playerTrain.fuel.tank;
    log(`v2 seed 9001: the cart starts at ${home.x.toFixed(2)}, ${home.y.toFixed(2)}, ${home.z.toFixed(2)} (storey 0)`);
    // before anything: no power, no cans in hand (the three units can only come through the hose), the lift refuses
    expect(tower.liftPower!.on()).toBe(false);
    expect(harness.inv.count(FUEL.canItem)).toBe(0);
    const e = tower.office!.elevator!;
    expect(Math.abs(e.logic.y)).toBe(0); // the car stands at the station
    let letGo = 0;
    const r0 = fuelAndStart(W, 0);
    expect(r0.yMax).toBeGreaterThan(0.8); // (over the vault door's 0.84 m threshold)
    expect(tower.liftPower!.on()).toBe(false);
    const r1 = fuelAndStart(W, 1);
    expect(tower.liftPower!.on()).toBe(false);
    const r2 = fuelAndStart(W, 2);
    letGo = r0.forcedLetGo + r1.forcedLetGo + r2.forcedLetGo;
    // --- the whole job: exactly three units out of the cart, nothing else touched, the lift powered by the generators ---
    expect(carts.all().map(c => [c.uid, c.units])).toEqual([[UID, FUEL.cartUnits - 3 * BUNKER_GEN_FUEL_UNITS]]);
    expect(carts.counts.transfers).toBe(3);
    expect(objective.state!.fuel).toEqual({'gen-0': 1, 'gen-1': 1, 'gen-2': 1});
    expect(objective.state!.gens).toEqual({'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'});
    expect(h.playerTrain.fuel.tank).toBe(tank0);
    expect(harness.inv.count(FUEL.canItem)).toBe(0);
    expect(tower.liftPower!.on()).toBe(true);
    expect(Math.abs(e.logic.y)).toBe(0); // (the car never moved: every metre down was stairs)
    expect(letGo, 'the game never tore the cart out of the player\'s hands on the way down').toBe(0);
    // --- back UP a stair run: storey 4 -> the lift landing on storey 3 ---
    const stop3 = e.plan.info.stops.find(s => s.floor === 3)!, G = e.plan.gate;
    const landing = {x: stop3.landing.x, z: stop3.landing.z - 1.2};
    const up = bot.dragTo(UID, landing.x, stop3.y, landing.z, {arrive: 0.7});
    log(`  up the stairs to the storey-3 lift landing: ok ${up.ok} ${up.t.toFixed(0)} s, forced let-go ${up.forcedLetGo}, cart y ${up.yMin.toFixed(2)} .. ${up.yMax.toFixed(2)} ${up.why ?? ''}`);
    expect(up.ok, up.why).toBe(true);
    expect(up.yMin).toBeCloseTo(-28, 1);
    expect(carts.bodyOf(UID)!.y).toBeCloseTo(-21, 2);
    expect(carts.bodyOf(UID)!.level).toBe(3);
    expect(up.forcedLetGo).toBe(0);
    // --- the powered lift: call it, wheel the cart in, ride to the station holding it ---
    expect(tower.callFloor(3)).toBe(true);
    const i3 = e.plan.info.stops.indexOf(stop3);
    for (let t = 0; t < 120 && !(e.logic.stop === i3 && e.gate.open); t += DT) frame(h);
    expect(e.gate.open).toBe(true);
    bot.cache.clear(); // (the gate is open now: routes through it exist)
    const cab = e.plan.info.cab, inCar = {x: (cab.x0 + cab.x1) / 2, z: cab.z0 + 0.72 * (cab.z1 - cab.z0)};
    const into = bot.dragTo(UID, inCar.x, stop3.y, inCar.z, {arrive: 0.5});
    expect(into.ok, into.why).toBe(true);
    expect(tower.playerInCab()).toBe(true);
    expect(tower.panelPick(0)).toBe(true);
    const i0 = e.plan.info.stops.findIndex(s => s.floor === 0);
    let moved = false, worst = 0;
    for (let t = 0; t < 180 && !(moved && e.logic.stop === i0 && e.gate.open); t += DT) {
      frame(h);
      if (e.logic.moving) moved = true;
      const c = carts.bodyOf(UID)!;
      worst = Math.max(worst, Math.abs(c.y - e.logic.y)); // the cart stays ON the car floor the whole ride (held or not)
      expect(c.x > cab.x0 && c.x < cab.x1 && c.z > cab.z0 && c.z < cab.z1).toBe(true);
    }
    log(`  lift 3 -> station with the cart ${carts.grab ? 'held' : 'standing'}: worst cart / car floor gap ${(worst * 100).toFixed(1)} cm`);
    expect(moved).toBe(true);
    expect(worst).toBeLessThan(0.04);
    expect(carts.bodyOf(UID)!.y).toBeCloseTo(0, 3);
    expect(carts.bodyOf(UID)!.level).toBe(0);
    void G;
    // --- out of the car, through the vault door, back to where it stood on the platform ---
    bot.cache.clear();
    const back = bot.dragTo(UID, home.x, home.y, home.z, {arrive: 0.9});
    log(`  back to the platform: ok ${back.ok} ${back.t.toFixed(0)} s, forced let-go ${back.forcedLetGo} ${back.why ?? ''}`);
    expect(back.ok, back.why).toBe(true);
    bot.letGo();
    expect(carts.all().map(c => [c.uid, c.units, c.owner, c.level])).toEqual([[UID, 5, 'station', 0]]);
    // --- leave and come back: the cart, its fuel, the paid generators and the lift are all as they were left ---
    const at = {...carts.bodyOf(UID)!};
    W.teardown();
    const key = harness.run.current;
    const rec = harness.run.laneStore<StationFuelJSON>(FUEL_LANE, key)!;
    expect(stationFuelProblem(rec)).toBeNull();
    expect(rec.carts.map(c => [c.uid, c.units, c.level])).toEqual([[UID, 5, 0]]);
    const st = harness.run.laneStore<BunkerStateJSON>(BUNKER_LANE, key)!;
    expect(st.fuel).toEqual({'gen-0': 1, 'gen-1': 1, 'gen-2': 1});
    expect(st.lift).toEqual({stop: 0});
    W.build();
    expect(W.stations!.last).toMatchObject({mode: 'kept'});
    expect(carts.all().map(c => [c.uid, c.units, c.level])).toEqual([[UID, 5, 0]]);
    const again = carts.bodyOf(UID)!;
    expect(Math.hypot(again.x - at.x, again.z - at.z)).toBeLessThan(1e-3);
    expect(objective.state!.gens).toEqual({'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'});
    expect(tower.liftPower!.on()).toBe(true);
  }, 420_000);
});

describe('Bunker v1 (an entered station\'s frozen layout, no lift): the same job by stairs alone; a cart saved mid-flight comes back there', () => {
  it('platform -> stairs -> three generators by hose (3 units); a teardown with the cart on a stair restores pose, storey, fuel and uid', () => {
    const L = generateBunkerLevel({levelSeed: 9001, layoutVersion: 1});
    expect(L.bunker!.version).toBe(1);
    expect(L.bunker!.lift).toBeUndefined();
    const W = arrive(L);
    const {carts, bot, objective, tower, h, harness} = W;
    expect(tower.office).toBeNull(); // no lift at all
    const home = {...carts.bodyOf(UID)!};
    log(`v1 seed 9001: the cart starts at ${home.x.toFixed(2)}, ${home.y.toFixed(2)}, ${home.z.toFixed(2)} (storey 0)`);
    // --- down to the middle of the first stair run and STOP there: let go on the steps ---
    const run01 = L.levelLinks.find(k => k.kind === 'stairs' && k.upper === 0 && k.lower === 1)!;
    const mid = {x: (run01.top.x + run01.bottom.x) / 2, y: (run01.top.y + run01.bottom.y) / 2, z: (run01.top.z + run01.bottom.z) / 2};
    const half = bot.dragTo(UID, mid.x, mid.y, mid.z, {arrive: 0.6});
    expect(half.ok, half.why).toBe(true);
    bot.letGo();
    bot.wait(1.5);
    const onStair = {...carts.bodyOf(UID)!}, pose = carts.poseOf(UID)!;
    expect(flightAt(h.levels!, onStair.x, onStair.z, onStair.y)).not.toBeNull(); // standing on a flight
    expect(onStair.y).toBeLessThan(-0.5);
    expect(onStair.y).toBeGreaterThan(-6.5);
    expect(Math.hypot(onStair.vx, onStair.vz)).toBe(0); // at rest on the steps
    expect(Math.abs(pose.pitch) + Math.abs(pose.roll)).toBeGreaterThan(0.3); // drawn lying on the stair's slope
    // --- the world goes (a departure) and comes back: the cart is where it was left, exactly once, with its fuel ---
    W.teardown();
    const key = harness.run.current;
    const rec = harness.run.laneStore<StationFuelJSON>(FUEL_LANE, key)!;
    expect(stationFuelProblem(rec)).toBeNull();
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
    expect(rec.carts).toHaveLength(1);
    expect(rec.carts[0]).toMatchObject({uid: UID, units: FUEL.cartUnits});
    expect(rec.carts[0].y).toBeCloseTo(onStair.y, 3);
    W.build();
    expect(carts.all().map(c => [c.uid, c.units])).toEqual([[UID, FUEL.cartUnits]]);
    const again = carts.bodyOf(UID)!, pose2 = carts.poseOf(UID)!;
    expect(Math.hypot(again.x - onStair.x, again.z - onStair.z)).toBeLessThan(1e-3);
    expect(again.y).toBeCloseTo(onStair.y, 3);
    expect(again.level).toBe(onStair.level);
    expect(again.yaw).toBeCloseTo(onStair.yaw, 3);
    expect(pose2.pitch).toBeCloseTo(pose.pitch, 2);
    expect(pose2.dy).toBeCloseTo(pose.dy, 2);
    // --- and the job from there: the player walks down to it, takes it on to the three generators ---
    const P = h.player;
    P.place(onStair.x - Math.sin(onStair.yaw) * 1.0, onStair.z - Math.cos(onStair.yaw) * 1.0, onStair.yaw + Math.PI, h.levels!.supportAt(onStair.x - Math.sin(onStair.yaw) * 1.0, onStair.z - Math.cos(onStair.yaw) * 1.0, onStair.y + 1)?.floor ?? onStair.y);
    frame(h);
    let letGo = 0;
    for (const i of [0, 1, 2]) letGo += fuelAndStart(W, i).forcedLetGo;
    expect(carts.all().map(c => [c.uid, c.units])).toEqual([[UID, FUEL.cartUnits - 3]]);
    expect(objective.state!.gens).toEqual({'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'});
    expect(objective.state!.fuel).toEqual({'gen-0': 1, 'gen-1': 1, 'gen-2': 1});
    expect(carts.counts.transfers).toBe(3);
    expect(letGo).toBe(0);
    // --- all the way back up the stairs to the platform ---
    const back = bot.dragTo(UID, home.x, home.y, home.z, {arrive: 0.9});
    log(`  back up to the platform by stairs: ok ${back.ok} ${back.t.toFixed(0)} s, forced let-go ${back.forcedLetGo}, cart y ${back.yMin.toFixed(2)} .. ${back.yMax.toFixed(2)} ${back.why ?? ''}`);
    expect(back.ok, back.why).toBe(true);
    expect(back.yMin).toBeCloseTo(-28, 1);
    expect(carts.bodyOf(UID)!.level).toBe(0);
    expect(back.forcedLetGo).toBe(0);
    void CART;
  }, 420_000);
});
