# The Survivor Market crevice (layout version 5)

Task `studio-survivor-market-crevice-20261116-074419`. Newly built Survivor Markets are an underground **concrete crevice** with a
layered settlement of converted **shipping containers** terraced up both sides and bridged across. It is an environment redesign: the
same six shops, the bar, the corpse buyer's den, trading, Rail Ties, stock, ownership, hostility and the calm Market rules. Prices,
loot, enemies, combat and survival are unchanged.

## The place

- **Arrival.** The train docks at the platform in a low concrete hall (the earlier versions' docking). Two wide gates under the bar's
  deck open south onto the **Arrival Square** on the crevice floor.
- **The crevice.** A dark chasm (railed, about 6.5 m deep, never walked) runs down the middle. Each side has four storeys of containers:
  storey 0 along the **Low walks** beside the chasm, and the **Lower, Middle and Upper terraces** above. Each band steps 3 m back into
  the rock, and each terrace walk runs on the roofs of the containers below it. The rock above the top boxes rises to about 19.5 m and
  fades into ordinary warm haze (not green: there is no gas here).
- **Containers.** Every home and every shop (except the bar on its deck) is a container's room, and so are the services. Each box has a
  painted corrugated body, a steel frame, corner castings, cargo-door ends where an end shows, doors, windows (some lit), awnings and
  vents. Some boxes are closed (nobody's), more of them up top. Some rooms have a rock-cut **back room** behind. The ground shops and the
  two upper shops are walk-in: a container front with a rock-cut shop floor behind the counter.
- **Bridges.** Four or five crossings join the sides on the terraces (storeys 1 to 3). They are cooked from the user's own walkway
  bridge model (see Implementation), cut into an end, a tileable bay with cable festoons over the chasm, a plain bay over walkways, and a
  trestle.
- **Stairs.** Six stair bays climb between storeys (two per storey pair, staggered on both sides). Residents use stairs only, never
  ladders.
- **The Weir** closes the south end on the crevice floor: the **communal kitchen** and the **workshop** face each other across long
  shared tables.

## Where things are (by the train)

| Place | Where |
| --- | --- |
| Gun, fuel, general and scrap shops | Walk-in containers on the Arrival Square, crevice floor (flat from the platform: bodies and cargo never need a stair) |
| Medical and gear shops | Walk-in containers on the Lower terrace by the bar |
| The bar | A deck over the square's north end (storey 1), its cellars in the containers beside it |
| Corpse buyer | The first container on the den side of the square, a few metres from the gates; the den is carved into the rock behind it |
| Kitchen, workshop, communal eating | The Weir (south end, crevice floor) |
| Water point, latrine, stores, generator shed, tea counter, repair counter, laundry, bunk room | Containers along the low walks and the lower terrace |

## Save compatibility

- A Market station records the layout version it was first built with (`market.layout` lane, `gen/market/layoutVersion.ts`). A station
  never entered, or any station in a new campaign, builds version 5 and records it.
- A visited Market keeps its recorded version: version 4 regenerates byte for byte as shipped (pinned by fingerprints of the previous
  `main` generator in `game/tests/market-crevice-layout.test.ts`), with its residents, stock, claimed items and identities. Nothing is
  rerolled, refilled or duplicated, and campaigns are not reset. Markets entered before version records existed stay version 1.

## Rules kept

- No enemies, clean air, no free loot. Every holder is empty except the same community stores as version 2 (the workshop's storage and
  the first store room: basic salvage).
- Every walk keeps a clear lane, nothing stands in a doorway, a stair mouth, a bridge mouth, the den's way in or the gates, and the
  bridges' decks carry nothing.
- Everything is reachable on foot from the platform. Every resident spot and trader post is reachable from every other without a ladder.
  Bodies and cargo reach the ground shops and the den's chute along a flat way at least 1.5 m wide.

## Implementation

- Generator: `game/src/gen/market/v5/` (`frame.ts` seeded frame, `carve.ts` the crevice, `dress.ts` / `record.ts` furnishing and the
  record, `den.ts` the den, `shape.ts` the crevice record for the look, `validate.ts`, `art.ts` lines / awnings / container art).
- Look: `game/src/world/marketArch.ts` (container paints, crevice concrete reusing the Reactor's existing concrete / rock / rusted steel
  textures, no floor or ceiling under a bridge deck, the chasm bed, the atrium tiles for the level culler) and
  `game/src/world/marketCrevice.ts` (container frames, ends, windows, the bridge kit, built with the Market's visuals before warm-up).
- Bridge kit: `tools/asset-pipeline/props/build-market-bridge-kit.mjs` → `game/public/assets/models/market-bridge-kit.glb`, its own PBR
  maps kept, provenance `game/public/assets/derivatives/market-bridge-kit.json`, credit in `game/public/assets/CREDITS.md`. The private
  master stays outside Git.
- Tests: `market-crevice-layout`, `market-crevice-dress`, `market-crevice-arch`, `market-crevice-view`, `market-bridge-kit`.
