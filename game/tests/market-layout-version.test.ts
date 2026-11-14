// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): the Survivor Market's LAYOUT VERSION policy (save compatibility,
// gen/market/layoutVersion.ts; the Skyways rule). A market station a player ENTERED under the first market's build (PR #69: its section
// memory has visits but no `market.layout` record) keeps regenerating version 1 exactly — its geometry, area ids, stalls and stock —
// forever; a recorded version is kept; a station never entered (an existing campaign's unvisited markets, every new campaign) builds
// version 2, the container settlement, and records it on first build (Game.generateSection).
// (Re-pinned by task studio-market-bar-20261108-225231-01, lane BAR: the current version is now 3 — the container settlement plus the
// upper-level bar, gen/market/v3/ — so a never-entered station builds and records 3; a recorded 2 stays 2 byte for byte:
// market-bar-version.test.ts pins version 2's fingerprints.)
// The version-1 fingerprints below were computed with the SHIPPED market generator (gen/market/index.ts as of a3fc6700, the branch base
// carrying main df1e4b1e's market, run side by side with this branch: identical) over the whole layout — every storey grid (cells,
// areas, floors, ceilings), areas, doors, props, lights, signs, the market record, rails, links, stairs, ladders, the spawn — and must
// stay identical for layoutVersion 1.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEVELS} from '../src/levels/registry';
import {MARKET_EMPTY_KEY, MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, generateMarketLevel, marketLayoutVersionFor} from '../src/gen/market/index';
import {MARKET_WORKSHOP_KEY} from '../src/items/lootTables';
import {createRun} from '../src/run/runState';
import type {StationLayout} from '../src/gen/stationTypes';

const V1: Record<number, string> = {
  1: '1033eb4e1052a7f2', 2: '6c16754332a7c225', 3: '689b90a315f4c7dc', 42: '03cd55fc302a3790',
  777: '76df150bb5f23746', 4242: '31e66a66cf69b127', 9001: 'c68876ba2a851b49', 31337: '3620c490527cf7df',
};

function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).digest('hex'));
  // (task studio-base-salvage-20261108-073314-01, main after these pins: version 1's workshop storage carries the workshop LOOT key — a
  // deliberate loot-key change on the same props, no geometry / id / stock change; normalised so the shipped pins still prove the rest)
  const props = l.props.map(p => (p.purpose === MARKET_WORKSHOP_KEY ? {...p, purpose: MARKET_EMPTY_KEY} : p));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

describe('Survivor Market layout version (save compatibility)', () => {
  it('the policy: entered under the first build (visits, no record) -> 1 forever; a recorded version is kept; never entered -> the current one', () => {
    // (re-pinned by task studio-corpse-market-shop-20261114-031614-01: the current version is now 4 — version 3 plus the corpse buyer's
    // den, gen/market/v4/; a recorded 3 stays 3 byte for byte: market-den-layout.test.ts)
    expect(MARKET_LAYOUT_VERSION).toBe(4);
    expect(MARKET_LAYOUT_LANE).toBe('market.layout');
    expect(marketLayoutVersionFor(undefined)).toBe(4);
    expect(marketLayoutVersionFor({visits: 0, lanes: {}})).toBe(4);
    expect(marketLayoutVersionFor({visits: 3, lanes: {}})).toBe(1);
    expect(marketLayoutVersionFor({visits: 3, lanes: {[MARKET_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    expect(marketLayoutVersionFor({visits: 3, lanes: {[MARKET_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(marketLayoutVersionFor({visits: 0, lanes: {[MARKET_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    // a malformed record falls back to the visit rule
    expect(marketLayoutVersionFor({visits: 1, lanes: {[MARKET_LAYOUT_LANE]: {v: 9}}})).toBe(1);
    expect(marketLayoutVersionFor({visits: 0, lanes: {[MARKET_LAYOUT_LANE]: {v: 'x'}}})).toBe(4);
  });

  it('version 1 regenerates the shipped first market exactly (fingerprints of the shipped generator)', () => {
    for (const [s, want] of Object.entries(V1)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 1})), `seed ${s}`).toBe(want);
      expect(fingerprint(LEVELS.market.generate('main', {levelSeed: Number(s), layoutVersion: 1})), `seed ${s} (registry)`).toBe(want);
    }
  });

  it('version 2 is the container settlement; deterministic; the same station name and stall ids (version 4, the default: + the bar, + the den)', () => {
    for (const s of [1, 42]) {
      const v1 = generateMarketLevel({levelSeed: s, layoutVersion: 1}), v2 = generateMarketLevel({levelSeed: s, layoutVersion: 2});
      expect([v1.market!.v, v2.market!.v, v2.levels.length]).toEqual([1, 2, 3]);
      expect(v2.name).toBe(v1.name);
      expect(v2.market!.stalls.map(q => q.id)).toEqual(v1.market!.stalls.map(q => q.id));
      expect(fingerprint(generateMarketLevel({levelSeed: s, layoutVersion: 2}))).toBe(fingerprint(v2));
      const v4 = generateMarketLevel({levelSeed: s});
      expect([v4.market!.v, v4.name, !!v4.market!.den]).toEqual([4, v2.name, true]);
      expect(v4.market!.stalls.map(q => q.id)).toEqual([...v2.market!.stalls.map(q => q.id), 'bar']);
      expect(v1.market!.stalls.every(q => q.displays === undefined)).toBe(true); // (v1 derives its display surfaces: market/wares)
    }
  });

  it('a campaign station: an old visited market keeps version 1, a new one records the current version (4) on its first build (Game.generateSection)', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const oldKey = {level: 'market' as const, section: 'main', station: 'st-old'}, newKey = {level: 'market' as const, section: 'main', station: 'st-new'};
    run.memory(oldKey).visits = 2; // entered under the first market's build: no record
    const version = (k: typeof oldKey) => {
      const v = marketLayoutVersionFor(run.peekMemory(k));
      if (run.laneStore(MARKET_LAYOUT_LANE, k) === undefined) run.setLaneStore(MARKET_LAYOUT_LANE, {v}, k);
      return v;
    };
    expect([version(oldKey), version(newKey)]).toEqual([1, 4]);
    run.memory(newKey).visits++;
    expect([version(oldKey), version(newKey)]).toEqual([1, 4]); // kept after visits, both
    expect([run.laneStore(MARKET_LAYOUT_LANE, oldKey), run.laneStore(MARKET_LAYOUT_LANE, newKey)]).toEqual([{v: 1}, {v: 4}]);
    // the game's generateSection applies exactly this rule to the market (and records the lane like the Skyways')
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
    expect(src).toMatch(/key\.level === 'market' \? marketLayoutVersionFor\(run\.peekMemory\(key\)\)/);
    expect(src).toMatch(/key\.level === 'market' \? MARKET_LAYOUT_LANE/);
    expect(src).toMatch(/run\.setLaneStore\(versionLane, \{v: layoutVersion\}, key\)/);
  });
});
