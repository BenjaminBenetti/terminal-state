// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): STRICT validation of untrusted save DATA — an imported
// .json file or a localStorage value (campaign/types.ts SaveFileV1; save/serialize.ts SerializedRunV1). Data only: nothing here
// evaluates code, follows a URL or touches the game. Invalid -> {ok: false, error: <human-readable>} and the caller applies NOTHING.
//
// Order: size (<= 2 MiB UTF-8) -> JSON -> a generic scan of the whole tree (depth / node / string / array / key bounds, finite
// numbers only, plain objects only, no '__proto__' / 'constructor' / 'prototype' key anywhere) -> envelope (format, version: a
// future version is a friendly rejection; MIGRATIONS is the versioned upgrade hook, v1 is the only format so far) -> checksum
// (FNV-1a of the canonical run JSON; integrity, not security) -> the run's exact shape and ranges (item ids must exist in the item
// registry with legal counts / magazines / filters / bag contents; archetypes are LevelIds; station ids belong to the network;
// memory keys are `${stationId}:${section}`; no duplicate uid among the carried inventory + Lockbox) -> the network graph
// (structural checks here, plus lane NET's validateNetwork when injected) -> logical campaign checks (current / known / visited /
// transit endpoints in the network, the transit leaves `current`, a non-cheat transit follows a track edge or — campaign-polish lane
// MAP — a multi-hop `route` over visited stations: campaign/discovery.ts transitRouteProblem) -> the metadata
// matches the run. Pure.

import type {CampaignState, SaveMeta, StationNode, SubwayNetwork} from '../campaign/types';
import {SAVE_SLOTS} from '../campaign/types';
import type {LevelId} from '../levels/types';
import {ITEMS, type ItemDef} from '../items/items';
import {LEGACY_AMMO_IDS} from '../items/calibers';
import {FILTER_LIFE_S, GEAR_SLOTS, LEGACY_FILTER_LIFE_S, gearSpec, isAirtank, isFilterMask} from '../items/gear';
import {HOTBAR_SIZE, MELEE_SLOTS, THROW_SLOTS} from '../items/inventory';
import {WEAPONS} from '../weapons/weapons';
import {LOCKBOX_SLOTS} from '../run/trainLockbox';
import {PLAYER_TRAIN_PARTICIPANT} from '../run/playerTrain';
import {BAG_LANE} from '../run/bagStore';
import {FUEL, FUEL_LANE, debitProblem, debitUnits, stationFuelProblem, trainFuelProblem, type FuelDebit} from '../fuel/fuel';
import {SKYWAYS_CAR_LANE, TRUNK_SLOTS, skywaysCarProblem} from '../world/skywaysCarStore'; // task skyways-level-20261106 (lane CAR): the prize car's pose
import {STATION_PROPS_LANE, cargoProblem, stationPropsProblem, type CargoPropJSON} from '../run/trainCargo'; // task train-loose-cargo: the train's loose items (+ train-all-cargo: props)
import {PROP_DEFS} from '../gen/props'; // task train-all-cargo: carried props are of real kinds
import {checksumOf, utf8Bytes} from './checksum';
import {transitRouteProblem} from '../campaign/discovery';
import {hashString} from '../core/rng'; // (task studio-skyways-level-20261106-054448-01: the pre-Skyways seed default)
import {ENTERED_KEEP, MAX_HOLDER_PARTS, SAVE_FORMAT, SAVE_POINTS, SAVE_REASONS, SEEN_WORD_BITS, deriveMeta, migrateFilterUnits, seenWordCount, type SaveFileV1Like, type SerializedRunV1} from './serialize';

/** The envelope format this build writes (and the newest it reads). */
export const SAVE_FILE_V = 1;

/** Archetypes a save may name (levels/registry.ts LEVEL_IDS; save-validate.test asserts they match). */
export const SAVE_ARCHETYPES: readonly LevelId[] = ['subway', 'office', 'mall', 'market', 'skyways', 'reactor']; // (+ market: task studio-survivor-market-20261108-005807-01)

export const SAVE_LIMITS = {
  /** An exported file / a stored value, UTF-8 bytes. */
  fileBytes: 2 * 1024 * 1024,
  depth: 32,
  nodes: 1_500_000,
  stringChars: 4096,
  keyChars: 128,
  arrayItems: 20_000,
  objectKeys: 20_000,
  stations: 128,
  lines: 32,
  memories: 512,
  pickups: 5_000,
  holders: 5_000,
  holderLots: 256,
  killed: 5_000,
  lanes: 32,
  participants: 32,
  stats: 64,
  nameChars: 64,
} as const;

export type SaveResult<T> = {ok: true; value: T} | {ok: false; error: string};

/** Lane NET's graph validator (campaign/network.ts validateNetwork) — injected so this lane does not depend on its merge order. */
export type NetworkValidator = (n: SubwayNetwork) => string | null | undefined | boolean | {ok: boolean; error?: string; errors?: string[]};

export interface ValidateOptions {
  validateNetwork?: NetworkValidator;
}

/** Versioned envelope upgrades: MIGRATIONS[n] turns a format-n envelope into format n + 1. None yet (v1 is the first format). */
export const MIGRATIONS: Record<number, (f: Record<string, unknown>) => Record<string, unknown>> = {};

class Bad extends Error {}
const bad = (path: string, msg: string): never => { throw new Bad(path ? `${path}: ${msg}` : msg); };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CONTROL = /[\u0000-\u001f\u007f]/;
const STATION_ID = /^st-\d{1,4}$/;
const SECTION = /^[a-z][a-z0-9-]{0,31}$/;
const LANE_ID = /^[a-z][a-z0-9._-]{0,47}$/;
const ITEM_ID = /^[a-z][a-z0-9_]{0,47}$/;
const HOLDER_KEY = /^[A-Za-z][A-Za-z0-9_]{0,47}@-?\d{1,4}:-?\d{1,9},-?\d{1,9}$/;
const LINE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const CHECKSUM = /^fnv1a32-[0-9a-f]{8}$/;
const UINT32 = 0xffffffff;
const MAX_UID = 0x7fffffff;

// --- generic scan ---------------------------------------------------------------------------------------------------------------

/** Bounds + plain-data + forbidden-key scan of a whole parsed tree (before anything reads it). */
function scan(v: unknown, path: string, depth: number, budget: {nodes: number}): void {
  if (--budget.nodes < 0) bad('', `the save is too complex (more than ${SAVE_LIMITS.nodes} values)`);
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) bad(path, 'a number is not finite (NaN / Infinity)'); return; }
  if (typeof v === 'string') { if (v.length > SAVE_LIMITS.stringChars) bad(path, `a text value is too long (${v.length} characters)`); return; }
  if (typeof v !== 'object') bad(path, `${typeof v} is not save data`);
  if (depth >= SAVE_LIMITS.depth) bad(path, 'nested too deeply');
  if (Array.isArray(v)) {
    if (v.length > SAVE_LIMITS.arrayItems) bad(path, `a list is too long (${v.length} entries)`);
    for (let i = 0; i < v.length; i++) scan(v[i], `${path}[${i}]`, depth + 1, budget);
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) bad(path, 'not plain data');
  const keys = Object.keys(v as object);
  if (keys.length > SAVE_LIMITS.objectKeys) bad(path, `too many entries (${keys.length})`);
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) bad(path, `forbidden key '${k}'`);
    if (k.length > SAVE_LIMITS.keyChars) bad(path, 'a key is too long');
    scan((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k, depth + 1, budget);
  }
}

// --- typed helpers ----------------------------------------------------------------------------------------------------------------

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function obj(v: unknown, path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad(path, 'expected an object');
  return v as Record<string, unknown>;
}

function only(o: Record<string, unknown>, path: string, allowed: readonly string[], required: readonly string[] = allowed): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(path, `unexpected field '${k}'`);
  for (const k of required) if (!has(o, k)) bad(path, `missing field '${k}'`);
}

function arr(v: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(v)) bad(path, 'expected a list');
  const a = v as unknown[];
  if (a.length > max) bad(path, `too many entries (${a.length}; at most ${max})`);
  if (a.length < min) bad(path, `too few entries (${a.length}; at least ${min})`);
  return a;
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(path, 'expected a finite number');
  if ((v as number) < min || (v as number) > max) bad(path, `${v} is out of range (${min} to ${max})`);
  return v as number;
}

function int(v: unknown, path: string, min: number, max: number): number {
  const n = num(v, path, min, max);
  if (!Number.isInteger(n)) bad(path, `${n} is not a whole number`);
  return n;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') bad(path, 'expected true / false');
  return v as boolean;
}

function str(v: unknown, path: string, max: number, re?: RegExp, what = 'a valid id'): string {
  if (typeof v !== 'string') bad(path, 'expected text');
  const s = v as string;
  if (s.length > max) bad(path, `text too long (${s.length} characters; at most ${max})`);
  if (re && !re.test(s)) bad(path, `'${s.slice(0, 40)}' is not ${what}`);
  return s;
}

function name(v: unknown, path: string): string {
  const s = str(v, path, SAVE_LIMITS.nameChars);
  if (!s.trim()) bad(path, 'empty name');
  if (CONTROL.test(s)) bad(path, 'a name contains control characters');
  return s;
}

function oneOf<T extends string>(v: unknown, path: string, set: readonly T[]): T {
  if (typeof v !== 'string' || !(set as readonly string[]).includes(v)) bad(path, `'${String(v).slice(0, 40)}' is not one of ${set.join(' | ')}`);
  return v as T;
}

function isoDate(v: unknown, path: string): string {
  const s = str(v, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) bad(path, `'${s}' is not an ISO date`);
  return s;
}

// --- items ------------------------------------------------------------------------------------------------------------------------

/** The registry definition of a saved item id (legacy ammo ids map to their caliber item), or a rejection. */
function itemOf(v: unknown, path: string): ItemDef {
  const id = str(v, path, 48, ITEM_ID, 'an item id');
  const canon = has(LEGACY_AMMO_IDS, id) ? LEGACY_AMMO_IDS[id] : id;
  if (!has(ITEMS, canon)) bad(path, `unknown item '${id}'`);
  return ITEMS[canon];
}

const STACK_KEYS = ['uid', 'itemId', 'count', 'mag', 'bag', 'filter', 'air', 'armor'] as const; // (+ armor: task studio-general-armor-20261107-231448-01)
/**
 * Task filter-tension-airtank-20261104-072836: the largest fitted-filter charge a stack of the run being validated may hold = the
 * filter life that run was written with (run.filterLifeS; absent = LEGACY_FILTER_LIFE_S, a save from before 37.5 s filters).
 * validateRunData sets it for the duration of its walk; migrateFilterUnits then rescales the charges to FILTER_LIFE_S.
 */
let filterCapS: number = FILTER_LIFE_S;
/**
 * Task train-all-cargo: the carried-prop identities seen in the scope being checked (the run: its memories + the train; the Retry snapshot:
 * its own) — one prop, one place: never aboard AND lying in a station, never in two stations.
 */
let propScope = new Set<string>();

/** Task train-all-cargo: carried props / riders of real prop kinds, each identity once per scope. */
function carriedProps(list: readonly CargoPropJSON[], path: string): void {
  list.forEach((c, i) => {
    const known = (k: string) => Object.prototype.hasOwnProperty.call(PROP_DEFS, k);
    if (!known(c.kind) || (c.riders ?? []).some(r => !known(r.kind))) bad(`${path}[${i}].kind`, 'not a known prop kind');
    if (propScope.has(c.id)) bad(`${path}[${i}].id`, `carried prop ${c.id} is in two places`);
    propScope.add(c.id);
  });
}

/**
 * An item stack: a known item, a legal count, a weapon's magazine, a gas mask's filter, a backpack's own contents (one level).
 * `uid`: StackJSON (inventory / Lockbox / grounded bags / bag contents) must carry a unique positive uid; a section-memory
 * StackRecord (a loose item) must NOT (it gets a fresh uid when it is spawned).
 */
function stack(v: unknown, path: string, o: {uid: boolean; inBag: boolean; seen?: Set<number>; needBag?: boolean}): void {
  const s = obj(v, path);
  only(s, path, o.uid ? STACK_KEYS : STACK_KEYS.filter(k => k !== 'uid'), o.uid ? ['uid', 'itemId', 'count'] : ['itemId', 'count']);
  const def = itemOf(s.itemId, `${path}.itemId`);
  int(s.count, `${path}.count`, 1, def.stackMax);
  if (o.uid) {
    const uid = int(s.uid, `${path}.uid`, 1, MAX_UID);
    if (o.seen) {
      if (o.seen.has(uid)) bad(`${path}.uid`, `duplicate item uid ${uid}`);
      o.seen.add(uid);
    }
  }
  if (has(s, 'mag')) {
    if (def.kind !== 'weapon' || !def.weaponId || !has(WEAPONS, def.weaponId)) bad(`${path}.mag`, `${def.id} has no magazine`);
    int(s.mag, `${path}.mag`, 0, WEAPONS[def.weaponId!].magazine);
  }
  if (has(s, 'filter')) {
    if (!isFilterMask(def.id)) bad(`${path}.filter`, `${def.id} takes no filter`);
    num(s.filter, `${path}.filter`, 0, filterCapS + 1e-6);
  }
  if (has(s, 'air')) { // task filter-tension-airtank: an Airtank Backpack's air (s)
    if (!isAirtank(def.id)) bad(`${path}.air`, `${def.id} holds no air`);
    num(s.air, `${path}.air`, 0, (gearSpec(def.id)?.airLife ?? 0) + 1e-6);
  }
  if (has(s, 'armor')) { // task studio-general-armor-20261107-231448-01: an armour-bearing gear item's armour left after wear
    const full = gearSpec(def.id)?.armor ?? 0;
    if (!(full > 0)) bad(`${path}.armor`, `${def.id} has no armour`);
    num(s.armor, `${path}.armor`, 0, full + 1e-6);
  }
  const slots = def.gear?.bagSlots ?? 0;
  if (slots > 0 && o.inBag) bad(path, 'a backpack inside a backpack');
  if (has(s, 'bag')) {
    if (slots === 0) bad(`${path}.bag`, `${def.id} cannot hold items`);
    const bag = arr(s.bag, `${path}.bag`, slots, slots);
    bag.forEach((c, i) => { if (c !== null) stack(c, `${path}.bag[${i}]`, {uid: true, inBag: true, seen: o.seen}); });
  } else if (slots > 0 && o.needBag) bad(path, `backpack ${def.id} has no contents list`);
}

const slotList = (v: unknown, path: string, max: number, seen: Set<number> | undefined, needBag = true): void =>
  arr(v, path, max).forEach((s, i) => { if (s !== null) stack(s, `${path}[${i}]`, {uid: true, inBag: false, seen, needBag}); });

/** InventoryJSON (v1–v3; Inventory.loadJSON migrates older ones). */
function inventory(v: unknown, path: string, seen: Set<number>): void {
  const j = obj(v, path);
  only(j, path, ['v', 'hotbar', 'pack', 'gear', 'throw', 'melee', 'selected', 'meleeSelected', 'nextUid'], ['v', 'hotbar', 'pack', 'gear', 'selected', 'nextUid']);
  int(j.v, `${path}.v`, 1, 3);
  slotList(j.hotbar, `${path}.hotbar`, HOTBAR_SIZE, seen);
  slotList(j.pack, `${path}.pack`, 64, seen);
  const gear = obj(j.gear, `${path}.gear`);
  for (const [k, s] of Object.entries(gear)) {
    if (!(GEAR_SLOTS as readonly string[]).includes(k)) bad(`${path}.gear`, `unknown gear slot '${k}'`);
    if (s !== null) stack(s, `${path}.gear.${k}`, {uid: true, inBag: false, seen, needBag: true});
  }
  if (has(j, 'throw')) slotList(j.throw, `${path}.throw`, THROW_SLOTS, seen);
  if (has(j, 'melee')) slotList(j.melee, `${path}.melee`, MELEE_SLOTS, seen);
  int(j.selected, `${path}.selected`, 0, HOTBAR_SIZE - 1);
  if (has(j, 'meleeSelected')) bool(j.meleeSelected, `${path}.meleeSelected`);
  int(j.nextUid, `${path}.nextUid`, 1, MAX_UID);
}

// --- network / campaign -------------------------------------------------------------------------------------------------------

/** Structural graph checks (node count, unique ids / names, edges / lines reference nodes, exactly one reactor, a Subway start, connected). */
function network(v: unknown, path: string, inject?: NetworkValidator): SubwayNetwork {
  const n = obj(v, path);
  if (n.v !== 1) bad(`${path}.v`, 'unsupported network version');
  int(n.seed, `${path}.seed`, 0, UINT32);
  const nodes = arr(n.nodes, `${path}.nodes`, SAVE_LIMITS.stations, 1);
  const ids = new Set<string>(), names = new Set<string>();
  const lineIds = new Set<string>();
  const lines = arr(n.lines, `${path}.lines`, SAVE_LIMITS.lines, 1);
  lines.forEach((l, i) => {
    const p = `${path}.lines[${i}]`, o = obj(l, p);
    const id = str(o.id, `${p}.id`, 32, LINE_ID, 'a line id');
    if (lineIds.has(id)) bad(`${p}.id`, `duplicate line id ${id}`);
    lineIds.add(id);
  });
  nodes.forEach((x, i) => {
    const p = `${path}.nodes[${i}]`, o = obj(x, p) as Partial<Record<keyof StationNode, unknown>>;
    const id = str(o.id, `${p}.id`, 8, STATION_ID, 'a station id');
    if (ids.has(id)) bad(`${p}.id`, `duplicate station id ${id}`);
    ids.add(id);
    const nm = name(o.name, `${p}.name`);
    if (names.has(nm)) bad(`${p}.name`, `duplicate station name '${nm}'`);
    names.add(nm);
    oneOf(o.archetype, `${p}.archetype`, SAVE_ARCHETYPES);
    int(o.levelSeed, `${p}.levelSeed`, 0, UINT32);
    num(o.x, `${p}.x`, -1e4, 1e4);
    num(o.y, `${p}.y`, -1e4, 1e4);
    arr(o.lines, `${p}.lines`, SAVE_LIMITS.lines, 1).forEach((l, j) => {
      if (typeof l !== 'string' || !lineIds.has(l)) bad(`${p}.lines[${j}]`, `unknown line '${String(l).slice(0, 32)}'`);
    });
  });
  const isNode = (s: unknown, p: string): string => {
    const id = str(s, p, 8, STATION_ID, 'a station id');
    if (!ids.has(id)) bad(p, `station ${id} is not in the network`);
    return id;
  };
  lines.forEach((l, i) => {
    const p = `${path}.lines[${i}]`, o = l as Record<string, unknown>;
    name(o.name, `${p}.name`);
    str(o.color, `${p}.color`, 7, COLOR, 'a #rrggbb colour');
    arr(o.stations, `${p}.stations`, SAVE_LIMITS.stations * 2, 1).forEach((s, j) => isNode(s, `${p}.stations[${j}]`));
    if (has(o, 'loop') && o.loop !== undefined) bool(o.loop, `${p}.loop`);
  });
  const adj = new Map<string, Set<string>>([...ids].map(id => [id, new Set<string>()]));
  const pairs = new Set<string>();
  arr(n.edges, `${path}.edges`, SAVE_LIMITS.stations * 8).forEach((e, i) => {
    const p = `${path}.edges[${i}]`, pair = arr(e, p, 2, 2);
    const a = isNode(pair[0], `${p}[0]`), b = isNode(pair[1], `${p}[1]`);
    if (a === b) bad(p, `a track from ${a} to itself`);
    const k = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (pairs.has(k)) bad(p, `duplicate track ${a} – ${b}`);
    pairs.add(k);
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  });
  const start = isNode(n.start, `${path}.start`), reactor = isNode(n.reactor, `${path}.reactor`);
  const typed = nodes as StationNode[];
  if (typed.find(x => x.id === start)!.archetype !== 'subway') bad(`${path}.start`, 'the start station is not a Subway station');
  const reactors = typed.filter(x => x.archetype === 'reactor');
  if (reactors.length !== 1) bad(`${path}.nodes`, `expected exactly one Reactor station (found ${reactors.length})`);
  if (reactors[0].id !== reactor) bad(`${path}.reactor`, `${reactor} is not the Reactor station`);
  const reached = new Set([start]), queue = [start];
  while (queue.length) for (const m of adj.get(queue.pop()!)!) if (!reached.has(m)) { reached.add(m); queue.push(m); }
  if (reached.size !== ids.size) bad(`${path}.edges`, `the network is not connected (${ids.size - reached.size} stations unreachable from the start)`);
  if (inject) {
    let r: ReturnType<NetworkValidator>;
    try { r = inject(n as unknown as SubwayNetwork); } catch (err) { r = String((err as Error)?.message ?? err); }
    const msg = r === false ? 'invalid network'
      : typeof r === 'string' ? r
      : r && typeof r === 'object' && !r.ok ? (r.error ?? r.errors?.join('; ') ?? 'invalid network')
      : null;
    if (msg) bad(path, msg);
  }
  return n as unknown as SubwayNetwork;
}

function campaign(v: unknown, path: string, inject?: NetworkValidator): CampaignState {
  const c = obj(v, path);
  if (c.v !== 1) bad(`${path}.v`, 'unsupported campaign version');
  const net = network(c.network, `${path}.network`, inject);
  const ids = new Set(net.nodes.map(n => n.id));
  const node = (s: unknown, p: string): string => {
    const id = str(s, p, 8, STATION_ID, 'a station id');
    if (!ids.has(id)) bad(p, `station ${id} is not in the network`);
    return id;
  };
  const current = node(c.current, `${path}.current`);
  const set = (key: string): Set<string> => {
    const out = new Set<string>();
    arr(c[key], `${path}.${key}`, ids.size).forEach((s, i) => {
      const id = node(s, `${path}.${key}[${i}]`);
      if (out.has(id)) bad(`${path}.${key}[${i}]`, `${id} is listed twice`);
      out.add(id);
    });
    return out;
  };
  set('known');
  const visited = set('visited');
  if (!visited.has(current)) bad(`${path}.current`, `the current station ${current} was never visited`);
  const cheat = bool(c.cheat, `${path}.cheat`);
  if (c.won !== null) {
    const w = obj(c.won, `${path}.won`);
    isoDate(w.at, `${path}.won.at`);
    node(w.station, `${path}.won.station`);
    str(w.via, `${path}.won.via`, 64);
  }
  if (c.transit !== null) {
    const p = `${path}.transit`, t = obj(c.transit, p);
    const from = node(t.from, `${p}.from`), to = node(t.to, `${p}.to`);
    if (t.phase !== 'departing') bad(`${p}.phase`, `'${String(t.phase)}' is not a stored transit phase`);
    const tc = bool(t.cheat, `${p}.cheat`);
    if (from !== current) bad(`${p}.from`, `the train leaves ${from} but the current station is ${current}`);
    if (from === to) bad(p, 'a journey to the same station');
    if (tc && !cheat) bad(`${p}.cheat`, 'a cheat journey without the map cheat');
    for (const k of Object.keys(t)) if (!['from', 'to', 'phase', 'cheat', 'route', 'fuel'].includes(k)) bad(p, `unexpected field '${k}'`);
    if (has(t, 'fuel')) { // task train-fuel-system: the journey's one-time fuel charge
      const f = obj(t.fuel, `${p}.fuel`);
      only(f, `${p}.fuel`, ['cost', 'debit']);
      const cost = int(f.cost, `${p}.fuel.cost`, 0, FUEL.hopUnits * SAVE_LIMITS.stations);
      const dp = debitProblem(f.debit);
      if (dp) bad(`${p}.fuel.debit`, dp);
      if (debitUnits(f.debit as FuelDebit) !== cost) bad(`${p}.fuel`, 'the fuel drawn does not match the journey cost');
    }
    if (has(t, 'route')) {
      // (campaign-polish lane MAP) a multi-hop journey: its route over visited stations, checked like the campaign validator does
      arr(t.route, `${p}.route`, ids.size, 3).forEach((s, i) => node(s, `${p}.route[${i}]`));
      const problem = transitRouteProblem(net, {from, to, cheat: tc, route: t.route}, visited);
      if (problem) bad(`${p}.route`, problem);
    } else if (!tc && !net.edges.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) bad(p, `no track between ${from} and ${to}`);
  }
  return c as unknown as CampaignState;
}

// --- run ------------------------------------------------------------------------------------------------------------------------

const VITALS = ['hp', 'stamina', 'damageTaken'], SURVIVAL = ['hunger', 'thirst', 'time'], BATTERY = ['charge', 'on', 'died'];

function vitals(v: unknown, path: string): void {
  const o = obj(v, path);
  only(o, path, VITALS);
  num(o.hp, `${path}.hp`, 0, 100);
  if ((o.hp as number) <= 0) bad(`${path}.hp`, 'the player is dead');
  num(o.stamina, `${path}.stamina`, 0, 100);
  num(o.damageTaken, `${path}.damageTaken`, 0, 1e9);
}

function survival(v: unknown, path: string): void {
  const o = obj(v, path);
  only(o, path, SURVIVAL);
  num(o.hunger, `${path}.hunger`, 0, 100);
  num(o.thirst, `${path}.thirst`, 0, 100);
  num(o.time, `${path}.time`, 0, 1e9);
}

function battery(v: unknown, path: string): void {
  const o = obj(v, path);
  only(o, path, BATTERY);
  num(o.charge, `${path}.charge`, 0, 1);
  bool(o.on, `${path}.on`);
  bool(o.died, `${path}.died`);
}

function stats(v: unknown, path: string): void {
  const o = obj(v, path);
  const keys = Object.keys(o);
  if (keys.length > SAVE_LIMITS.stats) bad(path, 'too many stats');
  for (const k of keys) { str(k, path, 32, /^[A-Za-z][A-Za-z0-9_]*$/, 'a stat name'); num(o[k], `${path}.${k}`, 0, 1e12); }
}

/** Run participants ({id -> save()}): ids bounded; the player train's record and its Lockbox items strictly. */
function participants(v: unknown, path: string, seen: Set<number>): void {
  const o = obj(v, path);
  const keys = Object.keys(o);
  if (keys.length > SAVE_LIMITS.participants) bad(path, 'too many run participants');
  for (const k of keys) str(k, path, 48, LANE_ID, 'a participant id');
  const t = o[PLAYER_TRAIN_PARTICIPANT];
  if (t !== undefined && t !== null) {
    const p = `${path}.${PLAYER_TRAIN_PARTICIPANT}`, r = obj(t, p);
    str(r.id, `${p}.id`, 64);
    int(r.tier, `${p}.tier`, 1, 100);
    if (r.at !== null && r.at !== undefined) {
      const at = obj(r.at, `${p}.at`);
      oneOf(at.level, `${p}.at.level`, SAVE_ARCHETYPES);
      str(at.section, `${p}.at.section`, 32, SECTION, 'a section id');
    }
    if (r.lockbox !== undefined) {
      const lb = obj(r.lockbox, `${p}.lockbox`);
      if (lb.v !== 1) bad(`${p}.lockbox.v`, 'unsupported Lockbox version');
      slotList(lb.slots, `${p}.lockbox.slots`, LOCKBOX_SLOTS, seen);
    }
    if (r.fuel !== undefined) { const fp = trainFuelProblem(r.fuel); if (fp) bad(`${p}.fuel`, fp); } // task train-fuel-system
    if (r.cargo !== undefined) { // task train-loose-cargo: the loose items / bags aboard — shape, then every stack (one item, one uid run-wide)
      const cp = cargoProblem(r.cargo);
      if (cp) bad(`${p}.cargo`, cp);
      (r.cargo as {items: {stack: unknown}[]}).items.forEach((it, i) => stack(it.stack, `${p}.cargo.items[${i}].stack`, {uid: true, inBag: false, seen, needBag: true}));
      carriedProps((r.cargo as {props?: CargoPropJSON[]}).props ?? [], `${p}.cargo.props`); // task train-all-cargo: v2's movable props aboard
    }
  }
}

/** GEAR's grounded bags of a section (gear/bagStore.ts SectionBags): every stack strictly; other shapes are ignored by GEAR. */
function sectionBags(v: unknown, path: string): void {
  if (!v || typeof v !== 'object' || (v as {v?: unknown}).v !== 1) return;
  const r = v as Record<string, unknown>;
  arr(r.bags, `${path}.bags`, 512).forEach((b, i) => {
    const p = `${path}.bags[${i}]`, o = obj(b, p);
    str(o.id, `${p}.id`, 64);
    stack(o.stack, `${p}.stack`, {uid: true, inBag: false, seen: new Set(), needBag: true});
    for (const k of ['x', 'y', 'z', 'yaw']) num(o[k], `${p}.${k}`, -1e5, 1e5);
    int(o.level, `${p}.level`, 0, 64);
  });
}

function lanes(v: unknown, path: string): void {
  const o = obj(v, path);
  const keys = Object.keys(o);
  if (keys.length > SAVE_LIMITS.lanes) bad(path, 'too many lane stores');
  for (const k of keys) str(k, path, 48, LANE_ID, 'a lane id');
  if (has(o, BAG_LANE)) sectionBags(o[BAG_LANE], `${path}.${BAG_LANE}`);
  if (has(o, FUEL_LANE)) { const fp = stationFuelProblem(o[FUEL_LANE]); if (fp) bad(`${path}.${FUEL_LANE}`, fp); } // task train-fuel-system
  if (has(o, SKYWAYS_CAR_LANE)) { // task skyways-level-20261106 (lane CAR)
    const car = o[SKYWAYS_CAR_LANE], cp = skywaysCarProblem(car);
    if (cp) bad(`${path}.${SKYWAYS_CAR_LANE}`, cp);
    // task skyways-vehicle-20261107 (v2): the trunk's stacks as strictly as the Lockbox's (uids unique within it, bags, mags, filter, air)
    if ((car as {v: number}).v === 2) slotList((car as {trunk: unknown}).trunk, `${path}.${SKYWAYS_CAR_LANE}.trunk`, TRUNK_SLOTS, new Set());
  }
  if (has(o, STATION_PROPS_LANE)) { // task train-all-cargo: the layout props the station lost to the train + the carried props lying there
    const sp = stationPropsProblem(o[STATION_PROPS_LANE]);
    if (sp) bad(`${path}.${STATION_PROPS_LANE}`, sp);
    carriedProps((o[STATION_PROPS_LANE] as {here: CargoPropJSON[]}).here, `${path}.${STATION_PROPS_LANE}.here`);
  }
}

function pickup(v: unknown, path: string): void {
  const t = arr(v, path, 14, 11);
  if (t.length === 13) bad(path, 'malformed loose item');
  stack(t[0], `${path}[0]`, {uid: false, inBag: false});
  for (let i = 1; i <= 10; i++) {
    const q = i >= 4 && i <= 7;
    num(t[i], `${path}[${i}]`, q ? -1.0001 : -1e5, q ? 1.0001 : 1e5);
  }
  if (t.length === 12) int(t[11], `${path}[11]`, 0, 1e9);
  if (t.length === 14) { int(t[11], `${path}[11]`, -1, 1e9); int(t[12], `${path}[12]`, 0, 1e9); int(t[13], `${path}[13]`, 0, 1e9); }
}

function holder(v: unknown, path: string): void {
  const t = arr(v, path, SAVE_LIMITS.holderLots + 2 + seenWordCount(MAX_HOLDER_PARTS), 1);
  const f = int(t[0], `${path}[0]`, 0, 7);
  let from = 1;
  if (f & 4) {
    // [flags | 4, seen.length, ...seenWords, ...lots] (save/serialize.ts encodeHolder): one 30-bit word per 30 compartments
    if (t.length < 3) bad(path, 'malformed holder');
    const len = int(t[1], `${path}[1]`, 1, MAX_HOLDER_PARTS), n = seenWordCount(len);
    if (t.length < 2 + n) bad(path, 'malformed holder');
    for (let w = 0; w < n; w++) int(t[2 + w], `${path}[${2 + w}]`, 0, 2 ** Math.min(SEEN_WORD_BITS, len - w * SEEN_WORD_BITS) - 1);
    from = 2 + n;
  }
  for (let i = from; i < t.length; i++) int(t[i], `${path}[${i}]`, 0, 1e9);
}

const MEMORY_KEYS = ['visits', 'pickups', 'holders', 'killed', 'cleared', 'lanes'];

function memory(v: unknown, path: string): void {
  const m = obj(v, path);
  only(m, path, MEMORY_KEYS);
  int(m.visits, `${path}.visits`, 0, 1e7);
  if (m.pickups !== null) arr(m.pickups, `${path}.pickups`, SAVE_LIMITS.pickups).forEach((p, i) => pickup(p, `${path}.pickups[${i}]`));
  const h = obj(m.holders, `${path}.holders`);
  const hk = Object.keys(h);
  if (hk.length > SAVE_LIMITS.holders) bad(`${path}.holders`, 'too many loot holders');
  for (const k of hk) { str(k, `${path}.holders`, 64, HOLDER_KEY, 'a holder key'); holder(h[k], `${path}.holders.${k}`); }
  arr(m.killed, `${path}.killed`, SAVE_LIMITS.killed).forEach((k, i) => int(k, `${path}.killed[${i}]`, 0, 1e6));
  bool(m.cleared, `${path}.cleared`);
  lanes(m.lanes, `${path}.lanes`);
}

/** Section memories keyed `${stationId}:${section}` of network stations (`scope`: one station only — the Retry snapshot). */
function memories(v: unknown, path: string, ids: Set<string>, scope?: string): void {
  const o = obj(v, path);
  const keys = Object.keys(o);
  if (keys.length > SAVE_LIMITS.memories) bad(path, 'too many remembered sections');
  for (const k of keys) {
    const m = /^(st-\d{1,4}):([a-z][a-z0-9-]{0,31})$/.exec(k);
    if (!m) bad(path, `'${k.slice(0, 40)}' is not a station section key`);
    if (!ids.has(m![1])) bad(path, `memory ${k}: station ${m![1]} is not in the network`);
    if (scope !== undefined && m![1] !== scope) bad(path, `memory ${k} is not part of station ${scope}`);
    memory(o[k], `${path}.${k}`);
  }
}

const ENTRY_KEYS = ['level', 'section', 'station', 'arrival', 'vitals', 'survival', 'battery', 'inventory', 'lanes', 'memories', 'stats'];

function entry(v: unknown, path: string, net: SubwayNetwork): void {
  const e = obj(v, path);
  only(e, path, ENTRY_KEYS, ENTRY_KEYS.filter(k => k !== 'station'));
  const level = oneOf(e.level, `${path}.level`, SAVE_ARCHETYPES);
  str(e.section, `${path}.section`, 32, SECTION, 'a section id');
  const ids = new Set(net.nodes.map(n => n.id));
  let scope: string | undefined;
  if (has(e, 'station')) {
    scope = str(e.station, `${path}.station`, 8, STATION_ID, 'a station id');
    const node = net.nodes.find(n => n.id === scope);
    if (!node) bad(`${path}.station`, `station ${scope} is not in the network`);
    if (node!.archetype !== level) bad(`${path}.level`, `${scope} is a ${node!.archetype} station, not ${level}`);
  }
  const a = obj(e.arrival, `${path}.arrival`);
  only(a, `${path}.arrival`, ['kind']);
  oneOf(a.kind, `${path}.arrival.kind`, ['start', 'return']);
  vitals(e.vitals, `${path}.vitals`);
  survival(e.survival, `${path}.survival`);
  battery(e.battery, `${path}.battery`);
  const seen = new Set<number>();
  const outer = propScope;
  propScope = new Set(); // (task train-all-cargo: the snapshot is its own world)
  try {
    inventory(e.inventory, `${path}.inventory`, seen);
    participants(e.lanes, `${path}.lanes`, seen);
    memories(e.memories, `${path}.memories`, ids, scope ?? '\u0000');
  } finally { propScope = outer; }
  stats(e.stats, `${path}.stats`);
}

const RUN_KEYS = ['v', 'point', 'campaign', 'seeds', 'section', 'arrival', 'entered', 'playtime', 'clock', 'memories', 'entry', 'carry', 'participants', 'stats', 'player', 'filterLifeS'];
const RUN_REQUIRED = RUN_KEYS.filter(k => k !== 'filterLifeS'); // (task filter-tension-airtank: optional; absent = a legacy 150 s save)

/** The serialized run (save/serialize.ts SerializedRunV1), exact shape + ranges + logical checks. */
export function validateRunData(v: unknown, o: ValidateOptions = {}, path = 'run'): SerializedRunV1 {
  const r = obj(v, path);
  only(r, path, RUN_KEYS, RUN_REQUIRED);
  if (r.v !== 1) bad(`${path}.v`, 'unsupported run version');
  const prevCap = filterCapS;
  filterCapS = has(r, 'filterLifeS') ? num(r.filterLifeS, `${path}.filterLifeS`, 1, 3600) : LEGACY_FILTER_LIFE_S;
  const prevProps = propScope;
  propScope = new Set();
  try { return validateRunBody(r, o, path); } finally { filterCapS = prevCap; propScope = prevProps; }
}

function validateRunBody(r: Record<string, unknown>, o: ValidateOptions, path: string): SerializedRunV1 {
  const point = oneOf(r.point, `${path}.point`, SAVE_POINTS);
  const c = campaign(r.campaign, `${path}.campaign`, o.validateNetwork);
  if ((point === 'departure') !== (c.transit !== null)) bad(`${path}.point`, point === 'departure' ? 'a departure save without a journey' : `${point === 'arrival' ? 'an arrival' : point === 'ending' ? 'an ending' : 'a new-game'} save during a journey`);
  const seeds = obj(r.seeds, `${path}.seeds`);
  // task studio-skyways-level-20261106-054448-01: a run saved before Skyways existed has no seeds.skyways (the legacy per-archetype seed;
  // campaign nodes carry their own levelSeed) — a deterministic default from its Subway seed (the checksum was verified on the stored run)
  if (seeds.skyways === undefined && typeof seeds.subway === 'number' && Number.isInteger(seeds.subway)) seeds.skyways = hashString('terminal-state:skyways-seed', seeds.subway >>> 0);
  // task studio-survivor-market-20261108-005807-01 (lane LEVEL): likewise a run saved before the Survivor Market has no seeds.market — the
  // same deterministic default rule (its own hash key), so every older save still loads
  if (seeds.market === undefined && typeof seeds.subway === 'number' && Number.isInteger(seeds.subway)) seeds.market = hashString('terminal-state:market-seed', seeds.subway >>> 0);
  only(seeds, `${path}.seeds`, SAVE_ARCHETYPES);
  for (const l of SAVE_ARCHETYPES) int(seeds[l], `${path}.seeds.${l}`, 0, UINT32);
  str(r.section, `${path}.section`, 32, SECTION, 'a section id');
  oneOf(r.arrival, `${path}.arrival`, ['start', 'return']);
  arr(r.entered, `${path}.entered`, ENTERED_KEEP).forEach((l, i) => oneOf(l, `${path}.entered[${i}]`, SAVE_ARCHETYPES));
  num(r.playtime, `${path}.playtime`, 0, 1e9);
  num(r.clock, `${path}.clock`, 0, 1e9);
  const ids = new Set(c.network.nodes.map(n => n.id));
  memories(r.memories, `${path}.memories`, ids);
  if (r.entry !== null) entry(r.entry, `${path}.entry`, c.network);
  const carry = obj(r.carry, `${path}.carry`);
  only(carry, `${path}.carry`, ['inventory', 'vitals', 'survival', 'battery']);
  const seen = new Set<number>(); // carried inventory + Lockbox: one item, one uid
  inventory(carry.inventory, `${path}.carry.inventory`, seen);
  vitals(carry.vitals, `${path}.carry.vitals`);
  survival(carry.survival, `${path}.carry.survival`);
  battery(carry.battery, `${path}.carry.battery`);
  participants(r.participants, `${path}.participants`, seen);
  stats(r.stats, `${path}.stats`);
  const pl = obj(r.player, `${path}.player`);
  only(pl, `${path}.player`, ['trainLocal']);
  const t = obj(pl.trainLocal, `${path}.player.trainLocal`);
  only(t, `${path}.player.trainLocal`, ['x', 'z', 'yaw', 'pitch', 'crouched']);
  num(t.x, `${path}.player.trainLocal.x`, -100, 100);
  num(t.z, `${path}.player.trainLocal.z`, -20, 20);
  num(t.yaw, `${path}.player.trainLocal.yaw`, -1e6, 1e6);
  num(t.pitch, `${path}.player.trainLocal.pitch`, -Math.PI / 2 - 0.01, Math.PI / 2 + 0.01);
  bool(t.crouched, `${path}.player.trainLocal.crouched`);
  return r as unknown as SerializedRunV1;
}

const META_KEYS = ['slot', 'savedAt', 'revision', 'playtime', 'station', 'archetype', 'stationsVisited', 'networkSeed', 'won', 'reason', 'build'];

function meta(v: unknown, run: SerializedRunV1): SaveMeta {
  const path = 'meta', m = obj(v, path);
  only(m, path, META_KEYS);
  int(m.slot, `${path}.slot`, 1, SAVE_SLOTS);
  isoDate(m.savedAt, `${path}.savedAt`);
  int(m.revision, `${path}.revision`, 0, MAX_UID);
  num(m.playtime, `${path}.playtime`, 0, 1e9);
  name(m.station, `${path}.station`);
  oneOf(m.archetype, `${path}.archetype`, SAVE_ARCHETYPES);
  int(m.stationsVisited, `${path}.stationsVisited`, 0, SAVE_LIMITS.stations);
  int(m.networkSeed, `${path}.networkSeed`, 0, UINT32);
  bool(m.won, `${path}.won`);
  oneOf(m.reason, `${path}.reason`, SAVE_REASONS);
  str(m.build, `${path}.build`, 80);
  const want = deriveMeta(run, {slot: 1, revision: 0, savedAt: '', reason: ''});
  for (const k of ['station', 'archetype', 'stationsVisited', 'networkSeed', 'won'] as const) {
    if (m[k] !== want[k]) bad(`${path}.${k}`, 'the slot information does not match the saved run');
  }
  if (Math.abs((m.playtime as number) - run.playtime) > 1) bad(`${path}.playtime`, 'the slot information does not match the saved run');
  return m as unknown as SaveMeta;
}

// --- entry points ----------------------------------------------------------------------------------------------------------------

const fail = (error: string): {ok: false; error: string} => ({ok: false, error});
const NOT_A_SAVE = 'This is not a Terminal State save file.';

/** Upgrade an envelope to SAVE_FILE_V through MIGRATIONS (v1: nothing to do). */
export function migrateEnvelope(f: Record<string, unknown>): Record<string, unknown> {
  let out = f;
  while ((out.v as number) < SAVE_FILE_V) {
    const step = MIGRATIONS[out.v as number];
    if (!step) bad('', `save format v${String(out.v)} is not supported`);
    out = step(out);
  }
  return out;
}

/** Validate a parsed save envelope (an imported file or a stored value) completely. */
export function validateSaveFile(raw: unknown, o: ValidateOptions = {}): SaveResult<SaveFileV1Like> {
  try {
    scan(raw, '', 0, {nodes: SAVE_LIMITS.nodes});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(NOT_A_SAVE);
    let f = raw as Record<string, unknown>;
    if (f.format !== SAVE_FORMAT) return fail(NOT_A_SAVE);
    if (typeof f.v !== 'number' || !Number.isInteger(f.v) || f.v < 1) return fail('This save file has an unknown format version.');
    if (f.v > SAVE_FILE_V) return fail(`This save was made by a newer version of Terminal State (save format v${f.v}); this version reads format v${SAVE_FILE_V}. Update the game to load it.`);
    f = migrateEnvelope(f);
    only(f, 'file', ['format', 'v', 'meta', 'run', 'checksum']);
    const sum = str(f.checksum, 'checksum', 20, CHECKSUM, 'a checksum');
    if (checksumOf(f.run) !== sum) return fail('This save file is damaged: its checksum does not match its contents (it was changed or corrupted after it was written).');
    const run = validateRunData(f.run, o);
    const m = meta(f.meta, run);
    // task filter-tension-airtank-20261104-072836: a save written with other filter units (a legacy 150 s save) has its charges
    // rescaled ONCE here (same fraction of a filter, on a copy); the result carries filterLifeS = FILTER_LIFE_S and its own checksum,
    // so it validates as is again and a reload never rescales twice (the stored text keeps its own units until the next save).
    const now = migrateFilterUnits(run);
    return {ok: true, value: {format: SAVE_FORMAT, v: 1, meta: m, run: now, checksum: now === run ? sum : checksumOf(now)}};
  } catch (err) {
    if (err instanceof Bad) return fail(`This save cannot be loaded — ${err.message}.`);
    return fail(`This save cannot be loaded (unexpected error: ${String((err as Error)?.message ?? err).slice(0, 160)}).`);
  }
}

/** Validate save TEXT (file contents / a localStorage value): size, JSON, then validateSaveFile. */
export function parseSaveText(text: unknown, o: ValidateOptions = {}): SaveResult<SaveFileV1Like> {
  if (typeof text !== 'string') return fail(NOT_A_SAVE);
  const limit = SAVE_LIMITS.fileBytes;
  const bytes = text.length > limit ? text.length : utf8Bytes(text);
  if (bytes > limit) return fail(`This save file is too large (${(bytes / 1048576).toFixed(1)} MiB; the limit is ${limit / 1048576} MiB).`);
  if (!text.trim()) return fail('This save file is empty.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('This is not a valid save file: it is not JSON (it may be damaged or cut off).'); }
  return validateSaveFile(raw, o);
}
