// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER): WHERE the train's woodchipper stands in the car — pure data from the
// car spec (world/playerTrainSpec.ts) and the machine's model contract (world/chipperSpec.ts CHIPPER_SIZE). No three.js, no Game: the
// parked colliders (world/playerTrain.ts trainColliders), the ride's car-local model (world/trainRideLocal.ts) and the runtime
// (world/chipper.ts) all read this one placement, so the machine collides exactly where it is drawn.
//
// THE POCKET: the far-side (+Z) wall bay between the MIDDLE and the FRONT door pairs (the bay under the +Z saloon window there), centred
// between the two doors' jambs, its back CHIPPER_CLEAR off the +Z lining (the Lockbox's clearance), standing on the car floor, its top
// below the window sill. The model's +Z FRONT faces the aisle: yaw PI, so the model's -X hopper end points toward the cab (+X) and model
// (mx, my, mz) is train-local (x - mx, floorY + my, z - mz). Every train has one (a fixed component of the car, never cargo / loot).

import {LOCKBOX_CLEAR, PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {CHIPPER_SIZE} from './chipperSpec';

/** The machine's back stands this far off the +Z lining (m; the Lockbox's clearance). */
export const CHIPPER_CLEAR = LOCKBOX_CLEAR;

export interface ChipperPlacement {
  /** Footprint centre (train-local x / z), the interior floor it stands on (train-local y). */
  x: number; z: number; floorY: number;
  /** Rotation about +Y (PI: the model's +Z front faces the aisle, -Z train-local). */
  yaw: number;
  /** Runtime size (m): along the car (x), height, across the car (z). */
  length: number; height: number; depth: number;
  /** The wall bay it stands in (train-local x): the middle door pair's +X jamb .. the front pair's -X jamb on the +Z side. */
  bay: {x0: number; x1: number};
}

const cache = new WeakMap<PlayerTrainSpec, ChipperPlacement | null>();

/** The chipper's placement in a car (null: the spec has no +Z bay between a middle and a front door pair long enough for it). */
export function chipperPlacement(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): ChipperPlacement | null {
  if (cache.has(spec)) return cache.get(spec)!;
  const far = spec.doors.filter(d => d.side === 1).sort((a, b) => a.x - b.x);
  // the middle pair: the +Z door nearest the car's centre; the front pair: the next one toward the cab
  let mid = -1;
  far.forEach((d, i) => { if (mid < 0 || Math.abs(d.x) < Math.abs(far[mid].x)) mid = i; });
  const a = far[mid], b = far[mid + 1];
  let p: ChipperPlacement | null = null;
  if (a && b) {
    const x0 = a.x + a.width / 2, x1 = Math.min(b.x - b.width / 2, spec.cab.x0);
    const S = CHIPPER_SIZE, hw = spec.interior.halfWidth;
    if (x1 - x0 >= S.l && 2 * hw >= S.d + CHIPPER_CLEAR) {
      const r = (v: number) => Math.round(v * 10000) / 10000;
      p = Object.freeze({
        x: r((x0 + x1) / 2), z: r(hw - CHIPPER_CLEAR - S.d / 2), floorY: spec.floorY, yaw: Math.PI,
        length: S.l, height: S.h, depth: S.d, bay: Object.freeze({x0: r(x0), x1: r(x1)}),
      }) as ChipperPlacement;
    }
  }
  cache.set(spec, p);
  return p;
}

/** Train-local footprint of the machine (x0 < x1, z0 < z1). */
export function chipperFootprint(c: ChipperPlacement): {x0: number; x1: number; z0: number; z1: number} {
  const side = Math.abs(Math.sin(c.yaw)) > 0.5;
  const hx = (side ? c.depth : c.length) / 2, hz = (side ? c.length : c.depth) / 2;
  return {x0: c.x - hx, x1: c.x + hx, z0: c.z - hz, z1: c.z + hz};
}

/** A point of the model frame (world/chipperSpec.ts: bottom centre origin, +Z front) -> train-local (exact for yaw PI). */
export function chipperToLocal(c: ChipperPlacement, mx: number, my: number, mz: number, out: {x: number; y: number; z: number} = {x: 0, y: 0, z: 0}): {x: number; y: number; z: number} {
  const cy = c.yaw === Math.PI ? -1 : Math.cos(c.yaw), sy = c.yaw === Math.PI ? 0 : Math.sin(c.yaw);
  out.x = c.x + mx * cy + mz * sy;
  out.y = c.floorY + my;
  out.z = c.z - mx * sy + mz * cy;
  return out;
}

/** A direction of the model frame -> train-local. */
export function chipperDirToLocal(c: ChipperPlacement, dx: number, dy: number, dz: number, out: {x: number; y: number; z: number} = {x: 0, y: 0, z: 0}): {x: number; y: number; z: number} {
  const cy = c.yaw === Math.PI ? -1 : Math.cos(c.yaw), sy = c.yaw === Math.PI ? 0 : Math.sin(c.yaw);
  out.x = dx * cy + dz * sy;
  out.y = dy;
  out.z = -dx * sy + dz * cy;
  return out;
}
