// Task track1-siren-blightbelly-20261031 (lane BLIGHT): TEMPORARY LOCAL gas puffs — the toxic cloud a Blightbelly's popped
// pustules release when it dies — on ANY level / storey (the Subway too: GasSystem.build only creates the window-breach
// field for office tower floors 1-8). Pure: no three.js / DOM. Same physics family as world/gas/field.ts:
//
//  - each puff owns a SMALL bounded domain around its burst (PUFF.HALF_EXTENT_M each way, + the closed one-cell ring) on the
//    burst storey's own level grid, created lazily by GasSystem.addPuff and dropped when the puff expires (no field is kept
//    for a level that never had a burst; the window-breach field / roof are untouched);
//  - c in [0, 1] per 0.5 m cell; a cell is gas-open iff it is a non-solid cell of THAT storey's grid (and not `closed`, e.g.
//    the office elevator shaft): walls block it exactly like the breach gas, storeys never exchange gas;
//  - the SAME explicit diffusion (GAS.D, the same 4-neighbour stencil, stable substeps at GAS.MAX_R) on the SAME fixed
//    GAS.TICK_HZ tick (at most GAS.MAX_TICKS_PER_FRAME per frame), flush below GAS.FLUSH, cap GAS.CAP;
//  - source: the open cells within PUFF.RADIUS_M WALKING metres of the burst cell (flood fill — never through a wall) are
//    pushed toward PUFF.PEAK (c += GAS.SOURCE_RATE · (peak − c) · dt, never above the peak) for PUFF.EMIT_S seconds;
//  - decay: PUFF.K_LINGER everywhere while it lingers (spill length sqrt(D / K) ≈ 3.3 m: a modest cloud, not a room fill),
//    then PUFF.K_FADE over the last PUFF.FADE_S seconds (strong enough that the peak is below GAS.FLUSH by the end); at
//    PUFF.DURATION_S the puff is GONE (disposed) — no pool region, no slow K_POOL decay, no permanent poisoning;
//  - bounded: at most PUFF.MAX_PUFFS live puffs; a burst within PUFF.COALESCE_M of a live puff on the same storey joins it
//    (its new source cells are added and its emission re-armed, once per burst) instead of making another; past the cap the
//    oldest puff is retired at once. A level / storey change, teardown or a new section clears every puff.
// Exposure / render: GasSystem.frame samples `concentrationAt` at the eye and adds it to the breach field, saturating at
// GAS.CAP (ONE exposure calculation, the same threshold / dps / mask / filter / cough path); the puffs' cells are uploaded
// into the same volumetric gas layer of their storey (render/volumetric.ts setGasLayer), composed with the breach field.

import {CELL, SOLID} from '../../gen/grid';
import {GAS, gasProfile, type GasGrid} from './field';

/** Every puff tuning value (Blightbelly death cloud; DESIGN numbers reported in lanes/BLIGHT.done). Times s, lengths m. */
export const PUFF = {
  /** Source: the open cells within this walking distance of the burst cell. */
  RADIUS_M: 1.5,
  /**
   * Source cells are pushed toward this concentration (never above it). Measured (tests/blightbelly-gas.test.ts): in the open
   * the eye-height concentration at the burst plateaus at ~0.42 (≈ 2.7 hp/s unprotected), ~0.3 at 1.5 m, ~0.13 at 3 m; a closed
   * 4 x 4 m room holds ~0.56 at the eye until the fade.
   */
  PEAK: 0.8,
  /** Seconds the source emits (the popped pustules keep seeping). */
  EMIT_S: 7,
  /** Whole life (emit, linger, fade): the puff is disposed at this age. */
  DURATION_S: 20,
  /** The last FADE_S seconds decay at K_FADE. */
  FADE_S: 6,
  /** Decay while emitting / lingering (1/s): spill length sqrt(D / K_LINGER) = 4 m. */
  K_LINGER: 0.1,
  /** Fade decay (1/s): PEAK · exp(−K_FADE · FADE_S) < GAS.FLUSH (0.8 · e^-6 ≈ 0.002 < 1/512 after diffusion / linger). */
  K_FADE: 1.0,
  /** Domain half extent around the burst (m): (2 · 14 + 1) cells + the closed ring = 31 x 31 cells at most. */
  HALF_EXTENT_M: 7,
  /** At most this many live puffs (bounded cost / uploads). */
  MAX_PUFFS: 4,
  /** A burst this close (m, same storey) to a live puff's centre joins it. */
  COALESCE_M: 2.5,
  /** Search radius (cells) for an open burst cell when the corpse point sits in a closed cell. */
  SNAP_CELLS: 2,
} as const;

/** A puff request (GasSystem.addPuff). `y` = the burst point's height (its storey's band must hold it). */
export interface PuffSpec {
  id: string;
  /** layout.levels index of the burst storey. */
  level: number;
  x: number; y: number; z: number;
  radius?: number;
  peak?: number;
  durationS?: number;
}

/** A level grid as the puffs read it (gen/grid.ts Grid satisfies it; `floorOf` = the VOID-aware floor). */
export interface PuffGrid extends GasGrid { floorOf?(i: number): number }

/** Per-puff statistics (QA / tests). */
export interface PuffStats {
  id: string;
  ids: string[];
  level: number;
  x: number; z: number;
  age: number;
  durationS: number;
  phase: 'emit' | 'linger' | 'fade';
  max: number;
  activeCells: number;
  over012: number;
  sourceCells: number;
  rect: [number, number, number, number];
}

/** One temporary local cloud on one storey grid (domain-local arrays; a closed one-cell ring round the domain). */
export class GasPuff {
  c: Float32Array;
  private next: Float32Array;
  readonly open: Uint8Array;
  readonly src: Uint8Array;
  readonly ids: string[] = [];
  /** Sim time since the (last re-armed) burst. */
  age = 0;
  /** Changed since the last drain (render upload). */
  dirty = true;
  /** Disposed (expired / retired): its rect still needs one clearing upload. */
  dead = false;
  sourceCount = 0;
  readonly peak: number;
  readonly durationS: number;
  readonly emitS: number;

  constructor(readonly id: string, readonly level: number, readonly grid: PuffGrid, readonly ox: number, readonly oy: number, readonly dw: number, readonly dh: number,
    readonly x: number, readonly z: number, opts: {peak: number; durationS: number}, closed?: (cx: number, cy: number) => boolean) {
    const n = dw * dh;
    this.c = new Float32Array(n);
    this.next = new Float32Array(n);
    this.open = new Uint8Array(n);
    this.src = new Uint8Array(n);
    this.peak = Math.min(GAS.CAP, Math.max(0, opts.peak));
    this.durationS = Math.max(2, opts.durationS);
    this.emitS = Math.min(PUFF.EMIT_S, this.durationS * 0.5);
    for (let y = 1; y < dh - 1; y++) for (let x = 1; x < dw - 1; x++) {
      const cx = x + ox, cy = y + oy;
      if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) continue;
      if (grid.cells[cy * grid.w + cx] === SOLID || closed?.(cx, cy)) continue;
      this.open[y * dw + x] = 1;
    }
  }

  get phase(): 'emit' | 'linger' | 'fade' {
    return this.age < this.emitS ? 'emit' : this.age < this.durationS - PUFF.FADE_S ? 'linger' : 'fade';
  }

  get expired(): boolean {
    return this.age >= this.durationS - 1e-9;
  }

  /** Domain-local index of world (x, z) (-1 outside). */
  localAt(x: number, z: number): number {
    const lx = Math.floor(x / CELL) - this.ox, ly = Math.floor(z / CELL) - this.oy;
    return lx < 0 || ly < 0 || lx >= this.dw || ly >= this.dh ? -1 : ly * this.dw + lx;
  }

  /**
   * Source cells: the open cells within `radius` walking metres (chamfer, no corner cutting) of the open cell nearest
   * (x, z). Returns the number added (0: no open cell near the point — no gas).
   */
  addSource(id: string, x: number, z: number, radius: number): number {
    const dw = this.dw;
    let start = this.localAt(x, z);
    if (start < 0 || !this.open[start]) {
      // the corpse point sits in a closed cell (against a wall): the nearest open cell within SNAP_CELLS
      const lx = Math.floor(x / CELL) - this.ox, ly = Math.floor(z / CELL) - this.oy;
      let best = -1, bd = Infinity;
      for (let dy = -PUFF.SNAP_CELLS; dy <= PUFF.SNAP_CELLS; dy++) for (let dx = -PUFF.SNAP_CELLS; dx <= PUFF.SNAP_CELLS; dx++) {
        const xx = lx + dx, yy = ly + dy;
        if (xx < 1 || yy < 1 || xx >= this.dw - 1 || yy >= this.dh - 1 || !this.open[yy * dw + xx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = yy * dw + xx; }
      }
      start = best;
    }
    if (start < 0) return 0;
    const R = Math.max(0, Math.round(radius * 10));
    const dist = new Map<number, number>([[start, 0]]);
    const buckets: number[][] = Array.from({length: R + 8}, () => []);
    buckets[0].push(start);
    let added = 0;
    for (let d = 0; d <= R; d++) {
      const b = buckets[d];
      for (let q = 0; q < b.length; q++) {
        const i = b[q];
        if (dist.get(i) !== d) continue;
        if (!this.src[i]) { this.src[i] = 1; added++; }
        for (const [ddx, ddy, w] of NEIGH) {
          const j = i + ddx + ddy * dw;
          if (!this.open[j]) continue;
          if (ddx && ddy && (!this.open[i + ddx] || !this.open[i + ddy * dw])) continue;
          const nd = d + w;
          if (nd > R || (dist.get(j) ?? Infinity) <= nd) continue;
          dist.set(j, nd);
          buckets[nd].push(j);
        }
      }
    }
    this.ids.push(id);
    this.sourceCount += added;
    this.dirty = true;
    return added;
  }

  /** Re-arm the emission (a burst joined this puff): the cloud's life restarts from its emission phase. */
  rearm(): void {
    this.age = 0;
    this.dirty = true;
  }

  /** One explicit substep of length dt over the whole (small) domain. Returns max |Δc|. */
  step(dt: number): number {
    const dw = this.dw, dh = this.dh, c = this.c, nx = this.next, open = this.open, src = this.src;
    const r = GAS.D * dt / (CELL * CELL);
    const phase = this.phase;
    const emit = phase === 'emit', keep = Math.exp(-GAS.SOURCE_RATE * dt), peak = this.peak;
    const k = Math.exp(-(phase === 'fade' ? PUFF.K_FADE : PUFF.K_LINGER) * dt);
    const cap = GAS.CAP, flush = GAS.FLUSH;
    let maxD = 0;
    for (let y = 1; y < dh - 1; y++) {
      let i = y * dw + 1;
      for (let x = 1; x < dw - 1; x++, i++) {
        if (!open[i]) continue;
        const ci = c[i];
        let lap = 0;
        if (open[i - 1]) lap += c[i - 1] - ci;
        if (open[i + 1]) lap += c[i + 1] - ci;
        if (open[i - dw]) lap += c[i - dw] - ci;
        if (open[i + dw]) lap += c[i + dw] - ci;
        let v = (ci + r * lap) * k;
        if (emit && src[i] && v < peak) v = peak - (peak - v) * keep;
        if (v < flush) v = 0; else if (v > cap) v = cap;
        nx[i] = v;
        const d = v > ci ? v - ci : ci - v;
        if (d > maxD) maxD = d;
      }
    }
    this.next = c;
    this.c = nx;
    this.age += dt;
    this.dirty = true;
    return maxD;
  }

  /** Bilinear concentration at world (x, z) (cell centres at (i + 0.5) · CELL), 0 outside the domain. */
  sample(x: number, z: number): number {
    const u = x / CELL - 0.5 - this.ox, v = z / CELL - 0.5 - this.oy;
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const at = (a: number, b: number) => (a < 0 || b < 0 || a >= this.dw || b >= this.dh ? 0 : this.c[b * this.dw + a]);
    return (at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu) * (1 - fv) + (at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu) * fv;
  }

  /** Floor / ceiling of grid cell gi (the density map's rule: VOID track beds at their bed floor; no ceiling -> floor + 3). */
  band(gi: number): [number, number] {
    const g = this.grid;
    const fl = g.floorOf ? g.floorOf(gi) : g.floor[gi];
    const has = g.ceil[gi] !== 0 || g.floor[gi] !== 0;
    const ce = has && g.ceil[gi] > fl + 0.5 ? g.ceil[gi] : fl + 3;
    return [fl, ce];
  }

  /** Concentration at world (x, y, z): bilinear x the shared height profile, 0 outside this storey's band there. */
  concentrationAt(x: number, y: number, z: number): number {
    const g = this.grid, cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    if (cx < this.ox || cy < this.oy || cx >= this.ox + this.dw || cy >= this.oy + this.dh) return 0;
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return 0;
    const gi = cy * g.w + cx;
    if (g.cells[gi] === SOLID) return 0;
    const [fl, ce] = this.band(gi);
    if (y < fl - 0.15 || y > ce + 0.15) return 0;
    return this.sample(x, z) * gasProfile(y, fl, ce);
  }

  get rect(): {x0: number; y0: number; w: number; h: number} {
    return {x0: this.ox, y0: this.oy, w: this.dw, h: this.dh};
  }

  stats(): PuffStats {
    let max = 0, active = 0, over = 0;
    for (let i = 0; i < this.c.length; i++) {
      const v = this.c[i];
      if (v > 0) active++;
      if (v > max) max = v;
      if (v > GAS.THRESHOLD) over++;
    }
    return {id: this.id, ids: [...this.ids], level: this.level, x: this.x, z: this.z, age: this.age, durationS: this.durationS, phase: this.phase, max, activeCells: active,
      over012: over, sourceCells: this.sourceCount, rect: [this.ox, this.oy, this.ox + this.dw - 1, this.oy + this.dh - 1]};
  }
}

const NONE: readonly GasPuff[] = [];
const NEIGH: readonly [number, number, number][] = [[1, 0, 5], [-1, 0, 5], [0, 1, 5], [0, -1, 5], [1, 1, 7], [1, -1, 7], [-1, 1, 7], [-1, -1, 7]];

/** What the puffs need from a built world: each storey's grid (layout.levels index) and the closed cells (elevator shaft). */
export interface PuffWorld {
  grid(level: number): PuffGrid | null;
  closed?: (cx: number, cy: number) => boolean;
}

/** Counters (QA / tests). */
export interface PuffCounts { added: number; joined: number; retired: number; expired: number; rejected: number; ticks: number }

/** Every live puff of the current world (bounded; cleared with the world). */
export class GasPuffs {
  private readonly live: GasPuff[] = [];
  /** Disposed puffs whose rect still needs one clearing upload. */
  private readonly graveyard: GasPuff[] = [];
  private acc = 0;
  private serial = 0;
  readonly counts: PuffCounts = {added: 0, joined: 0, retired: 0, expired: 0, rejected: 0, ticks: 0};
  world: PuffWorld | null = null;

  /** Any live puff (the frame's fast path checks this one boolean). */
  get active(): boolean {
    return this.live.length > 0;
  }

  /** Live puffs (QA / tests / render composition). */
  get list(): readonly GasPuff[] {
    return this.live;
  }

  /**
   * A temporary local cloud at (x, y, z) on storey `level`. Joins a live puff of that storey within COALESCE_M (re-arms it);
   * otherwise a new bounded domain (the oldest puff retires past MAX_PUFFS). Null: no world / storey grid / open cell there.
   */
  add(spec: PuffSpec): GasPuff | null {
    const W = this.world, grid = W?.grid(spec.level);
    if (!W || !grid) { this.counts.rejected++; return null; }
    const radius = spec.radius ?? PUFF.RADIUS_M;
    let near: GasPuff | null = null, nd = Infinity;
    for (const p of this.live) {
      if (p.level !== spec.level) continue;
      const d = Math.hypot(p.x - spec.x, p.z - spec.z);
      if (d < nd) { nd = d; near = p; }
    }
    if (near && nd <= PUFF.COALESCE_M && near.addSource(spec.id, spec.x, spec.z, radius) >= 0) {
      near.rearm();
      this.counts.joined++;
      return near;
    }
    const h = Math.round(PUFF.HALF_EXTENT_M / CELL);
    const cx = Math.floor(spec.x / CELL), cy = Math.floor(spec.z / CELL);
    // domain: (2h + 1) cells round the burst cell + the closed ring, clipped to the grid (+ ring)
    const x0 = Math.max(-1, cx - h - 1), y0 = Math.max(-1, cy - h - 1), x1 = Math.min(grid.w, cx + h + 1), y1 = Math.min(grid.h, cy + h + 1);
    if (x1 - x0 < 3 || y1 - y0 < 3) { this.counts.rejected++; return null; }
    const p = new GasPuff(`puff-${++this.serial}`, spec.level, grid, x0, y0, x1 - x0 + 1, y1 - y0 + 1, spec.x, spec.z,
      {peak: spec.peak ?? PUFF.PEAK, durationS: spec.durationS ?? PUFF.DURATION_S}, W.closed);
    if (!p.addSource(spec.id, spec.x, spec.z, radius)) { this.counts.rejected++; return null; }
    while (this.live.length >= PUFF.MAX_PUFFS) { this.retire(this.live[0]); this.counts.retired++; }
    this.live.push(p);
    this.counts.added++;
    return p;
  }

  private retire(p: GasPuff): void {
    const i = this.live.indexOf(p);
    if (i >= 0) this.live.splice(i, 1);
    p.dead = true;
    p.dirty = true;
    this.graveyard.push(p);
  }

  /** Advances by play time dt on the fixed GAS.TICK_HZ tick (at most GAS.MAX_TICKS_PER_FRAME). Returns the ticks run. */
  tick(dt: number): number {
    if (!this.live.length) { this.acc = 0; return 0; }
    const T = 1 / GAS.TICK_HZ;
    this.acc += Math.max(0, dt);
    let n = 0;
    while (this.acc >= T - 1e-9 && n < GAS.MAX_TICKS_PER_FRAME) { this.acc -= T; this.stepAll(T); n++; }
    if (n === GAS.MAX_TICKS_PER_FRAME && this.acc > T) this.acc = 0;
    return n;
  }

  /** Fast-forward (tests / QA): the same physics in coarse steps. */
  advance(seconds: number, step = 0.1): void {
    for (let t = 0; t < seconds - 1e-9 && this.live.length; t += step) this.stepAll(Math.min(step, seconds - t));
  }

  private stepAll(dt: number): void {
    const n = Math.max(1, Math.ceil(GAS.D * dt / (CELL * CELL) / GAS.MAX_R)), h = dt / n;
    for (const p of [...this.live]) {
      for (let i = 0; i < n; i++) p.step(h);
      if (p.expired) { this.retire(p); this.counts.expired++; }
    }
    this.counts.ticks++;
  }

  /** Sum of the live puffs at world (x, y, z), each x its storey band's height profile (the caller caps the total). */
  concentrationAt(x: number, y: number, z: number): number {
    let s = 0;
    for (const p of this.live) s += p.concentrationAt(x, y, z);
    return s;
  }

  /** Live + just-disposed puffs whose cells changed since the last call (the caller uploads their rects once each). */
  drainChanged(): readonly GasPuff[] {
    if (!this.live.length && !this.graveyard.length) return NONE; // the office's every-frame upload: no allocation without puffs
    const out: GasPuff[] = [];
    for (const p of this.live) if (p.dirty) { p.dirty = false; out.push(p); }
    for (const p of this.graveyard) { p.dirty = false; out.push(p); }
    this.graveyard.length = 0;
    return out;
  }

  /** Storeys with a live puff (render composition of the breach field's own uploads). */
  levels(): Set<number> {
    return new Set(this.live.map(p => p.level));
  }

  /** Drops everything (world teardown / a new section): no upload — the next station's layers start empty. */
  clear(): void {
    this.live.length = 0;
    this.graveyard.length = 0;
    this.acc = 0;
  }

  stats(): PuffStats[] {
    return this.live.map(p => p.stats());
  }
}
