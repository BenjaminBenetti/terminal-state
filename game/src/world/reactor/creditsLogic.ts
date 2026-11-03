// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): THE END CREDITS' rules as pure data (no three.js /
// DOM; the tests step them). User: "After about 30 seconds on the surface, credits should start playing in the top right side of the
// screen. [...] scroll them slow, at the very end it should say "Thank you for playing" with a button that says "Main Menu"".
//  - THE TRIGGER: CREDITS.triggerS (30) seconds of ACTIVE play on the surface storey — the Reactor's ending record says surfaced, the
//    player stands on the surface storey, the game is 'playing', the tab is visible and the ending's centre "External doors open" message
//    is not on screen. Anything else holds the count (stepping off the surface pauses it, never resets it; pause / a hidden tab / menus
//    never count). Frame dt is capped (CREDITS.maxDtS): no real-world time accumulates.
//  - THE SCROLL: CREDITS.scrollS (120) seconds; once started its clock runs while the game is 'playing' with the tab visible anywhere at
//    the Reactor station (the surface or below), never while paused / hidden / in a menu.
//  - THE END CARD: "Thank you for playing" + "Main Menu" stays until it is used (no automatic return, no reset).
//  - PERSISTENCE: the station's own lane store CREDITS_LANE ({v: 1, t, started, scroll, done}; JSON-safe; absent / malformed = defaults).

/** The credits' lane store (per station: run.laneStore scopes it to the current station). Never inside 'reactor.state'. */
export const CREDITS_LANE = 'reactor.credits';

/** Every credits tunable (s, px). */
export const CREDITS = {
  /** Active play seconds on the surface before the credits start. */
  triggerS: 30,
  /** The scroll's length (play seconds): the first line enters at the column's foot, the end card settles at its top. */
  scrollS: 120,
  /** A frame's dt is capped at this (a hitch / a returning tab never adds real-world time). */
  maxDtS: 0.1,
  /**
   * Column geometry (ui/credits.ts): the window's height (px; smaller on short screens), one entry's pitch, the end card's rest inset
   * below the window's top (= the top fade, so the resting card is never faded).
   */
  windowPx: 340,
  pitchPx: 96,
  restPx: 40,
} as const;

export interface CreditLine { role: string; name: string }

/** The heading above the credit lines. */
export const CREDITS_TITLE = 'Terminal State';

/** The credit lines, top to bottom (exact strings: the user's; "BenettI" is the user's own spelling). */
export const CREDIT_LINES: readonly CreditLine[] = [
  {role: 'Creative Director', name: 'Benjamin BenettI'},
  {role: 'Programming', name: 'Claude Opus 5.5'},
  {role: 'Sound', name: 'Stable Audio 3 Small-SFX'},
  {role: 'Art', name: 'Meshy T2.5'},
  {role: 'Product Manager', name: 'Astra 6'},
  // a few light ones (the user: "throw in a few funny ones (maybe like zombie 1, "beth" ...)")
  {role: 'Zombie #1', name: 'Beth'},
  {role: 'Unpaid Mall Security', name: 'Dave'},
  {role: 'Train Punctuality', name: 'Surprisingly Good'},
  {role: 'Gas Mask Fitting', name: 'One Size Fits Most'},
  {role: 'Occupational Safety', name: 'Position Vacant'},
  {role: 'Catering', name: 'Canned Beans'},
];

/** The end card (stays until its button is used). */
export const END_CARD = {
  thanks: 'Thank you for playing',
  button: 'Main Menu',
  hint: 'Press Enter — or Esc, then click',
  /** After a failed save: the second press leaves without saving. */
  confirm: 'Press Main Menu again to leave without saving.',
} as const;

/** Scroll entries before the end card (the heading + the lines): one pitch each. */
export const CREDITS_ENTRIES = 1 + CREDIT_LINES.length;

/** The scroll's travel (px) in the standard window and its speed (px/s): the end card rises from below the window to its rest inset. */
export const CREDITS_TRAVEL_PX = CREDITS.windowPx + CREDITS_ENTRIES * CREDITS.pitchPx - CREDITS.restPx;
export const CREDITS_SPEED_PX_S = CREDITS_TRAVEL_PX / CREDITS.scrollS;

/** The persisted record (lane store CREDITS_LANE). */
export interface CreditsState {
  v: 1;
  /** Active surface seconds counted before the start (0..CREDITS.triggerS). */
  t: number;
  started: boolean;
  /** Seconds into the scroll (0..CREDITS.scrollS). */
  scroll: number;
  /** The scroll reached the end card (never shown again at this station). */
  done: boolean;
}

export const emptyCreditsState = (): CreditsState => ({v: 1, t: 0, started: false, scroll: 0, done: false});

const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** A stored record (any shape: missing / old / foreign / malformed) as a valid state; consistent: done => started => t at the trigger. */
export function loadCreditsState(raw: unknown): CreditsState {
  const s = emptyCreditsState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as {v?: unknown}).v !== 1) return s;
  const r = raw as Partial<Record<keyof CreditsState, unknown>>;
  s.done = r.done === true;
  s.started = r.started === true || s.done;
  s.t = s.started ? CREDITS.triggerS : clamp(fin(r.t), 0, CREDITS.triggerS);
  s.scroll = s.done ? CREDITS.scrollS : s.started ? clamp(fin(r.scroll), 0, CREDITS.scrollS) : 0;
  return s;
}

/** The record to store (a fresh plain object: JSON-safe, never aliased with the live state). */
export function creditsRecord(s: Readonly<CreditsState>): CreditsState {
  return loadCreditsState({v: 1, t: s.t, started: s.started, scroll: s.scroll, done: s.done});
}

/** What gates the clocks this frame. */
export interface CreditsGate {
  /** The game state is 'playing'. */
  playing: boolean;
  /** The tab is visible. */
  visible: boolean;
  /** The Reactor's ending record says the surface was reached. */
  surfaced: boolean;
  /** The player stands on the surface storey now. */
  onSurface: boolean;
  /** The ending's centre "External doors open" message is not on screen (never overlap it). */
  messageClear: boolean;
}

export type CreditsEvent = 'started' | 'done';
export type CreditsPhase = 'pending' | 'scrolling' | 'end';

export const creditsPhase = (s: Readonly<CreditsState>): CreditsPhase => (s.done ? 'end' : s.started ? 'scrolling' : 'pending');

/** The pending count advances now. */
export const countsTowardStart = (g: Readonly<CreditsGate>): boolean => g.playing && g.visible && g.surfaced && g.onSurface && g.messageClear;
/** The started scroll advances now (anywhere at the Reactor station). */
export const scrollRuns = (g: Readonly<CreditsGate>): boolean => g.playing && g.visible;

/** A frame's dt as counted time (finite, >= 0, capped). */
export const frameDt = (dt: number): number => (Number.isFinite(dt) && dt > 0 ? Math.min(dt, CREDITS.maxDtS) : 0);

/**
 * Advance `s` IN PLACE by `sec` counted seconds (already gated): the pending count first (the start at CREDITS.triggerS; the rest of
 * the seconds go on into the scroll), then the scroll (the end at CREDITS.scrollS). Returns the events crossed, in order.
 */
export function advanceCredits(s: CreditsState, sec: number, o: {scrollOnly?: boolean} = {}): CreditsEvent[] {
  const ev: CreditsEvent[] = [];
  let left = Number.isFinite(sec) && sec > 0 ? sec : 0;
  if (s.done || left <= 0) return ev;
  if (!s.started) {
    if (o.scrollOnly) return ev;
    const need = CREDITS.triggerS - s.t;
    if (left < need) { s.t += left; return ev; }
    s.t = CREDITS.triggerS;
    s.started = true;
    s.scroll = 0;
    left -= need;
    ev.push('started');
  }
  s.scroll = Math.min(CREDITS.scrollS, s.scroll + left);
  if (s.scroll >= CREDITS.scrollS) { s.done = true; ev.push('done'); }
  return ev;
}

/** One frame of the credits clock (IN PLACE): the pending count under its gate, the scroll under its own. */
export function stepCredits(s: CreditsState, dt: number, g: Readonly<CreditsGate>): CreditsEvent[] {
  const d = frameDt(dt);
  if (s.done || d <= 0) return [];
  if (!s.started) return countsTowardStart(g) ? advanceCredits(s, d) : [];
  return scrollRuns(g) ? advanceCredits(s, d, {scrollOnly: true}) : [];
}

/** The scroll's progress 0..1 (0: the heading at the window's foot; 1: the end card at rest at its top). */
export const scrollProgress = (s: Readonly<CreditsState>): number => (s.done ? 1 : s.started ? clamp(s.scroll / CREDITS.scrollS, 0, 1) : 0);

/** The strip's offset (px, down from the window's top) at progress `k` in a window `windowPx` tall (ui/credits.ts mirrors it in CSS). */
export const stripOffsetPx = (k: number, windowPx: number = CREDITS.windowPx): number =>
  windowPx - clamp(k, 0, 1) * (windowPx + CREDITS_ENTRIES * CREDITS.pitchPx - CREDITS.restPx);
