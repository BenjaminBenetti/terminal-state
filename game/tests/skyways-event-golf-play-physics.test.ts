// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf BALL's arcade physics in the REAL cannon
// world (physics/world.ts PhysicsSystem + physics/dynamicItems.ts + physics/golfBall.ts) on a synthetic lane (tests/helpers/golfPlayCourse.ts:
// 0.5 m turf pieces 6 cm over the floor, a cup piece's real collider gap, 8 cm rails), with real golf-ball pickups:
//  - rolling: a putt rolls v^2 / (2 GOLF_ROLL.decel) — 2.5 m/s rolls 4..6 m — keeps rolling (spin = its ground velocity), stops dead,
//    sleeps and hands back to its pickup at the rest pose on the turf;
//  - the cup: a ball of the right pace drops THROUGH the gap onto the floor (below the turf line: golfBallInCup), settles and stays; a
//    ball put down over the gap drops in; a too-fast ball lips out and rolls on; the capture window is pinned;
//  - rails: off-line putts at the maximum putt speed and at the bullet cap rebound off the 8 cm rails and never cross one (the CCD clamp
//    is engaged); straight on it comes back at ~ the restitution;
//  - two balls click off each other; the player walking into a ball nudges it gently; every run is deterministic.
import {describe, expect, it} from 'vitest';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {DT, HALF, INNER, LANE_Z, ON_TURF, golfLane, golfWorld, puttAndRun, type GolfWorld} from './helpers/golfPlayCourse';
import {GOLF_BALL_R, GOLF_CUP_HALF, GOLF_GREEN_H} from '../src/gen/skyways/events/golfContract';
import {GOLF_ROLL} from '../src/physics/golfBall';
import {MAX_SHOT_DV, type Walker} from '../src/physics/dynamicItems';
import {PHYS_MATS} from '../src/damage/materials';
import {PUTT_POWER} from '../src/weapons/putter';
import type {Pickup} from '../src/world/pickups';

const R = GOLF_BALL_R;
const sphereOf = (w: GolfWorld): CANNON.Body | undefined => w.ph.world?.bodies.find(b => b.shapes[0] instanceof CANNON.Sphere);

describe('rolling on the turf', () => {
  it('a putt rolls v^2 / (2 decel): 2.5 m/s rolls 4..6 m, straight, and stops ON the turf (a tap only a hand span)', () => {
    for (const v of [1, 1.5, 2, 2.5, 3]) {
      const w = golfWorld(), b = w.ball(4.5, LANE_Z);
      const r = puttAndRun(w, b, 1, 0, v);
      const ideal = v * v / (2 * GOLF_ROLL.decel);
      expect(r.dist / ideal, `v ${v}`).toBeGreaterThan(0.92);
      expect(r.dist / ideal, `v ${v}`).toBeLessThan(1.04);
      expect(Math.abs(r.end.z - LANE_Z), `v ${v} stays on its line`).toBeLessThan(1e-3);
      expect(Math.abs(r.end.y - ON_TURF), `v ${v} rests on the turf`).toBeLessThan(1.5e-3);
      expect(w.awake(), `v ${v} at rest`).toBe(0);
      if (v === 2.5) { expect(r.dist).toBeGreaterThan(4); expect(r.dist).toBeLessThan(6); }
    }
    const w = golfWorld(), b = w.ball(4.5, LANE_Z);
    const tap = puttAndRun(w, b, 1, 0, PUTT_POWER.minSpeed);
    expect(tap.dist).toBeGreaterThan(0.05);
    expect(tap.dist).toBeLessThan(0.3);
  });

  it('it ROLLS (spin = its ground velocity / r), stops dead under stopSpeed, sleeps and hands back to its pickup at the rest pose', () => {
    const w = golfWorld(), b = w.ball(4.5, LANE_Z);
    expect(w.ph.dynamicItems.putt(b, 1, 0, 2)).toBe(true);
    w.step(0.5);
    const body = sphereOf(w)!;
    expect(body).toBeDefined();
    expect((body.shapes[0] as CANNON.Sphere).radius).toBeCloseTo(R, 4); // the collider is the model's sphere
    expect(body.mass).toBeCloseTo(0.0459, 6);
    const v = Math.hypot(body.velocity.x, body.velocity.z);
    expect(v).toBeGreaterThan(1.5);
    expect(body.angularVelocity.z).toBeCloseTo(-v / R, 1); // rolling along +x: omega = (up x v) / r
    expect(Math.abs(body.angularVelocity.x)).toBeLessThan(0.05);
    let t = 0;
    while (w.awake() && t < 10) { w.step(DT); t += DT; }
    expect(w.awake()).toBe(0);
    expect(w.ph.world!.bodies.some(x => x.shapes[0] instanceof CANNON.Sphere)).toBe(false); // retired: no body left
    expect(w.pm.list).toContain(b);
    expect(b.obj.parent).toBe(w.pm.group);
    const rest = w.centre(b).clone();
    w.step(3);
    expect(w.centre(b).distanceTo(rest)).toBe(0); // the pickup lies where it stopped
    expect(w.ph.dynamicItems.stats().counts.ballStops).toBeGreaterThanOrEqual(1);
  });
});

describe('the cup: a real gap in the turf colliders, never a decal or a trigger', () => {
  const CUP = 6.25; // 1.75 m from the tee at 4.5

  it('the right pace drops it THROUGH the gap onto the floor (below the turf line), it settles and stays; off-centre by 2 cm too', () => {
    for (const [v, dz] of [[1.6, 0], [1.75, 0], [1.9, 0], [1.75, 0.02], [1.75, -0.02]] as const) {
      const w = golfWorld(golfLane({cupX: CUP})), b = w.ball(4.5, LANE_Z + dz);
      const r = puttAndRun(w, b, 1, 0, v);
      expect(w.inCup(b), `v ${v} dz ${dz}`).toBe(true);
      expect(r.end.y, 'on the floor under the deck').toBeCloseTo(R, 3);
      expect(r.end.y).toBeLessThan(GOLF_GREEN_H - R * 0.5); // below the turf line
      expect(Math.abs(r.end.x - CUP)).toBeLessThanOrEqual(GOLF_CUP_HALF);
      expect(w.awake(), 'settled').toBe(0);
      const at = r.end.clone();
      w.step(5);
      expect(w.centre(b).distanceTo(at), 'stays').toBe(0);
    }
  });

  it('a ball put down over the gap (no pace) drops into the cup; one put down on the turf beside it stays on the turf', () => {
    const w = golfWorld(golfLane({cupX: CUP}));
    const inGap = w.ball(CUP, LANE_Z), beside = w.ball(CUP - 0.15, LANE_Z);
    expect(w.ph.dynamicItems.wakePickup(inGap)).toBe(true);
    expect(w.ph.dynamicItems.wakePickup(beside)).toBe(true);
    w.step(3);
    expect(w.inCup(inGap)).toBe(true);
    expect(w.centre(inGap).y).toBeCloseTo(R, 3);
    expect(w.inCup(beside)).toBe(false);
    expect(w.centre(beside).y).toBeCloseTo(ON_TURF, 3);
  });

  it('too fast lips out: it dips at the gap and rolls on past the cup (pinned capture window)', () => {
    const pattern: string[] = [];
    for (let k = 0; k <= 16; k++) {
      const v = 1.4 + k * 0.1;
      const w = golfWorld(golfLane({cupX: CUP})), b = w.ball(4.5, LANE_Z);
      const r = puttAndRun(w, b, 1, 0, v);
      pattern.push(w.inCup(b) ? 'in' : r.end.x < CUP ? 'short' : 'over');
      if (v >= 2.5) {
        expect(w.inCup(b), `v ${v.toFixed(1)} lips out`).toBe(false);
        expect(r.end.x, `v ${v.toFixed(1)} rolls on`).toBeGreaterThan(CUP + 0.5);
        expect(Math.min(...r.track.map(p => p.y)), 'it dipped at the gap').toBeLessThan(ON_TURF - 0.004);
        expect(r.end.y).toBeCloseTo(ON_TURF, 3); // back on the turf
      }
    }
    // 1.4 m/s stops short; 1.5 .. 2.1 m/s (arriving at ~0.3 .. 1.5 m/s) drop; from 2.5 m/s (arriving ~2 m/s) it never does
    expect(pattern.slice(0, 8)).toEqual(['short', 'in', 'in', 'in', 'in', 'in', 'in', 'in']);
    expect(pattern.slice(11)).toEqual(['over', 'over', 'over', 'over', 'over', 'over']);
  });
});

describe('rails: rebound without tunnelling', () => {
  it('off-line putts at the maximum putt speed and at the bullet cap rebound off the 8 cm rails and never cross one (CCD engaged)', () => {
    let ccd = 0;
    for (const v of [PUTT_POWER.maxSpeed, MAX_SHOT_DV]) {
      for (const a of [0.35, 0.6, 0.9, 1.25]) {
        const w = golfWorld(), b = w.ball(4.5, LANE_Z);
        const r = puttAndRun(w, b, Math.cos(a), Math.sin(a), v, 12);
        const deepest = Math.max(...r.track.map(p => Math.abs(p.z - LANE_Z)));
        expect(deepest, `v ${v} a ${a}: the centre never reaches a rail face`).toBeLessThan(HALF);
        expect(deepest, `v ${v} a ${a}: it did reach the rail`).toBeGreaterThan(INNER - 1e-3);
        expect(Math.abs(r.end.z - LANE_Z)).toBeLessThanOrEqual(INNER + 1e-3); // ends inside the lane
        expect(r.end.y).toBeCloseTo(ON_TURF, 3);
        // it came back: z turned round at the first rail
        const zs = r.track.map(p => p.z - LANE_Z), turn = zs.findIndex((z, i) => i > 0 && Math.sign(zs[i] - zs[i - 1]) < 0);
        expect(turn, `v ${v} a ${a} rebounds`).toBeGreaterThan(0);
        ccd += w.ph.dynamicItems.stats().counts.ballCcd;
      }
    }
    expect(ccd).toBeGreaterThan(0);
  });

  it('straight into a rail at the maximum putt speed it comes back at ~ the restitution', () => {
    const w = golfWorld(), b = w.ball(4.5, LANE_Z);
    expect(w.ph.dynamicItems.putt(b, 0, 1, PUTT_POWER.maxSpeed)).toBe(true);
    let before = 0, after = 0, maxZ = 0;
    for (let i = 0; i < 40; i++) {
      w.ph.update(DT);
      const body = sphereOf(w)!;
      maxZ = Math.max(maxZ, body.position.z - LANE_Z);
      if (body.velocity.z > 0) before = body.velocity.z;
      else if (!after) after = -body.velocity.z;
    }
    expect(maxZ).toBeLessThan(HALF);
    expect(after / before).toBeGreaterThan(PHYS_MATS.ball.restitution - 0.12);
    expect(after / before).toBeLessThan(PHYS_MATS.ball.restitution + 0.12);
    expect(w.ph.dynamicItems.stats().counts.ballCcd).toBeGreaterThan(0);
  });

  it('a long putt comes back off the far end rail and stays on the lane', () => {
    const w = golfWorld(golfLane({len: 4})), b = w.ball(4.5, LANE_Z);
    const r = puttAndRun(w, b, 1, 0, PUTT_POWER.maxSpeed);
    expect(Math.max(...r.track.map(p => p.x))).toBeLessThan(8 - R + 1e-3 + R * 0.5);
    expect(r.end.x).toBeLessThan(8 - R);
    expect(r.end.x).toBeGreaterThan(4);
    expect(r.end.y).toBeCloseTo(ON_TURF, 3);
  });
});

describe('two balls, the walk nudge, determinism', () => {
  it('a rolling ball knocks a resting one on (it wakes and rolls away); both stay on the turf, none lost or added', () => {
    const w = golfWorld(), a = w.ball(4.5, LANE_Z), b = w.ball(6, LANE_Z);
    const b0 = w.centre(b).clone();
    puttAndRun(w, a, 1, 0, 2);
    expect(w.centre(b).x - b0.x).toBeGreaterThan(0.5);
    expect(w.centre(a).x).toBeLessThan(w.centre(b).x);
    for (const p of [a, b]) expect(w.centre(p).y).toBeCloseTo(ON_TURF, 3);
    expect(w.pm.list.length).toBe(2);
  });

  it('the player walking into a ball nudges it ahead gently (at most GOLF_ROLL.nudgeMax); a walker beside or behind it does not', () => {
    const w = golfWorld(), b = w.ball(6, LANE_Z), side = w.ball(6, LANE_Z + 3);
    const player: Walker = {id: {}, x: 5.2, z: LANE_Z, y: 0, r: 0.3, wake: true};
    w.ph.dynamicItems.walkers = () => [player];
    let maxV = 0;
    for (let i = 0; i < 60; i++) {
      player.x += 1.5 * DT; // walking at 1.5 m/s along +x
      w.ph.update(DT);
      const body = sphereOf(w);
      if (body) maxV = Math.max(maxV, Math.hypot(body.velocity.x, body.velocity.z));
    }
    w.step(6);
    expect(w.ph.dynamicItems.stats().counts.nudges).toBeGreaterThan(0);
    expect(w.ph.dynamicItems.stats().counts.putts).toBe(0);
    expect(w.centre(b).x).toBeGreaterThan(6.4);
    expect(maxV).toBeLessThanOrEqual(GOLF_ROLL.nudgeMax + 1e-6);
    expect(w.centre(side).distanceTo(new THREE.Vector3(6, ON_TURF, LANE_Z + 3))).toBeLessThan(1e-6); // never touched
  });

  it('deterministic: the same putts in a fresh world end bit-for-bit at the same poses', () => {
    const run = () => {
      const w = golfWorld(golfLane({cupX: 6.25})), balls: Pickup[] = [w.ball(4.5, LANE_Z), w.ball(4.6, LANE_Z + 0.12)];
      w.ph.dynamicItems.putt(balls[0], 1, 0.04, 1.8);
      w.step(0.4);
      w.ph.dynamicItems.putt(balls[1], 1, -0.3, PUTT_POWER.maxSpeed);
      w.step(14);
      return balls.map(p => [...p.obj.position.toArray(), ...p.obj.quaternion.toArray()]);
    };
    expect(run()).toEqual(run());
  });
});
