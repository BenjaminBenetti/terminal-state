// Task frame-budget-deferral-20261030 (lane SCHED), user feedback #11 ("background updates … spread among the less intense
// frames"). Lane MEASURE found the dominant CPU spikes in PathFinder.find (A* + string pulling): a cross-storey chase re-plan
// costs several to tens of ms, and one gunshot that alerts a whole level makes EVERY hearing enemy re-plan in the same frame
// (repathT = 0), their re-plan timers then staying phase-locked (clusters of 4-7 searches in later frames).
//
// The path service sits between the brains and the game's PathFinder (Game.brainWorld findPath):
//  - IMMEDIATE (exactly as before): every request without `defer`, i.e. every one except a chase re-plan of an enemy that
//    does NOT see the player (ai/brain.ts); and every deferrable one from an enemy NEAR the player (nearPlayerRule): closer
//    than `nearM` in a straight line, or with a navigable route <= `nearRouteM` from the player (the vocal-reach route field
//    the game already keeps, ai/vocalReach.ts; without one: straight line < `midM`). The ROUTE matters: in the office most
//    hearers of a gunshot are a storey above / below — a few metres in a straight line, 20-40 m by the stairs — and their
//    searches are the 12-33 ms ones (measured: tests/frame-budget-jobs.test.ts). Nearby AI response is never deferred; an
//    enemy that comes near or into sight gets its answer at once (its queued search is dropped).
//  - DEFERRED: a far, not-in-sight chase re-plan becomes a ticket (one per enemy) in a FIFO line. ONE scheduler job
//    (core/frameBudget.ts) works the line: each chunk resumes the current search for `chunkUnits` work units on a fork() of
//    the game's PathFinder (gen/grid.ts search(): the same search as find(), suspended between chunks with its state in the
//    fork's own buffers) — so a 10-40 ms search becomes ~1 ms chunks run in spare frame time; when the job is overdue
//    (`maxStaleMs` of play), at most the scheduler's forced-chunk cap per frame. Re-asks while queued coalesce (newest start /
//    goal); the brain keeps following its current path meanwhile (or stands facing the goal) and asks again each frame; the
//    finished path is handed over on the next ask when it still fits (goal within `goalSlack`, start within `startSlack`,
//    searched at most `idleFrames` frames ago; else it is searched again). Results arrive on different frames, so the
//    re-plan timers no longer stay phase-locked. The brain draws its re-plan timer at the first ask, as before.
//  - Bounds / truthfulness: at most one ticket per enemy, one search in progress, one scheduler job; a search whose enemy
//    stopped asking for `idleFrames` (died, saw the player, came near) is skipped / abandoned; a scheduler refusal (queue full
//    / old world) answers immediately instead (counted, never silent); a world change (scheduler generation bump) cancels
//    everything. `stats` + the scheduler's diagnostics show it (`__LL.pathService()`, `__LL.frameBudget()`).
//  Cost model: total search work is unchanged (MEASURE's string-pulling fix reduced it); under sustained overload the far
//  re-plans of a level-wide alert complete over more frames — bounded per frame, never a freeze.

import type {PathOpts, Waypoint} from '../gen/grid';
import type {CancelReason, FrameScheduler} from '../core/frameBudget';

/** Deferral policy (see the file comment). Lengths in m, times in ms of play. */
export const PATH_DEFER = {
  /** Always immediate this close to the player (3D straight line), whatever the route field says (it may be ~1 s old). */
  nearM: 4,
  /** Immediate with a navigable route from the player up to this (>= 6 s away at a shambler's 2.55 m/s chase speed). */
  nearRouteM: 16,
  /** Without a route field (not built yet, dropped after a teleport): immediate below this straight distance. */
  midM: 16,
  /** Scheduler job parameters (one job per service: it works the line). */
  kind: 'path.far.chunk',
  priority: 1,
  maxStaleMs: 250,
  /** First chunk estimate before anything was measured (ms). */
  initialEstimateMs: 1.5,
  /**
   * Work units per chunk (gen/grid.ts search(): 1 per A* heap pop, PULL_PROBE_UNITS per string-pulling probe). 1000 units
   * measured on real levels (Node 22, this pod): office med 0.21 / p95 1.22 / max 2.2 ms, subway 0.49 / 1.20 / 1.9 ms.
   */
  chunkUnits: 1000,
  /** A finished path is handed over when the asking start / goal are still this close to the searched ones. */
  goalSlack: 1.5,
  startSlack: 2.5,
  /** Storey match of the start / goal (feet heights). */
  storeySlack: 1.2,
  /** A ticket whose enemy has not asked for this many frames is skipped / its search abandoned. */
  idleFrames: 3,
} as const;

/** The game's immediate search (PathFinder.find with its radius / expansion bound). */
export type FindPath = (ax: number, az: number, bx: number, bz: number, opts: PathOpts) => Waypoint[] | null;
/** The same search, resumable: suspended every `chunk` work units (PathFinder.search on a fork). */
export type SearchSteps = (ax: number, az: number, bx: number, bz: number, opts: PathOpts, chunk: number) => Generator<void, Waypoint[] | null, void>;
/** Is a requester at (x, z) with feet at y near the player (never deferred)? */
export type NearPlayer = (x: number, z: number, y: number | undefined) => boolean;

/**
 * The NEAR rule (Game.nearPlayer): `d` = 3D straight distance to the player; `route()` = navigable route length from the
 * player (Infinity: beyond the field / unreachable; null: no route field). Near = never deferred.
 */
export function nearPlayerRule(d: number, route: () => number | null): boolean {
  if (d < PATH_DEFER.nearM) return true;
  const r = route();
  return r !== null ? r <= PATH_DEFER.nearRouteM : d < PATH_DEFER.midM;
}

interface Ticket {
  owner: object;
  ax: number; az: number; bx: number; bz: number;
  opts: PathOpts;
  state: 'queued' | 'running' | 'done';
  result: Waypoint[] | null;
  /** Service frame of the owner's last ask / of the search's end. */
  asked: number;
  doneAt: number;
}

export interface PathServiceStats {
  /** Answered immediately (no defer offered, near, no scheduler, refused). */
  immediate: number;
  /** Far re-plans queued / handed over after the search / searched again (moved too far, or the result went stale). */
  queued: number;
  delivered: number;
  reissued: number;
  /** Re-asks while queued or running (coalesced into the ticket). */
  coalesced: number;
  /** Searches skipped / abandoned (enemy stopped asking) and tickets cancelled (world change, came near). */
  skipped: number;
  cancelled: number;
  /** Requests the scheduler refused (queue full / old world): answered immediately instead. */
  refused: number;
  /** Searches completed in the background / chunks run / most chunks one search took. */
  searches: number;
  chunks: number;
  maxChunks: number;
}

let services = 0;

export class PathService {
  readonly stats: PathServiceStats = {immediate: 0, queued: 0, delivered: 0, reissued: 0, coalesced: 0, skipped: 0, cancelled: 0, refused: 0, searches: 0, chunks: 0, maxChunks: 0};
  private readonly tickets = new Map<object, Ticket>();
  private line: Ticket[] = [];
  private running: {t: Ticket; it: Generator<void, Waypoint[] | null, void>; chunks: number} | null = null;
  private frame = 0;
  private sched: FrameScheduler | null;
  private readonly gen: number;
  private readonly key = `path.far#${++services}`;
  private readonly steps: SearchSteps;

  constructor(private readonly find: FindPath, steps: SearchSteps | null, scheduler: FrameScheduler | null, private readonly near: NearPlayer) {
    this.sched = scheduler;
    this.gen = scheduler ? scheduler.generation : 0;
    // without a resumable search: the whole search in one chunk (still staggered: one per chunk)
    this.steps = steps ?? function* (ax, az, bx, bz, o) { return find(ax, az, bx, bz, o); };
  }

  /** Once per game update, before the enemies think (the idle checks count these frames). */
  tick(): void {
    this.frame++;
  }

  /** Enemies with a queued, running or finished-but-not-taken search. */
  get pending(): number {
    return this.tickets.size;
  }

  /**
   * A brain's path request (BrainWorld.findPath). `opts.defer` = the requesting brain (a deferrable re-plan). Returns the path
   * (or null: none), or undefined = queued, ask again next frame.
   */
  request(ax: number, az: number, bx: number, bz: number, opts: PathOpts & {defer?: object} = {}): Waypoint[] | null | undefined {
    const {defer: owner, ...o} = opts;
    if (!owner || !this.sched || this.near(ax, az, o.ay)) {
      if (owner) this.forget(owner); // near again (or never deferrable): a queued far search is superseded
      return this.immediate(ax, az, bx, bz, o);
    }
    let t = this.tickets.get(owner);
    if (t?.state === 'done') {
      this.tickets.delete(owner);
      // handed over while fresh (the owner asks every frame while waiting; an old unclaimed result is searched again)
      if (this.frame - t.doneAt <= PATH_DEFER.idleFrames && this.fits(t, ax, az, bx, bz, o)) { this.stats.delivered++; return t.result; }
      this.stats.reissued++;
      t = undefined;
    }
    if (!t) {
      t = {owner, ax, az, bx, bz, opts: o, state: 'queued', result: null, asked: this.frame, doneAt: -1};
      this.tickets.set(owner, t);
      this.line.push(t);
      this.stats.queued++;
    } else {
      if (t.state === 'queued') { t.ax = ax; t.az = az; t.bx = bx; t.bz = bz; t.opts = o; } // not started: the newest request
      t.asked = this.frame;
      this.stats.coalesced++;
    }
    if (this.ensureJob()) return undefined;
    this.forget(owner); // refused (counted): answered now
    this.stats.refused++;
    return this.immediate(ax, az, bx, bz, o);
  }

  private immediate(ax: number, az: number, bx: number, bz: number, o: PathOpts): Waypoint[] | null {
    this.stats.immediate++;
    return this.find(ax, az, bx, bz, o);
  }

  /** The line's scheduler job is queued (true), or the scheduler refused it. */
  private ensureJob(): boolean {
    const s = this.sched;
    if (!s) return false;
    if (s.has(this.key)) return true;
    const D = PATH_DEFER;
    const r = s.request({key: this.key, kind: D.kind, priority: D.priority, maxStaleMs: D.maxStaleMs, initialEstimateMs: D.initialEstimateMs,
      generation: this.gen, step: this.chunk, onCancel: this.cancelled});
    if (r === 'queued' || r === 'coalesced') return true;
    if (r === 'stale') this.retire(); // a replaced world's service: immediate from now on
    return false;
  }

  /** One scheduler chunk: resume the current search for chunkUnits (or start the next ticket's). True = the line is done. */
  private readonly chunk = (): boolean => {
    for (;;) {
      let r = this.running;
      if (r && (this.tickets.get(r.t.owner) !== r.t || this.frame - r.t.asked > PATH_DEFER.idleFrames)) {
        r.it.return(null); // its enemy stopped asking (died / saw the player / came near): abandon
        this.running = r = null;
        this.stats.skipped++;
      }
      if (!r) {
        const t = this.next();
        if (!t) return true;
        t.state = 'running';
        r = this.running = {t, it: this.steps(t.ax, t.az, t.bx, t.bz, t.opts, PATH_DEFER.chunkUnits), chunks: 0};
      }
      const s = r.it.next();
      r.chunks++;
      this.stats.chunks++;
      if (s.done) {
        const t = r.t;
        t.result = s.value;
        t.state = 'done';
        t.doneAt = this.frame;
        this.running = null;
        this.stats.searches++;
        if (r.chunks > this.stats.maxChunks) this.stats.maxChunks = r.chunks;
      }
      return this.running === null && this.line.length === 0;
    }
  };

  /** The next queued ticket whose enemy still asks (others are dropped unsearched). */
  private next(): Ticket | null {
    while (this.line.length) {
      const t = this.line.shift()!;
      if (this.tickets.get(t.owner) !== t || t.state !== 'queued') continue;
      if (this.frame - t.asked > PATH_DEFER.idleFrames) { this.tickets.delete(t.owner); this.stats.skipped++; continue; }
      return t;
    }
    return null;
  }

  /** The job left the scheduler unfinished: a world change (everything goes), a drop or a failed search (retried on the next asks). */
  private readonly cancelled = (reason: CancelReason): void => {
    if (reason === 'generation') { this.retire(); return; }
    const r = this.running;
    if (r) { this.running = null; if (this.tickets.get(r.t.owner) === r.t) { this.tickets.delete(r.t.owner); this.stats.cancelled++; } }
  };

  /** No more background work for this service (its world was replaced). */
  private retire(): void {
    this.sched = null;
    this.running?.it.return(null);
    this.running = null;
    this.stats.cancelled += this.tickets.size;
    this.tickets.clear();
    this.line = [];
  }

  private fits(t: Ticket, ax: number, az: number, bx: number, bz: number, o: PathOpts): boolean {
    const D = PATH_DEFER;
    if (Math.hypot(t.bx - bx, t.bz - bz) > D.goalSlack || Math.hypot(t.ax - ax, t.az - az) > D.startSlack) return false;
    if ((t.opts.by === undefined) !== (o.by === undefined) || (o.by !== undefined && Math.abs(t.opts.by! - o.by) > D.storeySlack)) return false;
    if ((t.opts.ay === undefined) !== (o.ay === undefined) || (o.ay !== undefined && Math.abs(t.opts.ay! - o.ay) > D.storeySlack)) return false;
    return !!t.opts.drops === !!o.drops && !!t.opts.noLinks === !!o.noLinks;
  }

  /** Drop an owner's ticket (a running search is abandoned; the job moves on to the next ticket). */
  private forget(owner: object): void {
    const t = this.tickets.get(owner);
    if (!t) return;
    this.tickets.delete(owner);
    if (t.state !== 'done') this.stats.cancelled++;
    if (this.running?.t === t) { this.running.it.return(null); this.running = null; }
  }
}
