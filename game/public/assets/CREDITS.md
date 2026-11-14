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
- Turnstile (2026-11-12, G07, the revolving 12-gauge of the selected shotgun concept B): a user-uploaded textured model (the
  user supplied and authorized it for the game; the upload file name mentions Meshy, but the generator, account, settings and
  licence are NOT verified and no clearance is implied). The game ships a re-oriented, re-scaled (0.80 m) derivative with every
  source triangle (its break-open part and, under it, its revolving cylinder split along the model's own geometry) and its
  own PBR maps downsized and re-encoded
  (base colour 2048 px, metallic-roughness / normal 1024 px; derivatives/weapon-turnstile.json;
  tools/asset-pipeline/weapons/build-turnstile.mjs). The original stays outside the repository. No generation; its sounds
  reuse the existing shotgun shot, shell insert and Coach Gun break open / close clips.
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
- `assets/models/player-train-glass.glb` — conformal window glass sheets and reveals fitted to the shell's own surface (derived geometry, untextured)
- `assets/models/player-train-lockbox.glb` — rear-compartment steel lockbox, split into body + hinged lid (Meshy tasks 01a1996f-788c-73a8-b72f-b0cbf80a91ea / 01a19970-d6a7-7150-ac6c-a68aa972b326; the user's lockbox authorization, 15 of up to 50 credits)
- `assets/textures/train/train-int-wall.jpg` — interior side wall, one window bay (tiles along the car) (Codex thread 01a198d0-301a-7e62-abad-ee94bcd0efde)
- `assets/textures/train/train-int-floor.jpg` — ribbed rubber floor (tiles in 2D) (Codex thread 01a198d0-f4bb-7c81-8b89-8f605a9ef95c)
- `assets/textures/train/train-int-ceiling.jpg` — vented ceiling panels (tiles in 2D) (Codex thread 01a198d1-c556-7673-a111-b1b56f00891f)
- `assets/textures/train/train-int-bulkhead.jpg` — end bulkhead with a central closed door (one panel) (Codex thread 01a198d2-7511-7f32-93e6-c6155d93261b)
<!-- END player-train-20261101 -->

<!-- BEGIN reactor-x-kit-20261101 (build-reactor-x-kit.mjs) -->
## The Reactor expansion: hero reactor assembly + side-complex kit (B "Industrial Service Cathedral")

Generated for this project with Meshy T2.5 (smart topology; image-to-3D from Codex initial reference images, text-to-3D preview + 2K PBR refine for the two items) through the Meshy MCP under the user's NEW Reactor-expansion 1000-credit authorization (19 generation attempts, 285 credits billed at build time); the Codex reference images and the three surface sources were generated with Codex's built-in image tool, each with the user-selected B concept attached. Runtime derivatives built by `tools/asset-pipeline/props/build-reactor-x-kit.mjs` (provenance: `assets/derivatives/reactor-x-kit-20261101.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the concept are kept outside Git.

- `assets/models/reactor-steam-generator.glb` — hero: nuclear steam generator / heat-exchanger tower (height along Y) (Meshy task 01a19978-a39f-7084-b518-edc27ccd8711)
- `assets/models/reactor-coolant-pump-vertical.glb` — hero: vertical reactor coolant pump (motor over a spherical casing) (Meshy task 01a19978-aaed-7429-9b6a-576cee00fd77)
- `assets/models/reactor-coolant-manifold.glb` — hero: coolant header manifold with branch valves (length along X) (Meshy task 01a19980-3288-7587-8eff-68479e594a27)
- `assets/models/reactor-pipe-elbow.glb` — hero: flanged 90-degree coolant pipe elbow (instanced on the loops) (Meshy task 01a199ea-a0b7-706f-8bac-cb6f2305afc9)
- `assets/models/reactor-sight-glass-spool.glb` — hero: coolant spool with an armoured sight-glass window (blue flow shows through) (Meshy task 01a199ea-a788-77fd-88cf-5fab64abe728)
- `assets/models/reactor-crdm-platform.glb` — hero: control-rod-drive service platform on the vessel head (Meshy task 01a199ea-aede-7356-a52f-5e880fa017d0)
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

<!-- BEGIN reactor-startup-audio-20261102 (reactor-startup-build.mjs) -->
## The Reactor: startup audio (power-up, control rods, beacons)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the round-2
Reactor brief's startup / control-rod audio allowance (7 jobs of a 12-job cap). Powered by Stability AI. Stability AI
Community License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives
(trim, fades, loops, levelling, MP3) built by `tools/audio-pipeline/reactor-startup-build.mjs` (provenance:
`assets/derivatives/audio-reactor-startup.json`). Not reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/reactor-surge.mp3` — reactorSurge (Sound Lab job 20261102T063836-737297743)
- `assets/audio/reactor-online.mp3` — reactorOnline (Sound Lab job 20261102T063841-456197206)
- `assets/audio/reactor-rod-loop.mp3` — reactorRodLoop (Sound Lab job 20261102T063845-204671000)
- `assets/audio/reactor-rod-stop.mp3` — reactorRodStop (Sound Lab job 20261102T063850-1318616898)
- `assets/audio/reactor-bed-loop.mp3` — reactorBed (Sound Lab job 20261102T063854-436372056)
- `assets/audio/reactor-stage.mp3` — reactorStage (Sound Lab job 20261102T063859-1388193861)
- `assets/audio/reactor-beacon-loop.mp3` — reactorBeacon (Sound Lab job 20261102T063904-2058341218)
<!-- END reactor-startup-audio-20261102 -->

<!-- BEGIN reactor-surface-kit-20261102 (build-reactor-surface-kit.mjs) -->
## The Reactor surface ending: the ruined city round the roof aperture

Generated for this project with Meshy T2.5 (smart topology; image-to-3D from Codex initial reference images made with the user-selected B concept attached) through the Meshy MCP under the user's NEW surface-ending 200-credit authorization (sha256 1eb98c31…); Meshy's PBR maps kept (re-encoded only). Raw masters + provenance stay private / tracked outside the shipped site.

- `assets/models/reactor-city-highrise-ruin.glb` — surface: ruined ~25-storey glass / concrete office tower, top sheared off (Meshy task 01a19e39-ecdb-7658-852c-2f719bef5311)
- `assets/models/reactor-city-apartment-ruin.glb` — surface: ruined 7-storey brick apartment block with fire escapes, a collapsed corner (Meshy task 01a19e3a-07b5-77b2-ab18-abc2bb8cb7d3)
- `assets/models/reactor-city-garage-skeleton.glb` — surface: burned-out multi-storey parking garage stripped to its concrete frame (Meshy task 01a19e3a-240a-707c-a7f4-58d6115f7e01)
- `assets/models/reactor-city-storefront-row.glb` — surface: ruined two-storey corner row of shops (blank signs) (Meshy task 01a19e3a-4200-75cb-ac7f-6377d9f68177)
<!-- END reactor-surface-kit-20261102 -->

<!-- BEGIN reactor-ending-audio-20261102 (reactor-ending-build.mjs) -->
## The Reactor: ending audio (the blue-beam ignition, the surface rain)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the surface-
ending task's blue-beam / rain allowance (2 jobs of a 6-job cap). Powered by Stability AI. Stability AI Community
License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
loop, levelling, MP3) built by `tools/audio-pipeline/reactor-ending-build.mjs` (provenance: `assets/derivatives/audio-reactor-ending.json`).
Not reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/reactor-beam.mp3` — reactorBeam (Sound Lab job 20261102T214343-1373120250)
- `assets/audio/surface-rain-loop.mp3` — bedRain (Sound Lab job 20261102T214347-51396616)
<!-- END reactor-ending-audio-20261102 -->

## Mall lingerie task: three user-uploaded zombie bodies (ordinary wardrobe)
- "Pale Gaze", "Pale Revenant" and "Pale Apparition" are female zombie body models the user supplied in
  `langery-store-zombie-pack.zip` (Meshy AI exports, unrigged T-pose). They were not generated by this project, and no
  generation call was made for them. They are not the Siren.
- The local CPU wardrobe pipeline (`tools/asset-pipeline/zombie/build-wardrobe.mjs`) produced the runtime derivatives
  `zombie-body-pale-*-t25.glb`, keeping the bodies' proportions and faces:
  - arms brought into the A-pose bind (linear-blend repose);
  - 18-joint rig with automatic weights and the shared procedural clips;
  - 15k triangles, with the user's Meshy colour / metal-rough maps re-baked to 1024 / 256 (the normal map is not used).
- Existing regular wardrobe garments are refitted to them. Provenance: `assets/derivatives/zombie-body-pale-*.json`.
- Unclothed bodies: the game always dresses them in an upper and a lower garment. The original uploads stay private
  (studio reference task folder plus a local backup). Unapproved prototypes; no commercial clearance implied.

## Mall lingerie task: lingerie sets fitted to the pale bodies (store-local variants)
- Six lingerie sets (`assets/models/outfit-lingerie-{green,purple,blush,black,red,ivory}.glb`) were generated for this project as
  Meshy T2.5 image-to-3D models from the six clothing reference images the user supplied in `langery-store-zombie-pack.zip`
  (the primary was the sole Meshy submitter under the user's 200-credit clothing approval; Meshy PBR maps kept).
- The local CPU builder `tools/asset-pipeline/zombie/build-lingerie.mjs` fitted each set to the pale bodies it is assigned to. Each
  set ships as a wardrobe top (slot upper) and a bottom (slot lower):
  - landmark alignment, non-rigid conformity to the body surface, and skin weights transferred from the body;
  - pose-aware clearance checked through all six clips, with the covered body triangles hidden;
  - the one-piece blush bodysuit is cut at the waist into those two halves;
  - Meshy generated the ivory thong front-to-back, so it was mirrored to match the reference: full front panel, narrow back.
- The Meshy base colour is re-encoded at 1024 and metallic / roughness packed at 256; the normal map is not shipped. No
  retexturing or painting. Opaque material (the lace is texture only).
- Each file also holds the store's stock (store-polish task, unskinned, same texture): the set fitted to the Mall's existing female
  display mannequin (M81, `mall-mannequin-female.glb`), and hanging rack items on simple procedural chrome hangers (plain
  hardware geometry, no texture). Provenance: `assets/derivatives/outfit-lingerie-*.json` and
  `assets/derivatives/zombie-lingerie.json`.
- Raw Meshy outputs and the user references stay private (studio reference task folder plus a local backup). Unapproved
  prototypes; no commercial clearance implied. Ordinary zombie clips only.

## Skyways convention: cosplay zombie costumes (ordinary zombies)
- `assets/models/outfit-cosplay-{head,upper,lower}.glb` are built only from models already in this repository. No model,
  image or audio generation (Meshy or Codex) was used. The local CPU builder is `tools/asset-pipeline/zombie/build-cosplay.mjs`.
- Head pieces are rigid on the Head joint and fitted per body:
  - The convention mascot statue's bear-ear hat and blue hair (`skyways-mascot-poses.glb`, its supplied figure) are split by
    base colour and connectivity into a costume hat and wig.
  - An alternate palette (cream hat, rose wig) is a per-texel hue / value transform of the same map.
  - The statue's head (hat, hair and face) becomes an oversized costume head.
  - The ramen counter's sushi mascot figurine (`skyways-sushi-mascot.glb`) becomes a novelty hat.
  - These keep their sources' status: community-supplied via the user, creator / license links pending, no license or
    authorship claim.
- The dyed hoodie, sweater, blazer and slacks reuse the ordinary fitted Meshy garments' geometry, skin weights and masks
  unchanged. Only the base-colour map has a deterministic, luminance-preserving colour transform.
- Provenance: `assets/derivatives/outfit-cosplay.json`. Unapproved prototypes; no commercial clearance implied. Ordinary zombie
  clips only.
- Since the full-costume update below these three files are no longer used by the game; they stay in the repository as cooked
  inputs (not shipped).

### Full cosplay costumes (the convention's current looks)
- `assets/models/outfit-cosplay-costume-{head,upper,lower}.glb` dress the convention's cosplay zombies head to toe: bear idol,
  mascot suit, sushi fan and rose uniform (jacket / top / coat / blazer; skirt or trousers with stockings / socks and footwear).
- The eight garments are Meshy T2.5 image-to-3D models generated for this project from Codex-made concept images (initial
  ghost-mannequin garment art), under the user's explicit Meshy authorization for this task. The raw Meshy outputs, concepts and
  their records stay private (studio reference task folder); task ids and sha256 are in the provenance record.
- The Meshy PBR maps are kept: base colour, normal and metallic / roughness, resized / re-encoded / packed only. No retexturing,
  projection or painting.
- Fitted per body by the local deterministic CPU builder `tools/asset-pipeline/zombie/build-cosplay-costumes.mjs` (landmark
  retarget, clearance through every animation clip and ragdoll-like poses, skin weights from the body, covered body parts hidden).
- The head pieces are the convention-mascot / sushi-figurine pieces above (same sources and status), re-fitted to each costume
  body; on the long-haired bodies the bear-ear hat is worn without the wig.
- Provenance: `assets/derivatives/outfit-cosplay-costume.json`. AI-generated assets: unapproved prototypes, no licence or
  commercial clearance implied. Ordinary zombie clips only.

<!-- BEGIN paper-map-20261102 (build-paper-map.mjs) -->
## Campaign: the paper subway map

- `assets/textures/paper-map.jpg` — the blank old folded paper sheet of the in-game subway map. Generated for this project with Codex's built-in image tool (one call under the task's 8-call authorization); runtime derivative by `tools/asset-pipeline/campaign/build-paper-map.mjs` (resize + JPEG only; provenance: `assets/derivatives/paper-map-20261102.json`). The lines, stations and labels are drawn at runtime. AI-generated asset: unapproved prototype, no licence or commercial clearance implied. The raw master is kept outside Git.
<!-- END paper-map-20261102 -->

<!-- BEGIN mall-lingerie-ad-art-20261103 (build-lingerie-ad-art.mjs) -->
## Mall lingerie boutique: advertising artwork

Generated for this project with Codex native image generation (the owned Codex CLI's built-in image_gen tool) under the user's explicit authorization (4 images, task studio-beta-mall-lingerie-store-polish-20261103-045922-01), each made with the user's own lingerie design reference photos attached; runtime derivatives (512 px JPEG, resize + format conversion only) built by `tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs` (provenance with prompts, Codex thread ids and source / reference hashes: `assets/derivatives/mall-lingerie-ad-art-20261103.json`). Product-only and unbranded; the fictional brand names and headlines drawn over them in game are generated at runtime. Provider terms apply; unapproved prototypes, no licence or commercial clearance implied. Raw masters and the user references are kept outside Git.

- `assets/textures/mall/ads-lingerie/ad-lingerie-flatlay.jpg` — flat-lay of the emerald longline lace set and the black balconette lace set on blush satin (user designs 9gPhXy5tx6G6iW_0 / M52skrui8zNLGE_0) (Codex thread 01a19fcb-df74-7c82-a95b-58ecbf9b1da9)
- `assets/textures/mall/ads-lingerie/ad-lingerie-dressform.jpg` — the plum lace strapless bustier with suspenders and brief on a vintage dress form (user design 9gPhXy5tx6G6iW_1) (Codex thread 01a19fcc-fd70-7c42-882c-5048d842ba89)
- `assets/textures/mall/ads-lingerie/ad-lingerie-hangers.jpg` — the crimson plunge bra + garter set and the ivory bralette + garter set on satin hangers (user designs M52skrui8zNLGE_1 / _2) (Codex thread 01a19fcd-dd71-77c2-ad3b-1173da5e02ef)
- `assets/textures/mall/ads-lingerie/ad-lingerie-giftbox.jpg` — the blush lace plunge bodysuit folded in a ribboned gift box (user design 9gPhXy5tx6G6iW_2) (Codex thread 01a19fce-fa07-76b0-9686-25cdde8264a5)
<!-- END mall-lingerie-ad-art-20261103 -->

<!-- BEGIN train-fuel-and-airtank-models (build-airtank-backpack.mjs, build-train-fuel-can.mjs) -->
## Survival gear and train fuel: the Airtank Backpack and the fuel can

Generated for this project from a Codex INITIAL concept image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D; each model keeps Meshy's own PBR maps (re-encoded only). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. Raw masters, conditioning images and job ledgers are kept outside Git.

- `assets/models/gear-airtank-backpack.glb` — the Airtank Backpack (steel cylinder on a frame and harness). Task studio-beta-filter-tension-airtank-20261104-072836-01 under the user's 50-credit authorization (15 credits, 1 attempt); runtime derivative by `tools/asset-pipeline/props/build-airtank-backpack.mjs` (provenance: `assets/derivatives/gear-airtank-backpack.json`).
- `assets/models/train-fuel-can.glb` — the train's fuel can (a 20-litre jerrycan). Task studio-train-fuel-can-asset-20261106-030724-01 under the user's 50-credit authorization (15 credits, 1 attempt); runtime derivative by `tools/asset-pipeline/props/build-train-fuel-can.mjs` (provenance: `assets/derivatives/train-fuel-can.json`).
- The train's fuel cart is a composition of two existing models (`assets/models/p7-hand-truck-t25.glb` and `assets/models/reactor-waste-drum.glb`); nothing new was generated for it.
<!-- END train-fuel-and-airtank-models -->

<!-- BEGIN flamethrower-model-20261114 (build-flamethrower.mjs) -->
## The Flamethrower

Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (the base colour as generated, the other two re-encoded). Task studio-flamethrower-fire-20261114-031614-01 under the user's scoped 75-credit grant (15 credits, a first attempt). AI-generated asset: an unapproved prototype, no licence or commercial clearance implied. The raw master, the design image and the job ledger are kept outside Git.

- `assets/models/weapon-flamethrower.glb` — the Flamethrower (a scrap-built burner lance: shoulder rest, squeeze-lever grip, valve body with a gauge, perforated heat shield, burner bell); runtime derivative by `tools/asset-pipeline/weapons/build-flamethrower.mjs` (provenance: `assets/derivatives/weapon-flamethrower.json`; Meshy task 01a1d827-b0b0-769e-b5f4-748d2528597c).
<!-- END flamethrower-model-20261114 -->

<!-- BEGIN flamethrower-fuel-tank-model-20261114 (build-fuel-tank.mjs) -->
## The Fuel Tank

Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (re-encoded only). Task studio-flamethrower-fire-20261114-031614-01 under the user's scoped 75-credit grant (15 credits, a first attempt). AI-generated asset: an unapproved prototype, no licence or commercial clearance implied. The raw master, the design image and the job ledger are kept outside Git.

- `assets/models/gear-fuel-tank.glb` — the Fuel Tank gear item (a red jerrycan on a tubular pack frame with a hand pump, hose, shoulder straps and a waist belt); runtime derivative by `tools/asset-pipeline/props/build-fuel-tank.mjs` (provenance: `assets/derivatives/gear-fuel-tank.json`; Meshy task 01a1d827-dec4-76e0-973b-b51cc616368d).
<!-- END flamethrower-fuel-tank-model-20261114 -->

<!-- BEGIN train-chipper-model (build-train-chipper.mjs) -->
## Train chipper

Generated for this project from one Codex INITIAL design image (the owned Codex CLI's built-in image_gen tool) turned into a model with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; the model keeps Meshy's own PBR maps (re-encoded only). Task studio-corpse-chipper-fuel-20261110-235304-01 under the user's chipper authorization (15 of up to 100 credits, 1 attempt). AI-generated asset: unapproved prototype, no licence or commercial clearance implied. The raw master, conditioning image and job ledger are kept outside Git.

- `assets/models/train-chipper.glb` — the train's corpse woodchipper (feed hopper, rotor housing, motor, control box, spout and hose, twin collection tanks on a welded base frame) (Meshy task 01a1c7ea-aad4-744e-8734-a75af09b66ec); runtime derivative by `tools/asset-pipeline/props/build-train-chipper.mjs` (provenance: `assets/derivatives/train-chipper.json`).
<!-- END train-chipper-model -->

<!-- BEGIN train-equipment-models (build-train-equipment.mjs) -->
## Train crafting equipment

Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded only). Task studio-train-crafting-v1-20261111-225628-01 under the user's crafting-equipment authorization (75 of up to 150 credits, 5 generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by `tools/asset-pipeline/props/build-train-equipment.mjs` (provenance: `assets/derivatives/train-equipment.json`).

- `assets/models/train-bench.glb` — the train's crafting bench (wooden top on a welded steel frame; bolted-down vise, bench grinder and gauge box; mesh lower shelf) (Meshy task 01a1cce3-149a-7359-bf98-f89607d03730).
- `assets/models/train-radar.glb` — the route radar module (field cabinet with a mast-mounted antenna bar and whip aerial; stands on the existing hand truck) (Meshy task 01a1cce1-bfc8-7225-a764-fcd6efbafdae).
- `assets/models/train-sentry.glb` — the sentry control module (field console with monitor and emergency stop under an open ammunition hopper; stands on the existing hand truck) (Meshy task 01a1cce3-ee24-739b-9925-b575f1ed6e7a).
- `assets/models/train-scanner.glb` — the item / enemy scanner module (field console with a hooded round scope, beacon and whip aerial; stands on the existing hand truck) (Meshy task 01a1cce1-de50-72a5-a98f-47a1ec3b8878).
- `assets/models/train-turret.glb` — the sentry's roof turret (machine gun with sensor pod and twin ammunition boxes in a U yoke on a slew-ring base; three nodes: base, yoke, head) (Meshy task 01a1cce2-d935-73da-b810-259aa1557993).
<!-- END train-equipment-models -->

<!-- BEGIN train-fuel-audio-20261106 (fuel-build.mjs) -->
## Train fuel audio (engine stall, fuel pour, fuel cart rolling)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the train-fuel
task's local Sound Lab allowance (3 jobs of a 6-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by `tools/audio-pipeline/fuel-build.mjs` (provenance: `assets/derivatives/audio-fuel.json`). Not reviewed by ear
on the build worker. Raw takes are kept outside Git.

- `assets/audio/fuel-engine-stall.mp3` — engineStall (Sound Lab job 20261106T031208-1101220115)
- `assets/audio/fuel-pour.mp3` — fuelPour (Sound Lab job 20261106T031213-437489893)
- `assets/audio/fuel-cart-roll-loop.mp3` — cartRoll (Sound Lab job 20261106T031217-869772459)
<!-- END train-fuel-audio-20261106 -->

<!-- BEGIN skyways-car-audio-20261106 (skyways-car-build.mjs) -->
## Skyways prize-car audio (engine idle / drive loops, engine start, reverse whine, brake stop, tyre skid, door)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the Skyways
task's local Sound Lab allowance (round 1: 4 jobs of the Skyways task's 12-job cap) and the rework's (round 2: 8 jobs of the Skyways rework's 8-job audio allowance). Powered by Stability AI.
Stability AI Community License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime
derivatives (trim, fades, loop, layer mix, levelling, MP3) built by `tools/audio-pipeline/skyways-car-build.mjs` (provenance:
`assets/derivatives/audio-skyways-car.json`). Not reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/car-engine-idle-loop.mp3` — carIdle (Sound Lab jobs 20261107T060608-1026530035 + 20261107T060428-1611127821)
- `assets/audio/car-engine-drive-loop.mp3` — carDrive (Sound Lab jobs 20261107T060433-429155089 + 20261106T071506-522183325)
- `assets/audio/car-engine-start.mp3` — carStart (Sound Lab job 20261107T060438-1607570711)
- `assets/audio/car-reverse-loop.mp3` — carReverse (Sound Lab job 20261107T060442-1790482092)
- `assets/audio/car-brake.mp3` — carBrake (Sound Lab job 20261107T060447-234821177)
- `assets/audio/car-skid.mp3` — carSkid (Sound Lab job 20261106T071511-1842152276)
- `assets/audio/car-door.mp3` — carDoor (Sound Lab job 20261106T071515-1534666901)
<!-- END skyways-car-audio-20261106 -->

<!-- BEGIN skyways-sources-20261106 (lead) -->
## Skyways: community-supplied models, new props and original art
- Community-supplied source models: the user supplied fifteen GLB models in `sky-ways.zip`. They are Meshy AI exports the user
  described as community models (the user chose them to save generation credits). They were not generated by this project, and no
  generation call was made for them. Creator / source / license links were requested and are pending; no authorship, CC0 or
  license claim is made here, and no commercial clearance is implied.
  - Runtime derivatives (deterministic simplification / UV re-bake / texture downsizing of the source maps; provenance under
    `assets/derivatives/`):
    - the edible food items (`item-ramen-bowl`, `item-ramen-chashu`, `item-sushi-bento`, `item-bubble-tea`);
    - the ramen kitchen (`skyways-commercial-range`, `skyways-stock-pot`, `skyways-saucepan`) and the sushi mascot figurine
      (`skyways-sushi-mascot`);
    - the street wrecks (`skyways-wreck-*`);
    - the prize car (`skyways-prize-car`: glass split out for the first-person view);
    - the convention mascot statues (`skyways-mascot-poses`: five poses baked from the supplied figure by a deterministic local
      region-skinning pipeline; her appearance and textures unchanged).
  - The original uploads stay private (studio reference task folder).
- New Skyways props, generated for this project under the user's 1000-credit Skyways approval (the primary was the sole Meshy
  submitter): the car dashboard and bucket seat, the convention stage, merch table, figure box and plush, and the showroom stanchion
  (`skyways-car-dash`, `skyways-car-seat`, `skyways-con-*`, `skyways-prize-stanchion`). Each is a Codex native image_gen concept
  image (straight-on front elevation) followed by Meshy T2.5 image-to-3D, with Meshy's own PBR maps kept.
- Original art, generated for this project with Codex native image_gen: the convention posters, banners, stage backdrop, welcome
  sign and print sheet, the prize-draw board and the ramen restaurant's noren / menu / poster (`textures/skyways/*.jpg`;
  provenance `assets/derivatives/skyways-*.json`). The series, characters and brands are invented.
- Unapproved prototypes; no commercial clearance implied.
<!-- END skyways-sources-20261106 -->

<!-- BEGIN skyways-dest-art-20261106 (build-skyways-dest-art.mjs) -->
## Skyways destinations: original shop posters and court plaques
Original flat art generated for this project with Codex native image_gen (owned Codex CLI), one call per piece, under the user's
explicit art authorization for the Skyways destinations. The films, bands, hockey team, shops, shows, courts and society named on
them are invented. Runtime derivatives (crop / resize / JPEG atlas pack only) built by
`tools/asset-pipeline/props/build-skyways-dest-art.mjs`; provenance `assets/derivatives/skyways-d-posters.json` and
`assets/derivatives/skyways-d-plaques.json`. The raw generations stay private (studio reference task folder).

- `assets/textures/skyways/skyways-d-posters.jpg` — thirteen shop posters: three cinema film posters, two record-store gig posters,
  the bookshop's author evening, the outfitter's travel poster, a star chart, the arcade's neon poster, a hockey team poster, the
  model-railway show, a home-store catalogue ad and a seed-catalogue poster.
- `assets/textures/skyways/skyways-d-plaques.jpg` — six cast-bronze / enamel court plaques (Clock, Badlands, Fig Tree, Fountain,
  Flight and Orrery Courts).
- Unapproved prototypes; no commercial clearance implied.
<!-- END skyways-dest-art-20261106 -->

<!-- BEGIN skyways-destinations-audio-20261106 (skyways-destinations-build.mjs) -->
## Skyways destinations audio (clock tick loop, clock chime, arcade attract loop, projector loop)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the Skyways
destinations task's local Sound Lab allowance (4 jobs of a 4-job plan). Powered by Stability AI. Stability AI Community
License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
loop, levelling, MP3) built by `tools/audio-pipeline/skyways-destinations-build.mjs` (provenance:
`assets/derivatives/audio-skyways-destinations.json`). Not reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/skyways-clock-tick-loop.mp3` — clockTick (Sound Lab job 20261106T172857-365151629)
- `assets/audio/skyways-clock-chime.mp3` — clockChime (Sound Lab job 20261106T172902-1344187379)
- `assets/audio/skyways-arcade-attract-loop.mp3` — arcadeAttract (Sound Lab job 20261106T172906-1331231845)
- `assets/audio/skyways-projector-loop.mp3` — projectorRun (Sound Lab job 20261106T172911-1103820376)
<!-- END skyways-destinations-audio-20261106 -->

<!-- BEGIN skyways-destinations-kit-20261106 (lane KITS) -->
## Skyways destinations: landmark and shop kit models
- New Skyways destination models, generated for this project under the user's Skyways destinations generation approval (a new
  895-credit Meshy T2.5 ledger; the destinations lead was the sole Meshy submitter): the six court landmarks (clock tower, hadrosaur
  skeleton, fig tree, fountain, flock of geese, orrery) and the shop kit for the books, outfitter, music, hobby, design, garden, arcade,
  cinema, science and hockey destinations (`skyways-d-*`). Each is a Codex native image_gen concept image (a straight-on elevation)
  followed by Meshy T2.5 image-to-3D, with Meshy's own PBR maps kept (re-encoded / downsized only). Runtime derivatives (uniform
  real-size fit, light simplification where over budget, lead-approved depth squashes and one local junk-part removal) are built by
  `tools/asset-pipeline/props/build-skyways-dest-props.mjs`; provenance in `assets/derivatives/skyways-d-*-model.json`. The raw
  generations and concept images stay private (studio reference task folder). The designs and brands are invented.
- Unapproved prototypes; no commercial clearance implied.
<!-- END skyways-destinations-kit-20261106 -->

<!-- BEGIN skyways-store-design-art-20261107 (build-art.mjs, lane STORE-DESIGN) -->
## Skyways major store Larch & Loom Home: framed art prints
Six original framed-art-print artworks generated for this project with Codex native image_gen (owned Codex CLI) in one call (one
sheet; Codex thread 01a1b4f6-8104-7391-9ec0-584414b4be67) under the Skyways store lanes' art authorization (task
studio-alpha-skyways-shops-20261107-054512-01). Runtime derivative (locate / crop / resize / JPEG atlas pack only) built by
`tools/asset-pipeline/skyways-stores/design/build-art.mjs`; provenance with the prompt and source hash:
`assets/derivatives/skyways-store-art-20261107.json` (section `stores.design`). The raw generation stays private (studio reference task folder).

- `assets/textures/skyways/stores/design/skyways-store-design-prints.jpg` — mid-century arches, a prairie horizon line drawing, larch
  branches, a woven-textile pattern, a birch-lake watercolour and stacked organic shapes.
- Unapproved prototypes; provider terms apply; no commercial clearance implied.
<!-- END skyways-store-design-art-20261107 -->

<!-- BEGIN skyways-store-science-art-20261107 (build-science-art.mjs, lane STORE-SCIENCE) -->
## Skyways major store Big Sky Wonders: wall art
Three static artworks generated for this project with Codex native image_gen (owned Codex CLI; 3 calls, 3 accepted) under the Skyways
store lanes' art authorization (task studio-alpha-skyways-shops-20261107-054512-01): a northern star-chart mural, a periodic-table
style classroom chart and a triptych of vintage science-kit posters. Runtime derivative (crop / resize / atlas pack only) built by
`tools/asset-pipeline/skyways-stores/science/build-science-art.mjs`; provenance with the prompts and source hashes:
`assets/derivatives/skyways-store-art-20261107.json` (section `stores.science`). The raw generations stay private (studio reference task folder).

- `assets/textures/skyways/stores/science/science-art.jpg` — the star map, the chart and the three kit posters.
- Unapproved prototypes; provider terms apply; no commercial clearance implied.
<!-- END skyways-store-science-art-20261107 -->

<!-- BEGIN skyways-store-music-art-20261107 (build-music-art.mjs, lane STORE-MUSIC) -->
## Skyways major store Northern Groove Records: record covers, gig posters and signs
Six static art sheets generated for this project with Codex native image_gen (owned Codex CLI; 6 calls, 6 accepted) under the Skyways
store lanes' art authorization (task studio-alpha-skyways-shops-20261107-054512-01): 64 original fictional LP covers (four 4 x 4
sheets, no text, no real artists or artwork requested), four fictional gig posters, and the NEW ARRIVALS / LISTENING BOOTHS boards and
eight genre cards. Runtime derivatives (crop / resize / atlas pack only) built by
`tools/asset-pipeline/skyways-stores/music/build-music-art.mjs`; provenance with the prompts and source hashes:
`assets/derivatives/skyways-store-art-20261107.json` (section `stores.music`). The raw generations stay private (studio reference task folder).

- `assets/textures/skyways/stores/music/music-covers.jpg` — the 64 cover faces of the record-bin stock and the new-arrivals wall.
- `assets/textures/skyways/stores/music/music-signs.jpg` — the gig posters, the two boards and the genre cards.
- Bands, venues and covers are invented. Unapproved prototypes; provider terms apply; no commercial clearance implied.
<!-- END skyways-store-music-art-20261107 -->

<!-- BEGIN skyways-store-books-art-20261107 (build-books-art.mjs, lane STORE-BOOKS) -->
## Skyways major store Paper Prairie Books: category signs and rugs
Two static art sheets generated for this project with Codex native image_gen (owned Codex CLI; 2 calls, 2 accepted) under the Skyways
store lanes' art authorization (task studio-alpha-skyways-shops-20261107-054512-01): eight carved walnut category signs (invented shop
signage) and two area rugs (a worn reading-room rug, a children's prairie play rug). Runtime derivative (crop / resize / atlas pack
only) built by `tools/asset-pipeline/skyways-stores/books/build-books-art.mjs`; provenance with the prompts and source hashes:
`assets/derivatives/skyways-store-art-20261107.json` (section `stores.books`). The raw generations stay private (studio reference task folder).

- `assets/textures/skyways/stores/books/skyways-store-books-art.jpg` — the signs and the rugs.
- Unapproved prototypes; provider terms apply; no commercial clearance implied.
<!-- END skyways-store-books-art-20261107 -->

<!-- BEGIN skyways-store-cinema-art-20261107 (build-art.mjs, lane STORE-CINEMA) -->
## Skyways major store Aurora Picture House: now-showing posters and the concession board
Five original flat artworks generated for this project with Codex native image_gen (owned Codex CLI), one call per piece, under the
Skyways store lanes' art authorization (task studio-alpha-skyways-shops-20261107-054512-01). The films, titles and taglines are
invented (no real films, studios, actors or brands). Runtime derivative (crop / resize / JPEG atlas pack only) built by
`tools/asset-pipeline/skyways-stores/cinema/build-art.mjs`; provenance with the Codex threads, prompt and source hashes:
`assets/derivatives/skyways-store-art-20261107.json` (section `stores.cinema`). The raw generations stay private (studio reference task folder).

- `assets/textures/skyways/stores/cinema/cinema-art.jpg` — four film posters ("The Coulee Kid", "The Hoppers", "Moonlight on the
  Midway", "Skywalk at Midnight") and the art-deco REFRESHMENTS concession board.
- Unapproved prototypes; provider terms apply; no commercial clearance implied.
<!-- END skyways-store-cinema-art-20261107 -->

<!-- BEGIN head-hit-audio-20261107 (headhit-build.mjs) -->
## Head-hit audio (skull crack)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the general
feedback task's local Sound Lab allowance (2 jobs of a 4-job cap). Powered by Stability AI. Stability AI Community
License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by `tools/audio-pipeline/headhit-build.mjs` (provenance: `assets/derivatives/audio-head-hit.json`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/head-hit-01.mp3` — headHit (Sound Lab job 20261107T232716-256099295)
- `assets/audio/head-hit-02.mp3` — headHit (Sound Lab job 20261107T232721-253643819)
<!-- END head-hit-audio-20261107 -->

<!-- BEGIN market-bar-audio-20261108 (market-audio-build.mjs) -->
## Market audio (cash register, crowd murmur, panic screams, angry grunts, retch)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the market bar
task's local Sound Lab allowance (6 jobs of a 12-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by `tools/audio-pipeline/market-audio-build.mjs` (provenance: `assets/derivatives/audio-market-bar.json`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/market-cash-01.mp3` — marketCash (Sound Lab job 20261108T231710-315953922)
- `assets/audio/market-cash-02.mp3` — marketCash (Sound Lab job 20261108T231710-315953922)
- `assets/audio/market-chatter-loop.mp3` — marketChatter (Sound Lab job 20261108T231715-332510952)
- `assets/audio/market-bar-chatter-loop.mp3` — marketBarChatter (Sound Lab job 20261108T231720-1480472885)
- `assets/audio/market-scream-01.mp3` — marketScream (Sound Lab job 20261108T231724-174431427)
- `assets/audio/market-scream-02.mp3` — marketScream (Sound Lab job 20261108T231724-174431427)
- `assets/audio/market-scream-03.mp3` — marketScream (Sound Lab job 20261108T231724-174431427)
- `assets/audio/market-scream-04.mp3` — marketScream (Sound Lab job 20261108T231724-174431427)
- `assets/audio/market-scream-05.mp3` — marketScream (Sound Lab job 20261108T231724-174431427)
- `assets/audio/market-grunt-01.mp3` — marketGrunt (Sound Lab job 20261108T231729-1404249699)
- `assets/audio/market-grunt-02.mp3` — marketGrunt (Sound Lab job 20261108T231729-1404249699)
- `assets/audio/market-grunt-03.mp3` — marketGrunt (Sound Lab job 20261108T231729-1404249699)
- `assets/audio/market-retch-01.mp3` — marketRetch (Sound Lab job 20261108T231733-622219597)
<!-- END market-bar-audio-20261108 -->

<!-- BEGIN bunker-kit-20261109 (build-bunker-kit.mjs) -->
## The Bunker: flavour models

Generated for this project with Meshy T2.5 (smart topology; image-to-3D from a Codex initial reference image, 2K PBR) through the Meshy MCP under the Bunker's approved select-flavour budget (1 generation attempt, 15 credits billed). Runtime derivatives built by `tools/asset-pipeline/props/build-bunker-kit.mjs` (provenance: `assets/derivatives/bunker-kit-20261109.json`). Provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters and the reference image are kept outside Git.

- `assets/models/bunker-mainframe-tape-cabinet.glb` — bunker: retro reel-to-reel mainframe tape cabinet (sealed computer equipment; its louvred doors are service panels) (Meshy task 01a1bfc1-3a2f-773a-a458-f2cdadf1b1fc)
<!-- END bunker-kit-20261109 -->

<!-- BEGIN gun-variety-audio-20261110 (gun-variety-build.mjs) -->
## Weapon-variety gun audio (shots, magazine out / in, break open / close)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the gun audio
task's local Sound Lab allowance (17 jobs of a 24-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by `tools/audio-pipeline/gun-variety-build.mjs` (provenance: `assets/derivatives/audio-gun-variety.json`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/gun-longslide-shot-01.mp3` — gunLongslideShot (Sound Lab job 20261110T064241-184262446)
- `assets/audio/gun-stub-shot-01.mp3` — gunStubShot (Sound Lab job 20261110T064246-2014766852)
- `assets/audio/gun-stub-shot-02.mp3` — gunStubShot (Sound Lab job 20261110T064251-529127606)
- `assets/audio/gun-overwatch-shot-01.mp3` — gunOverwatchShot (Sound Lab job 20261110T064255-445153277)
- `assets/audio/gun-coach-gun-shot-01.mp3` — gunCoachGunShot (Sound Lab job 20261110T064300-1564851814)
- `assets/audio/gun-thresher-shot-01.mp3` — gunThresherShot (Sound Lab job 20261110T064304-171167837)
- `assets/audio/gun-hornet-mag-out-01.mp3` — gunHornetMagOut (Sound Lab job 20261110T064309-1029141341)
- `assets/audio/gun-hornet-mag-in-01.mp3` — gunHornetMagIn (Sound Lab job 20261110T064309-1029141341)
- `assets/audio/gun-longslide-mag-out-01.mp3` — gunLongslideMagOut (Sound Lab job 20261110T064313-1006943679)
- `assets/audio/gun-longslide-mag-in-01.mp3` — gunLongslideMagIn (Sound Lab job 20261110T064313-1006943679)
- `assets/audio/gun-stub-mag-out-01.mp3` — gunStubMagOut (Sound Lab job 20261110T064318-1579386861)
- `assets/audio/gun-stub-mag-in-01.mp3` — gunStubMagIn (Sound Lab job 20261110T064318-1579386861)
- `assets/audio/gun-overwatch-mag-out-01.mp3` — gunOverwatchMagOut (Sound Lab job 20261110T064323-1092673271)
- `assets/audio/gun-overwatch-mag-in-01.mp3` — gunOverwatchMagIn (Sound Lab job 20261110T064323-1092673271)
- `assets/audio/gun-thresher-mag-out-01.mp3` — gunThresherMagOut (Sound Lab job 20261110T064327-733333169)
- `assets/audio/gun-thresher-mag-in-01.mp3` — gunThresherMagIn (Sound Lab job 20261110T064327-733333169)
- `assets/audio/gun-coach-gun-break-open-01.mp3` — gunCoachGunBreakOpen (Sound Lab job 20261110T064332-741355159)
- `assets/audio/gun-coach-gun-break-close-01.mp3` — gunCoachGunBreakClose (Sound Lab job 20261110T064332-741355159)
- `assets/audio/gun-hornet-shot-01.mp3` — gunHornetShot (Sound Lab job 20261110T064738-1979131141)
- `assets/audio/gun-hornet-shot-02.mp3` — gunHornetShot (Sound Lab job 20261110T065448-1388891472)
<!-- END gun-variety-audio-20261110 -->

<!-- BEGIN screacher-audio-20261110 (screacher-build.mjs) -->
## Screacher audio (echo scream, frenzy shriek, idle wheeze, death gurgle)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the Screacher
task's local Sound Lab allowance (11 jobs of a 12-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by `tools/audio-pipeline/screacher-build.mjs` (provenance: `assets/derivatives/audio-screacher.json`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/screacher-scream-01.mp3` — screacherScream (Sound Lab job 20261110T225101-1517457293)
- `assets/audio/screacher-scream-02.mp3` — screacherScream (Sound Lab job 20261110T225445-2120082079)
- `assets/audio/screacher-scream-03.mp3` — screacherScream (Sound Lab job 20261110T225449-1208249476)
- `assets/audio/screacher-shriek-01.mp3` — screacherShriek (Sound Lab job 20261110T225459-1708136229)
- `assets/audio/screacher-shriek-02.mp3` — screacherShriek (Sound Lab job 20261110T225645-1982763445)
- `assets/audio/screacher-wheeze-01.mp3` — screacherWheeze (Sound Lab job 20261110T225115-1531970516)
- `assets/audio/screacher-wheeze-02.mp3` — screacherWheeze (Sound Lab job 20261110T225503-1765310184)
- `assets/audio/screacher-wheeze-03.mp3` — screacherWheeze (Sound Lab job 20261110T225503-1765310184)
- `assets/audio/screacher-death-01.mp3` — screacherDeath (Sound Lab job 20261110T225119-1271740027)
<!-- END screacher-audio-20261110 -->

<!-- BEGIN enemy-screacher-20261110 (build-screacher.mjs) -->
## The Screacher (enemy, four bodies)

One enemy with four approved bodies. Each was generated for this project with Meshy T2.5 image-to-3D (smart topology, 2K PBR; 1 attempt and 15 credits each) through the Meshy MCP under the user's task authorization, conditioned on the project's own user-approved concept image of that body (a Codex native image generation). Rigged and animated locally on CPU by `tools/asset-pipeline/enemy/build-screacher.mjs`: the shared 18-joint skeleton, automatic skin weights and hand-authored procedural clips (not motion capture); the provider's texture maps are resized / re-encoded only (hash-only provenance: `assets/derivatives/enemy-screacher-<variant>.json`). AI-generated assets: provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters, provider maps and the input images are kept outside Git.

- `assets/models/enemy-screacher-sc01.glb` — Screacher SC01 "Hollow Commuter": a headless commuter in a torn suit jacket, shirt and tie (Meshy task 01a1c79e-a37b-7105-bfd5-f5ccc500aa07)
- `assets/models/enemy-screacher-sc02.glb` — Screacher SC02 "Track Ganger": a headless track worker in orange hi-vis coveralls and work boots (Meshy task 01a1c79e-ab85-767c-bb51-d32482b9d9cf)
- `assets/models/enemy-screacher-sc03.glb` — Screacher SC03 "Lopsided Sleeper": a headless, lopsided sleeper in a vest and striped pyjama trousers, barefoot (Meshy task 01a1c79e-b350-7726-8c6b-9ed1cccd1ef8)
- `assets/models/enemy-screacher-sc04.glb` — Screacher SC04 "Long-Stride Runner": a headless runner in a track jacket, shorts and trainers (Meshy task 01a1c79d-2dc8-7345-b577-f12daca5f86f)
<!-- END enemy-screacher-20261110 -->

<!-- BEGIN train-chipper-audio-20261111 (chipper-build.mjs) -->
## Train chipper audio (motor loop, wet grind loop, body feed, spin-up, wind-down)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the chipper
task's local Sound Lab allowance (5 jobs of a 12-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by `tools/audio-pipeline/chipper-build.mjs` (provenance: `assets/derivatives/audio-chipper.json`). Not reviewed
by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/chipper-motor-loop.mp3` — chipperMotor (Sound Lab job 20261111T004007-1737009476)
- `assets/audio/chipper-grind-loop.mp3` — chipperGrind (Sound Lab job 20261111T004011-142679025)
- `assets/audio/chipper-feed.mp3` — chipperFeed (Sound Lab job 20261111T004016-858651419)
- `assets/audio/chipper-start.mp3` — chipperStart (Sound Lab job 20261111T004021-456234135)
- `assets/audio/chipper-stop.mp3` — chipperStop (Sound Lab job 20261111T004025-1134923694)
<!-- END train-chipper-audio-20261111 -->

<!-- BEGIN refinement-batch-models-20261113 (build-refinement-batch.mjs) -->
## Refinement batch: train armour and crafted throwables

Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded; the two train armour models' base colour maps carry the armour's deterministic palette grade `train-armor-palette-20261113` of task studio-train-armor-palette-20261113-213306-01 — `tools/asset-pipeline/props/lib/armor-palette.mjs`: toward the car body's own weathered steel, rust kept as accents, nothing generated). Task studio-refinement-batch-20261113-035659-01 under the user's fresh 75-credit grant (60 credits billed, 4 generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by `tools/asset-pipeline/props/build-refinement-batch.mjs` (provenance: `assets/derivatives/refinement-batch-20261113.json`). The train's Save terminal reuses the existing `assets/models/p7-crt-terminal-t25.glb`.

- `assets/models/train-armor-side.glb` — the train armour's side skirt segment (welded rusted plates, a row of blades and spikes, two saw discs; tiled along both sides) (Meshy task 01a1d329-053b-762d-8771-d28ea8556025).
- `assets/models/train-armor-end.glb` — the train armour's end plough (welded pilot grille with long tapered fins and two saw discs; one at each end of the car) (Meshy task 01a1d32e-47f0-74a7-a4c3-ac4c63fbd0d1).
- `assets/models/item-acid-grenade.glb` — the Acid Scrapper Grenade (caged glass jar of green acid, taped cap and pull ring) (Meshy task 01a1d328-eb53-76e4-a8aa-8ee1d0203353).
- `assets/models/item-lure-grenade.glb` — the Zombie Lure (a cloth- and rope-wrapped tin with a perforated lid, wick and pull ring) (Meshy task 01a1d32d-c1a9-75a5-8ffe-678159e349e7).
<!-- END refinement-batch-models-20261113 -->

<!-- BEGIN enemy-bb-20261113 (build-bb.mjs) -->
## The BB (enemy, four bodies)

One enemy family with four bodies. Each was generated for this project with Meshy T2.5 image-to-3D (smart topology, 2K PBR; 1 attempt and 15 credits each) through the Meshy MCP under the user's task authorization, conditioned on a standing reference image of the user-selected concept look (a Codex native image generation). Rigged and skinned locally on CPU by `tools/asset-pipeline/enemy/build-bb.mjs`: the shared 18-joint skeleton (joints measured on each body) and automatic skin weights; no animation clips are baked (the game poses the body at runtime); the provider's texture maps are resized / re-encoded only (hash-only provenance: `assets/derivatives/enemy-bb-<variant>.json`). AI-generated assets: provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters, provider maps and the input images are kept outside Git.

- `assets/models/enemy-bb-lullaby.glb` — BB "Lullaby": a porcelain-doll-like toddler in a yellowed lace christening smock, puffed sleeves, ribboned bloomers, a frilled lace bonnet and grey knitted stockings (Meshy task 01a1d238-d41c-7639-a90a-89eee05f533c)
- `assets/models/enemy-bb-binky.glb` — BB "Binky": a skinny big-headed toddler in a torn oversized orange hi-vis vest worn as a smock, striped leggings and a pacifier on a cord (Meshy task 01a1d238-dbe9-75fb-80a8-31186ca71e65)
- `assets/models/enemy-bb-teddy.glb` — BB "Teddy": a top-heavy toddler in a fuzzy hand-knitted brown bear-suit romper with a deep eared hood and mismatched buttons (Meshy task 01a1d238-e41c-7526-8481-9f7377b26d46)
- `assets/models/enemy-bb-changeling.glb` — BB "Changeling": a stocky wrinkled old-faced toddler in a quilted navy hooded snowsuit with patched knees, a striped undershirt, fingerless mittens and knitted booties (Meshy task 01a1d238-ec04-76ee-a49d-62e84a27a0e0)
<!-- END enemy-bb-20261113 -->

<!-- BEGIN bb-audio-20261113 (bb-build.mjs) -->
## BB audio (cackle, giggle, pounce squeal, hurt squawk, wind-down death)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the BB task's
audio authorization (the free local service only; 23 jobs, 16 takes shipped). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by `tools/audio-pipeline/bb-build.mjs` (provenance: `assets/derivatives/audio-bb.json`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

- `assets/audio/bb-cackle-01.mp3` — bbCackle (Sound Lab job 20261113T002431-822573182)
- `assets/audio/bb-cackle-02.mp3` — bbCackle (Sound Lab job 20261113T002640-2049682736)
- `assets/audio/bb-cackle-03.mp3` — bbCackle (Sound Lab job 20261113T002645-1200815533)
- `assets/audio/bb-cackle-04.mp3` — bbCackle (Sound Lab job 20261113T002650-749044461)
- `assets/audio/bb-giggle-01.mp3` — bbGiggle (Sound Lab job 20261113T002436-561658655)
- `assets/audio/bb-giggle-02.mp3` — bbGiggle (Sound Lab job 20261113T002440-1543757455)
- `assets/audio/bb-giggle-03.mp3` — bbGiggle (Sound Lab job 20261113T002654-283085158)
- `assets/audio/bb-giggle-04.mp3` — bbGiggle (Sound Lab job 20261113T002659-800409814)
- `assets/audio/bb-pounce-01.mp3` — bbPounce (Sound Lab job 20261113T002703-1712363872)
- `assets/audio/bb-pounce-02.mp3` — bbPounce (Sound Lab job 20261113T002956-16607901)
- `assets/audio/bb-pounce-03.mp3` — bbPounce (Sound Lab job 20261113T003000-1698090508)
- `assets/audio/bb-hurt-01.mp3` — bbHurt (Sound Lab job 20261113T002454-240541345)
- `assets/audio/bb-hurt-02.mp3` — bbHurt (Sound Lab job 20261113T002717-1834050305)
- `assets/audio/bb-hurt-03.mp3` — bbHurt (Sound Lab job 20261113T002722-151840185)
- `assets/audio/bb-death-01.mp3` — bbDeath (Sound Lab job 20261113T002726-147471791)
- `assets/audio/bb-death-02.mp3` — bbDeath (Sound Lab job 20261113T002731-1936675290)
<!-- END bb-audio-20261113 -->

<!-- BEGIN train-armor-makeover-20261113 (build-train-armor-makeover.mjs) -->
## Train armour makeover: body plates, buttress posts, plough wings and roof-line rails

Generated for this project from one Codex INITIAL design image each (the owned Codex CLI's built-in image_gen tool) turned into models with Meshy T2.5 image-to-3D (smart topology, 2K PBR) through the Meshy MCP; every model keeps Meshy's own PBR maps (re-encoded; the base colour maps carry the armour's deterministic palette grade `train-armor-palette-20261113` of task studio-train-armor-palette-20261113-213306-01 — `tools/asset-pipeline/props/lib/armor-palette.mjs`: toward the car body's own weathered steel, rust kept as accents, nothing generated). Task studio-train-armor-makeover-20261113-183146-01 under the user's fresh 75-credit grant (60 credits billed, 4 generations, each a first attempt). AI-generated assets: unapproved prototypes, no licence or commercial clearance implied. The raw masters, conditioning images and job ledger are kept outside Git. Runtime derivatives by `tools/asset-pipeline/props/build-train-armor-makeover.mjs` (provenance: `assets/derivatives/train-armor-makeover-20261113.json`). The kit's skirt strip and fin grille are the refinement batch's `assets/models/train-armor-side.glb` and `assets/models/train-armor-end.glb`, reused as they are.

- `assets/models/train-armor-plate.glb` — the train armour's body plate (a layered, bolted steel slab with a saw disc and a row of fins; overlapping along both sides of the lower body) (Meshy task 01a1d655-52bc-7151-b956-07f65aa3f646).
- `assets/models/train-armor-post.glb` — the train armour's buttress post (an I-beam girder on a bolted plate with three hooked fins; the window pillars, the plough's corner towers and its prow) (Meshy task 01a1d655-6dec-744e-8be9-2517efb37ea3).
- `assets/models/train-armor-wing.glb` — the train armour's plough wing (a mouldboard panel with six swept fins, a saw disc and a toothed wear bar; two per end form the wedge plough) (Meshy task 01a1d655-873d-70b0-b1af-e16e8a2c5802).
- `assets/models/train-armor-rail.glb` — the train armour's roof-line rail (a bolted box beam with a row of six raked fins; along both sides under the roof and across each end over the windscreen) (Meshy task 01a1d666-3848-7624-92cd-106b831a4ffc).
<!-- END train-armor-makeover-20261113 -->
