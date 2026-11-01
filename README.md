# Terminal State

**Terminal State**, formerly **The Last Line**, is a desktop first-person browser
survival prototype set in a procedurally generated North American subway station.
Explore, scavenge supplies, manage your inventory and fight the infected.

This repository contains the **iteration 13** game source and all cooked runtime
inputs (later iterations add the user-supplied weapon models of iteration 10 and new
Sound Lab cues of iterations 11-12, each with provenance under `game/public/assets/derivatives/`).
Portable repository packaging and the CI pipeline are separate from gameplay.
This is an early keyboard-and-mouse prototype, not a finished game.

## Build and play

Use **Node.js 22.16.0** (the verified worker and CI version) and npm:

```sh
npm ci
npm run build
npm run preview
```

Open **http://127.0.0.1:4180/**. For development, `npm run dev` serves
**http://127.0.0.1:5173/**. Build output is `dist/game/`; serve it over HTTP, not
`file://`. Relative asset paths support deployment under an app subpath.

`npm ci` needs access to locked package sources; Puppeteer may download a browser.
For headless build/unit-test environments use `PUPPETEER_SKIP_DOWNLOAD=true npm ci`.
After install, normal build/play needs no model service, API credentials, generation
calls or `reference/` mount. Models, textures, MP3s and provenance are checked in;
`npm run build` never regenerates them. No Git LFS setup is required.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run game:dev` | Develop the game |
| `npm run build` / `npm run game:build` | Typecheck + static game build |
| `npm run preview` / `npm run game:preview` | Preview the build |
| `npm test` / `npm run game:test` | Game unit tests |
| `npm run ci:check` | Check the pinned workflow/build contract |
| `npm run ci:test` | Packager rejection/manifest tests + dynamic-app wrapper tests |
| `npm run ci:package` | Validate and package an existing build locally for QA |
| `npm run pages:build` / `npm run pages:check` | Generate / validate the reference website in `dist/pages/` |
| `npm run game:e2e` | Historical browser playtest; environment caveats below |

## GitHub main → CI artifact → Everything

Work in this Git repository. **After checks, commit and push changes to GitHub
`main`**, preserving existing history; no feature branch requirement or force
push. See [AGENTS.md](AGENTS.md). The workflow
[`.github/workflows/game-build.yml`](.github/workflows/game-build.yml) runs on pushes
to main, on **pull requests into main** (check `build`, required before merging) and
on manual dispatch. It uses Node 22.16.0, `npm ci` (browser download off). Jobs run in
parallel: six full-suite Vitest shards (`test (shard i/6)`, `vitest --shard`), `checks`
(workflow/packager validators, `ci:test`) and `bundle` (`npm run build` = typecheck + build,
then the portable CI packager; no tests). The required `build` check is a lightweight
aggregate that always runs after all of them and fails unless every one succeeded and the
shards' executed file lists cover the whole test inventory exactly once
(`tools/release/test-shards.mjs`). All third-party actions are pinned to verified
official-repository commit SHAs. Pull-request runs validate only: release artifacts
are uploaded only by runs on main itself (by `bundle`), and are a release only when that
commit's whole workflow, `build` included, succeeded.

A successful run on main uploads **`terminal-state-web-<full commit SHA>`**, containing:

```text
site/             # self-contained static game; publish this directory only
manifest.json     # commit, every site path/byte count/SHA-256, exclusions, size report
```

It also uploads `terminal-state-manifest-<full commit SHA>` with the same manifest
for independent inspection. The manifest hashes **site files**, not the Actions
ZIP itself. It deliberately has no absolute workstation paths or timestamps.

**Main must download the successful GitHub Actions artifact for the intended main
commit, verify commit/file count/bytes/all hashes and inspect the artifact before
publishing its `site/` through Everything. Never publish local build output.** For
the initial v7 migration, additionally compare every one of the expected **472
site files / 92,653,680 bytes** to the independently backed-up reviewed v7 release.
The pipeline does not auto-deploy, call Everything APIs, store deploy secrets or
run generation. A CI failure is a release blocker, not permission to substitute a
local build. GitHub artifact access follows this private repository's permissions.

`tools/release/package-ci.mjs` is the portable release path. It verifies every
public input against the checked-in path/size/hash allowlist, rejects unexpected
paths/types, symlinks, files over 25 MiB each, more than 1,000 files, source/maps/archives/secrets and external
or root-absolute runtime asset URLs, and preserves every copied byte. It omits
`assets/models/*.glb` only when no bundled JS/HTML contains that exact relative
path: the same explicit reference check as the legacy release helper. Currently
nine obsolete derivatives are omitted; **all nine remain tracked build inputs**.
It checks runtime model references have actual packaged files. Input/policy
changes require deliberate review. See the script's limits and tests; this is
not a general JavaScript sandbox or a licensing audit.

**There is no total-size cap** (user decision 2026-10-31: quality and playability come first; the earlier 150 MiB total
limit was removed with no replacement). The total is reported instead: the manifest has `totalBytes`, `checks.maxTotalBytes:
null` and a `report` (bytes / files by type, model and texture bytes by path family — `mall-*` mall-only, `office-*` office
catalogue, shared — the largest files and the excluded bytes), and the CI log prints the same plus an advisory line saying
whether the site fits the existing static host (200 MiB = 209,715,200 B). That advisory is not a CI limit. The per-file
and file-count guards and every allowlist / provenance / path / URL / symlink / secret check above are unchanged.
When the official artifact is larger than the static host accepts, Main serves the **same official artifact** through a
new dynamic Docker app built from [`tools/deploy/dynamic-app/`](tools/deploy/dynamic-app/CONTRACT.md) at the same commit
(rootless zero-dependency Node static server; the existing playtest app stays). The game loads each level's lazy models
and textures behind that level's loading screen and releases another level's own art on travel
(`game/src/assets/levelAssets.ts`), so a bigger package does not mean a bigger browser working set.

## Reference website (GitHub Pages)

A public reference site, a landing page plus a **loot explorer** and an **Enemy spawns** section, is generated from the game
source and published with GitHub Pages at **https://benjaminbenetti.github.io/terminal-state/**. The project path is expected;
every link on the site is relative. The source repository stays private: the site publishes only generated reference pages
and data, never the game or its source.

- **Generated, not hand-written.** `tools/pages/` builds one `LootReference` object from the real exported game values
  (`buildLootReference`, see [docs/loot-reference.md](docs/loot-reference.md)). It then renders static HTML/CSS/JS from that
  object only. Levels, tables, items and special sources appear automatically. A loot source the generator does not know
  fails the tests instead of vanishing.
- **Enemy spawns.** `buildEnemyReference` (`tools/pages/enemyReference.ts`, see [docs/enemy-spawns.md](docs/enemy-spawns.md))
  reads the per-level spawn profiles the real generators use. The section shows a levels overview (`enemies/index.html`), one
  profile page per level (`enemies/<level>.html`: generation contexts with exact count ranges and E[count], the family pool
  with conditional shares and denominator, the zombie type split, baseline placement rules, room modifiers, a labelled sampled
  census and tuning locations), every family (`enemies/families.html`) and the units (`enemies/how-to-read.html`). The data
  is published as `data/enemies.json`. A level, context, family or room key without its rendered place fails the check.
- **Local build.** `npm run pages:build` writes `dist/pages/` (git-ignored, separate from `dist/game/`). Vite SSR-bundles the
  generator into a temporary module under `node_modules/.cache/`, so no new dependency is needed. The output is deterministic
  for a fixed source. Every page shows the source commit (`GITHUB_SHA`, else `git rev-parse HEAD`, else `local`) and the loot
  and enemy data digests.
- **Checks.** `npm run pages:check` validates `dist/pages/` and proves it is byte-identical to a fresh build. It checks the
  output allowlist (html / css / js / json and one authored svg; no source maps, TypeScript, game assets or dotfiles), leaks
  (workspace paths, `reference/`, env files, key-like secrets), links (all internal links and #fragments resolve; no
  root-absolute or unlabelled external URLs; the site navigation of every page reaches every section), page structure,
  enemy-section coverage against `data/enemies.json` and the `data/manifest.json` hashes and data digests.
  `npm run pages:test` runs `game/tests/pages-output.test.ts` and `game/tests/loot-reference.test.ts`. Both also run in the
  normal `npm test`.
- **Preview.** `npm run pages:preview` serves `dist/pages/` at http://127.0.0.1:4190/terminal-state/ (the published
  sub-path). Opening `dist/pages/index.html` directly also works.
- **Publication.** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs separately from the game build. Its
  `pages-build` job runs on every push and pull request into main and on manual runs, with a read-only token: `npm ci`, build,
  check, tests. It uploads the Pages artifact **only for main**. The `pages-deploy` job runs only for pushes / manual runs on
  main, after `pages-build` passed for that exact commit. It is the only job with `pages: write` / `id-token: write`, uses the
  `github-pages` environment and one non-cancelling `pages-deploy` concurrency group. It skips the deployment if main has
  already moved past the commit, so an older run never overwrites a newer site. **Pull-request builds never publish.**
  The official `configure-pages`, `upload-pages-artifact` and `deploy-pages` actions are pinned to commit SHAs
  ([docs/ci-action-pins.json](docs/ci-action-pins.json); `npm run ci:check` verifies both workflows).
- The game workflow, its required `build` check, the game artifact and `package-ci` are unchanged by the site. A merge that only
  changes the site does not need a game release.

## Playing and scope

WASD move · mouse look · Shift sprint · Space jump · C crouch · left click fire/use
· right click aim · R reload · E interact (hold E on a grounded backpack to wear it) · 1–5 / wheel quick slots
· ~ melee slot (knife) · 6 backpack · G throw (grenade slot) · Q gas mask on / off · Tab/I inventory · H heal · F flashlight · M mute · Esc pause
· Ctrl+Shift+P performance overlay.
Drop an item by dragging it out of the inventory panel.

**Beyond the Station** (Track 2): the tracks no longer end at a black wall. Drop into a track bed and follow it into a
finite, curving concrete tunnel that ends at a rubble heap, a bulkhead or a closed gate. About one level in five (a 20 %
seeded roll per level, on every level type) also hides one or two **service annexes**: cramped, dark back-of-house rooms with
pipes, steam vents, dying lights, a few zombies and some picked-over scavenging. You reach them through a side door in a
tunnel, or a service hatch in a track-bed wall. Graffiti arrows point the way only where a route really exists, and the bed
ladders take you back up. See
[docs/track-extensions.md](docs/track-extensions.md).

**Office Space overhaul** (task office-overhaul-20261030): every office floor 2–8 is leased to one of **20 fictional
companies** (a different seeded mix each run; sometimes one company takes two floors), each with its own floor program,
palette, signage and two signature Meshy props — a law firm's library and Lady Justice, a game studio's arcade lounge,
a biotech lab's biohazard fridges, a bubblegum brand's gumball machines and so on; the neutral lobby has a tenant
directory. Offices have office finishes (not station tile), executive suites and real server rooms; the city outside
sinks into a heavy green fog. The station connects to the lobby through a broad transit hall with two (stopped)
escalators, the elevator is a full-size car with buttons you aim at and click (or E), a ladder on floor 8 climbs to
the **roof**, bathroom stall doors open (sometimes there is something in the toilet), flares stack to 10 in a
dedicated grenade slot thrown with G, and enemy moans carry only along a reasonable walking distance.

Iteration 13 moves rendering to three's **WebGPURenderer** with TSL node shaders (WGSL on WebGPU; the same shaders
as GLSL on its WebGL 2 fallback, labelled "WebGL2 fallback" on the title screen and HUD; `?renderer=webgl2` forces it).
The volumetric fog is a GPU march that stays put when you leave and come back (it drifts slowly through the world
instead of re-rolling), is a little thinner overall with clear and dense areas, and is lit by fixtures, the
flashlight and flares. Iteration 12 adds a decayed, foggier station (30 years of neglect on walls/floors/ceilings, patchy drifting
volumetric fog), a flashlight battery with a dim body glow, throwable red flares (G since the office overhaul; T originally), enemies drawn to light, twice
the enemies and far scarcer non-ammo supplies placed by room purpose. Iteration 8 adds stacked station levels (an upper concourse over the platforms and
tracks, a lower service level beneath them, stair cores and light wells), zone-specific
worn and broken wall detail, composed prop clusters, openable bins/lockers/drawers and
other storage, and physical 3D shelf stock that scatters when shot. Iteration 7 added
expanded prop placement/dynamics, fitted zombie wardrobes, updated weapon/consumption
presentation and bundled audio updates. Detailed
systems, controls, URL options and performance notes are in
[game/README.md](game/README.md). A new station is generated on each load. No
persistent saves, train travel or touch controls. Performance/visual rough edges
and browser pointer-lock restrictions remain; desktop browser QA is separate from
unit tests. The original game README retains some historical tooling commands.

## Included inputs and optional historical tooling

- `game/src/`: TypeScript gameplay code and generated catalogs.
- `game/public/assets/`: **tracked build inputs**, including all cooked GLBs,
  images, MP3s, credits and derivative provenance. Generated ≠ disposable.
- `game/tests/`, `game/e2e/`, `tools/qa/`: tests and diagnostic scripts.
- `tools/asset-pipeline/`, `tools/audio-pipeline/`: historical authoring utilities.
- `docs/history/`, project skills: nonoperative history and asset-method guardrails.
- `docs/meshy.mcp.json` + `docs/meshy-mcp.md`: the Meshy MCP server entry for Claude Code's project `.mcp.json`
  (pinned `@meshy-ai/meshy-mcp-server@0.6.6`, key only from `MESHY_API_KEY` in Claude Code's environment, never
  committed). Not used by the build or CI, and no paid generation is authorized by it.
- `.devcontainer/`: optional plain Node 22 environment; no assistant install,
  injected credentials, shared login or Fleet-specific mounts.

Raw high-poly masters, native conditioning images, original WAVs/sidecars and the
external `reference/` tree are **not** included. Preserve/check them in an
independent durable backup. Source-control provenance hashes are not raw backups.
No generation authorization is implied by copying this repo or its old task docs.

`assets:build` and authoring utilities need external raw masters/history and may
retain historical service addresses. Do not run generation controllers without
fresh authorization. `board`/`doctor` need the separate board/authoring environment.
Legacy `game:release` still requires the unavailable board model map and retains
its forbidden-hash guard unchanged; `game:backup` retains external-path assumptions.
Neither is invoked by normal build or CI. Browser/e2e scripts retain Firefox/Xvfb
assumptions and need separate browser/system setup. No dependency upgrade or asset
regeneration is part of this migration.

## Licensing

**No blanket license is granted**, including MIT or production/commercial clearance.
Third-party assets and dependencies retain their own terms; review them before
redistribution or production use. See [credits](game/public/assets/CREDITS.md),
[audio notice](game/public/assets/audio/NOTICE.md), and
[provenance](game/public/assets/derivatives/). Bundled audio records conditional
prototype status under Stability AI Community License and Gemma terms. Historical
unapproved/not-game-ready flags remain as recorded. This is not a licensing audit.
