// Task studio-skyways-level-20261106-054448 (lane VIEW): THE SKYWAYS LOOK — the finish mapper of the Skyways storeys (the builder's
// skyways branches ask SkywaysArch, exactly like OfficeArch / MallArch / ReactorArch on their levels; null on every other level) and the
// glazed ATRIUM ROOFS.
//
// Before: the builder rendered Skyways with the default SUBWAY finishes (glazed station tile with its dado in every public hall, the
// station's painted block in the back rooms, terrazzo / concrete floors, the station ceiling kit). Now a believable downtown pedway:
//  - public skyway / street-level spaces (lobbies, entrance halls, skyway courts / concourses, atrium galleries, the add-on hall, the
//    public stair cores, the station's underground pedway concourse): warm white plaster over a polished stone wainscot with a dark
//    steel rail / skirting, light polished stone floors, light ceilings (plain plaster at street level and below, the acoustic T-bar
//    grid on the +15 concourses);
//  - the glazed bridges: the same plaster walls, a light tiled floor, a white soffit-like plaster ceiling;
//  - atrium courts: their own (warmer) stone floor; NO ceiling inside the opening (the street-level band rises to the glass roof);
//  - washrooms: the office wet-room tile; back of house (storage, utility, staff rooms, closets, security / signal rooms): painted
//    concrete with a dark lower band, sealed concrete floors, painted concrete ceilings;
//  - the station storey (platforms, track bed, track tunnels, its shops / back rooms) and every storefront unit (shops / eateries:
//    their own storefront walls / floors) keep the builder's own rule (null keys); above the station storey the storefront units take
//    the pedway's plain plaster ceiling (and their door soffits), not the station ceiling kit.
// The keys are arch-owned finishes for bullet impacts too (world/finishAt.ts, damage/impactFinish.ts: plaster / terrazzo / tile /
// concrete) and never take a station wall treatment (world/wallDetailPlan.ts: the mall's front / back-of-house recipes).
// Every surface reuses the office architecture's materials (world/officeArch.ts: ONE program per surface kind — the plasterboard wall,
// the floor, the ceiling graph — the Codex T4 office wall / T2 ceiling textures, the procedural grain, the 30-year decay hook): one
// material per finish (a handful in total), chunked by the builder like every other arch key. Door frames are dark painted steel.
// The window reveals of the GAS lane's glazing (world/skywaysWindows.ts revealMaterial) take a plain-paint copy of the public wall.
//
// ATRIUM ROOFS (buildRoofs, into the station group before the warm-up, tagged for the level culler with the street and skyway storeys):
// over every building atrium a glazed barrel vault springing from the court's raised ceiling line (atrium.roofY) — panes in the mall's
// roof glass (world/mallArch.ts roofGlass: unlit, murk-tinted, transparent, depth-writing, never a flashlight shadow caster), dark
// steel arches / purlins / edge girders / gable mullions — the reference is MallArch's vault, scaled to a pedway court.

import * as THREE from 'three';
import {CELL} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {Area, StationLayout} from '../gen/stationTypes';
import type {SkywaysInfo, SkywaysRect, SkywaysShopFamily} from '../gen/skyways/skywaysTypes';
import {ANCHOR_STYLES, type AnchorFinish} from '../gen/skyways/destinations/anchorStyles';
import {
  CORE_WALL, LOWER, OFFICE_CEIL_SPAN, OFFICE_FLOOR_SPAN, OFFICE_WALL_SPAN, WET_WALL, ceilingMaterial, floorMaterial, wallMaterial,
  type CeilingKind, type FloorKind, type WallSpec,
} from './officeArch';
import {surfaceMaterial, thinTrim, type WorldMaterials} from './materials';
import {roofGlass} from './mallArch';
// (task studio-skyways-rework-20261107-054512-01, lane ARCH) the rework's look: glazed bridge roofs, skylight coffers, textured courts
import {buildBridgeRoofs, BRIDGE_STEEL_LIGHT, type BridgeRoofStats} from './skywaysBridgeRoofs';
import {buildSkylights, SKYLIGHT_SKY_KEY, skylightSkyMaterial, type SkylightStats} from './skywaysSkylights';
import {skywaysArchSpan, skywaysArchTexture, skywaysTexturedMaterial, usesSkywaysArchTextures} from './skywaysArchTextures';
import type {SkywaysArchTextureKey} from '../assets/skywaysArchTextures.generated';
import type {SkywaysBridge} from '../gen/skyways/skywaysTypes';

// ---------------------------------------------------------------------------------------------
// Styles (pure data)

/** Public wall: warm white plaster over a polished warm-grey stone wainscot, dark steel rail and skirting (colours sRGB). */
export const SKYWAYS_PUBLIC_WALL: WallSpec = {paint: 0xe0dace, lower: 0xb8b0a2, trim: 0x34373a, kind: LOWER.stone, lowerTop: 1.0, skirt: 0.1, rail: 0.03, peel: 0.3, panel: 0.6};
/** The window reveals: the public wall's paint everywhere (no wainscot / skirting bands on the reveal faces' arbitrary uvs). */
export const SKYWAYS_REVEAL_WALL: WallSpec = {...SKYWAYS_PUBLIC_WALL, kind: LOWER.none, lowerTop: 0, skirt: 0, rail: 0};
/** Floors: [floor kind, tint]. */
export const SKYWAYS_FLOORS = {
  public: ['stone', 0xd2cbbe], court: ['stone', 0xbfb5a3], bridge: ['tile', 0xd6d1c6], wet: ['wet', undefined], boh: ['concrete', undefined],
  office: ['carpet', 0x5d6670],
} as const satisfies Record<string, readonly [FloorKind, number | undefined]>;
/** (rework) A tenant office wing's walls: light office paint over a narrow painted skirting. */
export const SKYWAYS_OFFICE_WALL: WallSpec = {paint: 0xdcdcd6, lower: 0xc4c4bc, trim: 0x585a5c, kind: LOWER.paint, lowerTop: 0.1, skirt: 0.1, rail: 0, peel: 0.25, panel: 0.15};
/** Ceilings: kind and tint (undefined: the office kind's own colour). The bridges' soffit is a whiter plaster. */
export const SKYWAYS_CEILS = {
  plain: ['plain', 0xe2ded6], grid: ['grid', undefined], bridge: ['plain', 0xeceae4], core: ['core', undefined],
} as const satisfies Record<string, readonly [CeilingKind, number | undefined]>;
/** Door frames / roof steel: dark painted steel. */
export const SKYWAYS_STEEL = 0x3a3d40;
/**
 * (task studio-skyways-rework-20261107-054512-01, lane ARCH) The rework's textured finishes (world/skywaysArchTextures.ts: Codex-authored
 * textures, layout version 3 only) and their office-program stand-ins while a texture is not delivered: the courts' herringbone brick
 * floor (stand-in: the court stone), brick walls (stand-in: the public plaster), dark timber slat ceilings (stand-in: a dark brown raw
 * ceiling), the roofed bridges' clay pavers (stand-in: a half-bond dark brick-red stone floor).
 */
export const SKYWAYS_TEX_KEYS = {herringbone: 'skyways-tex-herringbone', brickWall: 'skyways-tex-brick', woodSlats: 'skyways-tex-slats', pavers: 'skyways-tex-pavers'} as const satisfies Record<SkywaysArchTextureKey, string>;
export const SKYWAYS_PAVER_STANDIN = {kind: 'stone' as FloorKind, tint: 0x6b3a2f};
export const SKYWAYS_SLAT_STANDIN = {kind: 'raw' as CeilingKind, tint: 0x3a2b21, bar: 0x1c1612};

/** What a Skyways area is, for its finishes ('station' / 'shop': the builder's own rule). */
export type SkywaysClass = 'station' | 'shop' | 'public' | 'court' | 'bridge' | 'wet' | 'boh' | 'anchor' | 'office';

/** The class of an area (`bridges`: the layout.areas ids of the bridge decks). */
export function skywaysAreaClass(a: Area | undefined, bridges: ReadonlySet<number>): SkywaysClass {
  if (!a) return 'station';
  if ((a as {ext?: string}).ext) return 'station'; // track tunnels / annexes: the extension's own look
  if (a.kind === 'platform') return 'station';
  const t = a.type as string;
  if (t === 'eatery' || t === 'shop') return 'shop'; // storefront units keep their storefront interiors
  if ((a.level ?? 0) === 0) return a.publicSpace && (t === 'concourse' || t === 'stair-core') ? 'public' : 'station';
  if (bridges.has(a.id)) return 'bridge';
  if (t === 'washroom') return 'wet';
  if (t === 'office-open' || t === 'office-room') return 'office'; // (rework) a tenant office wing: the office floor's finishes
  if (!a.publicSpace) return 'boh';
  if (/^Atrium court/.test(a.label ?? '')) return 'court';
  return 'public';
}

const isSkywaysKey = (k: string) => k.startsWith('skyways-');

interface FaceLike {
  level: number; area: number; finish: string; x0: number; z0: number; x1: number; z1: number; nx: number; nz: number;
  y0: number; y1: number; openings: {s0: number; s1: number; top: number}[]; slope?: unknown; vb0?: number; vb1?: number;
}

/** Atrium roof build stats (QA / tests). */
export interface SkywaysRoofStats { roofs: number; panes: number; arches: number; meshes: number; triangles: number }

/**
 * The Skyways architecture of one layout: finish keys for the builder's skyways branches, the materials behind them, the reveal
 * material and the atrium roofs. `SkywaysArch.for` returns null without layout.skyways.
 */
export class SkywaysArch {
  readonly info: SkywaysInfo;
  /** Per cell (layout grid): the atrium roof y over that cell, 0 = no atrium. */
  readonly atriumRoof: Float32Array;
  private readonly bridgeAreas: Set<number>;
  private readonly materials = new Map<string, THREE.Material>();
  private readonly specs = new Map<string, () => THREE.Material>();
  private readonly classCache = new Map<number, SkywaysClass>();
  /** (task studio-skyways-rework-20261107-054512-01) the street-level courts under an atrium opening (a landmark court keeps its
   *  court finish under its new name: classed by the opening, not the 'Atrium court' label). */
  private readonly courtAreas = new Set<number>();
  /** (task studio-skyways-rework-20261107-054512-01) area id -> its anchor store's family (+ zone: a zone override applies). */
  private readonly anchorAreas = new Map<number, {family: SkywaysShopFamily; zone: boolean}>();
  stats: SkywaysRoofStats = {roofs: 0, panes: 0, arches: 0, meshes: 0, triangles: 0};
  /** (lane ARCH) deck area id -> its bridge, for the bridges with a glazed roof (layout version 3). */
  private readonly roofed = new Map<number, SkywaysBridge>();
  /** (lane ARCH) per cell (layout grid) of the skyway storey: 1 = under a skylight coffer. */
  readonly coffer: Uint8Array;
  /** (lane ARCH) skylit court area id -> its ceiling line (absolute y). */
  private readonly skylit = new Map<number, number>();
  /** (lane ARCH) the rework finishes apply (layout version 3: roofed bridges / skylights). */
  readonly rework: boolean;
  /** (lane ARCH) bridge roof / skylight build stats (QA / tests). */
  bridgeRoofs: BridgeRoofStats[] = [];
  skylightStats: SkylightStats = {coffers: 0, panes: 0, meshes: 0, triangles: 0};

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): SkywaysArch | null {
    return layout.skyways ? new SkywaysArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    this.info = layout.skyways!;
    const g0 = layout.grid;
    this.bridgeAreas = new Set(this.info.bridges.map(b => b.area));
    for (const b of this.info.buildings) {
      const r = b.atrium?.rect;
      if (!r) continue;
      for (const a of layout.areas) {
        if ((a.level ?? 0) !== 1 || !a.publicSpace || (a.type as string) === 'shop' || (a.type as string) === 'eatery') continue;
        if (a.x * CELL < r.x1 && (a.x + a.w) * CELL > r.x0 && a.y * CELL < r.z1 && (a.y + a.h) * CELL > r.z0) this.courtAreas.add(a.id);
      }
    }
    // the anchor stores' own finishes (gen/skyways/destinations/anchorStyles.ts): sales floor + its stair-well pieces, upper storey, zones
    for (const an of this.info.anchors ?? []) {
      const main = new Set([an.floor, ...(an.upper !== undefined ? [an.upper] : [])]);
      for (const a of layout.areas) if (main.has(a.parent) && (a.type as string) === 'shop') main.add(a.id);
      for (const id of main) this.anchorAreas.set(id, {family: an.family, zone: false});
      for (const id of an.zones) this.anchorAreas.set(id, {family: an.family, zone: true});
    }
    this.atriumRoof = new Float32Array(g0.w * g0.h);
    for (const b of this.info.buildings) {
      if (!b.atrium) continue;
      const r = b.atrium.rect;
      for (let cy = Math.max(0, Math.floor(r.z0 / CELL)); cy < Math.min(g0.h, Math.ceil(r.z1 / CELL)); cy++) {
        for (let cx = Math.max(0, Math.floor(r.x0 / CELL)); cx < Math.min(g0.w, Math.ceil(r.x1 / CELL)); cx++) this.atriumRoof[cy * g0.w + cx] = b.atrium.roofY;
      }
    }
    // (task studio-skyways-rework-20261107-054512-01, lane ARCH) roofed bridges, skylight coffers, the rework finishes (v3 only)
    for (const b of this.info.bridges) if (b.roof) this.roofed.set(b.area, b);
    this.coffer = new Uint8Array(g0.w * g0.h);
    for (const s of this.info.skylights ?? []) {
      this.skylit.set(s.area, s.ceilY);
      for (let cy = Math.max(0, Math.round(s.rect.z0 / CELL)); cy < Math.min(g0.h, Math.round(s.rect.z1 / CELL)); cy++) {
        for (let cx = Math.max(0, Math.round(s.rect.x0 / CELL)); cx < Math.min(g0.w, Math.round(s.rect.x1 / CELL)); cx++) this.coffer[cy * g0.w + cx] = 1;
      }
    }
    this.rework = usesSkywaysArchTextures(layout);
  }

  /** (lane ARCH) A rework finish's key: the textured one when its texture is loaded (layout version 3), else its stand-in key. */
  private texKey(t: SkywaysArchTextureKey, standIn: () => string): string {
    const key = SKYWAYS_TEX_KEYS[t];
    if (this.rework && skywaysArchTexture(t)) return this.def(key, () => skywaysTexturedMaterial(this.mats, t, key)!);
    return standIn();
  }

  /** (lane ARCH) Is the area a skylit court / an atrium court (the warm brick / timber look)? */
  private courtLook(areaId: number): boolean {
    return this.rework && (this.skylit.has(areaId) || this.classOf(areaId) === 'court');
  }

  /** The class of an area id (cached). */
  classOf(areaId: number): SkywaysClass {
    let c = this.classCache.get(areaId);
    if (c === undefined) {
      c = this.anchorAreas.has(areaId) ? 'anchor' : skywaysAreaClass(areaId >= 0 ? this.layout.areas[areaId] : undefined, this.bridgeAreas);
      if (c === 'public' && this.courtAreas.has(areaId)) c = 'court';
      this.classCache.set(areaId, c);
    }
    return c;
  }

  /** An anchor area's finish (its family's, a zone's override on top). */
  private anchorFinish(areaId: number): {f: AnchorFinish; tag: string} {
    const a = this.anchorAreas.get(areaId)!, st = ANCHOR_STYLES[a.family];
    const z = a.zone ? st.zones : undefined;
    return {f: {wall: z?.wall ?? st.wall, floor: z?.floor ?? st.floor, ceiling: z?.ceiling ?? st.ceiling}, tag: `${a.family}${a.zone && z ? '-zone' : ''}`};
  }

  private anchorWallKey(areaId: number): string {
    const {f, tag} = this.anchorFinish(areaId), w = f.wall;
    const full = w.lowerTop >= 2;
    const cls = full ? ({wood: 'wood', tile: 'tile', stone: 'terrazzo', concrete: 'concrete', paint: 'plaster', none: 'plaster'} as const)[w.kind] : 'plaster';
    const key = `skyways-anchor-wall-${cls}@${tag}`;
    return this.def(key, () => wallMaterial(this.mats, key, {paint: w.paint, lower: w.lower, trim: w.trim, kind: LOWER[w.kind], lowerTop: w.lowerTop,
      skirt: w.skirt ?? 0.1, rail: w.rail ?? 0.03, peel: w.peel ?? 0.2, panel: w.panel ?? 0.4}));
  }

  private anchorFloorKey(areaId: number): string {
    const {f, tag} = this.anchorFinish(areaId), key = `skyways-anchor-floor-${f.floor.kind}@${tag}`;
    return this.def(key, () => floorMaterial(this.mats, key, f.floor.kind, f.floor.tint));
  }

  private anchorCeilKey(areaId: number): string {
    const {f, tag} = this.anchorFinish(areaId), key = `skyways-anchor-ceil-${f.ceiling.kind}@${tag}`;
    return this.def(key, () => {
      const m = ceilingMaterial(this.mats, key, f.ceiling.kind);
      if (f.ceiling.tint !== undefined) { m.ofA.setHex(f.ceiling.tint, THREE.SRGBColorSpace); m.ofB.setHex(f.ceiling.tint, THREE.SRGBColorSpace); }
      return m;
    });
  }

  /** Register a lazily built material behind a key. */
  private def(key: string, make: () => THREE.Material): string {
    if (!this.specs.has(key)) this.specs.set(key, make);
    return key;
  }

  private wallKey(cls: SkywaysClass): string {
    if (cls === 'wet') return this.def('skyways-wet', () => wallMaterial(this.mats, 'skyways-wet', WET_WALL));
    if (cls === 'boh') return this.def('skyways-boh', () => wallMaterial(this.mats, 'skyways-boh', CORE_WALL));
    if (cls === 'office') return this.def('skyways-office-wall', () => wallMaterial(this.mats, 'skyways-office-wall', SKYWAYS_OFFICE_WALL));
    return this.def('skyways-wall', () => wallMaterial(this.mats, 'skyways-wall', SKYWAYS_PUBLIC_WALL));
  }

  private floorKeyOf(cls: keyof typeof SKYWAYS_FLOORS): string {
    const key = `skyways-floor-${cls}`, [kind, tint] = SKYWAYS_FLOORS[cls];
    return this.def(key, () => floorMaterial(this.mats, key, kind, tint));
  }

  private ceilKeyOf(c: keyof typeof SKYWAYS_CEILS): string {
    const key = `skyways-ceil-${c}`, [kind, tint] = SKYWAYS_CEILS[c];
    return this.def(key, () => {
      const m = ceilingMaterial(this.mats, key, kind);
      if (tint !== undefined) { m.ofA.setHex(tint, THREE.SRGBColorSpace); m.ofB.setHex(tint, THREE.SRGBColorSpace); }
      return m;
    });
  }

  /** (lane ARCH) The slat ceiling's stand-in: the office raw ceiling (dark beams every 2.4 m) in a dark timber brown. */
  private slatStandIn(): string {
    return this.def('skyways-ceil-slats', () => {
      const m = ceilingMaterial(this.mats, 'skyways-ceil-slats', SKYWAYS_SLAT_STANDIN.kind);
      m.ofA.setHex(SKYWAYS_SLAT_STANDIN.tint, THREE.SRGBColorSpace); m.ofB.setHex(SKYWAYS_SLAT_STANDIN.bar, THREE.SRGBColorSpace);
      return m;
    });
  }

  /** (lane ARCH) The bridge roofs' light putty-grey steel (the faceted / vaulted tubes). */
  private lightSteelKey(): string {
    return this.def('skyways-roof-steel', () => {
      const m = thinTrim(surfaceMaterial('paintedSteel', {color: BRIDGE_STEEL_LIGHT, metalness: 0.3}, {grime: [0.25, 0.5], macro: 0.15}));
      m.name = 'skyways-roof-steel';
      return m;
    });
  }

  private trimKey(): string {
    return this.def('skyways-trim', () => {
      const m = thinTrim(surfaceMaterial('paintedSteel', {color: SKYWAYS_STEEL, metalness: 0.35}, {grime: [0.2, 0.5], macro: 0.12}));
      m.name = 'skyways-trim';
      return m;
    });
  }

  // --- builder hooks ------------------------------------------------------------------------

  /**
   * Skyways finishes for the builder's wall faces: public / court / bridge plaster, washroom tile, back-of-house painted concrete;
   * station / storefront faces pass unchanged. Faces split at the station tile line keep one texture base (as OfficeArch).
   */
  remapFaces<F extends FaceLike>(faces: F[], tileLowerHeight: number): F[] {
    return faces.map((f): F | null => {
      if (f.finish === 'tileShop') return f;
      const cls = this.classOf(f.area);
      if (cls === 'station' || cls === 'shop') return f;
      if (cls === 'anchor') return {...f, finish: this.anchorWallKey(f.area)};
      // (task studio-skyways-rework-20261107-054512-01, lane ARCH) a roofed bridge's side walls stop at the springing line (the glass
      // roof is there); a skylight coffer's well walls (the ceiling step over a skylit court) take the plain plaster of a light well;
      // the skylit / atrium courts' walls the textured brick
      if (cls === 'bridge' && !f.slope) {
        const c = this.clipBridgeSide(f);
        if (c === null) return null;
        if (c !== f) return {...c, finish: this.wallKey(cls)};
      }
      if (!f.slope && this.skylit.has(f.area) && f.y0 >= this.skylit.get(f.area)! - 0.02) return {...f, finish: this.def('skyways-reveal', () => wallMaterial(this.mats, 'skyways-reveal', SKYWAYS_REVEAL_WALL))};
      const up = /tileUpper/.test(f.finish) && f.vb0 !== undefined ? {vb0: f.vb0 - tileLowerHeight, vb1: (f.vb1 ?? f.vb0) - tileLowerHeight} : {};
      if (!f.slope && cls !== 'wet' && cls !== 'boh' && this.courtLook(f.area)) return {...f, finish: this.texKey('brickWall', () => this.wallKey(cls)), ...up};
      // stair flight side walls: public flights plaster, service flights the core
      const finish = this.wallKey(f.slope ? (this.layout.areas[f.area]?.publicSpace ? 'public' : 'boh') : cls);
      return {...f, finish, ...up};
    }).filter((f): f is F => f !== null);
  }

  /**
   * (lane ARCH) A roofed bridge deck's face on a side wall plane (along the deck): clipped to the springing line (null: wholly above it);
   * any other face unchanged (the same object).
   */
  private clipBridgeSide<F extends FaceLike>(f: F): F | null {
    const b = this.roofed.get(f.area);
    if (!b) return f;
    const alongX = Math.abs(f.z0 - f.z1) < 1e-9;
    if (alongX !== (b.axis === 'x')) return f;
    const plane = alongX ? f.z0 : f.x0, [p0, p1] = b.axis === 'x' ? [b.rect.z0, b.rect.z1] : [b.rect.x0, b.rect.x1];
    if (Math.abs(plane - p0) > 1e-3 && Math.abs(plane - p1) > 1e-3) return f;
    const top = b.roof!.springY;
    if (f.y1 <= top + 1e-4) return f;
    if (f.y0 >= top - 0.02) return null;
    return {...f, y1: top, openings: f.openings.map(o => ({...o, top: Math.min(o.top, top)}))};
  }

  /** Floor key of an open cell of level index L (null: the builder's own rule). */
  floorKey(L: number, i: number): string | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    const area = lvl.grid.area[i], cls = this.classOf(area);
    // (lane ARCH) roofed bridges: clay pavers; skylit / atrium courts: herringbone brick (stand-ins: dark brick-red stone / court stone)
    if (cls === 'bridge' && this.roofed.has(area)) return this.texKey('pavers', () => this.def('skyways-floor-pavers', () => floorMaterial(this.mats, 'skyways-floor-pavers', SKYWAYS_PAVER_STANDIN.kind, SKYWAYS_PAVER_STANDIN.tint)));
    if ((cls === 'public' || cls === 'court') && this.courtLook(area)) return this.texKey('herringbone', () => this.floorKeyOf('court'));
    switch (cls) {
      case 'public': case 'court': case 'bridge': case 'wet': case 'boh': case 'office': return this.floorKeyOf(cls);
      case 'anchor': return this.anchorFloorKey(lvl.grid.area[i]);
      default: return null;
    }
  }

  /** Ceiling key of a ceiling run (null: builder rule; false: none — inside an atrium opening, under the glass roof). */
  ceilKey(L: number, areaId: number, i?: number, y?: number): string | false | null {
    const lvl = this.levels[L];
    if (!lvl) return null;
    if (i !== undefined && this.atriumRoof[i] > 0) {
      const top = y ?? (lvl.grid.hasCeil(i) ? lvl.grid.ceil[i] : -Infinity);
      if (top >= this.atriumRoof[i] - 0.5) return false;
    }
    const cls = this.classOf(areaId);
    // (lane ARCH) a roofed bridge deck: no ceiling (the glazed roof); a skylight coffer's top: the sky through the roof light; the
    // skylit / atrium courts: the dark timber slat ceiling
    if (cls === 'bridge' && this.roofed.has(areaId)) return false;
    if (i !== undefined && this.coffer[i] && lvl.id === 2 && this.skylit.has(areaId) && (y === undefined || y > this.skylit.get(areaId)! + 0.05)) return this.def(SKYLIGHT_SKY_KEY, () => skylightSkyMaterial());
    if ((cls === 'public' || cls === 'court') && this.courtLook(areaId)) return this.texKey('woodSlats', () => this.slatStandIn());
    switch (cls) {
      case 'public': return this.ceilKeyOf(lvl.id >= 2 ? 'grid' : 'plain');
      case 'court': case 'wet': return this.ceilKeyOf('plain');
      case 'bridge': return this.ceilKeyOf('bridge');
      case 'boh': return this.ceilKeyOf('core');
      case 'office': return this.ceilKeyOf('grid');
      case 'anchor': return this.anchorCeilKey(areaId);
      // storefront units above the station storey: the pedway's light plaster (their walls / floors keep the storefront interior)
      case 'shop': return lvl.id >= 1 ? this.ceilKeyOf('plain') : null;
      default: return null;
    }
  }

  /** Soffit of a door opening: plain plaster (painted concrete between back rooms); null when a side keeps the builder's rule. */
  doorCeilKey(L: number, a: Area | undefined, b: Area | undefined): string | null {
    if (!this.levels[L]) return null;
    const ca = this.classOf(a?.id ?? -1), cb = this.classOf(b?.id ?? -1);
    if (ca === 'station' || cb === 'station' || ((ca === 'shop' || cb === 'shop') && this.levels[L].id < 1)) return null;
    return this.ceilKeyOf(ca === 'boh' && cb === 'boh' ? 'core' : cls2ceil(ca, cb));
  }

  /** Door frame trim (null: the station's steel / a storefront). */
  doorTrimKey(_level: number, a: Area | undefined): string | null {
    const c = this.classOf(a?.id ?? -1);
    return c === 'station' || c === 'shop' ? null : this.trimKey();
  }

  /** Texture scale (m per repeat) of a skyways key; undefined for any other key. */
  scale(key: string): {u: number; v: number} | undefined {
    if (!isSkywaysKey(key)) return undefined;
    // (lane ARCH) the textured finishes: their texture's real-world span; the skylight sky: unmapped
    for (const [t, k] of Object.entries(SKYWAYS_TEX_KEYS) as [SkywaysArchTextureKey, string][]) if (key === k) return skywaysArchSpan(t);
    if (key === SKYLIGHT_SKY_KEY) return {u: 1, v: 1};
    if (key.startsWith('skyways-floor') || key.startsWith('skyways-anchor-floor')) return {u: OFFICE_FLOOR_SPAN, v: OFFICE_FLOOR_SPAN};
    if (key.startsWith('skyways-ceil') || key.startsWith('skyways-anchor-ceil')) return {u: OFFICE_CEIL_SPAN, v: OFFICE_CEIL_SPAN};
    if (key === 'skyways-trim') return {u: 1, v: 1};
    return {u: OFFICE_WALL_SPAN, v: OFFICE_WALL_SPAN};
  }

  /** The material behind a skyways key (built on first use); undefined for any other key. */
  material(key: string): THREE.Material | undefined {
    if (!isSkywaysKey(key)) return undefined;
    let m = this.materials.get(key);
    if (!m) {
      const make = this.specs.get(key);
      if (!make) return undefined;
      this.materials.set(key, (m = make()));
    }
    return m;
  }

  /** Mesh name of a skyways key's architecture meshes (undefined: the builder's 'arch-…' name). */
  meshName(_key: string): string | undefined { return undefined; }

  /**
   * The GAS lane's reveal material (world/skywaysWindows.ts revealMaterial): the public wall's plain paint (every span is in a public
   * facade or a bridge side). Built on first use.
   */
  revealMaterial(_level: number): THREE.Material {
    return this.material(this.def('skyways-reveal', () => wallMaterial(this.mats, 'skyways-reveal', SKYWAYS_REVEAL_WALL)))!;
  }

  /** Every skyways material this build uses so far (diagnostics / tests). */
  usedMaterials(): Map<string, THREE.Material> {
    for (const k of this.specs.keys()) this.material(k);
    return new Map(this.materials);
  }

  // --- atrium roofs -------------------------------------------------------------------------

  /** Builds every atrium's glazed vault + steel into `group` (tagged with the street and skyway storeys). Returns its stats. */
  buildRoofs(group: THREE.Group): SkywaysRoofStats {
    const glass = new Quads(), steel = new Quads();
    let roofs = 0;
    for (const b of this.info.buildings) {
      if (!b.atrium) continue;
      const v = atriumVault(b.atrium.rect, b.atrium.roofY);
      roofs++;
      this.stats.panes += vaultGlass(v, glass);
      this.stats.arches += vaultSteel(v, steel);
    }
    this.stats.roofs = roofs;
    const tag = [...new Set(this.info.storeys.filter(s => s.role !== 'station').map(s => s.level))];
    // (task studio-skyways-rework-20261107-054512-01, lane ARCH) the glazed bridge roofs (skyway storey) and the skylight coffers' glazing
    const sky = this.info.storeys.find(s => s.role === 'skyway')?.level ?? 2;
    this.bridgeRoofs = buildBridgeRoofs(group, this.info.bridges, light => this.material(light ? this.lightSteelKey() : this.trimKey())!, [sky]);
    if (this.info.skylights?.length) this.skylightStats = buildSkylights(group, this.info.skylights, this.material(this.trimKey())!);
    const out: THREE.Mesh[] = [];
    const g = glass.mesh(skywaysRoofGlass(this.mats), 'skyways-atrium-glass', tag);
    if (g) out.push(g);
    const s = steel.mesh(this.material(this.trimKey())!, 'skyways-atrium-steel', tag);
    if (s) out.push(s);
    for (const m of out) {
      group.add(m);
      this.stats.meshes++;
      this.stats.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
    return this.stats;
  }

  /** Summary (QA / tests). */
  summary(): {materials: string[]; roofs: SkywaysRoofStats; bridgeRoofs: BridgeRoofStats[]; skylights: SkylightStats} {
    return {materials: [...this.usedMaterials().keys()].sort(), roofs: {...this.stats}, bridgeRoofs: this.bridgeRoofs.map(b => ({...b})), skylights: {...this.skylightStats}};
  }
}

const cls2ceil = (a: SkywaysClass, b: SkywaysClass): keyof typeof SKYWAYS_CEILS => (a === 'bridge' || b === 'bridge' ? 'bridge' : 'plain');

const roofGlassCache = new WeakMap<WorldMaterials, THREE.Material>();
/** The atrium roof glazing: the mall's roof glass (one instance per WorldMaterials). */
export function skywaysRoofGlass(mats: WorldMaterials): THREE.Material {
  let m = roofGlassCache.get(mats);
  if (!m) {
    roofGlassCache.set(mats, (m = roofGlass()));
    m.name = 'skyways-atrium-glass';
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Vault geometry (pure)

/** A barrel vault over an atrium rect: long axis, springing y, rise, bays. */
export interface AtriumVault {
  alongX: boolean;
  /** Along range (the long axis) and across range. */
  l0: number; l1: number; a0: number; a1: number;
  springY: number; rise: number; bays: number;
}

/** Vault segments around the arch. */
export const VAULT_SEG = 12;

/** The vault over an atrium rect (long axis = the longer side; rise ~30 % of the span, 1.2..3 m; bays ~3 m). */
export function atriumVault(r: SkywaysRect, roofY: number): AtriumVault {
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const l0 = alongX ? r.x0 : r.z0, l1 = alongX ? r.x1 : r.z1, a0 = alongX ? r.z0 : r.x0, a1 = alongX ? r.z1 : r.x1;
  return {alongX, l0, l1, a0, a1, springY: roofY, rise: Math.min(3, Math.max(1.2, 0.3 * (a1 - a0))), bays: Math.max(1, Math.round((l1 - l0) / 3))};
}

/** Point k (0..VAULT_SEG) on the elliptical arch: across coordinate + height. */
export function vaultArc(v: AtriumVault, k: number, inset = 0): {a: number; y: number} {
  const th = Math.PI * k / VAULT_SEG, half = (v.a1 - v.a0) / 2, mid = (v.a0 + v.a1) / 2;
  return {a: mid - Math.cos(th) * (half - inset), y: v.springY + Math.sin(th) * Math.max(0.2, v.rise - inset)};
}

const P3 = (v: AtriumVault, l: number, a: number, y: number): number[] => (v.alongX ? [l, y, a] : [a, y, l]);

/** Glass panes (bays x segments) + both gable fans; uv in metres. Returns the pane count. */
function vaultGlass(v: AtriumVault, q: Quads): number {
  const bay = (v.l1 - v.l0) / v.bays;
  let n = 0;
  const sAt: number[] = [0];
  for (let k = 1; k <= VAULT_SEG; k++) { const p = vaultArc(v, k - 1), c = vaultArc(v, k); sAt.push(sAt[k - 1] + Math.hypot(c.a - p.a, c.y - p.y)); }
  for (let b = 0; b < v.bays; b++) {
    const la = v.l0 + b * bay, lb = la + bay;
    for (let k = 0; k < VAULT_SEG; k++) {
      const p = vaultArc(v, k), c = vaultArc(v, k + 1);
      const ma = (p.a + c.a) / 2 - (v.a0 + v.a1) / 2, my = (p.y + c.y) / 2 - v.springY;
      const ni = -ma, ny = -my * 4, nn = Math.hypot(ni, ny) || 1; // inward-ish normal (double-sided glass: only for the fresnel)
      q.quad([P3(v, la, p.a, p.y), P3(v, lb, p.a, p.y), P3(v, lb, c.a, c.y), P3(v, la, c.a, c.y)], v.alongX ? [0, ny / nn, ni / nn] : [ni / nn, ny / nn, 0],
        [[la, sAt[k]], [lb, sAt[k]], [lb, sAt[k + 1]], [la, sAt[k + 1]]]);
      n++;
    }
  }
  for (const l of [v.l0, v.l1]) {
    const n3 = v.alongX ? [l === v.l0 ? 1 : -1, 0, 0] : [0, 0, l === v.l0 ? 1 : -1];
    for (let k = 0; k < VAULT_SEG; k++) {
      const p = vaultArc(v, k), c = vaultArc(v, k + 1);
      q.quad([P3(v, l, p.a, v.springY), P3(v, l, c.a, v.springY), P3(v, l, c.a, c.y), P3(v, l, p.a, p.y)], n3, [[p.a, v.springY], [c.a, v.springY], [c.a, c.y], [p.a, p.y]]);
      n++;
    }
  }
  return n;
}

/** Dark steel: an arch truss at every bay line, purlins, the edge girders on the springing line, gable mullions. Returns arches. */
function vaultSteel(v: AtriumVault, q: Quads): number {
  const bay = (v.l1 - v.l0) / v.bays;
  const V = (l: number, a: number, y: number) => new THREE.Vector3(...(P3(v, l, a, y) as [number, number, number]));
  const depth = Math.min(0.45, v.rise * 0.2);
  let arches = 0;
  for (let b = 0; b <= v.bays; b++) {
    const l = v.l0 + b * bay;
    for (let k = 0; k < VAULT_SEG; k++) {
      const p = vaultArc(v, k), c = vaultArc(v, k + 1), pi = vaultArc(v, k, depth), ci = vaultArc(v, k + 1, depth);
      q.beam(V(l, p.a, p.y - 0.05), V(l, c.a, c.y - 0.05), 0.12, 0.1);
      q.beam(V(l, pi.a, pi.y), V(l, ci.a, ci.y), 0.08, 0.08);
      if (k % 2 === 0) q.beam(V(l, p.a, p.y - 0.05), V(l, ci.a, ci.y), 0.05, 0.05);
    }
    arches++;
  }
  for (let k = 3; k < VAULT_SEG; k += 3) { const p = vaultArc(v, k); q.beam(V(v.l0, p.a, p.y - 0.09), V(v.l1, p.a, p.y - 0.09), 0.07, 0.09); }
  // edge girders on the springing line (their top a little under it: never coplanar with the podium roof outside the opening)
  for (const a of [v.a0, v.a1]) q.beam(V(v.l0, a, v.springY - 0.2), V(v.l1, a, v.springY - 0.2), 0.3, 0.36);
  for (const l of [v.l0, v.l1]) {
    for (let k = 2; k < VAULT_SEG; k += 2) { const p = vaultArc(v, k); q.beam(V(l, p.a, v.springY), V(l, p.a, p.y), 0.07, 0.07); }
    q.beam(V(l, v.a0, v.springY - 0.2), V(l, v.a1, v.springY - 0.2), 0.3, 0.36);
  }
  return arches;
}

// ---------------------------------------------------------------------------------------------
// Merged quads / beams

/** Merged quads and boxes (counter-clockwise toward the normal). */
export class Quads {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  get empty(): boolean { return !this.idx.length; }
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const order = (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2] < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const b = this.pos.length / 3;
    for (const i of order) { this.pos.push(p[i][0], p[i][1], p[i][2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[i][0], uv[i][1]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** Append a BufferGeometry (positions, normals, uvs; disposed). */
  add(g: THREE.BufferGeometry): void {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, b = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) { this.pos.push(p.getX(i), p.getY(i), p.getZ(i)); this.nor.push(n.getX(i), n.getY(i), n.getZ(i)); this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(b + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(b + i);
    g.dispose();
  }
  /** Box between two points (cross-section t x t2). */
  beam(a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t): void {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return;
    const g = new THREE.BoxGeometry(t, t2, len);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.add(g);
  }
  geometry(): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  mesh(mat: THREE.Material, name: string, levels: readonly number[]): THREE.Mesh | null {
    const g = this.geometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.userData.levels = [...levels];
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}
