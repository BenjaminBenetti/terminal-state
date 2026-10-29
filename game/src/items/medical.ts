// Iteration 16 (lane INJURY fills this; primary created the contract stub): medical items that treat LIMB injuries
// (player/injuries.ts). Generic bandages / med kits restore HP only and never cure a limb injury.
import type {ItemDef, ItemDims} from './items';

export type Limb = 'arm' | 'leg';

/** Icon keys the injury lane adds (ui/medicalIcons.ts). */
export type MedicalIconKey = never;

export const MEDICAL_ITEMS: Record<string, ItemDef> = {};
export const MEDICAL_DIMS: Record<string, ItemDims> = {};
