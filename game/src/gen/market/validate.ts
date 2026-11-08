// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): validation of THE SURVIVOR MARKET (generation retry guard + tests). Pure data.
//
// - Storeys: the shed floor ('main', y 0) + the housing deck ('ring', MARKET.deckY); same grid size.
// - The player's train docks: playerTrainPlacement finds the platform (the start platform), the start is clear on it.
// - Reachability: every walkable (unblocked) cell of both storeys reachable on foot from the start (the stair joins them).
// - layout.market: exactly one stall per MARKET_STALLS id (counter footprint inside its alcove, the trader on clear floor behind it, the
//   customer point on clear floor reachable from the train), >= MARKET_POPULATION.minSpots resident spots on clear reachable floor of their
//   storey (every kind but 'chat' / 'idle' from the furniture), the population inside MARKET_POPULATION.residents.
// - The calm rules: no enemies, no hordes, no track extensions (no annexes), no pickups (no free loot), no gas-bearing record.
// - Railings on every drop; the shared storey / traversal / doorway rules.

import {FLOOR} from '../grid';
import {levelDistance, levelIssues, type LevelRules} from '../levelGen';
import {levelsOf} from '../levels';
import {traversalIssues} from '../traversal';
import {doorwayIssues} from '../doorways';
import {playerTrainPlacement} from '../playerTrain';
import {excuseDesignedRailGaps} from '../reactor/pathsGen';
import type {StationLayout} from '../stationTypes';
import {MARKET_STALLS} from './marketTypes';
import {MARKET} from './frame';
import {MARKET_POPULATION, marketStandOk} from './spots';

export const MARKET_LEVEL_RULES: LevelRules = {minLevels: 2, overlapRoles: [], maxRiser: 0.19, minFlightWidth: 1.5};

export function marketIssues(layout: StationLayout): string[] {
  const issues: string[] = [];
  const m = layout.market;
  if (!m) return ['no market record'];
  const levels = layout.levels, g0 = layout.grid;
  if (levels.length !== 2) return [`${levels.length} levels`];
  for (const L of levels) if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
  if (Math.abs(levels[1].baseY - MARKET.deckY) > 1e-6) issues.push('deck storey height');

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

  // --- Reachability -----------------------------------------------------------------------------------------------------------
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
  const point = (lv: number, x: number, z: number, what: string, reach = true) => {
    const g = levels[lv]?.grid;
    if (!g) { issues.push(`${what}: level ${lv} missing`); return; }
    if (!marketStandOk(g, x, z)) { issues.push(`${what} not on clear floor`); return; }
    const [cx, cy] = g.cellOf(x, z);
    if (reach && dist[lv][g.idx(cx, cy)] < 0) issues.push(`${what} unreachable`);
  };

  // --- The record ---------------------------------------------------------------------------------------------------------------
  if (m.v !== 1) issues.push('market record version');
  const ids = m.stalls.map(s => s.id);
  if (ids.length !== MARKET_STALLS.length || MARKET_STALLS.some((id, i) => ids[i] !== id)) issues.push(`stalls ${ids.join(',')}`);
  for (const s of m.stalls) {
    const a = layout.areas[s.area];
    if (!a || !s.name) { issues.push(`stall ${s.id} record`); continue; }
    const c = s.counter;
    if (!(c.x0 >= a.x * 0.5 - 1e-6 && c.x1 <= (a.x + a.w) * 0.5 + 1e-6 && c.z0 >= a.y * 0.5 - 1e-6 && c.z1 <= (a.y + a.h) * 0.5 + 1e-6)) issues.push(`stall ${s.id} counter outside its stall`);
    point(s.trader.level, s.trader.x, s.trader.z, `stall ${s.id} trader`);
    if (!(s.trader.z < c.z0)) issues.push(`stall ${s.id} trader not behind the counter`);
    point(s.front.level, s.front.x, s.front.z, `stall ${s.id} front`);
    if (!(s.front.z > c.z1)) issues.push(`stall ${s.id} front not in front of the counter`);
  }
  if (m.spots.length < MARKET_POPULATION.minSpots) issues.push(`${m.spots.length} resident spots`);
  for (const k of ['idle', 'sit', 'work', 'cook', 'sleep', 'chat'] as const) if (!m.spots.some(s => s.kind === k)) issues.push(`no '${k}' spot`);
  if (!m.spots.some(s => s.level === 1)) issues.push('no spot on the deck');
  m.spots.forEach((s, i) => {
    point(s.level, s.x, s.z, `spot ${i} (${s.kind})`);
    for (const st of m.stalls) if (s.x > st.counter.x0 && s.x < st.counter.x1 && s.z > st.counter.z0 && s.z < st.counter.z1) issues.push(`spot ${i} on a counter`);
  });
  if (!(m.residents >= MARKET_POPULATION.residents[0] && m.residents <= MARKET_POPULATION.residents[1])) issues.push(`${m.residents} residents`);

  // --- Railings, shared rules -----------------------------------------------------------------------------------------------
  const drops = levelsOf(layout).unrailedDrops();
  if (drops.length) issues.push(`${drops.length} unrailed drops (first at ${drops[0].x0.toFixed(1)},${drops[0].z0.toFixed(1)} level ${drops[0].level})`);
  issues.push(...excuseDesignedRailGaps(layout, levelIssues(layout, dist, MARKET_LEVEL_RULES)));
  issues.push(...traversalIssues(layout));
  issues.push(...doorwayIssues(layout));
  return issues;
}
