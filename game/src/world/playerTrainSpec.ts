// The player's home train (level one): one parked subway car. Train-local frame: origin = the car centre on the track centre line at
// RAIL-TOP height; +X = the car's front (cab end); +Y up; -Z = the platform side. World pose = (x, railTopY, z) + a yaw about Y
// (gen/playerTrain.ts playerTrainPlacement). Lane ASSETS replaces the PROVISIONAL block with values measured on the cooked models
// (tools/asset-pipeline/train/*); the other lanes read only PLAYER_TRAIN_SPEC.

export interface TrainDoorSpec {
  /** -1 = the platform side (-Z), +1 = the far side (+Z). */
  side: -1 | 1;
  /** Opening centre along the car (local X, m). */
  x: number;
  /** Clear opening width / height above the interior floor (m). */
  width: number;
  height: number;
}

export interface PlayerTrainSpec {
  /** PROVISIONAL until lane ASSETS lands the measured values. */
  provisional: boolean;
  /** Outer body length (X) / width (Z), m. */
  length: number;
  width: number;
  /** Interior floor / ceiling and the roof top above the rail top (local Y), m. */
  floorY: number;
  ceilingY: number;
  roofY: number;
  /** Walkable interior box (local): x0..x1 along the car, |z| <= halfWidth. */
  interior: {x0: number; x1: number; halfWidth: number};
  /** The driver's cab at the front: x0..x1, with an open doorway in its partition. */
  cab: {x0: number; x1: number; doorway: {z0: number; z1: number; height: number}};
  doors: readonly TrainDoorSpec[];
  /** The driving desk (visual only): position / yaw / uniform scale in local coords. */
  console: {x: number; z: number; yaw: number; scale: number};
  /** Light mounts (local): front head lights, rear tail lights, interior ceiling lights. */
  lights: {head: readonly {x: number; y: number; z: number}[]; tail: readonly {x: number; y: number; z: number}[]; interior: readonly {x: number; y: number; z: number}[]};
}

// PROVISIONAL (primary, from the raw renders): lane ASSETS overwrites this block with the measured spec.
export const PLAYER_TRAIN_SPEC: PlayerTrainSpec = {
  provisional: true,
  length: 16.0,
  width: 2.96,
  floorY: 0.98,
  ceilingY: 3.25,
  roofY: 3.6,
  interior: {x0: -7.7, x1: 7.7, halfWidth: 1.33},
  cab: {x0: 5.7, x1: 7.7, doorway: {z0: -0.45, z1: 0.45, height: 2.0}},
  doors: [-5.3, 0, 5.3].flatMap(x => [{side: -1 as const, x, width: 1.3, height: 1.95}, {side: 1 as const, x, width: 1.3, height: 1.95}]),
  console: {x: 7.2, z: 0, yaw: 0, scale: 1},
  lights: {
    head: [{x: 8.0, y: 1.6, z: -0.8}, {x: 8.0, y: 1.6, z: 0.8}],
    tail: [{x: -8.0, y: 1.6, z: -0.8}, {x: -8.0, y: 1.6, z: 0.8}],
    interior: [{x: -4.5, y: 3.15, z: 0}, {x: 0, y: 3.15, z: 0}, {x: 4.0, y: 3.15, z: 0}],
  },
};
