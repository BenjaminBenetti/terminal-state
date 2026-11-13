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
| Head hit radius of a body that carries no measured one | 0.12 m | `BB_ASSET.headRadius` |
| Hit radii of such a body: torso / arm / leg | 0.11 m / 0.035 m / 0.045 m | `BB_ASSET.hitRadii.torso`, `BB_ASSET.hitRadii.arm`, `BB_ASSET.hitRadii.leg` |
| Runtime size jitter | 0.94 to 1.06 | `BB_SCALE.min`, `BB_SCALE.max` |
| Voice height above its support surface | 0.32 m | `BB_VOICE_Y` |

For comparison (`ZOMBIE_STATS.shambler`, `game/src/ai/brain.ts`): the ordinary zombie has 100 hp, hits for 10 and chases at
2.55 m/s. BB is small and quick, so it dies fast once it is hit. A head hit counts as on any enemy.

- **Not a scaled adult.** It is about 0.85 m tall standing and about 0.45 m on all fours, with its own body numbers (`BB_BODY`),
  hit volumes and size jitter (`BB_SCALE`). It fits under desks the adults cannot.
- **What is seen is what is hit.** Each look's hit volumes are measured on its own body and stored in its model file: a skull
  sphere, a trunk capsule and two capsules per limb, on the bones. The four shipped bodies measure 0.083 to 0.098 m (head),
  0.088 to 0.135 m (torso), 0.018 to 0.045 m (arm) and 0.041 to 0.062 m (leg). The `BB_ASSET` values above are only the fallback
  for a body without measured ones. This is the one thing that differs between the looks besides the model.
- **Its paces are burst paces.** It moves in bursts with freezes between (`BB_CADENCE`), so its average pursuit pace is about
  3.3 m/s: just under the player's 3.4 m/s walk and well under the 5.8 m/s sprint.
- **No ladders.** It climbs the walls themselves (`ENEMY_ARCHETYPES.bb.climbsLadders` is false). It drops into a track bed like
  every enemy (`dropsIntoTrackBed`).

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

All four looks run one machine (`BbBrain`, `game/src/ai/bb.ts`). In order, the player meets this:

1. **It notices the player and cackles.** The cackle is the "it has seen you" tell.
2. **It stares** for a moment, then closes in.
3. **It closes in bursts**, with freezes between: on the floor, or up a wall and along the ceiling.
4. **Close enough, it stops and winds up**: it crouches and squeals. This is the tell of the pounce.
5. **It leaps.** The leap is aimed once, at the launch. It hurts only by touching the player, and at most once.
6. **It lies recovering** where it lands. It cannot attack, and a hit flinches it.
7. **It cools down.** Until the cooldown is over it keeps its distance or climbs out of reach, then it comes again.

It has no other attack. Standing next to the player it does nothing: touching a BB on the floor never hurts.

### What it notices

| What | Value | Constant |
|---|---|---|
| Sight range, from its eyes to the player's head or chest | 16 m | `BB_STATS.sightRange` |
| Unaware on the floor: field of view each side of its heading | 1.3 rad | `BB_SENSE.fovRad` |
| Unaware on the floor: nearer than this it notices all round | 5 m | `BB_SENSE.closeM` |
| Unaware on a wall or ceiling: it notices all round, but only this near | 10 m | `BB_SENSE.perchNoticeM` |
| Stare after noticing, before it moves | 0.4 s | `BB_SENSE.stareS` |
| Shortest time between two cackles of one BB | 7 s | `BB_SENSE.cackleGapS` |
| Time it keeps hunting the last place it saw or heard the player | 9 s | `BB_SENSE.loseS` |

- **Sight is three-dimensional.** The line runs from where its eyes really are (on a floor, a wall or a ceiling) to the player's
  head, or to the chest when the head is hidden. The same geometry that stops bullets stops its sight.
- **It knows only what it saw or heard.** It goes to the last place it saw the player, or where a noise or a hit came from. It
  does not track a player it cannot see: its wind-up, its aim and its retreat all use the last place it saw them. After 9 s
  without a new sighting it gives up and roams again.
- **Sneaking works on it** as on every enemy: the distances at which an unaware BB notices are scaled by the player's
  detectability (`detectFactor`, `game/src/ai/brain.ts`). An aware one keeps its full sight range.
- **Noise wakes it** like any enemy: a shot, an impact or another noise within the noise's radius.

### Stop-start movement

Its paces are burst paces. Each burst and each freeze is drawn from a range, on the BB's own random stream.

| What | Value | Constant |
|---|---|---|
| Hunting: a burst lasts | 0.35 to 0.75 s | `BB_CADENCE.burstS` |
| Hunting: a freeze lasts | 0.14 to 0.36 s | `BB_CADENCE.freezeS` |
| Further than this from its target it uses the long bursts | 9 m | `BB_CADENCE.farM` |
| Far: a burst lasts | 0.8 to 1.3 s | `BB_CADENCE.farBurstS` |
| Far: a freeze lasts | 0.1 to 0.22 s | `BB_CADENCE.farFreezeS` |
| Unaware: a burst lasts | 0.5 to 1.1 s | `BB_CADENCE.calmBurstS` |
| Unaware: a freeze lasts | 0.7 to 2.2 s | `BB_CADENCE.calmFreezeS` |
| How fast it turns | 11 rad/s | `BB_STATS.turnRate` |

With the hunting cadence its average pursuit pace on the floor is about 3.3 m/s (4.8 m/s for about two thirds of the time). Beyond
9 m it averages about 4.2 m/s, so it catches up with a walking player and loses a sprinting one.

### The pounce

| What | Value | Constant |
|---|---|---|
| Launch distance, body to the player's chest: each attempt picks one from | 2 m | `BB_POUNCE.leapFromM` |
| … to | 3.4 m | `BB_POUNCE.maxM` |
| Nearer than this it first scuttles back once | 0.9 m | `BB_POUNCE.minM` |
| From a wall or ceiling it also drops on a player this far away | 4.4 m | `BB_POUNCE.dropMaxM` |
| Wind-up (the tell) before the leap | 0.55 s | `BB_POUNCE.windupS` |
| Launch speed along the ground | 7.5 m/s | `BB_POUNCE.speed` |
| Gravity of the leap | 16 m/s² | `BB_POUNCE.gravity` |
| A leap can hurt only this long after the launch | 1.1 s | `BB_POUNCE.maxFlightS` |
| Share of the player's movement the aim leads by | 0.6 | `BB_POUNCE.lead` |
| Slack added to the body-to-body contact distance | 0.12 m | `BB_POUNCE.contactSlackM` |
| Damage of the one hit | 9 hp raw | `BB_STATS.attackDamage` |
| Recovery after landing from a leap or a knock-off | 0.75 s | `BB_POUNCE.landS` |
| Recovery after letting go of a perch on its own | 0.3 s | `BB_POUNCE.dropLandS` |
| Cooldown from the landing to the next wind-up | 3 s | `BB_POUNCE.cooldownS` |
| Cooling down, a player nearer than this makes it run | 3.2 m | `BB_POUNCE.retreatM` |
| Cooling down, between that and this it waits and watches | 5.5 m | `BB_POUNCE.holdM` |
| Running away on the floor, it stops this far from the player | 4.8 m | `BB_POUNCE.fleeToM` |
| Chance that it retreats up a nearby wall instead | 0.65 | `BB_POUNCE.retreatPerchChance` |

- **The tell comes first, every time.** It winds up only with the player in sight and a clear arc to them. If it loses sight of
  the player for more than a quarter of a second during the wind-up, it calls the leap off and waits at least 1 s.
- **The leap is a real arc**, aimed once at the launch at the player's chest. It does not steer in the air. A player who moves
  out of the way after the launch is missed.
- **One hit at most.** The hit lands only if its body touches the player's during the leap, with nothing solid between them. It
  then bounces off, away from the player. A leap that misses does no damage.
- **It always comes down on floor.** Before it winds up it checks where a missed leap would land. It does not leap where a miss
  would carry it into a pit, a shaft or over an open edge. It tries slower, higher leaps (down to 1.3 m/s along the ground)
  before it gives that line up.
- **With no safe leap from where it is, it looks for another line.** After a few failed aims it goes round the player at leap
  distance and tries from there. A BB whose approach has stalled leaps from a little further than usual (up to 3.9 m), or takes
  the wall. It does not stand beside the player doing nothing.
- **A hit during the wind-up** flinches it like any enemy and cancels the leap. A hit of 20 damage or more in the air takes most
  of its speed away, so it falls short.
- **No second chance from touch.** Between leaps it cannot hurt the player at all: not by standing against them, and not when
  the player walks into it.

Measured in the test simulation, on the six combat levels, 60 s each (`game/tests/bb-brain.test.ts` keeps the two ends):

| What the player does | Leaps that hit |
|---|---|
| Stands still | about 99 % |
| Walks backwards, or circles it at a walk | about 99 % |
| Strafes at a walk | about 85 % |
| Strafes at a sprint | about 45 % |
| Sidesteps at a sprint as it launches | about 14 % |

One attack cycle (wind-up, leap, recovery, cooldown, coming back) takes about 4.3 to 5.2 s. So one BB that hits every time does
about 18 hp per 5 s before armour, and a player who sidesteps each launch takes almost none.

## Locomotion

BB moves on the real collision geometry of the level: the same structure and prop shapes that stop the player and bullets
(`game/src/ai/bbSurface.ts`). Nothing is placed by hand: no climb markers, no per-level paths.

| What | Value | Constant |
|---|---|---|
| Burst pace on a wall or ceiling, hunting | 3.4 m/s | `BB_CLIMB.speed` |
| Burst pace on a wall or ceiling, unaware | 1.3 m/s | `BB_CLIMB.calmSpeed` |
| Highest it clings above the floor below it | 4.6 m | `BB_CLIMB.maxHeightM` |
| A wall it climbs must be within | 6 m | `BB_CLIMB.mountReachM` |
| A hit of at least this much damage knocks it off a wall or ceiling | 10 hp | `BB_CLIMB.knockOffDamage` |
| Unaware: time on the floor before it climbs to a perch | 8 to 20 s | `BB_CLIMB.floorS` |
| Unaware: time it stays on a perch | 20 to 45 s | `BB_CLIMB.perchS` |
| A wall perch is this high above the floor | 1.9 to 2.8 m | `BB_CLIMB.perchUpM` |
| A ceiling perch is this far out from the wall | 1 to 3.5 m | `BB_CLIMB.perchCeilingM` |
| Noticing the player from further than this, it may take the walls | 4.5 m | `BB_CLIMB.huntClimbM` |
| … and does so this often | 0.6 | `BB_CLIMB.huntClimbChance` |
| Body centre above the surface it is on | 0.2 m | `BB_BODY.centreUp` |
| Eyes above the surface, and ahead of the centre | 0.3 m, 0.1 m | `BB_BODY.eyeUp`, `BB_BODY.eyeFwd` |
| On the floor, the fastest another body pushes it out of itself | 6 m/s | `BB_BODY.shoveMps` |

- **Floors.** On the floor it is an ordinary enemy body: the shared path finder, the shared motor and collider, body separation,
  doors, stairs and ramps. It does not use ladders.
- **Eased out of other bodies.** It can come down right at the player's feet. The body separation every enemy shares then moves
  it out of the player at 6 m/s at most, and never more than half its radius in one frame, so it is never pushed through the
  wall beside them.
- **Walls and ceilings.** It walks to the foot of a wall, climbs it, and goes round the corner onto the ceiling or onto the next
  wall. It crosses inside corners and outside corners (a beam, a door lintel, the edge of a ledge). Its body stays on the surface
  and turns with it.
- **Where it cannot go.** It stops at an obstacle on the surface, at an edge with nothing to hold beyond it, and at 4.6 m above
  the floor. So a tall hall's ceiling and an atrium void are out of its reach: there it uses the walls up to that height.
- **No passing through anything.** Every step is checked against the geometry. It cannot cross a wall or a floor slab, on a
  surface or in the air, and it never teleports. In the air its body is kept its own radius off the walls it passes. If the
  surface it holds is no longer there, it lets go and falls.
- **Props are obstacles, not surfaces.** It crawls round them. When a leap or a fall ends on top of one (a desk, a crate, a
  counter) it rests there for a moment. From there it leaps at a player it sees, or hops off to the nearest floor it can stand
  on. It never drops through the thing.
- **Unaware, it perches.** It roams the floor for a while, climbs to a perch on a wall or ceiling, sits there, and comes down
  again. A player may first meet it overhead.
- **Hunting, it uses both ways.** It runs on the floor or takes the wall-and-ceiling way. It climbs toward a player it cannot
  walk to, and when the floor route is not getting it there.
- **From a perch it drops on the player**: the same wind-up tell and the same one-hit leap, from above.
- **Getting it down.** A hit of 10 damage or more knocks it off a wall or ceiling. It falls, and lies recovering like after a
  leap. A weaker hit hurts it but leaves it up there. A BB killed on a wall or ceiling falls to the floor.
- **While it is off the floor** it blocks nobody and nobody pushes it: it is not in the way of the player, other enemies, doors
  or the train's doors.

Limits of the first version:

- Railings, wire fences and other see-through barriers are not surfaces for it. It does not climb them, and its leap checks do
  not see them. That is why a leap is tested for where a miss would land.
- It reads the level's static geometry and its props. It does not ride moving things (elevator cars, train cars in motion), and
  moving door leaves, shutters and props that physics has knocked loose have not been tested as surfaces or obstacles for it.
- Levels with very tall rooms (the Mall's concourses, the Reactor's halls) have no ceiling within its reach. There it perches on
  walls only.
- Its neck has a limited range: on the floor it cannot raise its face to a standing player's, and under a ceiling it cannot
  look straight down.
- At an inside corner its skull can dip a few centimetres into the wall or slab for a few frames.

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
- Damage and hit parts work as on every enemy. Only what is shown differs: a hit shows a small dust puff.
- The dead body is a ragdoll like every enemy's, built for its own small body (`CORPSE_TRAITS.bb.massKg`). The killing shot
  throws it more gently than an adult: the whole body leaves at 6 m/s at most, never into the surface it was holding and never
  upward as a launch. A BB shot off a ceiling drops. Without this a shotgun put the light body's joints into walls and slabs.

| What | Value | Constant |
|---|---|---|
| Fastest the killing shot throws the body | 6 m/s | `BB_ACTOR.ragdollMaxShoveMps` |
| Furthest the body is lifted off its surface when the ragdoll starts | 0.09 m | `BB_ACTOR.ragdollLiftM` |

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
- **Audio.** One shared voice set for all four looks (`Sfx.bbVoice`, `game/src/audio/sfx.ts`), five cues: the cackle when it
  notices the player, a quiet giggle now and then while the player is near, a cue at the start of the pounce wind-up, a hurt
  sound and a death sound. A missing clip is silent, never a stand-in sound. The cues are audio only: nothing in them feeds the
  AI. Which cue plays when, levels, ranges and limits: `docs/bb-audio.md`. Provenance, review status and licensing caveats: see
  that page, `game/public/assets/audio/NOTICE.md` and `game/public/assets/CREDITS.md`.

## Files and tests

| File | What |
|---|---|
| `game/src/ai/bb.ts` | Stats, constants, the four looks, the pose contract, `BbBrain`, cues |
| `game/src/ai/bbSurface.ts` | The surface locomotion (floors, walls, ceilings) |
| `game/src/ai/bbActor.ts` | The rendered body: placed by the brain's pose, hit volumes, the ragdoll hand-over, the non-graphic presentation |
| `game/src/ai/bbClips.ts` | The runtime clips on the shared rig |
| `game/src/ai/enemyRoster.ts` | The seeded roster that places it (`FAMILY_ROSTER.bb`) |
| `game/src/ai/enemyModels.ts` | The four lazy models |
| `tools/asset-pipeline/enemy/build-bb.mjs` | Builds the four runtime bodies |
| `game/tests/bb-asset.test.ts` | The GLBs against the asset contract |
| `game/tests/bb-contract.test.ts` | The four bodies against the game's tables: sizes, looks, the AI's body, shots at and over it |
| `game/tests/bb-brain.test.ts`, `game/tests/bb-surface.test.ts` | The brain and the surface locomotion |
| `game/tests/bb-places.test.ts` | Places it must never end up in and stand-offs it must not fall into: the review's cases, and a sweep over seeds, player movement and frame times |
| `game/tests/bb-actor.test.ts`, `game/tests/bb-clips.test.ts` | The rendered body and its runtime clips, on the four real bodies |
| `game/tests/bb-ragdoll.test.ts`, `game/tests/bb-nongraphic.test.ts` | The ragdoll in the real physics world; no wounds, blood or pieces |
| `game/tests/bb-audio.test.ts` | The voice set (`docs/bb-audio.md`) |
| `game/tests/bb-roster.test.ts` | The roster rule: the rate, counts, looks, slots, the version pin; the registry classification; this page's tables |
| `game/tests/enemy-roster.test.ts` | The roster of every family |
| `game/tests/enemy-spawn-reference.test.ts` | The reference site shows BB's constants and roster rule |
