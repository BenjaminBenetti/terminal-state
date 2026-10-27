@AGENTS.md

Use Claude Opus 5.5 (`claude-opus-5-5`) at xhigh as the primary project assistant. Project `.claude/settings.json` sets both; do not downgrade or add a fallback. Preserve project permissions and Fleet-managed authentication/global settings. The existing settings.local.json is a shared mount: never rewrite it to fix project configuration. Main verifies effective configuration independently.

For NEW IMAGE GENERATION explicitly requested by the user, delegate to Codex's actual native `image_generation` / `imagegen` capability when available. Claude is not the image generator. Codex CLI `-i` / `--image` attaches reference images; it does not generate them. If native generation is unavailable, report the tool blocker; do not substitute SVG, Pillow, procedural renders or another provider silently. Existing images report native `image_gen__imagegen` provenance; model ID is unknown when unreported. Reuse existing references now; no calls are authorized by setup.

Use `.claude/skills/local-3d-assets/SKILL.md` for future explicitly authorized local 3D work. Never execute historical controllers or revive consumed budgets. No game implementation is authorized by workspace setup.

Exception, 2026-10-25: task studio-vertical-slice-20261025-01 authorizes the first playable vertical slice in `game/` (see AGENTS.md). It authorizes no new image/AI-3D generation, host changes, remotes or pushes.

## Sound effects: Sound Lab only (user rule, 2026-10-26)

User: "all sound effects must be generated with the sound lab."

- **Source:** the user's local Last Line Sound Lab CPU at http://10.0.0.59:7871/ (Stable Audio 3 Small-SFX). It is an offline asset-generation tool. Generate real clips there, then bundle them into the static game as local, relative files.
- **Provenance:** keep each raw WAV unmodified, along with its sidecar: prompt, seed, steps/CFG, model revision and profile, license status and hashes. Derivatives (trim, fade, format conversion, loudness leveling, loop points) are allowed as new files that name their source clip.
- **Not allowed without an explicit user exception:**
  - calling the Sound Lab or any other audio service from the game or browser at runtime
  - hosted audio generators
  - downloaded or stock SFX libraries as substitutes
  - procedural synth or noise as an SFX source or fallback

  If a clip is missing, report the gap rather than filling it quietly.
- **Allowed:** Web Audio playback, spatialization, mixing, reverb and filtering of Sound Lab clips. These process clips; they are not a source.
- **Authorization:** the user authorizes generating all SFX the game needs once the Sound Lab is reachable. Run one job at a time, and never cancel or override the user's jobs.
  - Check reachability first with `GET /api/status`.
  - A 403 `Unexpected Host header.` means the LAN patch has not been applied yet. See `reference/tasks/sound-lab-lan-access-20261026/REPORT.md`.
  - Never spoof Host headers or work around the guard.
- **License:** Stability AI Community License plus Gemma terms. Sidecar license status is conditional prototype status, not production or commercial clearance.
