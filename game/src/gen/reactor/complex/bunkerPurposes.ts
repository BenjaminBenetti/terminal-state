// Task reactor-expansion-20261101 (lane BUNKER): the bunker's OWN room purposes (spread into gen/purposes.ts ROOM_PURPOSES by one tagged
// line). Only the rooms no existing purpose describes: the blast-door lock, the decontamination room, the dormitories and the armoury
// (the infirmary / radio room / mess / stores / workshop / switch room / filtration plant / generator hall reuse the existing
// first-aid-room / signal-room / staff-room / storage / workshop / electrical-room / ventilation-plant / generator-room purposes).
//
// Preset per area by gen/reactor/complex/bunker.ts, never drawn by assignRoomPurposes: weight 0 / max 0 (fits() is false), and they are
// appended AFTER every core purpose, so the caps-exhausted fallback (the first slot-compatible purpose) never reaches them — the Subway /
// Office / Mall back-of-house assignment is unchanged. Ids carry the 'reactor-' prefix (tests/purposes.test.ts counts station purposes
// without it). Loot: the named tables of items/lootTables.ts only (no new literal item lists); ammo only in the armoury, by rule.
// Furniture: the lock / decon rules run in the station dresser; the dormitories' beds / footlockers / lockers and the armoury's lockers
// / crates are placed by the bunker's dress hook (./bunkerDress.ts: barracks rows, real fit), so their rule lists are empty.

import type {RoomPurpose} from '../../purposes';
import {CACHE_CRATE, GUN_SAFE_ROWS, PERSONAL_ROWS, TENANT_ARMS, TENANT_MEDS, TENANT_SUPPLY} from '../../../items/lootTables';

/** The bunker purpose ids. */
export const BUNKER_PURPOSE = {
  lock: 'reactor-bunker-lock', decon: 'reactor-bunker-decon', dorm: 'reactor-bunker-dormitory', armoury: 'reactor-bunker-armoury',
} as const;

export function REACTOR_BUNKER_PURPOSES(): Record<string, RoomPurpose> {
  const base = {category: 'back', slots: ['utility'], kinds: ['room'], weight: 0, max: 0} as const;
  return {
    [BUNKER_PURPOSE.lock]: {
      ...base, id: BUNKER_PURPOSE.lock, theme: 'service', label: 'Blast-door lock', light: [0.7, 0.3, 0],
      props: [
        {kind: 'bench', at: 'wall', wall: 'side', n: [0, 1], chance: 0.6, front: 0.6},
        {kind: 'noticeBoard', at: 'wall', wall: 'side', n: [1, 1], chance: 0.6, y: 1.1},
      ],
      loot: {default: TENANT_SUPPLY},
      floor: {med: 0.2},
    },
    [BUNKER_PURPOSE.decon]: {
      ...base, id: BUNKER_PURPOSE.decon, theme: 'medical', label: 'Decontamination', light: [0.55, 0.45, 0],
      props: [
        {kind: 'washCounter', at: 'wall', wall: 'side', n: [1, 1], front: 0.7},
        {kind: 'staffLockers', at: 'row', wall: 'side', n: [1, 3], front: 1.0},
        {kind: 'bench', at: 'wall', wall: 'side', n: [1, 1], chance: 0.7, front: 0.6},
        {kind: 'mopSink', at: 'wall', wall: 'any', n: [0, 1], front: 0.6},
        {kind: 'bin', at: 'wall', wall: 'any', n: [1, 1]},
      ],
      loot: {default: TENANT_MEDS},
      floor: {med: 0.8},
    },
    [BUNKER_PURPOSE.dorm]: {
      ...base, id: BUNKER_PURPOSE.dorm, theme: 'personal', label: 'Dormitory', light: [0.3, 0.5, 0.2], warm: true,
      props: [],
      loot: {default: {items: PERSONAL_ROWS, lots: [1, 2], empty: 0.35}},
      floor: {med: 0.5, ammo: 0.2},
    },
    [BUNKER_PURPOSE.armoury]: {
      ...base, id: BUNKER_PURPOSE.armoury, theme: 'security', label: 'Armoury', light: [0.3, 0.45, 0.25],
      props: [],
      loot: {gunLocker: TENANT_ARMS, cabinetTall: {items: GUN_SAFE_ROWS, lots: [1, 3], empty: 0.15}, crate: CACHE_CRATE, default: TENANT_SUPPLY},
      floor: {ammo: 1.6, med: 0.4},
    },
  };
}
