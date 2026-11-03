// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): discovery on the campaign network (campaign/discovery.ts) —
// the new run, the console's one-hop reveal, adjacency-only travel, arrival, the 1337 cheat (this run only, idempotent), what the
// map may show, the Reactor staying hidden until the player stands next to it, and validateCampaign for the save importer. Node only.

import {describe, expect, it} from 'vitest';
import {generateNetwork, graphDistances} from '../src/campaign/network';
import {arrive, canTravel, destinations, enableCheat, isVisited, neighbors, newCampaign, reactorKnown, revealAround, validateCampaign, visibleEdges, visibleNodes} from '../src/campaign/discovery';
import type {CampaignState, SubwayNetwork} from '../src/campaign/types';

const net = generateNetwork(424242);
const snapshot = (s: CampaignState) => JSON.stringify(s);

/** Shortest path start -> to (inclusive). */
function path(n: SubwayNetwork, to: string): string[] {
  const prev = new Map<string, string>([[n.start, '']]);
  const q = [n.start];
  for (let i = 0; i < q.length; i++) for (const nb of neighbors(n, q[i])) if (!prev.has(nb)) { prev.set(nb, q[i]); q.push(nb); }
  const out: string[] = [];
  for (let c = to; c; c = prev.get(c)!) out.unshift(c);
  return out;
}

describe('a new campaign', () => {
  it('knows and has visited only the start; the train is there; no cheat, not won, no transit', () => {
    const s = newCampaign(net);
    expect(s).toEqual({v: 1, network: net, current: net.start, known: [net.start], visited: [net.start], cheat: false, won: null, transit: null});
    expect(validateCampaign(s)).toEqual([]);
    expect(visibleNodes(s).map(n => n.id)).toEqual([net.start]);
    expect(visibleEdges(s)).toEqual([]);
    expect(reactorKnown(s)).toBe(false);
    expect(destinations(s)).toEqual([]); // the neighbours are not known until the console reveals them
  });
});

describe('neighbours and the reveal', () => {
  it('neighbors are sorted, symmetric and match the edge list', () => {
    let pairs = 0;
    for (const n of net.nodes) {
      const nb = neighbors(net, n.id);
      expect(nb).toEqual([...nb].sort());
      for (const m of nb) { expect(neighbors(net, m)).toContain(n.id); pairs++; }
    }
    expect(pairs).toBe(net.edges.length * 2);
    expect(neighbors(net, 'st-99')).toEqual([]);
  });

  it('revealAround adds the station and every one-hop neighbour, keeps what was known, never mutates, is idempotent', () => {
    const s0 = newCampaign(net), before = snapshot(s0);
    const s1 = revealAround(s0, net.start);
    expect(snapshot(s0)).toBe(before);
    expect(new Set(s1.known)).toEqual(new Set([net.start, ...neighbors(net, net.start)]));
    expect(s1.known[0]).toBe(net.start);
    expect(revealAround(s1, net.start)).toBe(s1); // nothing new: the same object
    expect(revealAround(s1, 'st-99')).toBe(s1);
    const nb = neighbors(net, net.start)[0];
    const s2 = revealAround(arrive(s1, nb), nb);
    for (const k of s1.known) expect(s2.known).toContain(k);
    for (const k of neighbors(net, nb)) expect(s2.known).toContain(k);
    expect(new Set(s2.known).size).toBe(s2.known.length);
  });
});

describe('travel', () => {
  it('only to a known neighbour of the current station, never to the current station', () => {
    const s0 = newCampaign(net);
    const nb = neighbors(net, net.start);
    for (const id of nb) expect(canTravel(s0, id)).toBe(false); // adjacent but not on the map yet
    const s1 = revealAround(s0, net.start);
    for (const id of nb) expect(canTravel(s1, id)).toBe(true);
    expect(canTravel(s1, net.start)).toBe(false);
    expect(destinations(s1)).toEqual(net.nodes.map(n => n.id).filter(id => nb.includes(id)));
    // two hops on, the start is still on the map but no longer a destination
    const hop1 = revealAround(arrive(s1, nb[0]), nb[0]);
    const n2 = neighbors(net, nb[0]).find(x => x !== net.start && !neighbors(net, x).includes(net.start))!;
    const s2 = revealAround(arrive(hop1, n2), n2);
    const notAdj = s2.known.filter(k => k !== n2 && !neighbors(net, n2).includes(k));
    expect(notAdj).toContain(net.start);
    expect(notAdj.length).toBeGreaterThan(0);
    for (const k of notAdj) expect(canTravel(s2, k)).toBe(false);
    expect(canTravel(s2, 'st-99')).toBe(false);
  });

  it('arrival makes the station current, visited and known (the console reveal is separate)', () => {
    const s1 = revealAround(newCampaign(net), net.start);
    const nb = neighbors(net, net.start)[0];
    const s2 = arrive(s1, nb);
    expect([s2.current, isVisited(s2, nb), s2.known.includes(nb), s2.visited]).toEqual([nb, true, true, [net.start, nb]]);
    expect(s1.current).toBe(net.start); // not mutated
    expect(arrive(s2, nb)).toBe(s2);
    expect(arrive(s2, 'st-99')).toBe(s2);
    expect(validateCampaign(s2)).toEqual([]);
  });
});

describe('the 1337 cheat', () => {
  it('reveals every station, allows any destination but the current one, this run only, idempotently', () => {
    const s1 = revealAround(newCampaign(net), net.start), before = snapshot(s1);
    const c = enableCheat(s1);
    expect(snapshot(s1)).toBe(before);
    expect([c.cheat, new Set(c.known).size, c.known.slice(0, s1.known.length)]).toEqual([true, net.nodes.length, s1.known]);
    expect(enableCheat(c)).toBe(c);
    for (const n of net.nodes) expect(canTravel(c, n.id)).toBe(n.id !== c.current);
    expect(visibleNodes(c).length).toBe(net.nodes.length);
    expect(visibleEdges(c)).toEqual(net.edges);
    expect(reactorKnown(c)).toBe(true);
    expect(validateCampaign(c)).toEqual([]);
    // a fresh run on the same network starts without it
    expect(newCampaign(net).cheat).toBe(false);
  });
});

describe('what the map shows', () => {
  it('known stations only; an edge only when both ends are known', () => {
    let s = revealAround(newCampaign(net), net.start);
    const nb = neighbors(net, net.start)[0];
    s = revealAround(arrive(s, nb), nb);
    const k = new Set(s.known);
    expect(visibleNodes(s).map(n => n.id).sort()).toEqual([...k].sort());
    const ve = visibleEdges(s);
    for (const [a, b] of ve) expect(k.has(a) && k.has(b)).toBe(true);
    expect(ve.length).toBe(net.edges.filter(([a, b]) => k.has(a) && k.has(b)).length);
  });

  it('one-hop discovery never spoils the Reactor: it appears only once the train stands next to it', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const n = generateNetwork(seed * 1013);
      const route = path(n, n.reactor);
      expect(route.length - 1).toBe(graphDistances(n, n.start).get(n.reactor));
      let s = revealAround(newCampaign(n), n.start);
      for (let i = 1; i < route.length; i++) {
        expect([seed, i, reactorKnown(s)]).toEqual([seed, i, i === route.length - 1]); // known exactly when standing one hop away
        expect(canTravel(s, route[i])).toBe(true);
        s = revealAround(arrive(s, route[i]), route[i]);
      }
      expect(s.current).toBe(n.reactor);
    }
  });
});

describe('validateCampaign (save import)', () => {
  const ok = revealAround(newCampaign(net), net.start);
  const bad = (f: (s: Record<string, unknown>) => void, want: RegExp) => {
    const s = JSON.parse(JSON.stringify(ok)) as Record<string, unknown>;
    f(s);
    const errs = validateCampaign(s);
    expect(errs.some(e => want.test(e)), `${want} in ${JSON.stringify(errs)}`).toBe(true);
  };
  it('rejects inconsistent records without throwing', () => {
    expect(validateCampaign(ok)).toEqual([]);
    for (const g of [null, 3, 'x', {}]) expect(validateCampaign(g).length).toBeGreaterThan(0);
    bad(s => { s.v = 2; }, /v must be 1/);
    bad(s => { (s.network as SubwayNetwork).nodes.pop(); }, /39 nodes/);
    bad(s => { s.known = ['st-99']; }, /known must list/);
    bad(s => { s.visited = [...(s.visited as string[]), 'st-05']; s.known = [...(s.known as string[])].filter(k => k !== 'st-05'); }, /visited station is not known/);
    bad(s => { s.visited = []; }, /start is not visited/);
    bad(s => { s.current = 'st-07'; }, /current station is not visited/);
    bad(s => { s.cheat = true; }, /not every station is known/);
    bad(s => { s.cheat = 'yes'; }, /cheat must be a boolean/);
    bad(s => { s.won = {at: 1}; }, /bad won/);
    bad(s => { s.transit = {from: net.start, to: net.start, phase: 'departing', cheat: false}; }, /bad transit/);
    const far = net.nodes.find(n => n.id !== net.start && !neighbors(net, net.start).includes(n.id))!.id;
    bad(s => { s.transit = {from: net.start, to: far, phase: 'departing', cheat: false}; }, /non-cheat transit/);
    bad(s => { s.transit = {from: neighbors(net, net.start)[0], to: net.start, phase: 'departing', cheat: false}; }, /leave the current station/);
    const t = JSON.parse(JSON.stringify(ok));
    t.transit = {from: net.start, to: far, phase: 'departing', cheat: true};
    expect(validateCampaign(t)).toEqual([]);
  });
});
