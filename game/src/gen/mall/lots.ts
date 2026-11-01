// Task mall-playtest-revision-20261031 (lane GEN): the mall's LOT FAMILIES — pure data (no three.js), the GEN -> SHOPS bridge.
//
// User (playtest, 2026-10-31): "the shops are huge ... we need more varied shop size ... a bakery shouldn't be that big, a clothing
// store should be bigger, a bookstore is kind of big ... maybe ten different sizes of lots that might appear in the mall".
//
// Every shop unit the generator carves (gen/mall/carve.ts) belongs to ONE lot family (`MallShop.lot`). A family is a genuinely
// different unit TYPE, not a size label on the same rectangle: its sales-floor width (along the frontage) / depth ranges, the shape
// / frontage kind (open counter cell, narrow-deep boutique, wide-shallow showroom, corner unit with two frontages, recessed arcade
// unit behind a vestibule, end-of-corridor unit, deep anchor ...), where it may stand (zones), its stockroom policy (none / small
// rear / rear / side / rear with a staff door onto a shared service corridor) and the PROGRAMS it suits (lane SHOPS assigns the
// program: gen/mall/shops.ts reads `MALL_LOTS[shop.lot].programs` / `lotSuits`). Small units never get a stockroom that swallows
// them: the stock policy is part of the family.
//
// Dimensions are metres of USABLE floor (walls excluded); the carver converts to 0.5 m cells and reports the real numbers on the
// MallShop record (width / depth / salesArea, backroom area id).

import type {MallProgram, MallUnitKind} from './mallTypes';

export type MallLotId =
  | 'kiosk-cell' | 'food-counter' | 'compact-square' | 'narrow-boutique' | 'wide-showroom' | 'corner-double' | 'standard-line'
  | 'recessed-arcade' | 'end-unit' | 'anchor-deep';

/** Plan shape of the unit (SHOPS' recipes key their internal layout off it, with the real sales-area rectangle). */
export type MallLotShape =
  /** tiny open cell: a counter across the front, everything within arm's reach */
  | 'cell'
  /** food stall: open counter front, a cook line behind, a small kitchen store at the rear */
  | 'counter'
  /** about square, one glazed frontage */
  | 'square'
  /** narrow frontage, long depth: one aisle / wall runs down both sides, the till at the back */
  | 'narrow-deep'
  /** long glazed frontage, shallow: displays along the back wall, a stockroom closet at one side */
  | 'wide-shallow'
  /** corner unit: two glazed frontages on two adjacent walkways (MallShop.frontages has both) */
  | 'corner'
  /** the ordinary in-line unit */
  | 'rect'
  /** set back behind a vestibule / alcove off the walkway (the recess is public floor in front of the frontage) */
  | 'recessed'
  /** closes the end of a corridor / branch: its frontage faces down the corridor */
  | 'end'
  /** big deep unit (anchor): wide entrance, departments, a large rear stockroom with a service door */
  | 'deep';

/** Stockroom policy: none / a small rear store (<= ~2.5 m) / a full rear stockroom / a side store at one end / rear + service door. */
export type MallLotStock = 'none' | 'small-rear' | 'rear' | 'side' | 'service-corridor';

/** Where a family may stand: atrium court gallery, a corridor wing, a secondary court, a corridor / branch end, a corner, the food court. */
export type MallLotZone = 'atrium' | 'corridor' | 'court' | 'end' | 'corner' | 'food';

/** Shopfront kind: open counter (no glazing), glazed with an entry span, the whole frontage glazed / open wide, two frontages. */
export type MallLotFront = 'open' | 'glazed' | 'wide' | 'two-sided';

export interface MallLotFamily {
  id: MallLotId;
  label: string;
  shape: MallLotShape;
  /** Sales floor width along the (main) frontage / depth from it (m, usable). */
  width: readonly [number, number];
  depth: readonly [number, number];
  /** Stockroom policy and its depth (rear) / width (side) range in metres ([0, 0] = none). */
  stock: MallLotStock;
  stockSize: readonly [number, number];
  front: MallLotFront;
  /** Number of shopfronts (corner units: 2). */
  frontages: 1 | 2;
  /** Recessed units: depth of the public vestibule in front of the frontage (m). */
  recess?: readonly [number, number];
  zones: readonly MallLotZone[];
  /** Suitable programs, most typical first (lane SHOPS picks among them; the program's own min size still applies). Task mall-round3-20261031
   *  (lane SHOPS, R4): 'womenswear' joins the boutique / in-line / corner / showroom / recessed / end families. */
  programs: readonly MallProgram[];
  /** Unit kinds a program in this family usually takes (census). */
  kinds: readonly MallUnitKind[];
  /** May host a service room (security / first aid / management / janitorial) or stand vacant. */
  service: boolean;
  vacant: boolean;
  /** Relative pick weight in the carver's band fill, and per-mall cap (anchors / end units are occasional). */
  weight: number;
  maxPerMall: number;
  /** Internal layout intent for lane SHOPS' recipes (one line). */
  layout: string;
}

/** The ten lot families. */
export const MALL_LOTS: Readonly<Record<MallLotId, MallLotFamily>> = {
  'kiosk-cell': {
    id: 'kiosk-cell', label: 'Kiosk cell', shape: 'cell', width: [3, 4], depth: [2.5, 3.5], stock: 'none', stockSize: [0, 0],
    front: 'open', frontages: 1, zones: ['atrium', 'corridor', 'court', 'corner'],
    programs: ['kiosk'], kinds: ['kiosk'], service: false, vacant: false, weight: 0.4, maxPerMall: 3,
    layout: 'open counter across the front (roll shutter), one back-wall rack; no stockroom, no aisle',
  },
  'food-counter': {
    id: 'food-counter', label: 'Food counter', shape: 'counter', width: [4, 6], depth: [4, 5.5], stock: 'small-rear', stockSize: [1.5, 2],
    front: 'open', frontages: 1, zones: ['food', 'court', 'atrium'],
    programs: ['food-court', 'cafe'], kinds: ['food', 'store'], service: false, vacant: true, weight: 1, maxPerMall: 6,
    layout: 'serving counter at the front, cook line / back bar behind it, a small kitchen store at the rear; seating is the common floor',
  },
  'compact-square': {
    id: 'compact-square', label: 'Compact unit', shape: 'square', width: [5.5, 7.5], depth: [5.5, 7.5], stock: 'small-rear', stockSize: [1.5, 2.5],
    front: 'glazed', frontages: 1, zones: ['atrium', 'corridor', 'court'],
    programs: ['cafe', 'phone', 'pharmacy', 'jewelry', 'optical', 'beauty', 'florist', 'pet', 'music', 'luggage', 'clinic', 'guns', 'shoes', 'womenswear'],
    kinds: ['store'], service: true, vacant: true, weight: 1.0, maxPerMall: 8,
    layout: 'till by the entry, wall runs on three sides, one centre table / gondola; a small rear store behind a staff door',
  },
  'narrow-boutique': {
    id: 'narrow-boutique', label: 'Narrow boutique', shape: 'narrow-deep', width: [4.5, 6], depth: [9, 13], stock: 'small-rear', stockSize: [2, 2.5],
    front: 'glazed', frontages: 1, zones: ['corridor', 'atrium'],
    programs: ['clothing', 'womenswear', 'shoes', 'jewelry', 'beauty', 'music', 'optical', 'guns', 'phone', 'luggage', 'pharmacy', 'toys'],
    kinds: ['store'], service: true, vacant: true, weight: 1.0, maxPerMall: 6,
    layout: 'window display at the front, wall runs down both long sides, the till and fitting / back area at the far end',
  },
  'wide-showroom': {
    id: 'wide-showroom', label: 'Wide showroom', shape: 'wide-shallow', width: [12, 17], depth: [5.5, 7.5], stock: 'side', stockSize: [2.5, 3.5],
    front: 'wide', frontages: 1, zones: ['atrium', 'corridor', 'court'],
    programs: ['electronics', 'home', 'sports', 'shoes', 'womenswear', 'toys', 'outdoors', 'arcade', 'music', 'beauty', 'pharmacy'],
    kinds: ['store'], service: false, vacant: true, weight: 1.2, maxPerMall: 4,
    layout: 'long glazed frontage, display islands parallel to it, back-wall bays; the stock closet is a side room at one end',
  },
  'corner-double': {
    id: 'corner-double', label: 'Corner unit', shape: 'corner', width: [8, 12], depth: [8, 11], stock: 'side', stockSize: [2, 3],
    front: 'two-sided', frontages: 2, zones: ['corner'],
    programs: ['clothing', 'womenswear', 'electronics', 'books', 'pharmacy', 'cafe', 'sports', 'toys', 'outdoors', 'home', 'shoes'],
    kinds: ['store'], service: false, vacant: true, weight: 1.2, maxPerMall: 3,
    layout: 'entries on two walkways, displays in the glazed corner, the till between the entries, stock behind the solid walls',
  },
  'standard-line': {
    id: 'standard-line', label: 'In-line store', shape: 'rect', width: [8, 11], depth: [9, 12.5], stock: 'service-corridor', stockSize: [2.5, 3.5],
    front: 'glazed', frontages: 1, zones: ['corridor', 'atrium', 'court'],
    programs: ['clothing', 'womenswear', 'books', 'sports', 'outdoors', 'toys', 'hardware', 'pharmacy', 'electronics', 'home', 'pet', 'arcade', 'guns', 'shoes', 'music', 'grocery'],
    kinds: ['store'], service: true, vacant: true, weight: 1.6, maxPerMall: 8,
    layout: 'gondola aisles perpendicular to the frontage, wall bays, cash wrap near the entry; a rear stockroom, staff door to the service corridor when one runs behind',
  },
  'recessed-arcade': {
    id: 'recessed-arcade', label: 'Recessed arcade unit', shape: 'recessed', width: [6, 8.5], depth: [6.5, 9.5], stock: 'small-rear', stockSize: [1.5, 2.5],
    front: 'glazed', frontages: 1, recess: [2, 3], zones: ['corridor', 'atrium'],
    programs: ['jewelry', 'optical', 'books', 'clinic', 'beauty', 'womenswear', 'music', 'guns', 'luggage', 'florist', 'phone', 'cafe'],
    kinds: ['store'], service: true, vacant: true, weight: 0.8, maxPerMall: 3,
    layout: 'a small public vestibule (window bays on both sides) leads to the door; inside a counter / cases layout; small rear store',
  },
  'end-unit': {
    id: 'end-unit', label: 'Corridor end unit', shape: 'end', width: [10, 15], depth: [10, 15], stock: 'service-corridor', stockSize: [3, 4],
    front: 'wide', frontages: 1, zones: ['end'],
    programs: ['books', 'clothing', 'womenswear', 'sports', 'arcade', 'toys', 'home', 'outdoors', 'grocery', 'electronics', 'hardware', 'department'],
    kinds: ['store', 'anchor'], service: false, vacant: true, weight: 1, maxPerMall: 3,
    layout: 'faces straight down the corridor (a focal display on the axis), departments either side of a centre aisle, rear stockroom + service door',
  },
  'anchor-deep': {
    id: 'anchor-deep', label: 'Anchor store', shape: 'deep', width: [17, 24], depth: [15, 20], stock: 'service-corridor', stockSize: [4, 5],
    front: 'wide', frontages: 1, zones: ['end', 'corridor', 'court'],
    programs: ['department', 'grocery', 'home', 'sports', 'outdoors', 'hardware', 'electronics'],
    kinds: ['anchor'], service: false, vacant: false, weight: 0.6, maxPerMall: 2,
    layout: 'wide entrance, departments around a main aisle loop, checkouts / service desk by the entry, a large rear stockroom with a service door',
  },
};

export const MALL_LOT_IDS = Object.keys(MALL_LOTS) as MallLotId[];

/** The family record of a lot id (undefined for an unknown id). */
export function mallLot(id: string | undefined): MallLotFamily | undefined {
  return id ? (MALL_LOTS as Record<string, MallLotFamily>)[id] : undefined;
}

/** Does `program` suit lot family `id`? Service rooms / vacancy follow the family flags; kiosks only the kiosk cell. */
export function lotSuits(id: MallLotId | undefined, program: MallProgram): boolean {
  const f = mallLot(id);
  if (!f) return true;
  if (program === 'service') return f.service;
  if (program === 'vacant') return f.vacant;
  return f.programs.includes(program);
}

/** Lot families suiting a program (the program <-> family table, in registry order). */
export function lotsForProgram(program: MallProgram): MallLotId[] {
  return MALL_LOT_IDS.filter(id => lotSuits(id, program));
}

/** Usable sales area range (m²) of a family. */
export function lotAreaRange(id: MallLotId): [number, number] {
  const f = MALL_LOTS[id];
  return [f.width[0] * f.depth[0], f.width[1] * f.depth[1]];
}
