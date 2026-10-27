# Subway game workspace — read first

You are helping the user and Patch make a static-browser, first-person subway survival game. Working title **The Last Line**, not a final name. This is a new project workspace, NOT an instruction to immediately start implementing the game.

## Required orientation, for Claude Code and Codex
1. Read `reference/design/VISION.md` for the user's established requirements and open questions.
2. Read `reference/design/FIRST-ASSET-PASS.md` for the intended FIRST task: art direction and core-asset planning with the user.
3. Read `reference/design/ASSET-PIPELINE.md` and `reference/assets/masters/zombie-pixal3d.metadata.json` for the proven-by-user image-to-3D route and the unoptimized example.
4. Read `reference/design/BOARD-WORKFLOW.md`, then inspect the real board source, illustrations and catalog in `reference/vision-board/`.
5. Read `reference/manifest.json` for live app links, checked-out releases, provenance and last-sync state.

## Shared reference, not stale copies
`reference/` is a Fleet-mounted, shared project folder. It maps to `/workspace/shared/subway-game-reference` for Patch. All instances in this fleet receive the same reference at `/workspaces/subway-game/reference`. Its board and design text are real files available without API/browser credentials. The reference folder has its OWN local Git history; the game repository ignores its mounted contents.

Keep approved decisions in the design docs AND the visual board. The board browser scratchpad is localStorage, not a shared source of truth. Do not assume a local edit has been published. Patch publishes through app tools and verifies the live page. Keep the board illustrative, interactive and concise, not a wall of prose.

Live board: https://apps.cluster.bbenetti.ca/subway-concept/
Asset guide: https://apps.cluster.bbenetti.ca/subway-asset-lab/
Model inbox: https://apps.cluster.bbenetti.ca/subway-asset-drop/

## Guardrails
- Contemporary, gritty, neglected **North American** subway. Not Soviet, post-nuclear, or gas-mask-defined.
- Preserve the safe, walkable train and persistent procedural network. Do not invent train raids, durability, economy, crafting rules or other undecided mechanics as facts.
- Asset generation / art direction / core-asset references come BEFORE broad gameplay implementation. Engine choice, scale conventions, rig standard and asset budgets still need deliberate decisions.
- Preserve the uploaded high-detail zombie master. Work on derived copies only, outside `reference/assets/masters/`.
- No GPU is provisioned in this worker. No Torch/model-weight downloads, user-machine GPU jobs, old inference-server calls, paid image services, new public exposure or driver/memory changes without the user's approval.
- Patch does not currently have a direct image-generation tool in chat; the user generated the zombie reference in web ChatGPT. Each agent must verify its own available tools, and never portray a procedural render or placeholder as a real AI generation.
- Keep model/code/art licenses and photograph attributions. An evaluation priority of quality does not grant blanket commercial rights.
- No GitHub repository or remote exists yet. Do not publish/push/create a remote without asking.
- Claude/Codex authentication lives in Fleet-managed shared login mounts OUTSIDE this project. Never copy tokens, login codes, OAuth URLs with authorization codes, credentials or session dumps into Git/docs/assets.
- Do not use bypass-permission/YOLO flags as a substitute for normal approvals.
- Coordinate file ownership before two agents edit the same files. Read latest state; don't overwrite other work.

## Useful commands
`npm run doctor` — verify reference paths, board release and master SHA-256, plus installed tools.
`npm run board` — serve a LOCAL copy of the visual board on 127.0.0.1:4173, not a public deployment.

Long worker tasks must finish with an atomic completion receipt in `/tmp/everything-tasks/<fresh-task-id>/done.json` (write .tmp then rename), including task, succeeded/failed status, exitCode, one-line summary and report path. Patch assigns a fresh task ID and monitors it. Do not reuse an old receipt.

## Standing asset-method rule — 2026-10-24

Read reference/design/ASSET-METHOD-RULE.md before choosing a reconstruction method. Simple walls/slabs/flat signs and other primitive-based forms should use manual/procedural geometry with controlled dimensions/thickness and textures, not AI-generated depth. Research stronger 3D models for genuinely complex props (currently bench/light), including manual/hybrid alternatives. Research does not authorize inference, downloads, paid services or external asset uploads. Preserve all native candidates/history; only Patch publishes.


## Studio setup status — 2026-10-25

This workspace is setup only. The prior full instructions are preserved at `docs/history/AGENTS.before-studio-20261025.md`. Current task instructions supersede historical authorization and release numbers in reference documents. Board38 has 17 cards, 16 ready GLBs and a paused door; individual flags remain unapproved/gameReady false. User enthusiasm does not formally approve models.

`npm run board` / `npm run dev` now serves the packaged **read-only Studio snapshot** from `public/vision-board`, never canonical `reference/vision-board`. All model routes resolve through the local map; no API authentication/proxy/fallback or writes. Keep catalog URLs, source parents, hashes, credits, 13 station concepts, train visuals and lazy/max-one viewer checks. Only minimal notice/write-disable edits to packaged UI are permitted. Main supplies binary/package data and owns backup, deletion and publication.

Claude primary: `claude-opus-5-5`, xhigh, project config only. Codex model unspecified; do not pin one. New image generation uses actual Codex native imagegen when available and freshly requested; CLI image attachments are inputs, not generation. See CLAUDE.md and project skills. Do not change shared settings/authentication, weaken permissions, or create a remote/commit/push. Future GitHub follows the first vertical slice. Engine and slice decisions remain open. All historical generation authorizations are consumed; no new calls, downloads, host changes or startup hooks.

## Vertical slice commission — 2026-10-25 (task studio-vertical-slice-20261025-01)

The user commissioned the **first playable browser vertical slice**; this supersedes the setup-only hold for that slice only. Claude implements; Patch coordinates and publishes the static app via Everything tools. The slice: fresh random station per page load (platform + track bed, passages, fare hall, rooms, service corridors, closets), rigged/animated zombie derivatives (body + coat), both guns, five-slot hotbar + backpack, pickups, death/restart. No saves/persistence, no train, no station travel, no remote/commit/push. No new image or AI-3D generation is authorized; existing masters stay untouched and unapproved.

Game source: `game/` (Vite + TypeScript + three, locked in `package-lock.json`). Runtime derivatives: `game/public/assets/` with provenance in `game/public/assets/derivatives/`; CPU pipelines in `tools/asset-pipeline/`. Commands: `npm run game:dev`, `game:build` (static, relative base, `dist/game/`), `game:test`, `game:e2e` (Firefox on user-space Xvfb; Chromium cannot sandbox in this container), `assets:build`, `game:release`, `game:backup`. `npm run board`/`npm run dev` still serve the read-only board snapshot. See `game/README.md` and `reference/tasks/vertical-slice-20261025/REPORT.md`.
