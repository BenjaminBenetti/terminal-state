// Task reactor-build-20261101 (lane AIR): THE REACTOR's air runtime — the depth gas (world/reactor/air.ts) of the built Reactor and
// its OPTIONAL auxiliary generators. installReactorAir(game) is called ONCE from the Game constructor (after installGas) and only
// REGISTERS hooks; on every level without layout.reactor it is inert (one null check per frame, the HUD line hidden).
//
// Gameplay (the user's premise): descend through deepening toxic gas; start an auxiliary generator to power its zone's extraction
// fans and clear that zone in visible, persistent stages — or bypass with the gas mask + filters (the gas system's existing
// exposure / protection, unchanged). Generator k stands in air that is already clean (the rim) or cleared (the zones above), so
// the generator route never needs a mask and never deadlocks; mixed play is allowed.
//
//  - sectionHooks: build = the run's REACTOR_LANE record (generators started / startedAt, zoneClear), the ReactorAir of this
//    layout (handed to the gas system as `gas.depth` and its strata table to the volumetric pass), the visuals of running
//    generators / spun-up fans restored at once (no re-spool, no re-crank sound); teardown = save + clear.
//  - interactHandlers / promptProviders / inputOwners: aim at a generator's control panel (or its skid) within reach of its use
//    point, unoccluded (levels.raycast, like world/towerRuntime.ts pickButton; a living enemy in front takes the press), then HOLD
//    [E] REACTOR_GEN.HOLD_S with the crosshair hold ring (hud.setHoldRing, as gear/system.ts bag hold) -> start. The hold cancels on
//    release, look-away, moving, input clears (menus / blur), death or a ladder climb. Prompts: "Hold [E] Start auxiliary
//    generator (Zone 2 extraction fans)" / the running status.
//  - frameHooks (play dt): the air's staged clearing (uniform upload only when the table changed), generator phases -> reactor
//    visuals (setGeneratorRunning: cranking 0.35 / running 1; setFanSpeed: the zone's fans spool 0 -> 1), the exhaust plume of the
//    nearest running generator (render/smoke.ts: one emitter, bounded), positional audio loops, the alert pulses and the HUD line.
//  - LOUD: at start alertListeners (ai/brain.ts) from the generator's use point with REACTOR_GEN.ALERT_START_M (line of sight +
//    slab muffling as Game.alertZombies), then smaller pulses every ALERT_PULSE_EVERY_S for the first ALERT_WINDOW_S (bounded,
//    then quiet). Existing enemies are drawn to the landing; nothing is spawned.
//  - AUDIO: named Sound Lab cues through an optional Sfx seam (ReactorSfx below: reactorCue / reactorLoop). Until the lead wires the
//    clips the methods are absent and everything is silent (no errors, no retries).
// Persistence: REACTOR_LANE (run lane store) is shared with lane RESTART — this module writes ONLY `generators` and `zoneClear`, by
// read-merge-write of the stored record (never a stale whole-record overwrite). Saved on every start / stage reached / clearAll and
// at teardown; restored on build. Nothing re-rolls: a started generator stays started, a cleared zone stays clear.

import * as THREE from 'three';
import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorGenerator, ReactorInfo, ReactorTier} from '../../gen/reactor/reactorTypes';
import {CELL} from '../../gen/grid';
import {alertListeners, type ZombieBrain} from '../../ai/brain';
import {rayCylinder} from '../towerShared';
import type {SmokeEmitterOptions, SmokeHandle} from '../../render/smoke';
import {REACTOR_LANE, loadReactorState, type ReactorRunState} from './runState';
import {reactorVisuals, type ReactorVisuals} from './visuals';
import {REACTOR_AIR, ReactorAir, fanSpool, stageOf, stagedClearTime, type DepthGasSource, type DepthGasTable, type DepthRect} from './air';
import {ReactorAirHud, type AirTone} from './airHud';

/** Generator interaction / noise tuning (s, m). */
export const REACTOR_GEN = {
  /** Hold E this long to start a generator; the ring shows after RING_DELAY_S (a tap never flashes it). */
  HOLD_S: 2.0,
  RING_DELAY_S: 0.1,
  /** Eye -> panel / skid reach along the view ray; the feet must be within STAND_M (plan) / STAND_DY of the use point / deck. */
  REACH_M: 2.6,
  STAND_M: 2.4,
  STAND_DY: 1.3,
  /** The hold cancels when the feet moved this far from where it started. */
  MOVE_CANCEL_M: 0.35,
  /** Half size of the control panel's aim box. */
  PANEL_HALF: 0.45,
  /** Visual run level while cranking. */
  CRANK_LEVEL: 0.35,
  /** Start noise radius, the follow-up pulses' radius / period and the window they run in (then quiet). */
  ALERT_START_M: 40,
  ALERT_PULSE_M: 22,
  ALERT_PULSE_EVERY_S: 15,
  ALERT_WINDOW_S: 90,
  /** Only the nearest running generator within this of the player has an exhaust plume (one smoke emitter); checked at 2 Hz. */
  EXHAUST_M: 35,
  EXHAUST_CHECK_S: 0.5,
  /** The running loop starts once the one-shot start cue (~5.6 s crank -> catch -> running) is nearly done. */
  LOOP_AFTER_S: 5.2,
  /** A loop that could not start (audio not running yet) is retried this often. */
  AUDIO_RETRY_S: 2,
  /** HUD line refresh rate. */
  HUD_HZ: 4,
} as const;

/** Sound Lab cues the lead registers (audio/bank.ts CUES + a manifest): absent = silent. */
export type ReactorCue = 'reactorGeneratorStart';
export type ReactorLoopCue = 'reactorGeneratorLoop' | 'reactorFanLoop';
export interface ReactorLoopHandle { stop(fadeS?: number): void; readonly playing?: boolean }
/**
 * The optional Sfx seam (audio/sfx.ts methods the lead adds when the clips land; until then they are absent and every call is a
 * silent no-op): a positional one-shot and a positional loop (like Sfx.flareBurnStart; null / a non-playing handle = silent now).
 */
export interface ReactorSfx {
  reactorCue(cue: ReactorCue, x: number, y: number, z: number): unknown;
  reactorLoop(cue: ReactorLoopCue, x: number, y: number, z: number): ReactorLoopHandle | null;
}

interface P3 { x: number; y: number; z: number }

/** What the runtime needs from Game (structural: tests drive it with a fake host). */
export interface ReactorAirHost {
  player: {x: number; y: number; z: number; eye: number; alive: boolean; readonly climbing: boolean};
  camera: {getWorldPosition(v: THREE.Vector3): THREE.Vector3; getWorldDirection(v: THREE.Vector3): THREE.Vector3};
  input: {down(code: string): boolean; clears: number};
  hud: {setHoldRing?(progress: number | null): void; toast(text: string, warn?: boolean): void};
  levels: {
    raycast(o: P3, d: P3, maxDist: number): {t: number; kind: string};
    lineOfSight(a: P3, b: P3): boolean;
    levelAt(x: number, z: number, y: number): number;
    readonly list: readonly {baseY: number}[];
    readonly count: number;
  };
  zombies: readonly {brain: ZombieBrain; ragdolled: boolean}[];
  layout: StationLayout;
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void};
  readonly clock: number;
  state: string;
  gas: {depth: DepthGasSource | null};
  atmosphere: {setDepthGas?(d: DepthGasTable | null): void; addSmokeEmitter?(o: SmokeEmitterOptions): SmokeHandle};
  /** Sfx (optional ReactorSfx methods; read structurally). */
  sfx?: unknown;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  interactHandlers: (() => boolean)[];
  promptProviders: (() => string | null)[];
  inputOwners?: (() => boolean)[];
  stateListeners?: ((state: never, prev: never) => void)[];
}

/** A generator's phase: not started, cranking (the start command just given), running. */
export type GeneratorPhase = 'off' | 'cranking' | 'running';

/** Phase of a generator state at game clock `clock`. */
export function generatorPhase(g: {started: boolean; startedAt: number} | undefined, clock: number): GeneratorPhase {
  if (!g?.started) return 'off';
  return clock - g.startedAt < REACTOR_AIR.CRANK_S ? 'cranking' : 'running';
}

// --- aiming (pure, allocation-free) --------------------------------------------------------------------------------------------

const slabT = [0, 0];
/** Ray-slab clip on one axis: narrows [t0, t1] (slabT); false = no overlap. */
function slab(o: number, d: number, lo: number, hi: number, t0: number, t1: number): boolean {
  if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return false; slabT[0] = t0; slabT[1] = t1; return true; }
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const k = a; a = b; b = k; }
  slabT[0] = Math.max(t0, a); slabT[1] = Math.min(t1, b);
  return slabT[0] <= slabT[1];
}

/** Ray (o, unit d) vs the axis-aligned cube of half size `h` round point c: entry t in [0, maxT] or null. */
function rayCube(o: P3, d: P3, c: P3, h: number, maxT: number): number | null {
  if (!slab(o.x, d.x, c.x - h, c.x + h, 0, maxT)) return null;
  if (!slab(o.y, d.y, c.y - h, c.y + h, slabT[0], slabT[1])) return null;
  if (!slab(o.z, d.z, c.z - h, c.z + h, slabT[0], slabT[1])) return null;
  return slabT[0];
}

/** Ray vs the generator skid (oriented box: footprint centre, yaw = three's rotation.y, long axis local X): entry t or null. */
function raySkid(o: P3, d: P3, g: ReactorGenerator, maxT: number): number | null {
  const c = Math.cos(g.yaw), s = Math.sin(g.yaw), ox = o.x - g.x, oz = o.z - g.z;
  const lox = ox * c - oz * s, loz = ox * s + oz * c, ldx = d.x * c - d.z * s, ldz = d.x * s + d.z * c;
  if (!slab(lox, ldx, -g.size.w / 2, g.size.w / 2, 0, maxT)) return null;
  if (!slab(o.y, d.y, g.y, g.y + g.size.h, slabT[0], slabT[1])) return null;
  if (!slab(loz, ldz, -g.size.d / 2, g.size.d / 2, slabT[0], slabT[1])) return null;
  return slabT[0];
}

const aimOut = {id: -1, t: 0};
/**
 * The generator the view ray aims at: its control panel box (or its skid) within REACH_M of the eye while the feet stand within
 * STAND_M / STAND_DY of its use point / deck. Nearest hit wins. Returns a shared object (copy it) or null. No occlusion (the
 * runtime adds the level raycast and the enemies).
 */
export function aimGenerator(gens: readonly ReactorGenerator[], eye: P3, dir: P3, feet: P3, reach: number = REACTOR_GEN.REACH_M): {id: number; t: number} | null {
  let best = -1, bt = reach;
  for (const g of gens) {
    const dx = feet.x - g.use.x, dz = feet.z - g.use.z;
    if (dx * dx + dz * dz > REACTOR_GEN.STAND_M * REACTOR_GEN.STAND_M || Math.abs(feet.y - g.y) > REACTOR_GEN.STAND_DY) continue;
    const tp = rayCube(eye, dir, g.panel, REACTOR_GEN.PANEL_HALF, bt);
    const ts = raySkid(eye, dir, g, bt);
    const t = tp === null ? ts : ts === null ? tp : Math.min(tp, ts);
    if (t !== null && t < bt) { bt = t; best = g.id; }
  }
  if (best < 0) return null;
  aimOut.id = best; aimOut.t = bt;
  return aimOut;
}

/** The layout's x / z bounds (every level grid shares layout.grid's size / origin). */
export function layoutRect(layout: Pick<StationLayout, 'grid'> & {levels?: readonly {grid: {w: number; h: number}}[]}): DepthRect {
  let w = layout.grid.w, h = layout.grid.h;
  for (const l of layout.levels ?? []) { w = Math.max(w, l.grid.w); h = Math.max(h, l.grid.h); }
  return {x0: 0, z0: 0, x1: w * CELL, z1: h * CELL};
}

// --- the runtime ---------------------------------------------------------------------------------------------------------------

const runtimes = new WeakMap<object, ReactorAirRuntime>();
let lastInstalled: ReactorAirRuntime | null = null;

/** The runtime installed into `host` (QA), or the last installed one. */
export function reactorAirRuntime(host?: object): ReactorAirRuntime | null {
  return host ? runtimes.get(host) ?? null : lastInstalled;
}

/** Lane RESTART (the win): the whole pit clears over `durationS` (default REACTOR_AIR.CLEAR_ALL_S). False: no Reactor built. */
export function reactorClearAll(durationS?: number): boolean {
  return lastInstalled?.clearAll(durationS) ?? false;
}

export class ReactorAirRuntime {
  /** The built Reactor's air (null on every other level). */
  air: ReactorAir | null = null;
  info: ReactorInfo | null = null;
  /** This module's live view of the REACTOR_LANE record (its `generators` / `zoneClear` are ours). */
  state: ReactorRunState | null = null;
  /** Task reactor-build-20261101 (merge fix): the reactor runs (the win called clearAll this world): every fan at full. */
  reactorPowered = false;
  /** The aimed generator (ReactorGenerator.id, -1 none) and the E hold in progress. */
  target = -1;
  hold: {gen: number; t: number; x: number; z: number; clears: number} | null = null;
  readonly hud = new ReactorAirHud();
  /** Counters (QA / tests). */
  readonly counts = {starts: 0, alerts: 0, pulses: 0, saves: 0, uploads: 0, cues: 0, loops: 0, exhausts: 0};
  private phases: GeneratorPhase[] = [];
  private fanSent: number[] = [];
  private pulseNext: number[] = [];
  private stageSaved: number[] = [];
  private tierOf = new Map<number, ReactorTier>();
  /** Per zone id: its generator id (-1 none) / the centre of its fans (the fan loop); per generator id: its loop key. */
  private zoneGen: number[] = [];
  private fanCentre: ({key: string; x: number; y: number; z: number} | null)[] = [];
  private genKey: string[] = [];
  private visualsRef: ReactorVisuals | null = null;
  private exhaust: {gen: number; h: SmokeHandle} | null = null;
  private exhaustT = 0;
  private loops = new Map<string, {h: ReactorLoopHandle | null; retry: number}>();
  private hudT = 0;
  private uploadedVersion = -1;
  private readonly vEye = new THREE.Vector3();
  private readonly vDir = new THREE.Vector3();
  private readonly eye = {x: 0, y: 0, z: 0};
  private readonly dir = {x: 0, y: 0, z: 0};
  private readonly feet = {x: 0, y: 0, z: 0};
  private readonly src = {x: 0, y: 0, z: 0};
  private readonly head = {x: 0, y: 0, z: 0};

  constructor(readonly host: ReactorAirHost) {}

  install(): this {
    const h = this.host;
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.onInteract());
    h.promptProviders.push(() => this.prompt());
    h.inputOwners?.push(() => !!this.hold);
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.cancelHold(); }) as (state: never, prev: never) => void);
    runtimes.set(h, this);
    lastInstalled = this;
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    this.reactorPowered = false; // (merge fix) a new world: the restored record's `restarted` decides
    this.clear();
    const info = layout.reactor;
    if (!info) return;
    const h = this.host, clock = h.clock;
    this.info = info;
    const nz = Math.max(info.zones.length, ...info.zones.map(z => z.id + 1));
    const ng = Math.max(info.generators.length, ...info.generators.map(g => g.id + 1));
    const st = loadReactorState(h.run.laneStore(REACTOR_LANE), ng, nz);
    // a start time in the future (a clock anomaly) is rebased so the zone stays where its saved fraction says: never a re-spool
    for (let i = 0; i < st.generators.length; i++) {
      const g = st.generators[i];
      if (g.started && g.startedAt > clock) g.startedAt = clock - Math.max(REACTOR_AIR.CRANK_S + REACTOR_AIR.SPOOL_S, stagedClearTime(this.zoneFracOfGen(info, st, i)));
    }
    this.state = st;
    this.air = new ReactorAir(info, layoutRect(layout), st);
    // the RESTART win restored mid-clearing: the whole-pit clearing resumes from its start (fractions only ever rise)
    if (st.restarted && st.zoneClear.some(f => f < 1)) this.air.clearAll(REACTOR_AIR.CLEAR_ALL_S, Math.min(clock, st.restartedAt));
    this.air.update(clock, true);
    h.gas.depth = this.air;
    this.upload(true);
    this.tierOf = new Map(info.tiers.map(t => [t.level, t]));
    this.zoneGen = new Array<number>(nz).fill(-1);
    this.fanCentre = new Array(nz).fill(null);
    for (const z of info.zones) {
      this.zoneGen[z.id] = this.air.generatorOf(z.id);
      const fans = info.fans.filter(f => f.zone === z.id);
      if (fans.length) this.fanCentre[z.id] = {key: `z${z.id}`, x: fans.reduce((s, f) => s + f.x, 0) / fans.length, y: fans.reduce((s, f) => s + f.y, 0) / fans.length, z: fans.reduce((s, f) => s + f.z, 0) / fans.length};
    }
    this.genKey = [];
    for (const g of info.generators) this.genKey[g.id] = `g${g.id}`;
    this.phases = info.generators.map(() => 'off');
    for (const g of info.generators) this.phases[g.id] = generatorPhase(st.generators[g.id], clock);
    this.fanSent = new Array<number>(Math.max(0, ...info.fans.map(f => f.id + 1))).fill(-1);
    this.pulseNext = info.generators.map(() => 1);
    for (const g of info.generators) {
      const gs = st.generators[g.id];
      this.pulseNext[g.id] = gs?.started ? Math.floor(Math.max(0, clock - gs.startedAt) / REACTOR_GEN.ALERT_PULSE_EVERY_S) + 1 : 1;
    }
    this.stageSaved = st.zoneClear.map(stageOf);
    this.visualsRef = null; // the first frame (re)sends every generator / fan level to whatever visuals ARCH registered
    this.sendVisuals(true);
  }

  teardown(): void {
    this.save();
    this.clear();
  }

  private clear(): void {
    this.cancelHold();
    for (const l of this.loops.values()) l.h?.stop(0.2);
    this.loops.clear();
    this.exhaust?.h.stop(1);
    this.exhaust = null;
    if (this.air && this.host.gas.depth === this.air) this.host.gas.depth = null;
    if (this.air) this.host.atmosphere.setDepthGas?.(null);
    this.air = null;
    this.info = null;
    this.state = null;
    this.target = -1;
    this.uploadedVersion = -1;
    this.hud.clear();
  }

  private zoneFracOfGen(info: ReactorInfo, st: ReactorRunState, gen: number): number {
    const z = info.zones.find(q => q.generator === gen) ?? info.zones.find(q => q.id === info.generators.find(g => g.id === gen)?.zone);
    return z ? st.zoneClear[z.id] ?? 0 : 0;
  }

  /** Write this module's parts (generators, zoneClear) into the stored record, keeping lane RESTART's parts as stored. */
  save(): void {
    const s = this.state, info = this.info;
    if (!s || !info) return;
    try {
      const cur = loadReactorState(this.host.run.laneStore(REACTOR_LANE), s.generators.length, s.zoneClear.length);
      cur.generators = s.generators.map(g => ({started: g.started, startedAt: g.startedAt}));
      cur.zoneClear = s.zoneClear.slice();
      this.host.run.setLaneStore(REACTOR_LANE, cur);
      this.counts.saves++;
    } catch (err) { console.warn('reactor air: saving the run state failed', err); }
  }

  /** The strata table -> the volumetric pass (only when the air rebuilt it). */
  private upload(force = false): void {
    const a = this.air;
    if (!a || (!force && a.version === this.uploadedVersion)) return;
    this.uploadedVersion = a.version;
    this.host.atmosphere.setDepthGas?.(a.renderTable());
    this.counts.uploads++;
  }

  // -------------------------------------------------------------------------------------------
  // Start / clear

  /**
   * Start generator `id` now (the completed hold, or QA): persists started / startedAt, cranks (visuals + start cue), alerts the
   * listeners in a big radius. False when there is no such generator or it already runs.
   */
  start(id: number, via: 'hold' | 'qa' = 'hold'): boolean {
    const info = this.info, st = this.state, g = info?.generators.find(q => q.id === id);
    if (!info || !st || !g || st.generators[id]?.started) return false;
    const clock = this.host.clock;
    st.generators[id] = {started: true, startedAt: clock};
    this.counts.starts++;
    this.phases[id] = 'cranking';
    this.pulseNext[id] = 1;
    reactorVisuals().setGeneratorRunning(id, REACTOR_GEN.CRANK_LEVEL);
    this.cue('reactorGeneratorStart', g.panel.x, g.panel.y, g.panel.z);
    this.alert(g, REACTOR_GEN.ALERT_START_M);
    this.save();
    if (via === 'hold') this.host.hud.toast(`Auxiliary generator started — Zone ${g.zone + 1} extraction fans spooling up. The noise will draw the infected.`);
    return true;
  }

  /** Lane RESTART's win: every zone clears over `durationS`. */
  clearAll(durationS?: number): boolean {
    this.reactorPowered = true; // (merge fix) the win: fans hold full speed from now on
    if (!this.air) return false;
    this.air.clearAll(durationS ?? REACTOR_AIR.CLEAR_ALL_S, this.host.clock);
    this.save();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (play dt)

  frame(dt: number): void {
    const a = this.air, info = this.info, st = this.state;
    if (!a || !info || !st) return;
    const h = this.host, clock = h.clock;
    if (a.update(clock)) {
      this.upload();
      // save when a zone reached a new stage (mid-stage values replay from startedAt)
      for (const z of info.zones) {
        const s = stageOf(a.clearOf(z.id));
        if (s > (this.stageSaved[z.id] ?? 0)) { this.stageSaved[z.id] = s; this.save(); }
      }
    }
    this.sendVisuals(false);
    for (const g of info.generators) {
      const gs = st.generators[g.id];
      if (!gs?.started) continue;
      const since = clock - gs.startedAt;
      // alert pulses for the first ALERT_WINDOW_S (bounded), then quiet
      const k = this.pulseNext[g.id] ?? 1;
      if (k * REACTOR_GEN.ALERT_PULSE_EVERY_S <= REACTOR_GEN.ALERT_WINDOW_S && since >= k * REACTOR_GEN.ALERT_PULSE_EVERY_S) {
        this.pulseNext[g.id] = Math.floor(since / REACTOR_GEN.ALERT_PULSE_EVERY_S) + 1;
        this.alert(g, REACTOR_GEN.ALERT_PULSE_M);
        this.counts.pulses++;
      }
    }
    this.exhaustT -= dt;
    if (this.exhaustT <= 0) { this.exhaustT = REACTOR_GEN.EXHAUST_CHECK_S; this.updateExhaust(); this.updateLoops(); }
    this.updateTarget();
    this.updateHold(dt);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 1 / REACTOR_GEN.HUD_HZ; this.updateHud(); }
  }

  /** Generator run levels and fan speeds -> the visuals (on change; all of them again when ARCH's visuals object changed). */
  private sendVisuals(force: boolean): void {
    const info = this.info, st = this.state;
    if (!info || !st) return;
    const v = reactorVisuals(), clock = this.host.clock;
    const all = force || v !== this.visualsRef;
    this.visualsRef = v;
    for (const g of info.generators) {
      const p = generatorPhase(st.generators[g.id], clock);
      if (all || p !== this.phases[g.id]) v.setGeneratorRunning(g.id, p === 'running' ? 1 : p === 'cranking' ? REACTOR_GEN.CRANK_LEVEL : 0);
      this.phases[g.id] = p;
    }
    for (const f of info.fans) {
      const gid = this.zoneGen[f.zone] ?? -1, gs = gid >= 0 ? st.generators[gid] : undefined;
      // task reactor-build-20261101 (primary, merge fix): once the reactor is restarted (the win: clearAll, or a restored restarted
      // record) every fan runs at full on reactor power — a generator started afterwards never dips its zone's fans
      const s = this.reactorPowered || st.restarted ? 1 : gs?.started ? fanSpool(clock - gs.startedAt) : 0;
      const q = Math.round(s * 50) / 50;
      if (all || q !== this.fanSent[f.id]) { v.setFanSpeed(f.id, q); this.fanSent[f.id] = q; }
    }
  }

  /** A noise at the generator's use point (head height) heard by the existing enemies: line of sight / slab muffling. */
  private alert(g: ReactorGenerator, radius: number): void {
    const h = this.host, L = h.levels;
    if (!L || !h.zombies.length) return;
    const src = this.src, head = this.head;
    src.x = g.use.x; src.y = g.y + 1.5; src.z = g.use.z;
    const bases = L.count > 1 ? L.list.map(l => l.baseY) : null;
    alertListeners(h.zombies.map(z => z.brain), src, radius, b => { head.x = b.x; head.y = b.y + 1.5; head.z = b.z; return L.lineOfSight(src, head); }, bases);
    this.counts.alerts++;
  }

  /** One exhaust plume: the nearest running generator within EXHAUST_M of the player (re-added if the smoke pool evicted it). */
  private updateExhaust(): void {
    const info = this.info, st = this.state, add = this.host.atmosphere.addSmokeEmitter;
    if (!info || !st || !add) return;
    const p = this.host.player, clock = this.host.clock;
    let best: ReactorGenerator | null = null, bd: number = REACTOR_GEN.EXHAUST_M;
    for (const g of info.generators) {
      if (generatorPhase(st.generators[g.id], clock) === 'off') continue;
      const d = Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z);
      if (d < bd) { bd = d; best = g; }
    }
    const ex = this.exhaust;
    if (ex && (!best || ex.gen !== best.id || !ex.h.alive)) { ex.h.stop(3); this.exhaust = null; }
    if (best && !this.exhaust) {
      const c = Math.cos(best.yaw), s = Math.sin(best.yaw), off = best.size.w * 0.3;
      this.exhaust = {gen: best.id, h: add.call(this.host.atmosphere, {x: best.x + c * off, y: best.y + best.size.h + 0.4, z: best.z - s * off, color: 0x5a5a52, rate: 0.9, radius: 1.3, life: 6, density: 0.55})};
      this.counts.exhausts++;
    }
  }

  /** Positional loops: one per running generator, one per zone whose fans run (centroid of its fans). Silent without the seam. */
  private updateLoops(): void {
    const info = this.info, st = this.state, sfx = this.host.sfx as Partial<ReactorSfx> | null | undefined;
    if (!info || !st || typeof sfx?.reactorLoop !== 'function') return;
    const clock = this.host.clock;
    for (const g of info.generators) {
      const gs = st.generators[g.id];
      if (!gs?.started || clock - gs.startedAt < REACTOR_GEN.LOOP_AFTER_S) continue;
      this.ensureLoop(this.genKey[g.id], 'reactorGeneratorLoop', g.x, g.y + g.size.h * 0.5, g.z, sfx as ReactorSfx);
    }
    for (const z of info.zones) {
      const gid = this.zoneGen[z.id] ?? -1, gs = gid >= 0 ? st.generators[gid] : undefined, c = this.fanCentre[z.id];
      if (!gs?.started || !c || fanSpool(clock - gs.startedAt) <= 0) continue;
      this.ensureLoop(c.key, 'reactorFanLoop', c.x, c.y, c.z, sfx as ReactorSfx);
    }
  }

  private ensureLoop(key: string, cue: ReactorLoopCue, x: number, y: number, z: number, sfx: ReactorSfx): void {
    const l = this.loops.get(key), now = this.host.clock;
    if (l && (l.h?.playing ?? !!l.h)) return;
    if (l && now < l.retry) return;
    let h: ReactorLoopHandle | null = null;
    try { h = sfx.reactorLoop(cue, x, y, z); } catch { h = null; }
    this.loops.set(key, {h, retry: now + REACTOR_GEN.AUDIO_RETRY_S});
    if (h && (h.playing ?? true)) this.counts.loops++;
  }

  private cue(cue: ReactorCue, x: number, y: number, z: number): void {
    const sfx = this.host.sfx as Partial<ReactorSfx> | null | undefined;
    if (typeof sfx?.reactorCue !== 'function') return;
    try { sfx.reactorCue(cue, x, y, z); this.counts.cues++; } catch { /* audio is never fatal */ }
  }

  // -------------------------------------------------------------------------------------------
  // Aim / hold / prompt

  /** The generator under the crosshair (unoccluded, no living enemy in front), -1 none. */
  pick(): number {
    const info = this.info, h = this.host;
    if (!info || !h.player.alive || h.state !== 'playing') return -1;
    h.camera.getWorldPosition(this.vEye);
    h.camera.getWorldDirection(this.vDir);
    const eye = this.eye, d = this.dir, feet = this.feet, p = h.player;
    eye.x = this.vEye.x; eye.y = this.vEye.y; eye.z = this.vEye.z;
    d.x = this.vDir.x; d.y = this.vDir.y; d.z = this.vDir.z;
    feet.x = p.x; feet.y = p.y; feet.z = p.z;
    const a = aimGenerator(info.generators, eye, d, feet);
    if (!a) return -1;
    const id = a.id, t = a.t;
    // unobstructed: nothing more than a panel's depth in front of the aimed box (the skid's own collision cells stand at its face)
    const blocked = h.levels.raycast(eye, d, t + 0.02);
    if (blocked.kind !== 'none' && blocked.t < t - 0.3) return -1;
    // a living enemy in front of the panel takes the press (you can always shoot what stands before it)
    for (const z of h.zombies) {
      const b = z.brain;
      if (!b.alive || z.ragdolled) continue;
      const dx = b.x - eye.x, dz = b.z - eye.z;
      if (dx * dx + dz * dz > (t + 1) * (t + 1)) continue;
      if (rayCylinder(eye, d, b.x, b.z, b.stats.radius + 0.05, b.y, b.y + 1.9, t) !== null) return -1;
    }
    return id;
  }

  private updateTarget(): void {
    this.target = this.pick();
  }

  /** E: an aimed, stopped generator starts the hold (true = the press is ours). A running one consumes the press (status only). */
  onInteract(): boolean {
    const st = this.state;
    if (!this.info || !st) return false;
    if (this.hold) return true;
    const id = this.target >= 0 ? this.target : this.pick();
    if (id < 0) return false;
    this.target = id;
    if (st.generators[id]?.started) return true;
    const p = this.host.player;
    this.hold = {gen: id, t: 0, x: p.x, z: p.z, clears: this.host.input.clears};
    return true;
  }

  private cancelHold(): void {
    if (!this.hold) return;
    this.hold = null;
    this.host.hud.setHoldRing?.(null);
  }

  /** The E hold: complete after HOLD_S; cancelled on release / look-away / moving / clears / death / climbing / started meanwhile. */
  private updateHold(dt: number): void {
    const hd = this.hold, h = this.host;
    if (!hd) return;
    const p = h.player;
    const cancel = h.input.clears !== hd.clears || !h.input.down('KeyE') || this.target !== hd.gen || !p.alive || p.climbing
      || Math.hypot(p.x - hd.x, p.z - hd.z) > REACTOR_GEN.MOVE_CANCEL_M || !!this.state?.generators[hd.gen]?.started;
    if (cancel) { this.cancelHold(); return; }
    hd.t += dt;
    if (hd.t >= REACTOR_GEN.HOLD_S) {
      this.hold = null;
      h.hud.setHoldRing?.(null);
      this.start(hd.gen, 'hold');
      return;
    }
    h.hud.setHoldRing?.(hd.t >= REACTOR_GEN.RING_DELAY_S ? Math.min(1, hd.t / REACTOR_GEN.HOLD_S) : null);
  }

  /** E-hold progress 0..1 (null: no hold) — QA / tests. */
  get holdProgress(): number | null {
    return this.hold ? Math.min(1, this.hold.t / REACTOR_GEN.HOLD_S) : null;
  }

  /** Zone status words for a zone id: fans off / spooling / clearing NN % / clear. */
  zoneStatus(zone: number): {text: string; tone: AirTone} {
    const a = this.air, st = this.state;
    if (!a || !st || zone < 0) return {text: 'clean air', tone: 'clear'};
    const f = a.clearOf(zone);
    if (f >= 0.999) return {text: 'air clear', tone: 'clear'};
    const gid = a.generatorOf(zone), gs = gid >= 0 ? st.generators[gid] : undefined, clock = this.host.clock;
    if (gs?.started && fanSpool(clock - gs.startedAt) < 1 && f <= 0) return {text: 'fans spooling', tone: 'clearing'};
    if ((gs?.started || a.clearingAll) && f < 1) return {text: `air clearing ${Math.floor(f * 100)} %`, tone: 'clearing'};
    if (f > 0) return {text: `air ${Math.floor(f * 100)} % clear`, tone: 'toxic'};
    return {text: 'toxic air · fans off', tone: 'toxic'};
  }

  prompt(): string | null {
    const info = this.info, st = this.state;
    if (!info || !st) return null;
    const id = this.hold ? this.hold.gen : this.target;
    const g = id >= 0 ? info.generators.find(q => q.id === id) : undefined;
    if (!g) return null;
    const zone = `Zone ${g.zone + 1}`;
    if (this.hold) return `<b>Hold [E]</b> Starting the auxiliary generator… (${zone} extraction fans)`;
    const p = generatorPhase(st.generators[g.id], this.host.clock);
    if (p === 'off') return `<b>Hold [E]</b> Start auxiliary generator (${zone} extraction fans)`;
    if (p === 'cranking') return `Auxiliary generator cranking… (${zone} extraction fans)`;
    return `Auxiliary generator running · ${zone} fans: ${this.zoneStatus(g.zone).text}`;
  }

  /** The compact depth / air line: "Tier 3 · Zone 2 · air clearing 60 %" (the rim: "Rim · clean air"). */
  private updateHud(): void {
    const info = this.info, p = this.host.player;
    if (!info) { this.hud.clear(); return; }
    const L = this.host.levels;
    let tier = L ? this.tierOf.get(L.levelAt(p.x, p.z, p.y)) : undefined;
    if (!tier) { // between decks (stairs, falling): the nearest tier at or below the feet
      for (const t of info.tiers) if (t.baseY <= p.y + 0.5 && (!tier || t.baseY > tier.baseY)) tier = t;
    }
    if (!tier) { this.hud.clear(); return; }
    const s = this.zoneStatus(tier.zone);
    this.hud.update(tier.zone < 0 ? `${tier.label} · ` : `${tier.label} · Zone ${tier.zone + 1} · `, s.text, s.tone);
  }

  /** QA / tests: the generators' live state. */
  generators(): {id: number; zone: number; level: number; phase: GeneratorPhase; started: boolean; startedAt: number; since: number; spool: number; pulses: number}[] {
    const info = this.info, st = this.state, clock = this.host.clock;
    if (!info || !st) return [];
    return info.generators.map(g => {
      const gs = st.generators[g.id];
      const since = gs?.started ? clock - gs.startedAt : 0;
      return {id: g.id, zone: g.zone, level: g.level, phase: generatorPhase(gs, clock), started: !!gs?.started, startedAt: gs?.startedAt ?? 0, since, spool: gs?.started ? fanSpool(since) : 0, pulses: Math.max(0, (this.pulseNext[g.id] ?? 1) - 1)};
    });
  }
}

/** Installs the Reactor air runtime into a Game (one call in the Game constructor, after installGas). */
export function installReactorAir(host: ReactorAirHost): ReactorAirRuntime {
  return new ReactorAirRuntime(host).install();
}
