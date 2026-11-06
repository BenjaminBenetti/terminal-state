// Task studio-skyways-level-20261106-054448-01 (primary): the planted ATRIUM COURTS of a Skyways level — the indoor trees and café
// seating of a downtown pedway atrium, under each hub building's glass roof (storey 1, the cells under the skyway-level opening).
// Existing approved kinds only (the office planter tree, the station bench, the mall café set — allowed in Skyways by
// assets/levelAssets.ts), placed with the station placement kit on its own rng fork after the station dresser, lifted onto the
// court floor (absolute heights, like the ramen kit). A walking lane through the court stays clear (the kit's door / lane masks).

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import {makePlaceCtx, tryPlaceProp} from '../placeKit';
import type {PropKind} from '../props';
import type {StationLayout} from '../stationTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Trees / seating per atrium court (seeded within). */
export const ATRIUM_GREENERY = {trees: [3, 5] as const, seating: [1, 3] as const, benches: [1, 2] as const};
const TREE: PropKind = 'planterTree', SEAT: PropKind = 'foodCourtTableSet', BENCH: PropKind = 'bench';

/** Furnishes every atrium court; returns the props placed. */
export function dressSkywaysAtriums(layout: StationLayout, rng: Rng): number {
  const info = layout.skyways;
  if (!info) return 0;
  const lv = 1, g = layout.levels[lv].grid, base = layout.levels[lv].baseY;
  const ctx = makePlaceCtx(layout, rng, lv);
  const p0 = layout.props.length;
  for (const b of info.buildings) {
    if (!b.atrium) continue;
    const r = b.atrium.rect;
    // the court area under the opening (the area of its centre cell)
    const [cx, cy] = g.cellOf((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    const area = layout.areas[g.area[g.idx(cx, cy)]];
    if (!area) continue;
    const spots = (n: number, inset: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let t = 0; t < n * 8 && out.length < n; t++) {
        const x = rng.range(r.x0 + inset, r.x1 - inset), z = rng.range(r.z0 + inset, r.z1 - inset);
        if (out.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3)) continue;
        out.push([Math.round(x / CELL) * CELL, Math.round(z / CELL) * CELL]);
      }
      return out;
    };
    // trees near the court's edges (the middle stays open under the glass), seating and benches between them
    for (const [x, z] of spots(rng.int(...ATRIUM_GREENERY.trees), 1.2)) tryPlaceProp(ctx, area, TREE, r3(x), r3(z), 0, {ring: 0.6});
    for (const [x, z] of spots(rng.int(...ATRIUM_GREENERY.seating), 2.0)) tryPlaceProp(ctx, area, SEAT, r3(x), r3(z), rng.pick([0, Math.PI / 2]), {ring: 0.9});
    for (const [x, z] of spots(rng.int(...ATRIUM_GREENERY.benches), 1.5)) tryPlaceProp(ctx, area, BENCH, r3(x), r3(z), rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), {ring: 0.6});
  }
  // lift onto the court floor (the kit places in the storey's local frame)
  for (let k = p0; k < layout.props.length; k++) {
    const p = layout.props[k];
    const [x, y] = g.cellOf(p.x, p.z), i = g.idx(x, y);
    p.y = r3(p.y + (g.inBounds(x, y) ? g.floorOf(i) : base));
    p.level = lv;
  }
  return layout.props.length - p0;
}
