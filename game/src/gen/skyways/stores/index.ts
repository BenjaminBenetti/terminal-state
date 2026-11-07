// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): THE TEN SKYWAYS MAJOR STORES — the registry of each family's
// SkywaysStoreSpec (stores/<family>.ts, one store agent each) and the version-3 entry the destinations pass calls per anchor.
//
// Versions: a station first built at layout version >= SKYWAYS_STORES_MIN_VERSION gets these stores (dresser + Skyways-scoped loot
// purposes); stations entered under an older build keep their old dressing (destinations/shopsA.ts / shopsB.ts, untouched), so saved
// holders / pickups / kills / poses keep pointing at the same props. The parent (Original) owns SKYWAYS_LAYOUT_VERSION: the stores
// follow it through this one constant.

import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {SkywaysAnchor, SkywaysShopFamily} from '../skywaysTypes';
import type {SkywaysStoreSpec} from './types';
import {STORE_BOOKS} from './books';
import {STORE_OUTFITTER} from './outfitter';
import {STORE_MUSIC} from './music';
import {STORE_HOBBY} from './hobby';
import {STORE_DESIGN} from './design';
import {STORE_GARDEN} from './garden';
import {STORE_ARCADE} from './arcade';
import {STORE_CINEMA} from './cinema';
import {STORE_SCIENCE} from './science';
import {STORE_HOCKEY} from './hockey';

/** The first layout version whose anchors are the stores (gen/skyways/layoutVersion.ts SKYWAYS_LAYOUT_VERSION >= this). */
export const SKYWAYS_STORES_MIN_VERSION = 3;

export const SKYWAYS_STORES: Readonly<Record<SkywaysShopFamily, SkywaysStoreSpec>> = {
  books: STORE_BOOKS, outfitter: STORE_OUTFITTER, music: STORE_MUSIC, hobby: STORE_HOBBY, design: STORE_DESIGN, garden: STORE_GARDEN, arcade: STORE_ARCADE, cinema: STORE_CINEMA, science: STORE_SCIENCE, hockey: STORE_HOCKEY,
};


/**
 * Version >= 3: give the anchor's areas their store's loot purposes (Skyways only: the anchor areas of this layout) and dress it with
 * the store's dresser (on the caller's rng fork). Returns the props placed.
 */
export function dressSkywaysStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  const spec = SKYWAYS_STORES[anchor.family];
  if (!spec) return 0;
  const P = spec.purposes, set = (id: number | undefined, purpose: string | undefined) => { const a = id === undefined ? undefined : layout.areas[id]; if (a && purpose) a.purpose = purpose; };
  // the sales floor and its other pieces round a two-level shop's stair well (carve: parent = the floor, the floor's purpose, not a zone)
  const was = layout.areas[anchor.floor]?.purpose;
  for (const a of layout.areas) if (a.parent === anchor.floor && a.type === 'shop' && a.purpose === was && !anchor.zones.includes(a.id)) a.purpose = P.floor;
  set(anchor.floor, P.floor);
  if (anchor.upper !== undefined) {
    set(anchor.upper, P.upper ?? P.floor);
    for (const a of layout.areas) if (a.parent === anchor.upper) a.purpose = P.upper ?? P.floor;
  }
  for (const z of anchor.zones) set(z, P.zones ?? P.floor);
  for (const s of anchor.stock) {
    const a = layout.areas[s];
    if (!a) continue;
    if (a.type === 'stock-room') set(s, P.stock);
    else set(s, P.office);
  }
  return spec.dress(layout, rng, anchor);
}
