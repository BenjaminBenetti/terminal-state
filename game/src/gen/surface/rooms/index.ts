// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract STUB — lane ROOMS owns gen/surface/rooms/**): the interior
// planner (gen/surface/rooms/api.ts) — one plain room per storey until ROOMS lands its programmes.

import {CELL} from '../../grid';
import type {InteriorPlan, InteriorPlot} from './api';

export function planInterior(plot: InteriorPlot): InteriorPlan {
  const {kit, rect, floors, building} = plot;
  const inner = {x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2};
  const areas: number[] = [];
  for (const f of floors) {
    const a = kit.addArea(inner, 'room', 'shop', f.ceil, -1, {label: building.name, level: f.level, floorY: f.y});
    areas.push(a.id);
  }
  const entrances = plot.entrances.map((e, k) => {
    const c = e.cells[Math.floor(e.cells.length / 2)];
    return {id: `b${building.id}-e${k}`, building: building.id, level: 0, x: (c.x + 0.5) * CELL, z: (c.y + 0.5) * CELL, side: e.side,
      width: e.cells.length * CELL, height: 2.4, inner: areas[0], outer: e.outer, door: 'smashed' as const, cells: e.cells.map(p => kit.g.idx(p.x, p.y))};
  });
  return {areas, entrances, props: [], lights: [], signs: [], pickups: [], zombies: [], windows: [], links: []};
}
