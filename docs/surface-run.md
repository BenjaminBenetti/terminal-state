# Surface Run

Surface Run is a local expedition attached to a **seeded 25% of new or unvisited
Subway, Office and Mall stations**. The roll is independent of their ordinary
layout, loot, enemy roster and other add-ons. A station records its Surface Run
version when first generated. Stations already visited in an older save keep
their original layout, enemies, permanent kills and remaining loot; visiting
them again does not add an expedition or refill anything. An older campaign's
unvisited stations can receive the feature.

This Codex experiment is **preview only**. It is delivered as one unmerged PR;
the separate playable preview must use that exact PR head. The user must play
and approve it before a production merge or deployment. This document does not
claim hosted CI results, browser rendering results or hardware frame rates;
the task report records the actual validation and remaining limits.

## Reaching the checkpoint

An eligible Subway station opens one of its existing street-exit halls into a
real switchback stairwell with eight metres of ascent. Follow the Surface Run
signs, climb both runs and use **E** at the closed checkpoint door. Office
stations use the lobby's actual exterior entrance; the local barricade is moved
beside the usable approach. Malls use an existing street-exit hall.

Crossing the door loads the expedition as a separate section of the **same
station**. The loading screen covers its asset preparation, lighting and full
graphics warm-up. The city scene and its street actors are absent while the
player is underground. On the surface, the city is divided into bounded sectors
culled against the camera, torch and local fog. Existing lighting, reflection,
fog and AO settings retain their normal controls.

The door opens beside a roofed transit stair head and a military command tent.
The tent contains a planning table, finite supplies and an existing gas mask
with a half-used filter. Its open front admits toxic air. Prepare filters or an
airtank through the normal equipment system before a long trip. The enclosed
truck cab protects the player even with the mask off; outside it, the existing
mask, filter, airtank and exposure rules apply. No new oxygen, fuel or vehicle
maintenance resource is added.

Returning through the checkpoint door restores the base station from its own
memory. Its train, resources, loose cargo, searched containers and kills remain
where the normal persistence rules put them. A surface crossing is local; it
does not reset the campaign or replace a pending train journey. Finish any
active train travel before using the expedition door.

## Streets, interiors and the operations map

The street plan has **64 blocks in an 8×8 area**, approximately 232 metres
across. The central **4×4 blocks** contain sixteen destinations: seven stores,
four small shopping centres, four small offices and a train-repair depot. Their
ground-floor interiors include stock rooms, individual retail units, private
offices, meeting and break rooms, server rooms, a repair hall and dispatch
office. They use existing props and ordinary finite loot.

The 48 outer blocks have sparser ruins, wrecks and street dressing. Their roads
remain driveable, with the actual boundary at the outside of the 8×8 area.
There is no movement boundary around the central destinations.

Use **E** at the tent's planning table to read its military operations map; use
E again to close it. The sheet is drawn from this expedition's actual roads and
destinations. It shows the player, the parked or moving truck, and the blocks
and destinations actually entered. Reported holdout markings and infected
incidents are explicitly local, unverified observations attached to real
destinations. They create no quests and reveal no global campaign network or
survivor intelligence. Reading the map does not make the surrounding air safe.

Interior enemies use the normal permanent kill memory. Street infected use a
separate pool of **twelve prebuilt actors** that can replenish indefinitely.
Replacements are selected away from the player and outside the camera's view;
the pool sleeps or recycles distant actors and old unseen bodies. Those
recycled exterior bodies create no permanent corpse or loot records. Pausing,
loading and leaving the section stop its simulation. Interior kills are never
included in this replenishment rule.

## The truck and its cargo

The military truck uses the existing first-person arcade prize-car controller,
including steering, moving wheels, headlights, world collisions and zombie
run-over behavior. Its controls remain:

| Input | Action |
| --- | --- |
| E at the cab | Enter; E while stopped exits when there is room |
| W | Accelerate forward |
| S | Brake, then reverse |
| A / D | Steer |
| Space | Handbrake |
| F while driving | Headlights |

Aim at a locker and use E to transfer items through the existing storage UI.
There are three separate finite compartments: **Cab locker (4 slots)**,
**Side tool locker (4 slots)** and **Rear cargo locker (8 slots)**. They preserve
the actual stored stacks, including UIDs, ammunition, equipment condition,
filter/air charge and bag contents. The truck's pose, lights and contents stay
with this station's expedition between visits and saves.

The depot has four finite salvage cases: the existing **train armour kit,
route radar, item scanner and defense sentry**. Pick up a case, carry it to the
stopped truck's rear and use E to secure it to a free attachment point. There
are four attachment points. Detach a case at the rear after hauling it back,
carry it through the checkpoint door and use E at the parked train to recover
or fit it. While carrying a case, E elsewhere puts it down only where it fits.

These are the existing crafting outputs and effects. Recovering a case does
not also charge its crafting materials. Armour uses the existing one-time
upgrade installation rule; devices use the existing equipment placement and
plug rules. An already fitted upgrade, occupied device or lack of safe space
can refuse recovery and leave the case in the player's hands. Successful
recovery consumes that case's UID once. A case record owns its state and pose;
the meshes and straps are presentation, never a second copy of its contents.

The supplied truck master remains private and unchanged, outside Git, CI and
the runtime package. The optimized runtime derivative retains its PBR maps and
has [its own provenance](../game/public/assets/derivatives/surface-military-truck.json).
The repository's existing credits and licensing caveats still apply.

## Preview route and save precautions

The task report supplies a legal initial campaign save, exported before QA
grants or test mutations. It starts at **Jessamy (`st-00`)**, from **network
seed 5**. Its Subway level seed is `925446105`, code **`0FAZIS9`**; the ordinary
25% roll selects Surface Run there. Import that save into an empty preview slot,
continue, leave the train and follow the Surface Run street-exit signs to the
extended stairs. The report provides the exact save file and preview head.

Use a separate preview origin or browser profile. Export any production saves
before testing, and choose a fresh or empty slot. Return underground and save
at the parked train's normal Save terminal after an expedition. Truck storage,
secured salvage and exploration are then captured with the same run. Existing
autosave and Retry behavior retain their usual scope; crossing the expedition
door does not create a new save terminal.

This build reads older saves while keeping their visited worlds pinned. Its
new feature state is additive, but a save written by the experiment is not
guaranteed to round-trip through an older production build. Keep exported
production backups separate from preview saves.
