// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): DISCOVERY — what the player knows of the network, and where the
// train may go. Pure helpers on the contract's CampaignState (campaign/types.ts): they never mutate their input and return a new
// state (or the same object when nothing changes). No DOM.
//
//  - A new campaign knows and has visited only the start; the train stands there.
//  - The train console reveals the current station and every one-hop neighbour (revealAround); known stations are never forgotten.
//  - Travel goes to a KNOWN station adjacent to the current one (never the current station itself) — unless the 1337 map cheat is
//    on for this run (enableCheat: the whole network becomes known and any station is a destination).
//  - Arrival marks the station visited (and known) and makes it current.
//  - The map shows the known stations and every edge whose two ends are known (with the cheat: everything).

import type {CampaignState, StationId, StationNode, SubwayNetwork} from './types';
import {validateNetwork} from './network';

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

/** Whether the train may travel to `to` now: a known neighbour of the current station (any other station with the cheat). */
export function canTravel(state: CampaignState, to: StationId): boolean {
  if (to === state.current || !hasNode(state.network, to)) return false;
  if (state.cheat) return true;
  return state.known.includes(to) && neighbors(state.network, state.current).includes(to);
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
    else if (!tr.cheat && !neighbors(net, tr.from as string).includes(tr.to as string)) errs.push('campaign: a non-cheat transit must go to a neighbour');
  }
  return errs;
}
