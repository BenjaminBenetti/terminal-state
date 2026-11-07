# Skyways store: Blue Line Sports (hockey) — prop-affordance record

Task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-HOCKEY. Layout version 3 only (versions 1 / 2 keep their old dressing).
Code: `game/src/gen/skyways/stores/hockey.ts` (spec: purposes, finish), `hockeyDress.ts` (the dresser), `hockeyParts.ts` (drawn
geometry), `stores/kinds/hockey.ts` (the kinds' classification). Test: `game/tests/skyways-store-hockey.test.ts`.

## The store

A hockey pro shop, laid out over the store's whole footprint (its floor pieces: an L-shaped floor round an inset stock room counts).
Wall fixtures go only on wall-backed spans the dresser finds (solid wall behind, no door, no glazing, no open floor of the next piece).
Lanes from the storefront to every door and floor piece are reserved first.

- **Cash desk** by the entry (a side wall's front span first): till counter with its register (+ a glass display counter), the openable
  cashwrap back counter and the drinks cooler behind a staff aisle; on a short front span the till with a tall storage cupboard.
- **Skate-sharpening counter**: service counter; behind it the sharpener (`benchGrinderStand`), the openable rolling tool chest (tool
  drawers), a tool pegboard over them, a first-aid kit on the wall beside the run.
- **Shooting lane**: dasher boards with shielding glass along its open side and the goal at its closed end, mouth kept clear — in a back
  corner (along the side or the back wall), else straight out from a wall (two boards a side), else a 2 m mini lane (one a side).
- **Boot wall**: slatwall bays (`wallBay`) with skates on their shelves; **gear wall**: bays with helmets on the top deck and gloves /
  shin guards on the base deck (the middle shelves stay loot shelves). A try-on ottoman in front of the skates.
- **Team lockers** (openable `staffLockers`, 2-3) with the locker-room bench (`mallBench`) in front, past their doors' swing strip.
- **Jersey wall**: one or two clothing bays (`clothingWallUnit`) with team jerseys hung face-out on their rails (six invented colourways).
- **Floor**: stick racks with their sticks, display tables with helmets / gloves / shin guards, the goalie mannequin facing the entry,
  a goal on display in the bigger stores, the store's hockey posters.
- **Back rooms**: the station's back-of-house dressing (shelving, cartons, crates) + openable carton boxes, a storage tote and a staff
  locker. A store without a stock room gets a staff stock corner (shelving + an openable cupboard + a carton box, loot key
  `mall-sports-back`) beside the cash desk.

## New kinds (all code-drawn box geometry: no model file, no texture, no generation)

| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact; surfaces) |
|---|---|---|---|---|
| `hkStickRack` | floor stick rack: base trough, end posts, slotted top rail (blue cap) | `none` (surface) | static `fixture` (~25 kg; host of its sticks) | 1.61 × 1.18 × 0.50 m; grounded, 10 contacts (feet + trough); trough floor 0.05 m, rail 1.15 m |
| `hkSticks` | 12 senior sticks standing blade-down in the rack's trough, shafts through the rail | `none` | static `host decor` (captive in the rail; rides the static rack) | 1.35 × 1.49 × 0.29 m; drawn at the rack's trough (0.05 m: grounded on it, 36 contacts) |
| `hkJersey` | team jersey on its hanger, hung face-out (sleeves hanging), stripes / yoke / cuffs in one of six colourways | `none` | static `host decor` (hooked on the clothing bay's rail at 1.915 m) | 0.84 × 0.76 × 0.035 m; hook top 1.915 m, hem 1.155 m (hung, not floor-standing) |
| `hkSkates` | a pair of skates: runners, holders, boots, tongues, accent heel caps | `none` | **dynamic** 1.8 kg box, `pad`, `onHost` | 0.27 × 0.22 × 0.20 m; grounded (2 runner contacts); top 0.20 m |
| `hkHelmet` | caged helmet: open shell, liner, ear guards, full-face cage, chin cup | `none` | **dynamic** 0.7 kg box, `pad`, `onHost` | 0.23 × 0.18 × 0.28 m; grounded (3 contacts: shell rim + chin cup); crown 0.18 m |
| `hkGloves` | a pair of padded gloves, palms down, cuffs forward | `none` | **dynamic** 0.9 kg box, `pad`, `onHost` | 0.36 × 0.11 × 0.32 m; grounded (12 contacts) |
| `hkShinPads` | a pair of shin guards lying flat | `none` | **dynamic** 1.0 kg box, `pad`, `onHost` | 0.42 × 0.10 × 0.28 m; grounded (9 contacts) |
| `hkRinkBoard` | dasher-board section: yellow kick plate, white boards, blue cap, shielding glass between stanchions | `none` (equipment) | static `anchored` (~70 kg, bolted to the floor and its neighbours) | 2.00 × 1.88 × 0.14 m; grounded (4 contacts); board top 1.10 m (dasher height ~1.07 + cap), glass to 1.86 m |

Scale checks: `node tools/asset-pipeline/props/scale-check.mjs --kind hkStickRack --kind hkSticks --lift 0.05 --kind hkRinkBoard
--kind hkJersey --lift 1.115` and `--kind hkSkates --kind hkHelmet --kind hkGloves --kind hkShinPads` (variant 0; `--variant n` for the
others), viewed beside zombie `lastshift` at runtime scale 1.0: a senior stick reaches the zombie's chest, the boards his waist, the
skates his ankle, a helmet his head's size.

- Rule 1 (storage opens): none of the new kinds is storage. The store's storage is EXISTING openables with their finite seeded contents:
  `staffLockers` (team lockers + the back room's), `mallCashwrapCounter` / `cabinetTall` (cash desk), `rollingToolChest` (sharpening),
  `firstAidWallKit`, `shopCooler`, `cardboardBoxFlaps`, `storageTote`.
- Rule 2 (movable things move): the loose gear on shelves / tables is dynamic on-host decor (goes loose off its static host when shot,
  out of a walker's legs' reach, like an office monitor); the hosts (wall bays, display tables, the rack, the clothing bays) are static.
  The sticks and jerseys are captive host decor of static hosts (never floating). Existing kinds keep their classes (the goalie and the
  goal dynamic, the ottoman dynamic, the bench anchored).
- Rule 4 (no baked clutter): the rack is empty (its sticks are their own kind), the clothing bays carry separate jerseys, the shelves /
  tables separate gear props; nothing loose is part of a fixture.
- Rule 5: sizes above; every drawn kind's parts stay inside its PROP_DEFS box and are grounded at its base (test: "the drawn kinds").

## Loot (existing tables only)

| Area / holder | Loot key | Rows it rolls |
|---|---|---|
| sales floor holders (wall bays, clothing bays, display tables, glass counter, cupboard) | `mall-sports` | water, dressings, energy bars (chocolate), juice |
| till (`shopCounter`) | `mall-sports` | what people leave behind: water, chocolate, cola, dressings, chips |
| drinks cooler | `mall-sports` | water, cola, juice |
| team lockers (`staffLockers`, own personal table narrowed by the floor's stock) | `mall-sports` | water, chocolate, dressings, juice (no ammo) |
| cashwrap back counter (own table narrowed) | `mall-sports` | chocolate, water, dressings |
| first-aid kit (own table narrowed) | `mall-sports` | dressings, water |
| sharpening tool chest (per-holder override) | `mall-hardware` | torch cells, flares, water, dressings |
| stock room / office (area purposes) | `mall-sports-back` | water, dressings, juice (+ the Mall stock room's common rows in crates / cupboards; its staff lockers the Mall's personal table) |

No floor piles (`noFloorLoot`), no new tables, no fuel rows.

## Finish

Ice-white walls over Blue Line blue dasher-board panelling to 1.07 m (2 m sections, a red cap rail and skirting), a black rubber floor
(vinyl tiles tinted 0x2c3034: a skate shop's floor), a white grid ceiling. Fed through `ANCHOR_STYLES` (gen/skyways/destinations/anchorStyles.ts).

## Shared hook (additive)

`DestKindSpec.parts(variant)` (gen/skyways/destinations/kindTypes.ts): a model-less store kind's drawn box parts (shape materials or the
purpose paints), drawn by `world/skywaysDestinations.ts` (merged per material, one batch per variant, rotate-Y support) and rendered
by `tools/asset-pipeline/props/scale-check.mjs --kind` (`--variant n`).
