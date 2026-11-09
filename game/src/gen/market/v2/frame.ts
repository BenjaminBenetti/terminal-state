// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): THE SURVIVOR MARKET, layout version 2 — the frame of the dense container
// settlement (user: "way to 'one big box' it needs to feel more like Tokyo, more cramped, more assembly of shipping containers, more
// lived in"): fixed dimensions and the seeded free parameters of one station. Pure data.
//
// Canonical frame (cells, 0.5 m; the track bed north, the settlement south; a mirrored station flips x when stamping), rows north->south:
//   - the track bed (one track) + the side platform the player's train docks at (edge N, the car 2.0 m out: unchanged from version 1);
//   - the FRONT ROW: a row of deep shipping containers backing onto the platform wall (shops facing the Market Lane), cut by two GATES
//     (tunnels under the stack from the platform into the lanes); over it a catwalk (storey 1) and a row of upper containers (homes),
//     and their rooftop (storey 2);
//   - the MARKET LANE (a cramped alley along the front row);
//   - the MIDDLE ROW: container BLOCKS (back-to-back containers on the ground, one upper container set back on top with a ring catwalk
//     round it, its rooftop above) between a west end alley (a stair up), a narrow cross alley, THE YARD (the communal open square, the
//     main stair up) and an east end alley;
//   - the BACK LANE;
//   - the BACK ROW: deep containers against the shed's south wall (the communal kitchen opposite the yard, the bunk room, the workshop,
//     shops), a catwalk + upper homes + rooftop over them.
// Bridges join the catwalks across the lanes; ladders climb from the catwalks to the rooftops.

import {Rng, hashString} from '../../../core/rng';
import {MARKET_STALLS, type MarketShopId} from '../marketTypes';
import {marketNameOf} from '../frame';

/** Fixed dimensions (cells unless noted). */
export const SETTLE = {
  /** Canvas (cells; crop origin 0, 0) and storeys: 0 = the ground, 1 = the catwalks / upper containers, 2 = the rooftops. */
  canvas: {w: 100, h: 78, levels: 3},
  bedY: 3,
  bedX: 4,
  /** The town's x span (cells, canonical; shed walls at x0 - 1 and x1). */
  x0: 6,
  x1: 94,
  /** Absolute floor of each storey (m) and the container interiors' ceiling height above their floor (m). */
  bases: [0, 2.95, 5.9] as const,
  cont: 2.6,
  /** The shed roof over the lanes, the catwalks and the rooftops (m, absolute). */
  roofY: 8.6,
  /** Front / back row depth (rows incl. both walls: 8 interior rows, 4 m), a middle block's depth (13 rows: two 5-row containers back
   *  to back), the catwalk width (rows / columns). */
  rowD: 10,
  blockD: 13,
  cat: 3,
  /** Door heads (m above the floor): container doors / shop openings, gates. */
  doorH: 2.2,
  gateH: 2.4,
  /** A front / back row container's interior width range (cells), a block container's minimum, an upper home's range. */
  rowCont: [9, 13] as const,
  blockCont: 6,
  homeCont: [7, 12] as const,
} as const;

/** Seeded free parameters of one version-2 market station. */
export interface SettleFrame {
  mirror: boolean;
  /** Platform length / depth (cells). */
  Lp: number;
  Pd: number;
  /** Lane widths (rows): the Market Lane, the Back Lane. */
  laneF: number;
  laneB: number;
  /** Gates (canonical x of the first cell, width) through the front row. */
  gates: {x: number; w: number}[];
  /** Middle row widths (cells, canonical west -> east): west end alley, block A, cross alley, block B, the yard, block C, east end alley. */
  mid: {west: number; a: number; cross: number; b: number; yard: number; c: number; east: number};
  /** Which stalls stand in the front row (walk-in shops) and which in the back row (counter-fronted), in canonical west -> east order. */
  front: MarketShopId[];
  back: MarketShopId[];
  /** The settlement's painted name. */
  name: string;
  salt: number;
}

/** The station's version-2 frame (salt > 0: a re-roll after a program that did not fit). */
export function settleFrame(levelSeed: number, salt = 0): SettleFrame {
  const r = new Rng(hashString(`market-v2-frame:${salt}`, levelSeed >>> 0));
  const mirror = r.chance(0.5);
  const Lp = r.int(60, 64), Pd = r.int(10, 12);
  const laneF = r.int(6, 7), laneB = r.int(6, 7);
  // two gates inside the platform span, near its thirds (the parked train's middle door opens near one of them)
  const pc0 = SETTLE.bedX + 12; // the platform's first column (the bed runs TUN = 12 cells past each end)
  const gw0 = r.int(6, 7), gw1 = r.int(6, 7);
  const g0 = Math.round(pc0 + Lp * r.range(0.27, 0.33) - gw0 / 2), g1 = Math.round(pc0 + Lp * r.range(0.66, 0.72) - gw1 / 2);
  const gates = [{x: g0, w: gw0}, {x: g1, w: gw1}];
  const west = 7, cross = r.int(4, 5), yard = r.int(16, 18), east = r.int(5, 6);
  const rest = (SETTLE.x1 - SETTLE.x0) - west - cross - yard - east;
  const a = Math.floor(rest / 3) + r.int(-1, 1), b = Math.floor(rest / 3) + r.int(-1, 1), c = rest - a - b;
  const order = r.shuffle([...MARKET_STALLS]);
  // four walk-in shops along the Market Lane (what the gates open onto), two counter-fronted ones on the Back Lane
  const front = order.slice(0, 4), back = order.slice(4);
  return {mirror, Lp, Pd, laneF, laneB, gates, mid: {west, a, cross, b, yard, c, east}, front, back, name: marketNameOf(levelSeed), salt};
}

/** The rows of a frame (canonical cells): the platform wall, the front row, the lanes, the middle row, the back row. */
export function settleRows(f: SettleFrame) {
  const bedRows = 9; // gen/stationTypes.ts SINGLE_BED_CELLS
  const p0 = SETTLE.bedY + bedRows, pw = p0 + f.Pd; // platform rows [p0, pw), its back wall row pw = the front row's back wall
  const lf0 = pw + SETTLE.rowD, m0 = lf0 + f.laneF, lb0 = m0 + SETTLE.blockD, b0 = lb0 + f.laneB;
  return {p0, pw, lf0, m0, lb0, b0, end: b0 + SETTLE.rowD};
}
