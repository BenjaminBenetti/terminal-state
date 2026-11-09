// Task gasmask-breach-20261030 (lane GAS): the local infectious gas that pours in through a breached office window — ONE
// authoritative concentration field per gassed office storey, shared by the volumetric fog (render/volumetric.ts draws its
// R8 layers) and the player's exposure (world/gas/system.ts samples concentrationAt at the eye). Pure: no three.js / DOM.
//
// Model — a bounded approximation, not a fluid solver:
//  - c in [0, 1] per 0.5 m cell of that storey's own level grid (Float32). A cell is gas-open iff it is a non-solid cell of
//    THAT storey's grid inside the tower footprint and outside the elevator shaft. Walls block it (no flux into a closed
//    cell); every office opening is an open gap in the grid (no door leaves except the elevator's), so gas passes through
//    real openings only and the flux scales with their width. Storeys never exchange gas (stair cores are stamped into both
//    grids, but each storey's field is separate).
//  - explicit diffusion (D) with first-order decay (+ the pool fill below), on a fixed 10 Hz tick split into stable
//    substeps (explicit 2D diffusion needs D·dt/dx² ≤ 1/4: 3 substeps per 0.1 s tick at D 1.6 m²/s, dx 0.5 m), only over an
//    active bounding box that grows one cell per substep where the front reaches it (cost ∝ cells the gas has reached).
//  - pool / spill: the cells of the breach's ROOM within POOL_RADIUS_M walking metres of the pane are its pool: what reaches
//    them keeps growing toward the cap (FILL_RATE: the breach's inflow fills the room behind the front) and decays slowly
//    (K_POOL); everything else only decays, fast (K_SPILL: a spill length sqrt(D / K_SPILL) ≈ 1.8 m), so a doorway lets a
//    modest tongue into the hallway and an open plan / corridor-end window still fills only ~10 m of its space.
//  - sources: the room-side cells along a broken pane inject c += SOURCE_RATE·(1 − c)·dt. Overlapping breaches share the
//    field: they combine and saturate at the cap (1), never stack beyond it; cost does not grow with the breach count.
//  - a storey whose field stopped changing sleeps (no ticks, no uploads) until another breach on it.
// Height: gas fills floor..ceiling, heavier low: f(h) = 1 − HEIGHT_FALLOFF·h/ceilingHeight (shader mirror in
// render/volumetricShaders.ts). The exposure sample is bilinear on the cells × f (the R8 texture's linear filter).

import {CELL, SOLID} from '../../gen/grid';

/**
 * Every gas tuning value (first pass; DESIGN.md §3). Field: D, decay, pool radius, source; exposure: threshold / dps;
 * render: extinction, tint, scatter, emission, noise. Times in s, lengths in m.
 */
export const GAS = {
  /** Diffusion coefficient (m²/s). */
  D: 1.6,
  /** Pool region: the breach room's cells within this walking distance of the pane decay at K_POOL (m). */
  POOL_RADIUS_M: 10,
  /**
   * Decay in the pool region / everywhere else (1/s). K_SPILL 0.5 (design first pass: 0.14) = a spill length
   * sqrt(D / K_SPILL) ≈ 1.8 m: measured on generated offices (tests/gas-field.test.ts), < 0.15 by 3.5 m beyond every
   * room's doorways, dead-end corridors included (0.14 / 0.35 left 0.27 / 0.19 there).
   */
  K_POOL: 0.004,
  K_SPILL: 0.5,
  /**
   * Pool fill (1/s): in the pool region c += FILL_RATE · c · (1 − c) · dt — the breach's inflow fills the room behind the
   * diffusion front (a travelling front, asymptotically 2·sqrt(D · FILL_RATE) ≈ 1.1 m/s); never outside the pool region.
   * Diffusion from the pane alone filled a meeting room to only ~0.3 in 120 s against its doorway leak (measured).
   */
  FILL_RATE: 0.2,
  /** Source cells: c += SOURCE_RATE · (1 − c) · dt (1/s). */
  SOURCE_RATE: 1.4,
  /** Concentration cap (overlapping breaches saturate here). */
  CAP: 1,
  /** Fixed simulation tick (Hz) and the largest explicit diffusion number per substep (stable below 0.25). */
  TICK_HZ: 10,
  MAX_R: 0.22,
  /** At most this many ticks per frame (a long frame drops the rest: no catch-up spiral). */
  MAX_TICKS_PER_FRAME: 3,
  /** Values below this are flushed to 0 (below one R8 step): bounds the active box. */
  FLUSH: 1 / 512,
  /** A storey whose largest change over one tick is below this sleeps until the next breach on it. */
  SLEEP_DELTA: 2e-5,
  /** Height profile f(h) = 1 − HEIGHT_FALLOFF · h / ceiling height. */
  HEIGHT_FALLOFF: 0.35,
  /** Breach age kept across a rebuild (s) and the fast-forward step (s) that replays it at section build. */
  AGE_CAP_S: 90,
  FAST_FORWARD_STEP_S: 0.5,
  // --- exposure (world/gas/system.ts) ---
  /** No damage below this eye concentration; dps = DPS_MAX · clamp((c − THRESHOLD) / (1 − THRESHOLD), 0, 1). */
  THRESHOLD: 0.12,
  DPS_MAX: 8,
  /** The HUD tag shows from this eye concentration (a warning before the damage threshold). */
  HUD_MIN: 0.06,
  /**
   * Task gas-mask-roof-feedback-20261030 (item 10): the outside atmosphere on the Office roof deck — the eye's outdoor
   * concentration = ROOF_OUTDOOR_C x the roof's outdoor weight (world/roofAir.ts roofBlend: 1 on the deck, ramping through the
   * ladder hatch, 0 indoors), through the same exposure path: 0.6 -> 8 x (0.6 - 0.12) / 0.88 ≈ 4.4 hp/s unprotected.
   */
  ROOF_OUTDOOR_C: 0.6,
  // --- render (render/volumetricShaders.ts gas term) ---
  /** Extinction per metre at c = 1 (1/m). */
  EXT: 1.1,
  /** In-scatter tint (linear rgb), single-scatter albedo of the lit gas and its small ambient emission (reads in the dark). */
  TINT: [0.42, 0.6, 0.28] as readonly [number, number, number],
  SCATTER: 0.55,
  EMISSION: 0.035,
  /** Wisps: ± modulation of c by the moving detail noise (mean 1) and the sample wobble (m, < half a cell: no bleed through a wall). */
  NOISE: 0.6,
  WOBBLE: 0.22,
} as const;

/** The height profile shared by the exposure sample and the march: 1 − HEIGHT_FALLOFF · h01 inside floor..ceiling. */
export function gasProfile(y: number, floor: number, ceil: number): number {
  const span = Math.max(ceil - floor, 0.5);
  const h = Math.min(1, Math.max(0, (y - floor) / span));
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const band = ss(floor - 0.15, floor, y) * (1 - ss(ceil, ceil + 0.15, y));
  return (1 - GAS.HEIGHT_FALLOFF * h) * band;
}

/** The parts of a level grid the field reads (gen/grid.ts Grid satisfies it). */
export interface GasGrid {
  w: number; h: number;
  cells: ArrayLike<number>;
  area: ArrayLike<number>;
  floor: ArrayLike<number>;
  ceil: ArrayLike<number>;
}

/** Cell rectangle [x0, x1) × [y0, y1) of the level grids the fields cover (the tower footprint). */
export interface GasDomain { x0: number; y0: number; x1: number; y1: number }

export interface GasFieldOptions {
  /** Covered cells (default: the whole grid). Fields, loops and uploads stay inside it. */
  domain?: GasDomain;
  /** Extra closed cells (grid column / row): e.g. the elevator shaft. */
  closed?: (cx: number, cy: number) => boolean;
}

/**
 * A breach as the field sees it: its storey and the grid indices of its source cells. Task studio-bunker-level-20261109-072224-01:
 * `strength` (0..1 of GAS.CAP, default the cap) = a weaker LOCAL LEAK (the Bunker's gas zones): its sources and its room's pool fill
 * toward that level instead of the cap (the visible fog and the exposure read the same field, so a weak leak both shows and hurts less).
 * Every breach at full strength keeps the original arithmetic exactly (no per-cell caps are allocated).
 */
export interface GasBreach { id: string; level: number; cells: readonly number[]; strength?: number }

/** Per-storey statistics (QA / tests). */
export interface GasStoreyStats {
  level: number;
  breaches: number;
  activeCells: number;
  max: number;
  /** Mean over the breach rooms' pool cells. */
  poolMean: number;
  poolCells: number;
  over015: number;
  asleep: boolean;
  box: [number, number, number, number] | null;
}

/** One gassed storey: concentration, the open mask, per-cell decay (pool / spill), sources, the active box. */
export class StoreyGas {
  /** Concentration (domain-local cells, row-major dw × dh). */
  c: Float32Array;
  private next: Float32Array;
  readonly open: Uint8Array;
  /** 1 = pool region of a breach room (fill + K_POOL), 0 = spill (K_SPILL). */
  readonly pool: Uint8Array;
  readonly src: Uint8Array;
  readonly breaches: string[] = [];
  /**
   * Task studio-bunker-level-20261109-072224-01: per-cell fill levels of the pool / source cells once a WEAKER source joined this storey
   * (the strongest breach reaching a cell wins); null while every source is at the cap (the original path, bit-identical).
   */
  private poolCap: Float32Array | null = null;
  private srcCap: Float32Array | null = null;
  /** Active box (domain-local, inclusive); x0 > x1 = empty. */
  x0 = 1; y0 = 1; x1 = 0; y1 = 0;
  asleep = false;
  /** Changed since the last drainChanged() (render upload). */
  dirty = false;

  constructor(readonly level: number, readonly grid: GasGrid, readonly dw: number, readonly dh: number, readonly ox: number, readonly oy: number, closed?: (cx: number, cy: number) => boolean) {
    const n = dw * dh;
    this.c = new Float32Array(n);
    this.next = new Float32Array(n);
    this.open = new Uint8Array(n);
    this.pool = new Uint8Array(n);
    this.src = new Uint8Array(n);
    // a closed one-cell ring round the domain: interior cells never index outside the arrays
    for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
      const cx = x + ox, cy = y + oy;
      if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) continue;
      if (grid.cells[cy * grid.w + cx] === SOLID || closed?.(cx, cy)) continue;
      this.open[y * dw + x] = 1;
    }
  }

  get active(): boolean { return this.x0 <= this.x1; }

  /** Domain-local index of grid index gi (-1 outside the domain). */
  local(gi: number): number {
    const cx = gi % this.grid.w, cy = (gi - cx) / this.grid.w;
    const x = cx - this.ox, y = cy - this.oy;
    return x < 0 || y < 0 || x >= this.dw || y >= this.dh ? -1 : y * this.dw + x;
  }

  /** Adds sources + the pool region of their room; false when none of the cells is gas-open. `strength`: GasBreach.strength. */
  addSources(id: string, cells: readonly number[], strength: number = GAS.CAP): boolean {
    const loc = cells.map(gi => this.local(gi)).filter(i => i >= 0 && this.open[i]);
    if (!loc.length) return false;
    const s = Math.min(GAS.CAP, Math.max(0, strength));
    if (s < GAS.CAP && !this.poolCap) {
      // the first weaker source: per-cell fill levels, every cell an earlier (full-strength) breach already holds at the cap
      const n = this.dw * this.dh;
      this.poolCap = new Float32Array(n);
      this.srcCap = new Float32Array(n);
      for (let i = 0; i < n; i++) { if (this.pool[i]) this.poolCap[i] = GAS.CAP; if (this.src[i]) this.srcCap[i] = GAS.CAP; }
    }
    this.breaches.push(id);
    for (const i of loc) {
      this.src[i] = 1;
      if (this.srcCap) this.srcCap[i] = Math.max(this.srcCap[i], s);
      const x = i % this.dw, y = (i - x) / this.dw;
      this.grow(x, y);
    }
    const marked: number[] = [];
    this.markPool(loc, marked);
    if (this.poolCap) for (const i of marked) this.poolCap[i] = Math.max(this.poolCap[i], s);
    this.asleep = false;
    this.dirty = true;
    return true;
  }

  private grow(x: number, y: number): void {
    if (!this.active) { this.x0 = this.x1 = x; this.y0 = this.y1 = y; return; }
    this.x0 = Math.min(this.x0, x); this.x1 = Math.max(this.x1, x);
    this.y0 = Math.min(this.y0, y); this.y1 = Math.max(this.y1, y);
  }

  /**
   * Pool region: the cells of the sources' room (their most common area id) within POOL_RADIUS_M walking metres of them
   * (chamfer distance on the open cells of that room, no corner cutting) decay at K_POOL.
   */
  private markPool(loc: readonly number[], out?: number[]): void {
    const g = this.grid, dw = this.dw;
    const areaOf = (i: number) => { const x = i % dw, y = (i - x) / dw; return g.area[(y + this.oy) * g.w + x + this.ox]; };
    const tally = new Map<number, number>();
    for (const i of loc) tally.set(areaOf(i), (tally.get(areaOf(i)) ?? 0) + 1);
    let room = -1, best = -1;
    for (const [a, k] of tally) if (k > best) { best = k; room = a; }
    // Dial's algorithm, weights in 0.1 m (orthogonal 5 = 0.5 m, diagonal 7 ≈ 0.707 m)
    const R = Math.round(GAS.POOL_RADIUS_M * 10);
    const dist = new Map<number, number>();
    const buckets: number[][] = Array.from({length: R + 8}, () => []);
    const ok = (i: number) => this.open[i] === 1 && areaOf(i) === room;
    for (const i of loc) { dist.set(i, 0); buckets[0].push(i); }
    for (let d = 0; d <= R; d++) {
      const b = buckets[d];
      for (let q = 0; q < b.length; q++) {
        const i = b[q];
        if (dist.get(i) !== d) continue;
        this.pool[i] = 1;
        out?.push(i);
        for (const [dx, dy, w] of NEIGH) {
          const j = i + dx + dy * dw;
          if (!ok(j)) continue;
          if (dx && dy && (!ok(i + dx) || !ok(i + dy * dw))) continue;
          const nd = d + w;
          if (nd > R || (dist.get(j) ?? Infinity) <= nd) continue;
          dist.set(j, nd);
          buckets[nd].push(j);
        }
      }
    }
  }

  /** One explicit substep of length dt over the active box (grows it where the front reaches its edge). Returns max |Δc|. */
  step(dt: number): number {
    if (!this.active) return 0;
    if (this.poolCap) return this.stepCapped(dt);
    const dw = this.dw, c = this.c, nx = this.next, open = this.open, pool = this.pool, src = this.src;
    const r = GAS.D * dt / (CELL * CELL);
    const keep = Math.exp(-GAS.SOURCE_RATE * dt);
    const cap = GAS.CAP, flush = GAS.FLUSH, fill = GAS.FILL_RATE * dt, kPool = GAS.K_POOL * dt, kSpill = GAS.K_SPILL * dt;
    const {x0, y0, x1, y1} = this;
    let maxD = 0, gx0 = false, gx1 = false, gy0 = false, gy1 = false;
    for (let y = y0; y <= y1; y++) {
      let i = y * dw + x0;
      for (let x = x0; x <= x1; x++, i++) {
        if (!open[i]) continue;
        const ci = c[i];
        let lap = 0;
        if (open[i - 1]) lap += c[i - 1] - ci;
        if (open[i + 1]) lap += c[i + 1] - ci;
        if (open[i - dw]) lap += c[i - dw] - ci;
        if (open[i + dw]) lap += c[i + dw] - ci;
        let v = ci + r * lap;
        // pool: the breach keeps pushing gas in — what reached the room grows toward the cap behind the front; spill: decays
        if (pool[i]) v += fill * v * (cap - v) - kPool * v; else v -= kSpill * v;
        if (src[i]) v = cap - (cap - v) * keep;
        if (v < flush) v = 0; else if (v > cap) v = cap;
        nx[i] = v;
        const d = v > ci ? v - ci : ci - v;
        if (d > maxD) maxD = d;
        if (v > 0) { if (x === x0) gx0 = true; if (x === x1) gx1 = true; if (y === y0) gy0 = true; if (y === y1) gy1 = true; }
      }
    }
    this.next = c;
    this.c = nx;
    // the front reached the box edge: the box takes one more cell there (never into the closed ring)
    if (gx0 && this.x0 > 1) this.x0--;
    if (gx1 && this.x1 < this.dw - 2) this.x1++;
    if (gy0 && this.y0 > 1) this.y0--;
    if (gy1 && this.y1 < this.dh - 2) this.y1++;
    return maxD;
  }

  /** Task studio-bunker-level-20261109-072224-01: step() with per-cell fill levels (a weaker source on this storey). */
  private stepCapped(dt: number): number {
    if (!this.active) return 0;
    const cp = this.poolCap!, cs = this.srcCap!;
    const dw = this.dw, c = this.c, nx = this.next, open = this.open, pool = this.pool, src = this.src;
    const r = GAS.D * dt / (CELL * CELL);
    const keep = Math.exp(-GAS.SOURCE_RATE * dt);
    const cap = GAS.CAP, flush = GAS.FLUSH, fill = GAS.FILL_RATE * dt, kPool = GAS.K_POOL * dt, kSpill = GAS.K_SPILL * dt;
    const {x0, y0, x1, y1} = this;
    let maxD = 0, gx0 = false, gx1 = false, gy0 = false, gy1 = false;
    for (let y = y0; y <= y1; y++) {
      let i = y * dw + x0;
      for (let x = x0; x <= x1; x++, i++) {
        if (!open[i]) continue;
        const ci = c[i];
        let lap = 0;
        if (open[i - 1]) lap += c[i - 1] - ci;
        if (open[i + 1]) lap += c[i + 1] - ci;
        if (open[i - dw]) lap += c[i - dw] - ci;
        if (open[i + dw]) lap += c[i + dw] - ci;
        let v = ci + r * lap;
        // pool: the breach keeps pushing gas in — what reached the room grows toward the cap behind the front; spill: decays
        if (pool[i]) v += fill * v * (cp[i] - v) - kPool * v; else v -= kSpill * v;
        if (src[i]) v = cs[i] - (cs[i] - v) * keep;
        if (v < flush) v = 0; else if (v > cap) v = cap;
        nx[i] = v;
        const d = v > ci ? v - ci : ci - v;
        if (d > maxD) maxD = d;
        if (v > 0) { if (x === x0) gx0 = true; if (x === x1) gx1 = true; if (y === y0) gy0 = true; if (y === y1) gy1 = true; }
      }
    }
    this.next = c;
    this.c = nx;
    // the front reached the box edge: the box takes one more cell there (never into the closed ring)
    if (gx0 && this.x0 > 1) this.x0--;
    if (gx1 && this.x1 < this.dw - 2) this.x1++;
    if (gy0 && this.y0 > 1) this.y0--;
    if (gy1 && this.y1 < this.dh - 2) this.y1++;
    return maxD;
  }

  /** Bilinear concentration at world (x, z) (cell centres at (i + 0.5)·CELL; the R8 texture's linear filter). */
  sample(x: number, z: number): number {
    const u = x / CELL - 0.5 - this.ox, v = z / CELL - 0.5 - this.oy;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const at = (a: number, b: number) => (a < 0 || b < 0 || a >= this.dw || b >= this.dh ? 0 : this.c[b * this.dw + a]);
    return (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
  }

  stats(): GasStoreyStats {
    let active = 0, max = 0, over = 0, poolSum = 0, poolN = 0;
    if (this.active) for (let y = this.y0; y <= this.y1; y++) for (let x = this.x0; x <= this.x1; x++) {
      const i = y * this.dw + x, v = this.c[i];
      if (!this.open[i]) continue;
      if (v > 0) active++;
      if (v > max) max = v;
      if (v > 0.15) over++;
    }
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i]) { poolSum += this.c[i]; poolN++; }
    return {
      level: this.level, breaches: this.breaches.length, activeCells: active, max, poolMean: poolN ? poolSum / poolN : 0, poolCells: poolN, over015: over,
      asleep: this.asleep, box: this.active ? [this.x0 + this.ox, this.y0 + this.oy, this.x1 + this.ox, this.y1 + this.oy] : null,
    };
  }
}

const NEIGH: readonly [number, number, number][] = [[1, 0, 5], [-1, 0, 5], [0, 1, 5], [0, -1, 5], [1, 1, 7], [1, -1, 7], [-1, 1, 7], [-1, -1, 7]];

/** The infectious gas of one built office world: a field per gassed storey (created lazily on its first breach). */
export class GasField {
  private readonly storeyMap = new Map<number, StoreyGas>();
  private readonly grids = new Map<number, GasGrid>();
  private readonly domain: GasDomain;
  private acc = 0;
  /** Simulation ticks run (QA). */
  ticks = 0;

  constructor(levels: readonly {id: number; grid: GasGrid}[], private readonly opts: GasFieldOptions = {}) {
    for (const l of levels) this.grids.set(l.id, l.grid);
    const g0 = levels[0]?.grid;
    const d = opts.domain ?? {x0: 0, y0: 0, x1: g0?.w ?? 0, y1: g0?.h ?? 0};
    // one closed cell of margin round the covered cells (see StoreyGas)
    this.domain = {x0: d.x0 - 1, y0: d.y0 - 1, x1: d.x1 + 1, y1: d.y1 + 1};
  }

  /** The covered cell rectangle (incl. the closed ring) — the render upload region. */
  get rect(): {x0: number; y0: number; w: number; h: number} {
    const d = this.domain;
    return {x0: d.x0, y0: d.y0, w: d.x1 - d.x0, h: d.y1 - d.y0};
  }

  /** Gassed storeys. */
  get storeys(): readonly StoreyGas[] {
    return [...this.storeyMap.values()];
  }

  storey(level: number): StoreyGas | null {
    return this.storeyMap.get(level) ?? null;
  }

  /** Starts a breach's sources on its storey (the storey's field is created now). False: unknown storey / no open cell. */
  addBreach(b: GasBreach): boolean {
    let s = this.storeyMap.get(b.level);
    if (!s) {
      const grid = this.grids.get(b.level);
      if (!grid) return false;
      const d = this.domain;
      s = new StoreyGas(b.level, grid, d.x1 - d.x0, d.y1 - d.y0, d.x0, d.y0, this.opts.closed);
      if (!s.addSources(b.id, b.cells, b.strength)) return false;
      this.storeyMap.set(b.level, s);
      return true;
    }
    return s.addSources(b.id, b.cells, b.strength);
  }

  /** Advances by play time dt on the fixed tick (at most MAX_TICKS_PER_FRAME ticks per call). Returns the ticks run. */
  tick(dt: number): number {
    const T = 1 / GAS.TICK_HZ;
    this.acc += Math.max(0, dt);
    let n = 0;
    while (this.acc >= T - 1e-9 && n < GAS.MAX_TICKS_PER_FRAME) { this.acc -= T; this.stepAll(T); n++; }
    if (n === GAS.MAX_TICKS_PER_FRAME && this.acc > T) this.acc = 0;
    return n;
  }

  /** Fast-forward `seconds` in coarse steps (each split into stable substeps): the same physics, no frame pacing. */
  advance(seconds: number, step: number = GAS.FAST_FORWARD_STEP_S): void {
    for (let t = 0; t < seconds - 1e-9; t += step) this.stepAll(Math.min(step, seconds - t));
  }

  /** Substeps for a time step dt (stable explicit diffusion). */
  static substeps(dt: number): number {
    return Math.max(1, Math.ceil(GAS.D * dt / (CELL * CELL) / GAS.MAX_R));
  }

  private stepAll(dt: number): void {
    const n = GasField.substeps(dt), h = dt / n;
    for (const s of this.storeyMap.values()) {
      if (s.asleep || !s.active) continue;
      let d = 0;
      for (let i = 0; i < n; i++) d = Math.max(d, s.step(h));
      s.dirty = true;
      if (d < GAS.SLEEP_DELTA) s.asleep = true;
    }
    this.ticks++;
  }

  /** Storeys whose field changed since the last call (the caller uploads their layers). */
  drainChanged(): StoreyGas[] {
    const out: StoreyGas[] = [];
    for (const s of this.storeyMap.values()) if (s.dirty) { s.dirty = false; out.push(s); }
    return out;
  }

  /**
   * The gas concentration at world (x, y, z) — bilinear on the cells of the storey whose band (floor..ceiling of that column)
   * holds y, times the height profile. The ONE sample exposure uses (the march mirrors it with wisps of mean 1).
   */
  concentrationAt(x: number, y: number, z: number): number {
    let best = 0;
    for (const s of this.storeyMap.values()) {
      if (!s.active) continue;
      const g = s.grid, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) continue;
      const gi = cy * g.w + cx;
      if (g.cells[gi] === SOLID) continue;
      const fl = g.floor[gi], ce = g.ceil[gi] !== 0 || fl !== 0 ? g.ceil[gi] : fl + 3;
      if (y < fl - 0.15 || y > ce + 0.15) continue;
      const c = s.sample(x, z) * gasProfile(y, fl, ce);
      if (c > best) best = c;
    }
    return best;
  }
}
