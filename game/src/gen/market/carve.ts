// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): carving of THE SURVIVOR MARKET into ONE Kit (canvas = grid cells: the crop
// origin is fixed at 0, 0). Pure data (gen/market/index.ts links, rails, dresses, records and validates). The shared station kit's
// pieces: a one-track bed + side platform like the Reactor's rim station (gen/reactor/carve.ts), straight stair runs carved into both
// storeys (gen/traversal.ts layStairRun, an open stair capped by the shed roof), areas / openings through Kit.addArea / carveDoor.
//
// Canonical frame (gen/market/frame.ts): bed north, platform, the stall row, the square, the deck strip south; the stair at the WEST end
// of the square (a mirrored station stamps every rect at W - x - w: the stair / workshop east).

import {CELL, VOID} from '../grid';
import {Kit, TUN, type TrenchCells} from '../stationKit';
import {STAIR, layStairRun, stairRunCells, type StairFlight} from '../traversal';
import {SLAB} from '../levelGen';
import {SINGLE_BED_CELLS, TRENCH_DEPTH, type Area, type Rect} from '../stationTypes';
import type {MarketStallId} from './marketTypes';
import {MARKET, type MarketFrame} from './frame';

/** Open stair: a large headroom capped by the cell ceiling (the shed roof) — gen/levels.ts header, the mall's / Reactor's open runs. */
export const OPEN_HEADROOM = 40;

/** One trader stall: its alcove area, the alcove rect (cells) and the opening onto the square (cells, one row). */
export interface StallCarve { id: MarketStallId; area: number; rect: Rect; opening: Rect }
/** One market gate: the passage through the stall row (cells) and its two openings. */
export interface GateCarve { area: number; rect: Rect; platformDoor: Rect; squareDoor: Rect }
/** The under-deck rooms (storey 0) by use. */
export type UnderUse = 'workshop' | 'bunks' | 'kitchen';
export interface UnderCarve { use: UnderUse; area: number; rect: Rect }

export interface MarketCarve {
  f: MarketFrame;
  /** Absolute floor of each storey (0: the shed floor, 1: the housing deck). */
  bases: [number, number];
  bed: Rect;
  trench: TrenchCells;
  platform: Area;
  stalls: StallCarve[];
  gates: GateCarve[];
  square: Area;
  /** The square's rect (cells; the stair run is carved over its west / east end). */
  squareRect: Rect;
  under: UnderCarve[];
  deck: Area;
  stair: {area: number; rect: Rect; flights: number[]};
  /** Rows: the platform's south wall, the stall row's front wall (the openings), the deck strip's first row. */
  rows: {platformWall: number; frontWall: number; deck: number};
  /** World x of the canonical WEST end (the stair / workshop side): -1 when mirrored (west -> east). */
  westSign: 1 | -1;
}

/** Why the last attempts failed (QA / tests). */
export const MARKET_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { MARKET_CARVE_FAILS[why] = (MARKET_CARVE_FAILS[why] ?? 0) + 1; return null; };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Carves the whole settlement into a fresh kit (2 storeys); null when the program does not fit (the caller re-rolls). */
export function carveMarket(k: Kit, f: MarketFrame): MarketCarve | null {
  const W = k.g.w, H = k.g.h;
  const M = (r: Rect): Rect => (f.mirror ? {x: W - r.x - r.w, y: r.y, w: r.w, h: r.h} : r);
  const g0 = k.grid(0), g1 = k.grid(1);
  const roof = MARKET.roofY, deckY = MARKET.deckY;
  const bases: [number, number] = [0, deckY];

  // --- 1. Track bed + side platform (edge N: the track 2.0 m north of the platform edge) ----------------------------------------
  const bedRows = SINGLE_BED_CELLS;
  const bed = M({x: MARKET.bedX, y: MARKET.bedY, w: f.Lp + 2 * TUN, h: bedRows});
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) {
    const i = g0.idx(x, y);
    g0.cells[i] = VOID; g0.ceil[i] = roof; g0.floor[i] = -TRENCH_DEPTH;
  }
  g0.voidFloor = -TRENCH_DEPTH;
  const y1 = bed.y + bed.h;
  const pRect = M({x: MARKET.bedX + TUN, y: y1, w: f.Lp, h: f.Pd});
  const trench: TrenchCells = {x0: bed.x, x1: bed.x + bed.w, y0: bed.y, y1, px0: pRect.x, px1: pRect.x + pRect.w, tracks: [y1 * CELL - 2.0], third: [-1], columns: false, ceil: roof};
  k.trenches.push(trench);
  const platform = k.addArea(pRect, 'platform', 'platform', roof, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;

  // --- 2. The stall row: six alcoves + two gates, centred on the platform -------------------------------------------------------
  const platformWall = pRect.y + pRect.h, by0 = platformWall + 1, frontWall = by0 + MARKET.stallDepth;
  const slots = 8, units: ('stall' | 'gate')[] = [];
  for (let s = 0, st = 0; s < slots; s++) units.push(s === f.gates[0] || s === f.gates[1] ? 'gate' : (st++, 'stall'));
  const total = units.reduce((n, u) => n + (u === 'gate' ? f.gateW : f.stallW), 0) + slots - 1;
  const cPlat = MARKET.bedX + TUN + f.Lp / 2; // canonical platform centre (cells)
  const bx0 = Math.round(cPlat - total / 2), bx1 = bx0 + total;
  const hx0 = bx0 - MARKET.hallMargin, hx1 = bx1 + MARKET.hallMargin;
  if (hx0 < 2 || hx1 > W - 2) return fail('stall row wider than the canvas');
  const stalls: StallCarve[] = [], gates: GateCarve[] = [];
  const pendingDoors: (() => void)[] = [];
  let x = bx0, si = 0;
  const pxc0 = MARKET.bedX + TUN, pxc1 = pxc0 + f.Lp; // canonical platform span
  for (const u of units) {
    const w = u === 'gate' ? f.gateW : f.stallW;
    if (u === 'gate') {
      if (x < pxc0 + 1 || x + w > pxc1 - 1) return fail('a market gate off the platform');
      const rect = M({x, y: by0, w, h: MARKET.stallDepth});
      const a = k.addArea(rect, 'passage', 'passage', MARKET.gateCeil, platform.id, {label: 'Market gate'});
      const platformDoor = M({x, y: platformWall, w, h: 1}), squareDoor = M({x, y: frontWall, w, h: 1});
      gates.push({area: a.id, rect, platformDoor, squareDoor});
      pendingDoors.push(() => { k.carveDoor(platformDoor, platform, a, MARKET.gateHead, false); });
    } else {
      const id = f.order[si++];
      const rect = M({x, y: by0, w, h: MARKET.stallDepth});
      const a = k.addArea(rect, 'room', 'shop', MARKET.stallCeil, -1, {label: 'Stall', publicSpace: false});
      stalls.push({id, area: a.id, rect, opening: M({x: x + 1, y: frontWall, w: w - 2, h: 1})});
    }
    x += w + 1;
  }

  // --- 3. The square (the shed floor) and the deck strip ---------------------------------------------------------------------------
  const sy0 = frontWall + 1;
  const squareRect = M({x: hx0, y: sy0, w: hx1 - hx0, h: f.squareD});
  const dy0 = sy0 + f.squareD;
  if (dy0 + MARKET.deckDepth + 2 > H) return fail('deck strip beyond the canvas');
  const square = k.addArea(squareRect, 'concourse', 'concourse', roof, -1, {label: 'Market square'});
  // under the deck: workshop | bunk room | kitchen (canonical west -> east), 1-cell partition walls between them, open to the square
  const len = hx1 - hx0, cut0 = hx0 + Math.round(len * f.split[0]), cut1 = hx0 + Math.round(len * f.split[1]);
  const soffit = r2(deckY - SLAB);
  const under: UnderCarve[] = [];
  const uses: [UnderUse, number, number, string][] = [['workshop', hx0, cut0, 'Workshop'], ['bunks', cut0 + 1, cut1, 'Bunk room'], ['kitchen', cut1 + 1, hx1, 'Communal kitchen']];
  for (const [use, a0, a1, label] of uses) {
    if (a1 - a0 < 14) return fail('under-deck room too narrow');
    const rect = M({x: a0, y: dy0, w: a1 - a0, h: MARKET.deckDepth});
    const a = k.addArea(rect, 'room', use === 'workshop' ? 'utility' : 'crew-room', soffit, square.id, {label, publicSpace: false});
    if (use === 'workshop') a.purpose = 'workshop';
    under.push({use, area: a.id, rect});
  }
  const deckRect = M({x: hx0, y: dy0, w: hx1 - hx0, h: MARKET.deckDepth});
  const deck = k.addArea(deckRect, 'concourse', 'concourse', roof, -1, {label: 'Housing deck', level: 1, floorY: deckY, publicSpace: false});

  // --- 4. The open stair from the square up to the deck (canonical west end, against the square's west wall) ---------------------
  const spec = {...STAIR, headroom: OPEN_HEADROOM};
  const run = stairRunCells(deckY, spec);
  if (run > f.squareD - 6) return fail('stair longer than the square');
  const sRect = M({x: hx0, y: dy0 - run, w: MARKET.stairW, h: run});
  const sArea = k.addArea(sRect, 'passage', 'stair-core', roof, -1, {also: [1], role: 'stair', publicSpace: false, label: 'Deck stairs'});
  // the run rises toward the deck (south): its top landing at the deck end ('hi'), flush with the square floor at the north end
  const fl: StairFlight[] = layStairRun([g0, g1], sRect, sArea.id, 'z', 'hi', deckY, 0, spec);
  const flights: number[] = [];
  for (const q of fl) { q.id = k.flights.length; flights.push(q.id); k.flights.push(q); }
  // the open run is capped by the shed roof on both storeys (its band = [pitch line, roof])
  for (let y = sRect.y; y < sRect.y + sRect.h; y++) for (let xx = sRect.x; xx < sRect.x + sRect.w; xx++) { const i = g0.idx(xx, y); g0.ceil[i] = roof; g1.ceil[i] = roof; }

  // --- 5. Openings ---------------------------------------------------------------------------------------------------------------
  for (const d of pendingDoors) d();
  for (const s of stalls) k.carveDoor(s.opening, square, k.areas[s.area], MARKET.stallHead, false);
  for (const gt of gates) k.carveDoor(gt.squareDoor, square, k.areas[gt.area], MARKET.gateHead, false);

  return {
    f, bases, bed, trench, platform, stalls, gates, square, squareRect, under, deck, stair: {area: sArea.id, rect: sRect, flights},
    rows: {platformWall, frontWall, deck: dy0}, westSign: f.mirror ? -1 : 1,
  };
}
