# Prop affordances — authoring checklist

Standing user rule (2026-10-30, root `CLAUDE.md` "Props — core design rules"):
- **storage opens**, with thematically appropriate finite loot;
- **movable things move**, under bullets and player contact;
- **no baked loose clutter**: loose items are separate props placed on the furniture (section 5);
- **real-world scale**, inspected in a render beside a runtime-scaled standing zombie (section 5).

Exceptions are explicit and classified. Use this checklist for every new or changed prop kind (procedural, authored or
generated model).

## 1. Classify the kind (both audits, every kind)
| Question | Where it is recorded | Classes |
|---|---|---|
| Can it be opened / searched? | `OPENABLE_AUDIT` in `game/src/world/openablesSpec.ts` | `openable` (doors / drawers / lids this system animates), `existing` (earlier holder with moving parts), `open` (open shelving / counters: loot reachable), `exception` (looks openable but deliberately closed — honest reason), `none` (no door / lid / drawer at all) |
| Does it move when shot or bumped? | `PROP_PHYSICS_AUDIT` in `game/src/damage/physicsAudit.ts` (office kinds: `OFFICE_PHYS` in `game/src/gen/office/physics.ts`; Subway kinds: `PROP_PHYSICS` / `PROP_DEFS.physics`, `game/src/damage/materials.ts`) — see section 3 | `dynamic` (mass / collider / contact material) or `static` with a reason (`StaticWhy`: `holder`, `anchored`, `built-in`, `too heavy`, `fixture`, `partition`, `mounted`, `host decor`, `structure`, `machinery`, `kept`, `flat` — soft bedding lying flat, round 3) |

Both audits are enforced by tests: an unclassified kind fails CI.

## 2. Storage that opens
- Use the existing openables machinery (`world/openables.ts`, `world/openablesSpec.ts`): hinged doors, lids and sliding drawers
  derived from the model (`world/meshSplit.ts`) or procedural parts. Never a menu.
- Contents:
  - finite, rolled once from the level seed, remembered in run memory (taken lots stay taken; never refilled on reopen /
    revisit);
  - themed by container through the loot-table foundation: pick or add a **slot category** and named table in
    `game/src/items/lootTables.ts` (`HOLDER_SLOTS`, named tables, `HOLDER_ALLOW`) — see `docs/loot-tables.md`;
  - no new literal item lists in consumers.
- Fit and occupancy: lots are packed on real compartment surfaces (`items/lootLayout.ts`); an item that doesn't fit is not
  placed. Door swings and drawer travel stay clear of walls / doorways (placement `front` / access strips).
- An anchored cabinet may still open (static body, animated doors).

### Steps for a new storage kind (the office-interactions pass did these for nine office kinds)
1. **Measure the model in the prop frame.** `reference/tasks/office-interactions-layout-20261030/tools/open-measure.mjs <glb> <w>
   <h> <d> <flip> <out>` writes CPU ortho front / back / side / top / depth views with a 0.1 m grid and prints front-depth
   profiles; `HITS` / `HITSX` / `HITSY` list every surface a ray crosses. Pass `flip 1` for office / company GLBs (they face
   -Z; `world/officeProps.ts` turns them). Find the fronts' seams, their thickness, and whether the carcass is hollow. A hollow,
   single-faced shell needs an authored liner (`cavity`), or you see through its walls from inside.
2. **Write the spec** in `OPENABLE_SPECS` (`world/openablesSpec.ts`):
   - `model` = the runtime model key (`office-<assetId>` for office models, which load through the game's prop library);
   - `turn: true` for -Z files; `body: 'model'`; `group: 'container'` for a new holder.
   - Parts:
     - drawers: `modelDrawer(name, x0, x1, y0, y1, {zCut, zFront, depth, dist, face?, tight?})`. Use `face: -1` for drawers on
       the prop's back (the executive desk's sitter side) and `tight` for 12–15 cm fronts;
     - doors: a `hinge` part with a `region`, a `pivot` on the hinge line, an `angle` and a `min`;
     - lids: an `axis: 'x'` hinge at the back edge with a `plate` under a single-faced top.
   - Every compartment needs real `surfaces`. Give it a lined `cavity`, `inner` shelves and a `tray`. A model interior full of
     fused clutter can be cleared with `replaceInterior` (+ `cavityHidden` to keep the model's own walls, `openAxis` when the
     part's region and cavity centres don't show the opening axis). A model whose compartment is real modelled geometry (shelves
     under every surface: the rebuilt server rack) sets `modelInterior` with `cavityHidden` instead.
   - A part that only reveals equipment has no surfaces and a per-part `contents` text (the server cabinet's glass doors).
   - `seatAside: true` when the kind's own office chair is pulled up to its drawers.
   - Add the kind to `OPENABLE_CONTAINER_KINDS`.
3. **Loot** (`items/lootTables.ts`):
   - a `HOLDER_SLOTS` entry;
   - a named row set plus an `OPENABLE_TABLES` entry (`lots`, `empty`). Keep kinds placed in numbers emptier;
   - a `HOLDER_ALLOW` list that covers every category of its own rows (a kept original roll keeps its item);
   - `CONTAINER_THEMED` if the container, not the room, should decide (otherwise the room's purpose narrows the rows);
   - generic calibre rows (`genericAmmo`) only where ammo is the deliberate rule.
4. **Classify it.** Add a row in `OPENABLE_AUDIT`. Office kinds go in `OFFICE_OPEN_AUDIT`: role `storage` / `surface` /
   `equipment` / `decor`, class, and an honest reason (it is typed over every office kind).
5. **Test it** like `tests/office-openables.test.ts`:
   - parts derived and animated;
   - compartments revealed;
   - contents only in allowed categories, inside their surfaces, deterministic, remembered (`captureHolders` /
     `applyHolders`) and never refilled;
   - on generated levels: fitted swings clear of walls / doorways / props, holders reachable from their stand point, and a
     bounded share of the level's loot.

   Spot-check one in the browser with `__LL.goOpenable('<kind>')` (it stands in front of part 0 and aims at it; [E] opens it).

### Office storage covered (task office-interactions-layout-20261030)
| Kind | Parts | Contents (`OPENABLE_TABLES`, `HOLDER_ALLOW`) |
|---|---|---|
| `officeFiling` (lateral filing cabinet) | 4 derived drawers | `LATERAL_FILE_ROWS`: snacks, drinks, a dressing, a cell (no ammo) |
| `executiveDesk` | 7 derived drawers on the sitter side | `EXEC_DESK_ROWS`: personal stock + generic sidearm rows |
| `labBench` | 15 derived drawers (body only, rescaled to a 0.9 m worktop; its glassware / microscope are separate `lab*` props on top) | `LAB_DRAWER_ROWS`: dressings, cells, water, now and then a bio mater specimen jar (lane FURN, office-props-physics-scale-20261030) |
| `examTable` | 3 derived drawers | `CLINIC_DRAWER_ROWS`: dressings (+ limb treatments), water |
| `biohazardFridge` | derived door frame; cleared bottom compartment | `COLD_MED_ROWS`: dressings, first-aid kits, water |
| `vaultSafe` | derived door; lined cavity with a shelf | `VAULT_ROWS`: generic ammo (the deliberate rule), dressings, a kit, a flare |
| `serverCabinet` | 2 derived cupboard doors (2 shelves each) + 2 glass doors (racked servers) | `SERVER_SPARES_ROWS`: cells, flares, a dressing, water, electrical parts, scrap metal |
| `serverRack` | 42U rack, a local procedural rebuild (`office-server-rack-r2.glb`): derived perforated see-through door over racked equipment with blinking LEDs; 3 empty bays with modelled shelves (`modelInterior`) | `SERVER_RACK_ROWS`: electrical parts (the common find), scrap metal, rarely a cell / flare (lane RACK, office-props-physics-scale-20261030) |
| `archiveBoxes` | the top box's derived lid (spills if knocked loose) | `ARCHIVE_ROWS`: rarely a snack / cell / dressing / flare |
| `bakeryCase` | 3 authored display trays that pull out of its open staff side (prop -Z); loaves seen through the case (`glass`); placed with a staff aisle behind it (`companyDress.ts` `SERVE_BEHIND`) | `BAKERY_ROWS`: `bread` (FOOD; the loaf cut out of the case model) — lane FURN, office-props-physics-scale-20261030 |

Explicit exceptions with reasons (kegerator, globe bar, parcel pallet, gumball jar, machines) are in `OFFICE_OPEN_AUDIT`.

Loose clutter separated from furniture (lane FURN, office-props-physics-scale-20261030): `gen/office/clutterKinds.ts` kinds
(`labFlask`, `labFlaskLarge`, `labMicroscope`, `labBottle`, `labBottleRack`, `labTubeRack`, `tradingMonitor`, `tradingKeyboard`)
cut out of the lab bench / trading desk models by `tools/asset-pipeline/props/build-office-overhaul.mjs` `FURNITURE` +
`lib/clutter-split.mjs` (connected components on the support surface; one model per object type at its own real size; the
painted ghosts they left on the worktop / desk top / display shelves cleaned in the body's texture), placed back on their host's
top by `gen/office/hostClutter.ts` (seeded, supported, non-overlapping) as dynamic `onHost` props (`gen/office/physics.ts`).
Wave 2 (lane SCALE's catalog review): `draftingLamp` (drafting table), `studioMonitor` / `studioMonitorSmall` (the mixing desk's meter
shelf), `espressoCups` (beside the espresso machine, which now stands on a `cabinetLow` counter: `ON_SIDEBOARD`); furniture-only
proportion edits in the same script (`legs`: foosball +0.40 m, ping-pong +0.20 m and width x0.7625; `plinth`: the mixing desk on a
0.45 m riser; drafting table / espresso machine rescaled by their own board / width).

### Service annexes (Track 2, lane CONTENT)
The track tunnels' service annexes are dressed with EXISTING prop kinds (`game/src/gen/annexContent.ts` through the core
dresser: purpose rules, the composer, the iteration-07 dresser) — every kind keeps its `OPENABLE_AUDIT` / physics class (the one new
kind, the survivor caches' `palletBed`, is classified and scale-checked below). Storage there opens like everywhere (same openables, finite seeded contents from the
loot tables: an annex's deepest holders keep their room's table, the stash `ANNEX_STASH_KEY`, supply holders `ANNEX_SUPPLY_KEY`
by depth band, a few scraps `ANNEX_SCRAPS_KEY`, the rest searched-clean `ANNEX_PICKED_KEY`; every bare annex room gets one storage
piece — `docs/loot-tables.md` "Service annexes"); loose kinds keep their bounded physics; placement goes through the
same primitive (door zones and clearance, access / swing strips, connectivity), on the annex floor (the trackbed, props lifted onto
it like the core's).

Survivor caches (task studio-alpha-track2-round2-20261031-01, lane CACHE, R5; `game/src/gen/annexCache.ts`): one NEW kind,
`palletBed` — a survivor's camp bed, a local procedural purpose shape (`gen/purposeShapes.ts`; no model / asset file): a 14 cm foam
mattress (vinyl cover), an open sleeping bag (accent palette), a pillow and a folded blanket on two 1.0 x 0.8 m wooden pallets.
- Openables audit: `none` (no door, lid or drawer). Physics audit: static, `too heavy` — mattress and bedding on two pallets (~45 kg)
  lying flat against a wall; a body bump or a bullet does not shove it. Damage: fabric, never breaks.
- No baked loose clutter: the pillow / sleeping bag / blanket are bedding (like a couch's cushions, no item exists for them); the
  cache's loose things are separate props (existing camp kinds) and its finds are real loot on the shelf / in the cabinet / crate.
- Scale check (`node tools/asset-pipeline/props/scale-check.mjs --kind palletBed --kind crate` — the tool now renders authored
  procedural purpose shapes for `--kind` too, flat stand-in colours per material): **W×H×D 1.99 × 0.36 × 0.80 m** (PROP_DEFS box
  2.0 × 0.38 × 0.84), grounded (min-y 0, 18 contact clusters: the pallet runners over the full 1.99 × 0.80 m span), surfaces: pallet
  deck 0.12 m, mattress top 0.26 m, sleeping bag 0.31 m, pillow / blanket 0.35 m — a low floor bed, its length a little over the
  1.78 m reference zombie's height. Viewed beside zombie `lastshift` at runtime scale 1.0.
- The cache's other pieces are existing kinds with their existing classes (shelf / cabinets / crate: open / existing openables, holder
  statics; the camp things: their iteration-07 dynamic / static rows).

The survivor HIDEOUT (task studio-alpha-track2-round3-20261031-01, lane HIDEOUT; user: "The cache should include pops like bed roll,
lantern and stuff, to make it feel like someone lives there … substantial detail"): five NEW local procedural kinds (box parts, no model
/ asset file, no generation), every one classified in both audits and scale-checked beside the runtime zombie (`node
tools/asset-pipeline/props/scale-check.mjs --kind <kind>`; the tool now also renders `gen/propShapes.ts` prop shapes; renders under
`qa-artifacts/hideout-scale/`, viewed):

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact; surfaces) |
|---|---|---|---|---|
| `bedroll` (purpose shape) | closed-cell foam mat, lofted sleeping bag (accent palette), rolled-fleece pillow, folded blanket | `none` | static, NEW `StaticWhy` **`flat`**: ~3 kg of soft bedding lying flat — no rigid body to shove or tip | 1.90 × 0.15 × 0.72 m (box 1.95 × 0.17 × 0.78); grounded, 10 contact clusters over 1.9 × 0.72 m; bag top 0.10 m, pillow / blanket 0.14 m |
| `campTable` (purpose shape) | a salvaged door panel (lock bore, hinge plates) on two piers of eight cinder blocks | `none` (a table top) | static `too heavy` (~90 kg) | 1.30 × 0.75 × 0.62 m; grounded, 12 clusters (the block piers); top 0.75 m (desk height) |
| `footlocker` (purpose shape + authored openable) | wooden trunk on skids, steel corners / band / hasp, rope-grip handles; the authored LID hinges on its back edge over a wood-lined compartment | `openable` (`world/openablesSpec.ts` `footlocker`: body = the purpose shape minus the lid, `bodyPurpose`; lid `hinge x`, −95°, ≥ 65° against the wall) | static `holder` (non-spill holder: its lots never float) | 0.81 × 0.39 × 0.43 m; grounded on its skids (8 clusters); lid top 0.385, compartment floor 0.042 m |
| `campLantern` (prop shape) | steel fuel base + valve knob, painted collar / hood (accent), glass globe round a self-lit mantle (NEW face-mapped `lanternGlow` shape material), guard posts, vent cap, wire bail | `none` | **dynamic**, 1.2 kg cylinder, `pad` contact, `onHost` (it stands on the camp table and goes loose on that static host, like an office monitor) | 0.15 × 0.31 × 0.16 m; grounded (base); hood 0.25 m |
| `campStove` (prop shape) | one-burner portable butane stove: painted body, steel top plate, burner + cap, pan supports, knob, canister door — no pot / food baked | `none` | **dynamic**, 1.8 kg, `pad` contact, `onHost` | 0.30 × 0.11 × 0.27 m; grounded; top plate 0.083 m |

- No baked loose clutter: the bedroll's pillow / blanket are bedding (like the pallet bed); the lantern and the stove are SEPARATE loose
  props on the table's real top (`PropPlacement.host` = the table, y = its 0.75 m top); the hideout's food / water / ammo are real loot in
  its holders; the gear piece is a real pickup.
- The lantern's LIGHT is not a prop light: a warm `virtual` light-field record at the lantern (the existing baked light field, no new
  light system; it stays where the lantern stood if the lantern is knocked away — a documented limitation).
- Tests: `tests/annex-hideout.test.ts` (audit classes, supported pieces, the footlocker's lid part and its persistence),
  `office-physics` / `contact-physics` (the two new dynamic Subway kinds and their masses; on-host by design), `openables`,
  `purpose-shapes`, `damage`, `textures` (the new `lanternGlow` key).

## 3. Movable things move
Standing user rule (2026-10-30): **every physics object reacts to the player walking into it — no shot needed first** (task
office-props-physics-scale-20261030, lane PHYS; `tests/contact-physics.test.ts`).
- Use the existing bounded, lazy, sleeping physics for loose props (bodies created on demand, asleep until hit or bumped):
  `game/src/physics/dynamicItems.ts` (`MAX_DYNAMIC_PROPS` simulating at once; at rest a loose prop is a static body; the
  first hit or bump detaches its render instances — Meshy model or box stand-in, same materials — via `damage/propDamage.ts`).
- Classify the kind:
  - office / company / supporting kinds: a row in `OFFICE_PHYS` (`game/src/gen/office/physics.ts`) — `D(mass, mat, how,
    {shape, onHost, fit})` or `S(why, how)`; `damage/materials.ts` spreads the dynamic rows into `PROP_PHYSICS` (with
    `contact`);
  - other kinds: `PROP_PHYSICS` / `PROP_DEFS.physics` for mass / `dynamic`, plus a row in `SUBWAY_CONTACT`
    (`damage/materials.ts`: calibrated `castor` / `pad` material, optional chair `fit`, the audit sentence) so it wakes by
    contact; a static one needs its reason in `damage/physicsAudit.ts`;
  - `PROP_PHYSICS_AUDIT` (`game/src/damage/physicsAudit.ts`) joins both; `contact` / `mat` there are read from the live
    physics. `tests/office-physics.test.ts` and `tests/contact-physics.test.ts` fail for an unclassified kind, an empty reason,
    a row that disagrees with the live physics (`dynamicKind`, `propPhysics().contact`) or a light floor kind without a
    calibrated material.
- Plausible mass / friction / impulse:
  - a chair slides and tips;
  - a bean bag barely moves under a pistol round;
  - a filing cabinet doesn't fly.
  - Contact materials: cannon-es clamps friction impulses by μ·m·g per step, so the iteration-07 materials make a shoved box
    stick (it only rocks / tips, and the walker sinks into it). Every light floor kind — office furniture and the Subway kinds
    alike — uses the calibrated `castor` (wheels / castors: suitcases, strollers, wheelchairs, hand trucks, wheelie bins, mop
    buckets, shop vacs, IV poles, ingredient bins, swivel chairs) or `pad` (feet / bases / bags / bundles: stacking and folding
    chairs, signs, fans, extinguishers, trash bags, newspaper bundles, ladders, barricades, racks, bicycles, the trash can, the
    archive box stack) material of `PHYS_MATS`. Masses are unchanged (a ~12 kg wheelie bin rolls / rocks, a 7 kg trash can and
    a 28 kg archive stack slide / tip; none is launched).
  - Rule of thumb: furniture without castors over ~30 kg stays static (`too heavy`); the walker shove matches the walker's
    speed, so a dynamic sofa could be bulldozed like a chair.
- Contact, in EVERY world (Subway, Office storeys, the station hall under the tower, the roof): walking into a light prop of
  a `contact` kind wakes it; walkers then shove it. The player is the waker; AI walkers wake props only within
  `CONTACT_RANGE` of the player. `contact` kinds use the office shove rules everywhere (shove gain, push within the body's
  height, a raised prop out of the legs' reach); uncalibrated kinds keep their world's rules (`DynamicItems.officeRules`:
  towers).
- Spill holders (trash can, wheelie bin, archive boxes — every holder `dynamicKind` lets move) wake by contact too: a walk-in
  knocks one loose exactly like a shot — its lid pops and `containers.goLoose` spills its finite lots once, as pickups of the
  same lot id / item / count (never re-rolled, duplicated or lost; hover targets the pickups; the loose holder is no longer an
  [E] target). Pickups lying under a prop when it goes loose (its spilled lots, a pickup beneath it) are not knocked by it
  while still inside its box (they would start inside its collider and pop). Every other holder stays put.
- A collider that would start inside a static neighbour (a stacking chair tucked under its table) is clipped on that side when
  it goes loose, so it never pops out; office kinds start within 2 cm and are unchanged.
- The detach budget is reclaimed, never used up (`MAX_DETACHED` 64 soft / 96 hard): a resting loose prop (also a budget-frozen
  one) hands its own meshes back to its shared instances AT ITS NEW POSE (`PropDamage.reattach`: instance matrix = its drawn
  pose, no pop, material clones dropped) and stays loose — walking into it or shooting it detaches it again. In the background
  (one per frame while fewer than `CONTACT_RESERVE` + `RECLAIM_AHEAD` soft slots are left) only unmarked resting props, oldest
  at rest first. Only when a wake needs a slot right now: also a bullet-marked one farther than `RECLAIM_MARK_FAR` (or on
  another storey) from the player (its marks go), then the damage system's own far marked props (`reclaimMarked`). Never:
  broken bodies / glass, moved merged-mesh triangles, props beside an elevator shaft. Contact wakes still keep
  `CONTACT_RESERVE` slots for bullet marks.
- On-host decor (`onHost`, e.g. the monitor on a desk) goes loose on its static host's top (a host-top support slab is
  added); a prop that something rests on never goes loose (every world); collider `fit` shrinks a chair's box (it is tucked
  under its desk). Pickups lying on a prop that starts to move are woken with it (they fall / ride, never float).
- Loot rides with its holder or is dropped as real pickups. It never floats, duplicates or vanishes; hover highlights follow
  the item.
  - A moving holder must be a spill holder (`spill` in `world/openablesSpec.ts`: `containers.goLoose` drops its finite lots as
    the same pickups, the doors / lid ride the body).
  - A moving light prop of a `contact` kind (any world; every kind in the Office) lifts the lots it hits off their holder as
    pickups (never duplicated).
- Never wake the whole level; never add unbounded bodies or per-frame scans of every loose prop: simulating bodies are a set,
  resting loose props are indexed by their 4 m static collision chunk and their static bodies join the cannon world only while
  that chunk is active (`PhysicsSystem.refreshChunks`). The broadphase (`physics/broadphase.ts` `LiveSAPBroadphase`: SAP's
  exact pairs in the same order, without its quadratic walk over static bodies; an id-keyed first-contact matrix) keeps the
  pair search linear in the tower's ~1300 static chunk boxes (Node measurement, 4 awake props in the Office: a cannon step
  19.9 → 2.5 ms; trajectories bit-identical). Resting loose props inside the moving elevator cab ride it.
- Static by design, with the reason recorded (`PROP_PHYSICS_AUDIT`):
  - built-in or very heavy furniture, wall-mounted fixtures, machinery, anchored / bolted pieces, partitions, structure;
  - loot holders that do not spill (their finite lots would float);
  - light kinds standing on a host (a toolbox on a crate) and on-top decor of a dynamic host (no floating stacks);
  - `kept` Subway kinds — `janitorCart` (~40 kg loaded cart), `crtTvCart` (~45 kg CRT on a cart), `mobileWhiteboard`,
    `physicianScale` (~25 kg): deliberately left static by this pass (not physics objects today; a later pass may calibrate
    them), listed so it is visible.
- Browser spot check: `__LL.goWalkInto('rollingSuitcase')` / `__LL.goWalkInto('bin')` (Subway) or
  `__LL.goWalkInto('officeChair')` / `__LL.goWalkInto('archiveBoxes')` (Office), hold W ~1 s, then `__LL.walkIntoCheck()` →
  `loose: true`, `moved` > 0.3, `shots: 0` (a spill holder: `spilled` = `lotsBefore`, `lotsLeft` 0).

## 4. Checks for a new prop
- Unit tests:
  - its audit classes;
  - openability (parts animate, contents finite / themed / remembered);
  - loot fit;
  - physics class (dynamic kinds get a body, react to an impulse and settle; static kinds don't) — the pattern is in
    `tests/office-physics.test.ts`.
- The scale-check render beside a zombie (section 5), viewed, with its W×H×D, furniture-only bounds and contact recorded.
- One short serial browser spot check of a representative prop when visuals change (root `CLAUDE.md` browser rules).

## 5. No baked clutter, real-world scale (scale check)
Task office-props-physics-scale-20261030 (lane SCALE); root `CLAUDE.md` rules 4 and 5.
- **Never bake loose items into furniture.** Beakers / lab glassware, monitors, keyboards, bread and other food, papers,
  books, tools, bottles and cups are separate runtime props or loot items placed (seeded, supported, not floating or
  overlapping) on the furniture's real support surface, so they move or can be taken. Separate them locally from an existing
  model (no regeneration without approval); keep the source provenance. Permanent structure — handles, hinges, shelves,
  built-in fixtures — stays in the model. A remaining baked case is listed as an exception with its reason.
  - Explicit exception (task mall-round2-20261031, lane PROPS, M03): `cctvConsole` (D31) keeps the control equipment on its
    desk slab — PTZ joystick and its coiled lead, CCTV keypad, a flush touch panel, a radio base unit, a gooseneck intercom
    mic — as wired, console-mounted fixtures of the built-in security desk (no radio / joystick / microphone prop or item
    exists in the catalogue). The console itself now stands on a local steel base (desk top 0.75 m):
    `build-office-overhaul.mjs` FURNITURE `consoleBase`, `lib/console-base.mjs`.
- **Inspect every new or changed prop beside a zombie** with `tools/asset-pipeline/props/scale-check.mjs` (CPU only, ~1 s;
  no browser / GPU / Blender). It renders FRONT and SIDE orthographic views on one ground line (0.1 m grid, labelled 0.5 m
  ticks, dashed seat 0.45 / desk 0.75 / counter 0.90 / door 2.00 m references) beside zombie `lastshift` (1.78 m bind mesh,
  runtime scale 1.0 = the median of the game's 0.95–1.05; `--zombie-scale` refuses anything else), and writes a JSON report.
  ```
  node tools/asset-pipeline/props/scale-check.mjs --kind labBench --below 0.91 --out <evidence>/lab-bench.png
  node tools/asset-pipeline/props/scale-check.mjs --kind tradingDesk --model <new.glb>   # a new GLB under the kind's runtime fit
  node tools/asset-pipeline/props/scale-check.mjs --prop <file.glb> --turn [--scale s | --fit w,h,d | --fit-wd w,d]
  node tools/asset-pipeline/props/scale-check.mjs --batch office --per 4 --out <dir>/catalog   # one sheet per 4 kinds
  node tools/asset-pipeline/props/scale-check.mjs --list office   # resolved runtime model / transform per kind
  ```
  - `--kind` reproduces the game's own transform from its data (`PROP_DEFS`, `world/openablesSpec.ts`, office / company
    assets): openable kinds fit non-uniformly to `PROP_DEFS` w / h / d (`meshSplit.fittedMeshes`, half turn for -Z files);
    office / company kinds fit uniformly, k = min(w / size.x, d / size.z), then turn (`world/officeProps.ts`); iteration-07 and
    Subway model kinds fit non-uniformly. So the render shows what the game will show after a dims / file change.
  - Furniture-only bounds: `--below <y>` (exact clip at a height) or `--exclude <regex>` (node / mesh / material names).
    Excluded parts are drawn magenta; the cyan box is the furniture-only bounds. Size by the furniture, not by the clutter.
  - Record: W×H×D (full and furniture-only), grounded contact (min-y, floor gap, contact clusters drawn red on the ground;
    a warning when the lowest point is only a speck), surface heights (yellow: plateaus of a 1 cm top-down height map; the
    main one is usually the work top or seat).
  - Look at the PNG yourself. Typical: desk / worktop 0.72–0.76 m, lab bench ~0.9 m, counters 0.9–1.0 m, chair seat
    ~0.45 m, doors ~2.0 m. A resize also moves the kind's footprint, collider, loot surface / slot heights and hinges.

### The Reactor bunker (task reactor-expansion-20261101, lane BUNKER)
Zone 0's side complex (`game/src/gen/reactor/complex/bunker*.ts`) is furnished with EXISTING kinds by the station dresser (its rooms
carry existing purposes: guard post `security-office`, infirmary `first-aid-room`, radio room `signal-room`, mess `staff-room`, stores,
workshop, switch room, filtration plant `ventilation-plant`, generator hall `generator-room`) and by its dress hook (`bunkerDress.ts`:
footlockers / lockers / gun lockers / cabinets / crates = existing openables and holders, loot from the room's purpose — the four
`reactor-bunker-*` purposes use named `items/lootTables.ts` tables only; folding chairs / extinguishers keep their dynamic class; the
day tanks are collision-only `annexMachine` boxes under existing shape-material trims). Four NEW kinds draw the lead's Meshy T2.5 models
(`REACTOR_X_KIT`, maps kept; `gen/reactor/complex/bunkerKinds.ts` holds their classification, spread into both audits):

| Kind | What | Openables audit | Physics audit | Scale check (`scale-check.mjs --prop <glb> [--scale k]`, viewed beside `lastshift`) |
|---|---|---|---|---|
| `bunkBed` | bare steel double bunk | `none` | static `anchored` (~70 kg, bolted in rows) | 2.00 × 1.36 × 0.85 m as cooked; grounded (4 feet); lower deck ~0.25 m, upper deck 1.12 m (a compact shelter bunk) |
| `radioConsole` | operator's desk built into its radio rack | `exception`: the drawer fronts are the chassis' wired equipment bays (live equipment, not storage) | static `built-in` (~200 kg, cabled) | scaled ×1.125 so the desk top reads 0.73 m: 2.25 × 1.77 × 1.34 m; grounded (13 clusters) |
| `airFilterUnit` | filter canister bank, blower, stacks on a skid | `exception`: sealed plant, hatches bolted | static `machinery` (~600 kg) | 3.00 × 1.84 × 0.91 m as cooked; grounded (24 clusters); canister tops 1.46 m |
| `blastDoor` | square frame round a ~2.5 m round opening, the round leaf open at 90° | `exception`: structure; the leaf never closes | static `structure` | 4.95 × 4.00 × 5.45 m as cooked, grounded in the 1 m lock / decon bulkhead; the 1.5 m lane climbs a 0.84 m threshold (three 0.28 m risers each side; the sill level runs one row past each face, so the frame plate below the opening stays under the walking surface) so its doorway clear volume (1.3 × 2.1 m) sits inside the round opening (free chord ≥ 1.5 m from 0.79 to 2.97 m). Variant 0 = the leaf (+ render anchor), variant 1 = frame feet / pillar protrusions (collision only) |

- No baked loose clutter: the four models are bare furniture / equipment (no bedding, papers, handsets or tools baked in).
- Tests: `tests/reactor-x-bunker-carve.test.ts`, `tests/reactor-x-bunker-level.test.ts` (both audits, purpose loot, placements on their
  floors / inside their ceilings, doorway lanes, the blast door's anchor on the lane).

### The Mall lingerie boutique (task mall-lingerie-20261102 / store-polish-20261103, lane STORE)
Program `lingerie` (gen/mall/shops.ts; large standard-line / end units only, a per-mall chance, never guaranteed). Polish (user: "The
chaining rooms are like boxes placed in the store ... It should be built, with normal walls, as like an actually ROOM"): the changing
SUITE is now real level geometry carved into the shop's grid by `gen/mall/lingerieStore.ts` placeChangingSuite — one-cell (0.5 m) SOLID
walls to the shop ceiling, framed doorways (layout.doors, a = b = the sales floor, lowered lintel ceiling at 2.3 m), 3-4 private rooms
(1.5 x 2.0 m inside) off a 1.0-1.5 m corridor along the back wall, the suite's 1.5 m doorway onto the sales floor; nav / collision /
hitscan / sight come from the grid like every wall. The first version's free-standing booth panels (`fittingPartition`,
`fittingBackPanel`, `fittingCurtain`) and the black box display form (`lingerieBust`) are DELETED. The sales floor follows the clothing
stores (rails, round racks, clothing bays hung with lingerie, dressed mannequins). Both audits: `gen/mall/kinds.ts` MALL_OPEN_AUDIT /
MALL_PHYS (spread into OPENABLE_AUDIT / PROP_PHYSICS_AUDIT).

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact; surfaces) |
|---|---|---|---|---|
| `fittingBench` | built-in timber bench on two brackets against a room's back wall | `none` (no lid / drawer) | static `built-in` | 1.42 × 0.45 × 0.40 m; grounded (4 bracket contacts); seat 0.45 m |
| `fittingMirror` | mirror (0.6 x 1.4 m glass from 0.55 m) in a thin frame: each room's side wall by the bench, a full-length one on a sales-floor wall | `none` | static `mounted` (screwed to the wall) | 0.60 × 1.44 × 0.02 m from 0.53 m: wall-mounted, intentionally off the floor (its 0.5 m strip of room floor is kept off the nav grid) |
| `lingerieSet<Design>` ×6 | the six sets DRESSED ON the existing female mannequin (`mannequinFemale`, M81): riders sharing its x / z / yaw; lane FIT's mannequin-fitted meshes under the mannequin's exact runtime transform; procedural stand-ins until loaded | `none` | static `host decor`, **rides** the mannequin (MALL_RIDER_KINDS) | the dressed M81 0.44 × 1.75 × 0.35 m, grounded on its base (CPU render: qa-artifacts/lingerie/store/polish/dressed-mannequins.png); collider 0.76-1.44 m |
| `lingerieRackRow` | lingerie on hangers hooked side-on along a garment rail (1.53 m) / clothing bay rail (1.915 m): lane FIT's LingerieHang items, seeded designs / pattern (variant) | `none` | static `host decor`, **rides** its rail | items drop 0.28-0.60 m below the rail (hem >= 0.9 m on a rail); rider box 1.42 × 0.32 × 0.62 m (CPU render: polish/hung-racks.png) |
| `lingerieRackRing` | the same round a round rack's ring (1.31 m) | `none` | static `host decor`, **rides** its rack | hem >= 0.69 m; rider box 1.1 × 1.1 × 0.62 m |

- No baked loose clutter: the rooms' bench / mirror are built-in fixtures; the stock is separate riders on mannequins / rails; the store's
  finds are real loot in its holders (drawer chests, the till, tables, bays).
- Renders: `node tools/asset-pipeline/props/scale-check.mjs --kind fittingBench --kind fittingMirror --kind lingerieRackRow --lift 0.91
  --kind lingerieRackRing --lift 0.69` (stand-ins) and the composed real-stock renders above (`--prop <glb> --turn` for the mannequin),
  viewed beside zombie `lastshift` at runtime scale 1.0.
- Tests: `tests/mall-lingerie-store.test.ts` (rooms enclosed by walls + one framed doorway each, validation clean, enemy paths, the floor's
  racks / dressed mannequins / stock), `tests/lingerie-mannequin-fit.test.ts` (lane FIT), `tests/mall-lingerie-spawns.test.ts` (lane CONTEXT).

### The Skyways ramen restaurant (task studio-skyways-level-20261106-054448, lane FOOD)
`gen/skyways/ramen.ts` dressSkywaysRamen dresses the base shop pool's ramen bar (a carved dining room + optional kitchen) with EXISTING
kinds — a `shopCounter` run (island with a staff aisle, else against the back wall), a glass-door `shopCooler`, the mall café sets
(`cafeBistroTable` + `cafeChair`, now and then a `foodCourtTableSet`), a `shopBackbar`, the kitchen `fridge`, open `shelf` — every holder
keyed to the `skyways-ramen*` purposes (named `items/lootTables.ts` RAMEN_* tables: exact, one or two lots, often none). Its EDIBLE food
(ramen / chashu ramen / sushi bento / bubble tea: ordinary consumables, `items/skywaysFood.ts`) is those finite lots plus 2-4 loose
pickups on the café tables / the counter's pass (the counter's span under a pickup or the mascot is cut out of its loot surface). Four
NEW kinds draw lane ASSET-A's derivatives of the user's community-supplied sources (front +Z; maps kept; `gen/skyways/kitchenKinds.ts`
holds their classification, spread into both audits):

| Kind | What | Openables audit | Physics audit | Scale check (`scale-check.mjs --prop <glb>`, viewed beside `lastshift`) |
|---|---|---|---|---|
| `skywaysRange` | commercial gas range: 6 burners + griddle, two oven doors, backguard + high shelf | `exception`: the oven doors are the appliance's (cold, empty ovens: not storage) | static `anchored` (~250 kg, hard-piped) | 1.52 × 1.40 × 0.89 m; grounded (4 feet); cooktop plateau 0.915 m = the collision / host top (the thin backguard / 1.40 m shelf above it are drawn only) |
| `skywaysStockPot` | 20 l stainless stock pot with its lid, on the range | `exception`: cookware, the lid is part of its one mesh | **dynamic** 3.5 kg cylinder, `pad` contact, `onHost` (the range's cooktop) | 0.42 × 0.27 × 0.32 m (handles / lid knob incl.); grounded (one base) |
| `skywaysSaucepan` | rusty steel saucepan, on the range | `none` | **dynamic** 1.3 kg box, `pad`, `onHost` | 0.46 × 0.10 × 0.22 m (handle incl.); grounded |
| `skywaysSushiMascot` | kawaii sushi display figurine, on the service counter | `none` | **dynamic** 0.8 kg box, `pad`, `onHost` (the counter top) | 0.51 × 0.32 × 0.33 m (arms spread); grounded (feet) |

- No baked loose clutter: the range / cookware / figurine models carry no food; the bowls, bento and cups are separate items.
- Tests: `tests/skyways-food.test.ts` (registrations, both audits, purpose loot, the dresser on a synthetic carved restaurant — support,
  overlap, finite pickups, frames — and the cookware / figurine going loose on their static host under fire).

## 6. Player-train fixtures (not layout prop kinds)
Task train-lockbox-windows-20261101-232156. The player train's parts are built by `world/playerTrain.ts`, not from `PROP_DEFS`, so
they sit outside the two audits; their classification is recorded here.
- **Lockbox** (`world/trainLockbox.ts` world object, `run/trainLockbox.ts` store, `ui/lockboxView.ts` view):
  - Storage opens: [E] raises its hinged lid and opens a 40-slot transfer view.
  - Contents: the player's own storage. It starts EMPTY each run and is never seeded or refilled, so there's no loot table.
    It is finite, persistent and carried by the run's player-train record: Travel keeps it, Retry restores the level-entry
    state, New game empties it. The developer code 1337 adds gear only on purpose (`items/devGrant.ts`).
  - Physics: static, `anchored`: bolted to the car floor, a solid box for player / enemy / hitscan, no physics body.
  - No baked clutter: the model is just the box, its lid, latches, hinge and handles.
  - Scale (rule 5): `scale-check.mjs --prop game/public/assets/models/player-train-lockbox.glb`, viewed. 1.03 × 0.556 × 0.614 m,
    grounded on 4 skid contacts, top at 0.55 m (a footlocker below the 0.98 m window sills).

## 7. Reactor mines set pieces (not layout prop kinds)
Task reactor-expansion-20261101 (lane MINES). The old mine workings off tier 2 (`gen/reactor/complex/mines*.ts`) dress their drifts
with EXISTING prop kinds (crates, cabinets, lockers, tool chests, gas cylinders, the sump pump, work lights, a drum fan, a barricade,
wall-mounted phones / first-aid kits / tag board / clock) through the dresser's primitives, so every one keeps its audit rows. The set
pieces below are collision-only `annexMachine` boxes (`gen/reactor/complex/minesDress.ts` `MINE_PIECE` variants) that
`world/reactor/minesVisuals.ts` draws with the lead's Meshy models (`REACTOR_X_KIT`, maps kept):
- **Ore cart** (`mineCart`): static, rail-bound: a ~650 kg steel ore car chocked on its 600 mm rails. A body bump or bullets don't move
  it. It's an empty open car, not storage.
- **Hoist winch** (`hoistWinch`): anchored, bolted to its concrete base; machinery, not storage. Beside it is the fenced blind
  **winze**: a 2 × 2 m collision box for the steel guard fence round the timber collar (you can't fall in).
- **Drill rig** (`drillRig`): static, too heavy (a rubber-tyred rig of several tonnes); machinery.
- **Timber cribs / rubble**: structure (stacked crib timbers to the stope roof; the fallen rock choking the collapsed drift).
- **Timber support sets** (`timberSet`): anchored structure (posts wedged against the rock). Each post is a collision box over the rib
  cell it stands in (`MINE_PIECE.post`), and that cell is blocked where the post stands more than 0.12 m proud of the rib. The whole
  set (its cap ends) stays inside the drift's rock walls, so it never pokes into the next space. A set is never placed on an opening's
  cells, a prop, a lamp or a plate. The cap clears at least 2.3 m.
- No baked clutter: the models are the machines / timber only. Loot stays in the existing openable holders.

Scale (rule 5), `scale-check.mjs --prop <glb>` beside zombie lastshift (1.78 m, runtime scale 1). Every model is viewed and grounded:
| Model | Scale | W × H × D | Contacts |
| --- | --- | --- | --- |
| Ore cart | 1 | 1.80 × 0.78 × 0.79 m | 4 (wheels; 600 mm gauge) |
| Hoist winch | 1 | 3.00 × 1.64 × 1.71 m | 4 (the base) |
| Drill rig (round 2: `MINES_FIT.drillRig`) | 1.9 | 6.65 × 2.43 × 1.87 m (carrier 4.04 m) | 10 clusters, all on the 4 tyres |
| Timber set in a 3 m × 3.3 m drift (first fit, viewed) | 1.36, 1.31, 1 | 4.62 × 3.30 × 0.53 m | 13 (post feet) |

The drill rig was cooked at 3.50 × 1.28 × 0.98 m: knee / waist high, with 0.5 m tyres (user: "comically small"). Task
reactor-playtest-round2 (lane PROPS) draws it at a derived uniform fit of 1.9, with no re-cook: a compact single-boom face-drill rig
with ~0.95 m tyres, the carrier frame at head height and the boom to 2.43 m. Its collider, heading and placement read
`minesModelSize`. The timber set is now scaled per drift by
`timberSetFit`: its cap ends reach the rib + 0.48 m (x ≈ 1.16 in a 3 m drift). Its posts then stand about 0.3 m proud, leaving a clear
opening of about 2.4 × 2.35 m.
