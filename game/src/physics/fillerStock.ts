// Iteration 08 (Lane S): FILLER STOCK physics — every packaged piece on a stocked shelf is a rigid
// body ON DEMAND in the station's bounded cannon-es world (physics/world.ts, registered as a
// BodySource), never a loot item.
//
//  - At rest a piece has NO body: it is part of an instanced / merged rest pose (world/shelfStock.ts)
//    and a spatial hash (0.5 m cells) for exact ray / overlap tests.
//  - A pellet / bullet ray that hits it (exact per-piece test against its own box or upright
//    cylinder) wakes it into a body (box / cylinder collider, mass, contact material and impact
//    sound family per packaging) and applies the shot's impulse AT the hit point (off-centre hits
//    spin / tip / roll it) plus a little lift. Pieces stacked on it lose their support and wake too.
//  - Knock-on is local and physical: a moving body (filler, a loose loot item, a light prop, a
//    chunk) wakes only the resting pieces its swept box is about to touch; their bodies start at
//    their rest pose and receive the contact push they actually get from the solver. A flying piece
//    that touches a real loot lot lifts it off its holder into a pickup (same item id / count via
//    the existing detach path) so loot is never shadowed or duplicated.
//  - Bodies collide with every level's floors / slab undersides / treads / walls / railings, prop
//    boxes, loot-holder shelves and the stocked holders' real boards (holderBoxes hook), each other,
//    loose items and chunks. They settle and SLEEP: the body is removed and the piece rests at its new
//    pose for the rest of the station (never respawned, duplicated or erased).
//  - Budget: at most MAX_ACTIVE_FILLER simulate at once; to make room the oldest nearly-at-rest one
//    is retired to its rest pose, else the oldest moving one is FROZEN in place (velocity saved) and
//    resumes when a slot frees. Fast small bodies: speed / spin clamps, a swept segment test against
//    the thin shelf boards after every fixed step, and the shared ground clamp, so nothing tunnels.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_STATIC} from './ragdoll';
import {groundClamp, restTime, type BodyHost, type ImpactFamily} from './chunks';
import {PHYS_MATS, type PhysMat} from '../damage/materials';
import type {BodySource} from './world';
import type {PickupLike, Walker} from './dynamicItems';

/**
 * Shot response on filler — GAME FEEL on top of real contact physics (the user's brief: "shoot a shelf
 * with a shotgun and the items go flying"). Live object so QA can tune it in the browser.
 *  - impulsePerDamage: N.s per point of pellet damage (~6.3 N.s for a close 15-damage pellet, ~4x a real
 *    00-buck pellet's ~1.4 N.s), capped per piece at maxDv m/s; `lift` share added upward.
 *  - splash: resting neighbours on the SAME board of the SAME holder within splashRadius m of the impact get
 *    splashShare of the push x (1 - d/R)^1.5 (skipped below splashMinK), mostly along the pellet (into the
 *    shelf, splashAlong) and a little away from the impact (splashOut), splashLift upward, capped at
 *    splashMaxDv m/s (a neighbour is jostled off the board, never launched over a railing), at a point low
 *    on their impact side (they tip and tumble). Never another board / holder (no blast through boards or shelves).
 *  - rebound: for bounceWindow s after a hit, a piece striking a near-vertical board (shelf back / side)
 *    faster than 1.2 m/s leaves it at >= bounceE of the impact speed with a lateral / upward spray (at most
 *    2 times), so it comes back off the board instead of jamming into it.
 */
export const FILLER_TUNING = {
  /** Simultaneously simulating filler bodies (measured cost: tests/shelfStock-physics.test.ts, lane notes). */
  maxActive: 64,
  impulsePerDamage: 0.42, maxDv: 11, lift: 1.0,
  splashRadius: 0.25, splashShare: 0.8, splashMinK: 0.15, splashLift: 0.7, splashMaxDv: 7, splashOut: 0.5, splashAlong: 0.85,
  bounceE: 0.8, bounceWindow: 1.2,
};
/** Default cap of simultaneously simulating filler bodies (the rest of a big blast retires / freezes / queues). */
export const MAX_ACTIVE_FILLER = 64;
/** Back-compat names (constants at their default values). */
export const FILLER_SHOT_IMPULSE_PER_DAMAGE = FILLER_TUNING.impulsePerDamage;
export const MAX_FILLER_DV = FILLER_TUNING.maxDv;
export const SPLASH_RADIUS = FILLER_TUNING.splashRadius;
const MAX_SPIN = 36;
const MAX_SPEED = 13;
const BOUNCE_MAX = 2, BOUNCE_MIN_SPEED = 1.2;
/** Seconds of calm before a body is retired to its rest pose. */
const RETIRE_SLEEP = 0.4;
/** Resting pieces woken per frame by moving bodies (knock-on), walkers and lifted loot lots. */
const KNOCK_BUDGET = 18;
const CELL = 0.5;
const FILLER_MASK = GROUP_STATIC | GROUP_ITEM | GROUP_CHUNK;

/** Collider / mass / sound of a piece (from its archetype). */
export interface FillerSpec {
  shape: 'box' | 'cylinder' | 'sphere';
  /** Half extents of the collider (cylinder: x = z = radius; sphere: all = radius). */
  half: [number, number, number];
  mass: number;
  mat: PhysMat;
  fam: ImpactFamily;
}

export type FillerState = 'rest' | 'awake' | 'frozen';

export interface FillerPiece {
  readonly id: number;
  readonly spec: FillerSpec;
  /** Pose of the collider centre (world): the rest pose while asleep, the body pose while moving. */
  readonly p: THREE.Vector3;
  readonly q: THREE.Quaternion;
  /** Where the dressing put it (displacement stats). */
  readonly home: THREE.Vector3;
  /** Stocked holder index (world/shelfStock.ts). */
  readonly holder: number;
  /** Pieces resting on this one (stack copies / leaning copies) — they lose support when it moves. */
  readonly above: number[];
  /** Hung on a hook (key blanks): until first moved, only a shot / splash or a fast body knocks it off (a falling neighbour just brushes past). */
  readonly hung?: boolean;
  state: FillerState;
  body: CANNON.Body | null;
  /** Ever woken (knocked / shot / kicked). */
  moved: boolean;
  /** World AABB at rest (hash / overlap tests). */
  readonly box: THREE.Box3;
}

/** Render side (world/shelfStock.ts): the piece left / returned to the merged rest mesh; per-frame pose sync. */
export interface FillerView {
  wake(p: FillerPiece): void;
  rest(p: FillerPiece): void;
  frame(moving: readonly FillerPiece[]): void;
}

/** The host: the station's PhysicsSystem (bounded world, statics, contact materials, audio, item bodies). */
export interface FillerHost extends BodyHost {
  addSource(s: BodySource): void;
  readonly dynamicItems: {walkers: (() => readonly Walker[]) | null; liftLots: ((box: THREE.Box3) => PickupLike[]) | null; wakePickup?(p: PickupLike): boolean};
}

export interface FillerHit { piece: FillerPiece; t: number; point: THREE.Vector3; normal: THREE.Vector3 }

interface Internal {
  serial: number;
  t: number;
  sleepT: number;
  soundT: number;
  pending: {v: CANNON.Vec3; w: CANNON.Vec3} | null;
  lastGood: {p: THREE.Vector3; q: THREE.Quaternion};
  cells: number[];
  /** Clock time the piece last came to rest (knock-on cooldown: a settling pile does not re-wake itself). */
  restedAt: number;
  /** Shot / splashed until this clock time: rebounds off boards (see BOUNCE_*). */
  energized: number;
  bounces: number;
  /** Rebound queued by a contact this step: unit normal from the board to the piece, impact speed. */
  bounce: {nx: number; ny: number; nz: number; speed: number} | null;
}

/** Deterministic hash noise in [0, 1) (rebound / splash spray: same shot, same result). */
function noise(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Static rest proxies kept at once (a retired piece something still moving may land on). */
const MAX_PROXIES = 96;
/** A piece that just came to rest is only re-woken by a neighbour faster than this for KNOCK_COOLDOWN s. */
const KNOCK_COOLDOWN = 0.8;
const KNOCK_SPEED = 0.4, KNOCK_SPEED_FRESH = 1.1;
/** A piece still hanging on its hook is knocked off only by a body at least this fast (m/s). */
const KNOCK_SPEED_HUNG = 4;
/** Speed cap (m/s) of a blank shot / splashed off its hook. */
const HOOK_MAX_DV = 3.5;
const onHook = (p: FillerPiece) => !!p.hung && !p.moved;
/** Pellet catch margin (m) round a hung blank (the board / hook beside it shakes it off). */
const HOOK_CATCH = 0.018;
const catchSpecs = new WeakMap<FillerSpec, FillerSpec>();
function hookCatch(s: FillerSpec): FillerSpec {
  let c = catchSpecs.get(s);
  if (!c) catchSpecs.set(s, (c = {...s, half: [s.half[0] + HOOK_CATCH, s.half[1] + HOOK_CATCH, s.half[2]]}));
  return c;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tm = new THREE.Matrix4(), tb = new THREE.Box3();
const cv = new CANNON.Vec3(), cv2 = new CANNON.Vec3();
const AXES: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

/** World AABB of an oriented collider. */
export function colliderBox(spec: FillerSpec, p: THREE.Vector3, q: THREE.Quaternion, out = new THREE.Box3()): THREE.Box3 {
  if (spec.shape === 'sphere') {
    const r = spec.half[0];
    out.min.set(p.x - r, p.y - r, p.z - r);
    out.max.set(p.x + r, p.y + r, p.z + r);
    return out;
  }
  const m = tm.makeRotationFromQuaternion(q).elements;
  const [hx, hy, hz] = spec.half;
  const ex = Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz;
  const ey = Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz;
  const ez = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz;
  out.min.set(p.x - ex, p.y - ey, p.z - ez);
  out.max.set(p.x + ex, p.y + ey, p.z + ez);
  return out;
}

/**
 * Exact ray test against a piece's collider in its own frame: box (slab test) or upright cylinder
 * (side + caps). Returns the ray parameter and the local hit normal, or null.
 */
export function rayCollider(spec: FillerSpec, p: THREE.Vector3, q: THREE.Quaternion, o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, maxT: number): {t: number; n: THREE.Vector3} | null {
  if (spec.shape === 'sphere') {
    const r = spec.half[0], ox = o.x - p.x, oy = o.y - p.y, oz = o.z - p.z;
    const a = d.x * d.x + d.y * d.y + d.z * d.z, b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r;
    if (c <= 0) return {t: 0, n: new THREE.Vector3(-d.x, -d.y, -d.z)}; // inside
    const disc = b * b - a * c;
    if (disc < 0 || a < 1e-12) return null;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > maxT) return null;
    return {t, n: new THREE.Vector3(ox + d.x * t, oy + d.y * t, oz + d.z * t).divideScalar(r)};
  }
  const iq = tq.copy(q).invert();
  const lo = tv.set(o.x - p.x, o.y - p.y, o.z - p.z).applyQuaternion(iq);
  const ld = tv2.set(d.x, d.y, d.z).applyQuaternion(iq);
  const [hx, hy, hz] = spec.half;
  if (spec.shape === 'box') {
    let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
    const H = [hx, hy, hz];
    for (let a = 0; a < 3; a++) {
      const O = lo[AXES[a]], D = ld[AXES[a]];
      if (Math.abs(D) < 1e-12) { if (O < -H[a] || O > H[a]) return null; continue; }
      let t1 = (-H[a] - O) / D, t2 = (H[a] - O) / D, s = -1;
      if (t1 > t2) { const k = t1; t1 = t2; t2 = k; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (tmax < 0 || tmin > maxT) return null;
    const t = Math.max(0, tmin);
    const n = new THREE.Vector3();
    if (axis >= 0) n.setComponent(axis, sign);
    return {t, n: n.applyQuaternion(q)};
  }
  // upright cylinder radius hx, half height hy
  const r = hx;
  let best = Infinity;
  const n = new THREE.Vector3();
  const a = ld.x * ld.x + ld.z * ld.z, b = 2 * (lo.x * ld.x + lo.z * ld.z), c = lo.x * lo.x + lo.z * lo.z - r * r;
  if (a > 1e-12) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t < best && Math.abs(lo.y + ld.y * t) <= hy) { best = t; n.set(lo.x + ld.x * t, 0, lo.z + ld.z * t).normalize(); }
    }
  }
  if (Math.abs(ld.y) > 1e-12) {
    for (const s of [1, -1]) {
      const t = (s * hy - lo.y) / ld.y;
      if (t < 0 || t >= best) continue;
      const x = lo.x + ld.x * t, z = lo.z + ld.z * t;
      if (x * x + z * z <= r * r) { best = t; n.set(0, s, 0); }
    }
  }
  if (c <= 0 && Math.abs(lo.y) <= hy) return {t: 0, n: new THREE.Vector3(-d.x, -d.y, -d.z)}; // inside
  if (!(best <= maxT)) return null;
  return {t: best, n: n.applyQuaternion(q)};
}

export class FillerStock implements BodySource {
  pieces: FillerPiece[] = [];
  private host: FillerHost | null = null;
  private view: FillerView | null = null;
  private readonly int = new Map<number, Internal>();
  private readonly hash = new Map<number, number[]>();
  private readonly active = new Set<FillerPiece>();
  private readonly frozenSet = new Set<FillerPiece>();
  /** Resting pieces keeping a STATIC body (something still moving may land on / lean against them). */
  private readonly proxies = new Set<FillerPiece>();
  private clock = 0;
  /** Static shelf boards / backs (world AABBs) for the swept anti-tunnelling test, hashed by cell. */
  private boards: THREE.Box3[] = [];
  private readonly boardHash = new Map<number, number[]>();
  private serial = 0;
  private world: CANNON.World | null = null;
  private readonly onPostStep = () => this.postStep();
  private readonly lastWalker = new WeakMap<object, {x: number; z: number}>();
  private soundTokens = 6;
  private soundClock = 0;
  /** Counters (QA / tests). */
  readonly counts = {woken: 0, shots: 0, splashed: 0, bounced: 0, knockOn: 0, supportLoss: 0, retired: 0, frozen: 0, reactivated: 0, clamped: 0, swept: 0, kicks: 0, lotsLifted: 0, sounds: 0, restored: 0, foreign: 0};

  /** Register with the station physics (once per game; the world itself is rebuilt per station). */
  attach(host: FillerHost): void {
    if (this.host === host) return;
    this.host = host;
    host.addSource(this);
  }

  /**
   * New station stock: pieces at their dressed rest poses, the stocked holders' static boards (world
   * AABBs) and the render view. Replaces any previous set (no duplication on re-init).
   */
  setPieces(pieces: FillerPiece[], boards: THREE.Box3[], view: FillerView | null): void {
    this.clear();
    this.pieces = pieces;
    this.view = view;
    for (const p of pieces) {
      this.int.set(p.id, {serial: 0, t: 0, sleepT: 0, soundT: 0, pending: null, lastGood: {p: p.p.clone(), q: p.q.clone()}, cells: [], restedAt: -Infinity, energized: -Infinity, bounces: 0, bounce: null});
      colliderBox(p.spec, p.p, p.q, p.box);
      this.index(p);
    }
    this.boards = boards;
    boards.forEach((b, i) => {
      for (const k of this.cellsOf(b, 0.05)) { let l = this.boardHash.get(k); if (!l) this.boardHash.set(k, (l = [])); l.push(i); }
    });
  }

  // ---------------------------------------------------------------------------------------
  // BodySource

  get awake(): number {
    return this.active.size;
  }
  activePoints(out: CANNON.Vec3[]): void {
    for (const p of this.active) if (p.body) out.push(p.body.position);
  }
  clear(): void {
    const w = this.host?.world ?? this.world;
    for (const p of [...this.active, ...this.proxies]) if (p.body) { w?.removeBody(p.body); p.body = null; }
    this.active.clear();
    this.frozenSet.clear();
    this.proxies.clear();
    this.hash.clear();
    this.boardHash.clear();
    this.int.clear();
    this.pieces = [];
    this.boards = [];
    if (this.world) this.world.removeEventListener('postStep', this.onPostStep);
    this.world = null;
  }

  /** Pieces simulating or frozen in mid-motion (render follows them). */
  moving(): FillerPiece[] {
    return [...this.active, ...this.frozenSet];
  }

  // ---------------------------------------------------------------------------------------
  // Spatial hash

  private key(cx: number, cz: number): number {
    return (cz + 32768) * 65536 + (cx + 32768);
  }
  private cellsOf(b: THREE.Box3, pad = 0): number[] {
    const out: number[] = [];
    const x0 = Math.floor((b.min.x - pad) / CELL), x1 = Math.floor((b.max.x + pad) / CELL), z0 = Math.floor((b.min.z - pad) / CELL), z1 = Math.floor((b.max.z + pad) / CELL);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(this.key(x, z));
    return out;
  }
  private index(p: FillerPiece): void {
    const I = this.int.get(p.id)!;
    I.cells = this.cellsOf(p.box);
    for (const k of I.cells) { let l = this.hash.get(k); if (!l) this.hash.set(k, (l = [])); l.push(p.id); }
  }
  private unindex(p: FillerPiece): void {
    const I = this.int.get(p.id)!;
    for (const k of I.cells) {
      const l = this.hash.get(k);
      if (!l) continue;
      const i = l.indexOf(p.id);
      if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
    }
    I.cells = [];
  }
  /** Resting pieces whose AABB intersects `box`. */
  restingIn(box: THREE.Box3, out: FillerPiece[] = []): FillerPiece[] {
    const seen = new Set<number>();
    for (const k of this.cellsOf(box)) {
      const l = this.hash.get(k);
      if (!l) continue;
      for (const id of l) {
        if (seen.has(id)) continue;
        seen.add(id);
        const p = this.pieces[id];
        if (p.state === 'rest' && p.box.intersectsBox(box)) out.push(p);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // Ray tests

  /**
   * Nearest piece (resting, moving or frozen) a ray hits before maxT: exact test against each
   * candidate's own collider. Walks the hash cells the ray's XZ projection crosses.
   */
  rayHit(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, maxT: number, exclude?: ReadonlySet<FillerPiece>): FillerHit | null {
    let best: {p: FillerPiece; t: number; n: THREE.Vector3} | null = null;
    const test = (p: FillerPiece) => {
      if (exclude?.has(p)) return;
      // a blank still on its hook is also knocked off by a pellet striking the board / hook right beside it
      const h = rayCollider(onHook(p) ? hookCatch(p.spec) : p.spec, p.p, p.q, o, d, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = {p, t: h.t, n: h.n.clone()};
    };
    for (const p of this.active) test(p);
    for (const p of this.frozenSet) test(p);
    const seen = new Set<number>();
    const hl = Math.hypot(d.x, d.z);
    let cx = Math.floor(o.x / CELL), cz = Math.floor(o.z / CELL);
    const visit = (x: number, z: number) => {
      // a ray grazing a cell corner can miss a neighbour the piece overlaps: test the 3 x 3 around each cell
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const l = this.hash.get(this.key(x + dx, z + dz));
        if (!l) continue;
        for (const id of l) { if (seen.has(id)) continue; seen.add(id); const p = this.pieces[id]; if (p.state === 'rest') test(p); }
      }
    };
    if (hl < 1e-6) { visit(cx, cz); }
    else {
      const ux = d.x / hl, uz = d.z / hl;
      const sx = ux > 0 ? 1 : -1, sz = uz > 0 ? 1 : -1;
      const dX = ux !== 0 ? Math.abs(CELL / ux) : Infinity, dZ = uz !== 0 ? Math.abs(CELL / uz) : Infinity;
      let mX = ux !== 0 ? ((ux > 0 ? (cx + 1) * CELL - o.x : o.x - cx * CELL) / Math.abs(ux)) : Infinity;
      let mZ = uz !== 0 ? ((uz > 0 ? (cz + 1) * CELL - o.z : o.z - cz * CELL) / Math.abs(uz)) : Infinity;
      const maxH = maxT * hl + CELL;
      for (let guard = 0; guard < 4096; guard++) {
        visit(cx, cz);
        const bt = best as {t: number} | null;
        const reach = Math.min(mX, mZ);
        if (reach > maxH || (bt && reach > (bt.t * hl) + CELL * 1.5)) break;
        if (mX < mZ) { mX += dX; cx += sx; } else { mZ += dZ; cz += sz; }
      }
    }
    if (!best) return null;
    const b = best as {p: FillerPiece; t: number; n: THREE.Vector3};
    return {piece: b.p, t: b.t, point: new THREE.Vector3(o.x + d.x * b.t, o.y + d.y * b.t, o.z + d.z * b.t), normal: b.n};
  }

  // ---------------------------------------------------------------------------------------
  // Waking / shooting

  /**
   * Applies a shot: wakes the piece (and whatever rests on it) and applies `impulse` (N.s) AT the hit
   * point. Direction: the pellet's travel blended with the contact normal at the hit (a pellet
   * grazing a can's side shoves it sideways as well as back), plus lift; capped per piece
   * (FILLER_TUNING.maxDv, spin). Resting neighbours on the same board jostle too (FILLER_TUNING splash;
   * `splash` false: none, e.g. tests of a single hit).
   */
  shoot(p: FillerPiece, point: THREE.Vector3, dir: THREE.Vector3, impulse: number, normal?: THREE.Vector3, o: {lift?: number; splash?: boolean} = {}): boolean {
    const hooked = onHook(p);
    const b = this.wake(p);
    if (!b) return false;
    this.counts.shots++;
    const dn = tv.copy(dir).normalize();
    if (normal && normal.lengthSq() > 1e-8) dn.multiplyScalar(0.6).addScaledVector(tv2.copy(normal).normalize(), -0.4).normalize();
    // a blank shot off its hook flips off the board and drops (it does not ricochet round the key wall)
    this.push(p, b, dn, impulse, o.lift ?? FILLER_TUNING.lift, point, hooked ? HOOK_MAX_DV : FILLER_TUNING.maxDv);
    if (o.splash !== false) this.splash(p, point, dir, impulse);
    this.host?.bodiesChanged();
    return true;
  }

  /** Impulse `j` along unit `dn` + lift at `point` (clamped to the piece), capped at `maxDv` m/s; arms the board rebound. */
  private push(p: FillerPiece, b: CANNON.Body, dn: THREE.Vector3, j: number, lift: number, point: THREE.Vector3, maxDv = FILLER_TUNING.maxDv): void {
    cv.set(dn.x * j, dn.y * j + j * lift, dn.z * j);
    const jl = cv.length();
    if (jl / p.spec.mass > maxDv) cv.scale(p.spec.mass * maxDv / jl, cv);
    cv2.set(point.x - b.position.x, point.y - b.position.y, point.z - b.position.z);
    const reach = Math.max(...p.spec.half) * 1.05;
    if (cv2.length() > reach) cv2.scale(reach / cv2.length(), cv2);
    b.applyImpulse(cv, cv2);
    this.clampBody(b);
    b.wakeUp();
    const I = this.int.get(p.id)!;
    I.energized = this.clock + FILLER_TUNING.bounceWindow;
    I.bounces = 0;
  }

  /**
   * A pellet's local splash: resting pieces of the same holder standing on the same deck height as the
   * hit piece, within splashRadius of the impact, get splashShare of its push falling off with distance,
   * directed away from the impact (and along the pellet), at a point offset toward the impact so they
   * tumble. Pieces on another board / holder never move (no blast through boards or shelves).
   */
  private splash(hit: FillerPiece, point: THREE.Vector3, dir: THREE.Vector3, impulse: number): void {
    const T = FILLER_TUNING, R = T.splashRadius, base = hit.box.min.y;
    const box = tb.set(new THREE.Vector3(point.x - R, base - 0.04, point.z - R), new THREE.Vector3(point.x + R, base + 0.6, point.z + R));
    const near = this.restingIn(box).filter(n => n !== hit && n.holder === hit.holder && Math.abs(n.box.min.y - base) < 0.035);
    const sx = dir.x, sz = dir.z, sl = Math.hypot(sx, sz) || 1;
    for (const n of near) {
      const dx = n.p.x - point.x, dz = n.p.z - point.z, d = Math.hypot(dx, dz);
      if (d > R) continue;
      // hung blanks: only the others on the same hook jump off with it
      if (onHook(n) && Math.hypot(n.p.x - hit.p.x, n.p.z - hit.p.z) > 0.03) continue;
      const k = (1 - d / R) ** 1.5;
      if (k < T.splashMinK) continue;
      const cap = onHook(n) ? Math.min(T.splashMaxDv, HOOK_MAX_DV) : T.splashMaxDv;
      const b = this.wake(n, 'splash');
      if (!b) continue;
      // away from the impact (horizontally) blended with the pellet's travel
      const ox = d > 1e-4 ? dx / d : sx / sl, oz = d > 1e-4 ? dz / d : sz / sl;
      const dn = tv.set(ox * T.splashOut + (sx / sl) * T.splashAlong, 0, oz * T.splashOut + (sz / sl) * T.splashAlong).normalize();
      // hit low on the side facing the impact: it tips and tumbles
      const at = tv2.set(n.p.x - ox * n.spec.half[0] * 0.8, n.p.y - n.spec.half[1] * 0.35, n.p.z - oz * n.spec.half[2] * 0.8);
      this.push(n, b, dn, impulse * T.splashShare * k, T.splashLift * (0.8 + 0.4 * noise(n.id, this.counts.shots)), at, cap);
      this.counts.splashed++;
    }
  }

  /** Start simulating a piece (no-op if it already is). */
  wake(p: FillerPiece, why: 'shot' | 'knock' | 'support' | 'kick' | 'foreign' | 'resume' | 'splash' = 'shot'): CANNON.Body | null {
    const w = this.host?.world;
    if (!w) return null;
    if (p.state === 'awake' && p.body) { p.body.wakeUp(); return p.body; }
    this.ensureWorld(w);
    this.makeRoom();
    const I = this.int.get(p.id)!;
    const wasFrozen = p.state === 'frozen';
    if (p.state === 'rest') this.unindex(p);
    this.frozenSet.delete(p);
    let body = p.body;
    if (body && this.proxies.has(p)) {
      // a static rest proxy becomes dynamic again where it lies
      this.proxies.delete(p);
      body.type = CANNON.Body.DYNAMIC;
      body.mass = p.spec.mass;
      body.updateMassProperties();
      body.velocity.setZero(); body.angularVelocity.setZero();
      body.wakeUp();
    } else {
      body = this.makeBody(p);
      w.addBody(body);
    }
    p.body = body;
    p.state = 'awake';
    p.moved = true;
    this.active.add(p);
    I.serial = ++this.serial;
    I.t = 0;
    I.sleepT = 0;
    if (wasFrozen && I.pending) { body.velocity.copy(I.pending.v); body.angularVelocity.copy(I.pending.w); I.pending = null; this.counts.reactivated++; }
    this.counts.woken++;
    if (why === 'knock') this.counts.knockOn++;
    else if (why === 'support') this.counts.supportLoss++;
    else if (why === 'foreign') this.counts.foreign++;
    if (!wasFrozen) this.view?.wake(p);
    // whatever rests on it loses its support (dressed stacks, and anything that settled on it later);
    // the dressed relation is spent once it moves
    this.wakeSupported(p);
    p.above.length = 0;
    return body;
  }

  private wakeSupported(p: FillerPiece): void {
    const list = new Set<FillerPiece>();
    for (const id of p.above) { const a = this.pieces[id]; if (a && a.state === 'rest') list.add(a); }
    const top = p.box.max.y;
    const probe = new THREE.Box3(new THREE.Vector3(p.box.min.x + 0.004, top - 0.004, p.box.min.z + 0.004), new THREE.Vector3(p.box.max.x - 0.004, top + 0.02, p.box.max.z - 0.004));
    for (const a of this.restingIn(probe)) if (a !== p && a.box.min.y > top - 0.012) list.add(a);
    for (const a of list) this.wake(a, 'support');
  }

  private makeBody(p: FillerPiece): CANNON.Body {
    const s = p.spec;
    const body = new CANNON.Body({
      // round fruit: strong spin damping stands in for rolling resistance (cannon has none) — it rolls a little and stops
      mass: s.mass, material: this.host!.material(s.mat), linearDamping: s.shape === 'sphere' ? 0.4 : 0.1, angularDamping: s.shape === 'cylinder' ? 0.55 : s.shape === 'sphere' ? 0.9 : 0.38,
      collisionFilterGroup: GROUP_ITEM, collisionFilterMask: FILLER_MASK, allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.4,
    });
    const [hx, hy, hz] = s.half;
    if (s.shape === 'cylinder') body.addShape(new CANNON.Cylinder(hx, hx, hy * 2, 8));
    else if (s.shape === 'sphere') body.addShape(new CANNON.Sphere(hx));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.003, hx), Math.max(0.003, hy), Math.max(0.003, hz))));
    body.position.set(p.p.x, p.p.y, p.p.z);
    body.quaternion.set(p.q.x, p.q.y, p.q.z, p.q.w);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.previousQuaternion.copy(body.quaternion);
    body.interpolatedQuaternion.copy(body.quaternion);
    body.aabbNeedsUpdate = true;
    tagFillerBody(body);
    const I = this.int.get(p.id)!;
    body.addEventListener('collide', (ev: {body: CANNON.Body; contact: CANNON.ContactEquation}) => {
      // a freshly shot piece hitting a board / back panel side-on rebounds (applied after the step)
      if (this.clock < I.energized && I.bounces < BOUNCE_MAX && ev.body?.type === CANNON.Body.STATIC) {
        const c = ev.contact, sgn = c.bi === body ? -1 : 1;
        const nx = c.ni.x * sgn, ny = c.ni.y * sgn, nz = c.ni.z * sgn;
        const speed = Math.abs(c.getImpactVelocityAlongNormal());
        if (Math.abs(ny) < 0.6 && speed > BOUNCE_MIN_SPEED && (!I.bounce || speed > I.bounce.speed)) I.bounce = {nx, ny, nz, speed};
      }
      if (I.soundT > 0) return;
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (v < 0.7) return;
      I.soundT = 0.15;
      if (this.soundTokens < 1) return;
      this.soundTokens -= 1;
      this.counts.sounds++;
      this.host?.audio?.physImpact?.(body.position.x, body.position.y, body.position.z, v, s.fam, undefined, 'stock');
    });
    return body;
  }

  /** Room for one more simulating body: retire the oldest nearly-at-rest one, else freeze the oldest. */
  private makeRoom(): void {
    while (this.active.size >= FILLER_TUNING.maxActive) {
      let oldest: FillerPiece | null = null, calm: FillerPiece | null = null;
      for (const p of this.active) {
        const I = this.int.get(p.id)!;
        if (!oldest || I.serial < this.int.get(oldest.id)!.serial) oldest = p;
        const b = p.body!;
        if (b.velocity.length() + b.angularVelocity.length() * 0.05 < 0.35 && (!calm || I.serial < this.int.get(calm.id)!.serial)) calm = p;
      }
      if (calm) this.retire(calm);
      else if (oldest) this.freeze(oldest);
      else break;
    }
  }

  private freeze(p: FillerPiece): void {
    const b = p.body!;
    const I = this.int.get(p.id)!;
    this.syncPose(p, false);
    I.pending = {v: b.velocity.clone(), w: b.angularVelocity.clone()};
    this.host?.world?.removeBody(b);
    p.body = null;
    p.state = 'frozen';
    this.active.delete(p);
    this.frozenSet.add(p);
    this.counts.frozen++;
  }

  /**
   * Stop simulating: the piece rests at its current pose (persisting) and rejoins the merged rest
   * mesh. While something still moves next to it, it keeps a STATIC body (a rest proxy) so a piece
   * settling on it does not sink through; proxies are dropped once their neighbourhood is calm.
   */
  private retire(p: FillerPiece): void {
    const b = p.body;
    this.active.delete(p);
    this.frozenSet.delete(p);
    if (b) this.syncPose(p, false);
    colliderBox(p.spec, p.p, p.q, p.box);
    if (b && b.type === CANNON.Body.DYNAMIC && this.busyAround(p) && this.proxies.size < MAX_PROXIES) {
      b.velocity.setZero(); b.angularVelocity.setZero();
      b.type = CANNON.Body.STATIC;
      b.mass = 0;
      b.updateMassProperties();
      b.aabbNeedsUpdate = true;
      this.proxies.add(p);
    } else {
      if (b) this.host?.world?.removeBody(b);
      p.body = null;
    }
    p.state = 'rest';
    const I = this.int.get(p.id)!;
    I.pending = null;
    I.restedAt = this.clock;
    this.index(p);
    this.counts.retired++;
    this.view?.rest(p);
  }

  /** Whether a simulating piece is within a few cm of p (it may come to rest on / against it). */
  private busyAround(p: FillerPiece): boolean {
    const box = tb.copy(p.box).expandByScalar(0.03);
    for (const a of this.active) {
      if (a === p || !a.body) continue;
      if (a.body.aabbNeedsUpdate) a.body.updateAABB();
      const lb = a.body.aabb.lowerBound, ub = a.body.aabb.upperBound;
      if (ub.x < box.min.x || lb.x > box.max.x || ub.y < box.min.y || lb.y > box.max.y || ub.z < box.min.z || lb.z > box.max.z) continue;
      return true;
    }
    return false;
  }

  private syncPose(p: FillerPiece, interp: boolean): void {
    const b = p.body;
    if (!b) return;
    const P = interp ? b.interpolatedPosition : b.position, Q = interp ? b.interpolatedQuaternion : b.quaternion;
    (p.p as THREE.Vector3).set(P.x, P.y, P.z);
    (p.q as THREE.Quaternion).set(Q.x, Q.y, Q.z, Q.w);
  }

  private clampBody(b: CANNON.Body): void {
    const v = b.velocity.length();
    if (v > MAX_SPEED) b.velocity.scale(MAX_SPEED / v, b.velocity);
    const w = b.angularVelocity.length();
    if (w > MAX_SPIN) b.angularVelocity.scale(MAX_SPIN / w, b.angularVelocity);
  }

  private ensureWorld(w: CANNON.World): void {
    if (this.world === w) return;
    if (this.world) this.world.removeEventListener('postStep', this.onPostStep);
    this.world = w;
    w.addEventListener('postStep', this.onPostStep);
    // package vs package: a little bounce and less grip than the world default (no restitution), so a
    // hit row scatters instead of dying in a dead pile
    // (task food-shelf-production, lane SHELF: + the modelled ruined props' wooden fruit crate and cloth rags / sacks)
    const mats = [...new Set(['metal', 'plastic', 'soft', 'glass', 'wood', 'cloth'] as PhysMat[])];
    for (let i = 0; i < mats.length; i++) for (let j = i; j < mats.length; j++) {
      const a = PHYS_MATS[mats[i]], b = PHYS_MATS[mats[j]];
      w.addContactMaterial(new CANNON.ContactMaterial(this.host!.material(mats[i]), this.host!.material(mats[j]), {
        friction: Math.sqrt(a.friction * b.friction) * 0.85, restitution: Math.max(a.restitution, b.restitution) * 0.75, contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
      }));
    }
  }

  /**
   * After every fixed step: a fast small body whose step segment crossed a thin shelf board / back
   * (entered its box from outside) is put back at the entry face with its velocity into it removed.
   */
  private postStep(): void {
    // rebounds queued by this step's board contacts: leave the board at >= bounceE of the impact speed, with a spray
    for (const p of this.active) {
      const I = this.int.get(p.id)!, b = p.body, q = I.bounce;
      if (!b || !q) continue;
      I.bounce = null;
      const vn = b.velocity.x * q.nx + b.velocity.y * q.ny + b.velocity.z * q.nz, want = FILLER_TUNING.bounceE * q.speed;
      if (vn >= want) continue;
      // lateral = horizontal direction along the board face
      let lx = -q.nz, lz = q.nx;
      const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
      const side = (noise(p.id, I.bounces + 17) - 0.5) * 1.1 * want, upk = (0.3 + 0.4 * noise(p.id, I.bounces + 29)) * want;
      b.velocity.set(b.velocity.x + q.nx * (want - vn) + lx * side, b.velocity.y + q.ny * (want - vn) + upk, b.velocity.z + q.nz * (want - vn) + lz * side);
      b.angularVelocity.set(b.angularVelocity.x + (noise(p.id, 41) - 0.5) * 8, b.angularVelocity.y + (noise(p.id, 43) - 0.5) * 8, b.angularVelocity.z + (noise(p.id, 47) - 0.5) * 8);
      this.clampBody(b);
      I.bounces++;
      this.counts.bounced++;
    }
    for (const p of this.active) {
      const b = p.body;
      if (!b) continue;
      const a = b.previousPosition, c = b.position;
      const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      const r = Math.min(...p.spec.half);
      if (len < r * 0.8) continue;
      const seg = new THREE.Box3(new THREE.Vector3(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.min(a.z, c.z)), new THREE.Vector3(Math.max(a.x, c.x), Math.max(a.y, c.y), Math.max(a.z, c.z)));
      const seen = new Set<number>();
      // the FIRST board the step segment enters (boards can be stacked: a pegboard on a back panel)
      let hitT = Infinity, hitAxis = -1;
      for (const k of this.cellsOf(seg, r)) {
        for (const i of this.boardHash.get(k) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const B = this.boards[i];
          // previous centre outside the board box expanded by r, segment entering it
          const lo = [B.min.x - r, B.min.y - r, B.min.z - r], hi = [B.max.x + r, B.max.y + r, B.max.z + r];
          const A = [a.x, a.y, a.z], D = [dx, dy, dz];
          if (A[0] > lo[0] && A[0] < hi[0] && A[1] > lo[1] && A[1] < hi[1] && A[2] > lo[2] && A[2] < hi[2]) continue;
          let tmin = 0, tmax = 1, axis = -1;
          let ok = true;
          for (let k2 = 0; k2 < 3; k2++) {
            if (Math.abs(D[k2]) < 1e-9) { if (A[k2] <= lo[k2] || A[k2] >= hi[k2]) { ok = false; break; } continue; }
            let t1 = (lo[k2] - A[k2]) / D[k2], t2 = (hi[k2] - A[k2]) / D[k2];
            if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
            if (t1 > tmin) { tmin = t1; axis = k2; }
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) { ok = false; break; }
          }
          if (!ok || axis < 0 || tmin >= 1) continue;
          // the body would end past the board's far face (a real tunnel), not merely resting in contact
          const farIn = c.x > B.min.x && c.x < B.max.x && c.y > B.min.y && c.y < B.max.y && c.z > B.min.z && c.z < B.max.z;
          const crossed = (axis === 0 && (Math.sign(c.x - (B.min.x + B.max.x) / 2) !== Math.sign(a.x - (B.min.x + B.max.x) / 2)))
            || (axis === 1 && (Math.sign(c.y - (B.min.y + B.max.y) / 2) !== Math.sign(a.y - (B.min.y + B.max.y) / 2)))
            || (axis === 2 && (Math.sign(c.z - (B.min.z + B.max.z) / 2) !== Math.sign(a.z - (B.min.z + B.max.z) / 2)));
          if (!farIn && !crossed) continue;
          if (tmin < hitT) { hitT = tmin; hitAxis = axis; }
        }
      }
      if (hitAxis < 0) continue;
      const t = Math.max(0, hitT - 1e-3 / Math.max(len, 1e-6));
      b.position.set(a.x + dx * t, a.y + dy * t, a.z + dz * t);
      const vel = [b.velocity.x, b.velocity.y, b.velocity.z];
      vel[hitAxis] = -vel[hitAxis] * 0.2;
      b.velocity.set(vel[0], vel[1], vel[2]);
      b.aabbNeedsUpdate = true;
      this.counts.swept++;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Per frame (after the world step)

  update(dt: number): void {
    if (!this.pieces.length) return;
    this.clock += dt;
    this.soundClock += dt;
    this.soundTokens = Math.min(6, this.soundTokens + dt * 14);
    const statics = this.host?.statics ?? null;
    for (const p of [...this.active]) {
      const b = p.body!;
      const I = this.int.get(p.id)!;
      I.t += dt;
      I.soundT = Math.max(0, I.soundT - dt);
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z + b.quaternion.w)) {
        // solver blew up: back to its last good pose, at rest (never lost)
        p.p.copy(I.lastGood.p); p.q.copy(I.lastGood.q);
        this.host?.world?.removeBody(b);
        p.body = null;
        this.counts.restored++;
        this.retire(p);
        continue;
      }
      if (groundClamp(b, statics)) this.counts.clamped++;
      this.clampBody(b);
      // fell out of the station (below every floor / outside the grid): restore its last good pose
      const g = statics?.cellGround(b.position.x, b.position.z, b.position.y);
      if (g === Infinity || (g !== undefined && b.position.y < g - 1.5)) {
        b.position.set(I.lastGood.p.x, I.lastGood.p.y, I.lastGood.p.z);
        b.velocity.setZero(); b.angularVelocity.setZero();
        this.counts.restored++;
      } else if (b.sleepState !== CANNON.Body.SLEEPING) {
        I.lastGood.p.set(b.position.x, b.position.y, b.position.z);
        I.lastGood.q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      }
      this.syncPose(p, true);
      I.sleepT = restTime(b, Math.max(...p.spec.half), I.sleepT, dt);
      const slow = b.velocity.length() < 0.25 && b.angularVelocity.length() < 2.5;
      if (I.sleepT > RETIRE_SLEEP || (I.t > 5 && slow) || I.t > 12) this.retire(p);
    }
    // rest proxies whose neighbourhood went calm drop their static body
    for (const p of [...this.proxies]) {
      if (this.busyAround(p)) continue;
      this.proxies.delete(p);
      if (p.body) this.host?.world?.removeBody(p.body);
      p.body = null;
    }
    // frozen-while-moving pieces resume when there is room
    if (this.frozenSet.size && this.active.size < FILLER_TUNING.maxActive) {
      const waiting = [...this.frozenSet].sort((a, b) => this.int.get(a.id)!.serial - this.int.get(b.id)!.serial).slice(0, FILLER_TUNING.maxActive - this.active.size);
      for (const p of waiting) this.wake(p, 'resume');
    }
    this.knockOn();
    this.walkerKicks(dt);
    this.view?.frame(this.moving());
  }

  /** Moving bodies (filler and foreign: items, light props, chunks) wake the resting pieces they are about to touch. */
  private knockOn(): void {
    let budget = KNOCK_BUDGET;
    const box = new THREE.Box3();
    const swept = (b: CANNON.Body) => {
      if (b.aabbNeedsUpdate) b.updateAABB();
      const vx = b.velocity.x * 0.034, vy = b.velocity.y * 0.034, vz = b.velocity.z * 0.034;
      box.min.set(b.aabb.lowerBound.x + Math.min(0, vx), b.aabb.lowerBound.y + Math.min(0, vy), b.aabb.lowerBound.z + Math.min(0, vz)).subScalar(0.005);
      box.max.set(b.aabb.upperBound.x + Math.max(0, vx), b.aabb.upperBound.y + Math.max(0, vy), b.aabb.upperBound.z + Math.max(0, vz)).addScalar(0.005);
      return box;
    };
    for (const p of [...this.active]) {
      if (budget <= 0) break;
      const b = p.body;
      const sp = b ? b.velocity.length() : 0;
      if (!b) continue;
      if (sp < KNOCK_SPEED) {
        // slow: only a resting piece it already overlaps (a body without a collider would let it sink in) gets its body back
        if (b.aabbNeedsUpdate) b.updateAABB();
        box.min.set(b.aabb.lowerBound.x, b.aabb.lowerBound.y, b.aabb.lowerBound.z).addScalar(0.004);
        box.max.set(b.aabb.upperBound.x, b.aabb.upperBound.y, b.aabb.upperBound.z).subScalar(0.004);
        for (const n of this.restingIn(box)) {
          if (budget <= 0) break;
          if (!n.body && !onHook(n) && this.wake(n, 'knock')) budget--;
        }
        continue;
      }
      swept(b);
      for (const n of this.restingIn(box)) {
        if (budget <= 0) break;
        // a piece that just settled is only knocked again by a clearly moving neighbour (no pile churn)
        if (sp < KNOCK_SPEED_FRESH && this.clock - this.int.get(n.id)!.restedAt < KNOCK_COOLDOWN) continue;
        if (sp < KNOCK_SPEED_HUNG && onHook(n)) continue;
        if (this.wake(n, 'knock')) budget--;
      }
      // a real loot lot in its way is lifted off its holder (same item / count) and starts moving too
      const di = this.host?.dynamicItems;
      if (di?.liftLots && budget > 0) {
        for (const pk of di.liftLots(box)) { di.wakePickup?.(pk); this.counts.lotsLifted++; budget--; }
      }
    }
    // foreign bodies: loose loot items, light props, chunks
    const w = this.host?.world;
    // (the world only has moving bodies while something is simulating: skip the scan when idle)
    if (!w || budget <= 0 || !this.pieces.length || !w.hasActiveBodies) return;
    for (const b of w.bodies) {
      if (budget <= 0) break;
      if (b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING || (b as {fillerPiece?: boolean}).fillerPiece) continue;
      const fs = b.velocity.length();
      if (fs < KNOCK_SPEED) continue;
      swept(b);
      for (const n of this.restingIn(box)) {
        if (budget <= 0) break;
        if (fs < KNOCK_SPEED_HUNG && onHook(n)) continue;
        if (this.wake(n, 'foreign')) budget--;
      }
    }
  }

  /** Walkers kick displaced pieces lying at their feet (no player collision with filler: walkways stay clear). */
  private walkerKicks(dt: number): void {
    const list = this.host?.dynamicItems.walkers?.();
    if (!list || !list.length || dt <= 0) return;
    let budget = 4;
    const box = new THREE.Box3();
    for (const a of list) {
      const last = this.lastWalker.get(a.id);
      this.lastWalker.set(a.id, {x: a.x, z: a.z});
      if (!last) continue;
      const vx = (a.x - last.x) / dt, vz = (a.z - last.z) / dt, sp = Math.hypot(vx, vz);
      if (sp < 0.5 || sp > 12) continue;
      box.min.set(a.x - a.r - 0.04, a.y - 0.05, a.z - a.r - 0.04);
      box.max.set(a.x + a.r + 0.04, a.y + 0.45, a.z + a.r + 0.04);
      for (const p of this.restingIn(box)) {
        if (budget <= 0) return;
        if (!p.moved) continue; // stock still on its shelf is never kicked
        const dx = p.p.x - a.x, dz = p.p.z - a.z;
        if ((dx * vx + dz * vz) < 0) continue; // only what the walker moves into
        const b = this.wake(p, 'kick');
        if (!b) continue;
        const j = p.spec.mass * Math.min(4, sp * 1.1);
        cv.set(vx / sp * j, j * 0.35, vz / sp * j);
        cv2.set(0, -p.spec.half[1] * 0.5, 0);
        b.applyImpulse(cv, cv2);
        this.clampBody(b);
        this.counts.kicks++;
        budget--;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // QA

  stats(): {pieces: number; resting: number; awake: number; frozen: number; proxies: number; moved: number; max: number; counts: Record<string, number>} {
    let moved = 0;
    for (const p of this.pieces) if (p.moved) moved++;
    return {pieces: this.pieces.length, resting: this.pieces.length - this.active.size - this.frozenSet.size, awake: this.active.size, frozen: this.frozenSet.size, proxies: this.proxies.size, moved, max: FILLER_TUNING.maxActive, counts: {...this.counts}};
  }

  /** Displacement since load: count of pieces off their dressed spot (> 2 cm), max distance, pieces below their floor / outside the station. */
  displacement(statics: {cellGround(x: number, z: number, y?: number): number} | null): {displaced: number; maxDisplacement: number; belowFloor: number; outside: number; moved: number} {
    let displaced = 0, maxD = 0, below = 0, outside = 0, moved = 0;
    for (const p of this.pieces) {
      if (p.moved) moved++;
      const dd = p.p.distanceTo(p.home);
      if (dd > 0.02) displaced++;
      if (dd > maxD) maxD = dd;
      if (!statics) continue;
      const g = statics.cellGround(p.p.x, p.p.z, p.p.y);
      if (!Number.isFinite(g)) outside++;
      else if (p.box.min.y < g - 0.03 && p.p.y < g) below++;
    }
    return {displaced, maxDisplacement: Math.round(maxD * 1000) / 1000, belowFloor: below, outside, moved};
  }
}

/** Marks a cannon body as a filler piece (foreign-body scans skip our own). */
export function tagFillerBody(b: CANNON.Body): void {
  (b as {fillerPiece?: boolean}).fillerPiece = true;
}
