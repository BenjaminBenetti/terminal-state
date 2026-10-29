// Iteration 16 (lane GEAR fills this; primary created the contract stub): character gear item definitions.
// Gear lives in the GEAR SLOTS (chest / backpack / boots / gloves / helmet), not the hotbar; base tier only for now.
// Stats are applied as PlayerModifiers contributions from BASE values (player/modifiers.ts), never accumulated.
import type {ItemDef, ItemDims} from './items';

export type GearSlot = 'chest' | 'backpack' | 'boots' | 'gloves' | 'helmet';
export const GEAR_SLOTS: readonly GearSlot[] = ['helmet', 'chest', 'gloves', 'boots', 'backpack'];

export interface GearSpec {
  slot: GearSlot;
  /** 1 = base ("crappiest") tier. */
  tier: number;
  /** Armor fraction for its hit location (helmet: head, chest: torso). */
  armor?: number;
  /** Extra pocket slots (load-bearing chest rig). */
  pockets?: number;
  /** Speed multiplier (boots). */
  speedMult?: number;
  /** Spread multiplier (gloves). */
  spreadMult?: number;
  /** Reload / use time multiplier (gloves). */
  handlingMult?: number;
  /** Backpack: slots of its own (separate container; only accessible while grounded). */
  bagSlots?: number;
}

/** Icon keys the gear lane adds (ui/gearIcons.ts). */
export type GearIconKey = never;

export const GEAR_ITEMS: Record<string, ItemDef> = {};
export const GEAR_DIMS: Record<string, ItemDims> = {};
