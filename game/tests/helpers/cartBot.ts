// Task studio-fuel-cart-stairs-20261110-004505-01: a test BOT that moves fuel carts the way a player does — no teleports, no direct
// writes to the cart: it plans a route with the cart's own controller, then drives the REAL Player body with key input (look, W, E)
// through tests/helpers/fuelCartsHost.ts frame() (Game.update's order), the cart grabbed in front of it.
//
//  - planCartRoute(): Dijkstra over a 0.25 m lattice whose every edge is the real controller move (world/fuelCartPhysics.ts moveCart:
//    the player's collision + the cart's floor rule) — stair runs, landings, doorways and thresholds are passable exactly where the cart
//    itself passes; nodes away from walls are preferred (a person steers a cart down the middle). Null = no physical route.
//  - CartBot: grab (look at the handle, E), drag along a route (the player walks the route, the cart held ahead), let go, connect the hose
//    (look at the drum, E), walk without a cart. A let-go the game forces ('stuck') is counted and re-grabbed like a player would.

import * as THREE from 'three';
import {moveCircle} from '../../src/core/physics';
import {CART, footprintFloor, moveCart, type CartBody, type CartWorld} from '../../src/world/fuelCartPhysics';
import {CART_LOOK} from '../../src/world/fuelCartModel';
import {FUEL_CART, type FuelCarts} from '../../src/world/fuelCarts';
import {DT, frame, lookAt, type CartTestHost} from './fuelCartsHost';

export interface RouteNode { x: number; y: number; z: number; level: number }

const S = 0.25;
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Nothing (wall, rail, prop) within radius r of (x, z) for a body standing at height y. */
function clearAt(w: CartWorld, x: number, z: number, y: number, r: number): boolean {
  const [nx, nz] = moveCircle(w.levels, w.props, x, z, 1e-7, 0, r, y, CART.height);
  return Math.abs(nx - x) < 1e-4 && Math.abs(nz - z) < 1e-4;
}

/** A tiny binary heap of [cost, id]. */
class Heap {
  private readonly c: number[] = [];
  private readonly v: number[] = [];
  get size(): number { return this.c.length; }
  push(cost: number, id: number): void {
    const c = this.c, v = this.v;
    let i = c.length;
    c.push(cost); v.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const c = this.c, v = this.v, out: [number, number] = [c[0], v[0]];
    const lc = c.pop()!, lv = v.pop()!;
    if (c.length) {
      c[0] = lc; v[0] = lv;
      for (let i = 0; ;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i;
        if (a < c.length && c[a] < c[m]) m = a;
        if (b < c.length && c[b] < c[m]) m = b;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return out;
  }
}

export const ROUTE_STATS = {expanded: 0, ms: 0};

/** Edge results of one world (the controller move from a lattice node in a direction), shared by the routes planned in it. */
export type RouteCache = Map<number, {ok: boolean; y: number; level: number; tight: number}>;

/**
 * The cheapest physical cart route from `from` to within `reach` (m, horizontal; same storey height) of `to`, as lattice nodes 0.25 m
 * apart — every step a real moveCart of the cart's controller. Null when the cart cannot get there.
 */
export function planCartRoute(w: CartWorld, from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}, opts: {reach?: number; maxNodes?: number; cache?: RouteCache} = {}): RouteNode[] | null {
  const t0 = performance.now();
  const reach = opts.reach ?? 0.3, maxNodes = opts.maxNodes ?? 600_000;
  const key = (ix: number, iz: number, y: number) => (ix + 2048) + (iz + 2048) * 4096 + (Math.round(y / 3.5) + 32) * 16777216;
  interface N { ix: number; iz: number; y: number; level: number; g: number; parent: number; done: boolean }
  const nodes: N[] = [];
  const index = new Map<number, number>();
  const heap = new Heap();
  // the start: the lattice point nearest `from` the cart can stand on
  let start: N | null = null, bd = Infinity;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const ix = Math.round(from.x / S) + dx, iz = Math.round(from.z / S) + dz;
    const f = footprintFloor(w.levels, ix * S, iz * S, from.y);
    if (!f || !clearAt(w, ix * S, iz * S, f.floor, CART.radius)) continue;
    const d = Math.hypot(ix * S - from.x, iz * S - from.z);
    if (d < bd) { bd = d; start = {ix, iz, y: f.floor, level: f.level, g: 0, parent: -1, done: false}; }
  }
  if (!start) return null;
  nodes.push(start);
  index.set(key(start.ix, start.iz, start.y), 0);
  heap.push(0, 0);
  // (a storey apart costs at least its stair run: 1.6 m of flight per metre of height; slightly inflated — a bot's route need not be
  // the single shortest one)
  const h = (n: N) => (Math.hypot(n.ix * S - to.x, n.iz * S - to.z) + 1.6 * Math.abs(n.y - to.y)) / S * 1.15;
  const b: CartBody = {x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, level: 0, units: 0};
  let goal = -1;
  ROUTE_STATS.expanded = 0;
  while (heap.size) {
    const [, id] = heap.pop();
    const n = nodes[id];
    if (n.done) continue;
    n.done = true;
    ROUTE_STATS.expanded++;
    if (Math.abs(n.y - to.y) < 1 && Math.hypot(n.ix * S - to.x, n.iz * S - to.z) <= reach) { goal = id; break; }
    if (nodes.length > maxNodes) break;
    const nk = key(n.ix, n.iz, n.y);
    for (let di = 0; di < 4; di++) {
      const [dx, dz] = DIRS[di];
      const tx = (n.ix + dx) * S, tz = (n.iz + dz) * S;
      let e = opts.cache?.get(nk * 4 + di);
      if (!e) {
        b.x = n.ix * S; b.z = n.iz * S; b.y = n.y; b.level = n.level;
        for (let k = 0; k < 3; k++) moveCart(b, w, dx * S / 3, dz * S / 3);
        const ok = Math.abs(b.x - tx) <= 0.01 && Math.abs(b.z - tz) <= 0.01;
        // steering room: a node hard against a wall / prop costs more (a person keeps a cart off the walls where there is room)
        const tight = !ok ? 0 : !clearAt(w, tx, tz, b.y, CART.radius + 0.2) ? 3 : !clearAt(w, tx, tz, b.y, CART.radius + 0.45) ? 1 : 0;
        e = {ok, y: b.y, level: b.level, tight};
        opts.cache?.set(nk * 4 + di, e);
      }
      if (!e.ok) continue;
      b.y = e.y; b.level = e.level;
      const tight = e.tight;
      const kk = key(n.ix + dx, n.iz + dz, b.y);
      let j = index.get(kk);
      const g = n.g + 1 + tight;
      if (j === undefined) {
        j = nodes.length;
        nodes.push({ix: n.ix + dx, iz: n.iz + dz, y: b.y, level: b.level, g, parent: id, done: false});
        index.set(kk, j);
      } else {
        const m = nodes[j];
        if (m.done || m.g <= g) continue;
        m.g = g; m.parent = id; m.y = b.y; m.level = b.level;
      }
      heap.push(g + h(nodes[j]), j);
    }
  }
  ROUTE_STATS.ms = performance.now() - t0;
  if (goal < 0) return null;
  const out: RouteNode[] = [];
  for (let i = goal; i >= 0; i = nodes[i].parent) out.push({x: nodes[i].ix * S, y: nodes[i].y, z: nodes[i].iz * S, level: nodes[i].level});
  return out.reverse();
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export interface DragResult {
  ok: boolean;
  /** Simulated seconds. */
  t: number;
  /** Times the game made the player let go on the way (re-grabbed by the bot). */
  forcedLetGo: number;
  why?: string;
  /** The cart's height range on the way. */
  yMin: number; yMax: number;
}

/** The player-like driver. */
export class CartBot {
  /** Player turn rate (rad/s) and look-ahead along a route (m). */
  turn = 4;
  ahead = 1.25;
  /** Edge cache of this world's routes. */
  readonly cache: RouteCache = new Map();
  private readonly v = new THREE.Vector3();
  constructor(readonly h: CartTestHost, readonly carts: FuelCarts, readonly world: () => CartWorld) {}

  route(from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}, reach = 0.3): RouteNode[] | null {
    return planCartRoute(this.world(), from, to, {reach, cache: this.cache});
  }

  body(uid: string): CartBody {
    const b = this.carts.bodyOf(uid);
    if (!b) throw new Error(`no cart ${uid}`);
    return b;
  }

  private face(x: number, z: number, rate = this.turn): number {
    const P = this.h.player, want = Math.atan2(-(x - P.x), -(z - P.z)), d = wrap(want - P.yaw);
    P.yaw = wrap(P.yaw + Math.max(-rate * DT, Math.min(rate * DT, d)));
    return Math.abs(wrap(want - P.yaw));
  }

  /** A point of the cart's own frame where it is DRAWN (the view's pose: tilted on steps). */
  private partOf(uid: string, x: number, y: number, z: number): {x: number; y: number; z: number} {
    const g = this.carts.viewOf(uid);
    if (!g) throw new Error(`no cart ${uid}`);
    const p = this.v.set(x, y, z).applyMatrix4(g.matrixWorld);
    return {x: p.x, y: p.y, z: p.z};
  }

  /** One frame holding (or not) W. */
  private tick(forward: boolean): void {
    const k = this.h.keys;
    if (forward) k.held.add('KeyW'); else k.held.delete('KeyW');
    frame(this.h);
  }

  /** Stand still for `seconds`. */
  wait(seconds: number): void {
    this.h.keys.held.delete('KeyW');
    for (let t = 0; t < seconds - 1e-9; t += DT) frame(this.h);
  }

  /** Look at a world point at once and press E (one frame). */
  pressAt(x: number, y: number, z: number): void {
    this.h.keys.held.delete('KeyW');
    lookAt(this.h, x, y, z);
    frame(this.h); // (the aim reads last frame's camera)
    this.h.keys.hits.add('KeyE');
    frame(this.h);
  }

  /** The cart's handle bar in the world (where a player grabs it). */
  handleOf(uid: string): {x: number; y: number; z: number} {
    return this.partOf(uid, 0, CART_LOOK.handle.y, CART_LOOK.handle.z);
  }

  drumOf(uid: string): {x: number; y: number; z: number} {
    return this.partOf(uid, 0, CART_LOOK.drumTop - 0.08, CART_LOOK.drumZ);
  }

  /** Walk the bare player (no cart) to within `near` of a point along a planned route (the cart planner: conservative). */
  walkTo(x: number, y: number, z: number, near = 0.35, timeout = 240): boolean {
    const P = this.h.player;
    if (this.carts.grab) throw new Error('walkTo with a cart grabbed');
    if (Math.hypot(P.x - x, P.z - z) <= near && Math.abs(P.y - y) < 1) return true;
    const route = this.route({x: P.x, y: P.y, z: P.z}, {x, y, z}, Math.max(0.3, near));
    if (!route) return false;
    let k = 0, t = 0;
    while (t < timeout) {
      while (k < route.length - 1 && Math.hypot(route[k].x - P.x, route[k].z - P.z) < 0.5) k++;
      const T = route[Math.min(route.length - 1, k + 2)];
      if (Math.hypot(P.x - x, P.z - z) <= near && Math.abs(P.y - y) < 1) { this.h.keys.held.delete('KeyW'); return true; }
      if (k >= route.length - 1 && Math.hypot(route[k].x - P.x, route[k].z - P.z) < 0.2) break;
      const off = this.face(T.x, T.z);
      this.tick(off < 0.7);
      t += DT;
    }
    // the last steps: straight at the point itself, until there or no longer getting nearer (something in the way: a cart, a wall)
    for (let best = Infinity, stall = 0; t < timeout && stall < 0.6; t += DT) {
      const d = Math.hypot(P.x - x, P.z - z);
      if (d <= near) break;
      if (d < best - 1e-3) { best = d; stall = 0; } else stall += DT;
      this.tick(this.face(x, z) < 0.5);
    }
    this.h.keys.held.delete('KeyW');
    return Math.hypot(P.x - x, P.z - z) <= near + 0.3 && Math.abs(P.y - y) < 1;
  }

  /**
   * Grab the cart like a player: aim at a part of it that is in reach — the handle, else its frame, else the drum (E on the drum grabs
   * when no hose can connect) — stepping up to the cart first when nothing is (a cart lying nose-down on a stair has its handle on
   * its far side).
   */
  grab(uid: string): boolean {
    const P = this.h.player, K = CART_LOOK;
    if (this.carts.grab?.cart.uid === uid) return true;
    if (this.carts.grab) this.letGo();
    const parts = (): {x: number; y: number; z: number}[] => [
      this.handleOf(uid), this.partOf(uid, 0, 0.8, K.frame.z), this.partOf(uid, 0, 0.45, K.frame.z), this.partOf(uid, 0, K.drumTop - 0.05, K.drumZ),
    ];
    const tryParts = (): boolean => {
      for (const p of parts()) {
        if (Math.hypot(p.x - P.x, p.y - P.eye, p.z - P.z) > FUEL_CART.drumReach + 0.6) continue;
        this.pressAt(p.x, p.y, p.z);
        if (this.carts.grab?.cart.uid === uid) return true;
        if (this.carts.hoseOn?.cart.uid === uid) this.pressAt(p.x, p.y, p.z); // (the drum with a hose target in reach: connected — disconnect again)
      }
      return false;
    };
    for (let tries = 0; tries < 3; tries++) {
      if (tryParts()) return true;
      // step right up to it from its handle side (a cart lying nose-down on a stair is only in reach from close by), else as near
      // as the player can get
      const b = this.body(uid), off = tries === 0 ? 0.72 : 0.67;
      const back = {x: b.x - Math.sin(b.yaw) * off, z: b.z - Math.cos(b.yaw) * off};
      const by = this.world().levels.supportAt(back.x, back.z, b.y + 0.9)?.floor ?? b.y;
      if (!this.walkTo(back.x, by, back.z, 0.1, 60)) this.walkTo(b.x, b.y, b.z, 0.75, 60);
    }
    return tryParts();
  }

  letGo(): void {
    if (!this.carts.grab) return;
    const P = this.h.player;
    this.h.keys.held.delete('KeyW');
    this.h.keys.hits.add('KeyE');
    frame(this.h);
    void P;
  }

  /**
   * Drag the grabbed cart `uid` to within `arrive` of (x, y, z): plans the cart's route, walks the player along it with the cart held
   * ahead. The player first steps round to the route's near side when there is room.
   */
  dragTo(uid: string, x: number, y: number, z: number, opts: {arrive?: number; timeout?: number} = {}): DragResult {
    const arrive = opts.arrive ?? 0.45, timeout = opts.timeout ?? 600;
    const P = this.h.player, b = this.body(uid);
    const res: DragResult = {ok: false, t: 0, forcedLetGo: 0, yMin: b.y, yMax: b.y};
    const route = this.route({x: b.x, y: b.y, z: b.z}, {x, y, z}, Math.max(0.3, arrive - 0.1));
    if (!route) { res.why = 'no physical cart route'; return res; }
    if (!this.grab(uid)) { res.why = 'could not grab'; return res; }
    const letGo0 = this.carts.counts.letGo;
    // the route as the CART's line; the player trails it by the hold distance: aim the hand point at the route `ahead` of the cart
    let k = 0, stall = 0, lastProg = 0, t = 0;
    const end = route[route.length - 1];
    while (t < timeout) {
      const c = this.body(uid);
      res.yMin = Math.min(res.yMin, c.y); res.yMax = Math.max(res.yMax, c.y);
      if (Math.hypot(c.x - end.x, c.z - end.z) <= arrive && Math.abs(c.y - end.y) < 0.6) { res.ok = true; break; }
      if (!this.carts.grab) {
        // the game made the player let go (stuck / too far): a player grabs it again
        res.forcedLetGo++;
        if (res.forcedLetGo > 8 || !this.grab(uid)) { res.why = `lost the cart at ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`; break; }
        continue;
      }
      // the cart's progress along its route (monotone, a short window ahead)
      for (let j = k; j < Math.min(route.length, k + 10); j++) if (Math.hypot(route[j].x - c.x, route[j].z - c.z) < Math.hypot(route[k].x - c.x, route[k].z - c.z) && Math.abs(route[j].y - c.y) < 1.2) k = j;
      if (k > lastProg) { lastProg = k; stall = 0; } else stall += DT;
      if (stall > 12) { res.why = `no progress at route ${k}/${route.length} cart ${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)} player ${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)}`; break; }
      const T = route[Math.min(route.length - 1, k + Math.round(this.ahead / S))];
      // the player's facing puts the hand point (FUEL_CART.hold ahead) on the route: face the look-ahead point; walk while the hand
      // point is short of it
      // (a player swings a heavy cart round only as fast as it follows: turn slowly while the hand point is ahead of the cart)
      const hx = P.x - Math.sin(P.yaw) * FUEL_CART.hold, hz = P.z - Math.cos(P.yaw) * FUEL_CART.hold;
      const lag = Math.hypot(hx - c.x, hz - c.z);
      const off = this.face(T.x, T.z, lag > 0.6 ? this.turn * 0.2 : this.turn);
      const dT = Math.hypot(T.x - P.x, T.z - P.z);
      this.tick(off < 0.6 && lag < 0.9 && dT > FUEL_CART.hold + 0.05);
      t += DT;
    }
    this.h.keys.held.delete('KeyW');
    res.t = t;
    res.forcedLetGo = Math.max(res.forcedLetGo, this.carts.counts.letGo - letGo0);
    if (!res.ok && !res.why) res.why = 'timeout';
    return res;
  }

  /** Let go, then connect the hose: look at the drum (stepping into reach), E. True when a hose is connected to this cart. */
  connectHose(uid: string): boolean {
    this.letGo();
    const P = this.h.player;
    for (let tries = 0; tries < 3; tries++) {
      const d = this.drumOf(uid);
      if (Math.hypot(d.x - P.x, d.y - P.eye, d.z - P.z) > FUEL_CART.drumReach - 0.3) {
        const b = this.body(uid);
        this.walkTo(b.x - Math.sin(b.yaw) * 0.9, b.y, b.z - Math.cos(b.yaw) * 0.9, 0.3, 30);
      }
      const dd = this.drumOf(uid);
      this.pressAt(dd.x, dd.y, dd.z);
      if (this.carts.hoseOn?.cart.uid === uid) return true;
      if (this.carts.grab) this.letGo(); // (the aim met the frame: it grabbed instead)
    }
    return false;
  }
}
