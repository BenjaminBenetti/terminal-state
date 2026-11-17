# The Survivor Market crevice (layout versions 5, 6 and 7)

Task `studio-survivor-market-crevice-20261116-074419`. Newly built Survivor Markets are an underground **concrete crevice** with a
layered settlement of converted **shipping containers** terraced up both sides and bridged across. It is an environment redesign: the
same six shops, the bar, the corpse buyer's den, trading, Rail Ties, stock, ownership, hostility and the calm Market rules. Prices,
loot, enemies, combat and survival are unchanged.

## The place

- **Arrival.** The train docks at the platform in a low concrete hall (the earlier versions' docking). Two wide gates under the bar's
  deck open south onto the **Arrival Square** on the crevice floor.
- **The crevice.** A dark chasm (railed, about 6.5 m deep, never walked) runs down the middle. Each side has four storeys of containers:
  storey 0 along the **Low walks** beside the chasm, and the **Lower, Middle and Upper terraces** above. Each band steps 3 m back into
  the rock, and each terrace walk runs on the roofs of the containers below it. The rock above the top boxes rises to about 19.5 m
  (version 6: an irregular overhead between about 12.4 and 23 m, below) and fades into ordinary warm haze (not green: there is no gas
  here).
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

## The irregular envelope (layout version 6)

Task `studio-market-irregular-envelope-20261116-210503-01`, after playtesting version 5: the settlement stays exactly as it is, but the
concrete and rock around it are no longer one big box (`game/src/gen/market/v6/envelope.ts`, its own seeded stream):

- **Overhead.** No flat lid. A high slot (about 20 to 23 m; lower over the square and the weir) runs down the crevice in five to seven
  stretches, each offset to one side or the other, bending diagonally from one stretch into the next. Under it each rock face steps out
  in concrete ledges, each side with its own widths, heights and breaks, down to overhangs about 3.5 m over the top terrace. One or two
  slanting concrete ribs cross part or all of the width, and a few ragged pockets cut the rock higher or hang it lower. The edges of the
  slot and every ledge wander from row to row, so no edge runs straight.
- **Upper faces.** Two or three deep rock-cut alcoves open off the top terrace where its container row gives way, and every top-storey
  nook is sheltered under its own soffit.
- **Ends.** A high cleft is cut into each end wall above the settlement, stepping narrower and lower as it goes in. It is out of reach
  (its floor is well above the top terrace), takes no railing, and is not part of the culler's atrium.
- **Down.** The chasm's bed is shelved: a lip under each walk edge, deeper shelves beyond, and a deep cleft winding between them. Every
  shelf stays more than a railing's drop below the walks, so the walk edges keep their railings, and there are none inside the chasm.
- **Look.** No new textures. Overhead surfaces from 19 m up use the existing dark rock; the lower ledges, ribs and soffits use the
  existing darker vault concrete; the clefts are rock.
- **Kept.** Headroom of at least 3.5 m over every top-storey public floor, the flat way from the train to the heavy shops and the den,
  the residents' ladder-free graph, and the same names, shops and trade. The extra wall faces are a few thousand triangles in the
  existing material chunks; the culler's atrium tiles are unchanged.

## The irregular settlement floorplan (layout version 7)

Task `studio-market-irregular-settlement-20261117-003819-01`, after version 6: the settlement itself was still square, with every
terrace a 3 m ribbon, every band stepped back by the same amount and the pit one long rectangle. Version 7 keeps the architecture and the
envelope, but plans the floorplan per side, per storey and per section of the crevice (`game/src/gen/market/v7/settlement.ts`, its
own seeded stream):

- **Bands in sections.** Each storey's container row runs in sections of about 5 to 13 m. Each section stands at its own setback toward
  or away from the pit, so a row bends, jogs and bulges. Each side gives its three terraces a narrow, a middling and a wide character in a
  seeded order, so some levels stand clearly further back than others, and differently on the two sides. The breaks between sections are
  staggered from storey to storey, so no two levels share a line.
- **Walks.** Each terrace walk is whatever lies between its own band and the roofs of the band below: 2.5 to 6.5 m wide, changing
  section by section. Behind a bridge's mouth the band steps back into a landing. Now and then a section steps back further to make a
  small plaza, and a wide plaza gets a camp table with chairs or a bench, keeping a 2 m lane clear by the railing.
- **The pit.** Each side's edge runs in its own sections. A lookout bastion juts into the pit here, and the pit bites into the walk there.
  The pit's outline steps along both sides, its width changing between 3.5 m and about 6.5 m. The low walks stay 2.5 m or wider.
- **Kept by construction.** The Arrival Square, the bar's deck, the gates, the den and the square's heavy shops stay on version 5's
  columns, so the flat carry route from the train is unchanged. Every container, stair bay and nook lies within one section. A stair bay
  keeps one walk width along its whole run, with section breaks just outside it. Each run climbs beside rock or a walk, never under the
  next band's boxes or a wide walk, and its head is kept clear across the walk above. Each bridge deck spans two straight walk edges.
  Railings follow every step of every edge, and nothing is railed inside the pit.
- **Residents.** Bent walks give routes long diagonal legs up a whole flight. People's route squaring (`squareSteps` in
  `game/src/market/marketPeople.ts`) now turns only single steps between cells into two straight steps. Before, it turned such a leg into a
  "step" onto the floor above the stair's foot, and fleeing residents stood there.
- **Density.** Version 6's, with more props and lights. Over 20 seeds there are as many containers and open homes and shops, and as many
  home hiding corners for fleeing residents. The short runs between section breaks take 3 m (10 ft) boxes. The usual box is a little
  longer than version 5's, because a home much under 5 m has no corner away from its door once its bed and table are in.
- **Look.** No new assets. The kit's cabled bridge bays stand only where the pit lies under them at that bridge, and lines and laundry
  tie to their own storey's edge where they meet it. The chasm's finishes follow the pit's own runs, never the low walks.

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
  never entered, or any station in a new campaign, builds version 7 and records it.
- A visited Market keeps its recorded version: versions 5 and 6 regenerate byte for byte as shipped (pinned by fingerprints of the
  previous `main` generators in `game/tests/market-crevice-envelope.test.ts`; version 4 likewise in
  `game/tests/market-crevice-layout.test.ts`),
  with its residents, stock, claimed items and identities. Nothing is rerolled, refilled or duplicated, and campaigns are not reset.
  Markets entered before version records existed stay version 1.

## Rules kept

- No enemies, clean air, no free loot. Every holder is empty except the same community stores as version 2 (the workshop's storage and
  the first store room: basic salvage).
- Every walk keeps a clear lane, nothing stands in a doorway, a stair mouth, a bridge mouth, the den's way in or the gates, and the
  bridges' decks carry nothing.
- Everything is reachable on foot from the platform. Every resident spot and trader post is reachable from every other without a ladder.
  Bodies and cargo reach the ground shops and the den's chute along a flat way at least 1.5 m wide.

## Implementation

- Generator: `game/src/gen/market/v5/` (`frame.ts` seeded frame, `carve.ts` the crevice, `dress.ts` / `record.ts` furnishing and the
  record, `den.ts` the den, `shape.ts` the crevice record for the look, `validate.ts`, `art.ts` lines / awnings / container art);
  version 6 adds `game/src/gen/market/v6/envelope.ts` (the envelope's plan and its stamp onto the carved grids); version 7 adds
  `game/src/gen/market/v7/settlement.ts` (the floorplan's plan: section breaks and setbacks per band, the pit's edge), which the carve,
  dress, record and art read row by row.
- Look: `game/src/world/marketArch.ts` (container paints, crevice concrete reusing the Reactor's existing concrete / rock / rusted steel
  textures, no floor or ceiling under a bridge deck, the chasm bed, the atrium tiles for the level culler) and
  `game/src/world/marketCrevice.ts` (container frames, ends, windows, the bridge kit, built with the Market's visuals before warm-up).
- Bridge kit: `tools/asset-pipeline/props/build-market-bridge-kit.mjs` → `game/public/assets/models/market-bridge-kit.glb`, its own PBR
  maps kept, provenance `game/public/assets/derivatives/market-bridge-kit.json`, credit in `game/public/assets/CREDITS.md`. The private
  master stays outside Git.
- Tests: `market-crevice-layout`, `market-crevice-dress`, `market-crevice-arch`, `market-crevice-view`, `market-bridge-kit`,
  `market-crevice-envelope` (version 6), `market-crevice-settlement` (version 7).
