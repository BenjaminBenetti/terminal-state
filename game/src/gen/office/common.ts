// Iteration 16 (WORLD-GEN): shared helpers of the office section generators — canvas crop (every level grid, ramps, areas,
// doors, storefronts, flights, trenches move together; the same code path as gen/station.ts tryGenerate) and constants.

import {Grid} from '../grid';
import {Kit} from '../stationKit';
import {shiftFlight, shiftRamp, type StairFlight} from '../traversal';
import {TRENCH_DEPTH, type Storefront, type Trench} from '../stationTypes';

export interface Cropped {
  grids: Grid[];
  flights: StairFlight[];
  trenches: Trench[];
  ox: number; oy: number;
}

/**
 * Crops the kit's canvases (levels `use`, e.g. [0] or [0, 1]) to [ox, ox + w) x [oy, oy + h) and shifts every carved record.
 * Mutates the kit's areas / doors and the given storefronts in place (exactly like generateStation's crop).
 */
export function cropKit(k: Kit, use: readonly number[], ox: number, oy: number, w: number, h: number, storefronts: Storefront[] = []): Cropped {
  const grids = use.map(L => {
    const sg = k.levelGrids[L];
    const out = new Grid(w, h);
    for (let y = 0; y < h; y++) {
      const s = (y + oy) * sg.w + ox, d = y * w;
      out.cells.set(sg.cells.subarray(s, s + w), d);
      out.area.set(sg.area.subarray(s, s + w), d);
      out.ceil.set(sg.ceil.subarray(s, s + w), d);
      out.floor.set(sg.floor.subarray(s, s + w), d);
      out.rampIdx.set(sg.rampIdx.subarray(s, s + w), d);
    }
    out.voidFloor = sg.voidFloor;
    return out;
  });
  const ramps = k.g.ramps.map(r => shiftRamp(r, ox, oy));
  for (const g of grids) g.ramps = ramps;
  for (const a of k.areas) { a.x -= ox; a.y -= oy; }
  for (const d of k.doors) { d.x -= ox; d.y -= oy; }
  for (const sf of storefronts) { sf.ox -= ox; sf.oy -= oy; sf.ux -= ox; sf.uy -= oy; }
  return {grids, flights: k.flights.map(f => shiftFlight(f, ox, oy)), trenches: k.trenches.map(t => Kit.trenchWorld(t, ox, oy)), ox, oy};
}

/** Office floors have no track bed: a zero-size stand-in (consumers read trench.floorY; trenches stays empty). */
export function dummyTrench(): Trench {
  return {x0: 0, x1: 0, z0: 0, z1: 0, floorY: -TRENCH_DEPTH, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0};
}

/** Canvas cell of the tower interior's NW corner (tower-local 0, 0) during generation. */
export const TOWER_CANVAS = {x: 40, y: 40};
