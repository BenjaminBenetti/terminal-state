// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf BALL's arcade physics — a loose item
// (physics/dynamicItems.ts: one golf_ball pickup = one bounded, lazily created, sleeping cannon SPHERE) with three additions stepped in
// the world's preStep (after the solver, before the integration: physics/world.ts build):
//  - ROLLING RESISTANCE: while the ball touches a floor-like surface (a contact normal mostly up) its ground speed drops by a constant
//    GOLF_ROLL.decel (the turf's drag; cannon's friction alone keeps a rolling sphere going for ever). Its spin always follows the ground
//    velocity (arcade: it rolls without slipping, so a rail rebound keeps the solver's restitution instead of skidding to a crawl); under
//    stopSpeed it stops dead and the body sleeps / retires like any loose item.
//    A constant drag makes the roll distance v^2 / (2 decel): a 2.5 m/s putt rolls ~5 m.
//  - CCD: at putt speeds a 42.7 mm ball moves up to ~8 cm per 1/60 s step — the depth of a course rail — so its centre could end past
//    a rail's middle and be pushed out on the far side; even a shallow overlap at the seam of two rail pieces makes the next piece's END
//    face a "ghost" contact that throws the ball back along the lane. Before each step a moving ball sweeps its sphere along this step's
//    motion against the axis-aligned static boxes it can collide with (each box grown by the radius less GOLF_ROLL.ccdSlop: a ray test)
//    and, if it would sink more than ccdSlop into one, integrates only that far (its velocity is restored right after the integration):
//    the next step's contact then rebounds it with the solver's restitution, never deeper than a millimetre. Landing on a box TOP may sink
//    GOLF_ROLL.ccdTopSink (a slow drop / bounce is the solver's normal resting contact: clamping it to a millimetre each step would keep
//    a dropped ball hopping for ever). The turf it rolls on (the solver keeps it well under a millimetre deep) and the next turf piece at a
//    seam are never "hit". Nothing is teleported; the ball only loses a fraction of one step's travel at a rail.
//  - the CUP: nothing special — a cup is a real gap in the turf's collider boxes (gen/skyways/events/golfContract.ts golfColliderBoxes):
//    a slow ball drops through it onto the floor GOLF_GREEN_H below and settles there (below the turf line: golfBallInCup), a fast one
//    rolls over the gap / off the far lip.
// Pure data + cannon helpers (no game state).
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GOLF_BALL_ITEM, GOLF_BALL_R, golfColliderBoxes} from '../gen/skyways/events/golfContract';
import type {PropPlacement} from '../gen/props';
import {GROUP_CHUNK, GROUP_STATIC} from './ragdoll';

/** The ball's arcade physics constants (measured in tests/skyways-event-golf-play-physics.test.ts). */
export const GOLF_ROLL = {
  /** Rolling resistance on a surface (m/s^2): the roll distance is v^2 / (2 decel) — 2.5 m/s rolls ~5 m. */
  decel: 0.62,
  /** Below this ground speed (m/s) a ball on a surface stops dead (no endless creep). */
  stopSpeed: 0.04,
  /** Spin about the vertical axis dies on the turf (fraction per second). */
  ySpinDamp: 4,
  /** Body damping (air drag: next to none; the turf drag is `decel`). */
  linearDamping: 0.01,
  angularDamping: 0.01,
  /** A contact normal with |n.y| above this is a floor under the ball (rolling resistance applies). */
  groundNormal: 0.7,
  /** CCD: a ball sinks at most this far (m) into the side of what lies ahead in one step (a contact for the solver's rebound, no deeper). */
  ccdSlop: 0.001,
  /** CCD: ... and at most this far (m) into a box top it lands on (a drop into a cup: the solver settles that resting contact itself). */
  ccdTopSink: 0.006,
  /** CCD runs for a ball moving more than this per step (m). */
  ccdMin: 0.002,
  /** Cannon sleep (a stopped ball sleeps at once; the loose-item retirement then hands it back to its pickup). */
  sleepSpeedLimit: 0.03,
  sleepTimeLimit: 0.3,
  /** The player walking into a ball nudges it ahead at ~their speed, at most this (m/s: it rolls ~2 m). */
  nudgeMax: 1.6,
  /** Ball vs ball (two balls on the course): a hard click, no friction (as vs the course: damage/materials.ts PHYS_MATS.ball). */
  ballFriction: 0,
  ballRestitution: 0.8,
} as const;

export const isGolfBallItem = (itemId: string | null | undefined): boolean => itemId === GOLF_BALL_ITEM;

/** The ball's centre from its pickup object (model frame: origin at the bottom of the ball, rotated with the body). */
export function golfBallCentre(obj: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, GOLF_BALL_R, 0).applyQuaternion(obj.quaternion).add(obj.position);
}

/**
 * The height a golf ball put down at (x, z) near height y (a drop on the player's floor) rests at: the top of a mini-golf turf box under it
 * (golfColliderBoxes: never inside the 6 cm deck / 11 cm tier — over a cup's gap that is the floor, i.e. in the cup; never on a taller
 * obstacle's top), else y. One pass over `props` (a drop is a one-off event).
 */
export function golfRestY(props: readonly PropPlacement[], x: number, z: number, y: number): number {
  let best = y;
  for (const p of props) {
    if (Math.abs(x - p.x) > p.hx || Math.abs(z - p.z) > p.hz) continue;
    const boxes = golfColliderBoxes(p);
    if (boxes) for (const b of boxes) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.y1 > best && b.y0 < y + 0.05 && b.y1 <= y + 0.15) best = b.y1;
  }
  return best;
}

/** Rolling-without-slipping spin (rad/s) for a ground velocity (vx, vz) of a ball of radius r: omega = (up x v) / r. */
export function rollingSpin(vx: number, vz: number, r: number, out = new CANNON.Vec3()): CANNON.Vec3 {
  return out.set(vz / r, 0, -vx / r);
}

const SWEEP_MASK = GROUP_STATIC | GROUP_CHUNK;
const sweepBox = new CANNON.AABB(), near: CANNON.Body[] = [];

/**
 * How far (m, along this step's motion (ex, ey, ez) * dt) a sphere of centre p can move before it sinks into an axis-aligned static box it
 * collides with — through a side / the bottom deeper than its radius less `g`, through the top deeper than its radius less `gTop` (each
 * box grown by those) — or Infinity. A box it is already in that deep (a rail it leans on, the rounded lip of a cup it rides, the turf
 * under a ball just landed) is left to the solver.
 */
function sweepTouch(world: CANNON.World, self: CANNON.Body, p: CANNON.Vec3, ex: number, ey: number, ez: number, dt: number, g: number, gTop: number): number {
  const dx = ex * dt, dy = ey * dt, dz = ez * dt, len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return Infinity;
  sweepBox.lowerBound.set(Math.min(p.x, p.x + dx) - g, Math.min(p.y, p.y + dy) - g, Math.min(p.z, p.z + dz) - g);
  sweepBox.upperBound.set(Math.max(p.x, p.x + dx) + g, Math.max(p.y, p.y + dy) + g, Math.max(p.z, p.z + dz) + g);
  near.length = 0;
  world.broadphase.aabbQuery(world, sweepBox, near);
  let best = Infinity;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  for (const o of near) {
    if (o === self || o.type !== CANNON.Body.STATIC || !(o.collisionFilterGroup & SWEEP_MASK) || !(o.collisionFilterMask & self.collisionFilterGroup) || !(self.collisionFilterMask & o.collisionFilterGroup)) continue;
    if (o.shapes.length !== 1 || !(o.shapes[0] instanceof CANNON.Box) || Math.abs(Math.abs(o.quaternion.w) - 1) > 1e-6) continue;
    const he = (o.shapes[0] as CANNON.Box).halfExtents, off = o.shapeOffsets[0], c = o.position;
    // the box grown by g (its rounded edges counted square: a touch found there is early, never late)
    const x0 = c.x + off.x - he.x - g, x1 = c.x + off.x + he.x + g, y0 = c.y + off.y - he.y - g, y1 = c.y + off.y + he.y + gTop, z0 = c.z + off.z - he.z - g, z1 = c.z + off.z + he.z + g;
    const e = 1e-5;
    if (p.x >= x0 - e && p.x <= x1 + e && p.y >= y0 - e && p.y <= y1 + e && p.z >= z0 - e && p.z <= z1 + e) continue; // in it already: the solver's
    const t = slabEntry(p.x, p.y, p.z, ux, uy, uz, len, x0, x1, y0, y1, z0, z1);
    if (t < best) best = t;
  }
  return best;
}

/** Entry distance (0..len) of the ray p + u s into the box [x0, x1] x [y0, y1] x [z0, z1], or Infinity. */
function slabEntry(px: number, py: number, pz: number, ux: number, uy: number, uz: number, len: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): number {
  let t0 = 0, t1 = len;
  const axis = (a: number, u: number, lo: number, hi: number): boolean => {
    if (Math.abs(u) < 1e-12) return a > lo && a < hi;
    let ta = (lo - a) / u, tb = (hi - a) / u;
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    return t0 <= t1;
  };
  if (!axis(px, ux, x0, x1) || !axis(py, uy, y0, y1) || !axis(pz, uz, z0, z1)) return Infinity;
  return t0;
}

/**
 * One world step's ball pass (call from the world's preStep: velocities are the solver's, the integration is next). `balls` = the
 * simulating ball bodies; `grounded` = those touching a floor-like surface this step (groundedBalls). `clamped` receives the bodies whose
 * velocity was clamped for this integration, with the velocity to restore after it (restoreClamped).
 */
export function stepGolfBalls(world: CANNON.World, balls: readonly CANNON.Body[], grounded: ReadonlySet<CANNON.Body>, dt: number, clamped: Map<CANNON.Body, CANNON.Vec3>, counts?: {ballCcd: number; ballStops: number}): void {
  const G = GOLF_ROLL;
  for (const b of balls) {
    if (b.type !== CANNON.Body.DYNAMIC || b.sleepState === CANNON.Body.SLEEPING) continue;
    const r = radiusOf(b);
    const v = b.velocity, w = b.angularVelocity;
    // the integration adds force / mass * dt (gravity) to this velocity before moving the body: the solver's velocity of a ball resting
    // on the turf points UP by g dt (it cancels that), so the motion this step is v + a dt
    const ax = b.force.x * b.invMass * dt, ay = b.force.y * b.invMass * dt, az = b.force.z * b.invMass * dt;
    if (grounded.has(b)) {
      const h = Math.hypot(v.x + ax, v.z + az);
      if (h < G.stopSpeed && Math.abs(v.y + ay) < 0.05) {
        if (counts && (h > 0 || w.lengthSquared() > 0)) counts.ballStops++;
        v.x = -ax; v.z = -az; w.setZero();
      } else {
        const k = h > 0 ? Math.max(0, h - G.decel * dt) / h : 0, wy = w.y * Math.max(0, 1 - G.ySpinDamp * dt); // (h 0: a straight drop)
        v.x = (v.x + ax) * k - ax; v.z = (v.z + az) * k - az;
        // arcade: on the turf it always ROLLS (no skid): the spin follows the ground velocity — so a rail rebound leaves at once at the
        // solver's restitution (a skidding sphere's forward spin would brake it to a crawl: v' = (2 - 5e) / 7 v)
        rollingSpin(v.x + ax, v.z + az, r, w);
        w.y = wy;
      }
    }
    // CCD: sweep this step's motion against the static boxes; stop where it would sink ccdSlop (a top: ccdTopSink) into the first one
    const ex = v.x + ax, ey = v.y + ay, ez = v.z + az, sp = Math.hypot(ex, ey, ez), travel = sp * dt;
    if (travel <= G.ccdMin) continue;
    const touch = sweepTouch(world, b, b.position, ex, ey, ez, dt, r - G.ccdSlop, r - G.ccdTopSink);
    if (touch >= travel) continue;
    // this integration moves it only that far along the same line; afterwards it has its full motion back (restoreClamped)
    clamped.set(b, new CANNON.Vec3(ex, ey, ez));
    const s = Math.max(0, touch) / travel;
    v.set(ex * s - ax, ey * s - ay, ez * s - az);
    if (counts) counts.ballCcd++;
  }
}

/** After the integration (postStep): the clamped balls get their real (post-integration) velocity back (the next step's contact rebounds them). */
export function restoreClamped(clamped: Map<CANNON.Body, CANNON.Vec3>): void {
  for (const [b, v] of clamped) b.velocity.copy(v);
  clamped.clear();
}

/** The ball bodies of `balls` touching a floor-like surface in the world's current contacts (narrowphase of this step). */
export function groundedBalls(world: CANNON.World, balls: ReadonlySet<CANNON.Body>, out: Set<CANNON.Body>): Set<CANNON.Body> {
  out.clear();
  if (!balls.size) return out;
  const k = GOLF_ROLL.groundNormal;
  for (const c of world.contacts) {
    // ni points out of bi: a floor (bi) under the ball (bj) has ni up; the ball as bi has ni down into the floor
    if (balls.has(c.bj) && c.ni.y > k) out.add(c.bj);
    else if (balls.has(c.bi) && c.ni.y < -k) out.add(c.bi);
  }
  return out;
}

function radiusOf(b: CANNON.Body): number {
  const s = b.shapes[0];
  return s instanceof CANNON.Sphere ? s.radius : GOLF_BALL_R;
}
