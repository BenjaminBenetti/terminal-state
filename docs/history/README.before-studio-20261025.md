# Subway game studio

A dedicated scratch Git workspace for our browser subway-survival game. Working name: **The Last Line**.

## Start here
- Agent instructions: [AGENTS.md](AGENTS.md), automatically used by Codex; [CLAUDE.md](CLAUDE.md) imports the same instructions for Claude Code.
- Shared design brief: `reference/design/VISION.md`.
- First planned task: `reference/design/FIRST-ASSET-PASS.md` (art direction + core assets, not yet an approved production backlog).
- Editable illustrated board: `reference/vision-board/`; live https://apps.cluster.bbenetti.ca/subway-concept/.
- Provenance, live app versions, source-asset hashes: `reference/manifest.json`.
- Original uploaded GLB: `reference/assets/masters/zombie-pixal3d.glb`. Keep unchanged; put derivatives in `assets/derived/`.
- Local Pixal3D source-kit reference: `reference/tools/pixal3d-asset-lab/`. Generation runs on the user's AMD machine, not this worker.

`reference/` is a shared Fleet mount, not duplicated into this Git repo. It has its own local Git history for the design docs/board; large binary masters and local runtime caches are excluded from Git. This means future agents see current shared reference files rather than only a chat summary.

## Local checks
```bash
npm run doctor
npm run board
```
The preview binds localhost:4173. The published board is separate; changing local files does not update the public app automatically.

Claude Code and Codex are installed with Fleet-managed persistent login mounts. Patch will guide the first interactive login. Do not store credentials in the project.

No game engine has been selected, no gameplay scaffold created, and no GitHub remote created. Next: finish both logins, then work together on the core-asset/art-direction pass and update the board.
