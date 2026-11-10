// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): WEAPON VARIETY by IDENTITY DIVERSIFICATION of the existing weapon
// finds. Task studio-weapon-poses-slot-hierarchy-20261110-064835-01 (USER, explicit new design — supersedes the old 40 % baseline /
// ~42 % same-family guns / 18 % melee split and the "same rounds per caliber" rule for NEW rolls):
//   "Categories Pistol / Rifle / Shotgun / Melee. Gun group contains pistol / rifle / shotgun, ALL gun TYPES equally likely in a Gun slot.
//    A Weapon slot is 50 % Gun / 50 % Melee. Most ordinary existing weapon locations use a Weapon slot; key gun-store locations use a Gun
//    slot instead. Existing explicit category slots must choose all types in that category." + the paired ammo MATCHES the selected gun
//   while the overall ammo scarcity stays as it is.
//
// WHAT IS AN OPPORTUNITY (unchanged): every ordinary natural weapon find = a generated LAYOUT PICKUP of a baseline gun (pistol / rifle /
// shotgun) that is not a curated reward, laid with ONE box of its own caliber at the very next layout index (gen/weaponFinds.ts
// WEAPON_FIND_AMMO) by its producer:
//  - gen/weaponFinds.ts placeWeaponFinds: the Subway station, the Bunker, Skyways (incl. its legacy layouts) and the Reactor;
//  - gen/office/spawns.ts placeOfficeWeapons: the Office storeys;
//  - gen/mall/shopsWeapons.ts placeMallWeapons: the Mall gun shops' bench / rack / floor stock.
// Never one: the Office roof find (`reward`: curated, unchanged), the starter kit, market vendor stock (market/trade/stock.ts: paid
// merchant inventory, untouched) and NPC loadouts. No loot table holds a gun and the Survivor Market places none. The COUNT and the
// origins (layout index, position, support) of the opportunities are the generators' and never change here.
//
// THE SLOT of an opportunity (slotKindOf): a find in a GUN STORE — an area whose purpose / type carries the `guns` tag (the Mall's
// `mall-guns` shop programme on any level that builds it; the Skywalk's store pool has none) — is a GUN slot; every other ordinary find
// is a WEAPON slot. The rows (slotRows):
//   WEAPON  : 50 % gun (each of the 9 guns 1/18) + 50 % melee (each of the 7 melee weapons 1/14, the knife included)
//   GUN     : each of the 9 guns 1/9            (pistol / Hornet / Longslide · rifle / Stub / Overwatch · shotgun / Coach Gun / Thresher)
//   PISTOL / RIFLE / SHOTGUN : each of its 3 guns 1/3        MELEE : each of the 7 melee weapons 1/7
// (No generator lays an explicit category slot today; the kinds exist so one can be declared without a second rule.) The source family
// no longer constrains the choice, and there is no context lean: an ordinary slot on any level can realize any of its leaves.
//
// THE CHOICE: ONCE, at FIRST realization (game.ts buildSection's first spawn, memory pickups === null), from a stable hash of the
// opportunity's origin (section id + layout index + the rolled baseline, seeded by the layout seed — no RNG stream: every other draw,
// yaw, lot and position is identical). Eligibility reads the DELIVERED catalogue (identityAvailable: WeaponDef + item + delivered model
// registry), never the loaded-model cache, so what a station realizes never depends on what happens to be loaded. Nothing re-selects on
// a load failure, a UI update, a save or a revisit.
//
// PHYSICAL FIT (no hidden fallback to the old gun): a floor find stands on a cell with a clear 1-cell ring (every producer), so any
// weapon up to 1.25 m lies there in any orientation; only its paired box can be in the way, so a weapon whose half-length (+ the box's
// clearance) reaches the box is laid PERPENDICULAR to the box direction (`yaw` of the change; same spot, legal orientation). A find on a
// display host (a gun-shop bench / rack: its own yaw) only offers leaves no longer than the host top (HOST_MAX_M: every gun fits; a
// Weapon slot on a host would lose only the 1.25 m Track Shovel) — an explicit restriction of that slot, never a retry to the default.
//
// AMMO MATCHES THE SELECTED GUN, budget preserved (user-approved): every find's bundle (the rounds its baseline gun loads + its paired box)
// is measured against its FAMILY'S STANDARD BUNDLE (AMMO_BUNDLE: pistol 15 loaded + 15 boxed 9 mm, rifle 30 + 20 of 5.56, shotgun 6 + 6
// shells) -> its budget `u` (1.0 for every generated find). A GUN result of caliber c gets T = round(u x the standard total of c) rounds
// of ITS OWN caliber: loaded = min(its magazine, round(T x the standard loaded fraction of c)), the rest in the paired box (the box keeps
// its spot; at least 1 round stays in the box while any are loaded beyond 1). So a find is always worth one standard bundle in whatever
// caliber it became (never 30 rifle rounds turned into 30 shells). A MELEE result has no gun: the paired box keeps the source caliber and
// takes the whole source bundle (box + the loaded rounds). Rounding: half up (Math.round). Standalone ammo rows and every other pickup
// are untouched.
//
// PERSISTENCE: a realized find is an ordinary layout pickup — run memory records its full stack (item, count, mag), so a revisit / save
// restores EXACTLY what it was; a remembered pickup list (any save, old or new) is never realized again (no conversion, reroll or
// migration). The new rules reach every section whose pickups were never realized, including the unvisited areas of an old campaign.
// The food-half gate and every non-weapon origin are untouched.
import {hashString} from '../core/rng';
import {ITEMS} from './items';
import {ammoItemFor, type Caliber} from './calibers';
import {WEAPONS} from '../weapons/weapons';
import {VARIETY_MELEE_IDS, isVarietyWeapon, type VarietyWeaponId} from '../weapons/varietyIds';
import {WEAPON_VARIETY_MODELS} from '../assets/weaponVarietyModels.generated';
import {WEAPON_FIND_AMMO} from '../gen/weaponFinds';
import type {Area, PickupPlacement, StationLayout} from '../gen/stationTypes';

/** The baseline guns the generators lay as weapon finds (the opportunities' source families; the knife is never LAID, but a slot can realize it). */
export type BaselineGun = 'pistol' | 'rifle' | 'shotgun';
export const BASELINE_GUNS: readonly BaselineGun[] = ['pistol', 'rifle', 'shotgun'];

/**
 * Real overall lengths (m) of the twelve approved weapons (the cook lane's target lengths: lane plan "Real lengths"): the fit rule reads
 * these fixed numbers, never the cooked bounds, so a re-cook never moves an unrecorded pick.
 */
export const VARIETY_LENGTH_M: Readonly<Record<VarietyWeaponId, number>> = {
  hornet: 0.62, longslide: 0.27, stub: 0.70, overwatch: 1.05, coach_gun: 0.95, thresher: 1.00,
  fire_axe: 0.90, machete: 0.62, sledgehammer: 0.92, crowbar: 0.76, slugger: 0.84, track_shovel: 1.25,
};
/** Half-size (m) of an ammo box on the floor: a weapon's half-length + this must stay short of its paired box. */
export const BOX_CLEAR_M = 0.08;
/**
 * The longest weapon that lies on a display host (a find with its own yaw: the mall gun shop's 1.4 m display bench, the gun lying 0.15 m
 * left of its centre — gen/mall/shopsWeapons.ts — leaves 2 x (0.70 - 0.15) = 1.1 m of top; the gun rack's cradle shelf has more).
 */
export const HOST_MAX_M = 1.1;

/** The family of a baseline gun id (null: not an opportunity's item). */
export const familyOf = (itemId: string): BaselineGun | null => ((BASELINE_GUNS as readonly string[]).includes(itemId) ? itemId as BaselineGun : null);

/** Is this identity playable in this build: its WeaponDef exists and (a variety weapon) its model is delivered. */
export function identityAvailable(id: string): boolean {
  if (!WEAPONS[id] || !ITEMS[id]) return false;
  return !isVarietyWeapon(id) || !!WEAPON_VARIETY_MODELS[id];
}

/** The nine guns by category (catalogue order) and the seven melee weapons (the starter knife + the six new ones). */
export const GUN_CATEGORIES = {
  pistol: ['pistol', 'hornet', 'longslide'],
  rifle: ['rifle', 'stub', 'overwatch'],
  shotgun: ['shotgun', 'coach_gun', 'thresher'],
} as const satisfies Readonly<Record<BaselineGun, readonly string[]>>;
export const GUN_LEAVES: readonly string[] = [...GUN_CATEGORIES.pistol, ...GUN_CATEGORIES.rifle, ...GUN_CATEGORIES.shotgun];
export const MELEE_LEAVES: readonly string[] = ['knife', ...VARIETY_MELEE_IDS];

/** The slot kinds (see the header). */
export type SlotKind = 'weapon' | 'gun' | BaselineGun | 'melee';
/** A Weapon slot's split between its two groups (user: 50 % gun / 50 % melee). */
export const WEAPON_SLOT_SPLIT = {gun: 0.5, melee: 0.5} as const;

/** The leaves of a slot kind with their probabilities (uniform inside each group; each kind sums to 1). */
export function slotRows(kind: SlotKind): [string, number][] {
  const even = (ids: readonly string[], total: number) => ids.map(id => [id, total / ids.length] as [string, number]);
  if (kind === 'weapon') return [...even(GUN_LEAVES, WEAPON_SLOT_SPLIT.gun), ...even(MELEE_LEAVES, WEAPON_SLOT_SPLIT.melee)];
  if (kind === 'gun') return even(GUN_LEAVES, 1);
  if (kind === 'melee') return even(MELEE_LEAVES, 1);
  return even(GUN_CATEGORIES[kind], 1);
}

/** Is an area a GUN STORE (its purpose / type carries the `guns` tag: the Mall's `mall-guns` shop, on any level that builds one)? */
export function isGunStoreArea(a: Pick<Area, 'purpose' | 'type'> | undefined): boolean {
  return !!a && [a.purpose, a.type].some(t => typeof t === 'string' && /(^|-)guns(-|$)/.test(t));
}

/** The slot kind of an opportunity: a gun store's find is a GUN slot, every other ordinary find a WEAPON slot. */
export function slotKindOf(area: Pick<Area, 'purpose' | 'type'> | undefined): SlotKind {
  return isGunStoreArea(area) ? 'gun' : 'weapon';
}

/** The length (m) a weapon lies over: the approved real length of a new one, the baseline's view length otherwise. */
export function weaponLength(id: string): number {
  return isVarietyWeapon(id) ? VARIETY_LENGTH_M[id] : WEAPONS[id]?.view.length ?? 0;
}

/**
 * THE STANDARD BUNDLE of each family (the rounds its find loads + its paired box: WeaponDef.magazine + WEAPON_FIND_AMMO), and per caliber
 * (each family owns one of the three calibers): the normalization of the ammo rule (see the header).
 */
export function familyBundle(f: BaselineGun): {caliber: Caliber; loaded: number; box: number; total: number} {
  const loaded = WEAPONS[f].magazine, box = WEAPON_FIND_AMMO[f][1];
  return {caliber: WEAPONS[f].caliber!, loaded, box, total: loaded + box};
}
export function caliberBundle(c: Caliber): {family: BaselineGun; total: number; loadedFrac: number} {
  const f = BASELINE_GUNS.find(g => WEAPONS[g].caliber === c)!;
  const b = familyBundle(f);
  return {family: f, total: b.total, loadedFrac: b.loaded / b.total};
}

/**
 * The ammo a GUN result of caliber `c` (magazine `cap`) carries for a source bundle worth `u` standard bundles: T = round(u x the
 * standard total of c); loaded = min(cap, round(T x the standard loaded fraction of c)); box = T - loaded (at least 1 while loaded > 1).
 */
export function gunAmmo(c: Caliber, cap: number, u: number): {loaded: number; box: number} {
  const std = caliberBundle(c);
  const T = Math.max(0, Math.round(u * std.total));
  let loaded = Math.min(cap, Math.round(T * std.loadedFrac), T);
  if (T - loaded < 1 && loaded > 1) loaded--;
  return {loaded, box: T - loaded};
}

/** Uniform [0, 1) of a stable identity (FNV-1a + a murmur3 finalizer; its own key prefix, independent of the food gates / variety). */
function unit(identity: string, seed: number): number {
  let h = hashString(`weapon-variety|${identity}`, seed >>> 0);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A weighted pick at u in [0, 1) over the FULL rows (an ineligible pick is the caller's business: it stays the baseline). */
function pickAt(rows: readonly [string, number][], u: number): string {
  const total = rows.reduce((s, [, w]) => s + w, 0);
  let x = u * total;
  for (const [id, w] of rows) { x -= w; if (x < 0) return id; }
  return rows[rows.length - 1][0];
}

/** The origin of a layout pickup opportunity (section id + layout index + its rolled baseline). */
export const findOrigin = (section: string, layoutIndex: number, baseline: string): string => `${section}|pickup:${layoutIndex}|${baseline}`;

/** The paired ammo box of a weapon find: the very next layout pickup, its family's caliber box, same storey, nearby, not curated. */
export function pairedBox(pickups: readonly PickupPlacement[], i: number): number | null {
  const p = pickups[i], q = pickups[i + 1], pair = p ? WEAPON_FIND_AMMO[p.itemId] : undefined;
  if (!p || !q || !pair || q.itemId !== pair[0] || q.reward || (q.level ?? 0) !== (p.level ?? 0) || Math.hypot(q.x - p.x, q.z - p.z) > 5) return null;
  return i + 1;
}

/** One weapon find opportunity and what it realizes as. */
export interface WeaponFind {
  /** layout.pickups index of the weapon. */
  index: number;
  /** Its slot kind (gun store: 'gun'; otherwise 'weapon'). */
  slot: SlotKind;
  /** The baseline gun the generator laid (the source family). */
  family: BaselineGun;
  /** The realized identity. */
  itemId: string;
  /** The leaf the hash picked (equals itemId: there is no fallback; kept for QA). */
  picked: string;
  /** Rounds the original find loads (the baseline's full magazine) and the realized weapon's loaded rounds (0 for melee). */
  original: number;
  mag: number;
  /** The paired box's layout index (null: none) and its item / count before and after. */
  box: number | null;
  boxBefore: number;
  boxAfter: number;
  boxItemBefore: string | null;
  boxItemAfter: string | null;
  /** The source bundle in standard bundles (1.0 for every generated find). */
  budget: number;
  /** The yaw it lies at when the plan sets one (a long weapon laid across its box's direction); undefined = the usual yaw. */
  yaw?: number;
}

export interface WeaponFindPlan {
  finds: WeaponFind[];
  /** Stacks that differ from a plain first spawn (layout index -> item / count / loaded rounds / yaw). */
  changes: Map<number, {itemId: string; count: number; mag?: number; yaw?: number}>;
}

export interface WeaponFindOptions {
  /** Which identities this build can realize (default identityAvailable: def + delivered model). */
  available?: (id: string) => boolean;
}

/**
 * The FIRST-REALIZATION plan of a generated layout's weapon finds (see the header). Pure and deterministic: (layout, level, section) ->
 * the same plan. `section` = the section id (levels/types.ts sectionId; the run memory's id). `level` is not used by the rules (no level
 * gate); it stays in the signature for its callers.
 */
export function weaponFindPlan(layout: Pick<StationLayout, 'seed' | 'pickups' | 'areas'>, _level: string, section: string, o: WeaponFindOptions = {}): WeaponFindPlan {
  const available = o.available ?? identityAvailable;
  const finds: WeaponFind[] = [];
  const changes = new Map<number, {itemId: string; count: number; mag?: number; yaw?: number}>();
  layout.pickups.forEach((p, i) => {
    const family = familyOf(p.itemId);
    if (!family || p.reward || ITEMS[p.itemId]?.kind !== 'weapon') return;
    const base = WEAPONS[family];
    if (!base) return;
    const original = base.magazine;
    const box = pairedBox(layout.pickups, i);
    const bp = box !== null ? layout.pickups[box] : null;
    const boxBefore = bp?.count ?? 0;
    const slot = slotKindOf(layout.areas[p.area]);
    const hosted = p.yaw !== undefined;
    const budget = (original + boxBefore) / familyBundle(family).total;
    // the slot's leaves this find can take: delivered (def + item + model), short enough for a display host; without a paired box only a
    // gun of the source caliber that loads every original round (nothing to move the rest into — no generated find lacks its box)
    const leafOk = (id: string): boolean => {
      if (!available(id) || !WEAPONS[id] || !ITEMS[id]) return false;
      if (hosted && weaponLength(id) > HOST_MAX_M) return false;
      if (!bp) { const w = WEAPONS[id]; return !w.melee && w.caliber === base.caliber && w.magazine >= original; }
      return true;
    };
    const rows = slotRows(slot).filter(([id]) => leafOk(id));
    const picked = rows.length ? pickAt(rows, unit(findOrigin(section, i, p.itemId), layout.seed)) : family;
    const itemId = picked;
    const w = WEAPONS[itemId];
    let mag: number, boxAfter = boxBefore, boxItemAfter = bp?.itemId ?? null;
    if (w.melee) { mag = 0; boxAfter = boxBefore + original; }
    else if (!bp) mag = Math.min(original, w.magazine);
    else { const a = gunAmmo(w.caliber!, w.magazine, budget); mag = a.loaded; boxAfter = a.box; boxItemAfter = ammoItemFor(w.caliber!); }
    // a long weapon on the floor whose half-length (+ the box's clearance) would reach its box lies across the box's direction
    let yaw: number | undefined;
    if (!hosted && bp && weaponLength(itemId) / 2 + BOX_CLEAR_M > Math.hypot(bp.x - p.x, bp.z - p.z)) yaw = Math.atan2(bp.x - p.x, bp.z - p.z);
    finds.push({index: i, slot, family, itemId, picked, original, mag, box, boxBefore, boxAfter, boxItemBefore: bp?.itemId ?? null, boxItemAfter, budget, ...(yaw !== undefined ? {yaw} : {})});
    if (itemId !== family || mag !== original || yaw !== undefined) changes.set(i, {itemId, count: p.count, mag, ...(yaw !== undefined ? {yaw} : {})});
    if (bp && box !== null && (boxItemAfter !== bp.itemId || boxAfter !== boxBefore)) changes.set(box, {itemId: boxItemAfter!, count: boxAfter});
  });
  return {finds, changes};
}

/** The variety weapons a section's FIRST spawn realizes (its model loader preloads them behind the loading screen). */
export function plannedVarietyIds(layout: Pick<StationLayout, 'seed' | 'pickups' | 'areas'>, level: string, section: string, o: WeaponFindOptions = {}): VarietyWeaponId[] {
  const out = new Set<VarietyWeaponId>();
  for (const f of weaponFindPlan(layout, level, section, o).finds) if (isVarietyWeapon(f.itemId)) out.add(f.itemId);
  return [...out].sort();
}

/** Variety weapon ids anywhere in a JSON-like value (an inventory / store / memory record: every `itemId` field). Bounded depth. */
export function varietyIdsIn(v: unknown, out: Set<VarietyWeaponId> = new Set(), depth = 0): Set<VarietyWeaponId> {
  if (depth > 12 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v) varietyIdsIn(x, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === 'itemId' && typeof x === 'string' && isVarietyWeapon(x)) out.add(x);
    else if (x && typeof x === 'object') varietyIdsIn(x, out, depth + 1);
  }
  return out;
}
