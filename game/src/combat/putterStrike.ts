// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the PUTTER's stroke on a golf ball — its OWN low head
// sweep. The melee ray fan (combat/melee.ts) starts at the eye and reaches 1.3 m: it never gets down to a 43 mm ball at the player's feet,
// so at the swing's contact moment (WeaponController 'contact' -> Game.meleeContact) the putter ALSO sweeps the floor in front of the player:
//  - the SECTOR: a golf-ball pickup whose centre lies PUTT_SECTOR.minR .. maxR in front of the player's feet (horizontal distance),
//    within +-halfAngle of the facing and at foot / turf height (below .. above the feet); nothing behind a wall (`clear`: the walls of
//    the level only — the course's own low turf / rails are no cover);
//  - ONE ball per stroke: the nearest in the sector (then the most centred) — never every ball on the green at once;
//  - the IMPULSE: the ball leaves along the player's horizontal FACING (not the line from the player to the ball: you aim by looking)
//    at puttSpeed(charge) (weapons/putter.ts: the swing's hold sets the power) with its rolling spin (DynamicItems.putt).
// The eye-height swing still strikes enemies normally (Game.meleeContact); a stroke that struck a ball skips the ray fan's loose-item knock
// for that swing (the ball takes the club once). Pure geometry + the host's callbacks (no game state).
import {GOLF_BALL_ITEM} from '../gen/skyways/events/golfContract';
import {puttSpeed} from '../weapons/putter';

/** The putter head's sweep in front of the feet (m / rad). */
export const PUTT_SECTOR = {minR: 0.12, maxR: 1.25, halfAngle: 40 * Math.PI / 180, below: 0.25, above: 0.4} as const;

export interface PuttCandidate<T> { ball: T; x: number; y: number; z: number }
export interface PuttPick<T> { ball: T; dist: number; angle: number; x: number; y: number; z: number }

/**
 * The ball the putter head meets: the nearest candidate (centre x / y / z) in PUTT_SECTOR in front of feet (px, py, pz) facing the
 * horizontal (fx, fz), then the most centred; `clear(x, y, z)` (optional) = nothing solid between the player and that centre. null: none.
 */
export function pickPuttBall<T>(px: number, py: number, pz: number, fx: number, fz: number, cands: readonly PuttCandidate<T>[], clear?: (x: number, y: number, z: number) => boolean): PuttPick<T> | null {
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) return null;
  const ux = fx / fl, uz = fz / fl, S = PUTT_SECTOR, cosMax = Math.cos(S.halfAngle);
  let best: PuttPick<T> | null = null;
  for (const c of cands) {
    if (c.y < py - S.below || c.y > py + S.above) continue;
    const dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz);
    if (d < S.minR || d > S.maxR) continue;
    const cos = (dx * ux + dz * uz) / d;
    if (cos < cosMax) continue;
    const angle = Math.acos(Math.min(1, cos));
    if (best && (d > best.dist + 1e-6 || (Math.abs(d - best.dist) <= 1e-6 && angle >= best.angle))) continue;
    if (clear && !clear(c.x, c.y, c.z)) continue;
    best = {ball: c.ball, dist: d, angle, x: c.x, y: c.y, z: c.z};
  }
  return best;
}

/** What Game.meleeContact gives the stroke. */
export interface PuttHost<T> {
  /** The loose golf-ball pickups with their centres (not owned: a stall's ware is never struck). */
  balls(): readonly PuttCandidate<T>[];
  /** Launch `ball` along the horizontal (dx, dz) at `speed` m/s with its rolling spin (physics/dynamicItems.ts putt). */
  putt(ball: T, dx: number, dz: number, speed: number): boolean;
  /** Nothing solid (the level's walls / slabs) between the player and the ball centre. Absent: always clear. */
  clear?(x: number, y: number, z: number): boolean;
}

export interface PuttStrike<T> extends PuttPick<T> { speed: number; dirX: number; dirZ: number }

/**
 * The putter's stroke at a swing's contact: the ball in the sector (pickPuttBall) gets the putt (power from the swing's charge). null:
 * no ball there (the swing is an ordinary club swing).
 */
export function strikeGolfBall<T>(host: PuttHost<T>, feet: {x: number; y: number; z: number}, fx: number, fz: number, charge: number): PuttStrike<T> | null {
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) return null;
  const pick = pickPuttBall(feet.x, feet.y, feet.z, fx, fz, host.balls(), host.clear ? (x, y, z) => host.clear!(x, y, z) : undefined);
  if (!pick) return null;
  const speed = puttSpeed(charge), dirX = fx / fl, dirZ = fz / fl;
  if (!host.putt(pick.ball, dirX, dirZ, speed)) return null;
  return {...pick, speed, dirX, dirZ};
}

/** Is this pickup a golf ball the putter can strike (the item id; an owned ware never)? */
export const isPuttable = (p: {stack: {itemId: string}; owner?: unknown}): boolean => p.stack.itemId === GOLF_BALL_ITEM && !p.owner;
