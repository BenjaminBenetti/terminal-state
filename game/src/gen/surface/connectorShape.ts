// Task studio-surface-host-ground-connectors-20261118-053602-01: SURFACE RUN version 2 — the Office / Mall CONNECTOR's one shape.
// User: "Office and Mall already exit at ground level, so their elevators make no sense … Replace Office/Mall Surface elevators BOTH
// WAYS with believable level-ground ON-FOOT connectors (dark tents/tubes or suitable covered passages), emerging into the existing safe
// military tent."
//
// The connector is ONE rigid, level canvas tube the military ran from the host's street door to its command tent. Both worlds record
// their own placement of the same tube (gen/surface/surfaceTypes.ts SurfaceConnector): the host station's at its street door (off the
// host's grid, over its street), the district's from the host building's facade across the strip to the tent's wall. Tube-local frame:
//  - s along the axis: 0 = the HOST MOUTH (the host facade's outer plane, the host-end flap), `len` = the TENT MOUTH (the tent's inner wall
//    plane, the tent-end flap); s < 0 = the host doorway behind the host mouth (the Office boarding's cut / the Mall vestibule: host world
//    only), s > len = the tent floor in front of the tent mouth (district only);
//  - t across: + = the walker's right when facing +s (toward the tent);
//  - y up from the record's floor.
// The walk model (connectorModel) is the tube interior plus the walk-in side's doorway / apron as a one-level collision grid in a STEP
// frame (tube-local + an offset: every cell index positive); the flaps are its dynamic ends (world/surface/connectorRuntime.ts clamps s).
// Pure: no three.js, no DOM.

import {CELL, FLOOR, Grid, SOLID} from '../grid';
import {Levels} from '../levels';
import type {SurfaceConnector} from './surfaceTypes';

/** The tube's one shape (m). */
export const CONNECTOR = {
  /** Clear width between the canvas side walls. */
  width: 2.0,
  /** Side wall height (the eaves of its low arched roof) and the crown (at most the tent's eave, world/surface/archPlan.ts LOOK_TUNE.tentEave 2.15). */
  wallH: 1.95,
  crownH: 2.15,
  /** The walk model's ceiling. */
  ceil: 2.1,
  /**
   * The tent mouth's s: the district plaza's host facade (v 0) to the command tent's inner wall plane (gen/surface/checkpoint.ts: the tent
   * ring starts at v = 8 cells for an Office / Mall host, one cell thick).
   */
  len: 4.5,
  /** The district footprint's wall ring each side of the clear width (one cell): canvas, frames, guy anchors. */
  ring: 0.5,
  /** How far the walk model reaches past the walk-in side's mouth / doorway into that world's own floor (the take / release overlap). */
  apron: 0.9,
  /** Half-width of the walk model's apron (wider than any doorway: the held player is never stopped by it). */
  apronHalf: 1.4,
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Forward (+s) and right (+t) world unit vectors of a connector record. */
export function connectorAxes(c: Pick<SurfaceConnector, 'yaw'>): {fx: number; fz: number; rx: number; rz: number} {
  const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
  return {fx, fz, rx: -fz, rz: fx};
}

/** Tube-local (s, t) -> world (x, z). */
export function connectorToWorld(c: Pick<SurfaceConnector, 'x' | 'z' | 'yaw'>, s: number, t: number): [number, number] {
  const a = connectorAxes(c);
  return [c.x + a.fx * s + a.rx * t, c.z + a.fz * s + a.rz * t];
}

/** World (x, z) -> tube-local (s, t). */
export function worldToConnector(c: Pick<SurfaceConnector, 'x' | 'z' | 'yaw'>, x: number, z: number): [number, number] {
  const a = connectorAxes(c), dx = x - c.x, dz = z - c.z;
  return [dx * a.fx + dz * a.fz, dx * a.rx + dz * a.rz];
}

/** The s range of a record's walk model: the tube plus its walk-in side (the host doorway + the lobby / hall apron, or the tent apron). */
export function connectorSpan(c: Pick<SurfaceConnector, 'end' | 'len' | 'door'>): [number, number] {
  return c.end === 'host' ? [r3(-c.door.depth - CONNECTOR.apron), c.len] : [0, r3(c.len + CONNECTOR.apron)];
}

/** Is tube-local (s, t) open floor of a record's walk model (radius-free: the cells' own test)? */
export function connectorOpen(c: Pick<SurfaceConnector, 'end' | 'len' | 'door'>, s: number, t: number): boolean {
  const W = CONNECTOR.width / 2;
  if (s >= 0 && s <= c.len) return Math.abs(t) < W;
  if (c.end === 'host' && s < 0) {
    if (s >= -c.door.depth) return Math.abs(t) < c.door.width / 2;
    return s >= -c.door.depth - CONNECTOR.apron && Math.abs(t) < CONNECTOR.apronHalf;
  }
  if (c.end === 'tent' && s > c.len) return s <= c.len + CONNECTOR.apron && Math.abs(t) < CONNECTOR.apronHalf;
  return false;
}

/**
 * The walk model's STEP frame — a rotation of the world frame (never a mirror): step x = t + ox, step z = oz - s, so the step frame's -z is
 * the tube's +s (toward the tent) exactly as the world's -z is yaw 0's forward; a step-frame yaw is the world yaw minus the record's yaw.
 */
export interface ConnectorModel { levels: Levels; grid: Grid; ox: number; oz: number; s0: number; s1: number }

/**
 * A record's walk model: a one-level collision grid of connectorOpen in the step frame (cells of CELL, a SOLID ring around), floor 0,
 * ceiling CONNECTOR.ceil. The cells are sampled at their centres; the doorway / tube widths are multiples of CELL on the record.
 */
export function connectorModel(c: Pick<SurfaceConnector, 'end' | 'len' | 'door'>): ConnectorModel {
  const [s0, s1] = connectorSpan(c);
  const half = Math.max(CONNECTOR.apronHalf, CONNECTOR.width / 2, c.door.width / 2) + CELL;
  const ox = Math.ceil(half / CELL) * CELL, oz = Math.ceil((s1 + CELL) / CELL) * CELL;
  const w = Math.round((2 * ox) / CELL), h = Math.ceil((oz - s0 + CELL) / CELL);
  const grid = new Grid(w, h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = grid.idx(cx, cy);
    const t = (cx + 0.5) * CELL - ox, s = oz - (cy + 0.5) * CELL;
    if (connectorOpen(c, s, t)) { grid.cells[i] = FLOOR; grid.area[i] = 0; grid.floor[i] = 0; grid.ceil[i] = CONNECTOR.ceil; } else grid.cells[i] = SOLID;
  }
  return {levels: new Levels([{id: 0, role: 'main', grid, baseY: 0}], [], []), grid, ox, oz, s0, s1};
}

/** Tube-local (s, t) <-> the model's step frame (x, z). */
export const connectorToStep = (m: Pick<ConnectorModel, 'ox' | 'oz'>, s: number, t: number): [number, number] => [t + m.ox, m.oz - s];
export const stepToConnector = (m: Pick<ConnectorModel, 'ox' | 'oz'>, x: number, z: number): [number, number] => [m.oz - z, x - m.ox];

/** Yaw conversions (world <-> step frame): a pure rotation by the record's yaw. */
export const connectorStepYaw = (c: Pick<SurfaceConnector, 'yaw'>, worldYaw: number): number => worldYaw - c.yaw;
export const connectorWorldYaw = (c: Pick<SurfaceConnector, 'yaw'>, stepYaw: number): number => stepYaw + c.yaw;
