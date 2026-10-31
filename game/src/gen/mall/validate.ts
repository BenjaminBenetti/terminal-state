// Task track3-eaton-centre-20261031 (lane GEN): validation of the ONE mall layout (generation retry guard + tests). Pure data.
//
// - Storeys: 7 levels (station 'main' y 0, rings 'ring' at STOREY * k), same grid size, layout.mall storeys agree.
// - Reachability: every walkable cell of every storey and every area reachable from the platform start on foot (walking, stairs,
//   escalators; the elevators are not in the grids, so they are excluded by construction): no unreachable or trapped floor.
// - Shared storey rules (gen/levelGen.ts levelIssues with the mall's rules: slabs between stacked bands, headroom, flights in spec,
//   link landings, railings on every well edge, placements on flat floors in their band), traversal rules (ladders cover the bed).
// - No void falls: no walkable edge anywhere drops more than the rail height without a railing (Levels.unrailedDrops).
// - The VOID: closed (no floor) inside its outline on every ring except bridge decks on their ring; the station's band under it
//   rises to the roof apex; a ray straight up from a platform cell under the open void reaches the roof (nothing in between).
// - Every ring: >= MIN_SHOPS shop units with a shopfront onto the gallery; every storey pair joined by >= 2 public runs.
// - Placements: no enemy / pickup in the void, on a run (stairs / escalators) or on a run mouth / elevator landing; enemies
//   >= the spawn profile's walking distance from the start.

import {CELL, FLOOR, SOLID} from '../grid';
import {levelDistance, levelIssues, type LevelRules} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import type {StationLayout} from '../stationTypes';
import {RINGS, STOREY} from './frame';

export const MALL_LEVEL_RULES: LevelRules = {minLevels: RINGS + 1, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};
/** Shop units per ring the validation insists on (the target is 8-12 substantial frontages; real counts are reported). */
export const MIN_SHOPS = 8;

export function mallIssues(layout: StationLayout, opts: {startCells?: number} = {}): string[] {
  const issues: string[] = [];
  const info = layout.mall;
  if (!info) return ['no mall record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== RINGS + 1) return [`${levels.length} levels (want ${RINGS + 1})`];
  for (const L of levels) {
    if (L.id !== levels.indexOf(L)) issues.push(`level ${L.id} id mismatch`);
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id === 0 ? L.role !== 'main' || L.baseY !== 0 : L.role !== 'ring' || Math.abs(L.baseY - STOREY * L.id) > 1e-6) issues.push(`level ${L.id} role ${L.role} / baseY ${L.baseY}`);
  }
  if (info.storeys.length !== RINGS + 1 || info.storeys.some((s, i) => s.level !== i || Math.abs(s.baseY - levels[i].baseY) > 1e-6)) issues.push('storey records');

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
    const lv = a.level ?? 0;
    const seen = (M: number) => { const gm = levels[M].grid; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (gm.area[gm.idx(x, y)] === a.id && dist[M][gm.idx(x, y)] >= 0) return true; return false; };
    if (!seen(lv) && !(a.role === 'stair' && levels.some(M => M.id !== lv && seen(M.id)))) issues.push(`area ${a.id} (${a.type} ${a.label}) unreachable`);
  }

  // --- Shared rules -----------------------------------------------------------------------------------------------------------
  issues.push(...levelIssues(layout, dist, MALL_LEVEL_RULES));
  issues.push(...traversalIssues(layout));
  const Lv = levelsOf(layout);
  const drops = Lv.unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);

  // --- The void --------------------------------------------------------------------------------------------------------------
  const vb = info.void.bounds;
  const bridgeCells = new Set<string>();
  for (const b of info.bridges) {
    const a = layout.areas[b.area];
    if (!a) { issues.push('bridge area missing'); continue; }
    for (const id of layout.areas.filter(q => q.role === 'crossover' && q.level === b.level).map(q => q.id)) {
      const q = layout.areas[id];
      for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) bridgeCells.add(`${b.level}:${x},${y}`);
    }
  }
  const voidCells = mallVoidCells(layout);
  if (!voidCells.length) issues.push('no void cells');
  let closedBad = 0, bandBad = 0;
  const apex = info.void.roofApexY;
  for (const i of voidCells) {
    const x = i % g0.w, y = (i / g0.w) | 0;
    for (let lv = 1; lv <= RINGS; lv++) {
      const g = levels[lv].grid;
      if (g.cells[i] !== SOLID && !bridgeCells.has(`${lv}:${x},${y}`)) closedBad++;
    }
    const covered = info.bridges.some(b => bridgeCells.has(`${b.level}:${x},${y}`));
    if (!covered && Math.abs(g0.ceil[i] - apex) > 1e-3) bandBad++;
  }
  if (closedBad) issues.push(`${closedBad} void cells floored on a ring`);
  if (bandBad) issues.push(`${bandBad} open void cells whose station band stops below the roof`);
  // A ray straight up from the start platform's open-void cells reaches the roof.
  const P = layout.areas[layout.platform];
  let ray = 0;
  if (P) {
    for (let y = P.y; y < P.y + P.h && !ray; y++) for (let x = P.x; x < P.x + P.w; x++) {
      const i = g0.idx(x, y);
      if (!voidCells.includes(i) || Math.abs(g0.ceil[i] - apex) > 1e-3) continue;
      const [cx, cz] = g0.center(x, y);
      const h = Lv.raycast({x: cx, y: 1.6, z: cz}, {x: 0, y: 1, z: 0}, apex + 10);
      if (h.kind === 'ceiling' && Math.abs(h.t + 1.6 - apex) < 0.05) ray++;
      else { issues.push(`ray up from the platform at ${cx.toFixed(1)},${cz.toFixed(1)} hit ${h.kind} at ${(1.6 + h.t).toFixed(2)}`); }
      break;
    }
  }
  if (!ray) issues.push('no clear ray from the platform to the roof');
  void vb;

  // --- Shops / runs ------------------------------------------------------------------------------------------------------------
  for (let lv = 1; lv <= RINGS; lv++) {
    // Geometry: shop UNITS with a shopfront onto the gallery (lane SHOPS' program mix decides stores / kiosks / service / vacant).
    const n = info.shops.filter(s => s.level === lv && layout.doors.some(d => (d.a === s.area || d.b === s.area) && d.shopfront)).length;
    if (n < MIN_SHOPS) issues.push(`ring ${lv}: ${n} shop units`);
  }
  for (let lv = 0; lv < RINGS; lv++) {
    const n = info.verticals.filter(v => (v.kind === 'escalator' || v.kind === 'stair') && v.lower === lv).length;
    if (n < 2) issues.push(`storeys ${lv}-${lv + 1}: ${n} public runs`);
  }

  // --- Placements -------------------------------------------------------------------------------------------------------------
  const vset = new Set(voidCells);
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
    if (lv > 0 && vset.has(i) && !bridgeCells.has(`${lv}:${cx},${cy}`)) issues.push('enemy in the void');
    if (onRun(lv, z.x, z.z)) issues.push(`enemy on a vertical link (level ${lv})`);
    if (dist[lv][i] >= 0 && dist[lv][i] < minCells) issues.push(`enemy ${(dist[lv][i] * CELL).toFixed(1)} m from the start`);
  }
  for (const p of layout.pickups) {
    const lv = p.level ?? 0, g = levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
    if (lv > 0 && vset.has(i) && !bridgeCells.has(`${lv}:${cx},${cy}`)) issues.push(`pickup ${p.itemId} in the void`);
    if (onRun(lv, p.x, p.z)) issues.push(`pickup ${p.itemId} on a vertical link`);
  }
  return issues;
}

/** Grid cell indices (layout grid) of the void: inside layout.mall.void.outline (cell centres). */
export function mallVoidCells(layout: StationLayout): number[] {
  const info = layout.mall;
  if (!info) return [];
  const g = layout.grid, poly = info.void.outline, b = info.void.bounds;
  const out: number[] = [];
  const inside = (px: number, pz: number): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], q = poly[j];
      if ((a.z > pz) !== (q.z > pz) && px < (q.x - a.x) * (pz - a.z) / (q.z - a.z) + a.x) c = !c;
    }
    return c;
  };
  const [x0, y0] = g.cellOf(b.x0 + 0.01, b.z0 + 0.01), [x1, y1] = g.cellOf(b.x1 - 0.01, b.z1 - 0.01);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const [cx, cz] = g.center(x, y);
    if (inside(cx, cz)) out.push(g.idx(x, y));
  }
  return out;
}
