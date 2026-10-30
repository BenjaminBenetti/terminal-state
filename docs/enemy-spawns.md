# Enemy spawns — per-level profiles, room modifiers and the reference

<!-- Task enemy-spawn-tables-20261030 (lane SPAWN) -->

Every logical level has one **enemy spawn profile**. The real level generators read it; nothing else holds spawn numbers. The
public reference site's Enemy spawns section (`enemies/index.html` → `enemies/<level>.html`) is generated from the same profiles.
This page explains where the profiles live, what each control and modifier means, and how to extend them.

## Where the profiles live

`game/src/ai/spawnTables.ts` — pure data and pure resolution functions (no three.js):

| Export | What it is |
|---|---|
| `SPAWN_PROFILES` / `spawnProfile(level)` | One `SpawnProfile` per `LevelId` (`subway`, `office`). `Record<LevelId, …>`: a new level does not typecheck until it has one. |
| `ENEMY_FAMILY_IDS`, `ENEMY_POOL` | The enemy families (= the archetype registry `ENEMY_ARCHETYPES`, `game/src/ai/creatureArchetypes.ts`) and the shipped pool: zombie 0.95, ratdog 0.05. |
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
- `families` — the family pool `[family, weight]`. Every placed spawn draws its family independently with
  `enemyRoll(level seed, spawn index)` (`game/src/ai/creatureSpawn.ts` `assignEnemyArchetypes`): a rat/dog REPLACES a zombie.
- `zombieTypes` — the shambler / coated roll of every spawn (40 % coated, at least one of each). The wardrobe outfit is a zombie
  sub-distribution chosen at spawn time (`game/src/ai/wardrobe.ts` `pickZombieLook`), not a family.
- `rooms` — room modifiers (below). **Shipped: none** — every room resolves to exactly 1.

## Units: what the numbers are

- **Count range**: spawns one run of a context tries to place; E[count] = (lo + hi) / 2. There is no per-area spawn density at
  runtime.
- **Area weight**: a relative preference in the weighted area order (Efraimidis–Spirakis keys u^(1/w)). Never a chance or a count.
  Caps (1, 2, 3 per pass; platforms + 1; closets / closed exits / storefront units 1), spacing, tries and eligible cells decide how
  many spawns an area can take. A run can place fewer than its count when the eligible, spaced cells run out.
- **Family share**: weight / Σ weights — the conditional chance that one placed spawn is that family.
- **Sampled density** (reference only): placed spawns per 100 m² of eligible floor over a small labelled seed corpus. Eligible floor
  = the cells the generator's own candidate filter accepted, 0.25 m² each — never map bounding boxes. It is a census, not a rule.

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
- **Add a level**: add the `LevelId`, its `LEVELS` entry, its `SPAWN_PROFILES` entry (typecheck forces it) and its
  `ENEMY_LEVEL_ADAPTER` entry in `tools/pages/enemyReference.ts` (generator name, storeys and runs per context; typecheck forces it).
  The generator must read its profile through `spawnContext(profile, id)` — asking for an undeclared context throws.
- **Add a family**: add it to `EnemyFamilyId` / `ENEMY_FAMILY_IDS` and to `ENEMY_ARCHETYPES`, and list it in every pool (weight 0
  excludes it). Validation fails for a pool that misses a family; the reference build fails when the families and the registry
  disagree.
- **Add a generation context**: add its id to `SpawnContextId` / `SPAWN_CONTEXT_IDS`, declare it in the profile and the adapter, and
  read it in the generator. `game/tests/enemy-spawn-tables.test.ts` checks that a generator asks for exactly its declared contexts.

## How it reaches the website

```
SPAWN_PROFILES (game/src/ai/spawnTables.ts) ──> buildEnemyReference() ──> EnemyReference (JSON) ──> tools/pages/render/* ──> dist/pages/enemies/
                                                 tools/pages/enemyReference.ts   contract: tools/pages/enemyReferenceTypes.ts
```

`buildEnemyReference` reads only the profile API, the archetype registry and the registered levels. Its small sampled census runs
the registered generators with a generation-time hook (`setSpawnCensusHook`; null by default, no runtime cost) that reports the
candidate cells each context accepted. Static prose explains the rules; every number comes from the source. Pages: `enemies/index.html`
(levels), `enemies/<level>.html` (profile), `enemies/families.html`, `enemies/how-to-read.html`.

## Guards

- `game/tests/enemy-spawn-parity.test.ts` — golden hashes of the full seeded spawn specs (family, type, count, exact position / yaw,
  area, storey, order) and the downstream pickups for Subway and Office seeds, pinned at main 932624e before the refactor. Never
  re-pin to make a refactor pass; a deliberate tuning change explains what moved.
- `game/tests/enemy-spawn-tables.test.ts` — coverage, neutral resolution, test-only 0 / 2 modifiers, validation, persistence.
- `game/tests/enemy-spawn-reference.test.ts` — the reference: coverage, runtime agreement, census, maths, this page's names.
- Downstream: the Subway fingerprints (`game/tests/office-gen.test.ts`) and loot goldens (`game/tests/loot-golden.test.ts`).

```sh
./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  game/tests/enemy-spawn-parity.test.ts game/tests/enemy-spawn-tables.test.ts game/tests/enemy-spawn-reference.test.ts
npm run game:typecheck
```
