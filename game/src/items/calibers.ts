// CALIBER-BASED AMMUNITION (task knife-melee-20261030, lane AMMO). Pure data, no imports (safe for every module).
//
// User (2026-10-30): "relabel all the ammo ... to nine millimeter and then whatever rifles use ... and then whatever shotguns use ...
// so when we add different types of weapons the ammo will work in those weapons ... based on what the weapon needs".
//
// - An ammo ITEM is a caliber (one item per caliber: CALIBERS[c].itemId). A weapon declares the caliber it chambers
//   (weapons/weapons.ts WeaponDef.caliber), and reload / reserve counts / dry-fire messages resolve the pool through it, so any
//   future weapon of the same caliber shares the same rounds. Loaded magazines stay per weapon (ItemStack.mag, WeaponDef.magazine).
// - Game-design calibers (Main-acknowledged): 9mm (9×19mm) for the service pistol, 5.56×45mm for the current rifle, 12-gauge for
//   the current pump shotgun. A per-weapon choice, not a claim that every rifle / shotgun uses one universal cartridge: a new
//   cartridge is a new CALIBERS row + its item.
// - LEGACY ids: the old gun-specific items (ammo_pistol / ammo_rifle / ammo_shells) map 1:1 onto the caliber items with the same
//   counts and the same stack limits; snapshots / section memory / grounded bags are migrated where they are read back
//   (items/inventory.ts stackFromJSON, run/worldMemory.ts stackFromRecord) — no duplication, no lost rounds, no refill.
// - Loot (items/loot.ts, items/lootEconomy.ts, gen/purposes.ts, world/openablesSpec.ts): a table's ammo is GENERIC — its ammo
//   weight split evenly over the calibers (genericAmmo: ~1/3 each). Deliberate exceptions keep a single caliber: the matching
//   box next to a weapon find (gen/weaponFinds.ts WEAPON_FIND_AMMO), the 9mm-only sidearm stock of office desks / police
//   cabinets, and the loose floor boxes (gen/stationDress.ts, gen/office/spawns.ts) — see lanes/ammo.done.

export type Caliber = '9x19mm' | '5.56x45mm' | '12ga';

export interface CaliberSpec {
  id: Caliber;
  /** The inventory item that IS this caliber. */
  itemId: string;
  /** Short player-facing label (quick slots, HUD, loot text): '9mm', '5.56mm', '12-gauge'. */
  label: string;
  /** Full designation: '9×19mm', '5.56×45mm', '12-gauge'. */
  designation: string;
  /** Unit noun, singular / plural. */
  unit: readonly [one: string, many: string];
}

export const CALIBERS: Readonly<Record<Caliber, CaliberSpec>> = {
  '9x19mm': {id: '9x19mm', itemId: 'ammo_9mm', label: '9mm', designation: '9×19mm', unit: ['round', 'rounds']},
  '5.56x45mm': {id: '5.56x45mm', itemId: 'ammo_556', label: '5.56mm', designation: '5.56×45mm', unit: ['round', 'rounds']},
  '12ga': {id: '12ga', itemId: 'ammo_12ga', label: '12-gauge', designation: '12-gauge', unit: ['shell', 'shells']},
};

/** Calibers in a fixed order (9mm, 5.56, 12-gauge). */
export const CALIBER_IDS: readonly Caliber[] = ['9x19mm', '5.56x45mm', '12ga'];
/** The caliber ammo items, same order. */
export const AMMO_ITEM_IDS: readonly string[] = CALIBER_IDS.map(c => CALIBERS[c].itemId);

/** The ammo item a caliber is loaded from. */
export function ammoItemFor(c: Caliber): string {
  return CALIBERS[c].itemId;
}

/** Caliber of an ammo item id (legacy ids included), or null for anything that is not caliber ammo. */
export function caliberOfItem(itemId: string): Caliber | null {
  const id = canonicalItemId(itemId);
  return CALIBER_IDS.find(c => CALIBERS[c].itemId === id) ?? null;
}

/** Old gun-specific ammo item ids -> the caliber items that replaced them (same counts, same stack limits). */
export const LEGACY_AMMO_IDS: Readonly<Record<string, string>> = {ammo_pistol: 'ammo_9mm', ammo_rifle: 'ammo_556', ammo_shells: 'ammo_12ga'};

/** The current item id for a possibly legacy one (identity for everything else). */
export function canonicalItemId(itemId: string): string {
  return LEGACY_AMMO_IDS[itemId] ?? itemId;
}

/**
 * GENERIC ammo rows for a loot table: the table's whole ammo weight `weight` split evenly over the calibers (~1/3 each). The rows
 * are contiguous, so a table's other rows keep their exact pick ranges (same RNG draws -> the same non-ammo loot).
 */
export function genericAmmo(weight: number): [itemId: string, weight: number][] {
  return AMMO_ITEM_IDS.map(id => [id, weight / AMMO_ITEM_IDS.length]);
}

/** "1 9mm round", "12 5.56mm rounds", "3 12-gauge shells" (null when `itemId` is not caliber ammo). */
export function ammoText(itemId: string, n: number): string | null {
  const c = caliberOfItem(itemId);
  if (!c) return null;
  const s = CALIBERS[c];
  return `${n} ${s.label} ${n === 1 ? s.unit[0] : s.unit[1]}`;
}
