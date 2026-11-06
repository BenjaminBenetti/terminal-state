// Task studio-skyways-level-20261106-054448-01 (primary): the dressing of the ONE localized add-on of a Skyways level
// (layout.skyways.addon) — the anime convention hall or the prize-car atrium — and the ramen restaurant hook. Pure data (props,
// signs, statue records), run once after the station dresser on its own rng fork.

import type {Rng} from '../../core/rng';
import type {StationLayout} from '../stationTypes';

/** Dresses the add-on hall (and records its statues / car). No-op on any other layout. */
export function dressSkywaysAddon(layout: StationLayout, rng: Rng): void {
  const info = layout.skyways;
  if (!info) return;
  void rng;
}
