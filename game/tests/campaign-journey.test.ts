// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): THE JOURNEY orchestration (the real Game.travelToStation /
// continueCampaign on a minimal shell; the train ride, the world teardown / prepare / build are recorded fakes, the saves are the real
// slots on a fake Storage). Proves the order (depart -> teardown -> DEPARTURE autosave with the pending journey -> prepare / build ->
// arrive -> ARRIVAL autosave), adjacency / the cheat, a refused departure touching nothing, the return-to-origin fallback, and the
// once-only journey resume of a departure save.
import {describe, expect, it} from 'vitest';
import {createRun} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots} from '../src/save/slots';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {enableCheat} from '../src/campaign/discovery';
import {installCanvasShim} from './helpers/canvas2d';
import {FakeStorage, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import type {SectionKey} from '../src/levels/types';

describe('campaign journey (real orchestration, recorded fakes)', async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});

  // (task train-fuel-system: `fuel` = the train's tank / chest cans after the New Game reset; default: a full tank + 16 chest cans,
  // enough for every journey below that is not about fuel)
  function shell(o: {depart?: 'in-tunnel' | 'outside'; failPrepare?: (k: SectionKey, n: number) => boolean; fuel?: {tank: number; chestCans: number}} = {}) {
    const storage = new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const commits: {reason: string; campaign: {current: string; transit: unknown; visited: string[]}}[] = [];
    const prepared = new Map<string, number>();
    const journeys: (readonly string[] | null)[] = [];
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number, ro?: {on?: boolean}) => battery.reset(c, ro)}, // (as PlayerLight.reset: the option reaches the battery)
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
      sfx: {engineStall: () => log.push('stall'), denied: () => log.push('denied')},
      trainRide: {
        riding: false,
        depart: async (j?: {route: readonly string[]}) => { log.push('depart'); journeys.push(j?.route ?? null); return o.depart === 'outside' ? {status: 'refused', reason: 'outside', message: 'Board the train first'} : {status: 'in-tunnel', via: 'tunnel', end: 'x1', dir: 1}; },
        state: () => ({local: {x: 1.5, z: -0.4, yaw: 0.3}}),
        transitFailed: (r: string) => log.push(`transitFailed:${r.slice(0, 20)}`),
        arrive: async () => { log.push('arrive'); return {status: 'stopped', via: 'tunnel', end: 'x0', reversed: false}; },
        reset: () => log.push('rideReset'),
      },
      leaveSection(this: {run: ReturnType<typeof createRun>}, save: boolean) { log.push(`leave:${save}:${this.run.current.station}`); if (save) this.run.memory().visits += 1; },
      async prepareSection(k: SectionKey) {
        const n = (prepared.get(k.station!) ?? 0) + 1;
        prepared.set(k.station!, n);
        log.push(`prepare:${k.station}`);
        if (o.failPrepare?.(k, n)) throw new Error(`cannot generate ${k.station}`);
        return {station: k.station};
      },
      buildSection(this: {run: ReturnType<typeof createRun>}, k: SectionKey) { log.push(`build:${k.station}`); this.run.current = {...k}; },
      // (task studio-perf-ao-train-continuity-20261110-022206-01, lane BUILD: the journey builds through the real paced runner — Game.buildSectionPaced —
      // which drains buildSectionSteps between frames; this shell's steps are its recorded build, with pauses around it)
      *buildSectionSteps(this: {buildSection(k: SectionKey): void}, k: SectionKey) { yield; this.buildSection(k); yield; },
      updateStationIntro: () => {},
      lifecycleFailed: () => log.push('lifecycleFailed'),
      beginGesture: () => Promise.resolve(true),
      showLoading: () => ({bar: null, label: {textContent: ''}, button: null}),
      progressTo: () => () => {},
      prepareGraphics: async () => ({status: 'done'}),
      readyLine: () => {},
      enterPlay: () => { log.push('enterPlay'); return Promise.resolve(); },
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as InstanceType<typeof Game> & {run: ReturnType<typeof createRun>; saves: SaveSlots};
    const realCommit = g.saves.commit.bind(g.saves);
    g.saves.commit = ((slot: number, file: {run: {campaign: {current: string; transit: unknown; visited: string[]}}; meta: {reason: string}}, opt?: object) => {
      commits.push({reason: file.meta.reason, campaign: structuredClone(file.run.campaign)});
      log.push(`save:${file.meta.reason}`);
      return realCommit(slot, file as never, opt as never);
    }) as typeof g.saves.commit;
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    const fuelSetup = o.fuel ?? {tank: 4, chestCans: 16};
    const train = (g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain;
    train.fuel.tank = fuelSetup.tank;
    for (let k = 0, left = fuelSetup.chestCans; left > 0; k++) { const st = (g as unknown as {inv: Inventory}).inv.makeStack('fuel_can', 2); st.count = Math.min(2, left); left -= st.count; train.lockbox.slots[k] = st; }
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    log.length = 0;
    commits.length = 0;
    return {g, log, commits, prepared, journeys, battery};
  }

  // Task studio-beta-train-fuel-system-20261106-024923-01: the departure's fuel (one tank per stop; tank -> carts -> chest; charged once)
  const fuelOf = (g: unknown) => { const t = (g as {playerTrain: PlayerTrainRecord}).playerTrain; return {tank: t.fuel.tank, chest: t.lockbox.slots.reduce((n, x) => n + (x?.itemId === 'fuel_can' ? x.count : 0), 0)}; };
  it('fuel: an empty train STALLS — the engine sound + a toast with the numbers; nothing moves, saves or changes', async () => {
    const {g, log, commits} = shell({fuel: {tank: 0, chestCans: 3}});
    const before = JSON.stringify(g.run.campaign);
    const r = await g.travelToStation(sid(1));
    expect(r.ok).toBe(false);
    expect(log.filter(l => !l.startsWith('toast'))).toEqual(['stall']); // no depart, no teardown, no save
    expect(log.find(l => l.startsWith('toast:'))).toMatch(/^toast:Not enough fuel — this stop needs 1 tank, the train has ¾ tank\./);
    expect(commits).toEqual([]);
    expect(fuelOf(g)).toEqual({tank: 0, chest: 3});
    expect(JSON.stringify(g.run.campaign)).toBe(before);
  });

  it('fuel: one stop burns ONE tank (the tank first); the departure save records the charge; nothing else drawn', async () => {
    const {g, commits} = shell({fuel: {tank: 4, chestCans: 3}});
    expect(await g.travelToStation(sid(1))).toEqual({ok: true});
    expect(fuelOf(g)).toEqual({tank: 0, chest: 3});
    expect(commits[0].campaign).toMatchObject({transit: {from: sid(0), to: sid(1), fuel: {cost: 4, debit: {tank: 4, carts: [], chest: []}}}});
    expect(commits[1].campaign.transit).toBeNull();
    const dep = (g.saves.read(1) as unknown as {file: {run: {participants: Record<string, {fuel: unknown}>}}}).file; // (the arrival save)
    expect(dep.run.participants['player-train'].fuel).toEqual({v: 1, tank: 0, cargo: []});
  });

  it('fuel: the chest feeds the tank automatically — 1 in the tank + 3 chest cans make a stop; a 3-stop route costs 3 tanks', async () => {
    const a = shell({fuel: {tank: 1, chestCans: 3}});
    expect(await a.g.travelToStation(sid(1))).toEqual({ok: true});
    expect(fuelOf(a.g)).toEqual({tank: 0, chest: 0});
    // the 3-hop trip back over visited track: 12 units; 10 aboard refuses (stall), 12 goes with no stop on the way
    const b = shell({fuel: {tank: 4, chestCans: 6}});
    b.g.run.campaign = {...b.g.run.campaign!, current: sid(3), visited: [sid(0), sid(1), sid(2), sid(3)], known: [sid(0), sid(1), sid(2), sid(3), sid(4)]};
    b.g.run.current = key(3);
    expect((await b.g.travelToStation(sid(0))).ok).toBe(false);
    expect(b.log).toContain('stall');
    expect(fuelOf(b.g)).toEqual({tank: 4, chest: 6});
    const train = (b.g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain;
    const st = (b.g as unknown as {inv: Inventory}).inv.makeStack('fuel_can', 2); st.count = 2; train.lockbox.slots[10] = st;
    b.log.length = 0; b.prepared.clear();
    expect(await b.g.travelToStation(sid(0))).toEqual({ok: true});
    expect(fuelOf(b.g)).toEqual({tank: 0, chest: 0});
    expect([...b.prepared.keys()]).toEqual([sid(0)]); // no intermediate station loaded / looted
    expect(b.commits.at(-2)!.campaign).toMatchObject({transit: {route: [sid(3), sid(2), sid(1), sid(0)], fuel: {cost: 12}}});
  });

  it('fuel: Continue from the DEPARTURE save resumes the journey without charging again', async () => {
    const a = shell({fuel: {tank: 4, chestCans: 2}});
    // the departure half by hand (as a crash in the tunnel): the charge goes in with the journey
    const f = a.g.fuelCheck(1);
    expect(f.ok).toBe(true);
    const t = (a.g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain;
    t.fuel.tank = 0;
    a.g.run.campaign = {...a.g.run.campaign!, transit: {from: sid(0), to: sid(1), phase: 'departing', cheat: false, fuel: {cost: 4, debit: (f as unknown as {debit: never}).debit}}};
    expect(a.g.commitSave('departure', {pose: {x: 1, z: 0, yaw: 0, pitch: 0, crouched: false}})).toMatchObject({ok: true});
    const b = shell({fuel: {tank: 4, chestCans: 9}});
    (b.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    expect(await b.g.continueCampaign(1)).toEqual({ok: true});
    expect(b.g.run.campaign).toMatchObject({current: sid(1), transit: null});
    expect(fuelOf(b.g)).toEqual({tank: 0, chest: 2}); // the save's own fuel, not charged a second time
  });

  it('fuel: a journey that fails back to its start refunds EXACTLY what it drew; a refused departure refunds too', async () => {
    const a = shell({fuel: {tank: 2, chestCans: 3}, failPrepare: k => k.station === sid(1)});
    expect(await a.g.travelToStation(sid(1))).toEqual({ok: true}); // (the train returns to st-00)
    expect(a.g.run.campaign!.current).toBe(sid(0));
    expect(fuelOf(a.g)).toEqual({tank: 2, chest: 3});
    const b = shell({depart: 'outside', fuel: {tank: 4, chestCans: 0}});
    expect((await b.g.travelToStation(sid(1))).ok).toBe(false);
    expect(fuelOf(b.g)).toEqual({tank: 4, chest: 0});
  });

  it('fuel: the map 1337 cheat waives the cost (cheat runs only); an ordinary run never travels free', async () => {
    const {g} = shell({fuel: {tank: 0, chestCans: 0}});
    expect((await g.travelToStation(sid(1))).ok).toBe(false);
    g.run.campaign = enableCheat(g.run.campaign!);
    expect(await g.travelToStation(sid(5))).toEqual({ok: true});
    expect(fuelOf(g)).toEqual({tank: 0, chest: 0});
  });

  // Task studio-beta-new-game-flashlight-off-20261105-022524-01 (user: "by default when starting a new game the light should not be on")
  it('flashlight: a fresh campaign starts with it OFF (the new-game save says off); switched ON it stays on through a journey and Continue restores ON', async () => {
    const a = shell();
    expect([a.battery.on, a.battery.died, a.battery.output, a.battery.charge]).toEqual([false, false, 0, 0.8]); // resetCarry (the real one)
    const saved = (k: number) => (a.g.saves.read(k) as unknown as {ok: boolean; file: {run: {carry: {battery: {on: boolean; charge: number}}}; meta: {reason: string}}}).file;
    expect(saved(1).meta.reason).toBe('new-game');
    expect(saved(1).run.carry.battery).toMatchObject({on: false, charge: 0.8});
    a.battery.setOn(true); // F
    expect((await a.g.travelToStation(sid(1)))).toEqual({ok: true});
    expect(a.battery.on).toBe(true); // travel (teardown / prepare / build / arrive) never resets the light
    expect(saved(1).meta.reason).toBe('arrival');
    expect(saved(1).run.carry.battery.on).toBe(true);
    // a fresh session (its own New-Game reset: off) continues the slot: the saved ON comes back
    const b = shell();
    expect(b.battery.on).toBe(false);
    (b.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    expect(await b.g.continueCampaign(1)).toEqual({ok: true});
    expect(b.battery.on).toBe(true);
    // and a save taken with it OFF continues OFF
    a.battery.setOn(false);
    expect((await a.g.travelToStation(sid(0)))).toEqual({ok: true});
    const c = shell();
    c.battery.setOn(true);
    (c.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    expect(await c.g.continueCampaign(1)).toEqual({ok: true});
    expect(c.battery.on).toBe(false);
  });

  it('the journey: depart -> teardown -> departure autosave (journey pending) -> prepare / build -> arrive -> arrival autosave', async () => {
    const {g, log, commits} = shell();
    const r = await g.travelToStation(sid(1));
    expect(r).toEqual({ok: true});
    expect(log.filter(l => !l.startsWith('toast'))).toEqual(['depart', 'leave:true:st-00', 'save:departure', 'prepare:st-01', 'build:st-01', 'arrive', 'save:arrival']);
    expect(commits[0].campaign).toMatchObject({current: sid(0), transit: {from: sid(0), to: sid(1), phase: 'departing', cheat: false}});
    expect(commits[1].campaign).toMatchObject({current: sid(1), transit: null});
    expect(commits[1].campaign.visited).toEqual(expect.arrayContaining([sid(0), sid(1)]));
    expect(g.run.campaign).toMatchObject({current: sid(1), transit: null});
    expect(g.run.peekMemory(key(0))!.visits).toBe(1); // the departing station's delta was flushed into ITS memory
    expect(g.run.entry?.station).toBe(sid(1)); // Retry now restarts at the new station
    const meta = g.saves.list().find(v => v.slot === 1)!.meta!;
    expect(meta).toMatchObject({reason: 'arrival', stationsVisited: 2});
    expect((g as unknown as {transitGap: boolean}).transitGap).toBe(false);
  });

  it('only adjacent stations unless the run\'s 1337 cheat is on; a refused departure tears nothing down', async () => {
    const a = shell();
    expect(await a.g.travelToStation(sid(5))).toMatchObject({ok: false}); // not adjacent (st-00 -> st-01 only)
    expect(a.log).toEqual([]);
    a.g.run.campaign = enableCheat(a.g.run.campaign!);
    expect(await a.g.travelToStation(sid(5))).toEqual({ok: true});
    expect(a.commits[0].campaign.transit).toMatchObject({to: sid(5), cheat: true});
    const b = shell({depart: 'outside'});
    expect(await b.g.travelToStation(sid(1))).toMatchObject({ok: false, error: 'Board the train first'});
    expect(b.log.filter(l => !l.startsWith('toast'))).toEqual(['depart']);
    expect(b.g.run.campaign).toMatchObject({current: sid(0), transit: null});
  });

  it('a destination that cannot be prepared twice sends the train back to the station it left (nothing lost)', async () => {
    const {g, log, commits} = shell({failPrepare: k => k.station === sid(1)});
    expect(await g.travelToStation(sid(1))).toEqual({ok: true});
    expect(log.filter(l => l.startsWith('prepare') || l.startsWith('build') || l === 'arrive')).toEqual(['prepare:st-01', 'prepare:st-01', 'prepare:st-00', 'build:st-00', 'arrive']);
    expect(log.some(l => l.includes('cannot be reached'))).toBe(true);
    expect(g.run.campaign).toMatchObject({current: sid(0), transit: null});
    expect(commits.map(c => c.reason)).toEqual(['departure', 'arrival']);
  });

  it('a DEPARTURE save resumes that journey once on Continue (the run arrives at the destination; the arrival autosave clears it)', async () => {
    const a = shell();
    // a save taken mid-journey (as after a crash in the tunnel): run the departure half by hand
    a.g.run.campaign = {...a.g.run.campaign!, transit: {from: sid(0), to: sid(1), phase: 'departing', cheat: false}};
    expect(a.g.commitSave('departure', {pose: {x: 1, z: 0, yaw: 0, pitch: 0, crouched: false}})).toMatchObject({ok: true});
    const file = a.g.saves.read(1);
    expect(file.ok).toBe(true);
    // a fresh session on the same storage continues it
    const b = shell();
    (b.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    const r = await b.g.continueCampaign(1);
    expect(r).toEqual({ok: true});
    expect(b.g.run.campaign).toMatchObject({current: sid(1), transit: null});
    expect(b.log.filter(l => l.startsWith('prepare') || l.startsWith('build') || l.startsWith('leave'))).toEqual(['prepare:st-01', 'leave:false:st-00', 'build:st-01']);
    expect(a.g.saves.list().find(v => v.slot === 1)!.meta).toMatchObject({reason: 'arrival'});
  });

  // campaign-polish (lane MAP), item 13: a MULTI-HOP journey to a visited station is ONE continuous journey
  it('multi-hop to a visited station: one departure with the route, only the destination prepared / built, one arrival; nothing on the way touched', async () => {
    const {g, log, commits, journeys} = shell();
    // the run walked st-00 -> st-03 earlier (the fixture's red line is a chain); st-01 / st-02 hold their own remembered worlds
    g.run.campaign = {...g.run.campaign!, current: sid(3), visited: [sid(0), sid(1), sid(2), sid(3)], known: [sid(0), sid(1), sid(2), sid(3), sid(4)]};
    g.run.current = key(3);
    for (const i of [1, 2]) g.run.memory(key(i)).visits = 2;
    const before = {mem1: JSON.stringify(g.run.peekMemory(key(1))), mem2: JSON.stringify(g.run.peekMemory(key(2))), hp: (g as unknown as {player: {hp: number}}).player.hp};
    expect(g.commitSave('arrival')).toMatchObject({ok: true});
    log.length = 0; commits.length = 0;
    expect(await g.travelToStation(sid(0))).toEqual({ok: true});
    expect(log.filter(l => !l.startsWith('toast'))).toEqual(['depart', 'leave:true:st-03', 'save:departure', 'prepare:st-00', 'build:st-00', 'arrive', 'save:arrival']);
    expect(journeys).toEqual([[sid(3), sid(2), sid(1), sid(0)]]); // the ride got the route (lane TRAIN: depart(journey))
    expect(commits.map(c => c.reason)).toEqual(['departure', 'arrival']); // exactly once each
    expect(commits[0].campaign).toMatchObject({current: sid(3), transit: {from: sid(3), to: sid(0), phase: 'departing', cheat: false, route: [sid(3), sid(2), sid(1), sid(0)]}});
    expect(commits[1].campaign).toMatchObject({current: sid(0), transit: null});
    expect(g.run.campaign!.visited).toEqual([sid(0), sid(1), sid(2), sid(3)]);
    expect(g.run.campaign!.known).toEqual([sid(0), sid(1), sid(2), sid(3), sid(4)]); // no reveal on the way
    expect([JSON.stringify(g.run.peekMemory(key(1))), JSON.stringify(g.run.peekMemory(key(2)))]).toEqual([before.mem1, before.mem2]);
    expect((g as unknown as {player: {hp: number}}).player.hp).toBe(before.hp); // no healing
  });

  it('a visited station cut off over visited track is refused before anything moves; a known unvisited far station too', async () => {
    const {g, log} = shell();
    g.run.campaign = {...g.run.campaign!, current: sid(0), visited: [sid(0), sid(5)], known: [sid(0), sid(1), sid(5), sid(6)]};
    expect(await g.travelToStation(sid(5))).toMatchObject({ok: false});
    expect(await g.travelToStation(sid(6))).toMatchObject({ok: false});
    expect(log).toEqual([]);
  });

  it('a multi-hop DEPARTURE save resumes once on Continue: the run arrives at the destination only', async () => {
    const a = shell();
    a.g.run.campaign = {...a.g.run.campaign!, current: sid(3), visited: [sid(0), sid(1), sid(2), sid(3)], known: [sid(0), sid(1), sid(2), sid(3)],
      transit: {from: sid(3), to: sid(0), phase: 'departing', cheat: false, route: [sid(3), sid(2), sid(1), sid(0)]}};
    a.g.run.current = key(3);
    expect(a.g.commitSave('departure', {pose: {x: 1, z: 0, yaw: 0, pitch: 0, crouched: false}})).toMatchObject({ok: true});
    const b = shell();
    (b.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    expect(await b.g.continueCampaign(1)).toEqual({ok: true});
    expect(b.g.run.campaign).toMatchObject({current: sid(0), transit: null});
    expect(b.log.filter(l => l.startsWith('prepare') || l.startsWith('build'))).toEqual(['prepare:st-00', 'build:st-00']);
    expect(a.g.saves.list().find(v => v.slot === 1)!.meta).toMatchObject({reason: 'arrival', station: b.g.run.node(sid(0))!.name});
  });

  it('the WIN is the habitable surface: with the surface ending the rods only bring the reactor online; ending.surfaced wins once', () => {
    const {g, log} = shell();
    const k = {level: 'reactor' as const, section: 'main', station: sid(39)};
    g.run.current = k;
    (g as unknown as {layout: unknown}).layout = {reactor: {surface: {}}};
    g.onCampaignWin('reactor-restarted');
    expect(g.run.campaign!.won).toBeNull();
    const tick = (dt: number) => (g as unknown as {campaignTick(dt: number): void}).campaignTick(dt);
    g.run.setLaneStore('reactor.state', {v: 1, restarted: true, ending: {doors: true, openedAt: 5, announced: true, surfaced: false}}, k);
    tick(2);
    expect(g.run.campaign!.won).toBeNull();
    g.run.setLaneStore('reactor.state', {v: 1, restarted: true, ending: {doors: true, openedAt: 5, announced: true, surfaced: true}}, k);
    tick(2);
    expect(g.run.campaign!.won).toMatchObject({station: sid(0), via: 'surface'});
    const toasts = log.filter(l => l.startsWith('toast:RUN COMPLETE')).length;
    tick(2); g.onCampaignWin('surface');
    expect(log.filter(l => l.startsWith('toast:RUN COMPLETE')).length).toBe(toasts); // once
    // a build without the surface ending: the rods win (the restart hook)
    const b = shell();
    (b.g as unknown as {layout: unknown}).layout = {reactor: {}};
    b.g.onCampaignWin('reactor-restarted');
    expect(b.g.run.campaign!.won).toMatchObject({via: 'reactor-restarted'});
  });
});
