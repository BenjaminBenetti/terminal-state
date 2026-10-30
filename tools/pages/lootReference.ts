// Task loot-reference-pages-20261030 (lane DATA): buildLootReference() — the source-generated loot reference.
//
// Reads ONLY real exported game values (no copied numbers): the per-level loot profiles (items/lootTables.ts PROFILES via
// lootProfile + the registered levels, levels/registry.ts LEVELS / LEVEL_IDS), every holder kind (items/loot.ts isLootHolderKind
// kinds + lootTables HOLDER_SLOTS), every table (named lootTables exports, OPENABLE_TABLES, purpose tables of gen/purposes.ts,
// legacy room-type tables, pools, reward picks), resolved through the real resolution API (items/loot.ts holderTable /
// compartmentTable, lootTables resolveRows / slotEmpty / ...), the loose-floor programs, rare gear, gas masks / filters, weapon
// finds, the starter kit, the roof cache and the non-loot interaction rules. Which holder / purpose contexts occur in which level
// comes from a SMALL fixed-seed census of the real level generators (labelled "observed in N sample levels"; not exhaustive).
//
// The contract is tools/pages/lootReferenceTypes.ts; the guide (how new sources become discoverable, probability definitions) is
// docs/loot-reference.md. game/tests/loot-reference.test.ts checks coverage (unknown registrations fail), determinism, runtime
// agreement (shown values === exported values; analytical expectations vs the real roll functions) and the probability maths.
// Gameplay is untouched: this module only READS game modules (it is never part of the game bundle).

import * as LT from '../../game/src/items/lootTables';
import {
  BASE_TABLES, CONTAINER_THEMED, ECON_CATS, HOLDER_ALLOW, HOLDER_SLOTS, HP_MED, LEGACY_CATS, OPENABLE_TABLES, RANDOM_HOLDERS,
  REWARD_TABLES, SLOT_CATEGORIES, THEME_OF_TYPE, COMPARTMENT_SLOT,
  catWeight, econCat, floorChance, floorCount, gearParams, keepChance, lootProfile, resolveRows, validateLootProfile,
  type EconCat, type ItemRows, type LootProfile, type LootSpec, type LotRange, type OwnTable, type RewardTable, type SlotCategory,
} from '../../game/src/items/lootTables';
import {ITEMS} from '../../game/src/items/items';
import {GEAR_ITEMS, FILTER_LIFE_S} from '../../game/src/items/gear';
import {
  CONTAINER_KINDS, HOLDER_LABEL, SURFACE_KINDS, compartmentTable, holderTable, isContainerKind, isLootHolderKind,
  type HolderKind, type HolderTable,
} from '../../game/src/items/loot';
import {catAvailable, holderTheme} from '../../game/src/items/lootEconomy';
import {ALL_PURPOSES, ROOM_PURPOSES, STORE_PURPOSES, purposeById, purposeLoot, type Purpose} from '../../game/src/gen/purposes';
import {P7_HOLDER_KINDS} from '../../game/src/gen/props07';
import {OPENABLE_SPECS, containerLoot, isSpillHolderKind, openableSpec, separateCompartmentLoot} from '../../game/src/world/openablesSpec';
import {LEVELS, LEVEL_IDS, storeyLabel} from '../../game/src/levels/registry';
import type {LevelId} from '../../game/src/levels/types';
import type {StationLayout} from '../../game/src/gen/stationTypes';
import {GEAR_MIN_SPAWN_M} from '../../game/src/gen/gearLoot';
import {GAS_FILTER_ID, GAS_MASK_ID, MASK_LOOT} from '../../game/src/gen/maskLoot';
import {
  FIND_COPY_THRESHOLDS, FIND_MAX_PER_WEAPON, FIND_MIN_SPAWN_M, PISTOL_START_BOXES, WEAPON_FIND_AMMO, findWeaponsFor, type StartWeaponId,
} from '../../game/src/gen/weaponFinds';
import {officeWeaponStoreyWeights, scarceOdds} from '../../game/src/gen/office/spawns';
import {COMPANIES, COMPANY_IDS, type LootTilt} from '../../game/src/gen/office/companies';
import {TENANT_FLOORS, TWO_FLOOR_CHANCE, officeTenants} from '../../game/src/gen/office/tenants';
import {OFFICE_FLOORS, OFFICE_ROOF_LEVEL} from '../../game/src/gen/office/frame';
import {starterInventory} from '../../game/src/run/starter';
import {startWeaponFor} from '../../game/src/weapons/pistol';
import {atLeastOne, cappedPoisson, expectation, halvingPicks, meanInt, pickProbs, rd, thresholdBands, uniformInt, ZERO_SUM_NOTE} from './probability';
import {
  LOOT_REFERENCE_SCHEMA,
  type CensusInfo, type CompanyInfo, type EconomyInfo, type ExpectedItem, type ExpectedUnits, type FloorFind, type FloorProgramInfo,
  type FloorVariant, type HolderContext, type HolderKindInfo, type ItemGroup, type ItemGroupInfo, type ItemInfo, type LevelInfo,
  type LootReference, type LootTableInfo, type OccurrenceInfo, type OverrideEntry, type OverrideKnob, type ProbabilityNote,
  type PurposeInfo, type PurposeUse, type Range, type ScarcityStage, type SlotInfo, type SourceClass, type SourceLoc, type SpecialSource,
  type StageGates, type StoreyInfo, type TableKind, type TableRow, type TuningKnob,
} from './lootReferenceTypes';

// ---------------------------------------------------------------------------------------------------------------------------
// Options / constants

export interface LootReferenceOptions {
  /** Source commit shown on every page (GITHUB_SHA / `git rev-parse HEAD` / 'local'). */
  commit?: string;
  /** Build id shown on every page (CI run id); default: the data hash. */
  buildId?: string;
  /** Reads a repo-relative file (for source line numbers); omit: links point at files without lines. */
  readSource?: (repoPath: string) => string | null | undefined;
  /** Census seeds per level (default CENSUS_SEEDS); [] = no census (every context 'declared'). */
  censusSeeds?: readonly number[];
  /** TESTS ONLY: the profile a level resolves with (default: lootProfile(level), the real registered profile). */
  profileFor?: (level: LevelId) => LootProfile;
}

/** The fixed census seeds (a few per level: "observed in N sample levels", not exhaustive). */
export const CENSUS_SEEDS: readonly number[] = [11, 222, 3333, 44444];
/** At most this many extra seeds are added for a level with tenant floors so that every tenant company is sampled at least once. */
export const CENSUS_COVER_MAX = 4;

/**
 * The census seeds of a level: CENSUS_SEEDS, plus (levels with tenant storeys) a few extra seeds picked greedily from a fixed
 * candidate sequence so that every tenant company occupies a floor in at least one sample level (gen/office/tenants.ts
 * officeTenants is a pure function of the seed: no generation needed to choose them). Deterministic.
 */
export function censusSeedsFor(level: LevelId, base: readonly number[] = CENSUS_SEEDS): number[] {
  const out = [...base];
  if (!LEVEL_ADAPTER[level].storeys || !out.length) return out;
  const want = new Set<string>(COMPANY_IDS);
  for (const s of out) for (const t of officeTenants(s)) want.delete(t.company);
  const cands = Array.from({length: 400}, (_, k) => (1201 + k * 7919) >>> 0);
  for (let extra = 0; want.size && extra < CENSUS_COVER_MAX; extra++) {
    let best = -1, gain = 0;
    for (const s of cands) {
      if (out.includes(s)) continue;
      const g = new Set(officeTenants(s).map(t => t.company as string).filter(c => want.has(c))).size;
      if (g > gain) { gain = g; best = s; }
    }
    if (best < 0) break;
    out.push(best);
    for (const t of officeTenants(best)) want.delete(t.company);
  }
  return out;
}

export const REPO = {
  url: 'https://github.com/BenjaminBenetti/terminal-state',
  private: true,
  note: 'Source links point to the private game repository: repository access is required to open them.',
};

const F = {
  tables: 'game/src/items/lootTables.ts', loot: 'game/src/items/loot.ts', economy: 'game/src/items/lootEconomy.ts', items: 'game/src/items/items.ts',
  gear: 'game/src/items/gear.ts', medical: 'game/src/items/medical.ts', calibers: 'game/src/items/calibers.ts', purposes: 'game/src/gen/purposes.ts',
  openables: 'game/src/world/openablesSpec.ts', stationDress: 'game/src/gen/stationDress.ts', levelGenDress: 'game/src/gen/levelGenDress.ts',
  officeSpawns: 'game/src/gen/office/spawns.ts', companies: 'game/src/gen/office/companies.ts', tenants: 'game/src/gen/office/tenants.ts',
  roof: 'game/src/gen/office/roof.ts', officeIndex: 'game/src/gen/office/index.ts', gearLoot: 'game/src/gen/gearLoot.ts',
  maskLoot: 'game/src/gen/maskLoot.ts', weaponFinds: 'game/src/gen/weaponFinds.ts', starter: 'game/src/run/starter.ts',
  registry: 'game/src/levels/registry.ts', pistol: 'game/src/weapons/pistol.ts', containers: 'game/src/world/containers.ts',
  dynamicItems: 'game/src/physics/dynamicItems.ts', fillerStock: 'game/src/physics/fillerStock.ts', layout: 'game/src/items/lootLayout.ts',
} as const;

/** The game modules whose exported values the reference reads (this file's imports). Other files appear only as source links. */
export const GENERATED_FROM: readonly string[] = [
  F.tables, F.items, F.gear, F.loot, F.economy, F.purposes, 'game/src/gen/props07.ts', F.openables, F.registry, F.gearLoot, F.maskLoot,
  F.weaponFinds, F.officeSpawns, F.companies, F.tenants, 'game/src/gen/office/frame.ts', F.starter, F.pistol,
].slice().sort();

/**
 * GENERATOR ADAPTER: which generator-level loot paths each registered logical level runs. These are code paths (not data) of the
 * level generators, so they are declared here — `Record<LevelId, ...>` makes a new level fail to typecheck until it is documented,
 * and game/tests/loot-reference.test.ts checks every census pickup / holder of every level against the sources declared here.
 */
export const LEVEL_ADAPTER: Readonly<Record<LevelId, {
  floor: 'subway' | 'office';
  weapons: 'station' | 'office-plan';
  pistolBoxes: boolean;
  rewards: readonly string[];
  storeys: boolean;
  floorMoved: boolean;
}>> = {
  subway: {floor: 'subway', weapons: 'station', pistolBoxes: true, rewards: [], storeys: false, floorMoved: true},
  office: {floor: 'office', weapons: 'office-plan', pistolBoxes: false, rewards: [LT.ROOF_CACHE_KEY], storeys: true, floorMoved: false},
};

/**
 * Every export of items/lootTables.ts that is NOT auto-detected as a table (row list / LootSpec) and how the reference covers it.
 * An export missing here (and not a table) fails game/tests/loot-reference.test.ts: classify it and surface it in the reference.
 */
export const LOOT_TABLES_EXPORT_ROLES: Readonly<Record<string, string>> = {
  // types / constants of the API
  LEGACY_CATS: 'legacy category order (economy.legacy.cats)', ECON_CATS: 'economy categories (item econ / scarcity stages)',
  SLOT_CATEGORIES: 'slots (all 12)', BATTERY_ID: 'item id (economy)', FLARE_ID: 'item id (economy)', HP_MED: 'limb post-pass items (scarcity stage)',
  econCat: 'item econ category', HOLDER_SLOTS: 'holder kinds -> slots', COMPARTMENT_SLOT: 'compartment slot', slotOf: 'API (slot lookup)',
  // rate tables
  AREA_WEIGHTS: 'economy.legacy.areaWeights', P7_HOLDER_LOOT: 'holder kind defaults (generated holders)', HOLDER_MOD: 'holder kind defaults + legacy',
  HOLDER_EMPTY: 'holder kind defaults', HOLDER_LOTS: 'holder kind defaults', FULL_ROOMS: 'economy.legacy.fullRooms', LEGACY_POOL: 'pool tables',
  BOX_COUNT: 'economy.boxCount', BIG_BOX_HOLDERS: 'economy.bigBoxHolders', HANDFUL: 'economy.handful', HANDFUL_FALLBACK: 'economy.handfulFallback',
  THEME_ECONOMY: 'economy.themes', OFF_THEME_WEIGHTS: 'economy.offTheme', GLOBAL_POOL: 'pool tables', THEME_OF_TYPE: 'economy.themeOfType',
  HOLDER_ALLOW: 'eligibility (holder kinds / scarcity)', CONTAINER_THEMED: 'holder kinds (container-themed)', RANDOM_HOLDERS: 'holder kinds (random)',
  LIMB_ECONOMY: 'economy.limb + limb table', storeTill: 'factory of purpose tables (each call -> a purpose table)',
  storeKitchen: 'factory of purpose tables (each call -> a purpose table)', OPENABLE_TABLES: 'openable tables',
  FLOOR_ECONOMY: 'floor programs (keep / chances / theme weights)', SUBWAY_FLOOR: 'floor program (subway)', OFFICE_FLOOR_TILT: 'floor program tilts (office)',
  OFFICE_FLOOR: 'floor program (office)', PUBLIC_FLOOR_WEIGHTS: 'floor placement weights', GEAR_MEAN_PER_LEVEL: 'special: rare gear',
  GEAR_CAP_PER_LEVEL: 'special: rare gear', GEAR_WEIGHTS: 'special: rare gear', GEAR_LOOT: 'special: rare gear',
  ROOF_CACHE_KEY: 'special: roof cache (reward key)', ROOF_CACHE: 'special: roof cache + reward-pick tables', REWARD_TABLES: 'rewards (special + contexts)',
  BASE_TABLES: 'profile tables', BASELINE_PROFILE: 'level-agnostic default profile (not a level)', PROFILES: 'levels (profiles)', lootProfile: 'levels (profiles)',
  // resolution API (the reference resolves every value through it)
  resolveRows: 'API', catWeight: 'API', keepChance: 'API', slotEmpty: 'API', slotLots: 'API', floorChance: 'API', floorCount: 'API', gearParams: 'API',
  rewardTable: 'API', validateLootProfile: 'levels (profile validation)',
};

const SLOT_TEXT: Readonly<Record<SlotCategory, [string, string]>> = {
  surface: ['Surfaces', 'Ordinary small-item surfaces: tables, desk tops, security-desk tops.'],
  countertop: ['Countertops', 'Shop counters, back counters, kiosk stalls, kitchenette tops.'],
  shelf: ['Shelves', 'Open shelving and baskets: shelves, stock shelves, shopping carts.'],
  container: ['Containers', 'General closed storage: cabinets, crates, lockers, filing cabinets, safes, office storage — and every drawer / cupboard compartment roll.'],
  foodPrep: ['Food prep', 'Kitchen lines and food carts.'],
  vend: ['Vending', 'Vending machines, snack racks, display cases, newspaper boxes.'],
  cold: ['Cold storage', 'Drinks coolers, fridges, chest freezers.'],
  medical: ['Medical', 'First-aid storage and clinic / lab furniture.'],
  arms: ['Arms', 'Gun lockers and vault safes.'],
  junk: ['Junk', 'Trash cans and wheelie bins (random finds whatever the room).'],
  stash: ['Stash', 'Toilet stalls (something stashed in a toilet or on its tank lid).'],
  fixture: ['Fixtures', 'Baked contents only (fire extinguisher, defibrillator): no loot table.'],
};

const GROUP_LABEL: Readonly<Record<ItemGroup, string>> = {
  food: 'Food', drink: 'Drink', med: 'Medicine', ammo: 'Ammunition', battery: 'Batteries', flare: 'Flares', supply: 'Supplies', gear: 'Gear', weapon: 'Weapons',
  material: 'Crafting materials (no crafting yet)', // lane RACK (office-props-physics-scale-20261030)
};
const GROUP_ORDER: readonly ItemGroup[] = ['food', 'drink', 'med', 'ammo', 'battery', 'flare', 'material', 'supply', 'gear', 'weapon'];

// ---------------------------------------------------------------------------------------------------------------------------
// Source locations

class Sources {
  private cache = new Map<string, string[] | null>();
  readonly files = new Set<string>();
  constructor(private readonly read?: LootReferenceOptions['readSource']) {}
  private lines(file: string): string[] | null {
    if (!this.read) return null;
    if (!this.cache.has(file)) { const t = this.read(file); this.cache.set(file, typeof t === 'string' ? t.split('\n') : null); }
    return this.cache.get(file) ?? null;
  }
  /** `symbol` = Export[.key...] (quoted keys allowed: ROOM_PURPOSES['staff-room'].loot.fridge). */
  at(file: string, symbol: string, find?: string): SourceLoc {
    this.files.add(file);
    const loc: SourceLoc = {file, symbol};
    const lines = this.lines(file);
    if (!lines) return loc;
    const parts = symbol.replace(/\[(\d+)\]/g, '').replace(/\['([^']+)'\]/g, '.$1').split('.').filter(Boolean);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let line = -1;
    const head = find ?? parts[0];
    const top = new RegExp(`^export (?:const|function|let|interface|type|class) ${esc(head)}\\b`);
    line = lines.findIndex(l => top.test(l));
    if (line < 0) line = lines.findIndex(l => new RegExp(`(?:^|[\\s{,(])'?${esc(head)}'?\\s*[:(]`).test(l));
    if (line < 0) return loc;
    for (const p of find ? parts : parts.slice(1)) {
      const re = new RegExp(`(?:^|[\\s{,(])'?${esc(p)}'?\\s*:`);
      const k = lines.slice(line, line + 400).findIndex(l => re.test(l));
      if (k >= 0) line += k;
    }
    return {...loc, line: line + 1};
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Small helpers

type Row = readonly [string, number];
const isRowList = (v: unknown): v is ItemRows => Array.isArray(v) && v.length > 0 && v.every(r => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && typeof r[1] === 'number');
const isLootSpec = (v: unknown): v is LootSpec => !!v && typeof v === 'object' && !Array.isArray(v) && isRowList((v as {items?: unknown}).items);
const sameRows = (a: readonly Row[], b: readonly Row[]) => a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
const rowKey = (rows: readonly Row[]) => rows.map(r => `${r[0]}:${r[1]}`).join('|');
const label = (kind: string) => (HOLDER_LABEL as Record<string, string>)[kind] ?? kind;
const isUntouched = (P: LootProfile) => P.tables === BASE_TABLES && Object.keys(P.overrides ?? {}).length === 0;
const boxMean = (P: LootProfile, kind: string, itemId: string): number => {
  const b = P.tables.boxCount[itemId];
  if (!b) return 1;
  const [a, c] = P.tables.bigBoxHolders.has(kind) ? b.big : b.small;
  return meanInt(a, c);
};
const handfulMean = (P: LootProfile, itemId: string): number => { const [a, b] = P.tables.handful[itemId] ?? P.tables.handfulFallback; return meanInt(a, b); };
function groupOf(itemId: string): ItemGroup {
  const d = ITEMS[itemId];
  const c = econCat(itemId);
  if (c) return c;
  if (!d) return 'supply';
  if (d.kind === 'weapon') return 'weapon';
  if (d.kind === 'gear') return 'gear';
  return 'supply';
}
const rowsTable = (rows: readonly Row[]): TableRow[] => { const p = pickProbs(rows.map(r => r[1])); return rows.map((r, i) => ({itemId: r[0], weight: r[1], share: rd(p[i])})); };
const catShares = (list: readonly (readonly [string, number])[]) => { const p = pickProbs(list.map(x => x[1])); return list.map(([cat, weight], i) => ({cat, weight, share: rd(p[i])})); };

/** Knobs of a holder table (rows / empty / lots) in its context. */
function tableKnobs(at: SourceLoc, t: {lots?: LotRange; empty?: number; rows: readonly Row[]}, o: {reward?: boolean; slot?: string; profileTables?: boolean} = {}): TuningKnob[] {
  const rowOv: OverrideKnob[] = ['itemWeight', 'categoryWeight', ...(o.profileTables ? ['tables' as const] : [])];
  const out: TuningKnob[] = [{what: 'row weights', value: `${t.rows.length} rows`, at, overrides: rowOv}];
  if (t.empty !== undefined) out.push({what: 'empty chance', value: t.empty, at, overrides: o.reward ? ['rewards'] : ['slot.empty'], note: o.slot ? `slot '${o.slot}'` : undefined});
  if (t.lots) out.push({what: 'lot range', value: t.lots, at, overrides: o.reward ? ['rewards'] : ['slot.lots'], note: o.slot ? `slot '${o.slot}'` : undefined});
  return out;
}

function fnv(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Removes `undefined` properties (plain JSON: the same object JSON-round-trips to itself). */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Census (a small, fixed-seed sample of the REAL level generators)

export interface CensusHolder { kind: string; areaKey: string; level: number; storey?: string; company?: string }
export interface CensusLayout {
  seed: number;
  holders: CensusHolder[];
  pickups: {itemId: string; count: number; level: number}[];
  purposes: string[];
}

const censusCache = new Map<string, CensusLayout>();

function storeyName(layout: StationLayout, level: number): string | undefined {
  if (!layout.office) return undefined;
  if (level === 0) return 'Station';
  if (level === OFFICE_ROOF_LEVEL) return 'Roof';
  const s = storeyLabel(layout, level);
  return s === 'L' ? 'Lobby' : s ? `Floor ${s}` : `Level ${level}`;
}

/** One sample level of `level` (every section of the registered generator, the shipped start weapon). Cached per process. */
export function censusLayout(level: LevelId, seed: number): CensusLayout {
  const key = `${level}:${seed}`;
  const hit = censusCache.get(key);
  if (hit) return hit;
  const def = LEVELS[level];
  const startWeapon = startWeaponFor(false);
  const out: CensusLayout = {seed, holders: [], pickups: [], purposes: []};
  const purposes = new Set<string>();
  for (const section of def.sections(seed)) {
    const layout = def.generate(section, {levelSeed: seed, startWeapon});
    const tenants = new Map((layout.office?.tenants ?? []).map(t => [t.floor, t.company as string]));
    for (const a of layout.areas) if (a.purpose && purposeById(a.purpose)) purposes.add(a.purpose);
    for (const p of layout.props) {
      const kind = p.kind as string;
      if (!isLootHolderKind(kind)) continue;
      const area = layout.areas[p.area];
      const areaKey = p.purpose ?? area?.purpose ?? area?.type ?? 'default';
      if (p.purpose && purposeById(p.purpose)) purposes.add(p.purpose); // (a reward key such as 'roof-cache' is not a purpose)
      const lv = p.level ?? area?.level ?? 0;
      const h: CensusHolder = {kind, areaKey, level: lv};
      const st = storeyName(layout, lv);
      if (st) h.storey = st;
      const co = tenants.get(lv);
      if (co) h.company = co;
      out.holders.push(h);
    }
    for (const q of layout.pickups) out.pickups.push({itemId: q.itemId, count: q.count, level: q.level ?? 0});
  }
  out.purposes = [...purposes].sort();
  censusCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The builder (one instance per build: tables are registered once and shared by every context)

interface TableEntry { info: LootTableInfo; obj?: unknown; key?: string }

class Builder {
  readonly src: Sources;
  readonly tables = new Map<string, TableEntry>();
  private byObj = new Map<unknown, string>();
  private byKey = new Map<string, string>();
  private rowsName = new Map<unknown, string>();
  readonly itemSources = new Map<string, Set<string>>();

  constructor(readonly opts: LootReferenceOptions) {
    this.src = new Sources(opts.readSource);
  }

  // --- tables ---------------------------------------------------------------------------------------------------------------

  register(obj: unknown, id: string, kind: TableKind, labelText: string, rows: readonly Row[], at: SourceLoc, extra: Partial<LootTableInfo> = {}): string {
    if (obj !== undefined) { const known = this.byObj.get(obj); if (known) return known; }
    let uid = id;
    for (let k = 2; this.tables.has(uid); k++) uid = `${id}#${k}`;
    const d = rows.reduce((s, r) => s + r[1], 0);
    const info: LootTableInfo = {
      id: uid, label: labelText, kind, rows: rowsTable(rows), denominator: rd(d), emptyTable: rows.length === 0, at,
      knobs: [], usedBy: [], ...extra,
    };
    if (rows.length && !(d > 0)) info.note = [info.note, ZERO_SUM_NOTE].filter(Boolean).join(' ');
    this.tables.set(uid, {info, obj});
    if (obj !== undefined) this.byObj.set(obj, uid);
    return uid;
  }

  /** A derived (content-keyed) table: one entry per distinct content. */
  derived(key: string, make: () => {id: string; kind: TableKind; label: string; rows: readonly Row[]; at: SourceLoc; extra?: Partial<LootTableInfo>}): string {
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const m = make();
    const id = this.register(undefined, m.id, m.kind, m.label, m.rows, m.at, m.extra);
    this.byKey.set(key, id);
    return id;
  }

  idOf(obj: unknown): string | undefined { return this.byObj.get(obj); }
  rowsFrom(rows: unknown): string | undefined { return this.rowsName.get(rows); }
  use(tableId: string, user: string): void {
    const t = this.tables.get(tableId);
    if (t && !t.info.usedBy.includes(user)) (t.info.usedBy as string[]).push(user);
  }
  addSource(itemId: string, source: string): void {
    let s = this.itemSources.get(itemId);
    if (!s) this.itemSources.set(itemId, (s = new Set()));
    s.add(source);
  }

  /** The named tables of lootTables.ts (row lists and LootSpecs), OPENABLE_TABLES, the pools, limb pool and reward picks. */
  registerNamed(): void {
    const at = (sym: string) => this.src.at(F.tables, sym);
    const ns = LT as unknown as Record<string, unknown>;
    // row lists first (so OwnTables / specs can name their shared rows)
    for (const name of Object.keys(ns)) {
      const v = ns[name];
      if (!isRowList(v)) continue;
      this.rowsName.set(v, name);
      this.register(v, name, name === 'VENDING_FOOD' ? 'pool' : 'named', name === 'VENDING_FOOD' ? 'Vending food pool (legacy vending machines)' : name, v, at(name), {knobs: [{what: 'row weights', value: `${v.length} rows`, at: at(name), overrides: ['itemWeight', 'categoryWeight']}]});
    }
    for (const name of Object.keys(ns)) {
      const v = ns[name];
      if (!isLootSpec(v)) continue;
      const loc = at(name);
      this.register(v, name, 'named', name, v.items, loc, {
        ...(v.lots ? {lots: v.lots} : {}), ...(v.empty !== undefined ? {empty: v.empty} : {}),
        ...(this.rowsFrom(v.items) ? {rowsFrom: this.rowsFrom(v.items)} : {}), knobs: tableKnobs(loc, {lots: v.lots, empty: v.empty, rows: v.items}),
      });
    }
    for (const [k, t] of Object.entries(OPENABLE_TABLES as Readonly<Record<string, OwnTable>>)) {
      const loc = at(`OPENABLE_TABLES.${k}`);
      this.register(t, `OPENABLE_TABLES.${k}`, 'openable', `${label(k)} (own table)`, t.items, loc, {
        lots: t.lots, empty: t.empty, ...(this.rowsFrom(t.items) ? {rowsFrom: this.rowsFrom(t.items)} : {}),
        knobs: tableKnobs(loc, {lots: t.lots, empty: t.empty, rows: t.items}, {slot: (HOLDER_SLOTS as Record<string, string>)[k]}),
      });
    }
    for (const [pool, name] of [[BASE_TABLES.globalPool, 'GLOBAL_POOL'], [BASE_TABLES.pool, 'LEGACY_POOL']] as const) {
      for (const [cat, rows] of Object.entries(pool as Readonly<Record<string, ItemRows>>)) {
        const loc = at(`${name}.${cat}`);
        this.register(rows, `${name}.${cat}`, 'pool', `${name === 'GLOBAL_POOL' ? 'Global pool' : 'Legacy pool'} — ${cat}`, rows, loc, {knobs: [{what: 'row weights', value: `${rows.length} rows`, at: loc, overrides: ['itemWeight', 'categoryWeight', 'tables']}]});
      }
    }
    const limbLoc = at('LIMB_ECONOMY.pool');
    this.register(BASE_TABLES.limb.pool, 'LIMB_ECONOMY.pool', 'limb', 'Limb treatments (HP-med conversion pool)', BASE_TABLES.limb.pool, limbLoc, {knobs: [{what: 'row weights', value: `${BASE_TABLES.limb.pool.length} rows`, at: limbLoc, overrides: ['itemWeight', 'categoryWeight', 'tables']}]});
    for (const [key, rw] of Object.entries(REWARD_TABLES)) this.registerReward(key, rw);
  }

  registerReward(key: string, rw: RewardTable, tag = ''): string[] {
    const name = Object.entries(LT as unknown as Record<string, unknown>).find(([, v]) => v === rw)?.[0] ?? `REWARD_TABLES.${key}`;
    return rw.picks.map((p, i) => {
      const loc = this.src.at(F.tables, `${name}.picks`);
      return this.register(p, `${name}.picks[${i}]${tag}`, 'reward-pick', `${rw.label} — pick ${i + 1}`, p.items, loc, {
        lots: p.lots, empty: p.empty, knobs: tableKnobs(loc, {lots: p.lots, empty: p.empty, rows: p.items}, {reward: true}),
        note: 'Curated reward pick: rolled exactly (no scarcity keep cut, no re-theme, no limb conversion); every rolled lot is placed (bounded re-packs).',
      });
    });
  }

  /** Every purpose's loot entries (named tables by identity, else a purpose table). */
  registerPurposes(): void {
    for (const p of ALL_PURPOSES) {
      const store = (STORE_PURPOSES as Record<string, Purpose>)[p.id] === p;
      for (const [holder, spec] of Object.entries(p.loot as Readonly<Record<string, LootSpec | undefined>>)) {
        if (!spec) continue;
        const sym = store ? `STORE_PURPOSES.${p.id}.loot.${holder}` : `ROOM_PURPOSES['${p.id}'].loot.${holder}`;
        const loc = this.src.at(F.purposes, `${p.id}.loot.${holder}`, p.id);
        const hl = holder === 'default' ? 'any other holder' : label(holder);
        this.register(spec, `purpose:${p.id}.${holder}`, 'purpose', `${p.label} — ${hl}`, spec.items, {...loc, symbol: sym}, {
          ...(spec.lots ? {lots: spec.lots} : {}), ...(spec.empty !== undefined ? {empty: spec.empty} : {}),
          ...(this.rowsFrom(spec.items) ? {rowsFrom: this.rowsFrom(spec.items)} : {}),
          knobs: tableKnobs({...loc, symbol: sym}, {lots: spec.lots, empty: spec.empty, rows: spec.items}),
          ...(spec.lots && spec.empty !== undefined ? {} : {note: 'Lots / empty not set here default to the holder kind\'s (HOLDER_LOTS / HOLDER_EMPTY).'}),
        });
      }
    }
  }

  /** Purpose table of a holder in a purpose context (own entry, `default`, or the merged fallback). */
  purposeTableId(purposeId: string, kind: string): string | undefined {
    const p = purposeById(purposeId);
    if (!p) return undefined;
    const t = p.loot as Partial<Record<string, LootSpec>>;
    const own = t[kind] ?? t.default;
    if (own) return this.idOf(own);
    const spec = purposeLoot(purposeId, kind);
    if (!spec) return undefined;
    return this.derived(`merged:${purposeId}`, () => ({
      id: `purpose-merged:${purposeId}`, kind: 'purpose-merged', label: `${p.label} — any unlisted holder (every row the purpose stocks)`, rows: spec.items,
      at: this.src.at(F.purposes, 'purposeLoot'),
      extra: {derivedFrom: Object.values(t).map(s => this.idOf(s)).filter((x): x is string => !!x),
        note: 'gen/purposes.ts purposeLoot: a holder kind the purpose does not list draws from every row it stocks (weights summed); lots / empty default to the holder kind\'s.',
        knobs: [{what: 'row weights (sum of the purpose\'s rows)', value: `${spec.items.length} rows`, at: this.src.at(F.purposes, 'purposeLoot'), overrides: ['itemWeight', 'categoryWeight']}]},
    }));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Holder contexts: resolution + exact staged expectations (before fit)

interface LotOutcome { p: number; units: number }
type OutcomeMap = Map<string, LotOutcome>;
const addOut = (m: OutcomeMap, id: string, p: number, units: number) => {
  if (!(p > 0)) return; // a zero-weight row is never drawn
  const e = m.get(id);
  if (e) { e.p += p; e.units += units; } else m.set(id, {p, units});
};

/** Per-lot ORIGINAL roll outcomes of a holder table (rollRows / the legacy category roll): item -> {P(item), E[units; item]}. */
function rawLot(P: LootProfile, kind: string, areaKey: string, t: HolderTable): {out: OutcomeMap; pRoll: number} {
  const out: OutcomeMap = new Map();
  if (t.source === 'legacy') {
    const T = P.tables, room = T.areaWeights[areaKey] ?? T.areaWeights.default, mod = T.holderMod[kind];
    if (!mod) throw new Error(`legacy holder ${kind} has no HOLDER_MOD row`);
    const cats = LEGACY_CATS.map((c, i) => [c, catWeight(P, c, room[i] * mod[i])] as const).filter(([, w]) => w > 0);
    if (!cats.length) return {out, pRoll: 0};
    const pc = pickProbs(cats.map(c => c[1]));
    cats.forEach(([c], ci) => {
      const pool = resolveRows(P, kind === 'vending' && c === 'food' ? T.vendingFood : T.pool[c]);
      if (!pool.length) return; // the lot is lost (`continue` in rollItems)
      const pp = pickProbs(pool.map(r => r[1]));
      pool.forEach(([id], i) => addOut(out, id, pc[ci] * pp[i], pc[ci] * pp[i] * boxMean(P, kind, id)));
    });
    return {out, pRoll: Math.max(0, 1 - t.empty)};
  }
  if (!t.rows.length) return {out, pRoll: 0};
  const pr = pickProbs(t.rows.map(r => r[1]));
  t.rows.forEach(([id], i) => addOut(out, id, pr[i], pr[i] * boxMean(P, kind, id)));
  return {out, pRoll: Math.max(0, 1 - t.empty)};
}

/** The scarcity stage (items/lootEconomy.ts scarceFinds + limbTreatments) as data, for one holder context. */
function scarcityOf(P: LootProfile, kind: string, areaKey: string, exempt: boolean): ScarcityStage {
  const X = P.tables, theme = holderTheme(kind, areaKey), T = X.themes[theme];
  const allowList = (HOLDER_ALLOW as Record<string, readonly EconCat[] | undefined>)[kind];
  const allow = (allowList ?? ECON_CATS).filter(catAvailable);
  const keep: Record<string, number> = {};
  for (const c of ECON_CATS) keep[c] = c === 'ammo' || c === 'material' ? 1 : keepChance(P, T.keep, c); // lane RACK: materials kept as rolled
  const onPick = T.cats.filter(k => allow.includes(k)).map(k => [k, catWeight(P, k, T.weights[k] ?? 0)] as const).filter(o => o[1] > 0);
  const offPick = ECON_CATS.filter(k => !T.cats.includes(k) && catAvailable(k)).map(k => [k, catWeight(P, k, X.offTheme[k])] as const).filter(o => o[1] > 0);
  const L = X.limb, ts = L.share[theme] ?? 0, hs = L.holder[kind] ?? 0;
  const themeFrom: ScarcityStage['themeFrom'] = RANDOM_HOLDERS.has(kind) ? 'random-holder' : purposeById(areaKey) ? 'purpose' : THEME_OF_TYPE[areaKey] ? 'room-type' : 'default-public';
  return {
    exempt, theme, themeFrom, keep, on: T.on, onCats: [...T.cats], onPick: catShares(onPick),
    offPick: catShares(offPick).map(o => ({...o, allowed: allow.includes(o.cat as EconCat)})),
    allow: allowList ? [...allowList] : null, limbShare: Math.max(ts, hs), limbFrom: hs > ts ? 'holder' : 'theme',
    securityAmmoFromPool: theme === 'security',
  };
}

/** Per-lot FINAL outcomes: the scarcity stage applied to the raw per-lot outcomes, then the limb post-pass (exact, before fit). */
function finalLot(P: LootProfile, kind: string, areaKey: string, rows: readonly Row[], raw: OutcomeMap): OutcomeMap {
  const X = P.tables, theme = holderTheme(kind, areaKey), T = X.themes[theme];
  const allowList = (HOLDER_ALLOW as Record<string, readonly EconCat[] | undefined>)[kind];
  const allow = (allowList ?? ECON_CATS).filter(catAvailable);
  const security = theme === 'security';
  const finds: OutcomeMap = new Map(), out: OutcomeMap = new Map();
  const rowsOf = (c: EconCat): readonly Row[] => {
    const own = rows.filter(([id, w]) => w > 0 && econCat(id) === c);
    return own.length && !(security && c === 'ammo') ? own : resolveRows(P, X.globalPool[c]);
  };
  for (const [id, {p, units}] of raw) {
    const c = econCat(id);
    if (c === 'ammo' || c === 'material' || c === null) { addOut(out, id, p, units); continue; } // lane RACK: materials kept as rolled
    const kept = p * keepChance(P, T.keep, c), ec = units / p;
    const original = (q: number) => addOut(finds, id, q, q * ec);
    const retheme = (q: number, cat: EconCat, on: boolean) => {
      const rs = rowsOf(cat);
      if (!rs.length) { original(q); return; }
      const pr = pickProbs(rs.map(r => r[1]));
      rs.forEach(([j], i) => addOut(finds, j, q * pr[i], q * pr[i] * (cat !== 'ammo' ? 1 : on ? boxMean(P, kind, j) : handfulMean(P, j))));
    };
    // on-theme
    const qOn = kept * T.on;
    if (T.cats.includes(c)) original(qOn);
    else {
      const opts = T.cats.filter(k => allow.includes(k)).map(k => [k, catWeight(P, k, T.weights[k] ?? 0)] as const).filter(o => o[1] > 0);
      if (!opts.length) original(qOn);
      else { const pc = pickProbs(opts.map(o => o[1])); opts.forEach(([k], i) => (k === c ? original(qOn * pc[i]) : retheme(qOn * pc[i], k, true))); }
    }
    // off-theme
    const qOff = kept * (1 - T.on);
    const offs = ECON_CATS.filter(k => !T.cats.includes(k) && catAvailable(k)).map(k => [k, catWeight(P, k, X.offTheme[k])] as const).filter(o => o[1] > 0);
    if (!offs.length) original(qOff);
    else {
      const pc = pickProbs(offs.map(o => o[1]));
      offs.forEach(([k], i) => (!allow.includes(k) || k === c ? original(qOff * pc[i]) : retheme(qOff * pc[i], k, false)));
    }
  }
  // limb post-pass (only `find` entries)
  const L = X.limb, share = Math.max(L.share[theme] ?? 0, L.holder[kind] ?? 0), pool = resolveRows(P, L.pool);
  const pp = pool.length ? pickProbs(pool.map(r => r[1])) : [];
  for (const [id, {p, units}] of finds) {
    if (!HP_MED.has(id) || !pool.length || !(share > 0)) { addOut(out, id, p, units); continue; }
    addOut(out, id, p * (1 - share), units * (1 - share));
    pool.forEach(([j], i) => addOut(out, j, p * share * pp[i], p * share * pp[i]));
  }
  return out;
}

interface RollPart { pRoll: number; lots: LotRange; raw: OutcomeMap; final: OutcomeMap }

function expectedOf(parts: readonly RollPart[]): ExpectedUnits {
  const ids = new Set<string>();
  for (const pt of parts) { for (const k of pt.raw.keys()) ids.add(k); for (const k of pt.final.keys()) ids.add(k); }
  const items: ExpectedItem[] = [];
  let rawLots = 0, rawUnits = 0, lots = 0, units = 0, pNone = 1;
  for (const pt of parts) {
    const yAll = [...pt.final.values()].reduce((s, o) => s + o.p, 0);
    pNone *= 1 - atLeastOne(pt.pRoll, pt.lots[0], pt.lots[1], Math.min(1, yAll));
  }
  for (const id of [...ids].sort()) {
    let rl = 0, ru = 0, l = 0, u = 0, none = 1;
    for (const pt of parts) {
      const en = pt.pRoll * meanInt(pt.lots[0], pt.lots[1]);
      const r = pt.raw.get(id), f = pt.final.get(id);
      if (r) { rl += en * r.p; ru += en * r.units; }
      if (f) { l += en * f.p; u += en * f.units; none *= 1 - atLeastOne(pt.pRoll, pt.lots[0], pt.lots[1], Math.min(1, f.p)); }
    }
    rawLots += rl; rawUnits += ru; lots += l; units += u;
    items.push({itemId: id, rawLots: rd(rl), rawUnits: rd(ru), lots: rd(l), units: rd(u), pAtLeastOne: rd(1 - none)});
  }
  const byGroup: Record<string, {lots: number; units: number}> = {};
  for (const it of items) {
    const g = groupOf(it.itemId);
    const e = byGroup[g] ?? (byGroup[g] = {lots: 0, units: 0});
    e.lots = rd(e.lots + it.lots); e.units = rd(e.units + it.units);
  }
  return {basis: 'exact-before-fit', items, rawLots: rd(rawLots), rawUnits: rd(rawUnits), lots: rd(lots), units: rd(units), pAny: rd(1 - pNone), byGroup};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Level assembly

interface Occ { seeds: Set<number>; holders: number; storeys: Set<string>; companies: Set<string> }

function buildLevel(B: Builder, level: LevelId, P: LootProfile, census: readonly CensusLayout[], specials: readonly SpecialSource[]): LevelInfo {
  const def = LEVELS[level];
  const tag = isUntouched(P) ? '' : `~${P.id}`;
  // --- occurrence from the census
  const occ = new Map<string, Occ>();
  const purposeSeeds = new Map<string, Set<number>>();
  for (const c of census) {
    for (const pid of c.purposes) { let s = purposeSeeds.get(pid); if (!s) purposeSeeds.set(pid, (s = new Set())); s.add(c.seed); }
    for (const h of c.holders) {
      const key = `${h.kind}@${h.areaKey}`;
      let o = occ.get(key);
      if (!o) occ.set(key, (o = {seeds: new Set(), holders: 0, storeys: new Set(), companies: new Set()}));
      o.seeds.add(c.seed); o.holders++;
      if (h.storey) o.storeys.add(h.storey);
      if (h.company) o.companies.add(h.company);
    }
  }
  // declared contexts: the holder kinds a purpose observed in this level lists (not placed in any sample level)
  for (const pid of purposeSeeds.keys()) {
    const p = purposeById(pid);
    if (!p) continue;
    for (const holder of Object.keys(p.loot)) {
      if (holder === 'default' || !isLootHolderKind(holder)) continue;
      const key = `${holder}@${pid}`;
      if (!occ.has(key)) occ.set(key, {seeds: new Set(), holders: 0, storeys: new Set(), companies: new Set()});
    }
  }
  // the level's reward keys (generator adapter) are always contexts
  for (const key of LEVEL_ADAPTER[level].rewards) {
    const rw = P.tables.rewards?.[key];
    if (rw && !occ.has(`${rw.holder}@${key}`)) occ.set(`${rw.holder}@${key}`, {seeds: new Set(), holders: 0, storeys: new Set(), companies: new Set()});
  }
  const holders: HolderContext[] = [];
  const keys = [...occ.keys()].sort();
  for (const key of keys) {
    const [kind, areaKey] = [key.slice(0, key.indexOf('@')), key.slice(key.indexOf('@') + 1)];
    const o = occ.get(key)!;
    const occurrence: OccurrenceInfo = {
      basis: o.holders ? 'observed' : 'declared', levelsObserved: o.seeds.size, samples: census.length, holdersObserved: o.holders,
      ...(o.storeys.size ? {storeys: sortStoreys([...o.storeys])} : {}), ...(o.companies.size ? {companies: [...o.companies].sort()} : {}),
    };
    holders.push(holderContext(B, level, P, tag, kind, areaKey, false, occurrence));
    if (separateCompartmentLoot(kind)) holders.push(holderContext(B, level, P, tag, kind, areaKey, true, occurrence));
  }
  // --- slots
  const slots = SLOT_CATEGORIES.map(slot => ({slot, contexts: holders.filter(h => h.slot === slot).map(h => h.id)}));
  // --- purposes
  const purposes: PurposeUse[] = [...purposeSeeds.entries()].map(([pid, s]) => {
    const p = purposeById(pid);
    return {purpose: pid, label: p?.label ?? pid, theme: p?.theme ?? 'public', levelsObserved: s.size, samples: census.length};
  }).sort((a, b) => a.purpose.localeCompare(b.purpose));
  // --- profile
  const profile = {
    id: P.id, label: P.label, baseTables: P.tables === BASE_TABLES, overrides: overrideEntries(P), validation: validateLootProfile(P),
    at: B.src.at(F.tables, `PROFILES.${level}`),
  };
  return {
    id: level, label: def.name, blurb: def.blurb, profile, contexts: levelContexts(level),
    slots, holders, purposes, economy: economyOf(B, P), floor: floorProgram(B, level, P),
    specials: specials.filter(s => s.levels.includes(level)).map(s => s.id),
  };
}

const STOREY_ORDER = (s: string) => (s === 'Station' ? 0 : s === 'Lobby' ? 1 : s === 'Roof' ? 99 : Number(s.replace(/\D+/g, '')) || 50);
const sortStoreys = (list: string[]) => list.sort((a, b) => STOREY_ORDER(a) - STOREY_ORDER(b));

function holderContext(B: Builder, level: LevelId, P: LootProfile, tag: string, kind: string, areaKey: string, compartment: boolean, occurrence: OccurrenceInfo): HolderContext {
  const id = `${level}/${kind}${compartment ? '.inside' : ''}@${areaKey}`;
  const ht = compartment ? compartmentTable(kind as HolderKind, areaKey, P) : holderTable(kind as HolderKind, areaKey, P);
  if (!ht) throw new Error(`no compartment table for ${kind}`);
  const slot = ht.slot ?? (compartment ? COMPARTMENT_SLOT : (HOLDER_SLOTS as Record<string, SlotCategory | undefined>)[kind]);
  if (!slot) throw new Error(`holder kind ${kind} has no slot (lootTables HOLDER_SLOTS)`);
  const notes: string[] = [];
  const purpose = purposeById(areaKey);
  const isReward = ht.source === 'reward';
  const areaKind: HolderContext['areaKind'] = isReward ? 'reward-key' : purpose ? 'purpose' : areaKey === 'default' ? 'default' : 'room-type';
  const areaLabel = isReward ? (P.tables.rewards?.[areaKey]?.label ?? areaKey) : purpose?.label ?? areaKey;
  let tableId: string | null = null;
  let rewardPicks: string[] | undefined;
  const scarcity = scarcityOf(P, kind, areaKey, isReward);
  const gates: StageGates = {
    empty: ht.empty, pNotEmpty: 0, lots: ht.lots, expectedLotsIfRolled: rd(meanInt(ht.lots[0], ht.lots[1])),
    bigBoxes: P.tables.bigBoxHolders.has(kind),
  };
  let expected: ExpectedUnits | null = null;
  let cls: SourceClass = 'conditional';
  if (ht.source === 'fixture') {
    cls = 'non-loot';
    notes.push(`Fixture: baked contents only (${openableSpec(kind)?.contents ?? 'no loot'}); rolls nothing.`);
  } else if (isReward) {
    const rw = P.tables.rewards?.[areaKey];
    if (!rw) throw new Error(`reward ${areaKey} missing`);
    rewardPicks = rw === REWARD_TABLES[areaKey] ? rw.picks.map(p => B.idOf(p)!) : B.registerReward(areaKey, rw, tag);
    const resolved = LT.rewardTable(P, areaKey)!;
    const parts: RollPart[] = resolved.picks.map(pk => {
      const t: HolderTable = {slot, source: 'reward', empty: pk.empty, lots: pk.lots, rows: pk.items};
      const {out, pRoll} = rawLot(P, kind, areaKey, t);
      return {pRoll, lots: pk.lots, raw: out, final: out};
    });
    expected = expectedOf(parts);
    gates.pNotEmpty = rd(1 - parts.reduce((e, p) => e * (1 - p.pRoll), 1));
    cls = resolved.picks.every(pk => pk.empty === 0 && pk.lots[0] >= 1 && pk.items.some(r => r[1] > 0)) ? 'guaranteed' : 'conditional';
    for (const pid of rewardPicks) B.use(pid, id);
    notes.push('Curated reward: rolled exactly (no keep cut, no re-theme, no limb conversion); every rolled lot is placed (up to REWARD_REPACKS re-packs). Keep / slot overrides do not reach it.');
  } else {
    tableId = identifyTable(B, level, P, tag, kind, areaKey, compartment, ht);
    B.use(tableId, id);
    const {out, pRoll} = rawLot(P, kind, areaKey, ht);
    const final = finalLot(P, kind, areaKey, ht.rows, out);
    gates.pNotEmpty = rd(pRoll);
    expected = expectedOf([{pRoll, lots: ht.lots, raw: out, final}]);
    if (ht.source === 'legacy') {
      const T = P.tables, room = T.areaWeights[areaKey] ?? T.areaWeights.default, mod = T.holderMod[kind];
      gates.categories = catShares(LEGACY_CATS.map((c, i) => [c, catWeight(P, c, room[i] * mod[i])] as const).filter(([, w]) => w > 0)).map(c => ({...c, weight: rd(c.weight)}));
      if (T.fullRooms.kinds.includes(kind) && T.fullRooms.rooms.has(areaKey)) { gates.fullRoomsExtra = T.fullRooms.extra; notes.push(`Stocked room: +${T.fullRooms.extra} lots at the high end (FULL_ROOMS).`); }
      if (!(areaKey in T.areaWeights)) notes.push(`Room type '${areaKey}' has no AREA_WEIGHTS row: the 'default' weights apply.`);
    }
    if (tableId.startsWith('narrowed:')) notes.push('Own table narrowed to the rows the room purpose stocks (items/loot.ts purposeRows).');
    if (CONTAINER_THEMED.has(kind)) notes.push('Container-themed: its own rows apply in any room (CONTAINER_THEMED); the room theme still steers scarce re-themes.');
  }
  if (compartment) notes.push('Separate compartment roll (drawers / cupboards; own stream and scarcity stream). Rolled when the holder\'s openable model is active — the shipped build loads every model.');
  if (occurrence.basis === 'declared') notes.push('Declared by a purpose / reward but not placed in any sample level (not exhaustive).');
  return {
    id, level, kind, kindLabel: label(kind), slot, compartment, areaKey, areaLabel, areaKind, source: ht.source, tableId,
    ...(rewardPicks ? {rewardPicks} : {}), gates, scarcity, expected, occurrence, class: cls, notes,
  };
}

/** The table a holder context draws from (by identity where possible; derived tables content-keyed). Asserts it equals holderTable's rows. */
function identifyTable(B: Builder, level: LevelId, P: LootProfile, tag: string, kind: string, areaKey: string, compartment: boolean, ht: HolderTable): string {
  let baseId: string;
  let baseRows: readonly Row[];
  if (ht.source === 'own') {
    const own = (compartment ? separateCompartmentLoot(kind) : containerLoot(kind)) as OwnTable | null | undefined;
    if (!own) throw new Error(`own table of ${kind} missing`);
    const ownId = B.idOf(own)!;
    baseId = ownId; baseRows = own.items;
    const spec = CONTAINER_THEMED.has(kind) ? undefined : purposeLoot(areaKey, kind);
    if (spec && spec.items.length) {
      const allowed = new Set(spec.items.map(r => r[0]));
      const rows = own.items.filter(r => allowed.has(r[0]));
      // named after the (own table, purpose table) pair it is derived from: one entry however many rooms share that purpose table
      const specId = () => B.purposeTableId(areaKey, kind) ?? `purpose:${areaKey}`;
      const specLabel = () => B.tables.get(specId())?.info.label ?? areaKey;
      const short = ownId.replace('OPENABLE_TABLES.', '');
      if (rows.length && !sameRows(rows, own.items)) {
        baseRows = rows;
        baseId = B.derived(`narrow:${ownId}|${specId()}`, () => ({
          id: `narrowed:${short}@${specId()}`, kind: 'narrowed', label: `${label(kind)} — own rows narrowed to what '${specLabel()}' stocks`, rows,
          at: B.src.at(F.loot, 'holderTable'), extra: {lots: own.lots, empty: own.empty, derivedFrom: [ownId, specId()], note: 'items/loot.ts purposeRows: an openable\'s own rows narrowed to the rows its room purpose stocks.',
            knobs: tableKnobs(B.src.at(F.tables, ownId), {lots: own.lots, empty: own.empty, rows})},
        }));
      } else if (!rows.length) {
        baseRows = spec.items;
        baseId = B.derived(`narrow:${ownId}|${specId()}`, () => ({
          id: `narrowed:${short}@${specId()}`, kind: 'narrowed', label: `${label(kind)} — no own row fits '${specLabel()}': the purpose's rows with the own lots / empty`,
          rows: spec.items, at: B.src.at(F.loot, 'holderTable'), extra: {lots: own.lots, empty: own.empty, derivedFrom: [ownId, specId()], note: 'items/loot.ts purposeRows: no own row overlaps the purpose stock, so the purpose\'s rows are used with the own table\'s lots / empty.',
            knobs: tableKnobs(B.src.at(F.tables, ownId), {lots: own.lots, empty: own.empty, rows: spec.items})},
        }));
      }
    }
  } else if (ht.source === 'purpose') {
    const id = B.purposeTableId(areaKey, kind);
    if (!id) throw new Error(`purpose table ${areaKey}/${kind} missing`);
    baseId = id;
    const p = purposeById(areaKey)!;
    const t = p.loot as Partial<Record<string, LootSpec>>;
    baseRows = (t[kind] ?? t.default ?? purposeLoot(areaKey, kind))!.items;
  } else {
    // legacy: the flattened room-type x holder-modifier categories x pools (resolved under the profile)
    const roomKey = areaKey in P.tables.areaWeights ? areaKey : 'default';
    baseRows = ht.rows;
    baseId = B.derived(`legacy:${kind}@${roomKey}${tag}|${rowKey(ht.rows)}`, () => ({
      id: `legacy:${kind}@${roomKey}${tag}`, kind: 'legacy', label: `${label(kind)} in a plain '${roomKey}' area (legacy room-type tables)`, rows: ht.rows,
      at: B.src.at(F.tables, `AREA_WEIGHTS.${roomKey}`),
      extra: {derivedFrom: [`AREA_WEIGHTS.${roomKey}`, `HOLDER_MOD.${kind}`, ...LEGACY_CATS.map(c => (kind === 'vending' && c === 'food' ? 'VENDING_FOOD' : `LEGACY_POOL.${c}`))],
        note: 'Flattened: a category per lot (AREA_WEIGHTS x HOLDER_MOD, the categories with weight > 0), then an item of that category\'s pool. Row weight = category weight x item share.',
        knobs: [
          {what: 'room category weights [food, drink, med, ammo]', value: (P.tables.areaWeights[roomKey] ?? []).join(' / '), at: B.src.at(F.tables, `AREA_WEIGHTS.${roomKey === 'default' ? 'default' : roomKey}`), overrides: ['categoryWeight', 'tables']},
          {what: 'holder modifier [food, drink, med, ammo]', value: (P.tables.holderMod[kind] ?? []).join(' / '), at: B.src.at(F.tables, 'HOLDER_MOD'), overrides: ['categoryWeight', 'tables']},
          {what: 'pool rows', value: 'LEGACY_POOL / VENDING_FOOD', at: B.src.at(F.tables, 'LEGACY_POOL'), overrides: ['itemWeight', 'categoryWeight', 'tables']},
        ]},
    }));
  }
  // resolution under the level profile (identity when untouched; legacy rows are resolved by construction)
  const resolved = ht.source === 'legacy' ? baseRows : resolveRows(P, baseRows);
  let id = baseId;
  if (resolved !== baseRows && !sameRows(resolved, baseRows)) {
    id = B.derived(`resolved:${baseId}${tag}|${rowKey(resolved)}`, () => ({
      id: `${baseId}${tag}`, kind: B.tables.get(baseId)?.info.kind ?? 'named', label: `${B.tables.get(baseId)?.info.label ?? baseId} (resolved under ${level} overrides)`, rows: resolved,
      at: B.tables.get(baseId)?.info.at ?? B.src.at(F.tables, 'resolveRows'), extra: {derivedFrom: [baseId], note: `Rows re-weighted by the ${level} profile's itemWeight / categoryWeight overrides (rows reaching 0 dropped).`},
    }));
  }
  const shown = B.tables.get(id)!.info.rows;
  if (!sameRows(shown.map(r => [r.itemId, r.weight] as const), ht.rows)) {
    throw new Error(`table ${id} (${level} ${kind}${compartment ? '.inside' : ''}@${areaKey}) disagrees with holderTable(): the reference would drift`);
  }
  return id;
}

function overrideEntries(P: LootProfile): OverrideEntry[] {
  const o = P.overrides ?? {}, out: OverrideEntry[] = [];
  const add = (knob: OverrideKnob, m: Readonly<Partial<Record<string, number>>> | undefined, prefix = '') => {
    for (const [k, v] of Object.entries(m ?? {})) if (typeof v === 'number') out.push({knob, key: prefix + k, multiplier: v});
  };
  add('itemWeight', o.itemWeight); add('categoryWeight', o.categoryWeight); add('keep', o.keep);
  for (const [slot, s] of Object.entries(o.slot ?? {})) {
    if (s?.empty !== undefined) out.push({knob: 'slot.empty', key: slot, multiplier: s.empty});
    if (s?.lots !== undefined) out.push({knob: 'slot.lots', key: slot, multiplier: s.lots});
  }
  add('floor.chance', o.floor?.chance); add('floor.count', o.floor?.count);
  if (o.gear?.mean !== undefined) out.push({knob: 'gear.mean', key: 'mean', multiplier: o.gear.mean});
  if (o.gear?.cap !== undefined) out.push({knob: 'gear.cap', key: 'cap (absolute)', multiplier: o.gear.cap});
  add('gear.weight', o.gear?.weight);
  return out;
}

function levelContexts(level: LevelId): LevelInfo['contexts'] {
  if (!LEVEL_ADAPTER[level].storeys) return {note: 'One continuous world; no storey / tenant contexts.'};
  const storeys: StoreyInfo[] = [
    {id: 'station', label: 'Station (platform storey)', layoutLevels: [0], floorVariant: 'street', note: 'Runs the street program together with the lobby (one run for both).'},
    {id: 'lobby', label: `Lobby (floor ${OFFICE_FLOORS[0]})`, layoutLevels: [OFFICE_FLOORS[0]], floorVariant: 'street'},
    ...TENANT_FLOORS.map(f => ({id: `floor-${f}`, label: `Floor ${f}`, layoutLevels: [f], floorVariant: 'tower (tenant tilt)', note: 'The floor\'s tenant company decides the tilt (seeded per level).'})),
    {id: 'roof', label: 'Roof', layoutLevels: [OFFICE_ROOF_LEVEL], floorVariant: 'none', note: 'No floor program; the roof cache reward crate.'},
  ];
  const companies: CompanyInfo[] = COMPANY_IDS.map(id => ({id, name: COMPANIES[id].name, tilt: COMPANIES[id].loot, note: COMPANIES[id].note}));
  return {
    storeys, companies,
    note: `Office Space is ONE logical level: one loot profile, one rare-gear roll, one gas-mask roll and one weapon plan for the whole tower. Storeys and tenant companies are CONTEXTS (they change room purposes and the per-storey floor program's tilt), never separate levels or rolls. Floors ${TENANT_FLOORS[0]}–${TENANT_FLOORS[TENANT_FLOORS.length - 1]} each get a company from the ${COMPANY_IDS.length}-company pool (seeded shuffle; in ${TWO_FLOOR_CHANCE * 100} % of levels one company takes two consecutive floors).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Economy (resolved under the level profile)

function economyOf(B: Builder, P: LootProfile): EconomyInfo {
  const X = P.tables;
  const at = (s: string) => B.src.at(F.tables, s);
  const themes = Object.entries(X.themes).map(([id, T]) => ({
    id, keep: T.keep, on: T.on, cats: [...T.cats],
    weights: catShares(T.cats.map(c => [c, catWeight(P, c, T.weights[c] ?? 0)] as const)),
    limbShare: X.limb.share[id as keyof typeof X.limb.share] ?? 0,
    purposes: ALL_PURPOSES.filter(p => p.theme === id).map(p => p.id).sort(),
    roomTypes: Object.entries(THEME_OF_TYPE).filter(([, t]) => t === id).map(([k]) => k).sort(),
  }));
  const poolId = (rows: ItemRows, fallback: string) => B.idOf(rows) ?? B.register(rows, `${fallback}~${P.id}`, 'pool', `${fallback} (${P.id} tables)`, rows, B.src.at(F.tables, fallback));
  return {
    themes, offTheme: catShares(ECON_CATS.map(c => [c, catWeight(P, c, X.offTheme[c])] as const)),
    globalPool: Object.fromEntries(ECON_CATS.map(c => [c, poolId(X.globalPool[c], `GLOBAL_POOL.${c}`)])),
    themeOfType: {...THEME_OF_TYPE},
    allow: Object.entries(HOLDER_ALLOW).map(([kind, cats]) => ({kind, cats: [...(cats ?? [])]})),
    containerThemed: [...CONTAINER_THEMED].sort(), randomHolders: [...RANDOM_HOLDERS].sort(),
    boxCount: Object.entries(X.boxCount).map(([itemId, b]) => ({itemId, small: b.small, big: b.big})),
    bigBoxHolders: [...X.bigBoxHolders].sort(),
    handful: Object.entries(X.handful).map(([itemId, range]) => ({itemId, range})), handfulFallback: X.handfulFallback,
    limb: {share: {...X.limb.share}, holder: {...X.limb.holder} as Record<string, number>, poolTable: poolId(X.limb.pool, 'LIMB_ECONOMY.pool')},
    legacy: {
      areaWeights: Object.entries(X.areaWeights).map(([roomType, weights]) => ({roomType, weights: [...weights]})),
      holderMod: Object.entries(X.holderMod).map(([kind, mod]) => ({kind, mod: [...mod]})),
      cats: [...LEGACY_CATS], fullRooms: {rooms: [...X.fullRooms.rooms].sort(), kinds: [...X.fullRooms.kinds], extra: X.fullRooms.extra},
      pools: Object.fromEntries(LEGACY_CATS.map(c => [c, poolId(X.pool[c], `LEGACY_POOL.${c}`)])), vendingFood: poolId(X.vendingFood, 'VENDING_FOOD'),
    },
    knobs: [
      {what: 'theme keep chances', value: 'THEME_ECONOMY[theme].keep', at: at('THEME_ECONOMY'), overrides: ['keep', 'tables']},
      {what: 'theme on-theme share', value: 'THEME_ECONOMY[theme].on', at: at('THEME_ECONOMY'), overrides: ['tables']},
      {what: 'theme re-pick weights', value: 'THEME_ECONOMY[theme].weights', at: at('THEME_ECONOMY'), overrides: ['categoryWeight', 'tables']},
      {what: 'off-theme category weights', value: 'OFF_THEME_WEIGHTS', at: at('OFF_THEME_WEIGHTS'), overrides: ['categoryWeight', 'tables']},
      {what: 'global pool rows', value: 'GLOBAL_POOL', at: at('GLOBAL_POOL'), overrides: ['itemWeight', 'categoryWeight', 'tables']},
      {what: 'eligibility (allow lists)', value: 'HOLDER_ALLOW', at: at('HOLDER_ALLOW'), overrides: ['none']},
      {what: 'container-themed storage', value: 'CONTAINER_THEMED', at: at('CONTAINER_THEMED'), overrides: ['none']},
      {what: 'random (junk) holders', value: 'RANDOM_HOLDERS', at: at('RANDOM_HOLDERS'), overrides: ['none']},
      {what: 'theme of room types', value: 'THEME_OF_TYPE', at: at('THEME_OF_TYPE'), overrides: ['none']},
      {what: 'box sizes', value: 'BOX_COUNT', at: at('BOX_COUNT'), overrides: ['tables']},
      {what: 'off-theme ammo handfuls', value: 'HANDFUL', at: at('HANDFUL'), overrides: ['tables']},
      {what: 'limb treatment shares', value: 'LIMB_ECONOMY.share / .holder', at: at('LIMB_ECONOMY'), overrides: ['tables']},
      {what: 'legacy room / holder category weights', value: 'AREA_WEIGHTS / HOLDER_MOD', at: at('AREA_WEIGHTS'), overrides: ['categoryWeight', 'tables']},
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Loose floor programs

function totals(finds: readonly FloorFind[]): {itemId: string; copies: number; units: number}[] {
  const m = new Map<string, {copies: number; units: number}>();
  for (const f of finds) { const e = m.get(f.itemId) ?? {copies: 0, units: 0}; e.copies += f.expectedCopies; e.units += f.expectedUnits; m.set(f.itemId, e); }
  return [...m.entries()].map(([itemId, e]) => ({itemId, copies: rd(e.copies), units: rd(e.units)}));
}

function floorProgram(B: Builder, level: LevelId, P: LootProfile): FloorProgramInfo {
  const kind = LEVEL_ADAPTER[level].floor;
  const at = (s: string) => B.src.at(F.tables, s);
  const src = `floor:${level}`;
  const find = (stage: string, itemId: string, count: number, copies: Range | null, chance: number | null, knobs: TuningKnob[], note?: string): FloorFind => {
    const ec = (copies ? meanInt(copies[0], copies[1]) : 1) * (chance ?? 1);
    B.addSource(itemId, src);
    return {stage, itemId, count, copies, chance, expectedCopies: rd(ec), expectedUnits: rd(ec * count), knobs, ...(note ? {note} : {})};
  };
  const themeWeights = {name: 'FLOOR_ECONOMY.themeWeight (battery / flare / food finds, by room theme)', weights: {...LT.FLOOR_ECONOMY.themeWeight} as Record<string, number>};
  const purposeFloor = {name: 'purpose floor weights (gen/purposes.ts `floor`: ammo / med)', weights: Object.fromEntries(ALL_PURPOSES.filter(p => p.floor).flatMap(p => Object.entries(p.floor!).map(([c, w]) => [`${p.id}:${c}`, w as number])))};
  if (kind === 'subway') {
    const S = P.tables.floor.subway;
    const finds: FloorFind[] = [];
    S.boxes.forEach((b, i) => { const n = floorCount(P, econCat(b.itemId), b.n); finds.push(find('boxes', b.itemId, b.count, n, null, [{what: `copies of the ${b.itemId} box`, value: b.n, at: at(`SUBWAY_FLOOR.boxes`), overrides: ['floor.count', 'tables']}], i === 0 ? 'n copies on the spawn stream' : undefined)); });
    for (const k of S.kept) {
      const n = floorCount(P, econCat(k.itemId), k.n), keep = floorChance(P, econCat(k.itemId), k.keep);
      finds.push(find('kept', k.itemId, k.count, n, keep, [
        {what: `old loose ${k.itemId} copies`, value: k.n, at: at('SUBWAY_FLOOR.kept'), overrides: ['floor.count', 'tables']},
        {what: 'keep chance per copy', value: k.keep, at: at('FLOOR_ECONOMY.medKeep'), overrides: ['floor.chance', 'tables']},
      ], 'each copy kept with the keep chance (scarce-floor fork)'));
    }
    for (const c of S.light) finds.push(find('light', c.itemId, c.count, null, floorChance(P, econCat(c.itemId), c.chance), [{what: `${c.itemId} chance`, value: c.chance, at: at('FLOOR_ECONOMY'), overrides: ['floor.chance', 'tables']}]));
    return {
      id: 'subway', level, label: 'Subway station loose floor supplies (once per station)',
      variants: [{id: 'station', label: 'Station', runs: 'once per station (gen/stationDress.ts placeSpawns)', finds, totals: totals(finds)}],
      placement: {derivable: false, reason: 'Each find is dropped into a weighted area (ammo / med: purpose `floor` weights, else PUBLIC_FLOOR_WEIGHTS.station; battery / flare: FLOOR_ECONOMY.themeWeight) on a free floor cell >= 12 m from the spawn (or on a low cabinet); a draw with no free cell places nothing. How often that happens depends on the generated layout.',
        weights: [{name: 'PUBLIC_FLOOR_WEIGHTS.station (public areas without a purpose)', weights: {...LT.PUBLIC_FLOOR_WEIGHTS.station} as Record<string, number>}, purposeFloor, themeWeights]},
      perLevel: {basis: 'exact expected attempts per Subway level (one station program), before placement', totals: totals(finds)},
      at: [at('SUBWAY_FLOOR'), B.src.at(F.stationDress, 'placeSpawns')],
      knobs: [{what: 'the whole program', value: 'SUBWAY_FLOOR', at: at('SUBWAY_FLOOR'), overrides: ['floor.chance', 'floor.count', 'tables']}],
      notes: ['Ammo boxes are single-caliber (5.56 / 12-gauge); the pistol start\'s 9mm boxes are a separate weapon-finds source.', 'Zombies are placed on the same spawn stream afterwards: changing these draws moves them too.'],
    };
  }
  const O = P.tables.floor.office;
  const scarce = (tilt: LootTilt): FloorFind[] => {
    const odds = scarceOdds(tilt, O);
    const pMed = floorChance(P, 'med', odds[0]), pBat = floorChance(P, 'battery', odds[1]), pFlare = floorChance(P, 'flare', odds[2]), pFood = floorChance(P, 'food', odds[3]);
    const k = (what: string, ov: OverrideKnob[]): TuningKnob[] => [{what, value: 'OFFICE_FLOOR.scarce / tilt', at: at('OFFICE_FLOOR.scarce'), overrides: ov}];
    const out = [
      find('scarce.med', 'medkit', 1, null, pMed * O.scarce.medkit, k('med chance x first-aid-kit share', ['floor.chance', 'tables']), `med find ${rd(pMed)}, a first-aid kit in ${O.scarce.medkit} of them`),
      find('scarce.med', 'bandage', 1, null, pMed * (1 - O.scarce.medkit), k('med chance x bandage share', ['floor.chance', 'tables'])),
      find('scarce.battery', LT.BATTERY_ID, 1, null, pBat, k('battery chance', ['floor.chance', 'tables'])),
      find('scarce.flare', LT.FLARE_ID, 1, null, pFlare, k('flare chance', ['floor.chance', 'tables'])),
    ];
    if (pFood > 0) for (const id of O.scarce.food) out.push(find('scarce.food', id, 1, null, pFood / O.scarce.food.length, k('food chance (uniform item)', ['floor.chance', 'tables'])));
    return out;
  };
  const sc = floorCount(P, econCat(O.street.box.itemId), [1, 1]);
  const street = [
    find('street.box', O.street.box.itemId, O.street.box.count, sc, null, [{what: 'street box copies', value: '[1, 1]', at: at('OFFICE_FLOOR.street'), overrides: ['floor.count']}]),
    find('street.extra', O.street.extra.itemId, O.street.extra.count, null, floorChance(P, econCat(O.street.extra.itemId), O.street.extra.chance), [{what: 'extra box chance', value: O.street.extra.chance, at: at('OFFICE_FLOOR.street'), overrides: ['floor.chance', 'tables']}]),
    ...scarce('none'),
  ];
  const variants: FloorVariant[] = [{id: 'street', label: 'Street storey (station + lobby)', runs: 'once per Office level (floor 1: the station and the lobby together)', finds: street, totals: totals(street)}];
  const tilts = Object.keys(O.tilt) as LootTilt[];
  for (const tilt of tilts) {
    const th = (tilt === 'ammo' ? O.tower.ammoThresholds : O.tower.thresholds).map((t, i) => floorChance(P, econCat(O.tower.boxes[i].itemId), t));
    const bands = thresholdBands(th);
    const finds = [
      ...O.tower.boxes.map((b, i) => find('tower.box', b.itemId, b.count, null, bands.probs[i], [{what: `box band ${i + 1} (cumulative threshold)`, value: (tilt === 'ammo' ? O.tower.ammoThresholds : O.tower.thresholds)[i], at: at(`OFFICE_FLOOR.tower`), overrides: ['floor.chance', 'tables']}],
        i === 0 ? `one draw: box by cumulative thresholds (${tilt === 'ammo' ? 'ammoThresholds' : 'thresholds'}); none in ${rd(bands.none)}` : undefined)),
      ...scarce(tilt),
    ];
    const companies = COMPANY_IDS.filter(id => COMPANIES[id].loot === tilt);
    variants.push({
      id: `tower:${tilt}`, label: `Tower floor — tenant tilt '${tilt}'`, runs: `once per tower floor whose tenant has the '${tilt}' tilt (${companies.length} of ${COMPANY_IDS.length} companies)`,
      finds, totals: totals(finds), tilt: {id: tilt, multipliers: [...O.tilt[tilt]], companies, odds: scarceOdds(tilt, O).map(rd)},
    });
  }
  // per level: the street run + every tenant floor, each floor's company uniform over the pool (seeded shuffle; marginal per floor)
  const per = new Map<string, {copies: number; units: number}>();
  const addT = (list: readonly {itemId: string; copies: number; units: number}[], w: number) => { for (const t of list) { const e = per.get(t.itemId) ?? {copies: 0, units: 0}; e.copies += w * t.copies; e.units += w * t.units; per.set(t.itemId, e); } };
  addT(variants[0].totals, 1);
  for (const v of variants.slice(1)) addT(v.totals, TENANT_FLOORS.length * (v.tilt!.companies.length / COMPANY_IDS.length));
  return {
    id: 'office', level, label: 'Office Space loose floor supplies (per physical storey, one profile)',
    variants,
    placement: {derivable: false, reason: 'Each find goes to a weighted area of that storey (ammo / med: purpose `floor` weights, else PUBLIC_FLOOR_WEIGHTS.officeStorey; battery / flare / food: FLOOR_ECONOMY.themeWeight), a walkable cell >= 16 cells walking from the platform start and off the stair / elevator landings (10 tries); a draw with no cell places nothing.',
      weights: [{name: 'PUBLIC_FLOOR_WEIGHTS.officeStorey (public areas without a purpose)', weights: {...LT.PUBLIC_FLOOR_WEIGHTS.officeStorey} as Record<string, number>}, purposeFloor, themeWeights]},
    perLevel: {basis: `exact expected attempts per Office level before placement: the street run + ${TENANT_FLOORS.length} tenant floors, each floor's company uniform over the ${COMPANY_IDS.length}-company pool (seeded shuffle; a two-floor tenant repeats on the next floor, the per-floor marginal stays uniform)`,
      totals: [...per.entries()].map(([itemId, e]) => ({itemId, copies: rd(e.copies), units: rd(e.units)}))},
    at: [at('OFFICE_FLOOR'), at('OFFICE_FLOOR_TILT'), B.src.at(F.officeSpawns, 'placeOfficeSupplies'), B.src.at(F.officeSpawns, 'scarceOdds')],
    knobs: [
      {what: 'the whole program', value: 'OFFICE_FLOOR', at: at('OFFICE_FLOOR'), overrides: ['floor.chance', 'floor.count', 'tables']},
      {what: 'company tilts [med, battery, flare, food]', value: 'OFFICE_FLOOR_TILT', at: at('OFFICE_FLOOR_TILT'), overrides: ['tables']},
      {what: 'which company has which tilt', value: 'COMPANIES[id].loot', at: B.src.at(F.companies, 'COMPANIES'), overrides: ['none']},
    ],
    notes: [
      'A tilt shifts the MIX of the scarce finds, renormalised to the untilted total (same expected count; each odd capped at OFFICE_FLOOR.scarce.cap).',
      'Office Space is one logical level: the program runs once per physical storey under the one office profile.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Special sources

function specialSources(B: Builder, profiles: ReadonlyMap<LevelId, LootProfile>): SpecialSource[] {
  const out: SpecialSource[] = [];
  const levels = [...LEVEL_IDS];
  const T = (s: string) => B.src.at(F.tables, s);
  const add = (s: SpecialSource) => { out.push(s); for (const it of s.items) B.addSource(it.itemId, s.id); };

  // --- rare gear (one roll per logical level; grouped by identical resolved parameters)
  const groups = new Map<string, LevelId[]>();
  for (const l of levels) { const k = JSON.stringify(gearParams(profiles.get(l)!)); groups.set(k, [...(groups.get(k) ?? []), l]); }
  for (const [, ls] of groups) {
    const g = gearParams(profiles.get(ls[0])!);
    const w = Object.entries(g.weights).filter(([id, x]) => GEAR_ITEMS[id] && x > 0);
    const dist = cappedPoisson(g.mean, g.cap);
    const den = w.reduce((s, x) => s + x[1], 0);
    const per = new Map<string, {pAny: number; mean: number}>();
    for (const {k, p} of dist) for (const r of halvingPicks(w, k)) { const e = per.get(r.id) ?? {pAny: 0, mean: 0}; e.pAny += p * r.pAny; e.mean += p * r.mean; per.set(r.id, e); }
    add({
      id: groups.size === 1 ? 'gear' : `gear:${ls.join('+')}`, family: 'gear', label: 'Rare gear (level-wide roll)', class: 'special', levels: ls,
      summary: `ONE roll per logical level (key gear-roll:<level>; Office storeys never roll separately): count ~ Poisson(${g.mean}) capped at ${g.cap}, pieces drawn by weight with a repeat of the same piece half as likely each time; placed as floor pickups in back-of-house rooms >= ${GEAR_MIN_SPAWN_M} m from the spawn.`,
      items: w.map(([itemId, weight]) => ({itemId, count: 1, weight, share: rd(weight / den), chance: rd(per.get(itemId)!.pAny),
        note: `first-pick share ${rd(weight / den)}; P(the level's roll includes it) = ${rd(per.get(itemId)!.pAny)} (exact, before placement); expected copies ${rd(per.get(itemId)!.mean)}`})),
      denominator: rd(den), distribution: dist.map(d => ({k: d.k, p: rd(d.p)})), expected: rd(expectation(dist)),
      probability: '`share` is the FIRST pick\'s conditional share (weight / Σ). Later picks halve the weight of every piece already drawn, so shares shift; `chance` is the exact probability that the level\'s ONE roll contains the piece (sum over the capped Poisson count of the exact repeat-halving draw), before placement. Placement fails only if the layout has no reachable floor cell.',
      knobs: [
        {what: 'mean (Poisson)', value: g.mean, at: T('GEAR_MEAN_PER_LEVEL'), overrides: ['gear.mean', 'tables']},
        {what: 'cap', value: g.cap, at: T('GEAR_CAP_PER_LEVEL'), overrides: ['gear.cap', 'tables']},
        {what: 'piece weights', value: `${w.length} pieces`, at: T('GEAR_WEIGHTS'), overrides: ['gear.weight', 'tables']},
        {what: 'repeat halving (x0.5)', value: 0.5, at: B.src.at(F.gearLoot, 'rollLevelGear'), overrides: ['none']},
      ],
      at: [T('GEAR_LOOT'), B.src.at(F.gearLoot, 'rollLevelGear'), B.src.at(F.gearLoot, 'gearCountFor'), B.src.at(F.gearLoot, 'gearAreaWeight')],
    });
  }

  // --- gas masks / filters (MASK_LOOT, own roll per logical level)
  const maskLevels = levels.filter(l => MASK_LOOT.levels[l]);
  const [f0, f1] = MASK_LOOT.foundFilter;
  for (const [id, itemId, key, lab] of [['gas-mask', GAS_MASK_ID, 'masks', 'Gas masks'], ['gas-filter', GAS_FILTER_ID, 'filters', 'Gas-mask filters']] as const) {
    add({
      id, family: 'mask', label: `${lab} (level-wide roll)`, class: 'special', levels: maskLevels,
      summary: `ONE roll per logical level with its own key (${key === 'masks' ? 'mask-roll' : 'filter-roll'}:<level>): a count drawn uniformly from the level's range, placed with the gear rules.${key === 'masks' ? ` Each found mask carries a partly used filter: ${f0 * 100}–${f1 * 100} % of ${FILTER_LIFE_S} s (uniform).` : ''} No starter mask or filters.`,
      items: [{itemId, count: 1}],
      perLevel: maskLevels.map(l => {
        const [lo, hi] = MASK_LOOT.levels[l][key];
        const dist = uniformInt(lo, hi).map(d => ({k: d.n, p: rd(d.p)}));
        return {level: l, summary: `${lo}–${hi} (uniform)${lo >= 1 ? ' — at least one guaranteed (before placement)' : ` — P(none) ${rd(1 / (hi - lo + 1))}`}`, distribution: dist, expected: rd(meanInt(lo, hi))};
      }),
      probability: 'Exact count distribution per level (uniform integer range), before placement.',
      knobs: [{what: `${key} range per level`, value: 'MASK_LOOT.levels', at: B.src.at(F.maskLoot, `MASK_LOOT.levels`), overrides: ['none']},
        ...(key === 'masks' ? [{what: 'found filter charge', value: [f0, f1] as Range, at: B.src.at(F.maskLoot, 'MASK_LOOT.foundFilter'), overrides: ['none' as const]}] : [])],
      at: [B.src.at(F.maskLoot, 'MASK_LOOT'), B.src.at(F.maskLoot, 'rollMaskLoot')],
    });
  }

  // --- weapon finds + paired ammo
  const start: StartWeaponId = startWeaponFor(false);
  const weapons = findWeaponsFor(start);
  const copies = [{k: 0, p: rd(FIND_COPY_THRESHOLDS.none)}, {k: 1, p: rd(FIND_COPY_THRESHOLDS.one - FIND_COPY_THRESHOLDS.none)}, {k: FIND_MAX_PER_WEAPON, p: rd(1 - FIND_COPY_THRESHOLDS.one)}];
  const storeyW = officeWeaponStoreyWeights(), swd = storeyW.reduce((s, x) => s + x[1], 0);
  add({
    id: 'weapon-finds', family: 'weapon', label: 'Weapon finds + paired ammo', class: 'special', levels,
    summary: `Start weapon (shipped): ${start}. Every other weapon (${weapons.join(', ')}) is a map find: 0 / 1 / ${FIND_MAX_PER_WEAPON} copies per weapon from one draw; a box of its OWN caliber lies beside every copy (the deliberate exception to generic ammo). Rifle-start fallback finds: ${findWeaponsFor('rifle').join(', ')}.`,
    items: weapons.flatMap(wid => [{itemId: wid, count: 1, note: 'per copy'}, {itemId: WEAPON_FIND_AMMO[wid][0], count: WEAPON_FIND_AMMO[wid][1], note: `paired with each ${wid} copy`}]),
    distribution: copies, expected: rd(expectation(copies)),
    probability: 'Copies per non-start weapon: exact distribution of one uniform draw (thresholds FIND_COPY_THRESHOLDS), independent per weapon, before placement (placement retries can fail in a cramped layout).',
    perLevel: levels.map(l => LEVEL_ADAPTER[l].weapons === 'station'
      ? {level: l, summary: `gen/weaponFinds.ts placeWeaponFinds: plausible back-of-house rooms (security office, lockers, workshops, platform-end work zones), >= ${FIND_MIN_SPAWN_M} m from the spawn (straight line and path); a second copy well away from the first.`}
      : {level: l, summary: `gen/office/spawns.ts officeWeaponPlan: ONE plan per level picks the storey of each copy (storey weights ${storeyW.map(([s, x]) => `${s === 1 ? 'street' : s}: ${rd(x / swd)}`).join(', ')} — first-copy shares), then placeOfficeWeapons drops it in a weighted room of that storey >= 30 cells walking from the start.`}),
    knobs: [
      {what: 'copy thresholds (0 / 1 / 2 copies)', value: `${FIND_COPY_THRESHOLDS.none} / ${FIND_COPY_THRESHOLDS.one}`, at: B.src.at(F.weaponFinds, 'FIND_COPY_THRESHOLDS'), overrides: ['none']},
      {what: 'max copies per weapon', value: FIND_MAX_PER_WEAPON, at: B.src.at(F.weaponFinds, 'FIND_MAX_PER_WEAPON'), overrides: ['none']},
      {what: 'paired ammo box', value: 'WEAPON_FIND_AMMO', at: B.src.at(F.weaponFinds, 'WEAPON_FIND_AMMO'), overrides: ['none']},
      {what: 'office storey weights', value: 'officeWeaponStoreyWeights()', at: B.src.at(F.officeSpawns, 'officeWeaponStoreyWeights'), overrides: ['none']},
    ],
    at: [B.src.at(F.weaponFinds, 'placeWeaponFinds'), B.src.at(F.officeSpawns, 'officeWeaponPlan'), B.src.at(F.officeSpawns, 'placeOfficeWeapons'), B.src.at(F.pistol, 'startWeaponFor')],
  });
  const boxLevels = levels.filter(l => LEVEL_ADAPTER[l].pistolBoxes);
  if (start === 'pistol' && boxLevels.length) {
    const [lo, hi] = PISTOL_START_BOXES.n;
    add({
      id: 'pistol-start-boxes', family: 'weapon', label: 'Pistol-start 9mm floor boxes', class: 'special', levels: boxLevels,
      summary: `With the pistol start the station adds ${lo}–${hi} loose ${PISTOL_START_BOXES.itemId} boxes of ${PISTOL_START_BOXES.count} rounds in back-of-house rooms (gen/weaponFinds.ts, after the weapon finds).`,
      items: [{itemId: PISTOL_START_BOXES.itemId, count: PISTOL_START_BOXES.count, note: 'per box'}],
      distribution: uniformInt(lo, hi).map(d => ({k: d.n, p: rd(d.p)})), expected: rd(meanInt(lo, hi)),
      probability: 'Exact box count distribution (uniform), before placement (8 placement tries per box).',
      knobs: [{what: 'boxes', value: [lo, hi], at: B.src.at(F.weaponFinds, 'PISTOL_START_BOXES'), overrides: ['none']}],
      at: [B.src.at(F.weaponFinds, 'PISTOL_START_BOXES')],
    });
  }

  // --- starter kit (NewGame only; guaranteed)
  const kit = (w: StartWeaponId) => {
    const inv = starterInventory(w);
    const slots: [string, readonly ({itemId: string; count: number; mag?: number} | null)[]][] = [['quick slot', inv.hotbar], ['pocket', inv.pack], ['grenade slot', inv.throwSlot], ['melee slot', inv.meleeSlot], ['gear slot', inv.gearSlots]];
    return slots.flatMap(([where, list]) => list.map((s, i) => (s ? {itemId: s.itemId, count: s.count, note: `${where} ${where === 'quick slot' ? i + 1 : ''}`.trim() + (s.mag ? ` (magazine ${s.mag})` : '')} : null)).filter((x): x is NonNullable<typeof x> => !!x));
  };
  const other: StartWeaponId = start === 'pistol' ? 'rifle' : 'pistol';
  add({
    id: 'starter-kit', family: 'starter', label: 'Starter kit (New Game)', class: 'guaranteed', levels,
    summary: `Handed out ONCE per run by New Game (travel never touches the inventory). Shipped start weapon: ${start}. ${other}-start fallback kit: ${kit(other).map(k => `${k.count} x ${k.itemId}`).join(', ')}.`,
    items: kit(start), probability: 'Guaranteed: always exactly these stacks at the start of a run (not per level).',
    knobs: [{what: 'the kit', value: 'starterInventory()', at: B.src.at(F.starter, 'starterInventory'), overrides: ['none']}],
    at: [B.src.at(F.starter, 'starterInventory'), B.src.at(F.pistol, 'startWeaponFor')],
  });

  // --- curated rewards (the roof cache): one source per reward key a level's generator places
  const rewardKeys = new Set<string>();
  for (const l of levels) for (const k of Object.keys(profiles.get(l)!.tables.rewards ?? {})) rewardKeys.add(k);
  for (const key of [...rewardKeys].sort()) {
    const ls = levels.filter(l => profiles.get(l)!.tables.rewards?.[key] && LEVEL_ADAPTER[l].rewards.includes(key));
    const rw = (ls.length ? LT.rewardTable(profiles.get(ls[0])!, key) : undefined) ?? REWARD_TABLES[key];
    if (!rw) continue;
    const base = (ls.length ? profiles.get(ls[0])!.tables.rewards?.[key] : undefined) ?? REWARD_TABLES[key];
    for (const pid of base.picks.map(p => B.idOf(p)).filter((x): x is string => !!x)) B.use(pid, `reward:${key}`);
    const guaranteed = rw.picks.every(p => p.empty === 0 && p.lots[0] >= 1 && p.items.some(r => r[1] > 0));
    add({
      id: `reward:${key}`, family: 'reward', label: `${rw.label} (curated reward)`, class: guaranteed ? 'guaranteed' : 'conditional', levels: ls,
      summary: `Holder '${rw.holder}' with loot key '${key}'. Picks roll in order on the holder's own stream: ${rw.picks.map((p, i) => `pick ${i + 1}: ${p.lots[0]}–${p.lots[1]} lot(s), empty ${p.empty}`).join('; ')}. Exempt from the scarcity cut; every rolled lot is placed; finite and remembered; no gear roll.${ls.length ? '' : ' NOT placed by any registered level generator.'}`,
      items: rw.picks.flatMap((p, i) => { const pr = pickProbs(p.items.map(r => r[1])); return p.items.map(([itemId, weight], j) => ({itemId, weight, share: rd(pr[j]), note: `pick ${i + 1}`})); }),
      probability: 'Each pick: guaranteed when empty 0 and lots >= 1; `share` = the conditional share within its pick. Stack sizes follow BOX_COUNT (big boxes: the crate).',
      knobs: [{what: 'reward table', value: key, at: T('ROOF_CACHE'), overrides: ['itemWeight', 'categoryWeight', 'rewards']}, {what: 'placement', value: 'placeRoofReward', at: B.src.at(F.roof, 'placeRoofReward'), overrides: ['none']}],
      at: [T('ROOF_CACHE'), T('REWARD_TABLES'), B.src.at(F.roof, 'placeRoofReward'), B.src.at(F.loot, 'REWARD_REPACKS')],
    });
  }

  // --- fixtures (baked contents, no loot) and compartment contents text
  for (const kind of [...CONTAINER_KINDS].filter(k => containerLoot(k) === null)) {
    add({
      id: `fixture:${kind}`, family: 'fixture', label: `${label(kind)} (fixture)`, class: 'non-loot', levels,
      summary: `Opens, shows its baked contents ("${openableSpec(kind)?.contents ?? '—'}") and rolls nothing (loot: null).`,
      items: [], probability: 'Non-loot: nothing can be taken.', knobs: [{what: 'spec', value: 'loot: null', at: B.src.at(F.openables, `OPENABLE_SPECS.${kind}`, kind), overrides: ['none']}],
      at: [B.src.at(F.openables, 'containerLoot')],
    });
  }
  const parts = Object.entries(OPENABLE_SPECS as Readonly<Record<string, {parts: readonly {name: string; contents?: string}[]; loot?: unknown}>>)
    .flatMap(([kind, s]) => s.parts.filter(p => p.contents).map(p => `${label(kind)} — ${p.name}: "${p.contents}"`));
  add({
    id: 'part-contents', family: 'fixture', label: 'Compartments with baked contents', class: 'non-loot', levels,
    summary: `Compartments that show text instead of loot (the holder's other compartments still roll): ${parts.join('; ')}.`,
    items: [], probability: 'Non-loot.', knobs: [], at: [B.src.at(F.openables, 'OPENABLE_SPECS')],
  });

  // --- interaction rules (move existing lots; never roll new ones)
  const spill = Object.keys(OPENABLE_SPECS).filter(isSpillHolderKind);
  add({id: 'vending-pry', family: 'interaction', label: 'Vending machines: pry open / spill', class: 'non-loot', levels,
    summary: 'A vending machine is pried open ([E] hold); its already-rolled lots spill out in front of it. No new loot.', items: [],
    probability: 'Non-loot: moves the holder\'s finite rolled lots.', knobs: [], at: [B.src.at(F.containers, 'settleSpill'), B.src.at(F.loot, 'nextHolderAction')]});
  add({id: 'spill-holders', family: 'interaction', label: 'Light holders spill when shot loose', class: 'non-loot', levels,
    summary: `Light dynamic holders (${spill.map(label).join(', ')}) go loose when shot and spill their finite lots as real pickups. No new loot.`, items: [],
    probability: 'Non-loot.', knobs: [], at: [B.src.at(F.openables, 'isSpillHolderKind'), B.src.at(F.dynamicItems, 'DynamicItems')]});
  add({id: 'shot-detach', family: 'interaction', label: 'Shot loot lots detach', class: 'non-loot', levels,
    summary: 'A shot (or knocked) visible lot is lifted off its holder into a pickup with the SAME item id and count; it is never duplicated or erased.', items: [],
    probability: 'Non-loot.', knobs: [], at: [B.src.at(F.dynamicItems, 'DynamicItems'), B.src.at(F.containers, 'detachLot')]});
  add({id: 'shelf-filler', family: 'decoration', label: 'Shelf filler stock', class: 'decoration-only', levels,
    summary: 'Packaged pieces on stocked shelves are decoration with physics, never loot items (they cannot be taken).', items: [],
    probability: 'Decoration only.', knobs: [], at: [B.src.at(F.fillerStock, 'FillerStock')]});
  const moved = levels.filter(l => LEVEL_ADAPTER[l].floorMoved);
  if (moved.length) add({id: 'floor-moved', family: 'floor-moved', label: 'Multi-level stations: loose supplies moved between levels', class: 'non-loot', levels: moved,
    summary: 'On stations with upper / lower levels, a weighted share of the existing loose ammo / dressings (and zombies) is moved onto those levels (PUBLIC_FLOOR_WEIGHTS.stationLevels). Totals unchanged.', items: [],
    probability: 'Non-loot: moves existing floor finds.', knobs: [{what: 'area weights', value: 'PUBLIC_FLOOR_WEIGHTS.stationLevels', at: T('PUBLIC_FLOOR_WEIGHTS'), overrides: ['none']}],
    at: [B.src.at(F.levelGenDress, 'placeLevelSpawns')]});
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Probability notes (shown on the site)

const PROBABILITY: readonly ProbabilityNote[] = [
  {id: 'weight', title: 'Weight is not a chance', text: 'A row\'s weight only matters relative to the other rows of the SAME table. Changing one weight shifts draws between that table\'s rows; it says nothing about how often the table is drawn at all.'},
  {id: 'share', title: 'Share = conditional selection chance', text: 'share = weight / Σ weights of that table (the denominator is shown). It is the chance that ONE lot drawn from that table, in that context, is that item — given that a lot is drawn. It is not the chance a holder contains the item and not a chance per level.'},
  {id: 'gates', title: 'Stage gates of a holder', text: 'Each holder rolls once: empty? (empty chance) -> lot count n ~ U{lo..hi} (E[n] = (lo + hi) / 2) -> per lot an item by share (+ stack size) -> scarcity: ammo kept exactly; any other entry survives with the theme\'s keep chance, then is on-theme (the theme\'s chance) or off-theme and may be re-themed within the holder\'s allow list -> limb post-pass (some bandages / first-aid kits become limb treatments) -> fit / occupancy on the real surfaces (items that fit nowhere are dropped). Contents are finite, rolled once and remembered; nothing refills.'},
  {id: 'expected', title: 'Expected units before fit (exact)', text: 'Expected lots / units per holder are computed analytically from the same values the roll functions read (exact under ideal uniform draws) and checked against the real roll functions in the test suite. They are BEFORE fit / placement, so they are upper bounds of what ends up placed.'},
  {id: 'pAtLeastOne', title: 'P(>= 1) per holder', text: 'The chance that ONE holder of that kind in that context rolls at least one lot of the item (before fit). Lots are independent given their count, so P = (1 - empty) x (1 - E_n[(1 - y)^n]), y = the per-lot chance after every stage.'},
  {id: 'not-derivable', title: 'Not derivable here', text: 'Fit / occupancy (which items fit which surfaces), placement rejection of floor finds and how many holders of a kind a level generates are generator outcomes: they are labelled "not directly derivable" and never folded into a chance. No per-level "chance to find X" is shown, except for the level-wide rolls (rare gear, masks) whose single roll per level is exact before placement.'},
  {id: 'census', title: 'Sample census', text: 'Which holder contexts occur in a level comes from a small fixed-seed census of the real level generators ("observed in N of M sample levels"). It is a sample, not a guarantee; declared contexts that no sample placed are listed as "declared".'},
  {id: 'overrides', title: 'Tuning knobs', text: 'Every value lists where it lives (file + export) and which per-level override reaches it: itemWeight / categoryWeight (row and category weights), keep (scarcity survival), slot.empty / slot.lots (per slot category), floor.chance / floor.count (loose finds), gear.mean / gear.cap / gear.weight (rare gear), rewards (replace a reward table), tables (give the profile its own rate tables), none (edit the source).'},
];

// ---------------------------------------------------------------------------------------------------------------------------
// The one entry point

export function buildLootReference(opts: LootReferenceOptions = {}): LootReference {
  const B = new Builder(opts);
  B.registerNamed();
  B.registerPurposes();
  const profiles = new Map<LevelId, LootProfile>(LEVEL_IDS.map(l => [l, opts.profileFor ? opts.profileFor(l) : lootProfile(l)]));
  for (const l of LEVEL_IDS) if (!LEVEL_ADAPTER[l]) throw new Error(`level ${l} has no LEVEL_ADAPTER entry (tools/pages/lootReference.ts)`);
  const seedsOf = new Map<LevelId, number[]>(LEVEL_IDS.map(l => [l, opts.censusSeeds ? [...opts.censusSeeds] : censusSeedsFor(l)]));
  const census = new Map<LevelId, CensusLayout[]>(LEVEL_IDS.map(l => [l, seedsOf.get(l)!.map(s => censusLayout(l, s))]));
  const specials = specialSources(B, profiles);
  const levels = LEVEL_IDS.map(l => buildLevel(B, l, profiles.get(l)!, census.get(l)!, specials));

  // holder kinds (every loot-holder kind items/loot.ts knows; a kind without a slot fails here)
  const holderKinds: Record<string, HolderKindInfo> = {};
  for (const kind of [...CONTAINER_KINDS, ...SURFACE_KINDS]) {
    const slot = (HOLDER_SLOTS as Record<string, SlotCategory | undefined>)[kind];
    if (!slot) throw new Error(`holder kind ${kind} has no slot in lootTables HOLDER_SLOTS`);
    const own = containerLoot(kind), inside = separateCompartmentLoot(kind), spec = openableSpec(kind);
    const T = BASE_TABLES;
    const kn: TuningKnob[] = [];
    if (T.holderEmpty[kind] !== undefined) kn.push({what: 'default empty chance', value: T.holderEmpty[kind], at: B.src.at(F.tables, 'HOLDER_EMPTY'), overrides: ['slot.empty', 'tables']});
    if (T.holderLots[kind]) kn.push({what: 'default lot range', value: T.holderLots[kind], at: B.src.at(F.tables, 'HOLDER_LOTS'), overrides: ['slot.lots', 'tables']});
    if (T.holderMod[kind]) kn.push({what: 'legacy category modifier', value: T.holderMod[kind].join(' / '), at: B.src.at(F.tables, 'HOLDER_MOD'), overrides: ['categoryWeight', 'tables']});
    kn.push({what: 'slot', value: slot, at: B.src.at(F.tables, 'HOLDER_SLOTS'), overrides: ['none']});
    holderKinds[kind] = {
      kind, label: label(kind), slot, group: isContainerKind(kind) ? 'container' : 'surface', openable: !!spec,
      ...(own ? {ownTable: B.idOf(own)} : {}), ...(inside ? {compartmentTable: B.idOf(inside)} : {}),
      defaults: {...(T.holderEmpty[kind] !== undefined ? {empty: T.holderEmpty[kind]} : {}), ...(T.holderLots[kind] ? {lots: T.holderLots[kind]} : {}), ...(T.holderMod[kind] ? {mod: [...T.holderMod[kind]]} : {})},
      allow: (HOLDER_ALLOW as Record<string, readonly string[] | undefined>)[kind] ? [...(HOLDER_ALLOW as Record<string, readonly string[]>)[kind]] : null,
      containerThemed: CONTAINER_THEMED.has(kind), randomHolder: RANDOM_HOLDERS.has(kind), bigBoxes: T.bigBoxHolders.has(kind),
      ...(T.limb.holder[kind] !== undefined ? {limbShare: T.limb.holder[kind]} : {}),
      spill: isSpillHolderKind(kind), ...(own === null ? {fixtureContents: openableSpec(kind)?.contents ?? ''} : {}),
      generated: (P7_HOLDER_KINDS as readonly string[]).includes(kind), class: own === null ? 'non-loot' : 'conditional', knobs: kn,
    };
  }
  const slots: SlotInfo[] = SLOT_CATEGORIES.map(id => ({
    id, label: SLOT_TEXT[id][0], description: SLOT_TEXT[id][1],
    holderKinds: Object.entries(HOLDER_SLOTS).filter(([, s]) => s === id).map(([k]) => k),
    compartmentOf: id === COMPARTMENT_SLOT ? Object.keys(holderKinds).filter(k => separateCompartmentLoot(k)) : [],
    knobs: id === 'fixture' ? [] : [{what: 'slot multipliers', value: `slot.${id}`, at: B.src.at(F.tables, 'SlotOverride'), overrides: ['slot.empty', 'slot.lots']}],
  }));

  // purposes
  const purposes: Record<string, PurposeInfo> = {};
  for (const p of ALL_PURPOSES) {
    const store = (STORE_PURPOSES as Record<string, Purpose>)[p.id] === p;
    purposes[p.id] = {
      id: p.id, label: p.label, category: p.category, theme: p.theme,
      slots: store ? ['storefront'] : [...(ROOM_PURPOSES[p.id] as {slots: readonly string[]}).slots],
      loot: Object.entries(p.loot as Readonly<Record<string, LootSpec | undefined>>).filter(([, s]) => s).map(([holder, s]) => ({holder, tableId: B.idOf(s)!})),
      ...(p.floor ? {floor: {...p.floor} as Record<string, number>} : {}),
      levels: levels.filter(l => l.purposes.some(u => u.purpose === p.id && u.levelsObserved > 0)).map(l => l.id),
      at: {...B.src.at(F.purposes, p.id, p.id), symbol: store ? `STORE_PURPOSES.${p.id}` : `ROOM_PURPOSES['${p.id}']`},
    };
  }
  // table bookkeeping: purpose users, unobserved flags
  for (const p of Object.values(purposes)) for (const e of p.loot) B.use(e.tableId, `purpose:${p.id}`);
  for (const lv of levels) for (const pool of [...Object.values(lv.economy.globalPool), ...Object.values(lv.economy.legacy.pools), lv.economy.legacy.vendingFood, lv.economy.limb.poolTable]) B.use(pool, `economy:${lv.id}`);
  // observed = drawn by a context some sample level placed, or the shared rows / base of such a table (closure)
  const observed = new Set<string>();
  const stack = levels.flatMap(l => l.holders.filter(h => h.occurrence.basis === 'observed').flatMap(h => [h.tableId, ...(h.rewardPicks ?? [])])).filter((x): x is string => !!x);
  while (stack.length) {
    const id = stack.pop()!;
    if (observed.has(id)) continue;
    observed.add(id);
    const i = B.tables.get(id)?.info;
    if (i?.rowsFrom) stack.push(i.rowsFrom);
    for (const d of i?.derivedFrom ?? []) stack.push(d);
  }
  for (const t of B.tables.values()) {
    const i = t.info;
    if (i.kind !== 'pool' && i.kind !== 'limb' && !observed.has(i.id)) (i as {unobserved?: boolean}).unobserved = true;
  }

  // items
  const tableList = [...B.tables.values()].map(t => t.info).sort((a, b) => a.id.localeCompare(b.id));
  const items: Record<string, ItemInfo> = {};
  for (const [id, d] of Object.entries(ITEMS)) {
    items[id] = {
      id, name: d.name, short: d.short, kind: d.kind, econ: econCat(id), group: groupOf(id), ...(d.caliber ? {caliber: d.caliber} : {}), stackMax: d.stackMax,
      tables: tableList.filter(t => t.rows.some(r => r.itemId === id)).map(t => t.id), sources: [...(B.itemSources.get(id) ?? [])].sort(),
    };
  }
  const itemGroups: ItemGroupInfo[] = GROUP_ORDER.map(g => ({id: g, label: GROUP_LABEL[g], items: Object.keys(items).filter(id => items[id].group === g)}));

  const ref: LootReference = clean({
    meta: {
      schema: LOOT_REFERENCE_SCHEMA, commit: '', buildId: '', dataHash: '', generatedFrom: [],
      repo: REPO, census: LEVEL_IDS.map((l): CensusInfo => {
        const c = census.get(l)!;
        const extra = c.length - Math.min(c.length, (opts.censusSeeds ?? CENSUS_SEEDS).length);
        return {level: l, seeds: [...seedsOf.get(l)!], startWeapon: startWeaponFor(false), holders: c.reduce((s, x) => s + x.holders.length, 0),
          contexts: new Set(c.flatMap(x => x.holders.map(h => `${h.kind}@${h.areaKey}`))).size,
          note: `${c.length} sample levels from the registered generator (levels/registry.ts LEVELS.${l}.generate), shipped start weapon${extra ? ` (${extra} of them chosen so every tenant company is sampled)` : ''}; not exhaustive.`};
      }),
    },
    items, itemGroups, slots, holderKinds,
    tables: Object.fromEntries(tableList.map(t => [t.id, t])),
    purposes, levels, specials, probability: PROBABILITY,
  });
  ref.meta.generatedFrom = [...GENERATED_FROM];
  const dataHash = fnv(JSON.stringify(ref));
  ref.meta.dataHash = dataHash;
  ref.meta.commit = opts.commit ?? 'local';
  ref.meta.buildId = opts.buildId ?? dataHash;
  return ref;
}
