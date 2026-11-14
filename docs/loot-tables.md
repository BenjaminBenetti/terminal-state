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
| Service annexes: survivor caches deeper in (round 2) | `ANNEX_CACHE_KEY`; per container `ANNEX_CACHE_PANTRY` / `ANNEX_CACHE_KIT` / `ANNEX_CACHE_CRATE` (`ANNEX_CACHE_*_ROWS`); `LootSpec.salvage: false` |

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

6. **Food variety (realization).** `ContainerManager.build` passes each holder's rolled lots through
   `pantryHolderRealizer` (`items/pantryVariety.ts`). A lot that rolled an old food or drink (chocolate, chips, beans,
   noodles, cola, juice, water) may become another member of its family (`PANTRY_FAMILIES`), for example butter cookies,
   jerky, corned beef, oats, ginger soda, UHT milk or a sports drink.
   - The pick is a hash of the lot's identity, with no RNG stream. The level palette (`LEVEL_PANTRY`) and the holder's
     theme and slot weight it.
   - The lot keeps its count and spot. The variant must fit there, or the old item stays. No row is re-weighted, so every
     other lot is byte-identical (`loot-golden` is unchanged).
   - The expected food and water of a substituted lot stays within 10 % of the old item's (`tests/food-variety.test.ts`).
   - First-spawn floor pickups use `pantryPickupItem`. Bread and the Skyways ramen food are never substituted.
   - A substituted lot's id is `rolled id + 10 000 000 × (code + 1)`. A remembered holder therefore keeps exactly what its
     record names. An old save's record lists the rolled ids, so it keeps its old items.
7. **Natural food / drink half (realization).** Half of the natural food and drink finds stay; see
   [Natural food / drink half](#natural-food--drink-half-every-level). This runs in `game.ts` buildSection, after the fuel lots,
   the shelf filler and the section memory. The tables, the rolls and every census below are unchanged; what the player meets is
   about half of their food / drink.

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
| **Gear placement** | Where the one gear roll lands, by room purpose and piece (multiplies `gearAreaWeight`; absent = unbiased). Mall only. | `LootTables.gearPlace` (`MALL_GEAR_PLACE`) |

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

## Natural food / drink half (every level)

<!-- Task studio-food-drink-half-20261109-201124-01. User (2026-11-09): "food spawn rate is to high … lets cut food / drink spawn in
half. 50% reduction." -->

Every natural food or drink find stays with probability `NATURAL_FOOD_KEEP` = 0.5 (`items/naturalFood.ts`), on every level and for
every food / drink: the old items, bakery bread, the Skyways ramen food and the 24 pantry items alike.

- **A retention gate, not a re-weighting.** Halving the food rows' weights would not halve what the player finds, and it would hand
  the freed draws to ammo, medicine or fuel. The gate instead decides each find by a stable hash of its origin, with no RNG stream:
  - a holder lot: the section, the holder's memory key and the lot's ROLLED id (its food-variety variant decides like the rolled lot);
  - a generated floor pickup: the section and its layout index (its yaw is still drawn, so every other pickup keeps its stream).
- **What a kept find keeps.** Its id, item (variant), count, spot and compartment. A dropped one never appears; its spot reads as
  taken, and the shelf filler and fuel cans are placed exactly as before.
- **What counts.** `isNaturalFood` = `econCat` `food` / `drink`. Curated rewards (`REWARD_TABLES` holders, `reward` pickups) always
  spawn.
- **Exactly once** (`run/worldMemory.ts` `dropNaturalFood`, `game.ts` buildSection):
  - Only holders without a section-memory record and the first spawn of a section's floor pickups are gated.
  - A remembered holder or pickup list from any save, old or new, is restored exactly as recorded, so already-found food stays.
  - Unvisited sections of an old campaign get the new rate.
  - The gate is idempotent: a kept find stays kept.
- **Not touched:** nutrition, stacks and the survival drain; market vendor stock and the beers; the starter kit; anything carried,
  dropped, stored or shipped; the shelf filler; every non-food lot and pickup.
- **Measured** (`tests/food-half.test.ts`; the food-variety layouts of every level; `/tmp/food-half/census.json`). The expected keep
  is exactly 0.5 per find.

| Level | Food units before → after | Drink units before → after | Food + drink |
|---|---|---|---|
| Subway | 165 → 81 | 177 → 95 | ×0.52 |
| Office | 76 → 35 | 86 → 39 | ×0.46 |
| Mall | 59 → 33 | 80 → 37 | ×0.50 |
| Market | 0 | 0 | (no food loot) |
| Bunker | 22 → 9 | 20 → 13 | ×0.52 |
| Skyways | 105 → 58 | 215 → 95 | ×0.48 |
| Reactor | 16 → 6 | 19 → 12 | ×0.51 |
| All | 443 → 222 (×0.50) | 597 → 291 (×0.49) | ×0.49 |

## Weapon variety (every level)

<!-- Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): the twelve approved weapons as diversified weapon finds.
     Task studio-weapon-poses-slot-hierarchy-20261110-064835-01: the USER's slot hierarchy and the matching ammo (this section). -->

The twelve new weapons (`weapons/varietyIds.ts`: six guns, two per existing caliber, and six melee weapons) are never new spawn rows.
They take the IDENTITY of existing weapon finds (`items/weaponVariety.ts`). The find count, the origins and the ammo budget stay as
before. The user's design (2026-11-10) replaced the earlier family split (40 % baseline / ~42 % same-family new guns / 18 % melee) and
its "same rounds per caliber" rule for every NEW roll.

- **The opportunities** (unchanged; the census lists them all): every generated layout pickup of a baseline gun that is not a curated
  reward. Each producer lays the gun and then, at the next layout index, one box of its own caliber (`WEAPON_FIND_AMMO`):
  - `gen/weaponFinds.ts` `placeWeaponFinds`: the Subway, the Bunker, Skyways and the Reactor (shotgun + rifle for the shipped pistol
    start; shotgun only for a rifle start);
  - `gen/office/spawns.ts` `placeOfficeWeapons` (`officeWeaponPlan`): the Office storeys;
  - `gen/mall/shopsWeapons.ts` `placeMallWeapons`: the Mall gun shops' bench, rack or floor stock.

  Not opportunities, left exactly as authored: the Office roof find (`reward`, curated), the starter kit, the Survivor Market's paid
  merchant stock (`market/trade/stock.ts`), NPC loadouts. No loot table holds a gun, and a level without weapon finds gains none.
- **The slots** (`slotKindOf`, `slotRows`). A find in a GUN STORE (an area whose purpose / type carries the `guns` tag: the Mall's
  `mall-guns` shop, on any level that builds one; the Skywalk's store pool has none) is a **Gun slot**. Every other ordinary find is a
  **Weapon slot**.

  | Slot | Leaves | Each leaf |
  |---|---|---|
  | Weapon | 50 % gun: pistol, Hornet, Longslide, rifle, Stub, Overwatch, shotgun, Coach Gun, Thresher, Turnstile; 50 % melee: knife, Fire Axe, Machete, Sledgehammer, Crowbar, Slugger, Track Shovel | gun 1/20, melee 1/14 |
  | Gun | the 10 guns | 1/10 |
  | Pistol / Rifle (category) | its 3 guns | 1/3 |
  | Shotgun (category) | shotgun, Coach Gun, Thresher, Turnstile | 1/4 |
  | Melee | the 7 melee weapons | 1/7 |

  No generator lays an explicit category slot today; the kinds exist for one to be declared. The source family no longer constrains
  the pick and there is no place lean: an ordinary Weapon slot on any level can realize any of its 17 leaves.
- **The choice.** At a section's first spawn (`game.ts` buildSection, memory pickups `null`), a stable hash of the find's origin
  (section id, layout index, rolled baseline; seeded by the layout seed) picks the leaf. No RNG stream is read, so every other draw,
  yaw, lot and position is unchanged. Eligibility reads the delivered catalogue (WeaponDef + item + delivered model registry), never the
  loaded-model cache. Nothing re-selects on a load failure, a UI update, a save or a revisit.
- **Fit — no fallback to the old gun.** Every floor find stands on a cell with a clear 1-cell ring, so any weapon (up to the 1.25 m Track
  Shovel) lies there in any orientation. Only its paired box can be in the way: a weapon whose half-length + 0.08 m reaches the box
  lies ACROSS the box direction (the change's `yaw`; same spot). A find on a display host (gun-shop bench / rack, its own yaw) offers
  only leaves no longer than the bench top (`HOST_MAX_M` 1.1 m): every gun fits, and a Weapon slot on a host would lose only the Track
  Shovel. A find without its paired box (none in generated layouts) offers only a gun of the source caliber that loads every round.
- **Ammo matches the selected gun; the budget stays.** Each family's standard bundle is its find's loaded magazine + its paired box:
  pistol 15 + 15 (9 mm), rifle 30 + 20 (5.56), shotgun 6 + 6 shells. A find's bundle is worth `u` standard bundles (1.0 for every
  generated find).
  - A **gun** result of caliber c gets T = round(u × the standard total of c) rounds of ITS caliber:
    loaded = min(magazine, round(T × the standard loaded fraction of c)), the rest in the paired box (at least 1 round stays in the box).
    Rounding is half up.
  - A **melee** result has no gun: its paired box keeps the source caliber and takes the whole source bundle (box + loaded rounds).
  - So every find is worth exactly one standard bundle, whatever it became (30 rifle rounds never become 30 shells). Per gun, for one
    bundle:

    | Gun | Loaded | Boxed | Gun | Loaded | Boxed | Gun | Loaded | Boxed |
    |---|---|---|---|---|---|---|---|---|
    | pistol | 15 | 15 | rifle | 30 | 20 | shotgun | 6 | 6 |
    | Hornet | 15 | 15 | Stub | 30 | 20 | Coach Gun | 2 | 10 |
    | Longslide | 10 | 20 | Overwatch | 12 | 38 | Thresher | 6 | 6 |
    | | | | | | | Turnstile | 6 | 6 |

  Standalone ammo rows and every other pickup are untouched.
- **Saves.** A realized find is an ordinary layout pickup: run memory records its whole stack (item, count, loaded rounds). A
  remembered pickup list, from any save, is restored exactly. Nothing is converted, rerolled or migrated; finds already realized under
  the old rule stay what they are. The new rule reaches every section whose pickups were never realized, including the unvisited
  areas of an old campaign.
- **Pool versions.** A later pool only adds leaves: version 1 is the nine guns and seven melee weapons, and version 2 adds the
  Turnstile. An autosave (arrival, new game) does not capture the loose items of the station it is made in. So a section's first spawn
  records its pool version in the section memory (lane `weapon-pool`, `sectionWeaponPool`), and Continue or Retry at that station
  realizes the same finds. A section an older build already spawned (entered before, nothing captured, no record) keeps version 1,
  whose rows and picks are exactly the pre-Turnstile ones. A section entered for the first time uses the current pool.
- **Measured** (`tests/weapon-variety-loot.test.ts`: 76 real layouts of every level, pistol start plus two rifle-start seeds each;
  `/tmp/weapon-variety-loot/census.json`; re-measured with the Turnstile in the pool). The weapon find count and every other pickup are
  identical, and every find carries exactly one standard bundle before and after (127.0 = 127.0). Raw rounds in the find bundles move
  with the new mix (melee results keep the source caliber):

  | Level (layouts) | Finds (slots) | Realized: gun / melee | Bundle rounds before: 9mm / 5.56 / 12ga | After: 9mm / 5.56 / 12ga |
  |---|---|---|---|---|
  | Subway (18) | 36 (Weapon) | 11 / 25 | 0 / 850 / 228 | 90 / 700 / 228 |
  | Office (6) | 10 (Weapon) | 4 / 6 | 0 / 200 / 72 | 0 / 300 / 48 |
  | Mall (26) | 30 (Gun: gun shops) | 30 / 0 | 270 / 350 / 168 | 210 / 650 / 120 |
  | Market (2) | 0 | — | — | — |
  | Bunker (14) | 34 (Weapon) | 14 / 20 | 0 / 650 / 252 | 90 / 750 / 192 |
  | Skyways (5) | 8 (Weapon) | 5 / 3 | 0 / 150 / 60 | 0 / 100 / 72 |
  | Reactor (5) | 9 (Weapon) | 4 / 5 | 0 / 150 / 72 | 0 / 200 / 60 |
  | All (76) | 127 | 68 / 59 | 270 / 2350 / 852 | 390 / 2700 / 720 |

  All 17 leaves appear in the Weapon slots of these layouts (the Turnstile 4 of 97) and every gun category in the gun shops (the
  Turnstile 1 of 30). The real census is small, so its shares scatter (the Weapon slots came out 59 melee of 97). The same test's
  synthetic check runs the real plan over 36 000 finds: every leaf within sampling error of 1/20, 1/14 or 1/10, whatever the source
  family. Adding the Turnstile changed the pick of not-yet-realized finds only (above: the same finds, slots and bundles); every
  realized find is a remembered stack and stays what it is.

## Explicit exceptions (not table-driven)

- **Weapon finds and their paired ammo.** In `gen/weaponFinds.ts` this includes the `ammo_9mm` floor boxes for a pistol start.
  In `gen/office/spawns.ts` it is the weapon plan and placement. Their identities (Weapon / Gun slots) and their paired box's caliber
  and count (one standard bundle) are set at realization (see "Weapon variety" above); their count, spots and boxes are not.
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
back-of-house of plant rooms, stores, closets and service corridors (0–2 per level, on the 20 % of levels whose one area roll succeeds — `BTS_AREA_CHANCE`, docs/track-extensions.md —, each
~25 % of the Subway's walkable exploration area; generated by `game/src/gen/trackExt/`). It is part of its logical level: same loot profile, same economy, same run memory.
Its content comes from `game/src/gen/annexContent.ts` on its own fork (`track-ext-content`), APPENDED after every core record, so
every core holder index, pickup index and persistence key is unchanged (`tests/loot-golden.test.ts` stage 7 proves the core views
reproduce the earlier pins byte for byte).

- **Rooms.** Every annex area takes an EXISTING back-of-house purpose — pump room, electrical room, workshop, maintenance stores,
  custodial room, janitor / electrical / supply closet, service corridor — dressed by the core dresser's own rules (purpose rules,
  the composer, the iteration-07 dresser). Its holders are the existing kinds with their existing openables / physics classes.
- **Playtest revision** (task `studio-alpha-track2-playtest-revision-20261031-01`, user: "I couldn't find one piece of loot").
  - **Before:**
    - The deepest ~8 holders kept their room table; the rest were `ANNEX_PICKED`, 90 % empty, AND cut again by the level-wide
      scarcity economy.
    - Measured on main 312a653: 4 of 609 Subway picked holders stocked; 94–98 % of annex holders empty.
    - The CONTENT census counted ~34–39 ammo ROUNDS (never thinned) and recorded ~1.8 other finds per annex, but nothing checked
      that against what a player opens.
  - **Now:** the annex keys are `LootSpec.exact` tables (no second cut). Per annex (`gen/annexContent.ts` `pickOver` /
    `ANNEX_CONTENT.loot`):
    - **Supply:** `ANNEX_SUPPLY_KEY` (`'annex-supply'`) holders, one per 170 m², 6–12. Half in the entry third (door-hop depth),
      30 % in the middle, the rest deep (thirds of the annex rooms' door-hop range); ≤ 2 per room; only holders that roll their
      room purpose's table.
      `ANNEX_SUPPLY` = water 1, cola 0.45, beans 0.85, noodles 0.4, chocolate 0.4, bandage 0.75, medkit 0.12, battery 0.6, flare
      0.35; one lot, never empty, no ammo and no crafting materials (those stay in the server racks / cupboards).
    - **Scraps:** `ANNEX_SCRAPS_KEY` (`'annex-scraps'`) for 12 % of the other picked holders (≤ 6), one leftover each (water 1,
      beans 0.6, chips 0.5, bandage 0.5, battery 0.4).
    - **Searched clean:** `ANNEX_PICKED` (exact, `empty: 1`) for the rest.
    - **Exact means the whole budget:** the mall's storage fill (`LootTables.storageFill`) never tops up an exact annex table, so a
      searched-clean holder stays clean and the annex economy is the same on every level.
    - **Never empty by packing (Mall round 3 CI follow-up, 2026-11-01):** the random yaw jitter could make a lot that fits only nearly
      square miss its surface (a 0.32 x 0.22 m med kit on a 0.24 m deep stock shelf), leaving an `empty: 0` supply shelf EMPTY. When
      every rolled lot of an exact table is unplaced, `rollHolderLots` packs the holder square instead (`packItems(..., square)`, its
      own `:square` stream). Partial drops stay as they were. Over the 18-station Subway corpus exactly 2 of 6,397 holders changed (two
      such shelves now hold their med kit); core hashes and the Office are unchanged.
    - **Room storage:** every annex room / closet the dressing left without a holder gets one storage piece (open shelving first).
    - **Signature-room lockers** (the deepest intact holders of a boiler / generator / turbine room roll their room table):
      `ANNEX_SPARES_ROWS` = the server spares without the crafting materials (battery 1.4, flare 0.6, bandage 0.5, water 0.6).
      Round 2 fix: they used `SERVER_SPARES_ROWS`, so a Subway annex could hold electrical parts (Subway 1002 / 1043 / 1234); the
      Subway never holds a material (`craft-materials.test.ts` now also checks those annexes).
- **Survivor caches** (task `studio-alpha-track2-round2-20261031-01`, lane CACHE, R5; user: "there's not enough of a reason to go to
  this place, there should be some "cache" rooms that spawn deeper in, a room like a survivor had been living there").
  - **Where / what:** one room per annex (two in large ones) in the deep third of its door-hop range, set up as a survivor's room — a
    pallet bed, their own storage and a few camp things (`gen/annexCache.ts`; placement rules in `docs/track-extensions.md`).
  - **Loot key:** `ANNEX_CACHE_KEY` (`'annex-cache'`), a prop-level key like the stash (`gen/purposes.ts` purpose `annex-cache`, theme
    `personal`, never an area purpose). Set LAST, after `pickOver`, which therefore never relabels a cache holder.
  - **Themed per container, one key** (the purpose's loot by holder kind), every table `exact`, `empty: 0`, 2–3 lots:

    | Holder | Table | Rows (weight) |
    |---|---|---|
    | open shelf — the pantry | `ANNEX_CACHE_PANTRY` | water 1.2, beans 1.1, noodles 0.6, chocolate 0.5, cola 0.35 |
    | tall / low cabinet — the kit | `ANNEX_CACHE_KIT` | bandage 1.3, medkit 0.35, leg_splint 0.12, arm_sling 0.12, battery 0.9, gas_filter 0.55, water 0.4 |
    | crate — the supply crate | `ANNEX_CACHE_CRATE` | generic ammo 1.5 (~0.5 each 9mm / 5.56 / 12-gauge), beans 0.5, water 0.4, bandage 0.4, battery 0.3 |

  - **Limb treatments (after the first PR CI run):** exact tables skip the scarcity step's limb conversion, so the first kit (med
    kits only) pushed the Subway's per-station treatments / med kits to 0.796, below the injury economy's 0.8–1.7
    (`injuries.test.ts`). The kit now carries the survivor's own splint / sling: per station treatments 2.61 vs med kits 2.89 (0.90).
  - **The ammo rule (deliberate):** only the cache CRATE holds ammo — generic rows over the three calibers every level uses (the 9mm
    pistol start, the 5.56 rifle and 12-gauge shotgun finds), in the crate's big-box stacks (`BOX_COUNT` big: ~8 / 10 / 4.5 rounds a
    lot). The pantry and the kit never hold ammo.
  - **Allocation (expected per cache, before fit; 3 holders x E[lots] 2.5 = 7.5 lots):** food 1.9 (tins 1.1, noodles 0.4,
    chocolate 0.3), drink 1.6 (water 1.4, cola 0.2), dressings 1.1, first-aid kits 0.25, limb treatments (splint / sling) 0.16, torch batteries 0.85, gas-mask filters 0.4,
    ammo 1.2 lots (~9 rounds). A 2-holder cache (no third piece fitted: 14 of 60 measured) is ~2/3 of that. Measured on the sample
    (packed lots, `ContainerManager.build` with each level's profile): see `docs/track-extensions.md` "Survivor caches".
  - **Round 3, the HIDEOUT** (task `studio-alpha-track2-round3-20261031-01`, lane HIDEOUT; user: "it should have substantial detail
    applied and contain substantial loot. perhaps a boosted chance of gear spawning. it needs to be a good pay off for navigating the
    confusing maze of rooms"):
    - a fourth holder, the **footlocker** at the foot of the bed (`gen/annexCache.ts`; an openable authored lid): `ANNEX_CACHE_LOCKER`
      (exact, `empty: 0`, 2–3 lots) = generic ammo 1.0 (~1/3 each caliber), flare 0.7, battery 0.7, gas filter 0.5, bandage 0.6,
      chocolate 0.4, water 0.3 — the survivor's personal kit; no medkit (the injury band below), no material, no gear;
    - fuller holders: the pantry shelf and the supply crate roll **3–4** lots (were 2–3); the kit stays 2–3 (its med kits / splints are
      the injury economy's knob);
    - **the ammo rule now:** the crate AND the footlocker hold the cache's ammo (generic rows, big-box stacks in the crate); the pantry
      and the kit never do;
    - a footlocker is an own-table openable container: `items/loot.ts holderTable` lets an EXACT purpose table that names the kind
      explicitly (`'annex-cache'` → `footlocker`) roll instead of its own table (`OPENABLE_TABLES.footlocker`, used nowhere else); every
      other own-table container is unchanged;
    - **the gear piece** (`ANNEX_CACHE_GEAR`, key `ANNEX_CACHE_GEAR_KEY` `'annex-cache-gear'`): each annex's FIRST cache (the hideout)
      holds ONE piece of rare gear with **chance 0.6** — drawn by weight from the level profile's gear pool (`annexCacheGearRows`:
      `gearParams(profile).weights`, i.e. `GEAR_WEIGHTS` with the level's overrides) plus the **gas mask** at weight 0.8 (its filter
      seeded like the level's mask find: 35–75 % of `FILTER_LIFE_S`). A layout pickup at the bedside (tagged `reward`), rolled on its own
      fork (`cache:<annex>` → `gear`), appended after the annex's other pickups: finite, remembered by run memory (layout pickup index),
      never re-rolled. The level's ONE gear roll and mask roll, their placement and pins are unchanged (the level gear / mask pickups,
      appended later by `levels/registry.ts withGear`, move one index on: their run-time yaw draw shifts, their place does not).
      The loot reference lists it as the special `hideout-gear`.
    - Measured: see `docs/track-extensions.md` "The hideout (round 3)".
  - **Never a reward roll:** no rare gear, gas mask, weapon or crafting material (`salvage: false`: the mall's salvage rows never join
    these tables — `items/lootEconomy.ts salvageRule`); the gas filter is the ordinary spare canister (a `supply` item with no
    economy category: its `itemWeight` is the tuning dial). Exact means the whole budget: no scarcity cut, re-theme, limb conversion
    or storage fill. Finite: rolled once per holder stream, remembered by run memory (`captureHolders` / `applyHolders`), never
    refilled.
- **Floor program** `ANNEX_FLOOR` (once per annex, the Subway program's shape): a 5.56 box (30) n 0–1, a 12-gauge box (8) n 0–1;
  medkit n 0–1 and bandage n 1–2, each kept with `FLOOR_ECONOMY.medKeep` (0.2); a battery (chance 0.6) and a flare (0.45). Landing:
  the annex rooms' purpose `floor` weights (ammo / med) and `FLOOR_ECONOMY.themeWeight` (battery / flare), on free floor cells off
  the door zones. The loot reference shows it as the `annex` variant of each annex-bearing level's floor program, outside the exact
  per-level totals (the annex count is a seeded census quantity).
- **Never multiplied.** No guaranteed high-tier item: every stash may be empty, every floor find is a chance or passes the keep cut.
  The level's ONE rare-gear roll and mask roll never land in an annex (`gearAreaWeight` = 0 for extension areas; gear spacing
  ignores the annex finds), no weapon find is placed there, and the Office roof cache / roof find are untouched. (Round 3: the hideout's
  own gear piece — a 0.6 chance per annex hideout, above — is the one deliberate gear source in an annex, separate from those rolls.)
- **Measured** (playtest revision; fresh New Game path, Subway 1043 / 1002 / 777001 / 777002, Office 222 / 3333, Mall 846932 /
  5150 / 9090):
  - **Holders:** 49–75 per annex, **28–38 % stocked** (the core station stocks ~1/3).
  - **Finds:** 18–28 non-ammo holder finds per annex, ~the core's density for ~1/4 of its area; holder ammo in its old range.
  - **Floor:** the floor program is unchanged.
  - **Access:** every stocked holder is reachable and targetable.
  - **Discovery routes:** ordinary routes took loot in every sampled annex, the first find 2–5 rooms in.
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

Collectible salvage for crafting (`items/craftMaterials.ts`, item kind `material`). Since task train-crafting (2026-11-11) Scrap
metal and Electrical parts are what the recipes of the train's crafting bench cost (`craft/recipes.ts`; the supply described here
did not change for it: no row, weight or roll moved); Bio mater has no recipe yet. Nothing uses a material by hand: the items are
passive stacks (pockets first, like ammo; bags, ground bags, drop / pick up and level carryover work like any stack) and their
descriptions say so.

| Item id | Name | Stack | Count per lot (`BOX_COUNT` small / big) | Where it is found |
|---|---|---|---|---|
| `electrical_parts` | Electrical parts | 20 | 1–2 / 2–3 | server racks (the common find), server cupboards |
| `scrap_metal` | Scrap metal | 20 | 1–2 / 1–3 | server racks, server cupboards |
| `bio_mater` | Bio mater (the user's label) | 10 | 1 / 1–2 | lab storage (lane FURN's rows) |

All three are also **basic finite loot on every level** through the shared base salvage (next section).

- **Economy category `material`.** `econCat` returns `'material'`. `scarceFinds` keeps a rolled material **exactly as rolled**
  (like ammo), so a table's row weight is the real rate. `OFF_THEME_WEIGHTS.material` is 0 and no theme lists it, so no other
  holder ever re-themes a find into a material. Only holders whose **own rows** name a material hold one, and their
  `HOLDER_ALLOW` must list `'material'` (tests check it).
- **Server rack** (`SERVER_RACK_ROWS`, `OPENABLE_TABLES.serverRack`: 1–2 lots, 0.7 empty): electrical parts 3, scrap metal 1.2,
  battery 0.6, flare 0.2. The rebuilt 42U rack has three real empty bays with shelves. About one rack in four holds something;
  most finds are electrical parts. Measured over Office seeds 1–3 (23–59 racks a level): 9–37 material units a level.
- **Server cupboard** (`SERVER_SPARES_ROWS`, the server cabinet's two cupboards): the old spares plus electrical parts 0.8 and
  scrap metal 0.25, about a quarter of its lots.
- No other table has material rows of its own; every other level-wide material source is a salvage table (below, and the mall's).

To add a material: an `items/craftMaterials.ts` def, its dims, a model in `world/materialItems.ts`, an icon in
`ui/materialIcons.ts`, `ITEM_CLASS` / `ITEM_PHYSICS` rows in `damage/materials.ts` and a `BOX_COUNT` entry. Then add rows to
the holders it fits, and `'material'` to their `HOLDER_ALLOW`.

### Base salvage (every level)

<!-- Task studio-base-salvage-20261108-073314-01. User: "what about if we changed the base loot table? these items are supposed to be
basic and found in all levels" -> "ok that sounds good. Lets do that". -->

The three materials are **basic** supplies: `BASE_TABLES.salvage` = `BASE_SALVAGE`, so every profile that rolls the base tables gets it.
That is the Subway, the Office, Skyways and any future level; there is no per-level list to extend.

**It is additive** (`SalvageTables.extra`). A fitting holder rolls its own table exactly as before. Then, on its own stream
`loot:<kind>:<index>:salvage`, it has a chance of **one** extra salvage lot (`items/loot.ts` `salvageLot`):
- **The odds.** The chance is the rule's `share`, per holder, before overrides and fit. The item comes from the rule's rows, after
  the profile's item / category weights. Its stack size is `BOX_COUNT` for that holder kind.
- **Placement.** The lot goes in a free spot beside the rolled lots (`lootLayout.ts` `freeLotSpot`), so no rolled lot moves or is
  covered. Its id is `index * 1000 + SALVAGE_ID` (700), and `isSalvageLotId` tests for it.
- **Nothing else changes.** Food, drink, medicine, ammo, torch cells and flares keep their chances, their counts, their placement
  and their lot ids. There is no compensating supply change anywhere.

**Routing** is the ordinary salvage routing (`lootEconomy.ts` `salvageRule`): the purpose entry first, else the loot theme's.

| Rule | Share (per holder) | Mix |
|---|---|---|
| `workshop`, `office-workshop` | 0.18 | `BASE_WORKSHOP_SALVAGE`: scrap 3, electrical 1 |
| `electrical-room`, `electrical-closet` | 0.18 | `BASE_ELECTRICAL_SALVAGE`: electrical 3, scrap 0.8 |
| `signal-room` / `office-it` | 0.14 / 0.12 | electrical mix |
| `pump-room`, `boiler-room`, `generator-room`, `turbine-hall`, `ventilation-plant` | 0.12 | workshop mix |
| `storage`, `office-storage`, `office-utility` / `custodial-room` | 0.1 / 0.08 | `BASE_SERVICE_SALVAGE`: scrap 1.6, electrical 1.2, bio 0.35 |
| `office-lab`, `office-labfloor` / `first-aid-room`, `supply-closet` | 0.12 / 0.06 | `BASE_BIO_SALVAGE`: bio mater |
| theme `service` / `tech` / `medical` | 0.06 / 0.06 / 0.04 | service / electrical / bio mix |

**Where it never goes.** The rule applies to ordinary own / purpose tables only. It never applies to:
- exact tables: the annex supply / scraps / stash / cache / picked-over storage and the market's empty key;
- curated rewards, fixtures and plain-room (legacy) holders;
- container-themed storage (`CONTAINER_THEMED`) and junk bins (`RANDOM_HOLDERS`);
- holders whose `HOLDER_ALLOW` excludes materials: fridges, coolers, food fixtures, medicine cabinets, gun lockers, vending.

**How to tune or switch it off.**
- Slot overrides shape the table roll only. A profile tunes the base salvage through its own `salvage` table (`{}` means none) or
  through `categoryWeight.material` / `itemWeight`.
- A level with its **own** salvage replaces it wholesale. The mall and the Reactor use `MALL_SALVAGE` (the rows mode, unchanged);
  the market uses `MARKET_SALVAGE`. One rule per holder, never both.

**Finite and persistent.**
- The lot is rolled once, remembered by lot id and never refilled; there is no floor scatter and no per-seed guarantee.
- A holder remembered from **before** this rule (an old save) never gains it: `run/worldMemory.ts` `dropUnrecordedSalvage` runs
  right after the holders are built. The same applies to a holder whose lot was taken.
- Holders not realized yet (an unvisited section or station of an old save, or any new campaign) roll it.
- Fuel placement leaves salvage lots out of its taken room, so the fuel cans lie exactly where they did before. A can laid on a
  salvage lot removes it (`ContainerManager.addLots`).
- Saves, trade, cargo and item stacks are unchanged.

**Amounts.** Expected salvage lots per level, before fit (sampled levels):

| Level | Lots | Scrap | Electrical | Bio mater |
|---|---|---|---|---|
| Subway | ≈ 5.6 | 2.3 | 2.4 | 0.9 |
| Office | ≈ 4.5 | 2.0 | 1.8 | 0.6 |
| Skyways | ≈ 5.5 | 1.7 | 2.5 | 1.3 |
| Market | ≈ 2.0 | 1.0 | 0.8 | 0.2 |

These are on top of the existing server-rack / lab-drawer rows and the mall's own salvage. They are per-holder chances summed over
the sampled holders: an estimate, not a per-level guarantee. The evidence is in `tests/base-salvage.test.ts` and
`tests/loot-golden.test.ts` stage 19. Every pre-existing holder hash is unchanged over the non-salvage lots.

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

`PROFILES.mall` = `MALL_PROFILE`: `tables` = `MALL_TABLES` = `{...BASE_TABLES, salvage: MALL_SALVAGE, storageFill: MALL_STORAGE_FILL, gearPlace: MALL_GEAR_PLACE}` —
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
  excludes `material` (coolers, fridges, food lines, first-aid fixtures, gun lockers). This is the mall's ROWS mode. `BASE_TABLES`
  carries the additive base salvage instead ("Base salvage" above: `withSalvage` leaves those tables' rows untouched). The mall's own
  table replaces it, so a mall holder never gets both.
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
- **Rare-gear placement** (task mall-round3-20261031, lane SHOPS R6 — user: "clothing stores should have higher gear drop chance …
  the same idea applies to all stores where the theme would reasonably boost spawn chance of associated loot"). `LootTables.gearPlace`
  = `MALL_GEAR_PLACE`, read by `gen/gearLoot.ts` `placeGear` (`gearPlaceFactor`) through the level's profile (`levels/registry.ts`
  `withGear`). It multiplies an area's gear-spot weight (`gearAreaWeight`, only where it is already > 0) by room purpose and piece:
  - the wearable-gear shops (clothing, womenswear, outdoors, sports, shoes, department, luggage) ×12 on the sales floor and ×4 in the
    stock room;
  - per piece: work boots → shoe store / hardware, work gloves → hardware / clothing, the daypack → luggage / outdoors / sports, the hard
    hat → hardware, the armour vest / chest rig → the gun shop ×10 and mall security ×3, the hard hat and armour damped in the boutiques.
  The count and pieces are the shared ONE roll (`GEAR_LOOT`, no mean change). Mask loot placement is unbiased. The Subway / Office
  tables carry no bias: identical placement.
  Measured on 10 generated malls (womenswear on; unbiased vs biased placement on identical layouts, 240 level rolls each;
  `reference/tasks/mall-round3-20261031/lanes/SHOPS-evidence/loot-after.json`):
  - a gear-themed store holds a piece in **8.0 %** of runs (was 3.4 %; other shops 2.4 % → 1.7 %, so 4.7×);
  - **50 %** of the gear lands in them (was 21 %), and 39 % of runs put a piece in one of them (was 19 %);
  - per store: clothing 3.3 → 7.0 %, womenswear 3.0 → 6.3 %, outdoors 3.9 → 12.9 %, sports 4.4 → 10 %, shoes 3.0 → 6.6 %,
    luggage 2.4 → 5.8 %, department 3.5 → 6.2 %; hardware 3.2 → 6.7 % (hard hats), gun shop 2.3 → 4.3 % (armour).
  Other themes were already boosted (holder units per themed store vs the average other shop, same census): medicine in the pharmacy /
  clinic / optician 16×, ammunition in the gun shop 13×, scrap metal in hardware 6.4×, bio mater in medical shops 15×, batteries in
  electronics / phone / hardware 3.4×, food / drink in grocery / food court / café / kiosk 3.4× / 2.6×. Weakest: electrical parts in
  electronics / phone stores (1.4×). Their sales floors are glass display cabinets (which take no salvage by design) and device walls
  (which hold no loot); a salvage-share trial at 0.48 gave only +0.2 / +0.7 parts per store, so it was reverted. Changing that is a
  fit-out decision: a parts-holding fixture in tech stores.
- **Round-3 CI follow-up (2026-11-01, lane SHOPS):** shoe stores carry the same x1.5 daypack affinity as clothing / womenswear /
  department (a mall with a luggage store had left the shoe store at 1.87x per store for the daypack). The clinic / first-aid **crash
  cart** rolls `CRASH_CART` (its medicine + spare defibrillator / monitor cells) and its mall storage fill draws medicine and cells at
  0.35 (was medicine at 0.25): its four upper drawers are 6.5-7.8 cm deep, so no dressing / kit fits there and they were always empty
  (2,000 simulated carts: 8.6 % -> 28.5 % of compartments stocked; mall-profiles enforces the 0.22 per-kind floor on that simulation).
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

### Station fuel and Mall ammo (check, 2026-11-11)

<!-- Task gameplay-feedback-20261111 (lane FUEL-LOOT): "does fuel displace too much ammo in Mall loot?" -->

Not confirmed; nothing was changed. The station fuel cans are ADDED lots (`gen/fuelHolders.ts` free spots +
`ContainerManager.addLots`). No rolled lot moves or vanishes, ammo included; only the additive base salvage lot yields to a can. The
fuel plan is the same per station on every level (`fuel/fuel.ts` `stationFuelPlan`: 18.2 units, 17.4 cans a station on average).
Measured on 6 Mall seeds (11 / 222 / 3333 / 44444 / 5150 / 9090) with 10 station plans each:

- ammo per Mall run: ~189 rounds in holders (34.8 lots) + ~129 rounds on the floor (7.7 boxes) = ~318. The pre-fuel census above
  gives ~313 (4.73 per 100 m² x ~6,620 m²).
- 0 rolled lots changed by the fuel cans, on 14 layouts of four levels.
- placed cans that sit in an ammo-capable holder: Mall 0.10, Skyways 0.11, Subway 0.46, Office 0.43. Beside rolled ammo: Mall 0.045.
  In a gun shop: Mall 0.035.

`tests/mall-fuel-ammo.test.ts` guards additivity and the small share. If the Mall still reads ammo-poor, the lever is the Mall's ammo,
not its fuel: its ammo per 100 m² is 0.9x the Office's (table above).


## The Reactor (`reactor`)

`PROFILES.reactor` = `REACTOR_PROFILE`: the mall's tables under the culminating level's pressure (`categoryWeight`: ammo 0.75, med 0.8,
battery 0.85, material 0.2). Task reactor-playtest-round2-20261102 (lane ARRIVAL): the round-2 rooms (the arrival station area, the
rock suites, the complexes' room graphs) brought ~45 % more furnished holders, so the level's TOTAL loot is held at its previous level:
- `overrides.slot`: every ordinary holder rolls fewer lots (`lots` × `REACTOR_PICKED_OVER` 0.7 on container / shelf / surface /
  countertop / vend / cold / medical / junk / stash) and containers are emptier (`empty` × 1.45). The armoury's gun lockers (`arms`),
  the fixtures and the floor program are untouched.
- `tables` = `REACTOR_TABLES`: `MALL_TABLES` with every storage-fill rule's `chance` × `REACTOR_FILL_SCALE` 0.65 (the fill tops up
  every compartment a holder's own roll left empty, so fewer lots alone would only move units into it). The mall is unchanged.
- Measured (holder lots as `ContainerManager.build` rolls them + floor pickups; 16 pits: seeds `9100 + 104729k`, k < 12, and 1–4; base
  main `d147830` vs the round-2 feature head), units per run: total 801 → 1053 without the hold → 820 with it (+2.3 %); ammo 661 →
  677, med 10.1 → 10.1, food 12.1 → 11.6, drink 10.4 → 9.6, batteries 6.4 → 7.3, flares 6.0 → 6.8, materials 90 → 93. The new rooms
  are mostly service rooms, so their finds lean to batteries / flares. Floor pickups, the key, the fuses and the gas mask / filters
  (`gen/maskLoot.ts`) are unchanged.

## The Survivor Market (`market`)

<!-- Task studio-survivor-market-20261108-005807-01 (lane LEVEL). -->

`PROFILES.market` = `MARKET_PROFILE`: **no free loot** in the calm settlement (the residents' belongings and the stall goods are not
loot: the goods are the traders' finite stock). The generator places no pickups and every holder it places carries the exact empty key
(`gen/market/dress.ts` `MARKET_EMPTY_KEY` = `ANNEX_PICKED_KEY`); the profile is the second guard: `categoryWeight` 0 for every
economy category, `slot.lots` 0 for every slot, `floor.chance` 0, `gear` `{mean: 0, cap: 0}` (an empty level-wide gear roll; the
mask / filter roll is 0 / 0 in `MASK_LOOT.levels.market`). The station's common fuel plan is not loot tables: only the workshop has a
fuel affinity, so a market station's plan cans lie in its storage like at any station (`world/fuelStations.ts`).

**Basic salvage in the workshop (the one exception).** The workshop's own storage is its rolling tool chest, salvaged plank shelving
and crates (`gen/market/dress.ts`). It carries `MARKET_WORKSHOP_KEY` (`'market-workshop'`): an ordinary, always-empty table
(`MARKET_WORKSHOP_EMPTY`).
- **What it can hold.** The market's own salvage table `MARKET_SALVAGE` (additive) gives each of these holders a 0.5 chance of one
  base salvage lot from the shared `BASE_SERVICE_SALVAGE` rows: scrap, electrical parts and, now and then, bio mater.
- **What the profile allows.** `categoryWeight` is 1 for `material` only. Every slot still rolls 0 lots, so no holder's own table
  rolls anything. There are no free guns, food, medicine, fuel, trader stock or NPC loot.
- **Everything else stays empty.** Every other holder keeps the exact empty key. The base theme salvage is replaced, so nothing
  seeps into the kitchen or the bunks.
- **Unchanged.** Trader stock, the wallet, prices and ownership. Workbenches stay scenery: no crafting and no conversion.

**Not loot: the flamethrower and its fuel tank** (task studio-flamethrower-fire-20261114-031614-01). They are in no table, pool,
weight map, weapon-find leaf or starter kit on any level; they come from the train's bench (`docs/train-crafting.md`) or a market
stall. Each market's gun stall stocks one flamethrower and its outfitter one new fuel tank as extra lots on top of the seeded stock
(`market/trade/stock.ts` `STOCK_EXTRAS`): no stall's draws, counts or seeds changed (`tests/flamethrower-market.test.ts` pins them).

## The Bunker (`bunker`)

<!-- Task studio-bunker-level-20261109-072224-01 (lane LEVEL). -->

**Layout version 2** (task studio-bunker-rework-20261109-205115-01): the same tables; each storey's designer put its openable /
surface holders in rooms whose purpose carries the storey's programme, so the finds DIFFER by floor (holders by purpose theme, 6 seeds):
the station security / service / personal / medical, the entry storey mostly security and personal, the habitation storey mostly
personal (+ its kitchen / pantry / mess food), the services storey service and medical (+ the restored ration store), the maintenance
storey service and crew, the core storey technical / records. Loot QUANTITY matches the first Bunker (~414 holders per level vs ~400;
`tests/bunker-v2-level.test.ts` keeps it within -12 % / +15 %) and food holders never exceed it (36 vs 40 per level, before the shared
natural-food half); no new tables, no literal item lists.

**Layout version 3** (task gameplay-feedback-20261111, lane FUEL-LOOT; user: "On platform/elevator level S ONLY, replace half the
ammo spawn opportunities with increased food/drink spawns"): the version-2 generator plus `gen/bunker/v2/stationRations.ts`. On storey
S, floor(N / 2) of the N ammo opportunities are converted. An opportunity is a holder whose resolved table (exposed or compartment)
has an ammo row or whose theme stocks ammo, or an S floor-program ammo box. Only the ammo changes; no other supply moves to compensate.

- A converted holder keeps its loot key, table, theme, lot count and empty chance. Its placement carries the ammo swap
  `bunker-station-rations` (`PropPlacement.ammoSwap`, `items/loot.ts` `AMMO_SWAPS` / `swapAmmoLots`), which runs on the finished roll.
  Every AMMO lot (from an ammo row, the security theme's re-themed finds or a compartment roll) becomes one serving of the named
  `BUNKER_STATION_RATIONS_ROWS` (= `ANNEX_CACHE_PANTRY_ROWS`), drawn by weight on the holder's own stream
  `loot:<kind>:<index>:ammo-swap`. It keeps the lot's id and lies in a free spot (its own surface first). Every other lot keeps its id,
  item, count and spot. A serving that fits nowhere tries the other rows, else is left out (0 over the 8-seed census).
- A converted box becomes one serving of the same rows on the same spot: the loot reference's `bunker-station-rations` source.
- Gun lockers (no food allowed) and weapon finds keep their ammo.
- Storeys 1-5 are byte-identical to version 2. Stations entered under version 1 or 2 keep their version.

Measured, S per level (8 seeds, 4401 + k x 7919; holders + floor):

| | ammo opportunities | ammo finds (lots + boxes) | ammo rounds | food / drink (before / after the half) | dressings / batteries / flares / materials |
|---|---|---|---|---|---|
| v2 | 21.1 | 17.5 | 122.5 | 4.9 / 2.75 | 1.63 / 1.75 / 1.13 / 1.75 |
| v3 | 10.75 | 11.0 (x0.63) | 79.1 (x0.65) | 11.4 / 5.5 | 1.63 / 1.75 / 1.13 / 1.75 (unchanged) |

Per level ~10.4 holders convert, and their ~6 ammo lots become servings. Over 24 seeds the ammo ratio is x0.60 (finds 17.9 -> 10.7,
rounds 128.9 -> 77.0). The holders' loot keys are unchanged, so the food-holder count stays version 2's (36 vs the first Bunker's 40,
`tests/bunker-v2-level.test.ts`).

`PROFILES.bunker` = today's shared `BASE_TABLES` with **no overrides** (like Skyways): the civil-defence shelter's rooms carry existing
station purposes plus the Reactor shelter's own bunker purposes (`gen/reactor/complex/bunkerPurposes.ts`: blast-door lock,
decontamination, dormitory, radio room, armoury), so every holder stocks by its purpose / theme through the base tables — the finite
food / drink plan, the additive `BASE_SALVAGE` lot in service / tech / medical places, the station fuel plan (`world/fuelStations.ts`,
unchanged: the generators' fuel is found like any can). Ammo comes only from the armoury's purpose rule and the ordinary floor finds.
There is no merchant stock and no currency loot. The loose floor program is the Reactor's (`gen/mall/supplies.ts` `placeMallSupplies`
per storey: `LEVEL_ADAPTER.bunker.floor = 'mall'`) and the weapon finds the station rule. Gas masks / filters: the Office's roll
(`MASK_LOOT.levels.bunker` 1–2 masks, 2–5 filters) — the shelter has local gas leaks, every one avoidable on a clean route. The pantry
palette (`items/pantryVariety.ts` `LEVEL_PANTRY.bunker`) is shelf-stable: field rations, ration bricks, tins, crackers, oats, long-life
milk, bottled drinks (rations leaned up in security / service rooms like the Reactor's).

Census (16 generated levels, level seeds 4401 + k × 7919): about 30 loose pickups per level (ammunition boxes, batteries, flares,
dressings, salvage parts and the odd weapon find, spread over six storeys) and about 280 holders (footlockers, staff and gun lockers,
cabinets, crates, shelving), most of them stocked by their room's purpose through the base tables and many left empty by those tables'
own empty chances. The finite food / drink and fuel plans apply as on every base-table level.

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
