// Task track3-eaton-centre-20261031 (primary): shared pure-data contracts of the mall (LevelId 'mall', tier 2).
// Task mall-playtest-revision-20261031 (lane GEN): station + THREE retail floors, a small irregular atrium (per-floor openings,
// nested and widening upward), corridor wings / loops, lot families (MallShop.lot), a seeded "<Name> Center" display name.
// Types only — written first so every lane (GEN, SHOPS, ARCH, HORDE, PROFILES, PACKAGE) and the parallel tracks (Track1 enemy
// registry, Track2 same-world track / service annexes) build against one shape. The generator (gen/mall/index.ts, lane GEN)
// fills `layout.mall`; everything else reads it.
//
// World frame (same conventions as the Office): x east, z south, y up, metres; layout.levels[i] = storey i in ONE continuous
// layout: level 0 = the subway station at the bottom of the atrium; levels 1..MALL_FLOORS = the retail floors (MallStorey.role
// 'ring' is kept as the retail-storey role id); the glass roof spans the TOP atrium opening. Storey heights are real (no fake
// stacking): floor k = baseY[k]. The atrium opening grows floor by floor (void.openings): the floor-1 opening (void.outline) is open
// on every retail floor and over the station (the station-to-sky column).

import type {MallShopFit} from './shops';
import type {MallLotId, MallLotStock, MallLotZone} from './lots';

/** Number of retail floors above the station (playtest revision: about half the old height — was six rings). */
export const MALL_FLOORS = 3;
/** Back-compat alias of MALL_FLOORS (the retail storeys were "rings" in Track3). */
export const MALL_RINGS = MALL_FLOORS;

/** Shop programs (theme of a unit: dressing, materials, loot purpose, signage). Fictional brands only. */
export type MallProgram =
  | 'guns' | 'outdoors' | 'pharmacy' | 'clinic' | 'electronics' | 'phone' | 'hardware' | 'clothing' | 'shoes' | 'department'
  | 'food-court' | 'cafe' | 'grocery' | 'books' | 'toys' | 'sports' | 'jewelry' | 'home' | 'beauty' | 'music' | 'pet'
  | 'arcade' | 'luggage' | 'optical' | 'florist' | 'kiosk' | 'service' | 'vacant';

/** What a retail unit is (census distinguishes real stores from kiosks / service rooms). */
export type MallUnitKind = 'store' | 'anchor' | 'food' | 'kiosk' | 'service' | 'vacant';

export interface MallStorey {
  /** layout.levels index (0 = station). */
  level: number;
  /** HUD label ('Subway', 'Level 1' … 'Level 3'). */
  label: string;
  /** Absolute floor y of the storey. */
  baseY: number;
  /** Clear height of its galleries (m). */
  clear: number;
  /** 'station' = level 0; 'ring' = a retail floor (id kept from Track3). */
  role: 'station' | 'ring';
}

/** A rectangle in world metres. */
export interface MallRect { x0: number; z0: number; x1: number; z1: number }

/** The atrium opening in ONE retail floor's slab (lane GEN, playtest revision). */
export interface MallOpening {
  level: number;
  /** Closed clockwise rectilinear polygon (world metres) of the opening's outer boundary. */
  outline: readonly {x: number; z: number}[];
  bounds: MallRect;
  /** Open area (m²). */
  area: number;
}

/**
 * The atrium: `outline` / `bounds` = the floor-1 opening (open on EVERY retail floor and over the station: the station-to-sky
 * column; the station floor beneath it is open to the roof). Upper floors' openings are larger (nested, stepped / offset per
 * variant): `openings` (one per retail floor, bottom-up); the glass roof sits over the top one (MallRoof.polygon).
 */
export interface MallVoid {
  /** Outline polygon in world metres (rectilinear, irregular; closed, clockwise) — the floor-1 opening. */
  outline: readonly {x: number; z: number}[];
  /** Axis-aligned bounds of the outline. */
  bounds: MallRect;
  /** Per retail floor opening (nested: openings[k] contains openings[k-1]); absent in Track3-shaped fixtures. */
  openings?: readonly MallOpening[];
  /** Storeys whose floor slab is OPEN inside the outline (every retail floor). */
  openLevels: readonly number[];
  /** The storey whose floor is the bottom of the pit (0: the station / its plaza). */
  floorLevel: number;
  /** y of the roof glazing springing line / apex above the void. */
  roofSpringY: number;
  roofApexY: number;
}

/** One retail unit (shop / anchor / food unit / kiosk / service room). */
export interface MallShop {
  /** Stable id within the layout ('L3-E05'). */
  id: string;
  /** layout.areas index of the sales floor. */
  area: number;
  /** Back-of-house area index (stock room), if any. */
  backroom?: number;
  level: number;
  program: MallProgram;
  kind: MallUnitKind;
  /** Fictional brand / display name ("Northline Outfitters"). */
  brand: string;
  /** Shopfront opening onto the gallery (world metres) and the side of the unit it is on. */
  frontage: MallRect & {side: 'N' | 'S' | 'E' | 'W'};
  /** Usable sales floor (m², walkable cells) and depth from the frontage (m). */
  salesArea: number;
  depth: number;
  width: number;
  /** Lot family (gen/mall/lots.ts MALL_LOTS) — always set by the generator; optional only for synthetic fixtures. */
  lot?: MallLotId;
  /** Where the unit stands (atrium court gallery, corridor wing, secondary court, corridor end, corner, food court). */
  zone?: MallLotZone;
  /** Every shopfront (corner units: two; frontage = the first / main one). */
  frontages?: readonly (MallRect & {side: 'N' | 'S' | 'E' | 'W'})[];
  /** Stockroom policy actually built (the family's, downgraded when no room / corridor) and its usable area (m², 0 = none). */
  stock?: MallLotStock;
  stockArea?: number;
  /** A staff door from the stockroom onto a service corridor exists. */
  serviceDoor?: boolean;
  /** Recessed units: the public vestibule area in front of the shopfront. */
  recess?: number;
  /** Lane SHOPS' fit-out (recipe, finish, sign, front, shutter, entry span), attached by assignMallPrograms. */
  fit?: MallShopFit;
}

/** A walkway crossing the void at one storey. */
export interface MallBridge {
  level: number;
  /** Area index of the bridge deck. */
  area: number;
  from: {x: number; z: number};
  to: {x: number; z: number};
  width: number;
}

/** A physical vertical connection (all are real geometry in the one world: no travel / fade / teleport). */
export interface MallVerticalLink {
  kind: 'escalator' | 'stair' | 'elevator' | 'service-stair';
  lower: number;
  upper: number;
  /** layout.levelLinks id (stairs / escalators) or the elevator index into `elevators`. */
  link?: number;
  /** Foot / head stand points (world metres, absolute y). */
  foot: {x: number; y: number; z: number};
  head: {x: number; y: number; z: number};
}

/** A glass elevator (the Office ElevatorLogic multi-stop cab, glass variant), serving `stops`. */
export interface MallElevator {
  cab: MallRect;
  shaft: MallRect;
  stops: readonly {level: number; y: number}[];
  glass: true;
}

/** The glass roof over the TOP atrium opening (glazed vault on steel arches; transparent: never an opaque shadow caster). */
export interface MallRoof {
  /** Bounds of the glazed opening (= bounds of `polygon`). */
  outline: MallRect;
  /** The glazed outline (world metres): the top floor's atrium opening — glass only over the atrium (lane ARCH renders it). */
  polygon?: readonly {x: number; z: number}[];
  springY: number;
  apexY: number;
  /** Arch spacing (m) of the steel trusses. */
  archSpacing: number;
}

/** Horde patrol route graph (lane HORDE reads it): nodes on galleries / bridges / vertical-link ends, edges walkable. */
export interface MallPatrolNode {
  id: number;
  level: number;
  x: number;
  z: number;
  /** Neighbour node ids (walkable, incl. vertical links which carry `via`). */
  edges: readonly {to: number; via?: 'escalator' | 'stair' | 'bridge' | 'gallery' | 'service'}[];
}

/** Wayfinding of one storey for directories / level signs (lane ARCH renders it): shops, links, the way back to the station. */
export interface MallWayfinding {
  level: number;
  label: string;
  /** layout.mall.shops ids on this storey (brands / programs from the shop records once lane SHOPS filled them). */
  shops: readonly string[];
  /** Vertical links leaving this storey: kind, other storey, stand point on THIS storey, index into MallInfo.verticals. */
  links: readonly {kind: MallVerticalLink['kind']; to: number; at: {x: number; z: number}; vertical: number}[];
  /** Public way down to the station from this storey's atrium court: one step per storey (escalator / stair / elevator). */
  stationReturn: readonly {kind: MallVerticalLink['kind']; from: number; to: number; at: {x: number; z: number}; vertical: number}[];
}

/**
 * Track2 contract — the mall's SUBWAY ROOT: where same-world walkable track extensions / service annexes attach to the mall's
 * station (level 0). Stable for a seed; Track2 must not need any other mall knowledge to attach.
 */
export interface SubwayRootAnchor {
  /** Always 'mall' here; same shape for every level that has a subway root. */
  level: 'mall';
  /** layout.levels index of the station storey (0). */
  storey: number;
  /** Station floor y (platform top). */
  platformY: number;
  /** Track bed floor y. */
  trackBedY: number;
  /** Platform area indices. */
  platforms: readonly number[];
  /**
   * Tunnel mouths at the ends of each track bed: where a walkable extension continues the bed / a service annex door may open.
   * `axis` = the track direction leaving the station through this mouth.
   */
  tunnelMouths: readonly {id: string; x: number; z: number; width: number; height: number; axis: 'x+' | 'x-' | 'z+' | 'z-'; trackBed: number}[];
  /** Volumes an annex must keep clear (pit void column, escalators, plaza). */
  keepClear: readonly MallRect[];
}

/** layout.mall — written by lane GEN (gen/mall/index.ts). version 2 = the playtest revision (station + 3 floors). */
export interface MallInfo {
  version: 1 | 2;
  /** Named seeded layout variant ('terrace-cross', 'arcade-loop', 'elbow-branch'). */
  variant: string;
  /** Seeded display name ("Harbourline Center": gen/mall/names.ts mallNameOf(levelSeed)); also layout.name. */
  name: string;
  storeys: readonly MallStorey[];
  void: MallVoid;
  /** PUBLIC walkway area indices per retail floor: the atrium court galleries AND the corridor wings / courts. */
  galleries: readonly {level: number; areas: readonly number[]}[];
  /** Subsets of `galleries`: the atrium court's gallery areas / the corridor-wing + secondary-court areas, per retail floor. */
  courts?: readonly {level: number; areas: readonly number[]}[];
  corridors?: readonly {level: number; areas: readonly number[]}[];
  /** Service corridors (staff) per storey. */
  service?: readonly {level: number; areas: readonly number[]}[];
  /** Directory / wayfinding data per storey (station included). */
  wayfinding?: readonly MallWayfinding[];
  shops: readonly MallShop[];
  bridges: readonly MallBridge[];
  verticals: readonly MallVerticalLink[];
  elevators: readonly MallElevator[];
  roof: MallRoof;
  patrol: readonly MallPatrolNode[];
  subwayRoot: SubwayRootAnchor;
  /** Player start (station platform, level 0) = layout.playerSpawn. */
  start: {x: number; z: number; yaw: number; level: number};
}
