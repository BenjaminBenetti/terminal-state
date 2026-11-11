// Task studio-corpse-chipper-fuel-20261110-235304-01: the chipper's exact yield (1 body = 0.1 standard tank = 0.4 quarter), its atomic
// credit, its finite buffer, the whole-quarter transfer and the record's validation / persistence through the player-train participant.
import {describe, expect, it} from 'vitest';
import {CHIPPER, CHIPPER_REFUSAL, GrindClock, TANK_TICKS, chipperProblem, chipperRefusal, creditTankText, freshChipper, grind, jobProgress, startJob, transferToTank, type ChipperJSON} from '../src/fuel/chipperFuel';
import {FUEL} from '../src/fuel/fuel';
import {corpseFeedable, CORPSE_TRAITS} from '../src/ai/corpseTrait';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {ENEMY_FAMILY_IDS} from '../src/ai/spawnTables';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {checksumOf} from '../src/save/checksum';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';

const body = (i: number, arch: BodyRecordJSON['arch'] = 'zombie'): BodyRecordJSON =>
  ({id: `subway:main#${i}`, arch, seed: 1234, type: 'shambler', pose: 'lying', x: 2, y: 1, z: 0.9, q: [0, 0, 0, 1]});

/** Feed + grind one body to completion in 1/60 s frames; returns the credit. */
function chipOne(c: ChipperJSON, i: number) {
  startJob(c, body(i));
  const clock = new GrindClock();
  let credit = null, frames = 0;
  while (!credit) { credit = grind(c, clock.take(1 / 60)); frames++; if (frames > 5000) throw new Error('never finished'); }
  return {credit, frames};
}

describe('chipper fuel: exact integer yield', () => {
  it('one body = 0.1 standard tank = 2 ticks = 0.4 quarter', () => {
    expect(TANK_TICKS).toBe(FUEL.tankUnits * CHIPPER.ticksPerQuarter);
    expect(CHIPPER.bodyTicks / TANK_TICKS).toBe(0.1);
    expect(CHIPPER.bodyTicks / CHIPPER.ticksPerQuarter).toBe(0.4);
    // the existing units are unchanged
    expect(FUEL).toMatchObject({tankUnits: 4, trainTankUnits: 8, hopUnits: 4, canUnits: 1, cartUnits: 8});
  });

  it('10 bodies = exactly 4 quarters (one hop); 20 bodies = exactly 8 (a full empty train)', () => {
    const c = freshChipper(), fuel = {tank: 0};
    for (let i = 0; i < 10; i++) { chipOne(c, i); transferToTank(c, fuel); }
    expect(fuel.tank).toBe(FUEL.hopUnits);
    expect(c.ticks).toBe(0);
    for (let i = 10; i < 20; i++) { chipOne(c, i); transferToTank(c, fuel); }
    expect(fuel.tank).toBe(FUEL.trainTankUnits);
    expect(c.ticks).toBe(0);
    expect(c.done).toBe(20);
    expect(Number.isInteger(fuel.tank)).toBe(true);
  });

  it('partial credit waits in the machine exactly (never floored away, never fractional in the tank)', () => {
    const c = freshChipper(), fuel = {tank: 0};
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) { chipOne(c, i); transferToTank(c, fuel); seen.push(fuel.tank * CHIPPER.ticksPerQuarter + c.ticks); }
    expect(seen).toEqual([2, 4, 6, 8, 10, 12, 14]); // total ticks always = 2 per body
    expect(fuel.tank).toBe(2); // 14 ticks = 2 quarters + 4 ticks waiting
    expect(c.ticks).toBe(4);
    expect(creditTankText(c.ticks)).toBe('0.2');
  });

  it('a full tank keeps the credit in the finite buffer, then refuses without taking the body', () => {
    const c = freshChipper(), fuel: {tank: number} = {tank: FUEL.trainTankUnits};
    for (let i = 0; i < CHIPPER.bufferMaxTicks / CHIPPER.bodyTicks; i++) { chipOne(c, i); expect(transferToTank(c, fuel)).toBe(0); }
    expect(c.ticks).toBe(CHIPPER.bufferMaxTicks);
    expect(chipperRefusal(c)).toBe(CHIPPER_REFUSAL.full);
    expect(() => startJob(c, body(99))).toThrow();
    expect(c.job).toBeNull();
    fuel.tank = 3; // a hop later: room for 5 quarters
    expect(transferToTank(c, fuel)).toBe(5);
    expect(fuel.tank).toBe(8);
    expect(c.ticks).toBe(CHIPPER.bufferMaxTicks - 25);
    expect(chipperRefusal(c)).toBeNull();
  });

  it('one body at a time; ~20 active seconds; credit + consumption in the same call', () => {
    const c = freshChipper();
    startJob(c, body(1));
    expect(chipperRefusal(c)).toBe(CHIPPER_REFUSAL.busy);
    expect(grind(c, CHIPPER.grindMs - 1)).toBeNull();
    expect(c.ticks).toBe(0);
    expect(jobProgress(c)).toBeCloseTo(1, 3);
    const k = grind(c, 1);
    expect(k).toEqual({uid: 1, id: 'subway:main#1', ticks: 2});
    expect(c.job).toBeNull();
    expect(c.ticks).toBe(2);
    expect(c.last).toBe(1);
    expect(grind(c, 1000)).toBeNull(); // nothing to claim twice
    expect(c.ticks).toBe(2);
    const {frames} = chipOne(c, 2);
    expect(frames).toBeGreaterThanOrEqual(1200);
    expect(frames).toBeLessThanOrEqual(1201);
  });
});

describe('chipper record', () => {
  it('validates strictly', () => {
    const c = freshChipper();
    expect(chipperProblem(c, corpseFeedable)).toBeNull();
    startJob(c, body(5));
    grind(c, 7000);
    expect(chipperProblem(JSON.parse(JSON.stringify(c)), corpseFeedable)).toBeNull();
    const bad = (m: (o: ChipperJSON) => void) => { const o = JSON.parse(JSON.stringify(c)); m(o); return chipperProblem(o, corpseFeedable); };
    expect(bad(o => { o.ticks = 1.5; })).toMatch(/whole ticks/);
    expect(bad(o => { o.ticks = CHIPPER.bufferMaxTicks + 1; })).toMatch(/whole ticks/);
    expect(bad(o => { o.job!.ms = CHIPPER.grindMs; })).toMatch(/progress/);
    expect(bad(o => { o.job!.uid = 7; })).toMatch(/uid/);
    expect(bad(o => { o.last = o.job!.uid; })).toMatch(/uid/);
    expect(bad(o => { o.job!.body.arch = 'ratdog'; })).toMatch(/not a carriable/);
    expect(bad(o => { (o as unknown as {extra: number}).extra = 1; })).toMatch(/unexpected/);
    expect(bad(o => { o.done = o.seq; })).toMatch(/more bodies/);
  });

  it('persists with the player-train participant; an older save loads an idle, empty machine', () => {
    const t = new PlayerTrainRecord(), p = t.participant();
    startJob(t.chipper.state, body(3));
    grind(t.chipper.state, 12345);
    t.chipper.state.ticks = 4;
    const saved = JSON.parse(JSON.stringify(p.save()));
    expect(saved.chipper).toMatchObject({v: 1, ticks: 4, seq: 2, job: {uid: 1, ms: 12345}});
    const u = new PlayerTrainRecord();
    u.participant().load(saved);
    expect(u.chipper.state).toEqual(saved.chipper);
    const old = {...saved};
    delete old.chipper;
    u.participant().load(old);
    expect(u.chipper.state).toEqual(freshChipper());
    u.participant().load(saved);
    u.participant().reset();
    expect(u.chipper.state).toEqual(freshChipper());
  });

  it('a save round-trips the machine exactly (text / import) and refuses a malformed one', () => {
    const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
    h.run.current = {level: 'subway', section: 'main', station: sid(1)};
    h.run.memory().visits = 1;
    h.train.chipper.state.ticks = 6;
    startJob(h.train.chipper.state, body(8));
    grind(h.train.chipper.state, 4321);
    const file = h.file('arrival', 1) as unknown as {run: {participants: Record<string, {chipper: ChipperJSON}>}; checksum: string};
    const p = parseSaveText(saveFileText(file as unknown as SaveFileV1Like));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const run = (p as {value: SaveFileV1Like}).value.run as unknown as {participants: Record<string, {chipper: ChipperJSON}>};
    expect(run.participants['player-train'].chipper).toEqual(h.train.chipper.state);
    const rejects = (mut: (c: ChipperJSON) => void, re: RegExp) => {
      const f = structuredClone(file);
      mut(f.run.participants['player-train'].chipper);
      f.checksum = checksumOf(f.run as never);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    rejects(c => { c.ticks = 0.4; }, /whole ticks/);
    rejects(c => { c.job!.body.id = 'nope'; }, /identity/);
    rejects(c => { c.job!.ms = -1; }, /progress/);
  });
});

describe('corpse trait (registry-driven: every present and future archetype)', () => {
  it('every archetype classifies its body; eligibility is the trait', () => {
    for (const id of ENEMY_FAMILY_IDS) {
      expect(ENEMY_ARCHETYPES[id].corpse, id).toBe(CORPSE_TRAITS[id]);
      expect(ENEMY_ARCHETYPES[id].corpse.note.length, id).toBeGreaterThan(8);
      expect(corpseFeedable(id), id).toBe(CORPSE_TRAITS[id].undead && CORPSE_TRAITS[id].humanoid);
    }
    expect(Object.keys(CORPSE_TRAITS).sort()).toEqual(Object.keys(ENEMY_ARCHETYPES).sort());
    expect(corpseFeedable('zombie')).toBe(true);
    expect(corpseFeedable('ratdog')).toBe(false);
    expect(corpseFeedable('market-trader')).toBe(false);
    expect(corpseFeedable('player')).toBe(false);
  });
});
