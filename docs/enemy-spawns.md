# Enemy spawns — per-level profiles, room modifiers and the reference

<!-- Task enemy-spawn-tables-20261030 (lane SPAWN); task track1-siren-blightbelly-20261031 (lane SPAWN): families Blightbelly and
Siren, family eligibility, level tiers. Registering a NEW level or annex zone: docs/level-enemy-contract.md. -->

Every logical level has one **enemy spawn profile**. The real level generators read it; nothing else holds spawn numbers. The
public reference site's Enemy spawns section (`enemies/index.html` → `enemies/<level>.html`) is generated from the same profiles.
This page explains where the profiles live, what each control and modifier means, and how to extend them.

## Where the profiles live

`game/src/ai/spawnTables.ts` — pure data and pure resolution functions (no three.js):

| Export | What it is |
|---|---|
| `SPAWN_PROFILES` / `spawnProfile(level)` | One `SpawnProfile` per `LevelId` (`subway`, `office`). `Record<LevelId, …>`: a new level does not typecheck until it has one. |
| `ENEMY_FAMILY_IDS` | The enemy families in registry and roll order: `zombie`, `blightbelly`, `siren`, `ratdog` (= the archetype registry `ENEMY_ARCHETYPES`, `game/src/ai/creatureArchetypes.ts`, same key order). |
| `familyPool(shares)`, `DEFAULT_FAMILY_SHARES`, `ENEMY_POOL` | A level's pool: blightbelly 0.05 (default ON), siren 0 (default OFF, `OPT_IN_FAMILIES`), ratdog 0.05, zombie the remainder. `ENEMY_POOL` = `familyPool()` = the Subway's. |
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
back-of-house of plant rooms, stores, closets and 1.5–2 m corridors (`game/src/gen/trackExt/` generates it; 0–2 per level, each
~25 % of the Subway's walkable exploration area). It is part of its LOGICAL level (docs/level-enemy-contract.md §2): same profile,
same family pool and zombie types, same tier.

| Control | Value (`SERVICE_CONTEXT`, `game/src/ai/spawnTables.ts`) |
|---|---|
| Declared in | `SPAWN_PROFILES.subway.contexts.service`, `SPAWN_PROFILES.office.contexts.service` |
| Count | `SERVICE_ZONE_BUDGET` = U{3..5} **per annex** (one draw per annex run), additive to the core contexts |
| Area weights | `SERVICE_AREA_WEIGHTS`: annex rooms 1.4, corridors 1.0, closets 0.6 |
| Caps | `SERVICE_CAPS`: passes 1 / 2; closets 1 |
| Spacing / tries | 5 m (wider than the station's 4 m: dark and cramped) / 12 |
| Keep-away | ≥ 36 walking cells from the start, 3 × 3 clear, ≥ 6 m from the annex's entry door (`landingKeepM`: its keep point) |
| Accept | `{min: null, max: 'count'}` — never regenerates a level (extensions never decide a retry) |

- **Why 3–5.** An annex is ~25 % of the Subway's walkable-exploration baseline (~1840 m² of 7371 m²); the station's 22–32 spawns
  over that baseline would put ~6.8 into an annex at the same density. The annex is cramped and much darker, so it gets ~60 % of
  that density (E 4 per annex) — fair, never a corridor ambush at the door.
- **Placement.** One run per annex on its own fork (`track-ext-content` → `service:<annex>`), in that annex's areas only, AFTER
  every core spawn (the core's indices, rolls, run-memory keys and parity pins are unchanged) and tagged
  `markSpawnContext(layout, first, 'service')`; `assignEnemyArchetypes(layout, profile)` then runs ONCE over every context.
- **Families.** The level's own pool: zombie / Blightbelly / rat-dog shares apply automatically. No Siren in an annex: the Subway
  has none, and the Office's `OFFICE_SIREN_ELIGIBILITY.contexts` is `['floor']` (it does not list `service`), so a Siren draw there
  falls back to a zombie; her whole-level rarity and `maxPerLevel` stay level-wide.
- **Counted separately.** The core contexts' validation counts (Subway `station` ≥ 8; Office `street` / `floor`) and the census /
  parity counts exclude annex spawns (`tests/helpers/enemySpawnParity.ts` `contextCounts` prints them as `+ service N`); the
  reference shows `service` as a zone context, never inside the whole-level total.
- **Persistence.** Killed annex enemies stay dead for the run (the per-index memory, `game/src/run/memory.ts`); nothing respawns
  on entry; Retry / revisits regenerate the identical annex spawns from the seed.
- **Census** (lane CONTENT, shipped code incl. GEN-2's incidence): Subway 24 seeds (`(i × 2654435761 + 12345) >>> 0`, i < 24) —
  1.12 annexes per level (3 with none, 15 with one, 6 with two; 6 of the 27 entered by a service hatch), 3.85 placed per annex,
  4.3 service spawns per level (max 10) on top of the station's ~27; Office 10 seeds (3, 7922, 15841, 23760, 31679, 39598, 11, 222,
  3333, 4242) — 1.5 annexes per level, 3.7 placed per annex, 5.6 per level (max 9). No annex run placed fewer than its count.

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
  `tools/pages/enemyReference.ts` (generator name, storeys and runs per context; typecheck forces it). The generator must read its
  profile through `spawnContext(profile, id)` — asking for an undeclared context throws — and tag its spawns' contexts.
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
- `game/tests/enemy-spawn-reference.test.ts` — the reference: coverage, runtime agreement, census, maths, this page's names.
- `game/tests/annex-content.test.ts` (Track 2) — the `service` zone: declared per annex-bearing level, appended after every core spawn
  and tagged, annex areas only, within the per-annex budget / keep-off / spacing, the core's spawns and families unchanged, no
  Siren in an annex, kills remembered. Stage 5 of the parity pins: the live layouts of annex seeds (core views unchanged).
- Downstream: the Subway fingerprints (`game/tests/office-gen.test.ts`) and loot goldens (`game/tests/loot-golden.test.ts`).

```sh
./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  game/tests/enemy-spawn-parity.test.ts game/tests/enemy-spawn-tables.test.ts game/tests/enemy-spawn-reference.test.ts \
  game/tests/enemy-spawn-contract.test.ts
npm run game:typecheck
```
