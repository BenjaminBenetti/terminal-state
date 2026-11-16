// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane CARGO): THE DISTRICT CARGO RECORD IN THE SAVE (lane 'surface.cargo' of
// a `${station}:surface` memory; world/surface/cargoStore.ts, save/validate.ts lanes()):
//  - a district with its depot seeded (the marker), units lying in its equipment lane and units secured to the truck saves and validates
//    (the run and its Retry snapshot);
//  - the secured units share the run's ONE equipment scope: a uid secured AND lying anywhere / aboard is "in two places", the train's
//    counter is never behind a secured unit, a secured chest's stacks share the run's item uid set;
//  - the record's own shape: unknown fields, a bad marker, two units on one point, more than the bound, a malformed unit — refused;
//  - text -> parse -> the same record (JSON-safe, within the string limits).
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import type {SectionKey} from '../src/levels/types';
import {STATION_EQUIPMENT_LANE, freshEquipment, type EquipmentJSON} from '../src/craft/equipment';
import type {StackJSON} from '../src/items/inventory';
import {checksumOf} from '../src/save/checksum';
import {SAVE_LIMITS, validateSaveFile} from '../src/save/validate';
import {SURFACE_CARGO_LANE, SURFACE_CARGO_LIMITS, securedOf, surfaceCargoOf, surfaceCargoProblem, surfaceCargoRecord} from '../src/world/surface/cargoStore';
import {aboardRec, stationRec} from './helpers/trainEquipmentHost';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);

const HERE: SectionKey = {level: 'subway', section: 'main', station: sid(1)};
const DISTRICT: SectionKey = {level: 'subway', section: 'surface', station: sid(1)};
const memId = (k: SectionKey) => `${k.station}:${k.section}`;
const plain = (s: unknown): StackJSON => JSON.parse(JSON.stringify(s)) as StackJSON;

function harness(): Harness {
  const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1), sid(2)]}));
  hs.run.current = {...HERE};
  hs.run.memory().visits = 1;
  hs.run.memory(DISTRICT).visits = 1;
  return hs;
}

/** st-01's district: a seeded depot chest lying there (eq-1), a radar (eq-2) and a filled chest (eq-3) on the truck; a chest aboard (eq-4). */
function populated() {
  const hs = harness();
  const slots = (n: number) => { const out = new Array<StackJSON | null>(50).fill(null); out[0] = plain(hs.inv.makeStack('scrap_metal', n)); out[9] = plain(hs.inv.makeStack('water', 1)); return out; };
  const lying = [stationRec('chest', 1, 12.5, 0.1, 30.25, 0.5, 0, {slots: slots(2)})];
  const secured = [
    {point: 'bed-0', unit: stationRec('radar', 2, 20.1, 1.0, 31.5, -1.2, 0)},
    {point: 'bed-1', unit: stationRec('chest', 3, 20.9, 1.0, 31.5, -1.2, 0, {slots: slots(3)})},
  ];
  hs.run.setLaneStore(STATION_EQUIPMENT_LANE, {v: 1, here: lying}, DISTRICT);
  hs.run.setLaneStore(SURFACE_CARGO_LANE, surfaceCargoRecord(true, secured), DISTRICT);
  const aboard = [aboardRec('chest', 4, 1, 0.2, 0, {slots: slots(1)})];
  hs.train.equipment.load({v: 1, seq: 4, aboard});
  hs.takeEntry();
  return {hs, lying, secured, aboard};
}

describe('the district cargo record in the save', () => {
  it('a seeded district with units lying there and units secured to the truck validates; the record round-trips', () => {
    const {hs, secured} = populated();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test reads of untrusted data)
    const f = hs.file('arrival', 1) as any;
    const r = validateSaveFile(structuredClone(f));
    expect(r.ok, r.ok ? '' : (r as {error: string}).error).toBe(true);
    const rec = f.run.memories[memId(DISTRICT)].lanes[SURFACE_CARGO_LANE];
    expect(rec).toEqual({v: 1, seeded: 1, secured});
    expect(surfaceCargoProblem(rec)).toBeNull();
    expect(securedOf(JSON.parse(JSON.stringify(rec)))).toEqual(secured);
    // the Retry snapshot holds the district too (the station's scope): the same record
    expect(f.run.entry.memories[memId(DISTRICT)].lanes[SURFACE_CARGO_LANE]).toEqual(rec);
    expect(Object.keys(f.run.memories[memId(DISTRICT)].lanes).length).toBeLessThanOrEqual(SAVE_LIMITS.lanes);
  });

  it('one unit, one place run-wide; the counter never behind a secured unit; one item, one uid', () => {
    const {hs} = populated();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const base = hs.file('arrival', 1) as any;
    const cargo = (f: typeof base) => f.run.memories[memId(DISTRICT)].lanes[SURFACE_CARGO_LANE];
    const lane = (f: typeof base) => f.run.memories[memId(DISTRICT)].lanes[STATION_EQUIPMENT_LANE];
    const refuse = (mut: (f: typeof base) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    refuse(f => { cargo(f).secured[0].unit.uid = 'eq-1'; }, /equipment unit eq-1 is in two places/); // secured AND lying in the district
    refuse(f => { cargo(f).secured[1].unit.uid = 'eq-4'; }, /equipment unit eq-4 is in two places/); // secured AND aboard the train
    refuse(f => { lane(f).here[0].uid = 'eq-3'; }, /equipment unit eq-3 is in two places/);
    refuse(f => { f.run.memories[memId(HERE)].lanes[STATION_EQUIPMENT_LANE] = {v: 1, here: [stationRec('radar', 2, 1, 0, 1)]}; }, /equipment unit eq-2 is in two places/); // (another section)
    refuse(f => { f.run.entry.memories[memId(DISTRICT)].lanes[SURFACE_CARGO_LANE].secured[0].unit.uid = 'eq-1'; }, /equipment unit eq-1 is in two places/); // (the snapshot's own scope)
    refuse(f => { f.run.participants['player-train'].equipment.seq = 2; }, /eq-4 is newer than the train's counter|eq-3 is newer/);
    refuse(f => { f.run.participants['player-train'].equipment.aboard = []; f.run.participants['player-train'].equipment.seq = 2; }, /eq-3 is newer than the train's counter/);
    refuse(f => { cargo(f).secured[1].unit.slots[0].uid = lane(f).here[0].slots[0].uid; }, /duplicate item uid/);
  });

  it("the record's own shape: refused when malformed", () => {
    const unit = (n: number): EquipmentJSON => ({...freshEquipment('radar', `eq-${n}`, {x: 1, y: 1, z: 1, yaw: 0}), level: 0});
    expect(surfaceCargoProblem({v: 1})).toBeNull();
    expect(surfaceCargoProblem({v: 1, seeded: 1})).toBeNull();
    expect(surfaceCargoProblem(null)).toMatch(/must be an object/);
    expect(surfaceCargoProblem({v: 2})).toMatch(/version/);
    expect(surfaceCargoProblem({v: 1, seeded: true})).toMatch(/seeded/);
    expect(surfaceCargoProblem({v: 1, extra: 1})).toMatch(/unexpected/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: 'bed-0', unit: unit(1)}, {point: 'bed-0', unit: unit(2)}]})).toMatch(/two units on attachment point bed-0/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: 'bed-0', unit: unit(1)}, {point: 'bed-1', unit: unit(1)}]})).toMatch(/duplicate equipment unit eq-1/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: '', unit: unit(1)}]})).toMatch(/attachment point/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: 'x'.repeat(SURFACE_CARGO_LIMITS.pointChars + 1), unit: unit(1)}]})).toMatch(/attachment point/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: 'bed-0', unit: {...unit(1), level: undefined}}]})).toMatch(/level/);
    expect(surfaceCargoProblem({v: 1, secured: [{point: 'bed-0', unit: unit(1), x: 1}]})).toMatch(/unexpected/);
    const many = Array.from({length: SURFACE_CARGO_LIMITS.secured + 1}, (_, i) => ({point: `p${i}`, unit: unit(i + 1)}));
    expect(surfaceCargoProblem({v: 1, secured: many})).toMatch(/at most/);
    // a damaged record reads as none (never invented cargo); the writer keeps only what there is
    expect(surfaceCargoOf({v: 9})).toEqual({v: 1});
    expect(surfaceCargoRecord(false, [])).toBeUndefined();
    expect(surfaceCargoRecord(true, [])).toEqual({v: 1, seeded: 1});
  });

  it('the save validator refuses a malformed district cargo record', () => {
    const {hs} = populated();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
    const f = hs.file('arrival', 1) as any;
    f.run.memories[memId(DISTRICT)].lanes[SURFACE_CARGO_LANE].secured[1].point = 'bed-0';
    f.checksum = checksumOf(f.run);
    const r = validateSaveFile(f);
    expect(r.ok).toBe(false);
    expect((r as {error: string}).error).toMatch(/two units on attachment point bed-0/);
  });
});
