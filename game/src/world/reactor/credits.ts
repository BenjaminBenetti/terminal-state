// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): THE END CREDITS at runtime —
// installReactorCredits(game) is called ONCE from the Game constructor (after ENDING) and only REGISTERS (inert on every level without
// `layout.reactor.surface`):
//  - sectionHooks: build = read this station's lane store CREDITS_LANE (creditsLogic.ts loadCreditsState); a started scroll resumes at
//    its position, a finished one shows nothing again; teardown = save the record, remove the column.
//  - frameHooks (play time only): the gate (creditsLogic.ts CreditsGate: ending.surfaced from the live ENDING runtime, else its
//    persisted record; the player on the surface storey as ending.ts tests it; 'playing'; the tab visible; the centre "External doors
//    open" message not on screen) -> the 30 s count -> the scroll -> the end card. Enter while playing = the end card's button.
//  - stateListeners: the column shows while playing; while paused only the end card (clickable above the pause dim); hidden otherwise.
//  - "Main Menu": the record is stored, then the run is SAVED through the existing save flow (host.commitEndingSave: Game.commitSave
//    reason 'ending'), then the real campaign return (host.returnToMenu: trainRide.reset + the title, as the pause "Main menu"). A failed
//    write shows its error on the card; the next press leaves without saving. Never a reload, a reset or an erase; other slots untouched.
// The campaign win is untouched (game.ts campaignTick / onCampaignWin): no second win, no modal, no forced new game.

import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo, ReactorSurface} from '../../gen/reactor/reactorTypes';
import {REACTOR_LANE, loadReactorState} from './runState';
import {reactorEndingOf} from './ending';
import {
  CREDITS, CREDITS_LANE, END_CARD, advanceCredits, creditsPhase, creditsRecord, emptyCreditsState, loadCreditsState, scrollProgress,
  stepCredits, type CreditsGate, type CreditsState,
} from './creditsLogic';
import {mountCreditsView, type CreditsMode, type CreditsView, type CreditsViewHandlers} from '../../ui/credits';

/** The ending save's outcome (Game.commitEndingSave: CommitResult; null = nothing to save — a run without a campaign / slot flow). */
export type EndingSaveResult = {ok: true} | {ok: false; error: string} | null;

/** What the credits runtime needs from Game (structural: tests drive it with a fake host). */
export interface CreditsHost {
  player: {x: number; y: number; z: number; alive: boolean};
  layout: StationLayout;
  levels: {levelAt(x: number, z: number, y: number): number};
  run: {laneStore<T = unknown>(lane: string): T | undefined; setLaneStore(lane: string, v: unknown): void};
  state: string;
  /** This frame's newly pressed keys (player/input.ts Input.pressed): Enter on the end card. */
  input?: {pressed: {has(code: string): boolean}};
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  /** The ending save (Game.commitEndingSave). */
  commitEndingSave?(): EndingSaveResult;
  /** The campaign return to the main menu (Game.returnToMenu). */
  returnToMenu?(): void;
}

export interface CreditsDeps {
  /** The tab is visible (default: !document.hidden). */
  visible?: () => boolean;
  /** The DOM column (default: ui/credits.ts mountCreditsView; null = none, e.g. Node). */
  view?: (h: CreditsViewHandlers) => CreditsView | null;
  /** Wall clock (ms) for the double-press guard (default: performance.now). */
  now?: () => number;
}

const runtimes = new WeakMap<object, ReactorCredits>();
/** The runtime installed into a host (QA / tests). */
export const reactorCreditsOf = (host: object): ReactorCredits | undefined => runtimes.get(host);

/** Poll period of the persisted ending record when no live ENDING runtime is installed on this host (s). */
const POLL_S = 0.25;
/** One press = one activation: presses closer than this (ms) are the same press (a focused button's Enter + the key read). */
const PRESS_GUARD_MS = 350;
const ENTER_KEYS = ['Enter', 'NumpadEnter'];

const defaultVisible = (): boolean => typeof document === 'undefined' || !(document as {hidden?: boolean}).hidden;
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ReactorCredits {
  info: ReactorInfo | null = null;
  surface: ReactorSurface | null = null;
  /** The live record (stored on start / end / Main Menu / teardown). */
  state: CreditsState = emptyCreditsState();
  view: CreditsView | null = null;
  /** The last gate (QA / tests). */
  gate: CreditsGate = {playing: false, visible: false, surfaced: false, onSurface: false, messageClear: true};
  /** A failed ending save: the error shown; the next press leaves without saving. */
  armed = false;
  error: string | null = null;
  /** The end card was reached in THIS world (a rebuilt world with a finished record shows nothing). */
  private cardLive = false;
  private pollT = 0;
  private polledSurfaced = false;
  private lastPress = -Infinity;
  /** Frames run since the last state change (the frame hook runs only in play). */
  private playFrames = 0;
  private readonly visible: () => boolean;
  private readonly makeView: (h: CreditsViewHandlers) => CreditsView | null;
  private readonly now: () => number;
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, started: 0, ended: 0, presses: 0, saves: 0, saveFailures: 0, left: 0, leftUnsaved: 0, stores: 0};

  constructor(readonly host: CreditsHost, deps: CreditsDeps = {}) {
    this.visible = deps.visible ?? defaultVisible;
    this.makeView = deps.view ?? mountCreditsView;
    this.now = deps.now ?? defaultNow;
  }

  install(): this {
    const h = this.host;
    runtimes.set(h, this);
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(dt => this.frame(dt));
    h.stateListeners?.push(((s: string) => this.onState(s)) as (state: never, prev: never) => void);
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // World lifecycle

  build(layout: StationLayout): void {
    if (this.info) this.teardown();
    const info = layout.reactor, s = info?.surface;
    if (!info || !s) return;
    this.info = info;
    this.surface = s;
    this.counts.builds++;
    let raw: unknown;
    try { raw = this.host.run.laneStore(CREDITS_LANE); } catch { raw = undefined; }
    this.state = loadCreditsState(raw);
    this.cardLive = false;
    this.armed = false;
    this.error = null;
    this.pollT = 0;
    this.polledSurfaced = this.readSurfacedRecord();
    // a started scroll resumes where it was; a finished one never shows again (no repeated credits)
    if (creditsPhase(this.state) === 'scrolling') this.mount();
  }

  teardown(): void {
    if (!this.info) return;
    this.store();
    this.unmount();
    this.info = null;
    this.surface = null;
    this.cardLive = false;
    this.armed = false;
    this.error = null;
  }

  /** Store the record (a fresh plain object in this station's lane store). */
  store(): void {
    if (!this.info) return;
    try {
      this.host.run.setLaneStore(CREDITS_LANE, creditsRecord(this.state));
      this.counts.stores++;
    } catch (err) { console.warn('reactor credits: storing the record failed', err); }
  }

  // -------------------------------------------------------------------------------------------
  // Per frame (play time)

  frame(dt: number): void {
    if (!this.info || !this.surface) return;
    this.playFrames++;
    if (this.state.done) {
      // Enter = the end card's button (pointer locked: the mouse needs Esc first; the hint says so). Only from the SECOND frame of
      // play on: an Enter that resumed play (a focused pause-screen button) was pressed before this play began.
      if (this.cardLive && this.host.state === 'playing' && this.playFrames > 1) {
        const p = this.host.input?.pressed;
        if (p && ENTER_KEYS.some(k => p.has(k))) this.press();
      }
      return; // (finished: nothing to count)
    }
    const g = this.readGate(dt);
    this.gate = g;
    this.applyEvents(stepCredits(this.state, dt, g));
    if (this.view && !this.cardLive) this.view.setProgress(scrollProgress(this.state));
  }

  /** This frame's gate (the clocks' conditions). */
  private readGate(dt: number): CreditsGate {
    const h = this.host, s = this.surface!;
    const playing = h.state === 'playing';
    let visible = true;
    try { visible = this.visible(); } catch { visible = true; }
    const ending = reactorEndingOf(h as object);
    let surfaced: boolean;
    if (ending?.surface) surfaced = ending.ending.surfaced;
    else {
      this.pollT -= Number.isFinite(dt) ? dt : 0;
      if (this.pollT <= 0) { this.pollT = POLL_S; this.polledSurfaced = this.readSurfacedRecord(); }
      surfaced = this.polledSurfaced;
    }
    const msg = ending?.messagePhase ?? 'none';
    const P = h.player;
    let onSurface = false;
    if (P.alive) {
      let lv = -1;
      try { lv = h.levels.levelAt(P.x, P.z, P.y); } catch { lv = -1; }
      onSurface = lv === s.level && P.y > s.y - 0.5; // (ending.ts: the surface storey)
    }
    return {playing, visible, surfaced, onSurface, messageClear: msg !== 'centre' && msg !== 'moving'};
  }

  /** The persisted ending record's `surfaced` (the record path: no live ENDING runtime on this host). */
  private readSurfacedRecord(): boolean {
    const info = this.info;
    if (!info) return false;
    try { return loadReactorState(this.host.run.laneStore(REACTOR_LANE), info.generators.length, info.zones.length).ending.surfaced; } catch { return false; }
  }

  private applyEvents(ev: readonly string[]): void {
    for (const e of ev) {
      if (e === 'started') { this.counts.started++; this.store(); this.mount(); }
      else if (e === 'done') { this.counts.ended++; this.store(); this.showEnd(); }
    }
  }

  // -------------------------------------------------------------------------------------------
  // The column (ui/credits.ts; Node: state only)

  private mount(): void {
    if (this.view) return;
    try { this.view = this.makeView({onMainMenu: () => this.press()}); } catch (err) { console.warn('reactor credits: the column could not be shown', err); this.view = null; }
    this.view?.setProgress(scrollProgress(this.state));
    this.view?.setMode(this.modeFor(this.host.state));
  }

  private unmount(): void {
    try { this.view?.dispose(); } catch { /* the page went away */ }
    this.view = null;
  }

  private showEnd(): void {
    this.cardLive = true;
    if (!this.view) this.mount();
    this.view?.showEnd();
    this.view?.setError(this.error);
  }

  private modeFor(state: string): CreditsMode {
    return state === 'playing' ? 'play' : state === 'paused' ? 'paused' : 'hidden';
  }

  private onState(s: string): void {
    this.playFrames = 0;
    this.view?.setMode(this.modeFor(s));
  }

  /** The end card is up (reached in this world, waiting for its button). */
  get cardShown(): boolean {
    return this.cardLive;
  }

  // -------------------------------------------------------------------------------------------
  // "Main Menu"

  /**
   * The end card's button (click / tap / Enter): store the record, SAVE the run (reason 'ending'), then the campaign return to the main
   * menu. A failed save shows its error and arms the card: the next press leaves WITHOUT saving. Only on the end card in play / pause.
   */
  press(): void {
    if (!this.cardLive || !this.info) return;
    if (this.host.state !== 'playing' && this.host.state !== 'paused') return;
    const t = this.now();
    if (t - this.lastPress < PRESS_GUARD_MS) return;
    this.lastPress = t;
    this.counts.presses++;
    this.store();
    if (this.armed) { this.counts.leftUnsaved++; this.leave(); return; }
    let r: EndingSaveResult;
    try { r = this.host.commitEndingSave ? this.host.commitEndingSave() : null; } catch (err) { r = {ok: false, error: `Not saved: ${String((err as Error)?.message ?? err)}`}; }
    if (r === null || r.ok) {
      if (r?.ok) this.counts.saves++;
      this.leave();
      return;
    }
    this.counts.saveFailures++;
    this.armed = true;
    this.error = `${r.error} ${END_CARD.confirm}`;
    this.view?.setError(this.error);
  }

  private leave(): void {
    this.counts.left++;
    this.armed = false;
    this.error = null;
    this.view?.setError(null);
    this.host.returnToMenu?.();
  }

  // -------------------------------------------------------------------------------------------
  // QA (__LL.reactorCredits(cmd))

  /**
   * The report; QA-only commands (?qa=1): `skip` s = that many counted seconds now (the pending count, then the scroll); `start` = the
   * count completes now; `end` = the end card now; `press` = the end card's button; `reset` = a fresh record (QA re-runs).
   */
  qa(cmd: {skip?: number; start?: boolean; end?: boolean; press?: boolean; reset?: boolean} = {}): object {
    if (this.info) {
      if (cmd.reset) { this.unmount(); this.state = emptyCreditsState(); this.cardLive = false; this.armed = false; this.error = null; this.store(); }
      if (typeof cmd.skip === 'number' && cmd.skip > 0 && !this.state.done) this.applyEvents(advanceCredits(this.state, cmd.skip));
      if (cmd.start && !this.state.started) this.applyEvents(advanceCredits(this.state, CREDITS.triggerS - this.state.t + 1e-6));
      if (cmd.end && !this.state.done) this.applyEvents(advanceCredits(this.state, CREDITS.triggerS - this.state.t + CREDITS.scrollS + 1));
      if (cmd.press) this.press();
    }
    return {
      installed: true, active: !!this.info, record: creditsRecord(this.state), phase: creditsPhase(this.state), progress: scrollProgress(this.state),
      cardShown: this.cardLive, view: this.view ? {visible: this.view.visible, atEnd: this.view.atEnd} : null, armed: this.armed, error: this.error,
      gate: {...this.gate}, counts: {...this.counts},
      timing: {triggerS: CREDITS.triggerS, scrollS: CREDITS.scrollS},
    };
  }
}

/** Installs the credits runtime into a Game (one call in the Game constructor, after ENDING). */
export function installReactorCredits(host: CreditsHost, deps: CreditsDeps = {}): ReactorCredits {
  return new ReactorCredits(host, deps).install();
}
