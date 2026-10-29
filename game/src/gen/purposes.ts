// ROOM / STORE PURPOSE REGISTRY (iteration 05, Lane R) — pure data, level-generic.
//
// User (iteration 05): "less of the same items randomly arranged in rooms and more like each room
// has a purpose and makes sense (staff room, janitor closet, news stand, hotdog stand, tech store,
// gun locker …)", "the stores' name better matches the items in it", "make sure the code is
// generic, we will be building out so many cool levels".
//
// Every room and store a level generates is filled from a PURPOSE: what it is called (fictional
// name pools, signage colours, menu boards), which fixtures it gets and where they stand
// (placement rules: against the far/side/door wall, rows along a wall, centre islands with a
// walkway ring, back-to-back aisles; door clearances and access strips are enforced by the
// dressing executors), what can be found in it (loot table per holder kind; floor supplies), how
// it is lit (lighting odds hint; Lane L renders) and which structural slots / frontages it may
// occupy. Nothing here names a station: a new level reuses this registry (or adds purposes) and
// only supplies room slots / storefront frontages.
//
// Consumers: gen/stationDress.ts (back-of-house assignment + executor, floor supplies, lighting),
// gen/storefronts.ts (store choice per frontage, store layouts), items/loot.ts (holder contents),
// world/storefrontBuilder.ts (menus), qa.ts / tests.

import type {PropKind} from './props';
import {isP7Kind} from './props07';
import type {StockTheme} from './purposeShapes';
import type {Wing} from './stationKit';
import type {AreaKind, RoomType, ShopUse} from './stationTypes';

// ---------------------------------------------------------------------------------------
// Types

/** [itemId, weight] — itemId must exist in items/items.ts (tests check). */
export type LootRow = readonly [itemId: string, weight: number];
export interface LootSpec {
  items: readonly LootRow[];
  /** Lot count range (default: per holder kind, items/loot.ts LOT_COUNT). */
  lots?: readonly [number, number];
  /** Chance the holder is empty (default: per holder kind). */
  empty?: number;
}
/** Loot per holder kind (`default` for any other holder kind in the room). */
export type LootTable = Readonly<Partial<Record<PropKind | 'default', LootSpec>>>;
export type LightOdds = readonly [lit: number, dim: number, dark: number];
/** Loose floor supplies (stationDress placeSpawns): relative weight of the room per category. */
export type FloorLoot = Readonly<Partial<Record<'ammo' | 'med', number>>>;
/**
 * Iteration 12 (LOOT lane): what a room / store is for, for the scarce-resource economy (items/lootEconomy.ts): security → ammo
 * (sometimes flares / torch batteries), medical → dressings / first-aid kits, food → food and drink, service → batteries and
 * flares, tech → batteries, personal → a bit of everything, public → sparse random. A SOFT weight: every room keeps some
 * off-theme random finds (ammo is never excluded anywhere). Rooms without a purpose map by room type (lootEconomy THEME_OF_TYPE).
 */
export type LootTheme = 'security' | 'medical' | 'food' | 'service' | 'tech' | 'personal' | 'public';

/** Which wall, relative to the room's main door. */
export type WallSel = 'far' | 'side' | 'near' | 'any';
/**
 * Placement rule. wall: back to a wall (random spot); row: side by side along one wall; center:
 * island in the middle with `ring` m of walkway kept clear around it; aisle: back-to-back pair
 * down the middle (stock rooms). Rules run in order; `n` is drawn per rule.
 */
export interface PropRule {
  kind: PropKind;
  at: 'wall' | 'row' | 'center' | 'aisle';
  wall?: WallSel;
  n: readonly [number, number];
  /** Probability the rule applies at all. */
  chance?: number;
  /** Clear access strip in front of the prop (m). */
  front?: number;
  /** Walkway kept around a centre island (m). */
  ring?: number;
  /** Shape variant; 'stock' = the purpose's stock theme. */
  variant?: number | 'stock';
  /** Mounting height (wall boards). */
  y?: number;
}

/** Backlit menu board graphic (fictional, generic; world/purposeTextures.ts draws it). */
export interface MenuSpec {
  name: string;
  tag: string;
  bg: string; fg: string; accent: string; band: string;
  sections: readonly (readonly [title: string, items: readonly (readonly [name: string, price: string])[]])[];
  /** Food-photo palette. */
  food: readonly string[];
}

interface PurposeBase {
  id: string;
  /** Area label (HUD location line). */
  label: string;
  loot: LootTable;
  floor?: FloorLoot;
  /** Iteration 12 (LOOT lane): resource theme of the place (soft room-purpose weights, items/lootEconomy.ts). */
  theme: LootTheme;
  /** Lighting odds hint [lit, dim, dark] (overrides the room-type default). */
  light?: LightOdds;
  /** Fixtures read warm in this room. */
  warm?: boolean;
  /** Stock theme for its stock shelves. */
  stock?: StockTheme;
}

export interface RoomPurpose extends PurposeBase {
  category: 'back';
  /** Structural room types (generator slots) it may fill, and area kinds. */
  slots: readonly RoomType[];
  kinds: readonly AreaKind[];
  /** Minimum interior size, metres [short side, long side]. */
  min?: readonly [number, number];
  /** Weight multiplier when the room sits in that back-of-house wing. */
  wings?: Readonly<Partial<Record<Wing, number>>>;
  weight: number;
  /** At most this many per level (default 2). */
  max?: number;
  /**
   * Iteration 07 (Lane P2): purpose built around generated props (gen/props07.ts) — eligible only when at least one of these
   * signature kinds is integrated (its model exists), so a level never gets an empty "workshop".
   */
  requires?: readonly string[];
  /** Assigned first (one per level) when a fitting slot exists. */
  required?: boolean;
  props: readonly PropRule[];
}

export type StoreLayout = 'food' | 'aisles' | 'newsstand' | 'showroom' | 'service' | 'florist';
export type FrontageMix = 'food' | 'retail' | 'kiosk';

export interface StorePurpose extends PurposeBase {
  id: ShopUse;
  category: 'food' | 'retail';
  /** Fictional brand names. */
  names: readonly string[];
  colors: readonly number[];
  /** Frontage width and depth ranges (cells). */
  w: readonly [number, number];
  d: readonly [number, number];
  glazed: boolean;
  /** Frontage mixes it appears in, with weights. */
  mixes: Readonly<Partial<Record<FrontageMix, number>>>;
  layout: StoreLayout;
  /** Chance per counter module of a countertop display case. */
  display?: number;
  /** Chance of a drinks cooler. */
  cooler?: number;
  /** Kitchen line modules along the back wall, cycled ([kind, shape variant]). */
  kitchen?: readonly (readonly [PropKind, number])[];
  /** Extra fixtures inside the unit (side walls / beside the till). */
  extras?: readonly PropRule[];
  menu?: MenuSpec;
}

export type Purpose = RoomPurpose | StorePurpose;

// ---------------------------------------------------------------------------------------
// Shared loot rows

const DRINKS: LootSpec = {items: [['water', 3], ['cola', 3], ['juice', 2]], lots: [3, 7], empty: 0.12};
const SNACKS: LootSpec = {items: [['chocolate', 3], ['chips', 3]], lots: [2, 4], empty: 0.15};
const TILL = (items: readonly LootRow[], empty = 0.45): LootSpec => ({items, lots: [1, 2], empty});
const KITCHEN = (items: readonly LootRow[]): LootSpec => ({items, lots: [1, 3], empty: 0.35});

const menu = (name: string, tag: string, colors: [string, string, string, string], sections: MenuSpec['sections'], food: string[]): MenuSpec =>
  ({name, tag, bg: colors[0], fg: colors[1], accent: colors[2], band: colors[3], sections, food});

// ---------------------------------------------------------------------------------------
// Stores (storefront units). Ids are the ShopUse values carried by Storefront.use.

export const STORE_PURPOSES: Readonly<Record<ShopUse, StorePurpose>> = {
  burger: {
    id: 'burger', category: 'food', theme: 'food', label: 'Burger counter', names: ['Big Ray\'s Burgers', 'Union Grill', 'Flat Top Burger', 'Burger Depot'], colors: [0xc0392b, 0xd9a520],
    w: [10, 14], d: [8, 11], glazed: false, mixes: {food: 1}, layout: 'food', display: 0, cooler: 0.6,
    kitchen: [['grillLine', 0], ['shopBackbar', 0]],
    menu: menu('GRILL & FRIES', 'COMBOS SERVED WITH FRIES + DRINK', ['#1c1e20', '#efe6cf', '#d9a520', '#a8362b'],
      [['BURGERS', [['Classic Burger', '6.49'], ['Cheeseburger', '6.99'], ['Double Stack', '8.79'], ['Veggie Burger', '6.99']]], ['SIDES', [['Fries', '2.99'], ['Onion Rings', '3.49']]], ['SHAKES', [['Vanilla', '3.99'], ['Chocolate', '3.99']]]],
      ['#8a4a26', '#d9a23a', '#6e8a3a', '#b8402e']),
    loot: {shopCounter: TILL([['chips', 2], ['cola', 1]]), grillLine: KITCHEN([['chips', 2], ['beans', 0.6]]), shopBackbar: KITCHEN([['chips', 1], ['cola', 1], ['water', 0.5]]), shopCooler: DRINKS},
  },
  pizza: {
    id: 'pizza', category: 'food', theme: 'food', label: 'Pizza counter', names: ['Napoli Slice', 'Tony\'s Pizza', 'Two Bros Slice', 'Pizza Pronto'], colors: [0x2e7d32, 0xb71c1c],
    w: [10, 13], d: [8, 11], glazed: false, mixes: {food: 1}, layout: 'food', display: 0.8, cooler: 0.6,
    kitchen: [['pizzaOven', 0], ['shopBackbar', 0]],
    menu: menu('SLICE STOP', 'BY THE SLICE OR WHOLE PIE', ['#1f2225', '#f2ead6', '#c2463a', '#2f7a78'],
      [['SLICES', [['Cheese Slice', '3.25'], ['Pepperoni Slice', '3.75'], ['Veggie Slice', '3.75'], ['Two Slices + Soda', '7.99']]], ['WHOLE PIES', [['Large Cheese', '16.99'], ['Large Pepperoni', '18.99']]], ['SIDES', [['Garlic Knots (4)', '2.99'], ['Caesar Salad', '5.49']]]],
      ['#d9a23a', '#b8402e', '#e8c87a', '#6a8a3a']),
    loot: {shopCounter: TILL([['cola', 1], ['chips', 1]]), shopDisplay: TILL([['chips', 1], ['chocolate', 0.5]], 0.4), shopBackbar: KITCHEN([['beans', 1], ['water', 0.6]]), shopCooler: DRINKS},
  },
  coffee: {
    id: 'coffee', category: 'food', theme: 'food', label: 'Coffee bar', names: ['Daily Grind', 'Timberline Coffee', 'Second Cup Co.', 'Platform Espresso'], colors: [0x6d4c41, 0x1b5e20],
    w: [8, 11], d: [7, 10], glazed: false, mixes: {food: 1, retail: 1, kiosk: 1.5}, layout: 'food', display: 0.7, cooler: 0.7,
    kitchen: [['espressoBar', 0], ['shopBackbar', 0]],
    menu: menu('COFFEE · ESPRESSO', 'FRESH BREWED · BAKED DAILY', ['#25352f', '#efe6cf', '#c99a2e', '#c99a2e'],
      [['COFFEE', [['Regular Coffee', '1.85'], ['Latte', '3.95'], ['Cappuccino', '3.75'], ['Americano', '2.95']]], ['BAKERY', [['Bagel + Cream Cheese', '2.75'], ['Blueberry Muffin', '2.49'], ['Croissant', '2.25']]], ['COLD', [['Iced Coffee', '3.25'], ['Orange Juice', '2.79']]]],
      ['#5a3a22', '#d9b06a', '#3a2a1e', '#c9a46a']),
    loot: {shopCounter: TILL([['chocolate', 2], ['juice', 1]]), shopDisplay: TILL([['chocolate', 2]], 0.35), espressoBar: KITCHEN([['water', 1], ['chocolate', 1], ['juice', 0.5]]), shopBackbar: KITCHEN([['water', 1], ['juice', 0.6]]), shopCooler: {items: [['juice', 2], ['water', 2], ['cola', 1]], lots: [3, 6], empty: 0.15}},
  },
  donut: {
    id: 'donut', category: 'food', theme: 'food', label: 'Donut shop', names: ['Honey Dip Donuts', 'Crullers & Co.', 'Dough Bros', 'Glaze Donuts'], colors: [0xd81b60, 0xef6c00],
    w: [8, 11], d: [7, 10], glazed: false, mixes: {food: 1, retail: 0.6, kiosk: 0.8}, layout: 'food', display: 0.95, cooler: 0.5,
    kitchen: [['espressoBar', 0]],
    extras: [{kind: 'breadRack', at: 'wall', wall: 'side', n: [1, 1], variant: 1, front: 0.9}],
    menu: menu('DONUTS & COFFEE', 'GLAZED FRESH EVERY MORNING', ['#f4e6ea', '#3a2228', '#d81b60', '#d81b60'],
      [['DONUTS', [['Honey Glazed', '1.59'], ['Boston Cream', '1.89'], ['Chocolate Dip', '1.69'], ['Dozen Box', '12.99']]], ['CRULLERS', [['Old Fashioned', '1.79'], ['French Cruller', '1.99']]], ['COFFEE', [['Regular', '1.85'], ['Iced Capp', '3.29']]]],
      ['#e8b06a', '#7a3a22', '#f0d0dc', '#c9842a']),
    loot: {shopCounter: TILL([['chocolate', 2], ['juice', 1]]), shopDisplay: TILL([['chocolate', 2]], 0.3), espressoBar: KITCHEN([['water', 1], ['chocolate', 1]]), shopCooler: {items: [['juice', 2], ['water', 2], ['cola', 1]], lots: [3, 6], empty: 0.15}},
  },
  bakery: {
    id: 'bakery', category: 'food', theme: 'food', label: 'Bakery', names: ['Hearth Bakery', 'Rise & Crust', 'Patisserie Lumière'], colors: [0x8d6e63, 0xfbe9e7],
    w: [8, 11], d: [7, 10], glazed: false, mixes: {food: 1, retail: 0.5}, layout: 'food', display: 0.95, cooler: 0.5,
    kitchen: [['shopBackbar', 0]],
    extras: [{kind: 'breadRack', at: 'wall', wall: 'side', n: [1, 2], variant: 0, front: 0.9}],
    menu: menu('BAKERY', 'BAKED ON SITE', ['#efe4d2', '#2a2522', '#8d5a3a', '#6d4c41'],
      [['BREAD', [['Sourdough Loaf', '5.50'], ['Baguette', '3.25'], ['Rye', '4.75']]], ['PASTRY', [['Croissant', '2.25'], ['Pain au Chocolat', '2.75'], ['Scone', '2.50']]], ['CAKES', [['Carrot Cake Slice', '4.25'], ['Cheesecake Slice', '4.75']]]],
      ['#c98a4a', '#e8c88a', '#8a5a2a', '#f0e0c0']),
    loot: {shopCounter: TILL([['juice', 1], ['water', 1]]), shopDisplay: TILL([['chocolate', 2]], 0.3), shopBackbar: KITCHEN([['water', 1], ['chocolate', 0.6]]), shopCooler: {items: [['juice', 3], ['water', 2]], lots: [3, 6], empty: 0.15}},
  },
  noodles: {
    id: 'noodles', category: 'food', theme: 'food', label: 'Noodle counter', names: ['Golden Wok', 'Pho Express', 'Noodle Box', 'Lucky Dragon'], colors: [0xc62828, 0xf9a825],
    w: [10, 14], d: [8, 11], glazed: false, mixes: {food: 1}, layout: 'food', display: 0.2, cooler: 0.6,
    kitchen: [['wokLine', 0], ['wokLine', 0]],
    menu: menu('NOODLE BAR', 'WOK FRESH · ALL DAY', ['#efe6d0', '#2a2522', '#a8362b', '#2a2522'],
      [['NOODLES', [['Lo Mein', '8.25'], ['Pad Noodle', '8.95'], ['Beef Noodle Soup', '9.50']]], ['RICE', [['Fried Rice', '7.75'], ['Teriyaki Bowl', '8.95']]], ['SMALL PLATES', [['Dumplings (6)', '5.50'], ['Spring Rolls (2)', '3.25']]]],
      ['#c98a3a', '#e8d6a8', '#6a8a3a', '#a8362b']),
    loot: {shopCounter: TILL([['noodles', 2], ['cola', 1]]), wokLine: KITCHEN([['noodles', 3], ['water', 0.6]]), shopDisplay: TILL([['noodles', 1]]), shopCooler: DRINKS},
  },
  sushi: {
    id: 'sushi', category: 'food', theme: 'food', label: 'Sushi counter', names: ['Sushi Station', 'Maki Go', 'Kaiten Express'], colors: [0x263238, 0xe53935],
    w: [9, 12], d: [8, 10], glazed: false, mixes: {food: 1}, layout: 'food', display: 0.9, cooler: 0.6,
    kitchen: [['deliLine', 0], ['wokLine', 0]],
    menu: menu('SUSHI & BENTO', 'ROLLED TO ORDER', ['#1c2226', '#f0ece4', '#e53935', '#e53935'],
      [['ROLLS', [['California Roll', '6.95'], ['Spicy Tuna', '7.95'], ['Veggie Roll', '5.95']]], ['BENTO', [['Teriyaki Bento', '11.50'], ['Salmon Bento', '12.50']]], ['SIDES', [['Miso Soup', '2.25'], ['Edamame', '3.50']]]],
      ['#e8e4dc', '#e85a3a', '#3a5a3a', '#f0b04a']),
    loot: {shopCounter: TILL([['water', 1], ['noodles', 1]]), shopDisplay: TILL([['noodles', 1]], 0.4), deliLine: KITCHEN([['water', 1], ['noodles', 1]]), wokLine: KITCHEN([['noodles', 2]]), shopCooler: {items: [['water', 3], ['juice', 1], ['cola', 1]], lots: [3, 6], empty: 0.15}},
  },
  deli: {
    id: 'deli', category: 'food', theme: 'food', label: 'Deli counter', names: ['Carver St. Deli', 'Hero Subs', 'Midtown Deli', 'Corned Beef Co.'], colors: [0x1565c0, 0xf5f5f0],
    w: [9, 13], d: [8, 11], glazed: false, mixes: {food: 1, retail: 0.5}, layout: 'food', display: 0.9, cooler: 0.7,
    kitchen: [['deliLine', 0], ['shopBackbar', 0]],
    menu: menu('DELI · SUBS', 'SLICED TO ORDER', ['#f2efe6', '#1d2a3a', '#1565c0', '#1565c0'],
      [['SANDWICHES', [['Corned Beef', '9.25'], ['Turkey Club', '8.75'], ['Italian Sub', '8.95']]], ['SOUP', [['Soup of the Day', '4.25'], ['Chili', '4.95']]], ['SIDES', [['Chips', '1.75'], ['Pickle', '0.99']]]],
      ['#c98a6a', '#e8d8b8', '#6a8a3a', '#b8402e']),
    loot: {shopCounter: TILL([['chips', 2]]), shopDisplay: TILL([['chips', 1], ['beans', 0.5]], 0.4), deliLine: KITCHEN([['beans', 1], ['chips', 1]]), shopBackbar: KITCHEN([['chips', 1], ['water', 0.6]]), shopCooler: DRINKS},
  },
  juice: {
    id: 'juice', category: 'food', theme: 'food', label: 'Juice bar', names: ['Squeeze Juice Bar', 'Green Line Juice', 'Fresh Press'], colors: [0x7cb342, 0xff8f00],
    w: [7, 10], d: [6, 9], glazed: false, mixes: {food: 1, retail: 0.4}, layout: 'food', display: 0.4, cooler: 0.9,
    kitchen: [['blenderBar', 0]],
    menu: menu('JUICE · SMOOTHIES', 'PRESSED FRESH', ['#f2f4e6', '#223018', '#7cb342', '#ff8f00'],
      [['JUICES', [['Orange Squeeze', '4.95'], ['Green Machine', '5.95'], ['Carrot Ginger', '5.45']]], ['SMOOTHIES', [['Berry Blast', '5.95'], ['Mango Tango', '5.95']]], ['BOWLS', [['Acai Bowl', '8.95']]]],
      ['#ff8f00', '#7cb342', '#d84a6a', '#f0c040']),
    loot: {shopCounter: TILL([['juice', 1], ['water', 1]]), blenderBar: KITCHEN([['juice', 2], ['water', 1]]), shopDisplay: TILL([['juice', 1]]), shopCooler: {items: [['juice', 4], ['water', 2]], lots: [3, 7], empty: 0.1}},
  },
  shawarma: {
    id: 'shawarma', category: 'food', theme: 'food', label: 'Shawarma grill', names: ['Shawarma King', 'Cedar Grill', 'Pita Pit Stop'], colors: [0xf57f17, 0x4e342e],
    w: [9, 12], d: [8, 11], glazed: false, mixes: {food: 1}, layout: 'food', display: 0.6, cooler: 0.6,
    kitchen: [['grillLine', 1], ['shopBackbar', 0]],
    menu: menu('SHAWARMA · FALAFEL', 'WRAPS · PLATES · POUTINE', ['#2a2018', '#f2e8d6', '#f57f17', '#f57f17'],
      [['WRAPS', [['Chicken Shawarma', '8.95'], ['Beef Shawarma', '9.45'], ['Falafel Wrap', '7.95']]], ['PLATES', [['Chicken Plate', '13.95'], ['Mixed Plate', '15.45']]], ['SIDES', [['Garlic Potatoes', '4.25'], ['Hummus', '3.95']]]],
      ['#c98a3a', '#e8d6a8', '#6a8a3a', '#d9a23a']),
    loot: {shopCounter: TILL([['chips', 1], ['cola', 1]]), grillLine: KITCHEN([['beans', 1], ['chips', 1]]), shopDisplay: TILL([['chips', 1]]), shopBackbar: KITCHEN([['water', 1], ['beans', 0.6]]), shopCooler: DRINKS},
  },
  hotdog: {
    id: 'hotdog', category: 'food', theme: 'food', label: 'Hot-dog stand', names: ['Top Dog Stand', 'Frank\'s Franks', 'Ballpark Dogs', 'Union Dogs'], colors: [0xe53935, 0xfbc02d],
    w: [6, 9], d: [5, 8], glazed: false, mixes: {food: 0.8, retail: 0.7, kiosk: 1.2}, layout: 'food', display: 0, cooler: 0.85,
    kitchen: [['grillLine', 2]],
    extras: [{kind: 'snackRack', at: 'wall', wall: 'side', n: [1, 1], front: 0.8}],
    menu: menu('HOT DOGS', 'ALL BEEF · STEAMED BUNS', ['#2a1c1a', '#f6eed8', '#fbc02d', '#e53935'],
      [['DOGS', [['Classic Dog', '3.49'], ['Chili Cheese Dog', '4.79'], ['Jumbo Smokie', '4.99'], ['Two Dogs + Soda', '7.99']]], ['SIDES', [['Chips', '1.75'], ['Pretzel', '2.99']]], ['DRINKS', [['Fountain Soda', '1.99'], ['Bottled Water', '1.79']]]],
      ['#c0602a', '#e8c06a', '#d84a2a', '#e8d080']),
    loot: {shopCounter: TILL([['chips', 1], ['cola', 1]]), grillLine: KITCHEN([['chips', 2], ['cola', 1]]), snackRack: SNACKS, hotdogCart: {items: [['chips', 2], ['cola', 2], ['water', 1]], lots: [2, 4], empty: 0.2}, shopCooler: {items: [['cola', 3], ['water', 2]], lots: [3, 6], empty: 0.15}},
  },
  convenience: {
    id: 'convenience', category: 'retail', theme: 'food', label: 'Convenience store', names: ['Metro Mart', 'Express Variety', '24/7 Convenience', 'QuickStop', 'Corner Mart'], colors: [0xe53935, 0x1e88e5, 0x43a047],
    w: [10, 16], d: [10, 14], glazed: true, mixes: {retail: 2.2, kiosk: 1}, layout: 'aisles', cooler: 1, stock: 'grocery',
    loot: {stockShelf: {items: [['chips', 3], ['chocolate', 3], ['beans', 2], ['noodles', 2]], lots: [2, 5], empty: 0.1}, shopCooler: DRINKS, shopCounter: TILL([['chocolate', 2], ['chips', 1]], 0.4), snackRack: SNACKS},
  },
  newsstand: {
    id: 'newsstand', category: 'retail', theme: 'food', label: 'Newsstand', names: ['News & Gifts', 'Lakeshore News', 'Transit Smoke & News', 'Headlines'], colors: [0x283593, 0xc62828],
    w: [6, 9], d: [5, 7], glazed: false, mixes: {retail: 1.6, kiosk: 2}, layout: 'newsstand', cooler: 0.8, stock: 'snacks',
    loot: {
      stockShelf: {items: [['chocolate', 3], ['chips', 3]], lots: [2, 4], empty: 0.15}, snackRack: SNACKS, shopCounter: TILL([['chocolate', 2]], 0.4),
      shopCooler: {items: [['water', 3], ['cola', 3], ['juice', 1]], lots: [3, 6], empty: 0.15},
      // Freestanding hall kiosk (the newsstand stall prefab).
      stall: {items: [['chocolate', 3], ['chips', 3], ['water', 1], ['cola', 1]], lots: [2, 5], empty: 0.1},
    },
  },
  pharmacy: {
    id: 'pharmacy', category: 'retail', theme: 'medical', label: 'Pharmacy', names: ['Station Pharmacy', 'Rexton Drug Mart', 'Shoppers Rx'], colors: [0xc62828, 0x00897b],
    w: [12, 16], d: [10, 14], glazed: true, mixes: {retail: 0.9}, layout: 'aisles', cooler: 0.4, stock: 'pharmacy',
    extras: [{kind: 'medCabinet', at: 'wall', wall: 'far', n: [1, 2], front: 0.9}],
    loot: {stockShelf: {items: [['bandage', 3], ['medkit', 0.5], ['water', 0.4]], lots: [1, 4], empty: 0.2}, medCabinet: {items: [['bandage', 3], ['medkit', 1]], lots: [1, 3], empty: 0.2}, shopCounter: TILL([['bandage', 1], ['medkit', 0.25]], 0.5), shopCooler: {items: [['water', 3], ['juice', 1]], lots: [2, 5], empty: 0.2}},
    floor: {med: 1.2},
  },
  florist: {
    id: 'florist', category: 'retail', theme: 'public', label: 'Florist', names: ['Bloom Florist', 'Union Flowers', 'Petal & Stem'], colors: [0x2e7d32, 0xad1457],
    w: [6, 9], d: [6, 8], glazed: true, mixes: {retail: 0.6}, layout: 'florist',
    loot: {shopCounter: TILL([['water', 1]], 0.7)},
  },
  phone: {
    id: 'phone', category: 'retail', theme: 'tech', label: 'Phone repair', names: ['Cell Fix', 'Phone Repair & Cases', 'Mobile Hub'], colors: [0x1e88e5, 0x212121],
    w: [6, 9], d: [6, 8], glazed: true, mixes: {retail: 0.8}, layout: 'service', stock: 'devices',
    extras: [{kind: 'repairBench', at: 'wall', wall: 'far', n: [1, 1], variant: 1, front: 0.9}, {kind: 'deviceWall', at: 'wall', wall: 'side', n: [1, 2], front: 0.9}],
    loot: {shopCounter: TILL([['cola', 1], ['chocolate', 1]], 0.7)},
  },
  keys: {
    id: 'keys', category: 'retail', theme: 'tech', label: 'Key cutting & shoe repair', names: ['Keys · Shoe Repair', 'Kwik Key', 'Heel & Key'], colors: [0x6a1b9a, 0x455a64],
    w: [5, 7], d: [5, 7], glazed: false, mixes: {retail: 0.6, kiosk: 0.5}, layout: 'service', stock: 'parts',
    extras: [{kind: 'repairBench', at: 'wall', wall: 'far', n: [1, 1], variant: 0, front: 0.9}],
    loot: {shopCounter: TILL([['water', 1], ['chocolate', 1]], 0.7), stockShelf: {items: [['water', 1]], lots: [0, 1], empty: 0.8}},
  },
  tech: {
    id: 'tech', category: 'retail', theme: 'tech', label: 'Electronics store', names: ['Volt Mobile', 'PixelPoint', 'Byte Box', 'Signal Tech'], colors: [0x00acc1, 0x212121, 0x7e57c2],
    w: [8, 12], d: [8, 11], glazed: true, mixes: {retail: 1}, layout: 'showroom', stock: 'devices',
    // Tills hold staff leftovers; iteration 12: the 'tech' theme turns most kept finds into torch batteries (items/lootEconomy.ts).
    loot: {shopCounter: TILL([['water', 1], ['cola', 1], ['chocolate', 1]], 0.6)},
  },
};

// ---------------------------------------------------------------------------------------
// Back-of-house rooms (and closets). `slots` = structural room types from the level generator.

const CACHE_CRATE: LootSpec = {items: [['ammo_rifle', 2], ['ammo_shells', 1.4], ['beans', 1], ['water', 1], ['bandage', 0.8]], lots: [1, 3], empty: 0.12};

export const ROOM_PURPOSES: Readonly<Record<string, RoomPurpose>> = {
  'staff-room': {
    id: 'staff-room', category: 'back', theme: 'food', label: 'Staff room', slots: ['crew-room', 'storage', 'utility'], kinds: ['room'], min: [4.5, 5],
    weight: 3, required: true, max: 2, light: [0.4, 0.45, 0.15], warm: true, wings: {north: 1.4, food: 1.2},
    props: [
      {kind: 'kitchenette', at: 'wall', wall: 'far', n: [1, 1], front: 0.9},
      {kind: 'fridge', at: 'wall', wall: 'any', n: [1, 1], front: 0.6},
      {kind: 'table', at: 'center', n: [1, 1], ring: 0.9},
      {kind: 'couch', at: 'wall', wall: 'side', n: [1, 1], chance: 0.7, front: 0.6},
      {kind: 'staffLockers', at: 'wall', wall: 'any', n: [1, 2], chance: 0.6, front: 0.8},
      {kind: 'noticeBoard', at: 'wall', wall: 'any', n: [1, 1], chance: 0.85, y: 1.1},
      {kind: 'vending', at: 'wall', wall: 'near', n: [1, 1], chance: 0.3, front: 1.0},
      {kind: 'bin', at: 'wall', wall: 'any', n: [1, 1]},
    ],
    loot: {
      fridge: {items: [['juice', 2], ['water', 2], ['cola', 2], ['beans', 0.8]], lots: [2, 5], empty: 0.15},
      kitchenette: {items: [['noodles', 2], ['chocolate', 1], ['beans', 1]], lots: [1, 3], empty: 0.25},
      table: {items: [['cola', 1], ['chocolate', 1], ['water', 0.5]], lots: [1, 2], empty: 0.5},
      vending: {items: [['chocolate', 2], ['chips', 2], ['cola', 2], ['water', 1]], lots: [3, 6], empty: 0.12},
    },
  },
  'locker-room': {
    id: 'locker-room', category: 'back', theme: 'personal', label: 'Crew locker room', slots: ['crew-room', 'storage'], kinds: ['room'], min: [4.5, 5],
    weight: 1.6, max: 1, light: [0.3, 0.5, 0.2], wings: {north: 1.5},
    props: [
      {kind: 'staffLockers', at: 'row', wall: 'far', n: [3, 5], front: 1.0},
      {kind: 'staffLockers', at: 'row', wall: 'side', n: [1, 3], chance: 0.6, front: 1.0},
      {kind: 'bench', at: 'center', n: [1, 2], ring: 0.8},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 1], chance: 0.7, front: 0.8},
      {kind: 'noticeBoard', at: 'wall', wall: 'near', n: [1, 1], chance: 0.5, y: 1.1},
    ],
    loot: {cabinetTall: {items: [['bandage', 2], ['water', 1], ['chocolate', 1], ['ammo_shells', 0.5]], lots: [2, 4], empty: 0.1}},
    floor: {med: 0.5, ammo: 0.4},
  },
  'first-aid-room': {
    id: 'first-aid-room', category: 'back', theme: 'medical', label: 'First-aid room', slots: ['crew-room', 'storage', 'utility'], kinds: ['room'], min: [4.5, 5],
    weight: 1.2, max: 1, light: [0.45, 0.45, 0.1],
    props: [
      {kind: 'medCabinet', at: 'row', wall: 'far', n: [1, 2], front: 0.9},
      {kind: 'washCounter', at: 'wall', wall: 'side', n: [1, 1], chance: 0.6, front: 0.6},
      {kind: 'couch', at: 'wall', wall: 'side', n: [1, 1], front: 0.7},
      {kind: 'desk', at: 'wall', wall: 'near', n: [1, 1], chance: 0.7, front: 0.7},
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], chance: 0.7, front: 0.7},
      {kind: 'bin', at: 'wall', wall: 'any', n: [1, 1]},
    ],
    loot: {
      medCabinet: {items: [['bandage', 3], ['medkit', 1]], lots: [1, 4], empty: 0.15},
      cabinetLow: {items: [['bandage', 2], ['water', 1], ['medkit', 0.3]], lots: [1, 3], empty: 0.2},
      desk: {items: [['water', 1], ['bandage', 1]], lots: [1, 1], empty: 0.5},
    },
    floor: {med: 2.4},
  },
  'security-office': {
    id: 'security-office', category: 'back', theme: 'security', label: 'Transit security office', slots: ['storage', 'utility', 'crew-room'], kinds: ['room'], min: [4.5, 5],
    weight: 1.4, required: true, max: 1, light: [0.35, 0.45, 0.2], wings: {agent: 2, north: 1.2},
    props: [
      {kind: 'gunLocker', at: 'wall', wall: 'far', n: [1, 1], front: 0.8},
      {kind: 'monitorDesk', at: 'wall', wall: 'side', n: [1, 1], front: 0.9},
      {kind: 'gunLocker', at: 'wall', wall: 'far', n: [1, 1], chance: 0.25, front: 0.8},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 2], front: 0.8},
      {kind: 'noticeBoard', at: 'wall', wall: 'any', n: [1, 1], chance: 0.6, y: 1.1},
      {kind: 'bench', at: 'wall', wall: 'near', n: [1, 1], chance: 0.35},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1], chance: 0.4},
    ],
    loot: {
      gunLocker: {items: [['ammo_rifle', 3], ['ammo_shells', 2.2], ['medkit', 0.3]], lots: [2, 4], empty: 0.08},
      monitorDesk: {items: [['cola', 1], ['chocolate', 1], ['ammo_shells', 0.5]], lots: [1, 2], empty: 0.4},
      cabinetTall: {items: [['ammo_rifle', 1.4], ['bandage', 1], ['medkit', 0.4], ['water', 0.6]], lots: [2, 4], empty: 0.1},
      crate: CACHE_CRATE,
    },
    floor: {ammo: 2.6, med: 0.6},
  },
  'electrical-room': {
    id: 'electrical-room', category: 'back', theme: 'service', label: 'Electrical room', slots: ['utility', 'storage'], kinds: ['room'], min: [4, 4.5],
    weight: 2.2, required: true, max: 2, light: [0.08, 0.4, 0.52], stock: 'parts',
    props: [
      {kind: 'electricalPanel', at: 'row', wall: 'far', n: [2, 4], front: 1.0},
      {kind: 'electricalPanel', at: 'wall', wall: 'side', n: [1, 1], chance: 0.5, front: 1.0},
      {kind: 'stockShelf', at: 'wall', wall: 'side', n: [1, 1], chance: 0.5, variant: 'stock', front: 0.8},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [0, 1], front: 0.8},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 2]},
    ],
    loot: {
      stockShelf: {items: [['water', 1], ['bandage', 1], ['ammo_rifle', 0.6]], lots: [1, 3], empty: 0.35},
      cabinetTall: {items: [['ammo_rifle', 1.2], ['ammo_shells', 0.8], ['bandage', 1], ['water', 0.6]], lots: [2, 4], empty: 0.1},
      crate: CACHE_CRATE,
    },
    floor: {ammo: 1.2, med: 0.4},
  },
  'signal-room': {
    id: 'signal-room', category: 'back', theme: 'service', label: 'Signal relay room', slots: ['utility', 'crew-room'], kinds: ['room'], min: [4, 4.5],
    weight: 1.4, max: 1, light: [0.12, 0.45, 0.43], wings: {north: 2.2, agent: 0.3, food: 0.2},
    props: [
      {kind: 'signalRack', at: 'row', wall: 'far', n: [2, 4], front: 1.0},
      {kind: 'signalRack', at: 'row', wall: 'side', n: [1, 2], chance: 0.5, front: 1.0},
      {kind: 'desk', at: 'wall', wall: 'near', n: [1, 1], front: 0.7},
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [0, 1], front: 0.7},
      {kind: 'noticeBoard', at: 'wall', wall: 'any', n: [1, 1], chance: 0.4, y: 1.1},
    ],
    loot: {
      desk: {items: [['cola', 1], ['chocolate', 1], ['water', 1]], lots: [1, 2], empty: 0.4},
      cabinetLow: {items: [['bandage', 1], ['ammo_rifle', 0.8], ['water', 1]], lots: [1, 3], empty: 0.15},
    },
    floor: {ammo: 0.8},
  },
  'storage': {
    id: 'storage', category: 'back', theme: 'service', label: 'Maintenance storage', slots: ['storage', 'utility'], kinds: ['room'],
    weight: 2, max: 2, light: [0.12, 0.45, 0.43], stock: 'parts',
    props: [
      {kind: 'stockShelf', at: 'row', wall: 'far', n: [2, 3], variant: 'stock', front: 0.8},
      {kind: 'shelf', at: 'wall', wall: 'side', n: [1, 2], front: 0.8},
      {kind: 'cartonStack', at: 'wall', wall: 'any', n: [1, 2]},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 2], front: 0.8},
      {kind: 'crate', at: 'wall', wall: 'any', n: [2, 4]},
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], chance: 0.4, front: 0.7},
    ],
    loot: {
      stockShelf: {items: [['water', 1], ['bandage', 1], ['beans', 0.6]], lots: [1, 3], empty: 0.3},
      shelf: {items: [['water', 1.4], ['beans', 1.2], ['bandage', 1], ['ammo_rifle', 0.8], ['ammo_shells', 0.6]], lots: [2, 5], empty: 0.1},
      cabinetTall: {items: [['ammo_rifle', 1.2], ['ammo_shells', 1], ['bandage', 1], ['medkit', 0.3], ['water', 1]], lots: [2, 5], empty: 0.08},
      cabinetLow: {items: [['bandage', 1], ['water', 1], ['beans', 1]], lots: [2, 4], empty: 0.1},
      crate: CACHE_CRATE,
    },
    floor: {ammo: 1.6, med: 1},
  },
  'stock-room': {
    id: 'stock-room', category: 'back', theme: 'food', label: 'Stock room', slots: ['stock-room'], kinds: ['room'],
    weight: 3, max: 6, light: [0.15, 0.45, 0.4], stock: 'cartons',
    // Shelving runs along two walls plus a back-to-back aisle (dressStockRoom), cartons and crates.
    props: [
      {kind: 'stockShelf', at: 'row', wall: 'far', n: [2, 3], variant: 'stock', front: 0.8},
      {kind: 'stockShelf', at: 'row', wall: 'side', n: [2, 3], variant: 'stock', front: 0.8},
      {kind: 'stockShelf', at: 'aisle', n: [2, 2], variant: 'stock', chance: 0.6, ring: 1.0},
      {kind: 'cartonStack', at: 'wall', wall: 'any', n: [1, 3]},
      {kind: 'crate', at: 'wall', wall: 'any', n: [1, 3]},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 1], chance: 0.3, front: 0.8},
    ],
    // Stock rooms behind the food court hold catering stock; the served shop's theme can override.
    loot: {
      stockShelf: {items: [['beans', 3], ['noodles', 3], ['chips', 2], ['water', 2], ['cola', 2], ['juice', 1]], lots: [2, 5], empty: 0.1},
      crate: {items: [['beans', 2], ['water', 2], ['noodles', 1], ['cola', 1]], lots: [1, 3], empty: 0.15},
      cabinetTall: {items: [['bandage', 1], ['water', 1], ['chocolate', 1]], lots: [1, 3], empty: 0.2},
    },
    floor: {med: 0.3},
  },
  'agent-office': {
    id: 'agent-office', category: 'back', theme: 'security', label: 'Station agent office', slots: ['agent-office'], kinds: ['room'],
    weight: 10, required: true, max: 1, light: [0.45, 0.4, 0.15],
    props: [
      {kind: 'desk', at: 'wall', wall: 'far', n: [1, 1], front: 0.7},
      {kind: 'safe', at: 'wall', wall: 'any', n: [1, 1], chance: 0.8, front: 0.6},
      {kind: 'cabinetTall', at: 'row', wall: 'side', n: [1, 2], front: 0.8},
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], front: 0.7},
      {kind: 'shelf', at: 'wall', wall: 'any', n: [1, 1], chance: 0.5, front: 0.8},
      {kind: 'noticeBoard', at: 'wall', wall: 'any', n: [1, 1], chance: 0.7, y: 1.1},
    ],
    loot: {
      desk: {items: [['cola', 1], ['chocolate', 1], ['water', 1]], lots: [1, 2], empty: 0.3},
      cabinetTall: {items: [['bandage', 1.4], ['medkit', 0.4], ['water', 1], ['ammo_shells', 0.5]], lots: [2, 4], empty: 0.1},
      cabinetLow: {items: [['chocolate', 1], ['water', 1], ['bandage', 1]], lots: [1, 3], empty: 0.15},
      shelf: {items: [['water', 1], ['bandage', 1]], lots: [1, 2], empty: 0.4},
    },
    floor: {med: 0.8, ammo: 0.5},
  },
  'janitor-closet': {
    id: 'janitor-closet', category: 'back', theme: 'service', label: 'Janitor closet', slots: ['janitor-closet', 'supply-closet'], kinds: ['closet'],
    weight: 2, required: true, max: 3, light: [0, 0.3, 0.7], warm: true, stock: 'cleaning',
    props: [
      {kind: 'mopSink', at: 'wall', wall: 'far', n: [1, 1], front: 0.6},
      {kind: 'stockShelf', at: 'wall', wall: 'side', n: [1, 1], variant: 'stock', front: 0.6},
      {kind: 'janitorCart', at: 'wall', wall: 'any', n: [1, 1], chance: 0.8},
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], chance: 0.3, front: 0.6},
    ],
    loot: {
      stockShelf: {items: [['water', 1], ['bandage', 0.6]], lots: [1, 2], empty: 0.45},
      cabinetLow: {items: [['bandage', 1], ['water', 1]], lots: [1, 2], empty: 0.3},
    },
    floor: {med: 0.4},
  },
  'supply-closet': {
    id: 'supply-closet', category: 'back', theme: 'medical', label: 'Supply closet', slots: ['supply-closet', 'janitor-closet'], kinds: ['closet'],
    weight: 1.6, max: 3, light: [0, 0.35, 0.65], stock: 'cartons',
    props: [
      {kind: 'stockShelf', at: 'wall', wall: 'far', n: [1, 2], variant: 'stock', front: 0.6},
      {kind: 'medCabinet', at: 'wall', wall: 'side', n: [1, 1], chance: 0.45, front: 0.6},
      {kind: 'cartonStack', at: 'wall', wall: 'any', n: [0, 1]},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 1], chance: 0.35, front: 0.6},
    ],
    loot: {
      stockShelf: {items: [['bandage', 1.5], ['water', 1.2], ['beans', 0.6], ['medkit', 0.2]], lots: [1, 3], empty: 0.2},
      medCabinet: {items: [['bandage', 3], ['medkit', 0.8]], lots: [1, 3], empty: 0.2},
      cabinetTall: {items: [['bandage', 1], ['water', 1], ['ammo_rifle', 0.6]], lots: [1, 3], empty: 0.15},
    },
    floor: {med: 1},
  },
  'electrical-closet': {
    id: 'electrical-closet', category: 'back', theme: 'service', label: 'Electrical closet', slots: ['supply-closet', 'janitor-closet'], kinds: ['closet'],
    weight: 0.9, max: 2, light: [0, 0.25, 0.75],
    props: [
      {kind: 'electricalPanel', at: 'row', wall: 'far', n: [1, 2], front: 0.8},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1]},
    ],
    loot: {crate: CACHE_CRATE},
    floor: {ammo: 0.6},
  },
  // --- Iteration 07 (Lane P2): rooms built around the NEW generated props (gen/props07.ts uses place the signature fixtures:
  // tool chest / bench grinder / pegboard, pumps / water heater / valve manifold, lost luggage, fare vault carts, bins / scrubbers).
  'workshop': {
    id: 'workshop', category: 'back', theme: 'service', label: 'Maintenance workshop', slots: ['storage', 'utility'], kinds: ['room'], min: [4, 4.5],
    weight: 1.5, max: 1, light: [0.15, 0.5, 0.35], stock: 'parts', wings: {north: 1.3, misc: 1.2},
    requires: ['rollingToolChest', 'benchGrinderStand', 'toolPegboard'],
    props: [
      {kind: 'shelf', at: 'wall', wall: 'side', n: [1, 1], front: 0.8},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [0, 1], front: 0.8},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 2]},
    ],
    loot: {
      shelf: {items: [['ammo_rifle', 1], ['ammo_shells', 0.8], ['bandage', 1], ['water', 1]], lots: [1, 3], empty: 0.25},
      cabinetTall: {items: [['ammo_rifle', 1.2], ['ammo_shells', 1], ['bandage', 1], ['water', 0.6]], lots: [2, 4], empty: 0.1},
      crate: CACHE_CRATE,
      default: {items: [['ammo_rifle', 1.2], ['ammo_shells', 1], ['bandage', 0.8], ['water', 0.6]], lots: [1, 3], empty: 0.25},
    },
    floor: {ammo: 1.2, med: 0.4},
  },
  'pump-room': {
    id: 'pump-room', category: 'back', theme: 'service', label: 'Pump room', slots: ['utility'], kinds: ['room'], min: [4, 4.5],
    weight: 1.2, max: 1, light: [0.05, 0.35, 0.6], requires: ['waterPumpSkid', 'waterHeaterTank', 'pipeValveManifold'],
    props: [
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], chance: 0.5, front: 0.7},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1]},
    ],
    loot: {
      cabinetLow: {items: [['bandage', 1], ['water', 1], ['ammo_rifle', 0.6]], lots: [1, 2], empty: 0.3},
      crate: CACHE_CRATE,
    },
    floor: {ammo: 0.6, med: 0.3},
  },
  'lost-property': {
    id: 'lost-property', category: 'back', theme: 'personal', label: 'Lost property office', slots: ['storage', 'crew-room'], kinds: ['room'], min: [4, 4.5],
    weight: 1.2, max: 1, light: [0.3, 0.5, 0.2], warm: true, requires: ['rollingSuitcase', 'duffelBag', 'babyStroller'],
    props: [
      {kind: 'shelf', at: 'row', wall: 'far', n: [1, 2], front: 0.8},
      {kind: 'desk', at: 'wall', wall: 'near', n: [1, 1], front: 0.7},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 1], chance: 0.5, front: 0.8},
    ],
    loot: {
      shelf: {items: [['water', 1], ['chocolate', 1], ['chips', 0.8], ['juice', 0.6], ['bandage', 0.8], ['cola', 0.6]], lots: [2, 4], empty: 0.15},
      desk: {items: [['chocolate', 1], ['water', 1]], lots: [1, 1], empty: 0.5},
      cabinetTall: {items: [['bandage', 1], ['medkit', 0.3], ['water', 1], ['ammo_shells', 0.4]], lots: [1, 3], empty: 0.15},
    },
    floor: {med: 0.5},
  },
  'revenue-room': {
    id: 'revenue-room', category: 'back', theme: 'security', label: 'Fare revenue room', slots: ['storage', 'utility', 'crew-room'], kinds: ['room'], min: [4, 4.5],
    weight: 1.0, max: 1, light: [0.3, 0.5, 0.2], wings: {agent: 2.5, north: 0.6}, requires: ['fareVaultCart'],
    props: [
      {kind: 'safe', at: 'wall', wall: 'far', n: [1, 2], front: 0.6},
      {kind: 'desk', at: 'wall', wall: 'side', n: [1, 1], front: 0.7},
      {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [1, 1], chance: 0.5, front: 0.8},
    ],
    loot: {
      desk: {items: [['cola', 1], ['chocolate', 1], ['ammo_shells', 0.4]], lots: [1, 2], empty: 0.4},
      cabinetTall: {items: [['ammo_rifle', 1.2], ['ammo_shells', 1], ['bandage', 0.8], ['medkit', 0.3]], lots: [2, 4], empty: 0.1},
    },
    floor: {ammo: 1.4, med: 0.4},
  },
  'custodial-room': {
    id: 'custodial-room', category: 'back', theme: 'service', label: 'Custodial & waste room', slots: ['storage', 'utility'], kinds: ['room'], min: [4, 4],
    weight: 1.2, max: 1, light: [0.05, 0.4, 0.55], stock: 'cleaning', requires: ['wheelieBin', 'floorScrubber', 'trashBagPile'],
    props: [
      {kind: 'stockShelf', at: 'wall', wall: 'side', n: [1, 1], variant: 'stock', front: 0.8},
      {kind: 'mopSink', at: 'wall', wall: 'far', n: [1, 1], chance: 0.6, front: 0.6},
    ],
    loot: {stockShelf: {items: [['water', 1], ['bandage', 0.6]], lots: [1, 2], empty: 0.4}},
    floor: {med: 0.3},
  },
  'washroom': {
    id: 'washroom', category: 'back', theme: 'public', label: 'Washroom', slots: ['washroom'], kinds: ['room'], weight: 1, max: 4,
    props: [], loot: {}, floor: {med: 0.6},
  },
  'service-corridor': {
    id: 'service-corridor', category: 'back', theme: 'service', label: 'Service corridor', slots: ['service-corridor'], kinds: ['service'], weight: 1, max: 99, stock: 'cartons',
    props: [
      {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [1, 1], chance: 0.4, front: 0.7},
      {kind: 'stockShelf', at: 'wall', wall: 'any', n: [1, 1], chance: 0.3, variant: 'stock', front: 0.8},
      {kind: 'cartonStack', at: 'wall', wall: 'any', n: [1, 1], chance: 0.3},
      {kind: 'janitorCart', at: 'wall', wall: 'any', n: [1, 1], chance: 0.15},
      {kind: 'crate', at: 'wall', wall: 'any', n: [0, 2]},
    ],
    loot: {
      cabinetLow: {items: [['water', 1], ['bandage', 1], ['ammo_rifle', 0.8], ['chips', 0.6]], lots: [1, 3], empty: 0.15},
      stockShelf: {items: [['water', 1], ['beans', 1], ['chips', 1]], lots: [1, 3], empty: 0.3},
      crate: CACHE_CRATE,
    },
    floor: {ammo: 0.7, med: 0.3},
  },
  // --- Iteration 16 (WORLD-GEN): OFFICE TOWER rooms (gen/office/*). Their slots are office room types only, so the subway's
  // back-of-house assignment never picks them; the office generator presets them per area (assignPurposes keeps presets).
  ...OFFICE_PURPOSES(),
};

export const ALL_PURPOSES: readonly Purpose[] = [...Object.values(STORE_PURPOSES), ...Object.values(ROOM_PURPOSES)];

export function purposeById(id: string | undefined): Purpose | undefined {
  if (!id) return undefined;
  return (STORE_PURPOSES as Record<string, StorePurpose>)[id] ?? ROOM_PURPOSES[id];
}

/**
 * Loot spec for a holder kind in a purpose: its own entry, else `default`, else every row the
 * purpose stocks anywhere (so an unplanned holder still only holds what fits the room).
 * Undefined when the purpose has no loot table at all (callers use the legacy room-type tables).
 */
export function purposeLoot(purposeId: string | undefined, holderKind: string): LootSpec | undefined {
  const p = purposeById(purposeId);
  if (!p) return undefined;
  const t = p.loot as Partial<Record<string, LootSpec>>;
  const own = t[holderKind] ?? t.default;
  if (own) return own;
  const rows = new Map<string, number>();
  for (const spec of Object.values(t)) for (const [id, w] of spec?.items ?? []) rows.set(id, (rows.get(id) ?? 0) + w);
  return rows.size ? {items: [...rows]} : undefined;
}

/** Uses that may appear on a frontage mix, with weights. */
export function storeChoices(mix: FrontageMix): [ShopUse, number][] {
  return Object.values(STORE_PURPOSES).filter(p => (p.mixes[mix] ?? 0) > 0).map(p => [p.id, p.mixes[mix]!] as [ShopUse, number]);
}

// ---------------------------------------------------------------------------------------
// Back-of-house assignment (pure; stationDress.ts calls it with the layout's rooms)

export interface RoomSlot { id: number; type: RoomType; kind: AreaKind; wing: Wing; wM: number; hM: number }

/**
 * Picks a purpose for every back-of-house slot: required purposes first (best-fitting slot),
 * then weighted picks with a strong repeat penalty so a level never feels like the same room
 * twice; respects slot types, size minimums, wing preferences and per-level caps. `preset`:
 * purposes already fixed on other areas (counted as used).
 */
export function assignRoomPurposes(slots: readonly RoomSlot[], rnd: () => number, preset?: ReadonlyMap<string, number>): Map<number, string> {
  const out = new Map<number, string>();
  // Iteration 08: purposes the generator already preset elsewhere count toward caps / required purposes.
  const used = new Map<string, number>(preset ?? []);
  const list = Object.values(ROOM_PURPOSES);
  const fits = (p: RoomPurpose, s: RoomSlot) => {
    if (!p.slots.includes(s.type) || !p.kinds.includes(s.kind)) return false;
    if (p.requires && !p.requires.some(isP7Kind)) return false;
    if ((used.get(p.id) ?? 0) >= (p.max ?? 2)) return false;
    if (p.min) { const a = Math.min(s.wM, s.hM), b = Math.max(s.wM, s.hM); if (a < p.min[0] || b < p.min[1]) return false; }
    return true;
  };
  const weight = (p: RoomPurpose, s: RoomSlot) => p.weight * (p.wings?.[s.wing] ?? 1) * Math.pow(0.22, used.get(p.id) ?? 0) * (p.slots[0] === s.type ? 1.5 : 1);
  const take = (p: RoomPurpose, s: RoomSlot) => { out.set(s.id, p.id); used.set(p.id, (used.get(p.id) ?? 0) + 1); };
  // Fixed-function slots keep their own purpose (agent office, stock rooms, washrooms, corridors).
  for (const s of slots) {
    const own = ROOM_PURPOSES[s.type];
    if (own && own.slots.length === 1 && own.slots[0] === s.type && fits(own, s)) take(own, s);
  }
  for (const p of list.filter(q => q.required)) {
    if (used.get(p.id)) continue;
    const cands = slots.filter(s => !out.has(s.id) && fits(p, s));
    if (!cands.length) continue;
    // Prefer the slot the purpose was designed for, then wing preference, then size.
    cands.sort((a, b) => weight(p, b) - weight(p, a) || b.wM * b.hM - a.wM * a.hM || a.id - b.id);
    take(p, cands[0]);
  }
  for (const s of slots) {
    if (out.has(s.id)) continue;
    const opts = list.filter(p => fits(p, s)).map(p => [p, weight(p, s)] as const).filter(o => o[1] > 0);
    if (!opts.length) {
      // Caps exhausted: fall back to any slot-compatible purpose (ignoring caps).
      const any = list.find(p => p.slots.includes(s.type) && p.kinds.includes(s.kind));
      if (any) take(any, s);
      continue;
    }
    const total = opts.reduce((a, o) => a + o[1], 0);
    let x = rnd() * total;
    let pick = opts[opts.length - 1][0];
    for (const [p, w] of opts) { x -= w; if (x < 0) { pick = p; break; } }
    take(pick, s);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Iteration 16 (WORLD-GEN): office tower purposes (gen/office/*). Hoisted: spread into ROOM_PURPOSES above.
//
// Same scarcity as the station (items/lootEconomy.ts keeps ~1 in 5 non-ammo entries): office holders are mostly empty —
// a desk drawer with a chocolate bar, a staff fridge with a bottle of water, the security office's ammo. Limb treatments
// come through the economy's med finds (lane INJURY). Furniture the generator places itself (cubicles, the reception desk,
// conference tables) is not listed here; `props` are the purpose rules the station dresser runs (gen/stationDress.ts).

function OFFICE_PURPOSES(): Record<string, RoomPurpose> {
  const OPEN: readonly RoomType[] = ['office-open'];
  const ROOM: readonly RoomType[] = ['office-room'];
  const DESK: LootSpec = {items: [['chocolate', 1], ['water', 1], ['cola', 0.8], ['chips', 0.6], ['bandage', 0.4], ['juice', 0.3]], lots: [1, 1], empty: 0.62};
  const DRAWERS: LootSpec = {items: [['chocolate', 1], ['water', 0.8], ['bandage', 0.7], ['chips', 0.5], ['ammo_pistol', 0.25]], lots: [1, 2], empty: 0.35};
  return {
    'office-reception': {
      id: 'office-reception', category: 'back', theme: 'personal', label: 'Lobby', slots: ['office-lobby'], kinds: ['room'], weight: 1, max: 1,
      light: [0.4, 0.45, 0.15], props: [],
      loot: {desk: DESK, cabinetLow: DRAWERS, monitorDesk: {items: [['cola', 1], ['chocolate', 1], ['ammo_pistol', 0.4]], lots: [1, 2], empty: 0.4}},
      floor: {med: 0.3, ammo: 0.2},
    },
    'office-lobby': {
      id: 'office-lobby', category: 'back', theme: 'public', label: 'Lobby', slots: ['office-lobby'], kinds: ['room'], weight: 1, max: 9,
      light: [0.35, 0.5, 0.15], props: [], loot: {vending: {items: [['chocolate', 2], ['chips', 2], ['cola', 2], ['water', 1]], lots: [3, 6], empty: 0.15}},
      floor: {med: 0.2, ammo: 0.2},
    },
    'office-security': {
      id: 'office-security', category: 'back', theme: 'security', label: 'Building security office', slots: ROOM, kinds: ['room'], weight: 1, max: 1,
      light: [0.3, 0.45, 0.25],
      props: [
        {kind: 'monitorDesk', at: 'wall', wall: 'far', n: [1, 1], front: 0.9},
        {kind: 'cabinetTall', at: 'wall', wall: 'side', n: [1, 2], front: 0.8},
        {kind: 'gunLocker', at: 'wall', wall: 'side', n: [1, 1], chance: 0.45, front: 0.9},
        {kind: 'staffLockers', at: 'row', wall: 'near', n: [1, 2], chance: 0.6, front: 0.8},
        {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1]},
      ],
      loot: {
        gunLocker: {items: [['ammo_pistol', 2.4], ['ammo_shells', 1.6], ['ammo_rifle', 1.2], ['medkit', 0.3]], lots: [2, 4], empty: 0.1},
        monitorDesk: {items: [['cola', 1], ['chocolate', 1], ['ammo_pistol', 0.6]], lots: [1, 2], empty: 0.4},
        cabinetTall: {items: [['ammo_pistol', 1.4], ['bandage', 1], ['medkit', 0.3], ['water', 0.6]], lots: [2, 4], empty: 0.12},
        crate: CACHE_CRATE,
      },
      floor: {ammo: 2.2, med: 0.5},
    },
    'office-corridor': {
      id: 'office-corridor', category: 'back', theme: 'public', label: 'Corridor', slots: ['office-corridor'], kinds: ['passage'], weight: 1, max: 99,
      props: [
        {kind: 'deadPlant', at: 'wall', wall: 'any', n: [0, 2], chance: 0.6, front: 0.5},
        {kind: 'officeWaterCooler', at: 'wall', wall: 'any', n: [0, 1], chance: 0.35, front: 0.6},
        {kind: 'bin', at: 'wall', wall: 'any', n: [0, 1], chance: 0.4},
      ],
      loot: {bin: {items: [['chips', 1], ['cola', 1], ['water', 0.6], ['bandage', 0.3]], lots: [0, 2], empty: 0.6}}, floor: {med: 0.2, ammo: 0.15},
    },
    'office-open': {
      id: 'office-open', category: 'back', theme: 'personal', label: 'Open-plan office', slots: OPEN, kinds: ['concourse', 'room'], weight: 1, max: 99,
      light: [0.3, 0.45, 0.25], props: [],
      loot: {desk: DESK, cabinetLow: DRAWERS, cabinetTall: {items: [['water', 1], ['bandage', 0.8], ['chocolate', 0.8], ['ammo_pistol', 0.3]], lots: [1, 3], empty: 0.2}},
      floor: {med: 0.4, ammo: 0.3},
    },
    'office-private': {
      id: 'office-private', category: 'back', theme: 'personal', label: 'Private office', slots: ROOM, kinds: ['room'], min: [2.5, 3], weight: 3, max: 12,
      light: [0.2, 0.45, 0.35],
      props: [
        {kind: 'desk', at: 'center', n: [1, 1], ring: 0.7},
        {kind: 'cabinetLow', at: 'wall', wall: 'side', n: [0, 1], chance: 0.6, front: 0.7},
        {kind: 'officeShelf', at: 'wall', wall: 'side', n: [0, 1], chance: 0.6, front: 0.6},
        {kind: 'cabinetTall', at: 'wall', wall: 'near', n: [0, 1], chance: 0.3, front: 0.8},
        {kind: 'deadPlant', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5, front: 0.4},
      ],
      loot: {desk: {...DESK, empty: 0.5}, cabinetLow: DRAWERS, cabinetTall: {items: [['water', 1], ['bandage', 1], ['chocolate', 1], ['ammo_pistol', 0.4]], lots: [1, 3], empty: 0.18}},
      floor: {med: 0.5, ammo: 0.3},
    },
    'office-exec': {
      id: 'office-exec', category: 'back', theme: 'personal', label: 'Executive office', slots: ROOM, kinds: ['room'], min: [4, 5], weight: 1, max: 3,
      light: [0.15, 0.45, 0.4], warm: true,
      props: [
        {kind: 'desk', at: 'center', n: [1, 1], ring: 0.8},
        {kind: 'couch', at: 'wall', wall: 'side', n: [1, 1], chance: 0.8, front: 0.7},
        {kind: 'cabinetLow', at: 'wall', wall: 'side', n: [1, 1], front: 0.7},
        {kind: 'officeShelf', at: 'row', wall: 'near', n: [1, 3], front: 0.6},
        {kind: 'safe', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5, front: 0.6},
        {kind: 'deadPlant', at: 'wall', wall: 'any', n: [1, 2], front: 0.4},
      ],
      loot: {
        desk: {items: [['chocolate', 1], ['water', 1], ['juice', 0.8], ['medkit', 0.3], ['ammo_pistol', 0.5]], lots: [1, 2], empty: 0.35},
        cabinetLow: {items: [['juice', 1], ['water', 1], ['bandage', 1], ['ammo_pistol', 0.5]], lots: [1, 2], empty: 0.25},
      },
      floor: {med: 0.6, ammo: 0.6},
    },
    'office-meeting': {
      id: 'office-meeting', category: 'back', theme: 'public', label: 'Meeting room', slots: ROOM, kinds: ['room'], min: [3, 4], weight: 2, max: 3,
      light: [0.25, 0.45, 0.3],
      props: [
        {kind: 'officeWhiteboard', at: 'wall', wall: 'side', n: [1, 1], chance: 0.8, front: 0.6},
        {kind: 'cabinetLow', at: 'wall', wall: 'near', n: [0, 1], chance: 0.5, front: 0.7},
        {kind: 'deadPlant', at: 'wall', wall: 'any', n: [0, 1], chance: 0.4, front: 0.4},
      ],
      loot: {cabinetLow: {items: [['water', 1], ['cola', 1], ['chocolate', 0.6]], lots: [1, 2], empty: 0.4}},
      floor: {med: 0.2},
    },
    'office-break': {
      id: 'office-break', category: 'back', theme: 'food', label: 'Break room', slots: ROOM, kinds: ['room'], min: [3, 4], weight: 2, max: 1,
      light: [0.35, 0.45, 0.2], warm: true,
      props: [
        {kind: 'kitchenette', at: 'wall', wall: 'far', n: [1, 1], front: 0.9},
        {kind: 'fridge', at: 'wall', wall: 'any', n: [1, 1], front: 0.6},
        {kind: 'table', at: 'center', n: [1, 1], ring: 0.9},
        {kind: 'vending', at: 'wall', wall: 'side', n: [0, 1], chance: 0.6, front: 1.0},
        {kind: 'couch', at: 'wall', wall: 'side', n: [0, 1], chance: 0.5, front: 0.6},
        {kind: 'officeWaterCooler', at: 'wall', wall: 'any', n: [0, 1], chance: 0.6, front: 0.6},
      ],
      loot: {
        fridge: {items: [['juice', 2], ['water', 2], ['cola', 2], ['beans', 0.6]], lots: [2, 5], empty: 0.15},
        kitchenette: {items: [['noodles', 2], ['chocolate', 1], ['beans', 1]], lots: [1, 3], empty: 0.25},
        table: {items: [['cola', 1], ['chocolate', 1], ['water', 0.5]], lots: [1, 2], empty: 0.5},
        vending: {items: [['chocolate', 2], ['chips', 2], ['cola', 2], ['water', 1]], lots: [3, 6], empty: 0.12},
      },
      floor: {med: 0.3},
    },
    'office-copy': {
      id: 'office-copy', category: 'back', theme: 'service', label: 'Copy & mail room', slots: ROOM, kinds: ['room'], min: [2.5, 3], weight: 1.6, max: 2,
      light: [0.15, 0.45, 0.4], stock: 'cartons',
      props: [
        {kind: 'officePhotocopier', at: 'wall', wall: 'far', n: [1, 2], front: 0.9},
        {kind: 'shelf', at: 'wall', wall: 'side', n: [1, 1], front: 0.8},
        {kind: 'cabinetLow', at: 'wall', wall: 'any', n: [0, 1], chance: 0.6, front: 0.7},
        {kind: 'cartonStack', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5},
      ],
      loot: {
        shelf: {items: [['water', 1], ['bandage', 0.8], ['chocolate', 0.6]], lots: [1, 3], empty: 0.3},
        cabinetLow: {items: [['bandage', 1], ['water', 1]], lots: [1, 2], empty: 0.3},
      },
      floor: {ammo: 0.4, med: 0.4},
    },
    'office-storage': {
      id: 'office-storage', category: 'back', theme: 'service', label: 'Supply storage', slots: ROOM, kinds: ['room'], weight: 1.4, max: 2,
      light: [0.1, 0.45, 0.45], stock: 'cartons',
      props: [
        {kind: 'shelf', at: 'row', wall: 'far', n: [2, 3], front: 0.8},
        {kind: 'cabinetTall', at: 'wall', wall: 'side', n: [1, 1], front: 0.8},
        {kind: 'crate', at: 'wall', wall: 'any', n: [1, 2]},
        {kind: 'cartonStack', at: 'wall', wall: 'any', n: [0, 1], chance: 0.6},
      ],
      loot: {
        shelf: {items: [['water', 1.4], ['beans', 1], ['bandage', 1], ['ammo_pistol', 0.6], ['ammo_shells', 0.4]], lots: [2, 4], empty: 0.12},
        cabinetTall: {items: [['ammo_pistol', 1], ['bandage', 1], ['medkit', 0.3], ['water', 1]], lots: [2, 4], empty: 0.1},
        crate: CACHE_CRATE,
      },
      floor: {ammo: 1.2, med: 0.8},
    },
    'office-server': {
      id: 'office-server', category: 'back', theme: 'tech', label: 'Server room', slots: ROOM, kinds: ['room'], min: [2.5, 3], weight: 1.2, max: 1,
      light: [0.05, 0.35, 0.6],
      props: [
        {kind: 'serverRack', at: 'row', wall: 'far', n: [2, 5], front: 1.0},
        {kind: 'serverRack', at: 'row', wall: 'side', n: [0, 3], chance: 0.6, front: 1.0},
        {kind: 'cabinetTall', at: 'wall', wall: 'any', n: [0, 1], chance: 0.6, front: 0.8},
        {kind: 'crate', at: 'wall', wall: 'any', n: [0, 1], chance: 0.5},
      ],
      loot: {
        cabinetTall: {items: [['water', 1], ['bandage', 0.6], ['ammo_pistol', 0.4]], lots: [1, 3], empty: 0.2},
        crate: CACHE_CRATE,
      },
      floor: {ammo: 0.6, med: 0.3},
    },
    'office-elevator': {
      id: 'office-elevator', category: 'back', theme: 'public', label: 'Elevator', slots: ['office-elevator'], kinds: ['room'], weight: 1, max: 99,
      light: [1, 0, 0], props: [], loot: {},
    },
    'office-stair': {
      id: 'office-stair', category: 'back', theme: 'public', label: 'Stairwell', slots: ['office-stair'], kinds: ['room'], weight: 1, max: 99,
      light: [0.5, 0.4, 0.1], props: [], loot: {}, floor: {med: 0.2, ammo: 0.2},
    },
  };
}
