// Task reactor-build-20261101 (lane ARCH): the Reactor's materials — the pit / gallery / room SURFACES the builder asks for by
// 'reactor-…' key (ReactorArch.material / scale) and the KIT dressing materials (archKit.ts KitMat).
//
// With the lead's Codex tileable sets resolved (archAssets.ts REACTOR_TEXTURES: colour / normal / ORM, loaded by the Reactor's
// section preload) every surface is a WORLD-MAPPED PBR SurfaceNodeMaterial over those maps (real-scale tiles on any geometry, one
// shared program per map set), tinted per use (crane / hazard yellow and black stay the repo's painted-steel set). Without them
// (Node tests, a failed fetch) the same keys fall back to the repo's EXISTING approved surface sets (tunnel concrete, painted block,
// concrete floor, painted / brushed steel, slats) with tints — never a new hand-drawn texture. Architecture surfaces get the
// station decay hooks (leak runs, grime, bloom) like the Subway's. Cached per WorldMaterials and texture-store version.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, surfaceMaterial, thinTrim, worldMapped, type WorldMaterials} from '../materials';
import {applyDecay, DECAY_PROFILES, type DecayProfile} from '../decay';
import {requestSurfaceAnisotropy} from '../../render/anisotropy';
import {REACTOR_TEXTURES, reactorTexture, reactorTextureStore, type ReactorTextureSlot} from './archAssets';
import type {KitMat} from './archKit';

/** Architecture surface keys (builder: walls / floors / ceilings / door trim of the Reactor). */
export const REACTOR_SURFACE_KEYS = [
  'reactor-wall', 'reactor-roof', 'reactor-floor', 'reactor-grating', 'reactor-deck-under', 'reactor-room-wall', 'reactor-ceil', 'reactor-trim',
] as const;
export type ReactorSurfaceKey = typeof REACTOR_SURFACE_KEYS[number];
export const isReactorKey = (k: string): k is ReactorSurfaceKey => (REACTOR_SURFACE_KEYS as readonly string[]).includes(k);

const decay = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});

/** Decay of the reactor surfaces: long rust / leak runs down the pit concrete, grime and bloom low, dusty worn decks. */
const SURFACE_DECAY: Record<ReactorSurfaceKey, DecayProfile> = {
  'reactor-wall': decay({grime: 0.55, streaks: 0.95, efflor: 0.45, stains: 0.45, cracks: 0.35, tint: [0.44, 0.36, 0.27]}),
  'reactor-roof': decay({grime: 0.5, stains: 0.7, efflor: 0.3, cracks: 0.3, tint: [0.4, 0.36, 0.3]}),
  'reactor-floor': {...DECAY_PROFILES.concrete, tint: [0.46, 0.41, 0.34]},
  'reactor-grating': decay({grime: 0.3, wear: 0.45, dust: 0.5, stains: 0.45, tint: [0.42, 0.35, 0.27]}),
  'reactor-deck-under': decay({grime: 0.35, stains: 0.6, streaks: 0.4, tint: [0.4, 0.33, 0.26]}),
  'reactor-room-wall': {...DECAY_PROFILES.paint, tint: [0.5, 0.47, 0.4]},
  'reactor-ceil': {...DECAY_PROFILES.ceilingService, tint: [0.5, 0.45, 0.37]},
  'reactor-trim': decay({grime: 0.3, tint: [0.42, 0.36, 0.3]}),
};

interface Cache { version: number; surf: Map<string, THREE.Material>; dress: Partial<Record<KitMat, THREE.Material>>; scale: Map<string, {u: number; v: number}> }
const caches = new WeakMap<WorldMaterials, Cache>();

function cacheOf(mats: WorldMaterials): Cache {
  let c = caches.get(mats);
  if (!c || c.version !== reactorTextureStore.version) caches.set(mats, (c = {version: reactorTextureStore.version, surf: new Map(), dress: {}, scale: new Map()}));
  return c;
}

/** Whether a texture slot's colour map is resolved (the Codex set is in use). */
export const reactorSlotReady = (slot: ReactorTextureSlot): boolean => !!reactorTexture(slot, 'color');

interface SlotLook { color?: number; metalness?: number; roughness?: number; grime?: [number, number]; macro?: number; normal?: number; role?: 'wall' | 'floor' }

/** A world-mapped PBR material over a resolved Codex slot (null when its colour map is not loaded). */
export function slotMaterial(slot: ReactorTextureSlot, look: SlotLook = {}, name = `reactor-${slot}`): SurfaceNodeMaterial | null {
  const color = reactorTexture(slot, 'color') as THREE.Texture | undefined;
  if (!color) return null;
  const normal = reactorTexture(slot, 'normal') as THREE.Texture | undefined, orm = reactorTexture(slot, 'orm') as THREE.Texture | undefined;
  if (look.role) requestSurfaceAnisotropy(color, look.role);
  const p: ConstructorParameters<typeof SurfaceNodeMaterial>[0] = {map: color, roughness: look.roughness ?? 1, metalness: orm ? (look.metalness ?? 1) : 0};
  if (look.color !== undefined) p.color = look.color;
  if (normal) p.normalMap = normal;
  if (orm) { p.roughnessMap = orm; p.metalnessMap = orm; }
  const m = new SurfaceNodeMaterial(p);
  if (normal) m.normalScale.set(look.normal ?? 1, look.normal ?? 1);
  m.name = name;
  return worldMapped(m, {span: [REACTOR_TEXTURES[slot].span[0], REACTOR_TEXTURES[slot].span[1]], grime: look.grime, macro: look.macro});
}

const named = <M extends THREE.Material>(m: M, name: string): M => { m.name = name; return m; };

/** The fallback surface of a key (existing approved sets) and its UV scale (null scale: world-mapped). */
function fallbackSurface(mats: WorldMaterials, key: ReactorSurfaceKey): {m: THREE.Material; scale: {u: number; v: number} | null} {
  const tinted = (base: THREE.Material, hex: number): THREE.Material => {
    const m = cloneSurfaceMaterial(base) as THREE.Material & {color?: THREE.Color};
    m.color?.setHex(hex);
    return m;
  };
  switch (key) {
    case 'reactor-wall': return {m: tinted(mats.get('tunnel'), 0xa39684), scale: mats.scale.tunnel};
    case 'reactor-roof': return {m: tinted(mats.get('tunnel'), 0x6e6862), scale: mats.scale.tunnel};
    case 'reactor-floor': return {m: tinted(mats.get('concrete'), 0x8a8276), scale: mats.scale.concrete};
    case 'reactor-room-wall': return {m: tinted(mats.get('paint'), 0x8a9282), scale: mats.scale.paint};
    case 'reactor-ceil': return {m: tinted(mats.get('ceilingService'), 0x9a948a), scale: mats.scale.ceilingService};
    case 'reactor-grating': return {m: surfaceMaterial('shutter', {color: 0x6f5f4e, metalness: 0.5}, {grime: [0.25, 0.4], macro: 0.3}), scale: null};
    case 'reactor-deck-under': return {m: surfaceMaterial('paintedSteel', {color: 0x40362d, metalness: 0.4}, {macro: 0.3}), scale: null};
    case 'reactor-trim': return {m: thinTrim(surfaceMaterial('paintedSteel', {color: 0x3a332d, metalness: 0.4}, {grime: [0.2, 0.4], macro: 0.2})), scale: null};
  }
}

/** The Codex-textured surface of a key (null when its slot is not loaded). */
function slotSurface(key: ReactorSurfaceKey): THREE.Material | null {
  switch (key) {
    case 'reactor-wall': return slotMaterial('pitConcrete', {color: 0xd8cfc4, role: 'wall', macro: 0.25, grime: [0.35, 2.2]}, key);
    case 'reactor-roof': return slotMaterial('pitConcrete', {color: 0x8a847c, role: 'wall', macro: 0.2}, key);
    case 'reactor-floor': return slotMaterial('pitConcrete', {color: 0xb0a89c, role: 'floor', macro: 0.25}, key);
    case 'reactor-grating': return slotMaterial('grating', {role: 'floor', macro: 0.3}, key);
    case 'reactor-deck-under': return slotMaterial('rustedSteel', {color: 0x8a7e72, role: 'wall', macro: 0.3}, key);
    case 'reactor-room-wall': return slotMaterial('rustedSteel', {color: 0xa8b0a0, role: 'wall', macro: 0.2, grime: [0.3, 0.9]}, key);
    case 'reactor-ceil': return slotMaterial('pitConcrete', {color: 0x9a948c, role: 'wall', macro: 0.2}, key);
    case 'reactor-trim': { const m = slotMaterial('rustedSteel', {color: 0x8a8078, macro: 0.2}, key); return m ? trackClones(thinTrim(m)) : null; }
  }
}

/** The architecture material behind a reactor surface key (cached per WorldMaterials + texture version). */
export function reactorSurfaceMaterial(mats: WorldMaterials, key: ReactorSurfaceKey): THREE.Material {
  const c = cacheOf(mats);
  let m = c.surf.get(key);
  if (m) return m;
  const s = slotSurface(key);
  if (s) { m = s; c.scale.set(key, {u: 1, v: 1}); } else { const f = fallbackSurface(mats, key); m = f.m; c.scale.set(key, f.scale ?? {u: 1, v: 1}); }
  m.name = key;
  applyDecay(m, SURFACE_DECAY[key]);
  c.surf.set(key, m);
  return m;
}

/** UV scale (m per repeat) of a reactor surface key: world-mapped surfaces ignore UVs ({1, 1}); the fallback clones use their set's. */
export function reactorSurfaceScale(mats: WorldMaterials, key: ReactorSurfaceKey): {u: number; v: number} {
  const c = cacheOf(mats);
  if (!c.scale.has(key)) reactorSurfaceMaterial(mats, key);
  return c.scale.get(key)!;
}

/** thinTrim clones of the Codex maps (anisotropy 1 for thin members): not LevelResources' own textures, released here. */
const clones = new Set<THREE.Texture>();
const trackClones = <M extends MeshStandardNodeMaterial>(m: M): M => {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    const t = m[k];
    if (t && !Object.values(reactorTextureStore.maps).includes(t)) clones.add(t);
  }
  return m;
};

/**
 * Leaving the Reactor (archInstall.ts, any other level's build): the thin-trim clones of the Codex maps are disposed and the texture
 * store emptied (LevelResources disposes the maps themselves), so the cached reactor materials rebuild on the next Reactor build.
 */
export function releaseReactorMaterials(): number {
  const n = clones.size;
  for (const t of clones) t.dispose();
  clones.clear();
  if (Object.keys(reactorTextureStore.maps).length) { reactorTextureStore.maps = {}; reactorTextureStore.version++; }
  return n;
}

/** The kit dressing materials (archKit.ts KitMat; 'marker' is per build: arch.ts). Shared, cached per WorldMaterials + texture version. */
export function reactorDress(mats: WorldMaterials): Record<Exclude<KitMat, 'marker'>, THREE.Material> {
  const c = cacheOf(mats);
  const d = c.dress;
  if (d.steel) return d as Record<Exclude<KitMat, 'marker'>, THREE.Material>;
  const thin = <M extends MeshStandardNodeMaterial>(m: M | null): M | null => (m ? trackClones(thinTrim(m)) : null);
  d.steel = named(thin(slotMaterial('rustedSteel', {color: 0xd0c4b8, macro: 0.35, grime: [0.2, 1.2]})) ?? thinTrim(surfaceMaterial('paintedSteel', {color: 0x6a5546, metalness: 0.45}, {grime: [0.3, 1.2], macro: 0.35})), 'reactor-steel');
  d.steelDark = named(thin(slotMaterial('rustedSteel', {color: 0x80766e, macro: 0.3})) ?? thinTrim(surfaceMaterial('paintedSteel', {color: 0x3c3530, metalness: 0.45}, {macro: 0.3})), 'reactor-steel-dark');
  d.yellow = named(thinTrim(surfaceMaterial('paintedSteel', {color: 0xb88c26, metalness: 0.3}, {grime: [0.25, 1.0], macro: 0.35})), 'reactor-crane-yellow');
  d.black = named(thinTrim(surfaceMaterial('paintedSteel', {color: 0x1d1c1b, metalness: 0.3}, {macro: 0.2})), 'reactor-black');
  d.pipe = named(thin(slotMaterial('rustedSteel', {color: 0x9c978c, macro: 0.4})) ?? thinTrim(surfaceMaterial('paintedSteel', {color: 0x5d5b52, metalness: 0.45}, {macro: 0.4})), 'reactor-pipe');
  d.machine = named(slotMaterial('rustedSteel', {color: 0x93a28c, macro: 0.25}) ?? surfaceMaterial('paintedPanel', {color: 0x55604f, roughness: 0.9}, {grime: [0.3, 0.6], macro: 0.25}), 'reactor-machine');
  d.grating = named(slotMaterial('grating', {macro: 0.3}) ?? surfaceMaterial('shutter', {color: 0x6f5f4e, metalness: 0.5}, {macro: 0.3}), 'reactor-grating-kit');
  d.band = named(slotMaterial('pitConcrete', {color: 0xffffff, macro: 0.2}) ?? surfaceMaterial('paintedPanel', {color: 0xffffff, roughness: 1}, {grime: [0.3, 0.6], macro: 0.25}), 'reactor-tier-band');
  d.vessel = named(slotMaterial('rustedSteel', {color: 0xb4b2aa, macro: 0.2}) ?? surfaceMaterial('brushedSteel', {color: 0x7d7c74, metalness: 0.5}, {macro: 0.2}), 'reactor-vessel');
  d.cable = named(thinTrim(surfaceMaterial('paintedSteel', {color: 0x151515, metalness: 0.1, roughness: 0.9}, {macro: 0.1})), 'reactor-cable');
  d.concrete = named(slotMaterial('pitConcrete', {color: 0x9e978c, macro: 0.2}) ?? surfaceMaterial('paintedPanel', {color: 0x77736c, roughness: 1}, {macro: 0.3}), 'reactor-concrete-kit');
  // unlit: the vessel glow (setCoreGlow drives its colour), the generators' panel lamps (instance colours)
  d.glow = named(new MeshBasicNodeMaterial({color: 0x0a1612}), 'reactor-core-glow');
  d.panelLamp = named(new MeshBasicNodeMaterial({color: 0xffffff}), 'reactor-panel-lamp');
  return d as Record<Exclude<KitMat, 'marker'>, THREE.Material>;
}

/** Sodium lamp colour at full power (linear-ish sRGB hex) and the emergency floor at power 0. */
export const LAMP = {color: 0xffa64a, emergency: 0.28, dead: 0.04} as const;

/** One tier's lamp bulb / lens material (unlit; its colour = LAMP.color x (emergency + (1 - emergency) x power)). */
export function tierBulbMaterial(level: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({color: LAMP.color});
  m.name = `reactor-lamp-tier-${level}`;
  return m;
}

/** Stencilled marker labels: one material over the per-build label atlas (alpha-tested). */
export function markerMaterial(atlas: THREE.Texture): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({map: atlas, roughness: 0.9, alphaTest: 0.5, transparent: false});
  m.name = 'reactor-marker-labels';
  return m;
}
