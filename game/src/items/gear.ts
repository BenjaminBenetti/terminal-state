// Iteration 16 (lane GEAR): character gear item definitions — base ("crappiest") tier only.
// Gear lives in the GEAR SLOTS (helmet / chest / gloves / boots / backpack; items/inventory.ts), though spare pieces can
// ride in the pockets / quick slots like any item. Stats are applied ONLY as a PlayerModifiers contribution computed
// from the worn items every frame (gearModifiersFor below -> Game.modifierSources -> combineModifiers from BASE values), so
// equipping, unequipping, travelling or retrying can never stack a bonus.
//
// Base-tier stats (exact; documented in reference/tasks/office-space-survival-20261029/lanes/gear.done):
//   armor_vest  chest     torso armor 0.20 (torso hits lose 20 % of their damage; torso = ~50 % of melee hits)
//   chest_rig   chest     +4 pocket slots (12 -> 16); refused off while those 4 pockets hold anything
//   backpack    backpack  its own 12-slot container, only reachable while it lies on the ground (6, click, then E)
//   helmet      helmet    head armor 0.25 (head = ~10 % of melee hits)
//   boots       boots     move speed x1.05 (walk / sprint / crouch)
//   gloves      gloves    weapon spread x0.92 · reload / item-use time x0.92
import type {ItemDef, ItemDims} from './items';
import type {PlayerModifiers} from '../player/modifiers';

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
export type GearIconKey = 'vest' | 'rig' | 'backpack' | 'helmet' | 'boots' | 'gloves';

/** Slot display names (inventory gear panel). */
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = {helmet: 'Head', chest: 'Chest', gloves: 'Hands', boots: 'Feet', backpack: 'Back'};

/** Base-tier backpack size (its own container). */
export const BACKPACK_SLOTS = 12;

const gear = (id: string, name: string, short: string, icon: GearIconKey, spec: GearSpec, description: string): ItemDef =>
  ({id, name, short, kind: 'gear', stackMax: 1, icon, gear: spec, description});

export const GEAR_ITEMS: Record<string, ItemDef> = {
  armor_vest: gear('armor_vest', 'Worn soft armor vest', 'Armor vest', 'vest', {slot: 'chest', tier: 1, armor: 0.2},
    'Faded navy soft body armor with frayed velcro. Takes the edge off hits to the torso. Worn on the chest (instead of a rig).'),
  chest_rig: gear('chest_rig', 'Patched chest rig', 'Chest rig', 'rig', {slot: 'chest', tier: 1, pockets: 4},
    'Olive load-bearing rig with mag and utility pouches. Four extra pockets while worn. Worn on the chest (instead of a vest).'),
  backpack: gear('backpack', 'Faded red daypack', 'Backpack', 'backpack', {slot: 'backpack', tier: 1, bagSlots: BACKPACK_SLOTS},
    `A dirty hiking daypack with ${BACKPACK_SLOTS} slots of its own. You cannot reach into it while wearing it: press 6 to take it off, click to set it down, then E to open it.`),
  helmet: gear('helmet', 'Dented hard hat', 'Hard hat', 'helmet', {slot: 'helmet', tier: 1, armor: 0.25},
    'A scuffed yellow construction hard hat with a chin strap. Softens blows to the head.'),
  boots: gear('boots', 'Scuffed work boots', 'Work boots', 'boots', {slot: 'boots', tier: 1, speedMult: 1.05},
    'Worn leather work boots, laces knotted. Sure footing: you move a little faster.'),
  gloves: gear('gloves', 'Worn work gloves', 'Work gloves', 'gloves', {slot: 'gloves', tier: 1, spreadMult: 0.92, handlingMult: 0.92},
    'Leather-palmed work gloves. A steadier grip: tighter spread and slightly quicker reloads and item use.'),
};

/** Resting sizes (m) as a pickup / ground model = the delivered Meshy derivatives' bounds (vest, rig, backpack, hat and boots stand; gloves lie flat). */
export const GEAR_DIMS: Record<string, ItemDims> = {
  armor_vest: {w: 0.46, d: 0.41, h: 0.62, shape: 'box'},
  chest_rig: {w: 0.41, d: 0.39, h: 0.55, shape: 'box'},
  backpack: {w: 0.33, d: 0.32, h: 0.52, shape: 'box'},
  helmet: {w: 0.23, d: 0.3, h: 0.19, shape: 'box'},
  boots: {w: 0.3, d: 0.32, h: 0.19, shape: 'box'},
  gloves: {w: 0.26, d: 0.2, h: 0.06, shape: 'flat'},
};

export const GEAR_IDS = Object.keys(GEAR_ITEMS);

export function isGearItem(itemId: string | null | undefined): boolean {
  return !!itemId && itemId in GEAR_ITEMS;
}

export function gearSpec(itemId: string | null | undefined): GearSpec | null {
  return itemId ? GEAR_ITEMS[itemId]?.gear ?? null : null;
}

/** Backpack-type gear (has its own container). */
export function isBagItem(itemId: string | null | undefined): boolean {
  return (gearSpec(itemId)?.bagSlots ?? 0) > 0;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;

/** One-line stat text: "torso armor 20 %", "+4 pockets", "speed +5 %", "spread −8 % · handling +8 %". */
export function gearStatText(spec: GearSpec): string {
  const out: string[] = [];
  if (spec.armor) out.push(`${spec.slot === 'helmet' ? 'head' : 'torso'} armor ${pct(spec.armor)}`);
  if (spec.pockets) out.push(`+${spec.pockets} pockets`);
  if (spec.bagSlots) out.push(`${spec.bagSlots}-slot bag (open it on the ground)`);
  if (spec.speedMult && spec.speedMult !== 1) out.push(`speed ${spec.speedMult > 1 ? '+' : '−'}${pct(spec.speedMult - 1)}`);
  if (spec.spreadMult && spec.spreadMult !== 1) out.push(`spread ${spec.spreadMult < 1 ? '−' : '+'}${pct(spec.spreadMult - 1)}`);
  if (spec.handlingMult && spec.handlingMult !== 1) out.push(`reload / use time ${spec.handlingMult < 1 ? '−' : '+'}${pct(spec.handlingMult - 1)}`);
  return out.join(' · ');
}

/** The worn-gear modifier contribution (pure). Missing / unknown items contribute nothing. */
export function gearModifiersFor(worn: Readonly<Partial<Record<GearSlot, {itemId: string} | null>>>): Partial<PlayerModifiers> {
  let speed = 1, spread = 1, handling = 1, head = 0, torso = 0, pockets = 0;
  for (const slot of GEAR_SLOTS) {
    const spec = gearSpec(worn[slot]?.itemId);
    if (!spec || spec.slot !== slot) continue; // an item in the wrong slot never counts
    if (spec.speedMult) speed *= spec.speedMult;
    if (spec.spreadMult) spread *= spec.spreadMult;
    if (spec.handlingMult) handling *= spec.handlingMult;
    if (spec.armor && slot === 'helmet') head = 1 - (1 - head) * (1 - spec.armor);
    if (spec.armor && slot === 'chest') torso = 1 - (1 - torso) * (1 - spec.armor);
    if (spec.pockets && slot === 'chest') pockets += spec.pockets;
  }
  return {speedMult: speed, spreadMult: spread, handlingMult: handling, armorHead: head, armorTorso: torso, extraPockets: pockets};
}
