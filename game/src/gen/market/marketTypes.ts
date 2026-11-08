// Task studio-survivor-market-20261108-005807-01: THE SURVIVOR MARKET (LevelId 'market') — the shared contract between the level generator
// (gen/market), the friendly residents / traders (market/npcs) and the trade system (market/trade). A compact, calm survivor settlement the
// player's train pulls into for a pit stop: no enemies, clean air, six trader stalls, housing, a communal kitchen, a workbench corner
// (SCENERY ONLY). Written by the generator into `layout.market`; plain JSON-safe data.

/** The six trader stalls, in their fixed order (stock seeding / UI order). */
export const MARKET_STALLS = ['gun', 'medical', 'fuel', 'general', 'gear', 'scrap'] as const;
export type MarketStallId = typeof MARKET_STALLS[number];

/** A storey-local point (world x / z, absolute floor height y, its layout storey). */
export interface MarketPoint { x: number; z: number; y: number; level: number }

export interface MarketStall {
  id: MarketStallId;
  /** Its painted sign (e.g. "IRONWORKS — guns & ammo"); the trade view's title. */
  name: string;
  /** The counter's world footprint (its storey; y = floor). The trader stands behind it, the player in front. */
  counter: {x0: number; z0: number; x1: number; z1: number} & MarketPoint;
  /** Where the trader stands, and the yaw it faces the counter's front with (three.js rotation.y; forward = (-sin yaw, -cos yaw)). */
  trader: MarketPoint & {yaw: number};
  /** Where a customer stands to trade (in front of the counter, on walkable floor). */
  front: MarketPoint;
  /** The area index the stall stands in. */
  area: number;
}

/** A place a resident idles / sits / works at (walkable floor, never the trench, the parked train's footprint or a counter). */
export interface MarketSpot extends MarketPoint {
  yaw: number;
  kind: 'idle' | 'sit' | 'work' | 'cook' | 'sleep' | 'chat';
  area: number;
}

export interface MarketLayout {
  v: 1;
  /** Exactly one stall per MARKET_STALLS id. */
  stalls: MarketStall[];
  /** Resident spots (wander targets / idle posts), at least a dozen, spread over the market's storeys. */
  spots: MarketSpot[];
  /** How many wandering / idling residents live here (traders are extra, one per stall). */
  residents: number;
}
