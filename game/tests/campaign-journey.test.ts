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

  function shell(o: {depart?: 'in-tunnel' | 'outside'; failPrepare?: (k: SectionKey, n: number) => boolean} = {}) {
    const storage = new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const commits: {reason: string; campaign: {current: string; transit: unknown; visited: string[]}}[] = [];
    const prepared = new Map<string, number>();
    const journeys: (readonly string[] | null)[] = [];
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number) => battery.reset(c)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
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
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    log.length = 0;
    commits.length = 0;
    return {g, log, commits, prepared, journeys};
  }

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
