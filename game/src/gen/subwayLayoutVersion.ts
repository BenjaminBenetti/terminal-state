// Task studio-subway-station-variety-20261117-043926-01: the Subway station's LAYOUT VERSION policy (save compatibility). Pure. The Mall /
// Skyways / Survivor Market / Bunker rule (gen/mall/layoutVersion.ts, gen/skyways/layoutVersion.ts, gen/market/layoutVersion.ts):
//  - version 1 = every Subway station built before this task: the six macro archetypes (gen/archetypes.ts) picked by pickArchetype. Its
//    generator path is never edited: a recorded version 1 regenerates byte for byte (its enemies, kills, loot, ids / uids, resources,
//    train state and claimed content refer to it);
//  - version 2 = the PLAN FAMILIES (gen/stationPlans.ts): the classic archetypes stay eligible (a seed that rolls 'classic' builds EXACTLY
//    its version-1 station) next to the new families, each with its own overall plan and a station-wide visual identity;
//  - a station's section memory records the version it was first built with (lane `subway.layout` = {v}, stamped by Game.generateSection on
//    the first build of a Subway 'main' section); a memory with visits but no record was entered under an older build -> version 1, forever;
//  - a station never entered (or a new campaign) -> the current version, recorded when it is first built.
// Like SectionGenContext.rosterVersion / surfaceVersion, an ABSENT version on a direct generator call (generateStation / LEVELS.subway.generate
// without ctx.layoutVersion) is version 1: every pinned Subway fingerprint and census was taken with it, and the game always passes the
// station's version explicitly (Game.sectionGenInputs).

export const SUBWAY_LAYOUT_LANE = 'subway.layout';
/** 1 = the six classic archetypes only (every Subway station before this task); 2 = the plan families + station identities (this task). */
export const SUBWAY_LAYOUT_VERSION = 2;
/** The first version with the plan-family roll. */
export const SUBWAY_PLANS_MIN_VERSION = 2;

/** The layout version a Subway station regenerates with, from its section memory (undefined = never touched). */
export function subwayLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[SUBWAY_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= SUBWAY_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : SUBWAY_LAYOUT_VERSION;
}
