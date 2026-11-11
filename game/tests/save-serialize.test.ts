// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): save/serialize.ts — a POPULATED campaign run survives
// capture -> JSON text -> validation -> restore into fresh live objects: every station's memory (two different Subway stations stay
// distinct), the carried inventory with nested backpack contents and uids, the 50-slot Lockbox, the participants (train, injuries,
// gas mask), the Retry snapshot, playtime, the game clock; nothing is duplicated, healed or refilled; later uids never collide.
import {describe, expect, it} from 'vitest';
import {createMemory, type SectionMemory} from '../src/run/memory';
import {BAG_LANE} from '../src/run/bagStore';
import {REACTOR_LANE, emptyReactorState} from '../src/world/reactor/runState';
import {createRun} from '../src/run/runState';
import {
  SaveError, captureRun, clampTrainLocal, decodeHolder, decodePickup, encodeHolder, encodePickup, installRestore, maxUidOfRun, prepareRestore,
  restoreRun, saveFileText, type SerializedRunV1,
} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import {FakeStorage, Harness, LEVELS_STUB, SEEDS, fillInventory, fillLockbox, fixtureCampaign, itemCensus, populateStation, sid} from './helpers/saveFixture';
import {SaveSlots, type CommitResult} from '../src/save/slots';
import type {RestoreHandoff, TrainLocalPose} from '../src/save/serialize';
import type {RunState} from '../src/run/runState';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {LOCKBOX_SLOTS} from '../src/run/trainLockbox';
import {Survival} from '../src/player/survival';
import {installCanvasShim} from './helpers/canvas2d';

const key = (i: number, level: 'subway' | 'office' | 'mall' | 'reactor' = 'subway') => ({level, section: 'main', station: sid(i)});

/** A populated mid-run: three visited stations (two Subway + the Reactor), a full kit, a full Lockbox, injuries, Retry entry. */
function populated(): Harness {
  const h = new Harness(fixtureCampaign({current: sid(2), known: [sid(0), sid(1), sid(2), sid(3), sid(39)], visited: [sid(0), sid(1), sid(2), sid(39)]}));
  fillInventory(h);
  fillLockbox(h);
  populateStation(h, key(0), {seed: 10, holders: 30, layoutPickups: 8, dropped: 6, zombies: 25, bags: 1});
  populateStation(h, key(1), {seed: 11, holders: 25, layoutPickups: 8, dropped: 3, zombies: 20, bags: 2});
  const reactor = emptyReactorState(4, 3);
  reactor.generators[1] = {started: true, startedAt: 812.5};
  reactor.fuses[0] = true;
  reactor.jam = {generator: 3, stalls: 2, at: 901.25};
  populateStation(h, key(39, 'reactor'), {seed: 12, holders: 20, zombies: 40, bags: 0, lanes: {[REACTOR_LANE]: reactor}});
  h.run.current = key(2);
  h.run.memory(key(2)).visits = 1;
  h.injuries.restore({v: 1, arm: {side: 'left', cause: 'bite'}, leg: null, cooldown: 3.5});
  h.mask = {on: true};
  h.survival.hunger = 41.5;
  h.survival.thirst = 33.25;
  h.survival.time = 1234.5;
  h.stats = {shots: 412, hits: 233, kills: 61, time: 1800.75, headshots: 19, healed: 85, itemsUsed: 23};
  h.run.playtime = 1834.25;
  h.clock = 1920.125;
  h.run.entered.push('subway', 'reactor', 'subway');
  h.inv.pack[0] = h.inv.makeStack('ammo_9mm', 60);
  h.player.hp = 70;
  h.takeEntry(); // the Retry snapshot of st-02 (as entered)
  h.inv.pack[0]!.count = 45; // play continued after the entry: 15 rounds fired, hurt
  h.player.hp = 64.25;
  return h;
}

const roundTrip = (h: Harness, point: 'arrival' | 'departure' | 'new-game' = 'arrival') => {
  const text = saveFileText(h.file(point));
  const v = parseSaveText(text);
  if (!v.ok) throw new Error(v.error);
  const b = new Harness(null);
  const r = restoreRun(v.value.run, b.target());
  return {text, b, r, data: v.value.run as SerializedRunV1};
};

const closeMemory = (a: SectionMemory | undefined, b: SectionMemory | undefined) => {
  expect(b).toBeDefined();
  expect(b!.id).toBe(a!.id);
  expect(b!.holders).toEqual(a!.holders);
  expect(b!.killed).toEqual(a!.killed);
  expect(b!.lanes).toEqual(a!.lanes);
  expect([b!.visits, b!.cleared]).toEqual([a!.visits, a!.cleared]);
  if (a!.pickups === null) { expect(b!.pickups).toBeNull(); return; } // (a section never left: it spawns from its layout)
  expect(b!.pickups!.length).toBe(a!.pickups!.length);
  a!.pickups!.forEach((p, i) => {
    const q = b!.pickups![i];
    expect(q.stack).toEqual(p.stack);
    expect([q.layoutIndex, q.fromLot]).toEqual([p.layoutIndex, p.fromLot]);
    [...p.pose.p, ...p.anchor].forEach((x, j) => expect(Math.abs([...q.pose.p, ...q.anchor][j] - x)).toBeLessThanOrEqual(5e-5 + 1e-12));
    p.pose.q.forEach((x, j) => expect(Math.abs(q.pose.q[j] - x)).toBeLessThanOrEqual(5e-7 + 1e-12));
  });
};

describe('save/serialize: a populated campaign run round-trips', () => {
  it('memories of every station (two Subway stations stay distinct), carry, Lockbox, participants, Retry entry, clock', () => {
    const a = populated();
    const census = itemCensus(a);
    const {b, r} = roundTrip(a);
    // the campaign and the run
    expect(b.run.campaign).toEqual(a.run.campaign);
    expect(b.run.campaign).not.toBe(a.run.campaign);
    expect(b.run.current).toEqual(key(2));
    expect(r.key).toEqual(key(2));
    expect(b.run.playtime).toBe(1834.25);
    expect(b.run.entered).toEqual(['subway', 'reactor', 'subway']);
    expect(b.clock).toBe(1920.125);
    expect(b.run.memoryIds()).toEqual(a.run.memoryIds());
    expect(b.run.memoryIds()).toEqual(['st-00:main', 'st-01:main', 'st-02:main', 'st-39:main']);
    for (const id of a.run.memoryIds()) closeMemory(a.run.exportMemories()[id], b.run.exportMemories()[id]);
    // two Subway worlds: their own kills / holders / bags, never merged
    const m0 = b.run.peekMemory(key(0))!, m1 = b.run.peekMemory(key(1))!;
    expect(m0.killed).not.toEqual(m1.killed);
    expect(Object.keys(m0.holders)).not.toEqual(Object.keys(m1.holders));
    expect((m1.lanes[BAG_LANE] as {bags: unknown[]}).bags).toHaveLength(2);
    expect(b.run.laneStore(REACTOR_LANE, key(39, 'reactor'))).toEqual(a.run.laneStore(REACTOR_LANE, key(39, 'reactor')));
    expect(b.run.laneStore(REACTOR_LANE, key(0))).toBeUndefined();
    // the carried kit: exact (uids, magazines, backpack contents, mask filter), nothing healed / refilled
    expect(b.inv.toJSON()).toEqual(a.inv.toJSON());
    expect(b.inv.invariants()).toEqual([]);
    expect(b.player).toEqual({hp: 64.25, stamina: 61.25, damageTaken: 26.5, alive: true});
    expect([b.survival.hunger, b.survival.thirst, b.survival.time]).toEqual([41.5, 33.25, 1234.5]);
    expect(b.battery).toEqual({charge: 0.4375, on: true, died: false});
    expect(b.batteryResets).toEqual([0.4375]);
    expect(b.stats).toEqual(a.stats);
    // participants: the train record + the full LOCKBOX_SLOTS (50) Lockbox (nested bags), injuries, gas mask
    expect(b.train.lockbox.toJSON()).toEqual(a.train.lockbox.toJSON());
    expect(b.train.lockbox.used).toBe(LOCKBOX_SLOTS);
    expect(b.train.lockbox.invariants()).toEqual([]);
    expect(b.train.state).toEqual(a.train.state);
    expect(b.injuries.snapshot()).toEqual({v: 1, arm: {side: 'left', cause: 'bite'}, leg: null, cooldown: 3.5});
    expect(b.mask).toEqual({on: true});
    expect(r.failed).toEqual([]);
    // the Retry entry: its own inventory (before the water was drunk), lanes and st-02 memories
    const ea = a.run.entry!, eb = b.run.entry!;
    expect(eb.station).toBe(sid(2));
    expect(eb.inventory.toJSON()).toEqual(ea.inventory.toJSON());
    expect([eb.inventory.pack[0]!.count, b.inv.pack[0]!.count]).toEqual([60, 45]);
    expect([eb.vitals.hp, b.player.hp]).toEqual([70, 64.25]);
    expect(eb.lanes).toEqual(JSON.parse(JSON.stringify(ea.lanes)));
    expect(Object.keys(eb.memories)).toEqual(['st-02:main']);
    expect([eb.vitals, eb.survival, eb.battery, eb.stats]).toEqual([ea.vitals, ea.survival, ea.battery, ea.stats]);
    // nothing duplicated or lost anywhere (carry + Lockbox + every station's loose items and grounded bags)
    expect(itemCensus(b)).toEqual(census);
  });

  it('uid allocators keep working after a load: no new stack reuses a saved uid (inventory, Lockbox, grounded bags)', () => {
    const a = populated();
    const {b, data} = roundTrip(a);
    const top = maxUidOfRun(data);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeGreaterThanOrEqual(a.train.lockbox.maxUid());
    const fresh = Array.from({length: 5}, () => b.inv.makeStack('water', 1).uid);
    for (const u of fresh) expect(u).toBeGreaterThan(top);
    expect(b.run.entry!.inventory.makeStack('water', 1).uid).toBeGreaterThan(top); // Retry's inventory too
  });

  it('is byte-stable: save -> load -> save gives the identical file (the rounding is idempotent, nothing drifts)', () => {
    const a = populated();
    const {text, b} = roundTrip(a);
    const again = saveFileText(b.file('arrival'));
    expect(again).toBe(text);
  });

  it('a departure save keeps the pending journey and hands it back; arrival / new game have none', () => {
    const h = populated();
    h.run.campaign!.transit = {from: sid(2), to: sid(3), phase: 'departing', cheat: false};
    const {r, b} = roundTrip(h, 'departure');
    expect(r.transit).toEqual({from: sid(2), to: sid(3), phase: 'departing', cheat: false});
    expect(r.point).toBe('departure');
    expect(b.run.campaign!.transit).toEqual(r.transit);
    expect(r.pose).toEqual({x: 1.25, z: -0.15, yaw: 0.5, pitch: -0.1, crouched: false});
    const n = new Harness();
    n.takeEntry();
    expect(roundTrip(n, 'new-game').r.transit).toBeNull();
  });

  it('prepareRestore touches nothing live; installRestore then writes everything', () => {
    const a = populated();
    const v = parseSaveText(saveFileText(a.file()));
    if (!v.ok) throw new Error(v.error);
    const b = new Harness(null), before = JSON.stringify({inv: b.inv.toJSON(), box: b.train.lockbox.toJSON(), p: b.player});
    const runBefore = b.run;
    const p = prepareRestore(v.value.run, b.makeRun);
    expect(b.run).toBe(runBefore);
    expect(JSON.stringify({inv: b.inv.toJSON(), box: b.train.lockbox.toJSON(), p: b.player})).toBe(before);
    expect(p.run.peekMemory(key(1))).toBeDefined();
    installRestore(p, b.target());
    expect(b.run).toBe(p.run);
    expect(b.train.lockbox.used).toBe(LOCKBOX_SLOTS);
  });

  it('compact codecs: holders (flags, compartments seen) and loose items (11 / 12 / 14 tuples) decode exactly', () => {
    for (const h of [{lots: [], open: false, searched: false}, {lots: [3, 1, 7], open: true, searched: true}, {lots: [2], open: false, searched: true, seen: [true, false, true, true]}]) {
      expect(decodeHolder(encodeHolder(h))).toEqual(h);
    }
    const base = {stack: {itemId: 'water', count: 2}, pose: {p: [1.23456789, 2, -3.5] as [number, number, number], q: [0, 0.70710678, 0, 0.70710678] as [number, number, number, number]}, anchor: [1, 2.5, -3] as [number, number, number]};
    expect(encodePickup(base)).toHaveLength(11);
    expect(encodePickup({...base, layoutIndex: 4})).toHaveLength(12);
    expect(encodePickup({...base, fromLot: {holder: 9, lot: 2}})).toHaveLength(14);
    expect(decodePickup(encodePickup({...base, layoutIndex: 4})).layoutIndex).toBe(4);
    const lot = decodePickup(encodePickup({...base, fromLot: {holder: 9, lot: 2}}));
    expect([lot.layoutIndex, lot.fromLot]).toEqual([undefined, {holder: 9, lot: 2}]);
    expect(decodePickup(encodePickup({...base, layoutIndex: 0, fromLot: {holder: 1, lot: 0}})).layoutIndex).toBe(0);
    expect(decodePickup(encodePickup(base)).pose.p[0]).toBe(1.2346);
  });

  it('guards: SectionMemory has exactly the fields the codec saves (a new field must be added to the save)', () => {
    expect(Object.keys(createMemory({level: 'subway', section: 'main', station: 'st-00'})).sort()).toEqual(['cleared', 'holders', 'id', 'killed', 'lanes', 'pickups', 'visits']);
  });

  it('refuses what it cannot save faithfully: a legacy run, a participant that throws or returns non-data', () => {
    const legacy = new Harness(null);
    expect(() => captureRun(legacy.source('arrival'))).toThrow(SaveError);
    const h = new Harness();
    h.participants.push({id: 'broken', save: () => { throw new Error('boom'); }, load: () => {}, reset: () => {}});
    expect(() => captureRun(h.source('arrival'))).toThrow(/broken/);
    const g = new Harness();
    g.participants.push({id: 'nan', save: () => ({x: NaN}), load: () => {}, reset: () => {}});
    expect(() => captureRun(g.source('arrival'))).toThrow(/finite/);
    const m = new Harness();
    m.participants.push({id: 'map', save: () => new Map(), load: () => {}, reset: () => {}});
    expect(() => captureRun(m.source('arrival'))).toThrow(/plain data/);
  });

  it('an unknown saved participant is ignored; a live participant missing from the save is reset', () => {
    const a = new Harness();
    a.mask = {on: true};
    const data = captureRun(a.source('arrival'));
    delete data.participants['gas.mask'];
    data.participants['future-lane'] = {v: 9};
    const b = new Harness(null);
    b.mask = {on: true};
    restoreRun(data, b.target());
    expect(b.mask).toEqual({on: false});
  });

  it('clampTrainLocal keeps a pose inside the car and wraps the yaw', () => {
    const c = clampTrainLocal({x: 99, z: -5, yaw: 7, pitch: 3, crouched: true}, {x0: -7.25, x1: 7.25, halfWidth: 1.3});
    expect(c.x).toBeCloseTo(6.9);
    expect(c.z).toBeCloseTo(-0.95);
    expect(c.yaw).toBeCloseTo(7 - 2 * Math.PI);
    expect(c.pitch).toBeLessThan(Math.PI / 2);
    expect(c.crouched).toBe(true);
  });

  it('works through the slots: commit -> read -> restore is the same run', () => {
    const a = populated(), slots = new SaveSlots({storage: new FakeStorage(), listen: false});
    const c = slots.commit(2, a.file('arrival', 2));
    expect(c.ok).toBe(true);
    const r = slots.read(2);
    if (!r.ok) throw new Error(r.error);
    const b = new Harness(null);
    restoreRun(r.file.run, b.target());
    expect(b.inv.toJSON()).toEqual(a.inv.toJSON());
    expect(itemCensus(b)).toEqual(itemCensus(a));
  });

  it('createRun with the restored campaign keeps seedFor per station (validated through parseSaveText)', () => {
    expect(parseSaveText(saveFileText(populated().file())).ok).toBe(true);
    const a = populated();
    const {b} = roundTrip(a);
    const ref = createRun({seeds: SEEDS, start: key(0), levels: LEVELS_STUB, campaign: a.run.campaign});
    for (const i of [0, 1, 2, 39]) expect(b.run.seedFor(key(i))).toBe(ref.seedFor(key(i)));
    expect(b.run.seedFor(key(1))).not.toBe(b.run.seedFor(key(2)));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Game save / load block (the real game.ts methods on a minimal shell)', async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  type G = {
    run: RunState; inv: Inventory; playerTrain: PlayerTrainRecord; time: number; currentSlot: number | null; saveRevision: number; saves: SaveSlots;
    trainPlacement: unknown; player: {hp: number; x: number; y: number; z: number; yaw: number; pitch: number; crouched: boolean};
    wireRunLanes(): void; resetCarry(): void;
    commitSave(reason: 'departure' | 'arrival' | 'new-game', o?: {slot?: number; overwrite?: boolean; pose?: TrainLocalPose}): CommitResult;
    applySave(file: unknown): ({ok: true} & RestoreHandoff) | {ok: false; error: string};
    trainLocalPose(): TrainLocalPose | null;
    trainLocalToWorld(p: TrainLocalPose): {x: number; y: number; z: number; yaw: number; pitch: number} | null;
  };
  function shell(storage: FakeStorage): G {
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const s = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [] as {id: string}[], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number) => battery.reset(c)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 0, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
    };
    Object.setPrototypeOf(s, Game.prototype);
    return s as unknown as G;
  }

  it('New Game binds a slot, autosaves continue it, another game loads it (key / pose / transit hand-off) and saves on', () => {
    const storage = new FakeStorage();
    const g = shell(storage);
    g.wireRunLanes();
    g.resetCarry();
    g.playerTrain.lockbox.slots[0] = g.inv.makeStack('ammo_9mm', 30);
    g.run.memory(key(0)).killed = [1, 2, 3];
    g.time = 512.5;
    g.run.playtime = 300;
    expect(g.commitSave('arrival')).toMatchObject({ok: false, code: 'bad-slot'}); // no slot bound yet
    expect(g.commitSave('new-game', {slot: 2})).toMatchObject({ok: true, meta: {slot: 2, revision: 1, reason: 'new-game'}});
    expect([g.currentSlot, g.saveRevision]).toEqual([2, 1]);
    expect(g.commitSave('arrival')).toMatchObject({ok: true, meta: {revision: 2}});
    const old = g.run;
    g.run = createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}); // a new run nobody bound
    expect(g.commitSave('departure')).toMatchObject({ok: false, code: 'conflict', error: expect.stringMatching(/not the one saved in slot 2/)});
    g.run = old;
    expect(g.commitSave('new-game', {slot: 2})).toMatchObject({ok: false, code: 'occupied'}); // a used slot needs the confirmation
    g.run.campaign!.transit = {from: sid(0), to: sid(1), phase: 'departing', cheat: false};
    expect(g.commitSave('departure', {pose: {x: 2, z: 0.3, yaw: 1, pitch: 0.1, crouched: true}})).toMatchObject({ok: true, meta: {revision: 3}});
    // another game (tab / reload) loads slot 2
    const h = shell(storage);
    h.wireRunLanes();
    h.resetCarry();
    const read = h.saves.read(2);
    if (!read.ok) throw new Error(read.error);
    const r = h.applySave(read.file);
    expect(r).toMatchObject({ok: true, key: key(0), point: 'departure', transit: {from: sid(0), to: sid(1), phase: 'departing', cheat: false}, pose: {x: 2, z: 0.3, yaw: 1, pitch: 0.1, crouched: true}, failed: []});
    expect(h.run.campaign).toEqual(g.run.campaign);
    expect([h.time, h.run.playtime]).toEqual([512.5, 300]);
    expect(h.inv.toJSON()).toEqual(g.inv.toJSON());
    expect(h.playerTrain.lockbox.toJSON()).toEqual(g.playerTrain.lockbox.toJSON());
    expect(h.run.peekMemory(key(0))!.killed).toEqual([1, 2, 3]);
    expect([h.currentSlot, h.saveRevision, h.saves.lastSlot()]).toEqual([2, 3, 2]);
    expect(h.inv.makeStack('water', 1).uid).toBeGreaterThan(h.playerTrain.lockbox.maxUid());
    // the loaded game arrives and autosaves; the first game's stale autosave is refused
    h.run.campaign!.transit = null;
    h.run.campaign!.current = sid(1);
    h.run.campaign!.visited.push(sid(1));
    h.run.current = key(1);
    expect(h.commitSave('arrival')).toMatchObject({ok: true, meta: {revision: 4, station: fixtureCampaign().network.nodes[1].name}});
    g.run.campaign!.transit = null;
    expect(g.commitSave('arrival')).toMatchObject({ok: false, code: 'conflict', error: expect.stringMatching(/newer save in another tab/)});
  });

  it('applySave of invalid data applies nothing', () => {
    const g = shell(new FakeStorage());
    g.wireRunLanes();
    g.resetCarry();
    const state = () => JSON.stringify({inv: g.inv.toJSON(), box: g.playerTrain.lockbox.toJSON(), time: g.time, run: g.run.id, slot: g.currentSlot, rev: g.saveRevision});
    const before = state();
    expect(g.applySave({format: 'terminal-state-save', v: 9})).toMatchObject({ok: false, error: expect.stringMatching(/newer version/)});
    expect(g.applySave('junk')).toMatchObject({ok: false});
    const f = populated().file() as unknown as {run: {clock: number}};
    f.run.clock = 5; // edited without its checksum
    expect(g.applySave(f)).toMatchObject({ok: false, error: expect.stringMatching(/checksum/)});
    expect(state()).toBe(before);
  });

  it('trainLocalPose / trainLocalToWorld invert each other in a parked train (both car yaws)', () => {
    const g = shell(new FakeStorage());
    for (const front of [1, -1] as const) {
      g.trainPlacement = {x: 40, z: -6, yaw: front === 1 ? 0 : Math.PI, front, railTopY: -0.3, floorY: 0.85, level: 0};
      const w = g.trainLocalToWorld({x: 2.5, z: -0.4, yaw: 0.3, pitch: 0.2, crouched: false})!;
      expect(w.y).toBe(0.85);
      Object.assign(g.player, {x: w.x, y: w.y, z: w.z, yaw: w.yaw, pitch: w.pitch});
      const back = g.trainLocalPose()!;
      expect([back.x, back.z, back.yaw, back.pitch].map(v => +v.toFixed(9))).toEqual([2.5, -0.4, 0.3, 0.2]);
    }
    g.trainPlacement = null;
    expect([g.trainLocalPose(), g.trainLocalToWorld({x: 0, z: 0, yaw: 0, pitch: 0, crouched: false})]).toEqual([null, null]);
  });
});
