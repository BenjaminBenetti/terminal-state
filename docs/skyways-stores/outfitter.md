# Skyways store: Coulee & Canoe Outfitters (family `outfitter`)

Task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-OUTFITTER. Layout version 3 only (versions 1 / 2 keep their dressing).
Code: `game/src/gen/skyways/stores/outfitter.ts` (spec: purposes, finish), `outfitterDress.ts` (the dresser),
`kinds/outfitter.ts` (no new kind; the Mall model list). Tests: `game/tests/skyways-store-outfitter.test.ts`.
Prop-affordance records for root `CLAUDE.md` "Props — core design rules" (see `docs/prop-affordances.md`).

## The store

| Piece | Kinds (all existing) | Where |
|---|---|---|
| Cash desk | `mallCashwrapCounter` (else `cabinetLow`) backed to a wall, a 1.2 m staff aisle, two `shopCounter` modules facing the floor, `cashRegister` on the module nearest the door, `firstAidWallKit` on the staff side | A flank wall within a few metres of the front, else the front wall beside the entry, else deeper on a flank |
| Campsite | `skyDTent` pitched mid-floor, 2–3 `skyDCampChair`, a `skyDLantern` and a `campStove` at its door | Centre of the floor |
| Canoe(s) | `skyDCanoe` hung on two ceiling cables | Over the campsite / the main aisle. Hall: underside up to 3.6 m. Double-height: 4.4 m, plus a second one at 5.7 m where it fits |
| Pack wall | 1–3 `outdoorsPlankShelving` (Mall M16) | The back wall facing the entry, else a flank |
| **The real backpack** | The `backpack` gear item, as a layout pickup | Standing on the middle unit's top plank (1.14 m) |
| Boot wall | 1–2 `shoeWallDisplay` (M19) and an `ottoman` (M24) try-on bench | A flank wall |
| Outerwear | 1–2 `clothingWallUnit` (M08) with `garmentHangingGroup` (M06) on their rails | Any free wall |
| Trail food and drinks | `stockShelf` (grocery stock), 1–2 `shopCooler` | A wall |
| Camp kitchen | More `outdoorsPlankShelving` | Free walls |
| Stock on the camp kitchen | `skyDLantern` / `campLantern` / `campStove` | Its planks |
| Floor | A second tent (`tentDisplay`, M36), tiered lantern tables (`skyDBookTable` + `skyDLantern`), `garmentRail` / `garmentRailRound` + garment groups, back-to-back `retailGondola` aisles (M03) with `campStove` stock, a `bicycle`, 3 `skyDPoster` | The rest of the floor |
| Back rooms | The station dresser's shelving, cartons and crates; this lane adds `staffLockers` (else `cabinetTall` / `filingCabinet`), 2–3 `cardboardBoxFlaps` (M47) and a `storageTote` (M18) | Stock rooms. A room with no free wall turns one station wall shelf into the lockers in place (same width, same wall). The carved agent office is relabelled "Staff office" |

No store without a back room exists since the primary's back-room fallback landed. The dresser still keeps a staff stock corner for
that case: lockers, shelving, a tall cabinet and cartons along the cash desk's wall.

## The real backpack (user: "camping store fake backpack unacceptable")

- **The item.** The v3 store places no `skyDBackpack` decoration-only lookalike. The pack wall shows ONE genuine `backpack` gear item
  (`items/gear.ts`: slot `backpack`, its own 12 slots). It is not the airtank.
- **How it is placed.** It is a layout pickup (`layout.pickups`, count 1, with its own yaw facing the aisle) standing on the top plank
  of a static holder. Its span is cut from the plank's loot surface, so no lot overlaps it.
- **What the game does with it.** `gear/system.ts` turns it into a grounded bag `found:<layout pickup index>` on the section's first
  build. On that bag:
  - tap E opens it (storage);
  - hold E, or "Wear it", wears it (the same stack: uid and contents kept).
- **Finite and stable.**
  - The find is seeded with the layout: a fresh generation puts it at the same index and position.
  - It is converted once (the section's bag record, `init`).
  - Left lying, it comes back as the same bag (id and uid) after a teardown / build or a save / load.
  - Once taken it never respawns.
- **Proof.** Every point above is covered by `skyways-store-outfitter.test.ts`.

## Openables (root rule 1)

- **Storage kinds placed.** All are openable through the existing openables / ContainerManager:
  - `mallCashwrapCounter` (5 drawers + a cupboard);
  - `cabinetLow` / `cabinetTall` (doors);
  - `staffLockers`;
  - `filingCabinet`;
  - `shopCooler` (doors);
  - `firstAidWallKit`;
  - `cardboardBoxFlaps` (flaps);
  - `storageTote` (lid).
- **What the back rooms already held.** The station dresser's `crate`s (lids) and the office's `desk` / `safe` are openable too.
- **Open holders.** Plank shelving, the boot wall, wall bays, gondolas, stock shelving and counters have their loot on open surfaces.
- **Exceptions.** None of this lane's storage. The tent's zipped door (`skyDTent`, exception, decor) and the till (`cashRegister`) are
  the kit's existing classified exceptions. The station dresser's sealed `cartonStack`s keep their existing exception.

## Physics (root rule 2)

| Class | Kinds |
|---|---|
| Dynamic: loose things | `skyDCampChair`, `skyDLantern`, `campLantern`, `campStove`, `garmentRail` (castors), `garmentRailRound`, `ottoman`, `bicycle`, `cardboardBoxFlaps` / `storageTote` (spill holders) |
| Static: fixtures and holders | Counters, the cash-wrap counter, shelving, the boot wall, clothing bays, gondolas, coolers, lockers, cabinets |
| Static: anchored | The display tents |
| Static: mounted | The canoe |

- **Hosted stock.** Lanterns and stoves on a static host's plank / deck are on-host decor.
- **Riders.** Garment groups ride their rail.
- **The backpack.** It stands on a static holder, so it never floats.

## Scale (root rule 5)

- **No new kind.** Every kind is an existing, already scale-checked kind at its existing runtime fit.
- **The pack wall host.** `outdoorsPlankShelving` was re-checked for the backpack display:
  - command: `node tools/asset-pipeline/props/scale-check.mjs --kind outdoorsPlankShelving`;
  - result: 1.50 × 1.74 × 0.48 m, grounded with 4 contacts, main surface at 1.14 m;
  - pipe posts at the unit's ends only, rising to 1.74 m.
- **The bag on its plank.** The 0.33 × 0.32 × 0.52 m bag stands front-aligned within ±0.15 m of the middle, clear of the end posts.
  Its top is at 1.66 m, under the posts' tops.

## Loot

| Area / holder | Purpose | Rows |
|---|---|---|
| Sales floor | `mall-outdoors` | Flares, torch cells, water, beans, noodles, a dressing |
| Counter till | `mall-outdoors` | Water, flare, battery |
| Coolers | `mall-outdoors` | Water, cola, juice |
| Cash-wrap counter | Its own table | Water, battery, bandage |
| Stock rooms and the staff office | `mall-outdoors-back` | Water, beans, noodles, flares, plus back-of-house leftovers |
| Lockers, cartons, tote, filing cabinet | Their own tables | The lockers' personal rows include the existing small sidearm-ammo rule |
| Desk | `mall-outdoors-back` | The Mall office desk rows |
| First-aid wall kit | Per-holder purpose `first-aid-room` | Bandage, medkit, water |

There are no floor piles (the store areas are `noFloorLoot`), no new tables and no fuel rows.
