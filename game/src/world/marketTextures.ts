// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's SURFACE TEXTURES — the Codex-authored tileable
// textures (assets/marketTextures.generated.ts: salvaged corrugated-metal walls, the corrugated shed roof, salvaged plywood, the patched
// canvas awning tarp; provenance assets/derivatives/market-textures.json) loaded BEHIND THE LOADING SCREEN as level-only resources
// (textures/market/*.jpg through LevelResources, released with the level; never a mid-play fetch) and the materials world/marketArch.ts /
// world/marketVisuals.ts build on them — the Skyways rework's recipe (world/skywaysArchTextures.ts):
//  - a section runtime (installMarketTextures: one tagged line in Game) whose section preload fetches the market textures for a market
//    layout and registers them here before the world is built; a missing / slow texture leaves that finish on its plain stand-in;
//  - marketTexturedMaterial: a SurfaceNodeMaterial over the texture (the builder's uvs / the texture span from MarketArch.scale) with the
//    shared 30-year decay hook (world/decay.ts applyDecay: grime toward the floor, streaks, stains). One material per finish, cached per
//    WorldMaterials and texture.

// Task studio-survivor-market-crevice-20261116-074419 (lane ARCH): layout version 5 (THE CREVICE, gen/market/v5/) also takes the
// Reactor family's EXISTING Codex PBR surface sets — the board-formed pit concrete (the crevice's cast walls, floors, the hall vault), the
// mine rock (rock-cut backrooms, the crevice's top, the chasm bed) and the rusted steel plate (stair landings / treads, deck undersides):
// colour / normal / ORM, loaded by this same section preload under the market's level key (assets/levelAssets.ts lets the market load
// exactly those texture files, never the Reactor's models) and drawn WORLD-MAPPED with tints (processing only: no new art). Versions 1-4
// load and draw exactly what they did.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import {MARKET_TEXTURES, type MarketTextureKey} from '../assets/marketTextures.generated';
import {REACTOR_TEXTURES} from '../assets/reactorKit.generated';
import {REACTOR_X_TEXTURES} from '../assets/reactorExpansionKit.generated';
import {applyDecay, type DecayProfile} from './decay';
import {SurfaceNodeMaterial, worldMapped, type WorldMaterials} from './materials';
import {OFFICE_DECAY} from './officeArch';
import {requestSurfaceAnisotropy} from '../render/anisotropy';

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
  rib: {rough: 0.7, metal: 0.3, decay: OFFICE_DECAY.wall}, // (version 2's container walls: the roof sheet turned upright)
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

// --- Version 5 (task studio-survivor-market-crevice-20261116-074419, lane ARCH): the crevice's PBR sets ------------------------------

/** The crevice's surface sets: the Reactor family's existing Codex sets (colour sRGB, normal + ORM linear: R ao, G roughness, B metal). */
export type CreviceSlot = 'concrete' | 'rock' | 'steel';
export type CreviceMap = 'color' | 'normal' | 'orm';
/** Files and world tile span (m): board-formed concrete 3 m (its board courses ~0.4 m), broken rock 3.2 m, riveted plate 1.6 m. */
export const CREVICE_TEXTURES: Readonly<Record<CreviceSlot, {readonly color: string; readonly normal: string; readonly orm: string; readonly span: readonly [number, number]}>> = {
  concrete: {...REACTOR_TEXTURES['pit-concrete'], span: [3, 3]},
  rock: {...REACTOR_X_TEXTURES['mine-rock'], span: [3.2, 3.2]},
  steel: {...REACTOR_TEXTURES['rusted-steel'], span: [1.6, 1.6]},
};
const CREVICE_SLOTS = Object.keys(CREVICE_TEXTURES) as CreviceSlot[];
const CREV_TEX = new Map<string, THREE.Texture>();
/** Registers (or clears) a loaded crevice map (the runtime; tests inject stand-ins). */
export function setCreviceTexture(slot: CreviceSlot, map: CreviceMap, t: THREE.Texture | null): void {
  if (t) CREV_TEX.set(`${slot}:${map}`, t); else CREV_TEX.delete(`${slot}:${map}`);
}
/** A loaded crevice map (null: not delivered — the arch's stand-in finish). */
export const creviceTexture = (slot: CreviceSlot, map: CreviceMap): THREE.Texture | null => CREV_TEX.get(`${slot}:${map}`) ?? null;
/** Does a layout draw the crevice look (a version-5 / 6 market with its shape record)? */
export const usesCreviceTextures = (layout: Pick<StationLayout, 'market'>): boolean => (layout.market?.v ?? 1) >= 5 && !!layout.market!.crevice;

/** How a crevice finish uses its set: a LINEAR tint (multiplies the map), metal / roughness scale, normal strength, world tone variation. */
export interface CreviceLook {
  tint: readonly [number, number, number];
  metalness?: number;
  roughness?: number;
  normal?: number;
  macro?: number;
  grime?: [number, number];
  role: 'wall' | 'floor';
  decay: DecayProfile;
}

/**
 * A world-mapped PBR material over a crevice set (null while its colour map is not loaded). One per WorldMaterials + finish name (shared
 * program per map set: finishes of one set differ only in values).
 */
export function creviceMaterial(mats: WorldMaterials, slot: CreviceSlot, name: string, look: CreviceLook): SurfaceNodeMaterial | null {
  const color = creviceTexture(slot, 'color');
  if (!color) return null;
  let per = cache.get(mats);
  if (!per) cache.set(mats, (per = new Map()));
  const cached = per.get(name);
  if (cached && cached.map === color) return cached;
  const normal = creviceTexture(slot, 'normal'), orm = creviceTexture(slot, 'orm');
  requestSurfaceAnisotropy(color, look.role);
  const m = new SurfaceNodeMaterial({map: color, roughness: look.roughness ?? 1, metalness: orm ? (look.metalness ?? 0) : 0, ...(normal ? {normalMap: normal} : {}), ...(orm ? {roughnessMap: orm, metalnessMap: orm} : {})});
  if (normal) m.normalScale.set(look.normal ?? 1, look.normal ?? 1);
  m.color.setRGB(look.tint[0], look.tint[1], look.tint[2]);
  m.name = name;
  m.userData.marketTexture = `crevice:${slot}`;
  worldMapped(m, {span: [CREVICE_TEXTURES[slot].span[0], CREVICE_TEXTURES[slot].span[1]], grime: look.grime, macro: look.macro});
  applyDecay(m, look.decay);
  per.set(name, m);
  return m;
}

export interface MarketTexHost {
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean; anisotropy?: number}): Promise<THREE.Texture | null>};
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
}

/** The section runtime: preloads the market textures of a market layout (behind the loading screen). */
export class MarketTextureRuntime {
  readonly counts = {loaded: 0, missing: 0};
  constructor(readonly host: MarketTexHost) {}

  install(): this {
    this.host.sectionPreloads?.push(layout => (usesMarketTextures(layout) ? Promise.race([this.preload(layout), new Promise<void>(r => setTimeout(r, MARKET_TEX_WAIT_MS))]) : Promise.resolve()));
    return this;
  }

  /** Every finish texture (sRGB, repeating); never rejects. (Version 5: + the crevice's PBR sets.) */
  async preload(layout?: Pick<StationLayout, 'market'>): Promise<void> {
    // a previous level's textures were released with it: this layout's own loads register them again
    for (const key of Object.keys(MARKET_TEXTURES) as MarketTextureKey[]) setMarketTexture(key, null);
    for (const s of CREVICE_SLOTS) for (const m of ['color', 'normal', 'orm'] as const) setCreviceTexture(s, m, null);
    const crevice = !!layout && usesCreviceTextures(layout);
    await Promise.all([
      ...(Object.keys(MARKET_TEXTURES) as MarketTextureKey[]).map(async key => {
        const t = await this.host.levelResources.load(LEVEL, MARKET_TEXTURES[key].url, {srgb: true, repeat: true}).catch(() => null);
        setMarketTexture(key, t);
        if (t) this.counts.loaded++; else this.counts.missing++;
      }),
      // (task studio-survivor-market-crevice-20261116-074419, lane ARCH) version 5: the crevice's sets (colour sRGB, data maps linear)
      ...(crevice ? CREVICE_SLOTS.flatMap(s => (['color', 'normal', 'orm'] as const).map(async m => {
        const t = await this.host.levelResources.load(LEVEL, CREVICE_TEXTURES[s][m], {srgb: m === 'color', repeat: true, anisotropy: m === 'color' ? 8 : 4}).catch(() => null);
        setCreviceTexture(s, m, t);
        if (t) this.counts.loaded++; else this.counts.missing++;
      })) : []),
    ]);
  }
}

/** Installs the market texture runtime into a Game (one call in the Game constructor). */
export function installMarketTextures(host: MarketTexHost): MarketTextureRuntime {
  return new MarketTextureRuntime(host).install();
}
