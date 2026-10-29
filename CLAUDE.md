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
