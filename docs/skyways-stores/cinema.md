# Skyways major store: Aurora Picture House (cinema) — prop affordances

Task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-CINEMA. Layout version 3 (`gen/skyways/stores/cinema.ts`; dresser
`stores/cinemaDress.ts`, placement kit `stores/cinemaKit.ts`, art kinds `stores/kinds/cinema.ts` + `stores/cinemaArt.ts`, renderer
`world/skywaysStoreCinema.ts`). Root `CLAUDE.md` "Props — core design rules" and `docs/prop-affordances.md` apply.

## Layout (format multi-zone, always)
- **Lobby** (the sales floor and its pieces round an inset back room): the entry spine and the walks to the auditorium doors and every
  staff door are reserved first. The box office (the art-deco ticket kiosk `skyDTicketBooth`) stands by the entry with a rope queue of
  movable posts (`skywaysPrizeStanchion`) and a hanging BOX OFFICE plate. The concession stand runs along the back wall beside the
  auditorium doors: counters (`shopCounter`) and the glass candy case (`shopDisplay`) facing the lobby, the till (`cashRegister`) and the
  popcorn machine (`popcornMachine`) on top; behind a staff aisle the drinks cooler (`shopCooler`), the low cupboards (`cabinetLow`, a
  hot-dog roller on top), the back counter (`shopBackbar`, soda fountain on top) and, room permitting, the ice-cream chest freezer
  (`chestFreezer`); the REFRESHMENTS board over them; the snack rack at the run's end; the vintage popcorn cart (`skyDPopcornCart`) out
  front. NOW SHOWING poster cases flank the auditorium doors and line the walls, freestanding poster stands by the entry and the doors, the
  older coming-attractions bills (`skyDPoster`), lobby benches, a bin, SCREEN 1 / STAFF ONLY plates. The kiosk and the stand are tried in
  both orders (no rng) and the fuller lobby is kept.
- **Auditorium**: the screen (`skyDCinemaScreen`, code-drawn) on the far wall (the door wall is the projection side); seat rows
  (`skyDCinemaSeats`) at a 1.0 m pitch from 2.5 m off the screen, in groups of up to three 4-seat blocks between both side aisles, the
  centre aisle from the door and a back cross aisle (a few blocks torn out); EXIT over the door; by the door a bin, the
  fire-extinguisher cabinet and the first-aid kit; the usher's cupboard (`cabinetLow`) by the screen.
- **Back of house**: the stock room keeps the station dresser's shelving / cartons / crates and gains flap-lid cartons
  (`cardboardBoxFlaps`) and, when it fits, a chest freezer; the staff side (the office when carved, else the stock room, else the corner
  behind the concession, else beside a staff door) gets the openable filing cabinet (`filingCabinet`) and staff lockers (`staffLockers`).

## New kinds (both audits; scale-checked)
| Kind | What | Openables audit | Physics audit | Scale check W×H×D (contact) |
|---|---|---|---|---|
| `storeCinemaPosterCase` | glazed one-sheet poster case, brass frame, the Codex poster inside | `none` (the glass is fixed to the frame; the poster is its printed sheet, not an item) | static `mounted` (screwed to the wall, bottom 0.82 m) | 0.86 × 1.28 × 0.09 m; min-y 0.82 (wall-mounted); sheet centre 1.46 m, top 2.10 m |
| `storeCinemaPosterStand` | freestanding brass poster stand on a weighted base, a Codex poster | `none` | **dynamic** 9 kg box, `pad` contact | 0.80 × 1.80 × 0.42 m; grounded, 4 contact clusters over the 0.56 × 0.42 m base |
| `storeCinemaMenuBoard` | the concession's framed REFRESHMENTS board (Codex art) | `none` | static `mounted` (bottom 2.1 m) | 1.80 × 1.24 × 0.07 m; min-y 2.10, top 3.34 m |

Renders: `node tools/asset-pipeline/skyways-stores/cinema/parts-glb.mjs <dir>` exports the exact runtime box parts as GLBs; then
`node tools/asset-pipeline/props/scale-check.mjs --prop <dir>/storeCinemaPosterStand.glb --prop <dir>/storeCinemaPosterCase.glb --lift 0.82
--prop <dir>/storeCinemaMenuBoard.glb --lift 2.1`, viewed beside zombie `lastshift` at runtime scale 1.0 (render kept in the lane's private
QA folder).

- No baked loose clutter: the three kinds are frames, glass, a backing and a printed sheet; the concession's food is real loot in its
  holders; the counter-top machines are separate on-host props (`popcornMachine`, `cashRegister`, `sodaFountain`, `hotDogRoller`: their
  existing classes).
- Every other kind is an existing one with its existing classes (openables: `shopCooler`, `chestFreezer`, `filingCabinet`,
  `staffLockers`, `cardboardBoxFlaps`, `bin`, `firstAidWallKit` openable, `cabinetLow` existing two-door holder; movable: the rope posts,
  the popcorn cart, the stands; static with reasons: the kiosk, the seat rows, the screen, the counters).

## Loot (existing purposes only)
| Area | Purpose | Holders → rows |
|---|---|---|
| lobby (concession) | `mall-kiosk` | display case / back counter / cupboards: chocolate, chips, water, cola, battery; cooler: water, cola, juice; snack rack: chocolate, chips; till: what people leave behind (water, chocolate, cola, a dressing, chips); chest freezer: its frozen-case rows narrowed to water / cola |
| auditorium (front of house) | `mall-customer-service` | usher's cupboard: chocolate, water, a dressing, chips, a torch cell; bins: dropped snacks / drinks; first-aid kit: dressings / water |
| stock room | `mall-food-back` | shelving: beans, noodles, water, cola, chips, juice; crates / cartons: + dressings, cells; freezer: water, juice, cola, beans |
| office (when carved) | `office-private` | desk / drawers / filing / cabinets: the Office's private-office rows (its small 9 mm rule) |
| per holder | `office-private` | the staff filing cabinet / lockers placed outside the office (stock room, behind the concession, by a staff door) |

No floor piles (every store area `noFloorLoot`); no new tables; ammo only on the Office purpose (tested).

## Tests
`game/tests/skyways-store-cinema.test.ts` (six version-3 seeds): the art kinds' audits / atlas / faces; the lobby's box office + queue,
concession (cooler, cupboards, popcorn, candy case, REFRESHMENTS board, till), cases, plates; the auditorium (screen, rows facing it,
every row reachable from an aisle, the screen front reachable); the staff side and stocked back rooms; storage opens; loot on theme;
fit / overlaps / routes from the entry to every door and to the counter; physics classes; palette (ANCHOR_STYLES); determinism.
