// Task studio-market-bar-20261108-225231-01 (lane BAR): the Survivor Market's layout version 3 (version 2's settlement + the upper-level
// bar) must leave the shipped versions alone — a VISITED version-2 market regenerates from its seed, so version 2's output stays
// byte-identical. The version-2 fingerprints below were computed on the seam commit (975f1d6e, main c1ded2f5's generator) with the same
// fingerprint() as market-layout-version.test.ts (every storey grid — cells, areas, floors, ceilings — areas, doors, props, lights, signs,
// the market record, rails, links, stairs, ladders, the spawn, the name).
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {LEVELS} from '../src/levels/registry';
import {MARKET_EMPTY_KEY, generateMarketLevel} from '../src/gen/market/index';
import {MARKET_WORKSHOP_KEY} from '../src/items/lootTables';
import type {StationLayout} from '../src/gen/stationTypes';

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

describe('Market bar: the shipped layout versions stay byte-identical', () => {
  it('version 2 regenerates the shipped container settlement exactly (seam-commit fingerprints)', () => {
    for (const [s, want] of Object.entries(V2)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 2})), `seed ${s}`).toBe(want);
      expect(fingerprint(LEVELS.market.generate('main', {levelSeed: Number(s), layoutVersion: 2})), `seed ${s} (registry)`).toBe(want);
    }
  });
});
