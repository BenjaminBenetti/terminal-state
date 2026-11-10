// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL wires the shaders): the RIDE MASK — one
// world-axis-aligned box in which the station's baked light field reads ZERO on surfaces and in the haze, and the haze has the plain
// tunnel medium. The ride tunnel is rock-bound whatever the layout has in that volume (a lit hall behind a bed end must not light the
// tunnel's walls or its fog), and it is the same in a station's portal and in the transit, so nothing changes at a hand-over.
//
// Uniform values only (no program change): `box` empty = off (every level, every frame outside a ride: exactly as before).
// `fade` = metres over which the field fades in toward the box's `open` face (the portal plane: station light spills a little way in).
//
// Lane PORTAL: where it is read — world/lightFieldNode.ts (RM: plain render-group uniforms copied from RIDE_MASK when its `version`
// changes, every frame from the field levels' sync and at every field bind): lightFieldSample() scales the field by rideMaskGain (so
// surfaces and the haze's in-scatter agree), and the volumetric march (render/volumetricShaders.ts) takes the plain track-bed medium
// inside the box (the bed multiplier `bedMult`, the box's floor = its bed, the full track draft); render/atmosphere.ts mediumAt mirrors
// the medium, rideMaskGain below the field gain. The gas terms are never touched (what hurts stays visible).

import type {Box3} from './ridePortal';

export interface RideMaskState {
  on: boolean;
  box: Box3;
  /** World x of the box face the station is on (the portal plane), or NaN: no open face (the transit: the whole box is dark). */
  openX: number;
  fade: number;
  /**
   * The haze's density multiplier inside the box: the station's plain track-bed medium (render/atmosphere.ts rideBedMultiplier, set by
   * the portal runtime when it binds a station; kept when the mask is cleared — the transit uses the last station's).
   */
  bedMult: number;
}

/** How far the box's floor lies below its bed (world/ridePortal.ts RIDE_PORTAL.skin; the transit box uses the same, world/trainTransitTunnel.ts). */
export const RIDE_MASK_SKIN = 0.03;

/** The current mask (one object; the shader uniforms copy it when it changes: `version`). */
export const RIDE_MASK: RideMaskState & {version: number} = {
  on: false, box: {x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0}, openX: Number.NaN, fade: 4, bedMult: 1.5, version: 0,
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

/**
 * Lane PORTAL: the haze's track-bed multiplier inside the box (the portal runtime, per station). It does NOT bump `version` (the
 * ride and the runtime tell their own mask by it); the shader sync compares the value itself.
 */
export function setRideBedMedium(mult: number): void {
  if (Number.isFinite(mult)) RIDE_MASK.bedMult = mult;
}

/** Lane PORTAL: is world point (x, y, z) inside the mask's box (open intervals; never while off)? CPU mirror of lightFieldNode rideMaskInside. */
export function inRideMask(m: Pick<RideMaskState, 'on' | 'box'>, x: number, y: number, z: number): boolean {
  const b = m.box;
  return m.on && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;
}

/**
 * Lane PORTAL: the factor on the baked light field at world point (x, y, z) — 1 outside the box (exactly: off = the field as before);
 * inside, 1 at the open face down to 0 `fade` m in (0 everywhere in a box without an open face). CPU mirror of lightFieldNode rideMaskAt.
 */
export function rideMaskGain(m: Pick<RideMaskState, 'on' | 'box' | 'openX' | 'fade'>, x: number, y: number, z: number): number {
  if (!inRideMask(m, x, y, z)) return 1;
  if (!Number.isFinite(m.openX)) return 0;
  return Math.min(1, Math.max(0, 1 - Math.abs(x - m.openX) / Math.max(m.fade, 1e-3)));
}
