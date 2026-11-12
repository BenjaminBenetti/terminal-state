// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): THE SENTRY'S OWN-HULL RULE and VIRTUAL ORIGIN (craft/sentry.ts), and its
// small pure helpers.
//  - the turret's geometry on the roof (pivot above the roof's crest, muzzle, aim angles, reach / sweep);
//  - own hull: a target right beside the car under the eaves is refused, one ~6 m out on the platform is allowed — both sides, all
//    along the car; never along the roof, never into the car; the DEAD ZONE beside the car measured for a real zombie's chest / head
//    height on the platform and in the track bed (written to $LL_SENTRY_HULL_OUT when set);
//  - the virtual origin against the REAL parked car's collider boxes (world/playerTrain.ts through the real runtime on a generated
//    layout): it lies outside every box of the car, and the bullet's world ray from it never hits the car — while the same ray cast
//    from the pivot itself is stopped by the car's coarse roof box (why the rule exists);
//  - the target order (nearest clear, bounded line tests, the range), the aim point, the body-clearance distances.
import {appendFileSync, writeFileSync} from 'node:fs';
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {loadZombieModels, placeZombie, sentryWorld, teardownSentryWorlds} from './helpers/sentryFixture';
import {raycastWorld} from '../src/combat/hitscan';
import {raycastShot} from '../src/physics/merchOnHost';
import {trainToWorld} from '../src/gen/playerTrain';
import type {PropPlacement} from '../src/gen/props';
import {TRAIN_TURRET_MEASURED as TM} from '../src/assets/trainEquipment.generated';
import {
  SENTRY, aimAngles, aimPoint, barrelDir, clearOfBody, hullExit, ownHullClear, pickTarget, planSpan, segmentPointDistance,
  segmentSegmentDistance, turnToward, turretMuzzle, turretPivot, turretReach, turretSweep, wrapAngle, type V3,
} from '../src/craft/sentry';
import {TRAIN_ROOF_PROFILE, roofTopAt, turretMount} from '../src/craft/trainFixtures';
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
const PIV = turretPivot(SPEC);

/** The own-hull verdict for a train-local aim point: within the elevation stops, over the roof, out of the outline. */
function hullOk(to: V3): boolean {
  const dx = to.x - PIV.x, dy = to.y - PIV.y, dz = to.z - PIV.z, d = Math.hypot(dx, dy, dz), dir = {x: dx / d, y: dy / d, z: dz / d};
  const pitch = Math.asin(dir.y);
  if (pitch < SENTRY.pitchMin || pitch > SENTRY.pitchMax) return false;
  return ownHullClear(PIV, dir, d, SPEC) && hullExit(PIV, dir, d, SPEC) !== null;
}

/** The dead zone beside the car: the distance from the car's SIDE (m) from which a point at height y, `along` m along the car from the turret, can be shot. */
function deadZone(y: number, side: -1 | 1, along = 0): number {
  let first = NaN;
  for (let k = 1; k <= 2600; k++) {
    const D = k * 0.01, ok = hullOk({x: PIV.x + along, y, z: side * (HW + D)});
    if (ok && Number.isNaN(first)) first = D;
    if (!Number.isNaN(first) && D > first + 0.15) expect(ok, `clear at ${D} m once clear at ${first} m`).toBe(true); // (no holes farther out)
  }
  return first;
}

describe('sentry turret: geometry on the roof', () => {
  it('the pivot stands on the yaw axis above the roof crest; the numbers the rules use', () => {
    const m = turretMount(SPEC);
    expect(PIV).toEqual({x: m.x, y: m.y + TM.pitchPivot.y, z: m.z});
    expect(Math.abs(m.z)).toBe(0);
    expect(Math.abs(m.x)).toBeLessThan(HL - 1);
    // a cook check: a lower tilt axis and the dead zone beside the car swallows the platform
    expect(PIV.y - roofTopAt(0)).toBeGreaterThanOrEqual(SENTRY.pivotClearMin);
    expect(roofTopAt(0)).toBe(Math.max(...TRAIN_ROOF_PROFILE.map(r => r[1])));
    expect(turretReach()).toBeGreaterThanOrEqual(TM.size.h);
    expect(turretSweep()).toBeGreaterThan(TM.muzzle.z);
    expect(SENTRY.weapon).toBe('rifle');
    expect(WEAPONS[SENTRY.weapon].caliber).toBe('5.56x45mm'); // the hopper's rounds are the rifle's
    expect(SENTRY.range).toBeLessThan(WEAPONS[SENTRY.weapon].range);
  });

  it('muzzle, aim angles and barrel direction agree (yaw about +Y from +Z, pitch up positive)', () => {
    const m = turretMount(SPEC);
    const m0 = turretMuzzle(0, 0);
    expect(m0.x).toBeCloseTo(m.x + TM.muzzle.x, 9); expect(m0.y).toBeCloseTo(m.y + TM.muzzle.y, 9); expect(m0.z).toBeCloseTo(m.z + TM.muzzle.z, 9);
    const mx = turretMuzzle(Math.PI / 2, 0); // turned to +X
    expect(mx.x).toBeCloseTo(m.x + TM.muzzle.z, 9); expect(mx.z).toBeCloseTo(m.z, 9);
    const up = turretMuzzle(0, 20 * DEG), dn = turretMuzzle(0, -30 * DEG);
    expect(up.y).toBeGreaterThan(m0.y); expect(dn.y).toBeLessThan(m0.y);
    for (const [yaw, pitch] of [[0, 0], [1.1, 0.2], [-2.6, -0.5], [Math.PI, 0.1]]) {
      const d = barrelDir(yaw, pitch), a = aimAngles(d);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
      expect(wrapAngle(a.yaw - yaw)).toBeCloseTo(0, 9); expect(a.pitch).toBeCloseTo(pitch, 9);
      // the muzzle is ahead of the pivot along the barrel
      const mz = turretMuzzle(yaw, pitch), f = {x: mz.x - PIV.x, y: mz.y - PIV.y, z: mz.z - PIV.z}, l = Math.hypot(f.x, f.y, f.z);
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
    platform = s.stand(PIV.x, -(HW + 2))!.y - s.p.railTopY;
    bed = s.lay.trench.floorY - s.p.railTopY;
    teardownSentryWorlds();
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
      expect(hullOk({x, y: platform + chest, z}), `fore / aft x ${x} z ${z}`).toBe(false);
      expect(hullOk({x, y: bed + chest, z})).toBe(false);
    }
    // inside the car (the saloon, the cab), on its roof
    for (const x of [PIV.x, 0, 5, -6]) for (const z of [0, 0.9, -0.9]) {
      expect(hullOk({x, y: SPEC.floorY + chest, z})).toBe(false);
      expect(hullOk({x: x + 0.7, y: roofTopAt(z) + 0.0, z})).toBe(false);
    }
    // the pieces: a ray that starts under the roof outline is refused; one that never crosses the outline is free
    expect(ownHullClear({x: 0, y: 3.0, z: 0}, {x: 0, y: 0, z: 1}, 10, SPEC)).toBe(false);
    expect(ownHullClear({x: 0, y: 3.0, z: HW + 0.5}, {x: 0, y: 0, z: 1}, 10, SPEC)).toBe(true);
    expect(ownHullClear(PIV, {x: 0, y: 1, z: 0}, 10, SPEC)).toBe(true); // (straight up: over the roof all the way)
    expect(ownHullClear(PIV, {x: 0, y: -1, z: 0}, 10, SPEC)).toBe(false);
    // the margin: level over the crest is clear, grazing it is not
    expect(ownHullClear({x: PIV.x, y: roofTopAt(0) + SENTRY.hullMargin + 0.001, z: 0}, {x: 1, y: 0, z: 0}, 30, SPEC)).toBe(true);
    expect(ownHullClear({x: PIV.x, y: roofTopAt(0) + SENTRY.hullMargin - 0.001, z: 0}, {x: 1, y: 0, z: 0}, 30, SPEC)).toBe(false);
  });

  it('the dead zone beside the car, measured (a real zombie on the real platform / in the bed)', () => {
    const rows: string[] = [];
    const zone = (label: string, y: number) => {
      const a = deadZone(y, -1), b = deadZone(y, 1), far = Math.max(deadZone(y, -1, 5), deadZone(y, -1, -4), deadZone(y, 1, 9));
      rows.push(`${label}: clear from ${a.toFixed(2)} m off the car's side (other side ${b.toFixed(2)} m; diagonal shots along the car up to ${far.toFixed(2)} m)`);
      expect(b).toBeCloseTo(a, 9); // the roof outline is symmetric
      expect(far).toBeLessThanOrEqual(a + 0.25); // the same strip all along the car
      return a;
    };
    out(`pivot ${PIV.y.toFixed(3)} m over the rail top = ${(PIV.y - roofTopAt(0)).toFixed(3)} m over the roof crest; platform ${platform.toFixed(2)} m, bed ${bed.toFixed(2)} m over the rail top; zombie chest aim ${chest.toFixed(2)} m, head ${head.toFixed(2)} m over its feet`);
    const pc = zone('platform, chest', platform + chest), ph = zone('platform, head ', platform + head);
    const bc = zone('track bed, chest', bed + chest), bh = zone('track bed, head ', bed + head);
    for (const r of rows) out(r);
    // what was found (the provisional turret constants): a strip about 3 m wide at chest height on the platform, narrower for the head
    expect(pc).toBeGreaterThan(2.4); expect(pc).toBeLessThan(3.8);
    expect(ph).toBeGreaterThan(1.7); expect(ph).toBeLessThan(pc);
    expect(bc).toBeGreaterThan(pc); expect(bc).toBeLessThan(8.5);
    expect(bh).toBeLessThan(bc);
    // and the reason is the roof, not the elevation stop: the steepest clear line is shallower than pitchMin
    const steep = Math.atan2(PIV.y - (platform + chest), HW + pc);
    expect(steep).toBeLessThan(-SENTRY.pitchMin);
  });
});

describe('sentry virtual origin', () => {
  it('hullExit: where the line leaves the outline, a push outside it; 0 when already outside; null when the aim point is on the car', () => {
    const d = {x: 0, y: 0, z: -1};
    const t = hullExit(PIV, d, 30, SPEC)!;
    expect(t).toBeCloseTo(HW + SENTRY.hullPush, 9);
    const diag = {x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2}, td = hullExit(PIV, diag, 30, SPEC)!;
    expect(Math.abs(PIV.z + diag.z * td)).toBeCloseTo(HW + SENTRY.hullPush, 9);
    expect(hullExit({x: 0, y: 4, z: HW + 0.5}, d, 30, SPEC)).toBe(0);
    expect(hullExit(PIV, d, 1.2, SPEC)).toBeNull();
    expect(hullExit(PIV, {x: 0, y: 1, z: 0}, 30, SPEC)).toBeNull();
    // toward the front end: through the end of the outline
    expect(hullExit(PIV, {x: 1, y: 0, z: 0}, 30, SPEC)).toBeCloseTo(HL + SENTRY.hullPush - PIV.x, 9);
    const span: [number, number] = [0, 0];
    expect(planSpan(PIV, d, 30, HL, HW, span)).toBe(true);
    expect(span[0]).toBe(0); expect(span[1]).toBeCloseTo(HW, 9);
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
    const piv = s.pivot();
    let lines = 0, carHitsFromPivot = 0;
    for (let yaw = 0; yaw < 360; yaw += 6) for (let pitch = -35; pitch <= 20; pitch += 2.5) {
      const dl = barrelDir(yaw * DEG, pitch * DEG);
      if (!ownHullClear(PIV, dl, 30, SPEC)) continue;
      const tx = hullExit(PIV, dl, 30, SPEC);
      if (tx === null) continue;
      lines++;
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
    expect(lines).toBeGreaterThan(300);
    // why the virtual origin exists: the car's roof BOX is coarser than its roof — many lines that clear the real roof are stopped by it
    expect(carHitsFromPivot).toBeGreaterThan(50);
  });

  it('a shot at the platform 6 m out: clear over the real roof, stopped by the roof box from the pivot, free from the virtual origin', () => {
    const s = sentryWorld();
    const car = new Set<PropPlacement>(s.rt.train!.layoutBoxes);
    const feet = s.stand(PIV.x, -(HW + 6))!;
    const to = {x: feet.x, y: feet.y + 1.3, z: feet.z}, piv = s.pivot();
    const d = Math.hypot(to.x - piv.x, to.y - piv.y, to.z - piv.z), dw = {x: (to.x - piv.x) / d, y: (to.y - piv.y) / d, z: (to.z - piv.z) / d};
    const dl = {x: dw.x * s.p.front, y: dw.y, z: dw.z * s.p.front};
    expect(ownHullClear(PIV, dl, d, SPEC)).toBe(true);
    const fromPivot = raycastWorld(s.levels, s.lay.props, piv, dw, d, s.lay.trench.floorY);
    expect(fromPivot.kind).toBe('prop');
    expect(car.has(s.lay.props[fromPivot.prop!])).toBe(true);
    expect(fromPivot.t).toBeLessThan(HW + 0.5);
    const tx = hullExit(PIV, dl, d, SPEC)!, o = {x: piv.x + dw.x * tx, y: piv.y + dw.y * tx, z: piv.z + dw.z * tx};
    const fromOrigin = raycastWorld(s.levels, s.lay.props, o, dw, d - tx, s.lay.trench.floorY);
    expect(fromOrigin.kind === 'none' || fromOrigin.t >= d - tx - SENTRY.reach).toBe(true);
    expect(s.levels.lineOfSight(o, to)).toBe(true);
    expect(s.sys.clearTo(to, s.p)).toBe(true);
    // under the eaves: refused by the system as a whole
    const near = trainToWorld(s.p, PIV.x, 0, -(HW + 0.6));
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
