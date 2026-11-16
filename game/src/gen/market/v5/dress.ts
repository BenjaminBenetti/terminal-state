// (stub: replaced by the DRESS lane)
import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {MarketStallId} from '../marketTypes';
import type {CreviceCarve} from './carve';
export interface CreviceAnchors { stalls: unknown[]; uses: unknown[] }
export function dressCrevice(_layout: StationLayout, _cc: CreviceCarve, _rng: Rng, _names: Record<MarketStallId, string>): CreviceAnchors | null {
  return {stalls: [], uses: []};
}
