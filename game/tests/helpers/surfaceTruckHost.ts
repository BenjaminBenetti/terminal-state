// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): a Node host for the Surface Run truck's system tests — the vehicle
// controller's own host (tests/helpers/skywaysCarHost.ts: the REAL Player / ZombieBrain, the hand-built hall, fakes for other lanes)
// with a Surface Run layout (`layout.surface.truck`) instead of the Skyways add-on, the truck's definition registered exactly like Game
// (installSurfaceTruck: addVehicle(TRUCK_DEF)) and, optionally, the truck's storage compartments over a real Inventory.
import {Inventory} from '../../src/items/inventory';
import type {PropPlacement} from '../../src/gen/props';
import type {Levels} from '../../src/gen/levels';
import type {SPose} from '../../src/gen/surface/surfaceTypes';
import {carToWorld} from '../../src/world/skywaysCarSpec';
import type {SkywaysCar} from '../../src/world/skywaysCar';
import {TRUCK_DEF} from '../../src/world/surface/truckVehicle';
import {TRUCK_SPEC, TRUCK_TEXT} from '../../src/world/surface/truckSpec';
import {TruckStorageSystem, type TruckStorageHost} from '../../src/world/surface/truckStorage';
import {build, carHost, frame, lookAt, press, run, type CarTestHost, type FakePane} from './skywaysCarHost';

export interface TruckTestHost extends CarTestHost { inv: Inventory }

/** The hall with the truck parked at `pose` (default (8, 15) facing +X, the long way down the hall); the build hooks run unless build: false. */
export function truckHost(o: {pose?: Partial<SPose>; props?: PropPlacement[]; levels?: Levels; panes?: FakePane[]; build?: boolean; storage?: boolean; skyways?: boolean} = {}) {
  const r = carHost({props: o.props, levels: o.levels, panes: o.panes, build: false});
  const h = r.h as TruckTestHost, car = r.car;
  const pose: SPose = {x: 8, z: 15, yaw: -Math.PI / 2, level: 0, y: 0, ...o.pose};
  const props = (h.layout as unknown as {props: PropPlacement[]}).props;
  const skyways = (h.layout as unknown as {skyways: unknown}).skyways;
  (h as {layout: unknown}).layout = o.skyways ? {props, skyways} : {props, surface: {truck: pose}};
  h.inv = new Inventory();
  car.addVehicle(TRUCK_DEF);
  const storage = o.storage ? new TruckStorageSystem(h as unknown as TruckStorageHost, car).install() : null;
  if (o.build !== false) build(h);
  return {h, car, pose, storage};
}

/** Switch the host's layout to a Surface Run district with the truck at `pose` (or a Skyways layout with the car). */
export function setTruckLayout(h: CarTestHost, pose: SPose | null): void {
  const props = (h.layout as unknown as {props: PropPlacement[]}).props;
  (h as {layout: unknown}).layout = pose ? {props, surface: {truck: pose}} : {props, skyways: {addon: {id: 'prize-car', car: {x: 15, y: 0, z: 15, yaw: 0, level: 0, area: 0}}}};
}

/** Stand at a door's stand point (default the driver's, left), look at the door, press E: seated. */
export function getInTruck(h: CarTestHost, car: SkywaysCar, side: 'left' | 'right' = 'left'): void {
  const S = TRUCK_SPEC, b = car.body!, e = S.exits[side], sx = side === 'left' ? -1 : 1;
  const d = carToWorld(b.x, b.z, b.yaw, e.x, e.z), door = carToWorld(b.x, b.z, b.yaw, sx * (S.width / 2 - 0.1), e.z);
  h.player.place(d.x, d.z, 0, b.y);
  frame(h, car);
  lookAt(h, door.x, b.y + 1.4, door.z);
  frame(h, car);
  if (car.prompt !== TRUCK_TEXT.getIn) throw new Error(`no get-in prompt (${car.prompt})`);
  press(h, car, 'KeyE');
  if (!car.driving) throw new Error('not seated');
}

/** Brake to a stop and let go. */
export function stopTruck(h: CarTestHost, car: SkywaysCar): void {
  h.keys.held.clear();
  h.keys.held.add('KeyS');
  run(h, car, 6, () => Math.abs(car.body!.v) < 0.05);
  h.keys.held.clear();
  run(h, car, 0.2);
}
