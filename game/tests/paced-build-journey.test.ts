// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the JOURNEY route builds the next station PACED — the real
// Game.travelToStation -> Game.buildSectionPaced -> core/pacedBuild.ts runPaced over Game.buildSectionSteps, on a minimal shell (as
// campaign-journey.test.ts: the ride, teardown and prepare are recorded fakes; the saves are the real slots). Between the build's steps
// the shell draws FRAMES through the real Game.render: proves the order of events / saves is unchanged, that the transit gap holds for
// the whole build (Game.update runs only updateTransitGap), that no frame updates the level culler during it, that a world-generation
// change abandons the build cleanly, that a build error propagates as before, and that every other route still builds synchronously.
import {describe, expect, it} from 'vitest';
import {createRun} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots} from '../src/save/slots';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {installCanvasShim} from './helpers/canvas2d';
import {FakeStorage, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import type {SectionKey} from '../src/levels/types';
import {stableText} from './helpers/pacedBuildFixture';
import {MARKET_LAYOUT_LANE, marketLayoutVersionFor} from '../src/gen/market/layoutVersion';

describe('the journey builds the next station paced (lane BUILD)', async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});

  /** `steps`: the shell's buildSectionSteps body (default: 5 recorded steps, then the recorded build). */
  function shell(steps?: (self: Record<string, unknown>, k: SectionKey, log: string[]) => Generator<string | void, void, void>) {
    const storage = new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const counts = {frames: 0, culler: 0, draws: 0};
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number, ro?: {on?: boolean}) => battery.reset(c, ro)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      lifecycleCounts: {generate: 0, prepare: 0, build: 0, leave: 0, loading: 0}, // (the real generateSection counts)
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
      sfx: {engineStall: () => log.push('stall'), denied: () => log.push('denied')},
      trainRide: {
        riding: false,
        depart: async () => { log.push('depart'); return {status: 'in-tunnel', via: 'tunnel', end: 'x1', dir: 1}; },
        state: () => ({local: {x: 1.5, z: -0.4, yaw: 0.3}}),
        transitFailed: (r: string) => log.push(`transitFailed:${r.slice(0, 20)}`),
        arrive: async () => { log.push('arrive'); return {status: 'stopped', via: 'tunnel', end: 'x0', reversed: false}; },
        reset: () => log.push('rideReset'),
      },
      leaveSection(this: {run: ReturnType<typeof createRun>}, save: boolean) { log.push(`leave:${save}:${this.run.current.station}`); if (save) this.run.memory().visits += 1; },
      async prepareSection(k: SectionKey) { log.push(`prepare:${k.station}`); return {station: k.station}; },
      buildSection(this: {run: ReturnType<typeof createRun>}, k: SectionKey) { log.push(`build:${k.station}`); this.run.current = {...k}; },
      *buildSectionSteps(this: Record<string, unknown>, k: SectionKey) {
        if (steps) { yield* steps(this, k, log); return; }
        for (let i = 0; i < 5; i++) { log.push(`step:${i}:gap=${this.transitGap}`); yield i === 0 ? 'first' : undefined; }
        (this as {buildSection(k: SectionKey): void}).buildSection(k);
      },
      updateStationIntro: () => {},
      backgroundCompile: async () => { log.push('compile'); }, // (the journey compile: recorded)
      lifecycleFailed: () => log.push('lifecycleFailed'),
      // the frame between two steps: Game.render (real) over a live-looking world whose culler / draw are counted
      gpu: null, renderer: {initialized: true}, prof: {lap: () => {}},
      world: {culler: {update: () => { counts.culler++; }}},
      drawFrame: () => { counts.draws++; },
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as InstanceType<typeof Game> & {run: ReturnType<typeof createRun>; saves: SaveSlots; render(): boolean};
    const realCommit = g.saves.commit.bind(g.saves);
    g.saves.commit = ((slot: number, file: {meta: {reason: string}}, opt?: object) => { log.push(`save:${file.meta.reason}`); return realCommit(slot, file as never, opt as never); }) as typeof g.saves.commit;
    // one frame per pause: the real render(), then the next step (the event loop turns)
    (g as unknown as {buildPacing: object}).buildPacing = {sliceMs: 0, hidden: () => false, frame: (go: () => void) => { counts.frames++; log.push(`frame:gap=${s.transitGap}`); g.render(); setImmediate(go); }};
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    const train = (g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain;
    train.fuel.tank = 4;
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    log.length = 0;
    return {g, log, counts, s};
  }

  it('order unchanged; the build runs in steps with a drawn frame between each, all inside the transit gap; the culler is left alone', async () => {
    const {g, log, counts, s} = shell();
    expect(await g.travelToStation(sid(1))).toEqual({ok: true});
    const events = log.filter(l => !l.startsWith('toast'));
    expect(events.filter(l => !l.startsWith('step:') && !l.startsWith('frame:'))).toEqual(['depart', 'leave:true:st-00', 'save:departure', 'prepare:st-01', 'build:st-01', 'compile', 'arrive', 'save:arrival']);
    // prepare -> step, frame, step, frame, ... -> build -> compile: one frame between every two steps, every one in the transit gap
    const from = events.indexOf('prepare:st-01'), to = events.indexOf('compile');
    expect(events.slice(from + 1, to)).toEqual(['step:0:gap=true', 'frame:gap=true', 'step:1:gap=true', 'frame:gap=true', 'step:2:gap=true', 'frame:gap=true',
      'step:3:gap=true', 'frame:gap=true', 'step:4:gap=true', 'frame:gap=true', 'build:st-01']);
    expect(counts.frames).toBe(5);
    expect(counts.draws).toBe(5); // the riding car's frames were drawn
    expect(counts.culler).toBe(0); // ... without the level culler (no live station in the gap)
    expect(s.transitGap).toBe(false);
    g.render();
    expect(counts.culler).toBe(1); // after the build the culler runs again
    const st = (g as unknown as {journeyBuildStats: {slices: number; steps: number; waits: number} | null}).journeyBuildStats!;
    expect(st).toMatchObject({slices: 6, steps: 6, waits: 5});
    expect(g.run.campaign).toMatchObject({current: sid(1), transit: null});
    expect(g.saves.list().find(v => v.slot === 1)!.meta).toMatchObject({reason: 'arrival', stationsVisited: 2});
  });

  it('a world-generation change during the build abandons it: the generator is closed, the gap ends, nothing arrives or saves', async () => {
    let closed = false;
    const {g, log} = shell(function* (self) {
      try {
        yield;
        self.stationGen = ((self.stationGen as number | undefined) ?? 0) + 1; // a teardown (never reachable on the journey's single flight)
        yield;
        log.push('unreachable step');
      } finally { closed = true; }
    });
    expect(await g.travelToStation(sid(1))).toEqual({ok: false, error: 'The journey was interrupted.'});
    expect(closed).toBe(true);
    expect(log).not.toContain('unreachable step');
    expect(log).not.toContain('arrive');
    expect(log.filter(l => l.startsWith('save:'))).toEqual(['save:departure']);
    expect((g as unknown as {transitGap: boolean}).transitGap).toBe(false);
  });

  it('a build error propagates out of the journey exactly as the synchronous build\'s did', async () => {
    const {g, log} = shell(function* () { yield; throw new Error('builder failed'); });
    await expect(g.travelToStation(sid(1))).rejects.toThrow('builder failed');
    expect(log).not.toContain('arrive');
  });

  // --- pre-generation at the destination's confirmation ---------------------------------------------------------------------------
  type Pre = {pregenerated: {key: string; layout: unknown} | null; generateSection(k: SectionKey, r?: unknown): unknown};
  it('pre-generation: the destination is generated at the confirmation, BEFORE the car departs; generateSection takes exactly that layout once', async () => {
    const {g} = shell();
    const p = g as unknown as Pre & {trainRide: {depart: (...a: unknown[]) => Promise<unknown>}};
    let atDepart: string | null = null;
    const depart = p.trainRide.depart;
    p.trainRide.depart = async (...a: unknown[]) => { atDepart = p.pregenerated?.key ?? null; return depart(...a); };
    expect(await g.travelToStation(sid(1))).toEqual({ok: true});
    expect(atDepart).toBe(`subway/${sid(1)}:main`);
    // (this shell's prepare is recorded: the layout waits for the real generateSection)
    const pre = p.pregenerated!.layout;
    const L = p.generateSection(key(1), g.run);
    expect(L).toBe(pre);
    expect(p.pregenerated).toBeNull();
    const again = p.generateSection(key(1), g.run); // generated anew: the identical layout (the generator is deterministic in its inputs)
    expect(again).not.toBe(pre);
    expect(stableText(again)).toBe(stableText(L));
  });

  it('pre-generation keeps the versioned level\'s lane-store write at prepare time; any other key or input generates afresh (and drops it)', async () => {
    const {g} = shell();
    const p = g as unknown as Pre & {pregenerateSection(k: SectionKey, r: unknown): void};
    const mk: SectionKey = {level: 'market', section: 'main'};
    p.pregenerateSection(mk, g.run);
    expect(g.run.laneStore(MARKET_LAYOUT_LANE, mk)).toBeUndefined(); // nothing recorded at the confirmation
    const pre = p.pregenerated!.layout;
    expect(p.generateSection(mk, g.run)).toBe(pre);
    expect(g.run.laneStore(MARKET_LAYOUT_LANE, mk)).toEqual({v: marketLayoutVersionFor(undefined)}); // recorded by generateSection, as before
    p.pregenerateSection(key(1), g.run);
    const other = p.generateSection(key(2), g.run);
    expect(other).not.toBe(p.pregenerated?.layout);
    expect(p.pregenerated).toBeNull(); // dropped: never used for another key
  });

  it('a refused departure drops the pre-generated layout', async () => {
    const {g} = shell();
    const p = g as unknown as Pre & {trainRide: {depart: () => Promise<unknown>}};
    p.trainRide.depart = async () => ({status: 'refused', reason: 'outside', message: 'Board the train first'});
    expect(await g.travelToStation(sid(1))).toMatchObject({ok: false});
    expect(p.pregenerated).toBeNull();
  });

  it('every other route still calls the synchronous buildSection (newGame / Continue / Retry / menu travel); only the journey paces', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    const paced = [...src.matchAll(/this\.buildSectionPaced\(/g)].length, sync = [...src.matchAll(/this\.buildSection\(/g)].length;
    expect(paced).toBe(1);
    expect(sync).toBe(4);
    const journey = src.slice(src.indexOf('async travelToStation('), src.indexOf('private fuelCartsLike('));
    expect(journey).toContain('await this.buildSectionPaced(key, layout, {kind: \'start\'}, false)');
    expect(journey).not.toMatch(/this\.buildSection\(/);
    // the wrapper drains the very same steps
    expect(src).toMatch(/private buildSection\(key: SectionKey, layout: StationLayout, arrival: Arrival, fresh: boolean\): void \{ drainSync\(this\.buildSectionSteps\(key, layout, arrival, fresh\)\); \}/);
  });
});
