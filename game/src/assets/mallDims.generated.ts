// Task track3-eaton-centre-20261031 (Studio Beta, lane ASSETS): pure-data (three.js-free) measured bounds + nominal specs of the
// NEW mall-art models (assets/mallAssets.ts), for gen/ code (footprints, placement, surfaces): gen/mall/kinds.ts MALL_MODEL_DIMS.
// Rewritten by tools/asset-pipeline/props/build-mall-track3.mjs. MALL_DIMS lists DELIVERED models only: [x, y, z] metres of the
// runtime GLB (front -Z, +Y up, grounded, centred on x/z). MALL_ASSET_SPECS lists every asset of a FROZEN batch (delivered or not):
// the nominal real-world target (fall back to it, or to the kind's procedural box, until a model lands).
// No imports: safe for the generator, workers and tests.

export type MallAssetSizeAxis = 'h' | 'w' | 'longest';

export interface MallAssetSpec {
  /** Attempt-manifest code (M01..M80). */
  code: string;
  /** fixture / holder / loose-stock / furniture / decor / machine (manifest role). */
  role: string;
  /** Shop programs it serves (gen/mall/mallTypes.ts MallProgram ids or 'all stores' / common-area tags). */
  programs: readonly string[];
  /** Nominal real-world size (m) along sizeAxis; the runtime model is scaled to exactly this. */
  sizeM: number;
  sizeAxis: MallAssetSizeAxis;
  /** Planned target [w (x), h (y), d (z)] metres (the measured runtime dims may differ off the sizeAxis). */
  target: readonly [number, number, number];
  /** Placement hint ('wall' = back against a wall, its front -Z into the room). */
  placement: string;
  /** SHOPS kind it renders (existing gen/mall/kinds.ts kind) or the suggested new kind name. */
  shopsKind: string | null;
}

// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers
export const MALL_DIMS: Readonly<Record<string, readonly [number, number, number]>> = {
  'mall-cashwrap-counter': [2, 2.0434, 0.781],
  'glass-display-cabinet': [0.9178, 1.9, 0.6964],
  'retail-gondola': [1.9496, 1.4, 0.4926],
  'retail-wall-bay': [1.2, 2.1998, 0.5002],
  'garment-rail-round': [1.2, 1.5448, 1.1913],
  'garment-hanging-group': [0.8912, 0.85, 0.5949],
  'mannequin-full': [0.4492, 1.85, 0.4473],
  'clothing-wall-unit': [2.4, 2.3729, 0.7885],
  'bookstore-bookcase': [1.2, 2.2574, 0.5472],
  'flat-screen-tv': [1.23, 0.8189, 0.4996],
  'pharmacy-dispensary-counter': [3.2, 2.5621, 0.6915],
  'checkout-lane': [2.6, 0.8979, 0.8486],
  'produce-display-stand': [1.6, 1.14, 0.9191],
  'gun-wall-rack': [2, 1.4756, 0.3075],
  'glass-display-counter': [1.5, 1.3547, 0.7055],
  'outdoors-plank-shelving': [1.5, 1.7423, 0.4809],
  'mall-kiosk-cart': [2.5, 1.7068, 1.4596],
  'storage-tote': [0.6, 0.6267, 0.5897],
  'shoe-wall-display': [2, 1.9952, 0.2254],
  'food-court-table-set': [1.499, 0.75, 1.4843],
  'try-on-ottoman': [0.9, 0.4222, 0.6384],
  'medicine-drawer-cabinet': [0.9358, 1.9, 0.6504],
  'camping-tent-display': [2.2, 1.1536, 2.1369],
  'tv-wall-bank': [2.4, 1.6853, 0.514],
  'kiddie-ride': [1.3, 0.7843, 0.6936],
  'salon-styling-chair': [0.8063, 1.1, 0.9822],
  'bed-display': [1.4873, 1.0962, 2.1],
};

export const MALL_ASSET_SPECS: Readonly<Record<string, MallAssetSpec>> = {
  'mall-cashwrap-counter': {code: 'M01', role: 'fixture/holder', programs: ['all stores'], sizeM: 2, sizeAxis: 'w', target: [2, 1, 0.75], placement: 'floor', shopsKind: 'mallCashwrapCounter'},
  'glass-display-cabinet': {code: 'M02', role: 'holder', programs: ['electronics', 'phone', 'jewelry', 'pharmacy', 'beauty', 'optical', 'toys'], sizeM: 1.9, sizeAxis: 'h', target: [1, 1.9, 0.45], placement: 'wall', shopsKind: 'glassDisplayCabinet'},
  'retail-gondola': {code: 'M03', role: 'holder', programs: ['grocery', 'pharmacy', 'hardware', 'toys', 'department', 'pet', 'beauty', 'home'], sizeM: 1.4, sizeAxis: 'h', target: [1.25, 1.6, 0.95], placement: 'row', shopsKind: 'retailGondola'},
  'retail-wall-bay': {code: 'M04', role: 'holder', programs: ['all stores'], sizeM: 1.2, sizeAxis: 'w', target: [1.2, 2.2, 0.45], placement: 'wall', shopsKind: 'wallBay'},
  'garment-rail-round': {code: 'M05', role: 'fixture/movable', programs: ['clothing', 'department', 'sports', 'outdoors'], sizeM: 1.2, sizeAxis: 'w', target: [1.2, 1.35, 1.2], placement: 'free', shopsKind: 'garmentRailRound'},
  'garment-hanging-group': {code: 'M06', role: 'loose-stock', programs: ['clothing', 'department', 'outdoors', 'sports'], sizeM: 0.85, sizeAxis: 'h', target: [0.6, 1, 0.5], placement: 'onHost (rails of M05 / M08 / M21)', shopsKind: 'garmentHangingGroup'},
  'mannequin-full': {code: 'M07', role: 'decor/movable', programs: ['clothing', 'shoes', 'sports', 'department', 'outdoors'], sizeM: 1.85, sizeAxis: 'h', target: [0.55, 1.85, 0.4], placement: 'free', shopsKind: 'mannequinFull'},
  'clothing-wall-unit': {code: 'M08', role: 'holder', programs: ['clothing', 'department', 'outdoors', 'sports', 'shoes'], sizeM: 2.4, sizeAxis: 'w', target: [2.4, 2.4, 0.55], placement: 'wall', shopsKind: 'clothingWallUnit'},
  'bookstore-bookcase': {code: 'M09', role: 'holder', programs: ['books', 'department', 'toys'], sizeM: 1.2, sizeAxis: 'w', target: [1.2, 2.2, 0.45], placement: 'wall', shopsKind: 'bookstoreBookcase'},
  'flat-screen-tv': {code: 'M10', role: 'loose-stock', programs: ['electronics', 'home', 'department', 'arcade'], sizeM: 1.23, sizeAxis: 'w', target: [1.23, 0.78, 0.25], placement: 'onHost (M28 / tables) or floor', shopsKind: 'flatScreenTv'},
  'pharmacy-dispensary-counter': {code: 'M11', role: 'holder', programs: ['pharmacy', 'clinic'], sizeM: 3.2, sizeAxis: 'w', target: [2.4, 1.1, 0.8], placement: 'floor', shopsKind: 'pharmacyDispensaryCounter'},
  'checkout-lane': {code: 'M12', role: 'fixture/holder', programs: ['grocery', 'department', 'pharmacy', 'hardware'], sizeM: 2.6, sizeAxis: 'longest', target: [2.6, 0.95, 0.9], placement: 'row', shopsKind: 'checkoutLane'},
  'produce-display-stand': {code: 'M13', role: 'holder', programs: ['grocery', 'cafe'], sizeM: 1.6, sizeAxis: 'w', target: [1.6, 0.95, 1], placement: 'free', shopsKind: 'produceStand'},
  'gun-wall-rack': {code: 'M14', role: 'holder', programs: ['guns', 'outdoors'], sizeM: 2, sizeAxis: 'w', target: [2, 1.3, 0.25], placement: 'wall mount (base 1.0 m, SHOPS MALL_MOUNT_Y)', shopsKind: 'gunRack'},
  'glass-display-counter': {code: 'M15', role: 'holder', programs: ['guns', 'jewelry', 'optical', 'phone', 'beauty', 'electronics'], sizeM: 1.5, sizeAxis: 'w', target: [1.5, 1, 0.65], placement: 'row', shopsKind: 'glassCounter'},
  'outdoors-plank-shelving': {code: 'M16', role: 'holder', programs: ['outdoors', 'sports', 'home', 'hardware'], sizeM: 1.5, sizeAxis: 'w', target: [1.5, 2, 0.5], placement: 'wall', shopsKind: 'outdoorsPlankShelving'},
  'mall-kiosk-cart': {code: 'M17', role: 'holder', programs: ['kiosk'], sizeM: 2.5, sizeAxis: 'w', target: [2.2, 2.4, 1.1], placement: 'free (gallery)', shopsKind: 'mallKioskCart'},
  'storage-tote': {code: 'M18', role: 'holder/movable', programs: ['all backrooms'], sizeM: 0.6, sizeAxis: 'w', target: [0.6, 0.38, 0.4], placement: 'floor / onTop (shelves)', shopsKind: 'storageTote'},
  'shoe-wall-display': {code: 'M19', role: 'holder', programs: ['shoes', 'sports', 'outdoors'], sizeM: 2, sizeAxis: 'w', target: [2, 2.2, 0.35], placement: 'wall', shopsKind: 'shoeWallDisplay'},
  'food-court-table-set': {code: 'M20', role: 'furniture/holder', programs: ['food-court'], sizeM: 0.75, sizeAxis: 'h', target: [1.6, 0.75, 1.6], placement: 'free (hall)', shopsKind: 'foodCourtTableSet'},
  'try-on-ottoman': {code: 'M24', role: 'furniture', programs: ['shoes', 'clothing'], sizeM: 0.9, sizeAxis: 'w', target: [0.9, 0.42, 0.45], placement: 'free', shopsKind: 'ottoman'},
  'medicine-drawer-cabinet': {code: 'M29', role: 'holder', programs: ['pharmacy', 'clinic'], sizeM: 1.9, sizeAxis: 'h', target: [1.2, 1.9, 0.5], placement: 'wall', shopsKind: 'medicineDrawerCabinet'},
  'multideck-open-cooler': {code: 'M30', role: 'holder', programs: ['grocery', 'cafe'], sizeM: 1.9, sizeAxis: 'w', target: [1.9, 2, 0.9], placement: 'wall', shopsKind: 'multideckOpenCooler'},
  'cafe-bistro-table': {code: 'M31', role: 'furniture', programs: ['cafe', 'food-court', 'books'], sizeM: 0.7, sizeAxis: 'w', target: [0.7, 0.75, 0.7], placement: 'free', shopsKind: 'cafeBistroTable'},
  'cafe-chair': {code: 'M32', role: 'furniture', programs: ['cafe', 'food-court'], sizeM: 0.88, sizeAxis: 'h', target: [0.45, 0.88, 0.5], placement: 'atHost (M32)', shopsKind: 'cafeChair'},
  'gun-safe-tall': {code: 'M35', role: 'holder', programs: ['guns', 'outdoors'], sizeM: 1.8, sizeAxis: 'h', target: [0.75, 1.8, 0.6], placement: 'wall', shopsKind: 'gunSafeTall'},
  'camping-tent-display': {code: 'M36', role: 'decor', programs: ['outdoors'], sizeM: 2.2, sizeAxis: 'w', target: [2.2, 1.5, 2.2], placement: 'free (on its plinth)', shopsKind: 'tentDisplay'},
  'mall-bench': {code: 'M37', role: 'furniture', programs: ['galleries', 'plaza', 'food-court'], sizeM: 1.8, sizeAxis: 'w', target: [1.8, 0.45, 0.55], placement: 'free (gallery)', shopsKind: 'mallBench'},
  'mall-info-desk': {code: 'M40', role: 'holder', programs: ['plaza'], sizeM: 3, sizeAxis: 'w', target: [3, 1.1, 1.4], placement: 'free (plaza)', shopsKind: 'mallInfoDesk'},
  'tv-wall-bank': {code: 'M41', role: 'equipment', programs: ['electronics', 'department', 'arcade'], sizeM: 2.4, sizeAxis: 'w', target: [2.4, 1.4, 0.15], placement: 'wall mount (base 1.05 m, SHOPS MALL_MOUNT_Y)', shopsKind: 'tvWall'},
  'cosmetics-wall-unit': {code: 'M42', role: 'holder', programs: ['beauty', 'department', 'pharmacy'], sizeM: 1.2, sizeAxis: 'w', target: [1.2, 2.2, 0.45], placement: 'wall', shopsKind: 'cosmeticsWallUnit'},
  'dresser-drawers': {code: 'M45', role: 'holder', programs: ['home', 'department'], sizeM: 1.4, sizeAxis: 'w', target: [1.4, 0.85, 0.5], placement: 'wall', shopsKind: 'dresserDrawers'},
  'cardboard-box-flaps': {code: 'M47', role: 'holder/movable', programs: ['all backrooms'], sizeM: 0.55, sizeAxis: 'w', target: [0.55, 0.4, 0.4], placement: 'floor / onTop', shopsKind: 'cardboardBoxFlaps'},
  'kiddie-ride': {code: 'M50', role: 'machine', programs: ['galleries', 'toys', 'arcade'], sizeM: 1.3, sizeAxis: 'longest', target: [0.9, 1.3, 1.3], placement: 'free', shopsKind: 'kiddieRide'},
  'salon-styling-chair': {code: 'M51', role: 'furniture', programs: ['beauty', 'service'], sizeM: 1.1, sizeAxis: 'h', target: [0.7, 1.1, 0.7], placement: 'free', shopsKind: 'salonChair'},
  'bed-display': {code: 'M52', role: 'furniture', programs: ['home', 'department'], sizeM: 2.1, sizeAxis: 'longest', target: [1.6, 1.05, 2.1], placement: 'wall (headboard)', shopsKind: 'displayBed'},
};
// END GENERATED
