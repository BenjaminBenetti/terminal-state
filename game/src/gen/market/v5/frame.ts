// Task studio-survivor-market-crevice-20261116-074419: THE SURVIVOR MARKET, layout version 5 — THE CREVICE. User: "The existing market
// feels like one big game-like box. Make it feel like people genuinely live here and survive against the odds" — an underground concrete
// crevice with a layered settlement of converted shipping containers built along BOTH sides, terraces, stairs and bridges between the
// sides, warm occupied pockets against cold concrete and a dark depth below. Fixed dimensions and the seeded free parameters. Pure data.
//
// Canonical frame (cells, 0.5 m; a mirrored station flips x when stamping), north -> south:
//   - the PLATFORM HALL: the track bed (one track, the player's train docks at the side platform: edge N, the car 2.0 m out — the
//     earlier versions' docking, unchanged) under a low concrete vault, its south wall cut by two wide GATES;
//   - THE CREVICE south of it, running north -> south, centred on the platform: a deep slot in the concrete whose two sides are STEPPED
//     TERRACES of shipping containers, each storey's walk running on the roofs of the containers below (so every storey is a ledge in
//     front of its own container row, open to the crevice above), the LOW WALKS along the bottom and the dark CHASM between them;
//     at its north end the ARRIVAL SQUARE (the crevice floor bridged solid in front of the gates, the bar's deck over its north part),
//     at its south end THE WEIR (a concrete causeway across the chasm: the communal kitchen's yard).
// Per side, from the rock outward (canonical west side; the east side mirrors it about the crevice's centre line), the container BANDS
// B3, B2, B1, B0 (storeys 3, 2, 1, 0), each a back wall column + 5 interior columns + a front wall column, every band's front wall
// standing on the column of the band below's back wall, then the LOW WALK and the chasm:
//
//   x0          x0+6        x0+12       x0+18       x0+24 x0+25..29 x0+30 ..
//   | B3 (st 3) | B2 (st 2) | B1 (st 1) | B0 (st 0) |     | low walk | chasm
//               | walk 3    | walk 2    | walk 1    |
//
// A storey's container row is broken by STAIR BAYS (the stair up to the next storey climbs along the crevice inside the band, a catwalk
// beside it on the storey above), POCKETS (a terrace, a garden, a lookout) and the shops' / homes' rock-cut BACKROOMS behind them.
// Bridges (the cooked bridge kit, gen/market/v5/bridges.ts) cross the crevice from walk to walk on storeys 1-3.

import {Rng, hashString} from '../../../core/rng';
import {MARKET_STALLS, type MarketShopId} from '../marketTypes';
import {marketNameOf} from '../frame';

/** Fixed dimensions (cells unless noted). */
export const CREVICE = {
  /** Canvas (cells; crop origin 0, 0) and storeys: 0 = the low walks / square / weir / platform, 1-3 = the terraces. */
  canvas: {w: 100, h: 134, levels: 4},
  bedY: 3,
  bedX: 4,
  /** Absolute floor of each storey (m) and a container interior's ceiling above its floor (m). */
  bases: [0, 2.95, 5.9, 8.85] as const,
  cont: 2.6,
  /** The platform hall's vault (m), the crevice's top (every open band ends there, m), the chasm's floor (m). */
  hallY: 7.2,
  topY: 19.5,
  chasmY: -6.5,
  /** A band's pitch (back wall + interior: the front wall stands on the next band's back wall column), a container's interior depth. */
  pitch: 6,
  inner: 5,
  /** Storeys of container bands per side (B0..B3). */
  bands: 4,
  /** The low walk's width (cells). */
  lowWalk: 5,
  /** Door heads (m above the storey floor): container doors, the gates. */
  doorH: 2.2,
  gateH: 2.55,
  /** A container's interior length range (cells, along the crevice) and the usual one (a 20 ft box is ~12 cells inside). */
  contLen: [8, 24] as const,
  contAvg: 12,
  /** A stair bay: its bottom landing rows and the run's rows (rise 2.95 m: two flights + landing + top landing). */
  stairFoot: 3,
  stairRun: 15,
  /** A bridge deck's width (rows: the cooked bridge kit's 2 m deck between its rails). */
  bridgeW: 4,
} as const;

/** One stair bay: the side (canonical 'W' / 'E'), the storey it climbs FROM (0..2) and its first row (canonical). */
export interface StairBay { side: 'W' | 'E'; from: 0 | 1 | 2; y: number }
/** One bridge: its storey (1..3) and first row (canonical). */
export interface BridgeBay { level: 1 | 2 | 3; y: number }

/** Seeded free parameters of one version-5 market station. */
export interface CreviceFrame {
  mirror: boolean;
  /** Platform length / depth (cells). */
  Lp: number;
  Pd: number;
  /** The chasm's width (cells), the crevice's length (rows, from the hall's south wall), the square's / the weir's / the bar deck's depth. */
  chasmW: number;
  Lc: number;
  square: number;
  weir: number;
  barD: number;
  /** Stair bays (rows: canonical), bridges. */
  stairs: StairBay[];
  bridges: BridgeBay[];
  /** The ground shops facing the square / the low walks, in order: the den's side ('W' / 'E'), the shops on each side (north -> south),
   *  the two upper shops (storey 1, near the bar). */
  denSide: 'W' | 'E';
  ground: {W: MarketShopId[]; E: MarketShopId[]};
  upper: MarketShopId[];
  /** The settlement's painted name. */
  name: string;
  salt: number;
}

/** The station's version-5 frame (salt > 0: a re-roll after a program that did not fit). */
export function creviceFrame(levelSeed: number, salt = 0): CreviceFrame {
  const r = new Rng(hashString(`market-v5-frame:${salt}`, levelSeed >>> 0));
  const mirror = r.chance(0.5);
  const Lp = r.int(60, 64), Pd = r.int(10, 12);
  const chasmW = r.int(10, 12), Lc = r.int(98, 104), square = r.int(16, 18), weir = r.int(10, 12), barD = r.int(9, 10);
  const S = CREVICE;
  // the chasm's rows (canonical, relative to the crevice's first row): [square, Lc - weir)
  const c0 = square, c1 = Lc - weir;
  const bayLen = S.stairFoot + S.stairRun;
  const denSide: 'W' | 'E' = r.chance(0.5) ? 'W' : 'E';
  // stairs: the first climb (0 -> 1) on the den's side right past its square shop (rows 1-24: the den's entry, one shop), one further
  // down the crevice on the other side (past its three square shops, rows 1-39); then 1 -> 2 and 2 -> 3 staggered down the crevice (a
  // zig-zag of stairs; the 1 -> 2 bays clear of the bar's store and the upper shop, rows 1-22 of band B1)
  const first = denSide, other: 'W' | 'E' = first === 'W' ? 'E' : 'W';
  const span = (a: number, b: number) => Math.round(a + (b - a) * r.range(0, 1));
  const stairs: StairBay[] = [
    {side: first, from: 0, y: 25},
    {side: other, from: 0, y: span(Math.max(41, c0 + 22), c1 - bayLen - 6)},
    {side: other, from: 1, y: span(24, 30)},
    {side: first, from: 1, y: span(c0 + 34, c1 - bayLen - 2)},
    {side: first, from: 2, y: span(c0 + 6, c0 + 16)},
    {side: other, from: 2, y: span(c1 - bayLen - 16, c1 - bayLen)},
  ];
  // bridges: two on the first terrace, one or two on the second, one high one; at least 10 rows apart from each other
  const bridges: BridgeBay[] = [];
  const want: [1 | 2 | 3, number, number][] = [[1, 0.22, 0.34], [1, 0.62, 0.74], [2, 0.42, 0.54], [3, 0.8, 0.9]];
  if (r.chance(0.5)) want.push([2, 0.05, 0.12]);
  for (const [level, a, b] of want) {
    for (let t = 0; t < 12; t++) {
      const y = Math.round(c0 + (c1 - c0 - S.bridgeW) * r.range(a, b));
      if (bridges.every(q => Math.abs(q.y - y) >= 10)) { bridges.push({level, y}); break; }
    }
  }
  bridges.sort((p, q) => p.y - q.y || p.level - q.level);
  const order = r.shuffle([...MARKET_STALLS]);
  // the trades a train's cargo meets first stand at the square (fuel, scrap, general, gun: what a crew hauls); medical / gear up on the
  // first terrace by the bar; seeded among those groups
  const heavy = order.filter(id => id === 'fuel' || id === 'scrap' || id === 'general' || id === 'gun');
  const upper = order.filter(id => id === 'medical' || id === 'gear');
  // the den's side carries one shop at the square, the other side three (the den takes a slot by the square)
  const ground = denSide === 'W' ? {W: heavy.slice(0, 1), E: heavy.slice(1)} : {W: heavy.slice(0, 3), E: heavy.slice(3)};
  return {mirror, Lp, Pd, chasmW, Lc, square, weir, barD, stairs, bridges, denSide, ground, upper, name: marketNameOf(levelSeed), salt};
}

/** The rows and columns of a frame (canonical cells). */
export function creviceRows(f: CreviceFrame) {
  const S = CREVICE, bedRows = 9; // gen/stationTypes.ts SINGLE_BED_CELLS
  const p0 = S.bedY + bedRows, pw = p0 + f.Pd; // platform rows [p0, pw); the hall's south wall row pw
  const z0 = pw + 1, z1 = z0 + f.Lc; // the crevice's rows [z0, z1); its south wall row z1
  const chasm0 = z0 + f.square, chasm1 = z1 - f.weir;
  // columns: centred on the platform (the bed's first platform column is bedX + TUN = 12)
  const pc0 = S.bedX + 12, pcx = pc0 + f.Lp / 2;
  const half = S.bands * S.pitch + 1 + S.lowWalk; // per side: the bands (+ B0's front wall) and the low walk
  const x0 = Math.round(pcx - f.chasmW / 2) - half; // B3's back wall (west side)
  const xc0 = x0 + half, xc1 = xc0 + f.chasmW; // the chasm's columns [xc0, xc1)
  const x1 = xc1 + half; // one past the east side's B3 back wall
  return {p0, pw, z0, z1, chasm0, chasm1, pc0, x0, xc0, xc1, x1, half, end: z1 + 1};
}
