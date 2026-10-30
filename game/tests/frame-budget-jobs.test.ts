// Task frame-budget-deferral-20261030 (lane SCHED): the background jobs integrated with the frame-budget scheduler
// (core/frameBudget.ts) on REAL generated levels — the vocal-reach field build (ai/vocalReach.ts) and far chase re-plans
// (ai/pathService.ts): the same final result as the synchronous version, progress under constrained budgets / sustained
// overload / a level-wide alert burst, cancellation on a world change, holds, and the brain's pending re-plan.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {FrameBudget} from '../src/core/frameBudget';
import {VOCAL_REACH_SCHED, VocalReach} from '../src/ai/vocalReach';
import {PathFinder, type PathOpts, type Waypoint} from '../src/gen/grid';
import {PATH_DEFER, PathService, nearPlayerRule} from '../src/ai/pathService';
import {ZombieBrain, hearingMuffle, slabsBetween, type BrainWorld} from '../src/ai/brain';

const layout = LEVELS.office.generate('main', {levelSeed: 0x5ea1e55, startWeapon: 'pistol'});
const office = layout.office!;
const L = levelsOf(layout);
const base = (lv: number) => layout.levels[lv].baseY;

/** The game's frame order on a fake clock: hold, beginFrame, critical update (`spent` ms), then the scheduler. */
function gameLoop(fb: FrameBudget) {
  const clock = {t: 0};
  let raf = 0;
  return {
    clock,
    frame(update: () => void, spent = 0, hold: 'paused' | 'loading' | 'warmup' | null = null): number {
      raf += 1000 / 60;
      clock.t = Math.max(clock.t, raf);
      fb.hold(hold);
      fb.beginFrame(raf, clock.t);
      update();
      clock.t += spent;
      return hold === null ? fb.run() : 0;
    },
  };
}

/** Sample points on every storey around (x, z): the field's answers (Infinity included). */
function probe(r: VocalReach, x: number, z: number): number[] {
  const out: number[] = [];
  for (let lv = 0; lv < layout.levels.length; lv++) for (let dz = -30; dz <= 30; dz += 3) for (let dx = -30; dx <= 30; dx += 3) out.push(r.pathTo(x + dx, base(lv) + 1.2, z + dz));
  return out;
}

describe('vocal reach build on the scheduler', () => {
  const spots = [
    {x: office.start.x, y: base(office.start.level), z: office.start.z},
    ...[3, 6].map(f => { const l = office.stairs.landings.find(q => q.floor === f)!; return {x: l.x + 1.5, y: base(l.levelId), z: l.z}; }),
  ];

  it('builds exactly the synchronous field (same slices, same order) whatever the budget', () => {
    for (const s of spots) {
      const sync = new VocalReach(L);
      sync.update(1, s.x, s.y, s.z);
      let syncUpdates = 1;
      while (sync.building) { sync.update(1 / 60, s.x, s.y, s.z); syncUpdates++; }
      const want = probe(sync, s.x, s.z);
      expect(sync.ready).toBe(true);
      for (const spent of [0, 9, 30]) { // a light frame, a nearly full one, one always over budget
        const fb = new FrameBudget({now: () => loop.clock.t});
        const loop = gameLoop(fb);
        const r = new VocalReach(L);
        r.attachScheduler(fb);
        let frames = 0;
        do { loop.frame(() => r.update(frames ? 1 / 60 : 1, s.x, s.y, s.z), spent); frames++; } while (r.building && frames < 2000);
        expect(r.ready, `spent ${spent}`).toBe(true);
        expect(r.stats.nodes).toBe(sync.stats.nodes);
        expect(probe(r, s.x, s.z)).toEqual(want);
        expect(r.schedStats.chunks).toBe(syncUpdates); // the same number of bounded slices
        expect(r.stats.maxStep).toBeLessThanOrEqual(r.budget);
        expect(r.schedStats.refused).toBe(0);
        if (spent === 0) expect(frames).toBeLessThanOrEqual(Math.ceil(syncUpdates / fb.cfg.maxChunksPerFrame) + 1); // spare time: few frames
        if (spent === 30) {
          // sustained overload: nothing until overdue (~50 ms of play), then one slice per frame — never more, never stalled
          expect(fb.totals.overdueRuns).toBe(syncUpdates);
          expect(frames).toBeLessThanOrEqual(syncUpdates + Math.ceil(VOCAL_REACH_SCHED.maxStaleMs / (1000 / 60)) + 2);
        }
      }
    }
  });

  it('runs no slice while held (menus / loading / warm-up); the previous field keeps answering', () => {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const r = new VocalReach(L);
    r.attachScheduler(fb);
    const s = spots[1];
    loop.frame(() => r.update(1, s.x, s.y, s.z));
    while (r.building) loop.frame(() => r.update(1 / 60, s.x, s.y, s.z));
    const here = r.pathTo(s.x, s.y + 1.2, s.z);
    expect(here).toBeLessThan(1);
    loop.frame(() => r.update(1, s.x + 3, s.y, s.z), 30); // a move: a new build starts, the frame is over budget
    expect(r.building).toBe(true);
    const chunks = r.schedStats.chunks;
    for (const h of ['paused', 'loading', 'warmup'] as const) for (let i = 0; i < 20; i++) loop.frame(() => {}, 0, h);
    expect(r.schedStats.chunks).toBe(chunks);
    expect(r.pathTo(s.x, s.y + 1.2, s.z)).toBe(here); // double buffer: the complete field still answers
    for (let i = 0; i < 400 && r.building; i++) loop.frame(() => r.update(1 / 60, s.x + 3, s.y, s.z));
    expect(r.building).toBe(false);
    expect(r.origin?.x).toBeCloseTo(s.x + 3, 6);
  });

  it('a world change cancels the queued build; the old field never runs as a job again, the new one does', () => {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const old = new VocalReach(L);
    old.attachScheduler(fb);
    const s = spots[0];
    loop.frame(() => old.update(1, s.x, s.y, s.z), 30); // over budget: queued, not run
    expect(fb.has(VOCAL_REACH_SCHED.key)).toBe(true);
    const ran = old.schedStats.chunks;
    fb.bumpGeneration(); // Retry / travel / new game (Game.leaveSection)
    expect(fb.has(VOCAL_REACH_SCHED.key)).toBe(false);
    for (let i = 0; i < 10; i++) loop.frame(() => {});
    expect(old.schedStats.chunks).toBe(ran);
    // the next world's field (attached after the bump) gets its own job
    const next = new VocalReach(L);
    next.attachScheduler(fb);
    loop.frame(() => next.update(1, s.x, s.y, s.z));
    for (let i = 0; i < 200 && next.building; i++) loop.frame(() => next.update(1 / 60, s.x, s.y, s.z));
    expect(next.ready).toBe(true);
    expect(next.schedStats.refused).toBe(0);
    // a stray update of the replaced field is refused by the scheduler ('stale') and falls back to stepping itself
    old.update(1, s.x, s.y, s.z);
    expect(old.schedStats.refused).toBe(1);
    expect(fb.has(VOCAL_REACH_SCHED.key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Far chase re-plans (ai/pathService.ts) — resumable searches on a fork of the finder (gen/grid.ts search())

describe('PathFinder.search: find() as a resumable search', () => {
  it('any chunk size gives exactly find()\'s result; a fork searches independently of its parent', () => {
    const pf = new PathFinder(L), fork = pf.fork();
    const P = {x: office.start.x, y: base(office.start.level), z: office.start.z};
    let total = 0;
    for (const s of layout.zombies.slice(0, 12)) {
      const ay = s.y ?? base(s.level ?? 0), o = {drops: true, ay, by: P.y};
      const want = pf.find(s.x, s.z, P.x, P.z, 0.34, 26000, o);
      for (const chunk of [1, 37, 1000]) {
        const it2 = fork.search(s.x, s.z, P.x, P.z, 0.34, 26000, o, chunk);
        let r = it2.next(), n = 0;
        // the parent answers other searches while the fork's search is suspended
        while (!r.done) { if (n++ % (chunk === 1 ? 20000 : 50) === 0) pf.find(P.x, P.z, s.x, s.z, 0.34, 26000, {ay: P.y, by: ay}); r = it2.next(); }
        expect(r.value).toEqual(want);
        if (chunk === 1000) total += n;
      }
    }
    expect(total).toBeGreaterThan(12); // real searches span several chunks
  });
});

describe('far chase re-plans on the scheduler (path service)', () => {
  const pf = new PathFinder(L), fork = pf.fork();
  const find = (ax: number, az: number, bx: number, bz: number, o: PathOpts) => pf.find(ax, az, bx, bz, 0.34, 26000, o);
  const steps = (ax: number, az: number, bx: number, bz: number, o: PathOpts, chunk: number) => fork.search(ax, az, bx, bz, 0.34, 26000, o, chunk);
  const P = {x: office.start.x, y: base(office.start.level), z: office.start.z};
  /** The game's near rule without a route field: straight 3D distance < midM. */
  const near = (x: number, z: number, y: number | undefined) => Math.hypot(x - P.x, z - P.z, (y ?? P.y) - P.y) < PATH_DEFER.midM;
  const enemies = layout.zombies.map(s => ({x: s.x, z: s.z, y: s.y ?? base(s.level ?? 0), id: {}}))
    .filter(e => !near(e.x, e.z, e.y));
  const opts = (e: {y: number}, owner?: object) => ({drops: true, ay: e.y, by: P.y, ...(owner ? {defer: owner} : {})});
  /** A game loop whose resumable searches cost `chunkMs` per resumed chunk on the fake clock. */
  function rigPaths(chunkMs: number) {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const timed = (ax: number, az: number, bx: number, bz: number, o: PathOpts, chunk: number) => (function* () {
      const it2 = steps(ax, az, bx, bz, o, chunk);
      for (;;) { loop.clock.t += chunkMs; const r = it2.next(); if (r.done) return r.value; yield; }
    })();
    return {fb, loop, ps: new PathService(find, timed, fb, near)};
  }

  it('answers immediately without defer, when near, or without a scheduler — the very search as before', () => {
    const fb = new FrameBudget();
    const ps = new PathService(find, steps, fb, near);
    const e = enemies[0];
    expect(ps.request(e.x, e.z, P.x, P.z, opts(e))).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    const n = {x: P.x + 3, z: P.z, y: P.y};
    expect(ps.request(n.x, n.z, P.x, P.z, opts(n, {}))).toEqual(find(n.x, n.z, P.x, P.z, opts(n)));
    expect(new PathService(find, steps, null, near).request(e.x, e.z, P.x, P.z, opts(e, {}))).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    expect(fb.size).toBe(0);
    expect(ps.stats.immediate).toBe(2);
  });

  it('a far re-plan is searched in ~1 ms chunks across frames and handed over on the next ask: the same path', () => {
    expect(enemies.length).toBeGreaterThan(10);
    const {fb, loop, ps} = rigPaths(1);
    for (const e of enemies.slice(0, 10)) {
      let got: Waypoint[] | null | undefined, asks = 0;
      while (got === undefined && asks < 2000) loop.frame(() => { ps.tick(); got = ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); asks++; }, 9); // 2.7 ms left a frame
      expect(got).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
      expect(fb.lastFrame.ms).toBeLessThanOrEqual(fb.budgetMs - 9 + 1e-9);
    }
    expect(ps.stats).toMatchObject({queued: 10, delivered: 10, searches: 10, reissued: 0, refused: 0});
    expect(ps.stats.maxChunks).toBeGreaterThan(1); // genuinely split
    expect(ps.pending).toBe(0);
  });

  it('a level-wide alert: every far re-plan of ONE frame is spread over frames in bounded chunks (none lost, none twice)', () => {
    const {fb, loop, ps} = rigPaths(1);
    const got = new Map<object, Waypoint[] | null>();
    const perFrameMs: number[] = [];
    let frames = 0;
    while (got.size < enemies.length && frames < 20000) {
      const ms = loop.frame(() => {
        ps.tick();
        for (const e of enemies) if (!got.has(e.id)) { const r = ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); if (r !== undefined) got.set(e.id, r); }
      }, 6); // the frame's own update + render: 6 ms (5.67 ms left)
      perFrameMs.push(ms);
      frames++;
    }
    expect(got.size).toBe(enemies.length); // every enemy got its path
    expect(ps.stats.searches).toBe(enemies.length); // each searched exactly once (coalesced re-asks)
    expect(Math.max(...perFrameMs)).toBeLessThanOrEqual(fb.budgetMs - 6 + 1e-9); // never past the frame budget
    expect(fb.totals.drops).toBe(0);
    for (const e of enemies.slice(0, 6)) expect(got.get(e.id)).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    process.stdout.write(`\n[frame-budget] office alert burst: ${enemies.length} far re-plans (${ps.stats.chunks} chunks) over ${frames} frames, ` +
      `max ${Math.max(...perFrameMs).toFixed(1)} ms of searching per frame (was all ${enemies.length} searches in one frame)\n`);
  });

  it('sustained overload: every frame over budget still advances the line by the bounded forced chunks', () => {
    const {fb, loop, ps} = rigPaths(1.2);
    const few = enemies.slice(0, 4), got = new Map<object, Waypoint[] | null>();
    let frames = 0;
    while (got.size < few.length && frames < 20000) {
      loop.frame(() => { ps.tick(); for (const e of few) if (!got.has(e.id)) { const r = ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); if (r !== undefined) got.set(e.id, r); } }, 40);
      expect(fb.lastFrame.overdueRuns).toBeLessThanOrEqual(fb.cfg.maxOverduePerFrame);
      expect(fb.lastFrame.ms).toBeLessThanOrEqual(fb.cfg.maxOverdueMsPerFrame + 1.2 + 1e-9);
      frames++;
    }
    expect(got.size).toBe(few.length);
    expect(fb.totals.overdueRuns).toBe(ps.stats.chunks); // nothing ever fitted: every chunk was a forced one
  });

  it('coalesces re-asks; skips a search nobody waits for; a request that turns near is answered at once', () => {
    const {fb, loop, ps} = rigPaths(1);
    const [a, b, c] = enemies;
    loop.frame(() => {
      ps.tick();
      expect(ps.request(a.x, a.z, P.x, P.z, opts(a, a.id))).toBeUndefined();
      expect(ps.request(a.x + 0.1, a.z, P.x, P.z, opts(a, a.id))).toBeUndefined(); // the same enemy again: one ticket
      ps.request(b.x, b.z, P.x, P.z, opts(b, b.id));
      ps.request(c.x, c.z, P.x, P.z, opts(c, c.id));
    }, 40); // over budget: nothing searched yet
    expect(ps.stats).toMatchObject({queued: 3, coalesced: 1, chunks: 0});
    expect(fb.size).toBe(1); // ONE job works the whole line
    // b keeps asking, a goes quiet (died / saw the player), c comes near the player — while the frames are still full
    const cn = {x: P.x + 2, z: P.z, y: P.y};
    let bGot: Waypoint[] | null | undefined;
    for (let i = 0; i < 4000 && bGot === undefined; i++) loop.frame(() => {
      ps.tick();
      bGot = ps.request(b.x, b.z, P.x, P.z, opts(b, b.id));
      if (i === 0) expect(ps.request(cn.x, cn.z, P.x, P.z, opts(cn, c.id))).toEqual(find(cn.x, cn.z, P.x, P.z, opts(cn)));
    }, i < 6 ? 40 : 6); // 6 over-budget frames (not yet overdue: ~100 ms of 250), then spare time
    expect(bGot).toEqual(find(b.x, b.z, P.x, P.z, opts(b)));
    expect(ps.stats.skipped).toBe(1); // a: dropped unsearched (or abandoned)
    expect(ps.stats.cancelled).toBe(1); // c: its queued search dropped, answered immediately
    expect(ps.stats.searches).toBe(1); // b only
  });

  it('a world change cancels the queued and the running search; a replaced world\'s service answers immediately', () => {
    const {fb, loop, ps} = rigPaths(1);
    for (let i = 0; i < 3; i++) loop.frame(() => { ps.tick(); for (const e of enemies.slice(0, 5)) ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); }, 9);
    expect(ps.stats.chunks).toBeGreaterThan(0); // one search is running (suspended between chunks)
    expect(ps.pending).toBe(5);
    fb.bumpGeneration(); // Game.leaveSection
    expect(ps.pending).toBe(0);
    expect(ps.stats.cancelled).toBe(5);
    const chunks = ps.stats.chunks;
    for (let i = 0; i < 30; i++) loop.frame(() => {});
    expect(ps.stats.chunks).toBe(chunks);
    const e = enemies[0];
    expect(ps.request(e.x, e.z, P.x, P.z, opts(e, e.id))).toEqual(find(e.x, e.z, P.x, P.z, opts(e))); // no scheduler any more: immediate
  });

  it('the near rule: a few metres, or a short ROUTE (straight line only without a route field)', () => {
    const none = () => null;
    expect(nearPlayerRule(3, () => Infinity)).toBe(true); // touching distance: whatever the (possibly stale) field says
    expect(nearPlayerRule(6, () => 10)).toBe(true);
    expect(nearPlayerRule(6, () => 30)).toBe(false); // a storey up, 30 m by the stairs: far
    expect(nearPlayerRule(6, () => Infinity)).toBe(false);
    expect(nearPlayerRule(30, () => 15)).toBe(true);
    expect(nearPlayerRule(12, none)).toBe(true); // no field yet: the straight line decides
    expect(nearPlayerRule(20, none)).toBe(false);
  });

  it('a real gunshot on office floors: hearers a storey away (near in a line, far by the stairs) go to the background', () => {
    const bases = L.list.map(l => l.baseY);
    let crossStorey = 0, deferred = 0, immediate = 0;
    for (const f of [3, 5, 7]) {
      const l = office.stairs.landings.find(q => q.floor === f)!;
      const Q = {x: l.x + 1.5, y: base(l.levelId), z: l.z};
      const vr = new VocalReach(L);
      vr.update(1, Q.x, Q.y, Q.z);
      while (vr.building) vr.update(1 / 60, Q.x, Q.y, Q.z);
      // Game.alertZombies for a shotgun (noise 38 m): walls / slabs muffle
      const hear = layout.zombies.map(z => ({x: z.x, z: z.z, y: z.y ?? base(z.level ?? 0), id: {}})).filter(b => {
        const d = Math.hypot(b.x - Q.x, b.z - Q.z, b.y - Q.y);
        const los = L.lineOfSight({x: Q.x, y: Q.y + 1.6, z: Q.z}, {x: b.x, y: b.y + 1.5, z: b.z});
        return d <= 38 * hearingMuffle(los, slabsBetween(bases, Q.y, b.y));
      });
      const nearQ = (x: number, z: number, y: number | undefined) => nearPlayerRule(Math.hypot(x - Q.x, z - Q.z, (y ?? Q.y) - Q.y), () => vr.pathTo(x, (y ?? Q.y) + 1.2, z));
      for (const b of hear) if (Math.hypot(b.x - Q.x, b.z - Q.z, b.y - Q.y) < PATH_DEFER.midM && !nearQ(b.x, b.z, b.y)) crossStorey++;
      const fb = new FrameBudget({now: () => loop.clock.t});
      const loop = gameLoop(fb);
      const timed = (ax: number, az: number, bx: number, bz: number, o: PathOpts, chunk: number) => (function* () {
        const it2 = steps(ax, az, bx, bz, o, chunk);
        for (;;) { loop.clock.t += 1; const r = it2.next(); if (r.done) return r.value; yield; }
      })();
      const ps = new PathService(find, timed, fb, nearQ);
      const got = new Map<object, Waypoint[] | null>();
      const o = (b: {y: number}, owner: object) => ({drops: true, ay: b.y, by: Q.y, defer: owner});
      for (let i = 0; i < 3000 && got.size < hear.length; i++) {
        const ms = loop.frame(() => { ps.tick(); for (const b of hear) if (!got.has(b.id)) { const r = ps.request(b.x, b.z, Q.x, Q.z, o(b, b.id)); if (r !== undefined) got.set(b.id, r); } }, 6);
        expect(ms).toBeLessThanOrEqual(fb.budgetMs - 6 + 1e-9);
      }
      expect(got.size).toBe(hear.length);
      for (const b of hear) expect(got.get(b.id)).toEqual(find(b.x, b.z, Q.x, Q.z, {drops: true, ay: b.y, by: Q.y}));
      deferred += ps.stats.searches;
      immediate += ps.stats.immediate;
    }
    process.stdout.write(`\n[frame-budget] office gunshots (floors 3/5/7, 38 m): ${deferred} hearer re-plans in the background (${crossStorey} of them < 16 m in a line but far by the stairs), ${immediate} immediate\n`);
    expect(crossStorey).toBeGreaterThan(0);
    expect(deferred).toBeGreaterThan(immediate);
  });

  it('the brain keeps chasing while its re-plan is queued — standing, facing the goal, never dropping into search — and draws the same random numbers', () => {
    const route: Waypoint[] = [[10, 0], [20, 0]];
    const run = (deferring: boolean) => {
      const fb = new FrameBudget({now: () => loop.clock.t});
      const loop = gameLoop(fb);
      const slow = function* (): Generator<void, Waypoint[] | null, void> { yield; yield; return route.map(p => [...p] as Waypoint); }; // 3 chunks
      const ps = new PathService(() => route.map(p => [...p] as Waypoint), deferring ? slow : null, deferring ? fb : null, () => false);
      let draws = 0;
      const w: BrainWorld = {px: 40, pz: 0, playerAlive: true, los: () => false, walkClear: () => false,
        findPath: (ax, az, bx, bz, o) => ps.request(ax, az, bx, bz, o), randomNear: () => null, rand: () => { draws++; return 0.5; }};
      const brain = new ZombieBrain('shambler', 0, 0, 0);
      (brain as unknown as {path: Waypoint[]}).path = [[-5, 3]]; // an old wander path
      brain.hear(40, 0, 100); // a far gunshot: chase, re-plan now
      const states: string[] = [], speeds: number[] = [], anims: string[] = [], drawsAt: number[] = [];
      for (let i = 0; i < 4; i++) loop.frame(() => { ps.tick(); const out = brain.update(1 / 60, w); states.push(brain.state); speeds.push(out.speed); anims.push(out.anim); drawsAt.push(draws); }, 2);
      return {states, speeds, anims, drawsAt, path: (brain as unknown as {path: Waypoint[]}).path};
    };
    const now = run(false), later = run(true);
    expect(later.states).toEqual(['chase', 'chase', 'chase', 'chase']); // pending: still chasing (never 'search')
    expect(now.states).toEqual(later.states);
    expect(later.speeds[0]).toBe(0); // waiting for its route: no running on the spot, not along the old wander path …
    expect(later.anims[0]).toBe('Idle');
    expect(later.speeds.at(-1)).toBe(now.speeds.at(-1)); // … then moves exactly as the immediate one
    expect(later.drawsAt[0]).toBe(now.drawsAt[0]); // the repath timer is drawn at the first ask, as before
    expect(later.drawsAt.at(-1)).toBe(now.drawsAt.at(-1));
    expect(later.path).toEqual(now.path);
  });
});
