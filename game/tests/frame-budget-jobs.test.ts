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
import {PATH_DEFER, PathService} from '../src/ai/pathService';
import {ZombieBrain, type BrainWorld} from '../src/ai/brain';

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
// Far chase re-plans (ai/pathService.ts)

describe('far chase re-plans on the scheduler (path service)', () => {
  const pf = new PathFinder(L);
  const find = (ax: number, az: number, bx: number, bz: number, o: PathOpts) => pf.find(ax, az, bx, bz, 0.34, 26000, o);
  const P = {x: office.start.x, y: base(office.start.level), z: office.start.z};
  /** The game's near rule without a route field: straight 3D distance < midM. */
  const near = (x: number, z: number, y: number | undefined) => Math.hypot(x - P.x, z - P.z, (y ?? P.y) - P.y) < PATH_DEFER.midM;
  const enemies = layout.zombies.map(s => ({x: s.x, z: s.z, y: s.y ?? base(s.level ?? 0), id: {}}))
    .filter(e => !near(e.x, e.z, e.y));
  const opts = (e: {y: number}, owner?: object) => ({drops: true, ay: e.y, by: P.y, ...(owner ? {defer: owner} : {})});

  it('answers immediately without defer, when near, or without a scheduler — the very search as before', () => {
    const fb = new FrameBudget();
    const ps = new PathService(find, fb, near);
    const e = enemies[0];
    expect(ps.request(e.x, e.z, P.x, P.z, opts(e))).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    const n = {x: P.x + 3, z: P.z, y: P.y};
    expect(ps.request(n.x, n.z, P.x, P.z, opts(n, {}))).toEqual(find(n.x, n.z, P.x, P.z, opts(n)));
    expect(new PathService(find, null, near).request(e.x, e.z, P.x, P.z, opts(e, {}))).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    expect(fb.size).toBe(0);
  });

  it('a far re-plan is queued, searched as one background chunk and handed over on the next ask: the same path', () => {
    expect(enemies.length).toBeGreaterThan(10);
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const ps = new PathService(find, fb, near);
    let checked = 0;
    for (const e of enemies.slice(0, 12)) {
      loop.frame(() => { ps.tick(); expect(ps.request(e.x, e.z, P.x, P.z, opts(e, e.id))).toBeUndefined(); });
      expect(ps.stats.searches).toBe(++checked);
      let got: Waypoint[] | null | undefined;
      loop.frame(() => { ps.tick(); got = ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); });
      expect(got).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    }
    expect(ps.stats).toMatchObject({queued: 12, delivered: 12, reissued: 0, refused: 0});
    expect(ps.pending).toBe(0);
  });

  it('a level-wide alert: every far re-plan in ONE frame becomes a few searches per frame (budget, overdue cap), none lost', () => {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    // each search costs 6 ms on the fake clock (MEASURE: office chase p95 7.3 ms; cross-storey more before its fix)
    const costly = (ax: number, az: number, bx: number, bz: number, o: PathOpts) => { loop.clock.t += 6; return find(ax, az, bx, bz, o); };
    const ps = new PathService(costly, fb, near);
    const got = new Map<object, Waypoint[] | null>();
    const perFrame: number[] = [];
    let frames = 0;
    while (got.size < enemies.length && frames < 400) {
      const before = ps.stats.searches;
      loop.frame(() => {
        ps.tick();
        for (const e of enemies) if (!got.has(e.id)) { const r = ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); if (r !== undefined) got.set(e.id, r); }
      }, 6); // the frame's own update + render: 6 ms
      perFrame.push(ps.stats.searches - before);
      frames++;
    }
    expect(got.size).toBe(enemies.length); // every enemy got its path
    expect(ps.stats.searches).toBe(enemies.length); // each searched exactly once (coalesced re-asks)
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(2); // never a burst: one in budget, or the bounded overdue run(s)
    expect(fb.totals.drops).toBe(0);
    const staleFrames = Math.ceil(PATH_DEFER.maxStaleMs / (1000 / 60));
    expect(frames).toBeLessThanOrEqual(staleFrames + enemies.length + 2);
    for (const e of enemies.slice(0, 6)) expect(got.get(e.id)).toEqual(find(e.x, e.z, P.x, P.z, opts(e)));
    process.stdout.write(`\n[frame-budget] office alert burst: ${enemies.length} far re-plans over ${frames} frames, max ${Math.max(...perFrame)} searches / frame (was ${enemies.length} in one frame)\n`);
  });

  it('coalesces re-asks; skips a search nobody waits for; a request that turns near is answered at once (queued one cancelled)', () => {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const ps = new PathService(find, fb, near);
    const [a, b, c] = enemies;
    loop.frame(() => {
      ps.tick();
      expect(ps.request(a.x, a.z, P.x, P.z, opts(a, a.id))).toBeUndefined();
      expect(ps.request(a.x + 0.1, a.z, P.x, P.z, opts(a, a.id))).toBeUndefined(); // the same enemy again: one ticket
      ps.request(b.x, b.z, P.x, P.z, opts(b, b.id));
      ps.request(c.x, c.z, P.x, P.z, opts(c, c.id));
    }, 40); // over budget: nothing searched yet
    expect(ps.stats).toMatchObject({queued: 3, coalesced: 1, searches: 0});
    expect(fb.size).toBe(3);
    // b keeps asking, a goes quiet (died / saw the player), c comes near the player
    const cn = {x: P.x + 2, z: P.z, y: P.y};
    for (let i = 0; i < 30 && fb.size > 0; i++) loop.frame(() => {
      ps.tick();
      ps.request(b.x, b.z, P.x, P.z, opts(b, b.id));
      if (i === 0) expect(ps.request(cn.x, cn.z, P.x, P.z, opts(cn, c.id))).toEqual(find(cn.x, cn.z, P.x, P.z, opts(cn)));
    }, 40);
    expect(ps.stats.skipped).toBe(1); // a: not searched
    expect(ps.stats.cancelled).toBe(1); // c: its queued search dropped, answered immediately
    expect(ps.stats.searches).toBe(1); // b only
  });

  it('a world change cancels every queued search; a replaced world\'s service answers immediately', () => {
    const fb = new FrameBudget({now: () => loop.clock.t});
    const loop = gameLoop(fb);
    const ps = new PathService(find, fb, near);
    loop.frame(() => { ps.tick(); for (const e of enemies.slice(0, 5)) ps.request(e.x, e.z, P.x, P.z, opts(e, e.id)); }, 40);
    expect(ps.pending).toBe(5);
    fb.bumpGeneration(); // Game.leaveSection
    expect(ps.pending).toBe(0);
    expect(ps.stats.cancelled).toBe(5);
    for (let i = 0; i < 30; i++) loop.frame(() => {});
    expect(ps.stats.searches).toBe(0);
    const e = enemies[0];
    expect(ps.request(e.x, e.z, P.x, P.z, opts(e, e.id))).toEqual(find(e.x, e.z, P.x, P.z, opts(e))); // 'stale': immediate
    expect(ps.stats.refused).toBe(1);
  });

  it('the brain keeps chasing while its re-plan is queued (no drop into search) and draws the same random numbers', () => {
    const route: Waypoint[] = [[10, 0], [20, 0]];
    const run = (deferring: boolean) => {
      const fb = new FrameBudget({now: () => loop.clock.t});
      const loop = gameLoop(fb);
      const ps = new PathService(() => route.map(p => [...p] as Waypoint), deferring ? fb : null, () => false);
      let draws = 0;
      const w: BrainWorld = {px: 40, pz: 0, playerAlive: true, los: () => false, walkClear: () => false,
        findPath: (ax, az, bx, bz, o) => ps.request(ax, az, bx, bz, o), randomNear: () => null, rand: () => { draws++; return 0.5; }};
      const brain = new ZombieBrain('shambler', 0, 0, 0);
      brain.hear(40, 0, 100); // a far gunshot: chase, re-plan now
      const states: string[] = [], speeds: number[] = [];
      for (let i = 0; i < 4; i++) loop.frame(() => { ps.tick(); const out = brain.update(1 / 60, w); states.push(brain.state); speeds.push(out.speed); });
      return {states, speeds, draws, path: (brain as unknown as {path: Waypoint[]}).path};
    };
    const now = run(false), later = run(true);
    expect(later.states).toEqual(['chase', 'chase', 'chase', 'chase']); // pending: still chasing (never 'search')
    expect(now.states).toEqual(later.states);
    expect(later.speeds[0]).toBe(0); // the first frame waits for its route (no path yet) …
    expect(later.speeds.slice(1)).toEqual(now.speeds.slice(1)); // … then moves exactly as the immediate one
    expect(later.draws).toBe(now.draws); // the repath timer drew its random number once the path arrived
    expect(later.path).toEqual(now.path);
  });
});
