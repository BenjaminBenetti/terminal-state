// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the SURFACE RUN building PROGRAMMES — the exact programme ids the
// interior planner (gen/surface/rooms/index.ts planInterior) implements, with the footprint / storey / doorway needs GEN (gen/surface/
// city*.ts) reads when it assigns programmes to enterable buildings (SurfaceBuilding.programme / kind). Pure data, no three.js.
//
// The ids are GEN's own (gen/surface/cityBlocks.ts STORE_PROGRAMMES, centreItem / officeItem / civicItem, the depot): stores 'grocery',
// 'pharmacy', 'hardware', 'clothing', 'electronics', 'convenience', 'liquor', 'sporting-goods', 'bookstore', 'cafe', 'diner' (+ 'gunstore',
// planned when GEN ever lists it); centres 'strip-centre', 'arcade'; 'office-block'; 'rail-depot'; civic 'police', 'fire-station',
// 'clinic'. A few older spellings resolve through SURFACE_PROGRAMME_ALIASES; an id the planner does not know falls back by the
// building's kind (resolveProgramme), so every enterable building still gets a programme-shaped interior.
//
// GEN's district guarantees: per district >= 1 'rail-depot', >= 2 small shopping centres, >= 3 offices, >= 8 stores of >= 6 store
// programmes; civic 0-2. Sizes are the building's OUTER wall footprint in metres (the facade ring included): `frontage` = along the facade
// of its MAIN entrance, `depth` = away from it. A plot smaller than the minimum still plans (fewer / smaller rooms), never fails; upper
// storeys are carved only where a stair core fits (`upper`: the smallest frontage x depth that takes one) — a plot below it keeps its
// street storey only (SurfaceBuilding.levels then lists level 0 alone: GEN reads the plan's area levels).
//
// Doorways: `door` = the clear width (m) of the MAIN entrance GEN cuts on the street side; the depot's track door is the roller door
// (>= 4.5 m) and its loading-bay door (>= 4.5 m) is where the truck backs up; `service` = a back / side door GEN may add on any other
// exposed side (the planner opens it into a back-of-house room).

import type {SurfaceBuildingKind} from '../surfaceTypes';

export type SurfaceProgrammeId =
  // stores
  | 'grocery' | 'pharmacy' | 'hardware' | 'clothing' | 'electronics' | 'convenience' | 'liquor' | 'sporting-goods' | 'gunstore' | 'bookstore'
  | 'cafe' | 'diner'
  // small shopping centres
  | 'strip-centre' | 'arcade'
  // offices
  | 'office-block'
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
  /** Walkable storeys the planner handles (inclusive; 1 = street storey only). */
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

/** Recommended floor-to-floor heights (m) of an interior storey (GEN's InteriorFloor y / ceil come from its own building shape). */
export const SURFACE_STOREY = {height: 4.0, clear: 3.4, groundClear: 3.6} as const;

const P = (p: SurfaceProgramme): SurfaceProgramme => p;

export const SURFACE_PROGRAMMES: readonly SurfaceProgramme[] = [
  // --- stores ---------------------------------------------------------------------------------------------------------------
  P({id: 'grocery', kind: 'store', label: 'Grocery store', frontage: [22, 48], depth: [20, 36], storeys: [1, 2], upper: [22, 20], door: 3, service: 1.5,
    names: ['Halsey Market', 'Corner Fresh Grocers', 'Calder Food Hall', 'Greenway Grocery', 'Lindqvist Market'], weight: 1.2}),
  P({id: 'pharmacy', kind: 'store', label: 'Pharmacy', frontage: [14, 30], depth: [16, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Halsey Drugs', 'Corner Chemist', 'Marlow Pharmacy', 'Wellbrook Apothecary', 'Northgate Rx'], weight: 1.2}),
  P({id: 'hardware', kind: 'store', label: 'Hardware store', frontage: [20, 42], depth: [20, 34], storeys: [1, 2], upper: [20, 20], door: 3, service: 1.5,
    names: ['Halsey Hardware', 'Bolt & Beam', 'Fenwick Tools', 'Ironside Supply', 'Calder Home & Hardware'], weight: 1}),
  P({id: 'clothing', kind: 'store', label: 'Clothing store', frontage: [16, 34], depth: [16, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Threadline', 'Marlow & Daughters', 'Northern Outfit Co.', 'Second Stitch', 'Pinewood Apparel'], weight: 1}),
  P({id: 'electronics', kind: 'store', label: 'Electronics store', frontage: [16, 32], depth: [16, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Voltage Electronics', 'Circuit Corner', 'Halsey TV & Radio', 'Brightwave', 'Calder Electric'], weight: 1}),
  P({id: 'convenience', kind: 'store', label: 'Convenience store', frontage: [10, 30], depth: [12, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['QuikStop', 'Corner Mart', '24/7 Grab & Go', 'Northside Variety', 'Sunrise Convenience'], weight: 1.2}),
  P({id: 'liquor', kind: 'store', label: 'Liquor store', frontage: [10, 30], depth: [12, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Barrel & Bottle', 'Calder Wine & Spirits', 'The Cellar Door', 'Harbour Liquor'], weight: 0.8}),
  P({id: 'sporting-goods', kind: 'store', label: 'Sporting goods', frontage: [18, 38], depth: [16, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Summit Sports', 'Trailhead Outfitters', 'Fieldhouse Sporting Goods', 'Northern Pursuit'], weight: 0.9}),
  P({id: 'gunstore', kind: 'store', label: 'Gun shop', frontage: [12, 24], depth: [14, 26], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Ridgeline Arms', 'Calder Firearms', 'Iron Sight Gun Shop', 'Halsey Sporting Arms'], weight: 0.6}),
  P({id: 'bookstore', kind: 'store', label: 'Bookstore & café', frontage: [16, 32], depth: [16, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Inkwell Books', 'The Page Turner', 'Marlow Books & Coffee', 'Second Chapter'], weight: 0.9}),
  P({id: 'cafe', kind: 'store', label: 'Café', frontage: [12, 30], depth: [14, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Corner Cup', 'The Daily Grind', 'Halsey Coffee House', 'Morning Glory Café'], weight: 0.9}),
  P({id: 'diner', kind: 'store', label: 'Diner', frontage: [14, 30], depth: [14, 30], storeys: [1, 2], upper: [20, 20], door: 2, service: 1.5,
    names: ['Rosie\'s Diner', 'The Blue Plate', 'Calder Grill', 'Midway Diner', 'Lucky Star Diner'], weight: 1}),
  // --- small shopping centres ---------------------------------------------------------------------------------------------------
  P({id: 'strip-centre', kind: 'centre', label: 'Shopping centre', frontage: [36, 84], depth: [20, 42], storeys: [1, 2], upper: [36, 24], door: 4, service: 2,
    names: ['Halsey Plaza', 'Calder Court Shops', 'Northgate Centre', 'Marlow Square'], weight: 1}),
  P({id: 'arcade', kind: 'centre', label: 'Shopping arcade', frontage: [36, 76], depth: [24, 42], storeys: [1, 2], upper: [36, 24], door: 4, service: 2,
    names: ['The Arcade', 'Calder Galleria', 'Lindqvist Arcade', 'Union Arcade'], weight: 1}),
  // --- offices --------------------------------------------------------------------------------------------------------------
  P({id: 'office-block', kind: 'office', label: 'Office building', frontage: [24, 54], depth: [22, 32], storeys: [1, 3], upper: [24, 22], door: 3, service: 1.5,
    names: ['Calder House', 'Halsey Building', 'Northgate Offices', 'Marlow Chambers', 'Union Trust Building', 'Fenwick Tower'], weight: 1}),
  // --- the train-repair depot ----------------------------------------------------------------------------------------------
  P({id: 'rail-depot', kind: 'depot', label: 'Train-repair depot', frontage: [22, 28], depth: [29, 36], storeys: [1, 2], upper: [22, 29], door: 6, service: 1.5,
    names: ['Calder Street Rail Depot', 'Halsey Yard Maintenance Shed', 'Northgate Car Shop', 'Union Rail Works'], weight: 1}),
  // --- civic (optional) -----------------------------------------------------------------------------------------------------
  P({id: 'police', kind: 'civic', label: 'Police station', frontage: [24, 54], depth: [22, 32], storeys: [1, 2], upper: [24, 22], door: 3, service: 1.5,
    names: ['14th Precinct', 'Calder Police Station', 'Central Division Police'], weight: 0.6}),
  P({id: 'fire-station', kind: 'civic', label: 'Fire station', frontage: [24, 48], depth: [22, 32], storeys: [1, 2], upper: [24, 22], door: 3, service: 1.5,
    names: ['Fire Station No. 7', 'Engine Company 12', 'Calder Fire Hall'], weight: 0.5}),
  P({id: 'clinic', kind: 'civic', label: 'Walk-in clinic', frontage: [20, 44], depth: [20, 32], storeys: [1, 2], upper: [24, 22], door: 3, service: 1.5,
    names: ['Calder Walk-in Clinic', 'Halsey Family Medical', 'Northgate Health Centre'], weight: 0.6}),
];

export const SURFACE_PROGRAMME_IDS: readonly SurfaceProgrammeId[] = SURFACE_PROGRAMMES.map(p => p.id);
const BY_ID = new Map<string, SurfaceProgramme>(SURFACE_PROGRAMMES.map(p => [p.id, p]));
/** Older / alternative spellings of a programme id. */
export const SURFACE_PROGRAMME_ALIASES: Readonly<Record<string, SurfaceProgrammeId>> = {
  sporting: 'sporting-goods', sports: 'sporting-goods', 'gun-store': 'gunstore', guns: 'gunstore', office: 'office-block', 'office-tower': 'office-block',
  'arcade-centre': 'arcade', mall: 'strip-centre', books: 'bookstore', coffee: 'cafe', depot: 'rail-depot', 'train-depot': 'rail-depot', 'medical-clinic': 'clinic',
};
/** Fallback programme per building kind (an unknown id still gets a programme-shaped interior). */
const KIND_FALLBACK: Readonly<Record<string, SurfaceProgrammeId>> = {
  store: 'convenience', centre: 'strip-centre', office: 'office-block', depot: 'rail-depot', civic: 'clinic',
};
export const isSurfaceProgramme = (id: string): id is SurfaceProgrammeId => BY_ID.has(id);
/** The programme record (aliases resolved; undefined for an id the planner does not implement). */
export const surfaceProgramme = (id: string): SurfaceProgramme | undefined => BY_ID.get(SURFACE_PROGRAMME_ALIASES[id] ?? id);
/** The programme the planner builds for a building: its id, an alias, else its kind's fallback (null: one plain room on the street storey). */
export function resolveProgramme(id: string, kind: string): SurfaceProgrammeId | null {
  if (BY_ID.has(id)) return id as SurfaceProgrammeId;
  const a = SURFACE_PROGRAMME_ALIASES[id];
  if (a) return a;
  return KIND_FALLBACK[kind] ?? null;
}
/** Store programmes (GEN's ">= 8 stores of >= 6 programmes" pool). */
export const SURFACE_STORE_PROGRAMMES: readonly SurfaceProgrammeId[] = SURFACE_PROGRAMMES.filter(p => p.kind === 'store').map(p => p.id);
