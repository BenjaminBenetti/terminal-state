# Skyways (`skyways`)

Task studio-skyways-level-20261106-054448-01. An ordinary network station type: a connected multi-building public pedestrian network
loosely inspired by Alberta's pedway / "+15" systems. Glazed bridges cross the streets between buildings, joining lobbies, atrium
courts, cafés and shops, building lobbies and service rooms. Each instance gets exactly ONE localized add-on.

## Where it lives

| Part | Files |
|---|---|
| Contract | `game/src/gen/skyways/skywaysTypes.ts` (`layout.skyways`) |
| City frame | `game/src/gen/skyways/frame.ts` (blocks, buildings, streets, the bridge graph, the add-on and its host) |
| Carve | `game/src/gen/skyways/carve.ts` (one Kit, three storey grids) |
| Pipeline | `game/src/gen/skyways/index.ts` (`generateSkywaysLevel`) |
| Validation | `game/src/gen/skyways/validate.ts` (`skywaysIssues`) |
| Add-on dressing | `game/src/gen/skyways/addon.ts` |
| Ramen restaurant | `game/src/gen/skyways/ramen.ts`, `kitchenKinds.ts`, `ramenPurposes.ts` |
| Glazing + gas | `game/src/world/skywaysWindows.ts`, `game/src/world/gas/system.ts` (window sources) |
| Prize car | `game/src/world/skywaysCar*.ts` |
| Registration | `levels/registry.ts`, `ai/spawnTables.ts`, `items/lootTables.ts`, `gen/maskLoot.ts`, `gen/trackExt/config.ts`, `campaign/*` |

## Storeys

| Storey | y (m) | Holds |
|---|---|---|
| 0, `station` | 0 | The station (two side platforms on one double bed, `Kit.sideBlock`) under the station building, the underground pedway concourse with its food counters, washrooms and back of house; 0–2 underground PEDWAYS (tunnels with kiosks) under the streets to other buildings, each ending in an open stair well up into that building's lobby |
| 1, `street` | 5 | Street-level lobbies, galleria spines and courts of every building, atrium courts, entrance halls (glazed facades with boarded street doors), arcades, service corridors, shops, sometimes the food court or the convention's double-height ballroom. Streets between buildings are OUTSIDE: solid in the grid, scenery only |
| 2, `skyway` | 10 | The "+15" level: concourses / galleria spines, atrium galleries round the openings (railed), lookouts, arcades, shops, washrooms, office suites, the glazed bridges over the streets (facade galleries where a bridge lands beside the lobby) and the add-on hall |

Vertical links are real geometry: the station's open transit well inside the station lobby rises from the concourse (on either long
edge of the lobby, its lanes stopped escalators and / or fixed stairs), every building has one or two open public runs in its lobby
between storeys 1 and 2 (a single stair up to a grand stair or escalators beside a stair), and every pedway ends in an open stair well
in its building's lobby. There is no elevator teleport and no hard cut.

## The frame (and the layout-variety pass)

The frame (`frame.ts`) varies the STRUCTURE from the level seed; the carve (`carve.ts`) builds each variation so it stays coherent.

- **Family** (the shape stream: never re-rolled by a retry): a compact block grid (2×2, 3×2, 2×3), a 3×3 CLUSTER with 3–4 empty
  lots (L, T, S, U networks; half the time a 2×2 core is kept so a loop can close) or a 4×2 CHAIN with 2–3 empty lots. Rows and columns
  are staggered, some buildings step back behind a plaza (longer bridges), streets range from narrow to boulevards. The frame keeps
  the carved extent inside the cell budget (`SKYWAYS_FRAME_CELLS`) so the Beyond-the-Station extensions always fit.
- **Station building:** a large block in the bottom row.
- **Add-on host:** any building whose removal never splits the rest (arm ends preferred), with exactly ONE bridge: the add-on is a
  localized branch of the network.
- **Bridges:** a random spanning tree plus, most of the time, every spare edge up to two (loops). Each bridge has a lateral
  preference (centred on the lobbies' shared span, or toward either end of the buildings' shared span); a bridge landing beside the
  lobby reaches it through a FACADE GALLERY along the glazing. Bridges are 5.5–6.5 m wide, now and then a 7.5–9 m gallery bridge.
- **Pre-breached routes:** about a third of the bridges start breached (at least one when there are three or more, never all).
- **Floor plans** (`SkywaysPlan`, per building, to suit its bridges):
  - `court`: a central lobby court (the atrium buildings: one or two hubs get a glazed atrium);
  - `galleria`: a long spine hall through the building (the station's: a wide concourse hall) with street doors at both ends (a
    through-passage), one or two runs along its long wall, lookouts at its unbridged ends;
  - `offset`: a court in the corner toward its bridges, entrance halls and lookouts aligned with its outer edges (an L / T);
  - `cross`: a small central court with arms out to (almost) every facade.
- **Circulation and rooms:** the carve places the bridges first and the runs round their landings. Dead-end shop ARCADES and
  SERVICE CORRIDORS (back rooms, or an OFFICE SUITE) open off the lobbies; one FOOD COURT (a lobby piece lined with food counters and
  seated with café sets; an atrium building's under the glass) on most levels.
- **Underground pedways:** 0–2 tunnels from the station concourse to the station row's neighbours or north under the street, each
  with its own stair well placed so the tunnel runs straight under the street where it can.
- **Ramen restaurant:** placed in a building other than the add-on host.
- **Add-on choice:** `skywaysAddonOf(levelSeed)`, equal weights, on its own hash stream; its storey (`skywaysAddonLevelOf`) on
  another. A retry never changes either.

## Destinations: anchor shops and landmark courts (layout version 2)

The destinations pass (task studio-skyways-destinations-20261106-170011-01) gives every Skyways several large, distinct ANCHOR shops
and named LANDMARK courts on top of the ordinary storefront bays. It also raises the shop count: more and longer shop arcades, more bays
per lobby and pedway.

**Anchors** (`carve.ts` `ANCHOR_FAMILIES`, records `layout.skyways.anchors`):
- **Selection:** 4–6 per map, taken from a seeded rotation of ten families (`skywaysDestinationsOf`, its own stream: a retry never
  re-rolls it).
- **Placement:** each is the roomiest site beyond a lobby side. One per building and storey; a galleria may take one on either side of
  its spine.
- **Front:** a wide glazed storefront with the shop's fascia. The storefront system draws the front only (`Storefront.anchor`); the
  family's own dresser furnishes the interior.
- **Back rooms:** a stock room and an office behind staff doors.

| Family | Shop | Formats |
|---|---|---|
| books | Paper Prairie Books | two-level (sales floor + mezzanine, an internal open stair) or hall |
| outfitter | Coulee & Canoe Outfitters | double-height (a canoe hung overhead) or hall |
| music | Northern Groove Records | multi-zone (listening booths) or hall |
| hobby | Grain Elevator Models | hall round the railway diorama |
| design | Larch & Loom Home | two-level or hall of room sets |
| garden | Glasshouse Garden Co. | double-height glasshouse or hall |
| arcade | Starfall Arcade | hall |
| cinema | Aurora Picture House | multi-zone (lobby + auditorium) |
| science | Big Sky Wonders | double-height or hall |
| hockey | Blue Line Sports | hall |

Anchor floors are about 130–400 m², against about 20 m² for an ordinary bay. A double-height anchor rises through the skyway storey;
nothing is carved above it.

**Landmark courts** (`LANDMARK_FAMILIES`, records `layout.skyways.landmarks`):
- **Selection:** every atrium court (one to three per map) takes the next family of the rotation, then one or two large plain courts take
  the families that fit their clear height. One family per map.
- **The six families:**
  - Clock Court: a cast-iron clock tower;
  - Badlands Court: a hadrosaur skeleton cast;
  - Fig Tree Court: an indoor fig in a ring-bench planter;
  - Fountain Court: a dry three-tier fountain;
  - Flight Court: bronze geese hung in the atrium;
  - Orrery Court: a brass armillary sphere.
- **Naming:** the court area takes the court's name.

**Dressing:** `gen/skyways/destinations/`:
- the kit kinds (`registry.ts`, merging the kinds files into the shared prop / damage / physics / openables tables);
- the family dressers (`shopsA.ts`, `shopsB.ts`) and `landmarks.ts`;
- the shared art kinds (`art.ts`: shop posters, court plaques).

The station dresser leaves the anchor interiors (sales floor and its stair-well pieces, the upper storey, the zones) and the landmark
discs alone (`index.ts` `holds`). Only the forced storefront glazing goes in. The stock rooms keep their back-of-house dressing.

Every kit model is a Codex concept turned into a Meshy T2.5 model with its PBR maps kept (`assets/skywaysDestProps.generated.ts`).

## Layout versions (save compatibility)

`gen/skyways/layoutVersion.ts`:
- A station records the generator version it was first built with (lane `skyways.layout`).
- A station a player entered under GAME76 (memory with visits, no record) keeps regenerating that exact layout (version 1, pinned by
  fingerprints in `tests/skyways-dest-layout-version.test.ts`), so its saved holders, pickups, kills and car stay consistent.
- Every station not yet entered in GAME77 got version 2, the destinations.
- Version 3, the rework (task studio-skyways-rework-20261107-054512-01), was what GAME78–80 gave every new station.
- Version 4, the building programmes (task studio-skywalk-variety-20261107-231448-01), came next.
- Version 5, the encounters pass (task studio-skywalk-encounters-20261108-074144-01: the Siren, the horde, the convention's cosplay
  zombies, the Mall store families), followed (fingerprints pinned as GAME87).
- **Version 6, the convention's cosplay crowd on both floors of its building** (task studio-cosplay-general-20261108-225231-01,
  `gen/skyways/cosplayFloors.ts`; see `docs/enemy-spawns.md`), is what every station not yet entered gets now, in new and existing
  campaigns. Versions 4–6 share the live generator, with every change gated on the version.
- Versions 1 and 2 regenerate through a FROZEN snapshot of the GAME77 generator (`gen/skyways/legacy77/`), version 3 through a frozen
  snapshot of its core (`gen/skyways/legacy80/`: index / carve / frame / validate). The test pins all three versions' fingerprints, so a
  station a player already entered keeps its holders, pickups, kills and add-on.
- Never edit the snapshots. Never rename or resize a prop kind they place; add a new kind instead.
- The shared dressers learn the version they dress from `skywaysGenVersion(layout)` (a side channel: no layout data); every
  version-4 generation change is gated on it.
- Fixes that change no layout data reach every version: the stairs (the open wells' ceilings and walls), the store, shop and court
  finishes, the clock, the signs and wording, the silent arcade, shelf-stock physics, the exterior relief, culling.

## The rework (layout version 3)

- **Open architecture:**
  - glazed ATRIA on most buildings (at least two per map): court atria, or a long GALLERIA atrium (a wider spine with walkways along
    both sides of its opening);
  - every bridge has a glazed roof record (`bridges[].roof`: faceted, vaulted, gable or ribbed flat), with the deck's ceiling at its
    apex and the side glazing up to the springing line.
- **The add-on always takes its host's bridge level:**
  - `convention` is a VENUE: the host's whole skyway floor (`addon.venue` by role):
    - registration (the corridors in from the bridges);
    - the exhibitors' floor (the host's skyway court);
    - the main stage hall with backstage, storage and washrooms;
    - two panel rooms and a photo lounge;
    - the street level below stays the building's ordinary lobby. From layout version 6, some of the cosplay crowd stands there too
      (`gen/skyways/cosplayFloors.ts`).
  - `prize-car` is a public PRIZE DISPLAY in the host's skyway court (`addon.display`; no add-on rooms), with the stanchion ring, the
    turntable and the prize board (`gen/skyways/addonPrizeDisplay.ts`).
- **Tenant OFFICE WING (about one map in five):** an open-plan office off a lobby, with a meeting room, private offices and a break
  room, furnished with the office floor's own kit (`gen/skyways/officeWing.ts`) and finishes.
- **The ten major stores** (`gen/skyways/stores/`, from version 3; one doc per store under `docs/skyways-stores/`):
  - each family has its own dresser, fixtures, openable storage, back room and loot purposes (existing Mall / Office / station tables);
  - the storefront and sign face the hall;
  - no floor piles inside a store (`Area.noFloorLoot`).
- **Anchor stores' own finishes:** `gen/skyways/destinations/anchorStyles.ts` (world/skywaysArch.ts class 'anchor'). The class covers the
  store's floors, upper storey and zones, plus a two-level store's own internal stair (its well and flight flank walls).
- **The public architecture look** (`world/skywaysArch.ts`, `skywaysBridgeRoofs.ts`, `skywaysSkylights.ts`, `skywaysGardens.ts`):
  - glazed bridge roofs with steel ribs, clay-paver decks and daylight under the glass;
  - SKYLIGHT coffers in the large skyway courts (`gen/skyways/skylights.ts`);
  - planter troughs along the atrium gallery rails and timber bench-planters in the courts (`gen/skyways/gardens.ts`);
  - herringbone brick floors, brick walls and timber-slat ceilings in the atrium / skylit courts (Codex textures).
- **Local directory boards** (`gen/skyways/mapBoards.ts`, `world/skywaysMapBoards.ts`, `skywaysMapPlan.ts`):
  - round freestanding boards in every lobby and skyway court and at the bridge landings;
  - each face is a code-drawn plan of THIS network (buildings, bridges, pedways, stairs, destinations) with YOU ARE HERE and the
    floor;
  - the interact key reads it full screen.
- **The convention venue's dressing** (`gen/skyways/venueDress.ts`):
  - registration desks with a queue, artist-alley vendor rows with stock, panel rooms, a photo lounge and wayfinding signs;
  - the STAGE is walkable: `gen/skyways/stageSupport.ts` raises the floor under its drawn deck and treads at load time, for every layout
    version.
- **Stairs:**
  - (layout version 3) a fixed stair lane is 3 m wide, and a building's main public run keeps about 6 m of straight open floor beyond
    both ends where its lobby allows (held clear of props, no shopfront alongside);
  - every Skyways flight is an OPEN well: its band, rays and drawn ceiling rise to the well's ceiling (`Ramp.capCeil`), never a 2.5 m
    soffit with a fascia hanging over the stair foot;
  - escalator lanes are drawn as stopped escalators, whose glass balustrades carry the seam rails;
  - two fixed stair lanes side by side form one wide stair, with no seam rail.
  - Evidence: `tests/skyways-stairs.test.ts`, using a real player.
- **The clock court's tick:** half its old level, heard within 8 m. The chime strikes only within that range.

## The building programmes (layout version 4)

Each building has a PROGRAMME (`skywaysTypes.ts SkywaysProgramme`, drawn by `frame.ts` on its own stream, bridge neighbours' kinds
avoided where it can; a map of four or more buildings mixes at least three):
- **`gallery`: a bridge house** — the skywalk level only (no street floor, no stair): one long, wide promenade between its bridges,
  lookouts over the streets on every free facade, shops and arcades along it; a low shell (11–16 m).
- **`hall`: a market hall** — fills its block; open from its street floor to the glass roof inside a narrow gallery ring, one narrow
  run inside the hall, food counters round its floor (the food court's first choice), no anchor store; the shell stops just over its
  glass. Broad blocks only.
- **`tower`: an office tower lobby** — a tall lobby with a free-standing GRAND STAIR in its middle (floor on all four sides, a full
  run-out beyond both ends), a café or two, no shop arcade at street level, the tenant's office floor at the skywalk level; a tall shell.
- **`classic`**: the earlier lobby + skywalk court blocks (shops, anchors, most with an atrium); the add-on host is always classic.
Also in version 4: the ramen restaurant is an ordinary storefront tenant with its own sign (about three maps in five, any building /
storey, never the station concourse; `Storefront.ownDress` keeps the generic fit-out out of its dining room); the convention tables
carry a few real drinks / snacks (`skywaysConSnacks.ts`); player text says "Skywalk" (`skywalkText.ts`, every version).
Tests: `tests/skyways-programmes.test.ts`.

## Mall store families (layout version 5)

A few ordinary glazed retail units are let to MALL store families (`gen/skyways/skywaysMallStores.ts`, pool `skywaysMallPool.ts`):
women's fashion, shoes, jewellery, beauty, optician, luggage and pets. None of them duplicates a base shop use or one of the
ten major stores.
- **Which units:** units from the base shop pools above the station storey, never an anchor, a food unit or the ramen restaurant. The
  unit must fit the programme's Mall minimum size and the Mall lot family it reads as (`gen/mall/lots.ts lotSuits`). A map asks for
  2-4 stores, each family at most once, at least 14 m apart on a storey. The draws use their own forks; the carve is unchanged.
- **What they are:** the Mall store itself, not a sign over a generic box:
  - the programme's fictional brand on a fascia drawn in the Mall brand style (`world/skywaysMallFascia.ts`, inside the one
    lettering atlas);
  - its Mall walls and floor (`world/skywaysMallFinish.ts`: finish rows of the small shops' programs, so no draw call is added);
  - its Mall focal display and recipe (`gen/mall/shopsDress.ts dressMallRecipe`), using existing Mall kinds that are in both audits;
  - fixture-drawn merchandise is split by the version-4 rule (`skywaysMerchSplit.ts`).
- **Loot:** the holders roll their `mall-<programme>` purpose under the Skyways profile (base tables and base salvage, never the
  Mall's profile). There are no floor piles (`noFloorLoot`).
- **Saves:** stations entered at versions 1-4 never get one. `Storefront.mall` is set only at version 5.
Tests: `tests/skyways-mall-stores.test.ts`, `tests/skyways-mall-stores-view.test.ts`.

## The add-on (exactly one)

The hall's side of the host lobby varies (only halls at least 70 % of the roomiest that fits), and it is entered straight from the
lobby or through a FOYER (`addon.approach`; the foyer is an add-on area of concourse kind).

- **`convention`:** a hall of at least 20 × 13 m off the host's lobby, with a support strip (green room, washrooms, event storage). It
  is the "+15" convention hall (storey 2) or a street-level BALLROOM (storey 1, double height up through the skyway storey: nothing is
  carved above it). It holds the stage, art panels, merch tables with loose merch, chairs and the mascot statues. The statues are
  static, posed from the supplied figure, and recorded in `addon.convention.statues`.
- **`prize-car`:** a display atrium of at least 14 × 14 m, always on the skyway level. Its entry is 7 m wide, so the car fits through. The car's spot is
  `addon.car`, and the turntable, stanchions and prize board are placed around it. The car is drivable in first person (see
  `game/src/world/skywaysCar.ts`). By design, its drivability is never advertised outside the close-up Enter / Exit prompt and the
  controls hint shown while driving.

## Gas

Every `SkywaysWindow` is a glazed span in a solid wall run (the Office window rule):
- Bridge sides, entrance-hall facades, lookout lounges and the add-on hall's facade are glazed.
- Shooting a pane admits real gas through the Office breach / `GasField` path.
- Breached spans start broken, seeded as aged breaches on the first build of the station.
- The fog renders from the same field that drives exposure.

The persistence lane is `skyways.windows`.

## Campaign

`ORDINARY_WEIGHTS` is 70 / 10 / 10 / 10. Of the 39 ordinary nodes that gives 27 Subway, 4 Office, 4 Mall and 4 Skyways.

Saved networks are never regenerated:
- `validateNetwork` also accepts the pre-Skyways census (`PRE_SKYWAYS_WEIGHTS`), so an old save loads unchanged.
- Only campaigns started on this build contain Skyways nodes.

Developer access without a campaign: `?qa=1&level=skyways&skywaysSeed=<code>`.

## Loot

- **Profile:** `BASE_TABLES` with no overrides; the mask roll is the Office's.
- **No loose floor supply program:** ordinary small loot sits on shelves, counters and in containers. The floor is reserved for key
  finds such as weapon finds.
- **Restaurant food:** the restaurant's edible food is finite seeded loot (2–4 plates on its tables / counter plus its holders'
  `RAMEN_*` tables).
