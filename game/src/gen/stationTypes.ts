// Station layout data types and scale constants (pure data, no three.js). Re-exported by station.ts.

import type {Grid} from './grid';
import type {Level, LevelLink, RailRun} from './levels';
import type {LevelPlan} from './levelGen';
import type {PropPlacement} from './props';
import type {ShopBox} from './storefronts';
import type {Traversal} from './traversal';
import type {EnemyArchetypeId} from '../ai/creatureSpawn';

export type AreaKind = 'platform' | 'passage' | 'concourse' | 'service' | 'room' | 'closet';
/** Deliberate mixed lighting: public pockets lit, back-of-house dim or dark (no working light). */
export type LightProfile = 'lit' | 'dim' | 'dark';
export type RoomType =
  | 'platform' | 'passage' | 'underpass' | 'concourse' | 'fare-hall' | 'food-court' | 'retail-arcade'
  | 'exit-stair' | 'washroom' | 'service-corridor'
  | 'agent-office' | 'storage' | 'stock-room' | 'crew-room' | 'utility' | 'supply-closet' | 'janitor-closet'
  // Iteration 04: storefront units built into hall walls (restaurant counter units / retail shops).
  | 'eatery' | 'shop'
  // Iteration 08 (Lane A): enclosed public stair cores between levels (lobby, flights, landings).
  | 'stair-core'
  // Iteration 16 (WORLD-GEN): office tower (gen/office/*) — lobby halls, corridors / elevator lobbies, open-plan cubicle
  // farms, enclosed office rooms (private / meeting / break / copy / storage / server / executive: by purpose), the elevator
  // cab and the stairwell vestibule. Never produced by generateStation.
  | 'office-lobby' | 'office-corridor' | 'office-open' | 'office-room' | 'office-elevator' | 'office-stair';

/**
 * Macro station archetype (iteration 04): recognisably different structures, not one template.
 * - side-mezzanine: two side platforms, stair passages up to a long paid mezzanine (or twin end mezzanines)
 * - island-ends: island platform reached from its ends; end halls, a ring of unpaid concourses
 * - express: four-track express station, two island platforms, cross-platform, end mezzanine(s)
 * - interchange: two lines (side + island) joined by a long paid transfer passage
 * - split: side platforms with separate fare controls and ticket halls on both sides of the tracks
 * - deep: deep-level station, long escalator passages up to a remote ticket hall and a PATH-style mall
 */
export type Archetype = 'side-mezzanine' | 'island-ends' | 'express' | 'interchange' | 'split' | 'deep';
export const ARCHETYPES: readonly Archetype[] = ['side-mezzanine', 'island-ends', 'express', 'interchange', 'split', 'deep'];

export type Side = 'N' | 'S' | 'E' | 'W';

/** Dressing role within an area type (orientation-aware dressing, signage, lighting). */
export type AreaRole =
  | 'mezzanine' | 'end-hall' | 'transfer' | 'escalator' | 'stair' | 'end-stair' | 'crossunder'
  | 'ticket-hall' | 'great-hall' | 'exit-hall' | 'mall' | 'food-hall' | 'line-2'
  // Iteration 08 (Lane A): multi-level program — stair cores (lobby / landing), upper decks over the
  // platforms, crossover bridges and catwalks over the track beds, lower service crossing + gallery.
  | 'stair-core' | 'landing' | 'upper-concourse' | 'crossover' | 'catwalk' | 'overlook' | 'service-crossing' | 'service-gallery';

export interface Rect { x: number; y: number; w: number; h: number }

export interface Area extends Rect {
  id: number;
  kind: AreaKind;
  type: RoomType;
  label: string;
  ceil: number;
  parent: number;
  depth: number;
  /** Public (tiled, terrazzo) space; back-of-house is painted block + concrete. */
  publicSpace: boolean;
  /** Seeded lighting profile (assigned by applyLighting after dressing). */
  lighting: LightProfile;
  /** Platforms only: platform number (1 = main/spawn platform) and which edge(s) face the tracks. */
  platformNo?: number;
  edge?: 'N' | 'S' | 'NS';
  /** Platforms: destination of the train on the north / south edge track. */
  towardsN?: string;
  towardsS?: string;
  /** Inside the fare line (platforms, stair passages, mezzanines, transfer passages). */
  paid?: boolean;
  role?: AreaRole;
  /** Storefront units: index into layout.storefronts. */
  storefront?: number;
  /** Iteration 05 (Lane R): purpose id (gen/purposes.ts) — store use or back-of-house purpose. */
  purpose?: string;
  /**
   * Iteration 05 (Lane T): floor height (world y) of an area that lies flat below/above the main
   * level (the underpass passage). Areas holding stair flights have per-cell floors (grid.floor).
   * Iteration 08 (Lane A): set on every area off the main level (absolute floor of its level band).
   */
  floorY?: number;
  /**
   * Iteration 08 (Lane A): level the area lies on (layout.levels index; default 0 = main). Its cells
   * are stamped in that level's grid. Stair runs between levels are level 0 (their cells are carved
   * identically into both connected grids); `ceil` is absolute on every level.
   */
  level?: number;
}

export interface Door extends Rect {
  id: number;
  a: number;
  b: number;
  height: number;
  arch: boolean;
  /** Fare line: the opening holds a row of fare gates (paid side = a). */
  fare?: boolean;
  /** Staff-only door from a public space into back-of-house. */
  staff?: boolean;
  /** Storefront opening (a = hall, b = unit): framed by the storefront, not a plain door frame. */
  shopfront?: boolean;
  /** Iteration 08 (Lane A): level the opening is carved on (= areas[a].level; default 0). `height` stays relative to its floor. */
  level?: number;
}

/** power: output multiplier (aged tubes < 0.8); dying: mostly-dead tube that sputters in bursts. */
export interface LightPlacement {
  x: number; y: number; z: number; rot: number; area: number; broken: boolean; flicker: boolean; warm: boolean; power: number; dying: boolean;
  /** Iteration 08: level whose grid the fixture hangs in (default 0); y is absolute. */
  level?: number;
  /**
   * Iteration 16 (WORLD-GEN): a light-field source with NO fixture (no fixture model, no tube): the dim cool daylight that
   * falls in through the office windows. Baked like any fixture (state from applyLighting is overridden: steady).
   */
  virtual?: boolean;
  /** Iteration 16 (WORLD-GEN): light colour override (linear RGB, ~unit luminance) for the baked field (daylight). */
  tint?: readonly [number, number, number];
}
/**
 * Wall-mounted (default) or hanging (`hang`, double-sided) sign. station = name plate, exit/info =
 * wayfinding (dark field, cream text), service = staff-only plate, platform = platform number plate.
 */
export type SignKind = 'station' | 'exit' | 'service' | 'info' | 'platform';
export interface SignPlacement {
  x: number; y: number; z: number; rot: number; kind: SignKind; text: string; area: number;
  arrow?: 'left' | 'right' | 'up' | 'down';
  hang?: boolean;
  /** Plate width override (m). */
  w?: number;
  /** Iteration 08: level the sign is mounted on (default 0; hang rods reach that level's ceiling); y is absolute. */
  level?: number;
}
export interface PickupPlacement {
  itemId: string; count: number; x: number; y: number; z: number; area: number;
  /** Iteration 08: level the pickup rests on (default 0); y is absolute. */
  level?: number;
}
export type ZombieType = 'shambler' | 'coated';
export interface ZombieSpawn {
  x: number; z: number; yaw: number; type: ZombieType; area: number;
  /** Iteration 07 (Lane Q): enemy archetype drawn per spawn from the level-generic pool (ai/creatureSpawn.ts); absent = zombie. */
  archetype?: EnemyArchetypeId;
  /** Iteration 08 (Lane A): level of the spawn cell (default 0) and its absolute floor height (default 0). */
  level?: number;
  y?: number;
}

/**
 * Iteration 08 (Lane A, Lane G's format; the type lives in gen/levels.ts): a railing along a walkable
 * edge that faces a drop (upper decks / bridges / catwalks onto a light well). The run lies on the
 * cell boundary from (x0, z0) to (x1, z1); y0 / y1 = walking surface at each end; (nx, nz) = unit
 * normal toward the walkable side.
 */
export type {RailRun} from './levels';

export interface Trench {
  x0: number; x1: number; z0: number; z1: number; floorY: number;
  /** Platform-face span along X (the trench continues into tunnels beyond it). */
  platformX0: number; platformX1: number;
  /** World Z of each track centreline. */
  tracks: number[];
  /** Third rail side per track (+1 toward +Z, -1 toward -Z): always away from the platform edge. */
  third: number[];
  /** Steel columns down the middle of a two-track bed. */
  columns: boolean;
  /** Ceiling over the track bed (the platform ceiling). */
  ceil: number;
}

/** Storefront use (fictional brands; see storefronts.ts). */
export type ShopUse =
  | 'burger' | 'pizza' | 'coffee' | 'donut' | 'noodles' | 'deli' | 'sushi' | 'juice' | 'shawarma' | 'bakery'
  | 'convenience' | 'newsstand' | 'pharmacy' | 'florist' | 'phone' | 'keys'
  // Iteration 05 (Lane R): store purposes (gen/purposes.ts STORE_PURPOSES).
  | 'hotdog' | 'tech';
export type ShutterState = 'open' | 'partial' | 'closed';

/**
 * A storefront bay built into a hall wall: the opening is a one-cell slice of the hall wall, the
 * unit (if carved) is a recessed room behind it. Facade-only units (closed, unit = -1) are a rolled
 * down shutter, frame and fascia on the hall wall with solid rock behind.
 */
export interface Storefront {
  id: number;
  /** Hall it fronts (area id) and which wall of that hall it is on. */
  hall: number;
  side: Side;
  /** Unit area id, -1 for facade-only. */
  unit: number;
  /** Opening in the hall wall (cells, one cell thick). */
  ox: number; oy: number; ow: number; oh: number;
  /** Unit interior (cells). Facade-only: the would-be rect (not carved). */
  ux: number; uy: number; uw: number; uh: number;
  use: ShopUse;
  food: boolean;
  name: string;
  shutter: ShutterState;
  /** Opening head (m): top of the shopfront glazing/frame. */
  head: number;
  /** Partial shutters: bottom edge of the shutter curtain (m) = door lintel in the grid. */
  shutterY: number;
  /** Sign band top (m). */
  fasciaTop: number;
  sign: 'lit' | 'dim' | 'dead';
  /** Glazed retail front (glazing panels except the entry), vs an open counter front. */
  glazed: boolean;
  /** Entry span along the opening (cells from its start) for glazed fronts. */
  entry: [number, number];
  /** Brand colour (0xRRGGBB). */
  color: number;
  /** Staff door into a service corridor behind the unit (door id), or -1. */
  backDoor: number;
  /** Closure look: solid roll-down slat shutter, open rod grille, or a leasing hoarding (vacant). */
  style: 'slat' | 'grille' | 'hoarding';
}

export interface StationLayout {
  seed: number;
  attempt: number;
  name: string;
  archetype: Archetype;
  /** Line terminals shown on platform signs (line 1): north-edge track toward towards[0], south-edge toward towards[1]. */
  towards: [string, string];
  grid: Grid;
  areas: Area[];
  doors: Door[];
  props: PropPlacement[];
  lights: LightPlacement[];
  signs: SignPlacement[];
  pickups: PickupPlacement[];
  zombies: ZombieSpawn[];
  storefronts: Storefront[];
  /** Extra architectural boxes (food-court seating rugs …), rendered with the storefront materials. */
  decor: ShopBox[];
  playerSpawn: { x: number; z: number; yaw: number };
  /** First track bed (back-compat: callers only read floorY, shared by every bed). */
  trench: Trench;
  /** Every track bed (VOID cells in the grid). */
  trenches: Trench[];
  /** Main platform (platform 1, player spawn). */
  platform: number;
  /** All platform area ids (platform 1 first). */
  platforms: number[];
  /** Iteration 05 (Lane T): vertical connectors — stair flights, rescue ladders, underpasses (gen/traversal.ts). */
  traversal: Traversal;
  /**
   * Iteration 08 (Lane A): stacked levels (gen/levels.ts). levels[0] is the main level and its grid
   * IS `grid`; upper / lower levels have grids of the same size and origin (gen/levelGen.ts).
   */
  levels: Level[];
  /** Pistol lane: starting weapon the station was generated for (its other weapons are seeded finds); default 'rifle'. */
  startWeapon?: 'rifle' | 'pistol';
  /** Stair runs (and ladders) between levels. */
  levelLinks: LevelLink[];
  /** Railings on walkable edges that face a drop on the upper level (light wells). */
  rails: RailRun[];
  /** Hint for spawn placement: the platform-1 end the player starts at (the level program sits toward the other end). */
  spawnEnd?: 'W' | 'E';
  /** The multi-level program (cells; gen/levelGen.ts): cores, deck range, wells, level areas. QA / tests. */
  levelPlan?: LevelPlan;
  /** Iteration 16 (WORLD-GEN): office-tower section data (gen/office/index.ts); absent on the Subway. */
  office?: OfficeSectionInfo;
}

// ---------------------------------------------------------------------------------------
// Iteration 16 (WORLD-GEN): office tower sections (gen/office/*). World metres in the section's grid frame.

export interface OfficeRect { x0: number; z0: number; x1: number; z1: number }
/** Player pose: yaw in the camera convention (forward = (-sin yaw, -cos yaw)); level = layout.levels index. */
export interface OfficePose { x: number; z: number; yaw: number; level: number }
export type OfficeArrivalKey = 'start' | 'elevator' | 'stairs-up' | 'stairs-down';

export interface OfficeElevatorInfo {
  /** Cab interior: walkable FLOOR cells at floorY on the office storey, no props, enclosed by SOLID shaft walls but the door. */
  cab: OfficeRect;
  /** Cab wall holding the door ('N': the door is on the cab's north edge, you step out toward -Z). */
  doorSide: Side;
  /** Centre of the door opening on the cab edge of doorSide, and its width (m). The opening cells are walkable. */
  door: {x: number; z: number; width: number};
  /** Floor panel inside the cab (door wall's inner face, beside the opening); absolute y. */
  panel: {x: number; y: number; z: number};
  /** Call button outside, on the shaft wall's corridor face beside the opening; absolute y. */
  callPanel: {x: number; y: number; z: number};
  /** Cab floor (absolute) = the storey floor. */
  floorY: number;
  /** Cab area id. */
  area: number;
  /** Shaft outer box (walls included). */
  shaft: OfficeRect;
}

export interface OfficeStairDoor {
  dir: 'up' | 'down';
  /** Door centre on the walkable side of the wall face. */
  x: number; z: number;
  /** Yaw of a player standing in front of it FACING the door. */
  yaw: number;
  toFloor: number;
}

export interface OfficeWindowSpan extends OfficeRect {
  /** Outward facing direction of the wall. The span box covers the (SOLID) wall cells. */
  side: Side;
  /** Sill / head heights ABOVE the storey floor (m). */
  sill: number;
  head: number;
  /** 'entrance': the lobby's street doors (sill 0) — boarded scenery, the wall cells stay solid. */
  kind: 'window' | 'entrance';
}

export interface OfficeSectionInfo {
  /** 1 = lobby (the street section's upper storey), 2.. = office floors. */
  floor: number;
  /** Every floor of the tower ([1..8]). */
  floors: number[];
  /** Storey height (m), uniform: exterior ground y = baseY - floorHeight * (floor - 1). */
  floorHeight: number;
  /** layout.levels index of the office storey (street: 1, the lobby; floors: 0). */
  levelId: number;
  /** Storey floor height (= levels[levelId].baseY). */
  baseY: number;
  elevator: OfficeElevatorInfo;
  /** Stairwell door(s): one door per floor (up + down entries share its spot); none 'down' in the lobby. */
  stairDoors: OfficeStairDoor[];
  /** Perimeter window spans (the wall faces are cut open by the builder; glass = lane TOWER). */
  windows: OfficeWindowSpan[];
  /** Tower footprint: outer faces of the perimeter wall ring. Scenery goes outside it. */
  exterior: OfficeRect;
  /** Player arrival poses per ArrivalKind (levels/types.ts); 'return' = 'start'. */
  arrivals: Partial<Record<OfficeArrivalKey, OfficePose>>;
  /** Tower name (signage / HUD). */
  name: string;
  /** Section seed (= layout.seed). */
  sectionSeed: number;
  /** Optional candidate gear spots (lane GEAR may use them): flat reachable floor in back-of-house office rooms. */
  gearSpots?: {x: number; y: number; z: number; level: number; area: number}[];
}

/** Working canvas for generation (cells); the finished layout is cropped to its bounds. */
export const GEN_W = 720;
export const GEN_H = 580;
export const TRENCH_DEPTH = 1.15;
export const DOOR_HEIGHT = 2.3;
export const PLATFORM_CEIL = 4.4;
/** Two-track bed width (cells): 8 m, track centres 2 m and 6 m from the north platform edge. */
export const TRACK_BED_CELLS = 16;
/** One-track bed width (cells): 4.5 m, track centre 2 m from the platform edge. */
export const SINGLE_BED_CELLS = 9;
export const MIN_ZOMBIE_SPAWN_CELLS = 36; // 18 m walking distance from the player spawn
/** Lit-area fixtures within this distance (m) of the player spawn always work steadily. */
export const SPAWN_LIT_RADIUS = 9;
/** Fixtures in taller spaces hang on rods at this height (m) instead of sitting on the ceiling. */
export const PENDANT_Y = 4.5;
