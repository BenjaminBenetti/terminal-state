// Task studio-beta-skyways-vehicle-20261107-054512-01: the prize car on real Skyways stair flights (world/skywaysCarPhysics.ts carPose /
// settlePose; the Grid.ramps pitch-line model). The flights are DISCOVERED in generated layouts (no pinned coordinates: the Skyways
// architecture changes): from a clear, settled pose in line with a flight's foot the car is driven straight at it and from its head down
// it. Every frame: the pose satisfies the floor rule (carPose), the body is settled (never inside a wall / rail / prop / soffit), the pitch
// stays within CAR_STAIRS.maxPitch; across the layouts at least one flight is climbed to the next storey and one descended to the one
// below. A flight narrower than the body (1.5 m) is never entered (stopped like a wall, never clipped through).
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf, type Levels} from '../src/gen/levels';
import type {Ramp} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {CAR_STAIRS, NO_CONTROLS, carPose, settlePose, stepCar, type CarBody} from '../src/world/skywaysCarPhysics';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import * as THREE from 'three';
import {CAR_TEXT} from '../src/world/skywaysCar';
import {SKYWAYS_CAR_LANE} from '../src/world/skywaysCarStore';
import {DT as HDT, build, carHost, frame, lookAt, press, run, teardown} from './helpers/skywaysCarHost';

const DT = 1 / 60;
const G = CAR_SPEC;

interface World { L: Levels; props: PropIndex }
const worlds: World[] = [1, 7, 42].map(seed => {
  const l = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
  const L = levelsOf(l);
  return {L, props: new PropIndex(L, l.props)};
});

function flights(L: Levels): Ramp[] {
  const seen = new Set<string>(), out: Ramp[] = [];
  for (let k = 0; k < L.count; k++) for (const r of L.grid(k).ramps) {
    const key = `${r.x},${r.y},${r.axis}`;
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out;
}
const widthOf = (r: Ramp) => (r.axis === 'z' ? r.w : r.h) * 0.5;

const settled = (w: World, b: CarBody): boolean => {
  const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
  return settlePose({levels: w.L, props: w.props}, G, b.x, b.z, b.yaw, b.y, o, b.pitch ?? 0) && Math.hypot(o.sx, o.sz) < 0.01;
};

/** A clear settled pose 4 m out from a flight's foot / head, heading along it toward the flight (null: none there). */
function startAt(w: World, r: Ramp, from: 'foot' | 'head'): CarBody | null {
  const lowS = r.h0 < r.h1 ? r.s0 : r.s1, highS = r.h0 < r.h1 ? r.s1 : r.s0, dir = Math.sign(highS - lowS);
  const c = r.axis === 'z' ? (r.x + r.w / 2) * 0.5 : (r.y + r.h / 2) * 0.5;
  const s = from === 'foot' ? lowS - dir * 4 : highS + dir * 4, y = from === 'foot' ? Math.min(r.h0, r.h1) : Math.max(r.h0, r.h1);
  const head = from === 'foot' ? dir : -dir;
  const x = r.axis === 'z' ? c : s, z = r.axis === 'z' ? s : c;
  const yaw = r.axis === 'z' ? (head > 0 ? Math.PI : 0) : (head > 0 ? -Math.PI / 2 : Math.PI / 2);
  const p = carPose(w.L, x, z, yaw, y, 0, 0, G);
  if (!p) return null;
  const b: CarBody = {x, y: p.y, z, yaw, v: 0, steer: 0, level: p.level, yawRate: 0, pitch: p.pitch};
  return settled(w, b) ? b : null;
}

/** Drive straight for `secs`, checking the invariants every frame. */
function drive(w: World, b: CarBody, secs: number): {minY: number; maxY: number; maxPitch: number} {
  let minY = b.y, maxY = b.y, maxPitch = 0;
  for (let t = 0; t < secs; t += DT) {
    stepCar(b, {levels: w.L, props: w.props}, G, {...NO_CONTROLS, forward: true}, DT);
    expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)).toBe(true);
    expect(Math.abs(b.pitch ?? 0)).toBeLessThanOrEqual(CAR_STAIRS.maxPitch + 1e-6);
    expect(carPose(w.L, b.x, b.z, b.yaw, b.y, b.pitch ?? 0, b.level, G), 'the pose keeps the floor rule').not.toBeNull();
    expect(settled(w, b), 'never inside a wall / rail / prop / soffit').toBe(true);
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y); maxPitch = Math.max(maxPitch, Math.abs(b.pitch ?? 0));
  }
  return {minY, maxY, maxPitch};
}

describe('the prize car on real stair flights', () => {
  it('climbs a wide flight to the next storey and drives down one to the storey below (straight, settled, within the pitch limit)', () => {
    let climbed = 0, descended = 0, tried = 0;
    for (const w of worlds) {
      for (const r of flights(w.L).filter(f => widthOf(f) >= 2.4)) {
        const lo = Math.min(r.h0, r.h1), hi = Math.max(r.h0, r.h1);
        const up = startAt(w, r, 'foot');
        if (up) {
          tried++;
          const s = drive(w, up, 6);
          if (s.maxY > hi - 0.05) {
            climbed++;
            expect(s.maxPitch).toBeGreaterThan(0.45); // it really pitched up the 30° flight
            expect(up.level).not.toBe(startAt(w, r, 'foot')!.level); // a storey up
          }
        }
        const down = startAt(w, r, 'head');
        if (down) {
          tried++;
          const s = drive(w, down, 6);
          if (s.minY < lo + 0.05) descended++;
        }
      }
    }
    expect(tried).toBeGreaterThanOrEqual(4);
    expect(climbed).toBeGreaterThanOrEqual(2);
    expect(descended).toBeGreaterThanOrEqual(2);
  }, 120000);

  it('a flight narrower than the body (1.5 m) is never entered: it stops at it like a wall, never clipping through', () => {
    let met = 0;
    for (const w of worlds) {
      for (const r of flights(w.L).filter(f => widthOf(f) < 2)) {
        for (const from of ['foot', 'head'] as const) {
          const b = startAt(w, r, from);
          if (!b) continue;
          met++;
          const y0 = b.y, s = drive(w, b, 4);
          expect(s.maxY - y0).toBeLessThanOrEqual(0.05); // never onto it
          expect(y0 - s.minY).toBeLessThanOrEqual(0.05);
        }
      }
    }
    expect(met).toBeGreaterThanOrEqual(2);
  }, 120000);

  it('a pose on a flight: carPose rests it on its axles (pitch along the flight); a stored mid-flight pose is found again from a flat hint', () => {
    for (const w of worlds) {
      const r = flights(w.L).find(f => widthOf(f) >= 2.4 && startAt(w, f, 'foot'));
      if (!r) continue;
      const b = startAt(w, r, 'foot')!;
      // drive until the body is fully on the flight
      for (let t = 0; t < 4 && Math.abs(b.pitch ?? 0) < 0.5; t += DT) stepCar(b, {levels: w.L, props: w.props}, G, {...NO_CONTROLS, forward: true}, DT);
      expect(Math.abs(b.pitch ?? 0)).toBeGreaterThan(0.45);
      // a build reads the stored pose with flat / up / down hints (world/skywaysCar.ts onBuild: CAR_STAIRS.loadPitches)
      const found = CAR_STAIRS.loadPitches.map(p => carPose(w.L, b.x, b.z, b.yaw, b.y, p, b.level, G)).find(Boolean);
      expect(found).toBeTruthy();
      expect(found!.y).toBeCloseTo(b.y, 2);
      expect(found!.pitch).toBeCloseTo(b.pitch ?? 0, 2);
      return;
    }
    throw new Error('no drivable flight in these layouts');
  }, 120000);

  it('seated on a flight (the real runtime): the view and the seat pitch with the car, the camera tilts with it; it parks there and comes back there', () => {
    const w = worlds.find(q => flights(q.L).some(f => widthOf(f) >= 2.4 && startAt(q, f, 'foot')))!;
    const r = flights(w.L).find(f => widthOf(f) >= 2.4 && startAt(w, f, 'foot'))!;
    const s0 = startAt(w, r, 'foot')!;
    const {h, car} = carHost({levels: w.L, props: w.props.props as never, spawn: {x: s0.x, y: s0.y, z: s0.z, yaw: s0.yaw, level: s0.level}});
    // get in at the driver's door (the left one)
    const b = car.body!, e = CAR_SPEC.exits.left, door = carToWorld(b.x, b.z, b.yaw, -(CAR_SPEC.width / 2 - 0.05), e.z), st = carToWorld(b.x, b.z, b.yaw, e.x, e.z);
    h.player.place(st.x, st.z, 0, b.y);
    frame(h, car);
    lookAt(h, door.x, b.y + 0.9, door.z);
    frame(h, car);
    expect(car.prompt).toBe(CAR_TEXT.getIn);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
    // up the flight until fully pitched
    h.keys.held.add('KeyW');
    run(h, car, 4, () => Math.abs(car.body!.pitch ?? 0) > 0.5);
    h.keys.held.clear();
    h.keys.held.add('Space'); // (the handbrake holds it on the slope)
    run(h, car, 0.5);
    const p = car.body!.pitch ?? 0;
    expect(p).toBeGreaterThan(0.45);
    // the car's view: yaw then the pitch about its own lateral axis
    expect(car.view!.group.rotation.x).toBeCloseTo(p, 6);
    expect(car.view!.group.rotation.order).toBe('YXZ');
    // the seat rides the pitch: the eye is the car-frame eye turned by the pitch, then placed by the yaw
    const B = car.body!, E = CAR_SPEC.eye;
    const local = new THREE.Vector3(E.x, E.y, E.z).applyEuler(new THREE.Euler(p, B.yaw, 0, 'YXZ'));
    expect(h.player.eye).toBeCloseTo(B.y + local.y, 4);
    expect(h.player.x).toBeCloseTo(B.x + local.x, 4);
    expect(h.player.z).toBeCloseTo(B.z + local.z, 4);
    // the camera tilts with the body (Game.updateCamera's hook): its forward pitches up by the car's pitch when looking ahead
    h.player.yaw = B.yaw; h.player.pitch = 0;
    h.camera.rotation.set(0, B.yaw, 0);
    car.tiltCamera(h.camera);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(h.camera.quaternion);
    expect(Math.asin(fwd.y)).toBeCloseTo(p, 4);
    // getting out on the flight: on a free stand point of the flight's floor (front / back: its sides are railed), else "No room"
    car.body!.v = 0;
    press(h, car, 'KeyE');
    if (car.driving) expect(h.toasts.at(-1)).toBe(CAR_TEXT.noRoom);
    else {
      const P = h.player, sp = w.L.supportIn(P.x, P.z, P.y + 0.05, 0.3);
      expect(sp).not.toBeNull();
      expect(Math.abs(sp!.floor - P.y)).toBeLessThan(0.05); // standing on the floor there
      expect(w.L.circleClear(P.x, P.z, P.radius, P.y)).toBe(true); // not in a wall
    }
    // stored on the flight and back on it after a rebuild (not at the spawn)
    car.store();
    const rec = h.store.get(SKYWAYS_CAR_LANE) as {x: number; y: number; z: number};
    teardown(h);
    build(h);
    expect(car.source).toBe('record');
    expect(car.body!.y).toBeCloseTo(rec.y, 3);
    expect(car.body!.pitch ?? 0).toBeCloseTo(p, 2);
    void HDT;
  }, 120000);
});

