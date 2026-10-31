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
same level and world, with no loading. Graffiti arrows and tags appear only where a real route leads to an annex.

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
- **Machinery halls** (`annex.hall`, task track2-playtest-revision, lane ROOMS): 2–3 larger, taller rooms per annex
  (9–12 × 12–16 m, ceilings 3.6–4.2 m; `Area.extHall`) inside the SAME area target, so the tight network stays and is
  regularly broken by a big room:
  - hall k is attempted once the annex has grown to (k + 0.5) / (count + 1) of its target (a rhythm, not a cluster);
  - only off a corridor at least `spacing` (2) areas past the previous hall on its branch, only while the hall keeps the annex
    within its target (+ 2 % slack) and the grid budget (the Mall's hard cell budget included); 8 seeded placements per attempt;
  - a hall is a room later areas may branch off (parent weight 2.2).
  Measured: 1–3 halls per annex on the fixed seed set; the 64-seed incidence is unchanged (0 / 1 / 2 = 4 / 42 / 18, 16 hatches,
  ratio to the baseline 0.15 / 0.25 / 0.29 min / mean / max).
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

**`coreView(layout)`** (`game/src/gen/trackExt/core.ts`) returns the level exactly as it would be without its extensions:
- extension cells go back to rock;
- appended areas, doors and records are dropped;
- coordinates are translated back.

The golden tests use it for their translation-normalised proofs, and runtime fields such as decay use it.

**Machinery** (`extensions.machines`, lane ROOMS): the annexes' anchored machinery records (`AnnexMachine`, `gen/annexRooms.ts`):
kind, area, footprint centre on the floor, quarter-turn yaw, w × d × h and kind parameters. `machineBoxes(record)` gives the solid
parts' collision boxes; each is one collision-only `annexMachine` prop (per-placement box). `coreView` drops them with the
extensions; `dropExtensions` deletes them.

**Validation:** `extensionIssues(layout)` checks that:
- every tunnel and annex cell is reachable from the platform (drops and ladders allowed), with a return path to a ladder;
- there is at least 2.2 m of head clearance; annex ceilings are 2.4–2.8 m, machinery halls 3.6–4.2 m (and a hall is a room);
- the cap has collision;
- no walkable cell borders void or the outside of the canvas;
- nothing overlaps;
- every door joins exactly a tunnel or bed and an annex corridor.

## Content (`game/src/gen/annexContent.ts`)

**Room signatures** (task track2-playtest-revision-20261031, lane ROOMS, `gen/annexRooms.ts`; user feedback 4 / 5: "the same
rooms repeating … think boiler room, generator room, sewage room, overflow room, spill way, turbine room, ventilation room … with
custom layout and props"; keep the tight feel, "break it up with bigger rooms"). Seven reusable signatures, each a LAYOUT of
anchored machinery with its own footprint, focal point, circulation and materials (dimensions from the scale checks beside a
runtime-scaled 1.78 m zombie):

| Signature (purpose) | Min room | Layout / focal point | Assemblies (W × H × D) |
|---|---|---|---|
| Boiler room (`boiler-room`) | 5 × 6 m | a bank of 2 (halls 3) horizontal fire-tube boilers backed on one wall, burner fronts into a ≥ 1.5 m aisle, flue stacks into the ceiling, a lagged pipe header with branch drops on the back wall (halls: a breeching duct overhead) | boiler 2.0 × 1.9 × 3.0–3.5 (shell Ø 1.45–1.7, oxide red); bank 6.2 × 2.4 × 3.0; expansion tank 1 × 1.9 × 1 |
| Generator room (`generator-room`) | 5 × 6.5 m | diesel generator sets as ISLANDS on concrete plinths with a 1 m walkway ring (halls: a pair across a 1.2 m aisle), a switchgear lineup on a wall with a 1 m front strip, a fuel day tank, exhaust risers into the ceiling | genset 3.5–4.0 × 1.75 × 1.5 (ochre; radiator, engine, alternator, silencer); switchgear n × 0.8 × 2.1 × 0.6 |
| Sewage channel (`sewage-room`) | 4.5 × 7 m | a contained channel down the room's length (dark water at +3 cm, 0.22 m curbs, yellow handrails), 1–2 walkable grated crossings, grating walkways both sides, a sluice gate at the inlet wall, a culvert mouth at the outlet (stops 1.5 m short of a door wall) | channel L × 1.5–2.0 (curbs 0.15 × 0.22, rails 1.05) |
| Overflow chamber (`overflow-chamber`) | 6 × 6.5 m | a deep basin against the far wall behind a 0.92 m concrete parapet and handrail, an inlet pipe pouring in above the parapet, a submerged weir and a depth staff, a ≥ 1.2 m walkway in front (halls: pump controls + dosing tank) | basin up to 6 × 4 (halls 10 × 7) × 0.92 (+ rail 1.24) |
| Spillway (`spillway`) | 6 × 8.5 m | a stepped concrete chute along a door-free long wall — 3–5 cascades from a 0.6 m inlet weir (sluice frame) down to a culvert mouth — behind a 0.8 m wall + handrail, a grating catwalk along it, sluice control panels opposite | chute L × 0.8 (+ rail 1.1) × 1.75–2.25 |
| Turbine hall (`turbine-hall`, halls only) | 9 × 12 m | a turbine-generator set on a 0.4 m plinth down the hall (ribbed casing, coupling, generator with cooling bands, exciter), its penstock from the end wall (or from the ceiling when that wall has a door), a 1.2 m ring, an overhead travelling crane, control panels, an oil tank | set 6–10 × 2.8 × 2.75–3.0 (slate blue / grey) |
| Ventilation plant (`ventilation-plant`) | 4.5 × 5.5 m | 1–3 big axial wall fans (shroud, pitched blades, guard) on the far wall, an inline fan unit with its duct riser, ducts along the ceiling (bottom ≥ 2.25 m), louvres | wall fan Ø 1.2–2.6 (2.2 × 2.35 × 0.75 at Ø 1.9); inline unit 2 × ceiling × 1.5 |

- **Halls first, then about 60 % of the medium rooms** (short side ≥ 4.5 m, ≥ 26 m²) take a signature; the other rooms keep a
  small utility role (workshop, maintenance stores, electrical room, pump room, custodial room, first-aid post), closets stay
  janitor / electrical / supply closets, corridors stay composed service corridors.
- **The anti-repetition rule** (bounded, seeded): halls first (largest first), then the chosen rooms in door-graph traversal
  order; a room never takes a signature already used by an annex room within 2 door hops (one door, or across one corridor /
  hall); weight = signature weight × hall preference (halls) × 6 while unused in the annex × 0.2 ^ uses. A layout that cannot
  be built in its room (doors / proportions) undoes itself and tries up to 2 other eligible signatures under the same rule,
  then the room becomes a utility room. Measured on the fixed seed set: 5–7 distinct signatures per annex, all seven across it.
- **Machinery** is world geometry from the records (`world/trackExt/machines.ts`): locally authored boxes / cylinders merged into
  one mesh per (annex, material) — about 12 draws and 18–33k triangles per annex — with value-only clones of the shared
  world-mapped shape materials (painted / brushed steel, panel, concrete, grille, black: no texture loads, shared programs).
  Collision is honest: every solid part is a collision-only `annexMachine` prop (player / zombie / bullet / ragdoll collision,
  blocked + sight cells, placed through the dresser's door zones, doorway clear volumes and connectivity check). Channels,
  basins and chutes are VISUAL water (no water physics, no hazard): their curbs / parapets / walls and water surfaces are
  collision boxes, so nobody walks in; crossings are walkable. Visual-only parts stay within 0.28 m of a wall, above 2.2 m, flat
  on the floor or over a blocked footprint (tested). `annexMachine` is classified in both audits: the openables audit's
  exception ("anchored heavy machinery / sealed plant: not storage") and the physics audit's `machinery` static class.
- **Fewer, meaningful holders:** the existing purposes dress annex rooms with LEAN rule sets (`ANNEX_RULES`: stores keep
  shelving, workshops a tool locker, electrical rooms panels + a cabinet, closets one fixture; first-aid posts a medicine
  cabinet), the signature purposes carry a tool locker / spares shelf / crate where the room's function suggests it, and the
  iteration-07 dresser adds equipment props (pumps, compressors, transformers, disconnects, ladders …: non-lead uses, so no
  station palette changes). Annex holders dropped from ~100–125 to ~41–64 per annex; the machinery's collision boxes are
  budget-exempt (`dressExtensionAreas` `pre` / `rules`).
- Halls get a fixture every ~5 m of their long side (at least 2).

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
- **Steam:** a bounded, non-hazardous emitter in `game/src/world/fx.ts`, capped per annex. It is never the gas field and
  never the flare smoke.
- **Machinery** (lane ROOMS): `world/trackExt/machines.ts` `buildAnnexMachines` (called by `buildTrackExtensions`; stats in
  `TrackExtStats.machines`, kept out of the per-100 m tunnel figures): one merged mesh per annex and material, built into the
  station group at build time (warm-up discoverable).
- **Ambience:** the existing beds through room types; tunnels use tunnel reverb.

## Tests

- **Track extensions:** `track-ext.test.ts` (generation and census), `track-ext-core.test.ts` (core identity and the
  reserve-off proof), `track-ext-coverage.test.ts`, `track-ext-vis.test.ts`, and the opt-in `TRACK_EXT_GEN=1`
  `track-ext-vis-gen.test.ts`.
- **Content:** `annex-content.test.ts` (lane ROOMS: machinery records = their collision boxes, visual-only safety, the
  anti-repetition rule, ≥ 4 signatures and ≥ 1 hall per annex, 30–70 holders per annex, bounded merged machinery meshes).
- **Pins:** the golden pin histories in `enemy-spawn-parity.test.ts`, `loot-golden.test.ts`, `office-gen.test.ts` and
  `nav-query-fingerprint.test.ts` record every Track 2 re-pin with its cause and proof.
- **Browser:** the spot check is `tools/qa/track2-walk-check.mjs`. It is one serial session: a real W walk from platform to
  bed to tunnel to annex door, then the annex loot, then back up the ladder.
