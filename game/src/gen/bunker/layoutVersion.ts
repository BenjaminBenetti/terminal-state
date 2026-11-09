// Task studio-bunker-level-20261109-072224-01 (lane LEVEL): the Bunker's LAYOUT VERSION policy (save compatibility). Pure. The Skyways /
// Survivor Market rule (gen/skyways/layoutVersion.ts, gen/market/layoutVersion.ts), set up from the Bunker's first release so a later
// generator change can pin what a visited station already is:
//  - version 1 = the first Bunker (gen/bunker/*: the buried station, the vault door, the shelter storeys down to the processing core);
//  - a station's section memory records the version it was first built with (lane `bunker.layout` = {v}, stamped by Game.generateSection
//    on the first build); a memory with visits but no record (impossible from this release on, kept as the safe reading) -> version 1;
//  - a station never entered (or a new campaign) -> the current version, recorded when it is first built.
// A future version 2 bumps BUNKER_LAYOUT_VERSION and dispatches on ctx.layoutVersion in generateBunkerLevel; version 1 stations keep
// regenerating version 1 exactly (their holders / pickups / kills / lanes refer to it).

export const BUNKER_LAYOUT_LANE = 'bunker.layout';
/** 1 = the first Bunker (task studio-bunker-level-20261109-072224-01). */
export const BUNKER_LAYOUT_VERSION = 1;

/** The layout version a Bunker station regenerates with, from its section memory (undefined = never touched). */
export function bunkerLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[BUNKER_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= BUNKER_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : BUNKER_LAYOUT_VERSION;
}
