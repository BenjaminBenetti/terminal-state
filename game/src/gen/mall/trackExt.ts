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
 * Grid cell budget (W x H) of the mall layout WITH its extensions (TrackExtContext.maxCells). The core mall grid is ~39-51k cells
 * (measured, 3 variants x 3 seeds; 7 storey grids of the same size); tunnels + annexes east / south of it may grow the grid to at
 * most 75k cells (~1.5-1.9x: per-level arrays — nav, decay, light / sky tops, the seven storey grids — scale with it).
 */
export const MALL_EXT_MAX_CELLS = 75_000;

/** The mall's extendTracks context: east / south growth only, from the fixed crop origin (canvas cells). */
export function mallTrackExtContext(ox: number, oy: number): TrackExtContext {
  return {levelId: 'mall', canvasGrow: 'east-south', origin: {x: ox, y: oy}, maxCells: MALL_EXT_MAX_CELLS};
}
