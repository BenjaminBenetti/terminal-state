// Task mall-playtest-revision-20261031 (lane FIX, U04): the mall's ROUND ATRIUM COLUMNS as generation-time records.
//
// User: "hitboxes missing on the round pillars in the mall". Before, world/mallArch.ts buildColumns drew white round columns
// (R 0.34 m) from the void outline at world-build time — render-only: no prop, no grid mark, no collider. Player / zombie collision
// (core/physics.ts PropIndex), bullets / melee / flashlight (gen/levels.ts raycast) and navigation (grid.blocked) only know
// layout.props and the grid, so the player walked and shot straight through them.
//
// Now each column is a layout PROP of kind `atriumColumn` (gen/mall/kinds.ts; anchored structure, never breaks) placed here, once,
// right after mallInfo (gen/mall/index.ts) so shop commons, landmarks, enemies, supplies and hordes avoid it:
//  - round: true (gen/props.ts PropPlacement.round) -> the player / zombies collide with the exact circle (radius hx), bullets hit
//    the exact upright cylinder (y .. y + h); ragdolls / debris use its square box (physics/world.ts; documented tolerance);
//  - forceProp marks the footprint cells blocked + sightBlocked on ITS storey's grid only (nav / spawns / AI sight); centres snap
//    to cell corners so the 0.68 m column blocks exactly 2 x 2 cells (1.0 m: <= 0.16 m nav clearance per side);
//  - MallArch.buildColumns (lane ARCH) renders exactly these records (x, z, y0 = p.y, top = p.y + p.h, R = p.hx): visual = collider.
// Structure (lane ARCH's rule for the nested, upward-widening openings): a column stands on storey L-1 UNDER the floor-L slab, one
// cell behind that slab's opening edge (void.openings[L]; void.outline = floor 1 when openings are absent), and ends at the ceiling
// over its footprint — a real, drawn ceiling (never open air: the U03 rule), uniform within 5 cm. It needs open public floor with a
// 0.7 m walkable ring (no pinch against walls / railings / voids; a ring round a convex footprint never disconnects the floor), no
// ramp / door zone / stair approach / platform-edge band / run mouth (2.5 m) / doorway clearance, and >= 4 m from another column.
// Deterministic: fixed candidate order, no randomness.

import {CELL, FLOOR} from '../grid';
import type {Rng} from '../../core/rng';
import type {StationLayout} from '../stationTypes';
import type {RailRun} from '../levels';
import {forceProp, makePlaceCtx, propBlocksDoorway, type PlaceCtx} from '../placeKit';

/** Column radius, cells behind the slab edge, spacing along an edge, shortest edge used, min gap, walkable ring, run-mouth gap. */
export const ATRIUM_COLUMN = {r: 0.34, inset: 1, spacing: 8.5, minEdge: 6, gap: 4, ring: 0.7, mouth: 2.5, rail: 0.75} as const;

export interface ColumnReport {
  placed: {level: number; under: number; x: number; z: number; y0: number; top: number}[];
  /** Candidates rejected per reason (diagnostics / tests). */
  rejects: Record<string, number>;
}

type Pt = {x: number; z: number};

/** Even-odd point-in-polygon (world x / z). */
export function insidePoly(poly: readonly Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function railDist(r: RailRun, x: number, z: number): number {
  const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / L2)) : 0;
  return Math.hypot(x - (r.x0 + dx * t), z - (r.z0 + dz * t));
}

/** The slab openings a column row stands under: void.openings (per retail floor), else the floor-1 outline on the first retail floor. */
export function slabOpenings(layout: StationLayout): {level: number; outline: readonly Pt[]}[] {
  const m = layout.mall;
  if (!m) return [];
  if (m.void.openings?.length) return m.void.openings.map(o => ({level: o.level, outline: o.outline}));
  const first = m.storeys.filter(s => s.role === 'ring').map(s => s.level).sort((a, b) => a - b)[0];
  return first === undefined ? [] : [{level: first, outline: m.void.outline}];
}

/** Places the atrium columns (see the header). Returns what was placed and why candidates were refused. */
export function placeAtriumColumns(layout: StationLayout, rng: Rng): ColumnReport {
  const rep: ColumnReport = {placed: [], rejects: {}};
  const why = (r: string) => { rep.rejects[r] = (rep.rejects[r] ?? 0) + 1; };
  const m = layout.mall;
  if (!m) return rep;
  const C = ATRIUM_COLUMN, R = C.r;
  const levels = layout.levels ?? [];
  const rails = layout.rails ?? [];
  const springY = m.roof.springY;
  const ctxs = new Map<number, PlaceCtx>();
  const ctxOf = (lv: number) => { let c = ctxs.get(lv); if (!c) ctxs.set(lv, (c = makePlaceCtx(layout, rng, lv))); return c; };
  const mouths = (lv: number): Pt[] => [
    ...m.verticals.flatMap(v => [...(v.lower === lv ? [v.foot] : []), ...(v.upper === lv ? [v.head] : [])]),
    ...(layout.levelLinks ?? []).flatMap(k => [...(k.lower === lv ? [k.bottom] : []), ...(k.upper === lv ? [k.top] : [])]),
  ];
  for (const op of slabOpenings(layout)) {
    const lv = op.level - 1;
    if (lv < 0 || !levels[lv]) continue;
    const ctx = ctxOf(lv), g = ctx.g;
    const ms = mouths(lv);
    const poly = op.outline;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < C.minEdge) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      // the normal pointing OUT of the opening (under the slab)
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      let nx = -uz, nz = ux;
      if (insidePoly(poly, mx + nx * 0.25, mz + nz * 0.25)) { nx = -nx; nz = -nz; }
      const count = Math.max(1, Math.round(len / C.spacing));
      for (let k = 0; k <= count; k++) {
        const s = Math.max(0.8, Math.min(len - 0.8, (len * k) / count));
        // snap to a cell corner (2 x 2 blocked cells), one cell behind the edge
        const x = Math.round((a.x + ux * s + nx * C.inset * CELL) / CELL) * CELL, z = Math.round((a.z + uz * s + nz * C.inset * CELL) / CELL) * CELL;
        if (rep.placed.some(p => p.level === lv && Math.hypot(p.x - x, p.z - z) < C.gap)) { why('gap'); continue; }
        // under the slab: footprint corners outside the opening
        if ([[-R, -R], [R, -R], [-R, R], [R, R]].some(([dx, dz]) => insidePoly(poly, x + dx, z + dz))) { why('in-opening'); continue; }
        const x0 = Math.floor((x - R) / CELL), x1 = Math.ceil((x + R) / CELL) - 1, y0 = Math.floor((z - R) / CELL), y1 = Math.ceil((z + R) / CELL) - 1;
        // footprint: open public floor, one floor height, a REAL drawn ceiling over it (uniform, below the roof springing)
        let ok = true, floor = NaN, cMin = Infinity, cMax = -Infinity, area = -1;
        for (let cy = y0; cy <= y1 && ok; cy++) for (let cx = x0; cx <= x1 && ok; cx++) {
          if (!g.inBounds(cx, cy)) { why('bounds'); ok = false; break; }
          const j = g.idx(cx, cy);
          if (g.cells[j] !== FLOOR || g.rampIdx[j] >= 0 || g.blocked[j]) { why('footprint'); ok = false; break; }
          if (ctx.zone[j] || ctx.doorCell[j] || ctx.edge[j] || ctx.keep[j]) { why('zone'); ok = false; break; }
          const ar = layout.areas[g.area[j]];
          if (!ar?.publicSpace) { why('not-public'); ok = false; break; }
          area = g.area[j];
          const f = g.floorOf(j);
          if (Number.isNaN(floor)) floor = f; else if (Math.abs(f - floor) > 0.02) { why('floor-step'); ok = false; break; }
          if (!g.hasCeil(j)) { why('no-ceiling'); ok = false; break; }
          cMin = Math.min(cMin, g.ceil[j]); cMax = Math.max(cMax, g.ceil[j]);
        }
        if (!ok) continue;
        if (cMax - cMin > 0.05 || cMax >= springY - 0.5) { why('open-air'); continue; }
        // walkable ring (no pinch against walls / voids / railings)
        const r = Math.ceil(C.ring / CELL - 1e-6);
        for (let cy = y0 - r; cy <= y1 + r && ok; cy++) for (let cx = x0 - r; cx <= x1 + r; cx++) {
          if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) continue;
          if (!g.walkable(cx, cy) || g.rampIdx[g.idx(cx, cy)] >= 0) { why('ring'); ok = false; break; }
        }
        if (!ok) continue;
        if (rails.some(rl => (rl.level ?? 0) === lv && railDist(rl, x, z) < R + C.rail)) { why('rail'); continue; }
        if (ms.some(q => Math.hypot(q.x - x, q.z - z) < C.mouth + R)) { why('mouth'); continue; }
        if (propBlocksDoorway(layout, x, z, R + 0.6, R + 0.6, floor, 2.2)) { why('door'); continue; }
        const top = cMin;
        const p = forceProp(ctx, layout.areas[area], 'atriumColumn', x, z, R, R, top - floor, true);
        p.y = floor;
        p.round = true;
        rep.placed.push({level: lv, under: op.level, x, z, y0: floor, top});
      }
    }
  }
  return rep;
}
