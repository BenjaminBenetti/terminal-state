// Iteration 16 (lane INJURY; primary created the contract stub): medical items that treat LIMB injuries
// (player/injuries.ts). Generic bandages / med kits restore HP only and never cure a limb injury; these restore no HP.
//
// All three are timed 'consumable' uses through Game.startUse (slow on purpose: strapping a splint on is exposure). They are
// refused up front when there is no matching injury ("No leg injury to treat"), re-checked at completion, consumed exactly
// once on success, and a hit / sprint / menu cancels them with nothing used (player/injuries.ts completeTreatment).
//
// Models: the leg splint and arm sling use the Meshy T2.5 derivatives A7 / A8 when delivered (assets/officeAssets.ts,
// world/medicalItems.ts), fitted into the dims below; until then (and always for the trauma kit) authored procedural
// geometry of the same size. Dims: metres, origin bottom-centre, front +Z, as the item normally rests (items/items.ts).
import type {ItemDef, ItemDims} from './items';

export type Limb = 'arm' | 'leg';
export const LIMBS: readonly Limb[] = ['arm', 'leg'];

/** Icon keys the injury lane adds (ui/medicalIcons.ts). */
export type MedicalIconKey = 'legsplint' | 'armsling' | 'traumakit';

/** Item ids (WORLD-GEN may list these in office loot rows; the loot economy also converts a share of med finds). */
export const LEG_SPLINT = 'leg_splint';
export const ARM_SLING = 'arm_sling';
export const TRAUMA_KIT = 'trauma_kit';
export const LIMB_TREATMENT_IDS = [LEG_SPLINT, ARM_SLING, TRAUMA_KIT] as const;

export const MEDICAL_ITEMS: Record<string, ItemDef> = {
  [LEG_SPLINT]: {id: LEG_SPLINT, name: 'Leg splint (SAM)', short: 'Leg splint', kind: 'consumable', stackMax: 2, useTime: 4.5, verb: 'apply',
    icon: 'legsplint', treats: ['leg'],
    description: 'Rolled malleable aluminium-foam splint with two velcro straps. Braces an injured leg: normal walking and sprinting again. Takes a while to strap on — find a quiet corner first.'},
  [ARM_SLING]: {id: ARM_SLING, name: 'Arm sling & compression wrap', short: 'Arm sling', kind: 'consumable', stackMax: 2, useTime: 3.6, verb: 'apply',
    icon: 'armsling', treats: ['arm'],
    description: 'Sealed packet with a triangular sling and an elastic compression wrap. Supports an injured arm: steady aim, normal reloads and handling again.'},
  [TRAUMA_KIT]: {id: TRAUMA_KIT, name: 'Trauma kit', short: 'Trauma kit', kind: 'consumable', stackMax: 1, useTime: 6, verb: 'apply',
    icon: 'traumakit', treats: ['arm', 'leg'],
    description: 'Rare compact trauma pouch: splint, sling and wraps. Treats an injured arm AND an injured leg in one go. Slow to work through.'},
};

export const MEDICAL_DIMS: Record<string, ItemDims> = {
  // a rolled SAM splint lying on its side (roll axis along X): ~12 cm wide, 10 cm across
  [LEG_SPLINT]: {w: 0.12, d: 0.1, h: 0.1, shape: 'flat'},
  // a flat sealed packet (sling folded inside, the wrap roll making a bulge)
  [ARM_SLING]: {w: 0.2, d: 0.14, h: 0.05, shape: 'flat'},
  // a zipped soft pouch with a grab handle
  [TRAUMA_KIT]: {w: 0.24, d: 0.15, h: 0.095, shape: 'flat'},
};

/** "leg", "arm", "arm and leg" — the limbs an item treats, for wording. */
export function treatsText(limbs: readonly Limb[]): string {
  const l = LIMBS.filter(x => limbs.includes(x));
  return l.join(' and ');
}
