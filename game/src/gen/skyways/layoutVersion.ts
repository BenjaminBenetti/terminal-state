// Task studio-skyways-destinations-20261106-170011-01: the Skyways LAYOUT VERSION policy (save compatibility). Pure.
//
// The destinations pass (version 2: anchor shops, landmark courts, more atriums / arcades / shops) changes what a level seed generates.
// A station a player already ENTERED under an older build keeps regenerating that build's layout (its section memory's holders /
// pickups / kills / lanes refer to it): never a reshuffled room program, revived enemies or reset loot. So:
//  - a station's memory records the version it was first built with (lane `skyways.layout` = {v});
//  - a memory with visits but no record was built by GAME76 (the first Skyways release, version 1) -> version 1 (no destinations);
//  - a station never entered -> the current version, recorded when it is first built.
// Old saved campaigns therefore get the destinations at every Skyways station they have NOT yet entered.

export const SKYWAYS_LAYOUT_LANE = 'skyways.layout';
/**
 * 1 = GAME76's layout (the first release + the layout-variety pass); 2 = the destinations pass (GAME77); 3 = the Skyways rework (task
 * studio-skyways-rework-20261107-054512: the ten major stores, gen/skyways/stores/, with their outward storefronts, Skyways-scoped loot
 * purposes and dressers — and the parent's architecture). Stations entered at 1 / 2 keep regenerating exactly that layout.
 */
export const SKYWAYS_LAYOUT_VERSION = 3;

/** The layout version a station regenerates with, from its section memory (undefined = never touched). */
export function skywaysLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[SKYWAYS_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= SKYWAYS_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : SKYWAYS_LAYOUT_VERSION;
}
