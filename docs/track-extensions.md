# Track extensions: tunnels beyond the station and service annexes

Track 2, "Beyond the Station". This is the reusable interface for every level whose station has track beds: the Subway, the
Office's street station and the mall (`LevelId` `mall`, seeded display name `<Name> Center`).

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

## The mall (`mall`, task track3-eaton-centre-20261031, lane INTEG)

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
  collision boxes, so nobody walks in; crossings are walkable. Track 2 round 2 (lane MOTION, `world/trackExt/motion.ts`): the water
  and foam MOVE on the game clock — channels flow gate → culvert at 0.16–0.28 m/s (seeded), chute steps run toward the low end at
  0.9 m/s, falls pour down at 1.2–1.6 m/s, basins drift 0.03 m/s and are stirred near the inlet pour (per-vertex flow, two shared
  animated materials: advected noise + ripple slopes bump the normal, the albedo and the roughness; nothing changes height) — and
  the wall fans' blades turn (one InstancedMesh per level, a blade per instance, 1.6–2.6 rev/s seeded, step capped below half the
  blade spacing so it never strobes backwards). Inline fan units keep no rotor (no blades show through the casing). Visual-only
  parts stay within 0.28 m of a wall, above 2.2 m, flat
  on the floor or over a blocked footprint (tested). `annexMachine` is classified in both audits: the openables audit's
  exception ("anchored heavy machinery / sealed plant: not storage") and the physics audit's `machinery` static class.
- **Fewer, meaningful holders:** the existing purposes dress annex rooms with LEAN rule sets (`ANNEX_RULES`: stores keep
  shelving, workshops a tool locker, electrical rooms panels + a cabinet, closets one fixture; first-aid posts a medicine
  cabinet), the signature purposes carry a tool locker / spares shelf / crate where the room's function suggests it, and the
  iteration-07 dresser adds equipment props (pumps, compressors, transformers, disconnects, ladders …: non-lead uses, so no
  station palette changes). Annex holders dropped from ~100–125 to ~41–64 per annex; the machinery's collision boxes are
  budget-exempt (`dressExtensionAreas` `pre` / `rules`).
- Halls get a fixture every ~5 m of their long side (at least 2).

**Loot** (`game/src/items/lootTables.ts`), finite, seeded once, persisted by the usual keys and never refilled.

*Playtest revision* (task `studio-alpha-track2-playtest-revision-20261031-01`; user: two fresh runs with "no loot and no
enemies in the area").

Diagnosis, `reference/tasks/track2-playtest-revision-20261031/DIAGNOSIS-BASELINE.md`:
- Every annex holder was generated, registered, unculled, reachable and targetable.
- Yet 94–98 % rolled EMPTY. The picked-over table (90 % empty) and the stash were cut a SECOND time by the level-wide scarcity
  economy (`items/lootEconomy.ts` `scarceFinds` keeps only ammo / materials exactly).
- The stocked few sat deepest.
- An ordinary room-by-room route opened 9–22 holders per annex and found nothing.

Now:
- **Exact annex tables:** `LootSpec.exact` rolls exactly, with no scarcity cut, re-theme or limb conversion; a level's slot
  scaling still applies. It is set on the annex keys only, so every core table is unchanged.
- **Supply:** `ANNEX_SUPPLY` holders, never empty, one ordinary supply each (water, a soda, tins, noodles, chocolate, a dressing, now and then a first-aid kit, a cell, a flare; no ammo, no crafting materials). One
  per 170 m² of annex, 6–12, chosen by door-hop DEPTH BAND:
  - half in the entry third, 30 % in the middle, the rest deep;
  - at most 2 per room;
  - only holders that roll their room purpose's table (`rollsPurposeTable`; not first-aid wall kits / fixture cabinets).
- **Scraps:** `ANNEX_SCRAPS`, one leftover each, in 12 % of the other picked-over holders, at most 6.
- **Searched clean:** `ANNEX_PICKED` (exact, `empty: 1`) for the rest.
- **Stash:** 1–2 stash holders, a crate and then a tall cabinet, use `ANNEX_STASH` (exact, `empty: 0.1`, 2–3 lots).
- **Deepest holders:** each annex's deepest ~8 holders keep their room's table (scarcity as in the core; ammo-led).
- **Room storage:** every annex room / closet the dressing left with no loot holder gets one storage piece (`placeRoomStorage`):
  open shelving first, else a low cabinet / crate or a tall cabinet.
- **Floor:** `ANNEX_FLOOR` unchanged (chances only).
- **Untouched:** the level's single rare-gear roll, mask roll, weapon finds and the Office roof cache / find are never
  multiplied.

Measured on the merged tree, fresh New Game path, Subway 1043 / 1002 / 777001 / 777002, Office 222 / 3333, Mall 846932 / 5150 /
9090:
- **Holders:** 49–75 per annex, **28–38 % stocked** (the core station stocks ~1/3).
- **Finds:** 18–28 non-ammo holder finds per annex, the core station's density.
- **Ammo:** holder ammo stays in its old range.
- **Access:** every stocked holder is reachable and targetable from its stand point.
- **Discovery routes:** ordinary routes (`tests/helpers/annexRoute.ts`: a real Player, nearest-unvisited room by walking distance,
  opening holders in placement order) took loot in every sampled annex, with the first find 2–5 rooms in. Before, they found
  nothing.

**Survivor caches** (task `studio-alpha-track2-round2-20261031-01`, lane CACHE, R5; user: "there's not enough of a reason to go to this
place, there should be some "cache" rooms that spawn deeper in, a room like a survivor had been living there"; `game/src/gen/annexCache.ts`,
config `ANNEX_CACHE`).
- **Pass order:** the LAST content pass (after lights, floor finds, vents and service spawns), per annex on its own fork
  (`cache:<annexId>`). It only appends props, so every earlier record — holder indices and their loot, pickups, spawns — is unchanged
  (the cache room's one fixture aside, below); their cells (access strips / stand points in front of the room's props, wall mounts,
  floor finds, spawn points) are reserved before placing. It reuses the room-storage pass's annex-window place context.
- **Deep, from the door-hop topology** (`Area.depth`, door hops from the annex entry — the bands `pickOver` and the service spawns use):
  - a room in the deep THIRD of the annex's depth range; never a closet, a service corridor, a machinery hall, a signature room (its
    machinery stays) or an entry room (depth <= dMin + 1); at least 3 m short side and 10.5 m²;
  - a seeded weighted pick: dead ends x3 (two doors x1.5), +1 per hop past the shallowest candidate, free floor after the room's own
    props (x0.2–x2), the stash's room x0.5; a room where the cache does not fit is rolled back and the next drawn (<= 5 per tier);
  - ONE cache per annex; a SECOND in large annexes (>= 2000 m²), deep band only, never next door to the first;
  - **fallback:** no deep room fits -> one cache in the middle band, then in any eligible room past the entry; none at all (an annex
    of halls / signature rooms / closets only) -> no cache, reported by `annexCachesOf`.
- **The room** (existing kinds + one local procedural kind; no new asset file):
  - a **pallet bed** (`palletBed`, `gen/purposeShapes.ts`: foam mattress, open sleeping bag, pillow and a folded blanket on two wooden
    pallets; 1.99 x 0.36 x 0.80 m) against a door-free wall first, a 0.6 m bedside strip kept clear;
  - their **storage**, 2–3 holders (else the room is rolled back): an open shelf (pantry), a tall (else low) cabinet (kit), a crate
    (supply crate); loot key `ANNEX_CACHE_KEY` — exact, never empty, 2–3 lots, themed per container, ammo only in the crate
    (`docs/loot-tables.md` "Survivor caches");
  - up to two **camp things** — existing iteration-07 kinds the level already loads and whose own placement spec allows the room's
    purpose (work light, folding chair, portable generator, trash bags, water cooler, privacy screen, IV pole, drum fan, mop
    bucket), separate props, never baked;
  - a **working light**: the room's first ceiling fixture burns steadily, warm and low (power 0.55), the room at least 'dim' — a lit
    doorway deep in the dark annex (no new light record).
  - Placement goes through the dresser's own primitives: door zones / cells, access strips, room connectivity (`tryPlaceProp`), the
    doorway clear volumes (`propBlocksDoorway`) and the mall's real-wall rule; every wall spot is enumerated in seeded order.
- **Measured** (round 2; fresh New Game path):
  - **Selection** over 51 annexes (Subway 1043 / 1002 / 777001 / 777002 / 4055629249 / 2563024239 / 774566179 + 30 more, Office
    222 / 3333, Mall 846932 / 5150 / 9090): 60 caches, every annex has one, 9 large annexes have two; 59 in the deep band, ONE
    middle-band fallback (Subway 92109: its deep rooms are small shelved stores where no bed + storage fits), none without a cache.
    42 of 60 in dead ends; mostly pump rooms and first-aid posts, then stores, electrical / custodial rooms and workshops.
  - **The room** (the 12-level sample, 20 caches): depth 6–15, 21–78 m in a straight line from the annex door (median ~59 m); 2.75
    holders per cache (shelf + cabinet + crate in 15, two pieces in 5); a camp thing in 14 of 20 (work light, water cooler, drum
    fan, mop bucket, IV pole, generator, folding chair).
  - **Contents** (packed lots, `ContainerManager.build` with each level's profile): 6.75 lots per cache (4–9) — food 1.95, drink
    1.85, dressings 0.8, first-aid kits 0.15, batteries 0.7, gas filters 0.25, ammo 1.05 lots (8.8 rounds); never empty, nothing else.
  - **Discovery** (`tests/helpers/annexRoute.ts` strategy `deeper`: a real Player pushing on to the deepest frontier room, opening
    what it passes; topology only): on Subway 1043 / 1002 (2 annexes), Office 222 (2), Mall 846932 every cache was reached — after
    12, 27, 39, 41, 52 and 56 rooms (168–834 m of walking; 3 of 6 within 40 rooms), its 2–3 holders opened and 4–6 items taken
    (inventory deltas and holder ids in `qa-artifacts/annex-route/<tag>-deeper.json`). A cache is a reward for exploring the annex,
    not a find on the way in (the ordinary nearest-first route's first loot stays 2–5 rooms in).
  - **Cost:** the cache pass takes 0.46 ms (Subway 424242, min of 5) to 0.5–0.9 ms (two annexes) per level.

**Enemies** (`SERVICE_CONTEXT`):
- **Count:** `SERVICE_ZONE_BUDGET` 5–6 per annex (was 3–5; about 80 % of the core's density; the hi fits the compact Mall's
  per-storey ambient cap of 6, as the registry contract requires).
- **Spread:** across entry / middle / deep door-hop bands (equal quotas; the remainder to the middle).
- **Earshot:** cells beyond `SERVICE_EARSHOT_M` (18 m, rifle earshot through rock) of every core floor cell are preferred.
  Before, station gunfire pulled a hatch annex's near enemies out before the player arrived.
- **Spacing:** at least 5 m apart and at least 6 m from the entrance.
- **Ordering and tagging:** annex spawns are appended after every core spawn and tagged
  `markSpawnContext(layout, firstIndex, 'service')`. `assignEnemyArchetypes` runs once afterwards.
- **Families:** they inherit the level's profile and tier, but draw from the annexes' own pool `SERVICE_FAMILY_POOL` (round 2:
  rat/dog 0.20, Blightbelly 0.05, Siren 0, zombies 0.75; a configured selection share, not a quota). There are no Sirens in
  `'service'`. Core contexts and hordes keep their pools (docs/enemy-spawns.md).
- **Counted separately:** they are excluded from the core station / street / floor counts and reported separately.
- **Measured:** 5–6 per annex (Subway levels +5 / +6 with one annex, +10 to +12 with two). The ordinary routes made 1–3 enemies
  aware, the first within the first 0–3 rooms, with no gunfire in the simulation.

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
  - **R1 "concrete at distance"** (task track2-round2, lane CONCRETE; user: "Wall texture looks low detail still, likely due to the
    distance, it just doesn't give that concrete vibe"). Diagnosis with numbers (opt-in `game/tests/r1-concrete-preview.test.ts`,
    box-filtered mips of the painted set): texel density was not the cause — at 1080p / 75° with the native 16x request the colour
    map is sampled at mip 0–2.6 (≤ 1.5 cm texels) everywhere within 10 m (720p: ≤ 3.2). The CONTENT was: linear luminance varied only
    3.5 % (rel. std) at 0.3 m texels and 2.7 % at 0.6 m, roughness was a flat 0.87 ± 0.03, and 67 % of the vertical tone profile was
    one perfectly periodic 0.15 m board-seam stripe (plus cupped-looking board relief and wood grain) — it read as plank cladding.
    Most of its 15 % mip-0 variation (grain, speckle, 1–4 mm bug holes) is gone by mip 2–3, which a software rasterizer's 1x
    anisotropy cap reaches already at 2–4 m along a corridor wall (mip 3.7 at 4 m, 5.7 at 8 m in a 1.5 m corridor).
  - Fix (same three maps and sizes, same two materials / programs, no draw change): the board imprint becomes faint (random board
    widths 0.09–0.2 m, broken hairline seams, no cupping); structure moves to 0.15–1.2 m: a tileable domain-warped fBm cement-paste
    cloud and a sparse stain level set (colour, roughness, relief), two panels of their own tone / sheen, panel joints with grout
    bleed and chipped arrises, a pour-lift line, tie holes (open cones or grout plugs) with rust / water runs, small mortar patches,
    honeycomb at the joints, lime runs, hairline cracks; the normal map comes from a float relief field (panel offset, pillowing
    between ties, paste undulation, fine "orange peel") added to the painted height. The large stains stay small on purpose: a
    distinctive shape would mark the 2.4 m repeat (seen in an intermediate render); variation above ~1 m is world-space — the annex
    macro tone 0.32 → 0.4 (`ANNEX_MACRO`, a uniform) and the decay hook. normalScale 0.85 → 1. Result: luminance 11 % at 0.3 m /
    8 % at 0.6 m texels, roughness 0.66–1.0 (mean 0.80), stripe share 2 %, mean albedo +5 %. Resident GPU memory unchanged (≈ 8 MiB
    with mips); one-time paint adds ~0.1 s of JS (fBm grids, upsampling, relief) at the first extension level of a page.
  - Untouched: `render/anisotropy.ts` / `render/softwareGl.ts` (maps created at 8x like every canvas surface set, 16x requested at
    build as 'wall'; the software cap still applies), mipmaps, warm-up, the annex floors (`concrete` canvas, 512² over 2 m = 256
    texels / m, colour only, roughness 0.92, no normal map) and ceilings (`ceilingService`, the authored 1024 x 341 ceiling set over
    3.6 x 1.15 m ≈ 284 texels / m with ORM + normal). Tests: `game/tests/wall-finish-concrete.test.ts`.
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
- **Machinery** (lane ROOMS): `world/trackExt/machines.ts` `buildAnnexMachines` (called by `buildTrackExtensions`; stats in
  `TrackExtStats.machines`, kept out of the per-100 m tunnel figures): one merged mesh per annex and material (+ one fan-rotor
  InstancedMesh per level), built into the station group at build time (warm-up discoverable). `MachineBuild.update(t)` (Game.update,
  game clock: a pause freezes it) drives the water clock uniform and the rotors; `MachineBuild.dispose()` (queued by
  Game.leaveSection with the other world releases) frees its geometries and the rotor mesh; its materials and clock are per
  WorldMaterials, reused by the next level.
- **Ambience:** the existing beds through room types; tunnels use tunnel reverb.
- **Generator model** (round 2, R3; user: "Generate a model for the generator"): ONE generated industrial diesel genset,
  `assets/models/annex-genset.glb` (Meshy T2.5 smart topology, 2K PBR refine, under the user's task-specific 100-credit budget:
  1 attempt, 2 POSTs, 15 credits; provenance `assets/derivatives/annex-genset-20261031.json`, rebuilt by
  `tools/asset-pipeline/props/build-annex-genset.mjs` from the immutable raw outside Git).
  - **Derivative:** 3.5 × 1.68 × 1.24 m at real size, front +Z, grounded; 11,565 triangles, one mesh / one material; maps base
    colour 1024², metallic-roughness 256², normal 512² (JPEG; ~7 MiB GPU with mips; 862 KB file). A SHARED lazy model (not
    `mall-*`): `assets/annexGenset.ts` `gensetModelKeysFor` asks the loading screen for it when a section has a genset record.
  - **Runtime:** `world/builder.ts` instances it on every genset record (`machines.ts` `gensetModelFit`: on the 0.15 m plinth, one
    uniform scale inside the record's body / collision box — typically 0.955 → 3.34 × 1.60 × 1.19 m), bucketed by scale (one
    `addInstancedModel` call each, 1–2 draws per level). The procedural radiator / engine / alternator body is then skipped; the
    plinth, the exhaust silencer (posts from the model's top) and the riser stay. Without the model the procedural genset stands.
  - **Collision / interaction:** unchanged (`machineBoxes`, anchored machinery, no interaction; the 1 m access ring and the hall
    aisle stay clear). Evidence: `annex-genset.test.ts`; scale check beside the runtime zombie
    (`node tools/asset-pipeline/props/scale-check.mjs --prop game/public/assets/models/annex-genset.glb --scale 0.955`).
- **Fan noise** (round 2, R4 audio; `game/src/audio/fanSound.ts`, `audio/sfx.ts` `updateFans`): user "ventaliation fan should
  spin, and make noise."
  - **Source:** an accepted existing recording only, `bed-hvac-02-loop.mp3` (Sound Lab prompt "a steady ventilation system, air
    rushing through ducts and a constant fan hum"). The bounded local edit is runtime-only: a per-fan playback rate 0.9–1.1
    (seeded), a 70 Hz highpass and a 5.2 kHz lowpass. No new file, no synthesis, no provider audio.
  - **Positions:** `fanSources(layout)` gives the hub of every `fanWall` and the drum of every `fanUnit`
    (`layout.extensions.machines`).
  - **Voices:** a FIXED pool of two page-lifetime channels on the ambient bus (shot ducking, page pause mute). At the existing
    emitter tick (every 12 frames) they follow the nearest fans within 14 m on the listener's storey (feet within 2.4 m of the
    fan's floor). Inverse-distance panner (ref 1.4 m, rolloff 1.3); the world occlusion muffles the sound (gain −60 %, lowpass
    down to 12 %).
  - **Lifecycle:** `setWorld({fans})` on every level build releases the previous fans (empty without annexes). The gameplay voice
    pool, the Siren cues and the vocal gates are untouched.
  - **Evidence:** `fan-sound.test.ts` (fake WebAudio, structural only). Not auditioned by ear on the build worker.

## Tests

- **Track extensions:** `track-ext.test.ts` (generation and census), `track-ext-core.test.ts` (core identity and the
  reserve-off proof), `track-ext-coverage.test.ts`, `track-ext-vis.test.ts`, and the opt-in `TRACK_EXT_GEN=1`
  `track-ext-vis-gen.test.ts`.
- **Content:** `annex-content.test.ts` (lane ROOMS: machinery records = their collision boxes, visual-only safety, the
  anti-repetition rule, ≥ 4 signatures and ≥ 1 hall per annex, 30–70 holders per annex, bounded merged machinery meshes).
- **Water / fan motion (round 2, lane MOTION):** `annex-motion.test.ts` (per-vertex flow directions / speeds, surfaces in place,
  the shared game-clock uniform, real GLSL builds of the materials, the CPU mirror travelling downstream, rotors pivoting on the hub
  inside the fan box, the anti-strobe cap, dispose / rebuild without accumulation, draw budget); opt-in `MOTION_PICTURES=1` CPU
  preview pair into `qa-artifacts/r2r4-motion/`.
- **Survivor caches (round 2, lane CACHE):** `annex-playtest.test.ts` "survivor caches deeper in" — the per-container exact tables on
  every level profile (packed lots, no salvage / material / gear / mask / weapon, ammo only in the crate), and on the fresh-run sample
  a deep-band cache room per annex (no signature / hall / corridor / entry room), the bed, 2–3 registered and stocked holders,
  targetable from their stand points, the working light, the camp things' placement contract, the cache appended last; taken cache
  lots stay taken across regenerate -> rebuild -> `applyHolders`. Opt-in evidence: `ANNEX_ROUTE=1 ROUTE_ONLY=deeper` (the deeper
  route) and `ANNEX_PICTURES=1` (CPU pictures of the cache rooms, `qa-artifacts/track2-revision-pictures/cache-*.png`).
- **Station art and wall finish (playtest revision):** `track-ext-art.test.ts`; opt-in CPU previews
  `TRACK_EXT_ART_PREVIEW=1 [ART_OUT=label] ... game/tests/track-ext-art-preview.test.ts` (station views, routes, an annex wall at
  1–2 m, into `qa-artifacts/track2-revision-art/`).
- **Pins:** the golden pin histories in `enemy-spawn-parity.test.ts`, `loot-golden.test.ts`, `office-gen.test.ts` and
  `nav-query-fingerprint.test.ts` record every Track 2 re-pin with its cause and proof.
- **Browser:** the spot check is `tools/qa/track2-walk-check.mjs`. It is one serial session: a real W walk from platform to
  bed to tunnel to annex door, then the annex loot, then back up the ladder.
