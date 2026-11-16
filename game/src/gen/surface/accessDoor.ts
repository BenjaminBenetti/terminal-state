// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): SURFACE RUN — the way out of an Office tower lobby / a Mall to the
// street. RNG-NEUTRAL, nothing carved (the street side is a separate world, crossed behind a loading screen):
//  - Office: the lobby's boarded street doors (layout.office.windows kind 'entrance', gen/office/windows.ts) — one makeshift door is fitted
//    into the boarding at their middle (world/surface/accessView.ts draws it; an EXIT plate is APPENDED above the opening). The barricade
//    of crates / cartons inside stays where it was generated (the player squeezes past it or uses the door from in front of it).
//  - Mall: one of the street-level exits (layout.mall.exits, all view-only and chained shut) is USABLE: picked by a hash of the level
//    seed; world/mallStreetExit.ts draws it without its lock (no chain / padlock, notices, board or lit EXIT CLOSED sign).
// Both record the [E] box in front of the door and a free return pose inside, facing away from it.

import {hashString} from '../../core/rng';
import type {Grid} from '../grid';
import type {SignPlacement, StationLayout} from '../stationTypes';
import type {SPose, SurfaceAccessInfo} from './surfaceTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Outward unit normal of a facade / exit side (from the inside to the street). */
const OUT: Record<string, [number, number]> = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};

/** The office makeshift door's opening (m). */
export const OFFICE_DOOR = {w: 1.0, h: 2.1};

/**
 * A free standing pose inside a door: `depth` m (and further, up to `depth + 3`) inward from the wall plane, as near the door's middle
 * as the floor allows (a walkable cell, a 0.45 m circle clear of walls and blocking props, no prop box under it). Null: none.
 */
function freePose(layout: StationLayout, g: Grid, level: number, plane: number, mid: number, out: [number, number], depth: number, y: number): SPose | null {
  const [ox, oz] = out;
  const alongX = oz !== 0;
  const at = (d: number, s: number): [number, number] => alongX ? [mid + s, plane - oz * d] : [plane - ox * d, mid + s];
  const props = layout.props.filter(p => (p.level ?? 0) === level && !p.mounted && p.host === undefined && !p.cargoGone && p.h > 0.05);
  for (let k = 0; k <= 12; k++) {
    const d = depth + k * 0.25;
    for (const s of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
      const [x, z] = at(d, s);
      const [cx, cy] = g.cellOf(x, z);
      if (!g.walkable(cx, cy) || !g.circleClear(x, z, 0.45)) continue;
      if (props.some(p => Math.abs(p.x - x) < p.hx + 0.45 && Math.abs(p.z - z) < p.hz + 0.45)) continue;
      // facing away from the door: forward (-sin yaw, -cos yaw) = inward (-out)
      return {x: r3(x), z: r3(z), yaw: r3(Math.atan2(ox, oz)), level, y: r3(y)};
    }
  }
  return null;
}

/** The [E] box in front of a door: `half` m either side of its middle, from the wall plane `depth` m inward, y up 2.4 m from `y`. */
function triggerOf(plane: number, mid: number, out: [number, number], half: number, depth: number, y: number): SurfaceAccessInfo['trigger'] {
  const [ox, oz] = out;
  const a = oz !== 0 ? [mid - half, plane, mid + half, plane - oz * depth] : [plane, mid - half, plane - ox * depth, mid + half];
  return {x0: r3(Math.min(a[0], a[2])), z0: r3(Math.min(a[1], a[3])), x1: r3(Math.max(a[0], a[2])), z1: r3(Math.max(a[1], a[3])), y0: r3(y - 0.2), y1: r3(y + 2.4)};
}

/** Office Space: the makeshift door in the lobby's boarded street doors. Null: no entrance span (never for a generated tower). */
export function carveOfficeAccess(layout: StationLayout): SurfaceAccessInfo | null {
  const ent = layout.office?.windows.find(w => w.kind === 'entrance');
  const out = ent && OUT[ent.side];
  if (!ent || !out) return null;
  const level = ent.level ?? 1, L = layout.levels[level];
  if (!L) return null;
  const g = L.grid, alongX = out[1] !== 0;
  // the inner wall plane (the lobby side) and the opening's middle along the facade
  const plane = alongX ? (out[1] < 0 ? ent.z1 : ent.z0) : (out[0] < 0 ? ent.x1 : ent.x0);
  const mid = alongX ? (ent.x0 + ent.x1) / 2 : (ent.z0 + ent.z1) / 2;
  const inX = alongX ? mid : plane - out[0] * 0.3, inZ = alongX ? plane - out[1] * 0.3 : mid;
  const y = ent.baseY ?? L.baseY; // (the lobby storey's floor)
  const returnPose = freePose(layout, g, level, plane, mid, out, 3.4, y);
  if (!returnPose) return null;
  const yaw = Math.atan2(-out[0], -out[1]); // the door's front faces into the lobby
  const lobby = g.areaAt(inX, inZ);
  // an EXIT plate over the opening (on the wall above the entrance head)
  const head = ent.head ?? 2.6;
  const sp: SignPlacement = {x: r3(alongX ? mid : plane - out[0] * 0.06), y: r3(y + head + 0.32), z: r3(alongX ? plane - out[1] * 0.06 : mid), rot: r3(yaw), kind: 'exit', text: 'EXIT · STREET', area: lobby >= 0 ? lobby : 0, w: 1.4};
  if (level) sp.level = level;
  layout.signs.push(sp);
  return {
    v: 1, kind: 'office-door', label: 'the street', areas: lobby >= 0 ? [lobby] : [],
    trigger: triggerOf(plane, mid, out, 1.1, 3.4, y), returnPose,
    door: {x: r3(alongX ? mid : plane), z: r3(alongX ? plane : mid), y: r3(y), yaw: r3(yaw), w: OFFICE_DOOR.w, h: OFFICE_DOOR.h, level},
  };
}

/** The Mall: one usable street exit (hashed by the level seed). Null: the mall has no street exits. */
export function carveMallAccess(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  const exits = layout.mall?.exits ?? [];
  if (!exits.length) return null;
  const start = hashString('surface-access-mall-v1', levelSeed >>> 0) % exits.length;
  for (let k = 0; k < exits.length; k++) {
    const e = exits[(start + k) % exits.length];
    const out = OUT[e.side], L = layout.levels[e.level];
    if (!out || !L) continue;
    const {plane, s0, s1} = e.door;
    const mid = (s0 + s1) / 2, y = e.streetY;
    const returnPose = freePose(layout, L.grid, e.level, plane, mid, out, 2.2, y);
    if (!returnPose) continue;
    const g = L.grid, alongX = out[1] !== 0;
    const area = g.areaAt(alongX ? mid : plane - out[0] * 0.3, alongX ? plane - out[1] * 0.3 : mid);
    return {
      v: 1, kind: 'mall-door', label: 'the street', areas: area >= 0 ? [area] : [],
      trigger: triggerOf(plane, mid, out, Math.max(0.6, (s1 - s0) / 2), 2.4, y), returnPose, exit: e.id,
    };
  }
  return null;
}

/** (tests) the outward normal of a side. */
export const accessOutward = (side: string): [number, number] | undefined => OUT[side];
