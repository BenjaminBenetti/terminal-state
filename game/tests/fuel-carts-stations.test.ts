// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART x the lead's coordinator): the REAL station coordinator
// (world/fuelStations.ts) driving the REAL fuel carts (world/fuelCarts.ts) beside the real parked train, hooks in Game's order (the
// coordinator before the carts): a cart station's plan spawns its cart where the controller can stand it (on the floor, out of every
// wall / prop); the teardown writes it into the station's FUEL_LANE; the next build gives the same cart back (never re-rolled); a cart
// moved into the car leaves the station's record and rides as the train's cargo — exactly once, no ghost.
import {afterEach, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {SectionKey} from '../src/levels/types';
import {moveCircle} from '../src/core/physics';
import {trainToWorld} from '../src/gen/playerTrain';
import {FUEL, FUEL_LANE, stationFuelPlan, stationFuelProblem, type StationFuelJSON} from '../src/fuel/fuel';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {FuelStations} from '../src/world/fuelStations';
import {CART, footprintFloor} from '../src/world/fuelCartPhysics';
import {createRun} from '../src/run/runState';
import {Inventory} from '../src/items/inventory';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import {build, run as runFrames, stationHost, teardown} from './helpers/fuelCartsHost';

installCanvasShim(false);

const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

describe('fuel carts with the station coordinator (real plan realization + FUEL_LANE)', () => {
  it('a cart station: spawned standable, remembered in FUEL_LANE, the same cart on a revisit; moved aboard it becomes cargo once', () => {
    const L = LEVELS.subway.generate('main', {levelSeed: 4242, startWeapon: 'pistol'});
    // a network seed whose plan for st-00 is a cart station (deterministic search)
    let seed = 1;
    while (stationFuelPlan(seed, sid(0)).cart === 0) seed++;
    const camp = fixtureCampaign({current: sid(0), known: [sid(0), sid(1)], visited: [sid(0)]});
    (camp.network as {seed: number}).seed = seed;
    const key: SectionKey = {level: 'subway', section: 'main', station: sid(0)};
    const run = createRun({seeds: SEEDS, start: key, levels: LEVELS, campaign: camp});
    run.memory(key);
    const s = stationHost(L, {build: false});
    live.push(s.rt);
    const {h, carts} = s;
    // (task fuel-feedback: a v2 cart station also has cans — no loot holders in this host, so they come as loose single-can pickups)
    const pickups: {stack: {itemId: string; count: number}; x: number; y: number; z: number}[] = [];
    Object.assign(h, {run, inv: new Inventory(), world: {}, fuelCarts: carts, pickups: {list: pickups, add: (stack: {itemId: string; count: number}, x: number, y: number, z: number) => { pickups.push({stack, x, y, z}); return {}; }}});
    const plan = stationFuelPlan(seed, sid(0));
    const fs = new FuelStations(h as never).install();
    h.sectionHooks.unshift(h.sectionHooks.pop()!); // Game's order: the coordinator's hooks before the carts'
    // first build: the plan is realized — its cart through carts.spawn (before the carts' own build: it waits for it)
    build(h, L);
    expect(fs.last).toMatchObject({station: sid(0), mode: 'plan', cart: true, loose: plan.cans});
    expect(pickups.every(p => p.stack.itemId === FUEL.canItem && p.stack.count === 1)).toBe(true); // one can per pickup
    const uid = `cart:${sid(0)}`;
    expect(carts.all().map(c => [c.uid, c.units, c.owner, c.mode])).toEqual([[uid, FUEL.cartUnits, 'station', 'world']]);
    const b = carts.bodyOf(uid)!;
    expect(footprintFloor(h.levels!, b.x, b.z, b.y)).not.toBeNull(); // standing on walkable floor, not over a ledge
    const [rx, rz] = moveCircle(h.levels!, h.propIndex, b.x, b.z, 0, 0, CART.radius, b.y, CART.height);
    expect(Math.hypot(rx - b.x, rz - b.z)).toBeLessThan(1e-6); // out of every wall / prop / the car
    expect(fs.liveUnits()).toBe(FUEL.cartUnits + plan.cans); // the map's live figure counts the cart outside the car (+ the station's cans)
    runFrames(h, 0.5);
    // teardown: the coordinator writes the record from the carts' live station records
    teardown(h);
    const rec = run.laneStore<StationFuelJSON>(FUEL_LANE, key)!;
    expect(stationFuelProblem(rec)).toBeNull();
    expect(rec.carts.map(c => [c.uid, c.units])).toEqual([[uid, FUEL.cartUnits]]);
    expect(carts.all()).toEqual([]);
    // revisit: realized -> loadStation(rec.carts) -> the same cart at the same pose (no second plan, no duplicate)
    build(h, L);
    expect(fs.last).toMatchObject({mode: 'kept'});
    const again = carts.all();
    expect(again.map(c => c.uid)).toEqual([uid]);
    expect(Math.hypot(again[0].x - rec.carts[0].x, again[0].z - rec.carts[0].z)).toBeLessThan(1e-3);
    // the player wheels it into the car (the walk-in itself: fuel-carts-cargo.test.ts; here it is placed wholly aboard)
    const p = h.trainPlacement!, b2 = carts.bodyOf(uid)!, w = trainToWorld(p, -3, SPEC.floorY, 0.4);
    expect(carts.aboard()).toEqual([]); // (not aboard yet)
    b2.x = w.x; b2.z = w.z; b2.y = p.floorY;
    expect(carts.aboard().map(c => c.uid)).toEqual([uid]);
    teardown(h);
    expect(run.laneStore<StationFuelJSON>(FUEL_LANE, key)!.carts).toEqual([]); // no longer the station's
    expect(h.playerTrain.fuel.toJSON().cargo.map(c => c.uid)).toEqual([uid]); // the train's cargo
    // next build: the station has no cart; the train's cart stands in the parked car (exactly one)
    build(h, L);
    expect(carts.all().map(c => [c.uid, c.owner, c.mode])).toEqual([[uid, 'train', 'world']]);
    expect(fs.liveUnits()).toBe(plan.cans); // fuel aboard is not the station's (its cans still are: this host keeps the pickup list)
  }, 60000);
});
