// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's ARCADE KINEMATICS (pure: no three.js scene, no Game).
//
// User: a short, fun change of pace — "fun acceleration / steering / braking / reverse; no simulation". So: a kinematic BICYCLE model
// (no tyre forces, no slip, no gears, no fuel): one signed speed `v` along the heading, a front-wheel angle `steer` whose limit falls
// with speed, yaw rate = v · tan(steer) / wheelBase. W accelerates (CAR_PHYS.accel, tapering toward forwardMax), S brakes while rolling
// forward and reverses from (near) standstill (reverseMax), coasting loses speed to rolling resistance + drag, Space is the handbrake
// (hard braking, a sharper turn while it bites: a little arcade snap).
//
// BODY: CarSpec.circles (2-4 circles on the centre line covering the body) moved RIGIDLY: each frame's motion is split into sub-steps
// (<= subStep m, <= subYaw rad); a sub-step's pose is settled against the world with the player's own collision (core/physics.ts
// resolveCircle against the same Levels + PropIndex: walls, slab edges, low soffits at the car's clear height, RAILINGS at deck
// height, props) by translating the whole body out of its deepest contact (a few iterations), then the FLOOR RULE: every circle's
// footprint (centre + 8 rim points) must stand on ITS storey's floor within ±floorTol of the car, never on a stair / escalator ramp
// cell, never in a dynamic volume (the elevator cab, the parked train): no stairs, no drops — rails, atrium edges and building edges
// stop it. A refused sub-step tries the move without the turn, the turn alone, then each axis alone (it slides along an edge); none ->
// it stops there. The speed follows what actually happened (the motion along the new heading, never more than before): a wall met
// head-on stops the car (a small bounce above bounceMin), a glancing one slides it along. The CLOSING speed into the obstacle (the
// velocity against the contact normal) is reported as the impact (world/skywaysCar.ts: glass, sound).

import {resolveCircle, type PropIndex} from '../core/physics';
import type {Levels} from '../gen/levels';
import {carToWorld, type CarSpec} from './skywaysCarSpec';

export const CAR_PHYS = {
  /** Throttle (m/s²) at standstill; at forwardMax it is accel x (1 - accelTaper). */
  accel: 7,
  accelTaper: 0.45,
  /** Service brake (m/s²; S while rolling forward, W while reversing). */
  brake: 14,
  /** Reverse throttle (m/s²) and the speed caps (m/s). */
  reverseAccel: 5,
  reverseMax: 5,
  forwardMax: 15,
  /** Coasting: rolling resistance (m/s²) + drag x v² (1/m). */
  roll: 0.9,
  drag: 0.012,
  /** Handbrake (m/s²) and its yaw-rate boost above handbrakeYawMin m/s. */
  handbrake: 9,
  handbrakeYaw: 1.5,
  handbrakeYawMin: 3,
  /** S below this forward speed reverses (and W above minus this from reverse brakes). */
  stopSpeed: 0.3,
  /** Front-wheel angle limit (rad): steerLow at standstill .. steerHigh at forwardMax and above. */
  steerLow: 0.55,
  steerHigh: 0.15,
  /** Steering rates (rad/s): toward a held direction / back to centre (or across). */
  steerRate: 2.6,
  steerReturn: 4.5,
  /** Floor rule (m): the most the floor under any footprint sample may differ from the car's; rim samples at rim x radius. */
  floorTol: 0.25,
  rim: 0.9,
  /** Collision clear height over the floor (m): the roof + a little (CarSpec.height + clearPad). */
  clearPad: 0.06,
  /** Sub-step limits (m / rad) and the frame dt cap (s: hitches never teleport the car). */
  subStep: 0.2,
  subYaw: 0.06,
  maxDt: 0.1,
  /** A head-on hit faster than bounceMin (m/s) rebounds at bounce x closing, at most bounceMax (m/s). */
  bounce: 0.12,
  bounceMin: 5,
  bounceMax: 1.5,
  /**
   * A GLANCING contact (the car's travel within acos(glanceCos) of the direction it actually slid: a wall / rail / edge met at a
   * shallow angle) keeps the speed along the slide (x cos, less glanceLoss) and turns the car toward it (at most alignRate rad/s).
   */
  glanceCos: 0.64,
  glanceLoss: 0.05,
  alignRate: 4,
} as const;

/** What the controller needs of the car's anchors. */
export type CarGeom = Pick<CarSpec, 'circles' | 'wheelBase' | 'height'>;

export interface CarBody {
  /** Footprint centre (world) and the floor under it (absolute y). */
  x: number; y: number; z: number;
  /** Heading (rad; forward = (-sin yaw, -cos yaw)). */
  yaw: number;
  /** Signed speed along the heading (m/s; < 0 reversing). */
  v: number;
  /** Front-wheel angle (rad; > 0 = left). */
  steer: number;
  /** The storey it stands on (Levels support level). */
  level: number;
  /** Last frame's actual yaw rate (rad/s). */
  yawRate: number;
}

export interface CarControls { forward: boolean; back: boolean; left: boolean; right: boolean; handbrake: boolean }
export const NO_CONTROLS: Readonly<CarControls> = Object.freeze({forward: false, back: false, left: false, right: false, handbrake: false});

export interface CarWorld { levels: Levels; props: PropIndex | null }

/** A contact this frame: the closing speed (m/s), the contact point (world x / z) and the normal out of the obstacle. */
export interface CarImpact { speed: number; x: number; z: number; nx: number; nz: number }

export interface CarStep {
  /** Distance the footprint centre moved (m). */
  moved: number;
  /** Something stopped / deflected the car this frame. */
  blocked: boolean;
  /** A sub-step found no admissible pose (stuck against it). */
  refused: boolean;
  impact: CarImpact | null;
}

const approach = (v: number, to: number, step: number): number => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a <= 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** The front-wheel angle limit at |speed| (rad). */
export function steerMax(speed: number): number {
  const P = CAR_PHYS, k = Math.min(1, Math.abs(speed) / P.forwardMax);
  return P.steerLow + (P.steerHigh - P.steerLow) * k;
}

/**
 * The driver's inputs for one frame: the new speed / wheel angle (written to `b`); returns the yaw rate (rad/s) they ask for. Pure
 * arcade: W while reversing brakes first, S while rolling forward brakes first; nothing held coasts down.
 */
export function updateControls(b: CarBody, ctl: CarControls, dt: number, g: CarGeom): number {
  const P = CAR_PHYS;
  let v = b.v;
  const fwd = ctl.forward && !ctl.back, back = ctl.back && !ctl.forward;
  const drag = P.drag * v * v;
  if (fwd) {
    if (v < -P.stopSpeed) v = approach(v, 0, (P.brake + P.roll + drag) * dt);
    else v += (P.accel * (1 - P.accelTaper * Math.min(1, (Math.max(0, v) / P.forwardMax) ** 2)) - drag) * dt;
  } else if (back) {
    if (v > P.stopSpeed) v = approach(v, 0, (P.brake + P.roll + drag) * dt);
    else v -= (P.reverseAccel - drag) * dt;
  } else v = approach(v, 0, (P.roll + drag) * dt);
  if (ctl.handbrake) v = approach(v, 0, P.handbrake * dt);
  b.v = v = clamp(v, -P.reverseMax, P.forwardMax);
  const lim = steerMax(v);
  const want = ((ctl.left ? 1 : 0) - (ctl.right ? 1 : 0)) * lim;
  const toward = want !== 0 && (b.steer === 0 || Math.sign(want) === Math.sign(b.steer));
  b.steer = clamp(approach(b.steer, want, (toward ? P.steerRate : P.steerReturn) * dt), -lim, lim);
  let rate = (v * Math.tan(b.steer)) / g.wheelBase;
  if (ctl.handbrake && Math.abs(v) > P.handbrakeYawMin) rate *= P.handbrakeYaw;
  return rate;
}

const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

/** The car's floor at one sample: its own storey's grid floor within ±floorTol of y, never a ramp / dynamic volume (null: refused). */
function sampleFloor(L: Levels, x: number, z: number, y: number, level: number): number | null {
  const tol = CAR_PHYS.floorTol;
  const s = L.supportIn(x, z, y, tol);
  if (!s || s.volume || s.level !== level) return null;
  if (Math.abs(s.floor - y) > tol + 1e-6) return null;
  if (L.grid(s.level).rampIdx[s.cell] >= 0) return null;
  return s.floor;
}

/**
 * The floor rule at a pose: every circle's centre + 8 rim points (rim x r) on storey `level` within ±floorTol of y, no ramp cell.
 * Returns the floor under the footprint centre, else null.
 */
export function footprintFloor(L: Levels, x: number, z: number, yaw: number, y: number, level: number, g: Pick<CarSpec, 'circles'>): number | null {
  const centre = sampleFloor(L, x, z, y, level);
  if (centre === null) return null;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  for (const k of g.circles) {
    const cx = x + k.z * s, cz = z + k.z * c, rr = k.r * CAR_PHYS.rim;
    if (sampleFloor(L, cx, cz, y, level) === null) return null;
    for (const [ux, uz] of RIM) if (sampleFloor(L, cx + ux * rr, cz + uz * rr, y, level) === null) return null;
  }
  return centre;
}

interface Settled { x: number; z: number; sx: number; sz: number; circle: number }

/**
 * Settle the rigid body at (x, z, yaw) with feet at y: repeatedly translate it out of its deepest circle contact (resolveCircle per
 * circle: walls / ledges / rails / props at the car's clear height). False when it does not come free in a few iterations (wedged).
 */
export function settlePose(w: CarWorld, g: CarGeom, x: number, z: number, yaw: number, y: number, out: Settled): boolean {
  const s = Math.sin(yaw), c = Math.cos(yaw), H = g.height + CAR_PHYS.clearPad;
  let cx = x, cz = z;
  out.sx = out.sz = 0;
  out.circle = -1;
  for (let it = 0; it < 6; it++) {
    let bx = 0, bz = 0, bd = 0, bi = -1;
    for (let i = 0; i < g.circles.length; i++) {
      const k = g.circles[i], wx = cx + k.z * s, wz = cz + k.z * c;
      const [rx, rz] = resolveCircle(w.levels, w.props, wx, wz, k.r, y, H);
      const px = rx - wx, pz = rz - wz, d = px * px + pz * pz;
      if (d > bd) { bd = d; bx = px; bz = pz; bi = i; }
    }
    if (bd < 1e-12) { out.x = cx; out.z = cz; return true; }
    cx += bx; cz += bz;
    out.sx += bx; out.sz += bz;
    if (out.circle < 0) out.circle = bi;
  }
  return false;
}

interface MoveOut { blocked: boolean; refused: boolean; sx: number; sz: number; circle: number }
const SET: Settled = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};

function tryPose(b: CarBody, w: CarWorld, g: CarGeom, x: number, z: number, yaw: number, out: MoveOut): boolean {
  if (!settlePose(w, g, x, z, yaw, b.y, SET)) return false;
  const f = footprintFloor(w.levels, SET.x, SET.z, yaw, b.y, b.level, g);
  if (f === null) return false;
  if (Math.hypot(SET.sx, SET.sz) > 1e-6) { out.blocked = true; out.sx += SET.sx; out.sz += SET.sz; out.circle = SET.circle; }
  b.x = SET.x; b.z = SET.z; b.yaw = yaw; b.y = f;
  return true;
}

/**
 * Move the car by (dx, dz) and turn it by dyaw (sub-stepped; collision + the floor rule; fallbacks: no turn / turn only / one axis).
 * Updates x / z / y / yaw (never the speed). `out`: blocked (anything deflected it), refused (stopped), the summed push (out of the
 * obstacles) and the circle that took it.
 */
export function moveCar(b: CarBody, w: CarWorld, g: CarGeom, dx: number, dz: number, dyaw: number, out: MoveOut): void {
  out.blocked = out.refused = false;
  out.sx = out.sz = 0;
  out.circle = -1;
  const P = CAR_PHYS, dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(Math.max(dist / P.subStep, Math.abs(dyaw) / P.subYaw)));
  const sx = dx / n, sz = dz / n, sy = dyaw / n;
  for (let k = 0; k < n; k++) {
    if (tryPose(b, w, g, b.x + sx, b.z + sz, b.yaw + sy, out)) continue;
    out.blocked = true;
    if (sy !== 0 && (tryPose(b, w, g, b.x + sx, b.z + sz, b.yaw, out) || (dist > 0 && tryPose(b, w, g, b.x, b.z, b.yaw + sy, out)))) continue;
    if (sx !== 0 && sz !== 0 && (tryPose(b, w, g, b.x + sx, b.z, b.yaw, out) || tryPose(b, w, g, b.x, b.z + sz, b.yaw, out))) continue;
    out.refused = true;
    break;
  }
}

/** The circle leading the motion: the front one going forward, the rear one reversing. */
function leadingCircle(g: CarGeom, v: number): number {
  let best = 0;
  for (let i = 1; i < g.circles.length; i++) if (v >= 0 ? g.circles[i].z < g.circles[best].z : g.circles[i].z > g.circles[best].z) best = i;
  return best;
}

const MV: MoveOut = {blocked: false, refused: false, sx: 0, sz: 0, circle: -1};
const AL: MoveOut = {blocked: false, refused: false, sx: 0, sz: 0, circle: -1};

/**
 * One frame: the driver's inputs -> the speed / wheel angle, the motion (collision + floor rule), the speed from what actually happened,
 * the impact (closing speed into the obstacle, contact point, normal). dt is capped at CAR_PHYS.maxDt.
 */
export function stepCar(b: CarBody, w: CarWorld, g: CarGeom, ctl: CarControls, dt: number, out: CarStep = {moved: 0, blocked: false, refused: false, impact: null}): CarStep {
  out.moved = 0;
  out.blocked = out.refused = false;
  out.impact = null;
  if (!(dt > 0)) return out;
  dt = Math.min(dt, CAR_PHYS.maxDt);
  const rate = updateControls(b, ctl, dt, g);
  const v = b.v;
  if (Math.abs(v) < 1e-5) { b.v = 0; b.yawRate = 0; return out; }
  const mid = b.yaw + (rate * dt) / 2, fx = -Math.sin(mid), fz = -Math.cos(mid);
  const x0 = b.x, z0 = b.z, yaw0 = b.yaw;
  moveCar(b, w, g, fx * v * dt, fz * v * dt, rate * dt, MV);
  const ax = b.x - x0, az = b.z - z0;
  out.moved = Math.hypot(ax, az);
  b.yawRate = wrapAngle(b.yaw - yaw0) / dt;
  if (!MV.blocked) return out;
  out.blocked = true;
  out.refused = MV.refused;
  const P = CAR_PHYS, sg = v >= 0 ? 1 : -1, dx = fx * sg, dz = fz * sg; // (dx, dz): the travel direction
  // glancing: the car slid at a shallow angle to its travel — keep the speed along the slide, turn toward it
  const al = out.moved, tx = al > 1e-5 ? ax / al : 0, tz = al > 1e-5 ? az / al : 0, along = tx * dx + tz * dz;
  let nv: number;
  if (al > 1e-5 && along >= P.glanceCos) {
    nv = v * along * (1 - P.glanceLoss);
    // the yaw that turns the travel direction toward the slide (d/dyaw of the travel = sg · (-cos yaw, sin yaw))
    const turn = Math.sign(sg * (-Math.cos(b.yaw) * tx + Math.sin(b.yaw) * tz)) * Math.min(Math.acos(Math.min(1, along)), P.alignRate * dt);
    if (turn !== 0) { moveCar(b, w, g, 0, 0, turn, AL); b.yawRate = wrapAngle(b.yaw - yaw0) / dt; }
  } else {
    // head-on / stuck: the motion along the new heading — never more than before, never reversed by a push
    const hx = -Math.sin(b.yaw), hz = -Math.cos(b.yaw);
    nv = (ax * hx + az * hz) / dt;
    if (Math.sign(nv) !== Math.sign(v)) nv = 0;
    else if (Math.abs(nv) > Math.abs(v)) nv = v;
  }
  // the contact normal out of the obstacle: the summed push; a floor refusal has none — the part of the travel the edge took (or
  // straight back along it); the closing speed is the velocity against it
  const sl = Math.hypot(MV.sx, MV.sz);
  let nx = -dx, nz = -dz;
  if (sl > 1e-6) { nx = MV.sx / sl; nz = MV.sz / sl; }
  else if (al > 1e-5) {
    const px = dx - along * tx, pz = dz - along * tz, pl = Math.hypot(px, pz);
    if (pl > 1e-6) { nx = -px / pl; nz = -pz / pl; }
  }
  const closing = Math.max(0, -(fx * v * nx + fz * v * nz));
  if (closing > P.bounceMin && Math.abs(nv) < 0.5) nv = -sg * Math.min(P.bounceMax, P.bounce * closing);
  b.v = nv;
  if (closing > 0.05) {
    const k = g.circles[MV.circle >= 0 ? MV.circle : leadingCircle(g, v)];
    const p = carToWorld(b.x, b.z, b.yaw, 0, k.z);
    out.impact = {speed: closing, x: p.x - nx * k.r, z: p.z - nz * k.r, nx, nz};
  }
  return out;
}

/** World centre of circle i of a car at (x, z, yaw). */
export function circleCentre(g: Pick<CarSpec, 'circles'>, x: number, z: number, yaw: number, i: number): {x: number; z: number} {
  const k = g.circles[i];
  return {x: x + k.z * Math.sin(yaw), z: z + k.z * Math.cos(yaw)};
}

/**
 * The nearest body circle to a point: `d` = distance from the circle's surface (< 0 inside), `i` its index, (nx, nz) the unit normal
 * from its centre toward the point, (cx, cz) the centre.
 */
export function nearestCircle(g: Pick<CarSpec, 'circles'>, x: number, z: number, yaw: number, px: number, pz: number): {d: number; i: number; nx: number; nz: number; cx: number; cz: number} {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  let best = {d: Infinity, i: -1, nx: 1, nz: 0, cx: x, cz: z};
  for (let i = 0; i < g.circles.length; i++) {
    const k = g.circles[i], cx = x + k.z * s, cz = z + k.z * c, dx = px - cx, dz = pz - cz, l = Math.hypot(dx, dz), d = l - k.r;
    if (d < best.d) best = {d, i, nx: l > 1e-6 ? dx / l : 1, nz: l > 1e-6 ? dz / l : 0, cx, cz};
  }
  return best;
}
