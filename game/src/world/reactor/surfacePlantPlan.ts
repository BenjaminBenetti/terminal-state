// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (primary contract; lane PLANT owns the body): THE REACTOR'S
// SURFACE PLANT — a pure, seeded, deterministic plan (no three.js) of the purpose-built ventilation facility round the ONE roof aperture:
// the concrete collar / apron / retaining walls / buttresses / service walkways round the yard and one or two VENT TOWERS carrying the
// Reactor's existing big extraction fans (world/reactor/archAssets.ts REACTOR_MODELS.fanHousing + the procedural 'blade' rotor).
// The city (surfacePlan.ts planSurfaceCity) never builds on `reserved`; the builder (surfacePlant.ts, lane PLANT) draws the plan.
// Contract: everything stands OFF the walkable cells (site.walk) and outside the aperture's keep-off radius (site.hole.keepR), the
// opening stays open (one aperture, the beam unobstructed); nothing here changes the generator, the grid, collision or navigation.

import type {ReactorRect} from '../../gen/reactor/reactorTypes';
import type {CityFootprint} from './surfacePlan';
import type {SurfaceSite} from './surfaceSite';

/** One vent tower: its footprint centre / yaw, the stack's size (m) and its fan (radius, hub world y, axis: 'up' = blowing skyward). */
export interface VentTowerPlan {
  id: number;
  x: number; z: number; yaw: number;
  /** Plinth / stack half extents and height (m above the deck). */
  hw: number; hd: number; h: number;
  fan: {radius: number; hubY: number; axis: 'up' | 'side'};
}

export interface SurfacePlantPlan {
  towers: VentTowerPlan[];
  /** Footprints the city must leave free (towers, plant structures beyond the parapet). */
  reserved: CityFootprint[];
}

/** Plan the plant (same inputs, same plan). Stub until lane PLANT lands: no towers, nothing reserved. */
export function planSurfacePlant(_site: SurfaceSite, _seed: number, _pit?: ReactorRect): SurfacePlantPlan {
  return {towers: [], reserved: []};
}
