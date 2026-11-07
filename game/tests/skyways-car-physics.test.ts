// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's arcade kinematics (world/skywaysCarPhysics.ts) on a hand-built hall
// (tests/helpers/skywaysCarWorld.ts): acceleration / top speed, braking then reversing, the reverse cap, coasting, the handbrake,
// steering (left is +yaw, the wheel-angle limit falls with speed), and the world: walls stop it (never inside a wall, an impact
// reported with the right normal), a glancing wall slides it, a railing / a low soffit / a prop stop it, drops / another storey are
// refused by the floor rule (the footprint never leaves its storey's floor; ramps: only while the axle rule holds — task skyways-vehicle).
import {describe, expect, it} from 'vitest';
import {CAR_PHYS, CAR_STAIRS, NO_CONTROLS, footprintFloor, nearestCircle, stepCar, steerMax, type CarBody, type CarControls, type CarWorld} from '../src/world/skywaysCarPhysics';
import {CAR_SPEC, carToWorld, worldToCar} from '../src/world/skywaysCarSpec';
import {HALL, hallLevels, prop, propIndex} from './helpers/skywaysCarWorld';

const DT = 1 / 60;
const G = CAR_SPEC;
const ctl = (o: Partial<CarControls>): CarControls => ({...NO_CONTROLS, ...o});
/** A car at (x, z) heading `yaw` (0 = -Z), at rest on storey 0. */
const car = (x: number, z: number, yaw = 0, v = 0): CarBody => ({x, y: 0, z, yaw, v, steer: 0, level: 0, yawRate: 0});
const run = (b: CarBody, w: CarWorld, c: CarControls, seconds: number, each?: (t: number) => void): void => {
  for (let t = 0; t < seconds - 1e-9; t += DT) { stepCar(b, w, G, c, DT); each?.(t); }
};
/** The body circles' nearest approach to a vertical plane x = px (signed: > 0 = on the low-x side). */
const clearOfX = (b: CarBody, px: number) => Math.min(...G.circles.map((k, i) => px - (carToWorld(b.x, b.z, b.yaw, 0, k.z).x + G.circles[i].r)));

describe('skyways car kinematics (open floor)', () => {
  const levels = hallLevels();
  const w: CarWorld = {levels, props: null};

  it('accelerates ~7 m/s² from rest, tapering to the 15 m/s cap; W from reverse brakes first', () => {
    const b = car(26, 26, Math.PI / 2); // heading -X (west) across the hall
    stepCar(b, w, G, ctl({forward: true}), DT);
    expect(b.v).toBeCloseTo(CAR_PHYS.accel * DT, 3);
    run(b, w, ctl({forward: true}), 1 - DT);
    expect(b.v).toBeGreaterThan(6.4);
    expect(b.v).toBeLessThan(7.01);
    const fast = car(6, 15, -Math.PI / 2, 14.9); // heading +X, nearly at the cap
    run(fast, w, ctl({forward: true}), 0.5);
    expect(fast.v).toBe(CAR_PHYS.forwardMax);
    // reversing at 4 m/s, W: braking (fast), then forward
    const r = car(15, 15, 0, -4);
    stepCar(r, w, G, ctl({forward: true}), DT);
    expect(r.v).toBeGreaterThan(-4 + (CAR_PHYS.brake - 1e-6) * DT);
    run(r, w, ctl({forward: true}), 0.5);
    expect(r.v).toBeGreaterThan(0);
  });

  it('S brakes (14 m/s²) to a stop, then reverses up to 5 m/s; coasting and the handbrake slow it', () => {
    const b = car(4, 15, -Math.PI / 2, 15); // heading +X down the hall
    let t = 0;
    while (b.v > 0 && t < 3) { stepCar(b, w, G, ctl({back: true}), DT); t += DT; }
    expect(t).toBeLessThan(15 / CAR_PHYS.brake + 0.05);
    expect(t).toBeGreaterThan(15 / (CAR_PHYS.brake + 4) - 0.05);
    expect(b.x).toBeLessThan(4 + 15 * 15 / (2 * CAR_PHYS.brake) + 0.3); // ~8 m to stop from 15 m/s
    const r = car(15, 18, Math.PI / 2); // at rest heading west: S reverses (east) up to the cap
    run(r, w, ctl({back: true}), 1.6);
    expect(r.v).toBe(-CAR_PHYS.reverseMax);
    expect(r.x).toBeGreaterThan(17);
    const coast = car(6, 15, -Math.PI / 2, 10), hb = car(6, 12, -Math.PI / 2, 10);
    run(coast, w, NO_CONTROLS, 1);
    run(hb, w, ctl({handbrake: true}), 1);
    expect(coast.v).toBeLessThan(10 - CAR_PHYS.roll);
    expect(coast.v).toBeGreaterThan(7);
    expect(hb.v).toBeLessThan(coast.v - CAR_PHYS.handbrake * 0.9);
  });

  it('steers: A turns left (+yaw), the wheel-angle limit falls with speed, reversing turns the other way', () => {
    expect(steerMax(0)).toBeCloseTo(CAR_PHYS.steerLow, 9);
    expect(steerMax(15)).toBeCloseTo(CAR_PHYS.steerHigh, 9);
    expect(steerMax(7.5)).toBeLessThan(steerMax(2));
    const b = car(20, 25, 0, 4); // heading -Z (north)
    run(b, w, ctl({forward: true, left: true}), 0.8);
    expect(b.yaw).toBeGreaterThan(0.4);
    expect(b.x).toBeLessThan(20 - 0.3); // drifted west = to the left of north
    expect(Math.abs(b.steer)).toBeLessThanOrEqual(steerMax(b.v) + 1e-9);
    // the low-speed turning circle is tight (~ wheelBase / tan(steerLow)), the fast one wide
    const slow = car(20, 15, 0, 3), quick = car(20, 15, 0, 14);
    for (const c of [slow, quick]) { c.steer = steerMax(c.v); stepCar(c, w, G, ctl({left: true, forward: true}), DT); }
    const R = (c: CarBody) => Math.abs(c.v / c.yawRate);
    expect(R(slow)).toBeLessThan(G.wheelBase / Math.tan(steerMax(3)) * 1.05);
    expect(R(slow)).toBeLessThan(6);
    expect(R(quick)).toBeGreaterThan(R(slow) * 2.5); // ~15 m at 14 m/s vs ~5 m at 3 m/s
    // reversing with left lock: the nose swings right (-yaw)
    const rev = car(20, 15, 0, -3);
    run(rev, w, ctl({back: true, left: true}), 0.5);
    expect(rev.yaw).toBeLessThan(-0.1);
    // the handbrake sharpens a fast turn
    const a = car(20, 20, 0, 10), h = car(20, 20, 0, 10);
    a.steer = h.steer = 0.15;
    stepCar(a, w, G, ctl({left: true}), DT);
    stepCar(h, w, G, ctl({left: true, handbrake: true}), DT);
    expect(h.yawRate).toBeGreaterThan(a.yawRate * 1.3);
  });

  it('car frame <-> world: the nose is -Z at yaw 0, the driver (x < 0) on the left', () => {
    const p = carToWorld(10, 10, 0, 0, -2);
    expect(p).toEqual({x: 10, z: 8});
    const q = carToWorld(10, 10, Math.PI / 2, 0, -2); // heading -X
    expect(q.x).toBeCloseTo(8, 9);
    expect(q.z).toBeCloseTo(10, 9);
    const wp = carToWorld(10, 10, 0.7, -0.4, 1.3), back = worldToCar(10, 10, 0.7, wp.x, wp.z);
    expect(back.x).toBeCloseTo(-0.4, 9);
    expect(back.z).toBeCloseTo(1.3, 9);
    expect(G.eye.x).toBeLessThan(0);
    expect(G.exits.left.x).toBeLessThan(0);
  });
});

describe('skyways car vs the world (walls, rails, props, floor rule)', () => {
  const levels = hallLevels();

  it('a wall met head-on stops it (never inside the wall), with the impact speed and the normal out of the wall', () => {
    const w: CarWorld = {levels, props: null};
    const b = car(15, 10, 0, 15); // heading -Z (north) toward the north wall's inner face z = 0.5
    let impact = 0, nz = 0;
    for (let t = 0; t < 2; t += DT) {
      const r = stepCar(b, w, G, ctl({forward: true}), DT);
      if (r.impact && r.impact.speed > impact) { impact = r.impact.speed; nz = r.impact.nz; }
      const front = carToWorld(b.x, b.z, b.yaw, 0, G.circles[0].z);
      expect(front.z - G.circles[0].r).toBeGreaterThanOrEqual(HALL.wall - 1e-6);
    }
    expect(impact).toBeGreaterThan(8); // it was going fast when it met the wall
    expect(nz).toBeGreaterThan(0.99); // out of the north wall = +Z
    expect(Math.abs(b.v)).toBeLessThan(CAR_PHYS.bounceMax + 1e-9);
    const front = carToWorld(b.x, b.z, b.yaw, 0, G.circles[0].z);
    expect(front.z - G.circles[0].r).toBeLessThan(HALL.wall + 0.3);
  });

  it('a glancing wall slides it along (keeps much of its speed), never through', () => {
    const w: CarWorld = {levels, props: null};
    const b = car(6, 26.5, -Math.PI / 2 - 0.35, 12); // heading east, 20° toward the south wall (inner face z = 29.5)
    const south = HALL.d - HALL.wall;
    let minClear = Infinity, slid = false;
    for (let t = 0; t < 1.2; t += DT) {
      const r = stepCar(b, w, G, NO_CONTROLS, DT);
      if (r.blocked && b.v > 5) slid = true;
      for (const k of G.circles) minClear = Math.min(minClear, south - (carToWorld(b.x, b.z, b.yaw, 0, k.z).z + k.r));
    }
    expect(slid).toBe(true);
    expect(minClear).toBeGreaterThanOrEqual(-1e-6);
    expect(b.v).toBeGreaterThan(6); // most of its speed kept
    expect(b.x).toBeGreaterThan(14); // carried on east along the wall
    expect(Math.abs(Math.sin(b.yaw + Math.PI / 2))).toBeLessThan(0.05); // turned to run along it
  });

  it('the railing stops it at deck height (it never crosses x = 20 m between z 2..10 m)', () => {
    const w: CarWorld = {levels, props: null};
    const b = car(14, 6, -Math.PI / 2, 10); // heading +X at the rail
    run(b, w, ctl({forward: true}), 2);
    expect(clearOfX(b, HALL.rail.x)).toBeGreaterThanOrEqual(-0.04); // the rail's half thickness
    expect(b.x).toBeLessThan(HALL.rail.x);
    expect(b.x).toBeGreaterThan(HALL.rail.x - 3.5);
  });

  it('a low soffit (1.2 m) and a counter-sized prop stop it; a prop under the floor plane / overhead does not', () => {
    const w: CarWorld = {levels, props: null};
    const s = car((HALL.soffit.x0 + HALL.soffit.x1) / 2, 12, 0, 8); // heading north into the soffit's south edge (z = 4), head-on
    // (lane CAR2: the measured car's 1.09 m circles) no body circle ever gets under it; pressing on, the car may slide along its edge
    let deepest = Infinity;
    run(s, w, ctl({forward: true}), 2, () => {
      for (const k of G.circles) {
        const c = carToWorld(s.x, s.z, s.yaw, 0, k.z), S = HALL.soffit;
        deepest = Math.min(deepest, Math.hypot(Math.max(S.x0 - c.x, 0, c.x - S.x1), Math.max(S.z0 - c.z, 0, c.z - S.z1)) - k.r);
      }
    });
    expect(deepest).toBeGreaterThan(-0.02);
    expect(deepest).toBeLessThan(0.05); // (it did reach it)
    const counter = prop('shopCounter', 15, 6, 1.5, 0.4, 0.95);
    const high = prop('sign', 25, 6, 1.5, 0.4, 0.3, 2.2); // hanging above the roof
    const wp: CarWorld = {levels, props: propIndex(levels, [counter, high])};
    const b = car(15, 14, 0, 10);
    run(b, wp, ctl({forward: true}), 2);
    const n = nearestCircle(G, b.x, b.z, b.yaw, 15, 6.4);
    expect(b.z).toBeGreaterThan(6.4 + 0.9); // stopped at the counter's south face
    expect(n.d).toBeGreaterThan(-0.02);
    const c = car(25, 14, 0, 10);
    run(c, wp, ctl({forward: true}), 1);
    expect(c.z).toBeLessThan(6); // drove under the sign
  });

  it('the floor rule: onto a ramp only while it holds (never over an open side / the end drop), never over the drop, never onto another storey', () => {
    const w: CarWorld = {levels, props: null};
    // the ramp's foot (z = 20) from the north, heading south (+Z: yaw PI). Task skyways-vehicle-20261107 (user: "drive up / down
    // stairs"): the car now takes ramps (was: refused outright) — this hall's 2 m ramp has OPEN flat sides and ends in a 1.2 m drop, so
    // it climbs only while no floor under its body lies more than CAR_STAIRS.drop below the body line, and never off the ramp's end.
    const r = car(11, 14, Math.PI, 8);
    run(r, w, ctl({forward: true}), 3, () => {
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeLessThanOrEqual(CAR_STAIRS.drop + 0.05); // (the open sides: floor 0 under the body)
      for (const k of G.circles) expect(carToWorld(r.x, r.z, r.yaw, 0, k.z).z - k.r).toBeLessThan(HALL.ramp.z1); // never past the end
    });
    expect(r.y).toBeGreaterThan(0.2); // it did climb onto it
    // toward the 3 m drop at x = 30 (heading +X)
    const d = car(24, 20, -Math.PI / 2, 12);
    let maxX = 0;
    run(d, w, ctl({forward: true}), 2, () => { maxX = Math.max(maxX, ...G.circles.map(k => carToWorld(d.x, d.z, d.yaw, 0, k.z).x + k.r * CAR_PHYS.rim)); });
    expect(d.y).toBe(0);
    expect(maxX).toBeLessThanOrEqual(HALL.drop + 1e-6);
    expect(maxX).toBeGreaterThan(HALL.drop - 0.5); // it got right up to the edge
    // sliding along the edge: heading north-east into it, the car keeps rolling north
    const e = car(HALL.drop - 2.5, 20, -Math.PI / 4, 6);
    run(e, w, NO_CONTROLS, 0.5);
    expect(e.z).toBeLessThan(19.5);
    // the floor rule itself
    expect(footprintFloor(levels, 15, 15, 0, 0, 0, G)).toBe(0);
    expect(footprintFloor(levels, 11, 21, 0, 0, 0, G)).toBeNull(); // over the ramp
    expect(footprintFloor(levels, HALL.drop - 0.3, 15, Math.PI / 2, 0, 0, G)).toBeNull(); // straddling the drop
    expect(footprintFloor(levels, 5, 5, 0, 5, 1, G)).toBe(5); // on the upper deck (storey 1)
    expect(footprintFloor(levels, 5, 5, Math.PI / 2, 5, 1, G)).toBe(5);
    expect(footprintFloor(levels, 6.5, 5, Math.PI / 2, 5, 1, G)).toBeNull(); // its nose over the deck's edge
    expect(footprintFloor(levels, 15, 15, 0, 5, 1, G)).toBeNull(); // no deck here
    expect(footprintFloor(levels, 15, 15, 0, 0, 1, G)).toBeNull(); // the floor here is storey 0's
  });

  it('a stuck car (wedged nose-first in a corner) stops without moving or jittering through', () => {
    const w: CarWorld = {levels, props: null};
    const b = car(3.2, 26.8, (3 * Math.PI) / 4, 10); // heading south-west into the south-west corner
    const south = HALL.d - HALL.wall;
    for (let t = 0; t < 2; t += DT) {
      stepCar(b, w, G, ctl({forward: true, left: true}), DT);
      for (const k of G.circles) {
        const c = carToWorld(b.x, b.z, b.yaw, 0, k.z);
        expect(c.x - k.r).toBeGreaterThanOrEqual(HALL.wall - 1e-6);
        expect(c.z + k.r).toBeLessThanOrEqual(south + 1e-6);
      }
    }
    expect(Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.yaw)).toBe(true);
  });
});
