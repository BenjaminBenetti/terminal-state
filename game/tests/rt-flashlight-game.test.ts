// Task studio-rt-flashlight-compute-20261115-233136-01: RT FLASHLIGHT in the REAL Game (src/game.ts: the asset boot, the campaign
// lifecycle, the warm-up, the live relight) on three r186's real WebGPURenderer over the validating no-op device (helpers/headlessGame.ts,
// helpers/validatingWebgpu.ts: compute pipelines, passes and storage textures are validated like the render work; a command buffer
// that references a destroyed resource is rejected whole). The device runs no shader: what the kernels compute is
// tests/rt-flashlight-estimator.test.ts (the CPU mirror) and the task's GPU parity page; this file is the lifecycle.
//  1. A new campaign under the defaults (Auto, Standard reflections, RT Flashlight On, a device that passes the compute probe): the
//     station is lit by the full + mirror light's RT variant alone; the virtual-light bounce is NOT bound (replaced, not stacked); no
//     drawn program knows it, drawn programs read the traced result; the traced scene holds the station; with the flashlight on every
//     drawn frame dispatches the kernels; nothing dropped at any angle; nothing compiled while playing; every module inside WebGPU's
//     default per-stage limits.
//  2. The flashlight off: nothing dispatched, the gate shut (the materials add zero); on again: traced again.
//  3. Pause -> RT Flashlight Off: the current bounce, bound to the new lighting, and nothing of RT — the device resources freed, the
//     zero placeholders back, no drawn program reads them; the station and the run untouched. On again: RT back.
//  4. death -> Load last save and Main menu -> Continue: RT again, the previous station's resources released first (the menu keeps the
//     station, and its traced scene, behind the frozen frame it redraws at a low rate).
//  5. A device error in the traced work: the session falls back — the gate shut at once, the standard bounce from the next pause,
//     the status saying why — and an RT On choice does not bring it back.
//  6. Every allocation freed; nothing of RT left on the device.
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; isStorageTexture?: boolean; texture?: unknown; textureNode?: {value?: unknown} }
interface RenderObject { id: number; object: {name: string}; getBindings(): {bindings: Binding[]}[] }

const LIMITS = {uniformBuffers: 12, sampledTextures: 16, samplers: 16} as const;
function wgslBindings(src: string): {uniformBuffers: number; textures: number; samplers: number} {
  return {
    uniformBuffers: (src.match(/var<uniform>/g) ?? []).length,
    textures: (src.match(/^@binding\(.*\) var \w+ : texture_/gm) ?? []).length,
    samplers: (src.match(/^@binding\(.*\) var \w+ : sampler(_comparison)?;/gm) ?? []).length,
  };
}
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

describe('RT Flashlight in the real Game (WebGPU path, validating device)', () => {
  it('defaults trace the bounce instead of the virtual lights; torch off, pause Off / On, death, Continue, a device error and leaving swap cleanly', async () => {
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const warnings: string[] = [], errors: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.map(String).join(' ').slice(0, 400)); });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const h = installHeadless();
    const {Game} = await import('../src/game');
    const {stationReflectLight} = await import('../src/world/reflectionNode');
    const {stationLights} = await import('../src/world/lightFieldNode');
    const {FLASH_BOUNCE} = await import('../src/world/lights');
    const {RTB} = await import('../src/world/rtBounceNode');
    const {RT_KERNELS} = await import('../src/render/rt/rtKernels');
    const game = new Game(h.canvas, false);
    const g = game as unknown as {
      player: {x: number; y: number; z: number; yaw: number; pitch: number; takeDamage(n: number): void}; state: string; scene: {children: unknown[]};
      layout: {grid: {cells: Uint8Array}; props: {kind: string; x: number; z: number}[]; lights: unknown[]};
      containers: {all: {state: {lots: {itemId: string; count?: number}[]}}[]};
      settings: {enhancedLighting: string; reflections: string; rtFlashlight: boolean};
      lightPool: {rt: boolean; full: boolean; bounce: unknown};
      captureSave(reason: string): {meta: Record<string, unknown>} & Record<string, unknown>;
      flashlightOn: boolean;
    };
    const fieldLights = (): string[] => g.scene.children.filter(c => (stationLights() as unknown[]).includes(c)).map(l => (l as {name: string}).name);
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    expect(game.gpu?.label).toBe('Renderer: WebGPU');
    // the probe: the real device's limits and every kernel compiled — the session's runtime exists, holding nothing yet
    expect(game.rtProbe).toMatchObject({ok: true, reason: null});
    expect(Object.keys(game.rtProbe!.pipelines!).sort()).toEqual([...RT_KERNELS].sort());
    const rt = game.rtFlashlight!;
    expect(rt).toBeTruthy();
    expect(rt.gpu.allocated).toBe(false);
    const placeholders = [RTB.E.value, RTB.N.value];
    const modules: {label: string; code: string}[] = [];
    const device = (game.renderer.backend as unknown as {device: {createShaderModule(d: {label?: string; code?: string}): unknown}}).device;
    const createShaderModule = device.createShaderModule.bind(device);
    device.createShaderModule = d => { modules.push({label: d.label ?? '', code: d.code ?? ''}); return createShaderModule(d); };
    await game.load(() => {});
    expect(game.enhancedLighting.capabilities().rt).toEqual({ok: true, reason: null});
    expect(g.settings).toMatchObject({enhancedLighting: 'auto', reflections: 'standard', rtFlashlight: true});

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
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const sweep = async (name: string) => {
      phase = name;
      h.log.reset();
      const m0 = modules.length, d0 = rt.stats.dispatched;
      await h.waitFrames(12);
      const y0 = g.player.yaw;
      for (let i = 0; i < 16; i++) { g.player.yaw = y0 + (i / 16) * Math.PI * 2; await h.waitFrames(2); }
      g.player.yaw = y0;
      await h.waitFrames(4);
      return {submits: h.log.submits, dropped: h.log.dropped, issues: h.log.issues.slice(0, 5).map(i => i.detail), built: modules.slice(m0).map(m => m.label), dispatched: rt.stats.dispatched - d0};
    };
    const nodes = (game.renderer as unknown as {_nodes: {get(ro: RenderObject): {nodeBuilderState?: {fragmentShader?: string}}}})._nodes;
    const fragmentOf = (ro: RenderObject): string => nodes.get(ro).nodeBuilderState?.fragmentShader ?? '';
    /** Drawn programs that hold the virtual-light bounce (world/flashBounce.ts FB's named uniforms) / read the traced one (RTB's). */
    const withBounce = (name: string): string[] => [...drawn.get(name)!.values()].filter(ro => /\bfbParams\b/.test(fragmentOf(ro))).map(ro => ro.object.name);
    const withRt = (name: string): string[] => [...drawn.get(name)!.values()].filter(ro => /\brtCam\b/.test(fragmentOf(ro))).map(ro => ro.object.name);
    /** Drawn render objects whose bindings hold the traced result's textures (the runtime's, while a station is traced). */
    const rtBound = (name: string): RenderObject[] => [...drawn.get(name)!.values()].filter(ro => ro.getBindings().flatMap(b => b.bindings).some(b => b.isSampledTexture && (b.textureNode?.value === RTB.E.value || b.textureNode?.value === RTB.N.value)));
    const lighting = () => ({lights: fieldLights(), rt: g.lightPool.rt, bounce: FLASH_BOUNCE.debug().bound, traced: rt.hasScene, allocated: rt.gpu.allocated});
    const RT_LIT = {lights: [stationReflectLight(true, true, true).name], rt: true, bounce: false, traced: true, allocated: true};
    const STANDARD = {lights: [stationReflectLight(true, true).name], rt: false, bounce: true, traced: false, allocated: false};
    const stationPrint = () => fnv(JSON.stringify([
      fnv(Buffer.from(g.layout.grid.cells).toString('latin1')), g.layout.props.map(p => [p.kind, Math.round(p.x * 100), Math.round(p.z * 100)]), g.layout.lights,
      g.containers.all.map(x => x.state.lots.map(l => [l.itemId, l.count ?? 1])),
    ]));
    const savePrint = () => { const f = g.captureSave('manual'); return fnv(JSON.stringify({...f, meta: {...f.meta, savedAt: null}})); };
    const posePrint = () => JSON.stringify([g.player.x, g.player.y, g.player.z, g.player.yaw, g.player.pitch]);
    const pause = async () => { game.setState('paused'); await h.waitFrames(6); };
    const play = async () => { game.setState('playing'); await h.waitFrames(6); };
    /** One change in the pause menu, as main.ts makes it (the live relight). */
    const apply = async (patch: Partial<{rtFlashlight: boolean}>) => { Object.assign(g.settings, patch); await game.relightAfterSettings(); await h.waitFrames(2); };

    // 1. a new campaign under the defaults
    phase = 'newgame';
    expect(await game.newCampaign(1, {overwrite: true, dev: {level: 'market'}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    g.flashlightOn = true;
    const play1 = await sweep('play');
    expect(play1.submits).toBeGreaterThan(60);
    expect(play1, 'RT: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    const st1 = game.enhancedLighting.status();
    expect(st1).toMatchObject({pending: false, error: null, active: {gi: 'standard', shading: 'full', mirror: true, rt: true, rtReason: null}});
    const scene1 = st1.active!.rtScene!;
    expect(scene1.triangles, 'the traced scene holds the station').toBeGreaterThan(10_000);
    expect(scene1.instances).toBeGreaterThan(50);
    expect(lighting(), 'the RT light alone; the virtual lights are not bound').toEqual(RT_LIT);
    expect(withBounce('play'), 'no drawn program knows the virtual-light bounce').toEqual([]);
    expect(withRt('play').length, 'drawn programs read the traced bounce').toBeGreaterThan(0);
    expect(rtBound('play').length, 'drawn render objects sample the runtime\'s result textures').toBeGreaterThan(0);
    expect([RTB.E.value, RTB.N.value].some(t => placeholders.includes(t)), 'the result textures are the runtime\'s, not the placeholders').toBe(false);
    expect(play1.dispatched, 'every drawn frame dispatches the kernels').toBeGreaterThan(20);
    expect(RTB.cam.value.w, 'the gate is open').toBe(1);
    expect(rt.stats.grid.w).toBeGreaterThan(0);
    expect(play1.built, 'no shader module is compiled while playing (the warm-up built the RT variants)').toEqual([]);
    const print1 = stationPrint();
    let worst = {uniformBuffers: 0, textures: 0, samplers: 0}, rtModules = 0;
    for (const m of modules) {
      const b = wgslBindings(m.code);
      expect(b.uniformBuffers, `${m.label}: uniform buffers`).toBeLessThanOrEqual(LIMITS.uniformBuffers);
      expect(b.textures, `${m.label}: sampled textures`).toBeLessThanOrEqual(LIMITS.sampledTextures);
      expect(b.samplers, `${m.label}: samplers`).toBeLessThanOrEqual(LIMITS.samplers);
      if (/\brtCam\b/.test(m.code)) { rtModules++; worst = {uniformBuffers: Math.max(worst.uniformBuffers, b.uniformBuffers), textures: Math.max(worst.textures, b.textures), samplers: Math.max(worst.samplers, b.samplers)}; }
    }
    expect(rtModules).toBeGreaterThan(0);
    const stats1 = rt.stats;
    process.stdout.write(`rt-flashlight-game: traced scene ${scene1.triangles} triangles / ${scene1.instances} instances; grid ${stats1.grid.w}x${stats1.grid.h}; ` +
      `rays/frame light ${stats1.rays.light} primary ${stats1.rays.primary} shadow<=${stats1.rays.shadowMax}; device bytes ${JSON.stringify(stats1.gpu.bytes)}; ` +
      `sync ${stats1.syncMs.toFixed(3)} ms encode ${stats1.encodeMs.toFixed(3)} ms (Node, last frame); ${rtModules} RT programs, worst per stage ${JSON.stringify(worst)}\n`);

    // 2. the flashlight off: nothing traced, the gate shut; on again: traced
    g.flashlightOn = false;
    const dark = await sweep('torch-off');
    expect(dark, 'torch off: nothing dropped').toMatchObject({dropped: 0, issues: [], dispatched: 0});
    expect([RTB.cam.value.w, rt.stats.historyReset]).toEqual([0, 'flashlight off']);
    g.flashlightOn = true;
    const lit = await sweep('torch-on');
    expect(lit.dispatched).toBeGreaterThan(20);
    expect(RTB.cam.value.w).toBe(1);

    // 3. pause -> RT Flashlight Off: the current bounce, nothing of RT
    await pause();
    const before = {save: savePrint(), pose: posePrint(), allocs: rt.gpu.lifecycle.allocs, frees: rt.gpu.lifecycle.frees};
    await apply({rtFlashlight: false});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, applying: false, error: null, active: {shading: 'full', rt: false, rtReason: null, rtScene: null}});
    expect(lighting(), 'Off: the standard bounce on the full + mirror light').toEqual(STANDARD);
    expect(rt.gpu.lifecycle.frees, 'its device resources were freed').toBe(before.frees + 1);
    expect([RTB.E.value, RTB.N.value], 'the zero placeholders are back').toEqual(placeholders);
    expect(RTB.cam.value.w).toBe(0);
    expect({save: savePrint(), pose: posePrint()}, 'the run and the pose are untouched').toEqual({save: before.save, pose: before.pose});
    await play();
    const off = await sweep('rt-off');
    expect(off, 'RT Off: nothing dropped at any angle, nothing dispatched').toMatchObject({dropped: 0, issues: [], dispatched: 0, built: []});
    expect(withRt('rt-off'), 'no drawn program reads the traced bounce under Off').toEqual([]);
    expect(withBounce('rt-off').length, 'drawn programs hold the standard bounce').toBeGreaterThan(0);
    expect(FLASH_BOUNCE.debug(), 'the standard bounce is live').toMatchObject({bound: true, lit: true});
    expect(stationPrint(), 'Off: the same station').toBe(print1);
    // ... On again
    await pause();
    await apply({rtFlashlight: true});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {rt: true, rtReason: null}});
    expect(lighting(), 'On again: traced').toEqual(RT_LIT);
    expect(rt.gpu.lifecycle.allocs).toBe(before.allocs + 1);
    await play();
    const on = await sweep('rt-on');
    expect(on, 'On again: nothing dropped, traced, nothing compiled').toMatchObject({dropped: 0, issues: [], built: []});
    expect(on.dispatched).toBeGreaterThan(20);
    expect(withBounce('rt-on')).toEqual([]);
    expect(stationPrint()).toBe(print1);
    expect(game.relightCounts).toMatchObject({runs: 2, swaps: 2, failed: 0});

    // 4. death -> Load last save; Main menu -> Continue
    const frees4 = rt.gpu.lifecycle.frees;
    g.player.takeDamage(1e6);
    expect(await until(() => g.state === 'dead', 300)).toBe(true);
    await h.waitFrames(20);
    phase = 'reload';
    expect(await game.loadLastSave()).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    g.flashlightOn = true;
    const reload = await sweep('after-death');
    expect(reload, 'Load last save: nothing dropped, traced').toMatchObject({dropped: 0, issues: [], built: []});
    expect(reload.dispatched).toBeGreaterThan(20);
    expect(lighting()).toEqual(RT_LIT);
    expect(rt.gpu.lifecycle.frees, 'the previous station\'s resources were released').toBeGreaterThan(frees4);
    expect(game.enhancedLighting.status().active).toMatchObject({rt: true, rtScene: {triangles: scene1.triangles}});
    expect(stationPrint(), 'the reloaded station is the station').toBe(print1);
    game.setState('paused');
    await h.waitFrames(6);
    game.returnToMenu();
    await h.waitFrames(6);
    // (the menu keeps the station, and with it its traced scene, behind the frozen frame it redraws at a low rate; Continue replaces it)
    expect([rt.hasScene, rt.gpu.allocated], 'the menu: the station is kept, its traced scene with it').toEqual([true, true]);
    const frames5 = rt.stats.dispatched + rt.stats.skipped, frees5 = rt.gpu.lifecycle.frees;
    await h.waitFrames(60);
    expect(rt.stats.dispatched + rt.stats.skipped - frames5, 'the frozen frame is traced only when it is redrawn (a low rate)').toBeLessThan(30);
    phase = 'continue';
    expect(await game.continueCampaign(1)).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    g.flashlightOn = true;
    const cont = await sweep('continue');
    expect(cont, 'Continue: nothing dropped, traced').toMatchObject({dropped: 0, issues: [], built: []});
    expect(cont.dispatched).toBeGreaterThan(20);
    expect(lighting()).toEqual(RT_LIT);
    expect(rt.gpu.lifecycle.frees, 'Continue released the station it replaced first').toBe(frees5 + 1);

    // 5. a device error in the traced work: the gate shuts at once, the standard bounce from the next pause, and stays
    const warned = warnings.length;
    rt.failWith('a test device error');
    expect([rt.failure, rt.hasScene, rt.gpu.allocated, RTB.cam.value.w]).toEqual(['a test device error', false, false, 0]);
    expect(warnings.slice(warned).join('\n')).toContain('RT Flashlight: a test device error');
    expect(game.enhancedLighting.capabilities().rt).toEqual({ok: false, reason: 'a test device error'});
    expect(game.enhancedLighting.status().pending, 'the live station\'s lighting is now a pending change').toBe(true);
    const failed = await sweep('failed');
    expect(failed, 'after the error: nothing dropped, nothing dispatched').toMatchObject({dropped: 0, issues: [], dispatched: 0});
    await pause();
    await game.relightAfterSettings(); // (the pause started it: this is the running one)
    expect(game.relightCounts, 'the pause applied the fallback').toMatchObject({runs: 3, swaps: 3, failed: 0});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, error: null, active: {shading: 'full', rt: false, rtReason: 'a test device error'}});
    expect(lighting(), 'the standard bounce').toEqual(STANDARD);
    await play();
    const fallback = await sweep('fallback');
    expect(fallback, 'the fallback: nothing dropped at any angle').toMatchObject({dropped: 0, issues: [], dispatched: 0, built: []});
    expect(withBounce('fallback').length).toBeGreaterThan(0);
    expect(withRt('fallback')).toEqual([]);
    expect(g.settings.rtFlashlight, 'the choice is the player\'s and stays On').toBe(true);
    expect(stationPrint()).toBe(print1);

    // 6. every allocation was freed (the failure released the last), and the menu after it holds nothing of RT
    game.setState('paused');
    await h.waitFrames(6);
    game.returnToMenu();
    await h.waitFrames(6);
    expect([rt.hasScene, rt.gpu.allocated]).toEqual([false, false]);
    expect(rt.gpu.lifecycle.frees, 'every allocation was freed').toBe(rt.gpu.lifecycle.allocs);
    expect([RTB.E.value, RTB.N.value]).toEqual(placeholders);
    expect(frameErrors, 'no frame threw').toEqual([]);
    expect(errors.filter(e => !/requestAnimationFrame is not a function/.test(e)), 'no console error').toEqual([]);
  }, 900_000);
});
