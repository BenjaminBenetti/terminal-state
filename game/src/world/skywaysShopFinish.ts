// Task studio-skywalk-variety-20261107-231448-01 (lane DRESS; user: "the smaller shops all have the 'tile' walls, this really contributes
// to them feeling the same. Perhaps the walls of stores could vary a bit."): the SMALL SHOPS' interior palettes of the Skyways level.
//
// Before: every small storefront unit (shop / eatery areas of the base shop pools — not the ten major anchor stores, which have their own
// finishes: gen/skyways/destinations/anchorStyles.ts) drew the Subway's glazed shop tile ('tileShop') on every wall and the station's
// terrazzo / quarry tile underfoot. Now each unit takes one of a handful of shop-interior PALETTES chosen by its use (the storefront's
// ShopUse: what the shop sells): a café's walnut panelling under warm paint and oak boards, a bakery's terracotta tile dado and quarry
// floor, a pharmacy's white tile and pale vinyl, a phone / tech shop's charcoal paint, a florist's sage plaster over stone, a newsstand /
// convenience store's painted navy boarding, an eatery's oxblood paint over dark timber and a dark tile floor. Ceilings keep the
// existing rule (the pedway's plain plaster above the station storey).
//
// Render only (world/skywaysArch.ts asks this for class 'shop' areas: walls in remapFaces, floors in floorKey): no layout change, so it
// reaches stations of every layout version. Every palette reuses the office architecture's programs (world/officeArch.ts wallMaterial /
// floorMaterial: ONE program per surface kind, exactly like the anchor stores' finishes), one material per palette wall / floor —
// SKYWAYS_SHOP_PALETTE_IDS.length walls + SKYWAYS_SHOP_FLOOR_IDS.length floors at most (similar floors are shared between palettes: fewer
// per-chunk meshes where neighbouring shops meet). The anchors, the station's own areas (platforms / track / back rooms) and every
// other level are untouched. Keys: `skyways-shop-wall-<impact class>@<palette>` / `skyways-shop-floor-<floor kind>@<floor id>` (impact
// classes: damage/impactFinish.ts).

import type {Area, ShopUse, StationLayout} from '../gen/stationTypes';
import {SKYWAYS_RAMEN_PURPOSE} from '../gen/skyways/ramenPurposes';
import {LOWER, type FloorKind, type WallSpec} from './officeArch';

export type SkywaysShopPalette = 'cafe' | 'bakery' | 'clinic' | 'tech' | 'florist' | 'kiosk' | 'eatery';
export const SKYWAYS_SHOP_PALETTE_IDS: readonly SkywaysShopPalette[] = ['cafe', 'bakery', 'clinic', 'tech', 'florist', 'kiosk', 'eatery'];

type Lower = keyof typeof LOWER;
/** The shared shop floors (one material each). */
export type SkywaysShopFloor = 'oak' | 'quarry' | 'vinylLight' | 'vinylDark' | 'stone';
export const SKYWAYS_SHOP_FLOOR_IDS: readonly SkywaysShopFloor[] = ['oak', 'quarry', 'vinylLight', 'vinylDark', 'stone'];
export const SKYWAYS_SHOP_FLOORS: Readonly<Record<SkywaysShopFloor, {kind: FloorKind; tint?: number}>> = {
  oak: {kind: 'wood', tint: 0x8a6440}, quarry: {kind: 'tile', tint: 0xa0583a}, vinylLight: {kind: 'vinyl', tint: 0xcfd2cc},
  vinylDark: {kind: 'vinyl', tint: 0x3c4044}, stone: {kind: 'stone', tint: 0x8c867a},
};
export interface SkywaysShopFinish {
  wall: {paint: number; lower: number; trim: number; kind: Lower; lowerTop: number; skirt?: number; rail?: number; panel?: number; peel?: number};
  floor: SkywaysShopFloor;
}

/** The palettes (colours sRGB hex; `lowerTop` m, >= 2 = a full-height finish). */
export const SKYWAYS_SHOP_PALETTES: Readonly<Record<SkywaysShopPalette, SkywaysShopFinish>> = {
  // café: walnut panelling to the dado rail, warm cream paint over it, oak boards
  cafe: {wall: {paint: 0xe3d2b4, lower: 0x6b4a30, trim: 0x3a2818, kind: 'wood', lowerTop: 1.1, panel: 0.6, peel: 0.2}, floor: 'oak'},
  // bakery / deli: a warm terracotta tile dado, butter-yellow paint, a quarry-tile floor
  bakery: {wall: {paint: 0xf0dfb8, lower: 0xc07a4e, trim: 0x6a3a22, kind: 'tile', lowerTop: 1.3, panel: 0.45, peel: 0.25}, floor: 'quarry'},
  // pharmacy (and the ramen kitchen): white tile to door height, a mint trim, pale vinyl
  clinic: {wall: {paint: 0xf2f4f2, lower: 0xe6ecea, trim: 0x4f8f7e, kind: 'tile', lowerTop: 2.1, panel: 0.5, peel: 0.15}, floor: 'vinylLight'},
  // phone / tech / key-cutting: charcoal paint over a slate band, a cyan trim line, dark vinyl
  tech: {wall: {paint: 0x34393e, lower: 0x23272b, trim: 0x6fa8c8, kind: 'paint', lowerTop: 1.0, panel: 0.2, peel: 0.2}, floor: 'vinylDark'},
  // florist: sage-green plaster over a deep green band, a grey stone floor
  florist: {wall: {paint: 0xa9bba0, lower: 0x55704f, trim: 0x2f3e2b, kind: 'paint', lowerTop: 0.9, panel: 0.3, peel: 0.3}, floor: 'stone'},
  // newsstand / convenience: navy painted timber boarding, cream paint over it, light vinyl
  kiosk: {wall: {paint: 0xe8e0cc, lower: 0x34506a, trim: 0x1f2f3f, kind: 'wood', lowerTop: 1.2, panel: 0.8, peel: 0.25}, floor: 'vinylLight'},
  // eateries (burgers, pizza, noodles, sushi, shawarma, hot dogs): oxblood paint over dark timber, a quarry-tile floor
  eatery: {wall: {paint: 0x8c3b2e, lower: 0x3b2a20, trim: 0x1e1612, kind: 'wood', lowerTop: 1.0, panel: 0.5, peel: 0.25}, floor: 'quarry'},
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
 * The palette of a small storefront unit's area (its storefront's use; a piece of a unit without its own storefront: its parent
 * unit's), or null — not a shop area, an anchor store's, or no use known: the builder's own rule stays.
 */
export function skywaysShopPaletteOf(layout: StationLayout, areaId: number): SkywaysShopPalette | null {
  let a = layout.areas[areaId];
  for (let k = 0; k < 4 && isShopArea(a); k++) {
    const sf = a.storefront !== undefined ? layout.storefronts[a.storefront] : undefined;
    if (sf) return sf.anchor ? null : SKYWAYS_SHOP_PALETTE_OF[sf.use] ?? null;
    if (a.purpose && a.purpose in SKYWAYS_SHOP_PURPOSE_PALETTE) return SKYWAYS_SHOP_PURPOSE_PALETTE[a.purpose];
    if (a.purpose && a.purpose in SKYWAYS_SHOP_PALETTE_OF) return SKYWAYS_SHOP_PALETTE_OF[a.purpose as ShopUse];
    if (a.parent === undefined || a.parent === a.id) break;
    a = layout.areas[a.parent];
  }
  return null;
}

/** A palette's wall key (its impact class: a full-height finish's, else the plaster over the dado) and its office-program spec. */
export function skywaysShopWallKey(p: SkywaysShopPalette): string {
  const w = SKYWAYS_SHOP_PALETTES[p].wall, full = w.lowerTop >= 2;
  const cls = full ? ({wood: 'wood', tile: 'tile', stone: 'terrazzo', concrete: 'concrete', paint: 'plaster', none: 'plaster'} as const)[w.kind] : 'plaster';
  return `skyways-shop-wall-${cls}@${p}`;
}
export function skywaysShopWallSpec(p: SkywaysShopPalette): WallSpec {
  const w = SKYWAYS_SHOP_PALETTES[p].wall;
  return {paint: w.paint, lower: w.lower, trim: w.trim, kind: LOWER[w.kind], lowerTop: w.lowerTop, skirt: w.skirt ?? 0.1, rail: w.rail ?? 0.03, peel: w.peel ?? 0.2, panel: w.panel ?? 0.4};
}
/** A palette's floor: its shared floor's key and spec. */
export function skywaysShopFloorOf(p: SkywaysShopPalette): {key: string; kind: FloorKind; tint?: number} {
  const id = SKYWAYS_SHOP_PALETTES[p].floor, f = SKYWAYS_SHOP_FLOORS[id];
  return {key: `skyways-shop-floor-${f.kind}@${id}`, ...f};
}
