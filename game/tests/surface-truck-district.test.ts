// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK, follow-up): the truck on REAL generated Surface Run districts (lane GEN's
// generateSurfaceDistrict, three seeds x the three hosts) with the REAL vehicle controller driven by the player's keys only:
//  - it spawns at the generated `surface.truck` pose with clearance (its footprint on the compound's floor, nothing to push it out of);
//  - a scripted drive (W + steering along a street route from GEN's own vehicle rule, helpers/surfaceTruckDistrict.ts) leaves the
//    checkpoint's gate, crosses the kerbs (the compound / sidewalks at 0.15 m, the carriageway at 0) and reaches the depot's loading lot
//    without getting stuck; a zombie on the street ahead is run over on the way;
//  - a pile-up's rubble mound across a street and a wreck stop it (it never drives through them);
//  - its record (where it was left) persists across a teardown and a rebuild of the district.
import {describe, expect, it} from 'vitest';
import {PropIndex} from '../src/core/physics';
import {footprintFloor, settlePose} from '../src/world/skywaysCarPhysics';
import {SURFACE_TRUCK_LANE, type SurfaceTruckRecord} from '../src/world/surface/truckStore';
import {TRUCK_GEOM, TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {SURFACE_WRECK_KINDS} from '../src/gen/surface/kinds';
import type {SPose} from '../src/gen/surface/surfaceTypes';
import {build, frame, run, teardown, zombie} from './helpers/skywaysCarHost';
import {getInTruck, truckHost} from './helpers/surfaceTruckHost';
import {district, driveRoute, loadingLot, planRoute, type District} from './helpers/surfaceTruckDistrict';
import type {SurfaceHost} from '../src/gen/surface/surfaceRun';

const CASES: [number, SurfaceHost][] = [[3, 'subway'], [8, 'office'], [13, 'mall']];

/** The district with the truck at `pose` (default its generated pose): the controller over the district's real levels and props. */
function onDistrict(D: District, pose?: SPose) {
  return truckHost({levels: D.levels, props: D.L.props, pose: pose ?? D.S.truck});
}

const propIndexes = new WeakMap<District, PropIndex>();
/** A pose the truck may stand at (its footprint on one floor, nothing pushing it). */
function standable(D: District, p: SPose): boolean {
  if (footprintFloor(D.levels, p.x, p.z, p.yaw, p.y, p.level, TRUCK_GEOM) === null) return false;
  let props = propIndexes.get(D);
  if (!props) propIndexes.set(D, (props = new PropIndex(D.levels, D.L.props)));
  const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
  return settlePose({levels: D.levels, props}, TRUCK_GEOM, p.x, p.z, p.yaw, p.y, o) && Math.hypot(o.sx, o.sz) < 1e-6;
}

describe('the truck on generated Surface Run districts', () => {
  it('spawns at the generated pose with clearance (three seeds x hosts)', () => {
    for (const [seed, host] of CASES) {
      const D = district(seed, host), T = D.S.truck, {car, h} = onDistrict(D);
      expect(car.vehicle, `${seed}`).toBe('truck');
      const b = car.body!;
      expect([b.x, b.z, b.yaw, b.level], `${seed}`).toEqual([T.x, T.z, T.yaw, T.level]);
      expect(b.y).toBeCloseTo(T.y, 3);
      expect(footprintFloor(D.levels, b.x, b.z, b.yaw, b.y, b.level, TRUCK_GEOM), `${seed} footprint`).not.toBeNull();
      const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
      expect(settlePose({levels: D.levels, props: h.propIndex!}, TRUCK_GEOM, b.x, b.z, b.yaw, b.y, o)).toBe(true);
      expect(Math.hypot(o.sx, o.sz), `${seed}: nothing overlaps the parked truck`).toBeLessThan(1e-6);
      // the generated box is inside the checkpoint compound and the truck's whole body fits it (corners on its floor)
      const R = D.S.checkpoint.rect;
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const c = carToWorld(b.x, b.z, b.yaw, lx * TRUCK_SPEC.width / 2, lz * TRUCK_SPEC.length / 2);
        expect(c.x > R.x0 && c.x < R.x1 && c.z > R.z0 && c.z < R.z1, `${seed}: corner in the compound`).toBe(true);
      }
    }
  });

  it('drives out of the checkpoint gate over the kerbs to the depot loading lot without getting stuck, running over a zombie on the way', () => {
    for (const [seed, host] of CASES) {
      const D = district(seed, host), {car, h} = onDistrict(D), lot = loadingLot(D);
      getInTruck(h, car);
      const b0 = car.body!, route = planRoute(D, {x: b0.x, z: b0.z}, lot);
      expect(route, `${seed}: a street route exists`).not.toBeNull();
      // the route starts out of the compound through its gate (ahead of the parked truck, not behind it)
      const ahead = route![Math.min(route!.length - 1, 20)];
      expect((ahead.x - b0.x) * -Math.sin(b0.yaw) + (ahead.z - b0.z) * -Math.cos(b0.yaw), `${seed}: the way out is ahead`).toBeGreaterThan(0);
      let placed = false;
      const z = zombie(0, 0);
      const rep = driveRoute(h, car, route!, lot, {
        speed: 6.5,
        each: () => {
          const B = car.body!;
          // once out on the carriageway at speed: a zombie standing on the route ~16 m ahead
          if (placed || seed !== CASES[0][0] || B.y > 0.05 || B.v < 5.5) return;
          let i = 0, best = Infinity;
          for (let k = 0; k < route!.length; k++) { const d = Math.hypot(route![k].x - B.x, route![k].z - B.z); if (d < best) { best = d; i = k; } }
          const p = route![Math.min(route!.length - 1, i + 32)];
          if (Math.hypot(p.x - B.x, p.z - B.z) < 12) return;
          z.brain.x = p.x; z.brain.z = p.z; z.brain.y = 0;
          h.zombies.push(z);
          placed = true;
        },
      });
      expect(rep.stuck, `${seed}: stuck at route ${rep.reached}/${route!.length} after ${rep.seconds.toFixed(1)} s`).toBe(false);
      expect(rep.arrived, `${seed}: arrived`).toBe(true);
      const B = car.body!;
      expect(B.x > lot.x0 && B.x < lot.x1 && B.z > lot.z0 && B.z < lot.z1, `${seed}: parked in the loading lot`).toBe(true);
      expect(rep.driven, `${seed}`).toBeGreaterThan(60);
      // the kerbs: it left the raised compound (0.15) and drove the carriageway (0)
      expect(rep.maxY, `${seed}`).toBeCloseTo(0.15, 2);
      expect(rep.minY, `${seed}`).toBeCloseTo(0, 2);
      expect(B.level).toBe(0);
      if (seed === CASES[0][0]) {
        expect(placed).toBe(true);
        expect(h.kills.map(k => k.z), 'the zombie on the street was run over').toContain(z);
        expect(car.counts.kills).toBeGreaterThanOrEqual(1);
      }
    }
  }, 240000);

  it('a pile-up mound across a street and a street wreck stop it (it never drives through them)', () => {
    for (const [seed, host] of CASES) {
      const D = district(seed, host);
      // --- a pile-up: approach along its street from a standable pose, full throttle
      let tried = 0;
      for (const r of D.S.rubble!.filter(q => q.kind === 'pile-up')) {
        const st = D.S.streets[r.street!], ns = st.ax === st.bx, mid = ns ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
        let pose: SPose | null = null, dir = 0;
        for (const sgn of [-1, 1]) for (const gap of [4, 6, 9, 12, 16]) {
          if (pose) break;
          const edge = ns ? (sgn < 0 ? r.z0 : r.z1) : (sgn < 0 ? r.x0 : r.x1), at = edge + sgn * (gap + TRUCK_SPEC.length / 2);
          // heading toward the mound: forward = (-sin yaw, -cos yaw)
          const yaw = ns ? (sgn < 0 ? Math.PI : 0) : (sgn < 0 ? -Math.PI / 2 : Math.PI / 2);
          const p: SPose = ns ? {x: st.ax, z: at, yaw, level: 0, y: 0} : {x: at, z: st.az, yaw, level: 0, y: 0};
          if (standable(D, p)) { pose = p; dir = -sgn; }
        }
        if (!pose) continue;
        tried++;
        const {car, h} = onDistrict(D, pose);
        getInTruck(h, car);
        h.keys.held.add('KeyW');
        let deepest = -Infinity;
        run(h, car, 10, () => {
          const B = car.body!, along = (ns ? B.z : B.x) - mid;
          deepest = Math.max(deepest, along * dir); // (> 0: the centre past the mound's middle)
          return false;
        });
        h.keys.held.clear();
        expect(deepest, `seed ${seed}: ${st.name} mound — the truck stays before its middle`).toBeLessThan(-TRUCK_SPEC.length / 2 + 1);
        if (tried >= 2) break;
      }
      expect(tried, `seed ${seed}: a pile-up with a clear approach`).toBeGreaterThan(0);
      // --- a wreck on the street level: head-on along one of the axes
      const wrecks = D.L.props.map((p, i) => ({p, i})).filter(({p}) => (SURFACE_WRECK_KINDS as readonly string[]).includes(p.kind) && (p.level ?? 0) === 0);
      expect(wrecks.length, `seed ${seed}: wrecks`).toBeGreaterThan(0);
      let hit = 0;
      for (const {p} of wrecks) {
        let pose: SPose | null = null, ax: 'x' | 'z' = 'x', sgn = 1;
        for (const a of ['x', 'z'] as const) for (const s of [-1, 1]) for (const gap of [3, 5, 8]) {
          if (pose) break;
          const half = a === 'x' ? p.hx : p.hz, at = (a === 'x' ? p.x : p.z) + s * (half + gap + TRUCK_SPEC.length / 2);
          const yaw = a === 'z' ? (s < 0 ? Math.PI : 0) : (s < 0 ? -Math.PI / 2 : Math.PI / 2);
          const q: SPose = a === 'x' ? {x: at, z: p.z, yaw, level: 0, y: p.y} : {x: p.x, z: at, yaw, level: 0, y: p.y};
          if (standable(D, q)) { pose = q; ax = a; sgn = s; }
        }
        if (!pose) continue;
        const {car, h} = onDistrict(D, pose);
        getInTruck(h, car);
        h.keys.held.add('KeyW');
        const half = ax === 'x' ? p.hx : p.hz;
        let closest = Infinity;
        run(h, car, 6, () => { const B = car.body!; closest = Math.min(closest, ((ax === 'x' ? B.x : B.z) - (ax === 'x' ? p.x : p.z)) * sgn); return false; });
        h.keys.held.clear();
        // the nose never goes into the wreck's box (a little give: the circles' rim)
        expect(closest - TRUCK_SPEC.length / 2, `seed ${seed}: ${p.kind}`).toBeGreaterThan(half - 0.35);
        expect(car.counts.impacts, `seed ${seed}: ${p.kind} hit`).toBeGreaterThan(0);
        if (++hit >= 2) break;
      }
      expect(hit, `seed ${seed}: a wreck with a clear approach`).toBeGreaterThan(0);
    }
  }, 240000);

  it('its record — where it was left — persists across a teardown and a rebuild of the district', () => {
    const D = district(CASES[0][0], CASES[0][1]), {car, h} = onDistrict(D), lot = loadingLot(D);
    getInTruck(h, car);
    const b0 = car.body!, route = planRoute(D, {x: b0.x, z: b0.z}, lot)!;
    // part of the way: out of the gate and down the street
    const rep = driveRoute(h, car, route.slice(0, Math.floor(route.length / 3)), null, {speed: 6});
    expect(rep.stuck).toBe(false);
    frame(h, car);
    const left = {...car.body!};
    expect(Math.hypot(left.x - D.S.truck.x, left.z - D.S.truck.z)).toBeGreaterThan(20);
    teardown(h);
    const rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec).toMatchObject({v: 2, level: 0}); // (re-pin: record v2 carries the condition)
    expect(rec.x).toBeCloseTo(left.x, 3);
    expect(rec.z).toBeCloseTo(left.z, 3);
    build(h);
    const b = car.body!;
    expect(b.x).toBeCloseTo(left.x, 3);
    expect(b.z).toBeCloseTo(left.z, 3);
    expect(b.yaw).toBeCloseTo(left.yaw, 3);
    expect(b.y).toBeCloseTo(left.y, 3);
    // (not the generated pose) and drivable from there
    expect(Math.hypot(b.x - D.S.truck.x, b.z - D.S.truck.z)).toBeGreaterThan(20);
    expect(car.driving).toBe(false);
  }, 120000);
});
