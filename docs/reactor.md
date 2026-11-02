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
| Air (gas + generators) | `game/src/world/reactor/{air,generators,airHud,airQa}.ts`; the exposure term in `world/gas/system.ts`; the reactor-only march term in `render/volumetric*.ts` |
| Restart + win | `game/src/world/reactor/{restart,restartLogic,restartWin,restartScreens,restartViews,restartItems,restartQa}.ts`; `run/milestones.ts` |
| Rendering (the kit) | `game/src/world/reactor/{arch,archKit,archMeshes,archMaterials,archAssets,archVisuals,archHaze,archInstall}.ts` |
| Mounted controls, floor maps, impacts | `game/src/world/reactor/{controlsMount,controlsKit,controlsSkin,controlsModel}.ts`, `game/src/world/reactor/mapBoard{,Plan,Draw}.ts`, `game/src/world/finishAt.ts` + `game/src/damage/impactFinish.ts` (see "Mounted controls" / "Floor-map boards" below) |
| Assets | `game/src/assets/reactorKit.generated.ts` (13 Meshy T2.5 models + 3 Codex surface sets; `tools/asset-pipeline/props/build-reactor-kit.mjs`), `game/src/audio/manifest.reactor.generated.ts` (9 Sound Lab clips; `tools/audio-pipeline/reactor-{plan.py,build.mjs}`) |
| Core floor + hero reactor (task reactor-expansion, lane CORE) | `game/src/gen/reactor/coreFloor.ts` (vessel footprint, service ring, goop pool, bridges, loop / turbine layout, `layout.reactor.coreFloor`); `game/src/world/reactor/{coreHero,coreLiquids,coreStages,coreVisuals,coreLights}.ts` (the assembled structure, the dynamic goop / coolant layer, the staged startup, the glow lights) |
| Tests | `game/tests/reactor-*.test.ts` (`reactor-level.test.ts` runs every lane on real generated layouts) |

## The level, top to bottom (one continuous world; the rim at y 0, depth negative)
- **Rim** (`levels[0]`): a real subway station. One platform of about 70 m beside a track bed (tunnels continue past the bed ends;
  at most one Beyond-the-Station annex). Wide openings onto the railed rim gallery give the first view down to the core. The rim
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
  towers, vessel) is always there.

## Side complexes off the shaft (task reactor-expansion-20261101)
Each zone's generator lives in a substantial side complex: zone 0 in the **bunker** (tier 1), zone 1 in the **old mines** (tier 2)
and zone 2 in the **waste repository** (tier 4). The host is `game/src/gen/reactor/complex/host.ts`; the contract is
`complex/types.ts`; the carvers are `complex/{bunker,mines,waste}.ts`.
- **Slot**: an 80 × 64 cell region (40 × 32 m) of rock behind the stair, organ or south pit wall. The wall is a seeded permutation
  with a fallback; never the north wall under the station. The region's pit-side row is the pit wall. A carver keeps one cell of
  wall inside every edge. When planned, the region is solid rock on every storey. Rooms of the same storey avoid it. Rooms of other
  storeys may lie above or below it: `ceilMax` (the deck above minus a slab) keeps the storeys apart.
- **Entrance**: a 6-cell (3 m) span of that wall row, in front of flat cells of one deck area (`frontArea`). A landing comes first;
  on the stair wall this is the old generator landing, now the entrance landing. The carver carves the door from that deck, at
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
`complex/bunker.ts` (carver), `bunkerPlan.ts` (the program in a wall-local frame), `bunkerDress.ts` (dress hook), `bunkerPurposes.ts`
(its own room purposes), `bunkerKinds.ts` (hero prop kinds), `world/reactor/bunkerModels.ts` (their instanced models).
- **Program** (15–16 spaces, ~1000 m² walkable, rooms 3.2–4.0 m clear, the hall up to `ceilMax`):
  - the **blast-door lock** behind the entrance (heavy hazard-striped frame, "SHELTER 7 · CIVIL DEFENCE" plate on the gallery side);
  - a 1 m **bulkhead** holding the round **blast door** (`REACTOR_X_KIT.blastDoor`, its leaf standing open; a 1.5 m lane over a
    0.84 m threshold, three 0.28 m risers each side);
  - **decontamination**, the **guard post** (doors into the lock and the muster corridor: a level way round the threshold);
  - the **muster corridor** across the bunker, two **spine corridors** to the **generator hall** (two ways in), the **mess hall**
    between them (opening onto both, sometimes the muster corridor too);
  - side rooms by size: **dormitories** (bunk rows, footlockers, lockers), air **filtration plant**, **infirmary**, **radio room**
    (console), **latrines**, stores, workshop, warden's office, ration store, locker room;
  - off the hall: the **switch room** and the dead-end **armoury** (the reward: gun lockers, ammunition cabinets, crates).
- **The generator**: mid-hall, long axis along the hall, the use point beside the end facing the switch-room side; a grated cable
  trench to the switchboard panels on that wall, a hazard outline, two diesel day tanks on their bund, a second row of fixtures.
- Seeded variation: the blast door's facing (its leaf in the lock or the decon), the guard post side, room widths / row splits,
  hall depth, which room takes which slot, door positions, the armoury side, the muster-to-mess opening.

## Gas: two approaches, no deadlock
- **Depth gas** (`ReactorAir`, a pure function of height): three zones.
  - Zone ids are 0-based: tiers 1–2, tiers 3–4, the core floor.
  - Stratified and thickening downward, with readable bands; the rim breathes.
  - Exposure goes through the existing threshold / dps / mask + filter / HUD / cough path. The Blightbelly's puffs and every other
    level's gas are unchanged.
- **Generator route** (no mask needed):
  - Each zone's auxiliary generator stands in air that is already clean or cleared: tier 1, tier 2 and tier 4.
  - Hold E 2 s to start it. It cranks, then its zone's fans spool and the zone clears in 3 visible stages (top first, about 55 s).
  - The clearing persists, and revisits never re-roll it.
  - A running generator is LOUD: it alerts existing enemies at the landing. Nothing spawns.
- **Filter route:** wear the mask and spend filters. The level always holds one mask and a tight filter supply, and the core floor is
  deadly without one. Mixed play (clear what you fight on, mask through what you cross) is expected.

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
| Fuse seated | That slot's lamp amber | – |
| Breaker | Every switchgear lamp green | Loop and turbine panel power lamps green |
| Valve | Valve beacon amber | Sight glasses fill with coolant (3 s), pressure lamps amber, a faint blue light |
| Pump | Pump beacon blue | Blue flow streams through every loop, the pump flywheels spool up (4 s), the blue light grows |
| Key | Console key lamp amber | CRDM rod lamps amber |
| Rods | Console rods lamp green | The core wakes over 6 s: goop brighter and churning, green light ×4, the turbine fan spins up, then the win below |

The glow lights are 2 green + 1 blue unshadowed PointLights created once at boot (intensity-only changes). Two of them are the
volumetric march's scatter lights with `userData.vfOpen`. Baked tinted virtual light-field sources over the goop add to them: half
are steady, half are on the powered circuit. QA: `__LL.reactorCore({tune})`.

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

## The train
The rim station is a shared Trench beside its start platform, so the shared player train (`gen/playerTrain.ts`
`playerTrainPlacement`, PR 33) parks there with no train-side change. It sits inside `layout.reactor.arrival`'s stop window, and a
start arrival spawns in the car. `layout.reactor.start` stays the platform start for callers without a train.

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
