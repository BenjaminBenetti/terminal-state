// Damage / destructibility material registry (iteration 06, Lane D). Pure data + lookups, no three.js:
// every bullet-hittable thing in a station maps to ONE damage class here — structural grid surfaces
// (walls / floors / ceilings / ledge faces / track bed), procedural prop parts (shape-material keys),
// purpose-prop parts (purpose material keys), generated GLB models (model keys), every prop kind
// (with its integrity and break behaviour), loose items, and zombie bodies / worn clothing slots.
// The class decides how a hit looks and sounds: hardness, chip size, fragment shape/palette, the
// exposed substrate colour, the persistent mark (crater / dent / hole / splinter / crack / tear /
// wound), how far a bullet passes through it, and whether a prop of it can fully break.
// Level-generic: new prop kinds / keys / slots only need a line here (tests check coverage).

import {PROP_DEFS, type PropKind} from '../gen/props';
import {P7_MODEL_CLASS, P7_PROP_DAMAGE} from '../gen/props07';
import {OFFICE_PROP_DAMAGE} from '../gen/office/kinds'; // Iteration 16 (WORLD-GEN)
import {BUNKER_DAMAGE_CLASS} from '../gen/reactor/complex/bunkerKinds'; // task reactor-expansion-20261101 (lane BUNKER)
import {officePropPhysics} from '../gen/office/physics'; // Task office-interactions-layout-20261030 (lane PHYS)
import {MALL_RIDER_KINDS} from '../gen/mall/kinds'; // Task mall-playtest-revision-20261031 (lane SHOPS, U05): garments ride their rail
import {SKYWAYS_FOOD_CLASS, SKYWAYS_FOOD_MODEL_CLASS, SKYWAYS_FOOD_PHYSICS} from '../items/skywaysFood'; // task studio-skyways-level-20261106-054448 (lane FOOD)
import {SKYWAYS_KITCHEN_DAMAGE_CLASS} from '../gen/skyways/kitchenKinds'; // task studio-skyways-level-20261106-054448 (lane FOOD)
import {SKYWAYS_ADDON_DAMAGE_CLASS} from '../gen/skyways/addonKinds'; // task studio-skyways-level-20261106-054448 (lane ADDON)
import {SKYWAYS_DEST_DAMAGE_CLASS} from '../gen/skyways/destinations/registry'; // task studio-skyways-destinations-20261106-170011-01
import {SKYWAYS_MAPBOARD_DAMAGE_CLASS} from '../gen/skyways/mapBoardKind'; // task studio-skyways-rework-20261107-054512-01 (lane MAPS)
import {SUBWAY_MAP_KIOSK_DAMAGE_CLASS} from '../gen/subwayMapKioskKind'; // task studio-ui-subway-maps-20261108-074144-01
import type {ShapeMat} from '../gen/propShapes';
import type {PurposeMat} from '../gen/purposeShapes';
import type {BreakCue, Surface} from '../audio/sfx';

export const DAMAGE_CLASSES = [
  'concrete', 'tile', 'terrazzo', 'plaster', 'ballast',
  'sheetMetal', 'steel', 'wood', 'glass', 'screen', 'plastic', 'laminate', 'porcelain',
  'fabric', 'cardboard', 'food',
  'flesh', 'cloth', 'rubber',
] as const;
export type DamageClass = (typeof DAMAGE_CLASSES)[number];

/** Debris piece shapes (one pooled instanced mesh each, world/damage debris.ts). */
export type DebrisShape = 'chunk' | 'shard' | 'glass' | 'splinter' | 'flake' | 'blob';
/** Persistent mark left by a hit. */
export type MarkKind = 'crater' | 'scatter' | 'dent' | 'gouge' | 'hole' | 'splinter' | 'crack' | 'tear' | 'wound';
/**
 * Prop / clothing shader mode (damage/propDamage.ts, damage/wounds.ts):
 * metal = dent ring + paint chipped to bare metal + dark hole; wood = raw splinters + hole;
 * glass = spiderweb cracks + frosting + see-through hole; screen = cracks + dead pixels;
 * plastic = stress-whitened ring + hole; laminate = chipped top layer over particleboard;
 * stone = chip crater; soft = frayed tear (fabric / cardboard / packaging); flesh/cloth/rubber = wounds.
 */
export const SHADE_MODES = ['metal', 'wood', 'glass', 'screen', 'plastic', 'laminate', 'stone', 'soft', 'flesh', 'cloth', 'rubber'] as const;
export type ShadeMode = (typeof SHADE_MODES)[number];
/** Particle style for world/fx.ts (dust / sparks / mist). */
export type FxStyle = 'concrete' | 'tile' | 'metal' | 'wood' | 'glass' | 'soft' | 'flesh';

export interface DamageMaterial {
  label: string;
  /** 0..1: harder = smaller chips / craters and more weapon damage absorbed. */
  hardness: number;
  /** Fraction of weapon damage counted against a prop's integrity. */
  vuln: number;
  /** Debris piece size range (m, longest side). */
  chip: readonly [number, number];
  /** Debris pieces per rifle hit [min, max] (pellets spawn fewer each). */
  chips: readonly [number, number];
  shape: DebrisShape;
  /** Fragment colours (sRGB) when the surface colour cannot be sampled from its texture. */
  palette: readonly number[];
  /** Exposed substrate inside chips / holes (sRGB): cement under glaze, grey block under paint, raw wood… */
  substrate: number;
  /** Dust puff colour (sRGB) or null. */
  dust: number | null;
  sparks: number;
  mark: MarkKind;
  /** Mark radius per rifle hit (m) and the largest repeated hits can grow it to. */
  markSize: number;
  markMax: number;
  /** Bullet line length through the material (m) for shader damage: thin panels pass through (exit holes). */
  pierce: number;
  shade: ShadeMode;
  /** Impact sound surface (audio/sfx.ts) and the cue played when a part of it breaks. */
  sound: Surface;
  breakSound: BreakCue | null;
  fx: FxStyle;
}

const M = (o: DamageMaterial) => o;

export const DAMAGE_MATERIALS: Record<DamageClass, DamageMaterial> = {
  // --- structural (chip only: persistent craters, no voxel collapse) --------------------------
  concrete: M({label: 'concrete', hardness: 0.85, vuln: 0.15, chip: [0.012, 0.045], chips: [2, 5], shape: 'chunk', palette: [0x8b867b, 0x77736a, 0x9d978a], substrate: 0xa29b8c, dust: 0xa69a86, sparks: 0, mark: 'crater', markSize: 0.052, markMax: 0.3, pierce: 0.05, shade: 'stone', sound: 'concrete', breakSound: 'debrisFall', fx: 'concrete'}),
  tile: M({label: 'glazed tile over mortar', hardness: 0.75, vuln: 0.2, chip: [0.015, 0.05], chips: [2, 5], shape: 'shard', palette: [0xd9d3c3, 0xc9c3b2, 0x3a3d3c], substrate: 0x8f897c, dust: 0xd8d4c8, sparks: 0, mark: 'crater', markSize: 0.062, markMax: 0.32, pierce: 0.04, shade: 'stone', sound: 'tile', breakSound: 'debrisFall', fx: 'tile'}),
  terrazzo: M({label: 'terrazzo', hardness: 0.9, vuln: 0.12, chip: [0.01, 0.035], chips: [2, 5], shape: 'chunk', palette: [0xb9b2a4, 0x9c968a, 0xd4cdbd], substrate: 0x857f73, dust: 0xbab3a4, sparks: 0, mark: 'crater', markSize: 0.045, markMax: 0.24, pierce: 0.04, shade: 'stone', sound: 'tile', breakSound: 'debrisFall', fx: 'tile'}),
  plaster: M({label: 'plaster / painted block', hardness: 0.55, vuln: 0.3, chip: [0.015, 0.06], chips: [3, 6], shape: 'flake', palette: [0xbdb7a8, 0xa9a394, 0xd0c9b8], substrate: 0xc8c1b0, dust: 0xc9c2b2, sparks: 0, mark: 'crater', markSize: 0.068, markMax: 0.36, pierce: 0.05, shade: 'stone', sound: 'concrete', breakSound: 'debrisFall', fx: 'concrete'}),
  ballast: M({label: 'track ballast', hardness: 0.95, vuln: 0, chip: [0.02, 0.05], chips: [2, 4], shape: 'chunk', palette: [0x5c5852, 0x6e6a62, 0x4a4743], substrate: 0x3a3733, dust: 0x77716a, sparks: 1, mark: 'scatter', markSize: 0.05, markMax: 0.12, pierce: 0.02, shade: 'stone', sound: 'concrete', breakSound: null, fx: 'concrete'}),
  // --- props -----------------------------------------------------------------------------
  sheetMetal: M({label: 'painted sheet metal', hardness: 0.45, vuln: 0.35, chip: [0.006, 0.02], chips: [0, 2], shape: 'flake', palette: [0x5a5d5c, 0x8a8c88], substrate: 0xa8aaa6, dust: 0x77736c, sparks: 5, mark: 'hole', markSize: 0.03, markMax: 0.11, pierce: 1.2, shade: 'metal', sound: 'sheet', breakSound: null, fx: 'metal'}),
  steel: M({label: 'structural steel', hardness: 0.95, vuln: 0.08, chip: [0.004, 0.012], chips: [0, 1], shape: 'flake', palette: [0x4a4d4f, 0x6c6e6c], substrate: 0xb4b6b2, dust: 0x6f6b64, sparks: 8, mark: 'gouge', markSize: 0.026, markMax: 0.08, pierce: 0.04, shade: 'metal', sound: 'metal', breakSound: null, fx: 'metal'}),
  wood: M({label: 'wood', hardness: 0.4, vuln: 1, chip: [0.03, 0.11], chips: [3, 6], shape: 'splinter', palette: [0x7a5a3a, 0x8f6c46, 0x5e4430], substrate: 0xc4a274, dust: 0x8a6a48, sparks: 0, mark: 'splinter', markSize: 0.04, markMax: 0.13, pierce: 0.9, shade: 'wood', sound: 'wood', breakSound: 'breakWood', fx: 'wood'}),
  glass: M({label: 'glass', hardness: 0.6, vuln: 1, chip: [0.01, 0.05], chips: [3, 6], shape: 'glass', palette: [0xc9d8dc, 0xe2ecee, 0xa9bfc4], substrate: 0xf0f4f4, dust: null, sparks: 0, mark: 'crack', markSize: 0.05, markMax: 0.3, pierce: 0.06, shade: 'glass', sound: 'glass', breakSound: 'breakGlass', fx: 'glass'}),
  screen: M({label: 'display screen', hardness: 0.6, vuln: 1, chip: [0.008, 0.03], chips: [2, 4], shape: 'glass', palette: [0x1c2226, 0x2c3438, 0xc9d8dc], substrate: 0x0c0e10, dust: null, sparks: 3, mark: 'crack', markSize: 0.05, markMax: 0.22, pierce: 0.05, shade: 'screen', sound: 'glass', breakSound: 'breakGlass', fx: 'glass'}),
  plastic: M({label: 'plastic', hardness: 0.35, vuln: 0.8, chip: [0.01, 0.04], chips: [2, 4], shape: 'shard', palette: [0x2b2d30, 0xc98a2a, 0x8a8f94], substrate: 0xe0ddd4, dust: 0x8f8a82, sparks: 0, mark: 'hole', markSize: 0.03, markMax: 0.1, pierce: 0.6, shade: 'plastic', sound: 'wood', breakSound: null, fx: 'soft'}),
  laminate: M({label: 'laminate over particleboard', hardness: 0.45, vuln: 0.6, chip: [0.01, 0.05], chips: [3, 5], shape: 'flake', palette: [0xe2ddd3, 0xcfc8ba, 0x9a8466], substrate: 0x9a7e58, dust: 0x9b8a70, sparks: 0, mark: 'splinter', markSize: 0.04, markMax: 0.12, pierce: 0.35, shade: 'laminate', sound: 'wood', breakSound: 'breakWood', fx: 'wood'}),
  porcelain: M({label: 'porcelain', hardness: 0.8, vuln: 0.5, chip: [0.012, 0.045], chips: [3, 5], shape: 'shard', palette: [0xeeece6, 0xdcd9d0], substrate: 0xcfc9bb, dust: 0xdedad0, sparks: 0, mark: 'crack', markSize: 0.05, markMax: 0.16, pierce: 0.05, shade: 'stone', sound: 'tile', breakSound: 'debrisFall', fx: 'tile'}),
  fabric: M({label: 'fabric / upholstery', hardness: 0.1, vuln: 0.7, chip: [0.01, 0.035], chips: [2, 4], shape: 'flake', palette: [0x5a4e44, 0x6e6458, 0xd8d0bc], substrate: 0xd9d2c0, dust: 0xbdb4a2, sparks: 0, mark: 'tear', markSize: 0.04, markMax: 0.14, pierce: 0.5, shade: 'soft', sound: 'flesh', breakSound: null, fx: 'soft'}),
  cardboard: M({label: 'cardboard / paper', hardness: 0.15, vuln: 1.2, chip: [0.015, 0.06], chips: [3, 6], shape: 'flake', palette: [0xa8865a, 0x8f704a, 0xc9b28a], substrate: 0x7a5e3c, dust: 0xa89474, sparks: 0, mark: 'tear', markSize: 0.045, markMax: 0.16, pierce: 1.0, shade: 'soft', sound: 'wood', breakSound: 'breakWood', fx: 'soft'}),
  food: M({label: 'food / packaging', hardness: 0.1, vuln: 1, chip: [0.01, 0.04], chips: [3, 6], shape: 'flake', palette: [0xc0392b, 0xd9a520, 0xe8e4da, 0x3f7d4a], substrate: 0x8a6a3a, dust: 0xc4b48c, sparks: 0, mark: 'tear', markSize: 0.04, markMax: 0.14, pierce: 0.5, shade: 'soft', sound: 'wood', breakSound: null, fx: 'soft'}),
  // --- zombies (wounds; damage itself is the brain's HP) ------------------------------------
  flesh: M({label: 'flesh', hardness: 0.05, vuln: 1, chip: [0.012, 0.04], chips: [1, 3], shape: 'blob', palette: [0x4a0c08, 0x5e1712, 0x3a0806], substrate: 0x4e0f0b, dust: null, sparks: 0, mark: 'wound', markSize: 0.042, markMax: 0.13, pierce: 0.18, shade: 'flesh', sound: 'flesh', breakSound: 'fleshTear', fx: 'flesh'}),
  cloth: M({label: 'worn clothing', hardness: 0.08, vuln: 1, chip: [0.012, 0.035], chips: [1, 2], shape: 'flake', palette: [0x3a3d3a, 0x4f4a42, 0x2f3540], substrate: 0x6e6a5e, dust: null, sparks: 0, mark: 'wound', markSize: 0.045, markMax: 0.14, pierce: 0.18, shade: 'cloth', sound: 'flesh', breakSound: 'fleshTear', fx: 'flesh'}),
  rubber: M({label: 'rubber / gas mask', hardness: 0.25, vuln: 1, chip: [0.008, 0.025], chips: [1, 2], shape: 'flake', palette: [0x1e2020, 0x2c2e2c], substrate: 0x0e0f0f, dust: null, sparks: 0, mark: 'wound', markSize: 0.035, markMax: 0.1, pierce: 0.12, shade: 'rubber', sound: 'flesh', breakSound: 'fleshTear', fx: 'flesh'}),
};

// ---------------------------------------------------------------------------------------
// Structural surfaces (world/materials.ts MatKey + storefront interior keys)

/** Structural material keys a grid surface can carry (builder.ts rules). */
export const STRUCTURAL_KEYS = [
  'tileLower', 'tileUpper', 'paint', 'terrazzo', 'concrete', 'platformSlab', 'safetyEdge', 'platformFace',
  'ceiling', 'ceilingService', 'tunnel', 'ballast', 'tileShop', 'quarryTile', 'stairs',
] as const;
export type StructuralKey = (typeof STRUCTURAL_KEYS)[number];

export const STRUCTURAL_CLASS: Record<StructuralKey, DamageClass> = {
  tileLower: 'tile', tileUpper: 'tile', paint: 'plaster', terrazzo: 'terrazzo', concrete: 'concrete', platformSlab: 'concrete',
  safetyEdge: 'concrete', platformFace: 'concrete', ceiling: 'plaster', ceilingService: 'concrete', tunnel: 'concrete', ballast: 'ballast',
  tileShop: 'tile', quarryTile: 'tile', stairs: 'concrete',
};

/** Every world/materials.ts MatKey (trim, track, legacy prop materials) -> class. */
export const WORLD_MAT_CLASS: Record<string, DamageClass> = {
  ...STRUCTURAL_CLASS, steel: 'steel', rail: 'steel', sleeper: 'wood', coverboard: 'plastic', crate: 'wood', bin: 'sheetMetal', gate: 'steel', tube: 'glass',
  tileBase: 'tile', // Iteration 12 (ARCH): raked charcoal skirting of stair-flight walls (world/materials.ts)
};

// ---------------------------------------------------------------------------------------
// Prop parts: shape-material keys (procedural props / storefront blocks) and purpose keys

export const SHAPE_KEY_CLASS: Record<ShapeMat, DamageClass> = {
  steelDark: 'sheetMetal', steelBright: 'steel', accent: 'sheetMetal', counter: 'laminate', panel: 'sheetMetal', glass: 'glass', screen: 'screen',
  vendFront: 'screen', porcelain: 'porcelain', partition: 'laminate', concrete: 'concrete', grille: 'steel', black: 'plastic', wood: 'wood',
  mirror: 'glass', shutter: 'sheetMetal', shopFrame: 'steel', signBand: 'plastic', menuBoard: 'screen', shutterSteel: 'sheetMetal',
  kitchenSteel: 'steel', laminate: 'laminate', tileShop: 'tile', quarryTile: 'tile', woodVeneer: 'wood', plasticSeat: 'plastic',
  glassShopfront: 'glass', menuBoardNoodle: 'screen', menuBoardCoffee: 'screen', menuBoardPizza: 'screen',
  lanternGlow: 'glass', // lane HIDEOUT (round 3): the lantern mantle behind its globe
};

export const PURPOSE_KEY_CLASS: Record<PurposeMat, DamageClass> = {
  stockSnacks: 'food', stockGrocery: 'food', stockPharmacy: 'cardboard', stockCleaning: 'plastic', stockDevices: 'plastic', stockCartons: 'cardboard', stockParts: 'sheetMetal',
  magazines: 'cardboard', deviceScreen: 'screen', cctv: 'screen', noticeBoard: 'cardboard', cardboard: 'cardboard', keyBlanks: 'steel', flowers: 'food', bread: 'food', donuts: 'food',
  pizzaBox: 'cardboard', fruit: 'food', hazardLabel: 'sheetMetal', firstAid: 'sheetMetal', vinyl: 'fabric',
  paintRed: 'sheetMetal', paintYellow: 'sheetMetal', paintGreen: 'sheetMetal', paintWhite: 'sheetMetal', paintBlue: 'sheetMetal', paintOrange: 'sheetMetal',
};

/** Class of a prop-part material key (shape key, purpose key, `menuBoard:<use>`, or a GLB material name). */
export function partKeyClass(key: string, fallback: DamageClass): DamageClass {
  if (key in SHAPE_KEY_CLASS) return SHAPE_KEY_CLASS[key as ShapeMat];
  if (key in PURPOSE_KEY_CLASS) return PURPOSE_KEY_CLASS[key as PurposeMat];
  if (key.startsWith('menuBoard')) return 'screen';
  if (/glass|mirror|window/i.test(key)) return 'glass';
  if (/screen|monitor|display-face|cctv/i.test(key)) return 'screen';
  return fallback;
}

// ---------------------------------------------------------------------------------------
// Generated GLB models (assets/manifest.ts ModelKey)

export const MODEL_KEY_CLASS: Record<string, DamageClass> = {
  rifle: 'steel', shotgun: 'steel', pistol: 'steel', knife: 'steel', bench: 'sheetMetal', light: 'sheetMetal', cabinetTall: 'sheetMetal', cabinetLow: 'sheetMetal', sign: 'sheetMetal',
  crate: 'wood', turnstile: 'steel', shelf: 'steel', vending: 'sheetMetal', stall: 'sheetMetal',
  item_water: 'plastic', item_cola: 'sheetMetal', item_juice: 'cardboard', item_chocolate: 'food', item_chips: 'food', item_beans: 'sheetMetal', item_noodles: 'food',
  item_bread: 'food', // lane FURN (office-props-physics-scale-20261030): the bakery loaf
  ...SKYWAYS_FOOD_MODEL_CLASS, // task studio-skyways-level-20261106-054448 (lane FOOD): ceramic ramen bowls, the bento tray, the tea cup
  item_ammo_9mm: 'cardboard', item_ammo_556: 'sheetMetal', item_ammo_12ga: 'cardboard', // lane AMMO (knife-melee-20261030): Meshy T2.5 ammo boxes
  trashCan: 'sheetMetal', shopCounter: 'laminate', shopBackbar: 'steel', shopCooler: 'sheetMetal', shopDisplay: 'steel',
  janitorCart: 'plastic', magazineRack: 'steel', techDisplay: 'laminate', hotdogCart: 'steel', gunLocker: 'sheetMetal',
  // Iteration 07 (Lane P2): generated props p7_<kind> (class per type in gen/props07.ts).
  ...P7_MODEL_CLASS,
};

/** Model key -> class; zombie bodies are flesh, wardrobe wearables (outfit_*) cloth unless named rubber/hard. */
export function modelClass(key: string): DamageClass {
  if (key in MODEL_KEY_CLASS) return MODEL_KEY_CLASS[key];
  if (key.startsWith('zombieBody_') || key === 'zombie') return 'flesh';
  if (key.startsWith('outfit_')) return wearableClass(key.slice('outfit_'.length));
  return 'sheetMetal';
}

// ---------------------------------------------------------------------------------------
// Prop kinds: body class, integrity and break behaviour

/** What a fully broken prop does. 'never' = it only accumulates staged local damage. */
export type BreakMode = 'never' | 'splinter' | 'collapse';
/** Glass / screen parts: 'shatter' (hidden + shards), 'dead' (screen goes dark), 'open' (vending front gives way). */
export type GlassBreak = 'shatter' | 'dead' | 'open';

export interface PropDamageSpec {
  cls: DamageClass;
  /** Body integrity in weapon damage points (Infinity: stages only, never fully breaks). */
  integrity: number;
  breaks: BreakMode;
  /** Glass / screen parts of the prop and what happens when they break. */
  glass?: {cls: 'glass' | 'screen'; integrity: number; on: GlassBreak};
  /**
   * Model-baked glass (no separate glass mesh): front-face region in prop-local fractions
   * [x0, x1, y0, y1] of width / height (front = +Z local).
   */
  glassFront?: readonly [number, number, number, number];
}

const NEVER = (cls: DamageClass, glass?: PropDamageSpec['glass']): PropDamageSpec => ({cls, integrity: Infinity, breaks: 'never', ...(glass ? {glass} : {})});
const SHATTER = (integrity: number): PropDamageSpec['glass'] => ({cls: 'glass', integrity, on: 'shatter'});
const SCREEN = (integrity: number): PropDamageSpec['glass'] => ({cls: 'screen', integrity, on: 'dead'});

export const PROP_DAMAGE: Record<PropKind, PropDamageSpec> = {
  bench: NEVER('sheetMetal'), cabinetTall: NEVER('sheetMetal'), cabinetLow: NEVER('sheetMetal'), column: NEVER('steel'),
  // Wooden crate: splinters apart; its finite contents stay where they lay (takeable).
  crate: {cls: 'wood', integrity: 110, breaks: 'splinter'},
  bin: NEVER('sheetMetal'), fareGate: NEVER('steel'), stall: NEVER('sheetMetal'),
  // Vending: glass front (baked into the model) cracks, then gives way like a pry (contents spill, nothing re-rolled).
  // glass front of vending-t25.glb (Meshy T2.5, ray-cast 2026-10-29): x -0.41..0.24 m, y 0.48..1.78 m (iteration 03: [-0.45, 0.25, 0.3, 0.92])
  vending: {...NEVER('sheetMetal', {cls: 'glass', integrity: 75, on: 'open'}), glassFront: [-0.43, 0.25, 0.26, 0.96]},
  shelf: NEVER('steel'), table: NEVER('laminate'), desk: NEVER('laminate', SCREEN(20)), booth: NEVER('sheetMetal', SHATTER(40)),
  ticketMachine: NEVER('sheetMetal', SCREEN(25)), exitStair: NEVER('concrete'), toiletStall: NEVER('laminate'),
  washCounter: NEVER('laminate', SHATTER(35)),
  shopCounter: NEVER('laminate'), shopDisplay: NEVER('steel', SHATTER(35)), shopBackbar: NEVER('steel'), shopCooler: NEVER('sheetMetal', SHATTER(45)),
  // Shopfront glazing: the panes shatter; the 0.3 m plinth stays solid (jump through), bullets and sight pass.
  shopGlazing: NEVER('steel', SHATTER(40)), shopShutter: NEVER('sheetMetal'),
  // Task track2-playtest-revision (lane ROOMS): annex machinery (boilers, gensets, turbines, fans, channel curbs / basin parapets):
  // heavy steel / concrete plant — sparks and dents, never breaks (no destructibility system implied).
  annexMachine: NEVER('steel'),
  stockShelf: NEVER('steel'), snackRack: NEVER('steel'), magazineRack: NEVER('steel'), techDisplay: NEVER('laminate', SCREEN(25)),
  deviceWall: NEVER('laminate', SCREEN(25)), showcase: NEVER('steel', SHATTER(35)), flowerStand: NEVER('wood'), repairBench: NEVER('wood'),
  hotdogCart: NEVER('steel'), grillLine: NEVER('steel'), pizzaOven: NEVER('steel'), espressoBar: NEVER('steel'), wokLine: NEVER('steel'),
  deliLine: NEVER('steel', SHATTER(30)), blenderBar: NEVER('steel'), breadRack: NEVER('steel'), staffLockers: NEVER('sheetMetal'),
  kitchenette: NEVER('laminate'), fridge: NEVER('sheetMetal'), couch: NEVER('fabric'), noticeBoard: NEVER('cardboard'), janitorCart: NEVER('plastic'),
  mopSink: NEVER('plastic'), electricalPanel: NEVER('sheetMetal'), gunLocker: NEVER('sheetMetal'), monitorDesk: NEVER('laminate', SCREEN(25)),
  medCabinet: NEVER('sheetMetal'), safe: NEVER('steel'), signalRack: NEVER('sheetMetal'),
  // Carton stack (decor): cardboard collapses into a low heap of flattened boxes.
  cartonStack: {cls: 'cardboard', integrity: 80, breaks: 'collapse'},
  // Task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a survivor's camp bed (mattress + bedding on pallets): soft, never breaks
  palletBed: NEVER('fabric'),
  // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the survivor hideout — bedroll (soft bedding), camp table (a door on
  // cinder blocks), wooden footlocker, lantern and camp stove (sheet steel): dents / splinter marks, never break (no destructibility)
  bedroll: NEVER('fabric'), campTable: NEVER('wood'), footlocker: NEVER('wood'), campLantern: NEVER('sheetMetal'), campStove: NEVER('sheetMetal'),
  // Iteration 07 (Lane P2): generated prop types (class / breaks per type in gen/props07.ts).
  ...P7_PROP_DAMAGE,
  // Iteration 16 (WORLD-GEN): office tower furniture (gen/office/kinds.ts).
  ...OFFICE_PROP_DAMAGE,
  // task reactor-expansion-20261101 (lane BUNKER): the bunker's hero props (bunks, radio console, filtration unit, blast door): never break
  ...(Object.fromEntries(Object.entries(BUNKER_DAMAGE_CLASS).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof BUNKER_DAMAGE_CLASS, PropDamageSpec>),
  // task studio-skyways-level-20261106-054448 (lane FOOD): the ramen restaurant's range / cookware / figurine — dents, chips, never breaks
  ...(Object.fromEntries(Object.entries(SKYWAYS_KITCHEN_DAMAGE_CLASS).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof SKYWAYS_KITCHEN_DAMAGE_CLASS, PropDamageSpec>),
  // task studio-skyways-level-20261106-054448 (lane ADDON): the add-on's stage / merch / boards / statues / stanchions — marks only, never break
  ...(Object.fromEntries(Object.entries(SKYWAYS_ADDON_DAMAGE_CLASS).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof SKYWAYS_ADDON_DAMAGE_CLASS, PropDamageSpec>),
  ...(Object.fromEntries(Object.entries(SKYWAYS_DEST_DAMAGE_CLASS as Record<string, DamageClass>).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof SKYWAYS_DEST_DAMAGE_CLASS, PropDamageSpec>), // (destinations)
  ...(Object.fromEntries(Object.entries(SKYWAYS_MAPBOARD_DAMAGE_CLASS).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof SKYWAYS_MAPBOARD_DAMAGE_CLASS, PropDamageSpec>), // (lane MAPS: the directory board — marks only)
  ...(Object.fromEntries(Object.entries(SUBWAY_MAP_KIOSK_DAMAGE_CLASS).map(([k, c]) => [k, NEVER(c)])) as Record<keyof typeof SUBWAY_MAP_KIOSK_DAMAGE_CLASS, PropDamageSpec>), // (task studio-ui-subway-maps-20261108-074144-01: the map kiosk — marks only)
};

/** Spec for any prop kind (unknown future kinds: painted sheet metal, never breaks). */
export function propDamageSpec(kind: string): PropDamageSpec {
  return (PROP_DAMAGE as Record<string, PropDamageSpec | undefined>)[kind] ?? NEVER('sheetMetal');
}

/** Every prop kind that exists in gen/props.ts (coverage tests). */
export const ALL_PROP_KINDS = Object.keys(PROP_DEFS) as PropKind[];

// ---------------------------------------------------------------------------------------
// Loose items / loot lots (never destroyed: knocked about only)

export const ITEM_CLASS: Record<string, DamageClass> = {
  rifle: 'steel', shotgun: 'steel', pistol: 'steel', knife: 'steel', ammo_556: 'sheetMetal', ammo_12ga: 'cardboard', ammo_9mm: 'cardboard', medkit: 'plastic', bandage: 'fabric', // lane AMMO: 5.56 steel can
  water: 'plastic', cola: 'sheetMetal', juice: 'cardboard', chocolate: 'food', chips: 'food', beans: 'sheetMetal', noodles: 'food',
  bread: 'food', // lane FURN (office-props-physics-scale-20261030)
  ...SKYWAYS_FOOD_CLASS, // task studio-skyways-level-20261106-054448 (lane FOOD): ceramic ramen bowls (porcelain), bento / tea cup (plastic)
  battery: 'sheetMetal', flare: 'cardboard', // Iteration 12 (LIGHT): steel-jacketed D cell; waxed-paper road flare
  leg_splint: 'plastic', arm_sling: 'fabric', trauma_kit: 'fabric', // Iteration 16 (lane INJURY): foam splint roll; sling packet; nylon pouch
  // Iteration 16 (primary, for lane GEAR's items): soft armor / nylon / boots / gloves = fabric; the hard hat = plastic
  armor_vest: 'fabric', chest_rig: 'fabric', backpack: 'fabric', helmet: 'plastic', boots: 'fabric', gloves: 'fabric',
  gas_mask: 'rubber', gas_filter: 'sheetMetal', // task gasmask-breach-20261030 (mask lane): rubber full-face mask; painted steel filter canister
  fuel_can: 'sheetMetal', // task train-fuel-system: a pressed-steel jerrycan
  airtank_backpack: 'steel', // task filter-tension-airtank: a steel air cylinder on a tubular frame (the harness is the minor part)
  // Task office-props-physics-scale-20261030 (lane RACK): crafting materials — circuit board + wire bundle; bent steel; plastic specimen jar
  electrical_parts: 'plastic', scrap_metal: 'sheetMetal', bio_mater: 'plastic',
  reactor_key: 'steel', fuse_cartridge: 'porcelain', // task reactor-build-20261101 (lane RESTART): brass key on a fob; ceramic HRC fuse cartridge
  rail_ties: 'wood', // task studio-market-rework-20261108-074144-01 (lane TRADE): a strapped bundle of creosoted tie offcuts (the sleeper's class)
  // task studio-market-bar-20261108-225231-01: the bar's beers — brown glass long-necks
  beer_lager: 'glass', beer_pilsner: 'glass', beer_stout: 'glass', beer_porter: 'glass', beer_bock: 'glass',
};
export function itemClass(itemId: string): DamageClass {
  return ITEM_CLASS[itemId] ?? 'plastic';
}

// ---------------------------------------------------------------------------------------
// Iteration 07 (Lane K): rigid-body physics of loose items, light props and chunks
// (physics/dynamicItems.ts, physics/chunks.ts). Pure data.

/**
 * Contact / sound family of a rigid body (cannon contact material vs the static station). Task office-interactions-layout-20261030
 * (lane PHYS): + `castor` (wheeled furniture: office / executive chairs, mobile whiteboard, clothing rail, camera pedestal, vitals
 * stand) and `pad` (other loose office furniture: feet / fabric / pot bases on carpet). Task office-props-physics-scale-20261030
 * (lane PHYS): the Subway's light kinds use them too (SUBWAY_CONTACT: suitcases / strollers / wheelchairs roll, chairs / signs /
 * bags slide on pads), so walking into one shoves it in every world.
 */
export type PhysMat = 'metal' | 'plastic' | 'soft' | 'heavy' | 'stone' | 'wood' | 'glass' | 'flesh' | 'cloth' | 'castor' | 'pad';
/**
 * Friction / restitution against the station (floors, walls, prop boxes, holder shelves).
 * Lane PHYS — CALIBRATED office materials: cannon-es (GSSolver) clamps each friction equation's IMPULSE by μ·m·g (a force), so per
 * 1/60 s step a contact resists ~60x the Coulomb impulse (x ~4 corner contacts of a box on the floor): with the iteration-07 values
 * a shot or shoved box never slides, it only rocks / tips (fine for cans and bins, wrong for a castor chair). `castor` / `pad` are
 * Coulomb μ / ~240 so a body decelerates at ~μ·g: castors ≈ μ 0.15 (a chair coasts ~15 cm under buckshot and rolls ahead of the
 * walker), pads ≈ μ 0.3. The iteration-07 values stay as they are (task office-props-physics-scale-20261030: the Subway's light
 * kinds now use castor / pad too, SUBWAY_CONTACT, the trash can included; chunks / items keep the iteration-07 materials).
 */
export const PHYS_MATS: Readonly<Record<PhysMat, {friction: number; restitution: number}>> = {
  metal: {friction: 0.32, restitution: 0.34}, plastic: {friction: 0.42, restitution: 0.3}, soft: {friction: 0.7, restitution: 0.08},
  heavy: {friction: 0.55, restitution: 0.1}, stone: {friction: 0.7, restitution: 0.2}, wood: {friction: 0.6, restitution: 0.24},
  glass: {friction: 0.45, restitution: 0.14}, flesh: {friction: 0.95, restitution: 0.02}, cloth: {friction: 0.98, restitution: 0},
  castor: {friction: 0.0005, restitution: 0.1}, pad: {friction: 0.0012, restitution: 0.1}, // lane PHYS (calibrated, see above)
};
/**
 * Task office-interactions-layout-20261030 (lane PHYS): why a prop kind stays static (damage/physicsAudit.ts PROP_PHYSICS_AUDIT;
 * docs/prop-affordances.md): a loot holder that does not spill, bolted / anchored, built into the fit-out, too heavy to shove
 * with a body bump, a wall / ceiling fixture, a partition system, mounted, standing on a host, building structure, machinery —
 * or `kept`: a Subway kind whose iteration-07 class this pass deliberately leaves unchanged (Subway behaviour / goldens frozen)
 * although it could move; listed so a later Subway pass sees it.
 */
/** (lane HIDEOUT, round 3) 'flat': soft bedding / covering lying flat on the floor — no rigid body to shove or tip (the hideout bedroll). */
export type StaticWhy = 'holder' | 'anchored' | 'built-in' | 'too heavy' | 'fixture' | 'partition' | 'mounted' | 'host decor' | 'structure' | 'machinery' | 'kept' | 'flat';

export interface ItemPhysics {
  /** Mass (kg) of one loose item (a full can, a box of rounds). */
  mass: number;
  /** Collider in the item's model frame (origin bottom-centre): upright cylinder (cans, bottles, cups) or box. */
  shape: 'cylinder' | 'box';
  mat: PhysMat;
}

/** Loose items / loot lots that react to bullets (every inventory item; unknown ids: a light box). */
export const ITEM_PHYSICS: Record<string, ItemPhysics> = {
  cola: {mass: 0.37, shape: 'cylinder', mat: 'metal'}, beans: {mass: 0.45, shape: 'cylinder', mat: 'metal'},
  water: {mass: 0.55, shape: 'cylinder', mat: 'plastic'}, noodles: {mass: 0.09, shape: 'cylinder', mat: 'soft'},
  juice: {mass: 0.3, shape: 'box', mat: 'soft'}, chocolate: {mass: 0.1, shape: 'box', mat: 'soft'}, chips: {mass: 0.16, shape: 'box', mat: 'soft'},
  bread: {mass: 0.45, shape: 'box', mat: 'soft'}, // lane FURN (office-props-physics-scale-20261030): a stale round loaf
  ...SKYWAYS_FOOD_PHYSICS, // task studio-skyways-level-20261106-054448 (lane FOOD): full ramen bowls ~1 kg, bento ~0.5 kg, bubble tea ~0.6 kg
  ammo_556: {mass: 0.9, shape: 'box', mat: 'metal'}, ammo_12ga: {mass: 0.7, shape: 'box', mat: 'soft'}, ammo_9mm: {mass: 0.5, shape: 'box', mat: 'soft'}, // lane AMMO: small steel 5.56 can
  medkit: {mass: 0.6, shape: 'box', mat: 'plastic'}, bandage: {mass: 0.08, shape: 'box', mat: 'soft'},
  rifle: {mass: 3.4, shape: 'box', mat: 'heavy'}, shotgun: {mass: 3.6, shape: 'box', mat: 'heavy'}, pistol: {mass: 0.9, shape: 'box', mat: 'heavy'},
  knife: {mass: 0.32, shape: 'box', mat: 'metal'}, // lane KNIFE: ~0.32 m survival knife, steel blade + rubber grip
  // Iteration 12 (LIGHT): D cell ~140 g (upright cylinder); road flare ~220 g lying along X (box collider when shot as a pickup)
  battery: {mass: 0.14, shape: 'cylinder', mat: 'metal'}, flare: {mass: 0.22, shape: 'box', mat: 'soft'},
  // Iteration 16 (lane INJURY): rolled SAM splint ~120 g, sling + wrap packet ~150 g, trauma pouch ~0.7 kg
  leg_splint: {mass: 0.12, shape: 'box', mat: 'soft'}, arm_sling: {mass: 0.15, shape: 'box', mat: 'soft'}, trauma_kit: {mass: 0.7, shape: 'box', mat: 'cloth'},
  // Iteration 16 (primary, lane GEAR's items): soft vest ~2 kg, rig ~1 kg, empty daypack ~0.8 kg, hard hat ~0.4 kg, boots ~1.6 kg, gloves ~0.2 kg
  armor_vest: {mass: 2.0, shape: 'box', mat: 'cloth'}, chest_rig: {mass: 1.0, shape: 'box', mat: 'cloth'}, backpack: {mass: 0.8, shape: 'box', mat: 'cloth'},
  helmet: {mass: 0.4, shape: 'box', mat: 'soft'}, boots: {mass: 1.6, shape: 'box', mat: 'soft'}, gloves: {mass: 0.2, shape: 'box', mat: 'cloth'},
  // task gasmask-breach-20261030 (mask lane): full-face mask ~0.6 kg (rubber), 40 mm filter canister ~0.25 kg (steel)
  gas_mask: {mass: 0.6, shape: 'box', mat: 'soft'}, gas_filter: {mass: 0.25, shape: 'cylinder', mat: 'metal'},
  fuel_can: {mass: 4.5, shape: 'box', mat: 'metal'}, // task fuel-feedback: a full ~5 l can, med-kit sized (~4 kg of fuel + the thin pressed-steel shell)
  // task filter-tension-airtank: a charged ~6 l steel cylinder (~7 kg) + aluminium frame and harness (~2 kg)
  airtank_backpack: {mass: 9, shape: 'box', mat: 'metal'},
  // Task office-props-physics-scale-20261030 (lane RACK): board + relays + wire coil ~0.35 kg; bent brackets / plate / rail ~1.1 kg;
  // a filled 0.4 l specimen jar ~0.35 kg (upright cylinder)
  electrical_parts: {mass: 0.35, shape: 'box', mat: 'plastic'}, scrap_metal: {mass: 1.1, shape: 'box', mat: 'metal'},
  bio_mater: {mass: 0.35, shape: 'cylinder', mat: 'plastic'},
  // task reactor-build-20261101 (lane RESTART): key + ring + fob ~50 g; a 0.3 m sand-filled ceramic HRC cartridge ~0.9 kg
  reactor_key: {mass: 0.05, shape: 'box', mat: 'metal'}, fuse_cartridge: {mass: 0.9, shape: 'box', mat: 'stone'},
  // task studio-market-rework-20261108-074144-01 (lane TRADE): four creosoted offcuts, ~11 l of hardwood at ~0.75 kg/l, + two steel straps
  rail_ties: {mass: 8.5, shape: 'box', mat: 'wood'},
  // task studio-market-bar-20261108-225231-01: a full 330 ml long-neck ~0.55 kg (glass ~0.2 + beer), an upright cylinder
  beer_lager: {mass: 0.55, shape: 'cylinder', mat: 'glass'}, beer_pilsner: {mass: 0.55, shape: 'cylinder', mat: 'glass'},
  beer_stout: {mass: 0.55, shape: 'cylinder', mat: 'glass'}, beer_porter: {mass: 0.55, shape: 'cylinder', mat: 'glass'},
  beer_bock: {mass: 0.55, shape: 'cylinder', mat: 'glass'},
};
export function itemPhysics(itemId: string): ItemPhysics {
  return ITEM_PHYSICS[itemId] ?? {mass: 0.3, shape: 'box', mat: 'plastic'};
}

/**
 * Per prop KIND rigid-body flags. `dynamic` props become rigid bodies when shot (bins rock / tip /
 * slide, walkers shove them); everything else (heavy, fixed, loot holders) stays static. New prop
 * kinds (iteration 07 Lane P2) either add a line here or give their PROP_DEFS entry an optional
 * `physics: {mass, dynamic, shape?}` field (read first).
 */
export interface PropPhysics {
  mass: number; dynamic: boolean; shape?: 'box' | 'cylinder'; mat?: PhysMat;
  /** Lane PHYS: may also go loose while resting on its (static) host's top face (an office monitor on a desk). */
  onHost?: boolean;
  /**
   * Lane PHYS: collider footprint scale (w / d) vs the prop box — chairs: the box includes the armrests / star base and the
   * dressing tucks the seat under its desk, so the full box would start inside the desk (absent = 1).
   */
  fit?: number;
  /**
   * Lane PHYS: walking into it wakes it (physics/dynamicItems.ts contact wake; task office-props-physics-scale-20261030: in every
   * world, the Subway too). Only kinds with calibrated contact materials (castor / pad) set it: the iteration-07 sticky contacts
   * make a shoved body tip and the walker pass into it. Loot holders that do not spill never move; a spill holder knocked loose by
   * contact spills its finite lots like a shot one.
   */
  contact?: boolean;
}
export const PROP_PHYSICS: Record<string, PropPhysics> = {
  // Task office-interactions-layout-20261030 (lane PHYS): the dynamic office / company kinds (gen/office/physics.ts OFFICE_PHYS:
  // mass, castor / soft / … contact, collider; the static ones carry their reason there). Office-only ids: no Subway row changes.
  ...officePropPhysics(),
  // Lane A trash can: 0.55 x 0.95 m sheet-steel can with a liner (~7 kg): a rifle round rocks it, buckshot tips it.
  bin: {mass: 7, dynamic: true, shape: 'cylinder', mat: 'metal'},
  // Light, floor-standing iteration-07 generated types (ids of the Lane P1 manifest; used only if Lane P2 integrates a kind
  // with this id, and only while it stands on the floor — physics/dynamicItems.ts). Heavy / fixed / holder types stay static.
  foldingChair: {mass: 4, dynamic: true, mat: 'heavy'}, plasticStackChair: {mass: 3, dynamic: true, mat: 'plastic'}, officeSwivelChair: {mass: 12, dynamic: true, mat: 'heavy'},
  wetFloorSign: {mass: 1.2, dynamic: true, mat: 'plastic'}, mopBucketWringer: {mass: 8, dynamic: true, mat: 'plastic'}, duffelBag: {mass: 6, dynamic: true, mat: 'soft'},
  rollingSuitcase: {mass: 9, dynamic: true, mat: 'plastic'}, basketStack: {mass: 3, dynamic: true, mat: 'plastic'}, babyStroller: {mass: 9, dynamic: true, mat: 'heavy'},
  shoppingCart: {mass: 15, dynamic: true, mat: 'heavy'}, handTruck: {mass: 14, dynamic: true, mat: 'heavy'}, pedestalFan: {mass: 5, dynamic: true, mat: 'plastic'},
  drumFan: {mass: 14, dynamic: true, mat: 'heavy'}, fireExtinguisher: {mass: 6, dynamic: true, shape: 'cylinder', mat: 'metal'}, trashBagPile: {mass: 8, dynamic: true, mat: 'soft'},
  newspaperBundles: {mass: 12, dynamic: true, mat: 'soft'}, wheelieBin: {mass: 12, dynamic: true, mat: 'plastic'}, tripodWorkLight: {mass: 6, dynamic: true, mat: 'heavy'},
  stepLadder: {mass: 7, dynamic: true, mat: 'heavy'}, foldingBarricade: {mass: 6, dynamic: true, mat: 'plastic'}, ivPole: {mass: 4, dynamic: true, mat: 'heavy'},
  oilRadiator: {mass: 12, dynamic: true, mat: 'heavy'}, wetDryVac: {mass: 8, dynamic: true, mat: 'plastic'}, handToolbox: {mass: 6, dynamic: true, mat: 'heavy'},
  coatRack: {mass: 6, dynamic: true, mat: 'heavy'}, biohazardBin: {mass: 6, dynamic: true, mat: 'plastic'}, bicycle: {mass: 13, dynamic: true, mat: 'heavy'},
  wheelchair: {mass: 15, dynamic: true, mat: 'heavy'}, crowdBarrier: {mass: 16, dynamic: true, mat: 'heavy'},
  // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the hideout's camping lantern (~1.2 kg) and camp stove (~1.8 kg) — light
  // loose props on the floor or on the camp table's top (`onHost`: they go loose on their static host, like an office monitor)
  campLantern: {mass: 1.2, dynamic: true, shape: 'cylinder', mat: 'metal', onHost: true}, campStove: {mass: 1.8, dynamic: true, mat: 'metal', onHost: true},
};

/**
 * Task office-props-physics-scale-20261030 (lane PHYS; user: "All physics objects should always be interactable, without needing
 * to be shot first"): the CONTACT overlay of the Subway's light kinds (the rows above / PROP_DEFS.physics keep their mass and
 * `dynamic`). Each gets a calibrated contact material — `castor` for what rolls on wheels / castors, `pad` for feet, bases, bags
 * and bundles — and `contact`: walking into one wakes it in every world (Subway and Office, where these kinds are imported too),
 * like the office furniture. `fit`: the collider inside the box of a chair pulled up to its table / desk (as the office chairs).
 * Spill holders (the trash can, the wheelie bin) wake by contact too (coordinator follow-up: the user's rule is literal): a walk-in
 * knocks one loose like a shot, its lid pops and its finite lots spill through ContainerManager.goLoose as the same pickups.
 * `how` is the audit sentence (damage/physicsAudit.ts). Ids without a PROP_DEFS kind yet are listed for a later integration. The
 * shopping cart and every other loot holder that does not spill stay put (no overlay: their lots would float).
 */
export const SUBWAY_CONTACT: Readonly<Record<string, {mat: 'castor' | 'pad'; fit?: number; how: string}>> = {
  rollingSuitcase: {mat: 'castor', how: 'rolling suitcase on spinner wheels (~9 kg): rolls ahead when walked into, slides / tips when shot'},
  babyStroller: {mat: 'castor', how: 'baby stroller (~9 kg): rolls away when bumped'},
  wheelchair: {mat: 'castor', how: 'wheelchair (~15 kg): rolls away when bumped'},
  handTruck: {mat: 'castor', how: 'hand truck (~14 kg) standing on its nose plate and wheels: shoved / rolled along when bumped'},
  wheelieBin: {mat: 'castor', how: 'wheelie bin (~12 kg): a walk-in or a shot knocks it loose — its lid pops, its finite lots spill — then it rolls / rocks on its wheels'},
  bin: {mat: 'pad', how: 'sheet-steel trash can with a liner (~7 kg): a walk-in or a shot knocks it loose — its lid pops, its finite lots spill — then it slides / tips on its base'},
  mopBucketWringer: {mat: 'castor', how: 'mop bucket with wringer on castors (~8 kg): rolls when bumped'},
  wetDryVac: {mat: 'castor', how: 'wet / dry shop vac on castors (~8 kg): rolls when bumped'},
  ivPole: {mat: 'castor', how: 'IV pole on a five-castor base (~4 kg): rolls when bumped, tips under buckshot'},
  ingredientBin: {mat: 'castor', how: 'mobile ingredient bin on castors (~8 kg): rolls when bumped'},
  officeSwivelChair: {mat: 'castor', fit: 0.75, how: 'office swivel chair on castors (~12 kg): rolls away when bumped, like the office task chair'},
  oilRadiator: {mat: 'castor', how: 'oil-filled radiator on castors (~12 kg; no PROP_DEFS kind yet): rolls when bumped'},
  foldingChair: {mat: 'pad', fit: 0.75, how: 'folding chair (~4 kg): slides / tips when bumped or shot'},
  plasticStackChair: {mat: 'pad', fit: 0.75, how: 'plastic stacking chair (~3 kg): slides / tips when bumped or shot'},
  wetFloorSign: {mat: 'pad', how: 'A-frame wet-floor sign (~1.2 kg): knocked along / over when bumped'},
  basketStack: {mat: 'pad', how: 'stack of shopping baskets (~3 kg): slides / topples when bumped'},
  pedestalFan: {mat: 'pad', how: 'pedestal fan on a round base (~5 kg): slides / tips when bumped'},
  drumFan: {mat: 'pad', how: 'drum fan on its frame (~14 kg): shoved along when bumped'},
  fireExtinguisher: {mat: 'pad', how: 'free-standing fire extinguisher (~6 kg): shoved / knocked over when bumped'},
  trashBagPile: {mat: 'pad', how: 'pile of full trash bags (~8 kg): shoved along when bumped'},
  newspaperBundles: {mat: 'pad', how: 'tied newspaper bundles (~12 kg): shoved along when bumped'},
  tripodWorkLight: {mat: 'pad', how: 'tripod work light (~6 kg): shoved / knocked over when bumped'},
  stepLadder: {mat: 'pad', how: 'folded-open step ladder (~7 kg): shoved / tipped when bumped'},
  foldingBarricade: {mat: 'pad', how: 'folding plastic barricade (~6 kg): shoved along when bumped'},
  handToolbox: {mat: 'pad', how: 'hand toolbox (~6 kg): shoved along when bumped where it stands on the floor'},
  coatRack: {mat: 'pad', how: 'coat rack on a weighted base (~6 kg): shoved / tipped when bumped'},
  bicycle: {mat: 'pad', how: 'parked bicycle (~13 kg): shoved / tipped when bumped'},
  crowdBarrier: {mat: 'pad', how: 'steel crowd barrier on feet (~16 kg): shoved along when bumped'},
  spinnerRack: {mat: 'pad', how: 'spinner rack on its base (~14 kg): shoved / rocked when bumped'},
  paperShredder: {mat: 'pad', how: 'bin-style paper shredder (~10 kg): shoved along when bumped'},
  duffelBag: {mat: 'pad', how: 'duffel bag (~6 kg; no PROP_DEFS kind yet): shoved along when bumped'},
  biohazardBin: {mat: 'pad', how: 'biohazard bin (~6 kg; no PROP_DEFS kind yet): shoved along when bumped'},
  // lane HIDEOUT (round 3): the survivor hideout's camp things
  campLantern: {mat: 'pad', how: 'camping lantern (~1.2 kg) on the camp table or the floor: knocked off / over when bumped or shot'},
  campStove: {mat: 'pad', how: 'portable camp stove (~1.8 kg) on the camp table or the floor: shoved off / along when bumped or shot'},
};

/**
 * Task mall-playtest-revision-20261031 (lane SHOPS, U05): kinds hung on their host (`PropPlacement.host`) that RIDE it when the host
 * goes loose (physics/dynamicItems.ts: the rider's meshes join the host body's parts, its own collider goes) — gen/mall/kinds.ts
 * MALL_RIDER_KINDS (garments on a garment rail). Every other host decor keeps its rule (on-top decor of a moving prop: the prop never
 * goes loose while something rests on its top).
 */
const RIDER_KINDS: ReadonlySet<string> = new Set(MALL_RIDER_KINDS);
export function ridesHost(kind: string): boolean {
  return RIDER_KINDS.has(kind);
}

const overlaid = new Map<string, {base: PropPhysics; row: PropPhysics}>();
export function propPhysics(kind: string): PropPhysics {
  const def = (PROP_DEFS as unknown as Record<string, {physics?: PropPhysics} | undefined>)[kind];
  const base = def?.physics ?? PROP_PHYSICS[kind];
  if (!base) return {mass: Infinity, dynamic: false};
  // task office-props-physics-scale-20261030 (lane PHYS): the Subway contact overlay (calibrated material + contact wake)
  const c = base.dynamic ? SUBWAY_CONTACT[kind] : undefined;
  if (!c) return base;
  let o = overlaid.get(kind);
  if (!o || o.base !== base) overlaid.set(kind, (o = {base, row: {...base, mat: c.mat, contact: true, ...(c.fit ? {fit: c.fit} : {})}}));
  return o.row;
}

/** Rigid chunk family per damage class: contact material and density (kg/m^3, before a 0.5 fill factor). */
export const CHUNK_PHYS: Readonly<Record<DamageClass, {mat: PhysMat; density: number}>> = {
  concrete: {mat: 'stone', density: 2300}, tile: {mat: 'stone', density: 2200}, terrazzo: {mat: 'stone', density: 2400}, plaster: {mat: 'stone', density: 1400},
  ballast: {mat: 'stone', density: 2600}, sheetMetal: {mat: 'metal', density: 7800}, steel: {mat: 'metal', density: 7800}, wood: {mat: 'wood', density: 600},
  glass: {mat: 'glass', density: 2500}, screen: {mat: 'glass', density: 2500}, plastic: {mat: 'plastic', density: 1100}, laminate: {mat: 'wood', density: 800},
  porcelain: {mat: 'stone', density: 2400}, fabric: {mat: 'cloth', density: 300}, cardboard: {mat: 'soft', density: 250}, food: {mat: 'soft', density: 500},
  flesh: {mat: 'flesh', density: 1050}, cloth: {mat: 'cloth', density: 400}, rubber: {mat: 'soft', density: 1100},
};

// ---------------------------------------------------------------------------------------
// Zombies: body skin + wardrobe slots (ai/wardrobe.ts MeshSlot)

export const ZOMBIE_SLOT_CLASS: Record<string, DamageClass> = {body: 'flesh', upper: 'cloth', lower: 'cloth', head: 'cloth', face: 'rubber'};

/** Class of a worn wearable by id (gas masks / respirators rubber, hard hats / helmets plastic, else cloth). */
export function wearableClass(id: string, slot?: string): DamageClass {
  if (/mask|respirator/i.test(id)) return 'rubber';
  if (/hard ?hat|helmet/i.test(id)) return 'plastic';
  return slot ? ZOMBIE_SLOT_CLASS[slot] ?? 'cloth' : 'cloth';
}

/** Class of one zombie mesh from its slot / wearable id / node name. */
export function zombieMeshClass(slot: string | undefined, wearable: string | null | undefined, name = ''): DamageClass {
  if (slot === 'body' || (!slot && /ZombieBody/i.test(name))) return 'flesh';
  if (wearable) return wearableClass(wearable, slot);
  if (/mask/i.test(name)) return 'rubber';
  return slot ? ZOMBIE_SLOT_CLASS[slot] ?? 'cloth' : 'cloth';
}

// ---------------------------------------------------------------------------------------
// Grid (structural) surfaces: which key / class a hitscan wall / floor / ceiling hit is

interface AreaLike { kind: string; type: string; publicSpace: boolean; edge?: string; x: number; y: number; w: number; h: number }
interface GridLike {
  areaAt(x: number, z: number): number;
  cellOf(x: number, z: number): [number, number];
  get(x: number, y: number): number;
  idx(x: number, y: number): number;
  rampIdx: Int16Array;
}
export interface StructuralWorld {
  grid: GridLike;
  areas: readonly AreaLike[];
  trenches?: readonly {x0: number; x1: number; z0: number; z1: number}[];
  /** Platform safety-edge strip width (m); world/materials.ts scale.safetyEdge.v. */
  safetyStrip?: number;
}

const CELL = 0.5;

/**
 * Builder-equivalent material of a grid surface at a hit point (normal = the face normal toward the
 * shooter). Mirrors world/builder.ts: public halls tiled walls + terrazzo floors, service rooms
 * painted block + concrete, storefront units shop tile / quarry tile, platforms slab + safety edge,
 * track beds ballast, tunnels / platform faces concrete, stairs concrete.
 */
export function structuralKeyAt(kind: 'wall' | 'floor' | 'ceiling' | string, x: number, y: number, z: number, nx: number, nz: number, w: StructuralWorld): StructuralKey {
  const g = w.grid;
  const back = (d: number) => g.areaAt(x + nx * d, z + nz * d);
  if (kind === 'ceiling') {
    const a = w.areas[g.areaAt(x, z)];
    return !a || a.publicSpace ? 'ceiling' : 'ceilingService';
  }
  if (kind === 'floor') {
    const [cx, cy] = g.cellOf(x, z);
    if (g.rampIdx[g.idx(cx, cy)] >= 0) return 'stairs';
    const ai = g.areaAt(x, z);
    const a = ai >= 0 ? w.areas[ai] : undefined;
    if (!a) {
      const inTrench = w.trenches?.some(t => x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) ?? y < -0.2;
      return inTrench && y < -0.2 ? 'ballast' : 'concrete';
    }
    if (a.type === 'eatery') return 'quarryTile';
    if (a.kind === 'platform') {
      const strip = w.safetyStrip ?? 0.35;
      const z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
      const n = a.edge !== 'S', s = a.edge === 'S' || a.edge === 'NS';
      if ((n && z - z0 < strip) || (s && z1 - z < strip)) return 'safetyEdge';
      return 'platformSlab';
    }
    return a.publicSpace ? 'terrazzo' : 'concrete';
  }
  // walls: the space the bullet came from (step back off the face) decides the finish
  const ai = back(0.25);
  const a = ai >= 0 ? w.areas[ai] : undefined;
  if (!a) {
    // No area: a track-bed cell (tunnel lining against rock, or the platform face) or an area-less floor cell (tiled).
    const [sx, sy] = g.cellOf(x + nx * 0.25, z + nz * 0.25);
    if (g.get(sx, sy) !== 2) return y > 1.8 ? 'tileUpper' : 'tileLower';
    return isSolidBehind(g, x - nx * 0.05, z - nz * 0.05) ? 'tunnel' : 'platformFace';
  }
  if (a.type === 'eatery' || a.type === 'shop') return 'tileShop';
  if (a.publicSpace) return y > 1.8 ? 'tileUpper' : 'tileLower';
  return 'paint';
}

/** Whether the cell just behind a wall face is solid rock (tunnel lining) rather than a raised floor. */
function isSolidBehind(g: GridLike, x: number, z: number): boolean {
  const [cx, cy] = g.cellOf(x, z);
  return g.get(cx, cy) === 0;
}

export function structuralClass(kind: string, x: number, y: number, z: number, nx: number, nz: number, w: StructuralWorld): DamageClass {
  return STRUCTURAL_CLASS[structuralKeyAt(kind, x, y, z, nx, nz, w)];
}

// ---------------------------------------------------------------------------------------
// Damage numbers

/** Damage points a hit counts against a prop of class `cls` (weapon damage after falloff x vulnerability). */
export function propHitDamage(cls: DamageClass, weaponDamage: number): number {
  return weaponDamage * DAMAGE_MATERIALS[cls].vuln;
}

/** Visual stage from remaining integrity: 0 intact, 1 marked, 2 heavily damaged (<= 55%), 3 broken. */
export function damageStage(hp: number, integrity: number, hits: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(integrity)) return hits <= 0 ? 0 : hits < 6 ? 1 : 2;
  if (hp <= 0) return 3;
  if (hp <= integrity * 0.55) return 2;
  return hits > 0 ? 1 : 0;
}
