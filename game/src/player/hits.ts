// Iteration 16 (primary, shared contract): one pipeline for damage TO THE PLAYER, so gear armor (lane GEAR) and limb
// injuries (lane INJURY) see every hit the same way.
//
// Order: Game.hurtPlayer builds a PlayerHit (where it lands, how hard) -> armor reduces the HP damage for the hit
// location (PlayerModifiers.armorHead / armorTorso; limbs are not armored by the base tier) -> HP damage -> the injury
// system decides whether an arm / leg gets injured (it sees the hit BEFORE armor reduction, plus the absorbed part).

export type HitLocation = 'head' | 'torso' | 'arm' | 'leg';
export type HitSource = 'zombie' | 'creature' | 'fall' | 'other';

export interface PlayerHit {
  /** Raw damage before armor. */
  amount: number;
  source: HitSource;
  location: HitLocation;
  /** Attacker kind (zombie archetype / creature id) when known. */
  attacker?: string;
}

export interface ResolvedHit extends PlayerHit {
  /** HP damage actually applied (after armor). */
  applied: number;
  /** Damage the armor absorbed. */
  absorbed: number;
}

/** Armor reduction for a hit (pure). */
export function armorFor(hit: PlayerHit, armorHead: number, armorTorso: number): {applied: number; absorbed: number} {
  const a = hit.location === 'head' ? armorHead : hit.location === 'torso' ? armorTorso : 0;
  const applied = hit.amount * (1 - Math.max(0, Math.min(0.8, a)));
  return {applied, absorbed: hit.amount - applied};
}

/**
 * Where a melee hit lands. Deterministic from a 0..1 roll so tests can sample the distribution:
 * torso 50 %, arm 22 %, leg 18 %, head 10 % (a crouched player is hit in the legs a little more often).
 */
export function meleeHitLocation(roll: number, crouched = false): HitLocation {
  const head = 0.1, arm = 0.22, leg = crouched ? 0.24 : 0.18;
  if (roll < head) return 'head';
  if (roll < head + arm) return 'arm';
  if (roll < head + arm + leg) return 'leg';
  return 'torso';
}
