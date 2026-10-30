// Iteration 16 (lane RUN): the NewGame starter loadout — exactly the iteration-15 kit that every new station used to
// hand out (now only NewGame does; travel never touches the inventory).
//   quick slot 1: the pistol with a full magazine (15) — the rifle + 30 when the pistol art gate is off;
//   quick slot 5: one bandage;  backpack: 45 x 9mm (60 x 5.56×45mm for the rifle fallback);  one flare in the grenade slot (teaches G-throw).
//   Lane KNIFE (knife-melee-20261030): + the knife (melee, no ammo) — an always-available fallback.
//   Task knife-windup-20261030 (lane SLOT): the knife lives in the dedicated MELEE SLOT (key ~), not in quick slot 3 — quick slots
//   2-4 start empty. The start weapon (quick slot 1) stays selected.

import {Inventory, MELEE_REF} from '../items/inventory';
import {WEAPONS, weaponAmmoItem} from '../weapons/weapons';

export function starterInventory(startWeapon: 'rifle' | 'pistol'): Inventory {
  const inv = new Inventory();
  if (startWeapon === 'pistol') inv.set({bar: 'hotbar', index: 0}, inv.makeStack('pistol', 1, WEAPONS.pistol.magazine));
  else inv.set({bar: 'hotbar', index: 0}, inv.makeStack('rifle', 1, 30));
  inv.set({bar: 'hotbar', index: 4}, inv.makeStack('bandage', 1));
  // lane AMMO: the start weapon's caliber (9mm / 5.56×45mm) — same 45 / 60 rounds
  inv.add(inv.makeStack(weaponAmmoItem(WEAPONS[startWeapon])!, startWeapon === 'pistol' ? 45 : 60));
  inv.add(inv.makeStack('flare', 1));
  // lane KNIFE (knife-melee-20261030) / SLOT (knife-windup-20261030): the knife IN ADDITION to the kit above, in the melee slot (~).
  // Nothing above is removed or reduced; no quick slot is used.
  inv.set(MELEE_REF, inv.makeStack('knife', 1));
  inv.select(0);
  return inv;
}
