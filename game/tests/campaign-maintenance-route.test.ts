// Task studio-beta-campaign-polish-20261103-063841-01 (lane MAP), item 14: the Reactor ALWAYS has a bypass printed "Maintenance Route"
// (campaign/network.ts addMaintenanceRoute): an existing ordinary Subway node of the 31, beside the Reactor, joined to the Reactor's
// approach and to what lies beyond it. Over many seeds: counts / ids / seeds intact, the Reactor never an articulation point of the
// network, the bypass discoverable from the approach without entering the Reactor and reachable before it, not a dead end, no
// Reactor spoiler. Older saves (the legacy generator = the networks saves made before this change contain) get it from the
// deterministic compatibility update (campaign/discovery.ts upgradeCampaign) with every saved id / type / seed / visited / known /
// current / pending journey / world memory preserved — through the real prepareRestore path too. Node only.
// Set MR_STATS=1 to write the measured distribution to /tmp/campaign-maintenance-route-stats.json.

import fs from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  MAINTENANCE_ROUTE, addMaintenanceRoute, adjacency, generateNetwork, graphDistances, hashNodeSeed, isServiceLine, maintenanceRouteNode,
  maintenanceRouteProblems, reactorGatesNothing, validateNetwork,
} from '../src/campaign/network';
import {arrive, canTravel, neighbors, newCampaign, reactorKnown, revealAround, travelPlan, upgradeCampaign, validateCampaign} from '../src/campaign/discovery';
import type {CampaignState, StationId, SubwayNetwork} from '../src/campaign/types';
import {parseSaveText} from '../src/save/validate';
import {prepareRestore, saveFileText} from '../src/save/serialize';
import {Harness, populateStation} from './helpers/saveFixture';

const SEEDS = Array.from({length: 240}, (_, i) => (Math.imul(i + 7, 2654435761) ^ 0x2c1b3c6d) >>> 0);
const nets = SEEDS.map(s => generateNetwork(s));
const legacy = SEEDS.slice(0, 120).map(s => generateNetwork(s, {maintenanceRoute: false}));

/** Stations reachable from `from` without ever entering `avoid`. */
function reach(net: SubwayNetwork, from: StationId, avoid: readonly StationId[]): Set<StationId> {
  const adj = adjacency(net), seen = new Set<StationId>([from]), q = [from];
  for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i])!) if (!avoid.includes(n) && !seen.has(n)) { seen.add(n); q.push(n); }
  return seen;
}

/** Shortest path start -> to (inclusive), BFS by sorted neighbours. */
function pathTo(net: SubwayNetwork, to: StationId): StationId[] {
  const prev = new Map<string, string>([[net.start, '']]);
  const q = [net.start];
  for (let i = 0; i < q.length; i++) for (const nb of neighbors(net, q[i])) if (!prev.has(nb)) { prev.set(nb, q[i]); q.push(nb); }
  const out: string[] = [];
  for (let c = to; c; c = prev.get(c)!) out.unshift(c);
  return out;
}

/** A run that walked (arrive + console reveal at every stop) along `ids` from the start. */
const walk = (net: SubwayNetwork, ids: StationId[]): CampaignState => ids.reduce((s, id) => revealAround(arrive(s, id), id), revealAround(newCampaign(net), net.start));

const archetypeCounts = (net: SubwayNetwork) => net.nodes.reduce<Record<string, number>>((c, n) => ({...c, [n.archetype]: (c[n.archetype] ?? 0) + 1}), {});

describe('new networks: the Reactor always has its Maintenance Route', () => {
  it('exactly one, an ordinary Subway node; 40 nodes, 31 / 4 / 4 + ONE Reactor; ids and node seeds intact; its own service line', () => {
    for (const net of nets) {
      expect([net.seed, validateNetwork(net)]).toEqual([net.seed, []]);
      expect([net.seed, maintenanceRouteProblems(net)]).toEqual([net.seed, []]);
      expect(archetypeCounts(net)).toEqual({subway: 31, office: 4, mall: 4, reactor: 1});
      const m = maintenanceRouteNode(net)!;
      expect(m.archetype).toBe('subway');
      expect([m.id === net.start, m.id === net.reactor]).toEqual([false, false]);
      expect(m.levelSeed).toBe(hashNodeSeed(net.seed, m.id));
      expect(net.nodes.filter(n => n.name === MAINTENANCE_ROUTE.name)).toHaveLength(1);
      const service = net.lines.filter(isServiceLine);
      expect(service.length).toBeGreaterThanOrEqual(1);
      for (const l of service) { expect(l.color).toBe(MAINTENANCE_ROUTE.color); expect(l.stations).toContain(m.id); }
      expect(m.lines.every(l => isServiceLine({id: l}))).toBe(true);
    }
  });

  it('the Reactor is never an articulation point: without it the whole network stays connected (every seed)', () => {
    for (const net of nets) {
      expect(reactorGatesNothing(net)).toBe(true);
      const other = net.nodes.find(n => n.id !== net.reactor)!.id;
      expect([net.seed, reach(net, other, [net.reactor]).size]).toEqual([net.seed, net.nodes.length - 1]);
    }
  });

  it('discoverable from the approach without entering the Reactor, reachable before it, and from it the rest of the network', () => {
    let parallel = 0;
    for (const net of nets) {
      const m = maintenanceRouteNode(net)!.id;
      const d = graphDistances(net, net.start), depth = d.get(net.reactor)!;
      // the approach station the Maintenance Route hangs off: nearer the start than the Reactor
      const approach = neighbors(net, m).filter(x => d.get(x)! < depth).sort((a, b) => d.get(a)! - d.get(b)! || (a < b ? -1 : 1));
      expect([net.seed, approach.length > 0]).toEqual([net.seed, true]);
      const route = pathTo(net, approach[0]);
      expect(route).not.toContain(net.reactor);
      let s = walk(net, route.slice(1));
      expect(s.known).toContain(m); // the console's one-hop reveal at the approach shows it
      expect(canTravel(s, m)).toBe(true);
      expect(s.visited).not.toContain(net.reactor);
      s = revealAround(arrive(s, m), m);
      expect(d.get(m)!).toBeLessThanOrEqual(depth);
      // from the Maintenance Route the player continues scavenging: every station but the Reactor is reachable without entering it
      expect(reach(net, m, [net.reactor]).size).toBe(net.nodes.length - 1);
      // a genuine alternative path, not a dead end: from the Maintenance Route the track leads round to the Reactor's other side
      expect(neighbors(net, m).length).toBeGreaterThanOrEqual(2);
      expect(neighbors(net, m)).not.toContain(net.reactor);
      expect(reach(net, m, [approach[0]]).has(net.reactor)).toBe(true);
      // "approach -> Reactor -> beyond" vs "approach -> Maintenance Route -> beyond" (a neighbour of the Reactor on both sides)
      if (neighbors(net, m).some(y => y !== approach[0] && neighbors(net, net.reactor).includes(y)) && neighbors(net, net.reactor).includes(approach[0])) parallel++;
    }
    expect(parallel / nets.length).toBeGreaterThan(0.6);
  });

  it('no Reactor spoiler: the bypass never reveals the Reactor (it is not next to it); the Reactor appears only one hop away', () => {
    for (const net of nets.slice(0, 80)) {
      const m = maintenanceRouteNode(net)!.id;
      const route = pathTo(net, m);
      let s = revealAround(newCampaign(net), net.start);
      for (const id of route.slice(1)) {
        const nearReactor = neighbors(net, id).includes(net.reactor);
        s = revealAround(arrive(s, id), id);
        if (route.slice(1, route.indexOf(id) + 1).every(x => !neighbors(net, x).includes(net.reactor))) expect(reactorKnown(s)).toBe(false);
        if (nearReactor) expect(reactorKnown(s)).toBe(true);
      }
    }
  });
});

describe('older saves: the deterministic compatibility update', () => {
  it('the legacy generator is the earlier one: no Maintenance Route; terminus Reactors happen there', () => {
    expect(legacy.every(n => maintenanceRouteNode(n) === null)).toBe(true);
    expect(legacy.some(n => neighbors(n, n.reactor).length === 1)).toBe(true);
    expect(legacy.some(n => !reactorGatesNothing(n))).toBe(true); // the gate the update removes
  });

  const stats: Record<string, number> = {};
  const bump = (k: string) => { stats[k] = (stats[k] ?? 0) + 1; };

  it('a run that reached the Reactor\'s approach gets the bypass; everything the save holds is unchanged', () => {
    for (const net of legacy) {
      const d = graphDistances(net, net.start), depth = d.get(net.reactor)!;
      const approach = neighbors(net, net.reactor).filter(x => d.get(x)! < depth)[0];
      const before = walk(net, pathTo(net, approach).slice(1));
      const frozen = JSON.stringify(before);
      const u = upgradeCampaign(before, {remembered: before.visited});
      expect(JSON.stringify(before)).toBe(frozen); // pure
      bump(`${u.status}${u.tier ? `-${u.tier}` : ''}${u.info ? `-${u.info.kind}-${u.info.gateFree ? 'free' : 'gated'}` : ''}`);
      if (u.status !== 'added') continue;
      const after = u.state, m = u.node!;
      // ids / archetypes / seeds of every node; names + positions of all but the Maintenance Route
      expect(after.network.nodes.map(n => [n.id, n.archetype, n.levelSeed])).toEqual(net.nodes.map(n => [n.id, n.archetype, n.levelSeed]));
      expect(after.network.nodes.filter(n => n.id !== m).map(n => [n.name, n.x, n.y])).toEqual(net.nodes.filter(n => n.id !== m).map(n => [n.name, n.x, n.y]));
      expect([after.network.seed, after.network.start, after.network.reactor]).toEqual([net.seed, net.start, net.reactor]);
      // the run record itself
      for (const k of ['current', 'known', 'visited', 'cheat', 'won', 'transit'] as const) expect(after[k]).toEqual(before[k]);
      expect(before.known).not.toContain(m); // the player had never seen it
      expect(u.tier).toBe('unseen');
      expect(validateCampaign(after)).toEqual([]);
      expect(validateNetwork(after.network)).toEqual([]);
      expect(graphDistances(after.network, net.start).get(net.reactor)).toBe(depth);
      const probs = maintenanceRouteProblems(after.network, {gateFree: false});
      expect([net.seed, probs.filter(p => u.info!.kind !== 'shortcut' || !/lead round|does not lead/.test(p))]).toEqual([net.seed, []]);
      // deterministic (re-checked on a quarter of the sample: the search is the slow part) and idempotent
      if (legacy.indexOf(net) % 4 === 0) expect(JSON.stringify(upgradeCampaign(before, {remembered: before.visited}).state)).toBe(JSON.stringify(after));
      const again = upgradeCampaign(after, {remembered: after.visited});
      expect([again.status, again.state === after]).toEqual(['present', true]);
      // still discoverable from the approach side: next to a station nearer the start than the Reactor
      expect(neighbors(after.network, m).some(x => graphDistances(after.network, net.start).get(x)! < depth)).toBe(true);
    }
    const added = Object.entries(stats).filter(([k]) => k.startsWith('added')).reduce((t, [, v]) => t + v, 0);
    const free = Object.entries(stats).filter(([k]) => k.endsWith('-free')).reduce((t, [, v]) => t + v, 0);
    expect(added / legacy.length).toBeGreaterThanOrEqual(0.99);
    expect(free / legacy.length).toBeGreaterThanOrEqual(0.97); // the Reactor gates nothing any more
    if (process.env.MR_STATS) fs.writeFileSync('/tmp/campaign-maintenance-route-stats.json', JSON.stringify({saves: legacy.length, ...stats}, null, 1));
  });

  it('a pending journey, the cheat and the win survive; nothing the player has seen ever moves', () => {
    for (const net of legacy.slice(0, 40)) {
      const s0 = walk(net, pathTo(net, neighbors(net, net.start)[0]).slice(1));
      const to = neighbors(net, s0.current).find(x => x !== net.start) ?? net.start;
      const mid: CampaignState = {...s0, transit: {from: s0.current, to, phase: 'departing', cheat: false}, won: {at: '2026-11-03T00:00:00.000Z', station: s0.current, via: 'surface'}};
      const u = upgradeCampaign(mid, {remembered: mid.visited});
      expect(u.state.transit).toEqual(mid.transit);
      expect(u.state.won).toEqual(mid.won);
      expect(validateCampaign(u.state)).toEqual([]);
      if (u.node) expect([...mid.known, to].includes(u.node)).toBe(false);
      // the cheat shows every station: only an unseen one could move, so the update is skipped (reported), never a seen station moved
      const cheat = upgradeCampaign({...mid, cheat: true, known: net.nodes.map(n => n.id)});
      expect(cheat.status).toBe('unchanged');
      expect(cheat.reason).toBeTruthy();
    }
  });

  it('a save that has seen everything near the Reactor: a shown-but-never-visited station moves and is hidden again — or it stays unchanged', () => {
    let unvisited = 0, unchanged = 0;
    for (const net of legacy.slice(0, 60)) {
      const d = graphDistances(net, net.start), depth = d.get(net.reactor)!;
      const visited = net.nodes.map(n => n.id).filter(id => id !== net.reactor && d.get(id)! <= depth - 1);
      const s: CampaignState = {...newCampaign(net), current: net.start, visited, known: net.nodes.map(n => n.id).filter(id => id !== net.reactor)};
      expect(validateCampaign(s)).toEqual([]);
      const u = upgradeCampaign(s, {remembered: visited});
      if (u.status === 'unchanged') { unchanged++; expect(u.state).toBe(s); continue; }
      expect(u.tier).toBe('unvisited');
      unvisited++;
      expect(visited).not.toContain(u.node);
      expect(u.state.known).not.toContain(u.node);
      expect(u.state.known).toEqual(s.known.filter(k => k !== u.node));
      expect(u.state.visited).toEqual(s.visited);
      expect(validateCampaign(u.state)).toEqual([]);
    }
    expect(unvisited).toBeGreaterThan(unchanged);
  });

  it('through the real load path: prepareRestore applies the update; every world memory and the Retry snapshot keep their ids; the next save validates', () => {
    const net = legacy[3];
    const d = graphDistances(net, net.start), depth = d.get(net.reactor)!;
    const approach = neighbors(net, net.reactor).filter(x => d.get(x)! < depth)[0];
    const s = walk(net, pathTo(net, approach).slice(1));
    const h = new Harness(s);
    s.visited.forEach((id, i) => populateStation(h, {level: net.nodes.find(n => n.id === id)!.archetype, section: 'main', station: id}, {seed: 30 + i, holders: 12, zombies: 6, bags: 0}));
    h.takeEntry();
    const v = parseSaveText(saveFileText(h.file('arrival')), {validateNetwork: n => validateNetwork(n).join('; ') || null});
    if (!v.ok) throw new Error(v.error);
    const plain = prepareRestore(v.value.run, h.makeRun);
    expect(maintenanceRouteNode(plain.run.campaign!.network)).toBeNull(); // without the hook: exactly as saved
    const p = prepareRestore(v.value.run, h.makeRun, (c, remembered) => {
      expect(remembered).toEqual([...s.visited].sort());
      return upgradeCampaign(c, {remembered}).state;
    });
    const c = p.run.campaign!;
    const m = maintenanceRouteNode(c.network)!;
    expect(m).not.toBeNull();
    expect(s.known).not.toContain(m.id);
    expect(Object.keys(p.run.exportMemories()).sort()).toEqual(Object.keys(v.value.run.memories).sort());
    expect(p.run.entry?.station).toBe(s.current);
    expect([c.current, c.visited, c.known]).toEqual([s.current, s.visited, s.known]);
    // the next autosave stores the updated graph, and it validates (graph validator injected, as Game does)
    const h2 = new Harness(c);
    const again = parseSaveText(saveFileText(h2.file('arrival')), {validateNetwork: n => validateNetwork(n).join('; ') || null});
    expect(again.ok).toBe(true);
    expect(travelPlan(c, s.visited[0])?.route[0]).toBe(s.current);
  });

  it('addMaintenanceRoute never mutates its input and refuses a network that already has one', () => {
    const net = legacy[0], before = JSON.stringify(net);
    const got = addMaintenanceRoute(net)!;
    expect(JSON.stringify(net)).toBe(before);
    const trace: string[] = [];
    expect(addMaintenanceRoute(got.network, {trace})).toBeNull();
    expect(trace).toEqual(['it already has one']);
  });
});
