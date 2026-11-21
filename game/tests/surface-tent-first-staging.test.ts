// Task studio-surface-tent-first-staging-20261120-225458-01 (lead). User: "tackle it now. The tent has no windows so it should be possible to
// have that as the full loading area. Just like how the train is a loading area between levels." — the STAGED COMMAND TENT on the REAL
// Game in Node (src/game.ts, every lane, the real generated station and district) over three r186's WebGPURenderer on the validating no-op
// device (helpers/headlessGame.ts), the Subway cargo lift (tests/surface-connector-walk-*.test.ts: the Office / Mall tube):
//  1. Stage order: [E] in the station's car -> the district generated, its staged tent built FIRST (its build steps 'tent.*' before any
//     of the district's world), its first view prepared with the build parked; the doors open into it while the district is NOT built
//     (the transit gap: no district world update, no light bake yet) — a small part of the build's work before, the rest after.
//  2. While the district is built behind it: the player walks (the real Player on the district's collision: the tent's walls, kit and
//     closed flap), the prompt says the build's real stage; [E] at the flap / in the car is refused with that progress; a save is
//     refused ("still crossing"); the planning map opens at its table (the district's own record) and the build goes on with it open.
//  3. The swap: once built and its real tent's first view prepared, the staged tent goes in one frame, the player where they stood (no
//     pose jump in any frame), the street prepared behind the held flap as before (tests/surface-lift-ride.test.ts, the street gate).
//  4. Re-entry: down and up again — the district restored from memory through the staged tent: its holders, loose items, kills and the
//     map's record exactly as saved (no reroll, refill, duplicate kit or relocation).
//  5. Failure: the district's build failing with the staged tent open — the shell dropped, its lent lamps given back, the station left
//     rebuilt and played on, the district's memory untouched (no trap).
import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import type {SectionKey} from '../src/levels/types';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function pickNetwork(): {seed: number; station: string; levelSeed: number} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id, levelSeed: n.levelSeed};
  }
  throw new Error('no network with a Surface Run subway station');
}

/** Numbers to 1e-6 and quaternions to one sign (a rebuilt item re-reads its pose), as the lift ride's. */
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
  liftBuilt: boolean;
}

describe('Surface tent-first staging: the staged command tent as the loading space (real Game, validating device)', () => {
  it('opens into the staged tent before the district is built; walk, map, refusals meanwhile; the swap; re-entry from memory', async () => {
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
    // (CI runtime, as the lift ride's: the atmosphere off and the 'view' warm-up coverage keep each first view short; 40 ms build slices)
    (globalThis as unknown as {location: {search: string}}).location.search = '?fog=off&warmup=view';
    let stageEnd = () => {};
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceLiftOf} = await import('../src/world/surface/liftRuntime');
      const {surfaceMapOf} = await import('../src/world/surface/mapRuntime');
      const {SURFACE_LIFE_LANE} = await import('../src/world/surface/mapExplore');
      const game = new Game(h.canvas, false);
      stageEnd = () => { game.surfaceTentStage?.cancel('test end'); (game as unknown as {journeyCompile: {cancel(): void} | null}).journeyCompile?.cancel(); };
      game.buildPacing = {sliceMs: 40};
      const G = game as unknown as Priv;
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {surface: {go(): boolean; access(): {prompt: string | null}}}}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      await game.load(() => {});
      const until = async (f: () => boolean, max = 9000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      const R = surfaceLiftOf(game)!;
      const P = game.player;
      vi.spyOn(P, 'takeDamage').mockImplementation(() => {}); // (the district's hunters)
      // the prompt / toasts as the player reads them; every frame's pose (no jump) and the shell's state
      const prompts: string[] = [], toasts: string[] = [];
      const setPrompt0 = game.hud.setPrompt.bind(game.hud), toast0 = game.hud.toast.bind(game.hud);
      game.hud.setPrompt = (html: string) => { if (html && prompts[prompts.length - 1] !== html) prompts.push(html); setPrompt0(html); };
      game.hud.toast = (t: string, w?: boolean) => { toasts.push(t); toast0(t, w); };
      const frames: {x: number; z: number; y: number; shell: boolean; built: boolean; gap: boolean; held: boolean}[] = [];
      // the district build as it stood at the first frame of the open staged tent
      let atOpen: {stages: string[]; workMs: number; steps: number; frame: number} | null = null;
      const render0 = (game as unknown as {render(): boolean}).render.bind(game);
      (game as unknown as {render(): boolean}).render = () => {
        frames.push({x: P.x, z: P.z, y: P.y, shell: game.surfaceTentShellOpen, built: G.liftBuilt, gap: G.transitGap, held: R.holding});
        const J = game.journeyBuildStats;
        if (game.surfaceTentShellOpen && !atOpen && J) atOpen = {stages: Object.keys(J.stages), workMs: J.workMs, steps: J.steps, frame: frames.length - 1};
        return render0();
      };
      const key = async (code: string) => { game.input.pressed.add(code); await h.waitFrames(2); };
      const walk = async (n: number, steer: () => void, stop: () => boolean = () => false) => {
        game.input.keys.add('KeyW');
        try { for (let i = 0; i < n && !stop(); i++) { steer(); await h.waitFrames(1); } } finally { game.input.keys.delete('KeyW'); }
        await h.waitFrames(3);
      };
      const face = (x: number, z: number) => { P.yaw = Math.atan2(-(x - P.x), -(z - P.z)); };
      const rideUp = async (): Promise<{opened: boolean}> => {
        expect(qa.surface.go()).toBe(true);
        await h.waitFrames(2);
        expect(qa.surface.access().prompt).toBe('<b>[E]</b> Ride up to the street');
        G.interact();
        const opened = await until(() => game.surfaceTentShellOpen && !R.holding && R.phase === 'idle');
        return {opened};
      };

      // ---- 1. the stage order ----------------------------------------------------------------------------------------------------
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      const done0 = game.surfaceCrossCounts.done;
      expect((await rideUp()).opened, 'the car opened into the staged tent').toBe(true);
      mark('opened into the staged tent');
      const B = game.journeyBuildStats!, shell = game.surfaceTentShell!;
      expect(shell, 'the staged tent').toBeTruthy();
      expect(G.transitGap && !G.liftBuilt, 'the district is not built yet').toBe(true);
      expect(atOpen, 'the build seen at the staged tent\'s opening').toBeTruthy();
      const stagesAtOpen = atOpen!.stages;
      marks.push(`at the opening: ${JSON.stringify(atOpen)}; released ${frames.length - 1 - atOpen!.frame} frames later at stages ${Object.keys(B.stages).slice(-3).join(', ')}`);
      const firstTent = stagesAtOpen.findIndex(k => k.startsWith('tent.')), firstWorld = stagesAtOpen.findIndex(k => k === 'world' || k.startsWith('world.'));
      expect(firstTent, `the staged tent's steps ran (${stagesAtOpen.join(', ')})`).toBeGreaterThanOrEqual(0);
      expect(firstWorld === -1 || firstWorld > firstTent, 'before any of the district\'s world').toBe(true);
      expect(stagesAtOpen.includes('lighting'), 'the district\'s lighting not yet built').toBe(false);
      const workAtOpen = atOpen!.workMs, rec = game.surfaceTentShellRecord!;
      expect(rec.stats.view).toMatchObject({end: 'ready', tries: 1});
      // the opened doors' frame: in the staged tent, the district not built, the player released into it
      const open1 = frames.findIndex(f => f.shell && !f.held);
      expect(open1).toBeGreaterThan(0);
      expect(frames[open1].built).toBe(false);

      // ---- 2. in the staged tent while the district is built ------------------------------------------------------------------------
      const box = shell.box, center = box.getCenter(new THREE.Vector3());
      expect(shell.contains(P.x, P.y + 1, P.z, 0.4), 'released in the tent').toBe(true);
      const phrase = '(starting|streets and buildings|supplies|routes|light|last details) \\(\\d+\\/11\\)';
      const statusRe = new RegExp(`^Setting up the street outside — ${phrase}$`), backRe = new RegExp(`^The lift goes back down once the street is set up — ${phrase}$`);
      await h.waitFrames(3);
      expect(prompts[prompts.length - 1] ?? '', 'the prompt in the car: the way back and the build\'s real stage').toMatch(backRe);
      // walk into the tent (the real Player on its collision)
      const x0 = P.x, z0 = P.z;
      await walk(45, () => face(center.x, center.z));
      expect(Math.hypot(P.x - x0, P.z - z0), 'walked').toBeGreaterThan(0.6);
      if (!G.liftBuilt) expect(prompts[prompts.length - 1] ?? '', 'the prompt in the tent: the build\'s real stage').toMatch(statusRe);
      expect(shell.contains(P.x, P.y + 1, P.z, 0.4), 'in the tent').toBe(true);
      expect(G.liftBuilt, 'still being built').toBe(false);
      // the closed flap: walking at it stops the player inside; [E] at it is refused with the build's progress
      const fp = shell.flapPlan!;
      const outward = () => (P.x - fp.x) * fp.n[0] + (P.z - fp.z) * fp.n[1];
      Object.assign(P, {x: fp.x - fp.n[0] * 1.2, z: fp.z - fp.n[1] * 1.2, pitch: 0});
      await h.waitFrames(2);
      await walk(90, () => face(fp.x + fp.n[0] * 3, fp.z + fp.n[1] * 3), () => outward() > 0.3);
      expect(outward(), 'the closed flap stops the player').toBeLessThan(0.05);
      expect(outward(), 'walked up to it').toBeGreaterThan(-0.9);
      face(fp.x + fp.n[0] * 3, fp.z + fp.n[1] * 3);
      P.pitch = 0;
      await h.waitFrames(2);
      expect(prompts[prompts.length - 1], 'aimed at the flap').toMatch(/^The tent flap stays shut — setting up the street: /);
      const nt = toasts.length;
      await key('KeyE');
      expect(toasts.slice(nt).some(t => /^The tent flap stays shut — setting up the street: /.test(t)), `[E] at the flap refused (${toasts.slice(nt).join(' / ')})`).toBe(true);
      // a save is refused while crossing
      expect(game.saveBlock(), 'no save mid-stage').toMatchObject({code: 'busy', error: 'Not saved: still crossing — save once you have arrived.'});
      // the planning map at its table: the district's own record; with it open the build goes on
      const MR = surfaceMapOf(game)!;
      expect(MR.qa().staged, 'the staged map').toBe(true);
      const L1 = shell.layout, rd = L1.surface!.checkpoint.mapTable.read!;
      Object.assign(P, {x: rd.x, z: rd.z, yaw: rd.yaw, pitch: -0.5});
      await h.waitFrames(4);
      expect(MR.prompt ?? '', 'the table\'s prompt in the staged tent').toMatch(/planning map/);
      if (!G.liftBuilt) {
        await key('KeyE');
        expect(game.state, 'the map is open').toBe('map');
        const s0 = B.steps, w0 = B.workMs;
        await h.waitFrames(40);
        expect(game.state).toBe('map');
        expect(B.steps, 'the district\'s build stepped with the map open').toBeGreaterThan(s0);
        expect(B.workMs).toBeGreaterThan(w0);
        const mq = MR.qa() as {view: {open?: boolean} | null; explored: number; markers: unknown[]};
        marks.push(`map open in the staged tent: explored ${mq.explored}, ${mq.markers.length} markers, build ${s0} -> ${B.steps} steps`);
        MR.view!.handleKey({code: 'Escape', key: 'Escape', repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {}});
        await until(() => game.state !== 'map', 600);
        if (game.state === 'paused') game.setState('playing'); // (Resume; enterPlay's pointer-lock request never settles headless)
        expect(game.state, 'closed: back in the tent').toBe('playing');
      } else marks.push('the district was built before the map check (the map check skipped)');
      // back in the car: [E] refused, the way back named
      const cab = L1.surface!.portal.lift!.cab;
      Object.assign(P, {x: (cab.x0 + cab.x1) / 2, z: (cab.z0 + cab.z1) / 2});
      await h.waitFrames(3);
      if (!G.liftBuilt) {
        const nb = toasts.length;
        await key('KeyE');
        expect(toasts.slice(nb).some(t => /^The lift goes back down once the street is set up — /.test(t)), `[E] in the car refused (${toasts.slice(nb).join(' / ')})`).toBe(true);
        expect(R.phase, 'the car stays').toBe('idle');
      }
      // stand at the table for the swap
      Object.assign(P, {x: rd.x, z: rd.z, yaw: rd.yaw, pitch: 0});
      const atSwap = {x: rd.x, z: rd.z}, swappedBefore = !game.surfaceTentShell;

      // ---- 3. the swap -----------------------------------------------------------------------------------------------------------------
      const f3 = frames.length;
      expect(await until(() => game.surfaceCrossCounts.done === done0 + 1), 'the crossing completed').toBe(true);
      mark('built and swapped');
      expect(game.surfaceTentShell, 'the staged tent is gone').toBeNull();
      expect(rec.why).toBe('swapped');
      expect(rec.openMs).toBeLessThan(rec.buildDoneMs);
      expect(rec.swapMs).toBeGreaterThanOrEqual(rec.buildDoneMs);
      if (!swappedBefore) expect(Math.hypot(P.x - atSwap.x, P.z - atSwap.z), 'the player where they stood').toBeLessThan(0.05);
      expect(game.run.current).toEqual(surfKey);
      // no pose jump where the car released the player into the staged tent, nor at the swap
      expect(Math.hypot(frames[open1].x - frames[open1 - 1].x, frames[open1].z - frames[open1 - 1].z), 'no jump at the release').toBeLessThan(0.1);
      const swapFrame = frames.findIndex((f, i) => i > open1 && frames[i - 1].shell && !f.shell);
      expect(swapFrame).toBeGreaterThan(open1);
      marks.push(`swap at frame ${swapFrame} (the swap checks ${swappedBefore ? 'after the district built during the checks' : 'standing still'}; ${f3} frames before the wait)`);
      expect(Math.hypot(frames[swapFrame].x - frames[swapFrame - 1].x, frames[swapFrame].z - frames[swapFrame - 1].z), 'no jump at the swap').toBeLessThan(0.05);
      const work = B.workMs;
      marks.push(`build work ${work.toFixed(0)} ms: ${workAtOpen.toFixed(0)} ms before the doors opened (${((100 * workAtOpen) / work).toFixed(1)} %); staged tent ${JSON.stringify({...rec, stats: {...rec.stats}})}`);
      expect(workAtOpen / work, 'a small part of the district build before the doors opened').toBeLessThan(0.35);
      const top = Object.entries(B.stages).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(', ');
      marks.push(`build: ${B.slices} slices, ${B.steps} steps, max slice ${B.maxSliceMs.toFixed(0)} ms, max step ${B.maxStepMs.toFixed(0)} ms; top stages ${top}; tent.* ${Object.entries(B.stages).filter(([k]) => k.startsWith('tent.')).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(', ')}`);
      expect(box.containsPoint(new THREE.Vector3(P.x, P.eye, P.z)), 'in the district\'s real tent (the staged tent\'s box: the same)').toBe(true);
      const TS = game.surfaceTentStage!;
      expect(TS.phase, 'the street prepared behind the held flap').toBe('street');
      expect(MR.qa(), 'the staged map adopted by the built district').toMatchObject({staged: false, counts: {staged: 1, adopted: 1}});
      expect(await until(() => TS.phase === 'idle'), 'the street ready').toBe(true);
      expect(TS.record, 'released on the street\'s real first view').toMatchObject({phase: 'done', street: {end: 'ready'}});
      mark('street ready');
      expect(prompts.some(p => statusRe.test(p)), 'progress said').toBe(true);

      // ---- 4. re-entry: down and up again through the staged tent, the district from its memory -------------------------------------
      await h.waitFrames(20);
      G.saveSectionMemory();
      // (holders and kills exactly; the loose items by count — a hunter's push may settle one a little between two captures)
      const snap = () => {
        const m = canon(game.run.peekMemory(surfKey)!) as {pickups: unknown[]; holders: unknown; killed: unknown; cleared: unknown};
        return {pickups: (m.pickups ?? []).length, holders: JSON.stringify(m.holders), killed: JSON.stringify(m.killed), cleared: m.cleared};
      };
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      const doneD = game.surfaceCrossCounts.done;
      G.interact();
      expect(await until(() => game.surfaceCrossCounts.done === doneD + 1 && R.phase === 'idle'), 'rode down').toBe(true);
      expect(game.run.current).toEqual(hostKey);
      expect(game.surfaceTentShell, 'no staged tent going down').toBeNull();
      mark('down');
      const before = snap(), life0 = JSON.stringify(game.run.laneStore(SURFACE_LIFE_LANE, surfKey) ?? null); // (the district's memory as its leave saved it)
      expect(before.holders.length, 'the district remembers its holders').toBeGreaterThan(10);
      const doneU = game.surfaceCrossCounts.done;
      expect((await rideUp()).opened, 'up again: the staged tent').toBe(true);
      expect(MR.qa().staged).toBe(true);
      expect(await until(() => game.surfaceCrossCounts.done === doneU + 1), 'up again: completed').toBe(true);
      mark('up again');
      await h.waitFrames(10);
      G.saveSectionMemory();
      const after = snap();
      expect(after, 'the district exactly as remembered: holders, loose items, kills').toEqual(before);
      const life1 = JSON.stringify(game.run.laneStore(SURFACE_LIFE_LANE, surfKey) ?? null);
      marks.push(`map record ${life0.length} -> ${life1.length} chars`);
      expect(life1.length, 'the map\'s record kept (explored only grows)').toBeGreaterThanOrEqual(life0.length);
      expect(game.surfaceTentShellRecord!.why).toBe('swapped');

      // ---- 5. a failure while the staged tent is open: the crossing ends there — the shell goes, its lent lamps are given back, the
      // station the player left is rebuilt (recoverSurfaceCrossing: the loading screen, "you are still here"), the district's memory
      // untouched; no trap ------------------------------------------------------------------------------------------------------------
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      const doneD2 = game.surfaceCrossCounts.done;
      G.interact();
      expect(await until(() => game.surfaceCrossCounts.done === doneD2 + 1 && R.phase === 'idle'), 'rode down again').toBe(true);
      const mem2 = snap(), {failed: failed0, recovered: recovered0} = game.surfaceCrossCounts;
      const lamps = () => JSON.stringify(game.trainRuntime.lights.interior.map(l => [...l.position.toArray().map(v => Math.round(v * 1e6) / 1e6), l.distance, l.decay]));
      const lamps0 = lamps();
      const N = G as unknown as {noteShellStage: (s: string) => void};
      const note0 = N.noteShellStage;
      let failedAt = '';
      N.noteShellStage = (s: string) => { note0(s); if (s === 'lighting' && game.surfaceTentShellOpen) { failedAt = s; throw new Error('test: the district build failed'); } };
      try {
        expect(qa.surface.go()).toBe(true);
        await h.waitFrames(2);
        G.interact();
        expect(await until(() => game.surfaceTentShellOpen), 'up: the staged tent opened before the failure').toBe(true);
        expect(await until(() => game.surfaceCrossCounts.recovered === recovered0 + 1 && game.state === 'playing'), 'recovered: back in the station').toBe(true);
      } finally { N.noteShellStage = note0; }
      expect(failedAt, 'failed in the district\'s lighting, the staged tent open').toBe('lighting');
      expect(game.surfaceCrossCounts.failed).toBe(failed0 + 1);
      expect(game.run.current, 'back where the crossing started').toEqual(hostKey);
      expect(game.surfaceTentShell).toBeNull();
      expect(game.surfaceTentShellOpen).toBe(false);
      expect(game.surfaceTentShellRecord!.why, 'the staged tent dropped by the failure').toBe('failed');
      expect(G.transitGap).toBe(false);
      expect(R.phase).toBe('idle');
      expect(lamps(), 'the lent lamps given back where they were').toBe(lamps0);
      expect(toasts.some(t => /could not be reached — you are still here/.test(t)), 'the failure said').toBe(true);
      expect(snap(), 'the district\'s memory untouched by the failed crossing').toEqual(mem2);
      await h.waitFrames(10);
      expect(game.state, 'playing on in the station').toBe('playing');
      mark('failure recovered');
      const injected = /^Surface Run: the lift ride failed .*test: the district build failed/;
      expect(errors.filter(e => injected.test(e)).length, 'the injected failure logged once').toBe(1);
      expect(errors.filter(e => !injected.test(e))).toEqual([]);
      expect(frameErrors).toEqual([]);
    } finally {
      stageEnd();
      await new Promise(res => setTimeout(res, 1600));
      h.stop();
      process.stdout.write(`surface-tent-first-staging: ${marks.join(' | ')}\n`);
    }
  }, 1_500_000);
});
