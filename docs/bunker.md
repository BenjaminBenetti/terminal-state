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
