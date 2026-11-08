// Task studio-market-rework-20261108-074144-01 (lane TRADE): RAIL TIES as a PHYSICAL ITEM. User: "rail ties should be a physical item that
// sits in your inventory, max stack size 1,000." The survivor market's currency is literally reclaimed railroad track ties (wooden
// sleepers) — not coins, scrip or printed chits — counted out by the tie. Short name "ties".
//
// Item kind 'currency' (items/items.ts), its OWN category: PASSIVE (never used, equipped, worn, held as a weapon or thrown; pockets first,
// like ammo), stackMax RAIL_TIES_STACK (1000; every stack / uid / count validator reads the item's stackMax). It is never a salvage
// material, never in a loot table or any free generation (items/lootTables.ts econCat: none), never stocked by a stall and never bought
// or sold for itself (market/trade/stalls.ts refuses it; market/trade/value.ts gives it no value). Only a trade pays it out
// (market/trade/payment.ts), and the one-time migration of an old save's market balance (market/trade/wallet.ts). Otherwise it is an
// ordinary stack: quick slots, pockets, a backpack, the Lockbox, the car trunk, train cargo, a world drop / pickup, saves, import / export.
// No weight and no hauling: the inventory has no weight.
// Model (world/railTiesModel.ts): a small strapped bundle of tie offcuts, code-built from the track sleeper (no generation). Dims: metres,
// origin bottom-centre, front +Z, as it rests (items/items.ts ITEM_DIMS).
import type {ItemDef, ItemDims} from './items';

/** The item id. */
export const RAIL_TIES_ID = 'rail_ties';
/** Most ties in one stack (user: "max stack size 1,000"). */
export const RAIL_TIES_STACK = 1000;

/** Whether an item is the market's currency (kind 'currency'). */
export const isCurrencyItem = (id: string): boolean => id === RAIL_TIES_ID;

/** What its detail line says (ui/inventoryUI.ts). */
export const CURRENCY_NOTE = 'Rail Ties — the market\'s money: every stall pays and charges in ties from your quick slots and pockets (not a worn backpack)';

export const RAIL_TIES_ITEMS: Record<string, ItemDef> = {
  [RAIL_TIES_ID]: {id: RAIL_TIES_ID, name: 'Rail Ties', short: 'Ties', kind: 'currency', stackMax: RAIL_TIES_STACK, icon: 'railTies',
    description: 'Reclaimed railroad track ties, creosoted timber counted out one tie at a time — the survivor market\'s money. Every stall charges and pays in ties, straight from your quick slots and pockets (ties inside a worn backpack stay there). Nothing to use by hand. Up to 1,000 to a stack.'},
};

export const RAIL_TIES_DIMS: Record<string, ItemDims> = {
  // a strapped bundle of four tie offcuts (2 x 2), lying along X: the bundle's section is one track sleeper's (world/railTiesModel.ts)
  [RAIL_TIES_ID]: {w: 0.36, d: 0.24, h: 0.14, shape: 'flat'},
};
