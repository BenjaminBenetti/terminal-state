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
- `assets/models/mall-try-on-ottoman.glb` — try-on-ottoman (M24; Meshy tasks 01a18fc0-e43c-73b4-961d-aa5199eac603 / 01a18fc3-1488-77db-8722-48daa8b7e852)
- `assets/models/mall-medicine-drawer-cabinet.glb` — medicine-drawer-cabinet (M29; Meshy tasks 01a18fc4-04a2-73b4-a836-bebadc58a555 / 01a18fc7-bb05-7511-ae95-620db8cc0e0b)
- `assets/models/mall-multideck-open-cooler.glb` — multideck-open-cooler (M30; Meshy tasks 01a1903f-6812-7651-9001-db45814970b8 / 01a19041-b242-7696-b118-5e22e9fad19a)
- `assets/models/mall-cafe-bistro-table.glb` — cafe-bistro-table (M31; Meshy tasks 01a19039-d0a8-70b6-bb7c-0e19e7f94c9b / 01a1903d-c7dc-73ef-a550-9e553646d9dc)
- `assets/models/mall-cafe-chair.glb` — cafe-chair (M32; Meshy tasks 01a19039-f85a-7734-9d86-74764d0c465f / 01a1903d-e2c4-77ef-9430-f7674039c928)
- `assets/models/mall-gun-safe-tall.glb` — gun-safe-tall (M35; Meshy tasks 01a18fc4-2dce-71de-b29d-20db0e9308c4 / 01a19038-eaf2-7597-ad20-640d32682560)
- `assets/models/mall-camping-tent-display.glb` — camping-tent-display (M36; Meshy tasks 01a18fc1-0cda-7234-8908-7d041df68c99 / 01a18fc3-395b-7049-8caa-46d74563b38a)
- `assets/models/mall-mall-bench.glb` — mall-bench (M37; Meshy tasks 01a19039-92e5-70b7-84c9-d683ff13dc7c / 01a1903d-aa61-709d-9a97-80cbce35c89a)
- `assets/models/mall-tv-wall-bank.glb` — tv-wall-bank (M41; Meshy tasks 01a18fc1-362c-72cc-8257-3ae885cb9dac / 01a18fc3-5dc8-7339-9ed4-2ef6dc93bf7c)
- `assets/models/mall-cosmetics-wall-unit.glb` — cosmetics-wall-unit (M42; Meshy tasks 01a19039-76b1-7175-9c97-b7b3e0258b1a / 01a1903d-886a-7426-93df-0da9d999b49a)
- `assets/models/mall-dresser-drawers.glb` — dresser-drawers (M45; Meshy tasks 01a18fc4-5627-7004-a925-3d66f09fcb4e / 01a19039-18b9-730b-a7dc-33f196dffa24)
- `assets/models/mall-cardboard-box-flaps.glb` — cardboard-box-flaps (M47; Meshy tasks 01a18fc4-7c86-77f6-8f7d-c237fdfc1509 / 01a19039-3664-754f-b149-7c504d6fea92)
- `assets/models/mall-kiddie-ride.glb` — kiddie-ride (M50; Meshy tasks 01a18fc1-64a4-742e-a07a-dc3fc665bd7b / 01a18fc3-875b-76e5-8f6a-64222ed2ab97)
- `assets/models/mall-salon-styling-chair.glb` — salon-styling-chair (M51; Meshy tasks 01a18fc1-8df4-71cb-8dd2-2b5adecd3d2a / 01a18fc3-aca4-7273-a1a2-9f21bd81d6b4)
- `assets/models/mall-bed-display.glb` — bed-display (M52; Meshy tasks 01a18fc3-d691-72ff-92b9-6a59b9fcd8cd / 01a18fc7-93ff-75f0-b920-00beb0543755)
- `assets/models/mall-mannequin-female.glb` — mannequin-female (M81; Meshy tasks 01a194a9-c952-7340-b132-c041398af9bf / 01a194aa-df73-77e5-9f7f-76471ce0adf7; round-3 addition generated by the primary under the user's round-3 approval, task studio-beta-mall-round3-recovery01-20261101-01; provider terms apply)
- `assets/models/mall-womens-dresses-group.glb` — womens-dresses-group (M82; Meshy tasks 01a195bf-36a2-766b-aba7-dccd447eaf35 / 01a195c0-f43c-7777-8c97-4fd3c9a8c249; round-4 addition generated by the primary under the user's round-4 approval, task studio-beta-mall-round4-20261101-01; provider terms apply)
- `assets/models/mall-womens-blouses-group.glb` — womens-blouses-group (M83; Meshy tasks 01a195bf-4031-76cb-b793-fb06d2d33f1b / 01a195c0-fc0b-776f-aa88-f2c0a10c8649; round-4 addition generated by the primary under the user's round-4 approval, task studio-beta-mall-round4-20261101-01; provider terms apply)
- `assets/models/mall-womens-skirts-group.glb` — womens-skirts-group (M84; Meshy tasks 01a195bf-48cc-74b2-8209-ee9b2286a61e / 01a195c1-02a6-774f-9e3b-21fa039448ed; round-4 addition generated by the primary under the user's round-4 approval, task studio-beta-mall-round4-20261101-01; provider terms apply)
<!-- END mall-track3-20261031 -->

<!-- BEGIN annex-genset-20261031 (build-annex-genset.mjs) -->
## Beyond the Station round 2: the annex generator set

Generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's task-specific 100-credit authorization (1 attempt, 15 credits); runtime derivative built by `tools/asset-pipeline/props/build-annex-genset.mjs` (provenance: `assets/derivatives/annex-genset-20261031.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters are kept outside Git.

- `assets/models/annex-genset.glb` — industrial diesel generator set (Meshy tasks 01a19395-4d7a-75f7-84ec-5ba5d6a1a7be / 01a19396-6537-77f8-8b17-20ffef3ff302)
<!-- END annex-genset-20261031 -->

<!-- BEGIN mall-ad-art-20261101 (build-ad-art.mjs) -->
## Mall round 4: advertising artwork

Generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool) under the user's explicit round-4 authorization (8 images, task studio-beta-mall-round4-20261101-01); runtime derivatives (512 px JPEG, resize + format conversion only) built by `tools/asset-pipeline/mall-ads/build-ad-art.mjs` (provenance with prompts, Codex thread ids and source hashes: `assets/derivatives/mall-ad-art-20261101.json`). Fictional and unbranded; the brand names, headlines, prices and menus drawn over them in game are generated at runtime. Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters are kept outside Git.

- `assets/textures/mall/ads/ad-womenswear.jpg` — woman in a floral midi dress and camel trench, blush-pink backdrop (women's fashion) (Codex thread 01a195bd-135d-7310-9843-ceff9f3e8b7d)
- `assets/textures/mall/ads/ad-menswear.jpg` — man in a charcoal overcoat and plaid scarf, slate-blue backdrop (menswear / department) (Codex thread 01a195bf-7b95-7e52-8276-0520baa08005)
- `assets/textures/mall/ads/ad-food.jpg` — double cheeseburger, fries and a drink cup, amber backdrop (food court) (Codex thread 01a195c0-2827-7db2-939e-fd40c819bc92)
- `assets/textures/mall/ads/ad-cafe.jpg` — latte with foam art, croissant and pastry (cafe / bakery) (Codex thread 01a195c0-ba93-7a43-a7d9-23fdef8fad43)
- `assets/textures/mall/ads/ad-electronics.jpg` — phone, headphones and laptop, teal-blue backdrop (electronics / phones) (Codex thread 01a195c1-7d2b-7b33-8315-1a49832e7f11)
- `assets/textures/mall/ads/ad-health.jpg` — unlabelled skincare bottles and vitamin capsules, mint backdrop (pharmacy / beauty) (Codex thread 01a195c2-241c-7b42-a315-6fdba8529303)
- `assets/textures/mall/ads/ad-sports.jpg` — running shoe, daypack and bottle before a mountain ridge (sports / outdoors) (Codex thread 01a195c2-b42c-7211-89bd-b5e9e14c8a1a)
- `assets/textures/mall/ads/ad-shopping.jpg` — jewel-tone shopping bags, gift boxes and flowers (mall-wide / general) (Codex thread 01a195c3-7a0d-73e3-96f3-f4cc7232e6c5)
<!-- END mall-ad-art-20261101 -->

<!-- BEGIN enemy-strainer-20261101 (build-strainer.mjs) -->
## Beyond the Station round 4: the Strainer (enemy)

Generated for this project with Meshy T2.5 image-to-3D (smart topology, T-pose, 2K PBR; 1 attempt, 15 credits) through the Meshy MCP under the user's round-4 task authorization, conditioned on the project's own user-approved front T-pose image of the Strainer (a Codex native image generation made from the project's approved Strainer concept). Rigged and animated locally on CPU by `tools/asset-pipeline/enemy/build-strainer.mjs`: the shared 18-joint skeleton, automatic skin weights and hand-authored procedural clips (not motion capture); the provider's texture maps are resized / re-encoded only (provenance: `assets/derivatives/enemy-strainer.json`). AI-generated asset: provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the input image are kept outside Git.

- `assets/models/enemy-strainer.glb` — the Strainer, a tall clawed drain-filter stalker (Meshy task 01a195f6-f769-7638-9bb6-48d52ba3c491)
<!-- END enemy-strainer-20261101 -->

<!-- BEGIN reactor-kit-20261101 (build-reactor-kit.mjs) -->
## The Reactor: industrial kit (B "Industrial Service Cathedral")

Generated for this project with Meshy T2.5 (smart topology; image-to-3D from Codex initial reference images, text-to-3D preview + 2K PBR refine for the two items) through the Meshy MCP under the user's Reactor-only 1000-credit authorization (13 generation attempts, 195 credits billed at build time); the Codex reference images and the three surface sources were generated with Codex's built-in image tool, each with the user-selected B concept attached. Runtime derivatives built by `tools/asset-pipeline/props/build-reactor-kit.mjs` (provenance: `assets/derivatives/reactor-kit-20261101.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the concept are kept outside Git.

- `assets/models/reactor-vessel.glb` — the dormant reactor pressure vessel (dome, CRDM housings, nozzles, hazard plinth) (Meshy task 01a198f4-0f17-719d-8ff3-94ba1c1268a8)
- `assets/models/reactor-aux-generator.glb` — auxiliary diesel generator set on a skid (length along X) (Meshy task 01a198f4-332d-76ed-86d3-cafe459483d5)
- `assets/models/reactor-crane-trolley.glb` — overhead crane hoist trolley (length along X) (Meshy task 01a198f4-3af8-7606-9a98-c798d50be71b)
- `assets/models/reactor-crane-hook.glb` — crane hook block (height along Y) (Meshy task 01a198f4-41f7-7710-813c-484b02be8460)
- `assets/models/reactor-extraction-fan.glb` — wall extraction fan duct housing, empty opening facing +Z (blades procedural) (Meshy task 01a198f9-093d-7257-b5d1-2f386ac74ddb)
- `assets/models/reactor-switchgear.glb` — one switchgear cabinet section, front +Z (Meshy task 01a198f9-1098-7436-8a57-d6f92157203e)
- `assets/models/reactor-coolant-pump.glb` — centrifugal coolant pump + motor on plinth (length along X) (Meshy task 01a198f9-18a8-73dc-9fbb-64181af9307f)
- `assets/models/reactor-control-console.glb` — control room console desk, front +Z (Meshy task 01a198f9-206c-7690-944a-fec0d7c6f89b)
- `assets/models/reactor-pipe-bank.glb` — stackable 4 m organ-pipe bank module, front +Z, flat-cut ends (Meshy task 01a198f9-286f-73c4-b658-10704a34372a)
- `assets/models/reactor-coolant-valve.glb` — main coolant gate valve with handwheel (pipe along X) (Meshy task 01a198f9-303f-751d-bbab-a417fb645fa4)
- `assets/models/reactor-flood-lamp.glb` — caged wall flood lamp on a bracket (instanced) (Meshy task 01a198f9-3771-7247-849b-5a4e6f64db6f)
- `assets/models/reactor-fuse-cartridge.glb` — item: ceramic cartridge fuse (length along X) (Meshy task 01a198fb-61d2-71e8-97b2-0af06e44edb8)
- `assets/models/reactor-key.glb` — item: control-room startup key on a red fob (longest extent) (Meshy task 01a198fb-690f-70fd-8d2a-ecb477ff98d6)
- `assets/textures/reactor/rusted-steel-{color,normal,orm}.jpg` — riveted rusted painted steel plate (Codex colour source; normal / ORM derived locally)
- `assets/textures/reactor/grating-{color,normal,orm}.jpg` — steel bar grating deck (dark gaps) (Codex colour source; normal / ORM derived locally)
- `assets/textures/reactor/pit-concrete-{color,normal,orm}.jpg` — board-formed stained pit concrete (Codex colour source; normal / ORM derived locally)
<!-- END reactor-kit-20261101 -->

<!-- BEGIN player-train-20261101 (build-player-train.mjs) -->
## Player train (level one): car shell, driving desk, door leaf, interior textures

Models generated for this project with Meshy T2.5 (smart topology; text-to-3D preview + 2K PBR refine) through the Meshy MCP under the user's player-train authorization (4 attempts, 50 credits of up to 300); interior textures generated with Codex native image generation (the owned Codex CLI's built-in image_gen tool). Runtime derivatives (mesh processing: body stretched to human scale with the undercarriage unstretched, door openings and see-through window openings cut, Meshy's folded / duplicate overlapping faces removed and the normals recomputed, the leaf rebuilt from its clean face and decimated with its own maps re-baked onto a planar UV and its window cut; otherwise texture resize / format conversion only) built by `tools/asset-pipeline/train/build-player-train.mjs` (provenance: `assets/derivatives/player-train-20261101.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters are kept outside Git.

- `assets/models/player-train-shell.glb` — weathered subway car shell (Meshy tasks 01a198d2-7f79-7021-981f-3b63e0548d6f / 01a198d3-a2b4-70c5-a452-6084c8b0d0fd)
- `assets/models/player-train-console.glb` — cab driving desk (Meshy tasks 01a198d0-a538-7332-9064-ada748d324d6 / 01a198d2-0957-7588-83fe-c959b740c1ef)
- `assets/models/player-train-door-leaf.glb` — sliding door leaf (Meshy tasks 01a198d0-ade7-7435-8dbe-13a82462028b / 01a198d2-0f84-7605-9343-24943ef4f4aa)
- `assets/models/player-train-lockbox.glb` — rear-compartment steel lockbox, split into body + hinged lid (Meshy tasks 01a1996f-788c-73a8-b72f-b0cbf80a91ea / 01a19970-d6a7-7150-ac6c-a68aa972b326; the user's lockbox authorization, 15 of up to 50 credits)
- `assets/textures/train/train-int-wall.jpg` — interior side wall, one window bay (tiles along the car) (Codex thread 01a198d0-301a-7e62-abad-ee94bcd0efde)
- `assets/textures/train/train-int-floor.jpg` — ribbed rubber floor (tiles in 2D) (Codex thread 01a198d0-f4bb-7c81-8b89-8f605a9ef95c)
- `assets/textures/train/train-int-ceiling.jpg` — vented ceiling panels (tiles in 2D) (Codex thread 01a198d1-c556-7673-a111-b1b56f00891f)
- `assets/textures/train/train-int-bulkhead.jpg` — end bulkhead with a central closed door (one panel) (Codex thread 01a198d2-7511-7f32-93e6-c6155d93261b)
<!-- END player-train-20261101 -->

<!-- BEGIN reactor-x-kit-20261101 (build-reactor-x-kit.mjs) -->
## The Reactor expansion: hero reactor assembly + side-complex kit (B "Industrial Service Cathedral")

Generated for this project with Meshy T2.5 (smart topology; image-to-3D from Codex initial reference images, text-to-3D preview + 2K PBR refine for the two items) through the Meshy MCP under the user's NEW Reactor-expansion 1000-credit authorization (16 generation attempts, 240 credits billed at build time); the Codex reference images and the three surface sources were generated with Codex's built-in image tool, each with the user-selected B concept attached. Runtime derivatives built by `tools/asset-pipeline/props/build-reactor-x-kit.mjs` (provenance: `assets/derivatives/reactor-x-kit-20261101.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the concept are kept outside Git.

- `assets/models/reactor-steam-generator.glb` — hero: nuclear steam generator / heat-exchanger tower (height along Y) (Meshy task 01a19978-a39f-7084-b518-edc27ccd8711)
- `assets/models/reactor-coolant-pump-vertical.glb` — hero: vertical reactor coolant pump (motor over a spherical casing) (Meshy task 01a19978-aaed-7429-9b6a-576cee00fd77)
- `assets/models/reactor-coolant-manifold.glb` — hero: coolant header manifold with branch valves (length along X) (Meshy task 01a19980-3288-7587-8eff-68479e594a27)
- `assets/models/reactor-turbine-generator.glb` — hero: steam turbine generator set on its pedestal (length along X) (Meshy task 01a19980-3950-73dd-b1ef-76ce8ffe9845)
- `assets/models/reactor-blast-door.glb` — bunker: round blast door standing open in its frame (Meshy task 01a19980-4120-738a-96bc-0e1f94f7f58d)
- `assets/models/reactor-air-filtration-unit.glb` — bunker: air filtration / ventilation plant unit (Meshy task 01a19980-495b-73c0-becc-106067533df2)
- `assets/models/reactor-radio-console.glb` — bunker: built-in radio communications desk (nothing loose) (Meshy task 01a19980-5112-7565-86c5-ef699ab4ad3c)
- `assets/models/reactor-bunk-bed.glb` — bunker: steel double bunk bed (bare mattresses) (Meshy task 01a19980-58e9-735f-be9d-5ee9422f64e3)
- `assets/models/reactor-mine-cart.glb` — mines: narrow-gauge ore cart (empty) (Meshy task 01a19980-6058-76f4-853c-29228126da55)
- `assets/models/reactor-timber-set.glb` — mines: tunnel timber support set (posts + cap) (Meshy task 01a19980-7222-7535-ae88-019a643cc95e)
- `assets/models/reactor-hoist-winch.glb` — mines: electric hoist winch on its base (Meshy task 01a19980-7a6c-7636-9a4c-9d97718acd29)
- `assets/models/reactor-rock-drill-rig.glb` — mines: pneumatic drill rig on a carriage (Meshy task 01a19980-824d-74b8-9d7c-a7bb86a478cf)
- `assets/models/reactor-waste-drum.glb` — waste: 200 L waste drum (instanced) (Meshy task 01a19980-89fa-7669-b411-f0a5867105ab)
- `assets/models/reactor-storage-cask.glb` — waste: dry storage cask (Meshy task 01a19980-91fa-71e7-8b9e-b6acf33f3dc7)
- `assets/models/reactor-decon-shower.glb` — waste: decontamination shower booth (Meshy task 01a19980-99fb-70c8-b1c4-4b47a9d8413f)
- `assets/models/reactor-hot-cell-window.glb` — waste: hot-cell window wall section with manipulators (Meshy task 01a19980-a169-77a3-abcc-66ee22bb9ff8)
- `assets/textures/reactor/mine-rock-{color,normal,orm}.jpg` — blasted mine-drift rock (lane MINES drift walls / ceilings) (Codex colour source; normal / ORM derived locally)
<!-- END reactor-x-kit-20261101 -->
