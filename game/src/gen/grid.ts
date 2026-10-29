// Cell grid shared by generation, collision, line-of-sight and AI navigation.
// One cell = 0.5 m. Grid x -> world X, grid y -> world Z.
//
// Heights (iteration 05, vertical traversal): every cell has a FLOOR HEIGHT (world y; 0 is the
// station's main level, the track bed sits below it, an underpass far below that). Stair flights
// are linear RAMPS over a rect of cells: `floorAt` is continuous along them (bodies walk the pitch
// line), `stepTop` is the visual/physical step profile. NAV LINKS join stand points that are not
// walkable neighbours (rescue ladders). Ceilings are absolute world y (an underpass has a negative
// ceiling). Bodies step up at most STEP_UP; navigation treats neighbours within NAV_STEP as
// walkable and lower ledges down to MAX_DROP as one-way drops (chasing zombies only).
//
// Legacy 2D helpers (walkable / impassable / circleClear / walkLineClear / nearestWalkable) keep
// their iteration-04 meaning (FLOOR cells only) for dressing and spawning; height-aware movement
// uses passable / circleClearH / walkLineClearH / PathFinder.

export const CELL = 0.5;
export const SOLID = 0;
export const FLOOR = 1;
/** Track bed: transparent to bullets/sight; walkable at its own (lower) floor height. */
export const VOID = 2;

/** Highest ledge a walking body steps up without climbing (m). */
export const STEP_UP = 0.45;
/** Neighbouring cells whose floors differ by at most this are walkable neighbours for nav (m). */
export const NAV_STEP = 0.45;
/** Deepest ledge a chasing zombie drops off (m): the platform edge into the track bed. */
export const MAX_DROP = 1.6;
/** Extra nav cost (cell steps) of a drop. */
export const DROP_COST = 3;
/** Floor of VOID cells that carry no explicit height (hand-built test grids). */
export const DEFAULT_VOID_FLOOR = -1.15;

/** A stair flight's walking surface: a linear ramp from (s0, h0) to (s1, h1) along `axis`. */
export interface Ramp {
  /** Covered cells (every cell the pitch line crosses, full flight width). */
  x: number; y: number; w: number; h: number;
  axis: 'x' | 'z';
  /** World coordinate along the axis where the pitch line starts / ends, and the floor there. */
  s0: number; s1: number; h0: number; h1: number;
  /** Visual steps between h0 and h1 (the pitch line passes through every tread centre). */
  risers: number;
  /** Clear height above the pitch line (the ceiling follows the flight). */
  headroom: number;
}

export interface StandPoint { x: number; y: number; z: number }

/** Non-neighbour nav connection (e.g. a rescue ladder) between two stand points. */
export interface NavLink {
  /** Cell indices of the two ends. */
  a: number; b: number;
  /** Traversal cost in cell steps. */
  cost: number;
  /** Connector id (ladder id) reported on path waypoints. */
  id: number;
  /** World stand points at the a and b ends. */
  pa: StandPoint; pb: StandPoint;
}

/**
 * Path waypoint: world x/z; `link` = connector id when this point is reached by climbing it;
 * `y` (iteration 08, stacked stations only) = floor height of the point (its storey).
 */
export type Waypoint = [x: number, z: number, link?: number, y?: number];

export function rampHeight(r: Ramp, s: number): number {
  const t = (s - r.s0) / (r.s1 - r.s0);
  return r.h0 + (r.h1 - r.h0) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/** Step-profile height (tread tops) of a ramp at `s`: landings extend half a tread into the ramp. */
export function stepTop(r: Ramp, s: number): number {
  const u = (s - r.s0) / (r.s1 - r.s0) * r.risers;
  const k = Math.round(u < 0 ? 0 : u > r.risers ? r.risers : u);
  return r.h0 + (r.h1 - r.h0) * k / r.risers;
}

export class Grid {
  readonly cells: Uint8Array;
  readonly area: Int16Array;
  /** Movement-blocking prop footprint (nav + collision broadphase). */
  readonly blocked: Uint8Array;
  /** Prop footprint that also blocks sight (tall cabinets, columns). */
  readonly sightBlocked: Uint8Array;
  /** Ceiling (absolute world y). 0 together with floor 0 means "not set". */
  readonly ceil: Float32Array;
  /** Floor height at the cell centre (absolute world y). VOID cells with 0 use voidFloor. */
  readonly floor: Float32Array;
  /** Ramp (stair flight) index covering the cell, or -1. */
  readonly rampIdx: Int16Array;
  ramps: Ramp[] = [];
  links: NavLink[] = [];
  voidFloor = DEFAULT_VOID_FLOOR;
  private linkMap: Map<number, number[]> | null = null;
  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.cells = new Uint8Array(n);
    this.area = new Int16Array(n).fill(-1);
    this.blocked = new Uint8Array(n);
    this.sightBlocked = new Uint8Array(n);
    this.ceil = new Float32Array(n);
    this.floor = new Float32Array(n);
    this.rampIdx = new Int16Array(n).fill(-1);
  }
  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cells[y * this.w + x] : SOLID;
  }
  set(x: number, y: number, v: number): void {
    this.cells[y * this.w + x] = v;
  }
  isFloor(x: number, y: number): boolean {
    return this.get(x, y) === FLOOR;
  }
  /** FLOOR cell without a movement-blocking prop (dressing/spawning floor; the track bed is not). */
  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    return this.cells[i] === FLOOR && this.blocked[i] === 0;
  }
  /** A body can stand here at the cell's floor height (FLOOR or track bed, no blocking prop). */
  passable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    const c = this.cells[i];
    return (c === FLOOR || c === VOID) && this.blocked[i] === 0;
  }
  /** True for cells that stop sight and bullets. */
  opaque(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.w + x;
    return this.cells[i] === SOLID || this.sightBlocked[i] === 1;
  }
  /** Legacy (height-unaware): cells a body can never occupy (wall, track bed). */
  impassable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.cells[y * this.w + x] !== FLOOR;
  }
  areaAt(wx: number, wz: number): number {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    return this.inBounds(x, y) ? this.area[y * this.w + x] : -1;
  }
  cellOf(wx: number, wz: number): [number, number] {
    return [Math.floor(wx / CELL), Math.floor(wz / CELL)];
  }
  center(x: number, y: number): [number, number] {
    return [(x + 0.5) * CELL, (y + 0.5) * CELL];
  }

  // -------------------------------------------------------------------------------------------
  // Heights

  /** Floor height of cell index i (centre value on ramps). */
  floorOf(i: number): number {
    const f = this.floor[i];
    return f === 0 && this.cells[i] === VOID ? this.voidFloor : f;
  }
  cellFloor(x: number, y: number): number {
    return this.inBounds(x, y) ? this.floorOf(y * this.w + x) : 0;
  }
  /** Continuous walking-surface height at a world point (ramps interpolate). */
  floorAt(wx: number, wz: number): number {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    if (!this.inBounds(x, y)) return 0;
    const i = y * this.w + x;
    const r = this.rampIdx[i];
    if (r < 0) return this.floorOf(i);
    const R = this.ramps[r];
    return rampHeight(R, R.axis === 'x' ? wx : wz);
  }
  /** Floor of cell (cx, cy) at its point nearest to (wx, wz) (collision step tests). */
  floorNear(cx: number, cy: number, wx: number, wz: number): number {
    const i = cy * this.w + cx;
    const r = this.rampIdx[i];
    if (r < 0) return this.floorOf(i);
    const R = this.ramps[r];
    const s = R.axis === 'x' ? Math.max(cx * CELL, Math.min(wx, (cx + 1) * CELL)) : Math.max(cy * CELL, Math.min(wz, (cy + 1) * CELL));
    return rampHeight(R, s);
  }
  /** Physical/visual surface (stair tread tops on ramps, else the floor). */
  stepAt(wx: number, wz: number): number {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    if (!this.inBounds(x, y)) return 0;
    const i = y * this.w + x;
    const r = this.rampIdx[i];
    if (r < 0) return this.floorOf(i);
    const R = this.ramps[r];
    return stepTop(R, R.axis === 'x' ? wx : wz);
  }
  /** Whether cell i carries a ceiling value (hand-built test grids leave it unset). */
  hasCeil(i: number): boolean {
    return this.ceil[i] !== 0 || this.floor[i] !== 0;
  }
  /** Ceiling at a world point (follows flights over ramps); Infinity if unset. */
  ceilAt(wx: number, wz: number): number {
    const x = Math.floor(wx / CELL), y = Math.floor(wz / CELL);
    if (!this.inBounds(x, y)) return Infinity;
    const i = y * this.w + x;
    const r = this.rampIdx[i];
    if (r >= 0) { const R = this.ramps[r]; return rampHeight(R, R.axis === 'x' ? wx : wz) + R.headroom; }
    return this.hasCeil(i) ? this.ceil[i] : Infinity;
  }
  /** Lowest floor of any carved cell (physics slab depth). */
  minFloor(): number {
    let m = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== SOLID) { const f = this.floorOf(i); if (f < m) m = f; }
    return m;
  }

  /** Registers a stair ramp: stamps its cells, sets their centre floors and flight-following ceilings. */
  addRamp(r: Ramp): number {
    const id = this.ramps.length;
    this.ramps.push(r);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = this.idx(x, y);
        this.rampIdx[i] = id;
        const [cx, cz] = this.center(x, y);
        this.floor[i] = rampHeight(r, r.axis === 'x' ? cx : cz);
        const a = (r.axis === 'x' ? x : y) * CELL;
        this.ceil[i] = Math.max(rampHeight(r, a), rampHeight(r, a + CELL)) + r.headroom;
      }
    }
    return id;
  }

  addLink(l: NavLink): number {
    this.links.push(l);
    this.linkMap = null;
    return this.links.length - 1;
  }
  /** Link indices touching cell index i. */
  linksAt(i: number): readonly number[] {
    if (!this.links.length) return NONE;
    if (!this.linkMap) {
      const m = new Map<number, number[]>();
      this.links.forEach((l, k) => { for (const e of [l.a, l.b]) { let a = m.get(e); if (!a) m.set(e, (a = [])); a.push(k); } });
      this.linkMap = m;
    }
    return this.linkMap.get(i) ?? NONE;
  }

  // -------------------------------------------------------------------------------------------
  // Sight

  /**
   * 2D DDA ray through the grid (world units). Returns distance to the first opaque cell
   * boundary, or maxDist. `ignoreProps` treats sight-blocking props as transparent.
   */
  raycast(ox: number, oz: number, dx: number, dz: number, maxDist: number, ignoreProps = false): number {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return maxDist;
    dx /= len;
    dz /= len;
    let x = Math.floor(ox / CELL), y = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaY = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (x + 1) * CELL - ox : ox - x * CELL) / Math.abs(dx)) : Infinity;
    let tMaxY = dz !== 0 ? ((dz > 0 ? (y + 1) * CELL - oz : oz - y * CELL) / Math.abs(dz)) : Infinity;
    let t = 0;
    for (let guard = 0; guard < 4096 && t <= maxDist; guard++) {
      const blocking = ignoreProps ? (!this.inBounds(x, y) || this.cells[y * this.w + x] === SOLID) : this.opaque(x, y);
      if (blocking) return t;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
      }
    }
    return maxDist;
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-6) return true;
    return this.raycast(ax, az, bx - ax, bz - az, d) >= d - 1e-4;
  }

  // -------------------------------------------------------------------------------------------
  // Clearance

  /** Legacy (FLOOR-only): circle (radius r) at world point is clear of impassable cells and blocked props. */
  circleClear(wx: number, wz: number, r: number): boolean {
    const x0 = Math.floor((wx - r) / CELL), x1 = Math.floor((wx + r) / CELL);
    const y0 = Math.floor((wz - r) / CELL), y1 = Math.floor((wz + r) / CELL);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.walkable(x, y)) continue;
        const cx = Math.max(x * CELL, Math.min(wx, (x + 1) * CELL));
        const cz = Math.max(y * CELL, Math.min(wz, (y + 1) * CELL));
        if ((wx - cx) ** 2 + (wz - cz) ** 2 < r * r) return false;
      }
    }
    return true;
  }

  /** Legacy (FLOOR-only): straight walk from a to b keeps a circle of radius r clear (sampled). */
  walkLineClear(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.circleClear(ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
    }
    return true;
  }

  /**
   * Height-aware: a circle standing at `feet` overlaps only passable cells whose floor (nearest
   * point) is within NAV_STEP of it — no walls, blocking props, ledges up or drops down.
   */
  circleClearH(wx: number, wz: number, r: number, feet: number): boolean {
    const x0 = Math.floor((wx - r) / CELL), x1 = Math.floor((wx + r) / CELL);
    const y0 = Math.floor((wz - r) / CELL), y1 = Math.floor((wz + r) / CELL);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.passable(x, y) && Math.abs(this.floorNear(x, y, wx, wz) - feet) <= NAV_STEP) continue;
        const cx = Math.max(x * CELL, Math.min(wx, (x + 1) * CELL));
        const cz = Math.max(y * CELL, Math.min(wz, (y + 1) * CELL));
        if ((wx - cx) ** 2 + (wz - cz) ** 2 < r * r) return false;
      }
    }
    return true;
  }

  /** Height-aware straight walk: clear circles along the line and no step/drop between samples. */
  walkLineClearH(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
    let prev = this.floorAt(ax, az);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const f = this.floorAt(px, pz);
      if (Math.abs(f - prev) > 0.3) return false;
      if (!this.circleClearH(px, pz, r, f)) return false;
      prev = f;
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Reachability

  /**
   * Walking distance (cells, 4-connected, ladders count one step) from a start cell; -1 =
   * unreachable. Height-aware: neighbours within NAV_STEP, one-way drops down to MAX_DROP
   * (platform edge into the track bed), nav links both ways.
   */
  distanceField(sx: number, sy: number): Int32Array {
    const W = this.w, n = W * this.h;
    const dist = new Int32Array(n).fill(-1);
    if (!this.passable(sx, sy)) return dist;
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const s = sx + sy * W;
    dist[s] = 0;
    q[tail++] = s;
    const cells = this.cells, blocked = this.blocked;
    const ok = (i: number) => (cells[i] === FLOOR || cells[i] === VOID) && blocked[i] === 0;
    const fl = new Float32Array(n);
    for (let i = 0; i < n; i++) fl[i] = this.floorOf(i);
    const nbs = [0, 0, 0, 0];
    while (head < tail) {
      const c = q[head++];
      const cx = c % W, cy = (c - cx) / W;
      const nd = dist[c] + 1;
      const fc = fl[c];
      nbs[0] = cx > 0 ? c - 1 : -1;
      nbs[1] = cx < W - 1 ? c + 1 : -1;
      nbs[2] = cy > 0 ? c - W : -1;
      nbs[3] = cy < this.h - 1 ? c + W : -1;
      for (let k = 0; k < 4; k++) {
        const nb = nbs[k];
        if (nb < 0 || dist[nb] >= 0 || !ok(nb)) continue;
        const dh = fl[nb] - fc;
        if (dh > NAV_STEP || dh < -MAX_DROP) continue;
        dist[nb] = nd;
        q[tail++] = nb;
      }
      if (this.links.length) for (const li of this.linksAt(c)) {
        const l = this.links[li];
        const o = l.a === c ? l.b : l.a;
        if (dist[o] < 0 && ok(o)) { dist[o] = nd; q[tail++] = o; }
      }
    }
    return dist;
  }
}

const NONE: readonly number[] = [];

export interface PathOpts {
  /** Allow one-way drops off ledges up to MAX_DROP (chasing zombies jump into the track bed). */
  drops?: boolean;
  /** Iteration 07 (Lane Q): ignore nav links (rescue ladders) — for actors that cannot climb (the quadruped). */
  noLinks?: boolean;
  /**
   * Iteration 08 (Lane B): feet heights of the start / goal. On stacked stations they pick the
   * level the actor / target stands on (omitted: the main level). Ignored on a single grid.
   */
  ay?: number;
  by?: number;
}

/** Iteration 08 (Lane B): a cross-level connection that is not a shared cell (a ladder between levels). */
export interface CrossLink { la: number; a: number; lb: number; b: number; cost: number; id: number; pa: StandPoint; pb: StandPoint }

/**
 * Iteration 08 (Lane B): multi-level nav source (gen/levels.ts `Levels` implements it). Levels are
 * same-size grids; list index === level id.
 */
export interface NavLevels {
  readonly list: readonly {readonly id: number; readonly grid: Grid}[];
  /** Ladder links between levels (node ends as level + cell). */
  crossLinks(): readonly CrossLink[];
  /** Level + floor an actor with feet at y stands on at (x, z); null when unsupported. */
  supportIn(x: number, z: number, y: number, tol?: number): {level: number; floor: number} | null;
  /** Height-aware straight walk from feet ay at a; `by` = the walk must end at that height. */
  walkLineClear(ax: number, ay: number, az: number, bx: number, bz: number, r: number, by?: number): boolean;
  /** Neighbour steps (level, cell a <-> cell b) a railing closes (deck edges, stairwells, flight sides). */
  blockedEdges?(): readonly {level: number; a: number; b: number}[];
}

/** Clear height a nav cell must offer on stacked stations (m; zombies stoop). */
const NAV_CLEAR = 1.6;

interface PathLink { a: number; b: number; cost: number; id: number; pa: StandPoint; pb: StandPoint }

/**
 * Task office-seamless-20261029 (ENGINE): stacks of more than this many levels (the 9-storey Office Space tower) give A* an
 * exact vertical term (PathFinder level distance fields); Subway stations (<= 3 levels) keep the 2D heuristic unchanged.
 */
export const LEVEL_HEURISTIC_MIN_LEVELS = 4;

export interface PathFinderOptions {
  /** Level distance fields for the A* heuristic (default: when the stack has >= LEVEL_HEURISTIC_MIN_LEVELS levels). */
  levelHeuristic?: boolean;
}

/**
 * A* over passable cells (8-connected, no corner cutting) with a wall/ledge-hugging penalty.
 * Height-aware: neighbours within NAV_STEP, optional one-way drops, nav links (ladders).
 * Walkability is snapshotted at construction (props never move), and the inner loop works on
 * flat typed arrays so long detours on the large station stay cheap. String pulling only looks a
 * bounded distance ahead (agents re-plan long before reaching the end of a long path).
 *
 * Iteration 08 (Lane B): nodes are (level, cell) on stacked stations (`new PathFinder(levels)`):
 * neighbours stay on their level grid; a cell open on two levels at the same floor height (a stair
 * flight carved into both grids) joins its two nodes with a free edge, so routes change storey only
 * along real stairs (or ladder links), never through a slab. Waypoints then carry the floor height
 * of the node as a 4th element. With a plain Grid it is exactly the single-level finder.
 */
export class PathFinder {
  private readonly g: Float32Array;
  private readonly came: Int32Array;
  private readonly cameLink: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly wallCost: Float32Array;
  private readonly walk: Uint8Array;
  private readonly fl: Float32Array;
  private readonly linkFlag: Uint8Array;
  private readonly twinFlag: Uint8Array;
  /** Railed edges per node: 1 = +x, 2 = -x, 4 = +y, 8 = -y (stacked stations). */
  private readonly edgeBlock: Uint8Array | null = null;
  private readonly twins = new Map<number, number[]>();
  private readonly links: PathLink[] = [];
  private readonly linkMap = new Map<number, number[]>();
  private readonly grids: Grid[];
  private readonly src: NavLevels | null;
  private readonly NC: number;
  private cur = 1;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  /** Cells expanded by the last search (diagnostics). */
  lastExpanded = 0;
  /**
   * Task office-seamless-20261029: per goal level, the exact least cost from every walkable node to ANY node of that level
   * over a superset of the search's edges (steps with their wall penalty, drops, stair hand-overs, links; corner and rail
   * rules ignored), indexed by
   * levelNode. The heuristic max(octile, levelDist[goal level][node]) is admissible and consistent, so routes across many
   * storeys expand little more than the route itself (a 2D-only heuristic floods every storey below the goal).
   */
  private levelDist: Float32Array[] | null = null;
  private levelNode: Int32Array | null = null;
  /**
   * Per level: its entry cells (nodes with a stair hand-over or a link: every route from another level enters through one).
   * Off the goal's level the heuristic is max(octile, levelDist + the octile distance of the goal's nearest entry cell).
   */
  private levelEntries: Int32Array[] | null = null;
  /** Build time of the level distance fields (ms; 0 when unused). */
  readonly levelHeuristicMs: number = 0;
  constructor(source: Grid | NavLevels, opts: PathFinderOptions = {}) {
    if (source instanceof Grid) { this.src = null; this.grids = [source]; }
    else { this.src = source.list.length > 1 ? source : null; this.grids = source.list.map(l => l.grid); }
    const g0 = this.grids[0];
    const W = g0.w, H = g0.h, NC = W * H, NL = this.grids.length, n = NC * NL;
    this.NC = NC;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.cameLink = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(Math.max(16, NC));
    this.heapF = new Float32Array(Math.max(16, NC));
    this.wallCost = new Float32Array(n);
    this.walk = new Uint8Array(n);
    this.fl = new Float32Array(n);
    this.linkFlag = new Uint8Array(n);
    this.twinFlag = new Uint8Array(n);
    const walk = this.walk, fl = this.fl;
    this.grids.forEach((grid, k) => {
      const o = k * NC;
      for (let i = 0; i < NC; i++) {
        const c = grid.cells[i];
        let w = (c === FLOOR || c === VOID) && grid.blocked[i] === 0 ? 1 : 0;
        // stacked stations: a cell under a low soffit / slab is not a place to stand
        if (w && NL > 1 && grid.hasCeil(i) && grid.ceil[i] - grid.floorOf(i) < NAV_CLEAR) w = 0;
        walk[o + i] = w;
        fl[o + i] = grid.floorOf(i);
      }
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = o + y * W + x;
          if (!walk[i]) continue;
          let open = 1;
          for (let oy = -1; oy <= 1 && open; oy++) for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) { open = 0; break; }
            const kk = o + ny * W + nx;
            if (!walk[kk] || Math.abs(fl[kk] - fl[i]) > NAV_STEP) { open = 0; break; }
          }
          this.wallCost[i] = open ? 0 : 0.6;
        }
      }
      for (const l of grid.links) this.addLink({a: o + l.a, b: o + l.b, cost: l.cost, id: l.id, pa: l.pa, pb: l.pb});
    });
    if (NL > 1) {
      // shared stair cells: the same column open on two levels at the same floor height
      for (let i = 0; i < NC; i++) {
        for (let a = 0; a < NL; a++) {
          const na = a * NC + i;
          if (!walk[na]) continue;
          for (let b = a + 1; b < NL; b++) {
            const nb = b * NC + i;
            if (!walk[nb] || Math.abs(fl[na] - fl[nb]) >= 0.05) continue;
            for (const [p, q] of [[na, nb], [nb, na]]) { let t = this.twins.get(p); if (!t) this.twins.set(p, (t = [])); t.push(q); this.twinFlag[p] = 1; }
          }
        }
      }
      for (const l of (source as NavLevels).crossLinks()) this.addLink({a: l.la * NC + l.a, b: l.lb * NC + l.b, cost: l.cost, id: l.id, pa: l.pa, pb: l.pb});
      // railings close neighbour steps (a drop off a flight side / deck edge the motor could never take)
      const be = (source as NavLevels).blockedEdges?.() ?? [];
      if (be.length) {
        const eb = (this.edgeBlock = new Uint8Array(n));
        for (const e of be) {
          const na = e.level * NC + e.a, nb = e.level * NC + e.b, d = e.b - e.a;
          const bit = d === 1 ? 1 : d === -1 ? 2 : d === W ? 4 : d === -W ? 8 : 0;
          if (!bit) continue;
          eb[na] |= bit;
          eb[nb] |= bit === 1 ? 2 : bit === 2 ? 1 : bit === 4 ? 8 : 4;
        }
      }
    }
    if (NL > 1 && (opts.levelHeuristic ?? NL >= LEVEL_HEURISTIC_MIN_LEVELS)) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      this.buildLevelDistance(W, H);
      (this as {levelHeuristicMs: number}).levelHeuristicMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    }
  }

  /** Least cost from every walkable node to any node of each level (reverse Dijkstra per level; see levelDist). */
  private buildLevelDistance(W: number, H: number): void {
    const NC = this.NC, NL = this.grids.length, n = NC * NL, walk = this.walk, fl = this.fl;
    const idx = new Int32Array(n).fill(-1);
    let M = 0;
    for (let i = 0; i < n; i++) if (walk[i]) idx[i] = M++;
    const nodes = new Int32Array(M);
    for (let i = 0; i < n; i++) if (idx[i] >= 0) nodes[idx[i]] = i;
    this.levelNode = idx;
    this.levelDist = [];
    this.levelEntries = [];
    for (let L = 0; L < NL; L++) {
      const e: number[] = [];
      for (let ci = 0; ci < NC; ci++) { const v = L * NC + ci; if (walk[v] && (this.twinFlag[v] || this.linkFlag[v])) e.push(ci); }
      this.levelEntries.push(Int32Array.from(e));
    }
    let heap = new Int32Array(Math.max(16, M)), heapF = new Float32Array(Math.max(16, M)), size = 0;
    const push = (v: number, f: number) => {
      if (size >= heap.length) { const h2 = new Int32Array(heap.length * 2), f2 = new Float32Array(heap.length * 2); h2.set(heap); f2.set(heapF); heap = h2; heapF = f2; }
      let k = size++;
      while (k > 0) { const p = (k - 1) >> 1; if (heapF[p] <= f) break; heap[k] = heap[p]; heapF[k] = heapF[p]; k = p; }
      heap[k] = v; heapF[k] = f;
    };
    const pop = (): number => {
      const top = heap[0], lastI = heap[--size], lastF = heapF[size];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= size) break;
        if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
        if (heapF[c] >= lastF) break;
        heap[k] = heap[c]; heapF[k] = heapF[c]; k = c;
      }
      heap[k] = lastI; heapF[k] = lastF;
      return top;
    };
    for (let L = 0; L < NL; L++) {
      const D = new Float32Array(M).fill(Infinity);
      size = 0;
      for (let i = L * NC; i < (L + 1) * NC; i++) if (idx[i] >= 0) { D[idx[i]] = 0; push(i, 0); }
      while (size > 0) {
        const f = heapF[0], v = pop(), dv = D[idx[v]];
        if (f > dv) continue;
        const lv = Math.floor(v / NC), ci = v - lv * NC, cx = ci % W, cy = (ci - cx) / W, fv = fl[v], wc = this.wallCost[v];
        const relax = (u: number, c: number) => { const k = idx[u], nd = dv + c; if (k >= 0 && nd < D[k]) { D[k] = nd; push(u, nd); } };
        // walking predecessors u -> v (steps either way within NAV_STEP; a straight drop from above)
        for (let oy = -1; oy <= 1; oy++) {
          if (cy + oy < 0 || cy + oy >= H) continue;
          for (let ox = -1; ox <= 1; ox++) {
            if ((!ox && !oy) || cx + ox < 0 || cx + ox >= W) continue;
            const u = v + ox + oy * W;
            if (!walk[u]) continue;
            // the search's step cost into v, wall-hugging penalty included (corner / rail rules only remove edges)
            const dh = fv - fl[u], diag = ox !== 0 && oy !== 0;
            if (dh <= NAV_STEP && dh >= -NAV_STEP) relax(u, (diag ? 1.4142 : 1) + wc);
            else if (!diag && dh < -NAV_STEP && dh >= -MAX_DROP) relax(u, 1 + wc + DROP_COST);
          }
        }
        if (this.twinFlag[v]) for (const u of this.twins.get(v)!) relax(u, 0.01);
        if (this.linkFlag[v]) for (const li of this.linkMap.get(v)!) { const l = this.links[li]; relax(l.a === v ? l.b : l.a, l.cost); }
      }
      this.levelDist.push(D);
    }
  }
  private addLink(l: PathLink): void {
    const li = this.links.length;
    this.links.push(l);
    for (const e of [l.a, l.b]) { let m = this.linkMap.get(e); if (!m) this.linkMap.set(e, (m = [])); m.push(li); this.linkFlag[e] = 1; }
  }
  private push(i: number, f: number) {
    if (this.heapSize >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2), hf = new Float32Array(this.heap.length * 2);
      h.set(this.heap); hf.set(this.heapF);
      this.heap = h; this.heapF = hf;
    }
    let k = this.heapSize++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.heapF[p] <= f) break;
      this.heap[k] = this.heap[p];
      this.heapF[k] = this.heapF[p];
      k = p;
    }
    this.heap[k] = i;
    this.heapF[k] = f;
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
      this.heap[k] = this.heap[c];
      this.heapF[k] = this.heapF[c];
      k = c;
    }
    this.heap[k] = lastI;
    this.heapF[k] = lastF;
    return top;
  }
  /** Level index (list position) an actor with feet at y stands on at (x, z); main level when unknown. */
  private levelOf(x: number, z: number, y: number | undefined): number {
    if (!this.src || y === undefined) return 0;
    const s = this.src.supportIn(x, z, y + 0.05, STEP_UP);
    if (!s) return 0;
    const k = this.src.list.findIndex(l => l.id === s.level);
    return k < 0 ? 0 : k;
  }
  /**
   * Returns world-space waypoints (cell centres string-pulled; ladder ends marked; on stacked
   * stations each with its floor height) or null.
   */
  find(ax: number, az: number, bx: number, bz: number, radius = 0.3, maxExpand = 12000, opts: PathOpts = {}): Waypoint[] | null {
    const multi = this.src !== null;
    const la = this.levelOf(ax, az, opts.ay), lb = this.levelOf(bx, bz, opts.by);
    const ga = this.grids[la], gb = this.grids[lb];
    let [sx, sy] = ga.cellOf(ax, az);
    let [tx, ty] = gb.cellOf(bx, bz);
    if (!ga.passable(sx, sy)) {
      const n = nearestPassable(ga, sx, sy, 3, multi && opts.ay !== undefined ? opts.ay : ga.floorAt(ax, az));
      if (!n) return null;
      [sx, sy] = n;
    }
    if (!gb.passable(tx, ty)) {
      const n = nearestPassable(gb, tx, ty, 3, multi && opts.by !== undefined ? opts.by : gb.floorAt(bx, bz));
      if (!n) return null;
      [tx, ty] = n;
    }
    const W = ga.w, H = ga.h, NC = this.NC;
    const start = la * NC + sx + sy * W, goal = lb * NC + tx + ty * W;
    this.cur++;
    if (this.cur === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.cur = 1; }
    const cur = this.cur;
    const walk = this.walk, gArr = this.g, stamp = this.stamp, closed = this.closed, came = this.came, cameLink = this.cameLink, wallCost = this.wallCost, fl = this.fl, linkFlag = this.linkFlag, twinFlag = this.twinFlag, eb = this.edgeBlock;
    const drops = !!opts.drops;
    const links = this.links, useLinks = !opts.noLinks;
    this.heapSize = 0;
    gArr[start] = 0;
    stamp[start] = cur;
    came[start] = -1;
    cameLink[start] = 0;
    const h2 = (x: number, y: number) => {
      const dx = x > tx ? x - tx : tx - x, dy = y > ty ? y - ty : ty - y;
      return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx;
    };
    // Task office-seamless-20261029: tall stacks add the exact least cost to reach the goal's level (Infinity: that node
    // can never reach it - not pushed).
    const LD = this.levelDist ? this.levelDist[lb] : null, LN = this.levelNode!;
    let entry = 0;
    if (LD) {
      // a route from another level enters the goal's level at one of its entry cells, then still walks to the goal
      entry = Infinity;
      for (const ci of this.levelEntries![lb]) { const v = h2(ci % W, (ci - ci % W) / W); if (v < entry) entry = v; }
      if (entry === Infinity) entry = 0;
    }
    const lo = lb * NC, hi = lo + NC;
    const h = LD ? (node: number, x: number, y: number) => {
      const o = h2(x, y);
      if (node >= lo && node < hi) return o;
      const d = LD[LN[node]] + entry;
      return d > o ? d : o;
    } : (_node: number, x: number, y: number) => h2(x, y);
    this.push(start, h(start, sx, sy));
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0) {
      const c = this.pop();
      if (closed[c] === cur) continue;
      closed[c] = cur;
      if (c === goal) { found = true; break; }
      if (++expanded > maxExpand) break;
      const lv = Math.floor(c / NC), ci = c - lv * NC;
      const cx = ci % W, cy = (ci - cx) / W;
      const gc = gArr[c], fc = fl[c];
      for (let oy = -1; oy <= 1; oy++) {
        if (cy + oy < 0 || cy + oy >= H) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          if (cx + ox < 0 || cx + ox >= W) continue;
          const n = c + ox + oy * W;
          if (!walk[n] || closed[n] === cur) continue;
          const diag = ox !== 0 && oy !== 0;
          const dh = fl[n] - fc;
          let extra = 0;
          if (dh > NAV_STEP || dh < -NAV_STEP) {
            if (dh > 0 || !drops || diag || dh < -MAX_DROP) continue;
            extra = DROP_COST;
          }
          if (diag) {
            const a1 = c + ox, a2 = c + oy * W;
            if (!walk[a1] || !walk[a2] || Math.abs(fl[a1] - fc) > NAV_STEP || Math.abs(fl[a2] - fc) > NAV_STEP) continue;
          }
          if (eb) {
            const bx = ox > 0 ? 1 : 2, by = oy > 0 ? 4 : 8;
            if (!diag ? eb[c] & (ox ? bx : by) : (eb[c] & (bx | by)) || (eb[c + ox] & by) || (eb[c + oy * W] & bx)) continue;
          }
          const ng = gc + (diag ? 1.4142 : 1) + wallCost[n] + extra;
          if (stamp[n] !== cur || ng < gArr[n]) {
            const hn = h(n, cx + ox, cy + oy);
            if (hn === Infinity) continue;
            stamp[n] = cur;
            gArr[n] = ng;
            came[n] = c;
            cameLink[n] = 0;
            this.push(n, ng + hn);
          }
        }
      }
      if (twinFlag[c]) {
        // the same stair cell on another level (free hand-over)
        for (const n of this.twins.get(c)!) {
          if (closed[n] === cur) continue;
          const ng = gc + 0.01;
          if (stamp[n] !== cur || ng < gArr[n]) {
            const hn = h(n, cx, cy);
            if (hn === Infinity) continue;
            stamp[n] = cur;
            gArr[n] = ng;
            came[n] = c;
            cameLink[n] = 0;
            this.push(n, ng + hn);
          }
        }
      }
      if (useLinks && linkFlag[c]) {
        for (const li of this.linkMap.get(c)!) {
          const l = links[li];
          const n = l.a === c ? l.b : l.a;
          if (!walk[n] || closed[n] === cur) continue;
          const ng = gc + l.cost;
          if (stamp[n] !== cur || ng < gArr[n]) {
            const nc = n - Math.floor(n / NC) * NC, nx = nc % W;
            const hn = h(n, nx, (nc - nx) / W);
            if (hn === Infinity) continue;
            stamp[n] = cur;
            gArr[n] = ng;
            came[n] = c;
            cameLink[n] = li + 1;
            this.push(n, ng + hn);
          }
        }
      }
    }
    this.lastExpanded = expanded;
    if (!found) return null;
    const cells: number[] = [], via: number[] = [];
    for (let c = goal; c !== -1; c = came[c]) { cells.push(c); via.push(cameLink[c] - 1); }
    cells.reverse();
    via.reverse();
    // String pulling per walking segment (skip waypoints while a straight height-aware walk stays
    // clear, bounded look-ahead); ladder links split segments: [start stand point, end stand point + link].
    const out: Waypoint[] = [];
    const src = this.src;
    let anchor: [number, number, number] = [ax, az, multi && opts.ay !== undefined ? opts.ay : fl[start]];
    const clear = (a: [number, number, number], b: [number, number, number]) =>
      src ? src.walkLineClear(a[0], a[2], a[1], b[0], b[1], radius, b[2]) : ga.walkLineClearH(a[0], a[1], b[0], b[1], radius);
    const emit = (p: [number, number, number], link?: number) => { out.push(multi ? [p[0], p[1], link, p[2]] : link === undefined ? [p[0], p[1]] : [p[0], p[1], link]); };
    const segment = (from: number, to: number, end: [number, number, number]) => {
      const pts: [number, number, number][] = [];
      for (let k = from; k <= to; k++) { const ci = cells[k] % NC; const [x, z] = ga.center(ci % W, Math.floor(ci / W)); pts.push([x, z, fl[cells[k]]]); }
      pts[pts.length - 1] = end;
      let i = 0;
      while (i < pts.length) {
        let j = Math.min(pts.length - 1, i + 48);
        while (j > i && !clear(anchor, pts[j])) j--;
        emit(pts[j]);
        anchor = pts[j];
        i = j + 1;
      }
    };
    let segStart = 0;
    for (let k = 1; k < cells.length; k++) {
      if (via[k] < 0) continue;
      const l = links[via[k]];
      const fromA = l.a === cells[k - 1];
      const ps = fromA ? l.pa : l.pb, pe = fromA ? l.pb : l.pa;
      segment(segStart, k - 1, [ps.x, ps.z, ps.y]);
      emit([pe.x, pe.z, pe.y], l.id);
      anchor = [pe.x, pe.z, pe.y];
      segStart = k;
    }
    segment(segStart, cells.length - 1, [bx, bz, fl[goal]]);
    return out;
  }
}

/** Legacy (FLOOR-only) nearest walkable cell within a Chebyshev radius. */
export function nearestWalkable(grid: Grid, x: number, y: number, maxR: number): [number, number] | null {
  if (grid.walkable(x, y)) return [x, y];
  for (let r = 1; r <= maxR; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        if (grid.walkable(x + ox, y + oy)) return [x + ox, y + oy];
      }
    }
  }
  return null;
}

/** Nearest passable cell, preferring floors within NAV_STEP of `nearY` (same level). */
export function nearestPassable(grid: Grid, x: number, y: number, maxR: number, nearY?: number): [number, number] | null {
  const ok = (cx: number, cy: number) => grid.passable(cx, cy) && (nearY === undefined || Math.abs(grid.cellFloor(cx, cy) - nearY) <= NAV_STEP);
  for (const strict of nearY === undefined ? [false] : [true, false]) {
    const test = strict ? ok : (cx: number, cy: number) => grid.passable(cx, cy);
    if (test(x, y)) return [x, y];
    for (let r = 1; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (test(x + ox, y + oy)) return [x + ox, y + oy];
        }
      }
    }
  }
  return null;
}
