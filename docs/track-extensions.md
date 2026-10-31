# Track extensions: tunnels beyond the station and service annexes

Track 2, "Beyond the Station". This is the reusable interface for every level whose station has track beds: the Subway, the
Office's street station, and future levels such as Eaton Mall.

## Overview

The tracks no longer end at a black wall. Past a bed end, a finite concrete tunnel continues:
- the same box section and width as the bed;
- 30–110 m long, with 0–2 bends;
- closed by a physical cap: a rubble heap, a concrete bulkhead or a closed gate.

Off a tunnel's side wall, or behind a **service hatch** in the outer wall of a bed, a level can have up to two seeded
**service annexes**. These are cramped, dark back-of-house areas about a quarter of the Subway's walkable exploration area
(`SUBWAY_WALK_BASELINE_M2`, about 0.17–0.29 of it). Each is dressed, lit, populated and stocked like the station, all in the
same level and world, with no loading. Graffiti arrows and tags appear only where a real route leads to an annex, and (playtest
revision) the platforms announce every real annex entrance with station-surface art: see "Station invitation art" below.

## Opting a level in

1. **Declare it in the registry.** In `game/src/levels/registry.ts`, `LEVELS[id].trackExtensions` is a required field:
   `TrackExtConfig | 'none'`, read from `trackExtConfig(id)` in `game/src/gen/trackExt/config.ts`.
   - `'none'` keeps the black end walls and barricades.
   - `game/tests/track-ext-coverage.test.ts` fails when a generated level has track beds but declares neither a config nor
     `'none'`.
2. **Generate in this order:**
   - After all of its own carving, the generator calls `extendTracks(k, rng.fork('track-ext'), cfg, ctx)` from
     `game/src/gen/trackExt/index.ts`. It takes any `Kit` with trenches; `ctx` is
     `{levelId, canvasGrow: 'any' | 'east-south', origin?, maxCells}`.
   - After every core pass:
     - `finishExtensions(layout, ext, {ox, oy, grow})` embeds the finished core into the larger grid its extensions need. With
       `'any'` (the Subway), a west or north extension translates the core. With `'east-south'` (a fixed crop origin, as in
       the Office), the grid only grows east and south.
     - Then `populateExtensions(layout, rng, {loot, spawns, dressRng})` from `game/src/gen/annexContent.ts` dresses, lights,
       stocks and populates the extensions.
3. **Declare the spawn context.** Add an explicit `contexts.service` (`SERVICE_CONTEXT`, `game/src/ai/spawnTables.ts`) in the
   level's spawn profile, then follow [docs/level-enemy-contract.md](level-enemy-contract.md).
4. **Register the reference adapters** in `tools/pages` (`LEVEL_ADAPTER`, `ENEMY_LEVEL_ADAPTER`). The pages build then shows
   the annex loot and the service context.

## Configuration (`TRACK_EXT` / `TRACK_EXT_OFFICE`, `game/src/gen/trackExt/config.ts`)

| Setting | Values |
|---|---|
| Tunnel length | 30–110 m |
| Bend arcs | 0 / 1 / 2, weights 0.35 / 0.45 / 0.2 |
| Bend radius | 14–30 m |
| Total turn | 80° or less |
| Cap kinds | rubble / bulkhead / gate, weights 0.45 / 0.3 / 0.25 |
| Cap depth | 1.5 m |

**Annexes:**
- **How many per level:** `annex.count` weights are 0.07 / 0.53 / 0.40 for 0 / 1 / 2 annexes. The level tries tunnels first,
  then hatches; a failed attempt is omitted with no orphan door, clue or cell.
- **Size:** `share` 0.25 of the baseline, jittered by 0.85–1.15, minimum `minShare` 0.15.
- **Layout:** corridors 1.5–2 m wide; rooms from 3×3 m to 8×10 m; ceilings 2.4–2.8 m.
- **Door placement:** a tunnel that hosts an annex gets a first straight of at least 21 m (`annex.hostFirstStraight`), which
  leaves room for the door.

**Core reserve (Subway only, `coreReserveM` 40):**
- Right after the archetype skeleton, 40 m of rock is kept free past every bed end that is still open, so the rest of the
  station plans around the tunnel room. This is a deliberate layout change to the core station, made for annex incidence.
- With `coreReserveM: 0` (`TRACK_EXT_RESERVE_OFF`, `game/tests/helpers/trackExtCore.ts`), the core reproduces the earlier pins.
- The Office uses `TRACK_EXT_OFFICE`: no reserve and the original annex planner.

**Service hatches:**
- **Why they exist:** island-ends and express stations have their paid-concourse end halls 1.5–4 m past every bed end, so no
  tunnel fits.
- **How they work:** an annex there is reached through a door in the bed's outer side wall near an end, 2–10 m from the end
  face, never in a platform face. The annex sits at bed floor height. The way back is the bed's own ladders.

**Measured incidence** (64-seed corpus): 60/64 Subway levels have at least one annex and 18/64 have two (0 / 1 / 2 =
4 / 42 / 18); 16 of 78 annexes are behind a hatch.

## The Eaton's Center (`mall`, task track3-eaton-centre-20261031, lane INTEG)

The mall opts in like the Office (a fixed crop origin):
- `LEVELS.mall.trackExtensions = trackExtConfig('mall')` = `TRACK_EXT_MALL`: `TRACK_EXT` (the GEN-2 incidence planner and service
  hatches) with `coreReserveM: 0` — the reserve is a Subway skeleton step the mall never runs, so the mall's core layout is unchanged.
- `gen/mall/index.ts`: `extendTracks(k, rng.fork('track-ext'), cfg, mallTrackExtContext(ox, oy))` after all mall carving and before
  the crop (`canvasGrow: 'east-south'`, origin = the fixed crop origin, `maxCells` `MALL_EXT_MAX_CELLS` 75k; the core grid is
  ~39–51k cells); after the LAST core pass (hordes included) `finishExtensions(layout, ext, {ox, oy, grow: 'east-south'})` and
  `populateExtensions(layout, rng, {loot, spawns, dressRng: rng.fork('dress')})`; then the ONE family roll and the Siren spacing.
  Every mall global pass (shops, landmarks, ambient spawns, supplies, lighting, hordes, the patrol graph, the mall record) runs
  before the attach, so none ever sees an extension area. Invalid extensions are dropped (`dropExtensions`), never a core retry;
  `mallIssues` includes `extensionIssues`. `layout.mall.subwayRoot` is a derived report, recomputed after the attach.
- Spawns: `SPAWN_PROFILES.mall.contexts.service = SERVICE_CONTEXT`; the Siren's eligibility names `ring` only. Loot: the mall loot
  profile's base tables carry `floor.annex` (`ANNEX_FLOOR`); `LEVEL_ADAPTER.mall.annex` is on.

**Storeys above the station (`TrackExtContext.rockLevels`, opt-in, lane INTEG).** With the default rule (every level grid must be
rock around an extension cell — right for the Subway's overlapping upper / lower levels) nothing fits the mall: both bed ends log
`none: blocked at the mouth`, because the six rings (5 m above the station, slabs between) cover the whole footprint and the mall's
beds end under the rings' end galleries. The mall therefore declares `rockLevels: [0]` (`mallTrackExtContext`): only the pit storey
must be rock; another storey may stand above an extension cell when it is solid there or its floor clears the extension's ceiling
by `EXT_STOREY_SLAB` (0.3 m; the bed ceiling is 4.4 m, ring 1 stands at 5 m), never its VOID (the atrium). The planner's core mask,
the hatch wall test, `attachExtensions` and `extensionIssues` honour it; levels without it (Subway, Office) are unchanged.
- Hatches stay refused in the mall (both beds of its `sideBlock` are flanked by side platforms), and the west bed end lies behind the
  fixed crop origin (east / south growth only), so a mall has at most ONE tunnel (east) and one annex.
- Measured (48 generated malls: 16 seeds `9100 + 104729k` x 3 variants; every attempt valid first time, none dropped):
  - 1 tunnel per mall (east end), 45.5–103.5 m (mean 69.6), caps bulkhead 24 / gate 18 / rubble 6;
  - annexes 0 / 1 / 2 = 3 / 45 / 0 (the 3 are one seed's "wants 0" draw), 1135–1957 m² (mean 1604), 47–84 areas;
  - `service` spawns 3.88 per run (4.13 per annex, max 5): zombie 169 / rat-dog 13 / Blightbelly 4, no Siren;
  - annex loot: 64–120 holders per annex (2 stashes each, the rest picked over), 2.5 annex floor finds per run;
  - the core mall (spawns with their families, loot, props, lights, hordes, patrol graph, shops) is hash-identical with and without
    the extensions (12 malls); the grid grows 1.29–1.86x east / south (55–75k cells, `MALL_EXT_MAX_CELLS` 75k).

## Data model (`game/src/gen/trackExt/types.ts`)

`layout.extensions?: TrackExtensions` holds `{tunnels, annexes, log, core, shift, coreXZ, vents?}`.

**`TrackTunnel`:**
- `trench`, `from` (`'x0' | 'x1'`), `floorY`, `ceilY`, `width`;
- `path`: a world-metre centreline starting on the bed end face;
- `length`, `rails`, `cap`, `areas`;
- `doors`: annex entries;
- `clues`: graffiti, present only on tunnels that lead to an annex.

**`ServiceAnnex`:**
- `tunnel`: `-1` for a hatch annex. Guard every `tunnels[annex.tunnel]` lookup.
- `door`, `areas`, `floorY`, `ceilY`, `cells`, `areaM2`, `exit`.
- `bed?`: a `BedEntry` for hatches. Its door record has `a === b ===` the entry corridor, because the bed has no area. Hatch
  graffiti lives in `BedEntry.clues`.

**Areas:**
- Extension areas carry `area.ext = 'tunnel' | 'annex'` plus `extId`.
- `isExtensionArea(area)` is the one marker every existing global pass skips, so a level's core content and RNG baseline are
  preserved.
- Extension props, lights, holders, pickups and zombies are appended after every core record.

**`StationArt`** (`TrackExtensions.art`, playtest revision): station-surface invitation art records — see "Station invitation art".

**`coreView(layout)`** (`game/src/gen/trackExt/core.ts`) returns the level exactly as it would be without its extensions:
- extension cells go back to rock;
- appended areas, doors and records are dropped;
- coordinates are translated back.

The golden tests use it for their translation-normalised proofs, and runtime fields such as decay use it.

**Validation:** `extensionIssues(layout)` checks that:
- every tunnel and annex cell is reachable from the platform (drops and ladders allowed), with a return path to a ladder;
- there is at least 2.2 m of head clearance;
- the cap has collision;
- no walkable cell borders void or the outside of the canvas;
- nothing overlaps;
- every door joins exactly a tunnel or bed and an annex corridor.

## Content (`game/src/gen/annexContent.ts`)

**Rooms:** annex areas take existing back-of-house purposes: pump room, electrical room, workshop, maintenance storage,
custodial room, janitor / electrical / supply closets, and service corridors.
- Rooms are dressed by the existing dress, compose and iteration-07 machinery on their own rng fork.
- The budget is one prop per 12 m², plus `ANNEX_COMPOSE_BUDGET` 12 generated-model clusters per annex.
- Only existing prop kinds are used, so the openables and physics audits are unchanged.

**Loot** (`game/src/items/lootTables.ts`), finite, seeded once, persisted by the usual keys and never refilled:
- **Deepest holders:** each annex's deepest 7–8 holders keep their room's normal loot table.
- **Stash:** one or two stash holders (a crate, then a tall cabinet) use `ANNEX_STASH`.
- **Picked over:** the rest use `ANNEX_PICKED`: no ammo, 90 % empty.
- **Floor:** `ANNEX_FLOOR` guarantees nothing.
- **Untouched:** the level's single rare-gear roll, mask roll, weapon finds and Office roof cache and find are never
  multiplied.

**Enemies** (`SERVICE_CONTEXT`):
- 3–5 per annex, at least 5 m apart and at least 6 m from the entrance.
- Annex spawns are appended after every core spawn and tagged `markSpawnContext(layout, firstIndex, 'service')`.
  `assignEnemyArchetypes` runs once afterwards.
- They inherit the level's profile, tier and family pool. There are no Sirens in `'service'`: the Subway has none, and the
  Office's Siren eligibility stays `['floor']`.
- They are excluded from the core station / street / floor counts and reported separately.
- Measured: about 4.3 extra per Subway level.

**Lights:** untinted. Annexes have about 80 fixtures each, mostly dim, dying or dead; the entry corridor is never fully dark.
Tunnels have sparse fixtures, mostly dead or dying.

**Steam vents:** `extensions.vents`, 3 per annex, placed over pump skids, water heaters and valves.

## Presentation (`game/src/world/trackExt/`)

- **Tunnel shell and grid geometry:**
  - `TrackExtView.of(layout)` and `buildTrackExtensions(...)` build the smooth tunnel shell: concrete walls, flat ceiling,
    ballast, and rails with instanced sleepers.
  - Inside the shell, the stair-stepped grid walls are suppressed (`clipFaces`). The shell's own wall-treatment faces are
    `shellDetailFaces`.
  - The bed end plane and barricade disappear only where a tunnel continues.
- **Caps, doors and graffiti:**
  - Cap meshes: `caps.ts`, with `CAP_OVERHANG` derived from `capDepth`.
  - Annex and hatch door frames carry a SERVICE plate.
  - A local procedural graffiti atlas paints decals only at `clues`.
- **Annex walls:**
  - Annexes use the lower-level service look: board-formed concrete, pipes, conduits and damp.
  - Annex wall detail has its own per-annex budget (`extWallDetailCaps`, `game/src/world/wallDetailPlan.ts`).
  - Fittings keep out of doorway clear volumes.
- **Wall finish** (playtest revision, lane ART: "the wall textures look low res"; `game/src/world/trackExt/wallFinish.ts`):
  - Diagnosis: the annex walls used the `platformFace` material — the 256 x 256 `platform-authored-backing` set (a 5.7 KB colour
    JPEG) over 2 x 2 m = **128 texels / m**: ~3x magnified at 2 m and ~6x at 1 m in a 1.5–2 m corridor (1080p, 75° fov: ~380 screen
    px / m at 2 m), mipmapped but never minified there, so simply blurry; the formwork overlay on top was 110 px / m. The tunnel shell
    walls used the bed lining `tunnel` (1024 x 384 over 3.6 x 1.38 m = 284 texels / m) whose stamped repair patches repeat every
    3.6 m along and four times up a 5.5 m tunnel wall.
  - Fix: one local procedural **board-formed concrete** set (canvas, painted once per page, deterministic; no image asset, no
    provider): colour 1024 x 1024 over 2.4 x 2.4 m = **427 texels / m**; roughness and normal 512 x 512 from the same height field
    (0.15 m boards with their own tone and grain imprint, 1.2 m panel joints, tie cones on a 0.6 m grid, bug holes). Annex walls
    (`WallKind 'annex'` → finish `annexWall`) take it world-mapped with the shared world-mapping macro tone variation (~1.4 m
    world-space features) and floor grime, plus the decay hook (`platformFace` profile); the formwork overlay is not drawn over it.
    The tunnel shell walls take it on their developed UVs (`tunnel` profile decay); a 0.3 m concrete portal rib and soffit beam
    at the mouth mark where the station's bed lining (unchanged) ends.
  - Cost: two materials (two programs), created lazily per `WorldMaterials` only when a level has extensions, in the station scene
    at build (warmed up; no first-use compile). Textures: 1024² sRGB + 2 x 512² ≈ 4 + 2 x 1 MiB, **≈ 8 MiB GPU with mips**. Geometry:
    walls unchanged (same quads); the portal adds 3 boxes (36 triangles) per tunnel into its existing concrete mesh. Draws: annex
    wall quads no longer share a 48 m chunk mesh with the core's platform-face concrete, +1 to +4 draws per level measured (seeds
    4055629249, 2654448106, 1043, 774566179); the formwork overlay quads on annex walls are gone.
- **Station invitation art** (playtest revision, lane ART; `game/src/gen/trackExt/art.ts`, `world/trackExt/graffiti.ts`,
  `graffitiArt.ts`):
  - Records: `planStationArt` runs at the end of `finishExtensions` (after the attach, on the track-ext fork `station-art`, which
    never advances its parent) for every REAL annex entrance at a bed end — a tunnel with an annex door (target: its mouth) or a
    service hatch (target: its door). It places: a large full-colour letter **piece** ("REKS", non-directional) on a bed side wall a
    platform faces (the 6 m stub past the platform end, or the outer wall beside an island), the crew's gas-mask **watcher**
    (non-directional) on the other faced wall or beside the piece, and stencilled **SERVICE + arrow** marks (directional, toward the
    entrance) on those walls and on the **end wall of every platform** beside that bed at that end (the wall a player walking
    down the platform faces).
  - Rules (`stationArtRecordIssues`, part of `extensionIssues`): only at a real entrance; on solid rock wall (side-wall row SOLID,
    bed in front) a platform faces, or on a solid platform end wall with the platform in front; clear of hatch openings / plates
    (0.6 m), hatch clue marks, wall signs and props against the wall; under the ceiling; stencils point toward the entrance, the piece
    and watcher never do. A planned record that would fail is dropped (art never invalidates a level). No annex: no art.
  - Measured (24-seed Subway corpus): 27 annexes on 21 levels, every entrance gets a piece; 98 records (27 pieces, 18 watchers, 23
    side-wall stencils, 30 platform end-wall stencils), ~4.7 per level with art; planning 0.5 ms mean, 2.5 ms max per level.
  - Presentation: the graffiti atlas is ONE 2048 x 1024 canvas (≈ 10.7 MiB GPU with mips; it was 1024 x 1024): the eight 512 x 256
    arrow / tag cells in the left half, the piece (1024 x 512), the watcher (512 x 512) and the SERVICE stencils (512 x 256, right
    / left: only the arrow mirrors) in the right half, painted by local canvas code. Art decals join the clue marks in the ONE
    graffiti mesh per level (one draw). The in-tunnel / hatch marks are bigger (arrows 2.0 x 1.0 m at 1.7 m above the bed, tags
    2.2 x 1.1 m), and a route's later arrows (before a tunnel door, a hatch's approach arrow) use the SERVICE stencil.
  - Keep-outs: every painted rect (art + hatch clue marks; `stationArtKeepouts`) is a wall-detail keep-out on its wall plane for
    every layer — no cables, stains, cuts or fittings across the paint. This changes the core bed walls' treatment only under the
    paint (the authorised station-surface change); the core layout, records, RNG streams and every core pin are unchanged.
- **Steam:** a bounded, non-hazardous emitter in `game/src/world/fx.ts`, capped per annex. It is never the gas field and
  never the flare smoke.
- **Ambience:** the existing beds through room types; tunnels use tunnel reverb.

## Tests

- **Track extensions:** `track-ext.test.ts` (generation and census), `track-ext-core.test.ts` (core identity and the
  reserve-off proof), `track-ext-coverage.test.ts`, `track-ext-vis.test.ts`, and the opt-in `TRACK_EXT_GEN=1`
  `track-ext-vis-gen.test.ts`.
- **Content:** `annex-content.test.ts`.
- **Station art and wall finish (playtest revision):** `track-ext-art.test.ts`; opt-in CPU previews
  `TRACK_EXT_ART_PREVIEW=1 [ART_OUT=label] ... game/tests/track-ext-art-preview.test.ts` (station views, routes, an annex wall at
  1–2 m, into `qa-artifacts/track2-revision-art/`).
- **Pins:** the golden pin histories in `enemy-spawn-parity.test.ts`, `loot-golden.test.ts`, `office-gen.test.ts` and
  `nav-query-fingerprint.test.ts` record every Track 2 re-pin with its cause and proof.
- **Browser:** the spot check is `tools/qa/track2-walk-check.mjs`. It is one serial session: a real W walk from platform to
  bed to tunnel to annex door, then the annex loot, then back up the ladder.
