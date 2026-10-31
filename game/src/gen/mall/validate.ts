// Task track3-eaton-centre-20261031 (lane GEN): validation of the ONE mall layout (generation retry guard + tests). Pure data.
// Task mall-playtest-revision-20261031 (lane GEN): station + three retail floors, per-floor atrium openings, corridor wings.
//
// - Storeys: FLOORS + 1 levels (station 'main' y 0, retail floors 'ring' at STOREY * k), same grid size, layout.mall storeys agree.
// - Reachability: every walkable cell of every storey and every area reachable from the platform start on foot (walking, stairs,
//   escalators; the elevator is not in the grids, so it is excluded by construction): no unreachable or trapped floor.
// - ROUTES: every retail floor stays reachable from the start when any ONE vertical group (an escalator bank, a public stair, a
//   service-stair core) is removed — at least two independent routes station <-> every floor (and back: the walk graph is
//   undirected).
// - Shared storey rules (gen/levelGen.ts levelIssues: slabs between stacked bands, headroom, flights in spec, link landings, railings
//   on every well edge, placements on flat floors in their band), traversal rules (ladders cover the bed), doorway lanes.
// - No void falls: no walkable edge anywhere drops more than the rail height without a railing (Levels.unrailedDrops).
// - The ATRIUM: closed (no floor) inside each floor's opening on that floor and every floor above; the station's band under the
//   floor-1 opening rises to the roof apex; a floor's cells under the next floor's (larger) opening are open to the apex; a ray
//   straight up from the start reaches the roof (nothing in between).
// - Shops: >= MIN_UNITS units with a shopfront, every retail floor >= MIN_FLOOR_UNITS, every shop has a lot family; every storey pair
//   joined by >= 1 public run.
// - Placements: no enemy / pickup in the void or on a run; enemies >= the spawn profile's walking distance from the start.
// - Track2 (lane INTEG): the pit station's tunnels / service annexes (gen/trackExt extensionIssues). The generator drops invalid
//   extensions (never a core retry).

import {CELL, FLOOR, SOLID} from '../grid';
import {levelDistance, levelIssues, type LevelRules} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import {doorwayIssues} from '../doorways';
import {extensionIssues} from '../trackExt/index'; // lane INTEG (Track2 integration)
import type {StationLayout} from '../stationTypes';
import {mallLot} from './lots';
import {FLOORS, STOREY} from './frame';

export const MALL_LEVEL_RULES: LevelRules = {minLevels: FLOORS + 1, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};
/** Shop units (frontages) the validation insists on: whole mall / per retail floor (targets ~18-24; real counts are reported). */
export const MIN_UNITS = 14;
export const MIN_FLOOR_UNITS = 3;

export function mallIssues(layout: StationLayout, opts: {startCells?: number; routes?: boolean} = {}): string[] {
  const issues: string[] = [];
  const info = layout.mall;
  if (!info) return ['no mall record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== FLOORS + 1) return [`${levels.length} levels (want ${FLOORS + 1})`];
  for (const L of levels) {
    if (L.id !== levels.indexOf(L)) issues.push(`level ${L.id} id mismatch`);
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id === 0 ? L.role !== 'main' || L.baseY !== 0 : L.role !== 'ring' || Math.abs(L.baseY - STOREY * L.id) > 1e-6) issues.push(`level ${L.id} role ${L.role} / baseY ${L.baseY}`);
  }
  if (info.storeys.length !== FLOORS + 1 || info.storeys.some((s, i) => s.level !== i || Math.abs(s.baseY - levels[i].baseY) > 1e-6)) issues.push('storey records');

  // --- Reachability -----------------------------------------------------------------------------------------------------------
  const st = info.start;
  const [sx, sy] = g0.cellOf(st.x, st.z);
  if (st.level !== 0 || Math.abs(st.x - layout.playerSpawn.x) > 1e-6 || Math.abs(st.z - layout.playerSpawn.z) > 1e-6) issues.push('start is not the platform spawn');
  if (!g0.circleClear(st.x, st.z, 0.34)) issues.push('start not clear');
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks);
  for (const L of levels) {
    const g = L.grid;
    let bad = 0;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.blocked[i] || dist[L.id][i] >= 0) continue;
      if (g.rampIdx[i] >= 0 && levels.some(M => M.id !== L.id && dist[M.id][i] >= 0)) continue;
      bad++;
    }
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
  }
  for (const a of layout.areas) {
    if (a.ext) continue;
    const lv = a.level ?? 0;
    const seen = (M: number) => { const gm = levels[M].grid; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (gm.area[gm.idx(x, y)] === a.id && dist[M][gm.idx(x, y)] >= 0) return true; return false; };
    if (!seen(lv) && !(a.role === 'stair' && levels.some(M => M.id !== lv && seen(M.id)))) issues.push(`area ${a.id} (${a.type} ${a.label}) unreachable`);
  }
  // --- Independent routes: remove one vertical group at a time ---------------------------------------------------------------
  if (opts.routes !== false) issues.push(...routeIssues(layout, sx, sy));

  // --- Shared rules -----------------------------------------------------------------------------------------------------------
  issues.push(...levelIssues(layout, dist, MALL_LEVEL_RULES));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout)); // nothing blocks an opening's walk lanes (shopfronts: lane SHOPS' fits decide their lanes)
  const Lv = levelsOf(layout);
  const drops = Lv.unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);

  // --- The atrium -------------------------------------------------------------------------------------------------------------
  const apex = info.void.roofApexY;
  const voidCells = mallVoidCells(layout);
  if (!voidCells.length) issues.push('no void cells');
  let closedBad = 0, bandBad = 0;
  for (const i of voidCells) {
    for (let lv = 1; lv <= FLOORS; lv++) if (levels[lv].grid.cells[i] !== SOLID) closedBad++;
    if (Math.abs(g0.ceil[i] - apex) > 1e-3) bandBad++;
  }
  if (closedBad) issues.push(`${closedBad} void cells floored on a retail floor`);
  if (bandBad) issues.push(`${bandBad} open void cells whose station band stops below the roof`);
  // per-floor openings: closed on their floor and above; the floor below's cells inside them open to the apex
  for (const op of info.void.openings ?? []) {
    const cells = polyCells(layout, op.outline, op.bounds);
    let floored = 0, low = 0;
    for (const i of cells) {
      for (let lv = op.level; lv <= FLOORS; lv++) if (levels[lv].grid.cells[i] !== SOLID) floored++;
      const below = levels[op.level - 1].grid;
      if (below.cells[i] !== SOLID && below.rampIdx[i] < 0 && below.ceil[i] < apex - 1e-3) low++;
    }
    if (floored) issues.push(`opening L${op.level}: ${floored} floored cells`);
    if (low) issues.push(`opening L${op.level}: ${low} cells below it not open to the roof`);
    if (op.level > 1) {
      const prev = (info.void.openings ?? []).find(q => q.level === op.level - 1);
      if (prev && (prev.bounds.x0 < op.bounds.x0 - 1e-6 || prev.bounds.x1 > op.bounds.x1 + 1e-6 || prev.bounds.z0 < op.bounds.z0 - 1e-6 || prev.bounds.z1 > op.bounds.z1 + 1e-6)) issues.push(`opening L${op.level} does not contain L${op.level - 1}`);
    }
  }
  // A ray straight up from the start reaches the roof (the station-to-sky sightline), and from the platform's open-void cells.
  {
    const h = Lv.raycast({x: st.x, y: 1.6, z: st.z}, {x: 0, y: 1, z: 0}, apex + 10);
    if (!(h.kind === 'ceiling' && Math.abs(h.t + 1.6 - apex) < 0.05)) issues.push(`ray up from the start hit ${h.kind} at ${(1.6 + h.t).toFixed(2)}`);
  }

  // --- Shops / runs ------------------------------------------------------------------------------------------------------------
  const fronted = info.shops.filter(s => layout.doors.some(d => (d.a === s.area || d.b === s.area) && d.shopfront));
  if (fronted.length < MIN_UNITS) issues.push(`${fronted.length} shop units`);
  for (let lv = 1; lv <= FLOORS; lv++) {
    const n = fronted.filter(s => s.level === lv).length;
    if (n < MIN_FLOOR_UNITS) issues.push(`floor ${lv}: ${n} shop units`);
  }
  for (const s of info.shops) if (!mallLot(s.lot)) issues.push(`shop ${s.id} has no lot family`);
  for (let lv = 0; lv < FLOORS; lv++) {
    const n = info.verticals.filter(v => (v.kind === 'escalator' || v.kind === 'stair') && v.lower === lv).length;
    if (n < 1) issues.push(`storeys ${lv}-${lv + 1}: no public run`);
  }

  // --- Placements -------------------------------------------------------------------------------------------------------------
  const vset = new Set(voidCells);
  const openAt = (lv: number, i: number) => lv > 0 && (vset.has(i) || levels[lv].grid.cells[i] === SOLID && (info.void.openings ?? []).some(o => o.level <= lv && polyHas(o.outline, i, g0)));
  const onRun = (lv: number, x: number, z: number): boolean => {
    const g = levels[lv]?.grid;
    if (!g) return true;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return true;
    const i = g.idx(cx, cy), a = layout.areas[g.area[i]];
    return g.rampIdx[i] >= 0 || a?.role === 'stair';
  };
  const minCells = opts.startCells ?? 36;
  for (const z of layout.zombies) {
    const lv = z.level ?? 0, g = levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
    if (openAt(lv, i)) issues.push('enemy in the void');
    if (onRun(lv, z.x, z.z)) issues.push(`enemy on a vertical link (level ${lv})`);
    if (dist[lv][i] >= 0 && dist[lv][i] < minCells) issues.push(`enemy ${(dist[lv][i] * CELL).toFixed(1)} m from the start`);
  }
  for (const p of layout.pickups) {
    const lv = p.level ?? 0, g = levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
    if (openAt(lv, i)) issues.push(`pickup ${p.itemId} in the void`);
    if (onRun(lv, p.x, p.z)) issues.push(`pickup ${p.itemId} on a vertical link`);
  }
  // --- Track2 extensions (lane INTEG) -------------------------------------------------------------------------------------------
  issues.push(...extensionIssues(layout, dist));
  return issues;
}

/**
 * Vertical groups (one per public run bank / stair and per service-stair core: their link ramps) whose single removal must leave
 * every retail floor reachable from the start. Returns issues (empty = >= 2 independent routes to every floor).
 */
export function routeIssues(layout: StationLayout, sx: number, sy: number): string[] {
  const groups = mallRouteGroups(layout);
  const out: string[] = [];
  const levels = layout.levels;
  for (const g of groups) {
    const saved = levels.map(L => g.cells.map(i => L.grid.blocked[i]));
    for (const L of levels) for (const i of g.cells) L.grid.blocked[i] = 1;
    const d = levelDistance(levels, sx, sy, 0, layout.levelLinks);
    levels.forEach((L, li) => g.cells.forEach((i, k) => { L.grid.blocked[i] = saved[li][k]; }));
    for (let lv = 1; lv < levels.length; lv++) {
      const g2 = levels[lv].grid;
      let any = false;
      for (let i = 0; i < g2.cells.length && !any; i++) if (dist0(d, lv, i) && g2.cells[i] === FLOOR && g2.rampIdx[i] < 0) any = true;
      if (!any) out.push(`floor ${lv} unreachable without ${g.id}`);
    }
  }
  return out;
}
const dist0 = (d: Int32Array[], lv: number, i: number) => d[lv][i] >= 0;

/** The vertical route groups of a mall layout (ramp cells of each public run bank / stair and of each service-stair core). */
export function mallRouteGroups(layout: StationLayout): {id: string; kind: string; cells: number[]}[] {
  const info = layout.mall;
  if (!info) return [];
  const g0 = layout.grid;
  const out: {id: string; kind: string; cells: number[]; box: {x0: number; y0: number; x1: number; y1: number}}[] = [];
  for (const a of layout.areas) {
    if (a.role !== 'stair' || a.ext) continue;
    const core = a.type === 'stair-core' && !a.publicSpace;
    // the service-stair runs of one core (two scissor lanes side by side) are ONE group: cluster runs whose rects nearly touch
    let grp = core ? out.find(q => q.kind === 'service-stair' && a.x <= q.box.x1 + 2 && a.x + a.w >= q.box.x0 - 2 && a.y <= q.box.y1 + 2 && a.y + a.h >= q.box.y0 - 2) : undefined;
    if (!grp) { grp = {id: core ? `core#${a.id}` : `run#${a.id}`, kind: core ? 'service-stair' : a.label.startsWith('Escalators') ? 'escalator' : 'stair', cells: [], box: {x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h}}; out.push(grp); }
    grp.box = {x0: Math.min(grp.box.x0, a.x), y0: Math.min(grp.box.y0, a.y), x1: Math.max(grp.box.x1, a.x + a.w), y1: Math.max(grp.box.y1, a.y + a.h)};
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) grp.cells.push(g0.idx(x, y));
  }
  return out.map(({id, kind, cells}) => ({id, kind, cells}));
}

/** Grid cell indices (layout grid) inside a polygon (cell centres) within its bounds. */
function polyCells(layout: StationLayout, poly: readonly {x: number; z: number}[], b: {x0: number; z0: number; x1: number; z1: number}): number[] {
  const g = layout.grid;
  const out: number[] = [];
  const [x0, y0] = g.cellOf(b.x0 + 0.01, b.z0 + 0.01), [x1, y1] = g.cellOf(b.x1 - 0.01, b.z1 - 0.01);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const [cx, cz] = g.center(x, y);
    if (pointIn(poly, cx, cz)) out.push(g.idx(x, y));
  }
  return out;
}
function polyHas(poly: readonly {x: number; z: number}[], i: number, g: StationLayout['grid']): boolean {
  const [cx, cz] = g.center(i % g.w, (i / g.w) | 0);
  return pointIn(poly, cx, cz);
}
function pointIn(poly: readonly {x: number; z: number}[], px: number, pz: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], q = poly[j];
    if ((a.z > pz) !== (q.z > pz) && px < (q.x - a.x) * (pz - a.z) / (q.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Grid cell indices (layout grid) of the floor-1 opening (the station column): inside layout.mall.void.outline (cell centres). */
export function mallVoidCells(layout: StationLayout): number[] {
  const info = layout.mall;
  if (!info) return [];
  return polyCells(layout, info.void.outline, info.void.bounds);
}
