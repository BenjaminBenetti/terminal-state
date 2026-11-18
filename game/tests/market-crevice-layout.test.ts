// Task studio-survivor-market-crevice-20261116-074419: THE SURVIVOR MARKET's layout version 5 — THE CREVICE (gen/market/v5/) over a seed
// sample, both mirror states:
//  - the version policy: 5 is the current version (new / unvisited markets); a recorded 1-4 stays what it was — a recorded 4 regenerates
//    byte for byte the shipped version 4 (fingerprints of origin/main 9d7a1c52's generator, run side by side from a worktree of it:
//    identical), and the dispatch draws nothing for the earlier versions;
//  - every layout validates (gen/market/v5/validate.ts creviceIssues) within the generation budget; deterministic;
//  - the brief's shape: a crevice with a settlement on BOTH sides over four storeys, MOST homes and shops converted shipping containers
//    (every home, every shop but the bar a container's room), bridges between the sides on the terraces, the stalls / bar / den kept;
//  - services by the train: the platform -> the gates -> the square, the heavy shops and the den on the crevice floor, a flat way
//    1.5 m wide (a carried body / cargo never needs a stair or a ladder) to each of their customer spots and to the den's chute;
//  - the residents: every spot and every trader post reachable from each other on the residents' graph (no ladders) within their path
//    search budget (market/marketPeople.ts MARKET_PEOPLE.maxExpand) — nobody is trapped.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {CELL, PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {LEVELS} from '../src/levels/registry';
import {CREVICE_GEN_STATS, MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, creviceIssues, generateMarketLevel, marketLayoutIssues, marketLayoutVersionFor} from '../src/gen/market/index';
import {MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {MARKET_PEOPLE} from '../src/market/marketPeople';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 42, 777, 4242, 9001, 31337, 20261116];
const runs = SEEDS.map(seed => {
  const L = generateMarketLevel({levelSeed: seed, layoutVersion: 5});
  return {seed, L, ms: CREVICE_GEN_STATS.ms, attempts: CREVICE_GEN_STATS.attempts};
});

/** Version 4 fingerprints of origin/main 9d7a1c52's generator (computed in a worktree of it and on this branch: identical). Re-pinned by
 *  task studio-market-readable-shop-signs-20261118-022405-01: only the bar's name board rose above its pendants (the rest of a recorded market is still
 *  origin/main 1e08fa41's, market-sign-readability.test.ts). */
const V4_SHIPPED: Record<number, string> = {
  1: 'bda7edd87c1966b8', 2: '4baf62957324ee8a', 3: 'e19113c8686fcce8', 6: 'e4a0f7668f003ce6', 42: '39f5eb6429ceb834',
  777: '818e6c1270e8093f', 4242: '6d9da1d6e61067f9', 9001: '70b8c65879e413c1', 31337: '0c5dccbae77854fa',
};
function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).update(Buffer.from(L.grid.blocked)).update(Buffer.from(L.grid.sightBlocked)).digest('hex'));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props: l.props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Cells (storey 0) a body / cargo carrier reaches from the start: walkable, off the stairs, a 0.5 m clear disc, no floor step. */
function carryField(L: StationLayout): Uint8Array {
  const g = L.grid, W = g.w, n = g.cells.length, seen = new Uint8Array(n);
  const ok = (i: number) => { const x = i % W, y = (i / W) | 0, [cx, cz] = g.center(x, y); return g.walkable(x, y) && g.rampIdx[i] < 0 && g.circleClear(cx, cz, 0.5); };
  const [sx, sy] = g.cellOf(L.playerSpawn.x, L.playerSpawn.z), s = g.idx(sx, sy);
  if (!ok(s)) return seen;
  const q = [s];
  seen[s] = 1;
  while (q.length) {
    const c = q.pop()!, x = c % W;
    for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (j < 0 || j >= n || seen[j] || !ok(j) || Math.abs(g.floorOf(j) - g.floorOf(c)) > 0.2) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
const carryNear = (L: StationLayout, f: Uint8Array, x: number, z: number, r = 1.2) => {
  const g = L.grid;
  for (let i = 0; i < f.length; i++) if (f[i]) { const [cx, cz] = g.center(i % g.w, (i / g.w) | 0); if (Math.hypot(cx - x, cz - z) <= r) return true; }
  return false;
};

describe('Survivor Market layout version 5 (the crevice)', () => {
  // (re-pinned by task studio-market-irregular-envelope-20261116-210503-01: new / unvisited markets build version 6 now — this crevice in
  // its irregular envelope, market-crevice-envelope.test.ts, which pins version 5's fingerprints; a recorded 5 is kept)
  // (re-pinned by task studio-market-irregular-settlement-20261117-003819-01: version 7 now — on its irregular settlement floorplan,
  // market-crevice-settlement.test.ts; market-crevice-envelope.test.ts pins version 6's fingerprints; a recorded 6 is kept)
  it('the version policy: 7 for new / unvisited markets, a recorded 1-6 kept; a recorded 4 regenerates the shipped version 4 exactly', () => {
    expect(MARKET_LAYOUT_VERSION).toBe(7);
    expect(marketLayoutVersionFor(undefined)).toBe(7);
    expect(marketLayoutVersionFor({visits: 0, lanes: {}})).toBe(7);
    expect(marketLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    for (const v of [1, 2, 3, 4, 5, 6, 7]) expect(marketLayoutVersionFor({visits: 4, lanes: {[MARKET_LAYOUT_LANE]: {v}}})).toBe(v);
    for (const [s, want] of Object.entries(V4_SHIPPED)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 4})), `seed ${s}`).toBe(want);
    }
    expect(fingerprint(LEVELS.market.generate('main', {levelSeed: 42, layoutVersion: 4}))).toBe(V4_SHIPPED[42]);
    // the default (no recorded version) builds the crevice (version 7: on its irregular settlement floorplan)
    expect(LEVELS.market.generate('main', {levelSeed: 42}).market?.v).toBe(7);
  });

  it('every seed validates within the budget; deterministic; the same name and stall ids as version 4', () => {
    for (const {seed, L, ms, attempts} of runs) {
      expect(creviceIssues(L), `seed ${seed}`).toEqual([]);
      expect(marketLayoutIssues(L), `seed ${seed}`).toEqual([]);
      expect(ms, `seed ${seed} gen ms`).toBeLessThan(400);
      expect(attempts, `seed ${seed} attempts`).toBeLessThanOrEqual(4);
      expect(L.market!.v).toBe(5);
      expect(L.market!.stalls.map(s => s.id)).toEqual([...MARKET_STALLS_ALL]);
      expect(L.market!.den).toBeTruthy();
    }
    for (const {seed, L} of runs.slice(0, 3)) {
      expect(fingerprint(generateMarketLevel({levelSeed: seed, layoutVersion: 5}))).toBe(fingerprint(L));
      expect(L.name).toBe(generateMarketLevel({levelSeed: seed, layoutVersion: 4}).name);
    }
    expect(new Set(runs.map(r => r.L.levels.length))).toEqual(new Set([4]));
    // both mirror states in the sample
    const mirrored = runs.map(r => { const den = r.L.market!.den!; return den.door.x < r.L.grid.w * CELL / 2; });
    expect(new Set(mirrored).size).toBe(2);
  });

  it('a crevice settlement of converted containers on both sides, four storeys, bridged', () => {
    for (const {seed, L} of runs) {
      const cr = L.market!.crevice!, A = L.areas;
      const rooms = new Set(cr.containers.filter(c => c.area >= 0).map(c => c.area));
      // every home and every shop (but the bar on its deck) is a container's room
      const homes = A.filter(a => a.kind === 'room' && a.label === 'Home');
      expect(homes.length, `seed ${seed} homes`).toBeGreaterThanOrEqual(8);
      for (const h of homes) expect(rooms.has(h.id), `seed ${seed} home ${h.id}`).toBe(true);
      for (const s of L.market!.stalls) if (s.id !== 'bar') expect(rooms.has(s.area), `seed ${seed} stall ${s.id}`).toBe(true);
      // containers on both sides of the chasm on every storey
      const mid = (cr.chasm.x0 + cr.chasm.x1) / 2;
      for (let lv = 0; lv < 4; lv++) for (const west of [true, false]) {
        expect(cr.containers.some(c => c.level === lv && ((c.x0 + c.x1) / 2 < mid) === west), `seed ${seed} storey ${lv} ${west ? 'west' : 'east'}`).toBe(true);
      }
      expect(cr.containers.length, `seed ${seed} containers`).toBeGreaterThanOrEqual(36);
      // bridges between the sides on the terraces
      expect(cr.bridges.length, `seed ${seed} bridges`).toBeGreaterThanOrEqual(4);
      expect(new Set(cr.bridges.map(b => b.level)), `seed ${seed} bridge storeys`).toEqual(new Set([1, 2, 3]));
      for (const b of cr.bridges) expect(b.x0 < mid && b.x1 > mid).toBe(true);
      // the communal places: the kitchen, the workshop, the den, the square, the weir; the bar's deck (its area named for the bar)
      for (const label of ['Communal kitchen', 'Workshop', 'Corpse buyer', 'Arrival Square', 'The Weir']) expect(A.some(a => a.label === label), `seed ${seed} ${label}`).toBe(true);
      const bar = L.market!.stalls.find(s => s.id === 'bar')!;
      expect([A[bar.area].level, A[bar.area].label], `seed ${seed} bar`).toEqual([1, bar.name]);
    }
  });

  it('the heavy shops and the den by the train: a flat 1.5 m way from the platform (bodies / cargo: no stair, no ladder)', () => {
    for (const {seed, L} of runs) {
      const f = carryField(L), m = L.market!;
      for (const s of m.stalls.filter(q => q.front.level === 0)) expect(carryNear(L, f, s.front.x, s.front.z), `seed ${seed} ${s.id}`).toBe(true);
      expect(m.stalls.filter(q => q.front.level === 0).map(q => q.id).sort(), `seed ${seed}`).toEqual(['fuel', 'general', 'gun', 'scrap']);
      const den = m.den!;
      expect(carryNear(L, f, den.front.x, den.front.z), `seed ${seed} den front`).toBe(true);
      const ch = L.props[den.chute.prop];
      expect(carryNear(L, f, ch.x, ch.z, 1.2 + Math.max(ch.hx, ch.hz)), `seed ${seed} den chute`).toBe(true);
      // the den's door within 25 m of the start (the square by the gates)
      expect(Math.hypot(den.door.x - L.playerSpawn.x, den.door.z - L.playerSpawn.z), `seed ${seed}`).toBeLessThan(25);
    }
  });

  it('the residents: every spot and trader post on one ladder-free graph, within the path budget', () => {
    for (const {seed, L} of runs.slice(0, 6)) {
      const pf = new PathFinder(levelsOf(L)), m = L.market!;
      const posts = [...m.spots.map(s => ({x: s.x, z: s.z, y: s.y, what: `spot ${s.kind}@${s.level}`})), ...m.stalls.map(s => ({...s.trader, what: `trader ${s.id}`}))];
      // a hub (the square's first spot / the general trader) to every post and back, and a few long cross-crevice pairs
      const hub = m.stalls.find(s => s.id === 'general')!.trader;
      for (const p of posts) {
        const there = pf.find(hub.x, hub.z, p.x, p.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: hub.y, by: p.y, noLinks: true});
        expect(there, `seed ${seed}: hub -> ${p.what}`).not.toBeNull();
        const back = pf.find(p.x, p.z, hub.x, hub.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: p.y, by: hub.y, noLinks: true});
        expect(back, `seed ${seed}: ${p.what} -> hub`).not.toBeNull();
      }
      const top = m.spots.filter(s => s.level === 3), low = m.spots.filter(s => s.level === 0);
      for (const a of top.slice(0, 3)) for (const b of low.slice(-3)) {
        expect(pf.find(a.x, a.z, b.x, b.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: a.y, by: b.y, noLinks: true}), `seed ${seed}: top -> floor`).not.toBeNull();
      }
    }
  });
});
