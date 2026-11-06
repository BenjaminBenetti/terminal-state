// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's MEASURED ANCHORS as the vehicle runtime reads them (three-free).
//
// The car frame (every value here): origin = the centre of the car's footprint on the floor, +Y up, the NOSE toward -Z (forward at
// yaw 0 is -Z: the camera convention of SkywaysCarSpawn.yaw, forward = (-sin yaw, -cos yaw)), +X = the car's RIGHT, so the driver's
// (LEFT) seat has x < 0. three.js rotation.y = yaw maps the car frame to the world.
//
// The field names are lane ASSET-B's `SKYWAYS_CAR` (game/src/assets/skywaysCar.generated.ts: measured on the cooked
// skyways-prize-car.glb), so the swap is one line: `export const CAR_SPEC: CarSpec = SKYWAYS_CAR`. Until that file lands this module's
// DEFAULT_CAR_SPEC holds plausible numbers for a 4.78 m sports coupe. `cockpit` (optional, not in ASSET-B's set) names a cockpit GLB
// (dash / wheel / seats) fitted into `interior`; absent = the procedural cockpit (world/skywaysCarModel.ts). Any url here must be a
// LITERAL 'assets/models/….glb' of a file that exists in game/public (the CI packager resolves every such literal in the bundle).

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
  /** Optional cockpit GLB fitted into `interior` (see above). */
  cockpit?: string;
  /** (ASSET-B readouts; unused by the runtime) */
  bodyTris?: number;
  glassTris?: number;
}

/** Plausible defaults until lane ASSET-B's measured SKYWAYS_CAR lands (a 4.78 m coupe, nose -Z, driver on the left). */
export const DEFAULT_CAR_SPEC: CarSpec = {
  url: 'assets/models/skyways-prize-car.glb',
  length: 4.78, width: 1.96, height: 1.32,
  wheelBase: 2.72, track: 1.64,
  wheels: [
    {x: -0.82, y: 0.35, z: -1.39, r: 0.35}, {x: 0.82, y: 0.35, z: -1.39, r: 0.35},
    {x: -0.82, y: 0.35, z: 1.33, r: 0.35}, {x: 0.82, y: 0.35, z: 1.33, r: 0.35},
  ],
  eye: {x: -0.37, y: 1.07, z: 0.22},
  wheelCentre: {x: -0.37, y: 0.86, z: -0.2},
  exits: {left: {x: -1.68, z: 0.05}, right: {x: 1.68, z: 0.05}},
  circles: [{z: -1.44, r: 0.95}, {z: -0.48, r: 0.95}, {z: 0.48, r: 0.95}, {z: 1.44, r: 0.95}],
  interior: {x0: -0.78, x1: 0.78, y0: 0.25, y1: 1.22, z0: -0.85, z1: 0.95},
};

/** The spec the runtime uses (the lead swaps in SKYWAYS_CAR here). */
export const CAR_SPEC: CarSpec = DEFAULT_CAR_SPEC;

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
