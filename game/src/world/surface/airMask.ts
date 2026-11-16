// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's OUTDOOR TOXIC AIR — ONE source of truth for what hurts
// and what shows outdoors (root CLAUDE.md "Toxic gas is always VISIBLE green volumetric fog"). Pure: no three.js / DOM.
//
// THE COLUMN MAP (one byte per level-0 grid cell, built once per district layout and cached on it):
//  - `top[i]` = the height (TOP_STEP m units, absolute y) below which column i is INDOORS. 0 = an outdoor column: the toxic outdoor air
//    fills it from the street up. A building footprint holds its facade top (`SurfaceBuilding.height`, parapet included): every storey
//    of an intact building is protected, the open air above its roof is outdoors again. The checkpoint tent holds its ridge.
//  - GEN's data decides: an outdoor cell is a level-0 FLOOR cell of one of `surface.outdoorAreas` (gen/surface/surfaceTypes.ts) — such a
//    cell is outdoors even inside a footprint (a gutted / roofless shell GEN left open to the street). Other level-0 FLOOR cells outside
//    every footprint (a kiosk, the tent's own area) are enclosed to ENCLOSED_TOP; solid cells outside the footprints (kerbs, the perimeter
//    wall, street furniture) are outdoor columns (the march never samples inside a solid).
//
// THE OUTDOOR GAS c(x, y, z) = C · smoothstep(Y0, Y1, y) · smoothstep(top − EDGE, top, y) with top = the column's (nearest cell, clamped
// to the grid: beyond the boundary the edge columns — open street — continue). The exposure (world/gas/system.ts outdoorAir → this
// gasAt) and the volumetric march (render/volumetric.ts setStation → the surface variant of the regional term: the same uniforms
// [Y0, Y1, C, vis] and THIS byte map as an R8 texture loaded texel by texel) read exactly this; the scene-fog tint (world/surface/
// airFog.ts) uses the same weight at the eye. Interiors get gas only through their OPENINGS (world/surface/airField.ts: broken panes /
// open or smashed doors as breach sources of strength C on the building's own field) — never this term.
//
// STRENGTH: C = GAS.ROOF_OUTDOOR_C (0.6) — the SAME surface atmosphere as the Office roof deck and the Reactor's sky (world/gaslightRules.ts
// REACTOR_OUTDOOR.c): one outdoor air in one world. Through the unchanged exposure rules: 8 x (0.6 − 0.12) / 0.88 ≈ 4.4 hp/s unprotected;
// the mask / filter / Airtank protect exactly as on the roof. Breaches carry the same C indoors: a room can never hold more gas than the
// air outside it.

import {CELL, FLOOR} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {GAS} from '../gas/field';
import {ROOF_GAS_LOOK, type OutdoorGas} from '../gaslightRules';

export const SURFACE_AIR = {
  /** Outdoor toxic air concentration: the Office roof's / the Reactor sky's surface atmosphere (see the header). */
  C: GAS.ROOF_OUTDOOR_C,
  /** Height step of the column map (m per unit; a byte holds up to 63.75 m). */
  TOP_STEP: 0.25,
  /** The outdoor air's lower ramp (absolute y): full strength from just below the street (y = 0). */
  Y0: -1,
  Y1: -0.5,
  /** The outdoor air above an indoor column's top ramps in over this (m). */
  EDGE: 0.2,
  /** The checkpoint tent's ridge (m above the street): its interior column is indoors below it. */
  TENT_TOP: 2.8,
  /** Enclosed level-0 floor outside every footprint and outside the outdoor areas (m). */
  ENCLOSED_TOP: 3.2,
} as const;

/**
 * The look of the outdoor air in the volumetric march: the Office roof deck's (world/gaslightRules.ts ROOF_GAS_LOOK — the same outdoor
 * atmosphere: thin per c because it is seen across tens of metres, the same infectious green glow). Interiors keep the breach look
 * (GAS.EXT: the Office breach benchmark).
 */
export const SURFACE_GAS_LOOK = ROOF_GAS_LOOK;

/** The district's outdoor column map (see the header). */
export interface SurfaceOutdoorMap {
  w: number; h: number;
  /** Indoor top per level-0 cell, in TOP_STEP units (0 = outdoor column). Row-major (cy * w + cx). */
  top: Uint8Array;
  /** The regional term the march draws (rect = far beyond the grid: the cell lookup clamps to the grid edge). */
  gas: OutdoorGas;
  /** Outdoor / indoor column counts (QA). */
  outdoorCells: number;
  indoorCells: number;
}

const cache = new WeakMap<object, SurfaceOutdoorMap | null>();

const byte = (m: number): number => Math.max(1, Math.min(255, Math.ceil(m / SURFACE_AIR.TOP_STEP - 1e-9)));

/** The outdoor column map of a Surface Run district layout (null: not a district). Built once per layout object, then shared. */
export function surfaceOutdoorMap(layout: Pick<StationLayout, 'grid' | 'levels'> & {surface?: SurfaceInfo}): SurfaceOutdoorMap | null {
  if (cache.has(layout)) return cache.get(layout)!;
  const s = layout.surface;
  const map = s ? buildOutdoorMap(s, layout.levels?.[0]?.grid ?? layout.grid) : null;
  cache.set(layout, map);
  return map;
}

function buildOutdoorMap(s: SurfaceInfo, g: {w: number; h: number; cells: ArrayLike<number>; area: ArrayLike<number>}): SurfaceOutdoorMap {
  const W = g.w, H = g.h, top = new Uint8Array(W * H);
  const cellRect = (r: {x0: number; z0: number; x1: number; z1: number}) => ({
    x0: Math.max(0, Math.floor(r.x0 / CELL + 1e-9)), y0: Math.max(0, Math.floor(r.z0 / CELL + 1e-9)),
    x1: Math.min(W, Math.ceil(r.x1 / CELL - 1e-9)), y1: Math.min(H, Math.ceil(r.z1 / CELL - 1e-9)),
  });
  const mark = new Uint8Array(W * H); // 1 = inside a footprint / the tent (its top already set)
  const fillRect = (r: {x0: number; z0: number; x1: number; z1: number}, v: number) => {
    const c = cellRect(r);
    for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) { const i = y * W + x; top[i] = Math.max(top[i], v); mark[i] = 1; }
  };
  for (const b of s.buildings) fillRect(b.footprint, byte(Math.max(b.height, 1)));
  fillRect(s.checkpoint.tent.rect, byte(SURFACE_AIR.TENT_TOP));
  const outdoor = new Set(s.outdoorAreas);
  const tentArea = s.checkpoint.tent.area;
  const tent = cellRect(s.checkpoint.tent.rect);
  const inTent = (x: number, y: number) => x >= tent.x0 && x < tent.x1 && y >= tent.y0 && y < tent.y1;
  const enclosed = byte(SURFACE_AIR.ENCLOSED_TOP);
  let outdoorCells = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (g.cells[i] === FLOOR) {
      const a = g.area[i];
      // GEN's outdoor areas are outdoors (even inside a footprint: an open shell); the tent stays closed whatever area its floor carries
      if (outdoor.has(a) && a !== tentArea && !inTent(x, y)) top[i] = 0;
      else if (!mark[i]) top[i] = enclosed;
    }
    if (top[i] === 0) outdoorCells++;
  }
  const gas: OutdoorGas = {rect: {x0: -1e4, z0: -1e4, x1: W * CELL + 1e4, z1: H * CELL + 1e4}, y0: SURFACE_AIR.Y0, y1: SURFACE_AIR.Y1, c: SURFACE_AIR.C, vis: SURFACE_GAS_LOOK.vis};
  return {w: W, h: H, top, gas, outdoorCells, indoorCells: W * H - outdoorCells};
}

const sstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The indoor top (absolute m) of the column holding world (x, z) — the march's texel load (nearest cell, clamped to the grid). */
export function columnTop(m: SurfaceOutdoorMap, x: number, z: number): number {
  const cx = Math.min(m.w - 1, Math.max(0, Math.floor(x / CELL))), cy = Math.min(m.h - 1, Math.max(0, Math.floor(z / CELL)));
  return m.top[cy * m.w + cx] * SURFACE_AIR.TOP_STEP;
}

/** The outdoor weight 0..1 at a world point: the column's indoor top and the street ramp (no strength). */
export function outdoorWeight(m: SurfaceOutdoorMap, x: number, y: number, z: number): number {
  const t = columnTop(m, x, z);
  return sstep(t - SURFACE_AIR.EDGE, t, y) * sstep(m.gas.y0, m.gas.y1, y);
}

/** THE outdoor toxic air concentration at a world point (exposure and render): C x the outdoor weight. */
export function surfaceOutdoorGasAt(m: SurfaceOutdoorMap | null, x: number, y: number, z: number): number {
  if (!m || m.gas.c <= 0) return 0;
  return m.gas.c * outdoorWeight(m, x, y, z);
}

/** Is the column at (x, z) an outdoor column (no indoor top)? */
export function outdoorColumn(m: SurfaceOutdoorMap, x: number, z: number): boolean {
  return columnTop(m, x, z) <= 0;
}
