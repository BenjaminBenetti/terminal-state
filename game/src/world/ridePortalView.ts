// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL implements): the STATIC look of the ride
// portals — a headwall with a steel gate in each closed bed end of the parked car's track (world/ridePortal.ts 'gate' portals), built
// with the world (world/builder.ts) instead of that end's black plane and barricade. The gate's leaves move (world/ridePortalRuntime.ts).
//
// LEAD STUB: builds nothing and claims no bed end, so the world is exactly as before until lane PORTAL fills it in.

import type * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {WorldMaterials} from './materials';
import type {RidePortal} from './ridePortal';

/** One gated bed end: its portal, the moving leaves (hinged at the opening's sides) and anything else the runtime animates. */
export interface RideGateView {
  portal: RidePortal;
  /** The opening's two leaves: `pivot` rotates about +Y at the hinge (0 = shut; the runtime sets the angle). */
  leaves: {pivot: THREE.Object3D; sign: 1 | -1}[];
}

export interface RideGatesBuilt {
  /** By `${trench}:${end}` (world/ridePortal.ts portalEndKey). */
  gates: Map<string, RideGateView>;
  stats: {meshes: number; triangles: number};
}

/**
 * `${trench}:${end}` of the bed ends whose black plane / barricade the builders leave out because a ride gate stands there.
 * (Stub: none. Lane PORTAL: world/ridePortal.ts gatedEnds(layout, playerTrainPlacement(layout)).)
 */
export function staticGateEnds(_layout: StationLayout): Set<string> {
  return new Set();
}

/** Build the static gates of `layout` into `group` (null: the level has none). */
export function buildRideGates(_group: THREE.Group, _layout: StationLayout, _mats: WorldMaterials): RideGatesBuilt | null {
  return null;
}
