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
