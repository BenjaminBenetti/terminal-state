# Terminal State — first playable vertical slice

(Formerly "The Last Line", the working title; legacy task folders, asset provenance and file names keep the old name.)

Working title. Static Three.js first-person subway survival slice: every page load generates a new
large station from one of six macro archetypes (side platforms + long or twin mezzanines; island
platform reached from its ends with a ring "underground concourse"; four-track express with two
islands; two-line interchange joined by a paid transfer passage; split shallow station with fare
controls and ticket halls on both sides of the tracks; deep station with a long escalator hall up to
a PATH-style mall), each with randomized fare lines, ticket halls, retail arcades and a food court
whose restaurants and shops are storefront bays built into the hall walls (counter units with sign
bands and menu boards, glazed shops, roll-down shutters, a service corridor behind; shared seating in
the middle), washrooms, sealed street-exit stairs and back-of-house (stock rooms with shelving,
storage, crew/utility rooms, closets) — 22–32 rigged zombies (iteration 12: doubled) that fall as
physics ragdolls, physical casings, both existing guns, a five-slot hotbar + backpack, visible
searchable loot, food/drink with hunger/thirst (both start at 80%; full to empty in about 23 / 16 active minutes; at 0, 5 % of max health per active minute), death and restart. Campaign runs autosave
into three local save slots and settings persist (both `localStorage`, see Campaign below); no IndexedDB, cloud or server.

## Commands (from the repo root)
| Command | What |
|---|---|
| `npm ci` | install locked dependencies |
| `npm run game:dev` | Vite dev server on http://127.0.0.1:5173/ |
| `npm run game:build` | typecheck + static build to `dist/game/` (relative `./` base) |
| `npm run game:preview` | serve the built game on http://127.0.0.1:4180/ |
| `npm run game:test` | Vitest: generator sample, nav/LOS/collision, inventory, weapons, AI |
| `npm run game:e2e` | scripted real-browser playtest of `dist/game` (Firefox/Xvfb, see below) |
| `node tools/qa/station-maps.mjs OUT [seed …]` | top-down station maps + food-court facade elevations (no browser; one seed per archetype by default) |
| `node tools/qa/station-perf.mjs [OUT.json] [seed …]` | Node-side draw-call / triangle estimate of the built station from a few viewpoints (no GPU, procedural fallbacks) |
| `node game/e2e/iter02-check.mjs OUT` | short iteration-02 browser check (jump/crouch, container, dark/flashlight, New Station audio, turnstiles) |
| `npm run assets:build` | rebuild runtime derivatives from the read-only masters (CPU only) |
| `node tools/asset-pipeline/props/build-props-iteration07.mjs [--only k,k] [--force]` | iteration-07 generated props: rebuild `public/assets/models/p7-*.glb`, `derivatives/props-iteration07.json` and `src/gen/props07.catalog.ts` from the native masters (resumable, deterministic; previews in `.cache/iteration07-p2-previews/`) |
| `npm run game:release` | copy `dist/game` to the handoff folder with a SHA-256 manifest |
| `npm run game:backup` | tar snapshot of the project into the shared task folder |
| `npm run board` | unchanged read-only concept board preview (port 4173) |

The built folder is fully static: open `index.html` through any static HTTP server (not file://).

## Controls
WASD move · mouse look · Shift sprint · Space jump · C crouch · left click fire/use (knife: hold to wind up, release to slash) · right click
aim · R reload · E pick up / open / take aimed item / take all / pry vending / climb ladder (Space lets go) / open a stall door · 1–5 / wheel quick slots · ~ (the key left of 1) melee slot: draws the knife, which lives there and
not in a quick slot · 6 backpack (hold it in front, click sets it down; on a grounded bag tap E opens it, hold E 0.5 s wears it) · Q gas mask on / off · Tab or I inventory · H quick
heal · F flashlight · hold G, release to throw the grenade-slot item (flares) · elevator: aim at a button and click or press E · M mute · Esc pause.
Ctrl+Shift+P toggles the performance overlay (see below). Drop an item by dragging it out of the inventory panel (the old G = drop key is gone). Desktop keyboard + mouse only; touch
is not supported.

Train Lockbox (task train-lockbox-windows-20261101-232156): the big steel box in the player train's rear compartment is your own
**50-slot storage (10 × 5) that travels with the train**. Aim + **E** opens it: your slots on the left, the box on the right; click moves an
item across, drag / Shift-drag work as in a grounded backpack. The world is not paused. E / 6 / Esc / Tab, walking away or getting hit
closes it. The contents carry between levels. Retry restores them to the level-entry state with your inventory; New game empties it.
**Developer code:** with the Lockbox open, type **1 3 3 7** to add the three guns, one of each gear item and a full stack of each ammo
type (13 slots). It adds all of it or nothing: if there isn't room, nothing changes and a note says how many free slots it needs.

Train corpse chipper (task studio-corpse-chipper-fuel-20261110-235304-01, `docs/corpse-chipper.md`): an emergency fuel source.
Aim at the body of an undead enemy you killed and press **E** to pick it up (one at a time, over the shoulder: your hands are busy and
you move slower). **E** puts it down again. In the parked train, aim at the woodchipper on the far side between the middle and front
doors and press **E** to feed the body in. The body goes limp in the hopper and its arms and legs flop as the machine draws it in,
head first. About 20 s later it is ground (with a lot of blood) into **0.1 of a standard tank**: 10
bodies = one hop, 40 = a full empty train (the train's tank holds four standard tanks). The machine runs with an empty tank, is loud enough to draw the infected, and only grinds
while the train is parked.

Train crafting (task studio-train-crafting-v1-20261111-225628-01, `docs/train-crafting.md`): the bench in the train's rear
compartment, opposite the Lockbox, turns **Scrap metal / Electrical parts** into four physical things. Aim + **E** opens the recipe
list (a 3D picture of each thing, and each material's icon with have / need: green when enough, red when short; no key shortcuts); materials come from your pockets, worn backpack, the Lockbox and crafted chests in the
car. **Storage chest** (2 / 0): 50 more slots in a box you carry (tap **E** opens, hold **E** carries). **Route radar** (4 / 3): the
travel map shows two stops out. **Defense sentry** (8 / 6): **E** on it opens its four ammunition slots; put 5.56 rounds in (and take them back out) like in
any store, and a roof turret shoots nearby enemies with the rounds in those slots. **Item scanner** (5 / 5): **E** on its console opens a 100 m radar scope that sweeps about every 30 s (red
enemies, green items, gold weapons and gear). The three devices roll like the fuel dolly and work only while plugged into one of the
train's three wall sockets, which happens by itself when one is parked beside a free socket. Hold **E** to drag a device or a fuel
cart, or to carry the chest (a tap never moves one); **R** turns a dragged device round to face you. Everything travels with the train
and is saved with its contents, rounds and socket.

Train armour (task studio-refinement-batch-20261113-035659-01, `docs/train-crafting.md` "Train armour"): a permanent one-time upgrade
(10 scrap metal at the bench) that welds bladed plates and saw discs along both sides of the car and a bladed plough across each end.
No durability; it stays for the run, is saved with the train and never covers a door, window or lamp. While the train is parked, a
zombie pressed against the blades takes 20 damage a second (a regular zombie dies after 5 seconds); the player, market people and
corpses are never hurt, and nothing is hurt while the train moves. The plates are solid to the player, enemies and bullets.

Light survival (iteration 12, `player/flashlight.ts`, `weapons/throwables.ts`): the flashlight runs on a **battery**
(HUD meter bottom right, above the weapon panel). It starts at 80 % and drains only while the light is on: a full battery
gives 7 min of continuous light. Above 25 % the beam is steady; below 25 % it flickers — soft irregular dips whose share of
the light-on time grows linearly from 0 at 25 % to 40 % near 0 % (dips 0.10–0.34 s, half-dims near 25 %, real cut-outs
only near empty, plus a slight brown-out); at 0 % it is dead and F only clicks. A found **battery** (D cell) is used like
food (left click while held, or Use in the inventory): it refills to 100 %, consumes one, and is refused at ≥ 99 %. A
faint warm-orange **body glow** (0.22 cd, 2 m reach) keeps the floor right around you from pitch black; it never draws
enemies. **Flares** are the grenade slot. Office overhaul: flares stack to **10** and live in a dedicated **grenade slot** (the
HUD's "G" cell; picked-up flares fill it first); **hold G** to ready the slot's flare (iteration 15 used T, which still works
silently) or **hold left click**
with a flare in the held quick slot to ready it (drawn back like a grenade), **release** to throw; a quick tap throws on
release, holding never throws twice, and switching item / pausing / opening the inventory drops it unspent. It bounces and
settles physically, burns red with red smoke for 50 s (fading over the last 6 s) — a strong red light (42 cd, 11.5 m,
iteration 15; walls and other storeys stay dark) — and lures enemies that can see it (28 m). At most 3 burn at once (a 4th throw is refused, nothing used). The
flashlight beam lures too (20 m around where it lands, scaled by its brightness).

Crouch: **C** (iteration 05: back from Ctrl, which collided with the browser's Ctrl+W) — tap to
toggle; hold longer than 0.3 s to crouch only while held. Crouched = half speed, ~30% less recoil and
20% tighter spread; you cannot sprint or jump from a crouch — Space, or Shift while moving forward,
stands you up first (if there is headroom). Pausing while holding C leaves you crouched (tap it to
stand). The Fullscreen button (title and pause menu) is optional plain fullscreen.

Inventory (Tab / I, iteration 04): drag and drop with the mouse — drop an item on another quick
slot or backpack slot to move it (the same item stacks up to its limit, a different item swaps,
Shift-drag splits off half a stack); the HUD quick-slot bar under the screen also accepts drops;
drag it **outside the inventory panel to drop it** on the floor in front of you. Click selects an
item (details, Use / Equip / Drop buttons, 1–5 assigns it to a quick slot); double-click,
Ctrl+click (Cmd+click) or right-click uses food / drink / medicine (right-click equips a gun); keyboard: Enter selects the
focused slot, Delete drops it. Item icons everywhere (inventory, quick slots, drag ghost, pickup
prompt) are renders of the actual runtime 3D models, made once at load through the game's own
renderer (one offscreen render target, then disposed); the old SVG silhouettes are only a fallback.

Eating / drinking / bandaging (iteration 04): the gun lowers out of view and the item's own model
comes up from the hand to your mouth (bottles, cans, cartons and tins tip up; the chocolate bar
takes bites; bandages and the med kit are applied low in front of you), then goes away and the gun
comes back up with its magazine untouched; you cannot fire or aim until it is back. Switching
slots, sprinting, taking a zombie hit, opening the inventory or pause menu, or dying cancels the use
— nothing is consumed and the gun returns.

Loot: aim at a cabinet, cupboard or crate and press E to open it — its contents appear as real
items on the interior shelves/floor. Iteration 08: trash cans and wheelie bins (hinged lids), staff
lockers, filing cabinets, tool chests, crash carts and desk pedestals (sliding drawers), chest
freezers (sliding panes), shop coolers (glass door), kitchenettes, safes, newspaper boxes and wall
first-aid / extinguisher / AED cabinets open the same way, part by part ("[E] Open top drawer"), with
a visible interior and their own finite seeded contents (`src/world/openables*.ts`; audit of every
prop kind and the honest exceptions — live electrical panels, the fare vault, appliances, toilet
stalls … — in `world/openablesSpec.ts` `OPENABLE_AUDIT`). Aim at an item + E to take it, or E on the open body to "Take
all". Shelves, kiosk counters/back shelves and tables hold visible items too; vending machines need
"E — Pry open" (~1 s) and their stock spills out in front. Contents are rolled once per station
(seeded, finite, never rerolled); anything that does not fit stays where it is. Empty containers
say so ("searched — empty").
Loot tables per logical level (profiles, slot categories, overrides; `src/items/lootTables.ts`): tuning guide `../docs/loot-tables.md`.

Room and store purposes (iteration 05, `src/gen/purposes.ts`): every back-of-house room and every
storefront is generated from a data-driven PURPOSE — name pool / sign / menu, fixtures and where
they stand (far / side / door wall, rows, centre islands with ≥ 1 m walkways), loot per holder,
loose floor supplies and a lighting hint. Back of house: staff room (kitchenette, open fridge,
table, lockers, couch, notice board), crew locker room, first-aid room, transit security office
(forced gun locker with ammo, CCTV desk; one per level), electrical room / closet, signal relay
room, maintenance storage, stock rooms, janitor closet (mop sink, cart, cleaning stock), supply
closet, station agent office. Stores: convenience (aisles, coolers, snacks), newsstand
(magazine racks, snacks, cooler), pharmacy (dressings shelving, first-aid cabinets), electronics
(device tables, accessory walls, glass showcases — tills hold staff leftovers only), phone repair,
key cutting, florist, and food counters whose kitchen line and menu match the cuisine (grill,
pizza oven, espresso bar, wok range, deli rail, juice blenders, hot-dog roller grill). Purpose
fixtures are authored textured parts (`src/gen/purposeShapes.ts`, `src/world/purposeTextures.ts`);
generated models replace a few when present. Nothing names a station: new levels reuse the registry.

Food and water: FOOD and WATER bars under HP/ST both start at 80% (spawn, new station, retry) and
drain slowly only while playing (about −8 food / −12 water per 15 minutes; menus and the
inventory freeze them). At 0 you slowly lose health. 3 drinks (water, cola, orange juice) and 4
foods (chocolate, chips, canned beans, instant noodles): hold one in a quick slot and left click,
or in the inventory double-click / Ctrl+click / right-click it (or select + Eat/Drink).

Damage and breaking (iteration 06, `src/damage/`): every bullet hit is resolved to a material class
(`src/damage/materials.ts`: concrete, tile, terrazzo, plaster, ballast, sheet metal, steel, wood, glass,
screens, plastic, laminate, porcelain, fabric, cardboard, food, flesh, cloth, rubber). Walls, floors and
ceilings take persistent chip craters (repeated hits deepen them) and throw real chunks that bounce and
settle on the floor — big structural surfaces only CHIP (no voxel collapse, no new openings). Props
are damaged per instance (dents / holes / splinters / cracks / tears) and some break: glass panes,
cooler doors and display cases shatter, screens die, a vending front gives way (contents spill as if
pried), wooden crates splinter (their items stay on the floor, takeable), carton stacks collapse.
Zombies (and corpses) tear where shot: wounds live in the body's bind space so they stay on moving /
ragdolled bodies; clothing rips show skin and flesh. Shots passing close knock loose pickups about
(never destroyed).

Lighting is deliberately mixed: public areas are lit, service
corridors/closets/back rooms are often dim or dark — use the flashlight (F).

Stacked levels (iteration 08, `src/gen/levels.ts` + `levelGen*.ts`): every station is a stack of
real storeys sharing one world: the MAIN level (platforms, track beds, halls), an UPPER concourse
(decks over the platforms, crossover bridges over the tracks, light wells with railings, a security
control room and staff room, catwalks on island stations) and a LOWER service level beneath the
platforms and track beds (a service crossing and gallery with pump / electrical / maintenance / cable
rooms). Enclosed stair cores join them (0.17 m risers × 0.28 m treads, 1.2 m landings, handrails,
"UPPER CONCOURSE ↑" / "SERVICE LEVEL ↓" signs) so you can loop platform → bridge → other platform →
service crossing → back. Free space is the union of each level's open columns: walking, crouch
headroom, jumping, bullets (a slab stops them; a light well doesn't), sight, hearing (muffled through
slabs), zombie paths, dropped items, debris and loot all resolve the right storey. No fall damage.
Interchange line 2 stays single-level; single-island stations' service level is a dead-end branch.
The old iteration-05 underpasses beyond the tunnel mouths are replaced by the service level.

Walls (iteration 08, `src/world/wallDetail*.ts`): each zone has its own finish and decay — platform
tile with accent bands, station-name tablets and pilasters; tunnel concrete with seepage, cables and
niches; service block with conduits, switch boxes and kick scuffs; raw lower-level walls with pipes
and heavy damp — plus missing-tile patches, spalls, cracks, stains, repairs and a few genuinely broken
sections showing blockwork and rebar (never near a doorway; collision unchanged).

Props (iteration 08, `src/gen/compose.ts`): placed as clusters anchored to walls, columns and doors
(waiting spots, security posts, maintenance bays, pump skids, evacuation luggage …) with clear walkways,
landmarks at the end of sightlines and deliberately sparse halls. Retail shelves, racks and coolers
carry separate 3D filler stock (cans, bottles, boxes, bags, magazines …; `src/world/shelfStock*.ts`)
instead of printed product pictures. Filler is physical scenery, not loot (no highlight, no [E]);
shoot it and it tumbles (`src/physics/fillerStock.ts`); real loot keeps its highlight and stays takeable.

Vertical traversal (iteration 05): the track bed is walkable: step off the platform edge (1.15 m drop, no fall
damage); yellow steel rescue ladders on the platform faces (near each platform end, ≤ ~34 m apart,
opposite each other on two-sided beds; hazard marking on the edge above) get you out — look at one
and press **E** ("Climb ladder" / "Climb down ladder"); **Space** or **S** lets go. Striped
barricades at the tunnel mouths end the walkable bed. Zombies follow: they take the stairs, drop
into the track bed after you (they cannot swipe down from the platform) and climb out by ladder.
Data: `layout.traversal` (stair flights, ladders; `gen/traversal.ts`), `layout.levels` /
`levelLinks` / `rails`, per-cell floor heights + stair ramps + ladder nav links in `gen/grid.ts`
(level-aware `PathFinder`).

Rendering note (iteration 08): on a software WebGL rasterizer (Mesa llvmpipe, SwiftShader …) texture
anisotropic filtering is capped at 1 (`src/render/softwareGl.ts`) — CPU anisotropic filtering on the
world-mapped railings/conduits stalled such browsers for minutes per frame. Hardware GPUs are unchanged.

Rendering (iteration 13, `src/render/backend.ts`): three r186 `WebGPURenderer` with TSL node materials. On a browser
with WebGPU the shaders compile to WGSL; otherwise three's WebGL 2 backend runs the same node graphs as GLSL ES 3.0. The
backend that actually initialized is shown on the title screen and HUD ("WebGL2 fallback" plus the reason) and in
`__LL.gpu()`. The fog (`src/render/atmosphere.ts` medium, `src/render/volumetric*.ts` passes) is a world-anchored,
seeded medium that translates with the station's draft (no re-rolling, so a room looks the same when you come back
at the same fog time), with clear / normal / dense areas, lit in the march by the baked fixture light field, the
flashlight cone (shadowed, follows the battery) and burning flares.

Loading (iteration 14, `src/render/warmup.ts`, contract in [docs/rendering-warmup.md](../docs/rendering-warmup.md)): before
the first station, after New station / Retry and after a quality change, a "Preparing graphics" step compiles the
station's materials (discovered from the scene, one per three cache-key group, in the real render target), the
viewmodel pass, effect pools / thrown-flare prototypes and the torch shadow variants, so the first minute of a level
does not stutter on shader / pipeline compilation. The bar counts real work; it says Ready only when that work is
done (or says it is partial / failed). `?warmup=off|view|full` overrides (software rasterizers default to `view`).

Goal (campaign): "Scavenge for resources. Return to the train when done." There is no kill goal; the Reactor's objective is
to restart it. On death a campaign run offers "Load last save" (task campaign-polish-20261103: the active slot's latest valid save,
loaded through the same path as the menu's Continue; nothing is saved or erased on death; without a valid save the button is disabled
and says why) or "Main menu", which leaves after a confirmation naming the last autosave. Legacy dev runs keep "New station" (fresh
seed) as well.

## Campaign (task campaign-foundation-20261102)
- **Network** (`src/campaign/network.ts`): New game rolls a seeded, subway-like network of 40 stations on printed lines
  (interchanges, branches, sometimes a ring). It has 39 ordinary stops split by largest remainder of 80 / 10 / 10, giving
  31 Subway (including the start), 4 Office and 4 Mall (`ORDINARY_WEIGHTS` in `src/campaign/types.ts` is configurable), plus
  exactly one Reactor several hops from the start. A station (`StationId`, e.g. `st-07`) is not a level type: each node has its
  own seed, gear roll, section memories, Retry scope and printed name (shown on its signs, the HUD, the map and saves).
- **Maintenance Route** (task campaign-polish-20261103, lane MAP; `addMaintenanceRoute` in `src/campaign/network.ts`): the
  Reactor always has a bypass. One ordinary Subway stop of the 31 sits beside the Reactor, printed "Maintenance Route", on a
  dashed service line from a station before the Reactor to the station(s) beyond it, so the Reactor never gates the rest of the
  network. The console's reveal at the approach shows it next to the Reactor. The Reactor is never a terminus. Saves made
  before this get it once on load (`upgradeCampaign` in `src/campaign/discovery.ts`): one station that save never showed is
  moved and renamed. Ids, types, seeds, visited / known, the pending journey and every remembered world stay unchanged.
- **Map and console** (`src/ui/paperMap.ts`, `src/world/trainConsole.ts`): the map is a crumpled paper sheet (Codex
  source art, `assets/textures/paper-map.jpg`) with code-drawn lines and names. New game shows only the starting stop.
  The driving console in the train's front cab (E) opens it and reveals the current stop and its neighbours. The Reactor
  appears only once discovered. Pick an adjacent stop, or any station on the map that the printed (known) track reaches: one
  continuous journey along the cheapest route (fewest stops; a tie prefers stations you have visited, then goes by id; the Reactor
  is never passed before you have been there). The card names the stops on the way and shows one tank per stop. Nothing on the way
  is loaded, looted, revealed or marked visited. Confirm to travel. The departure burns the whole route's fuel at once (one standard
  tank per stop); if the train is short, the engine stalls and says how many tanks the route needs and how many the train has. The details card sits
  beside the selected node; each stop prints its type icon (Subway, Office, Mall, Reactor, Maintenance Route). Typing `1337` while the map is open reveals
  everything and allows travel anywhere for the rest of that run (it is saved with the run; separate from the Lockbox code).
- **The journey** (`Game.travelToStation`, `src/world/trainRide.ts`): the occupied train closes its doors and pulls into a dark
  transit tunnel. You can walk, look and change gear inside while the old station is torn down (every change kept in its
  memory) and the next one is generated (when the destination is confirmed) and built in small slices between frames
  (`src/core/pacedBuild.ts`, `Game.buildSectionPaced`), then compiled in the background, with jostle. The car then emerges
  at the new platform and stops. There is no static loading screen. A destination that cannot be generated twice sends the
  train back. The car always runs cab first and STRAIGHT along its own track (`src/world/trainRideRoute.ts`): it leaves
  through a ride portal at the front end of its track and comes into the next station through the portal at the end behind
  the parked car, so it never reverses (`src/world/ridePortal.ts`, `ridePortalRuntime.ts`, `ridePortalView.ts`). A portal is
  a steel gate in a closed bed end (it swings open for the car and shuts behind it), or a breach at the end of a station
  tunnel's first straight. Beyond the portal the car is in the ride tunnel (the transit tunnel continuing from the portal);
  the station hides what it would draw inside that tunnel and its baked light reads zero there, so the car never passes a
  wall. The station hands over to the transit, and the transit to the next station, only with the portal 52 m of tunnel
  murk behind or ahead of the car, so nothing in view changes. The transit is very dark, with red signals passing
  about every 110 m. The only light is the car's own lights and the flashlight (F also works between worlds). The ride sound
  uses existing Sound Lab beds and cues: a rumble and an air loop blended by speed, rail-joint clacks and the brakes. It stops
  at the platform and goes quiet in menus.
- **Autosaves** (`src/save/`): the new game, the departure (with the journey pending) and the arrival each write the active slot.
  Continue resumes the last slot. A save taken mid-journey (a crash in the tunnel) resumes that journey once, arriving at
  the destination. There are three slots (`terminal-state.save.slot{1,2,3}.v1`, compact checksummed JSON, atomic writes,
  validated on load). The menu offers per-slot Export (a download) and Load save (imports a file into a chosen slot after
  an explicit confirm). Three heavily played slots measure about 42 % of a 5 MiB origin quota (`tests/save-budget.test.ts`
keeps them under 70 %).
  A quota error is reported, never silently dropped.
- **Win**: at the Reactor, restarting it opens the habitable-surface ending, and reaching the surface
  (`reactor.state.ending.surfaced`) completes the run once. Builds without the surface ending fall back to the restart itself.
- **QA**: `node tools/qa/campaign-loop-check.mjs` is one serial spot check (menu, new game, slot, map, journey, Continue).
  On software GL (llvmpipe) the arrival drive outgrows the 6 GiB guard, so the check closes the page during the arrival, like
  a crash mid-journey, and proves the departure save's once-only resume on a fresh page.

## Main menu, settings and URL parameters (task campaign-foundation-20261102, lane MENU)
Every load opens the **main menu** (`src/ui/mainMenu.ts`) beside a real-time diorama (`src/world/menuScene.ts`: the ruined
city in green fog, surface tracks, the player train; render only, no world state). Boot builds the renderer and the diorama
first, then loads the game files in the background (a line at the foot of the menu); New game / Continue wait for them. No
level is built before New game / Continue. Settings (FOV 60-100, master volume 0-100 %, mute, quality, render resolution, and train
sway 0-100 % = the moving train's jostle on the view, 0 = off) and the Controls' input preferences (mouse sensitivity, invert X / Y:
the main menu's Controls view and the pause menu's Controls section, above the key bindings) persist in one record in `localStorage` (`terminal-state.settings.v1`, `src/ui/settingsStore.ts`); the pause menu edits
the same store.

Campaign polish (task campaign-polish-20261103, lane MENU): the side column lists only Continue / New game / Load save / Settings /
**Controls** / Dev start; every submenu opens as a centred dialog over a light dimmer (Esc / Back step back). Controls shows the
game's actual bindings (`CONTROLS` in `src/ui/hud.ts`) plus a one-line hint about the two `1337` developer codes. Save slots are
one grid row each (slot, name + metadata ellipsized, actions), stacked on narrow screens. The title camera opens at the framing its
slow orbit reached about 25 s in (`MENU_SCENE.orbit.startAt`) and keeps orbiting from there. The loading screen (New game /
Continue / Load save; never the train journey) is opaque and shows the destination's location name over a small decorative subway
map with the line `The Reactor .... Restart the Reactor` under it (`src/ui/loadingMap.ts`). The map is a fixed drawing, not the
campaign's network: its lines, branches and stations fill in with the load's own progress (props, textures, graphics warm-up) and
it is complete only when the load is. It replaces the progress bar; nothing waits for it. The screen stays up until the first
play frame is drawn.
- **Fog, shadows & anti-aliasing** (the stored `quality`, High / Low): exactly the volumetric fog march (High ½ of the drawing
  buffer up to 960 × 540, 24 steps; Low ¼ up to 480 × 270, 14 steps — `ATMOSPHERE_QUALITY` in `src/render/atmosphere.ts`), the
  flashlight's shadow map (1024 / 512 px), the scene pass MSAA (4× / none; the fog and the MSAA only while the volumetric pass
  runs) and the native pixel-ratio cap (min(DPR, 1.5) / min(DPR, 0.85)). Nothing else (no light, geometry or art change).
- **Render resolution**: a 25-100 % slider (1 % steps) = a linear width-and-height scale of the canvas over that DPR-capped
  native buffer; not a quality preset. Stored as the fraction, so the former Native / Half / Quarter (1 / 0.5 / 0.25) read as
  exactly 100 / 50 / 25 %; other values round to a whole percent and clamp. A drag applies once it settles or on release. Dev deep links (`?level=`, `?seed=` …) never start a game: they pre-fill the menu's **Dev start** picker,
which starts a normal new game at that level.

QA automation: `?qa=1` keeps the old automation contract — the menu waits behind the loading card while a **scratch run**
of the URL's level / seeds is prepared (never saved, no slot), then `__LL.state() === 'title'`, `__LL.ready()` is true and
`#btn-start` ("QA quick start", the menu's first item) enters it. `?qa=1&qaPrebuild=0` shows the real menu (diorama,
settings, slots) with the QA hooks (`window.__menu`); there `#btn-start` builds the scratch run when clicked.

## URL parameters (optional, session-only)
- `?seed=CODE` — replay a station code shown in the pause menu (debug/share): the menu's Dev start (Subway seed).
  Reloading without it always makes a new station. (`?officeSeed=` / `?mallSeed=` / `?reactorSeed=`, `?level=` likewise.)
- `?quality=low` — the Low "Fog, shadows & anti-aliasing" setting (the 0.85 pixel-ratio cap, the low volumetric-haze preset, the
  512 px flashlight shadow, no MSAA; no light is removed). Session-only: it overrides the stored setting without changing it.
- `?warmup=off|view|full` — loading-screen graphics warm-up scope (iteration 14; default `full`, `view` on software GL).
- `?renderer=webgl2` — force WebGPURenderer's WebGL 2 fallback backend (iteration 13; default: WebGPU when available).
- `?fog=off|low|high` — override the volumetric haze (iteration 06, `src/render/volumetric.ts`):
  `off` renders exactly like release 5 (no haze, no flashlight shadow map).
- `?perf=1` — start with the performance overlay shown (for browsers that keep Ctrl+Shift+P for themselves, e.g.
  Firefox's private window).
- `?qa=1` — **test automation only**: exposes read-only `window.__LL` state + a camera aim helper
  and lets the game run without pointer lock (automated browsers cannot grant it). It does not
  change health, ammo or AI.
- Pistol start (2026-10-28): the user's `pistol.glb` is in the manifest and `PISTOL_ART_READY`
  (`src/weapons/pistol.ts`) is true, so normal play starts with the pistol (15 + 45 × 9 mm) and the
  rifle and shotgun are seeded map finds. The old `?devpistol=1` flag is redundant; the internal box
  placeholder (`pistol-dev-placeholder`) is never used while the real model is loaded.
  `__LL.weaponFinds()` lists the station's weapon pickups (position, level, spawn distance).
- Iteration 15: the rifle's **see-through red-dot optic** is back on the user's rifle model (aim down sights to look
  through it: coated glass, fine duplex and the red dot on the aim line, eye relief 0.105 m as in iteration 04). The
  model's sight is one solid mesh, so a runtime rear aperture + depth mask (`src/weapons/optic.ts`, measured from
  `rifle-user.glb`, no asset change) cuts the view through it; it is compiled by the loading-screen warm-up. **Recoil**
  is 1.5x for every gun (camera kick + viewmodel kick; `RECOIL_SCALE` in `src/weapons/weapons.ts`); recovery, damage,
  spread and fire rate are unchanged. The fog drifts at half the iteration-13 speed.
- Weapon finds: the guaranteed spawn-side shotgun is gone. Weapons you do not start with are seeded
  map finds (0-2 copies each, ~95 % of stations have at least one) in back-of-house rooms or platform-end
  work zones on any storey, ≥ 25 m from the spawn, each with matching ammo (`src/gen/weaponFinds.ts`).
- Pistol audio: the pistol shot is the existing Sound Lab rifle-shot clips (`assets/audio/rifle-shot-*.mp3`)
  replayed at a higher playback rate and slightly lower gain; its reload/dry cues reuse the rifle magazine
  and dry-fire Sound Lab clips. It is a reused, pitched rifle cue, not a dedicated pistol recording.
- Office Space overhaul (task office-overhaul-20261030): floors 2–8 are leased to **20 fictional companies**
  (`src/gen/office/companies.ts`; seeded assignment `tenants.ts` — distinct per floor, sometimes one company on two floors;
  the lobby stays neutral with a tenant directory). Each company carves its own rooms (trading floor, law library, labs, game
  lounge, gym, clinic, studio, test kitchen, archive and vault, atelier…), gets a reception with a logo wall, its palette /
  finish, styled signage, two signature Meshy T2.5 props (`src/assets/companyAssets.ts`, lazy per layout) and a loot tilt within
  the same scarcity. Executive suites have dedicated furniture, server rooms hold rows of racks, plants never narrow a corridor
  below 1.5 m. Office storeys use office finishes (`src/world/officeArch.ts`) and the exterior sits in heavy green height fog
  (`src/world/officeAtmosphere.ts`; `__LL.exteriorFogTune({...})`). The station joins the lobby through a broad **transit hall**
  (fixed stair between two stopped escalators, `src/gen/office/transit.ts`); a caged **ladder** in floor 8's roof-access room
  climbs to the **roof** (level 9, `roof.ts`; enemies never use it). The **elevator** (`src/world/elevator.ts`) is a full-size car:
  aim at any car / hall button within 1.7 m and click or press E (no floor list; the click never fires). **Backpack**: slot 6,
  held in front, click to set down, tap E opens a grounded bag, hold E 0.5 s wears it. **Grenade slot** "G": flares stack to 10,
  hold G to throw. **Stall doors** open with E and toilets sometimes hold a finite find (`src/world/stalls.ts`). Enemy **vocals**
  are gated by walking distance from the player (`src/ai/vocalReach.ts`; ≤ 32 m of route, ≤ 3 at once); combat sounds are not.
  QA hooks: `liftButtons()`, `liftPress(id)`, `goRoofLadder()`, `goTransit(end, lane)`, `bagHoldE(s)`, `flareGive(n)`,
  `stallOpen()`, `officeArch()`.

## Tooltips, the network map's opening view and Subway map kiosks
Task studio-ui-subway-maps-20261108-074144-01.
- **Tooltips.** Menus and item grids use the game's own tooltip (`src/ui/tooltip.ts`), not the browser's `title` tooltip. That
  covers the inventory, a grounded backpack, the Lockbox, the car trunk, the network map and the menus. It closes with the panel,
  even when the cursor has not moved.
  - Mark an element with `data-tip` (and optional `data-tip-body` / `-hint` / `-tone`), via `tipAttrs()` or `setTip()`.
  - Item text comes from `src/ui/itemTip.ts`.
- **Network map.** The train console's map opens on the whole sheet, so the legend and the size of the network are in view. F still
  zooms to the known stations; Home or "Whole map" goes back. Unknown stations still never print.
- **Subway map kiosks.** "STATION MAP" pylons stand on platform 1 by the arrival and in the ticket halls and concourses (up to 4).
  Each shows its own storey's public plan, turned the way you face, with YOU ARE HERE. E at the panel reads it up close; E again or
  walking away closes it. They are procedural, with no model to load. See `docs/prop-affordances.md`.

## Armor
Task studio-general-armor-20261107-231448-01 (`src/player/armor.ts`).
- **One pool.** Worn gear with armor adds to one armor value. It is not tied to a body part. Gear in pockets, bags, the
  Lockbox or cargo adds nothing. A **pip** is 2.5 %. The armor vest gives 4 pips (10 %) and the hard hat 1 pip (2.5 %). The
  pool is capped at 80 %.
- **HUD.** Blue circular pips sit above the health bar, ten to a row spanning its width (a full row is 25 %). Further rows
  stack on the first and overlap it by 25 % of a pip. The display moves in half pips (a half-filled circle), rounded down;
  the stored value keeps its fraction.
- **Enemy damage only.** An enemy's hit, from any enemy type, loses the pool's share of its damage, whatever it hits. The
  enemy damage multiplier applies first. Falls, toxic gas and starving or dehydration never meet the armor.
- **Injury save.** The game rolls an injury from an enemy hit as for an unarmored player. If it would injure you, a second
  roll with the pool as its chance cancels it. Hard landings get no save.
- **Wear.** An enemy hit the armor reduced costs one worn armor item, chosen at random, a quarter pip (0.625 %); two hits
  cost half a pip. The worn value stays with the item: take
  off, drop, Lockbox, cargo and saves keep it. Old saves load undamaged.

## Gas mask, filters and breached office windows
Task gasmask-breach-20261030. All balance values are first-pass constants: `GAS_MASK` (`src/gear/gasMask.ts`), `MASK_LOOT`
(`src/gen/maskLoot.ts`), `WINDOW_BREACH` (`src/world/windowBreach.ts`) and `GAS` (`src/world/gas/field.ts`).

### Gas mask and filters
- **Items:** the **gas mask** is gear for a new mask slot (Tab: gear panel). Wearing it in that slot does not put it on your
  face. **Q** puts it on (0.6 s) or takes it off (0.45 s); Q no longer cycles to the last item.
- **The Q cell** sits at the left of the hotbar. It shows the mask, ON / OFF, the fitted filter's charge and your spare
  filters.
- **Without a mask:** Q is refused with a message, and nothing is created.
- **While it goes on or off:** you cannot fire, aim, swing, throw or start a use. Your weapon and slot do not change, and a
  running reload finishes.
- **Ignored or interrupted:** Q does nothing mid-swing, mid-transition or while a grounded bag is open. Pausing, death,
  travel, Retry and New game stop a transition with the mask off.
- **Filters:** a filter lasts **150 s of play while on the face**, whether or not there is gas. The mask draws a spare by itself
  from your quick slots and pockets (never from a worn backpack's contents).
- **Warnings:** low at 20 %; empty with no spare. **A mask on your face with an empty filter does not protect you.**
- **Charge belongs to the mask:** taking it off, re-wearing it, swapping masks, dropping it, travel and Retry never refill it.
- **Loot:** masks and filters are level-wide floor finds with their own rolls. The Office has 1–2 masks and 2–5 filters; the
  Subway has 0–1 masks and 0–2 filters. A found mask carries 35–75 % of a filter. There is no starter mask.
- **Art:** the pickup and icon reuse the shipped zombie-outfit gas mask (`outfit-gasmask-t25.glb`). It was delivered and
  review-accepted in the authorized Meshy T2.5 model replacement. Its derivative record still says approved: false, not game-ready
  and no licence clearance; those flags are unchanged, and delivery acceptance is not legal clearance. The filter is a small
  procedural canister.
- **Mask view (what you see wearing it):** you look out through the real mask's visor (`src/gear/maskView.ts`). It is a local
  viewmodel derivative of the same shipped outfit mask, built at load time. The visor glass is cut out, so its own rubber rim,
  nose bridge and inner walls frame the view; the inner glass sheet becomes a tinted lens. The lens is clear in the middle and
  darker toward the rim, with a little condensation low in the corners. The strap pieces are dropped, and a small dark cowl
  covers the gaps past the mask's upper edge.
  - **Rendering:** the view is drawn in the existing viewmodel overlay pass, fixed to the face. The HUD, crosshair and hints stay
    on top. It is compiled on the loading screen with the held items, so the first Q does not stutter.
  - **Q:** the mask comes up from below onto the face and goes back the same way (same 0.6 s / 0.45 s timings).
  - **Aiming:** your eye moves toward the glass, so the rim recedes and the lens clears a little. The rifle optic stays in the
    clear middle.
  - **Filter warning:** the lens rim glows faint amber when the filter is low and pulses red when it is empty. The Q cell is
    unchanged.
  - This replaced the earlier CSS / SVG camera overlay. Nothing new was generated, and the provenance flags above still apply.

### Breached windows
- **Which panes:** only the Office's exterior window panes (and the Skyways glazing, below). The entrance, shop / cooler / prop
  glass, elevator glass and the roof are excluded.
- **Health:** a pane has the health of **3 pistol bullets**: `PANE_MAX_HP` = 3 × the pistol's damage in the weapon table
  (17 → 51). It is derived, so a pistol retune moves the panes with it.
- **Damage:** every bullet or pellet that reaches the glass takes off its real damage once, the same damage `Game.fire`
  deals there, including range falloff. The pane cracks on its first damage and shatters at full damage, with a glass burst
  and the break-glass cue.
- **Shots to break it at close range:**

  | Weapon | Damage per hit | Shots to break |
  |---|---|---|
  | Pistol | 17 | 3 |
  | Rifle | 24 | 3 (2 rounds do 48) |
  | Shotgun | 15 per pellet | 4 pellets: a centred blast breaks it |

  A blast that lands only some pellets on the pane counts only those. Misses, frame hits and blocked pellets count nothing.
  The glass cue plays once per pane per trigger pull.
- **Never damaged:** by the knife; panes that were broken or boarded at generation. A pane that was cracked at generation
  starts at full health.
- **What blocks a shot:** whatever is nearer than the glass takes the bullet (enemies, props, corpses).
- **Boundary:** a broken pane is never a way out; collision is unchanged.
- **Persistence:** pane damage and breaks persist in the one Office world and across Subway↔Office travel. The lane
  `office.windows` stores them as v2 `damage` records. An older v1 hit counter converts to `hits × 51 / 3` damage, and a broken
  pane stays broken. Retry restores the level-entry state, and New game resets them.

### Skyways glazing
Task studio-skyways-level-20261106-054448 (lane GAS): `src/world/skywaysWindows.ts`.
- **Which panes:** every glazed span of `layout.skyways.windows`: the bridge side walls and the building facades on the street
  and +15 storeys. Health, damage, cues and collision are the Office's.
- **No inert broken glass:** a pane is intact or cracked (breakable), or broken because it is breached (a gas source). Boarded
  columns stay boarded.
- **Pre-breached bridges:** spans marked `breached` start broken. On the first visit their gas is seeded as 90 s old breaches,
  so it has already spread across the bridge when you arrive, and you need a mask to cross. A revisit restores the saved state
  instead of seeding again.
- **Persistence:** the lane `skyways.windows` (per station, the same v2 record as `office.windows`). Retry and New game work as
  in the Office.
- **Contact breaks:** `game.gas.breakPaneNear(level, x, y, z, radius)` breaks the panes within reach (a car hitting the glass)
  exactly like a bullet break.
- **Gas:** the same field, exposure, mask rules, HUD and green fog as the Office. The field covers the whole complex
  (`layout.skyways.exterior`).

### Infectious gas
- **Spread:** a breach lets the green outdoor gas flow in. It fills that room over ~25–40 s, starting at the window, and
  spills a little through its real openings. Spill stays under 0.15 about 3.5 m past a doorway.
- **Model:** a per-storey diffusion field on the 0.5 m level grid. Walls, other rooms and other storeys block it. A pool
  region (the breach room within 10 m) holds the gas; everywhere else it decays quickly. Concentration is capped at 1, so
  overlapping breaches never stack.
- **Rendering and damage share the same field.** The volumetric fog draws it as a green term (WebGPU and WebGL 2). When
  volumetrics are off, a screen haze is shown instead.
- **Damage:** without protection it costs up to **8 hp/s** above 0.12 concentration (about 6 hp/s in a filled room). There is
  one damage calculation per frame, and gas never causes limb injuries.
- **HUD:** shows **TOXIC GAS** with a hint, or **FILTERING**.
- **Cough (audio feedback):** while gas is hurting you unprotected (window gas or the toxic roof), the player coughs
  (`src/audio/cough.ts`).
  - **Timing:** the first cough comes 0.15–0.4 s after the damage starts. After that it plays one cough at a time, with a
    2.4–4.2 s gap after each and at least 1.2 s of rest, so going in and out of gas or several sources never stack coughs.
  - **Never** while a working mask protects you, in clean air, in menus, while loading or when dead. Leaving play stops a
    cough mid-way.
  - **Clips:** Sound Lab takes `cough-*.mp3`, chosen so the same take never plays twice in a row (provenance
    `assets/derivatives/audio-cough.json`).
- **Cost:** the field ticks at 10 Hz on its active cells and only on gassed storeys, which go to sleep once settled. Each
  gassed storey uploads one R8 texture layer.
- **Not modelled:** intact windows and the green sky are harmless, and there is no ambient damage indoors or on the street.

### Toxic roof
- **The deck is outdoors.** On the Office roof the outside atmosphere reaches you through the same exposure as breach gas:
  the same mask protection, HUD tag, hint and damage.
- **How much:** concentration = `GAS.ROOF_OUTDOOR_C` (0.6) × the roof's outdoor weight. That weight is the same `roofBlend`
  (`src/world/roofAir.ts`) that turns the roof fog green. It is 1 on the deck, 0 indoors, and ramps as your head comes up
  through the ladder hatch. Unprotected, that is about **4.4 hp/s** on the deck.
- **Protection:** a worn mask with filter charge protects you. A mask that is off, has an empty filter, or is missing does
  not.
- **Indoor floors** under the roof are never affected. Your exposure is the larger of the breach gas and the outside air,
  never their sum.
- **For audio:** `gas.exposure.source` reports `'field'`, `'outdoor'` or `null`.

### Roof reward
The roof cache (a first-aid or trauma kit plus an ammo box) now has a **roof find** beside it. This is one non-starter long
gun with a box of its own ammo (2 in 3), or an armor vest or hard hat (1 in 3). It is placed once per Office run, verified
reachable on the deck after placement, and never re-rolled by Retry or revisits. See `docs/loot-tables.md` "Roof find".

## Beyond the Station (Track 2)
The track beds continue past the old black end walls into finite concrete tunnels (30–110 m, up to two bends). Each tunnel
ends in a physical cap: a rubble heap, a bulkhead or a gate. Island-ends and express stations have no room past their bed
ends, so instead they get service hatches in the outer bed wall.

On 20 % of levels (one seeded roll per level, every level type: `BTS_AREA_CHANCE`), up to two seeded service annexes are reached
through a side door or a hatch; the other levels keep only their tunnels. Each is about a quarter of the
station's walkable area, at track-bed height. They are dark (untinted, mostly dying or dead fixtures), with pipes and
conduits on board-formed concrete. Steam from the vents is visual only and never hurts. Each annex has:
- **loot:** a deep stash or two, picked-over shelves, and nothing guaranteed;
- **enemies:** 3–5 drawn from the level's own family pool;
- **memory:** like every other room, nothing refills.

Graffiti arrows and tags appear only on routes that lead to an annex. The bed ladders are the way back up.

Most balance values live in one config block per subsystem:
- tunnels and annexes: `TRACK_EXT` (`src/gen/trackExt/config.ts`);
- annex enemies: `SERVICE_CONTEXT` (`src/ai/spawnTables.ts`);
- annex loot: `ANNEX_STASH` / `ANNEX_PICKED` / `ANNEX_FLOOR` (`src/items/lootTables.ts`).

The reusable interface for future track-bearing levels is in [docs/track-extensions.md](../docs/track-extensions.md).

## Performance overlay (Ctrl+Shift+P)
Off by default; Ctrl+Shift+P toggles it in any state without pausing the game (held keys toggle once; the shortcut never
reaches game input). Browsers or OSes that reserve the combination (e.g. Firefox: new private window) never deliver it to
the page — use `?perf=1` there. `src/debug/` (`overlay.ts`, `frameHistory.ts`, `gpuTimer.ts`, `browserSignals.ts`):
- **FPS / Frame ms**: animation frames per second over the last second, and rAF-to-rAF intervals (now / avg / p99 / max)
  over the last ~6 s (360 frames). **Spikes** counts frames over 33 and 50 ms.
- **Graph**: one bar per frame, newest right, never smoothed; colour by ≈60 / ≥30 / <30 fps, dashed 16.7 / 33.3 ms lines,
  scale = the smallest of 33 / 50 / 100 / 250 / 500 / 1000 ms holding the 95th percentile, longer spikes drawn clipped with
  a white cap (their value is the max). Dark base = the game's own main-thread time in that interval; a light tick = GPU
  time where measured. Background-tab / suspended intervals (the page went hidden, or the interval is > 3 s longer than the
  game's own work in it) are grey gaps excluded from the statistics; a freeze inside the game's frame (e.g. first-sight
  shader compiles) counts as a stutter however long.
- **Game CPU ms**: this game's frame callback on the main thread (update, render submit = CPU command encoding — not GPU work).
- **GPU ms**: summed render-pass time from WebGPU `timestamp-query` or WebGL `EXT_disjoint_timer_query_webgl2`, resolved
  asynchronously (one resolve in flight) and only while the overlay is shown; otherwise "n/a" with the reason.
- **System CPU**: the Compute Pressure API's coarse state where available. System CPU % and GPU utilization % are not
  exposed to web pages and are never estimated.
- **Draw calls / Triangles**: three's per-draw counts after frustum culling, summed over every pass of the frame (flashlight
  shadow map, scene, fog / post quads, viewmodel) — submitted, not unique visible triangles. **GPU memory**: three's
  estimate of the resources it tracks. **Long frames** (Long Animation Frames API) and **JS heap** where the browser has them.
- **Backend**: what actually initialized (same source as the title badge). With `?qa=1`, `window.__perf.snapshot()`
  returns the numbers and row texts.

## Layout
`src/gen` deterministic generator + grid/A*/LOS (pure, unit-tested) · `src/world` mesh building,
materials, light pool, pickups, effects (iteration-07 generated props: `src/gen/props07.ts` registry + `props07Dress.ts` placement, models lazy-loaded per station by `src/assets/loader.ts` PropModelLibrary) · `src/weapons` data-driven `WeaponDef`s + shared
fire/reload state machine + viewmodel · `src/items` item catalogue + inventory · `src/ai` zombie
brain (pure) + skinned actor · `src/physics` cannon-es ragdolls + pooled casings · `src/player`
movement + survival (hunger/thirst) · `src/ui` HUD/inventory · `src/audio` procedural spatial WebAudio ·
`src/damage` material damage / breaking (craters, debris, per-instance prop damage, zombie wounds) · `src/game.ts` orchestration. Runtime assets: `public/assets/` (derivatives only, provenance in
`public/assets/derivatives/`).
