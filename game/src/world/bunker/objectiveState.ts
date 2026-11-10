// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): THE BUNKER's optional objective — the PURE core (no three.js / DOM).
//
// The objective (user's final answer): never a gate — the player can leave at any time, nothing locks the exit. THREE auxiliary
// generators (gen/bunker/bunkerTypes.ts BunkerGeneratorSlot 'gen-0' .. 'gen-2'), each needs ONE poured fuel can unit (FUEL.canItem),
// then the familiar turnkey start (hold [E]). With all three online the core's computer cluster comes alive and its terminal grants
// MAP INTEL once per Bunker station.
//
// STATE (BUNKER_LANE, the station's section-memory lane: run.laneStore / setLaneStore — never the Reactor's 'reactor.state'):
//   {v: 1, gens: {[id]: 'off' | 'fuelled' | 'online'}, intel?: {claimedAt, kind, nodeId?}}
// Generator states only ever move off -> fuelled (a committed pour: exactly one can taken) -> online (a completed turnkey start); a
// record never goes back (no refund, no re-fuel). `intel` is written once, at the claim, and is never re-rolled.
//
// Task studio-bunker-rework-20261109-205115-01 (USER-CORRECTED FUEL CONTRACT, superseding the can-only rule): a generator needs ONE
// QUARTER-TANK fuel unit (BUNKER_GEN_FUEL_UNITS = FUEL.tankUnits / 4 = 1, the fuel system's own unit) from ANY common train-style source —
// a fuel can poured at its filler (one can = FUEL.canUnits = one unit) or a FUEL CART's hose (one unit per transfer tick, world/fuelCarts.ts
// FuelHoseTarget). The record becomes version 2 and stores the PAID QUANTITY:
//   {v: 2, gens: {[id]: state}, fuel: {[id]: units paid 0..BUNKER_GEN_FUEL_UNITS}, intel?, lift?: {stop}}
//   - 'fuelled' / 'online' <=> fuel[id] === BUNKER_GEN_FUEL_UNITS (paid in full); 'off' <=> less (a partial quantity stays recorded);
//   - a version-1 record migrates on load to the equivalent PAID quantity (fuelled / online = paid in full, off = 0): never charged
//     again, never refunded, an online generator never un-starts; the save validator keeps accepting version 1;
//   - lift: the version-2 Bunker's cargo lift's stop (world/bunker/cargoLift.ts), so a revisit / load finds the car where it was left.
//
// INTEL (chooseBunkerIntel, chosen AT CLAIM TIME from the current campaign knowledge, map KNOWLEDGE only — revealStations adds the node
// to CampaignState.known; never visited / current / transit / loot / fuel):
//   1. the Reactor node's location, if it is not known yet;
//   2. else one UNKNOWN Survivor Market node (a deterministic, station-owned choice: hashed by the Bunker station id + network seed);
//   3. else one UNKNOWN other node (the same rule);
//   4. else 'charted' — the network is already charted: no invented reward.

import {hashString} from '../../core/rng';
import {FUEL} from '../../fuel/fuel';
import type {CampaignState, StationId, SubwayNetwork} from '../../campaign/types';
import {archetypeLabel} from '../../campaign/network';

/** The section-memory lane of a Bunker station's objective (save/validate.ts lanes(): bunkerStateProblem). */
export const BUNKER_LANE = 'bunker.state';

export type BunkerGenState = 'off' | 'fuelled' | 'online';
export const BUNKER_GEN_STATES: readonly BunkerGenState[] = ['off', 'fuelled', 'online'];
export type BunkerIntelKind = 'reactor' | 'market' | 'node' | 'charted';
export const BUNKER_INTEL_KINDS: readonly BunkerIntelKind[] = ['reactor', 'market', 'node', 'charted'];

/** The one claim of a Bunker station (ISO time of the claim, what was revealed). */
export interface BunkerIntelJSON { claimedAt: string; kind: BunkerIntelKind; nodeId?: StationId }

/** The lane record (version 2; a stored version-1 record is read through loadBunkerState's migration). */
export interface BunkerStateJSON { v: 2; gens: Record<string, BunkerGenState>; fuel: Record<string, number>; intel?: BunkerIntelJSON; lift?: {stop: number} }
/** The first release's record (still valid in saves; migrated on load). */
export interface BunkerStateV1JSON { v: 1; gens: Record<string, BunkerGenState>; intel?: BunkerIntelJSON }

/** Fuel one generator needs: ONE quarter of a standard tank = one of the fuel system's units (fuel/fuel.ts FUEL.tankUnits = 4). */
export const BUNKER_GEN_FUEL_UNITS = FUEL.tankUnits / 4;
/** Most stops a lift record names (the version-2 Bunker has six). */
const LIFT_STOPS_MAX = 16;

/** A generator id ('gen-0' .. ; the contract's stable per-layout ids). */
export const BUNKER_GEN_ID = /^gen-\d{1,2}$/;
/** Most generators one record lists. */
export const BUNKER_GENS_MAX = 8;
/** A station id in an intel record (campaign ids are `st-NN`; anything short and plain is accepted, the network is checked on use). */
const NODE_ID = /^[A-Za-z0-9_-]{1,32}$/;
/** An ISO-8601 UTC timestamp (Date.toISOString). */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why a 'bunker.state' lane record is malformed (null = fine). Strict: unknown fields, versions, ids and states are refused. */
export function bunkerStateProblem(v: unknown): string | null {
  if (!isObj(v)) return 'the bunker objective record must be an object';
  const fields = v.v === 2 ? ['v', 'gens', 'fuel', 'intel', 'lift'] : ['v', 'gens', 'intel'];
  for (const k of Object.keys(v)) if (!fields.includes(k)) return `unexpected bunker objective field '${k}'`;
  if (v.v !== 1 && v.v !== 2) return 'unsupported bunker objective version';
  if (!isObj(v.gens)) return 'bunker generators must be an object';
  const ids = Object.keys(v.gens);
  if (ids.length > BUNKER_GENS_MAX) return `at most ${BUNKER_GENS_MAX} bunker generators`;
  for (const id of ids) {
    if (!BUNKER_GEN_ID.test(id)) return `a malformed bunker generator id '${id.slice(0, 24)}'`;
    if (!BUNKER_GEN_STATES.includes(v.gens[id] as BunkerGenState)) return `bunker generator ${id} has an unknown state`;
  }
  if (v.v === 2) {
    // the paid quantity: one entry per generator, whole units within the need, consistent with the state (in full <=> fuelled / online)
    if (!isObj(v.fuel)) return 'bunker generator fuel must be an object';
    for (const id of Object.keys(v.fuel)) if (!(id in v.gens)) return `bunker fuel for an unknown generator '${id.slice(0, 24)}'`;
    for (const id of ids) {
      const u = v.fuel[id];
      if (typeof u !== 'number' || !Number.isInteger(u) || u < 0 || u > BUNKER_GEN_FUEL_UNITS) return `bunker generator ${id} has a malformed fuel quantity`;
      if ((v.gens[id] !== 'off') !== (u === BUNKER_GEN_FUEL_UNITS)) return `bunker generator ${id}: state and fuel disagree`;
    }
    if (v.lift !== undefined) {
      if (!isObj(v.lift) || Object.keys(v.lift).some(k => k !== 'stop')) return 'a malformed bunker lift record';
      const st = v.lift.stop;
      if (typeof st !== 'number' || !Number.isInteger(st) || st < 0 || st >= LIFT_STOPS_MAX) return 'a malformed bunker lift stop';
    }
  }
  if (v.intel !== undefined) {
    const i = v.intel;
    if (!isObj(i)) return 'bunker intel must be an object';
    for (const k of Object.keys(i)) if (!['claimedAt', 'kind', 'nodeId'].includes(k)) return `unexpected bunker intel field '${k}'`;
    if (typeof i.claimedAt !== 'string' || !ISO_TIME.test(i.claimedAt)) return 'bunker intel needs a claim time';
    if (!BUNKER_INTEL_KINDS.includes(i.kind as BunkerIntelKind)) return 'bunker intel has an unknown kind';
    if (i.kind === 'charted') { if (i.nodeId !== undefined) return 'charted bunker intel names no station'; }
    else if (typeof i.nodeId !== 'string' || !NODE_ID.test(i.nodeId)) return 'bunker intel must name the revealed station';
  }
  return null;
}

/** A fresh record: every generator of the layout off, no claim. */
export function freshBunkerState(ids: readonly string[]): BunkerStateJSON {
  const gens: Record<string, BunkerGenState> = {}, fuel: Record<string, number> = {};
  for (const id of ids) { gens[id] = 'off'; fuel[id] = 0; }
  return {v: 2, gens, fuel};
}

/**
 * The record of a build: the stored one when it is valid (a copy; the layout's generators missing from it are 'off', ids the layout
 * does not have are kept as stored — nothing is ever dropped from a remembered record), else a fresh one (a malformed record never
 * crashes the build; the save validator refuses it on load anyway).
 */
export function loadBunkerState(raw: unknown, ids: readonly string[]): BunkerStateJSON {
  if (raw === undefined || bunkerStateProblem(raw) !== null) return freshBunkerState(ids);
  const r = raw as BunkerStateJSON | BunkerStateV1JSON;
  const out: BunkerStateJSON = {v: 2, gens: {...r.gens}, fuel: {}};
  // (version 1 -> 2: a fuelled / online generator was PAID in full — its can was poured; an off one paid nothing)
  for (const id of Object.keys(out.gens)) out.fuel[id] = r.v === 2 ? r.fuel[id] : out.gens[id] === 'off' ? 0 : BUNKER_GEN_FUEL_UNITS;
  for (const id of ids) { out.gens[id] ??= 'off'; out.fuel[id] ??= 0; }
  if (r.intel) out.intel = {...r.intel};
  if (r.v === 2 && r.lift) out.lift = {...r.lift};
  return out;
}

/** Units generator `id` still needs (0: paid in full — fuelled or online). */
export const fuelNeeded = (s: BunkerStateJSON, id: string): number => (s.gens[id] === 'off' ? Math.max(0, BUNKER_GEN_FUEL_UNITS - (s.fuel[id] ?? 0)) : 0);

/**
 * Commits `units` of fuel delivered to generator `id` (a completed can pour or one hose tick): never past its need; fuelled once paid in
 * full. Returns the units taken (0: nothing — not off / already paid; the caller then debits nothing).
 */
export function addGenFuel(s: BunkerStateJSON, id: string, units: number): number {
  const need = fuelNeeded(s, id);
  const take = Math.max(0, Math.min(need, Math.floor(units)));
  if (!take) return 0;
  s.fuel[id] = (s.fuel[id] ?? 0) + take;
  if (s.fuel[id] >= BUNKER_GEN_FUEL_UNITS) s.gens[id] = 'fuelled';
  return take;
}

/** A JSON copy of the record (what the lane stores). */
export const bunkerStateJSON = (s: BunkerStateJSON): BunkerStateJSON => structuredClone(s);

/** Generators of `ids` online. */
export function onlineCount(s: BunkerStateJSON, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) if (s.gens[id] === 'online') n++;
  return n;
}

/** The core is powered: the layout has generators and every one of them is online. */
export const coreAlive = (s: BunkerStateJSON, ids: readonly string[]): boolean => ids.length > 0 && onlineCount(s, ids) === ids.length;

// ---------------------------------------------------------------------------------------------------------------------------------
// Intel

/** What a claim reveals. */
export interface BunkerIntelChoice { kind: BunkerIntelKind; nodeId?: StationId }

/** The station-owned deterministic pick among `ids` (sorted): hashed by the Bunker station id, the tier and the network seed. */
function pick(net: SubwayNetwork, ids: StationId[], tier: string, bunker: StationId): StationId {
  ids.sort();
  return ids[hashString(`bunker-intel:${tier}:${bunker}`, (net.seed >>> 0) ^ 0x2c1b3c6d) % ids.length];
}

/**
 * The intel a claim at Bunker station `bunker` grants NOW (pure; chosen from the current knowledge — the 1337 cheat knows everything):
 * the unknown Reactor; else an unknown Market (deterministic per station); else an unknown other node (the same rule, never the Bunker
 * itself); else 'charted'. Old networks without Markets fall through to the next tier.
 */
export function chooseBunkerIntel(state: CampaignState, bunker: StationId): BunkerIntelChoice {
  const net = state.network;
  const known = new Set(state.cheat ? net.nodes.map(n => n.id) : state.known);
  if (!known.has(net.reactor) && net.nodes.some(n => n.id === net.reactor)) return {kind: 'reactor', nodeId: net.reactor};
  const markets = net.nodes.filter(n => n.archetype === 'market' && !known.has(n.id) && n.id !== bunker).map(n => n.id);
  if (markets.length) return {kind: 'market', nodeId: pick(net, markets, 'market', bunker)};
  const others = net.nodes.filter(n => !known.has(n.id) && n.id !== bunker).map(n => n.id);
  if (others.length) return {kind: 'node', nodeId: pick(net, others, 'node', bunker)};
  return {kind: 'charted'};
}

/** The player-facing words of a claim (toast, screen lines). Map prose only: a type and a name, never fuel or loot figures. */
export function bunkerIntelText(intel: BunkerIntelChoice | null | undefined, net: SubwayNetwork | null | undefined): {head: string; line: string; toast: string} {
  if (!intel) return {head: 'MAP INTEL', line: 'Not retrieved', toast: ''};
  if (intel.kind === 'charted') return {head: 'NETWORK CHARTED', line: 'Every station is already on your map', toast: 'Map intel — the network is already charted: nothing new for your map'};
  const node = net?.nodes.find(n => n.id === intel.nodeId);
  const name = node?.name ?? 'an unlisted station';
  const type = intel.kind === 'reactor' ? 'Reactor' : intel.kind === 'market' ? 'Survivor market' : node ? archetypeLabel(node.archetype) : 'Station';
  return {head: `${type.toUpperCase()} LOCATED`, line: `${name} — ${type}`, toast: `Map intel retrieved — ${type} located: ${name} is now on your map`};
}
