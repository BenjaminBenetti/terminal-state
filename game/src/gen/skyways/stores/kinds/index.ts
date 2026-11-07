// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): the ten Skyways major stores' OWN prop kinds (each store agent's
// kinds/<family>.ts), merged here and spread into the destinations registry (gen/skyways/destinations/registry.ts). Pure data.

import type {DestKindSpec} from '../../destinations/kindTypes';
import {STORE_BOOKS_KINDS, STORE_BOOKS_MALL_MODELS, STORE_BOOKS_SPECS, type StoreBooksKind} from './books';
import {STORE_OUTFITTER_KINDS, STORE_OUTFITTER_MALL_MODELS, STORE_OUTFITTER_SPECS, type StoreOutfitterKind} from './outfitter';
import {STORE_MUSIC_KINDS, STORE_MUSIC_MALL_MODELS, STORE_MUSIC_SPECS, type StoreMusicKind} from './music';
import {STORE_HOBBY_KINDS, STORE_HOBBY_MALL_MODELS, STORE_HOBBY_SPECS, type StoreHobbyKind} from './hobby';
import {STORE_DESIGN_KINDS, STORE_DESIGN_MALL_MODELS, STORE_DESIGN_SPECS, type StoreDesignKind} from './design';
import {STORE_GARDEN_KINDS, STORE_GARDEN_MALL_MODELS, STORE_GARDEN_SPECS, type StoreGardenKind} from './garden';
import {STORE_ARCADE_KINDS, STORE_ARCADE_MALL_MODELS, STORE_ARCADE_SPECS, type StoreArcadeKind} from './arcade';
import {STORE_CINEMA_KINDS, STORE_CINEMA_MALL_MODELS, STORE_CINEMA_SPECS, type StoreCinemaKind} from './cinema';
import {STORE_SCIENCE_KINDS, STORE_SCIENCE_MALL_MODELS, STORE_SCIENCE_SPECS, type StoreScienceKind} from './science';
import {STORE_HOCKEY_KINDS, STORE_HOCKEY_MALL_MODELS, STORE_HOCKEY_SPECS, type StoreHockeyKind} from './hockey';

export type SkywaysStoreKind = StoreBooksKind | StoreOutfitterKind | StoreMusicKind | StoreHobbyKind | StoreDesignKind | StoreGardenKind | StoreArcadeKind | StoreCinemaKind | StoreScienceKind | StoreHockeyKind;
export const SKYWAYS_STORE_KINDS: readonly SkywaysStoreKind[] = [...STORE_BOOKS_KINDS, ...STORE_OUTFITTER_KINDS, ...STORE_MUSIC_KINDS, ...STORE_HOBBY_KINDS, ...STORE_DESIGN_KINDS, ...STORE_GARDEN_KINDS, ...STORE_ARCADE_KINDS, ...STORE_CINEMA_KINDS, ...STORE_SCIENCE_KINDS, ...STORE_HOCKEY_KINDS];
export const SKYWAYS_STORE_SPECS: Readonly<Record<SkywaysStoreKind, DestKindSpec>> = {...STORE_BOOKS_SPECS, ...STORE_OUTFITTER_SPECS, ...STORE_MUSIC_SPECS, ...STORE_HOBBY_SPECS, ...STORE_DESIGN_SPECS, ...STORE_GARDEN_SPECS, ...STORE_ARCADE_SPECS, ...STORE_CINEMA_SPECS, ...STORE_SCIENCE_SPECS, ...STORE_HOCKEY_SPECS};

/** Every Mall-only model file the stores load in Skyways (assets/levelAssets.ts: eligible in Skyways only; sorted, unique). */
export const SKYWAYS_STORE_MALL_MODELS: readonly string[] = [...new Set([...STORE_BOOKS_MALL_MODELS, ...STORE_OUTFITTER_MALL_MODELS, ...STORE_MUSIC_MALL_MODELS, ...STORE_HOBBY_MALL_MODELS, ...STORE_DESIGN_MALL_MODELS, ...STORE_GARDEN_MALL_MODELS, ...STORE_ARCADE_MALL_MODELS, ...STORE_CINEMA_MALL_MODELS, ...STORE_SCIENCE_MALL_MODELS, ...STORE_HOCKEY_MALL_MODELS])].sort();
