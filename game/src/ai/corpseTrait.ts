// Task studio-corpse-chipper-fuel-20261110-235304-01: the COMMON CORPSE TRAIT of every enemy archetype — what its DEAD body is. Pure (no
// three.js): save validation and the run records read it without loading actors. ai/creatureArchetypes.ts ENEMY_ARCHETYPES[id].corpse
// is this table's entry; the Record type makes every archetype (present and future) classify itself, and a registry-driven test checks
// each one. Eligibility for the train's chipper is a trait, never a per-machine list: undead flesh with a humanoid body plan (carried over
// the shoulder). Animals are not undead; living people (Market traders), the player and decorative corpse props are not enemy archetypes.
// Task studio-corpse-market-shop-20261114-031614-01: CARRYING is the wider trait — every undead body (BB's small one too) can be carried,
// kept in a station / the train, and sold to the Market's corpse buyer (corpseCarriable); the chipper still takes only the humanoid ones.

import type {EnemyArchetypeId} from './creatureSpawn';

export interface CorpseTrait {
  /** Undead (infected) flesh: its body can be ground into fuel. */
  undead: boolean;
  /** Humanoid body plan (two arms, two legs, a head): one carried body. */
  humanoid: boolean;
  /** Body mass (kg): the carry's slow-down, a dropped body's settle. */
  massKg: number;
  /** Why it is (not) a carriable body — the audit's recorded reason. */
  note: string;
}

export const CORPSE_TRAITS: Record<EnemyArchetypeId, CorpseTrait> = {
  zombie: {undead: true, humanoid: true, massKg: 70, note: 'ordinary infected (every wardrobe look, shambler and coated)'},
  blightbelly: {undead: true, humanoid: true, massKg: 130, note: 'bloated infected; its single death burst has already happened'},
  siren: {undead: true, humanoid: true, massKg: 45, note: 'pale undead apparition on the shared humanoid rig'},
  ratdog: {undead: false, humanoid: false, massKg: 25, note: 'tunnel scavenger animal: not undead, not a humanoid body'},
  strainer: {undead: true, humanoid: true, massKg: 90, note: 'tall clawed infected on a humanoid body plan'},
  screacher: {undead: true, humanoid: true, massKg: 75, note: 'headless blind infected (four bodies, one type) on the humanoid rig'},
  // task studio-bb-production-20261112-234540-01: BB is undead, but its body is a knee-high crawler that moves on all fours — not the adult
  // body plan the chipper feed is built for; its presentation stays non-graphic. Task studio-corpse-market-shop-20261114-031614-01: its
  // small body can be carried (the same over-the-shoulder carry on the shared rig) and sold to the Market's corpse buyer; never chipped.
  bb: {undead: true, humanoid: false, massKg: 9, note: 'BB: small baby-like undead crawler (four looks, one type); carried and sold whole to the Market corpse buyer, never fed to the chipper (not an adult humanoid body)'},
};

/** A dead body of this archetype can be carried and fed to the train's chipper (undead + humanoid). Unknown ids: no. */
export function corpseFeedable(arch: string): boolean {
  const t = (CORPSE_TRAITS as Record<string, CorpseTrait | undefined>)[arch];
  return !!t && t.undead && t.humanoid;
}

/**
 * Task studio-corpse-market-shop-20261114-031614-01: a dead body of this archetype can be carried, kept (a station's lane, the train's
 * cargo) and sold to the Market's corpse buyer — every undead body, whatever its body plan. Unknown ids: no. (Feedable implies carriable.)
 */
export function corpseCarriable(arch: string): boolean {
  const t = (CORPSE_TRAITS as Record<string, CorpseTrait | undefined>)[arch];
  return !!t && t.undead;
}
