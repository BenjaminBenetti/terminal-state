# Flamethrower, fuel tank and fire

The flamethrower is a stream weapon: it sprays burning fuel while the trigger is held and has no magazine. Its fuel is in a tank
worn on the back. The fire it leaves clings to what it hit, burns for a few seconds, hurts everything standing in it and burns
ordinary props down. This page is the reference for the rules and every default number.

Related pages: crafting and Market stock in `docs/train-crafting.md` ("Made recipes: the flamethrower and its fuel tank"), the
not-loot rule in `docs/loot-tables.md`, the sound set in `docs/flamethrower-audio.md`.

## Getting it

- **Crafted at the train's bench**: flamethrower = 5 scrap metal + 3 electrical parts; fuel tank = 1 bio mater + 1 fuel can + 2
  scrap metal.
- **Bought at a Market**: every Gunsmith stocks one flamethrower (140 ties), every Outfitter one new tank (70 ties).
- Never loot. Neither item is in any loot table, weapon find pool, starter kit or gear roll.

## Fuel

All numbers are in `game/src/fire/flamethrowerSpec.ts` (`FLAME_FUEL`). Fuel is counted in whole units, never fractions.

| What | Value |
|---|---|
| One ordinary fuel can | 200 units |
| One unit | 0.1 s of flame (10 units a second) |
| Tank capacity | 600 units = 3 cans = 60 s of flame |
| A new tank (crafted or bought) | 200 units: exactly the one can its recipe uses |
| Pouring one can into the worn tank | 2.6 s (scaled by handling, never under a quarter of that) |

- The tank's fuel is stored on that tank's own item stack (`fuel`), like an Airtank Backpack's air. It goes wherever the tank goes:
  worn, in a pocket, in a backpack, in the Lockbox or a chest, on the floor, through a save and a Retry.
- The tank is worn in the **back slot**, in place of a backpack or an Airtank Backpack.
- **Firing needs the tank worn.** With no tank on the back, or an empty one, the trigger gives a dry click and a short message.
- **One unit is paid before each 0.1 s of flame.** A unit is never taken without its flame and flame is never given without its unit,
  at any frame rate. A long frame burns at most three units and leaves no backlog.
- **Refill**: with the flamethrower in the hands, **R** pours one whole fuel can from the inventory into the worn tank. The can is
  consumed and the 200 units added in one step when the pour ends. The pour is refused while the tank has less than 200 units of
  room. Switching weapons, holstering or taking the tank off cancels a pour and keeps the can. The trigger does nothing during a
  pour.
- The HUD shows the tank's units where a gun shows its magazine and the fuel cans carried where a gun shows its reserve.

## The stream

`FLAME` in the same file; rules in `game/src/fire/fireSystem.ts`.

| What | Value |
|---|---|
| Range | 8.5 m |
| Cone radius | 0.2 m at the lance, 0.85 m at full range |
| Damage | 90 a second to every enemy in the cone, easing to 60 % at full range |
| Afterburn | 15 a second for 5 s after the last touch of fire (refreshed, never stacked) |
| Flame speed | 15 m/s (a far surface catches a moment after the trigger) |
| Noise | 26 m while the stream runs |
| Handling | movement × 0.88, 0.7 s to draw, no aiming down sights |

- The cone stops at the first wall, floor, ceiling or prop on the aim line. Enemies behind that are not burned, and an enemy needs a
  clear line from the eye.
- Fire clinging to a wall, or to the face of a prop, burns on its open side only. It never reaches a body on the far side.
- Fire does not stagger. A burning enemy keeps coming.
- A kill is handed to the game's normal kill bookkeeping once, with a small shove.
- Market people in the aim line are hurt by the stream itself (no blood effect). Lingering fire does not hurt them.

For scale: a shambler has 100 health, a coated one 165, the Strainer 1200. The rifle's sustained body damage is 240 a second, the
pump shotgun's 165. The flamethrower is weaker per target and strong against groups, since everything in the cone burns at once.

## Fire that clings

`FIRE_PATCH`.

- Where the stream lands it leaves a **patch** on that surface: the floor, a wall, a ceiling or the face of a prop.
- 0.6 s of stream on one spot makes a full patch (0.75 m radius). A brief lick leaves a small one that dies in a second or two.
- A patch burns for **7 active seconds** after it was last fed and dies down over its last 2 s. Paused time does not count.
- A stream ending in open air drops half its flame onto the floor below. Burning drips fall under a running stream.
- At most 24 patches burn at once; the weakest gives way to a new one. Deposits within 0.6 m feed the same patch.
- A patch on a prop follows the prop. When the prop is gone, the patch falls to the floor as embers.
- Standing in a patch: 20 a second to an enemy, 10 a second to the player, scaled by the patch's strength. Overlapping fires do
  not add up: the strongest one counts.
- **The player** burns only while in the fire. The damage is applied directly: it is not an attack, so there is no armor roll and no
  injury roll. The stream itself does not hurt the player.

## Props

`PROP_FIRE`; the burn-out runs through the acid melt engine (`game/src/world/acidMelt.ts`, cause `fire`).

- A prop **catches** after 1.4 s of flame: the stream on it, or a stream-fed patch touching it. Its heat is its time in flame:
  several flames on it at once do not add up. Heat fades at 0.5 a second without flame. A short burst can still light a prop a
  moment later, through the fire it leaves clinging to it.
- A burning prop burns for **4.5 s**, then collapses and is gone for good. Touching it costs an enemy 20 a second, the player 10.
- **Its contents are kept.** A holder's lots, a chest's stacks (the same stack objects, with their ids, rounds and fuel) and a fuel
  cart's fuel (as single cans) spill onto the floor when it collapses.
- **No salvage.** Burning a prop gives nothing. Only the acid grenade's melt gives its one scrap or electrical part.
- **What never burns** is exactly what acid never melts, by one shared rule (`AcidMelt.protection`): the train's structure and every
  fixed train-mounted fixture, building structure and partitions, objectives, Market trader stock, and props whose collision or
  drawing another system owns. Fire only clings to those and burns out.
- Fire spreads from where the player sprays it to what that fire touches, and no further. The embers of a burnt prop light nothing.
- At most six props burn or melt at once (the engine's shared slots); more wait their turn.
- A burn in progress blocks the manual save ("something is still burning out") and completes at once on a section change, so a
  save never holds a half-burnt prop.

## Smoke

Smoke is drawn, never breathed. It does no damage, needs no mask and changes no enemy behaviour. It is grey-brown and never green:
green fog is reserved for toxic gas.

## How it looks

`game/src/fire/fireFx.ts`. Everything is pooled; nothing is allocated while playing.

- **Flames**: one additive sprite ring (768). A flame is drawn inside its sprite: a standing tongue with its foot on the surface,
  torn into licks by noise that streams up through it, or a rolling gout for the stream and splashes. Colour follows density, from
  white-yellow at the foot to deep red at the tips.
- **Smoke**: a second sprite ring (256), lit orange-brown where it leaves the flames and going dark as it climbs.
- **Glow and soot**: instanced marks on the burning surface. Soot stays about 80 s and is never saved.
- **Light**: one pooled fire light, created at start-up and dark when idle, so the scene's light set never changes. It follows the
  strongest fire near the camera and is occluded by walls like a flare's.
- **Volumetric smoke**: the two strongest fires raise plumes in the existing fog pass (the flare's smoke emitters). With the fog
  pass off or unsupported, the sprite smoke and the light still show.
- A burning prop is overlaid by a charring shell that glows faintly and collapses at the end.
- A body that is never shown hurt (the BB) takes fire damage, and no flames are drawn on it.
- The noise texture is runtime data, not authored art.
- The stream and the pilot flame leave the burner bell where the held view draws it (`Viewmodel.muzzleDrawnWorld`: the held view has
  its own narrower camera, so the plain muzzle point would sit nearer the screen centre than the bell). The pilot flame's foot is in the
  bell's mouth and licks up over its rim.

## Models

Both are Meshy image-to-3D models of one Codex design image each, with Meshy's own PBR maps kept (credits and provenance:
`game/public/assets/CREDITS.md`, `assets/derivatives/weapon-flamethrower.json`, `assets/derivatives/gear-fuel-tank.json`).

| Model | File | Size (W×H×D) | Triangles | Maps |
|---|---|---|---|---|
| Flamethrower | `assets/models/weapon-flamethrower.glb` | 0.13 × 0.22 × 0.95 m | 20 170 | base colour 2048, metal-rough / normal 1024 |
| Fuel Tank | `assets/models/gear-fuel-tank.glb` | 0.59 × 0.62 × 0.40 m | 14 454 | base colour / normal 1024, metal-rough 512 |

- The flamethrower's model is delivered lazily like the weapon-variety guns (`weapons/lazyWeaponModels.ts`): fetched for a section that
  can show it (carried, stored, remembered) or the moment a surface shows it, never in the boot preload. It is not a weapon-variety
  identity and joins no find pool.
- Held: low at the right hip, the lance running forward toward the crosshair, pivoting at the model's `Grip` marker. No aimed pose.
- The tank is a gear model (`gear/models.ts`): it stands upright as a pickup and has a rendered item icon. A worn tank is not drawn
  (the game is first person).
- Cook scripts: `tools/asset-pipeline/weapons/build-flamethrower.mjs`, `tools/asset-pipeline/props/build-fuel-tank.mjs` (they read the
  private raw masters; a checkout without them cannot re-cook, and never needs to).

## Files

| Part | Files |
|---|---|
| Numbers and ids | `fire/flamethrowerSpec.ts` |
| Tank fuel helpers | `fire/fuelTank.ts` |
| Weapon definition and the stream cycle | `weapons/flamethrower.ts`, `weapons/weapons.ts` (`updateStream`) |
| Fire rules | `fire/fireSystem.ts` |
| Fire rendering | `fire/fireFx.ts` |
| Burning props | `world/acidMelt.ts` |
| Sound | `fire/sound.ts`, `audio/flameAudio.ts` |
| Models | `assets/flamethrowerModels.generated.ts`, `weapons/lazyWeaponModels.ts`, `gear/models.ts` |
| Wiring | `game.ts` (`flameTick`, `stopFlame`, `flameHint`, the `fireSys.env` block) |

## Tests

- `flamethrower-stream`: exact fuel accounting at four frame rates, taps, a long frame, dry and no-tank triggers, the pour.
- `fire-system`: the cone, shielding, afterburn, kills, patches on wall / floor / ceiling, merging and the cap, the player's burn
  rules, prop heating, embers, `clear()`, the colour rules, the look's state.
- `fire-props`: the real melt engine over a real station: a holder burning out with its lots, no salvage, the record, a chest's
  stacks, a fuel cart's cans, protected props.
- `fuel-tank-state`, `flamethrower-economy`, `flamethrower-market`: the tank's fuel through every store and save, the recipes, the
  stall stock and prices.
- `fire-audio`: the sound set.
- `flamethrower-model`, `fuel-tank-model`: the cooked models, their markers and bounds, the lazy delivery, the held pose and muzzle.
- `acid-pool-visual`: the Acid Scrapper pool's new look (and that its rules did not move).

## Limits

- Fire is not a light source for enemy AI and smoke is not a hazard. Both are deliberate.
- Market people are hurt by the stream only, not by fire on the ground.
- A patch on a moving structure (a door leaf, a lift) stays where it was lit.
- Nothing of a fire is saved: patches, soot and burning bodies end with the section.
