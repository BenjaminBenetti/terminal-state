// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): THE SURVIVOR MARKET, layout version 4 = version 3 (the settlement with
// the upper-level bar) PLUS the corpse buyer's DEN — the version-4 pass gen/market/v2/index.ts runs LAST on a finished version-3 layout:
// the carve (gen/market/v4/denCarve.ts: no draw), the furnishing (gen/market/v4/denDress.ts: its own fork only), the record
// (gen/market/v4/denRecord.ts). Everything is appended, so every version-3 output (cells, areas, doors, props, lights, signs, stalls,
// spots, residents) is exactly version 3's: the people / combat / trade lanes see the same settlement. Validation:
// gen/market/v4/denValidate.ts.

import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {SettleCarve} from '../v2/carve';
import {carveDen, type DenCarve} from './denCarve';
import {dressDen, type DenDressed} from './denDress';
import {denRecord, withDen} from './denRecord';

/** Adds the den to a finished version-3 layout (its record becomes version 4); false (the layout untouched) when the plan does not fit. */
export function addDen(layout: StationLayout, sc: SettleCarve, rng: Rng, out?: {carve?: DenCarve; dressed?: DenDressed}): boolean {
  const m = layout.market;
  if (!m) return false;
  const dc = carveDen(layout, sc);
  if (!dc) return false;
  const dd = dressDen(layout, dc, rng);
  layout.market = withDen(m, denRecord(layout, dc, dd));
  if (out) { out.carve = dc; out.dressed = dd; }
  return true;
}
