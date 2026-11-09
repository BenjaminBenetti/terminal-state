// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): the painted names of THE SURVIVOR MARKET's six trader stalls (original,
// fictional; no real brands / franchise names) and their sign colours. Seeded per station; pure data.

import type {Rng} from '../../core/rng';
import type {SignStyle} from '../stationTypes';
import type {MarketStallId} from './marketTypes';

/** Per stall: candidate painted names, the trade line under the name, and the hand-painted board's colours / lettering. */
export const STALL_SIGNS: Readonly<Record<MarketStallId, {names: readonly string[]; trade: string; style: SignStyle}>> = {
  gun: {names: ['IRONWORKS', 'BRASS & BARREL', 'THE ARMOURY', 'LONG SHOT'], trade: 'guns & ammo', style: {bg: 0x2d3a2c, fg: 0xe8dcc0, accent: 0xb5392b, font: 'condensed'}},
  medical: {names: ['PATCH-UP', 'THE MENDING POST', 'CLEAN HANDS', 'STITCH & SPLINT'], trade: 'medicine & dressings', style: {bg: 0xe6e1d3, fg: 0x9e1f1f, accent: 0x9e1f1f, font: 'sans'}},
  fuel: {names: ['RAILHEAD FUEL', 'LAST DROP', 'THE TANK LINE', 'SIDING SUPPLY'], trade: 'fuel & train supplies', style: {bg: 0xc98a1a, fg: 0x1c1a16, accent: 0x1c1a16, font: 'condensed'}},
  general: {names: ['ODDS & ENDS', 'THE GENERAL', 'SWAP SHOP', 'PANTRY & SUNDRY'], trade: 'general store', style: {bg: 0x2f4f6a, fg: 0xf0ead8, accent: 0xd8b04a, font: 'serif'}},
  gear: {names: ['TRAIL KIT', 'THE OUTFITTER', 'PACK & STRAP', 'WEATHERPROOF'], trade: 'gear & clothing', style: {bg: 0x5a3b26, fg: 0xf1e2c4, accent: 0x9fbf5a, font: 'rounded'}},
  scrap: {names: ['SCRAPYARD', 'THE BONEYARD', 'NUTS & BOLTS', 'SALVAGE KING'], trade: 'scrap & salvage', style: {bg: 0x3b3b3b, fg: 0xf2c94c, accent: 0xf2c94c, font: 'mono'}},
  // task studio-market-bar-20261108-225231-01 (lane BAR): the upper-level bar (layout version 3): a dark-stained board, cream and amber
  bar: {names: ['THE BUFFER STOP', 'LAST ORDERS', 'THE SIGNAL BOX', 'THE ROUNDHOUSE'], trade: 'bar & beers', style: {bg: 0x3a2416, fg: 0xf3e3c3, accent: 0xe0a03a, font: 'serif'}},
};

/** A stall's painted name for this station ("IRONWORKS — guns & ammo"): the trade view's title too. */
export function stallName(id: MarketStallId, rng: Rng): string {
  const s = STALL_SIGNS[id];
  return `${rng.pick(s.names)} — ${s.trade}`;
}
