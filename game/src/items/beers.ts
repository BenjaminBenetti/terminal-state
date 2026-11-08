// Task studio-market-bar-20261108-225231-01: THE MARKET BAR'S BEERS — the shared contract (ids, names, prices, effects, tuning) between
// the bar (its bartender's finite stock, market/trade), the beer effects (market/beer: the one timed buff slot, the instant overfill) and
// the HUD. The item definitions themselves (ItemDef: model, icon, use) are the BEER lane's, built on these ids.
//
// User (final answers): four TIMED beers (10 active minutes each; only one at a time — drinking another, the same one included, makes the
// player throw up, then the NEW one replaces the old) and one INSTANT beer (Second Supper Bock: sets food AND water to 200 %, not a buff).

/** A timed beer's effect (one active at a time). */
export type TimedBeerEffect = 'speed' | 'pickup' | 'armor' | 'stealth';

export interface BeerSpec {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  /** The bartender's price per bottle (Rail Ties). */
  readonly price: number;
  /** The timed effect, or 'overfill' (the instant food + water fill; never occupies the timed slot). */
  readonly effect: TimedBeerEffect | 'overfill';
}

export const BEERS = {
  beer_lager: {id: 'beer_lager', name: 'Express Line Lager', short: 'Lager', price: 20, effect: 'speed'},
  beer_pilsner: {id: 'beer_pilsner', name: 'Lucky Switch Pilsner', short: 'Pilsner', price: 20, effect: 'pickup'},
  beer_stout: {id: 'beer_stout', name: 'Ironclad Stout', short: 'Stout', price: 20, effect: 'armor'},
  beer_porter: {id: 'beer_porter', name: 'Night Shift Porter', short: 'Porter', price: 20, effect: 'stealth'},
  beer_bock: {id: 'beer_bock', name: 'Second Supper Bock', short: 'Bock', price: 40, effect: 'overfill'},
} as const satisfies Readonly<Record<string, BeerSpec>>;

export type BeerId = keyof typeof BEERS;
export const BEER_IDS = Object.keys(BEERS) as BeerId[];
export const isBeer = (id: string): id is BeerId => Object.prototype.hasOwnProperty.call(BEERS, id);

/** The user's numbers. */
export const BEER_TUNING = {
  /** A timed beer lasts this many ACTIVE gameplay seconds (10 minutes). */
  activeSeconds: 600,
  /** Express Line Lager: the player's ground movement x this (one multiplier in the shared movement path). */
  speedMult: 1.25,
  /** Lucky Switch Pilsner: the chance a NEW legitimate pickup source duplicates (rolled once per source). */
  pickupDupChance: 0.1,
  /** Ironclad Stout: +5 temporary armour pips = 0.125 absolute armour fraction (one pip = 0.025). */
  tempArmor: 0.125,
  /** Night Shift Porter: one shared perception / detection modifier (25 % harder to detect). */
  perceptionMult: 0.75,
  /** Second Supper Bock: food AND water are SET to this (percent; the green overfill above 100). */
  overfill: 200,
} as const;
