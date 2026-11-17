// Task studio-mall-layout-variety-20261117-005520-01: the Mall's LAYOUT VERSION policy (save compatibility). Pure. The Skyways / Survivor
// Market / Bunker rule (gen/skyways/layoutVersion.ts, gen/market/layoutVersion.ts, gen/bunker/layoutVersion.ts):
//  - version 1 = every Mall built before this task: the atrium family (gen/mall/frame.ts MALL_VARIANTS: one irregular atrium pit over the
//    station with corridor wings / loops / second courts off it). Its generator path is never edited: a recorded version 1 regenerates
//    byte for byte (its residents, kills, loot, stock, ids / uids and resources refer to it);
//  - version 2 = the plan families (gen/mall/plans.ts): the atrium family stays eligible (a seed that rolls it builds EXACTLY its version-1
//    core) next to the new families, plus the parking-lot window walls (gen/mall/windows.ts, an append-only post-pass);
//  - a station's section memory records the version it was first built with (lane `mall.layout` = {v}, stamped by Game.generateSection
//    on the first build); a memory with visits but no record was entered under an older build -> version 1, forever;
//  - a station never entered (or a new campaign) -> the current version, recorded when it is first built.

export const MALL_LAYOUT_LANE = 'mall.layout';
/** 1 = the atrium family only (every Mall before this task); 2 = the plan families + parking-lot window walls (this task). */
export const MALL_LAYOUT_VERSION = 2;
/** The first version with the plan-family roll and the window walls. */
export const MALL_PLANS_MIN_VERSION = 2;

/** The layout version a Mall station regenerates with, from its section memory (undefined = never touched). */
export function mallLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[MALL_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= MALL_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : MALL_LAYOUT_VERSION;
}
