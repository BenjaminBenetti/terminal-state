// Task studio-market-bar-20261108-225231-01: the seams of the beer effects (implemented by the BEER lane as Game.beerEffects) and the
// player's throw-up action (the VOMIT lane, Game.vomit). Other systems read these through optional chaining, so each builds alone.
import type {BeerId, TimedBeerEffect} from '../../items/beers';
import type {ItemStack} from '../../items/inventory';

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
  /**
   * (lane BEER) THE consume commit of one beer (Game.completeUse, after the stack's unit was consumed — never on purchase / equip / hover /
   * cancel): a timed beer fills the one slot (a second timed one — the same one too — calls Game.vomit.start() and REPLACES the old buff,
   * a fresh 600 s); Second Supper Bock SETS food and water to 200 (no slot, no vomit). Returns the toast line.
   */
  drink?(itemId: BeerId): string;
  /**
   * (lane BEER) Lucky Switch Pilsner's ONE shared acquisition hook: `taken` (a snapshot of exactly what went into the inventory) came from
   * `source`. While the Pilsner is active an eligible, never-rolled source rolls once (10 %); a success adds a fresh-uid clone (at the
   * player's feet when it does not fit). Trades, currency, restart parts, the bonus itself and the player's own dropped / moved items
   * never come here or are refused.
   */
  acquired?(source: AcquireSource, taken: ItemStack): void;
}

/**
 * (lane BEER) Where a NEW legitimate pickup came from (the Pilsner's eligible sources). `holder` = the holder's run-memory key
 * (run/worldMemory.ts holderKeyOf).
 */
export type AcquireSource =
  /** A loot lot taken from a holder (shelf, locker, drawer, smashed holder …). */
  | {kind: 'lot'; holder: string; lot: number}
  /** A world pickup: a generated one (its layout pickup index) or a lot that left its holder (shot / spilled); neither = the player's own. */
  | {kind: 'pickup'; layoutIndex?: number; lot?: {holder: string; lot: number}}
  /** A stolen ware (the stall's stock uid; theft still provokes once). */
  | {kind: 'ware'; stall: string; uid: number}
  /** A grounded backpack picked up (only an untouched generated find, 'found:<i>', with nothing put in it, is eligible). */
  | {kind: 'bag'; id: string; empty: boolean};

/** The player's throw-up action: body / camera / held item, physical food chunks, the retch. */
export interface VomitApi {
  /** Start it (false: it cannot start now, e.g. dead / riding / already throwing up). */
  start(): boolean;
  readonly active: boolean;
}
