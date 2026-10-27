// Hunger and thirst, shown on the HUD as FOOD and WATER fullness (0-100, higher = better).
// Pure logic, no DOM/three.js. Both start at 80 on spawn, new station and restart. The drain is
// deliberately slow and long-term: about 8 food and 12 water over a 15-minute session, so a short
// slice never forces eating but each item visibly moves its bar. It only ticks from
// Game.update(), which runs only in the 'playing' state: pause, inventory, menus, death and the
// win screen freeze it. At 0 the player slowly loses health (per depleted stat).

export const SURVIVAL_START = 80;
export const SURVIVAL_MAX = 100;
/** Food points lost per second of play (1 point every 110 s). */
export const HUNGER_DRAIN = 1 / 110;
/** Water points lost per second of play (1 point every 75 s). */
export const THIRST_DRAIN = 1 / 75;
/** Health lost per second for EACH stat at 0 (1 HP every 6 s; both empty = 1 HP every 3 s). */
export const EMPTY_HP_DRAIN = 1 / 6;
export const LOW = 25;
export const CRITICAL = 10;

export interface SurvivalWarning { text: string; warn: boolean }
export interface SurvivalTick { hpLoss: number; warnings: SurvivalWarning[] }
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

const clamp = (v: number) => Math.max(0, Math.min(SURVIVAL_MAX, v));

export class Survival {
  hunger = SURVIVAL_START;
  thirst = SURVIVAL_START;
  /** Seconds of play simulated (debug/QA). */
  time = 0;
  /** Highest warning level announced per stat (0 none, 1 low, 2 critical, 3 empty). */
  private level: Record<Stat, number> = {hunger: 0, thirst: 0};

  reset(): void {
    this.hunger = SURVIVAL_START;
    this.thirst = SURVIVAL_START;
    this.time = 0;
    this.level = {hunger: 0, thirst: 0};
  }

  /** Advance by dt seconds of PLAY time. Returns health to remove and any threshold warnings. */
  update(dt: number): SurvivalTick {
    if (!(dt > 0)) return {hpLoss: 0, warnings: []};
    this.time += dt;
    const emptyBefore = (this.hunger <= 0 ? 1 : 0) + (this.thirst <= 0 ? 1 : 0);
    this.hunger = clamp(this.hunger - HUNGER_DRAIN * dt);
    this.thirst = clamp(this.thirst - THIRST_DRAIN * dt);
    const emptyAfter = (this.hunger <= 0 ? 1 : 0) + (this.thirst <= 0 ? 1 : 0);
    const hpLoss = Math.min(emptyBefore, emptyAfter) * EMPTY_HP_DRAIN * dt;
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
    return {hpLoss, warnings};
  }

  /** Applies an item's food/water effect (clamped). Returns the deltas actually applied. */
  consume(item: Consumable): {hunger: number; thirst: number} {
    const h0 = this.hunger, t0 = this.thirst;
    this.hunger = clamp(this.hunger + (item.hunger ?? 0));
    this.thirst = clamp(this.thirst + (item.thirst ?? 0));
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
