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
| 0, `station` | 0 | The station (two side platforms on one double bed, `Kit.sideBlock`) under the station building, the underground pedway concourse with its food counters, washrooms and back of house; optionally a pedway under the street to a second building's own stair |
| 1, `street` | 5 | Street-level lobbies of every building, atrium courts, entrance halls (glazed facades with boarded street doors), shops and service rooms. Streets between buildings are OUTSIDE: solid in the grid, scenery only |
| 2, `skyway` | 10 | The "+15" level: concourses, atrium galleries round the openings (railed), shops, washrooms, the glazed bridges over the streets and the add-on hall |

Vertical links are real geometry: the station's open transit well (stopped escalators on either side of a fixed stair) inside the
station lobby rises from the concourse, and every building has an open public run in its lobby between storeys 1 and 2. There is no
elevator teleport and no hard cut.

## The frame

- **Grid:** a 3×2, 2×2 or 2×3 block grid (seeded). Blocks are 32–44 m, streets 15–19 m. On larger grids one block may be an empty lot.
- **Station building:** a large block in the bottom row.
- **Add-on host:** a corner block with exactly ONE bridge. That makes the add-on a localized branch of the network.
- **Bridges:** a random spanning tree over the other buildings plus one or two extra edges (loops). Bridges are 5.5–6.5 m wide.
- **Pre-breached routes:** about a third of the bridges start breached (at least one when there are three or more bridges, never
  all of them).
- **Atriums:** one or two hub buildings have a glazed atrium court.
- **Ramen restaurant:** placed in a building other than the add-on host.
- **Add-on choice:** `skywaysAddonOf(levelSeed)`, equal weights, on its own hash stream. A retry never changes it.

## The add-on (exactly one)

- **`convention`:** a hall of at least 20 × 13 m off the host's hub, with a support strip (green room, washrooms, event storage). It
  holds the stage, art panels, merch tables with loose merch, chairs and the mascot statues. The statues are static, posed from the
  supplied figure, and recorded in `addon.convention.statues`.
- **`prize-car`:** a display atrium of at least 14 × 14 m. Its entry is 7 m wide, so the car fits through. The car's spot is
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
