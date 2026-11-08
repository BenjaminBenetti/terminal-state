// Task studio-general-armor-20261107-231448-01 (user: "lets simplify clothing armor ... simply have clothing give you armor similar to what
// it does now, but not specific to any piece of the body"): ONE armor pool from the gear the player WEARS (the gear slots only — never
// pockets, bags, the Lockbox, the trunk or cargo). Pure logic (no DOM / three.js).
//
//  - Units: one PIP = 2.5 % armor (ARMOR.pip); the HUD shows blue pips above the health bar in HALF-pip steps, rounded DOWN, ten pips a
//    row (a full row = 25 %), further rows wrapping onto the first with ~25 % overlap (ui/hud.ts setArmor). The stored values keep
//    their exact fractions (the display quantizes, the game never does).
//  - Each armor-bearing gear item contributes its OWN current armor: the stack's `armor` (items/inventory.ts ItemStack; absent =
//    undamaged = its definition's GearSpec.armor). The pool is their plain SUM (pips add up, as the user describes), capped at
//    ARMOR.cap (0.8, the existing safety cap: never invulnerable).
//  - ENEMY DAMAGE ONLY (user, answer B: "this purely applies to damage applied by enemies, all types of enemies"): an enemy's hit
//    (player/hits.ts isEnemyHit — every family's claw / bite / fist, the Blightbelly's attributed blast; after the x2 enemy multiplier)
//    loses `pool` of its damage, whatever body part it lands on. Falls, 'other' hits, the toxic gas field and the empty food / water
//    drain never meet the armour: no reduction, no injury save, no wear.
//  - INJURY SAVE (enemy hits): an injury the game would give an UNARMORED player (player/injuries.ts: the candidate is rolled on the raw
//    damage, not the armour-reduced damage) is cancelled with probability = the pool of that hit (a 25 % pool: a 25 % chance to stay
//    unhurt). Hard landings are not enemy damage: no save.
//  - WEAR: an enemy hit the armour actually mitigated (absorbed > 0) picks ONE worn item that contributed armour (uniformly) and lowers its own
//    armour by ARMOR_WEAR_PER_HIT (clamped at 0): damaged gear blocks less from the NEXT hit on. The amount is the user's pending answer
//    A; until it is set wear is off (never guessed). Wear is per item and travels with it (drop / bag / Lockbox / cargo / saves).

import type {ItemStack} from '../items/inventory';
import {GEAR_SLOTS, gearSpec, type GearSlot} from '../items/gear';
import {ARMOR_CAP} from './modifiers';
import {armorFor, isEnemyHit, type PlayerHit} from './hits';

export const ARMOR = {
  /** One pip = 2.5 % armor; the HUD steps in half pips (1.25 %). */
  pip: 0.025,
  halfPip: 0.0125,
  /** Pips per HUD row (a full row = 25 %). */
  pipsPerRow: 10,
  /** Vertical overlap of a wrapped row on the row under it (the HUD). */
  rowOverlap: 0.25,
  /** The pool never exceeds this (the existing armour safety cap). */
  cap: ARMOR_CAP,
} as const;

/**
 * Armour lost by ONE worn contributing item on each mitigating hit — PENDING user answer A ("1/4 pip" = 0.00625 or "1.25 %" =
 * half a pip = 0.0125). null = wear off until the answer is set (never a guessed default).
 */
export const ARMOR_WEAR_PER_HIT: number | null = null;


/** An item's current armour fraction (its stack's own `armor`, else its definition's; 0 for anything else). */
export function itemArmor(stack: Pick<ItemStack, 'itemId' | 'armor'> | null | undefined): number {
  if (!stack) return 0;
  const full = gearSpec(stack.itemId)?.armor ?? 0;
  if (!(full > 0)) return 0;
  const a = stack.armor;
  return a === undefined ? full : Math.max(0, Math.min(full, a));
}

export interface ArmorContributor { slot: GearSlot; stack: ItemStack; armor: number }

type Worn = Readonly<Partial<Record<GearSlot, ItemStack | null>>>;

/** The worn items that currently contribute armour (> 0), in gear-slot order. An item in the wrong slot never counts. */
export function armorContributors(worn: Worn): ArmorContributor[] {
  const out: ArmorContributor[] = [];
  for (const slot of GEAR_SLOTS) {
    const st = worn[slot];
    if (!st || gearSpec(st.itemId)?.slot !== slot) continue;
    const a = itemArmor(st);
    if (a > 0) out.push({slot, stack: st, armor: a});
  }
  return out;
}

/** The armour pool of what is worn: the sum of the contributors, capped at ARMOR.cap. */
export function armorPool(worn: Worn): number {
  return Math.min(ARMOR.cap, armorContributors(worn).reduce((s, c) => s + c.armor, 0));
}

/** Half pips the HUD shows for a pool (rounded DOWN; never more than the pool). */
export function displayHalfPips(pool: number): number {
  return Math.max(0, Math.floor(pool / ARMOR.halfPip + 1e-9));
}

/** Pips as text: "4", "3½", "0". */
export function pipsText(pool: number): string {
  const h = displayHalfPips(pool), whole = Math.floor(h / 2);
  return h % 2 ? `${whole ? whole : ''}½` : `${whole}`;
}

/**
 * The HUD's pip rows for a pool: ten pips a row (bottom row first), each 'full' or the last one 'half'; nothing for an unarmoured player.
 */
export function pipRows(pool: number): ('full' | 'half')[][] {
  const h = displayHalfPips(pool), rows: ('full' | 'half')[][] = [];
  for (let i = 0; i < Math.ceil(h / 2); i++) {
    if (i % ARMOR.pipsPerRow === 0) rows.push([]);
    rows[rows.length - 1].push(2 * i + 1 < h ? 'full' : 'half');
  }
  return rows;
}

/** Whether an injury candidate is cancelled by the armour save (roll in [0, 1)). */
export function injurySaved(pool: number, roll: number): boolean {
  return roll < Math.max(0, Math.min(ARMOR.cap, pool));
}

export type ArmorWear = {slot: GearSlot; before: number; after: number};

/**
 * One hit through the worn armour (Game.applyPlayerHit, after the enemy x2): the pool is read ONCE, before any wear — it cuts this hit
 * and rides on it as `armor` (the injury save of this hit) — then, only if it actually mitigated something, ONE contributing item
 * wears (wearOne). Per hit, never per frame. `wearRoll` is drawn only when an item wears. A hit that is not an enemy's (isEnemyHit:
 * a fall, 'other') meets no armour at all: pool 0, nothing absorbed, no save, no wear.
 */
export function armorHit<H extends PlayerHit>(hit: H, worn: Worn, wearRoll: () => number, wear: number | null = ARMOR_WEAR_PER_HIT):
  {resolved: H & {applied: number; absorbed: number; armor: number}; wore: ArmorWear | null} {
  const pool = isEnemyHit(hit) ? armorPool(worn) : 0;
  const {applied, absorbed} = armorFor(hit, pool);
  const wore = absorbed > 0 && wear ? wearOne(worn, wearRoll(), wear) : null;
  return {resolved: {...hit, applied, absorbed, armor: pool}, wore};
}

/**
 * Wear: ONE contributing worn item (picked uniformly by `roll` in [0, 1)) loses `amount` of its own armour, clamped at 0. Returns what
 * changed (null: nothing worn contributes, or no amount).
 */
export function wearOne(worn: Worn, roll: number, amount: number | null): ArmorWear | null {
  if (!(amount !== null && amount > 0)) return null;
  const cs = armorContributors(worn);
  if (!cs.length) return null;
  const c = cs[Math.min(cs.length - 1, Math.floor(Math.max(0, roll) * cs.length))];
  const after = Math.max(0, c.armor - amount);
  c.stack.armor = +after.toFixed(6);
  return {slot: c.slot, before: c.armor, after: c.stack.armor};
}
