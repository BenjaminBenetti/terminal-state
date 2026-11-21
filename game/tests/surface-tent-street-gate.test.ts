// Task studio-surface-tent-loading-finish-20261119-071019-01 (Main, on the user's tent request): "A warning is not a substitute for the
// requested gate until the actual first exit view is ready. Do not release an unprepared street on a timer/budget. On real failure/stall,
// keep the tent/map safe and usable and provide truthful retry/return/cancel recovery without trapping the player. Only real first-view
// readiness should allow normal exit." The Surface Run cargo lift ride up from a Subway station on the REAL Game in Node (every lane, the
// real generated station and district) over three r186's WebGPURenderer on the validating no-op device (helpers/headlessGame.ts); the
// street's first-view jobs behind the command tent's held flap made to fail / stall (JourneyCompile.start, as tests/surface-lift-ride
// section 6), the rest real:
//  1. ride up: the street's job ends without its view, twice (the crossing's one retry) -> 'failed': the flap held, its prompt / a toast
//     say so and how to retry / go back; [E] at the flap is a RETRY -> a job that never progresses -> 'stalled' (said once), and neither
//     its stall nor the old budget (LIFT_RIDE_WAIT.budgetMs, shortened) releases the flap; the planning map opens and closes meanwhile;
//     the doors' record saved meanwhile is the flap's from before the hold;
//  2. RETURN from the stalled tent: the lift rides back down (a normal crossing) — the stage ended with its world, the station as left;
//  3. ride up again: a stalled street, [E] at the flap -> a fresh, real job -> the flap released ONLY on its real first view (here the
//     atmosphere off: compiled, not drawn — said so), the flap as it was before the hold.
import {afterAll, describe, expect, it, vi} from 'vitest';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import type {SectionKey} from '../src/levels/types';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function pickNetwork(): {seed: number; station: string} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id};
  }
  throw new Error('no network with a Surface Run subway station');
}

interface Priv { interact(): void; transitGap: boolean; frameBudget: {activeMs: number} }

describe('Surface Run v2: the street behind the command tent\'s held flap opens only on its real first view (real Game)', () => {
  it('a failed / stalled street keeps the flap shut (no timer, no budget), says so, takes [E] as a retry; the lift back down; a retry that succeeds', async () => {
    const T0 = performance.now(), marks: string[] = [];
    const mark = (s: string) => marks.push(`${s} ${((performance.now() - T0) / 1000).toFixed(1)} s`);
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(() => {});
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
    const pick = pickNetwork();
    const hostKey: SectionKey = {level: 'subway', section: 'main', station: pick.station};
    const surfKey: SectionKey = {level: 'subway', section: 'surface', station: pick.station};
    const h = installHeadless();
    // (CI runtime, as tests/surface-lift-ride: the atmosphere off and the 'view' warm-up coverage; 40 ms build slices)
    (globalThis as unknown as {location: {search: string}}).location.search = '?fog=off&warmup=view';
    let stageEnd = () => {};
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceLiftOf, LIFT_RIDE_WAIT} = await import('../src/world/surface/liftRuntime');
      const {surfaceAirRuntime} = await import('../src/world/surface/air');
      const {SURFACE_DOORS_LANE} = await import('../src/world/surface/airDoors');
      const {TENT_STREET_WAIT} = await import('../src/world/surface/tentStage');
      const {JourneyCompile} = await import('../src/render/journeyCompile');
      const {surfaceMapOf} = await import('../src/world/surface/mapRuntime');
      const game = new Game(h.canvas, false);
      game.buildPacing = {sliceMs: 40};
      const G = game as unknown as Priv;
      stageEnd = () => { game.surfaceTentStage?.cancel('test end'); (game as unknown as {journeyCompile: {cancel(): void} | null}).journeyCompile?.cancel(); };
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {surface: {go(): boolean}}}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      await game.load(() => {});
      const until = async (f: () => boolean, max = 9000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      vi.spyOn(game.player, 'takeDamage').mockImplementation(() => {}); // (the district's hunters: not applied)
      const toasts: string[] = [];
      const toast0 = game.hud.toast.bind(game.hud);
      vi.spyOn(game.hud, 'toast').mockImplementation((t: string, w?: boolean) => { toasts.push(t); toast0(t, w); });
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      const R = surfaceLiftOf(game)!, TS = game.surfaceTentStage!;
      // the street's jobs (started while the stage is in its street phase), by plan: 'cancel' — ends at once without its view; 'never' —
      // never runs (no first-view progress: a stall); 'real' (the default) — the real job
      const plan: ('cancel' | 'never' | 'real')[] = [];
      const streetJobs: InstanceType<typeof JourneyCompile>[] = [];
      const start0 = JourneyCompile.prototype.start;
      vi.spyOn(JourneyCompile.prototype, 'start').mockImplementation(function (this: InstanceType<typeof JourneyCompile>) {
        if (TS.phase !== 'street') return start0.call(this);
        streetJobs.push(this);
        const p = plan.shift() ?? 'real';
        if (p === 'never') return this;
        start0.call(this);
        if (p === 'cancel') this.cancel();
        return this;
      });
      const W = TENT_STREET_WAIT as {stallMs: number}, B = LIFT_RIDE_WAIT as unknown as {budgetMs: number};
      const stall0 = W.stallMs, budget0 = B.budgetMs;
      W.stallMs = 2500;
      const rideUp = async (label: string) => {
        expect(qa.surface.go()).toBe(true);
        await h.waitFrames(2);
        const done0 = game.surfaceCrossCounts.done;
        G.interact();
        expect(await until(() => game.surfaceCrossCounts.done === done0 + 1 && R.phase === 'idle'), `${label}: ${JSON.stringify(game.surfaceCrossCounts)}`).toBe(true);
        expect(game.run.current).toEqual(surfKey);
        expect(TS.record, `${label}: staged in the tent`).toMatchObject({flapHeld: true, tent: {end: 'ready'}});
        mark(label);
      };
      /** Stand inside the tent facing its flap (aimed), then [E]. */
      const pressFlap = async () => {
        const air = surfaceAirRuntime()!, flap = air.air!.doors.find(d => d.plan.tent && d.plan.leaves.length > 0)!, n = flap.plan.n;
        Object.assign(game.player, {x: flap.plan.x - n[0] * 1.3, z: flap.plan.z - n[1] * 1.3, yaw: Math.atan2(-n[0], -n[1]), pitch: 0});
        expect(await until(() => air.target === flap, 60), 'aimed at the tent flap').toBe(true);
        G.interact();
        await h.waitFrames(1);
      };
      const held = () => !!surfaceAirRuntime()?.tentFlapHeld;
      const tentDoors = () => (game.run.laneStore(SURFACE_DOORS_LANE, surfKey) as {doors: Record<string, unknown>} | null)?.doors.tent;

      try {
        // ---- 1. ride up: the street fails twice (the crossing's one retry) -> 'failed', held; [E] -> a stall; no budget release ---------
        plan.push('cancel', 'cancel', 'never');
        await rideUp('ride up 1');
        B.budgetMs = 4000; // (the car's own bound, now past: the street's wait must not use it)
        const rec1 = TS.record!;
        expect(await until(() => TS.street === 'failed', 2000), `failed: ${JSON.stringify(rec1)}`).toBe(true);
        expect(streetJobs.length, 'the street\'s job and the crossing\'s one retry').toBe(2);
        expect(TS.phase, 'the stage goes on: the tent sealed').toBe('street');
        expect(held(), 'the flap held').toBe(true);
        expect(TS.flapLine()).toBe('[E] Try again — the street could not be prepared (cancelled)');
        expect(toasts.filter(t => t.startsWith('The street could not be prepared (cancelled).')), 'said once, with the retry and the way back').toEqual(
          ['The street could not be prepared (cancelled). The tent flap stays shut — [E] at the flap tries again, or ride the lift back down.']);
        await h.waitFrames(30);
        expect(TS.street, 'no timer: still failed, held').toBe('failed');
        expect(held()).toBe(true);
        await pressFlap();
        expect(toasts[toasts.length - 1]).toMatch(/^Trying again to prepare the street/);
        expect(await until(() => streetJobs.length === 3, 600), 'the retry: a fresh job').toBe(true);
        expect(await until(() => TS.street === 'stalled', 3000), `stalled ${JSON.stringify(TS.record)}`).toBe(true);
        expect(TS.flapLine()).toMatch(/^\[E\] Try again — preparing the street is stuck( at \d+ \/ \d+)?$/);
        // neither the stall nor the old budget releases the flap (active time well past both)
        const a0 = G.frameBudget.activeMs;
        expect(await until(() => G.frameBudget.activeMs - a0 > 3 * W.stallMs + B.budgetMs, 4000)).toBe(true);
        expect(TS.phase, 'past the stall and the old budget: the stage goes on').toBe('street');
        expect(TS.street).toBe('stalled');
        expect(held(), 'still held').toBe(true);
        expect(toasts.filter(t => t.startsWith('Preparing the street has made no progress')).length, 'the stall said once').toBe(1);
        // the tent is usable meanwhile: the planning map opens at its table and closes
        const MR = surfaceMapOf(game)!, rd = game.layout.surface!.checkpoint.mapTable.read;
        Object.assign(game.player, {x: rd.x, z: rd.z, yaw: rd.yaw, pitch: -0.5});
        await h.waitFrames(4);
        expect(MR.prompt ?? '', 'the table\'s prompt in the stalled tent').toMatch(/planning map/);
        G.interact();
        await h.waitFrames(2);
        expect(game.state, 'the map opens').toBe('map');
        MR.view!.handleKey({code: 'Escape', key: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {}});
        await until(() => game.state !== 'map', 600);
        if (game.state === 'paused') game.setState('playing'); // (Resume; enterPlay's pointer-lock request never settles headless)
        expect(game.state).toBe('playing');
        // a save meanwhile: the flap as it was before the hold (shut)
        surfaceAirRuntime()!.flush();
        expect(tentDoors(), 'saved shut, as before the hold').toEqual({open: 0});
        marks.push(`stage 1: ${JSON.stringify({...rec1, scan: undefined})}`);

        // ---- 2. RETURN: the lift back down from the stalled tent ---------------------------------------------------------------------
        const down0 = game.surfaceCrossCounts.done;
        expect(qa.surface.go(), 'the tent\'s lift: open to ride').toBe(true);
        await h.waitFrames(2);
        G.interact();
        expect(await until(() => game.surfaceCrossCounts.done === down0 + 1 && R.phase === 'idle'), JSON.stringify(game.surfaceCrossCounts)).toBe(true);
        mark('back down');
        expect(game.run.current).toEqual(hostKey);
        expect(rec1, 'the stage ended with its world').toMatchObject({phase: 'cancelled', why: 'teardown', stalls: 1, failures: 1, retries: 1, tries: 3});
        expect(TS.phase).toBe('idle');
        expect(tentDoors(), 'the district\'s flap saved shut, as before the hold').toEqual({open: 0});
        const sl = game.layout.surfaceAccess!.lift!, P = game.player;
        expect(P.x > sl.cab.x0 && P.x < sl.cab.x1 && P.z > sl.cab.z0 && P.z < sl.cab.z1, 'standing in the station\'s car').toBe(true);

        // ---- 3. up again: a stall, [E] -> a fresh real job -> released ONLY on its real first view ----------------------------------
        plan.length = 0;
        plan.push('never');
        B.budgetMs = budget0;
        const n0 = streetJobs.length;
        await rideUp('ride up 2');
        const rec2 = TS.record!;
        expect(rec2).not.toBe(rec1);
        expect(await until(() => TS.street === 'stalled', 3000), `stalled ${JSON.stringify(rec2)}`).toBe(true);
        expect(held()).toBe(true);
        await pressFlap();
        expect(await until(() => streetJobs.length === n0 + 2, 600), 'the retry: a fresh, real job').toBe(true);
        expect(TS.street).toBe('preparing');
        expect(await until(() => TS.phase === 'idle', 9000), `released ${JSON.stringify(rec2)}`).toBe(true);
        mark('released');
        expect(rec2, 'released on the street\'s real first view').toMatchObject({phase: 'done', why: 'ready', street: {end: 'ready'}, tries: 2, retries: 1, failures: 0});
        // (the injected stall; the real job may pause past the test's short stall period too — said, then progressing again: preparing)
        expect(rec2.stalls).toBeGreaterThanOrEqual(1);
        expect(streetJobs[n0 + 1].stats.firstView, 'the real job\'s first view').toBe('ready');
        expect(game.surfaceTentStreetCompile).toMatchObject({end: 'ready', why: 'compiled, not drawn (no off-screen scene pass)'});
        expect(toasts.some(t => t.startsWith('The tent flap can be opened — the street\'s graphics are compiled; with the atmosphere off they cannot be drawn ahead')), 'the direct path said').toBe(true);
        expect(toasts.some(t => t.startsWith('The street is ready')), 'never called drawn-ready on the direct path').toBe(false);
        expect(held(), 'released').toBe(false);
        expect(surfaceAirRuntime()!.air!.doors.find(d => d.plan.tent)!.target, 'shut before the hold: stays shut').toBe(0);
        marks.push(`stage 2: ${JSON.stringify({...rec2, scan: undefined})}; street jobs ${streetJobs.length}`);
      } finally {
        W.stallMs = stall0;
        B.budgetMs = budget0;
      }
      expect(errors).toEqual([]);
      expect(frameErrors).toEqual([]);
    } finally {
      stageEnd();
      await new Promise(res => setTimeout(res, 1600));
      h.stop();
      process.stdout.write(`surface-tent-street-gate: ${marks.join(' | ')}\n`);
    }
  }, 1_200_000);
});
