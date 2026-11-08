// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET LOOK — the finish mapper of the market layout (the
// builder's market branches ask MarketArch, exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch on their levels; null on every
// other level). A salvaged railway shed people live in:
//  - every shed / stall-row wall: salvaged corrugated metal (faded oxide red / teal / cream / galvanized sheets, riveted laps, rust);
//  - the stall alcoves and the rooms under the deck: salvaged plywood walls, the deck's underside boards over the rooms below;
//  - the shed roof over the platform, the square and the deck, the stall / gate ceilings: corrugated roof sheeting seen from below;
//  - floors: the shed's bare concrete (never the station's terrazzo), the housing deck's plywood boards; the platform keeps the
//    station's platform slab and safety edge (the train still docks at a real platform); the track bed keeps its ballast and walls;
//  - door frames: dark rusted steel.
// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): layout version 2 (the dense container settlement, gen/market/v2/) keeps the
// same keys and textures and adds the CONTAINER PAINTS: every exterior wall a lane / catwalk / rooftop / the platform sees takes the
// paint of the container it belongs to (market-cont-<n>: the galvanized corrugated sheet or the salvaged corrugated patchwork, tinted —
// processing of the existing Codex textures, no new art), so the stacks read as an assemblage of separate containers; container and
// home interiors are plywood-lined, container floors plywood, the rooftops corrugated steel, the lanes bare concrete.
// The textured finishes are the Codex-authored tileable textures (world/marketTextures.ts; a plain stand-in colour while one is not
// loaded). The keys are arch-owned for bullet impacts (world/finishAt.ts, damage/impactFinish.ts: steel / wood) and never take a station
// wall treatment (world/wallDetailPlan.ts).

import * as THREE from 'three';
import {SOLID} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, type WorldMaterials} from './materials';
import {marketSpan, marketTexture, marketTexturedMaterial} from './marketTextures';
import type {MarketTextureKey} from '../assets/marketTextures.generated';

/** Finish keys (one material each). */
export const MARKET_KEYS = {wall: 'market-wall', roof: 'market-roof', ply: 'market-ply', deck: 'market-deck', trim: 'market-trim'} as const;
/** Plain stand-in colours (sRGB) while a texture is not loaded: weathered red-brown sheet metal, galvanized grey, weathered plywood. */
export const MARKET_STANDIN = {wall: 0x7a4b3a, roof: 0x6f706c, ply: 0x8a7458, trim: 0x3b3430} as const;

/**
 * Task studio-market-rework-20261108-074144-01: the container paints of layout version 2 (texture, linear tint scale). The galvanized
 * sheet ('rib': the roof source turned a quarter turn, so its ribs run up the wall like a container's) is tinted to the usual
 * shipping-container colours; the patchwork keeps its own colours (lightly warmed / cooled).
 */
export const MARKET_PAINTS: readonly {tex: MarketTextureKey; color: number; gain: number}[] = [
  {tex: 'wall', color: 0xffffff, gain: 1}, {tex: 'rib', color: 0xc4573c, gain: 1.7}, {tex: 'rib', color: 0x40709f, gain: 1.7},
  {tex: 'rib', color: 0x5a8a4c, gain: 1.7}, {tex: 'rib', color: 0xd9a63a, gain: 1.6}, {tex: 'rib', color: 0xe4ded0, gain: 1.45},
  {tex: 'wall', color: 0xd8e2e8, gain: 1}, {tex: 'rib', color: 0x8c3a30, gain: 1.7},
];
export const marketPaintKey = (i: number) => `market-cont-${i}`;

/** What a market area is, for its finishes ('track': the builder's own rule). Version 2 (task studio-market-rework-20261108-074144-01):
 *  'lane' (lanes, alleys, the yard, the stairs), 'gate', 'container' (a ground container: a shop, the kitchen ...), 'catwalk' (catwalks,
 *  bridges), 'home' (an upper container), 'roof' (the rooftops). */
export type MarketClass = 'shed' | 'platform' | 'stall' | 'under' | 'deck' | 'track' | 'lane' | 'gate' | 'container' | 'catwalk' | 'home' | 'roof';

/** The class of an area of a market layout. */
export function marketAreaClass(a: Area | undefined): MarketClass {
  if (!a) return 'track';
  if ((a.level ?? 0) === 1) return 'deck';
  if (a.kind === 'platform') return 'platform';
  if (a.type === 'shop') return 'stall';
  if (a.kind === 'room') return 'under';
  return 'shed';
}

/** Task studio-market-rework-20261108-074144-01: the class of an area of a version-2 market layout. */
export function settleAreaClass(a: Area | undefined): MarketClass {
  if (!a) return 'track';
  const lv = a.level ?? 0;
  if (lv === 2) return 'roof';
  if (lv === 1) return a.kind === 'room' ? 'home' : 'catwalk';
  if (a.kind === 'platform') return 'platform';
  if (a.kind === 'room') return 'container';
  if (a.type === 'passage') return 'gate';
  return 'lane';
}
/** Version-2 classes whose walls are container EXTERIORS (painted per container). */
const EXTERIOR: ReadonlySet<MarketClass> = new Set(['lane', 'gate', 'catwalk', 'roof', 'platform']);

const isMarketKey = (k: string) => k.startsWith('market-');

interface FaceLike {
  level: number; area: number; finish: string; y0: number; y1: number; slope?: unknown;
  // (version 2's paint split: a face along one wall line, its openings measured from x0 / z0, its texture base heights at both ends)
  x0?: number; z0?: number; x1?: number; z1?: number; nx?: number; nz?: number; openings?: {s0: number; s1: number; top: number}[]; vb0?: number; vb1?: number; seed?: number;
}

export class MarketArch {
  private readonly materials = new Map<string, THREE.Material>();
  private readonly classCache = new Map<number, MarketClass>();
  /** Task studio-market-rework-20261108-074144-01: layout version 2 (the container settlement). */
  readonly v2: boolean;
  /** (version 2) per storey 0 / 1: the paint (MARKET_PAINTS index) of each container's cells and walls, -1 elsewhere. */
  private readonly paint: Int8Array[] = [];

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): MarketArch | null {
    return layout.market ? new MarketArch(layout, mats, levels) : null;
  }

  /**
   * Per cell (layout grid): 1 = the open shed — a shed-floor column whose band rises past the housing deck's walking zone (the square,
   * the platform, the track bed, the open stair). The level culler takes these as ATRIUM tiles (world/levelCulling.ts, the mall's rule
   * without its slabs): a bounded number of sight tests per update instead of a pair portal for every tile of the big square.
   */
  readonly atrium: Uint8Array;

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    const g = layout.grid, top = (levels[1]?.baseY ?? 0) + 2.4;
    this.atrium = new Uint8Array(g.w * g.h);
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== SOLID && g.hasCeil(i) && g.ceil[i] >= top) this.atrium[i] = 1;
    this.v2 = layout.market?.v === 2;
    if (this.v2) {
      // each container (a room of storey 0 / 1) and its wall ring: one seeded paint, never the same as the container before it in its row
      for (let L = 0; L < 2; L++) this.paint.push(new Int8Array(g.w * g.h).fill(-1));
      let prev = -1;
      for (const a of layout.areas) {
        if (a.kind !== 'room' || (a.level ?? 0) > 1) continue;
        const m = this.paint[a.level ?? 0];
        let p = hash32(layout.seed, a.id) % MARKET_PAINTS.length;
        if (p === prev) p = (p + 3) % MARKET_PAINTS.length;
        prev = p;
        for (let y = a.y - 1; y <= a.y + a.h; y++) for (let x = a.x - 1; x <= a.x + a.w; x++) {
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          const i = y * g.w + x;
          if (m[i] < 0) m[i] = p;
        }
      }
    }
  }

  classOf(areaId: number): MarketClass {
    let c = this.classCache.get(areaId);
    if (c === undefined) this.classCache.set(areaId, (c = (this.v2 ? settleAreaClass : marketAreaClass)(areaId >= 0 ? this.layout.areas[areaId] : undefined)));
    return c;
  }

  // --- builder hooks ------------------------------------------------------------------------

  /** Wall faces: corrugated metal (shed, platform back wall, deck), plywood (stall alcoves, under-deck rooms); the track bed's faces
   *  below the platform line keep the builder's rule. */
  remapFaces<F extends FaceLike>(faces: F[]): F[] {
    if (this.v2) return faces.flatMap(f => this.remapFace2(f));
    return faces.map(f => {
      const cls = this.classOf(f.area);
      if (cls === 'track' || f.y1 <= 0.02) return f;
      return {...f, finish: cls === 'stall' || cls === 'under' ? MARKET_KEYS.ply : MARKET_KEYS.wall};
    });
  }

  /**
   * Version 2: a container's / home's walls are plywood-lined inside; an exterior wall (seen from a lane, a catwalk, a rooftop, the
   * platform) takes the paint of the container behind it, split where the containers change along the wall.
   */
  private remapFace2<F extends FaceLike>(f: F): F[] {
    const cls = this.classOf(f.area);
    if (cls === 'track' || f.y1 <= 0.02) return [f];
    if (cls === 'container' || cls === 'home') return [{...f, finish: MARKET_KEYS.ply}];
    if (!EXTERIOR.has(cls) || f.slope || f.x0 === undefined || f.z0 === undefined || f.x1 === undefined || f.z1 === undefined) return [{...f, finish: MARKET_KEYS.wall}];
    const g = this.layout.grid, alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0, n = Math.max(1, Math.round(len / 0.5));
    const ym = (f.y0 + f.y1) / 2, lv = ym >= 2.95 && this.paint.length > 1 ? 1 : 0;
    const nx = f.nx ?? 0, nz = f.nz ?? 0;
    const paintAt = (k: number): number => {
      const s = (k + 0.5) * (len / n);
      const x = alongX ? f.x0! + s - nx * 0.25 : f.x0! - nx * 0.25, z = alongX ? f.z0! - nz * 0.25 : f.z0! + s - nz * 0.25;
      const cx = Math.floor(x / 0.5), cy = Math.floor(z / 0.5);
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return -1;
      const i = cy * g.w + cx;
      for (let L = lv; L >= 0; L--) if (this.paint[L][i] >= 0) return this.paint[L][i];
      return -1;
    };
    const runs: [number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      const p = paintAt(k), last = runs[runs.length - 1];
      if (last && last[2] === p) last[1] = k + 1; else runs.push([k, k + 1, p]);
    }
    const key = (p: number) => (p < 0 ? MARKET_KEYS.wall : marketPaintKey(p));
    if (runs.length === 1) return [{...f, finish: key(runs[0][2])}];
    return runs.map(([k0, k1, p], j) => {
      const s0 = k0 * len / n, s1 = k1 * len / n, t0 = s0 / len, t1 = s1 / len;
      const vb0 = f.vb0 !== undefined && f.vb1 !== undefined ? f.vb0 + (f.vb1 - f.vb0) * t0 : f.vb0, vb1 = f.vb0 !== undefined && f.vb1 !== undefined ? f.vb0 + (f.vb1 - f.vb0) * t1 : f.vb1;
      const openings = (f.openings ?? []).filter(o => o.s1 > s0 + 1e-6 && o.s0 < s1 - 1e-6).map(o => ({...o, s0: Math.max(0, o.s0 - s0), s1: Math.min(s1, o.s1) - s0}));
      return {...f, finish: key(p), x0: alongX ? f.x0! + s0 : f.x0, x1: alongX ? f.x0! + s1 : f.x1, z0: alongX ? f.z0 : f.z0! + s0, z1: alongX ? f.z1 : f.z0! + s1, vb0, vb1, openings, seed: (f.seed ?? 0) + j};
    });
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule — the platform slab, the track bed). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const cls = this.classOf(lvl.grid.area[i]);
    if (this.v2) return cls === 'platform' || cls === 'track' ? null : cls === 'roof' ? MARKET_KEYS.roof : cls === 'lane' || cls === 'gate' ? 'concrete' : MARKET_KEYS.deck;
    if (cls === 'deck') return MARKET_KEYS.deck;
    if (cls === 'platform' || cls === 'track') return null;
    return 'concrete'; // the shed's bare concrete (a station key: the builder's material)
  }

  /** Ceiling key of a ceiling run: the roof sheeting, the plywood underside of the deck over the rooms below. */
  ceilKey(L: number, areaId: number): string | null {
    if (!this.levels[L]) return null;
    if (this.v2) return MARKET_KEYS.roof; // (version 2: the shed roof, the containers' corrugated steel tops)
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
    const pi = paintIndex(key);
    if (pi >= 0) return MARKET_PAINTS[pi].tex;
    return key === MARKET_KEYS.wall ? 'wall' : key === MARKET_KEYS.roof ? 'roof' : key === MARKET_KEYS.ply || key === MARKET_KEYS.deck ? 'ply' : null;
  }

  /** The material behind a market key (built on first use); undefined for any other key. */
  material(key: string): THREE.Material | undefined {
    if (!isMarketKey(key)) return undefined;
    let m = this.materials.get(key);
    if (!m) {
      const t = this.texOf(key);
      const pi = paintIndex(key);
      if (key === MARKET_KEYS.trim) {
        m = thinTrim(surfaceMaterial('paintedSteel', {color: MARKET_STANDIN.trim, metalness: 0.4}, {grime: [0.3, 0.6], macro: 0.15}));
        m.name = key;
      } else if (pi >= 0) {
        // (version 2) a container paint: the texture tinted (linear gain), or its plain colour while the texture is not loaded
        const P = MARKET_PAINTS[pi], tint = new THREE.Color(P.color).multiplyScalar(P.gain);
        m = (t && marketTexture(t) ? marketTexturedMaterial(this.mats, t, key, tint) : null) ?? new SurfaceNodeMaterial({color: P.color, roughness: 0.8, metalness: 0.25});
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

/** The MARKET_PAINTS index of a container paint key, else -1. */
function paintIndex(key: string): number {
  const m = /^market-cont-(\d+)$/.exec(key);
  return m ? Number(m[1]) : -1;
}

function hash32(a: number, b: number): number {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return h >>> 0;
}
