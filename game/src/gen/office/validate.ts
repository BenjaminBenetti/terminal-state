// Iteration 16 (WORLD-GEN): validation of an office section (generation retry guard + tests). Pure data.
//
// Every walkable cell of every storey and every area is reachable from the section's primary arrival (street: the platform
// spawn; floors: the elevator cab); every arrival pose stands clear on a reachable cell of its storey; the elevator cab is clear
// floor of its own area enclosed by solid shaft walls except the door opening; the stair door has open floor in front; windows
// lie on the perimeter wall ring only (solid cells with open interior behind them, never in front of a door); enemies / loot on
// reachable flat floor away from the arrivals; the shared traversal / doorway / storey rules (gen/traversal.ts, gen/doorways.ts,
// gen/levelGen.ts) with the checks that only make sense for the three-storey station program filtered out.

import {CELL, FLOOR, SOLID} from '../grid';
import {doorwayIssues} from '../doorways';
import {levelDistance, levelIssues} from '../levelGen';
import {traversalIssues} from '../traversal';
import type {StationLayout} from '../stationTypes';
import {MARGIN, type TowerFrame} from './frame';
import {ENEMY_MIN_CELLS, OFFICE_ENEMIES} from './spawns';

export function officeIssues(layout: StationLayout, f: TowerFrame): string[] {
  const issues: string[] = [];
  const info = layout.office;
  if (!info) return ['no office info'];
  const levels = layout.levels;
  const lvO = info.levelId;
  const gO = levels[lvO]?.grid;
  if (!gO) return [`office level ${lvO} missing`];
  // Reachability from the primary arrival.
  const prim = info.arrivals.start ?? info.arrivals.elevator!;
  const pg = levels[prim.level].grid;
  const [sx, sy] = pg.cellOf(prim.x, prim.z);
  const dist = levelDistance(levels, sx, sy, prim.level);
  for (const L of levels) {
    const g = L.grid;
    let bad = 0;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.blocked[i]) continue;
      if (dist[L.id][i] >= 0) continue;
      // A stair-run cell may be reached through its twin on the other storey.
      if (g.rampIdx[i] >= 0 && levels.some(M => M.id !== L.id && dist[M.id][i] >= 0)) continue;
      bad++;
    }
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
  }
  for (const a of layout.areas) {
    const lv = a.level ?? 0, g = levels[lv].grid, d = dist[lv];
    let any = false;
    for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w; x++) if (d[g.idx(x, y)] >= 0) { any = true; break; }
    if (!any && !(a.role === 'stair' && levels.some(M => { const gm = M.grid; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (dist[M.id][gm.idx(x, y)] >= 0) return true; return false; })))
      issues.push(`area ${a.id} (${a.type} ${a.label}) unreachable`);
  }
  // Arrivals.
  for (const [k, p] of Object.entries(info.arrivals)) {
    if (!p) continue;
    const g = levels[p.level]?.grid;
    if (!g) { issues.push(`arrival ${k} on missing level ${p.level}`); continue; }
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (!g.inBounds(cx, cy) || dist[p.level][g.idx(cx, cy)] < 0) issues.push(`arrival ${k} unreachable`);
    if (!g.circleClear(p.x, p.z, 0.34)) issues.push(`arrival ${k} not clear`);
  }
  // Elevator cab: clear floor of its area, solid walls around except the door cells.
  const e = info.elevator;
  const cab = layout.areas[e.area];
  if (!cab || cab.type !== 'office-elevator') issues.push('elevator area missing');
  else {
    for (let y = cab.y; y < cab.y + cab.h; y++) for (let x = cab.x; x < cab.x + cab.w; x++) {
      const i = gO.idx(x, y);
      if (gO.cells[i] !== FLOOR || gO.blocked[i] || gO.area[i] !== cab.id) issues.push(`elevator cab cell ${x},${y} not clear`);
    }
    const doorCells = new Set<number>();
    for (const d of layout.doors) if (d.a === cab.id || d.b === cab.id) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCells.add(gO.idx(x, y));
    for (let y = cab.y - 1; y <= cab.y + cab.h; y++) for (let x = cab.x - 1; x <= cab.x + cab.w; x++) {
      if (x >= cab.x && x < cab.x + cab.w && y >= cab.y && y < cab.y + cab.h) continue;
      const i = gO.idx(x, y);
      if (gO.cells[i] !== SOLID && !doorCells.has(i)) issues.push(`elevator shaft wall open at ${x},${y}`);
    }
    if (Math.abs(e.cab.x0 - cab.x * CELL) > 1e-6 || Math.abs(e.cab.x1 - (cab.x + cab.w) * CELL) > 1e-6) issues.push('elevator cab rect mismatch');
    if (layout.props.some(p => (p.level ?? 0) === lvO && p.x > e.cab.x0 - 0.05 && p.x < e.cab.x1 + 0.05 && p.z > e.cab.z0 - 0.05 && p.z < e.cab.z1 + 0.05)) issues.push('prop inside the elevator cab');
    const want = {x0: (f.cab.x + MARGIN) * CELL, z0: (f.cab.y + MARGIN) * CELL};
    if (Math.abs(e.cab.x0 - want.x0) > 1e-6 || Math.abs(e.cab.z0 - want.z0) > 1e-6) issues.push('elevator not at the frame position');
    if (!layout.lights.some(l => l.area === cab.id && !l.broken && !l.virtual)) issues.push('elevator cab unlit');
  }
  // Stair doors: open floor in front, reachable.
  for (const s of info.stairDoors) {
    const fx = s.x + Math.sin(s.yaw) * 0.6, fz = s.z + Math.cos(s.yaw) * 0.6;
    const [cx, cy] = gO.cellOf(fx, fz);
    if (!gO.walkable(cx, cy) || dist[lvO][gO.idx(cx, cy)] < 0) issues.push(`stair door ${s.dir} has no reachable floor in front`);
  }
  // Windows on the perimeter ring only.
  const {TW, TD} = f;
  for (const w of info.windows) {
    const [c0x, c0y] = gO.cellOf(w.x0 + 0.01, w.z0 + 0.01), [c1x, c1y] = gO.cellOf(w.x1 - 0.01, w.z1 - 0.01);
    const ring = (x: number, y: number) => (x === MARGIN - 1 || x === MARGIN + TW || y === MARGIN - 1 || y === MARGIN + TD) && x >= MARGIN - 1 && x <= MARGIN + TW && y >= MARGIN - 1 && y <= MARGIN + TD;
    for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) {
      if (!ring(x, y)) { issues.push(`window cell ${x},${y} not on the exterior wall`); continue; }
      if (gO.cells[gO.idx(x, y)] !== SOLID) issues.push(`window cell ${x},${y} not solid`);
      const ix = x === MARGIN - 1 ? x + 1 : x === MARGIN + TW ? x - 1 : x, iy = y === MARGIN - 1 ? y + 1 : y === MARGIN + TD ? y - 1 : y;
      if (w.kind === 'window' && gO.cells[gO.idx(ix, iy)] !== FLOOR) issues.push(`window cell ${x},${y} has no room behind it`);
    }
  }
  // Enemies / loot.
  const [eLo, eHi] = info.floor === 1 ? OFFICE_ENEMIES.street : OFFICE_ENEMIES.floor;
  if (layout.zombies.length < eLo || layout.zombies.length > eHi) issues.push(`enemy count ${layout.zombies.length} outside ${eLo}-${eHi}`);
  const arrivalCells = Object.entries(info.arrivals).filter(([k]) => k !== 'start').map(([, p]) => p!);
  const fromArr = arrivalCells.map(p => { const g = levels[p.level].grid; const [x, y] = g.cellOf(p.x, p.z); return levelDistance(levels, x, y, p.level); });
  for (const z of layout.zombies) {
    const lv = z.level ?? 0, g = levels[lv].grid, [x, y] = g.cellOf(z.x, z.z), i = g.idx(x, y);
    if (dist[lv][i] < 0) issues.push('enemy on unreachable cell');
    if (!g.circleClear(z.x, z.z, 0.35)) issues.push('enemy spawn intersects geometry');
    if (info.arrivals.start && dist[lv][i] < ENEMY_MIN_CELLS.start) issues.push('enemy too close to the start');
    if (fromArr.some(d => d[lv][i] >= 0 && d[lv][i] < ENEMY_MIN_CELLS.arrival)) issues.push('enemy too close to an arrival');
  }
  for (const p of layout.pickups) {
    const lv = p.level ?? 0, g = levels[lv].grid, [x, y] = g.cellOf(p.x, p.z);
    if (!g.inBounds(x, y) || dist[lv][g.idx(x, y)] < 0) issues.push(`pickup ${p.itemId} unreachable`);
  }
  if (layout.pickups.some(p => p.itemId === (layout.startWeapon ?? 'rifle'))) issues.push('start weapon placed as a pickup');
  // Shared rules.
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  if (levels.length > 1) issues.push(...levelIssues(layout, dist).filter(s => !/^only \d+ levels$|overlaps the main level by only|level 2 has no stairs|walkable cells unreachable/.test(s)));
  return issues;
}
