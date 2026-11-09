// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): the Survivor Market's LAYOUT VERSION policy (save compatibility). Pure.
// The Skyways rule (gen/skyways/layoutVersion.ts skywaysLayoutVersionFor), for the market:
//  - version 1 = the first market (PR #69: one salvaged shed, a stall row, a housing deck; gen/market/{frame,carve,dress,spots}.ts,
//    never edited);
//  - version 2 = the dense container settlement (gen/market/v2/: alleys, stacked container housing, catwalks, rooftops, real shops);
//  - version 3 (task studio-market-bar-20261108-225231-01, lane BAR) = version 2's settlement plus the upper-level bar over the yard
//    (gen/market/v3/; its bartender a seventh stall) — a recorded version 2 stays version 2 (no bar), byte for byte;
//  - a station's section memory records the version it was first built with (lane `market.layout` = {v}); a memory with visits but no
//    record was entered under the first market's build -> version 1, forever (its geometry, area ids, stalls and stock never reroll);
//  - a station never entered (or a new campaign) -> the current version, recorded when it is first built.
// The runtime systems (trade, currency, displays, people, hostility) read layout.market and work on both versions.

export const MARKET_LAYOUT_LANE = 'market.layout';
/** 1 = the first market (one salvaged shed); 2 = the dense container settlement (task studio-market-rework-20261108-074144-01); 3 = the
 *  settlement with the upper-level bar (task studio-market-bar-20261108-225231-01). */
export const MARKET_LAYOUT_VERSION = 3;

/** The layout version a market station regenerates with, from its section memory (undefined = never touched). */
export function marketLayoutVersionFor(mem: {visits: number; lanes: Record<string, unknown>} | undefined): number {
  const rec = mem?.lanes[MARKET_LAYOUT_LANE] as {v?: unknown} | undefined;
  if (rec && typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v >= 1 && rec.v <= MARKET_LAYOUT_VERSION) return rec.v;
  return mem && mem.visits > 0 ? 1 : MARKET_LAYOUT_VERSION;
}
