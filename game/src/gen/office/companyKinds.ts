// Task office-overhaul-20261030 (lane TENANTS): the company / supporting prop kinds of the office overhaul — pure data (no
// three.js), merged into gen/office/kinds.ts OFFICE_KINDS (so PROP_DEFS, the damage specs and the office render path pick them up).
//
// Kind = camelCase of the manifest id (assets/manifest.json D01-D40 company props, E01-E17 supporting models; `toilet` E18 is lane
// INTERACT's). Footprints (m, prop frame: origin bottom centre, front +Z) = the delivered model's MEASURED bounds
// (assets/companyDims.generated.ts COMPANY_DIMS [x, y, z] -> w = x, h = y, d = z) or, while a model is not delivered, the nominal box
// below (manifest sizeM along its sizeAxis, plausible other extents). Model files face -Z; world/officeProps.ts turns them to +Z.
// Render: lane ASSETS' models (assets/companyAssets.ts COMPANY_MODEL_FILES, lazy keys `office-<assetId>`) through the game's prop
// model library, else the box forms of companyShape (a model and its stand-in occupy the same box). `logoWall` is geometry only
// (the free-standing reception logo wall the company sign is mounted on).
//
// None of these kinds is a loot holder (decision, lane TENANTS): they are fused single meshes with no measured loot surfaces or
// separable doors, and the holder plumbing (items/loot.ts, lootLayout, containers, openables) stays untouched. Company rooms pair
// them with EXISTING holders instead (the vault room's openable `safe`, the clinic's `medCabinet`, the café / test kitchen's
// `fridge` + `kitchenette`, the control room's `gunLocker`, reception back counters `cabinetLow` …) whose purposes carry the
// company's loot theme (gen/purposes.ts office-* entries), so scarcity is unchanged.

import type {PropDef} from '../props';
import type {ShapeMat, ShapePart} from '../propShapes';
import type {DamageClass} from '../../damage/materials';
import {COMPANY_DIMS} from '../../assets/companyDims.generated';

type AuditCls = 'none' | 'exception';
interface KindSpec {
  /** Manifest asset id (assets/companyAssets.ts CompanyAssetId), null = geometry only. */
  asset: string | null;
  /** Nominal box [w (x), d (z), h (y)] m used until the model's measured dims exist. */
  box: readonly [number, number, number];
  blocksSight?: boolean;
  cls: DamageClass;
  /** Openables audit (world/openablesSpec.ts): 'exception' = a door / lid / drawer that deliberately does not open. */
  audit?: {cls: AuditCls; how: string};
}

const SPECS = {
  // --- D01-D40: company signature props (two per company) ---------------------------------------------------------------------
  gumballMachine: {asset: 'gumball-machine', box: [0.5, 0.5, 1.35], cls: 'glass', audit: {cls: 'exception', how: 'gumball machine coin flap: dispenses gum only (no item), one fused mesh'}},
  gumballJar: {asset: 'gumball-jar', box: [0.46, 0.46, 0.75], cls: 'glass'},
  arcadeCabinet: {asset: 'arcade-cabinet', box: [0.7, 0.85, 1.8], cls: 'laminate', audit: {cls: 'exception', how: 'arcade cabinet coin door: locked service panel, one fused mesh'}},
  consoleStation: {asset: 'console-station', box: [1.4, 0.5, 1.15], cls: 'plastic'},
  lawBookcase: {asset: 'law-bookcase', box: [1.0, 0.4, 2.2], blocksSight: true, cls: 'wood'},
  justiceStatue: {asset: 'justice-statue', box: [0.6, 0.6, 1.7], cls: 'steel'},
  tradingDesk: {asset: 'trading-desk', box: [1.8, 0.9, 1.25], cls: 'laminate'},
  bullStatue: {asset: 'bull-statue', box: [1.4, 0.6, 0.85], cls: 'steel'},
  labBench: {asset: 'lab-bench', box: [1.8, 0.75, 1.3], cls: 'laminate', audit: {cls: 'exception', how: 'lab bench drawers: fused into the bench mesh (the lab medCabinet is the searchable one)'}},
  biohazardFridge: {asset: 'biohazard-fridge', box: [0.8, 0.75, 2.0], cls: 'sheetMetal', audit: {cls: 'exception', how: 'specimen fridge: sealed biohazard door with sample vials only (no items), one fused mesh'}},
  architectModel: {asset: 'architect-model', box: [1.6, 1.0, 1.1], cls: 'wood'},
  draftingTable: {asset: 'drafting-table', box: [1.3, 0.9, 1.3], cls: 'wood'},
  tvCamera: {asset: 'tv-camera', box: [0.8, 1.0, 1.7], cls: 'steel'},
  newsDesk: {asset: 'news-desk', box: [2.6, 1.1, 1.05], cls: 'laminate'},
  espressoMachine: {asset: 'espresso-machine', box: [1.4, 0.7, 1.4], cls: 'steel'},
  coffeeRoaster: {asset: 'coffee-roaster', box: [1.4, 1.2, 1.8], blocksSight: true, cls: 'steel', audit: {cls: 'exception', how: 'drum roaster hatch: machinery holding old beans only, one fused mesh'}},
  treadmill: {asset: 'treadmill', box: [0.85, 2.0, 1.45], cls: 'plastic'},
  sneakerWall: {asset: 'sneaker-wall', box: [1.6, 0.5, 2.0], blocksSight: true, cls: 'laminate'},
  giantTeddy: {asset: 'giant-teddy', box: [0.9, 0.8, 1.2], cls: 'fabric'},
  rockingHorse: {asset: 'rocking-horse', box: [0.45, 1.2, 0.95], cls: 'wood'},
  jukebox: {asset: 'jukebox', box: [0.95, 0.7, 1.6], cls: 'plastic', audit: {cls: 'exception', how: 'jukebox service panel: locked, records only, one fused mesh'}},
  mixingConsole: {asset: 'mixing-console', box: [2.0, 1.1, 1.35], cls: 'laminate'},
  examTable: {asset: 'exam-table', box: [1.9, 0.75, 0.9], cls: 'fabric', audit: {cls: 'exception', how: 'exam table drawers: fused into the table mesh (the clinic medCabinet is the searchable one)'}},
  vitalsMonitor: {asset: 'vitals-monitor', box: [0.55, 0.55, 1.6], cls: 'plastic'},
  dressForm: {asset: 'dress-form', box: [0.6, 0.6, 1.7], cls: 'fabric'},
  clothingRack: {asset: 'clothing-rack', box: [1.5, 0.6, 1.7], cls: 'fabric'},
  shipModel: {asset: 'ship-model', box: [1.6, 0.6, 1.5], cls: 'glass', audit: {cls: 'exception', how: 'ship model display case: glazed and sealed, cabinet doors fused into the mesh'}},
  parcelPallet: {asset: 'parcel-pallet', box: [1.2, 1.0, 1.4], cls: 'cardboard'},
  napPod: {asset: 'nap-pod', box: [1.0, 1.8, 1.4], cls: 'plastic'},
  kegerator: {asset: 'kegerator', box: [0.65, 0.7, 1.4], cls: 'steel', audit: {cls: 'exception', how: 'kegerator door: kegs and taps only (no item), one fused mesh'}},
  cctvConsole: {asset: 'cctv-console', box: [2.0, 0.9, 2.0], blocksSight: true, cls: 'laminate', audit: {cls: 'exception', how: 'control desk drawers: fused into the console mesh (the control room gunLocker / cabinets are searchable)'}},
  metalDetector: {asset: 'metal-detector', box: [1.0, 0.7, 2.2], cls: 'plastic'},
  vaultSafe: {asset: 'vault-safe', box: [1.0, 0.85, 1.5], cls: 'steel', audit: {cls: 'exception', how: 'antique vault safe: combination dial, locked shut (the vault room openable safe is the searchable one)'}},
  archiveBoxes: {asset: 'archive-boxes', box: [0.9, 0.6, 1.3], cls: 'cardboard', audit: {cls: 'exception', how: 'archive box stack: lids hide paper records only (no item), one fused mesh'}},
  aquarium: {asset: 'aquarium', box: [1.5, 0.55, 1.5], cls: 'glass', audit: {cls: 'exception', how: 'aquarium cabinet doors: fused into the cabinet mesh; murky water, no items'}},
  catTree: {asset: 'cat-tree', box: [0.7, 0.7, 1.8], cls: 'fabric'},
  doughMixer: {asset: 'dough-mixer', box: [0.8, 0.9, 1.5], cls: 'steel'},
  bakeryCase: {asset: 'bakery-case', box: [1.6, 0.8, 1.25], cls: 'glass', audit: {cls: 'exception', how: 'bakery case sliding back: stale pastries only (not food items), one fused mesh'}},
  satelliteModel: {asset: 'satellite-model', box: [1.8, 0.9, 1.4], cls: 'steel'},
  telescope: {asset: 'telescope', box: [0.9, 1.2, 1.8], cls: 'steel'},
  // --- E01-E17: supporting models (executive, server, lobby, leisure, small plant, roof) -----------------------------------------
  executiveDesk: {asset: 'executive-desk', box: [2.0, 1.0, 0.78], cls: 'wood', audit: {cls: 'exception', how: 'executive desk drawers: fused into the desk mesh (the suite credenza cabinetLow / safe are searchable)'}},
  executiveChair: {asset: 'executive-chair', box: [0.7, 0.75, 1.25], cls: 'fabric'},
  chesterfieldSofa: {asset: 'chesterfield-sofa', box: [2.1, 0.9, 0.8], cls: 'fabric'},
  globeBar: {asset: 'globe-bar', box: [0.65, 0.65, 1.0], cls: 'wood', audit: {cls: 'exception', how: 'globe bar lid: modelled open, decanters fused into the mesh (no items)'}},
  serverCabinet: {asset: 'server-cabinet', box: [0.6, 1.05, 2.0], cls: 'sheetMetal', audit: {cls: 'exception', how: 'server cabinet glass door: keyed, equipment only, one fused mesh'}},
  cracUnit: {asset: 'crac-unit', box: [1.7, 0.85, 1.9], blocksSight: true, cls: 'sheetMetal', audit: {cls: 'exception', how: 'CRAC unit service panels: machinery, locked, one fused mesh'}},
  lobbySofa: {asset: 'lobby-sofa', box: [2.2, 0.9, 0.8], cls: 'fabric'},
  planterTree: {asset: 'planter-tree', box: [0.9, 0.9, 2.2], cls: 'concrete'},
  securityTurnstile: {asset: 'security-turnstile', box: [0.32, 1.4, 1.0], cls: 'steel'},
  foosballTable: {asset: 'foosball-table', box: [1.4, 0.75, 0.9], cls: 'wood'},
  pingPongTable: {asset: 'ping-pong-table', box: [2.74, 1.525, 0.76], cls: 'wood'},
  beanBag: {asset: 'bean-bag', box: [0.9, 0.9, 0.7], cls: 'fabric'},
  loungeArmchair: {asset: 'lounge-armchair', box: [0.75, 0.8, 0.85], cls: 'fabric'},
  pottedPlantSmall: {asset: 'potted-plant-small', box: [0.42, 0.42, 0.6], cls: 'porcelain'},
  roofHvac: {asset: 'rooftop-hvac', box: [2.4, 1.4, 1.4], blocksSight: true, cls: 'sheetMetal', audit: {cls: 'exception', how: 'rooftop HVAC service panels: machinery, screwed shut, one fused mesh'}},
  waterTower: {asset: 'water-tower', box: [3.2, 3.2, 4.5], blocksSight: true, cls: 'wood'},
  satelliteDish: {asset: 'satellite-dish', box: [1.8, 1.2, 1.8], cls: 'steel'},
  // --- geometry only ------------------------------------------------------------------------------------------------------------
  /** Free-standing reception logo wall (the company name / tagline plates are mounted on its +Z face). */
  logoWall: {asset: null, box: [4.0, 0.3, 2.6], blocksSight: true, cls: 'plaster'},
} as const satisfies Record<string, KindSpec>;

export type CompanyKind = keyof typeof SPECS;
export const COMPANY_KINDS = Object.keys(SPECS) as CompanyKind[];
export function isCompanyKind(kind: string): kind is CompanyKind {
  return kind in SPECS;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/**
 * E16 water tower: the delivered model is the ~4.6 m tank WITHOUT a stand, so the kind adds a low steel stand (dunnage frame) of
 * this height under it (world/officeProps.ts builds the legs and lifts the model; the footprint height includes the stand). Kept
 * under lane STRUCT's roof band (deck + 6 m): 4.5 + 1.2 = 5.7 m.
 */
export const WATER_TOWER_STAND = 1.2;
/** D30 kegerator: a texture artefact (a portrait) on the model file's -X side panel = the prop frame's +X side after the -Z -> +Z
 *  turn: that side always stands against a wall (gen/office/companyDress.ts corner placement). */
export const SIDE_TO_WALL: ReadonlySet<string> = new Set(['kegerator']);
/** D27 ship model / D35 aquarium came without their cabinets: they stand on a cabinetLow sideboard (host decor on its top). */
export const ON_SIDEBOARD: ReadonlySet<string> = new Set(['shipModel', 'aquarium']);
/** Footprint of a kind: the delivered model's measured bounds, else its nominal box. */
function defOf(k: CompanyKind): PropDef {
  const s: KindSpec = SPECS[k];
  const dims = s.asset ? COMPANY_DIMS[s.asset] : null;
  const [w, d, h] = dims ? [dims[0], dims[2], dims[1]] : s.box;
  return {w: r3(w), d: r3(d), h: r3(h + (k === 'waterTower' ? WATER_TOWER_STAND : 0)), blocksSight: s.blocksSight ?? false};
}
export const COMPANY_PROP_DEFS = Object.fromEntries(COMPANY_KINDS.map(k => [k, defOf(k)])) as Record<CompanyKind, PropDef>;

/** Asset id (assets/companyAssets.ts) a kind renders with (lazy library key `office-<id>`, kinds.ts officeModelKey). */
export const COMPANY_KIND_ASSET: Readonly<Partial<Record<CompanyKind, string>>> = Object.fromEntries(
  COMPANY_KINDS.flatMap(k => { const a: string | null = SPECS[k].asset; return a ? [[k, a]] : []; }));

/** Damage specs (spread into kinds.ts OFFICE_PROP_DAMAGE -> damage/materials.ts PROP_DAMAGE): furniture never breaks. */
export const COMPANY_PROP_DAMAGE = Object.fromEntries(COMPANY_KINDS.map(k => [k, {cls: SPECS[k].cls as DamageClass, integrity: Infinity, breaks: 'never' as const}])) as
  Record<CompanyKind, {cls: DamageClass; integrity: number; breaks: 'never'}>;

/** Openables audit rows (world/openablesSpec.ts OPENABLE_AUDIT spreads these). */
export const COMPANY_KIND_AUDIT: readonly {kind: string; cls: AuditCls; how: string}[] = COMPANY_KINDS.map(k => {
  const a: KindSpec['audit'] = (SPECS[k] as KindSpec).audit;
  return a ? {kind: k, ...a} : {kind: k, cls: 'none' as const, how: 'no door, lid or drawer (company / office furniture, decor or equipment)'};
});

// ---------------------------------------------------------------------------------------------
// Procedural stand-ins (box parts; used until / unless the model is loaded)

const box = (m: ShapeMat, s: [number, number, number], p: [number, number, number]): ShapePart => ({m, s, p});

/** Box forms of a company kind in the prop frame (origin bottom centre, front +Z), fitted to its footprint. */
export function companyShape(kind: CompanyKind): ShapePart[] {
  const {w, d, h} = COMPANY_PROP_DEFS[kind];
  const leg = (m: ShapeMat, x: number, z: number, hh: number, t = 0.05) => box(m, [t, hh, t], [x, hh / 2, z]);
  switch (kind) {
    case 'gumballMachine': return [box('accent', [w * 0.5, h * 0.5, d * 0.5], [0, h * 0.25, 0]), box('glass', [w * 0.9, h * 0.38, d * 0.9], [0, h * 0.69, 0]), box('steelBright', [w * 0.5, h * 0.08, d * 0.5], [0, h * 0.94, 0])];
    case 'gumballJar': return [box('glass', [w, h * 0.85, d], [0, h * 0.425, 0]), box('accent', [w * 0.8, h * 0.15, d * 0.8], [0, h * 0.925, 0])];
    case 'arcadeCabinet': return [box('black', [w, h, d * 0.8], [0, h / 2, -d * 0.1]), box('screen', [w * 0.8, h * 0.28, 0.02], [0, h * 0.68, d * 0.31]), box('accent', [w, h * 0.06, d * 0.4], [0, h * 0.5, d * 0.25])];
    case 'consoleStation': return [box('black', [w, 0.5, d], [0, 0.25, 0]), box('screen', [w * 0.85, h - 0.55, 0.05], [0, 0.55 + (h - 0.55) / 2, -d * 0.2])];
    case 'lawBookcase': return [box('wood', [w, h, d], [0, h / 2, 0]), ...[0.35, 0.8, 1.25, 1.7].map(y => box('accent', [w * 0.9, 0.3, 0.02], [0, y * h / 2.2, d / 2 + 0.01]))];
    case 'justiceStatue': return [box('black', [w, h * 0.3, d], [0, h * 0.15, 0]), box('steelDark', [w * 0.35, h * 0.6, d * 0.35], [0, h * 0.6, 0]), box('steelDark', [w * 0.8, 0.04, 0.06], [0, h * 0.85, 0])];
    case 'tradingDesk': return [box('woodVeneer', [w, 0.05, d], [0, 0.74, 0]), leg('steelDark', -w / 2 + 0.05, 0, 0.72), leg('steelDark', w / 2 - 0.05, 0, 0.72),
      ...[-0.6, 0, 0.6].map(x => box('screen', [w * 0.3, 0.32, 0.03], [x * w / 1.8, 1.05, -d * 0.25]))];
    case 'bullStatue': return [box('concrete', [w, 0.15, d], [0, 0.075, 0]), box('steelDark', [w * 0.75, h * 0.5, d * 0.6], [0, 0.15 + h * 0.3, 0]), box('steelDark', [w * 0.2, h * 0.3, d * 0.5], [w * 0.4, h * 0.75, 0])];
    case 'labBench': return [box('panel', [w, 0.85, d], [0, 0.425, 0]), box('black', [w, 0.04, d], [0, 0.87, 0]), box('glass', [0.15, 0.3, 0.15], [-w * 0.2, 1.04, 0]), box('steelDark', [0.2, 0.35, 0.25], [w * 0.25, 1.06, -d * 0.1])];
    case 'biohazardFridge': return [box('steelBright', [w, h, d], [0, h / 2, 0]), box('glass', [w * 0.8, h * 0.75, 0.02], [0, h * 0.52, d / 2 + 0.01]), box('accent', [w * 0.3, 0.12, 0.01], [0, h * 0.93, d / 2 + 0.015])];
    case 'architectModel': return [box('wood', [w, 0.8, d], [0, 0.4, 0]), box('counter', [w * 0.2, 0.25, d * 0.2], [-w * 0.2, 0.92, 0]), box('counter', [w * 0.15, 0.3, d * 0.25], [w * 0.15, 0.95, d * 0.1]), box('counter', [w * 0.1, h - 0.8, d * 0.15], [0, 0.8 + (h - 0.8) / 2, -d * 0.2])];
    case 'draftingTable': return [box('wood', [w, 0.04, d * 0.8], [0, 0.95, 0], ), leg('steelDark', -w / 2 + 0.06, 0, 0.93), leg('steelDark', w / 2 - 0.06, 0, 0.93), box('steelDark', [0.36, 0.6, 0.36], [0, 0.3, d * 0.35])].map((p, i) => (i === 0 ? {...p, rx: -0.35} : p));
    case 'tvCamera': return [box('steelDark', [w * 0.7, 0.2, d * 0.7], [0, 0.1, 0]), box('steelDark', [0.12, h * 0.5, 0.12], [0, h * 0.35, 0]), box('black', [w * 0.45, h * 0.25, d * 0.7], [0, h * 0.75, 0])];
    case 'newsDesk': return [box('accent', [w, h - 0.05, 0.08], [0, (h - 0.05) / 2, d / 2 - 0.04]), box('counter', [w, 0.05, d], [0, h - 0.025, 0]), box('panel', [0.06, h - 0.05, d], [-w / 2 + 0.03, (h - 0.05) / 2, 0]), box('panel', [0.06, h - 0.05, d], [w / 2 - 0.03, (h - 0.05) / 2, 0])];
    case 'espressoMachine': return [box('wood', [w, 0.9, d], [0, 0.45, 0]), box('steelBright', [w * 0.7, 0.45, d * 0.6], [0, 1.125, -d * 0.1])];
    case 'coffeeRoaster': return [box('black', [w * 0.7, h * 0.5, d * 0.6], [0, h * 0.25, -d * 0.1]), box('steelDark', [w * 0.5, h * 0.35, d * 0.4], [0, h * 0.65, -d * 0.1]), box('accent', [w * 0.6, 0.15, d * 0.4], [0, h * 0.35, d * 0.3])];
    case 'treadmill': return [box('black', [w * 0.8, 0.18, d * 0.9], [0, 0.09, d * 0.05]), box('steelDark', [0.05, h - 0.2, 0.05], [-w * 0.42, 0.2 + (h - 0.2) / 2, -d * 0.4]), box('steelDark', [0.05, h - 0.2, 0.05], [w * 0.42, 0.2 + (h - 0.2) / 2, -d * 0.4]), box('screen', [w * 0.7, 0.25, 0.1], [0, h - 0.12, -d * 0.42])];
    case 'sneakerWall': return [box('black', [w, h, d * 0.4], [0, h / 2, -d * 0.3]), ...[0.4, 0.8, 1.2, 1.6].map(y => box('accent', [w * 0.9, 0.1, d * 0.6], [0, y * h / 2, d * 0.1]))];
    case 'giantTeddy': return [box('wood', [w * 0.8, h * 0.5, d * 0.7], [0, h * 0.25, 0]), box('wood', [w * 0.55, h * 0.4, d * 0.5], [0, h * 0.7, 0]), box('accent', [w * 0.3, 0.08, 0.06], [0, h * 0.52, d * 0.3])];
    case 'rockingHorse': return [box('wood', [w * 0.9, 0.06, d], [0, 0.03, 0]), box('counter', [w * 0.6, h * 0.35, d * 0.55], [0, h * 0.5, 0]), box('counter', [w * 0.4, h * 0.35, d * 0.2], [0, h * 0.8, d * 0.35]), box('accent', [w * 0.62, 0.06, d * 0.25], [0, h * 0.7, 0])];
    case 'jukebox': return [box('accent', [w, h * 0.8, d], [0, h * 0.4, 0]), box('glass', [w * 0.9, h * 0.2, d * 0.8], [0, h * 0.9, 0]), box('steelBright', [w * 0.7, h * 0.3, 0.02], [0, h * 0.55, d / 2 + 0.01])];
    case 'mixingConsole': return [box('laminate', [w, 0.75, d * 0.7], [0, 0.375, -d * 0.1]), box('black', [w, 0.12, d], [0, 0.8, 0], ), box('black', [0.3, 0.45, 0.3], [-w * 0.35, 1.08, -d * 0.3]), box('black', [0.3, 0.45, 0.3], [w * 0.35, 1.08, -d * 0.3])].map((p, i) => (i === 1 ? {...p, rx: -0.2} : p));
    case 'examTable': return [box('steelBright', [w * 0.95, h * 0.7, d * 0.8], [0, h * 0.35, 0]), box('partition', [w, h * 0.12, d], [0, h * 0.82, 0]), box('counter', [w * 0.2, 0.1, d * 0.9], [-w * 0.38, h * 0.93, 0])];
    case 'vitalsMonitor': return [box('steelDark', [w, 0.1, d], [0, 0.05, 0]), box('steelBright', [0.05, h * 0.75, 0.05], [0, h * 0.4, 0]), box('panel', [w * 0.6, 0.3, 0.12], [0, h * 0.82, 0.04]), box('screen', [w * 0.5, 0.22, 0.01], [0, h * 0.82, 0.105])];
    case 'dressForm': return [box('wood', [w * 0.7, 0.05, d * 0.7], [0, 0.03, 0]), box('wood', [0.04, h * 0.45, 0.04], [0, h * 0.25, 0]), box('accent', [w * 0.55, h * 0.45, d * 0.4], [0, h * 0.7, 0])];
    case 'clothingRack': return [box('steelBright', [w, 0.04, 0.04], [0, h - 0.02, 0]), leg('steelBright', -w / 2 + 0.03, 0, h, 0.04), leg('steelBright', w / 2 - 0.03, 0, h, 0.04), box('accent', [w * 0.85, h * 0.55, d * 0.7], [0, h * 0.6, 0])];
    case 'shipModel': return [box('wood', [w, 0.85, d], [0, 0.425, 0]), box('glass', [w, h - 0.85, d], [0, 0.85 + (h - 0.85) / 2, 0]), box('accent', [w * 0.8, 0.18, d * 0.25], [0, 0.98, 0])];
    case 'parcelPallet': return [box('wood', [w, 0.14, d], [0, 0.07, 0]), box('counter', [w * 0.95, h - 0.14, d * 0.95], [0, 0.14 + (h - 0.14) / 2, 0])];
    case 'napPod': return [box('counter', [w, 0.45, d], [0, 0.225, 0]), box('partition', [w * 0.9, 0.2, d * 0.8], [0, 0.55, d * 0.05]), box('counter', [w, h - 0.45, d * 0.45], [0, 0.45 + (h - 0.45) / 2, -d * 0.27])];
    case 'kegerator': return [box('steelBright', [w, h * 0.75, d], [0, h * 0.375, 0]), box('steelBright', [0.05, h * 0.25, 0.05], [0, h * 0.875, 0]), box('black', [w * 0.6, 0.04, d * 0.3], [0, h * 0.77, d * 0.3])];
    case 'cctvConsole': return [box('laminate', [w, 0.76, d * 0.6], [0, 0.38, d * 0.2]), box('black', [w, h - 0.76, 0.12], [0, 0.76 + (h - 0.76) / 2, -d * 0.4]),
      ...[-0.36, 0, 0.36].map(x => box('screen', [w * 0.3, (h - 0.76) * 0.4, 0.01], [x * w, 0.76 + (h - 0.76) * 0.5, -d * 0.33]))];
    case 'metalDetector': return [box('panel', [0.12, h, d], [-w / 2 + 0.06, h / 2, 0]), box('panel', [0.12, h, d], [w / 2 - 0.06, h / 2, 0]), box('panel', [w, 0.15, d], [0, h - 0.075, 0])];
    case 'vaultSafe': return [box('accent', [w, h * 0.95, d], [0, h * 0.5, 0]), box('steelBright', [0.18, 0.18, 0.04], [0, h * 0.6, d / 2 + 0.02]), box('black', [w * 0.9, h * 0.05, d * 0.9], [0, h * 0.025, 0])];
    case 'archiveBoxes': return [box('counter', [w, h * 0.5, d], [0, h * 0.25, 0]), box('counter', [w * 0.85, h * 0.32, d * 0.9], [-w * 0.05, h * 0.66, 0]), box('counter', [w * 0.5, h * 0.18, d * 0.6], [w * 0.15, h * 0.91, 0])];
    case 'aquarium': return [box('black', [w, h * 0.5, d], [0, h * 0.25, 0]), box('glass', [w, h * 0.45, d], [0, h * 0.725, 0]), box('accent', [w * 0.95, h * 0.3, d * 0.9], [0, h * 0.65, 0])];
    case 'catTree': return [box('partition', [w, 0.08, d], [0, 0.04, 0]), box('wood', [0.14, h, 0.14], [0, h / 2, 0]), box('partition', [w * 0.7, 0.06, d * 0.7], [w * 0.1, h * 0.45, 0]), box('partition', [w * 0.6, 0.25, d * 0.6], [-w * 0.1, h - 0.125, 0])];
    case 'doughMixer': return [box('kitchenSteel', [w * 0.8, h * 0.45, d * 0.7], [0, h * 0.225, -d * 0.1]), box('kitchenSteel', [w * 0.3, h * 0.55, d * 0.3], [0, h * 0.725, -d * 0.3]), box('steelBright', [w * 0.6, h * 0.22, d * 0.55], [0, h * 0.55, d * 0.15])];
    case 'bakeryCase': return [box('counter', [w, 0.85, d], [0, 0.425, 0]), box('glass', [w, h - 0.85, d * 0.9], [0, 0.85 + (h - 0.85) / 2, 0]), box('accent', [w * 0.85, 0.12, d * 0.6], [0, 0.95, 0])];
    case 'satelliteModel': return [box('black', [0.4, 0.8, 0.4], [0, 0.4, 0]), box('accent', [w * 0.25, h * 0.3, d * 0.5], [0, 0.8 + h * 0.15, 0]), box('screen', [w, 0.02, d * 0.45], [0, 0.8 + h * 0.15, 0])];
    case 'telescope': return [leg('black', -w * 0.3, -d * 0.2, h * 0.6, 0.06), leg('black', w * 0.3, -d * 0.2, h * 0.6, 0.06), leg('black', 0, d * 0.3, h * 0.6, 0.06), box('counter', [0.22, 0.22, d], [0, h * 0.75, 0], )].map((p, i) => (i === 3 ? {...p, rx: 0.6} : p));
    case 'executiveDesk': return [box('wood', [w, 0.06, d], [0, h - 0.03, 0]), box('wood', [w * 0.32, h - 0.06, d * 0.9], [-w * 0.34, (h - 0.06) / 2, 0]), box('wood', [w * 0.32, h - 0.06, d * 0.9], [w * 0.34, (h - 0.06) / 2, 0]), box('wood', [w * 0.36, h * 0.6, 0.04], [0, h * 0.5, -d * 0.43])];
    case 'executiveChair': return [box('black', [w * 0.8, 0.06, d * 0.8], [0, 0.03, 0]), box('steelDark', [0.06, 0.38, 0.06], [0, 0.25, 0]), box('wood', [w * 0.75, 0.12, d * 0.7], [0, 0.5, 0.02]), box('wood', [w * 0.72, h - 0.55, 0.12], [0, 0.55 + (h - 0.55) / 2, -d * 0.36])];
    case 'chesterfieldSofa': return [box('accent', [w, h * 0.5, d], [0, h * 0.25, 0]), box('accent', [w, h * 0.5, d * 0.22], [0, h * 0.75, -d * 0.39]), box('accent', [d * 0.22, h * 0.32, d], [-w / 2 + d * 0.11, h * 0.66, 0]), box('accent', [d * 0.22, h * 0.32, d], [w / 2 - d * 0.11, h * 0.66, 0])];
    case 'globeBar': return [box('wood', [w * 0.8, h * 0.45, d * 0.8], [0, h * 0.225, 0]), box('counter', [w, h * 0.55, d], [0, h * 0.725, 0])];
    case 'serverCabinet': return [box('black', [w, h, d], [0, h / 2, 0]), box('glass', [w * 0.9, h * 0.9, 0.01], [0, h / 2, d / 2 + 0.006]), box('screen', [w * 0.7, h * 0.7, 0.005], [0, h / 2, d / 2 - 0.02])];
    case 'cracUnit': return [box('counter', [w, h, d], [0, h / 2, 0]), box('grille', [w * 0.85, h * 0.35, 0.01], [0, h * 0.75, d / 2 + 0.006]), box('screen', [0.2, 0.14, 0.01], [w * 0.3, h * 0.45, d / 2 + 0.006])];
    case 'lobbySofa': return [box('partition', [w, 0.42, d], [0, 0.21, 0]), box('partition', [w, h - 0.42, d * 0.22], [0, 0.42 + (h - 0.42) / 2, -d * 0.39]), box('steelDark', [w * 0.95, 0.08, d * 0.9], [0, 0.04, 0])];
    case 'planterTree': return [box('concrete', [w, 0.55, d], [0, 0.275, 0]), box('wood', [0.08, h * 0.45, 0.08], [0, 0.55 + h * 0.22, 0]), box('black', [w * 0.85, h * 0.4, d * 0.85], [0, h * 0.75, 0])];
    case 'securityTurnstile': return [box('steelBright', [w, h, d], [0, h / 2, 0]), box('glass', [0.6, h * 0.55, 0.02], [w / 2 + 0.3, h * 0.6, 0])];
    case 'foosballTable': return [box('wood', [w, 0.3, d], [0, h - 0.15, 0]), leg('wood', -w / 2 + 0.08, -d / 2 + 0.08, h - 0.3, 0.08), leg('wood', w / 2 - 0.08, -d / 2 + 0.08, h - 0.3, 0.08),
      leg('wood', -w / 2 + 0.08, d / 2 - 0.08, h - 0.3, 0.08), leg('wood', w / 2 - 0.08, d / 2 - 0.08, h - 0.3, 0.08), box('steelBright', [0.02, 0.02, d + 0.3], [0, h - 0.05, 0])];
    case 'pingPongTable': return [box('accent', [w, 0.04, d], [0, h - 0.02, 0]), box('black', [0.02, 0.15, d + 0.1], [0, h + 0.05, 0]), leg('steelDark', -w * 0.35, 0, h - 0.04, 0.06), leg('steelDark', w * 0.35, 0, h - 0.04, 0.06)];
    case 'beanBag': return [box('accent', [w, h * 0.6, d], [0, h * 0.3, 0]), box('accent', [w * 0.8, h * 0.4, d * 0.4], [0, h * 0.8, -d * 0.25])];
    case 'loungeArmchair': return [box('wood', [w, 0.3, d], [0, 0.15, 0]), box('partition', [w * 0.85, 0.12, d * 0.8], [0, 0.36, 0.03]), box('partition', [w * 0.85, h - 0.4, 0.12], [0, 0.4 + (h - 0.4) / 2, -d * 0.4])];
    case 'pottedPlantSmall': return [box('porcelain', [w * 0.7, h * 0.4, d * 0.7], [0, h * 0.2, 0]), box('black', [w, h * 0.55, d], [0, h * 0.68, 0])];
    case 'roofHvac': return [box('steelBright', [w, h * 0.85, d], [0, h * 0.425, 0]), box('grille', [w * 0.35, 0.05, d * 0.7], [-w * 0.22, h * 0.87, 0]), box('grille', [w * 0.35, 0.05, d * 0.7], [w * 0.22, h * 0.87, 0])];
    case 'waterTower': {
      // Tank over the steel stand (waterTowerStand: the same legs the model sits on).
      const S = WATER_TOWER_STAND, t = h - S;
      return [...waterTowerStand(w, d), box('wood', [w * 0.9, t * 0.75, d * 0.9], [0, S + t * 0.375, 0]), box('wood', [w * 0.6, t * 0.25, d * 0.6], [0, S + t * 0.875, 0])];
    }
    case 'satelliteDish': return [box('steelDark', [0.5, 0.6, 0.5], [0, 0.3, 0]), box('counter', [w, h * 0.7, 0.08], [0, h * 0.6, 0.1])].map((p, i) => (i === 1 ? {...p, rx: -0.5} : p));
    case 'logoWall': return [box('woodVeneer', [w, h, d], [0, h / 2, 0]), box('steelDark', [w + 0.04, 0.06, d + 0.04], [0, 0.03, 0])];
  }
}

/** The water tower's steel stand (prop frame, from the deck up to WATER_TOWER_STAND): four legs, a ring beam, cross braces. */
export function waterTowerStand(w: number, d: number): ShapePart[] {
  const S = WATER_TOWER_STAND, lx = w * 0.36, lz = d * 0.36;
  const out: ShapePart[] = [];
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) out.push(box('steelDark', [0.16, S, 0.16], [x, S / 2, z]));
  out.push(box('steelDark', [2 * lx + 0.16, 0.14, 0.14], [0, S - 0.07, -lz]), box('steelDark', [2 * lx + 0.16, 0.14, 0.14], [0, S - 0.07, lz]));
  out.push(box('steelDark', [0.14, 0.14, 2 * lz + 0.16], [-lx, S - 0.07, 0]), box('steelDark', [0.14, 0.14, 2 * lz + 0.16], [lx, S - 0.07, 0]));
  out.push(box('steelDark', [2 * lx, 0.08, 0.08], [0, S * 0.45, -lz]), box('steelDark', [2 * lx, 0.08, 0.08], [0, S * 0.45, lz]));
  return out;
}

