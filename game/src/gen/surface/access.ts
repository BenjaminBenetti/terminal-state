// Task studio-surface-run-opus-rebuild-20261116-020827-01 (primary, contract; lane ACCESS owns the body): the way up / out from a
// Subway / Office / Mall station to its Surface Run district, applied to the host's finished 'main' layout (levels/registry.ts, after the
// enemy roster) only when the station's surface version and its one presence roll allow it (gen/surface/surfaceRun.ts surfacePresent).
// RNG-NEUTRAL: it draws nothing from the station's streams and appends (never re-orders) areas / props / signs, so every existing index,
// census and pinned fingerprint of a station without the access is untouched, and one with it differs only by the appended access.
//  - Subway: an EXTENDED STAIRWELL up from one of the station's sealed street-exit halls (gen/station.ts 'exit-stair'), with a strong
//    occlusion boundary (a closed door at its top: nothing of the city is in the station's world) — gen/surface/accessStair.ts;
//  - Office: a plausible exterior exit from the tower lobby onto the street — gen/surface/accessDoor.ts carveOfficeAccess (the one
//    in-place change: the barricade pieces in front of the door slide aside for a 1.2 m walk-up — same indices / kinds, moved, never
//    removed; a station without the access is byte-identical to the plain one);
//  - Mall: a plausible exterior exit from the mall's street-level entrance — gen/surface/accessDoor.ts carveMallAccess.
// Writes layout.surfaceAccess (gen/surface/surfaceTypes.ts SurfaceAccessInfo).
//
// Lane ACCESS: a station whose roll is present but has no room for an access (never seen for a generated Subway / Office / Mall:
// tests/surface-access.test.ts sweeps the seeds) simply has none — the crossing is never offered, nothing is half-carved.

import type {StationLayout} from '../stationTypes';
import {surfacePresent, type SurfaceHost} from './surfaceRun';
import {carveSubwayAccess} from './accessStair';
import {carveMallAccess, carveOfficeAccess} from './accessDoor';

/** Adds the station's surface access when present for its version / roll; returns whether it did. */
export function applySurfaceAccess(layout: StationLayout, host: SurfaceHost, levelSeed: number, version: number): boolean {
  if (!surfacePresent(host, levelSeed, version)) return false;
  if (layout.surfaceAccess) return true; // (idempotent: never carved twice)
  const info = host === 'subway' ? carveSubwayAccess(layout, levelSeed) : host === 'office' ? carveOfficeAccess(layout) : carveMallAccess(layout, levelSeed);
  if (!info) return false;
  layout.surfaceAccess = info;
  return true;
}
