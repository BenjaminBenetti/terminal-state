# Train crafting (first pass)

The player's train carries a small crafting bench. It turns the two salvage materials into four physical things: an extra storage
chest and three devices that plug into the train. Material supply is unchanged; nothing here adds loot. Since the refinement batch
it also makes acid and lure grenades from bio mater and fits the permanent train armor (see "Made recipes" below).

## The bench and the recipes

- Every train has the bench. It stands in the rear compartment on the side opposite the Lockbox, front to the aisle. It is a fixed
  part of the car: not storage, not cargo, not loot.
- Aim at it and press **E** to open the recipe list. The game does not pause. **E**, **Esc**, **Tab**, **I**, walking away, a hit
  or the train starting to move closes the list.
- Each row shows, left to right: a 3D picture of the thing, its name with one line about it, one chip per material it costs, and
  the **Craft** button. Crafting is the button only. There is no key shortcut: number keys do nothing while the list is open.
- A material chip is the material's inventory icon over `have / need`: green when there is enough, red when short. `have` counts
  exactly what a craft can take (the four places below). The chip's tooltip names the material and says where it is.
- The picture is the real unit as it stands in the car (the chest with its lid shut), drawn by the inventory's icon renderer into
  the same icon cache (`world/craftPreview.ts`, `ui/itemIcons.ts registerIconSource`). It is rendered once when the unit's models
  are loaded, not per frame and not on every open. Until then the frame stays empty: no stand-in is ever pictured.
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
  free floor, the car already holds 24 pieces of equipment, or a material is short, nothing changes and the button is off. A
  short material is its red chip; when the car cannot take the unit, a red line under the row says why.
- The new unit is a real object with its own number (`eq-1`, `eq-2`, …) that it keeps for good. It starts empty, unplugged and with
  no ammunition.

### Made recipes: grenades and the train armor

Since the refinement batch (task studio-refinement-batch-20261113-035659-01) the list goes on after the four units with three
recipes whose output is not a unit (`craft/recipes.ts MADE_RECIPES`; `BENCH_RECIPES` is the whole list):

| Recipe | Scrap metal | Electrical parts | Bio mater | What it makes |
|---|---|---|---|---|
| Acid Scrapper grenade ×5 | 0 | 0 | 3 | Five throwables for the grenade slot (below). |
| Zombie Lure grenade ×3 | 0 | 0 | 3 | Three throwables for the grenade slot (below). |
| Train armor | 10 | 0 | 0 | Plating and blades all round the train, fitted once and for good (no durability). |

- Bio mater is a recipe material now; the four units cost none of it.
- **Grenades go to you first**: the batch is added to your inventory (the grenade slot first, then the usual order) and what does not
  fit goes into the Lockbox. The bench counts the room for the WHOLE batch before it takes anything; without it the row says "No
  room for … on you or in the Lockbox".
- **The armor** is installed by the train's upgrade system (`world/trainArmor.ts`); once fitted its row is refused with that
  system's reason.
- Same transaction as a unit: the debit and the output happen in one step; if the last step fails (or throws) everything it changed
  is put back and the materials are refunded into the same stacks (`craft/crafting.ts craftMade`). A made row's picture is the
  item's own rendered icon, or the upgrade's registered preview (`upgrade:<id>`) — empty until it is rendered, never a glyph.

### The crafted grenades

Both go in the grenade slot and are thrown like a road flare: **hold G** (or hold click with one in the hand) to ready, release to
throw. One item is spent per throw, only when the throw happens (`weapons/grenades.ts`; the items: `items/grenades.ts`; models:
Meshy T2.5 derivatives of Codex design images, `world/grenadeModels.ts`).

- **Acid Scrapper grenade.** A zombie it hits takes 45 damage and the canister bursts there. On a prop the acid can melt it
  **sticks**, bursts 0.9 s later and that prop starts to melt. On anything else a hard hit bursts it and a soft one bounces; at rest
  it bursts. The burst splashes 20 damage to zombies and 8 to the player within 1.3 m, and leaves an **acid pool** (1.5 m radius) on
  the floor below for **10 active seconds** (it does not age while paused or in menus). Everyone standing in the pool burns:
  zombies 30 hp/s (a regular zombie dies in about 3.3 s), the player 7 hp/s (it is not an attack: no armour; a red pulse and a
  grunt about once a second). The time each one stands in it is counted every frame and applied four times a second, as strong as
  the film is (it spreads in over 0.3 s and thins over its last 1.6 s); a burning zombie is alerted where it stands, never drawn to
  the pool, and an acid kill crumples rather than flies. Props the pool touches
  melt after 0.8 s of contact (`world/acidMelt.ts`): each leaves exactly one salvage — **Electrical parts** from powered devices,
  **Scrap metal** from anything else — once, and spills what it held as real items. The train itself and everything fitted to it
  (the Lockbox, the bench, the chipper, the controls, the Save terminal, the armor) never melt; portable cargo and crafted equipment
  aboard do. The pool is a liquid film with bubbles, never a gas cloud. At most three acid pools / acid canisters at once.
- **Acid melt** (`world/acidMelt.ts`; the grenade only asks it what its pool and its stuck canister touch). What melts is decided by
  physical traits and ownership, never by a list of kinds. Station furniture, containers, machines, shelves, crates, lockers, desks and
  counters melt. So do loose props where they lie, carried props, crafted equipment and fuel carts standing in the world, **aboard the
  train too**: portable things are not protected by being in the car. Never melted:
  - the train's own boxes and its fixed fixtures (drawn on the car, never layout placements);
  - building structure and partitions;
  - the Bunker's objectives and anything another system draws;
  - the market stalls' ware displays;
  - a prop holding up one that may not melt (nothing is left floating).

  A melt takes **2.4 s**. The thing leaves every system at once; at most six dissolve on screen and the rest wait their turn intact.
  Its contents then spill as real pickups on valid floor inside its footprint, never through a wall. A holder's lots keep their item
  and count. A unit's slots are the same item stacks, so UIDs, magazines and counts are kept. A fuel cart's units become single fuel cans,
  one per unit (a can holds exactly one unit), so all of its fuel is kept. Pickups and loose things resting on it fall, within the bounded body pools. It leaves **exactly one**
  salvage at its base: **Electrical parts** for anything with a screen, machinery, a hum or a plug, **Scrap metal** otherwise.
  A melted generated prop is recorded in the station's `acid.melted` lane, saved and validated. It stays gone on every rebuild and
  never spills or salvages twice. Carried props, units and carts leave their own records.

  Presentation is non-graphic and not a gas: the prop is covered by a rising acid-tinted shell that sags and shrinks into the floor and
  fades, with a few bubbles and a soft hiss. The navigation grid is unchanged: a melted prop's cells stay blocked for enemies, which is
  conservative and can never trap anyone. Leaving the station completes a melt in progress, and so does the ending save. The train's
  Save terminal waits while a melt is under way or debris is still falling ("acid is still at work").
- **Zombie Lure grenade.** It lands and rolls; at rest it opens and for **20 active seconds** the infected within **20 m** smell it,
  through walls and round corners, and go to the canister itself — never to you (`ai/scentLure.ts`); one that sees you still
  comes for you, and the blind Screacher and a dormant Siren ignore it. The BB is drawn too: off its wall or ceiling it drops down
  and walks the floor to the canister (`ai/bb.ts`). A faint tan plume shows it is venting. Then it is empty and
  goes after a while. At most three at once.

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

- **Ammunition.** The sentry has its own inventory of **four slots** that take 5.56 rounds only (up to 4 × 120). Tap **E** on the
  sentry to open it beside your quick slots and pockets, like a chest: click a stack to move it across, drag it onto a slot, Shift-drag to
  split. Stacks merge and split by the usual inventory rules. Anything that is not 5.56 is refused and stays where it was.
- The turret fires only the rounds in those slots, one per shot, last slot first. Rounds you carry are never used. Rounds are only
  ever moved: none is created, and the stacks are saved with the unit.
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

## Train armour

- A **permanent, one-time upgrade** of the car (its recipe is at the bench). Once fitted it stays for the rest of the run. It has
  no durability, wear or upkeep, and it cannot be fitted twice.
- **What it is** (the makeover kit, task studio-train-armor-makeover-20261113-183146-01: the recipe, the record and the contact
  rule are the first kit's; only the look and the boxes that follow it changed). 67 weathered steel, welded, bladed pieces
  in five layers that cover the car from the rails to the roof line (`world/trainArmorLayout.ts`):
  - **Skirt**: one unbroken bladed skirt along each side below the floor, from 0.24 m over the rails to 0.92 m. It runs under the
    doors too (the floor is at 0.98 m). Over each bogie (the 3.35 m at either end) it is the heavy toothed guard.
  - **Belt plates**: eight tall plates per side from the floor line to the window sills (0.87–1.86 m), in the free spans between
    the doors. Neighbours lap 3 cm and stand alternately 19 and 21.5 cm proud, one 3 cm lower than the next, so the belt reads as
    stacked plate, not one strip. The platform side leaves a 0.6 m bay open around the fuel cap.
  - **Buttress posts**: a bladed post on every solid pier of the window band (six on the platform side, five on the far side),
    1.88–3.12 m, never over glass.
  - **Roof rail**: a spiked rail along the roof line of each side (2.99–3.15 m), over the door heads and windows.
  - **Ends**: a V plough at each end, two wings (1.0 m tall) from 1.64 m corner towers to a 1.4 m prow that stands 0.45 m ahead of
    the body, with the couplers inside it; and a brow rail on the roof edge between the two marker lamps.

  The first kit's two models are reused (the side strip is the skirt, the end plough is the guard) with four more Meshy models
  (image-to-3D from Codex design images, their own texture maps kept): `train-armor-{plate,post,wing,rail}.glb`, cooked by
  `tools/asset-pipeline/props/build-train-armor-makeover.mjs`. Nine instanced draws; a mirrored piece uses a mirrored copy of
  its geometry. The kit shows the moment the upgrade is fitted, and on every save that already has it: the save records only
  that the armour is fitted, so nothing is crafted again and nothing else in the record changes.
- **Palette** (task studio-train-armor-palette-20261113-213306-01; user: the rusty metal should blend with the cleaner
  train, "mostly a color issue"). The six models' base colour maps carry one deterministic grade
  (`tools/asset-pipeline/props/lib/armor-palette.mjs`, run by both cooks on the raw map before its downsize): the
  uniform orange-brown becomes weathered steel centred on the car body's own light steel (the mean of the shell map's
  grey and off-white texels, sRGB about 157, 159, 155), the most saturated patches of each map stay rust (accents in
  patches, streaks and seams), the hazard stripes stay as generated, and dark seams stay dark. The kit's steel is partly
  metallic in its own metallic-roughness map, so it draws darker than that albedo: in the game's renderer it sits at the
  car's grey waist band, under the off-white panels. It is material only: the meshes, the UVs, the metallic-roughness
  and normal maps are byte for byte as they were before the grade (`tests/train-armor-palette.test.ts`), nothing was
  generated, and the raw masters are untouched. The files keep their names, so an armoured save shows the new palette as
  it loads. Nothing at run time tints the kit: no light, exposure or shader changed.
- **What it keeps clear.** Every door opening and both leaves' full sliding travel, every window, every lamp (head, tail and
  marker), the fuel cap and its aim, the roof hatch turret's whole field of fire (the rail's top is under its lowest line), the
  boarding path and the couplers. It stays as slim as the first kit along the body: the plates reach 1.69 m from the centre line
  on the far side and 1.655 m on the platform side (first kit: 1.695 / 1.66), the four corner towers 1.683 m. That is inside the
  0.5 m gap to the platform edge (2.0 m), inside the ride tunnel's box (clear of the open portal gate leaves), inboard of the
  tunnel signals and cable tray, above the third rail. The kit is a fixed part of the car: acid never melts it.
- **Head and tail beams.** The ploughs stand ahead of the lamps, the prow on the beams' own axis, and the car's cast lights throw
  no shadow: left at the lamps they would light the ploughs point-blank from behind (white-hot fins seen from the cab and the
  platform; found in the browser spot check). While the armour is fitted each beam therefore starts 5 cm clear of its plough,
  aimed at the same point on the track with the same strength (`PlayerTrainRuntime.placeLightsBy`); the lamp lenses stay where
  they are, and without the armour the beams start at the lamps as before.
- **Solid.** The pieces block the player, enemies and bullets while the car is parked (its own collision boxes, removed with the
  car), and are part of the moving car's collision while riding. Three details (`ArmorBox`):
  - the posts and rails are above everyone's head and over the doors, so they stop **shots only**, never a body;
  - the skirt **under a door** stops shots at its real height but a body only up to 0.5 m: station platforms lie 0.125 m under
    the car floor (and may lie up to 0.45 m under it), so anything that boards from a platform passes over it exactly as before,
    including a wide enemy or a cart whose side overhangs the bridge;
  - the slanted plough wings are a staircase of boxes that stand at most 7 cm proud of the plate.
- **Contact damage, zombies only.** While the car stands parked, a living enemy pressed against the blades takes **20 damage per
  second**: a regular zombie (100 health) dies after **5 seconds** of continuous contact, a coated one (165) after about 8 s, a
  special by its own health. "Against the blades" means within 0.4 m of the outer face (a zombie at the platform edge beside the
  skirt and plates is 0.35–0.38 m away), its body overlapping the piece's height, and never within 0.5 m of a door opening on
  that side, so a zombie in an open doorway or on a door bridge is never cut. The blades are the skirt, the belt plates and the
  ploughs; the posts and rails overhead cut nobody. The hit makes the zombie aware, like any hit, and a kill counts as a
  kill (ragdoll thrown off the blades). The player, market people, corpses, ragdolls and zombies on a ladder are never hurt, and
  nothing is hurt while the train is moving. Feedback is the usual blood puff now and then; there is no new sound.
- **The upgrades seam** (`Game.trainUpgrades`): `installed(id)`, `block(id)` (already fitted / no parked car here / the train is
  moving) and `install(id)`. The craft takes the 10 scrap metal first and then calls `install`; if that returns false the craft
  refunds the scrap.

## Travel and saves

Equipment follows the game's common cargo rule: what stands wholly inside the parked car belongs to the train; everything else
belongs to the station it was left in. One mechanism covers every kind; the code has no list of kinds beyond the table of traits
(`craft/equipment.ts EQUIPMENT`).

| What | Where it is kept | Travel | Retry / Load / Continue / export–import |
|---|---|---|---|
| Unit number, kind, position | train record (`equipment`) or the station's lane (`train-equipment.here`) | rides in the car to the next station | restored exactly |
| Chest contents | with the unit (ordinary item stacks) | ride along | restored exactly, never refilled |
| Sentry rounds | with the unit (ordinary 5.56 stacks in its four slots) | ride along | restored exactly |
| Which socket a device is on | with the unit (train only) | kept; working again on arrival | restored when still in reach |
| Scanner snapshot, turret pose | not saved | cleared at each station | cleared |

- A unit standing in a doorway refuses the departure ("push it all the way in or out"), like a fuel cart.
- The limits are 24 units in the car and 48 left in one station. Beyond them a craft or a departure is refused with the numbers;
  nothing is ever dropped from a save.
- A chest in your hands when the train leaves or the game saves is recorded as the train's.
- A damaged equipment record loads as no equipment. It never produces a free device, item or round.
- **Train armour** is part of the train record (`upgrades: {v: 1, fitted: ['armor']}`, written only while fitted). New game: none.
  Travel keeps it. Retry, Load, Continue and export–import restore it with the rest of the train record: a Retry back to before the
  craft takes it off again together with the refunded scrap, so it is never free and never lost. An old save has no key and loads
  none; a damaged value is rejected by the save check and never fits the armour.
- **Saves from before the sentry had slots** recorded a round count (0–300) instead of stacks. Such a save stays valid. The first
  time the unit stands in a played station its count becomes real 5.56 stacks in its slots: the same number of rounds, each stack
  with a new item number. Until then the count is written back unchanged, so a unit left in a station you never revisit keeps its
  rounds. Retry, Load and export–import of such a save give the same rounds again, never more.

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
| Bench and recipe list | `world/craftBench.ts`, `ui/craftView.ts`, `world/craftPreview.ts` |
| Units, plugs, cargo, saves | `world/trainEquipment.ts`, `world/trainEquipmentModel.ts` |
| Store view of a chest or a sentry | `world/equipmentChestStore.ts`, `ui/lockboxView.ts` |
| Sentry | `craft/sentry.ts`, `world/sentryTurret.ts`, `world/sentryTurretView.ts` |
| Scanner | `craft/scanner.ts`, `world/itemScanner.ts`, `ui/scannerView.ts` |
| Train armour (record, kit, colliders, contact damage) | `run/trainUpgrades.ts`, `world/trainArmor.ts`, `world/trainArmorLayout.ts`, `assets/trainArmor.generated.ts`, `assets/trainArmorKit.generated.ts` |
| Save validation | `save/validate.ts` |
| Made recipes: grenades, train armor | `craft/recipes.ts MADE_RECIPES`, `craft/crafting.ts craftMade`, `items/grenades.ts`, `weapons/grenades.ts`, `world/grenadeModels.ts`, `world/acidMelt.ts`, `ai/scentLure.ts`, `world/trainArmor.ts` |

QA hooks (`?qa=1`): `__LL.bench()` (each row's material chips as `needs`, the 3D previews' state as `previews`), `benchGo()`,
`benchOpen()`, `benchCraft(kind)`, `equipment()`, `equipmentCraft(kind)`, `equipmentToPlug(uid, i)`, `sentry()`, `scanner()`,
`scannerSweep()`, `grenades()`, `grenadeGive(id, n)`, `grenadeThrow(id)`. The store view of any unit with slots (a chest or a sentry, by unit number): `chestStore()`, `chestTap(uid)`,
`chestQuick(ref)`, `chestMove(from, to, count)`, `chestClose()`. The train armour: `trainArmor()`, and `trainArmorFit()` (fits it
without a craft, QA only).

Tests: `tests/train-crafting-session.test.ts` runs the whole chain with every system real. Each part has its own files:
`craft-*`, `train-equipment-*`, `equipment-chest-store`, `sentry-*`, `scanner-*`, `route-radar`, `train-crafting-contract`,
`train-roof-profile`; the hold-to-drag rule and the turn: `hold-gesture`, `drag-hold-*`, `equipment-flip`; the made recipes and the
grenades: `refinement-grenades`; the train armour: `train-armor` (seam, contact damage, colliders, layout), `train-armor-makeover`
(the kit's composition and cover, the cooked models, door walks and a cart through the doors, the fuel cap, the turret's field of
fire, an existing armoured save), `train-armor-save`, `train-armor-clearance` (every level's placement).
