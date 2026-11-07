// Task studio-alpha-skyways-shops-20261107-054512-01: the BOOKS store's OWN new prop kinds (lane STORE-BOOKS), merged by
// stores/kinds/index.ts into the destinations registry (gen/skyways/destinations/registry.ts) and from there into the shared tables
// (PROP_DEFS, damage, physics audit, openables audit). Pure data only (no imports of dressers / props.ts: props.ts imports this chain).
// Prefer EXISTING kinds (Subway / Mall / Office / destinations) — add one here only when no existing kind fits.
//
// Paper Prairie Books furnishes with existing kinds (the destinations' oak bookcases / tiered tables / wingbacks / book stacks, the Mall's
// openable bookcase, cash-wrap counter, glass display cabinets, dresser, cartons, the Office / Subway desks, filing cabinets, cabinets,
// shelving, plants, the design store's arc lamp). Two things a bookshop needs had no kind at all:
//  - skyBooksSign: the CATEGORY SIGN over a bay ("FICTION", "LOCAL HISTORY", "MAPS & TRAVEL", "CHILDREN'S BOOKS", "RARE BOOKS", "POETRY",
//    "PRAIRIE AUTHORS", "NEW & NOTABLE": variant = BOOKS_SIGN_PIECES index): a carved walnut header board standing on the top of its
//    bookcase, art on both faces — lane STORE-BOOKS' Codex sign sheet (one native image_gen call; crop / pack only:
//    tools/asset-pipeline/skyways-stores/books/build-books-art.mjs), drawn by world/skywaysStoreBooks.ts;
//  - skyBooksRug: the reading nook's / children's corner's area RUG (variant 0 the worn Persian-style reading-room rug, 1 the children's
//    prairie play rug) — the same Codex route (one call for both), lying flat under the armchairs / bean bags.
// Affordances (root CLAUDE.md "Props — core design rules"): neither is storage (openables 'none'); the sign is mounted (screwed to its
// bookcase top, out of reach), the rug lies flat (soft, ~1 cm, no rigid body: 'flat' like the hideout bedroll); nothing loose is baked
// into either. Scale: docs/skyways-stores/books.md (rendered beside the runtime zombie).

import type {DestKindSpec} from '../../destinations/kindTypes';

export const STORE_BOOKS_KINDS = ['skyBooksSign', 'skyBooksRug'] as const;
export type StoreBooksKind = (typeof STORE_BOOKS_KINDS)[number];

/** The category signs by variant (the atlas pieces of world/skywaysStoreBooks.ts; the sign sheet's reading order). */
export const BOOKS_SIGN_PIECES = ['fiction', 'local-history', 'maps-travel', 'childrens', 'rare-books', 'poetry', 'prairie-authors', 'new-notable'] as const;
export type BooksSignPiece = (typeof BOOKS_SIGN_PIECES)[number];
export const BOOKS_SIGN = {fiction: 0, localHistory: 1, mapsTravel: 2, childrens: 3, rareBooks: 4, poetry: 5, prairieAuthors: 6, newNotable: 7} as const;
/** The rugs by variant. */
export const BOOKS_RUG_PIECES = ['rug-reading', 'rug-children'] as const;
export const BOOKS_RUG = {reading: 0, children: 1} as const;

/**
 * The sign board (m): a 1.05 x 0.29 m walnut header (the sheet's boards are ~3.9 : 1; the art face 1.01 x 0.26 inside a 2 cm lipped
 * edge), 3.5 cm thick — it stands on the top of a 2.4 m bookcase, its face flush with the bookcase's front.
 */
export const BOOKS_SIGN_BOARD = {w: 1.05, h: 0.29, d: 0.035, face: {w: 1.01, h: 0.26}} as const;
/** The rug (m): 2.4 x 1.6 (the generated rugs are 1.5 : 1), 1.2 cm pile. */
export const BOOKS_RUG_SIZE = {w: 2.4, d: 1.6, h: 0.012} as const;

export const STORE_BOOKS_SPECS: Readonly<Record<StoreBooksKind, DestKindSpec>> = {
  skyBooksSign: {
    def: {w: BOOKS_SIGN_BOARD.w, d: BOOKS_SIGN_BOARD.d, h: BOOKS_SIGN_BOARD.h, blocksSight: false},
    phys: {dynamic: false, why: 'mounted', how: 'carved walnut category sign (~3 kg) screwed to the top of its bookcase at 2.4 m: out of reach overhead, a bullet marks it only'},
    damage: 'wood',
    open: {cls: 'none', role: 'decor', how: 'a solid painted sign board: nothing to open'},
  },
  skyBooksRug: {
    def: {w: BOOKS_RUG_SIZE.w, d: BOOKS_RUG_SIZE.d, h: BOOKS_RUG_SIZE.h, blocksSight: false},
    phys: {dynamic: false, why: 'flat', how: 'low-pile wool area rug (~8 kg) lying flat on the floor under the armchairs / bean bags: no rigid body to shove or tip, walked over'},
    damage: 'fabric',
    open: {cls: 'none', role: 'decor', how: 'a flat rug: no lid, door or drawer'},
  },
};

/**
 * Mall-only model FILES this store loads in Skyways (basenames under assets/models, e.g. 'mall-clothes-rail.glb'): registered narrowly
 * for Skyways by assets/levelAssets.ts (the Mall's own worlds unchanged). Office / Subway / Skyways models need no entry.
 * The bookshop's openable Mall storage: the bookstore bookcase (M09: two base drawers + four shelves), the cash-wrap back counter (M01:
 * five drawers + a cupboard), the glass display cabinet (M02: rare books), the dresser (M45: the children's corner), the cardboard
 * carton (M47: the stock room's book cartons). (The café bistro table / chair are already Skyways-eligible: the ramen restaurant.)
 */
export const STORE_BOOKS_MALL_MODELS: readonly string[] = [
  'mall-bookstore-bookcase.glb', 'mall-mall-cashwrap-counter.glb', 'mall-glass-display-cabinet.glb', 'mall-dresser-drawers.glb', 'mall-cardboard-box-flaps.glb',
];
