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

// Task studio-survivor-market-crevice-20261116-074419 (lane ARCH): layout version 5 — THE CREVICE (gen/market/v5/: an underground
// concrete slot with a settlement of shipping containers stepping up both sides, terraces on the container roofs, bridges, a dark chasm
// below) — has its own finish mapper (CreviceArch below; versions 1-4 keep the code above it exactly). It reads the shape record
// (layout.market.crevice: every container box with its paint, the bridge decks, the chasm):
//  - CONTAINER EXTERIORS: every wall a walk / the square / a terrace / a stair / a bridge sees takes the paint of the container box
//    behind it (the version-2 market-cont-<n> materials), split along the wall where the boxes change AND up the wall: a box's paint
//    runs from its storey floor y to y + the storey pitch (2.95 m: its roof is the walk above), the crevice's concrete above / below;
//  - THE CREVICE'S CONCRETE (everything else: the rock above / behind the bands, the chasm walls, the hall / gate walls, the bridge
//    abutments): the Reactor family's board-formed pit concrete, tinted cold grey, world-mapped with macro tone variation; the hall's
//    vault the same set darker; the crevice's top the mine rock, dark;
//  - container interiors plywood-lined (version 2's rule), plywood deck floors, corrugated roof ceilings; rock-cut backrooms / stores /
//    the den: mine rock walls and ceilings, concrete floors;
//  - floors: the square / low walks / weir / nooks bare concrete, the terraces (the container roofs) corrugated roof sheet, the bar's
//    deck plywood, stair feet / landings / treads rusted steel plate; NO floor on a bridge cell and no ceiling under a bridge deck (the
//    cooked bridge model draws them: builder hooks hidesFloor / voidCeilKey / ceilKey false), the deck fascias along its edges dropped;
//    the chasm's bed (storey-0 VOID at the chasm's floor) dark wet rubble instead of the track's ballast (builder hook voidFloorKey);
//  - the culler's ATRIUM: every column whose open band reaches the walking zones of two storeys or more (the open crevice, the stair
//    wells), so the culler tests a bounded set of tiles instead of a pair portal per storey pair.

import * as THREE from 'three';
import {CELL, FLOOR, SOLID, VOID} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {MarketCrevice} from '../gen/market/marketTypes';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, surfaceMaterial, thinTrim, type WorldMaterials, type MatKey} from './materials';
import {creviceMaterial, marketSpan, marketTexture, marketTexturedMaterial, type CreviceLook, type CreviceSlot} from './marketTextures';
import type {MarketTextureKey} from '../assets/marketTextures.generated';
import {DECAY_PROFILES, applyDecay, type DecayProfile} from './decay';
import {cellCeil} from './levelGeometry';

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

  /** Task studio-survivor-market-crevice-20261116-074419 (lane ARCH): layout version 5's finish mapper (null on versions 1-4). */
  readonly crevice: CreviceArch | null;
  /** Version 5 (THE CREVICE). */
  readonly v5: boolean;

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    const g = layout.grid, top = (levels[1]?.baseY ?? 0) + 2.4;
    this.atrium = new Uint8Array(g.w * g.h);
    const rec = layout.market?.v === 5 ? layout.market.crevice : undefined;
    this.crevice = rec ? new CreviceArch(layout, mats, levels, rec, this.atrium) : null;
    this.v5 = !!this.crevice;
    if (!this.crevice) for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== SOLID && g.hasCeil(i) && g.ceil[i] >= top) this.atrium[i] = 1;
    this.v2 = !this.crevice && (layout.market?.v ?? 1) >= 2; // (+ version 3: the same settlement with the bar — task studio-market-bar-20261108-225231-01)
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
    if (this.crevice) return this.crevice.remapFaces(faces); // (version 5: task studio-survivor-market-crevice-20261116-074419)
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
    if (this.crevice) return this.crevice.floorKey(L, i);
    const cls = this.classOf(lvl.grid.area[i]);
    if (this.v2) return cls === 'platform' || cls === 'track' ? null : cls === 'roof' ? MARKET_KEYS.roof : cls === 'lane' || cls === 'gate' ? 'concrete' : MARKET_KEYS.deck;
    if (cls === 'deck') return MARKET_KEYS.deck;
    if (cls === 'platform' || cls === 'track') return null;
    return 'concrete'; // the shed's bare concrete (a station key: the builder's material)
  }

  /** Ceiling key of a ceiling run: the roof sheeting, the plywood underside of the deck over the rooms below. (Version 5: by the run's
   *  first cell `i` and height `y` too — false: no ceiling drawn, under a bridge deck.) */
  ceilKey(L: number, areaId: number, i?: number, y?: number): string | false | null {
    if (!this.levels[L]) return null;
    if (this.crevice) return this.crevice.ceilKey(L, areaId, i ?? -1, y ?? 0);
    if (this.v2) return MARKET_KEYS.roof; // (version 2: the shed roof, the containers' corrugated steel tops)
    return this.classOf(areaId) === 'under' ? MARKET_KEYS.ply : MARKET_KEYS.roof;
  }

  /** Soffit of a door opening: the roof sheeting (stall / gate heads). (Version 5: by the door's two areas.) */
  doorCeilKey(L: number, a?: Area, b?: Area): string | null {
    if (!this.levels[L]) return null;
    if (this.crevice) return this.crevice.doorCeilKey(a, b);
    return MARKET_KEYS.roof;
  }

  // --- task studio-survivor-market-crevice-20261116-074419 (lane ARCH): builder hooks of version 5 (null / false on versions 1-4) ---

  /** No grid floor drawn on this open cell (version 5: a bridge's deck — the cooked bridge model draws it). */
  hidesFloor(L: number, i: number): boolean {
    return !!this.crevice && this.crevice.hidesFloor(L, i);
  }

  /** Floor key of a VOID cell (null: the builder's ballast — the track bed; version 5: the chasm's bed). */
  voidFloorKey(L: number, i: number): string | null {
    return this.crevice ? this.crevice.voidFloorKey(L, i) : null;
  }

  /** Ceiling key over a VOID run (null: the builder's rule; false: none — version 5: under a bridge deck over the chasm). */
  voidCeilKey(L: number, i: number, y: number): string | false | null {
    return this.crevice ? this.crevice.voidCeilKey(L, i, y) : null;
  }

  /** A stair flight's surface key for the builder's key `k` (null: unchanged; version 5: steel treads / landings). */
  stairKey(k: string): string | null {
    return this.crevice ? this.crevice.stairKey(k) : null;
  }

  /** Door frame trim: dark rusted steel. */
  doorTrimKey(): string {
    return MARKET_KEYS.trim;
  }

  /** Texture scale (m per repeat) of a market key; undefined for any other key. */
  scale(key: string): {u: number; v: number} | undefined {
    if (!isMarketKey(key)) return undefined;
    if (isCreviceKey(key)) return this.crevice?.scale(key);
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
    if (isCreviceKey(key)) return this.crevice?.material(key);
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

// =====================================================================================================================================
// Task studio-survivor-market-crevice-20261116-074419 (lane ARCH): VERSION 5 — THE CREVICE's finishes (header at the top of this file).

/** Version 5's own finish keys (the containers reuse version 2's: the paints, plywood, roof sheet, deck, trim). */
export const CREVICE_KEYS = {
  /** The crevice's cast concrete: the rock above / behind the container bands, the chasm walls, the hall / gate walls, abutments. */
  wall: 'market-crev-wall',
  /** The platform hall's low vault (over the platform and the track bed). */
  vault: 'market-crev-vault',
  /** The crevice's rock top (every open band ends there). */
  top: 'market-crev-top',
  /** Rock-cut rooms (the backrooms / stores behind the containers, the den): walls and ceilings. */
  cut: 'market-crev-cut',
  /** Bare concrete floors: the square, the low walks, the weir, the nooks, the rock-cut rooms. */
  floor: 'market-crev-floor',
  /** The chasm's bed: dark wet rubble. */
  chasm: 'market-crev-chasm',
  /** Rusted steel plate: stair feet, landings and treads, the deck undersides (over a stair foot, a nook, the square under the bar). */
  steel: 'market-crev-steel',
} as const;
export type CreviceKey = typeof CREVICE_KEYS[keyof typeof CREVICE_KEYS];
const CREVICE_KEY_SET: ReadonlySet<string> = new Set(Object.values(CREVICE_KEYS));
export const isCreviceKey = (k: string): k is CreviceKey => CREVICE_KEY_SET.has(k);

const decayOf = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});

/**
 * Each crevice finish: its set (world/marketTextures.ts CREVICE_TEXTURES: the Reactor family's Codex sets), the LINEAR tint over it (the
 * pit concrete is a warm brown-grey: tinted toward the concept's cold grey; the rock darker for the top, warmer for the lived-in rooms),
 * and the stand-in while the set is not loaded (the repo's existing station sets, tinted: tunnel concrete, concrete floor, painted steel).
 */
export const CREVICE_FINISHES: Readonly<Record<CreviceKey, {slot: CreviceSlot; look: CreviceLook; standIn: {base: 'tunnel' | 'concrete' | 'steel'; color: number}}>> = {
  'market-crev-wall': {slot: 'concrete', look: {tint: [1.1, 1.38, 1.95], role: 'wall', macro: 0.35, grime: [0.3, 1.8],
    decay: decayOf({grime: 0.5, streaks: 0.9, efflor: 0.5, stains: 0.4, cracks: 0.35, tint: [0.4, 0.41, 0.42]})}, standIn: {base: 'tunnel', color: 0x8c9094}},
  'market-crev-vault': {slot: 'concrete', look: {tint: [0.82, 1.02, 1.45], role: 'wall', macro: 0.25,
    decay: decayOf({grime: 0.5, stains: 0.7, efflor: 0.3, cracks: 0.3, tint: [0.4, 0.38, 0.35]})}, standIn: {base: 'tunnel', color: 0x6c6e72}},
  'market-crev-top': {slot: 'rock', look: {tint: [0.6, 0.85, 1.4], role: 'wall', macro: 0.3,
    decay: decayOf({grime: 0.3, stains: 0.4, tint: [0.35, 0.35, 0.35]})}, standIn: {base: 'tunnel', color: 0x3c3c3e}},
  'market-crev-cut': {slot: 'rock', look: {tint: [1.25, 1.2, 1.15], role: 'wall', macro: 0.25, grime: [0.3, 1.2],
    decay: decayOf({grime: 0.45, streaks: 0.5, efflor: 0.3, stains: 0.3, cracks: 0.2, tint: [0.45, 0.4, 0.34]})}, standIn: {base: 'tunnel', color: 0x7a6a58}},
  'market-crev-floor': {slot: 'concrete', look: {tint: [1.15, 1.4, 1.9], role: 'floor', macro: 0.3,
    decay: {...DECAY_PROFILES.concrete, tint: [0.44, 0.42, 0.4]}}, standIn: {base: 'concrete', color: 0x86888a}},
  'market-crev-chasm': {slot: 'rock', look: {tint: [0.45, 0.6, 0.9], role: 'floor', roughness: 0.55, macro: 0.4,
    decay: decayOf({stains: 0.8, efflor: 0.3, dust: 0.1, tint: [0.3, 0.32, 0.32]})}, standIn: {base: 'concrete', color: 0x30343a}},
  'market-crev-steel': {slot: 'steel', look: {tint: [0.92, 0.9, 0.9], role: 'floor', metalness: 0.6, macro: 0.3,
    decay: decayOf({grime: 0.3, wear: 0.45, dust: 0.4, stains: 0.4, tint: [0.42, 0.35, 0.27]})}, standIn: {base: 'steel', color: 0x5a4a3e}},
};

/** A crevice finish's stand-in (its set not loaded: Node, a failed fetch) and UV scale: the repo's existing station sets, tinted. */
function creviceStandIn(mats: WorldMaterials, key: CreviceKey): {m: THREE.Material; scale: {u: number; v: number}} {
  const s = CREVICE_FINISHES[key].standIn;
  if (s.base === 'steel') return {m: surfaceMaterial('paintedSteel', {color: s.color, metalness: 0.4}, {grime: [0.25, 0.4], macro: 0.3}), scale: {u: 1, v: 1}};
  const base: MatKey = s.base;
  const m = cloneSurfaceMaterial(mats.get(base)) as THREE.Material & {color?: THREE.Color};
  m.color?.setHex(s.color);
  return {m, scale: mats.scale[base]};
}

/** What a version-5 area is, for its finishes. */
export type CrevClass = 'platform' | 'void' | 'lane' | 'catwalk' | 'bar' | 'nook' | 'foot' | 'stairs' | 'bridge' | 'container' | 'back';

type Slope = {b0: number; b1: number; t0: number; t1: number};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A storey's walking zone (m above its base): world/levelCulling.ts ZONE. */
const ZONE = [0.2, 2.4] as const;

/** The part [s0, s1] (metres along the face from x0 / z0) of a face: its openings, texture bases and slope follow. */
function facePart<F extends FaceLike>(f: F, alongX: boolean, s0: number, s1: number, len: number): F {
  if (s0 <= 1e-9 && s1 >= len - 1e-9) return f;
  const t0 = s0 / len, t1 = s1 / len;
  const vb0 = f.vb0 !== undefined && f.vb1 !== undefined ? lerp(f.vb0, f.vb1, t0) : f.vb0, vb1 = f.vb0 !== undefined && f.vb1 !== undefined ? lerp(f.vb0, f.vb1, t1) : f.vb1;
  const openings = (f.openings ?? []).filter(o => o.s1 > s0 + 1e-6 && o.s0 < s1 - 1e-6).map(o => ({...o, s0: Math.max(0, o.s0 - s0), s1: Math.min(s1, o.s1) - s0}));
  const sl = f.slope as Slope | undefined;
  const slope = sl ? {b0: lerp(sl.b0, sl.b1, t0), b1: lerp(sl.b0, sl.b1, t1), t0: lerp(sl.t0, sl.t1, t0), t1: lerp(sl.t0, sl.t1, t1)} : undefined;
  return {
    ...f, x0: alongX ? f.x0! + s0 : f.x0, x1: alongX ? f.x0! + s1 : f.x1, z0: alongX ? f.z0 : f.z0! + s0, z1: alongX ? f.z1 : f.z0! + s1, vb0, vb1, openings,
    ...(slope ? {slope, y0: Math.min(slope.b0, slope.b1), y1: Math.max(slope.t0, slope.t1)} : {}),
  };
}

/**
 * The horizontal band [ya, yb] of a face as `finish` (none when empty). A rectangle: its openings clamp to the band (an opening starts at
 * the face's floor: one reaching into the band stays a hole there). A sloped face (a stair's side wall): split where its bottom / top lines
 * cross the band lines, so every piece keeps straight bottom / top lines.
 */
function faceBand<F extends FaceLike>(f: F, alongX: boolean, len: number, ya: number, yb: number, finish: string, seed: number): F[] {
  const sl = f.slope as Slope | undefined;
  if (!sl) {
    const y0 = Math.max(f.y0, ya), y1 = Math.min(f.y1, yb);
    if (y1 - y0 < 1e-3) return [];
    if (y0 === f.y0 && y1 === f.y1) return [{...f, finish, seed}];
    return [{...f, finish, seed, y0, y1, openings: (f.openings ?? []).filter(o => o.top > y0 + 1e-4).map(o => ({...o, top: Math.min(o.top, y1)}))}];
  }
  const us = [0, 1];
  const cross = (a0: number, a1: number, h: number) => { const d0 = a0 - h, d1 = a1 - h; if (d0 * d1 < 0) us.push(d0 / (d0 - d1)); };
  for (const h of [ya, yb]) { cross(sl.b0, sl.b1, h); cross(sl.t0, sl.t1, h); }
  us.sort((p, q) => p - q);
  const out: F[] = [];
  for (let q = 0; q + 1 < us.length; q++) {
    const u0 = us[q], u1 = us[q + 1];
    if (u1 - u0 < 1e-6) continue;
    const bot = (u: number) => Math.max(lerp(sl.b0, sl.b1, u), ya), top = (u: number) => Math.min(lerp(sl.t0, sl.t1, u), yb);
    const b0 = bot(u0), b1 = bot(u1), t0 = Math.max(b0, top(u0)), t1 = Math.max(b1, top(u1));
    if (t0 - b0 < 1e-4 && t1 - b1 < 1e-4) continue;
    const part = facePart(f, alongX, u0 * len, u1 * len, len);
    out.push({...part, finish, seed, slope: {b0, b1, t0, t1}, y0: Math.min(b0, b1), y1: Math.max(t0, t1)});
  }
  return out;
}

/**
 * Version 5's finish mapper (MarketArch delegates every builder hook to it on a version-5 layout). Reads the crevice's shape record
 * (layout.market.crevice) and the storey grids; pure lookups per face / cell (no per-frame work).
 */
export class CreviceArch {
  private readonly W: number;
  private readonly H: number;
  /** Per storey (level index): the container (record index) whose box, walls included, holds the cell; -1 elsewhere. */
  private readonly boxAt: Int16Array[];
  /** A container's room area -> its record index. */
  private readonly roomOf = new Map<number, number>();
  private readonly cls = new Map<number, CrevClass>();
  private readonly mat = new Map<string, THREE.Material>();
  private readonly scl = new Map<string, {u: number; v: number}>();
  /** A container's paint runs from its storey floor y up to y + pitch (its roof is the walk above: the storey pitch, 2.95 m). */
  readonly pitch: number;
  /** A bridge deck's depth under its walking surface (the lowered bands under it stop this far below). */
  readonly deck: number;
  /** QA: faces seen / pieces emitted / painted pieces / dropped deck fascias; atrium cells. */
  readonly stats = {faces: 0, pieces: 0, painted: 0, dropped: 0, atrium: 0};

  constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[], readonly rec: MarketCrevice, atrium: Uint8Array) {
    const g = layout.grid;
    this.W = g.w; this.H = g.h;
    this.pitch = rec.bases.length > 1 ? rec.bases[1] - rec.bases[0] : rec.cont + 0.35;
    this.deck = this.pitch - rec.cont;
    this.boxAt = levels.map(() => new Int16Array(g.w * g.h).fill(-1));
    rec.containers.forEach((c, k) => {
      const m = this.boxAt[c.level];
      if (c.area >= 0) this.roomOf.set(c.area, k);
      if (!m) return;
      const x0 = Math.max(0, Math.round(c.x0 / CELL)), x1 = Math.min(g.w, Math.round(c.x1 / CELL));
      const y0 = Math.max(0, Math.round(c.z0 / CELL)), y1 = Math.min(g.h, Math.round(c.z1 / CELL));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * g.w + x; if (m[i] < 0) m[i] = k; }
    });
    this.markAtrium(atrium);
  }

  /**
   * The culler's atrium (world/levelCulling.ts): every OPEN CREVICE column — one of whose open bands runs up to the crevice's top AND
   * reaches the walking zones of two storeys or more (the open air over the low walks / the chasm / the square / the weir / the
   * terraces) — one atrium tile per 6 x 6 cells joining all its storeys, instead of a pair portal per storey pair. Roofed spaces stay
   * out: the platform hall's vault (its 7.2 m band "reaches" the storey-1 / -2 zones but holds no upper floor; as atrium it drew the
   * crevice's terraces behind the hall's back wall), container rooms, rock-cut stairs — the culler's pair portals cover them.
   */
  private markAtrium(atrium: Uint8Array): void {
    const n = this.W * this.H, bases = this.levels.map(l => l.baseY), sky = this.rec.topY - 0.05;
    for (let i = 0; i < n; i++) {
      for (const lv of this.levels) {
        const g = lv.grid, c = g.cells[i];
        if (c !== FLOOR && c !== VOID) continue;
        const f = g.floorOf(i), top = cellCeil(g, i);
        if (top < sky) continue;
        let reach = 0;
        for (const b of bases) if (f <= b + ZONE[1] && top >= b + ZONE[0]) reach++;
        if (reach >= 2) { atrium[i] = 1; this.stats.atrium++; break; }
      }
    }
  }

  classOf(areaId: number): CrevClass {
    let c = this.cls.get(areaId);
    if (c === undefined) this.cls.set(areaId, (c = this.classify(areaId)));
    return c;
  }

  private classify(id: number): CrevClass {
    const a = id >= 0 ? this.layout.areas[id] : undefined;
    if (!a) return 'void';
    if (a.kind === 'platform') return 'platform';
    if (a.role === 'crossover') return 'bridge';
    if (a.kind === 'room') return this.roomOf.has(id) ? 'container' : 'back';
    if (a.role === 'stair' || a.type === 'stair-core') return 'stairs';
    if (a.label === 'Stair foot') return 'foot';
    if (a.label === 'Terrace nook') return 'nook';
    if (a.label === 'Bar') return 'bar';
    if (a.role === 'catwalk') return 'catwalk';
    return 'lane';
  }

  private cellAt(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
    return cx < 0 || cy < 0 || cx >= this.W || cy >= this.H ? -1 : cy * this.W + cx;
  }
  private centre(i: number): [number, number] {
    const cx = i % this.W;
    return [(cx + 0.5) * CELL, ((i - cx) / this.W + 0.5) * CELL];
  }
  private inBox(k: number, x: number, z: number): boolean {
    const c = this.rec.containers[k];
    return x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1;
  }
  inChasm(x: number, z: number): boolean {
    const c = this.rec.chasm;
    return x >= c.x0 && x < c.x1 && z >= c.z0 && z < c.z1;
  }
  /** Is cell i's band (ceiling at y) the lowered band under a bridge deck? */
  private underBridge(i: number, y: number): boolean {
    if (i < 0) return false;
    const [x, z] = this.centre(i);
    for (const b of this.rec.bridges) if (x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1 && Math.abs(y - (b.y - this.deck)) < 0.02) return true;
    return false;
  }
  /** Is the face strip at s (a wall along X) a bridge deck's edge fascia (the slab band along a deck's long edge)? */
  private fascia(f: FaceLike, alongX: boolean, s: number, y0: number, y1: number): boolean {
    if (!alongX || f.slope) return false;
    const x = f.x0! + s, z = f.z0!;
    for (const b of this.rec.bridges) {
      if (Math.abs(z - b.z0) > 1e-4 && Math.abs(z - b.z1) > 1e-4) continue;
      if (x < b.x0 - 1e-4 || x > b.x1 + 1e-4) continue;
      if (y0 >= b.y - this.deck - 0.02 && y1 <= b.y + 0.02) return true;
    }
    return false;
  }

  // --- builder hooks ------------------------------------------------------------------------

  /**
   * Wall faces. Container rooms: plywood inside the box, rock where a walk-in shop's room runs on into its rock-cut back; rock-cut rooms:
   * rock. Everything seen from the open crevice / the hall: per 0.5 m along the wall, the containers whose boxes stand behind it paint
   * their storey band [y, y + pitch], the crevice's concrete fills the rest; a bridge deck's fascias are left to the bridge model; the
   * track bed's low faces (the platform's edge face, the bed walls) keep the builder's rule.
   */
  remapFaces<F extends FaceLike>(faces: F[]): F[] {
    const out: F[] = [];
    for (const f of faces) this.remapFace(f, out);
    this.stats.pieces = out.length;
    return out;
  }

  private remapFace<F extends FaceLike>(f: F, out: F[]): void {
    this.stats.faces++;
    if (f.x0 === undefined || f.z0 === undefined || f.x1 === undefined || f.z1 === undefined) { out.push({...f, finish: CREVICE_KEYS.wall}); return; }
    const cls = this.classOf(f.area);
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0, n = Math.max(1, Math.round(len / CELL));
    const nx = f.nx ?? 0, nz = f.nz ?? 0;
    const sl = f.slope as Slope | undefined;
    const fy0 = sl ? Math.min(sl.b0, sl.b1) : f.y0, fy1 = sl ? Math.max(sl.t0, sl.t1) : f.y1;
    /** The point 0.25 m in front of (side 1: in the open band) / behind (side -1: in the closed column) step k's centre. */
    const at = (k: number, side: 1 | -1): [number, number] => {
      const s = (k + 0.5) * (len / n);
      return [f.x0! + (alongX ? s : 0) + side * nx * 0.25, f.z0! + (alongX ? 0 : s) + side * nz * 0.25];
    };
    const room = cls === 'container' || cls === 'back';
    if (cls === 'void') {
      const [ix, iz] = at(n >> 1, 1);
      // the track bed: its low faces (the platform's edge face, the bed walls) keep the builder's rule; its walls up to the vault: the
      // hall's concrete
      if (!this.inChasm(ix, iz)) { out.push(fy1 <= 0.5 ? f : {...f, finish: CREVICE_KEYS.wall}); return; }
    }
    const sig: string[] = new Array(n);
    const bands: [number, number, number][][] = new Array(n);
    const ck = room ? this.roomOf.get(f.area) : undefined;
    for (let k = 0; k < n; k++) {
      if (room) {
        const [ix, iz] = at(k, 1);
        sig[k] = ck !== undefined && this.inBox(ck, ix, iz) ? 'p' : 'c';
        continue;
      }
      if (this.fascia(f, alongX, (k + 0.5) * (len / n), fy0, fy1)) { sig[k] = 'x'; continue; }
      const [bx, bz] = at(k, -1), i = this.cellAt(bx, bz);
      const list: [number, number, number][] = [];
      if (i >= 0) for (let L = 0; L < this.boxAt.length; L++) {
        const j = this.boxAt[L][i];
        if (j < 0) continue;
        const c = this.rec.containers[j], a = Math.max(c.y, fy0), b = Math.min(c.y + this.pitch, fy1);
        if (b - a > 1e-3) list.push([a, b, c.paint]);
      }
      list.sort((p, q) => p[0] - q[0]);
      bands[k] = list;
      sig[k] = list.length ? list.map(q => `${q[0].toFixed(3)}:${q[1].toFixed(3)}:${q[2]}`).join('|') : 'w';
    }
    let seed = f.seed ?? 0;
    for (let k0 = 0; k0 < n;) {
      let k1 = k0 + 1;
      while (k1 < n && sig[k1] === sig[k0]) k1++;
      const s = sig[k0];
      if (s === 'x') { this.stats.dropped++; k0 = k1; continue; }
      const part = facePart(f, alongX, k0 * len / n, k1 * len / n, len);
      if (s === 'p' || s === 'c' || s === 'w') out.push({...part, finish: s === 'p' ? MARKET_KEYS.ply : s === 'c' ? CREVICE_KEYS.cut : CREVICE_KEYS.wall, seed: seed++});
      else {
        // up the wall: concrete, the boxes' paints in their storey bands, concrete between / above
        let cur = fy0;
        for (const [a, b, p] of bands[k0]) {
          if (a > cur + 1e-3) out.push(...faceBand(part, alongX, k1 * len / n - k0 * len / n, cur, a, CREVICE_KEYS.wall, seed++));
          const painted = faceBand(part, alongX, k1 * len / n - k0 * len / n, Math.max(a, cur), b, marketPaintKey(p), seed++);
          this.stats.painted += painted.length;
          out.push(...painted);
          cur = Math.max(cur, b);
        }
        if (fy1 > cur + 1e-3) out.push(...faceBand(part, alongX, k1 * len / n - k0 * len / n, cur, fy1, CREVICE_KEYS.wall, seed++));
      }
      k0 = k1;
    }
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule — the platform slab; a VOID cell: see voidFloorKey). */
  floorKey(L: number, i: number): string | null {
    const g = this.levels[L]?.grid;
    if (!g) return null;
    if (g.cells[i] === VOID) return this.voidFloorKey(L, i);
    const id = g.area[i];
    switch (this.classOf(id)) {
      case 'platform': case 'void': return null;
      case 'catwalk': return MARKET_KEYS.roof; // the terraces run on the container roofs below
      case 'bar': return MARKET_KEYS.deck;
      case 'foot': case 'stairs': case 'bridge': return CREVICE_KEYS.steel; // (a bridge's: never drawn — hidesFloor; bullet impacts)
      case 'container': { const [x, z] = this.centre(i); return this.inBox(this.roomOf.get(id)!, x, z) ? MARKET_KEYS.deck : CREVICE_KEYS.floor; }
      default: return CREVICE_KEYS.floor; // the square, the low walks, the weir, the nooks, the rock-cut rooms
    }
  }

  /** A bridge's deck cell: no grid floor (the cooked bridge model is the deck). */
  hidesFloor(L: number, i: number): boolean {
    const g = this.levels[L]?.grid;
    return !!g && g.cells[i] === FLOOR && this.classOf(g.area[i]) === 'bridge';
  }

  /** The chasm's bed (VOID cells inside the chasm); null elsewhere (the track bed keeps its ballast). */
  voidFloorKey(_L: number, i: number): string | null {
    const [x, z] = this.centre(i);
    return this.inChasm(x, z) ? CREVICE_KEYS.chasm : null;
  }

  /** Ceiling of a run (first cell i, height y): none under a bridge deck; the rock top; a deck's steel underside; the rooms' own. */
  ceilKey(_L: number, areaId: number, i: number, y: number): string | false {
    if (this.underBridge(i, y)) return false;
    const cls = this.classOf(areaId);
    // a container's corrugated roof sheet seen from inside (a walk-in shop's sheet runs on over its rock-cut back: one ceiling run per
    // row of a room, world/levelGeometry.ts ceilingRuns — its walls / floor still split at the box)
    if (cls === 'container') return MARKET_KEYS.roof;
    if (cls === 'back') return CREVICE_KEYS.cut;
    if (cls === 'platform') return CREVICE_KEYS.vault;
    if (y >= this.rec.topY - 0.02) return CREVICE_KEYS.top;
    return CREVICE_KEYS.steel; // a deck over it: the catwalk over a stair foot, the walk over a nook, the bar over the square
  }

  /** Ceiling over a VOID run: none under a bridge deck, the crevice's top over the chasm, the hall's vault over the track bed. */
  voidCeilKey(_L: number, i: number, y: number): string | false {
    if (this.underBridge(i, y)) return false;
    const [x, z] = this.centre(i);
    if (!this.inChasm(x, z)) return CREVICE_KEYS.vault;
    return y >= this.rec.topY - 0.02 ? CREVICE_KEYS.top : CREVICE_KEYS.steel;
  }

  /** Door soffits: the container's roof sheet at a container's opening; concrete through the rock (the gates). */
  doorCeilKey(a?: Area, b?: Area): string {
    return (a && this.classOf(a.id) === 'container') || (b && this.classOf(b.id) === 'container') ? MARKET_KEYS.roof : CREVICE_KEYS.wall;
  }

  /** Stair flights: rusted steel treads, risers and landings (null: the builder's key — the safety nosings). */
  stairKey(k: string): string | null {
    return k === 'terrazzo' || k === 'concrete' || k === 'ceiling' || k === 'ceilingService' ? CREVICE_KEYS.steel : null;
  }

  scale(key: CreviceKey): {u: number; v: number} {
    if (!this.scl.has(key)) this.material(key);
    return this.scl.get(key)!;
  }

  /** The material of a crevice key (one per key: the textured set, else its stand-in), with the key's decay. */
  material(key: CreviceKey): THREE.Material {
    let m = this.mat.get(key);
    if (m) return m;
    const F = CREVICE_FINISHES[key];
    const tex = creviceMaterial(this.mats, F.slot, key, F.look);
    if (tex) { m = tex; this.scl.set(key, {u: 1, v: 1}); } else {
      const s = creviceStandIn(this.mats, key);
      m = s.m;
      m.name = key;
      applyDecay(m, F.look.decay);
      this.scl.set(key, s.scale);
    }
    this.mat.set(key, m);
    return m;
  }
}
