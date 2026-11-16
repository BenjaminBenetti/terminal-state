// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the LOOK of each Surface Run facade style (GEN's list:
// gen/surface/facades.ts SURFACE_FACADES) and of each building programme's interior — pure data (no three.js), read by the district
// plan (archPlan.ts) and its materials (archMaterials.ts).
//
// Every finish reuses an existing approved texture set (root CLAUDE.md: Codex textures stay the source; tint / tiling only):
//  - brick: the Skyways arch Codex brick wall (textures/skyways/arch), tinted per building (relative to the texture's own red);
//  - concrete / precast / stone / asphalt / kerbs / yards / the cordon wall: the Reactor's Codex pit-concrete PBR set, tinted;
//  - stucco and every interior: the office architecture's wall / floor / ceiling programs (world/officeArch.ts: the Codex T4 wall, T1
//    carpet, T2 ceiling tile; its existing procedural grain for hard floors) in this district's palettes;
//  - corrugated / sheet metal (industrial sheds, the depot): the Reactor's Codex rusted-steel set, paint-tinted;
//  - verges / rubble ground: the Reactor's Codex mine-rock set, earth-tinted; plazas: the Skyways Codex pavers / herringbone;
//  - tent canvas: the office cubicle fabric (Codex), olive drab.
// Signs and lane paint are dynamic / data content (runtime text, a wear mask), never static art.

import type {SurfaceBuilding, SurfaceBuildingKind} from '../../gen/surface/surfaceTypes';
import type {DamageClass} from '../../damage/materials';

/** A facade's wall finish family (archMaterials.ts maps each to a texture set). */
export type FacadeWall = 'brick' | 'concrete' | 'curtain' | 'stucco' | 'metal' | 'stone' | 'canvas';
/** Ground storey treatment. */
export type FacadeGround = 'shopfront' | 'lobby' | 'plinth' | 'dock' | 'canopy' | 'none';
/** Upper storey windows. */
export type FacadeWindows = 'punched' | 'band' | 'curtain' | 'high' | 'tall' | 'none';

/** The facade style ids LOOK draws (GEN's SURFACE_FACADES ids; tests pin that both lists agree). */
export const LOOK_FACADE_IDS = [
  'brick-retail', 'brick-residential', 'stucco', 'concrete-office', 'glass-office', 'precast-centre', 'industrial-shed', 'civic-stone',
  'transit-headhouse', 'tent-canvas',
] as const;
export type LookFacadeId = typeof LOOK_FACADE_IDS[number];

export interface FacadeStyle {
  id: LookFacadeId;
  wall: FacadeWall;
  /**
   * Wall tints (sRGB hex), one picked per building. Textured walls (brick / concrete / metal / stone) use them RELATIVE to the first
   * (the first = the texture's own tone); stucco / curtain use them as the paint / panel colour.
   */
  tints: readonly number[];
  /** Window frame / trim colour (sRGB hex). */
  trim: number;
  /** Floor-to-floor height the window rows follow when the building gives none (m). */
  storey: number;
  ground: FacadeGround;
  windows: FacadeWindows;
  /** Upper window size, sill above the storey floor, centre pitch along the facade (m). */
  win: {w: number; h: number; sill: number; pitch: number};
  /** Cornice band at the parapet: projection and height (m; 0 = none). */
  cornice: {out: number; h: number};
  /** Parapet above the roof deck (m). */
  parapet: number;
  /** String courses between storeys. */
  courses: boolean;
  /** Chance of a fire escape on a side / rear frontage (3+ storeys only). */
  fireEscape: number;
  /** Rooftop clutter per 100 m² of roof (HVAC boxes, vents). */
  clutter: number;
  /** A water tank on the roof (old brick / walk-ups, 3+ storeys). */
  tanks: boolean;
}

export const FACADE_STYLES: Readonly<Record<LookFacadeId, FacadeStyle>> = {
  'brick-retail': {
    id: 'brick-retail', wall: 'brick', tints: [0xffffff, 0xd8c2b4, 0xf0d6bc, 0xc4ada2], trim: 0x2f2b27, storey: 3.4,
    ground: 'shopfront', windows: 'punched', win: {w: 1.1, h: 1.6, sill: 0.95, pitch: 2.6}, cornice: {out: 0.32, h: 0.55}, parapet: 0.9,
    courses: true, fireEscape: 0.3, clutter: 0.5, tanks: true,
  },
  'brick-residential': {
    id: 'brick-residential', wall: 'brick', tints: [0xffffff, 0xcdb3a6, 0xe8d2c0, 0xb8a49a], trim: 0x3b3026, storey: 3.1,
    ground: 'none', windows: 'punched', win: {w: 1.0, h: 1.5, sill: 0.9, pitch: 2.3}, cornice: {out: 0.22, h: 0.35}, parapet: 0.8,
    courses: false, fireEscape: 0.85, clutter: 0.3, tanks: true,
  },
  stucco: {
    id: 'stucco', wall: 'stucco', tints: [0xd6c8a8, 0xc9b89a, 0xb8b6a6, 0xd2b8a0, 0xa9b0a2], trim: 0x4a3f33, storey: 3.2,
    ground: 'shopfront', windows: 'punched', win: {w: 1.2, h: 1.5, sill: 0.95, pitch: 2.8}, cornice: {out: 0.2, h: 0.35}, parapet: 0.7,
    courses: false, fireEscape: 0.2, clutter: 0.4, tanks: false,
  },
  'concrete-office': {
    id: 'concrete-office', wall: 'concrete', tints: [0xffffff, 0xe2e0da, 0xf2ead8], trim: 0x3a3c3e, storey: 3.7,
    ground: 'lobby', windows: 'band', win: {w: 2.6, h: 1.5, sill: 0.95, pitch: 2.9}, cornice: {out: 0.18, h: 0.4}, parapet: 1.1,
    courses: false, fireEscape: 0, clutter: 1.0, tanks: false,
  },
  'glass-office': {
    id: 'glass-office', wall: 'curtain', tints: [0x4a5258, 0x5b5f5a, 0x3f474e], trim: 0x24272a, storey: 3.8,
    ground: 'lobby', windows: 'curtain', win: {w: 1.5, h: 2.7, sill: 0.45, pitch: 1.5}, cornice: {out: 0.1, h: 0.6}, parapet: 1.2,
    courses: false, fireEscape: 0, clutter: 0.8, tanks: false,
  },
  'precast-centre': {
    id: 'precast-centre', wall: 'concrete', tints: [0xf4efe4, 0xe6e2d6, 0xefe2cc], trim: 0x2e3133, storey: 4.6,
    ground: 'canopy', windows: 'none', win: {w: 0, h: 0, sill: 0, pitch: 0}, cornice: {out: 0.15, h: 0.9}, parapet: 1.0,
    courses: false, fireEscape: 0, clutter: 1.2, tanks: false,
  },
  'industrial-shed': {
    id: 'industrial-shed', wall: 'metal', tints: [0xb5c4ba, 0xd0b8a0, 0xc8c8c0, 0xa8b4bc], trim: 0x2b2d2e, storey: 7.5,
    ground: 'dock', windows: 'high', win: {w: 3.6, h: 1.1, sill: 5.2, pitch: 4.8}, cornice: {out: 0.12, h: 0.3}, parapet: 0.5,
    courses: false, fireEscape: 0, clutter: 0.25, tanks: false,
  },
  'civic-stone': {
    id: 'civic-stone', wall: 'stone', tints: [0xfff4e6, 0xece2d0, 0xdcd8cc], trim: 0x3d3630, storey: 4.4,
    ground: 'plinth', windows: 'tall', win: {w: 1.4, h: 2.6, sill: 0.9, pitch: 3.2}, cornice: {out: 0.45, h: 0.8}, parapet: 1.0,
    courses: true, fireEscape: 0, clutter: 0.3, tanks: false,
  },
  'transit-headhouse': {
    id: 'transit-headhouse', wall: 'concrete', tints: [0xd8dcdc, 0xcfd4d2], trim: 0x27313a, storey: 3.6,
    ground: 'canopy', windows: 'none', win: {w: 0, h: 0, sill: 0, pitch: 0}, cornice: {out: 0.3, h: 0.45}, parapet: 0.4,
    courses: false, fireEscape: 0, clutter: 0, tanks: false,
  },
  'tent-canvas': {
    id: 'tent-canvas', wall: 'canvas', tints: [0x6b6a4a, 0x5f6248], trim: 0x3a3a2c, storey: 2.2,
    ground: 'none', windows: 'none', win: {w: 0, h: 0, sill: 0, pitch: 0}, cornice: {out: 0, h: 0}, parapet: 0,
    courses: false, fireEscape: 0, clutter: 0, tanks: false,
  },
};

/** Styles that suit each kind, most fitting first (LOOK's fallback for a facade id it does not know: the first). */
const KIND_STYLES: Readonly<Record<SurfaceBuildingKind, readonly LookFacadeId[]>> = {
  store: ['brick-retail', 'stucco'], centre: ['precast-centre', 'stucco'], office: ['concrete-office', 'glass-office'],
  depot: ['industrial-shed'], civic: ['civic-stone', 'concrete-office'], residential: ['brick-residential', 'stucco'],
  industrial: ['industrial-shed', 'concrete-office'], parking: ['concrete-office'], ruin: ['brick-retail', 'stucco', 'concrete-office'],
};

export const isLookFacade = (id: string): id is LookFacadeId => (LOOK_FACADE_IDS as readonly string[]).includes(id);

/** The style a building is drawn with: its own id when known (the skeleton's 'brick' = brick-retail), else its kind's first. */
export function surfaceStyleOf(b: Pick<SurfaceBuilding, 'facade' | 'kind'>): FacadeStyle {
  const id = b.facade === 'brick' ? 'brick-retail' : b.facade;
  if (isLookFacade(id)) return FACADE_STYLES[id];
  return FACADE_STYLES[(KIND_STYLES[b.kind] ?? ['brick-retail'])[0]];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Interiors: the finish family of a building programme (walls / floors / ceilings consistent with the station's interiors)

export type InteriorFamily = 'shop' | 'grocery' | 'office' | 'depot' | 'industrial' | 'residential' | 'civic' | 'centre' | 'clinic' | 'service';
export const INTERIOR_FAMILIES: readonly InteriorFamily[] = ['shop', 'grocery', 'office', 'depot', 'industrial', 'residential', 'civic', 'centre', 'clinic', 'service'];

/** Programme id words -> interior family (GEN's programme ids are free strings: matched by keyword, then by kind). */
const PROGRAMME_WORDS: readonly [RegExp, InteriorFamily][] = [
  [/depot|rail|repair|yard|garage|workshop|transit/, 'depot'],
  [/warehouse|factory|plant|industrial|storage|loading/, 'industrial'],
  [/grocer|market|supermarket|deli|butcher|bakery|food|cafe|diner|restaurant|bar\b|liquor/, 'grocery'],
  [/pharma|clinic|medical|dental|vet|hospital|lab/, 'clinic'],
  [/office|bank|insurance|agency|tower|law|realty|call/, 'office'],
  [/centre|center|mall|arcade|plaza|gallery|strip/, 'centre'],
  [/library|hall|police|fire|post|civic|court|school|church|museum|military|command|tent/, 'civic'],
  [/apartment|flat|residen|hotel|motel|hostel|house|walk-?up/, 'residential'],
  [/utility|service|electric|pump|boiler|substation|parking/, 'service'],
];

const KIND_FAMILY: Readonly<Record<SurfaceBuildingKind, InteriorFamily>> = {
  store: 'shop', centre: 'centre', office: 'office', depot: 'depot', civic: 'civic', residential: 'residential', industrial: 'industrial',
  parking: 'service', ruin: 'service',
};

export function interiorFamilyOf(b: Pick<SurfaceBuilding, 'programme' | 'kind'>): InteriorFamily {
  const p = (b.programme ?? '').toLowerCase();
  for (const [re, fam] of PROGRAMME_WORDS) if (re.test(p)) return fam;
  return KIND_FAMILY[b.kind] ?? 'shop';
}

/** An interior family's finishes: wall paint / lower band / trim (sRGB hex) and the office-program kinds (archMaterials.ts). */
export interface InteriorLook {
  wall: {paint: number; lower: number; trim: number; lower_kind: 'none' | 'paint' | 'wood' | 'tile' | 'stone' | 'concrete'; lowerTop: number; peel: number};
  floor: {kind: 'carpet' | 'vinyl' | 'tile' | 'stone' | 'concrete' | 'wood'; tint?: number};
  ceil: 'grid' | 'plain' | 'raw';
}

export const INTERIOR_LOOKS: Readonly<Record<InteriorFamily, InteriorLook>> = {
  shop: {wall: {paint: 0xd8d2c4, lower: 0x6f7772, trim: 0x3a3c3d, lower_kind: 'paint', lowerTop: 1.1, peel: 0.45}, floor: {kind: 'vinyl', tint: 0xb4ad9c}, ceil: 'grid'},
  grocery: {wall: {paint: 0xdcdad0, lower: 0xc8cec8, trim: 0x55595a, lower_kind: 'tile', lowerTop: 1.4, peel: 0.4}, floor: {kind: 'tile', tint: 0xc4c0b4}, ceil: 'grid'},
  office: {wall: {paint: 0xd2d0c8, lower: 0xbcbab2, trim: 0x55575a, lower_kind: 'paint', lowerTop: 0.1, peel: 0.35}, floor: {kind: 'carpet', tint: 0x5d6670}, ceil: 'grid'},
  depot: {wall: {paint: 0x9fa39b, lower: 0x5d6760, trim: 0x2b2e2f, lower_kind: 'concrete', lowerTop: 1.2, peel: 0.6}, floor: {kind: 'concrete'}, ceil: 'raw'},
  industrial: {wall: {paint: 0xa49f92, lower: 0x6a675e, trim: 0x2f3031, lower_kind: 'concrete', lowerTop: 1.0, peel: 0.55}, floor: {kind: 'concrete'}, ceil: 'raw'},
  residential: {wall: {paint: 0xcfc2aa, lower: 0x8f7a62, trim: 0x5a4632, lower_kind: 'wood', lowerTop: 0.12, peel: 0.55}, floor: {kind: 'wood', tint: 0x7a5c40}, ceil: 'plain'},
  civic: {wall: {paint: 0xd9d2c0, lower: 0xa89c86, trim: 0x4c4036, lower_kind: 'stone', lowerTop: 1.0, peel: 0.35}, floor: {kind: 'stone', tint: 0xb8b0a0}, ceil: 'plain'},
  centre: {wall: {paint: 0xe0dace, lower: 0xb8b0a2, trim: 0x34373a, lower_kind: 'stone', lowerTop: 1.0, peel: 0.3}, floor: {kind: 'stone', tint: 0xd2cbbe}, ceil: 'grid'},
  clinic: {wall: {paint: 0xe2e2dc, lower: 0xb9c6c4, trim: 0x6a7071, lower_kind: 'paint', lowerTop: 1.0, peel: 0.3}, floor: {kind: 'vinyl', tint: 0xc9cbc2}, ceil: 'grid'},
  service: {wall: {paint: 0xa8aaa2, lower: 0x5b625e, trim: 0x2d2f30, lower_kind: 'paint', lowerTop: 1.0, peel: 0.6}, floor: {kind: 'concrete'}, ceil: 'raw'},
};

/** Generic shop names for the decorative shopfronts of buildings GEN left unnamed (runtime sign text, seeded per building). */
export const SHOPFRONT_NAMES: readonly string[] = [
  'CORNER DELI', 'REX PAWN & LOAN', 'SUDS LAUNDROMAT', 'BELL HARDWARE', 'GOLDEN WOK', 'QUIK CASH', 'STAR NAILS', 'MIDTOWN TAILOR',
  'OK PHARMACY', 'NORTHSIDE BOOKS', 'LUCKY VIDEO', 'PRIME CELLULAR', 'CITY OPTICAL', 'DAILY MART', 'ROSA BAKERY', 'ACE SHOES',
  'MAPLE DINER', 'VOGUE CUTS', 'UNION SUPPLY', 'KEY & LOCK', 'TIP TOP CLEANERS', 'HAPPY PETS', 'SPARKY RADIO & TV', 'METRO LIQUOR',
  'PHO 88', 'GOODREST FURNITURE', 'CARLTON DRUGS', 'THE COPY CENTRE', 'KING PIZZA', 'ELM ST. BARBER', 'DOLLAR WORLD', 'TONY\'S SUBS',
];

// ---------------------------------------------------------------------------------------------------------------------------
// Bullet impacts (damage/impactFinish.ts): the damage class of a district finish key ('surface-…')

/** Damage class name of a 'surface-…' finish key (null: not one of LOOK's keys). Pure string rules mirroring archMaterials.ts. */
export function surfaceImpactClass(key: string): DamageClass | null {
  if (!key.startsWith('surface-')) return null;
  const k = key.slice('surface-'.length);
  if (/^(tent-floor|boards|sleeper)/.test(k)) return 'wood';
  if (/^(road|lot|yard|check|patch|kerb|gutter|cordon|debris|roof|coping|walk|verge|pothole|paint|plaza|scorch|rubble|crack|oil|facade-(concrete|stone|brick))/.test(k)) return 'concrete';
  if (/^(facade-metal|shutter|barricade)/.test(k)) return 'sheetMetal';
  if (/^(iron|steel|rail|trim)/.test(k)) return 'steel';
  if (/^(facade-stucco|in-wall)/.test(k)) return 'plaster';
  if (/^(facade-curtain|glass)/.test(k)) return 'glass';
  if (/^(facade-canvas|canvas)/.test(k)) return 'fabric';
  const f = /^in-floor-[a-z]+-([a-z]+)/.exec(k);
  if (f) return ({carpet: 'fabric', vinyl: 'plastic', tile: 'tile', stone: 'terrazzo', concrete: 'concrete', wood: 'wood'} as Record<string, DamageClass>)[f[1]] ?? null;
  const c = /^in-ceil-([a-z]+)/.exec(k);
  if (c) return c[1] === 'raw' ? 'concrete' : 'plaster';
  return null;
}
