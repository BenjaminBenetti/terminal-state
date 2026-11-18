// Task studio-surface-host-ground-connectors-20261118-053602-01: the DISTRICT's end of the Office / Mall CONNECTOR (gen/surface/
// connectorShape.ts) — where the tube stands in the checkpoint compound, its grid footprint and the portal record. Pure: no three.js.
//
// The tube runs straight across the compound strip between the host building's facade (plaza v = 0: the host covers the plaza's inner v
// edge) and the command tent's facing wall (version 2's PORTAL.tentLift tent, ring at v 8 cells: its inner wall plane v = 4.5 m =
// CONNECTOR.len), its axis CONNECTOR_PLAZA.u m along the plaza's inner u edge: clear of the tent's back wall (u 1.0 - 1.5), the generator
// (u 1.0 +- 0.35) and every reserved approach; the tent's mouth opens into the floor the lift-era car stood on.
//  - THE FOOTPRINT (|t| <= width / 2 + ring, 0 <= s <= len) is SOLID on the district grid (nothing walks, spawns or is placed in it; the
//    walk model carries the player): its clear width the tube's own (no ground drawn: its groundsheet), the ring its canvas margin
//    (ground drawn). The tent's own wall cells beside the mouth (the ring's last cell row) stay the tent's canvas.
//  - Its air is the tent's (world/surface/airMask.ts: sealed to the tent's top): no outdoor gas reads in it (one field for hurt + fog).

import {CELL, SOLID, type Grid} from '../grid';
import {CONNECTOR, connectorToWorld, worldToConnector} from './connectorShape';
import type {SBox, SPose, SRect, SurfaceConnector} from './surfaceTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The district placement (plaza metres): the axis' u, the arrival's distance in front of the tent mouth (m). */
export const CONNECTOR_PLAZA = {u: 3.0, arrive: 1.5} as const;

/** The district record's doorway: the shape's defaults (the host mouth stays shut there; the host world's record carries the real one). */
export const CONNECTOR_DISTRICT_DOOR = {depth: 0.5, width: 1.0, height: 2.1, collar: 1.0} as const;

/** Half-width of the footprint (m): the clear width plus the ring. */
export const connectorHalf = (): number => CONNECTOR.width / 2 + CONNECTOR.ring;

/**
 * The footprint role of a world point (x, z) under a district record: 'clear' (the tube's own width), 'ring' (its canvas margin), 'tent'
 * (the tent's own wall cells beside the mouth: the last CELL of s outside the clear width) or null (outside).
 */
export function connectorRole(c: Pick<SurfaceConnector, 'x' | 'z' | 'yaw' | 'len'>, x: number, z: number): 'clear' | 'ring' | 'tent' | null {
  const [s, t] = worldToConnector(c, x, z), W = CONNECTOR.width / 2, e = 1e-6;
  if (s < -e || s > c.len + e || Math.abs(t) > connectorHalf() + e) return null;
  if (Math.abs(t) < W) return 'clear';
  return s > c.len - CELL ? 'tent' : 'ring';
}

/** The footprint's world box (the whole |t| <= half, 0 <= s <= len rect). */
export function connectorRect(c: Pick<SurfaceConnector, 'x' | 'z' | 'yaw' | 'len'>): SRect {
  const h = connectorHalf(), pts = [connectorToWorld(c, 0, -h), connectorToWorld(c, 0, h), connectorToWorld(c, c.len, -h), connectorToWorld(c, c.len, h)];
  return {x0: r3(Math.min(...pts.map(p => p[0]))), z0: r3(Math.min(...pts.map(p => p[1]))), x1: r3(Math.max(...pts.map(p => p[0]))), z1: r3(Math.max(...pts.map(p => p[1])))};
}

/** Grid cells (index y * w + x) whose centre lies in the footprint (every role), with their role. */
export function connectorCells(c: Pick<SurfaceConnector, 'x' | 'z' | 'yaw' | 'len'>, w: number, h: number): {i: number; role: 'clear' | 'ring' | 'tent'}[] {
  const r = connectorRect(c), out: {i: number; role: 'clear' | 'ring' | 'tent'}[] = [];
  for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(h, Math.ceil(r.z1 / CELL)); cy++) for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(w, Math.ceil(r.x1 / CELL)); cx++) {
    const role = connectorRole(c, (cx + 0.5) * CELL, (cy + 0.5) * CELL);
    if (role) out.push({i: cy * w + cx, role});
  }
  return out;
}

/** The district's connector record at the plaza frame `pw` (plaza u / v metres -> world) with +v world heading `yaw`. */
export function districtConnector(host: 'office' | 'mall', pw: (u: number, v: number) => {x: number; z: number}, yaw: number, y: number, area: number): SurfaceConnector {
  const a = pw(CONNECTOR_PLAZA.u, 0);
  return {host, end: 'tent', x: r3(a.x), z: r3(a.z), y: r3(y), level: 0, yaw: r3(yaw), len: CONNECTOR.len, door: {...CONNECTOR_DISTRICT_DOOR}, area};
}

/** The district arrival (every loading-screen arrival): in the tent CONNECTOR_PLAZA.arrive m in front of the tent mouth, facing into it. */
export function connectorArrival(c: SurfaceConnector): SPose {
  const [x, z] = connectorToWorld(c, c.len + CONNECTOR_PLAZA.arrive, 0);
  return {x: r3(x), z: r3(z), yaw: c.yaw, level: c.level, y: c.y};
}

/** The district's walk-in box (the tent apron in front of the mouth: the prompt's [E]-free focus box), feet within y - 0.2 .. y + 2.4. */
export function connectorTrigger(c: SurfaceConnector): SBox {
  const pts = [connectorToWorld(c, c.len, -CONNECTOR.apronHalf), connectorToWorld(c, c.len, CONNECTOR.apronHalf), connectorToWorld(c, c.len + CONNECTOR.apron, -CONNECTOR.apronHalf), connectorToWorld(c, c.len + CONNECTOR.apron, CONNECTOR.apronHalf)];
  return {x0: r3(Math.min(...pts.map(p => p[0]))), z0: r3(Math.min(...pts.map(p => p[1]))), x1: r3(Math.max(...pts.map(p => p[0]))), z1: r3(Math.max(...pts.map(p => p[1]))), y0: r3(c.y - 0.2), y1: r3(c.y + 2.4)};
}

/**
 * Carves the footprint into the district's street grid: SOLID, no area, no ceiling, no prop masks; its floor keeps the compound's kerb
 * height (the ring's ground is drawn there: world/surface/archPlan.ts). The tent's own wall cells are SOLID already.
 */
export function carveConnectorFootprint(g: Grid, c: SurfaceConnector): void {
  for (const {i} of connectorCells(c, g.w, g.h)) { g.cells[i] = SOLID; g.area[i] = -1; g.ceil[i] = 0; g.blocked[i] = 0; g.sightBlocked[i] = 0; }
}
