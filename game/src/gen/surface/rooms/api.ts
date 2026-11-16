// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract): the INTERIOR PLANNER seam between the district generator
// (lane GEN: gen/surface/index.ts + city files — blocks, streets, footprints, facades, entrances, storeys, outdoor dressing) and the
// building interiors (lane ROOMS: gen/surface/rooms/** — each enterable building's programme plan, rooms, stairs, dressing, loot holders,
// interior enemies, window spans). GEN owns the district Kit and calls `planInterior` once per enterable building, in building-id order,
// each with its own forked Rng (RNG-neutral across buildings: one building's plan never moves another's draws).
//
// Coordinates: the Kit's grid cells (0.5 m; cell (x, y) covers world X [x*CELL, (x+1)*CELL), Z [y*CELL, (y+1)*CELL)), level = Kit
// level grid index (0 = street). The plot's `rect` is the building's OUTER wall footprint in cells: its border ring (1 cell) is the
// facade wall (SOLID; GEN leaves it SOLID except the entrance cells it lists). The planner carves everything inside the ring on every
// storey in `floors`, cuts no other facade cell (window spans sit IN the facade ring: they stay SOLID wall cells), and keeps each entrance's
// inner cell connected to the interior.

import type {Rng} from '../../../core/rng';
import type {Kit} from '../../stationKit';
import type {PropPlacement} from '../../props';
import type {LightPlacement, PickupPlacement, Rect, Side, SignPlacement, ZombieSpawn} from '../../stationTypes';
import type {LevelLink} from '../../levels';
import type {SurfaceBuilding, SurfaceEntrance, SurfaceRecoverable, SurfaceWindowSpan} from '../surfaceTypes';

export interface InteriorFloor {
  /** Kit level grid index (0 = street level). */
  level: number;
  /** Absolute floor y and ceiling y of this storey inside the building. */
  y: number;
  ceil: number;
}

/** A street doorway GEN planned in the facade ring (cells), with the outdoor area it opens onto. */
export interface PlannedEntrance {
  side: Side;
  /** The doorway's facade-ring cells (x, y) on level 0 (GEN carves them FLOOR when the planner keeps the entrance). */
  cells: {x: number; y: number}[];
  /** Is it the main (shopfront / lobby) entrance or a side / service door. */
  main: boolean;
  /** The outdoor area id on the other side. */
  outer: number;
}

export interface InteriorPlot {
  kit: Kit;
  building: SurfaceBuilding;
  /** Outer wall footprint in cells (inclusive ring = facade). */
  rect: Rect;
  floors: InteriorFloor[];
  entrances: PlannedEntrance[];
  /** The building's own generation stream (forked from the district seed by building id). */
  rng: Rng;
  /** Index the planner's first area will take (kit.areas.length at call time) — for stable ids in tests. */
  firstArea: number;
}

export interface InteriorPlan {
  /** Interior area ids the planner added (every one of them, all storeys). */
  areas: number[];
  /** Entrances it kept (GEN carves their cells and records them on the building); the area each opens into is filled in. */
  entrances: SurfaceEntrance[];
  props: PropPlacement[];
  lights: LightPlacement[];
  signs: SignPlacement[];
  pickups: PickupPlacement[];
  /** Interior enemies: PERMANENT (ordinary layout.zombies: kills remembered, never respawned). */
  zombies: ZombieSpawn[];
  /** Facade window spans of the rooms behind the facade (gen/surface/surfaceTypes.ts SurfaceWindowSpan; `building` / `room` filled). */
  windows: SurfaceWindowSpan[];
  /** Stair links between its storeys (ramps carved in the Kit's level grids, shared ramps list). */
  links: LevelLink[];
  /** The depot programme only: its recoverable train units / upgrade kits (gen/surface/surfaceTypes.ts SurfaceRecoverable). */
  recoverables?: SurfaceRecoverable[];
  /**
   * Lane ROOMS: programme data other lanes draw / use (pure data). The depot: `features.depot` = rooms/depot.ts DepotFeatures (the shed's
   * rail tracks, the inspection pit, the overhead crane, the kept dolly-lane cells, the loading-bay entrance id).
   */
  features?: Record<string, unknown>;
}
// Lane ROOMS (planInterior): indices in a plan are PLAN-LOCAL where noted — props[].host indexes plan.props and links[].id plan.links
// (the caller rebases both when it appends the plan to the district's lists: layout.levelLinks[id] must be that link). links[].traversalId
// is Kit-global (kit.flights: the district's layout.traversal.stairs must be kit.flights itself). Heights are absolute (props / lights /
// pickups / zombies y; window sill / head stay relative to their storey floor) — the caller lifts nothing again.

export type InteriorPlanner = (plot: InteriorPlot) => InteriorPlan;
