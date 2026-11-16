// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the Surface Run buildings' back-of-house LOOT KEYS, as room
// PURPOSES (spread into gen/purposes.ts ROOM_PURPOSES by one tagged line). gen/surface/rooms/lootKeys.ts sets them as PropPlacement.purpose
// on a building's holders whose room carries a station back-of-house purpose (workshop / maintenance storage / locker room / security
// office / agent office) or the Office tower's storage room, so a rail depot's, fire station's or shop's back rooms roll tables that fit them (items/lootTables.ts SURFACE_*)
// instead of the station's ammo-cache rows. The rooms themselves keep their purposes (dressing, labels, lighting unchanged).
//
// Preset only, never drawn by assignRoomPurposes: weight 0 / max 0, appended after every core purpose (the caps-exhausted fallback never
// reaches them) — the Subway / Office / Mall / Reactor / Skyways back-of-house assignment and every loot golden are unchanged. Ids carry
// the 'surface-' prefix (tests/purposes.test.ts counts station purposes without it), and each id keeps the shelf-stock category its
// station purpose had (world/shelfStockCatalog.ts shelfCategory: '…workshop' = parts, '…store…' = storage, '…office' = office).

import type {RoomPurpose} from '../../purposes';
import {
  SURFACE_BACK_OFFICE, SURFACE_CREW_LOCKERS, SURFACE_FIRE_GEAR, SURFACE_POLICE_OFFICE, SURFACE_STORE_ROOM, SURFACE_WORKSHOP, SURFACE_WORKSHOP_CRATE,
} from '../../../items/lootTables';

/** The Surface Run back-of-house loot keys (purpose ids). */
export const SURFACE_LOOT_KEY = {
  workshop: 'surface-workshop',
  storeRoom: 'surface-store-room',
  lockers: 'surface-lockers',
  fireWorkshop: 'surface-fire-workshop',
  fireStore: 'surface-fire-store',
  policeOffice: 'surface-police-office',
  backOffice: 'surface-back-office',
} as const;
export type SurfaceLootKey = (typeof SURFACE_LOOT_KEY)[keyof typeof SURFACE_LOOT_KEY];

export function SURFACE_ROOM_PURPOSES(): Record<string, RoomPurpose> {
  const base = {category: 'back', slots: ['utility'], kinds: ['room'], weight: 0, max: 0, props: []} as const;
  const K = SURFACE_LOOT_KEY;
  const workshop = {crate: SURFACE_WORKSHOP_CRATE, rollingToolChest: SURFACE_WORKSHOP_CRATE, default: SURFACE_WORKSHOP};
  const fire = {default: SURFACE_FIRE_GEAR};
  return {
    [K.workshop]: {...base, id: K.workshop, theme: 'service', label: 'Workshop', light: [0.15, 0.5, 0.35], stock: 'parts', loot: workshop},
    [K.storeRoom]: {...base, id: K.storeRoom, theme: 'service', label: 'Store room', light: [0.1, 0.45, 0.45], stock: 'cartons', loot: {default: SURFACE_STORE_ROOM}},
    [K.lockers]: {...base, id: K.lockers, theme: 'personal', label: 'Locker room', light: [0.2, 0.5, 0.3], loot: {default: SURFACE_CREW_LOCKERS}},
    [K.fireWorkshop]: {...base, id: K.fireWorkshop, theme: 'service', label: 'Workshop', light: [0.15, 0.5, 0.35], stock: 'parts', loot: fire},
    [K.fireStore]: {...base, id: K.fireStore, theme: 'service', label: 'Hose store', light: [0.1, 0.45, 0.45], stock: 'cartons', loot: fire},
    [K.policeOffice]: {...base, id: K.policeOffice, theme: 'security', label: 'Duty office', light: [0.3, 0.5, 0.2], loot: {default: SURFACE_POLICE_OFFICE}},
    [K.backOffice]: {...base, id: K.backOffice, theme: 'personal', label: 'Office', light: [0.3, 0.5, 0.2], loot: {default: SURFACE_BACK_OFFICE}},
  };
}
