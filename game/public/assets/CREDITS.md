# Terminal State (formerly "The Last Line") — vertical slice credits and provenance

Prototype build. Nothing here is approved production art and **no commercial licence clearance is
asserted** for any generated source. Full per-file provenance: `assets/derivatives/*.json`.

## Engine and code
- three.js r186 (MIT) — https://threejs.org — bundled into the game script.
- cannon-es 0.20.0 (MIT, Copyright (c) 2015 cannon.js Authors) — https://github.com/pmndrs/cannon-es — ragdoll physics, bundled into the game script.
- Game code, procedural canvas textures (terrazzo, painted block, ballast, steel paint, crates,
  signs) and simple pickup/trim geometry: authored for this project. (Procedural WebAudio cues were retired in
  iteration 05; all sound effects are now Sound Lab clips — see Audio below.)

## Models and textures (runtime derivatives)
- Iteration 10: the held/world RIFLE, SHOTGUN and PISTOL models are user-supplied models (uploaded 2026-10-28; upload
  file names mention Meshy, but the generator, account, settings and licence are NOT verified and no clearance is implied).
  The game ships re-oriented, re-scaled, simplified derivatives with the embedded textures unchanged
  (derivatives/user-weapons-20261028.json). The earlier rifle/shotgun derivatives below stay in the repository unused.
- Knife (2026-10-30, the first melee weapon): a user-uploaded model (the user identifies it as a knife and authorized it
  for the game; the upload file name mentions Meshy, but the generator, account, settings and licence are NOT verified and
  no clearance is implied). The game ships a re-oriented, re-scaled (0.32 m), simplified derivative with its PBR textures
  resized to 1024 px (derivatives/user-knife-20261030.json; tools/asset-pipeline/weapons/build-knife.mjs). No generation.
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

## Office Space, gear and medical items (iteration 16)
- 25 models (gear: armored vest, chest rig, backpack, hard hat, boots, gloves; medical: leg splint, arm sling;
  office: desk, chair, filing cabinet, monitor, photocopier, water cooler, conference table, dead plant, reception
  desk, server rack, whiteboard, shelf; exterior: car wreck, rubble pile, ruined tower, ruined mid-rise, bus wreck)
  were generated with the user's Meshy account (Meshy T2.5, Smart Topology, text-to-3D preview + texture refine) under
  the user's authorization and API-key limit. Runtime derivatives were scaled, grounded and texture-downsized by
  `tools/asset-pipeline/props/build-office-iteration16.mjs`; per-asset provenance:
  `assets/derivatives/office-space-20261029.json`.
- 6 textures (office carpet, ceiling tile, cubicle fabric, office wall, ruined skyline panorama, window-glass grime)
  are native Codex image generations, downsized for runtime.
- Original native downloads and generation ledgers are kept outside the repository (studio reference task folder).
  Unapproved prototypes; no commercial clearance implied.

## Meshy T2.5 replacement of the locally generated game models (iteration 18)
- The game's locally generated (Pixal3D) props, consumable items, ceiling light, zombie bodies, garments and the
  rat-dog creature were regenerated with the user's Meshy account (Meshy T2.5, Smart Topology, image-to-3D, 2K PBR)
  under the user's authorization and API-key limit.
- Each model was conditioned on ITS ORIGINAL reference image (the exact earlier conditioning image, hash-verified).
  The one exception is the scavenger body: its original image was never retained, so its reference was recreated by
  one user-authorized Codex image generation, guided by a render of the existing model, and is labelled as recreated.
- Runtime derivatives (`*-t25.glb`) were fitted to the existing gameplay footprints and budgets by
  `tools/asset-pipeline/props/build-meshy-t25.mjs` and the character / creature rig pipelines.
  - Per-asset provenance, including the restore map to the previous files (Git commit `a7a646a`):
    `assets/derivatives/meshy-t25-*-20261029.json`.
  - The superseded files are removed from the current game and remain in Git history.
- Native downloads, generation ledgers and the reference mapping are kept outside the repository (studio reference
  task folder). Unapproved prototypes; no commercial clearance implied.

## Office overhaul: company tenant props and supporting models
- 58 models were generated with the user's Meshy account (Meshy T2.5, Smart Topology, text-to-3D preview + 2K PBR
  texture refine) under the user's authorization for this brief and its API-key limit:
  - 40 signature props for the 20 fictional office tenant companies (two per company);
  - 18 supporting models: executive suite, server room, lobby, leisure, a small plant, rooftop plant and a toilet.
- Two previews that produced the wrong object were replaced once each with identical settings (documented).
- Runtime derivatives were scaled to real size, oriented, grounded and texture-downsized by
  `tools/asset-pipeline/props/build-office-overhaul.mjs`; per-asset provenance:
  `assets/derivatives/office-overhaul-20261030.json`.
- Company names, logos and products are fictional. Native downloads and the generation ledger are kept outside the
  repository (studio reference task folder). Unapproved prototypes; no commercial clearance implied.

## Caliber ammo boxes (2026-10-30)
- Three ammo-box models, one per caliber (9mm carton, 5.56×45mm steel ammo can, 12-gauge shell carton), were generated
  with the user's Meshy account (Meshy T2.5, Smart Topology, text-to-3D preview + 2K PBR texture refine; 45 credits)
  under the user's task authorization and API-key limit. They replace the procedural ammo supply boxes.
- Runtime derivatives (`assets/models/ammo-*-t25.glb`) were oriented, scaled to pickup size, grounded and
  texture-downsized by `tools/asset-pipeline/props/build-ammo-boxes.mjs`. The ammo can's generated stencil read "516";
  it was corrected LOCALLY to "5.56" from the model's own stencil glyphs (not generator output). Per-asset provenance:
  `assets/derivatives/meshy-t25-ammo-20261030.json`.
- Native downloads and the generation ledger are kept outside the repository (studio reference task folder).
  Printed graphics are fictional AI designs. Unapproved prototypes; no commercial clearance implied.
