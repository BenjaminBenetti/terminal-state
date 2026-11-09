# The Bunker (`bunker`)

A buried subway stop at the door of a civil-defence shelter. The player's train pulls in, the arrival hall leads to a round blast
door standing open in a reinforced bulkhead, and behind it the shelter descends through five real storeys into the earth, down to the
central processing core. Retro-industrial civil-defence in spirit, original throughout: no franchise names, numbering or characters.
Every shelter has its own seeded name (`gen/bunker/names.ts`, for example "Harrow Hill Deep Shelter"); a campaign node's printed name
replaces it on the signs.

- Generator: `game/src/gen/bunker/` (`index.ts` `generateBunkerLevel`). Contract: `gen/bunker/bunkerTypes.ts` (`layout.bunker`).
- Registration: `LevelId 'bunker'`, tier 2, between the Market and Skyways in `LEVEL_IDS`; `trackExtensions: 'none'`.
- Objective (optional): `world/bunker/*` (three generators, each fuelled with one can and started with the familiar turnkey, power
  the core cluster, which grants map intel once per station; lane store `bunker.state`).
- Look: `world/bunkerArch.ts` (the Reactor's arch materials, varied by programme) and the Reactor bunker's hero models.
- **Two layout versions** (`gen/bunker/layoutVersion.ts`): version 1 is the first Bunker, documented in the sections below and frozen
  for every station entered under it. **Version 2** is the inhabited rework (open communal halls and galleries, a strong identity per
  storey, the powered cargo lift, the round vault bore), built for every unvisited station and every new campaign. See
  [Version 2](#version-2-the-inhabited-shelter) below.

## Storeys

World y descends; storeys are 7 m apart (`BUNKER_BASES`). Storey 0 is level role `main`, storey 4 is `lower` (damp), the rest `ring`.

| Storey | Floor | Programme | Rooms (required; a seeded subset of the optional rooms is added) |
|---|---|---|---|
| 0 Station | 0 | `station` | track bed + side platform (the train parks here), arrival hall, guard booth, station office (70 %), the vault bulkhead with the open blast door, vault vestibule, the main stair's top landing |
| 1 Entry & security | −7 | `entry` | decontamination (off the main stair lobby), muster hall (5.2 m), security checkpoint, armoury (dead end off the checkpoint), operations room, latrines; optional warden's office, locker room, records office, entry stores |
| 2 Habitation | −14 | `habitation` | dormitories A and B, mess hall, kitchen, pantry, latrines and showers, recreation room, **generator 1** (habitation plant room); optional dormitory C, locker room, laundry, linen store. The three rooms farthest from the main stair form the aged wing. |
| 3 Services & medical | −21 | `services` | infirmary, isolation ward (gas leak), warehouse (5.2 m), shelter stores, workshop, washroom, **generator 2** (services plant room); optional medical stores, records office, laundry, ration store |
| 4 Maintenance & water | −28 | `maintenance` | pump hall (5.2 m), water treatment, air filtration plant, boiler room, maintenance workshop, **generator 3** (maintenance plant room, damp); optional valve room, stores, crew lockers, washroom. A dead-end plant room is the damaged section with the strong leak. |
| 5 Central processing core | −35 | `core` | central processing hall (6.4 m clear, rack rows along the approach aisle, the **core cluster** against a wall facing the hall), cooling plant, core control room, switch room; optional chiller room, tape store, washroom, operators' office |

Footprints are seeded per storey: about 40–50 m on a side (tested at ≤ 70 m), roughly 850–1150 m² of floor per shelter storey.
Spare storerooms fill leftover voids (at most three per storey).

## Structure and traversal

- **Two stacked scissor stairs** (the Mall's service core on a 7 m storey: lanes side by side, a full-width landing at alternating ends
  on every storey, one straight run of 41 risers with 1.2 m landings per storey pair, the divider left as rock):
  - the **main stair** (2.5 m lanes) runs from the station's vault vestibule down to storey 5;
  - the **service stair** (2 m lanes) runs from storey 1 to storey 5, 22–31 m east of it.
  Each shelter storey has a stair lobby along each core's inner flank and a spine corridor joining the two lobbies at a seeded row.
  Every shelter storey pair therefore has two independent runs, which forms loops. Removing any one run leaves every storey reachable,
  and the validator checks this.
- **Rooms**: the Reactor shelter's seeded room-graph planner (`gen/reactor/complex/bunkerPlan.ts` `Planner`) grows 1–3 more corridors
  off the skeleton (T, L and straight runs), places the storey's programme by function (each room opens off the rooms it belongs to),
  grows rooms into the rock beside them, and adds seeded loop doors between corridors and suites. Every planned door must fit;
  otherwise the storey plan retries on a new fork, and the whole level retries with a new frame salt.
- **The vault door** (`REACTOR_X_KIT.blastDoor`, the Reactor bunker's model) stands open in the 1 m bulkhead between the arrival hall
  and the vestibule. Its leaf and frame are collision on both faces, and the 3-cell lane through it climbs a raised threshold (three
  0.28 m risers each side). It is never locked: the exit is always free.
- Closed, stacked storeys: the level culler's default (no atrium or slab options). Hearing across storeys keeps the default slab muffle,
  without the open-atrium flag.

## Objectives (placement)

- **Generators**: exactly three `BUNKER_GENERATOR_KIND` props (5.6 × 2.48 × 1.67 m, the Reactor's auxiliary generator), ids
  `gen-0` … `gen-2` on storeys 2, 3 and 4, one per plant room. Each stands back to a wall (doorless walls first, then the wall opposite
  the room's main door), with its front facing ≥ 2 m of the room's own clear floor, held clear through every dressing pass. None is
  placed beside a guaranteed free fuel can: the common station fuel plan is unchanged.
- **Core cluster**: `BUNKER_CORE_KIND` (6.0 × 3.6 × 2.2 m) in the processing hall on storey 5, short walls first, with ≥ 3 m of clear
  floor in front. The hall's 6.4 m clearance leaves room for the 3.55 m screen.
- Both kinds are anchored or built-in equipment rather than storage (`gen/bunker/bunkerKinds.ts`, classified in the openables and
  physics audits). The builder never draws them; `world/bunker` does.

## Flavour models

- **Mainframe tape cabinets** (`bunkerMainframe`): the Bunker's own model, a reel-to-reel tape cabinet generated with Meshy T2.5 from a
  Codex reference under the Bunker's approved flavour budget. It is cooked by `tools/asset-pipeline/props/build-bunker-kit.mjs`
  (grounded, 0.90 × 1.90 × 0.52 m, Meshy maps kept, resized / re-encoded only) to `assets/models/bunker-mainframe-tape-cabinet.glb`.
  Provenance is in `assets/derivatives/bunker-kit-20261109.json`; the file is allowlisted, credited and loaded on the Bunker only.
  - In the processing hall, banks of four alternate with banks of four server racks along the approach aisle (flush fronts).
  - Two stand in the core control room.
- **Reused models**, each as a model-backed kind drawn through the builder's instanced path:
  - the Reactor's decontamination shower booth: two in decontamination;
  - its control console: in the core control room, beside the radio desk, a desk with a CRT terminal and two wall data cabinets;
  - its coolant pump (as the pump hall's water pumps) and its 4 m pipe bank (only where the ceiling clears it).
- The maintenance storey's water plant also uses the existing p7 water pump skids, treatment tanks (water heater tanks), valve
  manifolds and an air filtration unit.
- Classification and scale checks: docs/prop-affordances.md "The Bunker's kinds".

## Hazards

- **Gas leaks** (`layout.bunker.gasZones`, 3–6 per level, `gen/bunker/hazards.ts`):
  - the isolation ward (storey 3), medium strength (0.50–0.62);
  - the damaged maintenance section (storey 4), strong (0.86–0.95), in a dead-end plant room with one doorway;
  - a habitation corridor (storey 2), weak (0.34–0.42);
  - a seeded subset of: the cooling plant (storey 5, weak or medium), decontamination residue (storey 1, weak) and a services workshop
    cylinder (storey 3, weak).

  The runtime (`world/gas/zones.ts` → the gas system's `zoneSources`) seeds every leak into the ONE gas field as a breach of its
  strength (`GasBreach.strength`: its sources and room pool fill toward that level), fast-forwarded 90 s so the gas is already spread
  on arrival. The visible green volumetric fog, the exposure damage, mask / filter / air-tank protection, the HUD and the in-engine
  fallback all read that field. A worn mask stops inhalation only and never hides the fog. Every full-strength breach (the Office,
  Skyways) keeps the original arithmetic exactly.
- **Clean routes**: a strong leak is never in a corridor, hall, generator room, the core hall or a stairwell. With every cell the field
  holds at or above 0.4 shut, the platform still reaches every generator's front and the core cluster's front. `bunkerIssues` and
  `tests/bunker-gas.test.ts` check this.
- **Damp** (`layout.bunker.damp`): the maintenance storey's pump hall, water treatment, generator 3's plant room and its damaged rooms.
  The storey's level role is `lower` (`world/decay.ts`: more leaks, seepage and neglect), and these rooms are the Strainer's habitat.
- **Aged wings**: the habitation storey's far wing and the maintenance storey's damaged section. Their fixtures are broken or sputtering
  (dark or dim) and fallen ceiling panels and a sagging duct lie in them, kept clear of every doorway. The generator plant rooms and the
  core hall run on steady emergency power.

## Enemies

`BUNKER_SPAWN_PROFILE` (`ai/spawnTables.ts`, docs/enemy-spawns.md "The Bunker"):

- **`station`** (storey 0): U{2..3} spawns; a Siren drawn there is ineligible and stays a zombie.
- **`floor`** (storeys 1–3): U{6..8} per storey.
- **`ring`** (storeys 4–5): U{7..9} per storey.
- **`damp`**: one spawn per level in the damp areas only, from its own pool (rat/dog 0.1, Strainer 0.3, otherwise a zombie).

Further rules:

- Every storey run reads the level pool `BUNKER_SHELTER_POOL` (rat/dog 0.05, Blightbelly 0.07, Siren 0.16). It is the level pool
  because `applyFamilySpacing` re-derives families from the level pool, so the Siren's 24 m spacing and cap only see her when she is
  drawn from it. Only the damp zone has its own pool.
- The Siren's eligibility: shelter-storey rooms only (never the station, a stairwell, washroom, closet or corridor), the Office / Mall
  room gates, at most 3 per level and 24 m apart.
- No hordes. Normal outfits only. The arrival keep-off (36 cells from the start) holds on every storey.

**Census** (32 levels, seeds 4401 + k × 7919, `tests/bunker-spawns.test.ts`):

- Enemies: 40.9 per level (budget 46; the Reactor's is 54).
- Sirens: 1.47 per level; 31 of 32 levels have at least one; max 3.
- Strainers: 0.38 per level; 12 of 32 levels have one; never more than one.

## Loot

The shared `BASE_TABLES` with no overrides (docs/loot-tables.md "The Bunker"). Rooms carry existing purposes and the Reactor shelter's
own (`REACTOR_BUNKER_PURPOSES`: decontamination, dormitory, radio, armoury), so holders stock by purpose:

- footlockers and staff lockers in the dormitories;
- gun lockers and crates in the armoury;
- medical stock in the infirmary;
- food and drink in the kitchen and pantry, from the shelf-stable `LEVEL_PANTRY.bunker` palette.

Loose floor supplies follow the Reactor's per-storey program, and weapon finds follow the station rule. Gas masks and filters use the
Office's roll. There is no merchant stock or currency.

## Saves and versions

- New campaigns only: `ORDINARY_WEIGHTS` gives the Bunker 0.05, taken from the Subway's share and appended last, so a 37-station
  network has 23 Subway, 4 Office, 4 Mall, 4 Skyways, 2 Market, 2 Bunker and 1 Reactor.
- Existing saved networks are never retrofitted: `PRE_BUNKER_WEIGHTS` (the previous census) stays in `validateNetwork`'s census list.
- `seeds.bunker` is backfilled in old saves the way `seeds.market` is.
- Layout version lane `bunker.layout`: version 1 is stamped on a station's first build (`gen/bunker/layoutVersion.ts`), so a future
  layout change can keep visited stations as they were.

## Tests

`bunker-gen` (validity over 12 seeds, descending storeys, programmes, connectivity train ↔ generators ↔ core, vault both ways, two
stairs per shelter pair, footprints, damp, gas zones, rack rows, budget, determinism), `bunker-gas` (hazard ↔ visual parity on the real
volumetric layers, strength ordering, the mask, clean routes, the Office arithmetic unchanged), `bunker-spawns` (profile, census),
`bunker-registration` / `bunker-campaign` (registry, references, network allocation, saves), and `bunker-objective-*` (the objective
lane).

## Version 2: the inhabited shelter

Task studio-bunker-rework-20261109-205115-01. The user's verdict on version 1: "adequate but lacks character" — rooms and corridors.
Version 2 changes the ARCHITECTURE: larger open communal and working spaces mixed with constrained security / private / service rooms,
real changes of scale and sightlines, and a strong, different human purpose on every storey, inside one coherent buried shelter.
Each storey was designed by its own floor designer (one Claude Code agent per storey) round a shared spine the lead fixed first.

### The spine (`gen/bunker/v2/spine.ts`)

Everything that must line up between storeys is fixed, so the six floors were designed in parallel:

- **Storeys**: six, 7 m apart (y 0 … −35), the programmes and labels of version 1 (station, entry & security, habitation, services &
  medical, maintenance & water, the central processing core). Level roles: the station `main`, storey 4 `lower` (damp), the rest `ring`.
- **The canvas**: one 140 × 150-cell grid (70 × 75 m) for every storey; each floor carves inside its envelope, off the keep-outs.
- **Stairs**: two scissor cores, real shafts with the same footprint on every storey: the main stair (core A) from the station's vault
  vestibule down to storey 5, the service stair (core B) from storey 1 down. Each storey has one landing per core at alternating ends and
  ONE fixed landing door per core; every storey pair from 1 down has two independent runs (loops: removing any one run keeps every
  storey reachable).
- **The cargo lift shaft**: 10 × 12 cells beside the main stair, solid on every storey grid (the car is a moving volume), its gate on
  the north face at every stop; every storey keeps a clear 6 × 4 m loading apron in front of it.
- **The voids**: two double-height spaces, a lower storey's hall rising 11.6 m through the slab of the storey above, which leaves the
  well open with a railed gallery round it: **V12** (the habitation commons, overlooked from the entry storey) and **V45** (the processing
  core's nave, overlooked from the maintenance storey). The storey culler's portal tiles show the other storey through a well.
- **The station's fixed pieces**: the track bed and side platform, the bulkhead band with the vault lane, the vault vestibule (the
  vertical hub: the main stair's head and the lift's top landing open off it).
- **Anchors**: each stair door / the lift apron / the vault's hall side must be served by ONE area of its floor; the pipeline cuts the
  landing doors and holds every apron clear of furniture.

### The floors (`gen/bunker/v2/floor0.ts` … `floor5.ts`)

Contract: `gen/bunker/v2/floorApi.ts` — a floor carves its areas (`FloorCarveCtx.room / door / connect`), names its generator room
(storeys 2–4) or its core hall (storey 5), proposes its gas leaks / damp / aged areas, and dresses its own areas after the station
dresser.

Each storey's own idea (its designer's report: `reference/` task folder, not shipped):

| Storey | Identity | Spatial idea | Landmarks |
|---|---|---|---|
| 0 Station | the **admission concourse**: how a buried shelter took in the people its trains brought | platform (5.2 m, overflow berths at its ends) → three portals → the 6.4 m colonnaded **vault hall** nave on the vault axis, low (3.6 m) registration and waiting halls opening onto it through arcades, a narrow corridor to the observation ward (dead end) | the lit blast door at the end of the spawn's sightline, the marshals' booths and podium, the shelter's name over the door, "NOW ADMITTING" |
| 1 Entry & security | the **admission line**: decontamination → intake → screening → the reveal | tight arrival lobby and decontamination → the 6 m intake hall (queue barriers, registration counter) → three narrow screening lanes → the overlook: a gallery RING round the V12 well, the deep muster gallery opposite; a security wing behind (duty hall, guard corridor, cells, operations, warden, armoury dead end) | the first view down into the commons 7 m below, the muster gallery's benches facing the rail |
| 2 Habitation | **a buried town round its square** | the commons under the V12 void built like a church nave with low aisles (the planted Green Walk, the Arcade), the 5.2 m mess hall opening 8 m wide onto it, then 2 m "sleeping streets" 47 m long with family quarters, a dormitory, latrines and the laundry; the school and nursery between square and street | the Lamp Ring (eight warm lamps under the gallery), the hearth tree and benches, the stage with its film screen and motto |
| 3 Services & medical | **the service street** | a 6 m-wide, 5.6 m-tall internal street between the stair cores, split by a hazard-striped bulkhead gate; the 6.4 m supply depot (high racking) and the fabrication hall (gantry crane) either side; the infirmary waiting hall, a 23 m casualty ward of curtained bays, the clinical corridor and an airlock into the isolation ward (the medium leak) | the backlit ceiling trough of the street, the gantry with its hanging pump motor |
| 4 Maintenance & water (damp) | **the machine floor** | 6.4 m plant halls (reservoir, pump hall, water treatment, boiler house) on one north-south line linked by cramped 2–2.5 m pipe runs, ending on the core gallery: a railed rim round the V45 well; a flooded, aged drainage wing (sump, sewage ejector) | the walled reservoir with columns standing in the water, the pump rows under crane rails, the view down into the core's nave |
| 5 Processing core | **the shelter's brain**, operators living beside the machines in shifts | a low 28 m gallery and a clean-room lobby open into the 11.6 m NAVE (the V45 void) on its long axis; a 37 m freight axis (lift → loading bay → 6.4 m cooling plant → control room → gallery → nave); tight technical rooms (chiller, switch room, UPS battery room via a cable way) and the operators' commons, bunk room and tape library | the core cluster under a 7 × 3 m status board terminating the nave's axis; tape cabinets and racks along the walls; coolant pipes climbing to the ceiling |

Loot reads as each storey's programme (holders by their purpose's theme): security / personal on the entry storey, personal on the
habitation storey, services / medical on the services storey, services / crew on the maintenance storey, technical / records on the
core storey. Every storey serves its anchors, holds its generator (2–4) or the core (5), and proposes its own hazards (the strong leak:
storey 4's chlorination room; medium: storey 3's isolation ward; weak ones on storeys 1, 2, 3, 4, 5, at most six over the level).

### The pipeline (`gen/bunker/v2/index.ts`)

Spine carve → the six floors → anchor doors → the vault lane → crop / links / apertures / rails → the vault door, the three generators
(in the floors' generator rooms) and the core cluster → hazards from the floors' proposals (3–6 leaks, at least one strong, a strong
leak only in a dead-end room) → one station dresser pass (aprons, fronts and the threshold held) → each floor's dressing → the shared
enemy / supply / weapon passes (the version-1 profile and census) → lighting → traversal → `layout.bunker` (version 2: + `lift`,
`voids`, `floors`) → validation (`bunkerIssues` + `gen/bunker/v2/validate.ts` `bunkerV2Issues`).

### The vault entry (fix 2)

The blast door is a square steel frame round a ~2.64 m round bore. Version 1 cut a 1.5 × 3.1 m slot through the bulkhead, so the player
saw a narrow rectangular slot inside the round frame, and the builder's door trim stood across the lane (it framed the 3 × 2-cell
opening as a wall along Z through its first column: two steel slabs and a bar the player walked through).
- **Every version**: `world/builder.ts` frames a thick opening along the wall its two areas share (jambs on the lane's walls, never
  across it). The version-1 layout itself is frozen, so its slot keeps its rectangular look (its trim no longer crosses the path).
- **Version 2** (`gen/bunker/v2/vault.ts`): the bulkhead is cut 3.5 m wide and 3.25 m tall — wider and taller than the ring — so every
  grid face lies behind the frame's steel and the model's own round bore is the tunnel. The walkable lane is the middle 1.5 m over the
  same three-riser threshold; the cells beside it are the ring's curved cheeks (collision from the threshold up, where a foot meets the
  rising curve); the lane door carries `noFrame` (the model frames it). Never locked, passable both ways.

### The cargo lift

A large freight car (4 × 5 m, a 3.2 × 2.9 m gate, 3.2 m clear) in one shaft through the station and all five shelter storeys, on the
Office / mall elevator runtime (`world/towerRuntime.ts`, `world/elevator.ts`; the record: `gen/bunker/v2/liftPlan.ts`
`bunkerTowerRecord`):
- **Look**: painted civil-defence steel, a chequer deck in a hazard border, barred see-through car gates, hazard-yellow landing portals
  with painted landing doors, a shaft liner with the landing openings — the shaft and the landings slide past the bars while it runs.
- **Power**: off until ALL THREE generators are online (the objective's power seam: never the intel claim, a visit or fuel per ride).
  Unpowered, every button answers with a dead buzz and the reason; the stairs stay the essential routes before and after.
- **Riding**: the player, enemies inside, resting props and loot holders (physics), pickups, ragdolls and FUEL CARTS (their storey
  too) ride the car's motion; enemies never call it and the pathfinder ignores it (stairs only). Doors open only level at a stop; an
  obstruction re-opens them; nobody is ever shut in.
- **Persistence**: the car's stop is kept in the station's `bunker.state` record; a car torn down mid-run finishes its run with its
  loose things (nothing saved hanging in the shaft). Pause / death / menus freeze it; Retry restores it with the section.

### The generators' fuel (fix 3)

Each generator needs ONE QUARTER-TANK fuel unit (`BUNKER_GEN_FUEL_UNITS` = the fuel system's unit) from any common train-style source,
by the same physical rules as the train's cap:
- a **fuel can** poured at its filler (one can = one unit);
- a **fuel cart's hose** within reach of the filler (`world/fuelCarts.ts` `FuelHoseTarget`): one unit in one tick, the generator
  committing it as the drum gives it, the hose disconnecting when the generator is fuelled — the cart keeps the rest. Carts cannot use
  stairs, so in practice a cart reaches a generator only where it physically can; cans carried down the stairs are the dependable
  source before the lift has power.
Then the familiar 2 s turnkey start. The record (`bunker.state` version 2) stores each generator's PAID quantity; a version-1 record
migrates as paid (fuelled / online = paid in full): no re-charge, no refund, an online generator never un-starts.

### The objective title (fix 1)

The Bunker's objective title shows on two balanced lines at the HUD's normal size in a bounded panel (`ui/objectiveTitle.ts`); every
other level's one-line title is unchanged.

### Version policy

- Version 2 builds for every station never entered (and every new campaign's). A station entered under version 1 keeps version 1
  exactly (`tests/bunker-v1-frozen.test.ts` pins its whole layout); it gets the HUD, vault-trim and fuel fixes (runtime only), never a
  lift shaft cut through its saved rooms.
- The network share (5 %, from the Subway only, new campaigns only) and every save rule are unchanged.
