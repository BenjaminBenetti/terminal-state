// Task reactor-build-20261101 (lane AIR): THE REACTOR's DEPTH GAS — the yellow-green strata of the selected B "Industrial Service
// Cathedral" concept, thickening downward through the pit. Pure (no three.js / DOM): world/reactor/generators.ts owns the instance
// of the built Reactor, world/gas/system.ts samples it at the eye (exposure), render/volumetric.ts draws the same table.
//
// Model (O(1) per sample, no per-frame allocation):
//  - c(x, y, z) = strata(y) x (1 − clear(zone at y, y)) inside the layout's x/z bounds below the top zone's top (the rim / station
//    air above it is 0). Stratified by depth only: one 1D function of absolute y.
//  - STRATA: inside zone k (top-down), from cTop at yTop to cBottom at yBottom with gentle TERRACES (BANDS_PER_ZONE denser bands:
//    t' = t − a·sin(2πnt)/(2πn), monotonic for a <= 1, C1 at the zone ends), held at cBottom in a gap below it. Each zone's top
//    blends smoothly (smoothstep over TRANSITION_M) from the zone above's value at that height, ENTIRELY BELOW the boundary: the
//    air above a zone's top never sees that zone's gas (the generator route's no-deadlock rule). Concentrations are made
//    non-decreasing with depth (a zone never starts thinner than the one above ends) — "thickening downward".
//  - STAGED CLEARING: start command -> crank (CRANK_S) -> the zone's fans spool (SPOOL_S) -> the zone's clear fraction f rises in
//    STAGES readable stages (ramp STAGE_RAMP_S, hold STAGE_HOLD_S between) to 1; spatially a soft front descends through the zone
//    band (the top of the zone clears first, then down): clear(t, f) = 1 − smoothstep(φ − W, φ + W, t), φ = f(1 + 2W) − W.
//  - PERSISTENCE: f is a pure function of (clock − startedAt) and only ever rises; ReactorRunState.zoneClear keeps the highest value
//    reached (max with the curve): a rebuild replays from the saved fraction / startedAt (no re-spool, nothing re-rolls).
//  - The RESTART win: clearAll(durationS) takes every zone to 1 (the pit clears).
//  - Task reactor-playtest-round2-20261102 (lane GAS): the JAMMED zone (gen/reactor/gasJam.ts: the deepest zone, its generator jammed)
//    never takes a generator's staged clearing: only clearAll (the reactor online) clears it. Its saved fraction still stands.
//  - RENDER / EXPOSURE share ONE table: TABLE_N samples of c over [yLo, yHi], linear between samples — depthGasAt() reads exactly
//    what the volumetric march integrates (the march only adds mean-1 wisps / sheets on top), so what looks gassy hurts.

import type {ReactorInfo} from '../../gen/reactor/reactorTypes';
import type {ReactorRunState} from './runState';
import {outdoorGasAt, pitShaftSpec, reactorOutdoorGas, type OutdoorGas, type ShaftSpec} from '../gaslightRules'; // task reactor-expansion-20261101 (lane GASLIGHT)
import {reactorJam} from '../../gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)

/** Every depth-gas tuning value (times s, lengths m). */
export const REACTOR_AIR = {
  /** Start command -> the engine catches (cranking). */
  CRANK_S: 1.5,
  /** Fans spool up after the crank. */
  SPOOL_S: 8,
  /** Readable clearing stages (top of the zone first), their ramp and the hold between two stages. */
  STAGES: 3,
  STAGE_RAMP_S: 12,
  STAGE_HOLD_S: 6,
  /** Smooth blend below each zone's top from the zone above (m; at most half the zone's height). */
  TRANSITION_M: 2.5,
  /** Soft width of the descending clearing front (fraction of the zone band). */
  FRONT_SOFT: 0.08,
  /** Denser bands per zone and their strength (0 = a linear ramp, <= 1 keeps it monotonic). */
  BANDS_PER_ZONE: 2,
  BAND_STRENGTH: 0.8,
  /** Samples of the shared render / exposure table (render/volumetricShaders.ts uniform array size). */
  TABLE_N: 64,
  /** The RESTART win's default whole-pit clearing time. */
  CLEAR_ALL_S: 40,
  /** A zone fraction change below this does not rebuild the table (no uniform upload). */
  CHANGE_EPS: 1 / 1024,
} as const;

/**
 * The depth gas's look in the volumetric march (uniform values only; QA may edit them live): extinction per metre at c = 1 (far
 * thinner than a breach room's gas — the pit is seen across tens of metres), single-scatter albedo, small emission (the strata
 * read in the dark, B's luminous yellow-green), wisp + horizontal sheet modulation (mean 1), sheet noise scales, linear tint.
 */
export const REACTOR_GAS_LOOK = {
  // task reactor-expansion-20261101 (lane GASLIGHT, user: "the toxic gas is not visible!"): ext 0.12 -> 0.18, emission 0.08 -> 0.3,
  // tint [0.5, 0.62, 0.22] -> greener. Root cause: the strata's unlit glow (tint x emission: at most 0.045 linear luminance, a
  // yellow-grey) sat under the OLIVE scene fog (world/reactor/archInstall.ts REACTOR_FOG, now neutral) of a pit whose powered lamps
  // are dark until the restart, so nothing lit them either: the deadly air read like ordinary murk. Now they glow a clear toxic green
  // (0.19 luminance when thick) that thickens with depth; the extinction is raised only a little so the core still reads from the rim
  // (straight down ~12 % transmittance through the uncleared column; the vessel's emissive glow / lane CORE's open scatter lights).
  ext: 0.18, scatter: 0.6, emission: 0.3, wisps: 0.35,
  sheets: 0.45, sheetXZ: 0.035, sheetY: 0.32,
  tint: [0.38, 0.74, 0.18] as readonly [number, number, number],
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const sstep = (a: number, b: number, v: number) => smooth((v - a) / (b - a));

/** Seconds from the start command to a fully cleared zone. */
export const GENERATOR_CLEAR_S = REACTOR_AIR.CRANK_S + REACTOR_AIR.SPOOL_S + REACTOR_AIR.STAGES * REACTOR_AIR.STAGE_RAMP_S + (REACTOR_AIR.STAGES - 1) * REACTOR_AIR.STAGE_HOLD_S;

/** Fan spool 0..1, `since` s after the start command (0 while cranking). */
export function fanSpool(since: number): number {
  return smooth((since - REACTOR_AIR.CRANK_S) / REACTOR_AIR.SPOOL_S);
}

/** The zone's staged clear fraction `since` s after its generator's start command (0 until the fans have spooled). */
export function stagedClear(since: number): number {
  const A = REACTOR_AIR, tau = since - A.CRANK_S - A.SPOOL_S;
  if (tau <= 0) return 0;
  let f = 0;
  for (let s = 0; s < A.STAGES; s++) f += smooth((tau - s * (A.STAGE_RAMP_S + A.STAGE_HOLD_S)) / A.STAGE_RAMP_S);
  return f / A.STAGES;
}

/** Seconds after the start command at which stagedClear reaches `f` (inverse; used to rebase a start time on restore). */
export function stagedClearTime(f: number): number {
  const A = REACTOR_AIR;
  if (f <= 0) return A.CRANK_S + A.SPOOL_S;
  if (f >= 1) return GENERATOR_CLEAR_S;
  const x = f * A.STAGES, s = Math.min(A.STAGES - 1, Math.floor(x));
  let p = x - s;
  // invert smoothstep (bisection: monotonic, 24 steps)
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (smooth(m) < p) lo = m; else hi = m; }
  p = (lo + hi) / 2;
  return A.CRANK_S + A.SPOOL_S + s * (A.STAGE_RAMP_S + A.STAGE_HOLD_S) + p * A.STAGE_RAMP_S;
}

/** Completed stages (0..STAGES) of a clear fraction. */
export function stageOf(f: number): number {
  return Math.min(REACTOR_AIR.STAGES, Math.floor(f * REACTOR_AIR.STAGES + 1e-6));
}

/** The banded depth profile inside a zone: t in [0, 1] (top -> bottom) -> [0, 1], monotonic, C1, gentle terraces. */
export function terrace(t: number): number {
  const w = 2 * Math.PI * REACTOR_AIR.BANDS_PER_ZONE;
  return t - REACTOR_AIR.BAND_STRENGTH * Math.sin(w * t) / w;
}

/** Cleared share at depth t in [0, 1] of a zone (0 = its top) for the zone's clear fraction f: a soft front descending from the top. */
export function clearAt(t: number, f: number): number {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const W = REACTOR_AIR.FRONT_SOFT, phi = f * (1 + 2 * W) - W;
  return 1 - sstep(phi - W, phi + W, t);
}

/** World x / z rectangle the depth gas fills (the layout's bounds). */
export interface DepthRect { x0: number; z0: number; x1: number; z1: number }

/** What world/gas/system.ts samples (the eye concentration of the depth gas). */
export interface DepthGasSource { depthGasAt(x: number, y: number, z: number): number }

/**
 * What render/volumetric.ts draws (VolumetricAtmosphere.setDepthGas): c at TABLE_N heights over [yLo, yHi] inside rect. Task
 * reactor-expansion-20261101 (lane GASLIGHT): + `outdoor` — the toxic surface air above the open pit top (world/gaslightRules.ts
 * outdoorGasAt; the exposure adds the SAME function) — and `shafts`, the sky light through the opening (render only).
 */
export interface DepthGasTable { table: ArrayLike<number>; yLo: number; yHi: number; rect: DepthRect; outdoor?: OutdoorGas | null; shafts?: ShaftSpec | null }

interface ZoneRec { id: number; yTop: number; yBottom: number; cTop: number; cBottom: number; H: number; TR: number; gen: number }

/** QA / test statistics. */
export interface ReactorAirStats {
  version: number;
  yLo: number; yHi: number; rect: DepthRect;
  tableMax: number;
  clearingAll: boolean;
  zones: {id: number; yTop: number; yBottom: number; cTop: number; cBottom: number; generator: number; clear: number; stage: number; jammed: boolean}[];
}

/** The depth gas of one built Reactor (a ReactorRunState is shared with the generators runtime; zoneClear lives there). */
export class ReactorAir implements DepthGasSource {
  /** Zones top-down (yTop clamped to the rim, concentrations made non-decreasing with depth). */
  readonly zones: readonly ZoneRec[];
  /** The shared render / exposure table: c at TABLE_N evenly spaced heights, index 0 = yLo. */
  readonly table = new Float32Array(REACTOR_AIR.TABLE_N);
  readonly yLo: number;
  readonly yHi: number;
  /** Bumped on every table rebuild (the renderer re-uploads its uniforms only then). */
  version = 0;
  private readonly last: Float64Array;
  private readonly clears: Float64Array;
  private readonly zeros: Float64Array;
  private all: {from: number; dur: number; base: Float64Array} | null = null;

  /**
   * Task reactor-expansion-20261101 (lane GASLIGHT): the toxic surface air above the OPEN pit top (out of reach: above the roof line)
   * and the shafts of sky light through the opening. Exposure (depthGasAt) and render (renderTable) read the same `outdoor`.
   */
  readonly outdoor: OutdoorGas | null;
  readonly shafts: ShaftSpec | null;
  /** Task reactor-playtest-round2-20261102 (lane GAS): the jammed zone (ReactorZone.id, -1 none): cleared only by clearAll. */
  readonly jammedZone: number;

  constructor(readonly info: ReactorInfo, readonly rect: DepthRect, readonly state: ReactorRunState) {
    const open = info.pit.roofY > info.pit.rimY + 2; // (lane GASLIGHT)
    this.outdoor = open ? reactorOutdoorGas(info.pit.roofY, rect) : null;
    this.shafts = open ? pitShaftSpec(info) : null; // (task reactor-submit-roof-fog-20261102, lane ROOF: through the roof opening only)
    this.jammedZone = reactorJam(info)?.zone ?? -1; // (lane GAS)
    const genOf = new Map<number, number>();
    for (const g of info.generators) if (!genOf.has(g.zone)) genOf.set(g.zone, g.id);
    const rim = info.pit.rimY;
    const sorted = [...info.zones].sort((a, b) => b.yTop - a.yTop);
    const recs: ZoneRec[] = [];
    let prevBottom = 0;
    for (const z of sorted) {
      const yTop = Math.min(z.yTop, rim), yBottom = Math.min(z.yBottom, yTop - 0.5);
      const cTop = Math.max(clamp01(z.cTop), prevBottom), cBottom = Math.max(clamp01(z.cBottom), cTop);
      const H = yTop - yBottom;
      recs.push({id: z.id, yTop, yBottom, cTop, cBottom, H, TR: Math.max(0.25, Math.min(REACTOR_AIR.TRANSITION_M, 0.5 * H)), gen: z.generator >= 0 ? z.generator : genOf.get(z.id) ?? -1});
      prevBottom = cBottom;
    }
    this.zones = recs;
    const lowest = recs.length ? Math.min(...recs.map(z => z.yBottom)) : info.pit.floorY;
    this.yHi = recs.length ? recs[0].yTop : info.pit.floorY;
    this.yLo = Math.min(info.pit.floorY, lowest) - 1;
    const nz = Math.max(0, ...info.zones.map(z => z.id + 1));
    this.last = new Float64Array(nz).fill(-1);
    this.clears = new Float64Array(nz);
    this.zeros = new Float64Array(nz);
    this.update(Number.NEGATIVE_INFINITY, true);
  }

  /** The clear fraction reached by zone `id` (0..1). */
  clearOf(id: number): number {
    return this.clears[id] ?? 0;
  }

  /** The generator powering zone `id` (ReactorGenerator.id, -1 none). */
  generatorOf(id: number): number {
    return this.zones.find(z => z.id === id)?.gen ?? -1;
  }

  /**
   * Advance the zones' fractions to game clock `clock` (from their generators' start times and a running clearAll); persists the
   * highest fraction reached into state.zoneClear. Rebuilds the table (version++) when any fraction moved by CHANGE_EPS. True =
   * the table changed.
   */
  update(clock: number, force = false): boolean {
    const st = this.state, all = this.all;
    let changed = force;
    for (const z of this.zones) {
      let f = clamp01(st.zoneClear[z.id] ?? 0);
      const g = z.gen >= 0 ? st.generators[z.gen] : undefined;
      if (g?.started && z.id !== this.jammedZone && Number.isFinite(clock)) f = Math.max(f, stagedClear(clock - g.startedAt)); // (lane GAS: never the jammed zone)
      if (all && Number.isFinite(clock)) { const b = all.base[z.id] ?? 0; f = Math.max(f, b + (1 - b) * smooth((clock - all.from) / all.dur)); }
      if (f > (st.zoneClear[z.id] ?? 0)) st.zoneClear[z.id] = f;
      this.clears[z.id] = f;
      const d = Math.abs(f - this.last[z.id]);
      if (d >= REACTOR_AIR.CHANGE_EPS || (f >= 1 && this.last[z.id] < 1)) changed = true;
    }
    if (all && this.zones.every(z => this.clears[z.id] >= 1)) this.all = null;
    if (!changed) return false;
    for (const z of this.zones) this.last[z.id] = this.clears[z.id];
    const N = REACTOR_AIR.TABLE_N, span = this.yHi - this.yLo;
    for (let i = 0; i < N; i++) this.table[i] = this.strataAt(this.yLo + span * i / (N - 1), this.clears);
    this.version++;
    return true;
  }

  /**
   * The RESTART win: every zone rises to 1 over `durationS` from game clock `clock` (the pit clears). Monotonic with the staged
   * clearing; ends itself once every zone is clear.
   */
  clearAll(durationS: number = REACTOR_AIR.CLEAR_ALL_S, clock = 0): void {
    const base = new Float64Array(this.clears.length);
    for (const z of this.zones) base[z.id] = this.clears[z.id];
    this.all = {from: clock, dur: Math.max(0.1, durationS), base};
  }

  /** A whole-pit clearing is running. */
  get clearingAll(): boolean {
    return !!this.all;
  }

  /**
   * The analytic depth profile at absolute height y for the given per-zone clear fractions (default: none cleared): 0 above the top
   * zone, smooth between zones, non-decreasing with depth while uncleared.
   */
  strataAt(y: number, clears: ArrayLike<number> = this.zeros): number {
    const Z = this.zones;
    if (!Z.length || y >= Z[0].yTop) return 0;
    let k = 0;
    while (k + 1 < Z.length && Z[k + 1].yTop > y) k++;
    const z = Z[k];
    const own = this.zoneEff(z, y, clears[z.id] ?? 0);
    const prev = k === 0 ? 0 : this.zoneEff(Z[k - 1], z.yTop, clears[Z[k - 1].id] ?? 0);
    return prev + (own - prev) * sstep(0, z.TR, z.yTop - y);
  }

  private zoneEff(z: ZoneRec, y: number, f: number): number {
    const t = clamp01((z.yTop - y) / z.H);
    const raw = z.cTop + (z.cBottom - z.cTop) * terrace(t);
    return raw * (1 - clearAt(t, f));
  }

  /** The table at height y (linear between samples; the march reads the same values). */
  tableAt(y: number): number {
    if (y >= this.yHi) return 0;
    const N = REACTOR_AIR.TABLE_N, u = (y - this.yLo) / (this.yHi - this.yLo) * (N - 1);
    if (u <= 0) return this.table[0];
    const i = Math.min(N - 2, Math.floor(u)), fr = u - i;
    return this.table[i] + (this.table[i + 1] - this.table[i]) * fr;
  }

  /** The depth gas at a world point (the exposure sample): inside the layout's x / z bounds, below the top zone's top. */
  depthGasAt(x: number, y: number, z: number): number {
    const r = this.rect;
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return 0;
    // (lane GASLIGHT) + the outdoor air above the open pit top — max, never a sum (they never overlap: the strata end below the rim)
    return Math.max(this.tableAt(y), outdoorGasAt(this.outdoor, x, y, z));
  }

  /** The render table (shared arrays: copy, never keep). */
  renderTable(): DepthGasTable {
    return {table: this.table, yLo: this.yLo, yHi: this.yHi, rect: this.rect, outdoor: this.outdoor, shafts: this.shafts}; // (lane GASLIGHT: + outdoor / shafts)
  }

  stats(): ReactorAirStats {
    let tableMax = 0;
    for (let i = 0; i < this.table.length; i++) if (this.table[i] > tableMax) tableMax = this.table[i];
    return {
      version: this.version, yLo: this.yLo, yHi: this.yHi, rect: {...this.rect}, tableMax, clearingAll: !!this.all,
      zones: this.zones.map(z => ({id: z.id, yTop: z.yTop, yBottom: z.yBottom, cTop: z.cTop, cBottom: z.cBottom, generator: z.gen, clear: this.clears[z.id], stage: stageOf(this.clears[z.id]), jammed: z.id === this.jammedZone})),
    };
  }
}
