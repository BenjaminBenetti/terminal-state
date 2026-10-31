// Iteration 12 (LOOT lane): the SCARCE-RESOURCE ECONOMY. Pure data / logic (no three.js), unit-tested in Node.
//
// User (iteration 12): "currently the station is packed with resource. Reduce resource amount to about 20% of current level. On
// all resource, except ammo, the game is about shooting things after all!" and "resource placement makes more sense, try to make
// sure resources spawn in rooms that fit that resource. I.e. a security office has ammo, ect. This is not 100% a hard rule, there
// should still be random ammo and such".
//
// How a holder's contents are decided (items/loot.ts rollHolderLots, per holder, deterministic per station seed + holder index):
//  1. The holder's ORIGINAL table roll is made exactly as before (same RNG stream, same tables): every AMMO entry it rolls is
//     kept as rolled — ammo has its own unchanged roll, so fewer finds never mean less ammo.
//  2. Each original NON-AMMO entry survives with probability THEME_ECONOMY[theme].keep (~1 in 5; own RNG stream `:scarce`).
//     Everything else is gone: most holders are now empty ("searched — empty"), which is intended.
//  3. Each survivor is a FIND whose category follows the place's theme (gen/purposes.ts `theme`, else THEME_OF_TYPE; trash bins
//     are always 'public' = random):
//       - with probability `on` (0.75-0.8) an ON-THEME find: the rolled item itself when it already fits the theme (a pharmacy
//         shelf's bandage stays a bandage), else a category drawn from the theme's `weights` (a security cabinet's old cola
//         becomes a box of ammo (any caliber) / a flare / a torch battery; a maintenance shelf's old water becomes a battery or a flare);
//       - otherwise an OFF-THEME random find: a category from OFF_THEME_WEIGHTS that is NOT on-theme (food in a security office,
//         a bandage or a handful of rounds in a café, ...) — the "not 100 % a hard rule" part. Ammo is never excluded anywhere.
//     The item of a category comes from the holder's OWN rows when it has any (a store's stock still matches its sign), else
//     from GLOBAL_POOL. HOLDER_ALLOW keeps fixtures plausible (a drinks cooler only ever holds drinks, a first-aid cabinet
//     dressings, a gun locker no food); when nothing allowed fits, the rolled item stays. Off-theme ammo is a handful of rounds.
//     Measured over the 18-station corpus: ~16-18 % of all finds in themed rooms are off-theme.
//  4. Loose floor supplies (gen/stationDress.ts placeSpawns): ammo boxes unchanged; each old loose dressing / first-aid kit
//     survives with FLOOR_ECONOMY.medKeep; plus one torch battery (always) and sometimes a flare, dropped in service / security
//     rooms first (FLOOR_ECONOMY.themeWeight).
// Weapon finds (gen/weaponFinds.ts) are untouched. Contents are rolled once and never rerolled or replenished.
// The corpus numbers (baseline d632ce8 vs now) are in reference/tasks/atmosphere-light-survival-20261028/loot/economy.json.

// Task loot-tables-20261030 (lane LOOT): the DATA (themes, pools, eligibility, limb shares, floor economy) moved to
// items/lootTables.ts and is re-exported here as the SAME objects; this module keeps the logic. Every function takes the logical
// level's loot profile (FindContext.profile; default: the level-agnostic baseline = today's tables, no overrides).

import {purposeById, type LootTheme} from '../gen/purposes';
import {ITEMS} from './items';
import {
  BASELINE_PROFILE, BATTERY_ID, ECON_CATS, FLARE_ID, HOLDER_ALLOW, HP_MED, RANDOM_HOLDERS, THEME_OF_TYPE, catWeight, econCat, keepChance, resolveRows,
  type EconCat, type ItemRows, type LootProfile,
} from './lootTables';
import {CONTAINER_THEMED, type LootSpec, type SalvageRule} from './lootTables'; // Task track3-eaton-centre-20261031 (lane PROFILES): salvage (+ LootSpec: round 2 lane CACHE)

export type {LootTheme};
export type {EconCat, ThemeEconomy} from './lootTables';
export {
  BATTERY_ID, ECON_CATS, FLARE_ID, FLOOR_ECONOMY, GLOBAL_POOL, HANDFUL, HOLDER_ALLOW, HP_MED, LIMB_ECONOMY, OFF_THEME_WEIGHTS, RANDOM_HOLDERS,
  THEME_ECONOMY, THEME_OF_TYPE, econCat,
} from './lootTables';

/** Category offered at all (battery / flare only once the light lane's items exist in items/items.ts). */
export function catAvailable(c: EconCat): boolean {
  return c === 'battery' ? BATTERY_ID in ITEMS : c === 'flare' ? FLARE_ID in ITEMS : true;
}

// ---------------------------------------------------------------------------------------
// Themes

/** Loot theme of a holder's area key (purpose id when the area / prop has one, else its room type). */
export function lootTheme(areaKey: string): LootTheme {
  return purposeById(areaKey)?.theme ?? THEME_OF_TYPE[areaKey] ?? 'public';
}

/** Theme a holder's finds follow: its area's, except junk holders (random, like a public hall). */
export function holderTheme(kind: string, areaKey: string): LootTheme {
  return RANDOM_HOLDERS.has(kind) ? 'public' : lootTheme(areaKey);
}

// ---------------------------------------------------------------------------------------
// Task track3-eaton-centre-20261031 (lane PROFILES): SALVAGE (lootTables SalvageRule / LootTables.salvage) — crafting-material rows a
// level adds to the own / purpose tables of a themed place. Absent in every shipped level's tables: withSalvage returns the very
// same row array, so Subway / Office draws are byte-identical.

/**
 * The salvage rule a holder gets under `profile` (undefined: none): the purpose entry of its loot key, else its loot theme's entry.
 * Never for junk holders (RANDOM_HOLDERS), container-themed storage (the container decides: CONTAINER_THEMED) or holders that may
 * not hold crafting materials (HOLDER_ALLOW).
 */
export function salvageRule(profile: LootProfile, kind: string, areaKey: string): SalvageRule | undefined {
  const sv = profile.tables.salvage;
  if (!sv || RANDOM_HOLDERS.has(kind) || CONTAINER_THEMED.has(kind)) return undefined;
  const allow = HOLDER_ALLOW[kind];
  if (allow && !allow.includes('material')) return undefined;
  // task studio-alpha-track2-round2-20261031-01 (lane CACHE, R5): a table that opts out (LootSpec.salvage false: the annex survivor
  // caches) never takes the level's salvage rows
  const own = purposeById(areaKey)?.loot as Partial<Record<string, LootSpec>> | undefined;
  if ((own?.[kind] ?? own?.default)?.salvage === false) return undefined;
  return sv.purposes?.[areaKey] ?? sv.themes?.[lootTheme(areaKey)];
}

/**
 * A holder's resolved rows with its salvage rows appended (the SAME array when it has no rule or an empty table): each salvage row
 * weighs share / (1 − share) × Σ(rows) × its share of the salvage mix, then the profile's item / category weight overrides
 * (resolveRows) — so before overrides a lot is salvage with probability `share`.
 */
export function withSalvage(profile: LootProfile, kind: string, areaKey: string, rows: ItemRows): ItemRows {
  const rule = salvageRule(profile, kind, areaKey);
  if (!rule || !rows.length) return rows;
  const total = rows.reduce((s, r) => s + r[1], 0), mix = rule.rows.reduce((s, r) => s + r[1], 0);
  if (!(total > 0) || !(mix > 0)) return rows;
  const scale = rule.share / (1 - rule.share) * total / mix;
  const extra = resolveRows(profile, rule.rows.map(([id, w]) => [id, w * scale] as const)).filter(r => r[1] > 0);
  return extra.length ? [...rows, ...extra] : rows;
}

function allowedCats(kind: string): EconCat[] {
  return (HOLDER_ALLOW[kind] ?? ECON_CATS).filter(catAvailable);
}

type Row = readonly [string, number];
type Rnd = () => number;
interface Entry { itemId: string; count: number }
/** A holder entry after the economy: `roll` = the holder's original ammo roll (exempt), `find` = a scarce (re-themed) find. */
export interface Find extends Entry { source: 'roll' | 'find' }

function pickRow<T>(rows: readonly (readonly [T, number])[], r: Rnd): T {
  const total = rows.reduce((s, row) => s + row[1], 0);
  let x = r() * total;
  for (const row of rows) { x -= row[1]; if (x < 0) return row[0]; }
  return rows[rows.length - 1][0];
}

const range = (r: Rnd, [a, b]: readonly [number, number]) => a + Math.floor(r() * (b - a + 1));

export interface FindContext {
  /** Holder kind (items/loot.ts HolderKind). */
  kind: string;
  /** Purpose id / room type (the holder's loot key). */
  areaKey: string;
  /** The holder's own weighted item rows (its table, already resolved under the profile). */
  rows: readonly Row[];
  /** Full-box count of an ammo item for this holder (items/loot.ts lotCount: lootTables BOX_COUNT). */
  boxCount: (itemId: string, r: Rnd) => number;
  /** Task loot-tables-20261030 (lane LOOT): the logical level's loot profile (default: baseline). */
  profile?: LootProfile;
}

/** Item of category `c`: from the holder's own rows of that category when it has any, else the global pool (null: none left). */
function itemOf(c: EconCat, ctx: FindContext, r: Rnd, security: boolean, P: LootProfile): string | null {
  const own = ctx.rows.filter(([id, w]) => w > 0 && econCat(id) === c);
  // security / police re-themed ammo: always the generic pool (lane AMMO: ~1/3 each caliber; it used to let the 9 mm lead)
  const rows: ItemRows = own.length && !(security && c === 'ammo') ? own : resolveRows(P, P.tables.globalPool[c]);
  return rows.length ? pickRow(rows, r) : null;
}

/**
 * The scarce finds of one holder from its original roll `raw` (step 1-3 above). `s`: the holder's own scarcity stream.
 * Returns the entries in roll order (ammo exactly as rolled; surviving / re-themed finds in place of their original entry).
 */
export function scarceFinds(raw: readonly Entry[], ctx: FindContext, s: Rnd): Find[] {
  const P = ctx.profile ?? BASELINE_PROFILE, X = P.tables;
  const theme = holderTheme(ctx.kind, ctx.areaKey);
  const T = X.themes[theme];
  const allow = allowedCats(ctx.kind);
  const out: Find[] = [];
  for (const e of raw) {
    const c = econCat(e.itemId);
    // lane RACK (office-props-physics-scale-20261030): crafting materials are kept exactly as rolled too (their rows ARE the numbers)
    if (c === 'ammo' || c === 'material' || c === null) { out.push({itemId: e.itemId, count: e.count, source: 'roll'}); continue; }
    if (s() >= keepChance(P, T.keep, c)) continue;
    const keep: Find = {itemId: e.itemId, count: e.count, source: 'find'};
    const on = s() < T.on;
    let cat: EconCat | null = null;
    if (on) {
      if (T.cats.includes(c)) { out.push(keep); continue; }
      const opts = T.cats.filter(k => allow.includes(k)).map(k => [k, catWeight(P, k, T.weights[k] ?? 0)] as const).filter(o => o[1] > 0);
      if (opts.length) cat = pickRow(opts, s);
    } else {
      // Drawn over EVERY off-theme category, then dropped back to the rolled item when the fixture cannot hold it: a café vending
      // machine's rare off-theme find is not always a battery just because that is all a vending machine may take besides snacks.
      const opts = ECON_CATS.filter(k => !T.cats.includes(k) && catAvailable(k)).map(k => [k, catWeight(P, k, X.offTheme[k])] as const).filter(o => o[1] > 0);
      if (opts.length) cat = pickRow(opts, s);
      if (cat && !allow.includes(cat)) cat = null;
    }
    if (!cat || cat === c) { out.push(keep); continue; }
    const itemId = itemOf(cat, ctx, s, theme === 'security', P);
    if (itemId === null) { out.push(keep); continue; }
    const count = cat !== 'ammo' ? 1 : on ? ctx.boxCount(itemId, s) : range(s, X.handful[itemId] ?? X.handfulFallback);
    out.push({itemId, count, source: 'find'});
  }
  limbTreatments(out, theme, ctx.kind, s, P); // Iteration 16 (lane INJURY)
  return out;
}

/**
 * Iteration 16 (lane INJURY): LIMB TREATMENTS (items/medical.ts). After every original decision, each HP-med find (bandage / med
 * kit) becomes a limb treatment with probability `share[theme]` — a leg splint or an arm sling, now and then a trauma kit. Its draws
 * are APPENDED to the holder's scarcity stream (after the loop), so every other find of every holder is exactly as before; the
 * med total is unchanged (some dressings become treatments). Medical rooms (first-aid rooms, pharmacies, supply closets, wall
 * first-aid kits there) lead. Tuned so treatments are about as common as med kits and rarer than bandages (lanes/injury.done:
 * measured per Subway station and per Office level). The shares live in lootTables LIMB_ECONOMY (read live: tests zero it).
 */
function limbTreatments(out: Find[], theme: LootTheme, kind: string, s: Rnd, P: LootProfile): void {
  const L = P.tables.limb;
  const share = Math.max(L.share[theme] ?? 0, L.holder[kind] ?? 0);
  for (const f of out) {
    if (f.source !== 'find' || !HP_MED.has(f.itemId)) continue;
    if (s() < share) {
      const pool = resolveRows(P, L.pool);
      if (pool.length) { f.itemId = pickRow(pool, s); f.count = 1; }
    }
  }
}

// Loose floor supplies: lootTables FLOOR_ECONOMY / SUBWAY_FLOOR / OFFICE_FLOOR (gen/stationDress.ts, gen/office/spawns.ts interpret them).
