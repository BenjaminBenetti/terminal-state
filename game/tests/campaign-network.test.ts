// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): the campaign network generator (campaign/network.ts) over a
// sample of hundreds of seeds — counts 31 / 4 / 4 / 1, the start, the ONE Reactor at depth >= 4, connectivity, >= 3 lines, >= 2
// interchanges, branches, loops on a meaningful share, a planar octilinear transit-diagram drawing (no crossings, no track through a
// station dot, stations spaced), determinism, node seeds — and validateNetwork rejecting broken networks. Node only.
// Set NET_STATS=1 to write the measured distribution to /tmp/campaign-network-stats.json.

import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {GRID, MIN_REACTOR_DEPTH, fallbackNetwork, generateNetwork, generateNetworkInfo, graphDistances, hashNodeSeed, ordinaryCounts, validateNetwork} from '../src/campaign/network';
import {NETWORK_SIZE, ORDINARY_WEIGHTS, type SubwayNetwork} from '../src/campaign/types';
import {hashString} from '../src/core/rng';

const SEEDS = Array.from({length: 360}, (_, i) => (Math.imul(i + 1, 2654435761) ^ 0x5bd1e995) >>> 0);
const nets = SEEDS.map(s => generateNetworkInfo(s));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type P = [number, number];
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const properCross = (a: P, b: P, c: P, d: P) => Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 && Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0;
function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function stats(net: SubwayNetwork) {
  const ink = new Map(net.lines.map(l => [l.id, l.color]));
  const deg = new Map(net.nodes.map(n => [n.id, 0]));
  for (const [a, b] of net.edges) { deg.set(a, deg.get(a)! + 1); deg.set(b, deg.get(b)! + 1); }
  const interchanges = net.nodes.filter(n => new Set(n.lines.map(l => ink.get(l))).size > 1).length;
  const branches = net.lines.filter(l => / branch\)$/.test(l.name)).length;
  const lines = new Set(net.lines.map(l => l.color)).size;
  const cycles = net.edges.length - net.nodes.length + 1;
  const depth = graphDistances(net, net.start).get(net.reactor)!;
  return {interchanges, branches, lines, cycles, ring: net.lines.some(l => l.loop), depth, reactorTerminus: deg.get(net.reactor) === 1, deg};
}

describe('the network over the seed sample', () => {
  it('every network validates, used no fallback, and has the exact archetype counts 31 / 4 / 4 / 1', () => {
    expect(ordinaryCounts()).toEqual({subway: 31, office: 4, mall: 4});
    for (const {network: net, fallback} of nets) {
      expect([net.seed, validateNetwork(net)]).toEqual([net.seed, []]);
      expect(fallback).toBe(false);
      const c: Record<string, number> = {};
      for (const n of net.nodes) c[n.archetype] = (c[n.archetype] ?? 0) + 1;
      expect(c).toEqual({subway: 31, office: 4, mall: 4, reactor: 1});
      expect(net.nodes.length).toBe(NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor);
    }
  });

  it('the start is st-00, a Subway non-interchange; the ONE Reactor is reachable at depth >= 4 and varies per seed', () => {
    const depths = new Map<number, number>(), reactorIds = new Set<string>(), reactorSpots = new Set<string>();
    let terminus = 0;
    for (const {network: net} of nets) {
      const start = net.nodes.find(n => n.id === net.start)!;
      expect([net.start, start.archetype]).toEqual(['st-00', 'subway']);
      expect(new Set(start.lines.map(l => net.lines.find(x => x.id === l)!.color)).size).toBe(1);
      expect(net.nodes.filter(n => n.archetype === 'reactor').map(n => n.id)).toEqual([net.reactor]);
      const s = stats(net);
      expect(s.depth).toBeGreaterThanOrEqual(MIN_REACTOR_DEPTH);
      depths.set(s.depth, (depths.get(s.depth) ?? 0) + 1);
      if (s.reactorTerminus) terminus++;
      reactorIds.add(net.reactor);
      const r = net.nodes.find(n => n.id === net.reactor)!;
      reactorSpots.add(`${r.x},${r.y}`);
    }
    expect(depths.size).toBeGreaterThanOrEqual(3); // not one fixed depth
    expect(Math.min(...depths.keys())).toBeGreaterThanOrEqual(MIN_REACTOR_DEPTH);
    expect(terminus / nets.length).toBeLessThan(0.4); // not always the end of a line
    expect(terminus).toBeGreaterThan(0); // ... but sometimes
    expect(reactorIds.size).toBeGreaterThan(10);
    expect(reactorSpots.size).toBeGreaterThan(nets.length * 0.5);
  });

  it('is connected with >= 3 lines, >= 2 interchanges, a branch on every seed and loops on a meaningful share', () => {
    let withCycle = 0, withRing = 0;
    const dist = {interchanges: new Map<number, number>(), branches: new Map<number, number>(), cycles: new Map<number, number>(), depth: new Map<number, number>()};
    const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const {network: net} of nets) {
      expect(graphDistances(net, net.start).size).toBe(net.nodes.length);
      const s = stats(net);
      expect(s.lines).toBeGreaterThanOrEqual(3);
      expect(s.interchanges).toBeGreaterThanOrEqual(2);
      expect(s.branches).toBeGreaterThanOrEqual(1);
      // a branch leaves an inner station of its parent line (a junction of degree >= 3)
      for (const l of net.lines.filter(x => / branch\)$/.test(x.name))) expect(s.deg.get(l.stations[0])!).toBeGreaterThanOrEqual(3);
      if (s.cycles > 0) withCycle++;
      if (s.ring) withRing++;
      bump(dist.interchanges, s.interchanges); bump(dist.branches, s.branches); bump(dist.cycles, s.cycles); bump(dist.depth, s.depth);
    }
    expect(withCycle / nets.length).toBeGreaterThan(0.8);
    expect(withRing / nets.length).toBeGreaterThan(0.2);
    if (process.env.NET_STATS) {
      const obj = (m: Map<number, number>) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]));
      fs.writeFileSync('/tmp/campaign-network-stats.json', JSON.stringify({seeds: nets.length, withCycle, withRing, attempts: obj(nets.reduce((m, n) => m.set(n.attempt, (m.get(n.attempt) ?? 0) + 1), new Map<number, number>())),
        interchanges: obj(dist.interchanges), branches: obj(dist.branches), cycles: obj(dist.cycles), reactorDepth: obj(dist.depth)}, null, 1));
    }
  });

  it('draws like a transit diagram: octilinear edges, spaced stations, no crossing track, no track through a station dot', () => {
    const u = GRID.unit;
    for (const {network: net} of nets) {
      const pos = new Map(net.nodes.map(n => [n.id, [n.x, n.y] as P]));
      for (const n of net.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(GRID.w * u);
        expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y).toBeLessThanOrEqual(GRID.h * u);
      }
      for (let i = 0; i < net.nodes.length; i++) for (let j = i + 1; j < net.nodes.length; j++) {
        const a = net.nodes[i], b = net.nodes[j];
        expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(2 * u - 1e-9);
      }
      for (const [a, b] of net.edges) {
        const [dx, dy] = [Math.abs(pos.get(a)![0] - pos.get(b)![0]), Math.abs(pos.get(a)![1] - pos.get(b)![1])];
        expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-9).toBe(true);
        for (const n of net.nodes) if (n.id !== a && n.id !== b) expect(pointSegDist([n.x, n.y], pos.get(a)!, pos.get(b)!)).toBeGreaterThan(u);
      }
      for (let i = 0; i < net.edges.length; i++) for (let j = i + 1; j < net.edges.length; j++) {
        const [a, b] = net.edges[i], [c, d] = net.edges[j];
        if (a === c || a === d || b === c || b === d) continue;
        expect(properCross(pos.get(a)!, pos.get(b)!, pos.get(c)!, pos.get(d)!)).toBe(false);
      }
    }
  });

  it('names are unique printed names; line inks are colours; node seeds are the dedicated hash, unique per network', () => {
    const allNames = new Set<string>();
    for (const {network: net} of nets) {
      expect(new Set(net.nodes.map(n => n.name)).size).toBe(net.nodes.length);
      for (const n of net.nodes) { expect(n.name).toMatch(/^[A-Z][A-Za-z]+( [A-Z][A-Za-z]+)?$/); allNames.add(n.name); }
      for (const l of net.lines) expect(l.color).toMatch(/^#[0-9a-f]{6}$/);
      // a branch prints in its parent's ink; the lines with their own ink have distinct inks
      const own = net.lines.filter(l => !/ branch\)$/.test(l.name));
      expect(new Set(own.map(l => l.color)).size).toBe(own.length);
      expect(new Set(net.nodes.map(n => n.levelSeed)).size).toBe(net.nodes.length);
      for (const n of net.nodes) expect(n.levelSeed).toBe(hashNodeSeed(net.seed, n.id));
    }
    expect(allNames.size).toBeGreaterThan(200); // the pool and the suffixes vary
    // same id, different networks -> different worlds
    expect(new Set(nets.map(n => n.network.nodes[0].levelSeed)).size).toBe(nets.length);
  });

  it('generation is fast enough for a new game', () => {
    const t0 = performance.now();
    for (const s of SEEDS.slice(0, 120)) generateNetwork(s);
    expect((performance.now() - t0) / 120).toBeLessThan(60);
  });
});

describe('determinism', () => {
  it('a seed always yields the identical network (positions / edges / ids / names / archetypes / node seeds)', () => {
    for (const s of SEEDS.slice(0, 40)) expect(JSON.stringify(generateNetwork(s))).toBe(JSON.stringify(nets[SEEDS.indexOf(s)].network));
    expect(JSON.stringify(generateNetwork(SEEDS[0]))).not.toBe(JSON.stringify(generateNetwork(SEEDS[1])));
    expect(generateNetwork(-1).seed).toBe(0xffffffff); // seeds are uint32
  });

  it('is pinned for one seed (re-pin only for an intended generator change — saves keep their own copy of the network)', () => {
    const net = generateNetwork(20261102);
    expect({nodes: net.nodes.length, edges: net.edges.length, lines: net.lines.length, start: net.start, reactor: net.reactor,
      fingerprint: hashString(JSON.stringify(net)).toString(16)}).toEqual({nodes: 40, edges: 45, lines: 6, start: 'st-00', reactor: 'st-24', fingerprint: 'b5433f'});
  });

  it('the edge list is sorted and unique, each pair sorted', () => {
    for (const {network: net} of nets.slice(0, 50)) {
      const keys = net.edges.map(([a, b]) => { expect(a < b).toBe(true); return `${a}|${b}`; });
      expect(keys).toEqual([...new Set(keys)].sort());
    }
  });

  it('custom ordinary weights (a future archetype takes a share) keep the largest-remainder counts', () => {
    const w = {subway: 0.6, office: 0.2, mall: 0.2};
    expect(ordinaryCounts(w)).toEqual({subway: 23, office: 8, mall: 8});
    const net = generateNetwork(77, {weights: w});
    expect(validateNetwork(net, {weights: w})).toEqual([]);
    expect(validateNetwork(net).some(e => e.includes('subway nodes'))).toBe(true);
    expect(() => generateNetwork(77, {weights: {office: 1}})).toThrow(/Subway/);
    expect(ordinaryCounts(ORDINARY_WEIGHTS, 10)).toEqual({subway: 8, office: 1, mall: 1});
  });

  it('the last-resort layout is a valid network too', () => {
    for (const s of [1, 2, 3]) expect(validateNetwork(fallbackNetwork(s))).toEqual([]);
  });
});

describe('validateNetwork rejects broken networks', () => {
  const good = nets[0].network;
  const bad = (f: (n: SubwayNetwork) => void, want: RegExp) => {
    const n = clone(good);
    f(n);
    const errs = validateNetwork(n);
    expect(errs.some(e => want.test(e)), `${want} in ${JSON.stringify(errs)}`).toBe(true);
  };
  const other = (n: SubwayNetwork, k = 1) => n.nodes.filter(x => x.id !== n.start && x.id !== n.reactor)[k];

  it('accepts the generated one; rejects garbage without throwing', () => {
    expect(validateNetwork(good)).toEqual([]);
    for (const g of [null, 1, 'x', [], {}, {v: 1, seed: 1, nodes: 'no', edges: [], lines: []}, {v: 1, seed: 1, nodes: new Array(500).fill(0), edges: [], lines: []}]) {
      expect(validateNetwork(g).length).toBeGreaterThan(0);
    }
  });

  it('counts, ids, names, archetypes, node seeds', () => {
    bad(n => { n.nodes[3].name = n.nodes[4].name; }, /duplicate name/);
    bad(n => { n.nodes[3].id = n.nodes[4].id; }, /duplicate id/);
    bad(n => { other(n).archetype = 'reactor'; }, /2 Reactor nodes/);
    bad(n => { n.nodes.find(x => x.id === n.reactor)!.archetype = 'subway'; }, /0 Reactor nodes/);
    bad(n => { other(n).archetype = 'office'; }, /office nodes, expected 4/);
    bad(n => { n.nodes.find(x => x.id === n.start)!.archetype = 'mall'; }, /start must be a Subway/);
    bad(n => { n.nodes[5].levelSeed ^= 1; }, /levelSeed/);
    bad(n => { n.nodes.pop(); }, /39 nodes/);
    bad(n => { (n.nodes[2] as {archetype: string}).archetype = 'castle'; }, /bad archetype/);
    bad(n => { n.nodes[2].x = Number.NaN; }, /bad x/);
    bad(n => { n.start = 'st-99'; }, /start is not a node/);
    bad(n => { n.reactor = n.start; }, /reactor node archetype/);
  });

  it('edges: self, duplicate, unsorted, unknown, off every line; lines must match edges and node.lines', () => {
    bad(n => { n.edges.push([n.edges[0][0], n.edges[0][0]]); }, /self edge/);
    bad(n => { n.edges.push([...n.edges[0]] as [string, string]); }, /duplicate/);
    bad(n => { n.edges[0] = [n.edges[0][1], n.edges[0][0]]; }, /not sorted/);
    bad(n => { n.edges.push(['st-00', 'st-77']); }, /unknown station/);
    bad(n => {
      const ids = new Set(n.edges.map(([a, b]) => `${a}|${b}`));
      const pair = n.nodes.flatMap(a => n.nodes.map(b => [a.id, b.id] as [string, string])).find(([a, b]) => a < b && !ids.has(`${a}|${b}`))!;
      n.edges.push(pair);
      n.edges.sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : 1));
    }, /on no line/);
    bad(n => {
      const s0 = n.lines[0].stations[0];
      const adj = new Set(n.edges.flatMap(([a, b]) => (a === s0 ? [b] : b === s0 ? [a] : [])));
      n.lines[0].stations[1] = n.nodes.find(x => x.id !== s0 && !adj.has(x.id) && !n.lines[0].stations.includes(x.id))!.id;
    }, /is not an edge/);
    bad(n => { n.nodes[1].lines = ['ln-99']; }, /lines do not match/);
    bad(n => { n.lines[1].color = 'red'; }, /bad colour/);
    bad(n => { n.lines[1].id = n.lines[0].id; }, /duplicate id/);
  });

  it('connectivity and the Reactor depth', () => {
    // cut every edge of one station (and drop it from its lines): unreachable
    bad(n => {
      const victim = other(n, 3).id;
      n.edges = n.edges.filter(([a, b]) => a !== victim && b !== victim);
    }, /unreachable|not an edge/);
    // the Reactor next to the start
    bad(n => {
      const nb = n.edges.find(([a, b]) => a === n.start || b === n.start)!;
      const near = nb[0] === n.start ? nb[1] : nb[0];
      const r = n.nodes.find(x => x.id === n.reactor)!, s = n.nodes.find(x => x.id === near)!;
      [r.archetype, s.archetype] = [s.archetype, r.archetype];
      n.reactor = near;
    }, /Reactor only 1 hops/);
  });
});
