// Task office-overhaul-20261030 (Studio Beta, lane ASSETS): pure-data (three.js-free) measured bounds + nominal specs of the
// company / supporting office-overhaul models, for gen/ code (footprints, placement). COMPANY_DIMS mirrors COMPANY_ASSETS[id].dims
// in src/assets/companyAssets.ts; both are rewritten by tools/asset-pipeline/props/build-office-overhaul.mjs. Keys are the asset
// ids (manifest D01-D40, E01-E18). dims = [x, y, z] metres of the runtime GLB (front -Z, +Y up, grounded, centred on x/z); null
// while not delivered — then fall back to the nominal size (COMPANY_ASSET_SPECS: sizeM along sizeAxis).
// No imports: safe for the generator, workers and tests.

export type CompanyAssetSizeAxis = 'h' | 'w' | 'longest';

export interface CompanyAssetSpec {
  /** Manifest code (D01-D40 company props, E01-E18 supporting models). */
  code: string;
  /** Owning company id (gen/office/overhaulTypes CompanyId) or null for shared supporting models. */
  company: string | null;
  use: 'company' | 'support';
  /** Nominal real-world size (m) along sizeAxis; the runtime model is scaled to exactly this. */
  sizeM: number;
  /** h = height (y), w = width (x), longest = longest extent. */
  sizeAxis: CompanyAssetSizeAxis;
  /** 'wall' = back against a wall, front -Z facing into the room. */
  placement: 'floor' | 'wall' | 'floor-or-counter';
}

// BEGIN GENERATED (build-office-overhaul.mjs) — do not hand-edit between the markers
export const COMPANY_DIMS: Record<string, readonly [number, number, number] | null> = {
  'gumball-machine': [0.4866, 1.35, 0.4921],
  'gumball-jar': [1.0336, 0.75, 0.6604],
  'arcade-cabinet': [0.6095, 1.8, 0.628],
  'console-station': [1.4, 0.9305, 0.779],
  'law-bookcase': [1.1317, 2.2, 0.6749],
  'justice-statue': [0.7233, 1.7, 0.5388],
  'trading-desk': [1.8, 0.6844, 0.7535],
  'bull-statue': [0.4478, 0.6069, 1.4],
  'lab-bench': [1.8, 0.9262, 0.5067],
  'biohazard-fridge': [0.902, 2, 0.7665],
  'architect-model': [1.6, 1.6099, 1.456],
  'drafting-table': [1.3, 1.1357, 1.0022],
  'tv-camera': [0.8456, 1.7, 1.3987],
  'news-desk': [2.6, 1.237, 1.766],
  'espresso-machine': [1.4, 1.2869, 1.4065],
  'coffee-roaster': [2.4346, 1.8, 1.5797],
  'treadmill': [1.188, 1.8537, 2],
  'sneaker-wall': [2.3248, 2, 0.6544],
  'giant-teddy': [1.2958, 1.2, 1.2099],
  'rocking-horse': [0.5139, 0.9856, 1.2],
  'jukebox': null,
  'mixing-console': null,
  'exam-table': null,
  'vitals-monitor': null,
  'dress-form': null,
  'clothing-rack': null,
  'ship-model': null,
  'parcel-pallet': null,
  'nap-pod': null,
  'kegerator': null,
  'cctv-console': null,
  'metal-detector': null,
  'vault-safe': null,
  'archive-boxes': null,
  'aquarium': null,
  'cat-tree': null,
  'dough-mixer': null,
  'bakery-case': null,
  'satellite-model': null,
  'telescope': null,
  'executive-desk': null,
  'executive-chair': null,
  'chesterfield-sofa': null,
  'globe-bar': null,
  'server-cabinet': null,
  'crac-unit': null,
  'lobby-sofa': null,
  'planter-tree': null,
  'security-turnstile': null,
  'foosball-table': null,
  'ping-pong-table': null,
  'bean-bag': null,
  'lounge-armchair': null,
  'potted-plant-small': null,
  'rooftop-hvac': null,
  'water-tower': null,
  'satellite-dish': null,
  'toilet': null,
};

export const COMPANY_ASSET_SPECS: Record<string, CompanyAssetSpec> = {
  'gumball-machine': {code: 'D01', company: 'bubblr', use: 'company', sizeM: 1.35, sizeAxis: 'h', placement: 'floor'},
  'gumball-jar': {code: 'D02', company: 'bubblr', use: 'company', sizeM: 0.75, sizeAxis: 'h', placement: 'floor-or-counter'},
  'arcade-cabinet': {code: 'D03', company: 'pixelforge', use: 'company', sizeM: 1.8, sizeAxis: 'h', placement: 'wall'},
  'console-station': {code: 'D04', company: 'pixelforge', use: 'company', sizeM: 1.4, sizeAxis: 'w', placement: 'wall'},
  'law-bookcase': {code: 'D05', company: 'halden', use: 'company', sizeM: 2.2, sizeAxis: 'h', placement: 'wall'},
  'justice-statue': {code: 'D06', company: 'halden', use: 'company', sizeM: 1.7, sizeAxis: 'h', placement: 'floor'},
  'trading-desk': {code: 'D07', company: 'crestmark', use: 'company', sizeM: 1.8, sizeAxis: 'w', placement: 'floor'},
  'bull-statue': {code: 'D08', company: 'crestmark', use: 'company', sizeM: 1.4, sizeAxis: 'longest', placement: 'floor'},
  'lab-bench': {code: 'D09', company: 'verdant', use: 'company', sizeM: 1.8, sizeAxis: 'w', placement: 'wall'},
  'biohazard-fridge': {code: 'D10', company: 'verdant', use: 'company', sizeM: 2, sizeAxis: 'h', placement: 'wall'},
  'architect-model': {code: 'D11', company: 'arcline', use: 'company', sizeM: 1.6, sizeAxis: 'w', placement: 'floor'},
  'drafting-table': {code: 'D12', company: 'arcline', use: 'company', sizeM: 1.3, sizeAxis: 'w', placement: 'floor'},
  'tv-camera': {code: 'D13', company: 'metro9', use: 'company', sizeM: 1.7, sizeAxis: 'h', placement: 'floor'},
  'news-desk': {code: 'D14', company: 'metro9', use: 'company', sizeM: 2.6, sizeAxis: 'w', placement: 'floor'},
  'espresso-machine': {code: 'D15', company: 'ember', use: 'company', sizeM: 1.4, sizeAxis: 'w', placement: 'wall'},
  'coffee-roaster': {code: 'D16', company: 'ember', use: 'company', sizeM: 1.8, sizeAxis: 'h', placement: 'floor'},
  'treadmill': {code: 'D17', company: 'stride', use: 'company', sizeM: 2, sizeAxis: 'longest', placement: 'floor'},
  'sneaker-wall': {code: 'D18', company: 'stride', use: 'company', sizeM: 2, sizeAxis: 'h', placement: 'wall'},
  'giant-teddy': {code: 'D19', company: 'wonderbox', use: 'company', sizeM: 1.2, sizeAxis: 'h', placement: 'floor'},
  'rocking-horse': {code: 'D20', company: 'wonderbox', use: 'company', sizeM: 1.2, sizeAxis: 'longest', placement: 'floor'},
  'jukebox': {code: 'D21', company: 'lowtide', use: 'company', sizeM: 1.6, sizeAxis: 'h', placement: 'wall'},
  'mixing-console': {code: 'D22', company: 'lowtide', use: 'company', sizeM: 2, sizeAxis: 'w', placement: 'floor'},
  'exam-table': {code: 'D23', company: 'calloway', use: 'company', sizeM: 1.9, sizeAxis: 'longest', placement: 'wall'},
  'vitals-monitor': {code: 'D24', company: 'calloway', use: 'company', sizeM: 1.6, sizeAxis: 'h', placement: 'floor'},
  'dress-form': {code: 'D25', company: 'ardent', use: 'company', sizeM: 1.7, sizeAxis: 'h', placement: 'floor'},
  'clothing-rack': {code: 'D26', company: 'ardent', use: 'company', sizeM: 1.5, sizeAxis: 'w', placement: 'floor'},
  'ship-model': {code: 'D27', company: 'tidewater', use: 'company', sizeM: 1.6, sizeAxis: 'w', placement: 'floor'},
  'parcel-pallet': {code: 'D28', company: 'tidewater', use: 'company', sizeM: 1.2, sizeAxis: 'w', placement: 'floor'},
  'nap-pod': {code: 'D29', company: 'nimbus', use: 'company', sizeM: 1.8, sizeAxis: 'longest', placement: 'wall'},
  'kegerator': {code: 'D30', company: 'nimbus', use: 'company', sizeM: 1.4, sizeAxis: 'h', placement: 'wall'},
  'cctv-console': {code: 'D31', company: 'ironclad', use: 'company', sizeM: 2, sizeAxis: 'w', placement: 'wall'},
  'metal-detector': {code: 'D32', company: 'ironclad', use: 'company', sizeM: 2.2, sizeAxis: 'h', placement: 'floor'},
  'vault-safe': {code: 'D33', company: 'pemberton', use: 'company', sizeM: 1.5, sizeAxis: 'h', placement: 'wall'},
  'archive-boxes': {code: 'D34', company: 'pemberton', use: 'company', sizeM: 1.3, sizeAxis: 'h', placement: 'floor'},
  'aquarium': {code: 'D35', company: 'pawprint', use: 'company', sizeM: 1.5, sizeAxis: 'w', placement: 'wall'},
  'cat-tree': {code: 'D36', company: 'pawprint', use: 'company', sizeM: 1.8, sizeAxis: 'h', placement: 'floor'},
  'dough-mixer': {code: 'D37', company: 'goldencrust', use: 'company', sizeM: 1.5, sizeAxis: 'h', placement: 'wall'},
  'bakery-case': {code: 'D38', company: 'goldencrust', use: 'company', sizeM: 1.6, sizeAxis: 'w', placement: 'floor'},
  'satellite-model': {code: 'D39', company: 'orbital', use: 'company', sizeM: 1.8, sizeAxis: 'longest', placement: 'floor'},
  'telescope': {code: 'D40', company: 'orbital', use: 'company', sizeM: 1.8, sizeAxis: 'h', placement: 'floor'},
  'executive-desk': {code: 'E01', company: null, use: 'support', sizeM: 2, sizeAxis: 'w', placement: 'floor'},
  'executive-chair': {code: 'E02', company: null, use: 'support', sizeM: 1.25, sizeAxis: 'h', placement: 'floor'},
  'chesterfield-sofa': {code: 'E03', company: null, use: 'support', sizeM: 2.1, sizeAxis: 'w', placement: 'wall'},
  'globe-bar': {code: 'E04', company: null, use: 'support', sizeM: 1, sizeAxis: 'h', placement: 'floor'},
  'server-cabinet': {code: 'E05', company: null, use: 'support', sizeM: 2, sizeAxis: 'h', placement: 'wall'},
  'crac-unit': {code: 'E06', company: null, use: 'support', sizeM: 1.9, sizeAxis: 'h', placement: 'wall'},
  'lobby-sofa': {code: 'E07', company: null, use: 'support', sizeM: 2.2, sizeAxis: 'w', placement: 'floor'},
  'planter-tree': {code: 'E08', company: null, use: 'support', sizeM: 2.2, sizeAxis: 'h', placement: 'wall'},
  'security-turnstile': {code: 'E09', company: null, use: 'support', sizeM: 1, sizeAxis: 'h', placement: 'floor'},
  'foosball-table': {code: 'E10', company: null, use: 'support', sizeM: 1.4, sizeAxis: 'longest', placement: 'floor'},
  'ping-pong-table': {code: 'E11', company: null, use: 'support', sizeM: 2.74, sizeAxis: 'longest', placement: 'floor'},
  'bean-bag': {code: 'E12', company: null, use: 'support', sizeM: 0.9, sizeAxis: 'longest', placement: 'floor'},
  'lounge-armchair': {code: 'E13', company: null, use: 'support', sizeM: 0.85, sizeAxis: 'h', placement: 'floor'},
  'potted-plant-small': {code: 'E14', company: null, use: 'support', sizeM: 0.6, sizeAxis: 'h', placement: 'wall'},
  'rooftop-hvac': {code: 'E15', company: null, use: 'support', sizeM: 2.4, sizeAxis: 'longest', placement: 'floor'},
  'water-tower': {code: 'E16', company: null, use: 'support', sizeM: 4.5, sizeAxis: 'h', placement: 'floor'},
  'satellite-dish': {code: 'E17', company: null, use: 'support', sizeM: 1.8, sizeAxis: 'longest', placement: 'floor'},
  'toilet': {code: 'E18', company: null, use: 'support', sizeM: 0.8, sizeAxis: 'h', placement: 'wall'},
};
// END GENERATED
