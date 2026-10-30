# Prop affordances — authoring checklist

Standing user rule (2026-10-30, root `CLAUDE.md` "Props — core design rules"):
- **storage opens**, with thematically appropriate finite loot;
- **movable things move**, under bullets and player contact.

Exceptions are explicit and classified. Use this checklist for every new or changed prop kind (procedural, authored or
generated model).

## 1. Classify the kind (both audits, every kind)
| Question | Where it is recorded | Classes |
|---|---|---|
| Can it be opened / searched? | `OPENABLE_AUDIT` in `game/src/world/openablesSpec.ts` | `openable` (doors / drawers / lids this system animates), `existing` (earlier holder with moving parts), `open` (open shelving / counters: loot reachable), `exception` (looks openable but deliberately closed — honest reason), `none` (no door / lid / drawer at all) |
| Does it move when shot or bumped? | the physics-affordance classification (see section 3; name and location filled in by the office-interactions pass) | dynamic (mass / shape / material) or static with a reason (anchored, built-in, too heavy, fixture) |

Both audits are enforced by tests: an unclassified kind fails CI.

## 2. Storage that opens
- Use the existing openables machinery (`world/openables.ts`, `world/openablesSpec.ts`): hinged doors, lids and sliding drawers
  derived from the model (`world/meshSplit.ts`) or procedural parts. Never a menu.
- Contents:
  - finite, rolled once from the level seed, remembered in run memory (taken lots stay taken; never refilled on reopen /
    revisit);
  - themed by container through the loot-table foundation: pick or add a **slot category** and named table in
    `game/src/items/lootTables.ts` (`HOLDER_SLOTS`, named tables, `HOLDER_ALLOW`) — see `docs/loot-tables.md`;
  - no new literal item lists in consumers.
- Fit and occupancy: lots are packed on real compartment surfaces (`items/lootLayout.ts`); an item that doesn't fit is not
  placed. Door swings and drawer travel stay clear of walls / doorways (placement `front` / access strips).
- An anchored cabinet may still open (static body, animated doors).

## 3. Movable things move
- Use the existing bounded, lazy, sleeping physics for loose props (bodies created on demand, asleep until hit or bumped).
- Plausible mass / friction / impulse:
  - a chair slides and tips;
  - a bean bag barely moves under a pistol round;
  - a filing cabinet doesn't fly.
- Loot rides with its holder or is dropped as real pickups. It never floats, duplicates or vanishes; hover highlights follow
  the item.
- Never wake the whole level; never add unbounded bodies.
- Static by design: built-in or very heavy furniture, wall-mounted fixtures, machinery — with the reason recorded.

## 4. Checks for a new prop
- Unit tests:
  - its audit classes;
  - openability (parts animate, contents finite / themed / remembered);
  - loot fit;
  - physics class (dynamic kinds get a body, react to an impulse and settle; static kinds don't).
- One short serial browser spot check of a representative prop when visuals change (root `CLAUDE.md` browser rules).
