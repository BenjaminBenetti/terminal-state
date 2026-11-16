// Task studio-skywalk-loot-performance-20261116-022934-01 (lane LOOT; Skyways layout version 8): the loot keys of the new events' own
// supplies (gen/skyways/events/eventLoot.ts sets PropPlacement.purpose on every holder it appends), spread into gen/purposes.ts
// ROOM_PURPOSES by one tagged line.
//
// They are prop-level keys and are never drawn by assignRoomPurposes: weight 0 and max 0 (fits() is false), appended after every other
// purpose (the caps-exhausted fallback never reaches them). The Subway, Office, Mall and Reactor back-of-house assignment and every loot
// golden stay unchanged. The ids carry the 'skyways-' prefix (tests/purposes.test.ts counts station purposes without it). Each names its
// holder kinds explicitly: an EXACT purpose entry that names an own-table openable (footlocker, tote, carton, filing cabinet, tool chest)
// rolls instead of that kind's own table (items/loot.ts holderTable). Loot: the named EXPO_* / GOLF_* / EVAC_* tables of
// items/lootTables.ts (exact, small, finite, no ammo).

import type {RoomPurpose} from '../../purposes';
import {
  EVAC_MED_STOCK, EVAC_MED_TOTE, EVAC_RATION_STOCK, EVAC_SUPPLY, EXPO_AV_CHEST, EXPO_DEMO_STOCK, EXPO_FLIGHT_CASE, GOLF_COOLER, GOLF_MAINT_CABINET,
  GOLF_MAINT_CHEST, GOLF_RECEPTION, GOLF_SNACKS,
} from '../../../items/lootTables';

/** The supply loot keys (purpose ids) by event and place. */
export const SKYWAYS_EVENT_LOOT_PURPOSE = {
  expoDemo: 'skyways-expo-demo', expoStorage: 'skyways-expo-storage',
  golfDesk: 'skyways-golf-desk', golfMaintenance: 'skyways-golf-maintenance', golfConcessions: 'skyways-golf-concessions',
  evacMedical: 'skyways-evac-medical', evacRations: 'skyways-evac-rations', evacSupplies: 'skyways-evac-supplies',
} as const;
export type SkywaysEventLootKey = (typeof SKYWAYS_EVENT_LOOT_PURPOSE)[keyof typeof SKYWAYS_EVENT_LOOT_PURPOSE];

export function SKYWAYS_EVENT_LOOT_PURPOSES(): Record<string, RoomPurpose> {
  const base = {category: 'back', slots: ['utility'], kinds: ['room'], weight: 0, max: 0, props: []} as const;
  const P = SKYWAYS_EVENT_LOOT_PURPOSE;
  const room = (id: string, label: string, theme: RoomPurpose['theme'], loot: RoomPurpose['loot']): RoomPurpose => ({...base, id, label, theme, loot});
  return {
    [P.expoDemo]: room(P.expoDemo, 'Expo demo stock', 'tech', {footlocker: EXPO_FLIGHT_CASE, cardboardBoxFlaps: EXPO_DEMO_STOCK, storageTote: EXPO_DEMO_STOCK, default: EXPO_DEMO_STOCK}),
    [P.expoStorage]: room(P.expoStorage, 'Expo storage', 'tech', {rollingToolChest: EXPO_AV_CHEST, footlocker: EXPO_FLIGHT_CASE, cardboardBoxFlaps: EXPO_DEMO_STOCK, storageTote: EXPO_DEMO_STOCK, default: EXPO_DEMO_STOCK}),
    [P.golfDesk]: room(P.golfDesk, 'Front desk', 'public', {filingCabinet: GOLF_RECEPTION, default: GOLF_RECEPTION}),
    [P.golfMaintenance]: room(P.golfMaintenance, 'Course maintenance', 'service', {rollingToolChest: GOLF_MAINT_CHEST, cabinetTall: GOLF_MAINT_CABINET, storageTote: GOLF_MAINT_CABINET, default: GOLF_MAINT_CABINET}),
    [P.golfConcessions]: room(P.golfConcessions, 'Concessions', 'food', {shopCooler: GOLF_COOLER, snackRack: GOLF_SNACKS, default: GOLF_SNACKS}),
    [P.evacMedical]: room(P.evacMedical, 'Medical stock', 'medical', {medCabinet: EVAC_MED_STOCK, storageTote: EVAC_MED_TOTE, default: EVAC_MED_TOTE}),
    [P.evacRations]: room(P.evacRations, 'Ration stock', 'food', {crate: EVAC_RATION_STOCK, cardboardBoxFlaps: EVAC_RATION_STOCK, default: EVAC_RATION_STOCK}),
    [P.evacSupplies]: room(P.evacSupplies, 'Supply store', 'service', {cabinetTall: EVAC_SUPPLY, crate: EVAC_SUPPLY, storageTote: EVAC_SUPPLY, default: EVAC_SUPPLY}),
  };
}
