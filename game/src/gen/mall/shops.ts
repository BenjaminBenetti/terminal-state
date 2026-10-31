// Task track3-eaton-centre-20261031 (lane SHOPS): THE EATON'S CENTER SHOP CATALOGUE — programs, fictional brands, unit kinds, finishes
// for lane ARCH, signage data, the seeded per-ring program mix and the shop census. Pure data + logic (no three.js), deterministic.
//
// User (track 3): "there will be a bunch of different shops ... the shops should be very substantial very detailed ... I want the
// different shops to have different themes ... they technically count as rooms and then they influence what what loot spawn chances
// will be in those rooms ... you go to like the gun shop and there's guns ... medicine and clothing and all that stuff".
//
// - MALL_PROGRAMS: every MallProgram (gen/mall/mallTypes.ts) — label, fictional brand pool (readable, original: no real brands), the
//   unit kinds it may occupy, size needs (sales area / depth / width), base mix weight, per-mall min / max, ring bias, its purposes
//   (`mall-<program>` sales floor / `mall-<program>-back` stock room, gen/purposes.ts MALL_PURPOSES; food-court / café units use the
//   station's cuisine store purposes — burger, pizza, noodles … coffee, bakery — with their kitchen lines), the shopfront treatment
//   (glazed / open counter front, shutter odds) and two finish palettes (floor / wall / ceiling ids + accent / sign colours) that lane
//   ARCH renders: distinct per program, never the same wall recoloured.
// - assignMallPrograms(layout, rng): fills program / kind / brand of every MallShop record GEN made, sets Area.purpose and the HUD
//   labels ("Northline Outfitters · Sales floor" / "· Stock room"), and attaches the shop's fit (MallShopFit: finish, sign, shutter,
//   glazing entry, recipe) as `shop.fit` (mallTypes.ts MallShop gains `fit?` — see lanes/SHOPS.notes). The mix: a food-court ring,
//   anchors (department / grocery / home / sports) in the biggest units of some rings, guns / outdoors rare-ish (1-2 each), the
//   required core (pharmacy, clinic, electronics, phone, hardware, clothing x2, shoes, grocery, books, toys, sports, jewellery, home,
//   beauty, music, pet, arcade) first on the best-fitting units, then weighted picks with a strong repeat penalty and ring bias; a
//   service room or two per ring (security, first aid, management, customer service, janitorial), ~8-12 % vacant units (more on
//   the upper rings), kiosks in the units too small for a real store.
// - mallShopCensus(layout): per ring — stores vs anchors vs food units vs kiosks vs service rooms vs vacant, sales area / depth
//   (min / mean / max), backrooms, programs, brands (tests/mall-shops.test.ts; lanes/SHOPS.done).

import {Rng} from '../../core/rng';
import type {Area, SignStyle, StationLayout} from '../stationTypes';
import type {MallProgram, MallShop, MallUnitKind} from './mallTypes';

// ---------------------------------------------------------------------------------------------
// Finish ids (lane ARCH maps them to materials: world/mallArch.ts). Data only: a shop's floor / wall / ceiling treatment.

export type MallFloorFinish =
  | 'tile-white' | 'tile-grey' | 'vinyl-oak' | 'vinyl-walnut' | 'carpet-charcoal' | 'carpet-burgundy' | 'carpet-blue' | 'concrete-polished'
  | 'rubber-sport' | 'checker-bw' | 'terrazzo-cream' | 'quarry-red' | 'stone-black' | 'epoxy-grey';
export type MallWallFinish =
  | 'paint-white' | 'paint-sage' | 'paint-navy' | 'paint-charcoal' | 'paint-blush' | 'paint-ochre' | 'paint-teal' | 'slatwall-white' | 'slatwall-grey'
  | 'pegboard' | 'wood-panel' | 'brick-white' | 'brick-red' | 'tile-subway' | 'mirror-panel' | 'concrete-raw' | 'wallpaper-damask' | 'block-painted';
export type MallCeilingFinish = 'tile-drop' | 'open-black' | 'plaster-white' | 'wood-slat';

export interface MallFinish {
  floor: MallFloorFinish;
  wall: MallWallFinish;
  ceiling: MallCeilingFinish;
  /** Accent colour (0xRRGGBB): counter fronts, bay headers, trims. */
  accent: number;
  /** Back of house (stock room / back office): its own plain finish. */
  back: {floor: MallFloorFinish; wall: MallWallFinish};
}
const F = (floor: MallFloorFinish, wall: MallWallFinish, ceiling: MallCeilingFinish, accent: number, back: [MallFloorFinish, MallWallFinish] = ['concrete-polished', 'block-painted']): MallFinish =>
  ({floor, wall, ceiling, accent, back: {floor: back[0], wall: back[1]}});

/** Shopfront treatment: full-height glazing with an entry span, or an open counter front (food units, kiosks). */
export type MallFront = 'glazed' | 'open';
export type MallShutter = 'open' | 'partial' | 'closed';

/** Interior recipe key (gen/mall/shopsDress.ts RECIPES). */
export type MallRecipe =
  | 'guns' | 'outdoors' | 'pharmacy' | 'clinic' | 'electronics' | 'phone' | 'hardware' | 'clothing' | 'shoes' | 'department' | 'food' | 'cafe'
  | 'grocery' | 'books' | 'toys' | 'sports' | 'jewelry' | 'home' | 'beauty' | 'music' | 'pet' | 'arcade' | 'luggage' | 'optical' | 'florist'
  | 'kiosk' | 'security' | 'first-aid' | 'management' | 'customer-service' | 'janitorial' | 'vacant';

export interface MallProgramDef {
  id: MallProgram;
  /** Generic label (census / QA): "Gun shop". */
  label: string;
  brands: readonly string[];
  /** Unit kinds it may occupy (first = preferred). */
  units: readonly MallUnitKind[];
  /** Minimum usable sales area (m²) and depth / width (m) of a unit it fits. */
  min: {area: number; depth: number; width: number};
  /** Base weight in the fill picks (0 = only placed by rule). */
  weight: number;
  /** Per-mall count range [min, max] (min: placed first on the best-fitting units when they exist). */
  count: readonly [number, number];
  /** Relative weight per ring 1..6 (index 0 = ring 1). */
  rings: readonly [number, number, number, number, number, number];
  /** Sales floor / stock room purpose ids (gen/purposes.ts). Food units: their cuisine's store purpose instead (see CUISINES). */
  purpose: string;
  back: string;
  front: MallFront;
  /** Shutter odds [open, partial, closed] (closed only for a unit with a second way in, else open / partial). */
  shutter: readonly [number, number, number];
  finishes: readonly [MallFinish, MallFinish];
  /** Sign plate colours / typeface (fascia + blade sign). */
  sign: SignStyle;
  recipe: MallRecipe;
  /** Lit / dim / dead fascia odds. */
  signLit?: readonly [number, number, number];
}

const RINGS_ALL = [1, 1, 1, 1, 1, 1] as const;
const S = (bg: number, fg: number, accent: number, font: SignStyle['font']): SignStyle => ({bg, fg, accent, font});

export const MALL_PROGRAMS: Readonly<Record<MallProgram, MallProgramDef>> = {
  guns: {
    id: 'guns', label: 'Gun shop', brands: ['Ironside Arms', 'Northgate Firearms', 'Calder & Webb Gunsmiths', 'Lakehead Sporting Arms', 'Granite Ridge Arms', 'Bullseye Armoury'],
    units: ['store'], min: {area: 40, depth: 6, width: 5}, weight: 0, count: [1, 2], rings: [0.6, 1, 1.1, 1.1, 0.9, 0.7],
    purpose: 'mall-guns', back: 'mall-guns-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'guns',
    finishes: [F('concrete-polished', 'pegboard', 'open-black', 0x5a3a22), F('vinyl-walnut', 'brick-red', 'tile-drop', 0x3f4a2f)],
    sign: S(0x1f2a1c, 0xe8dcb4, 0xb8402e, 'condensed'),
  },
  outdoors: {
    id: 'outdoors', label: 'Outdoor outfitter', brands: ['Northline Outfitters', 'Timber Trail Supply', 'Boreal Gear Co.', 'Canoe & Compass', 'Muskoka Expedition', 'Bruce Trail Outdoor'],
    units: ['store', 'anchor'], min: {area: 55, depth: 7, width: 6}, weight: 0.5, count: [1, 2], rings: [0.8, 1, 1.2, 1, 0.9, 0.7],
    purpose: 'mall-outdoors', back: 'mall-outdoors-back', front: 'glazed', shutter: [0.75, 0.25, 0], recipe: 'outdoors',
    finishes: [F('vinyl-oak', 'wood-panel', 'wood-slat', 0x2f5a3a), F('concrete-polished', 'brick-white', 'open-black', 0xb8642a)],
    sign: S(0x2f4a2a, 0xf2ead6, 0xd9a23a, 'serif'),
  },
  pharmacy: {
    id: 'pharmacy', label: 'Pharmacy', brands: ['Queen Street Pharmacy', 'Mercy Drug Mart', 'Carlton Apothecary', 'Bayview Pharmacy', 'Green Cross Dispensary', 'Harbourfront Rx'],
    units: ['store', 'anchor'], min: {area: 55, depth: 7, width: 6}, weight: 0.6, count: [1, 2], rings: [1.4, 1.2, 1, 0.8, 0.7, 0.6],
    purpose: 'mall-pharmacy', back: 'mall-pharmacy-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'pharmacy',
    finishes: [F('tile-white', 'paint-white', 'tile-drop', 0xc62828), F('tile-grey', 'paint-teal', 'tile-drop', 0x00897b)],
    sign: S(0xf4f4ef, 0xb71c1c, 0x00897b, 'sans'),
  },
  clinic: {
    id: 'clinic', label: 'Walk-in clinic', brands: ['Dundas Walk-In Clinic', 'CityCare Medical', 'Albion Family Clinic', 'Front Street Health Centre'],
    units: ['store', 'service'], min: {area: 40, depth: 6, width: 5}, weight: 0.3, count: [1, 1], rings: [0.4, 0.8, 1, 1.2, 1.3, 1.3],
    purpose: 'mall-clinic', back: 'mall-clinic-back', front: 'glazed', shutter: [0.8, 0.2, 0], recipe: 'clinic',
    finishes: [F('tile-white', 'paint-sage', 'tile-drop', 0x2e7d6b), F('vinyl-oak', 'paint-white', 'tile-drop', 0x1565c0)],
    sign: S(0xffffff, 0x1565c0, 0x2e7d6b, 'rounded'),
  },
  electronics: {
    id: 'electronics', label: 'Electronics store', brands: ['Voltage Electronics', 'Circuit Square', 'Kilowatt Audio & Video', 'NovaTech', 'Pixel Harbour', 'Megahertz'],
    units: ['store', 'anchor'], min: {area: 50, depth: 7, width: 6}, weight: 0.8, count: [1, 2], rings: [1.1, 1.3, 1.1, 1, 0.8, 0.7],
    purpose: 'mall-electronics', back: 'mall-electronics-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'electronics',
    finishes: [F('epoxy-grey', 'paint-charcoal', 'open-black', 0x00acc1), F('tile-white', 'slatwall-grey', 'tile-drop', 0x7e57c2)],
    sign: S(0x121417, 0x4dd0e1, 0x7e57c2, 'mono'),
  },
  phone: {
    id: 'phone', label: 'Phone store', brands: ['CellPoint', 'Ringline Mobile', 'Signal Hub', 'Dial Tone Mobile', 'Handset House'],
    units: ['store', 'kiosk'], min: {area: 20, depth: 4, width: 4}, weight: 0.7, count: [1, 2], rings: [1.2, 1.2, 1, 1, 0.8, 0.6],
    purpose: 'mall-phone', back: 'mall-phone-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'phone',
    finishes: [F('tile-white', 'paint-white', 'plaster-white', 0x1e88e5), F('epoxy-grey', 'paint-navy', 'tile-drop', 0xff7043)],
    sign: S(0x1e88e5, 0xffffff, 0x212121, 'sans'),
  },
  hardware: {
    id: 'hardware', label: 'Hardware store', brands: ['Ward & Sons Hardware', 'Rivet & Rail', 'Toolhouse', 'Kingsway Hardware', 'Brick Lane Tools'],
    units: ['store', 'anchor'], min: {area: 55, depth: 7, width: 6}, weight: 0.6, count: [1, 2], rings: [1.3, 1.1, 1, 0.9, 0.7, 0.6],
    purpose: 'mall-hardware', back: 'mall-hardware-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'hardware',
    finishes: [F('concrete-polished', 'pegboard', 'open-black', 0xe65100), F('epoxy-grey', 'block-painted', 'open-black', 0xc62828)],
    sign: S(0xe65100, 0xffffff, 0x263238, 'condensed'),
  },
  clothing: {
    id: 'clothing', label: 'Clothing store', brands: ['Thread & Needle', 'Harbour Line Apparel', 'Wool & Wren', 'Urban Ledger', 'Fieldnote Clothing', 'Kensington Denim', 'Copper Fox', 'Stitch Society'],
    units: ['store', 'anchor'], min: {area: 40, depth: 6, width: 5}, weight: 2.2, count: [2, 6], rings: [1.2, 1.3, 1.3, 1.1, 0.8, 0.6],
    purpose: 'mall-clothing', back: 'mall-clothing-back', front: 'glazed', shutter: [0.6, 0.35, 0.05], recipe: 'clothing',
    finishes: [F('vinyl-oak', 'paint-white', 'plaster-white', 0x8d6e63), F('stone-black', 'brick-white', 'open-black', 0xd4a017)],
    sign: S(0xf5f1e8, 0x2a2522, 0x8d6e63, 'serif'),
  },
  shoes: {
    id: 'shoes', label: 'Shoe store', brands: ['Solemate Shoes', 'Stride & Co.', 'Heel to Toe', 'Lacework Footwear', 'Cobble Street Shoes'],
    units: ['store'], min: {area: 30, depth: 5, width: 4.5}, weight: 1, count: [1, 3], rings: [1.1, 1.2, 1.2, 1, 0.8, 0.6],
    purpose: 'mall-shoes', back: 'mall-shoes-back', front: 'glazed', shutter: [0.6, 0.35, 0.05], recipe: 'shoes',
    finishes: [F('vinyl-walnut', 'slatwall-white', 'plaster-white', 0x6d4c41), F('tile-grey', 'paint-ochre', 'tile-drop', 0x37474f)],
    sign: S(0x37474f, 0xf5f5f0, 0xff8f00, 'sans'),
  },
  department: {
    id: 'department', label: 'Department store', brands: ['Halloway\'s', 'Simcoe & Ashby', 'Merriweather\'s', 'The Grand Emporium', 'Kingsley Bros.'],
    units: ['anchor', 'store'], min: {area: 150, depth: 10, width: 10}, weight: 0, count: [1, 2], rings: [1.3, 1.2, 1, 0.8, 0.5, 0.4],
    purpose: 'mall-department', back: 'mall-department-back', front: 'glazed', shutter: [0.8, 0.2, 0], recipe: 'department',
    finishes: [F('terrazzo-cream', 'paint-white', 'plaster-white', 0x7b1fa2), F('carpet-burgundy', 'wallpaper-damask', 'plaster-white', 0xb08d57)],
    sign: S(0x1b1b2f, 0xe8d8a8, 0xb08d57, 'serif'),
  },
  'food-court': {
    id: 'food-court', label: 'Food-court counter', brands: [],
    units: ['food'], min: {area: 14, depth: 3.5, width: 3}, weight: 0, count: [0, 99], rings: [1, 1, 1, 1, 1, 1],
    purpose: 'burger', back: 'mall-food-back', front: 'open', shutter: [0.65, 0.25, 0.1], recipe: 'food',
    finishes: [F('quarry-red', 'tile-subway', 'tile-drop', 0xc0392b, ['quarry-red', 'tile-subway']), F('tile-grey', 'tile-subway', 'open-black', 0xf9a825, ['quarry-red', 'tile-subway'])],
    sign: S(0x1c1e20, 0xefe6cf, 0xd9a520, 'rounded'),
  },
  cafe: {
    id: 'cafe', label: 'Café', brands: [],
    units: ['store', 'food'], min: {area: 25, depth: 4.5, width: 4}, weight: 0.9, count: [1, 3], rings: [1.1, 1.1, 1, 1, 1, 0.9],
    purpose: 'coffee', back: 'mall-food-back', front: 'open', shutter: [0.7, 0.3, 0], recipe: 'cafe',
    finishes: [F('vinyl-oak', 'brick-red', 'wood-slat', 0x6d4c41, ['quarry-red', 'tile-subway']), F('checker-bw', 'tile-subway', 'plaster-white', 0x1b5e20, ['quarry-red', 'tile-subway'])],
    sign: S(0x25352f, 0xefe6cf, 0xc99a2e, 'serif'),
  },
  grocery: {
    id: 'grocery', label: 'Grocery store', brands: ['Greenleaf Market', 'Dundas Fresh Market', 'Harvest Basket Grocers', 'Cornerstone Foods', 'Pantry Lane Market'],
    units: ['anchor', 'store'], min: {area: 100, depth: 9, width: 8}, weight: 0, count: [1, 1], rings: [1.5, 1.2, 0.8, 0.5, 0.3, 0.2],
    purpose: 'mall-grocery', back: 'mall-grocery-back', front: 'glazed', shutter: [0.8, 0.2, 0], recipe: 'grocery',
    finishes: [F('tile-white', 'paint-sage', 'open-black', 0x43a047), F('vinyl-oak', 'tile-subway', 'tile-drop', 0xe53935)],
    sign: S(0x2e7d32, 0xffffff, 0xf9a825, 'rounded'),
  },
  books: {
    id: 'books', label: 'Bookstore', brands: ['Paper Lantern Books', 'Ink & Spine', 'The Reading Room', 'Quill & Page', 'Lakeside Books'],
    units: ['store', 'anchor'], min: {area: 40, depth: 6, width: 5}, weight: 0.6, count: [1, 2], rings: [0.7, 0.9, 1.1, 1.2, 1.2, 1.1],
    purpose: 'mall-books', back: 'mall-books-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'books',
    finishes: [F('carpet-blue', 'wood-panel', 'wood-slat', 0x1a237e), F('vinyl-walnut', 'paint-navy', 'plaster-white', 0xb08d57)],
    sign: S(0x1a237e, 0xf5f1e8, 0xb08d57, 'serif'),
  },
  toys: {
    id: 'toys', label: 'Toy store', brands: ['Kite & Marble', 'Toybox Junction', 'Tin Soldier Toys', 'Whirligig', 'Play Parade'],
    units: ['store'], min: {area: 40, depth: 6, width: 5}, weight: 0.6, count: [1, 2], rings: [0.8, 1, 1.2, 1.2, 1, 0.8],
    purpose: 'mall-toys', back: 'mall-toys-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'toys',
    finishes: [F('rubber-sport', 'paint-blush', 'plaster-white', 0xffb300), F('vinyl-oak', 'paint-teal', 'tile-drop', 0xe53935)],
    sign: S(0xffb300, 0x1a237e, 0xe53935, 'rounded'),
  },
  sports: {
    id: 'sports', label: 'Sporting goods', brands: ['Peak Performance Sports', 'Goal Line Athletics', 'Rink & Field', 'Endurance Sports Co.', 'Northern Sport'],
    units: ['store', 'anchor'], min: {area: 50, depth: 7, width: 6}, weight: 0.6, count: [1, 2], rings: [1, 1.1, 1.1, 1, 0.8, 0.7],
    purpose: 'mall-sports', back: 'mall-sports-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'sports',
    finishes: [F('rubber-sport', 'slatwall-grey', 'open-black', 0x1565c0), F('vinyl-oak', 'paint-white', 'open-black', 0xd32f2f)],
    sign: S(0x0d47a1, 0xffffff, 0xd32f2f, 'condensed'),
  },
  jewelry: {
    id: 'jewelry', label: 'Jeweller', brands: ['Aurum & Stone', 'Bellhaven Jewellers', 'Carat House', 'Sterling Lane', 'Gilt & Garnet'],
    units: ['store', 'kiosk'], min: {area: 22, depth: 4.5, width: 4}, weight: 0.6, count: [1, 2], rings: [1.4, 1.2, 1, 0.8, 0.6, 0.5],
    purpose: 'mall-jewelry', back: 'mall-jewelry-back', front: 'glazed', shutter: [0.55, 0.45, 0], recipe: 'jewelry',
    finishes: [F('stone-black', 'mirror-panel', 'plaster-white', 0xd4af37), F('carpet-charcoal', 'wallpaper-damask', 'plaster-white', 0xc0c0c0)],
    sign: S(0x111111, 0xd4af37, 0xc0c0c0, 'serif'),
  },
  home: {
    id: 'home', label: 'Home store', brands: ['Hearth & Home', 'Lantern Lane Living', 'Oak & Linen', 'Nest Interiors', 'Willowbrook Home'],
    units: ['store', 'anchor'], min: {area: 60, depth: 7, width: 6}, weight: 0.6, count: [1, 2], rings: [0.6, 0.9, 1.1, 1.3, 1.2, 1],
    purpose: 'mall-home', back: 'mall-home-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'home',
    finishes: [F('vinyl-oak', 'paint-sage', 'plaster-white', 0x8d6e63), F('carpet-charcoal', 'brick-white', 'wood-slat', 0x5d4037)],
    sign: S(0xf2ede4, 0x4e342e, 0x8d6e63, 'serif'),
  },
  beauty: {
    id: 'beauty', label: 'Beauty store', brands: ['Lumière Beauty', 'Rosewater Cosmetics', 'Glow Bar', 'Velvet & Vanity', 'Petal Skin Co.'],
    units: ['store', 'kiosk'], min: {area: 25, depth: 4.5, width: 4}, weight: 0.6, count: [1, 2], rings: [1.2, 1.2, 1, 0.9, 0.8, 0.7],
    purpose: 'mall-beauty', back: 'mall-beauty-back', front: 'glazed', shutter: [0.6, 0.4, 0], recipe: 'beauty',
    finishes: [F('tile-white', 'paint-blush', 'plaster-white', 0xd81b60), F('stone-black', 'mirror-panel', 'open-black', 0xf8bbd0)],
    sign: S(0xfce4ec, 0xad1457, 0x212121, 'serif'),
  },
  music: {
    id: 'music', label: 'Music store', brands: ['Vinyl Junction', 'Fret & Drum', 'Low End Records', 'Encore Music', 'Treble Clef'],
    units: ['store'], min: {area: 30, depth: 5, width: 4.5}, weight: 0.5, count: [1, 1], rings: [0.7, 0.9, 1.1, 1.2, 1.1, 1],
    purpose: 'mall-music', back: 'mall-music-back', front: 'glazed', shutter: [0.6, 0.4, 0], recipe: 'music',
    finishes: [F('checker-bw', 'brick-red', 'open-black', 0xffc107), F('carpet-charcoal', 'paint-charcoal', 'open-black', 0xe91e63)],
    sign: S(0x212121, 0xffc107, 0xe91e63, 'condensed'),
  },
  pet: {
    id: 'pet', label: 'Pet store', brands: ['Paws & Whiskers', 'The Pet Pantry', 'Tail Waggers', 'Fin & Feather', 'Critter Corner'],
    units: ['store'], min: {area: 35, depth: 5.5, width: 5}, weight: 0.4, count: [1, 1], rings: [1, 1, 1, 1, 0.9, 0.8],
    purpose: 'mall-pet', back: 'mall-pet-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'pet',
    finishes: [F('epoxy-grey', 'paint-teal', 'tile-drop', 0x00897b), F('vinyl-oak', 'paint-ochre', 'tile-drop', 0x6d4c41)],
    sign: S(0x00897b, 0xffffff, 0xffb300, 'rounded'),
  },
  arcade: {
    id: 'arcade', label: 'Arcade', brands: ['Pixel Palace', 'Neon Joystick', 'Galaxy Arcade', 'Token Town', 'High Score'],
    units: ['store', 'anchor'], min: {area: 50, depth: 7, width: 6}, weight: 0.4, count: [1, 1], rings: [0.6, 0.8, 1, 1.1, 1.3, 1.4],
    purpose: 'mall-arcade', back: 'mall-arcade-back', front: 'open', shutter: [0.6, 0.4, 0], recipe: 'arcade',
    finishes: [F('carpet-blue', 'paint-charcoal', 'open-black', 0xe040fb), F('stone-black', 'paint-navy', 'open-black', 0x00e5ff)],
    sign: S(0x120024, 0xff4081, 0x00e5ff, 'mono'), signLit: [0.75, 0.2, 0.05],
  },
  luggage: {
    id: 'luggage', label: 'Luggage store', brands: ['Wayfarer Luggage', 'Carry-On Co.', 'Voyage Trunk', 'Globetrotter Bags'],
    units: ['store', 'kiosk'], min: {area: 25, depth: 4.5, width: 4}, weight: 0.35, count: [0, 1], rings: [1, 1, 1, 1, 0.9, 0.8],
    purpose: 'mall-luggage', back: 'mall-luggage-back', front: 'glazed', shutter: [0.6, 0.4, 0], recipe: 'luggage',
    finishes: [F('vinyl-walnut', 'paint-navy', 'plaster-white', 0x8d6e63), F('tile-grey', 'slatwall-white', 'tile-drop', 0x37474f)],
    sign: S(0x263238, 0xe8d8a8, 0x8d6e63, 'sans'),
  },
  optical: {
    id: 'optical', label: 'Optician', brands: ['ClearSight Optical', 'Iris Eyewear', 'Spectacle Studio', 'Focal Point Optometry'],
    units: ['store', 'kiosk'], min: {area: 22, depth: 4.5, width: 4}, weight: 0.35, count: [0, 1], rings: [0.8, 1, 1, 1.1, 1.1, 1],
    purpose: 'mall-optical', back: 'mall-optical-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'optical',
    finishes: [F('tile-white', 'paint-white', 'plaster-white', 0x1976d2), F('vinyl-oak', 'paint-sage', 'tile-drop', 0x455a64)],
    sign: S(0xffffff, 0x0d47a1, 0x90caf9, 'sans'),
  },
  florist: {
    id: 'florist', label: 'Florist', brands: ['Bloom & Bough', 'Peony Lane', 'The Stem Studio', 'Fern & Thistle'],
    units: ['store', 'kiosk'], min: {area: 18, depth: 4, width: 3.5}, weight: 0.35, count: [0, 1], rings: [1.3, 1.1, 1, 0.9, 0.8, 0.7],
    purpose: 'mall-florist', back: 'mall-florist-back', front: 'glazed', shutter: [0.6, 0.4, 0], recipe: 'florist',
    finishes: [F('tile-grey', 'brick-white', 'plaster-white', 0x2e7d32), F('vinyl-oak', 'paint-sage', 'wood-slat', 0xad1457)],
    sign: S(0x2e7d32, 0xfce4ec, 0xad1457, 'serif'),
  },
  kiosk: {
    id: 'kiosk', label: 'Kiosk', brands: ['Phone Case Corner', 'Key & Watch Repair', 'Sweet Spot Candy', 'Sunglass Stop', 'Gift Wrap Kiosk', 'Lotto & News', 'Pretzel Twist'],
    units: ['kiosk'], min: {area: 0, depth: 0, width: 0}, weight: 0, count: [0, 99], rings: RINGS_ALL,
    purpose: 'mall-kiosk', back: 'mall-vacant-back', front: 'open', shutter: [0.6, 0.3, 0.1], recipe: 'kiosk',
    finishes: [F('tile-white', 'paint-white', 'plaster-white', 0xff7043), F('tile-grey', 'paint-ochre', 'plaster-white', 0x26a69a)],
    sign: S(0xff7043, 0xffffff, 0x263238, 'rounded'),
  },
  service: {
    id: 'service', label: 'Service room', brands: ['Mall Security', 'First Aid', 'Management Office', 'Customer Service', 'Janitorial'],
    units: ['service'], min: {area: 0, depth: 0, width: 0}, weight: 0, count: [0, 99], rings: RINGS_ALL,
    purpose: 'mall-security', back: 'mall-vacant-back', front: 'glazed', shutter: [0.85, 0.15, 0], recipe: 'security',
    finishes: [F('epoxy-grey', 'block-painted', 'tile-drop', 0x455a64), F('vinyl-oak', 'paint-white', 'tile-drop', 0x1565c0)],
    sign: S(0x263238, 0xffffff, 0xffc107, 'sans'),
  },
  vacant: {
    id: 'vacant', label: 'Vacant unit', brands: ['Space Available', 'Coming Soon', 'For Lease'],
    units: ['vacant'], min: {area: 0, depth: 0, width: 0}, weight: 0, count: [0, 99], rings: RINGS_ALL,
    purpose: 'mall-vacant', back: 'mall-vacant-back', front: 'glazed', shutter: [0.35, 0.35, 0.3], recipe: 'vacant',
    finishes: [F('concrete-polished', 'concrete-raw', 'open-black', 0x9e9e9e), F('epoxy-grey', 'block-painted', 'open-black', 0x757575)],
    sign: S(0x9e9e9e, 0x212121, 0x616161, 'condensed'), signLit: [0, 0.3, 0.7],
  },
};

/** Food-court cuisines and café menus: the station's store purposes (gen/purposes.ts STORE_PURPOSES — names, menus, kitchen lines, loot). */
export const FOOD_CUISINES = ['burger', 'pizza', 'noodles', 'sushi', 'deli', 'shawarma', 'juice', 'hotdog'] as const;
export const CAFE_MENUS = ['coffee', 'donut', 'bakery', 'juice'] as const;
/** Fictional food brands per cuisine (readable, original). */
export const FOOD_BRANDS: Readonly<Record<string, readonly string[]>> = {
  burger: ['Big Ray\'s Burgers', 'Flat Top Burger', 'Union Grill'], pizza: ['Napoli Slice', 'Two Bros Slice', 'Pizza Pronto'],
  noodles: ['Golden Wok', 'Noodle Box', 'Lucky Dragon'], sushi: ['Maki Go', 'Kaiten Express', 'Sushi Station'],
  deli: ['Carver St. Deli', 'Hero Subs', 'Corned Beef Co.'], shawarma: ['Cedar Grill', 'Shawarma King', 'Pita Pit Stop'],
  juice: ['Squeeze Juice Bar', 'Fresh Press', 'Green Line Juice'], hotdog: ['Top Dog Stand', 'Frank\'s Franks', 'Ballpark Dogs'],
  coffee: ['Daily Grind', 'Timberline Coffee', 'Platform Espresso'], donut: ['Honey Dip Donuts', 'Glaze Donuts', 'Crullers & Co.'],
  bakery: ['Hearth Bakery', 'Rise & Crust', 'Patisserie Lumière'],
};
/** Service rooms: sub-programs (purpose / recipe / brand label). */
export const SERVICE_ROLES = [
  {recipe: 'security', purpose: 'mall-security', brand: 'Mall Security'},
  {recipe: 'customer-service', purpose: 'mall-customer-service', brand: 'Customer Service'},
  {recipe: 'first-aid', purpose: 'mall-first-aid', brand: 'First Aid'},
  {recipe: 'management', purpose: 'mall-management', brand: 'Management Office'},
  {recipe: 'janitorial', purpose: 'mall-janitorial', brand: 'Janitorial'},
] as const satisfies readonly {recipe: MallRecipe; purpose: string; brand: string}[];

// ---------------------------------------------------------------------------------------------
// The fit of one shop (attached as MallShop.fit)

export interface MallSign {
  /** Fascia / blade text (the brand). */
  text: string;
  style: SignStyle;
  /** Fascia state: lit (working), dim (failing), dead (no power). */
  lit: 'lit' | 'dim' | 'dead';
  /** A blade sign hangs over the gallery in front of the shop. */
  blade: boolean;
}

export interface MallShopFit {
  program: MallProgram;
  kind: MallUnitKind;
  brand: string;
  /** Sales floor / stock room purpose ids (Area.purpose). */
  purpose: string;
  backPurpose?: string;
  recipe: MallRecipe;
  /** Food-court / café menu (STORE_PURPOSES id). */
  cuisine?: string;
  finish: MallFinish;
  sign: MallSign;
  front: MallFront;
  shutter: MallShutter;
  /** Glazed fronts: the entry span along the frontage (metres from the frontage's start, x0 / z0 end), glazing elsewhere. */
  entry: readonly [number, number];
}

/** The fit SHOPS attached to a shop record (undefined before assignMallPrograms). */
export function shopFit(s: MallShop): MallShopFit | undefined {
  return s.fit;
}

// ---------------------------------------------------------------------------------------------
// Assignment

/** Sales floor of a shop (m²) — the record's own number when GEN filled it, else the area rect. */
function areaOf(layout: StationLayout, s: MallShop): number {
  if (s.salesArea > 0) return s.salesArea;
  const a = layout.areas[s.area];
  return a ? a.w * a.h * 0.25 : 0;
}
/** Unit kind from geometry alone (before the program): kiosk for units too small for a real store. */
export const KIOSK_MAX = {area: 16, depth: 3.5};
export const ANCHOR_MIN = {area: 150, depth: 10};
/** Largest unit a food-court counter takes (m²). */
export const FOOD_MAX_AREA = 90;

/** Ring index (1..6) of a level; storeys come from layout.mall. */
function ringOf(layout: StationLayout, level: number): number {
  const st = layout.mall?.storeys.find(q => q.level === level);
  if (!st || st.role !== 'ring') return Math.max(1, level);
  const rings = layout.mall!.storeys.filter(q => q.role === 'ring').sort((a, b) => a.baseY - b.baseY);
  return rings.indexOf(st) + 1;
}

export interface AssignOpts {
  /** Force the food-court ring (1-based); default seeded. */
  foodRing?: number;
}

/**
 * Assigns a program, unit kind, brand and fit to every shop of `layout.mall.shops` and sets the purposes / labels of their areas.
 * Deterministic for (layout shops, rng). Returns the fits in shop order.
 */
export function assignMallPrograms(layout: StationLayout, rng: Rng, opts: AssignOpts = {}): MallShopFit[] {
  const mall = layout.mall;
  if (!mall) return [];
  const shops = mall.shops;
  const ringCount = Math.max(1, mall.storeys.filter(q => q.role === 'ring').length);
  const ring = shops.map(s => Math.min(6, ringOf(layout, s.level)));
  const area = shops.map(s => areaOf(layout, s));
  const out: (MallShopFit | undefined)[] = shops.map(() => undefined);
  const prog: (MallProgram | undefined)[] = shops.map(() => undefined);
  const kind: (MallUnitKind | undefined)[] = shops.map(() => undefined);
  const count = new Map<MallProgram, number>();
  const take = (i: number, p: MallProgram, k: MallUnitKind) => { prog[i] = p; kind[i] = k; count.set(p, (count.get(p) ?? 0) + 1); };
  const free = () => shops.map((_, i) => i).filter(i => prog[i] === undefined);
  // per-mall maxima scale with the unit count (the catalogue's numbers are for a ~40-unit mall; GEN's rings hold ~13 units each)
  const scale = Math.max(1, shops.length / 40);
  const cap = (p: MallProgram) => (MALL_PROGRAMS[p].count[1] >= 99 ? 99 : p === 'guns' ? MALL_PROGRAMS[p].count[1] // gun shops stay rare: never scaled
    : Math.max(MALL_PROGRAMS[p].count[1], Math.round(MALL_PROGRAMS[p].count[1] * scale)));
  const fits = (i: number, p: MallProgram) => {
    const d = MALL_PROGRAMS[p], s = shops[i];
    return area[i] >= d.min.area && s.depth >= d.min.depth - 1e-6 && s.width >= d.min.width - 1e-6;
  };
  // 1. kiosks: units too small for a real store
  for (const i of free()) if (area[i] < KIOSK_MAX.area || shops[i].depth < KIOSK_MAX.depth) take(i, small(i), 'kiosk');
  function small(i: number): MallProgram {
    // small units: phone / jewellery / optical / florist / beauty / luggage concessions if they fit, else a generic kiosk
    const opts2 = (['phone', 'jewelry', 'optical', 'florist', 'beauty', 'luggage'] as MallProgram[]).filter(p => fits(i, p) && (count.get(p) ?? 0) < cap(p));
    return opts2.length && rng.chance(0.5) ? rng.pick(opts2) : 'kiosk';
  }
  // 2. the food-court ring: its mid-size units become food counters (cuisines rotate)
  const foodRing = opts.foodRing ?? (ringCount >= 2 ? (rng.chance(0.55) ? 1 : rng.chance(0.55) ? 2 : ringCount) : 1);
  const ringFree = free().filter(i => ring[i] === foodRing);
  const ringUnits = ringFree.length;
  // the food ring's smaller units (a 15-90 m² counter; on a ring of big units, its smaller ~60 %: deep units get in-unit dining)
  const sizes = ringFree.map(i => area[i]).sort((a, b) => a - b);
  const foodMax = Math.max(FOOD_MAX_AREA, sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.6))] ?? 0);
  const foodUnits = ringFree.filter(i => area[i] <= foodMax && fits(i, 'food-court'));
  // at most ~60 % of the ring's units sell food (the rest stay real stores: a pharmacy / grocer often sits by a food court); the
  // smallest suitable units become the counters (a food-court counter is a 15-90 m² unit, its seating is the common food hall)
  const nFood = Math.min(foodUnits.length, Math.max(3, Math.round(ringUnits * 0.6)));
  const bySize = foodUnits.slice().sort((a, b) => area[a] - area[b] || a - b);
  for (const i of bySize.slice(0, nFood)) take(i, 'food-court', 'food');
  // 3. anchors: the distinctly big units — at least ANCHOR_MIN and 1.4x the mall's median unit (GEN's ordinary units are already
  // 130-240 m²: an anchor is a 24-30 m wide double unit) — department first, then grocery / home / sports / outdoors / hardware /
  // electronics
  const sorted = area.slice().sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const anchorArea = Math.max(ANCHOR_MIN.area, median * 1.4);
  const isAnchorSize = (i: number) => area[i] >= anchorArea && shops[i].depth >= ANCHOR_MIN.depth;
  const anchorCands = free().filter(isAnchorSize).sort((a, b) => area[b] - area[a] || a - b);
  const anchorPlan: MallProgram[] = ['department', 'grocery', ...rng.shuffle(['home', 'sports', 'outdoors', 'hardware', 'electronics', 'department'] as MallProgram[])];
  const usedAnchorRings = new Set<number>();
  for (const p of anchorPlan) {
    if ((count.get(p) ?? 0) >= cap(p)) continue;
    const c = anchorCands.filter(i => prog[i] === undefined && fits(i, p) && !usedAnchorRings.has(ring[i]))
      .sort((a, b) => MALL_PROGRAMS[p].rings[ring[b] - 1] * area[b] - MALL_PROGRAMS[p].rings[ring[a] - 1] * area[a] || a - b)[0];
    if (c === undefined) continue;
    take(c, p, 'anchor');
    usedAnchorRings.add(ring[c]);
    if (usedAnchorRings.size >= Math.max(2, Math.ceil(ringCount / 2))) break;
  }
  // 4. service rooms: one per ring (two on the busiest), the smallest non-kiosk units; roles rotate (security on the lowest ring)
  const roles: number[] = [];
  for (let r = 1; r <= ringCount; r++) {
    const c = free().filter(i => ring[i] === r).sort((a, b) => area[a] - area[b] || a - b);
    const n = r === 1 && c.length >= 9 ? 2 : c.length >= 4 ? 1 : 0;
    for (let k = 0; k < n; k++) { take(c[k], 'service', 'service'); roles.push(c[k]); }
  }
  // 5. vacant units: ~8-12 % (upper rings more)
  const vac = free();
  const nVac = Math.round(vac.length * rng.range(0.08, 0.12));
  for (let k = 0; k < nVac; k++) {
    const c = free();
    if (!c.length) break;
    const w = c.map(i => [i, 0.6 + 0.3 * ring[i] + (area[i] < 30 ? 0.4 : 0)] as [number, number]);
    take(rng.weighted(w), 'vacant', 'vacant');
  }
  // 6. the required core on the best-fitting units (then guns / outdoors: rare-ish, 1 each + a seeded second)
  const core: MallProgram[] = ['pharmacy', 'electronics', 'hardware', 'clothing', 'clothing', 'grocery', 'guns', 'outdoors', 'clinic', 'phone', 'shoes',
    'books', 'toys', 'sports', 'jewelry', 'home', 'beauty', 'music', 'pet', 'arcade', 'cafe'];
  if (rng.chance(0.35)) core.push('guns');
  if (rng.chance(0.4)) core.push('outdoors');
  for (const p of core) {
    const d = MALL_PROGRAMS[p];
    if ((count.get(p) ?? 0) >= cap(p)) continue;
    if (p !== 'clothing' && p !== 'guns' && p !== 'outdoors' && (count.get(p) ?? 0) >= Math.max(1, d.count[0])) continue;
    const c = free().filter(i => fits(i, p));
    if (!c.length) continue;
    // prefer ring bias x a modest size match (the smallest unit that comfortably fits keeps the big ones for big programs)
    const score = (i: number) => d.rings[ring[i] - 1] * (1 / (1 + Math.abs(area[i] - d.min.area * 1.8) / (d.min.area + 20))) * (0.85 + 0.3 * rng.next());
    const best = c.map(i => [i, score(i)] as [number, number]).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    take(best, p, unitFor(best, p));
  }
  function unitFor(i: number, p: MallProgram): MallUnitKind {
    const d = MALL_PROGRAMS[p];
    if (d.units.includes('anchor') && isAnchorSize(i)) return 'anchor';
    return d.units.includes('store') ? 'store' : d.units[0];
  }
  // 7. fill: weighted picks with a strong repeat penalty and ring bias
  const fillable = (Object.values(MALL_PROGRAMS) as MallProgramDef[]).filter(d => d.weight > 0);
  for (const i of free()) {
    let opts3 = fillable.filter(d => fits(i, d.id) && (count.get(d.id) ?? 0) < cap(d.id))
      .map(d => [d.id, d.weight * d.rings[ring[i] - 1] * Math.pow(0.3, count.get(d.id) ?? 0)] as [MallProgram, number]).filter(o => o[1] > 0);
    // every fitting program at its cap: still a real store (repeat-penalised), never a run of vacant units
    if (!opts3.length) opts3 = fillable.filter(d => fits(i, d.id)).map(d => [d.id, d.weight * d.rings[ring[i] - 1] * Math.pow(0.3, count.get(d.id) ?? 0)] as [MallProgram, number]).filter(o => o[1] > 0);
    if (!opts3.length) { take(i, area[i] < 30 ? 'kiosk' : 'vacant', area[i] < 30 ? 'kiosk' : 'vacant'); continue; }
    const p = rng.weighted(opts3);
    take(i, p, unitFor(i, p));
  }
  // 8. fits: brand, purposes, finish, sign, shutter, entry; Area purpose / label
  const usedBrands = new Set<string>();
  const roleIdx = new Map<number, number>(roles.map((i, k) => [i, k]));
  let cuisineK = rng.int(0, FOOD_CUISINES.length - 1), cafeK = rng.int(0, CAFE_MENUS.length - 1), kioskK = rng.int(0, 50);
  for (let i = 0; i < shops.length; i++) {
    const s = shops[i], p = prog[i]!, k = kind[i]!, d = MALL_PROGRAMS[p];
    let purpose = d.purpose, backPurpose: string | undefined = d.back, recipe: MallRecipe = d.recipe, cuisine: string | undefined, brand: string;
    if (p === 'food-court' || p === 'cafe') {
      cuisine = p === 'food-court' ? FOOD_CUISINES[cuisineK++ % FOOD_CUISINES.length] : CAFE_MENUS[cafeK++ % CAFE_MENUS.length];
      purpose = cuisine;
      backPurpose = 'mall-food-back';
      brand = pickBrand(rng, FOOD_BRANDS[cuisine] ?? [cuisine], usedBrands);
    } else if (p === 'service') {
      const role = SERVICE_ROLES[(roleIdx.get(i) ?? 0) % SERVICE_ROLES.length];
      purpose = role.purpose; recipe = role.recipe; brand = role.brand; backPurpose = undefined;
    } else if (p === 'kiosk') {
      brand = d.brands[kioskK++ % d.brands.length];
    } else if (p === 'vacant') {
      brand = rng.pick(d.brands);
    } else {
      brand = pickBrand(rng, d.brands, usedBrands);
    }
    if (s.backroom === undefined) backPurpose = undefined;
    const finish = d.finishes[rng.chance(0.5) ? 0 : 1];
    const sl = d.signLit ?? [0.55, 0.3, 0.15];
    const lr = rng.next();
    const lit: MallSign['lit'] = lr < sl[0] ? 'lit' : lr < sl[0] + sl[1] ? 'dim' : 'dead';
    const sign: MallSign = {text: brand, style: d.sign, lit, blade: k === 'anchor' || (k !== 'kiosk' && k !== 'service' && rng.chance(0.35))};
    // shutter: closed only when the unit has a second way in (its stock room's own door), else open / partial
    const second = s.backroom !== undefined && layout.doors.some(dr => (dr.a === s.backroom || dr.b === s.backroom) && dr.a !== s.area && dr.b !== s.area);
    const sr = rng.next();
    let shutter: MallShutter = sr < d.shutter[0] ? 'open' : sr < d.shutter[0] + d.shutter[1] ? 'partial' : 'closed';
    if (shutter === 'closed' && !second) shutter = 'partial';
    if (p === 'guns' || p === 'pharmacy' || p === 'grocery' || k === 'service') shutter = shutter === 'closed' ? 'partial' : shutter; // key programs stay reachable from the gallery
    const front: MallFront = k === 'food' || k === 'kiosk' ? 'open' : d.front;
    // entry span along the FRONTAGE (its own length: piers / partial frontages are shorter than the unit)
    const fw = s.frontage.side === 'N' || s.frontage.side === 'S' ? Math.abs(s.frontage.x1 - s.frontage.x0) : Math.abs(s.frontage.z1 - s.frontage.z0);
    const W = fw > 0.5 ? fw : s.width;
    const ew = Math.min(W, Math.max(2.4, Math.min(4.0, W * (k === 'anchor' ? 0.5 : 0.4))));
    const e0 = front === 'open' ? 0 : Math.max(0, Math.min(W - ew, rng.chance(0.5) ? (W - ew) / 2 : rng.chance(0.5) ? 0.5 : W - ew - 0.5));
    const entry: [number, number] = front === 'open' ? [0, W] : [r2(e0), r2(e0 + ew)];
    const fit: MallShopFit = {program: p, kind: k, brand, purpose, ...(backPurpose ? {backPurpose} : {}), recipe, ...(cuisine ? {cuisine} : {}), finish, sign, front, shutter, entry};
    out[i] = fit;
    s.program = p; s.kind = k; s.brand = brand;
    (s as MallShop & {fit?: MallShopFit}).fit = fit;
    const sales = layout.areas[s.area];
    if (sales) labelArea(sales, purpose, `${brand} · ${salesLabel(fit)}`);
    if (s.backroom !== undefined && layout.areas[s.backroom]) labelArea(layout.areas[s.backroom], backPurpose ?? 'mall-vacant-back', `${brand} · ${backLabel(fit)}`);
  }
  return out as MallShopFit[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
function pickBrand(rng: Rng, pool: readonly string[], used: Set<string>): string {
  const free = pool.filter(b => !used.has(b));
  const b = free.length ? rng.pick(free) : `${rng.pick(pool)} ${used.size % 2 ? 'II' : 'Annex'}`;
  used.add(b);
  return b;
}
function labelArea(a: Area, purpose: string, label: string): void {
  a.purpose = purpose;
  a.label = label;
}
/** HUD label of a shop's sales floor ("Sales floor", "Counter", "Showroom" …). */
export function salesLabel(f: MallShopFit): string {
  if (f.kind === 'food') return 'Counter';
  if (f.kind === 'kiosk') return 'Kiosk';
  if (f.kind === 'vacant') return 'Vacant unit';
  if (f.kind === 'service') return MALL_RECIPE_LABEL[f.recipe] ?? 'Office';
  return f.program === 'home' ? 'Showroom' : f.program === 'clinic' ? 'Waiting room' : f.program === 'arcade' ? 'Arcade floor' : 'Sales floor';
}
export function backLabel(f: MallShopFit): string {
  if (f.program === 'guns' || f.program === 'jewelry') return 'Back office';
  if (f.program === 'pharmacy') return 'Dispensary stock';
  if (f.program === 'clinic') return 'Supply room';
  if (f.kind === 'food' || f.program === 'cafe') return 'Kitchen store';
  return 'Stock room';
}
const MALL_RECIPE_LABEL: Partial<Record<MallRecipe, string>> = {
  security: 'Security office', 'first-aid': 'First-aid station', management: 'Management office', 'customer-service': 'Service desk', janitorial: 'Janitorial room',
};

// ---------------------------------------------------------------------------------------------
// Census

export interface RingCensus {
  level: number;
  ring: number;
  units: number;
  byKind: Record<MallUnitKind, number>;
  /** Real stores (store + anchor + food units) vs kiosks / service rooms / vacant. */
  stores: number;
  kiosks: number;
  service: number;
  vacant: number;
  frontages: number;
  backrooms: number;
  salesArea: {min: number; mean: number; max: number; total: number};
  depth: {min: number; mean: number; max: number};
  programs: Partial<Record<MallProgram, number>>;
  brands: string[];
}

export function mallShopCensus(layout: StationLayout): RingCensus[] {
  const mall = layout.mall;
  if (!mall) return [];
  const levels = [...new Set(mall.shops.map(s => s.level))].sort((a, b) => a - b);
  return levels.map(level => {
    const list = mall.shops.filter(s => s.level === level);
    const byKind: Record<MallUnitKind, number> = {store: 0, anchor: 0, food: 0, kiosk: 0, service: 0, vacant: 0};
    const programs: Partial<Record<MallProgram, number>> = {};
    for (const s of list) { byKind[s.kind]++; programs[s.program] = (programs[s.program] ?? 0) + 1; }
    const real = list.filter(s => s.kind === 'store' || s.kind === 'anchor' || s.kind === 'food');
    const areas = real.map(s => areaOf(layout, s)), depths = real.map(s => s.depth);
    const stat = (v: number[]) => (v.length ? {min: r2(Math.min(...v)), mean: r2(v.reduce((a, b) => a + b, 0) / v.length), max: r2(Math.max(...v))} : {min: 0, mean: 0, max: 0});
    return {
      level, ring: ringOf(layout, level), units: list.length, byKind,
      stores: real.length, kiosks: byKind.kiosk, service: byKind.service, vacant: byKind.vacant, frontages: list.length,
      backrooms: list.filter(s => s.backroom !== undefined).length,
      salesArea: {...stat(areas), total: r2(areas.reduce((a, b) => a + b, 0))}, depth: stat(depths), programs, brands: list.map(s => s.brand),
    };
  });
}
