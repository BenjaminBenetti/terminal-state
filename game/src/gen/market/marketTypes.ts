// Task studio-survivor-market-20261108-005807-01: THE SURVIVOR MARKET (LevelId 'market') — the shared contract between the level generator
// (gen/market), the friendly residents / traders (market/npcs) and the trade system (market/trade). A compact, calm survivor settlement the
// player's train pulls into for a pit stop: no enemies, clean air, six trader stalls, housing, a communal kitchen, a workbench corner
// (SCENERY ONLY). Written by the generator into `layout.market`; plain JSON-safe data.

/** The six trader stalls, in their fixed order (stock seeding / UI order): every layout version places exactly these. */
export const MARKET_STALLS = ['gun', 'medical', 'fuel', 'general', 'gear', 'scrap'] as const;
/** One of the six shops (the stall ids every layout version places; the generators' shop containers). */
export type MarketShopId = typeof MARKET_STALLS[number];
/**
 * Task studio-market-bar-20261108-225231-01 (lane BAR): the bar's bartender, a stall of its own (layout version 3 only: versions 1 and 2
 * place the six above and no bar). Code that iterates a station's stalls reads layout.market.stalls (never assumes every id is present).
 */
export const BAR_STALL = 'bar' as const;
/** Every stall id there is, in the fixed order (the six, then the bar). */
export const MARKET_STALLS_ALL = [...MARKET_STALLS, BAR_STALL] as const;
export type MarketStallId = typeof MARKET_STALLS_ALL[number];
/** Whether a value is a known stall id (any version). */
export const isMarketStallId = (v: unknown): v is MarketStallId => (MARKET_STALLS_ALL as readonly unknown[]).includes(v);

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
  /**
   * Task market-rework: the surfaces its wares are displayed on (layout v2 writes them; a v1 market derives them from its counter,
   * market/wares). Absent on v1 layouts.
   */
  displays?: MarketDisplaySlot[];
}

/**
 * Task studio-market-rework-20261108-074144-01: a surface a stall shows its wares on (a counter top, a shelf board, a display table):
 * the top's centre (y = the surface height), its yaw and its size. The shop's real, owned stock is displayed there (market/wares).
 */
export interface MarketDisplaySlot extends MarketPoint {
  yaw: number;
  /** Usable width (along yaw's right axis) / depth of the surface (m). */
  w: number;
  d: number;
  /** (lane LAYOUT, layout v2) Free height above the surface (m) and the layout.props index of the fixture it belongs to. */
  clear?: number;
  host?: number;
}

/** A place a resident idles / sits / works at (walkable floor, never the trench, the parked train's footprint or a counter). */
export interface MarketSpot extends MarketPoint {
  yaw: number;
  /** ('drink', task studio-market-bar-20261108-225231-01: a bar patron's post — a stool at the bar counter or a seat at a bar table.) */
  kind: 'idle' | 'sit' | 'work' | 'cook' | 'sleep' | 'chat' | 'drink';
  area: number;
}

export interface MarketLayout {
  /**
   * 1: the first market (one salvaged shed, stall row); 2 (task studio-market-rework-20261108-074144-01): the dense container settlement.
   * A station keeps the version it was first built with (its geometry, ids and stock never reroll); unvisited markets build the newest.
   * 3 (task studio-market-bar-20261108-225231-01): version 2's settlement plus a substantial upper-level bar (its bartender a stall).
   */
  v: 1 | 2 | 3;
  /** Exactly one stall per MARKET_STALLS id (version 3: + the bar, BAR_STALL, last). */
  stalls: MarketStall[];
  /** Resident spots (wander targets / idle posts), at least a dozen, spread over the market's storeys. */
  spots: MarketSpot[];
  /** How many wandering / idling residents live here (traders are extra, one per stall). */
  residents: number;
}
