// Task studio-surface-host-ground-connectors-20261118-053602-01: SURFACE RUN version 2 — the walked CONNECTOR from an OFFICE tower and a
// MALL, both ways, on the REAL Game in Node (helpers/headlessGame.ts; the validating no-op device), on real input (W + mouse turns):
//  - out: from the host's doorway into the tube, the walk-in flap rolling up and down behind, the crossing (never a loading state or a
//    hidden-canvas warm-up, every frame drawn, the tube SEALED while the worlds swap: nothing else on the camera's layers), the player's
//    world pose continuous frame to frame in the tube's frame (no cut / teleport: the step never jumps), mouse turns kept in the gap, the
//    far flap DOWN until the destination is ready, then walked out into the command tent (released on its floor, no gas at the eye);
//  - back: from the tent into the tube and out of the host doorway into the lobby; the host's memory exactly as left, one tube drawn.
// (CI runtime as the lift's: the atmosphere off and the warm-up's 'view' coverage; one host per test file.)
import {expect, vi} from 'vitest';
import {installHeadless} from './headlessGame';
import {generateNetwork} from '../../src/campaign/network';
import {SURFACE_VERSION, surfacePresent, type SurfaceHost} from '../../src/gen/surface/surfaceRun';
import {connectorToWorld, worldToConnector} from '../../src/gen/surface/connectorShape';
import type {SurfaceConnector} from '../../src/gen/surface/surfaceTypes';
import type {SectionKey} from '../../src/levels/types';

function pickNetwork(host: SurfaceHost): {seed: number; station: string} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === host);
    if (n && surfacePresent(host, n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id};
  }
  throw new Error(`no network with a Surface Run ${host} station`);
}

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

interface Priv { saveSectionMemory(): void; transitGap: boolean; liftBuilt: boolean; render(): boolean; drawFrame(): void; fx: {group: unknown} }

export interface ConnectorWalkReport { marks: string[]; frames: {out: number; back: number}; gapFrames: {out: number; back: number}; maxStep: number; looks: {moved: number; lost: number} }

/** The walk from `host`'s doorway through the tube to the tent and back (the test body of one host's file). */
export async function connectorHostWalk(host: 'office' | 'mall', opts: {extras?: boolean} = {}): Promise<ConnectorWalkReport> {
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
  const report: ConnectorWalkReport = {marks, frames: {out: 0, back: 0}, gapFrames: {out: 0, back: 0}, maxStep: 0, looks: {moved: 0, lost: 0}};
  try {
    const {Game} = await import('../../src/game');
    const {installQaHooks} = await import('../../src/qa');
    const {surfaceConnectorOf} = await import('../../src/world/surface/connectorRuntime');
    const game = new Game(h.canvas, false);
    if (!process.env.SURFACE_LIFT_FULL) game.buildPacing = {sliceMs: 40};
    const G = game as unknown as Priv;
    installQaHooks(game);
    const qa = (globalThis as unknown as {__LL: {surface: {connectorGo(back?: number): boolean; connector(): unknown; access(): {prompt: string | null}}}}).__LL;
    const frameErrors: string[] = [];
    const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
    const states: string[] = [];
    game.stateListeners.push(s => { states.push(s); });
    game.applySettings();
    game.setState('title');
    requestAnimationFrame(loop);
    await game.initRenderer();
    await game.load(() => {});
    vi.spyOn(game.player, 'takeDamage').mockImplementation(() => {});
    const C = surfaceConnectorOf(game)!, P = game.player;
    const tubeViews = () => { let n = 0; game.scene.traverse(o => { if (o.name === 'surface-connector') n++; }); return n; };
    // every drawn frame: the walk's state, the player's world pose (continuity), the sealed draw's leaks
    type Sample = {gap: boolean; phase: string; holding: boolean; flap: [number, number]; ready: boolean; sealed: boolean; x: number; z: number; y: number; yaw: number; state: string; s: number; gas: number; district: boolean};
    const samples: Sample[] = [];
    const look = {armed: false, yaw: 0};
    const render0 = G.render.bind(game);
    G.render = () => {
      if (look.armed) { look.armed = false; if (Math.abs(P.yaw - look.yaw) > 1e-6) report.looks.moved++; else report.looks.lost++; }
      const r = render0(), q = C.qa();
      samples.push({gap: G.transitGap, phase: q.phase, holding: q.holding, flap: q.flap, ready: q.ready, sealed: q.sealed, x: P.x, z: P.z, y: P.y, yaw: P.yaw, state: game.state, s: q.local.s,
        gas: game.gas?.exposure?.c ?? 0, district: !!game.layout?.surface});
      return r;
    };
    const endFrame0 = game.input.endFrame.bind(game.input);
    let turn = 0;
    game.input.endFrame = () => {
      endFrame0();
      if (C.holding && G.transitGap && game.state === 'playing' && samples.length % 12 === 0) { game.input.dx = 30 * (turn++ % 2 ? -1 : 1); look.yaw = P.yaw; look.armed = true; }
    };
    const seal = {draws: 0, leaks: 0, worst: ''};
    const drawFrame0 = G.drawFrame.bind(game);
    G.drawFrame = () => {
      if (C.sealed && seal.draws++ % 6 === 0) {
        const stack: import('three').Object3D[] = [...game.scene.children];
        while (stack.length) {
          const o = stack.pop()!;
          if (o.name === 'surface-connector' || o === game.camera || o === G.fx.group) continue;
          const r = o as import('three').Mesh & {isPoints?: boolean; isLine?: boolean; isSprite?: boolean};
          if ((r.isMesh || r.isPoints || r.isLine || r.isSprite) && o.layers.test(game.camera.layers)) { seal.leaks++; if (!seal.worst) seal.worst = o.name; }
          stack.push(...o.children);
        }
      }
      drawFrame0();
    };
    const diag = () => JSON.stringify({state: game.state, gap: G.transitGap, counts: game.surfaceCrossCounts, walk: C.qa(), compile: game.journeyCompileStats, errors: errors.slice(0, 2), frameErrors: frameErrors.slice(0, 2)}).slice(0, 1800);
    const until = async (f: () => boolean, max = 6000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
    /** Walk (W held) steering along the tube's axis toward tube-local s = `to`, until `stop` (or `frames`). */
    const walkTo = async (to: number, stop: () => boolean, frames = 4000) => {
      game.input.keys.add('KeyW');
      try {
        for (let i = 0; i < frames && !stop(); i++) {
          const r = C.record()!, [s, t] = worldToConnector(r, P.x, P.z), ahead = Math.sign(to - s) * Math.min(1.2, Math.abs(to - s)) || 0.01;
          const [tx, tz] = connectorToWorld(r, s + ahead, t * 0.3);
          if (!G.transitGap) P.yaw = Math.atan2(-(tx - P.x), -(tz - P.z)); // (in the gap: the mouse turns only — the tube is straight)
          await h.waitFrames(1);
        }
      } finally { game.input.keys.delete('KeyW'); }
      await h.waitFrames(3);
    };
    /** One crossing through the tube from this world's walk-in side, out of the far mouth. */
    const crossing = async (label: string, dir: 'out' | 'back') => {
      const n0 = samples.length, done0 = game.surfaceCrossCounts.done, c0 = {...game.lifecycleCounts}, s0 = states.length, key0 = {...game.run.current};
      const r0 = C.record()!, far = r0.end === 'host' ? r0.len + 1.2 : -r0.door.depth - 1.2;
      expect(qa.surface.connectorGo(1.2), `${label}: at the walk-in side`).toBe(true);
      await h.waitFrames(2);
      await walkTo(far, () => game.surfaceCrossCounts.done > done0 && !C.holding);
      expect(game.surfaceCrossCounts.done, `${label}: crossed ${diag()}`).toBe(done0 + 1);
      expect(C.holding, `${label}: walked out of the far mouth`).toBe(false);
      expect(game.run.current).not.toEqual(key0);
      const rs = samples.slice(n0);
      report.frames[dir] = rs.length;
      report.gapFrames[dir] = rs.filter(s => s.gap).length;
      expect(states.slice(s0), `${label}: never a loading state`).toEqual([]);
      expect(game.lifecycleCounts.loading - c0.loading).toBe(0);
      expect(game.lifecycleCounts.warmup - c0.warmup, `${label}: no hidden-canvas warm-up`).toBe(0);
      expect(rs.some(s => s.gap && s.sealed), `${label}: the worlds swapped with the tube sealed`).toBe(true);
      for (const s of rs) if (s.gap) { expect(s.holding, `${label}: held in the tube through the gap`).toBe(true); expect(s.sealed || s.ready, `${label}: sealed until ready`).toBe(true); }
      // the far flap stays down until ready
      const farFlap = r0.end === 'host' ? 1 : 0;
      for (const s of rs) if (!s.ready && s.phase === 'crossing') expect(s.flap[farFlap], `${label}: the far flap down until ready`).toBe(0);
      // continuity: the world pose moves by a step at most between drawn frames (in the gap the tube's frame changes; the step must not)
      let maxStep = 0, prev: Sample | null = null;
      for (const s of rs) {
        if (prev && prev.holding && s.holding) maxStep = Math.max(maxStep, Math.abs(s.s - prev.s));
        else if (prev && !prev.gap && !s.gap) maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.z - prev.z));
        prev = s;
      }
      report.maxStep = Math.max(report.maxStep, maxStep);
      // the tube's air: sealed canvas — no gas at the eye while walking in it (either world), as no gas is drawn in it
      const inTube = rs.filter(s => s.holding && !s.gap && s.s >= 0.2 && s.s <= r0.len - 0.2);
      expect(inTube.length, `${label}: frames in the tube in play`).toBeGreaterThan(0);
      expect(Math.max(...inTube.map(s => s.gas)), `${label}: no gas at the eye in the tube`).toBe(0);
      expect(maxStep, `${label}: no jump in the walk`).toBeLessThan(0.35);
      marks.push(`${label}: ${rs.length} frames (${report.gapFrames[dir]} in the gap), generation ${game.surfaceConnectorGenMs.toFixed(0)} ms, sealed leaks ${seal.leaks}`);
    };

    expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: host}})).toMatchObject({ok: true, saved: true});
    expect(await until(() => game.state === 'playing')).toBe(true);
    mark('new game');
    const acc = game.layout.surfaceAccess!;
    expect(acc, 'the host has its way out').toBeTruthy();
    expect(acc).toMatchObject({v: 2, kind: 'connector'});
    expect(acc.lift, 'no lift for an Office / Mall').toBeUndefined();
    expect(tubeViews(), 'the host\'s tube drawn').toBe(1);
    expect(game.surfaceAnticipationCounts.others, 'the district anticipated behind the loading screen').toBeGreaterThanOrEqual(1);
    await h.waitFrames(30);
    const snap = () => { G.saveSectionMemory(); const m = canon(game.run.peekMemory(hostKey)!) as Record<string, unknown>; return JSON.stringify([m.pickups, m.holders, m.killed, m.cleared]); };
    const host0 = snap();
    await crossing('walk out', 'out');
    mark('out');
    expect(game.run.current).toEqual(surfKey);
    const S = game.layout.surface!, t = S.checkpoint.tent.rect;
    expect(S.portal.kind).toBe('connector');
    expect(P.x > t.x0 && P.x < t.x1 && P.z > t.z0 && P.z < t.z1, 'standing in the tent').toBe(true);
    expect(tubeViews(), 'one tube: the district\'s').toBe(1);
    let maxC = 0;
    for (let i = 0; i < 20; i++) { await h.waitFrames(1); maxC = Math.max(maxC, game.gas.exposure.c); }
    expect(maxC, 'no gas at the eye in the tent').toBe(0);
    expect(game.surfaceAnticipationCounts.hits, 'the district came from the anticipation').toBeGreaterThanOrEqual(1);
    await crossing('walk back', 'back');
    mark('back');
    expect(game.run.current).toEqual(hostKey);
    const rec = game.layout.surfaceAccess!.connector as SurfaceConnector, [s] = worldToConnector(rec, P.x, P.z);
    expect(s, 'back in the lobby / hall, in front of the doorway').toBeLessThan(-rec.door.depth);
    await h.waitFrames(20);
    expect(snap(), 'the host exactly as left').toBe(host0);
    expect(tubeViews(), 'one tube: the host\'s').toBe(1);
    expect(seal.leaks, `nothing else drawn while sealed (${seal.worst})`).toBe(0);
    expect(report.looks.moved, 'mouse turns in the gap').toBeGreaterThan(0);
    expect(report.looks.lost, 'no turn lost in the gap').toBe(0);

    if (opts.extras) {
      const inv0 = JSON.stringify(canon(game.inv.toJSON())), started0 = game.surfaceCrossCounts.started;
      // ---- a REFUSAL at the seam (a participant that cannot come along now: QA injection): no crossing; the prompt says why; walk back out
      const refuse = vi.spyOn(game, 'surfaceCrossRefusal').mockReturnValue({code: 'carrying', text: 'qa: that cannot come along'});
      expect(qa.surface.connectorGo(1.2)).toBe(true);
      await h.waitFrames(2);
      await walkTo(rec.len - 1, () => C.qa().refusal !== null, 900);
      expect(C.qa().refusal, `refused at the seam ${diag()}`).toBe('qa: that cannot come along');
      const hudLine = () => { for (const f of game.promptProviders) { const l = f(); if (l) return l; } return ''; }; // (the HUD's lane prompt, as Game.updateHud reads it)
      expect(hudLine(), 'the HUD line says why').toContain('qa: that cannot come along');
      expect(game.surfaceCrossCounts.started, 'nothing started').toBe(started0);
      expect(C.qa().phase).toBe('idle');
      refuse.mockRestore();
      await walkTo(-rec.door.depth - 1.4, () => !C.holding, 900);
      expect(C.holding, 'walked back out of the tube').toBe(false);
      expect(game.run.current).toEqual(hostKey);
      mark('refused');
      // ---- a destination that cannot be prepared (QA injection) after the old world was left: the loading screen's recovery, back in
      // the lobby in front of the doorway (on the grid, never left in the off-grid tube), everything carried and the host's memory kept
      const rec0 = game.surfaceCrossCounts.recovered;
      const prep = vi.spyOn(G as unknown as {prepareSection(...a: unknown[]): Promise<unknown>}, 'prepareSection').mockRejectedValueOnce(new Error('qa: the street is unreachable'));
      expect(qa.surface.connectorGo(1.2)).toBe(true);
      await h.waitFrames(2);
      game.input.keys.add('KeyW');
      try { expect(await until(() => game.surfaceCrossCounts.started > started0 || game.surfaceCrossCounts.recovered > rec0, 900), `the seam fired ${diag()}`).toBe(true); } finally { game.input.keys.delete('KeyW'); }
      expect(await until(() => game.surfaceCrossCounts.recovered === rec0 + 1 && game.state === 'playing', 12000), `recovered ${diag()}`).toBe(true);
      prep.mockRestore();
      mark('recovered');
      expect(game.run.current).toEqual(hostKey);
      expect(C.qa()).toMatchObject({phase: 'idle', holding: false, held: false});
      expect(tubeViews(), 'one tube after the recovery').toBe(1);
      const rr = game.layout.surfaceAccess!.connector as SurfaceConnector, [sr] = worldToConnector(rr, P.x, P.z);
      expect(sr, 'recovered on the lobby floor, not in the tube').toBeLessThan(-rr.door.depth);
      expect(game.levels.supportIn(P.x, P.z, P.y + 0.05), 'on the host grid\'s floor').not.toBe(null);
      expect(game.levels.grid(rr.level).circleClear(P.x, P.z, 0.25), 'standing clear').toBe(true);
      expect(JSON.stringify(canon(game.inv.toJSON())), 'everything carried kept').toBe(inv0);
      await h.waitFrames(10);
      expect(snap(), 'the host exactly as left after the recovery').toBe(host0);
    }
    expect(errors.filter(e => !/qa: the street is unreachable/.test(e))).toEqual([]);
    expect(frameErrors).toEqual([]);
  } finally {
    h.stop();
    process.stdout.write(`surface-connector-walk ${host}: ${marks.join(' | ')}\n`);
  }
  return report;
}
