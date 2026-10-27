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
storage, crew/utility rooms, closets) — 11–16 rigged zombies that fall as
physics ragdolls, physical casings, both existing guns, a five-slot hotbar + backpack, visible
searchable loot, food/drink with slow hunger/thirst (both start at 80%), death and restart. Nothing is
saved: no localStorage/IndexedDB; settings last for the session only.

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
WASD move · mouse look · Shift sprint · Space jump · C crouch · left click fire/use · right click
aim · R reload · E pick up / open / take aimed item / take all / pry vending / climb ladder (Space lets go) · 1–5 / wheel quick slots · Q last item · Tab or I inventory · H quick
heal · G drop held item · F flashlight · M mute · Esc pause. Desktop keyboard + mouse only; touch
is not supported.

Crouch: **C** (iteration 05: back from Ctrl, which collided with the browser's Ctrl+W) — tap to
toggle; hold longer than 0.3 s to crouch only while held. Crouched = half speed, ~30% less recoil and
20% tighter spread; you cannot sprint or jump from a crouch — Space, or Shift while moving forward,
stands you up first (if there is headroom). Pausing while holding C leaves you crouched (tap it to
stand). The Fullscreen button (title and pause menu) is optional plain fullscreen.

Inventory (Tab / I, iteration 04): drag and drop with the mouse — drop an item on another quick
slot or backpack slot to move it (the same item stacks up to its limit, a different item swaps,
Shift-drag splits off half a stack); the HUD quick-slot bar under the screen also accepts drops;
drag it **outside the inventory panel to drop it** on the floor in front of you. Click selects an
item (details, Use / Equip / Drop buttons, 1–5 assigns it to a quick slot); double-click or
right-click uses food / drink / medicine (right-click equips a gun); keyboard: Enter selects the
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
items on the interior shelves/floor. Aim at an item + E to take it, or E on the open body to "Take
all". Shelves, kiosk counters/back shelves and tables hold visible items too; vending machines need
"E — Pry open" (~1 s) and their stock spills out in front. Contents are rolled once per station
(seeded, finite, never rerolled); anything that does not fit stays where it is. Empty containers
say so ("searched — empty").

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
or in the inventory double-click / right-click it (or select + Eat/Drink).

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

Vertical traversal (iteration 05): underpasses really go under the tracks — from each platform end
a stair leg (top landing, two flights of ~0.17 m risers × 0.28 m treads with a landing, handrails)
descends ~3.9 m to a crossing passage beneath the track line (≈2.5 m clear) and climbs back up to
the other platform. The track bed is walkable: step off the platform edge (1.15 m drop, no fall
damage); yellow steel rescue ladders on the platform faces (near each platform end, ≤ ~34 m apart,
opposite each other on two-sided beds; hazard marking on the edge above) get you out — look at one
and press **E** ("Climb ladder" / "Climb down ladder"); **Space** or **S** lets go. Striped
barricades at the tunnel mouths end the walkable bed. Zombies follow: they take the stairs, drop
into the track bed after you (they cannot swipe down from the platform) and climb out by ladder.
Data: `layout.traversal` (stair flights, ladders, underpasses; `gen/traversal.ts`), per-cell floor
heights + stair ramps + ladder nav links in `gen/grid.ts` (`floorAt`, height-aware `PathFinder`).

Goal: clear the station (kill every infected). Death → "New station" (fresh seed) or "Retry this
station" (same seed, this session only).

## URL parameters (optional, session-only)
- `?seed=CODE` — replay a station code shown in the pause menu (debug/share). Reloading without it
  always makes a new station.
- `?quality=low` — lower resolution and fewer dynamic lights (also the low volumetric-haze preset).
- `?fog=off|low|high` — override the volumetric haze (iteration 06, `src/render/volumetric.ts`):
  `off` renders exactly like release 5 (no haze, no flashlight shadow map).
- `?qa=1` — **test automation only**: exposes read-only `window.__LL` state + a camera aim helper
  and lets the game run without pointer lock (automated browsers cannot grant it). It does not
  change health, ammo or AI.

## Layout
`src/gen` deterministic generator + grid/A*/LOS (pure, unit-tested) · `src/world` mesh building,
materials, light pool, pickups, effects (iteration-07 generated props: `src/gen/props07.ts` registry + `props07Dress.ts` placement, models lazy-loaded per station by `src/assets/loader.ts` PropModelLibrary) · `src/weapons` data-driven `WeaponDef`s + shared
fire/reload state machine + viewmodel · `src/items` item catalogue + inventory · `src/ai` zombie
brain (pure) + skinned actor · `src/physics` cannon-es ragdolls + pooled casings · `src/player`
movement + survival (hunger/thirst) · `src/ui` HUD/inventory · `src/audio` procedural spatial WebAudio ·
`src/damage` material damage / breaking (craters, debris, per-instance prop damage, zombie wounds) · `src/game.ts` orchestration. Runtime assets: `public/assets/` (derivatives only, provenance in
`public/assets/derivatives/`).
