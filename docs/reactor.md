# The Reactor (`reactor`, tier 3)

The culminating level, built from the user-selected concept **B "Industrial Service Cathedral"**: a subway station on the rim of a vast
vertical industrial pit. Dense steel gantries, an overhead crane, organ-like pipe banks and auxiliary generators descend through
stratified toxic gas to the dormant reactor core at the bottom. The player restarts the core. The concept original stays private,
outside Git.

## Where it lives
| Part | Files |
|---|---|
| Contract (types only) | `game/src/gen/reactor/reactorTypes.ts` (`layout.reactor: ReactorInfo`), `game/src/world/reactor/runState.ts` (the one persisted record, lane store `reactor.state`), `game/src/world/reactor/visuals.ts` (the visuals seam) |
| Generator | `game/src/gen/reactor/{index,frame,carve,structure,validate}.ts` — `generateReactorLevel(ctx, {trackExt})` |
| Registration | `levels/registry.ts` `LEVELS.reactor` (tier 3), `ai/spawnTables.ts` `REACTOR_SPAWN_PROFILE`, `items/lootTables.ts` `REACTOR_PROFILE`, `gen/maskLoot.ts` (1 mask, 3–5 filters), `gen/trackExt/config.ts` `TRACK_EXT_REACTOR`; title card, travel slot 3, `?level=reactor` / `?reactorSeed=CODE` |
| Air (gas + generators) | `game/src/world/reactor/{air,generators,airHud,airQa}.ts`; the exposure term in `world/gas/system.ts`; the reactor-only march term in `render/volumetric*.ts`; the jammed final generator `game/src/gen/reactor/gasJam.ts` |
| Restart + win | `game/src/world/reactor/{restart,restartLogic,restartWin,restartScreens,restartViews,restartItems,restartQa}.ts`; `run/milestones.ts`; coming to life (startup audio, beacons, the ONLINE sky): `game/src/world/reactor/startup*.ts` |
| Rendering (the kit) | `game/src/world/reactor/{arch,archKit,archMeshes,archMaterials,archAssets,archVisuals,archHaze,archInstall}.ts` |
| Mounted controls, floor maps, impacts | `game/src/world/reactor/{controlsMount,controlsKit,controlsSkin,controlsModel}.ts`, `game/src/world/reactor/mapBoard{,Plan,Draw}.ts`, `game/src/world/finishAt.ts` + `game/src/damage/impactFinish.ts` (see "Mounted controls" / "Floor-map boards" below) |
| Assets | `game/src/assets/reactorKit.generated.ts` (13 Meshy T2.5 models + 3 Codex surface sets; `tools/asset-pipeline/props/build-reactor-kit.mjs`), `game/src/audio/manifest.reactor.generated.ts` (9 Sound Lab clips; `tools/audio-pipeline/reactor-{plan.py,build.mjs}`), `game/src/audio/manifest.reactorStartup.generated.ts` (7 startup clips; `tools/audio-pipeline/reactor-startup-{plan.py,build.mjs}`) |
| Core floor + hero reactor (task reactor-expansion, lane CORE) | `game/src/gen/reactor/coreFloor.ts` (vessel footprint, service ring, goop pool, bridges, loop / turbine layout, `layout.reactor.coreFloor`); `game/src/world/reactor/{coreHero,coreLiquids,coreStages,coreVisuals,coreLights}.ts` (the assembled structure, the dynamic goop / coolant layer, the staged startup, the glow lights) |
| Tests | `game/tests/reactor-*.test.ts` (`reactor-level.test.ts` runs every lane on real generated layouts) |

## The level, top to bottom (one continuous world; the rim at y 0, depth negative)
- **Rim** (`levels[0]`): a real subway station. One platform of about 70 m beside a track bed (tunnels continue past the bed ends;
  at most one Beyond-the-Station annex). The platform does not open onto the pit: a small station area, a breached wall and a short
  rough tunnel lead to the railed rim gallery and the first view down to the core (see "Arrival approach and seeded flow"). The rim
  control office holds the startup key and the pit status board.
- **Four walkway tiers** (about 6 m apart): steel galleries on the pit walls, big landings for the generators, bridges across the
  pit to 1–2 free-standing lattice towers, and side rooms cut into the rock (maintenance stores, the switchgear room on tier 4).
- **The core floor** (about −30 m): the pump hall, the control room overlooking the vessel, and round the vessel (lane CORE):
  - the **service ring**, a walkable steel grating deck from the vessel's hazard plinth (6.6 m) to 10 m;
  - the **glowing green goop pool** from 10 m to 16 m, 1.5 m below the deck. It is non-walkable (blocked cells; no spawn, loot or
    path), railed on every edge (round railings drawn at the collision envelope) and has no fall-in or damage mechanic;
  - **3–4 radial bridges** (2.5 m clear, railed, with post lamps) cross the goop to the outer floor;
  - the **coolant loops** stand in the goop between the bridges. Each loop has a steam generator, a vertical reactor coolant pump on its
    plinth and a coolant manifold (the lead's Meshy hero models, collision props), plus its hot, cold and crossover legs. The legs
    cross the ring overhead with at least 2.4 m headroom;
  - the **steam header ring**, a forest of risers, the circular service gantry, the CRDM service platform on the dome and the
    **turbine generator** on a wall run of the outer floor;
  - the lead's hero models through the arch model-swap registry (`archAssets.ts`, one entry each; procedural stand-ins without
    them): **pipe elbows** at the runs' square bends (scaled to the bore; the straight pipes are cut at their ports), inline
    **sight-glass spools** on the cold legs and crossovers (the coolant glows in their windows: fill on the valve, streaks with
    the pump) and the **CRDM service platform** seated on the dome (its housings' top ring carries the rod lamps).

  The vessel's footprint is blocked but no longer a 12 m raised drum (its grid column is not drawn): the vessel model shows.
- **The pit air rises above the rim** to about +15 m: the crane runway, the trolley and its hanging hook, and the tops of the pipe
  banks.
- **Routes** (at least two between every consecutive tier pair, recorded in `layout.reactor.routes`):
  - the wall switchback stairs (main);
  - the bridge + tower line (a second flight set);
  - maintenance ladders by the pipe bank.

  Retreat is the same world back up.
- **Seeded variation within the kit:** which wall hosts the switchbacks / pipe organ / generator landings, the gallery arcs, the
  bridge tiers, the tower count and position, and the room order. B's identity (crane, organ wall, generator landings, bridges +
  Since round 2 (lane ARRIVAL) also: the arrival recipe, the rock suites of every storey, the complexes' entrance spots and the south
  flight set's direction (below).
  towers, vessel) is always there.

## Side complexes off the shaft (task reactor-expansion-20261101)
Each zone's generator lives in a substantial side complex: zone 0 in the **bunker** (tier 1), zone 1 in the **old mines** (tier 2)
and zone 2 in the **waste repository** (tier 4). The host is `game/src/gen/reactor/complex/host.ts`; the contract is
`complex/types.ts`; the carvers are `complex/{bunker,mines,waste}.ts`.
- **Slot**: an 80 × 64 cell region (40 × 32 m) of rock behind the stair, organ or south pit wall. The wall is a seeded permutation
  with a fallback; never the north wall under the station. The region's pit-side row is the pit wall. A carver keeps one cell of
  wall inside every edge. When planned, the region is solid rock on every storey. Rooms of the same storey avoid it. Rooms of other
  storeys may lie above or below it: `ceilMax` (the deck above minus a slab) keeps the storeys apart.
- **Entrance**: a 6-cell (3 m) span of that wall row, in front of flat cells of one deck area (`frontArea`). Round 2 (lane ARRIVAL):
  the deck is drawn by weight (landings 3, stair landings / galleries 2, terraces 1) and the spot along it is seeded; the region stays
  centred on it where the canvas allows. On the stair wall's generator landing it becomes the entrance landing; a vacated generator
  landing elsewhere is a plain "Wall landing". The carver carves the door from that deck, at
  least 2.6 m clear.
- **Order in `generateReactorLevel`**:
  1. slots (in `carveReactor`, before its rooms);
  2. carvers (shared Kit, canvas cells, before Track2 and the crop);
  3. the crop at origin (0, 0), so canvas cells are grid cells;
  4. the complex generator: an anchored collision prop on the carver's foot, with the panel on the foot edge facing the use point;
  5. the station dresser (it dresses complex rooms by type and purpose);
  6. each carve's `dress(layout, rng, {ox: 0, oy: 0})`. Props and lights placed here are **not** lifted, so give them an absolute
     `y` and `level`;
  7. populations: the storey's normal enemy and supply runs, keeping off the use point and the entrance;
  8. `applyLighting`; then the generator room is lit steadily;
  9. the cable, running from the panel through the complex and the entrance to the zone's fans; then `layout.reactor.complexes`.
- **Null carver**: the zone keeps its landing generator, and the level stays valid.
- **Validation** (`complexIssues`, part of `reactorIssues`):
  - every carved cell lies inside the region;
  - the entrance door is at least 2 m wide and 2.6 m clear;
  - the entrance and the generator use point are reachable by stairs only;
  - the complex does not overlap the pit, the station, other areas or Track2;
  - the generator's skid stands on complex floor, with its panel in reach;
  - the complex is substantial: at least 6 areas and at least 500 m² walkable.

### The bunker — "Shelter 7" (zone 0, tier 1; lane BUNKER)
`complex/bunker.ts` (carver), `bunkerPlan.ts` (the seeded room graph in a wall-local frame), `bunkerGrow.ts` (its O(1) occupancy),
`bunkerDress.ts` (dress hook), `bunkerPurposes.ts` (its own room purposes), `bunkerKinds.ts` (hero prop kinds),
`world/reactor/bunkerModels.ts` (their instanced models).
- **Program** (15–22 spaces, ~850–1000 m² walkable, rooms 3.2–4.0 m clear, the hall up to `ceilMax`):
  - the **blast-door lock** behind the entrance (heavy hazard-striped frame, "SHELTER 7 · CIVIL DEFENCE" plate on the gallery side);
  - a 1 m **bulkhead** holding the round **blast door** (`REACTOR_X_KIT.blastDoor`, its leaf standing open; a 1.5 m lane over a
    0.84 m threshold, three 0.28 m risers each side);
  - **decontamination**, the **guard post** (doors into the lock and onto the clean side, the muster corridor or the decon: a level
    way round the threshold that the generator cable takes);
  - the **muster corridor**, more corridors (named by their rooms: quarters / plant / operations corridor, service passage), the
    **mess hall**, **dormitories** (bunk rows, footlockers, lockers), **latrines**, air **filtration plant**, **infirmary**, **radio
    room** (console), the **generator hall** with its **switch room** and the dead-end **armoury** (the reward: gun lockers, ammunition
    cabinets, crates; off the guard post, warden's office, hall or a corridor); optional warden's office, ration store, shelter
    stores, workshop, dormitory B, locker room; spare storerooms.
- **The generator**: mid-hall along the hall's long axis, the use point beside the end facing the switch room (when it opens off a
  short wall); a grated cable trench to the switchboard panels on that wall, a hazard outline, two diesel day tanks on their bund
  (scanned along the long walls), a second row of fixtures. 'GENERATOR HALL' plates in every corridor on the way, arrows to the exit.
- **Seeded room graph** (task reactor-playtest-round2-20261102, user: "much to normal … it should be random! with logical rooms
  flowing in to one another"). Per seed:
  - the entry: the door's facing (lock / decon), lock width, decon depth, guard side / width and its clean-side door;
  - the muster corridor: across behind the entry group, straight in, or beside the decon;
  - 1–3 more corridors (T branches, L turns, straight runs, sometimes through the mess hall) where the rock can hold rooms;
  - the rooms grown onto that skeleton by **function**: each room opens only off the rooms it belongs with, and a corridor takes
    the wing (quarters / plant / operations) of its first room. Candidates are scored for snug packing, no thin rock slivers, wing
    affinity and seeded jitter. The optional rooms are a seeded subset;
  - rooms grow into the free rock beside them, then seeded loop doors join corridors / suites that share a wall.
- **Guarantees**: the generator hall always keeps **two independent ways in** from the muster corridor. Every door is on a shared
  one-cell wall. The switch room opens only onto the hall. Dormitories never open onto plant rooms. A failed attempt retries on the
  next rng fork (10 at most; first try ~75 %); plan + carve take ~8 ms. Rooms are sized for their hero pieces (dormitories deep
  enough for two footlocker rows, radio room / filtration plant with two doors at most, the hall with at most three side rooms),
  and the dress scans every wall spot before an island / compact fallback: every dormitory sleeps >= 4, and the console, filter
  unit and day tanks always fit (60-seed real-level sweep).
- **Measured** (`tests/reactor-x-bunker-carve.test.ts`, 16 seeds on one slot): 16 distinct room graphs (WL hashes) and 16 distinct
  floor plans up to translation. Both muster kinds, both decon exits and both guard links occur, with 3+ corridor counts / cycle
  ranks / dead-end counts, 4+ hall positions, both hall axes and 8+ optional-room sets. The real level
  (`reactor-x-bunker-level.test.ts`) gives 12 seeds, 12 different shelters, all valid.

### The old mines — "No. 2 workings" (zone 1, tier 2; lane MINES, round 2: a seeded drift / room graph)
`complex/minesPlan.ts` (the plan), `mines.ts` (carver), `minesDress.ts` (dress hook, rail line), `world/reactor/minesVisuals.ts`.
User bullet 7 ("much to normal … should be random! with logical rooms flowing in to one another"): the fixed program is now a graph
grown space by space through the rock. Each seed draws a new topology; up to 16 attempts, each its own rng fork.
- **Always:**
  - the timbered **adit**: short, long, or a dog-leg along the pit wall;
  - the **haulage junction** (the adit enters it at a seeded point);
  - the **main haulage** with its rail line: 1–4 drift segments out of a seeded junction wall (runs, jogs, bends left / right /
    down). The **generator cavern** sits wherever that course ends, entered at a seeded point of its wall;
  - at least one **loop** through the cavern, so the generator stope is never a cul-de-sac: the old manway (junction / adit to the
    cavern) or a return airway (cavern to an earlier haulage segment). A second loop may add a cross-cut between drifts or a manway
    down to a later segment;
  - the **development heading**: a dead end off the critical path, sized by `headingFor()` from the drill rig's real size.
- **Optional, seeded, at logical places** (`MINE_LINKS`; tests check every opening):
  - lamp / tool rooms by the adit or the junction;
  - a footwall drift forking off the haulage;
  - the powder magazine: off a side drift, never off the junction, the adit or the cavern;
  - the hoist room over its winze, the refuge, the flooded sump (off the cavern / a lower drift), a collapsed drift;
  - worked-out stopes.

  At least 4 optional kinds per plan. Rooms and dead ends have one opening and never open room to room.
- **Fill**: the cavern grows into spare rock first, then 1–2 stopes, then the other chambers, until 700 m². In the real level this
  leaves 579–618 m² free after props over 8 seeds (the floor is 560).
- **Drill rig**: placed from `minesModelSize('drillRig')` (registry dims × `MINES_FIT`; lane PROPS sets the drill's fit). The dress
  collider, the heading size and the instance scale all read it. The rig parks centred in the heading with its boom (model −x) to
  the face. Tests cover fits 1 / 1.5 / 2 and a 7 × 3.0 × 2.4 m envelope.
- **Variety** over 16 fixture seeds:
  - 16/16 distinct graphs, 13 haulage courses, 3 course lengths;
  - 5 cavern places, 3 adit kinds, 6 loop combinations, 16 optional-room sets;
  - cavern 150–336 m².

  Over 8 real-level seeds the graphs are all distinct. Plan time ~5 ms median; real-level generation median 824 ms (budget 1200).
- **Limits:**
  - the cavern lands in the middle third laterally on about 60 % of seeds: it is big;
  - one or two worked-out stopes appear on almost every seed: they are the area fill;
  - all spaces are axis-aligned rectangles: no curved or diagonal drifts.

## Arrival approach and seeded flow (task reactor-playtest-round2-20261102, lane ARRIVAL)
User: "the reactor pit is to close to the subway stop. You should have to traverse through a small station area, before going through
a hole in a wall, through a small tunnel, then you hit the reactor area!" and "the layout … is much to normal … it should be random!
with logical rooms flowing in to one another".
- **The approach** (`gen/reactor/arrival.ts`, `layout.reactor.approach`): `frame.sep` (28–34 cells, 14–17 m of rock) now separates the
  platform from the pit's north wall. One route on the rim storey, no teleport, no barrier: platform → 1–2 openings ("RIM ACCESS") →
  a ticket hall (+ 0–3 back-of-house rooms, sometimes a service corridor) → the **breach**: open cells through one of its walls (no
  door, no frame, a jagged top edge ≥ 2.35 m) → a **rough tunnel** (ragged segments 2–3 m wide, ceilings 2.9–3.5 m, pit-concrete
  rock finishes via `ReactorArch.roughAreas`, dim work lamps, 10–30 m with at least one bend) → the **reveal**, a second ragged hole
  through the pit's north wall onto the rim gallery ("RIM CONTROL OFFICE" plate beside it).
  - Recipes: `hall` (the hall's end wall breached), `corridor` (the far end of a service corridor), `backroom` (the side wall of an
    electrical room / store behind the hall). Hall size and position, direction, lengths, jitter and the reveal column are seeded.
  - `arrivalIssues` (in `reactorIssues`): the platform opens only into the hall; the rim gallery is reachable on foot and NOT with the
    breach closed; no straight sight line from any platform cell through the reveal; the tunnel length in range.
  - Unchanged: the trench, the train placement and its spawn seam (`layout.reactor.start` = the platform in front of a hall opening),
    the rim office, key, pit board and map boards (the carve stream keeps the old openings' draws: every restart room is placed as
    before), the Track2 annex.
- **Rock suites** (`gen/reactor/suites.ts`, `layout.reactor.suites`): the fixed tier-1 crew room / tier-2 workshop / tier-3 valve
  gallery became a seeded graph grammar on every storey (rim 0–1, tiers and core 1–2 suites): an entry corridor from a deck door, a T
  or L cross corridor, themed rooms in program order (crew facilities / maintenance up top, valve rooms / cable vaults mid-shaft, the
  electrical annex / coolant services deep, health physics / reactor services on the core floor, crane services on the rim), sometimes
  a loop back to a deck, enfilade doors, a back door into a store. Rooms keep one rock cell to everything they do not join, avoid the
  storey's complex region, keep a slab to every other storey and leave the two rock rows behind the pit wall to the fans. Furniture
  pockets are sealed (the office's rule).
- **Routes:** `frame.southFlip` runs the south flight set the other way round (its landings swap ends).
- **Determinism:** the approach, the south flip and `sep` use their own streams / forks; the restart rooms and the frame keep their
  old draws. Tests: `game/tests/reactor-x-arrival.test.ts` (16 seeds: route order, breach-only access, sight, length, support,
  train, rim objective; distinct topology signatures; coherence; determinism).
- **Census and cost:** ambient enemies per context, Blightbellies, rat/dogs, floor pickups, mask and filters are unchanged on the
  12-pit corpus (docs/enemy-spawns.md); Sirens 1.58 → 1.50 per run (1.13 → 1.50 on seeds 1–8; suite rooms are >= 5 x 5 m, so the
  deep ones qualify as her dark alcoves); loot holders 197 → 260 per run (+32 %, the new rooms' furniture; the level's loot TOTAL is held at its previous level by
  the Reactor profile, docs/loot-tables.md "The Reactor"); generation ~+20 % (Node
  median ~0.77 s); render-submit budget worst pose 714 → 757 draws (cap 790).
- **Track2 stays out of the pit** (a lead-reported bug: on 637474 an annex corridor cut through the rim gallery's organ-pipe bank):
  the bank / tower-leg columns are SOLID on every storey, so the extension planner took them for rock. `extendTracks` now gets the
  pit grown by `PIT_ROCK` (4 cells: the wall row + the fans' duct depth) as an opt-in `keepOut` (counted as core open space), and
  `reactorIssues` rejects any extension cell there (extensions are dropped, never a core retry). Every BTS-present roll checked still
  gets its annex.
- **Not varied:** which storey each complex is on (the gas no-deadlock rule, the jam and the spawn contexts depend on it), the
  switchback wall's lane order and the maintenance ladders' corner.

### The waste repository (zone 2, tier 4; lane WASTE, round 2: a seeded room graph)
`complex/wastePlan.ts` (the plan), `waste.ts` (carver), `wasteDress.ts` (dress hook), `wasteTypes.ts` (decor record),
`world/reactor/wasteVisuals.ts`. User bullet 7: the fixed band program became a facility grown from the entrance, in the order a
repository is entered.
- **The entry chain, always:**
  - the **receiving bay** over the entrance, which can meet any part of its front wall;
  - the **health-physics checkpoint** (decon booths, portal monitor) beside or behind the bay;
  - the **dosimetry & change room** off the checkpoint;
  - the **vault airlock**: a short run with heavy doors at both ends;
  - the **sealed vault corridors**: 1–4 runs (straight on, L turns, T branches), grown on demand toward open rock.

  The **drum vault**, **dry-cask hall** and **compactor** hang off the corridors (or each other, through a wide transfer door), each
  sized and oriented per seed. The **control room** opens off the bay, the checkpoint or the change room.
- **The service side:** the **generator & ventilation plant** (zone 2's generator) is reached from the bay or the control room. That
  is through a service corridor (one or two legs) or a direct door, never through the controlled area.
- **Optional, seeded:**
  - a second drum vault;
  - the **hot-cell gallery** (relabelled "Sample counting room" when the dresser's fittings leave no wall for the window);
  - the sump & pump room;
  - a switch room;
  - up to 3 stores in leftover rock: records, spares, filter room. These are dead ends.
- **Loops:** extra doors where grown rooms share a wall and the function allows it: goods shutters bay → vault / cask hall, plant
  maintenance doors into the controlled side, vault ↔ compactor, corridor ↔ corridor. Always ≥ 2 independent loops, at most one
  loop door per room (two per corridor).
- **Never varies (tested, `tests/reactor-x-waste-graph.ts`):**
  - the controlled area is entered only through heavy / wide doors (the airlock or a goods shutter);
  - the plant is reached without entering the controlled area;
  - every space is connected;
  - the generator skid and its use clearance;
  - the switchgear is guaranteed (its home is seeded: control room, plant or switch room);
  - one cable (the host's);
  - the map labels.
- **Dressing:** by room kind and real doors. Vault racks run along or across the hall (the doors pick), with one cross aisle at the
  main door. Drums awaiting compaction top up a short vault. The cask grid takes its best offset. Fans fall back to the next service
  room. `WasteDecor.genSign` keeps a clear plant wall for GAS's jam board. No floating beacons (bullet 13).
- **Variety:**
  - 24 seeds on ONE fixture slot: 24/24 distinct graphs and layouts, 7 cask-hall and 7 plant positions (3 × 3 slot cells), 18 vault
    shapes, 1–4 corridor runs, 2–3 loops, 1–5 dead ends;
  - 24 real levels: 24/24 distinct;
  - 926–1081 m² of floor (710–847 walkable after dressing), 78–160 drums, 3–6 casks, 12–16 spaces.
- **Cost:** a plan is ~1 ms (p99 17 attempts of 60, 0 failures in 1500 slots × positions). Real level: carve ~2 ms, dress ~10 ms.
- **Limits:**
  - spaces are axis-aligned rectangles;
  - walkable floor has ~10 m² of margin over the 700 m² test on the densest seeds (big cask halls);
  - a region smaller than ~72 × 58 cells plans less reliably (the host slot is 80 × 64).

## Gas: two approaches, no deadlock
- **Depth gas** (`ReactorAir`, a pure function of height): three zones.
  - Zone ids are 0-based: tiers 1–2, tiers 3–4, the core floor.
  - Stratified and thickening downward, with readable bands; the rim breathes.
  - Exposure goes through the existing threshold / dps / mask + filter / HUD / cough path. The Blightbelly's puffs and every other
    level's gas are unchanged.
- **Generator route** (no mask needed down to tier 4):
  - Each zone's auxiliary generator stands in air that is already clean or cleared: tier 1, tier 2 and tier 4.
  - Hold E 2 s to start it. It cranks, then its zone's fans spool and the zone clears in 3 visible stages (top first, about 55 s).
  - The clearing persists, and revisits never re-roll it.
  - A running generator is LOUD: it alerts existing enemies at the landing. Nothing spawns.
  - **The final generator (tier 4, the core floor's zone) JAMS** (round 2 design change, "The final generator jams" below). The core
    floor stays gassed until the reactor is online.
- **Filter route:** wear the mask and spend filters. The level always holds one mask and a finite filter supply, placed upstream of the
  core floor. The core floor needs them. Mixed play (clear what you fight on, mask through what you cross) is expected.

### Round 2 gas (task reactor-playtest-round2-20261102, lane GAS)
- **Knee-high spill (user: "on the level above the level that is covered in fog, there is also fog … make it lower, about knee
  high").**
  - Cause: zone 0's band top sat mid-storey, ~3 m above tier 1's deck. With the 2.5 m soft top, its sub-threshold haze stood
    visibly to 1.65–1.75 m (c ≥ 0.06) and 2.1–2.2 m (c ≥ 0.03) on tier 1, above the gassed tier 2.
  - Fix: `ZONE0_TOP_ABOVE_DECK` (2.0 m, `gen/reactor/structure.ts`) puts the top at 0.65 m / 1.1 m on tier 1. The eye is clean
    (0.07 → 0.008) and tier 2's hazard is unchanged (eye 0.22 → 0.215).
  - The other zones' tops lie 3 m below the deck above, so they spill onto no deck. Render and exposure still read one table.
- **White haze in the side complexes ("a fog machine party").**
  - Cause: `archHaze.ts` keyed its room multipliers by area *role*, but the atmosphere looks areas up by *type*, so they never
    applied. The complex rooms took the Subway's back-of-house values instead: utility 1.4, service corridor 1.35, and the
    'service' class group (half of the rooms dense, × 1.4). That came on top of the Reactor's denser base and its ground layer.
  - Fix: every room cut into the rock (`reactorRockRooms`: the complexes' areas + the pit side rooms) takes `rockRoom` (× 0.8,
    room class odds).
  - Result, at 1.4 m: the complexes go from 0.082–0.101 to 0.014–0.020 / m (a normal Subway station: 0.025). The pit, the rim
    and every other level are unchanged. The green strata are a separate term and are untouched.
- **The final generator jams** (user design change; supersedes "no mask needed all the way down"). Code: `gen/reactor/gasJam.ts`.
  - **The rule:** the deepest zone's generator, in the tier-4 waste repository, is jammed for the run. The 2 s hold cranks it for
    2.4 s, then it seizes: a creak and a clank, a short alert, its red fault lamp flashing, and a toast telling you to wear the mask.
  - It never starts and its zone is never cleared by a generator: only the reactor online (the win's `clearAll`) clears it, never a
    fuse, the breaker, the valve, the pump or the key. The upper two generators work as before.
  - `reactor.state.jam` keeps the generator and its stalls. A pre-jam record with it started keeps its zone's saved fraction.
  - **Where the player learns it, before committing:**
    - the rim pit board (core row "JAMMED · MASK");
    - the switchgear board once power is on;
    - the "Next:" step and the HUD objective;
    - the generator's prompt and the HUD air line ("toxic air · fans jammed — gas mask on");
    - the floor maps: a ⊘ jammed mark (not an open X) and a red banner on the core storey.
  - **Supplies:** the guaranteed mask and filters (`MASK_LOOT`: 1 mask and 3–5 filters) are placed only on storeys above the jammed
    zone (`placeMaskLoot` → `placeGear` `areaOk`). That air is breathable once the working generators run (checked on 12 seeds).
    - The worst roll gives 503 s of filter time.
    - The real core route (farthest stair foot → valve → pump → key switch → rods → online, until the eye is below the threshold)
      takes 70–76 s, and 165–177 s with ×2 walking and 60 s of fighting. The supply covers it twice over.
- Tests: `game/tests/reactor-gas-{spill,haze,jam}.test.ts`; the jam state machine is in `reactor-air-runtime.test.ts`. The old
  "zero damage down to the core floor" walk now ends at the final generator, with the jam asserted.

## The restart (credible industrial work, no puzzle)
1. **Startup key**: in the rim control office. It is picked up on the way down.
2. **Control power**:
   - Seat two fuse cartridges in the switchgear on tier 4. Three are placed, in stores on tier 3, tier 4 and the core floor, never
     inside the switchgear room.
   - Then hold the main breaker (1 s).
3. **Coolant**: in the pump hall, hold the coolant valve open (3 s), then start the circulation pump (needs control power).
4. **Rods**: in the control room, turn the key in the console's key switch, then hold to withdraw the rods (4 s). Needs the key, power
   and coolant.

The parts are finite: placed once, consumed once, never in a loot table. Every step persists, so a retreat keeps it. The status
boards (rim pit board, switchgear, pump, control monitor) and the HUD line show each task's state.

**The reactor comes to life step by step** (lane CORE, `world/reactor/coreStages.ts`). The restart runtime sends the persisted record
through `ReactorVisuals.setRestartState`: once, instantly, on every build or reload, and live after every completed control. So a
rebuilt world shows exactly the stage reached, with nothing to replay.

| Step | Where it happens | At the core |
|---|---|---|
| Nothing done | Fuse lamps red | The goop is dormant but clearly green; two green lights light the structure and the pit's fog from the rim |
| Fuse seated | That slot's panel lamp green | – |
| Breaker | The breaker's lamps: amber off, green on | Loop and turbine panel power lamps green |
| Valve | The valve's lamp red, then green | Sight glasses fill with coolant (3 s), pressure lamps amber, a faint blue light |
| Pump | The pump's run lamp green | Blue flow streams through every loop, the pump flywheels spool up (4 s), the blue light grows |
| Key | The key switch lamp amber, then green | CRDM rod lamps amber |
| Rods | The rod control's four task lamps green | The core wakes over 6 s: goop brighter and churning, green light ×4, the turbine fan spins up, then the win below |

The "where it happens" lamps are the mounted panel lamps of the restart overlays (`restartViews.ts`; round 2, lane PROPS: the disc + bulb
"status lamps on top of the machine" are gone, see below).

The glow lights are 2 green + 1 blue unshadowed PointLights created once at boot (intensity-only changes). Two of them are the
volumetric march's scatter lights with `userData.vfOpen`. Baked tinted virtual light-field sources over the goop add to them: half
are steady, half are on the powered circuit. QA: `__LL.reactorCore({tune})`.

### The coolant up close (task reactor-playtest-round2-20261102, lane COOLANT)
User: "coolant should look more like gooop flowing through pipes! its a little flat right now. You can use the current look for far
away rendering but switch to a high detail at close ish range."
- **Why it was flat:** the far look (`coreLiquids.ts`, kept for distance) is two thin slots per pipe glowing one constant blue, with dashes
  scrolling at 3.2 m/s. It has no depth, volume or thickness, and nothing moves at different speeds. The sight glasses are a flat fill.
- **The near layer** (`world/reactor/coolantNear.ts`, code-driven, no new texture or model):
  - Glass windows on every coolant pipe sit where the far slots are, but wider, with a steel bezel and ribs every 1.2 m. The ribs are
    static marks the flow moves past. The sight-glass sleeves and the spool windows are all glass.
  - Behind the glass, each pixel ray-casts the pipe bore, refracted by the glass. The goop's thickness along the ray gives a depth tint:
    thin and dark at the walls, deep with an emissive core glow through the middle.
  - Clumps and strands are 3D noise stretched along the pipe, in a fast core band and a slow wall band (laminar flow, which reads as
    viscous). A slower wet film streaks the glass. Bubbles ride the top of horizontal runs and rise faster up risers.
  - While the valve fills the loop, a meniscus rises through every pipe and glass.
- **State:** before the valve there is no near layer (the far slots show). Once pressurised the goop is still and dim. With the pump it
  flows (the near clock only advances with the pump's flow speed, about 1.3 m/s on the centreline) and is about 2.5 times brighter. Paused
  play never ticks. The coolant's blue PointLight is untouched.
- **LOD:**
  - Near only inside 8 m, far only beyond 12 m. Between them a static screen-space dither cross-fades, so each pixel draws exactly one of
    the two looks and nothing pops.
  - The CPU activates instances by point-to-segment distance: on inside 13.5 m, off beyond 16 m (hysteresis). It re-decides only after
    the eye moved 0.25 m. The fade never reaches a piece without a near instance.
  - The near zone grows out from the eye as the valve opens.
- **Cost:** two InstancedMeshes (tubes, spool windows) share one MeshBasic material: never a shadow caster, plain uniforms only (fade
  radii, clock). It compiles to 2 uniform buffers per stage on both backends (3 in the vertex stage without attribute instancing) and
  no texture. The far materials gain no buffer.
  - Draws: 0 away from the coolant or before the valve, at most 2 on the core floor.
  - Instances: real layouts peak at about 45 active tubes (cap 96). The layer is about 4,100 triangles at capacity.
  - The CPU-submit budget (`reactor-cpu-submit.test.ts`) now runs with the pump on and the near layer driven: +0 at its 9 views.
- Tests: `game/tests/reactor-x-coolant-near.test.ts`. QA: `__LL.reactorCore()` reports `near`; `__LL.reactorCore({near: false})` is an
  A/B switch to the far look.
- **Limits:** no fluid simulation. The noise is a look, not a flow field. The near clock wraps after about 14 h of pumping (one pattern
  jump). Only a CPU mirror of the shader was previewed (in `/tmp`), not the GPU.

### Mounted controls (the rule for every control that sits on a 3D model)
Code: `game/src/world/reactor/controlsMount.ts` (pure, shared by the kit and the restart), `controlsKit.ts` (the machines and the
generator start boxes), `controlsSkin.ts` (their look), `controlsModel.ts` (moving parts split off a model).

1. **Place the host model from its machine footprint, never from a control point.** `ReactorMachine` (x / z / yaw / w / d) is also
   the collider (`annexMachine` prop). The model's **measured mounting face** goes on the footprint's front plane, and its long axis
   follows the footprint's long axis. The switchgear bank is stretched to fill its collider exactly.
   - The pump's motor end faces the operator. It used to be turned 90° off its collider.
   - **The model never stands outside its collider into walkable space** (lane PATHS' audit, `world/reactor/pathsAudit.ts`):
     - the switchgear's outermost front (the lever handles) is on the collider front, with the door 0.26 m behind it and the
       cabinet back sunk into the wall;
     - the coolant valve is drawn at the uniform scale that fits its 1 × 1 m footprint (about 0.78);
     - the console's collider is 1.5 m deep and 1.55 m tall, covering the model;
     - collider heights equal the models' heights.
   - A layout without machine records derives one from its controls.
2. **Measure the face; do not trust the bounding box.** `HOST_FACES` holds faces probed from the cooked GLB vertex data. Use the
   *clear rectangle* of each face: no gauge, lever or hinge under it.
   - Example: the switchgear door is at z 0.39, but its bounding box front (the lever handle) is at 0.65. That 0.26 m was the
     "floating in front of the electrical box" gap.
   - `game/tests/reactor-x-controls-mount.test.ts` re-probes the GLBs.
3. **Mount the control in a frame on the face.** The origin is on the face, +Z is the face normal out of the model, +Y is the face's
   up.
   - The overlay's back plane sits `EMBED` (1.2 cm) inside the face. Nothing stands in front of the face without a support.
   - Its extent (`OVERLAY_EXTENT`) is clamped inside the clear rectangle, at the spot nearest the generated control point.
   - Switchgear controls take distinct cabinet sections.
   - The console's key switch and rod control sit on its 30° sloped desk.
   - The pump's start station sits on the motor end cover.
   - The coolant valve's handwheel **is the model's own wheel**: local mesh separation (every triangle above y 1.895) turns it about
     the stem. No second wheel is drawn.
4. **The pick volume is the mounted overlay's centre** (`MountedControl.pick`), not the generated point. The stand point stays GEN's.
5. **Generators:** the start control box stands flush on the generator model's measured end face (flat radiator end, |x| 2.69) or
   side face (|z| 0.59), whichever faces its panel point. It is grounded on a post, with the lever and lamps on its front. An end
   panel turns the model so the flat radiator end faces it.
6. **Look:** overlay housings take the Codex rusted-steel set (`REACTOR_TEXTURES`), tinted so its mean matches the host's measured
   paint (`HOST_PAINT` / `HOST_TINT`). Brass, buttons and handles use the existing painted / brushed steel sets. There are no flat
   untextured blocks.
7. **Checks:** the tests ray-cast from every overlay into the placed model's triangles on real layouts:
   - no gap, and nothing poking through;
   - the model agrees with its collider: long axis, centre, extent;
   - the generator boxes stand on the model face;
   - every control is reachable and pickable from its stand point.

### Floor-map boards
Code: `game/src/world/reactor/mapBoard{,Plan,Draw}.ts`.

- **Placement:** one physical board (1.5 × 1.25 m) beside each objective instruction board. The pit board, switchgear board, pump
  board and control monitor each get one.
  - It goes on the same wall if there is room, else on the nearest wall of the same room.
  - The wall is solid behind it and the floor in front is open: no doorway, no stair.
  - No tall prop, machine or wall sign may enter its volume; a low cabinet under it is fine. It keeps clear of other signs, controls
    and stand points.
- **The face:** a north-up plan of one storey from that level's real grid: decks, stairs, rooms, the side complexes' rooms, the pit
  outline and ladders. It also shows:
  - **X marks** at the ACTUAL positions:
    - the startup key and fuse cartridges where they lie now (live pickups);
    - the switchgear fuse slots and breaker, valve, pump, key switch and rods (their mounted overlays);
    - the three generators (`layout.reactor.generators`, inside their side complexes once carved).
  - X marks follow the state: carried shows an amber "use it here" ring at the destination; installed or started shows a check.
  - "You are here" with the facing arrow, a legend of the storey, and per-storey counts of open marks.
  - It shows no loot and no enemies.
- **Storey buttons:** small elevator-style buttons in a column at the right edge, one per storey; the lit one is shown. Press E on
  one (reach 2.3 m, in sight, no enemy in front) to show that storey.
- **Cost:** the canvas redraws only when its storey, its marks or the quantised "you are here" change. The marks rebuild only when a
  numeric signature of the record, inventory and live parts changes.

### Instruction boards and bullet impacts
- **Instruction text auto-fits.** Every line on the status screens is measured and shrunk to its column. Hint lines wrap into two lines
  rather than being cut. The switchgear instruction board is 2.2 × 1.3 m (it was 1.6 × 1.0 m, and its hint line was cut off).
- **Bullet impacts take the finish the builder drew.**
  - `world/finishAt.ts` resolves the arch-owned finish at a structural hit: walls from the remapped faces, floors and ceilings from
    the arch's own keys.
  - `damage/impactFinish.ts` maps it to the damage class, which sets the chips, sparks, dust, crater and sound. Pit concrete gives
    concrete; bar grating, deck undersides, and rusted-plate room walls and trim give structural steel sparks.
  - The station rule used to answer glazed tile, terrazzo or plaster there.
  - The Office's drywall, carpet, tile and slab now map too.
  - A plain Subway station has no arch finish and is unchanged. Knife contacts on surfaces use the same class. Damage numbers are
    untouched.

## The win (diegetic, bounded, no cutscene)
- The core comes alive (its glow ramps over about 6 s).
- Then the industrial lighting and fans sequence UP through the pit, tier by tier, from the core floor to the rim, over about 20 s.
  The pit's lamps are flicker circuit 2, held at 0 until now.
- The pit's gas clears (about 40 s).
- The control monitor and the rim board switch to the surface ventilation network: six pre-existing surface ventilation towers
  receive power one by one.
- A persistent local milestone "Reactor restarted / run complete" is written (localStorage `terminal-state.milestones.v1`), and the
  title screen shows its badge.
- The canon: the surface gas that turns people into zombies is being pulled out of the air, slowly. It is NOT a cure: the zombies
  stay and nothing despawns.
- The run continues; nothing is reset.

### Coming to life: startup audio, orange beacons, the ONLINE sky (task reactor-playtest-round2-20261102, lane STARTUP)
User: "real punch and depth as the reactor comes to life … spinning orange lights … play noise as the control rods are removed!" and
"when the reactor comes online the fog visible through the roof should clear, with a blue beam shooting up in to the sky".
Code: `world/reactor/startup.ts` (runtime, installed right after the restart), `startupPlan.ts` (the pure score), `startupAudio.ts`,
`startupBeaconPlan.ts` + `startupBeacons.ts`, `startupSky.ts`. QA: `__LL.reactorStartup({beaconLight, beamLight})`.
- **Driven only by the restart runtime**: its persisted record (a live change = a stage), its rod hold, its win clock. A build takes a
  baseline, a restored / QA-jumped clock crosses no cue, and a restarted world is rebuilt at the end state: nothing replays.
- **Audio** (Sound Lab startup set, 7 jobs of 12; `tools/audio-pipeline/reactor-startup-{plan.py,build.mjs}`; provenance
  `derivatives/audio-reactor-startup.json`), all world-placed through `Sfx.reactorCue` / `reactorLoop`:
  - each power stage: a contactor thump at its control, on top of the existing fuse / breaker / valve / pump / key cue;
  - a deep machine **bed** at the core from the breaker on, louder and faster with every stage;
  - the **rods**: the drive loop at the console and at the CRDM drives runs while the handle moves (rate rising with it), a heavy
    stop clunk when they are out, a light clunk if E is let go, silent on pause;
  - the win: the **surge** at the core as the rods come out (over the existing startup swell), the **ONLINE** impact + a deep thump
    at 6 s, each tier's lights clunking on up the pit (the existing breaker clip, pitch rising), a beacon motor at the nearest beacon.
  - Bounded: at most 4 own loops (`MACHINE_LOOP.max` 6 → 10: three generators + three fan zones already filled 6), the surge / ONLINE
    at voice priority 2.
- **Beacons**: up to 4 per storey (rim to the core floor, 24 on the QA seeds), on wall brackets 4.1 m over the deck above a mounted
  wall lamp, re-checked at that height (solid wall behind, no walkway / flight at the head, clear of fans / pipe banks, in an open
  band); audited as `extraSolids`. Three InstancedMeshes (body, turning lens, additive flare cone), one shared material each. The orange
  wave starts on the core floor as the rods come out and climbs the pit 6 s ahead of the floodlights. **Real light**: 3 SpotLights
  created at boot, swept with the 3 powered beacons nearest the eye (within 32 m).
- **The ONLINE sky** (at 6 s): an additive blue beam (one mesh: core, sheath, collar) from the vessel head up through the roof opening
  to 120 m above the roof, its head climbing in 1.1 s. Two PointLights created at boot cast its light: mid-pit (also a `vfOpen`
  scatter light, registered only while the beam is on) and under the opening. Over 28 s the surface air over the roof clears:
  `reactorOutdoorGas(roofY, rect, clear)` thins and lifts it, written through `ReactorAir.setOutdoorClear`, so the exposure and the
  march read the same object. The outside gas sheets / curtain fade (`MALL_SKY_U`, restored on teardown) and a cleared-sky dome
  fades in over the opening. No uniform array was added to the march.
- **Cost**: 5 lights in the boot light set (intensity only), at most 5 extra scene draws (3 beacon meshes; beam + sky dome only
  once ONLINE), no shadow casters, 2 × 24 matrices per frame while beacons turn. These sit outside `reactor-cpu-submit.test.ts`'s roots.
- **Limits**: the audio was never auditioned (structural QC only: `reference/tasks/reactor-playtest-round2-20261102-061947/audio/raw/
  QC.md`); the surge / ONLINE / bed takes are sub-heavy, so on small speakers the existing clips carry the mid-range. No browser or
  WebGPU check was run in this lane.
- Tests: `game/tests/reactor-startup.test.ts`.

### The beam ignition and the surface rain (task reactor-surface-ending-20261102, lane AUDIO)
User: "the reactor needs to have a noise when the blue beam shoots out the top!" and "It should be raining!".
- **Clips**: 2 Sound Lab jobs of the task's 6 (`tools/audio-pipeline/reactor-ending-{plan.py,build.mjs}`; provenance
  `derivatives/audio-reactor-ending.json`; private QC `reference/tasks/reactor-surface-ending-20261102-213051/audio/raw/QC.md`).
  `reactor-beam.mp3` is a whoosh swell, a broadband crack and a decaying column hum (3.1 s). `surface-rain-loop.mp3` is a 5.2 s
  loop. Together they are 68,753 B (64 kbps mono).
- **The ignition** is win cue `beam` (`startupPlan.ts beamCueAt`). It starts `BEAM_IGNITION_CRACK_S` (0.421 s, measured by the
  builder) before ONLINE, so its swell leads in and its crack lands as the beam fires (within one frame on the real runtime).
  - It plays once, at the point of the beam column nearest the listener (heard from the rim), high-passed at 120 Hz, at priority 2.
  - It follows the startup set's no-replay rules: a restored world, a QA jump or a revisit never repeats it.
  - The ONLINE impact and its deep thump drop to 0.7 / 0.6 to make room (`STARTUP_MIX`). The builder's worst-case sum at ONLINE
    went from +1.0 dBFS (before the beam) to −0.68 dBFS at the compressor input, with the same loudness (±0.5 LU).
- **The rain** is `world/reactor/audioRain.ts` (driven by the startup runtime) into `Sfx.rainBed`: one looping channel on the
  ambient bus, created on first use.
  - It plays only after the win: the ONLINE sky's clearing gates it.
  - By default it follows lane ENDING's `layout.reactor.surface`:
    - the plaza: full and open;
    - the head house: muffled, opening up towards the exit;
    - the stair: muffled, fading in as you climb;
    - the lower passage: faint;
    - anywhere else: silent.
  - The hook `setRainExposure(host, eye => ({level, muffle}) | null)` overrides the rule. A layout without a surface falls back to
    the roof line.
- **Limits**: never auditioned (structural QC only). The ignition is low-mid heavy outside its crack. No browser check was run in
  this lane. There is no separate beam hum loop: the existing core hum and bed carry the running beam.
- Tests: `game/tests/reactor-ending-audio.test.ts`.

## The train
The rim station is a shared Trench beside its start platform, so the shared player train (`gen/playerTrain.ts`
`playerTrainPlacement`, PR 33) parks there with no train-side change. It sits inside `layout.reactor.arrival`'s stop window, and a
start arrival spawns in the car. `layout.reactor.start` stays the platform start for callers without a train (round 2: in front of a
ticket-hall opening, facing it).

## Enemies
Existing families only. Density and the nastier families rise with depth (`docs/enemy-spawns.md` "The Reactor"):

- rat/dogs flank on the catwalks;
- Blightbellies are on the deep tiers;
- at most two sleeping Sirens are in deep side rooms;
- the Strainer appears only in the rim station's annex.

### Cross-storey hits (task reactor-playtest-round2-20261102, lane COMBAT; every level)
User: enemies on another storey (down the stairs, across an atrium, in the pit) could not be damaged, on every level.

- **Root cause:** `Game.fire`'s per-enemy cheap reject. It projected the enemy's feet onto the ray with the unit 3D direction's
  horizontal parts but never divided by their squared length. On a pitched ray the closest point fell short by D x sin^2(pitch),
  and an enemy more than 1.26 m from that point was skipped before its hit volumes were tested. Level shots barely pitch.
  Stairs (25-30 degrees), the atrium and the pit (35-55 degrees) skipped the enemy. The 3D world ray (`Levels.raycast`) was right.
  Render culling played no part: the hit test never read layers or visibility.
- **Fix:** `combat/enemyRay.ts` `nearestEnemyHit` is the one bullet / pellet test, used by `Game.fire` (every pellet) and the
  damage QA shot. Its reject is exact: the ray against the box around the enemy's own volumes. It has no storey filter and no
  render input, so `CULL_LAYER` / `LevelCuller.track` (PR 39's culling, unchanged) never removes a target. The world hit stays
  the limit: walls, slabs, closed lift doors and props still stop bullets. Melee, noise, gas, blasts and AI are unchanged.
- **Tests:** `game/tests/combat-cross-storey.test.ts` uses real Subway / Office / Mall / Reactor layouts and the real enemy
  actors. It checks every stair link down and up, atrium and pit shots for all five families, slab and closed-door blocks, the
  pistol / rifle / shotgun parts and pellets, a culled enemy still hit, brute-force parity and the wiring. On the same rays the
  pre-fix reject skipped 35 of 35 stair shots down, 33 of 35 up and 85 of 87 atrium / pit shots down.

## Lamps, the open top and gas visibility (expansion lane GASLIGHT)
- **Every pit lamp is a real, mounted fixture** (`gen/reactor/gaslightLamps.ts` `planPitLamps`, `LightPlacement.mount`):
  - wall brackets between the pilasters on every storey, clear of openings, pipe banks, fans and any walkway or flight at the head;
  - posts on the bridges and tower decks.

  `world/reactor/gaslightFixtures.ts` draws the bracket, post and cage (or the flood-lamp model) with the kit. The fixture's tube
  instance is the lens, so the glass glows exactly when the baked light does. The kit plans no decorative lamps.
- **Circuits:** the rim is on station power. Every third lamp and the lamps at the generator / stair landings are steady dim emergency
  lamps. The rest are on the powered circuit 2: dark glass and no light until the restart.
- **The sky through the roof opening** (was the whole top open; see "The roof opening" below): `levels[0].sky` sits at the pit roof
  line with a mask of the opening's cells.
  - `world/reactor/gaslightSky.ts` draws the Office's toxic sky dome and the outside gas sheets over the opening.
  - The march's regional term draws the toxic surface air above the roof line (`world/gaslightRules.ts` `reactorOutdoorGas`). The
    exposure reads the same function, and nothing walkable reaches it.
  - The same term draws the sky's light shafts into the pit.
- **Gas visibility** (root `CLAUDE.md` rule): the strata glow toxic green (`REACTOR_GAS_LOOK`) and the clean pit fog is neutral grey.
  A volumetric pass that is off falls back to the scene fog tinted by the eye's gas (`VolumetricAtmosphere.withGasFog`).
- **Core glow in the fog:** a `PointLight` added with `addScatterLight` and `userData.vfOpen = true` lights the haze and the strata with
  no occlusion window (open pit volumes).
- QA: `__LL.gaslight()` and `__LL.gaslightShafts({gain, fade, colour})`. Tests: `game/tests/reactor-x-gaslight-*.test.ts`.

### Fog visibility root cause (task reactor-submit-roof-fog-20261102, lane FOG)
User (WebGPU, quality high): "the fog is still not visible … volumetric fog is not working on this level."
- **Cause: a WebGPU binding limit, not the look.** Every TSL `uniformArray` is its own uniform buffer. three's `WebGPURenderer`
  requests no raised limits, so the device has WebGPU's default of 12 uniform buffers per shader stage. The base march fragment
  declares exactly 12. The depth-gas variant added the strata table as one more array: 13.
  - WebGPU rejected that pipeline layout, the pass flagged itself failed and the level rendered directly, with no volumetric fog.
    The user's overlay shows 4 / 5 render passes: the direct path's count. The fog pipeline draws 6 / 7.
  - The failure latches for the session. The Office compiles the same variant for its roof air since the expansion, so it was
    affected on WebGPU too.
  - The lead's llvmpipe WebGL2 spot check has more than 12 fragment uniform blocks, so it ran and hid the bug. The earlier "make the
    gas greener" round could not help: the program never ran.
- **Fix:** the strata table is now a 64 × 1 float data texture read with `textureLoad`. It holds the same Float32 values with the same
  interpolation. Every march variant declares 12 uniform buffers (base and depth alike, both backends), and the depth term costs one
  sampled texture (9 of 16).
  - **The march is at the limit.** A new array in it must replace one, never add one.
  - `runFog` now opens its error scope after (re)building the program. A rejected program falls back on its first frame instead of
    depending on frame timing.
- **Ruled out:** the level-change order (`setStation` → section hooks → `setDepthGas`, the same as a boot), uniform array updates,
  the HIGH preset's march cap (52 m reaches the core floor), the source rect and the gates. None depend on the eye's exposure.
- Tests: `game/tests/reactor-x-fog-webgpu-limits.test.ts` covers the binding budget per variant and backend, view rays from the
  clean rim (drawn = hazard, green and visibly dense), clearing, level change = boot and the error-scope order.

### The roof opening (task reactor-submit-roof-fog-20261102, lane ROOF)
User: "I want a single hole above the reactor not a totally open roof."
- **Cause:** the expansion's `openPitRoof` marked the whole rim storey as open sky (`levels[0].sky` with no mask). So no roof slab was
  built over any pit cell, and only a row of girders stood against the green sky.
- **The rule** (`gen/reactor/roofOpening.ts` `roofOpeningOf`): one round opening centred on the core.
  - Its radius is 1.2 × the core radius: a 16.8 m diameter over the 7 m vessel. The vessel and its service ring read through it from
    every tier.
  - It is clamped to leave the curb plus at least 6 m of solid roof to every pit wall. On real pits the clamp never bites: about 11 m
    of roof remains each side.
  - A pit with no room for it keeps a closed roof: no sky and no shafts.
  - Every reader derives the opening from `layout.reactor`, so nothing is stored twice.
- **Generator:** `levels[0].sky.open` (`gen/levels.ts` `LevelSky.open`) marks only the cells that touch the disc.
  - Rays leave into the sky only through those cells. Every other band top at the roof line is a ceiling, and closed columns are
    solid at every height.
  - The Office's unmasked roof is unchanged. The mask is re-windowed with the grids on Track 2 growth (`gen/trackExt/core.ts`).
- **The roof** (`world/reactor/roofKit.ts`):
  - **The slab** is one mesh: the builder's dark `reactor-roof` concrete over the pit outline, with a true round hole.
    `ReactorArch.ceilKey` hands the builder none of its roof-line runs: about 17 per-level / per-chunk meshes become 1. The slab also
    spans the open-well wall flights, which the builder never roofed.
  - **The steel grid** under the slab: the old girder lines plus secondary beams 3 m apart, as instances of the existing band-0
    I-beam mesh (no new draw call).
  - Every member is trimmed into the curb ring and kept out of the crane trolley's body. No beam crosses the hole.
  - **The curb:** a closed steel ring girder under the slab (1.3 m wide; the grid's stepped hole edge hides above it) and a 0.6 m
    concrete upstand. They are two lathe meshes using existing kit materials.
- **Through the hole only:**
  - The sky dome (centred over the opening, inside the far plane) and the outside gas sheets are covered everywhere else by the slab,
    the curb and the walls.
  - The march stops at the slab, so the toxic outdoor air (`reactorOutdoorGas`, unchanged: what hurts is what shows, and nothing
    walkable reaches it) shows only through the opening.
  - The light shafts (`PIT_SHAFTS`, `shaftAt`) fall only through the opening disc, with a soft 1.5 m rim. The march reads one plain
    `shaftHole` vec4 (no new uniform array). Their direction is steepened to [0.1, −1, 0.06], so the column lands on the reactor.
- **Known:** the towers' reserved leg columns (concrete-faced, core floor to the roof line) can meet the curb ring when a tower stands
  about 10 m from the core. They read as columns carrying the ring.
- Tests: `game/tests/reactor-x-roof-opening.test.ts`, plus the updated `reactor-x-gaslight-*.test.ts`.

## Pathways: the clipping audit (task reactor-expansion-20261101, lane PATHS)
Nothing solid may stand in walkable space except designed edges (railings on the edge line, wall-flush fittings within 0.1 m).
- **The audit** (`game/src/world/reactor/pathsAudit.ts`, tests `game/tests/reactor-x-paths-*.test.ts`):
  - `auditReactorPaths(layout, {models, areas})` checks the body volume of every walkable cell of every storey against every solid
    the kit draws and against the collision world. The body is 1.9 m tall; stair cells follow their pitch line.
  - The solids are kit instances, lamps, models, merged meshes, fan rotors and pit fixtures.
  - The collision checks cover rails across a path, the ladder climbs (player and AI) and the designed stand points: link landings,
    ladder feet and heads, controls, generators and the train's doors.
  - It reports hits by kind and location. Pass `areas` to audit one side complex.
  - **Re-run after a lane lands:** `auditReactorPaths(layout, {models: 'all', meshOf: testMeshOf})` (`testMeshOf` in
    `game/tests/reactor-x-paths-meshes.ts` reads the cooked GLBs, so portal-shaped models are judged by their real triangles), or the
    test file `game/tests/reactor-x-paths-audit.test.ts`.
    - Visuals planned through the kit (`KitPlan.add` / `placeModel` / `merged`) are covered automatically.
    - Another builder's visuals must be added to `extraSolids()` in `pathsAudit.ts`. Mines, bunker and the map boards are there now.
    - `PATHS_OWNED_ELSEWHERE` in the test pins other lanes' known findings at their measured depth.
  - A solid inside its own collision prop's box is not a clip, since the body collides with it. Floor-level detail up to 0.16 m (the mine
    rails and sleepers) is walked over, like the subway track bed.
- **The fixes it drove:**
  - A deck record is its real cells (`gen/reactor/pathsGen.ts`), so no stringers hang over a stairwell.
  - No rail runs across a stair mouth or a seam between storeys, and every maintenance ladder head has a 0.9 m opening in the rail.
  - Steel stays out of walkways. The kit consults `WalkVolume` (`KitOptions.walk`): shortened knee braces, fascias and toe plates only
    on drop edges, post lamps only on railings, tower portals where a walkway crosses a face, flat pilaster straps (none across
    doorways), cables over the landing and flat on the walls.
  - Fan housings stay clear of walkways and tower legs stand in reserved 2 x 2 cells.

### Round 2 props: lamp glass, ceiling cables, the drill, no floating beacons (task reactor-playtest-round2-20261102, lane PROPS)
User bullets 10–13. Tests: `game/tests/reactor-props-r2-{lamps,cables,drill}.test.ts`.
- **"Strange box in front of" the lights (10).**
  - **Cause:** every pit / mine lamp's glass was the station's flat tube instance (`light-tubes`). On the flood-lamp model it became a
    0.17 × 0.24 m opaque plate 1 cm in front of the cage, placed on the GLB's bounding-box "lens face", not on its glass jar.
    Procedural cages showed a glowing cube, and the mines' pendants a glowing square under the cage.
  - **Fix:** `world/reactor/propsLampGlass.ts`. The glass is a jar-shaped lathe glow inside each cage. On the model it sits between
    the measured glass (≤ 0.081 m off the jar axis) and the cage bars (≥ 0.094 m). Procedural cages get the same jar scaled in.
  - It is one InstancedMesh (`light-glass`, one extra draw call) over the tubes' light indices. It shares their `instanceColor` and
    material, so `world/lights.ts` still drives lit, held circuit-2 and flickering glass per fixture. The lamp's tube instance is
    collapsed. The cast light and the housings are unchanged.
- **Floating discs with lights on top (13).** These were removed:
  - `coreHero.ts`: the restart sites' disc + bulb "on top of the machine". It was placed from the unscaled model height, so it
    floated over the valve wheel, switchgear, pump and console. Also removed: the beacon over each pump's open flywheel guard, and
    the one on each manifold stand.
  - `wasteVisuals.ts`: the waste repository's dome-on-a-black-base beacons, 2–22 cm above racks, gates and door heads.

  The state lamps are the overlays' mounted panel lamps (table above) and the core's box-face lamps. Lane STARTUP owns the
  rotating beacons.
- **Guide cables along the roof (11).** Source: `gen/reactor/complex/propsCable.ts`; `host.ts` uses it, with the old route as the
  fallback.
  - **Was:** one height for the whole complex (≤ 0.25 m under the lowest door head: ~2.15 m), string-pulled diagonally across rooms
    and straight through the top of every door opening.
  - **Route:** a least-cost route over whatever rooms the carver generated, from the use point to the entrance. It runs in straight
    axis-aligned runs, prefers walls, and pays extra where something takes the ceiling band.
  - **Height:** every run hangs 0.12 m under its ceiling on drop rods. It passes over what stays low (door-frame headers, plates,
    cabinets) and under what reaches the ceiling band (fixtures, the bunker's corridor ducts, the mines' timber set caps, read from
    their post pairs). It never drops below 2.15 m over the storey floor.
  - **Free bands:** each cell has a free band [low, top]: the highest free height under the ceiling, down to the highest obstacle the
    cable passes over, never under the 2.15 m line. The route steps onto a neighbour only where the two bands overlap. A straight run
    hangs at the top of its cells' common band; where that band is empty it splits into pieces, and steps happen inside the bands.
    A drift too low for the tray is blocked, and the route takes another way. Cause of the final-head regression (seed 218558,
    mines): a merged piece's common height used to descend past an obstacle one cell passed over, under the headroom.
  - **Steps:** a run steps only where the open height changes for ≥ 2 m, so there is no saw-tooth between timber sets.
  - **Walls:** every wall is crossed as a sleeve. The tray rises or falls at a riser cell 1–3 cells back from the wall, where the
    column is clear from 2.15 m up, and three wires pass through the wall (`cableSleeves`; `archKit` draws only the wires). A crossing
    goes over the door's lintel, 2 cm above the head and up to 6 cm under the ceiling, so it clears WASTE's frame headers. Where the
    lintel has no room, it goes through the wall beside the jamb (≤ 3 cells). It is never in the opening under its head. The one
    exception is an opening whose head is flush with the ceiling (no lintel exists): there the wires hug the ceiling.
  - **The entrance:** the cable leaves just over the entrance lintel, or beside it onto any pit-deck area in front of it. ARRIVAL's
    seeded entrance decks can be as narrow as the door. `cableOf` then continues along the pit walls to the fans.
  - **Fallbacks:** if the layout's obstacles leave no route, the router retries with a bare field: the same door rules, no obstacles.
    The legacy single-height route is the last resort. Either fallback is recorded in `ReactorGenerator.cableFallback`; the tests
    require neither.
  - **Checks:** `ceilingCableIssues` (door volumes, headroom, ceilings, every obstacle; sleeves judged by their wire bundle) and
    `CEILING_CABLE_STATS` (QA).
  - **Measured** on 12 real seeds × 3 complexes (final head): every strict route found at generation, 0 issues, about 10–60 ms per
    complex. The cable test covers all 12 seeds.
- **The drill (12).** `MINES_FIT.drillRig = 1.9` (`world/reactor/minesAssets.ts`). It is a derived transform of the same GLB: no
  re-cook and no byte change. Lane MINES' collider, heading and instance scale read it.
  - Scale check beside zombie lastshift (1.78 m, runtime scale 1): 6.65 × 2.43 × 1.87 m (W × H × D). The wheeled carrier is 4.04 m,
    the boom reaches 2.43 m, and the tyres are about 0.95 m.
  - It is grounded with 10 contact clusters, all on the 4 tyres (gap 0).
  - It was 3.50 × 1.28 × 0.98 m.
- **Limits:**
  - No browser check. The lamp glass is checked against the cooked GLB's vertices, not a GPU render.
  - The pit-side part of the cable is the old `cableOf` along the pit walls. It now starts about 0.6–2.4 m higher, just over the
    entrance lintel; it is not re-routed. STARTUP's beacons are planned after the cables, so `planBeacons` now skips any wall-lamp
    spot whose bracket / head envelope comes within 0.25 m of a generator cable (`onCable`). It was 0 m on 11 of 18 cables over 6
    seeds; it is now ≥ 0.29 m beyond the envelope, and at least 2 beacons per tier remain.
  - The timber caps come from the post pairs that `minesDress` places. If MINES changes that convention, update `cableObstacles`.

## CPU submission (task reactor-submit-roof-fog-20261102, lane CPU)
The user's frames were CPU-bound in render submit: 21.7 ms for 1,230 draws on the rim gallery and 15.3 ms for 1,048 draws looking
down the pit, against about 4 ms of GPU (WebGPU). That is about 15–18 µs of CPU per draw: each draw is a three r186 render object
(node / uniform / binding refresh plus encoded commands), in the scene pass and, for casters, again in the flashlight's shadow pass.
The fix cuts the number of render objects. Nothing drawn changes.

**Root causes** (seed 000070S; Node census on the real build path):
- The culler knew the pit only as an atrium, so every storey seen through the pit counted as visible. From the rim gallery, about 600
  scene draws were submitted and only about 90 owned a visible pixel (depth oracle). The rest were rooms, the three side complexes,
  holders and dressing behind the pit's rock or under the storey slabs.
- Holders, openables and purpose dressing were chunked in 12 m cells across all six stacked storeys. A chunk could only be culled when
  every storey in it was hidden.
- The enemies (3–5 skinned meshes each, in both passes) and the floor pickups were frustum-culled only. Looking down from the rim, 32
  enemies were in the cone and 13 of them were behind rock.
- The procedural kit was one InstancedMesh per part and depth band (about 19 parts × 6 bands). From the pit, nearly every band is in
  view, so the same instances cost about six draws per pass.

**Changes:**
- `world/levelCulling.ts`: the mall's exact slab and same- / cross-storey occlusion now also runs on the Reactor (`world/builder.ts`).
  The vessel's grid column, which the builder does not draw, counts as see-through (`ReactorArch.occlusionSee`).
- `LevelCuller.track`, through the runtime `world/reactor/cpuActorCulling.ts`: enemies and pickups are decided by the same rules on
  every update. An enemy's box is its meshes' cull spheres at the root's current transform. Ragdolls are never hidden.
- The mall's storey-split chunks and the per-storey, culler-decided loot display now cover the Reactor too (`byStorey`).
- `world/reactor/archMeshes.ts`: one InstancedMesh per kit part. The instances, materials and transforms are the same; no uniforms
  were added.

**Before → after** (draws per frame, scene + shadow pass; static world, holders, loot display, enemies and pickups; feature branch with
ROOF and FOG):

| Seed / pose | Before | After |
|---|---|---|
| 000070S rim gallery (along it) | 1,005 | 486 |
| 000070S rim, looking down at the core | 1,032 | 614 |
| 000070S tier-2 deck, across the pit | 956 | 561 |
| Worst of 9 views (3 seeds) | 1,165 | 714 |
| Sum over 77 oracle poses (decks of every tier, core ring, complex rooms) | 55,130 | 26,132 |

**Evidence and limits:**
- Correctness: on 77 poses the depth oracle finds no culled mesh visible from the eye. Nothing the new rules hide is seen by the
  flashlight within its 30 m. None of 2,731 hidden enemy / pickup boxes owns a pixel from either view.
- The culler costs more per moving frame: in Node on the studio pod, `culler.update` went from 0.71 ms to 1.42 ms (tracking sync
  0.02 ms). This is part of render submit, against 400–500 fewer draws.
- These are Node estimates of three's render lists, not native timings. No FPS is claimed.
- Viewmodel, post quads, restart controls and map boards are not counted. Pickups use stand-in item models in Node.
- The shadow pass still draws every caster in the torch cone.
- `game/tests/reactor-cpu-submit.test.ts` pins the budget and the oracles; `LL_REACTOR_CPU_OUT=/tmp/x.txt` writes the numbers.
- QA: `__LL.reactorCpu()` reports the culler's decision, and `__LL.reactorCpu({rules: false|true})` is a browser A/B switch.
