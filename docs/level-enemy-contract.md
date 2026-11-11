# Level / enemy registration contract — tiers, spawn profiles, families, annex zones

<!-- Task track1-siren-blightbelly-20261031 (lane SPAWN). Background on every spawn control: docs/enemy-spawns.md.
Task studio-screacher-production-20261110-221858-01: the Screacher (roster-only) and the seeded roster pass (§2d). -->

How a new logical level (e.g. the mall, `LevelId` `mall`) or a same-world annex zone (e.g. track-tunnel service annexes) declares its enemies.
Everything below is source-backed and validated: a missing tier, profile, family or context is a test / build **error**, never a
silent Subway or Office default. Nothing assumes there are only two levels.

## 1. Register the level (one change)

1. `LevelId` (`game/src/levels/types.ts`), `LEVEL_IDS` and `LEVELS[id]` (`game/src/levels/registry.ts`). `LevelDef.tier` is a
   required integer ≥ 0 — **Subway 0** (the starting level), **Office 1**. Choose it explicitly. The tier is metadata: nothing scales
   counts, health, damage or loot by it, and **no enemy family is enabled by tier**. `levelTier(id)` throws for an unregistered id.
2. `SPAWN_PROFILES[id]` (`game/src/ai/spawnTables.ts`, `Record<LevelId, SpawnProfile>` — typecheck forces it):

```ts
mall: {
  id: 'mall', label: 'Mall (seeded "<Name> Center")',   // (the display name is seeded per run: gen/mall/names.ts)
  families: familyPool({siren: MALL_SIREN_WEIGHT}),   // or familyPool() — Blightbelly 5 % on, Siren off, rat/dog 5 %
  zombieTypes: ZOMBIE_TYPES,
  contexts: {                                          // one entry per context the generator runs; counts are explicit
    concourse: {label: 'Mall concourse', count: [6, 9], placement: MALL_PLACEMENT, accept: {min: 'count', max: 'count'}},
    store:     {label: 'Store unit',     count: [1, 3], placement: MALL_PLACEMENT, accept: {min: null, max: 'count'}},
  },
  rooms: {},
  eligibility: {siren: MALL_SIREN_ELIGIBILITY},        // REQUIRED when the siren weight > 0
},
```

   - **Every family listed**: build the pool with `familyPool(shares)` — `DEFAULT_FAMILY_SHARES` gives **blightbelly 0.05 (default
     ON)**, **siren 0 (default OFF)**, ratdog 0.05, **strainer 0 (context-locked)**, **screacher 0 (roster-only)**, the zombie the
     remainder, in `ENEMY_FAMILY_IDS` roll order (six families: `zombie`, `blightbelly`, `siren`, `ratdog`, `strainer`, `screacher`).
     Turning Blightbelly off for a level is `familyPool({blightbelly: 0})` with a written reason.
   - **The Screacher is roster-only** (`ROSTER_ONLY_FAMILIES = ['screacher']`): its weight is 0 in EVERY level pool, context pool
     and horde pool (`validateSpawnProfile` rejects anything else; `HORDE_FORBIDDEN_FAMILIES` lists it). No per-spawn roll draws
     it. A level gets Screachers only from the seeded roster pass (§2d), so a profile never mentions it beyond that 0.
   - **The Strainer is context-locked** (`CONTEXT_LOCKED_FAMILIES`, `STRAINER_CONTEXTS = ['service', 'damp']`): a positive weight is valid
     ONLY in the own pool of a listed context (the service annexes' `SERVICE_FAMILY_POOL`, 0.08; the Bunker's damp sections'
     `BUNKER_DAMP_CONTEXT` pool, 0.3 of its one spawn per level — see §2c); a level pool, any other
     context's pool and every horde pool must say 0 (`validateSpawnProfile`). A new area enables it deliberately by adding its
     context to `STRAINER_CONTEXTS` and a weight to that context's pool.
   - **The Siren is opt-in, deliberately** (`OPT_IN_FAMILIES`): a siren weight > 0 is only valid with an explicit
     `eligibility.siren` rule naming the contexts (and room exclusions) where she may lie dormant. Model it on
     `OFFICE_SIREN_ELIGIBILITY` (indoor rooms only, room ≥ 4 × 4 m, clear floor patch, doorways ≥ 3 m, fair passage, ≤ 4 per level).
     Tune her DRAW weight by census to the level's target (the Office: ≈ 2 per complete run, draw weight 0.19 because only ~30 %
     of slots are eligible). It is a share of placed slots, never a guarantee and never per floor. The Subway stays at 0.
   - Eligibility semantics: a spawn whose roll lands on a family that is not eligible there becomes the rule's `fallback`
     (`'zombie'`). Nothing is renormalised: the rat/dog and Blightbelly keep exactly their shares.
   - New contexts go into `SpawnContextId` / `SPAWN_CONTEXT_IDS` first (`validateSpawnProfile` rejects unknown ones).
3. `ENEMY_LEVEL_ADAPTER[id]` in `tools/pages/enemyReference.ts` (generator name, storeys and runs per context) — typecheck forces
   it; the reference build checks it equals the profile's contexts.
4. The generator:
   - reads each context through `spawnContext(profile, contextId)` (an undeclared context throws);
   - after each placement run calls `markSpawnContext(layout, firstIndex, contextId)` (a profile with exactly ONE context needs no
     tag); an untagged spawn of a multi-context profile is never eligible for a context-restricted family and fails the coverage
     test and the reference build;
   - calls `assignEnemyArchetypes(layout, spawnProfile(id))` ONCE, after every context (annexes included) has placed.
   - does NOT call the seeded roster pass. The level registry wraps every `LEVELS[id].generate` and runs it on the finished layout
     (§2d): a new level gets it without any code of its own.
5. Enemy models are loaded per layout (`game/src/ai/enemyModels.ts`, lane BLIGHT): a level that never places a Siren never loads her.
   A family with several bodies (the Screacher's `variantModels`) loads exactly the variants its spawns carry (`ZombieSpawn.variant`).
6. Decide the level's place in the seeded roster (`game/src/ai/enemyRoster.ts`, §2d): a calm level with no enemies goes into
   `ZOMBIE_FREE_LEVELS`; a level that must always (or never) hold a family gets a `levelRates` entry on that family's rule, with a
   written reason. Without either, the family rules' default rates apply.

## 2. Same-world annex zones (Track 2 "service" annexes and similar)

An annex is part of its LOGICAL level — same `LevelId`, same tier, same ONE profile and family pool. It never gets its own
profile, family list, tier or guarantee.

- Declare the annex context's budget **explicitly in the level's profile**: add its id (e.g. `'service'`) to `SpawnContextId` /
  `SPAWN_CONTEXT_IDS`, then `contexts.service = {label, count: [lo, hi], placement, accept}` in every level that has annexes
  (`count: [0, 0]` or omit the context for a level without them). The count is ADDITIVE to the core contexts, drawn on the annex's
  own rng fork, and reported separately; core counts / positions / RNG are untouched.
- **Append** annex spawns after every core spawn (the family roll and the run memory key on the spawn index, so core indices and
  draws stay identical) and tag them `markSpawnContext(layout, first, 'service')`.
- Inheritance: zombie / Blightbelly / rat-dog shares apply automatically (the pool is profile-wide). **Sirens are NOT eligible in
  an annex context unless the level's `eligibility.siren.contexts` lists it deliberately**; if it does, retune that level's siren
  weight so the WHOLE level stays at its target — `maxPerLevel` already counts every context of the level. Never "2 per annex".
- **Implemented (Track 2, lane CONTENT):** `'service'` is in `SPAWN_CONTEXT_IDS`; `SERVICE_CONTEXT` (`game/src/ai/spawnTables.ts`: a
  per-annex budget U{3..5}, annex area weights / caps, 5 m spacing, 6 m off the annex door) is declared by the Subway and the Office;
  `game/src/gen/annexContent.ts` `placeServiceSpawns` appends one run per annex and tags it `markSpawnContext(layout, first,
  'service')` (the Subway's station spawns are tagged `'station'` explicitly — its profile has two contexts now); the generators call
  `assignEnemyArchetypes` once afterwards. `OFFICE_SIREN_ELIGIBILITY.contexts` stays `['floor']`. Details and census:
  `docs/enemy-spawns.md` "Service annexes".
- **A store-local zone** follows the same rules (task mall-lingerie-20261102-221554, lane CONTEXT): the mall's `'lingerie'` context
  (`LINGERIE_CONTEXT`, its own zombie-only pool) runs once per optional lingerie store, appended after the annex `service` spawns,
  tagged `markSpawnContext(…, 'lingerie')` and `ZombieSpawn.look = 'lingerie'` (re-tagged after `dropExtensions`, which removes the
  annex spawns before it); its `ENEMY_LEVEL_ADAPTER` entry is a zone (`runsPerLevel [0, LINGERIE_STORES_MAX]`) with its own
  eligibility / placement text. Details: `docs/enemy-spawns.md` "The mall".
- Persistence: killed enemies are the generic per-index run memory (`game/src/run/memory.ts` `enemiesToSpawn`), so annex enemies
  die once per run like any other; nothing respawns on re-entry. Rare rewards (the level's gear roll, the roof cache / find) are
  per logical level and are not repeated by annexes (loot tables own that).
- **The seeded roster in an annex (§2d).** An annex's Strainer comes from the per-spawn roll of its own pool (0.08) and is then
  fixed by the roster: a level whose roll includes the Strainer holds **exactly one**, in a `STRAINER_CONTEXTS` spawn; every other
  level holds none. The level's Blightbelly / rat-dog roll applies to annex spawns too (absent: they become ordinary zombies;
  present: annex zombie slots can be topped up from the annex pool's own shares). The Screacher's slot rule lists the core contexts
  only, so it does not take annex spawns.

## 2b. Separate pools and level-wide spacing (the mall, task track3-eaton-centre-20261031)

- **A separate horde pool** (`SpawnProfile.horde`, `HordeRules`): its members are placed AFTER `assignEnemyArchetypes` (appended last)
  with the pool's OWN explicit families, and tagged `HORDE_CONTEXT` (`'horde'`) by `placeHordes`. The tag is declared by declaring
  `horde` — it is never an ambient `contexts` entry and never an eligibility context (validation rejects both) — so no ambient family
  roll or rule (no Siren) reaches a horde member. `declaredSpawnContexts(profile)` = the ambient contexts + `'horde'` when the
  profile has hordes; the contract test checks every spawn against it.
- **Level-wide spacing of a restricted family** (`SpawnProfile.spacing`, `FamilySpacing {spacingM, why}`; requires the family's
  eligibility rule): Track1's `FamilyEligibility` has no spacing field, so the mall applies its 24 m Siren spacing (mall round 3; was 30 m) with the post-pass
  `applyFamilySpacing(layout, profile)` (`game/src/ai/familySpacing.ts`) right after `assignEnemyArchetypes` — cap and spacing jointly,
  in spawn-index order, RNG-free.
- The mall registers tier 2, `familyPool({siren: MALL_SIREN_WEIGHT})` (compact-mall census, task mall-playtest-revision-20261031:
  draw weight 0.8, cap 2, 30 m — mean 0.85 Sirens per run; mall round 3, R8: shop-weighted retail placement `MALL_RING_PLACEMENT`, the
  Office's cap 4, 24 m — mean 1.96 per mall, 8.3 % none, like the Office's 1.97; the six-ring tuning was 0.32 / cap 4),
  `MALL_SIREN_ELIGIBILITY` (retail-floor shops / stock rooms only), the horde pool's route capacity / out-of-sight start
  (`HordePlacementRules.routeMPerMember` / `startClearM`) and `ENEMY_LEVEL_ADAPTER.mall`; details and the census in
  `docs/enemy-spawns.md` "The mall".

## 2c. A level zone context: the Bunker's damp sections (task studio-bunker-level-20261109-072224-01)

The Bunker (`LevelId` `bunker`, tier 2, `BUNKER_SPAWN_PROFILE`) tags each storey run with its context — `'station'` (storey 0: the
platform, arrival hall, vault vestibule), `'floor'` (storeys 1-3), `'ring'` (storeys 4-5) — and adds ONE zone context:

- `'damp'` (`BUNKER_DAMP_CONTEXT`, in `SpawnContextId` / `SPAWN_CONTEXT_IDS` and `STRAINER_CONTEXTS`): one run per level over the
  layout's water-damaged areas only (`layout.bunker.damp`), count `[1, 1]`, appended after the storey runs and tagged
  `markSpawnContext(…, 'damp')`. Its OWN pool (`BUNKER_DAMP_SHARES`: rat/dog 0.1, Strainer 0.3, the zombie the remainder) is the only
  place outside the service annexes where THE STRAINER (unchanged) may have weight — at most one per level, never guaranteed.
- The Siren is opt-in with `BUNKER_SIREN_ELIGIBILITY`: contexts `'floor'` / `'ring'` (never the station storey), enclosed rooms only
  (never a stairwell, washroom, closet or corridor), the Office / Mall room gates, ≤ 3 per level, 24 m apart
  (`BUNKER_SIREN_SPACING`). Census: `docs/enemy-spawns.md` "The Bunker" / `docs/bunker.md`.
- `'service'` is declared (`SERVICE_CONTEXT`, the shared annex contract) but never runs: `LEVELS.bunker.trackExtensions` is `'none'`.

## 2d. The seeded roster pass (task studio-screacher-production-20261110-221858-01)

`applyEnemyRoster(layout, level, levelSeed, version)` (`game/src/ai/enemyRoster.ts`) decides which special families a generated
level holds **at all**, one independent roll per family per level map seed. Rates, placement policies and the maths:
`docs/enemy-spawns.md` "The seeded roster (Screacher)". The contract a level and a family rely on:

- **Where it runs.** In the level registry (`game/src/levels/registry.ts`): one wrapper over every `LEVELS[id].generate` calls it on
  the layout the generator returned. So it runs after every generation context, the one family roll (`assignEnemyArchetypes`), the
  eligibility rules, cap and spacing (`applyFamilySpacing`) and the hordes (`placeHordes`).
- **What it may change.** Only `archetype` (and `variant`) of **ordinary ambient zombie slots**, and of a rolled-absent family's
  spawns, which become ordinary zombies. It never adds, removes, moves or reorders a spawn: the count, the positions, the spawn
  indices (so the per-index kill memory), the context tags and the zombie types are the generator's.
- **What it never touches.** A roaming-horde member (`ZombieSpawn.horde`) and a store / convention outfit zombie
  (`ZombieSpawn.look`).
- **No RNG stream.** Every roster decision is `rosterRoll(levelSeed, key)`, a hash. The layout, the loot and every per-spawn family
  draw are bit-identical with or without the pass, and a seed always gives the same roster.
- **Every family decides.** `FAMILY_ROSTER` is a `Record<EnemyFamilyId, RosterRule>`: a new family does not typecheck until it has
  a rule — `baseline` (the ordinary zombie: never rolled) or `seeded` with a rate and one placement policy (`share-topup`,
  `eligible-min-one`, `context-one`, `count`).
- **Absent means none; present means at least one.** A level whose roll excludes a family holds none of it. A level whose roll
  includes it holds at least one, under every policy: a share top-up that left none converts one ordinary zombie slot whose pool
  gives the family weight. The only exception is a level with no slot at all where the family may stand; the report then says
  `noSlot` for it, never silently.
- **Order.** Present families are placed the most constrained first: `ROSTER_PLACE_PRIORITY` (`context-one`, `eligible-min-one`,
  `count`, `share-topup`; ties in `ENEMY_FAMILY_IDS` order). The reference reads that export.
- **Zombie-free levels.** `ZOMBIE_FREE_LEVELS` (`['market']`) never get any family: `rosterRate` is 0 there and the pass changes
  nothing.
- **Version.** `SectionGenContext.rosterVersion` (`game/src/levels/types.ts`): absent = 0 = no pass. The game always passes
  `rosterVersionFor(section memory)`: the version the station was first built with (lane `enemy.roster`), 0 for a station visited
  before the roster existed, else the current `ROSTER_VERSION` (1). A test or tool that calls `LEVELS[id].generate` without a
  roster version therefore sees the plain generator output — every pinned layout fingerprint and parity pin was taken that way and
  stays valid. A caller that wants what a player meets passes `rosterVersion: ROSTER_VERSION`.
- **The report.** `rosterOf(layout)` returns what the pass did per family (`eligible`, `present`, `before`, `after`, `removed`,
  `added`, `noSlot`; for a counted family also `wanted` and `relaxed`). It is `undefined` for a layout no pass ran on.

## 3. What validation catches

| Check | Where |
|---|---|
| Every `LEVEL_IDS` entry has a `LEVELS` entry with the same id and an integer tier ≥ 0; no stray `LEVELS` / profile entries | `validateLevelRegistry` (`game/src/levels/levelContract.ts`) |
| A profile with the same id, every family listed once, known contexts / room keys / kinds, finite values | `validateSpawnProfile` |
| Siren weight > 0 without an `eligibility.siren` rule; eligibility naming an undeclared context, an unknown room key, a fallback that is itself restricted | `validateSpawnProfile` |
| Strainer weight > 0 outside the own pool of a `STRAINER_CONTEXTS` context (level pool, other contexts, hordes) | `validateSpawnProfile`, `game/tests/strainer.test.ts` |
| A roster-only family (`ROSTER_ONLY_FAMILIES`: the Screacher) with weight > 0 in a level pool, a context's own pool or a horde pool | `validateSpawnProfile` |
| A family without a roster rule | typecheck (`FAMILY_ROSTER` is a `Record<EnemyFamilyId, …>`); the reference build (`tools/pages/render/enemies.ts` `makeEnemySite`) |
| The roster's own behaviour (rates, absent = none, the placement policies, the version pin, the Market) | `game/tests/enemy-roster.test.ts` |
| Every spawn of every registered level carries a context its profile declares | `game/tests/enemy-spawn-contract.test.ts` |
| Families = `ENEMY_ARCHETYPES` key order; `ENEMY_LEVEL_ADAPTER` / `ENEMY_FAMILY_ADAPTER` cover every level / family | `tools/pages/enemyReference.ts` (typecheck + build), `game/tests/enemy-spawn-reference.test.ts` |
| The reference shows the roster rule of every family, a roster row for every family on every level, and roster-ON sampled numbers that equal a fresh generation with `rosterVersion: ROSTER_VERSION` | `game/tests/enemy-spawn-reference.test.ts`, `game/tests/pages-output.test.ts`, `tools/pages/validate.ts` |
| Zero Sirens in the Subway, ≈ 2 per Office run, Blightbelly / rat-dog ≈ 5 % — the per-spawn roll alone (a direct generator call: no roster version, no pass) | `game/tests/enemy-spawn-contract.test.ts` |

## 4. Checklist

- [ ] `LevelId` + `LEVEL_IDS` + `LEVELS[id]` with an explicit `tier`.
- [ ] `SPAWN_PROFILES[id]` via `familyPool(...)`; Blightbelly on unless a written reason says otherwise.
- [ ] Siren: weight 0, or a deliberate draw weight + `eligibility.siren` (contexts, room exclusions, clearance, cap) + a census
      showing the level's target (report mean, share of runs with none, max).
- [ ] Strainer: 0 in the level pool (`familyPool` does it); it appears only through the own pool of a `STRAINER_CONTEXTS` context
      (an annex `service` run, the Bunker's `damp` zone).
- [ ] Screacher: 0 in every pool (`familyPool` does it). Nothing else to declare: the seeded roster places it.
- [ ] Seeded roster: nothing to call (the registry runs the pass). Decide only whether the level is zombie-free
      (`ZOMBIE_FREE_LEVELS`) or needs a `levelRates` override, and check its page's roster section in the reference.
- [ ] Every context the generator runs declared with an explicit `count`; annex contexts too, appended last and tagged.
- [ ] Every placement routine calls `markSpawnContext`; `assignEnemyArchetypes` once at the end. (The roster's counted family —
      the Screacher — and the Strainer read these context tags.)
- [ ] `ENEMY_LEVEL_ADAPTER[id]` in `tools/pages/enemyReference.ts`.
- [ ] Focused tests pass: `enemy-spawn-contract`, `enemy-spawn-tables`, `enemy-spawn-reference`, `enemy-spawn-parity` (pin only a
      new level's entries; never re-pin existing ones without a written cause), `pages-output`; `npm run pages:build && npm run
      pages:check`. The reference then lists the level, its tier, family shares, contexts and eligibility automatically.
- [ ] Travel UI helpers in `game/src/levels/registry.ts` (`otherLevel`, `travelTargets`, `sectionLabel`, `clearLabel`): generalised for
      three levels with the mall (task track3); a new level adds its labels there.

## 5. Enemy AI CPU: path searches (task studio-performance-recorder-20261103-043629-01, lane AI-CPU)

Measured on the Mall with the real enemies (Node: `game/tests/helpers/aiCpuSim.ts` runs `Game.updateZombies` with the real actors,
horde director, path service, chase share, vocal field and flashlight lure; `game/tests/ai-cpu-mall.test.ts`,
`LL_AICPU_OUT=/tmp/x.txt` prints the numbers): brains / sight, motor, the vocal field and animation are a steady 1–2 ms per frame
for ~45 enemies; the AI's spike frames are single **synchronous path searches** (20–35 ms, the worst 50–95 ms). Camera turning
only reaches the AI through the flashlight: its moving spot keeps investigating enemies re-planning (immediate searches).

The search (`gen/grid.ts` `PathFinder`, `gen/levels.ts` walk tests) returns exactly what it returned before — the same paths,
expansions and chunk yields, pinned against an executable copy of the old search (`game/tests/helpers/pathRef.ts`) on every
level — at roughly a third of the cost:
- A* runs in a plain method (`expand`), not inside the `search` generator (engines do not optimize a long generator loop in place).
- String pulling skips probes whose shared first sample (the anchor) is blocked, and runs its walks in a **walk batch**
  (`Levels.beginWalkBatch` / `endWalkBatch`): per-column band summaries and a cheapest-first order of the same conjunction.

Rules for changes here: a batch never spans a yield or a grid / volume change (runtime grid edits — the Reactor ending's doors,
the train-ride grids — happen outside path searches); keep `ai-cpu-mall.test.ts` (reference equality, batch = plain walks with a
volume, the real-actor sim's identical behaviour) green; never trade a search's result for speed.
