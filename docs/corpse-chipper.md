# The train's corpse chipper (emergency fuel)

An emergency fuel source that is deliberately slow and annoying. The player carries real dead undead bodies, one at a time, onto the
player's train and feeds them into a woodchipper fixed in the car. Each body is ground for about 20 active seconds, with a lot of blood
spray, and becomes a tenth of a standard fuel tank. Normal fuel loot, spawn weights and refills are unchanged.

## Yield (exact)

| Bodies | Fuel | Existing quarter units |
|---|---|---|
| 1 | 0.1 standard tank | 0.4 |
| 10 | 1 standard tank = one hop | 4 (half the train's capacity) |
| 20 | 2 standard tanks = a full empty train | 8 |

- Every existing fuel quantity stays in whole quarters: a can 1, a fuel cart 8, a Bunker generator 1 each, a hop 4, the train 8
  (`fuel/fuel.ts FUEL`).
- The chipper keeps its own credit in integer **ticks** of a fifth of a quarter (`fuel/chipperFuel.ts`). One body = 2 ticks, so no
  fraction ever exists in the tank, a cart, a can, a fare or a save.
- Whole quarters (5 ticks) move into the train's tank while it has room, and only while the train is parked with no journey pending.
  The remainder, and any credit while the tank is full, waits in the machine (at most 40 ticks = 2 standard tanks).
- A full machine refuses the next body. The player keeps it; nothing is lost or clamped.
- The machine's credit and an unfinished grind are never part of a fare.

## Playing it

1. Kill an undead enemy. Look at the body and press **E** (*Pick up the body*); reach is 2.4 m.
2. The body hangs over the right shoulder.
   - Hands are busy: no firing, aiming, flares, item use, reloading or fuel pouring. The held item is lowered.
   - Movement slows by the body's mass, and a sprint becomes a heavy jog.
   - The train's driving console stays usable, so a body can be carried through a journey.
3. **E** puts the body down on open, level floor in front. It can be picked up again later.
4. In the parked train, stand within 1.4 m of the chipper's hopper (the far side of the car, between the middle and front door pairs).
   Look at it and press **E** (*Feed the body into the chipper*).
   - It refuses while the train moves, while it is still grinding, or when its credit is full.
5. The motor starts and the machine grabs the body head first. The body goes limp: its own ragdoll (the same parts and joint limits
   as any corpse) flops over the rim and down the machine's front, and is drawn in a little at a time in lunges. Each part is pulled
   in at its turn, crown first and feet last. Blood sprays from the hopper and the discharge spout, and pools on the car floor.
   - A gauge on the control box and the look-at line show the progress and the waiting credit.
   - About 20 active seconds later the body is gone and +0.1 tank is credited.
   - The physics only moves the visual. The job's record alone sets the time, the credit and the save
     (`world/chipperRagdoll.ts`, details under Limits).
6. The machine runs at zero train fuel (electric/auxiliary). It only grinds while the train is parked. Riding or pausing keeps the
   progress, clears the airborne spray and stops the sound; it resumes when parked.

## Which bodies

- **Eligible:** any dead enemy whose archetype's corpse trait is undead and humanoid (`ai/corpseTrait.ts CORPSE_TRAITS`, the field
  `corpse` of every `ENEMY_ARCHETYPES` entry).
  - Today that is the zombie (every look), Blightbelly, Siren, Strainer and the Screacher (all four bodies).
  - The rat/dog scavenger is an animal and is not eligible.
  - A new archetype must classify itself; a registry-driven test checks every entry.
- **Never eligible:** living enemies, Market people, the player, decorative corpse props, ragdoll parts and severed limbs.
- **Identity:** `'<station section>#<layout enemy index>'`, which is one death (killed enemies never respawn). Only layout spawns have
  one. A family with several bodies (the Screacher's four) keeps the spawn's body variant, so a rebuilt body is the same body.
- **Access (honest rule):** bodies of enemies killed during the current visit can be picked up. An untouched body is not saved, as
  before this feature; it is gone after a reload or a revisit. Once picked up, a body is persisted wherever it goes.
  - Bodies are never conjured from older kill lists, which hold no pose.

## Where a body is (one body, one place)

| Place | Record | Notes |
|---|---|---|
| Hands | run participant `corpse-carry` | carried through journeys, saves and loads |
| A station's floor | section lane `corpses.here` (world pose + storey) | rebuilt on reload / revisit |
| The parked or riding train | train cargo v3 `bodies` (train-local pose) | captured at the ride start with the props; at most 64 aboard (more refuses the departure; a body across the doorway refuses it too) |
| The chipper's hopper | the player-train record's `chipper.job` | with a processing uid and integer-ms progress |

- Moves between places happen in one synchronous call.
- Save validation refuses a save that lists one body twice anywhere.
- When a grind completes, the body's consumption and its credit happen in one mutation (`grind()`); nothing can claim it twice.
- **Retry** restores the level-entry state of everything together: the station memory (the enemy alive again), the hands, the train's
  cargo and the machine. Credit and the body are never both kept.
- **Old saves** load with no bodies and an idle, empty chipper. Older cargo records (v1/v2) still load.

## World noise

The machine is loud at its own position (`ai/worldNoise.ts emitWorldNoise`; the existing hearing rule, line of sight and slab
muffling; nothing is spawned):

| Event | Radius | When |
|---|---|---|
| Motor start | 32 m | each start, including a resume |
| Feed | 20 m | each feed |
| Grind | 28 m | every 4 s of grinding |

Blind Screachers hear it through the same path. Their belief is the machine's position, never the player's.

## Assets

- **Model:** `game/public/assets/models/train-chipper.glb`, 1.36 × 0.83 × 0.62 m, 18,338 triangles.
  - One Codex conditioning design → one Meshy T2.5 smart-topology image-to-3D model.
  - Its own PBR maps are kept and only re-encoded (`tools/asset-pipeline/props/build-train-chipper.mjs`).
  - It is a fixed train fixture (`docs/prop-affordances.md` §6), not loot or cargo. Every train has one, including old saves.
- **Sound:** five local Sound Lab cues (motor loop, grind loop, feed, spin-up, wind-down; `tools/audio-pipeline/chipper-build.mjs`,
  `audio/chipperAudio.ts`).

## Limits

- A body lying on a station floor or in the parked car takes bullets and melee like an ordinary corpse. A carried, riding or
  in-hopper body is not a target. Nothing collides with a body (as with ordinary corpses).
- A body rebuilt from its record (after a reload, a revisit or a journey) shows blood and flesh bits when hit, but no new wound marks;
  its old wounds are not kept. The original body keeps its wounds while it stays the same object (the visit it died in, in the hands,
  riding through a journey).
- Old saves: a loose item, prop or fuel cart that was saved where the machine now stands is restored where it was. Nothing is moved
  or teleported, but such an object sits inside the machine's box.
- The machine's sounds were checked structurally only (duration, level, loop seams), not by ear.
- **The feed physics** (`world/chipperRagdoll.ts ChipperFeed`) is deliberately controlled:
  - It runs in a small private physics world in the car's frame: a few boxes of the machine around the hopper's open mouth, and the
    car floor. It never touches the game's physics, the player, the machine's collider or another body. It steps only while the
    machine grinds; riding or paused, the body hangs as it is.
  - A part is pulled in once it is inside the mouth, or anyway 0.3 m past its turn. From 90 % of the progress every part is pulled
    in, so the body cannot stay stuck. A part pulled in by that deadline may clip briefly through a rim.
  - Parts still outside have capped speeds and stay inside the car. A body that turns non-finite or runs away gets its bones back and
    finishes with the old posed feed (`chipperView.ts FedBody`), as does a body without a ragdoll. The job is credited either way.
  - The machine's boxes are approximations of the model (solid sides where the hopper has low lips and a flap curtain). A dangling
    limb can rest a few centimetres off the real surface.
  - After a load mid-grind, the rebuilt body starts limp from the saved progress, not from the exact pose it had.
