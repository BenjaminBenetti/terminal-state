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
