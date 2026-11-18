// Task studio-subway-architecture-materials-rework-20261117-072826-01 (lane TEX): THE SUBWAY ARCHITECTURE SURFACE SETS at runtime —
// the rework's Codex-generated tileable PBR sets (assets/subwayArchTextures.generated.ts: glazed tile fields and accent bands, granite /
// limestone cladding, precast concrete, enamel panels, a metal slat ceiling, terrazzo and granite floors, a plaster soffit and painted
// shotcrete rock; colour sRGB, normal + ORM linear: R ao, G roughness, B metalness; provenance assets/derivatives/subway-arch-*.json)
// loaded BEHIND THE LOADING SCREEN as the Subway's own level resources (assets/levelAssets.ts: textures/subway/** is Subway-only) and
// the world-mapped materials the Subway's finish mapper draws with them. The world/marketTextures.ts crevice recipe:
//  - a module registry (setSubwayArchTexture / subwayArchTexture; tests inject stand-in textures);
//  - a section runtime (installSubwayArchTextures(host, keysOf): one line in Game) whose preload fetches exactly the sets a layout uses,
//    racing a 6 s wait (a missing / slow set leaves its finish on the stand-in, never a stall);
//  - subwayArchMaterial: NEVER null — a SurfaceNodeMaterial over the set (world-mapped at the set's measured span), or, while the colour
//    map is not registered (Node tests, a failed fetch), a map-less stand-in at the set's measured mean albedo / roughness. One material
//    per WorldMaterials + name; a stand-in is rebuilt once the set arrives. Finishes differ only in values (tint, scales, decay): the
//    world-mapping / decay node graphs are the shared singletons (one program per map set), never per instance.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {SUBWAY_ARCH_TEXTURES, type SubwayArchTexKey} from '../assets/subwayArchTextures.generated';
import {applyDecay, type DecayProfile} from './decay';
import {SurfaceNodeMaterial, thinTrim, worldMapped, type WorldMaterials} from './materials';
import type {MarketTexHost} from './marketTextures';
import {requestSurfaceAnisotropy} from '../render/anisotropy';
import {tagReflect} from '../render/reflectTag';

export type {SubwayArchTexKey} from '../assets/subwayArchTextures.generated';
export type SubwayArchMap = 'color' | 'normal' | 'orm';
const MAPS: readonly SubwayArchMap[] = ['color', 'normal', 'orm'];
export const SUBWAY_ARCH_KEYS = Object.keys(SUBWAY_ARCH_TEXTURES) as SubwayArchTexKey[];

/** Longest wait for the sets before the world is built (then: the stand-in finishes). */
export const SUBWAY_ARCH_TEX_WAIT_MS = 6000;
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'subway';
/** Ceiling of the light-bake albedo (userData.lightAlbedo, linear) of a finish. */
const LIGHT_ALBEDO_MAX = 0.8;

const TEX = new Map<string, THREE.Texture>();
/** Registers (or clears) a loaded map of a set (the runtime; tests inject stand-in textures). */
export function setSubwayArchTexture(key: SubwayArchTexKey, map: SubwayArchMap, t: THREE.Texture | null): void {
  if (t) TEX.set(`${key}:${map}`, t); else TEX.delete(`${key}:${map}`);
}
/** A loaded map of a set (null: not delivered — the finish draws its stand-in). */
export const subwayArchTexture = (key: SubwayArchTexKey, map: SubwayArchMap): THREE.Texture | null => TEX.get(`${key}:${map}`) ?? null;
function clearAll(): void { TEX.clear(); }

/** How a finish uses its set. */
export interface SubwayArchLook {
  /** Anisotropy role of the colour map (render/anisotropy.ts); 'trim' requests none. */
  role: 'wall' | 'floor' | 'ceiling' | 'trim';
  /** Reflection class (render/reflectTag.ts): 'gloss' = the glazed tile / polished stone path, 'none' = never the probes. */
  reflect: 'none' | 'gloss';
  /** LINEAR multiplier on the map (m.color). Default white. */
  tint?: readonly [number, number, number];
  /** 30-year decay (world/decay.ts). */
  decay?: DecayProfile;
  /** World-mapping floor grime [strength, height m]. */
  grime?: [number, number];
  /** World-mapping low-frequency tone variation 0..1. */
  macro?: number;
  /** normalScale (x the set's normal map). Default 1. */
  normal?: number;
  /** Multiplier on the ORM roughness (stand-in: on the set's mean roughness). Default 1. */
  roughness?: number;
  /** Multiplier on the ORM metalness (stand-in: the uniform metalness, default 0). Default 1 with the map. */
  metalness?: number;
  /** thinTrim: anisotropy-1 clones of the maps (small relief / thin parts). */
  thin?: boolean;
  /**
   * Chroma of the light-bake albedo (userData.lightAlbedo: what the enhanced bounce, the reflection probes and the traced flashlight take
   * the finish to be) against the drawn colour, its luminance kept (world/subwayFinish.ts CAVERN_BOUNCE_CHROMA). Default 1: as drawn.
   */
  bounceChroma?: number;
}

const cache = new WeakMap<WorldMaterials, Map<string, SurfaceNodeMaterial>>();

/** The linear light-bake albedo of a finish: the set's mean x tint, capped (`chroma` < 1: its colour pulled toward its own luminance). */
export function subwayArchAlbedo(key: SubwayArchTexKey, tint?: readonly [number, number, number], chroma = 1): [number, number, number] {
  const m = SUBWAY_ARCH_TEXTURES[key].mean, t = tint ?? [1, 1, 1];
  const a = [0, 1, 2].map(i => Math.min(LIGHT_ALBEDO_MAX, m[i] * t[i])) as [number, number, number];
  if (chroma === 1) return a;
  const l = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  return a.map(v => Math.min(LIGHT_ALBEDO_MAX, Math.max(0, l + (v - l) * chroma))) as [number, number, number];
}

/**
 * The world-mapped PBR finish `name` over set `key` (never null). With the set's colour map registered: map / normal / ORM (roughness
 * and metalness read the ORM's G / B) at the set's span; without it: a map-less stand-in at the set's mean albedo x tint and mean
 * roughness. One material per WorldMaterials + name (a stand-in is replaced once the map is registered).
 */
export function subwayArchMaterial(mats: WorldMaterials, key: SubwayArchTexKey, name: string, look: SubwayArchLook): SurfaceNodeMaterial {
  const set = SUBWAY_ARCH_TEXTURES[key];
  const color = subwayArchTexture(key, 'color');
  let per = cache.get(mats);
  if (!per) cache.set(mats, (per = new Map()));
  const cached = per.get(name);
  if (cached && cached.userData.subwayArchTex === key && cached.userData.subwayArchSource === (color?.uuid ?? null)) return cached;
  const tint = look.tint ?? [1, 1, 1];
  let m: SurfaceNodeMaterial;
  if (color) {
    const normal = subwayArchTexture(key, 'normal'), orm = subwayArchTexture(key, 'orm');
    if (look.role !== 'trim' && !look.thin) requestSurfaceAnisotropy(color, look.role);
    m = new SurfaceNodeMaterial({map: color, roughness: look.roughness ?? 1, metalness: orm ? (look.metalness ?? 1) : 0,
      ...(normal ? {normalMap: normal} : {}), ...(orm ? {roughnessMap: orm, metalnessMap: orm} : {roughness: set.rough * (look.roughness ?? 1)})});
    if (normal) m.normalScale.set(look.normal ?? 1, look.normal ?? 1);
  } else {
    m = new SurfaceNodeMaterial({roughness: Math.min(1, set.rough * (look.roughness ?? 1)), metalness: look.metalness ?? 0});
  }
  m.color.setRGB(color ? tint[0] : set.mean[0] * tint[0], color ? tint[1] : set.mean[1] * tint[1], color ? tint[2] : set.mean[2] * tint[2]);
  m.name = name;
  m.userData.subwayArchTex = key;
  m.userData.subwayArchSource = color?.uuid ?? null; // (a uuid, not the texture: Material.copy JSON-clones userData)
  m.userData.lightAlbedo = subwayArchAlbedo(key, tint, look.bounceChroma);
  worldMapped(m, {span: [set.span[0], set.span[1]], grime: look.grime, macro: look.macro});
  if (look.decay) applyDecay(m, look.decay);
  tagReflect(m, look.reflect);
  if (look.thin) thinTrim(m);
  per.set(name, m);
  return m;
}

/** The sets' section runtime: preloads the sets a layout's finishes use (behind the loading screen). */
export class SubwayArchTextures {
  readonly counts = {loaded: 0, missing: 0};
  constructor(readonly host: MarketTexHost) {}

  /** `keysOf(layout)`: the sets a layout draws ([] = none: inert, the registry is cleared). */
  install(keysOf: (layout: StationLayout) => SubwayArchTexKey[]): this {
    this.host.sectionPreloads?.push(layout => {
      const keys = keysOf(layout);
      if (!keys.length) { clearAll(); return Promise.resolve(); }
      return Promise.race([this.preload(keys), new Promise<void>(r => setTimeout(r, SUBWAY_ARCH_TEX_WAIT_MS))]);
    });
    return this;
  }

  /** Every map of `keys` (colour sRGB / anisotropy 8, normal + ORM linear / anisotropy 4, repeating); never rejects. */
  async preload(keys: readonly SubwayArchTexKey[]): Promise<void> {
    // a previous level's maps were released with it: this layout's own loads register them again
    clearAll();
    const want = [...new Set(keys)].filter(k => k in SUBWAY_ARCH_TEXTURES);
    await Promise.all(want.flatMap(k => MAPS.map(async m => {
      const t = await this.host.levelResources.load(LEVEL, SUBWAY_ARCH_TEXTURES[k][m].url, {srgb: m === 'color', repeat: true, anisotropy: m === 'color' ? 8 : 4}).catch(() => null);
      setSubwayArchTexture(k, m, t);
      if (t) this.counts.loaded++; else this.counts.missing++;
    })));
  }
}

/** Installs the Subway architecture sets' preload into a Game (one call in the Game constructor). */
export function installSubwayArchTextures(host: MarketTexHost, keysOf: (layout: StationLayout) => SubwayArchTexKey[]): SubwayArchTextures {
  return new SubwayArchTextures(host).install(keysOf);
}
