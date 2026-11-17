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

/** Wall zones (bottom to top), ceiling / floor and the kit's relief finishes ('base': the proud granite base, in the plinth's finish). */
export type ArchZone = 'plinth' | 'dado' | 'field' | 'band' | 'upper' | 'ceil' | 'floor' | 'trim' | 'struct' | 'base';
export interface FinishScheme {
  plinth: ZoneFinish; dado: ZoneFinish; field: ZoneFinish; band: ZoneFinish | null; upper: ZoneFinish;
  ceil: ZoneFinish; floor: ZoneFinish;
  /** Mouldings: dado cap, band fillets, cornice, door reveals. */
  trim: ZoneFinish;
  /** Structure: beams, coffer ribs, jack-arch / barrel vaults, pilasters. */
  struct: ZoneFinish;
  /** The signature halls (grand ticket / waiting / interchange halls, gate galleries): their own field / upper / ceiling / floor. */
  hall: {field: ZoneFinish; upper: ZoneFinish; ceil: ZoneFinish; floor: ZoneFinish; struct: ZoneFinish};
  /** The cavern family: painted rock walls (above the plinth) and roof. */
  rock?: {wall: ZoneFinish; ceil: ZoneFinish};
}

/** Wall zone heights above the face's floor (m). */
export const ZONES = {plinth: 0.25, dado: 1.15, band0: 2.75, band1: 3.05} as const;
/** The band is drawn only on walls at least this tall above the floor (else the field runs to the top). */
export const BAND_MIN_WALL = 3.45;

const W: readonly [number, number, number] = [1, 1, 1];
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

const STONE_HALL = (floor: ArchTex): FinishScheme['hall'] => ({field: z('stoneLimestone'), upper: z('stoneLimestone'), ceil: z('ceilingPlaster', warm()), floor: z(floor), struct: z('ceilingPlaster', warm())});

const SCHEMES: Readonly<Record<string, FinishScheme>> = {
  // cream running-bond tile over an oxblood dado and band; plaster jack arches; terrazzo
  heritage: {plinth: z('plinthGranite'), dado: z('bandOxblood'), field: z('tileCream'), band: z('bandOxblood'), upper: z('tileCream'),
    ceil: z('ceilingPlaster', warm()), floor: z('floorTerrazzo'), trim: z('stoneLimestone'), struct: z('ceilingPlaster', warm()), hall: STONE_HALL('floorTerrazzo')},
  // pale blue square tile, navy dado and band, white large-format upper wall; granite floors
  civic: {plinth: z('plinthGranite'), dado: z('bandNavy'), field: z('tileBlueSquare'), band: z('bandNavy'), upper: z('tileWhiteLarge'),
    ceil: z('ceilingPlaster', W), floor: z('floorGranite'), trim: z('stoneLimestone', [0.96, 0.97, 1]), struct: z('ceilingPlaster', W), hall: STONE_HALL('floorGranite')},
  // sage glazed brick over a bottle-green dado
  municipal: {plinth: z('plinthGranite'), dado: z('bandBottle'), field: z('tileGreenBrick'), band: z('bandBottle'), upper: z('tileCream', [0.96, 1, 0.94]),
    ceil: z('ceilingPlaster', warm()), floor: z('floorTerrazzo'), trim: z('stoneLimestone'), struct: z('ceilingPlaster', warm()), hall: STONE_HALL('floorTerrazzo')},
  // terracotta dado, warm cream field, ochre band
  terracotta: {plinth: z('plinthGranite'), dado: z('tileTerracotta'), field: z('tileCream', warm(0.98)), band: z('bandOchre'), upper: z('tileCream', warm(0.98)),
    ceil: z('ceilingPlaster', warm()), floor: z('floorTerrazzo'), trim: z('stoneLimestone', warm()), struct: z('ceilingPlaster', warm()), hall: STONE_HALL('floorTerrazzo')},
  // white large-format tile, signal-red band, enamel upper panels under a slatted metal ceiling
  moderne: {plinth: z('plinthGranite'), dado: z('tileWhiteLarge'), field: z('tileWhiteLarge'), band: z('bandSignal'), upper: z('enamelPanel'),
    ceil: z('metalSlatCeiling'), floor: z('floorGranite'), trim: z('enamelPanel'), struct: z('enamelPanel'),
    hall: {field: z('enamelPanel'), upper: z('enamelPanel'), ceil: z('metalSlatCeiling'), floor: z('floorGranite'), struct: z('enamelPanel')}},
  // precast concrete panels (not the Reactor's rusted pit concrete), an orange tile band, concrete coffers
  brutalist: {plinth: z('plinthGranite'), dado: z('concretePrecast'), field: z('concretePrecast'), band: z('bandOrange'), upper: z('concretePrecast'),
    ceil: z('concretePrecast', [0.92, 0.92, 0.92]), floor: z('floorGranite'), trim: z('concretePrecast'), struct: z('concretePrecast'),
    hall: {field: z('concretePrecast'), upper: z('concretePrecast'), ceil: z('concretePrecast', [0.92, 0.92, 0.92]), floor: z('floorGranite'), struct: z('concretePrecast')}},
};

/** The painted-rock scheme of a cavern theme (the theme's paint over the off-white painted shotcrete set). */
function cavernScheme(wallTint: number): FinishScheme {
  const wall = z('rockPainted', paintTint(wallTint, 0.92)), ceil = z('rockPainted', paintTint(wallTint, 0.78));
  return {plinth: z('plinthGranite'), dado: wall, field: wall, band: null, upper: wall, ceil, floor: z('floorGranite'), trim: z('plinthGranite'), struct: wall,
    hall: {field: wall, upper: wall, ceil, floor: z('floorGranite'), struct: wall}, rock: {wall, ceil}};
}

/** The finish scheme of a station (null: no identity, a version-1 station drawn exactly as before). */
export function finishSchemeOf(layout: Pick<StationLayout, 'identity'>): FinishScheme | null {
  const id = layout.identity;
  if (!id) return null;
  if (id.walls === 'rock') return cavernScheme(id.wallTint);
  return SCHEMES[id.theme] ?? (id.walls === 'concrete' ? SCHEMES.brutalist : SCHEMES.civic);
}

/** Every set a scheme draws (the section preload's list). */
export function schemeTextures(s: FinishScheme): ArchTex[] {
  const all = [s.plinth, s.dado, s.field, s.band, s.upper, s.ceil, s.floor, s.trim, s.struct, s.hall.field, s.hall.upper, s.hall.ceil, s.hall.floor, s.hall.struct, s.rock?.wall, s.rock?.ceil];
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
