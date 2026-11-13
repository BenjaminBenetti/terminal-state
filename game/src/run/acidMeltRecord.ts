// Task studio-refinement-batch-20261113-035659-01 (lane MELT; user: "Acid Scrapper Grenade ... Melt world props ... each destroyed prop
// yields EXACTLY 1 scrap_metal OR 1 electrical_parts, once"): the section-memory record of the GENERATED layout props acid dissolved in
// a station (world/acidMelt.ts is the live system). Pure (no three.js / DOM).
//
// ACID_MELT_LANE = {v: 1, gone: [{i, kind}]} — the generated layout index (the placement's identity, as world/trainPropCargo.ts keys it:
// its index in layout.props before anything is appended) and its kind (a revisit whose layout no longer has that kind there ignores the
// row). Re-applied at every section build: a melted prop stays gone (hidden, no collider / holder / stock), its spill and its one salvage
// are never produced again — they lie in the station as ordinary pickups (the section's pickup memory). Carried props, crafted equipment
// and fuel carts keep their own records (their systems drop a destroyed one: world/trainPropCargo.ts consume, TrainEquipmentSystem /
// FuelCarts destroy). An old save without the lane loads with nothing melted; a malformed record fails save validation (save/validate.ts
// lanes()) and never produces anything.

import {PROP_KIND_RE, type GonePropJSON} from './trainCargo';

export const ACID_MELT_LANE = 'acid.melted';

/** Input-safety bounds of the record (save/validate.ts SAVE_LIMITS.meltedProps reads `gone`): never a truncation point. */
export const ACID_MELT_LIMITS = {gone: 4096, index: 999999} as const;

export interface AcidMeltedJSON { v: 1; gone: GonePropJSON[] }

/** Why a station's melted-prop record is malformed (null = fine). */
export function acidMeltedProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'the melted prop record must be an object';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'gone') return `unexpected melted prop field '${k}'`;
  if (o.v !== 1) return 'unsupported melted prop record version';
  if (!Array.isArray(o.gone) || o.gone.length > ACID_MELT_LIMITS.gone) return `a station lists at most ${ACID_MELT_LIMITS.gone} melted props`;
  const seen = new Set<number>();
  for (const g of o.gone) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return 'a melted prop must be an object';
    const r = g as Record<string, unknown>;
    for (const k of Object.keys(r)) if (k !== 'i' && k !== 'kind') return `unexpected melted prop field '${k}'`;
    if (typeof r.i !== 'number' || !Number.isInteger(r.i) || r.i < 0 || r.i > ACID_MELT_LIMITS.index) return 'a melted prop needs its layout index';
    if (seen.has(r.i)) return `melted prop ${r.i} is listed twice`;
    seen.add(r.i);
    if (typeof r.kind !== 'string' || !PROP_KIND_RE.test(r.kind)) return 'a melted prop needs its kind';
  }
  return null;
}

/** A stored record as data (a copy; anything malformed reads as nothing melted — the save validator refuses such a file anyway). */
export function acidMeltedOf(v: unknown): AcidMeltedJSON {
  if (acidMeltedProblem(v) !== null) return {v: 1, gone: []};
  return {v: 1, gone: (v as AcidMeltedJSON).gone.map(g => ({i: g.i, kind: g.kind}))};
}
