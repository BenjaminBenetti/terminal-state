// Task studio-weapon-variety-production-20261109-224355-01 (lane MELEE): what a heavy melee hit does BEYOND its damage — the swing's
// charge / stamina scaling, the per-target damage of a sweep, knockback by target MASS (protected bosses resist knockdown), the stagger
// options handed to the brain (its own cooldown rules: no stun-lock) and a bounded shove integrator that never pushes a body through
// a wall or off its floor. Pure numbers (no THREE, no DOM): game.ts meleeContact applies them, the tests read the same functions.
// The knife has none of the MeleeSpec extensions, so every function here returns its unchanged behaviour (x1 damage, no push / stagger
// / stamina): game.ts keeps the knife's own path bit-for-bit.

import type {MeleeSpec, WeaponDef} from '../weapons/weapons';
import {meleeDamage, type MeleePart} from './melee';
import {isVarietyWeapon} from '../weapons/varietyIds';

/**
 * Target mass relative to an ordinary (shambler) zombie: a push of `knockback` m on mass 1 moves a body of mass m by knockback / m.
 * Keys: enemy archetype ids (ai/creatureArchetypes.ts ENEMY_ARCHETYPES; the zombie's coated type has its own heavier entry).
 */
export const MELEE_MASS: Readonly<Record<string, number>> = {
  zombie: 1,
  coated: 1.3, // the heavy-coated infected
  ratdog: 0.55, // the light quadruped flies further (capped at MELEE_KNOCK.maxM)
  blightbelly: 1.9, // the obese one barely shifts
  siren: 1.1,
  strainer: 2.6, // tall, heavy body
};
/** Protected bosses (their HP / rig / AI / sounds unchanged): they RESIST KNOCKDOWN — a token push, never a longer stagger. */
export const MELEE_PROTECTED: ReadonlySet<string> = new Set(['strainer', 'siren']);

export const MELEE_KNOCK = {
  /** Longest push any hit gives (m). */
  maxM: 1.4,
  /** A protected boss takes this share of the mass-scaled push. */
  protectedMult: 0.12,
  /** A push is delivered over this time (s), fast then easing out (no teleport). */
  shoveS: 0.2,
  /** At most this many bodies are being pushed at once (bounded: the oldest push is dropped). */
  maxShoves: 12,
  /** Footing: each step of a push must land on a floor within this height of the feet (no ledge falls, never out of the map). */
  footingTol: 0.35,
  /** Ragdoll impulse added per metre of push on a kill (N s; the knife's 38 stays 38). */
  killPerM: 30,
} as const;

/** A swing made with the stamina meter SHORT of its cost: weaker, a small push, never a stagger. */
export const MELEE_WINDED = {damage: 0.7, knockback: 0.4} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (p: readonly [number, number], k: number) => p[0] + (p[1] - p[0]) * k;

/** Stamina meter % one swing costs (a charge weapon's scales with its charge). 0 for the knife. */
export function meleeStaminaCost(m: MeleeSpec, charge = 0): number {
  const c = m.charge;
  return (m.stamina ?? 0) * (c?.stamina ? lerp(c.stamina, clamp01(charge)) : 1);
}

export interface MeleeSwingOutcome {
  /** Multiplies meleeDamage(def, part) for every target of the swing. */
  damageMult: number;
  /** Push (m) on a standard-mass target, before mass / boss scaling. */
  knockback: number;
  /** Stagger (s) asked of a target (0 = the hit never staggers). */
  stagger: number;
}

/** One swing's scaling: its charge (0 tap .. 1 full) and whether it was winded (stamina short). The knife: x1, no push, no stagger. */
export function meleeSwing(m: MeleeSpec, charge = 0, winded = false): MeleeSwingOutcome {
  const c = m.charge, k = c ? clamp01(charge) : 0;
  let damageMult = c ? lerp(c.damage, k) : 1;
  let knockback = (m.knockback ?? 0) * (c ? lerp(c.knockback, k) : 1);
  let stagger = c?.stagger ? lerp(c.stagger, k) : m.stagger ?? 0;
  if (winded) { damageMult *= MELEE_WINDED.damage; knockback *= MELEE_WINDED.knockback; stagger = 0; }
  return {damageMult, knockback, stagger};
}

/** Damage of the swing on the `index`-th target of its hit set (0 = the centre-most: full; later ones x secondaryMult). */
export function meleeHitDamage(def: Pick<WeaponDef, 'damage' | 'headMult' | 'limbMult' | 'melee'>, part: MeleePart, swing: Pick<MeleeSwingOutcome, 'damageMult'>, index: number): number {
  const base = meleeDamage(def, part);
  const k = swing.damageMult * (index > 0 ? def.melee?.secondaryMult ?? 1 : 1);
  return k === 1 ? base : base * k;
}

/** Mass of a target (archetype id; an ordinary zombie's `type` picks the coated entry). Unknown = 1. */
export function meleeMassOf(archetype?: string, type?: string): number {
  const a = archetype ?? 'zombie';
  if (a === 'zombie' && type === 'coated') return MELEE_MASS.coated;
  return MELEE_MASS[a] ?? 1;
}

/** The push (m) a target gets from a swing's `knockback`: / mass, a protected boss only a token share, capped. */
export function meleeKnockFor(knockback: number, archetype?: string, type?: string): number {
  if (!(knockback > 0)) return 0;
  const d = knockback / meleeMassOf(archetype, type) * (MELEE_PROTECTED.has(archetype ?? 'zombie') ? MELEE_KNOCK.protectedMult : 1);
  return Math.min(MELEE_KNOCK.maxM, d);
}

/**
 * The options handed to ZombieBrain.damage: no stagger (`{stagger: false}`, the knife's) for a swing without one; a protected boss
 * keeps its OWN stagger rules (the default options: the Strainer's >= 45 single hit, the dormant Siren never) and never a longer
 * stagger; anyone else the swing's stagger length — still under the brain's rules (>= 20 damage, never mid-attack, the cooldown).
 */
export function meleeStaggerOpts(stagger: number, archetype?: string): {stagger?: false; staggerS?: number} {
  if (!(stagger > 0)) return {stagger: false};
  if (MELEE_PROTECTED.has(archetype ?? 'zombie')) return {};
  return {staggerS: stagger};
}

/** Horizontal push direction for a hit along ray `d`: away from the player, plus `side` x the sweep direction (to the left of `right`). */
export function meleePushDir(d: {x: number; z: number}, right: {x: number; z: number}, side = 0): [number, number] {
  const hl = Math.hypot(d.x, d.z) || 1, rl = Math.hypot(right.x, right.z) || 1;
  const x = d.x / hl - right.x / rl * side, z = d.z / hl - right.z / rl * side;
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

/** Ragdoll impulse of a killing melee hit: the base (the knife's 38) + MELEE_KNOCK.killPerM per metre of its push. */
export function meleeKillStrength(base: number, knockM: number): number {
  return knockM > 0 ? base + MELEE_KNOCK.killPerM * knockM : base;
}

/** A body a shove moves (ZombieBrain: feet x / y / z, alive, climbing). */
export interface ShoveBody { x: number; y: number; z: number; readonly alive: boolean; readonly climbing?: boolean }

/**
 * One step of a shove: the collision-resolved move (`move`: core/physics.ts moveCircle — walls / props / doors), kept only when the
 * new spot has footing on the body's own floor (`floorAt`: Levels.supportIn(..).floor — no ledge falls, nothing outside the map /
 * inside a wall). Returns false when the push is over for this body (dead / climbing / blocked / no footing).
 */
export function meleeShoveStep(b: ShoveBody, dx: number, dz: number, move: (x: number, z: number, dx: number, dz: number) => readonly [number, number],
  floorAt: (x: number, z: number, y: number) => number | null | undefined): boolean {
  if (!b.alive || b.climbing) return false;
  const [nx, nz] = move(b.x, b.z, dx, dz);
  const f = floorAt(nx, nz, b.y);
  if (f === null || f === undefined || !Number.isFinite(f) || Math.abs(f - b.y) > MELEE_KNOCK.footingTol) return false;
  const moved = Math.hypot(nx - b.x, nz - b.z);
  b.x = nx; b.z = nz;
  return moved > 1e-5; // pressed against a wall: the push is spent
}

/**
 * The pushes under way: each delivers its distance over MELEE_KNOCK.shoveS (ease-out), at most MELEE_KNOCK.maxShoves at once (the
 * oldest dropped), one per body (a new hit replaces its push). Nothing persists: a push is cosmetic positioning, over in 0.2 s.
 */
export class MeleeShoves<K> {
  private list: {key: K; dx: number; dz: number; dist: number; t: number}[] = [];

  get size(): number { return this.list.length; }

  add(key: K, dirX: number, dirZ: number, dist: number): void {
    if (!(dist > 0)) return;
    const i = this.list.findIndex(s => s.key === key);
    if (i >= 0) this.list.splice(i, 1);
    if (this.list.length >= MELEE_KNOCK.maxShoves) this.list.shift();
    const l = Math.hypot(dirX, dirZ) || 1;
    this.list.push({key, dx: dirX / l, dz: dirZ / l, dist: Math.min(dist, MELEE_KNOCK.maxM), t: 0});
  }

  /** Advance every push by `dt`; `step` moves the body by (dx, dz) and returns false when its push is over. */
  update(dt: number, step: (key: K, dx: number, dz: number) => boolean): void {
    if (!this.list.length) return;
    const T = MELEE_KNOCK.shoveS, f = (t: number) => 1 - (1 - t / T) * (1 - t / T);
    let n = 0;
    for (const s of this.list) {
      const t1 = Math.min(T, s.t + dt), d = s.dist * (f(t1) - f(s.t));
      s.t = t1;
      if (d > 0 && !step(s.key, s.dx * d, s.dz * d)) s.t = T;
      if (s.t < T) this.list[n++] = s;
    }
    this.list.length = n;
  }

  clear(): void { this.list.length = 0; }
}

/**
 * The HUD hint line of a held weapon-variety melee weapon (null: the knife keeps its own "slash" lines). A CHARGE weapon shows its
 * charge while the wound-up pose is held, in 10 % steps (the small HUD charge cue); the others the hold / release prompt.
 */
export function meleeHint(def: Pick<WeaponDef, 'id' | 'melee'>, winding: boolean, charge: number): string | null {
  if (!def.melee || !isVarietyWeapon(def.id)) return null;
  if (!def.melee.charge) return winding ? 'Release to swing' : 'Hold · release to swing';
  if (!winding) return 'Hold to charge · release to swing';
  const k = clamp01(charge);
  return k >= 1 ? 'FULL CHARGE · release' : `Charging ${Math.floor(k * 10) * 10} % · release`;
}
