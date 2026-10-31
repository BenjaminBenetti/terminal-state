// Task track3-eaton-centre-20261031 (Studio Beta, lane ASSETS): registry of the NEW mall-art models of The Eaton's Center
// (LevelId 'mall') — shop fixtures, furniture and separate loose stock generated with Meshy T2.5 (smart-topology text-to-3D preview +
// 2K PBR refine) under the task's finite authorization, in staged batches frozen by the primary. Every file is a runtime derivative
// documented in public/assets/derivatives/mall-track3-20261031.json (task ids, frozen batch sha, prompts, raw + derivative hashes,
// credits), rebuilt by tools/asset-pipeline/props/build-mall-track3.mjs, which rewrites the GENERATED block below and the three-free
// mallDims.generated.ts (measured dims + nominal specs for gen/ code: gen/mall/kinds.ts MALL_MODEL_DIMS).
//
// Conventions of every model: metres at real size (sizeM along sizeAxis), +Y up, grounded (min y = 0), centred on x/z, front -Z.
// Library key `office-<id>` (SHOPS: mall kinds render through the office prop path, gen/office/kinds.ts officeModelKey; ids never
// collide with office / company ids — the builder refuses). Files are level-only by PATH (assets/models/mall-*.glb,
// assets/levelAssets.ts): fetched behind the mall's loading screen only for the keys a layout places, released on level change.
// `url` is null until the derivative is delivered: consumers MUST keep their procedural fallback (gen/mall/kinds.ts mallShape).
// A url string is only listed for a file that exists (the CI packager rejects bundle literals pointing at missing assets, and drops
// models whose path never appears in the bundle).
// Pure data: no three.js import.

export interface MallAssetEntry {
  /** Relative runtime URL (assets/models/mall-<id>.glb), or null while not delivered. */
  url: string | null;
  /** File size in bytes (0 while not delivered). */
  bytes: number;
  /** Triangle count of the runtime derivative (0 while not delivered). */
  tris: number;
  /** Attempt-manifest code (M01..M80). */
  code: string;
  /** Lazy model-library key (`office-<id>`). */
  key: string;
}

/** A loose item separated locally from a delivered fixture model (rule 4), at its own real size (front -Z, grounded, centred). */
export interface MallPartEntry {
  url: string;
  bytes: number;
  tris: number;
  /** The fixture model it was separated from. */
  from: string;
}

// BEGIN GENERATED (build-mall-track3.mjs) — do not hand-edit between the markers
export const MALL_ASSETS: Readonly<Record<string, MallAssetEntry>> = {
  'mall-cashwrap-counter': {url: 'assets/models/mall-mall-cashwrap-counter.glb', bytes: 349348, tris: 3636, code: 'M01', key: 'office-mall-cashwrap-counter'},
  'glass-display-cabinet': {url: 'assets/models/mall-glass-display-cabinet.glb', bytes: 211120, tris: 2850, code: 'M02', key: 'office-glass-display-cabinet'},
  'retail-gondola': {url: 'assets/models/mall-retail-gondola.glb', bytes: 219552, tris: 3152, code: 'M03', key: 'office-retail-gondola'},
  'retail-wall-bay': {url: 'assets/models/mall-retail-wall-bay.glb', bytes: 210904, tris: 2492, code: 'M04', key: 'office-retail-wall-bay'},
  'garment-rail-round': {url: 'assets/models/mall-garment-rail-round.glb', bytes: 144440, tris: 2634, code: 'M05', key: 'office-garment-rail-round'},
  'garment-hanging-group': {url: 'assets/models/mall-garment-hanging-group.glb', bytes: 189524, tris: 2730, code: 'M06', key: 'office-garment-hanging-group'},
  'mannequin-full': {url: 'assets/models/mall-mannequin-full.glb', bytes: 141884, tris: 3063, code: 'M07', key: 'office-mannequin-full'},
  'clothing-wall-unit': {url: 'assets/models/mall-clothing-wall-unit.glb', bytes: 251960, tris: 3515, code: 'M08', key: 'office-clothing-wall-unit'},
  'bookstore-bookcase': {url: 'assets/models/mall-bookstore-bookcase.glb', bytes: 285968, tris: 2384, code: 'M09', key: 'office-bookstore-bookcase'},
  'flat-screen-tv': {url: 'assets/models/mall-flat-screen-tv.glb', bytes: 113260, tris: 1546, code: 'M10', key: 'office-flat-screen-tv'},
  'pharmacy-dispensary-counter': {url: 'assets/models/mall-pharmacy-dispensary-counter.glb', bytes: 201416, tris: 1958, code: 'M11', key: 'office-pharmacy-dispensary-counter'},
  'checkout-lane': {url: 'assets/models/mall-checkout-lane.glb', bytes: 313240, tris: 3434, code: 'M12', key: 'office-checkout-lane'},
  'produce-display-stand': {url: 'assets/models/mall-produce-display-stand.glb', bytes: 196740, tris: 2999, code: 'M13', key: 'office-produce-display-stand'},
  'gun-wall-rack': {url: 'assets/models/mall-gun-wall-rack.glb', bytes: 258320, tris: 1560, code: 'M14', key: 'office-gun-wall-rack'},
  'glass-display-counter': {url: 'assets/models/mall-glass-display-counter.glb', bytes: 222948, tris: 3551, code: 'M15', key: 'office-glass-display-counter'},
  'outdoors-plank-shelving': {url: 'assets/models/mall-outdoors-plank-shelving.glb', bytes: 209988, tris: 2316, code: 'M16', key: 'office-outdoors-plank-shelving'},
  'mall-kiosk-cart': {url: null, bytes: 0, tris: 0, code: 'M17', key: 'office-mall-kiosk-cart'},
  'storage-tote': {url: null, bytes: 0, tris: 0, code: 'M18', key: 'office-storage-tote'},
  'shoe-wall-display': {url: null, bytes: 0, tris: 0, code: 'M19', key: 'office-shoe-wall-display'},
  'food-court-table-set': {url: null, bytes: 0, tris: 0, code: 'M20', key: 'office-food-court-table-set'},
};

export const MALL_PART_ASSETS: Readonly<Record<string, MallPartEntry>> = {
};
// END GENERATED

export const MALL_ASSET_IDS: readonly string[] = Object.keys(MALL_ASSETS);

/** Lazy model-library key of a mall asset id (the same `office-<id>` keys as gen/office/kinds.ts officeModelKey). */
export const mallModelKey = (id: string): string => `office-${id}`;

/** Delivered (url present) mall asset ids. */
export function mallAssetsReady(): string[] {
  return MALL_ASSET_IDS.filter(id => MALL_ASSETS[id].url !== null);
}

/** Lazy-library file map (assets/loader.ts PropModelLibrary input) of the delivered mall models + separated parts, keyed `office-<id>`. */
export const MALL_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries([
  ...MALL_ASSET_IDS.flatMap(id => { const a = MALL_ASSETS[id]; return a.url ? [[mallModelKey(id), {url: a.url, bytes: a.bytes}] as const] : []; }),
  ...Object.entries(MALL_PART_ASSETS).map(([id, p]) => [mallModelKey(id), {url: p.url, bytes: p.bytes}] as const),
]);
