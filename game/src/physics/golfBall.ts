// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf BALL's arcade physics — a loose item
// (physics/dynamicItems.ts: one golf_ball pickup = one bounded, lazily created, sleeping cannon SPHERE) with three additions stepped in
// the world's preStep (after the solver, before the integration: physics/world.ts build):
//  - ROLLING RESISTANCE: while the ball touches a floor-like surface (a contact normal mostly up) its ground speed drops by a constant
//    GOLF_ROLL.decel (the turf's drag; cannon's friction alone keeps a rolling sphere going for ever). Its spin always follows the ground
//    velocity (arcade: it rolls without slipping, so a rail rebound keeps the solver's restitution instead of skidding to a crawl); under
//    stopSpeed it stops dead and the body sleeps / retires like any loose item.
//    A constant drag makes the roll distance v^2 / (2 decel): a 2.5 m/s putt rolls ~5 m.
//  - CCD: at putt speeds a 42.7 mm ball moves up to ~8 cm per 1/60 s step — the depth of a course rail — so its centre could end past
//    a rail's middle and be pushed out on the far side. Before each step a moving ball casts its centre line (cannon raycast vs the
//    statics) and, if this step would carry its centre deeper than GOLF_ROLL.ccdKeep of a radius into what lies ahead, it integrates
//    only that far (its velocity is restored right after the integration): the next step's contact then rebounds it with the solver's
//    restitution. Nothing is teleported; the ball only loses a fraction of one step's travel.
//  - the CUP: nothing special — a cup is a real gap in the turf's collider boxes (gen/skyways/events/golfContract.ts golfColliderBoxes):
//    a slow ball drops through it onto the floor GOLF_GREEN_H below and settles there (below the turf line: golfBallInCup), a fast one
//    rolls over the gap / off the far lip.
// Pure data + cannon helpers (no game state).
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {GOLF_BALL_ITEM, GOLF_BALL_R, golfColliderBoxes} from '../gen/skyways/events/golfContract';
import type {PropPlacement} from '../gen/props';
import {GROUP_CHUNK, GROUP_ITEM, GROUP_STATIC} from './ragdoll';

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
  /** CCD: per step the centre may end at most this share of a radius inside what lies ahead (the solver resolves that shallow depth). */
  ccdKeep: 0.5,
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

const RAY_OPTS = {collisionFilterGroup: GROUP_ITEM, collisionFilterMask: GROUP_STATIC | GROUP_CHUNK, skipBackfaces: true};
const ray = new CANNON.RaycastResult(), from = new CANNON.Vec3(), to = new CANNON.Vec3();

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
        const k = Math.max(0, h - G.decel * dt) / h, wy = w.y * Math.max(0, 1 - G.ySpinDamp * dt);
        v.x = (v.x + ax) * k - ax; v.z = (v.z + az) * k - az;
        // arcade: on the turf it always ROLLS (no skid): the spin follows the ground velocity — so a rail rebound leaves at once at the
        // solver's restitution (a skidding sphere's forward spin would brake it to a crawl: v' = (2 - 5e) / 7 v)
        rollingSpin(v.x + ax, v.z + az, r, w);
        w.y = wy;
      }
    }
    // CCD along the centre line of this step's motion
    const ex = v.x + ax, ey = v.y + ay, ez = v.z + az, sp = Math.hypot(ex, ey, ez), travel = sp * dt;
    if (travel <= r * G.ccdKeep) continue;
    const p = b.position;
    from.set(p.x, p.y, p.z);
    const reach = (travel + r) / sp;
    to.set(p.x + ex * reach, p.y + ey * reach, p.z + ez * reach);
    ray.reset();
    if (!world.raycastClosest(from, to, RAY_OPTS, ray) || !ray.hasHit) continue;
    const allowed = Math.max(0, ray.distance - r * G.ccdKeep);
    if (allowed >= travel) continue;
    // this integration moves it only `allowed` along the same line; afterwards it has its full motion back (restoreClamped)
    clamped.set(b, new CANNON.Vec3(ex, ey, ez));
    const s = allowed / travel;
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
