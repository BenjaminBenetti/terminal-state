// Task office-overhaul-20261030 (Studio Beta, lane ASSETS): lazy registry of the company signature props (D01-D40, 20 companies x 2)
// and the supporting office-overhaul models (E01-E18: executive suite, server room, lobby, leisure, small plant, roof, toilet),
// all generated with Meshy T2.5 (smart-topology text-to-3D preview + 2K PBR refine). Every file is a runtime derivative documented
// in public/assets/derivatives/office-overhaul-20261030.json (task ids, model, prompts, raw + derivative hashes, credits); rebuilt by
// tools/asset-pipeline/props/build-office-overhaul.mjs, which also rewrites the GENERATED block below and the three.js-free
// companyDims.generated.ts (measured dims + nominal specs for gen/ code).
//
// Conventions of every model: metres at real size (sizeM along sizeAxis), +Y up, grounded (min y = 0), centred on x/z, front -Z.
// Use `dims` (measured runtime bounds [x, y, z]) for collision / placement footprints; `placement` is the manifest hint
// ('wall' = back against a wall, its front -Z facing into the room).
// `url` is null until the derivative is delivered (or when its generation failed): consumers MUST keep a geometry fallback.
// Nothing here is preloaded: loadCompanyAsset fetches on demand (only the tenants present in a layout), caches per id, resolves null
// on any failure and never throws. (A url string is only listed for a file that exists, because the CI packager rejects bundle
// literals that point at missing assets.) Lazy-library keys are `office-<id>` (same convention as OFFICE_MODEL_FILES).

import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from './loader';
import type {CompanyId} from '../gen/office/overhaulTypes';

export type CompanyAssetId =
  // D01-D40: two signature props per company (manifest order: bubblr, pixelforge, halden, crestmark, verdant, arcline, metro9,
  // ember, stride, wonderbox, lowtide, calloway, ardent, tidewater, nimbus, ironclad, pemberton, pawprint, goldencrust, orbital)
  | 'gumball-machine' | 'gumball-jar' | 'arcade-cabinet' | 'console-station' | 'law-bookcase' | 'justice-statue'
  | 'trading-desk' | 'bull-statue' | 'lab-bench' | 'biohazard-fridge' | 'architect-model' | 'drafting-table'
  | 'tv-camera' | 'news-desk' | 'espresso-machine' | 'coffee-roaster' | 'treadmill' | 'sneaker-wall'
  | 'giant-teddy' | 'rocking-horse' | 'jukebox' | 'mixing-console' | 'exam-table' | 'vitals-monitor'
  | 'dress-form' | 'clothing-rack' | 'ship-model' | 'parcel-pallet' | 'nap-pod' | 'kegerator'
  | 'cctv-console' | 'metal-detector' | 'vault-safe' | 'archive-boxes' | 'aquarium' | 'cat-tree'
  | 'dough-mixer' | 'bakery-case' | 'satellite-model' | 'telescope'
  // E01-E18: supporting models (executive suite, server room, lobby, leisure, small plant, roof, toilet)
  | 'executive-desk' | 'executive-chair' | 'chesterfield-sofa' | 'globe-bar' | 'server-cabinet' | 'crac-unit'
  | 'lobby-sofa' | 'planter-tree' | 'security-turnstile' | 'foosball-table' | 'ping-pong-table' | 'bean-bag'
  | 'lounge-armchair' | 'potted-plant-small' | 'rooftop-hvac' | 'water-tower' | 'satellite-dish' | 'toilet';

export type CompanyAssetUse = 'company' | 'support';
export type CompanyAssetPlacement = 'floor' | 'wall' | 'floor-or-counter';

export interface CompanyAssetEntry {
  /** Relative runtime URL (assets/models/office-<id>.glb), or null while not delivered. */
  url: string | null;
  /** File size in bytes (0 while not delivered). */
  bytes: number;
  /** Triangle count of the runtime derivative (0 while not delivered). */
  tris: number;
  /** Real-world size in metres along sizeAxis (the derivative is already scaled to it). */
  sizeM: number;
  /** Which extent sizeM measures: h = height (y), w = width (x), longest = longest extent. */
  sizeAxis: 'h' | 'w' | 'longest';
  /** Manifest code (D01-D40 company props, E01-E18 supporting models). */
  code: string;
  /** Owning company (gen/office/overhaulTypes CompanyId) for signature props; null for shared supporting models. */
  company: CompanyId | null;
  use: CompanyAssetUse;
  /** Manifest placement hint. */
  placement: CompanyAssetPlacement;
  /** Manifest triangle target (smart-topology target_polycount). */
  targetTris: number;
  /** Measured runtime bounds [x, y, z] in metres (null while not delivered). */
  dims: readonly [number, number, number] | null;
}

// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers
export const COMPANY_ASSETS: Record<CompanyAssetId, CompanyAssetEntry> = {
  'gumball-machine': {url: 'assets/models/office-gumball-machine.glb', bytes: 270516, tris: 3595, sizeM: 1.35, sizeAxis: 'h', code: 'D01', company: 'bubblr', use: 'company', placement: 'floor', targetTris: 3500, dims: [0.4866, 1.35, 0.4921]},
  'gumball-jar': {url: 'assets/models/office-gumball-jar.glb', bytes: 218628, tris: 2251, sizeM: 0.75, sizeAxis: 'h', code: 'D02', company: 'bubblr', use: 'company', placement: 'floor-or-counter', targetTris: 2500, dims: [1.0336, 0.75, 0.6604]},
  'arcade-cabinet': {url: 'assets/models/office-arcade-cabinet.glb', bytes: 420056, tris: 3758, sizeM: 1.8, sizeAxis: 'h', code: 'D03', company: 'pixelforge', use: 'company', placement: 'wall', targetTris: 4000, dims: [0.6095, 1.8, 0.628]},
  'console-station': {url: 'assets/models/office-console-station.glb', bytes: 251664, tris: 4076, sizeM: 1.4, sizeAxis: 'w', code: 'D04', company: 'pixelforge', use: 'company', placement: 'wall', targetTris: 4000, dims: [1.4, 0.9305, 0.779]},
  'law-bookcase': {url: 'assets/models/office-law-bookcase.glb', bytes: 376656, tris: 3802, sizeM: 2.2, sizeAxis: 'h', code: 'D05', company: 'halden', use: 'company', placement: 'wall', targetTris: 4000, dims: [1.1317, 2.2, 0.6749]},
  'justice-statue': {url: 'assets/models/office-justice-statue.glb', bytes: 464520, tris: 4168, sizeM: 1.7, sizeAxis: 'h', code: 'D06', company: 'halden', use: 'company', placement: 'floor', targetTris: 4000, dims: [0.7233, 1.7, 0.5388]},
  'trading-desk': {url: 'assets/models/office-trading-desk.glb', bytes: 406132, tris: 4350, sizeM: 1.8, sizeAxis: 'w', code: 'D07', company: 'crestmark', use: 'company', placement: 'floor', targetTris: 4500, dims: [1.8, 0.6844, 0.7535]},
  'bull-statue': {url: 'assets/models/office-bull-statue.glb', bytes: 240676, tris: 4210, sizeM: 1.4, sizeAxis: 'longest', code: 'D08', company: 'crestmark', use: 'company', placement: 'floor', targetTris: 4000, dims: [0.4478, 0.6069, 1.4]},
  'lab-bench': {url: 'assets/models/office-lab-bench.glb', bytes: 452504, tris: 4318, sizeM: 1.8, sizeAxis: 'w', code: 'D09', company: 'verdant', use: 'company', placement: 'wall', targetTris: 4500, dims: [1.8, 0.9262, 0.5067]},
  'biohazard-fridge': {url: 'assets/models/office-biohazard-fridge.glb', bytes: 370796, tris: 2589, sizeM: 2, sizeAxis: 'h', code: 'D10', company: 'verdant', use: 'company', placement: 'wall', targetTris: 3500, dims: [0.902, 2, 0.7665]},
  'architect-model': {url: 'assets/models/office-architect-model.glb', bytes: 452296, tris: 3873, sizeM: 1.6, sizeAxis: 'w', code: 'D11', company: 'arcline', use: 'company', placement: 'floor', targetTris: 4500, dims: [1.6, 1.6099, 1.456]},
  'drafting-table': {url: 'assets/models/office-drafting-table.glb', bytes: 259812, tris: 3311, sizeM: 1.3, sizeAxis: 'w', code: 'D12', company: 'arcline', use: 'company', placement: 'floor', targetTris: 3500, dims: [1.3, 1.1357, 1.0022]},
  'tv-camera': {url: 'assets/models/office-tv-camera.glb', bytes: 284120, tris: 3892, sizeM: 1.7, sizeAxis: 'h', code: 'D13', company: 'metro9', use: 'company', placement: 'floor', targetTris: 4000, dims: [0.8456, 1.7, 1.3987]},
  'news-desk': {url: 'assets/models/office-news-desk.glb', bytes: 539256, tris: 4167, sizeM: 2.6, sizeAxis: 'w', code: 'D14', company: 'metro9', use: 'company', placement: 'floor', targetTris: 4000, dims: [2.6, 1.237, 1.766]},
  'espresso-machine': {url: 'assets/models/office-espresso-machine.glb', bytes: 325804, tris: 3819, sizeM: 1.4, sizeAxis: 'w', code: 'D15', company: 'ember', use: 'company', placement: 'wall', targetTris: 4000, dims: [1.4, 1.2869, 1.4065]},
  'coffee-roaster': {url: 'assets/models/office-coffee-roaster.glb', bytes: 417544, tris: 4385, sizeM: 1.8, sizeAxis: 'h', code: 'D16', company: 'ember', use: 'company', placement: 'floor', targetTris: 4500, dims: [2.4346, 1.8, 1.5797]},
  'treadmill': {url: 'assets/models/office-treadmill.glb', bytes: 326436, tris: 3394, sizeM: 2, sizeAxis: 'longest', code: 'D17', company: 'stride', use: 'company', placement: 'floor', targetTris: 3500, dims: [1.188, 1.8537, 2]},
  'sneaker-wall': {url: 'assets/models/office-sneaker-wall.glb', bytes: 449384, tris: 4306, sizeM: 2, sizeAxis: 'h', code: 'D18', company: 'stride', use: 'company', placement: 'wall', targetTris: 4500, dims: [2.3248, 2, 0.6544]},
  'giant-teddy': {url: 'assets/models/office-giant-teddy.glb', bytes: 244396, tris: 3675, sizeM: 1.2, sizeAxis: 'h', code: 'D19', company: 'wonderbox', use: 'company', placement: 'floor', targetTris: 3500, dims: [1.2958, 1.2, 1.2099]},
  'rocking-horse': {url: 'assets/models/office-rocking-horse.glb', bytes: 288588, tris: 3524, sizeM: 1.2, sizeAxis: 'longest', code: 'D20', company: 'wonderbox', use: 'company', placement: 'floor', targetTris: 3500, dims: [0.5139, 0.9856, 1.2]},
  'jukebox': {url: 'assets/models/office-jukebox.glb', bytes: 509156, tris: 3950, sizeM: 1.6, sizeAxis: 'h', code: 'D21', company: 'lowtide', use: 'company', placement: 'wall', targetTris: 4000, dims: [1.1955, 1.6, 0.8944]},
  'mixing-console': {url: 'assets/models/office-mixing-console.glb', bytes: 438332, tris: 3806, sizeM: 2, sizeAxis: 'w', code: 'D22', company: 'lowtide', use: 'company', placement: 'floor', targetTris: 4500, dims: [2, 1.2524, 1.9928]},
  'exam-table': {url: 'assets/models/office-exam-table.glb', bytes: 440364, tris: 2900, sizeM: 1.9, sizeAxis: 'longest', code: 'D23', company: 'calloway', use: 'company', placement: 'wall', targetTris: 3000, dims: [1.9, 0.9933, 0.7462]},
  'vitals-monitor': {url: 'assets/models/office-vitals-monitor.glb', bytes: 396496, tris: 2996, sizeM: 1.6, sizeAxis: 'h', code: 'D24', company: 'calloway', use: 'company', placement: 'floor', targetTris: 3000, dims: [0.8496, 1.6, 0.6192]},
  'dress-form': {url: 'assets/models/office-dress-form.glb', bytes: 278060, tris: 3404, sizeM: 1.7, sizeAxis: 'h', code: 'D25', company: 'ardent', use: 'company', placement: 'floor', targetTris: 3500, dims: [0.5635, 1.7, 0.3934]},
  'clothing-rack': {url: 'assets/models/office-clothing-rack.glb', bytes: 533344, tris: 4242, sizeM: 1.5, sizeAxis: 'w', code: 'D26', company: 'ardent', use: 'company', placement: 'floor', targetTris: 4500, dims: [1.5, 1.3332, 0.5736]},
  'ship-model': {url: 'assets/models/office-ship-model.glb', bytes: 480996, tris: 3865, sizeM: 1.6, sizeAxis: 'w', code: 'D27', company: 'tidewater', use: 'company', placement: 'floor', targetTris: 4500, dims: [1.6, 0.5948, 0.4064]},
  'parcel-pallet': {url: 'assets/models/office-parcel-pallet.glb', bytes: 238040, tris: 2993, sizeM: 1.2, sizeAxis: 'w', code: 'D28', company: 'tidewater', use: 'company', placement: 'floor', targetTris: 3000, dims: [1.2, 1.3046, 1.4394]},
  'nap-pod': {url: 'assets/models/office-nap-pod.glb', bytes: 290416, tris: 3536, sizeM: 1.8, sizeAxis: 'longest', code: 'D29', company: 'nimbus', use: 'company', placement: 'wall', targetTris: 3500, dims: [1.8, 1.2658, 1.6265]},
  'kegerator': {url: 'assets/models/office-kegerator.glb', bytes: 214100, tris: 3023, sizeM: 1.4, sizeAxis: 'h', code: 'D30', company: 'nimbus', use: 'company', placement: 'wall', targetTris: 3000, dims: [1.3187, 1.4, 1.3698]},
  'cctv-console': {url: 'assets/models/office-cctv-console.glb', bytes: 438720, tris: 4133, sizeM: 2, sizeAxis: 'w', code: 'D31', company: 'ironclad', use: 'company', placement: 'wall', targetTris: 4500, dims: [2, 1.0221, 1.2378]},
  'metal-detector': {url: 'assets/models/office-metal-detector.glb', bytes: 352596, tris: 2551, sizeM: 2.2, sizeAxis: 'h', code: 'D32', company: 'ironclad', use: 'company', placement: 'floor', targetTris: 2500, dims: [3.1165, 2.2, 1.9887]},
  'vault-safe': {url: 'assets/models/office-vault-safe.glb', bytes: 380020, tris: 3499, sizeM: 1.5, sizeAxis: 'h', code: 'D33', company: 'pemberton', use: 'company', placement: 'wall', targetTris: 3500, dims: [1.3128, 1.5, 1.3544]},
  'archive-boxes': {url: 'assets/models/office-archive-boxes.glb', bytes: 189748, tris: 2378, sizeM: 1.3, sizeAxis: 'h', code: 'D34', company: 'pemberton', use: 'company', placement: 'floor', targetTris: 2500, dims: [0.578, 1.3, 0.7307]},
  'aquarium': {url: 'assets/models/office-aquarium.glb', bytes: 346456, tris: 2859, sizeM: 1.5, sizeAxis: 'w', code: 'D35', company: 'pawprint', use: 'company', placement: 'wall', targetTris: 3500, dims: [1.5, 0.6359, 0.6952]},
  'cat-tree': {url: 'assets/models/office-cat-tree.glb', bytes: 364240, tris: 3523, sizeM: 1.8, sizeAxis: 'h', code: 'D36', company: 'pawprint', use: 'company', placement: 'floor', targetTris: 3500, dims: [0.5403, 1.8, 0.6456]},
  'dough-mixer': {url: 'assets/models/office-dough-mixer.glb', bytes: 330888, tris: 3597, sizeM: 1.5, sizeAxis: 'h', code: 'D37', company: 'goldencrust', use: 'company', placement: 'wall', targetTris: 3500, dims: [0.7123, 1.5, 0.9238]},
  'bakery-case': {url: 'assets/models/office-bakery-case.glb', bytes: 454580, tris: 4396, sizeM: 1.6, sizeAxis: 'w', code: 'D38', company: 'goldencrust', use: 'company', placement: 'floor', targetTris: 4500, dims: [1.6, 1.1104, 1.1384]},
  'satellite-model': {url: 'assets/models/office-satellite-model.glb', bytes: 528188, tris: 3948, sizeM: 1.8, sizeAxis: 'longest', code: 'D39', company: 'orbital', use: 'company', placement: 'floor', targetTris: 4000, dims: [1.8, 0.8959, 0.7059]},
  'telescope': {url: 'assets/models/office-telescope.glb', bytes: 466532, tris: 3529, sizeM: 1.8, sizeAxis: 'h', code: 'D40', company: 'orbital', use: 'company', placement: 'floor', targetTris: 3500, dims: [0.9162, 1.8, 1.4983]},
  'executive-desk': {url: 'assets/models/office-executive-desk.glb', bytes: 506668, tris: 4158, sizeM: 2, sizeAxis: 'w', code: 'E01', company: null, use: 'support', placement: 'floor', targetTris: 4000, dims: [2, 0.9722, 1.0791]},
  'executive-chair': {url: 'assets/models/office-executive-chair.glb', bytes: 269436, tris: 3577, sizeM: 1.25, sizeAxis: 'h', code: 'E02', company: null, use: 'support', placement: 'floor', targetTris: 3500, dims: [0.7045, 1.25, 0.7192]},
  'chesterfield-sofa': {url: 'assets/models/office-chesterfield-sofa.glb', bytes: 279844, tris: 4134, sizeM: 2.1, sizeAxis: 'w', code: 'E03', company: null, use: 'support', placement: 'wall', targetTris: 4000, dims: [2.1, 0.8449, 1.1448]},
  'globe-bar': {url: 'assets/models/office-globe-bar.glb', bytes: 304048, tris: 4123, sizeM: 1, sizeAxis: 'h', code: 'E04', company: null, use: 'support', placement: 'floor', targetTris: 4000, dims: [0.6691, 1, 0.6701]},
  'server-cabinet': {url: 'assets/models/office-server-cabinet.glb', bytes: 284588, tris: 3009, sizeM: 2, sizeAxis: 'h', code: 'E05', company: null, use: 'support', placement: 'wall', targetTris: 3000, dims: [2.9175, 2, 1.3808]},
  'crac-unit': {url: 'assets/models/office-crac-unit.glb', bytes: 356392, tris: 2548, sizeM: 1.9, sizeAxis: 'h', code: 'E06', company: null, use: 'support', placement: 'wall', targetTris: 2500, dims: [0.5647, 1.9, 0.7032]},
  'lobby-sofa': {url: 'assets/models/office-lobby-sofa.glb', bytes: 355544, tris: 3438, sizeM: 2.2, sizeAxis: 'w', code: 'E07', company: null, use: 'support', placement: 'floor', targetTris: 3500, dims: [2.2, 0.7903, 1.0376]},
  'planter-tree': {url: 'assets/models/office-planter-tree.glb', bytes: 411936, tris: 3027, sizeM: 2.2, sizeAxis: 'h', code: 'E08', company: null, use: 'support', placement: 'wall', targetTris: 3500, dims: [1.0358, 2.2, 0.9693]},
  'security-turnstile': {url: 'assets/models/office-security-turnstile.glb', bytes: 185696, tris: 2309, sizeM: 1, sizeAxis: 'h', code: 'E09', company: null, use: 'support', placement: 'floor', targetTris: 2500, dims: [1.5852, 1, 1.0204]},
  'foosball-table': {url: 'assets/models/office-foosball-table.glb', bytes: 310132, tris: 3938, sizeM: 1.4, sizeAxis: 'longest', code: 'E10', company: null, use: 'support', placement: 'floor', targetTris: 4000, dims: [1.4, 0.5199, 1.2576]},
  'ping-pong-table': {url: 'assets/models/office-ping-pong-table.glb', bytes: 327328, tris: 2980, sizeM: 2.74, sizeAxis: 'longest', code: 'E11', company: null, use: 'support', placement: 'floor', targetTris: 3000, dims: [2.4204, 0.8281, 2.74]},
  'bean-bag': {url: 'assets/models/office-bean-bag.glb', bytes: 134200, tris: 2118, sizeM: 0.9, sizeAxis: 'longest', code: 'E12', company: null, use: 'support', placement: 'floor', targetTris: 2000, dims: [0.8629, 0.3889, 0.9]},
  'lounge-armchair': {url: 'assets/models/office-lounge-armchair.glb', bytes: 223620, tris: 3176, sizeM: 0.85, sizeAxis: 'h', code: 'E13', company: null, use: 'support', placement: 'floor', targetTris: 3000, dims: [0.8484, 0.85, 1.0191]},
  'potted-plant-small': {url: 'assets/models/office-potted-plant-small.glb', bytes: 176956, tris: 1766, sizeM: 0.6, sizeAxis: 'h', code: 'E14', company: null, use: 'support', placement: 'wall', targetTris: 2000, dims: [0.4199, 0.6, 0.4294]},
  'rooftop-hvac': {url: 'assets/models/office-rooftop-hvac.glb', bytes: 307164, tris: 3068, sizeM: 2.4, sizeAxis: 'longest', code: 'E15', company: null, use: 'support', placement: 'floor', targetTris: 3500, dims: [2.1294, 2.3213, 2.4]},
  'water-tower': {url: 'assets/models/office-water-tower.glb', bytes: 472444, tris: 3459, sizeM: 4.5, sizeAxis: 'h', code: 'E16', company: null, use: 'support', placement: 'floor', targetTris: 4000, dims: [4.5873, 4.5, 4.5826]},
  'satellite-dish': {url: 'assets/models/office-satellite-dish.glb', bytes: 418772, tris: 2415, sizeM: 1.8, sizeAxis: 'longest', code: 'E17', company: null, use: 'support', placement: 'floor', targetTris: 2500, dims: [1.5893, 1.8, 1.326]},
  'toilet': {url: 'assets/models/office-toilet.glb', bytes: 169120, tris: 2076, sizeM: 0.8, sizeAxis: 'h', code: 'E18', company: null, use: 'support', placement: 'wall', targetTris: 2000, dims: [0.4453, 0.8, 0.6517]},
};
// END GENERATED

export const COMPANY_ASSET_IDS = Object.keys(COMPANY_ASSETS) as CompanyAssetId[];

/** Delivered (url present) asset ids, optionally filtered by use. */
export function companyAssetsReady(use?: CompanyAssetUse): CompanyAssetId[] {
  return COMPANY_ASSET_IDS.filter(id => COMPANY_ASSETS[id].url !== null && (!use || COMPANY_ASSETS[id].use === use));
}

/** The two signature prop ids of a company (manifest order), delivered or not. */
export function companySignatureAssets(company: CompanyId): CompanyAssetId[] {
  return COMPANY_ASSET_IDS.filter(id => COMPANY_ASSETS[id].company === company);
}

/** Lazy-library file map (same shape as assets/loader.ts PropModelLibrary input) of the delivered models, keyed `office-<id>`. */
export const COMPANY_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(
  COMPANY_ASSET_IDS.flatMap(id => { const a = COMPANY_ASSETS[id]; return a.url ? [[`office-${id}`, {url: a.url, bytes: a.bytes}]] : []; }));

const modelCache = new Map<CompanyAssetId, Promise<GLTF | null>>();
let gltfLoader: GLTFLoader | null = null;

/** Loads (once, cached per id) a company / supporting model; resolves null when not delivered or on any error. Never throws. */
export function loadCompanyAsset(id: CompanyAssetId): Promise<GLTF | null> {
  let p = modelCache.get(id);
  if (p) return p;
  p = (async () => {
    try {
      const url = COMPANY_ASSETS[id]?.url;
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

/** Drops cached promises (does not dispose GPU resources owned by scene users). For tests / level teardown. */
export function clearCompanyAssetCache(): void {
  modelCache.clear();
}
