// Task reactor-build-20261101 (lane GEN): validation of the ONE reactor layout (generation retry guard + tests). Pure data.
//
// - Storeys: rim ('main', y 0) + 4 walkway tiers + the core floor ('ring', descending), same grid size, <= 8 levels, grid <= 300 x 300.
// - Reachability: every walkable (unblocked) cell of every storey and every tier reachable from the platform start on foot (stairs
//   only: the maintenance ladders are not required); every site control's stand point, every component and every generator's use point.
// - ROUTES: removing any ONE stair run (route 1 or route 2) leaves every storey reachable: >= 2 independent routes per storey pair.
// - Gas: generator k powering zone k stands on the rim / in a zone above k (generator 0 may stand on tier 1, the thin top haze).
// - Components: one key in the rim office, three fuses (never inside the switchgear room); everything on a flat walkable floor cell.
// - Railings on every drop (Levels.unrailedDrops empty); the vessel solid (raised + blocked) on the core floor; the start clear.
// - Shared storey rules (levelIssues: slabs / headroom / flights / link landings / railings on apertures / placements), traversal rules,
//   doorway lanes, Track2 extensions (extensionIssues; the generator drops invalid extensions — never a core retry).

import {CELL, FLOOR} from '../grid';
import {levelDistance, levelIssues, type LevelRules} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import {doorwayIssues} from '../doorways';
import {extensionIssues} from '../trackExt/index';
import type {StationLayout} from '../stationTypes';
import {CORE_LEVEL, REACTOR_LEVELS, VESSEL} from './frame';
import {CORE_FLOOR, coreFloorIssues} from './coreFloor'; // task reactor-expansion-20261101 (lane CORE)
import {complexIssues} from './complex/host'; // task reactor-expansion-20261101 (lane HOST)

export const REACTOR_LEVEL_RULES: LevelRules = {minLevels: REACTOR_LEVELS, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};

export function reactorIssues(layout: StationLayout, opts: {startCells?: number; routes?: boolean} = {}): string[] {
  const issues: string[] = [];
  const info = layout.reactor;
  if (!info) return ['no reactor record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== REACTOR_LEVELS || levels.length > 8) return [`${levels.length} levels`];
  if (g0.w * g0.h > 90_000) issues.push(`grid ${g0.w} x ${g0.h} cells`); // the ~300 x 300 cell budget (Track2 growth included)
  for (const L of levels) {
    if (L.id !== levels.indexOf(L)) issues.push(`level ${L.id} id mismatch`);
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id > 0 && !(L.baseY < levels[L.id - 1].baseY)) issues.push(`level ${L.id} not below level ${L.id - 1}`);
  }
  if (info.tiers.length !== REACTOR_LEVELS || info.tiers.some((t, i) => t.level !== i || Math.abs(t.baseY - levels[i].baseY) > 1e-6)) issues.push('tier records');

  // --- Reachability -----------------------------------------------------------------------------------------------------------
  const st = info.start;
  const [sx, sy] = g0.cellOf(st.x, st.z);
  if (st.level !== 0 || Math.abs(st.x - layout.playerSpawn.x) > 1e-6 || Math.abs(st.z - layout.playerSpawn.z) > 1e-6) issues.push('start is not the platform spawn');
  if (!g0.circleClear(st.x, st.z, 0.34) || g0.area[g0.idx(sx, sy)] !== layout.platform) issues.push('start not clear on the platform');
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks);
  for (const L of levels) {
    const g = L.grid;
    let bad = 0, any = false;
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.blocked[i]) continue;
      if (dist[L.id][i] >= 0) { any = true; continue; }
      if (g.rampIdx[i] >= 0 && levels.some(M => M.id !== L.id && dist[M.id][i] >= 0)) continue;
      bad++;
    }
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
    if (!any) issues.push(`level ${L.id} unreachable`);
  }
  const reach = (lv: number, x: number, z: number, what: string) => {
    const g = levels[lv]?.grid;
    if (!g) { issues.push(`${what}: level ${lv} missing`); return; }
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) { issues.push(`${what} outside the grid`); return; }
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0) issues.push(`${what} not on a clear flat floor`);
    else if (dist[lv][i] < 0) issues.push(`${what} unreachable`);
  };
  for (const s of info.sites) for (const c of s.controls) {
    reach(c.stand.level, c.stand.x, c.stand.z, `${s.id} ${c.id} stand point`);
    if (!levels[c.stand.level].grid.circleClear(c.stand.x, c.stand.z, 0.3)) issues.push(`${s.id} ${c.id} stand point not clear`);
  }
  for (const gen of info.generators) {
    reach(gen.use.level, gen.use.x, gen.use.z, `generator ${gen.id} use point`);
    if (!levels[gen.use.level].grid.circleClear(gen.use.x, gen.use.z, 0.3)) issues.push(`generator ${gen.id} use point not clear`);
  }
  for (const c of info.components) {
    const p = layout.pickups[c.pickup];
    if (!p || p.itemId !== c.item) { issues.push(`component ${c.item} pickup record`); continue; }
    reach(p.level ?? 0, p.x, p.z, `component ${c.item}`);
  }

  // --- Routes ---------------------------------------------------------------------------------------------------------------
  if (opts.routes !== false) issues.push(...routeIssues(layout, sx, sy));
  for (let lv = 0; lv < CORE_LEVEL; lv++) {
    const n = info.routes.filter(r => r.kind !== 'ladder' && r.links.some(id => layout.levelLinks[id]?.upper === lv)).length;
    if (n < 2) issues.push(`storeys ${lv}-${lv + 1}: ${n} stair routes`);
  }

  // --- Gas: the no-deadlock rule --------------------------------------------------------------------------------------------
  if (info.generators.length !== 3 || info.zones.length !== 3) issues.push('generators / zones');
  for (const gen of info.generators) {
    const z = info.tiers[gen.level]?.zone ?? 99;
    if (!(gen.level === 0 || z < gen.zone || (gen.zone === 0 && gen.level === 1))) issues.push(`generator ${gen.id} (zone ${gen.zone}) stands in zone ${z}`);
    const zone = info.zones.find(q => q.id === gen.zone);
    if (!zone || zone.generator !== gen.id) issues.push(`zone ${gen.zone} generator record`);
  }
  for (const z of info.zones) if (z.fans.length < 2 || z.fans.length > 4) issues.push(`zone ${z.id}: ${z.fans.length} fans`);

  // --- Components -----------------------------------------------------------------------------------------------------------
  const keys = info.components.filter(c => c.item === 'reactor_key'), fuses = info.components.filter(c => c.item === 'fuse_cartridge');
  if (keys.length !== 1 || fuses.length !== 3) issues.push(`components: ${keys.length} keys, ${fuses.length} fuses`);
  const office = info.sites.find(s => s.id === 'rimOffice'), sw = info.sites.find(s => s.id === 'switchgear');
  if (keys[0] && office && keys[0].area !== office.area) issues.push('the key is not in the rim office');
  for (const f of fuses) {
    const p = layout.pickups[f.pickup];
    if (sw && p && (f.area === sw.area || (p.x > sw.rect.x0 && p.x < sw.rect.x1 && p.z > sw.rect.z0 && p.z < sw.rect.z1 && (p.level ?? 0) === sw.level))) issues.push('a fuse inside the switchgear room');
  }
  for (const id of ['rimOffice', 'switchgear', 'pumpHall', 'control'] as const) if (!info.sites.some(s => s.id === id)) issues.push(`site ${id} missing`);

  // --- Railings, vessel ------------------------------------------------------------------------------------------------------
  const Lv = levelsOf(layout);
  const drops = Lv.unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);
  {
    const gC = levels[CORE_LEVEL].grid, c = info.core;
    let n = 0, bad = 0;
    for (let dz = -VESSEL.r + 0.5; dz <= VESSEL.r - 0.5; dz += CELL) for (let dx = -VESSEL.r + 0.5; dx <= VESSEL.r - 0.5; dx += CELL) {
      if (Math.hypot(dx, dz) > CORE_FLOOR.vesselR - 0.6) continue; // task reactor-expansion-20261101 (lane CORE): the blocked footprint (6.6 m)
      const [cx, cy] = gC.cellOf(c.x + dx, c.z + dz), i = gC.idx(cx, cy);
      n++;
      // task reactor-expansion-20261101 (lane CORE): blocked, its plinth / body a riser no body steps over (no longer a 12 m drum)
      if (!gC.blocked[i] || gC.floorOf(i) < c.y0 + 1.0) bad++;
    }
    if (!n || bad) issues.push(`vessel: ${bad} of ${n} cells not solid`);
  }

  issues.push(...coreFloorIssues(layout)); // task reactor-expansion-20261101 (lane CORE): the goop pool, bridges, loops

  // --- Shared rules -----------------------------------------------------------------------------------------------------------
  issues.push(...levelIssues(layout, dist, REACTOR_LEVEL_RULES));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));

  // --- Placements -------------------------------------------------------------------------------------------------------------
  const minCells = opts.startCells ?? 36;
  const onRun = (lv: number, x: number, z: number): boolean => {
    const g = levels[lv]?.grid;
    if (!g) return true;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy)) return true;
    const i = g.idx(cx, cy), a = layout.areas[g.area[i]];
    return g.rampIdx[i] >= 0 || a?.role === 'stair';
  };
  for (const z of layout.zombies) {
    if (z.horde !== undefined) continue;
    const lv = z.level ?? 0, g = levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
    if (layout.areas[g.area[i]]?.ext) continue;
    if (onRun(lv, z.x, z.z)) issues.push(`enemy on a stair run (level ${lv})`);
    if (dist[lv][i] >= 0 && dist[lv][i] < minCells) issues.push(`enemy ${(dist[lv][i] * CELL).toFixed(1)} m from the start`);
  }
  for (const p of layout.pickups) if (onRun(p.level ?? 0, p.x, p.z)) issues.push(`pickup ${p.itemId} on a stair run`);
  issues.push(...extensionIssues(layout, dist));
  // task reactor-expansion-20261101 (lane HOST): the side complexes (region, entrance, stairs-only reach, no overlap, substantial floor)
  issues.push(...complexIssues(layout));
  return issues;
}

/** Vertical route groups: the cells of each stair run (route 1 / route 2). */
export function reactorRouteGroups(layout: StationLayout): {id: string; cells: number[]}[] {
  const g0 = layout.grid, out: {id: string; cells: number[]}[] = [];
  for (const a of layout.areas) {
    if (a.role !== 'stair' || a.ext) continue;
    const cells: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) cells.push(g0.idx(x, y));
    out.push({id: `run#${a.id}`, cells});
  }
  return out;
}

/** Removing any ONE stair run must leave every storey reachable from the start (>= 2 independent routes; ladders not counted). */
export function routeIssues(layout: StationLayout, sx: number, sy: number): string[] {
  const out: string[] = [];
  const levels = layout.levels;
  const links = layout.levelLinks.filter(k => k.kind !== 'ladder');
  for (const grp of reactorRouteGroups(layout)) {
    const saved = levels.map(L => grp.cells.map(i => L.grid.blocked[i]));
    for (const L of levels) for (const i of grp.cells) L.grid.blocked[i] = 1;
    const d = levelDistance(levels, sx, sy, 0, links);
    levels.forEach((L, li) => grp.cells.forEach((i, k) => { L.grid.blocked[i] = saved[li][k]; }));
    for (let lv = 1; lv < levels.length; lv++) {
      const g = levels[lv].grid;
      let any = false;
      for (let i = 0; i < g.cells.length && !any; i++) if (d[lv][i] >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0) any = true;
      if (!any) out.push(`level ${lv} unreachable without ${grp.id}`);
    }
  }
  return out;
}
