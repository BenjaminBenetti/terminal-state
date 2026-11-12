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

### The Survivor Market (task studio-survivor-market-20261108-005807-01, lane LEVEL)
The calm settlement (`game/src/gen/market/dress.ts`) is furnished with EXISTING kinds only — no new kind, so no new audit row or scale
check: stall counters (`shopCounter`), the mall's gun rack / plank shelving / camping tent (level-only mall files the market may load:
`assets/levelAssets.ts`), shelving, the first-aid cabinet, the iteration-07 workshop / kitchen kit, the kitchen lines, pallet beds,
bedrolls, fabric screens (`cubiclePartition`), camp tables, chairs, lanterns, fans. Every kind keeps its `OPENABLE_AUDIT` / physics class;
placement goes through the shared primitive (door clear volumes, access / swing strips, connectivity).
- **Market rule: storage opens and is empty.** A calm settlement has no free loot and no theft simulation: every loot-holder kind placed
  there carries the exact empty key `MARKET_EMPTY_KEY` (= `ANNEX_PICKED_KEY`, `{empty: 1, exact: true}`), and the level's loot profile
  (`items/lootTables.ts` `MARKET_PROFILE`) weighs every category 0 as a second guard. The crates / tool chest still open (their own
  openables); the traders' goods are the trade stock, never pickups or filler. The one exception is the common station fuel plan
  (`world/fuelStations.ts`): only the workshop has a fuel affinity, so a market station's plan cans go into its storage like at any station.
- Scale: the reused deck / workshop pieces were viewed beside the runtime zombie (`scale-check.mjs --kind tentDisplay --kind palletBed
  --kind repairBench --kind gunRack`): tent 2.20 × 1.15 × 2.14 m, pallet bed 1.99 × 0.36 × 0.80 m, repair bench 1.60 × 2.00 × 0.60 m
  (bench top 0.90 m), gun rack 2.00 × 1.48 × 0.31 m — all grounded.
- The ceiling fans and stall awnings are not props: visual-only dressing above every head (`gen/market/art.ts`, `world/marketVisuals.ts`).

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
- Shelf stock (task studio-skywalk-variety-20261107-231448-01, lane MERCH; user: "items on top of counters / shelves should not
  be part of the counter / shelf and have physics, when shot"). On-host decor standing INSIDE its static host's box also goes
  loose when shot: skates on a slatwall deck, books on a bookcase shelf, kits on a gondola tier, a record-bin block, a pot in a
  hanging basket. The one rule is `physics/merchOnHost.ts`, used by every consumer for every present and future movable kind:
  - It needs a KNOWN open support under it. That is a loot holder's own loot surfaces (its shelves: the holder now collides
    small things by its UNCUT surfaces, so the deck is there under a moved piece) or the host kind's declared
    `PropDef.shelves` (host frame; `[]` = it hangs its decor on hooks, so a knocked piece falls). Today `skyDBookcase`,
    `skyDBookTable` and `skyDRecordBins` declare their measured shelves / tiers / trays, and `storeGardenBasketRail` declares
    `[]`.
  - A host without a known support keeps its decor static. The Office reception counter-well monitor is inside a closed
    counter block.
  - A bullet that strikes such open shelving goes on into it (`raycastShot`, Game.fire): the first resting shelf piece on its
    line takes the hit, unless a wall or slab lies between. It never passes into an enclosed holder or a host without known
    shelves. A loose piece lying back on a shelf is hit as a body through the host's box.
  - Shelf stock is out of a walker's reach: the shelving is in the way, so there is no contact wake.
  - `skyMuFacedRecords` (one prop for a row of five sleeves) is now a static kind; layout version 4 splits every row into five loose
    sleeves (see "Skyways version 4: merchandise split off its fixtures" below).
  - Tests: `tests/skyways-merch-physics.test.ts`. A guard over real version 3 / 4 seeds checks that every piece resting inside its
    host has a known support and that no declared board starts inside stock. A buckshot volley through the real damage and
    physics path into one sample of every kind @ host pair checks that it goes loose, moves, never sinks through its shelf and
    rests supported. A shot pot falls and a Player shoves it.
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

### Carried by the player train (task studio-beta-train-all-cargo-20261107-184244-01)
User: "Let’s have all items on the train move with the train!" — confirmed for movable furniture, decor and containers.
- **Who travels:** every movable kind (`dynamicKind`), in every level, with no list to maintain. It travels when it lies loose in the
  parked car: its collider centre inside the car interior (`world/trainPropCargo.ts`). It rides to the next station:
  - it keeps its kind, variant, size, purpose, integrity and exact pose (any yaw or tilt);
  - decor riding it (`ridesHost`: garments on a rail) travels inside its record;
  - a prop straddling a doorway refuses the departure;
  - everything aboard travels, or the train does not leave: more than 256 props (or 256 loose items, or a prop with more than 32
    riders) refuses the departure before anything moves; nothing is ever cut from a record or left behind.
- **New movable kinds** need nothing extra:
  - the carried copy is built by the kind's own family builder, appended to the next layout;
  - its models / Skyways art load in any level while it is carried;
  - it is made loose at its pose with `DynamicItems.adoptLoose`.
- A kind drawn by a builder that reads per-layout context must keep working for an appended placement with no `shop` / `host` and a
  nearby `area`.
- **Containers:** a movable container is always a spill holder. Knocked loose, its lots spill where it stood (once), so it travels
  open and empty and its contents travel as item cargo. A holder copy is emptied (no invented loot) and the fuel-can slots skip it.
- **Identity:** `'<section id>#<generated index>'`. The source station hides the generated original for good (`train-cargo.props`
  lane `gone`); the station a carried prop is left in owns it (`here`). One prop, one place: save-validated.
- **Tests:** `tests/train-all-cargo.test.ts`.

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

### The Skyways add-on: convention hall / prize-car atrium (task studio-skyways-level-20261106-054448, lane ADDON)
`gen/skyways/addon.ts` dressSkywaysAddon dresses the ONE add-on of a Skyways level (`addonConvention.ts`, `addonPrize.ts`; shared frame /
keep-mask helpers `addonFrame.ts`). Reserved first (`PlaceCtx.keep`): 1.5 m in front of every door of the hall, 1.8 m lanes entry -> stage
and entry -> washrooms (convention), the car body + 1.2 m and its exit lane to the entry (prize car). EXISTING kinds join them: folding
chairs in rows facing the stage, capsule-toy machines, arcade cabinets, a giant teddy (convention), planters (prize car). NEW kinds
(`gen/skyways/addonKinds.ts` holds their classification, spread into both audits; drawn by `world/skywaysAddon.ts`: lane ASSET-D's Meshy
models with their maps kept, lane ASSET-C's mascot pose GLB, the Codex art atlases on flat panels — crop / pack only, no new painting):

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact; surfaces) |
|---|---|---|---|---|
| `skywaysConStage` | modular stage: skirted deck, front steps, truss goalpost with hung speakers | `none` | static `structure`; collision = the deck box (8.0 × 4.4 m at 1.03 m) + its steps box (variant 1, collision only) | 8.00 × 5.18 × 5.17 m; grounded (skirt hem / feet / steps); deck 1.03 m; truss 5.18 m |
| `skywaysConBackdrop` | the stage backdrop art laced into the truss behind the deck | `none` | static `mounted` | 4.86 × 3.26 m panel above the deck, under the truss beam (4.40 m) |
| `skywaysConMerchTable` | 6-ft vendor table under a floor-length cloth | `none` (open top) | static `fixture`: the host of its loose merch (on-host decor goes loose only on a static host; a prop something rests on never moves) | 2.03 × 0.76 × 1.02 m (cloth flare); top 0.759 m over 1.84 × 0.78 m |
| `skywaysConFigureBox` / `skywaysConPlush` / `skywaysConPrintCard` | LOOSE merch on the table tops (boxed figure, plush, print in an acrylic block: the prints sheet) | `exception` (sealed retail box) / `none` / `none` | **dynamic** 0.6 kg box, `pad`, `onHost` | 0.16 × 0.24 × 0.06 / 0.30 × 0.34 × 0.28 / 0.21 × 0.25 × 0.11 m on the 0.757 m top |
| `skywaysConPoster` | paper poster in a snap frame on solid wall (never over glazing / doors / props) | `none` | static `mounted` | 0.84 × 1.24 m, bottom 1.05 m |
| `skywaysConPosterBoard` / `skywaysConWelcome` / `skywaysPrizeBoard` | freestanding poster board / welcome sign on an easel / GRAND PRIZE DRAW board on posts | `none` | **dynamic** 7 / 6 / 12 kg box, `pad` | 0.96 × 1.98 × 0.46 / 1.26 × 1.92 × 0.5 / 1.9 × 2.12 × 0.56 m |
| `skywaysConBanner` | fabric banner on battens, hung on cables from the ceiling | `none` | static `mounted` (>= 2.2 m clear under it) | 1.2 × 3.2 m incl. 0.52 m cables |
| `skywaysMascotStatue` | the mascot in a baked pose (variant = pose) on a round plinth; recorded in `addon.convention.statues` | `none` | static `anchored` (~150 kg resin, plinth bolted); round collider, any yaw | plinth 1.1 × 0.12 m + the 1.40 m pose (× scale) |
| `skywaysPrizeStanchion` | chrome rope stanchion round the prize car's spot | `none` | **dynamic** 8 kg cylinder, `pad` | 0.34 × 0.96 × 0.34 m; base disc grounded; eye ring 0.85 m |

- Statues: `wave` inside the entrance facing it, `point` turned so its hand (`SKYWAYS_MASCOT.poses.point.pointDir`) aims at the WASHROOMS
  door (<= 10°), `cheer` on the stage deck, `bow` by the merch tables, `stand` in the green room (or the event storage) when it fits.
- Loose merch: separate on-host props packed along each table's real top (never floating / overlapping); a shot knocks it over or off
  (host-top slab). No loose items are baked into the furniture models. Noted: the delivered stanchion model keeps a short red rope loop
  hanging from its eye ring (part of the cooked Meshy model, a clipped rope end — not a takeable item); the spanning velvet ropes are
  runtime geometry (`world/skywaysAddonRuntime.ts`): they hang between upright posts, follow nudged posts and DROP to the floor for good
  when a post is knocked over (never floating). The turntable under the car is render-only (no collision).
- Never any text about driving / entering the car: the prize add-on shows the GRAND PRIZE DRAW art only.
- Renders: `scale-check.mjs --prop skyways-con-stage.glb`, `--prop skyways-con-merch-table.glb --prop skyways-con-figure-box.glb --lift
  0.757 --prop skyways-con-plush.glb --lift 0.757 --prop skyways-prize-stanchion.glb`, viewed beside zombie `lastshift` at runtime scale 1.0.
- Tests: `tests/skyways-addon.test.ts` (both audits, the models / measured geometry, the convention and the prize car on the real seeds:
  statues / aim, stage against its wall, merch support / overlap, lanes / doors, posters / banners, the car's clearance / exit lane /
  ring / ropes / board; the renderer on the real GLBs; ropes dropping with a shot post; merch shot off its table).

### The Skyways convention VENUE floor and the walkable stage (task studio-skyways-rework-20261107-054512-01, lane VENUE)
Layout version 3 rents the host's whole skyway floor to the convention (`addon.venue` roles). `gen/skyways/venueDress.ts` dresses the
public areas beyond the main hall: registration (badge desks = the merch table kind with a staff folding chair behind, a stanchion queue
line whose velvet ropes the runtime draws from `addon.queues`, the welcome sign, the `registration-wave` statue), the exhibitors' floor
(vendor table rows with LOOSE merch on the tops and a vendor's chair, the pop-up exhibits: arcade cabinets + capsule-toy row + giant teddy,
a mannequin cosplay display), panel rooms (two tables, panelists, audience rows, a tripod screen), the photo lounge (photo-op wall,
`photo-pose` statue, armchairs / bean bags / ottoman / plants) and event wayfinding on the sign system. Every furniture group is kept only
if every opening of its area that was reachable before stays reachable by a 1.2 m wide path (then reserved as lanes); 1.5 m stays clear in
front of every door. Existing kinds keep their classes; FIVE new art-panel kinds (`gen/skyways/addonKinds.ts`, drawn by
`world/skywaysAddon.ts` from the venue's Codex atlas `textures/skyways/skyways-venue-art.jpg`, crop / pack only):

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact) |
|---|---|---|---|---|
| `skywaysVenuePhotoWall` | printed 3 × 2 m photo-op panel in a steel frame between two posts on sandbag-weighted base plates | `none` | static `anchored` (~45 kg) | 3.19 × 2.50 × 0.60 m, panel 0.42–2.42 m; grounded (base plates) |
| `skywaysVenueScreen` | tripod projection screen showing the panel's title slide (variant = slide) | `none` | **dynamic** 9 kg box, `pad` | 2.18 × 2.30 × 0.50 m, screen 0.80–2.20 m; grounded (T-foot) |
| `skywaysVenueRegSign` | framed registration sign screwed to the wall behind the badge desks | `none` | static `mounted` | 1.56 × 1.06 m at 1.30–2.36 m |
| `skywaysVenueTableBanner` | vinyl booth banner zip-tied along a vendor table's cloth front (hosted on the table; variant = studio) | `none` | static `mounted` | 0.90 × 0.60 m at 0.11–0.71 m, under the 0.757 m top |
| `skywaysVenueWallScreen` | a compact panel room's projection screen fixed to the wall behind the panel (variant = slide) | `none` | static `mounted` | 1.88 × 1.28 × 0.05 m at 1.15–2.43 m |

- Every carved event room is dressed, compact ones too: a narrow panel room gets one table and two panelists, closer audience rows and
  the slide on the wall screen; a compact lounge keeps its photo wall, the posed statue only where it fits, the seating that fits.
- Routes: besides each area's own openings, the WHOLE walk (the public venue areas + the main hall) is checked from every bridge mouth;
  the main hall keeps a lane from its entry to every other door of it (the rooms carved off it, the back of house).

- No loose items baked in: the panels are print + frame only; merch / chairs are separate props.
- The STAGE (`gen/skyways/stageSupport.ts`, user: "anime stage stairs must be walkable"): at runtime (`game.ts`, after the world is drawn,
  before levels / prop index / paths / physics) the grid floor under the drawn deck (1.029 m) and the two drawn treads (0.682 / 0.325 m,
  sampled at cell centres from the cooked model: risers 0.33–0.36 m, each within STEP_UP) is lifted, so the real player walks up the
  steps onto the deck and back down; the deck / tread boxes then no longer block a body standing on them, the cheer statue blocks at deck
  height, and collision-only truss boxes (stage variant 2) keep bodies out of the truss / backdrop line. Zombies' paths reach the deck by
  the steps. Version 3 stands the deck edge on a cell line (drawn ↔ support exact but the bottom riser, 8 cm); the frozen v1 / v2 stages
  get the same runtime support (within 0.15 m), their layout data unchanged.
- Renders: the five kinds (shape GLBs) + `skyways-con-merch-table.glb`, `scale-check.mjs --prop … --lift 1.3 (sign) / 0.11 (banner) / 1.15 (wall screen)`,
  viewed beside zombie `lastshift` at runtime scale 1.0.
- Tests: `tests/skyways-venue.test.ts` (roles, signature pieces, nothing floating, 1.2 m routes from every bridge mouth to every room door /
  the stage steps / the washrooms, door strips, wayfinding arrows, the venue atlas' provenance; the drawn stage heights vs the support; a
  real Player on the v3 and v2 stages; paths onto the deck), `tests/skyways-addon.test.ts` (both audits, the art faces, the renderer).

### Skyways destination anchors: garden, arcade, cinema, science, hockey (task studio-skyways-destinations-20261106-170011-01, lane SHOPS-B)
`gen/skyways/destinations/shopsB.ts` dresses five anchor families (placement context `skywaysShopsBKit.ts`: lanes from the storefront entry
to every zone / back-room door reserved first, cell-aligned runs, all-or-nothing counter runs). EXISTING kinds carry the storage and loot
(counters + register, stock shelving, coolers, back counters, the snack rack, the vending machine, merch tables), every holder on the
family's base-use purpose. The NEW kinds (`kindsShopsB.ts`: lane KITS' measured Meshy models, maps kept; the cinema screen code-drawn):

| Kind | Openables audit | Physics audit | Scale check (`--prop <glb>` beside `lastshift`) |
|---|---|---|---|
| `skyDPlantBench` | `none` (open slatted top) | static `fixture`: host of its pots | 2.98 × 0.75 × 1.05 m; 4 legs; top 0.75 m |
| `skyDGeraniumPot` | `none` | **dynamic** 2.5 kg cylinder, `pad`, `onHost` (the bench top) | 0.26 × 0.35 × 0.19 m; grounded |
| `skyDPottedPalm` / `skyDWheelbarrow` | `none` | **dynamic** 40 / 18 kg, `pad` | 1.57 × 2.20 × 1.59 / 1.50 × 0.63 × 0.52 m; grounded |
| `skyDPinball` / `skyDAirHockey` / `skyDClawCrane` | `exception`: sealed coin-op equipment (the claw's plush is the machine's display) | static `too heavy` (115-180 kg) | 0.83 × 1.90 × 1.45 / 2.10 × 1.07 × 1.07 (playfield 0.97) / 0.97 × 1.90 × 0.96 m |
| `skyDPopcornCart` | `exception`: food machine (its kettle's popcorn sealed) | **dynamic** 45 kg, `castor` | 1.07 × 1.60 × 0.78 m; wheels grounded |
| `skyDCinemaSeats` | `none` | static `anchored` (floor rail) | 2.40 × 1.04 × 0.80 m; seat 0.51 m; faces +Z |
| `skyDTicketBooth` | `exception`: kiosk, staff door onto the cashier's space | static `too heavy` | 1.77 × 2.40 × 1.54 m; counter shelf 0.93 m |
| `skyDCinemaScreen` | `none` | static `mounted` (the auditorium's far wall) | code-drawn 7.2 × 3.2 m frame |
| `skyDTelescope` / `skyDGiantGlobe` / `skyDRocketModel` | `none` | **dynamic** 14 / 16 / 28 kg, `pad` | 1.61 × 1.70 × 0.76 / 0.83 × 1.20 × 0.78 / 0.83 × 2.20 × 0.83 m |
| `skyDPlanetMobile` | `none` | static `mounted`: hung from its top hook, underside >= 2.3 m (double-height only) | 3.00 × 2.58 × 2.03 m |
| `skyDHockeyNet` / `skyDGoalieMannequin` | `none` | **dynamic** 38 / 24 kg, `pad` | 1.83 × 1.23 × 0.76 / 1.07 × 1.95 × 0.61 m |

- No baked loose clutter: the bench is empty (its pots are separate on-host props); the science kits on the merch tables are separate
  on-host props with their spans cut out of the tables' loot tops.
- Tests: `tests/skyways-dest-shops-b.test.ts` (both audits, measured footprints, signature pieces per family on real seeds, the screen on
  the far wall with the rows facing it, support / containment / overlaps, lanes to every door, base-use loot, determinism).

### Skyways version 4: merchandise split off its fixtures (task studio-skywalk-variety-20261107-231448-01, lane MERCH)
User: "cover other affected Skyways counter / shelf items consistently, not only one pair of skates". Three shop fixtures still drew
their merchandise as part of the fixture. Skyways layout version 4 splits them into the bare fixture plus separate, ordinary movable
stock props. The pass is `gen/skyways/skywaysMerchSplit.ts`, run at the very end of version-4 generation:
- it appends props (no index shifts) and makes no rng draws;
- it is gated on `skywaysGenVersion(layout) >= 4`, so versions 1-3 and every other level keep their fixtures whole.

The kinds are in `gen/skyways/stores/kinds/merch.ts` and are drawn by `world/skywaysMerch.ts`:
- **Demo table** (`techDisplay`): its six demo phones / tablets on stands were authored parts of the table. Version 4 draws the bare table
  (variant 1; its box drops to the 0.76 m top) and places six `skyMerchDemoPhone` / `skyMerchDemoTablet` props carrying exactly those parts.
- **Device wall** (`deviceWall`, `tech-display-t25.glb`): its four display devices were part of the model. At runtime the model is
  deterministically mesh-separated: its fitted triangles are cut exactly at fixed planes (`world/meshSplit.ts` partition) into the bare
  unit (variant 1) and four `skyMerchWallPhone` / `skyMerchWallTablet` props. Each draws its own cut triangles with the model's material
  and maps; the GLB is untouched.
  - The unit declares its 0.849 m cabinet deck (`PropDef.shelves`).
  - Its filler colliders leave the deck front free for the devices.
  - Its blister cards stay hung on the pegboard hooks (hung stock, like garments on a rail).
- **Faced-out LPs** (`skyMuFacedRecords`): the row of five sleeves becomes five `skyMerchFacedLp` sleeves (one cover each) on the cover
  wall's declared ledges. The row kind itself is static now (version 3 keeps its rows).
- **Magazine rack and flower stand: no change needed.** They already draw bare (`world/shelfStockCarcass.ts` displayTreatment /
  `AUTHORED_CARCASS`), and their magazines and flower buckets are separate physical filler stock on their real boards
  (`world/shelfStock.ts`).

| Kind | Openables audit | Physics audit | Scale (same geometry and size as before the split; viewed beside `lastshift`) |
|---|---|---|---|
| `skyMerchDemoPhone` / `skyMerchDemoTablet` | `none` (equipment) | **dynamic** 0.6 / 0.85 kg with their weighted stands, `pad`, `onHost` (the table top) | 0.08 × 0.16 × 0.07 / 0.20 × 0.15 × 0.06 m on the 0.76 m top (`scale-check.mjs --kind skyMerchDemoPhone --lift 0.76 --kind skyMerchDemoTablet --lift 0.76 --kind techDisplay`) |
| `skyMerchWallPhone` / `skyMerchWallTablet` | `none` (equipment) | **dynamic** 0.6 / 0.9 kg with their stands, `pad`, `onHost` (the declared deck) | 0.13-0.17 × 0.18 × 0.16 / 0.22 × 0.20-0.23 × 0.21-0.24 m on the 0.85 m deck (`--prop tech-display-t25.glb --fit 1.1,2.0,0.58`) |
| `skyMerchFacedLp` | `none` (decor) | **dynamic** 0.55 kg (a gatefold double LP), `pad`, `onHost` (the declared ledges) | 0.32 × 0.30 × 0.09 m, one sleeve of the row |

- Tests: `tests/skyways-merch-split.test.ts` covers:
  - both audits;
  - the exact model cut against the real GLB: nothing lost, nothing left in the cut, each device where the data says;
  - the table's device parts moved one-for-one;
  - version-4 seeds split (found, not hard-coded), with every piece on a known support and none overlapping;
  - version 3 unchanged;
  - determinism;
  - the drawn world with the real model;
  - a volley knocking a demo device and a wall device off.

  `tests/skyways-merch-physics.test.ts` samples the new pieces with every other shelf stock.

### Skyways local directory boards (task studio-skyways-rework-20261107-054512-01, lane MAPS)
One NEW kind, `skywaysMapBoard` (`gen/skyways/mapBoardKind.ts`): a round freestanding directory on a pedestal — a 0.95 m printed face
tilted 25° back in a steel ring rim on a shallow drum, one column on a round base plate. Procedural geometry in the existing shape
materials (no model, no generation); the face is a code-drawn plan of the generated network (`world/skywaysMapBoards.ts`, data from
`world/skywaysMapPlan.ts`: a per-layout runtime-composited data texture). Placed by `gen/skyways/mapBoards.ts` (layout version 3 only)
at the station concourse by the transit stair, in every building-storey's hub and at bridge landings, on flat public floor clear of
doors, run mouths, walking lanes / plazas, landmark discs, bridge lanes and shop / anchor fronts, with a 1.2 m reading strip in front.

| Kind | Openables audit | Physics audit | Scale check (`--prop` of its runtime geometry beside `lastshift`) |
|---|---|---|---|
| `skywaysMapBoard` | `none` (`equipment`): a sealed sign — the plan behind a screwed acrylic face in a welded drum, no door, lid or drawer | static `anchored` (~90 kg pedestal bolted through its base plate) | 1.00 × 1.35 × 0.53 m; grounded on the base plate (span 0.52 × 0.52 m); face centre 0.88 m, rim 0.42–1.35 m |

- No baked loose clutter (nothing loose is part of it); damage: steel, marks only (never breaks).
- E at a board's face opens a close-up of the same face (`world/skywaysMapRead.ts`); the face never prints fuel, gameplay hints or
  travel information.
- Tests: `tests/skyways-map-boards.test.ts` (both audits, the shape inside its box, placement and clearances on real seeds, the plan
  against the layout, YOU ARE HERE, storey highlighting, forbidden words, the renderer's bounded meshes / textures, the close-up read).

### Subway station map kiosks (task studio-ui-subway-maps-20261108-074144-01)
One NEW kind, `subwayMapKiosk` (`gen/subwayMapKioskKind.ts`). It is a wall-backed "STATION MAP" pylon in the mall directory's
proportions: a painted-steel cabinet on a plinth, with a printed panel behind a brushed-steel frame.
- **Build:** procedural geometry in the existing shape materials; there is no model and no generation. The panel is a code-drawn plan
  of the generated station (`world/subwayMapPlan.ts`, drawn by `world/subwayMapKiosks.ts`): one per-layout runtime-composited data
  texture (an atlas) for all the station's kiosks.
- **Placement:** `gen/subwayMapKiosks.ts` places them after generation. They are appended to `layout.props`, RNG-neutral and
  deterministic, so older prop indices never move.
  - Where: platform 1 by the arrival, then the ticket / fare halls, the concourses, the arcade and the food court, then the other
    platforms. At most 4, one per area, at least 8 m apart.
  - Back on a solid wall (never an opening, storefront or light well), with a 1.2 m reading strip in front.
  - Clear of door zones and door clear volumes, stairs, ladder / link stand areas, the track edge (2 m), pickups, enemy spawns, the
    arrival point, signs and every other prop.

| Kind | Openables audit | Physics audit | Scale check (`--prop` of its runtime geometry beside `lastshift`) |
|---|---|---|---|
| `subwayMapKiosk` | `none` (`equipment`): a sealed sign — the plan behind a screwed glazed panel in a welded steel cabinet, no door, lid or drawer | static `anchored` (~120 kg cabinet bolted to the floor and the wall behind it) | 0.94 × 2.10 × 0.32 m; grounded on its plinth (4 contacts, span 0.94 × 0.32 m); panel 0.80–1.94 m |

- Nothing loose is part of it (no baked clutter). Damage: sheet metal, marks only (never breaks).
- E at a kiosk's face opens a close-up of the same face (`world/subwayMapRead.ts`, the Skyways boards' read rules).
- The face prints only public, non-extension space on the kiosk's own storey, heads-up, with YOU ARE HERE. It never prints
  back-of-house, the service level, the track extensions, props, loot or enemies.
- Tests: `tests/subway-map-kiosks.test.ts`. It covers both audits, placement and clearances on 12 real seeds, the non-destructive
  append, the plan's secrecy, the face, the renderer's bounded meshes / one texture, and the close-up read.

### Skyways planted galleries and courts (task studio-skyways-rework-20261107-054512-01, lane ARCH)
`gen/skyways/gardens.ts` (layout version 3) lines every atrium opening's skyway-level gallery with planter troughs against the
balustrade, and puts a few bench-planters in the large skyway courts and the atrium courts. Two NEW code-drawn kinds
(`gen/skyways/destinations/kindsGardens.ts`, merged by `registry.ts`; drawn by `world/skywaysGardens.ts`): procedural bodies in the
existing shape materials and the office's EXISTING potted-plant model's foliage (its bowl pot cut away by a local mesh separation, the
foliage sunk into the soil bed). No new model or texture.

| Kind | Openables audit | Physics audit | Scale check (`--prop` of the drawn kind beside `lastshift`) |
|---|---|---|---|
| `skyArchGalleryPlanter` | `none` (an open soil bed) | static `built-in`: a precast trough full of soil (~450 kg) against the balustrade | trough 1.50 × 0.52 × 0.46 m (soil 0.47 m); 2.01 × 1.19 × 1.19 m with its shrubs; grounded, 4 contact corners |
| `skyArchBenchPlanter` | `none` (a raised soil bed) | static `built-in`: timber-clad raised bed with a slatted bench (tonnes of soil) | 2.60 × 0.46 × 1.30 m, seat 0.46 m (0.42 m deep); 2.70 × 1.03 × 1.42 m with its shrubs; grounded, 4 contact corners |

- Placement: troughs only on open public gallery floor at the opening's edge (the rail stands there), never on a stair / escalator cell
  or within its mouth, a level link's landing, a door's zone, a bridge lane, a storefront's opening strip or a landmark's clear disc,
  and only where 2.5 m of walkway stays open behind them; bench-planters through the station placement kit with a 1.0 m walking ring.
- No baked loose clutter: the shrubs are planting rooted in the soil (part of the fixture, nothing to take); no loose item sits in them.
- Tests: `tests/skyways-arch-rework.test.ts` (both audits, troughs at the rails / on the floor / clear of stairs, doors and run mouths,
  the walkway behind them, bench-planters on the floor, the foliage model requested only where a planter stands).

## 6. Player-train fixtures (not layout prop kinds)
Task train-lockbox-windows-20261101-232156. The player train's parts are built by `world/playerTrain.ts`, not from `PROP_DEFS`, so
they sit outside the two audits; their classification is recorded here.
- **Lockbox** (`world/trainLockbox.ts` world object, `run/trainLockbox.ts` store, `ui/lockboxView.ts` view):
  - Storage opens: [E] raises its hinged lid and opens a 50-slot (10 × 5) transfer view.
  - Contents: the player's own storage. It starts EMPTY each run and is never seeded or refilled, so there's no loot table.
    It is finite, persistent and carried by the run's player-train record: Travel keeps it, Retry restores the level-entry
    state, New game empties it. The developer code 1337 adds gear only on purpose (`items/devGrant.ts`).
  - Physics: static, `anchored`: bolted to the car floor, a solid box for player / enemy / hitscan, no physics body.
  - No baked clutter: the model is just the box, its lid, latches, hinge and handles.
  - Scale (rule 5): `scale-check.mjs --prop game/public/assets/models/player-train-lockbox.glb`, viewed. 1.03 × 0.556 × 0.614 m,
    grounded on 4 skid contacts, top at 0.55 m (a footlocker below the 0.98 m window sills).
- **Chipper** (task corpse-chipper-fuel-20261110-235304; model `assets/models/train-chipper.glb`, contract `world/chipperSpec.ts`,
  cooked by `tools/asset-pipeline/props/build-train-chipper.mjs`):
  - Not storage: the hopper is a feed mouth (a fed body is ground, never kept), the collection tanks are sealed parts of the machine
    and its fuel credit is the machine's own counter (`fuel/chipperFuel.ts`). Nothing to open, no loot table.
  - Physics: static, `anchored`: heavy machinery bolted to the car floor by its base frame, no physics body.
  - No baked clutter: the hose, tanks, gauge, valves, cable and the hopper's flap curtain are permanent parts of the machine.
  - Scale (rule 5): `scale-check.mjs --prop game/public/assets/models/train-chipper.glb`, viewed beside zombie lastshift (1.78 m,
    runtime scale 1). 1.36 × 0.832 × 0.616 m, grounded on 6 base-frame feet (span 1.15 × 0.46 m); hopper floor 0.47 m, side lips
    0.53 m, top frame 0.78 m (upper thigh on the zombie), motor top 0.83 m: below the 0.98 m window sills.
  - Runtime (lane CHIPPER: `world/chipper.ts`, placement `world/chipperPlace.ts`): a fixed part of every train, never cargo or
    loot. It stands in the +Z bay between the middle and front door pairs with its front to the aisle. It is a solid box for player,
    enemy and hitscan, both parked and riding (`trainColliders`, `buildRideLocalModel`). Shots and bumps don't move it. It has a few
    millimetres of visual vibration while it grinds, and the collider doesn't vibrate. The fed body is the corpse system's own model,
    not part of the chipper. The gauge, blood spray and floor stains are runtime effects.
  - The fed body (task woodchipper-ragdoll-20261111-033048, `world/chipperRagdoll.ts`) is its own corpse ragdoll in a small private
    physics world. That world holds only approximate boxes of the machine and the car floor. It never moves the machine, and the
    machine's collider is unchanged.
- **Crafting bench** (task train-crafting-v1-20261111-225628, `docs/train-crafting.md`; model `assets/models/train-bench.glb`, cooked
  by `tools/asset-pipeline/props/build-train-equipment.mjs`; placement `craft/trainFixtures.ts benchPlacement`, runtime
  `world/craftBench.ts`):
  - Not storage: a work surface over an open, empty lower shelf. It holds nothing, so there is nothing to open and no loot table.
  - Physics: static, `anchored`: bolted to the car floor in the rear compartment opposite the Lockbox. It is a solid box up to the
    worktop for player, enemy and hitscan, parked and riding (`trainColliders`, `buildRideLocalModel`). Shots and bumps don't move it.
  - No baked clutter: the vise, the bench grinder, the gauge box with its cable and the low back rail are bolted-down fixtures. The
    rest of the worktop is bare. Anything lying on it is an ordinary pickup, which keeps its own [E].
  - Scale (rule 5): `scale-check.mjs --prop game/public/assets/models/train-bench.glb`, viewed beside zombie lastshift (1.78 m,
    runtime scale 1). 1.02 × 1.12 × 0.68 m, grounded on 4 feet; worktop 0.84 m (at the zombie's hip), fixture tops 1.12 m.
- **Storage chest** (crafted at the bench; the Lockbox model at 0.8 scale, `world/trainEquipmentModel.ts CHEST_SCALE`; store view
  `world/equipmentChestStore.ts`):
  - Storage opens: a tap of [E] raises its hinged lid and opens the Lockbox's 50-slot transfer view over the chest's own slots.
  - Contents: the player's own storage. Crafted EMPTY, never seeded or refilled, so there's no loot table. Finite, persistent and
    saved with the unit: aboard the train or in the station it was left in.
  - Physics: movable. Hold [E] to carry it in both hands and put it down on free floor; walking into it shoves it slowly; a bullet
    stops on it and shoves it by its mass. One sleeping kinematic body on the fuel cart's controller, created with the unit.
  - Scale (rule 5): `scale-check.mjs --prop game/public/assets/models/player-train-lockbox.glb --scale 0.8`, viewed. 0.82 × 0.44 ×
    0.49 m, grounded on 4 skid contacts, lid top at 0.44 m (knee height: a box one person can carry).
- **Devices: route radar, defense sentry, item scanner** (crafted at the bench; models `assets/models/train-{radar,sentry,scanner}.glb`
  standing on the fuel dolly's hand truck, `world/trainEquipmentModel.ts`):
  - Not storage: sealed equipment cabinets. The sentry's hopper is a round counter worked from its console (tap [E] loads the 5.56
    rounds carried, hold [E] takes them back); it is not a container and has no door.
  - Physics: movable, exactly like the fuel dolly: grabbed and dragged by the frame, pushed by walking into it, up and down stairs,
    carried by lifts, stops bullets with a shove by its mass. Sleeping kinematic bodies on the same controller.
  - No baked clutter: dish, antenna, hood, handles and leads are permanent parts of each module.
  - Scale (rule 5): `scale-check.mjs` on each module composed with the hand truck, viewed. W × H × D with the truck: radar 0.56 ×
    1.20 × 0.59 m, sentry 0.50 × 1.20 × 0.64 m, scanner 0.51 × 1.20 × 0.58 m. The truck's handle is the 1.20 m. The modules reach
    1.00–1.10 m (chest height on the zombie) and their main top surfaces are at 0.81–0.92 m. Each stands grounded on the truck's two
    wheels, the module on the nose plate (0.07 m).
- **Roof turret** (the sentry's; model `assets/models/train-turret.glb`, runtime `world/sentryTurret.ts`, view
  `world/sentryTurretView.ts`): equipment, not storage. Anchored on the car's middle roof hatch; no physics body and no collider (it is
  out of reach on the roof). 0.42 × 0.52 × 0.96 m (W × H × L) at rest, grounded on its base ring. Base, yoke and head are three
  nodes of one model so it can turn and tilt.
- **Plug sockets** (three; `craft/trainFixtures.ts equipmentPlugs`): anchored wall fixtures on the lining (a 16 × 20 cm steel back
  box, a round socket, an indicator lamp). Not storage, no body. A connected device's cable is the fuel hose's tube.
- **Limits:** at most 24 crafted units in the car and 48 left in one station (`craft/equipment.ts EQUIPMENT_LIMITS`); a craft or a
  departure beyond them is refused. Enemies walk through units on the floor, as they do through fuel carts.
- **Tests:** `tests/train-equipment-*.test.ts`, `tests/equipment-chest-store.test.ts`, `tests/craft-bench.test.ts`,
  `tests/train-equipment-asset.test.ts`, `tests/sentry-turret-model.test.ts`, `tests/train-crafting-session.test.ts`.

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

### The Bunker's kinds (task studio-bunker-level-20261109-072224-01)
`gen/bunker/bunkerKinds.ts`. Two OBJECTIVE kinds (drawn by `world/bunker`, never by the builder) and five MODEL-BACKED flavour kinds,
drawn through the builder's generic instanced model path (`world/builder.ts` `MODEL_FOR` → the lazy library key; a non-uniform fit to the
PropDef box, which is each model's own real size, so the scale is 1). Nothing loose is part of any of them; none is storage.

| Kind | Model | Openables audit | Physics audit | Scale check (`--prop` beside `lastshift`) |
|---|---|---|---|---|
| `bunkerGenerator` | the Reactor's auxiliary generator (`REACTOR_KIT.generator`) | `none` (`equipment`) | static `anchored` (~3 t set on its skid) | 5.60 × 2.48 × 1.67 m, grounded; ≥ 2 m clear in front |
| `bunkerCoreCluster` | drawn by `world/bunker` | `none` (`equipment`) | static `built-in` (sealed cabinets + a built-in console) | 6.00 × 3.60 × 2.20 m footprint, grounded; ≥ 3 m clear in front, 6.4 m headroom |
| `bunkerMainframe` | NEW: `BUNKER_KIT.mainframe` (reel-to-reel tape cabinet, Meshy T2.5 from a Codex reference, maps kept) | `exception`: its louvred lower doors are the service panels of a live computer, not storage | static `anchored` (~400 kg, bolted, cabled) | 0.90 × 1.90 × 0.52 m; grounded (4 contacts, span 0.88 × 0.38 m); the reels face +Z |
| `bunkerDeconShower` | `REACTOR_X_KIT.deconShower` | `exception`: a plumbed walk-in booth, open front, nothing stored | static `fixture` | 1.76 × 2.40 × 1.50 m; grounded (19 contacts) |
| `bunkerControlConsole` | `REACTOR_KIT.controlConsole` | `exception`: the lower panels are its instrument bays | static `built-in` (~250 kg) | 3.00 × 1.54 × 1.49 m; grounded (20 contacts); work top 0.77 m |
| `bunkerCoolantPump` | `REACTOR_KIT.coolantPump` (the pump hall's water pumps) | `none` | static `machinery` (~1.5 t skid) | 3.50 × 1.82 × 1.36 m; grounded (4 contacts) |
| `bunkerPipeBank` | `REACTOR_KIT.pipeBank` | `none` | static `structure` | 3.87 × 4.00 × 1.49 m; grounded; placed only where the ceiling clears 4.3 m |

- Scale-check renders (2026-11-09) are in the task's private QA folder (`level/scale-check/bunker-mainframe.png`,
  `bunker-reused-plant.png`).
- Placement (`gen/bunker/dress.ts`):
  - the processing hall's rack rows alternate banks of four server racks with banks of four mainframes (flush fronts), keeping the
    core cluster's 3 m front and the aisle clear;
  - the core control room gets the control console, a desk with a CRT terminal on it (host decor), two wall data cabinets and two
    mainframes;
  - decontamination gets two shower booths;
  - the maintenance storey's water plant: in the pump hall the pipe bank, two pumps, p7 water pump skids and valve manifolds; in water
    treatment, treatment tanks (`waterHeaterTank`), an air filtration unit, a pump skid and a manifold.
- `REACTOR_X_KIT.storageCask` is not reused: a 4.6 m nuclear dry-storage cask has no plausible place in a shelter's water plant.
