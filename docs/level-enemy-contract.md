# Level / enemy registration contract — tiers, spawn profiles, families, annex zones

<!-- Task track1-siren-blightbelly-20261031 (lane SPAWN). Background on every spawn control: docs/enemy-spawns.md. -->

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
     ON)**, **siren 0 (default OFF)**, ratdog 0.05, the zombie the remainder, in `ENEMY_FAMILY_IDS` roll order. Turning Blightbelly
     off for a level is `familyPool({blightbelly: 0})` with a written reason.
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
5. Enemy models are loaded per layout (`game/src/ai/enemyModels.ts`, lane BLIGHT): a level that never places a Siren never loads her.

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
- Persistence: killed enemies are the generic per-index run memory (`game/src/run/memory.ts` `enemiesToSpawn`), so annex enemies
  die once per run like any other; nothing respawns on re-entry. Rare rewards (the level's gear roll, the roof cache / find) are
  per logical level and are not repeated by annexes (loot tables own that).

## 2b. Separate pools and level-wide spacing (the mall, task track3-eaton-centre-20261031)

- **A separate horde pool** (`SpawnProfile.horde`, `HordeRules`): its members are placed AFTER `assignEnemyArchetypes` (appended last)
  with the pool's OWN explicit families, and tagged `HORDE_CONTEXT` (`'horde'`) by `placeHordes`. The tag is declared by declaring
  `horde` — it is never an ambient `contexts` entry and never an eligibility context (validation rejects both) — so no ambient family
  roll or rule (no Siren) reaches a horde member. `declaredSpawnContexts(profile)` = the ambient contexts + `'horde'` when the
  profile has hordes; the contract test checks every spawn against it.
- **Level-wide spacing of a restricted family** (`SpawnProfile.spacing`, `FamilySpacing {spacingM, why}`; requires the family's
  eligibility rule): Track1's `FamilyEligibility` has no spacing field, so the mall applies its 30 m Siren spacing with the post-pass
  `applyFamilySpacing(layout, profile)` (`game/src/ai/familySpacing.ts`) right after `assignEnemyArchetypes` — cap and spacing jointly,
  in spawn-index order, RNG-free.
- The mall registers tier 2, `familyPool({siren: MALL_SIREN_WEIGHT})` (compact-mall census, task mall-playtest-revision-20261031:
  draw weight 0.8 (saturated), cap 2, 30 m — mean 0.85 Sirens per run, 4.5 % of the placed ambient enemies; the six-ring tuning was 0.32 / cap 4),
  `MALL_SIREN_ELIGIBILITY` (retail-floor shops / stock rooms only), the horde pool's route capacity / out-of-sight start
  (`HordePlacementRules.routeMPerMember` / `startClearM`) and `ENEMY_LEVEL_ADAPTER.mall`; details and the census in
  `docs/enemy-spawns.md` "The mall".

## 3. What validation catches

| Check | Where |
|---|---|
| Every `LEVEL_IDS` entry has a `LEVELS` entry with the same id and an integer tier ≥ 0; no stray `LEVELS` / profile entries | `validateLevelRegistry` (`game/src/levels/levelContract.ts`) |
| A profile with the same id, every family listed once, known contexts / room keys / kinds, finite values | `validateSpawnProfile` |
| Siren weight > 0 without an `eligibility.siren` rule; eligibility naming an undeclared context, an unknown room key, a fallback that is itself restricted | `validateSpawnProfile` |
| Every spawn of every registered level carries a context its profile declares | `game/tests/enemy-spawn-contract.test.ts` |
| Families = `ENEMY_ARCHETYPES` key order; `ENEMY_LEVEL_ADAPTER` / `ENEMY_FAMILY_ADAPTER` cover every level / family | `tools/pages/enemyReference.ts` (typecheck + build), `game/tests/enemy-spawn-reference.test.ts` |
| Zero Sirens in the Subway, ≈ 2 per Office run, Blightbelly / rat-dog ≈ 5 % | `game/tests/enemy-spawn-contract.test.ts` |

## 4. Checklist

- [ ] `LevelId` + `LEVEL_IDS` + `LEVELS[id]` with an explicit `tier`.
- [ ] `SPAWN_PROFILES[id]` via `familyPool(...)`; Blightbelly on unless a written reason says otherwise.
- [ ] Siren: weight 0, or a deliberate draw weight + `eligibility.siren` (contexts, room exclusions, clearance, cap) + a census
      showing the level's target (report mean, share of runs with none, max).
- [ ] Every context the generator runs declared with an explicit `count`; annex contexts too, appended last and tagged.
- [ ] Every placement routine calls `markSpawnContext`; `assignEnemyArchetypes` once at the end.
- [ ] `ENEMY_LEVEL_ADAPTER[id]` in `tools/pages/enemyReference.ts`.
- [ ] Focused tests pass: `enemy-spawn-contract`, `enemy-spawn-tables`, `enemy-spawn-reference`, `enemy-spawn-parity` (pin only a
      new level's entries; never re-pin existing ones without a written cause), `pages-output`; `npm run pages:build && npm run
      pages:check`. The reference then lists the level, its tier, family shares, contexts and eligibility automatically.
- [ ] Travel UI helpers in `game/src/levels/registry.ts` (`otherLevel`, `travelTargets`, `sectionLabel`, `clearLabel`): generalised for
      three levels with the mall (task track3); a new level adds its labels there.
