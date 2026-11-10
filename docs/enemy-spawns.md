# Enemy spawns — per-level profiles, room modifiers and the reference

<!-- Task enemy-spawn-tables-20261030 (lane SPAWN); task track1-siren-blightbelly-20261031 (lane SPAWN): families Blightbelly and
Siren, family eligibility, level tiers; task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): the Strainer (service
annexes only). Registering a NEW level or annex zone: docs/level-enemy-contract.md. -->

Every logical level has one **enemy spawn profile**. The real level generators read it; nothing else holds spawn numbers. The
public reference site's Enemy spawns section (`enemies/index.html` → `enemies/<level>.html`) is generated from the same profiles.
This page explains where the profiles live, what each control and modifier means, and how to extend them.

## Where the profiles live

`game/src/ai/spawnTables.ts` — pure data and pure resolution functions (no three.js):

| Export | What it is |
|---|---|
| `SPAWN_PROFILES` / `spawnProfile(level)` | One `SpawnProfile` per `LevelId` (`subway`, `office`, `mall`, `reactor`). `Record<LevelId, …>`: a new level does not typecheck until it has one. |
| `ENEMY_FAMILY_IDS` | The enemy families in registry and roll order: `zombie`, `blightbelly`, `siren`, `ratdog`, `strainer` (= the archetype registry `ENEMY_ARCHETYPES`, `game/src/ai/creatureArchetypes.ts`, same key order; the Strainer is appended last). |
| `familyPool(shares)`, `DEFAULT_FAMILY_SHARES`, `ENEMY_POOL` | A level's pool: blightbelly 0.05 (default ON), siren 0 (default OFF, `OPT_IN_FAMILIES`), ratdog 0.05, strainer 0 (context-locked, below), zombie the remainder. `ENEMY_POOL` = `familyPool()` = the Subway's. |
| `STRAINER_CONTEXTS`, `CONTEXT_LOCKED_FAMILIES` | The contexts whose OWN pool may give the Strainer weight: `['service']` only. `validateSpawnProfile` rejects a positive Strainer weight in a level pool, in any other context's pool or in a horde pool (`HORDE_FORBIDDEN_FAMILIES`). |
| `SERVICE_FAMILY_POOL` | The service annexes' own pool: zombie 0.67, blightbelly 0.05, siren 0, ratdog 0.20, strainer 0.08 (see "Service annexes"). |
| `OFFICE_ENEMY_POOL`, `OFFICE_SIREN_WEIGHT`, `OFFICE_SIREN_ELIGIBILITY` | The Office pool (siren draw weight 0.19) and where an Office Siren may lie dormant. |
| `markSpawnContext`, `spawnContextOf`, `eligibilityFailure`, `eligibleFamily`, `sealsPassage` | Spawn context tags and the eligibility checks. |
| `ENEMY_SPAWNS` (+ `ENEMY_SPAWNS_BASELINE`, `ENEMY_POPULATION_SCALE`) | The Subway station count range (the iteration-12 doubled population). |
| `SUBWAY_AREA_WEIGHTS`, `SUBWAY_CAPS`, `SUBWAY_PLACEMENT`; `OFFICE_AREA_WEIGHTS`, `OFFICE_CAPS`, `OFFICE_PLACEMENT`; `ZOMBIE_TYPES` | The baseline placement rules, moved verbatim out of the generators. |
| `validateSpawnProfile(p)` | Problems with a profile (empty list = valid). |
| `roomModifier`, `roomIntensity`, `roomFamilyPool`, `areaSpawnWeight` | How room modifiers resolve. |

A profile holds:
- `contexts` — one entry per **generation context** the level's generator runs: a count range (`rng.int(lo, hi)`, one draw per
  run), placement rules (area weights, caps per pass, tries per area visit, spacing, keep-away from the start, clearance, the Office
  landing keep-off) and `accept` (what validation accepts before the attempt is regenerated).
  - `subway` → context `station` (`gen/stationDress.ts` `placeSpawns`) plus `levelMoves` (the storey moves of
    `gen/levelGenDress.ts` `placeLevelSpawns`).
  - `office` (ONE logical level) → `street` (station + lobby, once), `floor` (once per office floor 2..8) and `roof` (once), all
    run by `gen/office/index.ts` through `gen/office/spawns.ts` `placeOfficeEnemies`. Changing floors never rerolls anything.
  - both → `service` (Track 2): once per seeded **service annex** of the level's station (0–2), a per-annex ZONE budget run by
    `game/src/gen/annexContent.ts` `placeServiceSpawns` (see "Service annexes" below).
- `families` — the family pool `[family, weight]`, every family listed (weight 0 excludes). Every placed spawn draws its family
  independently with `enemyRoll(level seed, spawn index)` (`game/src/ai/creatureSpawn.ts` `assignEnemyArchetypes`), walking the pool
  in registry order: a drawn family REPLACES a zombie, never adds a spawn.
- `eligibility` — per family, WHERE it may take a placed slot (below). A draw that fails it becomes the rule's `fallback` (a zombie).
- The level's difficulty **tier** lives in the level registry, not the profile: `LEVELS[id].tier` (`game/src/levels/registry.ts`;
  Subway 0, Office 1), validated with the profile by `validateLevelRegistry` (`game/src/levels/levelContract.ts`). Metadata only.
- `zombieTypes` — the shambler / coated roll of every spawn (40 % coated, at least one of each). The wardrobe outfit is a zombie
  sub-distribution chosen at spawn time (`game/src/ai/wardrobe.ts` `pickZombieLook`), not a family.
- `rooms` — room modifiers (below). **Shipped: none** — every room resolves to exactly 1.

## The mall (`mall`)

<!-- Task track3-eaton-centre-20261031 (lane PROFILES; Track1 integration: lane INTEG). Re-proportioned for the compact mall by task
mall-playtest-revision-20261031 (lane PROFILES, D07). -->

`MALL_SPAWN_PROFILE` (`SPAWN_PROFILES.mall`, `LEVELS.mall.tier = 2`) — ONE logical level, `LevelId` `mall`. Its **display name is seeded
per run**: `<Name> Center` (`game/src/gen/mall/names.ts` `mallNameOf(levelSeed)`; the same level seed — revisits, Travel, Retry —
always gives the same name; `LEVELS.mall.name` is the generic "Shopping Center" for menus without a seed; the profile labels say
"Mall (seeded `<Name> Center`)"). Since the mall playtest revision it is COMPACT: the subway station at the bottom of a small
glass atrium (storey 0) and **three retail floors** above it (storeys 1..3), generated once per level seed by `gen/mall/index.ts`
`generateMallLevel` (the old six-ring mall is gone). Measured (CPU census, 10 generated malls, `reference/tasks/mall-playtest-revision-20261031/evidence/census/after.json`):
core walkable floor ~6,600 m² (station ~1,180, retail ~5,450: floor 1 ~2,330 / floor 2 ~1,820 / floor 3 ~1,290) + an optional Track2
east tunnel (~580 m²) and service annex (~1,610 m²); the six-ring mall had ~43,800 m² of core floor.

It follows the Track1 level contract (`docs/level-enemy-contract.md`) and has two **separate** pools that never mix, plus the annex
zone, accounted separately:

- **Ambient pool** — the contexts, placed by the generic storey placement `placeOfficeEnemies` (`gen/office/spawns.ts`, which tags each
  run's spawns with its context through `markSpawnContext`):
  - `pit` — the station storey (platforms, the Fountain court, station back of house), once per level: **U{3..5}** (was U{6..9}).
  - `ring` — one retail floor (courts, corridor wings, shops, stock rooms, service corridors), once per floor (three runs): **U{4..6}**
    each (was U{7..10} on each of six rings). Placement `MALL_RING_PLACEMENT` (mall round 3, R8): the station storey's rules plus shop
    sales floors (room type `shop`) at area weight **`MALL_SHOP_WEIGHT` = 6** (galleries 1, stock / back rooms 1.3) — a dead mall's
    infected linger in the shops; of a run's ~15 retail slots ~8.8 now land in shops (was 3.2), 3.2 on the galleries (was 6.1), 1.9 in
    stock rooms (was 3.5). The counts, the station storey (`MALL_PLACEMENT`), the family pool and the horde rules are unchanged. E = 4 + 3 × 5 = **19 ambient enemies** per level (measured 19.1, 17..21) = ~0.29 per
    100 m² of core — lighter than the Office's ~0.45, because the hordes concentrate the mall's threat. The old counts in the compact
    mall would have been 32.7 ambient + 38.3 horde = 1.11 enemies per 100 m² of core (2.5× the Office): re-proportioned, not crammed.
  - `service` — Track 2's per-annex zone budget `SERVICE_CONTEXT` (U{3..5} per annex), exactly as on the Subway / Office (see
    "Service annexes" below; lane INTEG integration): one run per seeded service annex of the station on its own fork, appended
    after every core spawn (hordes included) and tagged `service`, inheriting the mall's family pool; no Siren there (the mall's Siren
    rule names `ring` only), never the horde pool, not in the station / retail counts or the ambient budget. A mall has **at most one**
    annex (`TRACK_EXT_MALL.annex.max = 1`, one east tunnel; no hatches): 43 of 48 sampled malls had it, 3.5 service spawns per run
    (5 per annex in the 10-mall census; ~0.23 per 100 m² of tunnel + annex) — see `docs/track-extensions.md` "The mall".
  - `lingerie` — task mall-lingerie-20261102-221554 (lane CONTEXT; user: "make store-local ordinary-zombie variants using these
    specific bodies dressed in the supplied lingerie designs … Spawn these variants inside this store, especially in the changing
    area"): the STORE-LOCAL zone `LINGERIE_CONTEXT` of the mall's optional lingerie store (a seeded shop program on a LARGE lot, at most
    one per mall, never guaranteed: `LINGERIE_STORES_MAX`). Only when the mall has one, `game/src/gen/mall/lingerieSpawns.ts`
    `placeLingerieSpawns` runs ONE store run on its own fork (`mall-lingerie-spawns`, drawn from only then): **U{3..5}** spawns
    (`LINGERIE_ZONE_BUDGET`), `floor(count / 3)` of them on the store's sales floor and the rest (2 / 3 / 4) in its walk-in changing
    area (`MallShop.changing`: one rect per booth + the aisle), spread one per booth first; a share that does not fit moves to the other
    group. Stand points (`LINGERIE_PLACEMENT` + `LINGERIE_SPAWN_RULES`): walkable FLOOR of the store's own sales floor (never its
    stock room, a gallery or another unit), reachable and ≥ 36 walking cells from the start, 5 m off the storey's landings, ≥ 4 m from
    the shopfront(s) (no point-blank variant at the entrance); in a BOOTH (a changing rect with 1-4 OPENING cells — a walkable
    neighbour outside the rect: its curtain gap) the centre of a 2 × 2 patch of its cells off the opening row (lane STORE's booths are
    2 cells wide × 3 deep: the back 2 × 2, on the booth's centre line, clear of both panels); the aisle hosts nobody while the store
    has booths (nobody waits in front of a booth door or blocks the way to the closed end); on the sales floor a 3 × 3-clear cell
    more than 2 cells off the changing area and ≥ 2 m from its mouth (`MallShop.changingEntry`); everywhere a 0.5 m disc never splits the storey (`sealsPassage`), 1.4 m from every enemy already on the storey. Every spawn is a shambler,
    tagged `ZombieSpawn.look = 'lingerie'` and the context `lingerie`, and APPENDED after every other spawn of the level (ambient,
    hordes, annex `service`): every existing index — family roll, wardrobe look, kill memory — is unchanged, and a mall without a
    lingerie store is byte-identical to one generated without the pass. Families: the context's OWN pool `LINGERIE_FAMILY_POOL`
    (ordinary zombies only — no Blightbelly, Siren, rat/dog or Strainer) through the one `assignEnemyArchetypes`; no eligibility rule
    names it; not in the station / retail counts or the ambient budget. Looks: at spawn time `game/src/ai/spawnLook.ts`
    `chooseSpawnLook` gives exactly these spawns their fitted lingerie set — `game/src/ai/lingerie.ts` (lane FIT) `lingerieLook(layout
    seed, spawn index)`, built by its SEPARATE `createLingerieLibrary` (the ordinary pool can never pick a lingerie garment), used only
    when that library can build it with an upper AND a lower garment, else the ordinary fully clothed pick; the garments
    (`LINGERIE_MODEL_FILES`) load lazily, only for a layout holding a lingerie-tagged spawn (`lingerieModelKeysFor`) — and every
    other spawn of every level the ordinary wardrobe pick (`pickZombieLook`); both are pure functions of (seed, index), so a variant looks the same on
    every revisit / Retry and a killed one stays dead (per-index run memory). AI: the ordinary zombie's — no leash, despawn or teleport.
    Test: `game/tests/mall-lingerie-spawns.test.ts`.
  - `families` = `MALL_ENEMY_POOL` = `familyPool({siren: MALL_SIREN_WEIGHT})`: Blightbelly 0.05 and rat/dog 0.05 (the defaults), the
    Siren's draw weight **0.8**, the zombie the remainder (0.1) — rolled ONCE by `assignEnemyArchetypes(layout, spawnProfile('mall'))` after
    every ambient context.
  - `eligibility.siren` = `MALL_SIREN_ELIGIBILITY` (modelled on `OFFICE_SIREN_ELIGIBILITY`): context `ring` only (never the `pit`
    station storey, never a `service` annex, never a horde); area kind `room` — shop sales floors and stock rooms (never a court,
    corridor or gallery, a washroom passage, a service corridor or a closet); never a washroom, stair core, plant room (`storage` /
    `utility`) or elevator; room ≥ 4 × 4 m, a clear 1.5 × 1.5 m patch of its own floor, every doorway (shopfronts too) ≥ 3 m away,
    a 2.5 m disc never seals passage, **at most 4 per mall** (the Office's cap; mall round 3 — it was 2 since the playtest revision); an
    ineligible or over-cap draw becomes a zombie.
  - `spacing.siren` = `MALL_SIREN_SPACING` (`FamilySpacing`): ≥ **24 m** (straight 3D line; mall round 3 — was 30 m) between the mall's
    Sirens = her hum's audible distance (`audio/sfx.ts` `SIREN_HUM.maxDist`): two are never heard humming at once. Track1's
    `FamilyEligibility` has no spacing field, so this is a small mall-side post-pass, `applyFamilySpacing` (`game/src/ai/familySpacing.ts`),
    run once right after `assignEnemyArchetypes`: in spawn-index order an eligible Siren draw is placed only while fewer than the cap are
    placed AND it is ≥ 24 m from every placed one (cap and spacing jointly), else a zombie. Pure, RNG-free, never touches horde members.
    Final user decision: rare Sirens appear in the Office and the mall, never the Subway, never in hordes; appearance locked; HP /
    attacks / timing unchanged by this retune.
  - **Census** (mall revision, 48 generated malls: 24 tuning seeds `9100 + 104729k` + 24 validation seeds `50021 + 7919k`; weight × cap ×
    spacing swept offline over the same layouts — the family roll is a hash of (seed, index) — and the live assignment re-checked equal;
    `evidence/census/siren-sweep.json` in the task folder): only **~1.25 of the ~19.2 ambient slots** of a run are Siren-eligible (small
    shops; 29 % of runs have none at all). The six-ring tuning (0.32 / cap 4) gave 0.44 per run, 60 % of runs none; a first compact
    tuning 0.5 gave 0.69 (3.6 %, 44 % none). The standing user decision — "rare Sirens MUST appear in the Mall … roughly 5 % ambient
    share" — takes the most the retail-room rule allows: at **0.8 / cap 2 / 30 m: mean 0.85 Sirens per run = 4.5 % of the placed ambient
    enemies, 35 % of runs none, max 2** (histogram 0:17 1:21 2:10; tuning half 0.96 = 5.0 %, validation half 0.75 = 3.9 %), by storey
    floor 1 / 2 / 3 = 14 / 15 / 12, the station 0. Blightbelly 5.8 %, rat/dog 6.0 % of the ambient enemies (their 5 % draw bands are
    never renormalised). The draw SATURATES at 0.8: 0.85 and 0.9 give identical placements (every eligible slot outside the
    Blightbelly / rat-dog bands is a Siren), so a ~5 % share every run (mean 0.9–1.0) is not reachable by the weight alone — it needs
    more eligible slots (a `shop` / `stock-room` room density modifier, or cap 3: 0.8 / cap 3 → 0.92, 4.8 %), and the 29 % of runs
    without any eligible retail room stay Siren-free whatever the weight.
  - **Mall round 3 (R8)** — user: "I've done a bunch of mall runs, and not found a siren ever, confirm that siren can spawn on this level.
    with chance similar to office space, i.e. average 2 per mall." The runtime path was confirmed end to end (`game/tests/mall-sirens.test.ts`:
    a real generated mall's Sirens → the lazy `enemy_siren` key selected for the mall and shipped in the release allowlist → spawned →
    a dormant `SirenActor` from the real `enemy-siren.glb` with her vein patch on her retail floor); nothing drops her. The cause was
    rarity: on the current generator (48 malls, the seeds above) **mean 0.79, 37.5 % of malls none, max 2**; only ~1.1 of ~15 retail
    slots passed her room gates (galleries 6.1 per run fail on kind, narrow 2–2.5 m stock rooms 3.6 on size, shopfront proximity 1.4).
    Gates alone (re-run on the same layouts) top out near 1.1–1.25. Retune: shop-weighted retail placement (above), the Office's cap 4,
    24 m spacing, every Office room gate and the 0.8 draw weight kept (the Blightbelly / rat-dog bands keep their spawn indices) →
    **mean 1.96 Sirens per mall (Office 1.97), 8.3 % of malls none (Office 12.5 %), max 4**, histogram 0:4 1:12 2:16 3:14 4:2, tuning
    half 2.17 / validation half 1.75, by floor 1 / 2 / 3 = 42 / 27 / 25, the station / annex / hordes 0; eligible slots 3.27 per run;
    core ambient zombie 78.4 %, Siren 10.3 %, Blightbelly 5.5 %, rat/dog 5.8 % (~5.6 % Sirens of all core enemies with the hordes).
    Evidence: `reference/tasks/mall-round3-20261031/lanes/ENEMY-evidence/r8-*.json`; `game/tests/mall-sirens.test.ts` keeps a 12-mall
    sample (mean ≥ 1.5, ≤ 2 malls without one).
  - `budgets.ambient` (`AmbientBudget`): **total 23, per storey 6** (was 69 / 10) — validation keeps every context's count hi within the
    per-storey cap.
- **Horde pool** — `horde` (`HordeRules`, `game/src/ai/hordeSpec.ts` `MALL_HORDE_RULES`, lane HORDE's model; values lane PROFILES):
  **U{1..2} groups** (was 3..5) of U{5..20} ordinary zombies, its OWN explicit family pool (every registry family listed; zombie 1,
  Blightbelly / Siren / rat/dog 0: the ambient shares are NOT applied; a Siren weight > 0 is rejected by validation), **budget 32**
  members in the mall (was 64), 20 members / 1 group starting per retail floor, and two placement rules added for the compact mall:
  - **route capacity** `placement.routeMPerMember = 18`: the groups starting on a floor hold at most ⌊R / 18⌋ members, R = that floor's
    walkable patrol route (the summed length of its same-storey patrol edges, `ai/hordePlace.ts` `patrolRouteM`); a floor whose capacity
    is under five takes none. Measured capacities 14–28 on floor 1, 14–24 on floor 2, 8–17 on floor 3 (route 150–500 m per floor);
  - **out-of-sight start** `placement.startClearM = 28`: a group's start node is ≥ 28 m (straight 3D) from the player start — a
    shambler's 18 m sight + the members' 7 m cluster + 3 m. The atrium overlooks the station from every floor, so the old 45 walking
    metres alone let a floor-3 group stand in plain view of the platform (seed 32451: two members came down to the player at once).
  Placed LAST by `placeHordes`, after the ambient family roll (members are `layout.zombies` entries tagged `horde`;
  `assignEnemyArchetypes` skips them). Every member carries the horde pool's own context tag `horde` (`HORDE_CONTEXT`): the profile
  declares it by declaring `horde` (`declaredSpawnContexts`), it can never be an ambient `contexts` entry or an eligibility context
  (validation), so no ambient family roll or rule reaches a horde member. Census (48 malls): **1.48 groups / 15.8 members per run**
  (1 group in 25 runs, 2 in 23; sizes 5..20, mean 10.7; max 30 members in a run), starts floor 1 / 2 / 3 = 17 / 27 / 27, every start
  ≥ 28.1 m from the platform start, 0 non-zombie members. Finite: no spawner, no kill top-up, no revisit respawn; kills persist
  through the run memory like every enemy.
- `rooms`: none (neutral by default).
- **Open-atrium perception** (mall round 3, R2 — user: "When killing zombies at the subway terminal the open atrium often causes zombies
  higher up to agro, causing them to run down in a big stream"; `game/src/ai/brain.ts` `ATRIUM_PERCEPTION`, mall only, across storeys
  only, noticing only): an UNAWARE enemy notices a player on another storey within its sight range × 0.75 measured in 3D (shambler
  13.5 m; the old test was the 18 m PLAN distance, so floor-3 zombies 21–23 m away noticed the pit), in its field of view, after 1 s
  of continuous sight; gunfire heard through the void × 0.7 per storey (through slabs × 0.35 as before), at most 3 new cross-storey
  responders per noise; a horde member's cross-storey sighting calls at most 2 mates (it called every mate within 6 m: up to 17
  measured). Aware enemies keep the established sight (no blindness); the dormant Siren's wake rules are untouched. Deterministic
  scenario, 12 malls × 90 s from the start (`reference/tasks/mall-round3-20261031/lanes/ENEMY-evidence`): roaming the platform 56 → 11
  upper-floor responders, largest single-event group 12 → 1; firing 49 rifle shots 63 → 27, group 11 → 2 (on the round-2 placement,
  before R8 moved ambient zombies into the shops: 100 → 15 and 98 → 47).

**Densities** (10-mall census, per 100 m² of the matching floor): station ambient 0.30, retail ambient 0.29, horde 0.46 of retail floor,
core total (ambient + hordes) 0.67 in that sample (every one of its runs drew 2 groups; with the 48-mall horde mean ~0.53) — the
six-ring mall: 0.26; the Office's ambient 0.45; annex `service` 0.23 of tunnel + annex. Old-vs-new tables:
`reference/tasks/mall-playtest-revision-20261031/evidence/census/final-census.md`.

**Runtime registration** (task mall-playtest-revision-20261031, D07; source trace + CPU test `game/tests/mall-profiles.test.ts`):
`game.ts` `buildSection` spawns EVERY `layout.zombies` index not killed in the run memory (`run/memory.ts` `enemiesToSpawn`) — hordes and
the annex's appended `service` spawns included — with no culling, frame-budget or distance gate (actors are added to the scene directly;
the level culler registers only the holder / shelf-stock groups); the only skip is a Siren whose model is not loaded (counted, warned
once, never a stand-in; mall round 3: `game/tests/mall-sirens.test.ts` builds the real Siren actors of a generated mall). `spawnEnemy` puts each body at `s.y ?? grid(s.level).floorAt(x, z)`. The test checks on generated malls that
every placed spawn (station, retail, horde, annex) stands on walkable floor of its own storey with the runtime support floor at that
height, and that the station storey and the annex hold stocked loot holders and loose finds.

The reference shows the tier, the dynamic identity, the Siren's eligibility rule with its spacing (`#eligibility`, `#elig-siren`) and its
sampled eligibility census (ambient spawns only), the horde pool (`#horde`) and the ambient budget (`#ambient-budget`) on
`enemies/mall.html`; `tools/pages/validate.ts` fails a build where one of them has no rendered place, and the census counts horde members
separately (`census.horde`) from the ambient contexts.

## The Reactor (`reactor`)

<!-- Task reactor-build-20261101 (primary): THE REACTOR, the user-selected B "Industrial Service Cathedral". -->

`REACTOR_SPAWN_PROFILE` (`SPAWN_PROFILES.reactor`, `LEVELS.reactor.tier = 3`) is ONE logical level, `LevelId` `reactor`. It is the
culminating level: a rim subway station at the TOP of a vertical industrial pit, four walkway tiers going down, and the core floor
round the dormant reactor vessel. `gen/reactor/index.ts` `generateReactorLevel` generates it once per level seed. Difficulty comes
from depth, using existing families only: no boss and no new enemy. The ambient runs, each tagged with its context by
`placeOfficeEnemies` on its own fork:

- **`station`**: the rim storey (platform, rim gallery, rim control office), U{2..4}, mostly zombies. The arrival is safe-ish.
- **`floor`**: each of the two UPPER walkway tiers (gas zone 1) including the BUNKER (tier 1) and MINES (tier 2) side complexes, U{6..8} per tier. Its own pool `familyPool({ratdog: 0.12,
  blightbelly: 0.04})`: rat/dogs flank on the catwalks.
- **`ring`**: each of the two DEEP walkway tiers (gas zone 2) including the WASTE repository (tier 4), U{8..11} per tier. Its own pool `familyPool({ratdog: 0.1, blightbelly:
  0.14, siren: 0.35})`. A Blightbelly's death puff temporarily re-gasses cleared air.
- **`pit`**: the core floor and its rooms (pump hall, control room, store), U{9..12}. Its own pool `familyPool({ratdog: 0.08,
  blightbelly: 0.16, siren: 0.35})`. These are the densest fights.
- **`service`**: `SERVICE_CONTEXT`, the rim station's Beyond-the-Station annex (`TRACK_EXT_REACTOR.annex.max = 1`, the standard
  one-roll chance). The Strainer appears there and nowhere else (`STRAINER_CONTEXTS` unchanged).
- **The Siren is opt-in** via `REACTOR_SIREN_ELIGIBILITY`: contexts `ring` and `pit`, side ROOMS only (the dark alcoves off the
  galleries), at most **2** per level, ≥ 30 m apart (`REACTOR_SIREN_SPACING`, `applyFamilySpacing`). An ineligible draw falls back
  to a zombie. The flashlight you need in the gas is also what wakes her.
- **No horde pool** in the first pass. The noise of a running auxiliary generator pulls EXISTING enemies onto its landing
  (`world/reactor/generators.ts`, `alertListeners`); nothing spawns.
- **Census** (12 generated pits, seeds `9100 + 104729k`, task reactor-expansion-20261101 with all three side complexes carved and the
  mines follow-up): ~**47** ambient enemies per run (43–50: station 2–4, floor 12–16, ring 18–21, pit 9–12, plus a service annex in 1
  of 12 runs); Sirens mean **1.5** (max 2; 1.6 before the round-2 rock suites, task reactor-playtest-round2-20261102 lane ARRIVAL:
  same corpus, ambient counts per context and the other families unchanged); Blightbellies mean 4.3; rat/dogs mean 4.9. The tier counts grew with the complexes (~2,600
  m² of new floor on tiers 1 / 2 / 4) so the shaft is not thinned out.
- **Density rises with depth by construction:** an upper tier's maximum (8) is a deep tier's minimum. With the complexes' floor the upper
  tiers now place their full draw, so the two upper tiers can never outnumber the two deep ones. Checked on those 12 pits and on the 8
  standard seeds 1–8 (upper pair 12–16, deep pair 16–21).

## Skyways (`skyways`)

<!-- Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS, a connected multi-building pedway network. -->

`SKYWAYS_SPAWN_PROFILE` (`SPAWN_PROFILES.skyways`, `LEVELS.skyways.tier = 2`) is ONE logical level, `LevelId` `skyways`
(`game/src/gen/skyways/index.ts` `generateSkywaysLevel`): a subway station under the station building and its pedway concourse
(storey 0), the street-level lobbies / atrium courts / entrance halls of every building (storey 1) and the "+15" skyway level with
the glazed bridges between the buildings and the one add-on hall (storey 2). It uses the ordinary pool (`ENEMY_POOL`: no Siren —
she is opt-in and Skyways declares no eligibility rule) and the Office's placement rules (`OFFICE_PLACEMENT`: never in a stair
core, light in storefront units and closets, 5 m off every run landing). One `placeOfficeEnemies` run per storey, each on its own
fork (`skyways-enemies-<storey>`), tags its spawns with the context:

- **`station`**: the station storey (platforms, the pedway concourse, the station's back of house), U{5..8}.
- **`street`**: the street level of every building (lobbies, atrium courts, entrance halls, shops, service rooms), U{8..12}.
- **`floor`**: the skyway level (concourses, bridges, atrium galleries, shops, the add-on hall), U{10..15}.
- **`service`**: `SERVICE_CONTEXT`, the station's Beyond-the-Station annex (`TRACK_EXT_SKYWAYS.annex.max = 1`, the standard
  one-roll chance), appended last; the Strainer only there (`STRAINER_CONTEXTS` unchanged).
- **`cosplay`** (layout version 5+; task studio-skywalk-encounters-20261108-074144-01, lane COSPLAY; user: "the animie convention
  "event" should have special "cosplay zombies" spawned, which are just zombies wearing special clothing"): the CONVENTION zone
  `COSPLAY_CONTEXT` (`game/src/ai/cosplayContext.ts`). Only when the level's one add-on is the anime convention (never the prize
  display; at most one per level: `COSPLAY_CONVENTIONS_MAX`), `game/src/gen/skyways/cosplaySpawns.ts` `placeCosplaySpawns` runs ONE
  run on its own fork (`skyways-cosplay-spawns`, drawn from only then): **U{4..6}** spawns (`COSPLAY_ZONE_BUDGET`) on the venue's
  public event floor (main hall, exhibitors' floor, photo lounge, panel rooms: round-robin, the main hall first; layout version 6 adds
  a second run on the convention building's other floor, see "Version 6" below), each a 3 × 3-clear
  walkable floor cell, never a ramp, ≥ 36 walking cells from the start, 5 m off the run landings, ≥ 3 m from every door of those
  areas and from the add-on's entry, ≥ 2.5 m from every mascot statue, off the stage + 1 m, 2 m from every enemy on the storey, a
  0.5 m disc never splitting the storey (`COSPLAY_PLACEMENT` + `COSPLAY_SPAWN_RULES`). Every spawn is a shambler tagged
  `ZombieSpawn.look = 'cosplay'` and the context `cosplay`, APPENDED after every other spawn (ambient, annex `service`): every other
  index is unchanged. Families: its OWN pool `COSPLAY_FAMILY_POOL` (ordinary zombies only); no eligibility rule names it; not in
  the storey counts. Looks: `chooseSpawnLook` gives exactly these spawns a costume — `game/src/ai/cosplay.ts` `cosplayLook(layout
  seed, spawn index)`: FULL head-to-toe costumes (task studio-cosplay-general-20261108-225231-01, lane COSTUME: bear idol, mascot
  suit, sushi fan, rose uniform - head piece, jacket / top, skirt or trousers with legwear and footwear; consecutive spawns differ;
  ~70 % on female bodies, the unclothed pale ones preferred, seeded per spawn and local to the convention), built by its SEPARATE
  `createCosplayLibrary` (the ordinary pool can never pick a costume piece), only when buildable exactly, else a COVERED ordinary pick
  (`cosplayFallbackPool`: the ordinary pool without the unclothed bodies); the files (`COSPLAY_MODEL_FILES`:
  `outfit-cosplay-costume-{head,upper,lower}.glb`, `tools/asset-pipeline/zombie/build-cosplay-costumes.mjs`) load lazily, only for a
  layout holding a cosplay-tagged spawn (`cosplayModelKeysFor`), before the section is built and warmed up. Versions 1-4 never run
  it (`SKYWAYS_V4_SPAWN_PROFILE` has no such context). Tests: `game/tests/skyways-cosplay-spawns.test.ts`,
  `game/tests/skyways-cosplay-looks.test.ts`, `game/tests/skyways-cosplay-costumes.test.ts`.
- No horde pool and no room modifiers. One family roll at the end (`assignEnemyArchetypes`). The convention mascot statues are
  static props, never enemies.

This was layout versions 1–4. That profile is frozen as `SKYWAYS_V4_SPAWN_PROFILE`, and stations entered under those versions keep
it exactly (`skywaysSpawnProfileFor(version)`; fingerprints in `tests/skyways-dest-layout-version.test.ts`).

### Version 5: the Siren and the horde at the Mall's rules

<!-- Task studio-skywalk-encounters-20261108-074144-01. User: "It feels like the siren cannot spawn on this level, It should spawn the
same amount as the mall" / "I want to have at least 1 random zombie hoard spawn on this map (just like the mall hoard)". -->

**Siren.** Before version 5 she could **not** spawn on Skyways: the pool weight was 0 and there was no eligibility rule. With the
Office's placement, storefront units weighted 0.5, only about 1.25 of a level's roughly 22 street / skyway slots would have passed
her room gates anyway. That is the Mall's own pre-R8 finding.

`SKYWAYS_SPAWN_PROFILE` (version 5) uses the Mall's rules unchanged:
- **Draw.** `MALL_SIREN_WEIGHT` 0.8.
- **Placement.** The Mall's retail-floor placement on the `street` and `floor` contexts (`MALL_RING_PLACEMENT`: shop sales floors ×
  `MALL_SHOP_WEIGHT` 6). The counts and the station storey's Office placement are unchanged.
- **Room gates.** The Mall's gates (`SKYWAYS_SIREN_ELIGIBILITY`): enclosed rooms of the street / skyway storeys, room ≥ 4 × 4 m, a
  clear 1.5 × 1.5 m patch, doorways ≥ 3 m away, never sealing passage, ≤ 4 per level.
- **Spacing.** 24 m apart.

| Census (48 finished version-5 levels, seeds 1201 + k·7919, k = 0..47) | Skyways | The Mall (its census) |
|---|---|---|
| Sirens per level (mean) | 1.54 (halves 1.75 / 1.33) | 1.96 (halves 2.17 / 1.75) |
| Levels with none | 7 / 48 (14.6 %) | 8.3 % |
| Share of the placed non-horde enemies | ~4.6 % of ~33 | 10.3 % of ~19 |

The Mall's rules are not boosted here. The draw is close to saturation, so the remaining gap comes from Skywalk's smaller, fuller
shop rooms passing her room gates less often. Before the Mall store units took their dense Mall fit-outs, the same census read
1.79.

She is never on the station storey, in an annex, in a horde or in the convention's cosplay crowd.

**Horde.** The Mall's horde pool is `SKYWAYS_HORDE` = `MALL_HORDE`, only with `placement.storeys` [1, 2]:
- 1–2 groups of 5–20 ordinary zombies, 40 % coated;
- the Mall's budget (32 members, 20 per storey, one group per storey) and its group / member / ambient spacing;
- each start ≥ 45 m walking and ≥ 28 m straight from the start;
- members clipped to the storey's patrol route (18 m per member) and the Mall's patrol pace.

Groups roam the **Skyways patrol graph** (`gen/skyways/patrol.ts`):
- nodes every ~8 m on the public walkways (kind `concourse` / `passage`, never a stair core) of the street and skyway storeys;
- verified walks between them, plus the stair runs between those two storeys;
- never the station storey with the train.

Placement is `placeHordes` on its own fork (`skyways-hordes`). It runs after the ambient runs, so their positions are kept off, and
after the traversal finishing. The dressers' holds stay clear (stair-run mouths, bridge-deck lanes, store interiors).

The census (48 finished levels): 1.44 groups per level, **no level without a horde**, 17.0 members per level. Members are
`layout.zombies` entries appended after every ambient spawn and before the annex's. The normal kill memory keeps killed members dead
on return or Continue. A group with no living member stays dead, and the living ones start again from their placed positions (as
in the Mall). Runtime: `HordeDirector` walks `layout.skyways.patrol`.

### Version 6: the convention's cosplay crowd on both floors of its building

<!-- Task studio-cosplay-general-20261108-225231-01 (lane UPPER). User: "Convention cosplay zombies need upper-floor presence too, not
just bottom." -->

**Why only one floor before.** The convention venue is ONE storey: the host's skyway floor (storey 2, y 10). That storey holds its
main hall, exhibitors' floor, registration, panel rooms, photo lounge and back of house. Nothing lies above it, and the host stays a
classic block with no atrium, gallery or mezzanine. The stage deck is walkable at runtime (`stageSupport.ts`), but it is the stage
and never a spawn floor. The host's street floor (storey 1, y 5) is its ordinary lobby / galleria / court and entrance halls. The
host's own public stair joins it to the venue. The version-5 run only ever stood on the venue storey (30 checked convention seeds:
always storey 2, no raised venue floor).

**The second run.** `game/src/gen/skyways/cosplayFloors.ts` `placeCosplayFloorSpawns` (gated on `SKYWAYS_COSPLAY_FLOORS_MIN_VERSION`
= 6; own fork `skyways-cosplay-floors`) adds **U{2..4}** (`COSPLAY_FLOOR_BUDGET`) more cosplayers. They go on every OTHER public
storey of the host that a stair inside the building joins to the venue storey (`cosplayFloorLevels`, above or below; today always the
street floor).
- **Where.** The host's public concourse there (`cosplayFloorAreas`: kind `concourse`, type `concourse` / `retail-arcade`): never a
  shop, washroom, back room, stair core or another building. Each pick is uniform over that floor's stand points.
- **Fairness.** The venue run's rules on that floor: walkable 3 × 3-clear floor at the storey's height, never a ramp, ≥ 36 walking
  cells from the start, 5 m off every landing, ≥ 3 m from every door of those areas and from the boarded street entrances, a 0.5 m
  disc never splitting the floor, and 2 m spacing.
- **Tags and order.** The same shamblers, look, `cosplay` context and zombie-only pool. They are APPENDED right after the venue run,
  so every earlier spawn, horde, prop and pickup is version 5's. The census hook is not fed, because that floor is already reported
  under `street`.
- **Saves.** A station first built at 1–5 keeps that version and its enemies (GAME87 pins). Unvisited stations and new campaigns get
  version 6. Both versions use `SKYWAYS_SPAWN_PROFILE`.
- **Census.** 30 convention seeds: venue 5.13 and street floor 2.93 per level, never fewer than 2 on either. The 10-seed test set:
  5.0 / 3.0. Test: `game/tests/skyways-cosplay-floors.test.ts`.

## The Survivor Market (`market`)

<!-- Task studio-survivor-market-20261108-005807-01 (lane LEVEL): a calm survivor settlement, no enemies. -->

`MARKET_SPAWN_PROFILE` (`SPAWN_PROFILES.market`, `LEVELS.market.tier = 1`) is ONE logical level, `LevelId` `market`
(`game/src/gen/market/index.ts` `generateMarketLevel`): a calm settlement in a salvaged railway shed where the player's train stops.
It places **no enemies anywhere**: its one ambient context **`station`** counts U{0..0} and the generator never asks for a placement
run; there is no horde pool, no eligibility rule (no Siren) and no service annex (`LEVELS.market.trackExtensions` is `'none'`;
`TRACK_EXT_MARKET.annex.max = 0`), so the declared **`service`** zone never runs. Its friendly residents and traders are not enemies
(never in `layout.zombies`), and no other level's profile is ever used as a fallback.

## The Bunker (`bunker`)

<!-- Task studio-bunker-level-20261109-072224-01 (lane LEVEL): a civil-defence shelter descending under its station. -->

**Layout version 2** (task studio-bunker-rework-20261109-205115-01, docs/bunker.md "Version 2"): the same profile, contexts, pools,
Siren eligibility / spacing and damp-only Strainer run over the rebuilt storeys (`gen/bunker/v2/index.ts`: the shared
`placeBunkerEnemies`); census over 16 levels (`tests/bunker-v2-level.test.ts`): 40.9 enemies per level (budget 46), Sirens 1.8 per level
(on 15 of 16, at most 3), Strainers on 3 of 16 (at most one, damp areas only). The lift-apron centres join the arrival keep-offs; no
enemy calls or rides the cargo lift on purpose (the pathfinder uses the stairs).

`BUNKER_SPAWN_PROFILE` (`SPAWN_PROFILES.bunker`, `LEVELS.bunker.tier = 2`) is ONE logical level, `LevelId` `bunker`
(`game/src/gen/bunker/index.ts` `generateBunkerLevel`): a buried station at the vault door of a civil-defence shelter, and the shelter's
storeys going DOWN below it to the central processing core. Existing families only, depth-graded like the Reactor but never denser. The
ambient runs, each tagged with its context by `placeOfficeEnemies` on its own fork:

- **`station`**: storey 0 (the platform, the arrival hall, the vault vestibule), U{2..3}; a Siren drawn there is ineligible (the
  rule lists `floor` / `ring` only) and stays a zombie; the arrival keeps its start keep-off.
- **`floor`**: each of storeys 1–3 (entry & security, habitation, services & medical), U{6..8} per storey.
- **`ring`**: each of storeys 4–5 (maintenance & water, the processing core), U{7..9} per storey.
- Every storey run reads the LEVEL pool `BUNKER_SHELTER_POOL` = `familyPool({blightbelly: 0.07, siren: BUNKER_SIREN_WEIGHT})` (rat/dog
  the default 0.05), `BUNKER_SIREN_WEIGHT` = 0.16 (set by the census below). Depth grading comes from the counts. Only the damp zone has
  its own pool (`tests/service-families.test.ts` lists it as the fourth deliberate exception). It is the level pool because
  `applyFamilySpacing` re-derives a spawn's family from the level pool: a Siren drawn from a context's own pool would escape her
  spacing / cap.
- **`damp`** (a ZONE context, `BUNKER_DAMP_CONTEXT`): ONE spawn per level over the water-damaged areas only (`layout.bunker.damp`: the
  pump hall, the filtration plant, the flooded wing), appended after the storey runs. Its own pool `BUNKER_DAMP_SHARES` (rat/dog 0.1,
  **Strainer 0.3**, the zombie the remainder) is the only place outside the service annexes where THE STRAINER (unchanged: 1200 HP,
  long reach) may appear (`STRAINER_CONTEXTS = ['service', 'damp']`) — at most one per level, never guaranteed.
- **`service`**: declared (`SERVICE_CONTEXT`, the shared annex contract) but never run — `LEVELS.bunker.trackExtensions` is `'none'`.
- **The Siren is opt-in** via `BUNKER_SIREN_ELIGIBILITY`: contexts `floor` and `ring` (never the station storey), enclosed ROOMS only
  (never a stairwell, washroom, closet or corridor), the Office / Mall room gates, at most **3** per level, ≥ 24 m apart
  (`BUNKER_SIREN_SPACING`, `applyFamilySpacing`). An ineligible draw falls back to a zombie.
- **No horde pool.** Ambient budget 3 + 3 × 8 + 2 × 9 + 1 = 46 per level (the Reactor's is 54).
- **Census** (32 generated levels, level seeds 4401 + k × 7919, `tests/bunker-spawns.test.ts`):
  - enemies: 40.9 per level (station 2.6, floor 21.3, ring 16.0, damp 1.0);
  - Sirens: 1.47 per level; 31 of 32 levels have at least one; max 3;
  - Strainers: 0.38 per level; 12 of 32 levels have one; never more than one.

  The Siren's share is about the Mall's (1.96) and the Office's (1.97).

## Units: what the numbers are

- **Count range**: spawns one run of a context tries to place; E[count] = (lo + hi) / 2. There is no per-area spawn density at
  runtime.
- **Area weight**: a relative preference in the weighted area order (Efraimidis–Spirakis keys u^(1/w)). Never a chance or a count.
  Caps (1, 2, 3 per pass; platforms + 1; closets / closed exits / storefront units 1), spacing, tries and eligible cells decide how
  many spawns an area can take. A run can place fewer than its count when the eligible, spaced cells run out.
- **Family share**: weight / Σ weights — the chance that one placed spawn's roll DRAWS that family. Without an eligibility rule
  that is its placed share; a restricted family (the Office Siren) places fewer than it draws, measured by census.
- **Sampled density** (reference only): placed spawns per 100 m² of eligible floor over a small labelled seed corpus. Eligible floor
  = the cells the generator's own candidate filter accepted, 0.25 m² each — never map bounding boxes. It is a census, not a rule.

## Families and shares (task track1-siren-blightbelly-20261031)

| Level | zombie | blightbelly | siren (draw) | ratdog | Placed per complete run (400-run census) |
|---|---|---|---|---|---|
| `subway` (tier 0) | 0.90 | 0.05 | 0 | 0.05 | 27.0 enemies: zombie 90.1 %, Blightbelly 4.8 %, rat/dog 5.1 %, Siren exactly 0 |
| `office` (tier 1) | 0.71 | 0.05 | 0.19 | 0.05 | 38.7 enemies: zombie 85.1 %, Blightbelly 4.8 %, rat/dog 5.0 %, Siren 5.1 % = mean 1.97 per run |

(400 + 400 generated levels with the shipped code: Office seeds 700000 + 101 k, Subway seeds 900000 + 61 k, k = 1..400.)

- **Rat/dog identical.** The new families sit BEFORE `ratdog` in the roll order, so the rat/dog keeps the top band [0.95, 1) of the
  same roll: every rat/dog draw of every seed is unchanged (`game/tests/enemy-spawn-contract.test.ts`, 200k rolls; the parity pins).
  Blightbelly and Siren take shares of the old zombie band — the count, positions, order, types, areas and pickups are unchanged
  (`game/tests/enemy-spawn-parity.test.ts` invariant pins, computed from the untouched main dba90dd sources).
- **Zombie sub-distributions stay inside the zombie family.** Every spawn keeps its shambler / coated type roll; a Blightbelly /
  Siren ignores it (its own stats; no wardrobe outfit, no coated health).
- **Strainer (round 4): 0 in every level pool.** Every level pool lists `strainer` explicitly at weight 0, appended LAST in the roll
  order: the pool total and every band are unchanged, so every core draw of every seed is bit-identical
  (`game/tests/strainer.test.ts`: 200k rolls per level pool, room modifiers included; core views of the parity pins). Its only
  weight is the service annexes' 0.08 (below).
- **Siren draw weight vs placed share.** Only ~11.3 of the ~38.7 slots of an Office run pass `OFFICE_SIREN_ELIGIBILITY`; an
  ineligible draw becomes a zombie. 400-run census (seeds 700000 + 101 k): draw weight 0.12 → 1.28 / run, 0.16 → 1.67, 0.18 → 1.87,
  **0.19 → 1.97 (12.5 % of runs none, max 4 = the cap; histogram 0: 50, 1: 102, 2: 117, 3: 71, 4: 60)**, 0.20 → 2.09. Not a
  guarantee of exactly two; never per floor.

## Family eligibility

`eligibility: {family: {contexts, kinds?, excludeRooms?, minSideCells?, minAreaCells?, clearCells?, doorKeepM?, passageRadiusM?,
maxPerLevel?, fallback, why}}`. Checked only for spawns that drew the family (no RNG, no runtime cost); the first failing criterion
sends the draw to `fallback`. Never renormalised, so no other family's draw or share moves.

- **Contexts** come from the generator's own tags: each placement routine calls `markSpawnContext(layout, first, context)` (the
  Office's `placeOfficeEnemies`, the Subway's station run in `gen/station.ts` and the annexes' `placeServiceSpawns` do); a
  single-context profile would need none (the Subway has two since Track 2: `station` + `service`). Untagged = never eligible.
- **Office Siren** (`OFFICE_SIREN_ELIGIBILITY`), an indoor-room encounter of the office floors: context `floor` only (no station,
  lobby — context `street` — or roof); kind `room` (no corridor `office-corridor` / passage, no closet); never `washroom`,
  `office-stair`, `stair-core`, `office-elevator` (nor `office-lobby` / `office-roof`); room ≥ 4 × 4 m (shorter side 8 cells, 100
  cells); a clear 1.5 × 1.5 m patch of the room's own floor (3 × 3 cells, same area); every doorway of the room ≥ 3 m away (stepping
  in never wakes her at her 2 m proximity range); fair passage — a 2.5 m disc around her never splits the storey's walkable floor
  (pockets ≤ 8 cells ignored), so the player can always walk round her; at most 4 per level. 400-run census: 2927 Siren draws,
  789 placed (all on floors 2..8, 101–133 per storey; most in open-plan offices, meeting rooms and tenant receptions); the 2138
  that fell back, by first failed criterion: context 26.7 %, size 21.8 %, kind 21.1 %, door 16.8 %, passage 5.3 %, room 5.1 %,
  clear 1.8 %, cap 1.3 %. A 2.5 × 2.5 m clear patch was rejected: only ~2.4 eligible slots per run in furnished rooms.
- **Subway**: no `eligibility` (Siren weight 0; validation forbids a Siren weight without a rule — `OPT_IN_FAMILIES`).

## Service annexes (Track 2 zone context `service`)

<!-- Track 2 — Beyond the Station (lane CONTENT) -->

The track tunnels past the station's bed ends can lead, through a side door, to a seeded **service annex**: a cramped, dark
back-of-house of plant rooms, stores, closets and 1.5–2 m corridors (`game/src/gen/trackExt/` generates it; 0–2 per level, only on the
20 % of levels whose one area roll succeeds — docs/track-extensions.md —, each ~25 % of the Subway's walkable exploration area). It is part of its LOGICAL level (docs/level-enemy-contract.md §2): same profile,
same family pool and zombie types, same tier.

| Control | Value (`SERVICE_CONTEXT`, `game/src/ai/spawnTables.ts`) |
|---|---|
| Declared in | `SPAWN_PROFILES.subway.contexts.service`, `SPAWN_PROFILES.office.contexts.service`, `SPAWN_PROFILES.mall.contexts.service` (lane INTEG; at most one annex per mall) |
| Count | `SERVICE_ZONE_BUDGET` = U{5..6} **per annex** (one draw per annex run), additive to the core contexts (playtest revision: was U{3..5}) |
| Area weights | `SERVICE_AREA_WEIGHTS`: annex rooms 1.4, corridors 1.0, closets 0.6 |
| Caps | `SERVICE_CAPS`: passes 1 / 2; closets 1 |
| Spacing / tries | 5 m (wider than the station's 4 m: dark and cramped) / 12 |
| Keep-away | ≥ 36 walking cells from the start, 3 × 3 clear, ≥ 6 m from the annex's entry door (`landingKeepM`: its keep point) |
| Depth bands (playtest revision) | the count split over the annex's entry / middle / deep door-hop thirds (equal quotas, remainder to the middle; a band without room passes its quota on) |
| Earshot (playtest revision) | cells beyond `SERVICE_EARSHOT_M` (18 m) of every core station floor cell preferred (rifle earshot through rock; all cells when none is) |
| Accept | `{min: null, max: 'count'}` — never regenerates a level (extensions never decide a retry) |

- **Why 5–6 (playtest revision, was 3–5).**
  - **Density:** an annex is ~25 % of the Subway's walkable-exploration baseline (~1840 m² of 7371 m²). The station's 22–32 spawns
    over that baseline would put ~6.8 into an annex at the same density, so 5–6 is ~80 % of it.
  - **Bound:** the registry contract requires every context's count hi to fit the level's `budgets.ambient.perStorey`; the compact
    Mall's is 6 (mall revision D07), so the shared per-annex hi is 6.
  - **What the user saw:** at 3–5 (60 %), an ordinary room-by-room route met 0–2 of an annex's enemies. They sat in closed rooms,
    and station gunfire (heard by straight-line distance through rock) pulled a hatch annex's near ones out. The user's two fresh
    runs found none.
  - **Fairness kept:** no corridor ambush at the door (6 m keep-off) and no respawn.
- **Placement.** One run per annex on its own fork (`track-ext-content` → `service:<annex>`), in that annex's areas only, AFTER
  every core spawn (the core's indices, rolls, run-memory keys and parity pins are unchanged) and tagged
  `markSpawnContext(layout, first, 'service')`; `assignEnemyArchetypes(layout, profile)` then runs ONCE over every context.
- **Families (round 2, R6; round 4).** The annexes have their OWN ambient pool, `SERVICE_FAMILY_POOL` (`SpawnContextRule.families` on
  `SERVICE_CONTEXT`): rat/dog **0.20**, Blightbelly 0.05 (unchanged), **Strainer 0.08** (round 4), Siren 0, ordinary zombies the
  remainder **0.67** (0.75 before the Strainer). User (round 2):
  "the rat-dog spawn rate should be boosted to 20% in this area." `assignEnemyArchetypes` reads it only for spawns tagged
  `'service'` (`spawnContextOf`): the same single `enemyRoll(seed, index)`, room modifiers and eligibility on top. Every core
  context keeps the level pool (the same array, so core draws are bit-identical), and hordes are skipped as before.
  - **Configured vs placed:** 0.20 is a per-spawn selection probability, not a quota; a 5–6-enemy annex may hold none or several.
    Sampled outcomes: the 36-run Subway census in `enemy-spawn-contract.test.ts` placed 19.1 % rat/dogs among service spawns (core
    5.0 %); the R6 sample (`service-families.test.ts`: Subway 1043 / 1002, Office 222, Mall 846932) placed 8 of 33 (24 %).
  - **No Siren in an annex:** the service pool lists her at 0, and the Office's `OFFICE_SIREN_ELIGIBILITY.contexts` stays
    `['floor']`; her whole-level rarity and `maxPerLevel` stay level-wide.
  - **The Strainer (round 4, task studio-alpha-beyond-station-round4-20261101-01):** configured selection share **0.08** per service
    spawn — the ONLY pool with Strainer weight (`STRAINER_CONTEXTS = ['service']`; 0 in every level pool, every other context and
    every horde). A configured weight, not an outcome: no Strainer is forced into an annex and none is guaranteed (a 5–6-enemy annex
    holds about 0.44 on average, often none). Roll bands of the service pool (registry order, Strainer appended last): zombie
    [0, 0.67), Blightbelly [0.67, 0.72), rat/dog [0.72, 0.92), Strainer [0.92, 1) — the service spawns' rat/dog / Blightbelly bands
    moved up with the smaller zombie remainder (their shares are exactly as before); every core pool keeps its bands. Node
    simulation (`game/tests/strainer.test.ts`, 2000 synthetic levels per profile, 16k tagged service spawns each): Strainer
    7.7–7.9 %, only in service spawns, core picks unchanged. Family details: "The Strainer" below.
- **Counted separately.** The core contexts' validation counts (Subway `station` ≥ 8; Office `street` / `floor`) and the census /
  parity counts exclude annex spawns (`tests/helpers/enemySpawnParity.ts` `contextCounts` prints them as `+ service N`); the
  reference shows `service` as a zone context, never inside the whole-level total.
- **Persistence.** Killed annex enemies stay dead for the run (the per-index memory, `game/src/run/memory.ts`); nothing respawns
  on entry; Retry / revisits regenerate the identical annex spawns from the seed.
- **Census** (lane CONTENT, shipped code incl. GEN-2's incidence): Subway 24 seeds (`(i × 2654435761 + 12345) >>> 0`, i < 24) —
  1.12 annexes per level (3 with none, 15 with one, 6 with two; 6 of the 27 entered by a service hatch), 3.85 placed per annex,
  4.3 service spawns per level (max 10) on top of the station's ~27; Office 10 seeds (3, 7922, 15841, 23760, 31679, 39598, 11, 222,
  3333, 4242) — 1.5 annexes per level, 3.7 placed per annex, 5.6 per level (max 9). No annex run placed fewer than its count.
  (Before the playtest revision's 5–6 budget, and before the 2026-11-01 one-roll rule: the annexes — so the service spawns — now
  exist only on the ~20 % of levels whose Beyond the Station area roll succeeds, docs/track-extensions.md "The area roll".)
- **Playtest-revision measurement** (fresh New Game path; Subway 1043 / 1002 / 777001 / 777002, Office 222 / 3333, Mall 846932 /
  5150 / 9090):
  - **Placed:** 5–6 per annex (parity corpus: Subway levels +5 / +6 with one annex, +10 / +11 / +12 with two; Office +10 / +11
    with two; the Mall's one annex 5–6). All at the annex floor, all reachable from the annex door, at least 2 depth bands each,
    mostly beyond 18 m of core station floor.
  - **Encounters:** ordinary discovery routes (`tests/helpers/annexRoute.ts`, the game's real ZombieBrain) made 1–3 enemies aware
    per route, the first within 0–3 rooms. Before, 0–2 of 3–5 (one route met none). The routes never shoot, so real play
    draws in more.

## The Strainer (`strainer`, round 4)

<!-- Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY). -->

A tall (bind height 2.15 m, slightly taller than a zombie), long-armed, clawed infected — the user's pick for Beyond the Station. A
NORMAL registered family: `ENEMY_ARCHETYPES.strainer` (`game/src/ai/creatureArchetypes.ts`), stats `STRAINER_STATS` and brain
`StrainerBrain` (`game/src/ai/strainer.ts`), actor `StrainerActor` (`game/src/ai/strainerActor.ts`), lazy model `enemy_strainer` →
`assets/models/enemy-strainer.glb` (`game/src/ai/enemyModels.ts`: fetched only for a layout that placed one). It spawns only through
the ordinary per-spawn family roll of the service annexes (0.08, above) and (task studio-bunker-level-20261109-072224-01) of the
Bunker's damp-section zone (0.3 of its one spawn per level, "The Bunker" above) — no special spawner, no forced or guaranteed Strainer.

| Stat | Strainer | Ordinary zombie (shambler) |
|---|---|---|
| Health | **1200** (12x; 200 → 600 → 1200 — user playtests 2026-11-01: "much to weak", "needs double the health") | 100 |
| Claw damage | **24** (2.4x; was 13) — slow but heavy | 10 |
| Walk / chase speed | **0.40 / 1.35 m/s** (was 0.585 / 2.45): it LUMBERS — a walking player (3.4 m/s) outpaces it | 0.65 / 2.55 m/s |
| Attack range (centre to centre) | **3.862 m** (was 1.931 — doubled, user: "double the reach of the swing"): the lunging long-arm swipe reaches 2.311 m (contact 2.611 m) and the body lunges the last 1.251 m toward the player in the clip's 0.62 → 1.0 s window (motor-applied: walls / storeys / bodies block it); the claws connect within 2.611 + 0.45 m after the lunge (`STRAINER_REACH`, `ZombieStats.lunge` / `hitRange`) | 1.35 m |
| Swing / claw contact / cooldown | Attack clip **2.0 s**, claws land at **1.0 s** (a telegraphed coil; the clip's `attackHitTime`), **1.0 s** recovery (was 1.4 / 0.6 / 0.6) | 1.1 s / 0.45 s / 0.45 s |
| Collider radius / turn rate | 0.36 m / **3.0** rad/s (was 4.0) | 0.33 m / 4.5 rad/s |
| Stagger | only a single hit ≥ 45 (`STRAINER_STAGGER_MIN`): ordinary rounds never stun-lock it | any hit ≥ 20 |
| Ladders / track bed | never climbs (path requests ignore ladder links) / drops in like every enemy | climbs / drops in |
| Root scale | its own 0.97–1.03 (crown ≤ 2.215 m, under the 2.3 m annex doors) | 0.95–1.05 |

- **Ordinary melee only:** the zombie brain (sight, chase, search, light lure, one claw swipe per attack with the LOS + reach +
  facing checks). No acid, ranged, explosion, scream, boss, ceiling, teleport or loot systems. Its hit on the player is a standing
  humanoid melee hit (melee locations, attacker `strainer`).
- **Hit zones:** a head sphere at the asset's `headCenter` / `headRadius` (the head is hunched FORWARD of the body; carried on the
  Head bone, scaled with the actor), a Hips → Neck torso capsule and arm / leg capsules; ordinary body hits elsewhere. Death, corpse
  volumes and ragdoll (the humanoid rig on the shared 18-joint skeleton) go through the existing contracts; kills persist through
  the run memory like every enemy.
- **Audio:** `STRAINER_CUES` — the existing zombie voice calls (the deep groan from its 1.9 m mouth, alert, death) plus its OWN wet
  squelch set (reach + squish task: local Sound Lab, `game/src/audio/manifest.strainer.generated.ts`): squelching footsteps on its
  real footfalls, a wet arm-swing peaking at the impact, a fleshy contact squelch only on a hit, a rate-limited squish when shot.
- **Lumbering animation** (user playtest 2026-11-01): the local clips (`tools/asset-pipeline/enemy/lib/strainer-clips.mjs`) are a
  heavy, flat-footed, weight-shifting Walk (2.6 s, 0.42 m/s) and a chase lumber `Run` (1.6 s, 1.35 m/s = the chase speed, double
  support, no flight phase) played at their authored speeds (feet planted), and a slow telegraphed Attack (2.0 s, impact 1.0 s; the
  hit pose and 1.631 m reach unchanged).
- **Wet look** (user playtest): `STRAINER_WET` — a RUNTIME material layer on the ORIGINAL Meshy maps (roughness factor x0.38, colour
  x0.82); the GLB's texture images stay the original Meshy re-encodes (pinned in `strainer-asset.test.ts`).
- **Wet-shine trail** (user playtest): `ai/strainerTrail.ts` drops one glossy wet film (world/fx.ts `WET_TRAIL`: one fixed instanced
  ring of 64, ONE draw call, each mark fading over 14 s, oldest recycled) every 0.6 m it walks, alternating feet, flat on the floor
  height of its own storey / track bed. Purely visual: no water physics, slip or damage.
- **No model → counted zombie stand-in** (`createEnemyActor` `fallback`, the Blightbelly's contract; QA `strainers()` / `enemyMix()`).
- **Asset contract numbers** (`STRAINER_ASSET` = the `enemyStrainer` extras of `enemy-strainer.glb`;
  `game/tests/strainer-contract.test.ts` checks the agreement): heightM 2.15, headCenter [-0.0006, 1.9481, 0.228] (the crown hunched
  forward, on the Head bone), headRadius 0.257, reachM (horizontal claw reach at the Attack hit frame; see below),
  attackHitTime 1.0 s, Attack clip 2.0 s, Walk / Run ground speeds 0.42 / 1.35 m/s; hit radii torso 0.241 / arm 0.0633 / leg 0.1004;
  reachM 2.311 since the lunging swipe (was 1.631).

## Room modifiers

`rooms: {roomKey: {family | 'all': {density?, weight?}}}` with every missing value = 1.

- **Room key** of an area: its purpose id (`game/src/gen/purposes.ts`) when it has one, else its room type. Each field resolves
  purpose entry → room-type entry → 1. Example: the Office roof deck is type `office-roof` but carries the preset purpose
  `office-stair`; a roof modifier uses the room type `office-roof`.
- **`density` — local intensity.** The room's baseline area weight is multiplied by the room intensity
  D = all.density × Σ_f p_f·w_f·d_f / Σ_f p_f·w_f (p = pool weight, w = weight modifier, d = the family's density modifier), and
  the room's family mix becomes p_f·w_f·d_f. To first order a family's share of the spawns landing in that room scales by its
  density while the other families' stays put.
  - It never changes the count roll and never raises a cap: modifiers move spawns between rooms, they cannot add any.
  - 0 → the room is never a candidate. 2 → the room is visited earlier in every cap pass, so it tends to fill its caps: more spawns
    there, fewer elsewhere, the same total.
- **`weight` — conditional composition.** Multiplies a family's pool weight for spawns that land in the room:
  P(f | the room) = p_f·w_f·d_f / Σ. It changes which family a spawn there becomes, never how many spawns the room attracts.
  0 → that family never spawns there; 2 → twice its relative odds there.
- **`all`** carries a room-wide density (every family; it multiplies a family's own density). It has no weight.
- **Neutral parity.** A room with no entry takes the shipped path untouched (the same area weight number, the same pool array);
  an explicit 1 is bit-identical too (x·1 === x, Σ/Σ === 1), so every seeded spawn and RNG draw is unchanged.
- **RNG side effects.** Weight modifiers never touch an RNG stream (the family roll is a hash). A density modifier changes
  placement draws; on the Subway the storey moves of loose floor supplies run on the same stream right after the enemy moves, so
  those moved supplies may land on other cells (same items, counts and pools). Office loot runs on its own forks and is unaffected.

## How to …

- **Tune a room**: add an entry to the level's `rooms`, e.g. `rooms: {'office-server': {ratdog: {weight: 2}}}`. Run
  `validateSpawnProfile`. The reference shows it automatically (`entries`, the resolved room row, the knob list).
- **Add a level** (full checklist: `docs/level-enemy-contract.md`): add the `LevelId`, its `LEVELS` entry with an explicit `tier`,
  its `SPAWN_PROFILES` entry built with `familyPool(...)` (typecheck forces it) and its `ENEMY_LEVEL_ADAPTER` entry in
  `tools/pages/enemyReference.ts` (generator name, storeys and runs per context; typecheck forces it). A declared context no
  generator runs yet (0 runs) needs a `hook` note. The generator must read its profile through `spawnContext(profile, id)` — asking
  for an undeclared context throws — and tag its spawns' contexts.
- **Add a family**: add it to `EnemyFamilyId` / `ENEMY_FAMILY_IDS` (BEFORE `ratdog` keeps every rat/dog draw) and to
  `ENEMY_ARCHETYPES` in the same order, give it a `DEFAULT_FAMILY_SHARES` entry (0 = off by default; add it to `OPT_IN_FAMILIES`
  when a level must enable it deliberately) and an `ENEMY_FAMILY_ADAPTER` entry (its exported stats / rules) in
  `tools/pages/enemyReference.ts`. Validation fails for a pool that misses a family; the reference build fails when the families
  and the registry disagree.
- **Add a generation context**: add its id to `SpawnContextId` / `SPAWN_CONTEXT_IDS`, declare it in the profile and the adapter, and
  read it in the generator. `game/tests/enemy-spawn-tables.test.ts` checks that a generator asks for exactly its declared contexts.
  A same-world ZONE context that runs once per seeded zone (like `service`, once per annex) declares `zone: {runsPerLevel, note}` in
  its `ENEMY_LEVEL_ADAPTER` entry: the reference then shows it per zone and keeps it out of the whole-level total.

## How it reaches the website

```
SPAWN_PROFILES (game/src/ai/spawnTables.ts) ──> buildEnemyReference() ──> EnemyReference (JSON) ──> tools/pages/render/* ──> dist/pages/enemies/
                                                 tools/pages/enemyReference.ts   contract: tools/pages/enemyReferenceTypes.ts
```

`buildEnemyReference` reads only the profile API, the archetype registry, the registered levels (with their tiers, checked by
`validateLevelRegistry`) and each family's exported stats / rules (`ENEMY_FAMILY_ADAPTER`: `ZOMBIE_STATS`, `BLIGHTBELLY_STATS` /
`BLIGHTBELLY_BURST`, `SIREN_STATS` / `SIREN_WAKE` / `SIREN_CLAW`, `RATDOG_STATS` / `LUNGE`). Its small sampled census runs the
registered generators with a generation-time hook (`setSpawnCensusHook`; null by default, no runtime cost) that reports the candidate
cells each context accepted; a separate sampled ELIGIBILITY census (20 levels) shows a restricted family's draws vs placed per level
and why draws fell back. Static prose explains the rules; every number comes from the source. Pages: `enemies/index.html` (levels,
tiers), `enemies/<level>.html` (profile, eligibility), `enemies/families.html` (stats, wake rules, death burst),
`enemies/how-to-read.html`.

## Guards

- `game/tests/enemy-spawn-parity.test.ts` — golden hashes of the full seeded spawn specs (family, type, count, exact position / yaw,
  area, storey, order) and the downstream pickups for Subway and Office seeds (PIN HISTORY in the file; stage 3 = the new
  families), plus INVARIANT pins (family-masked spec hash + rat/dog indices) that a family-composition change must keep. Never
  re-pin to make a refactor pass; a deliberate tuning change explains what moved.
- `game/tests/enemy-spawn-contract.test.ts` — tiers + registry contract, `familyPool` defaults / opt-in, eligibility criteria,
  the untouched rat/dog band, the spawn census (zero Subway Sirens, ~2 Office Sirens / run, ~5 % Blightbelly), context tags,
  once-per-run dead indices.
- `game/tests/enemy-spawn-tables.test.ts` — coverage, neutral resolution, test-only 0 / 2 modifiers, validation, persistence.
- `game/tests/strainer.test.ts` (round 4) — the Strainer: registry order (appended last), service 0.08 / explicit 0 elsewhere, the
  context-lock validation, hordes, bit-identical core picks, the service-annex simulation, stats vs the zombie, the melee brain,
  the actor / head zone / fallback / ragdoll on a contract-shaped rig, save / load. `game/tests/strainer-asset.test.ts` — the real
  GLB against the asset contract (skipped until the file exists).
- `game/tests/enemy-spawn-reference.test.ts` — the reference: coverage, runtime agreement, census, maths, this page's names.
- `game/tests/annex-content.test.ts` (Track 2) — the `service` zone: declared per annex-bearing level, appended after every core spawn
  and tagged, annex areas only, within the per-annex budget / keep-off / spacing, the core's spawns and families unchanged, no
  Siren in an annex, kills remembered. Stage 5 of the parity pins: the live layouts of annex seeds (core views unchanged).
- Downstream: the Subway fingerprints (`game/tests/office-gen.test.ts`) and loot goldens (`game/tests/loot-golden.test.ts`).
- `game/tests/mall-profiles.test.ts` — the mall profile (rewritten for the compact mall): the Track1 pool, Siren rule (cap 4 since mall round 3), the shop-weighted retail placement,
  spacing, horde pool, route capacity / out-of-sight start and budgets and their validation, the generator asking for exactly `pit` +
  `ring` (+ the annex `service` zone), context tags (`pit` / `ring` / `horde` / `service`), ambient counts per storey within contexts and
  budgets, Sirens only in eligible retail-floor shops (≤ 4, ≥ 24 m apart), hordes of 5..20 ordinary zombies within budgets / route
  capacity, ≥ 45 walking m and ≥ 28 m straight from the start, the runtime registration check (every placed spawn on a real floor of
  its storey; station / annex loot present), `applyFamilySpacing` semantics, determinism, and the reference's mall sections (dynamic
  identity). `game/tests/mall-horde.test.ts` — the horde model on a synthetic ring mall + the generated mall (placement, 120 s roam).
  `game/tests/mall-sirens.test.ts` (mall round 3, R8) — the Siren runtime path on a real generated mall (lazy model key, release
  allowlist, spawn, dormant actor from the real GLB, veins) and a 12-mall Siren-count sample. `game/tests/mall-atrium-aggro.test.ts`
  (R2) — the open-atrium perception (ai/brain.ts `ATRIUM_PERCEPTION`: cross-storey notice / gunfire / horde-call rules) and a
  before / after start-of-level scenario on generated malls (`game/tests/helpers/aggroSim.ts`).

```sh
./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  game/tests/enemy-spawn-parity.test.ts game/tests/enemy-spawn-tables.test.ts game/tests/enemy-spawn-reference.test.ts \
  game/tests/enemy-spawn-contract.test.ts
npm run game:typecheck
```
