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
    const {stationFieldLight, activeLightField} = await import('../src/world/lightFieldNode');
    const {APPLYING_NOTE, describeEnhancedLighting, enhancedLightingLine} = await import('../src/world/enhancedLighting');
    const game = new Game(h.canvas, false);
    const g = game as unknown as {
      player: {x: number; y: number; z: number; yaw: number; pitch: number}; state: string; scene: {children: unknown[]}; stationGen: number; warming: boolean; warmup: unknown;
      layout: {grid: {cells: Uint8Array}; props: {kind: string; x: number; z: number}[]; lights: unknown[]};
      containers: {all: {state: {lots: {itemId: string; count?: number}[]}}[]};
      zombies: {brain: {x: number; y: number; z: number; hp: number; alive: boolean}}[];
      world: {fixtures: {level: number}[]};
      settings: {enhancedLighting: string; reflections: string};
      captureSave(reason: string): {meta: Record<string, unknown>} & Record<string, unknown>;
    };
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
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
      const seen = {applying: false, held: false, noFrames: true, line: '', help: '', releasedAfterWarmup: null as boolean | null};
      const warmupBefore = g.warmup, swapsBefore = game.relightCounts.swaps;
      const off = game.enhancedLighting.subscribe(() => {
        const st = game.enhancedLighting.status();
        if (st.applying) { seen.applying = true; seen.held = resume.disabled; seen.line = enhancedLightingLine(st); seen.help = describeEnhancedLighting(st); }
        // the forms get their choices back (applying ends) only once the warm-up of a swapped lighting has finished
        else if (seen.applying && seen.releasedAfterWarmup === null && game.relightCounts.swaps > swapsBefore) seen.releasedAfterWarmup = g.warmup !== warmupBefore;
      });
      const submits0 = h.log.submits;
      const p = game.relightAfterSettings();
      // while the rebuild runs the frame loop draws nothing: watch a few frames go by
      await h.waitFrames(3);
      if (game.enhancedLighting.status().applying && !g.warming) seen.noFrames = false;
      await p;
      off();
      return {seen, submitsDuring: h.log.submits - submits0};
    };

    // --- a new campaign under the defaults (Auto, Standard reflections) ---
    expect(await game.newCampaign(1, {overwrite: true, dev: {level: 'market'}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    expect(await sweep('play')).toMatchObject({dropped: 0, issues: []});
    const st0 = game.enhancedLighting.status();
    expect(st0).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', reflections: 'standard'}});
    const print0 = stationPrint(), gen0 = g.stationGen;

    // --- 1. pause -> Reflections High ---
    await pause();
    const before1 = {save: savePrint(), enemies: enemiesPrint(), pose: posePrint(), light: lightPrint(), counts: counts(), pool: game.lightPool};
    const field1 = activeLightField()!, probes1 = activeReflectionProbes()!;
    const releaseField1 = vi.spyOn(field1, 'dispose'), releaseProbes1 = vi.spyOn(probes1, 'dispose');
    const lineBefore = pauseLine.textContent;
    const a1 = await apply({reflections: 'high'});
    expect(a1.seen, 'the status said "applying" and Resume was held while the lighting was rebuilt, the warm-up included').toMatchObject({applying: true, held: true, noFrames: true, releasedAfterWarmup: true});
    expect(a1.seen.line).toContain('applying a change');
    expect(a1.seen.help).toContain(APPLYING_NOTE);
    expect(resume.disabled, 'Resume is free again').toBe(false);
    expect(pauseLine.textContent, 'the pause line is back').toBe(lineBefore);
    const st1 = game.enhancedLighting.status();
    expect(st1).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'standard', reflections: 'high', reflectionsReason: null}});
    expect(st1.active!.probes).toBeGreaterThan(0);
    expect(game.relightCounts).toEqual({runs: 1, swaps: 1, failed: 0});
    expect(counts(), 'no station was generated, prepared, built or left').toBe(before1.counts);
    expect(g.stationGen, 'the same world generation').toBe(gen0);
    expect(game.lightPool, 'a new station lighting').not.toBe(before1.pool);
    expect(releaseField1, 'the replaced light field was released (after the warm-up)').toHaveBeenCalled();
    expect(releaseProbes1, 'the replaced probe textures were released').toHaveBeenCalled();
    const probes2 = activeReflectionProbes()!;
    expect(probes2).not.toBe(probes1);
    expect(REFL.atlas.value).toBe(probes2.atlas);
    expect(g.scene.children.filter(c => c === stationReflectLight()).length, 'the reflecting field light, once').toBe(1);
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
    await apply({enhancedLighting: 'off'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {gi: 'baseline', giReason: null, reflections: 'off', cache: 'none', probes: 0, probeBytes: 0}});
    expect(g.scene.children).toContain(stationFieldLight());
    expect(g.scene.children).not.toContain(stationReflectLight());
    expect(activeReflectionProbes()).toBeNull();
    expect(releaseProbes2).toHaveBeenCalled();
    expect({save: savePrint(), enemies: enemiesPrint(), light: lightPrint(), counts: counts()}).toEqual(before2);
    await play();
    expect(await sweep('off'), 'Off: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect([...drawn.get('off')!.values()].filter(ro => probeBindings(ro).length > 0).map(ro => ro.object.name), 'nothing drawn samples a probe texture under Off').toEqual([]);

    // --- ... On (the high bake), then Auto + Standard again: the first bake from the session's cache ---
    await pause();
    await apply({enhancedLighting: 'on'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'high', reflections: 'high'}});
    await apply({enhancedLighting: 'auto', reflections: 'standard'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', reflections: 'standard', cache: 'hit', giMs: 0, probeMs: 0, probes: st0.active!.probes}});
    expect(g.scene.children).toContain(stationReflectLight());
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
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', reflections: 'off'}});
    expect(g.scene.children).toContain(stationFieldLight());
    await play();
    expect(await sweep('no-reflections'), 'no reflections: nothing dropped').toMatchObject({dropped: 0, issues: []});

    // --- 5. a change while playing (another tab) waits, and is applied at the next pause ---
    g.settings.reflections = 'standard';
    await game.relightAfterSettings();
    expect(game.enhancedLighting.status()).toMatchObject({pending: true, applying: false, active: {reflections: 'off'}});
    const swaps5 = game.relightCounts.swaps;
    game.setState('paused');
    expect(await until(() => game.relightCounts.swaps === swaps5 + 1 && !game.enhancedLighting.status().applying && !resume.disabled, 3000)).toBe(true);
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {gi: 'standard', reflections: 'standard', cache: 'hit'}});
    await play();
    expect(await sweep('end'), 'at the end: nothing dropped').toMatchObject({dropped: 0, issues: []});
    expect(stationPrint(), 'the same station at the end').toBe(print0);
    expect(g.stationGen).toBe(gen0);

    expect(frameErrors).toEqual([]);
    expect(errors).toEqual([]);
    h.stop();
  }, 900_000);
});
