// Task studio-flamethrower-fire-20261114-031614-01: the worn FUEL TANK's fuel — the ONLY code that adds or takes flamethrower fuel.
// Whole units on the tank's own stack (`ItemStack.fuel`; fire/flamethrowerSpec.ts FLAME_FUEL): a unit is taken exactly when its tick of
// flame is given, a can is poured whole and only when all of it fits. Absent `fuel` = empty.
import type {Inventory, ItemStack} from '../items/inventory';
import {GEAR_SLOTS, gearSpec, isFuelTank} from '../items/gear';
import {FLAME_FUEL, FLAME_FUEL_CAN} from './flamethrowerSpec';

const BACK = GEAR_SLOTS.indexOf('backpack');

/** The Fuel Tank worn in the back slot (the only place a tank feeds the flamethrower from), else null. */
export function wornFuelTank(inv: Pick<Inventory, 'gearSlots'>): ItemStack | null {
  const s = inv.gearSlots[BACK];
  return s && isFuelTank(s.itemId) ? s : null;
}

/** Whole fuel units in a tank stack (0 for anything else / an absent or malformed value; never above its capacity). */
export function tankFuel(s: Pick<ItemStack, 'itemId' | 'fuel'> | null | undefined): number {
  const cap = gearSpec(s?.itemId)?.fuelCap ?? 0;
  const f = s?.fuel;
  return cap > 0 && typeof f === 'number' && Number.isFinite(f) ? Math.max(0, Math.min(cap, Math.floor(f))) : 0;
}

/** Units a tank stack can still take. */
export function tankRoom(s: Pick<ItemStack, 'itemId' | 'fuel'> | null | undefined): number {
  return Math.max(0, (gearSpec(s?.itemId)?.fuelCap ?? 0) - tankFuel(s));
}

/** A whole fuel can fits (the only way fuel goes in: never a part-poured can, never an overflow). */
export function canPourCan(s: Pick<ItemStack, 'itemId' | 'fuel'> | null | undefined): boolean {
  return tankRoom(s) >= FLAME_FUEL.unitsPerCan;
}

/** Take ONE unit for one tick of flame; false (nothing taken) when the tank is empty. */
export function burnUnit(s: ItemStack): boolean {
  const f = tankFuel(s);
  if (f < 1) return false;
  s.fuel = f - 1;
  return true;
}

/**
 * Pour ONE fuel can from the carried items into the tank: the can leaves the inventory and its units arrive in the same step, or
 * nothing happens (no room for a whole can, no can). Returns whether it was poured.
 */
export function pourCan(tank: ItemStack, inv: Pick<Inventory, 'take' | 'count'> & {version: number}): boolean {
  if (!canPourCan(tank) || inv.count(FLAME_FUEL_CAN) < 1) return false;
  if (inv.take(FLAME_FUEL_CAN, 1) !== 1) return false;
  tank.fuel = tankFuel(tank) + FLAME_FUEL.unitsPerCan;
  inv.version++;
  return true;
}
