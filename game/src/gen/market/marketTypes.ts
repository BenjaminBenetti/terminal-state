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
export const TRADE_STALL_IDS = [...MARKET_STALLS_ALL, 'paint'] as const;
export type MarketStallId = typeof TRADE_STALL_IDS[number];
/** Whether a value is a known stall id (any version). */
export const isMarketStallId = (v: unknown): v is MarketStallId => (TRADE_STALL_IDS as readonly unknown[]).includes(v);

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
  /** (task studio-market-bar-20261108-225231-01, lane BAR: a 'drink' post) the seat it belongs to — the bar stool / chair (layout.props
   *  index) a patron sits on; the post itself is the clear floor beside it, facing the counter / the table. */
  seat?: number;
}

export interface MarketLayout {
  paintShop?: MarketStall;
  /**
   * 1: the first market (one salvaged shed, stall row); 2 (task studio-market-rework-20261108-074144-01): the dense container settlement.
   * A station keeps the version it was first built with (its geometry, ids and stock never reroll); unvisited markets build the newest.
   * 3 (task studio-market-bar-20261108-225231-01): version 2's settlement plus a substantial upper-level bar (its bartender a stall).
   * 4 (task studio-corpse-market-shop-20261114-031614-01): version 3 plus the corpse buyer's den (`den`; the same stalls / spots).
   * 5 (task studio-survivor-market-crevice-20261116-074419): THE CREVICE — a new settlement (gen/market/v5/) with the same six stalls, the
   * bar's bartender and the den; its geometry for the look in `crevice`.
   * 6 (task studio-market-irregular-envelope-20261116-210503-01): version 5's crevice in an IRREGULAR ENVELOPE (gen/market/v6/envelope.ts:
   * the stepped overhead, the top terrace's alcoves, the end clefts, the chasm's shelves); `crevice.envelope` says so. 7 (task
   * studio-market-irregular-settlement-20261117-003819-01): version 6 on an IRREGULAR SETTLEMENT FLOORPLAN (gen/market/v7/settlement.ts:
   * each storey's container row, terrace and the pit's edges in seeded sections); `crevice.settlement` says so.
   */
  v: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Exactly one stall per MARKET_STALLS id (version 3: + the bar, BAR_STALL, last). */
  stalls: MarketStall[];
  /** Resident spots (wander targets / idle posts), at least a dozen, spread over the market's storeys. */
  spots: MarketSpot[];
  /** How many wandering / idling residents live here (traders are extra, one per stall). */
  residents: number;
  /** (version 4, task studio-corpse-market-shop-20261114-031614-01) The corpse buyer's den. Absent on versions 1-3. */
  den?: MarketDen;
  /** (version 5, task studio-survivor-market-crevice-20261116-074419) The crevice's shape for the look (world/marketArch.ts, the crevice
   *  view): the container boxes, the bridges, the chasm. Absent on versions 1-4. */
  crevice?: MarketCrevice;
}

/**
 * Task studio-survivor-market-crevice-20261116-074419: THE CREVICE's shape (layout version 5), world metres (x / z; y absolute). Plain data
 * the look reads: which wall faces belong to which shipping container (its paint, its frame, its windows), where the bridges' decks run
 * (the cooked bridge kit draws them), the chasm (the dark depth below).
 */
export interface MarketCrevice {
  /** The crevice's top (every open band ends there; version 6: the highest overhead), the platform hall's vault, the chasm's floor (m,
   *  absolute; version 6: its deepest). */
  topY: number;
  hallY: number;
  chasmY: number;
  /** Storey floors (m) and a container's interior height (m). */
  bases: number[];
  cont: number;
  /** The chasm (storey 0, VOID). */
  chasm: {x0: number; z0: number; x1: number; z1: number};
  containers: MarketCrevContainer[];
  /** The bridge decks (storey `level`, deck at y): from walk edge to walk edge along x, `area` their storey area. */
  bridges: {x0: number; z0: number; x1: number; z1: number; y: number; level: number; area: number}[];
  /**
   * (version 6, task studio-market-irregular-envelope-20261116-210503-01) The irregular envelope (absent on version 5: its flat top at
   * topY). `sky`: the lowest overhead (every open crevice column's top is at least this; anything lower is a deck, a slab or a box);
   * `rock`: overhead surfaces at or above it are the raw rock, below it the concrete ledges / ribs / soffits; the end clefts (storey-3
   * voids into the end walls, world metres, their floor y); the top terrace's alcoves (count).
   */
  envelope?: {sky: number; rock: number; clefts: {x0: number; z0: number; x1: number; z1: number; y: number}[]; alcoves: number};
  /**
   * (version 7, task studio-market-irregular-settlement-20261117-003819-01) The irregular settlement floorplan (absent on versions 5 / 6:
   * every storey's walk one straight ribbon, the pit the `chasm` rectangle). `pit`: the pit's runs of rows (world metres; their union is
   * the chasm, `chasm` their bounds); `edges[L]`: storey L's walk edge over the drop on each world side (storey 0: the pit's edge; 1-3:
   * the band below's front plane) as runs along z, each at one x.
   */
  settlement?: {pit: {x0: number; z0: number; x1: number; z1: number}[]; edges: {W: CrevEdgeRun[]; E: CrevEdgeRun[]}[]};
}

/** (version 7) A run of one storey's walk edge along z at one x (world metres). */
export interface CrevEdgeRun { z0: number; z1: number; x: number }

/** One shipping-container box of the crevice (world metres, incl. its walls: the frame / paint / windows go on its outside). */
export interface MarketCrevContainer {
  x0: number; z0: number; x1: number; z1: number;
  /** Its storey floor (absolute) and storey. The box stands from y to y + the storey pitch (its roof is the walk above). */
  y: number;
  level: number;
  /** The side its front (the walk side: its doors / shopfront) faces. */
  face: 'N' | 'E' | 'S' | 'W';
  /** Paint (world/marketArch.ts MARKET_PAINTS index), use (gen/market/v5/carve.ts CrevUse), room area (-1: closed — a box nobody opens). */
  paint: number;
  use: string;
  area: number;
  /** Its openings in the front wall: [s0, s1] along the front (world x for N / S faces, z for E / W), head height above y; wide = a shopfront. */
  openings: {s0: number; s1: number; h: number; wide: boolean}[];
  /** Whether a rock-cut backroom lies behind it (its back wall has a door). */
  backroom: boolean;
}

/**
 * Task studio-corpse-market-shop-20261114-031614-01: THE CORPSE BUYER'S DEN (layout version 4: version 3 plus the den) — a tucked-away
 * back room off the Back Lane where a creepy buyer takes whole dead zombies down a floor chute and pays a flat price in physical Rail
 * Ties (world/corpseShop). Not a stall (no stock, no trade view): it only BUYS bodies. Ground storey (level 0).
 */
export interface MarketDen {
  /** The customer room (area index) and the buyer's sealed back room behind the booth (area index; the player never enters it). */
  area: number;
  back: number;
  /** The den's way in off the Back Lane (its door cells' world box; y = floor): the painted sign / lamp mark it from the lane. */
  door: {x0: number; z0: number; x1: number; z1: number} & MarketPoint;
  /** The floor chute (layout.props index; centre, yaw; rimY = absolute height of the hopper's rim, the mouth a body goes in at). */
  chute: MarketPoint & {prop: number; yaw: number; rimY: number};
  /** The buyer's booth (layout.props index; centre, yaw = the side facing the customer). tray: the payout spot ON THE FLOOR (y = the floor)
   *  ~0.35-0.5 m in front of the booth's front face on its centre line, a clear ~0.7 m disc: the Rail Ties pushed through the slot drop there. */
  booth: MarketPoint & {prop: number; yaw: number; tray: MarketPoint};
  /** Where the buyer stands behind the booth, facing the customer (three.js rotation.y; forward = (-sin yaw, -cos yaw)). */
  buyer: MarketPoint & {yaw: number};
  /** Where a customer stands to deal (clear floor in front of the booth, within reach of the chute). */
  front: MarketPoint;
}
