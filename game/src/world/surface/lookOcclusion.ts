// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK, follow-up 2: the district's per-frame draws): the SURFACE RUN
// district's see-through structure for the level culler's slab + same- / cross-storey occlusion (world/levelCulling.ts SeeRect — the
// mall's / Reactor's / Skyways' rules, unchanged; world/builder.ts passes these for `layout.surface`). Pure.
//
// The REAL Game's district frame drew ~1,700-2,400 objects (4-7 M triangles): every shop's shelves, holders, stock, fixtures and
// interior walls in the view cone and the fog, behind solid facades, because the district's culler had no occlusion options. The
// occlusion rules treat a grid column with no free band over a storey's height range as a drawn, opaque wall over that whole range
// (every free band's border is drawn: walls, floors, ceilings). In a district that holds everywhere a band is enclosed (interiors) and
// fails only where drawn structure stops below a storey's range while the column above stays SOLID on every grid — those columns are
// passed here as see-through rects (open over the heights given):
//  - the CORDON ring (its 3.4 m wall; the surroundings beyond) and any other non-building SOLID (the tent's carved walls, debris): open;
//  - a BUILDING whose roof line is lower than the top storey's occlusion range (its lowest outer wall top: a kiosk, a one-storey shop,
//    the ruin profile of a damaged / gutted / collapsed shell): open from that height up (a ray over its roof is not blocked);
//  - AIR's live WINDOW SPANS (SOLID wall cells cut through both planes, never glazed here: panes / breaches): open over sill .. head;
//  - BOARDED doorways (SOLID cells under the boards): open over the doorway.
// Doorways stand in free cells already (an open / shut leaf is AIR's door runtime: drawn or not, the cell is open). Conservative by
// construction: a see rect only ever opens.

import {CELL, SOLID} from '../../gen/grid';
import type {StationLayout} from '../../gen/stationTypes';
import {OCCL_TOP, type SeeRect} from '../levelCulling';
import {SIDE_NORMAL, surfaceLookPlan} from './archPlan';

/** Depth (m) into the footprint a boarded doorway's see rect reaches (the wall's thickness and more). */
const DOORWAY_DEPTH = 1.5;

/** The district's see-through rects for the level culler (see above); [] without layout.surface. */
export function surfaceOcclusionSee(layout: StationLayout): SeeRect[] {
  const S = layout.surface, plan = surfaceLookPlan(layout);
  if (!S || !plan) return [];
  const out: SeeRect[] = [];
  const base = (lv: number) => layout.levels?.[lv]?.baseY ?? 0;
  // the top storey's occlusion range ends OCCL_TOP over its floor: a roof line at or above it closes every range
  const topHi = Math.max(0, ...(layout.levels ?? []).map(l => l.baseY)) + OCCL_TOP;
  // buildings: from the lowest drawn outer wall top up (no roof line at all — the tent — open entirely)
  for (const bl of plan.buildings) {
    let low = Infinity;
    for (const sd of bl.sides) for (const t of sd.tops) low = Math.min(low, t.top);
    if (bl.sides.length && !(low < topHi)) continue;
    const f = bl.b.footprint;
    out.push(bl.sides.length ? {x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1, y0: low} : {x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1});
  }
  // the cordon / tent / debris: SOLID cells outside every building (row runs), open on every height
  const g = layout.grid, W = g.w, H = g.h;
  for (let cz = 0; cz < H; cz++) {
    let run = -1;
    for (let cx = 0; cx <= W; cx++) {
      const i = cz * W + cx;
      const open = cx < W && g.cells[i] === SOLID && plan.owner[i] < 0;
      if (open && run < 0) run = cx;
      else if (!open && run >= 0) { out.push({x0: run * CELL, z0: cz * CELL, x1: cx * CELL, z1: (cz + 1) * CELL}); run = -1; }
    }
  }
  // AIR's live spans over their own heights
  for (const w of S.windows) out.push({x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, y0: base(w.level) + w.sill, y1: base(w.level) + w.head});
  // boarded doorways over the doorway
  for (const b of S.buildings) for (const e of b.entrances) {
    if (e.door !== 'boarded') continue;
    const {alongX, n} = SIDE_NORMAL[e.side], fp = b.footprint, hw = e.width / 2, y0 = base(e.level);
    const plane = e.side === 'N' ? fp.z0 : e.side === 'S' ? fp.z1 : e.side === 'W' ? fp.x0 : fp.x1;
    const d0 = Math.min(plane, plane - n * DOORWAY_DEPTH), d1 = Math.max(plane, plane - n * DOORWAY_DEPTH);
    out.push(alongX ? {x0: e.x - hw, z0: d0, x1: e.x + hw, z1: d1, y0, y1: y0 + e.height + 0.5} : {x0: d0, z0: e.z - hw, x1: d1, z1: e.z + hw, y0, y1: y0 + e.height + 0.5});
  }
  return out;
}
