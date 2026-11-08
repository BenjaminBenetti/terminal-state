// Task studio-market-bar-20261108-225231-01 (lane BAR): the Survivor Market's layout version 3 (version 2's settlement + the upper-level
// bar) must leave the shipped versions alone — a VISITED version-2 market regenerates from its seed, so version 2's output stays
// byte-identical. The version-2 fingerprints below were computed on the seam commit (975f1d6e, main c1ded2f5's generator) with the same
// fingerprint() as market-layout-version.test.ts (every storey grid — cells, areas, floors, ceilings — areas, doors, props, lights, signs,
// the market record, rails, links, stairs, ladders, the spawn, the name).
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {MARKET_EMPTY_KEY, MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, generateMarketLevel, marketLayoutIssues, marketLayoutVersionFor} from '../src/gen/market/index';
import {BAR_STALL, MARKET_STALLS} from '../src/gen/market/marketTypes';
import {MARKET_WORKSHOP_KEY} from '../src/items/lootTables';
import {createRun} from '../src/run/runState';
import type {StationLayout} from '../src/gen/stationTypes';

/** Version 1 (the first market) as shipped: market-layout-version.test.ts's pins (the shipped generator of PR #69). */
const V1: Record<number, string> = {
  1: '1033eb4e1052a7f2', 2: '6c16754332a7c225', 3: '689b90a315f4c7dc', 42: '03cd55fc302a3790',
  777: '76df150bb5f23746', 4242: '31e66a66cf69b127', 9001: 'c68876ba2a851b49', 31337: '3620c490527cf7df',
};
/** Version 2 (the container settlement) as shipped: seam commit 975f1d6e. */
const V2: Record<number, string> = {
  1: 'd9514aa4e19e5485', 2: '633e9e439c17e837', 3: '2c91aace5755f1eb', 42: '757dd879703f60b6',
  777: '7a5de463c16abc73', 4242: 'e92b1beaeeafa04e', 9001: '014cf0c10b266b7d', 31337: '6055917d3c091fd3',
};

function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).digest('hex'));
  const props = l.props.map(p => (p.purpose === MARKET_WORKSHOP_KEY ? {...p, purpose: MARKET_EMPTY_KEY} : p));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

describe('Market bar: the layout version policy (version 3 = the settlement with the bar)', () => {
  it('never entered -> 3 (recorded on first build); a recorded version is kept (a version-2 market stays 2: no bar); visited, no record -> 1', () => {
    expect(MARKET_LAYOUT_VERSION).toBe(3);
    expect(marketLayoutVersionFor(undefined)).toBe(3);
    expect(marketLayoutVersionFor({visits: 0, lanes: {}})).toBe(3);
    expect(marketLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    for (const v of [1, 2, 3]) {
      expect(marketLayoutVersionFor({visits: 4, lanes: {[MARKET_LAYOUT_LANE]: {v}}})).toBe(v);
      expect(marketLayoutVersionFor({visits: 0, lanes: {[MARKET_LAYOUT_LANE]: {v}}})).toBe(v);
    }
    expect(marketLayoutVersionFor({visits: 1, lanes: {[MARKET_LAYOUT_LANE]: {v: 4}}})).toBe(1); // (a malformed record: the visit rule)
    expect(marketLayoutVersionFor({visits: 0, lanes: {[MARKET_LAYOUT_LANE]: {v: 2.5}}})).toBe(3);
  });

  it('version 2 places the six stalls and no bar; version 3 (the default) the six + the bar; each valid', () => {
    for (const s of [1, 42]) {
      const v2 = generateMarketLevel({levelSeed: s, layoutVersion: 2}), v3 = generateMarketLevel({levelSeed: s});
      expect([v2.market!.v, v3.market!.v]).toEqual([2, 3]);
      expect(v2.market!.stalls.map(q => q.id)).toEqual([...MARKET_STALLS]);
      expect(v3.market!.stalls.map(q => q.id)).toEqual([...MARKET_STALLS, BAR_STALL]);
      expect(v2.market!.spots.some(q => q.kind === 'drink')).toBe(false);
      expect([marketLayoutIssues(v2), marketLayoutIssues(v3)]).toEqual([[], []]);
    }
  });

  it('a campaign: a version-2 station keeps version 2 (no bar), a never-entered one records version 3 on its first build', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const v1Key = {level: 'market' as const, section: 'main', station: 'st-v1'}, v2Key = {level: 'market' as const, section: 'main', station: 'st-v2'}, newKey = {level: 'market' as const, section: 'main', station: 'st-new'};
    run.memory(v1Key).visits = 2; // entered under the first market's build: no record
    run.memory(v2Key).visits = 1;
    run.setLaneStore(MARKET_LAYOUT_LANE, {v: 2}, v2Key); // entered under the container settlement's build
    const version = (k: typeof v1Key) => {
      const v = marketLayoutVersionFor(run.peekMemory(k));
      if (run.laneStore(MARKET_LAYOUT_LANE, k) === undefined) run.setLaneStore(MARKET_LAYOUT_LANE, {v}, k);
      return v;
    };
    expect([version(v1Key), version(v2Key), version(newKey)]).toEqual([1, 2, 3]);
    run.memory(newKey).visits++;
    expect([version(v1Key), version(v2Key), version(newKey)]).toEqual([1, 2, 3]);
    expect([v1Key, v2Key, newKey].map(k => run.laneStore(MARKET_LAYOUT_LANE, k))).toEqual([{v: 1}, {v: 2}, {v: 3}]);
    const seed = run.seedFor(v2Key);
    expect(fingerprint(LEVELS.market.generate('main', {levelSeed: seed, layoutVersion: 2}))).toBe(fingerprint(generateMarketLevel({levelSeed: seed, layoutVersion: 2})));
    expect(LEVELS.market.generate('main', {levelSeed: seed, layoutVersion: 2}).market!.stalls.some(q => q.id === BAR_STALL)).toBe(false);
  });
});

describe('Market bar: the shipped layout versions stay byte-identical', () => {
  it('version 2 regenerates the shipped container settlement exactly (seam-commit fingerprints)', () => {
    for (const [s, want] of Object.entries(V2)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 2})), `seed ${s}`).toBe(want);
      expect(fingerprint(LEVELS.market.generate('main', {levelSeed: Number(s), layoutVersion: 2})), `seed ${s} (registry)`).toBe(want);
    }
  });

  it('version 1 regenerates the first market exactly (its shipped fingerprints)', () => {
    for (const [s, want] of Object.entries(V1)) expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 1})), `seed ${s}`).toBe(want);
  });
});
