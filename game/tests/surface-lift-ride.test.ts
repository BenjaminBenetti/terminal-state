// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the CARGO LIFT RIDE is the crossing,
// both ways, on the REAL Game in Node (src/game.ts, every lane, the real generated station and district) over three r186's WebGPURenderer
// on the validating no-op device (helpers/headlessGame.ts).
//  1. A new campaign at a Surface Run Subway station (version 2): its access is the cargo lift; standing in the car the prompt rides up.
//  2. [E] -> the doors close with the player held in the car -> the old world is left, the district generated (at the press, measured),
//     and (task studio-surface-tent-first-staging-20261120-225458-01) its STAGED COMMAND TENT built and its first view prepared
//     (Game.prepareCrossingView — here, the atmosphere off, compiled: the direct path cannot draw off-screen) — every frame meanwhile DRAWN
//     (never a loading state, no warm-up behind a hidden canvas) — and the doors stay SHUT until that first view is ready; paused mid-ride
//     they stay shut until play resumes. The doors then open into the staged tent BEFORE the district is built: the district is built
//     behind it (frames drawn with the staged tent alone: nothing else of the scene), then its real tent's first view, then the swap.
//     Arrival: standing in the tent's car, doors open, released; the eye's gas exposure 0 in the tent with its flap shut.
//  3. The tent's doorway is a real opening: with the flap shut the player cannot walk out; opened, they walk out through it and back in
//     on the real collision (Player.update in the game loop, held W).
//  4. [E] in the tent's car rides down: back in the station's car, the station exactly as left, no district objects / resources / frame
//     hooks / lift views left over.
//  5. A ride whose destination cannot be prepared (QA failure injection) returns the player to the car they left (recovered).
//  6. (task studio-surface-run-lift-reliability-and-cab-20261118-023909-01: "the lift never opens … and so you are stuck") a ride whose
//     compile job is cancelled under it (retried once) and whose retry never progresses (QA injections) opens BOUNDED — the stall rule of
//     LIFT_RIDE_WAIT (no first-view progress), active time — on the BUILT district, never before; the rest compiles in play (a new job);
//     no loading screen.
//  Every ride: the mouse turns the held rider in the transit gap ("you cannot look left and right when in the lift"), and a SEALED frame
//  (the shut car between its stops) draws nothing of the world but the car's own view ("a black plane passes through you": the world's
//  geometry crossing the virtual shaft); the held rider's status line says what is being prepared.
//  Resource teardown, every world: exactly one live light field and one decay field on the device — the left world's released, never
//  re-created (render/bindingRefresh.ts syncNewBindings: three r186 alone re-uploaded the left station's disposed decay / light field for
//  the first draw of an object of a material built there, one more of each per crossing); and after a full GC no render object three
//  disposed and no render pipeline it released is still reachable (render/geometryDisposeRef.ts: three's per-geometry dispose listener
//  kept the first render object of every shared geometry — and its released pipeline / shader modules — alive: the ride re-keys more
//  of them than the loading screen, measured +44 pipelines / +84 shader modules).
import v8 from 'node:v8';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_LANE, SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import type {SectionKey} from '../src/levels/types';
import type {StationLayout} from '../src/gen/stationTypes';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function pickNetwork(): {seed: number; station: string; levelSeed: number} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id, levelSeed: n.levelSeed};
  }
  throw new Error('no network with a Surface Run subway station');
}

/** Numbers to 1e-6 and quaternions to one sign (q and -q are one orientation: a rebuilt item re-reads its pose), as the journey test. */
function canon(v: unknown, key = ''): unknown {
  if (typeof v === 'number') { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; }
  if (Array.isArray(v)) {
    let a = v;
    if (key === 'q' && a.length === 4 && a.every(x => typeof x === 'number')) {
      const lead = (a as number[]).find(x => Math.abs(x) > 1e-9) ?? 0;
      const w = Math.abs(a[3] as number) > 1e-9 ? a[3] as number : lead;
      if (w < 0) a = (a as number[]).map(x => -x);
    }
    return a.map(x => canon(x));
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x, k)]));
  return v;
}

interface Priv {
  interact(): void;
  saveSectionMemory(): void;
  transitGap: boolean;
  prepareSection(key: SectionKey, run: unknown): Promise<StationLayout>;
  render(): boolean;
  drawFrame(): void;
  liftBuilt: boolean;
  fx: {group: import('three').Object3D};
}

describe('Surface Run v2: the cargo lift ride (real Game, validating device)', () => {
  it('rides up and down with no loading screen; doors shut until the exit\'s first view is ready; the tent walk-through; recovery; bounded', async () => {
    const T0 = performance.now(), marks: string[] = [];
    const mark = (s: string) => marks.push(`${s} ${((performance.now() - T0) / 1000).toFixed(1)} s`);
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const pick = pickNetwork();
    const hostKey: SectionKey = {level: 'subway', section: 'main', station: pick.station};
    const surfKey: SectionKey = {level: 'subway', section: 'surface', station: pick.station};
    const h = installHeadless();
    // (CI runtime) on the validating device each flashlight-shadow variant is an off-screen draw of ~20 ms, so at the default quality one
    // ride's complete compile is ~6000 Node frames (~6 min: the ride test passed so in 544 s on 2026-11-17). The atmosphere OFF (a real
    // setting: no scene-pass target, so no shadow / two-pass lanes) and the warm-up's 'view' coverage (?warmup=view: the representatives
    // near the camera — still a real, complete job the doors wait for) keep each ride's compile short. SURFACE_LIFT_FULL=1 runs the default
    // quality with the full coverage (the product's).
    if (!process.env.SURFACE_LIFT_FULL) (globalThis as unknown as {location: {search: string}}).location.search = '?fog=off&warmup=view';
    // the device's light / decay field textures (the validating device: one per stub), to count the live (not destroyed) ones per world
    const fieldTextures: {label: string; tex: {destroyed?: boolean}}[] = [];
    {
      type Dev = {createTexture(d: {label?: string}): unknown};
      const gpu = (globalThis as unknown as {navigator: {gpu: {requestAdapter(): Promise<{requestDevice(): Promise<Dev>}>}}}).navigator.gpu;
      const dev = await (await gpu.requestAdapter()).requestDevice();
      const createTexture = dev.createTexture.bind(dev);
      dev.createTexture = (d: {label?: string}) => {
        const tex = createTexture(d) as {destroyed?: boolean};
        if (d?.label === 'decay-field' || d?.label === 'light-field') fieldTextures.push({label: d.label, tex});
        return tex;
      };
    }
    const liveFields = () => {
      const n: Record<string, number> = {'decay-field': 0, 'light-field': 0};
      for (const f of fieldTextures) if (!f.tex.destroyed) n[f.label]++;
      return n;
    };
    const oneField = {'decay-field': 1, 'light-field': 1};
    let stageEnd = () => {};
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceLiftOf} = await import('../src/world/surface/liftRuntime');
      const {surfaceAirRuntime} = await import('../src/world/surface/air');
      const game = new Game(h.canvas, false);
      stageEnd = () => { game.surfaceTentStage?.cancel('test end'); game.journeyCompileStats && (game as unknown as {journeyCompile: {cancel(): void} | null}).journeyCompile?.cancel(); };
      // (CI runtime) the ride's PACED build of the destination: Node's frame (update + submit on the validating device) costs ~45 ms
      // against the product's 6 ms build slice, so a district build took ~2600 frames (~140 s); Game.buildPacing (the build's own test /
      // QA knob) runs 40 ms slices instead. Frames are still drawn between slices; SURFACE_LIFT_FULL=1 keeps the product's pacing.
      if (!process.env.SURFACE_LIFT_FULL) game.buildPacing = {sliceMs: 40};
      const G = game as unknown as Priv;
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {surface: {go(): boolean; access(): {prompt: string | null}; state(): {scene: {district: number; objects: number}; resources: Record<string, {textures: number; owned: number}>; frameHooks: number}}}}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      const states: string[] = [];
      game.stateListeners.push(s => { states.push(s); });
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      // three's render objects and render pipelines, held weakly (see the header)
      const r3 = (game as unknown as {renderer: {_objects: {_renderObjects: Set<object>; createRenderObject(...a: unknown[]): object}; _pipelines: {caches: Map<string, object>; _getRenderPipeline(...a: unknown[]): object}}}).renderer;
      const roRefs: WeakRef<object>[] = [], pipeRefs: WeakRef<object>[] = [];
      let roClass: unknown = null;
      {
        const O = r3._objects, P = r3._pipelines;
        const createRo = O.createRenderObject.bind(O), createPipe = P._getRenderPipeline.bind(P);
        O.createRenderObject = (...a: unknown[]) => { const ro = createRo(...a); roClass ??= ro.constructor; roRefs.push(new WeakRef(ro)); return ro; };
        P._getRenderPipeline = (...a: unknown[]) => { const p = createPipe(...a); pipeRefs.push(new WeakRef(p)); return p; };
      }
      /** The fields on the device; after a full GC (v8.queryObjects collects first) the disposed render objects / released pipelines still reachable. */
      const teardown = async () => {
        await h.waitFrames(1); // (a later task than the WeakRefs' creation)
        (v8 as unknown as {queryObjects(c: unknown, o: {format: 'count'}): number}).queryObjects(roClass, {format: 'count'});
        const live = r3._objects._renderObjects, cached = new Set(r3._pipelines.caches.values());
        let disposedRo = 0, releasedPipe = 0;
        for (const w of roRefs) { const o = w.deref(); if (o && !live.has(o)) disposedRo++; }
        for (const w of pipeRefs) { const o = w.deref(); if (o && !cached.has(o)) releasedPipe++; }
        return {fields: liveFields(), disposedRo, releasedPipe};
      };
      const clean = {fields: oneField, disposedRo: 0, releasedPipe: 0};
      await game.load(() => {});
      const until = async (f: () => boolean, max = 8000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      const press = async () => { G.interact(); await h.waitFrames(1); };
      /** The ride's state (failure messages / progress marks). */
      const diag = () => {
        const j = game.journeyCompileStats as unknown as Record<string, unknown> | null;
        const q = R.qa() as unknown as Record<string, unknown>;
        return JSON.stringify({state: game.state, gap: G.transitGap, counts: game.surfaceCrossCounts, crossing: game.surfaceCrossing, ride: {phase: q.phase, door: q.door, travel: q.travel, ready: q.ready, reposed: q.reposed, holding: q.holding},
          compile: j ? {phase: j.phase, scene: `${j.sceneDone}/${j.sceneItems}`, shadow: `${j.shadowDone}/${j.casters}`, steps: j.steps, slices: j.slices} : null, errors: errors.slice(0, 2), frameErrors: frameErrors.slice(0, 2)});
      };
      /** until() with a progress mark every `every` frames (the ride's long waits). */
      const ridden = async (f: () => boolean, label: string, max = 9000, every = 1500) => {
        for (let i = 0; i < max && !f(); i++) { if (i && i % every === 0) marks.push(`${label} +${i} frames ${((performance.now() - T0) / 1000).toFixed(0)} s: ${diag()}`); await h.waitFrames(1); }
        return f();
      };
      let hits = 0;
      vi.spyOn(game.player, 'takeDamage').mockImplementation(() => { hits++; }); // (the district's hunters: counted, not applied)
      const R = surfaceLiftOf(game)!;
      expect(R, 'the lift runtime is installed').toBeTruthy();
      const liftViews = () => { let n = 0; game.scene.traverse(o => { if (o.name === 'cargo-lift-surface') n++; }); return n; };
      // every drawn frame: the ride's phase / doors, the transit gap, the compile, the state
      const samples: {gap: boolean; phase: string; door: number; compile: string | null; fv: string | null; job: object | null; state: string; built: boolean; shell: boolean}[] = [];
      // the held rider's look: a mouse turn armed after a frame's input reset (applied by the next frame's update), checked at its draw
      const look = {armed: false, yaw: 0, moved: 0, lost: 0, gap: 0};
      const status = new Set<string>();
      const render0 = G.render.bind(game);
      G.render = () => {
        if (look.armed) { look.armed = false; if (Math.abs(game.player.yaw - look.yaw) > 1e-6) look.moved++; else look.lost++; }
        const r = render0(); const j = game.journeyCompileStats;
        samples.push({gap: G.transitGap, phase: R.phase, door: R.door, compile: j?.phase ?? null, fv: j?.firstView ?? null, job: j, state: game.state, built: G.liftBuilt, shell: game.surfaceTentShellOpen});
        const line = R.statusLine(); if (line) status.add(line.replace(/\d+ %/, 'N %'));
        return r;
      };
      const endFrame0 = game.input.endFrame.bind(game.input);
      game.input.endFrame = () => {
        endFrame0();
        if (R.holding && G.transitGap && game.state === 'playing' && samples.length % 15 === 0) { game.input.dx = 40; look.yaw = game.player.yaw; look.armed = true; look.gap++; }
      };
      // sealed draws: what of the world is still on the camera's layers (renderables outside the car's view / the camera / the fx group)
      const seal = {draws: 0, builtDraws: 0, leaks: 0, worst: ''};
      const drawFrame0 = G.drawFrame.bind(game);
      // (task studio-surface-map-tent-cab-20261119-025201-01) frames sealed to the tent: what is drawn is the tent's (its scan, a small one
      // inside its box, what every frame draws) — nothing of the street; the planning map's table among it
      const tentSeal = {draws: 0, leaks: 0, worst: '', table: 0};
      // (task studio-surface-tent-first-staging-20261120-225458-01) frames drawn in the open STAGED tent: the shell, the car, the map's sheet
      // only — nothing of the district being built around it (its real tent included)
      const shellSeal = {draws: 0, buildDraws: 0, leaks: 0, worst: '', table: 0};
      const center = new (await import('three')).Vector3();
      G.drawFrame = () => {
        const SH = game.surfaceTentShell;
        if (SH && game.surfaceTentShellOpen && !R.sealed && shellSeal.draws++ % 10 === 0) {
          if (!G.liftBuilt) shellSeal.buildDraws++;
          const stack: import('three').Object3D[] = [...game.scene.children];
          while (stack.length) {
            const o = stack.pop()!;
            if (o === game.camera || o === G.fx.group || o === SH.root || o.name === 'cargo-lift-surface') continue;
            const r = o as import('three').Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
            if ((r.isMesh || r.isPoints || r.isLine || r.isSprite) && o.layers.test(game.camera.layers)) {
              if (o.name === 'surface-planning-map-table') shellSeal.table++;
              else { shellSeal.leaks++; if (!shellSeal.worst) shellSeal.worst = o.name || o.type; }
            }
            stack.push(...o.children);
          }
        }
        const TSd = game.surfaceTentStage;
        if (TSd?.sealing && TSd.box && !R.sealed && !game.surfaceTentShellOpen && tentSeal.draws++ % 10 === 0) { // (the staged tent's frames: shellSeal)
          const stack: import('three').Object3D[] = [...game.scene.children];
          while (stack.length) {
            const o = stack.pop()!;
            if (o === game.camera || o === G.fx.group) continue;
            const r = o as import('three').Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
            if ((r.isMesh || r.isPoints || r.isLine || r.isSprite) && o.layers.test(game.camera.layers) && o.frustumCulled !== false) {
              if (o.name === 'surface-planning-map-table') tentSeal.table++;
              const g = r.geometry as import('three').BufferGeometry | undefined;
              if (g && !g.boundingSphere) g.computeBoundingSphere();
              const inBox = !!g?.boundingSphere && TSd.box.containsPoint(center.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld));
              if (!inBox && !(TSd as unknown as {set: Set<unknown>}).set.has(o)) { tentSeal.leaks++; if (!tentSeal.worst) tentSeal.worst = o.name; }
            }
            stack.push(...o.children);
          }
        }
        if (R.sealed && seal.draws++ % 10 === 0) {
          const stack: import('three').Object3D[] = [...game.scene.children];
          let leaks = 0;
          while (stack.length) {
            const o = stack.pop()!;
            if (o.name === 'cargo-lift-surface' || o === game.camera || o === G.fx.group) continue;
            const r = o as import('three').Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
            if ((r.isMesh || r.isPoints || r.isLine || r.isSprite) && o.layers.test(game.camera.layers)) { leaks++; if (!seal.worst) seal.worst = o.name; }
            stack.push(...o.children);
          }
          if (G.liftBuilt) seal.builtDraws++;
          seal.leaks += leaks;
        }
        drawFrame0();
      };

      // ---- 1. the station's cargo lift -------------------------------------------------------------------------------------------
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: SURFACE_VERSION});
      const acc = game.layout.surfaceAccess!;
      expect(acc).toMatchObject({v: 2, kind: 'lift'});
      expect(R.site?.lift, 'the station end is drawn').toEqual(acc.lift);
      expect(liftViews()).toBe(1);
      // the car's PBR finish (world/surface/liftCabFinish.ts: fetched by the section preload before the build)
      const finishOf = () => { const n: string[] = []; R.site?.view.cab.traverse(o => { const m = o as import('three').Mesh; if (m.isMesh) n.push((m.material as import('three').Material).name); }); return n; };
      expect(R.site?.finished, 'the station car finished').toBe(true);
      expect(finishOf()).toEqual(expect.arrayContaining(['cargo-cab-wall@pbr', 'cargo-cab-deck@pbr', 'cargo-cab-bumper@pbr', 'cargo-cab-placard@pbr']));
      await h.waitFrames(30);
      expect(await teardown(), 'the station: one light field, one decay field; nothing released still reachable').toEqual(clean);
      G.saveSectionMemory();
      const snapHost = () => {
        G.saveSectionMemory();
        const L = game.layout, mem = canon(game.run.peekMemory(hostKey)!) as {pickups: unknown; holders: unknown; killed: unknown; cleared: unknown};
        return {mem: JSON.stringify([mem.pickups, mem.holders, mem.killed, mem.cleared]), cells: Array.from(L.grid.cells).join(''), areas: L.areas.length, access: JSON.stringify(L.surfaceAccess),
          props: L.props.filter(p => !p.cargo).map(p => `${p.kind}@${p.x.toFixed(3)},${p.z.toFixed(3)}:${p.h.toFixed(3)}`).join('|')};
      };
      const host0 = snapHost();
      const res0 = qa.surface.state().resources, hooks0 = game.frameHooks.length;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(R.inCar(), 'standing in the car').toBe(true);
      expect(qa.surface.access().prompt).toBe('<b>[E]</b> Ride up to the street');

      // ---- 2. [E]: the ride up ---------------------------------------------------------------------------------------------------
      const c0 = {...game.lifecycleCounts}, s0 = states.length, n0 = samples.length, done0 = game.surfaceCrossCounts.done;
      await press();
      // paused mid-ride (while the destination still compiles): the doors stay shut until play resumes
      let pausedAt = -1;
      expect(await until(() => G.transitGap && game.journeyCompileStats?.phase === 'scene' || game.surfaceCrossCounts.done > done0)).toBe(true);
      if (game.surfaceCrossCounts.done === done0) {
        game.setState('paused');
        pausedAt = samples.length;
        const q0 = R.qa(), steps0 = game.journeyCompileStats?.steps;
        await h.waitFrames(40);
        // (the pause menu keeps its frozen frame fresh at a low rate: those frames are the paused ride, not its progress)
        expect(R.door, 'paused: the doors shut').toBe(0);
        expect(samples.slice(pausedAt).every(s => s.state === 'paused' && s.door === 0), 'paused: only the frozen ride drawn').toBe(true);
        expect(R.qa().travel, 'paused: the car holds').toBe(q0.travel);
        expect(R.phase).toBe(q0.phase);
        expect(game.journeyCompileStats?.steps, 'paused: the compile\'s scheduled steps hold').toBe(steps0);
        game.setState('playing'); // (Resume; enterPlay's pointer-lock request never settles headless)
      }
      expect(await ridden(() => game.surfaceCrossCounts.done === done0 + 1 && R.phase === 'idle', 'ride up'), diag()).toBe(true);
      mark('[E] up');
      const ride = samples.slice(n0);
      const gapFrames = ride.filter(s => s.gap).length;
      marks.push(`ride up: ${ride.length} frames drawn, ${gapFrames} in the transit gap; generation at the press ${game.surfaceLiftGenMs.toFixed(0)} ms; paused at ${pausedAt}`);
      expect(states.slice(s0).filter(s => s !== 'paused' && s !== 'playing'), 'never a loading screen').toEqual([]);
      expect(game.lifecycleCounts.loading - c0.loading).toBe(0);
      expect(game.lifecycleCounts.warmup - c0.warmup, 'no hidden-canvas warm-up').toBe(0);
      expect(game.lifecycleCounts.leave - c0.leave).toBe(1);
      expect(game.lifecycleCounts.build - c0.build).toBe(1);
      expect(gapFrames, 'frames drawn while the old world was left and the new one built').toBeGreaterThan(10);
      marks.push(`ride up: look ${JSON.stringify(look)}; sealed ${JSON.stringify(seal)}; status ${[...status].join(' / ')}; compile ${JSON.stringify(game.surfaceLiftCompile)}`);
      expect(look.gap, 'mouse turns tried in the transit gap').toBeGreaterThan(5);
      expect(look.lost, 'every mouse turn in the transit gap turned the rider').toBe(0);
      expect(seal.draws, 'sealed draws checked').toBeGreaterThan(0);
      expect(seal.leaks, `nothing of the world drawn in a sealed car (${seal.worst})`).toBe(0);
      expect([...status].some(x => x.includes('preparing the street')), 'status: the street being prepared').toBe(true);
      expect([...status].some(x => x === 'Going up — setting up the command tent…'), 'status: the staged tent being built').toBe(true);
      expect([...status].some(x => /^Going up — the command tent — preparing the view \d+ \/ \d+$/.test(x)), 'status: its first view\'s real units done / of all').toBe(true);
      // (task studio-surface-tent-first-staging-20261120-225458-01) the doors opened into the STAGED tent before the district was built
      const SR = game.surfaceTentShellRecord!;
      marks.push(`staged tent: ${JSON.stringify(SR)}; drawn ${JSON.stringify(shellSeal)}`);
      expect(SR, 'the ride up staged its tent').toBeTruthy();
      expect(SR.stats.view, 'the staged tent\'s own first view, the first try').toMatchObject({end: 'ready', tries: 1});
      expect(SR.stats.faces > 0 && SR.stats.floors > 0 && SR.stats.kit > 0, 'built from the district\'s own tent').toBe(true);
      const opened1 = ride.slice(ride.findIndex(s => s.phase === 'travel')).find(s => s.door > 0)!; // (the first opening after the doors shut)
      expect(opened1.shell, 'the doors opened into the staged tent').toBe(true);
      expect(opened1.built, 'before the district was built').toBe(false);
      expect(opened1.gap, 'in the transit gap (the district still being built)').toBe(true);
      expect(SR.openMs, 'opened well before the district\'s build ended').toBeLessThan(SR.buildDoneMs / 2);
      expect(SR.swapMs, 'the district\'s tent took over after its build').toBeGreaterThan(SR.buildDoneMs);
      expect(SR.why).toBe('swapped');
      expect(game.surfaceTentShell, 'the staged tent is gone').toBeNull();
      expect(shellSeal.buildDraws, 'frames drawn in the staged tent while the district was built').toBeGreaterThan(5);
      expect(shellSeal.leaks, `nothing but the staged tent, the car and the map sheet drawn (${shellSeal.worst})`).toBe(0);
      expect(shellSeal.table, 'the planning map\'s sheet drawn in the staged tent').toBeGreaterThan(0);
      expect(game.surfaceLiftCompile, 'the first view ready (compiled: no off-screen scene pass with the atmosphere off), the first try').toMatchObject({end: 'ready', why: 'compiled, not drawn (no off-screen scene pass)', tries: 1});
      const shut = ride.findIndex(s => s.phase === 'travel');
      expect(shut).toBeGreaterThan(0);
      for (const s of ride.slice(shut)) if (s.door > 0) expect(s.shell || !s.gap, `doors open only into the prepared staged tent (or, swapped, the district's): ${JSON.stringify({...s, job: null})}`).toBe(true);
      expect(ride.slice(shut).some(s => s.door === 0 && s.compile === 'scene'), 'the compile ran while the doors were shut').toBe(true);
      expect(game.surfaceLiftGenMs).toBeGreaterThan(0);
      expect(game.run.current).toEqual(surfKey);
      const S = game.layout.surface!, tl = S.portal.lift!;
      expect(S.portal.kind).toBe('lift');
      const P = game.player;
      expect(P.x > tl.cab.x0 && P.x < tl.cab.x1 && P.z > tl.cab.z0 && P.z < tl.cab.z1, 'standing in the tent\'s car').toBe(true);
      expect(R.holding).toBe(false);
      expect(R.door).toBe(1);
      expect(liftViews(), 'one lift view: the tent\'s').toBe(1);
      expect(R.site?.finished, 'the tent\'s car: the origin\'s finish').toBe(true);
      expect(finishOf()).toEqual(expect.arrayContaining(['cargo-cab-wall@pbr', 'cargo-cab-deck@pbr']));
      // the tent is gas-free with its flap shut
      const air = surfaceAirRuntime()!;
      const flap = air.air!.doors.find(d => d.plan.tent)!;
      expect(flap.target, 'the flap starts shut').toBe(0);
      let maxC = 0;
      for (let i = 0; i < 30; i++) { await h.waitFrames(1); maxC = Math.max(maxC, game.gas.exposure.c); }
      expect(maxC, 'no gas at the eye in the tent (flap shut)').toBe(0);
      expect(await teardown(), 'the district: its own fields only (the station\'s released, none re-created); nothing released still reachable').toEqual(clean);

      // ---- 3. (task studio-surface-map-tent-cab-20261119-025201-01) THE COMMAND TENT is the preparation space: the car opened into it on
      // the tent's OWN first view; the street is prepared behind the HELD flap while the player walks, looks and reads the planning map (its
      // steps run with the map open; the frames draw the tent only); then the flap is released. The doorway: shut = a wall; open = out and in.
      const TS = game.surfaceTentStage!, rec = TS.record!;
      expect(rec, 'the ride up was staged in the tent').toBeTruthy();
      expect(rec.flapHeld).toBe(true);
      expect(rec.tent, 'the car opened on the tent\'s first view (compiled: the atmosphere off)').toMatchObject({end: 'ready'});
      expect(rec.scan!.inTent, 'the tent\'s renderables').toBeGreaterThan(5);
      expect(rec.scan!.inTent, 'the tent: a fraction of the district').toBeLessThan(rec.scan!.renderables / 4);
      expect(TS.phase, `the street still being prepared on arrival ${JSON.stringify(rec)}`).toBe('street');
      expect(air.tentFlapHeld, 'the flap held shut').toBe(true);
      expect(air.open(flap, 'qa'), 'the held flap does not open').toBe(false);
      expect(TS.flapLine()).toMatch(/^The tent flap stays shut — preparing the street( \d+ \/ \d+|…)$/);
      // the planning map at its table: [E] from GEN's read pose opens it; with it open the street's preparation goes on
      const {surfaceMapOf} = await import('../src/world/surface/mapRuntime');
      const MR = surfaceMapOf(game)!, rd = S.checkpoint.mapTable.read;
      Object.assign(P, {x: rd.x, z: rd.z, yaw: rd.yaw, pitch: -0.5});
      await h.waitFrames(4);
      expect(MR.prompt ?? '', 'the table\'s prompt in the tent').toMatch(/planning map/);
      // (the street's job planned — in frame steps of its own — before the map opens: its own scheduled steps then go on with it open)
      expect(await until(() => !!game.journeyCompileStats && game.journeyCompileStats.firstView !== 'ready', 600), 'the street\'s job exists').toBe(true);
      const job0 = game.journeyCompileStats!, steps0 = job0.steps, ms0 = rec.mapSteps, mf0 = rec.mapFrames;
      await press();
      expect(game.state, 'the map is open').toBe('map');
      await until(() => job0.steps > steps0 + 3 || TS.phase !== 'street', 600);
      expect(game.state).toBe('map');
      expect(game.journeyCompileStats, 'the same street job').toBe(job0);
      expect(job0.steps, `the street's preparation stepped with the map open ${JSON.stringify(job0)}`).toBeGreaterThan(steps0 + 3);
      expect(rec.mapFrames - mf0, 'frames of the open map').toBeGreaterThan(0);
      expect(rec.mapSteps - ms0, 'the stage\'s steps ran in the map\'s frames').toBeGreaterThan(3);
      MR.view!.handleKey({code: 'Escape', key: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {}});
      expect(MR.view!.isOpen, 'the map closed').toBe(false);
      await until(() => game.state !== 'map', 600);
      if (game.state === 'paused') game.setState('playing'); // (Resume; enterPlay's pointer-lock request never settles headless)
      expect(game.state, 'closed: back in play').toBe('playing');
      marks.push(`tent stage: ${JSON.stringify({...rec, scan: rec.scan})}; sealed to the tent ${JSON.stringify(tentSeal)}`);
      const t = S.checkpoint.tent, side = t.door.side, n = side === 'N' ? [0, -1] : side === 'S' ? [0, 1] : side === 'W' ? [-1, 0] : [1, 0];
      const outward = () => (side === 'N' ? t.rect.z0 - P.z : side === 'S' ? P.z - t.rect.z1 : side === 'W' ? t.rect.x0 - P.x : P.x - t.rect.x1);
      const face = (dx: number, dz: number) => { P.yaw = Math.atan2(-dx, -dz); };
      const toDoor = () => { const a = side === 'N' || side === 'S' ? [flap.plan.a - P.x, 0] : [0, flap.plan.a - P.z]; face(n[0] + a[0] * 0.8, n[1] + a[1] * 0.8); };
      const walk = async (frames: number, steer: () => void, stop: () => boolean) => {
        game.input.keys.add('KeyW');
        try { for (let i = 0; i < frames && !stop(); i++) { steer(); await h.waitFrames(1); } } finally { game.input.keys.delete('KeyW'); }
        await h.waitFrames(3);
      };
      await walk(400, toDoor, () => outward() > 0.6);
      expect(outward(), 'the shut flap stops the player').toBeLessThan(0);
      expect(await ridden(() => TS.phase === 'idle', 'the street from the tent'), diag()).toBe(true);
      expect(rec, 'the flap released on the street\'s first view').toMatchObject({phase: 'done', street: {end: 'ready'}});
      expect(rec.street!.items, 'the street\'s first view: more than the tent\'s').toBeGreaterThan(rec.tent!.items);
      expect(game.surfaceTentStreetCompile, 'the street\'s first view, from the flap').toMatchObject({end: 'ready', tries: 1});
      expect(air.tentFlapHeld, 'released').toBe(false);
      expect(flap.target, 'a flap shut before the hold stays shut').toBe(0);
      expect(tentSeal.draws, 'frames drawn sealed to the tent').toBeGreaterThan(0);
      expect(tentSeal.leaks, `nothing outside the tent drawn while the street was prepared (${tentSeal.worst})`).toBe(0);
      expect(tentSeal.table, 'the planning map\'s table drawn in the tent').toBeGreaterThan(0);
      mark('tent stage');
      expect(air.open(flap, 'qa')).toBe(true);
      await h.waitFrames(60);
      await walk(400, toDoor, () => outward() > 1.0);
      expect(outward(), 'walked out through the open flap').toBeGreaterThan(1.0);
      await walk(400, () => face(-n[0], -n[1]), () => outward() < -2.0);
      expect(outward(), 'walked back in').toBeLessThan(-2.0);
      mark('tent walk');
      expect(await teardown(), 'after the walk (new objects drawn in the district)').toEqual(clean);

      // ---- 4. the ride down --------------------------------------------------------------------------------------------------------
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(qa.surface.access().prompt).toBe(`<b>[E]</b> Ride down to ${game.run.node(pick.station)!.name}`);
      const c1 = {...game.lifecycleCounts}, n1 = samples.length, done1 = game.surfaceCrossCounts.done, staleJob = game.journeyCompileStats;
      Object.assign(seal, {draws: 0, builtDraws: 0, leaks: 0, worst: ''});
      Object.assign(look, {armed: false, moved: 0, lost: 0, gap: 0});
      await press();
      expect(await ridden(() => game.surfaceCrossCounts.done === done1 + 1 && R.phase === 'idle', 'ride down'), diag()).toBe(true);
      mark('[E] down');
      const down = samples.slice(n1), shut2 = down.findIndex(s => s.phase === 'travel');
      expect(shut2).toBeGreaterThan(0);
      for (const s of down.slice(shut2)) if (s.door > 0) { expect(s.job, 'the station\'s own compile (not the last ride\'s)').not.toBe(staleJob); expect(s.fv, 'the station\'s first view ready').toBe('ready'); }
      marks.push(`ride down: ${down.length} frames drawn, ${down.filter(s => s.gap).length} in the transit gap; generation at the press ${game.surfaceLiftGenMs.toFixed(0)} ms; look ${JSON.stringify(look)}; sealed ${JSON.stringify(seal)}`);
      expect(look.lost, 'ride down: every mouse turn turned the rider').toBe(0);
      expect(seal.builtDraws, 'ride down: sealed draws checked with the station built (its hall ceiling over the stop)').toBeGreaterThan(0);
      expect(seal.leaks, `ride down: nothing of the world drawn in a sealed car (${seal.worst})`).toBe(0);
      expect(game.lifecycleCounts.loading - c1.loading).toBe(0);
      expect(game.lifecycleCounts.warmup - c1.warmup).toBe(0);
      expect(game.run.current).toEqual(hostKey);
      const sl = game.layout.surfaceAccess!.lift!;
      expect(P.x > sl.cab.x0 && P.x < sl.cab.x1 && P.z > sl.cab.z0 && P.z < sl.cab.z1, 'standing in the station\'s car').toBe(true);
      await h.waitFrames(20);
      const host1 = snapHost();
      if (host1.mem !== host0.mem) { // (the first difference, readable)
        const a = JSON.parse(host0.mem) as unknown[][], b = JSON.parse(host1.mem) as unknown[][], names = ['pickups', 'holders', 'killed', 'cleared'];
        for (let k = 0; k < 4; k++) {
          const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
          if (x === y) continue;
          const xa = (Array.isArray(a[k]) ? a[k] : Object.entries(a[k] as object)) as unknown[], ya = (Array.isArray(b[k]) ? b[k] : Object.entries(b[k] as object)) as unknown[];
          const i = xa.findIndex((v, j) => JSON.stringify(v) !== JSON.stringify(ya[j]));
          marks.push(`station memory differs in ${names[k]} (${xa.length} vs ${ya.length}) at ${i}: ${JSON.stringify(xa[i]).slice(0, 300)} -> ${JSON.stringify(ya[i]).slice(0, 300)}`);
        }
      }
      expect(host1, 'the station exactly as left').toEqual(host0);
      const st = qa.surface.state();
      expect(st.scene.district, 'nothing of the district in the scene').toBe(0);
      expect(st.resources, 'the station\'s resources as they were').toEqual(res0);
      expect(st.frameHooks, 'no frame hook left over').toBe(hooks0);
      expect(liftViews(), 'one lift view: the station\'s').toBe(1);
      expect(await teardown(), 'back at the station: its own fields only (the district\'s released, none re-created); nothing released still reachable').toEqual(clean);
      expect(R.counts.views - R.counts.disposed, 'every other lift view disposed').toBeLessThanOrEqual(2); // (the station's + the tent's, disposed with its world)
      marks.push(`lift counts ${JSON.stringify(R.counts)}`);

      // ---- 5. a destination that cannot be prepared: back in the car the ride left ---------------------------------------------------
      const prep = vi.spyOn(G, 'prepareSection').mockRejectedValueOnce(new Error('qa: the street is unreachable'));
      const rec0 = game.surfaceCrossCounts.recovered;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      await press();
      expect(await ridden(() => game.surfaceCrossCounts.recovered === rec0 + 1 && game.state === 'playing', 'recovery'), diag()).toBe(true);
      prep.mockRestore();
      mark('recovered');
      expect(game.run.current).toEqual(hostKey);
      expect(R.phase).toBe('idle');
      expect(R.holding).toBe(false);
      expect(liftViews()).toBe(1);
      expect(await teardown(), 'after the recovery').toEqual(clean);
      marks.push(`field textures created ${fieldTextures.length}; render objects ${roRefs.length}, render pipelines ${pipeRefs.length} created`);
      const sl2 = game.layout.surfaceAccess!.lift!;
      expect(P.x > sl2.cab.x0 && P.x < sl2.cab.x1 && P.z > sl2.cab.z0 && P.z < sl2.cab.z1, 'back in the car').toBe(true);

      // ---- 6. a compile that cannot finish: bounded — (task studio-surface-tent-first-staging-20261120-225458-01) the staged tent's own
      // first view: its job cancelled under it (retried once), the retry never progresses -> the stall bound: the doors open into the
      // staged tent with that said; the district is then built behind it, its real tent's first view prepared as every ride's ------------
      {
        const {JourneyCompile} = await import('../src/render/journeyCompile');
        const {LIFT_RIDE_WAIT} = await import('../src/world/surface/liftRuntime');
        const W = LIFT_RIDE_WAIT as unknown as {stallMs: number}, stallMs0 = W.stallMs;
        const start0 = JourneyCompile.prototype.start;
        const jobs: InstanceType<typeof JourneyCompile>[] = [];
        // job 1: cancelled under the ride (a replaced job) -> retried; job 2: never progresses -> the stall bound; job 3 on: the real job
        const startSpy = vi.spyOn(JourneyCompile.prototype, 'start').mockImplementation(function (this: InstanceType<typeof JourneyCompile>) {
          jobs.push(this);
          if (jobs.length === 1) { start0.call(this); this.cancel(); return this; }
          if (jobs.length === 2) return this;
          return start0.call(this);
        });
        W.stallMs = 2500;
        try {
          const c2 = {...game.lifecycleCounts}, s2 = states.length, n2 = samples.length, done2 = game.surfaceCrossCounts.done;
          expect(qa.surface.go()).toBe(true);
          await h.waitFrames(2);
          await press();
          // (the short stall bound for the staged tent's view only: the district's real tent view after its build is bounded as every ride's)
          expect(await ridden(() => game.surfaceTentShellOpen || game.surfaceCrossCounts.done > done2, 'bounded ride: the staged tent'), diag()).toBe(true);
          W.stallMs = stallMs0;
          expect(await ridden(() => game.surfaceCrossCounts.done === done2 + 1 && R.phase === 'idle', 'bounded ride'), diag()).toBe(true);
          mark('bounded ride');
          const ride6 = samples.slice(n2), shut6 = ride6.findIndex(s => s.phase === 'travel'), open6 = ride6.findIndex((s, i) => i > shut6 && s.door > 0);
          marks.push(`bounded ride: ${ride6.length} frames, opened at ${open6}; compile ${JSON.stringify(game.surfaceLiftCompile)}; jobs ${jobs.length}`);
          expect(game.surfaceTentShellRecord!.stats.view, 'the staged tent\'s view: retried once, then the stall bound').toMatchObject({end: 'partial', why: 'stalled', tries: 2});
          expect(game.surfaceLiftCompile, 'the district\'s tent: its own first view, ready').toMatchObject({end: 'ready', tries: 1});
          expect(open6).toBeGreaterThan(shut6);
          expect(ride6[open6].shell, 'the doors opened into the staged tent (bounded)').toBe(true);
          for (const s of ride6.slice(shut6)) if (s.door > 0) expect(s.shell || !s.gap, `doors open only into the staged tent or in play: ${JSON.stringify({...s, job: null})}`).toBe(true);
          expect(states.slice(s2).filter(s => s !== 'paused' && s !== 'playing'), 'never a loading screen').toEqual([]);
          expect(game.lifecycleCounts.loading - c2.loading).toBe(0);
          expect(game.lifecycleCounts.warmup - c2.warmup).toBe(0);
          expect(game.run.current).toEqual(surfKey);
          const tl6 = game.layout.surface!.portal.lift!;
          expect(P.x > tl6.cab.x0 && P.x < tl6.cab.x1 && P.z > tl6.cab.z0 && P.z < tl6.cab.z1, 'released in the tent\'s car').toBe(true);
          expect(R.holding).toBe(false);
          // (job 3: the district's tent; then the street's job from it — planned in frame steps first — is the new job in play)
          await until(() => jobs.length >= 4, 600);
          expect(jobs.length, 'the rest: a new job in play').toBeGreaterThanOrEqual(4);
          expect(game.journeyCompileStats, 'the play-paced job').toBe(jobs[jobs.length - 1].stats);
          expect(['scene', 'shadow', 'done']).toContain(jobs[jobs.length - 1].stats.phase);
        } finally {
          startSpy.mockRestore();
          W.stallMs = stallMs0;
        }
      }
      expect(errors.filter(e => !e.includes('qa: the street is unreachable'))).toEqual([]);
      expect(frameErrors).toEqual([]);
      marks.push(`hits absorbed ${hits}`);
    } finally {
      // (the last ride up's street, still being prepared from the tent: ended with the test, before the page globals go)
      stageEnd();
      // (Input.lock's 1.5 s fallback timer of the last Resume reads `document`: let it fire while the page globals still exist)
      await new Promise(res => setTimeout(res, 1600));
      h.stop();
      process.stdout.write(`surface-lift-ride: ${marks.join(' | ')}\n`);
    }
  }, 1_500_000);
});
