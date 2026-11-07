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

export const SKYWAYS_LAYOUT_LANE = 'skyways.layout';
/** 1 = GAME76's layout (the first release + the layout-variety pass); 2 = the destinations pass (GAME77); 3 = the rework. */
export const SKYWAYS_LAYOUT_VERSION = 3;
/** The newest version the frozen GAME77 generator (gen/skyways/legacy77/) serves. */
export const SKYWAYS_LEGACY77_MAX = 2;

/** The layout version a station regenerates with, from its section memory (undefined = never touched). */
export function skywaysLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[SKYWAYS_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= SKYWAYS_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : SKYWAYS_LAYOUT_VERSION;
}
