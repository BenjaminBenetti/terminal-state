@AGENTS.md

Follow current portable repository guidance. Work in Git, push checked changes to
GitHub `main` without rewriting history, and publish only verified GitHub Actions
artifacts. This repo does not install or authenticate an assistant CLI. Historical
setup/job documents are not active instructions and authorize no generation.

Project skills preserve asset-method guardrails only. Audio is bundled Sound
Lab-derived MP3 data; building/playing does not require an audio generation service.
Preserve its notice and conditional prototype licensing status. Preserve raw asset
backups independently of Git's cooked runtime inputs. Do not substitute or generate
models/images/audio without fresh explicit approval.

Existing-studio migration must preserve its workspace path, ignored root reference/
and public/vision-board/, native .cache/ originals, qa-artifacts/, dependencies and
local assistant settings. Main backs up old .git/root docs and verifies GitHub
source/asset hashes before adoption. Never git clean/reset away existing work or
stage external archives. Never reuse old generation budgets.

## Props — core design rules (standing user rule, 2026-10-30)

Every new or changed prop must meet both affordance rules below. They are acceptance requirements for prop work, not
polish: a prop that looks usable must not silently ship as decoration-only. Checklist and file pointers:
`docs/prop-affordances.md`.

1. **Storage opens.** Anything that reads as reasonably openable storage must open, with physical doors, lids or drawers in
   the existing openables style. That covers cabinets, cupboards, desk and filing drawers, lockers, fridges, safes, chests,
   crates and lidded boxes.
   - Contents are finite, seeded once, remembered and never refilled.
   - Contents are themed to the container where relevant: food and drink in a fridge, dressings in first-aid storage,
     supplies in supply or utility storage, and ammo only by deliberate rule.
   - Contents come from the loot-table foundation (`game/src/items/lootTables.ts` slot categories and named tables;
     `docs/loot-tables.md`), not new literal item lists.
   - Respect fit and occupancy, door clearance and persistence.
2. **Movable things move.** Reasonably loose or movable props react to bullets and to the player walking into them, using
   the existing bounded, lazily created, sleeping physics. Examples: chairs, boxes, bins, small furniture, plants and
   desk-top objects.
   - Mass, friction and impulses must be plausible.
   - Loot on or in a moved prop never floats, duplicates or disappears.
   - Doors never detach.
   - Never wake the whole level, and never add unbounded bodies.
3. **Exceptions are explicit and classified.** These may stay static or closed, but only with a recorded, honest reason:
   - anchored structures and fixtures, such as built-in counters, wall units, heavy machinery and sealed equipment;
   - equipment that is not storage.

   An anchored cabinet can still have openable doors. Every prop kind is classified in the openables audit
   (`OPENABLE_AUDIT`, `game/src/world/openablesSpec.ts`) and in the physics-affordance classification (see
   `docs/prop-affordances.md`), and the audit tests fail for an unclassified kind. No blanket destructibility,
   durability, fire or explosion system is implied.
4. **Check it.** New props need:
   - focused unit tests for openability, contents theme, fit and the physics class;
   - a short serial browser spot check of one representative prop when visuals change (browser rules below).

## Meshy MCP — key from the environment only

The project MCP entry for Meshy (`docs/meshy.mcp.json`, activated as root `.mcp.json`; see `docs/meshy-mcp.md`) reads
`MESHY_API_KEY` from Claude Code's startup environment via `${MESHY_API_KEY}`. Never write a key into any repo file,
browser/public/`VITE_*` file or CI; `.env` is not auto-loaded. Having the server configured authorizes no paid
generation: every Meshy job needs explicit user approval with a budget and the normal original/provenance rules.

## Browser QA — serial spot checks only

Standing user rule (2026-10-29): **Serial spot checks with a browser. No heavy
browser-based test suites.** This applies to the primary and every delegate and
takes precedence over older browser-testing recipes.

- Run only short, bounded, representative browser spot checks of the changed
  feature. Do not run heavy browser/E2E suites, broad scenario or seed matrices,
  endurance runs, or prolonged automated browser-debug loops.
- Browser QA must be **strictly serial across the entire workspace/all lanes**:
  one browser session/job at a time, not one per agent. Coordinate through the
  same exclusive browser-test lock/queue (studio: `/tmp/ll-browser-qa.lock`).
- Close the browser, its pages, and its owned child processes/resources before
  the next check starts. Use cleanup/finally and timeout handling, including on
  failure. Do not start another browser to investigate a still-running one.
- Bound runtime and memory use. One multiprocess browser can itself exhaust a
  worker, so serialization alone is not sufficient. If a check stalls or causes
  memory pressure, stop that owned check gracefully, preserve its evidence, and
  report the limitation rather than escalating to a heavy suite. Do not blindly
  kill unrelated processes, restart/rebuild the worker, or change host/browser
  security settings to force a test through.
- Focused non-browser unit tests, typechecking, builds, and required GitHub CI
  remain appropriate. Record skipped/unavailable checks honestly; they are not
  passes, and known rendering/gameplay defects still need fixing.
