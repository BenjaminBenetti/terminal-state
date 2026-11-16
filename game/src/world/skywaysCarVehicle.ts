// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the vehicle controller's PER-VEHICLE DEFINITION. The one controller
// (world/skywaysCar.ts SkywaysCar, Game's `skywaysCar`) picks a definition at each world build from the layout: the Skyways add-on's car
// (CAR_DEF: today's numbers, record, model and lamps, unchanged) or the Surface Run district's truck (world/surface/truckVehicle.ts
// TRUCK_DEF). Everything that differs between vehicles lives here: the anchors (spec + physics geometry), the tuning (physics, runtime,
// text), the record lane, the model / view, the lamps; the controls, the enter / exit rules, the collisions, the run-over, the prop kicks
// and the pane breaks are the controller's own and shared. Pure types (no runtime imports: no import cycle).

import type * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {CarSpec} from './skywaysCarSpec';
import type {CarBody, CarGeom} from './skywaysCarPhysics';
import type {CarBeam} from './skywaysCarLights';
import type {CarView} from './skywaysCarModel';
import type {CAR_RT, CAR_TEXT, SkywaysCar} from './skywaysCar';

/** Numbers widened (a vehicle's own values for a tuning object's fields). */
type Widen<T> = T extends number ? number : T extends string ? string : T extends object ? {readonly [K in keyof T]: Widen<T[K]>} : T;

/** The controller's runtime tuning (CAR_RT's fields: reach, run-over speed, glass, kicks, sounds…). */
export type VehicleRt = Widen<typeof CAR_RT>;
/** The controller's texts (prompts / notes). */
export type VehicleText = Widen<typeof CAR_TEXT>;

/** Where a vehicle is generated in a layout (a world pose; y = the floor). */
export interface VehicleSpawn { x: number; y: number; z: number; yaw: number; level: number }

/** A vehicle's stored record as the controller reads it (its own fields beyond these stay with the definition). */
export interface VehicleRecordPose { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly level: number }

export interface VehicleDef {
  readonly id: 'car' | 'truck';
  /** The view group's name (also the warm pool's) and the console prefix. */
  readonly name: string;
  readonly spec: CarSpec;
  /** What the physics steps (the spec + the vehicle's tuning / stairs rule; the car's = its spec, so CAR_PHYS applies as ever). */
  readonly geom: CarGeom;
  readonly rt: VehicleRt;
  readonly text: VehicleText;
  /** Seated in it, the player is enclosed (a closed cab with intact glazing: lane AIR's gas protection). */
  readonly enclosed: boolean;
  /** The generated pose in a layout (null: this layout has no such vehicle). */
  spawnOf(layout: StationLayout | null): VehicleSpawn | null;
  readonly model: {
    /** Fetch (browser; behind the loading screen); never rejects. */
    load(spec: CarSpec): Promise<unknown>;
    /** Drop the loaded model (a world without this vehicle); true when something was released. */
    release(): boolean;
    build(spec: CarSpec): CarView;
    refresh(view: CarView, spec: CarSpec): void;
    /** The models' generation (a view built from an older one rebuilds). */
    gen(): number;
    /** Per frame after the pose: the steering wheel, the road wheels (`moved`: the signed distance along the heading since the last sync). */
    sync(view: CarView, body: CarBody, dt: number | undefined, moved: number): void;
  };
  readonly lamps: {
    createBeam(): CarBeam;
    set(on: boolean, lens: THREE.MeshStandardMaterial | null, beam: CarBeam | null): void;
  };
  readonly record: {
    readonly lane: string;
    /** A stored value -> the vehicle's record (null: missing / malformed); the controller reads its pose. */
    read(raw: unknown): VehicleRecordPose | null;
    /** The vehicle's own state from its record (`rec`: what read() returned; null: none — a fresh vehicle). */
    load(car: SkywaysCar, rec: VehicleRecordPose | null): void;
    /** The record of the vehicle as it stands. */
    write(car: SkywaysCar, b: CarBody): unknown;
  };
  /**
   * Secure attachment points for bulky cargo (vehicle frame: x / z = the point's centre on the load floor, y = the floor's height, yaw
   * relative to the vehicle, w across / d along / h the clear height). Absent: none (the car).
   */
  readonly attach?: readonly VehicleAttach[];
  /** The cargo seam's texts: the prompt name ('the truck') and why nothing may be secured now (seated / moving). Absent: none (the car). */
  readonly cargo?: {readonly label: string; readonly seated: string; readonly moving: string};
}

export interface VehicleAttach { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly w: number; readonly d: number; readonly h: number }

/** A vehicle's body in the world (the cargo seam / QA): y = the floor under the footprint, pitch about its lateral axis (0: flat). */
export interface VehicleTransform { x: number; y: number; z: number; yaw: number; pitch: number; level: number }

/**
 * An attachment point in the WORLD (the vehicle's pose now; lane CARGO's TruckAttachPoint, world/surface/cargoTypes.ts, field for field):
 * (x, y, z) = the floor centre a unit stands on, yaw = the way the unit faces, level = the vehicle's storey, pitch / roll = the body's
 * tilt, size = the free box (w across, d along the point's forward, h clear height), occupied = something of the VEHICLE's own takes it
 * (the cargo owner tracks its own units).
 */
export interface VehicleAttachPoint {
  readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly level: number;
  readonly pitch: number; readonly roll: number; readonly size: {readonly w: number; readonly d: number; readonly h: number}; readonly occupied: boolean;
}
