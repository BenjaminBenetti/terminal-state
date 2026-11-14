// Task studio-baked-lighting-reflections-20261114-050258-01: Enhanced lighting in the REAL Game (src/game.ts: the asset boot, the
// campaign lifecycle, the warm-up, the atmosphere pipeline) on three r186's real WebGPURenderer over the validating no-op device
// (helpers/headlessGame.ts, helpers/validatingWebgpu.ts: a command buffer that references a destroyed texture is rejected whole).
//  1. A new campaign under the defaults (Auto, Standard reflections): the station is built with the enhanced bake and probes, the
//     REFLECTING field light is in the scene, metal / glass render objects sample the probe atlas, and EVERY shader module the game
//     compiled stays inside WebGPU's default per-stage limits (12 uniform buffers, 16 sampled textures, 16 samplers).
//  2. death -> Load last save (the route of the separate death / reload fix): nothing dropped at any angle; the previous station's
//     probe textures are released; render objects that outlive the station follow to the NEW probe textures; the bake comes from
//     the session's cache.
//  3. Enhanced lighting Off, then Main menu -> Continue: the plain field light, no probe texture bound by anything drawn, the status
//     says baseline; then Auto again: the probes are back.
//  4. The same station every time — layout, loot holders — and no derived data anywhere in browser storage (the save, the settings).
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

interface Binding { isSampledTexture?: boolean; texture?: unknown; textureNode?: {value?: unknown} }
interface RenderObject { id: number; object: {name: string; parent: unknown}; material?: {name?: string; type?: string}; getBindings(): {bindings: Binding[]}[] }

/** WebGPU's DEFAULT per-stage limits (three requests nothing higher). */
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

describe('Enhanced lighting in the real Game (WebGPU path, validating device)', () => {
  it('defaults build probes inside the binding limits; death / reload, Off and Auto again swap light sets and textures without a dropped submit', async () => {
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const h = installHeadless();
    const {Game} = await import('../src/game');
    const {REFL, activeReflectionProbes, stationReflectLight} = await import('../src/world/reflectionNode');
    const {stationFieldLight, activeLightField} = await import('../src/world/lightFieldNode');
    const game = new Game(h.canvas, false);
    const g = game as unknown as {
      player: {yaw: number; takeDamage(n: number): void}; state: string; scene: {children: unknown[]};
      layout: {grid: {cells: Uint8Array}; props: {kind: string; x: number; z: number}[]; lights: unknown[]};
      containers: {holders: {state: {lots: {itemId: string; count?: number}[]}}[]};
      settings: {enhancedLighting: string; reflections: string};
    };
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    expect(game.gpu?.label).toBe('Renderer: WebGPU');
    // every shader module the game compiles from here on
    const modules: {label: string; code: string}[] = [];
    const device = (game.renderer.backend as unknown as {device: {createShaderModule(d: {label?: string; code?: string}): unknown}}).device;
    const createShaderModule = device.createShaderModule.bind(device);
    device.createShaderModule = d => { modules.push({label: d.label ?? '', code: d.code ?? ''}); return createShaderModule(d); };
    await game.load(() => {});
    const caps = game.enhancedLighting.capabilities();
    expect(caps).toMatchObject({backend: 'webgpu', halfFloatLinear: true});
    expect(caps.maxTextureSize).toBeGreaterThanOrEqual(2048);
    expect(g.settings).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});

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
    const probeNodes = new Set<unknown>([REFL.atlas, REFL.meta, REFL.grid]);
    const probeBindings = (ro: RenderObject) => ro.getBindings().flatMap(b => b.bindings).filter(b => b.isSampledTexture && probeNodes.has(b.textureNode));
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const sweep = async (name: string) => {
      phase = name;
      h.log.reset();
      await h.waitFrames(20);
      const y0 = g.player.yaw;
      for (let i = 0; i < 24; i++) { g.player.yaw = y0 + (i / 24) * Math.PI * 2; await h.waitFrames(2); }
      g.player.yaw = y0;
      await h.waitFrames(4);
      return {submits: h.log.submits, dropped: h.log.dropped, issues: h.log.issues.slice(0, 5).map(i => i.detail)};
    };
    /** The station as generated and stocked (what a cache hit, a miss or Off may never change). */
    const stationPrint = () => fnv(JSON.stringify([
      fnv(Buffer.from(g.layout.grid.cells).toString('latin1')), g.layout.props.map(p => [p.kind, Math.round(p.x * 100), Math.round(p.z * 100)]), g.layout.lights,
      g.containers.holders.map(x => x.state.lots.map(l => [l.itemId, l.count ?? 1])),
    ]));

    // 1. a new campaign under the defaults
    phase = 'newgame';
    expect(await game.newCampaign(1, {overwrite: true, dev: {level: 'market'}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const play = await sweep('play');
    expect(play.submits).toBeGreaterThan(100);
    expect(play, 'enhanced: nothing dropped').toMatchObject({dropped: 0, issues: []});
    const st1 = game.enhancedLighting.status();
    expect(st1.pending).toBe(false);
    expect(st1.active).toMatchObject({gi: 'standard', reflections: 'standard', reflectionsReason: null});
    expect(st1.active!.probes).toBeGreaterThan(0);
    expect(st1.active!.probeBytes).toBeGreaterThan(0);
    expect(['miss', 'unavailable']).toContain(st1.active!.cache); // (Node has no IndexedDB: this session's memory only)
    expect(g.scene.children).toContain(stationReflectLight());
    expect(g.scene.children).not.toContain(stationFieldLight());
    const probes1 = activeReflectionProbes()!;
    expect(probes1).toBeTruthy();
    expect(REFL.atlas.value).toBe(probes1.atlas);
    const reflective1 = [...drawn.get('play')!.values()].filter(ro => probeBindings(ro).length > 0);
    expect(reflective1.length, 'render objects that sample the probes (metal, glass)').toBeGreaterThan(0);
    for (const ro of reflective1) for (const b of probeBindings(ro)) expect([probes1.atlas, probes1.meta, probes1.grid], ro.object.name).toContain(b.texture);
    const print1 = stationPrint();

    // every module compiled so far (the warm-up and the sweep: every material of the station, the car, the held weapon, the fog)
    expect(modules.length).toBeGreaterThan(20);
    let worst = {uniformBuffers: 0, textures: 0, samplers: 0}, withProbes = 0;
    for (const m of modules) {
      const b = wgslBindings(m.code);
      expect(b.uniformBuffers, `${m.label}: uniform buffers`).toBeLessThanOrEqual(LIMITS.uniformBuffers);
      expect(b.textures, `${m.label}: sampled textures`).toBeLessThanOrEqual(LIMITS.sampledTextures);
      expect(b.samplers, `${m.label}: samplers`).toBeLessThanOrEqual(LIMITS.samplers);
      worst = {uniformBuffers: Math.max(worst.uniformBuffers, b.uniformBuffers), textures: Math.max(worst.textures, b.textures), samplers: Math.max(worst.samplers, b.samplers)};
      if (/textureSampleLevel\(\s*\w*[Aa]tlas|reflection/.test(m.code) || (m.code.match(/texture_3d/g) ?? []).length >= 2) withProbes++;
    }
    process.stdout.write(`enhanced-lighting-game: ${modules.length} shader modules, worst per stage ${JSON.stringify(worst)}, ${reflective1.length} reflective render objects, ${st1.active!.probes} probes\n`);
    expect(withProbes, 'fragment programs that hold the probe grid').toBeGreaterThan(0);

    // 2. death -> Load last save, enhanced lighting still on
    const field1 = activeLightField()!;
    const releaseField = vi.spyOn(field1, 'dispose'), releaseProbes = vi.spyOn(probes1, 'dispose');
    g.player.takeDamage(1e6);
    expect(await until(() => g.state === 'dead', 300)).toBe(true);
    await h.waitFrames(30);
    phase = 'reload';
    expect(await game.loadLastSave()).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const afterDeath = await sweep('after-death');
    expect(afterDeath, 'Load last save: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect(releaseField).toHaveBeenCalled();
    expect(releaseProbes, 'the previous station\'s probe textures were released (after the warm-up)').toHaveBeenCalled();
    const probes2 = activeReflectionProbes()!;
    expect(probes2).toBeTruthy();
    expect(probes2).not.toBe(probes1);
    const st2 = game.enhancedLighting.status();
    expect(st2.active).toMatchObject({gi: 'standard', reflections: 'standard', cache: 'hit', giMs: 0, probeMs: 0, probes: st1.active!.probes});
    // render objects built under station 1 that sample the probes and are still drawn: bound to the NEW textures
    const before = drawn.get('play')!;
    const reflective2 = [...drawn.get('after-death')!.values()].filter(ro => probeBindings(ro).length > 0);
    expect(reflective2.length).toBeGreaterThan(0);
    for (const ro of reflective2) for (const b of probeBindings(ro)) expect([probes2.atlas, probes2.meta, probes2.grid], `${ro.object.name}${before.has(ro.id) ? ' (outlived the swap)' : ''}`).toContain(b.texture);
    expect(stationPrint(), 'the reloaded station is the station').toBe(print1);

    // 3. Enhanced lighting Off -> Main menu -> Continue: the baseline, the plain light, no probe texture anywhere
    g.settings.enhancedLighting = 'off';
    expect(game.enhancedLighting.status().pending).toBe(true);
    const releaseProbes2 = vi.spyOn(probes2, 'dispose');
    game.setState('paused');
    await h.waitFrames(10);
    game.returnToMenu();
    await h.waitFrames(10);
    phase = 'off-load';
    expect(await game.continueCampaign(1)).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const off = await sweep('off');
    expect(off, 'Off: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, active: {gi: 'baseline', giReason: null, reflections: 'off', cache: 'none', probes: 0, probeBytes: 0}});
    expect(g.scene.children).toContain(stationFieldLight());
    expect(g.scene.children).not.toContain(stationReflectLight());
    expect(activeReflectionProbes()).toBeNull();
    expect(releaseProbes2).toHaveBeenCalled();
    expect([...drawn.get('off')!.values()].filter(ro => probeBindings(ro).length > 0).map(ro => ro.object.name), 'nothing drawn samples a probe texture under Off').toEqual([]);
    expect(stationPrint(), 'Off: the same station').toBe(print1);

    // ... and Auto again: the probes are back (from the session's cache), still nothing dropped
    g.settings.enhancedLighting = 'auto';
    expect(game.enhancedLighting.status().pending).toBe(true);
    game.setState('paused');
    await h.waitFrames(10);
    game.returnToMenu();
    await h.waitFrames(10);
    phase = 'auto-load';
    expect(await game.continueCampaign(1)).toEqual({ok: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    const again = await sweep('auto-again');
    expect(again, 'Auto again: nothing dropped at any angle').toMatchObject({dropped: 0, issues: []});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, active: {gi: 'standard', reflections: 'standard', cache: 'hit'}});
    expect(g.scene.children).toContain(stationReflectLight());
    const probes3 = activeReflectionProbes()!;
    const reflective3 = [...drawn.get('auto-again')!.values()].filter(ro => probeBindings(ro).length > 0);
    expect(reflective3.length).toBeGreaterThan(0);
    for (const ro of reflective3) for (const b of probeBindings(ro)) expect([probes3.atlas, probes3.meta, probes3.grid], ro.object.name).toContain(b.texture);
    expect(stationPrint(), 'Auto again: the same station').toBe(print1);

    // 4. browser storage holds the save and the settings — and nothing derived
    let stored = 0;
    for (const [k, v] of h.storage.map) {
      stored += v.length;
      expect(`${k} ${v}`, `storage key ${k}`).not.toMatch(/probe|atlas|derived|lightField|"gi"|indirect/i);
    }
    expect(stored).toBeGreaterThan(0);
    expect(stored, 'the whole of storage stays save-sized').toBeLessThan(4_000_000);
    expect([...h.storage.map.values()].some(v => /"enhancedLighting":"auto"/.test(v)), 'the choice is a setting').toBe(true);

    expect(frameErrors).toEqual([]);
    expect(errors).toEqual([]);
    h.stop();
  }, 900_000);
});
