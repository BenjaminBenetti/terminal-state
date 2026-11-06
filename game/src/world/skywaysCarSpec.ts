// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's MEASURED ANCHORS as the vehicle runtime reads them (three-free).
//
// The car frame (every value here): origin = the centre of the car's footprint on the floor, +Y up, the NOSE toward -Z (forward at
// yaw 0 is -Z: the camera convention of SkywaysCarSpawn.yaw, forward = (-sin yaw, -cos yaw)), +X = the car's RIGHT, so the driver's
// (LEFT) seat has x < 0. three.js rotation.y = yaw maps the car frame to the world.
//
// CAR_SPEC is lane ASSET-B's `SKYWAYS_CAR` (game/src/assets/skywaysCar.generated.ts: measured on the cooked skyways-prize-car.glb; lane
// CAR2 swapped it in). The cockpit (lane CAR2: the Meshy dash + two seats fitted from eye / wheelCentre / interior / cowl / header) is
// world/skywaysCarCockpit.ts. Any url here must be a LITERAL 'assets/models/….glb' of a file that exists in game/public (the CI
// packager resolves every such literal in the bundle).

import {SKYWAYS_CAR} from '../assets/skywaysCar.generated';

export interface CarPoint { x: number; y: number; z: number }

export interface CarSpec {
  /** The runtime GLB (nodes `body`, `glass`; the glass material named `glass`). */
  url: string;
  /** Overall size (m): length along z, width along x (incl. mirrors), height. */
  length: number;
  width: number;
  height: number;
  /** Axle spacing (m; the kinematic bicycle model) and the track width (m). */
  wheelBase: number;
  track: number;
  /** Wheel centres + radius (car frame). */
  wheels: readonly {x: number; y: number; z: number; r: number}[];
  /** The driver's seated eye (LEFT seat). */
  eye: CarPoint;
  /** The steering wheel's centre (estimate). */
  wheelCentre: CarPoint;
  /** Stand points 0.7 m outside each door, mid-door (y = the floor). */
  exits: {left: {x: number; z: number}; right: {x: number; z: number}};
  /** Collision circles along the body's centre line (2-4, covering it). */
  circles: readonly {z: number; r: number}[];
  /** The free cabin box. */
  interior: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  /** The windscreen's base / top edge at the eye's x (y, z): a dash top must stay under the line between them. */
  cowl: {y: number; z: number};
  header: {y: number; z: number};
  /** (ASSET-B readouts; unused by the runtime) */
  bodyTris?: number;
  glassTris?: number;
}

/** The spec the runtime uses: the measured anchors of the cooked model. */
export const CAR_SPEC: CarSpec = SKYWAYS_CAR;

/** Car frame -> world (x, z) for a car at (x, z, yaw). */
export function carToWorld(x: number, z: number, yaw: number, lx: number, lz: number): {x: number; z: number} {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {x: x + lx * c + lz * s, z: z - lx * s + lz * c};
}

/** World (x, z) -> the car frame of a car at (x, z, yaw). */
export function worldToCar(x: number, z: number, yaw: number, wx: number, wz: number): {x: number; z: number} {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = wx - x, dz = wz - z;
  return {x: dx * c - dz * s, z: dx * s + dz * c};
}
