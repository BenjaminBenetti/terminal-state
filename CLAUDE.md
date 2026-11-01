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

## Textures — Codex for INITIAL sources; Meshy keeps its model maps (standing user rule, 2026-11-01, user-corrected)

User: "codex is to be used to generate all textures. Except for dynamic stuff ofc". Correction (2026-11-01): "Of course the meshy model
used meshy texture maps! Thats the whole point! You do codex -> meshy" — "Codex for initial texture generation!" — "Make sure this
doesn't happen again".

- **Codex is for INITIAL authored static image / texture / concept sources.** That covers ads, posters, signs, decals, labels,
  fabrics, material / surface artwork, concept art and the conditioning images given to Meshy. Use the existing owned Codex CLI's
  native image tool (`.claude/skills/image-delegation`): never hand-draw them in Canvas / SVG / Python / shader code, and never ask
  Codex to write drawing code instead of generating the image.
- **Downstream model output keeps its maps.** In the approved Codex → Meshy workflow, the texture / PBR maps Meshy generates are part
  of the model output: KEEP them as the model's runtime maps (re-encoded / packed through the normal derivative pipeline; raw originals
  stay private provenance). They are NOT a Codex-rule failure: no second Codex retexture / reprojection / replacement pass, no
  compliance hold, no extra art-approval gate. (This supersedes the round-4 follow-up wording that banned a new model's provider maps;
  that was a misreading — the Strainer's Meshy maps were restored.)
- **Dynamic textures are exempt and may stay code-driven:** runtime-generated or per-seed / per-run composited content (fictional
  brand names, headlines, menu lines, prices drawn over generated art), animated textures and effects, data textures (light fields,
  masks, noise, LUTs) and render targets.
- **Processing is not authoring.** Deterministic processing of approved or generated sources is fine: UV baking, crop / resize, format
  conversion, compression, channel packing, mips, PBR derivative maps. It is not a loophole for replacing generated art with
  hand-drawn art. There is no silent exception for new hand-painted textures.
- **Existing approved textures stay** unless a task actually replaces them.
- **The generation rules above still apply.** Paid generation (Meshy) and Codex image calls each need fresh explicit authorization with
  a budget / count. If Codex image generation or sign-in is unavailable, report the blocker; never substitute another generator, and
  never label code-drawn output as generated art.
- **Ambiguity goes to the user.** Ask the user before materially expanding or reinterpreting this rule; never invent an extra
  replacement or release gate from it.

## Props — core design rules (standing user rule, 2026-10-30)

Every new or changed prop must meet both affordance rules below (1, 2) and both authoring rules (4, 5: no baked loose
clutter, checked human scale). They are acceptance requirements for prop work, not
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
4. **Never bake loose items into furniture.** Removable loose items and clutter (beakers and lab glassware, monitors,
   keyboards, bread and other food, papers, books, tools, bottles, cups) are never part of a furniture model. Separate them
   (local mesh separation; no regeneration without approval) and place them as separate runtime props or loot items on
   the furniture's real support surface: seeded, supported, not floating or overlapping, so they move (rule 2) or can be
   taken. Permanent structural parts (handles, hinges, shelves, built-in fixtures) stay in the model and need not become
   pickups. A remaining baked case is listed as an explicit exception, never silently shipped.
5. **Real-world scale, checked beside a zombie.** Every new or changed prop is inspected in a rendered size comparison
   beside an actual runtime-scaled standing zombie: `node tools/asset-pipeline/props/scale-check.mjs --kind <kind>` (CPU
   render at the game's runtime fit; usage in `docs/prop-affordances.md`).
   - Record its dimensions (W×H×D) and grounded contact points (no floating or sunk base).
   - Size furniture by the furniture itself (work top, seat, carcass), never by a box that includes loose items on it
     (`--below` / `--exclude` give furniture-only bounds). Typical: desk / worktop 0.72–0.76 m, lab bench ~0.9 m,
     counters 0.9–1.0 m, chair seat ~0.45 m, doors ~2.0 m.
   - Look at the render: a bounding-box number or unit test alone is not the check. Never rescale the reference zombie
     (the game's 0.95–1.05) to make a prop look right.
   - A size change moves its footprint, collider, surface / slot heights and hinge transforms with the visual.
6. **Check it.** New props need:
   - focused unit tests for openability, contents theme, fit and the physics class;
   - the scale-check render beside a zombie (rule 5), viewed, with its dimensions and contact recorded;
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
