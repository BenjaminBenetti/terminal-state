// Task studio-flamethrower-fire-20261114-031614-01 (lane ASSET): the weapons whose runtime MODEL is delivered LAZILY — the weapon-variety
// identities (weapons/varietyIds.ts) + the FLAMETHROWER. One loader / one delivery serves them all (world/weaponVarietyModels.ts,
// world/weaponVarietyDelivery.ts): the model is fetched for a section that can show the weapon (carried, stored, remembered) or the
// moment a surface shows it (the held view, a world pickup, an item icon), never in the boot preload — a player who never sees one
// fetches nothing.
// The Flamethrower is NOT a weapon-variety identity: it stays out of weapons/varietyIds.ts and every find pool (items/weaponVariety.ts);
// it comes only from the train's bench or a Market gun stall. This module only widens WHICH weapon models take the lazy route.
// A leaf module (generated registries + ids only).
import {FLAMETHROWER_MODEL} from '../assets/flamethrowerModels.generated';
import {WEAPON_VARIETY_MODELS} from '../assets/weaponVarietyModels.generated';
import {FLAMETHROWER_ID} from '../fire/flamethrowerSpec';
import {VARIETY_WEAPON_IDS, isVarietyWeapon} from './varietyIds';

/** The lazily delivered weapon models that are not weapon-variety identities: item id -> its cooked registry row. */
const EXTRA_MODELS: Readonly<Record<string, {readonly url: string}>> = {[FLAMETHROWER_ID]: FLAMETHROWER_MODEL};

/** Their ids (sorted). */
export const LAZY_EXTRA_WEAPON_IDS: readonly string[] = Object.keys(EXTRA_MODELS).sort();
/** Every weapon id with a lazily delivered model: the weapon-variety identities, then the extras. */
export const LAZY_MODEL_WEAPON_IDS: readonly string[] = [...VARIETY_WEAPON_IDS, ...LAZY_EXTRA_WEAPON_IDS];

const isExtra = (id: string): boolean => Object.prototype.hasOwnProperty.call(EXTRA_MODELS, id);

/** Does `id`'s model take the lazy route (a weapon-variety identity or the Flamethrower)? */
export function isLazyModelWeapon(id: string | null | undefined): id is string {
  return !!id && (isVarietyWeapon(id) || isExtra(id));
}

/** The delivered model file of a lazily delivered weapon (null: not delivered / not one of them). */
export function lazyWeaponModelUrl(id: string): string | null {
  const m = isVarietyWeapon(id) ? WEAPON_VARIETY_MODELS[id] : isExtra(id) ? EXTRA_MODELS[id] : undefined;
  return m && typeof m.url === 'string' && m.url.length ? m.url : null;
}

/**
 * The lazily delivered weapon ids anywhere in a JSON-like value (an inventory / store / memory record: every `itemId` field) — the
 * section preload's question. A superset of items/weaponVariety.ts varietyIdsIn (which stays variety-only). Bounded depth.
 */
export function lazyWeaponIdsIn(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) lazyWeaponIdsIn(x, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'itemId' && typeof x === 'string' && isLazyModelWeapon(x)) out.add(x);
    else if (x && typeof x === 'object') lazyWeaponIdsIn(x, out, depth + 1);
  }
  return out;
}
