// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the MINI-GOLF contract shared by lanes GOLF-COURSE (the course,
// its kinds, the dresser) and GOLF-PLAY (the putter, the ball item, the ball physics). Pure data (no three.js, no cannon).
//
// Physics model (physics/world.ts buildChunk): a prop's collision is axis-aligned boxes, built with the 4 m static chunk that holds the
// prop's CENTRE, active while a body is within 1.6 m of the chunk. So:
//  - a green is a RAISED turf slab (GOLF_GREEN_H over the floor) made of pieces; a CUP is a gap in the slab boxes (items fall through it
//    onto the real floor GOLF_GREEN_H below: the ball then sits below the turf line) — never a painted decal or a trigger;
//  - the item-collision boxes of a golf kind come from golfColliderBoxes (wired into PhysicsSystem.holderBoxes by lane GOLF-PLAY);
//    ragdolls keep the plain prop box;
//  - every collider-bearing piece keeps hypot(hx, hz) <= GOLF_PIECE_MAX_R so its centre chunk is always active under a ball on it;
//  - walkers are not blocked by the low pieces (placed without grid masks): a player stands in the course and putts.

import type {PropPlacement} from '../../props';

/** Item ids (lane GOLF-PLAY defines the items; the dresser places them as layout pickups). */
export const GOLF_BALL_ITEM = 'golf_ball';
export const PUTTER_ITEM = 'putter';
/** A regulation ball: 42.7 mm, 45.9 g. */
export const GOLF_BALL_R = 0.02135;
export const GOLF_BALL_MASS = 0.0459;
/** Turf top above the floor (m): a carpeted course deck on its frame. */
export const GOLF_GREEN_H = 0.06;
/** The cup's drawn radius (a 108 mm cup) and the square gap left in the collider boxes (its half side: corners ~ the drawn rim). */
export const GOLF_CUP_R = 0.054;
export const GOLF_CUP_HALF = 0.042;
/** The cup piece: a square of turf (side m) with the cup at its centre. */
export const GOLF_CUP_PIECE = 0.5;
/** The largest centre-to-corner reach of a collider-bearing piece (m: under the 1.6 m chunk activation radius). */
export const GOLF_PIECE_MAX_R = 1.4;

/** An axis-aligned collision box, world metres. */
export interface GolfBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

/** The world AABB of a placement's footprint (its hx / hz: already turned by its quarter yaw). */
const footBox = (p: PropPlacement, y0: number, y1: number): GolfBox => ({x0: p.x - p.hx, y0, z0: p.z - p.hz, x1: p.x + p.hx, y1, z1: p.z + p.hz});

/**
 * The item-collision boxes of a golf kind's placement (null: not a golf collider kind — the default prop box applies). The cup piece is
 * its slab minus the square cup gap (four boxes); a green piece is its slab. Lane GOLF-COURSE owns the kinds (it may add tiers /
 * obstacles here); lane GOLF-PLAY wires this into the physics.
 */
export function golfColliderBoxes(p: PropPlacement): GolfBox[] | null {
  const y0 = p.y, y1 = p.y + GOLF_GREEN_H;
  if (p.kind === 'golfGreen') return [footBox(p, y0, y1)];
  if (p.kind === 'golfCup') {
    const h = GOLF_CUP_HALF, X0 = p.x - p.hx, X1 = p.x + p.hx, Z0 = p.z - p.hz, Z1 = p.z + p.hz;
    return [
      {x0: X0, y0, z0: Z0, x1: X1, y1, z1: p.z - h}, {x0: X0, y0, z0: p.z + h, x1: X1, y1, z1: Z1},
      {x0: X0, y0, z0: p.z - h, x1: p.x - h, y1, z1: p.z + h}, {x0: p.x + h, y0, z0: p.z - h, x1: X1, y1, z1: p.z + h},
    ];
  }
  return null;
}
/** Is a ball centre at (x, y, z) sitting IN a cup piece's hole (below the turf line, inside the gap)? (holed state = where the ball is) */
export function golfBallInCup(cup: PropPlacement, x: number, y: number, z: number): boolean {
  return cup.kind === 'golfCup' && Math.abs(x - cup.x) <= GOLF_CUP_HALF && Math.abs(z - cup.z) <= GOLF_CUP_HALF && y < cup.y + GOLF_GREEN_H - GOLF_BALL_R * 0.5;
}
