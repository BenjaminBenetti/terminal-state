// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): DISCOVERY — what the player knows of the network, and where the
// train may go. Pure helpers on the contract's CampaignState (campaign/types.ts): they never mutate their input and return a new
// state (or the same object when nothing changes). No DOM.
//
//  - A new campaign knows and has visited only the start; the train stands there.
//  - The train console reveals the current station and every one-hop neighbour (revealAround); known stations are never forgotten.
//  - Travel goes to a KNOWN station adjacent to the current one (never the current station itself), or (campaign-polish lane MAP) to
//    a VISITED station over a route of visited stations (travelPlan: one continuous journey) — unless the 1337 map cheat is on for
//    this run (enableCheat: the whole network becomes known and any station is a direct destination).
//  - Saves made before the Maintenance Route existed get it once on load (upgradeCampaign: a minimal, deterministic graph update).
//  - Arrival marks the station visited (and known) and makes it current.
//  - The map shows the known stations and every edge whose two ends are known (with the cheat: everything).

import type {CampaignState, StationId, StationNode, SubwayNetwork} from './types';
import {addMaintenanceRoute, maintenanceRouteNode, validateNetwork, type BypassInfo} from './network';

const neighbourCache = new WeakMap<SubwayNetwork, Map<StationId, StationId[]>>();

/** One-hop neighbours of a station (sorted ids; empty for an unknown id). */
export function neighbors(net: SubwayNetwork, id: StationId): StationId[] {
  let m = neighbourCache.get(net);
  if (!m) {
    m = new Map(net.nodes.map(n => [n.id, [] as StationId[]]));
    for (const [a, b] of net.edges) { m.get(a)?.push(b); m.get(b)?.push(a); }
    for (const v of m.values()) v.sort();
    neighbourCache.set(net, m);
  }
  return (m.get(id) ?? []).slice();
}

const hasNode = (net: SubwayNetwork, id: StationId) => net.nodes.some(n => n.id === id);

/** A fresh run on `network`: known = visited = [start], the train at the start, no cheat, not won, no transit. */
export function newCampaign(network: SubwayNetwork): CampaignState {
  return {v: 1, network, current: network.start, known: [network.start], visited: [network.start], cheat: false, won: null, transit: null};
}

/** `list` plus the ids not in it yet (order kept; the same array when nothing is new). */
function union(list: readonly StationId[], add: readonly StationId[]): StationId[] {
  const have = new Set(list);
  const extra = add.filter(id => !have.has(id) && (have.add(id), true));
  return extra.length ? [...list, ...extra] : (list as StationId[]);
}

/** The console's reveal: station `id` and every one-hop neighbour become known (previously known stations stay known). */
export function revealAround(state: CampaignState, id: StationId): CampaignState {
  if (!hasNode(state.network, id)) return state;
  const known = union(state.known, [id, ...neighbors(state.network, id)]);
  return known === state.known ? state : {...state, known};
}

/**
 * Whether the train may travel to `to` now: a known neighbour of the current station, or (task campaign-polish-20261103-063841, lane
 * MAP) a VISITED station reachable over visited stations (travelPlan); any other station with the cheat.
 */
export function canTravel(state: CampaignState, to: StationId): boolean {
  return travelPlan(state, to) !== null;
}

// --- multi-hop travel (task campaign-polish-20261103-063841, lane MAP) --------------------------------------------------------------
//
// User: "Allow travel across multiple nodes when those nodes are already explored." 'Explored' = VISITED (the stable flag), never merely
// revealed one hop away. A visited destination is reached over connected track whose every station after the current one is visited
// (the current station is visited by definition); the shortest such route, ties broken by station id (the lexicographically smallest
// id sequence among the shortest). Never across an unvisited / unknown station, never ignoring the track. Adjacent unexplored travel is
// unchanged; the 1337 cheat stays its own separate permission (a direct cheat trip, no route).

/** A trip the console may start: `route` = [current, ..., to] (2 stations: one hop). */
export interface TravelPlan { to: StationId; route: StationId[]; hops: number; cheat: boolean }

/** Why `to` is not a destination: the current station, not a station on the map, not visited and not one stop away, no visited route. */
export type TravelBlock = 'here' | 'unknown' | 'not-explored' | 'no-route';

/** The shortest route current -> `to` over VISITED stations only (ties: smallest ids), or null (unvisited target / no such route). */
export function visitedRoute(state: CampaignState, to: StationId): StationId[] | null {
  const from = state.current;
  const ok = new Set(state.visited);
  if (!ok.has(to) || !ok.has(from)) return null;
  if (from === to) return [from];
  // hops to `to` over visited stations, then walk from the current station always to the smallest-id neighbour one hop nearer
  const d = new Map<StationId, number>([[to, 0]]);
  const q = [to];
  for (let i = 0; i < q.length && !d.has(from); i++) for (const n of neighbors(state.network, q[i])) if (ok.has(n) && !d.has(n)) { d.set(n, d.get(q[i])! + 1); q.push(n); }
  if (!d.has(from)) return null;
  const route = [from];
  for (let c = from; c !== to;) {
    const k = d.get(c)!;
    c = neighbors(state.network, c).find(n => d.get(n) === k - 1)!; // neighbors() is id-sorted
    route.push(c);
  }
  return route;
}

/** The trip to `to` the console allows now (one hop to a known neighbour, a visited multi-hop route, or the cheat), else null. */
export function travelPlan(state: CampaignState, to: StationId): TravelPlan | null {
  if (to === state.current || !hasNode(state.network, to)) return null;
  const adjacent = neighbors(state.network, state.current).includes(to);
  if (state.cheat) return {to, route: [state.current, to], hops: 1, cheat: !adjacent};
  if (adjacent && state.known.includes(to)) return {to, route: [state.current, to], hops: 1, cheat: false};
  const route = visitedRoute(state, to);
  return route ? {to, route, hops: route.length - 1, cheat: false} : null;
}

/** Why travelPlan(state, to) is null (null when it is not). */
export function travelBlock(state: CampaignState, to: StationId): TravelBlock | null {
  if (travelPlan(state, to)) return null;
  if (to === state.current) return 'here';
  if (!hasNode(state.network, to) || !(state.cheat || state.known.includes(to))) return 'unknown';
  return state.visited.includes(to) ? 'no-route' : 'not-explored';
}

/** The pending transit record of a plan (departure autosave): a multi-hop trip carries its route. */
export function transitOf(state: CampaignState, plan: TravelPlan): NonNullable<CampaignState['transit']> {
  return {from: state.current, to: plan.to, phase: 'departing', cheat: plan.cheat, ...(plan.hops > 1 ? {route: plan.route.slice()} : {})};
}

/**
 * A transit's route problem (null = fine): [from, ..., to], >= 3 stations, no repeats, consecutive pairs on the track, every station
 * after `from` visited, never with the cheat flag. Shared by validateCampaign and the save validator (save/validate.ts).
 */
export function transitRouteProblem(net: SubwayNetwork, t: {from: unknown; to: unknown; cheat: unknown; route?: unknown}, visited: ReadonlySet<string>): string | null {
  const r = t.route;
  if (!Array.isArray(r) || r.length < 3 || r.length > net.nodes.length || r.some(x => typeof x !== 'string')) return 'a journey route must list 3 or more stations';
  if (t.cheat === true) return 'a cheat journey has no route';
  if (r[0] !== t.from || r[r.length - 1] !== t.to) return 'a journey route must run from its start to its destination';
  if (new Set(r).size !== r.length) return 'a journey route repeats a station';
  for (let i = 1; i < r.length; i++) {
    if (!neighbors(net, r[i - 1] as string).includes(r[i] as string)) return `a journey route has no track ${String(r[i - 1])} - ${String(r[i])}`;
    if (!visited.has(r[i] as string)) return `a journey route passes ${String(r[i])}, which was never visited`;
  }
  return null;
}

/** Every station the train may travel to now (network order). */
export function destinations(state: CampaignState): StationId[] {
  return state.network.nodes.map(n => n.id).filter(id => canTravel(state, id));
}

/** The 1337 map cheat (THIS run only; idempotent): every station becomes known and any station is a destination. */
export function enableCheat(state: CampaignState): CampaignState {
  const known = union(state.known, state.network.nodes.map(n => n.id));
  if (state.cheat && known === state.known) return state;
  return {...state, cheat: true, known};
}

/** Arrival at `id`: it becomes the current station, visited and known (the console still does the one-hop reveal). */
export function arrive(state: CampaignState, id: StationId): CampaignState {
  if (!hasNode(state.network, id)) return state;
  const visited = union(state.visited, [id]), known = union(state.known, [id]);
  if (state.current === id && visited === state.visited && known === state.known) return state;
  return {...state, current: id, visited, known};
}

/** Stations drawn on the map: the known ones (all of them with the cheat), network order. */
export function visibleNodes(state: CampaignState): StationNode[] {
  if (state.cheat) return state.network.nodes.slice();
  const k = new Set(state.known);
  return state.network.nodes.filter(n => k.has(n.id));
}

/** Track edges drawn on the map: both ends known (all of them with the cheat). */
export function visibleEdges(state: CampaignState): [StationId, StationId][] {
  if (state.cheat) return state.network.edges.slice();
  const k = new Set(state.known);
  return state.network.edges.filter(([a, b]) => k.has(a) && k.has(b));
}

/** Whether the Reactor is on the map. */
export function reactorKnown(state: CampaignState): boolean {
  return state.cheat || state.known.includes(state.network.reactor);
}

/** Whether station `id` has been visited. */
export const isVisited = (state: CampaignState, id: StationId): boolean => state.visited.includes(id);

/**
 * Structural checks of a CampaignState (the save importer): the network (validateNetwork), known / visited / current / transit
 * consistency. Never throws; returns the problems (empty = valid). Accepts untrusted parsed JSON.
 */
export function validateCampaign(state: unknown): string[] {
  if (typeof state !== 'object' || state === null) return ['campaign: not an object'];
  const s = state as Record<string, unknown>;
  const errs: string[] = [];
  if (s.v !== 1) errs.push('campaign: v must be 1');
  const netErrs = validateNetwork(s.network);
  if (netErrs.length) return [...errs, ...netErrs];
  const net = s.network as SubwayNetwork;
  const ids = new Set(net.nodes.map(n => n.id));
  const list = (k: 'known' | 'visited') => {
    const v = s[k];
    if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !ids.has(x))) { errs.push(`campaign: ${k} must list network stations`); return null; }
    if (new Set(v).size !== v.length) errs.push(`campaign: ${k} repeats a station`);
    return v as string[];
  };
  const known = list('known'), visited = list('visited');
  if (typeof s.current !== 'string' || !ids.has(s.current)) errs.push('campaign: current is not a station');
  if (known && visited) {
    if (!visited.every(v => known.includes(v))) errs.push('campaign: a visited station is not known');
    if (!visited.includes(net.start)) errs.push('campaign: the start is not visited');
    if (typeof s.current === 'string' && !visited.includes(s.current)) errs.push('campaign: the current station is not visited');
  }
  if (typeof s.cheat !== 'boolean') errs.push('campaign: cheat must be a boolean');
  else if (s.cheat && known && known.length !== ids.size) errs.push('campaign: the cheat is on but not every station is known');
  const won = s.won;
  if (won !== null && (typeof won !== 'object' || typeof (won as Record<string, unknown>).at !== 'string' || typeof (won as Record<string, unknown>).via !== 'string'
    || !ids.has((won as Record<string, unknown>).station as string))) errs.push('campaign: bad won record');
  const t = s.transit;
  if (t !== null) {
    const tr = t as Record<string, unknown> | undefined;
    if (!tr || typeof tr !== 'object' || !ids.has(tr.from as string) || !ids.has(tr.to as string) || tr.from === tr.to || tr.phase !== 'departing' || typeof tr.cheat !== 'boolean') errs.push('campaign: bad transit');
    else if (tr.from !== s.current) errs.push('campaign: a transit must leave the current station');
    else if (tr.route !== undefined) { const p = transitRouteProblem(net, tr as {from: unknown; to: unknown; cheat: unknown; route: unknown}, new Set(visited ?? [])); if (p) errs.push(`campaign: ${p}`); }
    else if (!tr.cheat && !neighbors(net, tr.from as string).includes(tr.to as string)) errs.push('campaign: a non-cheat transit must go to a neighbour');
  }
  return errs;
}

// --- the save compatibility update (task campaign-polish-20261103-063841, lane MAP) ------------------------------------------------

/** What upgradeCampaign did (reported once on load; tests). */
export interface CampaignUpgrade {
  state: CampaignState;
  /** 'present': the network already had its Maintenance Route; 'added': the update gave it one; 'unchanged': impossible (reported). */
  status: 'present' | 'added' | 'unchanged';
  /** The station that became the Maintenance Route (its id, archetype, seed and memory untouched). */
  node?: StationId;
  /** 'unseen': a station the save never showed; 'unvisited': one shown on the map but never visited (no world memory; hidden again). */
  tier?: 'unseen' | 'unvisited';
  info?: Omit<BypassInfo, 'network'>;
  reason?: string;
}

/**
 * THE compatibility update of a saved campaign made before the Maintenance Route existed: deterministic, minimal, never a regenerate /
 * wipe. Everything the save holds stays as it was — station ids, archetypes, seeds, names (but one), visited, known, current, the
 * pending journey, the cheat, the win; every remembered world (loot, kills, lanes) stays keyed by its unchanged station id. The ONLY
 * change is network-level (campaign/network.ts addMaintenanceRoute): ONE station the player has never seen (not known, not visited,
 * no memory, not on the journey) — preferably a terminus — moves beside the Reactor, is printed "Maintenance Route", and a short
 * service line joins it to the Reactor's approach and beyond. When every candidate was seen, a station that was only SHOWN (known,
 * never visited, no memory) may move instead and is hidden again (it is re-revealed at the approach). Impossible -> unchanged.
 * `remembered`: station ids with saved world memory (section keys / the Retry snapshot). Idempotent.
 */
export function upgradeCampaign(state: CampaignState, o: {remembered?: Iterable<StationId>} = {}): CampaignUpgrade {
  const net = state.network;
  if (maintenanceRouteNode(net)) return {state, status: 'present'};
  const t = state.transit;
  const fixed = new Set<StationId>([state.current, net.start, net.reactor, ...state.visited, ...(o.remembered ?? [])]);
  if (t) for (const id of [t.from, t.to, ...(t.route ?? [])]) fixed.add(id);
  if (state.won) fixed.add(state.won.station);
  const trace: string[] = [];
  const tiers: ['unseen' | 'unvisited', Set<StationId>][] = [['unseen', new Set([...fixed, ...state.known])], ['unvisited', fixed]];
  for (const [tier, keep] of tiers) {
    if (tier === 'unvisited' && state.cheat) break; // with the cheat every station is shown: nothing moves that the player saw
    const got = addMaintenanceRoute(net, {keep, trace});
    if (!got) continue;
    const {network, ...info} = got;
    const known = tier === 'unvisited' ? state.known.filter(k => k !== got.node) : state.known;
    return {state: {...state, network, known}, status: 'added', node: got.node, tier, info};
  }
  return {state, status: 'unchanged', reason: trace.join('; ') || 'no candidate'};
}
