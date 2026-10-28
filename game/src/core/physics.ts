// Circle-vs-world collision on the XZ plane: grid walls, ledges and exact prop AABBs.
//
// Iteration 05 (Lane T): height-aware when the body's feet height is given — a walkable cell
// (floor or track bed) blocks only if its floor (at the point nearest the body) is more than
// STEP_UP above the feet: you can walk off the platform edge into the track bed and up/down stair
// ramps, but not walk up the platform face. Without `feet` the iteration-04 2D rule applies
// (only FLOOR cells are passable), which keeps hand-built test grids and old callers unchanged.
//
// Iteration 08 (Lane B): every function also takes the multi-level `Levels` (gen/levels.ts) in
// place of the grid. Then a column blocks a body unless some level's band there takes it: floor
// within STEP_UP of the feet AND ceiling leaving the body's clear height (slab edges, risers, low
// soffits and lintels block; stepping down / walking off an unrailed edge does not); railings block
// bodies at about their deck height; ceilings come from the band the feet are in. A plain Grid
// keeps the exact iteration-05 rules.

import {CELL, SOLID, STEP_UP, Grid} from '../gen/grid';
import {BODY_CLEAR, Levels, RAIL_H, RAIL_HALF} from '../gen/levels';
import type {PropPlacement} from '../gen/props';

/** What collision runs against: one grid (legacy rules) or the stacked levels. */
export type CollisionWorld = Grid | Levels;

/** Body height used to decide whether a prop box is at the body's level (m). */
const BODY_H = 1.9;
/** Gravity for walking bodies (zombies; the player has its own tuned value). */
export const BODY_GRAVITY = 17;
/** Feet stay glued to a floor that drops by at most this per frame (stairs, ramps). */
export const SNAP_DOWN = 0.4;

export class PropIndex {
  private readonly buckets = new Map<number, number[]>();
  private readonly grid: Grid;
  constructor(world: CollisionWorld, readonly props: PropPlacement[]) {
    const L = world instanceof Levels ? world : null;
    const grid = (this.grid = L ? L.main : (world as Grid));
    props.forEach((p, i) => {
      // stacked items rest on another prop (iteration 08: the floor of the prop's own storey)
      const floor = L ? L.supportAt(p.x, p.z, p.y, 0.05)?.floor ?? grid.floorAt(p.x, p.z) : grid.floorAt(p.x, p.z);
      if (p.y > floor + 0.05) return;
      const x0 = Math.floor((p.x - p.hx) / CELL), x1 = Math.floor((p.x + p.hx) / CELL);
      const y0 = Math.floor((p.z - p.hz) / CELL), y1 = Math.floor((p.z + p.hz) / CELL);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const k = grid.idx(x, y);
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push(i);
      }
    });
  }
  near(x0: number, z0: number, x1: number, z1: number, out: Set<number>): Set<number> {
    out.clear();
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cy0 = Math.floor(z0 / CELL), cy1 = Math.floor(z1 / CELL);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const b = this.buckets.get(this.grid.idx(x, y));
      if (b) for (const i of b) out.add(i);
    }
    return out;
  }
}

const scratch = new Set<number>();

function pushOutOfBox(px: number, pz: number, r: number, bx0: number, bz0: number, bx1: number, bz1: number): [number, number] | null {
  const cx = Math.max(bx0, Math.min(px, bx1));
  const cz = Math.max(bz0, Math.min(pz, bz1));
  let dx = px - cx, dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    return [dx / d * (r - d), dz / d * (r - d)];
  }
  // Center inside the box: push out along the shallowest axis.
  const l = px - bx0, rr = bx1 - px, t = pz - bz0, b = bz1 - pz;
  const m = Math.min(l, rr, t, b);
  if (m === l) return [-(l + r), 0];
  if (m === rr) return [rr + r, 0];
  if (m === t) return [0, -(t + r)];
  return [0, b + r];
}

/** Whether grid cell (cx, cy) blocks a body centred at (x, z) whose feet are at `feet`. */
export function cellBlocks(grid: Grid, cx: number, cy: number, x: number, z: number, feet?: number): boolean {
  if (feet === undefined) return grid.impassable(cx, cy);
  if (!grid.inBounds(cx, cy)) return true;
  const c = grid.cells[grid.idx(cx, cy)];
  if (c === SOLID) return true;
  return grid.floorNear(cx, cy, x, z) > feet + STEP_UP;
}

/**
 * Resolve a circle against walls, ledges and props. Returns the corrected position. `height`: the
 * body's clear height (stacked levels only; default BODY_CLEAR — the player passes its stance).
 */
export function resolveCircle(world: CollisionWorld, props: PropIndex | null, x: number, z: number, r: number, feet?: number, height = BODY_CLEAR): [number, number] {
  if (world instanceof Levels && feet !== undefined) return resolveLevels(world, props, x, z, r, feet, height);
  const grid = world instanceof Levels ? world.main : world;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((z - r) / CELL), y1 = Math.floor((z + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!cellBlocks(grid, cx, cy, x, z, feet)) continue;
        const p = pushOutOfBox(x, z, r, cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL);
        if (p) { x += p[0]; z += p[1]; moved = true; }
      }
    }
    if (props) {
      for (const i of props.near(x - r, z - r, x + r, z + r, scratch)) {
        const pr = props.props[i];
        if (feet !== undefined && (pr.y + pr.h <= feet + 0.02 || pr.y >= feet + BODY_H)) continue;
        const p = pushOutOfBox(x, z, r, pr.x - pr.hx, pr.z - pr.hz, pr.x + pr.hx, pr.z + pr.hz);
        if (p) { x += p[0]; z += p[1]; moved = true; }
      }
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Level-aware resolve: band columns, railings at the body's deck height, props by vertical overlap. */
function resolveLevels(L: Levels, props: PropIndex | null, x: number, z: number, r: number, feet: number, height: number): [number, number] {
  const g0 = L.main;
  const railed = L.rails.length > 0;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((z - r) / CELL), y1 = Math.floor((z + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!L.blocksAt(cx, cy, x, z, feet, height)) continue;
        const p = pushOutOfBox(x, z, r, cx * CELL, cy * CELL, (cx + 1) * CELL, (cy + 1) * CELL);
        if (p) { x += p[0]; z += p[1]; moved = true; }
      }
    }
    if (railed) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (!g0.inBounds(cx, cy)) continue;
          const list = L.railsAt(cy * g0.w + cx);
          if (!list) continue;
          for (const rl of list) {
            const base = Levels.railBaseAt(rl, x, z);
            if (feet < base - 0.6 || feet > base + (rl.h ?? RAIL_H) - 0.3) continue;
            const p = pushOutOfBox(x, z, r, Math.min(rl.x0, rl.x1) - RAIL_HALF, Math.min(rl.z0, rl.z1) - RAIL_HALF, Math.max(rl.x0, rl.x1) + RAIL_HALF, Math.max(rl.z0, rl.z1) + RAIL_HALF);
            if (p) { x += p[0]; z += p[1]; moved = true; }
          }
        }
      }
    }
    if (props) {
      for (const i of props.near(x - r, z - r, x + r, z + r, scratch)) {
        const pr = props.props[i];
        if (pr.y + pr.h <= feet + 0.02 || pr.y >= feet + BODY_H) continue;
        const p = pushOutOfBox(x, z, r, pr.x - pr.hx, pr.z - pr.hz, pr.x + pr.hx, pr.z + pr.hz);
        if (p) { x += p[0]; z += p[1]; moved = true; }
      }
    }
    if (!moved) break;
  }
  return [x, z];
}

/**
 * Lowest ceiling (world y) over a circle's footprint: area ceilings and door/passage lintels
 * from the grid (absolute; negative below the main level). Solid cells are ignored (a body never
 * overlaps them). Infinity if none apply.
 */
export function ceilingOver(world: CollisionWorld, x: number, z: number, r: number, feet?: number): number {
  // Iteration 08: stacked levels — the ceiling of the band the feet are in (slab undersides, flights overhead)
  if (world instanceof Levels) {
    if (feet !== undefined) return world.ceilingOver(x, z, r, feet);
    world = world.main;
  }
  const grid = world;
  let ceil = Infinity;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((z - r) / CELL), y1 = Math.floor((z + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (!grid.inBounds(cx, cy)) continue;
      const i = grid.idx(cx, cy);
      if (grid.cells[i] === SOLID || !grid.hasCeil(i)) continue;
      const nx = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL)), nz = Math.max(cy * CELL, Math.min(z, (cy + 1) * CELL));
      if ((x - nx) ** 2 + (z - nz) ** 2 >= r * r) continue;
      ceil = Math.min(ceil, grid.ceil[i]);
    }
  }
  return ceil;
}

/** Move with sub-steps so fast movement cannot tunnel through 0.5 m walls (height-aware with `feet`). */
export function moveCircle(world: CollisionWorld, props: PropIndex | null, x: number, z: number, dx: number, dz: number, r: number, feet?: number, height = BODY_CLEAR): [number, number] {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  for (let i = 0; i < steps; i++) {
    [x, z] = resolveCircle(world, props, x + dx / steps, z + dz / steps, r, feet, height);
  }
  return [x, z];
}

/**
 * Feet of a walking body follow the ground (stairs, ramps) or fall under gravity after walking
 * off a ledge. `b.vy === 0` means grounded. Returns the landing speed (m/s) on the frame the body
 * lands, else 0.
 */
export function settleFeet(b: {y: number; vy: number}, ground: number, dt: number, gravity = BODY_GRAVITY): number {
  if (b.vy === 0 && b.y - ground <= SNAP_DOWN) { b.y = ground; return 0; }
  b.vy -= gravity * dt;
  b.y += b.vy * dt;
  if (b.y <= ground) {
    const v = -b.vy;
    b.y = ground;
    b.vy = 0;
    return Math.max(0.01, v);
  }
  return 0;
}
