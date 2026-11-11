// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane RIDE): the pure maths of RIDE MODE (no three.js scene, no Game).
//
// 1. The car-local collision world. While the train moves the player lives in the TRAIN-LOCAL frame: the station's static train
//    colliders / DynamicVolume stay where the car was parked, so the ride steps the player against its own small model of the car
//    interior, built once from PLAYER_TRAIN_SPEC: a Grid (0.5 m cells, floor = spec.floorY, ceiling = spec.ceilingY, the partition
//    doorways' heads lower) wrapped as a one-level Levels, and exact prop boxes for the side walls (the closed side doors ARE wall),
//    end walls, the cab partition and the rear partition with their open doorways, the console, the Lockbox and the chipper. Player.update runs
//    unchanged against it (same speeds, stance, crouch headroom, jump / landing; no ladders; the floor never drops), so ride mode
//    reuses player.ts' logic rather than re-implementing it. The STEP frame = train-local + (RIDE_FRAME.ox, RIDE_FRAME.oz) (grid
//    indices are non-negative); y is train-local (rail top = 0, the floor at spec.floorY).
// 2. The car pose (CarPose: world position of the local origin + yaw / pitch / roll; three.js Euler order 'YZX' = R_y · R_z · R_x)
//    and its exact local <-> world maps. With pitch = roll = 0 and yaw 0 / PI they equal gen/playerTrain.ts trainToWorld /
//    worldToTrain bit for bit (cos / sin taken exactly), so a parked car and a riding player agree with the parked colliders.
// 3. The jostle: subtle lateral / roll sway, a little pitch and rail-joint bumps of the CAR (therefore the player's view: the player
//    stands on the car floor, the camera takes the car's tilt), scaled by speed and a Settings-respecting intensity (0..1), bounded.

import {CELL, FLOOR, Grid, SOLID} from '../gen/grid';
import {Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';
import {PropIndex} from '../core/physics';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {TRAIN_VIEW, partitionsOf} from './playerTrainView';
import {lockboxFootprint} from './trainLockbox';
import {consoleLocalRect, type ConsoleRect} from './trainConsole';
import {chipperFootprint, chipperPlacement} from './chipperPlace';

export interface P3 { x: number; y: number; z: number }

/** The step frame: train-local + (ox, oz) (m); `wall` = the thickness of the collision walls outside the lining. */
export const RIDE_FRAME = {ox: 10, oz: 3, wall: 0.4} as const;

export interface RideLocalModel {
  spec: PlayerTrainSpec;
  /** The interior as a one-level Levels over `grid` (step frame). */
  levels: Levels;
  grid: Grid;
  /** The collision boxes (step frame; grounded below the floor, taller than the ceiling: solid columns). */
  props: PropIndex;
  boxes: PropPlacement[];
  /** Named boxes (tests / QA): side walls, end walls, partitions, console, lockbox, chipper. */
  named: Record<string, PropPlacement>;
  /** The console box used (train-local). */
  console: ConsoleRect;
  /** Task train-all-cargo: riding cargo footprints by owner (setRideCargoBoxes) and the model's own index while any are set. */
  cargo?: {base: PropIndex; boxes: Map<string, readonly PropPlacement[]>};
}

/**
 * Task studio-beta-train-all-cargo-20261107-184244-01: riding cargo the player collides with — the fuel carts' and the carried props'
 * footprints (step frame), by owner. The model's index becomes its own boxes + every owner's (rebuilt on a change); with none left it is
 * exactly its own index again. One owner never undoes another's.
 */
export function setRideCargoBoxes(model: RideLocalModel, owner: string, boxes: readonly PropPlacement[] | null): void {
  if (!model.cargo) {
    if (!boxes?.length) return;
    model.cargo = {base: model.props, boxes: new Map()};
  }
  const c = model.cargo;
  if (boxes?.length) c.boxes.set(owner, [...boxes]); else c.boxes.delete(owner);
  if (!c.boxes.size) { model.props = c.base; model.cargo = undefined; return; }
  model.props = new PropIndex(model.levels, [...model.boxes, ...[...c.boxes.values()].flat()]);
}

const box = (x0: number, x1: number, z0: number, z1: number, h: number): PropPlacement => ({
  kind: 'column', x: (x0 + x1) / 2 + RIDE_FRAME.ox, z: (z0 + z1) / 2 + RIDE_FRAME.oz, y: -1, rot: 0, area: -1,
  hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, h, blocksSight: false, variant: 0, level: 0,
});

/**
 * The car-local collision world of `spec` (see the file header). `consoleRect` = the measured desk box (PlayerTrainRuntime.consoleRect)
 * or null for the cooked model's dims. Pure; built once per runtime.
 */
export function buildRideLocalModel(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC, consoleRect: ConsoleRect | null = null): RideLocalModel {
  const {ox, oz, wall: T} = RIDE_FRAME;
  const I = spec.interior, hw = I.halfWidth, L2 = spec.length / 2;
  if (L2 + 1 > ox || hw + T + 0.5 > oz) throw new Error('trainRideLocal: the car does not fit the step frame');
  const w = Math.round((2 * ox) / CELL), h = Math.round((2 * oz) / CELL);
  const grid = new Grid(w, h);
  const parts = partitionsOf(spec), pt = TRAIN_VIEW.partition / 2;
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = grid.idx(cx, cy);
    const ax = cx * CELL - ox, bx = (cx + 1) * CELL - ox, az = cy * CELL - oz, bz = (cy + 1) * CELL - oz;
    const open = bx > I.x0 - T && ax < I.x1 + T && bz > -hw - T && az < hw + T;
    if (!open) { grid.cells[i] = SOLID; continue; }
    grid.cells[i] = FLOOR;
    grid.area[i] = 0;
    grid.floor[i] = spec.floorY;
    let ceil = spec.ceilingY;
    // a partition doorway's head (the header above the open doorway) over the cells the partition crosses
    for (const p of parts) if (bx > p.x - pt && ax < p.x + pt && bz > p.doorway.z0 && az < p.doorway.z1) ceil = Math.min(ceil, spec.floorY + p.doorway.height);
    grid.ceil[i] = ceil;
  }
  const H = spec.ceilingY + 3;
  const named: Record<string, PropPlacement> = {};
  named.wallPlatform = box(-L2, L2, -hw - T, -hw, H); // local -Z: the platform side (its closed doors are wall)
  named.wallFar = box(-L2, L2, hw, hw + T, H);
  named.endFront = box(I.x1, I.x1 + T, -hw - T, hw + T, H);
  named.endRear = box(I.x0 - T, I.x0, -hw - T, hw + T, H);
  parts.forEach((p, k) => {
    const tag = p.end > 0 ? 'cab' : 'rear';
    named[`${tag}PartitionA`] = box(p.x - pt, p.x + pt, -hw, p.doorway.z0, H);
    named[`${tag}PartitionB`] = box(p.x - pt, p.x + pt, p.doorway.z1, hw, H);
    void k;
  });
  const cr = consoleLocalRect(spec, consoleRect);
  named.console = box(cr.x0, cr.x1, cr.z0, cr.z1, H);
  if (spec.lockbox) { const fp = lockboxFootprint(spec.lockbox); named.lockbox = box(fp.x0, fp.x1, fp.z0, fp.z1, H); }
  const ch = chipperPlacement(spec); // task corpse-chipper: the woodchipper (world/chipperPlace.ts)
  if (ch) { const fp = chipperFootprint(ch); named.chipper = box(fp.x0, fp.x1, fp.z0, fp.z1, H); }
  const boxes = Object.values(named);
  const levels = new Levels([{id: 0, role: 'main', grid, baseY: 0}], [], []);
  return {spec, levels, grid, props: new PropIndex(levels, boxes), boxes, named, console: cr};
}

/** Train-local -> step frame (x / z only; y is shared). */
export const toStep = (lx: number, lz: number): [number, number] => [lx + RIDE_FRAME.ox, lz + RIDE_FRAME.oz];
export const fromStep = (sx: number, sz: number): [number, number] => [sx - RIDE_FRAME.ox, sz - RIDE_FRAME.oz];

/** True when a train-local feet point stands in the walkable interior (inside the lining, the floor within `dy`). */
export function insideInterior(spec: PlayerTrainSpec, lx: number, ly: number, lz: number, dy = 0.3): boolean {
  return lx > spec.interior.x0 && lx < spec.interior.x1 && Math.abs(lz) < spec.interior.halfWidth && Math.abs(ly - spec.floorY) < dy;
}

// ---------------------------------------------------------------------------------------------
// The car pose

/** The car's world pose: the local origin (car centre, rail top) and its rotation (three.js rotation.y = yaw; Euler order 'YZX'). */
export interface CarPose { x: number; y: number; z: number; yaw: number; pitch: number; roll: number }

/** cos / sin of a yaw, exact for 0 and ±PI (the parked yaws). */
export function yawCS(yaw: number): [number, number] {
  if (yaw === 0) return [1, 0];
  if (Math.abs(Math.abs(yaw) - Math.PI) < 1e-12) return [-1, 0];
  return [Math.cos(yaw), Math.sin(yaw)];
}

/** Rotate a local vector by the pose (R_y(yaw) · R_z(pitch) · R_x(roll)) into `out`. */
export function rotateToWorld(c: Pick<CarPose, 'yaw' | 'pitch' | 'roll'>, x: number, y: number, z: number, out: P3): P3 {
  if (c.roll !== 0) { const cr = Math.cos(c.roll), sr = Math.sin(c.roll); const y1 = y * cr - z * sr; z = y * sr + z * cr; y = y1; }
  if (c.pitch !== 0) { const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch); const x1 = x * cp - y * sp; y = x * sp + y * cp; x = x1; }
  const [cy, sy] = yawCS(c.yaw);
  out.x = x * cy + z * sy; out.y = y; out.z = -x * sy + z * cy;
  return out;
}

/** The inverse rotation (world vector -> local). */
export function rotateToLocal(c: Pick<CarPose, 'yaw' | 'pitch' | 'roll'>, x: number, y: number, z: number, out: P3): P3 {
  const [cy, sy] = yawCS(c.yaw);
  let lx = x * cy - z * sy, ly = y, lz = x * sy + z * cy;
  if (c.pitch !== 0) { const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch); const x1 = lx * cp + ly * sp; ly = -lx * sp + ly * cp; lx = x1; }
  if (c.roll !== 0) { const cr = Math.cos(c.roll), sr = Math.sin(c.roll); const y1 = ly * cr + lz * sr; lz = -ly * sr + lz * cr; ly = y1; }
  out.x = lx; out.y = ly; out.z = lz;
  return out;
}

/** Train-local point -> world. */
export function carToWorld(c: CarPose, lx: number, ly: number, lz: number, out: P3 = {x: 0, y: 0, z: 0}): P3 {
  rotateToWorld(c, lx, ly, lz, out);
  out.x += c.x; out.y += c.y; out.z += c.z;
  return out;
}

/** World point -> train-local. */
export function worldToCar(c: CarPose, wx: number, wy: number, wz: number, out: P3 = {x: 0, y: 0, z: 0}): P3 {
  return rotateToLocal(c, wx - c.x, wy - c.y, wz - c.z, out);
}

/** A parked car's pose (gen/playerTrain.ts TrainPlacement). */
export function placementPose(p: {x: number; z: number; railTopY: number; yaw: number}): CarPose {
  return {x: p.x, y: p.railTopY, z: p.z, yaw: p.yaw, pitch: 0, roll: 0};
}

/** three.js yaw of a local +X axis pointing along world (dx, dz) (R_y(yaw) maps +X to (cos, -sin)). */
export const yawOfAxis = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// ---------------------------------------------------------------------------------------------
// Jostle

/** Jostle amplitudes at full intensity and speed (m / rad / Hz / m). Restrained: about a centimetre and a quarter degree. */
export const RIDE_JOSTLE = {
  /** The default Settings intensity (0 = off .. 1); Game may pass its own getter. */
  intensity: 1,
  /** Speed (m/s) at which the sway reaches full amplitude (it fades in from rest). */
  fullSpeed: 11,
  lateral: 0.009, lateralHz: [0.55, 1.35] as const,
  roll: 0.0038, rollHz: [0.42, 1.1] as const,
  pitch: 0.0011, pitchHz: 0.7,
  /** Rail-joint bumps: joint spacing (m), the bump depth per bogie (m), its duration (s); bogie half spacing (m). */
  jointStep: 18, bump: 0.0045, bumpTime: 0.2, bogie: 5.5,
} as const;

export interface Jostle { lateral: number; roll: number; pitch: number; bump: number }

/** Upper bounds of |lateral| / |roll| / |pitch| / |bump| at an intensity (the tests' bound). */
export function jostleBounds(intensity = 1): Jostle {
  const J = RIDE_JOSTLE, k = Math.max(0, Math.min(1, intensity));
  return {lateral: J.lateral * k, roll: J.roll * k, pitch: J.pitch * k, bump: 2 * J.bump * k};
}

const TAU = Math.PI * 2;

/**
 * The car's jostle at clock `t` (s), travelled distance `dist` (m, along the track), speed `v` (m/s, unsigned) and `intensity` (0..1):
 * smooth in t and dist (no jumps through hitches: the ride integrates them with a clamped dt), zero at rest.
 */
export function jostleAt(t: number, dist: number, v: number, intensity: number, out: Jostle = {lateral: 0, roll: 0, pitch: 0, bump: 0}): Jostle {
  const J = RIDE_JOSTLE;
  const s = Math.max(0, Math.min(1, Math.abs(v) / J.fullSpeed));
  const k = Math.max(0, Math.min(1, intensity)) * s * s * (3 - 2 * s);
  if (k <= 0) { out.lateral = out.roll = out.pitch = out.bump = 0; return out; }
  out.lateral = J.lateral * k * (0.6 * Math.sin(TAU * J.lateralHz[0] * t) + 0.4 * Math.sin(TAU * J.lateralHz[1] * t + 1.3));
  out.roll = J.roll * k * (0.65 * Math.sin(TAU * J.rollHz[0] * t + 0.4) + 0.35 * Math.sin(TAU * J.rollHz[1] * t + 2.1));
  out.pitch = J.pitch * k * Math.sin(TAU * J.pitchHz * t + 0.9);
  // each bogie dips briefly as it crosses a rail joint: a smooth sin² pulse lasting bumpTime (in time, from the crossing)
  let bump = 0;
  const vv = Math.max(0.5, Math.abs(v));
  for (const b of [-J.bogie, J.bogie]) {
    const ph = (((dist + b) % J.jointStep) + J.jointStep) % J.jointStep; // metres past the last joint
    const tau = ph / vv;
    if (tau < J.bumpTime) { const q = Math.sin(Math.PI * tau / J.bumpTime); bump -= J.bump * k * q * q; }
  }
  out.bump = bump;
  return out;
}
