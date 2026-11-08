// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET LOOK — the finish mapper of the market layout (the
// builder's market branches ask MarketArch, exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch on their levels; null on every
// other level). A salvaged railway shed people live in:
//  - every shed / stall-row wall: salvaged corrugated metal (faded oxide red / teal / cream / galvanized sheets, riveted laps, rust);
//  - the stall alcoves and the rooms under the deck: salvaged plywood walls, the deck's underside boards over the rooms below;
//  - the shed roof over the platform, the square and the deck, the stall / gate ceilings: corrugated roof sheeting seen from below;
//  - floors: the shed's bare concrete (never the station's terrazzo), the housing deck's plywood boards; the platform keeps the
//    station's platform slab and safety edge (the train still docks at a real platform); the track bed keeps its ballast and walls;
//  - door frames: dark rusted steel.
// The textured finishes are the Codex-authored tileable textures (world/marketTextures.ts; a plain stand-in colour while one is not
// loaded). The keys are arch-owned for bullet impacts (world/finishAt.ts, damage/impactFinish.ts: steel / wood) and never take a station
// wall treatment (world/wallDetailPlan.ts).

import * as THREE from 'three';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, type WorldMaterials} from './materials';
import {marketSpan, marketTexture, marketTexturedMaterial} from './marketTextures';
import type {MarketTextureKey} from '../assets/marketTextures.generated';

/** Finish keys (one material each). */
export const MARKET_KEYS = {wall: 'market-wall', roof: 'market-roof', ply: 'market-ply', deck: 'market-deck', trim: 'market-trim'} as const;
/** Plain stand-in colours (sRGB) while a texture is not loaded: weathered red-brown sheet metal, galvanized grey, weathered plywood. */
export const MARKET_STANDIN = {wall: 0x7a4b3a, roof: 0x6f706c, ply: 0x8a7458, trim: 0x3b3430} as const;

/** What a market area is, for its finishes ('track': the builder's own rule). */
export type MarketClass = 'shed' | 'platform' | 'stall' | 'under' | 'deck' | 'track';

/** The class of an area of a market layout. */
export function marketAreaClass(a: Area | undefined): MarketClass {
  if (!a) return 'track';
  if ((a.level ?? 0) === 1) return 'deck';
  if (a.kind === 'platform') return 'platform';
  if (a.type === 'shop') return 'stall';
  if (a.kind === 'room') return 'under';
  return 'shed';
}

const isMarketKey = (k: string) => k.startsWith('market-');

interface FaceLike { level: number; area: number; finish: string; y0: number; y1: number; slope?: unknown }

export class MarketArch {
  private readonly materials = new Map<string, THREE.Material>();
  private readonly classCache = new Map<number, MarketClass>();

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): MarketArch | null {
    return layout.market ? new MarketArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {}

  classOf(areaId: number): MarketClass {
    let c = this.classCache.get(areaId);
    if (c === undefined) this.classCache.set(areaId, (c = marketAreaClass(areaId >= 0 ? this.layout.areas[areaId] : undefined)));
    return c;
  }

  // --- builder hooks ------------------------------------------------------------------------

  /** Wall faces: corrugated metal (shed, platform back wall, deck), plywood (stall alcoves, under-deck rooms); the track bed's faces
   *  below the platform line keep the builder's rule. */
  remapFaces<F extends FaceLike>(faces: F[]): F[] {
    return faces.map(f => {
      const cls = this.classOf(f.area);
      if (cls === 'track' || f.y1 <= 0.02) return f;
      return {...f, finish: cls === 'stall' || cls === 'under' ? MARKET_KEYS.ply : MARKET_KEYS.wall};
    });
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule — the platform slab, the track bed). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const cls = this.classOf(lvl.grid.area[i]);
    if (cls === 'deck') return MARKET_KEYS.deck;
    if (cls === 'platform' || cls === 'track') return null;
    return 'concrete'; // the shed's bare concrete (a station key: the builder's material)
  }

  /** Ceiling key of a ceiling run: the roof sheeting, the plywood underside of the deck over the rooms below. */
  ceilKey(L: number, areaId: number): string | null {
    if (!this.levels[L]) return null;
    return this.classOf(areaId) === 'under' ? MARKET_KEYS.ply : MARKET_KEYS.roof;
  }

  /** Soffit of a door opening: the roof sheeting (stall / gate heads). */
  doorCeilKey(L: number): string | null {
    return this.levels[L] ? MARKET_KEYS.roof : null;
  }

  /** Door frame trim: dark rusted steel. */
  doorTrimKey(): string {
    return MARKET_KEYS.trim;
  }

  /** Texture scale (m per repeat) of a market key; undefined for any other key. */
  scale(key: string): {u: number; v: number} | undefined {
    if (!isMarketKey(key)) return undefined;
    const t = this.texOf(key);
    return t ? marketSpan(t) : {u: 1, v: 1};
  }

  private texOf(key: string): MarketTextureKey | null {
    return key === MARKET_KEYS.wall ? 'wall' : key === MARKET_KEYS.roof ? 'roof' : key === MARKET_KEYS.ply || key === MARKET_KEYS.deck ? 'ply' : null;
  }

  /** The material behind a market key (built on first use); undefined for any other key. */
  material(key: string): THREE.Material | undefined {
    if (!isMarketKey(key)) return undefined;
    let m = this.materials.get(key);
    if (!m) {
      const t = this.texOf(key);
      if (key === MARKET_KEYS.trim) {
        m = thinTrim(surfaceMaterial('paintedSteel', {color: MARKET_STANDIN.trim, metalness: 0.4}, {grime: [0.3, 0.6], macro: 0.15}));
        m.name = key;
      } else if (t && marketTexture(t)) m = marketTexturedMaterial(this.mats, t, key)!;
      else {
        m = new SurfaceNodeMaterial({color: t === 'roof' ? MARKET_STANDIN.roof : t === 'ply' ? MARKET_STANDIN.ply : MARKET_STANDIN.wall, roughness: 0.85, metalness: t === 'ply' ? 0 : 0.2});
        m.name = key;
      }
      this.materials.set(key, m);
    }
    return m;
  }

  /** Mesh name of a market key's architecture meshes (undefined: the builder's 'arch-…' name). */
  meshName(_key: string): string | undefined { return undefined; }
}
