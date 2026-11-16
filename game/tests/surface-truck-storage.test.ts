// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's STORAGE COMPARTMENTS (world/surface/truckStorage.ts) and its
// RECORD (world/surface/truckStore.ts, save/validate.ts): finite compartments measured on the cooked model; [E] on a compartment from
// beside the truck through the vehicle controller's handler (refused seated / from the other side / far / in a car world); transfers
// keep the item's identity (uid, count) through the view, getting out, teardown and the next build; the inventory's uid counter stays
// above them; the record validator (exact keys, ranges, slot counts) and a saved run carrying it (validated with the run-wide uid set:
// a uid also carried is refused; restored exactly).
import {describe, expect, it} from 'vitest';
import type {SlotRef, StoreSideRef} from '../src/items/inventory';
import {stackToJSON} from '../src/items/inventory';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {carToWorld} from '../src/world/skywaysCarSpec';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {TRUCK_COMPARTMENT_BOXES, TRUCK_STORAGE_TEXT, truckStorageView} from '../src/world/surface/truckStorage';
import {SURFACE_TRUCK_LANE, TRUCK_COMPARTMENTS, TRUCK_RECORD_LIMITS, emptyTruckStorage, surfaceTruckProblem, surfaceTruckRecord, type SurfaceTruckRecord} from '../src/world/surface/truckStore';
import {TRUCK_SPEC} from '../src/world/surface/truckSpec';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {build, frame, lookAt, press, run, teardown} from './helpers/skywaysCarHost';
import {getInTruck, setTruckLayout, truckHost, type TruckTestHost} from './helpers/surfaceTruckHost';
import type {SkywaysCar} from '../src/world/skywaysCar';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;
const P = (index: number): SlotRef => ({bar: 'pack', index});
const SP = (index: number): StoreSideRef => ({bar: 'pack', index} as StoreSideRef);

/** Stand beside compartment i (outside its face, `out` m off it), look at its door. */
function standBy(h: TruckTestHost, car: SkywaysCar, i: number, out = 0.6): void {
  const b = car.body!, c = TRUCK_COMPARTMENT_BOXES[i], zc = (c.z0 + c.z1) / 2;
  const at = carToWorld(b.x, b.z, b.yaw, c.faceX + c.side * out, zc), face = carToWorld(b.x, b.z, b.yaw, c.faceX, zc);
  h.player.place(at.x, at.z, 0, b.y);
  frame(h, car);
  lookAt(h, face.x, b.y + (c.y0 + c.y1) / 2, face.z);
  frame(h, car);
}

describe('surface truck storage: the compartments', () => {
  it('two FINITE compartments measured on the model: the left locker (12 slots) and the right locker (6), below the bed, on their sides', () => {
    expect(TRUCK_COMPARTMENTS.map(c => [c.id, c.slots])).toEqual([['left-locker', 12], ['right-locker', 6]]);
    for (const c of TRUCK_COMPARTMENT_BOXES) {
      expect(c.y1).toBeLessThanOrEqual(TRUCK_ANCHORS.bed.y0); // (under the load floor: never in the cargo's space)
      expect(c.y0).toBeGreaterThan(0.5); // (above the wheels' hubs: a locker, not the road)
      expect(Math.sign(c.faceX)).toBe(c.side);
      expect(Math.abs(c.faceX)).toBeLessThanOrEqual(TRUCK_SPEC.width / 2 + 1e-6);
      expect(Math.abs(c.faceX)).toBeGreaterThan(TRUCK_SPEC.width / 2 - 0.25);
      expect(c.x1 - c.x0).toBeGreaterThan(0.25);
      expect(truckStorageView(c)).toMatchObject({slots: c.slots, name: c.name, columns: 6});
    }
  });

  it('[E] on the left locker from beside the truck opens it; a stack moved in keeps its uid through getting in / out, teardown and the next build', () => {
    const {h, car, storage} = truckHost({storage: true});
    const water = h.inv.makeStack('water', 3), uid = water.uid;
    h.inv.set(P(0), water);
    standBy(h, car, 0);
    expect(car.prompt).toBe(TRUCK_STORAGE_TEXT.open('Left locker'));
    press(h, car, 'KeyE');
    expect(storage!.openId).toBe('left-locker');
    expect(car.driving).toBe(false); // (one action per press: the compartment, not the seat)
    expect(storage!.view!.quick(SP(0))).toBe(3);
    expect(h.inv.get(P(0))).toBeNull();
    const k = storage!.stores[0].slots.findIndex(s => s !== null);
    expect(storage!.stores[0].slots[k]).toMatchObject({uid, itemId: 'water', count: 3});
    storage!.close('user');
    // getting in closes nothing open; getting out writes the record with the stack (its uid)
    getInTruck(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    let rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(surfaceTruckProblem(rec)).toBeNull();
    expect(rec.storage[0][k]).toEqual({uid, itemId: 'water', count: 3});
    expect(rec.storage[0].filter(Boolean)).toHaveLength(1);
    // teardown + the next build: the record's stacks back in the live store (never doubled), the uid counter above them
    teardown(h);
    rec = h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord;
    expect(rec.storage[0][k]).toEqual({uid, itemId: 'water', count: 3});
    expect(storage!.stores[0].used).toBe(0);
    build(h);
    expect(car.source).toBe('record');
    expect(storage!.loaded).toBe(true);
    expect(storage!.stores[0].slots[k]).toMatchObject({uid, itemId: 'water', count: 3});
    expect(storage!.stores.reduce((n, s) => n + s.used, 0)).toBe(1);
    expect(h.inv.makeStack('water', 1).uid).toBeGreaterThan(uid);
    // taken back out: the same stack in the pack, the compartment empty, the record follows at the next write
    standBy(h, car, 0);
    press(h, car, 'KeyE');
    expect(storage!.view!.quick({bar: 'store', index: k} as StoreSideRef)).toBe(3);
    const refs: SlotRef[] = [...[...Array(5).keys()].map(i => ({bar: 'hotbar', index: i} as SlotRef)), ...[...Array(12).keys()].map(P)];
    const back = refs.map(r => h.inv.get(r)).find(s => s?.itemId === 'water');
    expect(back).toMatchObject({uid, count: 3});
    storage!.close('user');
    car.store();
    expect((h.store.get(SURFACE_TRUCK_LANE) as SurfaceTruckRecord).storage[0].filter(Boolean)).toHaveLength(0);
  });

  it('the right locker opens from the right side only; refused seated, far away, from the other side and in a car world', () => {
    const {h, car, storage} = truckHost({storage: true});
    standBy(h, car, 1);
    expect(car.prompt).toBe(TRUCK_STORAGE_TEXT.open('Right locker'));
    expect(storage!.aimed()).toBe(true);
    expect(storage!.qa().aimed).toBe('right-locker');
    // far: 3 m off the face
    standBy(h, car, 1, 3);
    expect(storage!.aimed()).toBe(false);
    // from the other side (standing by the left locker, looking across at the right one through the truck): not by it
    standBy(h, car, 0);
    const b = car.body!, c = TRUCK_COMPARTMENT_BOXES[1], rf = carToWorld(b.x, b.z, b.yaw, c.faceX, (c.z0 + c.z1) / 2);
    lookAt(h, rf.x, b.y + 1, rf.z);
    frame(h, car);
    expect(storage!.qa().aimed).not.toBe('right-locker');
    // seated: E gets out first; the compartments are never aimed
    getInTruck(h, car);
    expect(storage!.aimed()).toBe(false);
    expect(storage!.open('left-locker')).toBe(false);
    press(h, car, 'KeyE');
    // a car world: the compartments are not loaded, never open
    teardown(h);
    setTruckLayout(h, null);
    build(h);
    expect(car.vehicle).toBe('car');
    expect(storage!.loaded).toBe(false);
    expect(storage!.open('left-locker')).toBe(false);
    expect(storage!.stores.every(s => s.used === 0)).toBe(true);
  });

  it('the open view closes when the truck moves away or someone gets in, and walking off', () => {
    const {h, car, storage} = truckHost({storage: true});
    standBy(h, car, 0);
    press(h, car, 'KeyE');
    expect(storage!.isOpen).toBe(true);
    const P0 = h.player;
    P0.place(P0.x, P0.z - 4, 0, 0);
    run(h, car, 0.1);
    expect(storage!.isOpen).toBe(false);
    expect(storage!.lastClose).toBe('distance');
    standBy(h, car, 0);
    press(h, car, 'KeyE');
    car.body!.x += 0.5;
    run(h, car, 0.05);
    expect(storage!.isOpen).toBe(false);
    expect(storage!.lastClose).toBe('moved');
  });
});

describe('surface truck record: validator and saves', () => {
  it('the record validator: exact keys, finite bounded numbers, the compartments\' slot counts', () => {
    const ok = surfaceTruckRecord(12.34567, 0, -8, 7, 0, {lights: true});
    expect(surfaceTruckProblem(ok)).toBeNull();
    expect(ok.yaw).toBeGreaterThan(-Math.PI - 1e-9);
    expect(ok.yaw).toBeLessThanOrEqual(Math.PI);
    expect(ok.x).toBe(12.3457);
    const bad = (mut: (r: Any) => void) => { const r = structuredClone(ok) as Any; mut(r); return surfaceTruckProblem(r); };
    expect(bad(r => { r.extra = 1; })).toMatch(/unexpected truck field/);
    expect(bad(r => { delete r.lights; })).toMatch(/missing truck field/);
    expect(bad(r => { r.v = 2; })).toMatch(/version/);
    expect(bad(r => { r.x = Infinity; })).toMatch(/position/);
    expect(bad(r => { r.x = TRUCK_RECORD_LIMITS.pos * 2; })).toMatch(/position/);
    expect(bad(r => { r.level = 1.5; })).toMatch(/storey/);
    expect(bad(r => { r.lights = 1; })).toMatch(/lights/);
    expect(bad(r => { r.storage = [r.storage[0]]; })).toMatch(/2 compartments/);
    expect(bad(r => { r.storage[1] = r.storage[1].slice(1); })).toMatch(/right-locker must list 6 slots/);
    expect(bad(r => { r.storage[0][2] = 'water'; })).toMatch(/malformed truck left-locker slot/);
    expect(surfaceTruckProblem(null)).toMatch(/object/);
    expect(emptyTruckStorage().map(c => c.length)).toEqual([12, 6]);
  });

  const KEY = {level: 'subway' as const, section: 'surface', station: sid(1)};
  const memId = `${sid(1)}:surface`;

  function truckRun() {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    const a = h.inv.makeStack('water', 2), b = h.inv.makeStack('bandage', 1);
    const storage = emptyTruckStorage();
    storage[0][4] = stackToJSON(a);
    storage[1][0] = stackToJSON(b);
    h.run.memory(KEY).visits = 1;
    h.run.setLaneStore(SURFACE_TRUCK_LANE, surfaceTruckRecord(40.5, 0, 22.25, 1.5, 0, {lights: true, storage}), KEY);
    return {h, a, b, storage};
  }

  it('a run with the truck lane in its district memory validates and restores exactly (pose, lamps, every stack\'s uid)', () => {
    const {h, a, b} = truckRun();
    const file = h.file('arrival', 1);
    const parsed = parseSaveText(saveFileText(file));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const saved = (parsed.value.run as Any).memories[memId].lanes[SURFACE_TRUCK_LANE] as SurfaceTruckRecord;
    expect(saved).toMatchObject({v: 1, x: 40.5, z: 22.25, yaw: 1.5, lights: true});
    expect(saved.storage[0][4]).toEqual({uid: a.uid, itemId: 'water', count: 2});
    expect(saved.storage[1][0]).toEqual({uid: b.uid, itemId: 'bandage', count: 1});
    const back = new Harness();
    expect(restoreRun(parsed.value.run, back.target()).failed).toEqual([]);
    expect(back.run.laneStore(SURFACE_TRUCK_LANE, KEY)).toEqual(saved);
    expect(saveFileText(back.file('arrival', 1)) === saveFileText(file)).toBe(true);
  });

  it('refused: a compartment uid also carried (one item, one uid run-wide), a malformed stack, a malformed record', () => {
    const {h, a} = truckRun();
    const file = h.file('arrival', 1);
    expect(validateSaveFile(structuredClone(file)).ok).toBe(true);
    const rejects = (mut: (run: Any) => void, re: RegExp, what: string) => {
      const f = structuredClone(file) as Any;
      mut(f.run);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok, what).toBe(false);
      expect((r as {error: string}).error, what).toMatch(re);
    };
    const lane = (run: Any) => run.memories[memId].lanes[SURFACE_TRUCK_LANE];
    rejects(run => { run.carry.inventory.pack[0] = {uid: a.uid, itemId: 'water', count: 1}; }, /uid/, 'the same uid carried');
    rejects(run => { lane(run).storage[1][3] = {uid: a.uid, itemId: 'water', count: 1}; }, /uid/, 'the same uid in two compartments');
    rejects(run => { lane(run).storage[0][0] = {uid: 99991, itemId: 'no-such-item', count: 1}; }, /no-such-item|unknown item/, 'an unknown item');
    rejects(run => { lane(run).storage[0][0] = {uid: 99992, itemId: 'water', count: 0}; }, /count/, 'a zero count');
    rejects(run => { lane(run).storage[0].push(null); }, /12 slots/, 'a slot too many');
    rejects(run => { lane(run).fuel = 3; }, /unexpected truck field 'fuel'/, 'no fuel');
    rejects(run => { lane(run).yaw = 'north'; }, /heading/, 'a bad heading');
  });
});
