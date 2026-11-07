// Task studio-alpha-skyways-shops-20261107-054512-01: the CINEMA store's OWN new prop kinds (lane STORE-CINEMA), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// The Aurora Picture House reuses existing kinds for everything with a body (ticket kiosk, counters, cooler, cupboards, freezer, popcorn
// machine / cart, soda fountain, seat rows, screen, stanchions, benches, lockers, filing cabinet, desk, bins, wall cabinets). Three NEW
// kinds show its Codex art (no existing kind carries this store's own posters / board): box parts + one art quad each
// (stores/cinemaArt.ts; drawn by world/skywaysStoreCinema.ts). Root CLAUDE.md "Props — core design rules":
//  - rule 1: none is storage (a glazed poster case / a poster stand / a framed board: nothing to open — the case's glass is the frame's);
//  - rule 2: the poster STAND is a loose lobby piece (~9 kg weighted base): dynamic, pad contact; the case and the board are mounted;
//  - rule 4: nothing loose is baked in (the posters are the case's own printed sheets, not items);
//  - rule 5: scale-checked beside the runtime zombie (docs/skyways-stores/cinema.md).

import type {DestKindSpec} from '../../destinations/kindTypes';
import {CINEMA_CASE, CINEMA_MENU, CINEMA_STAND} from '../cinemaArt';

export const STORE_CINEMA_KINDS = ['storeCinemaPosterCase', 'storeCinemaPosterStand', 'storeCinemaMenuBoard'] as const;
export type StoreCinemaKind = (typeof STORE_CINEMA_KINDS)[number];

export const STORE_CINEMA_SPECS: Readonly<Record<StoreCinemaKind, DestKindSpec>> = {
  storeCinemaPosterCase: {
    def: {w: CINEMA_CASE.w, d: CINEMA_CASE.d, h: CINEMA_CASE.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'glazed one-sheet poster case in a brass frame screwed to the lobby wall (its bottom 0.82 m up)'},
    damage: 'glass',
    open: {cls: 'none', role: 'decor', how: 'wall-mounted poster case: the glazed front is fixed to the frame (the poster is its printed sheet, not an item) — nothing to open'},
  },
  storeCinemaPosterStand: {
    def: {w: CINEMA_STAND.w, d: CINEMA_STAND.d, h: CINEMA_STAND.h, blocksSight: false,
      physics: {mass: 9, dynamic: true, shape: 'box', mat: 'pad', contact: true}},
    phys: {dynamic: true, mass: 9, mat: 'pad', shape: 'box', how: 'freestanding brass poster stand on a weighted steel base (~9 kg): walked into it slides / rocks, shot it rocks / topples'},
    damage: 'steel',
    open: {cls: 'none', role: 'decor', how: 'poster stand: a framed sheet on a post — nothing to open'},
  },
  storeCinemaMenuBoard: {
    def: {w: CINEMA_MENU.w, d: CINEMA_MENU.d, h: CINEMA_MENU.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'framed concession board screwed to the wall over the back counter (its bottom 2.1 m up)'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'wall-mounted board: nothing to open'},
  },
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * The cinema's back-of-house cartons are the Mall's flap-lid cardboard box (M47, an openable spill holder).
 */
export const STORE_CINEMA_MALL_MODELS: readonly string[] = ['mall-cardboard-box-flaps.glb'];

/**
 * Scale-check record (tools/asset-pipeline/props/scale-check.mjs `--prop` on the exact runtime box parts exported by
 * tools/asset-pipeline/skyways-stores/cinema/parts-glb.mjs, beside zombie `lastshift` at runtime scale 1.0, viewed): W x H x D, contact.
 */
export const STORE_CINEMA_SCALE: Readonly<Record<StoreCinemaKind, string>> = {
  storeCinemaPosterCase: '0.86 x 1.28 x 0.09 m case (sheet 0.70 x 1.05 m) mounted 0.82 m up: sheet centre 1.46 m, top 2.10 m (eye level beside the 1.78 m zombie)',
  storeCinemaPosterStand: '0.80 x 1.80 x 0.46 m; grounded on its 0.56 x 0.42 m base plate (one contact cluster); sheet 0.70 x 1.05 m from 0.69 m',
  storeCinemaMenuBoard: '1.80 x 1.24 x 0.07 m board (art 1.68 x 1.12 m) mounted 2.1 m up: over the 1.83 m back counter / 2.0 m cooler, top 3.34 m',
};
