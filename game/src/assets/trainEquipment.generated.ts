// PROVISIONAL (task studio-train-crafting-v1-20261111-225628-01, lead contract) — replaced by the cook's output
// (tools/asset-pipeline/props/build-train-equipment.mjs writes this file; the export names and shapes below are the contract the
// runtime reads: craft/trainFixtures.ts, world/trainEquipmentModel.ts, world/craftBench.ts, world/sentryTurret.ts).
//
// The crafting bench, the three device modules and the roof turret: Meshy T2.5 image-to-3D derivatives of one Codex design image each,
// their own PBR maps kept. Model frames (metres at runtime size, +Y up, origin at the bottom centre of the footprint):
//  - bench: +Z = the front (the side the player stands at), X along the wall it stands against.
//  - modules (radar / sentry / scanner): +Z = the console face; they stand on the hand truck's nose plate (world/fuelCartModel.ts).
//  - turret: origin on the yaw axis at the underside of the base ring; +Z = the muzzle direction at rest. Nodes: 'turret-base' (fixed),
//    'turret-yoke' (child of the root, turns about +Y through the origin), 'turret-head' (child of the yoke, tilts about the X axis
//    through `pitchPivot`); `pitch: false` when the head could not be separated (then 'turret-head' is absent).
export const TRAIN_EQUIPMENT_MODELS = {
  bench: {key: 'train-bench', url: 'assets/models/train-bench.glb', bytes: 0, tris: 0},
  radar: {key: 'train-radar', url: 'assets/models/train-radar.glb', bytes: 0, tris: 0},
  sentry: {key: 'train-sentry', url: 'assets/models/train-sentry.glb', bytes: 0, tris: 0},
  scanner: {key: 'train-scanner', url: 'assets/models/train-scanner.glb', bytes: 0, tris: 0},
  turret: {key: 'train-turret', url: 'assets/models/train-turret.glb', bytes: 0, tris: 0},
} as const;

/** The bench: length along X, height (to the top of its bolted-down fixtures), depth along Z; the worktop's height. */
export const TRAIN_BENCH_MEASURED = {
  size: {l: 1.02, h: 1.12, d: 0.681},
  worktopY: 0.841,
} as const;

/**
 * The device modules: overall size (w along X, h, d along Z) and where the module's origin sits on the hand truck (`mountZ`, the dolly
 * frame's z: world/fuelCartModel.ts CART_LOOK; y = the nose plate's top) so that truck + module stay inside the dolly's footprint circle.
 * `face` = the console face's band (y0..y1 over the module's base) the player aims at to use it.
 */
export const TRAIN_MODULE_MEASURED = {
  radar: {size: {w: 0.54, h: 1.0, d: 0.372}, mountZ: 0.094, face: {y0: 0.05, y1: 0.55}},
  sentry: {size: {w: 0.419, h: 0.95, d: 0.452}, mountZ: 0.094, face: {y0: 0.05, y1: 0.8}},
  scanner: {size: {w: 0.475, h: 1.0, d: 0.384}, mountZ: 0.094, face: {y0: 0.05, y1: 0.85}},
} as const;

/** The roof turret: size (l along Z, h, w along X), the tilt axis, the muzzle at rest (model frame). */
export const TRAIN_TURRET_MEASURED = {
  size: {l: 0.958, h: 0.521, w: 0.423},
  pitch: true,
  pitchPivot: {x: 0, y: 0.33, z: 0},
  muzzle: {x: 0, y: 0.345, z: 0.62},
} as const;
