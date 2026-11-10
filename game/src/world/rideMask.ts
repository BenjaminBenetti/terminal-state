// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL wires the shaders): the RIDE MASK — one
// world-axis-aligned box in which the station's baked light field reads ZERO on surfaces and in the haze, and the haze has the plain
// tunnel medium. The ride tunnel is rock-bound whatever the layout has in that volume (a lit hall behind a bed end must not light the
// tunnel's walls or its fog), and it is the same in a station's portal and in the transit, so nothing changes at a hand-over.
//
// Uniform values only (no program change): `box` empty = off (every level, every frame outside a ride: exactly as before).
// `fade` = metres over which the field fades in toward the box's `open` face (the portal plane: station light spills a little way in).

import type {Box3} from './ridePortal';

export interface RideMaskState {
  on: boolean;
  box: Box3;
  /** World x of the box face the station is on (the portal plane), or NaN: no open face (the transit: the whole box is dark). */
  openX: number;
  fade: number;
}

/** The current mask (one object; the shader uniforms copy it when it changes: `version`). */
export const RIDE_MASK: RideMaskState & {version: number} = {
  on: false, box: {x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0}, openX: Number.NaN, fade: 4, version: 0,
};

/** Set (or clear with null) the ride mask. */
export function setRideMask(box: Box3 | null, openX: number = Number.NaN, fade = 4): void {
  const m = RIDE_MASK;
  if (!box) {
    if (!m.on) return;
    m.on = false;
    m.box = {x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0};
    m.openX = Number.NaN;
  } else {
    m.on = true;
    m.box = {...box};
    m.openX = openX;
    m.fade = fade;
  }
  m.version++;
}
