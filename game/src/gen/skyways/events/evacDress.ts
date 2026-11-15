// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE's dresser — the convention's venue carve
// (layout.skyways.addon.venue by role, relabelled by gen/skyways/events/eventVenue.ts) dressed as the event. Pure data; the rng is consumed
// only here (gen/skyways/addon.ts hands it its own fork). STUB (lead skeleton): lane EVAC fills it in.

import type {Rng} from '../../../core/rng';
import type {StationLayout} from '../../stationTypes';
import type {EventDressResult} from './eventResult';

export function dressEvacCentre(layout: StationLayout, rng: Rng): EventDressResult {
  void rng;
  const res: EventDressResult = {props: [], skipped: [], byArea: {}};
  if (!layout.skyways?.addon.venue?.length) res.skipped.push('no venue');
  return res;
}
