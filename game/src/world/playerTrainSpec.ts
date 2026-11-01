// The player's home train (level one): one parked subway car. Train-local frame: origin = the car centre on the track centre line at
// RAIL-TOP height; +X = the car's front (cab end); +Y up; -Z = the platform side. World pose = (x, railTopY, z) + a yaw about Y
// (gen/playerTrain.ts playerTrainPlacement). The values are MEASURED on the cooked models by lane ASSETS
// (tools/asset-pipeline/train/build-player-train.mjs -> assets/playerTrain.generated.ts); the other lanes read only PLAYER_TRAIN_SPEC.
import {PLAYER_TRAIN_MEASURED, PLAYER_TRAIN_MODELS, PLAYER_TRAIN_TEXTURES} from '../assets/playerTrain.generated';

export interface TrainDoorSpec {
  /** -1 = the platform side (-Z), +1 = the far side (+Z). */
  side: -1 | 1;
  /** Opening centre along the car (local X, m). */
  x: number;
  /** Clear opening width / height above the interior floor (m): the rectangle cut out of the shell skin. */
  width: number;
  height: number;
}

type Point3 = {x: number; y: number; z: number};

export interface PlayerTrainSpec {
  /** PROVISIONAL until lane ASSETS lands the measured values (false now). */
  provisional: boolean;
  /** Outer extent of the cooked shell along X (incl. couplers) / Z (the widest body point, the window belt), m. */
  length: number;
  width: number;
  /** Interior floor (= the door sill) / interior ceiling and the roof top (incl. vents) above the rail top (local Y), m. */
  floorY: number;
  ceilingY: number;
  roofY: number;
  /** Walkable interior box (local): x0..x1 along the car (flat bulkheads before the rounded ends), |z| <= halfWidth. The shell skin
   *  lies outside this box everywhere between floorY and ceilingY (checked on the cooked triangles). */
  interior: {x0: number; x1: number; halfWidth: number};
  /** The driver's cab at the front: x0..x1, with an open doorway in its partition. */
  cab: {x0: number; x1: number; doorway: {z0: number; z1: number; height: number}};
  doors: readonly TrainDoorSpec[];
  /** The driving desk (visual only): position / yaw / uniform scale in local coords. The console model is baked at its runtime size
   *  (scale 1) with its operator side toward -X and its width along Z, so yaw 0 faces the windshield (+X). */
  console: {x: number; z: number; yaw: number; scale: number};
  /** Light mounts (local): front head lights, rear tail lights (5 cm in front of the modelled lamp lenses), interior ceiling lights.
   *  lampRadius = the modelled lens radius; marker = the upper lamp pair of each end (unlit unless the runtime chooses). */
  lights: {head: readonly Point3[]; tail: readonly Point3[]; interior: readonly Point3[]; lampRadius: number; marker: {front: readonly Point3[]; rear: readonly Point3[]}};
  /** The door leaf (player-train-door-leaf.glb, ONE leaf of a centre-opening pair; closing edge at +X, both faces alike): the
   *  closed leaf's OUTER face sits at |z| = outerZ (just inside the innermost remaining skin over every opening and its sliding
   *  pocket, so an open leaf never pokes through the skin); thickness / baked width / height in m. Jambs close the gap from
   *  interior.halfWidth out to (at least) outerZ. */
  doorLeaf: {outerZ: number; width: number; height: number; thickness: number};
  /** Runtime files (relative URLs; assets/playerTrain.generated.ts has bytes / tris / dims). */
  models: {shell: {key: string; url: string}; doorLeaf: {key: string; url: string}; console: {key: string; url: string}};
  textures: {wall: string; floor: string; ceiling: string; bulkhead: string};
}

const M = PLAYER_TRAIN_MEASURED, F = PLAYER_TRAIN_MODELS, T = PLAYER_TRAIN_TEXTURES;
const model = (k: keyof typeof F) => ({key: F[k].key, url: F[k].url});

export const PLAYER_TRAIN_SPEC: PlayerTrainSpec = {
  provisional: false,
  length: M.length,
  width: M.width,
  floorY: M.floorY,
  ceilingY: M.ceilingY,
  roofY: M.roofY,
  interior: {...M.interior},
  cab: {x0: M.cab.x0, x1: M.cab.x1, doorway: {...M.cab.doorway}},
  doors: M.doors.map(d => ({...d})),
  console: {...M.console},
  lights: {head: M.lights.head, tail: M.lights.tail, interior: M.lights.interior, lampRadius: M.lights.lampRadius, marker: M.lights.marker},
  doorLeaf: {...M.doorLeaf},
  models: {shell: model('player-train-shell'), doorLeaf: model('player-train-door-leaf'), console: model('player-train-console')},
  textures: {wall: T['train-int-wall'].url, floor: T['train-int-floor'].url, ceiling: T['train-int-ceiling'].url, bulkhead: T['train-int-bulkhead'].url},
};
