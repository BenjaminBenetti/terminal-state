# BB — a small crawling undead that pounces

<!-- Task studio-bb-production-20261112-234540-01. The approved design: a new enemy family `bb` — a small baby-like undead, four
looks (A Lullaby, B Binky, C Teddy, D Changeling) of ONE enemy type; fast stop-start crawling on floors, walls and ceilings; a
cackle tell; a wind-up, then a close-range pounce that hurts at most once per leap; a recovery and a cooldown. Non-graphic
presentation. A deterministic 40 % of combat level maps hold 1-3 of them; never the Survivor Market. -->

BB is the seventh registered enemy family (`ENEMY_ARCHETYPES.bb`, `game/src/ai/creatureArchetypes.ts`). It is a small, baby-like
undead that crawls: knee-high, quick, and able to move on floors, walls and ceilings. It moves in twitchy bursts with freezes
between, cackles when it notices the player, and attacks only by pouncing from close range. A pounce can hurt at most once.

Every number on this page names the constant it comes from. The constants in `game/src/ai/bb.ts` and
`game/src/ai/enemyRoster.ts` are the truth, and `game/tests/bb-roster.test.ts` fails when a value in one of this page's constant
tables no longer matches its constant. The generated reference site shows the same constants (`enemies/families.html`, section
BB).

## At a glance

| What | Value | Constant |
|---|---|---|
| Health | 55 hp | `BB_STATS.hp` |
| Damage of the one hit of a pounce | 9 hp raw (doubled like every enemy hit: 18 before armour) | `BB_STATS.attackDamage` |
| Standing attack range | 0 m (it never swings standing: its only attack is the pounce) | `BB_STATS.attackRange` |
| Sight range | 16 m | `BB_STATS.sightRange` |
| Burst pace, unaware / hunting | 1.5 m/s / 4.8 m/s | `BB_STATS.wanderSpeed`, `BB_STATS.chaseSpeed` |
| Collider radius on the floor | 0.22 m | `BB_STATS.radius`, `BB_BODY.radius` |
| Clear height it needs under a soffit | 0.6 m | `BB_STATS.height`, `BB_BODY.clearM` |
| Standing height, floor to the top of the head | 0.85 m | `BB_ASSET.heightM` |
| Head hit radius | 0.12 m | `BB_ASSET.headRadius` |
| Hit radii: torso / arm / leg | 0.11 m / 0.035 m / 0.045 m | `BB_ASSET.hitRadii.torso`, `BB_ASSET.hitRadii.arm`, `BB_ASSET.hitRadii.leg` |
| Runtime size jitter | 0.94 to 1.06 | `BB_SCALE.min`, `BB_SCALE.max` |
| Voice height above its support surface | 0.32 m | `BB_VOICE_Y` |

For comparison (`ZOMBIE_STATS.shambler`, `game/src/ai/brain.ts`): the ordinary zombie has 100 hp, hits for 10 and chases at
2.55 m/s. BB is small and quick, so it dies fast once it is hit. A head hit counts as on any enemy.

- **Not a scaled adult.** It is about 0.85 m tall standing and about 0.45 m on all fours, with its own body numbers (`BB_BODY`),
  hit volumes (`BB_ASSET`) and size jitter (`BB_SCALE`). It fits under desks the adults cannot.
- **Its paces are burst paces.** It moves in bursts with freezes between (`BB_CADENCE`), so its average pursuit pace is about
  3.3 m/s: just under the player's 3.4 m/s walk and well under the 5.8 m/s sprint.
- **No ladders.** It climbs the walls themselves. It drops into a track bed like every enemy.

## One enemy, four looks

There is one BB: one AI, one set of stats, one set of timings, one set of sounds. It has four approved looks (`BB_VARIANTS`). The
roster pass that places a BB gives its spawn a look (`ZombieSpawn.variant`), and the look only selects the model.

| Look | Variant | Name | Lazy model key | File |
|---|---|---|---|---|
| A | `lullaby` | Lullaby | `enemy_bb_lullaby` | `assets/models/enemy-bb-lullaby.glb` |
| B | `binky` | Binky | `enemy_bb_binky` | `assets/models/enemy-bb-binky.glb` |
| C | `teddy` | Teddy | `enemy_bb_teddy` | `assets/models/enemy-bb-teddy.glb` |
| D | `changeling` | Changeling | `enemy_bb_changeling` | `assets/models/enemy-bb-changeling.glb` |

- The models are loaded lazily, per layout: a level loads exactly the looks its BBs carry and a level without BBs loads none
  (`enemyModelKeysFor`, `game/src/ai/enemyModels.ts`).
- A spawn whose look failed to load becomes a counted zombie stand-in (`createEnemyActor`). It never becomes another look, a
  T-pose or a box.
- A missing or unknown variant is the first look (`bbVariantOf`).

## Behaviour and timings

> **Placeholder — the task lead completes this section.** The stop-start cadence (`BB_CADENCE`), what it notices (`BB_SENSE`)
> and the pounce (`BB_POUNCE`). Until then, see the constants and their comments in `game/src/ai/bb.ts`.

## Locomotion

> **Placeholder — the task lead completes this section.** Movement on floors, walls and ceilings (`game/src/ai/bbSurface.ts`),
> the climbing paces and limits (`BB_CLIMB`) and the body it moves with (`BB_BODY`).

## Where it appears: the seeded roster

No spawn table places a BB. Its weight is 0 in every level pool, context pool and horde pool (`ROSTER_ONLY_FAMILIES`,
`game/src/ai/spawnTables.ts`). It is placed only by the **seeded roster** (`FAMILY_ROSTER.bb`, `applyEnemyRoster`,
`game/src/ai/enemyRoster.ts`), once per generated level map, from that map's seed:

| Rule | Value | Constant |
|---|---|---|
| Chance that a combat level's roll includes BBs | 0.4 (40 % of level seeds) | `FAMILY_ROSTER.bb.rate` |
| Roster version the rule applies from | 3 | `FAMILY_ROSTER.bb.since` |
| Preferred distance between two BBs of a level | 9 m | `FAMILY_ROSTER.bb.spacingM` |
| Smallest shorter side of the area it may stand in | 5 cells (2.5 m) | `FAMILY_ROSTER.bb.slots.minSideCells` |
| Smallest area it may stand in | 60 cells (15 m²) | `FAMILY_ROSTER.bb.slots.minAreaCells` |

- **The roll.** One hash roll per level seed decides whether that level map holds BBs at all. It is deterministic: a level either
  has BBs on every visit, reload and Retry, or never has them. The roll is independent of every other family's, so about 16 % of
  combat levels hold both BBs and Screachers.
- **How many.** A level whose roll includes them holds 1, 2 or 3 (`FAMILY_ROSTER.bb.counts`: 35 %, 40 % and 25 % of those
  levels). Where the level cannot keep them 9 m apart it holds as many as fit, at least one.
- **The other 60 % of combat levels hold none.**
- **Which looks.** The first BB's look is picked by a hash roll of the level seed, and the next ones follow in turn (`lullaby`,
  `binky`, `teddy`, `changeling`). So the BBs of one level all look different, and every look is equally likely.
- **They replace ordinary zombies.** A BB takes the slot of an ordinary ambient zombie. The level's enemy count, every position
  and every spawn index are unchanged. It never takes a roaming-horde member, an outfit zombie or another special family's slot.
- **Where it stands.** In the level's enclosed core contexts (`FAMILY_ROSTER.bb.slots.contexts`: `station`, `street`, `floor`,
  `pit`, `ring`), in a room-sized or larger area. It needs walls and ceilings, so the open roof is not in the list, and neither are
  the service annexes or the Bunker's damp zone.
- **Where it does not stand.** Not in an area of kind `closet` (`FAMILY_ROSTER.bb.slots.excludeKinds`). Not in a room whose type
  or purpose is `exit-stair`, `washroom`, `office-stair`, `stair-core`, `office-elevator`, `supply-closet`, `janitor-closet` or
  `electrical-closet` (`FAMILY_ROSTER.bb.slots.excludeRooms`). Only a level with no such slot at all relaxes this, step by step
  (`docs/enemy-spawns.md`).
- **Never in the Survivor Market** (`ZOMBIE_FREE_LEVELS`).

### Placed last, from roster version 3

BB was added to the roster after the other families, so its rule is marked `last` and applies from roster version 3
(`ROSTER_VERSION` is the version new stations are built with).

- **Nothing else moved.** The pass places every earlier family first, exactly as roster version 2 did. BB then takes only
  ordinary zombie slots those families left. On a level seed whose roll has no BB, version 3 gives the same enemies as version 2.
  On a seed with BB, the only differences are the BB slots themselves.
- **Sprinters.** A BB slot that was a sprinting zombie at version 2 is a BB at version 3, not a sprinter. No other sprinter
  changes.
- **Old stations.** A station records the roster version it was first built with. One recorded at version 2 or lower regenerates
  with that version, so it never gains a BB and its enemies, kills and spawn indices stay exact. Stations entered for the first
  time get the current version.

The whole roster — every family's rate, the placement rules, the census and the save version — is in `docs/enemy-spawns.md`
"The seeded roster (Screacher)".

## How the registry classifies it

| What | Value | Constant |
|---|---|---|
| Melee knockback mass, relative to an ordinary zombie | 0.4 | `MELEE_MASS.bb` |
| Body mass | 9 kg | `CORPSE_TRAITS.bb.massKg` |

- **Roster-only.** `ROSTER_ONLY_FAMILIES` lists it. `validateSpawnProfile` rejects a profile that gives it weight in any pool, so
  no per-spawn roll ever draws one.
- **Never in a horde.** `HORDE_FORBIDDEN_FAMILIES` (`game/src/ai/hordeSpec.ts`) lists it, and the roster never converts a horde
  member.
- **Not a carried body, not chipper fuel.** `CORPSE_TRAITS.bb` (`game/src/ai/corpseTrait.ts`) records it as undead but not
  humanoid: a knee-high crawler is not the adult body plan the over-the-shoulder carry and the train's chipper feed are built
  for. So `corpseFeedable('bb')` is false: a dead BB cannot be picked up or fed to the chipper.
- **The lightest body in melee.** `MELEE_MASS.bb` (`game/src/combat/meleeImpact.ts`) is the smallest mass of any family, so a
  heavy swing pushes it furthest (up to the shared knockback cap).

## Non-graphic presentation

BB's presentation is non-graphic, alive and dead. This is a rule of the family, not a setting.

- Hits and kills on a BB show no wound decals, no blood, no flesh chunks and no dismemberment, and there is no skull-crack
  confirm (`EnemyActor.nonGraphic`, set by `game/src/ai/bbActor.ts`).
- Damage, hit parts and the ragdoll work as on every enemy. Only what is shown differs.

## Saves and rebuilds

A BB is saved exactly like every other enemy: only its **death** is remembered, per spawn index (`game/src/run/memory.ts`
`enemiesToSpawn`).

- When a level is rebuilt (a revisit, a reload, Continue, Retry), a living BB starts again at its spawn point, in the same look.
- Nothing else about it is saved: not its position, the surface it was on, or its timers.
- A killed BB stays dead for the run.
- A station first built at roster version 2 or lower never gains BBs (above).

## Models and audio

- **Models.** Four GLBs, one per look, on the shared 18-joint rig, with no baked clips: its poses are runtime clips
  (`game/src/ai/bbClips.ts`). They are rigged and skinned locally by `tools/asset-pipeline/enemy/build-bb.mjs`, and
  `game/tests/bb-asset.test.ts` checks them against the asset contract. Provenance and credits: see
  `game/public/assets/CREDITS.md`, section "The BB (enemy, four bodies)".
- **Audio.** One shared voice set for all four looks (`Sfx.bbVoice`, `game/src/audio/sfx.ts`): the cackle when it notices the
  player, a quiet giggle now and then while one is near, a squeal at the pounce, a yelp when hurt and a short death cry. A missing
  clip is silent, never a stand-in sound. The cues are audio only: nothing in them feeds the AI. Provenance, review status and
  licensing caveats: see `game/public/assets/audio/NOTICE.md` and `game/public/assets/CREDITS.md`.

## Files and tests

| File | What |
|---|---|
| `game/src/ai/bb.ts` | Stats, constants, the four looks, the pose contract, `BbBrain`, cues |
| `game/src/ai/bbSurface.ts` | The surface locomotion (floors, walls, ceilings) |
| `game/src/ai/bbActor.ts` | The rendered body: hit volumes, the non-graphic presentation |
| `game/src/ai/bbClips.ts` | The runtime clips on the shared rig |
| `game/src/ai/enemyRoster.ts` | The seeded roster that places it (`FAMILY_ROSTER.bb`) |
| `game/src/ai/enemyModels.ts` | The four lazy models |
| `tools/asset-pipeline/enemy/build-bb.mjs` | Builds the four runtime bodies |
| `game/tests/bb-asset.test.ts` | The GLBs against the asset contract |
| `game/tests/bb-roster.test.ts` | The roster rule: the rate, counts, looks, slots, the version pin; the registry classification; this page's tables |
| `game/tests/enemy-roster.test.ts` | The roster of every family |
| `game/tests/enemy-spawn-reference.test.ts` | The reference site shows BB's constants and roster rule |
