// Task studio-bunker-level-20261109-072224-01: THE BUNKER — the shared CONTRACT between the level generator (gen/bunker/*), the level
// registration / integration and the objective runtime (world/bunker/*). Pure types + constants (no three.js, no imports from either
// side), so every lane builds against the same shape.
//
// The level: the player's train stops at a buried station (storey 0, y 0); a functional vault door leads into a civil-defence bunker
// that DESCENDS through several real storeys (negative world y) of distinct programmes down to the CENTRAL PROCESSING CORE on the lowest
// walkable storey. Optional objective: three distributed auxiliary generators (the Reactor's generator model), each needs ONE poured
// fuel can unit, then the familiar turnkey start; with all three online the core's computer cluster comes alive and grants map intel
// once per Bunker station. Nothing here is the Reactor's objective state: a Bunker never sets `layout.reactor` or uses its lanes.

/** The prop kind of an auxiliary generator slot (drawn / animated / interacted with by world/bunker; collision from its footprint). */
export const BUNKER_GENERATOR_KIND = 'bunkerGenerator' as const;
/** The Reactor's auxiliary generator model (assets/reactorKit.generated.ts REACTOR_KIT.generator: 5.6 x 2.4844 x 1.6734 m, front +Z). */
export const BUNKER_GENERATOR_DIMS = {w: 5.6, h: 2.4844, d: 1.6734} as const;
/** The prop kind of the core's computer cluster (the big animated screen wall + the operator terminal; drawn by world/bunker). */
export const BUNKER_CORE_KIND = 'bunkerCoreCluster' as const;
/** The core cluster's footprint: a wall of cabinets with the big screen above them and the terminal desk in front (front +Z). */
export const BUNKER_CORE_DIMS = {w: 6.0, h: 3.6, d: 2.2} as const;
/** How many generators the objective needs (each takes exactly ONE fuel can unit). */
export const BUNKER_GENERATOR_COUNT = 3;

/** One storey of the complex (layout.levels[level]; baseY decreasing with depth). */
export interface BunkerStorey {
  level: number;
  baseY: number;
  /** Display label ("Station", "Level 1 — Habitation", …; the HUD storey line / directory signs). */
  label: string;
  /** The storey's main programme ('station' | 'entry' | 'habitation' | 'services' | 'maintenance' | 'core' | …). */
  programme: string;
}

/** One generator slot: a PropPlacement of kind BUNKER_GENERATOR_KIND exists at the same place (layout.props[prop]). */
export interface BunkerGeneratorSlot {
  /** Stable id within the layout ('gen-0' … 'gen-2'): the objective state is keyed by it. */
  id: string;
  /** Index into layout.props. */
  prop: number;
  level: number;
  x: number;
  y: number;
  z: number;
  /** Yaw (radians, the prop convention); the model's front (+Z, the control box side) faces the room. */
  rot: number;
  area: number;
  /** Player-facing location ("Habitation plant room", …). */
  label: string;
}

/** The core's computer cluster: a PropPlacement of kind BUNKER_CORE_KIND at the same place (layout.props[prop]). */
export interface BunkerCoreInfo {
  prop: number;
  level: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  area: number;
}

/** A local gas leak: a seed set of cells on one storey's grid (gas field source) and its strength (0..1 of the field's maximum). */
export interface BunkerGasZone {
  id: string;
  level: number;
  /** Grid cell indices (layout.levels[level].grid.idx) where the leak emits. */
  cells: number[];
  strength: number;
}

/**
 * Task studio-bunker-rework-20261109-205115-01: the CARGO LIFT of a version-2 Bunker (gen/bunker/v2/liftPlan.ts; runtime
 * world/bunker/cargoLift.ts). World metres. The shaft is solid on every storey grid; the car is a moving Levels volume inside it.
 */
export interface BunkerLiftInfo {
  /** The car's interior footprint and the shaft's outer box (incl. its 0.5 m walls). */
  cab: {x0: number; z0: number; x1: number; z1: number};
  shaft: {x0: number; z0: number; x1: number; z1: number};
  /** The gate's side at every stop, its opening centre on the car's edge and clear width. */
  doorSide: 'N' | 'S' | 'E' | 'W';
  door: {x: number; z: number; width: number};
  /** The car's clear height and the gate's clear height above a stop floor. */
  cabHeight: number;
  gateHeight: number;
  /** Stops top-down by storey (stops[i].level === i): the storey floor, the landing area (the floor's area over the apron), the
   *  landing stand point in front of the gate and the landing's call panel (on the shaft face beside the gate). */
  stops: {level: number; y: number; area: number; landing: {x: number; z: number}; callPanel: {x: number; y: number; z: number}}[];
  /** The stop the car stands at, gates shut, until it has power (the station). */
  home: number;
}

/** layout.bunker — set by gen/bunker for every Bunker layout (absent on every other level). */
export interface BunkerInfo {
  /** 1 = the first Bunker (frozen); 2 = the inhabited rework with the cargo lift (task studio-bunker-rework-20261109-205115-01). */
  version: 1 | 2;
  name: string;
  storeys: BunkerStorey[];
  /** The vault door at the entrance (a functional door: never locked; collision correct from both sides). */
  vaultDoor: {prop: number; level: number; x: number; z: number; rot: number};
  generators: BunkerGeneratorSlot[];
  core: BunkerCoreInfo;
  gasZones: BunkerGasZone[];
  /** Area ids of damp / water-damaged sections (Strainer habitat, wetness). */
  damp: number[];
  start: {x: number; z: number; yaw: number; level: number};
  /** Version 2: the cargo lift, the double-height voids (lower storey's hall open through the upper storey), the floors' titles. */
  lift?: BunkerLiftInfo;
  voids?: {id: string; lower: number; upper: number; rect: {x: number; y: number; w: number; h: number}; ceil: number}[];
  floors?: string[];
}
