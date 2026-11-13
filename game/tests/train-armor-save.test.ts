// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the train armour's PERSISTENCE — the permanent one-time upgrade is part of
// the player-train record (run/playerTrain.ts PlayerTrainRecord.upgrades, run/trainUpgrades.ts) and follows exactly the rules of the rest
// of that record, over the save fixtures' Game-like harness (helpers/saveFixture.ts: a real RunState on the 40-station campaign, a real
// Inventory, the real 'player-train' participant):
//  - the key is ADDITIVE: an unfitted train saves exactly as before (no `upgrades` key, no version bump); a fitted one saves
//    {v: 1, fitted: ['armor']}; an old save (no key) loads none fitted;
//  - a DAMAGED value never fits the armour: the save validator rejects it (the run and its Retry snapshot), and the record loads it as none;
//  - NewGame: none; Travel keeps it (the record is the session's); Retry restores the entry state (fitted at the entry -> fitted; fitted
//    after the entry -> not fitted again, with the entry's inventory: the scrap is back too, never a free upgrade);
//  - Save -> text -> parse -> validate -> restoreRun into a FRESH game keeps it; a load over a fitted game without it un-fits it.
import {describe, expect, it} from 'vitest';
import {TRAIN_UPGRADE_IDS, TrainUpgrades, trainUpgradesProblem} from '../src/run/trainUpgrades';
import {PLAYER_TRAIN_PARTICIPANT} from '../src/run/playerTrain';
import {resetParticipants, restoreParticipants} from '../src/run/snapshot';
import {checksumOf} from '../src/save/checksum';
import {restoreRun, saveFileText} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

const P = PLAYER_TRAIN_PARTICIPANT;

function harness(): Harness {
  const hs = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]}));
  hs.run.memory().visits = 1;
  return hs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test reads / mutations of untrusted save data)
type AnyFile = any;

describe('train armour: the upgrades record', () => {
  it('fit is one-way and once; toJSON / load / reset are exact; a damaged value loads none fitted', () => {
    const u = new TrainUpgrades();
    expect(u.has('armor')).toBe(false);
    expect(u.any).toBe(false);
    expect(u.toJSON()).toEqual({v: 1, fitted: []});
    const v0 = u.version;
    expect(u.fit('armor')).toBe(true);
    expect(u.version).toBeGreaterThan(v0);
    expect(u.fit('armor')).toBe(false); // (once)
    expect(u.fit('plough' as never)).toBe(false); // (an unknown id)
    expect(u.toJSON()).toEqual({v: 1, fitted: ['armor']});
    expect(trainUpgradesProblem(u.toJSON())).toBeNull();
    const back = new TrainUpgrades();
    back.load(structuredClone(u.toJSON()));
    expect(back.has('armor')).toBe(true);
    for (const bad of [
      undefined, null, 'armor', ['armor'], {}, {v: 2, fitted: ['armor']}, {v: 1}, {v: 1, fitted: 'armor'}, {v: 1, fitted: ['plough']},
      {v: 1, fitted: ['armor', 'armor']}, {v: 1, fitted: ['armor'], hp: 100}, {v: 1, fitted: [1]}, {v: '1', fitted: ['armor']},
    ]) {
      if (bad !== undefined) expect(trainUpgradesProblem(bad), JSON.stringify(bad)).not.toBeNull();
      const r = new TrainUpgrades();
      r.fit('armor');
      r.load(bad);
      expect(r.has('armor'), JSON.stringify(bad)).toBe(false); // never a free upgrade
    }
    u.reset();
    expect(u.any).toBe(false);
    expect(TRAIN_UPGRADE_IDS).toEqual(['armor']);
  });
});

describe('train armour: the player-train participant', () => {
  it('an unfitted train saves exactly as before (no key); a fitted one saves {v: 1, fitted}; an old save loads none', () => {
    const hs = harness(), part = hs.train.participant();
    const before = part.save() as Record<string, unknown>;
    expect('upgrades' in before).toBe(false);
    hs.train.upgrades.fit('armor');
    const after = part.save() as Record<string, unknown>;
    expect(after.upgrades).toEqual({v: 1, fitted: ['armor']});
    const {upgrades: _drop, ...rest} = after;
    expect(rest).toEqual(before); // (nothing else of the record moved)
    // an old save (the same record without the key) loads none fitted
    part.load(structuredClone(before));
    expect(hs.train.upgrades.has('armor')).toBe(false);
    part.load(structuredClone(after));
    expect(hs.train.upgrades.has('armor')).toBe(true);
    // a damaged value loads none fitted
    part.load({...structuredClone(after), upgrades: {v: 1, fitted: ['armor', 'armor']}});
    expect(hs.train.upgrades.has('armor')).toBe(false);
  });

  it('NewGame: none; Travel keeps it; Retry restores the entry state with the entry inventory (never a free upgrade)', () => {
    const hs = harness();
    hs.inv.pack.push(hs.inv.makeStack('scrap_metal', 10));
    const scrap = () => hs.inv.pack.filter(Boolean).filter(s => s!.itemId === 'scrap_metal').reduce((n, s) => n + s!.count, 0);
    hs.takeEntry(); // (entered st-01 unfitted with 10 scrap)
    // the craft: debit, then install
    hs.inv.pack.splice(hs.inv.pack.findIndex(s => s?.itemId === 'scrap_metal'), 1);
    expect(hs.train.upgrades.fit('armor')).toBe(true);
    expect(scrap()).toBe(0);
    // Retry: the entry state — not fitted, the scrap back
    restoreParticipants(hs.run.entry!, hs.participants);
    hs.inv = hs.run.entry!.inventory;
    expect(hs.train.upgrades.has('armor')).toBe(false);
    expect(scrap()).toBe(10);
    // fit it again, then travel: the record travels with the session (no participant is touched) and the next entry snapshot has it
    hs.train.upgrades.fit('armor');
    hs.run.current = {level: 'subway', section: 'main', station: sid(2)};
    hs.run.memory().visits = 1;
    expect(hs.train.upgrades.has('armor')).toBe(true);
    hs.takeEntry();
    expect((hs.run.entry!.lanes[P] as {upgrades?: unknown}).upgrades).toEqual({v: 1, fitted: ['armor']});
    // a Retry there keeps it fitted (it was fitted at that entry)
    restoreParticipants(hs.run.entry!, hs.participants);
    expect(hs.train.upgrades.has('armor')).toBe(true);
    // NewGame: none
    resetParticipants(hs.participants);
    expect(hs.train.upgrades.has('armor')).toBe(false);
  });
});

describe('train armour: the save file', () => {
  it('fitted -> validates (the run and its Retry snapshot); damaged values are rejected; text round trip into a fresh game keeps it', () => {
    const hs = harness();
    hs.train.upgrades.fit('armor');
    hs.takeEntry();
    const base: AnyFile = hs.file('arrival', 1);
    const ok = validateSaveFile(structuredClone(base));
    expect(ok.ok, ok.ok ? '' : (ok as {error: string}).error).toBe(true);
    expect(base.run.participants[P].upgrades).toEqual({v: 1, fitted: ['armor']});
    expect(base.run.entry.lanes[P].upgrades).toEqual({v: 1, fitted: ['armor']});
    const refuse = (mut: (f: AnyFile) => void, re: RegExp) => {
      const f = structuredClone(base);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    refuse(f => { f.run.participants[P].upgrades = {v: 2, fitted: ['armor']}; }, /upgrades/);
    refuse(f => { f.run.participants[P].upgrades = {v: 1, fitted: ['armor', 'armor']}; }, /upgrades/);
    refuse(f => { f.run.participants[P].upgrades = {v: 1, fitted: ['blades']}; }, /upgrades/);
    refuse(f => { f.run.participants[P].upgrades = {v: 1, fitted: ['armor'], durability: 3}; }, /upgrades/);
    refuse(f => { f.run.participants[P].upgrades = true; }, /upgrades/);
    refuse(f => { f.run.participants[P].upgrades = null; }, /upgrades/);
    refuse(f => { f.run.entry.lanes[P].upgrades = {v: 1, fitted: 'armor'}; }, /upgrades/); // (the Retry snapshot too)
    // an old file (no key) still validates
    const old = structuredClone(base);
    delete old.run.participants[P].upgrades;
    delete old.run.entry.lanes[P].upgrades;
    old.checksum = checksumOf(old.run);
    expect(validateSaveFile(old).ok).toBe(true);

    // save -> text -> parse -> validate -> a FRESH game
    const parsed = parseSaveText(saveFileText(base));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const hs2 = new Harness(fixtureCampaign());
    const res = restoreRun(parsed.value.run, hs2.target());
    expect(res.failed).toEqual([]);
    expect(hs2.train.upgrades.has('armor')).toBe(true);
    // its Retry snapshot keeps it too
    restoreParticipants(hs2.run.entry!, hs2.participants);
    expect(hs2.train.upgrades.has('armor')).toBe(true);
    // a load of the OLD file over that fitted game: none fitted
    const parsedOld = parseSaveText(saveFileText(old));
    expect(parsedOld.ok).toBe(true);
    if (!parsedOld.ok) return;
    restoreRun(parsedOld.value.run, hs2.target());
    expect(hs2.train.upgrades.has('armor')).toBe(false);
  });

  it('an unfitted train writes no upgrades key anywhere in the file', () => {
    const hs = harness();
    hs.takeEntry();
    const f: AnyFile = hs.file('arrival', 1);
    expect(validateSaveFile(structuredClone(f)).ok).toBe(true);
    expect('upgrades' in f.run.participants[P]).toBe(false);
    expect('upgrades' in f.run.entry.lanes[P]).toBe(false);
  });
});
