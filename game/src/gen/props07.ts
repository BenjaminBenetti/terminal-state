// ITERATION-07 GENERATED PROPS (Lane P2): semantic integration of the >= 100 NEW native F16 SV/MV prop models (Lane P1 batch).
// Pure data + helpers (no three.js), level-generic.
//
// User (iteration 07): "As the main focus lets keep scaling up props! ... keep building out and enriching the environment. With at
// least 100 new props." Every type here is ONE genuinely new generated model (game/public/assets/models/p7-*.glb, provenance
// derivatives/props-iteration07.json, measured catalog ./props07.catalog.ts). This file says what each type IS in the game: its label,
// damage material class, collision, whether it is a loot holder (measured surfaces; finite Loot reused), and WHERE it spawns — room /
// store purposes (gen/purposes.ts ids) and public hall types — with a placement rule:
//   wall   : back against a wall (door zones, access strip `front` and room connectivity enforced by the station dresser)
//   row    : side by side along one wall
//   center : island with a walkway `ring`
//   mount  : wall-mounted at height `y` (never blocks walking; reserves its wall cells)
//   onTop  : stands on a host prop's top (counters, desks, tables, worktops); the host's loot surface gives up that span
// A type is INTEGRATED only when its model exists in the catalog AND it has a spec with at least one use (tests check catalog,
// provenance, registry and placement agree). Models load lazily: only the kinds a generated station placed are fetched.

import {P7_MODELS, type P7Model, type P7ModelKey, type P7Surface} from './props07.catalog';
import type {PropDef, PropPlacement, SurfaceSpec} from './props';
import type {DamageClass, PropDamageSpec} from '../damage/materials';

// ---------------------------------------------------------------------------------------
// Spec types

/** Public hall area types (no purpose) a use may name, besides room/store purpose ids. */
export const P7_HALL_KEYS = ['platform', 'fare-hall', 'concourse', 'paid-concourse', 'food-court', 'retail-arcade', 'passage', 'underpass', 'exit-stair'] as const;
export type P7HallKey = (typeof P7_HALL_KEYS)[number];

export interface P7Use {
  /** Room / store purpose ids (gen/purposes.ts) and/or public hall keys (P7_HALL_KEYS). */
  in: readonly string[];
  /**
   * wall: back to a wall · along: long side to a wall (deep items: stretcher, bicycle, pallet jack) · row: side by side along one wall ·
   * center: island near the middle with a walkway ring · free: loose item anywhere on open floor with a walkway ring (abandoned
   * luggage, strollers, carts) · mount: on a wall at height `y` (y < 0.9: low cabinet that still collides from the floor) · hang: from
   * the ceiling (headroom >= 2.2 m) · onTop: on a host prop's top · atHost: pulled up to a host (chairs at desks/tables).
   */
  at: 'wall' | 'along' | 'row' | 'center' | 'free' | 'mount' | 'hang' | 'onTop' | 'atHost';
  /** Wall relative to the room's main door (rooms/stores); halls use any wall. */
  wall?: 'far' | 'side' | 'near' | 'any';
  /** Count range per area (halls: scaled by floor area via `per100`). */
  n: readonly [number, number];
  /** Expected instances per 100 m2 of floor (big halls), clamped to n. */
  per100?: number;
  chance?: number;
  /** Clear access strip in front (m); default 0.9 (circulation >= ~1 m in front of every floor prop). */
  front?: number;
  /** Centre islands / free items: walkway kept clear all round (m). */
  ring?: number;
  /** mount: bottom height above the floor (m). */
  y?: number;
  /** onTop / atHost: host prop kinds. */
  on?: readonly string[];
  /** Placed before the area's other p7 uses (signature fixture of a purpose). */
  lead?: boolean;
  /** onTop / atHost: at most this many per area (e.g. one till per store). */
  max?: number;
  /**
   * Iteration 08 (Lane P) affinities for wall / along / mount uses: try spots right beside these partner fixtures first (a
   * pegboard by the tool chest, a copier by the desk) and/or beside the area's doors (`door`: extinguishers, punch clocks, coat
   * racks, baskets at the entrance). `space`: minimum distance between two of this kind in one area (m).
   */
  near?: readonly string[];
  door?: boolean;
  space?: number;
}

export interface P7Spec {
  /** HUD / holder label (lower case). */
  label: string;
  /** Damage material class (damage/materials.ts). */
  cls: DamageClass;
  /** Breakable body (default: never breaks, staged damage only). */
  breaks?: {mode: 'splinter' | 'collapse'; integrity: number};
  /** Screen / glass part (prop-local front fractions [x0, x1, y0, y1]). */
  glassFront?: {cls: 'glass' | 'screen'; integrity: number; rect: readonly [number, number, number, number]};
  /** Blocks line of sight (tall solid furniture); default h >= 1.6 and w >= 0.9. */
  blocksSight?: boolean;
  /** Light loose floor prop: rigid body when shot (Lane K damage/materials.ts PROP_PHYSICS pre-flags most such ids by name). */
  physics?: PropDef['physics'];
  /**
   * Station infrastructure kept in every station's palette (gen/props07Dress.ts: each station otherwise uses a seeded ~55% subset of
   * the catalogue, so per-station downloads / GPU texture memory stay bounded and stations differ).
   */
  core?: boolean;
  /**
   * Loot holder: measured support surfaces of the runtime model (or authored ones), lot range, empty chance, category modifiers
   * [food, drink, med, ammo] (rooms/stores stock it from their own purpose table; halls from these modifiers).
   */
  holder?: {lots: readonly [number, number]; empty: number; mod: readonly [number, number, number, number]; surfaces?: readonly SurfaceSpec[]; minClear?: number};
  uses: readonly P7Use[];
}

// ---------------------------------------------------------------------------------------
// Per-type specs — from Lane P1's manifest (generation/manifest.json: purpose rooms, placement, real dims, material hint) mapped onto
// this game's purposes / hall types / host props. Models measured by the P2 builder (props07.catalog.ts).

type N2 = readonly [number, number];
const W = (inn: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'wall', n, ...o});
const ALONG = (inn: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'along', n, ...o});
const ROW = (inn: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'row', n, ...o});
const FREE = (inn: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'free', n, ring: 0.9, ...o});
const MOUNT = (inn: readonly string[], n: N2, y: number, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'mount', n, y, ...o});
const HANG = (inn: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'hang', n, ...o});
const TOP = (inn: readonly string[], on: readonly string[], o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'onTop', on, n: [1, 1], max: 1, ...o});
const AT = (inn: readonly string[], on: readonly string[], n: N2, o: Partial<P7Use> = {}): P7Use => ({in: inn, at: 'atHost', on, n, ...o});

// Purpose groups (gen/purposes.ts ids; new iteration-07 rooms: workshop, pump-room, lost-property, revenue-room, custodial-room).
const FOOD_KITCHENS = ['burger', 'pizza', 'coffee', 'donut', 'bakery', 'noodles', 'sushi', 'deli', 'juice', 'shawarma', 'hotdog'];
const STORES = [...FOOD_KITCHENS, 'convenience', 'newsstand', 'pharmacy', 'florist', 'phone', 'keys', 'tech'];
const LOOSE_HALLS = ['platform', 'concourse', 'paid-concourse', 'passage', 'underpass'];
const KITCHEN_TOPS = ['shopBackbar', 'grillLine', 'espressoBar', 'wokLine', 'deliLine', 'blenderBar'];

export const P7_SPECS = {
  // --- public halls, platforms, ticketing -------------------------------------------------------------------------------
  payphone: {core: true, label: 'payphone', cls: 'sheetMetal', uses: [MOUNT(['platform'], [1, 3], 0.75, {per100: 0.25}), MOUNT(['concourse', 'fare-hall', 'passage', 'retail-arcade', 'paid-concourse', 'underpass'], [1, 2], 0.75, {chance: 0.7})]},
  emergencyCallPoint: {core: true, label: 'emergency call point', cls: 'sheetMetal', uses: [W(['platform'], [1, 3], {per100: 0.2}), W(['concourse', 'paid-concourse', 'passage', 'underpass', 'fare-hall'], [1, 1], {chance: 0.6})]},
  fareValidatorStand: {core: true, label: 'fare validator', cls: 'steel', uses: [ROW(['fare-hall', 'paid-concourse'], [2, 3], {chance: 0.8}), W(['platform'], [1, 2], {per100: 0.12, chance: 0.6}), W(['concourse'], [1, 2], {chance: 0.4})]},
  newspaperVendingBox: {core: true, label: 'newspaper box', cls: 'sheetMetal', uses: [ROW(['concourse', 'passage', 'fare-hall', 'paid-concourse', 'retail-arcade'], [2, 3], {chance: 0.6}), ROW(['exit-stair'], [1, 2], {chance: 0.3})]},
  atmKiosk: {label: 'cash machine', cls: 'sheetMetal', glassFront: {cls: 'screen', integrity: 25, rect: [0.18, 0.82, 0.6, 0.82]}, uses: [W(['concourse', 'fare-hall', 'retail-arcade', 'paid-concourse', 'food-court', 'passage'], [1, 2], {front: 1.0, chance: 0.6})]},
  infoTouchKiosk: {label: 'information kiosk', cls: 'sheetMetal', uses: [W(['concourse', 'fare-hall', 'paid-concourse', 'retail-arcade', 'food-court'], [1, 1], {front: 1.0, chance: 0.6})]},
  capsuleToyMachine: {label: 'capsule toy machine', cls: 'plastic', uses: [ROW(['concourse', 'passage', 'retail-arcade', 'food-court', 'paid-concourse'], [1, 2], {chance: 0.4}), W(['convenience'], [1, 1], {chance: 0.3})]},
  crowdBarrier: {label: 'crowd barrier', cls: 'steel', uses: [W(['concourse', 'fare-hall', 'paid-concourse', 'passage'], [1, 2], {front: 1.0, chance: 0.6}), W(['service-corridor'], [1, 1], {chance: 0.25})]},
  securityPodium: {core: true, label: 'security podium', cls: 'laminate', uses: [W(['fare-hall', 'paid-concourse', 'concourse'], [1, 1], {front: 1.0, chance: 0.35}), W(['security-office'], [1, 1], {chance: 0.4})]},
  platformClock: {label: 'platform clock', cls: 'sheetMetal', uses: [HANG(['platform'], [1, 2], {per100: 0.12}), HANG(['concourse', 'fare-hall', 'paid-concourse'], [1, 1], {chance: 0.5})]},
  cctvCamera: {core: true, label: 'CCTV camera', cls: 'plastic', uses: [MOUNT(['platform'], [1, 3], 2.45, {per100: 0.2}), MOUNT(['concourse', 'paid-concourse', 'fare-hall', 'passage', 'retail-arcade', 'food-court', 'underpass'], [1, 2], 2.45, {chance: 0.7}), MOUNT(['service-corridor'], [1, 1], 2.15, {chance: 0.35}), MOUNT(['security-office', 'revenue-room'], [1, 1], 2.15, {chance: 0.6})]},
  aedWallCabinet: {label: 'defibrillator cabinet', cls: 'plastic', uses: [MOUNT(['concourse', 'fare-hall', 'paid-concourse', 'platform', 'retail-arcade', 'food-court'], [1, 1], 1.2, {chance: 0.6}), MOUNT(['first-aid-room'], [1, 1], 1.2, {chance: 0.7})]},
  fireExtinguisherCabinet: {core: true, label: 'fire extinguisher cabinet', cls: 'sheetMetal', uses: [MOUNT(['platform'], [1, 3], 0.6, {per100: 0.2}), MOUNT(['concourse', 'paid-concourse', 'fare-hall', 'passage', 'retail-arcade', 'food-court', 'underpass', 'service-corridor', 'storage', 'workshop'], [1, 1], 0.6, {chance: 0.6})]},
  fireHoseReelCabinet: {label: 'fire hose reel', cls: 'sheetMetal', uses: [MOUNT(['platform'], [1, 2], 0.4, {per100: 0.12}), MOUNT(['service-corridor', 'storage', 'passage', 'paid-concourse', 'pump-room', 'workshop'], [1, 1], 0.4, {chance: 0.45})]},
  fieldPhoneBox: {label: 'track phone', cls: 'sheetMetal', uses: [MOUNT(['platform'], [1, 2], 1.2, {per100: 0.12}), MOUNT(['service-corridor', 'signal-room', 'underpass', 'passage'], [1, 1], 1.2, {chance: 0.5})]},
  shoeShineChair: {label: 'shoe-shine chair', cls: 'wood', uses: [W(['keys'], [1, 1], {chance: 0.5}), W(['concourse', 'passage', 'retail-arcade'], [1, 1], {front: 1.0, chance: 0.25})]},
  // abandoned / loose things in public space (evacuation leftovers)
  rollingSuitcase: {label: 'suitcase', cls: 'plastic', uses: [FREE(LOOSE_HALLS, [1, 2], {per100: 0.05, chance: 0.45}), W(['lost-property'], [2, 3], {lead: true, front: 0.6}), W(['security-office'], [1, 1], {chance: 0.3, front: 0.6})]},
  duffelBag: {label: 'duffel bag', cls: 'fabric', uses: [FREE(LOOSE_HALLS, [1, 1], {chance: 0.35}), W(['lost-property', 'locker-room'], [1, 2], {chance: 0.6, front: 0.6})]},
  babyStroller: {label: 'stroller', cls: 'fabric', uses: [FREE(['platform', 'concourse', 'passage', 'paid-concourse'], [1, 1], {chance: 0.2}), W(['lost-property'], [1, 1], {chance: 0.6})]},
  bicycle: {label: 'bicycle', cls: 'steel', uses: [FREE(['platform', 'concourse', 'passage'], [1, 1], {chance: 0.2}), ALONG(['service-corridor', 'lost-property'], [1, 1], {chance: 0.35})]},
  shoppingCart: {label: 'shopping cart', cls: 'steel', holder: {lots: [1, 3], empty: 0.35, mod: [1.6, 1.4, 0.2, 0]}, uses: [W(['convenience'], [1, 1], {chance: 0.5, front: 0.8}), FREE(['platform', 'concourse', 'passage', 'paid-concourse', 'underpass'], [1, 1], {chance: 0.2})]},
  wheelchair: {label: 'wheelchair', cls: 'steel', uses: [W(['first-aid-room'], [1, 1], {chance: 0.6}), W(['pharmacy'], [1, 1], {chance: 0.3}), FREE(['concourse', 'platform', 'paid-concourse'], [1, 1], {chance: 0.15})]},
  trashBagPile: {label: 'trash bags', cls: 'fabric', uses: [W(['service-corridor', 'storage'], [1, 1], {chance: 0.5}), W(['custodial-room'], [1, 2], {lead: true}), W(['platform', 'passage', 'underpass', 'food-court'], [1, 2], {per100: 0.06, chance: 0.4}), W(['burger', 'pizza'], [1, 1], {chance: 0.2, front: 0.7})]},
  foldingBarricade: {core: true, label: 'folding barricade', cls: 'plastic', uses: [W(['service-corridor', 'storage', 'custodial-room'], [1, 1], {chance: 0.4}), W(['platform', 'passage', 'concourse', 'underpass'], [1, 1], {chance: 0.3, front: 1.0})]},
  wetFloorSign: {label: 'wet floor sign', cls: 'plastic', uses: [FREE(['washroom', 'passage', 'concourse', 'food-court', 'retail-arcade', 'paid-concourse'], [1, 1], {chance: 0.35, ring: 0.8}), W(['janitor-closet', 'custodial-room'], [1, 2], {chance: 0.6, front: 0.5}), W(['service-corridor'], [1, 1], {chance: 0.3, front: 0.5})]},
  // --- washrooms ----------------------------------------------------------------------------------------------------------
  urinal: {core: true, label: 'urinal', cls: 'porcelain', uses: [ROW(['washroom'], [2, 3], {y: 0.25, front: 0.8, chance: 0.75})]},
  handDryer: {core: true, label: 'hand dryer', cls: 'sheetMetal', uses: [MOUNT(['washroom'], [1, 2], 1.05), MOUNT(['staff-room', 'locker-room'], [1, 1], 1.05, {chance: 0.35})]},
  paperTowelDispenser: {core: true, label: 'paper towel dispenser', cls: 'plastic', uses: [MOUNT(['washroom'], [1, 1], 1.1), MOUNT(['first-aid-room', 'staff-room', 'custodial-room'], [1, 1], 1.1, {chance: 0.5}), MOUNT(['janitor-closet'], [1, 1], 1.1, {chance: 0.25})]},
  biohazardBin: {label: 'biohazard bin', cls: 'plastic', uses: [W(['first-aid-room', 'pharmacy', 'washroom'], [1, 1], {chance: 0.5, front: 0.5})]},
  // --- cleaning / custodial ---------------------------------------------------------------------------------------------
  mopBucketWringer: {label: 'mop bucket', cls: 'plastic', uses: [W(['janitor-closet', 'custodial-room', 'supply-closet'], [1, 1], {chance: 0.7, front: 0.6}), W(['service-corridor'], [1, 1], {chance: 0.25, front: 0.6}), FREE(['washroom'], [1, 1], {chance: 0.3, ring: 0.8})]},
  floorScrubber: {label: 'floor scrubber', cls: 'plastic', uses: [W(['custodial-room'], [1, 1], {lead: true}), W(['storage', 'service-corridor', 'janitor-closet'], [1, 1], {chance: 0.35})]},
  floorBuffer: {label: 'floor buffer', cls: 'steel', uses: [W(['janitor-closet', 'custodial-room', 'storage'], [1, 1], {chance: 0.5, front: 0.6})]},
  wetDryVac: {label: 'wet/dry vacuum', cls: 'plastic', uses: [W(['janitor-closet', 'storage', 'supply-closet', 'custodial-room', 'workshop'], [1, 1], {chance: 0.5, front: 0.6})]},
  wheelieBin: {label: 'wheelie bin', cls: 'plastic', uses: [ROW(['custodial-room'], [2, 3], {lead: true}), W(['service-corridor', 'storage'], [1, 1], {chance: 0.6}), W(['burger', 'pizza', 'deli'], [1, 1], {chance: 0.2, front: 0.7})]},
  handTruck: {label: 'hand truck', cls: 'steel', uses: [W(['storage', 'custodial-room', 'lost-property', 'convenience'], [1, 1], {chance: 0.4, front: 0.6}), W(['stock-room', 'service-corridor'], [1, 1], {chance: 0.25, front: 0.6})]},
  palletJack: {label: 'pallet jack', cls: 'steel', uses: [ALONG(['stock-room', 'storage', 'service-corridor', 'custodial-room'], [1, 1], {chance: 0.45})]},
  stepLadder: {label: 'step ladder', cls: 'steel', uses: [W(['storage', 'janitor-closet', 'electrical-room', 'service-corridor', 'stock-room', 'workshop', 'custodial-room'], [1, 1], {chance: 0.4, front: 0.6})]},
  // --- staff rooms / offices --------------------------------------------------------------------------------------------
  waterCooler: {label: 'water cooler', cls: 'plastic', uses: [W(['staff-room', 'agent-office', 'security-office', 'first-aid-room', 'locker-room', 'revenue-room', 'lost-property', 'workshop'], [1, 1], {chance: 0.55, front: 0.7})]},
  coatRack: {label: 'coat rack', cls: 'wood', uses: [W(['staff-room', 'locker-room', 'agent-office', 'lost-property'], [1, 1], {chance: 0.5, front: 0.6})]},
  pedestalFan: {label: 'pedestal fan', cls: 'plastic', uses: [W(['staff-room', 'agent-office', 'security-office', 'locker-room', 'signal-room', 'revenue-room', 'pizza'], [1, 1], {chance: 0.4, front: 0.6})]},
  oilRadiator: {label: 'oil radiator', cls: 'sheetMetal', uses: [W(['staff-room', 'agent-office', 'security-office', 'revenue-room', 'lost-property'], [1, 1], {chance: 0.35, front: 0.6})]},
  mobileWhiteboard: {label: 'whiteboard', cls: 'laminate', uses: [W(['staff-room', 'agent-office', 'signal-room', 'security-office', 'workshop'], [1, 1], {chance: 0.5, front: 0.6})]},
  filingCabinet: {label: 'filing cabinet', cls: 'sheetMetal', uses: [ROW(['agent-office', 'security-office', 'signal-room', 'revenue-room', 'lost-property'], [1, 2], {front: 0.8}), W(['first-aid-room', 'pharmacy'], [1, 1], {chance: 0.4, front: 0.8})]},
  officeCopier: {label: 'copier', cls: 'plastic', uses: [W(['agent-office', 'security-office', 'pharmacy', 'revenue-room'], [1, 1], {chance: 0.5, front: 0.8})]},
  paperShredder: {label: 'paper shredder', cls: 'plastic', physics: {mass: 10, dynamic: true, mat: 'plastic'}, uses: [W(['agent-office', 'security-office', 'revenue-room'], [1, 1], {chance: 0.5, front: 0.5})]},
  crtTvCart: {label: 'TV cart', cls: 'plastic', uses: [W(['staff-room', 'security-office', 'agent-office'], [1, 1], {chance: 0.4, front: 0.8})]},
  lunchCooler: {label: 'lunch cooler', cls: 'plastic', uses: [W(['staff-room', 'locker-room', 'storage'], [1, 1], {chance: 0.4, front: 0.5})]},
  punchClock: {label: 'punch clock', cls: 'sheetMetal', uses: [MOUNT(['staff-room', 'locker-room'], [1, 1], 1.2, {chance: 0.5}), MOUNT(['service-corridor'], [1, 1], 1.2, {chance: 0.2})]},
  mailCubby: {label: 'mail cubbies', cls: 'wood', uses: [MOUNT(['staff-room', 'agent-office', 'locker-room', 'lost-property'], [1, 1], 1.1, {chance: 0.5})]},
  keyCabinet: {label: 'key cabinet', cls: 'sheetMetal', uses: [MOUNT(['agent-office', 'security-office', 'signal-room', 'revenue-room', 'keys', 'workshop'], [1, 1], 1.3, {chance: 0.7})]},
  officeSwivelChair: {label: 'office chair', cls: 'fabric', uses: [AT(['agent-office', 'security-office', 'signal-room', 'revenue-room', 'lost-property', 'staff-room'], ['desk', 'monitorDesk'], [1, 1], {max: 2})]},
  foldingChair: {label: 'folding chair', cls: 'steel', uses: [AT(['staff-room', 'locker-room', 'security-office', 'signal-room', 'workshop', 'first-aid-room'], ['table', 'desk'], [1, 2], {max: 3}), W(['storage', 'lost-property'], [1, 1], {chance: 0.3, front: 0.5})]},
  plasticStackChair: {label: 'stacking chair', cls: 'plastic', uses: [AT(['staff-room', 'first-aid-room'], ['table'], [1, 2], {max: 2}), FREE(['food-court'], [1, 3], {chance: 0.6, ring: 0.8}), W(['burger', 'noodles', 'sushi'], [1, 1], {chance: 0.3, front: 0.6})]},
  microwaveOven: {label: 'microwave', cls: 'sheetMetal', uses: [TOP(['staff-room', 'agent-office', 'security-office', 'signal-room', 'locker-room', 'lost-property'], ['table', 'desk', 'cabinetLow', 'kitchenette'], {chance: 0.7}), TOP(['burger', 'pizza', 'coffee', 'deli', 'shawarma', 'hotdog', 'donut'], ['shopBackbar'], {chance: 0.45})]},
  dripCoffeeMaker: {label: 'coffee maker', cls: 'plastic', uses: [TOP(['staff-room', 'agent-office', 'security-office', 'signal-room', 'locker-room', 'revenue-room', 'lost-property', 'workshop'], ['kitchenette', 'table', 'desk', 'cabinetLow'], {chance: 0.7})]},
  beverageUrn: {label: 'beverage urn', cls: 'steel', uses: [TOP(['coffee', 'donut'], ['espressoBar', 'shopBackbar', 'shopCounter'], {chance: 0.6}), TOP(['staff-room'], ['kitchenette', 'table'], {chance: 0.3})]},
  crtTerminal: {label: 'computer terminal', cls: 'plastic', glassFront: {cls: 'screen', integrity: 20, rect: [0.15, 0.85, 0.4, 0.92]}, uses: [TOP(['agent-office', 'signal-room', 'security-office', 'revenue-room', 'lost-property', 'keys'], ['desk', 'monitorDesk', 'shopCounter'], {max: 2})]},
  coinCounter: {label: 'coin counter', cls: 'plastic', uses: [TOP(['agent-office', 'revenue-room', 'convenience', 'newsstand'], ['desk', 'shopCounter', 'stall'], {chance: 0.55})]},
  radioChargerRack: {label: 'radio charger', cls: 'plastic', uses: [TOP(['security-office', 'agent-office', 'signal-room'], ['desk', 'monitorDesk', 'cabinetLow'], {chance: 0.6})]},
  // --- retail / food service ----------------------------------------------------------------------------------------------
  cashRegister: {core: true, label: 'cash register', cls: 'plastic', uses: [TOP(STORES, ['shopCounter', 'showcase', 'stall'], {chance: 0.85})]},
  candyDisplay: {label: 'candy display', cls: 'cardboard', uses: [TOP(['convenience', 'newsstand'], ['shopCounter', 'stall'], {chance: 0.6})]},
  newspaperBundles: {label: 'newspaper bundles', cls: 'cardboard', uses: [W(['newsstand'], [1, 2], {front: 0.6}), W(['convenience'], [1, 1], {chance: 0.5, front: 0.6}), W(['stock-room'], [1, 1], {chance: 0.25, front: 0.6}), W(['concourse', 'passage', 'paid-concourse'], [1, 1], {chance: 0.25, front: 0.8})]},
  spinnerRack: {label: 'spinner rack', cls: 'steel', physics: {mass: 14, dynamic: true, mat: 'heavy'}, uses: [W(['newsstand', 'convenience', 'pharmacy', 'phone'], [1, 1], {chance: 0.7})]},
  basketStack: {label: 'shopping baskets', cls: 'plastic', uses: [W(['convenience', 'pharmacy', 'newsstand'], [1, 1], {chance: 0.7, front: 0.6})]},
  chestFreezer: {label: 'chest freezer', cls: 'sheetMetal', uses: [W(['convenience', 'newsstand', 'juice'], [1, 1], {chance: 0.6})]},
  bloodPressureKiosk: {label: 'blood pressure kiosk', cls: 'plastic', uses: [W(['pharmacy'], [1, 1], {chance: 0.8})]},
  solderingStation: {label: 'soldering station', cls: 'plastic', uses: [TOP(['phone', 'tech'], ['repairBench', 'shopCounter', 'showcase'], {chance: 0.7})]},
  keyCuttingMachine: {label: 'key cutting machine', cls: 'steel', uses: [TOP(['keys'], ['shopCounter', 'repairBench'], {chance: 0.9})]},
  deepFryer: {label: 'deep fryer', cls: 'steel', uses: [TOP(['burger', 'donut', 'shawarma', 'hotdog'], ['shopBackbar', 'grillLine'], {chance: 0.8})]},
  riceCooker: {label: 'rice cooker', cls: 'steel', uses: [TOP(['noodles', 'sushi'], ['shopBackbar', 'wokLine', 'deliLine', 'shopCounter'], {chance: 0.85})]},
  espressoGrinder: {label: 'espresso grinder', cls: 'steel', uses: [TOP(['coffee', 'donut', 'bakery'], ['espressoBar', 'shopBackbar', 'shopCounter'], {chance: 0.8})]},
  conveyorToaster: {label: 'conveyor toaster', cls: 'steel', uses: [TOP(['coffee', 'donut', 'bakery', 'deli', 'burger'], KITCHEN_TOPS, {chance: 0.6})]},
  sodaFountain: {label: 'soda fountain', cls: 'steel', uses: [TOP(['burger', 'pizza', 'hotdog', 'shawarma'], ['shopBackbar', 'shopCounter'], {chance: 0.7})]},
  slushMachine: {label: 'slush machine', cls: 'plastic', uses: [TOP(['juice', 'convenience', 'hotdog'], ['blenderBar', 'shopBackbar', 'shopCounter'], {chance: 0.7})]},
  popcornMachine: {label: 'popcorn machine', cls: 'glass', uses: [TOP(['convenience', 'hotdog'], ['shopCounter'], {chance: 0.5})]},
  hotDogRoller: {label: 'hot-dog roller', cls: 'steel', uses: [TOP(['hotdog', 'convenience'], ['shopCounter', 'shopBackbar', 'grillLine'], {chance: 0.8})]},
  condimentStation: {label: 'condiment station', cls: 'plastic', uses: [TOP(['burger', 'hotdog', 'shawarma', 'deli', 'pizza'], ['shopCounter'], {chance: 0.6})]},
  meatSlicer: {label: 'meat slicer', cls: 'steel', uses: [TOP(['deli', 'shawarma', 'sushi'], ['deliLine', 'shopBackbar', 'shopCounter', 'grillLine'], {chance: 0.8})]},
  standMixer: {label: 'stand mixer', cls: 'steel', uses: [W(['bakery', 'pizza', 'donut'], [1, 1], {chance: 0.6, front: 0.7})]},
  ingredientBin: {label: 'ingredient bin', cls: 'plastic', physics: {mass: 8, dynamic: true, mat: 'plastic'}, uses: [W(['bakery', 'pizza', 'donut', 'noodles'], [1, 1], {chance: 0.6, front: 0.6})]},
  iceMachine: {label: 'ice machine', cls: 'steel', uses: [W(['burger', 'juice', 'sushi', 'deli', 'hotdog'], [1, 1], {chance: 0.5, front: 0.8})]},
  busCart: {label: 'bus cart', cls: 'plastic', holder: {lots: [1, 3], empty: 0.4, mod: [1.5, 1.5, 0, 0]}, uses: [W(['food-court'], [1, 2], {chance: 0.6, front: 1.0}), W(['burger', 'noodles', 'sushi', 'pizza'], [1, 1], {chance: 0.35, front: 0.7}), W(['staff-room'], [1, 1], {chance: 0.2})]},
  // --- medical ----------------------------------------------------------------------------------------------------------------
  crashCart: {label: 'crash cart', cls: 'sheetMetal', holder: {lots: [1, 3], empty: 0.2, mod: [0, 0.3, 3, 0]}, uses: [W(['first-aid-room'], [1, 1], {chance: 0.85, front: 0.8}), W(['pharmacy'], [1, 1], {chance: 0.3})]},
  // Loot on the flat middle of the mattress (the measured extent includes the raised backrest).
  // Meshy T2.5 stretcher (ray-cast 2026-10-29): flat mattress top 0.70 m over z -0.1..0.6, raised backrest toward -z (0.75..0.89)
  wheeledStretcher: {label: 'stretcher', cls: 'steel', holder: {lots: [1, 2], empty: 0.45, mod: [0, 0.3, 3, 0], surfaces: [{y: 0.7, x0: -0.17, x1: 0.17, z0: -0.1, z1: 0.6, clear: 0.35}]}, uses: [ALONG(['first-aid-room'], [1, 1], {chance: 0.7}), FREE(['platform'], [1, 1], {chance: 0.12, ring: 1.0})]},
  ivPole: {label: 'IV pole', cls: 'steel', uses: [W(['first-aid-room'], [1, 2], {chance: 0.7, front: 0.5}), W(['pharmacy'], [1, 1], {chance: 0.2, front: 0.5})]},
  oxygenCart: {label: 'oxygen cart', cls: 'steel', uses: [W(['first-aid-room', 'pharmacy'], [1, 1], {chance: 0.6, front: 0.5})]},
  physicianScale: {label: 'scale', cls: 'steel', uses: [W(['first-aid-room'], [1, 1], {chance: 0.6}), W(['pharmacy'], [1, 1], {chance: 0.3})]},
  privacyScreen: {label: 'privacy screen', cls: 'fabric', uses: [W(['first-aid-room'], [1, 1], {chance: 0.6, front: 0.6})]},
  eyewashStation: {label: 'eyewash station', cls: 'plastic', uses: [MOUNT(['first-aid-room', 'electrical-room', 'storage', 'pump-room', 'workshop', 'custodial-room'], [1, 1], 0.9, {chance: 0.5}), MOUNT(['janitor-closet'], [1, 1], 0.9, {chance: 0.2})]},
  firstAidWallKit: {label: 'first-aid kit', cls: 'sheetMetal', uses: [MOUNT(['first-aid-room', 'staff-room', 'locker-room', 'workshop', 'pump-room', 'custodial-room', 'burger', 'pizza'], [1, 1], 1.3, {chance: 0.6}), MOUNT(['service-corridor'], [1, 1], 1.3, {chance: 0.25})]},
  // --- security / revenue -----------------------------------------------------------------------------------------------------
  fareVaultCart: {label: 'fare vault cart', cls: 'steel', uses: [W(['revenue-room'], [1, 2], {lead: true, front: 0.8}), W(['agent-office', 'security-office'], [1, 1], {chance: 0.4}), W(['service-corridor'], [1, 1], {chance: 0.1})]},
  // --- tech / signals -------------------------------------------------------------------------------------------------------------
  wallDataCabinet: {label: 'data cabinet', cls: 'sheetMetal', uses: [MOUNT(['signal-room', 'electrical-closet', 'agent-office', 'revenue-room', 'security-office'], [1, 2], 1.4, {chance: 0.7}), MOUNT(['tech'], [1, 1], 1.4, {chance: 0.3})]},
  signalHeadSpare: {label: 'spare signal head', cls: 'steel', uses: [W(['signal-room', 'storage', 'workshop'], [1, 1], {chance: 0.6, front: 0.6}), W(['service-corridor'], [1, 1], {chance: 0.25, front: 0.6})]},
  disconnectSwitch: {label: 'disconnect switch', cls: 'sheetMetal', uses: [MOUNT(['electrical-room', 'electrical-closet', 'signal-room', 'pump-room', 'workshop'], [1, 2], 1.2, {chance: 0.7}), MOUNT(['service-corridor'], [1, 1], 1.2, {chance: 0.3})]},
  dryTransformer: {label: 'transformer', cls: 'sheetMetal', uses: [W(['electrical-room'], [1, 1], {chance: 0.75}), W(['electrical-closet'], [1, 1], {chance: 0.4})]},
  cableSpool: {label: 'cable spool', cls: 'wood', uses: [W(['storage', 'electrical-room', 'service-corridor', 'signal-room', 'workshop'], [1, 1], {chance: 0.5, front: 0.6})]},
  // --- maintenance workshop / plant ---------------------------------------------------------------------------------------------
  rollingToolChest: {label: 'tool chest', cls: 'sheetMetal', holder: {lots: [1, 3], empty: 0.3, mod: [0.2, 0.6, 1, 1.6]}, uses: [W(['workshop'], [1, 1], {lead: true, front: 0.8}), W(['storage', 'electrical-room', 'signal-room'], [1, 1], {chance: 0.5, front: 0.8})]},
  benchGrinderStand: {label: 'bench grinder', cls: 'steel', uses: [W(['workshop'], [1, 1], {lead: true, front: 0.7}), W(['storage', 'electrical-room'], [1, 1], {chance: 0.3, front: 0.7})]},
  toolPegboard: {label: 'tool pegboard', cls: 'wood', uses: [MOUNT(['workshop'], [1, 1], 1.0, {lead: true}), MOUNT(['storage', 'electrical-room', 'signal-room'], [1, 1], 1.0, {chance: 0.5})]},
  partsBinRack: {label: 'parts bins', cls: 'plastic', uses: [MOUNT(['storage', 'electrical-room', 'signal-room', 'workshop', 'phone', 'keys'], [1, 1], 0.95, {chance: 0.6})]},
  handToolbox: {label: 'toolbox', cls: 'sheetMetal', uses: [TOP(['storage', 'electrical-room', 'signal-room', 'electrical-closet', 'workshop', 'service-corridor'], ['cabinetLow', 'crate', 'desk', 'shelf', 'rollingToolChest'], {chance: 0.6, max: 2})]},
  airCompressor: {label: 'air compressor', cls: 'steel', uses: [W(['workshop', 'storage', 'electrical-room', 'pump-room'], [1, 1], {chance: 0.5, front: 0.6})]},
  gasCylinderCart: {label: 'gas cylinder cart', cls: 'steel', uses: [W(['workshop', 'storage', 'electrical-room'], [1, 1], {chance: 0.4, front: 0.6})]},
  tripodWorkLight: {core: true, label: 'work light', cls: 'steel', uses: [W(['storage', 'electrical-room', 'service-corridor', 'signal-room', 'workshop'], [1, 1], {chance: 0.4, front: 0.6}), FREE(['platform', 'underpass'], [1, 1], {chance: 0.1})]},
  portableGenerator: {label: 'generator', cls: 'steel', uses: [W(['storage', 'electrical-room', 'service-corridor', 'workshop', 'pump-room'], [1, 1], {chance: 0.5, front: 0.6}), FREE(['platform'], [1, 1], {chance: 0.1})]},
  drumFan: {label: 'drum fan', cls: 'steel', uses: [W(['electrical-room', 'storage', 'service-corridor', 'pump-room', 'workshop'], [1, 1], {chance: 0.4, front: 0.7}), W(['burger'], [1, 1], {chance: 0.2})]},
  waterPumpSkid: {label: 'water pump', cls: 'steel', uses: [W(['pump-room'], [1, 2], {lead: true, front: 0.8}), W(['electrical-room', 'storage'], [1, 1], {chance: 0.3})]},
  waterHeaterTank: {label: 'water heater', cls: 'sheetMetal', uses: [W(['pump-room'], [1, 1], {lead: true, front: 0.8}), W(['electrical-room', 'storage'], [1, 1], {chance: 0.3})]},
  pipeValveManifold: {label: 'valve manifold', cls: 'steel', uses: [MOUNT(['pump-room'], [1, 1], 0.5, {lead: true}), MOUNT(['electrical-room', 'storage', 'service-corridor', 'washroom'], [1, 1], 0.5, {chance: 0.3})]},
  fireExtinguisher: {label: 'fire extinguisher', cls: 'steel', uses: [W(['platform'], [1, 3], {per100: 0.15, front: 0.5}), W(['service-corridor', 'storage', 'electrical-room', 'staff-room', 'workshop', 'pump-room', 'custodial-room', 'burger', 'pizza', 'noodles', 'shawarma'], [1, 1], {chance: 0.5, front: 0.5})]},
} as const satisfies Record<string, P7Spec>;

/** Built models deliberately NOT integrated (with the reason) — tests require every catalog model to be integrated or listed here. */
export const P7_REJECTED: Readonly<Record<string, string>> = {};

// ---------------------------------------------------------------------------------------
// Derived registry

type SpecKey = keyof typeof P7_SPECS;
/** Integrated iteration-07 prop kinds: built model + spec. */
export type P7Kind = P7ModelKey & SpecKey;
type HolderOf<K extends P7Kind> = (typeof P7_SPECS)[K] extends {holder: object} ? K : never;
export type P7HolderKind = {[K in P7Kind]: HolderOf<K>}[P7Kind];

const SPECS = P7_SPECS as Readonly<Record<string, P7Spec>>;
const MODELS = P7_MODELS as Readonly<Record<string, P7Model>>;

export const P7_KINDS: readonly P7Kind[] = Object.keys(MODELS).filter(k => SPECS[k] && SPECS[k].uses.length).sort() as P7Kind[];
const KIND_SET = new Set<string>(P7_KINDS);
export function isP7Kind(kind: string): kind is P7Kind { return KIND_SET.has(kind); }
export function p7Spec(kind: P7Kind): P7Spec { return SPECS[kind]; }
export function p7Model(kind: P7Kind): P7Model { return MODELS[kind]; }

// Iteration 16 (WORLD-GEN): the office tower's purposes (gen/purposes.ts 'office-*', gen/office/*) reuse these generated props.
// Appended AFTER the kind list is derived (only kinds that already have uses): the set of integrated kinds, the per-station palette
// and every station-purpose use stay exactly as before — these uses only match office purpose keys.
{
  const ADD: Readonly<Record<string, P7Use[]>> = {
    coatRack: [W(['office-private', 'office-exec', 'office-reception'], [1, 1], {chance: 0.4, front: 0.6})],
    filingCabinet: [ROW(['office-private', 'office-exec', 'office-copy'], [1, 2], {front: 0.8}), ROW(['office-open'], [2, 4], {front: 0.8}), W(['office-security'], [1, 1], {chance: 0.6, front: 0.8})],
    paperShredder: [W(['office-copy', 'office-exec'], [1, 1], {chance: 0.5, front: 0.5})],
    mailCubby: [MOUNT(['office-copy', 'office-reception'], [1, 1], 1.1, {chance: 0.6})],
    keyCabinet: [MOUNT(['office-security'], [1, 1], 1.3, {chance: 0.7})],
    officeSwivelChair: [AT(['office-security'], ['desk', 'monitorDesk'], [1, 1], {max: 2})],
    crtTerminal: [TOP(['office-security'], ['desk', 'monitorDesk'], {max: 2})],
    radioChargerRack: [TOP(['office-security'], ['desk', 'monitorDesk', 'cabinetLow'], {chance: 0.6})],
    cctvCamera: [MOUNT(['office-security', 'office-reception', 'office-corridor'], [1, 1], 2.15, {chance: 0.5})],
    fireExtinguisherCabinet: [MOUNT(['office-corridor', 'office-open', 'office-reception'], [1, 1], 0.6, {chance: 0.6})],
    fireExtinguisher: [W(['office-copy', 'office-storage', 'office-server'], [1, 1], {chance: 0.5, front: 0.5})],
    partsBinRack: [MOUNT(['office-server', 'office-storage'], [1, 1], 0.95, {chance: 0.5})],
    microwaveOven: [TOP(['office-break'], ['kitchenette', 'cabinetLow', 'table'], {chance: 0.8})],
    dripCoffeeMaker: [TOP(['office-break'], ['kitchenette', 'cabinetLow', 'table'], {chance: 0.7})],
    firstAidWallKit: [MOUNT(['office-break', 'office-corridor'], [1, 1], 1.3, {chance: 0.45})],
    aedWallCabinet: [MOUNT(['office-reception', 'office-corridor'], [1, 1], 1.2, {chance: 0.35})],
    wallDataCabinet: [MOUNT(['office-server', 'office-copy'], [1, 2], 1.4, {chance: 0.7})],
    pedestalFan: [W(['office-private', 'office-open', 'office-server'], [1, 1], {chance: 0.35, front: 0.6})],
    wetFloorSign: [FREE(['office-corridor', 'office-reception'], [1, 1], {chance: 0.3, ring: 0.8})],
    plasticStackChair: [W(['office-break', 'office-meeting'], [1, 2], {chance: 0.5, front: 0.5})],
    stepLadder: [W(['office-storage', 'office-copy'], [1, 1], {chance: 0.5, front: 0.6})],
    crtTvCart: [W(['office-meeting'], [1, 1], {chance: 0.4, front: 0.8})],
    atmKiosk: [W(['office-reception', 'office-lobby'], [1, 1], {chance: 0.45, front: 1.0})],
    punchClock: [MOUNT(['office-security'], [1, 1], 1.2, {chance: 0.6})],
    securityPodium: [W(['office-reception'], [1, 1], {chance: 0.4, front: 1.0})],
    trashBagPile: [W(['office-storage', 'office-corridor'], [1, 1], {chance: 0.3})],
    wheelieBin: [W(['office-storage'], [1, 1], {chance: 0.4})],
    emergencyCallPoint: [W(['office-corridor'], [1, 1], {chance: 0.4})],
    infoTouchKiosk: [W(['office-lobby'], [1, 1], {front: 1.0, chance: 0.3})],
  };
  for (const [k, us] of Object.entries(ADD)) if (KIND_SET.has(k) && SPECS[k].uses.length) (SPECS[k].uses as P7Use[]).push(...us!);
}

/** Runtime model key of a kind (lazy library key). */
export const p7ModelKey = (kind: string): string => `p7_${kind}`;
/** Lazy model files (assets/loader.ts PropModelLibrary). */
export const P7_FILES: Readonly<Record<string, {url: string; bytes: number}>> = Object.fromEntries(P7_KINDS.map(k => [p7ModelKey(k), {url: MODELS[k].url, bytes: MODELS[k].bytes}]));

/** Footprints = the measured model bounds (the derivative is already at real scale; instancing fits it to this box). */
export const P7_PROP_DEFS = Object.fromEntries(P7_KINDS.map(k => {
  const m = MODELS[k], s = SPECS[k];
  return [k, {w: m.w, d: m.d, h: m.h, blocksSight: s.blocksSight ?? (m.h >= 1.6 && m.w >= 0.9), ...(s.physics ? {physics: s.physics} : {})}];
})) as Record<P7Kind, PropDef>;

export const P7_HOLDER_KINDS: readonly P7HolderKind[] = P7_KINDS.filter(k => SPECS[k].holder) as P7HolderKind[];

/**
 * Loot surfaces of a holder: authored ones, else the MEASURED support surfaces of the runtime model (builder supportSurfaces: y,
 * x/z extent, clearance above) that can hold an item: clearance >= minClear (default 0.12 m), at least 0.16 x 0.1 m after a 2 cm inset.
 */
export function p7MeasuredSurfaces(surfaces: readonly P7Surface[], minClear = 0.12): SurfaceSpec[] {
  return surfaces.filter(s => s.clear >= minClear && s.x1 - s.x0 >= 0.2 && s.z1 - s.z0 >= 0.14)
    .map(s => ({y: s.y, x0: s.x0 + 0.02, x1: s.x1 - 0.02, z0: s.z0 + 0.02, z1: s.z1 - 0.02, clear: Math.min(0.5, s.clear - 0.02)}));
}
export const P7_SURFACES = Object.fromEntries(P7_HOLDER_KINDS.map(k => {
  const h = SPECS[k].holder!;
  return [k, h.surfaces ? [...h.surfaces] : p7MeasuredSurfaces(MODELS[k].surfaces, h.minClear)];
})) as Record<P7HolderKind, SurfaceSpec[]>;

/** Loot-table metadata for items/loot.ts (labels, category modifiers, empty chance, lot ranges). */
export const P7_HOLDER_META = {
  label: Object.fromEntries(P7_HOLDER_KINDS.map(k => [k, SPECS[k].label])) as Record<P7HolderKind, string>,
  mod: Object.fromEntries(P7_HOLDER_KINDS.map(k => [k, SPECS[k].holder!.mod])) as Record<P7HolderKind, readonly [number, number, number, number]>,
  empty: Object.fromEntries(P7_HOLDER_KINDS.map(k => [k, SPECS[k].holder!.empty])) as Record<P7HolderKind, number>,
  lots: Object.fromEntries(P7_HOLDER_KINDS.map(k => [k, SPECS[k].holder!.lots])) as Record<P7HolderKind, readonly [number, number]>,
};

/** Damage specs (damage/materials.ts PROP_DAMAGE) and model classes (MODEL_KEY_CLASS). */
export const P7_PROP_DAMAGE = Object.fromEntries(P7_KINDS.map(k => {
  const s = SPECS[k];
  const spec: PropDamageSpec = s.breaks ? {cls: s.cls, integrity: s.breaks.integrity, breaks: s.breaks.mode} : {cls: s.cls, integrity: Infinity, breaks: 'never'};
  if (s.glassFront) { spec.glass = {cls: s.glassFront.cls, integrity: s.glassFront.integrity, on: s.glassFront.cls === 'screen' ? 'dead' : 'shatter'}; spec.glassFront = s.glassFront.rect; }
  return [k, spec];
})) as Record<P7Kind, PropDamageSpec>;
export const P7_MODEL_CLASS: Readonly<Record<string, DamageClass>> = Object.fromEntries(P7_KINDS.map(k => [p7ModelKey(k), SPECS[k].cls]));

// ---------------------------------------------------------------------------------------
// Placement queries (gen/props07Dress.ts executes them)

const usesMemo = new Map<string, {kind: P7Kind; use: P7Use}[]>();
/** Area-level uses (everything but host-relative onTop / atHost) of every integrated kind for an area key (purpose id or hall key). */
export function p7UsesFor(key: string): {kind: P7Kind; use: P7Use}[] {
  let out = usesMemo.get(key);
  if (!out) {
    out = [];
    for (const kind of P7_KINDS) for (const use of SPECS[kind].uses) if (use.at !== 'onTop' && use.at !== 'atHost' && use.in.includes(key)) out.push({kind, use});
    usesMemo.set(key, out);
  }
  return out.slice();
}
const hostMemo = new Map<string, {kind: P7Kind; use: P7Use}[]>();
/** Host-relative uses (onTop decor, atHost chairs) of kinds that may go on/at `hostKind` in an area keyed `key`. */
export function p7HostUsesFor(hostKind: string, key: string): {kind: P7Kind; use: P7Use}[] {
  const mk = `${hostKind}|${key}`;
  let out = hostMemo.get(mk);
  if (!out) {
    out = [];
    for (const kind of P7_KINDS) for (const use of SPECS[kind].uses) if ((use.at === 'onTop' || use.at === 'atHost') && use.on?.includes(hostKind) && use.in.includes(key)) out.push({kind, use});
    hostMemo.set(mk, out);
  }
  return out.slice();
}
/** Integrated kinds with any use (area-level or host-relative) in an area key (tests: store fixtures follow the purpose). */
export function p7KindsFor(key: string): P7Kind[] {
  return P7_KINDS.filter(k => SPECS[k].uses.some(u => u.in.includes(key)));
}
/**
 * Fraction of the non-core, non-signature catalogue each station's palette keeps (seeded per station). Iteration 08: 0.55 -> 0.5
 * because four composition signatures (newspaper box, security podium, folding barricade, work light) became `core`.
 */
export const P7_PALETTE_KEEP = 0.5;
/** Kinds every palette keeps: station infrastructure (`core`) and purpose signatures (`lead` uses). */
export const P7_ALWAYS: ReadonlySet<string> = new Set(P7_KINDS.filter(k => SPECS[k].core || SPECS[k].uses.some(u => u.lead)));
/** A station's seeded kind palette. */
export function p7Palette(chance: (p: number) => boolean): Set<string> {
  return new Set(P7_KINDS.filter(k => P7_ALWAYS.has(k) || chance(P7_PALETTE_KEEP)));
}
/** Every purpose id / hall key some integrated kind is placed in (tests, report). */
export function p7PlacementKeys(): string[] {
  const s = new Set<string>();
  for (const k of P7_KINDS) for (const u of SPECS[k].uses) for (const i of u.in) s.add(i);
  return [...s].sort();
}

/** Lazy model keys a generated station needs (exactly the integrated kinds it placed). */
export function p7ModelKeysFor(layout: {props: readonly PropPlacement[]}): string[] {
  const s = new Set<string>();
  for (const p of layout.props) if (isP7Kind(p.kind)) s.add(p7ModelKey(p.kind));
  return [...s].sort();
}

/**
 * Removes placements whose lazy model failed to load (no box stand-ins, no invisible collision): drops them from layout.props, frees
 * their grid cells (unless another prop still covers a cell) and returns the dropped count.
 */
export function dropUnloadedP7(layout: {props: PropPlacement[]; grid: {idx(x: number, y: number): number; inBounds(x: number, y: number): boolean; blocked: Uint8Array; sightBlocked: Uint8Array}}, loaded: ReadonlySet<string>): number {
  const CELLM = 0.5;
  const gone = layout.props.filter(p => isP7Kind(p.kind) && !loaded.has(p7ModelKey(p.kind)));
  if (!gone.length) return 0;
  layout.props = layout.props.filter(p => !gone.includes(p));
  const cells = (p: PropPlacement) => { const out: number[] = []; for (let y = Math.floor((p.z - p.hz + 0.04) / CELLM); y <= Math.floor((p.z + p.hz - 0.04) / CELLM); y++) for (let x = Math.floor((p.x - p.hx + 0.04) / CELLM); x <= Math.floor((p.x + p.hx - 0.04) / CELLM); x++) if (layout.grid.inBounds(x, y)) out.push(layout.grid.idx(x, y)); return out; };
  const still = new Set<number>();
  for (const p of layout.props) if (p.host === undefined) for (const c of cells(p)) still.add(c);
  for (const p of gone) {
    if (p.host !== undefined || p.mounted) continue;   // on-top decor / wall mounts never blocked cells
    for (const c of cells(p)) if (!still.has(c)) { layout.grid.blocked[c] = 0; layout.grid.sightBlocked[c] = 0; }
  }
  return gone.length;
}

/**
 * Loot surfaces of a host minus the spans taken by on-top decor (PropPlacement.cut, host-local x ranges at the top height): the
 * finite loot of a counter / desk never interpenetrates a register or a lamp standing on it.
 */
export function cutSurfaces<T extends {y: number; x0: number; x1: number}>(surfaces: readonly T[], cut: readonly {y: number; x0: number; x1: number}[] | undefined): T[] {
  if (!cut?.length) return surfaces.slice();
  let out = surfaces.slice();
  for (const c of cut) {
    const next: T[] = [];
    for (const s of out) {
      if (Math.abs(s.y - c.y) > 0.06 || c.x1 <= s.x0 || c.x0 >= s.x1) { next.push(s); continue; }
      if (c.x0 - s.x0 >= 0.12) next.push({...s, x1: c.x0 - 0.01});
      if (s.x1 - c.x1 >= 0.12) next.push({...s, x0: c.x1 + 0.01});
    }
    out = next;
  }
  return out;
}
