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
