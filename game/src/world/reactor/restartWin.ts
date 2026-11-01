// Task reactor-build-20261101 (lane RESTART): THE WIN as a pure, deterministic timeline (no three.js / DOM; tests step it).
// Diegetic, bounded, no cutscene and no forced end — the run goes on:
//  t = 0          the rods are withdrawn: the startup cue; the core starts to glow (setCoreGlow ramps 0 -> 1 over WIN.coreS);
//  t = airAtS     the local gas clears: lane AIR's reactorClearAll (its own whole-pit duration REACTOR_AIR.CLEAR_ALL_S), called ONCE;
//  t = tierStartS industrial lighting and the extraction fans SEQUENCE UP THROUGH THE PIT, tier by tier from the core floor to the
//                 rim (setTierPower(level, k) in bottom-up order, each tier's fans with it), ~WIN.tierSpanS in all; the light field's
//                 powered circuit follows the mean tier power;
//  t = toastAtS   "REACTOR RESTARTED — surface ventilation towers receiving power";
//  t = towerStartS the PRE-EXISTING surface ventilation towers receive power one by one (control monitor / rim pit board):
//                 "VENT TOWER 4 — CENTRAL · POWER RECEIVED — FANS SPINNING UP", then ONLINE; when all are online a last toast.
// Canon: the gas that turns people into the infected is being pulled out of the surface air, slowly — NOT a cure: nothing despawns,
// nothing is revived, the zombies stay. Rebuilding a restarted world jumps straight to the end state (no replay).

import type {ReactorFan, ReactorTier} from '../../gen/reactor/reactorTypes';
import {REACTOR_AIR} from './air';

export const WIN = {
  /** Core glow ramp (s). */
  coreS: 6,
  /** Local gas clearing: when lane AIR's clearAll is called and its duration (s: AIR's own, so a rebuilt world resumes it alike). */
  airAtS: 5,
  airDurationS: REACTOR_AIR.CLEAR_ALL_S,
  /** The tier sequence: first tier starts at tierStartS, the last one is fully on at tierStartS + tierSpanS; each ramps over tierRampS. */
  tierStartS: 6,
  tierSpanS: 20,
  tierRampS: 1.6,
  /** HUD toasts. */
  toastAtS: 6,
  /** Surface vent towers: first one powered at towerStartS, one every towerStepS; "spinning up" for towerSpinS, then online. */
  towerStartS: 8,
  towerStepS: 3,
  towerSpinS: 3.5,
} as const;

/** The pre-existing surface ventilation towers across the city (fixed canon names; the monitors list them in power-up order). */
export const VENT_TOWERS: readonly {id: number; name: string}[] = [
  {id: 1, name: 'NORTH YARDS'}, {id: 2, name: 'OLD MARKET'}, {id: 3, name: 'RIVERSIDE'},
  {id: 4, name: 'CENTRAL'}, {id: 5, name: 'EAST LINE'}, {id: 6, name: 'HARBOUR'},
];

export type TowerState = 'standby' | 'power' | 'online';

export const WIN_TEXT = {
  restarted: 'REACTOR RESTARTED — surface ventilation towers receiving power',
  allOnline: `All ${VENT_TOWERS.length} surface ventilation towers running — the poison will be pulled out of the air, slowly`,
  /** Monitor / board status lines (canon: slow extraction, not a cure). */
  status: 'EXTRACTION RUNNING · SURFACE CONTAMINANT FALLING — SLOWLY',
  canon: 'The air up there will clear in time. Those already turned will not.',
} as const;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

/** The win plan of a layout: tiers bottom-up (core floor first) and each fan's rank in that order. */
export interface WinPlan {
  /** layout.levels indices, deepest first (the core floor) … the rim last. */
  tiers: readonly number[];
  /** ReactorFan.id -> rank of its tier in `tiers` (fans of a level that is no tier: the nearest tier by height). */
  fanRank: ReadonlyMap<number, number>;
  fans: readonly number[];
}

export function planWin(tiers: readonly Pick<ReactorTier, 'level' | 'baseY'>[], fans: readonly Pick<ReactorFan, 'id' | 'level' | 'y'>[]): WinPlan {
  const order = [...tiers].sort((a, b) => a.baseY - b.baseY || b.level - a.level);
  const rankOfLevel = new Map(order.map((t, i) => [t.level, i]));
  const fanRank = new Map<number, number>();
  for (const f of fans) {
    let r = rankOfLevel.get(f.level);
    if (r === undefined) { // a fan on a level that is no listed tier: the deepest tier at or below its hub
      r = 0;
      for (let i = 0; i < order.length; i++) if (order[i].baseY <= f.y + 0.01) r = i;
    }
    fanRank.set(f.id, r);
  }
  return {tiers: order.map(t => t.level), fanRank, fans: fans.map(f => f.id)};
}

/** Core glow 0..1 at win time t (s). */
export const coreGlowAt = (t: number): number => smooth(t / WIN.coreS);

/** Start time (s) of the tier with bottom-up rank `rank` of `n`. */
export function tierStartAt(rank: number, n: number): number {
  return WIN.tierStartS + (n > 1 ? rank * (WIN.tierSpanS - WIN.tierRampS) / (n - 1) : 0);
}

/** Power 0..1 of the tier with bottom-up rank `rank` of `n` at win time t. */
export const tierPowerAt = (t: number, rank: number, n: number): number => smooth((t - tierStartAt(rank, n)) / WIN.tierRampS);

/** The powered light circuit (light field / tubes): the mean tier power. */
export function circuitAt(t: number, n: number): number {
  if (n <= 0) return coreGlowAt(t);
  let s = 0;
  for (let i = 0; i < n; i++) s += tierPowerAt(t, i, n);
  return s / n;
}

/** Surface vent tower i (0-based, power-up order) at win time t. */
export function towerStateAt(t: number, i: number): TowerState {
  const on = WIN.towerStartS + i * WIN.towerStepS;
  return t < on ? 'standby' : t < on + WIN.towerSpinS ? 'power' : 'online';
}

/** Time (s) the last tower is online (the end of the sequence's last change). */
export const towersDoneAt = (): number => WIN.towerStartS + (VENT_TOWERS.length - 1) * WIN.towerStepS + WIN.towerSpinS;

/** The whole sequence is over at t (every tier at full power, every tower online). */
export const winDoneAt = (n: number): number => Math.max(towersDoneAt(), tierStartAt(Math.max(0, n - 1), Math.max(1, n)) + WIN.tierRampS, WIN.coreS, WIN.airAtS);

/** Where the win sequence sends its changes (the runtime: reactorVisuals(), the light pool, lane AIR, HUD, audio). */
export interface WinSink {
  coreGlow(k: number): void;
  tierPower(level: number, k: number): void;
  fanSpeed(id: number, k: number): void;
  /** The powered light circuit 0..1 (mean tier power). */
  circuit(k: number): void;
  /** Lane AIR: clear every zone's gas over durationS (called once). */
  clearAir(durationS: number): void;
  toast(text: string): void;
  /** A tower changed state (monitors redraw). */
  towers(): void;
}

/** Values are re-sent only when they moved this much (or reached 0 / 1): bounded calls per frame. */
const EPS = 0.01;

/**
 * The win sequence stepped by the game clock (only while the world updates). `finish()` jumps to the end state (a rebuilt restarted
 * world). Every side effect goes through the sink; clearAir and each toast fire once.
 */
export class WinSequence {
  t = 0;
  private core = -1;
  private circ = -1;
  private readonly tier: number[];
  private readonly fan = new Map<number, number>();
  private air = false;
  private toasted = 0;
  private towerKey = -1;

  constructor(readonly plan: WinPlan, private readonly sink: WinSink) {
    this.tier = plan.tiers.map(() => -1);
  }

  get done(): boolean {
    return this.t >= winDoneAt(this.plan.tiers.length);
  }

  /** Advance by dt (s) and send what changed. */
  step(dt: number): void {
    this.t += Math.max(0, dt);
    this.emit(false);
  }

  /** Jump to the end state (every value at its final level; clearAir if it was never called — the runtime skips it on a restore). */
  finish(): void {
    this.t = Math.max(this.t, winDoneAt(this.plan.tiers.length) + 1);
    this.emit(true);
  }

  /** Tower states now (monitors). */
  towerStates(): TowerState[] {
    return VENT_TOWERS.map((_, i) => towerStateAt(this.t, i));
  }

  private emit(final: boolean): void {
    const t = this.t, s = this.sink, n = this.plan.tiers.length;
    const g = coreGlowAt(t);
    if (moved(this.core, g)) { this.core = g; if (g > 0) s.coreGlow(g); }
    if (!this.air && (t >= WIN.airAtS || final)) { this.air = true; s.clearAir(WIN.airDurationS); }
    for (let r = 0; r < n; r++) {
      const k = tierPowerAt(t, r, n);
      if (!moved(this.tier[r], k)) continue;
      this.tier[r] = k;
      if (k > 0) s.tierPower(this.plan.tiers[r], k); // still dark: nothing to send (the runtime set every tier at build)
    }
    // Fans only ever go UP, straight to full speed when their tier's power starts (ARCH eases the blades = the spool-up): a fan lane
    // AIR already runs (its zone's generator) never dips during the sequence.
    for (const id of this.plan.fans) {
      if (this.fan.has(id) || t <= tierStartAt(this.plan.fanRank.get(id) ?? 0, n)) continue;
      this.fan.set(id, 1);
      s.fanSpeed(id, 1);
    }
    const c = circuitAt(t, n);
    if (moved(this.circ, c)) { this.circ = c; if (c > 0) s.circuit(c); }
    if (this.toasted === 0 && t >= WIN.toastAtS) { this.toasted = 1; if (!final) s.toast(WIN_TEXT.restarted); }
    if (this.toasted === 1 && t >= towersDoneAt()) { this.toasted = 2; if (!final) s.toast(WIN_TEXT.allOnline); }
    let key = 0;
    for (let i = 0; i < VENT_TOWERS.length; i++) key = key * 3 + (towerStateAt(t, i) === 'standby' ? 0 : towerStateAt(t, i) === 'power' ? 1 : 2);
    if (key !== this.towerKey) { this.towerKey = key; s.towers(); }
  }
}

function moved(was: number, k: number): boolean {
  if (was < 0) return true;
  if (k === was) return false;
  return Math.abs(k - was) >= EPS || k === 0 || k === 1;
}
