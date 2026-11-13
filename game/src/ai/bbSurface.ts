// Task studio-bb-production-20261112-234540-01: BB's SURFACE LOCOMOTION — crawling on floors, walls and ceilings of the level's real
// collision geometry. Pure (no three.js): everything is decided by rays against a CrawlWorld, so it runs in Node on a generated level.
//
// THE MODEL. A clinging body is a contact point ON a surface, that surface's unit normal and a unit heading in the surface's plane
// (Cling). The level's structure is axis-aligned (walls on the cell grid, flat floors and ceilings), so a normal is always one of
// the six axis directions. One step (crawlStep) moves the contact point along the heading and keeps it on valid geometry:
//  - a FORWARD probe at body-centre height finds what is ahead: a facing structural surface is an INNER corner (floor -> wall,
//    wall -> ceiling, ceiling -> a soffit's face ...): the body turns onto it; a prop is an obstacle (blocked);
//  - a SURFACE probe under the advanced position confirms the surface is still there; where it ends there is an OUTER corner
//    (the lower edge of a door lintel, the top of a low wall, a slab edge): an EDGE probe finds the side face and the body wraps
//    onto it; nothing to wrap onto = blocked;
//  - every new position must have its body centre in free space and no higher than the climb limit above the floor below.
// So the body can never pass through a wall, a slab or a prop: it only ever moves through space a ray has just crossed, or turns
// onto a surface a ray has just found. A corner is returned as the cling AFTER it; the brain blends the body round it over a
// moment (no jump).
//
// The leap (flightStep) is a ballistic body centre swept by a ray each step: it stops at whatever it meets.

import {raycastWorld} from '../combat/hitscan';
import {levelsOf, type Band, type Levels} from '../gen/levels';
import type {PropPlacement} from '../gen/props';

export interface Vec3 { x: number; y: number; z: number }

export interface CrawlHit {
  /** Distance along the (unit) ray. */
  t: number;
  kind: 'wall' | 'floor' | 'ceiling' | 'prop' | 'none';
  nx: number; ny: number; nz: number;
}

/** What the surface locomotion needs from a level: solid geometry by ray, the free band at a point, a standable floor. */
export interface CrawlWorld {
  /** First solid hit of a ray (d unit) within `max`: the level's structure (walls, floors, ceilings, slab edges) and solid props. */
  ray(o: Vec3, d: Vec3, max: number): CrawlHit;
  /** The free vertical band holding a point (its floor / ceiling heights), or null inside solid or outside the map. */
  band(x: number, y: number, z: number): {floor: number; ceil: number} | null;
  /**
   * The height of a walkable floor a body of radius r can stand on at (x, z) with its feet within 0.4 m of y, clear of the level's
   * walls and edges; else null. Props are NOT part of this test (they are solid to `ray`): a caller that must not end inside one
   * checks its way there with rays.
   */
  stand(x: number, y: number, z: number, r: number): number | null;
  /** Sight between two points: the level's 3D line of sight (walls, slabs, shutters and sight-blocking props). Absent: a clear `ray`. */
  sight?(a: Vec3, b: Vec3): boolean;
}

/** The CrawlWorld of a real level: the Levels' 3D raycast with the layout's solid props (the bullet line), its bands and nav cells. */
export function levelsCrawlWorld(L: Levels, props: readonly PropPlacement[], trenchY: number): CrawlWorld {
  const bands: Band[] = [];
  return {
    ray: (o, d, max) => raycastWorld(L, props, o, d, max, trenchY),
    band(x, y, z) {
      L.bands(x, z, bands);
      for (const b of bands) if (y >= b.floor - 1e-3 && y <= b.ceil + 1e-3) return {floor: b.floor, ceil: b.ceil};
      return null;
    },
    stand(x, y, z, r) {
      const s = L.supportIn(x, z, y + 0.05, 0.4);
      if (!s || Math.abs(s.floor - y) > 0.4) return null;
      return L.circleClear(x, z, r, s.floor) ? s.floor : null;
    },
    sight: (a, b) => L.lineOfSight(a, b),
  };
}

/**
 * A level with nothing in it but one endless floor at `floorY` (no walls, no ceiling). The brain's stand-in where the caller gives
 * no CrawlWorld (hand-built test worlds): there is nothing to climb, and a leap lands on the floor.
 */
export function flatCrawlWorld(floorY: number): CrawlWorld {
  return {
    ray(o, d, max) {
      if (d.y < -1e-9) {
        const t = (o.y - floorY) / -d.y;
        if (t >= 0 && t <= max) return {t, kind: 'floor', nx: 0, ny: 1, nz: 0};
      }
      return {t: max, kind: 'none', nx: 0, ny: 0, nz: 0};
    },
    band: (_x, y) => (y >= floorY - 1e-3 ? {floor: floorY, ceil: Infinity} : null),
    stand: (_x, y) => (Math.abs(y - floorY) <= 0.4 ? floorY : null),
  };
}

/** Convenience for tests / QA: the CrawlWorld of a generated layout. */
export function layoutCrawlWorld(layout: Parameters<typeof levelsOf>[0] & {props: readonly PropPlacement[]; trench: {floorY: number}}): CrawlWorld {
  return levelsCrawlWorld(levelsOf(layout), layout.props, layout.trench.floorY);
}

/** A clinging body: contact point on the surface, the surface's unit normal, a unit heading in the surface's plane. */
export interface Cling {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  hx: number; hy: number; hz: number;
}

export type ClingKind = 'floor' | 'wall' | 'ceiling';
export function clingKind(c: {ny: number}): ClingKind {
  return c.ny > 0.7 ? 'floor' : c.ny < -0.7 ? 'ceiling' : 'wall';
}

/** Body and probe geometry (m). This module is a leaf: ai/bb.ts builds its body / climb numbers from these. */
export const CRAWL = {
  /** Body centre above its surface. */
  lift: 0.2,
  /** The crawling body's collider radius. */
  radius: 0.22,
  /** The body centre is never higher than this above the floor of the space it is in. */
  maxHeightM: 4.6,
  /** The body's reach ahead of its centre: the forward probe stops it this far from what is ahead. */
  reach: 0.27,
  /** How far below its expected place the surface may be and still count as the same surface. */
  tol: 0.14,
  /** Edge probe: depth behind the surface plane at which the side face of an outer corner is looked for. */
  edgeDepth: 0.1,
  /** Longest single step (m): longer moves are split. */
  maxStep: 0.1,
  /** A surface ahead is a corner to turn onto when the heading points into it at least this much (cos of the angle to its normal); shallower = slide along it. */
  cornerCos: 0.5,
  /** An edge is wrapped when the heading crosses it at least this squarely (cos of the angle to the side face's normal). */
  edgeCos: 0.3,
} as const;

export interface ClimbLimits {
  /** The body centre may be at most this high above the floor of its band. */
  maxHeightM: number;
}
export const CLIMB_LIMITS: ClimbLimits = {maxHeightM: CRAWL.maxHeightM};

export function clingCentre(c: Cling, out: Vec3 = {x: 0, y: 0, z: 0}): Vec3 {
  out.x = c.x + c.nx * CRAWL.lift; out.y = c.y + c.ny * CRAWL.lift; out.z = c.z + c.nz * CRAWL.lift;
  return out;
}

const structural = (k: CrawlHit['kind']): boolean => k === 'wall' || k === 'floor' || k === 'ceiling';

/** The body centre at a cling is in free space and within the climb limit. */
export function centreValid(w: CrawlWorld, c: Cling, lim: ClimbLimits = CLIMB_LIMITS): boolean {
  const x = c.x + c.nx * CRAWL.lift, y = c.y + c.ny * CRAWL.lift, z = c.z + c.nz * CRAWL.lift;
  const b = w.band(x, y, z);
  return !!b && y - b.floor <= lim.maxHeightM + 1e-6;
}

/** The surface under a cling is still there: a structural hit under the body centre within the tolerance, facing it. */
export function anchorValid(w: CrawlWorld, c: Cling): boolean {
  const h = w.ray({x: c.x + c.nx * CRAWL.lift, y: c.y + c.ny * CRAWL.lift, z: c.z + c.nz * CRAWL.lift}, {x: -c.nx, y: -c.ny, z: -c.nz}, CRAWL.lift + CRAWL.tol);
  return structural(h.kind) && h.nx * c.nx + h.ny * c.ny + h.nz * c.nz > 0.7;
}

/**
 * Turn the heading toward a wanted direction (any 3D vector: its projection into the surface's plane is what counts), by at most
 * `maxTurn` radians. A wanted direction along the normal (nothing in the plane) leaves the heading as it is.
 */
export function steerCling(c: Cling, dx: number, dy: number, dz: number, maxTurn: number): void {
  const dn = dx * c.nx + dy * c.ny + dz * c.nz;
  let tx = dx - dn * c.nx, ty = dy - dn * c.ny, tz = dz - dn * c.nz;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-4) return;
  tx /= tl; ty /= tl; tz /= tl;
  const cos = Math.max(-1, Math.min(1, c.hx * tx + c.hy * ty + c.hz * tz));
  // signed angle about the normal: (h x t) . n
  const cxn = (c.hy * tz - c.hz * ty) * c.nx + (c.hz * tx - c.hx * tz) * c.ny + (c.hx * ty - c.hy * tx) * c.nz;
  let a = Math.atan2(cxn, cos);
  if (Math.abs(a) <= maxTurn) { c.hx = tx; c.hy = ty; c.hz = tz; return; }
  a = Math.sign(a) * maxTurn;
  // rotate h about n by a: h cos a + (n x h) sin a
  const s = Math.sin(a), k = Math.cos(a);
  const rx = c.ny * c.hz - c.nz * c.hy, ry = c.nz * c.hx - c.nx * c.hz, rz = c.nx * c.hy - c.ny * c.hx;
  const hx = c.hx * k + rx * s, hy = c.hy * k + ry * s, hz = c.hz * k + rz * s;
  const hl = Math.hypot(hx, hy, hz) || 1;
  c.hx = hx / hl; c.hy = hy / hl; c.hz = hz / hl;
}

export type CrawlEvent = 'none' | 'inner' | 'outer' | 'blocked';
export interface CrawlStepOut {
  /** Distance actually moved along the surface (m): `c` was advanced by it. */
  moved: number;
  event: CrawlEvent;
  /** 'inner' / 'outer': the cling after the corner (c stands at the corner; the caller blends to this and adopts it). */
  next?: Cling;
  /** 'blocked': what stopped it. */
  by?: 'prop' | 'solid' | 'edge' | 'height';
}

/** One short step (dist <= CRAWL.maxStep) of `c` along its heading. Mutates `c` by the distance moved on its own surface. */
function stepOnce(w: CrawlWorld, c: Cling, dist: number, lim: ClimbLimits): CrawlStepOut {
  const L = CRAWL.lift, R = CRAWL.reach;
  const cx = c.x + c.nx * L, cy = c.y + c.ny * L, cz = c.z + c.nz * L;
  const h = {x: c.hx, y: c.hy, z: c.hz};
  // 1. what is ahead of the body
  const fh = w.ray({x: cx, y: cy, z: cz}, h, dist + R);
  let step = dist;
  let corner: CrawlHit | null = null;
  if (fh.kind !== 'none') {
    step = Math.min(dist, Math.max(0, fh.t - R));
    if (fh.t - R <= dist) corner = fh;
  }
  // 2. the surface under the advanced position
  let moved = 0;
  if (step > 1e-5) {
    const ax = c.x + c.hx * step, ay = c.y + c.hy * step, az = c.z + c.hz * step;
    const sh = w.ray({x: ax + c.nx * L, y: ay + c.ny * L, z: az + c.nz * L}, {x: -c.nx, y: -c.ny, z: -c.nz}, L + CRAWL.tol);
    if (sh.kind === 'prop') return {moved: 0, event: 'blocked', by: 'prop'};
    if (sh.kind === 'none') return outerCorner(w, c, step, lim);
    if (sh.nx * c.nx + sh.ny * c.ny + sh.nz * c.nz < 0.7) return {moved: 0, event: 'blocked', by: 'solid'};
    // snap onto the surface (a ramp or a small level change under the body)
    const k = L - sh.t;
    const nx_ = ax + c.nx * k, ny_ = ay + c.ny * k, nz_ = az + c.nz * k;
    const b = w.band(nx_ + c.nx * L, ny_ + c.ny * L, nz_ + c.nz * L);
    if (!b) return {moved: 0, event: 'blocked', by: 'solid'};
    if (ny_ + c.ny * L - b.floor > lim.maxHeightM + 1e-6) return {moved: 0, event: 'blocked', by: 'height'};
    c.x = nx_; c.y = ny_; c.z = nz_;
    moved = step;
  }
  if (!corner) return {moved, event: 'none'};
  // 3. the body has reached what is ahead
  if (!structural(corner.kind)) return {moved, event: 'blocked', by: 'prop'};
  const facing = corner.nx * c.hx + corner.ny * c.hy + corner.nz * c.hz;
  const perp = Math.abs(corner.nx * c.nx + corner.ny * c.ny + corner.nz * c.nz);
  if (perp > 0.3 || facing >= 0) return {moved, event: 'blocked', by: 'solid'};
  if (facing > -CRAWL.cornerCos) {
    // a GRAZING contact (the heading runs along that surface more than into it): no corner — slide along it, keeping the body
    // centre a body-lift clear of it
    let sx = c.hx - facing * corner.nx, sy = c.hy - facing * corner.ny, sz = c.hz - facing * corner.nz;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const gap = corner.t * -facing; // perpendicular distance of the body centre from it (before this step's move)
    if (gap < L) {
      const k = L - gap, q: Cling = {...c, x: c.x + corner.nx * k, y: c.y + corner.ny * k, z: c.z + corner.nz * k};
      if (centreValid(w, q, lim) && anchorValid(w, q)) { c.x = q.x; c.y = q.y; c.z = q.z; }
    }
    c.hx = sx; c.hy = sy; c.hz = sz;
    return {moved, event: 'none'};
  }
  // INNER corner: turn onto the facing surface. The heading's part into the corner becomes "away from the old surface" (the old
  // normal), its part along the corner line is kept.
  const m = corner;
  const ncx = c.x + c.nx * L, ncy = c.y + c.ny * L, ncz = c.z + c.nz * L;
  const t2 = w.ray({x: ncx, y: ncy, z: ncz}, h, R + CRAWL.maxStep + 0.05);
  if (!structural(t2.kind)) return {moved, event: 'blocked', by: 'solid'};
  const lx = c.ny * m.nz - c.nz * m.ny, ly = c.nz * m.nx - c.nx * m.nz, lz = c.nx * m.ny - c.ny * m.nx; // the corner line
  const into = -(c.hx * m.nx + c.hy * m.ny + c.hz * m.nz), along = c.hx * lx + c.hy * ly + c.hz * lz;
  let hx = into * c.nx + along * lx, hy = into * c.ny + along * ly, hz = into * c.nz + along * lz;
  const hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-4) { hx = c.nx; hy = c.ny; hz = c.nz; } else { hx /= hl; hy /= hl; hz /= hl; }
  const next: Cling = {x: ncx + c.hx * t2.t, y: ncy + c.hy * t2.t, z: ncz + c.hz * t2.t, nx: m.nx, ny: m.ny, nz: m.nz, hx, hy, hz};
  if (!centreValid(w, next, lim)) return {moved, event: 'blocked', by: w.band(next.x + next.nx * L, next.y + next.ny * L, next.z + next.nz * L) ? 'height' : 'solid'};
  if (!anchorValid(w, next)) return {moved, event: 'blocked', by: 'solid'};
  return {moved, event: 'inner', next};
}

/** The surface ends within `step` ahead: find the edge and the side face round it (an OUTER corner), or report the edge as a dead end. */
function outerCorner(w: CrawlWorld, c: Cling, step: number, lim: ClimbLimits): CrawlStepOut {
  const L = CRAWL.lift, D = CRAWL.edgeDepth;
  // from just behind the surface plane, beyond the edge, back along the heading: the side face
  const ox = c.x + c.hx * step - c.nx * D, oy = c.y + c.hy * step - c.ny * D, oz = c.z + c.hz * step - c.nz * D;
  const eh = w.ray({x: ox, y: oy, z: oz}, {x: -c.hx, y: -c.hy, z: -c.hz}, step + CRAWL.reach);
  if (!structural(eh.kind)) return {moved: 0, event: 'blocked', by: eh.kind === 'prop' ? 'prop' : 'edge'};
  const out = eh.nx * c.hx + eh.ny * c.hy + eh.nz * c.hz;
  if (out < CRAWL.edgeCos || Math.abs(eh.nx * c.nx + eh.ny * c.ny + eh.nz * c.nz) > 0.3) return {moved: 0, event: 'blocked', by: 'edge'};
  // the edge, on the old surface's plane, where the heading crosses it
  const de = Math.max(0, step - eh.t);
  const ex = c.x + c.hx * de, ey = c.y + c.hy * de, ez = c.z + c.hz * de;
  // the body on the side face, one body-lift below the edge: the heading's part across the edge becomes "away from the old
  // surface", its part along the edge is kept
  const lx = c.ny * eh.nz - c.nz * eh.ny, ly = c.nz * eh.nx - c.nx * eh.nz, lz = c.nx * eh.ny - c.ny * eh.nx; // the edge line
  const along = c.hx * lx + c.hy * ly + c.hz * lz;
  let hx = -out * c.nx + along * lx, hy = -out * c.ny + along * ly, hz = -out * c.nz + along * lz;
  const hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl; hy /= hl; hz /= hl;
  const next: Cling = {x: ex - c.nx * L, y: ey - c.ny * L, z: ez - c.nz * L, nx: eh.nx, ny: eh.ny, nz: eh.nz, hx, hy, hz};
  if (!centreValid(w, next, lim)) return {moved: 0, event: 'blocked', by: w.band(next.x + next.nx * L, next.y + next.ny * L, next.z + next.nz * L) ? 'height' : 'edge'};
  if (!anchorValid(w, next)) return {moved: 0, event: 'blocked', by: 'edge'};
  // the way round must be open: from the old body centre out over the edge, then down beside the face
  const c0 = {x: ex + c.nx * L, y: ey + c.ny * L, z: ez + c.nz * L};
  const over = w.ray(c0, {x: eh.nx, y: eh.ny, z: eh.nz}, L + 0.02);
  if (over.kind !== 'none') return {moved: 0, event: 'blocked', by: over.kind === 'prop' ? 'prop' : 'solid'};
  const down = w.ray({x: c0.x + eh.nx * L, y: c0.y + eh.ny * L, z: c0.z + eh.nz * L}, {x: -c.nx, y: -c.ny, z: -c.nz}, 2 * L);
  if (down.kind !== 'none' && down.t < 2 * L - 0.02) return {moved: 0, event: 'blocked', by: down.kind === 'prop' ? 'prop' : 'solid'};
  c.x = ex; c.y = ey; c.z = ez;
  return {moved: de, event: 'outer', next};
}

/**
 * Crawl `dist` metres along the heading. `c` is advanced on its own surface; the result reports a corner reached (with the cling
 * after it) or what blocked the way. The distance moved never exceeds `dist`.
 */
export function crawlStep(w: CrawlWorld, c: Cling, dist: number, lim: ClimbLimits = CLIMB_LIMITS): CrawlStepOut {
  let left = dist, moved = 0;
  for (let guard = 0; guard < 64 && left > 1e-6; guard++) {
    const d = Math.min(left, CRAWL.maxStep);
    const r = stepOnce(w, c, d, lim);
    moved += r.moved;
    if (r.event !== 'none') return {...r, moved};
    if (r.moved <= 1e-6) break;
    left -= d;
  }
  return {moved, event: 'none'};
}

/**
 * Mount a wall from the floor: from a body standing at (x, floor y, z), look along the horizontal unit direction (dx, dz) at
 * body-centre height. A structural wall within `reach` gives the cling on it at centre height, heading up; else null.
 */
export function mountWall(w: CrawlWorld, x: number, y: number, z: number, dx: number, dz: number, reach: number, lim: ClimbLimits = CLIMB_LIMITS): Cling | null {
  const L = CRAWL.lift;
  const h = w.ray({x, y: y + L, z}, {x: dx, y: 0, z: dz}, reach);
  if (h.kind !== 'wall' || Math.abs(h.ny) > 0.3) return null;
  const c: Cling = {x: x + dx * h.t, y: y + L, z: z + dz * h.t, nx: h.nx, ny: 0, nz: h.nz, hx: 0, hy: 1, hz: 0};
  return centreValid(w, c, lim) && anchorValid(w, c) ? c : null;
}

export interface MountSpot {
  /** Where to stand on the floor in front of the wall (m), and the wall's outward normal there. */
  x: number; z: number;
  nx: number; nz: number;
  /** Distance from the asking body to that spot. */
  dist: number;
  /** How far up the wall is climbable from the floor (m; sampled up to `needUp`). */
  up: number;
}

/**
 * Walls within `reach` of a body on the floor that it could climb: `rays` horizontal probes at body-centre height; a hit wall counts
 * when the same wall plane is still there `needUp` m higher (not a kerb, a counter front or a low parapet) and the stand spot in
 * front of it is a clear floor. Nearest first.
 */
export function findMounts(w: CrawlWorld, x: number, y: number, z: number, reach: number, needUp = 1.4, rays = 12, r: number = CRAWL.radius): MountSpot[] {
  const out: MountSpot[] = [], L = CRAWL.lift;
  for (let k = 0; k < rays; k++) {
    const a = k / rays * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    const h = w.ray({x, y: y + L, z}, {x: dx, y: 0, z: dz}, reach);
    if (h.kind !== 'wall' || Math.abs(h.ny) > 0.3) continue;
    const wx = x + dx * h.t, wz = z + dz * h.t;
    // the wall continues upward: probe it from just in front, at rising heights
    let up = 0;
    for (const dy of [0.5, 1.0, needUp]) {
      const ph = w.ray({x: wx + h.nx * L, y: y + L + dy, z: wz + h.nz * L}, {x: -h.nx, y: 0, z: -h.nz}, L + CRAWL.tol);
      if (ph.kind !== 'wall' || ph.nx * h.nx + ph.nz * h.nz < 0.7) break;
      // and the way up in front of it is open
      const vh = w.ray({x: wx + h.nx * L, y: y + L, z: wz + h.nz * L}, {x: 0, y: 1, z: 0}, dy);
      if (vh.kind !== 'none') break;
      up = dy;
    }
    if (up < needUp) continue;
    const sx = wx + h.nx * (r + 0.06), sz = wz + h.nz * (r + 0.06);
    if (w.stand(sx, y, sz, r) === null) continue;
    if (out.some(m => Math.hypot(m.x - sx, m.z - sz) < 0.4)) continue;
    out.push({x: sx, z: sz, nx: h.nx, nz: h.nz, dist: Math.hypot(sx - x, sz - z), up});
  }
  return out.sort((p, q) => p.dist - q.dist);
}

// ----------------------------------------------------------------------------------------------------------------------------
// The leap

export interface Flight {
  /** Body centre and velocity (m, m/s). */
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

/**
 * The launch velocity that carries a body from `from` to `to` (body centres) under `gravity`, at about `speed` m/s horizontally;
 * the flight time is clamped to [minT, maxT] (a short hop still takes minT; a long or steep one at most maxT).
 */
export function launchVelocity(from: Vec3, to: Vec3, speed: number, gravity: number, minT = 0.2, maxT = 0.65): {vx: number; vy: number; vz: number; T: number} {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const T = Math.max(minT, Math.min(maxT, Math.hypot(dx, dz) / Math.max(speed, 1e-3)));
  return {vx: dx / T, vy: dy / T + 0.5 * gravity * T, vz: dz / T, T};
}

/** The straight pieces of a ballistic arc are all clear of solid geometry (`r`: the swept body's margin, m). */
export function arcClear(w: CrawlWorld, from: Vec3, v: {vx: number; vy: number; vz: number}, gravity: number, T: number, r = 0.14, pieces = 5): boolean {
  let px = from.x, py = from.y, pz = from.z;
  for (let k = 1; k <= pieces; k++) {
    const t = T * k / pieces;
    const qx = from.x + v.vx * t, qy = from.y + v.vy * t - 0.5 * gravity * t * t, qz = from.z + v.vz * t;
    const dx = qx - px, dy = qy - py, dz = qz - pz, d = Math.hypot(dx, dy, dz);
    if (d > 1e-6) {
      // the last piece ends at the target (a body): do not ask for margin beyond it
      const h = w.ray({x: px, y: py, z: pz}, {x: dx / d, y: dy / d, z: dz / d}, d + (k < pieces ? r : 0));
      if (h.kind !== 'none') return false;
    }
    px = qx; py = qy; pz = qz;
  }
  return true;
}

export interface FlightHit {
  kind: CrawlHit['kind'];
  nx: number; ny: number; nz: number;
  /** The contact point on the surface. */
  x: number; y: number; z: number;
}

/**
 * Advance a flying body by dt under gravity, swept by a ray along its motion: it stops `r` short of the first solid thing it meets
 * (returned), else moves freely (null). The velocity is left as it was at the contact: the caller decides what the contact does.
 */
export function flightStep(w: CrawlWorld, f: Flight, dt: number, gravity: number, r = 0.14): FlightHit | null {
  f.vy -= gravity * dt;
  const dx = f.vx * dt, dy = f.vy * dt, dz = f.vz * dt, d = Math.hypot(dx, dy, dz);
  if (d < 1e-7) return null;
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const h = w.ray({x: f.x, y: f.y, z: f.z}, {x: ux, y: uy, z: uz}, d + r);
  if (h.kind === 'none') { f.x += dx; f.y += dy; f.z += dz; return null; }
  const go = Math.max(0, h.t - r);
  f.x += ux * go; f.y += uy * go; f.z += uz * go;
  return {kind: h.kind, nx: h.nx, ny: h.ny, nz: h.nz, x: f.x + ux * (h.t - go), y: f.y + uy * (h.t - go), z: f.z + uz * (h.t - go)};
}

const DIAG = Math.SQRT1_2;
const SIDES: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [DIAG, DIAG], [DIAG, -DIAG], [-DIAG, DIAG], [-DIAG, -DIAG]];

/**
 * Keep a flying body's CENTRE `clear` m from the walls and prop sides beside it (`flightStep` sweeps the centre along its motion
 * only, so an arc can pass a wall as near as you like, and then come down where the body does not fit). Eight level probes: the
 * centre is pushed off what they meet (never into anything else). It keeps its velocity: held off a face it slides along it, and
 * goes on once it is past the face's end (a corner it grazes, a beam it passes under). True when something was near.
 */
export function flightClear(w: CrawlWorld, f: Flight, clear: number): boolean {
  let xp = 0, xn = 0, zp = 0, zn = 0, any = false;
  for (const [ux, uz] of SIDES) {
    const h = w.ray({x: f.x, y: f.y, z: f.z}, {x: ux, y: 0, z: uz}, clear);
    if (h.kind === 'none' || Math.abs(h.ny) > 0.7) continue;
    // how far the centre is inside the clearance of that face, along the face's own (level) normal
    const nl = Math.hypot(h.nx, h.nz);
    if (nl < 1e-6) continue;
    const nx = h.nx / nl, nz = h.nz / nl, push = clear - h.t * Math.abs(ux * nx + uz * nz);
    if (push <= 0) continue;
    any = true;
    if (nx > 0.5) xp = Math.max(xp, push * nx); else if (nx < -0.5) xn = Math.max(xn, -push * nx);
    if (nz > 0.5) zp = Math.max(zp, push * nz); else if (nz < -0.5) zn = Math.max(zn, -push * nz);
  }
  if (!any) return false;
  // each axis on its own: off the nearer face by what is missing — and where another face stands opposite it nearer than that
  // leaves room for (a slot narrower than the body), to the middle between the two and no further
  const ease = (push: number, near: number, ux: number, uz: number): number => {
    if (push <= 1e-6) return 0;
    const h = w.ray({x: f.x, y: f.y, z: f.z}, {x: ux, y: 0, z: uz}, push + clear);
    return h.kind === 'none' ? push : Math.max(0, Math.min(push, (h.t - near) / 2));
  };
  f.x += xp >= xn ? ease(xp - xn, clear - xp, 1, 0) : -ease(xn - xp, clear - xn, -1, 0);
  f.z += zp >= zn ? ease(zp - zn, clear - zp, 0, 1) : -ease(zn - zp, clear - zn, 0, -1);
  return true;
}

/** The floor straight below a point within `max` m: its height when the ray meets a level floor (not a prop top), else null. */
export function floorBelow(w: CrawlWorld, x: number, y: number, z: number, max: number): number | null {
  const h = w.ray({x, y, z}, {x: 0, y: -1, z: 0}, max);
  return h.kind === 'floor' ? y - h.t : null;
}
