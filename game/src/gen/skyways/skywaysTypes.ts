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
}

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
  kind: 'window';
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
}
