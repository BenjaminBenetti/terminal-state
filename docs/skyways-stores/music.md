# Skyways major store: Northern Groove Records (family `music`, lane STORE-MUSIC)

Task `studio-alpha-skyways-shops-20261107-054512-01`. This is the store's prop-affordance record (root `CLAUDE.md` "Props — core
design rules"; checklist `docs/prop-affordances.md`). It applies from layout version 3 (`gen/skyways/stores/`). Version 1 and 2
stations keep the frozen GAME77 dresser.

User requirement: "the record store needs actual records in the holders".

## Code

| Piece | File |
|---|---|
| Store spec: dresser hook, loot purposes, finish | `game/src/gen/skyways/stores/music.ts` |
| Dresser | `game/src/gen/skyways/stores/musicDress.ts` |
| Record stock geometry (measured rack bays, blocks, faced rows) | `game/src/gen/skyways/stores/musicStock.ts` |
| Code-drawn parts and art faces | `game/src/gen/skyways/stores/musicShapes.ts` |
| Atlas table (generated) | `game/src/gen/skyways/stores/musicArt.ts` |
| Kinds (both audits, physics, damage) | `game/src/gen/skyways/stores/kinds/music.ts` |
| Renderer and atlas preload | `game/src/world/skywaysStoreMusic.ts` |
| Tests | `game/tests/skyways-store-music.test.ts` |
| Art cook (crop / pack only) | `tools/asset-pipeline/skyways-stores/music/build-music-art.mjs` |
| CPU QA (GLB export, stock render) | `tools/asset-pipeline/skyways-stores/music/qa-music.mjs` |

Shared-file hooks (tagged `lane STORE-MUSIC`):
- `world/skywaysDestinations.ts`: draws the store's kinds;
- `world/skywaysDestRuntime.ts`: preloads the two atlases;
- `tests/cardboard-audio.test.ts`: the two record-stock kinds join the cardboard impact list.

## The record stock

The holders are the existing measured record-bin racks (`skyDRecordBins`, lane SHOPS-A's empty Meshy model). Ray probes of the GLB
show two sloped tray rows of six bays each. The bays are 0.275–0.309 m wide, with dividers about 0.1 m above the tray floor.

- A 12-inch sleeve (31.5 cm) does not fit those bays, so the bins hold **10-inch records** (26.5 cm sleeves, a real LP format).
- The faced-out wall and the dig crates show 12-inch LPs.

### Bin blocks (`skyMuBinRecords`)

Each bay of each rack holds one `skyMuBinRecords` placement (host = the rack). It is a block of filed sleeves, leaning back:
- The rearmost sleeve rests on its row's support (the cross bar's top edge, or the back wall).
- Each next sleeve stands on the measured tray floor in front of the one behind it, a little more upright.
- Plane spacing is at least the sleeve thickness, so sleeves never cross.
- The two rows step up toward the back, so behind each front cover a staircase of sleeve tops shows, as in a real browser bin.
- There are 20 block styles (10 per row). Each style has a different front cover and a sleeve count of 55–95 % of the bay's capacity.
- The dresser stocks all 12 bays of every rack. A genre card (`skyMuBinLabel`) is screwed to each rack's front apron, one genre per
  run.

### New-arrivals wall (`skyMuCoverWall`, `skyMuFacedRecords`)

- The board is wall-mounted from 0.92 m, with three ledges and the painted NEW ARRIVALS header.
- Each ledge holds one `skyMuFacedRecords` row of five 12-inch LPs (host = the board).
- The board stands on solid wall only. The 1.2 m strip in front of it is kept clear.

### Cover art

There are 64 fictional covers in all, made with Codex native image generation: four sheets of 16, cropped and packed into
`textures/skyways/stores/music/music-covers.jpg`. On every sleeve:
- the front face shows a cover;
- the top and side edges show a sliver of that cover's own edge;
- the rearmost sleeve's back shows another cover.

### What the records are

Records are **physical stock**. No record item exists and no new inventory is invented. The store's finds are the existing loot in its
holders.

## Kinds (both audits)

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact) |
|---|---|---|---|---|
| `skyMuBinRecords` | a bay's filed block of 10-inch sleeves | `none` (decor: physical stock) | **dynamic** 4.5 kg box, `pad`, `onHost` (see note 1) | 0.27 × 0.29 × 0.18 m on the 0.466 m tray floor; 2 contact lines (bottom edges) |
| `skyMuFacedRecords` | five 12-inch LPs face-out on a ledge | `none` | **dynamic** 1.8 kg, `pad`, `onHost` (see note 2) | 1.86 × 0.31 × 0.08 m on the 0.98 m ledge; 6 contacts |
| `skyMuCoverWall` | display board, three oak ledges, NEW ARRIVALS header | `none` (surface) | static `mounted` | 2.04 × 1.96 × 0.12 m from 0.92 m (ledges 0.98 / 1.48 / 1.98 m, header top 2.88 m) |
| `skyMuBinLabel` | genre card on a rack's front apron | `none` | static `mounted` | 0.25 × 0.115 × 0.006 m at 0.36 m |
| `skyMuTurntable` | belt-drive turntable on the booth console | `none` (equipment; the dust cover is gone) | **dynamic** 7 kg, `pad`, `onHost` | 0.45 × 0.11 × 0.36 m on the 0.85 m console; 4 feet |
| `skyMuHeadphones` | closed-back studio headphones with their cable | `none` | **dynamic** 0.55 kg, `pad`, `onHost` | 0.20 × 0.05 × 0.15 m on the console |
| `skyMuStool` | steel counter stool, padded seat | `none` | **dynamic** 5 kg cylinder, `pad` (floor prop) | 0.38 × 0.66 × 0.38 m; 4 feet; seat 0.66 m (counter height) |
| `skyMuGigPoster` | gig poster in a snap frame | `none` | static `mounted` | 0.66 × 0.97 × 0.03 m from 1.04 m |
| `skyMuSign` | LISTENING BOOTHS board | `none` | static `mounted` | 1.63 × 0.28 × 0.04 m from 2.2 m |

Notes:
1. A shot knocks a bin block loose inside its bay (task studio-skywalk-variety-20261107-231448-01, lane MERCH;
   `physics/merchOnHost.ts`). It then lands on the rack's declared trays (`skyDRecordBins` `shelves`) or on the floor, and never floats.
2. The ledge lip and the board hold the faced row on the static fixture. This is an explicit exception: the row of five sleeves is one
   prop, so the board declares no shelves until the row is split per sleeve.

Scale checks:
- `node tools/asset-pipeline/skyways-stores/music/qa-music.mjs --glb <dir>` writes the runtime geometry to GLB (flat colours, atlas
  faces).
- Then `node tools/asset-pipeline/props/scale-check.mjs --prop <dir>/<kind>.glb [--lift y]` for each kind.
- Every kind was viewed beside zombie `lastshift` at runtime scale 1.0.
- `--render <png>` draws a stocked rack pair, the new-arrivals wall and a listening station with the real atlases (CPU raster).

No baked loose clutter (rule 4):
- The racks stay the empty Meshy model; the stock is separate placements on their measured supports.
- The turntable and headphones are separate on-host props on the console.
- The dig crate (`skyDRecordCrate`, existing kind) is itself a packed crate of records: one 11 kg loose unit with its own classification
  (unchanged).

## Storage and fixtures (existing kinds)

- **Cash desk:**
  - an openable back counter against a flank wall: the Mall till / back counter with hutch (`mallCashwrapCounter`, five drawers and
    a cupboard; `STORE_MUSIC_MALL_MODELS`), else `cabinetLow`;
  - a staff aisle about 1.2 m wide;
  - two `shopCounter` modules with the till and a crate of new arrivals.
  - Fallback: an island counter with a `cabinetLow` on the nearest wall.
- **Stage corner:** piano, half stack and drum kit; a guitar wall; a `footlocker` road case (openable).
- **Listening booths** (multi-zone; a hall gets a two-station listening bar instead):
  - a `cabinetLow` console (openable) with a turntable and headphones;
  - one or two stools;
  - a `loungeArmchair` where it fits.
- **Back rooms:**
  - the station dresser's shelving and cartons, plus `staffLockers`, `cabinetTall`, an open `shelf` with record crates on its tiers,
    lidded `crate`s, floor dig crates, and a `desk` with an `officeSwivelChair` and a `fridge` where they fit;
  - at least two pieces of openable storage per room, with smaller openable fallbacks (`crate`, `footlocker`, `cabinetLow`);
  - with no back room: a staff corner (`cabinetTall` and `staffLockers`) by the cash desk.

## Loot mapping

Existing purposes only, scoped to this store's areas.

| Area / holder | Purpose | Rolls |
|---|---|---|
| Sales floor: till, back counter, accessory shelving (`stockShelf` devices) | `mall-music` | Tech: torch / player cells, a flare, water. Till: water, cola, cells. |
| Listening booths: console | `office-listening` (listening lounge) | Drinks and snacks (its fridge / table rows) |
| Hall listening bar consoles (per holder) | `office-listening` | Same |
| Stage road case (per holder) | `office-studio` | Water, cells, a flare, a dressing, beans |
| Stock room and office | `mall-music-back` | Shelves: cells and water. Crates / cabinets: back-of-house rows. Lockers: personal rows. Desk: office desk. Fridge: drinks. |

## Palette

- **Sales floor:** dark plum walls over a black-stained wainscot (to 1.15 m) with a brass rail; worn dark floorboards (`wood`
  0x4e3426); black raw ceiling.
- **Booths:** walnut panelling to the ceiling; deep teal carpet; dark plain ceiling.

## Tests

`game/tests/skyways-store-music.test.ts` covers:
- both audits;
- the stock geometry (in bay, on the floor, resting on its support, never crossing, distinct front covers);
- on real seeds of both formats:
  - every rack stocked in all 12 bays, hosted, on its support, inside the rack;
  - the faced rows;
  - the whole-store pieces;
  - fit and lanes;
  - validation;
  - physics;
  - on-theme loot (no ammo on the floor or in the booths);
  - the finish;
  - determinism;
- the renderer;
- the preload;
- the atlases' hashes and provenance.
