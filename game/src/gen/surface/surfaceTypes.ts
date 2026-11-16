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
  /** 'stair' = a subway entrance stair down (Subway host); 'door' = a building's street doors (Office tower / Mall entrance). */
  kind: 'stair' | 'door';
  /** Arrival pose (standing just outside the portal, facing the checkpoint). */
  pose: SPose;
  /** The interaction box of the way back (the door / the grille at the stair foot): [E] goes back to the host station. */
  trigger: SBox;
  /** The building the portal belongs to (the Office tower / Mall facade / the station headhouse). */
  building: number | null;
  /** What it is called in prompts ("Back down to <Station>", set by ACCESS from the host). */
  label: string;
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
  v: 1;
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
}

// ---------------------------------------------------------------------------------------------------------------------------
// The host station's side (ACCESS lane: gen/surface/access.ts)

export interface SurfaceAccessInfo {
  v: 1;
  /** 'subway-stair' = an extended stairwell up from a street-exit hall; 'office-door' / 'mall-door' = an exterior street exit. */
  kind: 'subway-stair' | 'office-door' | 'mall-door';
  /** The [E] box of the way out (the door at the top of the stairwell / the street door). */
  trigger: SBox;
  /** Where a player coming back down / in stands (inside, facing away from the door). */
  returnPose: SPose;
  /** Layout area ids the access carved or reused (the stairwell / vestibule). */
  areas: number[];
  /** Short prompt name of the outside ("the street"). */
  label: string;
}
