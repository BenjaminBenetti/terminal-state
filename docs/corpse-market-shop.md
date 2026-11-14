# The Market corpse buyer (the den)

Task `studio-corpse-market-shop-20261114-031614-01`. In a Survivor Market built with layout version 4, a creepy buyer in a tucked-away
back room buys whole dead zombies. The player drops a body down his floor chute; he pays a flat **10 Rail Ties** per body by pushing a
bundle through his booth's slot. It falls to the floor as an ordinary loose item to pick up. He only buys: he sells nothing, holds no
stock, and nobody can buy a corpse anywhere.

## Finding it

- The den is off the **Back Lane**: a doorway through the market shed's wall beside the lane, with painted boards over it
  ("BODIES BOUGHT", "10 TIES"). A 2 m back passage under a plain lamp leads to the low customer room (3 to 5 m deep, a 2.6 m ceiling, a
  dim red lamp). The floor chute stands in the room's middle, open side toward the customer. A board hangs in front of the booth ("DEAD
  ONES ONLY · 10 TIES"), and the buyer stands behind the barred steel booth that closes his sealed back room.
- The den is on whichever side the Market's mirror puts the Back Lane. In the shallowest rooms the chute is turned a quarter to keep its
  front clear. Version 4 is version 3 plus the den, with every other cell, prop, light, sign, stall and spot unchanged
  (`game/tests/market-den-layout.test.ts`).
- Looking at the chute or the booth (not carrying anything) shows the look-at line: *"Corpse buyer — whole dead undead bodies, 10 Rail
  Ties each, down the chute. He sells nothing."*
- The train's chipper points BB carriers to him ("Too small a body for the chipper — the Market's corpse buyer takes it whole").

## Selling a body

1. Carry a dead body to the den (`docs/corpse-chipper.md`: aim at it, **E**; one at a time, slower).
2. Walk up to the chute and aim at it. The prompt reads **[E] Drop the body down the chute · 10 Rail Ties**.
3. **E**: the body leaves your hands in the same instant. It is lifted head-down over the hopper and slides down the shaft out of sight
   (about 1.6 s): into the black mouth at the bottom of the hopper. The buyer greets you, then counts (his work loop, about 1.4 s).
4. He pushes a bundle of 10 Rail Ties through the booth's slot. It slides off the counter's edge and lands on the floor in front of the
   booth (about 0.6 s). It is now an ordinary `rail_ties` pickup: aim + **E** takes it. Unclaimed bundles from several sales lie side by
   side.

The whole sale takes about 3.6 s. One body at a time: a second one is refused until the first has paid ("He is still dealing with the last
one — wait"); the player keeps the refused body.

## Which bodies (price and eligibility)

- **Accepted:** every carriable body, which is every dead undead enemy (`corpseCarriable`, `game/src/ai/corpseTrait.ts`): an ordinary
  infected of any look, Blightbelly, Siren, Strainer, Screacher (all four bodies) and **BB** (all four looks). The price is the same flat
  10 Rail Ties for each (`CORPSE_SHOP.price`).
- **BB:** its small body became carriable for this feature, with the same over-the-shoulder carry on the shared rig. It stays
  non-graphic: no gore and no new wounds. The sale shows the whole clothed body going down the chute. The chipper still refuses it.
- **Never accepted:** living enemies (only dead bodies can be carried), Market people and other non-undead humans, animals (the rat/dog
  is not undead), the player, and loose parts (flesh chunks, severed limbs, ragdoll pieces are not bodies; nothing but a whole body
  record in the hands is ever offered). A defensive check refuses any non-undead record with "He only buys whole dead undead bodies".
- **Hostile settlement:** if the Market has turned on the player (`market/hostility.ts`), the booth goes dark (the buyer steps out of
  sight) and offers are refused ("The booth is dark — nobody is buying now"). A sale already running still pays. The buyer is not one
  of the Market's people: he is never a combat target, never in their roster, and his welded booth takes any bullets.

## Records, saves and compatibility

| What | Where | Notes |
|---|---|---|
| The sale in progress | Market station lane `market.corpse-shop` (`job`: sale uid, the body's station record at the chute, integer ms) | the body's only copy while it goes down |
| Bodies bought | the same record: `done` (count), `last` (last paid uid), `sold` (the newest 64 ids) | a bought body exists nowhere else |
| The payout | a world pickup of `rail_ties` (10) in the station's loose items | saved like any dropped item |

- **Once only.** `advanceSale()` consumes the body, counts the sale and names it sold in one mutation; the runtime drops the ties as a
  pickup in that same synchronous step. No save can see one without the other. A sale never pays twice; a body is never sold twice.
- **Strict validation.** `corpseShopProblem` checks the record's shape, counters, uid and progress, and that the job's body is a
  carriable undead station record. The save validator then checks one body, one place: the sale's body and every sold id must not also
  be in the hands, a station's `corpses.here`, the train's cargo or the chipper's job.
- **Continue / load / import / export:** the record travels with the station's memory. A sale saved mid-way resumes where it stood when
  the station is built again (mid-swallow, the body is rebuilt from its record), and pays exactly once.
- **Retry:** the level-entry snapshot restores the station memory and the hands / train together: the body is back where it was at
  entry and nothing was paid.
- **Travel:** leaving keeps the record (a sale is far shorter than any walk to the train).
- **Old saves and visited Markets:** a station keeps the layout version it was first built with (`gen/market/layoutVersion.ts`).
  Visited version 1–3 Markets never gain a den, never reroll, and their stock is never refilled. Only Markets built new get version 4.
  Old saves have no `market.corpse-shop` lane and load unchanged.
- **Loot spill seam:** before a body is consumed, any loot it still holds (the host's `corpseLoot`) is dropped as pickups at the
  customer's spot. No body in this game holds loot today (an enemy's finds are world items when it dies), so this never fires in play;
  it guarantees a future one is never lost silently. Tested with a stub.

## Code

- `game/src/market/corpseShop/shopState.ts`: the pure sale record (price, phases, refusals, `startSale` / `advanceSale`, validator).
- `game/src/market/corpseShop/corpseShop.ts`: the runtime (`Game.corpseShop`): the chute sink (`corpse/api.ts BodySink`), the swallow
  and tie-drop visuals, the buyer actor (the market humans' `HumanWardrobe` / `HumanActor` on his own one-body cast file), the look-at
  line, the warm-up pool `market-corpse-buyer`.
- `game/src/gen/market/v4/`: layout version 4 (the den's carve, dressing, record and validator; `denKinds.ts`: the `corpseChute` /
  `corpseBooth` prop kinds).
- `game/src/ai/corpseTrait.ts`: `corpseCarriable` (every undead body) next to `corpseFeedable` (the chipper's undead humanoid bodies).

## Assets

Genuine owned Codex initial conditioning images, then Meshy T2.5 image-to-3D (Smart Topology, 2K PBR maps). The models keep Meshy's own
maps, re-encoded by the normal cook; there is no retexture or reprojection. Private masters, prompts and the finance ledger stay outside
Git with an independent backup. Only cooked outputs and hash provenance ship.

- `market-corpse-chute.glb`: the floor chute, a square riveted steel hopper with its lid welded upright. A static, anchored prop. Its
  throat is open geometry (no shaft is modelled), so the runtime lays one unlit near-black quad over the floor in the measured throat
  (`CORPSE_SHOP_KIT.chute.throat`, turned with the prop): seen down the hopper it reads as a shaft. It is a flat colour, not a texture.
- `market-corpse-booth.glb`: the barred steel booth with its counter and caged red lamp. A static, built-in prop that closes the
  opening to the buyer's back room.
- `market-corpse-buyer.glb`: the buyer, a gaunt, fully clothed man of about 55 (roll-neck, leather waistcoat, long rubber gloves, rubber
  boots, dark round glasses). Rigged locally on the market humans' 18-joint skeleton with their healthy clips. No provider rig or
  animation.

Scale checks beside a runtime zombie, dimensions and contacts: `docs/prop-affordances.md` (Survivor Market).

## Tests

- `game/tests/corpse-shop.test.ts`: the sale record, the runtime on a fake host (sink, the shaft mouth, swallow, one pickup per sale,
  resume mid-sale, hostile booth, the spill seam, the look-at line), the buyer actor with the real cooked model (his post and facing,
  Idle / Greet / Work, dark while hostile, the bounded stare), and save validation.
- `game/tests/corpse-bb-carry.test.ts`: BB's body with the real model, corpse system and chipper (pickup, shoulder anchor, chipper
  refusal, cargo, platform drop, grounded rebuild).
- `game/tests/market-den-layout.test.ts`: the version 4 den (layout lane): parity with version 3, the sealed back room, reachability
  on foot and carrying a body, the clear tray and chute front, signs, lamps and the audits.
- `game/tests/corpse-shop-market.test.ts`: the sale end to end in a real version 4 Market (the generated den, real level geometry,
  corpse system and PickupManager), and a seed sweep over both mirror states and the quarter-turned chute.
- `game/tests/corpse-shop-assets.test.ts`: the cooked models and provenance (asset lane).
