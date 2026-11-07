# Skyways major store: Big Sky Wonders (science)

Lane STORE-SCIENCE of task `studio-alpha-skyways-shops-20261107-054512-01`. This is the store's prop-affordance record (root
`CLAUDE.md` "Props — core design rules"; checklist in `docs/prop-affordances.md`).

Sources:

- spec `game/src/gen/skyways/stores/science.ts`;
- dresser `game/src/gen/skyways/stores/scienceDress.ts`;
- kinds `game/src/gen/skyways/stores/kinds/science.ts`;
- wall-art renderer `game/src/world/skywaysStoreScienceArt.ts`;
- test `game/tests/skyways-store-science.test.ts`.

The store exists at Skyways layout version 3 and later. Its formats are double height (7.5 m clear) and a hall (3.9-4.3 m).

## The store

The dresser uses one frame over the whole footprint, so the sales-floor pieces around an inset stock room are dressed as one floor.
It places, in order:

1. **Entry spine** straight in to the centrepiece. The fibreglass rocket (`skyDRocketModel`) stands under the hung **solar system**
   (`skyDPlanetMobile`), with two floor globes (`skyDGiantGlobe`) beside it.
   - The double height hangs the mobile at 1.6× (4.8 m wide, planets at about 3.4-4.4 m). A wide double-height store (>= 16 m) adds
     a second mobile at 1.0×, turned a quarter.
   - A hall hangs it at 0.59-0.75×. The underside is always >= 2.3 m.
   - The orrery landmark is not part of the store and is not moved.
2. **Walking routes** from the entry to every staff door. Each is a turn-penalised shortest path that keeps about 2.5 m off the
   walls where it can. The routes are reserved before any furniture.
3. **Cash desk** near the front on the roomier side wall. A shop counter (the till, with its register) and the Mall glass counter
   (gadgets and cells) face the floor. Behind them are a staff aisle of at least 0.95 m (kept clear at both ends) and the Mall
   cash-wrap back counter on the wall.
   - Fallbacks: the other side wall, then the back wall, then a single counter.
4. **Telescopes** at the storefront windows either side of the entry, aimed out through the glass: the destinations' wooden
   refractor ×2 and the Office reflector.
5. **Hands-on demo bench**: the Office lab bench (15 drawers) as an island. Its worktop carries 4-5 separate lab props (microscope,
   flasks, tube rack, bottle rack, reagent bottle). On a small floor it stands against a wall instead.
6. **Star-map wall** on the back wall. It holds the framed Codex star-chart mural (`skySciStarMap`):
   - double height: 5.5 × 3.7 m at 2.3 m, with the two glass **specimen cabinets** (Mall display cabinets) side by side under it;
   - hall: 3.7 × 2.5 m at 0.85 m, the cabinets flanking it.
7. **Kit wall** on the other side wall: open steel shelving.
   - Every unit carries boxed model kits at eye level.
   - Its other tiers carry a seeded mix of kits, microscopes and chemistry glassware, all separate loose props (rule 4).
   - The tin robot (`skyDToyRobot`) stands beside it, and the Codex kit posters (`skySciPoster`: chemistry set, crystals, robot
     kit) hang above it.
8. **Tech wall** beyond the cash desk: device shelving (torch cells and batteries). Its first unit is placed before the kit wall.
9. Display tables (`merchTable`) of kits and glassware, the Office satellite model, and the framed periodic-table-style chart
   (`skySciChart`) on the wall nearest the demo bench. The destinations' "Northern Sky" star-chart poster goes up as well.
10. **Back rooms**: every version-3 store has at least one. The station dresser's shelving, cartons and crates stay. This store adds:
    - stock room: openable cardboard cartons ×2-4, storage totes ×1-2, staff lockers (else a two-door cabinet, else a filing
      cabinet);
    - office: a filing cabinet and lockers when missing, cartons and a tote.
    - With no back room (older carves), the dresser builds a staff stock corner behind the cash desk instead.

Palette (`finish` → `ANCHOR_STYLES.science`):

- walls: deep night-blue paint `#22406f` over white wall tile `#eef2f6` to 1.35 m, with a brass rail `#b8923a`;
- floor: white tile `#e3e8ee`;
- ceiling: white grid `#eef2f7`.

## New kinds (`STORE_SCIENCE_KINDS`)

The store has three new kinds, all code-drawn wall art. Each is a slim aluminium frame and a backing board, plus a flat face showing
its piece of the store's Codex atlas.

| Kind | Size W × H × D (m) | Mounted at | Openables | Physics | Damage |
|---|---|---|---|---|---|
| `skySciStarMap` | 3.68 × 2.48 × 0.035; drawn 1.5× in the double height (5.52 × 3.72) | bottom 0.85 m (hall) / 2.3 m (double height) | none (decor): framed wall mural | static, mounted | cardboard |
| `skySciChart` | 1.58 × 1.08 × 0.035 | bottom 1.3 m (2.2 m fallback in the double height) | none (decor): framed wall chart | static, mounted | cardboard |
| `skySciPoster` (variant 0-2) | 0.57 × 1.09 × 0.035 | bottom 2.05 m over the shelving (1.25 m fallback) | none (decor): framed poster | static, mounted | cardboard |

- Rule 1: they are not storage.
- Rule 2: they are screwed to the wall.
- Rule 4: they have no loose items.
- Placement: a flat, solid wall backs the whole span at its height. Never over glazing or a doorway, clear of every prop box, under
  the ceiling. Low panels reserve the floor in front of them.

## Scale check (rule 5)

Each new kind and each changed size of an existing kind was rendered beside the runtime zombie (lastshift, 1.78 m, scale 1.0) and
viewed:

- the art kinds, through throwaway GLBs of the drawn geometry and art from
  `tools/asset-pipeline/skyways-stores/science/scale-glb.mjs`, with `scale-check.mjs --prop … --lift <mount height>`;
- the scaled solar system: `skyways-d-sc-mobile.glb` `--scale 1.6 --lift 3.36`, `0.75 --lift 2.35` and `0.59 --lift 2.36`, beside
  the rocket.

The renders and JSON are in the lane's private QA folder (`reference/…/shops/science/qa/`).

- Mural:
  - hall: 3.68 × 2.48 m, spanning 0.85-3.33 m;
  - double height: 5.52 × 3.72 m, spanning 2.30-6.02 m, under the 7.5 m ceiling.
  - Its contact is the wall plane, 0.03 m off the wall face.
- Chart: 1.58 × 1.08 m, spanning 1.30-2.38 m.
- Poster: 0.57 × 1.09 m, spanning 2.05-3.14 m, under the 3.9 m hall ceiling.
- Solar system: the hook sits 2 cm under the ceiling.
  - 1.6×: 4.80 × 4.12 × 3.25 m, underside 3.36 m.
  - 0.75×: 2.25 × 1.93 m, underside 2.35 m.
  - 0.59×: 1.77 × 1.52 m, underside 2.36 m.
  - The 2.2 m rocket stands clear under every size.

## Reused kinds and their classes

| Kind (source) | Role here | Openables | Physics |
|---|---|---|---|
| `mallCashwrapCounter` (Mall M01) | cash-desk back counter | **openable**: 5 drawers + cupboard | static holder |
| `glassDisplayCabinet` (Mall M02) | specimen cabinets ×2 | **openable**: 2 glass doors | static holder |
| `labBench` (Office D09) | hands-on demo bench | **openable**: 15 drawers | static (built-in) |
| `shopCounter` / `glassCounter` | till / gadget counter | open (counter, open case) | static holder |
| `shelf` / `stockShelf` | kit wall / tech wall | open shelving | static holder |
| `merchTable` | kit tables | open | static holder |
| `cardboardBoxFlaps` (Mall M47), `storageTote` (Mall M18) | back-room cartons / totes | **openable** (flaps / lid) | dynamic 3 / 4 kg (spill) |
| `staffLockers`, `filingCabinet`, `cabinetTall` | back-room staff storage | **openable** / existing doors | static holder |
| `skyDTelescope`, `telescope` | telescopes | none (equipment) | dynamic 14 / 10 kg |
| `skyDGiantGlobe`, `skyDRocketModel`, `skyDToyRobot`, `satelliteModel` | displays | none | dynamic 16 / 28 / 12 / 18 kg |
| `skyDModelKits`, `lab*` glassware, `labMicroscope` | loose stock on shelves, the bench and tables | none / exception (sealed kit boxes) | dynamic, on-host (rest on a static host) |
| `skyDPlanetMobile` | hung solar system | none | static, mounted |
| `cashRegister` | on the till | exception (cash only) | static host decor |

No baked loose items: the bench, shelving and table models are empty. Every kit, microscope and piece of glassware is its own prop
on a measured surface, with the holder's loot surface cut under it.

## Loot (existing purposes only; Skyways anchor areas only)

The rows below come from `holderTable` for each kind and purpose (the scarcity economy applies on top, as everywhere).

| Area | Holder | Key | Table → rows |
|---|---|---|---|
| sales floor | shelf, merchTable | `mall-toys` | purpose: chocolate 1.4, chips 1, juice 0.8, battery 0.8, water 0.6 |
| sales floor | shopCounter (till) | `mall-toys` | purpose: the toy store's leftovers (water, chocolate, cola, bandage, chips) |
| sales floor | stockShelf (tech wall), glassCounter | **`mall-electronics`** (per-holder override) | purpose: battery 2.2, flare 0.2, water 0.3 |
| sales floor | mallCashwrapCounter | own | chocolate, water, battery, bandage, cola, chips |
| sales floor | glassDisplayCabinet | own | battery 1, bandage 0.9, water 0.6, chocolate 0.5, flare 0.2, medkit 0.15 |
| sales floor | labBench | own | bandage 2, bio mater 0.6, battery 0.45, water 0.3 |
| stock room | stockShelf / crate / cabinetTall | `mall-toys-back` | purpose: battery 1, chocolate 0.8, water 0.8 (+ the back-of-house common rows on crates / cabinets) |
| stock room | cardboardBoxFlaps / storageTote / staffLockers / filingCabinet | own | carton / tote / personal / office rows |
| back office | desk / safe / cabinets | `mall-electronics-back` | battery 2, water 0.5, flare 0.2 (+ the back rooms' desk / locker tables) |

- The sales floor holds no ammunition.
- Only the staff lockers' personal rows carry the existing generic-ammo weight, as everywhere.
- There are no floor piles (v3 `noFloorLoot`). Fuel ids 900+ are untouched.

## Art (Codex, owned route)

There were three Codex native `image_gen` calls, all accepted:

- the star-map mural;
- the periodic-table-style chart;
- a kit-poster triptych, split at its measured gutters.

They are processed only (crop / resize / pack) into `game/public/assets/textures/skyways/stores/science/science-art.jpg` (2048²,
level-only Skyways). The build script is `tools/asset-pipeline/skyways-stores/science/build-science-art.mjs`.

- Provenance: `game/public/assets/derivatives/skyways-store-art-20261107.json`. Its status is "unapproved prototype, provider
  terms apply".
- Raw originals, prompts, session ids and rollouts are in the lane's raw backup outside Git.
- Until the atlas loads, the faces show a plain board. They never show drawn substitute art.
