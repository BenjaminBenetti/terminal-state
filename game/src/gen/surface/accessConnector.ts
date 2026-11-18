// Task studio-surface-host-ground-connectors-20261118-053602-01: SURFACE RUN version 2 — the OFFICE / MALL host's end of the on-foot
// CONNECTOR (gen/surface/connectorShape.ts: one level canvas tube from the host's street door to the command tent). User: "Office and
// Mall already exit at ground level, so their elevators make no sense … Replace Office/Mall Surface elevators BOTH WAYS with believable
// level-ground ON-FOOT connectors". Replaces the version-2 cargo lift of these two hosts (gen/surface/accessLiftHost.ts); the Subway keeps
// its lift. The host grid is NOT carved: the tube stands outside it, over the street (world/surface/connectorView.ts draws it, the walk
// model carries the player through the doorway and the tube).
//  - OFFICE: the version-1 way out exactly (gen/surface/accessDoor.ts carveOfficeAccess: the makeshift door's position in the lobby's
//    boarded street doors, the barricade pieces in front of it MOVED aside along the barricade for a 1.2 m walk-up with what rests on them,
//    the 'EXIT · STREET' plate appended). Every moved piece keeps its MEMORY ANCHOR (PropPlacement.memAt = where it stood): its holder key
//    and so a saved station's opened / emptied contents stay with it (run/memory.ts propHolderKey). The doorway is the boarding's cut
//    (world/officeWindows.ts: an open framed w x h opening, no closed door): s = 0 on the entrance span's OUTER plane.
//  - MALL: the version-1 usable street exit (the seed-hashed one: carveMallAccess). The doorway is its vestibule (s = 0 on the facade's
//    outer glazing, s = -vestibule the inner set): its leaves stand open (world/mallStreetExit.ts), its full opening is the tube's collar.
// Both: the return pose (every loading-screen arrival: a failed crossing's recovery, Continue) on the host grid ~1.5 m inside the doorway,
// facing into the building; the [E] box of version 1 (the prompt's focus; the tube is walked, never pressed).

import {CELL, type Grid} from '../grid';
import type {StationLayout} from '../stationTypes';
import {CONNECTOR} from './connectorShape';
import {OFFICE_DOOR, accessOutward, carveMallAccess, carveOfficeAccess} from './accessDoor';
import type {SPose, SurfaceAccessInfo, SurfaceConnector} from './surfaceTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Normalised angle in (-PI, PI]. */
const wrap = (a: number) => { let v = a; while (v <= -Math.PI) v += 2 * Math.PI; while (v > Math.PI) v -= 2 * Math.PI; return v; };

/** The return pose: how far inside the doorway's inner face (m), and the nearer / deeper fallbacks (m) and across offsets tried. */
export const CONNECTOR_RETURN = {inside: 1.5, steps: [0, 0.25, -0.25, 0.5, 0.75, 1.0, 1.5, 2.0], across: [0, 0.25, -0.25, 0.5, -0.5, 1, -1]} as const;

/** The heading (camera yaw: forward = (-sin, -cos)) that walks along the outward normal (ox, oz): exact (a cardinal; never rounded, -0 -> 0). */
const yawOut = (ox: number, oz: number) => Math.atan2(-ox, -oz) + 0;

/**
 * The host's loading-screen pose: on the host grid `CONNECTOR_RETURN.inside` m inside the doorway's inner face (tube-local s = -depth -
 * inside, t = 0, else the nearest free spot of the fallbacks), a walkable cell of `area`, a 0.45 m circle clear of walls and standing prop
 * boxes; facing into the building (the record's yaw + PI). Null: none.
 */
function returnPoseOf(layout: StationLayout, g: Grid, rec: SurfaceConnector, out: [number, number]): SPose | null {
  const [ox, oz] = out, alongX = oz !== 0;
  const props = layout.props.filter(p => (p.level ?? 0) === rec.level && !p.mounted && p.host === undefined && !p.cargoGone && p.h > 0.05);
  const yaw = wrap(rec.yaw + Math.PI) + 0;
  for (const ds of CONNECTOR_RETURN.steps) for (const t of CONNECTOR_RETURN.across) {
    const d = rec.door.depth + CONNECTOR_RETURN.inside + ds;
    const x = alongX ? rec.x + t : rec.x - ox * d, z = alongX ? rec.z - oz * d : rec.z + t;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.walkable(cx, cy) || g.area[g.idx(cx, cy)] !== rec.area || !g.circleClear(x, z, 0.45)) continue;
    if (props.some(p => Math.abs(p.x - x) < p.hx + 0.45 && Math.abs(p.z - z) < p.hz + 0.45)) continue;
    return {x: r3(x), z: r3(z), yaw, level: rec.level, y: rec.y};
  }
  return null;
}

/** Version 2 Office: the connector at the lobby's boarded street doors. Null: no version-1 door position (never for a generated tower). */
export function carveOfficeConnector(layout: StationLayout): SurfaceAccessInfo | null {
  const ent = layout.office?.windows.find(w => w.kind === 'entrance');
  const out = ent && accessOutward(ent.side);
  if (!ent || !out) return null;
  // the version-1 way out (its moves applied), every moved piece's old position kept as its memory anchor
  const was = layout.props.map(p => [p.x, p.z] as const);
  const v1 = carveOfficeAccess(layout);
  if (!v1?.door) return null;
  layout.props.forEach((p, i) => { const [x, z] = was[i]; if (p.x !== x || p.z !== z) p.memAt = {x, z}; });
  const level = v1.door.level, g = layout.levels[level].grid, alongX = out[1] !== 0;
  const outer = alongX ? (out[1] < 0 ? ent.z0 : ent.z1) : (out[0] < 0 ? ent.x0 : ent.x1);
  const inner = alongX ? (out[1] < 0 ? ent.z1 : ent.z0) : (out[0] < 0 ? ent.x1 : ent.x0);
  const mid = alongX ? v1.door.x : v1.door.z;
  const area = g.areaAt(alongX ? mid : inner - out[0] * 0.3, alongX ? inner - out[1] * 0.3 : mid);
  const rec: SurfaceConnector = {
    host: 'office', end: 'host', x: r3(alongX ? mid : outer), z: r3(alongX ? outer : mid), y: v1.door.y, level, yaw: yawOut(out[0], out[1]), len: CONNECTOR.len,
    door: {depth: r3(Math.abs(outer - inner)), width: OFFICE_DOOR.w, height: OFFICE_DOOR.h, collar: OFFICE_DOOR.w}, area,
  };
  const returnPose = returnPoseOf(layout, g, rec, out) ?? v1.returnPose;
  return {...v1, v: 2, kind: 'connector', returnPose, connector: rec};
}

/**
 * The Mall's tube doorway width: the leaves' span rounded DOWN to a whole metre — two cells, so the walk model's centre-sampled cells
 * (gen/surface/connectorShape.ts connectorModel) give exactly this width, and the sidelights' mullions stay outside it: two leaf pairs'
 * 3.7 m -> 3.0, one pair's 1.8 -> 1.0 — at most the opening (m).
 */
export function mallConnectorWidth(panels: readonly {kind: string; s0: number; s1: number}[], s0: number, s1: number): number {
  const doors = panels.filter(p => p.kind === 'door');
  const span = doors.length ? Math.max(...doors.map(p => p.s1)) - Math.min(...doors.map(p => p.s0)) : s1 - s0;
  const M = 2 * CELL;
  return r3(Math.max(M, Math.min(Math.floor((s1 - s0) / M + 1e-6), Math.floor(span / M + 1e-6)) * M));
}

/** Version 2 Mall: the connector at the version-1 usable street exit. Null: the mall has no usable exit. */
export function carveMallConnector(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  const v1 = carveMallAccess(layout, levelSeed);
  const e = v1 && layout.mall?.exits?.find(x => x.id === v1.exit);
  const out = e && accessOutward(e.side);
  if (!v1 || !e || !out) return null;
  const alongX = out[1] !== 0, mid = (e.door.s0 + e.door.s1) / 2, g = layout.levels[e.level].grid;
  const doors = e.panels.filter(p => p.kind === 'door');
  const height = doors.length ? r3(Math.max(...doors.map(p => p.y1)) - e.streetY) : r3(e.door.y1 - e.door.y0);
  const rec: SurfaceConnector = {
    host: 'mall', end: 'host', x: r3(alongX ? mid : e.facade), z: r3(alongX ? e.facade : mid), y: r3(e.streetY), level: e.level, yaw: yawOut(out[0], out[1]), len: CONNECTOR.len,
    door: {depth: e.vestibule, width: mallConnectorWidth(e.panels, e.door.s0, e.door.s1), height, collar: r3(e.door.s1 - e.door.s0)}, area: e.hall.area,
  };
  const returnPose = returnPoseOf(layout, g, rec, out) ?? v1.returnPose;
  return {...v1, v: 2, kind: 'connector', returnPose, connector: rec};
}
