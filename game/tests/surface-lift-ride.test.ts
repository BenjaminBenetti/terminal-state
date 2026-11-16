// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS): SURFACE RUN version 2 — the CARGO LIFT RIDE is the crossing,
// both ways, on the REAL Game in Node (src/game.ts, every lane, the real generated station and district) over three r186's WebGPURenderer
// on the validating no-op device (helpers/headlessGame.ts).
//  1. A new campaign at a Surface Run Subway station (version 2): its access is the cargo lift; standing in the car the prompt rides up.
//  2. [E] -> the doors close with the player held in the car -> the old world is left, the district generated (at the press, measured),
//     built paced and compiled completely — every frame meanwhile DRAWN (never a loading state, no warm-up behind a hidden canvas) — and
//     the doors stay SHUT until the compile is done; paused mid-ride they stay shut until play resumes. Arrival: standing in the tent's
//     car, doors open, released; the eye's gas exposure 0 in the tent with its flap shut.
//  3. The tent's doorway is a real opening: with the flap shut the player cannot walk out; opened, they walk out through it and back in
//     on the real collision (Player.update in the game loop, held W).
//  4. [E] in the tent's car rides down: back in the station's car, the station exactly as left, no district objects / resources / frame
//     hooks / lift views left over.
//  5. A ride whose destination cannot be prepared (QA failure injection) returns the player to the car they left (recovered).
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

interface Priv {
  interact(): void;
  saveSectionMemory(): void;
  transitGap: boolean;
  prepareSection(key: SectionKey, run: unknown): Promise<StationLayout>;
  render(): boolean;
}

describe('Surface Run v2: the cargo lift ride (real Game, validating device)', () => {
  it('rides up and down with no loading screen; doors shut until the destination is compiled; the tent walk-through; recovery', async () => {
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
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceLiftOf} = await import('../src/world/surface/liftRuntime');
      const {surfaceAirRuntime} = await import('../src/world/surface/air');
      const game = new Game(h.canvas, false);
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
      const samples: {gap: boolean; phase: string; door: number; compile: string | null; job: object | null; state: string}[] = [];
      const render0 = G.render.bind(game);
      G.render = () => { const r = render0(); const j = game.journeyCompileStats; samples.push({gap: G.transitGap, phase: R.phase, door: R.door, compile: j?.phase ?? null, job: j, state: game.state}); return r; };

      // ---- 1. the station's cargo lift -------------------------------------------------------------------------------------------
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: SURFACE_VERSION});
      const acc = game.layout.surfaceAccess!;
      expect(acc).toMatchObject({v: 2, kind: 'lift'});
      expect(R.site?.lift, 'the station end is drawn').toEqual(acc.lift);
      expect(liftViews()).toBe(1);
      await h.waitFrames(30);
      G.saveSectionMemory();
      const snapHost = () => {
        G.saveSectionMemory();
        const L = game.layout, mem = structuredClone(game.run.peekMemory(hostKey)!) as {pickups: unknown; holders: unknown; killed: unknown; cleared: unknown};
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
      const shut = ride.findIndex(s => s.phase === 'travel');
      expect(shut).toBeGreaterThan(0);
      for (const s of ride.slice(shut)) if (s.door > 0) expect(s.compile, `doors opening only after the compile: ${JSON.stringify(s)}`).toBe('done');
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
      // the tent is gas-free with its flap shut
      const air = surfaceAirRuntime()!;
      const flap = air.air!.doors.find(d => d.plan.tent)!;
      expect(flap.target, 'the flap starts shut').toBe(0);
      let maxC = 0;
      for (let i = 0; i < 30; i++) { await h.waitFrames(1); maxC = Math.max(maxC, game.gas.exposure.c); }
      expect(maxC, 'no gas at the eye in the tent (flap shut)').toBe(0);

      // ---- 3. the tent's doorway: shut = a wall; open = walk out and back in --------------------------------------------------------
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
      expect(air.open(flap, 'qa')).toBe(true);
      await h.waitFrames(60);
      await walk(400, toDoor, () => outward() > 1.0);
      expect(outward(), 'walked out through the open flap').toBeGreaterThan(1.0);
      await walk(400, () => face(-n[0], -n[1]), () => outward() < -2.0);
      expect(outward(), 'walked back in').toBeLessThan(-2.0);
      mark('tent walk');

      // ---- 4. the ride down --------------------------------------------------------------------------------------------------------
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(qa.surface.access().prompt).toBe(`<b>[E]</b> Ride down to ${game.run.node(pick.station)!.name}`);
      const c1 = {...game.lifecycleCounts}, n1 = samples.length, done1 = game.surfaceCrossCounts.done, staleJob = game.journeyCompileStats;
      await press();
      expect(await ridden(() => game.surfaceCrossCounts.done === done1 + 1 && R.phase === 'idle', 'ride down'), diag()).toBe(true);
      mark('[E] down');
      const down = samples.slice(n1), shut2 = down.findIndex(s => s.phase === 'travel');
      expect(shut2).toBeGreaterThan(0);
      for (const s of down.slice(shut2)) if (s.door > 0) { expect(s.job, 'the station\'s own compile (not the last ride\'s)').not.toBe(staleJob); expect(s.compile).toBe('done'); }
      marks.push(`ride down: ${down.length} frames drawn, ${down.filter(s => s.gap).length} in the transit gap; generation at the press ${game.surfaceLiftGenMs.toFixed(0)} ms`);
      expect(game.lifecycleCounts.loading - c1.loading).toBe(0);
      expect(game.lifecycleCounts.warmup - c1.warmup).toBe(0);
      expect(game.run.current).toEqual(hostKey);
      const sl = game.layout.surfaceAccess!.lift!;
      expect(P.x > sl.cab.x0 && P.x < sl.cab.x1 && P.z > sl.cab.z0 && P.z < sl.cab.z1, 'standing in the station\'s car').toBe(true);
      await h.waitFrames(20);
      expect(snapHost(), 'the station exactly as left').toEqual(host0);
      const st = qa.surface.state();
      expect(st.scene.district, 'nothing of the district in the scene').toBe(0);
      expect(st.resources, 'the station\'s resources as they were').toEqual(res0);
      expect(st.frameHooks, 'no frame hook left over').toBe(hooks0);
      expect(liftViews(), 'one lift view: the station\'s').toBe(1);
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
      const sl2 = game.layout.surfaceAccess!.lift!;
      expect(P.x > sl2.cab.x0 && P.x < sl2.cab.x1 && P.z > sl2.cab.z0 && P.z < sl2.cab.z1, 'back in the car').toBe(true);
      expect(errors.filter(e => !e.includes('qa: the street is unreachable'))).toEqual([]);
      expect(frameErrors).toEqual([]);
      marks.push(`hits absorbed ${hits}`);
    } finally {
      h.stop();
      process.stdout.write(`surface-lift-ride: ${marks.join(' | ')}\n`);
    }
  }, 1_500_000);
});
