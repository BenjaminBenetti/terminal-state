// Task studio-surface-run-field-followup-20261116-211729-01 (primary, contract; lane FOG owns the body and tuning): THE FOG-PRESSURE
// BOUNDARY of a version-2 Surface Run district. User: "Replace the visible perimeter wall with thickening outer fog … Increasing distance
// into outer fog raises pressure." ONE pure field, read by everything that shows or suffers it (the toxic-gas rule: what looks gassy hurts,
// what hurts looks gassy):
//  - lane FOG: the outer fog's density (the visible green volumetric fog thickens with the pressure), the on-foot exposure where gas
//    protection stops fully negating damage ("Gas pressure too high"), the filler blocks hiding the finite edge, the last-resort edge;
//  - lane TRUCK: the dash's red blinking "Fog Pressure" light, the mechanical groans and the truck damage that grow deeper out (the truck
//    loses mobility and breaks down before the geometry edge, even at speed).
// Pure (no three.js / DOM). A district without `surface.boundary` (version 1) has no pressure anywhere: fogPressureAt returns 0.

import type {SRect, SurfaceBoundary} from '../../gen/surface/surfaceTypes';

/** Pressure levels (lane FOG / TRUCK tune them; the names are the contract). Pressure is 0 inside `clear`, 1 at `ramp` metres out. */
export const FOG_PRESSURE = {
  /** The dash light starts blinking / the pressure is reported at all. */
  warn: 0.02,
  /** On foot: gas protection no longer fully negates damage ("Gas pressure too high"). */
  foot: 0.35,
  /** The truck is broken down at or beyond this; on foot nothing survives long. */
  full: 1,
} as const;

/** Metres outside `r` (0 inside or on it): the Chebyshev distance, so the rings are concentric rects. */
export function outsideRect(r: SRect, x: number, z: number): number {
  return Math.max(0, r.x0 - x, x - r.x1, r.z0 - z, z - r.z1);
}

/**
 * The fog pressure at world (x, z): 0 inside the boundary's `clear` rect, rising linearly to 1 at `ramp` metres beyond it and on past 1
 * toward the geometry edge (unclamped above: deeper is worse). 0 everywhere without a boundary (a version-1 district).
 */
export function fogPressureAt(b: SurfaceBoundary | undefined | null, x: number, z: number): number {
  if (!b || !(b.ramp > 0)) return 0;
  return outsideRect(b.clear, x, z) / b.ramp;
}
