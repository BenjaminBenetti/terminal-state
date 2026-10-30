# Meshy T2.5 game replacement — INVENTORY (complete, 2026-10-29T21:25:11Z)

Lane INVENTORY of `studio-meshy-game-replacement-20261029-01`. Base `a7a646a1dd62bf1c641fe3dd0d1187ab322afe87` (tracked and on pushed `origin/main`). Machine-readable twin: `inventory.json` (same folder). Read-only lane: no Meshy/generation calls, no game-file edits, no git writes, no browser.

## Summary

| Count | Value |
|---|---|
| Runtime GLBs in `game/public/assets/models` | 186 |
| Used at runtime (referenced by the bundle AND rendered) | 174 |
| Used AND locally 3D-generated (Pixal3D native SV/MV) | 145 |
| Unique source masters = Meshy jobs if all done (one per master) | 145 |
| Required runtime derivatives (GLB files to rebuild) | 145 (incl. 57 per-body fitted garment variants inside the 15 outfit GLBs) |
| Masters with a verified original image (`ready`) | 144 |
| Missing reference | 1 |
| Ambiguous origin | 0 |
| Needs crop | 0 |
| Excluded GLBs | 41 (unreferenced 11, loaded-not-rendered 1, meshy-office 25, user-weapon 3, procedural 1) |
| **Planned credits** (ready x 15, before any documented retry) | **2160** |
| Pilot (recommended first) | 7 jobs = 105 credits |

By class: openable prop 14, prop 91, shelf/holder 10, consumable item 7, light fixture 1, character body (rigged) 6, garment/outfit (fitted/rigged) 15, creature (rigged) 1. By local generation mode: SV 58, MV 86, unknown (settings not provided with the GLB) 1.

Every chosen original image exists and its sha256 recomputed now **matches the recorded hash** (144/144). No crop, conversion or new image is needed for any ready master. All 145 masters have their lossless native master preserved outside Git (`.cache/iteration07-native-masters/`, `reference/tasks/*/native/asset.glb.xz`, `public/vision-board/models/`, `reference/assets/masters/`).

## How usage and provenance were established

- **Usage:** (1) fresh `vite build` of the a7a646a tree -> `dist/game/assets/index-CkHdqGhz.js` (identical hash to the pre-commit build): 175 of 186 GLB paths present, the 11 absent ones are exactly the packager-excluded list; (2) code-path tracing — every master lists `file:line` proofs (manifest/catalog entry, loader, consumer); (3) pure-data seed sweep of both level generators (24 subway seeds `generateStation`, 12 office seeds `generateOfficeLevel`): all 100 p7 kinds placed in Subway (Office places 62), every base kind placed, zombies 675/475 and rat-dogs 27/31 (subway/office). Zombie looks use one `DEFAULT_ZOMBIE_POOL` (all six bodies weight 1) in both levels; a garment is reachable on every body it has a shipped fitted variant for.
- **Local generator:** Pixal3D native (`raven38/pixal3d.cpp`, F16 weights, 1024, 24 steps/flow, seed 42, GSS 10, FoV 20) on the user's desktop GPU endpoint, single-view (SV) or four-view (MV). Conditioning images were made with Codex native image_gen (iterations 02-07) or the vision-board image rounds (iteration 01). Evidence per master: derivative provenance JSON, generation ledger / native intent / job metadata.
- **Original image rule applied:** SV jobs -> the sole submitted image. MV jobs -> the slot-0 / azimuth-0 FRONT view that was actually submitted (iteration 07: `panels/TL.png`, a lossless crop of the 2x2 sheet made by the original pipeline at generation time; iteration 01: `view00.png` / `inputs/input-00.png`, original-pixel crops prepared at generation time). The 2x2 sheets are listed only as collages (not for submission); the other genuine views are recorded per master in `otherOriginalViews`.
- **Meshy args (every job):** `meshy_image_to_3d`, `file_path` = the absolute image path below, `model_type smart-topology`, `ai_model meshy-t2.5`, `should_texture true`, `enable_pbr true`, `texture_resolution 2k`, `target_formats ["glb"]`, `response_format json`, `target_polycount` per row. `pose_mode "a-pose"` ONLY for the five human bodies (references already show A-pose and the rig binds in A-pose). 15 credits each.
- `/workspace/shared` does not exist on this pod (not consulted).

## Missing / ambiguous references

- **body:scavenger** (`game/public/assets/models/zombie-body-scavenger.glb`) — MISSING REFERENCE. Original conditioning image was never retained: user-run Pixal3D job from a web-ChatGPT image; the PNG and prompt were not uploaded (reference/design/ASSET-PIPELINE.md:60).
  - available (not an original image): master GLB (user-uploaded Pixal3D output: textured, T-pose; generation settings unknown) — `reference/assets/masters/zombie-pixal3d.glb`
  - available (not an original image): GLB embedded 4096 base-colour texture (UV atlas, not a view) — `inside reference/assets/masters/zombie-pixal3d.glb`
  - available (not an original image): renders of the current/old model (would be renders, NOT originals) — `none located as a front reference; could be rendered from the master`
  - options for Main/user: Keep the current scavenger body (no Meshy job) — recommended default; Main asks the user for the original ChatGPT PNG; Explicit user approval to condition on a render of the old model, labelled as a render (not an original).
- Ambiguous origins: **none** among used models. (Note: the scavenger is Pixal3D-generated but by the user outside a recorded project job; it is in scope only if the user counts it as "our local 3D model gen" — its missing image blocks it either way.)

## Pilot recommendation

| # | Master | Why | Image | Poly |
|---|---|---|---|---|
| 1 | `base:trashCan` | openable prop, SV, iterations 02-05 builder; model-backed lid hinge (openablesSpec bin) — most-placed holder (688 subway / 318 office placements in the sweep) | `reference/tasks/vertical-slice-iteration04-20261026/generation/trashCan/image/trashCan-original.png` | 5000 |
| 2 | `p7:filingCabinet` | openable prop, MV front-panel reference, iteration-07 builder; four sliding drawers cut by region boxes — validates the p7 pipeline + drawer re-measurement; placed in both levels | `reference/tasks/vertical-slice-iteration07-20261026/generation/filingCabinet/panels/TL.png` | 6000 |
| 3 | `base:item_water` | consumable item (SV); validates small-item polycount/scale fit (fitItemModel) and label/transparency fidelity | `reference/tasks/vertical-slice-iteration03-20261026/generation/water/image/water-original.png` | 2000 |
| 4 | `base:light` | the only light fixture; MV front of a thin linear fixture (depth inferred) instanced at every non-virtual light in both levels — highest-risk single asset, check early | `reference/assets/generated/final-environment-mv-f16-01/env-light-03/view00.png` | 3000 |
| 5 | `body:heavyset` | rigged character body (A-pose reference, pose_mode a-pose); carries the most fitted garments (14) — validates local re-rig + clips + hit calibration (not the lastshift calibration reference) | `reference/tasks/vertical-slice-iteration06-20261026/generation/bodyUnderwearA/image/bodyUnderwearA-original.png` | 20000 |
| 6 | `garment:hoodie` | fitted upper garment (4 bodies incl. heavyset); validates the fit07 refit gate and per-body skinning on new topology | `reference/tasks/vertical-slice-iteration05-20261026/generation/outfitHoodie/image/outfitHoodie-original.png` | 15000 |
| 7 | `creature:ratdog` | the only creature; quadruped re-rig (25 joints, procedural clips) on a new mesh | `reference/assets/generated/quadruped-02-24step-01/input.png` | 15000 |

Pilot = 105 credits. Covers every class actually present: SV and MV references, both prop builders (iterations 02-05 and 07), lid-hinge and drawer openables, a consumable, the light fixture, a rigged body, a fitted garment and the creature. Optional adds if budget allows: base:cabinetTall (runtime door split from mesh, MV); garment:hardhat (rigid headwear on Head bone); p7 SV wall-mount e.g. p7:aedWallCabinet (glazed door hinge). Accept/reject against the original image (silhouette, colours, wear) plus CPU geometry/rig checks before queueing the rest.

## Integration contracts (what reintegration must preserve)

- **Props (all):** metres, +Y up, front +Z, origin bottom-centre (y=0 contact), identity node transform; footprint/collider = `PROP_DEFS` / `P7_PROP_DEFS` (p7: measured catalog dims in `gen/props07.catalog.ts`); runtime budgets p7 small/medium/large 1.5k/4k/6k tris with 512/768/1024 atlases; loot surfaces are MEASURED from the mesh (`surfaces` in the catalog / `measuredSurfaces` per master) and must be re-measured; damage class/breakability per master.
- **Model-backed openables (9 p7 + trash can + drinks cooler):** moving parts are cut at runtime from the mesh by `region` boxes in `world/openablesSpec.ts` (hinge/slide pivots, plates, cavities listed per master). New geometry must place the door/lid/drawer inside those regions or the regions must be re-measured; no solid baked front when open.
- **Runtime-split containers:** `cabinetTall`/`cabinetLow` doors and the crate lid are partitioned from the mesh at runtime (`world/containers.ts`: door rectangle + seam, `CRATE_LID_SPLIT_Y` 0.817 x h) — re-measure. `shelf.glb` is ALSO the interior insert of both cabinets and the stockShelf frame; `tech-display.glb` renders `deviceWall` and its deck feeds filler stock; `shop-counter.glb` is the base under every shopDisplay; `turnstile` needs `TURNSTILE_CABINET_OFFSET` re-measured.
- **Hybrids:** `shop-cooler-open.glb` / `shop-display-open.glb` = exterior of the iteration-04 master + authored interior/wire shelves + transparent `glass` node (`open-front-iteration05.mjs`); rebuild from the new master. Light: `light-lod2.glb` is an 894-tri LOD with origin TOP-centre; its bbox sizes the fixture material/tubes.
- **Bodies (6):** 18-joint skeleton (Root, Hips, Spine, Chest, Neck, Head, L/R UpperArm/Forearm/Hand, L/R Thigh/Shin/Foot), A-pose bind, clips Idle/Walk/Run/Attack/Hit/Death, ~15k tris, origin between feet, facing +Z; hit radii from mesh extras x `HIT_CALIBRATION` (lastshift = `REFERENCE_HIT` calibration body); heavyset/tall `requires: lower`. Static Meshy output must be re-rigged locally (no paid rigging).
- **Garments (15):** one SkinnedMesh per supported body bound to that body's skeleton (node `Outfit_<id>__<body>`); cloth refitted outside the posed body and validated in 92 poses (`lib/fit07.mjs`), pairs that clip are not shipped, `incompatibleWear` extras; head/face items rigid on the Head bone fitted to the measured cranium. Old vertex masks/weights are not reusable. Bodies must be regenerated BEFORE their garments are refitted.
- **Creature:** 25-joint quadruped rig (landmark auto-placed), procedural IK clips, ~12k tris, hit radii in `creature-ratdog.json`.
- Restoration map: every master/derivative carries `restore` = {path, blob sha1 at a7a646a, last commit touching it, `git show a7a646a:<path>`}; all 145 runtime derivatives are tracked in a7a646a which is on pushed `origin/main`.

Image paths: `rt/vs-` = `reference/tasks/vertical-slice-`. Levels: S = Subway, O = Office Space (seed sweep). Hash = recomputed sha256 vs recorded.

## Character body (rigged) (6)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `body:agent` | `zombie-body-agent.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/bodyAgent/image/bodyAgent-original.png` | 1254x1254 | match | 14972 | 20000 | ready |
| `body:courier` | `zombie-body-courier.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/bodyCourier/image/bodyCourier-original.png` | 1254x1254 | match | 14956 | 20000 | ready |
| `body:heavyset` | `zombie-body-heavyset.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/bodyUnderwearA/image/bodyUnderwearA-original.png` | 1254x1254 | match | 14962 | 20000 | ready |
| `body:lastshift` | `zombie-body-lastshift.glb` | SV | S+O | `reference/assets/generated/zombie-body-03-24step-01/input.png` | 1254x1254 | match | 14912 | 20000 | ready |
| `body:scavenger` | `zombie-body-scavenger.glb` | unknown | S+O | — | — | — | 14767 | — | missing-reference |
| `body:tall` | `zombie-body-tall.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/bodyUnderwearB/image/bodyUnderwearB-original.png` | 1254x1254 | match | 14960 | 20000 | ready |

## Garment/outfit (fitted/rigged) (15)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `garment:beanie` | `outfit-beanie.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/headBeanie/image/headBeanie-original.png` | 1254x1254 | match | 10970 (5 x 2194) | 6000 | ready |
| `garment:blazer` | `outfit-blazer.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/outfitBlazer/image/outfitBlazer-original.png` | 1254x1254 | match | 29840 (4 x 7460) | 15000 | ready |
| `garment:cap` | `outfit-cap.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/headCap/image/headCap-original.png` | 1254x1254 | match | 10940 (5 x 2188) | 6000 | ready |
| `garment:cargo` | `outfit-cargo.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/lowerCargoPants/image/lowerCargoPants-original.png` | 1254x1254 | match | 23952 (4 x 5988) | 12000 | ready |
| `garment:coat` | `outfit-coat.glb` | SV | S+O | `reference/assets/generated/zombie-coat-03-24step-01/input.png` | 1254x1254 | match | 26568 (3 x 8856) | 15000 | ready |
| `garment:flannel` | `outfit-flannel.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/upperFlannel/image/upperFlannel-original.png` | 1254x1254 | match | 12936 (2 x 6468) | 15000 | ready |
| `garment:gasmask` | `outfit-gasmask.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/faceGasMask/image/faceGasMask-original.png` | 1254x1254 | match | 14680 (5 x 2936) | 6000 | ready |
| `garment:hardhat` | `outfit-hardhat.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/headHardHat/image/headHardHat-original.png` | 1254x1254 | match | 10950 (5 x 2190) | 6000 | ready |
| `garment:hivis` | `outfit-hivis.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/outfitHiVis/image/outfitHiVis-original.png` | 1254x1254 | match | 9856 (2 x 4928) | 15000 | ready |
| `garment:hoodie` | `outfit-hoodie.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/outfitHoodie/image/outfitHoodie-original.png` | 1254x1254 | match | 29544 (4 x 7386) | 15000 | ready |
| `garment:jeans` | `outfit-jeans.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/lowerJeans/image/lowerJeans-original.png` | 1254x1254 | match | 23960 (4 x 5990) | 12000 | ready |
| `garment:respirator` | `outfit-respirator.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/faceRespirator/image/faceRespirator-original.png` | 1254x1254 | match | 10965 (5 x 2193) | 6000 | ready |
| `garment:slacks` | `outfit-slacks.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/lowerSlacks/image/lowerSlacks-original.png` | 1254x1254 | match | 17922 (3 x 5974) | 12000 | ready |
| `garment:sweater` | `outfit-sweater.glb` | SV | S+O | `rt/vs-iteration06-20261026/generation/upperSweater/image/upperSweater-original.png` | 1254x1254 | match | 19182 (3 x 6394) | 15000 | ready |
| `garment:trench` | `outfit-trench.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/outfitTrench/image/outfitTrench-original.png` | 1254x1254 | match | 25470 (3 x 8490) | 15000 | ready |

## Creature (rigged) (1)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `creature:ratdog` | `creature-ratdog.glb` | SV | S+O | `reference/assets/generated/quadruped-02-24step-01/input.png` | 1536x1024 | match | 11796 | 15000 | ready |

## Light fixture (1)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `base:light` | `light-lod2.glb` | MV | S+O | `reference/assets/generated/final-environment-mv-f16-01/env-light-03/view00.png` | 1509x1509 | match | 894 | 3000 | ready |

## Consumable item (7)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `base:item_beans` | `item-beans.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/beans/image/beans-original.png` | 1254x1254 | match | 692 | 2000 | ready |
| `base:item_chips` | `item-chips.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/chips/image/chips-original.png` | 1254x1254 | match | 1198 | 2000 | ready |
| `base:item_chocolate` | `item-chocolate.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/chocolate/image/chocolate-original.png` | 1254x1254 | match | 600 | 2000 | ready |
| `base:item_cola` | `item-cola.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/cola/image/cola-original.png` | 1254x1254 | match | 678 | 2000 | ready |
| `base:item_juice` | `item-juice.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/juice/image/juice-original.png` | 1254x1254 | match | 700 | 2000 | ready |
| `base:item_noodles` | `item-noodles.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/noodles/image/noodles-original.png` | 1254x1254 | match | 900 | 2000 | ready |
| `base:item_water` | `item-water.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/water/image/water-original.png` | 1254x1254 | match | 994 | 2000 | ready |

## Openable prop (14)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `base:cabinetLow` | `cabinet-low.glb` | MV | S+O | `reference/assets/generated/cabinet-low-03-mv-01/inputs/input-00.png` | 1163x1163 | match | 6484 | 8000 | ready |
| `base:cabinetTall` | `cabinet-tall.glb` | MV | S+O | `reference/assets/generated/cabinet-tall-03-mv-01/inputs/input-00.png` | 744x744 | match | 6492 | 8000 | ready |
| `base:crate` | `crate.glb` | SV | S+O | `rt/vs-iteration02-20261025/generation/supply-crate/image/supply-crate-original.png` | 1254x1254 | match | 3994 | 5000 | ready |
| `base:shopCooler` | `shop-cooler-open.glb` | SV | S+O | `rt/vs-iteration04-20261026/generation/shopCooler/image/shopCooler-original.png` | 1254x1254 | match | 4228 | 8000 | ready |
| `base:trashCan` | `trash-can.glb` | SV | S+O | `rt/vs-iteration04-20261026/generation/trashCan/image/trashCan-original.png` | 1254x1254 | match | 2374 | 5000 | ready |
| `p7:aedWallCabinet` | `p7-aed-wall-cabinet.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/aedWallCabinet/image/aedWallCabinet-original.png` | 1254x1254 | match | 1498 | 3000 | ready |
| `p7:chestFreezer` | `p7-chest-freezer.glb` | MV | S | `rt/vs-iteration07-20261026/generation/chestFreezer/panels/TL.png` | 1072x1072 | match | 3904 | 6000 | ready |
| `p7:crashCart` | `p7-crash-cart.glb` | MV | S | `rt/vs-iteration07-20261026/generation/crashCart/panels/TL.png` | 880x880 | match | 3804 | 6000 | ready |
| `p7:filingCabinet` | `p7-filing-cabinet.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/filingCabinet/panels/TL.png` | 935x935 | match | 3999 | 6000 | ready |
| `p7:fireExtinguisherCabinet` | `p7-fire-extinguisher-cabinet.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/fireExtinguisherCabinet/image/fireExtinguisherCabinet-original.png` | 1254x1254 | match | 3981 | 6000 | ready |
| `p7:firstAidWallKit` | `p7-first-aid-wall-kit.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/firstAidWallKit/image/firstAidWallKit-original.png` | 1254x1254 | match | 1494 | 3000 | ready |
| `p7:newspaperVendingBox` | `p7-newspaper-vending-box.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/newspaperVendingBox/panels/TL.png` | 900x900 | match | 3974 | 6000 | ready |
| `p7:rollingToolChest` | `p7-rolling-tool-chest.glb` | MV | S | `rt/vs-iteration07-20261026/generation/rollingToolChest/panels/TL.png` | 899x899 | match | 3988 | 6000 | ready |
| `p7:wheelieBin` | `p7-wheelie-bin.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/wheelieBin/panels/TL.png` | 615x615 | match | 3968 | 6000 | ready |

## Shelf/holder (10)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `base:shelf` | `shelf.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/shelf/image/shelf-original.png` | 1254x1254 | match | 2740 | 6000 | ready |
| `base:shopBackbar` | `shop-backbar.glb` | SV | S | `rt/vs-iteration04-20261026/generation/shopBackbar/image/shopBackbar-original.png` | 1254x1254 | match | 5172 | 8000 | ready |
| `base:shopCounter` | `shop-counter.glb` | SV | S+O | `rt/vs-iteration04-20261026/generation/shopCounter/image/shopCounter-original.png` | 1254x1254 | match | 3976 | 6000 | ready |
| `base:shopDisplay` | `shop-display-open.glb` | SV | S+O | `rt/vs-iteration04-20261026/generation/shopDisplay/image/shopDisplay-original.png` | 1254x1254 | match | 1728 | 6000 | ready |
| `base:stall` | `stall.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/stall/image/stall-original.png` | 1254x1254 | match | 5602 | 12000 | ready |
| `base:techDisplay` | `tech-display.glb` | SV | S | `rt/vs-iteration05-20261026/generation/techDisplay/image/techDisplay-original.png` | 1254x1254 | match | 4964 | 8000 | ready |
| `base:vending` | `vending.glb` | SV | S+O | `rt/vs-iteration03-20261026/generation/vending/image/vending-original.png` | 1254x1254 | match | 7818 | 10000 | ready |
| `p7:busCart` | `p7-bus-cart.glb` | MV | S | `rt/vs-iteration07-20261026/generation/busCart/panels/TL.png` | 677x677 | match | 3966 | 6000 | ready |
| `p7:shoppingCart` | `p7-shopping-cart.glb` | MV | S | `rt/vs-iteration07-20261026/generation/shoppingCart/panels/TL.png` | 677x677 | match | 3760 | 6000 | ready |
| `p7:wheeledStretcher` | `p7-wheeled-stretcher.glb` | MV | S | `rt/vs-iteration07-20261026/generation/wheeledStretcher/panels/TL.png` | 1017x1017 | match | 5934 | 10000 | ready |

## Prop (91)

| Master | Runtime file | Mode | Levels | Original image (front) | px | Hash | Cur tris | Meshy poly | Status |
|---|---|---|---|---|---|---|---|---|---|
| `base:bench` | `bench.glb` | MV | S+O | `reference/assets/generated/final-environment-mv-f16-01/env-bench-03/view00.png` | 1227x1227 | match | 6998 | 8000 | ready |
| `base:janitorCart` | `janitor-cart.glb` | SV | S+O | `rt/vs-iteration05-20261026/generation/janitorCart/image/janitorCart-original.png` | 1254x1254 | match | 4958 | 8000 | ready |
| `base:turnstile` | `turnstile.glb` | SV | S+O | `rt/vs-iteration02-20261025/generation/turnstile/image/turnstile-original.png` | 1254x1254 | match | 5974 | 8000 | ready |
| `p7:airCompressor` | `p7-air-compressor.glb` | MV | S | `rt/vs-iteration07-20261026/generation/airCompressor/panels/TL.png` | 867x867 | match | 3880 | 6000 | ready |
| `p7:atmKiosk` | `p7-atm-kiosk.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/atmKiosk/panels/TL.png` | 920x920 | match | 5995 | 10000 | ready |
| `p7:babyStroller` | `p7-baby-stroller.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/babyStroller/panels/TL.png` | 637x637 | match | 3952 | 6000 | ready |
| `p7:basketStack` | `p7-basket-stack.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/basketStack/panels/TL.png` | 798x798 | match | 3950 | 6000 | ready |
| `p7:benchGrinderStand` | `p7-bench-grinder-stand.glb` | MV | S | `rt/vs-iteration07-20261026/generation/benchGrinderStand/panels/TL.png` | 940x940 | match | 3990 | 6000 | ready |
| `p7:bicycle` | `p7-bicycle.glb` | MV | S | `rt/vs-iteration07-20261026/generation/bicycle/panels/TL.png` | 1057x1057 | match | 5874 | 10000 | ready |
| `p7:bloodPressureKiosk` | `p7-blood-pressure-kiosk.glb` | MV | S | `rt/vs-iteration07-20261026/generation/bloodPressureKiosk/panels/TL.png` | 873x873 | match | 5988 | 10000 | ready |
| `p7:capsuleToyMachine` | `p7-capsule-toy-machine.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/capsuleToyMachine/panels/TL.png` | 942x942 | match | 3980 | 6000 | ready |
| `p7:cashRegister` | `p7-cash-register.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/cashRegister/panels/TL.png` | 755x755 | match | 1488 | 3000 | ready |
| `p7:cctvCamera` | `p7-cctv-camera.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/cctvCamera/panels/TL.png` | 862x862 | match | 1484 | 3000 | ready |
| `p7:coatRack` | `p7-coat-rack.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/coatRack/image/coatRack-original.png` | 1254x1254 | match | 5974 | 10000 | ready |
| `p7:coinCounter` | `p7-coin-counter.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/coinCounter/panels/TL.png` | 634x634 | match | 1480 | 3000 | ready |
| `p7:condimentStation` | `p7-condiment-station.glb` | MV | S | `rt/vs-iteration07-20261026/generation/condimentStation/panels/TL.png` | 1032x1032 | match | 1486 | 3000 | ready |
| `p7:conveyorToaster` | `p7-conveyor-toaster.glb` | MV | S | `rt/vs-iteration07-20261026/generation/conveyorToaster/panels/TL.png` | 823x823 | match | 3942 | 6000 | ready |
| `p7:crowdBarrier` | `p7-crowd-barrier.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/crowdBarrier/panels/TL.png` | 1153x1153 | match | 5996 | 10000 | ready |
| `p7:crtTerminal` | `p7-crt-terminal.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/crtTerminal/panels/TL.png` | 712x712 | match | 4000 | 6000 | ready |
| `p7:crtTvCart` | `p7-crt-tv-cart.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/crtTvCart/panels/TL.png` | 907x907 | match | 3982 | 6000 | ready |
| `p7:deepFryer` | `p7-deep-fryer.glb` | MV | S | `rt/vs-iteration07-20261026/generation/deepFryer/panels/TL.png` | 808x808 | match | 3992 | 6000 | ready |
| `p7:disconnectSwitch` | `p7-disconnect-switch.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/disconnectSwitch/image/disconnectSwitch-original.png` | 1254x1254 | match | 1470 | 3000 | ready |
| `p7:dripCoffeeMaker` | `p7-drip-coffee-maker.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/dripCoffeeMaker/panels/TL.png` | 623x623 | match | 1494 | 3000 | ready |
| `p7:drumFan` | `p7-drum-fan.glb` | MV | S | `rt/vs-iteration07-20261026/generation/drumFan/panels/TL.png` | 632x632 | match | 3864 | 6000 | ready |
| `p7:dryTransformer` | `p7-dry-transformer.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/dryTransformer/panels/TL.png` | 859x859 | match | 5976 | 10000 | ready |
| `p7:emergencyCallPoint` | `p7-emergency-call-point.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/emergencyCallPoint/panels/TL.png` | 938x938 | match | 3998 | 6000 | ready |
| `p7:espressoGrinder` | `p7-espresso-grinder.glb` | MV | S | `rt/vs-iteration07-20261026/generation/espressoGrinder/panels/TL.png` | 923x923 | match | 1474 | 3000 | ready |
| `p7:eyewashStation` | `p7-eyewash-station.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/eyewashStation/panels/TL.png` | 775x775 | match | 3998 | 6000 | ready |
| `p7:fareValidatorStand` | `p7-fare-validator-stand.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/fareValidatorStand/panels/TL.png` | 920x920 | match | 3998 | 6000 | ready |
| `p7:fareVaultCart` | `p7-fare-vault-cart.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/fareVaultCart/panels/TL.png` | 874x874 | match | 3970 | 6000 | ready |
| `p7:fieldPhoneBox` | `p7-field-phone-box.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/fieldPhoneBox/image/fieldPhoneBox-original.png` | 1254x1254 | match | 1470 | 3000 | ready |
| `p7:fireExtinguisher` | `p7-fire-extinguisher.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/fireExtinguisher/panels/TL.png` | 923x923 | match | 1484 | 3000 | ready |
| `p7:fireHoseReelCabinet` | `p7-fire-hose-reel-cabinet.glb` | SV | S | `rt/vs-iteration07-20261026/generation/fireHoseReelCabinet/image/fireHoseReelCabinet-original.png` | 1254x1254 | match | 3948 | 6000 | ready |
| `p7:floorBuffer` | `p7-floor-buffer.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/floorBuffer/panels/TL.png` | 890x890 | match | 3938 | 6000 | ready |
| `p7:floorScrubber` | `p7-floor-scrubber.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/floorScrubber/panels/TL.png` | 754x754 | match | 5940 | 10000 | ready |
| `p7:foldingBarricade` | `p7-folding-barricade.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/foldingBarricade/panels/TL.png` | 807x807 | match | 5978 | 10000 | ready |
| `p7:foldingChair` | `p7-folding-chair.glb` | MV | S | `rt/vs-iteration07-20261026/generation/foldingChair/panels/TL.png` | 910x910 | match | 3988 | 6000 | ready |
| `p7:gasCylinderCart` | `p7-gas-cylinder-cart.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/gasCylinderCart/panels/TL.png` | 907x907 | match | 3932 | 6000 | ready |
| `p7:handDryer` | `p7-hand-dryer.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/handDryer/image/handDryer-original.png` | 1254x1254 | match | 1498 | 3000 | ready |
| `p7:handToolbox` | `p7-hand-toolbox.glb` | SV | S | `rt/vs-iteration07-20261026/generation/handToolbox/image/handToolbox-original.png` | 1254x1254 | match | 1490 | 3000 | ready |
| `p7:handTruck` | `p7-hand-truck.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/handTruck/panels/TL.png` | 922x922 | match | 3990 | 6000 | ready |
| `p7:hotDogRoller` | `p7-hot-dog-roller.glb` | MV | S | `rt/vs-iteration07-20261026/generation/hotDogRoller/panels/TL.png` | 979x979 | match | 3992 | 6000 | ready |
| `p7:iceMachine` | `p7-ice-machine.glb` | MV | S | `rt/vs-iteration07-20261026/generation/iceMachine/panels/TL.png` | 897x897 | match | 5979 | 10000 | ready |
| `p7:infoTouchKiosk` | `p7-info-touch-kiosk.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/infoTouchKiosk/panels/TL.png` | 930x930 | match | 5990 | 10000 | ready |
| `p7:ingredientBin` | `p7-ingredient-bin.glb` | MV | S | `rt/vs-iteration07-20261026/generation/ingredientBin/panels/TL.png` | 615x615 | match | 3984 | 6000 | ready |
| `p7:ivPole` | `p7-iv-pole.glb` | SV | S | `rt/vs-iteration07-20261026/generation/ivPole/image/ivPole-original.png` | 1254x1254 | match | 5964 | 10000 | ready |
| `p7:keyCabinet` | `p7-key-cabinet.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/keyCabinet/image/keyCabinet-original.png` | 1254x1254 | match | 1485 | 3000 | ready |
| `p7:keyCuttingMachine` | `p7-key-cutting-machine.glb` | MV | S | `rt/vs-iteration07-20261026/generation/keyCuttingMachine/panels/TL.png` | 813x813 | match | 1470 | 3000 | ready |
| `p7:meatSlicer` | `p7-meat-slicer.glb` | MV | S | `rt/vs-iteration07-20261026/generation/meatSlicer/panels/TL.png` | 862x862 | match | 3980 | 6000 | ready |
| `p7:microwaveOven` | `p7-microwave-oven.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/microwaveOven/panels/TL.png` | 920x920 | match | 1490 | 3000 | ready |
| `p7:mobileWhiteboard` | `p7-mobile-whiteboard.glb` | MV | S | `rt/vs-iteration07-20261026/generation/mobileWhiteboard/panels/TL.png` | 857x857 | match | 5984 | 10000 | ready |
| `p7:mopBucketWringer` | `p7-mop-bucket-wringer.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/mopBucketWringer/panels/TL.png` | 928x928 | match | 3960 | 6000 | ready |
| `p7:newspaperBundles` | `p7-newspaper-bundles.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/newspaperBundles/panels/TL.png` | 889x889 | match | 3972 | 6000 | ready |
| `p7:officeCopier` | `p7-office-copier.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/officeCopier/panels/TL.png` | 859x859 | match | 3990 | 6000 | ready |
| `p7:officeSwivelChair` | `p7-office-swivel-chair.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/officeSwivelChair/panels/TL.png` | 928x928 | match | 3998 | 6000 | ready |
| `p7:oxygenCart` | `p7-oxygen-cart.glb` | MV | S | `rt/vs-iteration07-20261026/generation/oxygenCart/panels/TL.png` | 908x908 | match | 3968 | 6000 | ready |
| `p7:palletJack` | `p7-pallet-jack.glb` | MV | S | `rt/vs-iteration07-20261026/generation/palletJack/panels/TL.png` | 855x855 | match | 5950 | 10000 | ready |
| `p7:paperShredder` | `p7-paper-shredder.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/paperShredder/panels/TL.png` | 903x903 | match | 1476 | 3000 | ready |
| `p7:paperTowelDispenser` | `p7-paper-towel-dispenser.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/paperTowelDispenser/image/paperTowelDispenser-original.png` | 1254x1254 | match | 1494 | 3000 | ready |
| `p7:partsBinRack` | `p7-parts-bin-rack.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/partsBinRack/image/partsBinRack-original.png` | 1254x1254 | match | 3810 | 6000 | ready |
| `p7:payphone` | `p7-payphone.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/payphone/panels/TL.png` | 920x920 | match | 3996 | 6000 | ready |
| `p7:pedestalFan` | `p7-pedestal-fan.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/pedestalFan/panels/TL.png` | 928x928 | match | 3752 | 6000 | ready |
| `p7:physicianScale` | `p7-physician-scale.glb` | MV | S | `rt/vs-iteration07-20261026/generation/physicianScale/panels/TL.png` | 920x920 | match | 3992 | 6000 | ready |
| `p7:pipeValveManifold` | `p7-pipe-valve-manifold.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/pipeValveManifold/panels/TL.png` | 1119x1119 | match | 3956 | 6000 | ready |
| `p7:plasticStackChair` | `p7-plastic-stack-chair.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/plasticStackChair/panels/TL.png` | 889x889 | match | 3994 | 6000 | ready |
| `p7:platformClock` | `p7-platform-clock.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/platformClock/image/platformClock-original.png` | 1254x1254 | match | 3992 | 6000 | ready |
| `p7:popcornMachine` | `p7-popcorn-machine.glb` | MV | S | `rt/vs-iteration07-20261026/generation/popcornMachine/panels/TL.png` | 842x842 | match | 3999 | 6000 | ready |
| `p7:portableGenerator` | `p7-portable-generator.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/portableGenerator/panels/TL.png` | 878x878 | match | 3932 | 6000 | ready |
| `p7:punchClock` | `p7-punch-clock.glb` | SV | S+O | `rt/vs-iteration07-20261026/generation/punchClock/image/punchClock-original.png` | 1254x1254 | match | 1496 | 3000 | ready |
| `p7:riceCooker` | `p7-rice-cooker.glb` | SV | S | `rt/vs-iteration07-20261026/generation/riceCooker/image/riceCooker-original.png` | 1254x1254 | match | 1494 | 3000 | ready |
| `p7:rollingSuitcase` | `p7-rolling-suitcase.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/rollingSuitcase/panels/TL.png` | 903x903 | match | 3992 | 6000 | ready |
| `p7:securityPodium` | `p7-security-podium.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/securityPodium/panels/TL.png` | 928x928 | match | 3993 | 6000 | ready |
| `p7:shoeShineChair` | `p7-shoe-shine-chair.glb` | MV | S | `rt/vs-iteration07-20261026/generation/shoeShineChair/panels/TL.png` | 912x912 | match | 5964 | 10000 | ready |
| `p7:signalHeadSpare` | `p7-signal-head-spare.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/signalHeadSpare/panels/TL.png` | 924x924 | match | 3990 | 6000 | ready |
| `p7:slushMachine` | `p7-slush-machine.glb` | MV | S | `rt/vs-iteration07-20261026/generation/slushMachine/panels/TL.png` | 929x929 | match | 3894 | 6000 | ready |
| `p7:sodaFountain` | `p7-soda-fountain.glb` | MV | S | `rt/vs-iteration07-20261026/generation/sodaFountain/panels/TL.png` | 754x754 | match | 3952 | 6000 | ready |
| `p7:solderingStation` | `p7-soldering-station.glb` | MV | S | `rt/vs-iteration07-20261026/generation/solderingStation/panels/TL.png` | 837x837 | match | 1498 | 3000 | ready |
| `p7:spinnerRack` | `p7-spinner-rack.glb` | SV | S | `rt/vs-iteration07-20261026/generation/spinnerRack/image/spinnerRack-original.png` | 1254x1254 | match | 3968 | 6000 | ready |
| `p7:standMixer` | `p7-stand-mixer.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/standMixer/panels/TL.png` | 908x908 | match | 3966 | 6000 | ready |
| `p7:stepLadder` | `p7-step-ladder.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/stepLadder/panels/TL.png` | 930x930 | match | 5974 | 10000 | ready |
| `p7:toolPegboard` | `p7-tool-pegboard.glb` | SV | S | `rt/vs-iteration07-20261026/generation/toolPegboard/image/toolPegboard-original.png` | 1254x1254 | match | 3982 | 6000 | ready |
| `p7:trashBagPile` | `p7-trash-bag-pile.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/trashBagPile/panels/TL.png` | 860x860 | match | 3996 | 6000 | ready |
| `p7:tripodWorkLight` | `p7-tripod-work-light.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/tripodWorkLight/panels/TL.png` | 940x940 | match | 5948 | 10000 | ready |
| `p7:urinal` | `p7-urinal.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/urinal/panels/TL.png` | 933x933 | match | 4000 | 6000 | ready |
| `p7:wallDataCabinet` | `p7-wall-data-cabinet.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/wallDataCabinet/panels/TL.png` | 747x747 | match | 3868 | 6000 | ready |
| `p7:waterCooler` | `p7-water-cooler.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/waterCooler/panels/TL.png` | 945x945 | match | 3996 | 6000 | ready |
| `p7:waterHeaterTank` | `p7-water-heater-tank.glb` | MV | S | `rt/vs-iteration07-20261026/generation/waterHeaterTank/panels/TL.png` | 923x923 | match | 4000 | 6000 | ready |
| `p7:waterPumpSkid` | `p7-water-pump-skid.glb` | MV | S | `rt/vs-iteration07-20261026/generation/waterPumpSkid/panels/TL.png` | 1088x1088 | match | 3952 | 6000 | ready |
| `p7:wetDryVac` | `p7-wet-dry-vac.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/wetDryVac/panels/TL.png` | 625x625 | match | 3960 | 6000 | ready |
| `p7:wetFloorSign` | `p7-wet-floor-sign.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/wetFloorSign/panels/TL.png` | 907x907 | match | 1480 | 3000 | ready |
| `p7:wheelchair` | `p7-wheelchair.glb` | MV | S+O | `rt/vs-iteration07-20261026/generation/wheelchair/panels/TL.png` | 755x755 | match | 3966 | 6000 | ready |

## Excluded (41)

| File | Category | Reason |
|---|---|---|
| `magazine-rack.glb` | loaded-not-rendered | locally generated (iteration-05 SV) and preloaded via MODEL_FILES, but NEVER rendered: AUTHORED_CARCASS replaces it at runtime (product pictures baked into the mesh). Regenerating it would change nothing visible. |
| `office-bus-wreck.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-car-wreck.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-conference-table.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-dead-plant.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-filing-cabinet.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-armor-vest.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-backpack.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-boots.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-chest-rig.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-gloves.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-gear-helmet.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-med-arm-sling.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-med-leg-splint.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-office-chair.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-office-desk.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-office-monitor.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-office-shelf.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-photocopier.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-reception-desk.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-rubble-pile.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-ruined-midrise.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-ruined-tower.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-server-rack.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-water-cooler.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `office-whiteboard.glb` | meshy-office | existing Meshy T2.5 office asset (task: untouched) |
| `sign.glb` | procedural | procedural geometry re-export (generationMode "procedural"; 300 tris); not produced by a 3D model generator |
| `gun-locker.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): generated (iteration-05 SV) but not loaded: manifest entry commented out; authored loot-verified gunLocker shape used |
| `hotdog-cart.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): generated (iteration-05 SV) but not loaded: manifest entry commented out; authored hotdogCart shape used |
| `light-lod.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): older iteration-03 LOD of env-light-03; superseded by light-lod2.glb |
| `light.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): older iteration-01 derivative of env-light-03; superseded by light-lod2.glb (manifest light key) |
| `outfit-puffer.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): 372-byte stub: puffer fails the fit gate on every body; no model key (ai/outfits.ts comment) |
| `rifle-optic.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): old iteration-04 rifle optic derivative; runtime rifle is rifle-user.glb (weapon; untouched) |
| `rifle.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): old generated rifle derivative; runtime rifle is rifle-user.glb (weapon; untouched) |
| `shop-cooler.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): iteration-04 closed-front derivative; runtime uses shop-cooler-open.glb (its master IS included via the hybrid) |
| `shop-display.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): iteration-04 closed-front derivative; runtime uses shop-display-open.glb (its master IS included via the hybrid) |
| `shotgun.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): old generated shotgun derivative; runtime shotgun is shotgun-user.glb (weapon; untouched) |
| `zombie-rigged.glb` | unreferenced | unreferenced by the a7a646a JS bundle (CI packager drops it): legacy single-template zombie; stays on disk unused (manifest comment; registry bodies used) |
| `pistol.glb` | user-weapon | user-uploaded weapon runtime derivative (task: untouched) |
| `rifle-user.glb` | user-weapon | user-uploaded weapon runtime derivative (task: untouched) |
| `shotgun-user.glb` | user-weapon | user-uploaded weapon runtime derivative (task: untouched) |

Note for integration: `magazine-rack.glb` is still in the boot preload (`MODEL_FILES.magazineRack`) although never rendered; whether to keep or drop that dead payload is an integration decision, not a regeneration job.
