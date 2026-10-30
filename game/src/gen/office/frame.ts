// Seamless Office Space (lane GEN): the OFFICE TOWER FRAME — the footprint, core and storey heights every storey of the ONE
// continuous office layout shares (pure data). Derived from the LEVEL seed only.
//
// Every storey grid of the layout puts the tower interior's NW corner at cell (MARGIN, MARGIN), so the elevator shaft, the
// scissor stairwell and the windows have IDENTICAL world X/Z on every storey; storey n (lobby = 1, floors 2..8) is layout level n
// at y = lobby + FLOOR_HEIGHT * (n - 1).
//
// Tower-local cells (x east, y south), interior [0, TW) x [0, TD); the perimeter wall ring is x = -1 / TW, y = -1 / TD:
//
//   y 0 ┌────────────────────── N band (rooms / open plan, nB rows) ───────────────────────┐ windows
//       ├────────────────────── N corridor (K rows, full width: elevator lobby) ──────────────┤
//       │ W end │ W  │ CORE  N strip: [scissor stairwell 26 x 9] [shaft 7 x 6]   (or mirrored) │ E  │ E end │
//       │ zone  │corr│       S strip: washrooms + support rooms (per-floor program)          │corr│ zone  │
//       ├────────────────────── S corridor (K rows, full width) ──────────────────────────────┤
//  y TD └────────────────────── S band (rooms / open plan, sB rows) ───────────────────────┘
//
// Task office-interactions-layout-20261030 (lane LAYOUT): that diagram is the RING plan. Office floors 2..8 each carve their own
// seeded plan (TowerFrame.plans, gen/office/floorplan.ts): the side corridors / S corridor / end zones / S band depth / support
// rooms change per floor (ring, one-sided loop, open work commons); the N corridor, the core box, the stairwell, the shaft and
// the landing strip above are identical on every storey.
//
// SCISSOR STAIRWELL (design.md "Stairs"): one well with two parallel lanes (4 cells = 2 m each) and a solid 1-cell divider;
// the runs alternate lanes (lobby→2 lane A, 2→3 lane B, 3→4 lane A …) so a storey grid never carries two runs in the same
// cells. Each run is one straight layStairRun (24 risers of 4.4/24 m, 2 flights of 12) over RUN cells; the landings sit at
// both ends of the well: floors 1, 3, 5, 7 at the `oddEnd`, floors 2, 4, 6, 8 at the other end. A storey's landing (4 x 9
// cells, both lanes + divider) opens onto its N corridor (lobby: the main hall) through an ordinary doorway.
// ELEVATOR SHAFT: cab interior 5 x 4 cells (2.5 x 2 m) + a 1-cell wall ring; SOLID in every tower storey grid (lane LIFT's
// moving cab is a dynamic free-space volume). Door (3 cells) in the shaft's north wall = the core's north wall: the N corridor
// in front of it is the landing strip.

import {Rng, hashString} from '../../core/rng';
import {CELL} from '../grid';
import {STAIR, stairRunCells, type StairSpec} from '../traversal';
import {floorPlans, type FloorPlan} from './floorplan'; // Task office-interactions-layout-20261030 (lane LAYOUT)

export const OFFICE_TOP_FLOOR = 8;
export const OFFICE_FLOORS: readonly number[] = Array.from({length: OFFICE_TOP_FLOOR}, (_, i) => i + 1);
/**
 * Task office-overhaul-20261030 (lane STRUCT): the ROOF storey — layout level 9 (role 'roof'), its deck one storey height above
 * the top office floor, reached by the access ladder from that floor (gen/office/roof.ts). Not an elevator stop, not in
 * OfficeTowerInfo.storeys (the elevator still serves L-8); described by layout.office.roof.
 */
export const OFFICE_ROOF_LEVEL = 9;
/** Roof geometry (m): parapet height, nominal open-sky band top above the deck, elevator overrun height, hatch opening (cells). */
export const ROOF = {parapet: 1.1, sky: 6.0, overrun: 2.8, hatch: 2};
/** The office level is ONE section (seamless): 'main'. */
export const OFFICE_SECTIONS: readonly string[] = ['main'];
/** Grid cells between the layout grid's edge and the tower interior (the wall ring is cell MARGIN - 1). */
export const MARGIN = 2;
/** Storey height (m): storey n floor = lobby floor + FLOOR_HEIGHT * (n - 1). */
export const FLOOR_HEIGHT = 4.4;
/** Clear heights (m): lobby, office rooms / open plan, corridors, core rooms, elevator cab, stair landings, door openings. */
export const CEIL = {lobby: 4.0, office: 2.9, corridor: 2.75, core: 2.6, cab: 2.6, stair: 3.0, door: 2.2, wide: 2.45};
/** Window sill / head above the storey floor (m): office floors, lobby; entrance doors. */
export const WINDOW = {sill: 0.85, head: 2.55, lobbySill: 0.45, lobbyHead: 3.45, entranceHead: 2.6};
/** Scissor stair: one storey (4.4 m) = 24 equal risers of 0.183 m in 2 flights of 12 (tread / landings / headroom as STAIR). */
export const SCISSOR_STAIR: StairSpec = {...STAIR, riser: FLOOR_HEIGHT / 24};
/** Stairwell geometry (cells): lane width, divider, landing depth along the run axis; run length per storey. */
export const WELL = {lane: 4, divider: 1, landing: 4, run: stairRunCells(FLOOR_HEIGHT, SCISSOR_STAIR)};

/**
 * Core south-strip rooms. Task office-interactions-layout-20261030 (lane LAYOUT): + the support rooms of the per-floor plans
 * (gen/office/floorplan.ts): utility room, print room, store room, kitchenette, IT closet, lockers / showers, roof access (floor 8).
 */
export type CoreUnitKind = 'wc-m' | 'wc-w' | 'janitor' | 'supply' | 'riser' | 'utility' | 'print' | 'storage' | 'kitchenette' | 'it' | 'lockers' | 'roof';
export interface CoreUnit { kind: CoreUnitKind; x0: number; x1: number }
export interface CellRect { x: number; y: number; w: number; h: number }

export interface TowerFrame {
  levelSeed: number;
  name: string;
  /** Interior size (cells). */
  TW: number; TD: number;
  /** Corridor width (cells). */
  K: number;
  /** N / S band depths (rows), end-zone widths (cols). */
  nB: number; sB: number; eW: number; eE: number;
  /** Core box (tower-local cells, exclusive ends). */
  cx0: number; cx1: number; cy0: number; cy1: number;
  /** Scissor stairwell interior (both landings + lanes + divider), tower-local cells. */
  well: CellRect;
  /** Run columns [rx0, rx1): landings W = [well.x, rx0), E = [rx1, well.x + well.w). */
  rx0: number; rx1: number;
  /** Lane rows: lane A carries the runs leaving odd floors (1→2, 3→4, 5→6, 7→8), lane B those leaving even floors. */
  laneA: {y: number; h: number}; laneB: {y: number; h: number};
  /** Well end where floors 1, 3, 5, 7 land; floors 2, 4, 6, 8 land at the other end. */
  oddEnd: 'W' | 'E';
  /** Elevator cab interior (tower-local cells) and the shaft (cab + 1-cell wall ring). */
  cab: CellRect;
  shaft: CellRect;
  /** Elevator door cells: columns [x, x + w) of the shaft's north wall row (cab.y - 1). */
  door: {x: number; w: number};
  /** South strip of the core (rows [sy0, cy1)): washrooms and closets, doors onto the S corridor. */
  sy0: number;
  /** The LOBBY's south-strip units (office floors 2..8 use their plan's units). */
  units: CoreUnit[];
  floorHeight: number;
  /**
   * Task office-interactions-layout-20261030 (lane LAYOUT): the seeded floor plan of every office floor 2..8 (index = floor):
   * corridor topology, core support rooms, end-zone splits (gen/office/floorplan.ts). The core / well / shaft never move.
   */
  plans: FloorPlan[];
}

const TOWER_NAMES = ['Harlan Mutual Tower', 'Calder Trust Building', 'Meridian Plaza', 'Ostend Life Tower', 'Kessler & Pruitt Building',
  'Northgate Commerce Centre', 'Bramley House', 'Union Assurance Tower', 'Halsey Financial Centre', 'Garnet One'];

/**
 * Core depth (rows): N strip (well 9 rows) + wall + S strip. Task office-interactions-layout-20261030 (lane LAYOUT): the S strip is 7
 * rows (3.5 m, was 6 = 3 m) so every washroom / support room keeps a 1.5 m turning space in front of its 1.6 m toilet stalls /
 * shelving (item 5: "the small rooms feel just too small"); the S band range is one row shallower (14-15) to keep the footprint.
 */
const CORE_ROWS = 17;

/** The tower frame of a level seed. */
export function towerFrame(levelSeed: number): TowerFrame {
  const rng = new Rng(hashString('office-tower-frame-v2', levelSeed >>> 0));
  const name = rng.pick(TOWER_NAMES);
  const K = 4;
  const nB = rng.int(14, 16), sB = rng.int(14, 15); // (lane LAYOUT: sB 14-15 with the deeper core strip: TD stays <= 60 cells)
  const eW = rng.int(15, 19), eE = rng.int(15, 19);
  const wellH = 2 * WELL.lane + WELL.divider, wellW = 2 * WELL.landing + WELL.run;
  const cab = {w: 5, h: 4};
  const coreW = wellW + 1 + cab.w;
  const cy0 = nB + 2 + K, cy1 = cy0 + CORE_ROWS;
  const TD = cy1 + 2 + K + sB;
  const cx0 = eW + 2 + K, cx1 = cx0 + coreW;
  const TW = cx1 + 2 + K + eE;
  // N strip: the well and the shaft side by side (seeded order); lanes / landing ends seeded.
  const stairWest = rng.chance(0.5);
  const well: CellRect = {x: stairWest ? cx0 : cx0 + cab.w + 1, y: cy0, w: wellW, h: wellH};
  const cabR: CellRect = {x: stairWest ? cx0 + wellW + 1 : cx0, y: cy0, w: cab.w, h: cab.h};
  const shaft: CellRect = {x: cabR.x - 1, y: cabR.y - 1, w: cabR.w + 2, h: cabR.h + 2};
  const aNorth = rng.chance(0.5);
  const laneA = {y: aNorth ? cy0 : cy0 + WELL.lane + WELL.divider, h: WELL.lane};
  const laneB = {y: aNorth ? cy0 + WELL.lane + WELL.divider : cy0, h: WELL.lane};
  const oddEnd: 'W' | 'E' = rng.chance(0.5) ? 'W' : 'E';
  // S strip (the lobby's): washrooms, a janitor closet, the electrical riser (seeded order), 1-cell walls between. Lane LAYOUT: two
  // closets of 3 / 3.5 m instead of three of 2 m (every room >= 2.5 m clear: ROOM_MIN_CELLS); office floors: their plan's units.
  const W: Partial<Record<CoreUnitKind, number>> = {'wc-m': 8, 'wc-w': 8, janitor: 6, riser: 7};
  const order = rng.shuffle(Object.keys(W) as CoreUnitKind[]);
  const units: CoreUnit[] = [];
  let x = cx0;
  for (const kind of order) { units.push({kind, x0: x, x1: x + W[kind]!}); x += W[kind]! + 1; }
  // Any slack (none with these widths) goes to the last unit.
  units[units.length - 1].x1 = cx1;
  return {
    levelSeed: levelSeed >>> 0, name, TW, TD, K, nB, sB, eW, eE, cx0, cx1, cy0, cy1,
    well, rx0: well.x + WELL.landing, rx1: well.x + WELL.landing + WELL.run, laneA, laneB, oddEnd,
    cab: cabR, shaft, door: {x: cabR.x + 1, w: 3},
    sy0: cy0 + wellH + 1, units,
    floorHeight: FLOOR_HEIGHT,
    // (own seeded stream: the frame's dimensions above are unchanged by the plans)
    plans: floorPlans(levelSeed, {K, sB, cx0, cx1, top: OFFICE_TOP_FLOOR, eW, eE, rows: CORE_ROWS}),
  };
}

/** Landing end of a storey (floor 1 = lobby). */
export const landingEnd = (f: TowerFrame, floor: number): 'W' | 'E' => (floor % 2 === 1 ? f.oddEnd : f.oddEnd === 'W' ? 'E' : 'W');
/** Landing rect of a storey (tower-local cells). */
export function landingRect(f: TowerFrame, floor: number): CellRect {
  const end = landingEnd(f, floor);
  return {x: end === 'W' ? f.well.x : f.rx1, y: f.well.y, w: WELL.landing, h: f.well.h};
}
/** Lane of the run leaving `floor` upward (floor 1..7). */
export const laneOf = (floor: number): 'A' | 'B' => (floor % 2 === 1 ? 'A' : 'B');

/** Layout seed of the office level. */
export function officeSeed(levelSeed: number): number {
  return hashString('office:main', levelSeed >>> 0) >>> 0;
}

/** World metres of a tower-local cell edge (the layout grid puts the interior at cell MARGIN). */
export const wx = (tx: number): number => (tx + MARGIN) * CELL;
export const wz = (ty: number): number => (ty + MARGIN) * CELL;
