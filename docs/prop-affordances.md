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
| Does it move when shot or bumped? | `PROP_PHYSICS_AUDIT` in `game/src/damage/physicsAudit.ts` (office kinds: `OFFICE_PHYS` in `game/src/gen/office/physics.ts`; Subway kinds: `PROP_PHYSICS` / `PROP_DEFS.physics`, `game/src/damage/materials.ts`) — see section 3 | `dynamic` (mass / collider / contact material) or `static` with a reason (`StaticWhy`: `holder`, `anchored`, `built-in`, `too heavy`, `fixture`, `partition`, `mounted`, `host decor`, `structure`, `machinery`, `kept`) |

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
| `labBench` | 15 shallow derived drawers | `LAB_DRAWER_ROWS`: dressings, cells, water |
| `examTable` | 3 derived drawers | `CLINIC_DRAWER_ROWS`: dressings (+ limb treatments), water |
| `biohazardFridge` | derived door frame; cleared bottom compartment | `COLD_MED_ROWS`: dressings, first-aid kits, water |
| `vaultSafe` | derived door; lined cavity with a shelf | `VAULT_ROWS`: generic ammo (the deliberate rule), dressings, a kit, a flare |
| `serverCabinet` | 2 derived cupboard doors (2 shelves each) + 2 glass doors (racked servers) | `SERVER_SPARES_ROWS`: cells, flares, a dressing, water, electrical parts, scrap metal |
| `serverRack` | 42U rack, a local procedural rebuild (`office-server-rack-r2.glb`): derived perforated see-through door over racked equipment with blinking LEDs; 3 empty bays with modelled shelves (`modelInterior`) | `SERVER_RACK_ROWS`: electrical parts (the common find), scrap metal, rarely a cell / flare (lane RACK, office-props-physics-scale-20261030) |
| `archiveBoxes` | the top box's derived lid (spills if knocked loose) | `ARCHIVE_ROWS`: rarely a snack / cell / dressing / flare |

Explicit exceptions with reasons (kegerator, bakery case, globe bar, parcel pallet, gumball jar, machines) are in
`OFFICE_OPEN_AUDIT`.

## 3. Movable things move
- Use the existing bounded, lazy, sleeping physics for loose props (bodies created on demand, asleep until hit or bumped):
  `game/src/physics/dynamicItems.ts` (`MAX_DYNAMIC_PROPS` simulating at once; at rest a loose prop is a static body; the
  first hit detaches its render instances — Meshy model or box stand-in, same materials — via `damage/propDamage.ts`).
- Classify the kind:
  - office / company / supporting kinds: a row in `OFFICE_PHYS` (`game/src/gen/office/physics.ts`) — `D(mass, mat, how,
    {shape, onHost, fit})` or `S(why, how)`; `damage/materials.ts` spreads the dynamic rows into `PROP_PHYSICS`;
  - other kinds: `PROP_PHYSICS` / `PROP_DEFS.physics`; a static one needs its reason in `damage/physicsAudit.ts`;
  - `PROP_PHYSICS_AUDIT` (`game/src/damage/physicsAudit.ts`) joins both; `tests/office-physics.test.ts` fails for an
    unclassified kind, an empty reason or a row that disagrees with the live physics (`dynamicKind`).
- Plausible mass / friction / impulse:
  - a chair slides and tips;
  - a bean bag barely moves under a pistol round;
  - a filing cabinet doesn't fly.
  - Contact materials: cannon-es clamps friction impulses by μ·m·g per step, so the iteration-07 materials make a shoved box
    stick (it only rocks / tips). Movable office furniture uses the calibrated `castor` (wheels) and `pad` (feet / fabric /
    pot bases) materials in `PHYS_MATS`.
  - Rule of thumb: furniture without castors over ~30 kg stays static (`too heavy`); the walker shove matches the walker's
    speed, so a dynamic sofa could be bulldozed like a chair.
- Contact: in office worlds walking into a light office prop wakes it (`contact`); walkers then shove it. Holders wake by
  shots only. AI walkers wake props only near the player. Contact wakes stop while fewer than `CONTACT_RESERVE` damage
  detach slots remain.
- On-host decor (`onHost`, e.g. the monitor on a desk) goes loose on its static host's top (a host-top support slab is
  added); a prop that something rests on never goes loose; collider `fit` shrinks a chair's box (it is tucked under its desk).
- Loot rides with its holder or is dropped as real pickups. It never floats, duplicates or vanishes; hover highlights follow
  the item.
  - A moving holder must be a spill holder (`spill` in `world/openablesSpec.ts`: `containers.goLoose` drops its finite lots as
    the same pickups, the doors / lid ride the body).
  - A moving office prop lifts the lots it hits off their holder as pickups (never duplicated).
- Never wake the whole level; never add unbounded bodies. Resting loose props inside the moving elevator cab ride it.
- Static by design: built-in or very heavy furniture, wall-mounted fixtures, machinery — with the reason recorded.

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
