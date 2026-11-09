// Task studio-weapon-variety-production-20261109-224355-01 (lane LOOT-UI): WEAPON VARIETY by IDENTITY DIVERSIFICATION of the existing weapon
// finds (the lead's loot decision: "same weapon find count, more identities"). User HARD constraints: the same weapon find rate, the same
// ammo supply, existing saves / recorded loot exact.
//
// WHAT IS AN OPPORTUNITY: every ordinary natural weapon find = a generated LAYOUT PICKUP of a baseline gun (pistol / rifle / shotgun) that is
// not a curated reward. The survey (tests/weapon-variety-loot.test.ts census) finds exactly these producers, each laying the gun and then,
// at the very next layout index, ONE box of its own caliber (gen/weaponFinds.ts WEAPON_FIND_AMMO):
//  - gen/weaponFinds.ts placeWeaponFinds: the Subway station, the Bunker, Skyways (incl. its legacy layouts) and the Reactor;
//  - gen/office/spawns.ts placeOfficeWeapons (officeWeaponPlan): the Office storeys;
//  - gen/mall/shopsWeapons.ts placeMallWeapons: the mall gun shops' bench / rack / floor stock (the only pistol-family finds).
// Never one: the Office roof find (`reward`: curated, unchanged), the starter kit, market vendor stock (market/trade/stock.ts keeps its
// baseline weapon rows) and NPC loadouts. No loot table holds a gun (items/lootTables.ts: "never guns"), the Survivor Market places none.
//
// THE CHOICE (at FIRST realization: game.ts buildSection's first spawn, memory pickups === null): a stable hash of the opportunity's origin
// (section id + layout index + the rolled baseline, seeded by the layout seed — no RNG stream, so every other draw, yaw, lot and position is
// identical) picks one identity of its FAMILY (WEAPON_VARIETY_FAMILIES: pistol -> pistol / hornet / longslide, rifle -> rifle / stub /
// overwatch, shotgun -> shotgun / coach_gun / thresher; the baseline stays the most common) or, with MELEE_SHARE (<= 25 %), one of the six
// melee weapons (there is no natural melee find anywhere else). The melee pick leans by place (a track shovel in a workshop, a machete in a
// gun shop ...). An identity is ELIGIBLE only when it is playable and fits: its WeaponDef exists (weapons/weapons.ts WEAPONS), its model
// is delivered (assets/weaponVarietyModels.generated.ts: no primitive stand-in is ever shown), its length fits the spot (not into the paired
// box, not past a display bench), and the rounds rule below can be kept exactly. A pick that is not eligible stays the BASELINE find (an
// undelivered weapon simply leaves today's find in place; every other opportunity keeps its own pick).
//
// ROUNDS ARE NEVER MINTED (or lost): the original find loads its baseline's full magazine (Inventory.makeStack). A realized gun loads
// min(those rounds, its own capacity) — the coach gun at most 2 — and the rounds that no longer fit (all of them for a melee identity) go
// into the PAIRED ammo box (the same caliber item, its count + the rest: the supply stays exact). The find count stays the same: one
// opportunity = one weapon item, always.
//
// PERSISTENCE: a realized find is an ordinary layout pickup — run memory records its full stack (item, count, mag: run/worldMemory.ts
// capturePickups), so a revisit / save restores EXACTLY what it was; a remembered pickup list (any save, old or new) is never realized again
// (no conversion, reroll or migration). New identities appear only in sections whose pickups were never realized (including the unvisited
// areas of an old campaign). The food-half gate and every non-weapon origin are untouched. No lot / pickup id encoding is needed.
import {hashString} from '../core/rng';
import {ITEMS} from './items';
import {WEAPONS} from '../weapons/weapons';
import {VARIETY_MELEE_IDS, isVarietyWeapon, type VarietyMeleeId, type VarietyWeaponId} from '../weapons/varietyIds';
import {WEAPON_VARIETY_MODELS} from '../assets/weaponVarietyModels.generated';
import {WEAPON_FIND_AMMO} from '../gen/weaponFinds';
import type {PickupPlacement, StationLayout} from '../gen/stationTypes';

/** The baseline guns whose finds are opportunities (the knife is never a natural find). */
export type BaselineGun = 'pistol' | 'rifle' | 'shotgun';
export const BASELINE_GUNS: readonly BaselineGun[] = ['pistol', 'rifle', 'shotgun'];

/**
 * The GUN identities of each family and their shares of that family's opportunities (the baseline stays the most common). The rest of each
 * family's opportunities, MELEE_SHARE, go to the melee weapons. Shares sum to 1 per family.
 */
export const WEAPON_VARIETY_FAMILIES: Readonly<Record<BaselineGun, Readonly<Record<string, number>>>> = {
  pistol: {pistol: 0.40, hornet: 0.20, longslide: 0.22},
  rifle: {rifle: 0.40, stub: 0.23, overwatch: 0.19},
  shotgun: {shotgun: 0.40, coach_gun: 0.23, thresher: 0.19},
};
/** The melee weapons' share of every family's opportunities (modest: <= 25 %). */
export const MELEE_SHARE = 0.18;
/** Base weights of the six melee weapons inside MELEE_SHARE (before the place leans). */
export const MELEE_BASE: Readonly<Record<VarietyMeleeId, number>> = {fire_axe: 1, machete: 1, sledgehammer: 0.8, crowbar: 1.2, slugger: 0.9, track_shovel: 1};

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

/** Context of an opportunity for the melee leans: the logical level and the area's purpose / type, `host` = it lies on a display host. */
export interface FindContext { level: string; place: string; host: boolean }

/** Place LEANS on the melee weights (multipliers; the family shares themselves never lean). */
function meleeLean(id: VarietyMeleeId, c: FindContext): number {
  const p = c.place, L = c.level;
  const has = (...k: string[]) => k.some(s => p.includes(s));
  let k = 1;
  if (id === 'track_shovel') {
    if (L === 'subway' || L === 'bunker' || L === 'reactor') k *= 1.5; // rail / shelter / plant maintenance
    if (has('workshop', 'storage', 'platform', 'service', 'pump', 'utility')) k *= 1.5;
    if (L === 'mall' || L === 'skyways') k *= 0.4;
  }
  if (id === 'crowbar' && has('workshop', 'storage', 'stock', 'service', 'utility', 'custodial', 'janitor')) k *= 1.5;
  if (id === 'sledgehammer' && has('workshop', 'pump', 'electrical', 'storage', 'utility')) k *= 1.4;
  if (id === 'fire_axe') {
    if (has('security', 'agent', 'control', 'office')) k *= 1.3;
    if (L === 'reactor' || L === 'office') k *= 1.3;
  }
  if (id === 'machete') {
    if (has('guns')) k *= 2; // the gun shop's outdoors / blade shelf
    if (L === 'skyways') k *= 1.2;
  }
  if (id === 'slugger') {
    if (has('locker', 'staff', 'crew', 'break')) k *= 1.5;
    if (L === 'mall') k *= 1.3;
  }
  return k;
}

/** The weighted identity rows of an opportunity in context: the family's guns, then the melee weapons inside MELEE_SHARE (sum 1). */
export function identityRows(family: BaselineGun, c: FindContext): [string, number][] {
  const guns = Object.entries(WEAPON_VARIETY_FAMILIES[family]);
  const mel = VARIETY_MELEE_IDS.map(id => [id, MELEE_BASE[id] * meleeLean(id, c)] as [string, number]).filter(([, w]) => w > 0);
  const total = mel.reduce((s, [, w]) => s + w, 0);
  return [...guns, ...(total > 0 ? mel.map(([id, w]) => [id, MELEE_SHARE * w / total] as [string, number]) : [])];
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
  family: BaselineGun;
  /** The realized identity (the baseline when the pick stayed). */
  itemId: string;
  /** The identity the hash picked (before the eligibility rule: itemId differs when it was not eligible). */
  picked: string;
  /** Rounds the original find loads (the baseline's full magazine) and the realized weapon's loaded rounds. */
  original: number;
  mag: number;
  /** The paired box's layout index (null: none) and its count before / after the rounds that did not fit. */
  box: number | null;
  boxBefore: number;
  boxAfter: number;
}

export interface WeaponFindPlan {
  finds: WeaponFind[];
  /** Stacks that differ from a plain first spawn (layout index -> item / count / loaded rounds). */
  changes: Map<number, {itemId: string; count: number; mag?: number}>;
}

export interface WeaponFindOptions {
  /** Which identities this build can realize (default identityAvailable: def + delivered model). */
  available?: (id: string) => boolean;
}

/**
 * The FIRST-REALIZATION plan of a generated layout's weapon finds (see the header). Pure and deterministic: (layout, level, section) ->
 * the same plan. `section` = the section id (levels/types.ts sectionId; the run memory's id).
 */
export function weaponFindPlan(layout: Pick<StationLayout, 'seed' | 'pickups' | 'areas'>, level: string, section: string, o: WeaponFindOptions = {}): WeaponFindPlan {
  const available = o.available ?? identityAvailable;
  const finds: WeaponFind[] = [];
  const changes = new Map<number, {itemId: string; count: number; mag?: number}>();
  layout.pickups.forEach((p, i) => {
    const family = familyOf(p.itemId);
    if (!family || p.reward || ITEMS[p.itemId]?.kind !== 'weapon') return;
    const base = WEAPONS[family];
    if (!base) return;
    const original = base.magazine;
    const box = pairedBox(layout.pickups, i);
    const bp = box !== null ? layout.pickups[box] : null;
    const boxMax = bp ? ITEMS[bp.itemId]?.stackMax ?? 0 : 0;
    const area = layout.areas[p.area];
    const ctx: FindContext = {level, place: `${area?.purpose ?? ''}|${area?.type ?? ''}`, host: p.yaw !== undefined};
    const picked = pickAt(identityRows(family, ctx), unit(findOrigin(section, i, p.itemId), layout.seed));
    const baseLen = base.view.length;
    const ok = (id: string): {mag: number; moved: number} | null => {
      if (id === family) return {mag: original, moved: 0};
      if (!isVarietyWeapon(id) || !available(id)) return null;
      const w = WEAPONS[id];
      if (!w) return null;
      // the caliber / ammo rule: a gun of the family's own caliber, or a melee weapon (no rounds at all)
      if (!w.melee && w.caliber !== base.caliber) return null;
      const L = VARIETY_LENGTH_M[id];
      if (L > baseLen) {
        if (bp && L / 2 + BOX_CLEAR_M > Math.hypot(bp.x - p.x, bp.z - p.z)) return null; // would lie into its own box
        if (ctx.host && L > HOST_MAX_M) return null; // past the display bench
      }
      const mag = w.melee ? 0 : Math.max(0, Math.min(original, w.magazine));
      const moved = original - mag;
      if (moved > 0 && (!bp || bp.count + moved > boxMax)) return null; // the rounds must go into the paired box, exactly
      return {mag, moved};
    };
    const r = ok(picked);
    const itemId = r ? picked : family;
    const {mag, moved} = r ?? {mag: original, moved: 0};
    const boxBefore = bp?.count ?? 0, boxAfter = boxBefore + moved;
    finds.push({index: i, family, itemId, picked, original, mag, box, boxBefore, boxAfter});
    if (itemId !== family) changes.set(i, {itemId, count: p.count, mag});
    if (moved > 0 && bp && box !== null) changes.set(box, {itemId: bp.itemId, count: boxAfter});
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
