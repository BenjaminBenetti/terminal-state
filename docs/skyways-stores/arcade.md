# Starfall Arcade — Skyways major store (layout version 3)

Owner: lane STORE-ARCADE (task studio-alpha-skyways-shops-20261107-054512-01). Code: `game/src/gen/skyways/stores/arcade.ts`
(spec: purposes, finish) and `game/src/gen/skyways/stores/arcadeDress.ts` (the dresser). Test:
`game/tests/skyways-store-arcade.test.ts`. Prop-affordance record for root `CLAUDE.md` "Props — core design rules" and
`docs/prop-affordances.md`.

## Layout

The anchor is always the `hall` format; at version 3 an inset stock room can leave the sales floor L-shaped (a second floor piece
beside it). The dresser treats every floor piece as one store, in the main piece's storefront frame.

Placement order (the cabinets claim the walls before the prizes, rides and party take floor):

1. Circulation reserved first:
   - the entry straight in;
   - a 1 m band along every seam between floor pieces;
   - a 2.5 m apron in front of every back-room door (a side-wall door also straight across to the entry spine).
2. Prize counter: the longest run that fits, on the main floor's walls first (the roomier side's wall from the storefront first),
   then the other piece's walls.
   - glass prize cases either side of the till, with the register on the till;
   - a staff aisle of at least 0.95 m behind, kept open past both ends of the run;
   - against the wall: the openable back counter (`mallCashwrapCounter`) and the glass prize cabinet (`glassDisplayCabinet`);
   - shorter runs: the prize cabinet + the staff's two-door supply cabinet (`cabinetTall`), or the supply cabinet alone. The counter
     always has opening storage behind it.
3. Token changers: the Subway coin / card machine form (`ticketMachine`) on the storefront wall's solid stretches beside the entry,
   else at the counter's end.
4. The technician's workshop in the stock room, dressed before the rest of the floor (see "Back rooms").
5. Capsule-toy machines and a gumball machine along the wall beyond the counter.
6. Banks of upright cabinets (`arcadeCabinet`, runs of up to 6 from the corner, each with a 1 m play strip) on every far wall.
7. Claw cranes near the entry:
   - on the claws' side wall, else the storefront wall (the window display), else any side wall;
   - a bank of 2 to 4 cranes, a single crane only as the last resort.
8. A small hall (under 140 m² of sales floor): its air hockey table now. The 1 m walkway comes first, else one cell (the players
   stand at its ends).
9. The giant teddy prize beside the counter, else sat against a free wall.
10. Kiddie rides in the front window zone.
11. The party zone, only in a store of at least 130 m² of sales floor:
    - in the other floor piece, or a deep main floor's back corner;
    - party tables with their stools (`foodCourtTableSet`), a drinks cooler and the jukebox.
12. Pinball banks along the long side walls deeper in.
13. Each floor piece's middle is filled in bands across it:
    - back-to-back cabinet rows (backs on a cell seam, both play strips are aisles);
    - a pinball row;
    - air hockey tables (islands with a 1 m ring);
    - single cabinet rows where only those fit.
14. One drinks vending machine. More upright cabinets go on whatever wall is still free (up to 12).
15. Arcade posters (`skyDPoster`, the destination art's arcade piece) at eye height on free walls and high (2.1 m) over the cabinet
    banks.

Every placement goes through an all-or-nothing transaction. It holds:
- REACH: every arcade holder and back-room door stays at the end of a 1 m wide walk from the storefront (blocks of 2 × 2 free cells);
- no trapped floor: every free cell of the floor pieces joins the storefront's open floor. This is the level validation's rule, and
  a placement never forces a generation retry.

The dresser places its contiguous rows itself, with the kit's `putRow` checks minus `placeKit.areaConnected`. On an L-shaped v3 floor
the storefront opening's walkable cells carry the main piece's area id beyond its rect. That test then fails for the main piece
before anything stands there, so every kit row would be refused. The store-wide checks above replace it.

## Back rooms

Every v3 store has at least one back room (the parent's carve fallback).

- **Stock room = the technician's workshop.** These pieces join the stock the station dresser shelved there:
  - the electronics repair bench (`repairBench` variant 1) against a free wall. In a lined room, the workbench cluster goes on its
    open floor: a `desk` (3 drawers) with the soldering station and a test terminal on its top, and the rolling tool chest at its end;
  - the rolling tool chest (drawers) with a toolbox on it;
  - the staff lockers;
  - a TV test cart, a storage tote, a cardboard box;
  - a tool pegboard and parts bins on the walls.

  Each piece is kept only when it stays reachable and cuts nothing off. That includes the station's shelving: their 0.7 m access
  strips are reserved. An empty room is shelved first (stock shelving, carton stack, crate).
- **A lined stock room's lockers** stand on the sales floor at the nearest free wall spot by its staff door.
- **The office (when carved)** gains staff lockers, else a filing cabinet.
- **No back room** (older carves): a staff corner beyond the counter (lockers, tool chest, shelving).

## Kinds: no new kinds

The store uses existing classified kinds only, so `STORE_ARCADE_KINDS` is empty. No new scale check is due under rule 5: no new or
changed model. Classes, as audited:

| Kind | Openables audit | Physics audit |
|---|---|---|
| `mallCashwrapCounter` (back counter) | openable: 5 derived drawers + a cupboard door | static holder |
| `glassDisplayCabinet` (prize cabinet) | openable: 2 glass doors | static holder |
| `staffLockers` | openable | static holder |
| `rollingToolChest` | openable drawers | static holder |
| `desk` (workbench) | openable: 3 drawers | static holder |
| `shopCooler` | openable door | static holder |
| `storageTote`, `cardboardBoxFlaps` | openable lid / flaps | dynamic (4 / 3 kg) spill holders |
| `glassCounter`, `shopCounter`, `stockShelf`, `foodCourtTableSet` | open surfaces | static holder / anchored |
| `vending`, `crate` | existing | static holder |
| `arcadeCabinet`, `skyDClawCrane`, `skyDPinball`, `skyDAirHockey`, `kiddieRide`, `jukebox` | exception (coin-op service panels, not storage) | static, too heavy |
| `ticketMachine` (token changer) | exception (coin / card machine: locked service door) | static, anchored |
| `capsuleToyMachine` | none | static |
| `gumballMachine` | exception (dispenses gum, not items) | dynamic 16 kg |
| `giantTeddy` | none (decor) | dynamic 6 kg |
| `repairBench`, `crtTvCart`, `toolPegboard`, `partsBinRack` | none | static (built-in / kept / mounted) |
| `cashRegister`, `solderingStation`, `crtTerminal`, `handToolbox` | exception / none | on-top decor on static hosts (the toolbox dynamic 6 kg) |

No loose items are baked into anything new. On-top decor (register, soldering station, test terminal, toolbox) is a separate prop on
a static host's measured top. The claw crane's plush pile is the machine's own display, part of the equipment.

Mall models loaded in Skyways (`STORE_ARCADE_MALL_MODELS`):
- `mall-glass-display-counter.glb`
- `mall-glass-display-cabinet.glb`
- `mall-mall-cashwrap-counter.glb`
- `mall-kiddie-ride.glb`
- `mall-food-court-table-set.glb`
- `mall-storage-tote.glb`
- `mall-cardboard-box-flaps.glb`

## Loot

Existing purposes only (`gen/purposes.ts`), on the Skyways anchor areas at version 3. No new tables and no floor piles.

| Role | Holder | Loot key | Rows (as rolled) |
|---|---|---|---|
| sales floor | till `shopCounter` | `mall-arcade` | chocolate, cola, batteries |
| sales floor | `vending` | `mall-arcade` | chocolate, chips, cola, water (3–6 lots) |
| sales floor | `shopCooler` (party zone) | `mall-arcade` | water, cola, juice |
| sales floor | back counter `mallCashwrapCounter` | `mall-arcade` (own table narrowed) | chocolate, batteries, cola, chips |
| prize counter | `glassCounter`, `glassDisplayCabinet` | `mall-toys` (per holder) | chocolate, chips, juice, batteries, water |
| party zone | `foodCourtTableSet` | `mall-kiosk` (per holder) | chocolate, chips, water, cola, batteries |
| workshop | `rollingToolChest`, `desk` | `mall-electronics-back` (per holder) | batteries, flares, water (+ back-of-house common) |
| staff | `staffLockers` | `mall-arcade-back` (per holder) | personal rows (the existing locker table) |
| stock room | shelving, crates, totes, boxes | `mall-arcade-back` | batteries, cola, water (+ beans, bandages, noodles in crates / boxes) |
| office | desk / cupboards | `mall-management` | office desk rows, no ammo rows |

The store's purpose tables add no ammo. The staff lockers keep the existing personal-locker rows, which include a few loose rounds
as in every level.

## Finish (render-only)

`STORE_ARCADE.finish` feeds `gen/skyways/destinations/anchorStyles.ts` (`ANCHOR_STYLES.arcade`, keys `skyways-anchor-*@arcade`):

- walls: deep indigo paint `#221a40` over a near-black dado `#0e0c18` (1.2 m) with a violet rail `#b03cd0`;
- floor: a night-blue loop-pile carpet `#1b1d4f`, the starfield's sky (the Office carpet map, tinted);
- ceiling: exposed, painted out `#121018`.
