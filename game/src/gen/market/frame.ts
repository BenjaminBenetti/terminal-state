// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's frame — the fixed dimensions of the compact settlement
// and the seeded free parameters of one station (gen/market/index.ts). Pure data.
//
// The settlement is ONE salvaged railway shed (canvas cells, 0.5 m; canonical frame: the track bed north, the settlement south; a mirrored
// station flips x when stamping):
//   - the track bed (one track) and the side platform the player's train docks at (edge N, the car 2.0 m out: playerTrainPlacement);
//   - the STALL ROW behind the platform: a band of six corrugated trader stalls (open-fronted alcoves facing the square) and two short
//     market gates through the band from the platform to the square;
//   - the MARKET SQUARE (the shed floor under the roof): communal tables, slow ceiling fans;
//   - UNDER THE DECK along the south wall (storey 0, a low soffit): the workshop corner (scenery only), the bunk room and the communal
//     kitchen; ON THE DECK (storey 1, `deckY`): the upper housing (bedrolls, tents, screens), reached by one open stair from the square.

import {Rng, hashString} from '../../core/rng';
import {MARKET_STALLS, type MarketStallId} from './marketTypes';

/** Fixed dimensions (cells unless noted). */
export const MARKET = {
  /** Canvas (cells; the layout grid is the canvas: crop origin 0, 0) and its storeys (0 = the shed floor, 1 = the housing deck). */
  canvas: {w: 96, h: 76, levels: 2},
  /** Track bed: first row, rows (one track: gen/stationTypes.ts SINGLE_BED_CELLS) and its first column. */
  bedY: 3,
  bedX: 4,
  /** The shed roof over everything (m, absolute): bed, platform, square, deck. */
  roofY: 8.2,
  /** The housing deck's floor (m); the soffit under it (deckY - SLAB) is the ceiling of the rooms below. */
  deckY: 3.3,
  /** Stall alcoves: depth (cells), ceiling (m), the opening's head (m); the market gates' ceiling / head (m). */
  stallDepth: 7,
  stallCeil: 3.0,
  stallHead: 2.6,
  gateCeil: 3.4,
  gateHead: 3.0,
  /** Deck depth (cells, rows under / on it) and the stair run's width (cells). */
  deckDepth: 10,
  stairW: 4,
  /** The square's x margin beyond the stall row's ends (cells). */
  hallMargin: 2,
} as const;

/** Seeded free parameters of one market station. */
export interface MarketFrame {
  /** Mirror the canonical frame in x (the stair / workshop east instead of west). */
  mirror: boolean;
  /** Platform length / depth (cells). */
  Lp: number;
  Pd: number;
  /** Stall alcove width (cells, interior) and the market gates' width (cells). */
  stallW: number;
  gateW: number;
  /** Square depth north of the deck (cells; the deck adds MARKET.deckDepth). */
  squareD: number;
  /** The six stalls in band order (canonical west -> east), and where the two gates sit in that sequence (slot indices 0..8). */
  order: MarketStallId[];
  gates: [number, number];
  /** Under-deck split (fractions of the deck length): workshop | bunk room | kitchen. */
  split: [number, number];
  /** The settlement's painted name (layout.name). */
  name: string;
  /** The free parameters' re-roll salt (a program that does not fit). */
  salt: number;
}

/** The market's generation seed of a level seed. */
export function marketSeed(levelSeed: number): number {
  return hashString('terminal-state:market', levelSeed >>> 0);
}

const NAME_STEMS = ['Railyard', 'Sleeper', 'Junction', 'Signal Box', 'Roundhouse', 'Turntable', 'Coupler', 'Lamp Room', 'Water Tower', 'Ballast'];
const NAME_TAILS = ['Market', 'Bazaar', 'Trading Post', 'Swap', 'Stop'];

/** The settlement's own name for a level seed (stable per seed; a campaign node's printed name replaces it on the signs). */
export function marketNameOf(levelSeed: number): string {
  const r = new Rng(hashString('terminal-state:market-name', levelSeed >>> 0));
  return `${r.pick(NAME_STEMS)} ${r.pick(NAME_TAILS)}`;
}

/** The generic level name (menus without a level seed). */
export const MARKET_GENERIC_NAME = 'Survivor Market';

/** The station's frame (salt > 0: a re-roll of the free parameters after a program that did not fit). */
export function marketFrame(levelSeed: number, salt = 0): MarketFrame {
  const r = new Rng(hashString(`market-frame:${salt}`, levelSeed >>> 0));
  const mirror = r.chance(0.5);
  const Lp = r.int(60, 64), Pd = r.int(10, 12);
  const stallW = r.int(8, 9), gateW = r.int(7, 9);
  const squareD = r.int(24, 27);
  const order = r.shuffle([...MARKET_STALLS]);
  // the gates: between stalls 2 / 3 and 4 / 5 (a stall pair west, two stalls between, a pair east), or nudged one slot
  const g0 = r.pick([2, 2, 1]), g1 = r.pick([5, 5, 6]);
  const split: [number, number] = [r.range(0.3, 0.36), r.range(0.64, 0.7)];
  return {mirror, Lp, Pd, stallW, gateW, squareD, order, gates: [g0, g1], split, name: marketNameOf(levelSeed), salt};
}
