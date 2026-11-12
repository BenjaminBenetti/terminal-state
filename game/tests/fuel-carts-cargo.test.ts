// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): fuel cart OWNERSHIP + CARGO (world/fuelCarts.ts), the user's "must
// really work" part:
//  - the rule: a cart wholly inside the parked car (cartAboard) is the train's (TrainFuel cargo, train-local), any other the station's
//    (stationRecords: world poses); a cart grabbed in through an open door / out again moves its ONE uid between the records;
//  - every live cart serialized exactly once; save -> load (TrainFuel participant + the lead's loadStation) gives the same carts, no
//    duplicate, idempotent; New Game clears the cargo;
//  - cargo poses round-trip through trainToWorld / worldToTrain at both parked yaws (0 / PI);
//  - departBlock() for a cart straddling a doorway; captureCargo() / releaseCargo() idempotent (the ride's car-local collision swapped
//    and restored); restore() before a world exists waits for a parked car;
//  - a whole ride: the cargo rides the car's view through the departure, the world teardown, the transit and the next station's build
//    (the riding player cannot walk through it), and is an ordinary cart inside the NEW station's parked car after the stop; a cart
//    left on the platform stays in the old station's records.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {FUEL, trainFuelProblem, stationFuelProblem, type CargoCartJSON} from '../src/fuel/fuel';
import {PORT, cartAboard, cartStraddles} from '../src/fuel/trainPort';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {CART} from '../src/world/fuelCartPhysics';
import {CART_TEXT, FUEL_CART, FuelCarts} from '../src/world/fuelCarts';
import {carToWorld, fromStep} from '../src/world/trainRideLocal';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {DT, Keys, build, flatRoom, frame, holdE, lookAt, press, run, stationHost, teardown, type CartTestHost} from './helpers/fuelCartsHost';
import {Player} from '../src/player/player';

installCanvasShim(false);

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const OFFICE = () => lay('office', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

const HW = SPEC.interior.halfWidth;
const cargoRec = (uid: string, x: number, z: number, units: number = FUEL.cartUnits, yaw = 0): CargoCartJSON => ({uid, units, x, y: SPEC.floorY, z, yaw});

function station(L = SUBWAY(), opts: {build?: boolean} = {}) {
  const s = stationHost(L, opts);
  live.push(s.rt);
  return s;
}

/** A station cart on the platform at train-local (lx, lz) (world pose; drum toward the car). */
function platformCart(h: CartTestHost, carts: FuelCarts, uid: string, lx: number, lz: number, units: number = FUEL.cartUnits) {
  const p = h.trainPlacement!, w = trainToWorld(p, lx, SPEC.floorY, lz);
  const floor = h.levels!.floorAt(w.x, w.z, p.floorY + 0.3);
  carts.spawn({uid, units, x: w.x, y: floor, z: w.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
}

const uids = (xs: readonly {uid: string}[]) => xs.map(x => x.uid).sort();

/** Every live cart exactly once across the train's cargo and the station's records. */
function onceEach(carts: FuelCarts): void {
  const all = uids(carts.all());
  const split = [...uids(carts.cargo()), ...uids(carts.stationRecords())].sort();
  expect(split).toEqual(all);
  expect(new Set(all).size).toBe(all.length);
}

describe('fuel carts: cargo poses at both parked yaws (0 / PI)', () => {
  /** A fake parked car over the flat room (its floor = the room floor), front +1 (yaw 0) or -1 (yaw PI). */
  const fakePlacement = (front: 1 | -1): TrainPlacement => ({
    level: 0, x: 5.25, z: 3.5, yaw: front > 0 ? 0 : Math.PI, front, railTopY: -SPEC.floorY, floorY: 0, trackZ: 3.5, trenchIndex: 0, trackIndex: 0,
    platformArea: 0, platformEdgeZ: 3.5 - 2 * front, platformSide: (-front) as 1 | -1, x0: 5.25 - SPEC.length / 2, x1: 5.25 + SPEC.length / 2, length: SPEC.length, width: SPEC.width,
  });

  for (const front of [1, -1] as const) {
    it(`front ${front}: restore -> a live cart at trainToWorld(local) -> the same cargo record (pose, yaw, units); live units`, () => {
      const p = fakePlacement(front);
      const {h, carts} = roomOver(p);
      const rec = cargoRec('k', 1.2345, -0.5678, 5, 0.3);
      carts.restore([rec]);
      const w = trainToWorld(p, rec.x, rec.y, rec.z);
      const b = carts.bodyOf('k')!;
      expect([b.x, b.y, b.z]).toEqual([w.x, 0, w.z]);
      expect(b.yaw).toBeCloseTo(THREE.MathUtils.euclideanModulo(0.3 + p.yaw + Math.PI, Math.PI * 2) - Math.PI, 12);
      const back = worldToTrain(p, b.x, b.y, b.z);
      expect(back.x).toBeCloseTo(rec.x, 12);
      expect(back.z).toBeCloseTo(rec.z, 12);
      expect(carts.cargo()).toEqual([rec]);
      expect(carts.stationRecords()).toEqual([]);
      onceEach(carts);
      // the view stands at the world pose; aboard() hands out the LIVE fuel (a debit shows on the record and the gauge)
      const g = carts.viewOf('k')!;
      expect(g.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(w.x, 0, w.z))).toBeLessThan(1e-9);
      const ab = carts.aboard();
      expect(ab.map(c => [c.uid, c.units])).toEqual([['k', 5]]);
      ab[0].units -= 2;
      frame(h);
      expect(carts.cargo()[0].units).toBe(3);
      expect((carts as unknown as {carts: {view: {shown: number}}[]}).carts[0].view.shown).toBe(3);
      // pure maps: exact inverses at this yaw
      for (const [lx, lz] of [[0, 0], [6.1, -1.1], [-6.9, 0.9]]) {
        const ww = trainToWorld(p, lx, 0.98, lz), q = worldToTrain(p, ww.x, ww.y, ww.z);
        expect(q.x).toBeCloseTo(lx, 12);
        expect(q.y).toBeCloseTo(0.98, 12);
        expect(q.z).toBeCloseTo(lz, 12);
      }
    });
  }

  function roomOver(p: TrainPlacement) {
    const levels = flatRoom(100);
    const s = stationlessHost(levels, p);
    return s;
  }
});

/** The flat room with a fake placement and NO train runtime (placement() = host.trainPlacement). */
function stationlessHost(levels: ReturnType<typeof flatRoom>, p: TrainPlacement) {
  const h = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), player: new Player(),
    levels, propIndex: null, trainPlacement: p, trainRuntime: null, trainRide: null,
    playerTrain: {fuel: {tank: 0, live: null, setCargo() {}}},
    hud: {toast() {}}, sfx: null, state: 'playing',
    frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[], sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    warmRegistry: {addPool() {}}, keys: new Keys(), modifierSources: [],
  };
  h.player.place(0.9, 0.9, 0);
  const carts = new FuelCarts(h as never).install();
  for (const s of h.sectionHooks) s.build?.(undefined as never);
  return {h: h as unknown as CartTestHost, carts};
}

describe('fuel carts: the ownership rule on a generated station (real parked train)', () => {
  it('a platform cart is the station\'s; grabbed in through an open door it becomes the train\'s (same uid), out again the station\'s', () => {
    const {h, carts, rt} = station();
    const p = h.trainPlacement!;
    const di = rt.train!.doors.findIndex(d => d.col.door.side === -1 && Math.abs(d.col.door.x - 0.182) < 0.01);
    const door = rt.train!.doors[di].col.door;
    platformCart(h, carts, 'cart:A', door.x, -2.6);
    expect(uids(carts.stationRecords())).toEqual(['cart:A']);
    expect(carts.cargo()).toEqual([]);
    expect(carts.aboard()).toEqual([]);
    expect(carts.departBlock()).toBeNull();
    onceEach(carts);
    // open the door, stand behind the cart facing the car, grab the handle, walk in
    rt.setDoor(di, true);
    run(h, 2);
    const stand = trainToWorld(p, door.x, SPEC.floorY, -3.75);
    h.player.place(stand.x, stand.z, Math.atan2(0, -p.front), h.levels!.floorAt(stand.x, stand.z, p.floorY + 0.3));
    frame(h);
    const b = carts.bodyOf('cart:A')!;
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z);
    holdE(h); // (E HELD starts the drag: task train-interaction-ux-20261112)
    expect(carts.grab).not.toBeNull();
    h.player.pitch = 0;
    h.keys.held.add('KeyW');
    let straddled = false;
    run(h, 4, () => {
      const q = worldToTrain(p, b.x, b.y, b.z);
      if (cartStraddles(q.x, q.z, FUEL_CART.ownRadius)) { straddled = true; expect(carts.departBlock()).toBe(CART_TEXT.straddle); }
      return false;
    });
    h.keys.held.clear();
    press(h, 'KeyE'); // let go
    expect(carts.grab).toBeNull();
    const q = worldToTrain(p, b.x, b.y, b.z);
    expect(straddled).toBe(true); // it came through the doorway (the curb / bridge / walls let it, the floor step is a step)
    expect(cartAboard(q.x, q.z, FUEL_CART.ownRadius)).toBe(true); // (pressed against the far lining: aboard within a centimetre)
    expect(Math.abs(q.z) + PORT.cartRadius).toBeLessThanOrEqual(HW + 1e-6);
    expect(b.y).toBeCloseTo(p.floorY, 4); // on the car floor
    expect(carts.departBlock()).toBeNull();
    expect(uids(carts.cargo())).toEqual(['cart:A']);
    expect(carts.stationRecords()).toEqual([]);
    expect(carts.aboard().map(c => c.uid)).toEqual(['cart:A']);
    expect(trainFuelProblem(h.playerTrain.fuel.toJSON())).toBeNull();
    onceEach(carts);
    // ... and back out (grab, walk backwards onto the platform)
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z);
    holdE(h);
    expect(carts.grab).not.toBeNull();
    h.player.pitch = 0;
    h.keys.held.add('KeyS');
    run(h, 4);
    h.keys.held.clear();
    press(h, 'KeyE');
    const q2 = worldToTrain(p, b.x, b.y, b.z);
    expect(q2.z).toBeLessThan(-SPEC.width / 2 - PORT.cartRadius); // wholly out on the platform
    expect(uids(carts.stationRecords())).toEqual(['cart:A']);
    expect(carts.cargo()).toEqual([]);
    expect(stationFuelProblem({v: 1, realized: true, carts: carts.stationRecords()})).toBeNull();
    onceEach(carts);
  }, 60000);

  it('departBlock: a cart straddling a doorway refuses the departure; wholly in or out it does not', () => {
    const {h, carts, rt} = station();
    const door = rt.train!.doors.find(d => d.col.door.side === -1)!.col.door;
    const p = h.trainPlacement!;
    const put = (lz: number) => {
      const w = trainToWorld(p, door.x, SPEC.floorY, lz);
      carts.loadStation([{uid: 'cart:D', units: 3, x: w.x, y: lz > -HW ? p.floorY : 0, z: w.z, yaw: 0, level: 0}]);
    };
    put(-HW); // half in the doorway
    expect(carts.departBlock()).toBe(CART_TEXT.straddle);
    put(-HW - 0.5);
    expect(carts.departBlock()).toBe(CART_TEXT.straddle);
    put(-2.6); // out on the platform
    expect(carts.departBlock()).toBeNull();
    carts.loadStation([]);
    carts.restore([cargoRec('cart:D', door.x, 0)]); // wholly in
    expect(carts.departBlock()).toBeNull();
    expect(carts.all()).toHaveLength(1);
  });
});

describe('fuel carts: save / load / new game', () => {
  it('save -> teardown -> load -> build -> loadStation gives the same carts exactly once (idempotent); New Game drops the cargo', () => {
    const {h, carts} = station();
    const L = h.layout!;
    carts.restore([cargoRec('cart:in', -3, 0.6, 6, 0.4)]);
    platformCart(h, carts, 'cart:out', 3.5, -2.8, 2);
    run(h, 0.2);
    onceEach(carts);
    const part = h.playerTrain.participant();
    const saved = JSON.parse(JSON.stringify(part.save())) as {fuel: {cargo: CargoCartJSON[]}};
    const stationSaved = JSON.parse(JSON.stringify(carts.stationRecords()));
    expect(saved.fuel.cargo.map(c => c.uid)).toEqual(['cart:in']);
    expect(stationSaved.map((c: {uid: string}) => c.uid)).toEqual(['cart:out']);
    const before = new Map(carts.all().map(c => [c.uid, c]));
    // the world goes: cargo pending, the station's carts in the snapshot (the lead writes FUEL_LANE from it)
    teardown(h);
    expect(carts.worldLive).toBe(false);
    expect(carts.all().map(c => [c.uid, c.mode])).toEqual([['cart:in', 'pending']]);
    expect(uids(carts.stationRecords())).toEqual(['cart:out']);
    expect(uids(carts.cargo())).toEqual(['cart:in']);
    expect(h.playerTrain.fuel.toJSON().cargo.map(c => c.uid)).toEqual(['cart:in']);
    // Load: the participant first (no world yet), then the build, then the lead hands the station's carts over
    part.load(saved);
    part.load(saved); // (idempotent)
    expect(carts.all().map(c => c.mode)).toEqual(['pending']);
    build(h, L);
    carts.loadStation(stationSaved);
    carts.loadStation(stationSaved); // (idempotent)
    expect(uids(carts.all())).toEqual(['cart:in', 'cart:out']);
    for (const c of carts.all()) {
      const b = before.get(c.uid)!;
      expect(c.units).toBe(b.units);
      expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeLessThan(1e-3);
      expect(c.owner).toBe(b.owner);
    }
    onceEach(carts);
    // a load while the world is live (Retry restores the entry state): still exactly one of each
    part.load(saved);
    expect(uids(carts.all())).toEqual(['cart:in', 'cart:out']);
    onceEach(carts);
    // a station record naming a cart the train carries is never spawned twice
    carts.loadStation([...stationSaved, {...stationSaved[0], uid: 'cart:in'}]);
    expect(uids(carts.all())).toEqual(['cart:in', 'cart:out']);
    carts.spawn({...stationSaved[0]}); // (known uid: ignored)
    expect(carts.all()).toHaveLength(2);
    // New Game: the cargo goes (the station's carts go with the next loadStation)
    part.reset();
    expect(carts.cargo()).toEqual([]);
    expect(uids(carts.all())).toEqual(['cart:out']);
    expect(h.playerTrain.fuel.tank).toBe(0);
  });

  it('restore before any world exists keeps the records (aboard / cargo) and spawns them inside the first parked car', () => {
    const {h, carts} = station(SUBWAY(), {build: false});
    expect(carts.worldLive).toBe(false);
    const recs = [cargoRec('cart:b', 2.5, -0.4, 4, -1.2), cargoRec('cart:a', -2.5, 0.5, 8, 2.0)];
    h.playerTrain.fuel.load({v: 1, tank: 3, cargo: recs});
    expect(carts.cargo()).toEqual([...recs].sort((x, y) => (x.uid < y.uid ? -1 : 1)));
    const ab = carts.aboard();
    expect(ab.map(c => c.uid).sort()).toEqual(['cart:a', 'cart:b']);
    ab.find(c => c.uid === 'cart:a')!.units = 5; // a debit before the world exists sticks to the record
    expect(carts.stationRecords()).toEqual([]);
    expect(frame.length).toBeGreaterThan(0);
    build(h, SUBWAY());
    const p = h.trainPlacement!;
    for (const r of recs) {
      const b = carts.bodyOf(r.uid)!, w = trainToWorld(p, r.x, r.y, r.z);
      expect(Math.hypot(b.x - w.x, b.z - w.z)).toBeLessThan(1e-9);
      expect(b.y).toBeCloseTo(p.floorY, 4);
    }
    expect(carts.cargo().find(c => c.uid === 'cart:a')!.units).toBe(5);
    expect(carts.cargo().map(c => [c.uid, c.x, c.z])).toEqual([['cart:a', -2.5, 0.5], ['cart:b', 2.5, -0.4]]);
    onceEach(carts);
  });
});

describe('fuel carts: capture / release and the ride', () => {
  it('captureCargo / releaseCargo are idempotent; the ride model collides with the cargo only while captured', () => {
    const {h, carts, rt, ride} = station();
    carts.restore([cargoRec('cart:c', -3, 0.6, 7, 0.25)]);
    platformCart(h, carts, 'cart:p', 3.5, -2.8);
    frame(h);
    const before = carts.all().find(c => c.uid === 'cart:c')!, cargo0 = carts.cargo();
    const props0 = ride.model.props;
    carts.captureCargo();
    carts.captureCargo();
    expect(carts.counts.captured).toBe(1);
    const g = carts.viewOf('cart:c')!;
    expect(g.parent).toBe(rt.view!.root);
    expect(carts.viewOf('cart:p')!.parent).toBe(carts.group); // the platform cart stays in the station
    expect(carts.cargo()).toEqual(cargo0);
    expect(carts.all().find(c => c.uid === 'cart:c')!.mode).toBe('cargo');
    expect(ride.model.props).not.toBe(props0);
    expect(ride.model.props.props.some(pp => pp.round && Math.abs(fromStep(pp.x, pp.z)[0] + 3) < 1e-9)).toBe(true);
    expect(g.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(before.x, before.y, before.z))).toBeLessThan(1e-9);
    carts.releaseCargo();
    carts.releaseCargo();
    expect(carts.counts.released).toBe(1);
    expect(g.parent).toBe(carts.group);
    expect(ride.model.props).toBe(props0);
    const after = carts.all().find(c => c.uid === 'cart:c')!;
    expect(after.mode).toBe('world');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-3);
    expect(carts.cargo()).toEqual(cargo0);
    // captured by the lead but no ride follows: released in place after the grace period
    carts.captureCargo();
    run(h, FUEL_CART.captureGrace + 0.2);
    expect(carts.all().find(c => c.uid === 'cart:c')!.mode).toBe('world');
    expect(ride.model.props).toBe(props0);
    onceEach(carts);
  });

  it('a whole journey: cargo rides the car through departure, teardown, transit and the next build, then stands in the NEW parked car', async () => {
    const A = SUBWAY(), B = OFFICE();
    const {h, carts, rt, ride} = station(A);
    const rec = cargoRec('cart:ride', -3, 0.6, 6, 0.5);
    carts.restore([rec]);
    platformCart(h, carts, 'cart:left', 3.5, -2.8, 3);
    frame(h);
    const view = rt.view!;
    // the lead: departBlock, the debit from aboard(), capture, depart
    expect(carts.departBlock()).toBeNull();
    const debit = carts.aboard().find(c => c.uid === 'cart:ride')!;
    debit.units -= 4; // (the departure debit mutates the live units)
    carts.captureCargo();
    void ride.depart();
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    const g = carts.viewOf('cart:ride')!;
    expect(g.parent).toBe(view.root);
    // the cargo is where the car is (incl. its jostle): carToWorld(car pose, local)
    const expectAt = () => {
      const w = carToWorld(ride.pose, rec.x, rec.y, rec.z), v = g.getWorldPosition(new THREE.Vector3());
      expect(v.distanceTo(new THREE.Vector3(w.x, w.y, w.z))).toBeLessThan(1e-6);
    };
    view.root.updateMatrixWorld(true);
    expectAt();
    // the riding player walks at the cargo: stopped at its footprint (car-local)
    const L = ride.local, dx = rec.x - L.x, dz = rec.z - L.z;
    h.player.yaw = ride.pose.yaw + Math.atan2(-dx, -dz);
    h.keys.held.add('KeyW');
    let minGap = Infinity;
    run(h, 4, () => { minGap = Math.min(minGap, Math.hypot(ride.local.x - rec.x, ride.local.z - rec.z)); return false; });
    h.keys.held.clear();
    expect(minGap).toBeGreaterThanOrEqual(h.player.radius + CART.radius - 1e-6);
    // the old world goes: the cargo stays in the held view; the platform cart stays in the old station's records
    teardown(h);
    expect(rt.view).toBe(view);
    expect(g.parent).toBe(view.root);
    expect(view.root.parent).toBe(h.scene);
    expect(carts.cargo().map(c => [c.uid, c.units, c.x, c.z])).toEqual([['cart:ride', 2, rec.x, rec.z]]);
    expect(carts.stationRecords().map(c => [c.uid, c.units])).toEqual([['cart:left', 3]]);
    run(h, 2); // (between the worlds the car keeps running)
    view.root.updateMatrixWorld(true);
    expectAt();
    // the next station is built while riding: the cargo is still riding; the lead hands its (no) carts over
    build(h, B, false);
    carts.loadStation([]);
    expect(carts.all().map(c => [c.uid, c.mode])).toEqual([['cart:ride', 'cargo']]);
    expect(carts.stationRecords()).toEqual([]);
    const p2 = h.trainPlacement!;
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.2);
    // stopped: an ordinary cart in the new station's parked car, at trainToWorld(new placement, local)
    const c = carts.all().find(k => k.uid === 'cart:ride')!;
    expect(c.mode).toBe('world');
    const w = trainToWorld(p2, rec.x, rec.y, rec.z);
    expect(Math.hypot(c.x - w.x, c.z - w.z)).toBeLessThan(1e-3);
    expect(c.y).toBeCloseTo(p2.floorY, 3);
    expect(c.owner).toBe('train');
    expect(g.parent).toBe(carts.group);
    expect(carts.cargo().map(k => [k.uid, k.units, k.x, k.z])).toEqual([['cart:ride', 2, rec.x, rec.z]]);
    expect(carts.stationRecords()).toEqual([]);
    expect(ride.model.props.props.some(pp => pp.round)).toBe(false); // the ride's collision model is its own again
    onceEach(carts);
    // and it is a normal cart again: the player can grab it
    const b = carts.bodyOf('cart:ride')!;
    const near = trainToWorld(p2, rec.x + 1.3, SPEC.floorY, rec.z);
    h.player.place(near.x, near.z, 0, p2.floorY);
    frame(h);
    lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z);
    frame(h);
    expect(carts.prompt).toMatch(/Hold \[E\]<\/b> Drag the fuel cart · ½ tank/);
    void DT;
  }, 120000);

  it('a ride that starts with carts aboard captures them even when the lead did not; a refused departure releases them in place', async () => {
    const {h, carts, ride, rt} = station();
    carts.restore([cargoRec('cart:auto', -3, 0.6)]);
    frame(h);
    const before = carts.all()[0];
    // block a door so the closing fails (the player stands in the doorway)
    const di = rt.train!.doors.findIndex(d => d.col.door.side === -1);
    rt.setDoor(di, true);
    run(h, 2);
    let res: {status: string; reason?: string} | null = null;
    void ride.depart().then(r => { res = r; });
    frame(h);
    expect(carts.all()[0].mode).toBe('cargo'); // captured on the ride's first frame
    // the doors close normally here (nobody in the doorway): reset instead, as a refusal would
    ride.reset();
    await Promise.resolve();
    expect(res).toMatchObject({status: 'refused'});
    run(h, 0.1);
    const after = carts.all()[0];
    expect(after.mode).toBe('world');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-3);
    onceEach(carts);
  });
});
