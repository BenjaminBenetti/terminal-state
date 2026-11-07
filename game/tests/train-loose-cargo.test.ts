// Task studio-beta-train-loose-cargo-20261107-060450-01 (user: "all items on the train should move with the train, i.e. if I drop an item
// on the train it should come with it, to the next level!"): world/trainCargo.ts on a generated station with the REAL PlayerTrainRuntime,
// TrainRide, Player, PickupManager and Inventory (the fuel carts installed too: they keep their own cargo) and a small grounded-bag host:
//  - eligibility: only items lying INSIDE the parked car are the train's (not the platform beside it, not under it in the track bed);
//  - a whole journey: they ride the car's view root (moving WITH the car) through the departure, the world teardown, the transit and the
//    next station's build, and lie as ordinary pickups / a grounded bag in the NEW station's parked car after the stop — the same stacks
//    (uid, count, magazine, filter, air, bag contents), the same train-local poses; nothing lost, nothing duplicated;
//  - riding: E takes an aimed item (gone from the cargo), an inventory drop lands on the car floor as cargo and arrives too;
//  - a refused / reset departure releases them where they lay; a teardown without a ride keeps them pending for the next parked car;
//  - saves: the player-train participant's `cargo` round-trips (load spawns them in the parked car, idempotent), is validated strictly,
//    an older save without it loads none; the ending-save flush / the gear record / the map's station fuel leave the train's items out;
//  - fuel: cans aboard travel, but the departure draw stays tank -> carts aboard -> chest.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {carToWorld} from '../src/world/trainRideLocal';
import {PickupManager, type Pickup} from '../src/world/pickups';
import {GroundBag} from '../src/world/groundBag';
import {Inventory, stackToJSON, type ItemStack} from '../src/items/inventory';
import {TrainCargoSystem, CARGO_TEXT} from '../src/world/trainCargo';
import {cargoProblem, type CargoItemJSON} from '../src/run/trainCargo';
import {FUEL, planDebit, reservesOf} from '../src/fuel/fuel';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {DT, build, frame, lookAt, press, run, stationHost, teardown} from './helpers/fuelCartsHost';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {}; // (item stand-in label atlases clip their cells)

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const OFFICE = () => lay('office', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

/** A small grounded-bag host with GearSystem's surface the cargo uses (real GroundBag objects). */
class Bags {
  bags: GroundBag[] = [];
  recordFilter: ((b: GroundBag) => boolean) | null = null;
  constructor(readonly scene: THREE.Scene) {}
  adoptBag(id: string, stack: ItemStack, pose: {x: number; y: number; z: number; yaw: number; level: number}): GroundBag {
    const b = new GroundBag(id, stack, pose);
    this.bags.push(b);
    this.scene.add(b.obj);
    return b;
  }
  releaseBag(b: GroundBag): ItemStack | null {
    const i = this.bags.indexOf(b);
    if (i < 0) return null;
    this.bags.splice(i, 1);
    b.dispose();
    return b.stack;
  }
  /** GearSystem.record's list: grounded bags the record keeps. */
  recorded(): GroundBag[] { return this.bags.filter(b => b.grounded && !this.recordFilter?.(b)); }
}

function station(L = SUBWAY()) {
  const s = stationHost(L);
  live.push(s.rt);
  const h = s.h as typeof s.h & {inv: Inventory; pickups: PickupManager; gear: Bags & {placeRules: unknown[]}; syncHeld(): void};
  const inv = new Inventory(), pickups = new PickupManager({}), bags = new Bags(h.scene);
  h.scene.add(pickups.group);
  Object.assign(h, {inv, pickups, syncHeld: () => {}});
  Object.assign(bags, {placeRules: h.gear.placeRules});
  h.gear = bags as never;
  (h.sfx as Record<string, unknown>).pickup = () => { h.sfxCalls.push('pickup'); };
  const cargo = new TrainCargoSystem(h as never).install();
  return {...s, h, cargo, inv, pickups, bags};
}

/** World -> the parked car's frame and back. */
const local = (h: {trainPlacement: {x: number; z: number; railTopY: number; front: 1 | -1} | null}, x: number, y: number, z: number) => worldToTrain(h.trainPlacement!, x, y, z);

/** A pickup lying at train-local (lx, lz) on the car floor (yaw relative to the car). */
function aboardPickup(h: {trainPlacement: never; inv: Inventory; pickups: PickupManager} & Record<string, unknown>, st: ItemStack, lx: number, lz: number, yaw = 0, ly = SPEC.floorY): Pickup {
  const p = h.trainPlacement as unknown as {yaw: number; x: number; z: number; railTopY: number; front: 1 | -1};
  const w = trainToWorld(p, lx, ly, lz);
  return h.pickups.add(st, w.x, w.y, w.z, yaw + p.yaw);
}

function stack(inv: Inventory, id: string, count = 1, extra: Partial<ItemStack> = {}): ItemStack {
  const s = inv.makeStack(id, count);
  s.count = count;
  return Object.assign(s, extra);
}

/** Every item uid exactly once across the inventory, the train's cargo and the station's world (pickups / bags not aboard). */
function census(c: ReturnType<typeof station>): number[] {
  const ids = [
    ...c.inv.allStacks(true).map(s => s.uid),
    ...c.cargo.cargo().map(r => r.stack.uid),
    ...c.pickups.list.filter(p => !c.cargo.ownsPickup(p)).map(p => p.stack.uid),
    ...c.bags.recorded().map(b => b.stack.uid),
  ].sort((a, b) => a - b);
  expect(new Set(ids).size, `duplicate uid in ${ids}`).toBe(ids.length);
  return ids;
}

describe('train loose cargo: which items are the train\'s', () => {
  it('only items lying inside the parked car (its floor / fixtures, between floor and ceiling); not the platform, the doorway skin or the bed', () => {
    const c = station(), h = c.h, I = SPEC.interior;
    const inside = aboardPickup(h as never, stack(c.inv, 'water'), (I.x0 + I.x1) / 2, 0.3);
    const corner = aboardPickup(h as never, stack(c.inv, 'water'), I.x0 + 0.2, -I.halfWidth + 0.2);
    const platform = aboardPickup(h as never, stack(c.inv, 'water'), 0, -(SPEC.width / 2 + 1.0), 0, SPEC.floorY - 1); // beside the car
    const skin = aboardPickup(h as never, stack(c.inv, 'water'), 0, -(I.halfWidth + 0.05)); // just outside the interior (the doorway sill)
    const bed = aboardPickup(h as never, stack(c.inv, 'water'), 0, 0, 0, SPEC.floorY - 1.2); // under the car, in the track bed
    expect([inside, corner, platform, skin, bed].map(p => c.cargo.ownsPickup(p))).toEqual([true, true, false, false, false]);
    expect(c.cargo.cargo().map(r => r.stack.uid).sort()).toEqual([inside.stack.uid, corner.stack.uid].sort());
  });
});

describe('train loose cargo: a whole journey', () => {
  it('items + a grounded bag ride the car (moving with it) through departure, teardown, transit and the next build, and lie in the NEW parked car', async () => {
    const A = SUBWAY(), B = OFFICE();
    const c = station(A), {h, ride, rt, inv, pickups, bags, cargo} = c;
    const I = SPEC.interior;
    // the items: a loaded pistol, two med kits, a mask with a used filter, an air tank, a fuel can, a backpack with contents (grounded)
    const gun = aboardPickup(h as never, stack(inv, 'pistol', 1, {mag: 7}), -2.0, 0.4, 0.3);
    const meds = aboardPickup(h as never, stack(inv, 'medkit', 2), -1.0, -0.5);
    const mask = aboardPickup(h as never, stack(inv, 'gas_mask', 1, {filter: 12.5}), 0.8, 0.6);
    const tank = aboardPickup(h as never, stack(inv, 'airtank_backpack', 1, {air: 321}), 1.6, -0.3);
    const can = aboardPickup(h as never, stack(inv, FUEL.canItem, 1), 2.4, 0.2);
    const bagStack = stack(inv, 'backpack', 1);
    bagStack.bag = new Array(12).fill(null);
    bagStack.bag[0] = stack(inv, 'water', 3);
    bagStack.bag[5] = stack(inv, 'pistol', 1, {mag: 3});
    const p0 = h.trainPlacement!, bw = trainToWorld(p0, -3.0, SPEC.floorY, -0.4);
    bags.adoptBag(`bag:${bagStack.uid}`, bagStack, {x: bw.x, y: bw.y, z: bw.z, yaw: p0.yaw + 0.7, level: p0.level});
    const outside = aboardPickup(h as never, stack(inv, 'water'), 0, -(SPEC.width / 2 + 1.2), 0, SPEC.floorY - 1);
    frame(h);
    const before = census(c);
    const items0 = [gun, meds, mask, tank, can].map(p => ({uid: p.stack.uid, json: stackToJSON(p.stack), l: local(h, p.obj.position.x, p.obj.position.y, p.obj.position.z)}));
    const view = rt.view!;
    // depart: the doors close -> captured onto the car's view root
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    expect(cargo.riding.length).toBe(6);
    expect(pickups.list).toEqual([outside]); // the platform item stays the station's
    expect(bags.bags).toEqual([]);
    for (const r of cargo.riding) expect(r.obj.parent).toBe(view.root);
    // they move WITH the car: each object is at carToWorld(car pose, local)
    view.root.updateMatrixWorld(true);
    for (const r of cargo.riding) {
      const w = carToWorld(ride.pose, r.x, r.y, r.z, {x: 0, y: 0, z: 0}), v = r.obj.getWorldPosition(new THREE.Vector3());
      expect(v.distanceTo(new THREE.Vector3(w.x, w.y, w.z))).toBeLessThan(1e-6);
    }
    // the old world goes (Game: hooks, then the memory flush, then the world's pickups cleared): the cargo stays with the held view
    teardown(h);
    pickups.clear();
    expect(rt.view).toBe(view);
    expect(cargo.riding.length).toBe(6);
    const mid = cargo.cargo();
    expect(cargoProblem({v: 1, items: mid})).toBeNull();
    for (const it of items0) expect(mid.find(r => r.stack.uid === it.uid)!.stack).toEqual(it.json); // exact stacks (mag / filter / air)
    expect(mid.find(r => r.kind === 'bag')!.stack).toEqual(stackToJSON(bagStack)); // the bag with its contents
    run(h, 2); // (between the worlds the car keeps running)
    // while riding: drop a stack from the inventory (it lands on the car floor as cargo), then take the med kits back with E
    const extra = stack(inv, 'water', 2);
    inv.add(extra);
    const ref = inv.find(extra.uid)!;
    expect(cargo.dropRiding(inv.detach(ref)!)).toBe(true);
    expect(cargo.riding.length).toBe(7);
    const dropped = cargo.riding.at(-1)!;
    expect(dropped.stack.uid).toBe(extra.uid);
    expect(dropped.y).toBe(SPEC.floorY);
    expect(Math.abs(dropped.z)).toBeLessThan(I.halfWidth);
    const rm = cargo.riding.find(r => r.stack.itemId === 'medkit')!;
    const wm = carToWorld(ride.pose, rm.x, rm.y + 0.05, rm.z, {x: 0, y: 0, z: 0});
    // walk the riding player next to it (car-local), look at it, E
    ride.local.x = rm.x + 0.9; ride.local.z = rm.z; ride.writePlayer();
    frame(h);
    lookAt(h, wm.x, wm.y, wm.z);
    frame(h);
    expect(cargo.prompt).toBe(CARGO_TEXT.take('Med kit'));
    press(h, 'KeyE');
    expect(inv.count('medkit')).toBe(2);
    expect(cargo.riding.some(r => r.stack.itemId === 'medkit')).toBe(false);
    expect(cargo.cargo().some(r => r.stack.uid === meds.stack.uid)).toBe(false); // taken: not also in the cargo
    // the next station is built while riding: still riding cargo
    build(h, B, false);
    expect(cargo.riding.length).toBe(6);
    const p2 = h.trainPlacement!;
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.1);
    // stopped: ordinary pickups / a grounded bag in the NEW station's parked car, at trainToWorld(new placement, local)
    expect(cargo.riding).toEqual([]);
    expect(pickups.list.length).toBe(5);
    expect(bags.bags.length).toBe(1);
    for (const it of items0.filter(x => x.uid !== meds.stack.uid)) {
      const pk = pickups.list.find(p => p.stack.uid === it.uid)!;
      expect(stackToJSON(pk.stack)).toEqual(it.json);
      const w = trainToWorld(p2, it.l.x, it.l.y, it.l.z);
      expect(pk.obj.position.distanceTo(new THREE.Vector3(w.x, w.y, w.z))).toBeLessThan(1e-4);
      expect(cargo.ownsPickup(pk)).toBe(true); // still the train's (it lies in the car)
    }
    const dp = pickups.list.find(p => p.stack.uid === extra.uid)!;
    expect(dp.stack.count).toBe(2); // the riding drop arrived with the train
    const b = bags.bags[0];
    expect(b.stack).toBe(bagStack);
    expect(stackToJSON(b.stack)).toEqual(stackToJSON(bagStack));
    expect(cargo.ownsBag(b)).toBe(true);
    // conservation: the same uids as before the trip (+ the dropped water), each exactly once
    expect(census(c).sort()).toEqual([...before.filter(u => u !== outside.stack.uid), extra.uid].sort());
    void DT;
  }, 120000);
});

describe('train loose cargo: refused rides, teardowns, saves', () => {
  it('a departure that never moves (reset while the doors close) leaves the items where they lay', async () => {
    const c = station(), {h, ride, cargo, pickups} = c;
    const pk = aboardPickup(h as never, stack(c.inv, 'water', 3), -1.5, 0.2, 0.4);
    const at = pk.obj.position.clone(), q = pk.obj.quaternion.clone();
    frame(h);
    void ride.depart();
    frame(h);
    expect(cargo.riding.length).toBe(1);
    ride.reset();
    await Promise.resolve();
    run(h, 0.1);
    expect(cargo.riding).toEqual([]);
    expect(pickups.list.length).toBe(1);
    expect(pickups.list[0].stack).toBe(pk.stack);
    expect(pickups.list[0].obj.position.distanceTo(at)).toBeLessThan(1e-6);
    expect(pickups.list[0].obj.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });

  it('a teardown without a ride (Retry / Load / New game): the train\'s items wait as records, then lie in the next parked car; the station keeps the rest', () => {
    const c = station(), {h, cargo, pickups, bags} = c;
    const mine = aboardPickup(h as never, stack(c.inv, 'medkit', 1), 1.0, 0.3);
    const theirs = aboardPickup(h as never, stack(c.inv, 'water', 1), 0, -(SPEC.width / 2 + 1.0), 0, SPEC.floorY - 1);
    const bs = stack(c.inv, 'backpack', 1);
    bs.bag = new Array(12).fill(null);
    const p = h.trainPlacement!, w = trainToWorld(p, -2, SPEC.floorY, 0.3);
    bags.adoptBag('bag:x', bs, {x: w.x, y: w.y, z: w.z, yaw: p.yaw, level: p.level});
    // the gear record and Game.saveSectionMemory's filter leave the train's out (the ending save flushes mid-section)
    expect(bags.recorded()).toEqual([]);
    expect(pickups.list.filter(pk => !cargo.ownsPickup(pk))).toEqual([theirs]);
    teardown(h);
    expect(pickups.list).toEqual([theirs]); // the station's item is still there for the station's memory flush
    expect(bags.bags).toEqual([]);
    expect(cargo.pending.map(r => r.stack.uid).sort()).toEqual([mine.stack.uid, bs.uid].sort());
    pickups.clear();
    build(h, SUBWAY());
    expect(cargo.pending).toEqual([]);
    expect(pickups.list.map(pk => pk.stack.uid)).toEqual([mine.stack.uid]);
    expect(bags.bags.map(b => b.stack.uid)).toEqual([bs.uid]);
  });

  it('the participant: cargo round-trips (load spawns it in the parked car, idempotent); an older save without it loads none; New Game clears it', () => {
    const c = station(), {h, cargo, pickups} = c;
    aboardPickup(h as never, stack(c.inv, 'pistol', 1, {mag: 5}), -1, 0.2, 0.5);
    aboardPickup(h as never, stack(c.inv, 'gas_mask', 1, {filter: 3}), 1, -0.2);
    const rec = h.playerTrain.participant().save() as {cargo: {v: 1; items: CargoItemJSON[]}};
    expect(rec.cargo.items.length).toBe(2);
    expect(cargoProblem(rec.cargo)).toBeNull();
    // load (Continue / Load): the live items become exactly the records — no duplicate
    h.playerTrain.participant().load(structuredClone(rec));
    expect(pickups.list.length).toBe(2);
    h.playerTrain.participant().load(structuredClone(rec));
    expect(pickups.list.length).toBe(2);
    expect((h.playerTrain.participant().save() as {cargo: unknown}).cargo).toEqual(rec.cargo);
    // an older save: no `cargo` -> none (the Lockbox / fuel untouched)
    const old = structuredClone(rec) as Record<string, unknown>;
    delete old.cargo;
    h.playerTrain.participant().load(old);
    expect(pickups.list.length).toBe(0);
    expect(cargo.cargo()).toEqual([]);
    h.playerTrain.participant().load(structuredClone(rec));
    h.playerTrain.participant().reset();
    expect(pickups.list.length).toBe(0);
    // a record without a live system keeps exactly what it was given
    const bare = new PlayerTrainRecord();
    bare.participant().load(structuredClone(rec));
    expect((bare.participant().save() as {cargo: unknown}).cargo).toEqual(rec.cargo);
  });

  it('save validation: cargo stacks share the run\'s uid set; malformed shapes / stacks are refused', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    hs.run.current = {level: 'subway', section: 'main', station: sid(1)};
    hs.run.memory().visits = 1;
    const item = (uid: number, extra: Record<string, unknown> = {}): CargoItemJSON => ({kind: 'item', stack: {uid, itemId: 'water', count: 1}, x: 1, y: SPEC.floorY, z: 0.2, q: [0, 0, 0, 1], ...extra}) as CargoItemJSON;
    hs.train.cargo.setRecords([item(910001), {kind: 'bag', id: 'bag:910002', stack: {uid: 910002, itemId: 'backpack', count: 1, bag: [{uid: 910003, itemId: 'medkit', count: 1}, ...new Array(11).fill(null)]}, x: -2, y: SPEC.floorY, z: 0, q: [0, 0.3826834, 0, 0.9238795]}]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const good = validateSaveFile(structuredClone(base));
    expect(good.ok, good.ok ? '' : (good as {error: string}).error).toBe(true);
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    const items = (f: typeof base) => f.run.participants['player-train'].cargo.items;
    refuse(f => { items(f)[0].stack.uid = 910002; }, /duplicate item uid/); // one item, one uid (a bag's own uid)
    refuse(f => { items(f)[0].stack.count = 99; }, /count/);
    refuse(f => { items(f)[0].q = [0, 0, 0, 2]; }, /orientation/);
    refuse(f => { items(f)[0].x = 1e4; }, /cargo x/);
    refuse(f => { delete items(f)[1].id; }, /bag needs an id/);
    refuse(f => { f.run.participants['player-train'].cargo.v = 3; }, /version/); // (task train-all-cargo: v2 = items + props, the current format)
    refuse(f => { const inv = f.run.carry.inventory; inv.pack[0] = {uid: 910001, itemId: 'water', count: 1}; }, /duplicate item uid/); // shared with the carried inventory
  });

  it('fuel: cans aboard travel but the departure draw stays tank -> carts aboard -> chest; the map\'s station stock leaves them out', () => {
    const c = station(), {h, cargo} = c;
    const cans = [aboardPickup(h as never, stack(c.inv, FUEL.canItem, 1), 0.5, 0.2), aboardPickup(h as never, stack(c.inv, FUEL.canItem, 1), 0.8, -0.2)];
    expect(cans.every(p => cargo.ownsPickup(p))).toBe(true);
    // the draw: the loose cans are no source (only the tank, the carts aboard, the chest)
    expect(reservesOf(0, [], h.playerTrain.lockbox.slots).total).toBe(0);
    expect(planDebit(FUEL.hopUnits, 0, [], h.playerTrain.lockbox.slots)).toBeNull();
    expect(cargo.cargo().filter(r => r.stack.itemId === FUEL.canItem).length).toBe(2);
  });
});

describe('train loose cargo: the REAL Game methods on a minimal shell', () => {
  it('Game.dropRef while riding hands the stack to the train\'s cargo (it no longer refuses); without a car view the stack stays in the inventory', async () => {
    const {Game} = await import('../src/game');
    const inv = new Inventory(), toasts: string[] = [], got: ItemStack[] = [];
    const st = inv.makeStack('water', 2);
    st.count = 2;
    inv.add(st);
    let accept = true;
    const shell = {
      inv, use: null, hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied: () => {}}, syncHeld: () => {}, cancelUse: () => {},
      trainRide: {riding: true, refuseDrop: () => true},
      trainCargo: {dropRiding: (x: ItemStack) => { if (!accept) return false; got.push(x); return true; }},
    };
    Object.setPrototypeOf(shell, Game.prototype);
    (shell as unknown as {dropRef(ref: unknown, count?: number): void}).dropRef(inv.find(st.uid)!);
    expect(got.map(x => [x.uid, x.count])).toEqual([[st.uid, 2]]);
    expect(inv.count('water')).toBe(0);
    expect(toasts.at(-1)).toBe('Dropped 2 × Water');
    // no car view to drop into (a reset ride): the stack comes back, nothing lost
    const st2 = inv.makeStack('medkit', 1);
    inv.add(st2);
    accept = false;
    (shell as unknown as {dropRef(ref: unknown): void}).dropRef(inv.find(st2.uid)!);
    expect(inv.count('medkit')).toBe(1);
  });

  it('Game.saveSectionMemory leaves the train\'s items out of the station memory (the ending save\'s mid-section flush too)', async () => {
    const {Game} = await import('../src/game');
    const pm = new PickupManager({}), inv = new Inventory();
    const mine = pm.add(inv.makeStack('water', 1), 1, 0, 1), theirs = pm.add(inv.makeStack('medkit', 1), 5, 0, 5);
    const mem = {pickups: null as unknown, holders: {}, killed: [] as number[]};
    const shell = {
      run: {current: {level: 'subway', section: 'main'}, memory: () => mem}, pickups: pm, layoutPickup: new Map(), containers: null, zombies: [], enemyIndex: new Map(),
      trainCargo: {ownsPickup: (p: Pickup) => p === mine},
    };
    Object.setPrototypeOf(shell, Game.prototype);
    (shell as unknown as {saveSectionMemory(): void}).saveSectionMemory();
    expect((mem.pickups as {stack: {itemId: string}}[]).map(r => r.stack.itemId)).toEqual(['medkit']);
    void theirs;
  });
});

