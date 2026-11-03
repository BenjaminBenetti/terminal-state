// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): a campaign station is ONE name everywhere. The level generators
// pick their own seeded name (gen/station.ts, gen/mall/names.ts, gen/reactor), but the network node's printed name is the one on the
// paper map, the saves and the arrival toast — so the generated layout adopts it AFTER generation (the generator's seeded stream and
// every pinned layout stay byte-identical). Only exact name texts change: the platform / wall signs that print the station name, the
// mall's / reactor's own name; area labels that merely contain a word of it ("Reactor control room") are left alone.
import type {StationLayout} from '../gen/stationTypes';

/** Rename a freshly generated layout to the campaign node's `name` (in place). Returns the number of sign texts changed. */
export function adoptStationName(layout: StationLayout, name: string): number {
  const old = layout.name;
  if (!name || old === name) return 0;
  layout.name = name;
  let n = 0;
  for (const s of layout.signs) if (s.text === old) { s.text = name; n++; }
  if (layout.mall && layout.mall.name === old) layout.mall.name = name;
  if (layout.reactor && layout.reactor.name === old) layout.reactor.name = name;
  return n;
}
