// Iteration 16 (primary, shared contract): one pipeline for damage TO THE PLAYER, so gear armor (lane GEAR) and limb
// injuries (lane INJURY) see every hit the same way.
//
// Order: Game.hurtPlayer builds a PlayerHit (where it lands, how hard) -> armor reduces the HP damage for the hit
// location (PlayerModifiers.armorHead / armorTorso; limbs are not armored by the base tier) -> HP damage -> the injury
// system decides whether an arm / leg gets injured (it sees the hit BEFORE armor reduction, plus the absorbed part).

export type HitLocation = 'head' | 'torso' | 'arm' | 'leg';
/**
 * Task track1-siren-blightbelly-20261031 (lane BLIGHT): 'blast' = a physical blast (a Blightbelly's death burst) — armour and
 * limb injuries treat it like any hit (injury cause 'hit'); the gas mask has nothing to do with it (only the gas cloud).
 */
export type HitSource = 'zombie' | 'creature' | 'fall' | 'other' | 'blast';

export interface PlayerHit {
  /** Raw damage before armor. */
  amount: number;
  source: HitSource;
  location: HitLocation;
  /** Attacker kind (zombie archetype / creature id) when known. */
  attacker?: string;
  /**
   * Task studio-alpha-survival-controls-20261107-060450-01: an ENEMY's attack (a claw / bite / fist, the Blightbelly's death blast). Absent:
   * the 'zombie' / 'creature' sources are enemy attacks, every other source is not (a fall, 'other').
   */
  enemy?: boolean;
}

/**
 * Task studio-alpha-survival-controls-20261107-060450-01 (user: "the enemies should do double the damage to the PLAYER only! The player
 * damage is UNCHANGED"): the multiplier on every ENEMY attack that reaches the player, applied to the raw hit before armour (so armour
 * keeps its fraction and the injury roll sees the hit it really is). The player's own weapons, enemy health, the toxic gas field,
 * falls and the empty-vitals drain never go through it.
 */
export const ENEMY_DAMAGE_TO_PLAYER = 2;

/** Whether a hit is an enemy's attack (see PlayerHit.enemy). */
export function isEnemyHit(hit: PlayerHit): boolean {
  return hit.enemy ?? (hit.source === 'zombie' || hit.source === 'creature');
}

/** The hit as it lands: an enemy's attack scaled by ENEMY_DAMAGE_TO_PLAYER, anything else unchanged (pure). */
export function incomingHit<H extends PlayerHit>(hit: H): H {
  return isEnemyHit(hit) ? {...hit, amount: hit.amount * ENEMY_DAMAGE_TO_PLAYER} : hit;
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
