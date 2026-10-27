# Subway game Studio

Workspace setup and a portable, read-only concept board snapshot. Working title: The Last Line.

**2026-10-25: first playable vertical slice** — `game/` holds a static Three.js first-person slice commissioned by the user (task studio-vertical-slice-20261025-01). `npm ci`, then `npm run game:dev` (http://127.0.0.1:5173/) or `npm run game:build` → `dist/game/`. Details, controls and test commands: [game/README.md](game/README.md). The setup text below describes the board snapshot and is otherwise unchanged.

Run `npm run board` (or `npm run dev`) with Node 22+, without installing dependencies. Open http://127.0.0.1:4173/vision-board/. The preview serves only `public/vision-board/`, mapped local GLBs and frozen reviews. It never proxies Everything API or sends review writes. Missing package files are reported as unavailable; Main supplies them. Stop a foreground preview with Ctrl-C. If Main starts session `studio~board-preview`, stop it with `tmux kill-session -t studio~board-preview`.

The package is board38: 17 cards, 16 ready model candidates, paused door, 13 station concepts, train upgrade visuals, credits and original MV input ZIPs. Ready means available for inspection, not approved or game-ready. Save/review editing is disabled; the scratchpad remains personal browser localStorage. `PACKAGE.json`, `local-model-map.json` and `reviews-snapshot.json` describe the local copy. Catalog model URLs and source/hash bindings stay intact.

Claude Code uses project-only `claude-opus-5-5` with `effortLevel: xhigh`. Existing shared login mounts and local permissions remain untouched. Codex uses its existing profile with no model pin. Main verified the exact Claude model through a no-tools request; setup only checks configuration and CLI presence. See [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).

The vision is first-person browser survival in a contemporary North American subway with maintained neglect: a procedural **persistent** network and one **safe, walkable** train mobile base. Dark tunnel travel masks loading. Maps describe prospects, danger and connections, not exact loot. Station concepts and train upgrades remain proposals. Engine, vertical-slice scope, scale, rigging, asset budgets and production readiness remain undecided. GitHub is wanted after the first vertical slice; no remote, commit or push is part of setup.

`reference/` is a persistent shared Fleet mount with canonical design, board, assets and provenance; do not edit it during setup. Main owns publication, independent backup and worker cleanup. Original instructions are preserved under `docs/history/`. Keep original masters and historical candidates; preserve licenses and image provenance. Large binary tracking/LFS is deferred; local GLBs and ZIPs remain present but ignored by Git.

Prefer existing references. Future image or local 3D generation requires a fresh asset/count authorization; old task budgets are consumed. No generation, inference, downloads or desktop changes run on startup. See project skills for the guarded workflow. `npm run doctor` is the retained shared-reference diagnostic, not a required full audit.
