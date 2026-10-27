# The Last Line — vertical slice credits and provenance (working title)

Prototype build. Nothing here is approved production art and **no commercial licence clearance is
asserted** for any generated source. Full per-file provenance: `assets/derivatives/*.json`.

## Engine and code
- three.js r186 (MIT) — https://threejs.org — bundled into the game script.
- cannon-es 0.20.0 (MIT, Copyright (c) 2015 cannon.js Authors) — https://github.com/pmndrs/cannon-es — ragdoll physics, bundled into the game script.
- Game code, procedural canvas textures (terrazzo, painted block, ballast, steel paint, crates,
  signs) and simple pickup/trim geometry: authored for this project. (Procedural WebAudio cues were retired in
  iteration 05; all sound effects are now Sound Lab clips — see Audio below.)

## Models and textures (runtime derivatives)
- Zombie body + coat ("Last-shift body" / "Last-shift coat"), rifle ("Kept running"), shotgun
  ("Old reliable"), bench, ceiling light, tall and low cabinets: concept images made with native
  Codex/ChatGPT image generation (model not reported), reconstructed to 3D locally with Pixal3D
  (pixal3d.cpp, MIT; Pixal3D/TRELLIS.2 weights MIT per publisher; DINOv3 encoder under the DINOv3
  License). The game ships simplified, re-textured, re-oriented derivatives only. The zombie rig,
  skin weights and animations are new, approximate, hand-authored procedural keyframes (no mocap).
- Iteration 02: turnstile/fare gate and maintenance supply crate — concept images made with native
  Codex image generation (model not reported), reconstructed locally with the Pixal3D F16 single-view
  route (same licences as above), then simplified/re-oriented to runtime derivatives
  (`assets/derivatives/props-iteration02.json`). Cabinet doors and the crate lid are split from the
  meshes at runtime (approximate partition, authored dark interiors).
- Iteration 03: concession stall, vending machine, steel shelving unit and seven consumables (water,
  cola, orange juice, chocolate bar, potato chips, canned beans, instant noodles) — concept images made
  with native Codex image generation (model not reported; all labels are fictional AI designs, no real
  brands), reconstructed locally with the Pixal3D F16 single-view route (same licences as above), then
  simplified/re-oriented/re-textured to runtime derivatives (`assets/derivatives/props-iteration03.json`).
- Iteration 04: transit-station trash can and four modular shop building blocks (service counter,
  glass-door drinks cooler, countertop food display case, stainless back-counter with griddle/fryer)
  — concept images made with native Codex image generation (model not reported) from straight-on
  front views, reconstructed locally with the Pixal3D F16 single-view route (same licences as above),
  then simplified/re-oriented/re-textured to runtime derivatives (`assets/derivatives/props-iteration04.json`;
  cooler/display glass shows the project's own conditioning image projected onto the pane). No real
  brands or lettering.
- Iteration 05 (props): the drinks cooler and countertop display case now ship as open-front hybrids
  (`shop-cooler-open.glb`, `shop-display-open.glb`): the iteration-04 reconstructed exterior with the
  projected picture and opaque pane removed, plus project-authored interior, wire shelves/trays,
  procedural textures and transparent glass. Purpose-specific props (hot-dog cart, janitor cart,
  magazine rack, electronics display unit, weapons rack cabinet) — concept images made with native
  Codex image generation (model not reported) from straight-on front views, reconstructed locally with
  the Pixal3D F16 single-view route (same licences as above), then simplified/re-oriented/re-textured
  to runtime derivatives (`assets/derivatives/props-iteration05.json`); each is listed there only once
  its derivative exists. No real brands or lettering.
- Tiled wall, platform slab + safety edge, ceiling, tunnel panel and station sign: original
  procedural environment kit drafts (project-authored geometry/textures, DejaVu Sans Bold font on
  the sign under the Bitstream Vera licence terms retained in the reference kit).
- All sources remain unapproved / gameReady: false in the project catalogue; this slice uses them as
  a prototype.

## Audio (iteration 05)
- Every sound effect is a derivative of a raw clip generated with the user's local Last Line Sound Lab CPU 0.1.0
  (Stable Audio 3 Small-SFX, w8a8). Powered by Stability AI. Stability AI Community License + Gemma Terms of Use;
  conditional prototype status, not production or commercial clearance. Details: `assets/audio/NOTICE.md`,
  per-file provenance `assets/derivatives/audio-iteration05.json`. Room reverb impulse responses are computed in
  code and only process these clips (never played as a sound source).

## Zombie variants (iteration 05)
- Bodies: Last-shift (existing), Courier and Station agent (new: native Codex image → local F16 SV), Masked scavenger
  (the user's original uploaded zombie master, reused — not newly generated; re-posed from T- to A-pose). Outfits:
  coat (re-derived from the existing coat), hi-vis, hoodie, blazer, puffer, trench (new: native Codex image → local
  F16 SV). Auto-rigged and fitted per body by the project's CPU pipeline; provenance
  `assets/derivatives/zombie-variants.json`. Unapproved prototypes, gameReady false.

## Zombie wardrobe (iteration 06)
- Rebuilt as a slot wardrobe (upper / lower / head / face) by `tools/asset-pipeline/zombie/build-wardrobe.mjs`;
  summary and exact counts `assets/derivatives/zombie-wardrobe.json` (supersedes zombie-variants.json).
- New sources (native Codex image -> local F16 SV, iteration-06 Lane G ledger): base-layer bodies "Heavyset man" and
  "Tall woman" (generated wearing an opaque tank top / t-shirt + boxer briefs / bike shorts + socks), upper flannel
  shirt and cable-knit sweater, lower cargo pants / jeans / slacks, head hard hat / cap / beanie, face full-face gas mask
  and half-face respirator (loose strap loops trailing behind both masks trimmed in the derivative).
- The reused scavenger (original upload) was re-derived (repose v2, proximity arm skinning, arm-torso bridge trim,
  rigid mask filter) to remove sheet-like webbing in motion; its built-in hood and mask fill its head/face slots.
  Unapproved prototypes, gameReady false; no commercial clearance implied.
