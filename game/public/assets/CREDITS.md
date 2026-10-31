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

<!-- BEGIN mall-track3-20261031 (build-mall-track3.mjs) -->
## The Eaton's Center (Track3): mall fixtures, furniture and loose stock

Generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's finite Track3 authorization; runtime derivatives built by `tools/asset-pipeline/props/build-mall-track3.mjs` (provenance: `assets/derivatives/mall-track3-20261031.json`). Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters are kept outside Git.

- `assets/models/mall-mall-cashwrap-counter.glb` — mall-cashwrap-counter (M01; Meshy tasks 01a18f6d-0dcf-75de-86cd-d84576b1a75b / 01a18f71-48fd-7138-94df-1f5403fcab78)
- `assets/models/mall-glass-display-cabinet.glb` — glass-display-cabinet (M02; Meshy tasks 01a18f6d-72c6-739f-94bd-cdf5ae046f1e / 01a18f71-6f33-701c-b77d-235c2c3bdcf0)
- `assets/models/mall-retail-gondola.glb` — retail-gondola (M03; Meshy tasks 01a18f7a-15fd-7304-9761-45b34ccca444 / 01a18f81-1919-7444-afb3-dd3d0c99b737)
- `assets/models/mall-retail-wall-bay.glb` — retail-wall-bay (M04; Meshy tasks 01a18f7a-3fcc-7122-9753-ef63d077d430 / 01a18f81-3e1f-7643-a5ac-aa4f9abab909)
- `assets/models/mall-garment-rail-round.glb` — garment-rail-round (M05; Meshy tasks 01a18f7a-665a-7297-b2af-d45268cd7688 / 01a18f81-62e0-729c-8b70-f3861b42fc17)
- `assets/models/mall-garment-hanging-group.glb` — garment-hanging-group (M06; Meshy tasks 01a18f71-e498-729d-bc23-760520baccb9 / 01a18f79-4edf-77ee-bbf5-65ff7db13cf6)
- `assets/models/mall-mannequin-full.glb` — mannequin-full (M07; Meshy tasks 01a18f72-06cc-774e-9cc5-9f377271aacd / 01a18f79-72f9-7425-b55c-652c56bb4af6)
- `assets/models/mall-clothing-wall-unit.glb` — clothing-wall-unit (M08; Meshy tasks 01a18f72-2fb1-77e1-a641-c8c5c4337d84 / 01a18f79-949e-7070-bc70-e5ed7b9b96c0)
- `assets/models/mall-bookstore-bookcase.glb` — bookstore-bookcase (M09; Meshy tasks 01a18f72-7be3-742c-be0b-466a25c30389 / 01a18f79-b875-70de-954f-0acae1a1ef34)
- `assets/models/mall-flat-screen-tv.glb` — flat-screen-tv (M10; Meshy tasks 01a18f72-a3c1-710a-a524-ad405bc13b6f / 01a18f79-e532-74f2-b439-2b677a227374)
- `assets/models/mall-pharmacy-dispensary-counter.glb` — pharmacy-dispensary-counter (M11; Meshy tasks 01a18f7a-aaee-76c8-8297-491c5388da82 / 01a18f81-8c0d-7678-9ee3-8594ec698ea6)
- `assets/models/mall-checkout-lane.glb` — checkout-lane (M12; Meshy tasks 01a18f81-b929-729e-9ee9-4f12d2ee97ee / 01a18f87-696a-7788-89cc-e4be7c6adecd)
- `assets/models/mall-produce-display-stand.glb` — produce-display-stand (M13; Meshy tasks 01a18f81-e930-7196-9e6d-2ca29d3c7beb / 01a18f87-9527-7351-ac8c-4be214ff79a3)
- `assets/models/mall-gun-wall-rack.glb` — gun-wall-rack (M14; Meshy tasks 01a18f82-10cd-77e2-94e6-52295d49fcec / 01a18f87-b89e-7077-bfa2-337e74525ea2)
- `assets/models/mall-glass-display-counter.glb` — glass-display-counter (M15; Meshy tasks 01a18f82-379f-73f5-af50-fe1995b36f69 / 01a18f87-db71-728b-afd1-07fa5805b91c)
- `assets/models/mall-outdoors-plank-shelving.glb` — outdoors-plank-shelving (M16; Meshy tasks 01a18f82-5d0e-719a-aaad-bcbd385e4abe / 01a18f88-0085-7658-ad0b-d67bb495d3c3)
- `assets/models/mall-mall-kiosk-cart.glb` — mall-kiosk-cart (M17; Meshy tasks 01a18f88-2bcf-72f5-8758-11059c6ff548 / 01a18f92-42ce-709c-918c-fdb5016d9f84)
- `assets/models/mall-storage-tote.glb` — storage-tote (M18; Meshy tasks 01a18f88-517f-72d0-bb0a-953bc8e545cc / 01a18f92-66c8-732e-a8b8-507680e37dfa)
- `assets/models/mall-shoe-wall-display.glb` — shoe-wall-display (M19; Meshy tasks 01a18f88-76dc-734f-b861-ca2f46587d80 / 01a18f92-8c09-74ba-ade1-55e0a35bd7cb)
- `assets/models/mall-food-court-table-set.glb` — food-court-table-set (M20; Meshy tasks 01a18f88-a19d-775f-bbec-678a2f0e8ca0 / 01a18f92-b352-724e-813c-554c1a771428)
<!-- END mall-track3-20261031 -->
