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
//  - Only zones NEAR THE PLAYER simulate (within the wake distance of the footprint: SURFACE_FIELD.WAKE_M + the player's speed x LEAD_S;
//    frozen beyond it + SLEEP_EXTRA_M). A frozen zone keeps its state and remembers what happened to it since (breaches added / removed,
//    with their times); waking it REPLAYS that history from where it froze — the fast-forward arithmetic (steps of whole 0.1 s ticks, the
//    live tick's own 1/30 s substeps, ages capped at GAS.AGE_CAP_S), spread over frames NEAREST ZONE FIRST within a per-frame cell-substep
//    budget (CATCHUP_CELL_STEPS: a step never costs more than what is left of it, so a frame's replay stays ~1 ms) while the zone is still
//    out of sight. A zone the player can SEE or BREATHE (within SEEN_M: the march draws to 36 m) is never stale: one still catching up
//    there completes at once (counts.forced — a teleport / the arrival; never on a walk or a drive). settle() does it at once for the zones
//    round the arrival point (the section build: behind the loading screen).
//  - Breaches carry the outdoor strength (SURFACE_AIR.C): a room fills toward the outside air's concentration, never beyond it.
// The GasSystem sees ONE GasField (this subclass: addBreach / removeBreach / tick / advance / drainChanged / concentrationAt / storeys);
// exposure and the volumetric layers read the zones' own fields, so what shows inside is exactly what hurts.

import {CELL} from '../../gen/grid';
import {GAS, GasField, type GasBreach, type GasDomain, type GasGrid, type StoreyGas} from '../gas/field';
import type {SurfaceInfo, SRect} from '../../gen/surface/surfaceTypes';
import {SURFACE_AIR, type SurfaceOutdoorMap} from './airMask';

export const SURFACE_FIELD = {
  /**
   * A zone simulates while the player is within WAKE_M + speed x LEAD_S (m) of its footprint (the faster the player — the truck — the
   * earlier it wakes: LEAD_S of catch-up before it can come into view), and freezes SLEEP_EXTRA_M beyond that (hysteresis).
   */
  WAKE_M: 56,
  LEAD_S: 4,
  /** The speed the wake lead counts at most (m/s; faster = a teleport, not travel). */
  LEAD_MAX_SPEED: 30,
  SLEEP_EXTRA_M: 16,
  /** Within this (m) a zone is visible or breathable (the march draws to 36 m): it must be current — a stale one completes at once. */
  SEEN_M: 40,
  /**
   * Replay budget per frame over all waking zones: Σ (active-box cells x substeps). Measured in Node on the generated district: ~20-25 ns
   * per cell-substep, so 40 k ≈ 1 ms a frame (+ at most one 0.1 s tick of one zone when nothing else ran: a frame's replay is never more).
   */
  CATCHUP_CELL_STEPS: 40_000,
  /**
   * What a replayed op costs, in the budget's units: a breach added (the zone's field on its first one + the pool's flood fill: measured
   * 0.4 / 0.65 ms mean / max warm on the generated district, up to ~1.4 ms on a loaded worker — a whole frame's budget: an add takes a
   * frame of its own) and one removed (the marks rebuilt). Charged like steps.
   */
  OP_ADD_CELL_STEPS: 40_000,
  OP_REMOVE_CELL_STEPS: 4_000,
  /** Longest replay step (s): the Office fast-forward's coarse step (shorter where the budget is short: whole 0.1 s ticks). */
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
  readonly counts = {replaySteps: 0, replayCellSteps: 0, tickCellSteps: 0, wakes: 0, freezes: 0, forced: 0, ops: 0, fields: 0};
  /** The player's smoothed speed (m/s, from the focus) and the wake distance it gives (m). */
  speed = 0;
  wakeM: number = SURFACE_FIELD.WAKE_M;
  private readonly lastFocus = {x: 0, z: 0, has: false};
  private readonly order: {z: SurfaceGasZone; d: number}[] = [];
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
    if (!z.field) this.counts.fields++;
    return (z.field ??= new GasField(z.levels, {domain: z.spec.cells, closed: z.closed}));
  }

  /** Deferred: the clock moves, every zone replays its share when it wakes (GasSystem.fastForward's coarse advances land here). */
  override advance(seconds: number): void {
    if (seconds > 0 && Number.isFinite(seconds)) this.now += seconds;
  }

  /**
   * Play time: the clock, then wake / freeze by distance, tick the live zones on the fixed 10 Hz tick, complete any stale zone the player
   * can see / breathe, and replay the rest nearest first within the frame's budget.
   */
  override tick(dt: number): number {
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.now += d;
    this.ticks++;
    const f = this.focus();
    this.trackSpeed(f, d);
    const wake = this.wakeM, sleep = wake + SURFACE_FIELD.SLEEP_EXTRA_M, order = this.order;
    let ran = 0;
    order.length = 0;
    for (const z of this.zones) {
      if (!z.field && !z.pending.length && !z.queue.length) continue; // never breached: nothing to do
      const dist = f ? rectDistance(z.spec.rect, f.x, f.z) : Infinity;
      if (z.mode === 'live') {
        if (dist > sleep) { z.mode = 'frozen'; z.simT = this.now - d; this.counts.freezes++; continue; }
        if (z.field) {
          const before = z.field.ticks;
          ran += z.field.tick(d);
          this.counts.tickCellSteps += (z.field.ticks - before) * GasField.substeps(1 / GAS.TICK_HZ) * activeCells(z.field);
          release(z.field);
        }
        z.simT = this.now;
        continue;
      }
      if (z.mode === 'frozen' && dist <= wake) this.startReplay(z);
      if (z.mode !== 'catching') continue;
      // seen / breathed: never stale (completes now: unbudgeted — only after a teleport or at the arrival)
      if (dist <= SURFACE_FIELD.SEEN_M) { this.runReplay(z, Infinity, true); this.counts.forced++; continue; }
      order.push({z, d: dist});
    }
    if (order.length > 1) order.sort((a, b) => a.d - b.d);
    let budget: number = SURFACE_FIELD.CATCHUP_CELL_STEPS;
    for (const {z} of order) {
      if (budget <= 0) break;
      budget -= this.runReplay(z, budget, budget === SURFACE_FIELD.CATCHUP_CELL_STEPS);
    }
    return ran;
  }

  /** The smoothed player speed from the focus (a jump faster than LEAD_MAX_SPEED is a teleport: ignored) -> the wake distance. */
  private trackSpeed(f: {x: number; z: number} | null, d: number): void {
    const last = this.lastFocus, had = last.has;
    const v = f && had && d > 0 ? Math.hypot(f.x - last.x, f.z - last.z) / d : -1;
    if (f) { last.x = f.x; last.z = f.z; }
    last.has = !!f;
    if (v < 0 || v > SURFACE_FIELD.LEAD_MAX_SPEED) return;
    const k = Math.min(1, d / 0.5); // ~0.5 s smoothing
    this.speed += (v - this.speed) * k;
    this.wakeM = SURFACE_FIELD.WAKE_M + Math.min(SURFACE_FIELD.LEAD_MAX_SPEED, this.speed) * SURFACE_FIELD.LEAD_S;
  }

  /** Replays (synchronously, unbudgeted) every zone within `radius` m of (x, z) that has history — the section build's arrival point. */
  settle(x: number, z: number, radius: number = SURFACE_FIELD.WAKE_M): number {
    let n = 0;
    for (const zn of this.zones) {
      if (!zn.field && !zn.pending.length && !zn.queue.length) continue;
      if (rectDistance(zn.spec.rect, x, z) > radius) continue;
      if (zn.mode === 'frozen') this.startReplay(zn);
      if (zn.mode === 'catching') { this.runReplay(zn, Infinity, true); n++; }
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

  /**
   * Runs zone z's replay within `budget` cell-substeps (Infinity: to the end); returns the cost spent. A step never costs more than what is
   * left of the budget (whole 0.1 s ticks, up to STEP_S) — except, when `first` (nothing else replayed this frame), one 0.1 s tick, so the
   * biggest zone still progresses: a frame's replay never exceeds max(budget, one tick of one zone).
   */
  private runReplay(z: SurfaceGasZone, budget: number, first: boolean): number {
    let spent = 0;
    const T = 1 / GAS.TICK_HZ;
    while (spent < budget) {
      const op = z.queue[0];
      const target = op ? Math.max(op.at, z.simT) : this.now;
      if (target > z.simT + 1e-9) {
        if (z.field) release(z.field);
        if (!z.field || z.field.storeys.every(s => s.asleep || !s.active)) { z.simT = target; spent += 1; continue; } // nothing moving: jump
        const cells = Math.max(1, activeCells(z.field));
        let step = Math.min(SURFACE_FIELD.STEP_S, target - z.simT);
        if (Number.isFinite(budget)) {
          const ticks = Math.floor((budget - spent) / (GasField.substeps(T) * cells));
          if (ticks < 1) {
            if (spent > 0 || !first) break; // the rest next frame
            step = Math.min(step, T);
          } else step = Math.min(step, ticks * T);
        }
        const cost = GasField.substeps(step) * cells;
        z.field.advance(step, step);
        z.simT += step;
        spent += cost;
        this.counts.replaySteps++;
        this.counts.replayCellSteps += cost;
        continue;
      }
      if (!op) { z.mode = 'live'; z.simT = this.now; break; }
      const opCost = op.kind === 'add' ? SURFACE_FIELD.OP_ADD_CELL_STEPS : SURFACE_FIELD.OP_REMOVE_CELL_STEPS;
      if (Number.isFinite(budget) && spent + opCost > budget && (spent > 0 || !first)) break; // (the op next frame)
      z.queue.shift();
      this.counts.ops++;
      if (op.kind === 'add') this.ensureField(z).addBreach(op.b);
      else z.field?.removeBreach(op.id);
      spent += opCost;
    }
    return spent;
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
