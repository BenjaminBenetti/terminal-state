// Runtime asset manifest. Every file here is a derivative under public/assets/ documented in
// public/assets/derivatives/*.json (sources, hashes, pipeline, limitations).

import {SKYWAYS_FOOD_MODEL_FILES} from '../items/skywaysFood'; // task studio-skyways-level-20261106-054448 (lane FOOD)

export type ModelKey = 'rifle' | 'shotgun' | 'pistol' | 'knife' | 'bench' | 'light' | 'cabinetTall' | 'cabinetLow' | 'sign' | 'crate' | 'turnstile'
  // Iteration 06 zombie wardrobe (ai/outfits.ts + ai/wardrobe.ts): bodies (derivatives/zombie-body-*.json) + slot wearables fitted per body (derivatives/outfit-*.json; summary zombie-wardrobe.json).
  // Iteration 07: refitted outside the posed body + cranium-fitted hats; the puffer fails the fit gate on every body (no model key).
  | 'zombieBody_lastshift' | 'zombieBody_courier' | 'zombieBody_agent' | 'zombieBody_scavenger' | 'zombieBody_heavyset' | 'zombieBody_tall'
  // Task mall-lingerie-20261102 (lane BODY): the three user-uploaded female bodies (derivatives/zombie-body-pale-*.json); always clothed.
  | 'zombieBody_paleGaze' | 'zombieBody_paleRevenant' | 'zombieBody_paleApparition'
  | 'outfit_coat' | 'outfit_hivis' | 'outfit_hoodie' | 'outfit_blazer' | 'outfit_trench' | 'outfit_flannel' | 'outfit_sweater'
  | 'outfit_cargo' | 'outfit_jeans' | 'outfit_slacks' | 'outfit_hardhat' | 'outfit_cap' | 'outfit_beanie' | 'outfit_gasmask' | 'outfit_respirator'
  // Iteration 07 (Lane Q): rat/dog creature — rigged derivative of the Field Notes quadruped-02 master (derivatives/creature-ratdog.json).
  | 'creature_ratdog'
  // Iteration 03 generated props/items (derivatives/props-iteration03.json); each key is added only once its GLB exists.
  | 'shelf' | 'vending' | 'stall' | 'item_water' | 'item_cola' | 'item_juice' | 'item_chocolate' | 'item_chips' | 'item_beans' | 'item_noodles'
  // Lane AMMO (knife-melee-20261030): one Meshy T2.5 ammo box per caliber (derivatives/meshy-t25-ammo-20261030.json).
  | 'item_ammo_9mm' | 'item_ammo_556' | 'item_ammo_12ga'
  // Task office-props-physics-scale-20261030 (lane FURN): the bakery loaf, cut out of the Meshy T2.5 bakery case (derivatives/office-overhaul-20261030.json `parts`).
  | 'item_bread'
  // Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's edible food (items/skywaysFood.ts; lane ASSET-A's
  // derivatives of the user's community-supplied sources, derivatives/item-*.json). Shared, not level-only: food travels.
  | 'item_ramen' | 'item_ramen_chashu' | 'item_sushi_bento' | 'item_bubble_tea'
  // Iteration 04 generated trash can + modular shop building blocks (derivatives/props-iteration04.json); added once each GLB exists.
  | 'trashCan' | 'shopCounter' | 'shopBackbar' | 'shopCooler' | 'shopDisplay'
  // Iteration 05 purpose-specific props (Lane A; derivatives/props-iteration05.json); each key is added only once its GLB exists.
  | 'janitorCart' | 'magazineRack' | 'techDisplay';

export const MODEL_FILES: Record<ModelKey, {url: string; bytes: number}> = {
  // Iteration 06: slot wardrobe rebuilt by tools/asset-pipeline/zombie/build-wardrobe.mjs (derivatives/zombie-wardrobe.json; the
  // single-template zombie-rigged.glb stays on disk, unused). Wearable GLBs hold one fitted SkinnedMesh per supported body.
  zombieBody_lastshift: {url: 'assets/models/zombie-body-lastshift-t25.glb', bytes: 719_000},
  zombieBody_courier: {url: 'assets/models/zombie-body-courier-t25.glb', bytes: 680_000},
  zombieBody_agent: {url: 'assets/models/zombie-body-agent-t25.glb', bytes: 658_000},
  zombieBody_scavenger: {url: 'assets/models/zombie-body-scavenger-t25.glb', bytes: 701_000}, // Meshy T2.5 from a RECREATED reference (user update 01; not an original) of the old upload
  zombieBody_heavyset: {url: 'assets/models/zombie-body-heavyset-t25.glb', bytes: 588_000}, // Meshy T2.5 replacement (lane CHARS) of the iteration-06 base-layer body (always wears pants)
  zombieBody_tall: {url: 'assets/models/zombie-body-tall-t25.glb', bytes: 633_000}, // iteration 06 generated base-layer body (always wears pants)
  // Task mall-lingerie-20261102 (lane BODY): user-uploaded Meshy AI bodies rigged / fitted by the local wardrobe pipeline (never shown bare)
  zombieBody_paleGaze: {url: 'assets/models/zombie-body-pale-gaze-t25.glb', bytes: 708_000},
  zombieBody_paleRevenant: {url: 'assets/models/zombie-body-pale-revenant-t25.glb', bytes: 733_000},
  zombieBody_paleApparition: {url: 'assets/models/zombie-body-pale-apparition-t25.glb', bytes: 593_000},
  // iteration 07 refit (fewer per-body variants: pairs that still clipped are not shipped)
  outfit_coat: {url: 'assets/models/outfit-coat-t25.glb', bytes: 1_044_000},
  outfit_hivis: {url: 'assets/models/outfit-hivis-t25.glb', bytes: 788_000},
  outfit_hoodie: {url: 'assets/models/outfit-hoodie-t25.glb', bytes: 1_080_000},
  outfit_blazer: {url: 'assets/models/outfit-blazer-t25.glb', bytes: 776_000},
  outfit_trench: {url: 'assets/models/outfit-trench-t25.glb', bytes: 698_000},
  outfit_flannel: {url: 'assets/models/outfit-flannel-t25.glb', bytes: 843_000},
  outfit_sweater: {url: 'assets/models/outfit-sweater-t25.glb', bytes: 740_000},
  outfit_cargo: {url: 'assets/models/outfit-cargo-t25.glb', bytes: 961_000},
  outfit_jeans: {url: 'assets/models/outfit-jeans-t25.glb', bytes: 955_000},
  outfit_slacks: {url: 'assets/models/outfit-slacks-t25.glb', bytes: 876_000},
  outfit_hardhat: {url: 'assets/models/outfit-hardhat-t25.glb', bytes: 352_000},
  outfit_cap: {url: 'assets/models/outfit-cap-t25.glb', bytes: 328_000},
  outfit_beanie: {url: 'assets/models/outfit-beanie-t25.glb', bytes: 340_000},
  outfit_gasmask: {url: 'assets/models/outfit-gasmask-t25.glb', bytes: 424_000},
  outfit_respirator: {url: 'assets/models/outfit-respirator-t25.glb', bytes: 351_000},
  // Meshy T2.5 migration (lane CHARS): rebuilt from the accepted Meshy T2.5 replacement of the same concept image (derivatives/creature-ratdog.json,
  // meshy-t25-chars-20261029.json); same 25-joint rig contract + procedural clips; creature-ratdog.glb restorable from a7a646a.
  creature_ratdog: {url: 'assets/models/creature-ratdog-t25.glb', bytes: 894_000},
  // User weapon models (2026-10-28): runtime derivatives of the user-supplied rifle (red-dot sight), pump shotgun and compact
  // pistol. Muzzle -Z, +Y up, metres, Grip/Muzzle/Sight/Eject markers. rifle.glb / rifle-optic.glb / shotgun.glb stay on disk, unused.
  rifle: {url: 'assets/models/rifle-user.glb', bytes: 13_646_000},
  shotgun: {url: 'assets/models/shotgun-user.glb', bytes: 11_392_000},
  pistol: {url: 'assets/models/pistol.glb', bytes: 11_271_000},
  // Lane KNIFE (knife-melee-20261030): runtime derivative of the user's uploaded survival knife (derivatives/user-knife-20261030.json;
  // tools/asset-pipeline/weapons/build-knife.mjs): tip -Z, spine +Y, metres (0.32 m), grip pivot at the origin, Grip / Tip markers.
  knife: {url: 'assets/models/knife-user.glb', bytes: 753_000},
  bench: {url: 'assets/models/bench-t25r1.glb', bytes: 520_000},
  // Meshy T2.5 replacement (2026-10-29; derivatives/meshy-t25-light-20261029.json): the fixture rebuilt from Meshy T2.5 conditioned
  // on the original env-light-03 front view; 1.2 m long, top-centre origin (its bbox sizes the fixture material / tubes). The
  // iteration-04 LOD it replaces is restorable from Git (record.restore); light.glb / light-lod.glb stay unreferenced on disk.
  light: {url: 'assets/models/light-lod2-t25.glb', bytes: 349_000},
  cabinetTall: {url: 'assets/models/cabinet-tall-t25r1.glb', bytes: 304_000},
  cabinetLow: {url: 'assets/models/cabinet-low-t25.glb', bytes: 650_000},
  sign: {url: 'assets/models/sign.glb', bytes: 300_000},
  // Iteration 02 generated props (derivatives/props-iteration02.json).
  crate: {url: 'assets/models/crate-t25.glb', bytes: 517_000},
  turnstile: {url: 'assets/models/turnstile-t25.glb', bytes: 531_000},
  // Iteration 03 generated props/items (derivatives/props-iteration03.json). Front +Z, origin bottom-centre, metres.
  shelf: {url: 'assets/models/shelf-t25.glb', bytes: 374_000},
  vending: {url: 'assets/models/vending-t25.glb', bytes: 317_000},
  stall: {url: 'assets/models/stall-t25.glb', bytes: 647_000},
  item_water: {url: 'assets/models/item-water-t25.glb', bytes: 150_000}, // Meshy T2.5 (derivatives/meshy-t25-items-20261029.json)
  item_cola: {url: 'assets/models/item-cola-t25.glb', bytes: 176_000},
  item_juice: {url: 'assets/models/item-juice-t25.glb', bytes: 173_000},
  item_chocolate: {url: 'assets/models/item-chocolate-t25.glb', bytes: 177_000},
  item_chips: {url: 'assets/models/item-chips-t25.glb', bytes: 171_000},
  item_beans: {url: 'assets/models/item-beans-t25.glb', bytes: 186_000},
  item_noodles: {url: 'assets/models/item-noodles-t25.glb', bytes: 184_000},
  // Lane AMMO (knife-melee-20261030): Meshy T2.5 text-to-3D ammo boxes, one per caliber (tools/asset-pipeline/props/build-ammo-boxes.mjs;
  // derivatives/meshy-t25-ammo-20261030.json). Front +Z, origin bottom-centre, metres, at ITEM_DIMS size: 9mm carton (printed end to
  // the front, lid flap open) 0.113 x 0.133 x 0.13; 5.56 steel can (stencil locally corrected 516 -> 5.56) 0.165 x 0.175 x 0.076;
  // 12-gauge carton (open top, red shells) 0.13 x 0.157 x 0.123. They replace the procedural supply boxes (kept as the fallback).
  item_ammo_9mm: {url: 'assets/models/ammo-9mm-t25.glb', bytes: 178_000},
  item_ammo_556: {url: 'assets/models/ammo-556-t25.glb', bytes: 186_000},
  item_ammo_12ga: {url: 'assets/models/ammo-12ga-t25.glb', bytes: 319_000},
  // Task office-props-physics-scale-20261030 (lane FURN): the round loaf separated from the D38 bakery case (local separation of the same
  // Meshy T2.5 refine; tools/asset-pipeline/props/build-office-overhaul.mjs FURNITURE; derivatives/office-overhaul-20261030.json `parts`).
  // Front +Z, origin bottom-centre, metres, at ITEM_DIMS.bread size (0.26 x 0.092 x 0.223), its own 256 px crop of the case atlas.
  item_bread: {url: 'assets/models/item-bread-t25.glb', bytes: 41_000},
  // Task studio-skyways-level-20261106-054448 (lane FOOD): ramen bowls, sushi bento, bubble tea (front +Z, origin bottom-centre, metres, at
  // ITEM_DIMS size: assets/skywaysFoodModels.ts holds the urls / bounds).
  ...SKYWAYS_FOOD_MODEL_FILES,
  // Iteration 04 generated (derivatives/props-iteration04.json; straight-on conditioning images). Front +Z, origin bottom-centre, metres.
  // trashCan 0.55 x 0.95 x 0.55; shopCounter 1.5 x 1.05 x 0.75 (top 1.04); shopBackbar 1.77 x 1.83 x 0.70 (worktop 0.86);
  // shopCooler 0.75 x 2.0 x 0.75; shopDisplay 1.1 x 0.70 x 0.62 countertop unit (sits on shopCounter).
  trashCan: {url: 'assets/models/trash-can-t25.glb', bytes: 396_000}, // Meshy T2.5 (derivatives/meshy-t25-props-20261029.json; same 0.55 x 0.95 x 0.55 fit)
  shopCounter: {url: 'assets/models/shop-counter-t25.glb', bytes: 459_000},
  shopBackbar: {url: 'assets/models/shop-backbar-t25.glb', bytes: 500_000},
  // Iteration 05 (Lane A; derivatives/props-iteration05.json): open-front hybrids — no stock picture / opaque pane; transparent glass node
  // 'glass', authored interior + real wire shelves/trays (same bbox). shop-cooler.glb / shop-display.glb stay unchanged on disk.
  shopCooler: {url: 'assets/models/shop-cooler-open-t25r1.glb', bytes: 279_000},
  shopDisplay: {url: 'assets/models/shop-display-open-t25r1.glb', bytes: 141_000},
  // Iteration 05 purpose-specific props (Lane A; derivatives/props-iteration05.json; straight-on inputs). Front +Z, origin bottom-centre, metres.
  // (generated, not loaded in r5: authored loot-verified version used; see iteration05 REPORT) hotdogCart 1.72 x 1.19 x 0.80 (work top 0.93; steam-well lids to 1.19; wheel -X, handle +X).
  // hotdogCart: {url: 'assets/models/hotdog-cart.glb', bytes: 800_000},
  // janitorCart 1.42 x 1.34 x 0.55 (cart top 0.87; open compartment shelves ~0.20 / ~0.51 hold baked bottles; bag caddy -X, mop bucket +X).
  janitorCart: {url: 'assets/models/janitor-cart-t25.glb', bytes: 649_000},
  // magazineRack 0.99 x 1.40 x 0.45 (slanted wire-lipped tiers ~0.38 / 0.61 / 0.87 / 1.14, newspaper bin floor 0.055; baked magazines).
  magazineRack: {url: 'assets/models/magazine-rack.glb', bytes: 783_000},
  // techDisplay 1.10 x 2.00 x 0.58 (cabinet deck 0.86 with baked phones/tablets at the front; narrow shelf 1.25; dark screen at the top).
  techDisplay: {url: 'assets/models/tech-display-t25.glb', bytes: 501_000},
  // (generated, not loaded in r5: authored loot-verified version used; see iteration05 REPORT) gunLocker 0.95 x 1.90 x 0.50 open-front weapons rack cabinet (EMPTY rack: floor 0.415, notched butt rest top 0.55, barrel brackets ~1.27-1.37; top shelf 1.53 with baked ammo cans).
  // gunLocker: {url: 'assets/models/gun-locker.glb', bytes: 850_000},
};

export type TextureKey =
  | 'wallColor' | 'wallOrm' | 'wallNormal'
  | 'platformColor' | 'platformOrm' | 'platformNormal'
  | 'edgeColor' | 'edgeOrm' | 'edgeNormal'
  | 'ceilingColor' | 'ceilingOrm' | 'ceilingNormal'
  | 'tunnelColor' | 'tunnelOrm' | 'tunnelNormal'
  | 'backingColor' | 'backingOrm' | 'backingNormal';

const T = (file: string, srgb: boolean, bytes: number) => ({url: `assets/textures/${file}`, srgb, bytes});

/** Extracted from the procedural kit GLBs (see derivatives/props.json "environmentTextures"). */
export const TEXTURE_FILES: Record<TextureKey, {url: string; srgb: boolean; bytes: number}> = {
  wallColor: T('wall-working-face-color.jpg', true, 73553), wallOrm: T('wall-working-face-orm.jpg', false, 268609), wallNormal: T('wall-working-face-normal.png', false, 75357),
  platformColor: T('platform-working-face-color.jpg', true, 81621), platformOrm: T('platform-working-face-orm.jpg', false, 383868), platformNormal: T('platform-working-face-normal.png', false, 178949),
  edgeColor: T('platform-integrated-safety-edge-color.jpg', true, 28402), edgeOrm: T('platform-integrated-safety-edge-orm.jpg', false, 60066), edgeNormal: T('platform-integrated-safety-edge-normal.png', false, 844),
  ceilingColor: T('ceiling-working-face-color.jpg', true, 29257), ceilingOrm: T('ceiling-working-face-orm.jpg', false, 160656), ceilingNormal: T('ceiling-working-face-normal.png', false, 109696),
  tunnelColor: T('tunnel-working-face-color.jpg', true, 67133), tunnelOrm: T('tunnel-working-face-orm.jpg', false, 55015), tunnelNormal: T('tunnel-working-face-normal.png', false, 551077),
  backingColor: T('platform-authored-backing-color.jpg', true, 5686), backingOrm: T('platform-authored-backing-orm.jpg', false, 24426), backingNormal: T('platform-authored-backing-normal.png', false, 12905),
};

/**
 * Real-world span of each environment texture (meters) as authored in the procedural kit.
 * Wall: charcoal base 0-0.30 m, teal band 1.35-1.50 m, 0.15 m running-bond courses. The two
 * plain courses above the band (1.499-1.798 m, one 0.3 m period) repeat up to the ceiling.
 */
export const ENV_TEXTURE_LAYOUT = {
  wall: {w: 3.6, h: 1.8, upperCrop: {u0: 0, u1: 1, v0: 1.4988 / 1.8, v1: 1.7977 / 1.8}},
  platform: {w: 2.4, h: 2.28},
  edge: {w: 2.4, h: 0.35},
  ceiling: {w: 3.6, h: 1.15},
  tunnel: {w: 3.6, h: 1.38},
  backing: {w: 2, h: 2},
  normalScale: 0.65,
};
