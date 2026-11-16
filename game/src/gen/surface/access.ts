// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract STUB — lane ACCESS owns the body): the way up / out from a
// Subway / Office / Mall station to its Surface Run district, applied to the host's finished 'main' layout (levels/registry.ts, after the
// enemy roster) only when the station's surface version and its one presence roll allow it (gen/surface/surfaceRun.ts surfacePresent).
// RNG-NEUTRAL: it draws nothing from the station's streams and appends (never re-orders) areas / props / signs, so every existing index,
// census and pinned fingerprint of a station without the access is untouched, and one with it differs only by the appended access.
//  - Subway: an EXTENDED STAIRWELL up from one of the station's sealed street-exit halls (gen/station.ts 'exit-stair'), with a strong
//    occlusion boundary (a closed door at its top: nothing of the city is in the station's world);
//  - Office: a plausible exterior exit from the tower lobby onto the street;
//  - Mall: a plausible exterior exit from the mall's street-level entrance.
// Writes layout.surfaceAccess (gen/surface/surfaceTypes.ts SurfaceAccessInfo).

import type {StationLayout} from '../stationTypes';
import {surfacePresent, type SurfaceHost} from './surfaceRun';

/** Adds the station's surface access when present for its version / roll; returns whether it did. */
export function applySurfaceAccess(layout: StationLayout, host: SurfaceHost, levelSeed: number, version: number): boolean {
  if (!surfacePresent(host, levelSeed, version)) return false;
  void layout; // lane ACCESS: carve the stairwell / exit and write layout.surfaceAccess
  return false;
}
