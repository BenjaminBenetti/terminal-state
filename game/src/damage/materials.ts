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
};

// ---------------------------------------------------------------------------------------
// Prop parts: shape-material keys (procedural props / storefront blocks) and purpose keys

export const SHAPE_KEY_CLASS: Record<ShapeMat, DamageClass> = {
  steelDark: 'sheetMetal', steelBright: 'steel', accent: 'sheetMetal', counter: 'laminate', panel: 'sheetMetal', glass: 'glass', screen: 'screen',
  vendFront: 'screen', porcelain: 'porcelain', partition: 'laminate', concrete: 'concrete', grille: 'steel', black: 'plastic', wood: 'wood',
  mirror: 'glass', shutter: 'sheetMetal', shopFrame: 'steel', signBand: 'plastic', menuBoard: 'screen', shutterSteel: 'sheetMetal',
  kitchenSteel: 'steel', laminate: 'laminate', tileShop: 'tile', quarryTile: 'tile', woodVeneer: 'wood', plasticSeat: 'plastic',
  glassShopfront: 'glass', menuBoardNoodle: 'screen', menuBoardCoffee: 'screen', menuBoardPizza: 'screen',
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
  rifle: 'steel', shotgun: 'steel', bench: 'sheetMetal', light: 'sheetMetal', cabinetTall: 'sheetMetal', cabinetLow: 'sheetMetal', sign: 'sheetMetal',
  crate: 'wood', turnstile: 'steel', shelf: 'steel', vending: 'sheetMetal', stall: 'sheetMetal',
  item_water: 'plastic', item_cola: 'sheetMetal', item_juice: 'cardboard', item_chocolate: 'food', item_chips: 'food', item_beans: 'sheetMetal', item_noodles: 'food',
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
  vending: {...NEVER('sheetMetal', {cls: 'glass', integrity: 75, on: 'open'}), glassFront: [-0.45, 0.25, 0.3, 0.92]},
  shelf: NEVER('steel'), table: NEVER('laminate'), desk: NEVER('laminate', SCREEN(20)), booth: NEVER('sheetMetal', SHATTER(40)),
  ticketMachine: NEVER('sheetMetal', SCREEN(25)), exitStair: NEVER('concrete'), toiletStall: NEVER('laminate'),
  washCounter: NEVER('laminate', SHATTER(35)),
  shopCounter: NEVER('laminate'), shopDisplay: NEVER('steel', SHATTER(35)), shopBackbar: NEVER('steel'), shopCooler: NEVER('sheetMetal', SHATTER(45)),
  // Shopfront glazing: the panes shatter; the 0.3 m plinth stays solid (jump through), bullets and sight pass.
  shopGlazing: NEVER('steel', SHATTER(40)), shopShutter: NEVER('sheetMetal'),
  stockShelf: NEVER('steel'), snackRack: NEVER('steel'), magazineRack: NEVER('steel'), techDisplay: NEVER('laminate', SCREEN(25)),
  deviceWall: NEVER('laminate', SCREEN(25)), showcase: NEVER('steel', SHATTER(35)), flowerStand: NEVER('wood'), repairBench: NEVER('wood'),
  hotdogCart: NEVER('steel'), grillLine: NEVER('steel'), pizzaOven: NEVER('steel'), espressoBar: NEVER('steel'), wokLine: NEVER('steel'),
  deliLine: NEVER('steel', SHATTER(30)), blenderBar: NEVER('steel'), breadRack: NEVER('steel'), staffLockers: NEVER('sheetMetal'),
  kitchenette: NEVER('laminate'), fridge: NEVER('sheetMetal'), couch: NEVER('fabric'), noticeBoard: NEVER('cardboard'), janitorCart: NEVER('plastic'),
  mopSink: NEVER('plastic'), electricalPanel: NEVER('sheetMetal'), gunLocker: NEVER('sheetMetal'), monitorDesk: NEVER('laminate', SCREEN(25)),
  medCabinet: NEVER('sheetMetal'), safe: NEVER('steel'), signalRack: NEVER('sheetMetal'),
  // Carton stack (decor): cardboard collapses into a low heap of flattened boxes.
  cartonStack: {cls: 'cardboard', integrity: 80, breaks: 'collapse'},
  // Iteration 07 (Lane P2): generated prop types (class / breaks per type in gen/props07.ts).
  ...P7_PROP_DAMAGE,
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
  rifle: 'steel', shotgun: 'steel', pistol: 'steel', ammo_rifle: 'cardboard', ammo_shells: 'cardboard', ammo_pistol: 'cardboard', medkit: 'plastic', bandage: 'fabric',
  water: 'plastic', cola: 'sheetMetal', juice: 'cardboard', chocolate: 'food', chips: 'food', beans: 'sheetMetal', noodles: 'food',
};
export function itemClass(itemId: string): DamageClass {
  return ITEM_CLASS[itemId] ?? 'plastic';
}

// ---------------------------------------------------------------------------------------
// Iteration 07 (Lane K): rigid-body physics of loose items, light props and chunks
// (physics/dynamicItems.ts, physics/chunks.ts). Pure data.

/** Contact / sound family of a rigid body (cannon contact material vs the static station). */
export type PhysMat = 'metal' | 'plastic' | 'soft' | 'heavy' | 'stone' | 'wood' | 'glass' | 'flesh' | 'cloth';
/** Friction / restitution against the station (floors, walls, prop boxes, holder shelves). */
export const PHYS_MATS: Readonly<Record<PhysMat, {friction: number; restitution: number}>> = {
  metal: {friction: 0.32, restitution: 0.34}, plastic: {friction: 0.42, restitution: 0.3}, soft: {friction: 0.7, restitution: 0.08},
  heavy: {friction: 0.55, restitution: 0.1}, stone: {friction: 0.7, restitution: 0.2}, wood: {friction: 0.6, restitution: 0.24},
  glass: {friction: 0.45, restitution: 0.14}, flesh: {friction: 0.95, restitution: 0.02}, cloth: {friction: 0.98, restitution: 0},
};

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
  ammo_rifle: {mass: 0.62, shape: 'box', mat: 'soft'}, ammo_shells: {mass: 0.7, shape: 'box', mat: 'soft'}, ammo_pistol: {mass: 0.5, shape: 'box', mat: 'soft'},
  medkit: {mass: 0.6, shape: 'box', mat: 'plastic'}, bandage: {mass: 0.08, shape: 'box', mat: 'soft'},
  rifle: {mass: 3.4, shape: 'box', mat: 'heavy'}, shotgun: {mass: 3.6, shape: 'box', mat: 'heavy'}, pistol: {mass: 0.9, shape: 'box', mat: 'heavy'},
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
export interface PropPhysics { mass: number; dynamic: boolean; shape?: 'box' | 'cylinder'; mat?: PhysMat }
export const PROP_PHYSICS: Record<string, PropPhysics> = {
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
};
export function propPhysics(kind: string): PropPhysics {
  const def = (PROP_DEFS as unknown as Record<string, {physics?: PropPhysics} | undefined>)[kind];
  return def?.physics ?? PROP_PHYSICS[kind] ?? {mass: Infinity, dynamic: false};
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
