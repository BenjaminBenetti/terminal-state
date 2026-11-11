// Footprints for generated props, in meters. Local frame: front faces +Z, X is width.
// Mesh derivatives are scaled to match these provisional dimensions at build time.

import {P7_PROP_DEFS, type P7Kind} from './props07';
import {OFFICE_PROP_DEFS, type OfficeKind} from './office/kinds'; // Iteration 16 (WORLD-GEN)
import {BUNKER_PROP_DEFS, type BunkerKind} from './reactor/complex/bunkerKinds'; // task reactor-expansion-20261101 (lane BUNKER)
import {SKYWAYS_KITCHEN_PROP_DEFS, type SkywaysKitchenKind} from './skyways/kitchenKinds'; // task studio-skyways-level-20261106-054448 (lane FOOD)
import {SKYWAYS_ADDON_PROP_DEFS, type SkywaysAddonKind} from './skyways/addonKinds'; // task studio-skyways-level-20261106-054448 (lane ADDON)
import {SKYWAYS_DEST_PROP_DEFS, type SkywaysDestKind} from './skyways/destinations/registry'; // task studio-skyways-destinations-20261106-170011-01
import {SKYWAYS_MAPBOARD_PROP_DEFS, type SkywaysMapBoardKind} from './skyways/mapBoardKind'; // task studio-skyways-rework-20261107-054512-01 (lane MAPS)
import {SUBWAY_MAP_KIOSK_PROP_DEFS, type SubwayMapKioskKind} from './subwayMapKioskKind'; // task studio-ui-subway-maps-20261108-074144-01
import {BUNKER_MODEL_PROP_DEFS, BUNKER_OBJECTIVE_PROP_DEFS, type BunkerModelKind, type BunkerObjectiveKind} from './bunker/bunkerKinds'; // task studio-bunker-level-20261109-072224-01

export type PropKind =
  | 'bench' | 'cabinetTall' | 'cabinetLow' | 'column' | 'crate' | 'bin' | 'fareGate'
  // Iteration 03: generated-asset props (models optional; procedural stand-ins until present).
  | 'stall' | 'vending' | 'shelf'
  // Iteration 03: primitive forms, always procedural (asset-method rule).
  | 'table' | 'desk' | 'booth' | 'ticketMachine' | 'exitStair' | 'toiletStall' | 'washCounter'
  // Iteration 04: storefront building blocks (gen/storefronts.ts). Holders: counter, display case,
  // back counter, drinks cooler (generated models optional, procedural blocks otherwise).
  | 'shopCounter' | 'shopDisplay' | 'shopBackbar' | 'shopCooler'
  // Collision-only storefront parts (rendered by the storefront builder): shopfront glazing and a
  // rolled-down shutter across an opening. Their hx/hz/h are per placement.
  | 'shopGlazing' | 'shopShutter'
  // Task track2-playtest-revision (lane ROOMS): collision-only box of a service annex's anchored MACHINERY (gen/annexRooms.ts
  // machineBoxes; drawn by world/trackExt/machines.ts from layout.extensions.machines). hx/hz/h per placement; variant = MachineKind index.
  | 'annexMachine'
  // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the survivor hideout's small LOOSE camp things (gen/propShapes.ts box
  // parts, instanced per kind like the procedural furniture): a camping lantern and a camp stove — light dynamic props (on the floor or
  // on the hideout's camp table, `onHost`).
  | 'campLantern' | 'campStove'
  // Iteration 05 (Lane R): room/store PURPOSE props (gen/purposes.ts registry). Rendered by
  // world/storefrontBuilder.ts: Lane A generated models when present (PURPOSE_MODEL_KEYS), authored
  // textured parts (gen/purposeShapes.ts) otherwise. Holders among them have PURPOSE_SURFACES.
  | PurposePropKind
  // Iteration 07 (Lane P2): NEW generated prop types (gen/props07.ts; lazy-loaded p7-*.glb models, measured footprints).
  | P7Kind
  // Iteration 16 (WORLD-GEN): office tower furniture (gen/office/kinds.ts; Meshy office models, procedural fallbacks).
  | OfficeKind
  // task reactor-expansion-20261101 (lane BUNKER): the Reactor bunker's hero props (REACTOR_X_KIT models; gen/reactor/complex/bunkerKinds.ts).
  | BunkerKind
  // task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's range / cookware / sushi mascot (gen/skyways/kitchenKinds.ts).
  | SkywaysKitchenKind
  // task studio-skyways-level-20261106-054448 (lane ADDON): the Skyways add-on's convention / prize-car kinds (gen/skyways/addonKinds.ts).
  | SkywaysAddonKind
  // task studio-skyways-destinations-20261106-170011-01: the Skyways destination shop / landmark kinds (gen/skyways/destinations/registry.ts).
  | SkywaysDestKind
  | SkywaysMapBoardKind // task studio-skyways-rework-20261107-054512-01 (lane MAPS): the local directory board (gen/skyways/mapBoardKind.ts)
  | SubwayMapKioskKind // task studio-ui-subway-maps-20261108-074144-01: the Subway's station map kiosk (gen/subwayMapKioskKind.ts)
  | BunkerObjectiveKind // task studio-bunker-level-20261109-072224-01: the Bunker's generator slots + core cluster (gen/bunker/bunkerKinds.ts)
  | BunkerModelKind; // (follow-up) the Bunker's model-backed flavour kinds: mainframes, decon showers, control console, pumps, pipe bank

/** Purpose props (iteration 05). Holders: see PURPOSE_SURFACES; the rest are furniture/decor. */
export const PURPOSE_PROP_KINDS = [
  // Retail
  'stockShelf', 'snackRack', 'magazineRack', 'techDisplay', 'deviceWall', 'showcase', 'flowerStand', 'repairBench',
  // Food service
  'hotdogCart', 'grillLine', 'pizzaOven', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar', 'breadRack',
  // Back-of-house
  'staffLockers', 'kitchenette', 'fridge', 'couch', 'noticeBoard', 'janitorCart', 'mopSink', 'electricalPanel',
  'gunLocker', 'monitorDesk', 'medCabinet', 'safe', 'signalRack', 'cartonStack',
  // Task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a survivor's camp bed in an annex cache room (gen/annexCache.ts)
  'palletBed',
  // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the survivor hideout (gen/annexCache.ts) — a floor bedroll, a makeshift
  // camp table (a door on cinder blocks) and a wooden footlocker (an openable holder: world/openablesSpec.ts authored lid)
  'bedroll', 'campTable', 'footlocker',
] as const;
export type PurposePropKind = (typeof PURPOSE_PROP_KINDS)[number];
export function isPurposePropKind(kind: string): kind is PurposePropKind {
  return (PURPOSE_PROP_KINDS as readonly string[]).includes(kind);
}

export interface PropDef {
  w: number;
  d: number;
  h: number;
  blocksSight: boolean;
  /**
   * Rigid-body flags read first by damage/materials.ts propPhysics (iteration 07 generated props). Task studio-skyways-level-20261106-054448
   * (lane FOOD): + `onHost` / `contact` and the calibrated `castor` / `pad` contacts (damage/materials.ts PropPhysics / PHYS_MATS) for on-host
   * decor declared with its kind (gen/skyways/kitchenKinds.ts).
   */
  physics?: {mass: number; dynamic: boolean; shape?: 'box' | 'cylinder'; mat?: 'metal' | 'plastic' | 'soft' | 'heavy' | 'wood' | 'glass' | 'stone' | 'cloth' | 'flesh' | 'castor' | 'pad'; onHost?: boolean; contact?: boolean};
  /**
   * Task studio-skywalk-variety-20261107-231448-01 (lane MERCH): the OPEN support surfaces inside a non-holder host's box (prop frame:
   * origin bottom centre, front +Z; like a loot holder's surfaces) — the shelves / tiers / bin floors its movable on-host decor stands on
   * (physics/merchOnHost.ts). Declared: that decor goes loose there when shot, and loose things rest on them (physics/world.ts). `[]` = it
   * HANGS its decor (hooks): knocked loose, it falls. Absent: no known open support (a closed counter well keeps its decor static).
   */
  shelves?: readonly {y: number; x0: number; x1: number; z0: number; z1: number; clear: number}[];
}

export const PROP_DEFS: Record<PropKind, PropDef> = {
  // Matches the bounds of the runtime derivatives (public/assets/derivatives/props.json).
  bench: {w: 1.8, d: 0.506, h: 0.769, blocksSight: false},
  cabinetTall: {w: 1.083, d: 0.583, h: 1.9, blocksSight: true},
  cabinetLow: {w: 1.87, d: 0.791, h: 0.85, blocksSight: false},
  column: {w: 0.5, d: 0.5, h: 4.4, blocksSight: true},
  crate: {w: 0.62, d: 0.44, h: 0.432, blocksSight: false},
  /** Trash can (models.trashCan when present, else a procedural can; Lane A measured 0.55 x 0.95 m). */
  bin: {w: 0.55, d: 0.55, h: 0.95, blocksSight: false},
  // Turnstile CABINET only (arms are visual and reach 0.6 m toward -X into the passable gap).
  fareGate: {w: 0.32, d: 0.98, h: 1.02, blocksSight: false},
  // Provisional runtime dims from lane-contracts.md (primary reconciles with Lane A's measured models).
  /** Freestanding newsstand kiosk (iteration 03 prefab; now only an occasional island kiosk). */
  stall: {w: 2.4, d: 1.2, h: 2.4, blocksSight: true},
  vending: {w: 0.95, d: 0.85, h: 1.85, blocksSight: true},
  /** Open steel shelving unit (see-through). */
  shelf: {w: 1.2, d: 0.45, h: 1.85, blocksSight: false},
  /** Communal food-court table; stools tuck under it, so the whole footprint is the tabletop. */
  table: {w: 1.4, d: 1.6, h: 0.76, blocksSight: false},
  desk: {w: 1.5, d: 0.75, h: 0.76, blocksSight: false},
  /** Glazed station-agent booth beside the fare line. */
  booth: {w: 2.8, d: 2.2, h: 2.7, blocksSight: true},
  ticketMachine: {w: 0.8, d: 0.5, h: 1.75, blocksSight: false},
  /** Sealed street-exit stair: locked grille at the front (+Z), steps rising toward -Z. */
  exitStair: {w: 4.0, d: 6.0, h: 3.2, blocksSight: true},
  toiletStall: {w: 1.0, d: 1.6, h: 2.1, blocksSight: true},
  washCounter: {w: 2.4, d: 0.6, h: 0.9, blocksSight: false},
  /** Service counter module (front +Z faces the customer), joined into counter runs (Lane A shop-counter.glb dims). */
  shopCounter: {w: 1.5, d: 0.75, h: 1.05, blocksSight: false},
  /**
   * Counter module with a countertop food display/warmer on it (iteration 04: shop-counter.glb base +
   * shop-display.glb 1.10 x 0.70 x 0.62 sitting on the 1.041 m top). Loot sits on the display's top.
   */
  shopDisplay: {w: 1.5, d: 0.75, h: 1.745, blocksSight: false},
  /** Stainless back counter / kitchen line with an over-shelf (Lane A shop-backbar.glb dims). */
  shopBackbar: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  /** Glass-door drinks cooler (one door; Lane A shop-cooler.glb 0.75 x 2.0 x 0.75). */
  shopCooler: {w: 0.75, d: 0.75, h: 2.0, blocksSight: true},
  shopGlazing: {w: 1, d: 0.12, h: 2.7, blocksSight: false},
  shopShutter: {w: 1, d: 0.12, h: 2.7, blocksSight: true},
  /** (lane ROOMS) Annex machinery collision box: dimensions per placement (this is only the nominal default). */
  annexMachine: {w: 1, d: 1, h: 1, blocksSight: false},
  // --- Iteration 05 purpose props (authored dims; gen/purposeShapes.ts builds to these) ---
  /** Store shelving: the shelf unit with themed back stock (variant = STOCK_THEMES index); loot in front. */
  stockShelf: {w: 1.2, d: 0.45, h: 1.85, blocksSight: false},
  /** Impulse wire rack beside a till (3 tiers). */
  snackRack: {w: 0.6, d: 0.42, h: 1.35, blocksSight: false},
  /** Newsstand magazine rack (Lane A magazine-rack.glb measured 0.99 x 1.40 x 0.45). */
  magazineRack: {w: 0.99, d: 0.45, h: 1.4, blocksSight: false},
  /** Device table island (phones/tablets on stands). */
  techDisplay: {w: 1.6, d: 0.9, h: 0.92, blocksSight: false},
  /** Device wall unit: cabinet with phones on stands + hooked accessories + screen (Lane A tech-display.glb 1.10 x 2.00 x 0.58). */
  // (task studio-skywalk-variety-20261107-231448-01, lane MERCH: + its cabinet deck as a declared open shelf — the 0.849 m ray-cast deck of
  // the model, world/shelfStockCarcass.ts DEVICE_WALL_DECK — where Skyways version 4 stands its display devices as separate props)
  deviceWall: {w: 1.1, d: 0.58, h: 2.0, blocksSight: false, shelves: [{y: 0.849, x0: -0.53, x1: 0.53, z0: -0.22, z1: 0.27, clear: 0.4}]},
  /** Glass display counter (devices inside). */
  showcase: {w: 1.5, d: 0.6, h: 1.0, blocksSight: false},
  flowerStand: {w: 1.4, d: 0.7, h: 1.2, blocksSight: false},
  /** Back bench + pegboard: variant 0 key cutting / shoe repair, 1 phone repair. */
  repairBench: {w: 1.6, d: 0.6, h: 2.0, blocksSight: false},
  /** Hot-dog cart with canopy (Lane A model key hotdogCart when present). */
  hotdogCart: {w: 1.7, d: 0.85, h: 2.2, blocksSight: false},
  /** Kitchen lines (same footprint as shopBackbar; appliances left, free worktop right, over-shelf). */
  grillLine: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  pizzaOven: {w: 1.77, d: 0.95, h: 1.95, blocksSight: true},
  espressoBar: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  wokLine: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  deliLine: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  blenderBar: {w: 1.77, d: 0.7, h: 1.83, blocksSight: false},
  /** Wire rack of trays: variant 0 bread loaves, 1 donuts/pastry. */
  breadRack: {w: 1.2, d: 0.5, h: 1.8, blocksSight: false},
  staffLockers: {w: 1.2, d: 0.5, h: 1.9, blocksSight: true},
  /** Staff kitchenette: base units, sink, microwave, wall cupboards. */
  kitchenette: {w: 1.8, d: 0.62, h: 2.1, blocksSight: false},
  /** Fridge with its door hanging open (footprint includes the door swing). */
  fridge: {w: 0.8, d: 1.45, h: 1.8, blocksSight: true},
  couch: {w: 1.9, d: 0.85, h: 0.85, blocksSight: false},
  /** Wall-mounted cork board (placed at y = NOTICE_BOARD_Y). */
  noticeBoard: {w: 1.2, d: 0.05, h: 0.9, blocksSight: false},
  /** Janitorial cart with bag caddy + mop bucket (Lane A janitor-cart.glb 1.42 x 1.34 x 0.55). */
  janitorCart: {w: 1.42, d: 0.55, h: 1.34, blocksSight: false},
  mopSink: {w: 0.8, d: 0.6, h: 1.4, blocksSight: false},
  electricalPanel: {w: 1.2, d: 0.45, h: 2.1, blocksSight: true},
  /** Gun locker forced open (footprint includes both open doors). */
  gunLocker: {w: 1.0, d: 1.0, h: 1.9, blocksSight: true},
  /** Security desk with a CCTV monitor bank. */
  monitorDesk: {w: 1.6, d: 0.75, h: 1.3, blocksSight: false},
  /** Open first-aid cabinet (doors gone). */
  medCabinet: {w: 0.9, d: 0.4, h: 1.9, blocksSight: false},
  safe: {w: 0.7, d: 0.7, h: 1.0, blocksSight: false},
  signalRack: {w: 1.2, d: 0.6, h: 2.1, blocksSight: true},
  cartonStack: {w: 1.0, d: 0.8, h: 1.3, blocksSight: false},
  /**
   * Task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a survivor's camp bed — a foam mattress on two 1.0 x 0.8 m wooden
   * pallets, a sleeping bag and a pillow (bedding, like a couch's cushions: no loose takeable clutter), long side to a wall. Real
   * scale (scale-checked beside a runtime zombie): pallet deck 0.12 m, mattress top 0.26 m, pillow top 0.37 m.
   */
  palletBed: {w: 2.0, d: 0.84, h: 0.38, blocksSight: false},
  /**
   * Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the survivor hideout (gen/annexCache.ts), real scale (scale-checked beside
   * a runtime zombie, docs/prop-affordances.md): a floor BEDROLL (closed-cell foam mat + a lofted sleeping bag, a rolled-fleece pillow,
   * a folded blanket; 17 cm high), a makeshift CAMP TABLE (an old hollow-core door laid on two cinder-block piers, top 0.75 m: the
   * lantern / stove stand on it as separate loose props) and a wooden FOOTLOCKER (lid hinged at the back: an openable holder).
   */
  bedroll: {w: 1.95, d: 0.78, h: 0.17, blocksSight: false},
  campTable: {w: 1.3, d: 0.62, h: 0.75, blocksSight: false},
  footlocker: {w: 0.8, d: 0.42, h: 0.4, blocksSight: false},
  /** (lane HIDEOUT) a camping lantern (steel base, glass globe round a glowing mantle, cap, bail) and a one-burner camp stove on its gas canister. */
  campLantern: {w: 0.17, d: 0.17, h: 0.31, blocksSight: false},
  campStove: {w: 0.3, d: 0.27, h: 0.12, blocksSight: false},
  // --- Iteration 07 generated props (Lane P2): footprints = measured runtime model bounds (gen/props07.ts) ---
  ...P7_PROP_DEFS,
  // --- Iteration 16 (WORLD-GEN): office tower furniture (gen/office/kinds.ts) ---
  ...OFFICE_PROP_DEFS,
  // task reactor-expansion-20261101 (lane BUNKER): the Reactor bunker's hero props (real size, gen/reactor/complex/bunkerKinds.ts)
  ...BUNKER_PROP_DEFS,
  // task studio-skyways-level-20261106-054448 (lane FOOD): the ramen restaurant's range (collision to its cooktop), stock pot, saucepan, sushi mascot
  ...SKYWAYS_KITCHEN_PROP_DEFS,
  // task studio-skyways-level-20261106-054448 (lane ADDON): the convention stage / merch / boards / statues, the prize stanchions / board
  ...SKYWAYS_ADDON_PROP_DEFS,
  ...SKYWAYS_DEST_PROP_DEFS, // task studio-skyways-destinations-20261106-170011-01
  ...SKYWAYS_MAPBOARD_PROP_DEFS, // task studio-skyways-rework-20261107-054512-01 (lane MAPS)
  ...SUBWAY_MAP_KIOSK_PROP_DEFS, // task studio-ui-subway-maps-20261108-074144-01
  ...BUNKER_OBJECTIVE_PROP_DEFS, // task studio-bunker-level-20261109-072224-01
  ...BUNKER_MODEL_PROP_DEFS, // (follow-up) the model-backed flavour kinds
};

/**
 * Loot surfaces (heights above the prop's base, metres; local frame front = +Z), measured on the
 * generated derivatives: shelf deck tops, stall counter and the three back shelves. Meshy T2.5
 * replacement (2026-10-29, derivatives/meshy-t25-props-20261029.json): re-measured by vertical ray
 * casts on shelf-t25.glb (thin 4 mm decks: tops 0.078 / 0.615 / 1.186 / 1.764) and stall-t25.glb
 * (counter 0.923 over z 0.153..0.562; back shelves 0.994 / 1.304 / 1.585 over z -0.56..-0.40).
 * Iteration-03 values were [0.128, 0.625, 1.182, 1.739], 0.93, [1.026, 1.288, 1.539], [0.1, 0.56], [-0.55, -0.27].
 */
export const SHELF_TIER_Y: number[] = [0.078, 0.615, 1.186, 1.764];
export const STALL_COUNTER_Y = 0.923;
export const STALL_BACK_SHELF_Y: number[] = [0.994, 1.304, 1.585];
/** Local Z span [z0, z1] (from the unit's centre, front = +Z) of the stall counter top and of the back shelves. */
export const STALL_COUNTER_Z: [number, number] = [0.155, 0.56];
export const STALL_BACK_SHELF_Z: [number, number] = [-0.56, -0.4];

/** Base height of a wall-mounted notice board. */
export const NOTICE_BOARD_Y = 1.1;

/** Loot surface in a prop's local frame (front +Z, metres): items stand on `y` within [x0,x1]×[z0,z1]. */
export interface SurfaceSpec { y: number; x0: number; x1: number; z0: number; z1: number; clear: number }

/** Kitchen-line worktop height and the free worktop span (appliances stand left of it). */
export const KITCHEN_LINE = {top: 0.865, shelfY: 1.62, freeX: [0.3, 0.8] as [number, number], applianceX: [-0.86, 0.24] as [number, number]};
const lineSurfaces = (): SurfaceSpec[] => [
  {y: KITCHEN_LINE.top, x0: KITCHEN_LINE.freeX[0] + 0.02, x1: KITCHEN_LINE.freeX[1] - 0.02, z0: -0.25, z1: 0.25, clear: 0.5},
  {y: KITCHEN_LINE.shelfY, x0: -0.765, x1: 0.765, z0: -0.31, z1: -0.03, clear: 0.19},
];

/** Purpose props that are loot holders (keys of PURPOSE_SURFACES; tests check they agree). */
export const PURPOSE_HOLDER_KINDS = [
  'stockShelf', 'snackRack', 'hotdogCart', 'grillLine', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar',
  'kitchenette', 'fridge', 'gunLocker', 'monitorDesk', 'medCabinet',
] as const satisfies readonly PurposePropKind[];
export type PurposeHolderKind = (typeof PURPOSE_HOLDER_KINDS)[number];

/**
 * Loot surfaces of purpose HOLDERS (items/lootLayout.ts reads this; world/containers.ts makes
 * them loot holders). gen/purposeShapes.ts keeps these volumes free of decor. Stock shelves: the
 * themed stock fills the back of the lower three tiers, loot stands in front of it.
 */
export const PURPOSE_SURFACES: Record<PurposeHolderKind, SurfaceSpec[]> = {
  stockShelf: [
    ...[0, 1, 2].map(i => ({y: SHELF_TIER_Y[i], x0: -0.53, x1: 0.53, z0: -0.055, z1: 0.185, clear: SHELF_TIER_Y[i + 1] - SHELF_TIER_Y[i] - 0.03})),
    {y: SHELF_TIER_Y[3], x0: -0.53, x1: 0.53, z0: -0.185, z1: 0.185, clear: 0.08},
  ],
  snackRack: [0.25, 0.6, 0.95].map(y => ({y, x0: -0.26, x1: 0.26, z0: -0.17, z1: 0.17, clear: 0.32})),
  hotdogCart: [
    {y: 0.92, x0: 0.15, x1: 0.7, z0: -0.28, z1: 0.28, clear: 0.45},
    {y: 0.2, x0: -0.65, x1: 0.65, z0: -0.25, z1: 0.3, clear: 0.38},
  ],
  grillLine: lineSurfaces(), espressoBar: lineSurfaces(), wokLine: lineSurfaces(), deliLine: lineSurfaces(), blenderBar: lineSurfaces(),
  kitchenette: [{y: 0.92, x0: 0.36, x1: 0.86, z0: -0.25, z1: 0.26, clear: 0.5}],
  fridge: [0.3, 0.72, 1.1, 1.45].map((y, i, a) => ({y, x0: -0.31, x1: 0.31, z0: -0.66, z1: -0.08, clear: (a[i + 1] ?? 1.72) - y - 0.03})),
  gunLocker: [0.1, 0.75, 1.3].map((y, i, a) => ({y, x0: -0.43, x1: 0.43, z0: -0.45, z1: -0.04, clear: (a[i + 1] ?? 1.82) - y - 0.04})),
  monitorDesk: [{y: 0.76, x0: -0.7, x1: 0.7, z0: 0.0, z1: 0.3, clear: 0.5}],
  medCabinet: [0.12, 0.55, 0.98, 1.41].map((y, i, a) => ({y, x0: -0.4, x1: 0.4, z0: -0.16, z1: 0.17, clear: (a[i + 1] ?? 1.82) - y - 0.03})),
};

/** Lane A generated purpose-prop model keys (assets/manifest.ts; optional until they exist). */
export const PURPOSE_MODEL_KEYS: Partial<Record<PurposePropKind, string>> = {
  // Iteration-05 integration: tech-display.glb is a wall unit, so it renders the deviceWall; hotdogCart and
  // gunLocker keep their authored, loot-verified shapes until their generated models get a loot-surface fit.
  deviceWall: 'techDisplay', magazineRack: 'magazineRack', janitorCart: 'janitorCart', staffLockers: 'staffLockers',
};

/**
 * Storefront holder surfaces (iteration 04, procedural blocks in gen/storefronts.ts; Lane A models
 * are fitted to the PROP_DEFS boxes). items/lootLayout.ts mirrors these numbers (tests check it).
 * Counter: laminate top at full height. Display: deck inside the glass case. Back counter: worktop
 * and over-shelf. Cooler: four wire shelves behind the glass door.
 */
export const SHOP_COUNTER_TOP_Y = 1.05; // Meshy T2.5 shop-counter-t25.glb: flat top at the full 1.05 m (iteration 04: 1.045)
/** Countertop display footprint (shop-display.glb) and the counter top it stands on. */
export const SHOP_DISPLAY_CASE = {w: 1.1, h: 0.7, d: 0.62, baseY: 1.041};
/**
 * Iteration 05: loot sits INSIDE the open-front display case (Lane A shop-display-open.glb,
 * glass on all four sides) on its two trays, measured relative to the display base: lower tray
 * y 0.220 (x ±0.51, z −0.246..0.236, clear 0.187), upper rack y 0.432 (x ±0.49, z −0.235..0.225,
 * clear 0.184). Unit-relative heights = counter top 1.041 + tray. (Was the case top, 1.745.)
 */
export const SHOP_DISPLAY_TRAY_Y: [number, number] = [SHOP_DISPLAY_CASE.baseY + 0.22, SHOP_DISPLAY_CASE.baseY + 0.432];
/** Lowest display loot surface (the lower tray, unit-relative). */
export const SHOP_DISPLAY_DECK_Y = SHOP_DISPLAY_TRAY_Y[0];
/** Worktop and over-shelf (Meshy T2.5 shop-backbar-t25.glb, ray-cast 2026-10-29: 0.914 / 1.663 m; iteration 04: 0.865 / 1.62). */
export const SHOP_BACKBAR_Y: [number, number] = [0.914, 1.663];
/**
 * Cooler deck + wire shelves (Lane A shop-cooler-open.glb, no picture pane: real shelves behind a
 * transparent glass door at z 0.312; the shelf lip is at z 0.263..0.275, ceiling 1.70).
 */
export const SHOP_COOLER_TIER_Y: number[] = [0.26, 0.66, 1.06, 1.46];
/** Shop holder surfaces measured on the iteration-05 open cooler / display (5–8 mm inset margins). */
export const SHOP_COOLER_SURFACES: SurfaceSpec[] = [
  {y: 0.26, x0: -0.292, x1: 0.292, z0: -0.297, z1: 0.256, clear: 0.375},
  {y: 0.66, x0: -0.279, x1: 0.279, z0: -0.286, z1: 0.256, clear: 0.375},
  {y: 1.06, x0: -0.279, x1: 0.279, z0: -0.286, z1: 0.256, clear: 0.375},
  {y: 1.46, x0: -0.279, x1: 0.279, z0: -0.286, z1: 0.256, clear: 0.215},
];
export const SHOP_DISPLAY_SURFACES: SurfaceSpec[] = [
  {y: SHOP_DISPLAY_TRAY_Y[0], x0: -0.502, x1: 0.502, z0: -0.239, z1: 0.229, clear: 0.182},
  {y: SHOP_DISPLAY_TRAY_Y[1], x0: -0.482, x1: 0.482, z0: -0.228, z1: 0.218, clear: 0.178},
];

/** Override footprints with the real derivative bounds once assets are known. */
export function setPropDims(kind: PropKind, w: number, d: number, h: number): void {
  const def = PROP_DEFS[kind];
  def.w = w;
  def.d = d;
  def.h = h;
}

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  /** Base height (stacked crates sit on another crate). */
  y: number;
  /** Yaw in quarter turns only (0, PI/2, PI, -PI/2) so footprints stay axis-aligned. */
  rot: number;
  area: number;
  /** World AABB half extents on X/Z and full height. */
  hx: number;
  hz: number;
  h: number;
  blocksSight: boolean;
  variant: number;
  /** Storefront the prop belongs to (index into layout.storefronts). */
  shop?: number;
  /** Purpose override for loot/QA (e.g. a hot-dog cart standing in a hall); else the area's purpose. */
  purpose?: string;
  /**
   * Task gameplay-feedback-20261111 (lane FUEL-LOOT): a loot holder whose AMMO finds become another category — a key of items/loot.ts
   * AMMO_SWAPS (the Bunker storey S's station rations, gen/bunker/v2/stationRations.ts). Its table, theme and every other find stay.
   */
  ammoSwap?: string;
  /** Iteration 07 (P2): on-top decor — index (in layout.props) of the host prop it stands on. */
  host?: number;
  /** Iteration 07 (P2): spans of this host's top taken by on-top decor (host-local x, at height y); loot surfaces skip them. */
  cut?: {y: number; x0: number; x1: number}[];
  /** Iteration 07 (P2): wall-mounted / ceiling-hung (does not block walking; its cells are reserved). */
  mounted?: boolean;
  /** Iteration 07 (P2): low wall-mounted model rendered `lift` m above the placement base (the box still collides from the floor). */
  lift?: number;
  /** Iteration 08: level the prop stands on (gen/levels.ts; absent = 0, the main level). y is absolute world height after dressing. */
  level?: number;
  /** Iteration 08 (Lane P): composition cluster (index into compositionOf(layout).clusters) the prop belongs to. */
  cluster?: number;
  /**
   * Task mall-playtest-revision-20261031 (lane FIX, U04): an upright CYLINDER of radius hx (= hz) instead of the box — player /
   * zombie contact (core/physics.ts) and bullets / melee / flashlight (gen/levels.ts raycast) use the circle; grid masks, ragdoll
   * statics and loose-item queries keep the box. The mall's round atrium columns (gen/mall/columns.ts).
   */
  round?: boolean;
  /**
   * Task studio-beta-train-all-cargo-20261107-184244-01 (world/trainPropCargo.ts): a CARRIED prop appended to this layout (the train's
   * cargo in its parked car, or one left lying in this station) — its canonical identity ('<section id>#<layout index>' where it was
   * generated). Absent on every generated placement.
   */
  cargo?: string;
  /** Task train-all-cargo: a generated placement this station lost to the train (hidden at build; never respawned, roped or stocked). */
  cargoGone?: boolean;
}

/**
 * Task studio-beta-train-all-cargo-20261107-184244-01: the ONE gate for a level's own art / resources (a section preload keyed on the
 * kinds a layout holds): wanted when the layout is that level (`own`) or carries props from elsewhere (placement.cargo: the train's, or
 * left in this station) — a carried prop's look follows it into any level. Every level-gated preload uses this, never its own rule.
 */
export function levelArtWanted(layout: {props: readonly PropPlacement[]}, own: boolean): boolean {
  return own || layout.props.some(p => p.cargo !== undefined);
}

export function footprint(kind: PropKind, rot: number): {hx: number; hz: number} {
  const def = PROP_DEFS[kind];
  const quarter = Math.round(rot / (Math.PI / 2)) & 1;
  return quarter ? {hx: def.d / 2, hz: def.w / 2} : {hx: def.w / 2, hz: def.d / 2};
}
