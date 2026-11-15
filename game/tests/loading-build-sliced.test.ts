// The LOADING SCREEN's station build (Game.buildSectionSliced: Continue, New game, Retry, menu travel) — the same steps as the
// synchronous build, drained in time slices with one turn of the event loop between two of them (core/pacedBuild.ts runSliced), with
// no frame drawn meanwhile. The real Game.continueCampaign / newGame on a minimal shell (as campaign-journey.test.ts: prepare,
// teardown and the warm-up are recorded fakes; the saves are the real slots):
//  - readiness does not move: the warm-up starts only after the build's last step, the ready line only after the warm-up, play after
//    that — the order of a load is what it was;
//  - between two slices the frame loop is held (Game.frame returns before it updates or draws) and released when the build ends,
//    however it ends;
//  - the progress is truthful: the map's `build` share is told only what is done (a stage that starts proves the ones before it),
//    and the whole share only after the last step; the progress line is left as its route wrote it;
//  - a station replaced under the build (the world generation moved) abandons it between two slices: the generator is closed, no
//    warm-up, no ready line, no play, no save; a build error propagates as the synchronous build's did;
//  - BUILD_STAGES is exactly the build's own labelled stages, in order.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {createRun} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots} from '../src/save/slots';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {installCanvasShim} from './helpers/canvas2d';
import {FakeStorage, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import type {SectionKey} from '../src/levels/types';
import type {BuildSteps, PacedBuildStats} from '../src/core/pacedBuild';
import type {LoadMeter} from '../src/ui/loadingMap';

describe('the loading screen builds the station in time slices (Game.buildSectionSliced)', async () => {
  installCanvasShim(false);
  const {Game, BUILD_STAGES} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});
  const SRC = fs.readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');

  type Steps = (self: Record<string, unknown>, k: SectionKey, log: string[], clock: {t: number}) => BuildSteps<void>;
  /** The build's stages, each `ms` of work in 1 ms steps (labelled as the real build labels them). */
  const stagedBuild = (ms: number): Steps => function* (self, k, log, clock) {
    for (const stage of BUILD_STAGES) {
      yield stage;
      log.push(`stage:${stage}`);
      for (let i = 0; i < ms; i++) { clock.t += 1; yield i === 3 ? `${stage}.detail` : undefined; } // (a builder's own sub-stage label among them)
      log.push(`done:${stage}`);
    }
    (self as {buildSection(k: SectionKey): void}).buildSection(k);
  };

  function shell(steps: Steps) {
    const storage = new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const clock = {t: 0};
    const turns: (() => void)[] = [];
    const label = {textContent: ''};
    const meter: LoadMeter = {reset: () => log.push('meter:reset'), stage: (st, f) => log.push(`meter:${st}:${f.toFixed(4)}`), complete: () => log.push('meter:complete')};
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number, ro?: {on?: boolean}) => battery.reset(c, ro)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      lifecycleCounts: {generate: 0, prepare: 0, build: 0, leave: 0, travel: 0, warmup: 0, loading: 0},
      layout: {name: 'x', areas: []}, state: 'title', stationGen: 0, warming: false, buildHold: false,
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
      trainRide: {riding: false, reset: () => log.push('rideReset')},
      leaveSection(this: {stationGen: number}, save: boolean) { this.stationGen++; log.push(`leave:${save}`); },
      async prepareSection(k: SectionKey, _run: unknown, onProgress?: (f: number, file: string) => void) { log.push(`prepare:${k.station}`); onProgress?.(1, 'a.glb'); return {station: k.station}; },
      buildSection(this: {run: ReturnType<typeof createRun>}, k: SectionKey) { log.push(`build:${k.station}`); this.run.current = {...k}; },
      *buildSectionSteps(this: Record<string, unknown>, k: SectionKey) { return yield* steps(this, k, log, clock); },
      setState(this: {state: string}, st: string) { this.state = st; log.push(`state:${st}`); },
      showLoading(this: {state: string}, _place: string, text: string) { label.textContent = text; meter.reset(); this.state = 'loading'; return {meter, label, button: null}; },
      updateStationIntro: () => {},
      lifecycleFailed: () => log.push('lifecycleFailed'),
      beginGesture: () => Promise.resolve(true),
      prepareGraphics(this: {buildHold: boolean}) { log.push(`warm-up:hold=${this.buildHold}`); return Promise.resolve({status: 'complete', ms: 5, reason: null}); },
      readyLine: () => log.push('ready'),
      enterPlay(this: {state: string}) { log.push('enterPlay'); this.state = 'playing'; return Promise.resolve(); },
      // what Game.frame touches before it decides to draw (the real method runs between the slices)
      prof: {frameBegin: () => log.push('frame'), frameEnd: () => {}, lap: () => {}}, lastFrame: 0, frameCpu: {updateMs: 0, renderMs: 0, deferredMs: 0, rendered: false},
      frameBudget: {hold: () => {}, beginFrame: () => {}, run: () => 0}, input: {endFrame: () => log.push('frame:held')},
      menuRender: () => { log.push('DRAW:menu'); return true; }, world: null, renderT: 0,
      render() { log.push('DRAW:world'); return true; }, update() { log.push('UPDATE'); },
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as InstanceType<typeof Game> & {run: ReturnType<typeof createRun>; saves: SaveSlots; state: string};
    /** True between the build's slices (Game's private flag). */
    const held = (): boolean => (s as {buildHold: boolean}).buildHold;
    const stats = (): PacedBuildStats => g.loadBuildStats!;
    // one event-loop turn per pause, taken by hand; a frame of the real Game.frame goes by in every one of them
    (g as unknown as {slicePacing: object}).slicePacing = {sliceMs: 40, now: () => clock.t, turn: (go: () => void) => { turns.push(go); }};
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    const realCommit = g.saves.commit.bind(g.saves);
    g.saves.commit = ((slot: number, file: {meta: {reason: string}}, opt?: object) => { log.push(`save:${file.meta.reason}`); return realCommit(slot, file as never, opt as never); }) as typeof g.saves.commit;
    log.length = 0;
    /** Runs `p` to its end: every pending turn is taken, with one frame of the real frame loop before the build goes on. */
    const drive = async <T>(p: Promise<T>): Promise<T> => {
      let done = false;
      void p.then(() => { done = true; }, () => { done = true; });
      for (let i = 0; i < 100000 && !done; i++) {
        await new Promise<void>(r => setTimeout(r, 0));
        const go = turns.shift();
        if (go) { log.push(`turn:hold=${held()}`); g.frame(clock.t); go(); }
      }
      return p;
    };
    return {g, s, log, clock, label, drive, turns, held, stats};
  }

  it('Continue: prepare, teardown, the build in slices with the frame loop held, THEN the warm-up, the ready line and play — the order of a load is unchanged', async () => {
    const {g, log, drive, label, clock, held, stats} = shell(stagedBuild(25));
    expect(await drive(g.continueCampaign(1))).toEqual({ok: true});
    await new Promise<void>(r => setTimeout(r, 0));
    const main = log.filter(l => !/^(stage|done|meter|turn|frame)/.test(l));
    expect(main).toEqual(['prepare:st-00', 'leave:false', 'build:st-00', 'warm-up:hold=false', 'ready', 'enterPlay']);
    // 11 stages x 25 ms of work in 40 ms slices: several slices, one turn between two of them, and never a turn after the last step
    const st = stats();
    expect(st.workMs).toBe(11 * 25);
    expect(st.slices).toBe(Math.ceil(11 * 25 / 40));
    expect(st.waits).toBe(st.slices - 1);
    expect(log.filter(l => l.startsWith('turn:'))).toEqual(Array(st.waits).fill('turn:hold=true'));
    // every frame that went by during the build was held: begun, ended, nothing updated or drawn (the real Game.frame)
    expect(log.filter(l => l === 'frame')).toHaveLength(st.waits);
    expect(log.filter(l => l === 'frame:held')).toHaveLength(st.waits);
    expect(log.filter(l => /^(DRAW|UPDATE)/.test(l))).toEqual([]);
    expect(held()).toBe(false);
    // the warm-up starts after the build's last step and after its last turn
    const warm = log.indexOf('warm-up:hold=false');
    expect(log.lastIndexOf('done:hooks')).toBeLessThan(warm);
    expect(log.lastIndexOf('turn:hold=true')).toBeLessThan(warm);
    expect(log.indexOf('build:st-00')).toBeLessThan(warm);
    // genMs is the build's main-thread work, not the wall time with its turns
    expect(g.genMs).toBe(st.workMs);
    expect(clock.t).toBe(st.workMs);
    // the progress line keeps what the route wrote
    expect(label.textContent).toBe('Loading station props · a.glb · 100%');
    // with the hold released, the frame loop draws again
    log.length = 0;
    (g as unknown as {world: object | null}).world = null;
    g.state = 'title';
    g.frame(clock.t + 16);
    expect(log).toContain('DRAW:menu');
  });

  it('the map is told only what is done: a stage that starts reports the ones before it; the whole share only after the last step', async () => {
    const {g, log, drive} = shell(stagedBuild(25));
    await drive(g.continueCampaign(1));
    const n = BUILD_STAGES.length;
    const reports = log.filter(l => l.startsWith('meter:'));
    expect(reports).toEqual(['meter:reset', 'meter:props:1.0000', ...BUILD_STAGES.map((_, i) => `meter:build:${(i / n).toFixed(4)}`), 'meter:build:1.0000']);
    BUILD_STAGES.forEach((stage, i) => {
      const at = log.indexOf(`meter:build:${(i / n).toFixed(4)}`);
      // told i / n when stage i STARTS: every earlier stage's work is in the log before it, this stage's is not
      if (i > 0) expect(log.indexOf(`done:${BUILD_STAGES[i - 1]}`), stage).toBeLessThan(at);
      expect(log.indexOf(`stage:${stage}`), stage).toBeGreaterThan(at);
    });
    expect(log.indexOf('meter:build:1.0000')).toBeGreaterThan(log.indexOf('build:st-00'));
    expect(log.indexOf('meter:build:1.0000')).toBeLessThan(log.indexOf('warm-up:hold=false'));
    expect(log).not.toContain('meter:complete'); // (the real readyLine finishes the map: this shell's is recorded)
  });

  it('BUILD_STAGES is the build\'s own labelled stages, in order', () => {
    const body = SRC.slice(SRC.indexOf('  private *buildSectionSteps('), SRC.indexOf('\n  genMs = 0;'));
    expect(body.length).toBeGreaterThan(5000);
    const own = [...body.matchAll(/^ {4}yield '([^']+)';/gm)].map(m => m[1]); // (the method's own statements: four spaces)
    expect(own).toEqual([...BUILD_STAGES]);
    expect(new Set(own).size).toBe(own.length);
  });

  it('a station replaced under the build abandons it between two slices: generator closed, hold released, no warm-up, no ready line, no play, no save', async () => {
    let closed = false;
    const {g, log, drive, held} = shell(function* (self, _k, lg, clock) {
      try {
        for (let i = 0; i < 100; i++) { clock.t += 1; yield; }
        self.stationGen = (self.stationGen as number) + 1; // a teardown (never reachable inside the load's single flight)
        lg.push('replaced');
        for (let i = 0; i < 100; i++) { clock.t += 1; lg.push('step after'); yield; }
        lg.push('unreachable end');
      } finally { closed = true; }
    });
    expect(await drive(g.continueCampaign(1))).toEqual({ok: false, error: 'The load was interrupted.'});
    expect(closed).toBe(true);
    expect(held()).toBe(false);
    expect(log).toContain('replaced');
    expect(log).not.toContain('unreachable end');
    // the slice that was running when the station was replaced ends at its 40 ms; nothing runs after the next check
    expect(log.filter(l => l === 'step after').length).toBeLessThan(40);
    for (const never of ['warm-up:hold=false', 'warm-up:hold=true', 'ready', 'enterPlay', 'meter:build:1.0000']) expect(log, never).not.toContain(never);
    expect(log.filter(l => l.startsWith('save:'))).toEqual([]);
  });

  // (task studio-gi-mood-bounce-loading-20261115-081523-01, lane WORKERS: the lighting bake may wait for its workers — the build
  // yields a wait and the drain parks; tests/light-bake-workers.test.ts has the real bake)
  it('a build that waits for work done off the thread: the frames stay held while it waits, and the warm-up still starts only after the build\'s last step', async () => {
    let release!: () => void, parked = false;
    const gate = new Promise<void>(r => { release = r; });
    const {g, log, drive, held, stats, clock} = shell(function* (self, k, lg, clk) {
      for (let i = 0; i < 10; i++) { clk.t += 1; yield; }
      parked = true;
      yield {wait: gate};
      lg.push('after the wait');
      for (let i = 0; i < 10; i++) { clk.t += 1; yield; }
      (self as {buildSection(k: SectionKey): void}).buildSection(k);
    });
    const p = g.continueCampaign(1);
    for (let i = 0; i < 500 && !parked; i++) await new Promise<void>(r => setTimeout(r, 0));
    expect(parked).toBe(true);
    await new Promise<void>(r => setTimeout(r, 30));
    expect(held()).toBe(true);
    expect(log).not.toContain('after the wait');
    g.frame(clock.t); // a frame goes by while the build waits: held, nothing updated or drawn
    expect(log.slice(-2)).toEqual(['frame', 'frame:held']);
    expect(log.filter(l => /^(DRAW|UPDATE|warm-up|ready|enterPlay)/.test(l))).toEqual([]);
    release();
    expect(await drive(p)).toEqual({ok: true});
    const main = log.filter(l => !/^(stage|done|meter|turn|frame)/.test(l));
    expect(main).toEqual(['prepare:st-00', 'leave:false', 'after the wait', 'build:st-00', 'warm-up:hold=false', 'ready', 'enterPlay']);
    expect([stats().parks, stats().workMs]).toEqual([1, 20]); // (the wait is not this thread's work)
    expect(g.genMs).toBe(20);
    expect(held()).toBe(false);
  });

  it('a station replaced while the build waits abandons it there: generator closed (what it waited for is stopped by its finally), hold released, no warm-up, no play, no save', async () => {
    let closed = false, parked = false;
    const {g, s, log, drive, held, stats} = shell(function* (_self, _k, lg, clk) {
      try {
        for (let i = 0; i < 10; i++) { clk.t += 1; yield; }
        parked = true;
        yield {wait: new Promise<void>(() => {})}; // (work elsewhere that never answers)
        lg.push('unreachable end');
      } finally { closed = true; }
    });
    const p = g.continueCampaign(1);
    for (let i = 0; i < 500 && !parked; i++) await new Promise<void>(r => setTimeout(r, 0));
    expect([parked, closed, held()]).toEqual([true, false, true]);
    s.stationGen = (s.stationGen as number) + 1; // a teardown
    expect(await drive(p)).toEqual({ok: false, error: 'The load was interrupted.'});
    expect(closed).toBe(true);
    expect(held()).toBe(false);
    expect(stats().parks).toBe(1);
    for (const never of ['unreachable end', 'warm-up:hold=false', 'warm-up:hold=true', 'ready', 'enterPlay', 'meter:build:1.0000']) expect(log, never).not.toContain(never);
    expect(log.filter(l => l.startsWith('save:'))).toEqual([]);
  });

  it('a build error propagates out of the load as the synchronous build\'s did; the hold is released', async () => {
    const {g, log, drive, held} = shell(function* (_s, _k, _l, clock) { for (let i = 0; i < 90; i++) { clock.t += 1; yield; } throw new Error('builder failed'); });
    await expect(drive(g.continueCampaign(1))).rejects.toThrow('builder failed');
    expect(held()).toBe(false);
    expect(log).not.toContain('ready');
    expect(log).not.toContain('enterPlay');
  });

  it('New game takes the same path: slices with the frames held, then the warm-up; an abandoned build resolves null', async () => {
    const a = shell(stagedBuild(10));
    const w = await a.drive(a.g.newGame('subway', {seeds: SEEDS, campaign: fixtureCampaign()}));
    expect(w).toMatchObject({status: 'complete'});
    const main = a.log.filter(l => !/^(stage|done|meter|turn|frame)/.test(l));
    expect(main).toEqual(['prepare:st-00', 'leave:false', 'build:st-00', 'warm-up:hold=false', 'ready']);
    expect(a.stats().waits).toBeGreaterThan(0);
    expect(a.log.filter(l => /^(DRAW|UPDATE)/.test(l))).toEqual([]);
    const b = shell(function* (self) { yield; self.stationGen = (self.stationGen as number) + 1; yield; });
    (b.g as unknown as {slicePacing: {sliceMs: number}}).slicePacing.sliceMs = 0;
    expect(await b.drive(b.g.newGame('subway', {seeds: SEEDS, campaign: fixtureCampaign()}))).toBeNull();
    expect(b.log).not.toContain('ready');
    expect(b.held()).toBe(false);
  });

  it('game.ts: all four loading-screen routes build this way and go on to the warm-up right after; the frame loop checks the hold where it checks the warm-up', () => {
    const routes = [...SRC.matchAll(/await this\.buildSectionSliced\(/g)];
    expect(routes).toHaveLength(4);
    for (const r of routes) {
      const after = SRC.slice(r.index! + r[0].length, r.index! + 700);
      expect(after).toMatch(/const w = await this\.prepareGraphics\(ui\);/);
      expect(after.slice(0, after.indexOf('await this.prepareGraphics(ui)'))).not.toMatch(/await (?!this\.prepareGraphics)|setTimeout|nextPaint|requestAnimationFrame/); // nothing else is waited for in between
    }
    const sliced = SRC.slice(SRC.indexOf('  private async buildSectionSliced('), SRC.indexOf('  /** True while the loading screen\'s station build runs'));
    expect(sliced).toContain('this.buildHold = true;');
    expect(sliced).toMatch(/await runSliced\(stageLabels\(this\.buildSectionSteps\(key, layout, arrival, fresh, true\), started\), \{\.\.\.this\.slicePacing, stats, alive: \(\) => gen === this\.stationGen\}\);/);
    expect(sliced).toMatch(/\} finally \{\s*this\.buildHold = false;\s*\}/);
    expect(sliced).not.toMatch(/label\.textContent/);
    expect(SRC).toContain('if (this.warming || this.buildHold) { this.input.endFrame(); return; }');
  });
});
