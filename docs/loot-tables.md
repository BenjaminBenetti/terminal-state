# Loot tables — per-level tuning guide

Loot tables decide what the player can find, where, and how much. Each **logical level** (Subway, Office Space, later
deeper levels) selects a **loot profile**. Each place loot can appear (a desk top, a cabinet, a toilet stall) plugs into a
named **slot category**. Both current levels use today's numbers with no overrides. A refactor must leave the golden test
unchanged; a tuning change will move it.

## Where the data lives

`game/src/items/lootTables.ts` holds all the loot data. It has no three.js and no logic beyond small lookups.

| What | Name in `lootTables.ts` |
|---|---|
| Profiles per level | `PROFILES`, `lootProfile(levelId)`, `BASELINE_PROFILE` (level-agnostic default) |
| Rate tables a profile rolls with | `BASE_TABLES` (`LootTables`) |
| Slot categories | `SLOT_CATEGORIES`, `HOLDER_SLOTS` (holder kind → slot), `COMPARTMENT_SLOT` (drawers / cupboards) |
| Per-kind holder defaults | `HOLDER_EMPTY`, `HOLDER_LOTS`, `HOLDER_MOD`, `P7_HOLDER_LOOT` (the generated holders) |
| Plain-room (legacy) tables | `AREA_WEIGHTS`, `LEGACY_POOL`, `VENDING_FOOD`, `FULL_ROOMS` |
| Named shared tables | `STORE_DRINKS`, `STORE_SNACKS`, `storeTill()`, `storeKitchen()`, `CACHE_CRATE`, `OFFICE_DESK`, `OFFICE_DRAWERS`, `TENANT_*` |
| Openable holders' own tables | `*_ROWS`, `OPENABLE_TABLES` |
| Scarcity economy | `THEME_ECONOMY`, `OFF_THEME_WEIGHTS`, `GLOBAL_POOL`, `THEME_OF_TYPE`, `LIMB_ECONOMY` |
| Eligibility | `HOLDER_ALLOW` (e.g. no snacks in toilets), `RANDOM_HOLDERS` (bins), `CONTAINER_THEMED` (the container, not the room, decides its rows) |
| Stack sizes | `BOX_COUNT`, `BIG_BOX_HOLDERS`, `HANDFUL`, `HANDFUL_FALLBACK` |
| Loose floor finds | `FLOOR_ECONOMY`, `SUBWAY_FLOOR`, `OFFICE_FLOOR` (with `OFFICE_FLOOR_TILT`), `PUBLIC_FLOOR_WEIGHTS` (where finds land) |
| Rare gear | `GEAR_LOOT` (mean / cap / weights) |
| Curated rewards (the Office roof cache) | `REWARD_TABLES`, `ROOF_CACHE`, `ROOF_CACHE_KEY`, `rewardTable()`; `LootTables.rewards` |
| Curated find rewards (the Office roof find: a gun + its own ammo, or gear) | `REWARD_FINDS`, `ROOF_FIND`, `ROOF_FIND_KEY`, `rewardFind()`; `LootTables.rewardFinds` |
| Service annexes (Track 2): stash, picked-over storage, per-annex floor program | `ANNEX_STASH_KEY` / `ANNEX_STASH` (`ANNEX_STASH_ROWS`), `ANNEX_PICKED_KEY` / `ANNEX_PICKED` (`ANNEX_PICKED_ROWS`), `ANNEX_FLOOR` (`LootTables.floor.annex`) |

Per-room stock stays with its room in `gen/purposes.ts` (each purpose's `loot` per holder kind). That is where "this room
makes sense" lives. Purposes reference the named shared tables above.

The old modules re-export the same objects: `items/lootEconomy.ts`, `gen/gearLoot.ts`, `gen/purposes.ts` and
`world/openablesSpec.ts`.

## How a roll flows

1. **Profile.** `game.ts` passes `lootProfile(key.level)` to `ContainerManager.build`.
   - Generators use their own level's profile: `generateStation(seed, {loot})` defaults to `subway`;
     `generateOfficeLevel(ctx, loot)` defaults to `office`.
   - Office Space is **one** logical level. All its physical storeys share one profile. Its floor program still runs
     once per storey.
2. **Slot.** `holderTable(kind, areaKey, profile)` in `items/loot.ts` resolves the holder's slot, its source, the empty
   chance, the lot range and the item rows. The source is the first of these that exists:
   - the holder kind's **own** table (openable containers; narrowed to what the room's purpose stocks);
   - the area **purpose** table for that kind (gen/purposes.ts);
   - the **legacy** room-type tables: `AREA_WEIGHTS` × `HOLDER_MOD`, then `LEGACY_POOL`.

   Fixtures (fire / AED cabinets) roll nothing.
3. **Roll.** The holder rolls on its seeded stream (`loot:${kind}:${index}`): empty?, lot count, then an item per lot,
   plus its stack size from `BOX_COUNT`.
4. **Scarcity.** `scarceFinds` in `items/lootEconomy.ts` keeps ammo and crafting materials exactly as rolled. Each other entry survives with
   the theme's `keep` chance and may be re-themed. `HOLDER_ALLOW` limits what a fixture may hold. Some HP-med finds become
   limb treatments.
5. **Fit.** `packItems` in `items/lootLayout.ts` places each item on a real surface. An item that fits nowhere is
   dropped.

Contents are rolled once. They are finite and remembered by lot id (`run/memory.ts`). Nothing refills or re-rolls.

Loose floor finds and rare gear are decided when the layout is generated:
- the floor programs above;
- `rollLevelGear(levelSeed, levelId, sections, profile)`: **one** roll per logical level, keyed `gear-roll:${levelId}`.

## Slots: how a holder kind plugs in

| Slot | Holder kinds |
|---|---|
| `surface` | table, desk top, security-desk top |
| `countertop` | shop counter, back counter, kiosk stall, kitchenette top |
| `shelf` | shelf, stock shelf, shopping cart |
| `container` | tall / low cabinet, crate, staff lockers, filing cabinet, safe, tool chest, office lateral filing cabinet, executive desk, server cabinet / rack, archive box, **every drawer / cupboard compartment** |
| `foodPrep` | grill, espresso, wok, deli, blender lines, hot-dog cart, bus cart |
| `vend` | vending machine, snack rack, display case, newspaper box |
| `cold` | drinks cooler, fridge, chest freezer |
| `medical` | first-aid cabinet, wall first-aid kit, crash cart, stretcher, lab bench, exam table, specimen fridge |
| `arms` | gun locker, vault safe |
| `junk` | trash can, wheelie bin |
| `stash` | toilet stall |
| `fixture` | fire-extinguisher cabinet, AED cabinet (baked contents, no loot) |

A slot is a classification and an override target. Each kind keeps its own numbers in `HOLDER_EMPTY` / `HOLDER_LOTS` /
`HOLDER_MOD` or in its own table.

**New holder kind:**
1. Make it a loot holder as today (`items/loot.ts` kinds, surfaces in `items/lootLayout.ts`).
2. Add it to `HOLDER_SLOTS`.
3. Give it per-kind defaults: `HOLDER_EMPTY` / `HOLDER_LOTS` / `HOLDER_MOD`, or an `OPENABLE_TABLES` entry if it is an
   openable container, or `P7_HOLDER_LOOT` if it is a generated holder.
4. Give it eligibility in `HOLDER_ALLOW` if it should only take certain categories. The list must cover every category of the
   kind's own rows: a kept original roll keeps its item.
5. Openable storage whose contents follow the CONTAINER, whatever room it stands in (a specimen fridge holds medicine in any
   room): add it to `CONTAINER_THEMED`. Its own rows are then not narrowed to the room purpose's rows. The room's theme still
   steers the scarce re-themes within `HOLDER_ALLOW`. Without it, an openable's own rows are narrowed to what the purpose stocks
   (a pharmacy bin holds pharmacy things).

`tests/loot-tables.test.ts` fails if a holder kind has no slot or no defaults. The office-overhaul storage (lateral filing
cabinet, executive desk, lab bench, exam table, specimen fridge, vault safe, server cabinet / rack, archive box) is the worked
example: `docs/prop-affordances.md` and `tests/office-openables.test.ts`.

**New slot:**
1. Add the name to `SLOT_CATEGORIES`.
2. Move the relevant kinds to it in `HOLDER_SLOTS`.

Every slot must be used by at least one kind; a test checks this.

**New named table:** add an exported constant with an unambiguous name, then reference it from the purposes that share it.

## The knobs

| Knob | Meaning | Where |
|---|---|---|
| **Weight** (relative) | Which row of a table, or which category, a draw picks. Lowering one shifts draws to the other rows of the same table. | table rows; `AREA_WEIGHTS` / `HOLDER_MOD`; `THEME_ECONOMY.weights`; `OFF_THEME_WEIGHTS` |
| **Keep** (availability) | Chance that a rolled non-ammo entry survives the scarcity cut. Lowering it removes finds without redistributing them. | `THEME_ECONOMY[theme].keep` |
| **Empty / lots** (amount per holder) | How often a holder is empty, and how many lots it rolls. | `HOLDER_EMPTY`, `HOLDER_LOTS`, a table's `empty` / `lots` |
| **Stack size** | Rounds per ammo box or handful. | `BOX_COUNT`, `HANDFUL` |
| **Floor chance / count** | Chance of each loose find, and how many copies. | `SUBWAY_FLOOR`, `OFFICE_FLOOR` |
| **Gear** | Rare gear count mean, cap and weights. | `GEAR_LOOT` |

### Overrides (`LootOverrides`, per profile)

All overrides are optional multipliers (1 = unchanged, 0 = never). They are applied when the roll is resolved, by item id,
economy category or slot. They are never applied by table identity.

| Override | Effect |
|---|---|
| `itemWeight[id]`, `categoryWeight[cat]` | Multiply row weights. Also apply to legacy category picks and to scarcity re-picks. |
| `keep[cat]` | Multiplies the keep chance of rolled entries of that category (capped at 1). Ammo is always kept exactly. |
| `slot[slot].empty` / `.lots` | Multiply a slot's empty chance (capped at 1) and its lot range (both ends rounded). `lots: 0` means the slot never holds anything. |
| `floor.chance[cat]` / `floor.count[cat]` | Multiply loose-find chances (capped at 1) and copy ranges. |
| `gear.mean` (multiplier), `gear.cap` (absolute), `gear.weight[id]` | Change the rare gear roll. It is still one roll per logical level. |

How overrides combine:
- Where several apply, they multiply. For example, a bandage row's weight is `w × itemWeight.bandage × categoryWeight.med`.
- An untouched profile returns the **same** arrays and numbers. That is why both current levels stay identical to before.
- A table whose rows all reach weight 0 becomes `[]`, which is an intentional **empty table = no loot** (nothing is drawn).

To replace a rate table wholesale, give a profile its own `tables: {...BASE_TABLES, floor: {...}}`.

### Removing a category completely

`keep` only affects entries that were rolled as that category. A kept entry of another category can still be re-themed
into it. To remove a category entirely, combine `keep[cat]: 0` with `categoryWeight[cat]: 0`.

## Adding a profile (a future level)

1. Add the level id to `levels/types.ts` / `levels/registry.ts` as usual.
2. Add its entry to `PROFILES`. `Record<LevelId, …>` makes this mandatory.
3. If the level reuses a generator, pass its profile: `generateStation(seed, {startWeapon, loot: lootProfile('deep')})`.
4. Run the validation and golden tests (see below).

### Worked example: a deeper level with less food

```ts
deep: {
  id: 'deep', label: 'Deep Tunnels', tables: BASE_TABLES,
  overrides: {
    categoryWeight: {food: 0.4}, // food rows / re-picks are 40 % as likely (drink gains a little share where tables mix)
    keep: {food: 0.5},           // rolled food survives the scarcity cut half as often
    floor: {chance: {food: 0}},  // no loose food (food-company floor finds); add count: {med: 0.5} here for half the loose dressings
    // optional: slot: {foodPrep: {empty: 1.5}}, gear: {mean: 0.7}
  },
},
```

This is the test-only `REDUCED_FOOD` profile in `tests/loot-tables.test.ts`, which is not registered to any level. Over
6 Subway stations and 2 office levels it measured:

| Category | Baseline | Reduced food |
|---|---|---|
| Food (holder units) | 242 | 96 (×0.40) |
| Drink | 292 | 352 |
| Med | 102 | 99 |
| Ammo | 1929 | 2041 |
| Battery + flare | 41 | 37 |
| Office floor food | 1 | 0 |

The Subway's loose pickups were byte-identical (its floor program has no food).

## Explicit exceptions (not table-driven)

- **Weapon finds and their paired ammo.** In `gen/weaponFinds.ts` this includes the `ammo_9mm` floor boxes for a pistol start.
  In `gen/office/spawns.ts` it is the weapon plan and placement.
- **The starter kit** (`run/starter.ts`).
- **Fixtures with baked contents.** Fire and AED cabinets: `loot: null`.
- **Vending pry / spill and bin spill mechanics.** These move existing lots; they do not roll new ones.
- **Shelf filler stock.** It is decoration, not loot.
- **The roof reward** is table-driven but exempt from the scarcity cut. See the next section.
- **Where things land.** Floor-find area weights (`PUBLIC_FLOOR_WEIGHTS`, purpose `floor`, `FLOOR_ECONOMY.themeWeight`) and
  the multi-level share in `gen/levelGenDress.ts`, which moves existing loose ammo and dressings. These are data, but
  overrides do not reach them.

## Roof reward

The Office roof is the end of the level, so it holds two guaranteed rewards: the cache (below) and the roof find beside it (next
subsection). The deck is outdoors and toxic without a working mask.

- **Where it is.** One supply crate stands on the roof deck, its back to the water tower (other roof plant if the tower has no
  free side). The lid faces out, with 0.8 m of open deck in front of it. The crate keeps clear of the hatch, the ladder head, the
  core and the parapet walkway. `placeRoofReward` in `gen/office/roof.ts` places it after the roof dressing, on its own RNG fork,
  so the rest of the roof dressing is unchanged. `layout.office.roof.reward` records it.
- **How it is keyed.** The crate's loot key (`PropPlacement.purpose`) is `ROOF_CACHE_KEY` (`'roof-cache'`). Its table is
  `ROOF_CACHE` in `REWARD_TABLES`, which `BASE_TABLES.rewards` points to.
- **Value.**
  - One top-tier medicine, always: a first-aid kit (2 in 3) or a trauma kit (1 in 3).
  - One full crate box of generic ammo, always: about a third each 9mm (6–10), 5.56 (8–12) and 12-gauge (3–6).

  That is one medicine and one box per Office run, not more loot per floor.
- **The exception.** The reward is rolled exactly as the table says:
  - no scarcity keep cut, no re-theming and no limb-treatment conversion;
  - every rolled lot is placed. If the first pack does not fit, `packReward` re-packs on up to 16 seeded streams.

  The crate floor is 0.55 m wide. A first-aid kit and one box fit together in at least 93 % of packs. A third item fits beside a
  first-aid kit in under 15 %, so the cache has no third item.
- **No gear in the cache.** The cache adds no rare-gear roll. Gear stays one roll per logical level. The roof find (below)
  is a separate curated item laid beside it.
- **Finite and remembered.** The crate rolls once on its holder stream (`loot:crate:<index>`), like every holder. Run memory
  remembers taken lots by holder key and lot id, so they stay taken after climbing the ladder, changing floors, or leaving the
  level and coming back. Retry and New Game behave as for all loot.
- **Tuning per level.** Item and category weight overrides reach the reward's rows. Keep and slot overrides do not. To change
  or drop the reward, replace `tables.rewards`: `{}` means no roof reward.
- **Tests.** `tests/office-roof-reward.test.ts` covers placement, reachability, contents, the scarcity exemption, fit, memory,
  that no other storey changes, and that the Subway is unchanged.

### Roof find (a gun or gear beside the cache)

User feedback (2026-10-30): "I got just a med kit in this run ... It should have at least 1 gear or weapon item up there."

- **Why a run showed only a medkit.** Nothing was lost. The cache always held its two lots, one medicine and one small ammo
  box (3–12 rounds of a random caliber, unusable with the pistol start in about 2 runs in 3). Nothing else was ever placed
  on the roof. A gun cannot go in the crate either: holders draw no gun models, and the crate floor fits one row.
- **What it is.** `ROOF_FIND` (`REWARD_FINDS`, `BASE_TABLES.rewardFinds`, key `ROOF_FIND_KEY` `'roof-find'`). Exactly one
  item per logical Office run:
  - a non-starter long gun (2 in 3): the rifle or the shotgun, each with a box of its own caliber beside it (the weapon-find
    convention, `WEAPON_FIND_AMMO`: 20 × 5.56 or 6 shells);
  - or a protective gear piece (1 in 3): an armor vest or a hard hat.

  A row naming the run's start weapon is never placed.
- **Where it is.** `placeRoofFind` in `gen/office/roof.ts` lays it on the deck right beside the cache, at the cache's sides or
  front corners. Otherwise it goes to the nearest spot round the cache, then any deck spot.
  - It uses ordinary layout pickups with `reward: 'roof-find'`, appended after every other pickup, so nothing else changes
    index.
  - Spots are verified after placement: a walkable deck cell reachable from the start, a clear square (0.48 m half-size for
    the gun, 0.22 m for its box), clear of roof plant, plinths, vents, the hatch and ladder head, and the core.
  - `roofRewardIssues` re-checks the result. The generator retries a level without it, so the find can never silently vanish.
  - `layout.office.roof.find` records it.
- **Deterministic and finite.** The item is rolled once on its own stream (`reward-find:roof-find` × the layout seed). Retry,
  revisits, the ladder, pause and bag use never re-roll it, and run memory keeps it taken. A New Game seed rolls again.
- **The exception.** The roof find is an explicit roof exception. It is not a holder roll, it has no scarcity cut, and it is
  separate from the level's one rare-gear roll. Every storey's holders, floor finds, weapon finds and gear placement are
  byte-identical to before (`tests/loot-golden.test.ts` stage 4).
- **Tuning.** Item weight overrides reach its rows. To drop it, replace `tables.rewardFinds` with `{}`. It appears in the
  loot reference as `reward-find:roof-find`.
- **Tests.** `tests/office-roof-reward.test.ts` (roof find blocks) and `tests/loot-reference.test.ts`.

## Service annexes (Track 2)

<!-- Track 2 — Beyond the Station (lane CONTENT) -->

A track tunnel past the station's bed ends can lead, through a side door, to a seeded **service annex** — a cramped, dark
back-of-house of plant rooms, stores, closets and service corridors (0–2 per level, each ~25 % of the Subway's walkable exploration
area; generated by `game/src/gen/trackExt/`). It is part of its logical level: same loot profile, same economy, same run memory.
Its content comes from `game/src/gen/annexContent.ts` on its own fork (`track-ext-content`), APPENDED after every core record, so
every core holder index, pickup index and persistence key is unchanged (`tests/loot-golden.test.ts` stage 7 proves the core views
reproduce the earlier pins byte for byte).

- **Rooms.** Every annex area takes an EXISTING back-of-house purpose — pump room, electrical room, workshop, maintenance stores,
  custodial room, janitor / electrical / supply closet, service corridor — dressed by the core dresser's own rules (purpose rules,
  the composer, the iteration-07 dresser). Its holders are the existing kinds with their existing openables / physics classes.
- **Intact vs picked over.** GEN's annexes are dozens of small rooms (census: ~68 areas, ~100 holders per annex) and those purposes'
  tables are ammo-heavy (ammo is never thinned): stocked as-is, two annexes added +390–570 rounds of holder ammo to a level (1.2–2×
  the core's). So only each annex's **deepest** holders keep their room purpose's table — one per 230 m² of annex floor (~7 per
  annex; area depth from the entry door: the reward is further in) — and every other annex holder is real, openable, finite storage
  that someone already went through: loot key `ANNEX_PICKED_KEY` (`'annex-picked'`, purpose `annex-picked`, theme `service`):
  `ANNEX_PICKED` = water / tins / snacks / a dressing / a cell, 1 lot, empty 0.9, never ammo (the Office's `office-fill` precedent).
- **Stash.** One holder per annex (two when it has ≥ 7 rooms) — a crate, then a tall cabinet — against a wall of a dead-end room:
  loot key `ANNEX_STASH_KEY` (`'annex-stash'`, purpose `annex-stash`, theme `personal`): `ANNEX_STASH` = water 1.2, beans 1,
  bandage 1, medkit 0.15, battery 0.5, flare 0.4, generic ammo 1.4 (~1/3 each caliber); 2–3 lots, empty 0.15; the scarcity cut
  applies (kept non-ammo finds re-themed to food / drink / medicine).
- **Floor program** `ANNEX_FLOOR` (once per annex, the Subway program's shape): a 5.56 box (30) n 0–1, a 12-gauge box (8) n 0–1;
  medkit n 0–1 and bandage n 1–2, each kept with `FLOOR_ECONOMY.medKeep` (0.2); a battery (chance 0.6) and a flare (0.45). Landing:
  the annex rooms' purpose `floor` weights (ammo / med) and `FLOOR_ECONOMY.themeWeight` (battery / flare), on free floor cells off
  the door zones. The loot reference shows it as the `annex` variant of each annex-bearing level's floor program, outside the exact
  per-level totals (the annex count is a seeded census quantity).
- **Never multiplied.** No guaranteed high-tier item: every stash may be empty, every floor find is a chance or passes the keep cut.
  The level's ONE rare-gear roll and mask roll never land in an annex (`gearAreaWeight` = 0 for extension areas; gear spacing
  ignores the annex finds), no weapon find is placed there, and the Office roof cache / roof find are untouched.
- **Measured** (lane CONTENT census; Subway 24 seeds 1.12 annexes / level, Office 10 seeds 1.5): per annex ~150–160 props, ~7–8
  intact + ~90–95 picked-over + 2 stash holders; holder finds ~34–39 ammo rounds + ~1.8 other finds (of them the stash ~6–7 rounds +
  ~0.8 find); floor finds ~9–14 rounds of 5.56, ~3 of 12-gauge, ~0.3–0.5 flares, ~0.6 batteries, ~0.4 dressings, ~0.1–0.2 first-aid
  kits. The core's holder ammo is ~250–265 rounds per level (+ its floor boxes): one annex adds roughly an eighth of a level's
  ammo, worth the dark detour, not a new economy.
- **Finite and remembered** like every holder: contents roll once per holder stream, run memory keeps taken lots taken, nothing
  refills on revisit; Retry restores the level-entry state.

## Ammo

Ammo items are calibers: `ammo_9mm`, `ammo_556` and `ammo_12ga` (`items/calibers.ts`). Weapons load by caliber.

In the tables, ammo is ordinary item rows plus per-item count data (`BOX_COUNT`, `HANDFUL`). Nothing in the profile API names
a weapon or a calibre.
- **Generic ammo rows.** A table's rifle / shotgun ammo is generic: `genericAmmo(w)` from `items/calibers.ts` splits the row
  weight `w` evenly (about a third each) over the caliber items. Example: `CACHE_CRATE` uses `...genericAmmo(3.4)`.
- **9mm-only rows.** Rows that only ever held 9mm stay `ammo_9mm`: office desks and drawers (`OFFICE_DRAWERS`), police /
  security cabinets in `gen/purposes.ts`, and toilet stashes (`TOILET_ROWS`).
- **Floor boxes.** Each loose floor box is one caliber (`SUBWAY_FLOOR`, `OFFICE_FLOOR`).
- **Box sizes** per caliber: `BOX_COUNT` (for example 9mm 4–8, or 6–10 in crates / gun lockers). Off-theme handfuls: `HANDFUL`.

A new caliber needs:
- a `CALIBERS` row and its item;
- `BOX_COUNT` / `HANDFUL` entries;
- `ITEM_DIMS` in `items/items.ts`. Without it the item becomes a 0.2 m box that does not fit drawers.

Generic rows pick it up automatically. Weapon finds keep their matching box (`WEAPON_FIND_AMMO`, an explicit exception).

## Crafting materials

<!-- Task office-props-physics-scale-20261030 (lane RACK) -->

Collectible salvage for a **future** crafting system (`items/craftMaterials.ts`, item kind `material`). There are no recipes,
no crafting UI and no currency yet: the items are passive stacks (pockets first, like ammo; bags, ground bags, drop / pick up and
level carryover work like any stack) and their descriptions say so.

| Item id | Name | Stack | Count per lot (`BOX_COUNT` small / big) | Where it is found |
|---|---|---|---|---|
| `electrical_parts` | Electrical parts | 20 | 1–2 / 2–3 | server racks (the common find), server cupboards |
| `scrap_metal` | Scrap metal | 20 | 1–2 / 1–3 | server racks, server cupboards |
| `bio_mater` | Bio mater (the user's label) | 10 | 1 / 1–2 | lab storage (lane FURN's rows) |

- **Economy category `material`.** `econCat` returns `'material'`. `scarceFinds` keeps a rolled material **exactly as rolled**
  (like ammo), so a table's row weight is the real rate. `OFF_THEME_WEIGHTS.material` is 0 and no theme lists it, so no other
  holder ever re-themes a find into a material. Only holders whose **own rows** name a material hold one, and their
  `HOLDER_ALLOW` must list `'material'` (tests check it).
- **Server rack** (`SERVER_RACK_ROWS`, `OPENABLE_TABLES.serverRack`: 1–2 lots, 0.7 empty): electrical parts 3, scrap metal 1.2,
  battery 0.6, flare 0.2. The rebuilt 42U rack has three real empty bays with shelves. About one rack in four holds something;
  most finds are electrical parts. Measured over Office seeds 1–3 (23–59 racks a level): 9–37 material units a level.
- **Server cupboard** (`SERVER_SPARES_ROWS`, the server cabinet's two cupboards): the old spares plus electrical parts 0.8 and
  scrap metal 0.25, about a quarter of its lots.
- The Subway and every other table are unchanged (no material rows).

To add a material: an `items/craftMaterials.ts` def, its dims, a model in `world/materialItems.ts`, an icon in
`ui/materialIcons.ts`, `ITEM_CLASS` / `ITEM_PHYSICS` rows in `damage/materials.ts` and a `BOX_COUNT` entry. Then add rows to
the holders it fits, and `'material'` to their `HOLDER_ALLOW`.

## The mall (`mall`)

<!-- Task track3-eaton-centre-20261031 (lane PROFILES); re-proportioned for the compact mall by task mall-playtest-revision-20261031
(lane PROFILES: D08, U10 follow-up). -->

User: "I also want the shopping mall to be a significant source of the crafting materials, the electrical parts, the scrap metal,
and the bio material … It should be much more common in this area." Mall playtest: "a lot of drawers and cupboards are openable however
I'm not seeing much loot in them … just make sure we put loot inside the drawers and cupboards."

The mall is ONE logical level, `LevelId` `mall` (tier 2); its display name is seeded per run — `<Name> Center`
(`game/src/gen/mall/names.ts` `mallNameOf(levelSeed)`, stable for the same seed) — and the profile labels are generic
(`Mall (seeded "<Name> Center")`). Since the playtest revision it is compact: the station + three retail floors (~6,600 m² of core
floor, ~670 loot holders a run; the six-ring mall had ~43,800 m² and ~2,950 holders).

`PROFILES.mall` = `MALL_PROFILE`: `tables` = `MALL_TABLES` = `{...BASE_TABLES, salvage: MALL_SALVAGE, storageFill: MALL_STORAGE_FILL}` —
every consumable, ammo / calibre, box size, scarcity, limb, rare-gear and reward table is the SAME object the Subway and the Office roll —
plus `overrides` = `MALL_OVERRIDES`: `categoryWeight: {material: 0.25}` (the dial: every material row of the mall's tables, salvage and
storage-fill pools included; six rings: 0.6) and `itemWeight: {bio_mater: 1.5}` (the scarcest material lifted). The station and the three
retail floors are contexts of ONE logical level (one profile, one rare-gear roll, one gas-mask roll: `MASK_LOOT.levels.mall`, masks 1–2,
filters 2–5).

- **Salvage** (`LootTables.salvage`, `SalvageRule` / `SalvageTables`, logic `items/lootEconomy.ts` `salvageRule` / `withSalvage`):
  crafting-material rows a level adds at RESOLUTION time to the own / purpose tables of a place whose purpose (first) or loot theme
  has an entry. A rule `{rows, share}` makes the salvage rows `share` of the holder table's weight before overrides (each row weighs
  share / (1 − share) × Σ(table) × its share of the mix), then the profile's item / category weights apply like any row. They are
  rolled per lot and kept exactly as rolled (category `material`), finite and placed only where they fit (the holder's surfaces).
  Never legacy room-type tables, curated rewards, fixtures, container-themed storage, junk holders, or holders whose `HOLDER_ALLOW`
  excludes `material` (coolers, fridges, food lines, first-aid fixtures, gun lockers). Absent in `BASE_TABLES`: Subway and Office
  draws are byte-identical (`withSalvage` returns the same array; `tests/loot-golden.test.ts`).
- **`MALL_SALVAGE`** — the named mixes `MALL_ELECTRONICS_SALVAGE` (electrical parts 3 : scrap 0.7), `MALL_HARDWARE_SALVAGE` (scrap 3 :
  parts 0.9), `MALL_BIO_SALVAGE` (bio mater), `MALL_STOCKROOM_SALVAGE` (scrap 1.6 : parts 1.1 : bio 0.15):
  - by theme: tech 0.3 (electronics), service 0.3 (stock-room mix), medical 0.15 (bio), security 0.1 (hardware), personal 0.08;
  - by purpose (lane SHOPS' `mall-*` ids): electronics / phone and their stock rooms 0.35–0.4, arcade / music stock rooms;
    hardware 0.4 / 0.45, outdoors 0.25 / 0.3, sports, home, jewellery, luggage, toys, the gun shop's back office 0.2; clinic 0.2 /
    0.25, pharmacy / optician stock rooms 0.2, pet 0.12 / 0.18, the florist's workroom 0.1; vacant units 0.2; janitorial 0.3; plus
    the shared back-of-house ids (electrical room / closet, workshop, pump room).
  - The mall purposes carry NO material rows of their own: salvage is the one dial (no double counting).
- **Storage fill** (`LootTables.storageFill`, `StorageFill`, `MALL_STORAGE_FILL`; logic `items/loot.ts` `storageFill`; lane SHOPS built it
  for U10, lane PROFILES tuned it): after a storage holder's own roll, every compartment it left EMPTY (an openable drawer / door / lid;
  a one-door / one-lid holder = one compartment; exposed tops never) rolls once on its own stream `loot:<kind>:<index>:fill<part>`:
  `chance` × min(1, compartment loot area / `area`), then U{lots} items drawn from the holder's resolved rows within `cats` and
  `HOLDER_ALLOW` — only among the items that fit that compartment — re-weighted by category (default `STORAGE_FILL_WEIGHTS`: salvage
  × 3, torch cells × 0.25), packed on that compartment only. Snacks / drinks are `STORAGE_FILL_FALLBACK`: they join the pool only when
  it holds nothing else, except in food places (`STORAGE_FILL_STOCK_THEMES`: a grocer's / food unit's / pet shop's storage, where they
  are the stock). Dressings only in medical storage (`MED_FILL`), food in kitchenettes / chest freezers (`FOOD_FILL`), a kiosk cart its
  own snack / drink / cell stock, ammo only by the gun safe's arms rule. Finite, seeded once with the level, remembered by lot id like
  every holder lot. **Chances** (per empty compartment): cash-wrap drawers 0.4, dresser drawers 0.43, totes 0.4, carton halves 0.5
  (area 0.08), tall / low cabinets 0.45, desks 0.36, kiosk carts 0.32, bookcase drawers 0.25, glass display cabinets 0.25, kitchenettes
  0.3, filing cabinets 0.3, tool-chest drawers 0.35, staff lockers 0.2, dispensary drawers / cupboards 0.35, the medicine cabinet's 33
  pill drawers 0.16 (dressings: a pharmacy is a medicine source already), clinic storage 0.15–0.3, the gun safe 0.4. Absent in
  `BASE_TABLES`: Subway / Office rolls untouched.
- **Floor program** `MALL_FLOOR` (`BASE_TABLES.floor.mall`, interpreter `gen/mall/supplies.ts` `placeMallSupplies`, stream
  `mall-supplies-<storey>`): the station once (one ammo-band draw, one scarce draw, one loose salvage stack) and every retail floor (two
  ammo draws, two scarce draws, 1–3 loose salvage stacks: `MALL_LOOSE_SALVAGE`; six rings: 2–4), placed in weighted zones (galleries /
  courts 1, shop floors 0.8, back of house 1.3, salvage × 2 in tech / service places) ≥ 16 walking cells from the start and off the
  landings.
- **Rewards**: none of its own (the base reward tables are inherited but inert: no mall holder carries their keys). Weapon finds are
  lane SHOPS' per-gun-shop stock (about one gun per gun shop, its own ammunition once; an explicit exception, like the Office's
  weapon plan).
- **Track2 service annex** (at most one per mall, `TRACK_EXT_MALL.annex.max = 1`): annex holders / floor items come from Track2's own
  annex content (finite, seeded once, appended last), rolled under the mall profile — the annex purpose's theme decides any salvage;
  the mall floor program never sees extension areas (they are attached after every core pass); the ONE rare-gear roll, the gas-mask
  roll and the rewards are never multiplied by annexes.

### Normalised census (the evidence)

`game/tests/helpers/materialCensus.ts` (`runCensus` / `summarize`) measures any level the same way: holder lots AFTER fit
(`layoutHolderDetails`: the ContainerManager.build roll + packing + the storage fill, with the pre-fit entries → fit failures, the
fill's drawn-but-unpacked items included via `STORAGE_FILL_STATS`, and the surface area = finite capacity) and loose pickups, counted
only where the walking field from the arrival point (`levelDistance` over every storey's links) reaches the holder / pickup; usable
floor = the reached walkable cells (0.25 m² each, stair runs once). Rates are per REACHABLE holder and per 100 m² of usable floor;
`{exclude}` leaves the Track2 extension areas out for a core-to-core comparison. `compartmentCensus` / `stockedRate` count the
drawers / cupboards that hold something. `game/tests/mall-profiles.test.ts` prints the tables and requires: materials > 5× the
Office per 100 m² and > 3.5× per reachable holder, core-to-core AND extension-inclusive (and < 25×: not an avalanche); each material
> 3 units a run; fit loss < 5 %; reachable > 97 %; core food / drink / dressings per 100 m² < 2.5× the Office's (the consumables
guard), ammo < 1.2×, torch cells < 4.5×; 28–50 % of the fill kinds' compartments stocked (30–55 % without the pill drawers), each
common kind 22–75 %, the pill drawers < 30 %; materials > half of what the fill puts inside; ammo in the fill only in the gun safe.

Measured (task mall-playtest-revision-20261031, 10 compact malls = 3 variants × seeds 11 / 222 / 3333 + seed 44444; Office seeds
11 / 222 / 3333; pistol start; `reference/tasks/mall-playtest-revision-20261031/evidence/census/after.json`):

| | Office Space (core) | Mall (core) | ratio | Mall + annex |
|---|---|---|---|---|
| usable floor per run (reached walkable) | ~8,530 m² | ~6,620 m² | | ~8,810 m² |
| reachable holders per run | 484 | ~566 | | ~671 |
| material units per run (parts / scrap / bio) | 12.3 (9.7 / 2.7 / 0) | ~134 (52.6 / 71.6 / 9.7) | 10.9× | ~144 |
| material units per reachable holder | 0.026 | 0.224 | **8.6×** | 0.203 (10.7× the Office's 0.019 incl. its annexes) |
| material units per 100 m² | 0.145 | 2.02 | **14.0×** | 1.63 (14.7× the Office's 0.112 incl. its annexes) |
| food / drink / dressings per 100 m² | 0.30 / 0.34 / 0.18 | 0.64 / 0.77 / 0.40 | 2.2× / 2.3× / 2.2× | |
| ammo / torch cells per 100 m² | 5.28 / 0.074 | 4.73 / 0.23 | 0.9× / 3.1× | |
| fit failures (lots; holder rolls + storage fill) | 1.0 % | 1.6 % | | |

Why the per-area ratio rose above the six-ring mall's 8.3× (per holder 7.0×): the compact mall packs its shops ~1.5× denser per m²
(8.6 holders per 100 m² vs the Office's 5.7) and the U10 storage fill now puts ~84 material units a run INSIDE the drawers / cupboards
(the open shelves' share fell with the dial 0.6 → 0.25); the loose floor salvage shrank with the smaller storeys. The per-holder
ratio stays close to the accepted six-ring value. Drawer / cupboard compartments stocked (fill kinds): **35 %** of ~303 a run (38 %
without the medicine cabinet's pill drawers; all openable holder compartments incl. crates / bins / toilet stalls 31 %) — cash wrap 41 %,
cartons 38 %, totes 42 %, dressers 48 %, tall / low cabinets 58 % / 51 %, desks 38 %, glass cabinets 31 %, kiosk carts 39 %, bookcase
drawers 27 %, staff lockers 37 %, kitchenettes 30 %, tool chests 22 %, pill drawers 23 % (SHOPS' first fill: 17 % overall; before it
~5 %). What the fill puts inside per run: materials 84 units, dressings 11, food 6, drink 4, torch cells 6, flares 2.5.

## Verify

- `tests/loot-golden.test.ts` hashes current behaviour:
  - holder lots (id, item, count, compartment, surface, position) over the 18-station Subway corpus and 3 Office levels;
  - those layouts' pickups;
  - rare gear rolls and placement.

  It has been pinned in stages (the test header keeps the full history; stage 7 = the service annexes' appended content, live
  hashes only, core views unchanged). The first two:
  1. At main `dfb3a06`, before this refactor. The refactor left every hash unchanged.
  2. At main `4adb91c`, after merging the caliber-ammo change (PR #5). The merged tree reproduces main's own hashes exactly.
     The difference from stage 1 comes from that ammo change, not from the refactor.

  The header of the test records both sets. A pure refactor must not change any hash. A deliberate retune will: explain what
  moved and why before re-pinning.
- `tests/loot-tables.test.ts` covers slots, named tables, profiles, overrides, validation, fit and determinism.
- `validateLootProfile(profile)` returns a list of problems:
  - unknown item / category / slot / gear ids;
  - non-finite or negative weights or multipliers;
  - `lo > hi`;
  - chances outside [0, 1].

  An empty table is valid.

Run the tests from the repo root:

```sh
npx vitest run --config game/vitest.config.ts --maxWorkers=1 game/tests/loot-golden.test.ts game/tests/loot-tables.test.ts
npm run game:typecheck
```
