// Iteration 05 (Lane L): persistent, camera-independent station lighting.
//
// Every fixture's on/off/flicker/dying state is layout data (gen/stationDress.ts applyLighting). This
// module bakes ALL working fixtures of a station, once on load, into a world-space light field:
// a W x H grid (one texel per 0.5 m nav cell) with LAYERS height layers spanning each column's own
// floor..ceiling (so per-cell floor heights - track bed, underpass stairs - are respected). Each voxel
// holds the tinted irradiance from every visible fixture (2D grid line of sight + per-layer height
// clearance against every traversed cell's floor/ceiling, soft transmittance through sight-blocking
// props), its dominant light direction and a share for the time-varying "flicker circuits", plus a
// cheap wall-respecting bounce fill.
//
// At runtime (iteration 13: three r186 WebGPURenderer, world/lightFieldNode.ts) the field is a TSL
// lighting node registered for one persistent scene light, so static world, storefronts, GLB props,
// zombies, items and every future lit node material sample it automatically with no per-material
// patches: its directional part goes through the lighting model's direct term (N.L diffuse + GGX
// specular), the rest into the indirect irradiance; the three flicker-circuit levels are uniforms
// (LightFieldVolume.resolution). Iterations 05-12 rode three's WebGL light-probe-grid ShaderChunks.
// Nothing here depends on the camera: a fixture 60 m away lights its pool exactly as it does when you
// stand under it.
//
// Iteration 08 (Lane G): multi-level stations. The volume holds one SLOT per station level (slot s =
// layout.levels[s]), each with its own per-column floor..ceiling header and LAYERS layers, and slice 0
// holds a per-column bitmask of the slots whose band is really there. The shader (and sampleField) pick
// the slot whose band contains the shaded point, so a lower level, the main level and an upper deck in
// the same X/Z column each get their own light. Occlusion follows the union-of-open-columns model
// (gen/levels.ts): a fixture lights its own level through the per-level parent-chain memo (walls,
// lintels, slab undersides; light wells and voids that rise through the level count as open), and
// every other level by exact rays through the union of free bands, so light never leaks through a
// slab but does fall through apertures, light wells and stairwells.
//
// Task office-seamless-20261029 (ENGINE): N storeys (one world for the 9-storey Office Space tower). Up to MAX_SLOTS (16)
// level slots and up to MAX_BANDS (12) bands per column. A column that fits the iteration-08 header (<= 3 bands, slot ids
// <= 3: every Subway column) keeps it byte for byte; any other column is EXTENDED: slice 0 A = its band count (1..63, the
// top two bits 0 - never a legacy byte), R / G / B = the coarse split heights above bands 2 / 5 / 8, and one GROUP texel per
// 3 bands (slices fieldDepth(slots) + g, after every slot) holds that group's two inner split heights and its three slot ids
// (4-bit pair + byte). The shader picks the group from the coarse splits and the band inside it from the group texel: two
// texel fetches for the slot pick on every column (a legacy column re-reads its own cached texel), float maths only. Slot
// header heights are 8-bit per slot over that slot's own height range (`slotY`) in extended fields (a 42 m tower over one
// global range would quantise floors to 0.16 m); legacy fields keep the global range (identical bytes and maths). Cross-level
// rays are culled per fixture by a reachability flood over the union bands within its range (exact: a ray can only end
// in a band the flood reached), so a tall stack of closed storeys bakes in about the time of its storeys (stacks of more
// than 3 levels; a Subway station traces its few cross rays as before).

import * as THREE from 'three';
import {CELL, SOLID, VOID, type Grid} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {LightPlacement} from '../gen/station';
import {drainSync, type BuildSteps} from '../core/pacedBuild'; // task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD)
import type {IndirectContext, IndirectLight} from './lightFieldGather'; // task studio-baked-lighting-reflections-20261114-050258-01 (types only)

// ---------------------------------------------------------------------------------------------
// Tunables

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
/** Most level slots a field holds (extended column headers store 4-bit slot ids). */
export const MAX_SLOTS = 16;
/** Slots / bands the iteration-08 (legacy) column header can name: 2-bit slot ids, a 2-bit band count. */
export const LEGACY_SLOTS = 4;
export const LEGACY_BANDS = 3;
/** Extended column header: bands per group texel, group texels per column, most bands per column. */
export const GROUP_BANDS = 3;
export const MAX_GROUPS = 4;
export const MAX_BANDS = GROUP_BANDS * MAX_GROUPS;
/** Layers / first slice of level slot s; texture depth for S slots. */
export const slotLayers = (s: number) => (s === 0 ? LAYERS : AUX_LAYERS);
export const slotBase = (s: number) => (s === 0 ? 1 : 1 + SLOT_DEPTH + (s - 1) * AUX_SLOT_DEPTH);
export const fieldDepth = (slots: number) => 1 + SLOT_DEPTH + (slots - 1) * AUX_SLOT_DEPTH;
/** Relative height of layer k of L between the column floor (0) and ceiling (1). */
const layerT = (k: number, L: number) => (L > 1 ? k / (L - 1) : 0);
/** Encoded irradiance range (sqrt-encoded in 8 bits: fine steps in the dark, headroom in pools). */
export const FIELD_EMAX = 12;
/** Soft transmittance through cells holding sight-blocking props (columns, tall cabinets). */
const PROP_TRANSMITTANCE = 0.55;
/** Height tolerance when a ray grazes a floor/ceiling/lintel (m). */
const CLEAR_EPS = 0.08;

/** Bake parameters (the scene "mood"); see MOOD in lights.ts for the user-facing knobs. */
export interface FieldParams {
  /** Fixture output scale (irradiance at 1 m from a full-power tube, straight below). */
  gain: number;
  /** Max reach of one fixture (m) at full power; scaled by sqrt(power). Window fades to 0 there. */
  range: number;
  /** Emission straight up/sideways relative to straight down (0..1). Lower = tighter pools. */
  uplight: number;
  /** Downward lobe: emission ~ uplight + (1 - uplight) * cos^lobe (1 or 2; 2 = tighter pools). */
  lobe: 1 | 2;
  /** Share of non-directional (scattered) light that reaches any surface. */
  scatter: number;
  /** Bounce fill as a fraction of the local/area direct light (0 = black between pools). */
  bounce: number;
}

export const DEFAULT_FIELD: FieldParams = {gain: 21, range: 9, uplight: 0.16, lobe: 2, scatter: 0.17, bounce: 0.1};

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

// ---------------------------------------------------------------------------------------------
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

/** Brightness 0..1 of a flicker circuit at time t (s). Deterministic; never depends on the camera. */
export function groupLevel(g: number, t: number): number {
  if (g === 2) {
    // Mostly dead: a sputtering burst every several seconds.
    const s = Math.sin(t * 0.83) + Math.sin(t * 2.31 + 0.7) * 0.7;
    if (s < 1.3) return 0;
    return Math.abs(Math.sin(t * 31)) > 0.4 ? 0.85 : 0.08;
  }
  if (g === 0 || g === 1) {
    // Mostly on, with irregular stutters (the two circuits are de-phased and run at slightly different rates).
    const u = g === 0 ? t : t * 1.13 + 5.3;
    const s = Math.sin(u * 1.3) + Math.sin(u * 3.7 + 1.1) * 0.6 + Math.sin(u * 17.0) * 0.25;
    return s > 1.2 ? 0.15 + 0.2 * Math.abs(Math.sin(u * 40)) : 0.92;
  }
  return 1;
}

// ---------------------------------------------------------------------------------------------
// Bake

export interface FieldSource {
  grid: Grid;
  lights: readonly LightPlacement[];
  /** Track-bed floor (VOID cells) when no per-cell floor height is available. */
  trenchFloorY: number;
  /** Per-cell floor height (cell coords) of the main grid. Defaults to cellFloorFn(grid, trenchFloorY). */
  floorAt?: (cx: number, cy: number) => number;
  /** Iteration 08: every level of the station (levels[0].grid === grid). Default: the grid alone. */
  levels?: readonly Level[];
  /** Cross-level light (other slots through the union free space). Default true. */
  crossLevel?: boolean;
  /**
   * Skip cross-level rays the per-fixture reachability flood proves dark (exact: identical bytes; tests compare both).
   * Default: stacks of more than LEGACY_BANDS levels (the tower: ~20x fewer rays); a Subway station's few cross rays are
   * cheaper to trace than to flood.
   */
  crossCull?: boolean;
  /**
   * Task track3-eaton-centre-20261031 (lane ARCH): extra direct light added after the fixtures, before the bounce pass (the mall's
   * daylight through its glass roof: world/mallSkylight.ts). Absent (every Subway station, the Office): nothing changes.
   * Receives the per-slot direct-light arrays (tinted fluence E, direction D, luminance EL) and the slots' column geometry.
   */
  extraDirect?: (ctx: ExtraDirectContext) => Record<string, number> | void;
  /**
   * Task studio-baked-lighting-reflections-20261114-050258-01: the ENHANCED indirect light (world/lightFieldGather.ts: a ray gather over
   * the fixed architecture, coloured by its finishes) in place of the bounce fill below. Absent (Enhanced lighting off, the Reactor,
   * every caller that does not ask for it): the bake is unchanged, byte for byte. Same format either way: the shader, the fog and the
   * CPU sampler read an enhanced field exactly as they read a baseline one.
   */
  indirect?: (ctx: IndirectContext) => BuildSteps<IndirectLight>;
}

/** Task track3 (lane ARCH): what FieldSource.extraDirect may add into (the bake's own arrays, slot-major as the fixtures write). */
export interface ExtraDirectContext {
  W: number; H: number; levels: readonly Level[]; geos: readonly ColumnGeometry[]; layers: readonly number[];
  E: Float32Array[]; D: Float32Array[]; EL: Float32Array[];
  /** Union of free bands per column (null for a single-level field). */
  bands: {start: Int32Array; f: Float32Array; c: Float32Array} | null;
}

export interface BakedField {
  w: number; h: number; layers: number; depth: number;
  /** Level slots (one per station level); depth = fieldDepth(slots) + hdr. */
  slots: number;
  /**
   * RGBA8 voxels, slice-major: ((slice * h + y) * w + x) * 4. Slice 0 = the column header: legacy columns R = bitmask of
   * the slots present, G / B = split heights, A = band count << 6 | 2-bit slot ids; extended columns (A in 1..63) R / G / B =
   * coarse split heights, A = band count. Slot s starts at slice slotBase(s): its header (floor, ceil, circuit 0/1 shares),
   * then per layer k < slotLayers(s): (irradiance rgb + directional share) and (direction, dying share). Extended columns'
   * group texels follow the last slot (slices fieldDepth(slots) .. depth - 1).
   */
  data: Uint8Array;
  /** Height encoding range of the column header split heights (and of every slot header in a legacy field). */
  yMin: number; yMax: number;
  /** Extended column-header group slices after the slots (0 = every column uses the iteration-08 header). */
  hdr?: number;
  /** Per slot [lo, hi]: the slot header's 8-bit floor / ceiling range (absent = [yMin, yMax] for every slot). */
  slotY?: Float64Array;
  /** Per column: bitmask of the slots present (slice 0 R holds the same in legacy columns). */
  masks?: Uint16Array;
  /** Grid cells per texel in X/Z (1 = full resolution; see downsampleField). */
  cellScale?: number;
  /** Flicker circuit per light (-1 steady/broken). */
  groups: Int8Array;
  stats: {ms: number; bytes: number; fixtures: number; working: number; steady: number; circuits: [number, number, number]; rays: number; crossRays: number; slots: number;
    /** Most bands in one column, extended columns, columns with bands past MAX_BANDS (dropped), cross rays skipped by the flood. */
    bands?: number; extCols?: number; cut?: number; crossCulled?: number;
    /** Task track3 (lane ARCH): FieldSource.extraDirect's stats (the mall skylight), when present. */
    extra?: Record<string, number>;
    /** Task studio-baked-lighting-reflections-20261114-050258-01: FieldSource.indirect's stats (the enhanced gather), when present. */
    indirect?: IndirectLight['stats']};
}

/** [lo, hi] of slot s's header heights (floor = lo + byte / 255 * (hi - lo)). */
export function slotRange(f: Pick<BakedField, 'yMin' | 'yMax' | 'slotY'>, s: number): [number, number] {
  const r = f.slotY;
  return r && r.length >= 2 * (s + 1) ? [r[2 * s], r[2 * s + 1]] : [f.yMin, f.yMax];
}

/** Band count of a column header (slice 0 A byte): legacy count << 6, or the extended count 1..63. */
export function headerBands(a: number): number {
  return a >= 64 ? a >> 6 : a;
}

/** Whether a column header (slice 0 A byte) is extended. */
export const isExtendedHeader = (a: number): boolean => a > 0 && a < 64;

/**
 * Per-cell floor height: uses the grid's own per-cell floor data when present (iteration 05 traversal
 * work adds it: a `floor` Float32Array or a `floorAt(wx, wz)` helper), else track bed for VOID cells and
 * the station floor (y = 0) elsewhere.
 */
export function cellFloorFn(grid: Grid, trenchFloorY: number): (cx: number, cy: number) => number {
  const g = grid as Grid & {floor?: ArrayLike<number>; floorOf?: (i: number) => number; floorAt?: (wx: number, wz: number) => number};
  const ofIdx = typeof g.floorOf === 'function' ? g.floorOf.bind(g) : null;
  const arr = g.floor && g.floor.length === g.w * g.h ? g.floor : null;
  const fn = typeof g.floorAt === 'function' ? g.floorAt.bind(g) : null;
  return (cx, cy) => {
    const i = cy * g.w + cx;
    const v = ofIdx ? ofIdx(i) : arr ? arr[i] : fn ? fn((cx + 0.5) * CELL, (cy + 0.5) * CELL) : 0;
    const f = Number.isFinite(v) ? v : 0;
    // Track bed cells left at 0 mean "unset": they sit at the bed floor.
    return g.cells[i] === VOID && f === 0 ? trenchFloorY : f;
  };
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Per-cell open/solid state, floor, ceiling and layer heights (shared by the bake and tests). */
export interface ColumnGeometry { open: Uint8Array; floorH: Float32Array; ceilH: Float32Array; layerY: Float32Array; yMin: number; yMax: number }

export function columnGeometry(src: FieldSource, L = LAYERS): ColumnGeometry {
  const g = src.grid;
  const W = g.w, H = g.h, n = W * H;
  const floorOf = src.floorAt ?? cellFloorFn(g, src.trenchFloorY);
  const open = new Uint8Array(n);       // 0 solid, 1 open, 2 open but holds a sight-blocking prop
  const floorH = new Float32Array(n), ceilH = new Float32Array(n);
  const layerY = new Float32Array(n * L);
  let yMin = Infinity, yMax = -Infinity;
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const i = cy * W + cx;
    if (g.cells[i] === SOLID) continue;
    open[i] = g.sightBlocked[i] ? 2 : 1;
    const f = floorOf(cx, cy);
    const c = g.ceil[i] > f + 0.5 ? g.ceil[i] : f + 3;
    floorH[i] = f; ceilH[i] = c;
    for (let k = 0; k < L; k++) layerY[i * L + k] = f + 0.05 + (c - 0.13 - f) * layerT(k, L);
    if (f < yMin) yMin = f;
    if (c > yMax) yMax = c;
  }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 4; }
  return {open, floorH, ceilH, layerY, yMin: yMin - 0.5, yMax: yMax + 0.5};
}

/** Every level of a field source (a single main level when `levels` is absent). */
function sourceLevels(src: FieldSource): readonly Level[] {
  return src.levels && src.levels.length ? src.levels : [{id: 0, role: 'main', grid: src.grid, baseY: 0}];
}

/** Per-level column geometry (level 0 honours src.floorAt). */
export function levelGeometries(src: FieldSource): ColumnGeometry[] {
  return sourceLevels(src).slice(0, MAX_SLOTS).map((L, k) => columnGeometry({grid: L.grid, lights: src.lights, trenchFloorY: src.trenchFloorY, floorAt: k === 0 ? src.floorAt : undefined}, slotLayers(k)));
}

/**
 * Union of free bands per column (all levels, identical bands merged): flat arrays for the exact
 * cross-level rays. Band b of column i: start[i] <= b < start[i + 1].
 */
interface UnionBands {
  start: Int32Array; f: Float32Array; c: Float32Array; prop: Uint8Array;
  /** Union band holding slot s's band at column i: of[s * n + i] (-1 = slot closed there). */
  of: Int32Array;
}

function unionBands(geos: readonly ColumnGeometry[], n: number): UnionBands {
  const start = new Int32Array(n + 1);
  const of = new Int32Array(geos.length * n).fill(-1);
  const f: number[] = [], c: number[] = [], prop: number[] = [];
  for (let i = 0; i < n; i++) {
    start[i] = f.length;
    const s0 = f.length;
    for (let s = 0; s < geos.length; s++) {
      const g = geos[s];
      if (!g.open[i]) continue;
      let dup = -1;
      for (let b = s0; b < f.length; b++) if (Math.abs(f[b] - g.floorH[i]) < 1e-3 && Math.abs(c[b] - g.ceilH[i]) < 1e-3) { dup = b; if (g.open[i] === 2) prop[b] = 1; break; }
      if (dup >= 0) { of[s * n + i] = dup; continue; }
      of[s * n + i] = f.length;
      f.push(g.floorH[i]); c.push(g.ceilH[i]); prop.push(g.open[i] === 2 ? 1 : 0);
    }
  }
  start[n] = f.length;
  return {start, f: Float32Array.from(f), c: Float32Array.from(c), prop: Uint8Array.from(prop), of};
}

/**
 * Union bands a straight ray from a fixture can reach within `R` (m): flood from the bands holding the emitter (fx, fz at
 * height fy) over 4-neighbour columns whose bands share a height (within the rays' 2 x CLEAR_EPS grazing tolerance). Every
 * column a traceUnion ray crosses is a 4-neighbour of the previous one and both its height spans contain their common
 * boundary height, so a ray can only succeed into a band this flood stamped (cross-level work outside it is skipped:
 * exact, not a heuristic). Stamps `mark[b] = stamp` per reached band; returns how many bands were reached.
 */
class BandFlood {
  private readonly queue: Int32Array;
  readonly mark: Int32Array;
  private stamp = 0;
  constructor(private readonly U: UnionBands, private readonly W: number, private readonly H: number) {
    this.mark = new Int32Array(U.f.length);
    this.queue = new Int32Array(Math.max(16, U.f.length) * 2);
  }
  /** Floods from the emitter; the current stamp is returned (compare `mark[b] === stamp`). */
  run(fx: number, fz: number, fy: number, R: number): number {
    const {U, W, H, mark, queue} = this;
    const st = ++this.stamp;
    const cx0 = Math.floor(fx / CELL), cy0 = Math.floor(fz / CELL);
    if (cx0 < 0 || cy0 < 0 || cx0 >= W || cy0 >= H) return st;
    const reach = R + 1.5 * CELL, r2 = reach * reach, tol = 2 * CLEAR_EPS;
    let qh = 0, qt = 0;
    const i0 = cy0 * W + cx0;
    for (let b = U.start[i0]; b < U.start[i0 + 1]; b++) if (fy >= U.f[b] - CLEAR_EPS && fy <= U.c[b] + CLEAR_EPS) { mark[b] = st; queue[qt++] = i0; queue[qt++] = b; }
    while (qh < qt) {
      const i = queue[qh++], b = queue[qh++];
      const cx = i % W, cy = (i - cx) / W, bf = U.f[b], bc = U.c[b];
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? cx - 1 : k === 1 ? cx + 1 : cx, ny = k === 2 ? cy - 1 : k === 3 ? cy + 1 : cy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const px = (nx + 0.5) * CELL - fx, pz = (ny + 0.5) * CELL - fz;
        if (px * px + pz * pz > r2) continue;
        const j = ny * W + nx;
        for (let q = U.start[j], e = U.start[j + 1]; q < e; q++) {
          if (mark[q] === st) continue;
          if (Math.max(bf, U.f[q]) > Math.min(bc, U.c[q]) + tol) continue;
          mark[q] = st;
          if (qt + 2 > queue.length) return this.overflow(st);
          queue[qt++] = j; queue[qt++] = q;
        }
      }
    }
    return st;
  }
  /** Queue exhausted (cannot happen: each band is queued once): mark everything reachable. */
  private overflow(st: number): number {
    this.mark.fill(st);
    return st;
  }
}

/**
 * Same-level visibility geometry of level F: its own open cells, plus columns where F is closed but
 * another level's band rises through F's walking height (light wells, double-height voids next to a
 * deck): light from F's fixtures crosses those.
 */
function passThrough(geos: readonly ColumnGeometry[], levels: readonly Level[], F: number, n: number): {open: Uint8Array; floorH: Float32Array; ceilH: Float32Array} {
  const g = geos[F];
  if (geos.length === 1) return g;
  const open = g.open.slice(), floorH = g.floorH.slice(), ceilH = g.ceilH.slice();
  const base = levels[F].baseY;
  for (let i = 0; i < n; i++) {
    if (open[i]) continue;
    for (let s = 0; s < geos.length; s++) {
      const o = geos[s];
      if (s === F || !o.open[i]) continue;
      if (o.floorH[i] <= base + 0.5 && o.ceilH[i] >= base + 2.0) { open[i] = o.open[i]; floorH[i] = o.floorH[i]; ceilH[i] = o.ceilH[i]; break; }
    }
  }
  return {open, floorH, ceilH};
}

/**
 * Exact ray from the fixture (fx, fz at height fy) to the layers of cell (tx, ty) through the union of
 * free bands: every column the 2D path crosses must hold the ray's height span inside ONE free band.
 * Sight-blocking props (in the band used) transmit PROP_TRANSMITTANCE. Per-layer result in `out`.
 */
function traceUnion(W: number, H: number, U: UnionBands, fx: number, fz: number, fy: number, tx: number, ty: number,
  layerY: Float32Array, lo: number, L: number, out: Float32Array): boolean {
  const ex = (tx + 0.5) * CELL, ez = (ty + 0.5) * CELL;
  const dx = ex - fx, dz = ez - fz;
  let x = Math.floor(fx / CELL), y = Math.floor(fz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDY = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (dx > 0 ? (x + 1) * CELL - fx : fx - x * CELL) / adx : Infinity;
  let tMaxY = adz > 1e-9 ? (dz > 0 ? (y + 1) * CELL - fz : fz - y * CELL) / adz : Infinity;
  let tIn = 0, t = 1, alive = L;
  for (let k = 0; k < L; k++) out[k] = 1;
  const start = y * W + x, target = ty * W + tx;
  for (let guard = 0; guard < 4096; guard++) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = y * W + x;
    const b0 = U.start[i], b1 = U.start[i + 1];
    if (b0 === b1) return false;
    const tOut = Math.min(tMaxX, tMaxY, 1);
    let propHit = false;
    for (let k = 0; k < L; k++) {
      if (out[k] <= 0) continue;
      const dyk = layerY[lo + k] - fy;
      const ya = fy + dyk * tIn, yb = fy + dyk * tOut;
      const ylo = Math.min(ya, yb), yhi = Math.max(ya, yb);
      let ok = false;
      for (let b = b0; b < b1; b++) {
        if (ylo >= U.f[b] - CLEAR_EPS && yhi <= U.c[b] + CLEAR_EPS) { ok = true; if (U.prop[b]) propHit = true; break; }
      }
      if (!ok) { out[k] = 0; alive--; }
    }
    if (!alive) return false;
    if (propHit && i !== start && i !== target) t *= PROP_TRANSMITTANCE;
    if (i === target) break;
    if (tMaxX < tMaxY) { tIn = tMaxX; tMaxX += tDX; x += stepX; } else { tIn = tMaxY; tMaxY += tDY; y += stepY; }
  }
  if (t < 1) for (let k = 0; k < L; k++) out[k] *= t;
  return true;
}

export function bakeLightField(src: FieldSource, p: FieldParams = DEFAULT_FIELD): BakedField {
  return drainSync(bakeLightFieldSteps(src, p));
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the bake as steps (core/pacedBuild.ts) — the same code in the
 * same order, a `yield` between its phases, every few fixtures of the direct light, per bounce slot and per encoded slot rows, where
 * the journey's paced build may let a frame be drawn (the result is not read before it returns). `stats.ms` is wall time, waits included.
 */
export function* bakeLightFieldSteps(src: FieldSource, p: FieldParams = DEFAULT_FIELD): BuildSteps<BakedField> {
  const t0 = performance.now();
  const g = src.grid;
  const W = g.w, H = g.h, n = W * H;
  const levels = sourceLevels(src);
  const S = Math.min(MAX_SLOTS, levels.length);
  const geos = levelGeometries(src).slice(0, S);
  let yMin = Infinity, yMax = -Infinity;
  for (const q of geos) { yMin = Math.min(yMin, q.yMin); yMax = Math.max(yMax, q.yMax); }
  const U = S > 1 && src.crossLevel !== false ? unionBands(geos, n) : null;
  const flood = U && (src.crossCull ?? S > LEGACY_BANDS) ? new BandFlood(U, W, H) : null;

  yield 'field.direct';
  // --- Direct light (per slot) -------------------------------------------------------------
  const LS = geos.map((_, s) => slotLayers(s));
  const E = LS.map(L => new Float32Array(n * L * 3));       // tinted fluence (rgb)
  const D = LS.map(L => new Float32Array(n * L * 3));       // luminance-weighted light direction (toward the light)
  const EL = LS.map(L => new Float32Array(n * L));          // fluence luminance
  const GL = geos.map(() => new Float32Array(n * FLICKER_GROUPS)); // per column: luminance from each circuit (all layers)
  const G2L = LS.map(L => new Float32Array(n * L));         // per layer: luminance from the dying circuit
  const groups = new Int8Array(src.lights.length);
  const trans = new Float32Array(LAYERS);
  const circuits: [number, number, number] = [0, 0, 0];
  let working = 0, steady = 0, rays = 0, crossRays = 0, crossCulled = 0;
  const vis = geos.map((q, F) => {
    const eff = passThrough(geos, levels, F, n);
    return new FixtureVisibility(g, eff.open, eff.floorH, eff.ceilH, q.layerY, LS[F]);
  });

  // (lane BUILD) one fixture per call: the hot loops stay in a plain function (a generator body runs them slower before the JIT warms up)
  const directOf = (li: number): void => {
    const l = src.lights[li];
    const grp = fixtureGroup(l, li);
    groups[li] = grp;
    if (l.broken || l.power <= 0.01) return;
    working++;
    if (grp < 0) steady++; else circuits[grp]++;
    const F = Math.min(S - 1, Math.max(0, l.level ?? 0));
    const geoF = geos[F];
    const [tr, tg, tb] = fixtureTint(l);
    const tl = lum(tr, tg, tb);
    const R = Math.max(4, p.range * Math.sqrt(Math.min(1.5, l.power)));
    const R2 = R * R;
    const k0 = p.gain * l.power * 0.5; // two sub-points along the tube
    // Tube ends (the fixture is a ~1.2 m strip): elongated pools along the fixture axis.
    const ax = Math.cos(l.rot) * 0.35, az = -Math.sin(l.rot) * 0.35;
    const [fcx, fcy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(fcx, fcy)) return;
    const fi = fcy * W + fcx;
    if (!geoF.open[fi]) return;
    // Fixtures hang just under their own cell's ceiling (pendants lower): keep the emitter inside the cell.
    const fy = Math.max(geoF.floorH[fi] + 0.3, Math.min(l.y - 0.05, geoF.ceilH[fi] - 0.06));
    vis[F].begin(l.x, l.z, fy);
    // Cross-level reach of this fixture (union bands a straight ray from it can end in, within its range).
    const reach = flood ? flood.run(l.x, l.z, fy, R) : 0;
    const x0 = Math.max(0, Math.floor((l.x - R) / CELL)), x1 = Math.min(W - 1, Math.floor((l.x + R) / CELL));
    const y0 = Math.max(0, Math.floor((l.z - R) / CELL)), y1 = Math.min(H - 1, Math.floor((l.z + R) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      const pz = (cy + 0.5) * CELL;
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * W + cx;
        const px = (cx + 0.5) * CELL;
        const hx = px - l.x, hz = pz - l.z, h2 = hx * hx + hz * hz;
        if (h2 > R2) continue;
        for (let s = 0; s < S; s++) {
          const geo = geos[s], L = LS[s];
          if (!geo.open[i]) continue;
          if (s === F) {
            rays++;
            if (!vis[F].query(cx, cy, Math.sqrt(h2), trans)) continue;
          } else {
            if (!U) continue;
            const ub = U.of[s * n + i];
            if (flood && (ub < 0 || flood.mark[ub] !== reach)) { crossCulled++; continue; }
            crossRays++;
            if (!traceUnion(W, H, U, l.x, l.z, fy, cx, cy, geo.layerY, i * L, L, trans)) continue;
          }
          const Es = E[s], Ds = D[s], ELs = EL[s], layerY = geo.layerY;
          // Within 3 m the tube is two emitters (elongated pool); further out one point is indistinguishable.
          const near = h2 < 9, ns = near ? 2 : 1, kw = near ? k0 : k0 * 2;
          for (let k = 0; k < L; k++) {
            const tk = trans[k];
            if (tk <= 0) continue;
            const py = layerY[i * L + k];
            let e = 0, dx = 0, dy = 0, dz = 0;
            for (let si = 0; si < ns; si++) {
              const sgn = near ? si * 2 - 1 : 0;
              const lx = l.x + ax * sgn - px, ly = fy - py, lz = l.z + az * sgn - pz;
              const d2 = lx * lx + ly * ly + lz * lz;
              if (d2 >= R2) continue;
              const d = Math.sqrt(d2);
              const down = ly > 0 ? ly / d : 0;
              const emit = p.uplight + (1 - p.uplight) * (p.lobe === 2 ? down * down : down);
              const q = d2 / R2, win = (1 - q * q) * (1 - q * q);
              const v = kw * emit * win / (d2 + 0.3);
              e += v;
              dx += v * lx / d; dy += v * ly / d; dz += v * lz / d;
            }
            if (e <= 0) continue;
            e *= tk; dx *= tk; dy *= tk; dz *= tk;
            const vi = (i * L + k) * 3;
            Es[vi] += e * tr; Es[vi + 1] += e * tg; Es[vi + 2] += e * tb;
            Ds[vi] += dx * tl; Ds[vi + 1] += dy * tl; Ds[vi + 2] += dz * tl;
            ELs[i * L + k] += e * tl;
            if (grp >= 0) {
              GL[s][i * FLICKER_GROUPS + grp] += e * tl;
              if (grp === 2) G2L[s][i * L + k] += e * tl;
            }
          }
        }
      }
    }
  };
  for (let li = 0; li < src.lights.length; li++) { directOf(li); if (li % 4 === 3) yield; }

  yield 'field.extra';
  // Task track3-eaton-centre-20261031 (lane ARCH): extra direct light (the mall skylight), steady (no flicker circuit share).
  const extra = src.extraDirect ? src.extraDirect({W, H, levels: levels.slice(0, S), geos, layers: LS, E, D, EL, bands: U ? {start: U.start, f: U.f, c: U.c} : null}) ?? undefined : undefined;

  // --- Bounce fill per slot: half area mean, half local, then a short wall-respecting diffusion ------
  // (Open cells only, typed arrays and precomputed neighbour masks: this runs before the JIT warms up.)
  yield 'field.bounce';
  const bounceOf = (geo: ColumnGeometry, s: number) => {
    const {open, floorH} = geo;
    const L = LS[s];
    const sg = levels[s].grid;
    let maxArea = 0;
    for (let i = 0; i < n; i++) if (sg.area[i] > maxArea) maxArea = sg.area[i];
    const aSum = new Float64Array((maxArea + 2) * 4); // r, g, b, count per area (+1 slot for area -1)
    const cells: number[] = [];
    const col = new Float32Array(n * 3);
    const Es = E[s];
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue;
      cells.push(i);
      let r = 0, gg = 0, b = 0;
      for (let k = 0; k < L; k++) { const vi = (i * L + k) * 3; r += Es[vi]; gg += Es[vi + 1]; b += Es[vi + 2]; }
      r /= L; gg /= L; b /= L;
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      const a = (sg.area[i] + 1) * 4;
      aSum[a] += r; aSum[a + 1] += gg; aSum[a + 2] += b; aSum[a + 3]++;
    }
    const oc = Int32Array.from(cells);
    // Neighbour mask: bounce flows between open neighbours, but not over cliffs (platform edge, stair wells).
    const nmask = new Uint8Array(oc.length);
    for (let q = 0; q < oc.length; q++) {
      const i = oc[q], cx = i % W, cy = (i - cx) / W, f = floorH[i];
      let m = 0;
      if (cx > 0 && open[i - 1] && Math.abs(floorH[i - 1] - f) < 0.6) m |= 1;
      if (cx < W - 1 && open[i + 1] && Math.abs(floorH[i + 1] - f) < 0.6) m |= 2;
      if (cy > 0 && open[i - W] && Math.abs(floorH[i - W] - f) < 0.6) m |= 4;
      if (cy < H - 1 && open[i + W] && Math.abs(floorH[i + W] - f) < 0.6) m |= 8;
      nmask[q] = m;
    }
    let B = new Float32Array(n * 3), B2 = new Float32Array(n * 3);
    for (let q = 0; q < oc.length; q++) {
      const i = oc[q], a = (sg.area[i] + 1) * 4, an = aSum[a + 3];
      for (let c = 0; c < 3; c++) B[i * 3 + c] = p.bounce * (0.5 * aSum[a + c] / an + 0.5 * col[i * 3 + c]);
    }
    for (let it = 0; it < 10; it++) {
      for (let q = 0; q < oc.length; q++) {
        const i = oc[q], m = nmask[q], i3 = i * 3;
        let r = B[i3], gg = B[i3 + 1], b = B[i3 + 2], cnt = 1;
        if (m & 1) { const j = i3 - 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
        if (m & 2) { const j = i3 + 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
        if (m & 4) { const j = i3 - W * 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
        if (m & 8) { const j = i3 + W * 3; r += B[j]; gg += B[j + 1]; b += B[j + 2]; cnt++; }
        B2[i3] = r / cnt; B2[i3 + 1] = gg / cnt; B2[i3 + 2] = b / cnt;
      }
      [B, B2] = [B2, B];
    }
    return B;
  };
  // Task studio-baked-lighting-reflections-20261114-050258-01: the enhanced gather replaces the fill (encoded below from `ind`)
  const ind = src.indirect ? yield* src.indirect({W, H, geos, layers: LS, E, D, EL, GL, G2L, scatter: p.scatter}) : null;
  const bounce: Float32Array[] = [];
  if (!ind) for (let s = 0; s < geos.length; s++) { bounce.push(bounceOf(geos[s], s)); yield; } // (lane BUILD: one slot per step)

  yield 'field.headers';
  // --- Column headers: which slots are really present per column (a flight carved into two level grids is one band: it
  // belongs to the level whose walking height is nearer, so the shader's choice is unique), sorted by floor.
  const masks = new Uint16Array(n), bandCnt = new Uint8Array(n), bandSlot = new Uint8Array(n * MAX_BANDS), legacyCol = new Uint8Array(n);
  let maxBands = 0, extCols = 0, cut = 0, hdr = 0;
  {
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      let mask = 0;
      for (let s = 0; s < S; s++) {
        const q = geos[s];
        if (!q.open[i]) continue;
        let dupOf = -1;
        for (let t = 0; t < s; t++) if (geos[t].open[i] && Math.abs(geos[t].floorH[i] - q.floorH[i]) < 1e-3 && Math.abs(geos[t].ceilH[i] - q.ceilH[i]) < 1e-3) { dupOf = t; break; }
        if (dupOf < 0) { mask |= 1 << s; continue; }
        if (Math.abs(q.floorH[i] - levels[s].baseY) < Math.abs(q.floorH[i] - levels[dupOf].baseY)) { mask &= ~(1 << dupOf); mask |= 1 << s; }
      }
      if (!mask) continue;
      order.length = 0;
      for (let s = 0; s < S; s++) if ((mask >> s) & 1) order.push(s);
      order.sort((p, q) => geos[p].floorH[i] - geos[q].floorH[i]);
      if (order.length > MAX_BANDS) { cut++; order.length = MAX_BANDS; mask = 0; for (const s of order) mask |= 1 << s; }
      masks[i] = mask;
      bandCnt[i] = order.length;
      for (let k = 0; k < order.length; k++) bandSlot[i * MAX_BANDS + k] = order[k];
      maxBands = Math.max(maxBands, order.length);
      if (order.length <= LEGACY_BANDS && order.every(s => s < LEGACY_SLOTS)) legacyCol[i] = 1;
      else { extCols++; hdr = Math.max(hdr, Math.ceil(order.length / GROUP_BANDS)); }
    }
  }
  const depth = fieldDepth(S) + hdr, gs0 = fieldDepth(S);
  const data = new Uint8Array(W * H * depth * 4);
  yield;
  // Packed slot choice (no per-slot loop in the shader). Legacy columns (the iteration-08 texel, byte for byte): R = slot
  // mask, G / B = heights between consecutive bands (mid-slab), A = band count << 6 | slot of band k in bits 2k. Extended
  // columns: A = band count, R / G / B = the splits above bands 2 / 5 / 8; group texel g (slice gs0 + g) = the splits above
  // bands 3g / 3g + 1 and the slot ids of bands 3g, 3g + 1 (B: low / high nibble) and 3g + 2 (A).
  // Closed columns copy an open neighbour's packing (filtering near walls reads that neighbour's slot).
  {
    const yr0 = yMax - yMin, q8 = (v: number) => Math.round(Math.min(1, Math.max(0, (v - yMin) / yr0)) * 255);
    const split = (i: number, lo: number, up: number) => q8((geos[lo].ceilH[i] + geos[up].floorH[i]) / 2);
    for (let i = 0; i < n; i++) {
      const cnt = bandCnt[i];
      if (!cnt) continue;
      const ids = bandSlot.subarray(i * MAX_BANDS, i * MAX_BANDS + cnt), o = i * 4;
      if (legacyCol[i]) {
        data[o] = masks[i];
        let pk = cnt << 6;
        for (let k = 0; k < cnt; k++) pk |= ids[k] << (2 * k);
        data[o + 3] = pk;
        if (cnt > 1) data[o + 1] = split(i, ids[0], ids[1]);
        if (cnt > 2) data[o + 2] = split(i, ids[1], ids[2]);
        continue;
      }
      data[o + 3] = cnt;
      for (let c = 0; c < 3; c++) { const b = GROUP_BANDS * (c + 1); if (cnt > b) data[o + c] = split(i, ids[b - 1], ids[b]); }
      for (let g = 0; g * GROUP_BANDS < cnt; g++) {
        const go = ((gs0 + g) * n + i) * 4, b0 = g * GROUP_BANDS;
        if (b0 + 1 < cnt) data[go] = split(i, ids[b0], ids[b0 + 1]);
        if (b0 + 2 < cnt) data[go + 1] = split(i, ids[b0 + 1], ids[b0 + 2]);
        data[go + 2] = ids[b0] + 16 * (b0 + 1 < cnt ? ids[b0 + 1] : 0);
        data[go + 3] = b0 + 2 < cnt ? ids[b0 + 2] : 0;
      }
    }
    for (let i = 0; i < n; i++) {
      if (masks[i]) continue;
      const cx = i % W;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < n && masks[j] && Math.abs((j % W) - cx) <= 1) {
        if (!legacyCol[j]) {
          data[i * 4] = data[j * 4];
          for (let g = 0; g < hdr; g++) for (let c = 0; c < 4; c++) data[((gs0 + g) * n + i) * 4 + c] = data[((gs0 + g) * n + j) * 4 + c];
        }
        data[i * 4 + 1] = data[j * 4 + 1]; data[i * 4 + 2] = data[j * 4 + 2]; data[i * 4 + 3] = data[j * 4 + 3];
        break;
      }
    }
  }
  yield;
  // Slot header height ranges: the global range in a legacy field (iteration-08 bytes and maths), each slot's own range
  // (its open floors / ceilings and the closed-cell default band) in an extended one.
  const slotY = new Float64Array(2 * S);
  for (let s = 0; s < S; s++) {
    if (!hdr) { slotY[2 * s] = yMin; slotY[2 * s + 1] = yMax; continue; }
    const {open, floorH, ceilH} = geos[s], b = levels[s].baseY;
    let lo = b, hi = b + 3;
    for (let i = 0; i < n; i++) if (open[i]) { if (floorH[i] < lo) lo = floorH[i]; if (ceilH[i] > hi) hi = ceilH[i]; }
    slotY[2 * s] = lo - 0.25; slotY[2 * s + 1] = hi + 0.25;
  }

  yield 'field.encode';
  // --- Encode --------------------------------------------------------------------------------
  const enc = (v: number) => Math.round(Math.sqrt(Math.min(1, Math.max(0, v / FIELD_EMAX))) * 255);
  const u8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let s = 0; s < S; s++) {
    const {open, floorH, ceilH} = geos[s];
    const Es = E[s], Ds = D[s], ELs = EL[s], GLs = GL[s], G2Ls = G2L[s], B = bounce[s];
    const base = slotBase(s), L = LS[s];
    const ylo = slotY[2 * s], yr = slotY[2 * s + 1] - ylo;
    // Task studio-baked-lighting-reflections-20261114-050258-01: a row of an ENHANCED field. The direct light is the baseline's:
    // its colour, its direction and its directional share of the direct light, texel for texel. The gathered indirect light joins
    // it without a direction of its own (a voxel has ONE direction, and it is the direct light's business: an earlier version mixed
    // the bounce's first moment into it, and wherever the fixtures' own directions cancel — the lines between two rows of tubes —
    // the direction flipped to "from the floor" and drew bright veins on the ceiling). What the first moment does decide is how
    // much each LAYER stores: the bottom layer is what floors read and the top layer what ceilings read, so each holds what that
    // surface gets — the mean plus (minus) twice the first moment's height part, never below nothing or above three times the
    // mean. A floor is not lit by its own bounce; a ceiling gets the floor's in full. The layers between hold the mean.
    // The flicker shares count the indirect light's own circuits.
    const ix = ind ? ind.index[s] : null, id = ind ? ind.data : null, cohK = new Float32Array(LAYERS);
    /** What voxel k (row q, mean luminance ml > 0) stores of the gathered light, as a factor of its mean. */
    const indK = (k: number, q: number, ml: number): number => {
      if (L < 2 || (k > 0 && k < L - 1)) return 1;
      const fy = 1 + (k === 0 ? 2 : -2) * id![q + 4] / ml;
      return fy < 0 ? 0 : fy > 3 ? 3 : fy;
    };
    const encodeRowEnhanced = (cy: number): void => { for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      let hi = i;
      if (!open[i]) {
        hi = -1;
        for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < n && open[j] && Math.abs((j % W) - cx) <= 1) { hi = j; break; }
      }
      const o0 = ((base * H + cy) * W + cx) * 4;
      const dfl = levels[s].baseY;
      data[o0] = hi >= 0 ? u8((floorH[hi] - ylo) / yr) : u8((dfl - ylo) / yr);
      data[o0 + 1] = hi >= 0 ? u8((ceilH[hi] - ylo) / yr) : u8((dfl + 3 - ylo) / yr);
      if (!open[i]) continue;
      let tot = 0, totD = 0, totI = 0, c0 = 0, c1 = 0;
      for (let k = 0; k < L; k++) {
        const vi = (i * L + k) * 3, el = ELs[i * L + k];
        const dmag = Math.sqrt(Ds[vi] * Ds[vi] + Ds[vi + 1] * Ds[vi + 1] + Ds[vi + 2] * Ds[vi + 2]);
        const dl = Math.min(el, dmag), coh = el > 0 ? (dl + (el - dl) * p.scatter) / el : 0;
        cohK[k] = coh; tot += el; totD += el * coh;
        const q = ix![i * L + k] * 9, ml = lum(id![q], id![q + 1], id![q + 2]);
        if (ml <= 0) continue;
        const ik = indK(k, q, ml);
        totI += ml * ik; c0 += id![q + 6] * ik; c1 += id![q + 7] * ik;
      }
      const cohAvg = tot > 0 ? totD / tot : 0, den = totD + totI;
      data[o0 + 2] = den > 0 ? u8((GLs[i * FLICKER_GROUPS] * cohAvg + c0) / den) : 0;
      data[o0 + 3] = den > 0 ? u8((GLs[i * FLICKER_GROUPS + 1] * cohAvg + c1) / den) : 0;
      for (let k = 0; k < L; k++) {
        const vi = (i * L + k) * 3, el = ELs[i * L + k], coh = cohK[k];
        const dxv = Ds[vi], dyv = Ds[vi + 1], dzv = Ds[vi + 2];
        const dmag = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
        const dl = Math.min(el, dmag);
        const q = ix![i * L + k] * 9, mr = id![q], mg = id![q + 1], mb = id![q + 2], ml = lum(mr, mg, mb);
        const ik = ml > 0 ? indK(k, q, ml) : 0;
        const r = Es[vi] * coh + mr * ik, gg = Es[vi + 1] * coh + mg * ik, b = Es[vi + 2] * coh + mb * ik;
        const tl = el * coh + ml * ik;
        const rho = tl > 0 ? dl / tl : 0;
        const oa = (((base + 1 + 2 * k) * H + cy) * W + cx) * 4, ob = (((base + 2 + 2 * k) * H + cy) * W + cx) * 4;
        data[oa] = enc(r); data[oa + 1] = enc(gg); data[oa + 2] = enc(b); data[oa + 3] = u8(rho);
        const inv = dl > 1e-6 ? 1 / dmag : 0;
        data[ob] = u8(dl > 1e-6 ? dxv * inv * 0.5 + 0.5 : 0.5);
        data[ob + 1] = u8(dl > 1e-6 ? dyv * inv * 0.5 + 0.5 : 1);
        data[ob + 2] = u8(dl > 1e-6 ? dzv * inv * 0.5 + 0.5 : 0.5);
        data[ob + 3] = tl > 0 ? u8((G2Ls[i * L + k] * coh + id![q + 8] * ik) / tl) : 0;
      }
    } };
    const encodeRow = ind ? encodeRowEnhanced : (cy: number): void => { for (let cx = 0; cx < W; cx++) { // (lane BUILD: a row per call, a step per 16 rows; the loop out of the generator body)
      const i = cy * W + cx;
      // Closed cells: zero light; heights borrowed from an open neighbour so filtering near walls stays sane.
      let hi = i;
      if (!open[i]) {
        hi = -1;
        for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < n && open[j] && Math.abs((j % W) - cx) <= 1) { hi = j; break; }
      }
      const o0 = ((base * H + cy) * W + cx) * 4;
      const dfl = levels[s].baseY;
      data[o0] = hi >= 0 ? u8((floorH[hi] - ylo) / yr) : u8((dfl - ylo) / yr);
      data[o0 + 1] = hi >= 0 ? u8((ceilH[hi] - ylo) / yr) : u8((dfl + 3 - ylo) / yr);
      if (!open[i]) continue;
      let tot = 0;
      for (let k = 0; k < L; k++) tot += ELs[i * L + k];
      data[o0 + 2] = tot > 0 ? u8(GLs[i * FLICKER_GROUPS] / tot) : 0;
      data[o0 + 3] = tot > 0 ? u8(GLs[i * FLICKER_GROUPS + 1] / tot) : 0;
      const br = B[i * 3], bg = B[i * 3 + 1], bb = B[i * 3 + 2], bl = lum(br, bg, bb);
      for (let k = 0; k < L; k++) {
        const vi = (i * L + k) * 3, el = ELs[i * L + k];
        const dxv = Ds[vi], dyv = Ds[vi + 1], dzv = Ds[vi + 2];
        const dmag = Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv);
        const dl = Math.min(el, dmag);
        // Directional luminance |D|; the incoherent remainder reaches surfaces at `scatter`; bounce on top.
        const coh = el > 0 ? (dl + (el - dl) * p.scatter) / el : 0;
        const r = Es[vi] * coh + br, gg = Es[vi + 1] * coh + bg, b = Es[vi + 2] * coh + bb;
        const tl = el * coh + bl;
        const rho = tl > 0 ? dl / tl : 0;
        const oa = (((base + 1 + 2 * k) * H + cy) * W + cx) * 4, ob = (((base + 2 + 2 * k) * H + cy) * W + cx) * 4;
        data[oa] = enc(r); data[oa + 1] = enc(gg); data[oa + 2] = enc(b); data[oa + 3] = u8(rho);
        const inv = dl > 1e-6 ? 1 / dmag : 0;
        data[ob] = u8(dl > 1e-6 ? dxv * inv * 0.5 + 0.5 : 0.5);
        data[ob + 1] = u8(dl > 1e-6 ? dyv * inv * 0.5 + 0.5 : 1);
        data[ob + 2] = u8(dl > 1e-6 ? dzv * inv * 0.5 + 0.5 : 0.5);
        data[ob + 3] = el > 0 ? u8(G2Ls[i * L + k] / el) : 0;
      }
    } };
    for (let cy = 0; cy < H; cy++) { encodeRow(cy); if (cy % 16 === 15) yield; }
  }
  return {
    w: W, h: H, layers: LAYERS, depth, slots: S, data, yMin, yMax, groups, hdr, slotY, masks,
    stats: {ms: performance.now() - t0, bytes: data.byteLength, fixtures: src.lights.length, working, steady, circuits, rays, crossRays, slots: S,
      bands: maxBands, extCols, cut, crossCulled, ...(extra ? {extra} : {}), ...(ind ? {indirect: ind.stats} : {})},
  };
}

/**
 * Fixture -> cell visibility for one fixture at a time, O(1) amortised per cell: each cell's "parent" is
 * the cell one step (0.5 m) back toward the fixture, so visibility, prop transmittance and the vertical
 * clearance of every cell strictly between fixture and target are memoised along parent chains as
 * slope bounds (the tightest ceiling/lintel above and floor/edge below the ray). A target layer is lit
 * when its ray slope fits the bounds. Diagonal steps through two solid corner cells are blocked (no
 * leaks through wall corners). Close to the exact per-ray DDA (traceExact; agreement checked in tests).
 */
export class FixtureVisibility {
  private readonly stamp: Int32Array;
  private readonly mT: Float32Array;
  private readonly mHi: Float32Array;
  private readonly mLo: Float32Array;
  /** Highest floor / lowest ceiling strictly between fixture and cell (decides whether a bound can bind). */
  private readonly mFloor: Float32Array;
  private readonly mCeil: Float32Array;
  private readonly stack = new Int32Array(8192);
  private readonly pstack = new Int32Array(8192);
  private st = 0;
  private fx = 0; private fz = 0; private fy = 0; private fi = -1;
  constructor(private readonly g: Grid, private readonly open: Uint8Array, private readonly floorH: Float32Array, private readonly ceilH: Float32Array,
    private readonly layerY: Float32Array, private readonly L: number) {
    const n = g.w * g.h;
    this.stamp = new Int32Array(n);
    this.mT = new Float32Array(n);
    this.mHi = new Float32Array(n);
    this.mLo = new Float32Array(n);
    this.mFloor = new Float32Array(n);
    this.mCeil = new Float32Array(n);
  }

  begin(fx: number, fz: number, fy: number): void {
    this.st++;
    this.fx = fx; this.fz = fz; this.fy = fy;
    const cx = Math.floor(fx / CELL), cy = Math.floor(fz / CELL);
    this.fi = this.g.inBounds(cx, cy) ? cy * this.g.w + cx : -1;
  }

  private parentOf(c: number): number {
    const W = this.g.w, cx = c % W, cy = (c - cx) / W;
    const px = (cx + 0.5) * CELL, pz = (cy + 0.5) * CELL;
    const vx = this.fx - px, vz = this.fz - pz, d = Math.sqrt(vx * vx + vz * vz);
    if (d < CELL) return this.fi; // adjacent to the fixture's cell (open cells never share a wall edge)
    const qx = Math.floor((px + vx / d * CELL) / CELL), qy = Math.floor((pz + vz / d * CELL) / CELL);
    if (qx < 0 || qy < 0 || qx >= W || qy >= this.g.h) return -1;
    return qy * W + qx;
  }

  /** Resolve memo for cell c (bounds over the cells strictly between the fixture and c). */
  private resolve(c: number): void {
    const {stamp, mT, mHi, mLo, mFloor, mCeil, open, st} = this;
    let sp = 0, cur = c;
    while (stamp[cur] !== st) {
      if (cur === this.fi) { stamp[cur] = st; mT[cur] = 1; mHi[cur] = Infinity; mLo[cur] = -Infinity; mFloor[cur] = -Infinity; mCeil[cur] = Infinity; break; }
      const p = this.parentOf(cur);
      if (p < 0 || !open[cur] && cur !== c) { stamp[cur] = st; mT[cur] = 0; break; }
      this.stack[sp] = cur; this.pstack[sp] = p; sp++;
      if (sp >= this.stack.length) break;
      cur = p;
    }
    const W = this.g.w;
    while (sp > 0) {
      sp--;
      const ch = this.stack[sp], p = this.pstack[sp];
      stamp[ch] = st;
      if (stamp[p] !== st || mT[p] <= 0 || !open[p]) { mT[ch] = 0; continue; }
      if (p === this.fi) { mT[ch] = 1; mHi[ch] = Infinity; mLo[ch] = -Infinity; mFloor[ch] = -Infinity; mCeil[ch] = Infinity; continue; }
      // Diagonal step: blocked when both side cells are solid (corner leak).
      const chx = ch % W, pxi = p % W;
      if (chx !== pxi && (ch - chx) !== (p - pxi) && !open[(ch - chx) + pxi] && !open[(p - pxi) + chx]) { mT[ch] = 0; continue; }
      // Parent's own constraint (it lies strictly between the fixture and ch).
      const pcx = (pxi + 0.5) * CELL, pcz = ((p - pxi) / W + 0.5) * CELL;
      const s = Math.sqrt((pcx - this.fx) ** 2 + (pcz - this.fz) ** 2);
      const sNear = Math.max(0.05, s - 0.36), sFar = s + 0.36;
      const up = this.ceilH[p] + CLEAR_EPS - this.fy, dn = this.floorH[p] - CLEAR_EPS - this.fy;
      const hi = up >= 0 ? up / sFar : up / sNear;
      const lo = dn <= 0 ? dn / sFar : dn / sNear;
      mT[ch] = mT[p] * (open[p] === 2 ? PROP_TRANSMITTANCE : 1);
      mHi[ch] = Math.min(mHi[p], hi);
      mLo[ch] = Math.max(mLo[p], lo);
      mFloor[ch] = Math.max(mFloor[p], this.floorH[p]);
      mCeil[ch] = Math.min(mCeil[p], this.ceilH[p]);
    }
  }

  /** Per-layer transmittance from the current fixture to the layers of cell (cx, cy); false = all dark. */
  query(cx: number, cy: number, dist: number, out: Float32Array): boolean {
    const i = cy * this.g.w + cx;
    if (!this.open[i] || this.fi < 0) return false;
    this.resolve(i);
    const T = this.mT[i];
    if (T <= 0) return false;
    const hi = this.mHi[i], lo = this.mLo[i], fy = this.fy, L = this.L, pf = this.mFloor[i], pc = this.mCeil[i];
    // The target cell's own near edge only matters when the fixture is above its ceiling / below its floor.
    const sNear = Math.max(0.05, dist - 0.36);
    const tHi = fy > this.ceilH[i] + CLEAR_EPS ? (this.ceilH[i] + CLEAR_EPS - fy) / sNear : Infinity;
    const tLo = fy < this.floorH[i] - CLEAR_EPS ? (this.floorH[i] - CLEAR_EPS - fy) / sNear : -Infinity;
    let any = false;
    for (let k = 0; k < L; k++) {
      if (dist < 1e-3) { out[k] = T; any = true; continue; }
      const yk = this.layerY[i * L + k], slope = (yk - fy) / dist;
      // The ray spans [min(fy, yk), max(fy, yk)]: floors below / ceilings above that range can never block
      // it (the slope bounds are conservative near the target, so only apply them when they can bind).
      const ok = (pc + CLEAR_EPS >= Math.max(fy, yk) || slope <= hi) && (pf - CLEAR_EPS <= Math.min(fy, yk) || slope >= lo) && slope <= tHi && slope >= tLo;
      out[k] = ok ? T : 0;
      any ||= ok;
    }
    return any;
  }
}

/**
 * Exact reference: 2D DDA from the fixture (fx, fz at height fy) to the centre of cell (tx, ty), checking
 * every traversed cell's floor/ceiling against each layer's ray height. Per-layer transmittance in `out`.
 */
export function traceExact(g: Grid, open: Uint8Array, floorH: Float32Array, ceilH: Float32Array, fx: number, fz: number, fy: number,
  tx: number, ty: number, layerY: Float32Array, lo: number, L: number, out: Float32Array): boolean {
  const W = g.w;
  const ex = (tx + 0.5) * CELL, ez = (ty + 0.5) * CELL;
  const dx = ex - fx, dz = ez - fz;
  let x = Math.floor(fx / CELL), y = Math.floor(fz / CELL);
  const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const tDX = adx > 1e-9 ? CELL / adx : Infinity, tDY = adz > 1e-9 ? CELL / adz : Infinity;
  let tMaxX = adx > 1e-9 ? (dx > 0 ? (x + 1) * CELL - fx : fx - x * CELL) / adx : Infinity;
  let tMaxY = adz > 1e-9 ? (dz > 0 ? (y + 1) * CELL - fz : fz - y * CELL) / adz : Infinity;
  let tIn = 0, t = 1, alive = L;
  for (let k = 0; k < L; k++) out[k] = 1;
  const start = y * W + x;
  for (let guard = 0; guard < 4096; guard++) {
    if (x < 0 || y < 0 || x >= W || y >= g.h) return false;
    const i = y * W + x;
    const o = open[i];
    if (!o) return false;
    if (o === 2 && i !== start && !(x === tx && y === ty)) t *= PROP_TRANSMITTANCE;
    const tOut = Math.min(tMaxX, tMaxY, 1);
    const fl = floorH[i] - CLEAR_EPS, ce = ceilH[i] + CLEAR_EPS;
    for (let k = 0; k < L; k++) {
      if (out[k] <= 0) continue;
      const dy = layerY[lo + k] - fy;
      const ya = fy + dy * tIn, yb = fy + dy * tOut;
      if (Math.min(ya, yb) < fl || Math.max(ya, yb) > ce) { out[k] = 0; alive--; }
    }
    if (!alive) return false;
    if (x === tx && y === ty) break;
    if (tMaxX < tMaxY) { tIn = tMaxX; tMaxX += tDX; x += stepX; } else { tIn = tMaxY; tMaxY += tDY; y += stepY; }
  }
  if (t < 1) for (let k = 0; k < L; k++) out[k] *= t;
  return true;
}

// ---------------------------------------------------------------------------------------------
// CPU sampling (mirror of the shader; used for the viewmodel light level, tests and previews)

export interface FieldSample {
  /** Non-directional irradiance (rgb) added to every surface regardless of normal. */
  amb: [number, number, number];
  /** Directional irradiance colour, applied with N.L along `dir`. */
  dirColor: [number, number, number];
  /** Unit direction toward the dominant light (world). */
  dir: [number, number, number];
}

const dec = (b: number) => { const v = b / 255; return v * v * FIELD_EMAX; };

/**
 * Level slot whose band at texel column (ci, cj) contains height y (else the nearest band); only slots
 * present in the column's mask count (a fully closed column considers every slot's borrowed header).
 * Exact mirror of lightFieldNode.ts pickSlot: every split comparison is independent (y > split, gated by the band count),
 * so a column whose quantised splits are not monotone decodes identically on the CPU and the GPU.
 */
export function fieldSlot(f: BakedField, ci: number, cj: number, y: number): {slot: number; floor: number; ceil: number} {
  const W = f.w, H = f.h, d = f.data, yr = f.yMax - f.yMin;
  const o = (cj * W + ci) * 4, pk = d[o + 3], cnt = pk >> 6;
  const over = (v: number, k: number) => (pk > k && y > f.yMin + v / 255 * yr ? 1 : 0);
  let slot: number;
  if (cnt === 0 && pk > 0) {
    // extended column: the group from the coarse splits (R / G / B), the band inside it from the group texel
    const g = over(d[o], 3) + over(d[o + 1], 6) + over(d[o + 2], 9);
    const slice = Math.min(f.depth - 1, fieldDepth(f.slots) + g);
    const go = ((slice * H + cj) * W + ci) * 4, k1 = 3 * g + 1;
    const j = over(d[go], k1) + over(d[go + 1], k1 + 1);
    const B = d[go + 2];
    slot = j === 0 ? B - Math.floor(B / 16) * 16 : j === 1 ? Math.floor(B / 16) : d[go + 3];
  } else {
    let band = 0;
    if (cnt > 1 && y > f.yMin + d[o + 1] / 255 * yr) band++;
    if (cnt > 2 && y > f.yMin + d[o + 2] / 255 * yr) band++;
    slot = (pk >> (2 * band)) & 3;
  }
  slot = Math.min((f.slots ?? 1) - 1, slot);
  const h0 = ((slotBase(slot) * H + cj) * W + ci) * 4;
  const [lo, hi] = slotRange(f, slot), sr = hi - lo;
  return {slot, floor: lo + d[h0] / 255 * sr, ceil: lo + d[h0 + 1] / 255 * sr};
}

/** Slots present in texel column i (bit s = slot s): BakedField.masks, else slice 0 R (legacy fields). */
export function columnMask(f: BakedField, i: number): number {
  return f.masks ? f.masks[i] : f.data[i * 4];
}

/** Sample like the shader: slot by height, bilinear in XZ (texel centres = cell centres), linear between layers. */
export function sampleField(f: BakedField, x: number, y: number, z: number, levels: readonly number[] = [1, 1, 1], normal?: readonly [number, number, number]): FieldSample {
  const W = f.w, H = f.h, d = f.data, C = CELL * (f.cellScale ?? 1);
  if (normal) { x += normal[0] * C * 0.5; y += normal[1] * 0.2; z += normal[2] * C * 0.5; }
  const ci = Math.min(W - 1, Math.max(0, Math.floor(x / C))), cj = Math.min(H - 1, Math.max(0, Math.floor(z / C)));
  const {slot, floor: fl, ceil: ce} = fieldSlot(f, ci, cj, y);
  const base = slotBase(slot), L = slotLayers(slot);
  const rel = Math.min(1, Math.max(0, (y - fl) / Math.max(ce - fl, 0.3))) * (L - 1);
  const k0 = Math.floor(rel), k1 = Math.min(k0 + 1, L - 1), wk = rel - k0;
  // Bilinear texel weights (clamped to edge).
  const u = x / C - 0.5, v = z / C - 0.5;
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const tex = (slice: number, c: number): number => {
    let acc = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const xx = Math.min(W - 1, Math.max(0, iu + a)), yy = Math.min(H - 1, Math.max(0, iv + b));
      const w = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
      acc += w * d[((slice * H + yy) * W + xx) * 4 + c];
    }
    return acc;
  };
  const decT = (slice: number, c: number) => dec(tex(slice, c));
  const mix = (a: number, b: number) => a + (b - a) * wk;
  const sa0 = base + 1 + 2 * k0, sa1 = base + 1 + 2 * k1, sb0 = base + 2 + 2 * k0, sb1 = base + 2 + 2 * k1;
  const T: [number, number, number] = [mix(decT(sa0, 0), decT(sa1, 0)), mix(decT(sa0, 1), decT(sa1, 1)), mix(decT(sa0, 2), decT(sa1, 2))];
  const rho = mix(tex(sa0, 3), tex(sa1, 3)) / 255;
  const dirRaw = [0, 1, 2].map(c => mix(tex(sb0, c), tex(sb1, c)) / 255 * 2 - 1);
  const dl = Math.hypot(dirRaw[0], dirRaw[1], dirRaw[2]) || 1;
  const f0 = tex(base, 2) / 255, f1 = tex(base, 3) / 255, f2 = mix(tex(sb0, 3), tex(sb1, 3)) / 255;
  const m = Math.max(0, 1 - f0 * (1 - levels[0]) - f1 * (1 - levels[1]) - f2 * (1 - levels[2]));
  return {
    amb: [T[0] * (1 - rho) * m, T[1] * (1 - rho) * m, T[2] * (1 - rho) * m],
    dirColor: [T[0] * rho * m, T[1] * rho * m, T[2] * rho * m],
    dir: [dirRaw[0] / dl, dirRaw[1] / dl, dirRaw[2] / dl],
  };
}

/**
 * Box-downsample a baked field by `k` in X/Z (fallback for GPUs whose MAX_3D_TEXTURE_SIZE is below the
 * station grid: WebGL2 only guarantees 256). The shader derives the texel size from the texture size,
 * so a coarser volume needs no shader change; light bleeds up to k/2 cells further near walls. The slot
 * masks are OR-ed; the column header (slice 0 G / B / A, and R + the group slices of an extended column) is taken from the
 * texel with the most bands; every slot slice is averaged.
 */
export function downsampleField(f: BakedField, k: number): BakedField {
  if (k <= 1) return f;
  const W = Math.ceil(f.w / k), H = Math.ceil(f.h / k), D = f.depth, gs0 = fieldDepth(f.slots);
  const data = new Uint8Array(W * H * D * 4);
  const masks = new Uint16Array(W * H);
  const pickOf = new Int32Array(W * H).fill(-1);
  for (let s = 0; s < D; s++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = ((s * H + y) * W + x) * 4;
    if (s >= gs0) { // extended-header group slices: the picked column's
      const p = pickOf[y * W + x];
      if (p >= 0 && isExtendedHeader(f.data[p * 4 + 3])) for (let c = 0; c < 4; c++) data[o + c] = f.data[((s * f.h) * f.w + p) * 4 + c];
      continue;
    }
    const acc = [0, 0, 0, 0];
    let n = 0, mask = 0, pick = -1;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const sx = Math.min(f.w - 1, x * k + dx), sy = Math.min(f.h - 1, y * k + dy);
      const o2 = ((s * f.h + sy) * f.w + sx) * 4;
      if (s === 0) { mask |= columnMask(f, sy * f.w + sx); if (headerBands(f.data[o2 + 3]) > (pick >= 0 ? headerBands(f.data[pick * 4 + 3]) : -1)) pick = sy * f.w + sx; }
      for (let c = 0; c < 4; c++) acc[c] += f.data[o2 + c];
      n++;
    }
    if (s === 0) {
      masks[y * W + x] = mask;
      pickOf[y * W + x] = pick;
      const pe = pick >= 0 && isExtendedHeader(f.data[pick * 4 + 3]);
      data[o] = pe ? f.data[pick * 4] : mask & 255;
      if (pick >= 0) { data[o + 1] = f.data[pick * 4 + 1]; data[o + 2] = f.data[pick * 4 + 2]; data[o + 3] = f.data[pick * 4 + 3]; }
      continue;
    }
    for (let c = 0; c < 4; c++) data[o + c] = Math.round(acc[c] / n);
  }
  return {...f, w: W, h: H, data, masks, stats: {...f.stats, bytes: data.byteLength}, cellScale: k};
}

// ---------------------------------------------------------------------------------------------
// three.js integration (iteration 13: WebGPURenderer node lighting, world/lightFieldNode.ts)

/** Field texture settings shared by every station volume and the TSL placeholder (same binding / sampler state). */
export function configureFieldTexture(t: THREE.Data3DTexture): THREE.Data3DTexture {
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * One station's baked field on the GPU: the RGBA8 3D texture, its world bounds and the live flicker-circuit levels
 * (`resolution` x / y / z = circuits 0 / 1 / 2; the historical name of the WebGL probe-grid protocol it used to ride on).
 * Iteration 13: no longer a scene object. StationLighting binds it to the global TSL nodes (lightFieldNode.ts
 * bindLightField) and puts the session's single LightFieldLight in the scene; the volumetric pass reads it directly.
 */
export class LightFieldVolume {
  readonly name = 'light-field';
  readonly texture: THREE.Data3DTexture;
  readonly boundingBox: THREE.Box3;
  /** Flicker circuit levels (x, y, z = circuits 0, 1, 2). */
  readonly resolution = new THREE.Vector3(1, 1, 1);
  constructor(readonly field: BakedField) {
    this.texture = configureFieldTexture(new THREE.Data3DTexture(field.data, field.w, field.h, field.depth));
    this.texture.name = 'light-field';
    const span = CELL * (field.cellScale ?? 1);
    this.boundingBox = new THREE.Box3(new THREE.Vector3(0, field.yMin, 0), new THREE.Vector3(field.w * span, field.yMax, field.h * span));
  }
  setLevels(l0: number, l1: number, l2: number): void {
    this.resolution.set(l0, l1, l2);
  }
  dispose(): void {
    this.texture.dispose();
  }
}
