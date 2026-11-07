# Starfall Arcade — Skyways major store (layout version 3)

Owner: lane STORE-ARCADE (task studio-alpha-skyways-shops-20261107-054512-01). Code: `game/src/gen/skyways/stores/arcade.ts`
(spec: purposes, finish) and `game/src/gen/skyways/stores/arcadeDress.ts` (the dresser). Test:
`game/tests/skyways-store-arcade.test.ts`. Prop-affordance record for root `CLAUDE.md` "Props — core design rules" and
`docs/prop-affordances.md`.

## Layout

The anchor is always the `hall` format; at version 3 an inset stock room can leave the sales floor L-shaped (a second floor piece
beside it). The dresser treats every floor piece as one store, in the main piece's storefront frame.

1. Circulation reserved first:
   - the entry straight in;
   - a 1 m band along every seam between floor pieces;
   - a 2.5 m apron in front of every back-room door (a side-wall door also straight across to the entry spine).
2. Prize counter near the storefront on the roomier side:
   - glass prize cases either side of the till, with the register on the till;
   - a staff aisle of at least 0.95 m behind, kept open past both ends of the run;
   - against the wall: the openable back counter (`mallCashwrapCounter`) and the glass prize cabinet (`glassDisplayCabinet`).
   - Shorter runs fall back to a `stockShelf` back unit.
3. Token changers: the Subway coin / card machine form (`ticketMachine`) on the storefront wall's solid stretches beside the entry,
   else at the counter's end.
4. The technician's workshop in the stock room, dressed before the rest of the floor (see "Back rooms").
5. The giant teddy prize beside the counter. Capsule-toy machines and a gumball machine run along the wall beyond the counter.
6. Claw cranes near the entry:
   - on the claws' side wall, else the storefront wall (the window display), else any side wall;
   - a bank of 2 to 4 cranes, a single crane only as the last resort.
7. Kiddie rides in the front window zone.
8. The party zone:
   - in the other floor piece, or a deep main floor's back corner;
   - party tables with their stools (`foodCourtTableSet`), a drinks cooler and the jukebox.
9. Banks of upright cabinets (`arcadeCabinet`, runs of up to 6, each with a 1 m play strip) on every far wall. Pinball banks run
   along the long side walls deeper in.
10. Each floor piece's middle is filled in bands across it:
    - back-to-back cabinet rows (backs on a cell seam, both play strips are aisles);
    - a pinball row;
    - air hockey tables (islands with a 1 m ring);
    - single cabinet rows where only those fit.
11. One drinks vending machine. Arcade posters (`skyDPoster`, the destination art's arcade piece) go at eye height on free walls
    and high (2.1 m) over the cabinet banks.

REACH: every placement goes through an all-or-nothing transaction that keeps every arcade holder and back-room door at the end of a
1 m wide walk from the storefront (blocks of 2 × 2 free cells). Each floor piece also stays connected (`placeKit`).

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
