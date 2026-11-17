// Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane FRONTS): the shared GEOMETRY of a version-3 hall's functional fronts
// (gen/stationTypes.ts HallFront) — where a front's wall is, where its hung station clock hangs and how high, where the office canopy
// sits. Pure data (no three.js, no RNG): read by both the render kit (world/subwayKitFronts.ts draws the fascias, canopies, clocks,
// backdrops, inlays) and the hall light plan (gen/subwayHallLights.ts gives each front its own fixtures, clear of what the kit draws).

import {CELL} from './grid';
import type {Area, HallFront, HallSection} from './stationTypes';

/** The office front's fascia band (heights over the floor; depth out of the wall) — above the 2.7 m booths, never touching them. */
export const OFFICE_FASCIA = {y0: 2.85, y1: 3.35, depth: 0.3, lip: 0.05, canopy: 0.6, canopyT: 0.08, pierW: 0.45} as const;
/** A waiting front's hung double-faced station clock: drum diameter / depth (m), its underside at least minY over the floor. */
export const STATION_CLOCK = {d: 0.9, t: 0.18, minY: 2.6, wallClear: 0.65, naveY: 3.6} as const;
/** The waiting front's downlight sits this far along from the clock (clear of its drum and rod). */
export const CLOCK_LIGHT_OFFSET = 1.2;

/** The wall a front backs onto: its across plane (the hall's edge) and the direction into the hall (null: a nave island). */
export function frontWall(a: Pick<Area, 'x' | 'y' | 'w' | 'h'>, S: Pick<HallSection, 'alongX'>, f: Pick<HallFront, 'wall'>): {plane: number; n: 1 | -1} | null {
  if (f.wall === 'nave') return null;
  const c0 = (S.alongX ? a.y : a.x) * CELL, c1 = c0 + (S.alongX ? a.h : a.w) * CELL;
  return f.wall === 'N' ? {plane: c0, n: 1} : {plane: c1, n: -1};
}

/** A waiting front's clock: along / across of its centre (the front's centre, held clear of its wall). */
export function frontClockSpot(a: Pick<Area, 'x' | 'y' | 'w' | 'h'>, S: Pick<HallSection, 'alongX'>, f: HallFront): {along: number; across: number} {
  const along = (f.along[0] + f.along[1]) / 2;
  let across = (f.across[0] + f.across[1]) / 2;
  const w = frontWall(a, S, f);
  if (w) across = w.n > 0 ? Math.max(across, w.plane + STATION_CLOCK.wallClear) : Math.min(across, w.plane - STATION_CLOCK.wallClear);
  return {along, across};
}

/**
 * The hung clock's centre height (absolute) under a soffit: low in an aisle (its underside just over STATION_CLOCK.minY), at
 * STATION_CLOCK.naveY in a tall space — always a metre or more under the soffit when there is room.
 */
export function clockCentreY(floor: number, soffit: number): number {
  const r = STATION_CLOCK.d / 2, lo = floor + STATION_CLOCK.minY + r + 0.05;
  return Math.max(lo, Math.min(soffit - 1 - r, floor + STATION_CLOCK.naveY));
}

/** A front's along centre and a point `out` m into the hall from its wall (clamped inside its across span); a nave island: its centre. */
export function frontAcross(a: Pick<Area, 'x' | 'y' | 'w' | 'h'>, S: Pick<HallSection, 'alongX'>, f: HallFront, out: number): number {
  const w = frontWall(a, S, f), lo = Math.min(f.across[0], f.across[1]), hi = Math.max(f.across[0], f.across[1]);
  if (!w) return (lo + hi) / 2;
  const v = w.plane + w.n * out;
  return hi - lo > 0.4 ? Math.max(lo + 0.2, Math.min(hi - 0.2, v)) : (lo + hi) / 2;
}
