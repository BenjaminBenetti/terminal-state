// (stub)
import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {MarketLayout, MarketStallId} from '../marketTypes';
import type {CreviceCarve} from './carve';
import type {CreviceAnchors} from './dress';
export function creviceRecord(_layout: StationLayout, _cc: CreviceCarve, _a: CreviceAnchors, _n: Record<MarketStallId, string>, rng: Rng): MarketLayout {
  return {v: 5, stalls: [], spots: [], residents: rng.int(8, 12)};
}
