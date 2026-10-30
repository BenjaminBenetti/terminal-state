// Task gas-mask-roof-feedback-20261030 (item 1): the player coughs while toxic gas is hurting them — audible feedback on top of
// the HUD tag / vignette. It reads the gas system's ONE per-frame exposure (world/gas/system.ts: whatever the source — a breached
// window's field or the toxic roof — combined into a single dps), so several sources or per-frame damage updates never stack
// coughs: there is one cough voice at most, a short first delay when the damage starts, then a randomised gap between coughs and
// a minimum rest after each. No cough while a working mask protects, in clean air, or outside play (frame hooks only run while
// playing; leaving play / dying silences a sounding cough). Clip choice: the bank never repeats the previous take.

/** Cough pacing (s). */
export const COUGH = {
  /** Delay before the first cough once unprotected damage starts. */
  first: [0.15, 0.4] as const,
  /** Gap after a cough ends before the next one (uniform). */
  gap: [2.4, 4.2] as const,
  /** Minimum rest after a cough before another may start, even when exposure stops and starts again. */
  rest: 1.2,
} as const;

export interface CoughSfx {
  /** Play one cough; returns its length (s), 0 when nothing played. */
  cough(): number;
  stopCough(): void;
}

export class CoughFeedback {
  /** Coughs started (QA / tests). */
  coughs = 0;
  private t = 0;
  /** Countdown to the next cough while hurting; null while not hurting. */
  private wait: number | null = null;
  /** Earliest time (this clock) another cough may start. */
  private nextAllowed = 0;

  constructor(private readonly sfx: CoughSfx, private readonly rand: () => number = Math.random) {}

  /** One play frame: `hurting` = toxic gas is damaging the unprotected player this frame. */
  update(dt: number, hurting: boolean): void {
    this.t += Math.max(0, dt);
    if (!hurting) { this.wait = null; return; }
    if (this.wait === null) this.wait = this.between(COUGH.first);
    this.wait -= Math.max(0, dt);
    if (this.wait > 0 || this.t < this.nextAllowed) return;
    const dur = this.sfx.cough();
    this.coughs++;
    this.nextAllowed = this.t + dur + COUGH.rest;
    this.wait = dur + this.between(COUGH.gap);
  }

  /** Lifecycle (left play, death, new section): silence a sounding cough and start over. */
  reset(): void {
    this.wait = null;
    this.nextAllowed = 0;
    this.sfx.stopCough();
  }

  private between([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.rand();
  }
}

interface CoughHost {
  readonly state: string;
  readonly player: {readonly alive: boolean};
  readonly gas: {readonly exposure: {readonly dps: number; readonly protected: boolean}};
  readonly sfx: CoughSfx;
  readonly frameHooks: ((dt: number) => void)[];
  readonly stateListeners: ((state: never, prev: never) => void)[];
}

/** Wire the cough to the game: a frame hook after the gas system's (install order) and a state listener for cleanup. */
export function installCough(game: CoughHost): CoughFeedback {
  const c = new CoughFeedback(game.sfx);
  game.frameHooks.push(dt => c.update(dt, game.state === 'playing' && game.player.alive && game.gas.exposure.dps > 0 && !game.gas.exposure.protected));
  (game.stateListeners as ((s: string) => void)[]).push(s => { if (s !== 'playing') c.reset(); });
  return c;
}
