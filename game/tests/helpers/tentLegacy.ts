// Task studio-surface-map-tent-cab-20261119-025201-01 (lane TENT): the "before" of the byte pins. A Surface Run district generated since
// the tent lost its free mask, with that mask put back at layout.pickups[0] exactly as main's dressCheckpoint made it
// (world/surface/tentStock.ts legacyTentMask: same keys, order and values) — so a district pinned before the change still matches its
// digest exactly when the only difference is the removed mask (tests/surface-v1-compat.test.ts, surface-connector-pins.test.ts,
// surface-tent-stock.test.ts). A layout without a supply table (no mask was ever made) comes back as it is.
import type {StationLayout} from '../../src/gen/stationTypes';
import {legacyTentMask} from '../../src/world/surface/tentStock';

export function withLegacyTentMask(L: StationLayout): StationLayout {
  const m = L.surface ? legacyTentMask(L) : null;
  return m ? {...L, pickups: [m, ...L.pickups]} : L;
}
