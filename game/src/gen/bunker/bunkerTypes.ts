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

/** layout.bunker — set by gen/bunker for every Bunker layout (absent on every other level). */
export interface BunkerInfo {
  version: 1;
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
}
