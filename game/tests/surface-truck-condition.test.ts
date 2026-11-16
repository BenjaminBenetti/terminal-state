// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE TRUCK'S PERSISTENT CONDITION (world/surface/truckCondition.ts,
// truckConditionRuntime.ts, the record v2 in truckStore.ts) on the REAL vehicle controller:
//  - one number drives everything: the stages (smoking, heavy smoke, burning, broken down) and the mobility (lower top speed and pull,
//    no speed snap; broken down: no drive, the brakes on — and the driver still gets out);
//  - shown: grey-to-dark smoke (never green) as sprite billows + one volumetric plume, flames and the fire loop only when burning; the fire
//    eats the rest while the district is live; a broken-down engine never starts (the stall take);
//  - persistent: in the record (v2) through getting out, teardown / rebuild, a save + Continue and the Retry snapshot; never healed by
//    re-entry; a v1 record (an older save) upgrades once to sound with everything else exact;
//  - damage never touches the compartments' stacks, a secured-cargo record or the parked pose.
import {describe, expect, it} from 'vitest';
import {stackToJSON} from '../src/items/inventory';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {smokeTint} from '../src/render/smoke';
import {TRUCK_GEOM, TRUCK_PHYS} from '../src/world/surface/truckSpec';
import {SURFACE_TRUCK_LANE, emptyTruckStorage, surfaceTruckProblem, surfaceTruckRecord, truckConditionValue, upgradeTruckRecord, type SurfaceTruckRecord} from '../src/world/surface/truckStore';
import {TRUCK_CONDITION, TRUCK_CONDITION_TEXT, truckDisabled, truckFireLevel, truckMobility, truckSmokeLevel, truckStage, truckStateOf, tuneTruck} from '../src/world/surface/truckCondition';
import {NO_CONTROLS} from '../src/world/skywaysCarPhysics';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {build, press, run, teardown} from './helpers/skywaysCarHost';
import {getInTruck} from './helpers/surfaceTruckHost';
import {fieldHost, flatLevels} from './helpers/surfaceTruckFieldHost';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test reads of untrusted data)
type Any = any;
const LONG = {levels: flatLevels(220, 30), pose: {x: 20, z: 15}};

/** Seated, full throttle for `s` seconds from rest: the speed reached. */
function throttle(c: number, s = 5): number {
  const {h, car, sys} = fieldHost(LONG);
  sys.condition.setCondition(c);
  getInTruck(h, car);
  h.keys.held.add('KeyW');
  run(h, car, s);
  h.keys.held.clear();
  return car.body!.v;
}

describe('truck condition: the rules', () => {
  it('one number: the stages, the smoke / fire levels and the mobility (monotone; full above `full`, none broken down)', () => {
    expect([1, 0.74, 0.49, 0.24, 0].map(truckStage)).toEqual(['sound', 'smoking', 'heavy', 'burning', 'disabled']);
    let last = {speed: 2, accel: 2};
    for (let c = 1; c >= -1e-9; c -= 0.05) {
      const m = truckMobility(Math.max(0, c));
      expect(m.speed).toBeLessThanOrEqual(last.speed + 1e-12);
      expect(m.accel).toBeLessThanOrEqual(last.accel + 1e-12);
      last = m;
    }
    expect(truckMobility(TRUCK_CONDITION.full)).toEqual({speed: 1, accel: 1});
    expect(truckMobility(0)).toEqual({speed: 0, accel: 0});
    expect(truckMobility(1e-4).speed).toBeCloseTo(TRUCK_CONDITION.speedMin, 3);
    expect([truckSmokeLevel(TRUCK_CONDITION.smoke), truckSmokeLevel(0)]).toEqual([0, 1]);
    expect([truckFireLevel(TRUCK_CONDITION.fire), truckFireLevel(0)]).toEqual([0, 1]);
    expect(truckFireLevel(TRUCK_CONDITION.fire - 1e-6)).toBeGreaterThan(0.3);
    expect([truckDisabled(0), truckDisabled(1e-4)]).toEqual([true, false]);
    // stored values never cross the ends by rounding (no free heal, no phantom breakdown)
    expect([truckConditionValue(0.99996), truckConditionValue(0.00004), truckConditionValue(NaN), truckConditionValue(-2), truckConditionValue(0.42)]).toEqual([0.9999, 1e-4, 1, 0, 0.42]);
  });

  it('the per-step tune: a sound truck steps TRUCK_GEOM itself; worn, a reused scaled copy; broken down, no drive and the brakes on', () => {
    const st = truckStateOf({}), ctl = {...NO_CONTROLS, forward: true};
    st.condition = 0.9;
    expect(tuneTruck(st, ctl, 5, 1 / 60, () => {})).toBe(TRUCK_GEOM);
    expect(ctl.forward).toBe(true);
    st.condition = 0.3;
    const g = tuneTruck(st, ctl, 2, 1 / 60, () => {});
    expect(g).toBe(st.geom);
    expect(g.phys!.forwardMax).toBeCloseTo(TRUCK_PHYS.forwardMax * truckMobility(0.3).speed, 6);
    expect(g.phys!.accel).toBeCloseTo(TRUCK_PHYS.accel * truckMobility(0.3).accel, 6);
    expect(tuneTruck(st, ctl, 2, 1 / 60, () => {})).toBe(g); // (no allocation per step)
    const notes: string[] = [];
    st.condition = 0;
    const d = tuneTruck(st, ctl, 0, 1 / 60, t => notes.push(t));
    expect([ctl.forward, ctl.back, d.phys!.accel, d.phys!.reverseAccel]).toEqual([false, false, 0, 0]);
    expect(d.phys!.roll).toBe(TRUCK_PHYS.brake + TRUCK_PHYS.roll);
    expect(notes).toEqual([TRUCK_CONDITION_TEXT.dead]);
    expect(TRUCK_PHYS.forwardMax).toBe(12.5); // (the truck's own numbers untouched)
  });
});

describe('truck condition: mobility on the vehicle controller', () => {
  it('progressively worse: a lower top speed and pull as the condition falls', () => {
    const v = [1, 0.6, 0.3, 0.05].map(c => throttle(c));
    for (let i = 1; i < v.length; i++) expect(v[i], `condition step ${i}`).toBeLessThan(v[i - 1] - 0.3);
    expect(v[3]).toBeLessThanOrEqual(TRUCK_PHYS.forwardMax * truckMobility(0.05).speed + 0.05);
    expect(v[0]).toBeGreaterThan(TRUCK_PHYS.forwardMax * 0.85);
  });

  it('no speed snap: dropped below the speed it is doing, the truck labours down (bounded per frame) to the lower cap', () => {
    const {h, car, sys} = fieldHost(LONG);
    getInTruck(h, car);
    h.keys.held.add('KeyW');
    run(h, car, 4);
    const v0 = car.body!.v;
    expect(v0).toBeGreaterThan(9);
    sys.condition.setCondition(0.3);
    const cap = TRUCK_PHYS.forwardMax * truckMobility(0.3).speed;
    let last = v0, worst = 0;
    for (let i = 0; i < 240; i++) { run(h, car, 1 / 60); worst = Math.max(worst, last - car.body!.v); last = car.body!.v; }
    expect(worst).toBeLessThan(0.12); // (labour 2.5 m/s² + drag: never a snap)
    expect(car.body!.v).toBeLessThanOrEqual(cap + 0.05);
    expect(car.body!.v).toBeGreaterThan(cap - 0.6);
  });

  it('broken down: it does not move from rest (the pedal noted), at speed it brakes to rest — and the driver still gets out', () => {
    const {h, car, sys} = fieldHost(LONG);
    sys.condition.setCondition(0);
    getInTruck(h, car);
    expect(car.driving).toBe(true);
    const x0 = car.body!.x;
    h.keys.held.add('KeyW');
    run(h, car, 3);
    expect(Math.abs(car.body!.x - x0)).toBeLessThan(0.02);
    expect(h.toasts).toContain(TRUCK_CONDITION_TEXT.dead);
    h.keys.held.clear();
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    // at speed: broken down mid-drive -> the brakes on, under the exit speed in under 2 s, out
    const w = fieldHost(LONG);
    getInTruck(w.h, w.car);
    w.h.keys.held.add('KeyW');
    run(w.h, w.car, 4);
    w.sys.condition.setCondition(0);
    expect(w.log.stalls).toBe(1); // (the engine dies: the stall take)
    const t = run(w.h, w.car, 3, () => Math.abs(w.car.body!.v) < 0.05);
    expect(t).toBeLessThan(2);
    w.h.keys.held.clear();
    press(w.h, w.car, 'KeyE');
    expect(w.car.driving).toBe(false);
    // getting back in: the engine never starts (the stall take, no engine start)
    const starts = w.h.sfxCalls.filter(s => s === 'engine:start').length;
    getInTruck(w.h, w.car);
    expect(w.h.sfxCalls.filter(s => s === 'engine:start').length).toBe(starts);
    expect(w.log.stalls).toBe(2);
  });
});

describe('truck condition: smoke and fire', () => {
  it('smoking: grey sprite billows + one volumetric plume (never green), darker as it falls; no flames', () => {
    const {h, car, sys, log} = fieldHost();
    run(h, car, 0.5);
    expect([log.smokeCalls, log.flameCalls, log.plumes.length]).toEqual([0, 0, 0]); // (sound: nothing)
    sys.condition.setCondition(0.6);
    run(h, car, 0.5);
    expect(log.smokeCalls).toBeGreaterThan(20);
    expect(log.flameCalls).toBe(0);
    expect(log.plumes).toHaveLength(1);
    const dark06 = log.lastDark;
    const tint = (c: unknown) => smokeTint(c as [number, number, number]);
    const t06 = tint(log.plumes[0].opts.color);
    expect(t06[1], 'not green').toBeLessThanOrEqual(Math.max(t06[0], t06[2]) + 1e-9);
    sys.condition.setCondition(0.3);
    run(h, car, 0.5);
    expect(log.lastDark).toBeGreaterThan(dark06);
    expect(log.plumes).toHaveLength(1); // (the same plume, updated: never a second emitter)
    const t03 = tint(log.plumes[0].opts.color);
    expect(t03[1], 'not green').toBeLessThanOrEqual(Math.max(t03[0], t03[2]) + 1e-9);
    expect(log.plumes[0].opts.density!).toBeGreaterThan(0.5);
    expect(h.toasts).toContain(TRUCK_CONDITION_TEXT.smoking);
  });

  it('burning below `fire`: flames, the fire catching once, the fire-bed loop; the fire eats the rest while the district is live', () => {
    const {h, car, sys, log} = fieldHost();
    sys.condition.setCondition(0.2);
    run(h, car, 0.5);
    expect(log.flameCalls).toBeGreaterThan(20);
    expect(log.cues.filter(c => c === 'fireCatch')).toHaveLength(1);
    expect(log.loops.filter(l => l.cue === 'fireBurn' && l.playing)).toHaveLength(1);
    expect(h.toasts).toContain(TRUCK_CONDITION_TEXT.burning);
    const c0 = sys.condition.condition;
    run(h, car, 10);
    expect(sys.condition.condition).toBeCloseTo(c0 - 10 * TRUCK_CONDITION.burnPerS, 3);
    // torn down: nothing burns, every handle dropped; rebuilt: it burns again from the record (no heal, no re-roll)
    const c1 = sys.condition.condition;
    teardown(h);
    expect(log.loops.every(l => !l.playing)).toBe(true);
    expect(log.plumes.every(p => !p.alive)).toBe(true);
    const rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec.condition).toBe(truckConditionValue(c1));
    build(h);
    expect(sys.condition.condition).toBe(rec.condition);
    const flames = log.flameCalls;
    run(h, car, 0.3);
    expect(log.flameCalls).toBeGreaterThan(flames);
    expect(log.loops.filter(l => l.playing)).toHaveLength(1);
    expect(log.cues.filter(c => c === 'fireCatch')).toHaveLength(1); // (already burning: it does not "catch" again)
  });
});

describe('truck condition: persistence', () => {
  it('in the record (v2) through getting out, teardown and rebuild; never healed by re-entry', () => {
    const {h, car, sys} = fieldHost();
    sys.condition.setCondition(0.42);
    getInTruck(h, car);
    press(h, car, 'KeyE');
    let rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(surfaceTruckProblem(rec)).toBeNull();
    expect([rec.v, rec.condition]).toEqual([2, 0.42]);
    for (let i = 0; i < 3; i++) {
      teardown(h);
      build(h);
      expect(car.source).toBe('record');
      expect(sys.condition.condition).toBe(0.42);
    }
    // a Continue = a fresh session over the stored record: the same condition
    const fresh = fieldHost({build: false});
    fresh.h.store.set(SURFACE_TRUCK_LANE, structuredClone(rec));
    build(fresh.h);
    expect(fresh.sys.condition.condition).toBe(0.42);
    rec = fresh.h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec.condition).toBe(0.42);
  });

  const KEY = {level: 'subway' as const, section: 'surface', station: sid(1)};
  const memId = `${sid(1)}:surface`;

  it('a saved run carries it: validated, restored exactly (Continue) and in the Retry snapshot; a v1 record in an older save still validates', () => {
    const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    const a = hs.inv.makeStack('water', 2), storage = emptyTruckStorage();
    storage[0][3] = stackToJSON(a);
    hs.run.memory(KEY).visits = 1;
    hs.run.setLaneStore(SURFACE_TRUCK_LANE, surfaceTruckRecord(40.5, 0, 22.25, 1.5, 0, {lights: false, storage, condition: 0.1234}), KEY);
    hs.takeEntry();
    const file = hs.file('arrival', 1) as Any;
    const parsed = parseSaveText(saveFileText(file));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const saved = (parsed.value.run as Any).memories[memId].lanes[SURFACE_TRUCK_LANE] as SurfaceTruckRecord;
    expect(saved).toMatchObject({v: 2, x: 40.5, z: 22.25, yaw: 1.5, condition: 0.1234});
    expect(saved.storage[0][3]).toEqual({uid: a.uid, itemId: 'water', count: 2});
    expect((parsed.value.run as Any).entry.memories[memId].lanes[SURFACE_TRUCK_LANE]).toEqual(saved); // (the Retry snapshot)
    const back = new Harness();
    expect(restoreRun(parsed.value.run, back.target()).failed).toEqual([]);
    expect(back.run.laneStore(SURFACE_TRUCK_LANE, KEY)).toEqual(saved);
    // an older save: the same record as v1 (no condition) validates; out-of-range conditions are refused
    const v1 = structuredClone(file);
    const lane = v1.run.memories[memId].lanes[SURFACE_TRUCK_LANE];
    lane.v = 1;
    delete lane.condition;
    v1.run.entry.memories[memId].lanes[SURFACE_TRUCK_LANE] = structuredClone(lane);
    v1.checksum = checksumOf(v1.run);
    expect(validateSaveFile(v1).ok).toBe(true);
    for (const bad of [-0.1, 1.5, 'x']) {
      const f = structuredClone(file);
      f.run.memories[memId].lanes[SURFACE_TRUCK_LANE].condition = bad;
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok, String(bad)).toBe(false);
      expect((r as {error: string}).error).toMatch(/truck condition/);
    }
  });

  it('a v1 record upgrades once: sound, the pose / lamps / slots exactly as stored; written back as v2', () => {
    const {h, car, sys, storage} = fieldHost({build: false});
    const stack = h.inv.makeStack('bandage', 2), slots = emptyTruckStorage();
    slots[1][2] = stackToJSON(stack);
    const v2 = surfaceTruckRecord(11.25, 0, 16.5, 0.75, 0, {lights: true, storage: slots});
    const {condition: _c, ...rest} = v2;
    const v1 = {...rest, v: 1 as const};
    expect(surfaceTruckProblem(v1)).toBeNull();
    expect(upgradeTruckRecord(v1)).toEqual(v2);
    h.store.set(SURFACE_TRUCK_LANE, structuredClone(v1));
    build(h);
    expect(car.source).toBe('record');
    expect(sys.condition.condition).toBe(1);
    expect([car.body!.x, car.body!.z, car.body!.yaw, car.lights]).toEqual([11.25, 16.5, 0.75, true]);
    expect(storage.stores[1].slots[2]).toMatchObject({uid: stack.uid, itemId: 'bandage', count: 2});
    car.store();
    expect(h.store.get(SURFACE_TRUCK_LANE)).toEqual(v2);
  });
});

describe('truck condition: never the lockers, the cargo or the pose', () => {
  it('hits, the fire and a breakdown leave the compartments\' stacks, a secured-cargo record and the parked pose exactly as they were', () => {
    const {h, car, sys, storage} = fieldHost();
    const water = h.inv.makeStack('water', 3);
    storage.stores[0].slots[5] = water;
    const cargo = {v: 1, seeded: 1, secured: [{point: 'bed-front-left', unit: {uid: 'eq-7'}}]};
    h.store.set('surface.cargo', structuredClone(cargo));
    car.store();
    const before = structuredClone(h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord);
    teardown(h);
    build(h); // (the pose as the record keeps it, 0.1 mm / 1e-4 rad)
    const pose = {x: car.body!.x, y: car.body!.y, z: car.body!.z, yaw: car.body!.yaw};
    const attach = JSON.stringify(car.truckAttachPoints());
    getInTruck(h, car);
    for (let i = 0; i < 40; i++) sys.condition.shieldHit(10, car.body!.x + 3, car.body!.z, 'claw');
    sys.condition.setCondition(0.1);
    run(h, car, 5);
    sys.condition.setCondition(0);
    run(h, car, 1);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    teardown(h);
    build(h);
    const after = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(after.storage).toEqual(before.storage);
    expect(storage.stores[0].slots[5]).toMatchObject({uid: water.uid, itemId: 'water', count: 3});
    expect(storage.stores.reduce((n, s) => n + s.used, 0)).toBe(1);
    expect(h.store.get('surface.cargo')).toEqual(cargo);
    expect({x: after.x, y: after.y, z: after.z, yaw: after.yaw}).toEqual({x: before.x, y: before.y, z: before.z, yaw: before.yaw});
    expect({x: car.body!.x, y: car.body!.y, z: car.body!.z, yaw: car.body!.yaw}).toEqual(pose);
    expect(JSON.stringify(car.truckAttachPoints())).toBe(attach);
    expect(after.condition).toBe(0);
  });
});
