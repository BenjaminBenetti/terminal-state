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
//     INSTANCED POOLS (task studio-baked-gi-visual-uplift-20261115-004324-01): the mirror draws a pool only when one of its
//     instances is inside the mirror's frustum. Seen at the mirror's own render-object function (what three handed it, what it
//     passed on) and judged by the test's own frustum (helpers/mirrorFrustum.ts): every pool it drew has an instance inside, every
//     pool it left out has none, and its counter says how many. Pools go from left out to drawn during the walks — and still
//     nothing is built: 2b the same walk with every draw primed (no pool left out: the draw as it was) next to the walk as it is
//     (the numbers of the pool test), 2c a wide turn and a walk along the glass.
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
import type {WindowCamera} from './helpers/mirrorFrustum';

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
/** three's render-object function (Renderer.renderObject and what setRenderObjectFunction takes). */
type ObjectFn = (object: unknown, scene: unknown, camera: unknown, geometry: unknown, material: unknown, group: unknown, lightsNode: unknown, clippingContext: unknown, passId: unknown) => unknown;
interface PoolMesh { isInstancedMesh?: boolean; count: number; name: string; frustumCulled: boolean }
interface PoolMaterial { name?: string; type?: string; positionNode?: unknown; vertexNode?: unknown }

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
    const {reflectTagOf} = await import('../src/render/reflectTag');
    const {poolReach} = await import('./helpers/mirrorFrustum');
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
      renderObject: ObjectFn; getRenderObjectFunction(): ObjectFn | null; setRenderObjectFunction(f: ObjectFn | null): void;
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
    // the mirror's instanced pools, per mirror draw: the pool groups three handed to the mirror's render-object function, the ones
    // it passed on, the pools it left out (range over the draws, and the mirror's own counter's largest), the pools judged by the
    // test's frustum, pools drawn again after being left out the draw before, pools the mirror drew for the first time ever, and
    // the time inside the mirror's function / inside three's renderObject under it
    const pools = {draws: 0, handed: 0, passed: 0, leftOut: 0, leftOutMin: Infinity, leftOutMax: 0, counterMax: 0, checked: 0, returned: 0, first: 0, filterMs: 0, objectMs: 0, wrong: [] as string[]};
    /** 'pools': an ordinary draw is judged pool by pool; 'all': every draw is primed, no pool may be left out; 'off': not judged (the warm-up's own draws). */
    let judge: 'off' | 'pools' | 'all' = 'off';
    const poolWas = new Map<object, boolean>(); // a pool's answer in the mirror draw before
    const poolEver = new Set<object>(); // pools the mirror has drawn at least once (the warm-up's draws included)
    const reset = () => {
      for (const k of KINDS) made[k] = {...NOTHING};
      contexts = 0;
      built.length = 0;
      for (const k of KINDS) { calls[k] = draws[k] = ms[k] = 0; refresh[k] = [0, 0, 0]; }
      gpu.passes = gpu.mirrorPasses = gpu.mirrorSampled = 0;
      drawnNow.clear();
      Object.assign(pools, {draws: 0, handed: 0, passed: 0, leftOut: 0, leftOutMin: Infinity, leftOutMax: 0, counterMax: 0, checked: 0, returned: 0, first: 0, filterMs: 0, objectMs: 0});
      pools.wrong.length = 0;
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
    // the mirror's own render-object function, seen from outside: a timed stand-in around it for the length of the mirror's draw
    // (what three hands it), three's renderObject under it (what it passes on)
    const handed: unknown[] = [], passedOn: unknown[] = []; // (object, material) pairs of the mirror draw in progress, in order
    const standIns = new Map<ObjectFn, ObjectFn>();
    const standIn = (fn: ObjectFn): ObjectFn => {
      let w = standIns.get(fn);
      if (!w) {
        w = (o, s, c, geo, m, gr, l, cc, p) => { handed.push(o, m); const t0 = performance.now(); fn(o, s, c, geo, m, gr, l, cc, p); pools.filterMs += performance.now() - t0; };
        standIns.set(fn, w);
      }
      return w;
    };
    const renderObject = R.renderObject.bind(R);
    R.renderObject = (o, s, c, geo, m, gr, l, cc, p) => {
      if (now() !== 'mirror') return renderObject(o, s, c, geo, m, gr, l, cc, p);
      passedOn.push(o, m);
      const t0 = performance.now();
      try { return renderObject(o, s, c, geo, m, gr, l, cc, p); } finally { pools.objectMs += performance.now() - t0; }
    };
    const EPS = 1e-3; // (m: the mirror's test runs on the instance matrices' 32-bit floats)
    const reaches = new Map<object, {tight: number; loose: number; there: number}>();
    const outNow = new Set<object>(), seenNow = new Set<object>();
    const note = (s: string) => { if (pools.wrong.length < 12) pools.wrong.push(s); };
    /** After a mirror draw: its instanced pools against the test's own frustum of the camera it drew with. */
    const mirrorDrawn = (cam: WindowCamera) => {
      pools.draws++;
      reaches.clear(); outNow.clear(); seenNow.clear();
      let j = 0;
      for (let i = 0; i < handed.length; i += 2) {
        const o = handed[i] as PoolMesh, mat = handed[i + 1] as PoolMaterial;
        const passed = passedOn[j] === o && passedOn[j + 1] === mat;
        if (passed) j += 2;
        // (glass and empty pools are left out for their own reasons)
        if (o.isInstancedMesh !== true || !(o.count > 0) || reflectTagOf(mat as never) === 'glass') continue;
        pools.handed++;
        seenNow.add(o);
        if (passed) pools.passed++; else outNow.add(o);
        if (judge === 'off') continue;
        const label = `${o.name || '(unnamed pool)'} / ${mat.name || mat.type || '?'} (${o.count} instances)`;
        if (judge === 'all') { if (!passed) note(`left out of a primed draw: ${label}`); continue; }
        // never part of the test: a pool that asks not to be culled, a material that places its vertices in the shader
        const exempt = o.frustumCulled === false || mat.positionNode != null || mat.vertexNode != null;
        let reach = reaches.get(o);
        if (!reach) { reach = poolReach(cam, o as never); reaches.set(o, reach); }
        if (!passed) {
          if (exempt) note(`left out, though it is never to be: ${label}`);
          else if (reach.tight > EPS) note(`left out with an instance ${reach.tight.toFixed(3)} m inside the mirror's frustum: ${label}`);
        } else if (!exempt) {
          pools.checked++;
          if (!(reach.loose >= -EPS)) note(`drawn with no instance in the mirror's frustum (the nearest misses it by ${(-reach.loose).toFixed(3)} m): ${label}`);
        }
      }
      if (j !== passedOn.length) note(`${(passedOn.length - j) / 2} objects were passed on that the mirror's function was never handed`);
      for (const o of seenNow) {
        const inNow = !outNow.has(o);
        if (inNow) {
          if (poolWas.get(o) === false) pools.returned++;
          if (!poolEver.has(o)) { poolEver.add(o); pools.first++; }
        }
        poolWas.set(o, inNow);
      }
      const n = outNow.size, counted = game.glassMirror?.stats.pools ?? -1;
      pools.leftOut += n;
      pools.leftOutMin = Math.min(pools.leftOutMin, n);
      pools.leftOutMax = Math.max(pools.leftOutMax, n);
      pools.counterMax = Math.max(pools.counterMax, counted);
      if (counted !== n) note(`the mirror counts ${counted} pools left out of the draw, the test ${n}`);
    };
    const render = R.render.bind(R);
    R.render = (scene, camera) => {
      const t = R.getRenderTarget();
      const kind: Kind = t?.texture?.name === 'glass-mirror' ? 'mirror' : t?.depthTexture?.name === 'ShadowDepthTexture' || t?.texture?.name === 'ShadowMap' ? 'shadow'
        : scene === g.scene && camera === g.camera ? 'main' : 'other';
      calls[kind]++;
      stack.push(kind);
      const fn = kind === 'mirror' ? R.getRenderObjectFunction() : null;
      if (fn) { handed.length = 0; passedOn.length = 0; R.setRenderObjectFunction(standIn(fn)); }
      const t0 = performance.now();
      try { return render(scene, camera); } finally {
        ms[kind] += performance.now() - t0;
        stack.pop();
        if (fn) {
          R.setRenderObjectFunction(fn);
          try { mirrorDrawn(camera as WindowCamera); } catch (err) { note(`the pool check threw: ${String((err as Error)?.stack ?? err).slice(0, 300)}`); }
        }
      }
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
        // (per mirror draw; ownMs: inside the mirror's render-object function less three's renderObject under it — the tag check,
        // the pool test, and this test's two clock reads per object)
        pools: {
          mirrorDraws: pools.draws, handedPerDraw: perFrame(pools.handed, pools.draws), drawnPerDraw: perFrame(pools.passed, pools.draws),
          leftOutPerDraw: perFrame(pools.leftOut, pools.draws), leftOut: pools.draws ? [pools.leftOutMin, pools.leftOutMax] : [0, 0], counterMax: pools.counterMax,
          checked: pools.checked, returned: pools.returned, firstDrawn: pools.first,
          ownMsPerDraw: +((pools.filterMs - pools.objectMs) / Math.max(1, pools.draws)).toFixed(4), wrong: [...pools.wrong],
        },
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
    /**
     * `frames` frames in front of the pane: the view swings +-0.3 rad and the eye steps +-0.5 m along the glass. `primed`: every
     * frame's mirror draw is primed (GlassMirror.prime(): no pool is left out of it — the draw as it was before the pool test).
     */
    const look = async (frames: number, primed = false) => {
      for (let i = 0; i < frames; i++) {
        stand(0.3 * Math.sin(i * 0.37), 0.5 * Math.sin(i * 0.11));
        if (primed) game.glassMirror?.prime();
        await h.waitFrames(1);
      }
      stand();
    };
    // how far the eye may step along the glass each way (clear floor at the same height, up to 3 m), for the wide walk
    let along = 0;
    for (let s = 0.25; s <= 3; s += 0.25) {
      if (![-s, s].every(t => grid.circleClear(at.x + at.tx * t, at.z + at.tz * t, 0.45) && Math.abs(grid.floorAt(at.x + at.tx * t, at.z + at.tz * t) - at.y) < 0.05)) break;
      along = s;
    }
    /** `frames` frames of a wide turn (+-1.1 rad) while the eye walks `along` metres each way along the glass. */
    const wander = async (frames: number) => {
      for (let i = 0; i < frames; i++) { stand(1.1 * Math.sin(i * 0.19), along * Math.sin(i * 0.07)); await h.waitFrames(1); }
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
    judge = 'pools'; // (from here on every mirror draw is an ordinary one, unless a phase primes it)
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
    // the instanced pools of that walk: some are left out of every draw (the mirror's own counter says so too), some come back
    // after being left out — into a draw that built nothing — and each answer is the test's own frustum's
    expect(on.pools.wrong, 'every pool the mirror drew has an instance in its frustum, every pool it left out has none').toEqual([]);
    expect(on.pools.mirrorDraws).toBe(on.frames);
    expect(on.pools.checked, 'pools were judged').toBeGreaterThan(0);
    expect(on.pools.leftOut[0], 'pools are left out of every draw in front of the storefront').toBeGreaterThan(0);
    expect(on.pools.counterMax, 'stats.pools counts them').toBe(on.pools.leftOut[1]);
    expect(on.pools.returned, 'pools left out of one draw are drawn in the next during the walk').toBeGreaterThan(0);

    // ---- 2b. the pool test's worth: the same walk with every draw primed (no pool left out: the draw as it was before the test),
    // then as it is; twice ----
    const rounds: {allDrawn: ReturnType<typeof report>; leftOut: ReturnType<typeof report>}[] = [];
    for (let round = 1; round <= 2; round++) {
      judge = 'all';
      reset();
      await look(60, true);
      const allDrawn = report(`every pool drawn (each draw primed), round ${round}`);
      judge = 'pools';
      reset();
      await look(60);
      const leftOut = report(`pools left out, round ${round}`);
      rounds.push({allDrawn, leftOut});
      for (const r of [allDrawn, leftOut]) {
        expect(r.renders.mirror, r.name).toBe(r.frames);
        expect({mirror: r.made.mirror, scenePass: r.made.main, contexts: r.contexts}, `${r.name}: nothing is built (${r.built.join('; ')})`).toEqual({mirror: NOTHING, scenePass: NOTHING, contexts: 0});
        expect(r.pools.wrong, r.name).toEqual([]);
        expect(r.gpu.feedback, r.name).toEqual([]);
        expect(r.device, r.name).toMatchObject({dropped: 0, issues: []});
      }
      expect([allDrawn.pools.leftOut, allDrawn.pools.counterMax], 'a primed draw leaves no pool out').toEqual([[0, 0], 0]);
      expect(allDrawn.pools.drawnPerDraw).toBe(allDrawn.pools.handedPerDraw);
      expect(leftOut.pools.leftOut[0]).toBeGreaterThan(0);
      expect(leftOut.pools.returned).toBeGreaterThan(0);
      expect(leftOut.drawsPerFrame.mirror, 'fewer draws in the mirror').toBeLessThan(allDrawn.drawsPerFrame.mirror);
    }
    const brief = (r: ReturnType<typeof report>) => ({
      mirrorDrawsPerFrame: r.drawsPerFrame.mirror, mirrorMsPerFrame: r.msPerFrame.mirror, poolGroupsHanded: r.pools.handedPerDraw, poolGroupsDrawn: r.pools.drawnPerDraw,
      poolsLeftOut: r.pools.leftOutPerDraw, poolsLeftOutRange: r.pools.leftOut, returned: r.pools.returned, firstDrawn: r.pools.firstDrawn, functionOwnMs: r.pools.ownMsPerDraw,
      mirrorRefresh: r.refreshPerFrame.mirror, scenePassDrawsPerFrame: r.drawsPerFrame.main, scenePassMsPerFrame: r.msPerFrame.mainIncludingShadow,
    });
    say({name: 'the pool test over the same 60-frame walk (Node, no-op device: three\'s submit path on the main thread, not a frame time)', rounds: rounds.map(r => ({everyPoolDrawn: brief(r.allDrawn), poolsLeftOut: brief(r.leftOut)}))});

    // ---- 2c. a wide turn and a walk along the glass: the mirror's frustum sweeps the station, pools come and go, the plane in
    // view may change — and still nothing is built. (As in 2: the place itself first, without the mirror, turning right round at
    // five points of the walk — what the scene pass still builds on a first sight is the station's own.) ----
    gm.setPlanes([]);
    for (const s of [-1, -0.5, 0, 0.5, 1]) for (let i = 0; i < 24; i++) { stand((i / 24) * Math.PI * 2, s * along); await h.waitFrames(2); }
    await wander(90);
    gm.setPlanes(planes);
    stand();
    expect(await until(() => { const d = gm.debug() as {active: boolean; strength: number}; return d.active && d.strength === 1; }, 120), JSON.stringify(gm.debug())).toBe(true);
    await h.waitFrames(4);
    reset();
    await wander(90);
    const wide = report('mirror, a wide turn and a walk along the glass');
    say({...wide, along, mirror: gm.debug()});
    expect(wide.frames).toBeGreaterThanOrEqual(85);
    expect(wide.renders.mirror, 'the mirror draws through most of it').toBeGreaterThan(wide.frames / 2);
    expect({mirror: wide.made.mirror, scenePass: wide.made.main, contexts: wide.contexts}, `nothing is built while pools come and go (${wide.built.join('; ')})`).toEqual({mirror: NOTHING, scenePass: NOTHING, contexts: 0});
    expect(wide.pools.wrong).toEqual([]);
    expect(wide.pools.returned, 'pools left out of one draw are drawn in the next').toBeGreaterThan(0);
    expect(wide.pools.leftOut[1]).toBeGreaterThan(wide.pools.leftOut[0]); // (the set changes over the walk)
    expect(wide.gpu.feedback).toEqual([]);
    expect(wide.device).toMatchObject({dropped: 0, issues: []});
    stand();
    expect(await until(() => { const d = gm.debug() as {active: boolean; strength: number}; return d.active && d.strength === 1 && gm.plane === at.plane; }, 240), JSON.stringify(gm.debug())).toBe(true);

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
    expect(matched.pools.wrong).toEqual([]);
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
      judge = 'off'; // (the apply's warm-up primes its mirror draws)
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
    judge = 'pools';
    reset();
    await look(40);
    const again = report('Auto again');
    say(again);
    expect(again.renders.mirror).toBe(again.frames);
    expect(again.pools.wrong, 'the new mirror\'s pools, by the test\'s own frustum').toEqual([]);
    expect(again.pools.leftOut[0]).toBeGreaterThan(0);
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
