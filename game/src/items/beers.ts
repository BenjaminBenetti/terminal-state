// Task studio-market-bar-20261108-225231-01: THE MARKET BAR'S BEERS — the shared contract (ids, names, prices, effects, tuning) between
// the bar (its bartender's finite stock, market/trade), the beer effects (market/beer: the one timed buff slot, the instant overfill) and
// the HUD. The item definitions themselves (ItemDef: model, icon, use) are the BEER lane's, built on these ids.
//
// The seam also carries the MINIMAL item data (defs with a placeholder icon, dims, the fixed price via market/trade/value.ts) so the bar's
// stock can be seeded and priced before the BEER lane lands the model, icon, label art and the effects (drinking does nothing until then).
//
// User (final answers): four TIMED beers (10 active minutes each; only one at a time — drinking another, the same one included, makes the
// player throw up, then the NEW one replaces the old) and one INSTANT beer (Second Supper Bock: sets food AND water to 200 %, not a buff).

import type {ItemDef, ItemDims} from './items';

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

const BEER_TEXT: Readonly<Record<BeerId, string>> = {
  beer_lager: 'A cold-ish lager from the market bar. For ten minutes your legs move faster (+25 % ground speed). One beer buff at a time.',
  beer_pilsner: 'A pale pilsner from the market bar. For ten minutes, now and then a new find turns out to be two. One beer buff at a time.',
  beer_stout: 'A heavy stout from the market bar. For ten minutes you shrug hits off: +5 armour pips. One beer buff at a time.',
  beer_porter: 'A dark porter from the market bar. For ten minutes you are harder to notice (25 %). One beer buff at a time.',
  beer_bock: 'A thick, filling bock: sets food and water to 200 %. Not a timed buff; it goes with any other beer.',
};

/** (seam: minimal) The beers' item definitions — the BEER lane replaces the placeholder icon and adds the drink's effects. */
export const BEER_ITEMS: Record<string, ItemDef> = Object.fromEntries(BEER_IDS.map(id => [id, {
  id, name: BEERS[id].name, short: BEERS[id].short, kind: 'consumable', stackMax: 6, useTime: 2.0, verb: 'drink', icon: 'cola',
  description: BEER_TEXT[id],
} satisfies ItemDef]));

/** A 330 ml long-neck bottle, standing (the BEER lane's model sets the measured bounds). */
export const BEER_DIMS: Record<string, ItemDims> = Object.fromEntries(BEER_IDS.map(id => [id, {w: 0.062, d: 0.062, h: 0.235, shape: 'cylinder'} satisfies ItemDims]));
