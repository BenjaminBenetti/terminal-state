// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): the command tent's doorway is a REAL opening (Node, the game's
// own collision: gen/levels.ts levelsOf + core/physics.ts PropIndex / moveCircle against the district's props and EVERY planned door's
// collision boxes at its generated state, exactly as world/surface/air.ts installs them — world/surface/airDoors.ts doorBoxes / fitDoorBoxes):
//  - flap SHUT: a walker heading out is stopped at the doorway (the shut flap's box; never a hole in the canvas);
//  - flap OPEN: the walker goes out through the doorway onto the plaza and back in — not a painted entrance or a flap over a solid wall;
//  - version 2: the walk starts standing in the cargo lift's car (the arrival) and goes out of its gate to the flap; version 1 from just
//    inside the flap (its arrival is unchanged; tests/surface-v1-compat.test.ts pins its bytes).
// tests/surface-lift-ride.test.ts repeats the open-flap walk with the real Player in a real Game.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../src/gen/surface/surfaceRun';
import {levelsOf} from '../src/gen/levels';
import {PropIndex, moveCircle} from '../src/core/physics';
import {doorBoxes, doorPoint, fitDoorBoxes, planSurfaceDoors, type SurfaceDoorState} from '../src/world/surface/airDoors';
import type {StationLayout} from '../src/gen/stationTypes';

const seeds = (host: SurfaceHost, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < n && s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) out.push(s);
  return out;
};
const district = (host: SurfaceHost, s: number, v: number): StationLayout => LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: v});
const levels0 = (L: StationLayout) => levelsOf(L);
const R = 0.3; // the player's radius (player/player.ts)
const SPEED = 4.5, DT = 1 / 60;

/** The district's collision world with the flap's boxes, as the air runtime installs them; the walker. */
function tentWorld(L: StationLayout) {
  const S = L.surface!, g0 = L.levels?.[0]?.grid ?? L.grid;
  const levels = levelsOf(L);
  const doors = planSurfaceDoors(S, g0, L.levels).map(plan => {
    const t = plan.gen === 'closed' ? 0 : 1;
    const d: SurfaceDoorState = {plan, t, target: t, auto: false, openedAt: NaN, clear: 0, push: 0, blocked: false, boxes: doorBoxes(plan), gas: false};
    fitDoorBoxes(d);
    return d;
  });
  const flap = doors.find(d => d.plan.tent)!, plan = flap.plan;
  const index = new PropIndex(levels, [...L.props, ...doors.flatMap(d => d.boxes)]);
  const setFlap = (t: number) => { flap.t = t; flap.target = t > 0.5 ? 1 : 0; fitDoorBoxes(flap); };
  /** Outward distance (m) past the tent's flap facade (+ outside). */
  const outward = (x: number, z: number) => ((plan.along === 'x' ? z : x) - plan.c) * (plan.n[0] + plan.n[1]);
  const walker = (x: number, z: number) => {
    const b = {x, z, feet: levels.floorAt(x, z, 0.2, 1)}; // (the tent / car floor: the plaza's kerb height)
    /** Walks toward waypoints (arrival radius 0.25 m) for at most `frames`; the frames used (Infinity: a waypoint never reached). */
    const walk = (pts: {x: number; z: number}[], frames = 900): number => {
      let k = 0;
      for (let f = 0; f < frames; f++) {
        while (k < pts.length && Math.hypot(pts[k].x - b.x, pts[k].z - b.z) < 0.25) k++;
        if (k >= pts.length) return f;
        const dx = pts[k].x - b.x, dz = pts[k].z - b.z, d = Math.hypot(dx, dz), s = Math.min(d, SPEED * DT);
        [b.x, b.z] = moveCircle(levels, index, b.x, b.z, dx / d * s, dz / d * s, R, b.feet);
        const f2 = levels.floorAt(b.x, b.z, b.feet);
        if (Number.isFinite(f2)) b.feet = f2;
      }
      return Infinity;
    };
    return {b, walk};
  };
  return {S, plan, flap, doors, setFlap, outward, walker};
}

describe('Surface Run: the command tent\'s doorway is a real opening (shut flap = a wall, open flap = walk out and back in)', () => {
  for (const v of [1, SURFACE_VERSION]) for (const host of ['subway', 'office', 'mall'] as const) {
    it(`version ${v}, ${host}: shut blocks; open walks out onto the plaza and back ${v >= 2 ? 'into the lift car' : 'inside'}`, () => {
      const s = seeds(host, 1)[0];
      const L = district(host, s, v);
      const {S, plan, doors, setFlap, outward, walker} = tentWorld(L);
      expect(plan.leaves.length, 'the flap has leaves').toBeGreaterThan(0);
      // one door in the doorway: the flap (the tent building's own 'open' entrance record is not a second leafed door over it)
      for (const d of doors) if (d !== doors.find(q => q.plan.tent)) {
        const p = d.plan, near = Math.abs(p.x - plan.x) < plan.width && Math.abs(p.z - plan.z) < plan.width;
        expect(near, `door ${p.id} in the tent's doorway`).toBe(false);
      }
      expect(plan.width).toBeGreaterThanOrEqual(1.5);
      const inside = doorPoint(plan, plan.a, 1.4), outside = doorPoint(plan, plan.a, -2.0);
      expect(outward(inside.x, inside.z)).toBeLessThan(0);
      expect(outward(outside.x, outside.z)).toBeGreaterThan(1.5);
      // the start: version 2 = the arrival standing in the car (its gate faces the flap); version 1 = just inside the flap
      const l = S.portal.lift;
      const start = v >= 2 ? {x: S.portal.pose.x, z: S.portal.pose.z} : inside;
      const route: {x: number; z: number}[] = [];
      if (l) {
        expect(S.portal.kind).toBe('lift');
        expect(Number.isFinite(levels0(L).floorAt(start.x, start.z, 0.2, 1)), 'the car has a floor').toBe(true);
        const n = l.doorSide === 'N' ? [0, -1] : l.doorSide === 'S' ? [0, 1] : l.doorSide === 'W' ? [-1, 0] : [1, 0];
        route.push({x: l.door.x - n[0] * 0.8, z: l.door.z - n[1] * 0.8}, {x: l.door.x + n[0] * 1.2, z: l.door.z + n[1] * 1.2});
      }
      route.push(inside, outside);
      // shut: the walker never passes the flap's facade
      setFlap(0);
      const w = walker(start.x, start.z);
      expect(w.walk(route)).toBe(Infinity);
      expect(outward(w.b.x, w.b.z), 'the shut flap stops the walker').toBeLessThan(0);
      expect(outward(w.b.x, w.b.z), '... at the doorway, not somewhere inside').toBeGreaterThan(-1.2);
      // open: out through the doorway, then back in (v2: back into the car)
      setFlap(1);
      const w2 = walker(start.x, start.z);
      expect(w2.walk(route), 'walked out through the open flap').toBeLessThan(Infinity);
      expect(outward(w2.b.x, w2.b.z)).toBeGreaterThan(1.5);
      const back = [...route].reverse().slice(1).concat([start]);
      expect(w2.walk(back), v >= 2 ? 'walked back into the lift car' : 'walked back in').toBeLessThan(Infinity);
      if (l) expect(w2.b.x > l.cab.x0 && w2.b.x < l.cab.x1 && w2.b.z > l.cab.z0 && w2.b.z < l.cab.z1).toBe(true);
    }, 60_000);
  }
});
