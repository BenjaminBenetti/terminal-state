# Loot reference — how it is generated and kept honest

<!-- Task loot-reference-pages-20261030 (lane DATA) -->

The public reference site's loot explorer is **generated from the game source at build time**. Nobody maintains a table of
numbers by hand: every value, every level, item, table and override shown comes from the exported game modules. The tuning
guide for the loot itself is `docs/loot-tables.md`; this page explains the *reference*.

<!-- Task enemy-spawn-tables-20261030 (lane SITE) -->
The same site has an **Enemy spawns** section (`enemies/*.html`, data `data/enemies.json`), generated the same way from the
per-level spawn profile API by `buildEnemyReference` (`tools/pages/enemyReference.ts`). Its generator, units and coverage
rules are described in `docs/enemy-spawns.md`. Both references are built for the same commit and rendered together.
`tools/pages/validate.ts` checks the section's coverage against `data/enemies.json`: every level, generation context, family
and room key must have its rendered anchor.

## How it is generated

```
game modules (real exports)  ──>  buildLootReference()  ──>  LootReference (one JSON object)  ──>  site renderer  ──>  dist/pages/
                                   tools/pages/lootReference.ts   contract: tools/pages/lootReferenceTypes.ts   tools/pages/render/*
```

- `tools/pages/lootReference.ts` (`buildLootReference(opts)`) imports the game modules and reads their exported values. It
  never copies a number. The renderer only sees the returned object. It never imports game code.
- The object is plain JSON and deterministic for a fixed source tree: no timestamps. `meta.commit` and `meta.buildId` come from
  the caller. `meta.dataHash` is a hash of the data.
- Source links name the file and export, and the declaration line where the generator finds it. The repository is private, so
  the site labels the links "repository access required".

### What is read from where

| Reference section | Read from (exports) |
|---|---|
| Levels, profiles, overrides | `levels/registry.ts` `LEVELS` / `LEVEL_IDS`; `items/lootTables.ts` `lootProfile`, `PROFILES`, `validateLootProfile` |
| Slots, holder kinds | `SLOT_CATEGORIES`, `HOLDER_SLOTS`, `COMPARTMENT_SLOT`; `items/loot.ts` `CONTAINER_KINDS` / `SURFACE_KINDS` / `HOLDER_LABEL`; `HOLDER_EMPTY` / `HOLDER_LOTS` / `HOLDER_MOD`; `world/openablesSpec.ts` |
| Tables | Every named row list / `LootSpec` export of `lootTables.ts`, `OPENABLE_TABLES`, `GLOBAL_POOL`, `LEGACY_POOL`, `VENDING_FOOD`, `LIMB_ECONOMY.pool`, `REWARD_TABLES` picks, every purpose's `loot` in `gen/purposes.ts` |
| What a holder rolls in a context | `items/loot.ts` `holderTable` / `compartmentTable` (the real resolution: own → purpose → legacy, narrowing, overrides) |
| Scarcity stage | `THEME_ECONOMY`, `OFF_THEME_WEIGHTS`, `HOLDER_ALLOW`, `CONTAINER_THEMED`, `RANDOM_HOLDERS`, `THEME_OF_TYPE`, `LIMB_ECONOMY`, `BOX_COUNT`, `HANDFUL`; `items/lootEconomy.ts` `holderTheme` / `catAvailable` |
| Loose floor programs | `SUBWAY_FLOOR`, `OFFICE_FLOOR` (+ `OFFICE_FLOOR_TILT`), `FLOOR_ECONOMY`, `PUBLIC_FLOOR_WEIGHTS`; `gen/office/spawns.ts` `scarceOdds`; `gen/office/companies.ts` `COMPANIES`; `gen/office/tenants.ts` |
| Rare gear | `gearParams(profile)` (`GEAR_LOOT`), `items/gear.ts` `GEAR_ITEMS` |
| Gas masks / filters | `gen/maskLoot.ts` `MASK_LOOT` |
| Weapon finds | `gen/weaponFinds.ts` `findWeaponsFor`, `WEAPON_FIND_AMMO`, `FIND_COPY_THRESHOLDS`, `FIND_MAX_PER_WEAPON`, `PISTOL_START_BOXES`; `gen/office/spawns.ts` `officeWeaponStoreyWeights`; `weapons/pistol.ts` `startWeaponFor` |
| Starter kit | `run/starter.ts` `starterInventory` (the real inventory, both start weapons) |
| Fixtures, interactions | `world/openablesSpec.ts` `containerLoot` (null = fixture), `OPENABLE_SPECS` contents, `isSpillHolderKind` |

### Which contexts occur in which level: the sample census

Static data cannot say which holders a level actually places: that is a generator outcome. The reference therefore runs a
**small fixed-seed census** of the real registered generators:
- `LEVELS[id].generate(...)` with the shipped start weapon;
- `CENSUS_SEEDS`: 4 seeds per level;
- plus at most `CENSUS_COVER_MAX` seeds for a level with tenant floors. They are chosen from a fixed sequence so that every
  tenant company is sampled.

It records each loot holder's `(kind, loot key)` exactly as `ContainerManager.build` keys it: `p.purpose ?? area.purpose ??
area.type`. It also records the storey and the tenant company.

- A context is **observed** ("observed in N of M sample levels") or **declared**. Declared means a purpose observed in that level
  lists the holder kind, but no sample level placed one.
- Tables that no observed context uses are flagged `unobserved`. They are real tables and are still shown.
- The census is a sample, not exhaustive, and it is labelled as such everywhere.

### Generator adapter

The generator-level paths are code, not data:
- which floor program a level runs;
- station weapon finds or the Office weapon plan;
- the pistol-start 9mm boxes;
- which reward keys a generator places;
- storey / tenant contexts.

These are declared in `LEVEL_ADAPTER` (`tools/pages/lootReference.ts`). Its type is `Record<LevelId, ...>`, so a new level fails
to typecheck until it is documented. The test then checks every census pickup and holder against the declared sources.

## Making a new loot source discoverable (and what fails if you don't)

| You add… | It appears automatically when… | What fails otherwise |
|---|---|---|
| a **level** (`LevelId`, `LEVELS`, `PROFILES`) | it is registered. Its profile, overrides, census contexts, economy and floor program are derived. | `LEVEL_ADAPTER` does not typecheck until the level has an entry. The coverage test fails if `PROFILES` / `LEVEL_ADAPTER` / `LEVEL_IDS` disagree. |
| a **holder kind** | it is in `items/loot.ts` kinds and `HOLDER_SLOTS` (as `docs/loot-tables.md` requires). | The build throws ("no slot"). The test fails for a `HOLDER_SLOTS` kind that is not a holder. |
| a **slot** | it is added to `SLOT_CATEGORIES`. | The renderer gets all slots; the test compares against `SLOT_CATEGORIES`. |
| a **named table** (row list or `LootSpec` export) | it is exported from `lootTables.ts`. It is auto-detected by shape. | — |
| any **other** `lootTables.ts` export (a new economy constant, API) | it is classified in `LOOT_TABLES_EXPORT_ROLES` and surfaced in the reference. | The coverage test lists the unknown export. |
| an **openable table** | it is added to `OPENABLE_TABLES`. | — |
| a **purpose** / purpose table | it is in `ALL_PURPOSES`. Census-observed contexts link to it. | — |
| a **reward** | it is in `REWARD_TABLES` / a profile's `tables.rewards`, and the placing level lists the key in `LEVEL_ADAPTER.rewards`. | The test fails for a reward no level places. |
| an Office **company tilt** | it is in `OFFICE_FLOOR_TILT`. | The test fails for a company whose tilt has no program variant. |
| a new **pickup source** (any generated floor pickup) | its item and count appear in a floor program or special source of that level. | The census check fails: "pickup … has no documented source". |
| a **fixture** (`loot: null`) | it is in `OPENABLE_SPECS`. It becomes a `fixture:<kind>` source. | — |

Values never need a manual copy. If a generator path changes shape (a new stage, a new roll), extend `buildLootReference` to
read it. Do not hand-write its numbers.

## Labels

| Label | Meaning |
|---|---|
| guaranteed | Always yields its contents. Examples: the starter kit; the roof cache, whose picks have empty 0 and lots ≥ 1. |
| conditional | Table-driven and gated by chances. Examples: holders, floor programs. |
| special | An explicit exception outside the holder tables. Examples: rare gear, gas masks / filters, weapon finds and their paired ammo, the pistol-start boxes. |
| non-loot | Rolls nothing or only moves existing lots. Examples: fire / AED cabinets, compartments with baked contents, vending pry / spill, light holders spilling when shot, shot lots detaching, the multi-level floor move. |
| decoration-only | Shelf filler stock: it can never be taken. |

## Probability definitions

- **Weight.** A relative number within one table. It is never a chance.
- **Share.** `weight / Σ weights` of that table (the denominator is always shown). It is the *conditional selection chance*:
  given that one lot is drawn from that table in that context, the chance the lot is that row.
  - If every weight of a non-empty table is 0, the game's pick walk returns its last row. The reference models this.
- **Stage gates per holder.**
  1. Empty chance: P(rolled) = 1 − empty.
  2. Lot count n ~ U{lo..hi}, so E[n] = (lo + hi) / 2.
  3. Per-lot pick, including the legacy category stage, plus the stack size (`BOX_COUNT` small / big).
  4. Scarcity: ammo is kept exactly. Any other entry survives with `keep(theme, cat)`. A survivor is on-theme with `on`
     (re-picked by the theme weights within `HOLDER_ALLOW`) or off-theme (`OFF_THEME_WEIGHTS`). A pick outside the allow list
     keeps the rolled item. Security rooms re-theme ammo from the generic pool.
  5. Limb post-pass with `max(share[theme], holder share)`.
  6. Fit / occupancy: **not derivable**.
  7. Contents are finite and persistent.
- **Expected lots / units per holder, before fit.**
  - They are exact under the roll's distribution (ideal uniform draws).
  - The reference computes them analytically from the same values. `game/tests/loot-reference.test.ts` checks them against the
    real `rollLootItems` / `rollTableItems` / `holderFinds` over about 3k seeded rolls per context.
  - They are upper bounds of what ends up placed.
- **P(≥ 1 of X) per holder, before fit.** `(1 − empty) × (1 − E_n[(1 − y)^n])`, where y is the per-lot chance after every
  stage. Per-lot outcomes are independent given n.
- **Floor programs.**
  - Expected copies are exact: copies `U{lo..hi}`, keep and chance draws. Office tower boxes use the cumulative-threshold bands.
  - Placement success is **not derivable**: a draw with no free cell places nothing.
  - The Office per-level total = the street run + 7 tenant floors. Each floor's company is uniform over the 20-company pool.
- **Rare gear.**
  - The count is Poisson(mean) capped at `cap`. All tail mass lands on the cap.
  - Each piece's per-level chance is exact. It is computed by dynamic programming over the repeat-halving draws.
  - This is one of the few exact per-level chances (one roll per logical level), and it is before placement.
- **Never shown:** a per-level "chance to find X" from holders or floor finds. How many holders of a kind a level generates is not
  derivable.
- Derived numbers are rounded to 8 significant digits (`DERIVED_DIGITS`). Source values are shown exactly.

## Game-source exports added for the reference

These are behaviour-preserving: same values, same draw order. `tests/loot-golden.test.ts` is unchanged.
- `gen/weaponFinds.ts`:
  - `FIND_COPY_THRESHOLDS` (`{none: 0.06, one: 0.86}`, formerly literals);
  - `PISTOL_START_BOXES` (`ammo_9mm` × 15, 3–4 boxes, formerly literals).
- `gen/office/spawns.ts`:
  - `officeWeaponStoreyWeights()`, the weapon plan's storey weights (formerly inline);
  - `officeWeaponPlan` now uses `FIND_COPY_THRESHOLDS` / `FIND_MAX_PER_WEAPON`. These are the same values (0.06 / 0.86 / 2).

## Verify

```sh
./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  game/tests/loot-reference.test.ts game/tests/loot-golden.test.ts game/tests/loot-tables.test.ts game/tests/loot-economy.test.ts
npm run game:typecheck
```
