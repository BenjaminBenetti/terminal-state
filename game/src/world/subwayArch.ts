// Task studio-subway-station-variety-20261117-043926-01: THE SUBWAY STATION IDENTITY — the finish mapper of a version-2 Subway station (the
// builder's arch chain asks SubwayArch exactly like OfficeArch / MallArch / ReactorArch / SkywaysArch / MarketArch / BunkerArch on their
// levels; null without layout.identity — every version-1 station and every other level draws exactly as before). Its accent colour is
// read by world/wallDetailPlan.ts, its plate colours by world/builder.ts signTexture (subwayPlate below).
//
// Task studio-subway-architecture-materials-rework-20261117-072826-01 (user: the station "looks poor with bad textures … giant repetitious /
// stretched stained surfaces and ceiling treatment are not a believable station"): the identity no longer stretches the Reactor's rusted
// pit concrete / the mine rock over whole walls and ceilings. Every public wall is ZONED (world/subwayFinish.ts: granite plinth, dado,
// field, accent band, upper wall), the public ceilings / floors / door reveals take the station scheme's plaster / slat / concrete soffits,
// terrazzo / granite floors and stone trims, all from the Codex-generated Subway architecture sets at their real module sizes
// (world/subwayArchTextures.ts, loaded behind the loading screen; a flat stand-in of each set's mean colour until then). The relief —
// caps, cornices, pilasters, beams, coffers, vaults, lantern bodies — is world/subwayKit.ts. Render-only: no layout field changes.

import type * as THREE from 'three';
import type {Level} from '../gen/levels';
import type {Area, StationIdentity, StationLayout} from '../gen/stationTypes';
import type {BuiltFace} from './levelGeometry';
import {COLUMN_PAINT, cloneSurfaceMaterial, columnPaintGradeCpu, type WorldMaterials} from './materials';
import type {DecayProfile} from './decay';
import {ARCH_CLASS, BAND_MIN_WALL, HALL_ZONES, ZONES, finishSchemeOf, isSignatureHall, keyClass, schemeTextures, zoneKey, type ArchClass, type ArchTex, type ArchZone, type FinishScheme, type HallZone, type ZoneFinish} from './subwayFinish';
import {installSubwayArchTextures, subwayArchMaterial, type SubwayArchLook} from './subwayArchTextures';
import {SUBWAY_ARCH_TEXTURES} from '../assets/subwayArchTextures.generated';
import type {MarketTexHost} from './marketTextures';
import type {KitStats} from './subwayKit';

/** userData flag of the identity's WALL materials: world/wallDetail.ts cuts them like the base walls (lost tiles, spalls, breaches). */
export const SUBWAY_WALL_TAG = 'subwayWall';
/** Is a finish key one of the Subway scheme's (`subway-<class>-<zone>[-hall]`)? */
export const isSubwayKey = (k: string): boolean => keyClass(k) !== null;

/** The tile split the builder's tiled walls carry (WorldMaterials.tileLowerHeight / world/wallDetailFaces.ts TILE_LINE). */
const TILE_SPLIT = 1.8;

const hexOf = (h: number) => `#${h.toString(16).padStart(6, '0')}`;
/** The wayfinding plate colours of a version-2 station (null: the builder's default dark plate). CSS strings for the canvas. */
export function subwayPlate(layout: Pick<StationLayout, 'identity'>): {bg: string; fg: string; accent: string} | null {
  const id = layout.identity;
  return id ? {bg: hexOf(id.plate.bg), fg: hexOf(id.plate.fg), accent: hexOf(id.accent)} : null;
}

// --- decay: light, spatially sensible ageing (user: "not the same dramatic streaks on every wall and ceiling") ---------------------------
const D = (o: Partial<DecayProfile> & {tint: [number, number, number]}): DecayProfile =>
  ({grime: 0, streaks: 0, efflor: 0, stains: 0, wear: 0, dust: 0, cracks: 0, peel: 0, tile: 0, tileLoss: 0, fade: 0, paintWear: 0, ...o});
const DECAY: Readonly<Record<ArchClass | 'plinth' | 'ceil' | 'floor', DecayProfile>> = {
  tile: D({grime: 0.45, streaks: 0.16, efflor: 0.14, stains: 0.18, cracks: 0.1, fade: 0.18, tint: [0.6, 0.53, 0.43]}),
  stone: D({grime: 0.4, streaks: 0.1, efflor: 0.12, stains: 0.18, cracks: 0.08, tint: [0.55, 0.5, 0.42]}),
  concrete: D({grime: 0.4, streaks: 0.22, efflor: 0.2, stains: 0.2, cracks: 0.2, tint: [0.5, 0.47, 0.42]}),
  plaster: D({grime: 0.2, stains: 0.3, cracks: 0.15, peel: 0.2, fade: 0.1, tint: [0.6, 0.54, 0.44]}),
  metal: D({grime: 0.25, stains: 0.2, tint: [0.5, 0.46, 0.4]}),
  terrazzo: D({grime: 0.35, wear: 0.5, dust: 0.5, stains: 0.35, efflor: 0.12, cracks: 0.2, tile: 0.6, tileLoss: 0.02, tint: [0.5, 0.45, 0.37]}),
  rock: D({grime: 0.35, streaks: 0.28, efflor: 0.3, stains: 0.15, cracks: 0.1, tint: [0.52, 0.48, 0.42]}),
  plinth: D({grime: 0.6, streaks: 0.04, stains: 0.2, cracks: 0.05, tint: [0.45, 0.42, 0.38]}),
  ceil: D({grime: 0.18, stains: 0.32, efflor: 0.1, cracks: 0.12, peel: 0.15, fade: 0.1, tint: [0.6, 0.53, 0.42]}),
  floor: D({grime: 0.35, wear: 0.5, dust: 0.5, stains: 0.35, efflor: 0.12, cracks: 0.15, tile: 0.6, tileLoss: 0.01, tint: [0.5, 0.46, 0.39]}),
};

const WALL_ZONES: ReadonlySet<ArchZone> = new Set(['plinth', 'dado', 'field', 'band', 'upper']);
const GLOSS: ReadonlySet<ArchClass> = new Set(['tile', 'stone', 'terrazzo']);

/** The material look of a zone finish. */
function lookOf(f: ZoneFinish, zone: ArchZone): SubwayArchLook {
  const cls = ARCH_CLASS[f.tex];
  const wall = WALL_ZONES.has(zone);
  // (the kit's piers / fins and panels are large wall-like relief: the wall's anisotropy and floor grime, never a wall-detail cut host)
  const wallLike = wall || zone === 'pier' || zone === 'panel';
  const role: SubwayArchLook['role'] = wallLike ? 'wall' : zone === 'floor' ? 'floor' : zone === 'ceil' || zone === 'struct' ? 'ceiling' : 'trim';
  const decay = zone === 'plinth' || zone === 'base' ? DECAY.plinth : zone === 'floor' ? (cls === 'terrazzo' ? DECAY.terrazzo : DECAY.floor) : zone === 'ceil' ? (cls === 'plaster' ? DECAY.ceil : DECAY[cls]) : DECAY[cls];
  return {
    role, reflect: GLOSS.has(cls) && zone !== 'struct' && zone !== 'ceil' ? 'gloss' : 'none', tint: f.tint, decay,
    grime: wallLike ? [zone === 'plinth' ? 0.35 : 0.22, 0.7] : undefined, macro: cls === 'rock' || cls === 'concrete' ? 0.22 : 0.12,
    thin: zone === 'trim' || zone === 'accent',
  };
}

/** A scheme's own (non-hall) finish of a zone (null: the scheme draws none — a scheme without a band / panel). */
function schemeZone(s: FinishScheme, zone: ArchZone): ZoneFinish | null {
  switch (zone) {
    case 'base': return s.plinth;
    case 'band': return s.band;
    case 'panel': return s.panel ?? null;
    default: return s[zone];
  }
}

/**
 * Task studio-subway-rework-m2-finishing-20261117-111246-01: the GRADED paint (linear) the station columns' 'columnPaint' material lands at
 * now, per channel (its set's base paint through the column grade).
 */
const COLUMN_GRADED = COLUMN_PAINT.base.map((c, i) => columnPaintGradeCpu(c, i as 0 | 1 | 2));
/** The colour multiplier that takes the column grade's output to `target` (the grade is a power curve: (target / now)^(1 / gamma)). */
export function columnPaintMultiplier(target: readonly [number, number, number]): [number, number, number] {
  return [0, 1, 2].map(i => Math.min(3, Math.max(0.08, Math.pow(target[i] / COLUMN_GRADED[i], 1 / COLUMN_PAINT.gamma)))) as [number, number, number];
}
const columnCache = new WeakMap<THREE.Material, Map<string, THREE.Material>>();

export class SubwayArch {
  readonly identity: StationIdentity;
  readonly scheme: FinishScheme;
  stats = {faces: {} as Record<string, number>};
  /** What world/subwayKit.ts drew (the builder sets it). */
  kit?: KitStats;

  static for(layout: StationLayout, mats: WorldMaterials, levels: readonly Level[]): SubwayArch | null {
    return layout.identity && levels.length ? new SubwayArch(layout, mats, levels) : null;
  }

  private constructor(readonly layout: StationLayout, readonly mats: WorldMaterials, readonly levels: readonly Level[]) {
    this.identity = layout.identity!;
    this.scheme = finishSchemeOf(layout)!;
  }

  private count(k: string): void { this.stats.faces[k] = (this.stats.faces[k] ?? 0) + 1; }

  /** A core public hall / platform / passage (not a storefront unit's interior, not a track-extension area). */
  publicArea(a: Area | undefined): a is Area {
    return !!a && a.publicSpace && !a.ext && a.type !== 'shop' && a.type !== 'eatery';
  }

  /** The finish of a wall zone of an area (a signature hall's field / upper / piers are its own). */
  zoneFinish(zone: ArchZone, a: Area | undefined): {finish: ZoneFinish; key: string} {
    const s = this.scheme, hall = isSignatureHall(a);
    // a cavern's painted rock above its wainscot: one key for every rock wall (the track bed's too: world/subwayArch.ts remapFaces)
    if (s.rock && (zone === 'field' || zone === 'upper')) return {finish: s.rock.wall, key: zoneKey(s.rock.wall, 'dado')};
    const eq = (p: ZoneFinish, q: ZoneFinish) => p.tex === q.tex && String(p.tint) === String(q.tint);
    const pick = (): [ZoneFinish, boolean] => {
      if (hall && HALL_ZONES.has(zone)) {
        const f = s.hall[zone as HallZone], own = schemeZone(s, zone);
        // (a hall pier in the station's own pier finish keeps its key: one material)
        return [f, !(zone === 'pier' && own && eq(own, f))];
      }
      return [schemeZone(s, zone) ?? s.field, false];
    };
    const [finish, h] = pick();
    // a wall zone drawn in the same finish as the zone below it shares that zone's key (one material, one mesh per chunk)
    const same = (q: ArchZone) => eq(q === 'dado' ? s.dado : hall ? s.hall.field : s.field, finish);
    if (zone === 'upper' && same('field')) return this.zoneFinish('field', a);
    if ((zone === 'field' || zone === 'upper') && !h && same('dado')) return {finish, key: zoneKey(finish, 'dado')};
    return {finish, key: zoneKey(finish, zone, h)};
  }

  /**
   * Wall finishes of the public spaces: each flat face is split into its zones (absolute heights from the face's floor; doors / arches keep
   * their openings in every piece), a flight's raked zones take plinth / dado / field, and the track bed's far walls above the platform take
   * the station's wall too (a cavern's whole bed in painted rock). Every piece keeps the floor as its texture base, so world/wallDetailFaces.ts
   * merges a wall's pieces back into one treatment face.
   */
  remapFaces<F extends BuiltFace>(faces: F[]): F[] {
    const out: F[] = [];
    for (const f of faces) {
      const a = f.area >= 0 ? this.layout.areas[f.area] : undefined;
      if (f.kind === 'tile' && /^tile(Lower|Upper|Base)$/.test(f.finish)) {
        if (f.slope) {
          const zone: ArchZone = f.finish === 'tileBase' ? 'plinth' : f.finish === 'tileLower' ? 'dado' : 'field';
          const {key} = this.zoneFinish(zone, a);
          this.count(key);
          out.push({...f, finish: key});
          continue;
        }
        const floor = f.finish === 'tileUpper' ? f.vb0 - TILE_SPLIT : f.vb0;
        this.split(f, a, floor, out);
        continue;
      }
      if (f.kind === 'tunnel' && f.finish === 'tunnel' && !(a && a.ext) && !f.slope) {
        // the track bed's walls: below the platform level the tunnel lining stays; above it the station's own wall (a cavern: rock throughout)
        if (this.scheme.rock) { const k = zoneKey(this.scheme.rock.wall, 'dado'); this.count(k); out.push({...f, finish: k}); continue; }
        if (f.y1 <= 0.3) { out.push(f); continue; }
        if (f.y0 < 0) out.push({...f, y1: 0});
        this.split({...f, y0: Math.max(0, f.y0)}, undefined, 0, out);
        continue;
      }
      out.push(f);
    }
    return out;
  }

  /** The zone pieces of a flat wall face over a floor (adjacent zones with the same finish merge). */
  private split<F extends BuiltFace>(f: F, a: Area | undefined, floor: number, out: F[]): void {
    const tall = Math.max(f.y1, a?.ceil ?? f.y1) - floor >= BAND_MIN_WALL && !!this.scheme.band;
    const cuts: [ArchZone, number, number][] = [
      ['plinth', -Infinity, floor + ZONES.plinth], ['dado', floor + ZONES.plinth, floor + ZONES.dado],
      ...(tall
        ? [['field', floor + ZONES.dado, floor + ZONES.band0], ['band', floor + ZONES.band0, floor + ZONES.band1], ['upper', floor + ZONES.band1, Infinity]] as [ArchZone, number, number][]
        : [['field', floor + ZONES.dado, Infinity]] as [ArchZone, number, number][]),
    ];
    let last: {zf: ZoneFinish; piece: F} | null = null;
    for (const [zone, z0, z1] of cuts) {
      const y0 = Math.max(f.y0, z0), y1 = Math.min(f.y1, z1);
      if (y1 - y0 < 1e-3) continue;
      const {finish, key} = this.zoneFinish(zone, a);
      if (last && last.zf.tex === finish.tex && String(last.zf.tint) === String(finish.tint)) { last.piece.y1 = y1; continue; }
      const piece = {...f, y0, y1, finish: key, vb0: floor, vb1: floor, openings: f.openings.map(o => ({...o}))};
      this.count(key);
      out.push(piece);
      last = {zf: finish, piece};
    }
  }

  /** Public floors (not the platforms' slab + safety edges, drawn by the builder): terrazzo / granite. */
  floorKey(L: number, i: number): string | null {
    const g = this.levels[L]?.grid;
    if (!g) return null;
    const a = this.layout.areas[g.area[i]];
    if (!this.publicArea(a) || a.type === 'platform') return null;
    return this.zoneFinish('floor', a).key;
  }

  /** Public ceilings and the track bed's roof (area -1). */
  ceilKey(_L: number, areaId: number): string | null {
    const a = areaId >= 0 ? this.layout.areas[areaId] : undefined;
    if (areaId >= 0 && !this.publicArea(a)) return null;
    if (this.scheme.rock) return zoneKey(this.scheme.rock.ceil, 'ceil');
    return this.zoneFinish('ceil', a).key;
  }

  /** Door soffits between two public spaces take the ceiling finish (null: the builder's rule). */
  doorCeilKey(_L: number, a: Area | undefined, b: Area | undefined): string | null {
    return this.publicArea(a) && this.publicArea(b) ? this.ceilKey(0, b.id) : null;
  }

  /** Public openings get stone / enamel / concrete reveals (the builder's jambs + head in the scheme's trim). */
  doorTrimKey(_level: number, a: Area | undefined): string | null {
    return this.publicArea(a) ? zoneKey(this.scheme.trim, 'trim') : null;
  }

  /** The kit's structure key of an area (beams, ribs, vaults, pilasters). */
  structKey(a: Area | undefined): string { return this.zoneFinish('struct', a).key; }
  /** The kit's trim key (caps, cornices, fillets). */
  trimKey(): string { return zoneKey(this.scheme.trim, 'trim'); }
  /** The kit's proud base (the plinth's granite, not a wall-detail cut host). */
  baseKey(): string { return zoneKey(this.scheme.plinth, 'base'); }
  /** A cavern's rock vault (the rock ceiling finish). */
  rockCeilKey(): string { return zoneKey(this.scheme.rock?.ceil ?? this.scheme.ceil, 'ceil'); }
  /**
   * Task studio-subway-rework-m2-finishing-20261117-111246-01: the kit's PIER finish of an area (pilasters / fins, clerestory piers, the
   * arcade beam) and the scheme's ACCENT finish (string courses, fascias, clock bezels, tablet surrounds, portal frames) — its own
   * structural / trim language (heritage oxblood faience, civic navy glaze, brutalist precast fins + signal orange, a cavern's grey
   * granite + neutral precast...: world/subwayFinish.ts).
   */
  pierKey(a: Area | undefined): string { return this.zoneFinish('pier', a).key; }
  accentKey(): string { return zoneKey(this.scheme.accent, 'accent'); }
  /** Backing / service panels against a wall (null: the scheme draws none). */
  panelKey(): string | null { return this.scheme.panel ? zoneKey(this.scheme.panel, 'panel') : null; }
  /** How the kit shapes the piers: applied pilasters or deep fins. */
  get pierForm(): 'pilaster' | 'fin' { return this.scheme.pierForm ?? 'pilaster'; }

  /**
   * The station columns' material (world/stationColumns.ts riveted H-columns): the shared 'columnPaint' with the scheme's paint — a
   * render-only per-identity clone of the same node graph (colour uniform only; one material per station), or `base` itself when the
   * scheme keeps the default slate-teal.
   */
  columnMaterial(base: THREE.Material): THREE.Material {
    const target = this.scheme.columnPaint;
    if (!target) return base;
    let per = columnCache.get(base);
    if (!per) columnCache.set(base, (per = new Map()));
    const name = `station-column-paint#${this.identity.theme}`;
    let m = per.get(name);
    if (!m) {
      const k = columnPaintMultiplier(target);
      const c = cloneSurfaceMaterial(base) as THREE.Material & {color: THREE.Color};
      c.color.setRGB(c.color.r * k[0], c.color.g * k[1], c.color.b * k[2]);
      c.userData.lightAlbedo = COLUMN_PAINT.base.map((v, i) => columnPaintGradeCpu(v * k[i], i as 0 | 1 | 2));
      c.name = name;
      per.set(name, (m = c));
    }
    return m;
  }

  scale(key: string): {u: number; v: number} | undefined {
    return isSubwayKey(key) ? {u: 1, v: 1} : undefined; // world-mapped at each set's own span (UVs unused)
  }

  /** The zone finish a key names (null: not this scheme's). */
  private finishOf(key: string): {finish: ZoneFinish; zone: ArchZone} | null {
    const m = /^subway-[a-z]+-([a-z]+)(-hall)?$/.exec(key);
    if (!m) return null;
    const zone = m[1] as ArchZone, hall = !!m[2], s = this.scheme;
    if (s.rock && keyClass(key) === 'rock') return {finish: zone === 'ceil' ? s.rock.ceil : s.rock.wall, zone};
    const f = hall && HALL_ZONES.has(zone) ? s.hall[zone as HallZone] : schemeZone(s, zone);
    return f ? {finish: f, zone} : null;
  }

  material(key: string): THREE.Material | undefined {
    const z = this.finishOf(key);
    if (!z) return undefined;
    const m = subwayArchMaterial(this.mats, z.finish.tex, `${key}#${this.identity.theme}#${hexOf(this.identity.wallTint)}`, lookOf(z.finish, z.zone));
    if (WALL_ZONES.has(z.zone)) m.userData[SUBWAY_WALL_TAG] = true;
    return m;
  }
}

/** The sets a layout draws (its section preload; empty for a version-1 station). */
export function subwayArchKeysOf(layout: Pick<StationLayout, 'identity'>): ArchTex[] {
  const s = finishSchemeOf(layout);
  return s ? schemeTextures(s).filter(k => k in SUBWAY_ARCH_TEXTURES) : [];
}

/** Installs the scheme sets' preload into a Game (one call in the Game constructor). */
export function installSubwayIdentityTextures(host: MarketTexHost): ReturnType<typeof installSubwayArchTextures> {
  return installSubwayArchTextures(host, layout => subwayArchKeysOf(layout as Pick<StationLayout, 'identity'>));
}
