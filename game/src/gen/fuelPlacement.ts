// Task studio-beta-train-fuel-system-20261106-024923-01: WHERE a station's fuel plan (fuel/fuel.ts stationFuelPlan) lies in its finished
// layout — pure and deterministic (its own RNG: `fuel-place:<stationId>` over the layout seed; never the layout / loot / enemy streams;
// nothing in the layout is changed: the game realizes the result once, as ordinary pickups and a cart, on the station's first build).
//
// Task studio-beta-fuel-feedback-20261106-064128-01: the CANS are loot lots now (gen/fuelHolders.ts: shelves, counters, storage — the
// user reserves loose floor items for really key items). placeStationFuel() places the optional CART (unchanged) and only the cans NO
// holder could take (`plan.cans` = that remainder; world/fuelStations.ts) — the rare fallback, ONE can per spot (one pickup = one can:
// a spot never holds a stack of two drawn as one can).
//
// Fallback cans: in reachable back-of-house / utility rooms (gearAreaWeight: never stairs, passages, concourses or platforms; a fuel
// affinity favours workshops, plant / electrical / pump rooms, storage, maintenance and loading areas), on clear floor away from
// doorways, at least FUEL_PLACE.minFromTrain metres from the car, spread over up to FUEL_PLACE.maxSpots rooms. Reachable = on the
// walking distance field from the train door (levelDistance: stairs and ladders count). No eligible room (a tiny station): clear
// platform floor away from the car instead — the minimum is never lost.
// The optional cart: on the TRAIN'S level, on floor a wheeled cart can roll from to the train door without stairs or ramps (a cart
// distance field: >= 1 m clear across, no ramp cells, no floor step over FUEL_PLACE.cartStep), preferring a back-of-house room, else the
// platform at least FUEL_PLACE.cartFromTrain m from the car body. No such floor: null — the caller turns the cart's units into cans.
import {Rng, hashString} from '../core/rng';
import {FLOOR, type Grid} from './grid';
import {levelDistance} from './levelGen';
import {gearAreaWeight} from './gearLoot';
import {isExtensionArea} from './trackExt/types';
import type {Area, StationLayout} from './stationTypes';
import {playerTrainPlacement, trainToWorld, type TrainPlacement} from './playerTrain';
import {PLAYER_TRAIN_SPEC} from '../world/playerTrainSpec';
import type {FuelPlan} from '../fuel/fuel';

export const FUEL_PLACE = {
  /** A can spot this far from the car centre at least (m). */
  minFromTrain: 10,
  /** Rooms used for cans (at most). */
  maxSpots: 3,
  /** The cart: at least this far from the car body on the platform (m) and the largest floor step it rolls over (m). */
  cartFromTrain: 6,
  cartStep: 0.2,
} as const;

/** Purpose / word affinities for fuel (multiplies gearAreaWeight). */
const FUEL_WORDS: [RegExp, number][] = [
  [/workshop|maint|plant|pump|electrical|generator|boiler|mechanical|loading|garage|engine|depot/i, 3],
  [/storage|supply|stock|janitor|custodial|utility|service|signal|closet/i, 2],
  [/security|staff|office|lost/i, 1],
];

/** A loose fuel can (`count` is always 1 since task fuel-feedback: kept for the API's shape). */
export interface FuelSpot { x: number; y: number; z: number; level: number; area: number; count: number }
export interface FuelCartSpot { x: number; y: number; z: number; yaw: number; level: number }
export interface FuelPlacement { cans: FuelSpot[]; cart: FuelCartSpot | null }

/** A room's fuel affinity (0 = no fuel here): gearAreaWeight x the fuel words. Also weights the holders (gen/fuelHolders.ts). */
export function fuelWeight(a: Area): number {
  if (isExtensionArea(a)) return 0;
  const base = gearAreaWeight(a);
  if (base <= 0) return 0;
  const words = `${a.type} ${a.role ?? ''} ${a.purpose ?? ''} ${a.label ?? ''}`;
  for (const [re, f] of FUEL_WORDS) if (re.test(words)) return base * f;
  return base * 0.5;
}

/** The world point just outside the train's middle platform-side door (the walking / cart searches start there). */
function doorPoint(p: TrainPlacement): {x: number; z: number} {
  const doors = PLAYER_TRAIN_SPEC.doors.filter(d => d.side === -1).map(d => d.x).sort((a, b) => a - b);
  const dx = doors[Math.floor(doors.length / 2)] ?? 0;
  const w = trainToWorld(p, dx, PLAYER_TRAIN_SPEC.floorY, -(PLAYER_TRAIN_SPEC.width / 2 + 0.75));
  return {x: w.x, z: w.z};
}

const clear1 = (g: Grid, x: number, y: number) => {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy) || g.rampIdx[g.idx(x + ox, y + oy)] >= 0) return false;
  return true;
};

/** Cart distance field on one storey: >= 2 walkable cells across in both axes, no ramps, no floor step over FUEL_PLACE.cartStep. */
export function cartDistance(g: Grid, sx: number, sy: number): Int32Array {
  const W = g.w, H = g.h, d = new Int32Array(W * H).fill(-1);
  const ok = (x: number, y: number) => g.inBounds(x, y) && g.walkable(x, y) && g.rampIdx[g.idx(x, y)] < 0
    && (g.walkable(x - 1, y) || g.walkable(x + 1, y)) && (g.walkable(x, y - 1) || g.walkable(x, y + 1));
  if (!ok(sx, sy)) return d;
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  const s = g.idx(sx, sy);
  d[s] = 0; q[t++] = s;
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0, f = g.floorOf(i);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + ox, ny = y + oy;
      if (!ok(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (d[j] >= 0 || Math.abs(g.floorOf(j) - f) > FUEL_PLACE.cartStep) continue;
      d[j] = d[i] + 1; q[t++] = j;
    }
  }
  return d;
}

/** The station's levels (a single-storey layout: its grid as level 0). */
function levelsOf(layout: StationLayout) {
  return layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
}

/** Walking distance fields from the train's platform-side door (or the spawn), per storey; null when unknown. */
function doorDistance(layout: StationLayout): {dist: Int32Array[]; known: boolean} {
  const tp = playerTrainPlacement(layout), levels = levelsOf(layout), g0 = layout.grid;
  const door = tp ? doorPoint(tp) : {x: layout.playerSpawn.x, z: layout.playerSpawn.z};
  const [sx, sy] = g0.cellOf(door.x, door.z);
  let dist: Int32Array[];
  try { dist = levelDistance(levels, sx, sy, tp?.level ?? 0); } catch { dist = [g0.distanceField(sx, sy)]; }
  return {dist, known: dist.some(d => d && d.some(v => v >= 0))};
}

/** Areas with at least one cell reachable on foot from the train door, per storey (null: reachability unknown — everything counts). */
export function fuelReachableAreas(layout: StationLayout): Map<number, Set<number>> | null {
  const {dist, known} = doorDistance(layout);
  if (!known) return null;
  const out = new Map<number, Set<number>>();
  levelsOf(layout).forEach((l, lv) => {
    const d = dist[lv], set = new Set<number>();
    if (d) for (let i = 0; i < d.length; i++) if (d[i] >= 0) set.add(l.grid.area[i]);
    out.set(l.id ?? lv, set);
  });
  return out;
}

/** Where `plan` lies in `layout` (deterministic for layout + station id): the cart and `plan.cans` loose cans, one per spot. */
export function placeStationFuel(layout: StationLayout, plan: FuelPlan, station: string): FuelPlacement {
  const out: FuelPlacement = {cans: [], cart: null};
  const tp = playerTrainPlacement(layout);
  const levels = levelsOf(layout);
  const g0 = layout.grid, W = g0.w;
  const gridOf = (lv: number): Grid => levels[lv]?.grid ?? g0;
  const rng = new Rng(hashString(`fuel-place:${station}`, (layout.seed >>> 0) ^ 0x2545f491));
  const trainLv = tp?.level ?? 0;
  const {dist, known: reachKnown} = doorDistance(layout);
  const farFromTrain = (lv: number, x: number, z: number, m: number) => !tp || lv !== trainLv || Math.hypot(x - tp.x, z - tp.z) >= m;
  const used = new Set<string>();
  const cellOk = (a: Area | null, lv: number, i: number): boolean => {
    const g = gridOf(lv), dl = dist[lv];
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return false;
    const x = i % W, y = (i / W) | 0;
    if (!g.walkable(x, y) || !clear1(g, x, y)) return false;
    if (a && g.area[i] !== a.id) return false;
    if (reachKnown && (!dl || dl[i] < 0)) return false;
    if (used.has(`${lv}:${i}`)) return false;
    const [cx, cz] = g.center(x, y);
    return farFromTrain(lv, cx, cz, FUEL_PLACE.minFromTrain);
  };
  const cellsOf = (a: Area): number[] => {
    const lv = a.level ?? 0, g = gridOf(lv), cells: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.inBounds(x, y) && cellOk(a, lv, g.idx(x, y))) cells.push(g.idx(x, y));
    return cells;
  };
  const mark = (lv: number, i: number) => { const x = i % W, y = (i / W) | 0; for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (gridOf(lv).inBounds(x + ox, y + oy)) used.add(`${lv}:${gridOf(lv).idx(x + ox, y + oy)}`); };

  // --- the cart (first: a cart station carries no cans unless its cart cannot be placed)
  let cansLeft = plan.cans;
  if (plan.cart > 0) {
    out.cart = tp ? placeCart(layout, tp, rng) : null;
    if (!out.cart) cansLeft += Math.ceil(plan.cart); // (one unit per can: the minimum is never lost)
  }
  if (cansLeft <= 0) return out;

  // --- cans: weighted rooms, up to maxSpots, ONE can a spot (task fuel-feedback: one pickup = one can)
  const rooms = layout.areas.map(a => ({a, w: fuelWeight(a)})).filter(r => r.w > 0).map(r => ({...r, cells: cellsOf(r.a)})).filter(r => r.cells.length > 0);
  const spots = Math.min(FUEL_PLACE.maxSpots, Math.max(1, Math.ceil(cansLeft / 2)));
  const pool = rooms.slice();
  const chosen: {a: Area; cells: number[]}[] = [];
  while (chosen.length < spots && pool.length) {
    const r = rng.weighted(pool.map(p => [p, p.w] as [typeof p, number]));
    chosen.push(r);
    pool.splice(pool.indexOf(r), 1);
  }
  // spread the cans: as evenly as possible over the chosen rooms (one per pickup)
  const per: number[] = chosen.map(() => 0);
  for (let k = 0; k < cansLeft && chosen.length; k++) per[k % chosen.length]++;
  chosen.forEach((r, ci) => {
    let n = per[ci];
    const lv = r.a.level ?? 0, g = gridOf(lv);
    while (n > 0) {
      const cells = r.cells.filter(i => cellOk(r.a, lv, i));
      if (!cells.length) break;
      const i = rng.pick(cells), c = 1;
      const [x, z] = g.center(i % W, (i / W) | 0);
      out.cans.push({x, y: g.floorOf(i), z, level: lv, area: r.a.id, count: c});
      mark(lv, i);
      n -= c;
    }
    cansLeft -= per[ci] - n;
  });
  // fallback: whatever is left goes onto clear, reachable floor of the train's level, away from the car
  if (cansLeft > 0) {
    const g = gridOf(trainLv), cells: number[] = [];
    for (let i = 0; i < g.cells.length; i++) if (cellOkLoose(g, trainLv, i)) cells.push(i);
    while (cansLeft > 0 && cells.length) {
      const k = Math.floor(rng.next() * cells.length), i = cells[k];
      cells.splice(k, 1);
      if (used.has(`${trainLv}:${i}`)) continue;
      const [x, z] = g.center(i % W, (i / W) | 0), c = 1;
      out.cans.push({x, y: g.floorOf(i), z, level: trainLv, area: g.area[i], count: c});
      mark(trainLv, i);
      cansLeft -= c;
    }
  }
  return out;

  function cellOkLoose(g: Grid, lv: number, i: number): boolean {
    if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return false;
    const x = i % W, y = (i / W) | 0;
    if (!clear1(g, x, y)) return false;
    if (reachKnown && (!dist[lv] || dist[lv][i] < 0)) return false;
    const [cx, cz] = g.center(x, y);
    return farFromTrain(lv, cx, cz, FUEL_PLACE.cartFromTrain + 2);
  }
}

/** The cart: on the train's level, reachable for wheels to the door; a back-of-house room first, else the platform away from the car. */
function placeCart(layout: StationLayout, tp: TrainPlacement, rng: Rng): FuelCartSpot | null {
  const levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
  const g = levels[tp.level]?.grid ?? layout.grid, W = g.w;
  const door = doorPoint(tp);
  const [sx, sy] = g.cellOf(door.x, door.z);
  const d = cartDistance(g, sx, sy);
  const bodyGap = (x: number, z: number) => {
    const dx = Math.max(0, Math.abs(x - tp.x) - tp.length / 2), dz = Math.max(0, Math.abs(z - tp.z) - tp.width / 2);
    return Math.hypot(dx, dz);
  };
  const rooms: [number, number][] = [], platform: number[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (d[i] < 0 || g.cells[i] !== FLOOR || !clear1(g, i % W, (i / W) | 0)) continue;
    const [x, z] = g.center(i % W, (i / W) | 0);
    if (bodyGap(x, z) < FUEL_PLACE.cartFromTrain) continue;
    const a = layout.areas[g.area[i]];
    const w = a ? fuelWeight(a) : 0;
    if (w > 0) rooms.push([i, w]); else if (a && a.kind === 'platform' && Math.abs(g.floorOf(i) - tp.floorY) < 0.25) platform.push(i);
  }
  let i: number | null = null;
  if (rooms.length) i = rng.weighted(rooms.map(([c, w]) => [c, w] as [number, number]));
  else if (platform.length) i = rng.pick(platform);
  if (i === null) return null;
  const [x, z] = g.center(i % W, (i / W) | 0);
  return {x, y: g.floorOf(i), z, yaw: rng.next() * Math.PI * 2, level: tp.level};
}
