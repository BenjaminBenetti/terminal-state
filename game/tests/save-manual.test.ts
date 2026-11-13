// Task studio-refinement-batch-20261113-035659-01 (lane SAVE): THE MANUAL SAVE — Game.saveNow / saveBlock (the train's Save terminal,
// world/trainSaveTerminal.ts) on a minimal shell with the REAL game.ts methods and the real save slots on a fake Storage (the pattern
// of campaign-journey.test.ts / reactor-credits.test.ts). User: "Interaction invokes the existing actual active-slot save path,
// truthfully reporting success/failure. Keep autosaves and Continue/Retry unchanged." Proves:
//  - saveNow captures the live station first (the same non-destructive flushes as the ending save + the teardown-only writers), then
//    commits the ACTIVE slot through commitSave (reason 'manual', the player's real train-local pose, expectRevision);
//  - the REAL continueCampaign of that slot rebuilds the same station state and puts the player back at the same pose; Load last
//    save does the same; nothing is autosaved by it; the Retry snapshot (run.entry) is saved as it stood;
//  - every refusal (no campaign, not playing, dead, riding / transit, busy, no train, outside, lift moving, unbound slot, another run)
//    writes nothing and flushes nothing; a commit failure (quota / write lost / newer tab) reports the commit's own error and leaves
//    the previous save byte-identical;
//  - 'manual' is a valid point / reason (old saves still validate; never during a journey); the autosave points are unchanged.
import {describe, expect, it} from 'vitest';
import {createRun, type RunState} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots, type CommitResult} from '../src/save/slots';
import {SAVE_POINTS, SAVE_REASONS, type TrainLocalPose} from '../src/save/serialize';
import {validateSaveFile} from '../src/save/validate';
import {checksumOf} from '../src/save/checksum';
import {STORAGE_KEYS} from '../src/campaign/types';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import type {SaveNowResult, SaveRefusal} from '../src/world/trainSaveTerminal';
import type {LastSaveStatus} from '../src/ui/loadingScreen';
import type {SectionKey} from '../src/levels/types';
import {installCanvasShim} from './helpers/canvas2d';
import {FakeStorage, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import fs from 'node:fs';
import path from 'node:path';

describe('the manual save (Game.saveNow: the real game.ts methods on a minimal shell)', async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});
  /** A parked car (yaw 0) at the start station. */
  const PLACEMENT = {x: 40, z: -6, yaw: 0, front: 1 as const, railTopY: -0.3, floorY: -0.3 + PLAYER_TRAIN_SPEC.floorY, level: 0};

  type G = {
    run: RunState; inv: Inventory; time: number; state: string; currentSlot: number | null; saveRevision: number; saves: SaveSlots;
    player: {alive: boolean; x: number; y: number; z: number; yaw: number; pitch: number; crouched: boolean};
    trainRide: {riding: boolean}; transitGap: boolean; lifecycle: {busy: boolean}; world: unknown; trainPlacement: unknown;
    trainRuntime: {train: unknown; playerInside(): boolean} | null; tower: unknown;
    commitSave(reason: string, o?: {slot?: number; overwrite?: boolean; pose?: TrainLocalPose}): CommitResult;
    saveBlock(): SaveRefusal | null; saveNow(): SaveNowResult; trainLocalPose(): TrainLocalPose | null;
    trainLocalToWorld(p: TrainLocalPose): {x: number; y: number; z: number; yaw: number; pitch: number} | null;
    continueCampaign(slot?: number): Promise<{ok: true} | {ok: false; error: string}>;
    loadLastSave(): Promise<{ok: true} | {ok: false; error: string}>;
    lastSaveStatus(): LastSaveStatus;
  };

  /**
   * A playing shell parked at st-00, inside its train, with the live-world writers recorded in `order` (the station memory capture
   * writes a kill + a tag the save must carry). `bind`: New Game into that slot first (the run's active slot).
   */
  function shell(o: {storage?: FakeStorage; bind?: number | null} = {}) {
    const storage = o.storage ?? new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const order: string[] = [];
    const placed: {x: number; z: number; yaw: number; y: number}[] = [];
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number, ro?: {on?: boolean}) => battery.reset(c, ro)},
      player: {
        hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouched: false,
        place(this: {x: number; y: number; z: number; yaw: number}, x: number, z: number, yaw: number, y: number) { this.x = x; this.z = z; this.yaw = yaw; this.y = y; placed.push({x, z, yaw, y}); },
      },
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      hud: {toast: (t: string) => order.push(`toast:${t}`)}, sfx: {denied: () => {}},
      // the live, parked world (flags only: saveBlock never touches these beyond reading them)
      state: 'playing', world: {}, trainPlacement: PLACEMENT,
      trainRuntime: {train: {placement: PLACEMENT}, playerInside: () => true},
      trainRide: {riding: false, reset: () => order.push('rideReset')},
      // the live station's writers (saveNow captures through them, non-destructively)
      saveSectionMemory(this: {run: RunState}) { order.push('memory'); const m = this.run.memory(key(0)); if (!m.killed.includes(77)) m.killed.push(77); },
      gear: {flush: () => order.push('bags')},
      fuelStations: {flush: () => order.push('fuel')},
      trainPropCargo: {flush: () => order.push('cargo'), notePrepared: () => {}},
      corpses: {flush: () => order.push('corpses'), notePrepared: () => {}},
      trainEquipment: {flush: () => order.push('equipment')},
      gas: {flush: () => order.push('gas')},
      skywaysCar: {store: () => order.push('skywaysCar')},
      marketCombat: {persist: () => order.push('market')},
      // Continue's world (recorded fakes, as campaign-journey.test.ts)
      leaveSection: (save: boolean) => order.push(`leave:${save}`),
      prepareSection: async (k: SectionKey) => { order.push(`prepare:${k.station}`); return {station: k.station}; },
      buildSection(this: {run: RunState}, k: SectionKey) { order.push(`build:${k.station}`); this.run.current = {...k}; },
      updateStationIntro: () => {}, lifecycleFailed: () => order.push('lifecycleFailed'), beginGesture: () => Promise.resolve(true),
      showLoading: () => ({meter: null, label: {textContent: ''}, button: null}), progressTo: () => () => {},
      prepareGraphics: async () => ({status: 'done'}), readyLine: () => {}, enterPlay: () => { order.push('enterPlay'); return Promise.resolve(); },
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as G;
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    const realCommit = g.saves.commit.bind(g.saves);
    g.saves.commit = ((slot: number, file: {meta: {reason: string}}, opt?: object) => { order.push(`commit:${file.meta.reason}`); return realCommit(slot, file as never, opt as never); }) as typeof g.saves.commit;
    if (o.bind !== null) expect(g.commitSave('new-game', {slot: o.bind ?? 2})).toMatchObject({ok: true});
    order.length = 0;
    return {g, s, storage, order, placed};
  }
  /** Stand the player in the parked car at a train-local pose (world coordinates through the real trainLocalToWorld). */
  const standAt = (g: G, pose: TrainLocalPose) => {
    const w = g.trainLocalToWorld(pose)!;
    Object.assign(g.player, {x: w.x, y: w.y, z: w.z, yaw: w.yaw, pitch: w.pitch, crouched: pose.crouched});
  };
  const AT_TERMINAL: TrainLocalPose = {x: 5.66, z: -0.6, yaw: -1.2, pitch: -0.15, crouched: false};
  const FLUSHES = ['memory', 'bags', 'fuel', 'cargo', 'corpses', 'equipment', 'gas', 'skywaysCar', 'market'];

  it('saves the ACTIVE slot through commitSave: the live station captured first, reason "manual", the real train-local pose', () => {
    const {g, storage, order} = shell();
    g.inv.add(g.inv.makeStack('ammo_9mm', 17));
    g.time = 321.5;
    standAt(g, AT_TERMINAL);
    expect(g.saveBlock()).toBeNull();
    const r = g.saveNow();
    expect(r).toMatchObject({ok: true, slot: 2, meta: {slot: 2, revision: 2, reason: 'manual', station: fixtureCampaign().network.nodes[0].name}});
    expect(order).toEqual([...FLUSHES, 'commit:manual']);
    expect([g.currentSlot, g.saveRevision]).toEqual([2, 2]);
    const read = g.saves.read(2);
    if (!read.ok) throw new Error(read.error);
    const run = (read.file as unknown as {run: {point: string; clock: number; player: {trainLocal: TrainLocalPose}; memories: unknown}}).run;
    expect(run.point).toBe('manual');
    expect(run.clock).toBe(321.5);
    const pose = run.player.trainLocal;
    expect([pose.x, pose.z, pose.yaw, pose.pitch].map(v => +v.toFixed(9))).toEqual([AT_TERMINAL.x, AT_TERMINAL.z, AT_TERMINAL.yaw, AT_TERMINAL.pitch]);
    expect(validateSaveFile(read.file, {}).ok).toBe(true);
    // the slot list / menu / death screen read it as what it is
    expect(g.saves.list().find(v => v.slot === 2)).toMatchObject({valid: true, meta: {reason: 'manual', revision: 2}});
    expect(g.lastSaveStatus()).toMatchObject({ok: true, slot: 2, meta: {reason: 'manual'}});
    expect(g.saves.continueSlot()).toBe(2);
    expect(storage.map.get(STORAGE_KEYS.lastSlot)).toBe('2');
    // a second save goes on in the same slot (expectRevision: this run owns it)
    expect(g.saveNow()).toMatchObject({ok: true, slot: 2, meta: {revision: 3, reason: 'manual'}});
  });

  it('Continue (the real continueCampaign) and Load last save rebuild that station and put the player back at the saved pose; nothing is autosaved by it; the Retry snapshot is saved as it stood', async () => {
    const a = shell();
    a.g.inv.add(a.g.inv.makeStack('ammo_9mm', 17));
    // the Retry snapshot (the level entry) as the arrival took it — the manual save must carry it unchanged, never take a new one
    a.g.run.entry = (a.g as unknown as {levelEntrySnapshot(): RunState['entry']}).levelEntrySnapshot();
    const entry = JSON.stringify(a.g.run.entry);
    a.g.inv.add(a.g.inv.makeStack('water', 2)); // (picked up after the entry: in the save's carry, not in the Retry snapshot)
    standAt(a.g, AT_TERMINAL);
    const before = {x: a.g.player.x, z: a.g.player.z, yaw: a.g.player.yaw, pitch: a.g.player.pitch};
    expect(a.g.saveNow()).toMatchObject({ok: true, meta: {reason: 'manual'}});
    expect(JSON.stringify(a.g.run.entry)).toBe(entry);
    // another session continues the slot
    const b = shell({storage: a.storage, bind: null});
    const slotText = a.storage.map.get(STORAGE_KEYS.slot(2));
    expect(await b.g.continueCampaign()).toEqual({ok: true});
    expect(b.order.filter(x => x.startsWith('commit:'))).toEqual([]); // no autosave on a parked save's Continue
    expect(a.storage.map.get(STORAGE_KEYS.slot(2))).toBe(slotText);
    expect(b.order).toContain(`build:${sid(0)}`);
    expect(b.g.run.current).toEqual(key(0));
    expect(b.g.run.campaign).toEqual(a.g.run.campaign);
    expect(b.g.run.peekMemory(key(0))!.killed).toContain(77); // the live station's capture went into the save
    expect(b.g.inv.toJSON()).toEqual(a.g.inv.toJSON());
    // Retry restarts this level from its entry, exactly as before (a restore reserves item uids past every saved one, so only the
    // snapshot's uid counter may move up — as for any save; its contents never change)
    const noUid = (e: string) => JSON.stringify(JSON.parse(e), (k, v) => (k === 'nextUid' ? undefined : v));
    expect(noUid(JSON.stringify(b.g.run.entry))).toBe(noUid(entry));
    expect(b.g.time).toBe(a.g.time);
    expect([b.g.currentSlot, b.g.saveRevision]).toEqual([2, 2]);
    const r6 = (v: number) => +v.toFixed(6);
    expect([b.g.player.x, b.g.player.z, b.g.player.yaw, b.g.player.pitch].map(r6)).toEqual([before.x, before.z, before.yaw, before.pitch].map(r6));
    expect(b.g.player.y).toBe(PLACEMENT.floorY);
    // the loaded run saves on (it owns the slot now); the first session's next save is refused as stale (the commit's own words)
    expect(b.g.saveNow()).toMatchObject({ok: true, meta: {revision: 3}});
    const held = new Map(a.storage.map);
    expect(a.g.saveNow()).toMatchObject({ok: false, code: 'conflict', error: expect.stringMatching(/newer save in another tab/)});
    expect(a.storage.map).toEqual(held);
    // Load last save (the death screen): the same Continue path, back at the terminal
    b.g.player.x += 30;
    expect(await b.g.loadLastSave()).toEqual({ok: true});
    expect([b.g.player.x, b.g.player.z].map(r6)).toEqual([before.x, before.z].map(r6));
  });

  it('every refusal writes nothing and captures nothing, and says why (the prompt / toast text)', () => {
    const cases: [string, (s: Record<string, unknown>, g: G) => void, SaveRefusal['code'], RegExp][] = [
      ['not playing (paused)', s => { s.state = 'paused'; }, 'not-playing', /only during play/],
      ['dead', (_s, g) => { g.player.alive = false; }, 'dead', /dead/],
      ['riding', s => { (s.trainRide as {riding: boolean}).riding = true; }, 'moving', /train is moving/],
      ['a journey pending', (_s, g) => { g.run.campaign!.transit = {from: sid(0), to: sid(1), phase: 'departing', cheat: false}; }, 'moving', /train is moving/],
      ['the transit gap', s => { s.transitGap = true; }, 'moving', /train is moving/],
      ['busy (a load / travel in flight)', s => { s.lifecycle = {busy: true}; }, 'busy', /busy/],
      ['no train here', s => { s.trainPlacement = null; }, 'no-train', /not parked here/],
      ['no world', s => { s.world = null; }, 'no-train', /not parked here/],
      ['outside the car', s => { s.trainRuntime = {train: {}, playerInside: () => false}; }, 'outside', /step inside the train/],
      ['the Bunker lift moving', s => { s.tower = {office: {elevator: {logic: {moving: true, stop: null}}}, parkCar: () => { throw new Error('never'); }}; }, 'lift', /lift is moving/],
      ['another run in this session', (_s, g) => { g.run = createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}); }, 'conflict', /not the one saved in slot 2/],
    ];
    for (const [name, set, code, msg] of cases) {
      const {g, s, storage, order} = shell();
      standAt(g, AT_TERMINAL);
      const held = new Map(storage.map), writes = storage.writes;
      set(s, g);
      const block = g.saveBlock();
      expect(block, name).toMatchObject({ok: false, code});
      expect(block!.error, name).toMatch(msg);
      expect(block!.error, name).toMatch(/^Not saved: /);
      expect(g.saveNow(), name).toEqual(block);
      expect(order, name).toEqual([]); // nothing captured, nothing committed
      expect(storage.writes, name).toBe(writes);
      expect(storage.map, name).toEqual(held);
      expect(g.saveRevision, name).toBe(1);
    }
    // a run with no slot bound yet: the honest "choose a slot" (commitSave's own words), nothing written anywhere
    const u = shell({bind: null});
    standAt(u.g, AT_TERMINAL);
    expect(u.g.saveNow()).toEqual({ok: false, code: 'bad-slot', error: 'Not saved: choose a save slot for this run first.'});
    expect([u.storage.writes, u.order]).toEqual([0, []]);
    // not a campaign run (QA / legacy scratch): no save
    const q = shell();
    q.g.run.campaign = null;
    expect(q.g.saveNow()).toMatchObject({ok: false, code: 'no-campaign'});
    expect(q.order).toEqual([]);
  });

  it('a commit failure reports the commit\'s OWN error and leaves the previous save byte-identical (quota, a lost write)', () => {
    // a full storage
    const a = shell({bind: 2});
    standAt(a.g, AT_TERMINAL);
    const held = new Map(a.storage.map);
    a.storage.quota = a.storage.used() + 10;
    a.g.inv.add(a.g.inv.makeStack('ammo_9mm', 17)); // (the save grows)
    const r = a.g.saveNow();
    expect(r).toMatchObject({ok: false, code: 'quota', error: expect.stringMatching(/storage for the game is full.*Slot 2 still holds its previous save/)});
    expect(a.storage.map).toEqual(held);
    expect([a.g.currentSlot, a.g.saveRevision]).toEqual([2, 1]);
    expect(a.order).toEqual([...FLUSHES, 'commit:manual']); // (the captures are non-destructive: the world stays live)
    // the browser drops the write (another tab wrote the same key at the same moment)
    const b = shell({bind: 3});
    standAt(b.g, AT_TERMINAL);
    const kept = new Map(b.storage.map);
    const set = b.storage.setItem.bind(b.storage);
    b.storage.setItem = (k: string, v: string) => { if (k !== STORAGE_KEYS.slot(3)) set(k, v); };
    expect(b.g.saveNow()).toMatchObject({ok: false, code: 'write-failed', error: expect.stringMatching(/did not keep the save in slot 3/)});
    expect(b.storage.map).toEqual(kept);
    expect(b.g.saveRevision).toBe(1);
    // a live-world capture that throws: reported, nothing written (saveNow never throws)
    const e = shell({bind: 2});
    standAt(e.g, AT_TERMINAL);
    const eHeld = new Map(e.storage.map);
    (e.s.corpses as {flush(): void}).flush = () => { throw new Error('a body could not be recorded'); };
    expect(e.g.saveNow()).toEqual({ok: false, code: 'invalid', error: 'Not saved: a body could not be recorded'});
    expect(e.storage.map).toEqual(eHeld);
    expect(e.order).toEqual(['memory', 'bags', 'fuel', 'cargo']);
    // the other slots are never touched by a manual save
    const c = shell({bind: 1});
    expect(c.g.commitSave('new-game', {slot: 3})).toMatchObject({ok: true}); // (slot 3 holds another run's save)
    const s1 = c.storage.map.get(STORAGE_KEYS.slot(1)), s3 = c.storage.map.get(STORAGE_KEYS.slot(3));
    const d = shell({storage: c.storage, bind: 2});
    standAt(d.g, AT_TERMINAL);
    expect(d.g.saveNow()).toMatchObject({ok: true, slot: 2});
    expect([c.storage.map.get(STORAGE_KEYS.slot(1)), c.storage.map.get(STORAGE_KEYS.slot(3))]).toEqual([s1, s3]);
  });

  it('the Bunker lift: idle at a stop -> its stop is recorded with the save (parkCar); between stops it is refused (never parked)', () => {
    const {g, s, order} = shell();
    standAt(g, AT_TERMINAL);
    const logic = {moving: false, stop: 1 as number | null};
    s.tower = {office: {elevator: {logic}}, parkCar: () => order.push('lift')};
    expect(g.saveNow()).toMatchObject({ok: true});
    expect(order).toEqual(['memory', 'bags', 'fuel', 'cargo', 'corpses', 'equipment', 'gas', 'lift', 'skywaysCar', 'market', 'commit:manual']);
    order.length = 0;
    logic.stop = null; // (idle between stops: nothing to record)
    expect(g.saveNow()).toMatchObject({ok: true});
    expect(order).not.toContain('lift');
  });

  it("'manual' is a valid point / reason after the four older ones (unchanged, in order); never during a journey; older saves still load", () => {
    expect(SAVE_POINTS.slice(0, 4)).toEqual(['departure', 'arrival', 'new-game', 'ending']);
    expect(SAVE_POINTS.at(-1)).toBe('manual');
    expect(SAVE_REASONS).toEqual([...SAVE_POINTS, 'import']);
    const {g} = shell();
    const read = g.saves.read(2);
    if (!read.ok) throw new Error(read.error);
    // the new-game save (an older point) validates as before; the same run as a manual save validates too
    expect(validateSaveFile(read.file, {}).ok).toBe(true);
    const f = JSON.parse(JSON.stringify(read.file));
    f.run.point = 'manual';
    f.meta.reason = 'manual';
    f.checksum = checksumOf(f.run);
    expect(validateSaveFile(f, {}).ok).toBe(true);
    // a manual save during a journey is invalid (it is only ever taken parked)
    f.run.campaign.transit = {from: sid(0), to: sid(1), phase: 'departing', cheat: false};
    f.checksum = checksumOf(f.run);
    const v = validateSaveFile(f, {});
    expect(v.ok).toBe(false);
    expect((v as {error: string}).error).toMatch(/a manual save during a journey/);
    // an unknown point is still refused (the list is closed)
    const x = JSON.parse(JSON.stringify(read.file));
    x.run.point = 'quicksave';
    x.checksum = checksumOf(x.run);
    expect(validateSaveFile(x, {}).ok).toBe(false);
  });

  it('the autosaves are unchanged: game.ts commits departure / arrival / new-game / ending where it did, and "manual" only in saveNow', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/game.ts'), 'utf8');
    const reasons = [...src.matchAll(/this\.commitSave\('([a-z-]+)'/g)].map(m => m[1]);
    expect([...new Set(reasons)].sort()).toEqual(['arrival', 'departure', 'ending', 'manual', 'new-game']);
    expect(reasons.filter(r => r === 'manual').length).toBe(1);
    const saveNow = src.slice(src.indexOf('  saveNow(): SaveNowResult {'), src.indexOf('  returnToMenu(): void {'));
    expect(saveNow).toMatch(/this\.commitSave\('manual', \{pose\}\)/);
    // the ending save's own capture order is untouched by this lane (reactor-credits.test.ts pins it)
    expect(src).toMatch(/commitEndingSave\(\): CommitResult \| null \{\n {4}if \(!this\.run\.campaign\) return null;\n {4}if \(this\.world\) \{ this\.saveSectionMemory\(\); this\.gear\.flush\(\);/);
  });
});
