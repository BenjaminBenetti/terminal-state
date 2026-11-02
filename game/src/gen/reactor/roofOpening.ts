// Task reactor-submit-roof-fog-20261102 (lane ROOF): THE PIT ROOF's SINGLE OPENING. User: "the roof, is not looking correct … I want a
// single hole above the reactor not a totally open roof."
//
// Root cause (the previous build): gen/reactor/gaslightLamps.ts openPitRoof marked the WHOLE rim storey as an open-sky storey at the
// pit roof line (levels[0].sky without a mask: every band top at the roof line was open sky), so world/levelGeometry.ts ceilingRuns
// built no roof slab over any pit cell and only the open I-beam grid (world/reactor/archKit.ts planRoof) stood against the green sky.
//
// Now: the roof slab is SOLID (the pit cells' band tops at roofY are ceilings again: the dark concrete 'reactor-roof' surface) except ONE
// round opening centred on the reactor core: `roofOpeningOf` (this file, pure: every reader — the generator's sky mask, the kit's curb
// ring and trimmed beams, the sky dome, the light shafts — derives it from the same layout.reactor data, nothing is stored twice) and
// `LevelSky.open` (gen/levels.ts: only the opening's cells open to the sky; rays / ceilings elsewhere see a real roof).
//
// The size: radius = ROOF_OPENING.coreK x the core radius (1.2 -> a 16.8 m diameter over the 7 m vessel: the whole vessel and its
// service ring read through it from every tier, the light column covers the core), clamped so the curb ring and at least
// ROOF_OPENING.band metres of solid roof stand between it and every pit wall (real pits: ~21.5-23 m from the core to the nearest wall,
// so the clamp never bites there; it leaves >= 11 m of roof each side).

import {CELL} from '../grid';
import type {StationLayout} from '../stationTypes';
import type {ReactorInfo} from './reactorTypes';

/** The opening tunables (m). */
export const ROOF_OPENING = {
  /** Opening radius as a multiple of the core (vessel) radius: 1.2 = a diameter of 2.4 core radii. */
  coreK: 1.2,
  /**
   * Curb ring girder width outside the opening radius: the grid's stepped hole edge (the cells that touch the disc reach at most
   * CELL x sqrt 2 = 0.71 m beyond it) hides under the closed ring box.
   */
  curb: 1.3,
  /** Least solid roof between the curb's outer edge and every pit wall. */
  band: 6,
  /** An opening smaller than this (radius) is not cut: the roof stays closed. */
  minR: 3,
} as const;

/** The single roof opening: a disc in the roof plane (world m), centred on the core. */
export interface RoofOpening { x: number; z: number; r: number }

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Point in a closed polygon (even-odd; gen must not import world/reactor/archKit.ts inPoly). */
function inside(P: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Distance from (x, z) to the polygon's boundary. */
function edgeDist(P: readonly {x: number; z: number}[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}

/**
 * The pit roof's single opening (null: no roof column above the rim, the core outside the pit, or no room for an opening of
 * ROOF_OPENING.minR — the roof stays closed). Pure and deterministic: the same layout.reactor gives the same disc everywhere.
 */
export function roofOpeningOf(info: Pick<ReactorInfo, 'pit' | 'core'>): RoofOpening | null {
  const p = info.pit, c = info.core;
  if (!(p.roofY > p.rimY + 2) || !c || !p.outline || p.outline.length < 3 || !inside(p.outline, c.x, c.z)) return null;
  const want = ROOF_OPENING.coreK * c.radius;
  const room = edgeDist(p.outline, c.x, c.z) - ROOF_OPENING.curb - ROOF_OPENING.band;
  const r = Math.min(want, room);
  return r >= ROOF_OPENING.minR ? {x: r3(c.x), z: r3(c.z), r: r3(r)} : null;
}

/** Per grid cell (w x h, CELL m): 1 = the cell touches the opening disc (its column opens to the sky at the roof line). */
export function roofOpeningMask(w: number, h: number, o: RoofOpening): Uint8Array {
  const m = new Uint8Array(w * h), r2 = o.r * o.r;
  const y0 = Math.max(0, Math.floor((o.z - o.r) / CELL)), y1 = Math.min(h - 1, Math.floor((o.z + o.r) / CELL));
  const x0 = Math.max(0, Math.floor((o.x - o.r) / CELL)), x1 = Math.min(w - 1, Math.floor((o.x + o.r) / CELL));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      // the cell's nearest point to the centre lies inside the disc
      const nx = Math.max(cx * CELL, Math.min((cx + 1) * CELL, o.x)) - o.x, nz = Math.max(cy * CELL, Math.min((cy + 1) * CELL, o.z)) - o.z;
      if (nx * nx + nz * nz < r2) m[cy * w + cx] = 1;
    }
  }
  return m;
}

/**
 * The pit roof with its single opening: levels[0].sky (gen/levels.ts LevelSky) at the roof line with `open` = the opening's cells —
 * only those columns' band tops open to the sky; every other pit cell keeps its ceiling at roofY (the solid roof slab) and closed
 * columns are solid at every height. No opening (roofOpeningOf null): no sky at all, the roof is closed. Nothing walkable comes near
 * it (the rim deck is at 0, the roof 14-18 m up).
 */
export function openPitRoofOpening(layout: StationLayout, info: ReactorInfo): RoofOpening | null {
  if (!layout.levels.length || layout.levels.some(l => l.sky)) return null;
  const o = roofOpeningOf(info);
  if (!o) return null;
  const g = layout.levels[0].grid, roofY = info.pit.roofY;
  layout.levels[0].sky = {y: info.pit.rimY, ceil: roofY, top: roofY, open: roofOpeningMask(g.w, g.h, o)};
  return o;
}
