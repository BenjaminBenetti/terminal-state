// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up): the Surface Run truck on a REAL generated district (lane GEN's
// generateSurfaceDistrict) for Node system tests — the district (cached per seed / host), a street ROUTE for the truck (Dijkstra over the
// street-level drivable cells, kept away from obstacles by a clearance weight: the generator's own vehicle rule — gen/surface/cityCheck.ts
// vehicleFlood — with the prop boxes added) and an AUTOPILOT that drives the REAL vehicle controller with the player's keys only (W / S,
// A / D: a pure-pursuit steer target held by tapping the steering keys; a speed target) and reports whether it arrived or got stuck.
import {CELL, FLOOR} from '../../src/gen/grid';
import {levelsOf, type Levels} from '../../src/gen/levels';
import type {StationLayout} from '../../src/gen/stationTypes';
import {generateSurfaceDistrict, setSurfaceGenDebug, surfaceGenDebug} from '../../src/gen/surface/index';
import type {SurfaceHost} from '../../src/gen/surface/surfaceRun';
import type {SRect, SurfaceInfo} from '../../src/gen/surface/surfaceTypes';
import type {SkywaysCar} from '../../src/world/skywaysCar';
import {TRUCK_GEOM} from '../../src/world/surface/truckSpec';
import {DT, frame, type CarTestHost} from './skywaysCarHost';

export interface District { seed: number; host: SurfaceHost; L: StationLayout; S: SurfaceInfo; levels: Levels; taken: Uint8Array }

const cache = new Map<string, District>();

/** The generated district (the generator's debug record kept: its pending-prop cells). */
export function district(seed: number, host: SurfaceHost): District {
  const key = `${seed}:${host}`;
  let d = cache.get(key);
  if (!d) {
    setSurfaceGenDebug(true);
    const L = generateSurfaceDistrict(host, {levelSeed: seed} as never);
    d = {seed, host, L, S: L.surface!, levels: levelsOf(L), taken: surfaceGenDebug(L)?.taken ?? new Uint8Array(L.grid.w * L.grid.h)};
    cache.set(key, d);
  }
  return d;
}

/** The DEPOT's loading lot (lane GEN: the lot of the depot's block used for loading). */
export function loadingLot(D: District): SRect {
  const dep = D.S.buildings[D.S.depot.building];
  return D.S.lots!.find(l => l.block === dep.block && l.use === 'loading')!.rect;
}

/** Street-level cells a truck may stand on: outdoor FLOOR of level 0, no ramp / blocked / pending-prop cell, under no prop, near grade. */
export function drivable(D: District): Uint8Array {
  const g = D.L.grid, n = g.w * g.h, out = new Uint8Array(n), outdoor = new Set(D.S.outdoorAreas);
  for (let i = 0; i < n; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && !g.blocked[i] && !D.taken[i] && outdoor.has(g.area[i]) && g.floor[i] < 0.25) out[i] = 1;
  for (const p of D.L.props) {
    if ((p.level ?? 0) !== 0 || p.h <= 0.2 || p.y > 2) continue;
    const x0 = Math.floor((p.x - p.hx) / CELL), x1 = Math.floor((p.x + p.hx) / CELL), y0 = Math.floor((p.z - p.hz) / CELL), y1 = Math.floor((p.z + p.hz) / CELL);
    for (let y = Math.max(0, y0); y <= Math.min(g.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(g.w - 1, x1); x++) out[y * g.w + x] = 0;
  }
  return out;
}

/** Distance (m) from each cell to the nearest non-drivable cell (two-pass chamfer). */
export function clearance(D: District, free: Uint8Array): Float32Array {
  const W = D.L.grid.w, H = D.L.grid.h, d = new Float32Array(W * H), a = CELL, b = CELL * Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = free[i] ? 1e9 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - W] + a); if (x > 0) v = Math.min(v, d[i - W - 1] + b); if (x < W - 1) v = Math.min(v, d[i - W + 1] + b); }
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) v = Math.min(v, a);
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + a);
    if (y < H - 1) { v = Math.min(v, d[i + W] + a); if (x < W - 1) v = Math.min(v, d[i + W + 1] + b); if (x > 0) v = Math.min(v, d[i + W - 1] + b); }
    d[i] = v;
  }
  return d;
}

export interface RoutePoint { x: number; z: number }

/**
 * The truck's street route from (x, z) into `goal` (its deepest-cleared cell): Dijkstra over cells with at least `minClear` m of
 * clearance, each step weighted up near obstacles (centred on the carriageway). Null: no route.
 */
export function planRoute(D: District, from: RoutePoint, goal: SRect, o: {minClear?: number; prefer?: number} = {}): RoutePoint[] | null {
  const g = D.L.grid, W = g.w, H = g.h, free = drivable(D), C = clearance(D, free), minC = o.minClear ?? 2.0, pref = o.prefer ?? 4.5;
  const cell = (x: number, z: number) => Math.floor(z / CELL) * W + Math.floor(x / CELL);
  // the goal cell: the best-cleared cell inside the goal rect
  let target = -1, tc = 0;
  for (let y = Math.ceil(goal.z0 / CELL); y < Math.floor(goal.z1 / CELL); y++) for (let x = Math.ceil(goal.x0 / CELL); x < Math.floor(goal.x1 / CELL); x++) {
    const i = y * W + x;
    if (C[i] > tc) { tc = C[i]; target = i; }
  }
  if (target < 0 || tc < minC) return null;
  let start = cell(from.x, from.z);
  if (C[start] < minC) { // (the parked pose may sit closer to the compound's fixtures: the nearest well-cleared cell)
    let best = -1, bd = Infinity;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) { const j = start + dx + dy * W; if (C[j] >= minC && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = j; } }
    if (best < 0) return null;
    start = best;
  }
  const dist = new Float64Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
  // binary heap of (cost, cell)
  const hk: number[] = [], hv: number[] = [];
  const push = (k: number, v: number) => {
    hk.push(k); hv.push(v);
    let i = hk.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; }
  };
  const pop = (): number => {
    const top = hv[0], lk = hk.pop()!, lv = hv.pop()!;
    if (hk.length) {
      hk[0] = lk; hv[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hk.length && hk[l] < hk[m]) m = l;
        if (r < hk.length && hk[r] < hk[m]) m = r;
        if (m === i) break;
        [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m;
      }
    }
    return top;
  };
  dist[start] = 0;
  push(0, start);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (hk.length) {
    const k = hk[0], c = pop();
    if (k > dist[c]) continue;
    if (c === target) break;
    const cx = c % W, cy = (c - cx) / W;
    for (const [dx, dy, len] of NB) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (C[j] < minC) continue;
      const nd = dist[c] + len * (1 + Math.max(0, pref - C[j]) * 2);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = c; push(nd, j); }
    }
  }
  if (!Number.isFinite(dist[target])) return null;
  const out: RoutePoint[] = [];
  for (let c = target; c >= 0; c = prev[c]) out.push({x: ((c % W) + 0.5) * CELL, z: (Math.floor(c / W) + 0.5) * CELL});
  return out.reverse();
}

export interface DriveReport {
  arrived: boolean;
  stuck: boolean;
  seconds: number;
  /** Metres driven (the controller's own step distances). */
  driven: number;
  /** The body's floor heights seen (kerbs: the compound / sidewalks at 0.15, the carriageway at 0). */
  minY: number;
  maxY: number;
  /** Frames the controller reported blocked. */
  blockedFrames: number;
  /** The route index reached. */
  reached: number;
  /** Times the driver backed up (a three-point turn: the route behind, or the nose against something). */
  reversals: number;
}

/**
 * Drive the seated truck along `route` with the keys only, until its centre is inside `goal` (shrunk by `inset`) — then brake to a stop
 * — or until `maxS`. Stuck: no progress along the route for `stuckS`. `each` runs after every frame (assertions, events). A route that
 * starts behind the truck (or its nose against something) gets a three-point turn: backed up on the opposite lock, then on again.
 */
export function driveRoute(h: CarTestHost, car: SkywaysCar, route: readonly RoutePoint[], goal: SRect | null,
  o: {speed?: number; maxS?: number; stuckS?: number; inset?: number; each?: (f: number) => void} = {}): DriveReport {
  const b = () => car.body!, wb = TRUCK_GEOM.wheelBase, vMax = o.speed ?? 6, maxS = o.maxS ?? 240, stuckS = o.stuckS ?? 6, inset = o.inset ?? 1.5;
  const rep: DriveReport = {arrived: false, stuck: false, seconds: 0, driven: 0, minY: Infinity, maxY: -Infinity, blockedFrames: 0, reached: 0, reversals: 0};
  let idx = 0, bestIdx = 0, bestT = 0, lastX = b().x, lastZ = b().z;
  // a turn on the spot the driver's way: the route behind the truck (it starts facing the wrong way) or the nose against something ->
  // back up on the opposite lock until the route is ahead enough, then on again (a three-point turn)
  let reverse = false, modeT = 0, blockedT = 0;
  const inGoal = () => !!goal && b().x > goal.x0 + inset && b().x < goal.x1 - inset && b().z > goal.z0 + inset && b().z < goal.z1 - inset;
  for (let f = 0; rep.seconds < maxS; f++) {
    const B = b();
    // the nearest route point ahead of the last one (a window: never jumps back)
    let bd = Infinity;
    for (let i = idx; i < Math.min(route.length, idx + 80); i++) { const d = Math.hypot(route[i].x - B.x, route[i].z - B.z); if (d < bd) { bd = d; idx = i; } }
    if (idx > bestIdx) { bestIdx = idx; bestT = rep.seconds; }
    if (inGoal() || idx >= route.length - 2) break;
    if (rep.seconds - bestT > stuckS) { rep.stuck = true; break; }
    // pure pursuit: a look-ahead point along the route
    const ld = 4 + 0.9 * Math.abs(B.v);
    let j = idx, acc = 0;
    while (j < route.length - 1 && acc < ld) { acc += Math.hypot(route[j + 1].x - route[j].x, route[j + 1].z - route[j].z); j++; }
    const T = route[j], want = Math.atan2(-(T.x - B.x), -(T.z - B.z));
    let alpha = want - B.yaw;
    while (alpha > Math.PI) alpha -= 2 * Math.PI;
    while (alpha < -Math.PI) alpha += 2 * Math.PI;
    modeT += DT;
    if (!reverse && (Math.abs(alpha) > 2.0 || blockedT > 0.6)) { reverse = true; modeT = blockedT = 0; rep.reversals++; }
    else if (reverse && ((Math.abs(alpha) < 0.6 && modeT > 1.2) || modeT > 4 || blockedT > 0.6)) { reverse = false; modeT = blockedT = 0; }
    // forward: pure pursuit (full lock toward a point behind the axle line); reverse: the opposite lock turns the nose the same way
    const lock = Math.sign(alpha || 1) * 1;
    const delta = reverse ? -lock : Math.abs(alpha) > Math.PI / 2 ? lock : Math.atan2(2 * wb * Math.sin(alpha), Math.max(ld, 1));
    const K = h.keys.held;
    K.delete('KeyA'); K.delete('KeyD'); K.delete('KeyW'); K.delete('KeyS');
    if (delta > B.steer + 0.02) K.add('KeyA');
    else if (delta < B.steer - 0.02) K.add('KeyD');
    if (reverse) {
      if (B.v > -2.5) K.add('KeyS');
    } else {
      const target = Math.abs(alpha) > 0.35 ? Math.min(vMax, 3.5) : vMax;
      if (B.v < target - 0.2) K.add('KeyW');
      else if (B.v > target + 1.2) K.add('KeyS');
    }
    frame(h, car);
    rep.seconds += DT;
    const B2 = b();
    // pedal held the way it should go, and the body hardly moving: against something
    blockedT = (K.has('KeyW') && !reverse && B2.v < 0.1) || (K.has('KeyS') && reverse && B2.v > -0.1) ? blockedT + DT : 0;
    rep.driven += Math.hypot(B2.x - lastX, B2.z - lastZ);
    lastX = B2.x; lastZ = B2.z;
    rep.minY = Math.min(rep.minY, B2.y);
    rep.maxY = Math.max(rep.maxY, B2.y);
    if (car.lastImpact && car.lastImpact.speed > 0 && Math.abs(B2.v) < 0.05 && h.keys.held.has('KeyW')) rep.blockedFrames++;
    o.each?.(f);
  }
  rep.reached = bestIdx;
  rep.arrived = inGoal() || (!rep.stuck && bestIdx >= route.length - 2);
  // brake to a stop and let go
  h.keys.held.clear();
  h.keys.held.add('KeyS');
  for (let t = 0; t < 8 && Math.abs(b().v) > 0.05; t += DT) frame(h, car);
  h.keys.held.clear();
  for (let t = 0; t < 0.2; t += DT) frame(h, car);
  return rep;
}
