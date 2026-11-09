// Task studio-market-rework-20261108-074144-01 (lane COMBAT): WHO does WHAT when the settlement turns hostile (user: "If you shoot one,
// they all become hostile, about 70% will just run away, and the remaining ones will pull out random weapons and start firing back!" /
// "If the player picks those items up, the shop keeper will attack them"). Pure and SEEDED on this system's own hash streams (no game /
// generator RNG draw): the same station + person always gets the same gun and the same role.
// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): user — "Increase attackers to 50%": half fight, half flee (was 30 / 70).
//  - fighters: round(fightShare x people) of a seeded shuffle of everyone (at least one); the ROBBED trader always fights (it takes the
//    last fighter's place, so the split stays the same);
//  - every person carries a seeded real gun (pistol / rifle / shotgun: the player's own weapon definitions and models) with a full
//    magazine and a few seeded spare magazines; only fighters draw it.
import {hashString, mulberry32} from '../../core/rng';
import {WEAPONS} from '../../weapons/weapons';
import type {MarketStallId} from '../../gen/market/marketTypes';
import {MARKET_GUNS, traderId, type MarketGunId, type MarketRole} from './record';

export const MARKET_HOSTILITY = {
  /** Share of the settlement that draws a gun and fights (the rest flee; task studio-market-bar-20261108-225231-01: 0.5, was 0.3). */
  fightShare: 0.5,
  /** Gun weights (the pistol is the common sidearm). */
  gunWeights: {pistol: 0.45, rifle: 0.3, shotgun: 0.25} as Record<MarketGunId, number>,
  /** Spare magazines carried (min, max), on top of the full one. */
  spareMags: [1, 3] as const,
  /**
   * Hit points of every survivor: an ORDINARY zombie's (ai/brain.ts ZOMBIE_STATS.shambler.hp = 100; not the coated zombie, a boss, the
   * Siren or the Strainer). The player's bullets / knife and their head / limb multipliers are unchanged.
   */
  hp: 100,
} as const;

/** A person's seeded gun. */
export function gunFor(seed: number, id: string): MarketGunId {
  const r = mulberry32(hashString(`market-hostility:gun:${id}`, seed >>> 0));
  r();
  const W = MARKET_HOSTILITY.gunWeights;
  let x = r() * MARKET_GUNS.reduce((s, g) => s + W[g], 0);
  for (const g of MARKET_GUNS) { x -= W[g]; if (x < 0) return g; }
  return MARKET_GUNS[MARKET_GUNS.length - 1];
}

/** A person's seeded rounds: a full magazine + spare magazines' worth. */
export function ammoFor(seed: number, id: string, gun: MarketGunId): {mag: number; spare: number} {
  const r = mulberry32(hashString(`market-hostility:ammo:${id}`, seed >>> 0));
  r();
  const [a, b] = MARKET_HOSTILITY.spareMags, mag = WEAPONS[gun].magazine;
  return {mag, spare: mag * (a + Math.floor(r() * (b - a + 1)))};
}

/** How many of `n` people fight. */
export const fighterCount = (n: number): number => (n <= 0 ? 0 : Math.max(1, Math.round(n * MARKET_HOSTILITY.fightShare)));

/**
 * Roles of everyone in the settlement (`ids` in a stable order: traders, then residents). Seeded per station; `robbed` (a theft) puts
 * that stall's trader among the fighters in the last fighter's place.
 */
export function assignRoles(seed: number, ids: readonly string[], robbed?: MarketStallId): Map<string, MarketRole> {
  const order = [...ids];
  const r = mulberry32(hashString('market-hostility:roles', seed >>> 0));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const k = fighterCount(order.length);
  const fight = order.slice(0, k);
  const forced = robbed ? traderId(robbed) : null;
  if (forced && ids.includes(forced) && !fight.includes(forced)) fight[k - 1] = forced;
  const out = new Map<string, MarketRole>();
  for (const id of ids) out.set(id, fight.includes(id) ? 'fight' : 'flee');
  return out;
}
