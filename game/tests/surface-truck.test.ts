// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the Surface Run truck through THE vehicle controller (world/skywaysCar.ts,
// Game's `skywaysCar`) with the REAL Player / ZombieBrain on the hand-built hall (tests/helpers/surfaceTruckHost.ts): picked from the
// layout (layout.surface.truck) or its record ('surface.truck', the record wins once saved); [E] in by a door, the seat's eye, W / S /
// A / D drive, "Stop the truck to get out", out at the left door, the record written; enclosed while seated (lane AIR); the road wheels
// roll by the distance and the two front axles steer; the hall's wall and a fixed prop stop it; it never takes a stair flight; zombies
// rammed above TRUCK_RT.killSpeed die through the real kill path, slower ones are shoved; the cargo seam (attachment points, the body
// transform, move listeners); the Skyways car unchanged in a car world with the truck registered (the trunk inert in a truck world).
import {describe, expect, it} from 'vitest';
import {CAR_DEF, CAR_RT, CAR_TEXT} from '../src/world/skywaysCar';
import {SKYWAYS_CAR_LANE} from '../src/world/skywaysCarStore';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CAR_PHYS, nearestCircle} from '../src/world/skywaysCarPhysics';
import {TrunkSystem, type TrunkHost} from '../src/world/skywaysCarTrunk';
import {TRUCK_CARGO_TEXT, TRUCK_DEF} from '../src/world/surface/truckVehicle';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_BED_FLOOR_Y} from '../src/world/surface/truckCab';
import {TRUCK_GEOM, TRUCK_LAMPS, TRUCK_PHYS, TRUCK_RT, TRUCK_SPEC, TRUCK_TEXT, TRUCK_WHEELS, TRUCK_WHEEL_RATIO} from '../src/world/surface/truckSpec';
import {SURFACE_TRUCK_LANE, emptyTruckStorage, surfaceTruckRecord, type SurfaceTruckRecord} from '../src/world/surface/truckStore';
import type {TruckView} from '../src/world/surface/truckModel';
import {HALL, prop} from './helpers/skywaysCarWorld';
import {build, frame, run, teardown, zombie} from './helpers/skywaysCarHost';
import {getInTruck, setTruckLayout, stopTruck, truckHost} from './helpers/surfaceTruckHost';

const S = TRUCK_SPEC;
/** The truck's nose / tail reach from its centre along the heading (the circles' extremes). */
const noseReach = -Math.min(...S.circles.map(c => c.z - c.r)), sideReach = Math.max(...S.circles.map(c => Math.abs(c.x ?? 0) + c.r));

describe('surface truck: one vehicle controller, picked per layout', () => {
  it('a Surface Run layout builds the truck at layout.surface.truck (its definition, anchors, stand-in view, its own beam), inert elsewhere', () => {
    const {h, car, pose} = truckHost();
    expect(car.vehicle).toBe('truck');
    expect(car.source).toBe('spawn');
    expect(car.spec).toBe(TRUCK_SPEC);
    expect(car.rt).toBe(TRUCK_RT);
    expect(car.text).toBe(TRUCK_TEXT);
    expect(car.body).toMatchObject({x: pose.x, z: pose.z, y: 0, level: 0, pitch: 0, v: 0});
    expect(car.body!.yaw).toBeCloseTo(pose.yaw, 9);
    expect(car.settled()).toBe(true);
    expect(car.view!.group.name).toBe('surface-truck');
    expect(car.view!.standIn).toBe(true); // (Node: no fetch; the GLB path is tests/surface-truck-asset.test.ts)
    expect((car.view as TruckView).roadWheels).toHaveLength(8);
    expect(car.beam!.light.name).toBe('surface-truck-beam');
    expect(car.beam!.light.parent).toBe(car.view!.group);
    expect(car.beam!.light.intensity).toBe(0);
    expect(car.lights).toBe(false);
    expect(car.storageJSON).toEqual(emptyTruckStorage());
    expect(car.enclosed).toBe(false);
    // a layout without either vehicle: nothing; the controller stays inert
    teardown(h);
    (h as {layout: unknown}).layout = {props: []};
    build(h);
    expect(car.worldLive).toBe(false);
    expect(car.vehicle).toBeNull();
    expect(car.body).toBeNull();
    expect(car.truckAttachPoints()).toEqual([]);
    expect(car.truckTransform()).toBeNull();
  });

  it('a Skyways layout still builds the CAR exactly (its definition, spec, tuning, beam) with the truck registered; each keeps its own beam', () => {
    const {h, car} = truckHost({skyways: true});
    expect(car.vehicle).toBe('car');
    expect(car.spec).toBe(CAR_SPEC);
    expect(car.rt).toBe(CAR_RT);
    expect(car.text).toBe(CAR_TEXT);
    expect(CAR_DEF.geom).toBe(CAR_SPEC); // (the physics steps the car's spec itself: CAR_PHYS, the stairs rule — as before)
    expect(CAR_DEF.geom.phys).toBeUndefined();
    expect(CAR_DEF.enclosed).toBe(false);
    expect(car.view!.group.name).toBe('skyways-car');
    expect(car.body).toMatchObject({x: 15, z: 15, yaw: 0});
    const carBeam = car.beam!;
    expect(carBeam.light.name).toBe('skyways-car-beam');
    expect(car.truckAttachPoints()).toEqual([]);
    expect(car.attachPoints()).toEqual([]);
    expect(car.cargoBlock()).toBeNull();
    expect(car.label).toBe('the vehicle');
    expect(car.enclosed).toBe(false);
    // to the district: the truck's own beam; back: the car's same light (stable programs per vehicle)
    teardown(h);
    setTruckLayout(h, {x: 8, z: 15, yaw: -Math.PI / 2, level: 0, y: 0});
    build(h);
    expect(car.vehicle).toBe('truck');
    const truckBeam = car.beam!;
    expect(truckBeam).not.toBe(carBeam);
    expect(carBeam.light.parent).toBeNull();
    teardown(h);
    setTruckLayout(h, null);
    build(h);
    expect(car.vehicle).toBe('car');
    expect(car.beam).toBe(carBeam);
    expect(truckBeam.light.parent).toBeNull();
  });

  it('the record wins once saved (pose, lamps, compartments); a malformed record or one that no longer fits falls back to the spawn', () => {
    const storage = emptyTruckStorage();
    storage[0][3] = {uid: 41, itemId: 'water', count: 2};
    const rec = surfaceTruckRecord(24, 0, 18, 0.4, 0, {lights: true, storage});
    const {h, car} = truckHost({build: false});
    h.store.set(SURFACE_TRUCK_LANE, structuredClone(rec));
    build(h);
    expect(car.source).toBe('record');
    expect(car.body).toMatchObject({x: 24, z: 18, level: 0});
    expect(car.body!.yaw).toBeCloseTo(0.4, 4);
    expect(car.lights).toBe(true);
    expect(car.beam!.light.intensity).toBe(TRUCK_LAMPS.beam.intensity);
    expect(car.storageJSON[0][3]).toEqual({uid: 41, itemId: 'water', count: 2});
    // malformed: the generated pose, a fresh truck
    teardown(h);
    h.store.set(SURFACE_TRUCK_LANE, {...rec, extra: 1});
    build(h);
    expect(car.source).toBe('spawn');
    expect(car.lights).toBe(false);
    expect(car.storageJSON).toEqual(emptyTruckStorage());
    // a pose that no longer fits (over the drop's edge): the spawn's pose, the truck's own state kept (never lost, never doubled)
    teardown(h);
    h.store.set(SURFACE_TRUCK_LANE, surfaceTruckRecord(30, 0, 15, -Math.PI / 2, 0, {lights: true, storage}));
    build(h);
    expect(car.source).toBe('spawn');
    expect(car.body).toMatchObject({x: 8, z: 15});
    expect(car.lights).toBe(true);
    expect(car.storageJSON[0][3]).toEqual({uid: 41, itemId: 'water', count: 2});
  });
});

describe('surface truck: the truck seat (the same controls as the controller\'s other vehicle)', () => {
  it('[E] by the left door: seated at the measured eye, enclosed, the hands busy; heavy acceleration; out only once stopped, at the left door', () => {
    const {h, car} = truckHost();
    getInTruck(h, car);
    const b = car.body!, eye = carToWorld(b.x, b.z, b.yaw, S.eye.x, S.eye.z);
    expect(h.player.x).toBeCloseTo(eye.x, 6);
    expect(h.player.z).toBeCloseTo(eye.z, 6);
    expect(h.player.eye).toBeCloseTo(S.eye.y, 6); // (2.0 m: a truck cab's seated eye)
    expect(car.prompt).toBe(TRUCK_TEXT.driving);
    expect(car.enclosed).toBe(true); // (lane AIR: the closed cab protects)
    expect(car.state()).toMatchObject({vehicle: 'truck', enclosed: true, driving: true});
    expect(h.inputOwners.some(f => f())).toBe(true);
    expect(car.refuseUse()).toBe(true);
    expect(h.gear.placeRules.some(f => f(0, 0, 0, 0) === TRUCK_TEXT.placeRule)).toBe(true);
    // W: heavy — slower to speed up than the car (CAR_PHYS.accel 7 vs TRUCK_PHYS.accel 3.4)
    h.keys.held.add('KeyW');
    run(h, car, 1);
    expect(car.body!.v).toBeGreaterThan(2.5);
    expect(car.body!.v).toBeLessThan(CAR_PHYS.accel * 0.6);
    expect(car.body!.x).toBeGreaterThan(8 + 1); // (yaw -PI / 2: forward = +X)
    expect(Math.abs(car.body!.z - 15)).toBeLessThan(1e-6);
    run(h, car, 1.6); // (past the refusal note's rate limit: refuseUse above noted)
    // E while rolling: refused with the truck's note
    h.keys.hits.add('KeyE');
    frame(h, car);
    expect(car.driving).toBe(true);
    expect(h.toasts).toContain(TRUCK_TEXT.slowDown);
    stopTruck(h, car);
    h.keys.hits.add('KeyE');
    frame(h, car);
    expect(car.driving).toBe(false);
    expect(car.enclosed).toBe(false);
    const nb = car.body!, out = carToWorld(nb.x, nb.z, nb.yaw, S.exits.left.x, S.exits.left.z);
    expect(h.player.x).toBeCloseTo(out.x, 6);
    expect(h.player.z).toBeCloseTo(out.z, 6);
    // the record: where it stands now
    const rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec).toMatchObject({v: 2, level: 0, lights: false, condition: 1}); // (re-pin: record v2 carries the condition)
    expect(rec.x).toBeCloseTo(nb.x, 3);
    expect(rec.storage).toEqual(emptyTruckStorage());
  });

  it('F toggles the truck\'s lamps while seated (the beam\'s intensity only), kept parked and in the record', () => {
    const {h, car} = truckHost();
    getInTruck(h, car);
    expect(car.onLightKey()).toBe(true);
    expect(car.beam!.light.intensity).toBe(TRUCK_LAMPS.beam.intensity);
    frame(h, car);
    expect(car.beam!.light.intensity).toBe(TRUCK_LAMPS.beam.intensity);
    h.keys.hits.add('KeyE');
    frame(h, car);
    expect(car.driving).toBe(false);
    expect(car.onLightKey()).toBe(false); // (out of the seat: F is the flashlight's)
    expect((h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord).lights).toBe(true);
  });

  it('the road wheels roll by the distance travelled and the two front axles steer (axle 2 at its tangent share); the steering wheel turns', () => {
    const {h, car} = truckHost();
    const v = car.view as TruckView;
    getInTruck(h, car);
    const x0 = car.body!.x;
    h.keys.held.add('KeyW');
    run(h, car, 1.5);
    h.keys.held.clear();
    frame(h, car);
    const dist = car.body!.x - x0, r = TRUCK_WHEELS[0].r;
    expect(dist).toBeGreaterThan(2);
    const want = ((-dist / r) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), got = ((v.roadWheels[0].rotation.x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(Math.min(Math.abs(got - want), 2 * Math.PI - Math.abs(got - want))).toBeLessThan(0.02); // (forward: about +X by -distance / r)
    for (const w of v.roadWheels) expect(w.rotation.x).toBe(v.roadWheels[0].rotation.x);
    // steer left while rolling
    h.keys.held.add('KeyW');
    h.keys.held.add('KeyA');
    run(h, car, 0.4);
    const st = car.body!.steer;
    expect(st).toBeGreaterThan(0.05);
    TRUCK_WHEELS.forEach((w, i) => {
      const y = v.roadWheels[i].rotation.y;
      if (w.axle === 0) expect(y).toBeCloseTo(st, 9);
      else if (w.axle === 1) { expect(y).toBeCloseTo(Math.atan(0.669 * Math.tan(st)), 6); expect(y).toBeLessThan(st); }
      else expect(y).toBe(0);
    });
    expect(v.wheel!.rotation.z).toBeGreaterThan(0);
    expect(Math.abs(v.wheel!.rotation.z - st * TRUCK_WHEEL_RATIO)).toBeLessThan(0.1); // (eased toward the front angle x the ratio)
    expect(car.body!.yaw).toBeGreaterThan(-Math.PI / 2); // (a left turn: the heading turned toward +yaw)
  });
});

describe('surface truck: collisions, stairs, run-over', () => {
  it('the hall wall stops it (the nose never past the wall), the impact is reported, the body comes to rest free', () => {
    const {h, car} = truckHost({pose: {x: 25, z: 15, yaw: 0}}); // facing -Z: the wall at z = 0.5
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    let hardest = 0;
    run(h, car, 6, () => { hardest = Math.max(hardest, car.lastImpact?.speed ?? 0); return false; });
    const b = car.body!;
    expect(b.z - noseReach).toBeGreaterThanOrEqual(HALL.wall - 1e-6);
    expect(b.z - noseReach).toBeLessThan(HALL.wall + 0.4); // (it got there)
    expect(car.counts.impacts).toBeGreaterThan(0);
    expect(hardest).toBeGreaterThan(3);
    h.keys.held.clear();
    run(h, car, 0.5);
    expect(car.settled()).toBe(true);
  });

  it('a fixed prop (a wreck-like counter) stops it without being shoved; it never drives onto a stair flight', () => {
    const counter = prop('shopCounter', 19, 15, 0.4, 1.5, 0.95);
    const {h, car} = truckHost({props: [counter]});
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 5);
    expect(h.shoves).toHaveLength(0);
    expect(car.body!.x + noseReach).toBeLessThanOrEqual(19 - 0.4 + 0.02);
    expect(car.body!.x + noseReach).toBeGreaterThan(19 - 0.4 - 0.5);
    // the ramp (cells x 10..12 m, z 20..25 m): approaching it along +Z from the hall floor, it stops at the flight's foot (the car would climb)
    const o = truckHost({pose: {x: 11, z: 12, yaw: Math.PI}}); // facing +Z
    getInTruck(o.h, o.car);
    o.h.keys.held.add('KeyW');
    run(o.h, o.car, 5);
    expect(o.car.body!.pitch ?? 0).toBe(0);
    expect(o.car.body!.y).toBe(0);
    expect(o.car.body!.z + noseReach).toBeLessThanOrEqual(HALL.ramp.z0 + 0.6);
    expect(TRUCK_GEOM.stairs).toBe(false);
  });

  it('rammed above TRUCK_RT.killSpeed: the brain dies through the real kill path; a slow contact shoves the body ahead alive', () => {
    const {h, car} = truckHost();
    const z = zombie(20, 15);
    h.zombies.push(z);
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    let vBefore = 0;
    run(h, car, 4, () => { if (z.brain.alive) vBefore = car.body!.v; return !z.brain.alive; });
    expect(z.brain.alive).toBe(false);
    expect(h.kills).toHaveLength(1);
    expect(h.kills[0].dir.x).toBeGreaterThan(0.8); // along the truck's travel (+X)
    expect(vBefore).toBeGreaterThan(TRUCK_RT.killSpeed);
    expect(car.counts.kills).toBe(1);
    // slow: a creep forward into a body right at the nose
    const o = truckHost();
    const y = zombie(8 + noseReach + 0.35, 15);
    o.h.zombies.push(y);
    getInTruck(o.h, o.car);
    o.h.keys.held.add('KeyW');
    let top = 0;
    run(o.h, o.car, 0.6, () => { top = Math.max(top, o.car.body!.v); return false; });
    o.h.keys.held.clear();
    run(o.h, o.car, 1);
    expect(top).toBeLessThan(TRUCK_RT.killSpeed);
    expect(y.brain.alive).toBe(true);
    expect(y.brain.x).toBeGreaterThan(8 + noseReach + 0.35 + 0.2); // shoved ahead
    const b = o.car.body!;
    expect(nearestCircle(S, b.x, b.z, b.yaw, y.brain.x, y.brain.z).d).toBeGreaterThan(y.brain.stats.radius - 0.02);
    expect(o.car.counts.pushes).toBeGreaterThan(0);
  });

  it('the parked truck keeps zombies and the walking player out of its body (its circles cover it, little bulge past it)', () => {
    const {h, car} = truckHost();
    const z = zombie(8, 15 + 1.1); // overlapping the right side
    h.zombies.push(z);
    run(h, car, 0.5);
    const b = car.body!;
    expect(nearestCircle(S, b.x, b.z, b.yaw, z.brain.x, z.brain.z).d).toBeGreaterThanOrEqual(z.brain.stats.radius - 1e-6);
    expect(noseReach - S.length / 2).toBeLessThan(0.3);
    expect(sideReach - S.width / 2).toBeLessThan(0.3);
  });
});

describe('surface truck: the cargo seam (attachment points, body transform, move listeners)', () => {
  it('lane CARGO\'s TruckAttachPoint shape: six stable bed points that fit a chest or a device / kit, under the cover, inside the bed', () => {
    const A = TRUCK_DEF.attach!, B = TRUCK_ANCHORS.bed;
    expect(A.length).toBeGreaterThan(0);
    expect(A.length).toBeLessThanOrEqual(16);
    for (const a of A) {
      expect(a.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
      expect(a.id.length).toBeLessThanOrEqual(48);
      expect(a.y).toBe(TRUCK_BED_FLOOR_Y); // (on the bed floor: never sunk into it, never floating)
      expect(Math.min(a.w, a.d)).toBeGreaterThanOrEqual(0.78); // (a chest 0.78 x 0.78 x 0.48; a device / kit 0.70 x 0.70 x 1.23)
      expect(a.h).toBeGreaterThanOrEqual(1.25);
      expect(a.y + a.h).toBeLessThanOrEqual(B.y1);
      expect(a.x - a.w / 2).toBeGreaterThanOrEqual(B.x0 - 1e-6);
      expect(a.x + a.w / 2).toBeLessThanOrEqual(B.x1 + 1e-6);
      expect(a.z - a.d / 2).toBeGreaterThanOrEqual(B.z0 - 1e-6);
      expect(a.z + a.d / 2).toBeLessThanOrEqual(B.opening.z + 1e-6);
    }
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { // (the free boxes never overlap)
      const p = A[i], q = A[j];
      expect(Math.abs(p.x - q.x) >= (p.w + q.w) / 2 - 1e-6 || Math.abs(p.z - q.z) >= (p.d + q.d) / 2 - 1e-6).toBe(true);
    }
    // the rear opening (cut in the canvas cover) takes a device / kit in
    expect(B.opening.x1 - B.opening.x0).toBeGreaterThan(0.75);
    expect(B.opening.y1 - B.opening.y0).toBeGreaterThan(1.25);
  });

  it('the points in the world (the pose applied, exact keys), cargoBlock seated / moving, the transform, a move event only when it moves', () => {
    const {h, car} = truckHost();
    const pts = car.truckAttachPoints();
    expect(car.label).toBe('the truck');
    expect(pts.map(p => p.id)).toEqual(TRUCK_DEF.attach!.map(a => a.id));
    TRUCK_DEF.attach!.forEach((a, i) => {
      const w = carToWorld(8, 15, -Math.PI / 2, a.x, a.z);
      expect(Object.keys(pts[i]).sort()).toEqual(['id', 'level', 'occupied', 'pitch', 'roll', 'size', 'x', 'y', 'yaw', 'z']);
      expect(pts[i].x).toBeCloseTo(w.x, 6);
      expect(pts[i].z).toBeCloseTo(w.z, 6);
      expect(pts[i].y).toBeCloseTo(a.y, 6);
      expect(pts[i].yaw).toBeCloseTo(-Math.PI / 2, 6);
      expect(pts[i]).toMatchObject({level: 0, pitch: 0, roll: 0, size: {w: a.w, d: a.d, h: a.h}, occupied: false});
    });
    expect(car.truckAttachPoints()).not.toBe(pts); // (fresh each call)
    car.attachOccupied = id => id === 'bed-middle-left'; // (the truck's own things only: none by default)
    expect(car.truckAttachPoints().filter(p => p.occupied).map(p => p.id)).toEqual(['bed-middle-left']);
    car.attachOccupied = null;
    expect(car.cargoBlock()).toBeNull();
    car.body!.v = 1;
    expect(car.cargoBlock()).toBe(TRUCK_CARGO_TEXT.moving);
    car.body!.v = 0;
    expect(car.truckTransform()).toEqual({x: 8, y: 0, z: 15, yaw: car.body!.yaw, pitch: 0, level: 0});
    const moves: {x: number; z: number}[] = [];
    car.moveListeners.push(t => moves.push({x: t.x, z: t.z}));
    run(h, car, 0.5);
    expect(moves).toHaveLength(0); // parked: no events
    getInTruck(h, car);
    expect(car.cargoBlock()).toBe(TRUCK_CARGO_TEXT.seated);
    h.keys.held.add('KeyW');
    run(h, car, 1);
    expect(moves.length).toBeGreaterThan(30);
    expect(moves[moves.length - 1].x).toBeCloseTo(car.body!.x, 9);
    const p2 = car.truckAttachPoints()[0], w2 = carToWorld(car.body!.x, car.body!.z, car.body!.yaw, TRUCK_DEF.attach![0].x, TRUCK_DEF.attach![0].z);
    expect(p2.x).toBeCloseTo(w2.x, 6);
  });
});

describe('surface truck: the Skyways trunk stays the car\'s', () => {
  it('in a truck world the trunk is inert (not loaded, never aimed, the car record untouched)', () => {
    const {h, car} = truckHost({build: false});
    const trunk = new TrunkSystem(h as unknown as TrunkHost, car).install();
    build(h);
    expect(car.vehicle).toBe('truck');
    expect(trunk.loaded).toBe(false);
    expect(trunk.aimed()).toBe(false);
    expect(trunk.open()).toBe(false);
    teardown(h);
    expect(h.store.has(SKYWAYS_CAR_LANE)).toBe(false);
    expect(h.store.has(SURFACE_TRUCK_LANE)).toBe(true);
  });
});

describe('surface truck: tuning', () => {
  it('heavy-truck numbers (arcade, no fuel or wear) and the controller\'s fields', () => {
    expect(Object.keys(TRUCK_PHYS).sort()).toEqual(Object.keys(CAR_PHYS).sort());
    expect(Object.keys(TRUCK_RT).sort()).toEqual(Object.keys(CAR_RT).sort());
    expect(Object.keys(TRUCK_TEXT).sort()).toEqual(Object.keys(CAR_TEXT).sort());
    expect(TRUCK_PHYS.accel).toBeLessThan(CAR_PHYS.accel);
    expect(TRUCK_PHYS.forwardMax).toBeLessThan(CAR_PHYS.forwardMax);
    expect(TRUCK_SPEC.wheelBase / Math.tan(TRUCK_PHYS.steerLow)).toBeGreaterThan(CAR_SPEC.wheelBase / Math.tan(CAR_PHYS.steerLow)); // (a wider turning circle)
    expect(TRUCK_PHYS.steerRate).toBeLessThan(CAR_PHYS.steerRate); // (a slower rack)
    expect(TRUCK_RT.killSpeed).toBeLessThan(CAR_RT.killSpeed);
    expect(TRUCK_GEOM.phys).toBe(TRUCK_PHYS);
    // (re-pin, field follow-up: the user asked for a persistent truck condition — still no fuel simulation)
    expect(JSON.stringify(surfaceTruckRecord(1, 0, 2, 0, 0))).not.toMatch(/fuel|wear|damage/);
    expect(surfaceTruckRecord(1, 0, 2, 0, 0).condition).toBe(1);
  });
});
