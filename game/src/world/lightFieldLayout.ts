// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): the light field's LAYOUT NUMBERS, the fixtures' colour and
// circuit rules and the surface-colour bytes' layout — everything of world/lightField.ts and world/surfaceAlbedo.ts that the gather
// (world/lightFieldGather.ts) and the reflection-probe bake (world/reflectionProbes.ts) read at run time, in a module that imports
// nothing at run time (a type only).
//
// Why: those two bakes also run in WORKERS (world/lightBakeWorker.ts), and a worker's script must not carry the renderer's library:
// world/lightField.ts and world/surfaceAlbedo.ts import three (the field's texture, the materials' colours), so the two bakes take
// their constants from here and only TYPES from those modules. world/lightField.ts and world/surfaceAlbedo.ts re-export every name
// below: for every other module nothing moved. (tests/light-bake-workers.test.ts walks the worker's import graph: no three.)

import type {LightPlacement} from '../gen/station';

// ---------------------------------------------------------------------------------------------
// The field's slots (world/lightField.ts has the data contract)

/** Height layers per column and level slot (relative floor..ceiling). */
export const LAYERS = 4;
/** Slices of the main level's slot: header (floor, ceil, circuit shares) + 2 per layer. */
export const SLOT_DEPTH = 1 + 2 * LAYERS;
/**
 * Height layers of every other level's slot (upper decks / lower crossings are <= ~3.2 m tall: about
 * the main level's 4 layers over 4.4 m) - keeps a 3-level volume ~2.4x a single-level one, not 3x.
 */
export const AUX_LAYERS = 3;
export const AUX_SLOT_DEPTH = 1 + 2 * AUX_LAYERS;
/** Layers / first slice of level slot s. */
export const slotLayers = (s: number) => (s === 0 ? LAYERS : AUX_LAYERS);
export const slotBase = (s: number) => (s === 0 ? 1 : 1 + SLOT_DEPTH + (s - 1) * AUX_SLOT_DEPTH);
/** Encoded irradiance range (sqrt-encoded in 8 bits: fine steps in the dark, headroom in pools). */
export const FIELD_EMAX = 12;
/**
 * Task studio-baked-gi-visual-uplift-20261115-004324-01: the gathered light's row format (world/lightFieldGather.ts makes the rows).
 * The ambient cube's faces, in the order of the gather's surface codes: face f is the irradiance of a surface whose normal is
 * CUBE_FACES[f] — 0 a floor (+y), 1 a ceiling (-y), 2 / 3 a wall facing +x / -x, 4 / 5 a wall facing +z / -z.
 */
export const CUBE_FACES: readonly (readonly [number, number, number])[] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
/** Channels per voxel of IndirectLight.data: six faces x rgb, then the three flicker circuits. */
export const IND_STRIDE = 21;
/** First circuit channel of a row. */
export const IND_CIRCUITS = 18;

/**
 * Task studio-baked-gi-visual-uplift-20261115-004324-01: the AMBIENT CUBE slices of an enhanced field (BakedField.gi: its first one).
 * After the last slot (and the extended headers' group slices), per slot, per face of the gather's cube (CUBE_FACES: +y, -y, +x,
 * -x, +z, -z), one slice per height layer — a face's layers are consecutive slices, so ONE filtered fetch
 * between two of them is the face at any height. A texel is the COMPLETE AMBIENT a surface facing that way receives there: the
 * direct light's scattered share + the gathered face (rgb, encoded as the main texels are: sqrt up to FIELD_EMAX; 0 in closed
 * cells). The full light node reads it INSTEAD of the main texel's ambient part; a reader that knows nothing of these slices (the
 * fog, a renderer that keeps the plain light node) still reads a complete field from the main texels alone.
 */
export const GI_FACES = 6;
/** First cube slice of slot s relative to BakedField.gi. */
export const giSlotBase = (s: number) => (s === 0 ? 0 : GI_FACES * (LAYERS + (s - 1) * AUX_LAYERS));

// ---------------------------------------------------------------------------------------------
// Fixtures

/**
 * Light colour per fixture kind (linear RGB, ~unit luminance). Concept-board grading: cool-white
 * fluorescents with a sickly green cast, aged tubes yellow-green, a minority of warm sodium/incandescent.
 */
export const TINT = {
  cool: [0.88, 1.03, 0.92] as const,
  aged: [0.95, 1.04, 0.6] as const,
  warm: [1.38, 0.86, 0.42] as const,
};

export function fixtureTint(l: Pick<LightPlacement, 'warm' | 'power'> & {tint?: LightPlacement['tint']}): readonly [number, number, number] {
  // Iteration 16 (WORLD-GEN): an explicit tint (office daylight through the windows) wins.
  if (l.tint) return l.tint;
  return l.warm ? TINT.warm : l.power < 0.8 ? TINT.aged : TINT.cool;
}

// Flicker circuits: fixture state is layout data; time-varying fixtures share one of three circuits so
// the baked field can follow them (the shader scales each circuit's share by its current level).

export const FLICKER_GROUPS = 3;

/** -1 = steady (or broken), 0/1 = flickering circuits, 2 = dying (sputtering) circuit. */
export function fixtureGroup(l: Pick<LightPlacement, 'broken' | 'flicker' | 'dying'>, index: number): number {
  if (l.broken) return -1;
  if (l.dying) return 2;
  if (l.flicker) return ((index * 2654435761) >>> 0) % 2;
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Surface colours (world/surfaceAlbedo.ts makes the bytes)

/** Bytes per cell of a slot's albedo: floor rgb, ceiling rgb, wall rgb. */
export const ALBEDO_STRIDE = 9;
export const ALB_FLOOR = 0, ALB_CEIL = 3, ALB_WALL = 6;
/** Linear value of an albedo byte. */
export const ALBEDO_LUT: Float32Array = (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = (i / 255) ** 2; return t; })();
