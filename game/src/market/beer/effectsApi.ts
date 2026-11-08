// Task studio-market-bar-20261108-225231-01: the seams of the beer effects (implemented by the BEER lane as Game.beerEffects) and the
// player's throw-up action (the VOMIT lane, Game.vomit). Other systems read these through optional chaining, so each builds alone.
import type {BeerId, TimedBeerEffect} from '../../items/beers';

/** The one active timed beer. */
export interface ActiveBeer {
  readonly itemId: BeerId;
  readonly effect: TimedBeerEffect;
  /** Active gameplay seconds left. */
  readonly remaining: number;
}

export interface BeerEffectsApi {
  readonly active: ActiveBeer | null;
  /** The player's ground-movement multiplier from the active beer (1, or 1.25 for the Lager). */
  speedMult(): number;
  /** How readily enemies / hostile people detect the player (1, or 0.75 for the Porter): ONE shared modifier. */
  perceptionMult(): number;
  /** Temporary armour added to the enemy-hit pool (0, or 0.125 for the Stout); never written to an ItemStack. */
  tempArmor(): number;
}

/** The player's throw-up action: body / camera / held item, physical food chunks, the retch. */
export interface VomitApi {
  /** Start it (false: it cannot start now, e.g. dead / riding / already throwing up). */
  start(): boolean;
  readonly active: boolean;
}
