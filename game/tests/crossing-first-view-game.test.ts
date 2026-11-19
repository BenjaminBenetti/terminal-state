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
//      its real counts.
// (task studio-surface-map-tent-cab-20261119-025201-01) The ride up is STAGED in the command tent (world/surface/tentStage.ts): (a) / (b)
// are the TENT's first view and the doors opening into it; (e) the street's first view is drawn off-screen from the flap while the frames
// draw the tent only (nothing built / created / first used in them), then the flap is released (nothing in the release frames either);
// (d) the rest after the release. ((c), a stalled / failed job ending bounded and truthful: tests/crossing-first-view.test.ts and
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
      // (each whole frame's CPU time — its render AND the steps after it — by the ride phase its render set: reported, the hitch the
      // player would feel on the CPU side; the validating device has no GPU cost)
      const cpu: Record<string, {n: number; max: number; over50: number; ms: number[]}> = {};
      let framePhase = 'boot';
      const loop = (t: number) => {
        const t0 = performance.now();
        try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); }
        const ms = performance.now() - t0, k = (cpu[framePhase] ??= {n: 0, max: 0, over50: 0, ms: []});
        k.n++; if (ms > k.max) k.max = ms; if (ms > 50) k.over50++; k.ms.push(ms);
        requestAnimationFrame(loop);
      };
      const cpuOf = () => Object.fromEntries(Object.entries(cpu).map(([p, k]) => { const v = [...k.ms].sort((a, b) => a - b); return [p, {frames: k.n, maxMs: Math.round(k.max), p95Ms: Math.round(v[Math.floor(v.length * 0.95)] ?? 0), over50: k.over50}]; }));
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      // three's node builds, render pipelines created and pipelines used by a draw for the first time — per ride phase
      let phase = 'boot';
      const counts: Record<string, Count> = {};
      // (a gameplay event's dynamic effect — the damage system's debris pools, never warmed on main either: its first draw creates its
      // pipeline whenever the first glass breaks — counts under '<phase>:fx', reported, not as the crossing's preparation)
      const fxOf = (o: unknown) => { const x = o as {name?: string; object?: {name?: string}} | null; return /^debris-/.test(x?.object?.name ?? x?.name ?? ''); };
      const c = (o?: unknown) => (counts[fxOf(o) ? `${phase}:fx` : phase] ??= {builds: 0, pipelines: 0, firstUsed: 0});
      const r3 = (game as unknown as {renderer: {backend: Record<string, (...a: unknown[]) => unknown>; _pipelines: {_getRenderPipeline(...a: unknown[]): object}}}).renderer;
      const be = r3.backend, used = new Set<unknown>(), firstAtOpen: string[] = [];
      const cnb = be.createNodeBuilder.bind(be); be.createNodeBuilder = (...a: unknown[]) => { c(a[0]).builds++; return cnb(...a); };
      const grp = r3._pipelines._getRenderPipeline.bind(r3._pipelines); r3._pipelines._getRenderPipeline = (...a: unknown[]) => { c(a[0]).pipelines++; return grp(...a); };
      const draw = be.draw.bind(be);
      be.draw = (...a: unknown[]) => {
        const ro = a[0] as {pipeline?: unknown; object?: {name?: string}; material?: {name?: string}};
        if (ro.pipeline && !used.has(ro.pipeline)) { used.add(ro.pipeline); c(ro).firstUsed++; if (phase === 'open' || phase === 'opening' || phase === 'tent' || phase === 'release') firstAtOpen.push(`${phase}: ${ro.object?.name} / ${ro.material?.name} / ${(ro.object as {type?: string})?.type} / ${(ro as {context?: {renderTarget?: unknown}}).context?.renderTarget ? 'target' : 'canvas'}`); }
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
      // (task studio-surface-map-tent-cab-20261119-025201-01) after the doors opened into the command tent: 'tent' — frames sealed to the
      // tent while the street is prepared behind its held flap; 'release' — the first frames after the flap was released (the street drawn)
      const TS = (game as unknown as {surfaceTentStage: {phase: string; record: Record<string, unknown> | null}}).surfaceTentStage;
      let street = false, released = -1;
      G.render = () => {
        if (TS.phase === 'street') street = true;
        else if (street && released < 0 && TS.phase === 'idle') released = frames.length;
        phase = R.sealed || G.transitGap ? 'ride' : R.phase === 'opening' ? (opened < 0 && frames.some(f => f.gap) ? 'open' : 'opening')
          : released >= 0 ? (frames.length - released < 30 ? 'release' : 'after') : opened >= 0 ? (TS.phase === 'street' ? 'tent' : 'after') : 'ride';
        framePhase = phase;
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
      await h.waitFrames(60);
      const cv = game.surfaceLiftCompile!, job = cv.job;
      marks.push(`ride ${((performance.now() - T0) / 1000).toFixed(0)} s; crossing (the tent) ${JSON.stringify({...cv, job: undefined})}; stage ${JSON.stringify(TS.record)}; counts ${JSON.stringify(counts)}`);
      // (a) the TENT's first view (the car opens into the command tent): drawn off-screen (the scene pass's target), spread over the sealed
      // frames, its hidden real-view frame drawn sealed to the tent (as the door-open frame), then the doors open
      expect(TS.record, 'staged in the tent').toMatchObject({flapHeld: true, tent: {end: 'ready'}});
      expect(cv).toMatchObject({end: 'ready', why: '', tries: 1});
      expect(job.viewDrawn, 'drawn, not only compiled (the scene pass\'s target)').toBe(true);
      expect(job.viewDone).toBe(job.viewItems);
      expect(job.viewRepsCompiled).toBe(job.viewReps);
      expect(job.viewFrame, 'the hidden frame of the real (sealed) view').toBe(true);
      expect(cv.plan.reps, 'program groups in the tent\'s first view').toBeGreaterThan(20);
      expect(cv.plan.swept, 'no culler sweep for the closed tent').toBe(0);
      const drawing = frames.filter(f => f.gap && f.built && (f.fv === 'drawing' || f.fv === 'frame'));
      expect(drawing.length, 'the first view\'s draws spread over drawn (sealed) frames').toBeGreaterThan(5);
      expect(job.viewDraws).toBeGreaterThan(3);
      expect(cv.prep.steps, 'planned in frame steps').toBeGreaterThanOrEqual(FIRST_STEPS);
      const shut = frames.findIndex(f => f.ride === 'travel');
      expect(shut, 'the doors shut and the car moved').toBeGreaterThan(0);
      // (while the doors open: the tent's job; once open, the street's job from the tent replaces it — (e))
      for (const f of frames.slice(shut)) if (f.door > 0 && f.ride !== 'idle') expect(f.fv, 'the doors open only with the first view ready').toBe('ready');
      expect(opened, 'the door-open frame seen').toBeGreaterThan(0);
      // (b) the door-open frame and the frames while the doors open: nothing built, created or first used
      for (const p of ['open', 'opening'] as const) expect(counts[p] ?? {builds: 0, pipelines: 0, firstUsed: 0}, `${p}: ${firstAtOpen.join(', ')}`).toEqual({builds: 0, pipelines: 0, firstUsed: 0});
      expect(firstAtOpen.filter(x => x.startsWith('open')), 'first used at the door-open').toEqual([]);
      // (e) the street from the tent: its first view from the flap drawn off-screen (with the culler sweep) while the frames draw the
      // tent only — and none of those frames builds, creates or first uses anything; then the flap is released and the release frames
      // (the street drawn, its hidden frame already from this camera) build, create and first use nothing either
      expect(await until(() => released >= 0 && frames.length - released >= 30, 30000), `the street prepared from the tent ${JSON.stringify(TS.record)}`).toBe(true);
      const sv = (game as unknown as {surfaceTentStreetCompile: typeof cv}).surfaceTentStreetCompile!, sj = sv.job;
      marks.push(`street (from the tent) ${JSON.stringify({...sv, job: undefined})}; counts ${JSON.stringify(counts)}; job steps ${JSON.stringify({steps: sj.steps, stepMaxMs: Math.round(sj.stepMaxMs), sliceMaxMs: Math.round(sj.sliceMaxMs), sceneChunks: sj.sceneChunks, viewDraws: sj.viewDraws, viewMaxPerDraw: sj.viewMaxPerDraw, viewDrawMaxMs: Math.round(sj.viewDrawMaxMs), viewFrameMs: Math.round(sj.viewFrameMs)})}; frame cpu ${JSON.stringify(cpuOf())}`);
      expect(sv).toMatchObject({end: 'ready', why: '', tries: 1});
      expect(TS.record).toMatchObject({phase: 'done', street: {end: 'ready'}});
      expect(sj.viewDrawn).toBe(true);
      expect(sj.viewDone).toBe(sj.viewItems);
      expect(sj.viewFrame, 'the street\'s hidden real-view frame (from the player\'s camera in the tent)').toBe(true);
      expect(sv.plan.swept, 'the culler sweep from the flap').toBeGreaterThan(0);
      expect(sv.plan.items, 'the street: more than the tent').toBeGreaterThan(cv.plan.items);
      for (const p of ['tent', 'release'] as const) expect(counts[p] ?? {builds: 0, pipelines: 0, firstUsed: 0}, `${p}: nothing built, created or first used — ${firstAtOpen.join(', ')}`).toEqual({builds: 0, pipelines: 0, firstUsed: 0});
      expect(frames.filter((_, i) => i < released && i > opened).length, 'frames drawn in the tent before the release').toBeGreaterThan(10);
      // (d) the rest: reported at the release, and going on after it (the same job, play pacing)
      expect(sv.rest, 'what was left when the flap was released').not.toBeNull();
      expect(sv.rest!.left).toBeGreaterThan(0);
      expect(sv.rest!.total).toBe(sj.sceneItems + sj.casters + sj.twoPass);
      const after0 = sj.sceneDone + sj.shadowDone;
      await h.waitFrames(60);
      expect(sj.sceneDone + sj.shadowDone, 'the rest advances after the release').toBeGreaterThan(after0);
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
