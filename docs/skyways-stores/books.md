# Paper Prairie Books — Skyways major store (lane STORE-BOOKS)

Task `studio-alpha-skyways-shops-20261107-054512-01`. Layout version 3 only (stations entered under v1 / v2 keep their frozen
dressing). Code: `game/src/gen/skyways/stores/books.ts` (spec: purposes, finish), `booksDress.ts` (the dresser),
`kinds/books.ts` (two new kinds), `booksArt.generated.ts` (atlas map), `game/src/world/skywaysStoreBooks.ts` (renderer + atlas
preload). Tests: `game/tests/skyways-store-books.test.ts`. Root `CLAUDE.md` "Props — core design rules" and
`docs/prop-affordances.md` apply.

## The store

| Part | What stands there | Kinds |
|---|---|---|
| Cash desk | the Mall cash-wrap back counter backed to a solid wall near the entry, a 1.2 m staff aisle, a shop counter (customer side out) with the till; fallback: a counter run beside the entry with a dresser behind its staff aisle | `mallCashwrapCounter` (openable: 5 drawers + a cupboard), `shopCounter`, `cashRegister`; fallback `dresserDrawers` |
| Feature tables | one or two tiered oak tables in the front band with a small sign on the column cap ("NEW & NOTABLE", "PRAIRIE AUTHORS") | `skyDBookTable`, `skyBooksSign` (x0.62) |
| Category bays | wall bookcases in pairs between perpendicular back-to-back spurs (U-shaped bays, 4 m pitch), a carved header sign over each bay; the MAPS & TRAVEL bay uses the Mall bookcase with two map drawers | `skyDBookcase`, `bookstoreBookcase` (openable), `skyBooksSign` |
| Stacks | double-sided bookcase runs (3, 2, then single units) in 1.3 m aisles, an end-cap sign on the first runs | `skyDBookcase`, `skyBooksSign` |
| Reading nook | two wingbacks facing each other over a side table on the Persian rug, the arc floor lamp along the wall behind them (a free-standing nook gets the lamp beside the rug) | `skyDWingbackChair`, `cafeBistroTable`, `skyDArcLamp`, `skyBooksRug` |
| Children's corner | the children's dresser (picture books on top) with a bookcase either side and the CHILDREN'S BOOKS header, the prairie play rug in front with bean bags, a giant teddy | `dresserDrawers` (openable), `beanBag`, `giantTeddy`, `skyBooksRug`, `skyDBookcase` |
| Rare books | two or three glass display cabinets on a wall under the RARE BOOKS header; upstairs also the staff desk (drawers to the sitter) and its chair | `glassDisplayCabinet` (openable), `desk` (openable drawers), `officeChair` |
| Other storey (two-level) | children's corner, rare books + staff desk, a second reading nook, bays, runs, tables; carpet | as above |
| Hall | everything on one floor (a smaller children's corner, the rare-books cabinets without the desk) | as above |
| Stock room | the station dresser's shelving / cartons / crates stay; + book cartons (on the floor where the walls are taken), a tall cabinet, a filing cabinet where they fit | `cardboardBoxFlaps` (openable), `cabinetTall`, `filingCabinet` |
| Office | the station dresser's desk / safe stay; + a filing cabinet, a low cabinet, a Mall bookcase where they fit | `filingCabinet`, `cabinetLow`, `bookstoreBookcase` |
| No back room | a staff stock corner by the cash desk | `cabinetTall`, `stockShelf`, `cardboardBoxFlaps` |
| Plants / walls | potted trees flanking the way in, the books poster, a step ladder by a bay | `planterTree`, `pottedPlantSmall`, `skyDPoster`, `stepLadder` |

Books are LOOSE stock (rule 4): `skyDBookStack` props hosted on the oak bookcases' measured shelves, the tiered tables' tiers, the Mall
bookcase's open decks, the dresser / desk tops (budget 130 per store); on a loot holder the stack's span is cut from its loot surface.
No bookcase with baked books (`lawBookcase`) is used.

## New kinds (both audits, scale)

| Kind | What | Openables | Physics | Damage | Scale check (W×H×D, contact) |
|---|---|---|---|---|---|
| `skyBooksSign` | carved walnut category header (variants 0-7: fiction, local history, maps & travel, children's books, rare books, poetry, prairie authors, new & notable); a walnut board with the Codex sign art on both faces | `none` (decor) | static `mounted`: screwed to its bookcase / cabinet top or the wall over the children's dresser; the x0.62 table sign to the tiered table's column cap | wood, never breaks | 1.05 × 0.29 × 0.04 m (face 1.01 m wide, its height from the piece aspect); on a 2.4 m oak bookcase: 1.51 × 2.69 × 0.45 m, the case grounded (4 feet), the sign flush with the case front; table sign 0.65 × 0.18 × 0.025 m |
| `skyBooksRug` | area rug (variant 0 the worn Persian-style reading rug, 1 the children's prairie play rug) | `none` (decor) | static `flat`: ~8 kg of wool pile lying flat, walked over | fabric, never breaks | 2.4 × 0.012 × 1.6 m, flat on the floor (4 corner contacts); a 1.78 m zombie is shorter than its long side |

Renders: `node tools/asset-pipeline/skyways-stores/books/scale-glb.mjs /tmp/books-scale` builds QA GLBs of the drawn kinds from the
same numbers, then `node tools/asset-pipeline/props/scale-check.mjs --prop /tmp/books-scale/sky-books-sign.glb --prop
/tmp/books-scale/sky-books-sign-on-bookcase.glb --prop /tmp/books-scale/sky-books-sign-table.glb --prop /tmp/books-scale/sky-books-rug.glb`
(viewed beside zombie `lastshift`, runtime scale 1.0). Existing kinds keep their own classes and records.

## Storage used (all opens: `OPENABLE_AUDIT`)

`mallCashwrapCounter`, `bookstoreBookcase`, `glassDisplayCabinet`, `dresserDrawers`, `cardboardBoxFlaps`, `desk`, `filingCabinet`
(openable); `cabinetTall`, `cabinetLow`, `crate` (existing). The only sealed thing the store places is the till (`cashRegister`,
the documented exception). Their Mall model files are listed in `kinds/books.ts` `STORE_BOOKS_MALL_MODELS`.

## Loot (existing purposes; Skyways v3 anchor areas only)

| Area / holder | Loot key | Rows it rolls |
|---|---|---|
| Sales floor + other storey | `mall-books` (personal) | till: water, chocolate, cola, a dressing, chips; cash-wrap / Mall bookcase drawers: the same leftovers; glass cabinets: dressings, water, chocolate |
| Children's dresser | `mall-toys` (override) | chocolate, a battery, water (the dresser's rows narrowed to the toy store's) |
| Staff desk | `mall-management` (override) | desk top: snacks, a drink, a dressing; drawers: the same (no sidearm rows) |
| Stock room | `mall-books-back` (service) | shelving: water, chocolate, dressings; cartons / crates: + beans, noodles, a torch cell |
| Office | `mall-management` | desk, low / tall cabinets, safe, filing cabinet: personal stock, no ammo |
| Staff stock corner (no back room) | `mall-books-back` (override) | as the stock room |

No loose floor piles (every store area is `noFloorLoot`). No ammo in any of the store's holders (tested).

## Palette

Sales floor: full-height walnut panelling (`wood`, lowerTop 4.0 m, 0.6 m boards), near-black walnut trim, oak strip floor, plain warm
ceiling. Other storey: oak wainscot (1.15 m) under warm cream plaster, deep green library carpet, plain ceiling. Rendered by
`world/skywaysArch.ts` class `anchor` from `ANCHOR_STYLES.books`.

## Art

Two Codex native image_gen calls (owned route), both accepted first time: the category sign sheet and the rug sheet. Crop / resize /
pack only: `tools/asset-pipeline/skyways-stores/books/build-books-art.mjs` ->
`game/public/assets/textures/skyways/stores/books/skyways-store-books-art.jpg` (1024², 236 KB), provenance
`game/public/assets/derivatives/skyways-store-books-art-20261107.json` (unapproved prototype, provider terms apply). Raw originals,
prompts and the ledger stay in the private raw backup outside Git.
