# Skyways major store — Larch & Loom Home (family `design`)

Task `studio-alpha-skyways-shops-20261107-054512-01`, lane STORE-DESIGN. Layout version 3 only (versions 1 / 2 keep their old dressing
byte for byte). Prop-affordance records for this store, per root `CLAUDE.md` "Props — core design rules" and
`docs/prop-affordances.md`.

Code: `game/src/gen/skyways/stores/design.ts` (spec: purposes, finish), `stores/designDress.ts` (dresser),
`stores/kinds/design.ts` (own kinds), `stores/designArt.ts` (generated print-atlas table), `game/src/world/skywaysStoreDesignDraw.ts`
(renderer of the own kinds), `game/src/world/skywaysStoreDesignRuntime.ts` (print-atlas preload). Tests:
`game/tests/skyways-store-design.test.ts`. QA tools: `tools/asset-pipeline/skyways-stores/design/` (`plan.mjs` top-down plans,
`parts-glb.mjs` scale-check GLBs of the code-drawn kinds, `build-art.mjs` the print atlas).

## The store
A Scandinavian home-design showroom, laid out with the anchor placement kit (entry strip, door strips, stair-mouth discs and walking
lanes reserved first; every piece through the shared placement primitive):

| Area | What stands there |
|---|---|
| By the entry | the **design desk**: the Mall cash-wrap back counter (M01, drawers + cupboard door) against a wall, a staff aisle (whole cells, open at an end), one or two service counter modules with the till |
| Front band | **textile tables**: display tables (`merchTable`) with stacks of folded throws / towels (`skyDsTextiles`) |
| Along a wall | the **kitchen display**: two or three kitchenettes (base cupboards with hinged doors, worktop, sink, wall cupboard) and an island table with stools (café chairs) and tea towels |
| Room vignettes (each on its own rug, `skyDsRug`) | **living room** (sofa to the wall or as a free-standing island, an ottoman as the coffee table, two armchairs, the arc lamp, a side table, a plant; framed prints over a wall-backed sofa); **dining set** (live-edge table, chairs round it, now and then a dresser as the sideboard with a print over it); **bedroom** (showroom bed head to the wall, a four-drawer bedside chest, a second chest or a bedside table, a lidded blanket chest at the foot, a print over the headboard); **reading corner** (egg chair, arc lamp, side table) |
| Lighting gallery | a row of arc lamps backed to a wall on a rug, a glass vitrine at its end, a table of desk lamps |
| Free walls | pale-timber bookcases (open shelves over two base drawers), dressers with a folded throw and a print, plants, planter trees, the store poster |
| Other storey (two-level) | the bedroom + lighting showroom: bedding tables, two or three bedrooms, the lighting gallery, a reading corner / living island; a vignette the sales floor had no room for moves here |
| Back rooms (every v3 store has one) | added to the station dresser's stock shelving / crates: flat-pack cartons (the Mall's openable flap-top boxes), lidded storage totes, staff lockers, a staff fridge (where a wall is free); the office keeps its desk / cupboards and gets cartons; with no back room a staff stock corner by the desk |

Finish (render-only, `ANCHOR_STYLES.design` from the spec): warm-white plaster over a pale timber wainscot (1.1 m, 14 cm boards),
pale larch boards, a plain pale ceiling; the other storey a soft sage plaster.

## Openables — every storage piece is an existing openable / holder kind
`dresserDrawers` (M45, 4 drawers), `kitchenette` (4 hinged base-cupboard doors), `mallCashwrapCounter` (M01, drawers + door),
`glassDisplayCabinet` (M02, 2 glass doors), `bookstoreBookcase` (M09, 2 base drawers + open shelves), `footlocker` (hinged lid),
`cardboardBoxFlaps` (M47, two flaps), `storageTote` (M18, lid), `staffLockers`, `fridge` (existing), `cabinetTall` (existing, staff
corner). No sealed look-alike storage of this store's own: the store kinds below have nothing to open. There is no small
drawer-nightstand kind in the game: beside a bed stands a four-drawer `dresserDrawers` (bedside chest) or an open round side table.

## Own kinds (`stores/kinds/design.ts`)
| Kind | What | Openables audit | Physics audit | Scale check (beside zombie `lastshift`, runtime scale 1.0; viewed) |
|---|---|---|---|---|
| `skyDsRug` | flat wool rug under a vignette: a field and a bound border band in a colourway (6 colourways), sized per placement | `none` (decor) | static, `flat` (1.2 cm pile under furniture: nothing to shove or tip; the walk / support code ignores props of h <= 0.02) | e.g. 2.80 × 0.012 × 2.20 m; grounded, 12 contact clusters over the whole rug; placed rugs 1.4–4 m a side, every cell under them open sales floor |
| `skyDsTextiles` | stack of four folded throws (0.42 × 0.32 m) or five folded towels (0.34 × 0.24 m) on a display table / dresser top | `none` (decor) | dynamic, 2.2 kg, pad, box, `onHost` (knocked off its static host when shot or bumped) | throws 0.43 × 0.16 × 0.33 m (on a 0.84 m table top: top 1.00 m); towels 0.35 × 0.15 × 0.25 m; grounded on the host top |
| `skyDsArtPrint` | framed art print: pale-oak frame, white mat, one of six Codex prints (0.36 × 0.62 m art) | `none` (decor) | static, `mounted` (hung on the wall) | 0.52 × 0.81 × 0.03 m; hung bottom at 1.22 m over a sofa (top 2.03), 1.385 m over a bed (top 2.19), 1.15 m over a dresser (top 1.96) |

The rugs and textile stacks are drawn by code as boxes in the Office architecture's carpet material (the approved Codex office carpet
texture T1), re-tinted per colourway, tile seams off — no new or hand-drawn texture. The prints' frames use the shared shape materials
(`wood`, `counter`); their art is the store's Codex atlas (below); without the atlas a plain board stands in.
Scale-check renders: `node tools/asset-pipeline/skyways-stores/design/parts-glb.mjs <dir>` then
`node tools/asset-pipeline/props/scale-check.mjs --prop <dir>/design-throws.glb --lift 0.84 --prop <dir>/design-rug.glb …`
(the tool skips model-less kinds, so their exact boxes are exported as GLBs).

## Existing kinds reused (classes unchanged)
Dynamic: `cafeChair` (5 kg), `ottoman` (12), `loungeArmchair` (22), `skyDEggChair` (25), `skyDArcLamp` (18), `cafeBistroTable` (15),
`pottedPlantSmall` (4), `storageTote` (4), `cardboardBoxFlaps` (3), `draftingLamp` (1.5, on-host). Static: the sofa / dining table /
showroom bed (too heavy), holders (dresser, kitchenette, cash-wrap, bookcase, vitrine, merchandise tables, counters, lockers, fridge,
footlocker), `planterTree`. Mall model files the store loads: `STORE_DESIGN_MALL_MODELS`.

## Loot (existing purposes only, Skyways anchor areas at v3)
| Area / holder | Purpose | Rows (Skyways profile = base tables) |
|---|---|---|
| sales floor + other storey | `mall-home` | displays / bookcases / dressers / footlockers / counter: water, chocolate, cola, bandage, chips, beans (what people left behind); kitchenette worktop: noodles, beans, chocolate, chips (its cupboards: the pantry rows narrowed to them) |
| lighting vitrine + desk-lamp table (per holder) | `mall-electronics` | battery, flare, water (a lighting department's spare cells) |
| stock room | `mall-home-back` | shelving / crates / totes / cartons: water, beans, noodles, bandage, battery; staff lockers: personal rows (incl. the Mall back-room rule's generic rounds); staff fridge: juice, water, cola, beans |
| office (as carved) | its own purpose (`agent-office`) | unchanged |
| staff stock corner (no back room, per holder) | `mall-home-back` | as the stock room |

No floor piles (`noFloorLoot`), no new tables, no other level touched, no fuel.
