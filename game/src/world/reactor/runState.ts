// Task reactor-build-20261101 (primary): THE REACTOR's one persisted runtime record — the run's 'reactor.state' lane store (run/
// runState.ts laneStore / setLaneStore, section 'reactor:main'). Pure (no three.js / DOM). Two lanes write disjoint parts of it:
//  - lane AIR (world/reactor/air.ts + generators): `generators` (started / when) and `zoneClear` (the staged clearing reached);
//    task reactor-playtest-round2-20261102 (lane GAS): + `jam` (the jammed final generator, gen/reactor/gasJam.ts, and its stalled starts);
//  - lane RESTART (world/reactor/restart.ts): the restart controls (`fuses`, `breaker`, `valve`, `pump`, `keyInserted`, `rods`) and
//    the win (`restarted`, `restartedAt`).
// Saved on section teardown and on every state change (a change is rare: one record write); restored on build. Travel keeps it,
// Retry restores the level-entry snapshot (the run's normal rule), NewGame starts clean. Nothing ever re-rolls: a started generator
// stays started, a cleared zone stays clear, an inserted fuse stays inserted (its item was consumed once).

export const REACTOR_LANE = 'reactor.state';

export interface ReactorGeneratorState {
  started: boolean;
  /** Game clock (s) at start; the spool / clearing stages are replayed from it on rebuild. */
  startedAt: number;
}

/** Task reactor-playtest-round2-20261102 (lane GAS): the jam record (lane GAS writes it with `generators` / `zoneClear`). */
export interface ReactorJamState { generator: number; stalls: number; at: number }

export interface ReactorRunState {
  v: 1;
  /** Per ReactorGenerator.id. */
  generators: ReactorGeneratorState[];
  /** Per ReactorZone.id: cleared fraction reached (0 = uncleared depth gas, 1 = fully cleared). */
  zoneClear: number[];
  /**
   * Task reactor-playtest-round2-20261102 (lane GAS): the JAMMED final generator (gen/reactor/gasJam.ts reactorJam; -1 none), how
   * many starts stalled on it and when the last one did (game clock s). Persistent: a revisit shows the same jam, never a fresh one.
   */
  jam: ReactorJamState;
  /** Fuse slots of the switchgear (true = a cartridge is installed; the item was consumed). */
  fuses: boolean[];
  /** Main breaker closed (control power on: needs every fuse slot filled). */
  breaker: boolean;
  /** Main coolant valve open (hold to turn the handwheel). */
  valve: boolean;
  /** Circulation pump running (needs control power and the valve open). */
  pump: boolean;
  /** Startup key in the control console's key switch (the item was consumed). */
  keyInserted: boolean;
  /** Control rods withdrawn (the win action: needs key, power and coolant). */
  rods: boolean;
  /** The reactor restarted (the local win); when (game clock s). */
  restarted: boolean;
  restartedAt: number;
}

/** Fuse slots in the switchgear (two burnt cartridges to replace). */
export const REACTOR_FUSE_SLOTS = 2;

export function emptyReactorState(generators: number, zones: number): ReactorRunState {
  return {
    v: 1,
    generators: Array.from({length: generators}, () => ({started: false, startedAt: 0})),
    zoneClear: Array.from({length: zones}, () => 0),
    jam: {generator: -1, stalls: 0, at: 0}, // (lane GAS)
    fuses: Array.from({length: REACTOR_FUSE_SLOTS}, () => false),
    breaker: false, valve: false, pump: false, keyInserted: false, rods: false, restarted: false, restartedAt: 0,
  };
}

const bool = (v: unknown): boolean => v === true;
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A stored record (any shape: old / foreign / missing) as a valid state for this layout's generator / zone counts. */
export function loadReactorState(raw: unknown, generators: number, zones: number): ReactorRunState {
  const s = emptyReactorState(generators, zones);
  if (!raw || typeof raw !== 'object' || (raw as {v?: unknown}).v !== 1) return s;
  const r = raw as Partial<Record<keyof ReactorRunState, unknown>>;
  const gens = Array.isArray(r.generators) ? r.generators : [];
  for (let i = 0; i < generators; i++) {
    const g = gens[i] as Partial<ReactorGeneratorState> | undefined;
    if (g && typeof g === 'object') s.generators[i] = {started: bool(g.started), startedAt: num(g.startedAt)};
  }
  const zc = Array.isArray(r.zoneClear) ? r.zoneClear : [];
  for (let i = 0; i < zones; i++) s.zoneClear[i] = Math.min(1, Math.max(0, num(zc[i])));
  const jm = r.jam as Partial<ReactorJamState> | undefined; // (lane GAS)
  if (jm && typeof jm === 'object') {
    const g = Math.trunc(num(jm.generator, -1));
    s.jam = {generator: g >= 0 && g < generators ? g : -1, stalls: Math.max(0, Math.trunc(num(jm.stalls))), at: num(jm.at)};
  }
  const fz = Array.isArray(r.fuses) ? r.fuses : [];
  for (let i = 0; i < REACTOR_FUSE_SLOTS; i++) s.fuses[i] = bool(fz[i]);
  s.breaker = bool(r.breaker) && s.fuses.every(Boolean);
  s.valve = bool(r.valve);
  s.pump = bool(r.pump) && s.breaker && s.valve;
  s.keyInserted = bool(r.keyInserted);
  s.rods = bool(r.rods) && s.keyInserted && s.pump;
  s.restarted = bool(r.restarted) && s.rods;
  s.restartedAt = s.restarted ? num(r.restartedAt) : 0;
  return s;
}

/** Status of one restart task for boards / HUD: 'done', 'ready' (can be done now), 'blocked' (a prerequisite is missing). */
export type ReactorTaskStatus = 'done' | 'ready' | 'blocked';

/** The restart tasks' statuses (key / control power / coolant / rods) from a state. */
export function reactorTasks(s: ReactorRunState): {key: ReactorTaskStatus; power: ReactorTaskStatus; coolant: ReactorTaskStatus; rods: ReactorTaskStatus} {
  const power = s.breaker ? 'done' : 'ready';
  const coolant = s.pump ? 'done' : s.breaker ? 'ready' : 'blocked';
  const key = s.keyInserted ? 'done' : 'ready';
  const rods = s.rods ? 'done' : s.keyInserted && s.pump ? 'ready' : 'blocked';
  return {key, power, coolant, rods};
}
