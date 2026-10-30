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
4. **Scarcity.** `scarceFinds` in `items/lootEconomy.ts` keeps ammo exactly as rolled. Each other entry survives with
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

## Verify

- `tests/loot-golden.test.ts` hashes current behaviour:
  - holder lots (id, item, count, compartment, surface, position) over the 18-station Subway corpus and 3 Office levels;
  - those layouts' pickups;
  - rare gear rolls and placement.

  It has been pinned twice:
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
