// Task track3-eaton-centre-20261031 (lane GEN): the Track2 SEAM of The Eaton's Center — same-world track extensions / service
// annexes (Studio Alpha, reference/tasks/track3-eaton-centre-20261031/TRACK2-PROPOSED-CONTRACT.md; Track2 DESIGN.md §1-2).
//
// *** NOT INTEGRATED — Track2 pending. *** Track2's `gen/trackExt` is not on main yet. Until it lands:
//  - `MALL_TRACK_EXTENSIONS` is the mall's ENABLED interim declaration (never 'none'), registered next to LEVELS (levels/registry.ts
//    TRACK_EXTENSIONS);
//  - `extendTracksSeam` is the ONE call site gen/mall/index.ts makes AFTER all mall carving and BEFORE the crop (fixed crop origin,
//    canvas room east / south: MALL_CANVAS): an explicit no-op that consumes NO core RNG (the caller passes rng.fork('track-ext')),
//    returning an empty extension record whose log says why;
//  - `isExtensionArea` is the one predicate every mall global pass uses to skip extension areas once they exist (area.ext set).
// Integration: replace the body of extendTracksSeam with Track2's `extendTracks(k, rng, cfg, ctx)` and the interim types with
// gen/trackExt/types.ts; nothing else in the mall changes (layout.mall.subwayRoot is only a DERIVED report of the trench ends).

import type {Rng} from '../../core/rng';
import type {Kit} from '../stationKit';
import type {Area} from '../stationTypes';

/** Interim stand-in for Track2's TrackExtConfig (data hook; the fields Track2's DESIGN.md §2 names). */
export interface TrackExtConfigInterim {
  enabled: true;
  /** At most this many service annexes in the level (0 / 1 / 2 possible). */
  maxAnnexes: 0 | 1 | 2;
  /** Tunnel length range (m) along a bed end. */
  tunnelM: readonly [number, number];
  /** Target annex size as a share of the Subway walkable-exploration baseline (Track2 measures the baseline). */
  annexShare: number;
  note: string;
}

/** Interim stand-in for Track2's TrackExtensions (layout.extensions). */
export interface TrackExtensionsInterim {
  tunnels: unknown[];
  annexes: unknown[];
  log: {trench: number; from: 'x0' | 'x1'; result: string}[];
}

/** The mall's declaration: ENABLED (the mall's station has track beds; Track2 decides what fits). Interim data hook. */
export const MALL_TRACK_EXTENSIONS: TrackExtConfigInterim = {
  enabled: true, maxAnnexes: 2, tunnelM: [30, 110], annexShare: 0.25,
  note: "The Eaton's Center: both bed ends of the pit station's double track bed are candidates; canvas grows east / south only (fixed crop origin).",
};

/**
 * THE seam (gen/mall/index.ts, after all carving, before the crop). NOT INTEGRATED — Track2 pending: a no-op that never draws from
 * `rng` (already a fork) and leaves the kit untouched; it logs each bed end as a pending candidate.
 */
export function extendTracksSeam(k: Kit, rng: Rng, cfg: TrackExtConfigInterim, ctx: {levelId: 'mall'; canvasGrow: 'east-south'}): TrackExtensionsInterim {
  void rng; void cfg; void ctx;
  const log: TrackExtensionsInterim['log'] = [];
  k.trenches.forEach((_, trench) => {
    log.push({trench, from: 'x0', result: 'not integrated (Track2 pending)'}, {trench, from: 'x1', result: 'not integrated (Track2 pending)'});
  });
  return {tunnels: [], annexes: [], log};
}

/** Track2 marks extension areas with `area.ext` ('tunnel' | 'annex'); every mall global pass skips them. */
export function isExtensionArea(a: Area | undefined): boolean {
  return !!a && (a as Area & {ext?: string}).ext !== undefined;
}
