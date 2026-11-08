// Hunger and thirst, shown on the HUD as FOOD and WATER fullness (0-100, higher = better).
// Pure logic, no DOM/three.js. Both start at 80 on spawn, new station and restart. It only ticks from
// Game.update(), which runs only in the 'playing' state: pause, inventory, menus, map, death and the
// win screen freeze it (no catch-up of time spent away).
//
// Task studio-alpha-survival-controls-20261107-060450-01 (user: hunger / thirst "8x" faster, about 20 active minutes from full to
// empty): the drain is 8x the former rates (food 1 point / 110 s -> / 13.75 s: 22.9 min full -> 0; water 1 / 75 s -> / 9.375 s:
// 15.6 min; from the 80 at spawn 18.3 / 12.5 min — water still runs out first, as before). At 0 (EITHER stat) the player loses
// EMPTY_MAX_HP_PER_MIN of MAX health per active minute, smoothly — one shared rate, not per stat — and the existing pain grunt plays
// on becoming empty and then at most once a minute while empty (`pain` in the tick; never while frozen).

export const SURVIVAL_START = 80;
/** The normal cap: ordinary food / drink fill up to this (never above; never truncating an existing overfill either). */
export const SURVIVAL_MAX = 100;
/**
 * Task studio-market-bar-20261108-225231-01 (lane BEER): the OVERFILL ceiling of food AND water (never health / stamina / filters). Second
 * Supper Bock SETS both to this (Survival.overfill); the overfill drains at the normal rate (no expiry) and saves / loads as it is.
 */
export const SURVIVAL_OVERFILL = 200;
/** The drain multiplier on the former rates (task studio-alpha-survival-controls-20261107-060450-01). */
export const SURVIVAL_RATE = 8;
/** Food points lost per second of play (8 x 1 point every 110 s: 100 -> 0 in 22.9 min). */
export const HUNGER_DRAIN = SURVIVAL_RATE / 110;
/** Water points lost per second of play (8 x 1 point every 75 s: 100 -> 0 in 15.6 min). */
export const THIRST_DRAIN = SURVIVAL_RATE / 75;
/** Fraction of MAX health lost per active minute while food OR water is at 0 (one shared rate: both empty is not double). */
export const EMPTY_MAX_HP_PER_MIN = 0.05;
/** Seconds of active play between pain grunts while empty (the first plays on becoming empty). */
export const EMPTY_PAIN_EVERY_S = 60;
export const LOW = 25;
export const CRITICAL = 10;

export interface SurvivalWarning { text: string; warn: boolean }
export interface SurvivalTick {
  hpLoss: number;
  warnings: SurvivalWarning[];
  /** Play the pain cue now (on becoming empty, then once per EMPTY_PAIN_EVERY_S of active play while empty). */
  pain: boolean;
}
export interface Consumable { hunger?: number; thirst?: number; heal?: number; verb?: string }

type Stat = 'hunger' | 'thirst';
const WARN_TEXT: Record<Stat, [string, string, string]> = {
  hunger: ['Getting hungry — eat something soon', 'Very hungry — find food', 'Starving — losing health'],
  thirst: ['Getting thirsty — drink something soon', 'Very thirsty — find water', 'Dehydrated — losing health'],
};

/** Survival only advances in live play: pause, inventory, menus, death and win screens freeze it. */
export function survivalTicks(state: string): boolean {
  return state === 'playing';
}

/** (lane BEER) 0..SURVIVAL_OVERFILL: a stat above 100 is the Bock's overfill (only Survival.overfill puts it there). */
const clamp = (v: number) => Math.max(0, Math.min(SURVIVAL_OVERFILL, v));
/**
 * (lane BEER) An ordinary food / drink delta: a gain fills to SURVIVAL_MAX at most but never truncates an existing overfill (at 180 water
 * stays 180); a loss (salty chips' −4 water) applies as ever, from wherever the stat is.
 */
const gain = (cur: number, d: number) => (d > 0 ? Math.max(cur, Math.min(SURVIVAL_MAX, cur + d)) : clamp(cur + d));

export class Survival {
  hunger = SURVIVAL_START;
  thirst = SURVIVAL_START;
  /** Seconds of play simulated (debug/QA). */
  time = 0;
  /** Highest warning level announced per stat (0 none, 1 low, 2 critical, 3 empty). */
  private level: Record<Stat, number> = {hunger: 0, thirst: 0};
  /** Active seconds since the last pain grunt while empty; null = not empty (the next empty frame grunts at once). */
  private painT: number | null = null;

  reset(): void {
    this.hunger = SURVIVAL_START;
    this.thirst = SURVIVAL_START;
    this.time = 0;
    this.level = {hunger: 0, thirst: 0};
    this.painT = null;
  }

  /** Whether food or water is at 0. */
  get empty(): boolean { return this.hunger <= 0 || this.thirst <= 0; }

  /**
   * Advance by dt seconds of PLAY time. Returns health to remove (EMPTY_MAX_HP_PER_MIN of `maxHp` per active minute while either stat
   * was empty through the step), any threshold warnings and whether to play the pain cue.
   */
  update(dt: number, maxHp = 100): SurvivalTick {
    if (!(dt > 0)) return {hpLoss: 0, warnings: [], pain: false};
    this.time += dt;
    const emptyBefore = this.empty;
    this.hunger = clamp(this.hunger - HUNGER_DRAIN * dt);
    this.thirst = clamp(this.thirst - THIRST_DRAIN * dt);
    const emptyAfter = this.empty;
    const hpLoss = emptyBefore && emptyAfter ? maxHp * EMPTY_MAX_HP_PER_MIN / 60 * dt : 0;
    let pain = false;
    if (!emptyAfter) this.painT = null;
    else if (this.painT === null) { this.painT = 0; pain = true; } // just became empty: one grunt now
    else if ((this.painT += dt) >= EMPTY_PAIN_EVERY_S) { this.painT = 0; pain = true; } // then once a minute (never a burst after a long step)
    const warnings: SurvivalWarning[] = [];
    for (const s of ['hunger', 'thirst'] as Stat[]) {
      const v = this[s];
      const lvl = v <= 0 ? 3 : v <= CRITICAL ? 2 : v <= LOW ? 1 : 0;
      if (lvl > this.level[s]) warnings.push({text: WARN_TEXT[s][lvl - 1], warn: lvl >= 2});
      // Hysteresis: re-arm a warning once the stat has recovered a little above its threshold.
      const rearm = this.level[s] === 3 ? 3 : this.level[s] === 2 ? CRITICAL + 5 : LOW + 5;
      if (lvl > this.level[s]) this.level[s] = lvl;
      else if (lvl < this.level[s] && v > rearm) this.level[s] = lvl;
    }
    return {hpLoss, warnings, pain};
  }

  /** Applies an item's food/water effect (capped at 100; an existing overfill is never truncated). Returns the deltas actually applied. */
  consume(item: Consumable): {hunger: number; thirst: number} {
    const h0 = this.hunger, t0 = this.thirst;
    this.hunger = gain(this.hunger, item.hunger ?? 0);
    this.thirst = gain(this.thirst, item.thirst ?? 0);
    return {hunger: this.hunger - h0, thirst: this.thirst - t0};
  }

  /**
   * Task studio-market-bar-20261108-225231-01 (lane BEER): Second Supper Bock — SETS food AND water to `level` (the 200 % overfill; not
   * +200, never above SURVIVAL_OVERFILL). Returns the deltas applied.
   */
  overfill(level = SURVIVAL_OVERFILL): {hunger: number; thirst: number} {
    const h0 = this.hunger, t0 = this.thirst, v = clamp(level);
    this.hunger = v;
    this.thirst = v;
    return {hunger: this.hunger - h0, thirst: this.thirst - t0};
  }

  /** Why an item cannot be used right now (null = OK). Medical items need missing health. */
  blockReason(item: Consumable, hp: number, maxHp: number): string | null {
    if (item.verb === 'eat') return (item.hunger ?? 0) > 0 && this.hunger >= SURVIVAL_MAX - 0.5 ? "You're not hungry" : null;
    if (item.verb === 'drink') return (item.thirst ?? 0) > 0 && this.thirst >= SURVIVAL_MAX - 0.5 ? "You're not thirsty" : null;
    if ((item.heal ?? 0) > 0 && hp >= maxHp) return 'Already at full health';
    return null;
  }

  /** "+35 water", "+14 food · −4 water" for the deltas returned by consume(). */
  static describe(d: {hunger: number; thirst: number}): string {
    const part = (n: number, label: string) => {
      const r = Math.round(n);
      return r === 0 ? '' : `${r > 0 ? '+' : '−'}${Math.abs(r)} ${label}`;
    };
    return [part(d.hunger, 'food'), part(d.thirst, 'water')].filter(Boolean).join(' · ') || 'no effect (already full)';
  }
}
