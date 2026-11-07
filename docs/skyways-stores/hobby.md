# Skyways major store: Grain Elevator Models (hobby) — prop-affordance record

Task `studio-alpha-skyways-shops-20261107-054512-01`, lane STORE-HOBBY. Layout version 3 only (versions 1 / 2 keep their dressers).
Code: `game/src/gen/skyways/stores/hobby.ts` (spec: purposes, finish), `hobbyDress.ts` (the dresser), `kinds/hobby.ts` (no new
kinds; the Mall model files it uses). Test: `game/tests/skyways-store-hobby.test.ts`. Checklist: `docs/prop-affordances.md`.

## New kinds

None. Every fixture is an existing, already classified kind (openables audit + physics audit), so no new scale-check row is owed.
The reused pieces were still viewed beside the runtime zombie (`node tools/asset-pipeline/props/scale-check.mjs`, renders kept in
the private task folder) and read true to scale:

| Piece (kind) | W × H × D (m) | Contact | Openables class | Physics |
|---|---|---|---|---|
| Railway layout table (`skyDDiorama`, kit model) | 3.00 × 1.51 × 3.01 (table top 1.02) | grounded, 16 feet clusters | none (fixed exhibit) | static, too heavy |
| Back counter (`mallCashwrapCounter`, Mall M01) | 2.00 × 2.04 × 0.78 (worktop 0.95) | grounded | **openable**: 5 drawers + cupboard | static holder |
| Till counter (`shopCounter`) | 1.50 × 1.05 × 0.75 | grounded | open (counter top) | static holder |
| Glass display counter (`glassCounter`, Mall M15) | 1.50 × 1.36 × 0.71 | grounded | open (staff side open) | static holder |
| Glass display cabinet (`glassDisplayCabinet`, Mall M02) | 0.92 × 1.90 × 0.70 | grounded | **openable**: 2 glass doors | static holder |
| Gondola (`retailGondola`, Mall M03) | 1.95 × 1.40 × 0.49 (top deck 1.18) | grounded | open shelving | static holder |
| Kit wall shelving (`shelf`) | 1.20 × 1.85 × 0.45 (tiers 0.08 / 0.62 / 1.19 / 1.76) | grounded | open shelving | static holder |
| Paint rack (`stockShelf`, 'parts' stock: paint tins, tubes, reels) | 1.20 × 1.85 × 0.45 | grounded | open shelving | static holder |
| Demo desk (`desk`) | 1.50 × 0.76 × 0.75 | grounded | **openable**: 3 drawers | static holder |
| Rolling tool chest (`rollingToolChest`) | 0.70 × 1.15 × 0.45 | grounded, castors | **openable**: 8 drawers | static holder |
| Boxed kit stack (`skyDModelKits`, kit model) | 0.45 × 0.47 × 0.24 | on a shelf tier / the gondola top | exception (sealed kits, merchandise) | dynamic 2 kg, on-host |
| Tin-toy robot (`skyDToyRobot`) | 0.52 × 1.00 × 0.45 | grounded | none | dynamic 12 kg |

Scale reads: the counters at 0.95–1.05 m, the desk at 0.76 m, the layout table's scenery at ~1.0 m (a viewing height), the kit
stacks fit under every shelf tier (0.47 m stack, 0.51–0.55 m clear) and on the gondola's open top deck.

## Openables (storage opens)

All storage it places opens through the existing openables: the back counter, glass display cabinets, the demo desk, the tool chest,
sideboards (`cabinetLow`, two doors), and in the back rooms openable cartons (`cardboardBoxFlaps`), a storage tote, staff lockers or
a tall cabinet, the stock room's crates (station dresser) and the office's desk / safe / cabinets. Nothing storage-looking is a
sealed exception (the boxed kits are sealed merchandise, `role: decor`). Typical per store (seeds 3–15): 7–9 openable / existing
storage holders on the sales floor, 2–7 in the back rooms.

## Loot (existing purposes; per-holder keys, the ramen precedent)

| Where | Loot key | Rows (before the scarcity economy) |
|---|---|---|
| Sales floor (kit walls, kit aisles, till, sideboards) | `mall-toys` | chocolate, chips, juice, battery, water; till: water, chocolate, cola, dressing, chips |
| Workbench desk / tool chest / paint rack | `mall-hardware` | battery, flare, water, dressing |
| Glass display cabinets / glass counter | `mall-electronics` | battery (first), flare, water |
| Stock room, office, staff corner | `mall-toys-back` | battery, chocolate, water + the stock-room common rows (beans, noodles, dressing); staff lockers their personal rows |

No ammunition on any shop-floor fixture; only the existing staff rows (lockers' personal rows, office desk drawers / safe) carry
their usual small chance. No new tables, no floor piles (`noFloorLoot`), no fuel ids.

## Movable things

Existing physics rows: the kit stacks (2 kg, on-host), the robot (12 kg), the airship model (2.5 kg, on-host), the swivel chair
(12 kg, castors) and the back rooms' openable cartons / tote (spill holders) are dynamic; the holders (counters, cases, shelving,
gondolas, desk, tool chest, lockers), the layout table, capsule machines (~60 kg), the architectural model and the desk-top
appliances (host decor) are static with their reasons.

## Not baked

The layout table, shelving, gondolas and counters are empty fixtures; the boxed kits, register, soldering station, toolbox and
exhibits are separate props on the hosts' measured supports (the hosts' loot surfaces give up their spans).
