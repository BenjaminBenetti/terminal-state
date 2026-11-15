// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lead): the new events' VENUE — each takes the convention's venue
// carve (gen/skyways/carve.ts carveVenue: the main hall + its back-of-house strip, the host's skyway court, the corridors in from the
// bridges, two panel rooms and a lounge) unchanged, under its own id and its own room names. Labels only: no cell, door or draw moves,
// so a new event is exactly as walkable / reachable as the convention's venue of the same seed. Pure data.

import type {Area} from '../../stationTypes';
import type {AddonCarve} from '../carve';
import type {SkywaysEventAddonId, SkywaysVenueRole} from '../skywaysTypes';
import {EXPO_ROOM_NAMES} from './expoTypes';
import {GOLF_ROOM_NAMES} from './golfTypes';
import {EVAC_ROOM_NAMES} from './evacTypes';

/** An event's room names by venue role (`exhibitors` / `registration`: a prefix before " · <building>", like the convention's). */
export interface EventRoomNames {
  hall: string;
  /** The main hall's pre-function foyer (approach 'foyer'). */
  foyer: string;
  exhibitors: string;
  registration: string;
  /** Panel rooms A, B (carve order). */
  panels: readonly [string, string];
  lounge: string;
  backstage: string;
  storage: string;
}
export const EVENT_ROOM_NAMES: Readonly<Record<SkywaysEventAddonId, EventRoomNames>> = {'tech-expo': EXPO_ROOM_NAMES, 'mini-golf': GOLF_ROOM_NAMES, 'evac-centre': EVAC_ROOM_NAMES};

/** Renames the venue's areas for a new event (the carve's labels: see carveVenue / tryAddon). Returns the carve. */
export function relabelEventVenue(areas: Area[], carve: AddonCarve, id: SkywaysEventAddonId): AddonCarve {
  const n = EVENT_ROOM_NAMES[id];
  const suffix = (a: Area) => { const m = / · (.*)$/.exec(a.label ?? ''); return m ? ` · ${m[1]}` : ''; };
  let panel = 0;
  for (const v of carve.venue ?? []) {
    const a = areas[v.area];
    if (!a) continue;
    const role: SkywaysVenueRole = v.role;
    if (role === 'main-hall') a.label = n.hall;
    else if (role === 'exhibitors') a.label = `${n.exhibitors}${suffix(a)}`;
    else if (role === 'registration') a.label = a.label === 'Main stage foyer' ? n.foyer : `${n.registration}${suffix(a)}`;
    else if (role === 'panel') a.label = n.panels[Math.min(1, panel++)];
    else if (role === 'photo-lounge') a.label = n.lounge;
    else if (role === 'backstage') a.label = n.backstage;
    else if (role === 'storage') a.label = n.storage;
  }
  return carve;
}
