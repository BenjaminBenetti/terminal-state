// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, follow-up 2): SURFACE RUN version 2 — the cargo lift ride from
// an OFFICE tower and a MALL, both ways, on the REAL Game in Node (helpers/headlessGame.ts; the validating no-op device):
//  - the host's access is its cargo lift inside the building (gen/surface/accessLiftHost.ts); standing in the car [E] rides up: never a
//    loading state, every frame drawn, the doors SHUT until the exit's FIRST VIEW is ready (lane READY: Game.prepareCrossingView; the
//    atmosphere off here: compiled, the direct path cannot draw off-screen); arrival standing in the tent's car;
//  - [E] in the tent's car rides down: back in the host's car, the host's memory exactly as left, one lift view in the scene.
// (CI runtime, as tests/surface-lift-ride.test.ts: the atmosphere off and the warm-up's 'view' coverage — a real, complete job the doors
// wait for; SURFACE_LIFT_FULL=1 runs the default quality and the full coverage. One host per test file — each ~4-5 min on one worker:
// tests/surface-lift-hosts-office.test.ts / surface-lift-hosts-mall.test.ts.)
import {expect, vi} from 'vitest';
import {installHeadless} from './headlessGame';
import {generateNetwork} from '../../src/campaign/network';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../../src/gen/surface/surfaceRun';
import type {SectionKey} from '../../src/levels/types';

/** The first network seed whose first `host` node rolls a Surface Run (a dev start at that level picks that node). */
function pickNetwork(host: SurfaceHost): {seed: number; station: string} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === host);
    if (n && surfacePresent(host, n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id};
  }
  throw new Error(`no network with a Surface Run ${host} station`);
}

/** Numbers to 1e-6 and quaternions to one sign (q and -q are one orientation), as the journey test. */
function canon(v: unknown, key = ''): unknown {
  if (typeof v === 'number') { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; }
  if (Array.isArray(v)) {
    let a = v;
    if (key === 'q' && a.length === 4 && a.every(x => typeof x === 'number')) { const w = Math.abs(a[3] as number) > 1e-9 ? a[3] as number : (a as number[]).find(x => Math.abs(x) > 1e-9) ?? 0; if (w < 0) a = (a as number[]).map(x => -x); }
    return a.map(x => canon(x));
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x, k)]));
  return v;
}

interface Priv { interact(): void; saveSectionMemory(): void; transitGap: boolean; render(): boolean }

/** The ride from `host`'s lift up to the district and back down (the test body of one host's file). */
export async function liftHostRide(host: 'office' | 'mall'): Promise<void> {
  const T0 = performance.now(), marks: string[] = [];
  const mark = (s: string) => marks.push(`${s} ${((performance.now() - T0) / 1000).toFixed(1)} s`);
  for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });
  const pick = pickNetwork(host);
  const hostKey: SectionKey = {level: host, section: 'main', station: pick.station};
  const surfKey: SectionKey = {level: host, section: 'surface', station: pick.station};
  const h = installHeadless();
  if (!process.env.SURFACE_LIFT_FULL) (globalThis as unknown as {location: {search: string}}).location.search = '?fog=off&warmup=view';
  try {
    const {Game} = await import('../../src/game');
    const {installQaHooks} = await import('../../src/qa');
    const {surfaceLiftOf} = await import('../../src/world/surface/liftRuntime');
    const game = new Game(h.canvas, false);
    // (CI runtime) the ride's PACED build of the destination: Node's frame (update + submit on the validating device) costs ~45 ms
    // against the product's 6 ms build slice, so a district build took ~2600 frames (~140 s); Game.buildPacing (the build's own test /
    // QA knob) runs 40 ms slices instead. Frames are still drawn between slices; SURFACE_LIFT_FULL=1 keeps the product's pacing.
    if (!process.env.SURFACE_LIFT_FULL) game.buildPacing = {sliceMs: 40};
    const G = game as unknown as Priv;
    installQaHooks(game);
    const qa = (globalThis as unknown as {__LL: {surface: {go(): boolean; access(): {prompt: string | null}; lift(): unknown}}}).__LL;
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    const states: string[] = [];
    game.stateListeners.push(s => { states.push(s); });
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    await game.load(() => {});
    vi.spyOn(game.player, 'takeDamage').mockImplementation(() => {}); // (the district's hunters: not applied)
    const R = surfaceLiftOf(game)!;
    const liftViews = () => { let n = 0; game.scene.traverse(o => { if (o.name === 'cargo-lift-surface') n++; }); return n; };
    const samples: {phase: string; door: number; compile: string | null; fv: string | null; job: object | null}[] = [];
    const render0 = G.render.bind(game);
    G.render = () => { const r = render0(); const j = game.journeyCompileStats; samples.push({phase: R.phase, door: R.door, compile: j?.phase ?? null, fv: j?.firstView ?? null, job: j}); return r; };
    const diag = () => JSON.stringify({state: game.state, gap: G.transitGap, counts: game.surfaceCrossCounts, ride: qa.surface.lift(), compile: game.journeyCompileStats, errors: errors.slice(0, 2), frameErrors: frameErrors.slice(0, 2)}).slice(0, 1500);
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    const inCar = (l: {cab: {x0: number; z0: number; x1: number; z1: number}}) => { const P = game.player; return P.x > l.cab.x0 && P.x < l.cab.x1 && P.z > l.cab.z0 && P.z < l.cab.z1; };
    /** [E] in the car: the ride; every frame after the doors shut opens them only with the (new) job's first view ready. */
    const ride = async (label: string) => {
      const n0 = samples.length, done0 = game.surfaceCrossCounts.done, c0 = {...game.lifecycleCounts}, s0 = states.length, stale = game.journeyCompileStats;
      G.interact();
      expect(await until(() => game.surfaceCrossCounts.done === done0 + 1 && R.phase === 'idle'), diag()).toBe(true);
      const rs = samples.slice(n0), shut = rs.findIndex(s => s.phase === 'travel');
      expect(shut, `${label}: the doors shut and the car moved`).toBeGreaterThan(0);
      for (const s of rs.slice(shut)) if (s.door > 0) { expect(s.job, `${label}: this ride's warm-up`).not.toBe(stale); expect(s.fv, `${label}: doors open only with the first view ready`).toBe('ready'); }
      expect(rs.slice(shut).some(s => s.door === 0 && s.compile === 'scene'), `${label}: the warm-up ran with the doors shut`).toBe(true);
      expect(states.slice(s0), `${label}: never a loading state`).toEqual([]);
      expect(game.lifecycleCounts.loading - c0.loading).toBe(0);
      expect(game.lifecycleCounts.warmup - c0.warmup, `${label}: no hidden-canvas warm-up`).toBe(0);
      marks.push(`${label}: ${rs.length} frames, generation ${game.surfaceLiftGenMs.toFixed(0)} ms`);
    };

    expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: host}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => game.state === 'playing')).toBe(true);
    mark('new game');
    const acc = game.layout.surfaceAccess!;
    expect(acc, 'the host has its way up').toBeTruthy();
    expect(acc).toMatchObject({v: 2, kind: 'lift'});
    expect(liftViews(), 'the host\'s lift drawn').toBe(1);
    await h.waitFrames(30);
    G.saveSectionMemory();
    const snap = () => { G.saveSectionMemory(); const m = canon(game.run.peekMemory(hostKey)!) as Record<string, unknown>; return JSON.stringify([m.pickups, m.holders, m.killed, m.cleared]); };
    const host0 = snap();
    expect(qa.surface.go()).toBe(true);
    await h.waitFrames(2);
    expect(R.inCar(), 'standing in the host\'s car').toBe(true);
    expect(qa.surface.access().prompt).toBe('<b>[E]</b> Ride up to the street');
    await ride('ride up');
    mark('[E] up');
    expect(game.run.current).toEqual(surfKey);
    expect(inCar(game.layout.surface!.portal.lift!), 'standing in the tent\'s car').toBe(true);
    expect(liftViews()).toBe(1);
    expect(qa.surface.go()).toBe(true);
    await h.waitFrames(2);
    await ride('ride down');
    mark('[E] down');
    expect(game.run.current).toEqual(hostKey);
    expect(inCar(game.layout.surfaceAccess!.lift!), 'back in the host\'s car').toBe(true);
    await h.waitFrames(20);
    expect(snap(), 'the host exactly as left').toBe(host0);
    expect(liftViews(), 'one lift view: the host\'s').toBe(1);
    expect(errors).toEqual([]);
    expect(frameErrors).toEqual([]);
  } finally {
    h.stop();
    process.stdout.write(`surface-lift-hosts ${host}: ${marks.join(' | ')}\n`);
  }
}
