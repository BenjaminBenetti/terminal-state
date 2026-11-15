// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the live glass mirror (render/glassMirror.ts) in the REAL Game
// (src/game.ts: the asset boot, the campaign lifecycle, the warm-up, the atmosphere pipeline) on three r186's real WebGPURenderer
// over the validating no-op device (helpers/headlessGame.ts, helpers/validatingWebgpu.ts).
//  1. A new campaign under the defaults (Auto, Standard reflections): the station is lit with the MIRROR variant of the reflecting
//     light, the mirror holds the station's glass planes, and the warm-up's hidden frames already drew it once (target, bindings).
//  2. Standing in front of a storefront pane with the flashlight on: the mirror draws every frame, and neither its draws nor the
//     scene pass's create anything — no node build, no shader module, no pipeline, no render object, and no render context at
//     all: the mirror view is drawn with the scene pass's own programs. (Counted per render call: what the flashlight's shadow
//     pass builds on a caster's first sight is the station's own and happens without the mirror too — printed, not judged here.)
//     The flashlight's shadow map is still drawn exactly once per frame. The mirror's texture is an
//     attachment in its own pass and a sampled texture in the scene pass, never both in one pass (checked for EVERY pass and
//     texture of the run). Nothing is dropped by the device.
//  3. The same with a target of the scene target's size (`match`) instead of the cap's: still nothing built — and the refresh
//     census / main-thread cost of both variants is printed (the numbers behind the `match` default: the cap-sized target).
//  4. Enhanced lighting Off (applied live from the pause menu): no mirror object, no mirror draw, the plain field light, and nothing
//     drawn binds the mirror's texture or its placeholder. Auto again: the mirror is back, warmed by the apply; its draws build
//     nothing.
// Printed (process.stdout): per phase the draws per frame of the mirror view / the scene pass / the shadow pass, three's refresh
// census and the main-thread milliseconds of each (Node, no-op device: three's own submit path, not a frame time).
import {afterAll, describe, expect, it, vi} from 'vitest';
import type {GlassPlane} from '../src/world/glassPanes';
import {installHeadless} from './helpers/headlessGame';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Kind = 'mirror' | 'shadow' | 'main' | 'other';
const KINDS: Kind[] = ['mirror', 'shadow', 'main', 'other'];
interface Binding { isSampledTexture?: boolean; texture?: {name?: string} | null; textureNode?: {value?: unknown} }
interface RenderObject { id: number; object: {name: string}; material?: {name?: string; type?: string}; getBindings(): {bindings: Binding[]}[] }
interface Tex { kind?: string; label?: string }
interface View { texture?: Tex }
interface PassDesc { colorAttachments?: ({view?: View; resolveTarget?: View} | null)[]; depthStencilAttachment?: {view?: View} }
interface PassEnc { setBindGroup(i: number, bg: {refs?: Tex[]; label?: string} | undefined, ...rest: unknown[]): void }
interface CmdEnc { beginRenderPass(d: PassDesc): PassEnc }
interface Target { width: number; height: number; samples: number; texture: {name?: string} }

const zero = (): Record<Kind, number> => ({mirror: 0, shadow: 0, main: 0, other: 0});
interface Made { builds: number; modules: number; pipelines: number; renderObjects: number }
const NOTHING: Made = {builds: 0, modules: 0, pipelines: 0, renderObjects: 0};

describe('The live glass mirror in the real Game (WebGPU path, validating device)', () => {
  it('draws with the scene pass\'s own programs: nothing built in play, one shadow draw per frame, no texture read while it is written; Off has none of it', async () => {
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const h = installHeadless();
    const {Game} = await import('../src/game');
    const {GM, isGlassMirrorPlaceholder} = await import('../src/render/glassMirror');
    const {stationReflectLight} = await import('../src/world/reflectionNode');
    const {LF, stationFieldLight, stationLights} = await import('../src/world/lightFieldNode');
    const {FLASH_BOUNCE} = await import('../src/world/lights');
    const game = new Game(h.canvas, false);
    /** The station field lights in the scene, by name (exactly one while a station stands). */
    const fieldLights = (): string[] => (g.scene.children.filter(c => (stationLights() as unknown[]).includes(c)) as {name: string}[]).map(l => l.name);
    const g = game as unknown as {
      player: {x: number; y: number; z: number; vx: number; vz: number; yaw: number; pitch: number; takeDamage(n: number): void}; state: string;
      scene: {children: unknown[]}; camera: object;
      layout: {grid: {circleClear(x: number, z: number, r: number): boolean; floorAt(x: number, z: number): number}};
      levels: {lineOfSight(a: {x: number; y: number; z: number}, b: {x: number; y: number; z: number}): boolean};
      settings: {enhancedLighting: string; reflections: string};
      atmosphereBypass: string | null;
    };
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    expect(game.gpu?.label).toBe('Renderer: WebGPU');

    // ---- what the run creates and draws, counted at three's and the device's own seams ----
    const R = game.renderer as unknown as {
      backend: {device: Record<string, (...a: never[]) => unknown>; draw(ro: RenderObject, info: unknown): void};
      _nodes: {_createNodeBuilder(ro: RenderObject, m: unknown): unknown; needsRefresh(ro: RenderObject): number};
      _renderContexts: {get(t: unknown, mrt?: unknown, d?: number): object};
      _objects: {createRenderObject(...a: unknown[]): unknown};
      render(scene: unknown, camera: unknown): unknown; getRenderTarget(): {texture?: {name?: string}; depthTexture?: {name?: string} | null} | null;
    };
    // (what was made, by the render call it was made in: the mirror's draw, the scene pass, the shadow pass, anything else)
    const made: Record<Kind, Made> = {mirror: {...NOTHING}, shadow: {...NOTHING}, main: {...NOTHING}, other: {...NOTHING}};
    let contexts = 0;
    const built: string[] = [];
    const calls = zero(), draws = zero(), ms = zero();
    const refresh: Record<Kind, number[]> = {mirror: [0, 0, 0], shadow: [0, 0, 0], main: [0, 0, 0], other: [0, 0, 0]};
    const gpu = {passes: 0, mirrorPasses: 0, mirrorSampled: 0, feedback: [] as string[]};
    const stack: Kind[] = [];
    const now = (): Kind => stack[stack.length - 1] ?? 'other';
    const drawnNow = new Map<number, RenderObject>();
    const reset = () => {
      for (const k of KINDS) made[k] = {...NOTHING};
      contexts = 0;
      built.length = 0;
      for (const k of KINDS) { calls[k] = draws[k] = ms[k] = 0; refresh[k] = [0, 0, 0]; }
      gpu.passes = gpu.mirrorPasses = gpu.mirrorSampled = 0;
      drawnNow.clear();
      h.log.reset();
    };

    const device = R.backend.device;
    for (const name of ['createShaderModule', 'createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync'] as const) {
      const inner = device[name].bind(device);
      device[name] = ((...a: never[]) => { if (name === 'createShaderModule') made[now()].modules++; else made[now()].pipelines++; return inner(...a); }) as never;
    }
    // every render pass of the run: a texture that is an attachment of the pass may not be in a bind group set inside it
    const createCommandEncoder = device.createCommandEncoder.bind(device) as unknown as (d?: unknown) => CmdEnc;
    device.createCommandEncoder = ((d?: unknown) => {
      const enc = createCommandEncoder(d);
      const begin = enc.beginRenderPass.bind(enc);
      enc.beginRenderPass = (pd: PassDesc) => {
        const attached = new Set<Tex>();
        for (const a of pd.colorAttachments ?? []) { if (a?.view?.texture) attached.add(a.view.texture); if (a?.resolveTarget?.texture) attached.add(a.resolveTarget.texture); }
        if (pd.depthStencilAttachment?.view?.texture) attached.add(pd.depthStencilAttachment.view.texture);
        const pass = begin(pd);
        gpu.passes++;
        let mirrorPass = false;
        for (const t of attached) if ((t.label ?? '').startsWith('glass-mirror')) mirrorPass = true;
        if (mirrorPass) gpu.mirrorPasses++;
        const set = pass.setBindGroup.bind(pass);
        pass.setBindGroup = (i, bg, ...rest) => {
          for (const r of bg?.refs ?? []) {
            if (attached.has(r) && gpu.feedback.length < 8) gpu.feedback.push(`"${r.label}" is an attachment of the pass and in bind group "${bg?.label}"`);
            if (r.label === 'glass-mirror') gpu.mirrorSampled++;
          }
          set(i, bg, ...rest);
        };
        return pass;
      };
      return enc;
    }) as never;
    const NM = R._nodes;
    const createNodeBuilder = NM._createNodeBuilder.bind(NM);
    NM._createNodeBuilder = (ro, m) => {
      made[now()].builds++;
      if (built.length < 12) built.push(`${now()}: ${ro.object?.name || '(unnamed)'} / ${ro.material?.name || ro.material?.type || '?'}`);
      return createNodeBuilder(ro, m);
    };
    const needsRefresh = NM.needsRefresh.bind(NM);
    NM.needsRefresh = ro => { const t = needsRefresh(ro); refresh[now()][t]++; return t; };
    const seenContexts = new Set<object>();
    const RC = R._renderContexts;
    const getContext = RC.get;
    RC.get = function (this: unknown, t: unknown, mrt: unknown = null, d = 0) {
      const c = getContext.call(this, t, mrt, d);
      if (!seenContexts.has(c)) { seenContexts.add(c); contexts++; }
      return c;
    };
    const createRenderObject = R._objects.createRenderObject.bind(R._objects);
    R._objects.createRenderObject = (...a) => { made[now()].renderObjects++; return createRenderObject(...a); };
    const render = R.render.bind(R);
    R.render = (scene, camera) => {
      const t = R.getRenderTarget();
      const kind: Kind = t?.texture?.name === 'glass-mirror' ? 'mirror' : t?.depthTexture?.name === 'ShadowDepthTexture' || t?.texture?.name === 'ShadowMap' ? 'shadow'
        : scene === g.scene && camera === g.camera ? 'main' : 'other';
      calls[kind]++;
      stack.push(kind);
      const t0 = performance.now();
      try { return render(scene, camera); } finally { ms[kind] += performance.now() - t0; stack.pop(); }
    };
    const draw = R.backend.draw.bind(R.backend);
    R.backend.draw = (ro, info) => { draws[now()]++; drawnNow.set(ro.id, ro); draw(ro, info); };

    await game.load(() => {});
    expect(g.settings).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const mirrorBindings = (ro: RenderObject) => ro.getBindings().flatMap(b => b.bindings).filter(b => b.isSampledTexture && (b.textureNode?.value === GM.tex.value || b.texture?.name === 'glass-mirror'));
    const perFrame = (v: number, frames: number) => +(v / Math.max(1, frames)).toFixed(2);
    const report = (name: string) => {
      const f = calls.main;
      return {
        name, frames: f, made: {mirror: {...made.mirror}, main: {...made.main}, shadow: {...made.shadow}, other: {...made.other}}, contexts, built: [...built],
        renders: {...calls}, drawsPerFrame: {mirror: perFrame(draws.mirror, f), shadow: perFrame(draws.shadow, f), main: perFrame(draws.main, f)},
        msPerFrame: {mirror: perFrame(ms.mirror, f), mainIncludingShadow: perFrame(ms.main, f), shadow: perFrame(ms.shadow, f)},
        refreshPerFrame: {mirror: refresh.mirror.map(v => perFrame(v, f)), main: refresh.main.map(v => perFrame(v, f))},
        gpu: {passes: gpu.passes, mirrorPasses: gpu.mirrorPasses, mirrorSampled: gpu.mirrorSampled, feedback: [...gpu.feedback]},
        device: {submits: h.log.submits, dropped: h.log.dropped, issues: h.log.issues.slice(0, 5).map(i => i.detail)},
      };
    };
    const say = (o: unknown) => process.stdout.write(`glass-mirror-game: ${JSON.stringify(o)}\n`);

    // ---- 1. a new campaign under the defaults: the start station (the Subway: storefront glazing, the booth) ----
    expect(await game.newCampaign(1, {overwrite: true, networkSeed: 20261115})).toMatchObject({ok: true, saved: true});
    expect(await until(() => g.state === 'playing')).toBe(true);
    expect(g.atmosphereBypass).toBeNull();
    g.player.takeDamage = () => {}; // (nothing ends the run while the views are measured)
    game.flashlightOn = true;
    const gm = game.glassMirror!;
    expect(gm, 'the station is lit with the mirror').toBeTruthy();
    // (stationReflectLight(full, mirror): the Subway is shaded in full under the defaults — the full reflecting light with the
    // mirror, alone in the scene; with it the field's cube and the flashlight's bounce)
    expect(game.enhancedLighting.status().active).toMatchObject({shading: 'full', mirror: true, reflections: 'standard'});
    expect(fieldLights()).toEqual([stationReflectLight(true, true).name]);
    expect([LF.cube.value.y, FLASH_BOUNCE.debug().bound]).toEqual([1, true]);
    const planes = (gm as unknown as {planes: GlassPlane[]}).planes;
    expect(planes.length, 'the station has glass planes').toBeGreaterThan(0);
    const warm = gm.debug() as {renders: number; targets: number; target: {size: number[]; samples: number; matched: boolean} | null; failed: string | null};
    expect(warm.failed).toBeNull();
    expect(warm.renders, 'the warm-up\'s hidden frames drew the mirror').toBeGreaterThanOrEqual(1);
    expect(warm.targets).toBe(1);
    expect(isGlassMirrorPlaceholder(GM.tex.value), 'the picture is bound after the first draw').toBe(false);
    const sceneTarget = game.atmosphere.sceneTarget(game.scene, game.camera) as unknown as Target;
    expect(sceneTarget).toBeTruthy();
    expect(warm.target, 'the scene pass\'s sample count at the cap\'s size').toMatchObject({size: [...gm.cap], samples: sceneTarget.samples, matched: false});

    // a place to stand: 2.2 m in front of an intact pane that spans the eye height, on clear floor of the main level, seeing it
    interface Pose { x: number; y: number; z: number; yaw: number; tx: number; tz: number; plane: GlassPlane; source: string }
    let pose: Pose | null = null;
    const grid = g.layout.grid;
    find: for (const want of ['storefront', 'decor', 'booth']) for (const plane of planes) {
      if (plane.slot !== 0) continue;
      for (const pane of plane.panes) {
        if (pane.source !== want || !pane.intact() || pane.u1 - pane.u0 < 1) continue;
        const um = (pane.u0 + pane.u1) / 2;
        for (const side of [1, -1]) {
          const c = plane.coord + side * (plane.half + 2.2), fc = plane.coord + side * (plane.half + 0.08);
          const x = plane.axis === 'x' ? c : um, z = plane.axis === 'x' ? um : c, px = plane.axis === 'x' ? fc : um, pz = plane.axis === 'x' ? um : fc;
          if (!grid.circleClear(x, z, 0.45)) continue;
          const floor = grid.floorAt(x, z);
          if (!(pane.y0 - floor < 1.3 && pane.y1 - floor > 1.75)) continue;
          if (!g.levels.lineOfSight({x, y: floor + 1.6, z}, {x: px, y: floor + 1.6, z: pz})) continue;
          pose = {x, y: floor, z, yaw: Math.atan2(-(px - x), -(pz - z)), tx: plane.axis === 'x' ? 0 : 1, tz: plane.axis === 'x' ? 1 : 0, plane, source: want};
          break find;
        }
      }
    }
    expect(pose, 'a pane to stand in front of').toBeTruthy();
    const at = pose!;
    const stand = (yawOff = 0, sidestep = 0) => {
      g.player.x = at.x + at.tx * sidestep; g.player.z = at.z + at.tz * sidestep; g.player.y = at.y;
      g.player.vx = 0; g.player.vz = 0; g.player.yaw = at.yaw + yawOff; g.player.pitch = 0;
    };
    /** `frames` frames in front of the pane: the view swings +-0.3 rad and the eye steps +-0.5 m along the glass. */
    const look = async (frames: number) => {
      for (let i = 0; i < frames; i++) { stand(0.3 * Math.sin(i * 0.37), 0.5 * Math.sin(i * 0.11)); await h.waitFrames(1); }
      stand();
    };

    // the same place WITHOUT the mirror first (no planes): a full turn, then the measured walk — what the place itself still builds
    gm.setPlanes([]);
    stand(Math.PI);
    await h.waitFrames(10);
    for (let i = 0; i < 24; i++) { stand((i / 24) * Math.PI * 2); await h.waitFrames(2); }
    reset();
    await look(60);
    const base = report('no mirror (same place, same walk)');
    say(base);
    expect(base.renders.mirror).toBe(0);
    expect(base.frames).toBeGreaterThanOrEqual(55);
    expect(base.renders.shadow, 'the flashlight is on: its shadow map is drawn once per frame').toBe(base.frames);

    // ---- 2. the mirror on, the same walk ----
    gm.setPlanes(planes);
    stand();
    expect(await until(() => { const d = gm.debug() as {active: boolean; strength: number}; return d.active && d.strength === 1; }, 120), JSON.stringify(gm.debug())).toBe(true);
    expect(gm.plane).toBe(at.plane);
    await h.waitFrames(4);
    reset();
    await look(60);
    const on = report('mirror (cap-sized target: the default)');
    say({...on, pose: {plane: at.plane.id, source: at.source, panes: at.plane.panes.length}, mirror: gm.debug()});
    expect(on.frames).toBeGreaterThanOrEqual(55);
    // (the flashlight is on in a station shaded in full: its bounce is live through the whole walk — what follows holds with it)
    expect(FLASH_BOUNCE.debug()).toMatchObject({bound: true, lit: true});
    expect(FLASH_BOUNCE.debug().hits, 'the beam lands on the architecture').toBeGreaterThan(0);
    expect(on.renders.mirror, 'the mirror is drawn every frame of the walk').toBe(on.frames);
    expect({mirror: on.made.mirror, scenePass: on.made.main, contexts: on.contexts}, `nothing is built by the mirror's draws or the scene pass's (${on.built.join('; ')})`).toEqual({mirror: NOTHING, scenePass: NOTHING, contexts: 0});
    expect(on.renders.shadow, 'still ONE shadow draw per frame').toBe(on.frames);
    expect(on.gpu.feedback, 'no texture is read in a pass that writes it').toEqual([]);
    expect(on.gpu.mirrorPasses, 'one pass writes the mirror per frame').toBe(on.frames);
    expect(on.gpu.mirrorSampled, 'the scene pass reads the mirror').toBeGreaterThan(0);
    expect(on.device, 'nothing dropped').toMatchObject({dropped: 0, issues: []});
    expect(on.drawsPerFrame.mirror).toBeGreaterThan(0);
    const glassDrawn = [...drawnNow.values()].filter(ro => mirrorBindings(ro).length > 0);
    expect(glassDrawn.length, 'glass render objects hold the mirror binding').toBeGreaterThan(0);
    for (const ro of glassDrawn) for (const b of mirrorBindings(ro)) expect(b.texture?.name, ro.object.name).toBe('glass-mirror');
    const d2 = gm.debug() as {skipped: number; drawn: number; targets: number};
    expect(d2.skipped, 'glass is left out of its own mirror').toBeGreaterThan(0);
    expect(d2.targets, 'one target for the whole walk').toBe(1);
    // the flashlight's shadow settings are back as the frame left them
    const shadowLights: {shadow: {autoUpdate: boolean}; castShadow: boolean; intensity: number; visible: boolean}[] = [];
    (game.scene as unknown as {traverse(f: (o: unknown) => void): void}).traverse(o => { const l = o as {isLight?: boolean; shadow?: {autoUpdate: boolean}}; if (l.isLight && l.shadow) shadowLights.push(l as never); });
    expect(shadowLights.some(l => l.castShadow && l.shadow.autoUpdate), 'a shadow light is still updating').toBe(true);

    // ---- 3. a target of the scene target's size instead (`match`): nothing built either; the census of both ----
    (gm as unknown as {match: boolean}).match = true;
    await h.waitFrames(6);
    reset();
    await look(60);
    const matched = report('mirror (target of the scene target\'s size)');
    say({...matched, mirror: gm.debug()});
    expect((gm.debug() as {target: {size: number[]; matched: boolean}}).target).toMatchObject({size: [sceneTarget.width, sceneTarget.height], matched: true});
    expect(matched.renders.mirror).toBe(matched.frames);
    expect({mirror: matched.made.mirror, scenePass: matched.made.main, contexts: matched.contexts}, `a target of another size builds nothing (${matched.built.join('; ')})`).toEqual({mirror: NOTHING, scenePass: NOTHING, contexts: 0});
    expect(matched.gpu.feedback).toEqual([]);
    expect(matched.device).toMatchObject({dropped: 0, issues: []});
    (gm as unknown as {match: boolean}).match = false;
    await h.waitFrames(6);
    reset();
    await look(20);
    const back = report('mirror (cap-sized again)');
    expect({mirror: back.made.mirror, scenePass: back.made.main, contexts: back.contexts}, back.built.join('; ')).toEqual({mirror: NOTHING, scenePass: NOTHING, contexts: 0});
    expect(back.device).toMatchObject({dropped: 0, issues: []});

    // ---- 4. Enhanced lighting Off, applied live from the pause menu: none of it exists ----
    const apply = async (patch: Partial<{enhancedLighting: string; reflections: string}>) => {
      game.setState('paused');
      await h.waitFrames(6);
      Object.assign(g.settings, patch);
      let done = false;
      const p = game.relightAfterSettings().then(() => { done = true; });
      while (!done) await h.waitFrames(1);
      await p;
      game.setState('playing');
      await h.waitFrames(6);
    };
    await apply({enhancedLighting: 'off'});
    expect(game.enhancedLighting.status()).toMatchObject({pending: false, active: {gi: 'baseline', reflections: 'off'}});
    expect(game.glassMirror, 'Off: no mirror object').toBeNull();
    expect((gm.debug() as {disposed: boolean}).disposed).toBe(true);
    expect(isGlassMirrorPlaceholder(GM.tex.value), 'Off: the target is released, the node holds its 1 x 1 placeholder').toBe(true);
    expect(GM.plane.value.w).toBe(0);
    expect(fieldLights(), 'Off: the plain field light alone').toEqual([stationFieldLight().name]);
    expect([LF.cube.value.toArray(), FLASH_BOUNCE.debug().bound], 'Off: no cube, no bounce').toEqual([[0, 0], false]);
    game.flashlightOn = true;
    stand();
    await h.waitFrames(10);
    reset();
    await look(40);
    const off = report('Enhanced lighting Off');
    say(off);
    expect(off.renders.mirror, 'Off: no mirror draw').toBe(0);
    expect(off.gpu.mirrorPasses).toBe(0);
    expect(off.gpu.mirrorSampled).toBe(0);
    expect([...drawnNow.values()].filter(ro => mirrorBindings(ro).length > 0).map(ro => ro.object.name), 'Off: nothing drawn binds the mirror texture or its placeholder').toEqual([]);
    expect(off.renders.shadow).toBe(off.frames);
    expect(off.gpu.feedback).toEqual([]);
    expect(off.device).toMatchObject({dropped: 0, issues: []});

    // ... and Auto again: the mirror is back, warmed by the apply (its hidden frames), and play builds nothing
    await apply({enhancedLighting: 'auto'});
    const gm2 = game.glassMirror!;
    expect(gm2, 'Auto again: the mirror is back').toBeTruthy();
    expect(gm2).not.toBe(gm);
    expect(fieldLights()).toEqual([stationReflectLight(true, true).name]);
    expect([LF.cube.value.y, FLASH_BOUNCE.debug().bound]).toEqual([1, true]);
    expect((gm2.debug() as {renders: number}).renders, 'the apply\'s warm-up drew it').toBeGreaterThanOrEqual(1);
    game.flashlightOn = true;
    stand();
    expect(await until(() => { const d = gm2.debug() as {active: boolean; strength: number}; return d.active && d.strength === 1; }, 120), JSON.stringify(gm2.debug())).toBe(true);
    await h.waitFrames(4);
    reset();
    await look(40);
    const again = report('Auto again');
    say(again);
    expect(again.renders.mirror).toBe(again.frames);
    // (what a live apply leaves for play to build outside the mirror — first shows of things its warm-up did not draw — is not
    // this lane's: the mirror's own draws build nothing, and no render context is added)
    expect({mirror: again.made.mirror, contexts: again.contexts}, `Auto again: the mirror's draws build nothing (${again.built.join('; ')})`).toEqual({mirror: NOTHING, contexts: 0});
    expect(again.renders.shadow).toBe(again.frames);
    expect(again.gpu.feedback).toEqual([]);
    expect(again.device).toMatchObject({dropped: 0, issues: []});

    expect(frameErrors).toEqual([]);
    expect(errors).toEqual([]);
    h.stop();
  }, 900_000);
});
