// Shared textured materials for procedural box props (gen/propShapes.ts) and storefront building
// blocks, keyed by ShapeMat. Iteration 04 (user: "the non textured assets really stand out"): every
// key has a generated texture set consistent with the environment kit / concept board (worn,
// maintained-neglect North American transit), mapped in world-space metres (materials.ts
// worldMapped), so a 0.3 m stool and a 6 m shopfront share one texel scale and nothing stretches.
// Face-mapped keys (screen, vendFront, menuBoard*) show one graphic per box face from the mesh's
// 0..1 UVs; menus are designed for ~2:1 faces (e.g. 1.6 x 0.8 m).
// Materials are created lazily on first use and shared by every instance (no per-instance
// materials); `accent` stays white so InstancedMesh colours tint it per prop variant.

import * as THREE from 'three';
import {SHAPE_MAT_KEYS, type ShapeMat} from '../gen/propShapes';
import {fareScreenTexture, lanternGlowTexture, menuBoardTexture, vendFrontTexture} from './canvasTextures';
import {SurfaceNodeMaterial, surfaceMaterial, worldMapped, type WorldMaterials} from './materials';
import {tagReflect} from '../render/reflectTag'; // task studio-baked-lighting-reflections-20261114-050258-01: glazing shows the cached reflection probes

export type ShapeUv = 'world' | 'face';

/** Floor grime on vertical faces (strength, height m) + world tone variation, shared by most keys. */
const WORN = {grime: [0.35, 0.45] as [number, number], macro: 0.15};

type Spec = {uv: ShapeUv; make: (mats: WorldMaterials) => THREE.Material} | {alias: ShapeMat};

// Iteration 13 (MAT-A): node materials (SurfaceNodeMaterial: other lanes' node hooks layer onto them).
const glow = (map: THREE.Texture, intensity: number, roughness: number) =>
  new SurfaceNodeMaterial({map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity, roughness, metalness: 0});
const menu = (variant: number): Spec => ({uv: 'face', make: () => glow(menuBoardTexture(variant), 0.6, 0.3)});

const SPECS: Record<ShapeMat, Spec> = {
  // Charcoal-painted steel with teal undercoat chips (matches columns/frames/bench legs).
  steelDark: {uv: 'world', make: () => surfaceMaterial('paintedSteel', {metalness: 0.3}, WORN)},
  steelBright: {uv: 'world', make: () => surfaceMaterial('brushedSteel', {metalness: 0.5}, {grime: [0.25, 0.4], macro: 0.1})},
  // Enamel-painted sheet; white so per-instance colours (stall/vending/table/booth palettes) tint it.
  accent: {uv: 'world', make: () => surfaceMaterial('paintedPanel', {metalness: 0.1}, WORN)},
  counter: {uv: 'world', make: () => surfaceMaterial('laminate', {color: 0xe2ddd3}, {grime: [0.2, 0.35], macro: 0.12})},
  panel: {uv: 'world', make: () => surfaceMaterial('paintedPanel', {color: 0x7d786e, metalness: 0.1}, WORN)},
  glass: {uv: 'world', make: () => tagReflect(surfaceMaterial('glass', {transparent: true, opacity: 0.55, depthWrite: false, metalness: 0.1}, {macro: 0.1}), 'glass')},
  screen: {uv: 'face', make: () => glow(fareScreenTexture(), 0.6, 0.25)},
  vendFront: {uv: 'face', make: () => glow(vendFrontTexture(), 0.45, 0.2)},
  porcelain: {uv: 'world', make: () => surfaceMaterial('porcelain', {}, {grime: [0.25, 0.3], macro: 0.08})},
  partition: {uv: 'world', make: () => surfaceMaterial('paintedPanel', {color: 0xa3b3ae, metalness: 0.15}, WORN)},
  // Same concrete texture as the service floors, world-mapped for stair blocks.
  concrete: {uv: 'world', make: mats => worldMapped(new SurfaceNodeMaterial({map: (mats.get('concrete') as THREE.MeshStandardMaterial).map, roughness: 0.92, metalness: 0}), {span: [2, 2], grime: [0.2, 0.3], macro: 0.15})},
  grille: {uv: 'world', make: () => surfaceMaterial('paintedSteel', {color: 0xa6a6a6, metalness: 0.35}, WORN)},
  black: {uv: 'world', make: () => surfaceMaterial('black', {}, {macro: 0.1})},
  wood: {uv: 'world', make: () => surfaceMaterial('woodVeneer', {}, WORN)},
  mirror: {uv: 'world', make: () => surfaceMaterial('mirror', {metalness: 0.35}, {macro: 0.05})},
  shutter: {uv: 'world', make: () => surfaceMaterial('shutter', {metalness: 0.35}, WORN)},
  // Storefront building blocks (lane-contracts.md).
  shopFrame: {uv: 'world', make: () => surfaceMaterial('brushedSteel', {color: 0x7a766f, metalness: 0.45}, WORN)},
  signBand: {uv: 'world', make: () => { const m = surfaceMaterial('signBand', {emissive: 0xffffff, emissiveIntensity: 0.45}); m.emissiveMap = m.map; return m; }},
  menuBoard: menu(0),
  menuBoardNoodle: menu(1),
  menuBoardCoffee: menu(2),
  menuBoardPizza: menu(3),
  shutterSteel: {alias: 'shutter'},
  kitchenSteel: {uv: 'world', make: () => surfaceMaterial('brushedSteel', {color: 0xf4f4f4, metalness: 0.5}, {grime: [0.3, 0.4], macro: 0.12})},
  laminate: {uv: 'world', make: () => surfaceMaterial('laminate', {}, {grime: [0.2, 0.35], macro: 0.12})},
  tileShop: {uv: 'world', make: () => surfaceMaterial('shopTile', {}, {grime: [0.3, 0.4], macro: 0.12})},
  quarryTile: {uv: 'world', make: () => surfaceMaterial('quarryTile', {}, {macro: 0.2})},
  woodVeneer: {alias: 'wood'},
  plasticSeat: {uv: 'world', make: () => surfaceMaterial('plastic', {color: 0xc98a2a}, {grime: [0.15, 0.3], macro: 0.1})},
  glassShopfront: {uv: 'world', make: () => tagReflect(surfaceMaterial('glass', {color: 0xdde6e8, transparent: true, opacity: 0.42, depthWrite: false, metalness: 0.1}, {macro: 0.1}), 'glass')},
  // Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT): the camping lantern's mantle — a warm self-lit glow (one graphic per face;
  // the light it casts is a light-field source, gen/annexCache.ts)
  lanternGlow: {uv: 'face', make: () => glow(lanternGlowTexture(), 1.6, 0.5)},
};

const resolve = (k: ShapeMat): ShapeMat => { const s = SPECS[k]; return 'alias' in s ? s.alias : k; };

/** How each key is UV-mapped ('face' = one graphic per box face from the mesh UVs). */
export const SHAPE_MAT_UV = Object.fromEntries(SHAPE_MAT_KEYS.map(k => {
  const s = SPECS[resolve(k)];
  return [k, 'uv' in s ? s.uv : 'world'];
})) as Record<ShapeMat, ShapeUv>;

/** Unknown keys (e.g. a newer storefront key) still render with a related material. */
function fallbackKey(key: string): ShapeMat {
  if ((SHAPE_MAT_KEYS as readonly string[]).includes(key)) return key as ShapeMat;
  if (/glass|window/i.test(key)) return 'glassShopfront';
  if (/menu/i.test(key)) return 'menuBoard';
  if (/sign|fascia/i.test(key)) return 'signBand';
  if (/shutter/i.test(key)) return 'shutter';
  if (/stainless|kitchen|bright/i.test(key)) return 'kitchenSteel';
  if (/steel|frame|metal|rail/i.test(key)) return 'steelDark';
  if (/tile|floor/i.test(key)) return 'tileShop';
  if (/wood|veneer/i.test(key)) return 'wood';
  if (/seat|plastic/i.test(key)) return 'plasticSeat';
  if (/counter|top|laminate/i.test(key)) return 'laminate';
  return 'panel';
}

const caches = new WeakMap<WorldMaterials, Map<ShapeMat, THREE.Material>>();
const warned = new Set<string>();

/** Shared material for a shape key (created on first use). Unknown keys fall back to a related key. */
export function shapeMaterial(mats: WorldMaterials, key: ShapeMat | string): THREE.Material {
  const k = fallbackKey(key);
  if (k !== key && !warned.has(key)) { warned.add(key); console.warn(`shape material "${key}" unknown; using "${k}"`); }
  const target = resolve(k);
  let cache = caches.get(mats);
  if (!cache) caches.set(mats, (cache = new Map()));
  let m = cache.get(target);
  if (!m) {
    const s = SPECS[target];
    if ('alias' in s) throw new Error(`alias chain at ${target}`);
    m = s.make(mats);
    m.name = `shape-${target}`;
    cache.set(target, m);
  }
  return m;
}

const records = new WeakMap<WorldMaterials, Readonly<Record<ShapeMat, THREE.Material>>>();

/** Record view (lazy getters) over every shape key, for builders that index by key. */
export function shapeMaterials(mats: WorldMaterials): Readonly<Record<ShapeMat, THREE.Material>> {
  let r = records.get(mats);
  if (!r) {
    const o = {} as Record<ShapeMat, THREE.Material>;
    for (const k of SHAPE_MAT_KEYS) Object.defineProperty(o, k, {get: () => shapeMaterial(mats, k), enumerable: true});
    records.set(mats, (r = o));
  }
  return r;
}
