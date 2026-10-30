// Task office-overhaul-20261030 (lane AUDIO), user feedback #4: "In the office you can hear the zombies moaning that are
// above you. This leads to an 'over grunting' effect … You should only hear enemies within a reasonable pathfind distance
// of you."
//
// Why it happened: enemy vocals were gated by PLAN distance (creatureArchetypes.ts `dist < 22`, the planar panOf distance)
// and the panner rolls off by the straight 3D line, so every zombie on the storeys above / below the player (4.4 m per slab,
// same x/z) groaned at nearly full level — a choir through several floors. The slab occlusion only muffled them (x0.55 +
// lowpass), never silenced them.
//
// Now: ONE shared navigable-distance field from the PLAYER over every storey (`VocalReach`), and a pure gain law
// (`vocalGain`) the Sfx applies to enemy vocals (audio/sfx.ts `vocal()`):
//  * Field: Dijkstra in metres over the walk grids of every level (the same data the game's PathFinder snapshots: open
//    FLOOR / track-bed cells, the stacked-station headroom rule, floor heights), joined across storeys ONLY where the
//    navigation joins them — shared stair / escalator cells carved into both grids (PathFinder "twins"), same-level nav
//    links and cross-level ladder links (rescue ladders, the roof access ladder). Steps up / down to MAX_DROP both ways
//    (sound does not care which way is climbable; the platform edge into the track bed connects). Railings and low props are
//    ignored (sound passes over them); props that block both movement and sight (columns, tall cabinets) and walls block.
//  * Bounded: the search stops at `radius` metres of path (beyond: Infinity) and never touches more than `maxNodes` nodes.
//  * Cached + time-sliced: rebuilt only when the player's start node changed AND they moved >= `minMove` (or changed storey
//    / cab state), at most once per `minInterval` (<= 2.5 Hz), and each build settles at most `budget` nodes per frame
//    (update()); the previous complete field keeps answering until the new one finishes (double buffer). No per-enemy
//    pathfinding, nothing per enemy per frame: an enemy's distance is an O(1) lookup (pathTo) at the moment it vocalises.
//  * Elevator (lane LIFT dynamic volume): a player in the cab reaches the floor only through an OPEN gate (cab at a stop,
//    doors open: the landing cells in front of the doorway are seeded); doors shut / cab moving = sealed (nothing beyond is
//    near). An enemy in the same cab is near (straight line); an enemy in the cab while the player is outside is reached
//    through the open gate only.
//  * Works for any storey count and any stair / escalator / ladder links (no office-specific data): the Subway's stacked
//    stations use the same field (only the vocal gate changes there).
//  * Task frame-budget-deferral-20261030 (lane SCHED): with a frame-budget scheduler attached (attachScheduler; the game
//    does), the build's slices are NOT run by update() any more but as scheduler chunks (core/frameBudget.ts) in the spare
//    time left after the frame's update + render submission: several slices in a light frame, none in a frame already over
//    budget — at most VOCAL_REACH_SCHED.maxStaleMs, after which one slice per frame runs anyway (exactly the old per-frame
//    rate under sustained overload). Same slices, same order, same field (tests/frame-budget-jobs.test.ts); update() keeps
//    the cheap per-frame part (player position, cab, teleport drop, build start). Without a scheduler: unchanged.

import {CELL, FLOOR, VOID, MAX_DROP, Grid, type NavLevels} from '../gen/grid';
import type {DynamicVolume, VolumeGate} from '../gen/levels';
import type {FrameScheduler} from '../core/frameBudget'; // task frame-budget-deferral-20261030 (lane SCHED)

/** Field parameters (game defaults; tests may override per instance). */
export const VOCAL_REACH = {
  /** Search bound (m of navigable path); every node farther is Infinity. >= the largest VOCAL_GATE limit. */
  radius: 38,
  /** Hard cap on nodes one field may touch (memory traffic + a build's total work). */
  maxNodes: 40000,
  /** Node settles per update() call (one frame; ~0.8 µs per node warm in Node 22 -> < 1 ms): a build is time-sliced over
   *  frames and the previous complete field serves meanwhile. A typical office field (~11k nodes) takes ~11 frames. */
  budget: 1000,
  /** Minimum seconds between two build starts (<= 2.5 Hz). */
  minInterval: 0.4,
  /** A new build needs the player's start node to change AND a plan move of at least this much (m) from the field origin
   *  (a storey / cab-state change always qualifies). */
  minMove: 1,
  /** The current field is dropped (every lookup Infinity until the next build completes) when the player is this far (m)
   *  from its origin — a teleport / respawn, never ordinary movement (<= ~2.5 m between builds at a sprint). */
  teleport: 8,
  /** Node of a point at height y: the highest walkable floor in [y - down, y + up] of its column (y may be the feet or a
   *  voice ~0.3–1.6 m above them). */
  up: 0.5,
  down: 2.7,
  /** The player's start: when their own column has no walkable node (standing on a prop, a doorway edge), the nearest one
   *  within this many cells at that height (small: a larger snap could cross a thin wall). */
  snap: 2,
} as const;

export type VocalReachOptions = Partial<Record<'radius' | 'maxNodes' | 'budget' | 'minInterval' | 'minMove' | 'teleport', number>>;

/**
 * Task frame-budget-deferral-20261030 (lane SCHED): the build as a background job (attachScheduler). A chunk = one slice of
 * `budget` node settles (the same bounded slice update() ran per frame). Max staleness 50 ms of play (~3 frames at 60 Hz):
 * a heavy frame sheds its slice to a lighter one that follows, and sustained overload still advances one slice per frame.
 */
export const VOCAL_REACH_SCHED = {key: 'vocalReach.build', kind: 'vocalReach.slice', priority: 2, maxStaleMs: 50, initialEstimateMs: 1} as const;

/**
 * Policy of the enemy vocal gate (audio/sfx.ts). Categories (documented in lanes/AUDIO.done):
 *  - idle / chase vocals (zombie groans, rat/dog growls and aware snarls): heard along the navigable route — silent beyond
 *    `idle.limit` m of path, attenuated by the path length (not the straight line through slabs) and faded out over the last
 *    `idle.fade` m; ranked into the `cap` simultaneous vocal voices (nearest wins).
 *  - alert vocals (the growl / snarl when an enemy first SEES the player): same law with the longer `alert` limit and a
 *    relevance bias in the cap; an alert always comes with line of sight, so the sight rule keeps it audible.
 *  - sight rule: a vocal source in clear 3D line of sight (no wall / slab between: the Sfx occlusion test) is heard by the
 *    straight line as before even when its route is long (across an open stairwell / void).
 *  - footsteps / ladder rung clanks: same-storey ones are UNCHANGED; on another storey they need a route of <= `steps` m.
 *  - never gated: gunfire, impacts, breakage, hit-confirm, the player's own hurt / death, and enemy attack / hurt / death
 *    cues (an attack only starts within reach and sight of the player; hurt / death follow the player's own hit).
 */
export const VOCAL_GATE = {
  idle: {limit: 32, fade: 10},
  alert: {limit: 38, fade: 8},
  /** Cross-storey enemy footfalls / rung clanks: route limit (m). */
  steps: 18,
  /** A route within `slack + ratio * straight` of the straight line counts as straight (grid octile quantisation). */
  slack: 1,
  ratio: 0.1,
  /** Simultaneous enemy vocal voices (a nearer vocal fades out the farthest playing one). */
  cap: 3,
  /** A new vocal takes a slot from the farthest only when it ranks at least this much (m) nearer. */
  steal: 1.5,
  /** Fade-out of a vocal whose slot was taken (s). */
  stealFade: 0.06,
  /** Alert vocals rank at this fraction of their distance (most relevant). */
  alertBias: 0.5,
  /** Gains below this (≈ -30 dB) are not played at all. */
  minGain: 0.03,
} as const;

/** Panner 'inverse' distance law (Web Audio): the level a PannerNode gives at distance d. */
export function inverseGain(d: number, ref: number, rolloff: number): number {
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}

/**
 * Extra gain of a vocal reached along `path` m of navigable route when the panner already rolls it off by the straight-line
 * distance `straight` (so the result is the route's level relative to the line's): 1 for a (nearly) straight route, lower for
 * a detour, smoothly to 0 over the last `fade` m before `limit`, 0 beyond it (not played). NaN / Infinity paths -> 0.
 */
export function vocalGain(path: number, straight: number, limit: number, fade: number, ref: number, rolloff: number): number {
  if (!(path <= limit)) return 0;
  const eff = Math.max(straight, path - (VOCAL_GATE.slack + VOCAL_GATE.ratio * straight));
  let g = Math.min(1, inverseGain(eff, ref, rolloff) / inverseGain(straight, ref, rolloff));
  const e = fade > 0 ? (limit - path) / fade : 1;
  if (e < 1) g *= e <= 0 ? 0 : e * e * (3 - 2 * e);
  return g;
}

/** Levels-like source with the optional lane-LIFT dynamic volumes (the moving elevator cab). */
type ReachSource = NavLevels & {
  readonly dynamicVolumes?: readonly DynamicVolume[];
  volumeAt?(wx: number, wz: number, y?: number, pad?: number): DynamicVolume | null;
};

/** Clear height a node needs on stacked stations (m; the PathFinder's NAV_CLEAR). */
const NAV_CLEAR = 1.6;
const DIAG = CELL * Math.SQRT2;
/** Cab floor match for landing cells in front of an open gate (m). */
const GATE_FLOOR_TOL = 0.3;
/** Key of a start with no seeds (sealed cab / off the walk grids). */
const SEALED = -2;

/** QA / test counters. */
export interface VocalReachStats {
  /** Builds started / completed. */
  builds: number;
  completed: number;
  /** Nodes touched by the current (front) field. */
  nodes: number;
  /** Most node settles in one update() call (<= budget). */
  maxStep: number;
  /** Times the field was dropped for a teleport. */
  invalidated: number;
  /** Most ms one update() took (diagnostic; 0 without performance.now). */
  maxStepMs: number;
}

/**
 * The shared navigable-distance field from the player (see the file comment). Construct once per built world (after the
 * level grids exist; cheap snapshot, no search); call update() once per frame with the player's feet position; ask
 * pathTo() for an enemy's route length in metres (Infinity = beyond `radius` / unreachable / no field yet).
 */
export class VocalReach {
  readonly W: number;
  readonly H: number;
  /** Cells per level. */
  readonly NC: number;
  readonly NL: number;
  readonly radius: number;
  readonly maxNodes: number;
  readonly budget: number;
  private readonly minInterval: number;
  private readonly minMove: number;
  private readonly teleport: number;
  /** Floor height per node (level * NC + cell); NaN = not a place sound travels along. */
  private readonly fl: Float32Array;
  private readonly twins = new Map<number, number[]>();
  private readonly twinFlag: Uint8Array;
  private readonly linkTo = new Map<number, {n: number; cost: number}[]>();
  private readonly linkFlag: Uint8Array;
  private readonly src: ReachSource | null;
  // double-buffered field: `front` answers lookups, `work` is being built (Infinity everywhere except its touched list)
  private front: Float32Array;
  private work: Float32Array;
  private frontList: Int32Array;
  private workList: Int32Array;
  private frontCount = 0;
  private workCount = 0;
  private readonly closed: Uint8Array;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  private buildingNow = false;
  private sinceStart = Infinity;
  private frontOk = false;
  private frontKey = SEALED;
  private readonly frontOrigin = {x: 0, y: 0, z: 0, level: -1};
  private buildKey = SEALED;
  private readonly buildOrigin = {x: 0, y: 0, z: 0, level: -1};
  /** Player feet (last update) and the volume (cab) they are in. */
  private readonly player = {x: 0, y: 0, z: 0};
  private playerVol: DynamicVolume | null = null;
  private readonly seedBuf: number[] = [];
  readonly stats: VocalReachStats = {builds: 0, completed: 0, nodes: 0, maxStep: 0, invalidated: 0, maxStepMs: 0};
  /** Lane SCHED: the scheduler running the build's slices (null: update() runs one slice per frame, as before). */
  private sched: FrameScheduler | null = null;
  private schedGen = 0;
  private readonly schedStep = (): boolean => {
    if (!this.buildingNow) return true; // aborted (teleport) since the request
    this.slice();
    return !this.buildingNow;
  };
  /** Lane SCHED: slices run by the scheduler / requests it refused (drops fall back to the old per-frame slice). */
  readonly schedStats = {chunks: 0, requests: 0, refused: 0};

  constructor(source: Grid | ReachSource, opts: VocalReachOptions = {}) {
    const grids = source instanceof Grid ? [source] : source.list.map(l => l.grid);
    this.src = source instanceof Grid ? null : source;
    this.radius = opts.radius ?? VOCAL_REACH.radius;
    this.maxNodes = Math.max(16, opts.maxNodes ?? VOCAL_REACH.maxNodes);
    this.budget = Math.max(1, opts.budget ?? VOCAL_REACH.budget);
    this.minInterval = opts.minInterval ?? VOCAL_REACH.minInterval;
    this.minMove = opts.minMove ?? VOCAL_REACH.minMove;
    this.teleport = opts.teleport ?? VOCAL_REACH.teleport;
    const g0 = grids[0], W = g0.w, H = g0.h, NC = W * H, NL = grids.length, n = NC * NL;
    this.W = W; this.H = H; this.NC = NC; this.NL = NL;
    const fl = (this.fl = new Float32Array(n).fill(NaN));
    grids.forEach((g, k) => {
      const o = k * NC;
      for (let i = 0; i < NC; i++) {
        const c = g.cells[i];
        if (c !== FLOOR && c !== VOID) continue;
        if (g.blocked[i] && g.sightBlocked[i]) continue; // a column / tall cabinet: sound goes round it, like walls
        const f = g.floorOf(i);
        if (NL > 1 && g.hasCeil(i) && g.ceil[i] - f < NAV_CLEAR) continue; // under a slab / low soffit (PathFinder rule)
        fl[o + i] = f;
      }
    });
    this.twinFlag = new Uint8Array(n);
    this.linkFlag = new Uint8Array(n);
    if (NL > 1) {
      // shared stair / escalator cells: the same column walkable on two levels at the same floor (the PathFinder's twins)
      for (let i = 0; i < NC; i++) {
        for (let a = 0; a < NL; a++) {
          const fa = fl[a * NC + i];
          if (fa !== fa) continue;
          for (let b = a + 1; b < NL; b++) {
            const fb = fl[b * NC + i];
            if (fb !== fb || Math.abs(fa - fb) >= 0.05) continue;
            this.addTwin(a * NC + i, b * NC + i);
          }
        }
      }
    }
    grids.forEach((g, k) => { for (const l of g.links) this.addLink(k * NC + l.a, k * NC + l.b, l.cost * CELL); });
    if (this.src) for (const l of this.src.crossLinks()) this.addLink(l.la * NC + l.a, l.lb * NC + l.b, l.cost * CELL);
    this.front = new Float32Array(n).fill(Infinity);
    this.work = new Float32Array(n).fill(Infinity);
    this.frontList = new Int32Array(this.maxNodes);
    this.workList = new Int32Array(this.maxNodes);
    this.closed = new Uint8Array(n);
    this.heap = new Int32Array(Math.min(this.maxNodes * 2, 1 << 16));
    this.heapF = new Float32Array(this.heap.length);
  }

  private addTwin(a: number, b: number): void {
    for (const [p, q] of [[a, b], [b, a]]) { let t = this.twins.get(p); if (!t) this.twins.set(p, (t = [])); t.push(q); this.twinFlag[p] = 1; }
  }

  private addLink(a: number, b: number, cost: number): void {
    for (const [p, q] of [[a, b], [b, a]]) { let t = this.linkTo.get(p); if (!t) this.linkTo.set(p, (t = [])); t.push({n: q, cost}); this.linkFlag[p] = 1; }
  }

  /** A complete field is answering lookups. */
  get ready(): boolean {
    return this.frontOk;
  }

  /** A build is in progress (time-sliced over frames). */
  get building(): boolean {
    return this.buildingNow;
  }

  /** Where the current field was seeded from (player feet), or null when there is none. */
  get origin(): {x: number; y: number; z: number; level: number} | null {
    return this.frontOk ? {...this.frontOrigin} : null;
  }

  // -------------------------------------------------------------------------------------------
  // Per frame

  /**
   * Lane SCHED: run the build's slices as background chunks of `s` (see VOCAL_REACH_SCHED). `s.generation` is captured: after
   * a world change this instance's requests are refused and it falls back to stepping in update().
   */
  attachScheduler(s: FrameScheduler | null): void {
    this.sched = s;
    this.schedGen = s ? s.generation : 0;
  }

  /**
   * Once per frame with the player's feet position: continues a build within `budget`, or starts one when due. Lane SCHED:
   * with a scheduler the slices run as its chunks (update() only starts a build and keeps its job queued).
   */
  update(dt: number, x: number, y: number, z: number): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.sinceStart += dt;
    const P = this.player;
    P.x = x; P.y = y; P.z = z;
    const vs = this.src?.dynamicVolumes;
    this.playerVol = vs && vs.length && this.src?.volumeAt ? this.src.volumeAt(x, z, y + 0.5) : null;
    if (this.frontOk && Math.hypot(x - this.frontOrigin.x, y - this.frontOrigin.y, z - this.frontOrigin.z) > this.teleport) {
      this.frontOk = false; // teleported: the old field would place every enemy wrongly
      this.stats.invalidated++;
    }
    const B = this.buildOrigin;
    if (this.buildingNow && Math.hypot(x - B.x, y - B.y, z - B.z) > this.teleport) this.abort(); // and so would the build in progress
    if (this.sched) {
      // lane SCHED: start a build when due (no slice here) and keep its job queued; the scheduler runs the slices
      if (!this.buildingNow && (this.sinceStart >= this.minInterval || !this.frontOk)) this.maybeBegin(x, y, z, false);
      if (this.buildingNow && !this.queueBuild()) this.step(); // refused (queue full / old world): the old per-frame slice
    } else if (this.buildingNow) this.step();
    else if (this.sinceStart >= this.minInterval || !this.frontOk) this.maybeBegin(x, y, z);
    if (t0) { const ms = performance.now() - t0; if (ms > this.stats.maxStepMs) this.stats.maxStepMs = ms; }
  }

  /** Lane SCHED: the build's job is queued (true), or the scheduler refused it (false). */
  private queueBuild(): boolean {
    const s = this.sched!, J = VOCAL_REACH_SCHED;
    if (s.has(J.key)) return true;
    this.schedStats.requests++;
    const r = s.request({key: J.key, kind: J.kind, priority: J.priority, maxStaleMs: J.maxStaleMs, initialEstimateMs: J.initialEstimateMs,
      generation: this.schedGen, step: this.schedStep});
    if (r === 'queued' || r === 'coalesced') return true;
    this.schedStats.refused++;
    if (r === 'stale') this.sched = null; // this field belongs to a replaced world: never queue again
    return false;
  }

  /** Lane SCHED: one scheduler chunk = one slice (timed into the same per-slice maximum update() reports). */
  private slice(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.step();
    this.schedStats.chunks++;
    if (t0) { const ms = performance.now() - t0; if (ms > this.stats.maxStepMs) this.stats.maxStepMs = ms; }
  }

  private maybeBegin(x: number, y: number, z: number, stepNow = true): void {
    const seeds = this.seedBuf;
    const level = this.seeds(x, y, z, seeds);
    const key = seeds.length ? seeds[0] : SEALED;
    if (this.frontOk) {
      if (key === this.frontKey) return;
      const O = this.frontOrigin;
      const sameKind = (key === SEALED) === (this.frontKey === SEALED);
      if (sameKind && key !== SEALED && level === O.level && Math.hypot(x - O.x, z - O.z) < this.minMove) return;
    }
    this.begin(seeds, key, x, y, z, level);
    if (stepNow) this.step();
  }

  private begin(seeds: readonly number[], key: number, x: number, y: number, z: number, level: number): void {
    const work = this.work, list = this.workList;
    for (let i = 0; i < this.workCount; i++) work[list[i]] = Infinity; // the field of two builds ago
    this.workCount = 0;
    this.heapSize = 0;
    for (let i = 0; i < seeds.length; i += 2) this.relax(seeds[i], seeds[i + 1]);
    this.buildKey = key;
    const B = this.buildOrigin;
    B.x = x; B.y = y; B.z = z; B.level = level;
    this.buildingNow = true;
    this.sinceStart = 0;
    this.stats.builds++;
  }

  /** Settle up to `budget` nodes of the build in progress; finish (swap buffers) when the heap runs dry. */
  private step(): void {
    const work = this.work, fl = this.fl, closed = this.closed, list = this.workList, W = this.W, H = this.H, NC = this.NC;
    const R = this.radius, cap = this.maxNodes, budget = this.budget;
    let settled = 0, count = this.workCount;
    while (this.heapSize > 0 && settled < budget) {
      const f = this.heapF[0], v = this.pop();
      if (closed[v] || f > work[v]) continue;
      closed[v] = 1;
      settled++;
      const ci = v % NC, cx = ci % W, cy = (ci - cx) / W, fv = fl[v];
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox;
          if (nx < 0 || nx >= W) continue;
          const u = v + ox + oy * W;
          const fu = fl[u];
          if (fu !== fu) continue;
          const dh = fu - fv;
          if (dh > MAX_DROP || dh < -MAX_DROP) continue;
          const diag = ox !== 0 && oy !== 0;
          if (diag) {
            // no corner cutting: both orthogonal neighbours open and within reach of this floor
            const a = fl[v + ox], b = fl[v + oy * W];
            if (a !== a || b !== b || Math.abs(a - fv) > MAX_DROP || Math.abs(b - fv) > MAX_DROP) continue;
          }
          const h = diag ? DIAG : CELL;
          // relax (inlined): within the radius, improving, and inside the field size cap when new
          const d = f + (dh === 0 ? h : Math.sqrt(h * h + dh * dh));
          if (d > R) continue;
          const old = work[u];
          if (d >= old) continue;
          if (old === Infinity) { if (count >= cap) continue; list[count++] = u; }
          work[u] = d;
          this.push(u, d);
        }
      }
      if (this.twinFlag[v] || this.linkFlag[v]) {
        this.workCount = count;
        if (this.twinFlag[v]) for (const u of this.twins.get(v)!) this.relax(u, f);
        if (this.linkFlag[v]) for (const l of this.linkTo.get(v)!) this.relax(l.n, f + l.cost);
        count = this.workCount;
      }
    }
    this.workCount = count;
    if (settled > this.stats.maxStep) this.stats.maxStep = settled;
    if (this.heapSize === 0) this.finish();
  }

  private relax(u: number, d: number): void {
    if (d > this.radius || this.fl[u] !== this.fl[u]) return;
    const old = this.work[u];
    if (d >= old) return;
    if (old === Infinity) {
      if (this.workCount >= this.maxNodes) return; // field size cap: nearest nodes first, the rest stays Infinity
      this.workList[this.workCount++] = u;
    }
    this.work[u] = d;
    this.push(u, d);
  }

  /** Drop the build in progress (its touched nodes back to Infinity / open). */
  private abort(): void {
    const list = this.workList, closed = this.closed, work = this.work;
    for (let i = 0; i < this.workCount; i++) { closed[list[i]] = 0; work[list[i]] = Infinity; }
    this.workCount = 0;
    this.heapSize = 0;
    this.buildingNow = false;
  }

  private finish(): void {
    const list = this.workList, closed = this.closed;
    for (let i = 0; i < this.workCount; i++) closed[list[i]] = 0;
    const f = this.front; this.front = this.work; this.work = f;
    const l = this.frontList; this.frontList = this.workList; this.workList = l;
    const c = this.frontCount; this.frontCount = this.workCount; this.workCount = c;
    this.frontOk = true;
    this.frontKey = this.buildKey;
    const O = this.frontOrigin, B = this.buildOrigin;
    O.x = B.x; O.y = B.y; O.z = B.z; O.level = B.level;
    this.buildingNow = false;
    this.stats.completed++;
    this.stats.nodes = this.frontCount;
  }

  private push(i: number, f: number): void {
    if (this.heapSize >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2), hf = new Float32Array(this.heap.length * 2);
      h.set(this.heap); hf.set(this.heapF);
      this.heap = h; this.heapF = hf;
    }
    let k = this.heapSize++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.heapF[p] <= f) break;
      this.heap[k] = this.heap[p]; this.heapF[k] = this.heapF[p];
      k = p;
    }
    this.heap[k] = i; this.heapF[k] = f;
  }

  private pop(): number {
    const top = this.heap[0];
    const lastI = this.heap[--this.heapSize], lastF = this.heapF[this.heapSize];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.heapSize) break;
      if (c + 1 < this.heapSize && this.heapF[c + 1] < this.heapF[c]) c++;
      if (this.heapF[c] >= lastF) break;
      this.heap[k] = this.heap[c]; this.heapF[k] = this.heapF[c];
      k = c;
    }
    this.heap[k] = lastI; this.heapF[k] = lastF;
    return top;
  }

  // -------------------------------------------------------------------------------------------
  // Seeds / nodes

  /**
   * Seeds of a field from the player's feet at (x, y, z) into `out` as [node, metres] pairs (empty: sealed); returns the
   * start level (-1 when sealed / off grid). In a cab: the landing cells of its open gates (none while shut / moving).
   */
  private seeds(x: number, y: number, z: number, out: number[]): number {
    out.length = 0;
    if (this.playerVol) { this.gateSeeds(this.playerVol, x, y + 1, z, out); return out.length ? this.playerVol.level : -1; }
    const node = this.nodeAt(x, y, z);
    if (node >= 0) { out.push(node, 0); return (node / this.NC) | 0; }
    // off the walk grid: the nearest walkable node at this height (on a prop top, against a wall / doorway edge)
    const W = this.W, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= VOCAL_REACH.snap && best < 0; r++) {
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r || cx + ox < 0 || cy + oy < 0 || cx + ox >= W || cy + oy >= this.H) continue;
        const n = this.columnNode((cy + oy) * W + cx + ox, y);
        if (n < 0) continue;
        const d = Math.hypot((cx + ox + 0.5) * CELL - x, (cy + oy + 0.5) * CELL - z);
        if (d < bd) { bd = d; best = n; }
      }
    }
    if (best >= 0) { out.push(best, bd); return (best / this.NC) | 0; }
    // a cab doorway column (the passage through the shaft wall) while its gate is open
    for (const v of this.src?.dynamicVolumes ?? []) {
      if (x >= v.x0 - 1.5 && x <= v.x1 + 1.5 && z >= v.z0 - 1.5 && z <= v.z1 + 1.5 && y >= v.floorY - 0.5 && y <= v.ceilY) {
        this.gateSeeds(v, x, y + 1, z, out);
        if (out.length) return v.level;
      }
    }
    return -1;
  }

  /** [node, metres] pairs of the walkable cells in front of every OPEN gate of `v` at the cab's floor (none when shut). */
  private gateSeeds(v: DynamicVolume, px: number, py: number, pz: number, out: number[]): void {
    for (const g of v.gates) if (g.open) this.gateNodes(v, g, px, py, pz, out);
  }

  private gateNodes(v: DynamicVolume, g: VolumeGate, px: number, py: number, pz: number, out: number[]): void {
    const lo = Math.min(g.a0, g.a1), hi = Math.max(g.a0, g.a1), reach = Math.max(0, g.depth) + 2 * CELL;
    let x0: number, x1: number, z0: number, z1: number;
    if (g.side === 'N') { x0 = lo; x1 = hi; z0 = v.z0 - reach; z1 = v.z0; }
    else if (g.side === 'S') { x0 = lo; x1 = hi; z0 = v.z1; z1 = v.z1 + reach; }
    else if (g.side === 'W') { x0 = v.x0 - reach; x1 = v.x0; z0 = lo; z1 = hi; }
    else { x0 = v.x1; x1 = v.x1 + reach; z0 = lo; z1 = hi; }
    const W = this.W, NC = this.NC, fl = this.fl;
    for (let cy = Math.max(0, Math.floor(z0 / CELL)); cy <= Math.min(this.H - 1, Math.floor(z1 / CELL)); cy++) {
      for (let cx = Math.max(0, Math.floor(x0 / CELL)); cx <= Math.min(W - 1, Math.floor(x1 / CELL)); cx++) {
        const mx = (cx + 0.5) * CELL, mz = (cy + 0.5) * CELL;
        if (mx < x0 || mx > x1 || mz < z0 || mz > z1) continue;
        for (let k = 0; k < this.NL; k++) {
          const node = k * NC + cy * W + cx, f = fl[node];
          if (f !== f || Math.abs(f - v.floorY) > GATE_FLOOR_TOL) continue;
          out.push(node, Math.hypot(mx - px, f + 1 - py, mz - pz));
        }
      }
    }
  }

  /** Walkable node of column i for a point at height y (highest floor in [y - down, y + up]); -1 when none. */
  private columnNode(i: number, y: number): number {
    let best = -1, bf = -Infinity;
    for (let k = 0, node = i; k < this.NL; k++, node += this.NC) {
      const f = this.fl[node];
      if (f !== f || f > y + VOCAL_REACH.up || f < y - VOCAL_REACH.down) continue;
      if (f > bf) { bf = f; best = node; }
    }
    return best;
  }

  /** Walkable node under a point at height y (its own column only); -1 off the grid. */
  nodeAt(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return -1;
    return this.columnNode(cy * this.W + cx, y);
  }

  // -------------------------------------------------------------------------------------------
  // Lookups (O(1))

  /**
   * Navigable route (m) from the player to a source at (x, y, z) — y anywhere from its feet to ~2 m above them (a mouth).
   * Infinity: beyond `radius`, unreachable (another storey with no route in range, behind shut cab doors), or no field yet.
   * A source whose own column has no node (beside a wall / prop) takes the best neighbouring node plus that step.
   */
  pathTo(x: number, y: number, z: number): number {
    const vs = this.src?.dynamicVolumes;
    if (vs && vs.length && this.src?.volumeAt) {
      const v = this.src.volumeAt(x, z, y, 0.3);
      if (v) {
        const P = this.player;
        if (v === this.playerVol) return Math.hypot(x - P.x, y - (P.y + 1), z - P.z); // the same cab: right here
        if (!this.frontOk) return Infinity;
        const seeds = this.seedBuf;
        seeds.length = 0;
        this.gateSeeds(v, x, y, z, seeds); // an enemy in the cab: only through its open doors
        let best = Infinity;
        for (let i = 0; i < seeds.length; i += 2) { const d = this.front[seeds[i]] + seeds[i + 1]; if (d < best) best = d; }
        return best <= this.radius ? best : Infinity;
      }
    }
    if (!this.frontOk) return Infinity;
    const W = this.W, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < 0 || cy < 0 || cx >= W || cy >= this.H) return Infinity;
    const own = this.columnNode(cy * W + cx, y);
    if (own >= 0) return this.front[own];
    let best = Infinity;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if ((!ox && !oy) || cx + ox < 0 || cy + oy < 0 || cx + ox >= W || cy + oy >= this.H) continue;
      const n = this.columnNode((cy + oy) * W + cx + ox, y);
      if (n < 0) continue;
      const d = this.front[n] + (ox && oy ? DIAG : CELL);
      if (d < best) best = d;
    }
    return best <= this.radius ? best : Infinity;
  }
}
