// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): the fuel cart's KINEMATIC controller (pure: no three.js scene, no
// Game). A bounded walker-like body, NOT a cannon-es body (the budgeted physics system is untouched): state x / z (the footprint
// circle's centre, radius PORT.cartRadius), y (resting on the floor), yaw, velocity.
//
// Collision is the player's own (core/physics.ts moveCircle against the same Levels + PropIndex: walls, ledges, props, the parked car's
// DynamicVolume / wall / door-leaf / curb boxes that world/playerTrain.ts puts into game.propIndex) with a cart's clear height. On top
// of that the FLOOR RULE: a move is refused where the floor under the centre or any rim point (0.8 r) rises more than CART.step or
// drops more than CART.drop below the cart (no rolling off a platform edge into the track bed; the car floor / door bridge is within a
// step of the platform). A refused move tries each axis alone (it slides along an edge).
//
// STAIRS (task studio-fuel-cart-stairs-20261110-004505-01; user: "Just let the player drag the carts up and down stairs"): a stair
// flight's walking surface is its continuous PITCH LINE (gen/grid.ts Ramp: the surface every walking body stands on), so the floor rule
// carries a cart over real stair runs and landings both ways — over a footprint the pitch rises about 0.17 m, inside CART.step — and
// over low threshold steps (the Bunker's vault sill: 0.28 m a cell). (The first version's header said "no climbing stairs"; that was
// never what this rule did, and no test pinned it. tests/fuel-cart-stairs.test.ts pins the real behaviour on every level's flights.)
// What the stairs add here:
//  - a free cart on a flight rests on the step edges: it stops within centimetres when let go, shoved or shot (CART.stairDecel) — it
//    never coasts down a stair;
//  - the REST POSE (cartRestPose: view only): on steps the cart lies on the NOSING LINE (the line through the step edges, half a riser
//    over the pitch line), pitched / rolled with the slope under its footprint; over a flight's two ends and over threshold steps it
//    rocks from one surface to the next. The body's y stays the pitch line (collision, reach, records).
// Mass: CART.emptyKg + CART.kgPerUnit per quarter unit (150 kg full). Free carts coast against rolling resistance; a walking player
// pushes one at most CART.push.max m/s (heavier = slower) with CART.push.force; a GRABBED cart follows a target with a critically
// damped spring whose acceleration is capped by CART.grab.force / mass.
// The PLAYER cannot walk through a cart: after the carts moved, an overlapping player is moved back out (through moveCircle, never
// into a wall) and loses the velocity into the cart beyond the cart's own. Carts separate from each other (bounded pairs).

import {moveCircle, type PropIndex} from '../core/physics';
import type {Ramp} from '../gen/grid';
import type {Levels} from '../gen/levels';
import {PORT} from '../fuel/trainPort';
import {FUEL} from '../fuel/fuel';

export const CART = {
  radius: PORT.cartRadius,
  /** Collision clear height (m): the handle top + a little. */
  height: 1.25,
  emptyKg: 40,
  kgPerUnit: (150 - 40) / FUEL.cartUnits,
  /** Free rolling resistance (m/s²): a shoved cart coasts a short way (not applied on a frame the player pushes it). */
  rollDecel: 1.2,
  maxSpeed: 3.2,
  /** Walking into a free cart: the push force (N) and the top push speeds (m/s, empty .. full). */
  push: {force: 320, maxEmpty: 1.9, maxFull: 1.0},
  /** Grabbed: spring stiffness (1/s²), the grip force (N), break when the cart lags the target by > breakDist (m) for breakTime (s). */
  grab: {k: 60, force: 900, breakDist: 1.3, breakTime: 0.35, turnRate: 5},
  /** Floor rule (m): the most the floor may rise / drop under the footprint in one move. */
  step: 0.3,
  drop: 0.3,
  /** Rim samples at this fraction of the radius. */
  rim: 0.8,
  /** Below this speed a free cart sleeps (m/s). */
  sleep: 0.02,
  /** A free cart on a stair flight rests on the step edges: this deceleration (m/s²) stops it within centimetres. */
  stairDecel: 14,
  /** Rest pose: the largest tilt drawn (rad) and how fast the drawn pose follows (1/s). */
  maxTilt: 0.75,
  poseRate: 16,
} as const;

export interface CartBody {
  x: number; y: number; z: number;
  yaw: number;
  vx: number; vz: number;
  /** The storey it stands on (Levels support level). */
  level: number;
  /** Quarter units in the drum (mass). */
  units: number;
}

export interface CartWorld { levels: Levels; props: PropIndex | null }

/** The structural player the controller pushes / is pushed by (player/player.ts Player). */
export interface CartPusher { x: number; y: number; z: number; vx: number; vz: number; radius: number; bodyHeight?: number }

export const cartMass = (units: number): number => CART.emptyKg + CART.kgPerUnit * Math.max(0, Math.min(FUEL.cartUnits, units));

/** Top push speed of a walking player (m/s): slower the fuller it is. */
export const pushTop = (units: number): number => CART.push.maxEmpty + (CART.push.maxFull - CART.push.maxEmpty) * Math.max(0, Math.min(1, units / FUEL.cartUnits));

/** The floor under a point for a cart standing at height y: null when unsupported, too high (> step) or too deep (> drop). */
export function cartFloorAt(L: Levels, x: number, z: number, y: number): {floor: number; level: number} | null {
  const s = L.supportIn(x, z, y, CART.step);
  if (!s) return null;
  if (s.floor - y > CART.step + 1e-6 || y - s.floor > CART.drop + 1e-6) return null;
  return {floor: s.floor, level: s.level};
}

/** The stair flight under a point for a body at height y (its Ramp), or null on flat floor / a lift car / nothing. */
export function flightAt(L: Levels, x: number, z: number, y: number): Ramp | null {
  const s = L.supportIn(x, z, y, CART.step);
  if (!s || s.volume) return null;
  const lv = L.list[s.level]?.id === s.level ? L.list[s.level] : L.list.find(q => q.id === s.level);
  const g = lv?.grid;
  if (!g) return null;
  const r = g.rampIdx[s.cell];
  return r >= 0 ? g.ramps[r] ?? null : null;
}

/**
 * The surface a cart RESTS on at a point (for its drawn pose): the floor; on a stair flight the NOSING LINE — the line through the
 * step edges, half a riser over the pitch line (the pitch line passes through the tread centres: world/traversalBuilder.ts), fading to
 * the landing over the half tread at each end of the flight (the top landing runs half a tread into the flight; the wheel rolls off
 * the last nose onto the bottom landing). Null: nothing to stand on there (a wall, a drop deeper than CART.drop).
 */
export function cartSurfaceAt(L: Levels, x: number, z: number, y: number): number | null {
  const s = L.supportIn(x, z, y, CART.step + 0.25);
  if (!s || y - s.floor > CART.drop + 0.25) return null;
  if (s.volume) return s.floor;
  const lv = L.list[s.level]?.id === s.level ? L.list[s.level] : L.list.find(q => q.id === s.level);
  const g = lv?.grid;
  const r = g ? g.rampIdx[s.cell] : -1;
  if (!g || r < 0) return s.floor;
  const R = g.ramps[r];
  if (!R || R.risers < 1 || R.s1 === R.s0) return s.floor;
  const riser = Math.abs(R.h1 - R.h0) / R.risers;
  // tread units from the flight's start (the support's floor IS the pitch line there: invert it, no second coordinate clamp)
  const u = R.h1 === R.h0 ? 0 : ((s.floor - R.h0) / (R.h1 - R.h0)) * R.risers;
  return s.floor + riser * Math.max(0, Math.min(0.5, u, R.risers - u));
}

/** A cart's drawn pose over its body: lift (m over body.y), pitch (rad, + = the front up), roll (rad, + = the +x side up). */
export interface CartPose { dy: number; pitch: number; roll: number }

/**
 * The pose a cart at rest takes on the surface under its footprint (pure; the body is not changed): the rest surface sampled under
 * the centre, front / back and both sides (CART.rim of the radius, in the cart's own frame); the base plane tilts with them and
 * never sinks into the surface under its centre. Flat floor: exactly {0, 0, 0}.
 */
export function cartRestPose(L: Levels, b: CartBody, out: CartPose = {dy: 0, pitch: 0, roll: 0}): CartPose {
  const d = CART.radius * CART.rim, sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
  const hc = cartSurfaceAt(L, b.x, b.z, b.y) ?? b.y;
  const at = (ux: number, uz: number): number => cartSurfaceAt(L, b.x + ux * d, b.z + uz * d, b.y) ?? hc;
  const hf = at(sy, cy), hb = at(-sy, -cy), hr = at(cy, -sy), hl = at(-cy, sy);
  if (hf === hc && hb === hc && hr === hc && hl === hc) { out.dy = hc - b.y; out.pitch = 0; out.roll = 0; return out; }
  const m = CART.maxTilt;
  out.pitch = Math.max(-m, Math.min(m, Math.atan2(hf - hb, 2 * d)));
  out.roll = Math.max(-m, Math.min(m, Math.atan2(hr - hl, 2 * d)));
  out.dy = Math.max(hc, (hf + hb) / 2, (hr + hl) / 2) - b.y;
  return out;
}

const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

/** The footprint stands on walkable floor (centre + rim): the centre's floor, else null. */
export function footprintFloor(L: Levels, x: number, z: number, y: number): {floor: number; level: number} | null {
  const c = cartFloorAt(L, x, z, y);
  if (!c) return null;
  const rr = CART.radius * CART.rim;
  for (const [ux, uz] of RIM) if (!cartFloorAt(L, x + ux * rr, z + uz * rr, y)) return null;
  return c;
}

/**
 * Move a cart by (dx, dz): collision (moveCircle) then the floor rule; a refused move tries each axis alone. Returns true when it
 * moved. Updates x / z / y / level (never velocity).
 */
export function moveCart(b: CartBody, w: CartWorld, dx: number, dz: number): boolean {
  if (dx === 0 && dz === 0) return false;
  const L = w.levels;
  const tryMove = (mx: number, mz: number): boolean => {
    const [nx, nz] = moveCircle(L, w.props, b.x, b.z, mx, mz, CART.radius, b.y, CART.height);
    if (Math.abs(nx - b.x) < 1e-7 && Math.abs(nz - b.z) < 1e-7) return false;
    const f = footprintFloor(L, nx, nz, b.y);
    if (!f) return false;
    b.x = nx; b.z = nz; b.y = f.floor; b.level = f.level;
    return true;
  };
  if (tryMove(dx, dz)) return true;
  if (dx !== 0 && tryMove(dx, 0)) return true;
  if (dz !== 0 && tryMove(0, dz)) return true;
  return false;
}

/** A grab target: where the cart's centre should be and how fast that point moves. */
export interface CartTarget { x: number; z: number; vx: number; vz: number }

/**
 * One controller step: the spring toward `target` (grabbed) or rolling resistance (free), the speed cap, the move with collision; the
 * velocity follows what actually happened (sliding along walls, stopped by an edge). Returns the distance moved.
 */
export function stepCart(b: CartBody, w: CartWorld, dt: number, target: CartTarget | null, pushed = false): number {
  if (dt <= 0) return 0;
  if (pushed) { /* the push already set the velocity this frame (it overcomes the rolling resistance) */ }
  else if (target) {
    const k = CART.grab.k, c = 2 * Math.sqrt(k);
    let ax = k * (target.x - b.x) + c * (target.vx - b.vx);
    let az = k * (target.z - b.z) + c * (target.vz - b.vz);
    const amax = CART.grab.force / cartMass(b.units), a = Math.hypot(ax, az);
    if (a > amax) { ax *= amax / a; az *= amax / a; }
    b.vx += ax * dt;
    b.vz += az * dt;
  } else {
    const v = Math.hypot(b.vx, b.vz);
    if (v > 0) {
      // (on a stair flight the cart rests on the step edges: it stops at once instead of coasting down the stair)
      const nv = Math.max(0, v - (flightAt(w.levels, b.x, b.z, b.y) ? CART.stairDecel : CART.rollDecel) * dt);
      b.vx *= nv / v;
      b.vz *= nv / v;
    }
  }
  const v = Math.hypot(b.vx, b.vz);
  if (v > CART.maxSpeed) { b.vx *= CART.maxSpeed / v; b.vz *= CART.maxSpeed / v; }
  if (Math.hypot(b.vx, b.vz) < 1e-6) { b.vx = b.vz = 0; return 0; }
  const x0 = b.x, z0 = b.z;
  moveCart(b, w, b.vx * dt, b.vz * dt);
  const mx = b.x - x0, mz = b.z - z0;
  b.vx = mx / dt;
  b.vz = mz / dt;
  return Math.hypot(mx, mz);
}

/** A free cart is pushed by a walking player overlapping it: velocity along the contact normal toward the player's (capped, by mass). */
export function pushByPlayer(b: CartBody, p: CartPusher, dt: number): boolean {
  const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = p.radius + CART.radius;
  if (d >= min + 0.02 || d < 1e-6) return false;
  const nx = dx / d, nz = dz / d;
  const vn = p.vx * nx + p.vz * nz;
  if (vn <= 0.02) return false;
  const want = Math.min(vn, pushTop(b.units)), cur = b.vx * nx + b.vz * nz;
  if (want > cur) {
    const dv = Math.min(want - cur, (CART.push.force / cartMass(b.units)) * dt);
    b.vx += nx * dv;
    b.vz += nz * dv;
  }
  return true; // (pushing: no rolling resistance this frame)
}

/**
 * The player never stands inside a cart: an overlapping player is moved out along the contact normal (moveCircle against the world:
 * never into a wall) and loses its velocity into the cart beyond the cart's own. Returns the overlap resolved (m).
 */
export function separatePlayer(b: CartBody, p: CartPusher, w: CartWorld): number {
  const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz), min = p.radius + CART.radius;
  if (d >= min) return 0;
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0, ov = min - d;
  const [x, z] = moveCircle(w.levels, w.props, p.x, p.z, nx * ov, nz * ov, p.radius, p.y, p.bodyHeight);
  p.x = x; p.z = z;
  // the velocity into the cart (along -n) is limited to the cart's own along -n
  const into = -(p.vx * nx + p.vz * nz), cartInto = -(b.vx * nx + b.vz * nz);
  if (into > cartInto) { const k = into - cartInto; p.vx += nx * k; p.vz += nz * k; }
  return ov;
}

/** Two carts apart (half each, through the world's collision); their normal velocities averaged (an inelastic bump). */
export function separateCarts(a: CartBody, b: CartBody, w: CartWorld): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 2 * CART.radius;
  if (d >= min || Math.abs(a.y - b.y) > 1) return false;
  const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0, half = (min - d) / 2 + 1e-4;
  moveCart(a, w, -nx * half, -nz * half);
  moveCart(b, w, nx * half, nz * half);
  const va = a.vx * nx + a.vz * nz, vb = b.vx * nx + b.vz * nz;
  if (va > vb) {
    const m = (va + vb) / 2;
    a.vx += (m - va) * nx; a.vz += (m - va) * nz;
    b.vx += (m - vb) * nx; b.vz += (m - vb) * nz;
  }
  return true;
}

/** Turn `yaw` toward `want` by at most rate·dt (shortest way). */
export function turnToward(yaw: number, want: number, rate: number, dt: number): number {
  let d = (want - yaw) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const m = rate * dt;
  return Math.abs(d) <= m ? want : yaw + Math.sign(d) * m;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapYaw(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  return a - Math.PI;
}
