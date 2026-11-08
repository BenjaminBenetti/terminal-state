// Task studio-skyways-destinations-20261106-170011-01: the Skyways LAYOUT VERSION policy (save compatibility). Pure.
//
// The destinations pass (version 2: anchor shops, landmark courts, more atriums / arcades / shops) changes what a level seed generates.
// A station a player already ENTERED under an older build keeps regenerating that build's layout (its section memory's holders /
// pickups / kills / lanes refer to it): never a reshuffled room program, revived enemies or reset loot. So:
//  - a station's memory records the version it was first built with (lane `skyways.layout` = {v});
//  - a memory with visits but no record was built by GAME76 (the first Skyways release, version 1) -> version 1 (no destinations);
//  - a station never entered -> the current version, recorded when it is first built.
// Old saved campaigns therefore get the destinations at every Skyways station they have NOT yet entered.
//
// Task studio-skyways-rework-20261107-054512-01 (version 3, the Skyways rework: open atria, glazed bridges, the venue floor, the public
// prize display, map boards, the reworked anchor stores): versions 1 and 2 regenerate through the FROZEN GAME77 generator
// (gen/skyways/legacy77/, fingerprints pinned in tests/skyways-dest-layout-version.test.ts); every station not yet entered — in a new
// OR an existing campaign — gets version 3. Shared runtime fixes (stairs, materials, signs, the clock) reach every version.
//
// Task studio-skywalk-variety-20261107-231448-01 (version 4, the building PROGRAMMES: each building its own plan / vertical sequence /
// openness, ramen as an ordinary random tenant, store merchandise loose, convention snacks): version 3 regenerates through the FROZEN
// version-3 core (gen/skyways/legacy80/, fingerprints pinned); every station not yet entered gets version 4. The shared dressers learn
// which version they dress from skywaysGenVersion(layout) (set by each generator before dressing; layout data unchanged).
//
// Task studio-skywalk-encounters-20261108-074144-01 (version 5, the ENCOUNTERS pass: the Siren at the Mall's odds, a roaming horde,
// the convention's cosplay zombies, a few Mall store families in the storefront allocation): version 4 regenerates through the SAME
// live generator with every version-5 change gated on `skywaysGenVersion(layout) >= SKYWAYS_ENCOUNTERS_MIN_VERSION` (or the context's
// layout version) and the frozen version-4 spawn profile (ai/spawnTables.ts SKYWAYS_V4_SPAWN_PROFILE) — fingerprints pinned in
// tests/skyways-dest-layout-version.test.ts (GAME84: areas, props, purposes, every enemy record in full, hordes); every station not yet
// entered gets version 5. A station entered at 1-4 keeps its enemies, kills, loot and layout exactly.

export const SKYWAYS_LAYOUT_LANE = 'skyways.layout';
/**
 * 1 = GAME76's layout (the first release + the layout-variety pass); 2 = the destinations pass (GAME77); 3 = the Skyways rework (task
 * studio-skyways-rework-20261107-054512: the ten major stores, gen/skyways/stores/, with their outward storefronts, Skyways-scoped loot
 * purposes and dressers — and the parent's architecture); 4 = the building programmes (task studio-skywalk-variety-20261107-231448-01);
 * 5 = the encounters pass (task studio-skywalk-encounters-20261108-074144-01). Stations entered at 1 / 2 / 3 / 4 keep regenerating exactly
 * that layout.
 */
export const SKYWAYS_LAYOUT_VERSION = 5;
/** The first version of the encounters pass (Siren / horde / cosplay zombies / Mall store families): gate every change on it. */
export const SKYWAYS_ENCOUNTERS_MIN_VERSION = 5;
/** The newest version the frozen GAME77 generator (gen/skyways/legacy77/) serves. */
export const SKYWAYS_LEGACY77_MAX = 2;
/** The version the frozen version-3 core (gen/skyways/legacy80/) serves. */
export const SKYWAYS_LEGACY80 = 3;

/** (version 4) The version a Skyways layout object was generated at, for the shared dressers (not part of the layout's data). */
const GEN_VERSION = new WeakMap<object, number>();
export function markSkywaysGenVersion(layout: object, v: number): void { GEN_VERSION.set(layout, v); }
/** The version a layout was generated at by a Skyways generator that marks it (versions 3+); 0 for anything else. Gate every version-4
 *  generation change on `skywaysGenVersion(layout) >= 4` so the frozen generators' layouts stay exactly as pinned. */
export function skywaysGenVersion(layout: object): number { return GEN_VERSION.get(layout) ?? 0; }

/** The layout version a station regenerates with, from its section memory (undefined = never touched). */
export function skywaysLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[SKYWAYS_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= SKYWAYS_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : SKYWAYS_LAYOUT_VERSION;
}
