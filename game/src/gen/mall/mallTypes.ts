// Task track3-eaton-centre-20261031 (primary): shared pure-data contracts of The Eaton's Center (LevelId 'mall', tier 2).
// Types only — written first so every lane (GEN, SHOPS, ARCH, HORDE, PROFILES, PACKAGE) and the parallel tracks (Track1 enemy
// registry, Track2 same-world track / service annexes) build against one shape. The generator (gen/mall/index.ts, lane GEN)
// fills `layout.mall`; everything else reads it.
//
// World frame (same conventions as the Office): x east, z south, y up, metres; layout.levels[i] = storey i in ONE continuous
// layout: level 0 = the subway station at the bottom of the pit; levels 1..RINGS = the retail rings (galleries around the open
// void); the glass roof spans the void above the top ring. Storey heights are real (no fake stacking): ring k floor =
// baseY[k], all rings share the void outline (a genuine opening in every ring's floor slab and ceiling).

import type {MallShopFit} from './shops';

/** Number of retail rings above the station (the user: "about six different levels"). */
export const MALL_RINGS = 6;

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
  /** HUD label ('Subway', 'Level 1' … 'Level 6'). */
  label: string;
  /** Absolute floor y of the storey. */
  baseY: number;
  /** Clear height of its galleries (m). */
  clear: number;
  role: 'station' | 'ring';
}

/** A rectangle in world metres. */
export interface MallRect { x0: number; z0: number; x1: number; z1: number }

/** The open central void (atrium): the same outline on every ring; the station floor beneath it is open to the roof. */
export interface MallVoid {
  /** Outline polygon in world metres (convex or rounded galleria; closed, clockwise). */
  outline: readonly {x: number; z: number}[];
  /** Axis-aligned bounds of the outline. */
  bounds: MallRect;
  /** Storeys whose floor slab is OPEN inside the outline (every ring). */
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

/** The glass roof over the void (barrel vault on steel arches; transparent: never an opaque shadow caster). */
export interface MallRoof {
  outline: MallRect;
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

/** layout.mall — written by lane GEN (gen/mall/index.ts). */
export interface MallInfo {
  version: 1;
  /** Named seeded layout variant ('galleria', 'oval-court', 'cross-galleria', …). */
  variant: string;
  /** Mall display name ("The Eaton's Center"). */
  name: string;
  storeys: readonly MallStorey[];
  void: MallVoid;
  /** Gallery (ring walkway) area indices per ring level. */
  galleries: readonly {level: number; areas: readonly number[]}[];
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
