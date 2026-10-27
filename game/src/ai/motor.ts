// Zombie locomotion on the height-aware world (iteration 05, Lane T): the brain decides where to
// go; the motor moves the body with height-aware collision (ledges above STEP_UP are walls, the
// platform edge is a drop), keeps the feet on the floor (stair ramps) or lets them fall, and leaves
// ladder climbs to the brain's scripted path.

import {moveCircle, resolveCircle, settleFeet, type PropIndex} from '../core/physics';
import type {Grid} from '../gen/grid';
import type {BrainOutput, ZombieBrain} from './brain';

/** Bodies whose feet differ by more than this (platform vs track bed) do not shove each other (m). */
export const SAME_LEVEL = 1.0;
/** Nominal ground speed reported while climbing (drives the gait clip). */
const CLIMB_GAIT = 0.4;

/** Moves one zombie for a frame. Returns its ground speed (m/s) for animation/footsteps. */
export function moveZombie(b: ZombieBrain, out: BrainOutput, dt: number, grid: Grid, props: PropIndex | null): number {
  if (!b.alive) return 0;
  if (b.climbing) { b.vy = 0; return CLIMB_GAIT; }
  let moved = 0;
  if (out.speed > 0) {
    const align = Math.cos(Math.atan2(out.dirX, out.dirZ) - b.yaw);
    const sp = out.speed * Math.max(0.25, align);
    const ox = b.x, oz = b.z;
    [b.x, b.z] = moveCircle(grid, props, b.x, b.z, out.dirX * sp * dt, out.dirZ * sp * dt, b.stats.radius, b.y);
    moved = Math.hypot(b.x - ox, b.z - oz) / Math.max(dt, 1e-6);
  }
  settleFeet(b, grid.floorAt(b.x, b.z), dt);
  return moved;
}

/** Final overlap fix after separation pushes (skipped mid-climb: the scripted path is valid). */
export function settleZombie(b: ZombieBrain, grid: Grid, props: PropIndex | null): void {
  if (!b.alive || b.climbing) return;
  [b.x, b.z] = resolveCircle(grid, props, b.x, b.z, b.stats.radius, b.y);
}

/** Same-level test for body separation (zombie-zombie, zombie-player). */
export function sameLevel(ay: number, by: number): boolean {
  return Math.abs(ay - by) < SAME_LEVEL;
}
