// Task studio-skyways-level-20261106-054448-01 (primary, SHARED CONTRACT — lanes build against it, only the primary changes it):
// SKYWAYS (LevelId 'skyways') — a connected multi-building public pedestrian network loosely inspired by Alberta's pedway systems:
// enclosed glazed bridges over city streets joining building hubs / atriums, public corridors, cafés and shops, lobbies and service
// rooms. ONE continuous StationLayout (gen/skyways/index.ts), written into `layout.skyways`.
//
// World frame (same as the Office / mall): x east, z south, y up, metres; layout.levels[i] = storey i:
//  - 0 'station': the subway station (side platforms, one double bed) in the STATION building's basement + an underground pedway
//    concourse (lower public area) — the train arrives here;
//  - 1 'street':  street-level building lobbies / atrium floors / shops (the streets between buildings are OUTSIDE: solid in the
//    grid, exterior scenery only — never walkable);
//  - 2 'skyway':  the "+15" level — skyway concourses in every building and the glazed BRIDGES over the streets (branches + loops).
// Exactly ONE localized major add-on per instance (SkywaysAddon): an anime convention hall OR a prize-car display atrium.
//
// Gas: every SkywaysWindow is a breakable glazed span in a SOLID wall run (the Office window rule): shooting a pane admits real toxic
// gas from outside (world/gas); `breached` spans start broken with gas already flowing.

import type {OfficePose, Side} from '../stationTypes';

/** The add-on pool (equal weights: one per level seed). */
export type SkywaysAddonId = 'convention' | 'prize-car';
export const SKYWAYS_ADDONS: readonly SkywaysAddonId[] = ['convention', 'prize-car'];

/** Storey indices (layout.levels ids). */
export const SKYWAYS_LEVEL = {station: 0, street: 1, skyway: 2} as const;
export const SKYWAYS_STOREYS = 3;

/** A rectangle in world metres (x0 < x1, z0 < z1). */
export interface SkywaysRect { x0: number; z0: number; x1: number; z1: number }

export interface SkywaysStorey {
  level: number;
  role: 'station' | 'street' | 'skyway';
  /** HUD label ('Concourse', 'Street level', '+15 Skyway'). */
  label: string;
  /** Absolute floor y. */
  baseY: number;
  /** Typical public clear height (m). */
  clear: number;
}

export type SkywaysBuildingRole = 'station' | 'hub' | 'tower' | 'hotel';

/**
 * (task studio-skyways-layout-variety-20261106-054448-01) A building's floor-plan family: `court` (a central lobby court, the atrium
 * buildings' plan), `galleria` (a long spine hall through the building with street doors at its ends), `offset` (a court pushed into
 * the corner toward its bridges, with an L-arm out to the far facades), `cross` (a small central court with arms out to the facades).
 */
export type SkywaysPlan = 'court' | 'galleria' | 'offset' | 'cross';
/** The network's frame family (block grid and empty lots). */
export type SkywaysFamily = 'block-2x2' | 'block-3x2' | 'block-2x3' | 'cluster-3x3' | 'chain-4x2';
/** The bridge graph's character: a tree (branches, dead ends) or looped. */
export type SkywaysTopology = 'tree' | 'looped';

export interface SkywaysBuilding {
  /** Stable id within the layout ('B0' ...). */
  id: string;
  /** Printed fictional name ("Calder Place"). */
  name: string;
  role: SkywaysBuildingRole;
  /** Exterior footprint: the OUTER faces of its perimeter wall (world m). */
  rect: SkywaysRect;
  /** Absolute y of the top of its exterior shell (scenery: the tower rises far above the playable storeys). */
  top: number;
  /** Storeys (layout.levels ids) it has interiors on. */
  levels: number[];
  /** A glazed atrium: the skyway slab is open over `rect` (railed), the street-level court below, a glass roof at `roofY`. */
  atrium?: {rect: SkywaysRect; roofY: number};
  /** Floor-plan family (layout-variety pass). */
  plan?: SkywaysPlan;
  /** The building's FOOD COURT (food counters round a seated court): its storey and the court's area (layout.areas index). */
  foodCourt?: {level: number; area: number};
}

export interface SkywaysBridge {
  id: string;
  /** Storey of its deck (the skyway level). */
  level: number;
  /** layout.areas index of the deck. */
  area: number;
  /** The two buildings it joins (ids). */
  a: string;
  b: string;
  /** Deck rect (world m) between the two facades; axis = the direction it spans. */
  rect: SkywaysRect;
  axis: 'x' | 'z';
  width: number;
  length: number;
  /** Starts with broken panes and gas already flowing across it (a mask is needed). */
  breached: boolean;
  /** (layout version 3, task studio-skyways-rework-20261107-054512-01) the glazed roof: its cross-section, the absolute y where it
   *  springs from the glazed side walls (the side glazing's head) and its apex (the deck's ceiling); ribs every `rib` m. */
  roof?: SkywaysBridgeRoof;
}

/** A bridge's glazed roof (world/skywaysArch.ts draws it; the deck's area ceiling = apexY). */
export interface SkywaysBridgeRoof { style: 'vault' | 'faceted' | 'gable' | 'flat'; springY: number; apexY: number; rib: number }

/** (layout version 3, task studio-skyways-rework-20261107-054512-01, lane ARCH: gen/skyways/skylights.ts) a skylight coffer in a
 *  skyway-level public court's ceiling: its rect (world m), the court's ceiling line and the well's glazed top (absolute y). */
export interface SkywaysSkylight { level: number; area: number; rect: SkywaysRect; ceilY: number; topY: number }

export interface SkywaysStreet {
  /** Road + sidewalks between two building rows (world m; street level). */
  rect: SkywaysRect;
  axis: 'x' | 'z';
}

/**
 * A glazed span in a SOLID wall run (same shape as the Office's StoreyWindow so world/officeWindows.ts planWindows can plan it):
 * x0..x1 / z0..z1 = the wall cells' box, `side` = the outward facing, sill / head ABOVE `baseY`.
 */
export interface SkywaysWindow extends SkywaysRect {
  side: Side;
  sill: number;
  head: number;
  /** 'entrance' = a building's boarded street doors (sill 0): scenery, never breakable (the Office's lobby entrance rule). */
  kind: 'window' | 'entrance';
  level: number;
  baseY: number;
  /** What the glass belongs to: a bridge side, a building facade (street lobbies / skyway concourse) or an atrium. */
  host: {bridge: string} | {building: string};
  /** Pre-breached: panes start broken and are gas sources from the first frame. */
  breached?: boolean;
}

/** Where the prize car stands at generation (the runtime persists its later pose per station). */
export interface SkywaysCarSpawn {
  x: number;
  /** Absolute floor y under the car. */
  y: number;
  z: number;
  /** Heading (rad, camera convention: forward = (-sin yaw, -cos yaw)). */
  yaw: number;
  level: number;
  area: number;
}

/** A static mascot statue (the convention's supplied anime figure in a baked pose). */
export interface SkywaysStatue {
  /** Baked pose id (a node of assets/models/skyways-mascot-poses.glb). */
  pose: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  level: number;
  /** Uniform scale over the pose's authored size. */
  scale: number;
  /** What it is doing there (QA / tests): 'entrance-wave', 'washroom-point', 'stage', ... */
  role: string;
}

export interface SkywaysAddon {
  id: SkywaysAddonId;
  /** Host building id and storey. */
  building: string;
  level: number;
  /** The main hall (world m) and every add-on area (hall + support rooms; layout.areas ids). */
  hall: SkywaysRect;
  areas: number[];
  /** The opening from the ordinary network into the hall (stand point on the network side). */
  entry: {x: number; z: number; level: number};
  /** 'prize-car': the car (one per station). */
  car?: SkywaysCarSpawn;
  /** 'convention': the stage box and the mascot statues. */
  convention?: {stage: SkywaysRect; statues: SkywaysStatue[]};
  /** How the hall attaches to its host's lobby: straight off it, or through a pre-function foyer / showroom approach (in `areas`). */
  approach?: 'direct' | 'foyer';
}

/** The ramen restaurant of the base shop pool (exactly one per Skyways; its edible food is ordinary finite loot). */
export interface SkywaysRestaurant {
  area: number;
  /** Kitchen / back room (layout.areas id), if carved. */
  kitchen?: number;
  building: string;
  level: number;
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Destinations (task studio-skyways-destinations-20261106-170011-01): large ANCHOR shops and LANDMARK courts

/** Destination shop families (each a distinct large-format anchor with its own kit; a seeded rotation per map). */
export const SKYWAYS_SHOP_FAMILIES = ['books', 'outfitter', 'music', 'hobby', 'design', 'garden', 'arcade', 'cinema', 'science', 'hockey'] as const;
export type SkywaysShopFamily = (typeof SKYWAYS_SHOP_FAMILIES)[number];
/**
 * An anchor's large format: `hall` (one big sales floor), `two-level` (the same footprint on the street and skyway levels joined by
 * an internal open stair: a sales floor and a mezzanine floor), `double-height` (a street-level hall rising through the skyway
 * storey: nothing carved above), `multi-zone` (a front hall and a second room behind it: the cinema's lobby + auditorium, the music
 * store's listening booths).
 */
export type SkywaysAnchorFormat = 'hall' | 'two-level' | 'double-height' | 'multi-zone';

export interface SkywaysAnchor {
  id: string;
  family: SkywaysShopFamily;
  /** Printed shop name (its fascia). */
  name: string;
  building: string;
  /** The storey its entrance (storefront) is on, and its format. */
  level: number;
  format: SkywaysAnchorFormat;
  /** The main sales floor (layout.areas id), its rect (world m) and its storefront (layout.storefronts id). */
  floor: number;
  rect: SkywaysRect;
  storefront: number;
  /** The open side of the sales floor toward its storefront (the shop's front). */
  front: Side;
  /** two-level: the upper floor (area id, storey level + 1, the same rect) and the internal stair's link (layout.levelLinks index). */
  upper?: number;
  /** multi-zone: the second room(s) behind / beside the floor (area ids: the auditorium, listening booths). */
  zones: number[];
  /** Back rooms (stock room / office: area ids, staff doors from the floor). */
  stock: number[];
  /** Absolute y of the sales floor's ceiling (double-height: above the skyway storey's floor). */
  ceilY: number;
}

/** Landmark families: a recognisable centrepiece making a court a named destination and a wayfinding anchor. */
export const SKYWAYS_LANDMARK_FAMILIES = ['clock', 'dinosaur', 'fig-tree', 'fountain', 'geese', 'orrery'] as const;
export type SkywaysLandmarkFamily = (typeof SKYWAYS_LANDMARK_FAMILIES)[number];

export interface SkywaysLandmark {
  id: string;
  family: SkywaysLandmarkFamily;
  /** The court's name ("Clock Court"). */
  name: string;
  building: string;
  level: number;
  /** The court area (layout.areas id; relabelled with the court's name) and the centrepiece's spot (world m, floor y). */
  area: number;
  x: number;
  z: number;
  y: number;
  /** Clear radius (m) kept round the centrepiece and its clear height above the floor. */
  radius: number;
  height: number;
  /** An atrium court (double height under the glass) or an ordinary lobby / skyway court. */
  atrium: boolean;
}

/** layout.skyways (written by gen/skyways/index.ts). */
export interface SkywaysInfo {
  version: 1;
  /** Display name of the complex ("Calder +15"). */
  name: string;
  /** Street level (absolute y): the exterior ground. */
  groundY: number;
  storeys: SkywaysStorey[];
  buildings: SkywaysBuilding[];
  bridges: SkywaysBridge[];
  streets: SkywaysStreet[];
  windows: SkywaysWindow[];
  addon: SkywaysAddon;
  restaurant: SkywaysRestaurant | null;
  /** Platform start (station level) = layout.playerSpawn. */
  start: OfficePose;
  /** Bounds of every building footprint (world m): the exterior scenery goes around / between them. */
  exterior: SkywaysRect;
  /** (layout-variety pass) The frame family and the bridge graph's character. */
  family?: SkywaysFamily;
  topology?: SkywaysTopology;
  /** Underground pedway links from the station concourse up into other buildings' lobbies (building ids). */
  pedways?: string[];
  /** (destinations pass) The large anchor shops and the landmark courts. */
  anchors?: SkywaysAnchor[];
  landmarks?: SkywaysLandmark[];
  /** (layout version 3, lane ARCH) The skylight coffers of the skyway-level courts (gen/skyways/skylights.ts). */
  skylights?: SkywaysSkylight[];
}
