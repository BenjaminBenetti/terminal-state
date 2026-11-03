// Task studio-beta-campaign-polish-20261103-063841-01 (lane MAP), item 13: MULTI-HOP travel to VISITED stations
// (campaign/discovery.ts travelPlan / visitedRoute / travelBlock / transitOf / transitRouteProblem). 'Explored' = visited, never merely
// revealed; the route runs over connected visited stations only (the current one included), the shortest, ties broken by station id;
// never across an unvisited / unknown station or ignoring the track; a disconnected visited target is "not available"; adjacent
// unexplored travel and the 1337 cheat are unchanged. The trip record (route / destination) validates on load — campaign validator and
// the save validator alike. The orchestration (one continuous journey, one departure + one arrival autosave, no intermediate load,
// Continue resuming once) is in campaign-journey.test.ts. Node only.

import {describe, expect, it} from 'vitest';
import {generateNetwork} from '../src/campaign/network';
import {
  arrive, canTravel, destinations, enableCheat, neighbors, newCampaign, revealAround, transitOf, transitRouteProblem, travelBlock, travelPlan,
  validateCampaign, visitedRoute,
} from '../src/campaign/discovery';
import type {CampaignState, StationId, SubwayNetwork} from '../src/campaign/types';
import {parseSaveText} from '../src/save/validate';
import {saveFileText} from '../src/save/serialize';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

/** A tiny hand-made graph (travel planning needs only nodes + edges): ids, undirected pairs. */
function tiny(ids: string[], pairs: [string, string][]): SubwayNetwork {
  const edges = pairs.map(([a, b]) => (a < b ? [a, b] : [b, a]) as [string, string]).sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : 1));
  return {v: 1, seed: 1, nodes: ids.map((id, i) => ({id, name: `N${i}`, archetype: 'subway', levelSeed: i, x: i, y: 0, lines: ['l']})), edges, lines: [], start: ids[0], reactor: ids[ids.length - 1]};
}
const state = (net: SubwayNetwork, o: Partial<CampaignState>): CampaignState => ({...newCampaign(net), ...o});

describe('the route rules', () => {
  //   a - b - d - f
  //    \     /
  //     c - e        (a..f visited unless stated; g is a neighbour of f)
  const net = tiny(['st-a', 'st-b', 'st-c', 'st-d', 'st-e', 'st-f', 'st-g'], [['st-a', 'st-b'], ['st-b', 'st-d'], ['st-a', 'st-c'], ['st-c', 'st-e'], ['st-e', 'st-d'], ['st-d', 'st-f'], ['st-f', 'st-g']]);
  const all = ['st-a', 'st-b', 'st-c', 'st-d', 'st-e', 'st-f'];

  it('the shortest route over visited stations, ending at the visited destination; the current station is its first stop', () => {
    const s = state(net, {current: 'st-a', visited: all, known: [...all, 'st-g']});
    expect(visitedRoute(s, 'st-f')).toEqual(['st-a', 'st-b', 'st-d', 'st-f']);
    expect(travelPlan(s, 'st-f')).toEqual({to: 'st-f', route: ['st-a', 'st-b', 'st-d', 'st-f'], hops: 3, cheat: false});
    expect(travelPlan(s, 'st-e')).toEqual({to: 'st-e', route: ['st-a', 'st-c', 'st-e'], hops: 2, cheat: false});
    expect(canTravel(s, 'st-a')).toBe(false); // never the current station
    expect(travelBlock(s, 'st-a')).toBe('here');
  });

  it('ties of equal length go by station id (the lexicographically smallest id sequence)', () => {
    // a -> d: a-b-d and a-c-e-d? (3 hops) vs a-b-d (2): shortest wins; then two equal 2-hop routes from b's side
    const diamond = tiny(['st-1', 'st-3', 'st-2', 'st-4'], [['st-1', 'st-3'], ['st-1', 'st-2'], ['st-3', 'st-4'], ['st-2', 'st-4']]);
    const s = state(diamond, {current: 'st-1', visited: ['st-1', 'st-2', 'st-3', 'st-4'], known: ['st-1', 'st-2', 'st-3', 'st-4']});
    expect(visitedRoute(s, 'st-4')).toEqual(['st-1', 'st-2', 'st-4']);
    // reversed id order: still the smallest
    const s2 = state(diamond, {current: 'st-4', visited: ['st-1', 'st-2', 'st-3', 'st-4'], known: ['st-1', 'st-2', 'st-3', 'st-4']});
    expect(visitedRoute(s2, 'st-1')).toEqual(['st-4', 'st-2', 'st-1']);
  });

  it('never across an unvisited station: the route detours over visited track, or the target is not available', () => {
    // b unvisited: a -> f goes a-c-e-d-f
    const s = state(net, {current: 'st-a', visited: all.filter(x => x !== 'st-b'), known: all});
    expect(travelPlan(s, 'st-f')?.route).toEqual(['st-a', 'st-c', 'st-e', 'st-d', 'st-f']);
    // b and c unvisited: f is visited but cut off from a over visited stations -> not available (no fake path)
    const cut = state(net, {current: 'st-a', visited: ['st-a', 'st-d', 'st-e', 'st-f'], known: all});
    expect(travelPlan(cut, 'st-f')).toBeNull();
    expect(travelBlock(cut, 'st-f')).toBe('no-route');
    // a known but unvisited, non-adjacent station is no destination ("not explored")
    expect(travelPlan(cut, 'st-d')).toBeNull();
    expect(travelBlock(cut, 'st-d')).toBe('no-route');
    const s3 = state(net, {current: 'st-a', visited: ['st-a', 'st-b'], known: ['st-a', 'st-b', 'st-c', 'st-d']});
    expect(travelBlock(s3, 'st-d')).toBe('not-explored');
    expect(travelBlock(s3, 'st-g')).toBe('unknown');
    expect(travelBlock(s3, 'st-zz')).toBe('unknown');
  });

  it('adjacent unexplored travel is unchanged (a known neighbour, one hop); an unknown neighbour is not', () => {
    const s = state(net, {current: 'st-d', visited: ['st-a', 'st-b', 'st-d'], known: ['st-a', 'st-b', 'st-d', 'st-f']});
    expect(travelPlan(s, 'st-f')).toEqual({to: 'st-f', route: ['st-d', 'st-f'], hops: 1, cheat: false});
    expect(travelPlan(s, 'st-e')).toBeNull(); // adjacent, not on the map yet
    expect(travelPlan(s, 'st-a')?.route).toEqual(['st-d', 'st-b', 'st-a']);
  });

  it('the 1337 cheat stays its own permission: a direct cheat trip anywhere (no route)', () => {
    const s = state(net, {current: 'st-a', visited: ['st-a'], known: ['st-a']});
    const c = enableCheat(s);
    expect(travelPlan(c, 'st-g')).toEqual({to: 'st-g', route: ['st-a', 'st-g'], hops: 1, cheat: true});
    expect(travelPlan(c, 'st-b')).toEqual({to: 'st-b', route: ['st-a', 'st-b'], hops: 1, cheat: false});
    expect(transitOf(c, travelPlan(c, 'st-g')!)).toEqual({from: 'st-a', to: 'st-g', phase: 'departing', cheat: true});
  });

  it('the transit record: a multi-hop trip carries its route, a one-hop trip does not (old saves stay valid)', () => {
    const s = state(net, {current: 'st-a', visited: all, known: all});
    expect(transitOf(s, travelPlan(s, 'st-f')!)).toEqual({from: 'st-a', to: 'st-f', phase: 'departing', cheat: false, route: ['st-a', 'st-b', 'st-d', 'st-f']});
    expect(transitOf(s, travelPlan(s, 'st-b')!)).toEqual({from: 'st-a', to: 'st-b', phase: 'departing', cheat: false});
  });

  it('transitRouteProblem: endpoints, >= 3 stations, no repeats, real track, every stop after the first visited, never with the cheat', () => {
    const v = new Set(all);
    const t = (route: unknown, o: object = {}) => transitRouteProblem(net, {from: 'st-a', to: 'st-f', cheat: false, route, ...o}, v);
    expect(t(['st-a', 'st-b', 'st-d', 'st-f'])).toBeNull();
    expect(t(['st-a', 'st-f'])).toMatch(/3 or more/);
    expect(t(['st-b', 'st-d', 'st-f'])).toMatch(/from its start to its destination/);
    expect(t(['st-a', 'st-b', 'st-a', 'st-b', 'st-d', 'st-f'])).toMatch(/repeats/);
    expect(t(['st-a', 'st-d', 'st-f'])).toMatch(/no track st-a - st-d/);
    expect(transitRouteProblem(net, {from: 'st-a', to: 'st-f', cheat: false, route: ['st-a', 'st-b', 'st-d', 'st-f']}, new Set(['st-a', 'st-d', 'st-f']))).toMatch(/st-b, which was never visited/);
    expect(t(['st-a', 'st-b', 'st-d', 'st-f'], {cheat: true})).toMatch(/cheat/);
    expect(t('st-a,st-f')).toMatch(/3 or more/);
  });
});

describe('on a generated network (the real one-hop discovery)', () => {
  const net = generateNetwork(424242);
  it('after walking out, every visited station is a destination over the visited stations; unvisited far ones are not', () => {
    let s = revealAround(newCampaign(net), net.start);
    const walked: StationId[] = [net.start];
    for (let i = 0; i < 6; i++) {
      const next = neighbors(net, s.current).find(n => !walked.includes(n) && s.known.includes(n));
      if (!next) break;
      expect(travelPlan(s, next)?.hops).toBe(1);
      s = revealAround(arrive(s, next), next);
      walked.push(next);
    }
    expect(walked.length).toBeGreaterThan(3);
    for (const v of walked.slice(0, -1)) {
      const p = travelPlan(s, v)!;
      expect(p).not.toBeNull();
      expect(p.route[0]).toBe(s.current);
      expect(p.route[p.route.length - 1]).toBe(v);
      for (const x of p.route.slice(1)) expect(s.visited).toContain(x);
      for (let i = 1; i < p.route.length; i++) expect(neighbors(net, p.route[i - 1])).toContain(p.route[i]);
    }
    for (const k of s.known) if (!s.visited.includes(k) && !neighbors(net, s.current).includes(k)) expect(canTravel(s, k)).toBe(false);
    expect(destinations(s).filter(d => !neighbors(net, s.current).includes(d)).sort()).toEqual(walked.filter(w => w !== s.current && !neighbors(net, s.current).includes(w)).sort());
  });
});

describe('the trip record validates on load', () => {
  // fixture network: red st-00 .. st-19 (a chain), blue st-19 .. st-39, green st-10 - st-25
  const base = fixtureCampaign({current: sid(3), visited: [sid(0), sid(1), sid(2), sid(3)], known: [sid(0), sid(1), sid(2), sid(3), sid(4)]});
  const routed = (route: string[], o: object = {}): CampaignState => ({...base, transit: {from: sid(3), to: route[route.length - 1], phase: 'departing', cheat: false, route, ...o}});

  it('validateCampaign: a multi-hop departure over visited track is valid; a broken route is not', () => {
    const net = generateNetwork(424242);
    let s = revealAround(newCampaign(net), net.start);
    const walked = [net.start];
    for (let i = 0; i < 3; i++) { const n = neighbors(net, s.current).find(x => !walked.includes(x) && !neighbors(net, x).some(y => walked.slice(0, -1).includes(y)))!; s = revealAround(arrive(s, n), n); walked.push(n); }
    const back = travelPlan(s, net.start)!;
    expect(back.hops).toBe(3);
    const t = (o: object) => validateCampaign({...s, transit: {...transitOf(s, back), ...o}});
    expect(t({})).toEqual([]);
    const unvisited = neighbors(net, s.current).find(x => !s.visited.includes(x))!;
    expect(t({to: unvisited, route: [s.current, unvisited, neighbors(net, unvisited).find(x => x !== s.current)!]}).join()).toMatch(/never visited|start to its destination/);
    expect(t({route: [s.current, walked[1], net.start]}).join()).toMatch(/no track/);
    expect(t({to: walked[1]}).join()).toMatch(/start to its destination/);
    expect(validateCampaign({...s, transit: {from: s.current, to: net.start, phase: 'departing', cheat: false}}).join()).toMatch(/neighbour/); // no route: one hop only
  });

  it('the save validator: a departure save with a route round-trips; tampered routes are refused with a clear message', () => {
    const file = (c: CampaignState) => { const h = new Harness(c); return saveFileText(h.file('departure')); };
    const ok = parseSaveText(file(routed([sid(3), sid(2), sid(1), sid(0)])));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.run.campaign.transit).toEqual({from: sid(3), to: sid(0), phase: 'departing', cheat: false, route: [sid(3), sid(2), sid(1), sid(0)]});
    for (const [c, re] of [
      [routed([sid(3), sid(4), sid(5)]), /never visited/],
      [routed([sid(3), sid(1), sid(0)]), /no track/],
      [routed([sid(3), sid(0)]), /too few entries/],
      [routed([sid(3), sid(2), sid(1), sid(0)], {extra: 1}), /unexpected field 'extra'/],
    ] as const) {
      const r = parseSaveText(file(c as CampaignState));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    }
  });
});
