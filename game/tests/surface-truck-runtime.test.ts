import {describe, expect, it} from 'vitest';
import {Inventory} from '../src/items/inventory';
import {PropIndex, resolveCircle} from '../src/core/physics';
import type {StationLayout} from '../src/gen/stationTypes';
import {SurfaceTruck, type TruckHost} from '../src/world/surfaceTruck';
import {SURFACE_TRUCK_LANE, SURFACE_TRUCK_SPEC, TRUCK_COMPARTMENTS, TRUCK_TIE_POINTS} from '../src/world/surfaceTruckSpec';
import type {SkywaysCarRecord} from '../src/world/skywaysCarStore';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {build, carHost, frame, lookAt, run, teardown, zombie} from './helpers/skywaysCarHost';
import {NO_CONTROLS, stepCar, type CarBody} from '../src/world/skywaysCarPhysics';
import {hallLevels} from './helpers/skywaysCarWorld';

function fixture() {
  const {h, car} = carHost({build: false});
  const original = h.layout!;
  const host = h as unknown as TruckHost;
  Object.assign(host, {skywaysCar: car, inv: new Inventory(), runParticipants: [], qa: true, hitListeners: [],
    trainRuntime: {train: null}, trainUpgrades: {installed: () => false, block: () => null, install: () => true},
    trainEquipment: {craftBlock: () => null, craft: () => ({uid: 'eq-1'}), plugged: () => null}});
  Object.assign(host.run, {current: {level: 'subway', station: 'st-01', section: 'surface'}, scopeOf: () => 'st-01'});
  host.layout = {...original, surface: {seed: 7, truck: {x: 15, y: 0, z: 15, yaw: 0, level: 0, area: 0},
    checkpoint: {return: {x: 4, y: 0, z: 4}}, depotCargo: [{id: 'SR-salvage-armor', kind: 'armor', x: 23, y: 0, z: 15, yaw: 0, level: 0},
      {id: 'SR-salvage-radar', kind: 'radar', x: 23, y: 0, z: 18, yaw: 0, level: 0}]}} as StationLayout;
  const truck = new SurfaceTruck(host).install(); build(h);
  return {h, host, car, truck};
}

describe('Surface truck integrates the actual arcade controller', () => {
  it('the attached rack clearance stops below a low overhead obstruction without scaling the supplied body', () => {
    const levels = hallLevels();
    // A real structural soffit: decorative hanging props intentionally are not indexed as ground obstacles.
    for (let cy = 12; cy < 16; cy++) for (let cx = 1; cx < levels.main.w - 1; cx++) levels.main.ceil[levels.main.idx(cx, cy)] = 3.3;
    const world = {levels, props: null};
    const body = (): CarBody => ({x: 15, y: 0, z: 15, yaw: 0, v: 0, steer: 0, level: 0, yawRate: 0});
    const loaded = body(), bare = body();
    for (let i = 0; i < 240; i++) {
      stepCar(loaded, world, SURFACE_TRUCK_SPEC, {...NO_CONTROLS, forward: true}, 1 / 60);
      stepCar(bare, world, {...SURFACE_TRUCK_SPEC, clearance: undefined}, {...NO_CONTROLS, forward: true}, 1 / 60);
    }
    expect(SURFACE_TRUCK_SPEC.height).toBe(2.92);
    expect(Math.max(...TRUCK_TIE_POINTS.map(p => p.y + 0.78))).toBeLessThan(SURFACE_TRUCK_SPEC.clearance!);
    expect(loaded.z).toBeGreaterThan(11.3); expect(bare.z).toBeLessThan(6);
  });
  it('same controller uses truck dimensions, steering, headlights, collisions and the normal zombie kill path', () => {
    const {h, car} = fixture(); expect(car.spec).toBe(SURFACE_TRUCK_SPEC);
    const door = carToWorld(15, 15, 0, SURFACE_TRUCK_SPEC.exits.left.x, SURFACE_TRUCK_SPEC.exits.left.z);
    h.player.place(door.x, door.z, 0, 0); frame(h, car); lookAt(h, 14, SURFACE_TRUCK_SPEC.eye.y, door.z);
    expect(car.onInteract()).toBe(true);
    expect(car.driving).toBe(true); expect(h.player.eye).toBeCloseTo(SURFACE_TRUCK_SPEC.eye.y);
    expect(car.onLightKey()).toBe(true); expect(car.lights).toBe(true);
    const z = zombie(15, 6); h.zombies.push(z);
    h.keys.held.add('KeyW'); run(h, car, 1.4);
    expect(z.brain.alive).toBe(false); expect(h.kills).toHaveLength(1);
    h.keys.held.add('KeyA'); run(h, car, 0.35); expect(Math.abs(car.body!.steer)).toBeGreaterThan(0.1);
    h.keys.held.delete('KeyA'); run(h, car, 3);
    expect(car.body!.z).toBeGreaterThan(0.5); expect(car.counts.impacts).toBeGreaterThan(0);
  });
  it('all three finite stores preserve stack identity/condition and truck pose through teardown/re-entry', () => {
    const {h, host, car, truck} = fixture();
    expect(truck.stores.map(s => s.size)).toEqual([4, 4, 8]); expect(TRUCK_COMPARTMENTS.map(c => c.start)).toEqual([0, 4, 8]);
    const mask = host.inv.makeStack('gas_mask', 1); mask.filter = 12.5;
    const pistol = host.inv.makeStack('pistol', 1, 4), tank = host.inv.makeStack('airtank_backpack', 1); tank.air = 87.25;
    truck.stores[0].slots[1] = mask; truck.stores[1].slots[2] = pistol; truck.stores[2].slots[7] = tank;
    Object.assign(car.body!, {x: 18, z: 15, yaw: 0.3}); car.store();
    const saved = structuredClone(h.store.get(SURFACE_TRUCK_LANE)) as SkywaysCarRecord;
    expect(saved.trunk[1]).toMatchObject({uid: mask.uid, filter: 12.5});
    expect(saved.trunk[6]).toMatchObject({uid: pistol.uid, mag: 4}); expect(saved.trunk[15]).toMatchObject({uid: tank.uid, air: 87.25});
    teardown(h); h.propIndex = new PropIndex(h.levels!, h.layout!.props); build(h);
    expect(h.store.get(SURFACE_TRUCK_LANE)).toEqual(saved); expect(car.source).toBe('record');
    expect(car.body).toMatchObject({x: 18, z: 15}); expect(car.body!.yaw).toBeCloseTo(0.3, 10);
    expect(truck.stores.flatMap(s => s.toJSON().slots)).toEqual(saved.trunk);
  });
  it('crate collides while grounded, keeps its warmed mesh across inventory changes, and yields E at the access while carried', () => {
    const {h, host, truck} = fixture(), record = truck.cargo.records[0];
    const m = host.scene.getObjectByName(`surface-salvage:${record.uid}`)!; expect(m).toBeDefined();
    expect(resolveCircle(h.levels!, h.propIndex, record.x, record.z, 0.28, 0)).not.toEqual([record.x, record.z]);
    host.inv.add(host.inv.makeStack('water', 1)); truck.frame();
    expect(host.scene.getObjectByName(`surface-salvage:${record.uid}`)).toBe(m);
    truck.cargo.take(record.uid); truck.frame(); expect(truck.carrying).toBe(true);
    expect(resolveCircle(h.levels!, h.propIndex, record.x, record.z, 0.28, 0)).toEqual([record.x, record.z]);
    h.player.place(4, 4, 0, 0); expect(truck.interact()).toBe(false); expect(truck.prompt()).toBeNull();
    expect(truck.cargo.carried!.uid).toBe(record.uid);
    h.player.place(0.6, 15, Math.PI / 2, 0); truck.interact(); expect(truck.cargo.carried!.uid).toBe(record.uid);
  });
  it('other owned hands prevent taking cargo or opening a compartment; default-car rear prompt remains unchanged', () => {
    const {h, host, car, truck} = fixture();
    host.corpses = {carrying: true}; h.player.place(23, 17, 0, 0); frame(h, car); lookAt(h, 23, 0.4, 15); truck.interact();
    expect(truck.cargo.carried).toBeNull(); expect(truck.open(0)).toBe(false);
    host.corpses = null; expect(truck.open(0)).toBe(true); truck.close(false);
    const left = carToWorld(car.body!.x, car.body!.z, car.body!.yaw, SURFACE_TRUCK_SPEC.exits.left.x, SURFACE_TRUCK_SPEC.exits.left.z);
    h.player.place(left.x, left.z, 0, 0);
    expect(truck.cargo.carried).toBeNull();
    teardown(h); host.layout = {props: []} as unknown as StationLayout; host.run.current.section = 'main'; build(h);
    expect(car.rear!.prompt).toBe('');
  });
});
