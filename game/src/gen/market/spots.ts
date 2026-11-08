// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's shared record (layout.market, gen/market/marketTypes.ts)
// — the six stalls (counter, trader, customer points) and the residents' spots — from the furnished layout. Pure and deterministic.
//
// Every point stands on a clear, flat, walkable floor cell of its storey (FLOOR, not blocked by a prop, not a stair cell, a 0.3 m body
// clear of walls / props): never the track bed (VOID), never under the parked train (the car stands over the bed), never on a counter.
// A use point that lands on a taken cell is nudged to the nearest clear cell of its area (within 1.5 m) or dropped.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, type Grid} from '../grid';
import type {StationLayout} from '../stationTypes';
import {MARKET_STALLS, type MarketLayout, type MarketSpot, type MarketStall, type MarketStallId} from './marketTypes';
import type {MarketCarve} from './carve';
import type {DressAnchors} from './dress';
import {MARKET} from './frame';

/** Residents (wanderers / idlers; the traders are extra, one per stall) and the spot floor the record keeps. */
export const MARKET_POPULATION = {residents: [8, 12] as const, minSpots: 12};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A clear stand point: flat FLOOR, unblocked, off the stairs, a 0.3 m body clear (the storey's grid). */
export function marketStandOk(g: Grid, x: number, z: number): boolean {
  const [cx, cy] = g.cellOf(x, z);
  if (!g.inBounds(cx, cy)) return false;
  const i = g.idx(cx, cy);
  return g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && g.circleClear(x, z, 0.3);
}

/** The nearest clear stand point of `area` within `r` cells of (x, z) (cell centres; the point itself first), or null. */
function nudge(g: Grid, x: number, z: number, area: number, r = 3): {x: number; z: number} | null {
  if (marketStandOk(g, x, z) && g.area[g.idx(...g.cellOf(x, z))] === area) return {x, z};
  const [cx, cy] = g.cellOf(x, z);
  for (let d = 1; d <= r; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
    if (Math.max(Math.abs(ox), Math.abs(oy)) !== d || !g.inBounds(cx + ox, cy + oy)) continue;
    if (g.area[g.idx(cx + ox, cy + oy)] !== area) continue;
    const [wx, wz] = g.center(cx + ox, cy + oy);
    if (marketStandOk(g, wx, wz)) return {x: wx, z: wz};
  }
  return null;
}

/** layout.market of a furnished settlement. */
export function marketRecord(layout: StationLayout, mc: MarketCarve, anchors: DressAnchors, names: Record<MarketStallId, string>, rng: Rng): MarketLayout {
  const g0 = layout.levels[0].grid, g1 = layout.levels[1].grid;
  const gridOf = (lv: number) => (lv === 1 ? g1 : g0);
  const base = (lv: number) => (lv === 1 ? MARKET.deckY : 0);
  // --- the stalls, in MARKET_STALLS order --------------------------------------------------------------------------------------
  const stalls: MarketStall[] = [];
  for (const id of MARKET_STALLS) {
    const d = anchors.stalls.find(s => s.id === id), c = mc.stalls.find(s => s.id === id);
    if (!d || !c) continue;
    stalls.push({
      id, name: names[id], area: c.area,
      counter: {...d.counter, x: r3((d.counter.x0 + d.counter.x1) / 2), z: r3((d.counter.z0 + d.counter.z1) / 2), y: 0, level: 0},
      // the trader faces the counter's front (+Z, the square): forward (-sin yaw, -cos yaw) = (0, 1)
      trader: {x: d.trader.x, z: d.trader.z, y: 0, level: 0, yaw: r3(Math.PI)},
      front: {x: d.front.x, z: d.front.z, y: 0, level: 0},
    });
  }
  // --- the residents' spots: the furniture's use points, then idle / chat posts on open floor ------------------------------------
  const spots: MarketSpot[] = [];
  const add = (kind: MarketSpot['kind'], lv: number, area: number, x: number, z: number, yaw: number) => {
    const p = nudge(gridOf(lv), x, z, area);
    if (!p || spots.some(s => s.level === lv && Math.hypot(s.x - p.x, s.z - p.z) < 0.9)) return;
    spots.push({kind, x: r3(p.x), z: r3(p.z), y: base(lv), level: lv, yaw: r3(yaw), area});
  };
  for (const u of anchors.uses) add(u.kind, u.level, u.area, u.x, u.z, u.yaw);
  const sr = {x0: mc.squareRect.x * CELL, z0: mc.squareRect.y * CELL, x1: (mc.squareRect.x + mc.squareRect.w) * CELL, z1: (mc.squareRect.y + mc.squareRect.h) * CELL};
  const sq = mc.square.id;
  // two chats in the square (pairs facing each other across 1.2 m), between the stall aisle and the tables
  for (let k = 0; k < 2; k++) {
    const x = sr.x0 + (sr.x1 - sr.x0) * (k === 0 ? 0.3 : 0.62) + rng.range(-1, 1), z = sr.z0 + 4.2 + rng.range(-0.4, 0.4);
    add('chat', 0, sq, x - 0.6, z, -Math.PI / 2); // facing +x
    add('chat', 0, sq, x + 0.6, z, Math.PI / 2); // facing -x
  }
  // idle posts: the square (watching the stalls), the platform ends (watching the track), the deck's rail (over the square)
  add('idle', 0, sq, sr.x0 + (sr.x1 - sr.x0) * 0.5 + rng.range(-2, 2), sr.z0 + 3.3, 0);
  add('idle', 0, sq, sr.x0 + (sr.x1 - sr.x0) * 0.82, sr.z1 - 3.0, 0);
  const P = mc.platform, edgeZ = P.y * CELL;
  add('idle', 0, P.id, P.x * CELL + 1.5, edgeZ + 2.2, 0);
  add('idle', 0, P.id, (P.x + P.w) * CELL - 1.5, edgeZ + 2.2, 0);
  const D = mc.deck, st = {x0: mc.stair.rect.x * CELL, x1: (mc.stair.rect.x + mc.stair.rect.w) * CELL};
  for (const t of [0.35, 0.7]) {
    let x = (D.x + D.w * t) * CELL;
    if (x > st.x0 - 2 && x < st.x1 + 2) x += 4;
    add('idle', 1, D.id, x, D.y * CELL + 0.9, 0); // at the rail, facing north over the square
  }
  const [r0, r1] = MARKET_POPULATION.residents;
  return {v: 1, stalls, spots, residents: rng.int(r0, r1)};
}
