// Task studio-baked-lighting-reflections-20261114-050258-01: CACHED LOCAL REFLECTION PROBES of a station — baked on the CPU from the
// station's fixed architecture, its baked light and its fixtures; shown on metal and glass by world/reflectionNode.ts.
//
// What a probe is: the radiance arriving at one point from every direction, ray-cast (world/lightScene.ts: floors, ceilings and wall
// faces of the light field's own bands) — a hit surface shows its finish colour (world/surfaceAlbedo.ts) under the light the FINAL
// baked field gives it there (the same bytes the GPU shades with: what you see is what reflects), a working fixture shows as a bright
// tube, an open ceiling shows the sky light that falls through it. Nothing movable is ever in a probe: no prop, door, character or
// train (they would be ghosts the moment they moved); no mirror, no screen-space pass.
//
// DATA CONTRACT (the bake below and the shader in world/reflectionNode.ts are its two sides; the helpers here are shared):
//  - PROBES sit on a block lattice per level slot: the grid is cut into square blocks of `block` cells; a block with open cells of
//    the slot holds one probe (placed in the block's largest space). Block (bx, bz) has COLOUR (bx & 1) + 2 * (bz & 1).
//  - GRID (RGBA8, w x h cells, depth 2 x slots; slice 2s = WEIGHTS, slice 2s + 1 = IDS of slot s): channel c belongs to colour c.
//    A block's weight is 1 in its core and ramps linearly to 0 across `ramp` cells either side of its borders (a tensor of 1D
//    trapezoids: the four colours sum to 1 wherever every block around has a probe), and is 0 in cells its probe cannot reach by
//    walking inside its expanded block (no reflection of the room behind a wall). Two blocks of one colour are never closer than two
//    cells, so the weights are filtered bilinearly and the ids fetched unfiltered: id = probe index + 1, 0 = none; the shader divides
//    by the weight sum (0 = no probe: the surface shades as without reflections).
//  - ATLAS (RGBA half float): per probe four octahedral maps (PROBE_LEVELS: tile, tile / 2, tile / 4, tile / 8 px), sharp to blurred
//    (roughness), each with a one-texel gutter that continues the map across its edges (bilinear filtering needs no clamping).
//    Layout: probeAtlasLayout. Values are linear radiance in the units the lit scene draws (a Lambert surface under field irradiance
//    E shows albedo x E / pi).
//  - META (RGBA float, `count` x 3 texels): row 0 = probe position (xyz) and NORM (w: the field's luminance at the probe, at least
//    PROBE_NORM_MIN — the shader scales a probe by min(local field luminance / NORM, PROBE_RATIO_MAX), so reflections dim with the
//    light around the surface: flicker, a passing train's shadow, a dark side room); row 1 / 2 = the probe's parallax box min / max.

import type {BuildSteps} from '../core/pacedBuild';
import type {Level} from '../gen/levels';
import type {LightPlacement} from '../gen/station';
import type {ReflectionTier} from './enhancedLighting';
import type {BakedField, ColumnGeometry} from './lightField';
import type {BandScene} from './lightScene';
import type {SurfaceAlbedo} from './surfaceAlbedo';

/** Probe tiles per atlas row, roughness levels per probe, gutter texels around every tile. */
export const PROBE_COLS = 16;
export const PROBE_LEVELS = 4;
export const PROBE_GUTTER = 1;
/** Roughness -> level: level = min(PROBE_LEVELS - 1, roughness * PROBE_LEVEL_PER_ROUGHNESS), linear between two levels. */
export const PROBE_LEVEL_PER_ROUGHNESS = 3.5;
/** Angular blur (degrees, Gaussian sigma) of levels 1..3 relative to the sharp capture (level 0). */
export const PROBE_LEVEL_SIGMA = [0, 7, 20, 42] as const;
/** Smallest NORM of a probe (field luminance units) and the largest local / NORM ratio the shader applies. */
export const PROBE_NORM_MIN = 0.05;
export const PROBE_RATIO_MAX = 1.5;
/** Radiance of a full-power tube as a probe sees it (the tube colour StationLighting draws, times this). */
export const PROBE_FIXTURE_RADIANCE = 10;
/** Farthest surface / fixture a probe sees (m). */
export const PROBE_REACH = 60;

export interface ProbeAtlasLayout {
  tile: number; cols: number; rows: number;
  width: number; height: number;
  /** Per level: the tile edge (px) and the first texel row of that level's band of tiles. */
  levelTile: [number, number, number, number];
  levelY: [number, number, number, number];
}

/** The atlas layout of `count` probes with a sharpest tile of `tile` px. */
export function probeAtlasLayout(tile: number, count: number): ProbeAtlasLayout {
  const cols = PROBE_COLS, rows = Math.max(1, Math.ceil(count / cols));
  const levelTile = [0, 0, 0, 0] as [number, number, number, number], levelY = [0, 0, 0, 0] as [number, number, number, number];
  let y = 0;
  for (let l = 0; l < PROBE_LEVELS; l++) { const t = Math.max(1, tile >> l); levelTile[l] = t; levelY[l] = y; y += rows * (t + 2 * PROBE_GUTTER); }
  return {tile, cols, rows, width: cols * (tile + 2 * PROBE_GUTTER), height: y, levelTile, levelY};
}

/** First interior texel (x, y) of probe p's tile at level l. */
export function probeTileOrigin(L: ProbeAtlasLayout, p: number, l: number): [number, number] {
  const cell = L.levelTile[l] + 2 * PROBE_GUTTER;
  return [(p % L.cols) * cell + PROBE_GUTTER, L.levelY[l] + Math.floor(p / L.cols) * cell + PROBE_GUTTER];
}

/**
 * Octahedral map, y the pole axis: a unit direction -> (u, v) in [0, 1]^2 (the upper hemisphere is the inner diamond).
 * world/reflectionNode.ts octUv is the same maths in TSL.
 */
export function octEncode(x: number, y: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  const s = 1 / (Math.abs(x) + Math.abs(y) + Math.abs(z) || 1);
  let px = x * s, pz = z * s;
  if (y < 0) { const ax = Math.abs(px), az = Math.abs(pz); px = (1 - az) * (px >= 0 ? 1 : -1); pz = (1 - ax) * (pz >= 0 ? 1 : -1); }
  out[0] = px * 0.5 + 0.5; out[1] = pz * 0.5 + 0.5;
  return out;
}

/** The unit direction of (u, v). */
export function octDecode(u: number, v: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const px = u * 2 - 1, pz = v * 2 - 1;
  const y = 1 - Math.abs(px) - Math.abs(pz), t = Math.max(-y, 0);
  const x = px + (px >= 0 ? -t : t), z = pz + (pz >= 0 ? -t : t);
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

/** One station's baked probes (see the data contract above). */
export interface BakedProbes {
  tier: ReflectionTier['id'];
  count: number;
  /** Block edge (cells) and ramp half-width (cells) the grid was made with; the spacing really used = block x CELL. */
  block: number; ramp: number;
  layout: ProbeAtlasLayout;
  /** layout.width x layout.height x 4 half floats. */
  atlas: Uint16Array;
  /** count x 3 x 4 floats: texel (p, row) at (row * count + p) * 4. */
  meta: Float32Array;
  /** gridW x gridH x gridDepth x 4 bytes, slice-major: ((slice * gridH + cz) * gridW + cx) * 4. */
  grid: Uint8Array;
  gridW: number; gridH: number; gridDepth: number;
  slots: number;
  stats: {ms: number; rays: number; fixtures: number; orphanCells: number; bytes: number};
}

export interface ProbeBakeInput {
  /** The FINAL full-resolution field (never a downsampled one): what the probes' surfaces are lit with. */
  field: BakedField;
  geos: readonly ColumnGeometry[];
  levels: readonly Level[];
  albedo: SurfaceAlbedo;
  /** The station's fixtures (layout.lights): the working ones are drawn into the probes. */
  lights: readonly LightPlacement[];
  /** The ray scene (default: built from `geos`). */
  scene?: BandScene;
}

/** GPU bytes of a station's probe textures (atlas + meta + grid). */
export function probeBytes(p: Pick<BakedProbes, 'atlas' | 'meta' | 'grid'>): number {
  return p.atlas.byteLength + p.meta.byteLength + p.grid.byteLength;
}

/**
 * Bake a station's probes, as build steps (core/pacedBuild.ts: a yield at least every couple of milliseconds of work). Deterministic
 * (no random numbers, no clock but the statistics). A station with no open cell returns count 0 (a 1-probe-sized zero atlas).
 */
// eslint-disable-next-line require-yield
export function* bakeReflectionProbesSteps(_input: ProbeBakeInput, _tier: ReflectionTier): BuildSteps<BakedProbes> {
  throw new Error('bakeReflectionProbesSteps: not implemented');
}
