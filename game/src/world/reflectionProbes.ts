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

import {CELL} from '../gen/grid';
import type {BuildSteps} from '../core/pacedBuild';
import type {Level} from '../gen/levels';
import type {LightPlacement} from '../gen/station';
import type {ReflectionTier} from './enhancedLighting';
import {FIELD_EMAX, fixtureGroup, fixtureTint, slotBase, slotLayers, type BakedField, type ColumnGeometry} from './lightField';
import {BandScene, HIT_CEIL, HIT_FLOOR} from './lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, type SurfaceAlbedo} from './surfaceAlbedo';

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

// ---------------------------------------------------------------------------------------------
// Octahedral tiles: the gutter wrap, texel directions and solid angles, half floats

/** Interior texel (j * t + i) that texel (i, j) of a t-px tile stands for, i and j in [-1, t] (octWrapTexel without the tuple). */
function wrapIndex(i: number, j: number, t: number): number {
  if (i < 0) { i = -1 - i; j = t - 1 - j; } else if (i >= t) { i = 2 * t - 1 - i; j = t - 1 - j; }
  if (j < 0) { j = -1 - j; i = t - 1 - i; } else if (j >= t) { j = 2 * t - 1 - j; i = t - 1 - i; }
  return j * t + i;
}

/**
 * The octahedral WRAP of a t-px tile: the interior texel a texel one step outside the tile (i or j = -1 or t: the gutter) continues
 * the map with. Across an edge the map folds back on itself (the two halves of an edge are the same directions): the overshooting
 * coordinate is reflected and the other one mirrored — (-1, j) = (0, t-1-j), (t, j) = (t-1, t-1-j), (i, -1) = (t-1-i, 0),
 * (i, t) = (t-1-i, t-1); a corner is the diagonally opposite interior corner (all four corners are the -y pole). An interior texel
 * is itself. The bake fills the gutters and splats across the edges with it.
 */
export function octWrapTexel(i: number, j: number, t: number, out: [number, number] = [0, 0]): [number, number] {
  const q = wrapIndex(i, j, t);
  out[0] = q % t; out[1] = (q - out[0]) / t;
  return out;
}

const DIRS = new Map<number, Float64Array>();
/** Unit directions of the texel centres of a t-px tile ([x, y, z] per texel, texel j * t + i). Cached and shared: read only. */
export function octTexelDirections(t: number): Float64Array {
  let d = DIRS.get(t);
  if (d) return d;
  d = new Float64Array(t * t * 3);
  const v: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
    octDecode((i + 0.5) / t, (j + 0.5) / t, v);
    const o = (j * t + i) * 3;
    d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2];
  }
  DIRS.set(t, d);
  return d;
}

const OMEGAS = new Map<number, Float64Array>();
/**
 * Solid angle (sr) of every texel of a t-px tile (texel j * t + i; they sum to 4 pi). The map is a unit octahedron pushed onto the
 * sphere: a patch dp of the (2u - 1, 2v - 1) square subtends dp / r^3, r = the length of its octahedron point (4 x 4 samples a texel).
 * Cached and shared: read only.
 */
export function octTexelSolidAngles(t: number): Float64Array {
  let w = OMEGAS.get(t);
  if (w) return w;
  w = new Float64Array(t * t);
  if (t < 64 && Number.isInteger(t) && t > 0) {
    // a small tile: the sums of the texels of the tile twice its size (a texel is exactly its four halves: halving conserves energy)
    const f = octTexelSolidAngles(2 * t), ft = 2 * t;
    for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) { const a = 2 * j * ft + 2 * i; w[j * t + i] = f[a] + f[a + 1] + f[a + ft] + f[a + ft + 1]; }
    OMEGAS.set(t, w);
    return w;
  }
  const SS = 4, dp = 4 / (t * t * SS * SS);
  let sum = 0;
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
    let a = 0;
    for (let b = 0; b < SS; b++) for (let c = 0; c < SS; c++) {
      const px = (i + (c + 0.5) / SS) / t * 2 - 1, pz = (j + (b + 0.5) / SS) / t * 2 - 1;
      const y = 1 - Math.abs(px) - Math.abs(pz), k = Math.max(-y, 0);
      const x = px + (px >= 0 ? -k : k), z = pz + (pz >= 0 ? -k : k);
      const r2 = x * x + y * y + z * z;
      a += dp / (r2 * Math.sqrt(r2));
    }
    w[j * t + i] = a; sum += a;
  }
  const fix = 4 * Math.PI / sum;
  for (let q = 0; q < w.length; q++) w[q] *= fix;
  OMEGAS.set(t, w);
  return w;
}

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
/** Largest radiance an atlas texel stores. */
export const PROBE_RADIANCE_MAX = 60000;
/** A radiance as the atlas stores it: clamped to [0, PROBE_RADIANCE_MAX] (a NaN is 0), rounded to the nearest half float. */
export function probeHalf(v: number): number {
  if (!(v > 0)) return 0;
  F32[0] = v > PROBE_RADIANCE_MAX ? PROBE_RADIANCE_MAX : v;
  const x = U32[0], e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  if (e < 103) return 0; // below half the smallest half float
  if (e < 113) {
    // a subnormal half: the float's 24-bit mantissa shifted down, round to nearest even
    const mant = m | 0x800000, shift = 126 - e, half = 1 << (shift - 1), rem = mant & ((1 << shift) - 1);
    let h = mant >> shift;
    if (rem > half || (rem === half && (h & 1))) h++;
    return h;
  }
  let h = ((e - 112) << 10) | (m >> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++; // (a carry into the exponent is the next power of two: correct)
  return h;
}
const HALF_ONE = 0x3c00;

// ---------------------------------------------------------------------------------------------
// The roughness levels: a Gaussian on the sphere per level, as a sparse matrix per tile size (built once, reused for every probe)

interface LevelKernel {
  /** Tile edge of the level. */
  t: number;
  /** Per texel of the level before (2t px): its share of the level-t texel it is halved into (its solid angle / its four's). */
  share: Float32Array;
  /** Destination texel d: entries start[d] .. start[d + 1] - 1 of `src` (source texel) / `w` (weights; they sum to 1 per destination). */
  start: Int32Array; src: Uint16Array; w: Float32Array;
}
const KERNELS = new Map<number, LevelKernel[]>();

/** Gaussian sigma (radians) that takes level l - 1's blur to level l's. */
const levelSigma = (l: number): number => Math.sqrt(PROBE_LEVEL_SIGMA[l] ** 2 - PROBE_LEVEL_SIGMA[l - 1] ** 2) * Math.PI / 180;
/** A Gaussian weight below this (of its peak, 1) is left out of a level's blur. */
const KERNEL_CUT = 1e-4;

/**
 * The blur matrices of levels 1 .. PROBE_LEVELS - 1 of a `tile`-px probe (cached per tile size; built in steps the first time).
 * Entry (d, s) = a[d] x exp(-theta^2 / (2 sigma^2)) x omega[s] x a[s]: the Gaussian between the two texel centres times the source's
 * solid angle, with one scale per texel (near 1 / the Gaussian's integral) solved so that every row sums to 1 (a flat map stays flat)
 * AND the solid-angle-weighted mean of a map is kept (no energy made or lost where the texels are coarse against the Gaussian).
 */
function* levelKernelsSteps(tile: number): BuildSteps<LevelKernel[]> {
  const hit = KERNELS.get(tile);
  if (hit) return hit;
  const out: LevelKernel[] = [];
  for (let l = 1; l < PROBE_LEVELS; l++) {
    const t = Math.max(1, tile >> l), n = t * t, inv = 1 / (2 * levelSigma(l) ** 2);
    const dirs = octTexelDirections(t), om = octTexelSolidAngles(t), omUp = octTexelSolidAngles(2 * t);
    const share = new Float32Array(4 * n);
    for (let j = 0; j < 2 * t; j++) for (let i = 0; i < 2 * t; i++) share[j * 2 * t + i] = omUp[j * 2 * t + i] / om[(j >> 1) * t + (i >> 1)];
    const start = new Int32Array(n + 1), src: number[] = [], g: number[] = [];
    const rows = (a: number, b: number): void => {
      for (let d = a; d < b; d++) {
        const x = dirs[d * 3], y = dirs[d * 3 + 1], z = dirs[d * 3 + 2];
        for (let q = 0; q < n; q++) {
          const c = x * dirs[q * 3] + y * dirs[q * 3 + 1] + z * dirs[q * 3 + 2], th = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
          const v = q === d ? 1 : Math.exp(-th * th * inv);
          if (v > KERNEL_CUT) { src.push(q); g.push(v); }
        }
        start[d + 1] = src.length;
      }
    };
    const CHUNK = Math.max(1, Math.floor(50000 / n));
    for (let a = 0; a < n; a += CHUNK) { rows(a, Math.min(n, a + CHUNK)); yield; }
    const ix = Uint16Array.from(src), G = Float64Array.from(g), w = new Float32Array(G.length);
    // the scales: a[d] x sum over s of G(d, s) omega[s] a[s] = 1 (the matrix is symmetric: a damped fixed point settles in a few rounds)
    const a = new Float64Array(n).fill(1), r = new Float64Array(n);
    const rowSums = (): void => { for (let d = 0; d < n; d++) { let s = 0; for (let q = start[d], e = start[d + 1]; q < e; q++) s += G[q] * om[ix[q]] * a[ix[q]]; r[d] = s; } };
    rowSums();
    for (let d = 0; d < n; d++) a[d] = 1 / Math.sqrt(r[d]);
    for (let it = 0; it < 48; it++) {
      rowSums();
      for (let d = 0; d < n; d++) a[d] = Math.sqrt(a[d] / r[d]);
      if (it % 8 === 7) yield;
    }
    rowSums();
    for (let d = 0; d < n; d++) for (let q = start[d], e = start[d + 1]; q < e; q++) w[q] = G[q] * om[ix[q]] * a[ix[q]] / r[d];
    out.push({t, share, start, src: ix, w});
    yield;
  }
  KERNELS.set(tile, out);
  return out;
}

/**
 * `src` (a 2t-px tile at offset `so`, rgb per texel) halved into `dst` (t px): each texel the mean of its four over their solid
 * angle (`share`). A plain mean would weigh the map's unevenly sized texels alike: a tube straight overhead would gain half its
 * energy again by the 4-px level.
 */
function boxDown(src: Float32Array, so: number, t: number, share: Float32Array, dst: Float32Array): void {
  const st = 2 * t;
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) {
    const q = 2 * j * st + 2 * i, a = so + q * 3, b = a + st * 3, o = (j * t + i) * 3;
    const w0 = share[q], w1 = share[q + 1], w2 = share[q + st], w3 = share[q + st + 1];
    dst[o] = src[a] * w0 + src[a + 3] * w1 + src[b] * w2 + src[b + 3] * w3;
    dst[o + 1] = src[a + 1] * w0 + src[a + 4] * w1 + src[b + 1] * w2 + src[b + 4] * w3;
    dst[o + 2] = src[a + 2] * w0 + src[a + 5] * w1 + src[b + 2] * w2 + src[b + 5] * w3;
  }
}

function applyKernel(K: LevelKernel, src: Float32Array, dst: Float32Array): void {
  const {start, src: ix, w} = K;
  for (let d = 0, n = K.t * K.t; d < n; d++) {
    let r = 0, g = 0, b = 0;
    for (let q = start[d], e = start[d + 1]; q < e; q++) {
      const o = ix[q] * 3, k = w[q];
      r += src[o] * k; g += src[o + 1] * k; b += src[o + 2] * k;
    }
    dst[d * 3] = r; dst[d * 3 + 1] = g; dst[d * 3 + 2] = b;
  }
}

// ---------------------------------------------------------------------------------------------
// Placement

/** Where the probes of a station sit (probe p: its level slot, its block, its cell). */
interface ProbePlacement { block: number; ramp: number; slot: number[]; bx: number[]; bz: number[]; cell: number[] }

/** The block edge (cells) a tier starts from: the even number of cells nearest its spacing, at least 8. */
export function probeBlockCells(spacing: number): number {
  const b = 2 * Math.round(spacing / CELL / 2);
  return b >= 8 ? b : 8;
}

/** The probes of level slot s at a placement's block size, appended to it; false as soon as it would hold more than `limit`. */
function placeSlot(out: ProbePlacement, s: number, W: number, H: number, geos: readonly ColumnGeometry[], levels: readonly Level[], limit: number): boolean {
  const block = out.block, nbx = Math.ceil(W / block), nbz = Math.ceil(H / block);
  const open = geos[s].open, ar = levels[s]?.grid.area, area = ar && ar.length === W * H ? ar : null;
  const groups = new Map<number, number>();
  for (let bz = 0; bz < nbz; bz++) for (let bx = 0; bx < nbx; bx++) {
    const x0 = bx * block, x1 = Math.min(W, x0 + block), z0 = bz * block, z1 = Math.min(H, z0 + block);
    groups.clear();
    let total = 0;
    for (let cz = z0; cz < z1; cz++) for (let i = cz * W + x0, e = cz * W + x1; i < e; i++) {
      if (!open[i]) continue;
      total++;
      const a = area ? area[i] : -1;
      groups.set(a, (groups.get(a) ?? 0) + 1);
    }
    if (total < 4) continue;
    // the block's largest space (most cells of one area; a tie: the lower id), and of it the cell nearest its centroid
    let best = 0, most = 0;
    for (const [a, c] of groups) if (c > most || (c === most && a < best)) { best = a; most = c; }
    let sx = 0, sz = 0;
    for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) {
      const i = cz * W + cx;
      if (open[i] && (area ? area[i] : -1) === best) { sx += cx; sz += cz; }
    }
    const mx = sx / most, mz = sz / most;
    let pick = -1, near = Infinity;
    for (let cz = z0; cz < z1; cz++) for (let cx = x0; cx < x1; cx++) {
      const i = cz * W + cx;
      if (!open[i] || (area ? area[i] : -1) !== best) continue;
      const d = (cx - mx) * (cx - mx) + (cz - mz) * (cz - mz);
      if (d < near) { near = d; pick = i; }
    }
    if (out.cell.length >= limit) return false;
    out.slot.push(s); out.bx.push(bx); out.bz.push(bz); out.cell.push(pick);
  }
  return true;
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Neighbouring cells whose floors differ by this much or more are not one space for a probe's weights (the bake's own rule). */
const STEP_MAX = 0.6;
/** Linear irradiance of a field byte. */
const DEC: Float64Array = (() => { const t = new Float64Array(256); for (let i = 0; i < 256; i++) t[i] = (i / 255) ** 2 * FIELD_EMAX; return t; })();
/** The tube of a fixture as a probe sees it: 1 m long, 0.12 m wide from below and 0.07 m from the side, 0.08 m under the mount. */
const TUBE_LENGTH = 1, TUBE_FACE = 0.12, TUBE_SIDE = 0.07, TUBE_DROP = 0.08, TUBE_POINTS = 5;
/** A fixture counts as seen when the ray toward it ends this close to it (m): it hangs at the ceiling it is mounted on. */
const TUBE_SLACK = 0.4;
/** Parallax box half-extents (m): at least / at most (also the extent along a ray that hit nothing). */
const BOX_MIN = 0.5, BOX_MAX = 30;

/**
 * Bake a station's probes, as build steps (core/pacedBuild.ts: a yield at least every couple of milliseconds of work). Deterministic
 * (no random numbers, no clock but the statistics). A station with no open cell returns count 0 (a 1-probe-sized zero atlas).
 *
 * What the contract leaves to the bake:
 *  - a probe sits at its cell's centre, min(1.5 m, half the room height) above the floor; its weights reach the cells it can walk to
 *    inside its block grown by ramp + 1 cells (4-neighbour steps over open cells of its slot, floors less than 0.6 m apart);
 *  - a fixture is drawn when it works (not broken, power above 0.01, not a `virtual` daylight source: that one has no tube), is within
 *    PROBE_REACH and the ray to its tube's centre is not stopped more than 0.4 m short of it; its radiance is added on top of the
 *    surface behind it, splatted bilinearly as five points along the tube, and a texel's added fixture radiance is never raised above
 *    the radiance of the fixture being added (one running total per texel over all the fixtures of a probe);
 *  - every tile (all four levels) is written with its gutter and alpha 1; the tiles of unused atlas slots stay 0.
 */
export function* bakeReflectionProbesSteps(input: ProbeBakeInput, tier: ReflectionTier): BuildSteps<BakedProbes> {
  const t0 = performance.now();
  const {field, geos, levels, albedo, lights} = input;
  const W = field.w, H = field.h, n = W * H, S = geos.length, tile = tier.tile;
  if (!(tile >= 8 && tile <= 256 && (tile & (tile - 1)) === 0)) throw new Error(`bakeReflectionProbesSteps: tile ${tile} is not a power of two in 8..256`);
  if ((field.cellScale ?? 1) !== 1) throw new Error('bakeReflectionProbesSteps: the field must be the full-resolution one');
  const scene = input.scene ?? new BandScene(W, H, geos);

  yield 'probes.place';
  // --- placement: the tier's block, grown until the station fits the tier's probe count ----------------------------------------
  const limit = Math.max(1, Math.min(255, Math.floor(tier.maxProbes))), coarsest = Math.max(W, H);
  let block = probeBlockCells(tier.spacing), pl: ProbePlacement;
  for (;;) {
    pl = {block, ramp: block / 2 - 2, slot: [], bx: [], bz: [], cell: []};
    // (one block a slot is as coarse as it gets: with more level slots than the tier has probes, the first `limit` are kept)
    const most = block < coarsest ? limit : Infinity;
    let fits = true;
    for (let s = 0; s < S && fits; s++) { fits = placeSlot(pl, s, W, H, geos, levels, most); yield; }
    if (fits) break;
    block += 2;
  }
  const count = Math.min(limit, pl.cell.length), ramp = pl.ramp;
  const pos = new Float64Array(count * 3);
  for (let p = 0; p < count; p++) {
    const g = geos[pl.slot[p]], i = pl.cell[p], cx = i % W, cz = (i - cx) / W, f = g.floorH[i];
    pos[p * 3] = (cx + 0.5) * CELL; pos[p * 3 + 1] = Math.fround(f + Math.min(1.5, 0.5 * (g.ceilH[i] - f))); pos[p * 3 + 2] = (cz + 0.5) * CELL;
  }

  yield 'probes.grid';
  // --- the grid: ids over each probe's expanded block, weights where its probe can walk to ---------------------------------------
  const gridDepth = 2 * Math.max(1, S), grid = new Uint8Array(n * gridDepth * 4);
  const stamp = new Int32Array(n), queue = new Int32Array(n);
  const w1 = (a: number, b: number): number => { const v = 0.5 + 0.5 * (a < b ? a : b) / ramp; return v < 0 ? 0 : v > 1 ? 1 : v; };
  const gridOf = (p: number): void => {
    const s = pl.slot[p], bx = pl.bx[p], bz = pl.bz[p], id = p + 1, c = (bx & 1) + 2 * (bz & 1);
    const {open, floorH} = geos[s];
    const X0 = bx * block, X1 = X0 + block, Z0 = bz * block, Z1 = Z0 + block;
    const x0 = Math.max(0, X0 - ramp - 1), x1 = Math.min(W, X1 + ramp + 1), z0 = Math.max(0, Z0 - ramp - 1), z1 = Math.min(H, Z1 + ramp + 1);
    const wo = 2 * s * n * 4 + c, io = (2 * s + 1) * n * 4 + c;
    for (let cz = z0; cz < z1; cz++) for (let i = cz * W + x0, e = cz * W + x1; i < e; i++) grid[io + i * 4] = id;
    let head = 0, tail = 0;
    stamp[pl.cell[p]] = id; queue[tail++] = pl.cell[p];
    while (head < tail) {
      const i = queue[head++], cx = i % W, cz = (i - cx) / W, f = floorH[i];
      grid[wo + i * 4] = Math.round(w1(cx + 0.5 - X0, X1 - cx - 0.5) * w1(cz + 0.5 - Z0, Z1 - cz - 0.5) * 255);
      if (cx > x0) { const j = i - 1; if (stamp[j] !== id && open[j] && Math.abs(floorH[j] - f) < STEP_MAX) { stamp[j] = id; queue[tail++] = j; } }
      if (cx + 1 < x1) { const j = i + 1; if (stamp[j] !== id && open[j] && Math.abs(floorH[j] - f) < STEP_MAX) { stamp[j] = id; queue[tail++] = j; } }
      if (cz > z0) { const j = i - W; if (stamp[j] !== id && open[j] && Math.abs(floorH[j] - f) < STEP_MAX) { stamp[j] = id; queue[tail++] = j; } }
      if (cz + 1 < z1) { const j = i + W; if (stamp[j] !== id && open[j] && Math.abs(floorH[j] - f) < STEP_MAX) { stamp[j] = id; queue[tail++] = j; } }
    }
  };
  for (let p = 0; p < count; p++) { gridOf(p); if (p % 16 === 15) yield; }
  const orphansOf = (s: number): number => {
    const open = geos[s].open, wo = 2 * s * n * 4;
    let c = 0;
    for (let i = 0; i < n; i++) if (open[i] && !(grid[wo + i * 4] | grid[wo + i * 4 + 1] | grid[wo + i * 4 + 2] | grid[wo + i * 4 + 3])) c++;
    return c;
  };
  let orphanCells = 0;
  for (let s = 0; s < S; s++) { orphanCells += orphansOf(s); yield; }

  if (!count) {
    const layout = probeAtlasLayout(tile, 1);
    const empty = {atlas: new Uint16Array(layout.width * layout.height * 4), meta: new Float32Array(12), grid};
    return {tier: tier.id, count: 0, block, ramp, layout, ...empty, gridW: W, gridH: H, gridDepth, slots: S,
      stats: {ms: performance.now() - t0, rays: 0, fixtures: 0, orphanCells, bytes: probeBytes(empty)}};
  }

  yield 'probes.capture';
  // --- capture: level 0 of every probe (what each direction sees, lit by the field), its fixtures, its NORM and parallax box ------
  const T2 = tile * tile, data = field.data, n4 = n * 4, INV_PI = 1 / Math.PI;
  const bases = Int32Array.from(geos, (_, s) => slotBase(s)), layersOf = Int32Array.from(geos, (_, s) => slotLayers(s));
  const dirs = octTexelDirections(tile), sf = scene.f, sc = scene.c, sslot = scene.slot, alb = albedo.slots;
  const cap = new Float32Array(count * T2 * 3);
  let rays = 0, fixtures = 0;
  const captureTexels = (p: number, a: number, b: number): void => {
    const px = pos[p * 3], py = pos[p * 3 + 1], pz = pos[p * 3 + 2];
    for (let q = a, o = (p * T2 + a) * 3; q < b; q++, o += 3) {
      if (!scene.trace(px, py, pz, dirs[q * 3], dirs[q * 3 + 1], dirs[q * 3 + 2], PROBE_REACH)) continue; // (nothing there: black)
      const band = scene.hitBand, hs = sslot[band], hi = scene.hitCol, kind = scene.hitKind, Lh = layersOf[hs], A = alb[hs];
      // the field voxel of the hit (world/lightFieldGather.ts: the same mapping), the surface's normal and its colour
      let k = 0, nx = 0, ny = 0, nz = 0, ao = hi * ALBEDO_STRIDE, sky = false;
      if (kind === HIT_FLOOR) { ny = 1; ao += ALB_FLOOR; }
      else if (kind === HIT_CEIL) {
        k = Lh - 1; ao += ALB_CEIL;
        // no ceiling there (open sky, a glass roof): the light arriving from above shows, not a surface
        if (A[ao] === 0 && A[ao + 1] === 0 && A[ao + 2] === 0) { sky = true; ny = 1; } else ny = -1;
      } else {
        const f = sf[band], span = sc[band] - 0.13 - f;
        k = span > 1e-3 ? Math.round((scene.hitY - f - 0.05) / span * (Lh - 1)) : 0;
        k = k < 0 ? 0 : k > Lh - 1 ? Lh - 1 : k;
        nx = scene.hitNx; nz = scene.hitNz; ao += ALB_WALL;
      }
      const oa = (bases[hs] + 1 + 2 * k) * n4 + hi * 4, ob = oa + n4;
      const rho = data[oa + 3] / 255;
      let e = 1 - rho;
      if (rho > 0) {
        const vx = data[ob] / 255 * 2 - 1, vy = data[ob + 1] / 255 * 2 - 1, vz = data[ob + 2] / 255 * 2 - 1;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz), ndl = vl < 1e-4 ? ny : (nx * vx + ny * vy + nz * vz) / vl;
        if (ndl > 0) e += rho * ndl;
      }
      e *= INV_PI;
      if (sky) { cap[o] = DEC[data[oa]] * e; cap[o + 1] = DEC[data[oa + 1]] * e; cap[o + 2] = DEC[data[oa + 2]] * e; }
      else { cap[o] = DEC[data[oa]] * e * ALBEDO_LUT[A[ao]]; cap[o + 1] = DEC[data[oa + 1]] * e * ALBEDO_LUT[A[ao + 1]]; cap[o + 2] = DEC[data[oa + 2]] * e * ALBEDO_LUT[A[ao + 2]]; }
    }
    rays += b - a;
  };

  // the working fixtures: tube centre, tube axis, radiance (the tube colour world/lights.ts applyLevels draws, x PROBE_FIXTURE_RADIANCE)
  const FX = 8, fx: number[] = [];
  lights.forEach((l, li) => {
    if (l.broken || !(l.power > 0.01) || l.virtual) return;
    const g = fixtureGroup(l, li), out = l.power * (g < 0 ? 1 : g === 2 ? 0.1 : 0.92);
    let r = 0.035, gg = 0.038, b = 0.04; // (a tube this dim is drawn as dead glass)
    if (out > 0.02) {
      const [tr, tg, tb] = fixtureTint(l), mx = Math.max(tr, tg, tb), s = l.tint ? 0.65 : 0.35, k = 0.12 + 0.88 * out;
      r = k * (1 - s + s * tr / mx); gg = k * (1 - s + s * tg / mx); b = k * (1 - s + s * tb / mx);
    }
    fx.push(l.x, l.y - TUBE_DROP, l.z, Math.cos(l.rot), -Math.sin(l.rot), r * PROBE_FIXTURE_RADIANCE, gg * PROBE_FIXTURE_RADIANCE, b * PROBE_FIXTURE_RADIANCE);
  });
  const fxs = Float64Array.from(fx), fxCount = fxs.length / FX;
  /** Fixture radiance added per level-0 texel of the probe in work. */
  const glow = new Float32Array(T2 * 3), uv: [number, number] = [0, 0], texelPerSr = T2 / (4 * Math.PI);
  const put = (i: number, j: number, cover: number, lr: number, lg: number, lb: number): void => {
    if (!(cover > 0)) return;
    const o = wrapIndex(i, j, tile) * 3;
    let v = glow[o];
    if (v < lr) { v += lr * cover; glow[o] = v > lr ? lr : v; }
    v = glow[o + 1];
    if (v < lg) { v += lg * cover; glow[o + 1] = v > lg ? lg : v; }
    v = glow[o + 2];
    if (v < lb) { v += lb * cover; glow[o + 2] = v > lb ? lb : v; }
  };
  const fixturesOf = (p: number): void => {
    const px = pos[p * 3], py = pos[p * 3 + 1], pz = pos[p * 3 + 2];
    let any = false;
    for (let q = 0; q < fxCount; q++) {
      const o = q * FX, dx = fxs[o] - px, dy = fxs[o + 1] - py, dz = fxs[o + 2] - pz, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > PROBE_REACH || dist < 1e-3) continue;
      rays++;
      if (scene.trace(px, py, pz, dx / dist, dy / dist, dz / dist, dist) && scene.hitT < dist - TUBE_SLACK) continue;
      if (!any) { glow.fill(0); any = true; }
      fixtures++;
      const ay = Math.abs(dy) / dist;
      // texels the tube covers, a fifth per point along it
      const cover = TUBE_LENGTH * (TUBE_FACE * ay + TUBE_SIDE * (1 - ay)) / (dist * dist) / TUBE_POINTS * texelPerSr;
      const lr = fxs[o + 5], lg = fxs[o + 6], lb = fxs[o + 7];
      for (let m = 0; m < TUBE_POINTS; m++) {
        const along = ((m + 0.5) / TUBE_POINTS - 0.5) * TUBE_LENGTH;
        octEncode(dx + fxs[o + 3] * along, dy, dz + fxs[o + 4] * along, uv);
        const x = uv[0] * tile - 0.5, y = uv[1] * tile - 0.5, i0 = Math.floor(x), j0 = Math.floor(y), tx = x - i0, ty = y - j0;
        put(i0, j0, cover * (1 - tx) * (1 - ty), lr, lg, lb); put(i0 + 1, j0, cover * tx * (1 - ty), lr, lg, lb);
        put(i0, j0 + 1, cover * (1 - tx) * ty, lr, lg, lb); put(i0 + 1, j0 + 1, cover * tx * ty, lr, lg, lb);
      }
    }
    if (any) for (let q = 0, o = p * T2 * 3, e = T2 * 3; q < e; q++) cap[o + q] += glow[q];
  };

  const meta = new Float32Array(count * 3 * 4);
  const reachOf = (px: number, py: number, pz: number, dx: number, dy: number, dz: number): number => {
    rays++;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!scene.trace(px, py, pz, dx / l, dy / l, dz / l, BOX_MAX)) return BOX_MAX;
    return scene.hitT < BOX_MIN ? BOX_MIN : scene.hitT > BOX_MAX ? BOX_MAX : scene.hitT;
  };
  const metaOf = (p: number): void => {
    const s = pl.slot[p], i = pl.cell[p], px = pos[p * 3], py = pos[p * 3 + 1], pz = pos[p * 3 + 2];
    // NORM: the field's luminance at the probe (its own voxel: the layer nearest its height)
    const L = layersOf[s], ly = geos[s].layerY;
    let k = 0;
    for (let q = 1; q < L; q++) if (Math.abs(ly[i * L + q] - py) < Math.abs(ly[i * L + k] - py)) k = q;
    const oa = (bases[s] + 1 + 2 * k) * n4 + i * 4;
    const norm = lum(DEC[data[oa]], DEC[data[oa + 1]], DEC[data[oa + 2]]);
    const m0 = p * 4, m1 = (count + p) * 4, m2 = (2 * count + p) * 4;
    meta[m0] = px; meta[m0 + 1] = py; meta[m0 + 2] = pz; meta[m0 + 3] = norm > PROBE_NORM_MIN ? norm : PROBE_NORM_MIN;
    // the parallax box: how far the room reaches along each axis (the level rays a hair off their axis)
    meta[m1] = px - reachOf(px, py, pz, -1, 0, 1e-3); meta[m2] = px + reachOf(px, py, pz, 1, 0, 1e-3);
    meta[m1 + 1] = py - reachOf(px, py, pz, 0, -1, 0); meta[m2 + 1] = py + reachOf(px, py, pz, 0, 1, 0);
    meta[m1 + 2] = pz - reachOf(px, py, pz, 1e-3, 0, -1); meta[m2 + 2] = pz + reachOf(px, py, pz, 1e-3, 0, 1);
    meta[m1 + 3] = 0; meta[m2 + 3] = 0;
  };
  // a step every ~1500 rays (a millisecond or two)
  const CHUNK = 1536;
  for (let p = 0; p < count; p++) {
    for (let a = 0; a < T2; a += CHUNK) { captureTexels(p, a, Math.min(T2, a + CHUNK)); if (a + CHUNK < T2) yield; }
    fixturesOf(p);
    metaOf(p);
    yield;
  }

  yield 'probes.filter';
  // --- levels 1..3 (each the level before, halved and blurred on the sphere), and everything into the atlas with its gutters --------
  const kernels = yield* levelKernelsSteps(tile);
  const layout = probeAtlasLayout(tile, count), AW = layout.width, atlas = new Uint16Array(AW * layout.height * 4);
  const halved = kernels.map(K => new Float32Array(K.t * K.t * 3)), blurred = kernels.map(K => new Float32Array(K.t * K.t * 3));
  const writeTile = (p: number, l: number, src: Float32Array, so: number, t: number): void => {
    const [ox, oy] = probeTileOrigin(layout, p, l);
    for (let j = -1; j <= t; j++) for (let i = -1; i <= t; i++) {
      const s = so + wrapIndex(i, j, t) * 3, o = ((oy + j) * AW + ox + i) * 4;
      atlas[o] = probeHalf(src[s]); atlas[o + 1] = probeHalf(src[s + 1]); atlas[o + 2] = probeHalf(src[s + 2]); atlas[o + 3] = HALF_ONE;
    }
  };
  const filterOf = (p: number): void => {
    writeTile(p, 0, cap, p * T2 * 3, tile);
    let src = cap, so = p * T2 * 3;
    for (let l = 1; l < PROBE_LEVELS; l++) {
      const K = kernels[l - 1];
      boxDown(src, so, K.t, K.share, halved[l - 1]);
      applyKernel(K, halved[l - 1], blurred[l - 1]);
      writeTile(p, l, blurred[l - 1], 0, K.t);
      src = blurred[l - 1]; so = 0;
    }
  };
  for (let p = 0; p < count; p++) { filterOf(p); yield; }

  const baked = {atlas, meta, grid};
  return {tier: tier.id, count, block, ramp, layout, ...baked, gridW: W, gridH: H, gridDepth, slots: S,
    stats: {ms: performance.now() - t0, rays, fixtures, orphanCells, bytes: probeBytes(baked)}};
}

