// Lane CARGO (user: "Backpacks must be placeable aboard the train and travel with it like other items, retaining contents and identity. Fix
// normal item/cargo behavior rather than adding a backpack-only exception."): the REAL GearSystem (key 6 + click set-down, E tap / hold)
// on a generated station with the REAL PlayerTrainRuntime, TrainRide, Player, PickupManager, Inventory and TrainCargoSystem, installed in
// Game's order (the gear's section hook first, the cargo's teardown before it and its build last).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {worldToTrain} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PickupManager} from '../src/world/pickups';
import {Inventory, stackToJSON, type ItemStack} from '../src/items/inventory';
import {BACKPACK_SLOTS} from '../src/items/gear';
import {BASE_MODIFIERS} from '../src/player/modifiers';
import {installGear, type GearSystem} from '../src/gear/system';
import {MemoryBagStore} from '../src/gear/bagStore';
import {TrainCargoSystem} from '../src/world/trainCargo';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {build, frame, stationHost} from './helpers/fuelCartsHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** stationHost + the real GearSystem (Game: installed before the train / ride; its section hook first) + the cargo system. */
function world(L = SUBWAY()) {
  const s = stationHost(L, {build: false});
  live.push(s.rt);
  const h = s.h as typeof s.h & Record<string, unknown>;
  const inv = new Inventory(), pickups = new PickupManager({});
  h.scene.add(pickups.group);
  const mouse = [false, false, false], mousePressed = [false, false, false];
  const input = {
    onLockChange: (_l: boolean) => {}, get clears() { return s.h.keys.clears; }, mouse, mousePressed, wheel: 0, locked: true,
    hit: (c: string) => s.h.keys.hit(c), down: (c: string) => s.h.keys.down(c), unlock() {}, lock: () => Promise.resolve(true),
  };
  Object.assign(h.sfx as object, {equip() {}, pickup() {}, search() {}});
  Object.assign(h, {
    inv, pickups, input, qa: true, syncHeld() {}, invUI: {gear: null}, weapon: {handling: 1, stack: null, equip() {}}, mods: {...BASE_MODIFIERS},
    consumeView: {busy: false}, viewmodel: {setItem() {}}, flareHold: {active: false, cancel: () => false},
  });
  const rules = (h.gear as {placeRules: ((x: number, y: number, z: number, level: number) => string | null)[]}).placeRules; // (the ride's rule)
  const gear: GearSystem = installGear(h as never);
  gear.setStore(new MemoryBagStore());
  for (const r of rules) gear.placeRules.push(r);
  h.gear = gear;
  h.sectionHooks.unshift(h.sectionHooks.pop()!); // (Game: the gear's section hook runs before the train's)
  const cargo = new TrainCargoSystem(h as never).install();
  build(h as never, L);
  /** One frame with the left mouse button pressed. */
  const click = () => { mouse[0] = true; mousePressed[0] = true; frame(s.h); mousePressed[0] = false; mouse[0] = false; frame(s.h); };
  return {...s, h, inv, pickups, gear, cargo, click, mouse, mousePressed};
}

type W = ReturnType<typeof world>;

/** A worn backpack with contents (the same stack object throughout). */
function wearLoadedBag(w: W): ItemStack {
  const inv = w.inv, bag = inv.makeStack('backpack', 1);
  bag.bag = new Array(BACKPACK_SLOTS).fill(null);
  const water = inv.makeStack('water', 3);
  water.count = 3;
  bag.bag[0] = water;
  bag.bag[4] = inv.makeStack('pistol', 1, 6);
  bag.bag[BACKPACK_SLOTS - 1] = inv.makeStack('bandage', 1);
  expect(inv.add(bag)).toBe(0);
  expect(inv.wornBag()).toBe(bag);
  return bag;
}

/** Face along the car (train-local yaw +-90 degrees) from the spawn, looking down at the floor, until the set-down has a spot. */
function faceAlongCar(w: W): string | object {
  const p = w.h.trainPlacement!;
  let last: string | object = 'no yaw tried';
  for (const k of [0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 1]) {
    w.h.player.yaw = p.yaw + k * Math.PI;
    w.h.player.pitch = -0.4;
    frame(w.h);
    last = w.gear.placeSpot();
    if (typeof last !== 'string') return last;
  }
  return last;
}

describe('train bag cargo: a backpack set down aboard', () => {
  it('6 + click inside the parked car sets the bag down on the car floor (the train\'s by the cargo rule)', () => {
    const w = world(), bag = wearLoadedBag(w);
    const spot = faceAlongCar(w);
    expect(typeof spot, `refused: ${String(spot)}`).toBe('object');
    w.h.keys.hits.add('Digit6');
    frame(w.h);
    expect(w.gear.readied).toBe(true);
    w.click();
    expect(w.inv.wornBag()).toBeNull();
    expect(w.gear.bags.map(b => b.stack)).toEqual([bag]);
    const b = w.gear.bags[0];
    expect(b.id).toBe(`bag:${bag.uid}`);
    const q = worldToTrain(w.h.trainPlacement!, b.pose.x, b.pose.y, b.pose.z);
    expect(Math.abs(q.y - SPEC.floorY)).toBeLessThan(0.02);
    expect(w.cargo.ownsBag(b)).toBe(true);
    void THREE; void stackToJSON;
  });
});
