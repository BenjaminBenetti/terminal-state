// Task frame-budget-deferral-20261030 (lane SCHED), user feedback #11 ("background updates … spread among the less intense
// frames"). Lane MEASURE found the dominant CPU spikes in PathFinder.find (A* + string pulling): a cross-storey chase re-plan
// costs several to tens of ms, and one gunshot that alerts a whole level makes EVERY hearing enemy re-plan in the same frame
// (repathT = 0), their re-plan timers then staying phase-locked (clusters of 4-7 paths in later frames).
//
// The path service sits between the brains and the game's PathFinder (Game.brainWorld findPath):
//  - IMMEDIATE (exactly as before): every request without `defer`, i.e. every one except a chase re-plan of an enemy that
//    does NOT see the player (ai/brain.ts); and every deferrable one from an enemy that is NEAR the player — closer than
//    `nearM` (3D straight line), or closer than `midM` with a navigable route <= `nearRouteM` (the vocal-reach route field,
//    ai/vocalReach.ts; unknown route = near). Nearby AI response is never deferred.
//  - DEFERRED: a far, not-in-sight chase re-plan becomes ONE scheduler job (core/frameBudget.ts) per enemy: one bounded path
//    search per chunk (PathFinder.find's maxExpand bounds it; it cannot be split without its shared search buffers),
//    coalesced per enemy (a re-ask while queued updates the request: the newest start / goal is searched), max staleness
//    `maxStaleMs` of play (then forced, at most the scheduler's overdue cap per frame — a burst of 40 re-plans becomes a few
//    paths per frame, never one giant frame), cancelled on a world change (scheduler generation; a new service per world).
//    The brain keeps following its current path meanwhile and asks again each frame; the finished path is handed over on the
//    next ask when it still fits (goal within `goalSlack`, start within `startSlack`, searched at most `idleFrames` frames
//    ago; else it is searched again). The brain draws its re-plan timer at the first ask, as before (ai/brain.ts).
//    Finished results arrive on different frames, so the re-plan timers no longer stay phase-locked.
//  - Bounds / truthfulness: at most one ticket per enemy; a queue refusal (full / old world) answers immediately instead
//    (counted, never silent); an enemy that stopped asking for `idleFrames` (it died, saw the player, gave up) is skipped
//    without searching. `stats` + the scheduler's diagnostics show it all (`__LL.frameBudget()`, `__LL.pathService()`).

import type {PathOpts, Waypoint} from '../gen/grid';
import type {FrameScheduler} from '../core/frameBudget';

/** Deferral policy (see the file comment). Lengths in m, times in ms of play. */
export const PATH_DEFER = {
  /** Always immediate this close to the player (3D straight line). */
  nearM: 8,
  /** Immediate below this straight distance when the navigable route is short (<= nearRouteM) or unknown. */
  midM: 16,
  nearRouteM: 16,
  /** Scheduler job parameters. */
  kind: 'path.far',
  priority: 1,
  maxStaleMs: 250,
  /** First estimate of a far path search before anything was measured (ms; MEASURE: office chase med 2.8, cross-storey 13+). */
  initialEstimateMs: 4,
  /** A finished path is handed over when the asking start / goal are still this close to the searched ones. */
  goalSlack: 1.5,
  startSlack: 2.5,
  /** Storey match of the goal (feet heights). */
  storeySlack: 1.2,
  /** A queued search whose enemy has not asked for this many frames is dropped unsearched. */
  idleFrames: 3,
} as const;

/** The game's search (PathFinder.find with its radius / expansion bound). */
export type FindPath = (ax: number, az: number, bx: number, bz: number, opts: PathOpts) => Waypoint[] | null;
/** Is a requester at (x, z) with feet at y near the player (never deferred)? */
export type NearPlayer = (x: number, z: number, y: number | undefined) => boolean;

interface Ticket {
  key: string;
  ax: number; az: number; bx: number; bz: number;
  opts: PathOpts;
  /** Searched (result valid) / waiting in the scheduler. */
  done: boolean;
  result: Waypoint[] | null;
  /** Service frame of the owner's last ask / of the search. */
  asked: number;
  doneAt: number;
}

export interface PathServiceStats {
  /** Answered immediately (no defer offered, near, no scheduler). */
  immediate: number;
  /** Far re-plans queued as jobs / handed over after the search / searched again (start or goal moved too far). */
  queued: number;
  delivered: number;
  reissued: number;
  /** Re-asks while queued (coalesced into the queued ticket). */
  coalesced: number;
  /** Queued searches dropped unsearched (owner stopped asking) / cancelled (world change, near again). */
  skipped: number;
  cancelled: number;
  /** Requests the scheduler refused (queue full / old world): answered immediately instead. */
  refused: number;
  /** Searches run as background chunks. */
  searches: number;
}

export class PathService {
  readonly stats: PathServiceStats = {immediate: 0, queued: 0, delivered: 0, reissued: 0, coalesced: 0, skipped: 0, cancelled: 0, refused: 0, searches: 0};
  private readonly tickets = new Map<object, Ticket>();
  private frame = 0;
  private ids = 0;
  private sched: FrameScheduler | null;
  private readonly gen: number;

  constructor(private readonly find: FindPath, scheduler: FrameScheduler | null, private readonly near: NearPlayer) {
    this.sched = scheduler;
    this.gen = scheduler ? scheduler.generation : 0;
  }

  /** Once per game update, before the enemies think (the idle check counts these frames). */
  tick(): void {
    this.frame++;
  }

  /** Enemies with a queued or finished-but-not-taken search. */
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
      this.stats.immediate++;
      return this.find(ax, az, bx, bz, o);
    }
    let t = this.tickets.get(owner);
    if (t?.done) {
      this.tickets.delete(owner);
      // handed over while fresh (the owner asks every frame while waiting; an old unclaimed result is searched again)
      if (this.frame - t.doneAt <= PATH_DEFER.idleFrames && this.fits(t, ax, az, bx, bz, o)) { this.stats.delivered++; return t.result; }
      this.stats.reissued++;
      t = undefined;
    }
    if (t) {
      // still queued: search from the newest start toward the newest goal
      t.ax = ax; t.az = az; t.bx = bx; t.bz = bz; t.opts = o; t.asked = this.frame;
      this.stats.coalesced++;
      return undefined;
    }
    const nt: Ticket = {key: `path.far#${++this.ids}`, ax, az, bx, bz, opts: o, done: false, result: null, asked: this.frame, doneAt: -1};
    const D = PATH_DEFER;
    const r = this.sched.request({key: nt.key, kind: D.kind, priority: D.priority, maxStaleMs: D.maxStaleMs, initialEstimateMs: D.initialEstimateMs,
      generation: this.gen, step: () => this.search(owner, nt), onCancel: () => { if (this.tickets.get(owner) === nt) { this.tickets.delete(owner); this.stats.cancelled++; } }});
    if (r !== 'queued' && r !== 'coalesced') {
      this.stats.refused++;
      if (r === 'stale') this.sched = null; // a replaced world's service: answer immediately from now on
      this.stats.immediate++;
      return this.find(ax, az, bx, bz, o);
    }
    this.tickets.set(owner, nt);
    this.stats.queued++;
    return undefined;
  }

  /** One chunk: the ticket's search (or nothing when its owner moved on). */
  private search(owner: object, t: Ticket): boolean {
    if (this.tickets.get(owner) !== t || t.done) return true;
    if (this.frame - t.asked > PATH_DEFER.idleFrames) { this.tickets.delete(owner); this.stats.skipped++; return true; }
    t.result = this.find(t.ax, t.az, t.bx, t.bz, t.opts);
    t.done = true;
    t.doneAt = this.frame;
    this.stats.searches++;
    return true;
  }

  private fits(t: Ticket, ax: number, az: number, bx: number, bz: number, o: PathOpts): boolean {
    const D = PATH_DEFER;
    if (Math.hypot(t.bx - bx, t.bz - bz) > D.goalSlack || Math.hypot(t.ax - ax, t.az - az) > D.startSlack) return false;
    if ((t.opts.by === undefined) !== (o.by === undefined) || (o.by !== undefined && Math.abs(t.opts.by! - o.by) > D.storeySlack)) return false;
    if ((t.opts.ay === undefined) !== (o.ay === undefined) || (o.ay !== undefined && Math.abs(t.opts.ay! - o.ay) > D.storeySlack)) return false;
    return !!t.opts.drops === !!o.drops && !!t.opts.noLinks === !!o.noLinks;
  }

  /** Drop an owner's ticket (queued: its job is cancelled too). */
  private forget(owner: object): void {
    const t = this.tickets.get(owner);
    if (!t) return;
    this.tickets.delete(owner);
    if (!t.done) { this.sched?.cancel(t.key); this.stats.cancelled++; }
  }
}
