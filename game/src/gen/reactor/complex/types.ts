// Task reactor-expansion-20261101 (primary): THE SIDE-COMPLEX CONTRACT — the Reactor's three generator complexes that open off the main
// shaft (user feedback: "The generators you need to startup to clear the fog on each level should be in substantial sub complexes coming
// off the main shaft. Think bunkers, old mines, nuclear waste dumps"). Types + the carver signature only; written FIRST so the host lane
// (gen/reactor/index.ts + carve.ts: slots, canvas growth, orchestration) and the three complex lanes (complex/bunker.ts, mines.ts,
// waste.ts) build against one shape in parallel.
//
// Model: the HOST reserves, per complex, a free rectangle of ROCK on one storey's grid beside the pit (the canvas grows to make room) and
// an ENTRANCE span in the pit wall facing a walkway deck of that storey; it then calls the complex's carver ONCE on the shared Kit (canvas
// cells, BEFORE the crop) with that slot. The carver carves its rooms / corridors / halls as areas of THAT storey (k.addArea with the
// slot's level option), connects them with doors (k.carveDoor), connects its entry to the entrance's deck area through the entrance span,
// keeps every cell inside `region`, and places the zone's AUXILIARY GENERATOR inside the complex. After the crop + the station dresser,
// the host calls the returned `dress` hook (props / fixtures / pickups / decor in world metres). A carver that cannot fit its program
// returns null: the host then keeps the generator on the shaft landing (the level stays valid while the lanes build).

import type {Rng} from '../../../core/rng';
import type {Kit} from '../../stationKit';
import type {Rect, StationLayout} from '../../stationTypes';

export type ReactorComplexId = 'bunker' | 'mines' | 'waste';

/** Which complex hosts which zone's generator (the no-deadlock rule: zone k's generator stands in air clean / cleared before zone k). */
export const COMPLEX_OF_ZONE: Readonly<Record<number, ReactorComplexId>> = {0: 'bunker', 1: 'mines', 2: 'waste'};

/** A complex's reserved slot (canvas cells, BEFORE the crop). */
export interface ComplexSlot {
  id: ReactorComplexId;
  /** Gas zone (0-based) whose generator the complex houses. */
  zone: number;
  /** layout.levels index of the storey the complex is carved on, its deck height (absolute y). */
  level: number;
  baseY: number;
  /** Reserved free rock (canvas cells) on `level`: every carved cell stays inside it, 1 cell of wall kept inside its edge. */
  region: Rect;
  /** The doorway span through the pit wall (canvas cells, 1 cell deep) and the deck area in front of it (already carved). */
  entrance: Rect;
  frontArea: number;
  /** Direction from the deck through the entrance INTO the complex. */
  inward: 'N' | 'S' | 'E' | 'W';
  /**
   * Highest absolute ceiling a room may have (the next storey's floor band above minus a slab; rock above the region is solid on every
   * other storey's grid). A big hall may use it; ordinary rooms use the frame's CLEAR heights.
   */
  ceilMax: number;
}

/** What a carver receives. `levelOpt` = the AreaOpts level field for the slot's storey ({} on level 0). */
export interface ComplexCarveInput {
  k: Kit;
  rng: Rng;
  slot: ComplexSlot;
  levelOpt: {level?: number};
}

/** One named space of a complex (for the map boards / HUD / spawns / dressing). */
export interface ComplexRoom {
  area: number;
  key: string;
  /** HUD / map label ("Blast-door lock", "Generator hall", "Drum vault B" …). */
  label: string;
  role: 'entry' | 'corridor' | 'hall' | 'room' | 'store' | 'generator' | 'shaft' | 'vault';
}

/** The zone generator placed inside the complex (canvas cells; the host converts to world metres / ReactorGenerator). */
export interface ComplexGenerator {
  area: number;
  /** Skid footprint (canvas cells; kept prop-free / blocked by the host) and its long axis yaw (rad, camera convention). */
  foot: Rect;
  yaw: number;
  /** Where the player stands to start it (canvas cell centre, walkable, prop-free) and the facing yaw from there to the panel. */
  use: {x: number; y: number; yaw: number};
}

export interface ComplexCarve {
  id: ReactorComplexId;
  slot: ComplexSlot;
  /** Every area id the complex carved (entry first). */
  areas: number[];
  entryArea: number;
  rooms: ComplexRoom[];
  generator: ComplexGenerator;
  /** Human name of the complex ("Bunker 7 — civil-defence shelter", "Old service mine", "Waste repository"). */
  name: string;
  /**
   * Post-crop dressing (the host calls it once, after the station dresser and before the populations): props / fixtures / pickups /
   * decor in WORLD metres (`crop` = the canvas -> grid cell offset the host applied: grid cell = canvas cell - (ox, oy)). Props must
   * follow the root CLAUDE.md prop rules (openable storage opens, movable things move, no baked clutter, real scale).
   */
  dress?(layout: StationLayout, rng: Rng, crop: {ox: number; oy: number}): void;
}

/** A complex lane's carver (gen/reactor/complex/<id>.ts). Pure: draws only from `inp.rng`; null = the program does not fit. */
export type ComplexCarver = (inp: ComplexCarveInput) => ComplexCarve | null;
