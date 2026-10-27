// Analytic ray tests for hitscan weapons: grid walls, floor/ceiling, prop boxes, body capsules.
// Iteration 05 (Lane T): floors, ceilings and ledge faces are tested per cell along the ray, at
// each cell's own heights (platform, track bed + platform face, stair ramps, the underpass).

import {CELL, SOLID, VOID, type Grid} from '../gen/grid';
import type {PropPlacement} from '../gen/props';

export interface Vec3 { x: number; y: number; z: number }

export interface WorldHit {
  t: number;
  kind: 'wall' | 'floor' | 'ceiling' | 'prop' | 'none';
  nx: number; ny: number; nz: number;
  /** Iteration 06 (Lane D): index into the props list when kind === 'prop'. */
  prop?: number;
}

/**
 * Iteration 06 (Lane D): what a bullet hit, for the damage system and QA (lane-contracts.md "Hit info").
 * object: 'wall' | 'floor' | 'ceiling' | 'prop' | 'zombie' | 'corpse'; instanceId: prop index / zombie
 * index; material: damage class (damage/materials.ts); bone + localPoint (bind/rest space) for zombies.
 */
export interface HitInfo {
  point: Vec3;
  normal: Vec3;
  object: 'wall' | 'floor' | 'ceiling' | 'prop' | 'zombie' | 'corpse';
  instanceId: number | null;
  material: string;
  bone?: string;
  localPoint?: Vec3;
  /** Prop / surface damage stage after the hit (0 intact .. 3 broken) and what broke, if anything. */
  stage?: number;
  broke?: string | null;
}

export function rayAabb(o: Vec3, d: Vec3, min: Vec3, max: Vec3): {t: number; n: [number, number, number]} | null {
  let tmin = -Infinity, tmax = Infinity;
  let n: [number, number, number] = [0, 0, 0];
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (let a = 0; a < 3; a++) {
    const k = axes[a];
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - o[k]) / d[k], t2 = (max[k] - o[k]) / d[k];
    let sign = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; sign = 1; }
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[a] = sign; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return {t: Math.max(0, tmin), n};
}

export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : Infinity);
}

/** Ray vs capsule (segment a-b, radius r). Returns distance or Infinity. */
export function rayCapsule(o: Vec3, d: Vec3, a: Vec3, b: Vec3, r: number): number {
  // Closest approach between ray and segment, then sphere test at that segment point.
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const A = d.x * d.x + d.y * d.y + d.z * d.z;
  const B = d.x * ux + d.y * uy + d.z * uz;
  const C = ux * ux + uy * uy + uz * uz;
  const D = d.x * wx + d.y * wy + d.z * wz;
  const E = ux * wx + uy * wy + uz * wz;
  const den = A * C - B * B;
  let s = den > 1e-9 ? (A * E - B * D) / den : 0;
  s = Math.max(0, Math.min(1, s));
  const p = {x: a.x + ux * s, y: a.y + uy * s, z: a.z + uz * s};
  let best = raySphere(o, d, p, r);
  // refine with endpoints for robustness
  best = Math.min(best, raySphere(o, d, a, r), raySphere(o, d, b, r));
  return best;
}

/** Floor / ceiling of a cell at a world point (legacy grids without ceilings: 3 m). */
function cellSurf(grid: Grid, cx: number, cy: number, x: number, z: number, trenchY: number): [number, number] {
  const i = grid.idx(cx, cy);
  const r = grid.rampIdx[i];
  if (r >= 0) {
    // Evaluate this cell's ramp (points on the cell boundary belong to it, not the neighbour).
    const R = grid.ramps[r];
    const f = grid.floorNear(cx, cy, x, z);
    return [f, f + R.headroom];
  }
  const f = grid.cells[i] === VOID && grid.floor[i] === 0 ? trenchY : grid.floorOf(i);
  return [f, grid.hasCeil(i) ? grid.ceil[i] : 3];
}

/**
 * First floor / ceiling / ledge-face hit along the ray before tMax: marches the cells the ray's
 * horizontal projection crosses; inside each cell the floor (ramps: linear) and ceiling are tested
 * against the ray height; entering a cell below its floor or above its ceiling hits that face.
 */
export function surfaceHit(grid: Grid, o: Vec3, d: Vec3, tMax: number, trenchY: number): WorldHit | null {
  const hl = Math.hypot(d.x, d.z);
  let cx = Math.floor(o.x / CELL), cy = Math.floor(o.z / CELL);
  if (!grid.inBounds(cx, cy)) return null;
  if (hl < 1e-6) {
    const [f, c] = cellSurf(grid, cx, cy, o.x, o.z, trenchY);
    if (d.y < 0) { const t = (f - o.y) / d.y; return t >= 0 && t < tMax ? {t, kind: 'floor', nx: 0, ny: 1, nz: 0} : null; }
    if (d.y > 0) { const t = (c - o.y) / d.y; return t >= 0 && t < tMax ? {t, kind: 'ceiling', nx: 0, ny: -1, nz: 0} : null; }
    return null;
  }
  const ux = d.x / hl, uz = d.z / hl;
  const stepX = ux > 0 ? 1 : -1, stepY = uz > 0 ? 1 : -1;
  const dX = ux !== 0 ? Math.abs(CELL / ux) : Infinity, dY = uz !== 0 ? Math.abs(CELL / uz) : Infinity;
  let mX = ux !== 0 ? ((ux > 0 ? (cx + 1) * CELL - o.x : o.x - cx * CELL) / Math.abs(ux)) : Infinity;
  let mY = uz !== 0 ? ((uz > 0 ? (cy + 1) * CELL - o.z : o.z - cy * CELL) / Math.abs(uz)) : Infinity;
  let tA = 0, lastX = false;
  const at = (t: number) => ({x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t});
  for (let guard = 0; guard < 8192 && tA < tMax; guard++) {
    if (!grid.inBounds(cx, cy) || grid.cells[grid.idx(cx, cy)] === SOLID) return null;
    const tB = Math.min(tMax, Math.min(mX, mY) / hl);
    const pa = at(tA), pb = at(tB);
    const [fA, cA] = cellSurf(grid, cx, cy, pa.x, pa.z, trenchY);
    const [fB, cB] = cellSurf(grid, cx, cy, pb.x, pb.z, trenchY);
    if (tA > 1e-6) {
      // Entering below this cell's floor (platform face, step riser) or above its ceiling (soffit).
      if (pa.y < fA - 1e-3 || pa.y > cA + 1e-3) return {t: tA, kind: 'wall', nx: lastX ? -stepX : 0, ny: 0, nz: lastX ? 0 : -stepY};
    }
    const gA = pa.y - fA, gB = pb.y - fB;
    if (gA >= 0 && gB < 0) return {t: tA + (tB - tA) * gA / (gA - gB), kind: 'floor', nx: 0, ny: 1, nz: 0};
    const hA = cA - pa.y, hB = cB - pb.y;
    if (hA >= 0 && hB < 0) return {t: tA + (tB - tA) * hA / (hA - hB), kind: 'ceiling', nx: 0, ny: -1, nz: 0};
    if (tB >= tMax) return null;
    tA = tB;
    if (mX < mY) { mX += dX; cx += stepX; lastX = true; } else { mY += dY; cy += stepY; lastX = false; }
  }
  return null;
}

export function raycastWorld(grid: Grid, props: PropPlacement[], o: Vec3, d: Vec3, maxDist: number, trenchY: number): WorldHit {
  let best: WorldHit = {t: maxDist, kind: 'none', nx: 0, ny: 0, nz: 0};
  const hl = Math.hypot(d.x, d.z);
  if (hl > 1e-6) {
    const t2 = grid.raycast(o.x, o.z, d.x, d.z, maxDist * hl, true);
    const t = t2 / hl;
    if (t < best.t) {
      // Normal from which cell face we crossed.
      const hx = o.x + d.x * t, hz = o.z + d.z * t;
      const fx = hx / CELL - Math.round(hx / CELL), fz = hz / CELL - Math.round(hz / CELL);
      const onX = Math.abs(fx) < Math.abs(fz);
      best = {t, kind: 'wall', nx: onX ? -Math.sign(d.x) : 0, ny: 0, nz: onX ? 0 : -Math.sign(d.z)};
    }
  }
  const surf = surfaceHit(grid, o, d, best.t, trenchY);
  if (surf && surf.t < best.t) best = surf;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    // cheap reject: distance from ray origin
    const dx = p.x - o.x, dz = p.z - o.z;
    if (dx * dx + dz * dz > (best.t + 2) * (best.t + 2)) continue;
    const h = rayAabb(o, d, {x: p.x - p.hx, y: p.y, z: p.z - p.hz}, {x: p.x + p.hx, y: p.y + p.h, z: p.z + p.hz});
    if (h && h.t < best.t) best = {t: h.t, kind: 'prop', nx: h.n[0], ny: h.n[1], nz: h.n[2], prop: i};
  }
  return best;
}
