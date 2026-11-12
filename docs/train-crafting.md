# Train crafting (first pass)

The player's train carries a small crafting bench. It turns the two salvage materials into four physical things: an extra storage
chest and three devices that plug into the train. Material supply is unchanged; nothing here adds loot.

## The bench and the recipes

- Every train has the bench. It stands in the rear compartment on the side opposite the Lockbox, front to the aisle. It is a fixed
  part of the car: not storage, not cargo, not loot.
- Aim at it and press **E** to open the recipe list. The game does not pause. Each row shows the cost, what you have, and what is
  missing. Press **1–4** or the row's button to craft. **E**, **Esc**, **Tab**, **I**, walking away, a hit or the train starting to
  move closes the list.
- The bench works only while the train is parked.

| Recipe | Scrap metal | Electrical parts | What it is |
|---|---|---|---|
| Storage chest | 2 | 0 | The Lockbox's 50 slots in a smaller box you can carry. Needs no plug. |
| Route radar | 4 | 3 | While plugged in, the travel map shows stations two stops away instead of one. |
| Defense sentry | 8 | 6 | While plugged in and loaded, a roof turret shoots nearby enemies. Crafted empty. |
| Item scanner | 5 | 5 | While plugged in, a radar scope shows enemies and items around the train. |

- **Where materials are taken from**, in this order: what you carry, the backpack you wear, the Lockbox, then crafted chests
  standing in the car. Nothing else counts (not the floor, not a backpack stored inside a box).
- **A craft is all or nothing.** The materials are taken and the new thing appears on the car floor in one step. If there is no
  free floor, the car already holds 24 pieces of equipment, or a material is short, nothing changes and the list says why.
- The new unit is a real object with its own number (`eq-1`, `eq-2`, …) that it keeps for good. It starts empty, unplugged and with
  no ammunition.

## Moving equipment

- **Hold E to move a thing.** Aim at a device, the chest or a fuel cart and hold **E** for half a second. The ring at the crosshair
  fills while you hold. A quick tap never moves anything. A tap does the thing's own action instead (open the chest, work a console,
  connect a fuel cart's hose), or nothing if it has none.
- **An unfinished hold is dropped**, with nothing done, when you look away from the thing, step out of reach, open a menu, die,
  climb a ladder, take something else in your hands, the window loses focus, or the train starts to move.
- **Once the drag or carry has started you can release E.** The next **E** press lets go or puts it down, as before.
- **Devices** (radar, sentry, scanner) stand on the fuel dolly's hand truck and move exactly like it. Hold **E** anywhere on one to
  grab it; walk to drag; **E** lets go. Walking into one pushes it. It goes up and down stairs, rides lifts and stops bullets. A
  heavier device is slower.
- **R turns a dragged device round.** While you drag a device, **R** turns it half a turn, so its front faces you instead of away.
  Your own view and position do not change, and **R** does not reload while you drag. Use it to back a device flush against a wall
  with its console facing the room. A device grabbed from its front starts facing you. It keeps the facing you leave it with: on
  the floor, plugged in, riding the train, and through saves and Retry. Only devices turn: the fuel cart and the carried chest do
  not.
- **The chest** is carried in both hands. Tap **E** to open it; hold **E** to pick it up; **E** puts it down on free floor in front
  of you. While you carry it you walk slower, cannot sprint, and cannot fire, reload or use items. Dying puts it down at your feet.
  On the floor it can be shoved slowly.
- Only one thing is held at a time: a dolly, a chest, a fuel cart or a body.
- One mechanism covers every draggable thing (`core/holdGesture.ts`). The code has no per-kind rule: a unit is dragged or carried
  by its trait (`craft/equipment.ts EQUIPMENT`, `move`).
- There is no interaction with equipment while the train is moving.

## The three plugs

- The car has three wall sockets, one in each bay that is not the woodchipper's. Any device fits any socket.
- A device **plugs itself in** when it comes to rest wholly inside the parked car within 1.1 m of a free socket. A cable appears and
  the socket's lamp turns green.
- Grabbing it, or pulling it out of reach or out of the car, unplugs it. Plugging, unplugging and moving cost nothing.
- A benefit needs the plug. With two devices of one kind plugged in, the one on the lowest socket is the one that works.

## Route radar

- The train console's map normally reveals the stations one stop from where you are. With a route radar plugged in it reveals two
  stops (`Game.openTravelMap` → `campaign/discovery.ts revealAround`, radius from `TrainEquipmentSystem.routeRadius`).
- Stations stay known after the radar is unplugged. Travel rules and fuel costs are unchanged: a two-stop trip still costs two
  tanks.
- No battery, fuel or other upkeep.

## Defense sentry

- **Ammunition.** Aim at the console face. Tap **E** to load every 5.56 round you carry (up to 300 in the hopper). Hold **E** to take
  the loaded rounds back. Rounds are only ever moved: none is created, and the count is saved with the unit.
- **The turret** stands on the middle roof hatch. It rises when the sentry is plugged into the parked train, loaded, and there is
  headroom over the roof. It sinks when the sentry is unplugged or empty, or when the train leaves.
- **Targets.** Living, awake enemies within 28 m, the nearest with a clear shot first. Market people are never targets.
- **Fire.** Single aimed shots, 0.4 s apart, one round each. A shot is the game's normal rifle bullet: line of sight, the enemy's
  own hit volumes, the rifle's damage, falloff and part multipliers. It can miss, hit a limb, or be stopped by a wall, a prop or
  glass. Kills count in the run's kill total.
- **Safety.** It holds fire rather than shoot within 0.6 m of the player's body. It never shoots through its own car.
- **Noise.** Each shot is as loud as a rifle shot at the train, and draws enemies there.
- **Blind strip.** The turret cannot aim below −29° and may not shoot through the roof, so it cannot reach an enemy close beside
  the car. Measured on a Subway platform: a standing enemy's chest is out of reach within about 2.1 m of the car's side, its head
  within about 1.5 m. Down in the track bed the strip is about 4.2 m. It also cannot aim above +8°, so enemies on storeys well
  above the roof are mostly out of reach. Enemies along the roof line and inside the car are never shot.
- Enemies do not attack the turret or the console.

## Item scanner

- Aim at the console face of a plugged-in scanner and tap **E**. A round black-and-green scope opens over the view. The game is
  not paused and you keep full control. **E**, a menu, a hit, or walking 2.6 m away closes it.
- The scope covers a full circle of about 100 m around the train, with range rings every 25 m. Train front is up.
- **Sweeps, not tracking.** About every 30 seconds of active play the scanner takes one snapshot. Blips do not move between sweeps:
  a blip is where something was at the last sweep. The first sweep at a station comes 4 seconds after the scanner is active there.
  Time spent unplugged does not count.
- **Blips.** Red disc: a living enemy. Green square: ordinary items (ammunition, food, medical supplies, materials and so on),
  loose or in a container. Gold diamond: a weapon, gear, or a backpack on the ground.
- **Coarse on purpose.** Positions snap to a 4 m grid and things in one cell merge into one blip. All storeys are flattened onto
  one plane. There are no walls, rooms, labels or distances.
- Things in the parked car and a market stall's displayed wares are never shown.
- No battery, fuel or other upkeep. A sweep makes no noise.

## Travel and saves

Equipment follows the game's common cargo rule: what stands wholly inside the parked car belongs to the train; everything else
belongs to the station it was left in. One mechanism covers every kind; the code has no list of kinds beyond the table of traits
(`craft/equipment.ts EQUIPMENT`).

| What | Where it is kept | Travel | Retry / Load / Continue / export–import |
|---|---|---|---|
| Unit number, kind, position | train record (`equipment`) or the station's lane (`train-equipment.here`) | rides in the car to the next station | restored exactly |
| Chest contents | with the unit (ordinary item stacks) | ride along | restored exactly, never refilled |
| Sentry rounds | with the unit | ride along | restored exactly |
| Which socket a device is on | with the unit (train only) | kept; working again on arrival | restored when still in reach |
| Scanner snapshot, turret pose | not saved | cleared at each station | cleared |

- A unit standing in a doorway refuses the departure ("push it all the way in or out"), like a fuel cart.
- The limits are 24 units in the car and 48 left in one station. Beyond them a craft or a departure is refused with the numbers;
  nothing is ever dropped from a save.
- A chest in your hands when the train leaves or the game saves is recorded as the train's.
- A damaged equipment record loads as no equipment. It never produces a free device, item or round.

## Assets

- The bench, the three device modules and the roof turret are Meshy models (image-to-3D from Codex conditioning images) that keep
  their own texture maps; `tools/asset-pipeline/props/build-train-equipment.mjs` cooks them into
  `game/public/assets/models/train-{bench,radar,sentry,scanner,turret}.glb` and writes the measurements the game reads
  (`game/src/assets/trainEquipment.generated.ts`). Credits and provenance: `game/public/assets/CREDITS.md`,
  `game/public/assets/derivatives/train-equipment.json`.
- The chest reuses the Lockbox model at 0.8 scale. The devices reuse the fuel dolly's hand truck. Sockets, lamps and cables are
  plain geometry with plain materials; the cable reuses the fuel hose.
- The turret may only fire over the real roof. `tools/asset-pipeline/train/measure-train-roof.mjs` measures the cooked car shell
  and writes `game/src/assets/trainRoof.generated.ts`. Re-run it if the shell model changes (`--check` compares).
- Sounds are existing cues. No new audio.
- Sizes, contact points and prop classification: `docs/prop-affordances.md` §6.

## Known limits of this pass

- Devices are crafted only. None spawns as loot.
- Enemies walk through equipment standing on the floor, as they do through fuel carts.
- A train door closes through a unit left in the doorway (the departure itself is refused).
- A carried chest can poke into a wall you stand against.
- The turret has no hatch-opening animation: it rises through the hatch.
- A stray sentry round can break glass or wake a dormant enemy, like any bullet.
- A dense level can hint at its outline on the scanner through the spread of its item blips (`SCANNER.cell` is the knob).

## Code map

| Part | Files |
|---|---|
| Recipes, records, traits | `craft/recipes.ts`, `craft/equipment.ts`, `craft/equipmentApi.ts` |
| Placements in the car, roof outline | `craft/trainFixtures.ts` |
| Atomic craft | `craft/crafting.ts` |
| Bench and recipe list | `world/craftBench.ts`, `ui/craftView.ts` |
| Units, plugs, cargo, saves | `world/trainEquipment.ts`, `world/trainEquipmentModel.ts` |
| Chest view | `world/equipmentChestStore.ts` |
| Sentry | `craft/sentry.ts`, `world/sentryTurret.ts`, `world/sentryTurretView.ts` |
| Scanner | `craft/scanner.ts`, `world/itemScanner.ts`, `ui/scannerView.ts` |
| Save validation | `save/validate.ts` |

QA hooks (`?qa=1`): `__LL.bench()`, `benchGo()`, `benchOpen()`, `benchCraft(kind)`, `equipment()`, `equipmentCraft(kind)`,
`equipmentToPlug(uid, i)`, `sentry()`, `scanner()`, `scannerSweep()`.

Tests: `tests/train-crafting-session.test.ts` runs the whole chain with every system real. Each part has its own files:
`craft-*`, `train-equipment-*`, `equipment-chest-store`, `sentry-*`, `scanner-*`, `route-radar`, `train-crafting-contract`,
`train-roof-profile`.
