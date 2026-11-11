// Lane CARGO (user: "Backpacks must be placeable aboard the train and travel with it like other items, retaining contents and identity. Fix
// normal item/cargo behavior rather than adding a backpack-only exception."): the REAL GearSystem (key 6 + click set-down, the Tab drag-out,
// E tap = open / hold = wear) on a generated station with the REAL PlayerTrainRuntime, TrainRide, Player, PickupManager, Inventory and
// TrainCargoSystem, installed in Game's order (the gear's hooks before the train's; the cargo's teardown first and its build last).
// The defect: the set-down treated every dynamic volume as the moving lift cab, and the parked car's interior IS a dynamic volume — a
// backpack could never be set down aboard ("Not inside the elevator"), so it could never become the train's cargo. Now the car's floor is
// a carrier (world/trainCargo.ts carries): a bag set down inside it is the train's by the ordinary cargo rule and rides the ordinary
// cargo path (capture -> riding -> release / pending -> the 'player-train' participant's `cargo` record).
//  - placement: every accepted spot aboard lies inside the car (clear of its walls, partitions, console, Lockbox, chipper) and is the
//    train's; a lift cab still refuses;
//  - a whole journey: same stack object, same bag id, same contents; it opens (same contents) and is worn again at the next station;
//    nothing left at the old station, nothing doubled;
//  - saves: mid-ride save -> load (same session and a fresh host): exactly one bag, same id / contents; reload idempotent;
//  - a bag left on the platform stays at that station (and is still there on the way back);
//  - old saves: a v1 cargo record with a bag loads it; a save without `cargo` loads none and leaves the station bags alone.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {buildRideLocalModel, RIDE_FRAME} from '../src/world/trainRideLocal';
import {PickupManager} from '../src/world/pickups';
import {Inventory, stackFromJSON, stackToJSON, stacksIn, type ItemStack, type StackJSON} from '../src/items/inventory';
import {BACKPACK_SLOTS} from '../src/items/gear';
import {BASE_MODIFIERS} from '../src/player/modifiers';
import {installGear, type GearSystem} from '../src/gear/system';
import {MemoryBagStore, readSectionBags} from '../src/gear/bagStore';
import {TrainCargoSystem} from '../src/world/trainCargo';
import {cargoProblem, type CargoItemJSON, type TrainCargoJSON} from '../src/run/trainCargo';
import type {DynamicVolume} from '../src/gen/levels';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {build, frame, lookAt, run, stationHost, syncCamera, teardown} from './helpers/fuelCartsHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const OFFICE = () => lay('office', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const LIFT_TEXT = /elevator/;

/** stationHost + the real GearSystem (Game: installed before the train / ride; its hooks first) + the cargo system. */
function world(L = SUBWAY(), o: {build?: boolean} = {}) {
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
  const lists = [h.sectionHooks, h.frameHooks, h.interactHandlers, h.promptProviders] as unknown[][];
  const before = lists.map(l => l.length);
  const gear: GearSystem = installGear(h as never);
  lists.forEach((l, k) => { const mine = l.splice(before[k]); l.unshift(...mine); }); // (Game order: the gear's hooks before the train's)
  gear.setStore(new MemoryBagStore());
  for (const r of rules) gear.placeRules.push(r);
  h.gear = gear;
  const cargo = new TrainCargoSystem(h as never).install();
  // (the transfer view's panel is DOM only; the canvas shim's document makes canvases alone — the session / quick / move are the real ones)
  (gear.bagView as unknown as {show(): void}).show = () => {};
  if (o.build !== false) build(h as never, L);
  /** One frame with the left mouse button pressed. */
  const click = () => { mouse[0] = true; mousePressed[0] = true; frame(s.h); mousePressed[0] = false; mouse[0] = false; frame(s.h); };
  return {...s, h, L, inv, pickups, gear, cargo, click};
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

/** A bag's contents by slot (exact stacks), independent of the slot count. */
const contents = (bag: {bag?: (ItemStack | StackJSON | null)[] | null}) => (bag.bag ?? []).flatMap((s, i) => (s ? [[i, stackToJSON(s as ItemStack)]] : []));

/** From the player's pose, the first yaw (along the car first) whose set-down has a spot; the spot or the last refusal. */
function faceForSpot(w: W, yaws = [0.5, -0.5, 0.25, -0.25, 0.75, -0.75, 1, 0]): string | {x: number; y: number; z: number} {
  const p = w.h.trainPlacement!;
  let last: string | {x: number; y: number; z: number} = 'no yaw tried';
  for (const k of yaws) {
    w.h.player.yaw = p.yaw + k * Math.PI;
    w.h.player.pitch = -0.4;
    syncCamera(w.h);
    last = w.gear.placeSpot();
    if (typeof last !== 'string') return last;
  }
  return last;
}

/** 6 (ready) + left click (set down): the bag that was set down. */
function setDown(w: W): void {
  w.h.keys.hits.add('Digit6');
  frame(w.h);
  expect(w.gear.readied).toBe(true);
  w.click();
}

/** Stand next to a grounded bag in the car (within reach), look at it and HOLD E: picked up and worn (the gear's hold path). */
function holdWear(w: W, b: {centre: THREE.Vector3; pose: {x: number; y: number; z: number}}): void {
  const {h} = w, p = h.trainPlacement!, I = SPEC.interior;
  if (Math.hypot(h.player.x - b.pose.x, h.player.z - b.pose.z) > 1.5) {
    const q = worldToTrain(p, b.pose.x, b.pose.y, b.pose.z);
    const lx = q.x + 0.8 < I.x1 - 0.4 ? q.x + 0.8 : q.x - 0.8, s = trainToWorld(p, lx, SPEC.floorY, q.z);
    h.player.spawn(s.x, s.z, p.yaw, s.y);
  }
  lookAt(h, b.centre.x, b.centre.y, b.centre.z);
  frame(h);
  h.keys.held.add('KeyE');
  h.keys.hits.add('KeyE');
  run(h, 0.7, () => !!w.inv.wornBag());
  h.keys.held.delete('KeyE');
}

/** Every uid of the run once: inventory, the train's cargo, the live section's bags not aboard, every section record in the bag store. */
function census(w: W): number[] {
  w.gear.flush();
  const recs = Object.values(w.gear.store.toJSON()).flatMap(r => (r as {bags?: {stack: StackJSON}[]}).bags ?? []);
  const ids = [
    ...w.inv.allStacks(true).map(s => s.uid),
    ...w.cargo.cargo().flatMap(r => stacksIn(stackFromJSON(r.stack)).map(s => s.uid)),
    ...w.gear.bags.filter(b => !w.cargo.ownsBag(b) && !recs.some(r => r.stack.uid === b.stack.uid)).flatMap(b => stacksIn(b.stack).map(s => s.uid)),
    ...recs.flatMap(r => stacksIn(stackFromJSON(r.stack)).map(s => s.uid)),
  ].sort((a, b) => a - b);
  expect(new Set(ids).size, `duplicate uid in ${ids}`).toBe(ids.length);
  return ids;
}

/** Points on the platform floor beside the parked car (outside it), nearest first. */
function platformPoints(w: W, ds = [1.2, 1.6, 2.0, 2.6, 3.2]): {x: number; y: number; z: number}[] {
  const p = w.h.trainPlacement!, out: {x: number; y: number; z: number}[] = [];
  for (const d of ds) for (const lx of [0, -2, 2, -4, 4]) {
    const wp = trainToWorld(p, lx, SPEC.floorY, -(SPEC.width / 2 + d));
    const s = w.h.levels!.supportIn(wp.x, wp.z, wp.y + 0.3);
    if (s && !s.volume && Math.abs(s.floor - wp.y) <= 0.4) out.push({x: wp.x, y: s.floor, z: wp.z});
  }
  return out;
}

/** The bags the store keeps for a section (its seed). */
const stored = (w: W, section: string, L: StationLayout) => readSectionBags(w.gear.store.load(section), L.seed)?.bags ?? [];

/** Depart, run to the transit, tear the old world down (the ride keeps the car), build `next` while riding, arrive and stop. */
async function journey(w: W, next: StationLayout, mid?: () => void): Promise<void> {
  const {h, ride} = w;
  let dep: {status: string} | null = null;
  void ride.depart().then(r => { dep = r; });
  run(h, 80, () => ride.phase === 'transit');
  expect(ride.phase, `departure: ${JSON.stringify(dep)}`).toBe('transit');
  teardown(h);
  w.pickups.clear();
  mid?.();
  build(h, next, false);
  let arr: {status: string} | null = null;
  void ride.arrive().then(r => { arr = r; });
  run(h, 150, () => !ride.riding);
  await Promise.resolve();
  expect(arr).toMatchObject({status: 'stopped'});
  run(h, 0.1);
}

describe('train bag cargo: setting a backpack down aboard the parked train', () => {
  it('6 + click inside the parked car sets the bag down on the car floor — the same stack and bag id, the train\'s by the cargo rule', () => {
    const w = world(), bag = wearLoadedBag(w);
    const spot = faceForSpot(w);
    expect(typeof spot, `refused: ${String(spot)}`).toBe('object');
    setDown(w);
    expect(w.inv.wornBag()).toBeNull();
    expect(w.gear.bags.map(b => b.stack)).toEqual([bag]);
    const b = w.gear.bags[0];
    expect(b.id).toBe(`bag:${bag.uid}`);
    const q = worldToTrain(w.h.trainPlacement!, b.pose.x, b.pose.y, b.pose.z);
    expect(Math.abs(q.y - SPEC.floorY)).toBeLessThan(0.02);
    expect(w.cargo.ownsBag(b)).toBe(true);
    // the station's bag record leaves it out (the train saves it), the train's cargo lists it with its id and contents
    expect(w.gear.record().bags).toEqual([]);
    const recs = w.cargo.cargo().filter(r => r.kind === 'bag');
    expect(recs.map(r => [r.id, r.stack.uid])).toEqual([[b.id, bag.uid]]);
    expect(contents(recs[0].stack)).toEqual(contents(bag));
  });

  it('the Tab drag-out (placeFromInventory) follows the same rule aboard', () => {
    const w = world(), bag = wearLoadedBag(w);
    expect(typeof faceForSpot(w)).toBe('object');
    expect(w.gear.placeFromInventory()).toBeNull();
    expect(w.gear.bags.map(b => b.stack)).toEqual([bag]);
    expect(w.cargo.ownsBag(w.gear.bags[0])).toBe(true);
  });

  it('every accepted spot aboard lies inside the car, clear of its walls / partitions / console / Lockbox / chipper and not through one; facing a wall up close is refused (no lift text)', () => {
    const w = world();
    wearLoadedBag(w);
    const p = w.h.trainPlacement!, I = SPEC.interior, r = 0.15 - 1e-3;
    const model = buildRideLocalModel(SPEC, w.rt.consoleRect);
    const fixtures = Object.entries(model.named).filter(([name]) => name !== 'console' || !!w.rt.consoleRect).map(([name, b]) => ({name, x: b.x - RIDE_FRAME.ox, z: b.z - RIDE_FRAME.oz, hx: b.hx, hz: b.hz}));
    const inFixture = (x: number, z: number, rr: number) => fixtures.find(f => Math.abs(x - f.x) < f.hx + rr && Math.abs(z - f.z) < f.hz + rr)?.name ?? null;
    let accepted = 0, refused = 0;
    const texts = new Set<string>();
    for (let lx = I.x0 + 0.35; lx < I.x1 - 0.3; lx += 0.5) for (let lz = -I.halfWidth + 0.32; lz <= I.halfWidth - 0.32; lz += 0.3) {
      if (inFixture(lx, lz, 0.3)) continue; // (the player cannot stand there)
      const wp = trainToWorld(p, lx, SPEC.floorY, lz);
      w.h.player.spawn(wp.x, wp.z, p.yaw, wp.y);
      for (let k = 0; k < 8; k++) {
        w.h.player.yaw = p.yaw + (k / 8) * Math.PI * 2;
        w.h.player.pitch = -0.4;
        syncCamera(w.h);
        const s = w.gear.placeSpot();
        if (typeof s === 'string') { refused++; texts.add(s); continue; }
        accepted++;
        const q = worldToTrain(p, s.x, s.y, s.z);
        expect(q.x > I.x0 + r && q.x < I.x1 - r && Math.abs(q.z) < I.halfWidth - r, `spot ${q.x.toFixed(2)},${q.z.toFixed(2)} outside the car`).toBe(true);
        expect(Math.abs(q.y - SPEC.floorY)).toBeLessThan(0.02);
        expect(inFixture(q.x, q.z, r), `spot ${q.x.toFixed(2)},${q.z.toFixed(2)} in a fixture`).toBeNull();
        for (let t = 0.1; t < 1; t += 0.1) expect(inFixture(lx + (q.x - lx) * t, lz + (q.z - lz) * t, 0), 'set down through a fixture').toBeNull();
        expect(w.cargo.carries(w.h.levels!.supportIn(s.x, s.z, s.y + 0.05)!.volume, s.x, s.y, s.z)).toBe(true);
      }
    }
    expect(accepted).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(20); // (facing a wall / a fixture up close)
    for (const t of texts) expect(t).not.toMatch(LIFT_TEXT);
  });

  it('a lift cab (a dynamic volume with stops, no carrier) still refuses the set-down', () => {
    const w = world();
    const bag = wearLoadedBag(w);
    const sp = w.h.player, L = w.h.levels!, p = w.h.trainPlacement!;
    // a lift cab on the platform floor beside the car (its footprint clear of the car's volume)
    const at = platformPoints(w, [3.2, 2.6])[0], floor = at.y;
    expect(at).toBeTruthy();
    expect(w.cargo.carries(null, at.x, floor, at.z)).toBeNull();
    const c = (v: number) => Math.floor(v / 0.5) * 0.5;
    const cab: DynamicVolume = {x0: c(at.x) - 1, z0: c(at.z) - 1, x1: c(at.x) + 1.5, z1: c(at.z) + 1.5, floorY: floor, ceilY: floor + 2.6, level: L.supportIn(at.x, at.z, floor + 0.05)!.level, gates: [], stops: [floor, floor + 4], name: 'elevator-cab'};
    for (const [x, z] of [[cab.x0, cab.z0], [cab.x1, cab.z0], [cab.x0, cab.z1], [cab.x1, cab.z1]]) expect(Math.abs(worldToTrain(p, x, floor, z).z)).toBeGreaterThan(SPEC.width / 2 + 0.5); // (not the car)
    L.addDynamicVolume(cab);
    try {
      sp.spawn(c(at.x) + 0.25, c(at.z) + 0.25, 0, floor);
      syncCamera(w.h);
      expect(L.supportIn(sp.x, sp.z, sp.y + 0.05)?.volume).toBe(cab);
      expect(w.cargo.carries(cab, sp.x, floor, sp.z)).toBeNull();
      expect(w.gear.placeSpot()).toMatch(LIFT_TEXT);
      expect(w.gear.placeFromInventory()).toMatch(LIFT_TEXT);
      expect(w.inv.wornBag()).toBe(bag);
    } finally { L.removeDynamicVolume(cab); }
  });
});

describe('train bag cargo: the bag travels with the train', () => {
  it('set down aboard, filled, ridden to the next station: the same bag (stack, id, contents) lies in the new car, opens with the same contents and is worn again; nothing left behind, nothing doubled', async () => {
    const A = SUBWAY(), B = OFFICE();
    const w = world(A), {h, gear, cargo, inv} = w;
    const bag = wearLoadedBag(w);
    const med = inv.makeStack('medkit', 1);
    inv.add(med);
    expect(typeof faceForSpot(w)).toBe('object');
    setDown(w);
    const b0 = gear.bags[0], id = b0.id;
    const local0 = worldToTrain(h.trainPlacement!, b0.pose.x, b0.pose.y, b0.pose.z), yaw0 = b0.pose.yaw - h.trainPlacement!.yaw;
    // open it (tap E) and put the med kit in through the real transfer view
    lookAt(h, b0.centre.x, b0.centre.y, b0.centre.z);
    frame(h);
    expect(gear.target).toBe(b0);
    h.keys.hits.add('KeyE');
    frame(h);
    expect(gear.viewOpen).toBe(true);
    expect(gear.bagView.quick(inv.find(med.uid)!)).toBe(1);
    expect(bag.bag!.some(s => s === med)).toBe(true);
    gear.close('user');
    const want = contents(bag), uids = census(w);
    // the ride: captured at the doors closing, riding the car's view through the teardown of A and the build of B
    await journey(w, B, () => {
      expect(cargo.riding.map(r => [r.kind, r.id, r.stack])).toEqual([['bag', id, bag]]);
      expect(gear.bags).toEqual([]);
      expect(stored(w, 'subway:main', A)).toEqual([]); // the old station keeps no copy
    });
    // stopped at B: an ordinary grounded bag in B's parked car again — the same stack object, id, contents, train-local pose
    expect(cargo.riding).toEqual([]);
    expect(gear.bags.length).toBe(1);
    const b = gear.bags[0];
    expect(b.stack).toBe(bag);
    expect(b.id).toBe(id);
    expect(contents(b.stack)).toEqual(want);
    expect(cargo.ownsBag(b)).toBe(true);
    const local1 = worldToTrain(h.trainPlacement!, b.pose.x, b.pose.y, b.pose.z);
    expect(Math.hypot(local1.x - local0.x, local1.y - local0.y, local1.z - local0.z)).toBeLessThan(1e-4);
    expect(Math.abs(Math.atan2(Math.sin(b.pose.yaw - h.trainPlacement!.yaw - yaw0), Math.cos(b.pose.yaw - h.trainPlacement!.yaw - yaw0)))).toBeLessThan(1e-4);
    expect(census(w)).toEqual(uids);
    expect(stored(w, 'office:main', B)).toEqual([]); // (B's record leaves the train's bag out too)
    // tap E opens it: the same contents
    lookAt(h, b.centre.x, b.centre.y, b.centre.z);
    frame(h);
    h.keys.hits.add('KeyE');
    frame(h);
    expect(gear.viewOpen).toBe(true);
    expect(gear.session!.bag).toBe(b);
    expect(gear.session!.slots().flatMap((s, i) => (s ? [[i, stackToJSON(s)]] : []))).toEqual(want);
    gear.close('user');
    // hold E wears it again: the very same stack, its contents untouched
    frame(h);
    holdWear(w, b);
    expect(inv.wornBag()).toBe(bag);
    expect(contents(bag)).toEqual(want);
    expect(gear.bags).toEqual([]);
    expect(cargo.cargo().filter(r => r.kind === 'bag')).toEqual([]);
    expect(census(w)).toEqual(uids);
  }, 180000);

  it('a bag left on the platform stays at that station: not captured, kept in its record, still there on the way back', async () => {
    const A = SUBWAY(), B = OFFICE();
    const w = world(A), {h, gear, cargo} = w;
    const bag = wearLoadedBag(w);
    const p = h.trainPlacement!, spawnPose = {x: h.player.x, y: h.player.y, z: h.player.z};
    // a spot on the platform beside the car (outside it: never the train's)
    let placed = false;
    outer: for (const at of platformPoints(w)) {
      h.player.spawn(at.x, at.z, p.yaw, at.y);
      for (let k = 0; k < 8; k++) {
        h.player.yaw = p.yaw + (k / 8) * Math.PI * 2;
        h.player.pitch = -0.4;
        syncCamera(h);
        const spot = gear.placeSpot();
        if (typeof spot === 'string') continue;
        const q = worldToTrain(p, spot.x, spot.y, spot.z);
        if (Math.abs(q.z) < SPEC.width / 2 + 0.3) continue;
        setDown(w);
        placed = true;
        break outer;
      }
    }
    expect(placed).toBe(true);
    const b0 = gear.bags[0], pose0 = {...b0.pose}, want = contents(bag);
    expect(cargo.ownsBag(b0)).toBe(false);
    expect(cargo.cargo()).toEqual([]);
    h.player.spawn(spawnPose.x, spawnPose.z, p.yaw, spawnPose.y); // back aboard to leave
    await journey(w, B, () => {
      expect(cargo.riding).toEqual([]);
      const rec = stored(w, 'subway:main', A);
      expect(rec.map(r => [r.id, r.stack.uid])).toEqual([[b0.id, bag.uid]]);
    });
    expect(gear.bags).toEqual([]); // nothing arrived at B
    expect(cargo.cargo()).toEqual([]);
    // and back to A by train: the bag still lies on A's platform (the station's record), never aboard
    await journey(w, A);
    expect(gear.bags.length).toBe(1);
    const b = gear.bags[0];
    expect([b.id, b.stack.uid]).toEqual([b0.id, bag.uid]);
    expect({...b.pose}).toEqual(pose0);
    expect(contents(b.stack)).toEqual(want);
    expect(cargo.ownsBag(b)).toBe(false);
    expect(cargo.cargo()).toEqual([]);
  }, 240000);
});

describe('train bag cargo: saves', () => {
  /** A save of the train's record and the run's bag memory (JSON round trip, as a save file carries them). */
  const snapshot = (w: W) => JSON.parse(JSON.stringify({train: w.h.playerTrain.participant().save(), bags: (w.gear.flush(), w.gear.store.toJSON())})) as {train: {cargo: TrainCargoJSON} & Record<string, unknown>; bags: Record<string, unknown>};

  it('saved mid-ride, loaded in the same session and on a fresh host: exactly one bag in the parked car, same id / uid / contents; a reload never doubles it', async () => {
    const A = SUBWAY(), B = OFFICE();
    const w = world(A), {h, gear, cargo, ride} = w;
    const bag = wearLoadedBag(w);
    expect(typeof faceForSpot(w)).toBe('object');
    setDown(w);
    const id = gear.bags[0].id, want = contents(bag);
    // mid-ride (the old world gone, the next not built yet): the save lists the riding bag in the train's cargo, no station keeps it
    let snap: ReturnType<typeof snapshot> | null = null;
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    teardown(h);
    snap = snapshot(w);
    const bags = snap.train.cargo.items.filter(r => r.kind === 'bag');
    expect(cargoProblem(snap.train.cargo)).toBeNull();
    expect(bags.map(r => [r.id, r.stack.uid])).toEqual([[id, bag.uid]]);
    expect(contents(bags[0].stack)).toEqual(want);
    expect(Object.values(snap.bags).flatMap(r => (r as {bags: unknown[]}).bags)).toEqual([]);
    // Load in this session (Game.loadSave: the live world goes, the save is installed, the station built fresh)
    ride.reset();
    await Promise.resolve();
    h.playerTrain.participant().load(structuredClone(snap.train));
    gear.store.loadJSON(structuredClone(snap.bags));
    build(h, A);
    run(h, 0.1);
    const one = () => {
      const got = gear.bags.filter(b => b.stack.uid === bag.uid);
      expect(got.length).toBe(1);
      expect(got[0].id).toBe(id);
      expect(contents(got[0].stack)).toEqual(want);
      expect(cargo.ownsBag(got[0])).toBe(true);
      expect(cargo.cargo().filter(r => r.kind === 'bag').map(r => r.id)).toEqual([id]);
      return got[0];
    };
    one();
    census(w);
    // a second load of the same save (Continue again): still exactly one
    h.playerTrain.participant().load(structuredClone(snap.train));
    gear.store.loadJSON(structuredClone(snap.bags));
    run(h, 0.1);
    one();
    census(w);
    // it is worn again from the loaded world (hold E)
    holdWear(w, one());
    expect(w.inv.wornBag()?.uid).toBe(bag.uid);
    expect(contents(w.inv.wornBag()!)).toEqual(want);
    // a FRESH host (Continue after a restart): the save's run installed before the first build
    const f = world(B, {build: false});
    f.h.playerTrain.participant().load(structuredClone(snap.train));
    f.gear.store.loadJSON(structuredClone(snap.bags));
    build(f.h as never, B);
    run(f.h, 0.1);
    expect(f.gear.bags.map(x => [x.id, x.stack.uid])).toEqual([[id, bag.uid]]);
    expect(contents(f.gear.bags[0].stack)).toEqual(want);
    expect(f.cargo.ownsBag(f.gear.bags[0])).toBe(true);
    census(f);
  }, 180000);

  it('saved parked with the bag aboard: the cargo has it, the station record does not; teardown + load + build restores it once', () => {
    const A = SUBWAY();
    const w = world(A), {h, gear} = w;
    const bag = wearLoadedBag(w);
    expect(typeof faceForSpot(w)).toBe('object');
    setDown(w);
    const id = gear.bags[0].id, want = contents(bag);
    const snap = snapshot(w);
    expect(snap.train.cargo.items.map(r => [r.kind, r.id, r.stack.uid])).toEqual([['bag', id, bag.uid]]);
    expect((snap.bags['subway:main'] as {bags: unknown[]}).bags).toEqual([]);
    teardown(h);
    h.playerTrain.participant().load(structuredClone(snap.train));
    gear.store.loadJSON(structuredClone(snap.bags));
    build(h, A);
    run(h, 0.1);
    expect(gear.bags.map(b => [b.id, b.stack.uid])).toEqual([[id, bag.uid]]);
    expect(contents(gear.bags[0].stack)).toEqual(want);
    census(w);
  });

  it('old saves: a v1 cargo record with a bag loads it aboard (same id / contents, worn again); a save without `cargo` loads none and leaves the station bags alone', () => {
    const A = SUBWAY();
    const w = world(A), {h, gear, cargo, inv} = w;
    const base = JSON.parse(JSON.stringify(h.playerTrain.participant().save())) as Record<string, unknown>;
    const slots: (StackJSON | null)[] = new Array(12).fill(null); // (a pre-change save: the 12-slot backpack)
    slots[2] = {uid: 900002, itemId: 'medkit', count: 1};
    slots[7] = {uid: 900003, itemId: 'water', count: 2};
    const rec: CargoItemJSON = {kind: 'bag', id: 'bag:900001', stack: {uid: 900001, itemId: 'backpack', count: 1, bag: slots}, x: -2.5, y: SPEC.floorY, z: 0.3, q: [0, 0.3826834, 0, 0.9238795]};
    const v1 = {...base, cargo: {v: 1, items: [rec]}};
    expect(cargoProblem(v1.cargo)).toBeNull();
    h.playerTrain.participant().load(structuredClone(v1));
    expect(gear.bags.map(b => [b.id, b.stack.uid])).toEqual([['bag:900001', 900001]]);
    const b = gear.bags[0];
    expect(contents(b.stack)).toEqual(contents({bag: slots}));
    expect(cargo.ownsBag(b)).toBe(true);
    expect(inv.makeStack('water', 1).uid).toBeGreaterThan(900003); // (its uids reserved)
    // saved again: the current format, the same bag record
    const again = h.playerTrain.participant().save() as {cargo: TrainCargoJSON};
    expect(again.cargo.v).toBe(3);
    expect(again.cargo.items.map(r => [r.kind, r.id, r.stack.uid])).toEqual([['bag', 'bag:900001', 900001]]);
    expect(contents(again.cargo.items[0].stack)).toEqual(contents({bag: slots}));
    // and worn from the car
    holdWear(w, b);
    expect(inv.wornBag()?.uid).toBe(900001);
    // an older save without `cargo`: nothing aboard; a bag lying in the station's record is untouched
    const stationBag = {id: 'bag:900010', stack: {uid: 900010, itemId: 'backpack', count: 1, bag: new Array(12).fill(null)}, x: A.playerSpawn.x, y: 0, z: A.playerSpawn.z, yaw: 0, level: 0};
    teardown(h);
    gear.store.save('subway:main', {v: 1, seed: A.seed >>> 0, init: true, bags: [stationBag]});
    const old = structuredClone(base);
    delete old.cargo;
    h.playerTrain.participant().load(old);
    build(h, A);
    run(h, 0.1);
    expect(cargo.cargo()).toEqual([]);
    expect(gear.bags.map(x => [x.id, x.stack.uid])).toEqual([['bag:900010', 900010]]);
    expect(cargo.ownsBag(gear.bags[0])).toBe(false);
    void THREE;
  });
});
