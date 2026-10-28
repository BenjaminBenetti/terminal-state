// Runtime asset manifest. Every file here is a derivative under public/assets/ documented in
// public/assets/derivatives/*.json (sources, hashes, pipeline, limitations).

export type ModelKey = 'rifle' | 'shotgun' | 'pistol' | 'bench' | 'light' | 'cabinetTall' | 'cabinetLow' | 'sign' | 'crate' | 'turnstile'
  // Iteration 06 zombie wardrobe (ai/outfits.ts + ai/wardrobe.ts): bodies (derivatives/zombie-body-*.json) + slot wearables fitted per body (derivatives/outfit-*.json; summary zombie-wardrobe.json).
  // Iteration 07: refitted outside the posed body + cranium-fitted hats; the puffer fails the fit gate on every body (no model key).
  | 'zombieBody_lastshift' | 'zombieBody_courier' | 'zombieBody_agent' | 'zombieBody_scavenger' | 'zombieBody_heavyset' | 'zombieBody_tall'
  | 'outfit_coat' | 'outfit_hivis' | 'outfit_hoodie' | 'outfit_blazer' | 'outfit_trench' | 'outfit_flannel' | 'outfit_sweater'
  | 'outfit_cargo' | 'outfit_jeans' | 'outfit_slacks' | 'outfit_hardhat' | 'outfit_cap' | 'outfit_beanie' | 'outfit_gasmask' | 'outfit_respirator'
  // Iteration 07 (Lane Q): rat/dog creature — rigged derivative of the Field Notes quadruped-02 master (derivatives/creature-ratdog.json).
  | 'creature_ratdog'
  // Iteration 03 generated props/items (derivatives/props-iteration03.json); each key is added only once its GLB exists.
  | 'shelf' | 'vending' | 'stall' | 'item_water' | 'item_cola' | 'item_juice' | 'item_chocolate' | 'item_chips' | 'item_beans' | 'item_noodles'
  // Iteration 04 generated trash can + modular shop building blocks (derivatives/props-iteration04.json); added once each GLB exists.
  | 'trashCan' | 'shopCounter' | 'shopBackbar' | 'shopCooler' | 'shopDisplay'
  // Iteration 05 purpose-specific props (Lane A; derivatives/props-iteration05.json); each key is added only once its GLB exists.
  | 'janitorCart' | 'magazineRack' | 'techDisplay';

export const MODEL_FILES: Record<ModelKey, {url: string; bytes: number}> = {
  // Iteration 06: slot wardrobe rebuilt by tools/asset-pipeline/zombie/build-wardrobe.mjs (derivatives/zombie-wardrobe.json; the
  // single-template zombie-rigged.glb stays on disk, unused). Wearable GLBs hold one fitted SkinnedMesh per supported body.
  zombieBody_lastshift: {url: 'assets/models/zombie-body-lastshift.glb', bytes: 733_000},
  zombieBody_courier: {url: 'assets/models/zombie-body-courier.glb', bytes: 696_000},
  zombieBody_agent: {url: 'assets/models/zombie-body-agent.glb', bytes: 663_000},
  zombieBody_scavenger: {url: 'assets/models/zombie-body-scavenger.glb', bytes: 833_000}, // REUSED original upload (zombie-pixal3d); iteration-06 repose v2 + webbing fix
  zombieBody_heavyset: {url: 'assets/models/zombie-body-heavyset.glb', bytes: 628_000}, // iteration 06 generated base-layer body (always wears pants)
  zombieBody_tall: {url: 'assets/models/zombie-body-tall.glb', bytes: 629_000}, // iteration 06 generated base-layer body (always wears pants)
  // iteration 07 refit (fewer per-body variants: pairs that still clipped are not shipped)
  outfit_coat: {url: 'assets/models/outfit-coat.glb', bytes: 822_000},
  outfit_hivis: {url: 'assets/models/outfit-hivis.glb', bytes: 419_000},
  outfit_hoodie: {url: 'assets/models/outfit-hoodie.glb', bytes: 824_000},
  outfit_blazer: {url: 'assets/models/outfit-blazer.glb', bytes: 731_000},
  outfit_trench: {url: 'assets/models/outfit-trench.glb', bytes: 762_000},
  outfit_flannel: {url: 'assets/models/outfit-flannel.glb', bytes: 429_000},
  outfit_sweater: {url: 'assets/models/outfit-sweater.glb', bytes: 595_000},
  outfit_cargo: {url: 'assets/models/outfit-cargo.glb', bytes: 613_000},
  outfit_jeans: {url: 'assets/models/outfit-jeans.glb', bytes: 584_000},
  outfit_slacks: {url: 'assets/models/outfit-slacks.glb', bytes: 491_000},
  outfit_hardhat: {url: 'assets/models/outfit-hardhat.glb', bytes: 350_000},
  outfit_cap: {url: 'assets/models/outfit-cap.glb', bytes: 342_000},
  outfit_beanie: {url: 'assets/models/outfit-beanie.glb', bytes: 297_000},
  outfit_gasmask: {url: 'assets/models/outfit-gasmask.glb', bytes: 491_000},
  outfit_respirator: {url: 'assets/models/outfit-respirator.glb', bytes: 393_000},
  creature_ratdog: {url: 'assets/models/creature-ratdog.glb', bytes: 1_240_000}, // iteration 07 Lane Q: new quadruped rig + procedural clips (unapproved)
  // User weapon models (2026-10-28): runtime derivatives of the user-supplied rifle (red-dot sight), pump shotgun and compact
  // pistol. Muzzle -Z, +Y up, metres, Grip/Muzzle/Sight/Eject markers. rifle.glb / rifle-optic.glb / shotgun.glb stay on disk, unused.
  rifle: {url: 'assets/models/rifle-user.glb', bytes: 13_646_000},
  shotgun: {url: 'assets/models/shotgun-user.glb', bytes: 11_392_000},
  pistol: {url: 'assets/models/pistol.glb', bytes: 11_271_000},
  bench: {url: 'assets/models/bench.glb', bytes: 900_000},
  // Iteration 04: 894-tri fixture re-baked from the dense master (derivatives/light-lod-iteration04.json) replaces the
  // iteration-03 sloppy LOD whose triangles spanned unrelated atlas charts (mangled texture). light.glb/light-lod.glb unchanged.
  light: {url: 'assets/models/light-lod2.glb', bytes: 540_000},
  cabinetTall: {url: 'assets/models/cabinet-tall.glb', bytes: 900_000},
  cabinetLow: {url: 'assets/models/cabinet-low.glb', bytes: 900_000},
  sign: {url: 'assets/models/sign.glb', bytes: 300_000},
  // Iteration 02 generated props (derivatives/props-iteration02.json).
  crate: {url: 'assets/models/crate.glb', bytes: 800_000},
  turnstile: {url: 'assets/models/turnstile.glb', bytes: 820_000},
  // Iteration 03 generated props/items (derivatives/props-iteration03.json). Front +Z, origin bottom-centre, metres.
  shelf: {url: 'assets/models/shelf.glb', bytes: 855_000},
  vending: {url: 'assets/models/vending.glb', bytes: 1_035_000},
  stall: {url: 'assets/models/stall.glb', bytes: 840_000},
  item_water: {url: 'assets/models/item-water.glb', bytes: 205_000},
  item_cola: {url: 'assets/models/item-cola.glb', bytes: 140_000},
  item_juice: {url: 'assets/models/item-juice.glb', bytes: 145_000},
  item_chocolate: {url: 'assets/models/item-chocolate.glb', bytes: 120_000},
  item_chips: {url: 'assets/models/item-chips.glb', bytes: 215_000},
  item_beans: {url: 'assets/models/item-beans.glb', bytes: 145_000},
  item_noodles: {url: 'assets/models/item-noodles.glb', bytes: 160_000},
  // Iteration 04 generated (derivatives/props-iteration04.json; straight-on conditioning images). Front +Z, origin bottom-centre, metres.
  // trashCan 0.55 x 0.95 x 0.55; shopCounter 1.5 x 1.05 x 0.75 (top 1.04); shopBackbar 1.77 x 1.83 x 0.70 (worktop 0.86);
  // shopCooler 0.75 x 2.0 x 0.75; shopDisplay 1.1 x 0.70 x 0.62 countertop unit (sits on shopCounter).
  trashCan: {url: 'assets/models/trash-can.glb', bytes: 666_000},
  shopCounter: {url: 'assets/models/shop-counter.glb', bytes: 743_000},
  shopBackbar: {url: 'assets/models/shop-backbar.glb', bytes: 933_000},
  // Iteration 05 (Lane A; derivatives/props-iteration05.json): open-front hybrids — no stock picture / opaque pane; transparent glass node
  // 'glass', authored interior + real wire shelves/trays (same bbox). shop-cooler.glb / shop-display.glb stay unchanged on disk.
  shopCooler: {url: 'assets/models/shop-cooler-open.glb', bytes: 649_000},
  shopDisplay: {url: 'assets/models/shop-display-open.glb', bytes: 654_000},
  // Iteration 05 purpose-specific props (Lane A; derivatives/props-iteration05.json; straight-on inputs). Front +Z, origin bottom-centre, metres.
  // (generated, not loaded in r5: authored loot-verified version used; see iteration05 REPORT) hotdogCart 1.72 x 1.19 x 0.80 (work top 0.93; steam-well lids to 1.19; wheel -X, handle +X).
  // hotdogCart: {url: 'assets/models/hotdog-cart.glb', bytes: 800_000},
  // janitorCart 1.42 x 1.34 x 0.55 (cart top 0.87; open compartment shelves ~0.20 / ~0.51 hold baked bottles; bag caddy -X, mop bucket +X).
  janitorCart: {url: 'assets/models/janitor-cart.glb', bytes: 879_000},
  // magazineRack 0.99 x 1.40 x 0.45 (slanted wire-lipped tiers ~0.38 / 0.61 / 0.87 / 1.14, newspaper bin floor 0.055; baked magazines).
  magazineRack: {url: 'assets/models/magazine-rack.glb', bytes: 783_000},
  // techDisplay 1.10 x 2.00 x 0.58 (cabinet deck 0.86 with baked phones/tablets at the front; narrow shelf 1.25; dark screen at the top).
  techDisplay: {url: 'assets/models/tech-display.glb', bytes: 793_000},
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
