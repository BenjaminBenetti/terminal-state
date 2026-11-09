// Task studio-market-bar-20261108-225231-01 (lane BAR): THE SURVIVOR MARKET, layout version 3 — version 2's container settlement plus
// THE BAR (user: "A substantially sized upper-level bar with substantial props/tables, NPCs drinking, bartender selling beers").
// This is the bar's CARVE, run on version 2's finished carve (gen/market/v2/carve.ts) before the crop, without any random draw.
//
// The bar is a DECK at catwalk level (storey 1, SETTLE.bases[1] = 2.95 m) over THE YARD — the communal square between block B (its
// main stair, the Yard stairs, rising beside it) and block C — under the shed roof (SETTLE.roofY: the roof over the bar, 5.65 m of
// headroom), reaching 2 rows out over the Market Lane and 2 over the Back Lane (one rail line each, like the bridges' decks):
//  - joined to the Yard stairs' top landing (the settlement's main stair: its far side) and along its whole yard edge to block C's ring
//    catwalk (that block's bridges lead on to the front and back catwalks);
//  - the yard below becomes a COVERED yard (its ceiling at a ground container's height, SETTLE.cont, like the lanes under the bridges),
//    and one cell column of the yard along the stair is closed at the ground (a partition under the deck's edge: the stair then runs in
//    a trench between block B's catwalk and the bar deck, railed at the top — never a railing poking into the deck's slab);
//  - railings on every drop (derived as for every catwalk / bridge: gen/market/v2/index.ts settleRails).
// The bar's furnishing is gen/market/v3/barDress.ts, its record gen/market/v3/barRecord.ts.

import {CELL, FLOOR, SOLID} from '../../grid';
import type {Kit} from '../../stationKit';
import type {Area, Rect} from '../../stationTypes';
import {SETTLE} from '../v2/frame';
import type {SettleCarve} from '../v2/carve';

/** The deck's reach out over the lanes (rows) on the Market Lane side and on the Back Lane side. */
export const BAR_DECK = {north: 2, south: 2} as const;

/** The carved bar deck (world cells). */
export interface BarCarve {
  /** The deck's storey-1 area. */
  area: number;
  /** Its rect (world cells; every cell storey-1 floor). */
  rect: Rect;
  /** World x direction from the stair side across the deck toward block C (+1 / -1: a mirrored station). */
  dir: 1 | -1;
  /** The yard's rows (world cells; the deck adds BAR_DECK.north / .south around them). */
  yardY0: number;
  yardY1: number;
  /** The ground partition (world cells, storey 0) under the deck's stair-side edge. */
  partition: Rect;
  /** The Yard stairs' top-landing rows (world cells, inclusive start, exclusive end) where the stair joins the deck. */
  landing: {y0: number; y1: number};
  /** Block C's ring catwalk area (the deck's far side joins it). */
  ring: number;
}

/** Why the last bar carves failed (QA / tests). */
export const BAR_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { BAR_CARVE_FAILS[why] = (BAR_CARVE_FAILS[why] ?? 0) + 1; return null; };

/** Carves the bar deck into version 2's kit (before the crop); null when it does not fit (the caller re-rolls). */
export function carveBar(k: Kit, sc: SettleCarve, label: string): BarCarve | null {
  const g0 = k.grid(0), g1 = k.grid(1);
  const yard = sc.lanes.yard, st = sc.stairs.find(s => s.block === 1);
  if (!st) return fail('no yard stair');
  // the stair stands at one end of the yard (canonically its west end: world west, or east when mirrored)
  const west = st.rect.x === yard.x, east = st.rect.x + st.rect.w === yard.x + yard.w;
  if (west === east) return fail('yard stair not at a yard end');
  const dir: 1 | -1 = west ? 1 : -1;
  const x0 = west ? yard.x + st.rect.w : yard.x, x1 = west ? yard.x + yard.w : yard.x + yard.w - st.rect.w;
  const rect: Rect = {x: x0, y: yard.y - BAR_DECK.north, w: x1 - x0, h: yard.h + BAR_DECK.north + BAR_DECK.south};
  const lanes = sc.lanes;
  if (rect.y < lanes.market.y || rect.y + rect.h > lanes.back.y + lanes.back.h) return fail('deck beyond the lanes');
  if (BAR_DECK.north >= lanes.market.h - 2 || BAR_DECK.south >= lanes.back.h - 2) return fail('lane too narrow under the deck');
  // the far side must be block C's ring (storey 1 floor along the whole yard edge)
  const farX = west ? x1 : x0 - 1;
  const block = sc.blocks.find(b => farX >= b.x0 && farX < b.x1);
  if (!block) return fail('no block beside the yard');
  for (let y = yard.y; y < yard.y + yard.h; y++) if (g1.cells[g1.idx(farX, y)] !== FLOOR || g1.area[g1.idx(farX, y)] !== block.ring) return fail('block ring not along the yard');
  // nothing on storey 1 there yet (no bridge, catwalk or stair over the yard / the lanes' edge rows)
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const i = g1.idx(x, y);
    if (g1.cells[i] !== SOLID) return fail('storey 1 taken over the yard');
    if (g0.cells[i] !== FLOOR || g0.rampIdx[i] >= 0) return fail('the ground under the deck is not open floor');
  }
  // the stair's top landing: its flat storey-1 cells beside the deck
  const sx = west ? st.rect.x + st.rect.w - 1 : st.rect.x;
  let ly0 = -1, ly1 = -1;
  for (let y = st.rect.y; y < st.rect.y + st.rect.h; y++) {
    const i = g1.idx(sx, y);
    const flat = g1.cells[i] === FLOOR && g1.rampIdx[i] < 0 && Math.abs(g1.floor[i] - SETTLE.bases[1]) < 1e-6;
    if (flat && ly0 < 0) ly0 = y;
    if (flat) ly1 = y + 1;
  }
  if (ly0 < 0 || ly1 - ly0 < 3) return fail('no stair landing beside the deck');

  // --- the deck (storey 1, under the shed roof) ---------------------------------------------------------------------------------
  const a: Area = k.addArea(rect, 'concourse', 'concourse', SETTLE.roofY, -1, {level: 1, floorY: SETTLE.bases[1], label, publicSpace: true});
  // --- the ground under it: covered at a container's height (the bridges' rule); the partition along the stair --------------------
  const cont = SETTLE.bases[0] + SETTLE.cont;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) g0.ceil[g0.idx(x, y)] = cont;
  const px = west ? x0 : x1 - 1;
  const py0 = Math.max(yard.y, st.rect.y), py1 = Math.min(yard.y + yard.h, st.rect.y + st.rect.h);
  for (let y = py0; y < py1; y++) {
    const i = g0.idx(px, y);
    g0.cells[i] = SOLID; g0.area[i] = -1; g0.ceil[i] = 0; g0.floor[i] = 0;
  }
  return {area: a.id, rect, dir, yardY0: yard.y, yardY1: yard.y + yard.h, partition: {x: px, y: py0, w: 1, h: py1 - py0}, landing: {y0: ly0, y1: ly1}, ring: block.ring};
}

/** The deck's floor area (m², every cell of it storey-1 floor). */
export function barDeckArea(b: Pick<BarCarve, 'rect'>): number {
  return b.rect.w * b.rect.h * CELL * CELL;
}
