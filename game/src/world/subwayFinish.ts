// Task studio-subway-architecture-materials-rework-20261117-072826-01: THE FINISH SCHEMES of a version-2+ Subway station (pure data, no
// three.js).
//
// User: "station looks poor with bad textures … giant repetitious / stretched stained surfaces and ceiling treatment are not a believable
// station. Build a cohesive handmade modular architectural kit with proper wall / base / upper treatments". A real tiled station wall is
// ZONED (research/REFERENCES.md: dark base 0-0.25 m, darker dado to ~1.1 m, light field to ~2.7 m, an accent band carrying the name
// tablets, then the upper wall and a cornice), its ceiling is a plaster / slat / concrete soffit and its halls step up to stone. Each
// station theme (gen/stationPlans.ts STATION_THEMES, the identity's existing roll: nothing new is drawn from any generator stream) maps
// every zone to one of the Codex-generated Subway architecture sets (assets/subwayArchTextures.generated.ts) with a linear tint.
//
// The renderer reads it twice: world/subwayArch.ts splits the public wall faces into the zones and keys every surface by
// `subway-<class>-<zone>` (the class prefix is what damage/impactFinish.ts and world/wallDetailPlan.ts read), world/subwayKit.ts draws the
// relief (caps, cornices, pilasters, beams, coffers, vaults) in the scheme's trim / structure finishes. Render-only: an existing saved
// version-2 station keeps its layout and simply looks like this on reload.

import type {Area, StationLayout} from '../gen/stationTypes';
import {SUBWAY_ARCH_TEXTURES} from '../assets/subwayArchTextures.generated';

/** The Codex-generated Subway architecture sets (keys of assets/subwayArchTextures.generated.ts SUBWAY_ARCH_TEXTURES). */
export type ArchTex =
  | 'tileCream' | 'tileBlueSquare' | 'tileGreenBrick' | 'tileTerracotta' | 'tileWhiteLarge'
  | 'bandOxblood' | 'bandNavy' | 'bandBottle' | 'bandOchre' | 'bandSignal' | 'bandOrange'
  | 'plinthGranite' | 'stoneLimestone' | 'concretePrecast' | 'enamelPanel' | 'metalSlatCeiling'
  | 'floorTerrazzo' | 'floorGranite' | 'ceilingPlaster' | 'rockPainted';

/** The damage / treatment class of a set (the `<class>` of its keys). */
export type ArchClass = 'tile' | 'stone' | 'concrete' | 'plaster' | 'metal' | 'terrazzo' | 'rock';
export const ARCH_CLASS: Readonly<Record<ArchTex, ArchClass>> = {
  tileCream: 'tile', tileBlueSquare: 'tile', tileGreenBrick: 'tile', tileTerracotta: 'tile', tileWhiteLarge: 'tile',
  bandOxblood: 'tile', bandNavy: 'tile', bandBottle: 'tile', bandOchre: 'tile', bandSignal: 'tile', bandOrange: 'tile',
  plinthGranite: 'stone', stoneLimestone: 'stone', concretePrecast: 'concrete', enamelPanel: 'tile', metalSlatCeiling: 'metal',
  floorTerrazzo: 'terrazzo', floorGranite: 'stone', ceilingPlaster: 'plaster', rockPainted: 'rock',
};

/** A zone's finish: a set and a LINEAR multiplier on its colour map (the set's own colour when absent). */
export interface ZoneFinish { tex: ArchTex; tint?: readonly [number, number, number] }

/**
 * Wall zones (bottom to top), ceiling / floor and the kit's relief finishes ('base': the proud granite base, in the plinth's finish;
 * 'pier': pilasters / clerestory piers / the arcade beam / fins; 'accent': the crisp contrasting trim — string courses, fascias, clock
 * bezels, tablet surrounds, portal frames; 'panel': backing / service panels against a wall).
 */
export type ArchZone = 'plinth' | 'dado' | 'field' | 'band' | 'upper' | 'ceil' | 'floor' | 'trim' | 'struct' | 'base' | 'pier' | 'accent' | 'panel';
/** The zones a signature hall draws in its own finishes (`-hall` keys). */
export type HallZone = 'field' | 'upper' | 'ceil' | 'floor' | 'struct' | 'pier';
export const HALL_ZONES: ReadonlySet<ArchZone> = new Set<HallZone>(['field', 'upper', 'ceil', 'floor', 'struct', 'pier']);
/** How the kit shapes a scheme's structure: thin applied pilasters, or deep board-formed fins (with deeper coffer ribs). */
export type PierForm = 'pilaster' | 'fin';
export interface FinishScheme {
  plinth: ZoneFinish; dado: ZoneFinish; field: ZoneFinish; band: ZoneFinish | null; upper: ZoneFinish;
  ceil: ZoneFinish; floor: ZoneFinish;
  /** Mouldings: dado cap, band fillets, cornice, door reveals. */
  trim: ZoneFinish;
  /** Structure: beams, coffer ribs, jack-arch / barrel vaults. */
  struct: ZoneFinish;
  /**
   * Task studio-subway-rework-m2-finishing-20261117-111246-01 (user: civic and heritage halls "read almost identically warm-brown"): the
   * scheme's own structural language — pilasters, clerestory piers, the arcade beam (oxblood faience, navy glaze, board-formed fins...).
   */
  pier: ZoneFinish;
  /** The crisp contrasting trim: string courses, fascias, clock bezels, tablet surrounds, portal frames. */
  accent: ZoneFinish;
  /** Backing / service panels against a wall (the cavern's; absent: none drawn). */
  panel?: ZoneFinish;
  /** The kit's structural form (default 'pilaster'). */
  pierForm?: PierForm;
  /**
   * The station columns' paint (world/stationColumns.ts riveted H-columns; world/subwayArch.ts columnPaintFor): the GRADED paint colour
   * (linear) the scheme wants the existing column paint to land at (absent: the default slate-teal).
   */
  columnPaint?: readonly [number, number, number];
  /** The signature halls (grand ticket / waiting / interchange halls, gate galleries): their own field / upper / ceiling / floor / piers. */
  hall: {field: ZoneFinish; upper: ZoneFinish; ceil: ZoneFinish; floor: ZoneFinish; struct: ZoneFinish; pier: ZoneFinish};
  /**
   * The cavern family: painted rock walls (above the wainscot) and roof. `bounceChroma` (absent = 1): the paint's chroma as the ENHANCED
   * bounce takes it (its light-bake albedo, CAVERN_BOUNCE_CHROMA); the drawn paint is the tint either way.
   */
  rock?: {wall: ZoneFinish; ceil: ZoneFinish; bounceChroma?: number};
}

/** Wall zone heights above the face's floor (m). */
export const ZONES = {plinth: 0.25, dado: 1.15, band0: 2.75, band1: 3.05} as const;
/** The band is drawn only on walls at least this tall above the floor (else the field runs to the top). */
export const BAND_MIN_WALL = 3.45;

const warm = (k = 1): readonly [number, number, number] => [k, k * 0.975, k * 0.93];
const z = (tex: ArchTex, tint?: readonly [number, number, number]): ZoneFinish => (tint ? {tex, tint} : {tex});

/** Linear (0..1) of an sRGB 0xRRGGBB colour. */
function linear(hex: number): [number, number, number] {
  const c = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}
/** A paint colour as a luminance-normalised multiplier of an off-white set (its brightness kept, its hue set). */
export function paintTint(hex: number, value = 1): [number, number, number] {
  const [r, g, b] = linear(hex), lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = value / Math.max(1e-3, lum);
  const top = Math.max(r, g, b) * k, s = top > 1.25 ? 1.25 / top : 1;
  return [r * k * s, g * k * s, b * k * s];
}

/**
 * The linear tint that takes a set's measured mean albedo to a NEUTRAL grey of linear value `value` (the set's own pattern and relief,
 * its colour cast removed: a civic neutral-white plaster, a cavern's grey precast / granite against the painted rock).
 */
export function greyTint(tex: ArchTex, value: number): [number, number, number] {
  const m = SUBWAY_ARCH_TEXTURES[tex].mean;
  return [0, 1, 2].map(i => Math.round((value / m[i]) * 1000) / 1000) as [number, number, number];
}

/**
 * A dark glazed set (oxblood / navy / bottle) on a pier: lifted in value only (its hue kept), so a 0.6 m faience pilaster under the dim hall
 * light reads as its colour rather than a black slot (the dado / band keep the set's own depth).
 */
const GLAZE_LIFT: readonly [number, number, number] = [1.4, 1.4, 1.4];
const PLASTER_WARM = z('ceilingPlaster', warm());
/** A civic hall's neutral white plaster (coffers, beams): the warm plaster set without its cast. */
const PLASTER_NEUTRAL = z('ceilingPlaster', greyTint('ceilingPlaster', 0.5));

// Task studio-subway-rework-m2-finishing-20261117-111246-01 (user: "Civic and heritage read almost identically warm-brown from the
// submitted play-distance views. Make their approved local finish / trim / column / furnishing language legible; brutalist should have
// its own structural character"): every scheme's grand hall now speaks its own language — before, heritage / civic / municipal /
// terracotta all drew the SAME limestone field + upper and warm plaster coffers (only the thin dado / band differed):
//  - heritage: limestone ashlar field, a CREAM GLAZED BRICK clerestory, OXBLOOD faience pilasters / piers / arcade beam and accents,
//    warm plaster coffers, oxblood-maroon columns;
//  - civic: pale blue square tile field, WHITE large-format clerestory, NAVY glazed pilasters / piers and accents, NEUTRAL white plaster
//    coffers, navy columns;
//  - municipal: sage glazed brick field, green-cream upper, BOTTLE-green piers and accents, bottle-green columns;
//  - terracotta: an all-limestone hall with TERRACOTTA faience piers, OCHRE accents, bronze columns;
//  - moderne: enamel panels, FLUTED metal piers (the slat set read vertically), SIGNAL-red accents and columns;
//  - brutalist: board-formed precast throughout, deep structural FINS instead of applied pilasters (and deeper coffer ribs: the kit),
//    a signal-ORANGE accent string course, concrete-grey columns.
// Linear tints only (the accepted Codex sets; no new texture, no global recolour).
const SCHEMES: Readonly<Record<string, FinishScheme>> = {
  // cream running-bond tile over an oxblood dado and band; plaster jack arches; terrazzo
  heritage: {plinth: z('plinthGranite'), dado: z('bandOxblood'), field: z('tileCream'), band: z('bandOxblood'), upper: z('tileCream'),
    ceil: PLASTER_WARM, floor: z('floorTerrazzo'), trim: z('stoneLimestone'), struct: PLASTER_WARM,
    pier: z('bandOxblood', GLAZE_LIFT), accent: z('bandOxblood'), columnPaint: [0.2, 0.075, 0.065],
    hall: {field: z('stoneLimestone'), upper: z('tileCream'), ceil: PLASTER_WARM, floor: z('floorTerrazzo'), struct: PLASTER_WARM, pier: z('bandOxblood', GLAZE_LIFT)}},
  // pale blue square tile, navy dado and band, white large-format upper wall; granite floors
  civic: {plinth: z('plinthGranite'), dado: z('bandNavy'), field: z('tileBlueSquare'), band: z('bandNavy'), upper: z('tileWhiteLarge'),
    ceil: PLASTER_NEUTRAL, floor: z('floorGranite'), trim: z('stoneLimestone', [0.96, 0.97, 1]), struct: PLASTER_NEUTRAL,
    pier: z('bandNavy', GLAZE_LIFT), accent: z('bandNavy'), columnPaint: [0.06, 0.085, 0.19],
    hall: {field: z('tileBlueSquare'), upper: z('tileWhiteLarge'), ceil: PLASTER_NEUTRAL, floor: z('floorGranite'), struct: PLASTER_NEUTRAL, pier: z('bandNavy', GLAZE_LIFT)}},
  // sage glazed brick over a bottle-green dado
  municipal: {plinth: z('plinthGranite'), dado: z('bandBottle'), field: z('tileGreenBrick'), band: z('bandBottle'), upper: z('tileCream', [0.96, 1, 0.94]),
    ceil: PLASTER_WARM, floor: z('floorTerrazzo'), trim: z('stoneLimestone'), struct: PLASTER_WARM,
    pier: z('bandBottle', GLAZE_LIFT), accent: z('bandBottle'), columnPaint: [0.06, 0.14, 0.075],
    hall: {field: z('tileGreenBrick'), upper: z('tileCream', [0.96, 1, 0.94]), ceil: PLASTER_WARM, floor: z('floorTerrazzo'), struct: PLASTER_WARM, pier: z('bandBottle', GLAZE_LIFT)}},
  // terracotta dado, warm cream field, ochre band
  terracotta: {plinth: z('plinthGranite'), dado: z('tileTerracotta'), field: z('tileCream', warm(0.98)), band: z('bandOchre'), upper: z('tileCream', warm(0.98)),
    ceil: PLASTER_WARM, floor: z('floorTerrazzo'), trim: z('stoneLimestone', warm()), struct: PLASTER_WARM,
    pier: z('tileTerracotta'), accent: z('bandOchre'), columnPaint: [0.17, 0.11, 0.065],
    hall: {field: z('stoneLimestone'), upper: z('stoneLimestone'), ceil: PLASTER_WARM, floor: z('floorTerrazzo'), struct: PLASTER_WARM, pier: z('tileTerracotta')}},
  // white large-format tile, signal-red band, enamel upper panels under a slatted metal ceiling
  moderne: {plinth: z('plinthGranite'), dado: z('tileWhiteLarge'), field: z('tileWhiteLarge'), band: z('bandSignal'), upper: z('enamelPanel'),
    ceil: z('metalSlatCeiling'), floor: z('floorGranite'), trim: z('enamelPanel'), struct: z('enamelPanel'),
    pier: z('metalSlatCeiling'), accent: z('bandSignal'), columnPaint: [0.24, 0.06, 0.05],
    hall: {field: z('enamelPanel'), upper: z('enamelPanel'), ceil: z('metalSlatCeiling'), floor: z('floorGranite'), struct: z('enamelPanel'), pier: z('metalSlatCeiling')}},
  // precast concrete panels (not the Reactor's rusted pit concrete), an orange tile band, concrete coffers, deep fins
  brutalist: {plinth: z('plinthGranite'), dado: z('concretePrecast'), field: z('concretePrecast'), band: z('bandOrange'), upper: z('concretePrecast'),
    ceil: z('concretePrecast', [0.92, 0.92, 0.92]), floor: z('floorGranite'), trim: z('concretePrecast'), struct: z('concretePrecast'),
    pier: z('concretePrecast', [0.8, 0.8, 0.8]), accent: z('bandOrange'), pierForm: 'fin', columnPaint: [0.2, 0.2, 0.195],
    hall: {field: z('concretePrecast'), upper: z('concretePrecast', [1.08, 1.08, 1.08]), ceil: z('concretePrecast', [0.92, 0.92, 0.92]), floor: z('floorGranite'),
      struct: z('concretePrecast'), pier: z('concretePrecast', [0.8, 0.8, 0.8])}},
};

/**
 * The chroma (0..1) of a cavern paint as the enhanced bounce takes it (absent: 1, the paint as drawn). User (the green cavern "reads very
 * green and strange"): its painted rock is nearly every surface a point in the station sees, so the gathered light (three bounces through
 * the paint, GATHER_SATURATION) carries the paint's hue onto everything it lights. The blue / red / bone caverns' bounce stays near the
 * white-light (Planckian) locus — a cooler or warmer white (measured on a green station's upper concourse: neutral granite floor Duv
 * +0.008 / -0.013 / +0.008, Enhanced lighting off +0.007) — but green lies off it: the floor and wainscot were lit Duv +0.031, plainly
 * green light (the paint's value is not the cause: 0.92 -> 0.70 moves it 0.002). At 0.4 the bounce lights them at Duv +0.017 (the
 * stations' own aged tubes are +0.018) and the haze at +0.010 (was +0.015) while the drawn paint, the Off look and every other theme are
 * unchanged. Render-only (no layout field): an existing green cavern bakes this on reload (the albedo bytes are a gather-digest input).
 */
const CAVERN_BOUNCE_CHROMA: Readonly<Record<string, number>> = {cavernGreen: 0.4};

/**
 * The painted-rock scheme of a cavern theme (the theme's paint over the off-white painted shotcrete set). Task
 * studio-subway-rework-m2-finishing-20261117-111246-01 (user: the cavern "remains almost entirely the same red-orange rough surface. Keep
 * its strong identity hue, but use believable neutral stone / plinth / door / service / waiting accents and hierarchy"): the painted rock
 * keeps the walls above the wainscot and the vault; the dado zone is a honed GREY GRANITE wainscot, the mouldings (wainscot cap, the
 * spring-line ledge, the cove troughs, door reveals) and the accents (portal frames) a light NEUTRAL precast, backing / service panels
 * vitreous enamel (world/subwayKitCavern.ts draws the relief).
 */
function cavernScheme(wallTint: number, theme: string): FinishScheme {
  const wall = z('rockPainted', paintTint(wallTint, 0.92)), ceil = z('rockPainted', paintTint(wallTint, 0.78));
  const granite = z('floorGranite', greyTint('floorGranite', 0.5)), precast = z('concretePrecast', greyTint('concretePrecast', 0.62));
  const bounceChroma = Object.hasOwn(CAVERN_BOUNCE_CHROMA, theme) ? CAVERN_BOUNCE_CHROMA[theme] : undefined;
  return {plinth: z('plinthGranite'), dado: granite, field: wall, band: null, upper: wall, ceil, floor: z('floorGranite'), trim: precast, struct: wall,
    pier: granite, accent: precast, panel: z('enamelPanel'),
    hall: {field: wall, upper: wall, ceil, floor: z('floorGranite'), struct: wall, pier: granite}, rock: bounceChroma === undefined ? {wall, ceil} : {wall, ceil, bounceChroma}};
}

/** The finish scheme of a station (null: no identity, a version-1 station drawn exactly as before). */
export function finishSchemeOf(layout: Pick<StationLayout, 'identity'>): FinishScheme | null {
  const id = layout.identity;
  if (!id) return null;
  if (id.walls === 'rock') return cavernScheme(id.wallTint, id.theme);
  return SCHEMES[id.theme] ?? (id.walls === 'concrete' ? SCHEMES.brutalist : SCHEMES.civic);
}

/** Every set a scheme draws (the section preload's list). */
export function schemeTextures(s: FinishScheme): ArchTex[] {
  const all = [s.plinth, s.dado, s.field, s.band, s.upper, s.ceil, s.floor, s.trim, s.struct, s.pier, s.accent, s.panel,
    s.hall.field, s.hall.upper, s.hall.ceil, s.hall.floor, s.hall.struct, s.hall.pier, s.rock?.wall, s.rock?.ceil];
  return [...new Set(all.filter((f): f is ZoneFinish => !!f).map(f => f.tex))].sort();
}

const HALL_ROLES: ReadonlySet<string> = new Set(['grand-ticket-hall', 'waiting-hall', 'interchange-hall', 'gate-gallery']);
/** A signature hall (its own stone / enamel / concrete finishes). */
export const isSignatureHall = (a: Pick<Area, 'role'> | undefined): boolean => !!a?.role && HALL_ROLES.has(a.role);

/** The arch key of a zone finish: `subway-<class>-<zone>` (+ `-hall` for a signature hall's own zone). */
export function zoneKey(f: ZoneFinish, zone: ArchZone, hall = false): string {
  return `subway-${ARCH_CLASS[f.tex]}-${zone}${hall ? '-hall' : ''}`;
}

/** The class of an arch key (null: not a zone key of this scheme). */
export function keyClass(key: string): ArchClass | null {
  const m = /^subway-(tile|stone|concrete|plaster|metal|terrazzo|rock)-/.exec(key);
  return m ? (m[1] as ArchClass) : null;
}
