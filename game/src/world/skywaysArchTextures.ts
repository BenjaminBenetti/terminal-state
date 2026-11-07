// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): the Skyways rework's TEXTURED COURT / BRIDGE FINISHES — the Codex-authored
// tileable surface textures (assets/skywaysArchTextures.generated.ts: herringbone brick floor, red-brown brick wall, dark timber slat
// ceiling, clay paver bridge floor; provenance in assets/derivatives/skyways-arch-*.json) loaded BEHIND THE LOADING SCREEN as level-only
// resources (textures/skyways/arch/*.jpg through LevelResources, released with the level; never a mid-play fetch) and the materials
// world/skywaysArch.ts builds on them:
//  - a section runtime (installSkywaysArchTextures: one tagged line in Game) whose section preload fetches the four textures for every
//    layout-version-3 Skyways layout (roofed bridges / skylit courts) and registers them here (setSkywaysArchTexture) before the world
//    is built; a missing / slow texture leaves that finish on its office-program stand-in (SkywaysArch picks the key at build time);
//  - skywaysTexturedMaterial: a SurfaceNodeMaterial over the texture (the builder's world-mapped uvs / the texture span from
//    SkywaysArch.scale) with the office architecture's 30-year decay (world/decay.ts applyDecay: grime toward the floor, streaks, stains,
//    worn lanes, dust in the corners, cracks) — the same deterioration as every other Skyways finish. One material per finish, cached
//    per WorldMaterials and texture.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {SKYWAYS_ARCH_TEXTURES, type SkywaysArchTextureKey} from '../assets/skywaysArchTextures.generated';
import {applyDecay, type DecayProfile} from './decay';
import {SurfaceNodeMaterial, type WorldMaterials} from './materials';
import {OFFICE_DECAY} from './officeArch';

/** Longest wait for the textures before the world is built (then: the stand-in finishes). */
export const SKYWAYS_ARCH_TEX_WAIT_MS = 6000;
/** The LevelResources owner key (a named constant: the release packager reads a literal first `load(...)` argument as an asset path). */
const LEVEL = 'skyways';

const TEX = new Map<SkywaysArchTextureKey, THREE.Texture>();
/** Registers (or clears) a loaded texture (the runtime; tests inject stand-in textures). */
export function setSkywaysArchTexture(key: SkywaysArchTextureKey, t: THREE.Texture | null): void {
  if (t) TEX.set(key, t); else TEX.delete(key);
}
/** The loaded texture of a finish (null: not delivered: the stand-in finish). */
export const skywaysArchTexture = (key: SkywaysArchTextureKey): THREE.Texture | null => TEX.get(key) ?? null;

/** Does a layout use the rework finishes (roofed bridges / skylights: layout version 3)? */
export const usesSkywaysArchTextures = (layout: Pick<StationLayout, 'skyways'>): boolean =>
  !!layout.skyways && (layout.skyways.bridges.some(b => b.roof) || !!layout.skyways.skylights?.length);

/** Per-surface material parameters: roughness and the decay profile. */
const SPEC: Readonly<Record<SkywaysArchTextureKey, {rough: number; decay: DecayProfile}>> = {
  herringbone: {rough: 0.55, decay: {...OFFICE_DECAY.hard, tile: 0}},
  pavers: {rough: 0.6, decay: {...OFFICE_DECAY.hard, tile: 0}},
  brickWall: {rough: 0.92, decay: OFFICE_DECAY.wall},
  woodSlats: {rough: 0.8, decay: OFFICE_DECAY.ceiling},
};

const cache = new WeakMap<WorldMaterials, Map<string, SurfaceNodeMaterial>>();
/** The textured finish material of `key` (null: the texture is not loaded). One per WorldMaterials + texture. */
export function skywaysTexturedMaterial(mats: WorldMaterials, key: SkywaysArchTextureKey, name: string): SurfaceNodeMaterial | null {
  const t = skywaysArchTexture(key);
  if (!t) return null;
  let per = cache.get(mats);
  if (!per) cache.set(mats, (per = new Map()));
  let m = per.get(name);
  if (m && m.map === t) return m;
  m = new SurfaceNodeMaterial({map: t, roughness: SPEC[key].rough, metalness: 0});
  m.name = name;
  m.userData.skywaysArchTexture = key;
  applyDecay(m, SPEC[key].decay);
  per.set(name, m);
  return m;
}

/** The span (m per repeat, u x v) of a finish texture. */
export const skywaysArchSpan = (key: SkywaysArchTextureKey): {u: number; v: number} => ({u: SKYWAYS_ARCH_TEXTURES[key].span[0], v: SKYWAYS_ARCH_TEXTURES[key].span[1]});

export interface SkywaysArchTexHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>};
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

/** The section runtime: preloads the finish textures of a layout-version-3 Skyways layout (behind the loading screen). */
export class SkywaysArchTextureRuntime {
  readonly counts = {loaded: 0, missing: 0};
  constructor(readonly host: SkywaysArchTexHost) {}

  install(): this {
    this.host.sectionPreloads?.push(layout => (usesSkywaysArchTextures(layout) ? Promise.race([this.preload(), new Promise<void>(r => setTimeout(r, SKYWAYS_ARCH_TEX_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** Every finish texture (sRGB, repeating); never rejects. */
  async preload(): Promise<void> {
    // a previous level's textures were released with it: this layout's own loads register them again
    for (const key of Object.keys(SKYWAYS_ARCH_TEXTURES) as SkywaysArchTextureKey[]) setSkywaysArchTexture(key, null);
    await Promise.all((Object.keys(SKYWAYS_ARCH_TEXTURES) as SkywaysArchTextureKey[]).map(async key => {
      const t = await this.host.levelResources.load(LEVEL, SKYWAYS_ARCH_TEXTURES[key].url, {srgb: true, repeat: true}).catch(() => null);
      setSkywaysArchTexture(key, t);
      if (t) this.counts.loaded++; else this.counts.missing++;
    }));
  }
}

/** Installs the finish-texture runtime into a Game (one call in the Game constructor). */
export function installSkywaysArchTextures(host: SkywaysArchTexHost): SkywaysArchTextureRuntime {
  return new SkywaysArchTextureRuntime(host).install();
}
