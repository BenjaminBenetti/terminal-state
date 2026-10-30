// Task gas-mask-roof-feedback-20261030 (item 10): the Office roof's OUTDOOR weight — ONE pure function shared by the roof's green
// scene fog (world/officeAtmosphere.ts, which re-exports these) and the outside-atmosphere exposure (world/gas/system.ts): what
// looks outdoors is what hurts. No three.js / DOM (moved verbatim from officeAtmosphere.ts so the gas system and its Node tests do
// not pull in the render modules).

import type {StationLayout} from '../gen/stationTypes';

/**
 * Scene fog on the roof: FogExp2 density (1/m) — colour = the outdoor murk (EXT_U.haze); `below` / `above` (m) = the blend ramp
 * around the deck height (the eye rising through the ladder hatch).
 */
export const ROOF_FOG = {density: 0.016, below: 0.6, above: 0.9} as const;

/** What the outdoor blend needs of the office roof: the deck height and the tower footprint (world m). */
export interface RoofAir { baseY: number; foot: {x0: number; z0: number; x1: number; z1: number} }

/** The roof of an office layout (null: no office / no roof — the Subway). */
export function roofAirOf(layout: StationLayout): RoofAir | null {
  const o = layout.office, roof = o?.roof;
  return roof && o ? {baseY: roof.baseY, foot: o.exterior} : null;
}

/** Roof blend 0..1 for an eye at (x, y, z): 1 standing on the deck inside the tower footprint, 0 indoors; ramps over the hatch. */
export function roofBlend(x: number, y: number, z: number, roof: RoofAir | null): number {
  if (!roof) return 0;
  const f = roof.foot;
  if (x < f.x0 - 1.5 || x > f.x1 + 1.5 || z < f.z0 - 1.5 || z > f.z1 + 1.5) return 0;
  const t = (y - (roof.baseY - ROOF_FOG.below)) / (ROOF_FOG.below + ROOF_FOG.above);
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}
