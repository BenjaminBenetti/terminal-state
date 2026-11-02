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
| Tests | `game/tests/reactor-*.test.ts` (`reactor-level.test.ts` runs every lane on real generated layouts) |

## The level, top to bottom (one continuous world; the rim at y 0, depth negative)
- **Rim** (`levels[0]`): a real subway station. One platform of about 70 m beside a track bed (tunnels continue past the bed ends;
  at most one Beyond-the-Station annex). Wide openings onto the railed rim gallery give the first view down to the core. The rim
  control office holds the startup key and the pit status board.
- **Four walkway tiers** (about 6 m apart): steel galleries on the pit walls, big landings for the generators, bridges across the
  pit to 1–2 free-standing lattice towers, and side rooms cut into the rock (maintenance stores, the switchgear room on tier 4).
- **The core floor** (about −30 m): the ring round the domed vessel, the pump hall and the control room overlooking the vessel.
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

### Mounted controls (the rule for every control that sits on a 3D model)
Code: `game/src/world/reactor/controlsMount.ts` (pure, shared by the kit and the restart), `controlsKit.ts` (the machines and the
generator start boxes), `controlsSkin.ts` (their look), `controlsModel.ts` (moving parts split off a model).

1. **Place the host model from its machine footprint, never from a control point.** `ReactorMachine` (x / z / yaw / w / d) is also
   the collider (`annexMachine` prop). The model's **measured mounting face** goes on the footprint's front plane, and its long axis
   follows the footprint's long axis. The switchgear bank is stretched to fill its collider exactly.
   - The pump's motor end faces the operator. It used to be turned 90° off its collider.
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
