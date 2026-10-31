// Track 2 — Beyond the Station (lane GEN): the data contract of the track extensions — traversable TUNNELS continuing the track
// beds past their old black end walls, and the optional SERVICE ANNEXES (cramped back-of-house room graphs) reached through a
// door in a tunnel side wall. Lane GEN owns this file; lanes VIS (presentation) and CONTENT (dressing / loot / enemies) consume it.
// Pure data (no three.js).
//
// CONTRACT = reference/tasks/track2-beyond-station-20261031/DESIGN.md §1, implemented exactly. Additions / precisions (lane GEN):
//  - TrackExtensions.core (+ shift): the window of the final grid that holds the CORE level (the grid the level would have had
//    without extensions; extensions only ever add cells around it). Runtime passes that must treat the core exactly as before
//    (position-seeded or grid-sized fields) and the translation-normalised golden proofs use it. `shift` = its origin in metres.
//  - TrackTunnel walkable cells: a cell is walkable iff ALL FOUR CORNERS lie inside the smooth walls (|lateral| <= width / 2,
//    0 <= s <= length). That is the exact conservative rasterisation; DESIGN's "centre within width/2 - 0.3" approximation is
//    stricter by one cell row per side on bed-aligned runs and would leave a 0.5 m lip at the mouth (bed rows are carved exactly
//    width / 2 either side of the bed centre), so the bed-aligned first straight is exactly as wide as the bed.
//  - TrackTunnel.firstStraight: length (m) of the axis-aligned first straight (the run in line with the bed). Annex doors sit on
//    it only (a grid-aligned wall), at s in [cfg.annex.doorMinS, min(firstStraight, length - cfg.annex.doorEndClear)].
//  - TrackTunnel.arcs: the bends (path primitives) for census / VIS: arc length range and signed turn (+ = toward the left).
//  - ServiceAnnex.ceilY = the HIGHEST ceiling of its areas (each area keeps its own `ceil`, 2.4-2.8 m above floorY).
//  - Area.ext / Area.extId (gen/stationTypes.ts): 'tunnel' areas use kind 'service' / type 'service-corridor' (label 'Track tunnel');
//    their rect is the BOUNDING BOX of a non-rectangular cell set — iterate cells with grid.area[i] === id, never the rect alone.
//    Annex corridors: kind 'service' / 'service-corridor'; rooms: kind 'room' / existing back-of-house RoomTypes ('utility',
//    'storage', 'crew-room'); small rooms: kind 'closet' ('janitor-closet' / 'supply-closet'). No new RoomType.
//  - Doors (layout.doors) of extensions are carved at the extension floor: their cells carry floor = floorY and ceil = floorY +
//    height (Door.height stays RELATIVE to that floor), level 0. Entry door: a = tunnel area, b = annex corridor.
//  - Extension areas / doors are APPENDED after every core area / door (ids >= the core's), and their cells are stamped into the
//    main level grid only AFTER every core pass ran (gen/trackExt/index.ts attachExtensions): every existing pass sees exactly the
//    core world. Content for extensions comes from appended passes on their own forks (lanes VIS / CONTENT).

import type {Area} from '../stationTypes';

/** Which bed end a tunnel continues: the bed's west (x0) or east (x1) end face. */
export type BedEnd = 'x0' | 'x1';
export type CapKind = 'rubble' | 'bulkhead' | 'gate';

export interface TrackTunnel {
  /** Index in layout.extensions.tunnels. */
  id: number;
  /** Index into layout.trenches (the bed it continues). */
  trench: number;
  /** Which bed end. */
  from: BedEnd;
  /** Trackbed height (the trench's floorY, -1.15 on current levels). */
  floorY: number;
  /** Flat box-section ceiling (= that bed's ceiling, absolute y). */
  ceilY: number;
  /** Inner wall-to-wall width (m) = bed width. */
  width: number;
  /** Smooth centreline, world metres, starting ON the bed end face, sample spacing <= 0.5 m; straight runs + circular arcs. */
  path: {x: number; z: number}[];
  /** m along path. */
  length: number;
  /** Lateral offsets (m, +left of travel) of each track centreline from the path (from the bed's tracks). */
  rails: number[];
  /** Physical terminal at arc length s (= length); the grid beyond the last walkable cells is solid. */
  cap: {kind: CapKind; s: number};
  /** layout.areas ids whose cells are this tunnel's walkable cells. */
  areas: number[];
  /** Side door(s) to annexes: layout.doors index, arc position, side (+1 = left of travel). */
  doors: {annex: number; door: number; s: number; side: 1 | -1}[];
  /** Graffiti ONLY when the route really exists (toward = +1: further along the path). */
  clues: {s: number; side: 1 | -1; kind: 'arrow' | 'tag'; toward: 1 | -1}[];
  /** (GEN addition) Length (m) of the axis-aligned first straight in line with the bed. */
  firstStraight: number;
  /** (GEN addition) The bends: arc start s, arc length (m), centreline radius (m), signed turn (deg, + = toward the left). */
  arcs: {s: number; len: number; radius: number; turnDeg: number}[];
}

export interface ServiceAnnex {
  id: number;
  tunnel: number;
  /** Entry door (layout.doors index) on the tunnel wall. */
  door: number;
  /** All annex rooms + corridors (layout.areas ids). */
  areas: number[];
  /** Cramped: ceiling ~2.4–2.8 m above floor (ceilY = the highest area ceiling). */
  floorY: number;
  ceilY: number;
  /** Walkable FLOOR cells / m² (doorways included). */
  cells: number;
  areaM2: number;
  /** The door (identifiable way out). */
  exit: {x: number; z: number};
}

export interface TrackExtensions {
  tunnels: TrackTunnel[];
  annexes: ServiceAnnex[];
  /** What was tried and omitted (for census / tests): candidate ends, rejected reasons. */
  log: {trench: number; from: BedEnd; result: string}[];
  /**
   * (GEN addition) The core window of the final grid (cells): the level without extensions occupies [x, x + w) x [y, y + h) —
   * byte-identical content, translated by (x, y) cells. `shift` = (x, y) * CELL in metres (0 when nothing extends west / north).
   */
  core: {x: number; y: number; w: number; h: number};
  shift: {x: number; z: number};
  /**
   * (GEN addition) Only when the core was translated: the EXACT core-frame x / z of the core's point records (pairs, in each list's
   * order; records appended later have none). A translated double can come back one ulp off, which flips cm / mm rounding ties:
   * position-seeded consumers (shelf stock) and coreView read these instead.
   */
  coreXZ?: Partial<Record<CoreXZKey, number[]>>;
  /**
   * (lane CONTENT addition, gen/annexContent.ts) Steam vent spots of the annexes, placed from their dressing (over the pump skids /
   * water heaters, then corridor walls): wall point (absolute y), blow direction, area id. world/trackExt/steam.ts annexVents uses
   * them when present (visual only, never the gas field).
   */
  vents?: {x: number; y: number; z: number; dir: {x: number; y: number; z: number}; area: number}[];
}

/** Point-record lists of a layout whose exact core-frame positions a translated core keeps (TrackExtensions.coreXZ). */
export type CoreXZKey = 'props' | 'lights' | 'signs' | 'pickups' | 'zombies';
export const CORE_XZ_KEYS: readonly CoreXZKey[] = ['props', 'lights', 'signs', 'pickups', 'zombies'];

/** Balance / geometry config of the track extensions of one level (gen/trackExt/config.ts TRACK_EXT). */
export interface TrackExtConfig {
  tunnel: {
    /** Planned length range (m): a drawn target, shortened to fit; shorter than length[0] = no tunnel at that end. */
    length: [number, number];
    /** Weights of 0 / 1 / 2 arcs for the drawn shape (the fallback shapes try the others). */
    arcWeights: [number, number, number];
    /** Centreline radius range (m) of every arc (>= 14). */
    radius: [number, number];
    /** Total |turn| (deg) over the arcs. */
    maxTurnDeg: number;
    /** Candidate |turn| (deg) of one arc. */
    turnsDeg: number[];
    /** Length range (m) of the axis-aligned first straight before the first arc. */
    firstStraight: [number, number];
    /** Physical cap kind weights. */
    caps: Record<CapKind, number>;
    /** Rock (m) reserved behind the cap plane (rubble spill / bulkhead / gate frame). */
    capDepth: number;
  };
  /** Rock margins (cells) between an extension and the core / another extension group. */
  margin: {core: number; ext: number};
  annex: {
    /** Chance per eligible tunnel (first straight long enough) to attempt an annex. */
    chance: number;
    /** At most this many annexes per level, each on a different tunnel. */
    max: number;
    /** Size target as a share of the Subway walkable-exploration baseline (SUBWAY_WALK_BASELINE_M2). */
    share: number;
    /** Per-annex multiplier range on that target. */
    jitter: [number, number];
    /** Smaller results are omitted entirely (share of the baseline). */
    minShare: number;
    /** Entry door arc position: s >= doorMinS, s <= length - doorEndClear (m). */
    doorMinS: number;
    doorEndClear: number;
    /** Service corridor width / length ranges (m). */
    corridorWidth: [number, number];
    corridorLength: [number, number];
    /** Room size range (m): short x long side from min to max (3 x 3 .. 8 x 10). */
    roomMin: [number, number];
    roomMax: [number, number];
    /** Rooms with both sides <= this (m) are closets. */
    closetMax: number;
    /** Ceiling height above the floor (m). */
    ceil: [number, number];
    /** Door opening height (m above the floor) and width (cells) of annex doors. */
    doorHeight: number;
    doorCells: number;
    /** Chance to close the one main loop (an extra door between two neighbouring annex areas). */
    loopChance: number;
    /** Growth attempts per annex. */
    steps: number;
  };
  /**
   * CORE-CHANGING option (0 = off, the DESIGN §0 default: the core stays byte-identical): metres of rock kept free straight past
   * every bed end that is still open right after the archetype skeleton (Kit.keepRock), so the station's later growth (exits,
   * washrooms, storefronts, back-of-house) leaves room for a tunnel there. Changes the core layouts of the level that sets it.
   */
  coreReserveM: number;
  clues: {
    /** Chance that a tunnel leading to an annex door carries graffiti at all. */
    chance: number;
    /** Mouth clue arc position range (m). */
    mouthS: [number, number];
    /** The second clue this far (m) before the door (only when it falls past the mouth clue). */
    beforeDoor: number;
    /** Chance of a tag beside the door. */
    tagChance: number;
  };
}

/** Level context of extendTracks. */
export interface TrackExtContext {
  levelId: string;
  /** 'any' (the Subway: the crop follows the bbox) or 'east-south' (a fixed crop origin: never west / north of it). */
  canvasGrow: 'any' | 'east-south';
  /** Fixed crop origin (canvas cells) for 'east-south'. */
  origin?: {x: number; y: number};
  /** Final grid cell budget (W x H): the light field / density maps grow with it. */
  maxCells: number;
}

/** True for areas of the track extensions (tunnels / annexes): every core pass skips them. */
export function isExtensionArea(a: Pick<Area, 'ext'> | null | undefined): boolean {
  return !!a && a.ext !== undefined;
}
