// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the MINI-GOLF contract shared by lanes GOLF-COURSE (the course,
// its kinds, the dresser) and GOLF-PLAY (the putter, the ball item, the ball physics). Pure data (no three.js, no cannon).
//
// Physics model (physics/world.ts buildChunk): a prop's collision is axis-aligned boxes, built with the 4 m static chunk that holds the
// prop's CENTRE, active while a body is within 1.6 m of the chunk. So:
//  - a green is a RAISED turf slab (GOLF_GREEN_H over the floor) made of pieces; a CUP is a gap in the slab boxes (items fall through it
//    onto the real floor GOLF_GREEN_H below: the ball then sits below the turf line) — never a painted decal or a trigger;
//  - the item-collision boxes of a golf kind come from golfColliderBoxes (wired into PhysicsSystem.buildChunk by lane GOLF-PLAY);
//    ragdolls keep the plain prop box;
//  - every collider-bearing piece keeps hypot(hx, hz) <= GOLF_PIECE_MAX_R so its centre chunk is always active under a ball on it;
//  - walkers are not blocked by the low pieces (placed without grid masks): a player stands in the course and putts.
//
// (lane GOLF-COURSE) Walkers: the player / zombie push-out (core/physics.ts resolveCircle) stops a body at ANY floor prop whose top is
// more than 2 cm over its feet — a 6 cm deck stopped a real Player at its edge (checked). So every course piece a walker crosses (the deck
// pieces, the bumper rails, the low obstacles) carries PropPlacement.walkOver: the walker push-out skips it, every other reader keeps its
// box (item physics, ragdolls, bullets, drop scatter). Walkers stand on the hall floor under the 6 cm turf (no slope / step-up for props).
// Course pieces: every deck piece stands on the floor (y = the floor); a piece standing ON the deck (rail, block, arch, tee mat) has its
// y at the deck top under it (golfDeckTop). Tiers: a raised deck piece (golfTier, GOLF_TIER_STEP higher): a ball rolls DOWN its edge
// (AABB physics: no slopes, so a tier is always uphill of its cup). Layout pickups of the course: a pickup's y is its object ORIGIN, and
// the ball model's origin is its BOTTOM (like every pickup model): GOLF_BALL_ITEM at y = the deck top under it (golfDeckTop; its centre
// is then GOLF_BALL_R higher), the PUTTER_ITEM at y = its counter top.

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

// (lane GOLF-COURSE) the course's other collider pieces
/** A raised tier's extra height over the green (m): its turf top is GOLF_GREEN_H + GOLF_TIER_STEP over the floor. */
export const GOLF_TIER_STEP = 0.05;
export const GOLF_TIER_H = GOLF_GREEN_H + GOLF_TIER_STEP;
/** The bumper rails: thickness and height over the deck top they stand on (m). */
export const GOLF_RAIL = {t: 0.08, h: 0.11} as const;
/** The standard playing lane width inside the rails (m). */
export const GOLF_LANE = 1.0;
/** The tunnel arch spanning a standard lane: its two posts (each `post` wide) leave `gap` between them; the lintel spans y0..h. */
export const GOLF_ARCH = {w: GOLF_LANE, d: 0.16, h: 0.3, post: 0.33, gap: GOLF_LANE - 2 * 0.33, lintel: 0.2} as const;
/** The kinds a walker crosses (PropPlacement.walkOver on every placement of them). */
export const GOLF_WALK_OVER_KINDS: ReadonlySet<string> = new Set(['golfGreen', 'golfCup', 'golfTier', 'golfRail', 'golfBlock', 'golfArch', 'golfTeeMat']);
/** The deck kinds (pieces of the turf deck standing on the floor). */
export const GOLF_DECK_KINDS: ReadonlySet<string> = new Set(['golfGreen', 'golfCup', 'golfTier']);

/** An axis-aligned collision box, world metres. */
export interface GolfBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

/** The world AABB of a placement's footprint (its hx / hz: already turned by its quarter yaw). */
const footBox = (p: PropPlacement, y0: number, y1: number): GolfBox => ({x0: p.x - p.hx, y0, z0: p.z - p.hz, x1: p.x + p.hx, y1, z1: p.z + p.hz});

/** The turf top of a deck piece (world y), or null (not a deck piece). */
export function golfDeckTop(p: PropPlacement): number | null {
  if (p.kind === 'golfGreen' || p.kind === 'golfCup') return p.y + GOLF_GREEN_H;
  if (p.kind === 'golfTier') return p.y + GOLF_TIER_H;
  return null;
}

/**
 * The item-collision boxes of a golf kind's placement (null: not a golf collider kind — the default prop box applies). The cup piece is
 * its slab minus the square cup gap (four boxes); a green piece is its slab. Lane GOLF-COURSE owns the kinds (it may add tiers /
 * obstacles here); lane GOLF-PLAY wires this into the physics.
 * (lane GOLF-COURSE) + a tier piece: its taller slab; the tunnel arch: its two posts and the lintel over the gap (a ball rolls under it).
 * The rails / blocks / tee mats keep their default prop boxes (a tee mat's 4 mm box is below the physics' 2 cm floor: the ball rests on
 * the turf under it).
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
  if (p.kind === 'golfTier') return [footBox(p, y0, p.y + GOLF_TIER_H)];
  if (p.kind === 'golfArch') {
    // the span runs along the footprint's long axis; the posts stand at its ends, the lintel over the gap
    const A = GOLF_ARCH, alongX = p.hx >= p.hz, top = p.y + A.h, low = p.y + A.lintel;
    const s0 = alongX ? p.x - p.hx : p.z - p.hz, s1 = alongX ? p.x + p.hx : p.z + p.hz, d0 = alongX ? p.z - p.hz : p.x - p.hx, d1 = alongX ? p.z + p.hz : p.x + p.hx;
    const box = (a: number, b: number, ya: number, yb: number): GolfBox => alongX ? {x0: a, y0: ya, z0: d0, x1: b, y1: yb, z1: d1} : {x0: d0, y0: ya, z0: a, x1: d1, y1: yb, z1: b};
    return [box(s0, s0 + A.post, p.y, top), box(s1 - A.post, s1, p.y, top), box(s0 + A.post, s1 - A.post, low, top)];
  }
  return null;
}
/** Is a ball centre at (x, y, z) sitting IN a cup piece's hole (below the turf line, inside the gap)? (holed state = where the ball is) */
export function golfBallInCup(cup: PropPlacement, x: number, y: number, z: number): boolean {
  return cup.kind === 'golfCup' && Math.abs(x - cup.x) <= GOLF_CUP_HALF && Math.abs(z - cup.z) <= GOLF_CUP_HALF && y < cup.y + GOLF_GREEN_H - GOLF_BALL_R * 0.5;
}
