// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the train equipment as CARGO and its OWNERSHIP (world/trainEquipment.ts)
// with the REAL train runtime + ride + Player (helpers/trainEquipmentHost.ts):
//  - the rule: a unit wholly inside the parked car is the train's (train-local records), any other the station's (world records) — each
//    unit exactly once; aboard poses round-trip at both parked yaws (0 / PI);
//  - departBlock(): a unit in a doorway, more than EQUIPMENT_LIMITS.aboard aboard, more than .station left behind; a save's bound;
//  - captureCargo() / releaseCargo() idempotent; the ride's car-local collision gets the units' footprints only while captured;
//  - a whole journey to ANOTHER station: the units ride the car's view through the departure, the teardown, the transit and the next
//    build and stand in the NEW parked car with poses, plug, ammo and chest contents identical — no plug event, no toast; plugged() kept
//    and active() null while riding; the units left on the platform stay in the old station's lane;
//  - a ride that starts captures by itself; a refused departure releases in place;
//  - NO PER-KIND LISTS: EQUIPMENT_KINDS enumerated at run time, every kind driven through craft -> cargo -> station -> lane -> restore;
//    the system's source names no kind (the route radar's one contract method aside).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld, worldToTrain} from '../src/gen/playerTrain';
import {
  EQUIPMENT, EQUIPMENT_KINDS, EQUIPMENT_LIMITS, STATION_EQUIPMENT_LANE, equipmentProblem, stationEquipmentOf, stationEquipmentProblem,
  trainEquipmentProblem, type EquipmentJSON, type EquipmentKind,
} from '../src/craft/equipment';
import type {EquipmentUnit} from '../src/craft/equipmentApi';
import {equipmentPlugs} from '../src/craft/trainFixtures';
import {cartAboard, cartStraddles} from '../src/fuel/trainPort';
import type {StackJSON} from '../src/items/inventory';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {carToWorld, fromStep} from '../src/world/trainRideLocal';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import {EQUIP, EQUIPMENT_TEXT, type LiveUnit, type TrainEquipmentSystem} from '../src/world/trainEquipment';
import {build, flatRoom, frame, press, run, teardown} from './helpers/fuelCartsHost';
import {
  aboardRec, equipRoom, equipStation, fakePlacement, holdE, loadAboard, localOf, lookAtUnit, platformWorld, plugSpot, putLocal, stand, stationRec,
  type EquipTestHost,
} from './helpers/trainEquipmentHost';

installCanvasShim(false);

const cache = new Map<string, StationLayout>();
const lay = (tag: string, make: () => StationLayout) => { let l = cache.get(tag); if (!l) cache.set(tag, (l = make())); return l; };
const SUBWAY = () => lay('subway', () => LEVELS.subway.generate('main', {levelSeed: 4242}));
const OFFICE = () => lay('office', () => LEVELS.office.generate('main', {levelSeed: 4242}));
const live: PlayerTrainRuntime[] = [];
afterEach(() => { for (const rt of live.splice(0)) if (rt.train) { rt.ride = null; rt.teardown(); } });

function station(L = SUBWAY(), o: Parameters<typeof equipStation>[1] = {}) {
  const s = equipStation(L, o);
  live.push(s.rt);
  return s;
}

const dollyKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'dolly');
const carryKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].move === 'carry');
const plugKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].plug);
const hopperKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].ammoCap > 0);
const storeKinds = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].slots > 0);

/** `n` legal stacks in a store of `size` slots (uids from `uid0`), scattered over the slots. */
function stacks(size: number, uid0: number, n = 4): (StackJSON | null)[] {
  const out = new Array<StackJSON | null>(size).fill(null);
  const pool: StackJSON[] = [
    {uid: uid0, itemId: 'ammo_9mm', count: 77}, {uid: uid0 + 1, itemId: 'bandage', count: 3}, {uid: uid0 + 2, itemId: 'pistol', count: 1, mag: 5},
    {uid: uid0 + 3, itemId: 'beans', count: 2}, {uid: uid0 + 4, itemId: 'ammo_556', count: 120}, {uid: uid0 + 5, itemId: 'water', count: 1},
  ];
  for (let i = 0; i < Math.min(n, pool.length); i++) out[(i * 7 + 3) % size] = pool[i];
  return out;
}

/** Data a record of `kind` can carry (whatever its traits allow): rounds in the hopper, stacks in the store. */
function loaded(kind: EquipmentKind, uid0: number): Partial<EquipmentJSON> {
  const def = EQUIPMENT[kind], x: Partial<EquipmentJSON> = {};
  if (def.ammoCap) x.ammo = Math.min(def.ammoCap, 137);
  if (def.slots) x.slots = stacks(def.slots, uid0);
  return x;
}

const uids = (xs: readonly {uid: string}[]) => xs.map(x => x.uid);

/** Every live unit exactly once across the train's records and the station's. */
function onceEach(eq: TrainEquipmentSystem): void {
  const all = uids(eq.all()).sort();
  const split = [...uids(eq.aboard()), ...uids(eq.stationRecords())].sort();
  expect(split).toEqual(all);
  expect(new Set(all).size).toBe(all.length);
}

/** A live world unit onto the platform at train-local (lx, lz) (a test's hand). */
function toPlatform(h: EquipTestHost, u: LiveUnit, lx: number, lz: number): void {
  const w = platformWorld(h, lx, lz), b = u.body;
  b.x = w.x; b.y = w.y; b.z = w.z; b.vx = b.vz = 0; b.level = h.trainPlacement!.level;
  u.awake = false; u.plugCheck = true;
}

describe('train equipment: ownership by position', () => {
  for (const front of [1, -1] as const) {
    it(`front ${front}: a record -> a live unit at trainToWorld(local) -> the same record (pose, yaw, rounds, stacks)`, () => {
      const p = fakePlacement(front, 3.5, 3.5);
      const {h, eq} = equipRoom(flatRoom(), p);
      const recs = EQUIPMENT_KINDS.map((k, i) => aboardRec(k, i + 1, [-2.1, -0.8, 0.5, 1.8, 2.4][i % 5], i % 2 ? 0.45 : -0.5, [0, 0.7, -2.4, 3.1][i % 4], loaded(k, 100 + i * 10)));
      loadAboard(h, recs);
      expect(eq.units().map(u => u.uid)).toEqual(uids(recs));
      for (const r of recs) {
        const u = eq.unit(r.uid)!, w = trainToWorld(p, r.x, r.y, r.z);
        expect(u.mode).toBe('world');
        expect([u.body.x, u.body.y, u.body.z]).toEqual([expect.closeTo(w.x, 9), expect.closeTo(0, 9), expect.closeTo(w.z, 9)]);
        expect(Math.cos(u.body.yaw - (r.yaw + p.yaw))).toBeCloseTo(1, 9);
        // drawn where it stands
        expect(u.view.group.position.distanceTo(new THREE.Vector3(w.x, 0, w.z))).toBeLessThan(1e-9);
        expect(u.view.group.parent).toBe(eq.group);
        expect(u.worldPose()).toMatchObject({x: u.body.x, y: u.body.y, z: u.body.z, level: 0});
      }
      expect(eq.aboard()).toEqual(recs);
      expect(eq.stationRecords()).toEqual([]);
      expect(h.playerTrain.equipment.toJSON()).toEqual({v: 1, seq: recs.length, aboard: recs});
      expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
      run(h, 0.3);
      expect(eq.aboard()).toEqual(recs); // (standing still changes nothing)
      onceEach(eq);
    });
  }

  it('wholly inside the parked car = the train\'s; in a doorway / on the platform / down in the bed = the station\'s; each unit once', () => {
    const {h, eq} = station();
    const p = h.trainPlacement!, door = SPEC.doors.find(d => d.side === -1 && Math.abs(d.x) < 1)!;
    const HW = SPEC.interior.halfWidth;
    const kind = dollyKinds[0], r = EQUIPMENT[kind].radius;
    loadAboard(h, [aboardRec(kind, 1, -3, 0.3), aboardRec(kind, 2, 2.5, -(HW - r)), aboardRec(kind, 3, 4.2, 0), ...carryKinds.map((k, i) => aboardRec(k, 4 + i, -1.2 - i, 0.4))]);
    run(h, 0.2);
    const n = eq.units().length;
    expect(uids(eq.aboard())).toHaveLength(n); // (also the one resting against the lining)
    expect(eq.stationRecords()).toEqual([]);
    expect(eq.all().every(x => x.owner === 'train')).toBe(true);
    const a = eq.unit('eq-1')!, b = eq.unit('eq-2')!, c = eq.unit('eq-3')!;
    // in the doorway: its footprint crosses the car's outline -> not the train's (and a departure is refused: below)
    putLocal(h, a, door.x, -HW);
    expect(cartStraddles(door.x, -HW, r, SPEC)).toBe(true);
    // on the platform
    toPlatform(h, b, door.x + 1.5, -2.9);
    // down in the track bed beside the car (the far side): under the floor line, not the train's
    const bed = trainToWorld(p, 2.5, SPEC.floorY, 2.6);
    c.body.x = bed.x; c.body.z = bed.z; c.body.y = h.levels!.floorAt(bed.x, bed.z, p.railTopY + 0.3); c.plugCheck = true;
    run(h, 0.2);
    expect(uids(eq.stationRecords())).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(uids(eq.aboard())).toEqual(eq.units().slice(3).map(u => u.uid));
    for (const rec of eq.stationRecords()) {
      expect(equipmentProblem(rec, true)).toBeNull();
      expect(rec.level).toBe(p.level);
      expect(rec.plug).toBeUndefined();
      const u = eq.unit(rec.uid)!;
      expect([rec.x, rec.y, rec.z]).toEqual([expect.closeTo(u.body.x, 4), expect.closeTo(u.body.y, 4), expect.closeTo(u.body.z, 4)]);
    }
    for (const rec of eq.aboard()) {
      expect(equipmentProblem(rec, false)).toBeNull();
      expect(rec.y).toBe(SPEC.floorY);
      expect(cartAboard(rec.x, rec.z, EQUIPMENT[rec.kind].radius - EQUIP.ownMargin, SPEC)).toBe(true);
    }
    expect(eq.all().filter(x => x.owner === 'station').map(x => x.uid)).toEqual(['eq-1', 'eq-2', 'eq-3']);
    expect(eq.storesAboard().map(s => s.uid)).toEqual(eq.units().filter(u => u.store).map(u => u.uid));
    onceEach(eq);
    // a chest carried out is no longer one of the train's stores
    const chest = eq.units().find(u => u.store)!;
    toPlatform(h, chest, door.x - 1.5, -2.9);
    expect(eq.storesAboard().map(s => s.uid)).not.toContain(chest.uid);
    expect(uids(eq.stationRecords())).toContain(chest.uid);
    onceEach(eq);
  });
});

describe('train equipment: what refuses a departure', () => {
  it('a unit in a doorway (any kind): "push it all the way in or out"; wholly in or wholly out is fine', () => {
    const {h, eq} = station();
    const door = SPEC.doors.find(d => d.side === -1 && Math.abs(d.x) < 1)!, HW = SPEC.interior.halfWidth;
    loadAboard(h, EQUIPMENT_KINDS.map((k, i) => aboardRec(k, i + 1, -3 + i * 0.9, 0.4)));
    run(h, 0.2);
    expect(eq.departBlock()).toBeNull();
    for (const u of eq.units()) {
      const home = localOf(h, u), r = u.def.radius;
      putLocal(h, u, door.x, -HW);
      expect(eq.departBlock()).toBe(EQUIPMENT_TEXT.straddle(u.def.the));
      expect(eq.departBlock()).toMatch(/in the doorway — push it all the way in or out$/);
      putLocal(h, u, door.x, -(HW - r - 0.02)); // just inside
      expect(eq.departBlock()).toBeNull();
      expect(uids(eq.aboard())).toContain(u.uid);
      toPlatform(h, u, door.x, -(SPEC.width / 2 + r + 0.1)); // just outside
      expect(eq.departBlock()).toBeNull();
      expect(uids(eq.stationRecords())).toContain(u.uid);
      putLocal(h, u, home.x, home.z);
    }
    onceEach(eq);
  });

  it('more than EQUIPMENT_LIMITS.aboard in the car; the limit itself rides; a save never holds more than the limit', () => {
    const kind = dollyKinds[0], N = EQUIPMENT_LIMITS.aboard;
    const A = SUBWAY(), p = playerTrainPlacement(A)!;
    const out = trainToWorld(p, 2, SPEC.floorY, -3);
    const {h, eq} = station(A, {here: [stationRec(carryKinds[0], N + 1, out.x, p.floorY, out.z, 0, p.level, loaded(carryKinds[0], 500))]});
    const recs: EquipmentJSON[] = [];
    for (let i = 0; i < N; i++) recs.push(aboardRec(kind, i + 1, -4.4 + Math.floor(i / 2) * 0.78, i % 2 ? 0.62 : -0.62));
    loadAboard(h, recs);
    run(h, 0.2);
    expect(eq.aboard()).toHaveLength(N);
    expect(eq.departBlock()).toBeNull();
    // one more rolled in from the platform
    const extra = eq.unit(`eq-${N + 1}`)!;
    expect(uids(eq.stationRecords())).toEqual([extra.uid]);
    putLocal(h, extra, -5.3, 0);
    expect(eq.all().find(x => x.uid === extra.uid)!.owner).toBe('train');
    expect(eq.departBlock()).toBe(EQUIPMENT_TEXT.tooMany(N + 1, N));
    expect(eq.craftBlock(kind)).toBe(EQUIPMENT_TEXT.tooMany(N + 1, N));
    // a save taken now (the ending: no departure) stays valid: the newest unit is recorded where it stands, with the station
    expect(eq.aboard()).toHaveLength(N);
    expect(uids(eq.stationRecords())).toEqual([extra.uid]);
    expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
    onceEach(eq);
    eq.flush();
    const lane = h.run.laneStore(STATION_EQUIPMENT_LANE);
    expect(stationEquipmentProblem(lane)).toBeNull();
    expect(stationEquipmentOf(lane).map(r => [r.uid, r.slots])).toEqual([[extra.uid, loaded(carryKinds[0], 500).slots]]);
    // ... and after a teardown + build it stands in the car again (the same spot), still counted
    const at = {x: extra.body.x, z: extra.body.z};
    teardown(h);
    expect(h.playerTrain.equipment.toJSON().aboard).toHaveLength(N);
    build(h, A);
    run(h, 0.2);
    const again = eq.unit(`eq-${N + 1}`)!;
    expect([again.body.x, again.body.z]).toEqual([expect.closeTo(at.x, 3), expect.closeTo(at.z, 3)]);
    expect(eq.units()).toHaveLength(N + 1);
    expect(eq.departBlock()).toBe(EQUIPMENT_TEXT.tooMany(N + 1, N));
    // rolled out again: the departure is free
    toPlatform(h, again, 2, -3);
    expect(eq.departBlock()).toBeNull();
    expect(eq.craftBlock(kind)).toBe(EQUIPMENT_TEXT.tooMany(N, N));
  });

  it('more than EQUIPMENT_LIMITS.station left lying in the station', () => {
    const A = SUBWAY(), p = playerTrainPlacement(A)!, M = EQUIPMENT_LIMITS.station;
    const here: EquipmentJSON[] = [];
    for (let i = 0; i < M; i++) {
      const w = trainToWorld(p, -6 + (i % 16) * 0.8, SPEC.floorY, -2.6 - Math.floor(i / 16) * 0.8);
      here.push(stationRec(EQUIPMENT_KINDS[i % EQUIPMENT_KINDS.length], i + 2, w.x, p.floorY, w.z, 0, p.level));
    }
    const {h, eq} = station(A, {here});
    loadAboard(h, [aboardRec(dollyKinds[0], 1, -3, 0.3)]);
    run(h, 0.1);
    expect(eq.units()).toHaveLength(M + 1);
    expect(eq.stationRecords()).toHaveLength(M);
    expect(eq.departBlock()).toBeNull();
    toPlatform(h, eq.unit('eq-1')!, 5, -5.2);
    expect(eq.departBlock()).toBe(EQUIPMENT_TEXT.stationFull(M + 1, M));
    putLocal(h, eq.unit('eq-1')!, -3, 0.3);
    expect(eq.departBlock()).toBeNull();
  });
});

describe('train equipment: capture / release and the ride', () => {
  it('captureCargo / releaseCargo are idempotent; the ride model collides with the cargo only while captured', () => {
    const {h, eq, rt, ride} = station();
    const s = plugSpot(0);
    loadAboard(h, [aboardRec(plugKinds[0], 1, s.x, s.z, 0.25), ...carryKinds.map((k, i) => aboardRec(k, 2 + i, 3, 0.5 - i, 1, loaded(k, 40)))]);
    run(h, 0.2);
    const outside = eq.craft(dollyKinds[0])!;
    toPlatform(h, outside, 3.5, -2.8);
    frame(h);
    const a = eq.unit('eq-1')!;
    expect(a.plug).toBe(0);
    const before = eq.all(), aboard0 = eq.aboard(), props0 = ride.model.props;
    const nIn = aboard0.length;
    const events: unknown[] = [];
    eq.plugListeners.push((u: EquipmentUnit, on: boolean) => { events.push([u.uid, on]); });
    eq.captureCargo();
    eq.captureCargo();
    expect(eq.counts.captured).toBe(nIn);
    for (const u of eq.units()) {
      if (u === outside) { expect(u.mode).toBe('world'); expect(u.view.group.parent).toBe(eq.group); continue; }
      expect(u.mode).toBe('cargo');
      expect(u.view.group.parent).toBe(rt.view!.root);
      const was = before.find(x => x.uid === u.uid)!;
      expect(u.view.group.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(was.x, was.y, was.z))).toBeLessThan(1e-3);
      expect(u.worldPose()).toMatchObject({x: expect.closeTo(was.x, 3), y: expect.closeTo(was.y, 3), z: expect.closeTo(was.z, 3)});
    }
    expect(eq.aboard()).toEqual(aboard0);
    expect(a.plug).toBe(0); // the plug is kept on the way
    expect(eq.plugged(a.kind)).toBe(a);
    expect(eq.fixtures.cables[0].mesh.visible).toBe(true);
    // one round column per captured unit, at its train-local spot with its own radius
    expect(ride.model.props).not.toBe(props0);
    const cols = ride.model.props.props.filter(pp => pp.round);
    expect(cols).toHaveLength(nIn);
    for (const u of eq.units()) {
      if (u.mode !== 'cargo') continue;
      const col = cols.find(pp => { const [lx, lz] = fromStep(pp.x, pp.z); return Math.abs(lx - u.local.x) < 1e-9 && Math.abs(lz - u.local.z) < 1e-9; })!;
      expect(col).toBeDefined();
      expect([col.hx, col.hz]).toEqual([u.def.radius, u.def.radius]);
    }
    // cargo is not aimed at / grabbed / shot / carried by a lift
    expect(eq.bulletHit({t: 30}, new THREE.Vector3(a.body.x + 15, a.body.y + 0.5, a.body.z), new THREE.Vector3(1, 0, 0), 20)).toBe(false);
    expect(eq.carry(() => true, 1, 3)).toBe(1); // (the one left outside)
    outside.body.y -= 1; outside.body.level = h.trainPlacement!.level;
    eq.releaseCargo();
    eq.releaseCargo();
    expect(eq.counts.released).toBe(nIn);
    expect(ride.model.props).toBe(props0);
    for (const u of eq.units()) {
      expect(u.mode).toBe('world');
      expect(u.view.group.parent).toBe(eq.group);
      const was = before.find(x => x.uid === u.uid)!;
      expect(Math.hypot(u.body.x - was.x, u.body.z - was.z)).toBeLessThan(1e-3);
    }
    run(h, 0.2);
    expect(eq.aboard()).toEqual(aboard0);
    expect(events).toEqual([]);
    expect(h.toasts).toEqual([]);
    // captured but no ride follows: released in place after the grace period
    eq.captureCargo();
    expect(a.mode).toBe('cargo');
    run(h, EQUIP.captureGrace + 0.2);
    expect(a.mode).toBe('world');
    expect(ride.model.props).toBe(props0);
    expect(eq.aboard()).toEqual(aboard0);
    onceEach(eq);
  });

  it('a whole journey: the units ride the car to ANOTHER station and stand in its parked car — poses, plugs, rounds and stacks identical', async () => {
    const A = SUBWAY(), B = OFFICE();
    const pA = playerTrainPlacement(A)!;
    // left on the platform of A: a filled chest and a device (whatever kinds the table has)
    const left = [carryKinds[0], dollyKinds[0]].map((k, i) => {
      const w = trainToWorld(pA, 1.5 + i * 1.5, SPEC.floorY, -2.9);
      return stationRec(k, 20 + i, w.x, pA.floorY, w.z, 0.3 * (i + 1), pA.level, loaded(k, 300 + i * 10));
    });
    const {h, eq, rt, ride} = station(A, {here: left});
    // aboard: a device on each of two plugs, one out of every plug's reach, a filled chest
    const s0 = plugSpot(0), s2 = plugSpot(2);
    const kA = plugKinds[0], kB = hopperKinds.find(k => EQUIPMENT[k].plug) ?? plugKinds[plugKinds.length - 1], kC = plugKinds[1 % plugKinds.length];
    const recs = [
      aboardRec(kA, 1, s0.x, s0.z, 0, loaded(kA, 100)),
      aboardRec(kB, 2, s2.x, s2.z, 3.1, loaded(kB, 110)),
      aboardRec(kC, 3, -3.9, -0.5, 1.2, loaded(kC, 120)),
      aboardRec(carryKinds[0], 4, 3.6, 0.5, 0.7, loaded(carryKinds[0], 130)),
    ];
    loadAboard(h, recs);
    run(h, 0.3);
    const events: unknown[] = [];
    eq.plugListeners.push((u: EquipmentUnit, on: boolean) => { events.push([u.uid, on]); });
    const view = rt.view!;
    const before = eq.aboard();
    expect(before.map(r => [r.uid, r.plug])).toEqual([['eq-1', 0], ['eq-2', 2], ['eq-3', undefined], ['eq-4', undefined]]);
    expect(before.map(r => ({...r, plug: undefined}))).toEqual(recs.map(r => ({...r, plug: undefined})));
    expect(eq.active(kA)).toBe(eq.unit('eq-1'));
    expect(uids(eq.stationRecords())).toEqual(['eq-20', 'eq-21']);
    expect(eq.departBlock()).toBeNull();
    h.toasts.length = 0;

    // the ride starts: Game does not ask — the units aboard are captured on the ride's first frame
    void ride.depart();
    frame(h);
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'cargo'], ['eq-2', 'cargo'], ['eq-3', 'cargo'], ['eq-4', 'cargo'], ['eq-20', 'world'], ['eq-21', 'world']]);
    expect(eq.aboard()).toEqual(before);
    run(h, 80, () => ride.phase === 'transit');
    expect(ride.phase).toBe('transit');
    // riding: plugged() kept, active() off, no prompt / E / craft
    expect(eq.plugged(kA)).toBe(eq.unit('eq-1'));
    expect(eq.active(kA)).toBeNull();
    for (const k of EQUIPMENT_KINDS) { expect(eq.active(k)).toBeNull(); expect(eq.craftBlock(k)).toBe(EQUIPMENT_TEXT.moving); }
    expect(eq.prompt).toBeNull();
    expect(eq.pickAim() === null || eq.onInteract() === false).toBe(true);
    expect(eq.storesAboard()).toEqual([]); // (no store view while the train rides)
    // the cargo is where the car is: carToWorld(car pose, local) — the drawn view and worldPose()
    const chest = eq.unit('eq-4')!, g = chest.view.group;
    const expectAt = (world: boolean) => {
      view.root.updateMatrixWorld(true);
      const w = carToWorld(ride.pose, recs[3].x, recs[3].y, recs[3].z), v = g.getWorldPosition(new THREE.Vector3());
      expect(v.distanceTo(new THREE.Vector3(w.x, w.y, w.z))).toBeLessThan(1e-6);
      const wp = chest.worldPose();
      if (!world) { expect(wp).toBeNull(); return; } // (between two stations there is no world to stand in)
      expect(Math.hypot(wp!.x - w.x, wp!.z - w.z)).toBeLessThan(0.05);
    };
    expect(g.parent).toBe(view.root);
    expectAt(true);
    // the riding player walks at the chest: stopped at its footprint (car-local)
    const L = ride.local, dx = recs[3].x - L.x, dz = recs[3].z - L.z;
    h.player.yaw = ride.pose.yaw + Math.atan2(-dx, -dz);
    h.keys.held.add('KeyW');
    let minGap = Infinity;
    run(h, 4, () => { minGap = Math.min(minGap, Math.hypot(ride.local.x - recs[3].x, ride.local.z - recs[3].z)); return false; });
    h.keys.held.clear();
    expect(minGap).toBeGreaterThanOrEqual(h.player.radius + chest.def.radius - 1e-6);
    expect(minGap).toBeLessThan(h.player.radius + chest.def.radius + 0.1);

    // the old world goes: the cargo stays on the held view; the platform's units go into A's lane
    teardown(h);
    expect(rt.view).toBe(view);
    expect(g.parent).toBe(view.root);
    expect(eq.fixtures.group.parent).toBe(view.root); // the sockets and cables ride along
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'cargo'], ['eq-2', 'cargo'], ['eq-3', 'cargo'], ['eq-4', 'cargo']]);
    expect(eq.aboard()).toEqual(before);
    expect(h.playerTrain.equipment.toJSON().aboard).toEqual(before); // (the departure save)
    expect(trainEquipmentProblem(h.playerTrain.equipment.toJSON())).toBeNull();
    const laneA = h.run.laneStore(STATION_EQUIPMENT_LANE);
    expect(stationEquipmentProblem(laneA)).toBeNull();
    expect(stationEquipmentOf(laneA).map(r => ({...r, x: 0, y: 0, z: 0}))).toEqual(left.map(r => ({...r, x: 0, y: 0, z: 0})));
    for (const [i, r] of stationEquipmentOf(laneA).entries()) expect(Math.hypot(r.x - left[i].x, r.z - left[i].z)).toBeLessThan(1e-3);
    expect(eq.plugged(kA)).toBe(eq.unit('eq-1'));
    run(h, 2); // (between the worlds the car keeps running)
    expectAt(false);
    expect(eq.aboard()).toEqual(before);

    // the next station is built while riding: still cargo; B has no lane
    const keyA = {...h.run.current};
    h.run.current = {level: 'office', section: 'main'};
    build(h, B, false);
    expect(eq.units().map(u => [u.uid, u.mode])).toEqual([['eq-1', 'cargo'], ['eq-2', 'cargo'], ['eq-3', 'cargo'], ['eq-4', 'cargo']]);
    expect(eq.stationRecords()).toEqual([]);
    expect(h.run.laneStore(STATION_EQUIPMENT_LANE)).toBeUndefined();
    const p2 = h.trainPlacement!;
    let arr: {status: string} | null = null;
    void ride.arrive().then(r => { arr = r; });
    run(h, 150, () => !ride.riding);
    await Promise.resolve();
    expect(arr).toMatchObject({status: 'stopped'});
    run(h, 0.3);

    // stopped: ordinary units in B's parked car at trainToWorld(new placement, local), everything else identical
    expect(eq.units().every(u => u.mode === 'world')).toBe(true);
    for (const r of recs) {
      const u = eq.unit(r.uid)!, w = trainToWorld(p2, r.x, r.y, r.z);
      expect(Math.hypot(u.body.x - w.x, u.body.z - w.z)).toBeLessThan(1e-3);
      expect(u.body.y).toBeCloseTo(p2.floorY, 3);
      expect(u.body.level).toBe(p2.level);
      expect(Math.cos(u.body.yaw - (r.yaw + p2.yaw))).toBeCloseTo(1, 6);
      expect(u.view.group.parent).toBe(eq.group);
      expect(u.awake).toBe(false);
    }
    expect(eq.aboard()).toEqual(before);
    expect(eq.all().every(x => x.owner === 'train')).toBe(true);
    expect(eq.stationRecords()).toEqual([]);
    expect(events).toEqual([]); // no plug event the whole way
    expect(h.toasts).toEqual([]);
    expect(eq.active(kA)).toBe(eq.unit('eq-1'));
    expect(eq.active(kB)).toBe(eq.unit('eq-2'));
    expect(eq.storesAboard().map(s => s.uid)).toEqual(['eq-4']);
    expect(eq.storesAboard()[0].slots).toBe(chest.slots);
    expect(chest.store!.toJSON().slots).toEqual(recs[3].slots);
    expect(ride.model.props.props.some(pp => pp.round)).toBe(false); // the ride's collision model is its own again
    expect(eq.counts.captured).toBe(4);
    expect(eq.counts.released).toBe(4);
    // the cables reach the units at their sockets again
    for (const e of equipmentPlugs(SPEC)) expect(eq.fixtures.cables[e.index].mesh.visible).toBe(e.index !== 1);
    expect(eq.fixtures.group.parent).toBe(rt.view!.root);
    onceEach(eq);
    // and they are normal units again: the player grabs one (holding E)
    const u = eq.unit('eq-3')!;
    const near = trainToWorld(p2, recs[2].x + 1.2, SPEC.floorY, recs[2].z);
    u.body.yaw = Math.atan2(u.body.x - near.x, u.body.z - near.z);
    stand(h, near.x, near.z, 0, p2.floorY);
    frame(h);
    lookAtUnit(h, u, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
    frame(h);
    expect(eq.prompt).toBe(EQUIPMENT_TEXT.drag(u.def.the, EQUIPMENT_TEXT.plugHint));
    holdE(h);
    expect(eq.grab?.unit).toBe(u);
    press(h, 'KeyE');

    // B is left behind too; back at A the platform's units stand where they were left, with their contents
    teardown(h);
    expect(stationEquipmentOf(h.run.laneStore(STATION_EQUIPMENT_LANE))).toEqual([]);
    h.run.current = keyA;
    build(h, A);
    run(h, 0.2);
    expect(uids(eq.stationRecords())).toEqual(['eq-20', 'eq-21']);
    expect(eq.stationRecords().map(r => ({...r, x: 0, y: 0, z: 0}))).toEqual(left.map(r => ({...r, x: 0, y: 0, z: 0})));
    expect(uids(eq.aboard())).toEqual(['eq-1', 'eq-2', 'eq-3', 'eq-4']);
    onceEach(eq);
  }, 120000);

  it('a ride that starts captures the units aboard by itself; a refused departure releases them where they stood', async () => {
    const {h, eq, ride} = station();
    loadAboard(h, EQUIPMENT_KINDS.map((k, i) => aboardRec(k, i + 1, -3.5 + i * 1.1, 0.5, 0.4, loaded(k, 60 + i * 10))));
    run(h, 0.2);
    const before = eq.all(), aboard0 = eq.aboard();
    let res: {status: string; reason?: string} | null = null;
    void ride.depart().then(r => { res = r; });
    frame(h);
    expect(eq.units().every(u => u.mode === 'cargo')).toBe(true);
    expect(ride.model.props.props.filter(pp => pp.round)).toHaveLength(EQUIPMENT_KINDS.length);
    ride.reset(); // (as a refusal would)
    await Promise.resolve();
    expect(res).toMatchObject({status: 'refused'});
    run(h, 0.1);
    for (const u of eq.units()) {
      const was = before.find(x => x.uid === u.uid)!;
      expect(u.mode).toBe('world');
      expect(Math.hypot(u.body.x - was.x, u.body.z - was.z)).toBeLessThan(1e-3);
    }
    expect(ride.model.props.props.some(pp => pp.round)).toBe(false);
    expect(eq.aboard()).toEqual(aboard0);
    onceEach(eq);
  });

  it('a grabbed unit aboard is let go when the ride starts; a unit on the platform stays behind as the station\'s', () => {
    const {h, eq, ride} = station();
    const kind = dollyKinds[0];
    loadAboard(h, [aboardRec(kind, 1, -2, 0.2, Math.PI / 2), aboardRec(kind, 2, 2.5, 0.3)]);
    run(h, 0.2);
    const a = eq.unit('eq-1')!, b = eq.unit('eq-2')!;
    toPlatform(h, b, 3.5, -2.9);
    const p = h.trainPlacement!, at = trainToWorld(p, -0.9, SPEC.floorY, 0.2);
    a.body.yaw = Math.atan2(a.body.x - at.x, a.body.z - at.z);
    stand(h, at.x, at.z, 0, p.floorY);
    frame(h);
    lookAtUnit(h, a, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
    holdE(h);
    expect(eq.grab?.unit).toBe(a);
    void ride.depart();
    frame(h);
    frame(h);
    expect(eq.grab).toBeNull();
    expect(a.mode).toBe('cargo');
    expect(b.mode).toBe('world');
    expect(uids(eq.aboard())).toEqual(['eq-1']);
    expect(uids(eq.stationRecords())).toEqual(['eq-2']);
    expect(h.inputOwners.some(f => f())).toBe(false);
    ride.reset();
  });
});

describe('train equipment: one mechanism for every kind (no per-kind lists)', () => {
  it('every kind in the table at run time: craft -> filled -> cargo -> back -> out into the station -> the lane -> rebuilt -> the train\'s record wins', () => {
    expect(EQUIPMENT_KINDS.length).toBeGreaterThanOrEqual(2);
    expect([...EQUIPMENT_KINDS].sort()).toEqual(Object.keys(EQUIPMENT).sort());
    const A = SUBWAY();
    const {h, eq} = station(A);
    const want = new Map<string, Partial<EquipmentJSON>>();
    // craft one of each, then give each what its traits can hold
    for (const [i, kind] of EQUIPMENT_KINDS.entries()) {
      const u = eq.craft(kind)!;
      expect(u, kind).not.toBeNull();
      expect(u.kind).toBe(kind);
      expect(u.def).toBe(EQUIPMENT[kind]);
      const data = loaded(kind, 1000 + i * 10);
      if (data.ammo !== undefined) expect(u.setAmmo(data.ammo)).toBe(data.ammo);
      if (data.slots) { u.store!.load({v: 1, slots: data.slots}); u.touchStore(); }
      want.set(u.uid, data);
      // the traits, not the kind, decide what a unit has
      expect(u.slots === null).toBe(EQUIPMENT[kind].slots === 0);
      expect(u.setAmmo(1e9)).toBe(EQUIPMENT[kind].ammoCap);
      u.setAmmo(data.ammo ?? 0);
    }
    const same = (recs: EquipmentJSON[]) => {
      for (const r of recs) {
        const w = want.get(r.uid)!;
        expect(r.ammo, r.uid).toEqual(w.ammo);
        expect(r.slots, r.uid).toEqual(w.slots);
      }
    };
    const all = uids(eq.units());
    expect(all).toHaveLength(EQUIPMENT_KINDS.length);
    run(h, 0.2);
    const aboard0 = eq.aboard();
    expect(uids(aboard0)).toEqual(all);
    same(aboard0);
    for (const r of aboard0) expect(equipmentProblem(r, false)).toBeNull();
    // cargo and back
    eq.captureCargo();
    expect(eq.units().every(u => u.mode === 'cargo')).toBe(true);
    expect(eq.aboard()).toEqual(aboard0);
    eq.releaseCargo();
    expect(eq.units().every(u => u.mode === 'world')).toBe(true);
    expect(eq.aboard()).toEqual(aboard0);
    // out into the station
    for (const [i, u] of eq.units().entries()) toPlatform(h, u, -2 + i * 1.2, -3);
    run(h, 0.2);
    expect(eq.aboard()).toEqual([]);
    const st0 = eq.stationRecords();
    expect(uids(st0)).toEqual(all);
    same(st0);
    for (const r of st0) expect(equipmentProblem(r, true)).toBeNull();
    // the world goes and comes back: the lane
    teardown(h);
    expect(eq.units()).toEqual([]);
    expect(stationEquipmentOf(h.run.laneStore(STATION_EQUIPMENT_LANE))).toEqual(st0);
    expect(h.playerTrain.equipment.toJSON().aboard).toEqual([]);
    build(h, A);
    run(h, 0.2);
    expect(eq.stationRecords()).toEqual(st0);
    expect(eq.units().map(u => [u.uid, u.kind, u.plug])).toEqual(st0.map(r => [r.uid, r.kind, null]));
    // the train's record of the same units (an older save's): each unit once, in the car, with the record's data
    const recs = st0.map((r, i) => aboardRec(r.kind, Number(r.uid.slice(3)), Math.round((-3 + i * 1.1) * 1e4) / 1e4, 0.45, 0.2, want.get(r.uid)));
    eq.restore(recs);
    run(h, 0.2);
    expect(uids(eq.units())).toEqual(all);
    expect(eq.stationRecords()).toEqual([]);
    const back = eq.aboard();
    expect(back.map(r => ({...r, plug: undefined}))).toEqual(recs);
    same(back);
    onceEach(eq);
    // every plug kind found a plug by position alone (all stand within reach of some socket or not — never two on one)
    const taken = eq.units().map(u => u.plug).filter(x => x !== null);
    expect(new Set(taken).size).toBe(taken.length);
    for (const u of eq.units()) if (!u.def.plug) expect(u.plug).toBeNull();
  });

  it('the system\'s source names no kind: only the route radar\'s contract method reads one', () => {
    const src = readFileSync(new URL('../src/world/trainEquipment.ts', import.meta.url), 'utf8').split('\n');
    const code = src.map((l, i) => ({n: i + 1, text: l.replace(/\/\/.*$/, '')})).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(src[l.n - 1]));
    const hits = code.filter(l => EQUIPMENT_KINDS.some(k => new RegExp(`['"\`.]${k}\\b`).test(l.text)));
    expect(hits.map(l => l.text.trim())).toEqual([expect.stringMatching(/^routeRadius\(\): number \{ return this\.plugged\('radar'\)/)]);
    const model = readFileSync(new URL('../src/world/trainEquipmentModel.ts', import.meta.url), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, ''));
    expect(model.filter(l => EQUIPMENT_KINDS.some(k => new RegExp(`['"\`]${k}['"\`]`).test(l)))).toEqual([]);
  });
});

void worldToTrain;
void storeKinds;
