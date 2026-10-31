// Task track3-eaton-centre-20261031: the Track2 seam of The Eaton's Center — INTEGRATED (lane INTEG, Track2 PR #20). The real
// interface is gen/trackExt (docs/track-extensions.md); this module only holds the mall's own call parameters and re-exports the one
// predicate the mall code uses.
//
//  - Declaration: levels/registry.ts LEVELS.mall.trackExtensions = trackExtConfig('mall') (TRACK_EXT_MALL: the GEN-2 planner, no core
//    reserve). Coverage: tests/track-ext-coverage.test.ts.
//  - Plan: gen/mall/index.ts calls extendTracks(k, rng.fork('track-ext'), cfg, mallTrackExtContext(ox, oy)) AFTER all mall carving
//    and BEFORE the crop (the Kit's main stream is never consumed; the plan writes nothing into the Kit).
//  - Attach: after the LAST core pass (hordes included) finishExtensions(layout, ext, {ox, oy, grow: 'east-south'}) grows the grid
//    east / south of the fixed origin and appends the extension areas / doors / cells; populateExtensions dresses, lights, stocks and
//    populates them on its own fork, APPENDED after every core record; then the ONE family roll (assignEnemyArchetypes).
//  - Every mall global pass (shops, landmarks, ambient spawns, supplies, lighting, hordes, patrol graph, the mall record) runs before
//    the attach, so it never sees an extension area — skipping them is by construction; passes that read the finished layout use
//    isExtensionArea (area.ext set).

import type {TrackExtContext} from '../trackExt/types';

export {isExtensionArea} from '../trackExt/types';

/**
 * Grid cell budget (W x H) of the mall layout WITH its extensions (TrackExtContext.maxCells). Task mall-playtest-revision-20261031:
 * the compact mall's core grid is ~26-33k cells (measured: 3 variants x 6 seeds; 4 storey grids of the same size; Track3: 39-52k x
 * 7 grids) — the east tunnel + its annex may grow the grid to at most 75k cells (37-75k measured; per-level arrays scale with it; an
 * extension that does not fit is simply not planned).
 */
export const MALL_EXT_MAX_CELLS = 75_000;

/**
 * The mall's extendTracks context: east / south growth only, from the fixed crop origin (canvas cells). OPTIONAL lane INTEG
 * addition: rockLevels [0] — only the station's storey must be rock around an extension; the retail floors (>= 5 m above the 4.4 m
 * bed ceiling, slabs between) may stand above a tunnel / annex (never their atrium openings: those lie over the station block).
 * Without it a bed end under a retail floor is "blocked at the mouth". At most ONE annex (TRACK_EXT_MALL annex.max 1).
 */
export function mallTrackExtContext(ox: number, oy: number): TrackExtContext {
  return {levelId: 'mall', canvasGrow: 'east-south', origin: {x: ox, y: oy}, maxCells: MALL_EXT_MAX_CELLS, rockLevels: [0]};
}
