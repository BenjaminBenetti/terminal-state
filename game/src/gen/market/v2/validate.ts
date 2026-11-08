// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): validation of THE SURVIVOR MARKET version 2 (generation retry guard +
// tests). Pure data. Version 1's rules (gen/market/validate.ts) over three storeys, plus the stalls' display surfaces:
// - storeys: the ground ('main', y 0), the catwalks ('ring', SETTLE.bases[1]), the rooftops ('ring', SETTLE.bases[2]); same grid size;
// - the player's train docks (the start platform), the start is clear on it;
// - reachability: every walkable (unblocked) cell of every storey reachable on foot from the start (stairs, the rooftop ladders);
// - layout.market (v 2): one stall per MARKET_STALLS id — counter inside its shop, the trader and the customer on clear floor on opposite
//   sides of the counter, both reachable WITHOUT a ladder (the residents' / traders' graph), >= 4 display surfaces standing on a real
//   fixture of the shop within reach of the customer's or the trader's floor; >= MARKET_POPULATION.minSpots resident spots (every kind)
//   on clear floor reachable without a ladder, some on the catwalks; the population inside MARKET_POPULATION.residents;
// - the calm rules: no enemies, no hordes, no track extensions, no pickups, no gas-bearing record;
// - railings on every drop (but the rooftop ladders' head openings), the shared storey / traversal / doorway rules.

import {CELL, FLOOR} from '../../grid';
import {levelDistance, levelIssues, type LevelRules} from '../../levelGen';
import {levelsOf} from '../../levels';
import {traversalIssues} from '../../traversal';
import {doorwayIssues} from '../../doorways';
import {playerTrainPlacement} from '../../playerTrain';
import {dropInLadderOpening, excuseDesignedRailGaps} from '../../reactor/pathsGen';
import type {StationLayout} from '../../stationTypes';
import {isLootHolderKind} from '../../../items/loot';
import {MARKET_EMPTY_KEY} from '../dress';
import {MARKET_STALLS} from '../marketTypes';
import {MARKET_POPULATION, marketStandOk} from '../spots';
import {SETTLE} from './frame';

export const SETTLE_LEVEL_RULES: LevelRules = {minLevels: 3, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};
/**
 * Fewest display surfaces a stall shows its stock on; how far (m) a display may lie from walkable floor of its storey; the board length
 * (m, summed widths) within `customerReach` of the customer's eye at the counter (market/wares/slots.ts WARES.reach); the solid display
 * fixtures.
 */
export const SETTLE_DISPLAY = {min: 4, reach: 1.3, customerReach: 2.6, nearWidth: 5.0, solidTops: ['gunDisplay'] as readonly string[]} as const;

export function settleIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const m = layout.market;
  if (!m) return ['no market record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== 3) return [`${levels.length} levels`];
  for (const L of levels) if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
  for (const lv of [1, 2]) if (Math.abs(levels[lv].baseY - SETTLE.bases[lv]) > 1e-6) issues.push(`storey ${lv} height`);

  // --- The calm rules --------------------------------------------------------------------------------------------------------
  if (layout.zombies.length) issues.push(`${layout.zombies.length} enemies`);
  if (layout.hordes?.length) issues.push('hordes');
  if (layout.extensions) issues.push('track extensions');
  if (layout.pickups.length) issues.push(`${layout.pickups.length} pickups`);
  if (layout.office || layout.mall || layout.reactor || layout.skyways) issues.push('another level\'s record');

  // --- The train docks, the start -------------------------------------------------------------------------------------------
  const sp = layout.playerSpawn;
  const [sx, sy] = g0.cellOf(sp.x, sp.z);
  if (!g0.inBounds(sx, sy) || g0.area[g0.idx(sx, sy)] !== layout.platform || !g0.circleClear(sp.x, sp.z, 0.34)) issues.push('start not clear on the platform');
  const train = playerTrainPlacement(layout);
  if (!train) issues.push('the train does not fit the platform');
  else if (train.platformArea !== layout.platform) issues.push('the train docks off the start platform');

  // --- Reachability: the player (stairs + rooftop ladders), the residents (stairs only) --------------------------------------
  const dist = levelDistance(levels, sx, sy, 0, layout.levelLinks);
  const walk = levelDistance(levels, sx, sy, 0, []);
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
  const point = (lv: number, x: number, z: number, what: string) => {
    const g = levels[lv]?.grid;
    if (!g) { issues.push(`${what}: level ${lv} missing`); return; }
    if (!marketStandOk(g, x, z)) { issues.push(`${what} not on clear floor`); return; }
    const [cx, cy] = g.cellOf(x, z);
    if (walk[lv][g.idx(cx, cy)] < 0) issues.push(`${what} unreachable on foot`);
  };

  // --- The record ---------------------------------------------------------------------------------------------------------------
  if (m.v !== 2) issues.push('market record version');
  const ids = m.stalls.map(s => s.id);
  if (ids.length !== MARKET_STALLS.length || MARKET_STALLS.some((id, i) => ids[i] !== id)) issues.push(`stalls ${ids.join(',')}`);
  for (const s of m.stalls) {
    const a = layout.areas[s.area];
    if (!a || !s.name) { issues.push(`stall ${s.id} record`); continue; }
    const c = s.counter;
    if (!(c.x0 >= a.x * CELL - 1e-6 && c.x1 <= (a.x + a.w) * CELL + 1e-6 && c.z0 >= a.y * CELL - 1e-6 && c.z1 <= (a.y + a.h) * CELL + 1e-6)) issues.push(`stall ${s.id} counter outside its shop`);
    point(s.trader.level, s.trader.x, s.trader.z, `stall ${s.id} trader`);
    point(s.front.level, s.front.x, s.front.z, `stall ${s.id} front`);
    // trader and customer on opposite sides of the counter (across its depth: the counter runs along x)
    const side = (z: number) => (z < c.z0 ? -1 : z > c.z1 ? 1 : 0);
    if (!side(s.trader.z) || side(s.trader.z) !== -side(s.front.z)) issues.push(`stall ${s.id} trader / customer not across the counter`);
    // the trader faces the customer: forward (-sin yaw, -cos yaw) toward the front
    if (-Math.cos(s.trader.yaw) * (s.front.z - s.trader.z) <= 0) issues.push(`stall ${s.id} trader faces away`);
    const disp = s.displays ?? [];
    if (disp.length < SETTLE_DISPLAY.min) issues.push(`stall ${s.id}: ${disp.length} displays`);
    // enough of them within the customer's reach (the wares' Steal aim: market/wares/slots.ts WARES.reach, from the eye at the counter):
    // the summed board length there holds the ~18 stacks a stall shows
    // (from any clear standing point on the customer's side of the counter: the shop floor in front of it, its doorway)
    const eye = s.front.y + 1.6, gS = levels[s.front.level].grid, stand: [number, number][] = [];
    for (let y = a.y - 1; y <= a.y + a.h; y++) for (let x = a.x - 1; x <= a.x + a.w; x++) {
      if (!gS.inBounds(x, y) || gS.area[gS.idx(x, y)] !== s.area) continue;
      const [wx, wz] = gS.center(x, y);
      if (side(wz) === side(s.front.z) && marketStandOk(gS, wx, wz)) stand.push([wx, wz]);
    }
    const nearW = disp.filter(d => stand.some(([x, z]) => Math.hypot(d.x - x, d.z - z, d.y - eye) <= SETTLE_DISPLAY.customerReach)).reduce((n, d) => n + d.w, 0);
    if (nearW < SETTLE_DISPLAY.nearWidth) issues.push(`stall ${s.id}: ${nearW.toFixed(2)} m of display within the customer's reach`);
    for (const [k, d] of disp.entries()) {
      // on a real item-collision surface of this shop: its `host` fixture (an empty-keyed loot holder or a solid display top), the slot
      // inside its box, between its base and top, with free height above it
      const host = d.host !== undefined ? layout.props[d.host] : undefined;
      if (!host || host.area !== s.area || (host.level ?? 0) !== d.level || Math.abs(d.x - host.x) > host.hx + 1e-3 || Math.abs(d.z - host.z) > host.hz + 1e-3 || d.y < host.y - 1e-3 || d.y > host.y + host.h + 0.01) { issues.push(`stall ${s.id} display ${k} not on its fixture`); continue; }
      if (!(isLootHolderKind(host.kind) ? host.purpose === MARKET_EMPTY_KEY : SETTLE_DISPLAY.solidTops.includes(host.kind))) issues.push(`stall ${s.id} display ${k} on a ${host.kind} (not an item surface)`);
      if (!((d.clear ?? 0) >= 0.1)) issues.push(`stall ${s.id} display ${k} without free height`);
      const g = levels[d.level].grid;
      let near = false;
      const r = Math.ceil(SETTLE_DISPLAY.reach / CELL);
      const [cx, cy] = g.cellOf(d.x, d.z);
      for (let oy = -r; oy <= r && !near; oy++) for (let ox = -r; ox <= r; ox++) {
        const x = cx + ox, y = cy + oy;
        if (!g.inBounds(x, y) || !g.walkable(x, y) || walk[d.level][g.idx(x, y)] < 0) continue;
        const [wx, wz] = g.center(x, y);
        if (Math.hypot(wx - d.x, wz - d.z) <= SETTLE_DISPLAY.reach + CELL * 0.71) { near = true; break; }
      }
      if (!near) issues.push(`stall ${s.id} display ${k} out of reach`);
    }
  }
  if (m.spots.length < MARKET_POPULATION.minSpots) issues.push(`${m.spots.length} resident spots`);
  for (const k of ['idle', 'sit', 'work', 'cook', 'sleep', 'chat'] as const) if (!m.spots.some(s => s.kind === k)) issues.push(`no '${k}' spot`);
  if (!m.spots.some(s => s.level === 1)) issues.push('no spot on the catwalks');
  m.spots.forEach((s, i) => {
    point(s.level, s.x, s.z, `spot ${i} (${s.kind})`);
    for (const st of m.stalls) if (s.level === st.counter.level && s.x > st.counter.x0 && s.x < st.counter.x1 && s.z > st.counter.z0 && s.z < st.counter.z1) issues.push(`spot ${i} on a counter`);
  });
  if (!(m.residents >= MARKET_POPULATION.residents[0] && m.residents <= MARKET_POPULATION.residents[1])) issues.push(`${m.residents} residents`);

  // --- Railings, shared rules -----------------------------------------------------------------------------------------------
  const drops = levelsOf(layout).unrailedDrops().filter(d => !dropInLadderOpening(layout, d));
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);
  issues.push(...excuseDesignedRailGaps(layout, levelIssues(layout, dist, SETTLE_LEVEL_RULES)));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  return issues;
}
