// Iteration 16 (lane GEAR): character gear item definitions — base ("crappiest") tier only.
// Gear lives in the GEAR SLOTS (helmet / chest / gloves / boots / backpack; items/inventory.ts), though spare pieces can
// ride in the pockets / quick slots like any item. Stats are applied ONLY as a PlayerModifiers contribution computed
// from the worn items every frame (gearModifiersFor below -> Game.modifierSources -> combineModifiers from BASE values), so
// equipping, unequipping, travelling or retrying can never stack a bonus.
//
// Base-tier stats (exact; documented in reference/tasks/office-space-survival-20261029/lanes/gear.done):
//   armor_vest  chest     armor 4 pips = 10 % (task studio-general-armor-20261107-231448-01: the pooled armour of player/armor.ts — any enemy hit; was torso-only 20 % on
//                         the ~50 % of melee hits that land on the torso: the same 10 % on average)
//   chest_rig   chest     +4 pocket slots (12 -> 16); refused off while those 4 pockets hold anything
//   backpack    backpack  its own 12-slot container, only reachable while it lies on the ground (6, click, then E)
//   helmet      helmet    armor 1 pip = 2.5 % (was head-only 25 % on the ~10 % of hits that land on the head: the same 2.5 % on average)
//   boots       boots     move speed x1.05 (walk / sprint / crouch)
//   gloves      gloves    weapon spread x0.92 · reload / item-use time x0.92
//
// Task gasmask-breach-20261030 (mask lane): the GAS MASK (`gas_mask`, slot 'mask', APPENDED to GEAR_SLOTS so the backpack keeps
// its index and older snapshots load unchanged). Worn in the mask slot = EQUIPPED; Q puts it on / takes it off the face
// (gear/gasMask.ts). It has no PlayerModifiers stats: on the face with a working filter it protects from infectious gas. The
// fitted filter's charge (seconds left) lives on the mask's own ItemStack (`filter`, items/inventory.ts), so it travels with
// that very mask. Spare filters are the passive supply item `gas_filter` (items/items.ts).
//
// Task filter-tension-airtank-20261104-072836 (user: filters at 25 % of their lifetime; an "Airtank Backpack" in the backpack slot
// with 400 % of the old filter): FILTER_LIFE_S 150 -> 37.5 (x 0.25; saves written with 150 s filters are rescaled once on load:
// save/serialize.ts migrateFilterUnits). The AIRTANK BACKPACK (`airtank_backpack`, slot 'backpack') holds AIRTANK_AIR_S = 600 s of
// air on its OWN stack (`air`, like a mask's `filter`) and NO storage (no bagSlots: it is not a bag). It is consumable and can NOT be
// refilled: a new tank is made full (Inventory.makeStack); nothing ever adds air. Worn with the gas mask on the face it supplies the
// air FIRST (gear/gasMask.ts), the fitted filter only once the tank is empty.
import type {ItemDef, ItemDims} from './items';
import type {PlayerModifiers} from '../player/modifiers';

export type GearSlot = 'chest' | 'backpack' | 'boots' | 'gloves' | 'helmet' | 'mask';
export const GEAR_SLOTS: readonly GearSlot[] = ['helmet', 'chest', 'gloves', 'boots', 'backpack', 'mask'];

/**
 * Task gasmask-breach-20261030 (mask lane): seconds of on-face use one gas-mask filter gives (drains only while the mask is on).
 * Task filter-tension-airtank-20261104-072836: a QUARTER of the original 150 s (user: intentional tension).
 */
export const FILTER_LIFE_S = 37.5;
/** The filter life saves were written with before FILTER_LIFE_S became 37.5 (a save without `filterLifeS`): save/serialize.ts. */
export const LEGACY_FILTER_LIFE_S = 150;
/** Task filter-tension-airtank-20261104-072836: seconds of air in a full Airtank Backpack (4 x the old 150 s filter = 16 filters now). */
export const AIRTANK_AIR_S = 600;

export interface GearSpec {
  slot: GearSlot;
  /** 1 = base ("crappiest") tier. */
  tier: number;
  /**
   * (task studio-general-armor-20261107-231448-01) The armour this item adds to the player's POOL while worn and undamaged (fraction: one pip = 0.025; player/armor.ts).
   * Its stack's own `armor` holds what is left after wear. Any gear item with armor > 0 joins the pool (no separate list).
   */
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
  /** Gas mask (mask lane): seconds one fitted filter lasts on the face (FILTER_LIFE_S). */
  filterLife?: number;
  /** Airtank Backpack: seconds of air in a full tank (AIRTANK_AIR_S); its stack's `air` = seconds left (never refilled). */
  airLife?: number;
}

/** Icon keys the gear lane adds (ui/gearIcons.ts). Mask lane: + 'gasmask'. */
export type GearIconKey = 'vest' | 'rig' | 'backpack' | 'helmet' | 'boots' | 'gloves' | 'gasmask';

/** Slot display names (inventory gear panel). */
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = {helmet: 'Head', chest: 'Chest', gloves: 'Hands', boots: 'Feet', backpack: 'Back', mask: 'Face'};

/** Base-tier backpack size (its own container). */
export const BACKPACK_SLOTS = 12;

const gear = (id: string, name: string, short: string, icon: GearIconKey, spec: GearSpec, description: string): ItemDef =>
  ({id, name, short, kind: 'gear', stackMax: 1, icon, gear: spec, description});

export const GEAR_ITEMS: Record<string, ItemDef> = {
  armor_vest: gear('armor_vest', 'Worn soft armor vest', 'Armor vest', 'vest', {slot: 'chest', tier: 1, armor: 0.1},
    'Faded navy soft body armor with frayed velcro. Takes the edge off every enemy hit (armor). Worn on the chest (instead of a rig).'),
  chest_rig: gear('chest_rig', 'Patched chest rig', 'Chest rig', 'rig', {slot: 'chest', tier: 1, pockets: 4},
    'Olive load-bearing rig with mag and utility pouches. Four extra pockets while worn. Worn on the chest (instead of a vest).'),
  backpack: gear('backpack', 'Faded red daypack', 'Backpack', 'backpack', {slot: 'backpack', tier: 1, bagSlots: BACKPACK_SLOTS},
    `A dirty hiking daypack with ${BACKPACK_SLOTS} slots of its own. You cannot reach into it while wearing it: press 6 to take it off, click to set it down, then E to open it.`),
  helmet: gear('helmet', 'Dented hard hat', 'Hard hat', 'helmet', {slot: 'helmet', tier: 1, armor: 0.025},
    'A scuffed yellow construction hard hat with a chin strap. Softens enemy blows a little (armor).'),
  boots: gear('boots', 'Scuffed work boots', 'Work boots', 'boots', {slot: 'boots', tier: 1, speedMult: 1.05},
    'Worn leather work boots, laces knotted. Sure footing: you move a little faster.'),
  gloves: gear('gloves', 'Worn work gloves', 'Work gloves', 'gloves', {slot: 'gloves', tier: 1, spreadMult: 0.92, handlingMult: 0.92},
    'Leather-palmed work gloves. A steadier grip: tighter spread and slightly quicker reloads and item use.'),
  // Task gasmask-breach-20261030 (mask lane)
  gas_mask: gear('gas_mask', 'Full-face gas mask', 'Gas mask', 'gasmask', {slot: 'mask', tier: 1, filterLife: FILTER_LIFE_S},
    'Black rubber full-face respirator with a wide visor. Worn in the face slot; Q pulls it on or off. It only protects while it is on your face AND its fitted filter has charge left — it draws a spare filter from your pockets / quick slots when one runs out (never from a worn backpack).'),
  // Task filter-tension-airtank-20261104-072836 (icon key: the backpack glyph — no new hand-drawn icon; the item icon is its model)
  airtank_backpack: gear('airtank_backpack', 'Airtank Backpack', 'Airtank', 'backpack', {slot: 'backpack', tier: 1, airLife: AIRTANK_AIR_S},
    `A dented steel air cylinder strapped to a tubular frame and harness. Worn on your back (instead of a backpack: it has no storage) with the gas mask on your face, it feeds the mask clean air for ${AIRTANK_AIR_S / 60} minutes before the fitted filter is used. It cannot be refilled.`),
};

/** Resting sizes (m) as a pickup / ground model = the delivered Meshy derivatives' bounds (vest, rig, backpack, hat and boots stand; gloves lie flat). */
export const GEAR_DIMS: Record<string, ItemDims> = {
  armor_vest: {w: 0.46, d: 0.41, h: 0.62, shape: 'box'},
  chest_rig: {w: 0.41, d: 0.39, h: 0.55, shape: 'box'},
  backpack: {w: 0.33, d: 0.32, h: 0.52, shape: 'box'},
  helmet: {w: 0.23, d: 0.3, h: 0.19, shape: 'box'},
  boots: {w: 0.3, d: 0.32, h: 0.19, shape: 'box'},
  gloves: {w: 0.26, d: 0.2, h: 0.06, shape: 'flat'},
  // mask lane: the shipped zombie outfit mask's bind-pose bounds (outfit-gasmask-t25.glb Outfit_gasmask__lastshift), standing on its chin
  gas_mask: {w: 0.18, d: 0.13, h: 0.18, shape: 'box'},
  // the delivered derivative's bounds (assets/models/gear-airtank-backpack.glb: tank + frame upright, straps / belt splayed)
  airtank_backpack: {w: 0.58, d: 0.48, h: 0.72, shape: 'box'},
};

export const GEAR_IDS = Object.keys(GEAR_ITEMS);

/** Mask lane: gear that takes gas-mask filters (a `filter` charge on its stack). */
export function isFilterMask(itemId: string | null | undefined): boolean {
  return (gearSpec(itemId)?.filterLife ?? 0) > 0;
}

export function isGearItem(itemId: string | null | undefined): boolean {
  return !!itemId && itemId in GEAR_ITEMS;
}

export function gearSpec(itemId: string | null | undefined): GearSpec | null {
  return itemId ? GEAR_ITEMS[itemId]?.gear ?? null : null;
}

/** Task filter-tension-airtank-20261104-072836: gear that holds its own air (`air` on its stack): the Airtank Backpack. */
export function isAirtank(itemId: string | null | undefined): boolean {
  return (gearSpec(itemId)?.airLife ?? 0) > 0;
}

/** Backpack-type gear (has its own container). */
export function isBagItem(itemId: string | null | undefined): boolean {
  return (gearSpec(itemId)?.bagSlots ?? 0) > 0;
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)} %`;

/** One-line stat text: "armor 4 pips (10 %)", "+4 pockets", "speed +5 %", "spread −8 % · handling +8 %". */
export function gearStatText(spec: GearSpec, stack?: {armor?: number} | null): string {
  const out: string[] = [];
  // (task studio-general-armor-20261107-231448-01) pooled armour: pips (half-pip steps, rounded down) of what this item has left / when new
  if (spec.armor) {
    const left = stack?.armor === undefined ? spec.armor : Math.max(0, Math.min(spec.armor, stack.armor));
    const pips = (a: number) => { const h = Math.floor(a / 0.0125 + 1e-9), w = Math.floor(h / 2); return h % 2 ? `${w || ''}½` : `${w}`; };
    const exact = (a: number) => `${+(a * 100).toFixed(2)} %`; // 2.5 %, not a rounded 3 %
    out.push(left < spec.armor - 1e-9 ? `armor ${pips(left)} / ${pips(spec.armor)} pips (${exact(left)}, worn)` : `armor ${pips(spec.armor)} pip${spec.armor === 0.025 ? '' : 's'} (${exact(spec.armor)})`);
  }
  if (spec.pockets) out.push(`+${spec.pockets} pockets`);
  if (spec.bagSlots) out.push(`${spec.bagSlots}-slot bag (open it on the ground)`);
  if (spec.speedMult && spec.speedMult !== 1) out.push(`speed ${spec.speedMult > 1 ? '+' : '−'}${pct(spec.speedMult - 1)}`);
  if (spec.spreadMult && spec.spreadMult !== 1) out.push(`spread ${spec.spreadMult < 1 ? '−' : '+'}${pct(spec.spreadMult - 1)}`);
  if (spec.handlingMult && spec.handlingMult !== 1) out.push(`reload / use time ${spec.handlingMult < 1 ? '−' : '+'}${pct(spec.handlingMult - 1)}`);
  if (spec.filterLife) out.push(`blocks infectious gas while on (Q) with a working filter · one filter lasts ${spec.filterLife} s on the face`); // mask lane
  if (spec.airLife) out.push(`${spec.airLife / 60} min of air for the gas mask (used before its filter) · no storage · cannot be refilled`);
  return out.join(' · ');
}

/** The worn-gear modifier contribution (pure). Missing / unknown items contribute nothing. */
export function gearModifiersFor(worn: Readonly<Partial<Record<GearSlot, {itemId: string} | null>>>): Partial<PlayerModifiers> {
  let speed = 1, spread = 1, handling = 1, pockets = 0;
  for (const slot of GEAR_SLOTS) {
    const spec = gearSpec(worn[slot]?.itemId);
    if (!spec || spec.slot !== slot) continue; // an item in the wrong slot never counts
    if (spec.speedMult) speed *= spec.speedMult;
    if (spec.spreadMult) spread *= spec.spreadMult;
    if (spec.handlingMult) handling *= spec.handlingMult;
    if (spec.pockets && slot === 'chest') pockets += spec.pockets;
  }
  // (task studio-general-armor-20261107-231448-01) armour is no longer a per-frame modifier: the hit reads the worn pool at the moment of the hit (player/armor.ts)
  return {speedMult: speed, spreadMult: spread, handlingMult: handling, extraPockets: pockets};
}
