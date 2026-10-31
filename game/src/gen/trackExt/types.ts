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
//  - (GEN-2) SERVICE-HATCH annexes: where no tunnel continues a bed end (island-ends / express stations: the archetype's paid end
//    halls stand 1.5-4 m past every bed end, on the same main level), an annex may instead be entered through a door in a track
//    bed's SIDE WALL near that end (never a platform face: the wall cells must be rock), with the annex in the rock behind it at
//    the bed floor. Such an annex has `tunnel: -1` and a `bed` record (BedEntry). Its entry door joins the bed (VOID cells, no
//    area) and the annex's entry corridor, so the Door record carries a = b = that corridor (a door never references a missing
//    area). The way in is the bed (drop from the platform), the way back up the bed's rescue ladders (extensionIssues checks both).

import type {Area} from '../stationTypes';
import type {AnnexMachine} from '../annexRooms';

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
  /** The tunnel whose side wall holds the entry door; -1 = a service-hatch annex entered from a track bed (see `bed`). */
  tunnel: number;
  /** Entry door (layout.doors index) on the tunnel wall (or the bed wall: `bed`). */
  door: number;
  /** All annex rooms + corridors (layout.areas ids). */
  areas: number[];
  /** Cramped: ceiling ~2.4–2.8 m above floor; (lane ROOMS) machinery halls 3.6–4.2 m (ceilY = the highest area ceiling). */
  floorY: number;
  ceilY: number;
  /** Walkable FLOOR cells / m² (doorways included). */
  cells: number;
  areaM2: number;
  /** The door (identifiable way out). */
  exit: {x: number; z: number};
  /** (GEN-2) Only on service-hatch annexes (tunnel = -1): the door in the track bed's side wall. */
  bed?: BedEntry;
}

/**
 * (GEN-2) The entry of a service-hatch annex: a door in the SIDE WALL of a track bed near one of its ends (an end no tunnel
 * continues; its black end plane and barricade stay). BED FRAME (so lane VIS can reuse its tunnel-frame tools): the travel
 * line runs along the bed centreline FROM the end face INTO the station; `s` = metres from the end face along it, `side` = the
 * wall, +1 = left of that travel (the TrackTunnel convention: facing +X, left is -Z). World positions are in the layout frame.
 */
export interface BedEntry {
  /** Index into layout.trenches. */
  trench: number;
  /** The bed end it is near. */
  from: BedEnd;
  /** Which side wall: 'N' = the bed's z0 wall (faces +Z into the bed), 'S' = its z1 wall (faces -Z). */
  wall: 'N' | 'S';
  /** The same wall in the bed frame (+1 = left of travel from the end face into the station). */
  side: 1 | -1;
  /** Entry door (layout.doors index; = ServiceAnnex.door). Its rect is the opening cut through the wall's cell row. */
  door: number;
  /** Door centre: arc position in the bed frame (m from the end face) and its world point ON the wall plane. */
  s: number;
  x: number;
  z: number;
  /** Opening width (m) along the wall, floor (= the bed floor = the annex floor) and head (absolute y). */
  width: number;
  floorY: number;
  head: number;
  /**
   * Graffiti on the same bed wall (side = `side`), ONLY because this route exists: an arrow on the approach from the platforms
   * (s > the door's) pointing toward the door (toward = -1: toward smaller s, i.e. toward the end face), optionally a tag beside
   * the door. Positions lie on solid wall (rock cells), clear of the opening.
   */
  clues: {s: number; side: 1 | -1; kind: 'arrow' | 'tag'; toward: 1 | -1}[];
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
  /**
   * (task track2-playtest-revision lane ROOMS addition, gen/annexRooms.ts) The annexes' anchored machinery ASSEMBLIES (boiler banks,
   * generator sets, switchgear, channels, basins, spillway chutes, turbines, fans, ducts, pipe runs …): world/trackExt/machines.ts
   * draws them as merged procedural geometry; their solid parts are collision-only 'annexMachine' props (machineBoxes). Absent
   * without annexes.
   */
  machines?: AnnexMachine[];
  /**
   * (task track3 lane INTEG addition, OPT-IN) The level-grid indices that must stay rock around / under every extension cell, when
   * the level declared TrackExtContext.rockLevels (absent = every level grid, the Subway / Office rule).
   */
  rockLevels?: number[];
  /**
   * (Track 2 playtest revision, lane ART: gen/trackExt/art.ts) Station-surface invitation art on the bed walls the platforms face,
   * at the bed end of every real annex entrance (planned after the attach on rng.fork('station-art'); absent / empty = none).
   */
  art?: StationArt[];
}

/**
 * (Track 2 playtest revision, lane ART) One piece of station-surface invitation art on a bed's side wall, near the bed end of a
 * real annex entrance (gen/trackExt/art.ts). Bed frame as BedEntry: `s` = metres from that end face into the station along the
 * bed, `side` = the wall (+1 = left of that travel). World positions follow from the trench (layout frame).
 */
export interface StationArt {
  /** The annex it invites to (ServiceAnnex.id) and how it is entered at this bed end: its tunnel's mouth, or its service hatch. */
  annex: number;
  entry: 'tunnel' | 'hatch';
  /**
   * The bed (layout.trenches index), the end, and the wall: a side wall of the bed ('N' = its z0 wall facing +Z, 'S' = its z1 wall)
   * or 'end' = the END WALL of a platform beside that bed at that end (the wall a player walking down the platform faces; see `end`).
   * `side`: the side wall (bed frame); for 'end', the side of the bed the platform lies on.
   */
  trench: number;
  from: BedEnd;
  wall: 'N' | 'S' | 'end';
  side: 1 | -1;
  /**
   * 'end' records only: the platform (area id), its end wall plane (world x) and inward normal (±1 along X), the centre (world z).
   * Their `toward` is along world Z (+1 = toward +Z): toward the bed's edge; `target` = the bed's centre line z.
   */
  end?: {platform: number; x: number; nx: 1 | -1; z: number};
  /** 'piece' / 'character' are non-directional; 'stencil' (SERVICE + arrow) points along the bed toward `target`. */
  kind: 'piece' | 'character' | 'stencil';
  /** Centre: bed-frame s (for 'end': the end wall plane's s) and absolute y (m); size on the wall (m). */
  s: number;
  y: number;
  w: number;
  h: number;
  /** Arrow direction along s (+1 = into the station, -1 = toward the end face); 0 = non-directional. */
  toward: -1 | 0 | 1;
  /** Bed-frame s of the entrance: 0 = the tunnel mouth (the end face), else the hatch door centre. */
  target: number;
  /** Deterministic presentation variant (colours / tint). */
  variant: number;
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
    /** Chance per eligible tunnel (first straight long enough) to attempt an annex (only without `count`: the original planner). */
    chance: number;
    /**
     * (GEN-2, optional: the incidence planner) Seeded per-level weights of WANTING 0 / 1 / 2 annexes. The wanted count is then
     * attempted over the level's candidates in a seeded order — eligible tunnels first, then (with `hatch`) the bed ends no
     * tunnel continues — until it is met or the candidates run out (`chance` is not used). Absent: one `chance` roll per tunnel.
     */
    count?: [number, number, number];
    /**
     * (GEN-2, optional) Annex-aware first straight (m): while the level still wants an annex host, a tunnel is planned with a
     * first straight of at least this (an annex door sits on it: doorMinS + the door + room for the entry corridor); if no such
     * shape fits that end, the ordinary shapes are tried. 0 / absent = off.
     */
    hostFirstStraight?: number;
    /** At most this many annexes per level, each on a different tunnel (or bed end). */
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
    /**
     * (task track2-playtest-revision, lane ROOMS; optional) MACHINERY HALLS: larger, taller rooms (Area.extHall) that regularly break
     * up the tight corridors / rooms (user: "keep that tight claustrophobic feel … break it up with bigger rooms"). Per annex
     * `count` halls are wanted; hall k is attempted once the annex has grown to (k + 0.5) / (count + 1) of its area target (a rhythm
     * along the growth, not a cluster), only off a CORRIDOR at least `spacing` areas past the previous hall on its branch (the root
     * corridor counts 1), only while the hall keeps the annex within its area target (+ `slack`), with `tries` placements per attempt.
     * Short / long side and ceiling ranges in metres (ceiling above the floor; the annex rooms keep `ceil`). Absent = no halls.
     */
    hall?: {count: [number, number]; short: [number, number]; long: [number, number]; ceil: [number, number]; spacing: number; tries: number; slack: number};
  };
  /**
   * CORE-CHANGING option (0 = off, the DESIGN §0 default: the core stays byte-identical): metres of rock kept free straight past
   * every bed end that is still open right after the archetype skeleton (Kit.keepRock), so the station's later growth (exits,
   * washrooms, storefronts, back-of-house) leaves room for a tunnel there. Changes the core layouts of the level that sets it.
   */
  coreReserveM: number;
  /**
   * (GEN-2, optional) Service-hatch annexes (ServiceAnnex.bed): a door in a track bed's side wall near a bed end that no tunnel
   * continues. `s` = range (m) of the door centre's distance from the end face; the opening keeps one wall cell to the end face.
   * Absent = no hatches (annexes only off tunnels).
   */
  hatch?: {s: [number, number]};
  clues: {
    /** Chance that a tunnel (or bed wall: a service hatch) leading to an annex door carries graffiti at all. */
    chance: number;
    /** Mouth clue arc position range (m). */
    mouthS: [number, number];
    /** The second clue this far (m) before the door (only when it falls past the mouth clue); a hatch's arrow on the bed wall. */
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
  /**
   * (task track3 lane INTEG addition, OPT-IN; default: every level grid) Level grids that must stay ROCK around / under every
   * extension cell — the storeys of the station itself. Any other storey may stand ABOVE an extension cell when it is solid there or
   * its floor clears the extension's ceiling by EXT_STOREY_SLAB (extensionIssues); its VOID (an atrium / drop) always blocks. For a
   * level whose upper storeys overhang the whole station far above it (The Eaton's Center: rings >= 5 m above the 4.4 m bed ceiling).
   */
  rockLevels?: readonly number[];
}

/** True for areas of the track extensions (tunnels / annexes): every core pass skips them. */
export function isExtensionArea(a: Pick<Area, 'ext'> | null | undefined): boolean {
  return !!a && a.ext !== undefined;
}
