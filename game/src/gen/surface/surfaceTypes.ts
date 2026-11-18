// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): the SURFACE RUN layout contract (`layout.surface` on the
// district's own StationLayout, `layout.surfaceAccess` on a host station's 'main' layout). Pure data, no three.js.
//
// Ownership (lanes): GEN writes `layout.surface` (gen/surface/*); ACCESS writes `layout.surfaceAccess` (gen/surface/access.ts) and owns
// the transition lifecycle (Game.crossSurface); LOOK draws from it (world/surface/look*.ts + the builder's surface arch); AIR reads
// `outdoorAreas` / `openings` / `windows` (outdoor gas, doors, pane breaches); TRUCK reads `truck`; LIFE reads `map`, `depot`,
// `outdoor` (the map table, the depot recoverables, the outdoor replenisher). Fields are ADDITIVE: a lane may add optional fields it
// owns; never repurpose or remove one another lane reads.
//
// Frame: world metres in the layout's grid frame (grid x -> world X, grid y -> world Z, CELL = 0.5 m), y up, street level y = 0 on
// layout level 0. Yaw follows the camera convention (forward = (-sin yaw, -cos yaw)). `level` = layout.levels index.

import type {Side} from '../stationTypes';

/** World-metre rect on the ground plane. */
export interface SRect { x0: number; z0: number; x1: number; z1: number }
/** A world pose on a storey (explicit floor y). */
export interface SPose { x: number; z: number; yaw: number; level: number; y: number }
/** An axis-aligned world box (interaction / trigger volumes; absolute y). */
export interface SBox { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number }

// ---------------------------------------------------------------------------------------------------------------------------
// The city frame

/** Broad class of a building (map icon, LOOK style family, gas / enemy rules). GEN's programme id says exactly what it is. */
export type SurfaceBuildingKind =
  | 'store' | 'centre' | 'office' | 'depot' | 'civic' | 'residential' | 'industrial' | 'parking' | 'ruin';

/** A building's state as generated (LOOK / AIR / map). */
export type SurfaceCondition = 'intact' | 'damaged' | 'gutted' | 'collapsed';

/** A street segment (centre line between two intersections; the map and the look). */
export interface SurfaceStreet {
  id: number;
  name: string;
  /** Centre line end points (world m). Streets are axis-aligned. */
  ax: number; az: number; bx: number; bz: number;
  /** Carriageway width (kerb to kerb) and each sidewalk's width (m). */
  width: number;
  sidewalk: number;
  /** 'avenue' (wide, through the core), 'street', 'lane' (service alley). */
  rank: 'avenue' | 'street' | 'lane';
  /** Blocked spans (rubble / barricade / crater) a vehicle cannot pass; the map draws them. */
  blocked?: SRect[];
}

export interface SurfaceBlock {
  id: number;
  /** Block column / row in the 8 x 8 frame (0..7). */
  col: number;
  row: number;
  /** Kerb rect (the raised block: its sidewalks included). */
  rect: SRect;
  /** (lane GEN, optional) Property lines (the kerb rect minus the sidewalks). */
  lot?: SRect;
  /** Inside the explorable core (about 4 x 4 blocks): enterable destinations live here. */
  core: boolean;
  /** Building ids on the block. */
  buildings: number[];
}

/** A doorway between outdoors and a building interior (or between two interiors across a party wall). */
export interface SurfaceEntrance {
  id: string;
  building: number;
  level: number;
  /** Doorway centre on the facade line and the facade side it pierces. */
  x: number; z: number;
  side: Side;
  /** Clear opening width (m) and head height above its floor. */
  width: number;
  height: number;
  /** The interior area it opens into / the outdoor area it opens onto (layout area ids). */
  inner: number;
  outer: number;
  /**
   * Its door as generated: 'closed' = an intact door, shut (the AIR lane's door runtime opens / closes it; an intact building stays sealed
   * while it is shut); 'open' = an intact door standing open; 'smashed' = no leaf left (a permanent opening); 'boarded' = blocked (not
   * passable; the grid's doorway cells stay SOLID).
   */
  door: 'closed' | 'open' | 'smashed' | 'boarded';
  /** The doorway's open cells on the building side (gas source cells while the opening is open: grid cell indices of `level`). */
  cells: number[];
  /** (lane GEN) Its layout.doors index (a boarded doorway has none: its cells stay SOLID). */
  doorIndex?: number;
}

/** A run of facade glazing on one wall plane of one storey (the office tower's span model, gen/stationTypes.ts OfficeWindowSpan). */
export interface SurfaceWindowSpan {
  id: string;
  building: number;
  level: number;
  /** The span box covers the (SOLID) wall cells. */
  x0: number; z0: number; x1: number; z1: number;
  side: Side;
  /** Sill / head heights ABOVE the storey floor (m). */
  sill: number;
  head: number;
  /** Pane columns along the span; per-pane initial state (left to right along +X / +Z). */
  panes: ('intact' | 'cracked' | 'broken' | 'boarded')[];
  /** The room behind it (area id) — gas from a broken pane pools there. */
  room: number;
  /** A shop window (sill ~0.4 m, display behind) rather than an office / residential window. */
  shop?: boolean;
}

export interface SurfaceBuilding {
  id: number;
  block: number;
  kind: SurfaceBuildingKind;
  /** GEN's programme id ('grocery', 'hardware', 'strip-centre', 'office-tower', 'rail-depot', …): what it is, exactly. */
  programme: string;
  /** Its sign / map name ("Halsey Hardware", "Calder Street Rail Depot"). */
  name: string;
  /** Outer wall footprint (world m). */
  footprint: SRect;
  /** Drawn storeys and facade top above the street (m; parapet included). */
  storeys: number;
  height: number;
  /** LOOK's facade style key (gen chooses from the styles LOOK implements; free string until LOOK publishes its list). */
  facade: string;
  condition: SurfaceCondition;
  /** Has a carved interior reachable from the street (a core destination when `destination`). */
  enterable: boolean;
  /** A named core destination (the map lists it, its interior is dressed for its programme). */
  destination: boolean;
  /** Layout levels holding its interior, and its interior area ids. */
  levels: number[];
  areas: number[];
  entrances: SurfaceEntrance[];
  /** Ids of its window spans in SurfaceInfo.windows. */
  windows: string[];
  // --- (lane GEN, optional) the generator's shape record for LOOK / the map ---
  /** Floor-to-floor height of every drawn storey, bottom up (m; the street storey first), and the parapet above the roof slab. */
  storeyHeights?: number[];
  parapet?: number;
  /** Absolute y of the roof surface (the top of the last storey; `height` adds the parapet). */
  roofY?: number;
  /** Its main street side and the facade sides that face open ground (the others are party walls against a neighbour). */
  frontage?: Side;
  exposed?: Side[];
  /** A collapsed corner of a standing shell (LOOK draws the broken corner; debris below it is in SurfaceInfo.rubble). */
  collapse?: {corner: 'NW' | 'NE' | 'SW' | 'SE'; rect: SRect};
  /** The host's own building (the portal: subway headhouse / host tower / host mall) or the checkpoint's command tent. */
  host?: 'subway' | 'office' | 'mall' | 'tent' | 'headhouse';
  /** (v2, lane INTERIOR) Its reachable roof, when it has one (world/surface/arch*.ts draws the bulkhead and keeps the roof walkable). */
  roofAccess?: SurfaceRoofAccess;
}

/** (lane GEN) A street-level debris mound: its cells are FLOOR raised above their own ground (ring +edge, crown +crown, m). */
export interface SurfaceRubble extends SRect {
  edge: number;
  crown: number;
  /** 'pile-up' = a blocked span's mound across a street, 'spill' = debris from a collapsed building, 'corner' = below a collapsed corner. */
  kind: 'pile-up' | 'spill' | 'corner';
  street?: number;
  building?: number;
}

/** (lane GEN) An open lot of a block (plaza, park, parking, yards, service lanes, vacant / rubble ground, the checkpoint compound). */
export interface SurfaceLot {
  id: number;
  block: number;
  rect: SRect;
  use: 'plaza' | 'park' | 'parking' | 'yard' | 'loading' | 'vacant' | 'rubble' | 'compound' | 'forecourt' | 'gangway' | 'alley' | 'rail' | 'court';
  /** Ground height (m): 0 = asphalt at road grade, 0.15 = raised like the sidewalks. */
  grade: number;
  /** Its outdoor area id. */
  area: number;
  label: string;
  /** Kerb-cut sides (driveways through the sidewalk). */
  driveways: Side[];
  /** Laid out on the diagonal (paving / paths). */
  diagonal?: boolean;
}

/** (lane GEN) A street crossing (a carriageway rect at grade) and the streets meeting there. */
export interface SurfaceJunction { id: number; rect: SRect; streets: number[]; area: number; signals: boolean }

// ---------------------------------------------------------------------------------------------------------------------------
// Places the runtime lanes need

/** The district side of the host station's access: where the player arrives and the way back down / in. */
export interface SurfacePortal {
  /**
   * 'stair' = a subway entrance stair down (Subway host); 'door' = a building's street doors (Office tower / Mall entrance); 'lift' =
   * (version 2, lane ACCESS follow-up) the cargo lift inside the command tent (`lift`).
   */
  kind: 'stair' | 'door' | 'lift' | 'connector';
  /** Arrival pose (standing just outside the portal, facing the checkpoint). */
  pose: SPose;
  /** The interaction box of the way back (the door / the grille at the stair foot): [E] goes back to the host station. */
  trigger: SBox;
  /** The building the portal belongs to (the Office tower / Mall facade / the station headhouse). */
  building: number | null;
  /** What it is called in prompts ("Back down to <Station>", set by ACCESS from the host). */
  label: string;
  /** (version 2, lane ACCESS follow-up) The cargo lift the crossing rides (kind 'lift'): its car stands at the tent's stop. */
  lift?: SurfaceLift;
  /** (version 2, an Office / Mall host) The connector tube the crossing walks (kind 'connector'): its tent end opens into the tent. */
  connector?: SurfaceConnector;
}

/**
 * Task studio-surface-host-ground-connectors-20261118-053602-01 (version 2, an Office / Mall host): ONE WORLD's placement of the
 * CONNECTOR — the level canvas tube from the host's street door to the command tent (gen/surface/connectorShape.ts: the one shape, the
 * tube-local frame s / t, the walk model). The host station's record (SurfaceAccessInfo.connector, end 'host') places it at the host's
 * street door over the street outside its grid; the district's (SurfacePortal.connector, end 'tent') from the host building's facade to
 * the tent's wall. World metres, absolute y. Both records of a station share `len`; `door` is the host world's (the district's copies
 * the shape's defaults: its host mouth stays shut there).
 */
export interface SurfaceConnector {
  /** The host the tube serves. */
  host: 'office' | 'mall';
  /** Which end this world's walk-in side is: the host doorway (the host station) or the tent (the district). */
  end: 'host' | 'tent';
  /** The tube axis at s = 0 (the host mouth on the host facade's outer plane, on the floor), its storey and the heading of +s. */
  x: number;
  z: number;
  y: number;
  level: number;
  yaw: number;
  /** The tent mouth's s (CONNECTOR.len). */
  len: number;
  /**
   * The host doorway behind the host mouth (s = -depth .. 0): its clear width / height, and the host facade opening's full width the
   * tube's collar closes (the Mall's street door set is wider than the tube; the Office boarding's cut is the doorway itself).
   */
  door: {depth: number; width: number; height: number; collar: number};
  /** The walk-in side's layout area (the lobby / exit hall; the tent). */
  area: number;
}

/**
 * Lane ACCESS follow-up (version 2): ONE END of the Surface Run's cargo lift — the car's room GEN carved (FLOOR cells walled by a one-cell
 * SOLID ring, its gate a doorway through the ring at the car's front), drawn with the cargo lift kit (world/elevator.ts) by
 * world/surface/liftSite.ts and ridden by world/surface/liftRide.ts. World metres, absolute y. The station's end is the shaft's LOWER
 * stop, the district's (the command tent) its UPPER one; both ends share one car shape (gen/surface/accessLift.ts LIFT_CAR).
 */
export interface SurfaceLift {
  /** The car's interior (the room's FLOOR cells) and the shaft (the interior + its ring). */
  cab: SRect;
  shaft: SRect;
  /** The car's front (the wall its gate pierces, as a side of `cab`) and the gate: its centre on the cab's front plane, clear width (m). */
  doorSide: Side;
  door: {x: number; z: number; width: number};
  /** The stop's floor (absolute y) and storey. */
  y: number;
  level: number;
  /** The car room's layout area (the station's appended area / the tent's own area). */
  area: number;
  /** Which stop of the shaft this end is. */
  end: 'lower' | 'upper';
}

/** The military checkpoint by the portal (tent, sandbags, the map table, the truck). */
export interface SurfaceCheckpoint {
  /** The checkpoint compound (outdoor area id and its rect). */
  area: number;
  rect: SRect;
  /** The command tent footprint and its door (the tent interior is an area: enclosed, protected like an intact building). */
  tent: {rect: SRect; area: number; door: {x: number; z: number; side: Side}};
  /** The planning-map table (a prop placement index in layout.props) and where the reader stands. */
  mapTable: {prop: number; read: SPose};
}

/** One recoverable item in the rail depot: a physical, existing craftable train unit / upgrade kit (LIFE lane). */
export interface SurfaceRecoverable {
  /** 'radar' | 'sentry' | 'scanner' | 'chest' (craft/equipment.ts EquipmentKind) or an upgrade kit id ('armor'). */
  kind: string;
  /** Where it stands (world pose on its storey). */
  pose: SPose;
}

export interface SurfaceDepot {
  building: number;
  /** The recoverables as generated (seeded ONCE into the district's memory on first entry; never refilled). */
  recoverables: SurfaceRecoverable[];
  /**
   * Lane ROOMS (optional, additive): the maintenance shed's working gear as planned (gen/surface/rooms/depot.ts) — the rail tracks, the
   * inspection pit, the overhead crane, the kept dolly lanes — pure data for LOOK to draw. Absent when the depot's interior planner gave none.
   */
  features?: SurfaceDepotFeatures;
}

/** The depot shed's planned working gear (world metres; absolute heights; ids of this layout). Lane ROOMS plans it, LOOK draws it. */
export interface SurfaceDepotFeatures {
  /** The maintenance shed (area id). */
  shed: number;
  /** Rail tracks: centre line (world m) from the roller-door wall to the back wall; standard gauge (m). */
  tracks: {x0: number; z0: number; x1: number; z1: number; gauge: number}[];
  /** Inspection pits (world rect between the rails of the first track; grated, walkable; depth m). */
  pits: {x0: number; z0: number; x1: number; z1: number; depth: number}[];
  /** Overhead travelling crane: the runway's box (world m), bridge span, rail height (abs), bridge position (0..1 along `axis`), hook height. */
  crane: {x0: number; z0: number; x1: number; z1: number; span: number; y: number; at: number; hookY: number; axis: 'x' | 'z'} | null;
  /** The dolly lanes kept clear of props (level-0 grid indices): the track corridor and the loading-door lane. */
  lane: number[];
  /** The loading-bay entrance id (SurfaceEntrance.id) when there is one (the truck's door), else the roller door's. */
  exit: string | null;
}

/** A local report / annotation printed on the checkpoint's planning map (LIFE lane draws it). Never campaign-network intel. */
export interface SurfaceNote {
  x: number; z: number;
  /** Short text ("Pharmacy looted", "Gas pooling — mask up", "Depot: parts in the yard"). */
  text: string;
  kind: 'hazard' | 'supply' | 'route' | 'enemy' | 'info';
}

/** Outdoor replenishment rules' data (LIFE lane): where outdoor zombies may appear. */
export interface SurfaceOutdoor {
  /** Outdoor walkable area ids on level 0 (streets, sidewalks, lots, plazas, the checkpoint compound). */
  areas: number[];
  /** Spawn zones (rects on level 0 kept clear of the checkpoint / portal), weights ~ street length. */
  spawnZones: (SRect & {weight: number})[];
  /** No outdoor spawn inside this box (the checkpoint and the portal surroundings). */
  safe: SRect;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The record

export interface SurfaceInfo {
  /** The district's surface version (its host's record: gen/surface/surfaceRun.ts surfaceFeatures says what each builds). */
  v: 1 | 2;
  /** The district's display name ("Calder Heights"). */
  name: string;
  /** The host archetype (portal kind, the far skyline the look shows behind the tower / mall). */
  host: 'subway' | 'office' | 'mall';
  /** The district seed (gen/surface/surfaceRun.ts surfaceSeed). */
  seed: number;
  /** The 8 x 8 footprint (the playable boundary) and the explorable core (about 4 x 4 blocks). */
  extent: SRect;
  core: SRect;
  /** Block frame: 8 columns x 8 rows. */
  cols: number;
  rows: number;
  blocks: SurfaceBlock[];
  streets: SurfaceStreet[];
  buildings: SurfaceBuilding[];
  windows: SurfaceWindowSpan[];
  /** Every outdoor walkable area id (the outdoor gas mask's source: an outdoor cell is a level-0 FLOOR cell of one of these areas). */
  outdoorAreas: number[];
  portal: SurfacePortal;
  checkpoint: SurfaceCheckpoint;
  /** The truck's generated parking pose (TRUCK lane: its record wins once saved). */
  truck: SPose;
  depot: SurfaceDepot;
  outdoor: SurfaceOutdoor;
  notes: SurfaceNote[];
  /** Storey labels per layout level ('Street', 'Upper floor'). */
  storeys: {level: number; label: string; y: number}[];
  // --- (lane GEN, optional) the generator's ground record for LOOK / the map ---
  /** Open lots, street crossings, debris mounds. */
  lots?: SurfaceLot[];
  junctions?: SurfaceJunction[];
  rubble?: SurfaceRubble[];
  /** The depot's rail spur: corridor rects at grade from the cordon to the shed, its outward direction and the track's centre line. */
  rail?: {rects: SRect[]; dir: Side; centre: number};
  /** The abandoned military roadblock (a barrier line with a vehicle gap) on an avenue. */
  roadblock?: SRect;
  /** The cordon: the quarantine wall band around the playable extent (outer rect; extent = its inner edge). */
  cordon?: SRect;
  /**
   * (v2, task studio-surface-run-field-followup-20261116-211729-01, lane FOG writes) The natural fog-pressure boundary that replaces the
   * visible cordon wall: world/surface/fogPressure.ts fogPressureAt reads it (hazard AND visual: one source of truth). Absent = v1.
   */
  boundary?: SurfaceBoundary;
}

/**
 * (v2) The fog-pressure boundary (world metres, concentric axis-aligned rects): pressure 0 inside `clear` (the meaningful district), rising
 * outward over `ramp` metres to 1 (the truck is broken down / an unprotected-or-protected walker is overwhelmed), and on beyond it to the
 * finite geometry `edge` (filler blocks hide it; a last-resort collider stands there, far past the point nothing survives).
 */
export interface SurfaceBoundary {
  clear: SRect;
  /** Metres from the `clear` rect's edge to pressure 1 (the same on every side). */
  ramp: number;
  edge: SRect;
}

/**
 * (v2, lane INTERIOR writes, lane FACADE / LOOK draws) A building's REACHABLE roof: the walkable roof surface on layout level `level`
 * (absolute `y`; inside the parapet) and the stair bulkhead / hatch housing the way up (its footprint on the roof, the side its door opens
 * onto the roof, its height above the roof).
 */
export interface SurfaceRoofAccess {
  level: number;
  y: number;
  walk: SRect;
  bulkhead: SRect & {side: Side; h: number};
  /**
   * (lane INTERIOR, task studio-surface-run-field-followup-20261116-211729-01) The roof door in the bulkhead wall on `bulkhead.side`: an
   * entrance record (level `level`, leaf on the bulkhead's outer face, `inner` = the stair landing, `outer` = the roof area it opens onto,
   * `cells` = its doorway cells on that level's grid). Kept OUT of `entrances` (those are the street doorways on level 0). The walkable roof
   * is `walk` minus the bulkhead; `areas` = the roof's own (outdoor) layout areas on `level`.
   */
  door?: SurfaceEntrance;
  areas?: number[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// The host station's side (ACCESS lane: gen/surface/access.ts)

export interface SurfaceAccessInfo {
  /** The host station's surface version this access was carved for (gen/surface/surfaceRun.ts surfaceFeatures). */
  v: 1 | 2;
  /**
   * 'subway-stair' = an extended stairwell up from a street-exit hall; 'office-door' / 'mall-door' = an exterior street exit; 'lift' =
   * (version 2, lane ACCESS follow-up) a cargo lift at a closed street-exit hall (`lift`).
   */
  kind: 'subway-stair' | 'office-door' | 'mall-door' | 'lift' | 'connector';
  /** The [E] box of the way out (the door at the top of the stairwell / the street door). */
  trigger: SBox;
  /** Where a player coming back down / in stands (inside, facing away from the door). */
  returnPose: SPose;
  /** Layout area ids the access carved or reused (the stairwell / vestibule). */
  areas: number[];
  /** Short prompt name of the outside ("the street"). */
  label: string;
  // ---- lane ACCESS (optional, additive; written by gen/surface/access*.ts, read by world/surface/access*.ts) ----
  /**
   * The closed door the access ends at, when the access draws its own (world/surface/accessView.ts): the street door at the top of
   * the Subway stairwell, the makeshift door fitted into the Office lobby's boarded street doors. Centre of the leaf's bottom edge on
   * the wall face (absolute y), `yaw` = the direction the door faces (its front normal (sin yaw, cos yaw) points INTO the station),
   * `w` / `h` = the opening. Absent for the Mall (its street door set is the mall's own, world/mallStreetExit.ts).
   */
  door?: {x: number; z: number; y: number; yaw: number; w: number; h: number; level: number};
  /** Mall: the id of the street exit (layout.mall.exits) that is usable: drawn without its lock (chain, notices, board, lit sign). */
  exit?: string;
  /** Subway: the exit hall (layout area id) the stairwell climbs from, the climb's rise (m) and the street named on its signs. */
  hall?: number;
  rise?: number;
  street?: string;
  /** (version 2, lane ACCESS follow-up) The cargo lift (kind 'lift'): the station's end of the shaft. */
  lift?: SurfaceLift;
  /** (version 2, an Office / Mall host) The connector (kind 'connector'): the host station's end of the tube, over its street. */
  connector?: SurfaceConnector;
}
