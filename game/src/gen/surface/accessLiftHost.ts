// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 2): SURFACE RUN version 2 — the cargo lift of an
// OFFICE tower / a MALL. Neither has room beyond its street doors (the Office's lobby facade stands 2 cells from the grid edge, the Mall's
// exits open onto the drawn street), so the landing stands INSIDE the building, on the access storey: a free-standing freight-lift
// enclosure (the cargo kit's car, its gate, the sealed shaft box of the ring cells) on open floor near the way out the version-1 door
// used — the Office lobby's boarded street entrance, the Mall's hashed street exit — preferably backed against a wall.
//  - APPEND-ONLY / RNG-neutral like the Subway's lift (gen/surface/accessLift.ts): one area appended (the car, the landing area's child),
//    the footprint's cells carved, one EXIT sign appended over the gate; no generated prop, pickup, light or enemy is moved or removed —
//    a spot under any of them, a doorway, a window span, a street exit, a stair or the spawn is not used;
//  - connectivity: every cell reachable on foot before is reachable after (the footprint's own cells excepted), and the car is;
//  - deterministic: candidates ordered by distance from the way out (a wall behind first), then by a fixed scan order.
// Null: no spot (the caller keeps the version-1 door). tests/surface-access-v2-hosts.test.ts sweeps present stations.

import {hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {levelDistance} from '../levelGen';
import type {Area, SignPlacement, StationLayout} from '../stationTypes';
import type {SurfaceAccessInfo} from './surfaceTypes';
import {LIFT_CAR, LIFT_FOOT, carveLiftRoom, liftCell, liftInsidePose, liftRecord, liftRect, liftTrigger, outward, type LiftFrame} from './accessLift';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The search: how far from the way out (m; a second, wider pass), the landing kept clear in front of the gate (cells), candidates tried. */
export const HOST_LIFT = {reach: [26, 70], landing: 3, minHeadroom: LIFT_CAR.cabH + LIFT_CAR.ceilGap + 0.1, tries: 16, spawnClear: 4} as const;

/** The outward normal of a side name (from inside to the street). */
const OUT: Record<string, [number, number]> = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};

interface Box { x0: number; z0: number; x1: number; z1: number }
interface Cand { f: LiftFrame; area: number; y: number; backed: boolean; d: number; k: number }

/** The four frames' steps: +u into the car (from its gate), +v across. */
const DIRS: readonly [number, number, number, number][] = [[0, 1, 1, 0], [0, -1, 1, 0], [1, 0, 0, 1], [-1, 0, 0, 1]];

/** World box of local cells u in [u0, u1), v in [v0, v1). */
function boxOf(f: LiftFrame, u0: number, u1: number, v0: number, v1: number): Box {
  const r = liftRect(f, u0, u1, v0, v1);
  return {x0: r.x * CELL, z0: r.y * CELL, x1: (r.x + r.w) * CELL, z1: (r.y + r.h) * CELL};
}
const overlaps = (b: Box, x: number, z: number, hx: number, hz: number, m = 0) => x + hx > b.x0 - m && x - hx < b.x1 + m && z + hz > b.z0 - m && z - hz < b.z1 + m;

/** The candidate spots on storey `level` near (ax, az), best first (pure: nothing changed). */
function candidates(layout: StationLayout, level: number, ax: number, az: number, reach: number, keepOut: readonly Box[]): Cand[] {
  const g = layout.levels[level].grid, C = LIFT_CAR, H = HOST_LIFT;
  const g0 = Math.floor((C.width + 2 - C.gateCells) / 2);
  const onLevel = <T extends {level?: number}>(o: T) => (o.level ?? 0) === level;
  const props = layout.props.filter(p => onLevel(p) && !p.cargoGone);
  const picks = layout.pickups.filter(onLevel), lights = layout.lights.filter(l => onLevel(l as {level?: number}));
  const zombies = layout.zombies.filter(z => onLevel(z as {level?: number})), signs = layout.signs.filter(s => onLevel(s as {level?: number}));
  const spawn = layout.playerSpawn;
  const out: Cand[] = [];
  const R = Math.ceil(reach / CELL), [acx, acy] = [Math.floor(ax / CELL), Math.floor(az / CELL)];
  const cellOk = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && !g.blocked[g.idx(x, y)];
  DIRS.forEach(([dx, dy, axs, ays], k) => {
    for (let oy = acy - R; oy <= acy + R; oy++) for (let ox = acx - R; ox <= acx + R; ox++) {
      const f: LiftFrame = {ox, oy, dx, dy, ax: axs, ay: ays};
      // the footprint: one area's open floor, level, under enough headroom
      const [fx, fy] = liftCell(f, 0, 0);
      if (!cellOk(fx, fy)) continue;
      const i0 = g.idx(fx, fy), area = g.area[i0], y = g.floor[i0];
      if (area < 0) continue;
      let ok = true;
      for (let u = 0; u < LIFT_FOOT.u && ok; u++) for (let v = 0; v < LIFT_FOOT.v && ok; v++) {
        const [x, yy] = liftCell(f, u, v);
        if (!cellOk(x, yy)) { ok = false; break; }
        const i = g.idx(x, yy);
        if (g.area[i] !== area || Math.abs(g.floor[i] - y) > 0.01 || g.ceil[i] - y < H.minHeadroom) ok = false;
      }
      // the landing in front of the gate: open floor at the same height (the gate's width and a cell either side)
      for (let u = -H.landing; u < 0 && ok; u++) for (let v = g0 - 1; v <= g0 + C.gateCells && ok; v++) {
        const [x, yy] = liftCell(f, u, v);
        if (!cellOk(x, yy) || Math.abs(g.floor[g.idx(x, yy)] - y) > 0.05) ok = false;
      }
      if (!ok) continue;
      const foot = boxOf(f, 0, LIFT_FOOT.u, 0, LIFT_FOOT.v), land = boxOf(f, -H.landing, 0, g0 - 1, g0 + C.gateCells + 1);
      // nothing generated under it (props of any kind, items, fixtures, enemies, signs), nor in the way out of the gate
      if (props.some(p => overlaps(foot, p.x, p.z, p.hx, p.hz, 0.1) || (p.h > 0.05 && !p.mounted && overlaps(land, p.x, p.z, p.hx, p.hz)))) continue;
      if (picks.some(q => overlaps(foot, q.x, q.z, 0, 0, 0.3)) || lights.some(l => overlaps(foot, l.x, l.z, 0, 0, 0.4))) continue;
      if (zombies.some(z => overlaps(foot, z.x, z.z, 0, 0, 0.6) || overlaps(land, z.x, z.z, 0, 0, 0.3)) || signs.some(s => overlaps(foot, s.x, s.z, 0, 0, 0.3))) continue;
      if (keepOut.some(b => b.x1 > foot.x0 - CELL && b.x0 < foot.x1 + CELL && b.z1 > foot.z0 - CELL && b.z0 < foot.z1 + CELL)) continue;
      if (overlaps(foot, spawn.x, spawn.z, 0, 0, H.spawnClear)) continue;
      // a wall right behind the shaft (preferred)
      let backed = true;
      for (let v = 0; v < LIFT_FOOT.v && backed; v++) { const [x, yy] = liftCell(f, LIFT_FOOT.u, v); if (!g.inBounds(x, yy) || g.cells[g.idx(x, yy)] !== SOLID) backed = false; }
      const [gx, gy] = liftCell(f, -1, g0 + C.gateCells / 2);
      out.push({f, area, y, backed, d: Math.hypot(gx * CELL - ax, gy * CELL - az), k});
    }
  });
  return out.sort((a, b) => (Number(b.backed) - Number(a.backed)) || (a.d - b.d) || (a.k - b.k) || (a.f.oy - b.f.oy) || (a.f.ox - b.f.ox));
}

/** Every walkable cell reachable from the spawn before is reachable after (the footprint's cells excepted). */
function keepsReach(layout: StationLayout, before: readonly Int32Array[], after: readonly Int32Array[], level: number, foot: Box): boolean {
  return layout.levels.every((L, k) => {
    const g = L.grid;
    for (let i = 0; i < before[k].length; i++) {
      if (before[k][i] < 0 || after[k][i] >= 0) continue;
      const x = (i % g.w + 0.5) * CELL, z = (Math.floor(i / g.w) + 0.5) * CELL;
      if (k === level && x > foot.x0 && x < foot.x1 && z > foot.z0 && z < foot.z1) continue;
      return false;
    }
    return true;
  });
}

/** Saved cells of a footprint (exact undo). */
function saveCells(g: Grid, f: LiftFrame): () => void {
  const idx: number[] = [];
  for (let u = 0; u < LIFT_FOOT.u; u++) for (let v = 0; v < LIFT_FOOT.v; v++) { const [x, y] = liftCell(f, u, v); idx.push(g.idx(x, y)); }
  const s = idx.map(i => [g.cells[i], g.area[i], g.floor[i], g.ceil[i], g.blocked[i], g.sightBlocked[i]] as const);
  return () => idx.forEach((i, k) => { [g.cells[i], g.area[i], g.floor[i], g.ceil[i], g.blocked[i], g.sightBlocked[i]] = s[k]; });
}

/**
 * Carves a host's lift on storey `level` near the way out (ax, az): the first candidate (HOST_LIFT order) whose carve keeps every reachable
 * cell reachable and makes the car reachable. Null: none.
 */
export function carveHostLift(layout: StationLayout, level: number, ax: number, az: number, keepOut: readonly Box[]): SurfaceAccessInfo | null {
  const L = layout.levels[level];
  if (!L) return null;
  const g = L.grid;
  const [sx, sy] = layout.levels[0].grid.cellOf(layout.playerSpawn.x, layout.playerSpawn.z);
  const reach = () => levelDistance(layout.levels, sx, sy, 0, layout.levelLinks);
  let before: Int32Array[] | null = null;
  const seen = new Set<string>();
  for (const r of HOST_LIFT.reach) {
    const top = candidates(layout, level, ax, az, r, keepOut).filter(c => !seen.has(`${c.k}:${c.f.ox},${c.f.oy}`)).slice(0, HOST_LIFT.tries);
    for (const c of top) {
      seen.add(`${c.k}:${c.f.ox},${c.f.oy}`);
      before ??= reach();
      const undo = saveCells(g, c.f);
      const id = layout.areas.length;
      const room = carveLiftRoom(g, c.f, c.y, id, c.area);
      const after = reach();
      const foot = boxOf(c.f, 0, LIFT_FOOT.u, 0, LIFT_FOOT.v);
      const [mx, my] = g.cellOf((room.cab.x0 + room.cab.x1) / 2, (room.cab.z0 + room.cab.z1) / 2);
      if (!keepsReach(layout, before, after, level, foot) || after[level][g.idx(mx, my)] < 0) { undo(); continue; }
      return finish(layout, level, c, room, id);
    }
  }
  return null;
}

function finish(layout: StationLayout, level: number, c: Cand, room: ReturnType<typeof carveLiftRoom>, id: number): SurfaceAccessInfo {
  const parent = layout.areas[c.area];
  const carRect = liftRect(c.f, 1, LIFT_FOOT.u, 1, 1 + LIFT_CAR.width);
  const car: Area = {...carRect, id, kind: 'passage', type: parent.type, label: 'Cargo lift', ceil: c.y + LIFT_CAR.cabH + LIFT_CAR.ceilGap,
    parent: parent.id, depth: parent.depth + 1, publicSpace: parent.publicSpace, lighting: parent.lighting};
  if (level) { car.level = level; car.floorY = c.y; }
  if (parent.paid !== undefined) car.paid = parent.paid;
  layout.areas.push(car);
  const lift = liftRecord(room.cab, room.doorSide, room.along, c.y, level, car.id, 'lower');
  // an EXIT sign on the shaft's front over the gate, facing the landing
  const n = outward(room.doorSide), d = lift.door;
  const sp: SignPlacement = {x: r3(d.x + n[0] * 0.06), y: r3(c.y + LIFT_CAR.gateH + 0.3), z: r3(d.z + n[1] * 0.06), rot: r3(Math.atan2(n[0], n[1])), kind: 'exit', text: 'LIFT TO STREET', area: parent.id, w: 1.5};
  if (level) sp.level = level;
  layout.signs.push(sp);
  // the storeys' derived views are cached by the levels ARRAY: a new array re-derives them from the carved grid
  layout.levels = layout.levels.slice();
  return {v: 2, kind: 'lift', trigger: liftTrigger(lift), returnPose: liftInsidePose(lift), areas: [parent.id, car.id], label: 'the street', rise: LIFT_CAR.rise, lift};
}

/** Version 2 Office: the lift in the lobby storey, near the boarded street entrance. */
export function carveOfficeLift(layout: StationLayout): SurfaceAccessInfo | null {
  const ent = layout.office?.windows.find(w => w.kind === 'entrance');
  const out = ent && OUT[ent.side];
  if (!ent || !out) return null;
  const level = ent.level ?? 1;
  const alongX = out[1] !== 0, plane = alongX ? (out[1] < 0 ? ent.z1 : ent.z0) : (out[0] < 0 ? ent.x1 : ent.x0);
  const mid = alongX ? (ent.x0 + ent.x1) / 2 : (ent.z0 + ent.z1) / 2;
  const ax = alongX ? mid : plane - out[0] * 3, az = alongX ? plane - out[1] * 3 : mid;
  // never against the windows (the facade's glazing and the boarded entrance)
  const keepOut = (layout.office?.windows ?? []).filter(w => (w.level ?? 0) === level).map(w => ({x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1}));
  return carveHostLift(layout, level, ax, az, keepOut);
}

/** Version 2 Mall: the lift on the street-level storey near the hashed street exit (the version-1 door's choice), else the next exit. */
export function carveMallLift(layout: StationLayout, levelSeed: number): SurfaceAccessInfo | null {
  const exits = layout.mall?.exits ?? [];
  if (!exits.length) return null;
  const start = hashString('surface-access-mall-v1', levelSeed >>> 0) % exits.length;
  for (let k = 0; k < exits.length; k++) {
    const e = exits[(start + k) % exits.length], out = OUT[e.side];
    if (!out || !layout.levels[e.level]) continue;
    const {plane, s0, s1} = e.door, mid = (s0 + s1) / 2, alongX = out[1] !== 0;
    const ax = alongX ? mid : plane - out[0] * 3, az = alongX ? plane - out[1] * 3 : mid;
    // never in front of a street exit (theirs are drawn doors / shutters)
    const keepOut = exits.filter(x => x.level === e.level).map(x => {
      const o = OUT[x.side], ax2 = o && o[1] !== 0;
      const a0 = x.door.s0, a1 = x.door.s1, c0 = x.door.plane - (o ? (o[0] + o[1]) * 3 : 0), c1 = x.door.plane;
      return ax2 ? {x0: a0, z0: Math.min(c0, c1), x1: a1, z1: Math.max(c0, c1)} : {x0: Math.min(c0, c1), z0: a0, x1: Math.max(c0, c1), z1: a1};
    });
    const info = carveHostLift(layout, e.level, ax, az, keepOut);
    if (info) return info;
  }
  return null;
}
