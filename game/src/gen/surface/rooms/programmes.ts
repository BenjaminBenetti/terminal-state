// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the SURFACE RUN building PROGRAMMES — the exact programme ids the
// interior planner (gen/surface/rooms/index.ts planInterior) implements, with the footprint / storey / doorway needs GEN (gen/surface/
// city*.ts) reads when it assigns programmes to enterable buildings (SurfaceBuilding.programme / kind). Pure data, no three.js.
//
// GEN's district guarantees (lane brief): per district >= 1 'rail-depot', >= 2 small shopping centres ('strip-centre' / 'arcade-centre'),
// >= 3 'office', >= 8 stores of >= 6 different store programmes. Civic programmes ('police', 'fire-station', 'clinic') are optional.
//
// Sizes are the building's OUTER wall footprint in metres (the facade ring included): `frontage` = along the facade of its MAIN entrance,
// `depth` = away from it. A plot smaller than `min` still plans (fewer / smaller rooms), never fails; `upper` is the smallest footprint
// (frontage x depth, m) in which the planner fits a stair core, so storeys above the street are carved only there (a plot below it keeps
// its street storey only: SurfaceBuilding.levels then lists level 0 alone — GEN reads InteriorPlan.areas' levels).
//
// Doorways: `door` = the clear width (m) of the MAIN entrance GEN cuts on the street side (shopfront doors 1.5-2.5 m, the depot's roller
// door >= 4.5 m so a dolly + its cargo and the truck's tail meet there); `service` = a back / side door GEN may add (any side but the main
// one; the planner opens it into a back-of-house room).

import type {SurfaceBuildingKind} from '../surfaceTypes';

export type SurfaceProgrammeId =
  // stores
  | 'grocery' | 'pharmacy' | 'hardware' | 'clothing' | 'electronics' | 'convenience' | 'liquor' | 'sporting' | 'gunstore' | 'bookstore' | 'diner'
  // small shopping centres
  | 'strip-centre' | 'arcade-centre'
  // offices
  | 'office'
  // the train-repair depot
  | 'rail-depot'
  // civic (optional)
  | 'police' | 'fire-station' | 'clinic';

export interface SurfaceProgramme {
  id: SurfaceProgrammeId;
  /** SurfaceBuilding.kind GEN writes for it. */
  kind: SurfaceBuildingKind;
  /** Generic label (map legend / HUD fallback). */
  label: string;
  /** Outer footprint (m): [min, max] along the main facade and away from it. */
  frontage: readonly [number, number];
  depth: readonly [number, number];
  /** Interior storeys GEN may give it (inclusive; 1 = street storey only). */
  storeys: readonly [number, number];
  /** Smallest footprint (frontage x depth, m) that takes upper storeys (a stair core fits). */
  upper: readonly [number, number];
  /** Main entrance clear width (m) and an optional service door (m). */
  door: number;
  service?: number;
  /** Fictional sign / map names (GEN picks one per building, seeded; never a real brand). */
  names: readonly string[];
  /** Relative pick weight among the programmes of its kind. */
  weight: number;
}

/** Recommended floor-to-floor height (m) and clear ceiling of an interior storey (GEN's InteriorFloor y / ceil). */
export const SURFACE_STOREY = {height: 4.0, clear: 3.4, groundClear: 3.6} as const;

const P = (p: SurfaceProgramme): SurfaceProgramme => p;

export const SURFACE_PROGRAMMES: readonly SurfaceProgramme[] = [
  // --- stores ---------------------------------------------------------------------------------------------------------------
  P({id: 'grocery', kind: 'store', label: 'Grocery store', frontage: [22, 42], depth: [20, 36], storeys: [1, 1], upper: [99, 99], door: 2.5, service: 3,
    names: ['Halsey Market', 'Corner Fresh Grocers', 'Calder Food Hall', 'Greenway Grocery', 'Lindqvist Market'], weight: 1.2}),
  P({id: 'pharmacy', kind: 'store', label: 'Pharmacy', frontage: [12, 22], depth: [14, 26], storeys: [1, 2], upper: [14, 22], door: 2, service: 1.5,
    names: ['Halsey Drugs', 'Corner Chemist', 'Marlow Pharmacy', 'Wellbrook Apothecary', 'Northgate Rx'], weight: 1.2}),
  P({id: 'hardware', kind: 'store', label: 'Hardware store', frontage: [16, 34], depth: [18, 34], storeys: [1, 2], upper: [16, 22], door: 2.5, service: 3,
    names: ['Halsey Hardware', 'Bolt & Beam', 'Fenwick Tools', 'Ironside Supply', 'Calder Home & Hardware'], weight: 1}),
  P({id: 'clothing', kind: 'store', label: 'Clothing store', frontage: [12, 24], depth: [14, 28], storeys: [1, 2], upper: [14, 22], door: 2, service: 1.5,
    names: ['Threadline', 'Marlow & Daughters', 'Northern Outfit Co.', 'Second Stitch', 'Pinewood Apparel'], weight: 1}),
  P({id: 'electronics', kind: 'store', label: 'Electronics store', frontage: [12, 22], depth: [14, 26], storeys: [1, 2], upper: [14, 22], door: 2, service: 1.5,
    names: ['Voltage Electronics', 'Circuit Corner', 'Halsey TV & Radio', 'Brightwave', 'Calder Electric'], weight: 1}),
  P({id: 'convenience', kind: 'store', label: 'Convenience store', frontage: [8, 16], depth: [10, 20], storeys: [1, 1], upper: [99, 99], door: 1.5, service: 1.5,
    names: ['QuikStop', 'Corner Mart', '24/7 Grab & Go', 'Northside Variety', 'Sunrise Convenience'], weight: 1.2}),
  P({id: 'liquor', kind: 'store', label: 'Liquor store', frontage: [8, 16], depth: [12, 20], storeys: [1, 1], upper: [99, 99], door: 1.5, service: 1.5,
    names: ['Barrel & Bottle', 'Calder Wine & Spirits', 'The Cellar Door', 'Harbour Liquor'], weight: 0.8}),
  P({id: 'sporting', kind: 'store', label: 'Sporting goods', frontage: [14, 26], depth: [16, 30], storeys: [1, 2], upper: [16, 22], door: 2, service: 1.5,
    names: ['Summit Sports', 'Trailhead Outfitters', 'Fieldhouse Sporting Goods', 'Northern Pursuit'], weight: 0.9}),
  P({id: 'gunstore', kind: 'store', label: 'Gun shop', frontage: [10, 18], depth: [14, 24], storeys: [1, 1], upper: [99, 99], door: 1.5, service: 1.5,
    names: ['Ridgeline Arms', 'Calder Firearms', 'Iron Sight Gun Shop', 'Halsey Sporting Arms'], weight: 0.6}),
  P({id: 'bookstore', kind: 'store', label: 'Bookstore & café', frontage: [12, 22], depth: [14, 26], storeys: [1, 2], upper: [14, 22], door: 2, service: 1.5,
    names: ['Inkwell Books', 'The Page Turner', 'Marlow Books & Coffee', 'Second Chapter'], weight: 0.9}),
  P({id: 'diner', kind: 'store', label: 'Diner', frontage: [12, 22], depth: [14, 24], storeys: [1, 1], upper: [99, 99], door: 2, service: 1.5,
    names: ['Rosie\'s Diner', 'The Blue Plate', 'Calder Grill', 'Midway Diner', 'Lucky Star Diner'], weight: 1}),
  // --- small shopping centres ---------------------------------------------------------------------------------------------------
  P({id: 'strip-centre', kind: 'centre', label: 'Shopping centre', frontage: [28, 42], depth: [16, 26], storeys: [1, 1], upper: [99, 99], door: 3, service: 1.5,
    names: ['Halsey Plaza', 'Calder Court Shops', 'Northgate Centre', 'Marlow Square'], weight: 1}),
  P({id: 'arcade-centre', kind: 'centre', label: 'Shopping arcade', frontage: [24, 42], depth: [22, 40], storeys: [2, 2], upper: [22, 22], door: 3, service: 1.5,
    names: ['The Arcade', 'Calder Galleria', 'Lindqvist Arcade', 'Union Arcade'], weight: 1}),
  // --- offices --------------------------------------------------------------------------------------------------------------
  P({id: 'office', kind: 'office', label: 'Office building', frontage: [18, 34], depth: [18, 32], storeys: [2, 3], upper: [18, 18], door: 2.5, service: 1.5,
    names: ['Calder House', 'Halsey Building', 'Northgate Offices', 'Marlow Chambers', 'Union Trust Building', 'Fenwick Tower'], weight: 1}),
  // --- the train-repair depot ----------------------------------------------------------------------------------------------
  P({id: 'rail-depot', kind: 'depot', label: 'Train-repair depot', frontage: [32, 42], depth: [28, 42], storeys: [1, 2], upper: [32, 28], door: 5, service: 1.5,
    names: ['Calder Street Rail Depot', 'Halsey Yard Maintenance Shed', 'Northgate Car Shop', 'Union Rail Works'], weight: 1}),
  // --- civic (optional) -----------------------------------------------------------------------------------------------------
  P({id: 'police', kind: 'civic', label: 'Police station', frontage: [18, 30], depth: [18, 30], storeys: [1, 2], upper: [18, 18], door: 2, service: 1.5,
    names: ['14th Precinct', 'Calder Police Station', 'Central Division Police'], weight: 0.6}),
  P({id: 'fire-station', kind: 'civic', label: 'Fire station', frontage: [18, 30], depth: [20, 30], storeys: [1, 2], upper: [18, 20], door: 4.5, service: 1.5,
    names: ['Fire Station No. 7', 'Engine Company 12', 'Calder Fire Hall'], weight: 0.5}),
  P({id: 'clinic', kind: 'civic', label: 'Walk-in clinic', frontage: [14, 26], depth: [16, 28], storeys: [1, 2], upper: [16, 20], door: 2, service: 1.5,
    names: ['Calder Walk-in Clinic', 'Halsey Family Medical', 'Northgate Health Centre'], weight: 0.6}),
];

export const SURFACE_PROGRAMME_IDS: readonly SurfaceProgrammeId[] = SURFACE_PROGRAMMES.map(p => p.id);
const BY_ID = new Map<string, SurfaceProgramme>(SURFACE_PROGRAMMES.map(p => [p.id, p]));
export const isSurfaceProgramme = (id: string): id is SurfaceProgrammeId => BY_ID.has(id);
/** The programme record (undefined for an id the planner does not implement: it then plans a plain room per storey). */
export const surfaceProgramme = (id: string): SurfaceProgramme | undefined => BY_ID.get(id);
/** Store programmes (GEN's ">= 8 stores of >= 6 programmes" pool). */
export const SURFACE_STORE_PROGRAMMES: readonly SurfaceProgrammeId[] = SURFACE_PROGRAMMES.filter(p => p.kind === 'store').map(p => p.id);
