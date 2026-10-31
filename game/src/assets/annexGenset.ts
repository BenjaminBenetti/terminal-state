// Task studio-alpha-track2-round2-20261031-01 (R3): the ONE generated annex generator-set model (Meshy T2.5; provenance
// game/public/assets/derivatives/annex-genset-20261031.json, rebuilt by tools/asset-pipeline/props/build-annex-genset.mjs). A SHARED
// lazy model (not mall-*): fetched by the loading screen for any section whose annex machinery has a genset record, instanced on
// the record's plinth by world/builder.ts (world/trackExt/machines.ts gensetModelFit). Without it the procedural genset stands.
import type {StationLayout} from '../gen/stationTypes';
import {ANNEX_GENSET} from './annexGenset.generated';

export {ANNEX_GENSET};

/** The lazy model keys a section needs for its annex gensets: the genset model when any genset record exists. */
export function gensetModelKeysFor(layout: Pick<StationLayout, 'extensions'>): readonly string[] {
  return layout.extensions?.machines?.some(m => m.kind === 'genset') ? [ANNEX_GENSET.key] : [];
}
