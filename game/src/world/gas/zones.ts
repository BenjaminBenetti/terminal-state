// Task studio-bunker-level-20261109-072224-01: the Bunker's LOCAL GAS LEAKS as a gas zone world (world/gas/system.ts zoneSources):
// layout.bunker.gasZones (gen/bunker/hazards.ts — the isolation ward, the damaged maintenance section, a habitation line, …; each a
// seed set of cells on one storey's grid and a strength) handed to the ONE gas field, which drives both the visible green volumetric
// fog and the exposure. The field's domain is the zones' bounding box grown by the reach of a leak's room pool and spill (no leak
// fills more than its room within GAS.POOL_RADIUS_M plus a short tongue through its doorways), clamped to the grid. Pure.

import {CELL} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import {GAS} from './field';
import type {GasZoneSource} from './system';

/** Cells of margin round the leaks' seed cells: the pool radius + a doorway tongue + the field's closed ring. */
export const ZONE_MARGIN_CELLS = Math.ceil((GAS.POOL_RADIUS_M + 6) / CELL);

/** The Bunker's gas zone world (null on every other layout / a Bunker without leaks). */
export function bunkerGasSource(layout: StationLayout): GasZoneSource | null {
  const zones = layout.bunker?.gasZones;
  if (!zones?.length) return null;
  const g = layout.grid;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const z of zones) for (const i of z.cells) {
    const x = i % g.w, y = (i - x) / g.w;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  const m = ZONE_MARGIN_CELLS;
  return {
    zones: zones.map(z => ({id: z.id, level: z.level, cells: z.cells, strength: z.strength})),
    domain: {x0: Math.max(1, x0 - m), y0: Math.max(1, y0 - m), x1: Math.min(g.w - 1, x1 + m), y1: Math.min(g.h - 1, y1 + m)},
  };
}
