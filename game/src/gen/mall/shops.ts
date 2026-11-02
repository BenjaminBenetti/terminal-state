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
import {lotSuits, mallLot, type MallLotFamily, type MallLotId} from './lots'; // Task mall-playtest-revision-20261031 (lane GEN's lot families)

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
  | 'kiosk' | 'security' | 'first-aid' | 'management' | 'customer-service' | 'janitorial' | 'vacant'
  | 'womenswear' // task mall-round3-20261031 (lane SHOPS, R4)
  | 'lingerie'; // task mall-lingerie-20261102 (lane STORE)

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
    units: ['store'], min: {area: 30, depth: 5.5, width: 4.5}, weight: 0, count: [1, 2], rings: [0.6, 1, 1.1, 1.1, 0.9, 0.7],
    purpose: 'mall-guns', back: 'mall-guns-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'guns',
    finishes: [F('concrete-polished', 'pegboard', 'open-black', 0x5a3a22), F('vinyl-walnut', 'brick-red', 'tile-drop', 0x3f4a2f)],
    sign: S(0x1f2a1c, 0xe8dcb4, 0xb8402e, 'condensed'),
  },
  outdoors: {
    id: 'outdoors', label: 'Outdoor outfitter', brands: ['Northline Outfitters', 'Timber Trail Supply', 'Boreal Gear Co.', 'Canoe & Compass', 'Muskoka Expedition', 'Bruce Trail Outdoor'],
    units: ['store', 'anchor'], min: {area: 55, depth: 5.5, width: 6}, weight: 0.5, count: [1, 2], rings: [0.8, 1, 1.2, 1, 0.9, 0.7],
    purpose: 'mall-outdoors', back: 'mall-outdoors-back', front: 'glazed', shutter: [0.75, 0.25, 0], recipe: 'outdoors',
    finishes: [F('vinyl-oak', 'wood-panel', 'wood-slat', 0x2f5a3a), F('concrete-polished', 'brick-white', 'open-black', 0xb8642a)],
    sign: S(0x2f4a2a, 0xf2ead6, 0xd9a23a, 'serif'),
  },
  pharmacy: {
    id: 'pharmacy', label: 'Pharmacy', brands: ['Queen Street Pharmacy', 'Mercy Drug Mart', 'Carlton Apothecary', 'Bayview Pharmacy', 'Green Cross Dispensary', 'Harbourfront Rx'],
    units: ['store', 'anchor'], min: {area: 28, depth: 5, width: 4.5}, weight: 0.6, count: [1, 2], rings: [1.4, 1.2, 1, 0.8, 0.7, 0.6],
    purpose: 'mall-pharmacy', back: 'mall-pharmacy-back', front: 'glazed', shutter: [0.7, 0.3, 0], recipe: 'pharmacy',
    finishes: [F('tile-white', 'paint-white', 'tile-drop', 0xc62828), F('tile-grey', 'paint-teal', 'tile-drop', 0x00897b)],
    sign: S(0xf4f4ef, 0xb71c1c, 0x00897b, 'sans'),
  },
  clinic: {
    id: 'clinic', label: 'Walk-in clinic', brands: ['Dundas Walk-In Clinic', 'CityCare Medical', 'Albion Family Clinic', 'Front Street Health Centre'],
    units: ['store', 'service'], min: {area: 30, depth: 5.5, width: 5}, weight: 0.3, count: [1, 1], rings: [0.4, 0.8, 1, 1.2, 1.3, 1.3],
    purpose: 'mall-clinic', back: 'mall-clinic-back', front: 'glazed', shutter: [0.8, 0.2, 0], recipe: 'clinic',
    finishes: [F('tile-white', 'paint-sage', 'tile-drop', 0x2e7d6b), F('vinyl-oak', 'paint-white', 'tile-drop', 0x1565c0)],
    sign: S(0xffffff, 0x1565c0, 0x2e7d6b, 'rounded'),
  },
  electronics: {
    id: 'electronics', label: 'Electronics store', brands: ['Voltage Electronics', 'Circuit Square', 'Kilowatt Audio & Video', 'NovaTech', 'Pixel Harbour', 'Megahertz'],
    units: ['store', 'anchor'], min: {area: 45, depth: 5.5, width: 6}, weight: 0.8, count: [1, 2], rings: [1.1, 1.3, 1.1, 1, 0.8, 0.7],
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
    units: ['store', 'anchor'], min: {area: 35, depth: 6, width: 4.5}, weight: 2.2, count: [2, 6], rings: [1.2, 1.3, 1.3, 1.1, 0.8, 0.6],
    purpose: 'mall-clothing', back: 'mall-clothing-back', front: 'glazed', shutter: [0.6, 0.35, 0.05], recipe: 'clothing',
    finishes: [F('vinyl-oak', 'paint-white', 'plaster-white', 0x8d6e63), F('stone-black', 'brick-white', 'open-black', 0xd4a017)],
    sign: S(0xf5f1e8, 0x2a2522, 0x8d6e63, 'serif'),
  },
  // Task mall-round3-20261031 (lane SHOPS, R4 — user: "no female clothing store ... which would normally always be in a mall! Lets get
  // that in"): the women's fashion store — dresses on rails, blouse / skirt racks, handbag / shoe displays, fitting rooms, a window display
  // of female mannequins (gen/mall/shopsDress.ts RECIPES.womenswear). Fictional brands; its own two finishes and sign. MALL_ALWAYS.
  womenswear: {
    id: 'womenswear', label: 'Women\'s fashion store', brands: ['Maison Verity', 'Lark & Lace', 'Rosalind Row', 'Ivy Hart Boutique', 'Sable & Silk', 'The Linen Muse', 'Cora Belle', 'Wren Atelier'],
    units: ['store', 'anchor'], min: {area: 40, depth: 5.5, width: 4.5}, weight: 1.2, count: [1, 3], rings: [1.3, 1.3, 1.2, 1, 0.8, 0.6],
    purpose: 'mall-womenswear', back: 'mall-womenswear-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'womenswear',
    finishes: [F('vinyl-oak', 'paint-blush', 'plaster-white', 0xb76e79), F('terrazzo-cream', 'wallpaper-damask', 'plaster-white', 0x2f2a3a)],
    sign: S(0xfbf3ef, 0x7a2e4a, 0xc9a96e, 'serif'),
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
    units: ['anchor', 'store'], min: {area: 120, depth: 10, width: 10}, weight: 0, count: [1, 2], rings: [1.3, 1.2, 1, 0.8, 0.5, 0.4],
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
    units: ['store', 'food'], min: {area: 16, depth: 4, width: 4}, weight: 0.9, count: [1, 3], rings: [1.1, 1.1, 1, 1, 1, 0.9],
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
    units: ['store'], min: {area: 40, depth: 6, width: 4.5}, weight: 0.6, count: [1, 2], rings: [0.8, 1, 1.2, 1.2, 1, 0.8],
    purpose: 'mall-toys', back: 'mall-toys-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'toys',
    finishes: [F('rubber-sport', 'paint-blush', 'plaster-white', 0xffb300), F('vinyl-oak', 'paint-teal', 'tile-drop', 0xe53935)],
    sign: S(0xffb300, 0x1a237e, 0xe53935, 'rounded'),
  },
  sports: {
    id: 'sports', label: 'Sporting goods', brands: ['Peak Performance Sports', 'Goal Line Athletics', 'Rink & Field', 'Endurance Sports Co.', 'Northern Sport'],
    units: ['store', 'anchor'], min: {area: 45, depth: 5.5, width: 6}, weight: 0.6, count: [1, 2], rings: [1, 1.1, 1.1, 1, 0.8, 0.7],
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
    units: ['store', 'anchor'], min: {area: 55, depth: 5.5, width: 6}, weight: 0.6, count: [1, 2], rings: [0.6, 0.9, 1.1, 1.3, 1.2, 1],
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
    units: ['store', 'anchor'], min: {area: 50, depth: 5.5, width: 6}, weight: 0.4, count: [1, 1], rings: [0.6, 0.8, 1, 1.1, 1.3, 1.4],
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
  // Task mall-lingerie-20261102 (lane STORE — user: "one new women's lingerie store ... it must occupy a LARGE store spot only, never a
  // small one. It has a chance to spawn like any other shop, not guaranteed ... a large fitting/changing area"): the lingerie boutique —
  // window forms, display busts / tables / drawer chests, mirrors, an ottoman, the till, and a WALK-IN changing area of >= 4 curtained
  // booths along an aisle (gen/mall/lingerieStore.ts, RECIPES.lingerie). LARGE lot families only (lots.ts: standard-line 8-11 x 9-12.5
  // and end-unit 10-15 x 10-15); `min` keeps the changing area along the back wall (4 booths + the opening: 8 m wide; 3.5 m deep with
  // >= 5 m of sales floor in front: 9 m deep) — forced on every such unit of 30 generated malls it fit every time (lanes/STORE.done). Never in MALL_ALWAYS / MALL_ROTATION / the fill: a SIDE program (SIDE_PROGRAMS) placed after them on
  // its OWN stream with a per-mall chance = its weight (0.6) when a unit suits it, so every other shop keeps its program / brand / fit
  // (assignMallPrograms step 7b). count [0, 1]: at most one per mall (never scaled). Fictional brands; its own finishes / sign.
  lingerie: {
    id: 'lingerie', label: 'Lingerie boutique', brands: ['Velvet Hour', 'Moonlace Intimates', 'Petal Row', 'Ribbon & Rose', 'Nightingale Lingerie'],
    units: ['store'], min: {area: 72, depth: 9, width: 8}, weight: 0.6, count: [0, 1], rings: [1.2, 1.2, 1.1, 1, 0.8, 0.6],
    purpose: 'mall-lingerie', back: 'mall-lingerie-back', front: 'glazed', shutter: [0.65, 0.35, 0], recipe: 'lingerie',
    finishes: [F('carpet-burgundy', 'wallpaper-damask', 'plaster-white', 0xa8456a), F('vinyl-walnut', 'paint-blush', 'plaster-white', 0x2a1e2e)],
    sign: S(0x2a1626, 0xf4dbe4, 0xc9a96e, 'serif'),
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
  /** Task mall-playtest-revision-20261031 (lane SHOPS): corner units — the entry span along the SECOND shopfront (MallShop.frontages[1]). */
  entry2?: readonly [number, number];
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

// ---------------------------------------------------------------------------------------------
// Task mall-playtest-revision-20261031 (lane SHOPS, D04): the catalogue rotation. The full catalogue stays (28 MallProgram ids, 32
// recipes, every delivered model reachable through some recipe); a smaller mall of ~18-24 units shows a curated subset per seed.

/** Programs every mall has when a unit suits them: the gun shop, clothes, a pharmacy, a café (food counters are their own family). */
// Task mall-round3-20261031 (lane SHOPS, R4 — user: a women's clothing store "would normally always be in a mall"): + 'womenswear'.
export const MALL_ALWAYS: readonly MallProgram[] = ['guns', 'clothing', 'womenswear', 'pharmacy', 'cafe'];
/**
 * The rotating catalogue in its ring order (interleaved big / small, so a window of consecutive entries mixes unit sizes). A mall
 * walks it from a seeded start (mallRotation): early entries are featured, the tail only when units are left.
 */
export const MALL_ROTATION: readonly MallProgram[] = ['electronics', 'jewelry', 'books', 'phone', 'sports', 'beauty', 'hardware', 'optical', 'toys', 'music',
  'home', 'florist', 'shoes', 'pet', 'outdoors', 'luggage', 'arcade', 'clinic', 'grocery', 'department'];
/** Programs of the deep anchor units, in their base order (mallAnchorOrder rotates it per mall). */
export const MALL_ANCHOR_PROGRAMS: readonly MallProgram[] = ['department', 'grocery', 'home', 'sports', 'outdoors', 'hardware', 'electronics'];
/**
 * Task mall-lingerie-20261102 (lane STORE): programs placed AFTER the rotation and the fill, on their own stream (never MALL_ALWAYS /
 * rotation / fill): the lingerie boutique — its `weight` is its per-mall chance (when a unit suits it), never guaranteed, and it moves no
 * other shop of an existing mall (assignMallPrograms step 7b).
 */
export const SIDE_PROGRAMS: readonly MallProgram[] = ['lingerie'];
/** Family typicality a side program borrows (its sibling's position in the family's `programs`; lots.ts lists it LAST for stability). */
const SIDE_TYPICAL: Readonly<Partial<Record<MallProgram, MallProgram>>> = {lingerie: 'womenswear'};
/** Programs a side program never displaces besides the gun shop / MALL_ALWAYS rule: the anchors (a mall's grocery / department store). */
const MALL_ANCHOR_ONLY: readonly MallProgram[] = ['department', 'grocery'];
/** The last assignMallPrograms call's rotation (QA / tests / lanes/SHOPS.done): the order walked and the programs it placed. */
export const MALL_ASSIGN_STATS: {last: {rotation: MallProgram[]; featured: MallProgram[];
  /** (lane STORE) step 7b per side program: its chance roll, eligible units, the unit it took and the program it displaced. */
  side?: {program: MallProgram; roll: number; eligible: number; unit?: string; displaced?: MallProgram}[]} | null} = {last: null};

/** The mall's rotation order: the ring from a seeded start, adjacent pairs swapped at random (deterministic per rng). */
export function mallRotation(rng: Rng): MallProgram[] {
  const n = MALL_ROTATION.length, off = rng.int(0, n - 1);
  const out = [...MALL_ROTATION.slice(off), ...MALL_ROTATION.slice(0, off)];
  for (let k = 0; k + 1 < n; k += 2) if (rng.chance(0.5)) [out[k], out[k + 1]] = [out[k + 1], out[k]];
  return out;
}
/** The anchors' order for this mall: department or grocery first (alternating by seed), the others shuffled after. */
export function mallAnchorOrder(rng: Rng): MallProgram[] {
  const first: MallProgram[] = rng.chance(0.5) ? ['department', 'grocery'] : ['grocery', 'department'];
  return [...first, ...rng.shuffle(MALL_ANCHOR_PROGRAMS.filter(p => !first.includes(p)))];
}

/**
 * A lot family for a unit that has none (synthetic fixtures; GEN's generator always sets MallShop.lot): from its size / proportions,
 * the family whose shape it reads as.
 */
export function inferLot(s: MallShop, area: number): MallLotId {
  const w = s.width, d = s.depth;
  if (area < KIOSK_MAX.area || d < KIOSK_MAX.depth) return 'kiosk-cell';
  if (area >= 240 && d >= 12) return 'anchor-deep';
  if (w >= 1.6 * d && d <= 8) return 'wide-showroom';
  if (d >= 1.6 * w && w <= 6.5) return 'narrow-boutique';
  if (area <= 60) return 'compact-square';
  if (area >= 140) return 'end-unit';
  return 'standard-line';
}

export interface AssignOpts {
  /** Force the food-court ring (1-based); default seeded. */
  foodRing?: number;
  /**
   * Task mall-playtest-revision-20261031 (lane SHOPS): force programs onto shop ids (tests / QA: e.g. a second gun shop). Forced
   * units are taken first; everything else is assigned as usual.
   */
  force?: Readonly<Record<string, MallProgram>>;
  /** Task mall-lingerie-20261102 (lane STORE): tests / QA — false skips the side programs (step 7b): the mall as it was without them. */
  sidePrograms?: boolean;
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
  const cap = (p: MallProgram) => (MALL_PROGRAMS[p].count[1] >= 99 ? 99 : p === 'guns' || p === 'lingerie' ? MALL_PROGRAMS[p].count[1] // gun shops stay rare / one lingerie boutique: never scaled
    : Math.max(MALL_PROGRAMS[p].count[1], Math.round(MALL_PROGRAMS[p].count[1] * scale)));
  const fits = (i: number, p: MallProgram) => {
    const d = MALL_PROGRAMS[p], s = shops[i];
    return area[i] >= d.min.area && s.depth >= d.min.depth - 1e-6 && s.width >= d.min.width - 1e-6;
  };
  // 0. forced programs (tests / QA)
  for (const i of free()) {
    const p = opts.force?.[shops[i].id];
    if (p) take(i, p, MALL_PROGRAMS[p].units.includes('store') ? 'store' : MALL_PROGRAMS[p].units[0]);
  }
  // Task mall-playtest-revision-20261031 (lane SHOPS, D02 / D04 — user: "we need more varied shop size ... a bakery shouldn't be that
  // big ... still using all the stores we have and of course we'll randomly swap them in"). Programs follow the unit's LOT FAMILY
  // (gen/mall/lots.ts, lane GEN: MallShop.lot; a lot-less unit — synthetic fixtures — gets one inferred from its size: inferLot) and
  // a seeded CATALOGUE ROTATION: a few programs every mall has (MALL_ALWAYS), the rest in a per-mall order (mallRotation) — a small
  // mall shows a curated subset, the next seed another. Every pick: the family suits it (lotSuits), the program's own minimum size
  // fits, and the best free unit wins by family typicality x floor bias x size match.
  const lotOf = (i: number): MallLotFamily | undefined => mallLot(shops[i].lot ?? inferLot(shops[i], area[i]));
  const suits = (i: number, p: MallProgram) => lotSuits(shops[i].lot ?? inferLot(shops[i], area[i]), p) && fits(i, p);
  const floorIdx = (i: number) => (ringCount <= 1 ? 0 : Math.max(0, Math.min(5, Math.round((ring[i] - 1) * 5 / (ringCount - 1)))));
  /** How typical p is for the unit's family (its `programs` order). */
  const typical = (i: number, p: MallProgram) => { const f = lotOf(i); if (!f) return 1; const k = f.programs.indexOf(p); return k < 0 ? 0.5 : 1 / (1 + 0.2 * k); };
  const score = (i: number, p: MallProgram) => {
    const d = MALL_PROGRAMS[p];
    return typical(i, p) * d.rings[floorIdx(i)] * (1 / (1 + Math.abs(area[i] - d.min.area * 1.8) / (d.min.area + 20))) * (0.85 + 0.3 * rng.next());
  };
  const bestUnit = (p: MallProgram, cands: number[]): number | undefined => {
    let b: number | undefined, bs = -1;
    for (const i of cands) { const v = score(i, p); if (v > bs) { bs = v; b = i; } }
    return b;
  };
  const isShape = (i: number, shape: MallLotFamily['shape']) => lotOf(i)?.shape === shape;
  // 1. kiosk cells: kiosks (a lot-less unit too small for a store may be a small concession, as before)
  for (const i of free()) if (isShape(i, 'cell')) take(i, shops[i].lot ? 'kiosk' : small(i), 'kiosk');
  function small(i: number): MallProgram {
    const opts2 = (['phone', 'jewelry', 'optical', 'florist', 'beauty', 'luggage'] as MallProgram[]).filter(p => fits(i, p) && (count.get(p) ?? 0) < cap(p));
    return opts2.length && rng.chance(0.5) ? rng.pick(opts2) : 'kiosk';
  }
  // 2. food counters: cuisines (their seating is the common food court); with three or more, the biggest is a café stall (menu
  // rotates: coffee / donut / bakery / juice). The sit-down café with its bistro tables is MALL_ALWAYS' (a shop unit, step 6).
  const counters = free().filter(i => isShape(i, 'counter')).sort((a, b) => area[a] - area[b] || a - b);
  if (counters.length >= 3 && suits(counters[counters.length - 1], 'cafe')) take(counters.pop()!, 'cafe', 'food');
  for (const i of counters) take(i, suits(i, 'food-court') ? 'food-court' : 'cafe', 'food');
  // 3. anchors: the deep anchor units take the big programs in the mall's seeded anchor order (department / grocery first on most
  // seeds), each once
  const anchorOrder = mallAnchorOrder(rng);
  for (const i of free().filter(q => isShape(q, 'deep')).sort((a, b) => area[b] - area[a] || a - b)) {
    const p = anchorOrder.find(q => suits(i, q) && (count.get(q) ?? 0) === 0);
    if (p) take(i, p, 'anchor');
  }
  // 4. service rooms: mall security (+ one rotating role in a mall of 22+ units) in the smallest units whose family allows one
  const roles: number[] = [];
  const nService = shops.length >= 22 ? 2 : shops.length >= 6 ? 1 : 0;
  for (let k = 0; k < nService; k++) {
    const c = free().filter(i => (lotOf(i)?.service ?? true) && !isShape(i, 'cell') && !isShape(i, 'counter')).sort((a, b) => area[a] - area[b] || a - b);
    if (!c.length) break;
    take(c[0], 'service', 'service');
    roles.push(c[0]);
  }
  // 5. vacant units: ~5-9 % of what is left, in families that may stand empty (corridor wings / upper floors more, the atrium less)
  const nVac = Math.round(free().length * rng.range(0.05, 0.09));
  for (let k = 0; k < nVac; k++) {
    const c = free().filter(i => lotOf(i)?.vacant ?? true);
    if (!c.length) break;
    const w = c.map(i => [i, (0.6 + 0.3 * ring[i]) * (shops[i].zone === 'atrium' ? 0.4 : shops[i].zone === 'corridor' || shops[i].zone === 'end' ? 1.3 : 1)] as [number, number]);
    take(rng.weighted(w), 'vacant', 'vacant');
  }
  // 6. what every mall has: a gun shop (a second one in a big mall, 25 %), clothing (a second, 50 %), a pharmacy, a café
  const always: MallProgram[] = [...MALL_ALWAYS];
  if (shops.length >= 18 && rng.chance(0.25)) always.push('guns');
  if (free().length >= 14 && rng.chance(0.5)) always.push('clothing');
  for (const p of always) {
    if ((count.get(p) ?? 0) >= cap(p) || (p === 'cafe' && shops.some((_q, j) => prog[j] === 'cafe' && !isShape(j, 'counter')))) continue;
    const i = bestUnit(p, free().filter(q => suits(q, p)));
    if (i !== undefined) take(i, p, unitFor(i, p));
  }
  // 7. the rotation: every rotating program once, in the mall's seeded order, while units suit it; then the rest of the units by
  // weighted picks (repeat-penalised) among the programs their family suits
  const rotation = mallRotation(rng);
  MALL_ASSIGN_STATS.last = {rotation, featured: []};
  for (const p of rotation) {
    if (!free().length) break;
    if ((count.get(p) ?? 0) > 0 || cap(p) <= 0) continue;
    const i = bestUnit(p, free().filter(q => suits(q, p)));
    if (i === undefined) continue;
    take(i, p, unitFor(i, p));
    MALL_ASSIGN_STATS.last.featured.push(p);
  }
  const fillable = (Object.values(MALL_PROGRAMS) as MallProgramDef[]).filter(d => (d.weight > 0 || d.id === 'guns' || d.id === 'department' || d.id === 'grocery')
    && !SIDE_PROGRAMS.includes(d.id)); // (lane STORE: the side programs are placed in step 7b, never here)
  for (const i of free()) {
    const w = (d: MallProgramDef) => (d.weight || 0.3) * typical(i, d.id) * d.rings[floorIdx(i)] * Math.pow(0.3, count.get(d.id) ?? 0);
    let opts3 = fillable.filter(d => suits(i, d.id) && (count.get(d.id) ?? 0) < cap(d.id)).map(d => [d.id, w(d)] as [MallProgram, number]).filter(o => o[1] > 0);
    if (!opts3.length) opts3 = fillable.filter(d => suits(i, d.id) && d.id !== 'guns').map(d => [d.id, w(d)] as [MallProgram, number]).filter(o => o[1] > 0);
    if (!opts3.length) { take(i, area[i] < 30 ? 'kiosk' : 'vacant', area[i] < 30 ? 'kiosk' : 'vacant'); continue; }
    const p = rng.weighted(opts3);
    take(i, p, unitFor(i, p));
  }
  // 7b. Task mall-lingerie-20261102 (lane STORE): the SIDE programs (the lingerie boutique), on their OWN stream after every unit has its
  // program: with the program's per-mall chance (its `weight`), it takes one eligible unit (sideEligible: a large family / size it suits,
  // a plain glazed store or a vacant unit; never a gun shop, an anchor program or the last of a MALL_ALWAYS program), preferring a vacant
  // unit, then a second store of the same program (sideScore). The DISPLACED program still draws its brand on the main stream in step 8,
  // so every other shop of a mall keeps exactly the program, brand, finish, sign, shutter and entry it had without the side program.
  const side = rng.fork('mall-side-programs');
  const displaced = new Map<number, MallProgram>();
  MALL_ASSIGN_STATS.last.side = [];
  for (const sp of opts.sidePrograms === false ? [] : SIDE_PROGRAMS) {
    if ((count.get(sp) ?? 0) >= cap(sp)) continue; // (forced already)
    const roll = side.next();
    const cands = shops.map((_, i) => i).filter(i => sideEligible(i, sp));
    const placed = cands.length > 0 && roll < MALL_PROGRAMS[sp].weight;
    let took: {unit: string; displaced: MallProgram} | undefined;
    if (placed) {
      const i = side.weighted(cands.map(q => [q, sideScore(q, sp)] as [number, number]));
      const p = prog[i]!;
      displaced.set(i, p);
      count.set(p, (count.get(p) ?? 1) - 1);
      prog[i] = undefined;
      take(i, sp, unitFor(i, sp));
      took = {unit: shops[i].id, displaced: p};
    }
    MALL_ASSIGN_STATS.last.side.push({program: sp, roll, eligible: cands.length, ...took});
  }
  function sideEligible(i: number, sp: MallProgram): boolean {
    const p = prog[i];
    if (!p || p === sp || opts.force?.[shops[i].id] || !suits(i, sp) || (kind[i] !== 'store' && kind[i] !== 'vacant')) return false;
    if (MALL_PROGRAMS[p].front !== 'glazed' || p === 'guns' || MALL_ANCHOR_ONLY.includes(p)) return false;
    return !MALL_ALWAYS.includes(p) || (count.get(p) ?? 0) >= 2;
  }
  function sideScore(i: number, sp: MallProgram): number {
    const d = MALL_PROGRAMS[sp], p = prog[i]!;
    const pref = p === 'vacant' ? 3 : (count.get(p) ?? 0) >= 2 ? 2 : 1;
    return pref * typical(i, SIDE_TYPICAL[sp] ?? sp) * d.rings[floorIdx(i)] * (1 / (1 + Math.abs(area[i] - d.min.area * 1.8) / (d.min.area + 20)));
  }
  function unitFor(i: number, p: MallProgram): MallUnitKind {
    const d = MALL_PROGRAMS[p], f = lotOf(i);
    if (p === 'food-court') return 'food';
    if (d.units.includes('anchor') && (f?.shape === 'deep' || (f?.shape === 'end' && (p === 'department' || p === 'grocery')))) return 'anchor';
    if (p === 'cafe' && f?.shape === 'counter') return 'food';
    return d.units.includes('store') ? 'store' : d.units[0];
  }
  void opts.foodRing;
  // 8. fits: brand, purposes, finish, sign, shutter, entry; Area purpose / label
  const usedBrands = new Set<string>();
  const roleIdx = new Map<number, number>(roles.map((i, k) => [i, k]));
  let cuisineK = rng.int(0, FOOD_CUISINES.length - 1), cafeK = rng.int(0, CAFE_MENUS.length - 1), kioskK = rng.int(0, 50);
  const roleOff = rng.int(0, SERVICE_ROLES.length - 2); // (lane SHOPS, mall revision: the second service room's role rotates)
  for (let i = 0; i < shops.length; i++) {
    const s = shops[i], p = prog[i]!, k = kind[i]!, d = MALL_PROGRAMS[p];
    let purpose = d.purpose, backPurpose: string | undefined = d.back, recipe: MallRecipe = d.recipe, cuisine: string | undefined, brand: string;
    if (p === 'food-court' || p === 'cafe') {
      cuisine = p === 'food-court' ? FOOD_CUISINES[cuisineK++ % FOOD_CUISINES.length] : CAFE_MENUS[cafeK++ % CAFE_MENUS.length];
      purpose = cuisine;
      backPurpose = 'mall-food-back';
      brand = pickBrand(rng, FOOD_BRANDS[cuisine] ?? [cuisine], usedBrands);
    } else if (p === 'service') {
      const ri = roleIdx.get(i) ?? 0;
      const role = SERVICE_ROLES[ri === 0 ? 0 : 1 + ((ri - 1 + roleOff) % (SERVICE_ROLES.length - 1))];
      purpose = role.purpose; recipe = role.recipe; brand = role.brand; backPurpose = undefined;
    } else if (p === 'kiosk') {
      brand = d.brands[kioskK++ % d.brands.length];
    } else if (p === 'vacant') {
      brand = rng.pick(d.brands);
    } else if (displaced.has(i)) {
      // (lane STORE) a side program's unit: the displaced program draws its brand on the main stream (as in a mall without it), the
      // side program's own brand comes from the side stream
      pickBrand(rng, MALL_PROGRAMS[displaced.get(i)!].brands, usedBrands);
      brand = pickBrand(side, d.brands, usedBrands);
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
    // (lane SHOPS, mall revision: a 'wide' lot front — showroom / end unit / anchor — opens half its frontage like an anchor)
    const wide = k === 'anchor' || mallLot(s.lot)?.front === 'wide';
    const span = (len: number): [number, number] => {
      const ew = Math.min(len, Math.max(2.4, Math.min(wide ? 6.0 : 4.0, len * (wide ? 0.5 : 0.4))));
      const e0 = front === 'open' ? 0 : Math.max(0, Math.min(len - ew, rng.chance(0.5) ? (len - ew) / 2 : rng.chance(0.5) ? 0.5 : len - ew - 0.5));
      return front === 'open' ? [0, len] : [r2(e0), r2(e0 + ew)];
    };
    const entry = span(W);
    // corner units (lot 'corner-double'): the second shopfront's own entry span (MallShop.frontages[1])
    const f2 = s.frontages?.[1];
    const entry2 = f2 ? span(f2.side === 'N' || f2.side === 'S' ? Math.abs(f2.x1 - f2.x0) : Math.abs(f2.z1 - f2.z0)) : undefined;
    const fit: MallShopFit = {program: p, kind: k, brand, purpose, ...(backPurpose ? {backPurpose} : {}), recipe, ...(cuisine ? {cuisine} : {}), finish, sign, front, shutter, entry,
      ...(entry2 ? {entry2} : {})};
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
