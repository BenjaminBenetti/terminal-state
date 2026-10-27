// Station layout data types and scale constants (pure data, no three.js). Re-exported by station.ts.

import type {Grid} from './grid';
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
  | 'eatery' | 'shop';

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
  | 'ticket-hall' | 'great-hall' | 'exit-hall' | 'mall' | 'food-hall' | 'line-2';

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
   */
  floorY?: number;
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
}

/** power: output multiplier (aged tubes < 0.8); dying: mostly-dead tube that sputters in bursts. */
export interface LightPlacement { x: number; y: number; z: number; rot: number; area: number; broken: boolean; flicker: boolean; warm: boolean; power: number; dying: boolean }
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
}
export interface PickupPlacement { itemId: string; count: number; x: number; y: number; z: number; area: number }
export type ZombieType = 'shambler' | 'coated';
export interface ZombieSpawn {
  x: number; z: number; yaw: number; type: ZombieType; area: number;
  /** Iteration 07 (Lane Q): enemy archetype drawn per spawn from the level-generic pool (ai/creatureSpawn.ts); absent = zombie. */
  archetype?: EnemyArchetypeId;
}

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
