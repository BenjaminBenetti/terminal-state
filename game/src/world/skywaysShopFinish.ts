// Task studio-skywalk-variety-20261107-231448-01 (lane DRESS; user: "the smaller shops all have the 'tile' walls, this really contributes
// to them feeling the same. Perhaps the walls of stores could vary a bit."): the SMALL SHOPS' interior palettes of the Skyways level.
// PURE DATA (no three.js).
//
// Before: every small storefront unit (shop / eatery areas of the base shop pools — not the ten major anchor stores, which have their own
// finishes: gen/skyways/destinations/anchorStyles.ts) drew the Subway's glazed shop tile ('tileShop') on every wall and the station's
// terrazzo / quarry tile underfoot. Now each unit takes one of seven shop-interior PALETTES chosen by its use (the storefront's ShopUse:
// what the shop sells) — a café's walnut boarding under warm cream on oak planks, a bakery's terracotta tile dado on a quarry floor, a
// pharmacy's white tile with a mint band on pale vinyl, a phone / tech shop's charcoal slatwall with a cyan band on polished concrete, a
// florist's sage plaster over a brick dado on stone, a newsstand / convenience store's navy boarding on a checker floor, an eatery's
// oxblood paint over dark timber on dark tile. Ceilings keep the existing rule (the pedway's plain plaster above the station storey).
//
// Draw cost: NONE added. The palettes are written as rows of the Mall's per-vertex finish table (world/mallSurfaces.ts: ONE program per
// surface kind, the finish row a vertex attribute — the Eaton's Center's own answer to "twenty shop programs for the draw calls of one
// material") at the TOP of that table (SKYWAYS_SHOP_ROW0..: a Mall build allocates its rows from 0 and uses ~100-120 of 160), so every
// small shop wall of a 48 m chunk stays ONE mesh and every small shop floor ONE mesh, whatever the mix of palettes — as many as the
// storefront tile / quarry meshes they replace. Keys: 'skyways-shop-wall|<row>' / 'skyways-shop-floor|<row>' (the builder's accumulators
// split the row off: world/builder.ts Accum.fin). Render only (world/skywaysArch.ts: class 'shop' walls in remapFaces, floors in
// floorKey): no layout change, so it reaches stations of every layout version. The anchors, the station's own areas (platforms / track /
// back rooms) and every other level are untouched. Impact classes per palette: damage/impactFinish.ts via skywaysShopImpact.

import type {Area, ShopUse, StationLayout} from '../gen/stationTypes';
import {SKYWAYS_RAMEN_PURPOSE} from '../gen/skyways/ramenPurposes';
import type {DamageClass} from '../damage/materials';
import {FLOOR, WALL, type FloorCode, type MallFloorFinish, type MallWallFinish} from './mallFinishes';

export type SkywaysShopPalette = 'cafe' | 'bakery' | 'clinic' | 'tech' | 'florist' | 'kiosk' | 'eatery';
export const SKYWAYS_SHOP_PALETTE_IDS: readonly SkywaysShopPalette[] = ['cafe', 'bakery', 'clinic', 'tech', 'florist', 'kiosk', 'eatery'];

export interface SkywaysShopFinish {
  wall: MallWallFinish; floor: MallFloorFinish;
  /** Bullet-impact class of the wall (its upper finish: the bulk of a hit) and of the floor. */
  impact: {wall: DamageClass; floor: DamageClass};
}

const W = (o: Partial<MallWallFinish> & Pick<MallWallFinish, 'upper' | 'upperColor'>): MallWallFinish =>
  ({lower: o.upper, lowerColor: o.upperColor, lowerTop: 0, skirt: 0.1, trim: 0x2c2c2e, scale: 0.6, band: 0, rough: 0.85, ...o});
const F = (code: FloorCode, a: number, b: number, c: number, w: number, d: number, rough: number): MallFloorFinish => ({code, a, b, c, w, d, rough});

/** The palettes (colours sRGB hex; the Mall's wall / floor pattern codes, world/mallFinishes.ts). */
export const SKYWAYS_SHOP_PALETTES: Readonly<Record<SkywaysShopPalette, SkywaysShopFinish>> = {
  // café / donuts / juice: walnut boarding to the dado rail, warm cream paint over it, oak planks
  cafe: {wall: W({upper: WALL.plain, upperColor: 0xe3d2b4, lower: WALL.plank, lowerColor: 0x6b4a30, lowerTop: 1.1, trim: 0x3a2818, scale: 0.14, rough: 0.8}),
    floor: F(FLOOR.plank, 0x8a6440, 0x6e4e32, 0x4a3422, 0.18, 1.2, 0.6), impact: {wall: 'plaster', floor: 'wood'}},
  // bakery / deli: a terracotta tile dado under butter-yellow paint, a quarry-tile floor
  bakery: {wall: W({upper: WALL.plain, upperColor: 0xf0dfb8, lower: WALL.tile, lowerColor: 0xc07a4e, lowerTop: 1.3, trim: 0x7a4428, scale: 0.15, rough: 0.5}),
    floor: F(FLOOR.tile, 0xa0583a, 0x5e3a2a, 0x8a4a30, 0.3, 0.3, 0.55), impact: {wall: 'plaster', floor: 'tile'}},
  // pharmacy (and the ramen kitchen): white tile floor to ceiling with a mint band, pale sheet vinyl
  clinic: {wall: W({upper: WALL.tile, upperColor: 0xeef1ef, trim: 0x4f8f7e, scale: 0.2, band: 1.4, rough: 0.35}),
    floor: F(FLOOR.vinyl, 0xd6dbd8, 0x8fbfae, 0xb9c0b8, 1.8, 1.8, 0.45), impact: {wall: 'tile', floor: 'plastic'}},
  // phone / tech / key-cutting: charcoal with a cyan band over grey slatwall, polished concrete
  tech: {wall: W({upper: WALL.band, upperColor: 0x30353a, lower: WALL.slat, lowerColor: 0x50555b, lowerTop: 1.2, trim: 0x5fb4d8, scale: 0.12, band: 2.3, rough: 0.55}),
    floor: F(FLOOR.concrete, 0x5a5c5e, 0x45474a, 0x3a3c3e, 2.4, 2.4, 0.45), impact: {wall: 'plaster', floor: 'concrete'}},
  // florist: sage-green plaster over a red-brick dado, grey stone
  florist: {wall: W({upper: WALL.plain, upperColor: 0xa9bba0, lower: WALL.brick, lowerColor: 0x8a5a44, lowerTop: 1.0, trim: 0x2f3e2b, scale: 0.075, rough: 0.85}),
    floor: F(FLOOR.stone, 0x8c867a, 0x76705f, 0x5e5a50, 0.6, 0.6, 0.5), impact: {wall: 'plaster', floor: 'terrazzo'}},
  // newsstand / convenience: navy-painted boarding under cream paint, a navy / cream checker
  kiosk: {wall: W({upper: WALL.plain, upperColor: 0xe8e0cc, lower: WALL.plank, lowerColor: 0x34506a, lowerTop: 1.2, trim: 0x1f2f3f, scale: 0.12, rough: 0.7}),
    floor: F(FLOOR.checker, 0x2c3440, 0xd8d2c4, 0x8a8680, 0.3, 0.3, 0.45), impact: {wall: 'plaster', floor: 'tile'}},
  // eateries (burgers, pizza, noodles, sushi, shawarma, hot dogs; the ramen dining room): oxblood paint over dark timber, dark tile
  eatery: {wall: W({upper: WALL.plain, upperColor: 0x8c3b2e, lower: WALL.plank, lowerColor: 0x3b2a20, lowerTop: 1.0, trim: 0x1e1612, scale: 0.18, rough: 0.8}),
    floor: F(FLOOR.tile, 0x4e4844, 0x2a2624, 0x5e5650, 0.3, 0.3, 0.45), impact: {wall: 'plaster', floor: 'tile'}},
};

/** Each shop use's palette (every ShopUse: a new use fails to typecheck until it has one). */
export const SKYWAYS_SHOP_PALETTE_OF: Readonly<Record<ShopUse, SkywaysShopPalette>> = {
  coffee: 'cafe', donut: 'cafe', juice: 'cafe',
  bakery: 'bakery', deli: 'bakery',
  pharmacy: 'clinic',
  phone: 'tech', tech: 'tech', keys: 'tech',
  florist: 'florist',
  newsstand: 'kiosk', convenience: 'kiosk',
  burger: 'eatery', pizza: 'eatery', noodles: 'eatery', sushi: 'eatery', shawarma: 'eatery', hotdog: 'eatery',
};
/** Shop areas carved without a storefront of their own, by purpose: the ramen restaurant's dining room and its kitchen (white tile). */
export const SKYWAYS_SHOP_PURPOSE_PALETTE: Readonly<Record<string, SkywaysShopPalette>> = {[SKYWAYS_RAMEN_PURPOSE.dining]: 'eatery', [SKYWAYS_RAMEN_PURPOSE.kitchen]: 'clinic'};

const isShopArea = (a: Area | undefined): a is Area => !!a && ((a.type as string) === 'shop' || (a.type as string) === 'eatery');

/**
 * The palette of a small storefront unit's area (its storefront's use; a piece of a unit without its own storefront: its purpose, else its
 * parent unit's), or null — not a shop area, an anchor store's, or no use known: the builder's own rule stays.
 */
export function skywaysShopPaletteOf(layout: StationLayout, areaId: number): SkywaysShopPalette | null {
  let a = layout.areas[areaId];
  for (let k = 0; k < 4 && isShopArea(a); k++) {
    const sf = a.storefront !== undefined ? layout.storefronts[a.storefront] : undefined;
    if (sf) return sf.anchor ? null : SKYWAYS_SHOP_PALETTE_OF[sf.use] ?? null;
    if (a.purpose && a.purpose in SKYWAYS_SHOP_PURPOSE_PALETTE) return SKYWAYS_SHOP_PURPOSE_PALETTE[a.purpose];
    if (a.purpose && a.purpose in SKYWAYS_SHOP_PALETTE_OF) return SKYWAYS_SHOP_PALETTE_OF[a.purpose as ShopUse];
    if (a.parent === a.id) break;
    a = layout.areas[a.parent];
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Finish-table rows and keys

/** Rows of the Mall finish table (world/mallSurfaces.ts MALL_TABLE_ROWS; tests assert they agree). */
export const SKYWAYS_SHOP_TABLE_ROWS = 160;
/** The first reserved row: one wall row + one floor row per palette at the top of the table. */
export const SKYWAYS_SHOP_ROW0 = SKYWAYS_SHOP_TABLE_ROWS - 2 * SKYWAYS_SHOP_PALETTE_IDS.length;
export const SKYWAYS_SHOP_WALL_KEY = 'skyways-shop-wall';
export const SKYWAYS_SHOP_FLOOR_KEY = 'skyways-shop-floor';

/** The finish-table rows of a palette's wall and floor. */
export function skywaysShopRows(p: SkywaysShopPalette): {wall: number; floor: number} {
  const i = SKYWAYS_SHOP_PALETTE_IDS.indexOf(p);
  return {wall: SKYWAYS_SHOP_ROW0 + i, floor: SKYWAYS_SHOP_ROW0 + SKYWAYS_SHOP_PALETTE_IDS.length + i};
}
export const skywaysShopWallKey = (p: SkywaysShopPalette): string => `${SKYWAYS_SHOP_WALL_KEY}|${skywaysShopRows(p).wall}`;
export const skywaysShopFloorKey = (p: SkywaysShopPalette): string => `${SKYWAYS_SHOP_FLOOR_KEY}|${skywaysShopRows(p).floor}`;

/** The palette of a reserved row (and whether it is its wall or floor row), or null. */
export function skywaysShopPaletteOfRow(row: number): {palette: SkywaysShopPalette; kind: 'wall' | 'floor'} | null {
  const n = SKYWAYS_SHOP_PALETTE_IDS.length, i = row - SKYWAYS_SHOP_ROW0;
  if (!Number.isInteger(i) || i < 0 || i >= 2 * n) return null;
  return {palette: SKYWAYS_SHOP_PALETTE_IDS[i % n], kind: i < n ? 'wall' : 'floor'};
}

/** The bullet-impact class of a small-shop key ('skyways-shop-wall|<row>' / 'skyways-shop-floor|<row>'; the bare base keys: a default). */
export function skywaysShopImpact(key: string): DamageClass | null {
  const m = /^skyways-shop-(wall|floor)(?:\|(\d+))?$/.exec(key);
  if (!m) return null;
  const r = m[2] !== undefined ? skywaysShopPaletteOfRow(Number(m[2])) : null;
  if (r && r.kind === m[1]) return SKYWAYS_SHOP_PALETTES[r.palette].impact[r.kind];
  return m[1] === 'wall' ? 'plaster' : 'tile';
}
