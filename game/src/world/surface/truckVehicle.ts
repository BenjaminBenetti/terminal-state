// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the Surface Run truck as a VEHICLE DEFINITION of the one vehicle
// controller (world/skywaysCar.ts SkywaysCar = Game's `skywaysCar`; world/skywaysCarVehicle.ts VehicleDef). The controller picks it at a
// world build whose layout has `layout.surface.truck` (gen/surface: the generated parking pose by the checkpoint); its record in the
// district's lane store (SURFACE_TRUCK_LANE, world/surface/truckStore.ts) wins once saved — the pose, the lamps and the storage
// compartments' slots. Same controls and rules as the controller's other vehicle: E get in / out, W / S / A / D (or the arrows), Space
// handbrake, F lamps; collisions, zombie run-over above TRUCK_RT.killSpeed, prop shoves and pane breaks are the controller's.
// Seated, the player is ENCLOSED (lane AIR reads SkywaysCar.enclosed: the closed cab and its glazing; the truck has no damage model).
// Registered by installSurfaceTruck (world/surface/truckStorage.ts) after the controller; inert on every layout without the truck.

import type {StationLayout} from '../../gen/stationTypes';
import type {StackJSON} from '../../items/inventory';
import type {SkywaysCar} from '../skywaysCar';
import type {VehicleDef, VehicleRecordPose} from '../skywaysCarVehicle';
import {TRUCK_GEOM, TRUCK_RT, TRUCK_SPEC, TRUCK_TEXT} from './truckSpec';
import {SURFACE_TRUCK_LANE, emptyTruckStorage, surfaceTruckProblem, surfaceTruckRecord, type SurfaceTruckRecord} from './truckStore';
import {buildTruckView, createTruckBeam, loadTruckModel, refreshTruckView, releaseTruckModel, setTruckLamps, syncTruckView, truckModelsGen} from './truckModel';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

/** The truck's generated pose in a layout (null: not a Surface Run district). */
export function truckSpawnOf(layout: StationLayout | null): {x: number; y: number; z: number; yaw: number; level: number} | null {
  const t = layout?.surface?.truck;
  return t ? {x: t.x, y: t.y, z: t.z, yaw: t.yaw, level: t.level} : null;
}

export const TRUCK_DEF: VehicleDef = {
  id: 'truck',
  name: 'surface-truck',
  spec: TRUCK_SPEC,
  geom: TRUCK_GEOM,
  rt: TRUCK_RT,
  text: TRUCK_TEXT,
  enclosed: true,
  spawnOf: truckSpawnOf,
  model: {
    load: spec => loadTruckModel(spec),
    release: releaseTruckModel,
    build: spec => buildTruckView(spec),
    refresh: (v, spec) => refreshTruckView(v, spec),
    gen: () => truckModelsGen,
    sync: syncTruckView,
  },
  lamps: {createBeam: createTruckBeam, set: setTruckLamps},
  record: {
    lane: SURFACE_TRUCK_LANE,
    read: (raw: unknown): VehicleRecordPose | null => (raw !== undefined && surfaceTruckProblem(raw) === null ? raw as SurfaceTruckRecord : null),
    load(car: SkywaysCar, rec: VehicleRecordPose | null): void {
      const r = rec as SurfaceTruckRecord | null;
      car.lights = r?.lights ?? false;
      car.storageJSON = r ? structuredClone(r.storage) : emptyTruckStorage();
    },
    write(car: SkywaysCar, b): SurfaceTruckRecord {
      if (car.storageSource) car.storageJSON = car.storageSource();
      return surfaceTruckRecord(b.x, b.y, b.z, b.yaw, b.level, {lights: car.lights, storage: car.storageJSON as (StackJSON | null)[][]});
    },
  },
  attach: TRUCK_ANCHORS.attach,
};
