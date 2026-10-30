// Iteration 16 (lane RUN): the NewGame starter loadout — exactly the iteration-15 kit that every new station used to
// hand out (now only NewGame does; travel never touches the inventory).
//   quick slot 1: the pistol with a full magazine (15) — the rifle + 30 when the pistol art gate is off;
//   quick slot 5: one bandage;  backpack: 45 x 9 mm (60 x 5.56 for the rifle fallback);  one flare in the grenade slot (teaches G-throw).

import {Inventory} from '../items/inventory';
import {WEAPONS} from '../weapons/weapons';

export function starterInventory(startWeapon: 'rifle' | 'pistol'): Inventory {
  const inv = new Inventory();
  if (startWeapon === 'pistol') inv.set({bar: 'hotbar', index: 0}, inv.makeStack('pistol', 1, WEAPONS.pistol.magazine));
  else inv.set({bar: 'hotbar', index: 0}, inv.makeStack('rifle', 1, 30));
  inv.set({bar: 'hotbar', index: 4}, inv.makeStack('bandage', 1));
  inv.add(startWeapon === 'pistol' ? inv.makeStack('ammo_pistol', 45) : inv.makeStack('ammo_rifle', 60));
  inv.add(inv.makeStack('flare', 1));
  inv.select(0);
  return inv;
}
