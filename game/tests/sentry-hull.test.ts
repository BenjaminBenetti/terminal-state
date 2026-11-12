// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE SENTRY'S OWN-HULL RULE and VIRTUAL ORIGIN (craft/sentry.ts), and its
// small pure helpers.
//  - the turret's geometry on the roof: the mount on the middle hatch, the pivot ORBITING the yaw axis (the cooked tilt axis is ahead
//    of it), muzzle, aim angles, the cooked elevation stops, reach / sweep;
//  - own hull, EXACT against the measured outline at each station along the line (craft/trainFixtures.ts roofTopAtPoint: hatch boxes,
//    end caps, the body): dense sampling agrees with it; a target right beside the car under the eaves is refused, one ~6 m out on
//    the platform is allowed — both sides, all along the car; never along the roof, never into the car; the DEAD ZONE beside the car
//    measured for a real zombie's chest / head height on the platform and in the track bed, straight across and for oblique lines
//    along the car (written to $LL_SENTRY_HULL_OUT when set);
//  - the virtual origin against the REAL parked car's collider boxes (world/playerTrain.ts through the real runtime on a generated
//    layout): it lies outside every box of the car, and the bullet's world ray from it never hits the car — while the same ray cast
//    from the pivot itself is stopped by the car's coarse roof box (why the rule exists);
//  - the target order (nearest clear, bounded line tests, the range), the aim point, the body-clearance distances.
import {appendFileSync, writeFileSync} from 'node:fs';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {loadZombieModels, placeZombie, sentryWorld, teardownSentryWorlds} from './helpers/sentryFixture';
import {raycastWorld} from '../src/combat/hitscan';
import {mulberry32} from '../src/core/rng';
import {raycastShot} from '../src/physics/merchOnHost';
import {trainToWorld} from '../src/gen/playerTrain';
import type {PropPlacement} from '../src/gen/props';
import {TRAIN_TURRET_MEASURED as TM} from '../src/assets/trainEquipment.generated';
import {
  SENTRY, aimAngles, aimPoint, barrelDir, clearOfBody, hullExit, ownHullClear, pickTarget, planSpan, segmentPointDistance,
  segmentSegmentDistance, turnToward, turretMuzzle, turretPivot, turretPivotToward, turretReach, turretSweep, wrapAngle, type V3,
} from '../src/craft/sentry';
import {TRAIN_ROOF, roofTopAt, roofTopAtPoint, turretMount} from '../src/craft/trainFixtures';
import {WEAPONS} from '../src/weapons/weapons';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';

installCanvasShim(false);
afterEach(teardownSentryWorlds);
beforeAll(loadZombieModels, 180000);

const OUT = process.env.LL_SENTRY_HULL_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const DEG = Math.PI / 180;
const HW = SPEC.width / 2, HL = SPEC.length / 2;
/** The mount: the turret's yaw axis on the hatch. */
const MNT = turretMount(SPEC);
/** The pivot's height (the same at every yaw). */
const PIVOT_Y = MNT.y + TM.pitchPivot.y;

/** The line of fire to a train-local aim point: from the pivot of the turret turned to point at it. */
function lineTo(to: V3): {o: V3; dir: V3; d: number; pitch: number} {
  const o = turretPivotToward(to.x, to.z, SPEC), dx = to.x - o.x, dy = to.y - o.y, dz = to.z - o.z, d = Math.hypot(dx, dy, dz);
  const dir = {x: dx / d, y: dy / d, z: dz / d};
  return {o, dir, d, pitch: Math.asin(dir.y)};
}

/** What refuses a shot at a train-local aim point: the elevation stops, the car's own roof, an aim point on the car — or nothing. */
function refusal(to: V3): 'stop' | 'roof' | 'on the car' | null {
  const l = lineTo(to);
  if (l.pitch < SENTRY.pitchMin || l.pitch > SENTRY.pitchMax) return 'stop';
  if (!ownHullClear(l.o, l.dir, l.d, SPEC)) return 'roof';
  return hullExit(l.o, l.dir, l.d, SPEC) === null ? 'on the car' : null;
}
const hullOk = (to: V3): boolean => refusal(to) === null;

/**
 * The dead zone beside the car: the distance from the car's SIDE (m) from which a point at height y, `along` m along the car from the
 * turret's axis, can be shot — and what refuses it just inside that.
 */
function deadZone(y: number, side: -1 | 1, along = 0): {from: number; by: string} {
  let first = NaN, by = '';
  for (let k = 1; k <= 2600; k++) {
    const D = k * 0.01, why = refusal({x: MNT.x + along, y, z: side * (HW + D)});
    if (why === null && Number.isNaN(first)) first = D;
    if (Number.isNaN(first)) by = why!;
    if (!Number.isNaN(first) && D > first + 0.15) expect(why, `clear at ${D} m once clear at ${first} m (along ${along})`).toBeNull(); // (no holes farther out)
  }
  return {from: first, by};
}

describe('sentry turret: geometry on the roof', () => {
  it('stands on the middle hatch; the pivot orbits the yaw axis above the hatch top; the numbers the rules use are the cooked turret\'s', () => {
    expect(MNT).toEqual({x: TRAIN_ROOF.seat.x, y: TRAIN_ROOF.seat.lo, z: 0});
    const hatch = TRAIN_ROOF.hatches[1];
    expect(MNT.x).toBeGreaterThan(hatch.x0); expect(MNT.x).toBeLessThan(hatch.x1);
    // the tilt axis' middle: ahead of the yaw axis in the gun's own vertical plane (so the bearing from the axis is the gun's yaw)
    expect(TM.pitchPivot.x).toBe(0);
    expect(TM.pitchPivot.z).toBeGreaterThan(0.02);
    expect(turretPivot(0)).toEqual({x: MNT.x, y: PIVOT_Y, z: MNT.z + TM.pitchPivot.z});
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, Math.PI, -1.3]) {
      const p = turretPivot(yaw);
      expect(p.y).toBeCloseTo(PIVOT_Y, 12);
      expect(Math.hypot(p.x - MNT.x, p.z - MNT.z)).toBeCloseTo(TM.pitchPivot.z, 12);
      expect(wrapAngle(Math.atan2(p.x - MNT.x, p.z - MNT.z) - yaw)).toBeCloseTo(0, 9); // on the bearing the gun points along
      // the pivot of the turret turned to point at a plan point on that bearing is the same one
      const far = {x: MNT.x + 9 * Math.sin(yaw), z: MNT.z + 9 * Math.cos(yaw)}, q = turretPivotToward(far.x, far.z);
      expect(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)).toBeLessThan(1e-12);
      // and the line from it to that point has the gun's yaw
      expect(wrapAngle(aimAngles({x: far.x - q.x, y: 0, z: far.z - q.z}).yaw - yaw)).toBeCloseTo(0, 9);
    }
    expect(turretPivot(Math.PI / 2).x).toBeCloseTo(MNT.x + TM.pitchPivot.z, 12); // turned to +X: ahead of the axis along the car
    // 0.253 m over the hatch's top: what the dead zone beside the car comes from
    expect(roofTopAtPoint(MNT.x, 0)).toBe(Math.max(...hatch.top));
    expect(PIVOT_Y).toBeCloseTo(4.106, 9);
    expect(PIVOT_Y - roofTopAtPoint(MNT.x, 0)).toBeCloseTo(0.253, 9);
    // the stops are the cooked turret's: down to its limit over a flat mounting plane, up 8 degrees (below the 10-degree contact)
    expect(SENTRY.pitchMin).toBeCloseTo(-TM.pitchClear.overPlane * DEG, 12);
    expect(SENTRY.pitchMin / DEG).toBeCloseTo(-29, 9);
    expect(SENTRY.pitchMax / DEG).toBeCloseTo(8, 9);
    expect(TM.pitchClear.overPlane).toBeLessThanOrEqual(TM.pitchClear.down);
    expect(SENTRY.scanPitch).toBeLessThan(0); expect(SENTRY.scanPitch).toBeGreaterThan(SENTRY.pitchMin / 2); // a small depression
    // reach (headroom) and sweep
    expect(turretSweep()).toBe(TM.swingRadius);
    expect(turretReach()).toBe(SENTRY.topDepressed);
    expect(turretReach()).toBeGreaterThan(TM.size.h);
    expect(SENTRY.weapon).toBe('rifle');
    expect(WEAPONS[SENTRY.weapon].caliber).toBe('5.56x45mm'); // the hopper's rounds are the rifle's
    expect(SENTRY.range).toBeLessThan(WEAPONS[SENTRY.weapon].range);
  });

  it('muzzle, aim angles and barrel direction agree (yaw about +Y from +Z, pitch up positive); the muzzle swings about the orbiting pivot', () => {
    const m0 = turretMuzzle(0, 0);
    expect(m0.x).toBeCloseTo(MNT.x + TM.muzzle.x, 9); expect(m0.y).toBeCloseTo(MNT.y + TM.muzzle.y, 9); expect(m0.z).toBeCloseTo(MNT.z + TM.muzzle.z, 9);
    const mx = turretMuzzle(Math.PI / 2, 0); // turned to +X
    expect(mx.x).toBeCloseTo(MNT.x + TM.muzzle.z, 9); expect(mx.z).toBeCloseTo(MNT.z, 9);
    const up = turretMuzzle(0, SENTRY.pitchMax), dn = turretMuzzle(0, SENTRY.pitchMin);
    expect(up.y).toBeGreaterThan(m0.y); expect(dn.y).toBeLessThan(m0.y);
    expect(dn.y - MNT.y).toBeGreaterThan(0.01); // at the lower stop the tip is still above the plane the base stands on
    const arm = Math.hypot(TM.muzzle.y - TM.pitchPivot.y, TM.muzzle.z - TM.pitchPivot.z);
    for (const [yaw, pitch] of [[0, 0], [1.1, 0.13], [-2.6, -0.5], [Math.PI, 0.1], [0.4, SENTRY.pitchMin]]) {
      const d = barrelDir(yaw, pitch), a = aimAngles(d);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
      expect(wrapAngle(a.yaw - yaw)).toBeCloseTo(0, 9); expect(a.pitch).toBeCloseTo(pitch, 9);
      // the muzzle is a fixed arm from the pivot AT THAT YAW, ahead of it along the barrel
      const mz = turretMuzzle(yaw, pitch), piv = turretPivot(yaw), f = {x: mz.x - piv.x, y: mz.y - piv.y, z: mz.z - piv.z}, l = Math.hypot(f.x, f.y, f.z);
      expect(l).toBeCloseTo(arm, 9);
      expect((f.x * d.x + f.y * d.y + f.z * d.z) / l).toBeGreaterThan(0.99);
    }
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 12); // the short way round, through PI
    expect(turnToward(0.2, 0.25, 0.1)).toBe(0.25);
  });
});

describe('sentry own-hull rule', () => {
  let chest = 0, head = 0, platform = 0, bed = 0;
  beforeAll(() => {
    // a real zombie's aim heights over its feet, the real platform / bed heights beside the parked car (train-local)
    const z = placeZombie({x: 0, y: 0, z: 0}), a = {x: 0, y: 0, z: 0};
    expect(aimPoint(z.hitVolumes, 'torso', a)).toBe(true); chest = a.y;
    expect(aimPoint(z.hitVolumes, 'head', a)).toBe(true); head = a.y;
    const s = sentryWorld();
    platform = s.stand(MNT.x, -(HW + 2))!.y - s.p.railTopY;
    bed = s.lay.trench.floorY - s.p.railTopY;
    teardownSentryWorlds();
  });

  it('is EXACT against the outline at each station along the line: dense sampling of roofTopAtPoint agrees (hatches, end caps, body)', () => {
    const rnd = mulberry32(0x5e17), STEP = 0.0005, TOL = 0.001, span: [number, number] = [0, 0];
    /** The least height of the line over the outline under it, sampled every STEP along its span over the car. */
    const sampled = (o: V3, d: V3, maxT: number): number => {
      if (!planSpan(o, d, maxT, HL, HW + 0.02, span)) return Infinity;
      let min = Infinity;
      const n = Math.ceil((span[1] - span[0]) / STEP);
      for (let i = 0; i <= n; i++) {
        const t = Math.min(span[1], span[0] + i * STEP), g = o.y + d.y * t - roofTopAtPoint(o.x + d.x * t, o.z + d.z * t, SPEC);
        if (g < min) min = g;
      }
      return min;
    };
    const U = (a: number, b: number) => a + (b - a) * rnd();
    let yes = 0, no = 0, near = 0, overHatch = 0, overEnd = 0;
    const one = (o: V3, d: V3, maxT: number, margin: number) => {
      const clear = ownHullClear(o, d, maxT, SPEC, margin), least = sampled(o, d, maxT);
      const at = `o (${o.x.toFixed(4)}, ${o.y.toFixed(4)}, ${o.z.toFixed(4)}) d (${d.x.toFixed(5)}, ${d.y.toFixed(5)}, ${d.z.toFixed(5)}) maxT ${maxT.toFixed(3)} margin ${margin}: sampled least ${least.toFixed(5)}`;
      if (least >= margin + TOL) { expect(clear, at).toBe(true); yes++; }
      else if (least < margin - TOL) { expect(clear, at).toBe(false); no++; }
      else near++;
    };
    // the lines the turret really asks about: from the pivot turned to a target beside / beyond the car, at body heights
    for (let i = 0; i < 700; i++) {
      const to = {x: U(-HL - 10, HL + 10), y: U(-0.5, 3.2), z: (rnd() < 0.5 ? -1 : 1) * (HW + U(0.05, 9))}, l = lineTo(to);
      one(l.o, l.dir, l.d, i % 3 ? SENTRY.hullMargin : 0);
    }
    // lines skimming the roof from anywhere over it, any direction: over the hatch boxes, the end caps, along and across the car
    for (let i = 0; i < 900; i++) {
      const o = {x: U(-HL - 0.5, HL + 0.5), y: U(3.45, 4.15), z: U(-HW - 0.3, HW + 0.3)};
      const yaw = U(0, 2 * Math.PI), pitch = U(-0.2, 0.08), d = barrelDir(yaw, pitch), maxT = U(0.3, 20);
      one(o, d, maxT, i % 2 ? SENTRY.hullMargin : 0.005);
      if (planSpan(o, d, maxT, HL, HW, span)) {
        const xe = o.x + d.x * span[1];
        if (TRAIN_ROOF.hatches.some(h => Math.min(o.x, xe) < h.x1 && Math.max(o.x, xe) > h.x0) && Math.abs(o.z) < TRAIN_ROOF.hatchZ) overHatch++;
        if (Math.max(Math.abs(o.x), Math.abs(xe)) > TRAIN_ROOF.endX) overEnd++;
      }
    }
    // nearly along the car close to the centre line (over every hatch and both end caps), nearly straight across
    for (let i = 0; i < 400; i++) {
      const along = i % 2 === 0, o = {x: U(-HL, HL), y: U(3.6, 4.0), z: U(-0.7, 0.7)};
      const yaw = (along ? (rnd() < 0.5 ? 1 : -1) * Math.PI / 2 : (rnd() < 0.5 ? 0 : Math.PI)) + U(-0.02, 0.02), d = barrelDir(yaw, U(-0.03, 0.02));
      one(o, d, U(1, 20), SENTRY.hullMargin);
    }
    expect([yes > 400, no > 400, overHatch > 100, overEnd > 100]).toEqual([true, true, true, true]);
    expect(near).toBeLessThan(60); // (only lines within a millimetre of the margin are left to either answer)
  });

  it('knows the hatches and end caps where they are: a line the whole-length outline would refuse is clear between them', () => {
    const X = {x: 1, y: 0, z: 0}, Z = {x: 0, y: 0, z: 1}, m = SENTRY.hullMargin;
    const body = roofTopAtPoint(1, 0), crest = roofTopAt(0);
    expect(body).toBeLessThan(crest - 0.1); // the skin between the hatches is well below the hatches' tops
    // (the rule's premise: the hatch boxes' sides are band edges, so the outline is constant inside every band x stretch rectangle)
    expect(TRAIN_ROOF.hatchZ / TRAIN_ROOF.step).toBeCloseTo(Math.round(TRAIN_ROOF.hatchZ / TRAIN_ROOF.step), 9);
    for (const h of TRAIN_ROOF.hatches) expect(h.top.length * TRAIN_ROOF.step).toBeCloseTo(TRAIN_ROOF.hatchZ, 9);
    // level, across the car between two hatches, just over the skin: clear (the whole-length outline is 15 cm higher)
    expect(ownHullClear({x: 1, y: body + m + 0.002, z: 0}, Z, 10, SPEC)).toBe(true);
    expect(ownHullClear({x: 1, y: body + m - 0.002, z: 0}, Z, 10, SPEC)).toBe(false);
    // the same height along the car: stopped by the next hatch box ... unless it ends before it, or runs outside the boxes' width
    const h2 = TRAIN_ROOF.hatches[2];
    expect(ownHullClear({x: 1, y: body + m + 0.002, z: 0}, X, 30, SPEC)).toBe(false);
    expect(ownHullClear({x: 1, y: body + m + 0.002, z: 0}, X, h2.x0 - 1 - 0.01, SPEC)).toBe(true);
    expect(ownHullClear({x: 1, y: body + m + 0.002, z: 0}, X, h2.x0 - 1 + 0.01, SPEC)).toBe(false);
    expect(ownHullClear({x: 1, y: h2.top[0] + m + 0.002, z: 0}, X, 30, SPEC)).toBe(true); // over that hatch, and the end cap behind it
    // beside the hatch boxes (|z| > hatchZ) along the car: the body's outline there, then the END CAP's (a little higher)
    const z = TRAIN_ROOF.hatchZ + 0.11, by = roofTopAtPoint(1, z), ey = roofTopAtPoint(TRAIN_ROOF.endX + 0.5, z);
    expect(ey).toBeGreaterThan(by);
    const y = (by + ey) / 2 + m;
    expect(ownHullClear({x: 1, y, z}, X, TRAIN_ROOF.endX - 1 - 0.01, SPEC)).toBe(true);
    expect(ownHullClear({x: 1, y, z}, X, TRAIN_ROOF.endX - 1 + 0.01, SPEC)).toBe(false);
    expect(ownHullClear({x: 1, y: ey + m + 0.002, z}, X, 30, SPEC)).toBe(true);
    // from the turret's own hatch: across the car the line passes over the hatch's falling flank and the skin below it; along the car
    // it runs over the hatch's top first
    const own = TRAIN_ROOF.hatches[1], top = own.top[0];
    expect(ownHullClear({x: MNT.x, y: top + m + 0.002, z: 0}, Z, 10, SPEC)).toBe(true);
    expect(ownHullClear({x: MNT.x, y: top + m - 0.002, z: 0}, Z, 10, SPEC)).toBe(false);
    const down = barrelDir(Math.PI / 2, -6 * DEG), o = {x: MNT.x, y: top + m + 0.002, z: 0}; // sinking 6 degrees toward the front
    expect(ownHullClear(o, down, 0.2, SPEC)).toBe(false); // into the hatch's own top
    const o2 = {x: own.x1 + 0.01, y: body + m + 0.002, z: 0};
    expect(ownHullClear(o2, X, 1, SPEC)).toBe(true); // just past its end: only the skin below
    // a line running exactly ALONG an edge of the outline takes the higher side (never the lower)
    const edge = TRAIN_ROOF.step * 20, hi = roofTopAtPoint(1, edge - 0.001), lo = roofTopAtPoint(1, edge + 0.001);
    expect(hi).toBeGreaterThan(lo);
    expect(ownHullClear({x: 1, y: lo + m + 0.001, z: edge}, X, 2, SPEC)).toBe(false);
    expect(ownHullClear({x: 1, y: hi + m + 0.001, z: edge}, X, 2, SPEC)).toBe(true);
  });

  it('a body right beside the car under the eaves is refused, one ~6 m out on the platform is allowed: both sides, all along the car', () => {
    expect(chest).toBeGreaterThan(1.1); expect(chest).toBeLessThan(1.5);
    expect(head).toBeGreaterThan(1.45); expect(head).toBeLessThan(1.8);
    expect(platform).toBeGreaterThan(0.5); expect(platform).toBeLessThan(1.3);
    for (const side of [-1, 1] as const) {
      for (let x = -HL + 0.5; x <= HL - 0.5; x += 1.5) {
        for (const y of [platform + chest, platform + head]) {
          expect(hullOk({x, y, z: side * (HW + 0.4)}), `under the eaves x ${x} side ${side}`).toBe(false);
          expect(hullOk({x, y, z: side * (HW + 1.0)}), `1 m beside the car x ${x} side ${side}`).toBe(false);
          expect(hullOk({x, y, z: side * (HW + 6)}), `6 m out x ${x} side ${side}`).toBe(true);
          expect(hullOk({x, y, z: side * (HW + 15)}), `15 m out x ${x} side ${side}`).toBe(true);
        }
      }
      // beyond the car's ends, out to the side: allowed too
      for (const x of [-HL - 6, HL + 6]) expect(hullOk({x, y: platform + chest, z: side * (HW + 6)})).toBe(true);
    }
  });

  it('never along the roof, never into the car, never straight down', () => {
    for (const x of [HL + 3, HL + 15, -HL - 3, -HL - 15]) for (const z of [0, 0.4, -0.4]) {
      expect(refusal({x, y: platform + chest, z}), `fore / aft x ${x} z ${z}`).toBe('roof');
      expect(refusal({x, y: bed + chest, z})).toBe('roof');
    }
    // inside the car (the saloon, the cab), on its roof
    for (const x of [MNT.x, 0, 5, -6]) for (const z of [0, 0.9, -0.9]) {
      expect(hullOk({x, y: SPEC.floorY + chest, z})).toBe(false);
      expect(hullOk({x: x + 0.7, y: roofTopAtPoint(x + 0.7, z), z})).toBe(false);
    }
    // the pieces: a ray that starts under the roof outline is refused; one that never crosses the outline is free
    const piv = turretPivot(0);
    expect(ownHullClear({x: 0, y: 3.0, z: 0}, {x: 0, y: 0, z: 1}, 10, SPEC)).toBe(false);
    expect(ownHullClear({x: 0, y: 3.0, z: HW + 0.5}, {x: 0, y: 0, z: 1}, 10, SPEC)).toBe(true);
    expect(ownHullClear(piv, {x: 0, y: 1, z: 0}, 10, SPEC)).toBe(true); // (straight up: over the roof all the way)
    expect(ownHullClear(piv, {x: 0, y: -1, z: 0}, 10, SPEC)).toBe(false);
    // the margin: level over the highest hatch all along the car is clear, grazing it is not
    expect(roofTopAt(0)).toBe(roofTopAtPoint(MNT.x, 0)); // (the turret's own hatch is the highest thing on the roof)
    expect(ownHullClear({x: MNT.x, y: roofTopAt(0) + SENTRY.hullMargin + 0.001, z: 0}, {x: 1, y: 0, z: 0}, 30, SPEC)).toBe(true);
    expect(ownHullClear({x: MNT.x, y: roofTopAt(0) + SENTRY.hullMargin - 0.001, z: 0}, {x: 1, y: 0, z: 0}, 30, SPEC)).toBe(false);
  });

  it('the dead zone beside the car, measured (a real zombie on the real platform / in the bed): straight across and oblique', () => {
    const ALONG = [-12, -7, -5, -3, -1.5, 0, 1.5, 3, 5, 7, 9, 14];
    const zone = (label: string, y: number) => {
      const a = deadZone(y, -1), b = deadZone(y, 1);
      const row = ALONG.map(k => deadZone(y, -1, k)), far = ALONG.map(k => deadZone(y, 1, k));
      out(`${label}: clear from ${a.from.toFixed(2)} m off the car's side (far side ${b.from.toFixed(2)} m), bound by the ${a.by}`);
      out(`  oblique, the target ${ALONG.join(' / ')} m along the car from the turret: ${row.map(r => `${r.from.toFixed(2)} (${r.by})`).join(' / ')}`);
      expect(b.from).toBeCloseTo(a.from, 9); // the outline is symmetric about the centre line
      for (let i = 0; i < ALONG.length; i++) expect(far[i].from).toBeCloseTo(row[i].from, 9);
      return {a, row};
    };
    out(`mount x ${MNT.x} (middle hatch); pivot ${PIVOT_Y.toFixed(3)} m over the rail top = ${(PIVOT_Y - roofTopAtPoint(MNT.x, 0)).toFixed(3)} m over the hatch's top, ${TM.pitchPivot.z} m ahead of the yaw axis; stops ${(SENTRY.pitchMin / DEG).toFixed(0)} / +${(SENTRY.pitchMax / DEG).toFixed(0)} degrees`);
    out(`platform ${platform.toFixed(2)} m, bed ${bed.toFixed(2)} m over the rail top; zombie chest aim ${chest.toFixed(2)} m, head ${head.toFixed(2)} m over its feet`);
    const pc = zone('platform, chest', platform + chest), ph = zone('platform, head ', platform + head);
    const bc = zone('track bed, chest', bed + chest), bh = zone('track bed, head ', bed + head);
    // STRAIGHT ACROSS the lower elevation stop binds, not the roof: the strip is the stop's cone under the pivot
    for (const z of [pc, ph, bc, bh]) expect(z.a.by).toBe('stop');
    const cone = (y: number) => (PIVOT_Y - y) / Math.tan(-SENTRY.pitchMin) + TM.pitchPivot.z - HW;
    expect(pc.a.from).toBeGreaterThanOrEqual(cone(platform + chest)); expect(pc.a.from).toBeLessThan(cone(platform + chest) + 0.011);
    expect(bh.a.from).toBeGreaterThanOrEqual(cone(bed + head)); expect(bh.a.from).toBeLessThan(cone(bed + head) + 0.011);
    // what was measured (the cooked turret on the hatch; Subway seed 4242's platform 0.85 m / bed -0.29 m over the rail top, the
    // zombie's chest 1.27 m / head 1.64 m over its feet): 2.13 / 1.47 m on the platform, 4.20 / 3.54 m in the bed
    const band = (v: number, want: number) => { expect(v).toBeGreaterThan(want - 0.08); expect(v).toBeLessThan(want + 0.08); };
    band(pc.a.from, 2.13); band(ph.a.from, 1.47); band(bc.a.from, 4.2); band(bh.a.from, 3.54);
    // OBLIQUE lines (a target along the car) are bound by the ROOF: a strip of nearly the same width all along the car and beyond its
    // ends — a little narrower than straight across (there the stop's cone reaches farther than the roof's shadow), growing by a few
    // centimetres with the distance along the car. Measured: 1.97 .. 2.02 / 1.34 .. 1.38 m (platform), 3.96 .. 4.04 / 3.31 .. 3.40 m (bed)
    const at = (z: typeof pc, k: number) => z.row[ALONG.indexOf(k)];
    for (const z of [pc, ph, bc, bh]) {
      for (const k of ALONG) {
        if (Math.abs(k) >= 3) expect(at(z, k).by, `along ${k}`).toBe('roof');
        if (k !== 0) { expect(at(z, k).from).toBeLessThan(z.a.from); expect(at(z, k).from).toBeGreaterThan(z.a.from - 0.3); }
      }
      expect(at(z, 14).from).toBeGreaterThanOrEqual(at(z, 3).from); expect(at(z, 14).from).toBeLessThan(at(z, 3).from + 0.12);
      expect(at(z, -12).from).toBeGreaterThanOrEqual(at(z, -3).from); expect(at(z, -12).from).toBeLessThan(at(z, -3).from + 0.12);
      expect(at(z, 0).from).toBe(z.a.from);
    }
    band(at(pc, 5).from, 2.0); band(at(ph, 5).from, 1.36); band(at(bc, 5).from, 3.98); band(at(bh, 5).from, 3.35);
  });
});

describe('sentry virtual origin', () => {
  it('hullExit: where the line leaves the outline, a push outside it; 0 when already outside; null when the aim point is on the car', () => {
    const d = {x: 0, y: 0, z: -1}, piv = turretPivot(Math.PI); // turned to -Z: the pivot is that side of the axis
    expect(piv.z).toBeCloseTo(-TM.pitchPivot.z, 12);
    const t = hullExit(piv, d, 30, SPEC)!;
    expect(t).toBeCloseTo(HW + SENTRY.hullPush - TM.pitchPivot.z, 9);
    const yaw = Math.PI / 4, diag = barrelDir(yaw, 0), pd = turretPivot(yaw), td = hullExit(pd, diag, 30, SPEC)!;
    expect(Math.abs(pd.z + diag.z * td)).toBeCloseTo(HW + SENTRY.hullPush, 9);
    expect(hullExit({x: 0, y: 4, z: HW + 0.5}, d, 30, SPEC)).toBe(0);
    expect(hullExit(piv, d, 1.2, SPEC)).toBeNull();
    expect(hullExit(piv, {x: 0, y: 1, z: 0}, 30, SPEC)).toBeNull();
    // toward the front end: through the end of the outline
    const pf = turretPivot(Math.PI / 2);
    expect(hullExit(pf, {x: 1, y: 0, z: 0}, 30, SPEC)).toBeCloseTo(HL + SENTRY.hullPush - pf.x, 9);
    const span: [number, number] = [0, 0];
    expect(planSpan(piv, d, 30, HL, HW, span)).toBe(true);
    expect(span[0]).toBe(0); expect(span[1]).toBeCloseTo(HW - TM.pitchPivot.z, 9);
    expect(planSpan({x: 0, y: 0, z: 5}, {x: 1, y: 0, z: 0}, 30, HL, HW, span)).toBe(false);
  });

  it('lies outside every collider box of the REAL parked car, and the bullet ray from it never hits the car', () => {
    const s = sentryWorld();
    const t = s.rt.train!, car = new Set<PropPlacement>([...t.layoutBoxes, ...t.col.statics, ...t.col.shoot, ...t.col.overhead, ...t.col.glass, ...t.col.doors.flatMap(d => [...d.leaves, ...d.hitLeaves, ...(d.leafGlass ?? [])])]);
    expect(car.size).toBeGreaterThan(20);
    // every car box lies within the plan outline (the rule's premise)
    for (const b of car) {
      const c0 = {x: b.x - b.hx, z: b.z - b.hz}, c1 = {x: b.x + b.hx, z: b.z + b.hz};
      for (const c of [c0, c1]) {
        const lx = (c.x - s.p.x) * s.p.front, lz = (c.z - s.p.z) * s.p.front;
        expect(Math.abs(lx)).toBeLessThanOrEqual(HL + 1e-6); expect(Math.abs(lz)).toBeLessThanOrEqual(HW + 1e-6);
      }
    }
    let lines = 0, carHitsFromPivot = 0;
    // every yaw, every elevation between the stops
    for (let yaw = 0; yaw < 360; yaw += 6) for (let pitch = SENTRY.pitchMin / DEG; pitch <= SENTRY.pitchMax / DEG + 1e-9; pitch += 1.85) {
      const dl = barrelDir(yaw * DEG, pitch * DEG), pivL = turretPivot(yaw * DEG);
      if (!ownHullClear(pivL, dl, 30, SPEC)) continue;
      const tx = hullExit(pivL, dl, 30, SPEC);
      if (tx === null) continue;
      lines++;
      const piv = s.pivot(yaw * DEG);
      const dw = {x: dl.x * s.p.front, y: dl.y, z: dl.z * s.p.front};
      const o = {x: piv.x + dw.x * tx, y: piv.y + dw.y * tx, z: piv.z + dw.z * tx};
      for (const b of car) {
        const inside = Math.abs(o.x - b.x) < b.hx + SENTRY.hullPush * 0.9 && Math.abs(o.z - b.z) < b.hz + SENTRY.hullPush * 0.9 && o.y > b.y && o.y < b.y + b.h;
        expect(inside, `virtual origin in a car box (yaw ${yaw} pitch ${pitch})`).toBe(false);
      }
      const wh = raycastShot(s.levels, s.lay.props, o, dw, 30, s.lay.trench.floorY);
      if (wh.kind === 'prop') expect(car.has(s.lay.props[wh.prop!]), `the shot hit the car (yaw ${yaw} pitch ${pitch}, t ${wh.t})`).toBe(false);
      const ws = raycastWorld(s.levels, s.lay.props, o, dw, 30, s.lay.trench.floorY);
      if (ws.kind === 'prop') expect(car.has(s.lay.props[ws.prop!])).toBe(false);
      // the same line cast from the pivot itself
      const wp = raycastWorld(s.levels, s.lay.props, piv, dw, 30, s.lay.trench.floorY);
      if (wp.kind === 'prop' && car.has(s.lay.props[wp.prop!])) carHitsFromPivot++;
    }
    out(`virtual origin: ${lines} lines over the roof between the stops (every 6 degrees of yaw), ${carHitsFromPivot} of them stopped by the car's coarse roof box when cast from the pivot`);
    expect(lines).toBeGreaterThan(300);
    // why the virtual origin exists: the car's roof BOX is coarser than its roof — many lines that clear the real roof are stopped by it
    expect(carHitsFromPivot).toBeGreaterThan(50);
  });

  it('a shot at the platform 6 m out: clear over the real roof, stopped by the roof box from the pivot, free from the virtual origin', () => {
    const s = sentryWorld();
    const car = new Set<PropPlacement>(s.rt.train!.layoutBoxes);
    const feet = s.stand(MNT.x, -(HW + 6))!;
    const to = {x: feet.x, y: feet.y + 1.3, z: feet.z}, piv = s.pivotToward(to), pivL = s.local(piv);
    expect(Math.hypot(pivL.x - MNT.x, pivL.z - MNT.z)).toBeCloseTo(TM.pitchPivot.z, 9); // the pivot of the turret turned to the target
    expect(pivL.z).toBeCloseTo(-TM.pitchPivot.z, 9);
    const d = Math.hypot(to.x - piv.x, to.y - piv.y, to.z - piv.z), dw = {x: (to.x - piv.x) / d, y: (to.y - piv.y) / d, z: (to.z - piv.z) / d};
    const dl = {x: dw.x * s.p.front, y: dw.y, z: dw.z * s.p.front};
    expect(ownHullClear(pivL, dl, d, SPEC)).toBe(true);
    const fromPivot = raycastWorld(s.levels, s.lay.props, piv, dw, d, s.lay.trench.floorY);
    expect(fromPivot.kind).toBe('prop');
    expect(car.has(s.lay.props[fromPivot.prop!])).toBe(true);
    expect(fromPivot.t).toBeLessThan(HW + 0.5);
    const tx = hullExit(pivL, dl, d, SPEC)!, o = {x: piv.x + dw.x * tx, y: piv.y + dw.y * tx, z: piv.z + dw.z * tx};
    const fromOrigin = raycastWorld(s.levels, s.lay.props, o, dw, d - tx, s.lay.trench.floorY);
    expect(fromOrigin.kind === 'none' || fromOrigin.t >= d - tx - SENTRY.reach).toBe(true);
    expect(s.levels.lineOfSight(o, to)).toBe(true);
    expect(s.sys.clearTo(to, s.p)).toBe(true);
    // the same point for a gun still turned somewhere else: the line starts at THAT yaw's pivot (a few centimetres away) — still clear
    expect(s.sys.clearTo(to, s.p, 0.6)).toBe(true);
    // under the eaves: refused by the system as a whole
    const near = trainToWorld(s.p, MNT.x, 0, -(HW + 0.6));
    expect(s.sys.clearTo({x: near.x, y: feet.y + 1.3, z: near.z}, s.p)).toBe(false);
  });
});

describe('sentry target order (pure)', () => {
  /** A candidate d m away; clear: true = a clear shot, false = refused by the world rays, null = refused for free (the own roof). */
  const at = (d: number, clear: boolean | null = true, ok = true) => ({d, clear, ok});
  type C = ReturnType<typeof at>;
  const pick = (cs: C[], range = SENTRY.range, max = SENTRY.maxChecks, cands = SENTRY.maxCandidates) => {
    const asked: C[] = [];
    const got = pickTarget(cs, c => (c.ok ? c.d * c.d : Infinity), c => { asked.push(c); return c.clear; }, range, max, cands);
    return {got, asked};
  };

  it('the nearest candidate with a clear shot wins; nearer blocked ones are asked first, farther ones never', () => {
    const a = at(12), b = at(5, false), c = at(8), d = at(20);
    const r = pick([a, b, c, d]);
    expect(r.got).toBe(c);
    expect(r.asked).toEqual([b, c]);
    expect(pick([at(9, false), at(3, false)]).got).toBeNull();
    expect(pick([]).got).toBeNull();
  });

  it('skips non-candidates (dead / ragdolled / dormant: an infinite distance) and everything beyond the range without a line test', () => {
    const dead = at(2, true, false), far = at(SENTRY.range + 0.01), edge = at(SENTRY.range), mid = at(15, false);
    const r = pick([dead, far, edge, mid]);
    expect(r.got).toBe(edge);
    expect(r.asked).toEqual([mid, edge]);
    expect(pick([dead, far]).asked).toEqual([]);
    expect(SENTRY.range).toBe(28);
  });

  it('equal distances keep the list order; at most maxChecks line tests per pick', () => {
    const a = at(6, false), b = at(6, false), c = at(6), d = at(6);
    expect(pick([a, b, c, d]).got).toBe(c);
    expect(pick([a, b, c, d]).asked).toEqual([a, b, c]);
    const many = Array.from({length: 40}, (_, i) => at(1 + i * 0.5, false));
    const r = pick([...many, at(26)]);
    expect(r.got).toBeNull();
    expect(r.asked.length).toBe(SENTRY.maxChecks);
    expect(r.asked).toEqual(many.slice(0, SENTRY.maxChecks));
  });

  it('a crowd pressed against the car (refused for free by the roof rule) never hides the clear target behind it', () => {
    const crowd = Array.from({length: 30}, (_, i) => at(2 + i * 0.02, null)), walled = Array.from({length: 5}, (_, i) => at(4 + i, false));
    const clear = at(12);
    const r = pick([...crowd, ...walled, clear]);
    expect(r.got).toBe(clear);
    expect(r.asked.length).toBe(36);
    // the free refusals do not use up the costly budget; the candidates looked at per pick are bounded all the same
    expect(pick([...crowd, ...Array.from({length: SENTRY.maxChecks}, (_, i) => at(4 + i * 0.1, false)), at(20)]).got).toBeNull();
    const huge = Array.from({length: 200}, (_, i) => at(1 + i * 0.1, null));
    const h = pick([...huge, at(25)]);
    expect(h.got).toBeNull();
    expect(h.asked.length).toBe(SENTRY.maxCandidates);
    expect([SENTRY.maxChecks, SENTRY.maxCandidates]).toEqual([12, 48]);
  });

  it('the free refusals stay cheap: the own-roof walk over a whole crowd, timed (written to the report file only)', () => {
    // 48 candidates x torso + head, every line right across the roof to a body under the eaves (the longest walk: ~75 band edges)
    const tos: V3[] = [];
    for (let i = 0; i < SENTRY.maxCandidates; i++) for (const y of [2.1, 2.5]) tos.push({x: MNT.x - 6 + i * 0.25, y, z: (i % 2 ? 1 : -1) * (HW + 0.3 + (i % 5) * 0.1)});
    let refused = 0, byRoof = 0;
    const once = () => { refused = 0; byRoof = 0; for (const to of tos) { const why = refusal(to); if (why !== null) refused++; if (why === 'roof') byRoof++; } };
    once();
    expect(refused).toBe(tos.length); // (all under the eaves: refused by the roof rule or the stop)
    expect(byRoof).toBeGreaterThan(tos.length / 2);
    const t0 = performance.now(), N = 200;
    for (let i = 0; i < N; i++) once();
    const perPick = (performance.now() - t0) / N;
    // the roof walk alone: a clear line skimming right across the car between two hatches, under the highest hatch's height (so the
    // walk is not skipped) — every band's edge on both sides of the centre line
    const o = {x: 1, y: roofTopAtPoint(1, 0) + SENTRY.hullMargin + 0.01, z: -HW - 0.01}, d = {x: 0, y: 0, z: 1};
    expect(o.y).toBeLessThan(roofTopAt(0));
    const t1 = performance.now(), K = 20000;
    let ok = 0;
    for (let i = 0; i < K; i++) if (ownHullClear(o, d, 4, SPEC)) ok++;
    const perWalk = (performance.now() - t1) / K;
    expect(ok).toBe(K);
    out(`cost: a pick's ${tos.length} free refusals (48 bodies under the eaves, torso + head; ${byRoof} by the roof walk) ${(perPick * 1000).toFixed(0)} us in all = ${(perPick * 1000 / tos.length).toFixed(2)} us per line; the longest roof walk (clear, right across the car: ~150 band edges) ${(perWalk * 1000).toFixed(2)} us`);
  });
});

describe('sentry aim point and body clearance (pure)', () => {
  it('aims at the upper torso (a fraction up the capsule, whichever end is listed first), else the head sphere', () => {
    const o = {x: 0, y: 0, z: 0};
    const vols = [
      {part: 'limb' as const, a: {x: 9, y: 9, z: 9}, b: {x: 9, y: 8, z: 9}, r: 0.1},
      {part: 'head' as const, a: {x: 1, y: 1.6, z: 2}, b: null, r: 0.12},
      {part: 'torso' as const, a: {x: 1, y: 0.9, z: 2}, b: {x: 1.1, y: 1.4, z: 2}, r: 0.2},
    ];
    expect(aimPoint(vols, 'torso', o)).toBe(true);
    expect(o.y).toBeCloseTo(0.9 + 0.5 * SENTRY.torsoUp, 12); expect(o.x).toBeCloseTo(1 + 0.1 * SENTRY.torsoUp, 12);
    const flipped = [{...vols[2], a: vols[2].b!, b: vols[2].a}], o2 = {x: 0, y: 0, z: 0};
    expect(aimPoint(flipped, 'torso', o2)).toBe(true);
    expect(o2).toEqual(o);
    expect(aimPoint(vols, 'head', o)).toBe(true);
    expect(o).toEqual({x: 1, y: 1.6, z: 2});
    expect(aimPoint([vols[0]], 'torso', o)).toBe(false);
    expect(aimPoint([vols[0]], 'head', o)).toBe(false);
  });

  it('segment distances and the hold-fire test round a standing body', () => {
    const a = {x: 0, y: 0, z: 0}, b = {x: 10, y: 0, z: 0};
    expect(segmentPointDistance(a, b, {x: 5, y: 3, z: 4})).toBeCloseTo(5, 12);
    expect(segmentPointDistance(a, b, {x: -3, y: 4, z: 0})).toBeCloseTo(5, 12); // past the end: to the end point
    expect(segmentSegmentDistance(a, b, {x: 5, y: -1, z: 2}, {x: 5, y: 1, z: 2})).toBeCloseTo(2, 12);
    expect(segmentSegmentDistance(a, b, {x: 5, y: 1, z: 0}, {x: 5, y: 3, z: 0})).toBeCloseTo(1, 12);
    expect(segmentSegmentDistance(a, b, {x: 12, y: 0, z: 0}, {x: 14, y: 0, z: 0})).toBeCloseTo(2, 12); // collinear, apart
    expect(segmentSegmentDistance(a, b, {x: 2, y: 0, z: 1}, {x: 8, y: 0, z: 1})).toBeCloseTo(1, 12); // parallel
    expect(segmentSegmentDistance(a, a, {x: 0, y: 3, z: 4}, {x: 0, y: 3, z: 4})).toBeCloseTo(5, 12); // two points
    // a line of fire 4 m up to chest height 10 m away; a body (feet 0, eye 1.62) on it, beside it, beyond the target
    const p = {x: 0, y: 4, z: 0}, t = {x: 10, y: 1.3, z: 0};
    expect(clearOfBody(p, t, {x: 8, y: 0, z: 0}, 1.62)).toBe(false); // on the line
    expect(clearOfBody(p, t, {x: 8, y: 0, z: SENTRY.safeRadius - 0.05}, 1.62)).toBe(false);
    expect(clearOfBody(p, t, {x: 8, y: 0, z: SENTRY.safeRadius + 0.05}, 1.62)).toBe(true);
    expect(clearOfBody(p, t, {x: 2, y: 0, z: 0}, 1.62)).toBe(true); // near the car: the line passes well over the head
    expect(clearOfBody(p, t, {x: 10 + SENTRY.safeRadius + 0.05, y: 0, z: 0}, 1.62)).toBe(true); // behind the target
    expect(clearOfBody(p, t, {x: 10.3, y: 0, z: 0}, 1.62)).toBe(false); // right behind it: too close
  });
});
