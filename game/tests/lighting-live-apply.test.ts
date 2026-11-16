// Task studio-graphics-gpu-materials-toggle-20261114-212239-01: Enhanced lighting / Reflections applied to the LIVE station
// (Game.relightAfterSettings) in the REAL Game (src/game.ts: the asset boot, the campaign lifecycle, the warm-up, the atmosphere
// pipeline) on three r186's real WebGPURenderer over the validating no-op device (helpers/headlessGame.ts, helpers/validatingWebgpu.ts:
// a command buffer that references a destroyed texture is rejected whole).
//  1. Pause -> Reflections High: only the lighting is rebuilt — no station generated, prepared, built or left, the same world
//     generation, the same StationLighting fixtures; Resume is held and the status says "applying" while it runs; afterwards the
//     status is the new choice, the replaced field / probe textures are released, and nothing is dropped at any angle.
//  2. Pause -> Off: the plain field light, the baseline status, no probe texture bound by anything drawn. On: the high bake.
//     Auto + Standard again: the first bake comes back from the session's cache.
//  3. Conservation: the station (layout, props, lights, loot), the save the game would write (inventory and uids, vitals, the train,
//     every station's memory), the enemies and the flicker circuits are the same before and after every rebuild.
//  4. A bake that fails leaves the lighting the station had, says so, and is not retried by itself; a later change works.
//  5. A change made while the game is not paused waits (pending) and is applied at the next pause.
//  6. Nothing is rebuilt in the gap between two stations or inside a transition; a pause that outlives the transition applies it.
// Task studio-baked-gi-visual-uplift-20261115-004324-01: what lights the station after every change — the one field light of its
// shading (full with the mirror while there are probes, the full plain-field light with reflections off, the plain one under Off),
// the cube's place in the bound field, the flashlight bounce bound to the NEW lighting, and the glass mirror made, kept (its cap
// following the Reflections tier) or released with it.
// Task studio-gi-mood-bounce-loading-20261115-081523-01 (lane WORKERS): 7. a rebuild abandoned mid-bake leaves the station as it was;
// 8. the bake on worker threads, and a choice changed while the rebuild waits for them (that bake is dropped, the new choice is baked).
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; texture?: unknown; textureNode?: {value?: unknown} }
interface RenderObject { id: number; object: {name: string}; getBindings(): {bindings: Binding[]}[] }

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

describe('Enhanced lighting / Reflections applied to the live station (real Game, validating device)', () => {
  it('rebuilds only the lighting from the pause menu: same station, same save, nothing dropped, truthful status, failure keeps what was there', async () => {
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const h = installHeadless();
    const {Game} = await import('../src/game');
    const {REFL, activeReflectionProbes, stationReflectLight} = await import('../src/world/reflectionNode');
    const {LF, stationFieldLight, stationLights, activeLightField} = await import('../src/world/lightFieldNode');
    const {APPLYING_NOTE, MIRROR_TEXELS, describeEnhancedLighting, enhancedLightingLine} = await import('../src/world/enhancedLighting');
    const {FLASH_BOUNCE} = await import('../src/world/lights');
    const game = new Game(h.canvas, false);
    /**
     * What lights the station: the field lights in the scene by name (one, always), the cube's place in the bound field, the
     * flashlight bounce (bound, and to the live lighting's own source), the glass mirror's cap (null: no mirror).
     */
    const lighting = () => {
      const pool = game.lightPool as unknown as {bounce: unknown};
      return {
        lights: (g.scene.children.filter(c => (stationLights() as unknown[]).includes(c)) as {name: string}[]).map(l => l.name),
        cube: LF.cube.value.toArray(),
        bounce: [FLASH_BOUNCE.debug().bound, (FLASH_BOUNCE as unknown as {src: unknown}).src === pool.bounce],
        mirror: game.glassMirror ? [...game.glassMirror.cap] : null,
      };
    };
    /** Full shading with probes and the mirror, the field's cube after `gi` slices. */
    const full = (gi: number, tier: 'standard' | 'high' = 'standard') => ({lights: [stationReflectLight(true, true).name], cube: [gi, 1], bounce: [true, true], mirror: [...MIRROR_TEXELS[tier]]});
    const g = game as unknown as {
      player: {x: number; y: number; z: number; yaw: number; pitch: number}; state: string; scene: {children: unknown[]}; stationGen: number; warming: boolean; warmup: unknown;
      transitGap: boolean; lifecycle: {busy: boolean; run<T>(fn: () => Promise<T>): Promise<T> | null};
      layout: {grid: {cells: Uint8Array}; props: {kind: string; x: number; z: number}[]; lights: unknown[]};
      containers: {all: {state: {lots: {itemId: string; count?: number}[]}}[]};
      zombies: {brain: {x: number; y: number; z: number; hp: number; alive: boolean}}[];
      world: {fixtures: {level: number}[]};
      settings: {enhancedLighting: string; reflections: string; rtFlashlight: boolean};
      captureSave(reason: string): {meta: Record<string, unknown>} & Record<string, unknown>;
    };
    const frameErrors: string[] = [];
    // (the loading screen's station build runs in time slices: the frames that go by between two slices, and what they drew)
    const buildFrames = {held: 0, drawn: 0};
    const loop = (t: number) => {
      try {
        const held = (game as unknown as {buildHold: boolean}).buildHold;
        game.frame(t);
        if (held) { buildFrames.held++; if (game.frameCpu.rendered) buildFrames.drawn++; }
      } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); }
      requestAnimationFrame(loop);
    };
    // (task rt-flashlight-compute-20261115-233136: RT Flashlight Off — these pins are the CURRENT flashlight bounce, which Off keeps
    // unchanged; the RT default is tests/rt-flashlight-game.test.ts)
    g.settings.rtFlashlight = false;
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    await game.load(() => {});

    const drawn = new Map<string, Map<number, RenderObject>>();
    let phase = 'boot';
    const backend = game.renderer.backend as unknown as {draw(ro: RenderObject, info: unknown): void};
    const draw = backend.draw.bind(backend);
    backend.draw = (ro: RenderObject, info: unknown) => {
      let m = drawn.get(phase);
      if (!m) drawn.set(phase, (m = new Map()));
      m.set(ro.id, ro);
      draw(ro, info);
    };
    const probeBindings = (ro: RenderObject) => {
      const values = new Set<unknown>([REFL.atlas.value, REFL.meta.value, REFL.grid.value]);
      return ro.getBindings().flatMap(b => b.bindings).filter(b => b.isSampledTexture && values.has(b.textureNode?.value));
    };
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const sweep = async (name: string) => {
      phase = name;
      h.log.reset();
      await h.waitFrames(12);
      const y0 = g.player.yaw;
      for (let i = 0; i < 16; i++) { g.player.yaw = y0 + (i / 16) * Math.PI * 2; await h.waitFrames(2); }
      g.player.yaw = y0;
      await h.waitFrames(4);
      return {submits: h.log.submits, dropped: h.log.dropped, issues: h.log.issues.slice(0, 5).map(i => i.detail)};
    };
    const stationPrint = () => fnv(JSON.stringify([
      fnv(Buffer.from(g.layout.grid.cells).toString('latin1')), g.layout.props.map(p => [p.kind, Math.round(p.x * 100), Math.round(p.z * 100)]), g.layout.lights,
      g.containers.all.map(x => x.state.lots.map(l => [l.itemId, l.count ?? 1])),
    ]));
    /** Everything the game would save right now (the whole run: inventory + uids, vitals, the train, every station's memory), without its time stamp. */
    const savePrint = () => { const f = g.captureSave('manual'); return fnv(JSON.stringify({...f, meta: {...f.meta, savedAt: null}})); };
    const enemiesPrint = () => JSON.stringify(g.zombies.map(z => [z.brain.x, z.brain.y, z.brain.z, z.brain.hp, z.brain.alive]));
    const posePrint = () => JSON.stringify([g.player.x, g.player.y, g.player.z, g.player.yaw, g.player.pitch]);
    const lightPrint = () => JSON.stringify([game.lightPool.debug().circuits, g.world.fixtures.map(f => f.level)]);
    const resume = document.querySelector('#btn-resume') as unknown as {disabled: boolean};
    const pauseLine = document.querySelector('#pause .fine') as unknown as {textContent: string};
    const counts = () => JSON.stringify({...game.lifecycleCounts, warmup: 0});
    const pause = async () => { game.setState('paused'); await h.waitFrames(6); };
    const play = async () => { game.setState('playing'); await h.waitFrames(6); };
    /** One change in the pause menu, as main.ts makes it; records what the forms would show while it runs. */
    const apply = async (patch: Partial<{enhancedLighting: string; reflections: string}>) => {
      Object.assign(g.settings, patch);
      const seen = {applying: false, held: false, noFrames: true, framesWatched: 0, early: false, line: '', help: '', releasedAfterWarmup: null as boolean | null};
      const warmupBefore = g.warmup, swapsBefore = game.relightCounts.swaps, poolBefore = game.lightPool;
      const helpBefore = describeEnhancedLighting({...game.enhancedLighting.status(), applying: true});
      const off = game.enhancedLighting.subscribe(() => {
        const st = game.enhancedLighting.status();
        if (st.applying) {
          seen.applying = true; seen.held = resume.disabled; seen.line = enhancedLightingLine(st); seen.help = describeEnhancedLighting(st);
          // until the lighting is swapped the forms keep saying what the station is still lit by
          if (game.lightPool === poolBefore && seen.help !== helpBefore) seen.early = true;
        }
        // the forms get their choices back (applying ends) only once the warm-up of a swapped lighting has finished
        else if (seen.applying && seen.releasedAfterWarmup === null && game.relightCounts.swaps > swapsBefore) seen.releasedAfterWarmup = g.warmup !== warmupBefore;
      });
      let done = false;
      const p = game.relightAfterSettings().then(() => { done = true; });
      // while the rebuild runs the frame loop draws nothing: every frame that goes by meanwhile is held back by `warming`
      while (!done) {
        await h.waitFrames(1);
        if (!done && game.enhancedLighting.status().applying) { seen.framesWatched++; if (!g.warming) seen.noFrames = false; }
      }
      await p;
      off();
      return {seen};
    };

    // --- a new campaign under the defaults (Auto, Standard reflections) ---
    // (Node hands a MessagePort every message already waiting before it returns to its timers, so the default turn would run the whole
    // build without this host's timer-driven frames getting a look in; a browser gives every message its own task. A timer turn shows
    // the frames between the slices here: the slices and their bound are the same.)
    game.slicePacing = {turn: go => { setTimeout(go, 0); }};
    expect(await game.newCampaign(1, {overwrite: true, dev: {level: 'market'}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    game.slicePacing = {};
    // the load built the station in time slices behind the loading screen: frames went by between the slices and none of them drew
    // (a half-built station is not a scene), and the turns it took are bounded by its work
    const built = game.loadBuildStats!;
    expect(built.slices).toBe(built.waits + 1);
    expect(built.waits).toBeGreaterThan(0);
    expect(built.waits).toBeLessThanOrEqual(Math.floor(built.workMs / 40));
    expect(buildFrames.held, 'frames went by while the station was built').toBeGreaterThan(0);
    expect(buildFrames.drawn, 'none of them drew anything').toBe(0);
    expect(game.genMs).toBe(built.workMs);
    expect(await sweep('play')).toMatchObject({dropped: 0, issues: []});
    const st0 = game.enhancedLighting.status();
    expect(st0).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', shading: 'full', shadingReason: null, mirror: true, reflections: 'standard'}});
    const gi = (game.lightPool as unknown as {field: {gi?: number}}).field.gi!;
    expect(gi).toBeGreaterThan(0);
    expect(lighting()).toEqual(full(gi));
    const print0 = stationPrint(), gen0 = g.stationGen;

    // --- 1. pause -> Reflections High ---
    await pause();
    const before1 = {save: savePrint(), enemies: enemiesPrint(), pose: posePrint(), light: lightPrint(), counts: counts(), pool: game.lightPool};
    const field1 = activeLightField()!, probes1 = activeReflectionProbes()!, mirror1 = game.glassMirror;
    const releaseField1 = vi.spyOn(field1, 'dispose'), releaseProbes1 = vi.spyOn(probes1, 'dispose');
    const lineBefore = pauseLine.textContent;
    const a1 = await apply({reflections: 'high'});
    expect(a1.seen, 'the status said "applying" and Resume was held while the lighting was rebuilt, the warm-up included').toMatchObject({applying: true, held: true, noFrames: true, early: false, releasedAfterWarmup: true});
    expect(a1.seen.framesWatched, 'frames went by while it was rebuilt').toBeGreaterThan(0);
    expect(a1.seen.line).toContain('applying a change');
    expect(a1.seen.help).toContain(APPLYING_NOTE);
    expect(resume.disabled, 'Resume is free again').toBe(false);
    expect(pauseLine.textContent, 'the pause line is back').toBe(lineBefore);
    const st1 = game.enhancedLighting.status();
    expect(st1).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, reflections: 'high', reflectionsReason: null}});
    expect(st1.active!.probes).toBeGreaterThan(0);
    // the same light of the same shading, once; the bounce bound to the NEW lighting; the SAME mirror, its cap the High tier's
    expect(lighting()).toEqual(full(gi, 'high'));
    expect(game.glassMirror === mirror1, 'the mirror is kept across a change that keeps it').toBe(true);
    expect(game.relightCounts).toEqual({runs: 1, swaps: 1, failed: 0});
    expect(counts(), 'no station was generated, prepared, built or left').toBe(before1.counts);
    expect(g.stationGen, 'the same world generation').toBe(gen0);
    expect(game.lightPool, 'a new station lighting').not.toBe(before1.pool);
    expect(releaseField1, 'the replaced light field was released (after the warm-up)').toHaveBeenCalled();
    expect(releaseProbes1, 'the replaced probe textures were released').toHaveBeenCalled();
    const probes2 = activeReflectionProbes()!;
    expect(probes2).not.toBe(probes1);
    expect(REFL.atlas.value).toBe(probes2.atlas);
    expect({save: savePrint(), enemies: enemiesPrint(), pose: posePrint(), light: lightPrint()}, 'the run, the enemies, the pose and the flicker circuits are untouched')
      .toEqual({save: before1.save, enemies: before1.enemies, pose: before1.pose, light: before1.light});
    expect(stationPrint(), 'the same station').toBe(print0);
    await play();
    const high = await sweep('high');
    expect(high.submits).toBeGreaterThan(60);
    expect(high, 'High: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    // render objects built before the swap that sample the probes and are still drawn: bound to the NEW textures
    const reflective = [...drawn.get('high')!.values()].filter(ro => probeBindings(ro).length > 0);
    expect(reflective.length).toBeGreaterThan(0);
    expect(reflective.some(ro => drawn.get('play')!.has(ro.id)), 'some of them outlived the swap').toBe(true);
    for (const ro of reflective) for (const b of probeBindings(ro)) expect([probes2.atlas, probes2.meta, probes2.grid], ro.object.name).toContain(b.texture);

    // --- 2. pause -> Off: the baseline, the plain light, no probe texture anywhere ---
    await pause();
    const before2 = {save: savePrint(), enemies: enemiesPrint(), light: lightPrint(), counts: counts()};
    const releaseProbes2 = vi.spyOn(probes2, 'dispose');
    const a2 = await apply({enhancedLighting: 'off'});
    expect(a2.seen, 'until the swap the status said the enhanced lighting the station still had').toMatchObject({applying: true, held: true, noFrames: true, early: false});
    expect(a2.seen.help).toBe(`This station: baseline lighting. ${APPLYING_NOTE}`); // (from the swap on, while the warm-up ran)
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'baseline', giReason: null, shading: 'plain', shadingReason: null, mirror: false, reflections: 'off', cache: 'none', probes: 0, probeBytes: 0}});
    // the plain light alone: no cube in the bound field, no bounce, the mirror released
    expect(lighting()).toEqual({lights: [stationFieldLight().name], cube: [0, 0], bounce: [false, true], mirror: null});
    expect((mirror1!.debug() as {disposed: boolean}).disposed, 'the mirror was released with the lighting that had it').toBe(true);
    expect(activeReflectionProbes()).toBeNull();
    expect(releaseProbes2).toHaveBeenCalled();
    expect({save: savePrint(), enemies: enemiesPrint(), light: lightPrint(), counts: counts()}).toEqual(before2);
    await play();
    expect(await sweep('off'), 'Off: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect([...drawn.get('off')!.values()].filter(ro => probeBindings(ro).length > 0).map(ro => ro.object.name), 'nothing drawn samples a probe texture under Off').toEqual([]);

    // --- ... On (the high bake), then Auto + Standard again: the first bake from the session's cache ---
    await pause();
    await apply({enhancedLighting: 'on'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'high', shading: 'full', mirror: true, reflections: 'high'}});
    expect(lighting(), 'On: full shading again, a new mirror').toEqual(full(gi, 'high'));
    expect(game.glassMirror !== mirror1).toBe(true);
    await apply({enhancedLighting: 'auto', reflections: 'standard'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, reflections: 'standard', cache: 'hit', giMs: 0, probeMs: 0, probes: st0.active!.probes}});
    expect(lighting()).toEqual(full(gi));
    await play();
    expect(await sweep('auto-again'), 'Auto again: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect(stationPrint(), 'still the same station').toBe(print0);
    expect(g.stationGen).toBe(gen0);

    // --- 4. a bake that fails: the station keeps its lighting, the status says so, no retry by itself ---
    await pause();
    const pool4 = game.lightPool, runs4 = game.relightCounts.runs;
    const bake = vi.spyOn(game.enhancedLighting, 'bakeSteps').mockImplementationOnce(function* () { yield 'gather.surfaces'; throw new Error('simulated bake failure'); } as never);
    await apply({reflections: 'high'});
    bake.mockRestore();
    const st4 = game.enhancedLighting.status();
    expect(st4, 'what the station still uses, and that the change failed').toMatchObject({pending: true, applying: false, error: 'simulated bake failure', active: {gi: 'standard', reflections: 'standard'}});
    expect(describeEnhancedLighting(st4)).toMatch(/could not be applied \(simulated bake failure\)/);
    expect(enhancedLightingLine(st4)).toContain('change failed');
    expect(game.lightPool, 'the lighting it had').toBe(pool4);
    expect(lighting(), 'and everything that lighting had bound: its light, its cube, its bounce, the mirror').toEqual(full(gi));
    expect(resume.disabled).toBe(false);
    expect(game.relightCounts.failed).toBe(1);
    await play();
    expect(await sweep('after-failure'), 'after a failed change: nothing dropped').toMatchObject({dropped: 0, issues: []});
    await pause(); // (pausing again does not retry the plan that failed)
    await h.waitFrames(10);
    expect(game.relightCounts.runs).toBe(runs4 + 1);
    expect(game.lightPool).toBe(pool4);
    // a different choice works again, and the failure is history
    await apply({reflections: 'off'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', shading: 'full', mirror: false, reflections: 'off'}});
    // no probes: the FULL plain-field light (the cube and the bounce stay), and no mirror without probes
    expect(lighting()).toEqual({lights: [stationFieldLight(true).name], cube: [gi, 1], bounce: [true, true], mirror: null});
    await play();
    expect(await sweep('no-reflections'), 'no reflections: nothing dropped').toMatchObject({dropped: 0, issues: []});

    // --- 5. a change while playing (another tab) waits, and is applied at the next pause ---
    g.settings.reflections = 'standard';
    await game.relightAfterSettings();
    expect(game.enhancedLighting.status()).toMatchObject({pending: true, applying: false, active: {reflections: 'off'}});
    const swaps5 = game.relightCounts.swaps;
    game.setState('paused');
    expect(await until(() => game.relightCounts.swaps === swaps5 + 1 && !game.enhancedLighting.status().applying && !resume.disabled, 3000)).toBe(true);
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, reflections: 'standard', cache: 'hit'}});
    expect(lighting()).toEqual(full(gi));

    // --- 6. between two stations (the train journey's gap) and inside a transition nothing is rebuilt: the station that was left is
    //        torn down by then, and the next one's load applies the choice. A pause that outlives the transition is looked at again ---
    const runs6 = game.relightCounts.runs, pool6 = game.lightPool;
    g.transitGap = true;
    await apply({reflections: 'high'});
    expect(game.relightCounts.runs, 'nothing is rebuilt in the gap between two stations').toBe(runs6);
    expect(game.lightPool).toBe(pool6);
    expect(game.enhancedLighting.status()).toMatchObject({pending: true, applying: false, error: null, active: {reflections: 'standard'}});
    expect(describeEnhancedLighting(game.enhancedLighting.status())).toMatch(/Not applied yet/);
    g.transitGap = false;
    let endFlight!: () => void;
    const flight = g.lifecycle.run(() => new Promise<void>(r => { endFlight = r; }))!;
    const waiting = game.relightAfterSettings();
    await h.waitFrames(8);
    expect(game.relightCounts.runs, 'nothing is rebuilt inside a transition').toBe(runs6);
    expect([game.lightPool === pool6, resume.disabled, game.enhancedLighting.status().applying]).toEqual([true, false, false]);
    endFlight();
    await flight;
    await waiting; // the pause outlived the transition: the change is applied now
    expect(game.relightCounts.runs).toBe(runs6 + 1);
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, reflections: 'high'}});
    expect(lighting()).toEqual(full(gi, 'high'));
    expect(resume.disabled).toBe(false);
    await play();
    expect(await sweep('end'), 'at the end: nothing dropped').toMatchObject({dropped: 0, issues: []});
    expect(stationPrint(), 'the same station at the end').toBe(print0);
    expect(g.stationGen).toBe(gen0);

    // --- 7. a rebuild that is abandoned mid-bake (here: the device is lost while the bake runs) stops between two slices and leaves
    //        the station as it was: the lighting it had, the record it had, the change still pending, nothing counted as failed ---
    await pause();
    const pool7 = game.lightPool, counts7 = {...game.relightCounts}, active7 = JSON.stringify(game.enhancedLighting.status().active), line7 = pauseLine.textContent;
    const realBake = game.enhancedLighting.bakeSteps.bind(game.enhancedLighting);
    const gpu = (game as unknown as {gpu: {deviceLost: string | null}}).gpu;
    let lostAt = '', stepsAfter = 0, closed = false;
    const bake7 = vi.spyOn(game.enhancedLighting, 'bakeSteps').mockImplementationOnce(function* (...a: Parameters<typeof realBake>) {
      const inner = realBake(...a);
      try {
        for (;;) {
          const r = inner.next();
          if (r.done) return r.value;
          if (lostAt) stepsAfter++;
          else if (typeof r.value === 'string') { lostAt = r.value; gpu.deviceLost = 'simulated loss'; } // the first labelled stage of the bake
          yield r.value;
        }
      } finally { closed = true; inner.return(undefined as never); }
    } as never);
    const sliceBefore = game.slicePacing;
    game.slicePacing = {sliceMs: 0}; // (one step a slice: the bake is checked right after the loss)
    await apply({enhancedLighting: 'on', reflections: 'standard'}); // (a plan this session has not baked)
    game.slicePacing = sliceBefore;
    bake7.mockRestore();
    expect(lostAt, 'the bake had started').not.toBe('');
    expect([closed, stepsAfter], 'the bake was closed at the next check: no step ran after the loss').toEqual([true, 0]);
    gpu.deviceLost = null;
    expect(game.lightPool, 'the lighting it had').toBe(pool7);
    expect(JSON.stringify(game.enhancedLighting.status().active), 'the record it had').toBe(active7);
    expect(game.enhancedLighting.status()).toMatchObject({pending: true, applying: false, error: null});
    expect(game.relightCounts, 'one more run, no swap, no failure').toEqual({...counts7, runs: counts7.runs + 1});
    expect([resume.disabled, pauseLine.textContent]).toEqual([false, line7]);
    expect(lighting()).toEqual(full(gi, 'high'));
    // ... and the change, still pending, is applied whole by the next rebuild
    await apply({});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'high', shading: 'full', mirror: true, reflections: 'standard'}});
    expect(game.relightCounts).toEqual({...counts7, runs: counts7.runs + 2, swaps: counts7.swaps + 1});
    const rb = game.relightBuildStats!;
    expect(rb.slices).toBe(rb.waits + 1);
    expect(rb.waits, 'the turns of a rebuild are bounded by its work').toBeLessThanOrEqual(Math.floor(rb.workMs / 40));
    await play();
    expect(await sweep('after-abandon'), 'after an abandoned rebuild and a whole one: nothing dropped').toMatchObject({dropped: 0, issues: []});
    expect(stationPrint(), 'the same station').toBe(print0);

    // --- 8. (task studio-gi-mood-bounce-loading-20261115-081523-01, lane WORKERS) the bake on its WORKERS (real threads running the
    //        worker's own script: helpers/bakeWorkers.ts), and the choice changed while the rebuild waits for them: that bake is
    //        abandoned there — its workers stopped, nothing of it installed or cached — and the same run bakes what is asked for now ---
    await pause();
    const {threadWorkers} = await import('./helpers/bakeWorkers');
    const workers = await threadWorkers(2);
    game.enhancedLighting.setBakeWorkers(workers);
    await game.enhancedLighting.clearCache(); // (every choice is baked again: nothing below is a cache hit)
    const pool8 = game.lightPool, counts8 = {...game.relightCounts};
    game.slicePacing = {turn: go => { setTimeout(go, 0); }};
    Object.assign(g.settings, {enhancedLighting: 'on', reflections: 'high'});
    const realBake8 = game.enhancedLighting.bakeSteps.bind(game.enhancedLighting);
    let bakes8 = 0, closed8 = false, stepsAfter8 = 0, changedAt = '', aliveAtChange = 0, aliveAtSecond = -1, swapsAtChange = -1, mostAlive = 0;
    const bake8 = vi.spyOn(game.enhancedLighting, 'bakeSteps').mockImplementation(function* (...a: Parameters<typeof realBake8>) {
      const n = ++bakes8, inner = realBake8(...a);
      if (n === 2) aliveAtSecond = workers.alive();
      try {
        for (;;) {
          const r = inner.next();
          if (r.done) return r.value;
          if (n === 1 && changedAt) stepsAfter8++;
          else if (n === 1 && typeof r.value === 'object' && r.value !== null && 'wait' in r.value) {
            // the first bake waits for its workers (they have their job): another tab changes the choice
            changedAt = pauseLine.textContent || '(waiting)';
            aliveAtChange = workers.alive();
            swapsAtChange = game.relightCounts.swaps;
            g.settings.enhancedLighting = 'auto';
          }
          yield r.value;
        }
      } finally { if (n === 1) closed8 = true; inner.return(undefined as never); }
    } as never);
    let done8 = false;
    const rebuilt = game.relightAfterSettings().then(() => { done8 = true; });
    while (!done8) { await h.waitFrames(1); mostAlive = Math.max(mostAlive, workers.alive()); }
    await rebuilt;
    bake8.mockRestore();
    game.slicePacing = {};
    expect(changedAt, 'the choice was changed while the first bake was waiting for its workers').not.toBe('');
    expect([aliveAtChange, swapsAtChange]).toEqual([2, counts8.swaps]);
    expect([bakes8, closed8, stepsAfter8, aliveAtSecond], 'the first bake was closed where it waited, its workers gone before the second bake began').toEqual([2, true, 0, 0]);
    expect(game.relightCounts, 'one run: the abandoned bake is neither a swap nor a failure, the second pass swaps').toEqual({...counts8, runs: counts8.runs + 1, swaps: counts8.swaps + 1});
    expect(game.lightPool).not.toBe(pool8);
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, reflections: 'high'}, bake: {workers: 2, fallback: null}});
    expect(game.enhancedLighting.status().active!.cache, 'baked now, not taken from the cache').not.toBe('hit');
    expect(lighting()).toEqual(full(gi, 'high'));
    // two workers per bake, the first bake's stopped before the second bake's were started, none left at the end
    expect([workers.spawned, mostAlive, workers.alive()]).toEqual([4, 2, 0]);
    expect(game.relightBuildStats!.parks, 'the second bake waited for its workers too').toBeGreaterThan(0);
    expect(resume.disabled).toBe(false);
    await play();
    expect(await sweep('after-workers'), 'lit by a bake made on the workers: nothing dropped').toMatchObject({dropped: 0, issues: []});
    expect(stationPrint(), 'the same station').toBe(print0);
    expect(g.stationGen).toBe(gen0);

    expect(frameErrors).toEqual([]);
    expect(errors).toEqual([]);
    h.stop();
  }, 900_000);
});
