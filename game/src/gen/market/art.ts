// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's dynamic / decorative pieces DERIVED from the finished
// layout (pure, deterministic; nothing is stored in the layout): the slow ceiling fans and the stall awnings that world/marketVisuals.ts
// draws. Both are visual only — high above every walking body (fan blades >= 2.6 m, awning low edges >= 2.4 m) and never in a doorway's
// clear volume (gen/doorways.ts DOOR_CLEAR: <= 2.1 m) — so collision / navigation never needs them.

import {CELL} from '../grid';
import type {StationLayout} from '../stationTypes';
import {MARKET} from './frame';
import {settleAwnings, settleFans} from './v2/art';

/** A ceiling fan: hub centre (world), blade radius, the rod up to the ceiling, its storey and spin (rad / s; slow). */
export interface MarketFan { x: number; y: number; z: number; r: number; rod: number; level: number; speed: number; phase: number }
/** A stall awning: a sloped canvas from the wall over a stall opening (world: x span, the wall line z, its outward depth, heights). */
export interface MarketAwning {
  x0: number; x1: number; z: number; depth: number; yWall: number; yEdge: number; stall: string;
  /** Task studio-market-rework-20261108-074144-01: the direction (z) the canvas reaches out from the wall (layout version 2); absent = +1. */
  dir?: 1 | -1;
}

/** Fan / awning dimensions (m). */
export const MARKET_ART = {
  fan: {r: 0.62, hubDrop: 0.32, minBlade: 2.6, spin: [0.9, 1.4] as const},
  awning: {depth: 1.25, drop: 0.3, over: 0.3, belowSign: 0.32},
} as const;

const hash = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
};

/** The fans of a market layout: a row down the square under the roof, one per under-deck room (under the soffit), two over the deck. */
export function marketFans(layout: StationLayout): MarketFan[] {
  if (!layout.market) return [];
  if (layout.market.v >= 2) return settleFans(layout); // (task studio-market-rework-20261108-074144-01: the container settlement's; + version 3)
  const out: MarketFan[] = [];
  const F = MARKET_ART.fan;
  const add = (x: number, z: number, ceil: number, level: number, hang: number) => {
    const y = Math.max(ceil - hang, (level ? MARKET.deckY : 0) + F.minBlade);
    const k = out.length;
    out.push({x: r3(x), y: r3(y), z: r3(z), r: F.r, rod: r3(ceil - y), level, speed: r3(F.spin[0] + (F.spin[1] - F.spin[0]) * hash(layout.seed, k)), phase: r3(hash(k, layout.seed) * Math.PI * 2)});
  };
  const sq = layout.areas.find(a => a.label === 'Market square' && !a.level);
  const deck = layout.areas.find(a => a.level === 1 && a.kind === 'concourse');
  if (sq) {
    // the square: between the pendant rows, a fan every ~8 m (clear of the stair run's roof band and the stall aisle's signs)
    const z = (sq.y + sq.h * 0.5) * CELL, n = Math.max(2, Math.round(sq.w * CELL / 8));
    for (let i = 0; i < n; i++) add((sq.x + sq.w * (i + 0.5) / n) * CELL, z, sq.ceil, 0, 2.2);
  }
  for (const a of layout.areas) {
    if ((a.level ?? 0) !== 0 || a.kind !== 'room' || a.type === 'shop') continue; // the rooms under the deck
    add((a.x + a.w * 0.68) * CELL, (a.y + a.h * 0.25) * CELL, a.ceil, 0, MARKET_ART.fan.hubDrop); // (the front half, off-centre: clear of the room's lamp row and its hanging name board)
  }
  if (deck) for (const t of [0.3, 0.72]) add((deck.x + deck.w * t) * CELL, (deck.y + deck.h * 0.55) * CELL, deck.ceil, 1, 1.4); // (above the deck's lamps)
  return out;
}

/** The awnings: one over every stall opening (layout.market.stalls), on the square side of the stall row's front wall. */
export function marketAwnings(layout: StationLayout): MarketAwning[] {
  const m = layout.market;
  if (!m) return [];
  if (m.v >= 2) return settleAwnings(layout); // (task studio-market-rework-20261108-074144-01: the container settlement's; + version 3)
  const A = MARKET_ART.awning;
  const out: MarketAwning[] = [];
  for (const s of m.stalls) {
    const a = layout.areas[s.area];
    if (!a) continue;
    const z = (a.y + a.h + 1) * CELL; // the square side of the front wall (the opening row is a.y + a.h)
    const yWall = MARKET.stallHead + 0.45 - A.belowSign;
    out.push({x0: r3((a.x + 1) * CELL - A.over), x1: r3((a.x + a.w - 1) * CELL + A.over), z: r3(z), depth: A.depth, yWall: r3(yWall), yEdge: r3(yWall - A.drop), stall: s.id});
  }
  return out;
}

function r3(v: number): number { return Math.round(v * 1000) / 1000; }
