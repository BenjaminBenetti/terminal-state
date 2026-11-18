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
// Version 2: the Subway's way up is a cargo lift at a closed street exit (gen/surface/accessLift.ts); the Office / Mall walk out on foot
// through a level canvas CONNECTOR tube from that same version-1 doorway (task studio-surface-host-ground-connectors-20261118-053602-01:
// gen/surface/accessConnector.ts — no lift: both exit at ground level).
// Writes layout.surfaceAccess (gen/surface/surfaceTypes.ts SurfaceAccessInfo).
//
// Lane ACCESS: a station whose roll is present but has no room for an access (never seen for a generated Subway / Office / Mall:
// tests/surface-access.test.ts sweeps the seeds) simply has none — the crossing is never offered, nothing is half-carved.

import type {StationLayout} from '../stationTypes';
import {surfaceFeatures, surfacePresent, type SurfaceHost} from './surfaceRun';
import {carveSubwayAccess} from './accessStair';
import {carveSubwayLift} from './accessLift';
import {carveMallAccess, carveOfficeAccess} from './accessDoor';
import {carveMallConnector, carveOfficeConnector} from './accessConnector';

/** Adds the station's surface access when present for its version / roll; returns whether it did. */
export function applySurfaceAccess(layout: StationLayout, host: SurfaceHost, levelSeed: number, version: number): boolean {
  if (!surfacePresent(host, levelSeed, version)) return false;
  if (layout.surfaceAccess) return true; // (idempotent: never carved twice)
  // (version 2, lane ACCESS follow-up: the Subway's way up is a cargo lift at a normal closed street exit — gen/surface/accessLift.ts;
  // a station whose closed halls cannot take it keeps the version-1 stairwell, its record saying so: v 1)
  // (version 2, task studio-surface-host-ground-connectors-20261118-053602-01: an Office / Mall walks out through the connector tube
  // from its version-1 doorway — the same door position / usable exit, so nothing else of the station moves)
  const F = surfaceFeatures(version), v2 = F.closedExitAccess;
  const info = host === 'subway' ? (v2 ? carveSubwayLift(layout, levelSeed) : null) ?? carveSubwayAccess(layout, levelSeed)
    : host === 'office' ? (F.connector ? carveOfficeConnector(layout) : carveOfficeAccess(layout))
    : F.connector ? carveMallConnector(layout, levelSeed) : carveMallAccess(layout, levelSeed);
  if (!info) return false;
  layout.surfaceAccess = info;
  return true;
}
