// Task studio-alpha-skyways-shops-20261107-054512-01 (primary contract): the shape of ONE Skyways major store (an anchor family's
// layout-version-3 experience). Each of the ten families has its own module beside this file, owned by one store agent:
// books / outfitter / music / hobby / design / garden / arcade / cinema / science / hockey. Pure data + the dresser function type.
//
// Layout versions (gen/skyways/layoutVersion.ts): stations a player already entered keep regenerating their version (1 or 2) with the
// old dressers (destinations/shopsA.ts / shopsB.ts) untouched; a station first built at version >= SKYWAYS_STORES_MIN_VERSION gets these
// stores (their dresser, their purposes, their back rooms). The wall / floor / ceiling FINISH is render-only (destinations/anchorStyles.ts
// ANCHOR_STYLES -> world/skywaysArch.ts class 'anchor') and applies to every version (no save state behind it).

import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {SkywaysAnchor, SkywaysShopFamily} from '../skywaysTypes';

/** Lower-wall / full-height finish of a store wall (world/officeArch.ts LOWER codes by name). */
export type StoreLowerKind = 'none' | 'paint' | 'wood' | 'tile' | 'stone' | 'concrete';
/** Floor kinds (world/officeArch.ts FloorKind) usable inside a store. */
export type StoreFloorKind = 'carpet' | 'vinyl' | 'tile' | 'stone' | 'concrete' | 'wood';
/** Ceiling kinds (world/officeArch.ts CeilingKind). */
export type StoreCeilKind = 'grid' | 'plain' | 'raw';

/**
 * A store wall (colours sRGB hex): upper paint, the lower / full-height finish (`lowerTop`: its top in m — >= 3.5 runs floor to
 * ceiling; >= 2 counts as the finish for bullet impacts), its colour, the skirting / rail colour and sizes. Built with the Office wall
 * material (world/officeArch.ts wallMaterial: one program per kind), never a global WallMaterial mutation.
 */
export interface StoreWall {
  paint: number; lower: number; trim: number; kind: StoreLowerKind; lowerTop: number; skirt: number; rail: number;
  /** Peeling / decay 0..1 (the network is 30 years abandoned) and the panel seam spacing (m; 0 = none). */
  peel: number; panel: number;
}

/** A store's interior finish: its sales floor walls / floor / ceiling (and optional variants for the upper floor and the zones). */
export interface StoreFinish {
  wall: StoreWall;
  floor: readonly [StoreFloorKind, number | undefined];
  ceil: readonly [StoreCeilKind, number | undefined];
  /** The two-level shop's other storey (absent: the same as the sales floor). */
  upper?: {wall?: StoreWall; floor?: readonly [StoreFloorKind, number | undefined]; ceil?: readonly [StoreCeilKind, number | undefined]};
  /** The multi-zone rooms (listening booths / the auditorium; absent: the same as the sales floor). */
  zones?: {wall?: StoreWall; floor?: readonly [StoreFloorKind, number | undefined]; ceil?: readonly [StoreCeilKind, number | undefined]};
}

/**
 * Loot purposes (gen/purposes.ts ids: the Mall's `mall-<program>` / `mall-<program>-back`, the Office's rooms, the station's purposes —
 * existing tables only) per anchor area role. Assigned at version >= 3 only, scoped to the Skyways anchor areas (no other level's tables
 * change). Absent role = the sales floor's purpose (stock / office: their room purpose as carved).
 */
export interface StorePurposes { floor: string; upper?: string; zones?: string; stock?: string; office?: string }

export interface SkywaysStoreSpec {
  family: SkywaysShopFamily;
  /** The store's owner lane (for reports). */
  owner: string;
  /**
   * The version-3 dresser: furnishes the anchor's sales floor / upper floor / zones / back rooms (the station dresser left them empty;
   * destinations/index.ts already lit them). Returns the number of props placed. Use the anchor kits (destinations/skywaysShopsAKit.ts
   * AnchorKit / skywaysShopsBKit.ts ShopsBDresser) or the shared placement API; on its own rng fork.
   */
  dress(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number;
  purposes: StorePurposes;
  /** The store's walls / floor / ceiling (destinations/anchorStyles.ts ANCHOR_STYLES reads it; absent: the lead's default). */
  finish?: StoreFinish;
  // (the store's Mall-only model files: stores/kinds/<family>.ts STORE_<FAMILY>_MALL_MODELS — pure data, read by assets/levelAssets.ts)
}
