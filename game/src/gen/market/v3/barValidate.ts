// Task studio-market-bar-20261108-225231-01 (lane BAR): validation of layout version 3 (generation retry guard + tests) — every version-2
// rule (gen/market/v2/validate.ts settleIssues, with the bar as a seventh stall: its counter in its area, the bartender and the customer
// spot on clear floor across the counter, reachable on foot, >= 4 display surfaces on real fixtures within reach, the calm rules,
// railings, the shared storey / traversal / doorway rules) plus THE BAR's own:
//  - on the catwalk storey (storey 1), under a roof with headroom, at least BAR_RULES.minArea of floor;
//  - the furniture: a counter run of >= 2 modules, >= 4 stools, >= 3 tables with >= 6 chairs, no free loot (every holder: the exact
//    empty key);
//  - the stock's surfaces on the bartender's side of the counter (never its top, never the customer side);
//  - >= BAR_SPOTS.min 'drink' posts on the bar's clear floor (reachable on foot: the version-2 spot rule), each naming its stool / chair.

import {CELL, FLOOR} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import {isLootHolderKind} from '../../../items/loot';
import {MARKET_EMPTY_KEY} from '../dress';
import {BAR_STALL, MARKET_STALLS_ALL} from '../marketTypes';
import {SETTLE} from '../v2/frame';
import {settleIssues} from '../v2/validate';
import {BAR_SPOTS} from './barRecord';

export const BAR_RULES = {
  /** Fewest square metres of bar floor (the brief's "45 m² or more"). */
  minArea: 45,
  /** Least headroom over the bar's floor (m). */
  headroom: 2.4,
  min: {modules: 2, stools: 4, tables: 3, chairs: 6},
} as const;

/** The bar's floor area (m²): its area's storey-1 floor cells. */
export function barFloorArea(layout: StationLayout, area: number): number {
  const g = layout.levels[1]?.grid;
  if (!g) return 0;
  let n = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.area[i] === area) n++;
  return n * CELL * CELL;
}

/** (task studio-corpse-market-shop-20261114-031614-01: `expect` — layout version 4 checks its version-3 part with its own record version
 *  and its sealed den back room, gen/market/v4/denValidate.ts; version 3's by default) */
export function barSettleIssues(layout: StationLayout, expect: {v?: number; sealed?: readonly number[]} = {}): string[] {
  const issues = settleIssues(layout, {v: expect.v ?? 3, stalls: MARKET_STALLS_ALL, behindCounter: [BAR_STALL], ...(expect.sealed ? {sealed: expect.sealed} : {})});
  const m = layout.market;
  const bar = m?.stalls.find(s => s.id === BAR_STALL);
  if (!m || !bar) return [...issues, 'no bar'];
  const a = layout.areas[bar.area], g = layout.levels[1]?.grid;
  if (!a || !g || (a.level ?? 0) !== 1 || bar.counter.level !== 1) return [...issues, 'the bar is not on the catwalk storey'];
  const area = barFloorArea(layout, a.id);
  if (area < BAR_RULES.minArea) issues.push(`bar floor ${area.toFixed(1)} m²`);
  let low = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.area[i] === a.id && !(g.hasCeil(i) && g.ceil[i] - g.floorOf(i) >= BAR_RULES.headroom && g.ceil[i] <= SETTLE.roofY + 1e-6)) low++;
  if (low) issues.push(`${low} bar cells without a roof / headroom`);
  // the furniture
  const props = layout.props.filter(p => p.area === a.id && (p.level ?? 0) === 1);
  const n = (k: string) => props.filter(p => p.kind === k && p.host === undefined).length;
  if (n('shopCounter') < BAR_RULES.min.modules) issues.push(`${n('shopCounter')} bar counter modules`);
  if (n('skyMuStool') < BAR_RULES.min.stools) issues.push(`${n('skyMuStool')} bar stools`);
  if (n('cafeBistroTable') < BAR_RULES.min.tables) issues.push(`${n('cafeBistroTable')} bar tables`);
  if (n('cafeChair') < BAR_RULES.min.chairs) issues.push(`${n('cafeChair')} bar chairs`);
  for (const p of props) if (isLootHolderKind(p.kind) && p.purpose !== MARKET_EMPTY_KEY) issues.push(`bar ${p.kind} with loot key ${p.purpose}`);
  // the stock's surfaces: behind the counter (the bartender's side), never on it
  const c = bar.counter, side = (zz: number) => (zz < c.z0 ? -1 : zz > c.z1 ? 1 : 0), own = side(bar.trader.z);
  for (const [k, d] of (bar.displays ?? []).entries()) {
    const host = d.host !== undefined ? layout.props[d.host] : undefined;
    if (host?.kind === 'shopCounter') issues.push(`bar display ${k} on the counter`);
    if (side(d.z) !== own) issues.push(`bar display ${k} not behind the counter`);
  }
  // the patrons' posts
  const drink = m.spots.filter(s => s.kind === 'drink');
  if (drink.length < BAR_SPOTS.min) issues.push(`${drink.length} drink spots`);
  for (const s of drink) {
    const seat = s.seat !== undefined ? layout.props[s.seat] : undefined;
    if (s.area !== a.id || s.level !== 1) issues.push('a drink spot off the bar');
    if (!seat || seat.area !== a.id || !['skyMuStool', 'cafeChair'].includes(seat.kind) || Math.hypot(seat.x - s.x, seat.z - s.z) > 2.2) issues.push('a drink spot without its seat');
  }
  return issues;
}
