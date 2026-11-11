// Task studio-beta-train-fuel-system-20261106-024923-01: fuel in SAVES — the train's tank + cargo (the 'player-train' participant), a
// station's fuel lane (realized flag + carts), the pending journey's one-time charge; validated strictly (a journey's draw must equal its
// cost), round-tripped exactly (text / export-import), and older saves without any fuel load (empty tank, no free fuel; their journeys
// resume free; their stations realize their fuel on the next build).
import {describe, expect, it} from 'vitest';
import {FUEL_LANE, type FuelDebit} from '../src/fuel/fuel';
import {checksumOf} from '../src/save/checksum';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

function harness(): Harness {
  const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
  h.run.current = {level: 'subway', section: 'main', station: sid(1)};
  h.run.memory().visits = 1;
  return h;
}
const can = (h: Harness, n: number) => { const s = h.inv.makeStack('fuel_can', 2); s.count = n; return s; };

describe('fuel in saves', () => {
  it('tank + cargo, chest cans, a station\'s fuel lane and a journey\'s charge round-trip exactly (text and validate)', () => {
    const h = harness();
    h.train.fuel.tank = 3;
    h.train.fuel.setCargo([{uid: 'cart:st-00', units: 6, x: -2.5, y: 0.98, z: 0.3, yaw: 1.2}]);
    h.train.lockbox.slots[4] = can(h, 2);
    h.run.setLaneStore(FUEL_LANE, {v: 1, realized: true, carts: [{uid: 'cart:st-01', units: 8, x: 12.5, y: 0, z: -3, yaw: 0.5, level: 0}]}, {level: 'subway', section: 'main', station: sid(0)});
    const debit: FuelDebit = {tank: 1, carts: [{uid: 'cart:st-00', units: 2}], chest: [{uid: h.train.lockbox.slots[4]!.uid, count: 1}]};
    h.run.campaign!.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false, fuel: {cost: 4, debit}};
    const file = h.file('departure', 1);
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const run = (p as {value: SaveFileV1Like}).value.run;
    expect((run.participants['player-train'] as Any).fuel).toEqual({v: 1, tank: 3, cargo: [{uid: 'cart:st-00', units: 6, x: -2.5, y: 0.98, z: 0.3, yaw: 1.2}]});
    expect(run.campaign.transit).toMatchObject({fuel: {cost: 4, debit}});
    expect((run.memories[`${sid(0)}:main`].lanes as Any)[FUEL_LANE]).toEqual({v: 1, realized: true, carts: [{uid: 'cart:st-01', units: 8, x: 12.5, y: 0, z: -3, yaw: 0.5, level: 0}]});
  });

  it('malformed fuel is refused (with the checksum fixed): tank 17, a cart with 9 units, duplicate carts, a charge that does not add up', () => {
    const h = harness();
    h.train.fuel.tank = 2;
    h.run.campaign!.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false, fuel: {cost: 4, debit: {tank: 2, carts: [], chest: [{uid: 900001, count: 2}]}}};
    const base = h.file('departure', 1) as Any;
    expect(validateSaveFile(structuredClone(base)).ok).toBe(true);
    const rejects = (mut: (f: Any) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    rejects(f => { f.run.participants['player-train'].fuel.tank = 17; }, /train fuel 17 out of range/); // (task gameplay-feedback-20261111 lane TRAVEL: the train holds four tanks = 16; was 9 past two)
    rejects(f => { f.run.participants['player-train'].fuel.cargo = [{uid: 'c', units: 9, x: 0, y: 0, z: 0, yaw: 0}]; }, /units 9 out of range/);
    rejects(f => { const c = {uid: 'c', units: 1, x: 0, y: 0, z: 0, yaw: 0}; f.run.participants['player-train'].fuel.cargo = [c, c]; }, /duplicate fuel cart/);
    rejects(f => { f.run.campaign.transit.fuel.cost = 8; }, /fuel drawn does not match/);
    rejects(f => { f.run.campaign.transit.fuel.debit.chest[0].count = 3; }, /chest/);
    rejects(f => { f.run.memories[`${sid(0)}:main`] = {visits: 1, pickups: null, holders: {}, killed: [], cleared: false, lanes: {[FUEL_LANE]: {v: 1, realized: 'yes', carts: []}}}; }, /realized/);
  });

  it('a v2 station record (task fuel-feedback: + its realized holder lots) round-trips; a malformed lot list is refused', () => {
    const h = harness();
    const key = {level: 'subway' as const, section: 'main', station: sid(0)};
    h.run.memory(key).holders['shelf@0:120,-340'] = {lots: [2003, 2900], open: true, searched: true};
    h.run.setLaneStore(FUEL_LANE, {v: 2, realized: true, carts: [], lots: ['shelf@0:120,-340#2900', 'crate@0:5,6#900']}, key);
    const file = h.file('arrival', 1) as Any;
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const mem = (p as {value: SaveFileV1Like}).value.run.memories[`${sid(0)}:main`];
    expect((mem.lanes as Any)[FUEL_LANE]).toEqual({v: 2, realized: true, carts: [], lots: ['shelf@0:120,-340#2900', 'crate@0:5,6#900']});
    const bad = structuredClone(file);
    bad.run.memories[`${sid(0)}:main`].lanes[FUEL_LANE].lots = ['shelf@0:120,-340#2900', 'shelf@0:120,-340#2900'];
    bad.checksum = checksumOf(bad.run);
    const r = validateSaveFile(bad);
    expect(r.ok).toBe(false);
    expect((r as {error: string}).error).toMatch(/duplicate station fuel lot/);
  });

  it('an older save (no fuel anywhere) still loads: an empty tank and no cargo; its pending journey resumes free', () => {
    const h = harness();
    h.run.campaign!.transit = {from: sid(1), to: sid(2), phase: 'departing', cheat: false};
    const f = h.file('departure', 1) as Any;
    delete f.run.participants['player-train'].fuel;
    f.checksum = checksumOf(f.run);
    const r = validateSaveFile(f);
    expect(r.ok, r.ok ? '' : (r as {error: string}).error).toBe(true);
    const b = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
    b.train.fuel.tank = 4;
    b.train.participant().load((r as {value: SaveFileV1Like}).value.run.participants['player-train']);
    expect(b.train.fuel.toJSON()).toEqual({v: 1, tank: 0, cargo: []}); // never invented fuel
    expect((r as {value: SaveFileV1Like}).value.run.campaign.transit).toEqual({from: sid(1), to: sid(2), phase: 'departing', cheat: false});
  });
});
