// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's SURFACE TEXTURES — the Codex-authored tileable
// textures (assets/marketTextures.generated.ts: salvaged corrugated-metal walls, the corrugated shed roof, salvaged plywood, the patched
// canvas awning tarp; provenance assets/derivatives/market-textures.json) loaded BEHIND THE LOADING SCREEN as level-only resources
// (textures/market/*.jpg through LevelResources, released with the level; never a mid-play fetch) and the materials world/marketArch.ts /
// world/marketVisuals.ts build on them — the Skyways rework's recipe (world/skywaysArchTextures.ts):
//  - a section runtime (installMarketTextures: one tagged line in Game) whose section preload fetches the four textures for a market
//    layout and registers them here before the world is built; a missing / slow texture leaves that finish on its plain stand-in;
//  - marketTexturedMaterial: a SurfaceNodeMaterial over the texture (the builder's uvs / the texture span from MarketArch.scale) with the
//    shared 30-year decay hook (world/decay.ts applyDecay: grime toward the floor, streaks, stains). One material per finish, cached per
//    WorldMaterials and texture.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {MARKET_TEXTURES, type MarketTextureKey} from '../assets/marketTextures.generated';
import {applyDecay, type DecayProfile} from './decay';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {OFFICE_DECAY} from './officeArch';

/** Longest wait for the textures before the world is built (then: the stand-in finishes). */
export const MARKET_TEX_WAIT_MS = 6000;
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'market';

const TEX = new Map<MarketTextureKey, THREE.Texture>();
/** Registers (or clears) a loaded texture (the runtime; tests inject stand-in textures). */
export function setMarketTexture(key: MarketTextureKey, t: THREE.Texture | null): void {
  if (t) TEX.set(key, t); else TEX.delete(key);
}
/** The loaded texture of a finish (null: not delivered: the stand-in finish). */
export const marketTexture = (key: MarketTextureKey): THREE.Texture | null => TEX.get(key) ?? null;

/** Does a layout use the market textures (a Survivor Market layout)? */
export const usesMarketTextures = (layout: Pick<StationLayout, 'market'>): boolean => !!layout.market;

/** Per-surface material parameters: roughness / metalness and the decay profile. */
const SPEC: Readonly<Record<MarketTextureKey, {rough: number; metal: number; decay: DecayProfile; double?: boolean}>> = {
  wall: {rough: 0.72, metal: 0.25, decay: OFFICE_DECAY.wall},
  roof: {rough: 0.7, metal: 0.3, decay: OFFICE_DECAY.ceiling},
  ply: {rough: 0.88, metal: 0, decay: OFFICE_DECAY.wall},
  tarp: {rough: 0.95, metal: 0, decay: OFFICE_DECAY.ceiling, double: true},
};

const cache = new WeakMap<WorldMaterials, Map<string, SurfaceNodeMaterial>>();
/** The textured finish material of `key` (null: the texture is not loaded). One per WorldMaterials + texture + name. */
export function marketTexturedMaterial(mats: WorldMaterials, key: MarketTextureKey, name: string, tint?: THREE.Color): SurfaceNodeMaterial | null {
  const t = marketTexture(key);
  if (!t) return null;
  let per = cache.get(mats);
  if (!per) cache.set(mats, (per = new Map()));
  let m = per.get(name);
  if (m && m.map === t) return m;
  m = new SurfaceNodeMaterial({map: t, roughness: SPEC[key].rough, metalness: SPEC[key].metal, ...(SPEC[key].double ? {side: THREE.DoubleSide} : {})});
  if (tint) m.color.copy(tint); // (task studio-market-rework-20261108-074144-01: a version-2 container paint over the same texture)
  m.name = name;
  m.userData.marketTexture = key;
  applyDecay(m, SPEC[key].decay);
  per.set(name, m);
  return m;
}

/** The span (m per repeat, u x v) of a finish texture. */
export const marketSpan = (key: MarketTextureKey): {u: number; v: number} => ({u: MARKET_TEXTURES[key].span[0], v: MARKET_TEXTURES[key].span[1]});

export interface MarketTexHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>};
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

/** The section runtime: preloads the market textures of a market layout (behind the loading screen). */
export class MarketTextureRuntime {
  readonly counts = {loaded: 0, missing: 0};
  constructor(readonly host: MarketTexHost) {}

  install(): this {
    this.host.sectionPreloads?.push(layout => (usesMarketTextures(layout) ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, MARKET_TEX_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** Every finish texture (sRGB, repeating); never rejects. */
  async preload(): Promise<void> {
    // a previous level's textures were released with it: this layout's own loads register them again
    for (const key of Object.keys(MARKET_TEXTURES) as MarketTextureKey[]) setMarketTexture(key, null);
    await Promise.all((Object.keys(MARKET_TEXTURES) as MarketTextureKey[]).map(async key => {
      const t = await this.host.levelResources.load(LEVEL, MARKET_TEXTURES[key].url, {srgb: true, repeat: true}).catch(() => null);
      setMarketTexture(key, t);
      if (t) this.counts.loaded++; else this.counts.missing++;
    }));
  }
}

/** Installs the market texture runtime into a Game (one call in the Game constructor). */
export function installMarketTextures(host: MarketTexHost): MarketTextureRuntime {
  return new MarketTextureRuntime(host).install();
}
