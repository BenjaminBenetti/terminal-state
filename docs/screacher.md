# The Screacher — a headless, blind infected that hunts by sound

<!-- Task studio-screacher-production-20261110-221858-01. User: a new enemy named exactly "Screacher" — "basically a zombie with no
head", a bit taller, with lanky arms and legs; it "cannot see, only reacts to sound (player bumping things, firing gun, running)",
moves toward the last sound, "multiple quick sounds -> quite fast / aggressive", the "player can sneak by or fight head on"; it
"screams about once [per] 60 seconds for echolocation"; "per level ... 40% chance based on the seed of them spawning AT ALL ...
sometimes NONE ... deterministic"; "Survivor Markets remain zombie free". -->

The Screacher is the sixth registered enemy family (`ENEMY_ARCHETYPES.screacher`, `game/src/ai/creatureArchetypes.ts`). It has no
head and no eyes. It knows where to go only from **sound**, from **touch**, and from an **echolocation scream** about once a
minute. A careful player can walk past it; a noisy one makes it fast.

This page is the behaviour reference. Every number below names the constant it comes from: the constants in
`game/src/ai/screacher.ts` and `game/src/ai/enemyRoster.ts` are the truth, and `game/tests/enemy-spawn-reference.test.ts` fails when
a value in one of this page's constant tables no longer matches its constant. The generated reference site shows the same
constants (`enemies/families.html`, section Screacher).

## At a glance

| What | Value | Constant |
|---|---|---|
| Health | 600 hp | `SCREACHER_STATS.hp` |
| Claw damage per hit | 16 hp | `SCREACHER_STATS.attackDamage` |
| Attack range (centre to centre) | 1.55 m | `SCREACHER_STATS.attackRange` |
| The swing connects within | 1.95 m | `SCREACHER_STATS.hitRange` |
| Swing length / the hand lands at / recovery | 1 s / 0.42 s / 0.6 s | `SCREACHER_STATS.attackDuration`, `SCREACHER_STATS.attackImpact`, `SCREACHER_STATS.attackCooldown` |
| Sight range | 0 m (blind) | `SCREACHER_STATS.sightRange` |
| Collider radius | 0.34 m | `SCREACHER_STATS.radius` |
| Idle wander pace | 0.5 m/s | `SCREACHER_STATS.wanderSpeed` |
| Height, feet to the top of the neck stump | 2 m | `SCREACHER_ASSET.heightM` |
| Runtime size jitter | 0.97 to 1.03 | `SCREACHER_SCALE.min`, `SCREACHER_SCALE.max` |

For comparison (`ZOMBIE_STATS.shambler`, `game/src/ai/brain.ts`): the ordinary zombie has 100 hp, hits for 10 and chases at
2.55 m/s. The Screacher has six times that health because it has no weak spot: every hit is a body hit. All four bodies share the
one stats object, so every variant has the same 600 hp (a user retune on 2026-11-11: four times its first 150 hp; nothing else
changed).

- **No head.** It has no head hit volume, alive or as a corpse (`game/src/ai/screacherActor.ts`): a torso capsule from the hips up
  the spine whose round cap ends at the top of the stump, and arm and leg capsules. A shot through the air above the stump hits
  nothing. No hit on it is ever a head hit, so no head multiplier applies.
- **No ladders.** Its path requests ignore ladder links. It drops into a track bed like every enemy.
- **Ordinary melee only.** One long-arm rake per attack. No ranged attack, no summon, no stun. Its hit on the player is a standing
  humanoid melee hit (attacker `screacher`).
- **Melee knockback mass** 0.9 of a zombie's (`MELEE_MASS.screacher`, `game/src/combat/meleeImpact.ts`).

## One enemy, four bodies

There is one Screacher: one AI, one set of stats, one set of sounds. It has four approved bodies (`SCREACHER_VARIANTS`). The
roster pass that places a Screacher gives its spawn a variant (`ZombieSpawn.variant`), and the variant only selects the model.

| Variant | Name | Lazy model key | File |
|---|---|---|---|
| `sc01` | Hollow Commuter | `enemy_screacher_sc01` | `assets/models/enemy-screacher-sc01.glb` |
| `sc02` | Track Ganger | `enemy_screacher_sc02` | `assets/models/enemy-screacher-sc02.glb` |
| `sc03` | Lopsided Sleeper | `enemy_screacher_sc03` | `assets/models/enemy-screacher-sc03.glb` |
| `sc04` | Long-Stride Runner | `enemy_screacher_sc04` | `assets/models/enemy-screacher-sc04.glb` |

- The models are loaded lazily, per layout: a level loads exactly the variants its Screachers carry and a level without
  Screachers loads none (`enemyModelKeysFor`, `game/src/ai/enemyModels.ts`).
- A spawn whose variant model failed to load becomes a counted zombie stand-in (`createEnemyActor`). It never becomes another
  variant.
- All four share the 18-joint humanoid skeleton and one clip contract: Idle, Walk, Run, Attack, Hit, Death, Scream.

**Asset numbers come from the files.** Each GLB carries its measured values in its `enemyScreacher` extras; the builder is
`tools/asset-pipeline/enemy/build-screacher.mjs`. `SCREACHER_ASSET` is the gameplay's copy of that contract, and
`game/tests/screacher-contract.test.ts` checks that every GLB agrees with it. File sizes are in `ENEMY_MODEL_FILES`. This page does
not repeat per-file measurements. The models keep the texture maps Meshy generated for them.

## How it knows where you are

The Screacher runs the ordinary zombie state machine (`ZombieBrain`), but aimed at a **belief**: the last point it has a reason to
think its prey is at. It never reads the live player position, except in three places that are physical facts
(`ScreacherBrain.update`):

1. **Touch.** The player's body is within contact distance of it, on the same floor.
2. **The swing.** At the moment its hand lands, the hit counts only if the player is really inside its reach.
3. **The echo.** Once per scream, the world answers whether the player is in range with nothing solid between.

Everything else reaches it as a sound **event at the place the sound happened**. A can kicked across the room, or a chair knocked
over somewhere else, sends it there.

It has no sight cone, no eye ray and no light lure. Standing in front of it, shining the flashlight on it or throwing a flare does
nothing by itself. The lure grenade's scent makes no sound, so it never draws a Screacher either.

| Sense | Value | Constant |
|---|---|---|
| It feels the player's body within (centre to centre, same floor) | 0.94 m | `SCREACHER_SENSE.touchM` |
| A melee hit from within this distance tells it where the attacker stands | 3.2 m | `SCREACHER_SENSE.painTouchM` |
| A belief with no newer sound is forgotten after | 25 s | `SCREACHER_SENSE.beliefTtlS` |
| A chase that makes no progress gives the belief up after | 2.5 s | `SCREACHER_SENSE.stallS` |
| A quieter kind of sound does not move the belief while a louder one is younger than | 1.2 s | `SCREACHER_SENSE.holdS` |

- **Sound classes** for that last rule: touch and echo (it knows) rank above gunshot-class sounds, which rank above everything
  else. So a shot's ricochets and falling debris do not pull it off the shot.
- **Being shot.** A hit from farther than the touch distance adds heat but tells it nothing about where the shooter is. The
  gunshot's own sound does, when the shot is in earshot.

## What it hears

| Sound | Loudness (radius round the source) | Constant |
|---|---|---|
| One sprinting footstep | 11 m | `SCREACHER_NOISE.run` |
| A landing: counts from a landing speed of | 2.5 m/s | `SCREACHER_NOISE.landMinSpeed` |
| A landing: base radius | 4 m | `SCREACHER_NOISE.landBase` |
| A landing: added per m/s of landing speed | 1.2 m | `SCREACHER_NOISE.landPerMs` |
| A landing: at most | 10 m | `SCREACHER_NOISE.landMax` |
| A prop or item impact: counts from an impact speed of | 1 m/s | `SCREACHER_NOISE.impactMinSpeed` |
| An impact: base radius | 3 m | `SCREACHER_NOISE.impactBase` |
| An impact: added per m/s of impact speed | 2.2 m | `SCREACHER_NOISE.impactPerMs` |
| An impact: at most | 14 m | `SCREACHER_NOISE.impactMax` |
| A pushed box scraping the floor | 4 m | `SCREACHER_NOISE.drag` |

- **Gunfire, melee contact, explosions and running machines** reach it through the game's existing noise path (the one every enemy
  hears gunfire through), with each weapon's own noise radius (`WeaponDef.noise`, `game/src/weapons/weapons.ts`).
- **Impacts** are physics contacts of loose objects: a prop the player walked into, a kicked can, shelf stock falling, a thrown
  flare landing (`game/src/ai/screacherNoise.ts`). The radius is scaled by what struck (`IMPACT_FAMILY_LOUDNESS`): soft and light
  things and cardboard carry less, glass and sheet metal a little more. Debris, flesh chunks and brass casings never count.
- **Distance and walls** (`deliverNoise`; `hearingMuffle`, `game/src/ai/brain.ts`): a sound reaches a Screacher within its radius,
  measured in 3D. With no clear line between the sound and the Screacher the radius is scaled down:

| Between the sound and the Screacher | Factor on the radius | Constant |
|---|---|---|
| No clear line, same storey | 0.6 | `HEARING.wall` |
| Each storey floor between them (instead of the wall factor) | 0.35 | `HEARING.slab` |

**What it does not hear:** walking, crouch-walking, standing still, the flashlight, its own scream and any other enemy's voice.
The Screacher's sounds are audio only; none of them is a noise event.

Only Screachers listen to footsteps, landings, impacts and drags. Every other enemy's hearing is unchanged.

## Aggression: quick sounds make it fast

Every distinct sound adds to its **heat**. Heat sets one of three paces. Quiet cools it down again.

| Rule | Value | Constant |
|---|---|---|
| Heat added by a gunshot-class sound | 1.25 | `SCREACHER_AGGRO.weight.gunshot` |
| Heat added by one sprinting footstep | 0.75 | `SCREACHER_AGGRO.weight.run` |
| Heat added by a landing | 1 | `SCREACHER_AGGRO.weight.land` |
| Heat added by a prop or item impact | 1 | `SCREACHER_AGGRO.weight.impact` |
| Heat added by a scraping box | 0.5 | `SCREACHER_AGGRO.weight.drag` |
| Heat added by a touch, an echo that found the player, or a hit | 1 | `SCREACHER_AGGRO.weight.touch` |
| Sounds closer together than this count as one | 0.22 s | `SCREACHER_AGGRO.mergeS` |
| Heat cap | 4.5 | `SCREACHER_AGGRO.heatMax` |
| It hunts from heat | 1.5 | `SCREACHER_AGGRO.huntAt` |
| It is frenzied from heat | 3 | `SCREACHER_AGGRO.frenzyAt` |
| Silence before heat starts to fall | 2 s | `SCREACHER_AGGRO.quietHoldS` |
| Heat lost per second after that | 0.5 | `SCREACHER_AGGRO.decayPerS` |

| Tier | Pace | Constant |
|---|---|---|
| Investigate (a stalking walk to the sound) | 1.25 m/s | `SCREACHER_SPEED.investigate` |
| Hunt | 2.4 m/s | `SCREACHER_SPEED.hunt` |
| Frenzy (a run) | 3.9 m/s | `SCREACHER_SPEED.frenzy` |

What those numbers mean in play (derived from the tables above):

- One shot: it walks to where the shot was fired.
- Two quick shots, or two sprinting steps: it hunts.
- Three shots, or about a second of sprinting: frenzy.
- A shotgun blast is one sound, not nine: contacts in the same instant merge.
- From the heat cap, 8 s of silence bring it back to the walking tier and 11 s to no heat at all.

The player walks at 3.4 m/s, crouch-walks at half that and sprints at 5.8 m/s (`WALK_SPEED`, `CROUCH_SPEED_MULT`, `SPRINT_SPEED`,
`game/src/player/player.ts`). A frenzied Screacher outruns a walking player but not a sprinting one — and it hears every sprinting
step.

When it reaches the spot it believes in, it swings at it. If nothing is there, the belief is dropped and it searches around the
spot.

## The echolocation scream

About once a minute a Screacher stops, screams and scans **once**.

| Rule | Value | Constant |
|---|---|---|
| Time between screams | 60 s | `SCREACHER_ECHO.periodS` |
| Each period varies by up to | 6 s | `SCREACHER_ECHO.jitterS` |
| Its first scream comes no earlier than | 10 s | `SCREACHER_ECHO.firstMinS` |
| The first scream is staggered over this span after that | 50 s | `SCREACHER_ECHO.firstSpanS` |
| The scan finds the player within | 18 m | `SCREACHER_ECHO.rangeM` |
| The scan happens this far into the scream | 0.5 s | `SCREACHER_ECHO.cueS` |
| It stands still for the scream | 1.6 s | `SCREACHER_ECHO.holdS` |
| A scream cut short before its scan is retried after | 6 s | `SCREACHER_ECHO.retryS` |
| Height of the stump the scan starts from, above its feet | 1.9 m | `SCREACHER_VOICE_Y` |

- **The clock is play time.** It is the brain's own clock and only advances while the world updates. A pause, a menu or a hidden
  tab does not count, and no screams are caught up afterwards.
- **The first scream** of each Screacher is offset from its spawn position, deterministically, so two never scream in unison.
- **Range.** The distance is measured in 3D from the stump to the player's chest or head.
- **The line rule** (`echoLocate`; `Game.echoScan` in `game/src/game.ts`). The player is found only when a straight line from the
  stump to the chest or the head is clear of solid geometry. Two tests must both pass: the enemies' sight line (walls, floors and
  ceilings, closed stall doors and elevator gates) and the bullet line (which also stops at solid props: counters, cabinets, the
  parked train's shell and closed doors). So the scream does not find a player behind a wall, on another storey through a slab, or
  crouched behind solid cover. Within 0.6 m nothing can be between.
- **One snapshot.** A scream that finds the player sets the belief to where the player is at that instant. It does not track the
  player afterwards: step away quietly and it runs to where you were.
- **It only locates.** The scream deals no damage, stuns nothing and calls no other enemy. It is not a sound to the Screacher
  itself or to other Screachers.
- **When it waits.** A scream that is due waits for a swing or a stagger to end. A scream cut short by a staggering hit before its
  scan is retried.
- **Never** while the player rides the train or drives the car, and never for a dead player.

The scream is also the player's warning: it is heard from far away and tells you a Screacher is on the level and roughly where.

## Sneaking past and fighting it

Both are meant to work (user: the "player can sneak by or fight head on").

**Sneaking.**
- Walk or crouch-walk. Do not sprint, do not jump down from things, do not push through loose furniture.
- A sound somewhere else misleads it honestly: it goes to the source of the sound, not to you.
- Stay farther than its touch distance. It feels a body it bumps into.
- Break the line before its scream, or be out of its range. If the scream found you, move: it knows one point, not your path.
- After noise, wait. Heat falls after two quiet seconds.

**Fighting.**
- There is no headshot. Aim for the body and expect it to take more rounds than a zombie.
- Every shot is a sound. Three quick shots make it run at you.
- Its swing is aimed at where it believes you are. A quiet step aside before the hand lands makes it miss. A player really
  standing inside the swing is hit.
- A melee strike from close by tells it exactly where you stand.

## Where it appears: the seeded roster

No spawn table places a Screacher. Its weight is 0 in every level pool, context pool and horde pool (`ROSTER_ONLY_FAMILIES`,
`game/src/ai/spawnTables.ts`). It is placed only by the **seeded roster** (`FAMILY_ROSTER.screacher`, `applyEnemyRoster`,
`game/src/ai/enemyRoster.ts`), once per generated level map, from that map's seed:

| Rule | Value | Constant |
|---|---|---|
| Chance that a level's roll includes Screachers | 0.4 (40 % of level seeds) | `FAMILY_ROSTER.screacher.rate` |
| Preferred distance between two Screachers of a level | 14 m | `FAMILY_ROSTER.screacher.spacingM` |
| Smallest shorter side of the area it may stand in | 6 cells (3 m) | `FAMILY_ROSTER.screacher.slots.minSideCells` |
| Smallest area it may stand in | 80 cells (20 m²) | `FAMILY_ROSTER.screacher.slots.minAreaCells` |

- **How many.** A level whose roll includes them holds 1, 2 or 3 (`FAMILY_ROSTER.screacher.counts`: 40 %, 40 % and 20 % of those
  levels). Where the level cannot keep them 14 m apart it holds as many as fit, at least one.
- **The other 60 % of levels hold none.** The roll is a hash of the level seed, so a level either has Screachers on every visit,
  reload and Retry, or never has them.
- **They replace ordinary zombies.** A Screacher takes the slot of an ordinary ambient zombie of the level's core contexts, in a
  room-sized or larger area. The level's enemy count and every position are unchanged. It never takes a roaming-horde member or an
  outfit zombie.
- **Where it does not stand.** Not in a service annex or the Bunker's damp zone (its contexts are
  `FAMILY_ROSTER.screacher.slots.contexts`: `station`, `street`, `floor`, `roof`, `pit`, `ring`). Not in an area of kind `closet`
  (`FAMILY_ROSTER.screacher.slots.excludeKinds`). Not in a room whose type or purpose is `exit-stair`, `washroom`, `office-stair`,
  `stair-core`, `office-elevator`, `supply-closet`, `janitor-closet` or `electrical-closet`
  (`FAMILY_ROSTER.screacher.slots.excludeRooms`). Only a level with no other ordinary zombie slot at all relaxes this, step by
  step (`docs/enemy-spawns.md`).
- **Never in the Survivor Market** (`ZOMBIE_FREE_LEVELS`).

The whole roster — every family's rate, the placement rules, the census and the save version — is in `docs/enemy-spawns.md`
"The seeded roster (Screacher)".

## Saves and rebuilds

A Screacher is saved exactly like every other enemy: only its **death** is remembered, per spawn index (`game/src/run/memory.ts`
`enemiesToSpawn`).

- When a level is rebuilt (a revisit, a reload, Continue), a living Screacher starts again at its spawn point, in the same body.
- Its position, its belief, its heat and its echo timer are **not** saved. It starts calm with no belief, and its first scream
  comes at the same deterministic offset as the first time.
- A killed Screacher stays dead for the run.
- A station first built before the roster existed keeps roster version 0: it never gains Screachers, and its enemies and kills stay
  exact. Stations entered for the first time get the current roster version.

## Audio

Its voice is its own Sound Lab-derived clip set (`screacher-*.mp3` in `game/public/assets/audio/`; provenance, review status and
licensing caveats in `game/public/assets/derivatives/audio-screacher.json` and `game/public/assets/audio/NOTICE.md`; built by
`tools/audio-pipeline/screacher-build.mjs`). The cues (`SCREACHER_CUES`; ranges and limits in `SCREACHER_AUDIO`,
`game/src/audio/sfx.ts`):

- the **echolocation scream** at every pulse;
- a **shriek** when it turns frenzied;
- a quiet wet **wheeze** while idle and near: the cue that tells a careful player one is close;
- a rasp when hurt and a gurgle when it dies;
- the ordinary zombie footfalls. It has no groan.

These are audio only. Muting the game, the voice limit or distance culling never change what a Screacher hears or does.

## Limits

- It is blind by design. It will walk past a silent player in plain view.
- The echo is one snapshot per scream. Between screams it knows only sounds and touch.
- Hearing is a radius with a wall factor and a per-floor factor. It is not a simulation of how sound travels through rooms.
- Walking and crouch-walking are silent to it whatever the floor is.
- Other enemies do not react to its scream, and it does not react to theirs.
- Belief, heat and timers are not saved (above).
- The audio clips' review status is recorded in their provenance file; read it there.
- Checked in Node (unit tests on the real brain, real level geometry, the real player and physics). Browser checks are short
  serial spot checks only (`game/src/ai/screacherQa.ts`: hooks under `?qa=1`).

## Files and tests

| File | What |
|---|---|
| `game/src/ai/screacher.ts` | Stats, constants, `ScreacherBrain`, `echoLocate`, `deliverNoise`, cues |
| `game/src/ai/screacherActor.ts` | The headless actor: hit volumes, ragdoll, the Scream clip |
| `game/src/ai/screacherNoise.ts` | Physics contacts raised as world noise |
| `game/src/ai/enemyRoster.ts` | The seeded roster that places it |
| `game/src/ai/enemyModels.ts` | The four lazy models |
| `game/tests/screacher-brain.test.ts` | Blindness, sound, heat, touch, the swing, the echo |
| `game/tests/screacher.test.ts` | The family, the headless actor, cues, persistence |
| `game/tests/screacher-noise.test.ts`, `game/tests/screacher-world.test.ts` | Real props and real level geometry |
| `game/tests/screacher-contract.test.ts`, `game/tests/screacher-asset.test.ts` | The GLBs against the asset contract |
| `game/tests/screacher-audio.test.ts` | The clips, cues and their bounds |
| `game/tests/enemy-roster.test.ts` | The roster: rates, counts, spacing, the version pin |
