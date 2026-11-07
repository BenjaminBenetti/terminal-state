# Skyways major store: Glasshouse Garden Co. (family `garden`)

Lane STORE-GARDEN, task studio-alpha-skyways-shops-20261107-054512-01. Layout version 3 only (versions 1 / 2 keep their old dressing).

- Code: `game/src/gen/skyways/stores/garden.ts` (spec: purposes, finish), `stores/gardenDress.ts` (the dresser),
  `stores/kinds/garden.ts` (the two new kinds), `game/src/world/skywaysStoreGarden.ts` (their drawing).
- Tests: `game/tests/skyways-store-garden.test.ts`.
- Formats: double-height (65 %) or hall (35 %). Every v3 store has at least one back room. The stock room is the potting shed;
  there may also be an office.

## Layout

The frame is the AnchorKit's: `u` runs along the storefront and `v` runs into the store. The sales floor can be several pieces
around an inset back room. Lanes are reserved from the entry to every door, and the main aisle is kept clear.

- **Entry band.** A stack of shopping baskets by the door. Two or three spinner racks with seed packets flank the way in. Tiered
  flower stands face the lane. Tall planters stand by the front windows.
- **Cash desk.** Placed at the front, on the roomier side wall. Two `shopCounter` modules face the shop, and the till module has
  the cash register. Behind them is a staff aisle of at least 1 m. The Mall back counter (`mallCashwrapCounter`: 5 drawers and a
  cupboard) stands against the wall behind them. A drinks cooler (`shopCooler`) sits beside it. If the wall is free, a first-aid
  kit hangs next to the back counter.
- **Potting and tool wall.** Placed on the other side wall. It has 2 or 3 potting benches (`cabinetLow`, two doors) with geranium
  pots on their worktops. A tool pegboard is mounted 1.15 m up above each bench, and more pegboards fill the free wall, up to 4
  in all. The wall also has a rolling tool chest and a step ladder. If doors cut the wall up, the benches move to the back wall
  or the other side wall.
- **Back wall.** Two or three pallets of bagged soil (`storeGardenSoilPallet`), supply `stockShelf` units (cleaning, parts and
  carton stock) and pipe-and-plank shelving (`outdoorsPlankShelving`).
- **Big planters.** Planter trees and potted palms by the windows, in the back corners and along the side walls. If the walls are
  taken, they go out on the floor.
- **Bench field.**
  - Slatted plant benches (`skyDPlantBench`) stand end to end in runs, with 1.5 m between runs and 1.3 m aisles between lines.
  - The runs go parallel to the storefront or into the depth, whichever holds more benches.
  - Geranium pots fill about 60 % of each bench top.
  - If the floor is too cut up for runs, tiered flower stands stand as islands instead.
- **Hanging-basket zone.**
  - Basket rails (`storeGardenBasketRail`) hang over the benches and turn with them.
  - The double-height glasshouse gets 3 to 5 rails, with the baskets' bottoms at 2.6 to 3.4 m. A hall gets 1 or 2 rails at 2.4 m.
  - Each rail has 5 hooks. Their baskets are geranium pots hung in the rings.
  - Each rail hangs from two rods drawn up to the ceiling. The rods keep at least 0.55 m from the light fixtures.
- **Extras.** A wheelbarrow, small potted plants and two garden posters (the existing destination art).
- **Potting shed (stock room).** The station's shelving, cartons and crates stay. Added, as far as they fit:
  - a tool locker (a tall two-door cabinet, else a locker bank, else a tool chest);
  - a staff fridge and a first-aid kit on the wall;
  - a tool chest and a potting bench with pots;
  - lockers, two lidded totes and a taped carton.

  If the walls are full, one station shelving slot becomes the locker bank. It keeps the same prop index and the same 1.2 m slot.
- **Office.** Gets a staff fridge, a first-aid kit, lockers and a tote.
- **No back room.** This can't happen at v3, but the dresser handles it: a staff stock corner by the cash desk (shelving and a tall
  cabinet).

## Openables (rule 1)

Every storage-looking kind the garden places opens. Each is `openable` or `existing` in `OPENABLE_AUDIT`:

- `mallCashwrapCounter`: 5 drawers and a cupboard
- `cabinetLow`: 2 doors
- `cabinetTall`: 2 doors
- `rollingToolChest`: 8 drawers
- `shopCooler`: glass door
- `fridge`
- `staffLockers`
- `storageTote`: lid
- `cardboardBoxFlaps`: flaps
- `firstAidWallKit`: door
- the station's crates, desk, safe and filing cabinet

Each store has 9 to 16 openable holders (seeds 1 to 24). The test requires at least 8 per store and at least 2 per back room.

The soil pallet is the one new explicit exception. Its bags are sealed, heat-welded merchandise, and soil is not an item.

## Loot

There are no new tables. Area purposes are set in `GARDEN_PURPOSES`, and per-holder purposes in `GARDEN_HOLDER_PURPOSE`.

| Role / holder | Purpose | Rows it rolls |
|---|---|---|
| Sales floor: tills, potting-bench cupboards, tool chest, supply shelving | `mall-hardware` | battery, flare, water, bandage |
| Cash desk back counter (`CASHWRAP_ROWS`, narrowed) | `mall-hardware` | water, battery, bandage |
| Drinks cooler | `mall-hardware` (sales cooler) | water, cola, juice |
| Pipe-and-plank shelving (per holder) | `mall-outdoors` | flare, battery, water, beans, noodles, bandage |
| Potting shed: shelving, tool locker, crates, tool chest | `mall-hardware-back` | battery, flare, water, plus beans, noodles and bandage (crates / chests) |
| Totes and cartons in the shed (own tables, narrowed) | `mall-hardware-back` | water, beans, noodles, battery, bandage |
| Staff fridges (per holder) | `mall-food-back` | juice, water, cola, beans |
| First-aid kits (per holder) | `mall-first-aid` | bandage, medkit, water |
| Staff lockers (per holder, including the station's in the store) | `mall-management` | water, chocolate, bandage (no sidearm rounds) |
| Office | `mall-management` | snacks, water, bandage, battery |

Ammo: none in any garden holder (the test checks this). There are no floor piles, because the store areas are `noFloorLoot`.

## Physics (rule 2)

**Dynamic (move when shot or bumped):**
- geranium pots (2.5 kg, on-host decor on static hosts only: benches, potting benches, rails);
- potted palms (40 kg);
- small potted plants (4 kg);
- the wheelbarrow (18 kg);
- spinner racks (14 kg);
- the step ladder (7 kg);
- the basket stack (3 kg);
- totes and cartons (spill holders).

**Static:**
- plant benches (fixture, the host of their pots);
- planter trees (too heavy);
- flower stands (fixture);
- holders (holder);
- pegboards (mounted);
- the new soil pallet (too heavy, ~400 kg);
- the new basket rail (mounted).

## New kinds (rule 5: scale checked beside the zombie)

Both kinds are code-drawn box parts in the existing shape materials. They have no model, art file or texture. The renderer hook
is one line in `world/skywaysDestinations.ts`.

| Kind | W × H × D | Contact | Classes |
|---|---|---|---|
| `storeGardenSoilPallet` | 1.20 × 0.77 × 1.00 m | grounded, 12 runner contact clusters over 1.20 × 0.96 m; deck 0.144 m; five 0.125 m bag layers | openables `exception` (sealed bags); physics static, too heavy; damage plastic |
| `storeGardenBasketRail` | 3.00 × 0.95 × 0.25 m with its baskets | hung, baskets' bottoms ≥ 2.40 m (rail top ≥ 3.35 m); 5 rings 0.30 × 0.24 m hold the 0.26 × 0.35 × 0.19 m geranium pots | openables `none`; physics static, mounted; damage steel |

Render: `node tools/asset-pipeline/skyways-stores/garden/scale-check.mjs`. It exports the parts as GLBs, bundled from the TS,
then renders them with `props/scale-check.mjs` beside zombie `lastshift` at runtime scale 1.0. The render was viewed. Output goes
to `qa-artifacts/scale-check/garden/`, which is git-ignored.

## Palette (`finish` → `ANCHOR_STYLES.garden`)

Taken from the user's references 06 (skylight planter court) and 02 (planter gallery):

- walls: brick-red glazed tile to the ceiling (`tile`, `0x8c4a35`, `lowerTop` 9) with dark timber skirting;
- floor: terracotta paver tile (`0xa0603f`);
- ceiling: the raw roof structure in a dark timber tone (`raw`, `0x5c4331`), like the court's slatted-wood ceiling.

## Mall models (`STORE_GARDEN_MALL_MODELS`)

`mall-mall-cashwrap-counter.glb`, `mall-outdoors-plank-shelving.glb`, `mall-storage-tote.glb`, `mall-cardboard-box-flaps.glb`.
