// Task reactor-build-20261101 (lane RESTART): THE RESTART's pure rules — which industrial control does what, in which order, with
// which part, and what the panel says about it. No three.js / DOM (tests drive it directly); world/reactor/restart.ts is the runtime
// (targeting, HOLD-E, views, screens, the win sequence) and the only caller in the game.
//
// The job (DESIGN-MANIFEST §5, credible industrial work — no abstract puzzle):
//  - SWITCHGEAR: two burnt fuse cartridges to replace ('fuse-0' / 'fuse-1': press E with a `fuse_cartridge`, consumed once), then
//    close the main breaker ('breaker': HOLD E 1 s, only with both slots filled) -> control power ON;
//  - PUMP HALL: open the main coolant valve ('valve': HOLD E 3 s, a manual handwheel — no power needed), start the circulation
//    pump ('pump': press E; needs control power AND the valve open);
//  - CONTROL ROOM: the shift supervisor's startup key in the key switch ('keyswitch': press E with the `reactor_key`, consumed once),
//    withdraw the control rods ('rods': HOLD E 4 s; needs the key in and the pump running) -> THE WIN.
// Progress is MONOTONIC (nothing is ever undone or re-rolled): a seated cartridge stays seated, the key stays in the switch.

import {REACTOR_FUSE_SLOTS, loadReactorState, reactorTasks, type ReactorRunState, type ReactorTaskStatus} from './runState';

/** The restart controls (ReactorControl.id values this lane operates; GEN places them in layout.reactor.sites[].controls). */
export type RestartControlId = 'fuse-0' | 'fuse-1' | 'breaker' | 'valve' | 'pump' | 'keyswitch' | 'rods';
export const RESTART_CONTROL_IDS: readonly RestartControlId[] = ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch', 'rods'];
export const isRestartControl = (id: string): id is RestartControlId => (RESTART_CONTROL_IDS as readonly string[]).includes(id);

/** The restart parts (items/items.ts; finite, placed once by lane GEN, never in a loot table). */
export const REACTOR_KEY_ID = 'reactor_key';
export const FUSE_CARTRIDGE_ID = 'fuse_cartridge';

/** Seconds E must be held on a HOLD control (0 = a press control). */
export const HOLD_S: Readonly<Record<RestartControlId, number>> = {'fuse-0': 0, 'fuse-1': 0, breaker: 1.0, valve: 3.0, pump: 0, keyswitch: 0, rods: 4.0};

/** Short names (toasts, QA). */
export const CONTROL_NAME: Readonly<Record<RestartControlId, string>> = {
  'fuse-0': 'fuse slot 1', 'fuse-1': 'fuse slot 2', breaker: 'main breaker', valve: 'main coolant valve', pump: 'circulation pump',
  keyswitch: 'key switch', rods: 'control rods',
};

/** What the inventory must offer (game Inventory: count / take; take returns how many were removed). */
export interface RestartInventory { count(itemId: string): number; take(itemId: string, n: number): number }

/** Where the parts lie (layout.reactor.components[].where) — the refusal texts point there. */
export interface RestartHints { key?: string; fuse?: string }

export type RestartEvent =
  | {type: 'fuse'; slot: number; installed: number}
  | {type: 'breaker'} | {type: 'valve'} | {type: 'pump'} | {type: 'key'} | {type: 'rods'};

export type OperateResult = {ok: true; event: RestartEvent} | {ok: false; why: string; done: boolean};

const fuseSlot = (id: RestartControlId): number => (id === 'fuse-0' ? 0 : id === 'fuse-1' ? 1 : -1);
export const fusesInstalled = (s: ReactorRunState): number => s.fuses.reduce((n, f) => n + (f ? 1 : 0), 0);
export const allFuses = (s: ReactorRunState): boolean => s.fuses.length >= REACTOR_FUSE_SLOTS && s.fuses.every(Boolean);

/** The control already did its job (monotonic). */
export function controlDone(s: ReactorRunState, id: RestartControlId): boolean {
  switch (id) {
    case 'fuse-0': case 'fuse-1': return !!s.fuses[fuseSlot(id)];
    case 'breaker': return s.breaker;
    case 'valve': return s.valve;
    case 'pump': return s.pump;
    case 'keyswitch': return s.keyInserted;
    case 'rods': return s.rods;
  }
}

/** Status text of a control that already did its job. */
export function doneText(s: ReactorRunState, id: RestartControlId): string {
  switch (id) {
    case 'fuse-0': case 'fuse-1': return `Fuse slot ${fuseSlot(id) + 1} · cartridge seated ✓`;
    case 'breaker': return 'Main breaker closed · control power ON ✓';
    case 'valve': return 'Main coolant valve open ✓';
    case 'pump': return 'Circulation pump running · coolant flowing ✓';
    case 'keyswitch': return 'Startup key in the switch · RUN ✓';
    case 'rods': return s.restarted ? 'Control rods withdrawn · the reactor is running ✓' : 'Control rods withdrawn ✓';
  }
}

const where = (w: string | undefined) => (w ? ` — ${w}` : '');

/**
 * Why the control cannot be operated right now (null = it can). A control that is already done returns its status text (callers
 * check controlDone first to tell the two apart).
 */
export function blocker(s: ReactorRunState, id: RestartControlId, inv: Pick<RestartInventory, 'count'>, hints: RestartHints = {}): string | null {
  if (controlDone(s, id)) return doneText(s, id);
  switch (id) {
    case 'fuse-0': case 'fuse-1':
      return inv.count(FUSE_CARTRIDGE_ID) > 0 ? null : `Burnt-out fuse — you need a fuse cartridge in your pockets or quick slots${where(hints.fuse)}`;
    case 'breaker':
      return allFuses(s) ? null : `Replace the burnt fuses first (${fusesInstalled(s)} of ${REACTOR_FUSE_SLOTS} cartridges seated)`;
    case 'valve':
      return null; // a manual handwheel: no power needed
    case 'pump': {
      if (s.breaker && s.valve) return null;
      if (!s.breaker && !s.valve) return 'The pump needs control power (the switchgear breaker) and the main coolant valve open';
      return !s.breaker ? 'No control power — close the main breaker in the switchgear first' : 'Open the main coolant valve first (hold E on the handwheel)';
    }
    case 'keyswitch':
      return inv.count(REACTOR_KEY_ID) > 0 ? null : `The key switch needs the startup key — the shift supervisor's key${where(hints.key)}`;
    case 'rods': {
      const miss: string[] = [];
      if (!s.keyInserted) miss.push('the startup key in the switch');
      if (!s.breaker) miss.push('control power');
      if (!s.pump) miss.push(s.valve ? 'the circulation pump running' : 'coolant flow (valve + pump)');
      return miss.length ? `Rod control locked — needs ${miss.join(', ')}` : null;
    }
  }
}

/**
 * Operate a control NOW (a press, or a hold that just completed): checks the rules, consumes the part EXACTLY once (inv.take must
 * return 1, else nothing changes) and mutates `s`. `clock` = the game clock (s) recorded as restartedAt.
 */
export function operate(s: ReactorRunState, id: RestartControlId, inv: RestartInventory, clock: number, hints: RestartHints = {}): OperateResult {
  if (controlDone(s, id)) return {ok: false, why: doneText(s, id), done: true};
  const why = blocker(s, id, inv, hints);
  if (why) return {ok: false, why, done: false};
  switch (id) {
    case 'fuse-0': case 'fuse-1': {
      if (inv.take(FUSE_CARTRIDGE_ID, 1) !== 1) return {ok: false, why: 'No fuse cartridge to fit', done: false};
      const slot = fuseSlot(id);
      s.fuses[slot] = true;
      return {ok: true, event: {type: 'fuse', slot, installed: fusesInstalled(s)}};
    }
    case 'breaker': s.breaker = true; return {ok: true, event: {type: 'breaker'}};
    case 'valve': s.valve = true; return {ok: true, event: {type: 'valve'}};
    case 'pump': s.pump = true; return {ok: true, event: {type: 'pump'}};
    case 'keyswitch':
      if (inv.take(REACTOR_KEY_ID, 1) !== 1) return {ok: false, why: 'No startup key to insert', done: false};
      s.keyInserted = true;
      return {ok: true, event: {type: 'key'}};
    case 'rods':
      s.rods = true;
      s.restarted = true;
      s.restartedAt = Number.isFinite(clock) ? clock : 0;
      return {ok: true, event: {type: 'rods'}};
  }
}

/** The HUD prompt line for a targeted control (`hold` = 0..1 while E is being held on it, else null). */
export function controlPrompt(s: ReactorRunState, id: RestartControlId, inv: Pick<RestartInventory, 'count'>, hold: number | null = null): string {
  if (controlDone(s, id)) return doneText(s, id);
  const H = '<b>Hold [E]</b> ', P = '<b>[E]</b> ';
  if (hold !== null) {
    const pct = `${Math.min(99, Math.floor(hold * 100))} %`;
    if (id === 'breaker') return `${H}Closing the main breaker… ${pct}`;
    if (id === 'valve') return `${H}Turning the handwheel… ${pct}`;
    return `${H}Withdrawing the control rods… ${pct}`;
  }
  const blocked = blocker(s, id, inv) !== null;
  switch (id) {
    case 'fuse-0': case 'fuse-1': {
      const n = fuseSlot(id) + 1;
      return blocked ? `Fuse slot ${n} · burnt out — needs a fuse cartridge` : `${P}Fit a fuse cartridge · slot ${n}`;
    }
    case 'breaker': return blocked ? `Main breaker · replace the burnt fuses first (${fusesInstalled(s)} of ${REACTOR_FUSE_SLOTS} fitted)` : `${H}Close the main breaker`;
    case 'valve': return `${H}Open the main coolant valve`;
    case 'pump': return blocked ? `Circulation pump · needs ${!s.breaker && !s.valve ? 'control power + the coolant valve open' : !s.breaker ? 'control power' : 'the coolant valve open'}` : `${P}Start the circulation pump`;
    case 'keyswitch': return blocked ? 'Key switch · needs the startup key' : `${P}Insert the startup key`;
    case 'rods': return blocked ? `Control rods · ${blocker(s, id, inv)!.replace(/^Rod control locked — /, '')}` : `${H}Withdraw the control rods — restart the reactor`;
  }
}

// ---------------------------------------------------------------------------------------------
// Persistence: ONE record shared with lane AIR (runState.ts) — read-modify-write of RESTART's fields only

/** The RESTART fields of the record (AIR owns `generators` / `zoneClear`). */
export interface RestartFields {
  fuses: boolean[]; breaker: boolean; valve: boolean; pump: boolean; keyInserted: boolean; rods: boolean; restarted: boolean; restartedAt: number;
}
export const RESTART_FIELDS: readonly (keyof RestartFields)[] = ['fuses', 'breaker', 'valve', 'pump', 'keyInserted', 'rods', 'restarted', 'restartedAt'];

export const pickRestartFields = (s: ReactorRunState): RestartFields => ({
  fuses: [...s.fuses], breaker: s.breaker, valve: s.valve, pump: s.pump, keyInserted: s.keyInserted, rods: s.rods, restarted: s.restarted, restartedAt: s.restartedAt,
});

/** The run's lane-store API (RunState.laneStore / setLaneStore; Game.run is replaced by NewGame: always pass the live one). */
export interface RestartRun { laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, data: unknown): void }

/** The persisted state for this layout (the shared record, any shape -> valid). */
export function readRestartState(run: RestartRun, lane: string, generators: number, zones: number): ReactorRunState {
  return loadReactorState(run.laneStore(lane), generators, zones);
}

/**
 * Writes RESTART's fields by READ-MERGE-WRITE: re-reads the stored record (lane AIR's latest `generators` / `zoneClear` are kept
 * exactly as stored — AIR does the same for its keys), sets only RESTART's fields, writes it back. Never a stale whole record.
 */
export function writeRestartState(run: RestartRun, lane: string, generators: number, zones: number, s: ReactorRunState): void {
  const cur = loadReactorState(run.laneStore(lane), generators, zones);
  const mine = pickRestartFields(s);
  cur.fuses = [...mine.fuses];
  cur.breaker = mine.breaker; cur.valve = mine.valve; cur.pump = mine.pump; cur.keyInserted = mine.keyInserted; cur.rods = mine.rods;
  cur.restarted = mine.restarted; cur.restartedAt = mine.restartedAt;
  run.setLaneStore(lane, cur);
}

/** The layout bits the "next step" line reads (layout.reactor). */
export interface NextStepInfo {
  tiers: readonly {level: number; label: string}[];
  sites: readonly {id: string; level: number}[];
  components: readonly {item: string; where: string}[];
}

/**
 * The pit board's "Next: …" line — where to go and what to do next (the order a crew would follow). Task reactor-playtest-round2-20261102
 * (lane GAS): `mask` = the storeys kept gassed by the jammed generator (gen/reactor/gasJam.ts) and the note a step there gets
 * (" · gas mask + filters (fans jammed)"); absent / empty = no note.
 */
export function nextStepText(s: ReactorRunState, info: NextStepInfo, inv: Pick<RestartInventory, 'count'>, mask?: {levels: readonly number[]; note: string} | null): string {
  if (s.restarted) return 'Reactor running — surface ventilation towers powered';
  const at = (site: string) => {
    const st = info.sites.find(x => x.id === site);
    const tier = st ? info.tiers.find(t => t.level === st.level) : undefined;
    return tier ? ` (${tier.label})${mask && mask.levels.includes(st!.level) ? ` · ${mask.note}` : ''}` : '';
  };
  const whereOf = (item: string) => info.components.find(c => c.item === item)?.where;
  if (!s.keyInserted && inv.count(REACTOR_KEY_ID) < 1) { const w = whereOf(REACTOR_KEY_ID); return `Next: find the startup key${w ? ` — ${w}` : ''}`; }
  if (!allFuses(s) && inv.count(FUSE_CARTRIDGE_ID) < REACTOR_FUSE_SLOTS - fusesInstalled(s)) { const w = whereOf(FUSE_CARTRIDGE_ID); return `Next: find spare fuse cartridges${w ? ` — ${w}` : ''}`; }
  if (!allFuses(s)) return `Next: replace the burnt fuses — switchgear${at('switchgear')}`;
  if (!s.breaker) return `Next: close the main breaker — switchgear${at('switchgear')}`;
  if (!s.valve) return `Next: open the main coolant valve — pump hall${at('pumpHall')}`;
  if (!s.pump) return `Next: start the circulation pump — pump hall${at('pumpHall')}`;
  if (!s.keyInserted) return `Next: insert the startup key — control room${at('control')}`;
  return `Next: withdraw the control rods — control room${at('control')}`;
}

/** The task statuses (runState.reactorTasks) + a compact ticked line for the HUD ("✓ Key · Power · Coolant · Rods"). */
export function taskLine(s: ReactorRunState): {tasks: ReturnType<typeof reactorTasks>; html: string} {
  const tasks = reactorTasks(s);
  const part = (label: string, st: ReactorTaskStatus) => `<span class="rt ${st}">${st === 'done' ? '✓ ' : ''}${label}</span>`;
  return {tasks, html: [part('Key', tasks.key), part('Power', tasks.power), part('Coolant', tasks.coolant), part('Rods', tasks.rods)].join(' · ')};
}
