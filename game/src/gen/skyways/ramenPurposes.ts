// Task studio-skyways-level-20261106-054448 (lane FOOD): the Skyways ramen restaurant's room PURPOSES (spread into gen/purposes.ts
// ROOM_PURPOSES by one tagged line): the dining room ('skyways-ramen') and its kitchen ('skyways-ramen-kitchen'). They are the LOOT KEYS
// of the restaurant's holders (gen/skyways/ramen.ts sets PropPlacement.purpose on every holder it places, so its counter / cooler /
// fridge roll the restaurant's tables whatever purpose the area itself carries) and the areas' purposes when the generator presets them.
//
// Preset only, never drawn by assignRoomPurposes: weight 0 / max 0 (fits() is false), appended after every core purpose (the
// caps-exhausted fallback never reaches them) — the Subway / Office / Mall / Reactor back-of-house assignment and every loot golden are
// unchanged. Ids carry the 'skyways-' prefix (tests/purposes.test.ts counts station purposes without it). Loot: the named tables of
// items/lootTables.ts (RAMEN_*: exact, small, finite). Furniture: the dresser hook (gen/skyways/ramen.ts) furnishes both rooms, so their
// rule lists are empty (the station dresser only lights them).

import type {RoomPurpose} from '../purposes';
import {RAMEN_COOLER, RAMEN_COUNTER, RAMEN_FRIDGE, RAMEN_KITCHEN} from '../../items/lootTables';

/** The restaurant purpose ids (loot keys). */
export const SKYWAYS_RAMEN_PURPOSE = {dining: 'skyways-ramen', kitchen: 'skyways-ramen-kitchen'} as const;

export function SKYWAYS_RAMEN_PURPOSES(): Record<string, RoomPurpose> {
  const base = {category: 'back', slots: ['utility'], kinds: ['room'], weight: 0, max: 0, props: []} as const;
  const loot = {shopCounter: RAMEN_COUNTER, shopCooler: RAMEN_COOLER, fridge: RAMEN_FRIDGE, default: RAMEN_KITCHEN};
  return {
    [SKYWAYS_RAMEN_PURPOSE.dining]: {
      ...base, id: SKYWAYS_RAMEN_PURPOSE.dining, theme: 'food', label: 'Ramen restaurant', light: [0.55, 0.35, 0.1], warm: true, loot,
    },
    [SKYWAYS_RAMEN_PURPOSE.kitchen]: {
      ...base, id: SKYWAYS_RAMEN_PURPOSE.kitchen, theme: 'food', label: 'Ramen kitchen', light: [0.5, 0.4, 0.1], loot,
    },
  };
}
