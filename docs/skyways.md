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
