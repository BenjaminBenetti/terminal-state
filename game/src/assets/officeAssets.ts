// Iteration 16 "Office Space" (lane ASSETS): lazy registry of the Meshy T2.5 office / gear / medical / exterior models and the
// Codex office textures. Every file is a runtime derivative documented in public/assets/derivatives/office-space-20261029.json
// (source task ids, model meshy-t2.5 / smart-topology, prompts, hashes); rebuilt by tools/asset-pipeline/props/build-office-iteration16.mjs,
// which also rewrites the GENERATED block below.
//
// Conventions of every model: metres at real size (sizeM along sizeAxis), +Y up, grounded (min y = 0), centred on x/z, front -Z.
// `url` is null until the derivative is delivered (or when its generation failed): consumers MUST keep a geometry fallback.
// Nothing here is preloaded: loadOfficeAsset / loadOfficeTexture fetch on demand, cache per id, resolve null on any failure and
// never throw. (A url string is only listed for a file that exists, because the CI packager rejects bundle literals that
// point at missing assets.)

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from './loader';

export type OfficeAssetId = 'gear-armor-vest' | 'gear-chest-rig' | 'gear-backpack' | 'gear-helmet' | 'gear-boots' | 'gear-gloves'
  | 'med-leg-splint' | 'med-arm-sling'
  | 'office-desk' | 'office-chair' | 'filing-cabinet' | 'office-monitor' | 'photocopier' | 'water-cooler' | 'conference-table'
  | 'dead-plant' | 'reception-desk' | 'server-rack' | 'whiteboard' | 'office-shelf'
  | 'car-wreck' | 'rubble-pile' | 'ruined-tower' | 'ruined-midrise' | 'bus-wreck';

export type OfficeAssetUse = 'gear' | 'medical' | 'office' | 'exterior';

export interface OfficeAssetEntry {
  /** Relative runtime URL (assets/models/office-<id>.glb), or null while not delivered. */
  url: string | null;
  /** File size in bytes (0 while not delivered). */
  bytes: number;
  /** Triangle count of the runtime derivative (0 while not delivered). */
  tris: number;
  /** Real-world size in metres along sizeAxis (the derivative is already scaled to it). */
  sizeM: number;
  use: OfficeAssetUse;
  /** Manifest code (design.md Part 1: A1-A8 gear/medical, B1-B12 office, C1-C5 exterior). */
  code: string;
  /** Which extent sizeM measures: h = height (y), w = width (x), longest = longest extent. */
  sizeAxis: 'h' | 'w' | 'longest';
  /** Measured runtime bounds [x, y, z] in metres (null while not delivered). */
  dims: readonly [number, number, number] | null;
}

export type OfficeTextureId = 'office-carpet' | 'ceiling-tile' | 'cubicle-fabric' | 'office-wall' | 'skyline' | 'window-glass';

export interface OfficeTextureEntry {
  /** Relative runtime URL (assets/textures/office/<id>.jpg|png), or null while not delivered. */
  url: string | null;
  bytes: number;
  /** Colour texture (sRGB). */
  srgb: boolean;
  /** Seamless/tileable (RepeatWrapping on both axes); otherwise clamped on T (skyline repeats on S only). */
  tileable: boolean;
  /** Has a meaningful alpha channel (overlay). */
  alpha: boolean;
  /** Pixel size [w, h] (null while not delivered). */
  size: readonly [number, number] | null;
}

// BEGIN GENERATED (build-office-iteration16.mjs) — do not hand-edit between the markers
export const OFFICE_ASSETS: Record<OfficeAssetId, OfficeAssetEntry> = {
  'gear-armor-vest': {url: 'assets/models/office-gear-armor-vest.glb', bytes: 263456, tris: 4173, sizeM: 0.62, use: 'gear', code: 'A1', sizeAxis: 'h', dims: [0.4586, 0.62, 0.4077]},
  'gear-chest-rig': {url: 'assets/models/office-gear-chest-rig.glb', bytes: 229176, tris: 3351, sizeM: 0.55, use: 'gear', code: 'A2', sizeAxis: 'h', dims: [0.4149, 0.55, 0.3889]},
  'gear-backpack': {url: 'assets/models/office-gear-backpack.glb', bytes: 224144, tris: 3732, sizeM: 0.52, use: 'gear', code: 'A3', sizeAxis: 'h', dims: [0.3302, 0.52, 0.3236]},
  'gear-helmet': {url: 'assets/models/office-gear-helmet.glb', bytes: 318628, tris: 3158, sizeM: 0.3, use: 'gear', code: 'A4', sizeAxis: 'longest', dims: [0.2312, 0.1899, 0.3]},
  'gear-boots': {url: 'assets/models/office-gear-boots.glb', bytes: 243920, tris: 3670, sizeM: 0.32, use: 'gear', code: 'A5', sizeAxis: 'longest', dims: [0.3008, 0.1946, 0.32]},
  'gear-gloves': {url: 'assets/models/office-gear-gloves.glb', bytes: 193796, tris: 2626, sizeM: 0.26, use: 'gear', code: 'A6', sizeAxis: 'longest', dims: [0.26, 0.0608, 0.2005]},
  'med-leg-splint': {url: 'assets/models/office-med-leg-splint.glb', bytes: 232476, tris: 2094, sizeM: 0.24, use: 'medical', code: 'A7', sizeAxis: 'longest', dims: [0.1539, 0.1846, 0.24]},
  'med-arm-sling': {url: 'assets/models/office-med-arm-sling.glb', bytes: 159544, tris: 1969, sizeM: 0.2, use: 'medical', code: 'A8', sizeAxis: 'longest', dims: [0.1604, 0.2, 0.0813]},
  'office-desk': {url: 'assets/models/office-office-desk.glb', bytes: 485528, tris: 4620, sizeM: 1.5, use: 'office', code: 'B1', sizeAxis: 'w', dims: [1.5, 1.2337, 0.7661]},
  'office-chair': {url: 'assets/models/office-office-chair.glb', bytes: 276800, tris: 4120, sizeM: 1, use: 'office', code: 'B2', sizeAxis: 'h', dims: [0.783, 1, 0.726]},
  'filing-cabinet': {url: 'assets/models/office-filing-cabinet.glb', bytes: 505980, tris: 2931, sizeM: 1.32, use: 'office', code: 'B3', sizeAxis: 'h', dims: [1.322, 1.32, 0.8013]},
  'office-monitor': {url: 'assets/models/office-office-monitor.glb', bytes: 240652, tris: 2690, sizeM: 0.55, use: 'office', code: 'B4', sizeAxis: 'w', dims: [0.55, 0.4072, 0.3943]},
  'photocopier': {url: 'assets/models/office-photocopier.glb', bytes: 697956, tris: 4983, sizeM: 1.1, use: 'office', code: 'B5', sizeAxis: 'h', dims: [0.85, 1.1, 0.9379]},
  'water-cooler': {url: 'assets/models/office-water-cooler.glb', bytes: 233012, tris: 3152, sizeM: 1.3, use: 'office', code: 'B6', sizeAxis: 'h', dims: [0.6677, 1.3, 0.6603]},
  'conference-table': {url: 'assets/models/office-conference-table.glb', bytes: 334936, tris: 3178, sizeM: 3, use: 'office', code: 'B7', sizeAxis: 'w', dims: [3, 0.8298, 1.3542]},
  'dead-plant': {url: 'assets/models/office-dead-plant.glb', bytes: 207348, tris: 2246, sizeM: 1.1, use: 'office', code: 'B8', sizeAxis: 'h', dims: [0.8567, 1.1, 0.8933]},
  'reception-desk': {url: 'assets/models/office-reception-desk.glb', bytes: 498784, tris: 6067, sizeM: 2.6, use: 'office', code: 'B9', sizeAxis: 'w', dims: [2.6, 1.1189, 1.7846]},
  'server-rack': {url: 'assets/models/office-server-rack.glb', bytes: 354588, tris: 1157, sizeM: 2, use: 'office', code: 'B10', sizeAxis: 'h', dims: [1.2346, 2, 1.4826]},
  'whiteboard': {url: null, bytes: 0, tris: 0, sizeM: 1.8, use: 'office', code: 'B11', sizeAxis: 'w', dims: null},
  'office-shelf': {url: null, bytes: 0, tris: 0, sizeM: 1.8, use: 'office', code: 'B12', sizeAxis: 'h', dims: null},
  'car-wreck': {url: null, bytes: 0, tris: 0, sizeM: 4.6, use: 'exterior', code: 'C1', sizeAxis: 'longest', dims: null},
  'rubble-pile': {url: null, bytes: 0, tris: 0, sizeM: 5, use: 'exterior', code: 'C2', sizeAxis: 'longest', dims: null},
  'ruined-tower': {url: null, bytes: 0, tris: 0, sizeM: 60, use: 'exterior', code: 'C3', sizeAxis: 'h', dims: null},
  'ruined-midrise': {url: null, bytes: 0, tris: 0, sizeM: 30, use: 'exterior', code: 'C4', sizeAxis: 'h', dims: null},
  'bus-wreck': {url: null, bytes: 0, tris: 0, sizeM: 12, use: 'exterior', code: 'C5', sizeAxis: 'longest', dims: null},
};

export const OFFICE_TEXTURES: Record<OfficeTextureId, OfficeTextureEntry> = {
  'office-carpet': {url: 'assets/textures/office/office-carpet.jpg', bytes: 458609, srgb: true, tileable: true, alpha: false, size: [1024, 1024]},
  'ceiling-tile': {url: 'assets/textures/office/ceiling-tile.jpg', bytes: 393102, srgb: true, tileable: true, alpha: false, size: [1024, 1024]},
  'cubicle-fabric': {url: 'assets/textures/office/cubicle-fabric.jpg', bytes: 416586, srgb: true, tileable: true, alpha: false, size: [1024, 1024]},
  'office-wall': {url: 'assets/textures/office/office-wall.jpg', bytes: 271942, srgb: true, tileable: true, alpha: false, size: [1024, 1024]},
  'skyline': {url: 'assets/textures/office/skyline.jpg', bytes: 300406, srgb: true, tileable: false, alpha: false, size: [2048, 768]},
  'window-glass': {url: 'assets/textures/office/window-glass.png', bytes: 466309, srgb: true, tileable: false, alpha: true, size: [1024, 1024]},
};
// END GENERATED

export const OFFICE_ASSET_IDS = Object.keys(OFFICE_ASSETS) as OfficeAssetId[];
export const OFFICE_TEXTURE_IDS = Object.keys(OFFICE_TEXTURES) as OfficeTextureId[];

/** Delivered (url present) asset ids, optionally filtered by intended use. */
export function officeAssetsReady(use?: OfficeAssetUse): OfficeAssetId[] {
  return OFFICE_ASSET_IDS.filter(id => OFFICE_ASSETS[id].url !== null && (!use || OFFICE_ASSETS[id].use === use));
}

/** Lazy-library file map (same shape as assets/loader.ts PropModelLibrary input) of the delivered models, keyed `office-<id>`. */
export const OFFICE_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  OFFICE_ASSET_IDS.flatMap(id => { const a = OFFICE_ASSETS[id]; return a.url ? [[`office-${id}`, {url: a.url, bytes: a.bytes}]] : []; }));

const modelCache = new Map<OfficeAssetId, Promise<GLTF | null>>();
const textureCache = new Map<OfficeTextureId, Promise<THREE.Texture | null>>();
let gltfLoader: GLTFLoader | null = null;

/** Loads (once, cached per id) an office model; resolves null when not delivered or on any error. Never throws. */
export function loadOfficeAsset(id: OfficeAssetId): Promise<GLTF | null> {
  let p = modelCache.get(id);
  if (p) return p;
  p = (async () => {
    try {
      const url = OFFICE_ASSETS[id]?.url;
      if (!url) return null;
      gltfLoader ??= new GLTFLoader();
      return await gltfLoader.loadAsync(assetUrl(url));
    } catch {
      return null;
    }
  })();
  modelCache.set(id, p);
  return p;
}

/** Loads (once, cached per id) an office texture with its colour space / wrapping set; null when absent or on error. Never throws. */
export function loadOfficeTexture(id: OfficeTextureId): Promise<THREE.Texture | null> {
  let p = textureCache.get(id);
  if (p) return p;
  p = (async () => {
    try {
      const spec = OFFICE_TEXTURES[id];
      if (!spec?.url) return null;
      const t = await new THREE.TextureLoader().loadAsync(assetUrl(spec.url));
      t.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = spec.tileable || id === 'skyline' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.wrapT = spec.tileable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = 4;
      return t;
    } catch {
      return null;
    }
  })();
  textureCache.set(id, p);
  return p;
}

/** Drops cached promises (does not dispose GPU resources owned by scene users). For tests / level teardown. */
export function clearOfficeAssetCache(): void {
  modelCache.clear();
  textureCache.clear();
}
