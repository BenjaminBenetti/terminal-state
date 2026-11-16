// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE DISTRICT'S MATERIALS — the 'surface-…' finish keys the
// builder's surface arch (arch.ts) asks for, made from EXISTING approved texture sets only (root CLAUDE.md: tint / tiling / channel
// reuse; no new static art):
//  - the Reactor's Codex pit-concrete / rusted-steel / mine-rock PBR sets (asphalt, lots, kerbs, the cordon wall, concrete / stone /
//    metal facades, verges, potholes), the Skyways' Codex brick wall / pavers / herringbone (brick facades, plazas), the office cubicle
//    fabric (the tent canvas) — loaded by the look runtime's section preload (look.ts) under the 'surface' asset family and handed in
//    through setSurfaceTexture;
//  - the office architecture's wall / floor / ceiling programs (world/officeArch.ts: stucco facades, sidewalks, every interior);
//  - the repo's shared surface sets (world/materials.ts surfaceMaterial: lane paint, cast iron, rails, ties, boards, shutters).
// Without a loaded map (Node tests, a failed fetch) every key falls back to the shared surface sets, tinted — never a new texture.
// Materials this module creates are cached per WorldMaterials and handed to the runtime's owner (LevelResources 'surface': released
// with the district's asset family); a released material leaves the cache. Office-registry / shape materials are shared (not owned).

import * as THREE from 'three';
import {materialColor, vec4, vertexColor} from 'three/tsl';
import {SKYWAYS_ARCH_TEXTURES} from '../../assets/skywaysArchTextures.generated';
import {REACTOR_TEXTURES as KIT_TEXTURES} from '../../assets/reactorKit.generated';
import {REACTOR_X_TEXTURES} from '../../assets/reactorExpansionKit.generated';
import {OFFICE_TEXTURES} from '../../assets/officeAssets';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, surfaceMaterial, thinTrim, worldMapped, type WorldMaterials} from '../materials';
import {tagReflect} from '../../render/reflectTag';
import type {OutdoorFacadeKind} from './lookSky';
import {applyDecay, type DecayProfile} from '../decay';
import {addNodeHook} from '../../render/nodeHooks';
import {asColor, sharedStage, skipInShadowPass} from '../surfaceNodes';
import {LOWER, OFFICE_CEIL_SPAN, OFFICE_FLOOR_SPAN, OFFICE_WALL_SPAN, ceilingMaterial, floorMaterial, wallMaterial, type CeilingKind, type FloorKind} from '../officeArch';
import {shapeMaterial} from '../shapeMaterials';
import {INTERIOR_LOOKS, type FacadeWall, type InteriorFamily} from './archStyles';

/** Texture slots the district reads (colour / normal / ORM where the set has them). */
export type SurfaceTexSlot =
  | 'concrete:color' | 'concrete:normal' | 'concrete:orm' | 'rusted:color' | 'rusted:normal' | 'rusted:orm' | 'rock:color' | 'rock:normal' | 'rock:orm'
  | 'brick' | 'pavers' | 'herringbone' | 'fabric';

/** The delivered texture files per slot (all existing, approved; colour sRGB, normal / ORM linear). */
export const SURFACE_TEXTURES: Readonly<Record<SurfaceTexSlot, {url: string; srgb: boolean}>> = {
  'concrete:color': {url: KIT_TEXTURES['pit-concrete'].color, srgb: true}, 'concrete:normal': {url: KIT_TEXTURES['pit-concrete'].normal, srgb: false},
  'concrete:orm': {url: KIT_TEXTURES['pit-concrete'].orm, srgb: false},
  'rusted:color': {url: KIT_TEXTURES['rusted-steel'].color, srgb: true}, 'rusted:normal': {url: KIT_TEXTURES['rusted-steel'].normal, srgb: false},
  'rusted:orm': {url: KIT_TEXTURES['rusted-steel'].orm, srgb: false},
  'rock:color': {url: REACTOR_X_TEXTURES['mine-rock'].color, srgb: true}, 'rock:normal': {url: REACTOR_X_TEXTURES['mine-rock'].normal, srgb: false},
  'rock:orm': {url: REACTOR_X_TEXTURES['mine-rock'].orm, srgb: false},
  brick: {url: SKYWAYS_ARCH_TEXTURES.brickWall.url, srgb: true},
  pavers: {url: SKYWAYS_ARCH_TEXTURES.pavers.url, srgb: true},
  herringbone: {url: SKYWAYS_ARCH_TEXTURES.herringbone.url, srgb: true},
  fabric: {url: OFFICE_TEXTURES['cubicle-fabric'].url ?? '', srgb: true},
};
export const SURFACE_TEX_SLOTS = Object.keys(SURFACE_TEXTURES) as SurfaceTexSlot[];

/** Tile spans (m) of the UV-mapped sets (the world-mapped PBR sets carry their own span below). */
const SPAN = {
  concrete: [3, 3] as [number, number], rusted: [1.6, 1.6] as [number, number], rock: [2.4, 2.4] as [number, number],
  brick: SKYWAYS_ARCH_TEXTURES.brickWall.span, pavers: SKYWAYS_ARCH_TEXTURES.pavers.span, herringbone: SKYWAYS_ARCH_TEXTURES.herringbone.span,
  fabric: [1.2, 1.2] as const,
};

const TEX = new Map<SurfaceTexSlot, THREE.Texture>();
let texVersion = 0;
/** Registers (or clears) a loaded district texture (the look runtime's preload; tests inject stand-ins). */
export function setSurfaceTexture(slot: SurfaceTexSlot, t: THREE.Texture | null): void {
  if ((TEX.get(slot) ?? null) === t) return;
  if (t) TEX.set(slot, t); else TEX.delete(slot);
  texVersion++;
}
export const surfaceTexture = (slot: SurfaceTexSlot): THREE.Texture | null => TEX.get(slot) ?? null;
/** Slots currently resolved (QA). */
export const surfaceTexturesReady = (): SurfaceTexSlot[] => SURFACE_TEX_SLOTS.filter(s => TEX.has(s));

/** Who owns a material this module creates (the look runtime: LevelResources 'surface'); null = nobody (tests). */
let owner: ((r: {dispose(): void}) => void) | null = null;
export function setSurfaceResourceOwner(fn: ((r: {dispose(): void}) => void) | null): void { owner = fn; }
/** Hands a district-only GPU resource to that owner (lookSky.ts materials, the sign atlas); returns it. */
export function ownSurfaceResource<T extends {dispose(): void}>(r: T): T { owner?.(r); return r; }

interface Cache { version: number; m: Map<string, THREE.Material> }
const caches = new WeakMap<WorldMaterials, Cache>();
/** Materials created and not yet released (QA / tests: lifecycle). */
export const liveSurfaceMaterials = new Set<THREE.Material>();

function cacheOf(mats: WorldMaterials): Cache {
  let c = caches.get(mats);
  if (!c || c.version !== texVersion) caches.set(mats, (c = {version: texVersion, m: new Map()}));
  return c;
}

/** A material this module made: named, tracked, owned, and evicted from the cache when it is released. */
function adopt<M extends THREE.Material>(mats: WorldMaterials, key: string, m: M): M {
  m.name = key;
  m.userData.surfaceArch = key;
  liveSurfaceMaterials.add(m);
  const c = cacheOf(mats);
  c.m.set(key, m);
  m.addEventListener('dispose', () => { liveSurfaceMaterials.delete(m); if (c.m.get(key) === m) c.m.delete(key); });
  owner?.(m);
  return m;
}

const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
/** Linear colour of `hex` relative to the reference `ref` (a tint multiplier: ref -> 1). */
const rel = (hex: number, ref: number): THREE.Color => { const a = lin(hex), b = lin(ref); return new THREE.Color(a.r / Math.max(b.r, 1e-3), a.g / Math.max(b.g, 1e-3), a.b / Math.max(b.b, 1e-3)); };

const D = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});
/** Outdoor decay: long rain streaks down the facades, soot, grime low; the street's wear, stains and cracks. */
const DECAY = {
  facade: D({grime: 0.45, streaks: 0.9, efflor: 0.25, stains: 0.35, cracks: 0.25, fade: 0.25, tint: [0.4, 0.37, 0.32]}),
  ground: D({grime: 0.25, wear: 0.4, dust: 0.55, stains: 0.6, cracks: 0.5, tint: [0.32, 0.3, 0.27]}),
  paint: D({wear: 0.6, dust: 0.4, stains: 0.3, fade: 0.5, paintWear: 1, tint: [0.4, 0.38, 0.34]}),
  metal: D({grime: 0.4, streaks: 0.7, stains: 0.4, tint: [0.4, 0.33, 0.26]}),
} as const;

/** A world-mapped PBR material over a resolved set (null when its colour map is not loaded). */
function pbr(set: 'concrete' | 'rusted' | 'rock', o: {color?: THREE.Color; rough?: number; metal?: number; normal?: number; macro?: number; grime?: [number, number]}): SurfaceNodeMaterial | null {
  const color = surfaceTexture(`${set}:color` as SurfaceTexSlot);
  if (!color) return null;
  const normal = surfaceTexture(`${set}:normal` as SurfaceTexSlot), orm = surfaceTexture(`${set}:orm` as SurfaceTexSlot);
  const m = new SurfaceNodeMaterial({map: color, roughness: o.rough ?? 1, metalness: orm ? (o.metal ?? 0) : 0});
  if (o.color) m.color.copy(o.color);
  if (normal) { m.normalMap = normal; m.normalScale.set(o.normal ?? 1, o.normal ?? 1); }
  if (orm) { m.roughnessMap = orm; m.metalnessMap = orm; }
  return worldMapped(m, {span: [...SPAN[set]] as [number, number], grime: o.grime, macro: o.macro ?? 0.2});
}

/** A UV-mapped material over a single colour map (brick, pavers, herringbone, fabric), or null. */
function mapped(slot: 'brick' | 'pavers' | 'herringbone' | 'fabric', color: THREE.Color, rough: number): SurfaceNodeMaterial | null {
  const t = surfaceTexture(slot);
  if (!t) return null;
  const m = new SurfaceNodeMaterial({map: t, roughness: rough, metalness: 0});
  m.color.copy(color);
  return m;
}

/** The shared fallback surface set, tinted (a clone: the shared one stays untinted). */
function fallback(name: Parameters<typeof surfaceMaterial>[0], hex: number, o: {rough?: number; metal?: number} = {}): SurfaceNodeMaterial {
  const m = surfaceMaterial(name, {roughness: o.rough ?? 1, metalness: o.metal ?? 0}, {grime: [0.3, 0.5], macro: 0.18});
  m.color.copy(lin(hex));
  return m;
}

const decal = <M extends THREE.Material>(m: M, bias = 2): M => {
  m.polygonOffset = true; m.polygonOffsetFactor = -bias; m.polygonOffsetUnits = -bias;
  return m;
};

/** Facade wall material families -> (texture set, reference tone of its first tint). */
const FACADE_REF: Readonly<Record<FacadeWall, number>> = {brick: 0xffffff, concrete: 0xffffff, stone: 0xfff4e6, metal: 0xb5c4ba, stucco: 0, curtain: 0, canvas: 0};

/**
 * Follow-up 1 (lane LOOK; draws): THE FACADE FAMILIES' SHARED TINTED MATERIALS. Every 'surface-facade-<wall>-<hex>' material of one wall
 * family (brick / concrete / stone / metal / curtain / canvas) and every 'surface-trim-<hex>' differs from the others of its family ONLY
 * by its colour factor (one building's tint). The family's shared material ('surface-facade-<wall>-tint' / 'surface-trim-tint') is the
 * same factory material with colour 1 and this TINT STAGE first in its colour chain (order 10: before the world mapping 100, the decay
 * 200, damage 300), reading the part's linear tint from the geometry's 'color' attribute (Float32 x 3 = the member key's own colour):
 * (1 x map) x tint = colour x map, so every later stage (the world-mapping shade, decay's absolute grime / streak mixes, craters) gets
 * the value it got before, on both backends. `vertexColors` stays false: three's own vertex-colour multiply runs AFTER the whole chain
 * (it would tint decay's grime). Skipped in the shadow pass (no colour there). No uniform is added (the tint is an attribute).
 * The member keys' own materials stay what the enhanced bake's surface albedo reads (BuiltWorld.drawn.material): unchanged.
 * Stucco ('surface-facade-stucco-<hex>') is NOT a family: it is the office wall program, whose graphs read the paint colours themselves.
 */
export const SURFACE_TINT_HOOK = 'surface-tint';
export const SURFACE_TINT_ORDER = 10;
const tintStage = sharedStage(prev => {
  const c = asColor(prev, materialColor);
  return skipInShadowPass(vec4(c.rgb.mul(vertexColor().rgb), c.a), c, 'vec4');
});
const TINT_WALLS = 'brick|concrete|stone|metal|curtain|canvas';
const TINT_MEMBER = new RegExp(`^surface-facade-(${TINT_WALLS})-[0-9a-f]{6}$`);
const TINT_FAMILY = new RegExp(`^surface-(facade-(${TINT_WALLS})|trim)-tint$`);

/** The shared tinted family of a member key ('surface-facade-<wall>-tint' / 'surface-trim-tint'); null: not tinted (stucco, the rest). */
export function surfaceTintFamily(key: string): string | null {
  const f = TINT_MEMBER.exec(key);
  if (f) return `surface-facade-${f[1]}-tint`;
  return key.startsWith('surface-trim-') && key !== 'surface-trim-tint' ? 'surface-trim-tint' : null;
}
/** Whether `key` is a family's shared tinted material key. */
export const isSurfaceTintFamily = (key: string): boolean => TINT_FAMILY.test(key);
/** The linear tint of a member key (its own material's colour factor: the value its parts carry in 'color'); null: not a member. */
export function surfaceTintOf(mats: WorldMaterials, key: string): THREE.Color | null {
  if (!surfaceTintFamily(key)) return null;
  return (surfaceArchMaterial(mats, key) as THREE.MeshStandardMaterial | undefined)?.color ?? null;
}

const trimMaterial = (hex: number): SurfaceNodeMaterial => {
  const t = thinTrim(surfaceMaterial('paintedSteel', {roughness: 1, metalness: 0.2}, {grime: [0.2, 0.4], macro: 0.1}));
  t.color.copy(lin(hex));
  return t;
};

/** A family's shared material: its members' factory material (they differ only by colour) with colour 1 and the tint stage. */
function tintFamilyMaterial(fam: string): SurfaceNodeMaterial | null {
  const wall = TINT_FAMILY.exec(fam)?.[2];
  const m = (wall ? facadeMaterial(`surface-facade-${wall}-ffffff`) : trimMaterial(0xffffff)) as SurfaceNodeMaterial | null;
  if (!m) return null;
  m.color.setRGB(1, 1, 1);
  addNodeHook(m, {key: SURFACE_TINT_HOOK, stage: 'color', order: SURFACE_TINT_ORDER, fn: tintStage});
  m.userData.surfaceTint = fam;
  return m;
}

/** Every key prefix this module answers (tests). */
export const SURFACE_KEY_PREFIX = 'surface-';
export const isSurfaceKey = (k: string): boolean => k.startsWith(SURFACE_KEY_PREFIX);

/** Ground / decal keys: base set + tint (sRGB hex) + roughness + decal bias (0: a floor). */
const GROUND_SPEC: Readonly<Record<string, {set: 'concrete' | 'rock'; tint: number; rough: number; bias: number; fb: Parameters<typeof surfaceMaterial>[0]}>> = {
  'surface-road': {set: 'concrete', tint: 0x5b5c5d, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-lot': {set: 'concrete', tint: 0x6d6c69, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-yard': {set: 'concrete', tint: 0x7a766d, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-check': {set: 'concrete', tint: 0x6f6c62, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-verge': {set: 'rock', tint: 0x7a6c58, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-cordon': {set: 'concrete', tint: 0xa8a59c, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-debris': {set: 'concrete', tint: 0x96938b, rough: 1, bias: 0, fb: 'paintedPanel'},
  'surface-kerb': {set: 'concrete', tint: 0xb2aea4, rough: 1, bias: 2, fb: 'paintedPanel'},
  'surface-gutter': {set: 'concrete', tint: 0x48494b, rough: 0.9, bias: 2, fb: 'paintedPanel'},
  'surface-patch': {set: 'concrete', tint: 0x3f4143, rough: 1, bias: 2, fb: 'paintedPanel'},
  'surface-oil': {set: 'concrete', tint: 0x2b2c2f, rough: 0.35, bias: 3, fb: 'paintedPanel'},
  'surface-scorch': {set: 'concrete', tint: 0x1d1c1b, rough: 1, bias: 3, fb: 'paintedPanel'},
  'surface-pothole': {set: 'rock', tint: 0x2c2926, rough: 0.55, bias: 4, fb: 'paintedPanel'},
  'surface-crack': {set: 'rock', tint: 0x1c1b1a, rough: 0.8, bias: 4, fb: 'paintedPanel'},
};

/**
 * The material of a 'surface-…' key (undefined: not one of LOOK's keys). Keys:
 *  ground / decals (GROUND_SPEC), 'surface-walk' / 'surface-plaza' / 'surface-tent-floor', 'surface-paint-{white|yellow}',
 *  'surface-facade-<wall>-<hex>', 'surface-trim-<hex>', 'surface-in-{wall|floor|ceil}-…', 'surface-iron', 'surface-rail',
 *  'surface-sleeper', 'surface-boards', 'surface-shutter', 'surface-barricade', 'surface-void', 'surface-glass', 'surface-glass-shop', 'surface-steel',
 *  'surface-canvas', 'surface-sign' (its atlas is set by arch.ts through surfaceSignMaterial).
 */
export function surfaceArchMaterial(mats: WorldMaterials, key: string): THREE.Material | undefined {
  if (!isSurfaceKey(key)) return undefined;
  const c = cacheOf(mats);
  const hit = c.m.get(key);
  if (hit) return hit;
  // the decorative panes: the district's own 'window' copies of the shared glazing (below; owned)
  if (key === SURFACE_PANE_KEYS.glass || key === SURFACE_PANE_KEYS.shop) return adopt(mats, key, surfacePaneMaterial(mats, key));
  // shared materials (never owned: other levels use them too)
  if (key === 'surface-steel') return shapeMaterial(mats, 'steelDark');
  if (key === 'surface-walk') return floorMaterial(mats, key, 'concrete', 0x9b988f);
  if (key === 'surface-tent-floor') return floorMaterial(mats, key, 'wood', 0x6f5d44);
  if (key.startsWith('surface-in-')) return interiorMaterial(mats, key);
  if (key.startsWith('surface-facade-stucco-')) {
    const hex = parseInt(key.slice('surface-facade-stucco-'.length), 16) || 0xd6c8a8;
    return wallMaterial(mats, key, {paint: hex, lower: hex, trim: hex, kind: LOWER.none, lowerTop: 0, skirt: 0, rail: 0, peel: 0.55, panel: 1.6});
  }
  const g = GROUND_SPEC[key];
  if (g) {
    const m = pbr(g.set, {color: lin(g.tint), rough: g.rough, normal: g.set === 'rock' ? 0.9 : 0.7, macro: 0.28}) ?? fallback(g.fb, g.tint);
    applyDecay(m, key === 'surface-cordon' || key === 'surface-debris' ? DECAY.facade : DECAY.ground);
    return adopt(mats, key, g.bias ? decal(m, g.bias) : m);
  }
  let m: THREE.Material | null = null;
  if (key === 'surface-plaza') m = mapped('pavers', new THREE.Color(0.92, 0.9, 0.86), 0.7) ?? fallback('quarryTile', 0xa89e8c, {rough: 0.7});
  else if (key === 'surface-paint-white' || key === 'surface-paint-yellow') {
    const p = fallback('paintedPanel', key.endsWith('white') ? 0xd6d4ca : 0xc8a03c, {rough: 0.85});
    applyDecay(p, DECAY.paint);
    m = decal(p, 3);
  } else if (key === 'surface-iron') { m = fallback('paintedSteel', 0x3b3a38, {metal: 0.45, rough: 0.8}); applyDecay(m, DECAY.metal); }
  else if (key === 'surface-rail') m = surfaceMaterial('railSteel', {metalness: 0.6, roughness: 0.6}, {grime: [0.2, 0.3]});
  else if (key === 'surface-sleeper') m = surfaceMaterial('timberTie', {roughness: 1});
  else if (key === 'surface-boards') { m = fallback('woodVeneer', 0x8d8270, {rough: 1}); applyDecay(m, DECAY.facade); }
  else if (key === 'surface-shutter') { m = fallback('shutter', 0x8e908c, {metal: 0.3, rough: 0.8}); applyDecay(m, DECAY.metal); }
  else if (key === 'surface-barricade') { m = pbr('rusted', {color: lin(0x9c8f80), metal: 0.45, normal: 1}) ?? fallback('paintedSteel', 0x6b5a48, {metal: 0.35, rough: 0.85}); applyDecay(m, DECAY.metal); }
  else if (key === 'surface-void') m = new SurfaceNodeMaterial({color: 0x0b0b0c, roughness: 1, metalness: 0});
  else if (key === 'surface-canvas') m = mapped('fabric', rel(0x6b6a4a, 0x8a8a8a), 1) ?? fallback('paintedPanel', 0x5e5d42);
  else if (key === 'surface-sign') m = new SurfaceNodeMaterial({color: 0xffffff, roughness: 0.8, metalness: 0});
  else if (isSurfaceTintFamily(key)) m = tintFamilyMaterial(key);
  else if (key.startsWith('surface-trim-')) m = trimMaterial(parseInt(key.slice('surface-trim-'.length), 16) || 0x303030);
  else if (key.startsWith('surface-facade-')) m = facadeMaterial(key);
  if (!m) return undefined;
  if (key.startsWith('surface-facade-')) applyDecay(m, key.includes('-metal-') ? DECAY.metal : DECAY.facade);
  return adopt(mats, key, m);
}

/** The decorative pane keys (arch.ts: glazed / shop / broken-shard panes behind the reveals). */
export const SURFACE_PANE_KEYS = {glass: 'surface-glass', shop: 'surface-glass-shop'} as const;

/**
 * Task studio-surface-run-field-followup-20261116-211729-01 (lane FACADE): THE DECORATIVE PANES' GLASS — the district's own copy of the
 * shared station glazing ('glass' / 'glassShopfront': colour, opacity, transparency, depth write and node hooks kept: a plain
 * cloneSurfaceMaterial) re-tagged 'window'. The pane stands REVEAL x 0.6 inside its facade, in the wall's own SOLID cell (arch.ts); on
 * the 'glass' rule (render/reflectTag.ts) its field sample and slot came from the texel holding the wall (the district's field is
 * drawn at 1 m texels: half wall, half street) and its reflection read ~3/4 of the street's light, none on some panes and another
 * storey's slot on a few. 'window' is the contract class for exactly this (world/reflectionNode.ts: the field and the probes one cell
 * out along the normal, as the tower's and AIR's live panes read): no material boost, the opacity constant, nothing else changed —
 * the shared station glazing keeps its 'glass' tag. Reflections Off / no probes: the plain field light ignores the tag (unchanged).
 */
function surfacePaneMaterial(mats: WorldMaterials, key: string): THREE.Material {
  const c = cloneSurfaceMaterial(shapeMaterial(mats, key === SURFACE_PANE_KEYS.shop ? 'glassShopfront' : 'glass'));
  return tagReflect(c, 'window');
}

/**
 * (lane FACADE) The outdoor-lit variant of a facade key (lookSky.ts outdoorFacadeMaterial: party walls over a lower neighbour's roof):
 * its finish kind, the texture slot it samples, the slot's span (m: the part's UVs are metres / span) and the member's linear tint
 * (its own material's colour factor; stucco: its paint colour). Null: not a facade key.
 */
export function surfaceOutdoorFacade(mats: WorldMaterials, key: string): {kind: OutdoorFacadeKind; slot: SurfaceTexSlot | null; span: [number, number]; tint: THREE.Color} | null {
  const m = /^surface-facade-([a-z]+)-([0-9a-f]{6})$/.exec(key);
  if (!m) return null;
  const wall = m[1] as FacadeWall, hex = parseInt(m[2], 16);
  if (wall === 'stucco') return {kind: 'flat', slot: null, span: [1, 1], tint: lin(hex)};
  const tint = surfaceTintOf(mats, key)?.clone() ?? lin(hex);
  const map = (slot: SurfaceTexSlot) => (surfaceTexture(slot) ? slot : null);
  switch (wall) {
    case 'brick': { const s = map('brick'); return s ? {kind: 'brick', slot: s, span: [SPAN.brick[0], SPAN.brick[1]], tint} : {kind: 'flat', slot: null, span: [1, 1], tint}; }
    case 'concrete': case 'stone': { const s = map('concrete:color'); return s ? {kind: 'concrete', slot: s, span: [...SPAN.concrete], tint} : {kind: 'flat', slot: null, span: [1, 1], tint}; }
    case 'metal': { const s = map('rusted:color'); return s ? {kind: 'rusted', slot: s, span: [...SPAN.rusted], tint} : {kind: 'flat', slot: null, span: [1, 1], tint}; }
    default: return {kind: 'flat', slot: null, span: [1, 1], tint};
  }
}

/** 'surface-facade-<wall>-<hex>' (brick / concrete / stone / metal / curtain / canvas). */
function facadeMaterial(key: string): THREE.Material | null {
  const m = /^surface-facade-([a-z]+)-([0-9a-f]{6})$/.exec(key);
  if (!m) return null;
  const wall = m[1] as FacadeWall, hex = parseInt(m[2], 16);
  const ref = FACADE_REF[wall] ?? 0xffffff;
  switch (wall) {
    case 'brick': return mapped('brick', rel(hex, ref), 0.92) ?? fallback('paintedPanel', mixHex(0x8f5545, hex, 0.5));
    case 'concrete': return pbr('concrete', {color: rel(hex, ref).multiplyScalar(1.05), normal: 0.6}) ?? fallback('paintedPanel', mixHex(0xa8a49b, hex, 0.5));
    case 'stone': return pbr('concrete', {color: rel(hex, ref).multiply(new THREE.Color(1.12, 1.06, 0.96)), normal: 0.45, macro: 0.1}) ?? fallback('paintedPanel', 0xc4baa6);
    case 'metal': return pbr('rusted', {color: rel(hex, ref), metal: 0.5, normal: 0.9}) ?? fallback('paintedSteel', hex, {metal: 0.3});
    case 'curtain': return fallback('paintedPanel', hex, {metal: 0.25, rough: 0.6});
    case 'canvas': return mapped('fabric', rel(hex, 0x8a8a8a), 1) ?? fallback('paintedPanel', hex);
    default: return null;
  }
}

function mixHex(a: number, b: number, t: number): number {
  const ca = lin(a), cb = lin(b);
  return ca.lerp(cb, t).getHex(THREE.SRGBColorSpace);
}

/** 'surface-in-wall-<family>', 'surface-in-floor-<family>-<kind>', 'surface-in-ceil-<kind>': the office programs (shared registry). */
function interiorMaterial(mats: WorldMaterials, key: string): THREE.Material | undefined {
  const w = /^surface-in-wall-([a-z]+)$/.exec(key);
  if (w) {
    const L = INTERIOR_LOOKS[w[1] as InteriorFamily];
    if (!L) return undefined;
    const lw = L.wall;
    return wallMaterial(mats, key, {paint: lw.paint, lower: lw.lower, trim: lw.trim, kind: LOWER[lw.lower_kind], lowerTop: lw.lowerTop, skirt: 0.1, rail: lw.lower_kind === 'none' ? 0 : 0.03, peel: lw.peel, panel: 0.6});
  }
  const f = /^surface-in-floor-([a-z]+)-([a-z]+)$/.exec(key);
  if (f) {
    const L = INTERIOR_LOOKS[f[1] as InteriorFamily];
    return floorMaterial(mats, key, f[2] as FloorKind, L?.floor.tint);
  }
  const c = /^surface-in-ceil-([a-z]+)$/.exec(key);
  if (c) return ceilingMaterial(mats, key, c[1] as CeilingKind);
  return undefined;
}

/** UV scale of a key (the builder's wallQuad / floorRect UVs): office programs by span, UV-mapped sets by their span, else 1. */
export function surfaceArchScale(key: string): {u: number; v: number} | undefined {
  if (!isSurfaceKey(key)) return undefined;
  if (key.startsWith('surface-in-wall-') || key.startsWith('surface-facade-stucco-')) return {u: OFFICE_WALL_SPAN, v: OFFICE_WALL_SPAN};
  if (key.startsWith('surface-in-floor-') || key === 'surface-walk' || key === 'surface-tent-floor') return {u: OFFICE_FLOOR_SPAN, v: OFFICE_FLOOR_SPAN};
  if (key.startsWith('surface-in-ceil-')) return {u: OFFICE_CEIL_SPAN, v: OFFICE_CEIL_SPAN};
  if (key.startsWith('surface-facade-brick-')) return {u: SPAN.brick[0], v: SPAN.brick[1]};
  if (key.startsWith('surface-facade-canvas-') || key === 'surface-canvas') return {u: SPAN.fabric[0], v: SPAN.fabric[1]};
  if (key === 'surface-plaza') return {u: SPAN.pavers[0], v: SPAN.pavers[1]};
  return {u: 1, v: 1};
}

/** Interior finish keys of a family (walls / floors / ceilings), consistent with the office's interiors. */
export function interiorKeys(fam: InteriorFamily): {wall: string; floor: string; ceil: string} {
  const L = INTERIOR_LOOKS[fam];
  return {wall: `surface-in-wall-${fam}`, floor: `surface-in-floor-${fam}-${L.floor.kind}`, ceil: `surface-in-ceil-${L.ceil}`};
}

/** The sign material with the district's sign atlas (a runtime-text canvas texture; owned). */
export function surfaceSignMaterial(mats: WorldMaterials, atlas: THREE.Texture | null): THREE.Material {
  const m = surfaceArchMaterial(mats, 'surface-sign') as SurfaceNodeMaterial;
  if (m.map !== atlas) { m.map = atlas; m.needsUpdate = true; }
  return m;
}
