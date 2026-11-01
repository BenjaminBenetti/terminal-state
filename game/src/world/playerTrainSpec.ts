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
  /** Task train-shell-followup-20261101-221246 (lane TRAIN): the small compartment at the REAR end (no console), x0 = the rear
   *  bulkhead .. x1 = its partition plane (REAR_DOOR_CLEAR in front of the rear-most door's -X jamb), the cab's doorway. */
  rear?: {x0: number; x1: number; doorway: {z0: number; z1: number; height: number}};
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
  /** (lane ASSETS, train-shell-followup) See-through window cuts: straight through-holes in the cooked models (the Meshy maps are kept;
   *  glass panes / lining sleeves are lane TRAIN's). side: rect in x / y on the side skin, skinZ = |z| of the innermost skin around the
   *  hole (the glass plane); zone 'cab' (the rear-compartment side windows are not cut: the rear door's open leaf parks behind them).
   *  end: rect in z / y on the front (+1) / rear (-1) end face, skinX = |x| of the innermost skin around the hole. leaf: the door leaf's
   *  window in the leaf GLB's own frame (x centred, y from the bottom, closing edge +X; both faces cut, the handle stile kept). */
  windows: {
    side: readonly {side: -1 | 1; zone?: 'cab' | 'rear'; x0: number; x1: number; y0: number; y1: number; skinZ: number}[];
    end: readonly {end: -1 | 1; z0: number; z1: number; y0: number; y1: number; skinX: number}[];
    leaf: {x0: number; x1: number; y0: number; y1: number};
  };
  /**
   * Task train-lockbox-windows-20261101-232156 (lane TRAIN): the Lockbox in the rear compartment (world/trainLockbox.ts) — x / z = the
   * centre of its footprint (train-local), yaw = its rotation about Y (PI: the model's +Z front / latches face the aisle, -Z), its
   * length (along the car) x height x depth, the lid's hinge line (y / z in the box's own frame: front +Z, grounded) and open angle;
   * seamY = the lid seam height, cavity = the open body's inner box (box frame) for the dark liner. Measured on the cooked model by
   * lane ASSETS (PLAYER_TRAIN_MEASURED.lockbox), else the provisional 1.03 x 0.55 x 0.61 m box.
   */
  lockbox?: {
    x: number; z: number; yaw: number; length: number; height: number; depth: number;
    lid: {hingeY: number; hingeZ: number; openAngle: number};
    seamY?: number;
    cavity?: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
  };
  /** Runtime files (relative URLs; assets/playerTrain.generated.ts has bytes / tris / dims). */
  models: {shell: {key: string; url: string}; doorLeaf: {key: string; url: string}; console: {key: string; url: string}};
  textures: {wall: string; floor: string; ceiling: string; bulkhead: string};
}

const M = PLAYER_TRAIN_MEASURED, F = PLAYER_TRAIN_MODELS, T = PLAYER_TRAIN_TEXTURES;
/** (lane TRAIN, train-shell-followup) The rear partition plane stands this far behind the rear-most door's -X jamb (m). */
export const REAR_DOOR_CLEAR = 0.12;
const rearX1 = Math.round((Math.min(...M.doors.map(d => d.x - d.width / 2)) - REAR_DOOR_CLEAR) * 1000) / 1000;
const model = (k: keyof typeof F) => ({key: F[k].key, url: F[k].url});

/** (lane TRAIN, train-lockbox) The Lockbox stands this far clear of the rear bulkhead, the partition and the side lining (m). */
export const LOCKBOX_CLEAR = 0.025;
/** The rear partition's half thickness (= world/playerTrainView.ts TRAIN_VIEW.partition / 2; a test pins the two together). */
export const PARTITION_HALF = 0.03;
/** The Lockbox's own measurements (model frame: front +Z, grounded, centred) — lane ASSETS' cooked model when measured. */
export interface LockboxMeasured {
  length: number; height: number; depth: number; seamY: number;
  hinge: {y: number; z: number};
  cavity: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number};
}
/** Provisional Lockbox (until PLAYER_TRAIN_MEASURED.lockbox): 1.03 x 0.55 x 0.61 m, the lid from 0.42 m, 3.5 cm walls. */
export const LOCKBOX_PROVISIONAL: LockboxMeasured = {
  length: 1.03, height: 0.55, depth: 0.61, seamY: 0.42, hinge: {y: 0.42, z: -0.285},
  cavity: {x0: -0.48, x1: 0.48, y0: 0.06, y1: 0.42, z0: -0.27, z1: 0.27},
};
const LB: LockboxMeasured = (M as {lockbox?: LockboxMeasured}).lockbox ?? LOCKBOX_PROVISIONAL;

export const PLAYER_TRAIN_SPEC: PlayerTrainSpec = {
  provisional: false,
  length: M.length,
  width: M.width,
  floorY: M.floorY,
  ceilingY: M.ceilingY,
  roofY: M.roofY,
  interior: {...M.interior},
  cab: {x0: M.cab.x0, x1: M.cab.x1, doorway: {...M.cab.doorway}},
  rear: {x0: M.interior.x0, x1: rearX1, doorway: {...M.cab.doorway}}, // (lane TRAIN, train-shell-followup: -7.25 .. -6.135)
  doors: M.doors.map(d => ({...d})),
  console: {...M.console},
  lights: {head: M.lights.head, tail: M.lights.tail, interior: M.lights.interior, lampRadius: M.lights.lampRadius, marker: M.lights.marker},
  doorLeaf: {...M.doorLeaf},
  windows: {side: M.windows.side.map(w => ({...w})), end: M.windows.end.map(w => ({...w})), leaf: {...M.windows.leaf}},
  // (lane TRAIN, train-lockbox) centred in the rear compartment's length (rear bulkhead .. the partition's rear face), its back
  // LOCKBOX_CLEAR off the far-side (+Z) lining, front / latches toward the aisle (yaw PI turns the model's +Z front to -Z)
  lockbox: {
    x: Math.round(((M.interior.x0 + rearX1 - PARTITION_HALF) / 2) * 10000) / 10000,
    z: Math.round((M.interior.halfWidth - LOCKBOX_CLEAR - LB.depth / 2) * 10000) / 10000,
    yaw: Math.PI, length: LB.length, height: LB.height, depth: LB.depth,
    lid: {hingeY: LB.hinge.y, hingeZ: LB.hinge.z, openAngle: (100 * Math.PI) / 180},
    seamY: LB.seamY, cavity: {...LB.cavity},
  },
  models: {shell: model('player-train-shell'), doorLeaf: model('player-train-door-leaf'), console: model('player-train-console')},
  textures: {wall: T['train-int-wall'].url, floor: T['train-int-floor'].url, ceiling: T['train-int-ceiling'].url, bulkhead: T['train-int-bulkhead'].url},
};
