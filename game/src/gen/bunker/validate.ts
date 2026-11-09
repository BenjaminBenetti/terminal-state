// Task studio-bunker-level-20261109-072224-01: validation of the ONE Bunker layout (generation retry guard + tests). Pure data.
//
// - Storeys: BUNKER_LEVELS level grids of one size (<= 300 x 300 cells), baseY strictly DESCENDING, the record's storeys / programmes.
// - Reachability: every walkable (unblocked) cell of every storey reachable from the platform start on foot (stairs only); the start
//   clear on the platform; the vault door's lane open from BOTH sides (its threshold cells walkable, the hall and the vestibule joined).
// - Stairs: a run between every consecutive storey pair; two independent ones (the main + service stairs) between every pair of the
//   shelter storeys 1-5; removing any ONE run leaves every storey reachable (loops).
// - Objectives: exactly three generator slots on DISTINCT storeys (2, 3, 4), each a BUNKER_GENERATOR_KIND prop whose front strip
//   (>= 1.5 m) is clear walkable floor of its room reached from the start; the core cluster on the lowest storey, front >= 2 m clear.
// - Hazards: 3-6 gas zones (>= 1 strong), every seed cell open floor of its storey; no strong leak in a corridor / hall / generator room
//   / the core hall; every generator front and the core front reached from the start with every strong zone's room shut (the clean
//   route); damp areas recorded.
// - Shared rules: levelIssues (slabs, headroom, flights, link landings, placements), traversal, doorway lanes, railings on every drop.

import {CELL, FLOOR} from '../grid';
import {levelDistance, levelIssues, type LevelRules} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import {doorwayIssues} from '../doorways';
import type {StationLayout} from '../stationTypes';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_COUNT, BUNKER_GENERATOR_KIND} from './bunkerTypes';
import {BUNKER_CORE_LEVEL, BUNKER_LEVELS} from './frame';
import {GAS_STRONG} from './hazards';

export const BUNKER_LEVEL_RULES: LevelRules = {minLevels: BUNKER_LEVELS, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.8};

/**
 * The grid cells strictly in front of a wall-backed prop (front = (sin rot, cos rot)): `depth` cells beyond the last cell its body
 * covers (> 5 mm), over its covered width widened by `widen` cells each end (cells off the grid are skipped).
 */
export function frontCells(g: {w: number; h: number; idx(x: number, y: number): number; inBounds(x: number, y: number): boolean}, p: {x: number; z: number; rot: number; hx: number; hz: number}, depth: number, widen = 0): number[] {
  const e = 0.005;
  const c0 = Math.floor((p.x - p.hx + e) / CELL), r0 = Math.floor((p.z - p.hz + e) / CELL), c1 = Math.floor((p.x + p.hx - e) / CELL), r1 = Math.floor((p.z + p.hz - e) / CELL);
  const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
  const out: number[] = [];
  for (let k = 1; k <= depth; k++) {
    if (fz !== 0) {
      const y = fz > 0 ? r1 + k : r0 - k;
      for (let x = c0 - widen; x <= c1 + widen; x++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
    } else {
      const x = fx > 0 ? c1 + k : c0 - k;
      for (let y = r0 - widen; y <= r1 + widen; y++) if (g.inBounds(x, y)) out.push(g.idx(x, y));
    }
  }
  return out;
}

export function bunkerIssues(layout: StationLayout, opts: {startCells?: number; routes?: boolean} = {}): string[] {
  const issues: string[] = [];
  const info = layout.bunker;
  if (!info) return ['no bunker record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== BUNKER_LEVELS) return [`${levels.length} levels`];
  if (g0.w * g0.h > 90_000) issues.push(`grid ${g0.w} x ${g0.h} cells`);
  for (const L of levels) {
    if (L.id !== levels.indexOf(L)) issues.push(`level ${L.id} id mismatch`);
    if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
    if (L.id > 0 && !(L.baseY < levels[L.id - 1].baseY)) issues.push(`level ${L.id} not below level ${L.id - 1}`);
  }
  if (info.storeys.length !== BUNKER_LEVELS || info.storeys.some((s, i) => s.level !== i || Math.abs(s.baseY - levels[i].baseY) > 1e-6 || !s.programme)) issues.push('storey records');

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
  // the vault door: the lane's cells open on both faces of the bulkhead
  {
    const vp = layout.props[info.vaultDoor.prop];
    if (!vp || vp.kind !== 'blastDoor' || vp.variant !== 0) issues.push('vault door prop record');
    const [cx, cy] = g0.cellOf(info.vaultDoor.x, info.vaultDoor.z);
    let open = 0;
    for (let dy = -4; dy <= 5; dy++) { const i = g0.idx(cx, cy + dy); if (g0.cells[i] === FLOOR && !g0.blocked[i] && dist[0][i] >= 0) open++; }
    if (open < 10) issues.push(`vault door lane: ${open} of 10 cells open`);
  }

  // --- Stairs: per pair, loops ---------------------------------------------------------------------------------------------------
  for (let lv = 0; lv + 1 < BUNKER_LEVELS; lv++) {
    const n = layout.levelLinks.filter(k => k.kind === 'stairs' && k.upper === lv && k.lower === lv + 1).length;
    if (n < (lv === 0 ? 1 : 2)) issues.push(`storeys ${lv}-${lv + 1}: ${n} stair runs`);
  }
  if (opts.routes !== false) issues.push(...bunkerRouteIssues(layout, sx, sy));

  // --- Objectives -------------------------------------------------------------------------------------------------------------
  // the front strip: `depthM` of whole cells beyond the body, its full width
  const reachFront = (lv: number, p: {x: number; z: number; rot: number; hx: number; hz: number}, depthM: number, area: number, what: string, d: Int32Array[] = dist): boolean => {
    const g = levels[lv]?.grid;
    if (!g) { issues.push(`${what}: level ${lv} missing`); return false; }
    let n = 0, clear = 0, reached = 0;
    for (const i of frontCells(g, p, Math.ceil(depthM / CELL - 1e-6))) {
      n++;
      if (g.cells[i] === FLOOR && !g.blocked[i] && g.area[i] === area && g.rampIdx[i] < 0) { clear++; if (d[lv][i] >= 0) reached++; }
    }
    if (d === dist) {
      if (!n || clear < n * 0.9) issues.push(`${what}: front ${clear} of ${n} cells clear`);
      if (!reached) issues.push(`${what}: front unreachable`);
    }
    return reached > 0;
  };
  if (info.generators.length !== BUNKER_GENERATOR_COUNT) issues.push(`${info.generators.length} generators`);
  if (new Set(info.generators.map(g => g.level)).size !== info.generators.length) issues.push('generators share a storey');
  info.generators.forEach((gen, i) => {
    if (gen.id !== `gen-${i}`) issues.push(`generator ${i} id ${gen.id}`);
    const p = layout.props[gen.prop];
    if (!p || p.kind !== BUNKER_GENERATOR_KIND || (p.level ?? 0) !== gen.level || p.area !== gen.area) { issues.push(`generator ${gen.id} prop record`); return; }
    if (gen.level < 2 || gen.level > 4) issues.push(`generator ${gen.id} on storey ${gen.level}`);
    reachFront(gen.level, p, 1.5, gen.area, `generator ${gen.id}`);
  });
  {
    const c = info.core, p = layout.props[c.prop];
    if (!p || p.kind !== BUNKER_CORE_KIND || (p.level ?? 0) !== c.level) issues.push('core prop record');
    else {
      if (c.level !== BUNKER_CORE_LEVEL) issues.push(`core on storey ${c.level}`);
      reachFront(c.level, p, 2.0, c.area, 'core cluster');
    }
  }

  // --- Hazards ----------------------------------------------------------------------------------------------------------------
  if (info.gasZones.length < 3 || info.gasZones.length > 6) issues.push(`${info.gasZones.length} gas zones`);
  const strong = info.gasZones.filter(z => z.strength >= GAS_STRONG);
  if (!strong.length) issues.push('no strong gas zone');
  const genAreas = new Set(info.generators.map(g => g.area));
  for (const z of info.gasZones) {
    const g = levels[z.level]?.grid;
    if (!g || !z.cells.length || z.cells.some(i => g.cells[i] !== FLOOR)) { issues.push(`gas zone ${z.id}: seed cells`); continue; }
    if (!(z.strength > 0 && z.strength <= 1)) issues.push(`gas zone ${z.id}: strength ${z.strength}`);
    if (z.strength >= GAS_STRONG) {
      const a = layout.areas[g.area[z.cells[0]]];
      if (!a || a.kind !== 'room' || genAreas.has(a.id) || a.id === info.core.area || a.role === 'stair' || a.type === 'stair-core') issues.push(`strong gas zone ${z.id} in ${a?.label ?? 'nothing'}`);
    }
  }
  // the clean route: with every strong zone's room shut, every generator front and the core front are still reached from the start
  if (strong.length) {
    const shut: [number, number][] = [];
    for (const z of strong) {
      const g = levels[z.level].grid, id = g.area[z.cells[0]];
      for (let i = 0; i < g.cells.length; i++) if (g.area[i] === id && g.cells[i] === FLOOR && !g.blocked[i]) { g.blocked[i] = 1; shut.push([z.level, i]); }
    }
    try {
      const d2 = levelDistance(levels, sx, sy, 0, layout.levelLinks);
      for (const gen of info.generators) {
        const p = layout.props[gen.prop];
        if (p && !reachFront(gen.level, p, 1.5, gen.area, gen.id, d2)) issues.push(`generator ${gen.id}: no route clear of the strong gas`);
      }
      const cp = layout.props[info.core.prop];
      if (cp && !reachFront(info.core.level, cp, 2.0, info.core.area, 'core', d2)) issues.push('core: no route clear of the strong gas');
    } finally { for (const [lv, i] of shut) levels[lv].grid.blocked[i] = 0; }
  }
  if (!info.damp.length) issues.push('no damp areas');

  // --- Railings, shared rules -------------------------------------------------------------------------------------------------
  const drops = levelsOf(layout).unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);
  issues.push(...levelIssues(layout, dist, BUNKER_LEVEL_RULES));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));

  // --- Placements -------------------------------------------------------------------------------------------------------------
  const minCells = opts.startCells ?? 36;
  for (const z of layout.zombies) {
    const lv = z.level ?? 0, g = levels[lv].grid, [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
    const a = layout.areas[g.area[i]];
    if (g.rampIdx[i] >= 0 || a?.role === 'stair') issues.push(`enemy on a stair run (level ${lv})`);
    if (dist[lv][i] >= 0 && dist[lv][i] < minCells) issues.push(`enemy ${(dist[lv][i] * CELL).toFixed(1)} m from the start`);
  }
  return issues;
}

/** Removing any ONE stair run must leave every storey reachable from the start (the main + service stairs: loops). */
export function bunkerRouteIssues(layout: StationLayout, sx: number, sy: number): string[] {
  const out: string[] = [];
  const levels = layout.levels, links = layout.levelLinks.filter(k => k.kind !== 'ladder');
  for (const a of layout.areas) {
    if (a.role !== 'stair' || (a.level ?? 0) === 0) continue; // (storey 0 -> 1 has the main stair only: the station's one way down)
    // the run is carved into its two storeys' grids only (the same cells of other grids are other runs of the same shaft)
    const cells: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) cells.push(layout.grid.idx(x, y));
    const own = [levels[a.level ?? 0], levels[(a.level ?? 0) + 1]].filter(Boolean);
    const saved = own.map(L => cells.map(i => L.grid.blocked[i]));
    for (const L of own) for (const i of cells) L.grid.blocked[i] = 1;
    const d = levelDistance(levels, sx, sy, 0, links);
    own.forEach((L, li) => cells.forEach((i, k) => { L.grid.blocked[i] = saved[li][k]; }));
    for (let lv = 1; lv < levels.length; lv++) {
      const g = levels[lv].grid;
      let any = false;
      for (let i = 0; i < g.cells.length && !any; i++) if (d[lv][i] >= 0 && g.cells[i] === FLOOR && g.rampIdx[i] < 0) any = true;
      if (!any) out.push(`level ${lv} unreachable without ${a.label}`);
    }
  }
  return out;
}
