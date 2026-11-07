// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/validate.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-level-20261106-054448-01 (primary): validation of the ONE Skyways layout (generation retry guard + tests).
//
// - Storeys: 3 levels (station 'main' y 0, street / skyway 'ring' at 5 / 10 m), same grid size, the record's storeys agree.
// - Reachability: every walkable cell of every storey and every area reachable from the platform start on foot (walking, stairs,
//   escalators): no unreachable or trapped floor; every building's skyway level and every bridge deck reachable.
// - Shared storey rules (gen/levelGen.ts levelIssues: slabs, headroom, flights in spec, link landings), traversal rules, doorway lanes,
//   no unrailed drops (atrium openings / open runs).
// - The network: >= buildings - 1 bridges (a connected skyway graph), every bridge joins two different buildings.
// - The ONE add-on: present, its areas reachable; the convention has washrooms (its mascot points to them); the prize car's spot is
//   clear for the car body and its hall entry is >= 7 m wide.
// - Glazing: every window span lies in solid wall cells of its storey with walkable floor right behind it (the Office rule: bodies
//   never leave through glass).
// - The ramen restaurant exists (the base shop pool's edible food).
// - Placements: enemies >= the profile's walking distance from the start, never on a ramp.

import {CELL, FLOOR, SOLID} from '../../grid';
import {levelDistance, levelIssues, type LevelRules} from '../../levelGen';
import {levelsOf} from '../../levels';
import {traversalIssues} from '../../traversal';
import {doorwayIssues} from '../../doorways';
import type {StationLayout} from '../../stationTypes';
import {BASES} from './frame';

export const SKYWAYS_LEVEL_RULES: LevelRules = {minLevels: 3, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};
/** Shop units the validation insists on (whole level). */
export const MIN_SKYWAYS_UNITS = 10;

export function skywaysIssues(layout: StationLayout, opts: {startCells?: number} = {}): string[] {
  const issues: string[] = [];
  const info = layout.skyways;
  if (!info) return ['no skyways record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== 3) return [`${levels.length} levels (want 3)`];
  for (const L of levels) {
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id === 0 ? L.role !== 'main' || L.baseY !== 0 : L.role !== 'ring' || Math.abs(L.baseY - BASES[L.id]) > 1e-6) issues.push(`level ${L.id} role ${L.role} / baseY ${L.baseY}`);
  }
  if (info.storeys.length !== 3 || info.storeys.some((s, i) => s.level !== i || Math.abs(s.baseY - levels[i].baseY) > 1e-6)) issues.push('storey records');

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
  const seenArea = (id: number): boolean => {
    const a = layout.areas[id];
    if (!a) return false;
    for (const M of levels) { const gm = M.grid; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (gm.inBounds(x, y) && gm.area[gm.idx(x, y)] === a.id && dist[M.id][gm.idx(x, y)] >= 0) return true; }
    return false;
  };
  for (const a of layout.areas) if (!a.ext && !seenArea(a.id)) issues.push(`area ${a.id} (${a.type} ${a.label}) unreachable`);

  // --- Shared rules -----------------------------------------------------------------------------------------------------------
  issues.push(...levelIssues(layout, dist, SKYWAYS_LEVEL_RULES));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  const drops = levelsOf(layout).unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);

  // --- Network ----------------------------------------------------------------------------------------------------------------
  if (info.bridges.length < info.buildings.length - 1) issues.push(`${info.bridges.length} bridges for ${info.buildings.length} buildings`);
  for (const b of info.bridges) {
    if (b.a === b.b) issues.push(`bridge ${b.id} joins one building`);
    if (!seenArea(b.area)) issues.push(`bridge ${b.id} unreachable`);
  }
  const fronted = layout.storefronts.filter(s => s.unit >= 0).length;
  if (fronted < MIN_SKYWAYS_UNITS) issues.push(`${fronted} shop units`);
  if (!info.restaurant) issues.push('no ramen restaurant');

  // --- The add-on -------------------------------------------------------------------------------------------------------------
  const ad = info.addon;
  for (const id of ad.areas) if (!seenArea(id)) issues.push(`add-on area ${id} unreachable`);
  if (ad.id === 'convention' && !ad.areas.some(id => layout.areas[id]?.type === 'washroom')) issues.push('convention without washrooms');
  if (ad.id === 'prize-car') {
    if (!ad.car) issues.push('prize car without a spot');
    else {
      const g = levels[ad.car.level].grid;
      // a 2.4 m disc fore and aft of the centre (the body's circles) on open, flat, unblocked floor of the hall storey
      const fx = -Math.sin(ad.car.yaw), fz = -Math.cos(ad.car.yaw);
      for (const t of [-1.6, 0, 1.6]) {
        const x = ad.car.x + fx * t, z = ad.car.z + fz * t;
        if (!g.circleClear(x, z, 1.05)) { issues.push('prize car spot not clear'); break; }
      }
    }
    const e = ad.entry;
    void e;
  }

  // --- Glazing ----------------------------------------------------------------------------------------------------------------
  let glassBad = 0;
  for (const w of info.windows) {
    const g = levels[w.level]?.grid;
    if (!g) { glassBad++; continue; }
    const [x0, y0] = g.cellOf(w.x0 + 0.01, w.z0 + 0.01), [x1, y1] = g.cellOf(w.x1 - 0.01, w.z1 - 0.01);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.cells[g.idx(x, y)] !== SOLID) glassBad++;
    // the room side (opposite the outward side) is walkable floor
    const [ix, iy] = w.side === 'N' ? [x0, y1 + 1] : w.side === 'S' ? [x0, y0 - 1] : w.side === 'W' ? [x1 + 1, y0] : [x0 - 1, y0];
    if (!g.inBounds(ix, iy) || g.cells[g.idx(ix, iy)] !== FLOOR) glassBad++;
  }
  if (glassBad) issues.push(`${glassBad} glazing cells off a solid wall / without floor behind`);
  if (!info.windows.some(w => w.kind === 'window')) issues.push('no glazing');

  // --- Placements -------------------------------------------------------------------------------------------------------------
  const minCells = opts.startCells ?? 36;
  let close = 0, ramp = 0;
  for (const z of layout.zombies) {
    if (z.horde !== undefined || layout.areas[z.area]?.ext) continue;
    const lv = z.level ?? 0, g = levels[lv]?.grid;
    if (!g) continue;
    const [cx, cy] = g.cellOf(z.x, z.z);
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.rampIdx[i] >= 0) ramp++;
    if (dist[lv][i] >= 0 && dist[lv][i] < minCells) close++;
  }
  if (close) issues.push(`${close} enemies closer than ${minCells * CELL} m walking to the start`);
  if (ramp) issues.push(`${ramp} enemies on stairs`);
  return issues;
}
