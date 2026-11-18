// Task studio-surface-host-ground-connectors-20261118-053602-01 (lane READY). User: "Merely forcing a gate open on partial is NOT proof the
// seamless requirement is solved. Diagnose and address the first-visible exit/ready handoff … A successful exit needs a built, playable
// first view that can actually be drawn; any noncritical background compile must be truthful and not strand the player."
// The Surface Run cargo lift ride up from a Subway station on the REAL Game in Node (every lane, the real generated station and district)
// over three r186's WebGPURenderer on the validating no-op device (helpers/headlessGame.ts), at the DEFAULT settings — the atmosphere ON
// (the scene pass's own render target: the first view is drawn off-screen, not only compiled; tests/surface-lift-ride.test.ts covers the
// direct path) and the full warm-up coverage. Counted from three's own internals, by phase of the ride:
//  (a) the exit's first view is DRAWN off-screen (Game.prepareCrossingView; render/firstView.ts + the journey compile's view lane) before
//      the doors open, its draws spread over many sealed frames (the held rider's frames keep coming), and its planning in frame steps;
//  (b) the DOOR-OPEN frame — the first frame that draws the destination — and the frames after it while the doors open build no node, create
//      no render pipeline and use none for the first time (everything it draws was drawn before, off-screen);
//  (d) the rest of the destination's preparation goes on after the doors opened (the same job, the journey's play pacing), reported with
//      its real counts. ((c), a stalled / failed job ending bounded and truthful: tests/crossing-first-view.test.ts and
//      tests/surface-lift-ride.test.ts section 6.)
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function pickNetwork(): {seed: number; station: string} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id};
  }
  throw new Error('no network with a Surface Run subway station');
}

interface Priv { interact(): void; transitGap: boolean; liftBuilt: boolean; render(): boolean }
type Count = {builds: number; pipelines: number; firstUsed: number};

describe('crossing readiness on the real Game: the lift ride\'s first view (atmosphere on)', () => {
  it('draws the exit\'s first view off-screen before the doors open; the door-open frames create and first-use nothing; the rest goes on', async () => {
    const T0 = performance.now(), marks: string[] = [];
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(() => {});
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const pick = pickNetwork();
    const h = installHeadless();
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceLiftOf} = await import('../src/world/surface/liftRuntime');
      const game = new Game(h.canvas, false);
      // (CI runtime, as the lift ride test: the paced build's 40 ms slices instead of the product's 12 — frames still drawn between them)
      game.buildPacing = {sliceMs: 40};
      const G = game as unknown as Priv;
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {surface: {go(): boolean}}}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      // three's node builds, render pipelines created and pipelines used by a draw for the first time — per ride phase
      let phase = 'boot';
      const counts: Record<string, Count> = {};
      const c = () => (counts[phase] ??= {builds: 0, pipelines: 0, firstUsed: 0});
      const r3 = (game as unknown as {renderer: {backend: Record<string, (...a: unknown[]) => unknown>; _pipelines: {_getRenderPipeline(...a: unknown[]): object}}}).renderer;
      const be = r3.backend, used = new Set<unknown>(), firstAtOpen: string[] = [];
      const cnb = be.createNodeBuilder.bind(be); be.createNodeBuilder = (...a: unknown[]) => { c().builds++; return cnb(...a); };
      const grp = r3._pipelines._getRenderPipeline.bind(r3._pipelines); r3._pipelines._getRenderPipeline = (...a: unknown[]) => { c().pipelines++; return grp(...a); };
      const draw = be.draw.bind(be);
      be.draw = (...a: unknown[]) => {
        const ro = a[0] as {pipeline?: unknown; object?: {name?: string}; material?: {name?: string}};
        if (ro.pipeline && !used.has(ro.pipeline)) { used.add(ro.pipeline); c().firstUsed++; if (phase === 'open' || phase === 'opening') firstAtOpen.push(`${phase}: ${ro.object?.name} / ${ro.material?.name}`); }
        return draw(...a);
      };
      await game.load(() => {});
      const until = async (f: () => boolean, max = 8000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      vi.spyOn(game.player, 'takeDamage').mockImplementation(() => {}); // (the district's hunters: not applied)
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing', 20000)).toBe(true);
      expect((game as unknown as {atmosphereBypass: unknown}).atmosphereBypass, 'the atmosphere on (default settings)').toBeFalsy();
      marks.push(`playing ${((performance.now() - T0) / 1000).toFixed(0)} s`);
      const R = surfaceLiftOf(game)!;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      // every drawn frame of the ride: its phase, the job's first-view state
      const frames: {gap: boolean; built: boolean; ride: string; door: number; fv: string | null; views: number; ms: number}[] = [];
      let opened = -1;
      const render0 = G.render.bind(game);
      // (the frame's own render only: the job's steps after it — the rest, in play — and compile continuations count as 'job')
      G.render = () => {
        phase = R.sealed || G.transitGap ? 'ride' : R.phase === 'opening' ? (opened < 0 && frames.some(f => f.gap) ? 'open' : 'opening') : opened >= 0 ? 'after' : 'ride';
        const t0 = performance.now();
        try { return render0(); } finally {
          if (phase === 'open') opened = frames.length;
          const j = game.journeyCompileStats;
          frames.push({gap: G.transitGap, built: G.liftBuilt, ride: R.phase, door: R.door, fv: j?.firstView ?? null, views: j?.viewDraws ?? 0, ms: performance.now() - t0});
          phase = 'job';
        }
      };
      phase = 'job';
      const done0 = game.surfaceCrossCounts.done;
      G.interact();
      expect(await until(() => game.surfaceCrossCounts.done === done0 + 1 && R.phase === 'idle', 20000), JSON.stringify(game.surfaceCrossCounts)).toBe(true);
      const job = game.journeyCompileStats!;
      const after0 = job.sceneDone + job.shadowDone;
      await h.waitFrames(60);
      const cv = game.surfaceLiftCompile!;
      marks.push(`ride ${((performance.now() - T0) / 1000).toFixed(0)} s; crossing ${JSON.stringify({...cv, job: undefined})}; counts ${JSON.stringify(counts)}`);
      // (a) the first view: drawn off-screen (the scene pass's target), spread over the sealed frames, then the doors open
      expect(cv).toMatchObject({end: 'ready', why: '', tries: 1});
      expect(job.viewDrawn, 'drawn, not only compiled (the scene pass\'s target)').toBe(true);
      expect(job.viewDone).toBe(job.viewItems);
      expect(job.viewRepsCompiled).toBe(job.viewReps);
      expect(job.viewFrame, 'the hidden frame of the real view').toBe(true);
      expect(cv.plan.reps, 'program groups in the first view').toBeGreaterThan(50);
      const drawing = frames.filter(f => f.gap && f.built && (f.fv === 'drawing' || f.fv === 'frame'));
      expect(drawing.length, 'the first view\'s draws spread over many drawn (sealed) frames').toBeGreaterThan(50);
      expect(job.viewDraws).toBeGreaterThan(20);
      expect(cv.prep.steps, 'planned in frame steps').toBeGreaterThan(FIRST_STEPS);
      const shut = frames.findIndex(f => f.ride === 'travel');
      expect(shut, 'the doors shut and the car moved').toBeGreaterThan(0);
      for (const f of frames.slice(shut)) if (f.door > 0) expect(f.fv, 'the doors open only with the first view ready').toBe('ready');
      expect(opened, 'the door-open frame seen').toBeGreaterThan(0);
      // (b) the door-open frame and the frames while the doors open: nothing built, created or first used
      for (const p of ['open', 'opening'] as const) expect(counts[p] ?? {builds: 0, pipelines: 0, firstUsed: 0}, `${p}: ${firstAtOpen.join(', ')}`).toEqual({builds: 0, pipelines: 0, firstUsed: 0});
      expect(firstAtOpen).toEqual([]);
      // (d) the rest: reported at the exit, and going on after it (the same job, play pacing)
      expect(cv.rest, 'what was left when the doors opened').not.toBeNull();
      expect(cv.rest!.left).toBeGreaterThan(0);
      expect(cv.rest!.total).toBe(job.sceneItems + job.casters + job.twoPass);
      expect(job.sceneDone + job.shadowDone, 'the rest advances after the exit').toBeGreaterThan(after0);
      expect(errors).toEqual([]);
      expect(frameErrors).toEqual([]);
    } finally {
      await new Promise(res => setTimeout(res, 1600));
      h.stop();
      process.stdout.write(`crossing-first-view-game: ${marks.join(' | ')}\n`);
    }
  }, 900_000);
});

/** The plan's own steps at the least: the scene plan, the sweep's yaws, the order, the job. */
const FIRST_STEPS = 4;
