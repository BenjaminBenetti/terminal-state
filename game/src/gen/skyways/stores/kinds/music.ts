// Task studio-alpha-skyways-shops-20261107-054512-01: the MUSIC store's OWN new prop kinds (lane STORE-MUSIC), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Northern Groove Records reuses the existing fixtures and storage (lane SHOPS-A's record-bin racks / dig crates / guitars / piano /
// amp / drums, the counters, the openable cabinets, the Mall back counter, lockers, the office desk). Its own kinds are the RECORD
// STOCK the user asked for ("the record store needs actual records in the holders") and the listening-booth / wall pieces no existing
// kind covers. All are code-drawn (world/skywaysStoreMusic.ts) — geometry from gen/skyways/stores/musicStock.ts / musicShapes.ts — and
// their flat art (LP covers, gig posters, sign boards, genre cards) is the store's Codex atlases (never drawn in code).
//
// Affordances (root CLAUDE.md "Props — core design rules", docs/skyways-stores/music.md):
//  - the record stock is separate supported stock, never baked into a fixture: skyMuBinRecords stands in one compartment of an empty
//    rack (host = the rack), skyMuFacedRecords on one ledge of the new-arrivals board (host = the board); like lane SHOPS-A's book
//    stacks they are light `onHost` kinds — inside a bay / on a ledge they rest within their static host (the physics only lets on-host
//    decor go loose from its host's TOP), so nothing floats when shot;
//  - records are PHYSICAL STOCK, not items: no record item exists and no new inventory is invented (the store's finds are the existing
//    loot in its holders);
//  - nothing here is storage: the turntable's dust-cover hinge holds no lid, the headphones / stool / boards have nothing to open.

import type {DestKindSpec, DestOpen, DestPhys} from '../../destinations/kindTypes';
import type {DamageClass} from '../../../../damage/materials';
import type {PropDef} from '../../../props';
import {BIN_STYLES, LP_SLEEVE, COVER_WALL, FACED_PER_LEDGE, FACED_PITCH, binBlock, facedLean} from '../musicStock';
import {COVER_WALL_DEPTH, COVER_WALL_TOP, MUSIC_DIMS} from '../musicShapes';

export const STORE_MUSIC_KINDS = ['skyMuBinRecords', 'skyMuFacedRecords', 'skyMuCoverWall', 'skyMuBinHeader', 'skyMuTurntable', 'skyMuHeadphones', 'skyMuStool', 'skyMuGigPoster', 'skyMuSign'] as const;
export type StoreMusicKind = (typeof STORE_MUSIC_KINDS)[number];

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** The largest bin block of every style (the kind's box; each placement carries its own style's box). */
function binMax(): {w: number; d: number; h: number} {
  let w = 0, d = 0, h = 0;
  for (let v = 0; v < 2 * BIN_STYLES; v++) { const b = binBlock(v); w = Math.max(w, 2 * b.hx); d = Math.max(d, b.z1 - b.z0); h = Math.max(h, b.y1 - b.y0); }
  return {w: r3(w), d: r3(d), h: r3(h)};
}
const BIN = binMax();
const FACED_H = r3(LP_SLEEVE.s * Math.cos(facedLean()) + LP_SLEEVE.t);
const FACED_D = r3(COVER_WALL.ledgeD);

const DEF: Readonly<Record<StoreMusicKind, PropDef>> = {
  skyMuBinRecords: {w: BIN.w, d: BIN.d, h: BIN.h, blocksSight: false, physics: {mass: 4.5, dynamic: true, shape: 'box', mat: 'pad', contact: true, onHost: true}},
  skyMuFacedRecords: {w: r3((FACED_PER_LEDGE - 1) * FACED_PITCH + LP_SLEEVE.s + 0.04), d: FACED_D, h: FACED_H, blocksSight: false, physics: {mass: 1.8, dynamic: true, shape: 'box', mat: 'pad', contact: true, onHost: true}},
  skyMuCoverWall: {w: r3(COVER_WALL.w + 0.05), d: r3(COVER_WALL_DEPTH), h: r3(COVER_WALL_TOP), blocksSight: false},
  skyMuBinHeader: {w: MUSIC_DIMS.binHeader.w, d: MUSIC_DIMS.binHeader.d, h: MUSIC_DIMS.binHeader.h, blocksSight: false},
  skyMuTurntable: {...MUSIC_DIMS.turntable, blocksSight: false, physics: {mass: 7, dynamic: true, shape: 'box', mat: 'pad', contact: true, onHost: true}},
  skyMuHeadphones: {...MUSIC_DIMS.headphones, blocksSight: false, physics: {mass: 0.35, dynamic: true, shape: 'box', mat: 'pad', contact: true, onHost: true}},
  skyMuStool: {...MUSIC_DIMS.stool, blocksSight: false, physics: {mass: 5, dynamic: true, shape: 'cylinder', mat: 'pad', contact: true}},
  skyMuGigPoster: {w: r3(MUSIC_DIMS.poster.w + 0.036), d: MUSIC_DIMS.poster.d, h: r3(MUSIC_DIMS.poster.h + 0.036), blocksSight: false},
  skyMuSign: {w: r3(MUSIC_DIMS.sign.w + 0.03), d: MUSIC_DIMS.sign.d, h: r3(MUSIC_DIMS.sign.h + 0.03), blocksSight: false},
};

const PHYS: Readonly<Record<StoreMusicKind, DestPhys>> = {
  skyMuBinRecords: {dynamic: true, mass: 4.5, mat: 'pad', shape: 'box', onHost: true, how: 'a bay of 10-inch LP sleeves filed upright in one compartment of a record-bin rack (~4.5 kg of card and vinyl): inside the bay the static rack\'s divider / bar / back walls hold it (on-host decor goes loose only from a host top), so a shot marks it and nothing floats; standing on a counter / table top it would go loose'},
  skyMuFacedRecords: {dynamic: true, mass: 1.8, mat: 'pad', shape: 'box', onHost: true, how: 'five 12-inch LP sleeves stood face-out on a ledge of the new-arrivals board (~1.8 kg): held by the ledge lip and the board (not the host top), they rest within the static wall fixture — marked by a shot, never floating'},
  skyMuCoverWall: {dynamic: false, why: 'mounted', how: 'black-stained display board with three oak ledges and its NEW ARRIVALS header, screwed to the shop wall from 0.92 m up: a bump or a bullet does not move it'},
  skyMuBinHeader: {dynamic: false, why: 'mounted', how: 'genre divider card in a steel spring clip on a record-bin rack\'s back rim: clipped to the static rack'},
  skyMuTurntable: {dynamic: true, mass: 7, mat: 'pad', shape: 'box', onHost: true, how: 'belt-drive turntable on rubber feet (~7 kg) on the listening counter: on the counter top a shot knocks it off (on-host decor), a bump slides it'},
  skyMuHeadphones: {dynamic: true, mass: 0.35, mat: 'pad', shape: 'box', onHost: true, how: 'closed-back studio headphones (~0.35 kg) lying on the listening counter: knocked off by a shot (on-host decor)'},
  skyMuStool: {dynamic: true, mass: 5, mat: 'pad', shape: 'cylinder', how: 'steel counter stool with a padded seat (~5 kg): shoved when walked into, tips under buckshot'},
  skyMuGigPoster: {dynamic: false, why: 'mounted', how: 'gig poster in a snap frame screwed to the shop wall'},
  skyMuSign: {dynamic: false, why: 'mounted', how: 'painted wayfinding sign board on stand-off brackets, screwed to the shop wall above head height'},
};

const DAMAGE: Readonly<Record<StoreMusicKind, DamageClass>> = {
  skyMuBinRecords: 'cardboard', skyMuFacedRecords: 'cardboard', skyMuCoverWall: 'wood', skyMuBinHeader: 'cardboard',
  skyMuTurntable: 'wood', skyMuHeadphones: 'plastic', skyMuStool: 'steel', skyMuGigPoster: 'cardboard', skyMuSign: 'wood',
};

const OPEN: Readonly<Record<StoreMusicKind, DestOpen>> = {
  skyMuBinRecords: {cls: 'none', role: 'decor', how: 'record sleeves filed in a bin: physical stock to flip through, nothing to open (records are not inventory items)'},
  skyMuFacedRecords: {cls: 'none', role: 'decor', how: 'record sleeves stood face-out on a ledge: physical stock, nothing to open'},
  skyMuCoverWall: {cls: 'none', role: 'surface', how: 'open display board with ledges: no doors, lids or drawers'},
  skyMuBinHeader: {cls: 'none', role: 'decor', how: 'printed divider card: nothing to open'},
  skyMuTurntable: {cls: 'none', role: 'equipment', how: 'turntable: its dust cover is gone (only the hinge blocks remain) — equipment, not storage'},
  skyMuHeadphones: {cls: 'none', role: 'equipment', how: 'headphones: nothing to open'},
  skyMuStool: {cls: 'none', role: 'decor', how: 'counter stool: no storage'},
  skyMuGigPoster: {cls: 'none', role: 'decor', how: 'framed poster: nothing to open'},
  skyMuSign: {cls: 'none', role: 'decor', how: 'painted sign board: nothing to open'},
};

export const STORE_MUSIC_SPECS: Readonly<Record<StoreMusicKind, DestKindSpec>> = Object.fromEntries(STORE_MUSIC_KINDS.map(k =>
  [k, {def: DEF[k], phys: PHYS[k], damage: DAMAGE[k], open: OPEN[k]} satisfies DestKindSpec])) as Record<StoreMusicKind, DestKindSpec>;

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * Northern Groove: the Mall's till / back counter with hutch (mallCashwrapCounter: five drawers + a cupboard) behind the cash desk.
 */
export const STORE_MUSIC_MALL_MODELS: readonly string[] = ['mall-mall-cashwrap-counter.glb'];
