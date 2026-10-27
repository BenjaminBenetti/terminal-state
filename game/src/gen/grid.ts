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

/** Path waypoint: world x/z; `link` = connector id when this point is reached by climbing it. */
export type Waypoint = [x: number, z: number, link?: number];

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
}

/**
 * A* over passable cells (8-connected, no corner cutting) with a wall/ledge-hugging penalty.
 * Height-aware: neighbours within NAV_STEP, optional one-way drops, nav links (ladders).
 * Walkability is snapshotted at construction (props never move), and the inner loop works on
 * flat typed arrays so long detours on the large station stay cheap. String pulling only looks a
 * bounded distance ahead (agents re-plan long before reaching the end of a long path).
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
  private cur = 1;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  /** Cells expanded by the last search (diagnostics). */
  lastExpanded = 0;
  constructor(private readonly grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.cameLink = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.heapF = new Float32Array(n);
    this.wallCost = new Float32Array(n);
    this.walk = new Uint8Array(n);
    this.fl = new Float32Array(n);
    this.linkFlag = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = grid.cells[i];
      this.walk[i] = (c === FLOOR || c === VOID) && grid.blocked[i] === 0 ? 1 : 0;
      this.fl[i] = grid.floorOf(i);
    }
    const W = grid.w, walk = this.walk, fl = this.fl;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!walk[i]) continue;
        let open = 1;
        for (let oy = -1; oy <= 1 && open; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= grid.h) { open = 0; break; }
          const k = ny * W + nx;
          if (!walk[k] || Math.abs(fl[k] - fl[i]) > NAV_STEP) { open = 0; break; }
        }
        this.wallCost[i] = open ? 0 : 0.6;
      }
    }
    for (const l of grid.links) { this.linkFlag[l.a] = 1; this.linkFlag[l.b] = 1; }
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
  /** Returns world-space waypoints (cell centres string-pulled; ladder ends marked) or null. */
  find(ax: number, az: number, bx: number, bz: number, radius = 0.3, maxExpand = 12000, opts: PathOpts = {}): Waypoint[] | null {
    const grid = this.grid;
    let [sx, sy] = grid.cellOf(ax, az);
    let [tx, ty] = grid.cellOf(bx, bz);
    if (!grid.passable(sx, sy)) {
      const n = nearestPassable(grid, sx, sy, 3, grid.floorAt(ax, az));
      if (!n) return null;
      [sx, sy] = n;
    }
    if (!grid.passable(tx, ty)) {
      const n = nearestPassable(grid, tx, ty, 3, grid.floorAt(bx, bz));
      if (!n) return null;
      [tx, ty] = n;
    }
    const W = grid.w;
    const start = sx + sy * W, goal = tx + ty * W;
    this.cur++;
    if (this.cur === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.cur = 1; }
    const cur = this.cur;
    const walk = this.walk, gArr = this.g, stamp = this.stamp, closed = this.closed, came = this.came, cameLink = this.cameLink, wallCost = this.wallCost, fl = this.fl, linkFlag = this.linkFlag;
    const drops = !!opts.drops;
    const links = grid.links, useLinks = !opts.noLinks;
    this.heapSize = 0;
    gArr[start] = 0;
    stamp[start] = cur;
    came[start] = -1;
    cameLink[start] = 0;
    const h = (x: number, y: number) => {
      const dx = x > tx ? x - tx : tx - x, dy = y > ty ? y - ty : ty - y;
      return dx > dy ? dx + 0.4142 * dy : dy + 0.4142 * dx;
    };
    this.push(start, h(sx, sy));
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0) {
      const c = this.pop();
      if (closed[c] === cur) continue;
      closed[c] = cur;
      if (c === goal) { found = true; break; }
      if (++expanded > maxExpand) break;
      const cx = c % W, cy = (c - cx) / W;
      const gc = gArr[c], fc = fl[c];
      for (let oy = -1; oy <= 1; oy++) {
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
          const ng = gc + (diag ? 1.4142 : 1) + wallCost[n] + extra;
          if (stamp[n] !== cur || ng < gArr[n]) {
            stamp[n] = cur;
            gArr[n] = ng;
            came[n] = c;
            cameLink[n] = 0;
            this.push(n, ng + h(cx + ox, cy + oy));
          }
        }
      }
      if (useLinks && linkFlag[c]) {
        for (const li of grid.linksAt(c)) {
          const l = links[li];
          const n = l.a === c ? l.b : l.a;
          if (!walk[n] || closed[n] === cur) continue;
          const ng = gc + l.cost;
          if (stamp[n] !== cur || ng < gArr[n]) {
            stamp[n] = cur;
            gArr[n] = ng;
            came[n] = c;
            cameLink[n] = li + 1;
            const nx = n % W;
            this.push(n, ng + h(nx, (n - nx) / W));
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
    let anchor: [number, number] = [ax, az];
    const segment = (from: number, to: number, end: [number, number]) => {
      const pts: [number, number][] = [];
      for (let k = from; k <= to; k++) pts.push(grid.center(cells[k] % W, Math.floor(cells[k] / W)));
      pts[pts.length - 1] = end;
      let i = 0;
      while (i < pts.length) {
        let j = Math.min(pts.length - 1, i + 48);
        while (j > i && !grid.walkLineClearH(anchor[0], anchor[1], pts[j][0], pts[j][1], radius)) j--;
        out.push([pts[j][0], pts[j][1]]);
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
      segment(segStart, k - 1, [ps.x, ps.z]);
      out.push([pe.x, pe.z, l.id]);
      anchor = [pe.x, pe.z];
      segStart = k;
    }
    segment(segStart, cells.length - 1, [bx, bz]);
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
