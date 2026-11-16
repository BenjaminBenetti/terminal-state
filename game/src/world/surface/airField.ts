// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's INTERIOR GAS — the existing breach field
// (world/gas/field.ts: diffusion, pool / spill, sources, sleep) BOUNDED for a district of ~1000+ cells a side over up to three storeys.
// Pure: no three.js / DOM.
//
// One whole-grid GasField would cost the full grid per substep as soon as two distant buildings had a breach (one active box per storey
// spans both), and the build's fast-forward (AGE_CAP_S in 0.5 s steps, 15 substeps each) would replay every gassed building at once. So:
//  - ZONES: one ordinary GasField per gas-capable enclosure — every building with an interior (its footprint cells, its storeys) and the
//    checkpoint tent — over its own cells only. Its `closed` test shuts every cell outside the enclosure and every OUTDOOR column inside it
//    (world/surface/airMask.ts): the outdoor air is the analytic term, never simulated; a zone's gas never leaks onto the street.
//  - Fields are created on a zone's first breach; an intact building (no breach) has no field at all: zero gas, zero cost.
//  - Only zones NEAR THE PLAYER simulate (within SURFACE_FIELD.WAKE_M of the footprint; frozen beyond SLEEP_M). A frozen zone keeps its
//    state and remembers what happened to it since (breaches added / removed, with their times); waking it REPLAYS that history from where
//    it froze — the same arithmetic as the Office's fastForward (coarse 0.5 s steps, ages capped at GAS.AGE_CAP_S), spread over frames
//    within a cell-substep budget (CATCHUP_CELL_STEPS) while it is still far out of sight (WAKE_M > the march's 36 m), never a hitch.
//    settle() does it at once for the zones round the arrival point (the section build: behind the loading screen).
//  - Breaches carry the outdoor strength (SURFACE_AIR.C): a room fills toward the outside air's concentration, never beyond it.
// The GasSystem sees ONE GasField (this subclass: addBreach / removeBreach / tick / advance / drainChanged / concentrationAt / storeys);
// exposure and the volumetric layers read the zones' own fields, so what shows inside is exactly what hurts.

import {CELL} from '../../gen/grid';
import {GAS, GasField, type GasBreach, type GasDomain, type GasGrid, type StoreyGas} from '../gas/field';
import type {SurfaceInfo, SRect} from '../../gen/surface/surfaceTypes';
import {SURFACE_AIR, type SurfaceOutdoorMap} from './airMask';

export const SURFACE_FIELD = {
  /** A zone simulates while the player is within this (m) of its footprint, and freezes beyond SLEEP_M (hysteresis). */
  WAKE_M: 56,
  SLEEP_M: 72,
  /**
   * Replay budget per frame over all waking zones: Σ (active-box cells x substeps). Measured in Node on the generated district: ~25 ns per
   * cell-substep, so 100 k ≈ 2.5 ms a frame; a 42 m building's 90 s history (~1.2 M) catches up in ~12 frames, long before it is in view.
   */
  CATCHUP_CELL_STEPS: 100_000,
  /** Replay step (s): the Office fast-forward's coarse step. */
  STEP_S: GAS.FAST_FORWARD_STEP_S,
} as const;

/** One gas-capable enclosure of the district. */
export interface SurfaceGasZoneSpec {
  /** 'b<building id>' or 'tent'. */
  id: string;
  /** Its world rect (the wake distance) and its cells (grid rect, [x0, x1) x [y0, y1)). */
  rect: SRect;
  cells: GasDomain;
  /** Layout level ids holding its interior. */
  levels: number[];
}

/** The zones of a district (pure; the field and the tests build from it). */
export function surfaceGasZones(s: SurfaceInfo): SurfaceGasZoneSpec[] {
  const cellsOf = (r: SRect): GasDomain => ({x0: Math.floor(r.x0 / CELL + 1e-9), y0: Math.floor(r.z0 / CELL + 1e-9), x1: Math.ceil(r.x1 / CELL - 1e-9), y1: Math.ceil(r.z1 / CELL - 1e-9)});
  const out: SurfaceGasZoneSpec[] = [];
  for (const b of s.buildings) {
    if (!b.levels.length || (!b.entrances.length && !b.windows.length)) continue; // no interior / no opening: can never take gas
    out.push({id: `b${b.id}`, rect: {...b.footprint}, cells: cellsOf(b.footprint), levels: [...b.levels]});
  }
  out.push({id: 'tent', rect: {...s.checkpoint.tent.rect}, cells: cellsOf(s.checkpoint.tent.rect), levels: [0]});
  return out;
}

type Op = {kind: 'add'; b: GasBreach; at: number} | {kind: 'remove'; id: string; at: number};

/** A zone's live state (QA / tests read it). */
export interface SurfaceGasZone {
  spec: SurfaceGasZoneSpec;
  index: number;
  field: GasField | null;
  /** Simulated time its field stands at (the owner's `now` while live). */
  simT: number;
  mode: 'frozen' | 'catching' | 'live';
  /** History not yet applied (frozen) / the replay being run (catching). */
  pending: Op[];
  queue: Op[];
  /** Breach ids it holds now (applied or pending). */
  ids: Set<string>;
  levels: {id: number; grid: GasGrid}[];
  closed: (cx: number, cy: number) => boolean;
}

/** Field statistics (QA / the cost report). */
export interface SurfaceFieldStats {
  zones: number; withField: number; live: number; catching: number; frozen: number;
  activeCells: number; storeys: number; replaySteps: number; replayCellSteps: number; tickCellSteps: number;
}

export class SurfaceGasField extends GasField {
  readonly zones: SurfaceGasZone[] = [];
  /** The field's clock (s): advance() / tick() move it; frozen zones lag behind it. */
  now = 0;
  /** Breach strength (default: the outdoor air's concentration). */
  strength: number = SURFACE_AIR.C;
  /** Counters (QA / the cost report): replay steps / cell-substeps, ticked cell-substeps (estimated from the active boxes). */
  readonly counts = {replaySteps: 0, replayCellSteps: 0, tickCellSteps: 0, wakes: 0, freezes: 0};
  private readonly zoneOf: Int16Array;
  private readonly gw: number;
  private readonly gh: number;

  /**
   * `levels` = every layout level (id + grid); `map` = the district's outdoor column map (its outdoor columns are never zone cells);
   * `focus` = where the player is (null: nowhere — nothing wakes).
   */
  constructor(levels: readonly {id: number; grid: GasGrid}[], specs: readonly SurfaceGasZoneSpec[], map: SurfaceOutdoorMap, readonly focus: () => {x: number; z: number} | null) {
    super([], {});
    const g0 = levels.find(l => l.id === 0)?.grid ?? levels[0]?.grid;
    this.gw = g0?.w ?? map.w;
    this.gh = g0?.h ?? map.h;
    const W = this.gw, H = this.gh;
    this.zoneOf = new Int16Array(W * H).fill(-1);
    const byId = new Map(levels.map(l => [l.id, l]));
    specs.forEach((spec, index) => {
      const c = spec.cells;
      for (let y = Math.max(0, c.y0); y < Math.min(H, c.y1); y++) for (let x = Math.max(0, c.x0); x < Math.min(W, c.x1); x++) {
        const i = y * W + x;
        if (this.zoneOf[i] < 0 && map.top[i] > 0) this.zoneOf[i] = index; // first enclosure wins a shared cell; outdoor columns stay -1
      }
      const zl = spec.levels.map(id => byId.get(id)).filter((l): l is {id: number; grid: GasGrid} => !!l);
      const closed = (cx: number, cy: number) => cx < 0 || cy < 0 || cx >= W || cy >= H || this.zoneOf[cy * W + cx] !== index;
      this.zones.push({spec, index, field: null, simT: -GAS.AGE_CAP_S, mode: 'frozen', pending: [], queue: [], ids: new Set(), levels: zl, closed});
    });
  }

  /** The zone index holding grid cell (cx, cy) (-1: none / outdoors). */
  zoneAtCell(cx: number, cy: number): number {
    return cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh ? -1 : this.zoneOf[cy * this.gw + cx];
  }

  /** The zone holding world (x, z), or null. */
  zoneAt(x: number, z: number): SurfaceGasZone | null {
    const k = this.zoneAtCell(Math.floor(x / CELL), Math.floor(z / CELL));
    return k >= 0 ? this.zones[k] : null;
  }

  /** Bounding cell rect of every zone (+ the closed ring) — QA only (each storey uploads its own rect). */
  override get rect(): {x0: number; y0: number; w: number; h: number} {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const z of this.zones) { const c = z.spec.cells; x0 = Math.min(x0, c.x0 - 1); y0 = Math.min(y0, c.y0 - 1); x1 = Math.max(x1, c.x1 + 1); y1 = Math.max(y1, c.y1 + 1); }
    return Number.isFinite(x0) ? {x0, y0, w: x1 - x0, h: y1 - y0} : {x0: 0, y0: 0, w: 0, h: 0};
  }

  /** Every zone's gassed storeys. */
  override get storeys(): readonly StoreyGas[] {
    const out: StoreyGas[] = [];
    for (const z of this.zones) if (z.field) out.push(...z.field.storeys);
    return out;
  }

  /** The first gassed storey of `level` (compatibility; uploads / puff composition use each storey's own rect). */
  override storey(level: number): StoreyGas | null {
    for (const z of this.zones) { const s = z.field?.storey(level); if (s) return s; }
    return null;
  }

  /** Routes a breach to its zone (by its first cell inside one), at the outdoor strength. False: no zone holds its cells. */
  override addBreach(b: GasBreach): boolean {
    return this.addAged(b, 0);
  }

  /**
   * A breach that started `age` s ago (an open door restored from the district memory; capped at GAS.AGE_CAP_S). A frozen zone (every zone
   * right after the section build) remembers it for its replay, which starts it at its age; a live zone (the player is near: a door
   * opened now) starts it at once — a live field cannot be rewound, and in play nothing older is ever added.
   */
  addAged(b: GasBreach, age: number): boolean {
    const z = this.zoneOfBreach(b);
    if (!z) return false;
    const breach: GasBreach = {...b, strength: b.strength ?? this.strength};
    z.ids.add(b.id);
    if (z.mode === 'live') { this.ensureField(z).addBreach(breach); return true; }
    const a = Math.min(GAS.AGE_CAP_S, Math.max(0, Number.isFinite(age) ? age : 0));
    (z.mode === 'catching' ? z.queue : z.pending).push({kind: 'add', b: breach, at: this.now - a});
    return true;
  }

  /** Stops breach `id` (a door shut) in whichever zone holds it. False: unknown. */
  override removeBreach(id: string): boolean {
    for (const z of this.zones) {
      if (!z.ids.delete(id)) continue;
      if (z.mode === 'live') z.field?.removeBreach(id);
      else (z.mode === 'catching' ? z.queue : z.pending).push({kind: 'remove', id, at: this.now});
      return true;
    }
    return false;
  }

  /** Does a zone hold breach `id` now (applied or pending)? */
  hasBreach(id: string): boolean {
    return this.zones.some(z => z.ids.has(id));
  }

  private zoneOfBreach(b: GasBreach): SurfaceGasZone | null {
    for (const gi of b.cells) {
      const cx = gi % this.gw, cy = (gi - cx) / this.gw, k = this.zoneAtCell(cx, cy);
      if (k >= 0 && this.zones[k].levels.some(l => l.id === b.level)) return this.zones[k];
    }
    return null;
  }

  private ensureField(z: SurfaceGasZone): GasField {
    return (z.field ??= new GasField(z.levels, {domain: z.spec.cells, closed: z.closed}));
  }

  /** Deferred: the clock moves, every zone replays its share when it wakes (GasSystem.fastForward's coarse advances land here). */
  override advance(seconds: number): void {
    if (seconds > 0 && Number.isFinite(seconds)) this.now += seconds;
  }

  /** Play time: the clock, then wake / freeze by distance, replay within the budget, tick the live zones on the fixed 10 Hz tick. */
  override tick(dt: number): number {
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.now += d;
    this.ticks++;
    const f = this.focus();
    let budget: number = SURFACE_FIELD.CATCHUP_CELL_STEPS, ran = 0;
    for (const z of this.zones) {
      if (!z.field && !z.pending.length && !z.queue.length) continue; // never breached: nothing to do
      const dist = f ? rectDistance(z.spec.rect, f.x, f.z) : Infinity;
      if (z.mode === 'live') {
        if (dist > SURFACE_FIELD.SLEEP_M) { z.mode = 'frozen'; z.simT = this.now - d; this.counts.freezes++; continue; }
        if (z.field) {
          const before = z.field.ticks;
          ran += z.field.tick(d);
          this.counts.tickCellSteps += (z.field.ticks - before) * GasField.substeps(1 / GAS.TICK_HZ) * activeCells(z.field);
          release(z.field);
        }
        z.simT = this.now;
        continue;
      }
      if (z.mode === 'frozen' && dist <= SURFACE_FIELD.WAKE_M) this.startReplay(z);
      if (z.mode === 'catching' && budget > 0) budget -= this.runReplay(z, budget);
    }
    return ran;
  }

  /** Replays (synchronously, unbudgeted) every zone within `radius` m of (x, z) that has history — the section build's arrival point. */
  settle(x: number, z: number, radius: number = SURFACE_FIELD.WAKE_M): number {
    let n = 0;
    for (const zn of this.zones) {
      if (!zn.field && !zn.pending.length && !zn.queue.length) continue;
      if (rectDistance(zn.spec.rect, x, z) > radius) continue;
      if (zn.mode === 'frozen') this.startReplay(zn);
      if (zn.mode === 'catching') { this.runReplay(zn, Infinity); n++; }
    }
    return n;
  }

  private startReplay(z: SurfaceGasZone): void {
    // history older than AGE_CAP_S is not replayed (the Office rule: the field has converged by then)
    const t0 = Math.max(z.simT, this.now - GAS.AGE_CAP_S);
    z.simT = t0;
    z.queue = z.pending.sort((a, b) => a.at - b.at);
    z.pending = [];
    z.mode = 'catching';
    this.counts.wakes++;
  }

  /** Runs zone z's replay up to `budget` cell-substeps; returns the cost spent (at least 1 per call). */
  private runReplay(z: SurfaceGasZone, budget: number): number {
    let spent = 0;
    while (spent < budget) {
      const op = z.queue[0];
      const target = op ? Math.max(op.at, z.simT) : this.now;
      if (target > z.simT + 1e-9) {
        if (z.field) release(z.field);
        if (!z.field || z.field.storeys.every(s => s.asleep || !s.active)) { z.simT = target; spent += 1; continue; } // nothing moving: jump
        const step = Math.min(SURFACE_FIELD.STEP_S, target - z.simT);
        const cost = GasField.substeps(step) * Math.max(1, activeCells(z.field));
        z.field.advance(step, step);
        z.simT += step;
        spent += cost;
        this.counts.replaySteps++;
        this.counts.replayCellSteps += cost;
        continue;
      }
      if (!op) { z.mode = 'live'; z.simT = this.now; break; }
      z.queue.shift();
      if (op.kind === 'add') this.ensureField(z).addBreach(op.b);
      else z.field?.removeBreach(op.id);
      spent += 1;
    }
    return Math.max(1, spent);
  }

  override drainChanged(): StoreyGas[] {
    const out: StoreyGas[] = [];
    for (const z of this.zones) if (z.field) out.push(...z.field.drainChanged());
    return out;
  }

  /** The breach gas at a world point: the zone holding it (none outdoors / in a sealed building: 0). */
  override concentrationAt(x: number, y: number, z: number): number {
    return this.zoneAt(x, z)?.field?.concentrationAt(x, y, z) ?? 0;
  }

  stats(): SurfaceFieldStats {
    let withField = 0, live = 0, catching = 0, frozen = 0, active = 0, storeys = 0;
    for (const z of this.zones) {
      if (z.field) { withField++; for (const s of z.field.storeys) { storeys++; if (s.active) active += (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1); } }
      if (z.mode === 'live') live++; else if (z.mode === 'catching') catching++; else frozen++;
    }
    return {zones: this.zones.length, withField, live, catching, frozen, activeCells: active, storeys, replaySteps: this.counts.replaySteps,
      replayCellSteps: this.counts.replayCellSteps, tickCellSteps: this.counts.tickCellSteps};
  }
}

/** A shut door's lingering gas that has settled (asleep) goes back to spill (StoreyGas.releaseLingering). */
function release(f: GasField): void {
  for (const s of f.storeys) if (s.asleep && s.lingering) s.releaseLingering();
}

/** Cells of every awake storey's active box (the per-substep cost of a zone's field). */
function activeCells(f: GasField): number {
  let n = 0;
  for (const s of f.storeys) if (s.active && !s.asleep) n += (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1);
  return n;
}

/** Distance (m) from (x, z) to a rect (0 inside). */
export function rectDistance(r: SRect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}
