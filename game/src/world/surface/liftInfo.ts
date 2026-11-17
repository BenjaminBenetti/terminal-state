// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the cargo lift's pure helpers.
//  - liftElevatorInfo: a lift end (gen/surface/surfaceTypes.ts SurfaceLift) as the cargo lift kit's two-stop contract (world/
//    towerShared.ts ElevatorInfo): the station's end is the LOWER stop with the shaft rising LIFT_CAR.rise to a stop it never reaches in
//    this world, the tent's end the UPPER stop with the shaft falling to one. Both ends are the same car shape, so the kit draws the same
//    car, COP and landing at either end (only the world placement differs) — the ride (world/surface/liftRuntime.ts) swaps one end's
//    view for the other's while the doors are shut and the player sees no change.
//  - the CAR FRAME: car-local (x across, z from the back toward the gate; yaw 0 = facing the gate) <-> world, and the car's own
//    collision model (a one-level Levels of the car's interior, its gate shut) the held player walks on while the world is left / built.
// Pure: no three.js, no DOM.

import {CELL, FLOOR, Grid, SOLID} from '../../gen/grid';
import {Levels} from '../../gen/levels';
import {LIFT_CAR, outward, yawAlong} from '../../gen/surface/accessLift';
import type {SurfaceLift} from '../../gen/surface/surfaceTypes';
import type {ElevatorInfo} from '../towerShared';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Stop labels (the kit's glyphs): the station 'S', the street 'L'. */
export const LIFT_LABELS = ['S', 'L'] as const;

/** The two stops' floors (lower, upper) of a lift end. */
export function liftStops(l: SurfaceLift): [number, number] {
  return l.end === 'lower' ? [l.y, r3(l.y + LIFT_CAR.rise)] : [r3(l.y - LIFT_CAR.rise), l.y];
}

/** The stop index (0 lower, 1 upper) this end stands at. */
export const liftHome = (l: SurfaceLift): 0 | 1 => (l.end === 'lower' ? 0 : 1);

/** The lift end as the cargo kit's two-stop contract (world m). */
export function liftElevatorInfo(l: SurfaceLift): ElevatorInfo {
  const n = outward(l.doorSide), t: [number, number] = [-n[1], n[0]];
  const hw = l.door.width / 2;
  const front = (k: number, s: number) => ({x: r3(l.door.x + n[0] * k + t[0] * s), z: r3(l.door.z + n[1] * k + t[1] * s)});
  const ys = liftStops(l);
  const stops = ys.map((y, i) => {
    const cp = front(CELL + 0.02, -(hw + 0.45)), land = front(CELL + 0.7, 0);
    return {floor: i, levelId: l.level, y, area: i === liftHome(l) ? l.area : -1, label: LIFT_LABELS[i], name: i === 0 ? 'Station' : 'Street', callPanel: {x: cp.x, y: r3(y + 1.25), z: cp.z}, landing: land};
  });
  const pan = front(-0.03, hw + 0.2);
  return {
    cab: {...l.cab}, shaft: {...l.shaft}, doorSide: l.doorSide, door: {...l.door}, cabHeight: LIFT_CAR.cabH, doorHeight: LIFT_CAR.gateH,
    panel: {x: pan.x, dy: 1.25, z: pan.z}, stops, cargo: true, home: liftHome(l),
  };
}

// ---------------------------------------------------------------------------------------------
// The car frame

/** A car's frame: its interior's centre (world x, z), the yaw that faces its gate, the half extents across / along. */
export interface CarFrame { cx: number; cz: number; yaw: number; hx: number; hz: number }

export function carFrame(l: SurfaceLift): CarFrame {
  const n = outward(l.doorSide), alongX = n[0] === 0;
  const w = l.cab.x1 - l.cab.x0, d = l.cab.z1 - l.cab.z0;
  return {cx: (l.cab.x0 + l.cab.x1) / 2, cz: (l.cab.z0 + l.cab.z1) / 2, yaw: yawAlong(n[0], n[1]), hx: (alongX ? w : d) / 2, hz: (alongX ? d : w) / 2};
}

/** Car-local (x, z) -> world (rotation by the car's yaw: car-local yaw 0 looks along local -z = toward the gate). */
export function carToWorldXZ(f: CarFrame, lx: number, lz: number): [number, number] {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.cx + lx * c + lz * s, f.cz - lx * s + lz * c];
}

/** World (x, z) -> car-local. */
export function worldToCarXZ(f: CarFrame, x: number, z: number): [number, number] {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw), dx = x - f.cx, dz = z - f.cz;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** The car's interior as a one-level collision model in its STEP frame (car-local + the offset: every cell index positive). */
export interface CarModel { levels: Levels; grid: Grid; ox: number; oz: number }

export function carModel(f: CarFrame): CarModel {
  const ox = f.hx + 1, oz = f.hz + 1;
  const w = Math.round((2 * ox) / CELL), h = Math.round((2 * oz) / CELL);
  const grid = new Grid(w, h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = grid.idx(cx, cy);
    const x = (cx + 0.5) * CELL - ox, z = (cy + 0.5) * CELL - oz;
    if (Math.abs(x) < f.hx && Math.abs(z) < f.hz) { grid.cells[i] = FLOOR; grid.area[i] = 0; grid.floor[i] = 0; grid.ceil[i] = LIFT_CAR.cabH; } else grid.cells[i] = SOLID;
  }
  return {levels: new Levels([{id: 0, role: 'main', grid, baseY: 0}], [], []), grid, ox, oz};
}
