// Task track3-eaton-centre-20261031 (lane HORDE, atrium AI): the open-atrium chase relief (ai/chaseShare.ts) — gated to layouts with
// `mall`. Covers: the gate (no atrium = the established brain requests / path service, old levels have no `mall`), near AI still
// immediate, the per-frame synchronous chase cap (spread, never dropped), the seen hand-over slack, the re-plan throttle, straight
// local targets, the cross-void sighting spike scenario (synthetic wide ring: chasers on ring 1 seeing the player in the pit) and a
// before / after measurement on the generated mall (expansion-based bounds; wall-clock numbers are reported, not asserted).

import {describe, expect, it} from 'vitest';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {PathService, type FindPath} from '../src/ai/pathService';
import {FrameBudget} from '../src/core/frameBudget';
import {ATRIUM_CHASE, ChaseShare, atriumNearRule, atriumPathOptions, searchExpand} from '../src/ai/chaseShare';
import type {PathOpts, Waypoint} from '../src/gen/grid';
import {PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {ringMallFixture, ringY} from './helpers/hordeMallFixture';
import {mallAiSim, summarize} from './helpers/mallAiSim';
import type {StationLayout} from '../src/gen/stationTypes';

const BENCH = !!process.env.LL_BENCH;

type Req = {ax: number; az: number; bx: number; bz: number; opts: Record<string, unknown> | undefined};

/** A fake brain world: straight one-waypoint paths, every request recorded. */
function fakeWorld(o: {atrium?: boolean; player: {x: number; y: number; z: number}; walkClear?: boolean; near?: [number, number, number]}): {w: BrainWorld; reqs: Req[]} {
  const reqs: Req[] = [];
  const w: BrainWorld = {
    px: o.player.x, pz: o.player.z, py: o.player.y, playerAlive: true,
    los: () => true,
    walkClear: () => o.walkClear ?? false,
    findPath: (ax, az, bx, bz, opts) => { reqs.push({ax, az, bx, bz, opts: opts as Record<string, unknown> | undefined}); return [[bx, bz, undefined, opts?.by ?? 0]]; },
    randomNear: () => o.near ?? [3, 3, 0],
    rand: () => 0.5,
    ...(o.atrium ? {atrium: true} : {}),
  };
  return {w, reqs};
}

describe('the gate: no atrium = exactly the established requests', () => {
  it('a seen player on another storey: no atrium -> immediate request (no defer); atrium -> deferrable + seen; same storey -> immediate either way', () => {
    for (const atrium of [false, true]) {
      const b = new ZombieBrain('shambler', 10, 10, 0);
      b.y = 5;
      const {w, reqs} = fakeWorld({atrium, player: {x: 10, y: 0, z: 22}}); // 12 m away, 5 m below, in sight
      for (let i = 0; i < 3; i++) b.update(1 / 60, w);
      const chase = reqs.filter(r => r.opts?.drops);
      expect(chase.length, `atrium ${atrium}`).toBeGreaterThan(0);
      if (atrium) { expect(chase[0].opts!.defer).toBe(b); expect(chase[0].opts!.seen).toBe(true); }
      else expect(chase[0].opts).toEqual({drops: true, ay: 5, by: 0}); // the pre-mall object, key for key
      // same storey: never offered to the deferral
      const c = new ZombieBrain('shambler', 10, 10, 0);
      c.y = 5;
      const s = fakeWorld({atrium, player: {x: 10, y: 5, z: 22}});
      for (let i = 0; i < 3; i++) c.update(1 / 60, s.w);
      const sc = s.reqs.filter(r => r.opts?.drops);
      expect(sc.length).toBeGreaterThan(0);
      expect(sc[0].opts!.defer).toBeUndefined();
      expect(sc[0].opts!.seen).toBeUndefined();
    }
  });

  it('a wander target: no atrium -> the plain search object; atrium -> a straight walk needs no search, else a bounded local search', () => {
    const run = (atrium: boolean, walkClear: boolean) => {
      const b = new ZombieBrain('shambler', 0, 0, 0);
      const {w, reqs} = fakeWorld({atrium, walkClear, player: {x: 200, y: 0, z: 200}, near: [3, 2, 0]});
      (w as {playerAlive: boolean}).playerAlive = false;
      for (let i = 0; i < 60 * 6 && b.state === 'idle'; i++) b.update(1 / 60, w);
      return {state: b.state, reqs};
    };
    const plain = run(false, true);
    expect(plain.state).toBe('wander');
    expect(plain.reqs).toHaveLength(1);
    expect(plain.reqs[0].opts).toEqual({ay: 0, by: 0});
    const straight = run(true, true);
    expect(straight.state).toBe('wander');
    expect(straight.reqs).toHaveLength(0); // walked straight: no search at all
    const bent = run(true, false);
    expect(bent.reqs).toHaveLength(1);
    expect(bent.reqs[0].opts).toEqual({ay: 0, by: 0, local: true});
    expect(searchExpand(bent.reqs[0].opts as {local?: boolean})).toBe(ATRIUM_CHASE.localExpand);
    expect(searchExpand({})).toBe(26000);
  });

  it('the re-plan throttle only acts with the atrium flag (a chase toward a goal that does not move)', () => {
    const run = (atrium: boolean) => {
      const b = new ZombieBrain('shambler', 0, 0, 0);
      const {w, reqs} = fakeWorld({atrium, player: {x: 30, y: 0, z: 30}});
      (w as {los: BrainWorld['los']}).los = () => false; // never sees: chases the heard spot
      b.hear(30, 30, 100, 0);
      for (let i = 0; i < 60 * 4; i++) b.update(1 / 60, w);
      return {throttled: b.throttled, chase: reqs.filter(r => r.opts?.drops).length};
    };
    const off = run(false), on = run(true);
    expect(off.throttled).toBe(0);
    expect(on.throttled).toBeGreaterThan(0);
    expect(on.chase).toBeLessThan(off.chase);
  });

  it('the path service without atrium options: no cap, no extra stats; the Subway / Office layouts have no `mall` (the game never turns it on)', () => {
    const fb = new FrameBudget({now: () => 0});
    const find: FindPath = (_ax, _az, bx, bz) => [[bx, bz]];
    const ps = new PathService(find, null, fb, () => true);
    ps.tick();
    let immediate = 0;
    for (let i = 0; i < 20; i++) if (ps.request(0, 0, i, 0, {drops: true, defer: {}}) !== undefined) immediate++;
    expect(immediate).toBe(20);
    expect('held' in ps.stats).toBe(false);
    for (const id of ['subway', 'office'] as const) expect(LEVELS[id].generate('main', {levelSeed: 0x1d, startWeapon: 'pistol'}).mall).toBeUndefined();
  });
});

describe('atrium path service: near AI immediate, bursts spread, never dropped', () => {
  const setup = (critical: (x: number) => boolean, near = () => true) => {
    const clock = {t: 0};
    const fb = new FrameBudget({now: () => clock.t});
    let searched = 0;
    const find: FindPath = (_ax, _az, bx, bz) => { searched++; return [[bx, bz]]; };
    const ps = new PathService(find, null, fb, near, atriumPathOptions(x => critical(x), near));
    return {ps, fb, searched: () => searched};
  };

  it('a burst of 20 deferrable chase re-plans runs at most syncCap per frame (held enemies re-ask first), every one served, none dropped', () => {
    const {ps, searched} = setup(() => false);
    const owners = Array.from({length: 20}, () => ({}));
    const served = new Set<object>();
    const perFrame: number[] = [];
    for (let f = 0; f < 12 && served.size < 20; f++) {
      ps.tick();
      const before = searched();
      for (const o of owners) {
        if (served.has(o)) continue;
        const r = ps.request(5, 0, 10, 0, {drops: true, defer: o});
        if (r !== undefined) served.add(o);
      }
      perFrame.push(searched() - before);
    }
    expect(served.size).toBe(20);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(ATRIUM_CHASE.syncCap);
    expect(perFrame.length).toBeLessThanOrEqual(Math.ceil(20 / ATRIUM_CHASE.syncCap) + 1);
    expect(ps.stats.held).toBeGreaterThan(0);
  });

  it('critical (< 4 m) requests and requests that cannot be deferred are never held', () => {
    const {ps} = setup(x => x < 4);
    ps.tick();
    for (let i = 0; i < ATRIUM_CHASE.syncCap; i++) expect(ps.request(10, 0, 20, 0, {drops: true, defer: {}})).toBeDefined(); // fills the cap
    let held = 0;
    for (let i = 0; i < 8; i++) if (ps.request(10, 0, 20, 0, {drops: true, defer: {}}) === undefined) held++;
    expect(held).toBe(8); // non-critical deferrable chase searches: held past the cap (asked again next frame)
    for (let i = 0; i < 8; i++) expect(ps.request(1, 0, 20, 0, {drops: true, defer: {}})).toBeDefined(); // critical: immediate
    for (let i = 0; i < 8; i++) expect(ps.request(10, 0, 20, 0, {drops: true})).toBeDefined(); // no defer (a seen player on its storey): immediate
    for (let i = 0; i < 8; i++) expect(ps.request(10, 0, 20, 0, {defer: {}})).toBeDefined(); // not a chase search: immediate
  });

  it('the atrium near rule: across storeys an unknown route is not near (no straight-line fallback); same storey = the ordinary rule', async () => {
    const {nearPlayerRule} = await import('../src/ai/pathService');
    expect(nearPlayerRule(12, () => null)).toBe(true); // the ordinary rule's straight-line fallback (unchanged)
    expect(atriumNearRule(12, 0.2, () => null)).toBe(true); // same storey in the atrium: that same rule
    expect(atriumNearRule(12, -5, () => null)).toBe(false); // across the void, route unknown: NOT near
    expect(atriumNearRule(12, -5, () => 60)).toBe(false);
    expect(atriumNearRule(12, -2.5, () => 14)).toBe(true); // a stair just below: a short known route
    expect(atriumNearRule(3, -5, () => null)).toBe(true); // within 4 m
    // the atrium service asks the atrium rule for deferrable requests
    const clock = {t: 0};
    const fb = new FrameBudget({now: () => clock.t});
    const ps = new PathService((_ax, _az, bx, bz) => [[bx, bz]], null, fb, () => true, atriumPathOptions(() => false, () => false));
    ps.tick();
    expect(ps.request(0, 0, 9, 0, {drops: true, defer: {}, seen: true})).toBeUndefined(); // far by the atrium rule: queued
    expect(ps.request(0, 0, 9, 0, {drops: true})).toBeDefined(); // not deferrable: immediate
  });

  it('a deferred SEEN re-plan is handed over although the player moved 3 m meanwhile (an unseen one is searched again)', () => {
    for (const seen of [true, false]) {
      const clock = {t: 0};
      const fb = new FrameBudget({now: () => clock.t});
      const find: FindPath = (_ax, _az, bx, bz) => [[bx, bz]];
      const ps = new PathService(find, null, fb, () => false, atriumPathOptions(() => false, () => false));
      let raf = 0;
      const frame = (ask: () => Waypoint[] | null | undefined) => { raf += 1000 / 60; clock.t = raf; fb.hold(null); fb.beginFrame(raf, clock.t); ps.tick(); const r = ask(); fb.run(); return r; };
      const owner = {}, extra = seen ? {seen: true} : {};
      expect(frame(() => ps.request(0, 0, 20, 0, {drops: true, defer: owner, ...extra}))).toBeUndefined(); // queued, searched in this frame's spare time
      const got = frame(() => ps.request(0, 0, 23, 0, {drops: true, defer: owner, ...extra})); // the player moved 3 m
      if (seen) { expect(got).toEqual([[20, 0]]); expect(ps.stats.delivered).toBe(1); }
      else { expect(got).toBeUndefined(); expect(ps.stats.reissued).toBe(1); }
    }
  });
});

describe('cross-void sighting: chasers on a ring seeing the player in the pit (wide synthetic ring)', () => {
  it('no long cross-storey search runs synchronously any more; the chasers still close in by the stairs', () => {
    const run = (atrium: boolean) => {
      const fx = ringMallFixture({storeys: 2, wide: true});
      // 12 enemies along ring 1's north gallery by the void edge, aware, looking at the player 12 m away and 5 m below
      const player = {x: 60, y: 0, z: 24, alive: true};
      for (let k = 0; k < 12; k++) fx.layout.zombies.push({x: 52.5 + k * 1.4, z: 12, yaw: 0, type: k % 3 ? 'shambler' : 'coated', area: 0, level: 1, y: ringY(1)});
      const sim = mallAiSim(fx.layout, {atrium, player});
      for (const b of sim.brains) { b.aware = true; b.yaw = Math.atan2(player.x - b.x, player.z - b.z); }
      const pf = new PathFinder(levelsOf(fx.layout));
      const route = () => {
        let sum = 0, n = 0;
        for (const b of sim.brains) {
          const p = pf.find(b.x, b.z, player.x, player.z, 0.34, 26000, {drops: true, ay: b.y, by: 0});
          if (!p) continue;
          let len = 0, px = b.x, pz = b.z;
          for (const w of p) { len += Math.hypot(w[0] - px, w[1] - pz); px = w[0]; pz = w[1]; }
          sum += len; n++;
        }
        return sum / Math.max(1, n);
      };
      const r0 = route();
      let chasing = 0, samples = 0;
      for (let f = 0; f < 60 * 8; f++) {
        sim.step();
        if (f % 30 === 0) { samples += sim.brains.length; chasing += sim.brains.filter(b => b.state === 'chase' || b.state === 'attack').length; }
      }
      const s = summarize(sim, 0);
      return {s, closed: r0 - route(), chasing: chasing / samples, delivered: sim.ps.stats.delivered, queued: sim.ps.stats.queued, hits: sim.share?.hits ?? 0, throttled: sim.brains.reduce((n, b) => n + b.throttled, 0)};
    };
    const off = run(false), on = run(true);
    const line = (n: string, r: typeof on) => `${n}: AI ms med ${r.s.med.toFixed(2)} p95 ${r.s.p95.toFixed(2)} max ${r.s.max.toFixed(1)} (+ background chunks max ${r.s.deferredMax.toFixed(1)}, frame AI+background max ${r.s.totalMax.toFixed(1)}); sync searches ${r.s.searches} (max ${r.s.searchesMaxPerFrame}/frame), sync expansions max/frame ${r.s.expMaxPerFrame} total ${r.s.expTotal}; deferred queued ${r.queued} delivered ${r.delivered}; shared ${r.hits}; throttled ${r.throttled}; route closed ${r.closed.toFixed(1)} m; chasing ${(r.chasing * 100).toFixed(0)} %`;
    console.info(`[atrium cross-void] 12 chasers 12 m above the player, 8 s\n  before ${line('', off)}\n  after  ${line('', on)}`);
    expect(off.s.expMaxPerFrame).toBeGreaterThan(5000); // the scenario reproduces the long synchronous cross-storey searches
    expect(on.s.expMaxPerFrame).toBeLessThanOrEqual(3000); // ... and they no longer run synchronously
    expect(on.s.expTotal).toBeLessThan(off.s.expTotal * 0.25);
    expect(on.delivered).toBeGreaterThan(0); // the deferred routes arrive
    expect(off.closed).toBeGreaterThan(4);
    expect(on.closed).toBeGreaterThan(off.closed * 0.6); // and the crowd still heads for the stairs
    expect(on.chasing).toBeGreaterThan(0.8); // reacting the whole time (chase / attack), never dropped back to idle
  });
});

describe('the generated mall: before / after (update-profile style measurement)', () => {
  const has = (LEVEL_IDS as readonly string[]).includes('mall');
  (has ? it : it.skip)('the atrium relief removes the large synchronous searches and halves the synchronous search work', () => {
    const layout = (LEVELS as unknown as Record<string, {generate(s: string, c: object): StationLayout}>).mall.generate('main', {levelSeed: 32451, startWeapon: 'pistol'});
    const v = layout.mall!.void.bounds, cx = (v.x0 + v.x1) / 2, cz = (v.z0 + v.z1) / 2;
    const n1 = layout.mall!.patrol.filter(p => p.level === 1).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))[0];
    const spots: [string, {x: number; y: number; z: number}][] = [['pit start', {x: layout.playerSpawn.x, y: 0, z: layout.playerSpawn.z}], ['ring 1 void edge', {x: n1.x, y: layout.levels[1].baseY, z: n1.z}]];
    const SECS = BENCH ? 60 : 30;
    const lines: string[] = [];
    for (const [name, at] of spots) {
      const r = [false, true].map(atrium => { const sim = mallAiSim(layout, {atrium, player: {...at, alive: true}}); sim.run(SECS); return {s: summarize(sim, 60), held: sim.ps.stats.held ?? 0, hits: sim.share?.hits ?? 0, throttled: sim.brains.reduce((n, b) => n + b.throttled, 0),
        chaseMax: sim.recs.reduce((m, x) => (x.cls === 'chase-seen' || x.cls === 'chase-unseen' ? Math.max(m, x.expanded) : m), 0)}; });
      const [off, on] = r;
      for (const [k, x] of [['before', off], ['after ', on]] as const) {
        lines.push(`${name} ${k}: AI ms med ${x.s.med.toFixed(2)} p95 ${x.s.p95.toFixed(2)} p99 ${x.s.p99.toFixed(2)} max ${x.s.max.toFixed(1)} (background chunks max ${x.s.deferredMax.toFixed(1)}, AI+background max ${x.s.totalMax.toFixed(1)}); frames > 10 ms ${x.s.frames10ms}; sync searches ${x.s.searches} (max ${x.s.searchesMaxPerFrame}/frame, ${x.s.searchMsMaxPerFrame.toFixed(1)} ms); expansions per search p99 ${x.s.expP99} max ${x.s.expMax}, max/frame ${x.s.expMaxPerFrame}; shared ${x.hits} throttled ${x.throttled} held ${x.held}; top ${x.s.top.slice(0, 2).join(' | ')}`);
      }
      // (task mall-playtest-revision-20261031, lane PROFILES: the compact mall's re-proportioned population (~37-50 enemies, was ~100)
      // leaves the largest search at the pit start equal with and without the relief — never larger with it; the per-frame bound and
      // the halved synchronous search work below still hold)
      // (task mall-lingerie-store-polish-20261103-045922: the relief governs the CHASE searches, so the "never larger with it" bound is on
      // those; the plain wander / patrol probes follow the AI random sequence, which any layout change shifts. Seed 32451's ring-1 run
      // drew one wander probe at an unreachable target (null after 1201 expansions) with the relief, 1025 without; chase max 133 / 133.)
      expect(on.chaseMax).toBeLessThanOrEqual(off.chaseMax);
      expect(on.s.expMaxPerFrame).toBeLessThanOrEqual(3000);
      expect(on.s.searches).toBeLessThan(off.s.searches * 0.7);
    }
    console.info(`[atrium mall] seed 32451, ${SECS} s per run (${layout.zombies.length} enemies incl. hordes)\n  ${lines.join('\n  ')}`);
  });
});

void ({} as PathOpts);
void ChaseShare;
